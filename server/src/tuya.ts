/** Tuya / Smart Life: de lampen, stekkers, thermostaten en sensoren van Action (LSC), Lidl (Silvercrest), Nedis, Calex en
 *  honderden no-name merken. Praat met de Tuya Cloud (OpenAPI) met de Access ID en Access Secret van een cloudproject
 *  waaraan het Smart Life-account gekoppeld is. Apparaten verschijnen als entiteiten naast Home Assistant in "Slim huis". */
import crypto from "node:crypto";
import type { HaState } from "./smarthome.js";
import { all } from "./db.js";
import { decrypt } from "./connectors.js";

export type Region = "eu" | "eu-w" | "us" | "us-e" | "cn" | "in";
const HOSTS: Record<Region, string> = { eu: "https://openapi.tuyaeu.com", "eu-w": "https://openapi-weaz.tuyaeu.com", us: "https://openapi.tuyaus.com", "us-e": "https://openapi-ueaz.tuyaus.com", cn: "https://openapi.tuyacn.com", in: "https://openapi.tuyain.com" };
export interface TuyaConfig { accessId: string; accessSecret: string; region: Region }
export interface TuyaDevice { id: string; name: string; category: string; online: boolean; product_name?: string; status: { code: string; value: unknown }[] }
type Json = Record<string, unknown>;
export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
/** Handtekening volgens Tuya: HMAC-SHA256 over client_id [+ access_token] + t + nonce + stringToSign, in hoofdletters. */
export function sign(cfg: TuyaConfig, method: string, path: string, body: string, t: string, nonce: string, accessToken = ""): string {
  const stringToSign = [method.toUpperCase(), sha256(body), "", path].join("\n");
  return crypto.createHmac("sha256", cfg.accessSecret).update(cfg.accessId + accessToken + t + nonce + stringToSign).digest("hex").toUpperCase();
}

const tokens = new Map<string, { token: string; until: number }>();
export class TuyaError extends Error {}
export class Tuya {
  constructor(private cfg: TuyaConfig, private fetcher: Fetcher = (u, i) => fetch(u, { ...i, signal: AbortSignal.timeout(12_000) })) {}
  private get host() { return HOSTS[this.cfg.region] ?? HOSTS.eu; }
  private async request<T>(method: "GET" | "POST", path: string, body?: Json, accessToken = ""): Promise<T> {
    const t = String(Date.now()); const nonce = crypto.randomUUID(); const raw = body ? JSON.stringify(body) : "";
    const headers: Record<string, string> = { client_id: this.cfg.accessId, sign: sign(this.cfg, method, path, raw, t, nonce, accessToken), t, nonce, sign_method: "HMAC-SHA256", "content-type": "application/json" };
    if (accessToken) headers.access_token = accessToken;
    let r: Awaited<ReturnType<Fetcher>>;
    try { r = await this.fetcher(this.host + path, { method, headers, body: raw || undefined }); } catch (e) { throw new TuyaError(`Tuya-cloud niet bereikbaar (${e instanceof Error && e.cause instanceof Error ? e.cause.message : e instanceof Error ? e.message : "netwerk"}).`); }
    const j = (await r.json().catch(() => ({}))) as { success?: boolean; result?: T; msg?: string; code?: number };
    if (!r.ok || j.success === false) throw new TuyaError(friendly(j.code, j.msg) || `Tuya antwoordde ${r.status}`);
    return j.result as T;
  }
  async token(): Promise<string> {
    const key = this.cfg.accessId; const c = tokens.get(key); if (c && c.until > Date.now()) return c.token;
    const r = await this.request<{ access_token: string; expire_time: number }>("GET", "/v1.0/token?grant_type=1");
    tokens.set(key, { token: r.access_token, until: Date.now() + (r.expire_time - 60) * 1000 });
    return r.access_token;
  }
  /** Alle apparaten van de gekoppelde Smart Life-accounts, met hun huidige status. */
  async devices(): Promise<TuyaDevice[]> {
    const tok = await this.token();
    const r = await this.request<{ devices?: TuyaDevice[]; total?: number }>("GET", "/v1.0/iot-01/associated-users/devices?size=100", undefined, tok);
    return (r.devices ?? []).map((d) => ({ ...d, status: d.status ?? [] }));
  }
  async command(deviceId: string, commands: { code: string; value: unknown }[]): Promise<void> {
    const tok = await this.token();
    await this.request("POST", `/v1.0/iot-03/devices/${deviceId}/commands`, { commands }, tok);
  }
  async test(): Promise<number> { return (await this.devices()).length; }
}
function friendly(code?: number, msg?: string): string {
  if (code === 1004 || code === 1010 || code === 1011) return "Tuya weigert de handtekening: controleer Access ID en Access Secret.";
  if (code === 28841002 || code === 28841105) return "De API-dienst is niet geactiveerd of verlopen in het Tuya-platform: Cloud → je project → Service API → 'IoT Core' en 'Authorization' toevoegen of verlengen (gratis).";
  if (code === 2406) return "Verkeerde regio: kies de regio van je Tuya-project (meestal Central Europe).";
  return msg ?? "";
}

