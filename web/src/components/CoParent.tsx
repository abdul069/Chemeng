/** Co-ouderschap: bij wie zijn de kinderen, de overdrachtslijst, een gedeelde kostenpot. Werkt via een verbonden gezin. */
import { useEffect, useState } from "react";
import { api } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { CostPot, Custody, CustodyDay, FamilyLink, Handover } from "../types";
import { Modal } from "./ui";
import { relDay, todayIso } from "../dates";
import { t } from "../i18n";
import { say } from "../speech";

const ITEM_ICONS = ["🎒", "👟", "💊", "🧸", "📚", "👕", "🎮", "🪥", "⚽", "🎻", "📱", "🔑"];
const euro = (n: number) => `€ ${n.toFixed(2).replace(".", ",")}`;

/** Instellingen → Verbonden gezinnen → per verbinding: kinderen in beide huizen, verblijfsregeling, kosten. */
export function LinkCoParent({ link }: { link: FamilyLink }) {
  const act = useAction();
  const { data } = useData();
  const admin = data?.me.role === "beheerder";
  const [kids] = useRemote<{ own: { id: string; name: string; shared: boolean }[]; guests: string[] } | null>(`/family/links/${link.id}/kids`, ["members", "family"], null);
  const [cus] = useRemote<{ custody: Custody | null; presets: Record<string, { label: string; cycle: string }>; overrides: { id: string; from: string; to: string; withMe: boolean; note: string }[] } | null>(`/custody/${link.id}`, ["family", "events"], null);
  const [edit, setEdit] = useState(false);
  const [costs, setCosts] = useState(false);
  const [holiday, setHoliday] = useState(false);
  const anyShared = !!kids && (kids.own.some((k) => k.shared) || kids.guests.length > 0);
  return (
    <div className="coparent">
      {!!kids?.own.length && (
        <div className="field"><span>{t("Onze kinderen ook in dit gezin")}</span>
          <div className="picks">{kids.own.map((k) => <button key={k.id} type="button" className="pick" aria-pressed={k.shared} disabled={!admin} onClick={() => act(() => api.post(`/family/links/${link.id}/kids`, { memberId: k.id, on: !k.shared }), k.shared ? t("{n} alleen nog bij ons", { n: k.name }) : t("{n} staat nu ook bij {o}", { n: k.name, o: link.otherName }))}>{k.name}</button>)}</div>
          <small className="muted">{t("Voor co-ouders: taken, sterren, routines en afspraken van het kind lopen dan in beide huizen door. Het andere huis kan ook afspraken voor het kind inplannen.")}</small>
        </div>
      )}
      {anyShared && (
        <div className="field"><span>{t("Verblijfsregeling")}</span>
          {cus?.custody ? <CustodySummary c={cus.custody} presets={cus.presets} other={link.otherName} /> : <small className="muted">{t("Nog geen regeling: stel in bij wie de kinderen wanneer zijn.")}</small>}
          <div className="addrow">
            {admin && <button className="btn ghost small" onClick={() => setEdit(true)}>🗓️ {cus?.custody ? t("Regeling wijzigen") : t("Regeling instellen")}</button>}
            {cus?.custody && <button className="btn ghost small" onClick={() => setHoliday(true)}>🏖️ {t("Vakantie of uitzondering")}</button>}
            <button className="btn ghost small" onClick={() => setCosts(true)}>💶 {t("Kostenpot")}</button>
          </div>
          {!!cus?.overrides.length && <ul className="plain">{cus.overrides.map((o) => <li key={o.id}>{o.note || t("Uitzondering")}: {o.from} → {o.to} · {o.withMe ? t("bij ons") : t("bij {o}", { o: link.otherName })} <button className="iconbtn" aria-label={t("Weghalen")} onClick={() => act(() => api.del(`/custody/overrides/${o.id}`))}>✕</button></li>)}</ul>}
        </div>
      )}
      {edit && cus && <CustodyEditor link={link} cur={cus.custody} presets={cus.presets} onClose={() => setEdit(false)} />}
      {holiday && <OverrideEditor link={link} onClose={() => setHoliday(false)} />}
      {costs && <CostPotModal link={link} onClose={() => setCosts(false)} />}
    </div>
  );
}

