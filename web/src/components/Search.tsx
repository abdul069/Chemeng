import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Modal, Pic } from "./ui";
import { openRecipe } from "./Recipes";
import { cap, fmtTime, longDate } from "../dates";
import { t } from "../i18n";

interface Results {
  events: { id: string; title: string; date: string; startTime: string | null; allDay: boolean; location: string; members: string[] }[];
  recipes: { id: string; title: string; image: string | null; minutes: number | null }[];
  items: { id: string; text: string; done: boolean; list: string; listId: string; icon: string }[];
  chores: { id: string; title: string; icon: string; member: string }[];
  library: { id: string; title: string; titleTr: string; image: string | null; category: string }[];
  libraryTotal: number;
}

/** Zoeken in alles: afspraken, recepten, lijsten, taken en de grote receptenbibliotheek. */
export function Search({ onClose, goto }: { onClose: () => void; goto: (screen: string, extra?: Record<string, string>) => void }) {
  const [q, setQ] = useState("");
  const [r, setR] = useState<Results | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) { setR(null); return; }
    setBusy(true);
    const t = setTimeout(() => api.get<Results>(`/search?q=${encodeURIComponent(s)}`).then(setR).catch(() => setR(null)).finally(() => setBusy(false)), 250);
    return () => clearTimeout(t);
  }, [q]);
  const go = (screen: string, extra?: Record<string, string>) => { onClose(); goto(screen, extra); };
  const empty = r && !r.events.length && !r.recipes.length && !r.items.length && !r.chores.length && !r.library.length;
  return (
    <Modal title={t("Zoeken")} onClose={onClose} wide>
      <input ref={input} id="search-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Zoek een afspraak, recept, boodschap of taak…")} aria-label={t("Zoeken in alles")} />
      {busy && <p className="hint">{t("Zoeken…")}</p>}
      {empty && !busy && <p className="empty">Niets gevonden voor “{q}”.</p>}
      {r && (
        <div className="search-res">
          {r.events.length > 0 && <section><h3>{t("📅 Afspraken")}</h3>{r.events.map((e, i) => (
            <button key={`${e.id}-${e.date}-${i}`} className="sres" onClick={() => go("calendar", { date: e.date })}>
              <b>{e.title}</b><small>{cap(longDate(e.date))}{e.allDay ? "" : ` · ${fmtTime(e.startTime)}`}{e.location ? ` · ${e.location}` : ""}</small>
            </button>))}</section>}
          {r.recipes.length > 0 && <section><h3>{t("🍲 Mijn recepten")}</h3>{r.recipes.map((x) => (
            <button key={x.id} className="sres" onClick={() => { onClose(); openRecipe(x.id); }}>
              <Pic src={x.image} className="simg" phClass="ph" /><b>{x.title}</b><small>{x.minutes ? `${x.minutes} min` : ""}</small>
            </button>))}</section>}
          {r.items.length > 0 && <section><h3>{t("🛒 Lijsten")}</h3>{r.items.map((x) => (
            <button key={x.id} className={`sres${x.done ? t(" done") : ""}`} onClick={() => go("lists", { list: x.listId })}><b>{x.text}</b><small>{x.icon} {x.list}{x.done ? t(" · afgevinkt") : ""}</small></button>))}</section>}
          {r.chores.length > 0 && <section><h3>{t("✅ Taken")}</h3>{r.chores.map((x) => (
            <button key={x.id} className="sres" onClick={() => go("chores")}><b>{x.icon} {x.title}</b><small>{x.member}</small></button>))}</section>}
          {r.library.length > 0 && <section><h3>{t("🇹🇷 Alle Turkse recepten")}{" "}<small className="muted">({r.libraryTotal})</small></h3>{r.library.map((x) => (
            <button key={x.id} className="sres" onClick={() => go("meals", { meals: "recipes", lib: q.trim() })}>
              <Pic src={x.image} className="simg" phClass="ph" /><b>{x.title}</b><small>{x.title !== x.titleTr ? `🇹🇷 ${x.titleTr} · ` : ""}{x.category}</small>
            </button>))}</section>}
        </div>
      )}
    </Modal>
  );
}
