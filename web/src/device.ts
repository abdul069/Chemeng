/** Welke rol heeft dít toestel? Het wandscherm of tafelmodel in de keuken (hub), of een telefoon van een gezinslid (companion).
 *  De keuze staat op het toestel zelf; de server houdt alle toestellen van het gezin bij zodat ze elkaar kunnen vinden. */
import { useEffect, useState } from "react";
import { api } from "./api";
import { isNative, platform } from "./native";

export type DeviceRole = "hub" | "phone";
export type HubVariant = "wall" | "table";
export interface DeviceState { id: string; role: DeviceRole | null; variant: HubVariant | ""; memberId: string | null; name: string }

const KEY = "gb.device";
const listeners = new Set<() => void>();

function fresh(): DeviceState {
  const id = (crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, "").slice(0, 24);
  return { id, role: null, variant: "", memberId: null, name: defaultName() };
}
function defaultName() {
  const u = navigator.userAgent;
  if (isNative()) return platform() === "android" ? "Android-telefoon" : "iPhone";
  if (/iPhone/.test(u)) return "iPhone"; if (/iPad/.test(u)) return "iPad"; if (/Android/.test(u)) return /Mobile/.test(u) ? "Android-telefoon" : "Android-tablet";
  if (/Windows/.test(u)) return "Windows-pc"; if (/Mac/.test(u)) return "Mac"; return "Scherm";
}
let state: DeviceState = (() => { try { const raw = localStorage.getItem(KEY); if (raw) return { ...fresh(), ...JSON.parse(raw) } as DeviceState; } catch { /* */ } return fresh(); })();

export const getDevice = () => state;
export function setDevice(patch: Partial<DeviceState>) {
  state = { ...state, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* */ }
  document.body.classList.toggle("gb-hub", state.role === "hub");
  document.body.classList.toggle("gb-phone", state.role === "phone");
  listeners.forEach((l) => l());
}
document.body.classList.toggle("gb-hub", state.role === "hub");
document.body.classList.toggle("gb-phone", state.role === "phone");

/** Een voorstel voor de rol: smal of een echte telefoon-app → telefoon; groot aanraakscherm → hub. */
export function suggestRole(): DeviceRole {
  if (isNative()) return "phone";
  const small = Math.min(screen.width, screen.height) < 700;
  return small ? "phone" : "hub";
}

export function useDevice() {
  const [, tick] = useState(0);
  useEffect(() => { const l = () => tick((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return state;
}

/** Meld dit toestel aan bij de server en laat elke twee minuten weten dat het er nog is. */
export function useDeviceRegistration(loggedIn: boolean) {
  const d = useDevice();
  useEffect(() => {
    if (!loggedIn || !d.role) return;
    const body = { name: d.name, role: d.role, variant: d.variant, platform: isNative() ? platform() : "web", memberId: d.memberId };
    api.put(`/devices/${d.id}`, body).catch(() => {});
    const t = setInterval(() => api.post(`/devices/${d.id}/ping`).catch(() => {}), 120_000);
    return () => clearInterval(t);
  }, [loggedIn, d.id, d.role, d.variant, d.memberId, d.name]);
}

/** Iets op het keukenscherm tonen. to = toestel-id, of null voor alle hubs die online zijn. */
export const cast = (kind: "recipe" | "screen" | "message" | "note", value: string, to: string | null = null) =>
  api.post<{ ok: boolean; hubs: number }>("/cast", { to, kind, value, from: state.id });
