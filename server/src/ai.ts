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

let cached: { key: string; client: Anthropic } | null = null;
export function getClient(): Anthropic | null {
  const key = apiKey();
  if (!key) return null;
  // sleutel uit de omgeving: de SDK leest ze zelf (ook ANTHROPIC_AUTH_TOKEN als bearer-token)
  if (cached?.key !== key) cached = { key, client: keySource() === "env" ? new Anthropic() : new Anthropic({ apiKey: key }) };
  return cached.client;
}

/** Sleutel controleren (één kleine aanvraag) en bewaren. */
export async function saveApiKey(key: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const k = key.trim();
  if (!/^sk-ant-[\w-]{20,}$/.test(k)) return { ok: false, error: "Dat ziet er niet uit als een Claude API-sleutel (begint met sk-ant-)." };
  try {
    await new Anthropic({ apiKey: k }).models.list({ limit: 1 });
  } catch (e) {
    const status = (e as { status?: number }).status;
    return { ok: false, error: status === 401 ? "De sleutel wordt geweigerd (ongeldig of ingetrokken)." : `De sleutel kon niet gecontroleerd worden (${(e as Error).message}).` };
  }
  run("INSERT INTO global_settings(key, value) VALUES('anthropic_key', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", k);
  cached = null;
  return { ok: true };
}
export function clearApiKey() { run("DELETE FROM global_settings WHERE key='anthropic_key'"); cached = null; }

/** Alleen de beheerders van het eerste gezin op deze server (de eigenaar) beheren de gedeelde sleutel. */
export function operatorHousehold(): string | null {
  return get<{ id: string }>("SELECT id FROM households ORDER BY created_at, rowid LIMIT 1")?.id ?? null;
}
