import type { Topic } from "./types";

const CODE_KEY = "gezinsbord.code";
export const getCode = () => { try { return localStorage.getItem(CODE_KEY) ?? ""; } catch { return ""; } };
export const setCode = (c: string) => { try { localStorage.setItem(CODE_KEY, c); } catch { /* geen opslag */ } };

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const code = getCode();
  if (code) headers.authorization = `Bearer ${code}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  let res: Response;
  try {
    res = await fetch(`/api${url}`, { method, headers, body: payload });
  } catch {
    throw new ApiError("Geen verbinding met de Gezinsbord-server. Controleer het wifi.", 0);
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(data?.error ?? `Fout ${res.status}`, res.status);
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T = { ok: boolean }>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  put: <T = { ok: boolean }>(url: string, body: unknown) => request<T>("PUT", url, body),
  patch: <T = { ok: boolean }>(url: string, body: unknown) => request<T>("PATCH", url, body),
  del: <T = { ok: boolean }>(url: string) => request<T>("DELETE", url),
};

export const photoUrl = (filename: string) => {
  const code = getCode();
  return `/api/photos/file/${encodeURIComponent(filename)}${code ? `?code=${encodeURIComponent(code)}` : ""}`;
};

type Listener = (topics: Topic[]) => void;
const listeners = new Set<Listener>();
export const onChanged = (fn: Listener) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
let online = (_: boolean) => {};
export const onConnection = (fn: (ok: boolean) => void) => { online = fn; };

/** Houdt een websocket open en herverbindt automatisch. */
export function connectRealtime() {
  let retry = 1000;
  const open = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws?code=${encodeURIComponent(getCode())}`);
    ws.onopen = () => { retry = 1000; online(true); };
    ws.onmessage = (m) => {
      try {
        const msg = JSON.parse(m.data);
        if (msg.type === "changed") listeners.forEach((l) => l(msg.topics));
        // na een herverbinding alles opnieuw ophalen
        if (msg.type === "hello") listeners.forEach((l) => l(["members", "events", "chores", "meals", "recipes", "lists", "photos", "calendars", "settings", "rewards"]));
      } catch { /* negeren */ }
    };
    ws.onclose = () => { online(false); setTimeout(open, retry); retry = Math.min(retry * 2, 30_000); };
  };
  open();
}
