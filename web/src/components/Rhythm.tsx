/** Ritme per persoon: eigen taal, ploegenrooster, stille uren en doelen voor tieners. */
import { useEffect, useState } from "react";
import { api } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { Goal, Member, QuietWindow, Shift, ShiftWeek } from "../types";
import { Modal } from "./ui";
import { todayIso } from "../dates";
import { t } from "../i18n";

const DAY_SHORT = ["zo", "ma", "di", "wo", "do", "vr", "za"];
const LANG_PICKS: { id: string; label: string }[] = [{ id: "", label: "Zoals het gezin" }, { id: "nl", label: "🇳🇱 Nederlands" }, { id: "tr", label: "🇹🇷 Türkçe" }, { id: "en", label: "🇬🇧 English" }];

export interface RhythmFields { lang: string; teenMode: string; quietFrom: string; quietUntil: string; sleepHours: number }
export const rhythmOf = (m?: Member): RhythmFields => ({ lang: m?.lang ?? "", teenMode: m?.teenMode ?? "", quietFrom: m?.quietFrom ?? "", quietUntil: m?.quietUntil ?? "", sleepHours: m?.sleepHours ?? 8 });

/** Velden in de ledenbewerker: taal, tienermodus en stille uren. */
export function RhythmFieldsEditor({ f, set, role, member }: { f: RhythmFields; set: (p: Partial<RhythmFields>) => void; role: string; member?: Member }) {
  const [shifts, setShifts] = useState(false);
  return (
    <>
      <div className="field"><span>{t("Taal op de eigen telefoon")}</span>
        <div className="picks">{LANG_PICKS.map((l) => <button key={l.id} type="button" className="pick" aria-pressed={f.lang === l.id} onClick={() => set({ lang: l.id })}>{t(l.label)}</button>)}</div>
        <small className="muted">{t("Meldingen, briefing en assistent komen in deze taal. Het gezinsscherm blijft in de taal van het gezin.")}</small>
      </div>
      {role === "kind" && (
        <div className="field"><span>{t("Tienermodus")}</span>
          <div className="picks">
            {[["", t("Vanzelf vanaf 13 jaar")], ["1", t("Aan")], ["0", t("Uit")]].map(([id, label]) => <button key={id} type="button" className="pick" aria-pressed={f.teenMode === id} onClick={() => set({ teenMode: id })}>{label}</button>)}
          </div>
          <small className="muted">{t("Geen sterren en stickers, wel eigen doelen zoals rijlessen of sparen.")}</small>
        </div>
      )}
      <div className="field"><span>{t("Stille uren (geen meldingen)")}</span>
        <div className="addrow">
          <input type="time" aria-label={t("Van")} value={f.quietFrom} onChange={(e) => set({ quietFrom: e.target.value })} />
          <span>–</span>
          <input type="time" aria-label={t("Tot")} value={f.quietUntil} onChange={(e) => set({ quietUntil: e.target.value })} />
          {(f.quietFrom || f.quietUntil) && <button type="button" className="btn ghost small" onClick={() => set({ quietFrom: "", quietUntil: "" })}>{t("Wissen")}</button>}
        </div>
      </div>
      {role === "ouder" && member && (
        <div className="field"><span>{t("Ploegenwerk")}</span>
          <div className="addrow">
            <button type="button" className="btn ghost small" onClick={() => setShifts(true)}>🏭 {t("Ploegenrooster instellen")}</button>
            <label className="inline">{t("Slaapt na een nachtdienst")} <select value={f.sleepHours} onChange={(e) => set({ sleepHours: Number(e.target.value) })}>{[5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n} {t("uur")}</option>)}</select></label>
          </div>
          <small className="muted">{t("Na een nachtdienst zijn de meldingen vanzelf stil tot de slaap voorbij is, en het Bord toont dat er iemand slaapt.")}</small>
        </div>
      )}
      {shifts && member && <ShiftEditor member={member} onClose={() => setShifts(false)} />}
    </>
  );
}

