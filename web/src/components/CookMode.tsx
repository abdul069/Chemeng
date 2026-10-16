import { useEffect, useRef, useState } from "react";
import { useTimers, fmtLeft } from "./Timers";

/** Minuten in een stap: "20 dakika", "15-20 min", "een halfuur" → voor de kookwekker. */
export function minutesIn(step: string): number | null {
  const m = step.match(/(\d+)(?:\s*[-–]\s*(\d+))?\s*(dakika|dk\.?|minuten|minuut|min\.?)\b/i);
  if (m) return Number(m[2] ?? m[1]);
  if (/yarım saat|half ?uur|halfuur/i.test(step)) return 30;
  const h = step.match(/(\d+)\s*(saat|uur)\b/i);
  if (h) return Number(h[1]) * 60;
  return null;
}

/** Kookmodus: één stap per scherm in grote letters, scherm blijft aan, kookwekker uit de stap zelf. */
export function CookMode({ title, ingredients, steps, onClose }: { title: string; ingredients: string[]; steps: string[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [showIngr, setShowIngr] = useState(false);
  const { timers, now, addTimer } = useTimers();
  const step = steps[i] ?? "";
  const mins = minutesIn(step);
  const own = timers.filter((t) => t.label === title);

  // scherm wakker houden tijdens het koken (één keer aanvragen, bij sluiten vrijgeven)
  const latest = useRef({ onClose, n: steps.length });
  latest.current = { onClose, n: steps.length };
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null; let closed = false;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request("screen").then((l) => { if (closed) l.release().catch(() => {}); else lock = l; }).catch(() => {});
    const onKey = (e: KeyboardEvent) => { if (e.key === "ArrowRight") setI((x) => Math.min(latest.current.n - 1, x + 1)); if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1)); if (e.key === "Escape") latest.current.onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { closed = true; lock?.release().catch(() => {}); window.removeEventListener("keydown", onKey); };
  }, []);

  return (
    <div className="cook" role="dialog" aria-modal="true" aria-label={`Kookmodus: ${title}`}>
      <header className="cook-h">
        <b>{title}</b>
        <span className="muted num">stap {i + 1} / {steps.length}</span>
        <button className="pill" onClick={() => setShowIngr((v) => !v)} aria-pressed={showIngr}>🧂 Ingrediënten</button>
        <button className="iconbtn" onClick={onClose} aria-label="Kookmodus sluiten">✕</button>
      </header>
      <div className="cook-progress"><i style={{ width: `${((i + 1) / Math.max(steps.length, 1)) * 100}%` }} /></div>
      <div className="cook-body">
        {showIngr && <aside className="cook-ingr"><ul>{ingredients.map((x, k) => <li key={k}>{x}</li>)}</ul></aside>}
        <main className="cook-step" onClick={() => setI((x) => Math.min(steps.length - 1, x + 1))}>
          <p>{step.replace(/^\d+[.)]\s*/, "").replace(/^—\s*|\s*—$/g, "")}</p>
          {mins && <button className="btn accent" onClick={(e) => { e.stopPropagation(); addTimer(mins, title); }}>⏱ Wekker {mins} min</button>}
          {own.map((t) => <span key={t.id} className="badge cook-timer">⏱ {fmtLeft(t.endsAt - now)}</span>)}
        </main>
      </div>
      <footer className="cook-f">
        <button className="btn ghost" onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0}>‹ Vorige</button>
        {i < steps.length - 1
          ? <button className="btn" onClick={() => setI((x) => x + 1)}>Volgende ›</button>
          : <button className="btn accent" onClick={onClose}>Klaar, smakelijk! 🎉</button>}
      </footer>
    </div>
  );
}
