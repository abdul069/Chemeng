/** De gezinsinbox: doorgestuurde mails worden voorstellen; jij kijkt na en zet ze met één tik in agenda, lijst of prijsgeheugen. */
import { useState } from "react";
import { api } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { InboxItem } from "../types";
import { Modal } from "./ui";
import { euro } from "./Prices";
import { relDay, shortDate, fmtTime } from "../dates";
import { t } from "../i18n";

const KIND_ICON: Record<string, string> = { school: "🏫", receipt: "🧾", other: "✉️" };

function Item({ it, onOpen }: { it: InboxItem; onOpen: () => void }) {
  const act = useAction();
  const n = (it.data.events?.length ?? 0) + (it.data.listItems?.length ?? 0) + (it.data.scan?.items.length ?? 0);
  return (
    <div className={`upk ${it.status === "new" ? "soon" : "ok dim"}`}>
      <span className="upk-ic" aria-hidden>{KIND_ICON[it.kind] ?? "✉️"}</span>
      <span className="upk-txt">
        <b>{it.subject || t("(zonder onderwerp)")}</b>
        <small>{it.sender} · {relDay(it.receivedAt.slice(0, 10))}</small>
        <small className="muted">{it.summary}</small>
      </span>
      <span className="upk-btns">
        {it.status === "new" && n > 0 && <button className="btn small" onClick={onOpen}>{t("Nakijken")} ({n})</button>}
        {it.status === "new" && n === 0 && <button className="btn small ghost" onClick={onOpen}>{t("Lezen")}</button>}
        {it.status === "new" && <button className="iconbtn" aria-label={t("Negeren")} onClick={() => act(() => api.post(`/inbox/${it.id}/dismiss`))}>✕</button>}
        {it.status !== "new" && <button className="iconbtn" aria-label={t("Verwijderen")} onClick={() => act(() => api.del(`/inbox/${it.id}`))}>🗑</button>}
      </span>
    </div>
  );
}

function Review({ it, onClose }: { it: InboxItem; onClose: () => void }) {
  const { toast } = useData();
  const act = useAction();
  const [events, setEvents] = useState(true); const [list, setList] = useState(true); const [pantry, setPantry] = useState(true);
  const apply = async () => {
    const r = await act(() => api.post<{ events: number; items: number; prices: number }>(`/inbox/${it.id}/apply`, { events, listItems: list, toPantry: pantry }));
    if (r) { toast([r.events ? t("{n} afspraken", { n: r.events }) : "", r.items ? t("{n} op de lijst", { n: r.items }) : "", r.prices ? t("{n} prijzen", { n: r.prices }) : ""].filter(Boolean).join(" · ") || t("Afgehandeld")); onClose(); }
  };
  return (
    <Modal title={`${KIND_ICON[it.kind]} ${it.subject || t("Bericht")}`} onClose={onClose} wide>
      <p className="hint">{it.sender} · {shortDate(it.receivedAt.slice(0, 10))}</p>
      {!!it.data.events?.length && (
        <section>
          <label className="check-row" style={{ fontWeight: 600 }}><input type="checkbox" checked={events} onChange={(e) => setEvents(e.target.checked)} /> 📅 {t("Afspraken")} ({it.data.events.length})</label>
          <div className="upks">{it.data.events.map((e, i) => <div className="upk ok" key={i}><span className="upk-ic" aria-hidden>{e.startTime ? "🕐" : "📌"}</span><span className="upk-txt"><b>{e.title}</b><small>{shortDate(e.date)}{e.endDate && e.endDate !== e.date ? ` – ${shortDate(e.endDate)}` : ""}{e.startTime ? ` · ${fmtTime(e.startTime)}${e.endTime ? `–${fmtTime(e.endTime)}` : ""}` : ""}{e.location ? ` · ${e.location}` : ""}{e.members.length ? ` · ${e.members.join(", ")}` : ""}</small>{e.notes && <small className="muted">{e.notes}</small>}</span></div>)}</div>
        </section>
      )}
      {!!it.data.listItems?.length && (
        <section>
          <label className="check-row" style={{ fontWeight: 600 }}><input type="checkbox" checked={list} onChange={(e) => setList(e.target.checked)} /> 🛒 {t("Op de boodschappenlijst")} ({it.data.listItems.length})</label>
          <p className="hint">{it.data.listItems.join(", ")}</p>
        </section>
      )}
      {it.data.scan && (
        <section>
          <b>🧾 {it.data.scan.store || "?"} · {shortDate(it.data.scan.date)}{it.data.scan.total !== null ? ` · ${euro(it.data.scan.total)}` : ""}</b>
          <div className="scan-rows" style={{ marginTop: 6 }}>{it.data.scan.items.map((x, i) => <div className="scan-row" key={i}><span>{x.label}</span><span>{x.qty}</span><span>{x.unit}</span><span>{euro(x.price)}</span><span /></div>)}</div>
          <label className="check-row"><input type="checkbox" checked={pantry} onChange={(e) => setPantry(e.target.checked)} /> {t("Prijzen bewaren, afvinken op de lijst en in de voorraad zetten")}</label>
        </section>
      )}
      {!it.data.events?.length && !it.data.listItems?.length && !it.data.scan && <p className="hint" style={{ whiteSpace: "pre-wrap" }}>{it.body.slice(0, 2000) || it.summary}</p>}
      <div className="actions">
        <button className="btn ghost" onClick={async () => { await act(() => api.post(`/inbox/${it.id}/dismiss`)); onClose(); }}>{t("Negeren")}</button>
        {(it.data.events?.length || it.data.listItems?.length || it.data.scan) ? <button className="btn" onClick={apply}>✓ {t("Toevoegen")}</button> : <button className="btn" onClick={async () => { await act(() => api.post(`/inbox/${it.id}/dismiss`)); onClose(); }}>{t("Gelezen")}</button>}
      </div>
    </Modal>
  );
}

