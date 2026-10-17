import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { t as tr } from "../i18n";

// Kookwekkers en wekkers lopen op dit toestel, ook als je een ander scherm opent.
export interface Timer { id: string; label: string; endsAt: number; total: number }
export interface Alarm { id: string; time: string; label: string; days: number[]; on: boolean }
interface Ringing { id: string; label: string; kind: "timer" | "alarm" }

interface Ctx {
  timers: Timer[]; alarms: Alarm[]; now: number;
  addTimer: (minutes: number, label?: string) => void;
  removeTimer: (id: string) => void;
  saveAlarm: (a: Alarm) => void;
  removeAlarm: (id: string) => void;
}
const C = createContext<Ctx | null>(null);
export const useTimers = () => { const c = useContext(C); if (!c) throw new Error("useTimers"); return c; };

const load = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? "") as T; } catch { return d; } };
const store = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } };
const uid = () => Math.random().toString(36).slice(2, 9);

/** Een vriendelijke belsignaal-lus met de Web Audio API (geen geluidsbestand nodig). */
function useChime() {
  const ctx = useRef<AudioContext | null>(null);
  const loop = useRef<number>(0);
  const start = useCallback(() => {
    try {
      ctx.current ??= new AudioContext();
      const a = ctx.current;
      const ding = () => {
        [880, 1175, 1568].forEach((f, i) => {
          const o = a.createOscillator();
          const g = a.createGain();
          o.type = "sine";
          o.frequency.value = f;
          const t = a.currentTime + i * 0.18;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
          o.connect(g).connect(a.destination);
          o.start(t);
          o.stop(t + 0.65);
        });
      };
      ding();
      clearInterval(loop.current);
      loop.current = window.setInterval(ding, 1600);
    } catch { /* geen geluid mogelijk */ }
  }, []);
  const stop = useCallback(() => clearInterval(loop.current), []);
  return { start, stop };
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const [timers, setTimers] = useState<Timer[]>(() => load("gb.timers", []));
  const [alarms, setAlarms] = useState<Alarm[]>(() => load("gb.alarms", []));
  const [now, setNow] = useState(Date.now());
  const [ringing, setRinging] = useState<Ringing[]>([]);
  const fired = useRef<Set<string>>(new Set());
  const chime = useChime();

  useEffect(() => store("gb.timers", timers), [timers]);
  useEffect(() => store("gb.alarms", alarms), [alarms]);

  useEffect(() => {
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      const d = new Date(n);
      const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      const ring: Ringing[] = [];
      setTimers((ts) => {
        const done = ts.filter((x) => x.endsAt <= n);
        done.forEach((x) => ring.push({ id: x.id, label: x.label || "Kookwekker", kind: "timer" }));
        return done.length ? ts.filter((x) => x.endsAt > n) : ts;
      });
      for (const a of alarms) {
        const key = `${a.id}@${d.toDateString()}`;
        if (a.on && a.time === hm && (!a.days.length || a.days.includes(d.getDay())) && !fired.current.has(key)) {
          fired.current.add(key);
          ring.push({ id: a.id, label: a.label || tr("Wekker {t}", { t: a.time }), kind: "alarm" });
        }
      }
      if (ring.length) setRinging((r) => [...r, ...ring]);
    }, 1000);
    return () => clearInterval(t);
  }, [alarms]);

  useEffect(() => { if (ringing.length) chime.start(); else chime.stop(); }, [ringing.length, chime]);

  const value: Ctx = {
    timers, alarms, now,
    addTimer: (minutes, label = "") => setTimers((t) => [...t, { id: uid(), label, endsAt: Date.now() + minutes * 60_000, total: minutes * 60_000 }]),
    removeTimer: (id) => setTimers((t) => t.filter((x) => x.id !== id)),
    saveAlarm: (a) => setAlarms((all) => (all.some((x) => x.id === a.id) ? all.map((x) => (x.id === a.id ? a : x)) : [...all, { ...a, id: a.id || uid() }])),
    removeAlarm: (id) => setAlarms((a) => a.filter((x) => x.id !== id)),
  };

  return (
    <C.Provider value={value}>
      {children}
      {ringing.length > 0 && (
        <div className="ring" role="alertdialog" aria-label={tr("Wekker gaat af")}>
          <div className="ring-card">
            <div className="ring-bell" aria-hidden>⏰</div>
            {ringing.map((r) => <h2 key={r.id + r.kind}>{r.label}</h2>)}
            <p className="hint">{ringing[0].kind === "timer" ? tr("De tijd is om.") : tr("Tijd!")}</p>
            <div className="actions" style={{ justifyContent: "center" }}>
              {ringing.every((r) => r.kind === "timer") && <button className="btn ghost" onClick={() => { ringing.forEach((r) => value.addTimer(5, r.label)); setRinging([]); }}>{tr("Nog 5 minuten")}</button>}
              <button className="btn" onClick={() => setRinging([])}>{tr("Stoppen")}</button>
            </div>
          </div>
        </div>
      )}
    </C.Provider>
  );
}

export const fmtLeft = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};
