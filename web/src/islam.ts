import { useSyncExternalStore } from "react";
import type { Prayer, PrayerDay, Surah } from "./types";
import { t } from "./i18n";

export const PRAYER_ORDER: Prayer[] = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];
export const PRAYER_NAME: Record<Prayer, string> = { fajr: "Fajr", sunrise: "Zonsopgang", dhuhr: "Dhuhr", asr: "Asr", maghrib: "Maghrib", isha: "Isha" };
export const PRAYER_TR: Record<Prayer, string> = { fajr: "İmsak", sunrise: "Güneş", dhuhr: "Öğle", asr: "İkindi", maghrib: "Akşam", isha: "Yatsı" };
export const PRAYER_ICON: Record<Prayer, string> = { fajr: "🌄", sunrise: "🌅", dhuhr: "☀️", asr: "🌤️", maghrib: "🌇", isha: "🌙" };
/** Gebeden waarbij een ezan klinkt (bij zonsopgang niet). */
export const EZAN_PRAYERS: Prayer[] = ["fajr", "dhuhr", "asr", "maghrib", "isha"];

export const hm = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

/** Het eerstvolgende gebed vanaf nu, vandaag of anders morgenvroeg. */
export function nextPrayer(day: PrayerDay | null, now = Date.now()): { prayer: Prayer; at: number; tomorrow: boolean } | null {
  if (!day) return null;
  for (const p of EZAN_PRAYERS) { const t = new Date(day.times[p]).getTime(); if (t > now) return { prayer: p, at: t, tomorrow: false }; }
  return { prayer: "fajr", at: new Date(day.tomorrow.fajr).getTime(), tomorrow: true };
}
export const untilText = (ms: number) => { const m = Math.max(0, Math.round(ms / 60_000)); return m < 60 ? t("over {m} min", { m }) : t("over {h}u{m}", { h: Math.floor(m / 60), m: String(m % 60).padStart(2, "0") }); };

/** Islamitische datum (umm al-qura) in het Nederlands. */
export const hijri = (d = new Date()) => { try { return new Intl.DateTimeFormat("nl-u-ca-islamic-umalqura", { day: "numeric", month: "long", year: "numeric" }).format(d); } catch { return ""; } };

/* ---------- Koran-speler: één speler voor de hele app, zodat het verder speelt op de achtergrond ---------- */
export interface PlayerState { surah: Surah | null; index: number; playing: boolean; reciter: string; follow: boolean; repeat: boolean; continueNext: boolean }
let state: PlayerState = { surah: null, index: 0, playing: false, reciter: "ar.alafasy", follow: true, repeat: false, continueNext: true };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export const ayahAudioUrl = (reciter: string, globalAyah: number) => `https://cdn.islamic.network/quran/audio/128/${reciter}/${globalAyah}.mp3`;

let audio: HTMLAudioElement | null = null;
let onEnded: (() => void) | null = null;
let errors = 0; // opeenvolgende laadfouten: na drie stoppen we, anders rent de speler door alle verzen
function el() {
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
    audio.addEventListener("ended", () => { errors = 0; onEnded?.(); });
    audio.addEventListener("playing", () => { errors = 0; });
    audio.addEventListener("error", () => { if (!state.playing) return; if (++errors >= 3) { state = { ...state, playing: false }; emit(); } else setTimeout(() => onEnded?.(), 600); });
  }
  return audio;
}
export const player = {
  get: () => state,
  set(patch: Partial<PlayerState>) { state = { ...state, ...patch }; emit(); },
  /** Speel een soera vanaf een vers (index). */
  play(surah: Surah, index = 0) {
    state = { ...state, surah, index, playing: true };
    emit();
    const a = el();
    a.src = ayahAudioUrl(state.reciter, surah.ayahs[index].number);
    a.play().catch(() => { state = { ...state, playing: false }; emit(); });
    // volgende vers alvast ophalen
    const nxt = surah.ayahs[index + 1];
    if (nxt) { const pre = new Audio(); pre.preload = "auto"; pre.src = ayahAudioUrl(state.reciter, nxt.number); }
  },
  pause() { el().pause(); state = { ...state, playing: false }; emit(); },
  resume() { if (!state.surah) return; el().play().then(() => { state = { ...state, playing: true }; emit(); }).catch(() => {}); },
  toggle() { state.playing ? player.pause() : player.resume(); },
  next() { if (!state.surah) return; const i = state.index + 1; if (i < state.surah.ayahs.length) player.play(state.surah, i); else if (state.continueNext && nextSurahLoader) nextSurahLoader(state.surah.number + 1).then((s) => s && player.play(s, 0)); else player.pause(); },
  prev() { if (!state.surah) return; player.play(state.surah, Math.max(0, state.index - 1)); },
  stop() { el().pause(); state = { ...state, surah: null, playing: false, index: 0 }; emit(); },
};
onEnded = () => { if (state.repeat && state.surah) player.play(state.surah, state.index); else player.next(); };
let nextSurahLoader: ((n: number) => Promise<Surah | null>) | null = null;
export const setSurahLoader = (f: (n: number) => Promise<Surah | null>) => { nextSurahLoader = f; };
export function usePlayer() { return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state); }