export function InboxApp() {
  const { data, toast } = useData();
  const act = useAction();
  const [box] = useRemote<{ items: InboxItem[]; address: string | null; shared: boolean }>("/inbox", ["inbox"], { items: [], address: null, shared: false });
  const [open, setOpen] = useState<InboxItem | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const conn = useRemote<{ connector: string; enabled: boolean; status: string; error: string }[]>("/connections", ["connections"], [])[0].find((c) => c.connector === "inbox");
  const items = box.items.filter((i) => showDone || i.status === "new");
  const sync = async () => { setBusy(true); const r = await act(() => api.post<{ status: string; error: string }>("/inbox/sync")); setBusy(false); if (r) toast(r.status === "error" ? `⚠️ ${r.error}` : t("Inbox opgehaald")); };
  return (
    <div className="page-scroll home" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="section-title"><h2>📬 {t("Gezinsinbox")}</h2><div style={{ display: "flex", gap: 6 }}><button className="btn small ghost" onClick={() => setShowDone(!showDone)}>{showDone ? t("Alleen nieuw") : t("Ook afgehandeld")}</button><button className="btn small" disabled={busy || !conn} onClick={sync}>{busy ? "…" : `↻ ${t("Ophalen")}`}</button></div></div>
      {!conn && <div className="empty-card"><p className="empty">{t("Zet de koppeling Gezinsinbox aan bij Instellingen → Koppelingen. Met de gedeelde inbox van de server krijgt je gezin meteen een eigen adres; anders vul je je eigen mailbox in.")}</p></div>}
      {conn && (
        <p className="hint">{box.address ? t("Stuur of forward naar {a}. Elke 5 minuten kijkt {brand} of er iets nieuws is.", { a: box.address }) : t("Berichten uit je eigen mailbox worden elke 5 minuten opgehaald.")}{conn.status === "error" && <span className="error"> ⚠️ {conn.error}</span>}{data?.assistant.available ? "" : ` ${t("Zonder Claude-sleutel worden berichten alleen bewaard, niet uitgelezen.")}`}</p>
      )}
      <div className="upks">{items.map((it) => <Item key={it.id} it={it} onOpen={() => setOpen(it)} />)}</div>
      {!items.length && conn && <p className="empty">{t("Niets om na te kijken.")}</p>}
      {open && <Review it={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