function CustodySummary({ c, presets, other }: { c: Custody; presets: Record<string, { label: string; cycle: string }>; other: string }) {
  const name = Object.values(presets).find((p) => p.cycle === c.cycle || p.cycle.replace(/[ab]/g, (x) => (x === "a" ? "b" : "a")) === c.cycle)?.label;
  return <small className="muted">{name ? t(name) : t("Eigen regeling")} · {t("overdracht om {u}", { u: c.handoverTime })} · {t("kosten {a}% wij, {b}% {o}", { a: c.mySplit, b: 100 - c.mySplit, o: other })}</small>;
}

function CustodyEditor({ link, cur, presets, onClose }: { link: FamilyLink; cur: Custody | null; presets: Record<string, { label: string; cycle: string }>; onClose: () => void }) {
  const act = useAction();
  const flip = (c: string) => c.replace(/[ab]/g, (x) => (x === "a" ? "b" : "a"));
  const curKey = cur ? Object.entries(presets).find(([, p]) => p.cycle === cur.cycle || p.cycle === flip(cur.cycle))?.[0] : undefined;
  const [kind, setKind] = useState(curKey ?? "week");
  const [anchor, setAnchor] = useState(cur?.anchor ?? todayIso());
  const [withMe, setWithMe] = useState(!(cur && curKey && presets[curKey].cycle !== cur.cycle));
  const [time, setTime] = useState(cur?.handoverTime ?? "16:00");
  const [split, setSplit] = useState(cur?.mySplit ?? 50);
  const save = async () => {
    if (await act(() => api.put(`/custody/${link.id}`, { cycle: presets[kind].cycle, anchor, startWithMe: withMe, handoverTime: time, mySplit: split }), t("Regeling bewaard"))) onClose();
  };
  const preview = Array.from({ length: 14 }, (_, i) => { const c = presets[kind].cycle; const s = c[i % c.length]; return withMe ? s === "a" : s === "b"; });
  return (
    <Modal title={t("Verblijfsregeling met {o}", { o: link.otherName })} onClose={onClose}>
      <div className="upnext">{Object.entries(presets).map(([k, p]) => <button key={k} className="item" aria-pressed={kind === k} onClick={() => setKind(k)}><span style={{ flex: 1 }}><b>{t(p.label)}</b></span>{kind === k && "✓"}</button>)}</div>
      <div className="row2">
        <label className="field"><span>{t("Eerste dag van de regeling")}</span><input type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} /></label>
        <label className="field"><span>{t("Uur van de overdracht")}</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
      </div>
      <div className="field"><span>{t("Op die eerste dag zijn de kinderen")}</span>
        <div className="picks"><button type="button" className="pick" aria-pressed={withMe} onClick={() => setWithMe(true)}>{t("bij ons")}</button><button type="button" className="pick" aria-pressed={!withMe} onClick={() => setWithMe(false)}>{t("bij {o}", { o: link.otherName })}</button></div>
      </div>
      <div className="custody-preview" aria-label={t("Voorbeeld van twee weken")}>{preview.map((us, i) => <span key={i} className={us ? "us" : "them"} title={relDay(addIso(anchor, i))}>{us ? "🏠" : "🚗"}</span>)}</div>
      <small className="muted">🏠 {t("bij ons")} · 🚗 {t("bij {o}", { o: link.otherName })}</small>
      <label className="field"><span>{t("Ons deel van de kosten: {n}%", { n: split })}</span><input type="range" min={0} max={100} step={5} value={split} onChange={(e) => setSplit(Number(e.target.value))} /></label>
      <div className="actions">
        {cur && <button className="btn danger left" onClick={async () => { if (await act(() => api.del(`/custody/${link.id}`), t("Regeling verwijderd"))) onClose(); }}>{t("Verwijderen")}</button>}
        <button className="btn ghost" onClick={onClose}>{t("Annuleren")}</button>
        <button className="btn" onClick={save}>{t("Bewaren")}</button>
      </div>
    </Modal>
  );
}
const addIso = (d: string, n: number) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

