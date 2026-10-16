// Claude-sleutel: uit de omgeving (ANTHROPIC_API_KEY) of door de beheerder ingevuld in Instellingen → Assistent.
import Anthropic from "@anthropic-ai/sdk";
import { db, get, run } from "./db.js";

db.exec("CREATE TABLE IF NOT EXISTS global_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");

export function apiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || get<{ value: string }>("SELECT value FROM global_settings WHERE key='anthropic_key'")?.value || null;
}
/** Waar de sleutel vandaan komt, voor de instellingen. */
export const keySource = (): "env" | "app" | null => (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) ? "env" : apiKey() ? "app" : null;
export const aiReady = () => apiKey() !== null;
/** Workspace-ID: nodig als de sleutel op organisatieniveau is aangemaakt (Anthropic vraagt dan de header anthropic-workspace-id). */
export const workspaceId = (): string | null => process.env.ANTHROPIC_WORKSPACE_ID || get<{ value: string }>("SELECT value FROM global_settings WHERE key='anthropic_workspace'")?.value || null;
const headers = (ws: string | null) => (ws ? { defaultHeaders: { "anthropic-workspace-id": ws } } : {});

let cached: { key: string; client: Anthropic } | null = null;
export function getClient(): Anthropic | null {
  const key = apiKey();
  if (!key) return null;
  const ws = workspaceId();
  const sig = `${key}|${ws ?? ""}`;
  // sleutel uit de omgeving: de SDK leest ze zelf (ook ANTHROPIC_AUTH_TOKEN als bearer-token)
  if (cached?.key !== sig) cached = { key: sig, client: keySource() === "env" ? new Anthropic({ ...headers(ws) }) : new Anthropic({ apiKey: key, ...headers(ws) }) };
  return cached.client;
}

/** Sleutel controleren (één kleine aanvraag) en bewaren. */
export async function saveApiKey(key: string, workspace = ""): Promise<{ ok: true } | { ok: false; error: string; needsWorkspace?: boolean }> {
  const k = key.trim(); const ws = workspace.trim() || null;
  if (!/^sk-ant-[\w-]{20,}$/.test(k)) return { ok: false, error: "Dat ziet er niet uit als een Claude API-sleutel (begint met sk-ant-)." };
  try {
    // een echte (piepkleine) aanvraag, want models.list controleert de workspace niet
    await new Anthropic({ apiKey: k, ...headers(ws) }).messages.create({ model: process.env.LIBRARY_MODEL ?? "claude-haiku-5-5", max_tokens: 5, messages: [{ role: "user", content: "ok" }] });
  } catch (e) {
    const status = (e as { status?: number }).status; const msg = (e as Error).message;
    if (/workspace/i.test(msg)) return { ok: false, needsWorkspace: true, error: "Deze sleutel is niet aan een workspace gekoppeld. Vul hieronder ook de workspace-ID in (console.anthropic.com → Settings → Workspaces), of maak de sleutel aan binnen een workspace." };
    return { ok: false, error: status === 401 ? "De sleutel wordt geweigerd (ongeldig of ingetrokken)." : `De sleutel kon niet gecontroleerd worden (${msg}).` };
  }
  run("INSERT INTO global_settings(key, value) VALUES('anthropic_key', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", k);
  if (ws) run("INSERT INTO global_settings(key, value) VALUES('anthropic_workspace', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ws);
  else run("DELETE FROM global_settings WHERE key='anthropic_workspace'");
  cached = null;
  return { ok: true };
}
/** Alleen de workspace-ID toevoegen aan een sleutel die al in de omgeving staat. */
export async function saveWorkspace(workspace: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ws = workspace.trim();
  const key = apiKey();
  if (!key) return { ok: false, error: "Er is nog geen sleutel." };
  try {
    await new Anthropic({ apiKey: key, ...headers(ws || null) }).messages.create({ model: process.env.LIBRARY_MODEL ?? "claude-haiku-5-5", max_tokens: 5, messages: [{ role: "user", content: "ok" }] });
  } catch (e) { return { ok: false, error: `Werkt niet met deze workspace-ID: ${(e as Error).message.slice(0, 160)}` }; }
  if (ws) run("INSERT INTO global_settings(key, value) VALUES('anthropic_workspace', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ws);
  else run("DELETE FROM global_settings WHERE key='anthropic_workspace'");
  cached = null;
  return { ok: true };
}
/** Werkt de huidige sleutel (+ workspace)? Voor de instellingen. */
export async function checkAi(): Promise<{ ok: boolean; error?: string; needsWorkspace?: boolean }> {
  const c = getClient();
  if (!c) return { ok: false, error: "Geen sleutel." };
  try { await c.messages.create({ model: process.env.LIBRARY_MODEL ?? "claude-haiku-5-5", max_tokens: 5, messages: [{ role: "user", content: "ok" }] }); return { ok: true }; }
  catch (e) { const msg = (e as Error).message; return { ok: false, error: msg.slice(0, 200), needsWorkspace: /workspace/i.test(msg) }; }
}
export function clearApiKey() { run("DELETE FROM global_settings WHERE key='anthropic_key'"); run("DELETE FROM global_settings WHERE key='anthropic_workspace'"); cached = null; }

/** Alleen de beheerders van het eerste gezin op deze server (de eigenaar) beheren de gedeelde sleutel. */
export function operatorHousehold(): string | null {
  return get<{ id: string }>("SELECT id FROM households ORDER BY created_at, rowid LIMIT 1")?.id ?? null;
}
