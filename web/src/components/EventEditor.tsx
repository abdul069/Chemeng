import { useState } from "react";
import { api } from "../api";
import { useAction, useData } from "../store";
import type { CalEvent, Occurrence, Repeat } from "../types";
import { Confirm, MemberDots, MemberPicks, Modal } from "./ui";
import { addDays, cap, diffDays, fmtRange, longDate } from "../dates";
import { t } from "../i18n";
import { LinkButtons } from "./Connectors";
import { getDevice } from "../device";

const REPEATS: [Repeat, string][] = [
  ["none", "Niet"], ["daily", "Elke dag"], ["weekly", "Elke week"], ["biweekly", "Om de twee weken"], ["monthly", "Elke maand"], ["yearly", "Elk jaar"],
];

export interface EditorState { occ?: Occurrence; defaults?: Partial<CalEvent> }

export function EventEditor({ state, onClose }: { state: EditorState; onClose: () => void }) {
  const { occ, defaults } = state;
  const { data } = useData();
  const act = useAction();
  const isNew = !occ;
  const [f, setF] = useState(() => ({
    title: occ?.title ?? defaults?.title ?? "",
    date: occ?.on ?? defaults?.date ?? new Date().toISOString().slice(0, 10),
    endDate: occ ? (occ.until !== occ.on ? occ.until : "") : defaults?.endDate ?? "",

    allDay: occ?.allDay ?? defaults?.allDay ?? false,
    startTime: occ?.startTime ?? defaults?.startTime ?? "17:00",
    endTime: occ?.endTime ?? defaults?.endTime ?? "18:00",
    repeat: (occ?.repeat ?? defaults?.repeat ?? "none") as Repeat,
    repeatUntil: occ?.repeatUntil ?? defaults?.repeatUntil ?? "",
    members: occ?.members ?? defaults?.members ?? [],
    location: occ?.location ?? defaults?.location ?? "",
    notes: occ?.notes ?? defaults?.notes ?? "",
    countdown: occ?.countdown ?? false,
  }));
  const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState<null | "save" | "delete">(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  if (occ?.readOnly) {
    const cal = data?.calendars.find((c) => c.id === occ.source);
    const owner = occ.source === "shared" ? data?.shared.find((p) => p.id === occ.members[0]) : undefined;
    return (
      <Modal title={occ.title} onClose={onClose}>
        <p className="hint">{cap(longDate(occ.on))} · {fmtRange(occ)}{occ.location ? ` · ${occ.location}` : ""}</p>
        {occ.location && <LinkButtons kind="event" address={occ.location} title={occ.title} memberId={getDevice().memberId ?? data?.me.memberId ?? null} />}
        {occ.notes && <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{occ.notes}</p>}
        <MemberDots ids={occ.members} />
        <p className="hint">{occ.source === "holiday"
          ? t("Feestdag, automatisch in de kalender gezet. Uit te zetten bij Instellingen → Gekoppelde agenda's.")
          : owner
          ? `${t("Uit de agenda die {n} met je deelt.", { n: owner.name })}${owner.level === "bezet" ? ` ${t("{n} deelt alleen wanneer hij of zij bezet is.", { n: owner.name })}` : ""}`
          : t("Uit de gekoppelde agenda “{n}”. Pas deze afspraak aan in die agenda; ze wordt hier automatisch bijgewerkt.", { n: cal?.name ?? t("extern") })}</p>
        <div className="actions"><button className="btn" onClick={onClose}>{t("Sluiten")}</button></div>
      </Modal>
    );
  }

  // Bij "hele reeks" schuift een gewijzigde datum de hele reeks mee op.
  const seriesShift = (d: string) => (occ && occ.date !== occ.on ? addDays(occ.date, diffDays(occ.on, d)) : d);
  const body = (scope: "all" | "one") => ({
    title: f.title.trim(), date: scope === "all" ? seriesShift(f.date) : f.date,
    endDate: f.endDate ? (scope === "all" ? seriesShift(f.endDate) : f.endDate) : null, allDay: f.allDay, startTime: f.allDay ? null : f.startTime, endTime: f.allDay ? null : f.endTime,
    repeat: scope === "one" ? "none" : f.repeat, repeatUntil: f.repeatUntil || null, members: f.members, location: f.location, notes: f.notes, countdown: f.countdown,
    scope, on: occ?.on,
  });

  const save = async (scope: "all" | "one") => {
    if (!f.title.trim()) { setErr("Geef de afspraak een titel."); return; }
    if (f.endDate && f.endDate < f.date) { setErr("De einddatum ligt voor de begindatum."); return; }
    const ok = await act(() => (isNew ? api.post("/events", body("all")) : api.put(`/events/${occ!.id}`, body(scope))), isNew ? t("Afspraak toegevoegd") : t("Afspraak bewaard"));
    if (ok) onClose();
  };
  const remove = async (scope: "all" | "one" | "following") => {
    const ok = await act(() => api.del(`/events/${occ!.id}?scope=${scope}&on=${occ!.on}`), t("Afspraak verwijderd"));
    if (ok) onClose();
  };
  const series = !!occ && occ.repeat !== "none";

  return (
    <>
      <Modal title={isNew ? t("Nieuwe afspraak") : t("Afspraak")} onClose={onClose}>
        <label className="field"><span>{t("Titel")}</span><input id="ev-title" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder={t("bv. Volleybaltraining")} /></label>
        <div className="row2">
          <label className="field"><span>{t("Datum")}</span><input id="ev-date" type="date" value={f.date} onChange={(e) => set("date", e.target.value)} /></label>
          <label className="field"><span>{t("Herhalen")}</span>
            <select id="ev-repeat" value={f.repeat} onChange={(e) => set("repeat", e.target.value as Repeat)}>
              {REPEATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>
        <label className="check-row"><input id="ev-allday" type="checkbox" checked={f.allDay} onChange={(e) => set("allDay", e.target.checked)} />{" "}{t("Hele dag")}</label>
        {f.allDay ? (
          <label className="field"><span>{t("Tot en met (optioneel, voor meerdere dagen)")}</span><input id="ev-enddate" type="date" value={f.endDate} min={f.date} onChange={(e) => set("endDate", e.target.value)} /></label>
        ) : (
          <div className="row2">
            <label className="field"><span>{t("Van")}</span><input id="ev-start" type="time" value={f.startTime} onChange={(e) => set("startTime", e.target.value)} /></label>
            <label className="field"><span>{t("Tot")}</span><input id="ev-end" type="time" value={f.endTime} onChange={(e) => set("endTime", e.target.value)} /></label>
          </div>
        )}
        {f.repeat !== "none" && (
          <label className="field"><span>{t("Herhalen tot en met (optioneel)")}</span><input id="ev-until" type="date" value={f.repeatUntil} min={f.date} onChange={(e) => set("repeatUntil", e.target.value)} /></label>
        )}
        <div className="field"><span>{t("Voor wie")}</span><MemberPicks value={f.members} onChange={(v) => set("members", v)} /></div>
        <label className="check-row"><input id="ev-cd" type="checkbox" checked={f.countdown} onChange={(e) => set("countdown", e.target.checked)} />{" "}{t("Aftellen tonen op het startscherm (vakantie, feest, grote dag)")}</label>
        <label className="field"><span>{t("Locatie")}</span><input id="ev-loc" value={f.location} onChange={(e) => set("location", e.target.value)} placeholder={t("Optioneel")} /></label>
        {!isNew && occ?.location && occ.location === f.location && <LinkButtons kind="event" address={occ.location} title={occ.title} memberId={getDevice().memberId ?? data?.me.memberId ?? null} />}
        <label className="field"><span>{t("Notities")}</span><textarea id="ev-notes" value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder={t("Optioneel")} /></label>
        {err && <p className="error">{err}</p>}
        <div className="actions">
          {!isNew && <button className="btn danger left" onClick={() => (series ? setAsk("delete") : remove("all"))}>{t("Verwijderen")}</button>}
          <button className="btn ghost" onClick={onClose}>{t("Annuleren")}</button>
          <button className="btn" onClick={() => (series ? setAsk("save") : save("all"))}>{t("Bewaren")}</button>
        </div>
      </Modal>
      {ask === "save" && (
        <Confirm title={t("Herhalende afspraak aanpassen")} text={t("Wil je enkel deze dag aanpassen of de hele reeks?")} onClose={() => setAsk(null)}
          actions={[{ label: t("Alleen deze dag"), kind: "ghost", run: () => save("one") }, { label: t("Hele reeks"), run: () => save("all") }]} />
      )}
      {ask === "delete" && (
        <Confirm title={t("Herhalende afspraak verwijderen")} text={t("Wat wil je verwijderen vanaf {d}?", { d: longDate(occ!.on) })} onClose={() => setAsk(null)}
          actions={[
            { label: t("Alleen deze dag"), kind: "ghost", run: () => remove("one") },
            { label: t("Deze en volgende"), kind: "ghost", run: () => remove("following") },
            { label: t("Hele reeks"), run: () => remove("all") },
          ]} />
      )}
    </>
  );
}
