/** De manager: ochtendbriefing en avondafsluiting, met voorstellen die je met één tik aanvaardt. */
import { useEffect, useState } from "react";
import { api } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { Briefing, Proposal } from "../types";
import { Avatar, Modal, cvar } from "./ui";
import { speak, stopSpeaking } from "../assistant/speech";
import { todayIso } from "../dates";
import { t } from "../i18n";

const kindNow = (): "morning" | "evening" => (new Date().getHours() >= 17 ? "evening" : "morning");

export function useBriefing(memberId: string | null, kind = kindNow()) {
  const url = `/manager/briefing?kind=${kind}&date=${todayIso()}${memberId ? `&member=${memberId}` : ""}`;
  return useRemote<Briefing | null>(url, ["events", "chores", "meals", "lists", "settings", "members"], null);
}

function ProposalRow({ p, onDone }: { p: Proposal; onDone: (p: Proposal) => void }) {
  const act = useAction();
  const [gone, setGone] = useState(false);
  if (gone) return null;
  const apply = async () => {
    const { id: _id, title: _t, why: _w, ...body } = p; void _id; void _t; void _w;
    const r = await act(() => api.post<{ ok: boolean; message: string }>("/manager/apply", body), undefined);
    if (r) { setGone(true); onDone(p); }
  };
  return (
    <div className="prop">
      <span className="prop-ic" aria-hidden>{p.kind === "plan_meal" ? "🍲" : p.kind === "move_event" ? "🔁" : p.kind === "add_list" ? "🛒" : "💡"}</span>
      <span className="prop-txt"><b>{p.title}</b><small>{p.why}</small></span>
      <span className="prop-btns">
        <button className="btn small" onClick={apply}>{t("Doe het")}</button>
        <button className="iconbtn" aria-label={t("Nee, laat zo")} onClick={() => setGone(true)}>✕</button>
      </span>
    </div>
  );
}

/** Kaart met de briefing van één persoon (of het hele gezin). */
export function BriefingCard({ memberId, compact, onOpen }: { memberId: string | null; compact?: boolean; onOpen?: () => void }) {
  const { data, toast } = useData();
  const [b, reload] = useBriefing(memberId);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => () => stopSpeaking(), []);
  if (!b) return <section className="glass widget-sm brief"><p className="empty">…</p></section>;
  const m = memberId ? data?.members.find((x) => x.id === memberId) : null;
  const say = () => { if (speaking) { stopSpeaking(); setSpeaking(false); return; } setSpeaking(true); speak(b.narration, () => setSpeaking(false)); };
  return (
    <section className={`glass widget-sm brief${b.kind === "evening" ? " evening" : ""}`} style={m ? cvar(m.color) : undefined}>
      <div className="brief-h">
        {m ? <Avatar m={m} size={34} dot={false} /> : <span className="brief-ic" aria-hidden>{b.kind === "morning" ? "☀️" : "🌙"}</span>}
        <h2>{b.title}</h2>
        <button className={`iconbtn brief-say${speaking ? " on" : ""}`} onClick={say} aria-label={speaking ? t("Stop") : t("Voorlezen")}>{speaking ? "❚❚" : "🔊"}</button>
      </div>
      <p className="brief-text" onClick={onOpen}>{b.narration}</p>
      {!compact && b.items.length > 0 && (
        <ul className="brief-items">{b.items.map((i, k) => <li key={k}><span aria-hidden>{i.icon}</span>{i.text}</li>)}</ul>
      )}
      {b.proposals.length > 0 && <div className="props">{b.proposals.map((p) => <ProposalRow key={p.id} p={p} onDone={() => { toast(t("Geregeld ✔")); reload(); }} />)}</div>}
      {compact && (b.items.length > 0 || onOpen) && <button className="linkbtn" onClick={onOpen}>{t("Alles bekijken")}</button>}
    </section>
  );
}

/** Op de hub: de briefing per gezinslid, met tabbladen. */
export function BriefingModal({ onClose }: { onClose: () => void }) {
  const { data } = useData();
  const members = (data?.members ?? []).filter((m) => m.role !== "huisdier");
  const [who, setWho] = useState<string | null>(null);
  const [kind, setKind] = useState<"morning" | "evening">(kindNow());
  return (
    <Modal title={t("De manager")} onClose={onClose} wide>
      <div className="brief-tabs">
        <div className="picks">
          <button type="button" className="pick" aria-pressed={who === null} onClick={() => setWho(null)}>👨‍👩‍👧 {t("Gezin")}</button>
          {members.map((m) => <button type="button" key={m.id} className="pick pick-person" style={cvar(m.color)} aria-pressed={who === m.id} onClick={() => setWho(m.id)}><Avatar m={m} size={22} dot={false} /> {m.name}</button>)}
        </div>
        <div className="seg"><button aria-pressed={kind === "morning"} onClick={() => setKind("morning")}>☀️ {t("Ochtend")}</button><button aria-pressed={kind === "evening"} onClick={() => setKind("evening")}>🌙 {t("Avond")}</button></div>
      </div>
      <BriefingFull memberId={who} kind={kind} />
    </Modal>
  );
}
function BriefingFull({ memberId, kind }: { memberId: string | null; kind: "morning" | "evening" }) {
  const { toast } = useData();
  const [b, reload] = useBriefing(memberId, kind);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => () => stopSpeaking(), []);
  if (!b) return <p className="empty">…</p>;
  return (
    <div className="brief-full">
      <p className="brief-text big">{b.narration} <button className={`iconbtn brief-say${speaking ? " on" : ""}`} onClick={() => { if (speaking) { stopSpeaking(); setSpeaking(false); } else { setSpeaking(true); speak(b.narration, () => setSpeaking(false)); } }} aria-label={t("Voorlezen")}>{speaking ? "❚❚" : "🔊"}</button></p>
      <ul className="brief-items">{b.items.map((i, k) => <li key={k}><span aria-hidden>{i.icon}</span>{i.text}</li>)}{!b.items.length && <li className="muted">{t("Niets bijzonders.")}</li>}</ul>
      {b.proposals.length > 0 && <><h3 className="brief-sub">{t("Voorstellen")}</h3><div className="props">{b.proposals.map((p) => <ProposalRow key={p.id} p={p} onDone={() => { toast(t("Geregeld ✔")); reload(); }} />)}</div></>}
      {b.conflicts > 0 && <p className="hint">⚠️ {t("{n} overlappende afspraak/afspraken gevonden.", { n: b.conflicts })}</p>}
    </div>
  );
}