/** Een ploegenrooster dat je één keer instelt: welke dienst in week 1, week 2, … en dat herhaalt zich. */
export function ShiftEditor({ member, onClose }: { member: Member; onClose: () => void }) {
  const act = useAction();
  const [data] = useRemote<{ shifts: Shift[]; presets: Record<string, { label: string; weeks: ShiftWeek[] }> } | null>("/shifts", ["events"], null);
  const existing = data?.shifts.find((s) => s.memberId === member.id);
  const [weeks, setWeeks] = useState<ShiftWeek[] | null>(null);
  const [start, setStart] = useState(todayIso());
  useEffect(() => { if (existing && !weeks) { setWeeks(existing.weeks); setStart(existing.startDate); } }, [existing, weeks]);
  const upd = (i: number, p: Partial<ShiftWeek>) => setWeeks((w) => w!.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const save = async () => { if (weeks && await act(() => (existing ? api.put(`/shifts/${existing.id}`, { memberId: member.id, startDate: start, weeks }) : api.post("/shifts", { memberId: member.id, startDate: start, weeks })), t("Rooster bewaard"))) onClose(); };
  return (
    <Modal title={t("Ploegenrooster van {n}", { n: member.name })} onClose={onClose}>
      {!weeks ? (
        <>
          <p className="hint">{t("Kies het rooster dat het meest lijkt. De uren pas je daarna aan.")}</p>
          <div className="upnext">{data && Object.entries(data.presets).map(([k, p]) => <button key={k} className="item" onClick={() => setWeeks(p.weeks)}><span style={{ flex: 1 }}><b>{t(p.label)}</b><small>{p.weeks.map((w) => `${w.icon} ${t(w.name)}`).join(" → ")}</small></span></button>)}</div>
        </>
      ) : (
        <>
          <label className="field"><span>{t("Eerste week van het rooster (week 1)")}</span><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          {weeks.map((w, i) => (
            <div className="linkrow" key={i}>
              <div className="link-h"><b>{t("Week {n}", { n: i + 1 })}</b>{weeks.length > 1 && <button className="iconbtn" aria-label={t("Week weghalen")} onClick={() => setWeeks(weeks.filter((_, j) => j !== i))}>✕</button>}</div>
              <div className="addrow">
                <input value={w.icon} onChange={(e) => upd(i, { icon: e.target.value })} style={{ width: 56, flex: "none", textAlign: "center" }} aria-label={t("Icoon")} />
                <input value={w.name} onChange={(e) => upd(i, { name: e.target.value })} aria-label={t("Naam")} />
              </div>
              <div className="addrow">
                <input type="time" value={w.start ?? ""} onChange={(e) => upd(i, { start: e.target.value || null })} aria-label={t("Begin")} />
                <span>–</span>
                <input type="time" value={w.end ?? ""} onChange={(e) => upd(i, { end: e.target.value || null })} aria-label={t("Einde")} />
                {w.start && w.end && w.end <= w.start && <small className="muted">🌙 {t("tot de volgende ochtend")}</small>}
              </div>
              <div className="picks">{[1, 2, 3, 4, 5, 6, 0].map((d) => <button key={d} type="button" className="pick" aria-pressed={w.days.includes(d)} onClick={() => upd(i, { days: w.days.includes(d) ? w.days.filter((x) => x !== d) : [...w.days, d] })}>{t(DAY_SHORT[d])}</button>)}</div>
            </div>
          ))}
          {weeks.length < 8 && <button className="btn ghost small" onClick={() => setWeeks([...weeks, { name: t("Vrije week"), icon: "🏖️", start: null, end: null, days: [] }])}>+ {t("Week")}</button>}
          <p className="hint">{t("Het rooster herhaalt zich: na de laatste week begint week 1 opnieuw. De diensten staan in de agenda en de briefing.")}</p>
          <div className="actions">
            {existing && <button className="btn danger left" onClick={async () => { if (await act(() => api.del(`/shifts/${existing.id}`), t("Rooster verwijderd"))) onClose(); }}>{t("Verwijderen")}</button>}
            <button className="btn ghost" onClick={onClose}>{t("Annuleren")}</button>
            <button className="btn" onClick={save} disabled={!weeks.length}>{t("Bewaren")}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

/** Op het Bord: wie slaapt er nu (na een nachtdienst) of wil stilte? */
export function QuietChips() {
  const { member } = useData();
  const [quiet, reload] = useRemote<QuietWindow[]>("/quiet", ["members", "events"], []);
  useEffect(() => { const i = setInterval(reload, 5 * 60_000); return () => clearInterval(i); }, [reload]);
  return (
    <>
      {quiet.map((q) => { const m = member(q.memberId); return m ? <span key={q.memberId} className="bord-wx" title={q.reason === "night" ? t("Na de nachtdienst") : t("Stille uren")}>{q.reason === "night" ? "😴" : "🔕"} {q.reason === "night" ? t("{n} slaapt tot {u}", { n: m.name, u: q.until }) : t("{n} stil tot {u}", { n: m.name, u: q.until })}</span> : null; })}
    </>
  );
}

/** Doelen voor een tiener: rijlessen tellen, sparen, stage-uren. */
export function GoalsPanel({ member }: { member: Member }) {
  const act = useAction();
  const [data] = useRemote<{ goals: Goal[]; templates: { title: string; icon: string; kind: "money" | "count"; target: number; unit: string }[] } | null>(`/goals?memberId=${member.id}`, ["rewards"], null);
  const [add, setAdd] = useState(false);
  const [entry, setEntry] = useState<Goal | null>(null);
  const goals = data?.goals ?? [];
  const fmt = (g: Goal, n: number) => (g.kind === "money" ? `€ ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : `${n} ${t(g.unit)}`);
  return (
    <section className="glass widget-sm goals">
      <div className="widget-h"><h2>{t("Doelen")}</h2><button className="linkbtn" onClick={() => setAdd(true)}>+ {t("Doel")}</button></div>
      {!goals.length && <p className="empty">{t("Nog geen doelen. Rijlessen, sparen voor iets moois, stage-uren…")}</p>}
      {goals.map((g) => {
        const pct = Math.min(100, Math.round((g.progress / g.target) * 100));
        return (
          <div className="goal" key={g.id}>
            <div className="goal-h"><span className="goal-ic" aria-hidden>{g.icon}</span><b>{t(g.title)}</b><small className="muted">{fmt(g, g.progress)} / {fmt(g, g.target)}</small></div>
            <div className="kid-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>
            <div className="addrow">
              {g.doneAt ? <span>🎉 {t("Gehaald!")}</span> : g.kind === "count"
                ? <button className="btn small" onClick={() => act(() => api.post(`/goals/${g.id}/entries`, { amount: 1, note: "", date: todayIso() }), t("Genoteerd"))}>+1 {t(g.unit)}</button>
                : <button className="btn small" onClick={() => setEntry(g)}>+ {t("Bedrag")}</button>}
              <button className="btn ghost small" onClick={() => act(() => api.del(`/goals/${g.id}`), t("Doel verwijderd"))}>{t("Weghalen")}</button>
            </div>
          </div>
        );
      })}
      {add && data && <GoalAdd member={member} templates={data.templates} onClose={() => setAdd(false)} />}
      {entry && <MoneyEntry goal={entry} onClose={() => setEntry(null)} />}
    </section>
  );
}
function GoalAdd({ member, templates, onClose }: { member: Member; templates: { title: string; icon: string; kind: "money" | "count"; target: number; unit: string }[]; onClose: () => void }) {
  const act = useAction();
  const [f, setF] = useState(templates[0]);
  const save = async () => { if (await act(() => api.post("/goals", { memberId: member.id, ...f, title: t(f.title), unit: t(f.unit) }), t("Doel toegevoegd"))) onClose(); };
  return (
    <Modal title={t("Nieuw doel")} onClose={onClose}>
      <div className="picks">{templates.map((x) => <button key={x.title} type="button" className="pick" aria-pressed={f.title === x.title} onClick={() => setF(x)}>{x.icon} {t(x.title)}</button>)}</div>
      <div className="row2">
        <label className="field"><span>{t("Naam")}</span><input value={t(f.title)} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="field"><span>{f.kind === "money" ? t("Bedrag (€)") : t("Aantal ({u})", { u: t(f.unit) })}</span><input type="number" min={1} value={f.target} onChange={(e) => setF({ ...f, target: Number(e.target.value) || 1 })} /></label>
      </div>
      <div className="actions"><button className="btn ghost" onClick={onClose}>{t("Annuleren")}</button><button className="btn" onClick={save}>{t("Toevoegen")}</button></div>
    </Modal>
  );
}
function MoneyEntry({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const act = useAction();
  const [n, setN] = useState("");
  const save = async (sign: 1 | -1) => { const v = Number(n.replace(",", ".")); if (v > 0 && await act(() => api.post(`/goals/${goal.id}/entries`, { amount: sign * v, note: "", date: todayIso() }), t("Genoteerd"))) onClose(); };
  return (
    <Modal title={`${goal.icon} ${goal.title}`} onClose={onClose}>
      <label className="field"><span>{t("Bedrag (€)")}</span><input inputMode="decimal" autoFocus value={n} onChange={(e) => setN(e.target.value)} /></label>
      <div className="actions"><button className="btn ghost" onClick={() => save(-1)}>{t("Uitgegeven")}</button><button className="btn" onClick={() => save(1)}>{t("Gespaard")}</button></div>
    </Modal>
  );
}
