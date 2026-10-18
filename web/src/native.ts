/** Android-app (Capacitor): statusbalk, ezan-meldingen die ook met gesloten app afgaan, en de batterijbeperking.
 *  In de gewone browser doet dit niets. */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { StatusBar, Style } from "@capacitor/status-bar";
import { api } from "./api";
import { EZAN_PRAYERS, PRAYER_NAME, PRAYER_TR } from "./islam";
import type { Prayer, PrayerDay, Settings } from "./types";
import { getLang } from "./i18n";

interface BatteryPlugin { status(): Promise<{ ignoring: boolean }>; requestIgnore(): Promise<{ ignoring: boolean }> }
const Battery = registerPlugin<BatteryPlugin>("Battery");

export const isNative = () => Capacitor.isNativePlatform();
export const platform = () => Capacitor.getPlatform();

/** Eén keer bij het opstarten van de app. */
export async function setupNative() {
  if (!isNative()) return;
  try { await StatusBar.setStyle({ style: Style.Light }); await StatusBar.setBackgroundColor({ color: "#e8f6f3" }); await StatusBar.setOverlaysWebView({ overlay: false }); } catch { /* */ }
  try { await LocalNotifications.createChannel({ id: "ezan", name: "Ezan", description: "Oproep tot gebed", importance: 5, visibility: 1, sound: "ezan.wav", vibration: true }); } catch { /* */ }
}

export async function notificationsAllowed(): Promise<boolean> {
  if (!isNative()) return false;
  try { const s = await LocalNotifications.checkPermissions(); if (s.display === "granted") return true; const r = await LocalNotifications.requestPermissions(); return r.display === "granted"; } catch { return false; }
}

export async function batteryStatus(): Promise<boolean | null> {
  if (!isNative()) return null;
  try { return (await Battery.status()).ignoring; } catch { return null; }
}
export async function requestBattery(): Promise<boolean | null> {
  if (!isNative()) return null;
  try { return (await Battery.requestIgnore()).ignoring; } catch { return null; }
}

const ID_BASE = 7000;
const idFor = (dayIx: number, p: Prayer) => ID_BASE + dayIx * 10 + EZAN_PRAYERS.indexOf(p);
const addDays = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

/** Plan de ezan-meldingen voor de komende dagen (exacte alarmen, ook als de app dicht is). */
export async function scheduleEzan(settings: Settings, today: PrayerDay | null, days = 7) {
  if (!isNative()) return;
  const on = settings.ezan_on === "1";
  try { const pending = await LocalNotifications.getPending(); const ours = pending.notifications.filter((n) => n.id >= ID_BASE && n.id < ID_BASE + 100); if (ours.length) await LocalNotifications.cancel({ notifications: ours.map((n) => ({ id: n.id })) }); } catch { /* */ }
  if (!on || !today || !(await notificationsAllowed())) return;
  const chosen = new Set(settings.ezan_prayers.split(",").filter(Boolean));
  let adjust: Record<string, number> = {}; try { adjust = JSON.parse(settings.ezan_adjust || "{}"); } catch { /* */ }
  const list: { id: number; title: string; body: string; schedule: { at: Date; allowWhileIdle: boolean }; channelId: string; sound: string; smallIcon: string }[] = [];
  const tr = getLang() === "tr";
  for (let i = 0; i < days; i++) {
    const date = addDays(today.date, i);
    let day: PrayerDay | null = i === 0 ? today : null;
    if (!day) { try { day = await api.get<PrayerDay>(`/prayer?date=${date}`); } catch { continue; } }
    for (const p of EZAN_PRAYERS) {
      if (!chosen.has(p)) continue;
      const at = new Date(new Date(day.times[p]).getTime() + (adjust[p] ?? 0) * 60_000);
      if (at.getTime() <= Date.now()) continue;
      list.push({ id: idFor(i, p), title: `${tr ? PRAYER_TR[p] : PRAYER_NAME[p]} · ${at.getHours()}:${String(at.getMinutes()).padStart(2, "0")}`, body: tr ? "Ezan vakti. Gezinsbord'u açmak için dokun." : "Het is tijd voor het gebed. Tik om Gezinsbord te openen.", schedule: { at, allowWhileIdle: true }, channelId: "ezan", sound: "ezan.wav", smallIcon: "ic_stat_ezan" });
    }
  }
  if (list.length) { try { await LocalNotifications.schedule({ notifications: list }); } catch { /* */ } }
}