function OverrideEditor({ link, onClose }: { link: FamilyLink; onClose: () => void }) {
  const act = useAction();
  const [f, setF] = useState({ from: todayIso(), to: todayIso(), withMe: true, note: "" });
  const save = async () => { if (await act(() => api.post(`/custody/${link.id}/overrides`, f), t("Uitzondering bewaard"))) onClose(); };
  return (
    <Modal title={t("Vakantie of uitzondering")} onClose={onClose}>
      <div className="row2">
        <label className="field"><span>{t("Van")}</span><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label className="field"><span>{t("Tot en met")}</span><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
      </div>
      <div className="picks"><button type="button" className="pick" aria-pressed={f.withMe} onClick={() => setF({ ...f, withMe: true })}>{t("bij ons")}</button><button type="button" className="pick" aria-pressed={!f.withMe} onClick={() => setF({ ...f, withMe: false })}>{t("bij {o}", { o: link.otherName })}</button></div>
      <label className="field"><span>{t("Waarom (optioneel)")}</span><input value={f.note} maxLength={80} placeholder={t("bv. Zomervakantie, Kerst")} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
      <div className="actions"><button className="btn ghost" onClick={onClose}>{t("Annuleren")}</button><button className="btn" onClick={save}>{t("Bewaren")}</button></div>
    </Modal>
  );
}

/** Gedeelde kostenpot: wie betaalde wat voor de kinderen, en wie is wie hoeveel schuldig. */
export function CostPotModal({ link, onClose }: { link: FamilyLink; onClose: () => void }) {
  const act = useAction();
  const { data } = useData();
  const [pot] = useRemote<CostPot | null>(`/costs/${link.id}`, ["family"], null);
  const [f, setF] = useState({ title: "", amount: "", memberId: "" });
  const kids = (data?.members ?? []).filter((m) => m.role === "kind");
  const add = async (kind: "cost" | "settle", title = f.title, amount = Number(f.amount.replace(",", "."))) => {
    if (!title.trim() || !(amount > 0)) return;
    if (await act(() => api.post(`/costs/${link.id}`, { title: title.trim(), amount, date: todayIso(), memberId: f.memberId || null, kind }), t("Genoteerd"))) setF({ title: "", amount: "", memberId: "" });
  };
  const b = pot?.balance ?? 0;
  return (
    <Modal title={t("Kostenpot met {o}", { o: link.otherName })} onClose={onClose}>
      {pot && (
        <div className={`pot-balance${b === 0 ? "" : b > 0 ? " plus" : " min"}`}>
          {b === 0 ? t("Alles is verrekend 👍") : b > 0 ? t("{o} is ons {n} schuldig", { o: pot.otherName, n: euro(b) }) : t("Wij zijn {o} {n} schuldig", { o: pot.otherName, n: euro(-b) })}
          <small>{t("Verdeling: {a}% wij, {b}% {o}", { a: pot.mySplit, b: 100 - pot.mySplit, o: pot.otherName })} · {t("dit jaar {n} aan kosten", { n: euro(pot.totalThisYear) })}</small>
          {b < 0 && <button className="btn small" onClick={() => add("settle", t("Terugbetaald"), -b)}>{t("Ik heb {n} terugbetaald", { n: euro(-b) })}</button>}
        </div>
      )}
      <div className="field"><span>{t("Nieuwe kost (wij betaalden)")}</span>
        <div className="addrow">
          <input placeholder={t("bv. Schoolrekening, voetbalschoenen")} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <input inputMode="decimal" placeholder="€" style={{ width: 90 }} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </div>
        {!!kids.length && <div className="picks"><button type="button" className="pick" aria-pressed={!f.memberId} onClick={() => setF({ ...f, memberId: "" })}>{t("Alle kinderen")}</button>{kids.map((k) => <button key={k.id} type="button" className="pick" aria-pressed={f.memberId === k.id} onClick={() => setF({ ...f, memberId: k.id })}>{k.name}</button>)}</div>}
        <button className="btn" onClick={() => add("cost")} disabled={!f.title.trim() || !f.amount}>{t("Toevoegen")}</button>
      </div>
      <div className="upnext">
        {pot?.items.map((x) => (
          <div className="item" key={x.id}>
            <span style={{ flex: 1 }}><b>{x.kind === "settle" ? `↩️ ${x.title}` : x.title}</b><small>{x.date} · {t("betaald door {p}", { p: x.payer })}{x.memberId ? ` · ${data?.members.find((m) => m.id === x.memberId)?.name ?? ""}` : ""}</small></span>
            <b className="num">{euro(x.amount)}</b>
            {x.paidByMe && <button className="iconbtn" aria-label={t("Verwijderen")} onClick={() => act(() => api.del(`/costs/item/${x.id}`))}>✕</button>}
          </div>
        ))}
        {pot && !pot.items.length && <p className="empty">{t("Nog geen kosten. Alles wat je voor de kinderen betaalt, komt hier; het saldo rekent zichzelf uit.")}</p>}
      </div>
    </Modal>
  );
}

