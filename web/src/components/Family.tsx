/** Gezinsnetwerk: wat de verbonden gezinnen (oma, co-ouder, familie ver weg) met ons delen, en briefjes naar hen sturen. */
import { useState } from "react";
import { api, photoUrl } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { FamilyCard, FamilyLink, ShareKind } from "../types";
import { Fold, Modal } from "./ui";
import { NOTE_COLORS } from "./Prikbord";
import { relDay, fmtTime } from "../dates";
import { getDevice } from "../device";
import { t } from "../i18n";

const SHARES: { id: ShareKind; icon: string; label: string }[] = [
  { id: "events", icon: "📅", label: "Agenda (titels en uren)" }, { id: "photos", icon: "🖼️", label: "Foto's" }, { id: "notes", icon: "📌", label: "Prikbord" }, { id: "birthdays", icon: "🎂", label: "Verjaardagen" },
];

function SendNote({ card, onClose }: { card: FamilyCard; onClose: () => void }) {
  const { data } = useData();
  const act = useAction();
  const dev = getDevice();
  const me = data?.members.find((m) => m.id === (dev.memberId ?? data.me.memberId));
  const [text, setText] = useState(""); const [color, setColor] = useState("geel");
  const bg = NOTE_COLORS.find((c) => c.id === color)?.bg;
  return (
    <Modal title={t("Briefje naar {n}", { n: card.name })} onClose={onClose}>
      <textarea className="note-input" style={{ background: bg }} value={text} autoFocus rows={4} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder={t("bv. Zondag komen we eten! 🍲")} />
      <div className="picks">{NOTE_COLORS.map((c) => <button type="button" key={c.id} className="swatch" style={{ background: c.bg }} aria-pressed={color === c.id} aria-label={t(c.label)} onClick={() => setColor(c.id)} />)}</div>
      <p className="hint">{t("Komt op hun prikbord met jouw naam en de naam van ons gezin erbij.")}</p>
      <div className="actions"><button className="btn ghost" onClick={onClose}>{t("Annuleren")}</button><button className="btn" disabled={!text.trim()} onClick={async () => { if (await act(() => api.post(`/family/links/${card.linkId}/note`, { text: text.trim(), color, author: me?.name ?? "" }), t("Briefje verstuurd 💌"))) onClose(); }}>{t("Versturen")}</button></div>
    </Modal>
  );
}

function Card({ c }: { c: FamilyCard }) {
  const [send, setSend] = useState(false);
  const bg = (col: string) => NOTE_COLORS.find((x) => x.id === col)?.bg ?? NOTE_COLORS[0].bg;
  return (
    <div className="famcard">
      <div className="fam-h">
        <span className="fam-avs">{c.members.slice(0, 4).map((m) => <span key={m.id} className="avatar initial" style={{ "--c": m.color, "--size": "26px", backgroundImage: m.photo ? `url(${photoUrl(m.photo)})` : undefined } as React.CSSProperties}>{m.photo ? "" : m.name.charAt(0)}</span>)}</span>
        <b>{c.name}</b>
        <button className="btn small ghost" onClick={() => setSend(true)}>💌 {t("Briefje")}</button>
      </div>
      {c.birthdays.slice(0, 2).map((b) => <div className="fam-line" key={b.name}><span>🎂</span>{b.days === 0 ? t("{n} is vandaag jarig!", { n: b.name }) : b.days === 1 ? t("{n} is morgen jarig", { n: b.name }) : t("{n} is over {d} dagen jarig", { n: b.name, d: b.days })}{b.age ? ` (${b.age})` : ""}</div>)}
      {c.events.slice(0, 4).map((e, i) => <div className="fam-line" key={i}><span>{e.allDay ? "📌" : "🕐"}</span><small className="muted">{relDay(e.on)}{e.allDay ? "" : ` ${fmtTime(e.startTime)}`}</small> {e.title}</div>)}
      {c.notes.slice(0, 2).map((n) => <div className="fam-note" key={n.id} style={{ background: bg(n.color) }}>{n.text}{n.author && <small> — {n.author}</small>}</div>)}
      {c.photos.length > 0 && <div className="fam-photos">{c.photos.slice(0, 3).map((p) => <img key={p.id} src={photoUrl(p.filename)} alt="" loading="lazy" />)}</div>}
      {!c.events.length && !c.notes.length && !c.photos.length && !c.birthdays.length && <p className="empty">{c.shares.length ? t("Rustig daar; niets nieuws.") : t("Zij delen nog niets met ons.")}</p>}
      {send && <SendNote card={c} onClose={() => setSend(false)} />}
    </div>
  );
}