// ---------- apparaten → entiteiten zoals Home Assistant ze kent ----------
const LIGHT = new Set(["dj", "dd", "fwd", "xdd", "dc", "tgq", "tgkg", "fsd", "gyd"]);
const SWITCH = new Set(["cz", "pc", "kg", "tdq", "dlq", "wkcz", "kt", "qn"]);
const CLIMATE = new Set(["wk", "wkf", "wkcz", "ktkzq", "rs"]);
const SENSOR_T = new Set(["wsdcg", "ldcg", "zd"]);
const DOOR = new Set(["mcs", "ms", "pir", "sj", "ywbj", "rqbj", "cobj", "sos"]);
const SWITCH_CODES = ["switch_led", "switch_1", "switch", "switch_led_1"];
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);
const code = (d: TuyaDevice, ...codes: string[]) => { for (const c of codes) { const s = d.status.find((x) => x.code === c); if (s) return s; } return undefined; };
/** Tuya levert temperaturen vaak ×10 (schaal 1). Alles boven de 100 wordt gedeeld door 10. */
const temp = (v: unknown) => { const n = num(v); return n === null ? null : Math.abs(n) > 100 ? n / 10 : n; };
export const entityId = (d: TuyaDevice): string => {
  const base = `tuya_${d.id.replace(/[^a-zA-Z0-9]/g, "")}`;
  if (CLIMATE.has(d.category) && code(d, "temp_set")) return `climate.${base}`;
  if (LIGHT.has(d.category)) return `light.${base}`;
  if (SWITCH.has(d.category)) return `switch.${base}`;
  if (DOOR.has(d.category)) return `binary_sensor.${base}`;
  if (SENSOR_T.has(d.category) || code(d, "va_temperature", "temp_current", "humidity_value", "va_humidity")) return `sensor.${base}`;
  return code(d, ...SWITCH_CODES) ? `switch.${base}` : `sensor.${base}`;
};
export function toStates(devices: TuyaDevice[]): HaState[] {
  const out: HaState[] = [];
  for (const d of devices) {
    const id = entityId(d); const domain = id.split(".")[0];
    const attrs: Record<string, unknown> = { friendly_name: d.name, tuya_id: d.id, tuya_category: d.category, source: "tuya" };
    const last = new Date().toISOString();
    if (!d.online) { out.push({ entity_id: id, state: "unavailable", attributes: attrs, last_changed: last }); continue; }
    if (domain === "light" || domain === "switch") {
      const sw = code(d, ...SWITCH_CODES);
      const b = code(d, "bright_value_v2", "bright_value"); const bn = num(b?.value);
      if (bn !== null) { const max = b!.code === "bright_value_v2" ? 1000 : 255; attrs.brightness = Math.round((bn / max) * 255); attrs.brightness_pct = Math.round((bn / max) * 100); }
      const ct = code(d, "temp_value_v2", "temp_value"); if (ct && num(ct.value) !== null) attrs.color_temp_pct = Math.round((num(ct.value)! / (ct.code === "temp_value_v2" ? 1000 : 255)) * 100);
      const power = code(d, "cur_power"); if (power && num(power.value) !== null) attrs.power_w = num(power.value)! / 10;
      out.push({ entity_id: id, state: sw ? (sw.value === true || sw.value === "true" ? "on" : "off") : "unknown", attributes: attrs, last_changed: last });
    } else if (domain === "climate") {
      const set = temp(code(d, "temp_set")?.value); const cur = temp(code(d, "temp_current", "upper_temp")?.value); const sw = code(d, "switch", "switch_1"); const mode = str(code(d, "mode", "work_mode")?.value);
      attrs.temperature = set; attrs.current_temperature = cur; attrs.hvac_modes = ["heat", "off"]; attrs.tuya_temp_scale = Math.abs(num(code(d, "temp_set")?.value) ?? 0) > 100 ? 10 : 1;
      const on = sw ? sw.value === true : true;
      out.push({ entity_id: id, state: !on ? "off" : mode === "auto" ? "auto" : "heat", attributes: attrs, last_changed: last });
    } else if (domain === "binary_sensor") {
      const door = code(d, "doorcontact_state", "pir", "watersensor_state", "gas_sensor_state", "co_state", "sos_state");
      const battery = code(d, "battery_percentage"); if (battery) attrs.battery = num(battery.value);
      const v = door?.value; const on = v === true || v === "pir" || v === "alarm" || v === "1";
      attrs.device_class = d.category === "mcs" ? "door" : d.category === "pir" ? "motion" : d.category === "sj" ? "moisture" : "safety";
      out.push({ entity_id: id, state: door ? (on ? "on" : "off") : "unknown", attributes: attrs, last_changed: last });
    } else {
      const t = temp(code(d, "va_temperature", "temp_current")?.value); const h = num(code(d, "va_humidity", "humidity_value")?.value);
      if (t !== null) { attrs.unit_of_measurement = "°C"; attrs.device_class = "temperature"; if (h !== null) attrs.humidity = h; out.push({ entity_id: id, state: String(t), attributes: attrs, last_changed: last }); }
      else if (h !== null) { attrs.unit_of_measurement = "%"; attrs.device_class = "humidity"; out.push({ entity_id: id, state: String(h), attributes: attrs, last_changed: last }); }
      else { const first = d.status[0]; out.push({ entity_id: id, state: first ? String(first.value) : "unknown", attributes: { ...attrs, code: first?.code }, last_changed: last }); }
    }
  }
  return out;
}
/** Een Home Assistant-achtige dienst vertalen naar Tuya-commando's voor dit apparaat. */
export function commandsFor(d: TuyaDevice, service: string, data: Record<string, unknown>): { code: string; value: unknown }[] {
  const sw = code(d, ...SWITCH_CODES)?.code ?? (CLIMATE.has(d.category) ? "switch" : "switch_1");
  if (service === "turn_on" || service === "turn_off") {
    const cmds: { code: string; value: unknown }[] = [{ code: sw, value: service === "turn_on" }];
    const pct = num(data.brightness_pct); const b = code(d, "bright_value_v2", "bright_value");
    if (service === "turn_on" && pct !== null && b) cmds.push({ code: b.code, value: Math.max(b.code === "bright_value_v2" ? 10 : 25, Math.round((pct / 100) * (b.code === "bright_value_v2" ? 1000 : 255))) });
    return cmds;
  }
  if (service === "toggle") { const cur = code(d, ...SWITCH_CODES); return [{ code: sw, value: !(cur?.value === true) }]; }
  if (service === "set_temperature") {
    const t = num(data.temperature); if (t === null) throw new TuyaError("Geen temperatuur opgegeven.");
    const scale = Math.abs(num(code(d, "temp_set")?.value) ?? 0) > 100 ? 10 : 1;
    return [{ code: "temp_set", value: Math.round(t * scale) }];
  }
  if (service === "set_hvac_mode") return [{ code: sw, value: data.hvac_mode !== "off" }];
  throw new TuyaError(`Dienst ${service} wordt voor Tuya niet ondersteund.`);
}
export const isTuyaEntity = (entityId: string) => /\.tuya_/.test(entityId);
export const deviceIdOf = (entityId: string, devices: TuyaDevice[]) => devices.find((d) => entityId.endsWith(`tuya_${d.id.replace(/[^a-zA-Z0-9]/g, "")}`)) ?? null;