/** Bord: bij wie zijn de kinderen, en wanneer is de volgende overdracht? */
export function CustodyChips() {
  const [days] = useRemote<CustodyDay[]>("/custody/today", ["family", "events"], []);
  return (
    <>
      {days.filter((d) => d.kids.length).map((d) => (
        <span key={d.linkId} className="bord-wx" title={t("Verblijfsregeling")}>
          🏠 {d.withUs ? t("Bij ons") : t("Bij {o}", { o: d.otherName })}{d.handover ? ` · ${d.handover.toUs ? t("terug") : t("wissel")} ${relDay(d.handover.date)} ${d.handover.time}` : ""}
        </span>
      ))}
    </>
  );
}

/** Overdrachtslijst van vandaag: afvinken wat mee moet. Verschijnt alleen op een overdrachtsdag (of altijd met `always`). */
export function HandoverCard({ memberId, big, always }: { memberId?: string; big?: boolean; always?: boolean }) {
  const { member } = useData();
  const act = useAction();
  const date = todayIso();
  const [h] = useRemote<Handover | null>(`/handover?date=${date}`, ["family"], null);
  if (!h || (!h.handoverToday && !always)) return null;
  const kids = h.kids.filter((k) => !memberId || k.memberId === memberId);
  if (!kids.length) return null;
  const check = (id: string, done: boolean) => act(() => api.post(`/handover/items/${id}/check`, { date, done }));
  return (
    <section className={`glass widget-sm handover${big ? " big" : ""}`}>
      <div className="widget-h"><h2>🎒 {t("Mee naar het andere huis")}{h.time ? ` · ${h.time}` : ""}</h2></div>
      {kids.map((k) => (
        <div key={k.memberId} className="handover-kid">
          {!memberId && <b>{member(k.memberId)?.name}</b>}
          <div className="handover-items">
            {k.items.map((i) => (
              <button key={i.id} className={`handover-item${i.done ? " done" : ""}`} aria-pressed={i.done} onClick={() => { if (big) void say(i.text); void check(i.id, !i.done); }}>
                <span className="hi-ic" aria-hidden>{i.icon}</span><span>{i.text}</span>{i.done && <span aria-hidden>✓</span>}
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

/** Bewerken van de vaste lijst per kind (in het profiel van het kind). */
export function HandoverEditor({ memberId }: { memberId: string }) {
  const act = useAction();
  const [h] = useRemote<Handover | null>(`/handover?date=${todayIso()}`, ["family"], null);
  const [text, setText] = useState(""); const [icon, setIcon] = useState(ITEM_ICONS[0]);
  const items = h?.kids.find((k) => k.memberId === memberId)?.items ?? [];
  useEffect(() => { setText(""); }, [memberId]);
  const add = async () => { if (text.trim() && await act(() => api.post("/handover/items", { memberId, text: text.trim(), icon }))) setText(""); };
  return (
    <section className="glass widget-sm">
      <div className="widget-h"><h2>🎒 {t("Overdrachtslijst")}</h2></div>
      <p className="hint">{t("Wat altijd mee moet naar het andere huis. Op de dag van de wissel staat het op het Bord, in de briefing en op de kindertablet.")}</p>
      <div className="handover-items">{items.map((i) => <span key={i.id} className="handover-item">{i.icon} {i.text}<button className="iconbtn" aria-label={t("Weghalen")} onClick={() => act(() => api.del(`/handover/items/${i.id}`))}>✕</button></span>)}</div>
      <div className="picks">{ITEM_ICONS.map((x) => <button key={x} type="button" className="pick" aria-pressed={icon === x} onClick={() => setIcon(x)}>{x}</button>)}</div>
      <div className="addrow"><input value={text} maxLength={60} placeholder={t("bv. Turnzak, pufjes, knuffel")} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} /><button className="btn" onClick={add} disabled={!text.trim()}>{t("Toevoegen")}</button></div>
    </section>
  );
}
