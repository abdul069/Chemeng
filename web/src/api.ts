import type { Cast, Topic } from "./types";

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  let res: Response;
  try {
    res = await fetch(`/api${url}`, { method, headers, body: payload, credentials: "same-origin" });
  } catch {
    throw new ApiError("Geen verbinding met de Gezinsbord-server. Controleer je internet.", 0);
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) {
    const msg = data?.details?.length && data.error === "Controleer de ingevulde gegevens." ? String(data.details[0]).replace(/^[\w.]+: /, "") : data?.error;
    throw new ApiError(msg ?? `Fout ${res.status}`, res.status, data?.code);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T = { ok: boolean }>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  put: <T = { ok: boolean }>(url: string, body: unknown) => request<T>("PUT", url, body),
  patch: <T = { ok: boolean }>(url: string, body: unknown) => request<T>("PATCH", url, body),
  del: <T = { ok: boolean }>(url: string) => request<T>("DELETE", url),
};

export const photoUrl = (filename: string) => `/api/photos/file/${encodeURIComponent(filename)}`;

type Listener = (topics: Topic[]) => void;
const listeners = new Set<Listener>();
export const onChanged = (fn: Listener) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const castListeners = new Set<(c: Cast) => void>();
/** Luister naar "cast"-berichten: een ander toestel wil iets op dit scherm tonen. */
export const onCast = (fn: (c: Cast) => void) => { castListeners.add(fn); return () => { castListeners.delete(fn); }; };
let online = (_: boolean) => {};
export const onConnection = (fn: (ok: boolean) => void) => { online = fn; };

const ALL: Topic[] = ["members", "events", "chores", "meals", "recipes", "lists", "photos", "calendars", "settings", "rewards", "access", "sharing", "memos", "devices", "notes", "family", "home", "connections"];

/** Houdt een websocket open en herverbindt automatisch. */
let current: WebSocket | null = null;
export function connectRealtime() {
  let retry = 1000;
  const open = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    current = ws;
    ws.onopen = () => { retry = 1000; online(true); };
    ws.onmessage = (m) => {
      try {
        const msg = JSON.parse(m.data);
        if (msg.type === "changed") listeners.forEach((l) => l(msg.topics));
        if (msg.type === "cast") castListeners.forEach((l) => l(msg as Cast));
        // na een herverbinding alles opnieuw ophalen
        if (msg.type === "hello") listeners.forEach((l) => l(ALL));
      } catch { /* negeren */ }
    };
    ws.onclose = () => {
      if (current !== ws) return;
      online(false);
      setTimeout(open, retry);
      retry = Math.min(retry * 2, 30_000);
    };
  };
  open();
}
/** Na wisselen van gezin hoort de verbinding bij het nieuwe gezin. */
export function reconnectRealtime() { current?.close(); }
