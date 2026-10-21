// Slim huis via Home Assistant: één URL en token, en Gezinsbord toont en stuurt lampen, scènes, thermostaat, sloten, energie en wie thuis is.
import { getSettings } from "./db.js";

export interface HaState { entity_id: string; state: string; attributes: Record<string, unknown>; last_changed: string }
const DOMAINS = new Set(["light", "switch", "scene", "climate", "lock", "cover", "person", "device_tracker", "sensor", "binary_sensor", "media_player", "script", "input_boolean", "fan", "vacuum", "alarm_control_panel"]);

export function haConfig(h?: string) { const s = getSettings(h); return s.ha_url && s.ha_token ? { url: s.ha_url.replace(/\/+$/, ""), token: s.ha_token } : null; }

export async function haFetch<T>(path: string, init: { method?: string; body?: unknown } = {}, h?: string): Promise<T> {
  const cfg = haConfig(h);
  if (!cfg) throw new Error("Home Assistant is nog niet gekoppeld.");
  const res = await fetch(`${cfg.url}/api${path}`, { method: init.method ?? "GET", headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" }, body: init.body ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(8000) });
  if (res.status === 401) throw new Error("Home Assistant weigert de token. Maak in je HA-profiel een nieuwe 'Long-lived access token'.");
  if (!res.ok) throw new Error(`Home Assistant gaf foutcode ${res.status}.`);
  return (await res.json()) as T;
}
export const haTest = (h?: string) => haFetch<{ message: string }>("/", {}, h);
/** Alle bruikbare entiteiten (of enkel de gekozen). */
export async function haStates(onlyChosen = true, h?: string): Promise<HaState[]> {
  const states = await haFetch<HaState[]>("/states", {}, h);
  const chosen = new Set((getSettings(h).ha_entities || "").split(",").map((s) => s.trim()).filter(Boolean));
  return states.filter((s) => DOMAINS.has(s.entity_id.split(".")[0]) && (!onlyChosen || !chosen.size || chosen.has(s.entity_id)));
}
export const haCall = (domain: string, service: string, data: Record<string, unknown>, h?: string) => haFetch<unknown>(`/services/${domain}/${service}`, { method: "POST", body: data }, h);
/** Een scène uit de instellingen (slaap, ochtend, ezan, weg) uitvoeren; stil als er geen is. */
export async function runMoment(moment: "sleep" | "morning" | "ezan" | "away" | "home", h?: string) {
  let map: Record<string, string> = {}; try { map = JSON.parse(getSettings(h).ha_scenes || "{}"); } catch { /* */ }
  const ent = map[moment]; if (!ent || !haConfig(h)) return false;
  const [domain] = ent.split(".");
  try { await haCall(domain === "script" ? "script" : "scene", "turn_on", { entity_id: ent }, h); return true; } catch { return false; }
}
/** Is er iemand thuis volgens HA (person/device_tracker)? null als onbekend. */
export async function anyoneHome(h?: string): Promise<boolean | null> {
  try { const st = await haStates(false, h); const ps = st.filter((s) => s.entity_id.startsWith("person.")); if (!ps.length) return null; return ps.some((p) => p.state === "home"); } catch { return null; }
}