// ---------- cache per gezin zodat het scherm niet elke tik de cloud bevraagt ----------
const cache = new Map<string, { at: number; devices: TuyaDevice[] }>();
export async function cachedDevices(key: string, client: Tuya, maxAgeMs = 8000): Promise<TuyaDevice[]> {
  const c = cache.get(key); if (c && Date.now() - c.at < maxAgeMs) return c.devices;
  const devices = await client.devices(); cache.set(key, { at: Date.now(), devices }); return devices;
}
export const invalidate = (key: string) => cache.delete(key);

// ---------- koppeling van het gezin ----------
interface ConnLike { householdId: string; config: Record<string, unknown> }
export function clientFor(c: ConnLike): Tuya {
  const region = (typeof c.config.region === "string" && c.config.region in HOSTS ? c.config.region : "eu") as Region;
  return new Tuya({ accessId: String(c.config.accessId ?? ""), accessSecret: String(c.config.accessSecret ?? ""), region });
}
/** De Tuya-koppeling van dit gezin, als die er is en aan staat. */
export function connectionFor(h: string): ConnLike | null {
  const r = all<{ config: string }>("SELECT config FROM connections WHERE household_id=? AND connector='tuya' AND enabled=1 LIMIT 1", h)[0];
  if (!r) return null; let config: Record<string, unknown> = {}; try { config = decrypt(r.config); } catch { return null; }
  return config.accessId && config.accessSecret ? { householdId: h, config } : null;
}
export async function statesFor(h: string): Promise<HaState[]> {
  const c = connectionFor(h); if (!c) return [];
  return toStates(await cachedDevices(h, clientFor(c)));
}
export async function callFor(h: string, entityId: string, service: string, data: Record<string, unknown>): Promise<boolean> {
  const c = connectionFor(h); if (!c) return false;
  const client = clientFor(c); const devices = await cachedDevices(h, client, 60_000);
  const d = deviceIdOf(entityId, devices); if (!d) throw new TuyaError("Dit Tuya-apparaat is niet (meer) gevonden.");
  await client.command(d.id, commandsFor(d, service, data)); invalidate(h); return true;
}