/** Widget voor het Bord en Mijn dag. Toont niets als er geen verbonden gezinnen zijn. */
export function FamilyWidget() {
  const [feed] = useRemote<FamilyCard[]>("/family/feed", ["family", "notes", "settings"], []);
  if (!feed.length) return null;
  return (
    <section className="glass widget-sm family">
      <div className="widget-h"><h2>{t("Familie")}</h2></div>
      <div className="famcards">{feed.map((c) => <Card key={c.linkId} c={c} />)}</div>
    </section>
  );
}

/** Instellingen → Verbonden gezinnen */
export function FamilySection() {
  const { data, toast } = useData();
  const act = useAction();
  const [links] = useRemote<FamilyLink[]>("/family/links", ["family", "settings"], []);
  const [url, setUrl] = useState<string | null>(null);
  const admin = data?.me.role === "beheerder";
  const invite = async () => { const r = await act(() => api.post<{ url: string }>("/invites", { kind: "link", label: t("Gezin verbinden") })); if (r) setUrl(r.url); };
  const toggle = (l: FamilyLink, k: ShareKind) => act(() => api.put(`/family/links/${l.id}/share`, { share: l.myShare.includes(k) ? l.myShare.filter((x) => x !== k) : [...l.myShare, k] }));
  return (
    <Fold title={t("Verbonden gezinnen")} hint={t("oma, co-ouder, familie ver weg")} action={admin && <button className="btn small" onClick={invite}>+ {t("Gezin verbinden")}</button>}>
      <p className="hint">{t("Verbind dit gezin met een ander huis: de grootouders met hun eigen scherm, een co-ouder, of familie in het buitenland. Elk gezin kiest zelf wat het deelt. Het andere huis ziet het op zijn Bord en kan briefjes terugsturen.")}</p>
      {links.map((l) => (
        <div className="linkrow" key={l.id}>
          <div className="link-h"><b>🏠 {l.otherName}</b>{admin && <button className="iconbtn" aria-label={t("Verbinding verbreken")} onClick={() => act(() => api.del(`/family/links/${l.id}`), t("Verbinding verbroken"))}>✕</button>}</div>
          <div className="field"><span>{t("Wij delen met hen")}</span>
            <div className="picks">{SHARES.map((s) => <button type="button" key={s.id} className="pick" aria-pressed={l.myShare.includes(s.id)} disabled={!admin} onClick={() => toggle(l, s.id)}>{s.icon} {t(s.label)}</button>)}</div>
          </div>
          <small className="muted">{t("Zij delen met ons")}: {l.theirShare.length ? l.theirShare.map((k) => t(SHARES.find((s) => s.id === k)!.label)).join(", ") : t("niets")}</small>
        </div>
      ))}
      {!links.length && <p className="empty">{t("Nog geen verbonden gezinnen.")}</p>}
      {url && (
        <Modal title={t("Gezin verbinden")} onClose={() => setUrl(null)}>
          <p className="hint">{t("Stuur deze link naar een beheerder van het andere gezin. Die meldt zich aan in zijn eigen {brand} en aanvaardt. De link werkt één keer en is 7 dagen geldig.")}</p>
          <div className="linkbox"><code>{url}</code></div>
          <div className="actions" style={{ justifyContent: "flex-start" }}>
            <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(url); toast(t("Link gekopieerd")); } catch { /* */ } }}>{t("Link kopiëren")}</button>
            <a className="btn ghost" href={`https://wa.me/?text=${encodeURIComponent(`${t("Verbind jullie {brand} met het onze")}: ${url}`)}`} target="_blank" rel="noreferrer">WhatsApp</a>
          </div>
        </Modal>
      )}
    </Fold>
  );
}
