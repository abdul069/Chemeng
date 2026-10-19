import { useEffect, useRef, useState } from "react";
import { photoUrl } from "../api";
import { useData, useRemote } from "../store";
import type { EzanSound, Prayer, PrayerDay } from "../types";
import { EZAN_PRAYERS, PRAYER_ICON, PRAYER_NAME, PRAYER_TR, hm, ezanOnThisDevice } from "../islam";
import { scheduleEzan } from "../native";
import { t } from "../i18n";

const PLAYED_KEY = "gezinsbord.ezan.played";

/** Zacht belletje via WebAudio (als er geen ezan-bestand is). */
function chime(volume: number) {
  try {
    const ctx = new AudioContext();
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0, ctx.currentTime + i * 0.35);
      g.gain.linearRampToValueAtTime(0.25 * volume, ctx.currentTime + i * 0.35 + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.35 + 1.6);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + i * 0.35); o.stop(ctx.currentTime + i * 0.35 + 1.7);
    });
    setTimeout(() => ctx.close().catch(() => {}), 4000);
  } catch { /* geen geluid mogelijk */ }
}

/** Houdt de gebedstijden in de gaten en laat op het juiste moment de ezan klinken. */
export function useEzan() {
  const { data } = useData();
  const on = data?.settings.ezan_on === "1";
  const [day] = useRemote<PrayerDay | null>(on ? "/prayer" : null, ["settings"], null);
  const [sounds] = useRemote<EzanSound[]>(on ? "/ezan/sounds" : null, ["ezan"], []);
  const [active, setActive] = useState<{ prayer: Prayer; at: string } | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const dayRef = useRef(day); dayRef.current = day;
  const soundsRef = useRef(sounds); soundsRef.current = sounds;
  const settings = data?.settings;
  const settingsRef = useRef(settings); settingsRef.current = settings;
  // Android-app: exacte alarmen voor de komende week, ook als de app dicht is
  useEffect(() => { if (settings) void scheduleEzan(settings, day); }, [settings?.ezan_on, settings?.ezan_prayers, settings?.ezan_adjust, settings?.ezan_method, day?.date, day?.times?.fajr]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!on) return;
    const tick = () => {
      const d = dayRef.current, s = settingsRef.current;
      if (!d || !s || !ezanOnThisDevice()) return;
      const chosen = new Set(s.ezan_prayers.split(",").filter(Boolean));
      const now = Date.now();
      let played: Record<string, number> = {};
      try { played = JSON.parse(sessionStorage.getItem(PLAYED_KEY) ?? "{}"); } catch { /* */ }
      for (const p of EZAN_PRAYERS) {
        if (!chosen.has(p)) continue;
        const t = new Date(d.times[p]).getTime();
        const key = `${d.date}|${p}`;
        // binnen de eerste twee minuten na de gebedstijd, en nog niet geklonken
        if (now >= t && now - t < 2 * 60_000 && !played[key]) {
          played[key] = now;
          try { sessionStorage.setItem(PLAYED_KEY, JSON.stringify(played)); } catch { /* */ }
          start(p, d.times[p]);
          break;
        }
      }
    };
    const start = (p: Prayer, at: string) => {
      const s = settingsRef.current!;
      let soundOf: Record<string, string> = {};
      try { soundOf = JSON.parse(s.ezan_sounds); } catch { /* */ }
      const vol = Math.max(0.05, Math.min(1, Number(s.ezan_volume) / 100));
      const choice = soundOf[p] ?? "";
      setActive({ prayer: p, at });
      if (choice === "silent") return;
      const snd = choice === "chime" ? null : (soundsRef.current.find((x) => x.id === choice) ?? soundsRef.current[0]);
      if (!snd) { chime(vol); return; }
      const a = new Audio(photoUrl(snd.filename)); a.volume = vol;
      audio.current = a;
      a.play().catch(() => chime(vol));
      a.addEventListener("ended", () => setActive((x) => (x?.prayer === p ? null : x)));
    };
    tick();
    const i = setInterval(tick, 10_000);
    return () => clearInterval(i);
  }, [on]);

  const stop = () => { audio.current?.pause(); audio.current = null; setActive(null); };
  return { active, stop };
}

/** Rustige melding over het scherm tijdens de ezan. */
export function EzanOverlay({ prayer, at, onClose }: { prayer: Prayer; at: string; onClose: () => void }) {
  return (
    <div className="ezan" role="dialog" aria-label={t("Gebedstijd")}>
      <div className="ezan-card">
        <span className="ezan-ic" aria-hidden>{PRAYER_ICON[prayer]}</span>
        <small>{t("Gebedstijd")} · {hm(at)}</small>
        <b>{PRAYER_NAME[prayer]} <span className="muted" style={{ fontWeight: 500 }}>· {PRAYER_TR[prayer]}</span></b>
        <p className="ezan-ar" lang="ar" dir="rtl">حَيَّ عَلَى الصَّلَاةِ</p>
        <button className="btn" onClick={onClose}>{t("Stil")}</button>
      </div>
    </div>
  );
}
