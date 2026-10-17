import { isShopping } from "../types";
import { useRef, useState } from "react";
import { api } from "../api";
import { useAction, useData } from "../store";
import { Modal } from "./ui";
import { Icon } from "./Icons";
import { DSHORT, MSHORT, cap, fmtTime, longDate, weekday } from "../dates";
import { t } from "../i18n";

interface Proposal {
  title: string; date: string; endDate: string | null; startTime: string | null; endTime: string | null;
  location: string; notes: string; members: string[]; repeat: "none" | "daily" | "weekly" | "biweekly" | "monthly" | "yearly"; repeatUntil: string | null;
}
interface Result { summary: string; events: Proposal[]; listItems: string[] }
const REPEAT: Record<Proposal["repeat"], string> = { none: "", daily: "elke dag", weekly: "elke week", biweekly: "om de twee weken", monthly: "elke maand", yearly: t("elk jaar") };

/** Slim importeren: foto van een brief, flyer of uitnodiging, of geplakte tekst. */
export function Importer({ onClose }: { onClose: () => void }) {
  const { data, toast } = useData();
  const act = useAction();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [pickedItems, setPickedItems] = useState<Set<number>>(new Set());
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const shop = data?.lists.find(isShopping) ?? data?.lists.find((l) => l.kind === "list");

  const choose = (f: File | null) => {
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
  };
  const extract = async () => {
    setBusy(true);
    const fd = new FormData();
    if (file) fd.append("image", file);
    if (text.trim()) fd.append("text", text.trim());
    const r = await act(() => api.post<Result>("/import/extract", fd));
    setBusy(false);
    if (r) {
      setResult(r);
      setPicked(new Set(r.events.map((_, i) => i)));
      setPickedItems(new Set(r.listItems.map((_, i) => i)));
    }
  };
  const commit = async () => {
    if (!result) return;
    const events = result.events.filter((_, i) => picked.has(i));
    const listItems = result.listItems.filter((_, i) => pickedItems.has(i));
    const r = await act(() => api.post<{ added: number; items: number }>("/import/commit", { events, listItems, listId: listItems.length ? shop?.id ?? null : null }));
    if (r) { toast(`${t("{n} afspraak/afspraken toegevoegd", { n: r.added })}${r.items ? ` ${t("en {n} op {l}", { n: r.items, l: shop?.name ?? "" })}` : ""}`); onClose(); }
  };
  const update = (i: number, patch: Partial<Proposal>) => setResult((r) => r && { ...r, events: r.events.map((e, k) => (k === i ? { ...e, ...patch } : e)) });
  const toggle = (i: number) => setPicked((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  return (
    <Modal title={t("Slim importeren")} onClose={onClose} wide>
      {!result ? (
        <>
          <p className="hint">Neem een foto van een schoolbrief, flyer, uitnodiging of lesrooster, of plak de tekst van een e-mail. De assistent haalt er de afspraken uit; je kijkt ze na voor ze in de kalender komen.</p>
          {!data?.assistant.available && <p className="error">{t("Importeren gebruikt de assistent. Een beheerder voegt eerst een ANTHROPIC_API_KEY toe op de server.")}</p>}
          <div className="lib-actions">
            <button className="btn accent" onClick={() => camera.current?.click()}>{t("📷 Foto nemen")}</button>
            <button className="btn ghost" onClick={() => gallery.current?.click()}><Icon.upload />{" "}{t("Foto kiezen")}</button>
            <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => choose(e.target.files?.[0] ?? null)} />
            <input ref={gallery} type="file" accept="image/*" hidden onChange={(e) => choose(e.target.files?.[0] ?? null)} />
          </div>
          {preview && (
            <div className="imp-preview">
              <img src={preview} alt={t("Gekozen foto")} />
              <button className="iconbtn" aria-label={t("Foto weghalen")} onClick={() => choose(null)}><Icon.close /></button>
            </div>
          )}
          <label className="field"><span>{t("Of plak tekst (e-mail, bericht, brief)")}</span>
            <textarea id="imp-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Beste ouders, op vrijdag 24 oktober gaan we op schoolreis naar… Vertrek om 8u30 aan de school, meebrengen: lunchpakket en regenjas.")} />
          </label>
          <div className="actions">
            <button className="btn ghost" onClick={onClose}>{t("Annuleren")}</button>
            <button className="btn" onClick={extract} disabled={busy || (!file && !text.trim()) || !data?.assistant.available}>{busy ? t("Aan het lezen…") : t("Afspraken zoeken")}</button>
          </div>
        </>
      ) : (
        <>
          <p className="hint">{result.summary}</p>
          {!result.events.length && <p className="empty">{t("Geen afspraken met een datum gevonden. Probeer een scherpere foto of plak de tekst.")}</p>}
          <div className="imp-list">
            {result.events.map((e, i) => (
              <div className={`imp-ev${picked.has(i) ? "" : t(" off")}`} key={i}>
                <label className="imp-check"><input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} aria-label={t("Deze afspraak toevoegen")} /></label>
                <div className="imp-body">
                  <input value={e.title} onChange={(ev) => update(i, { title: ev.target.value })} aria-label={t("Titel")} className="imp-title" />
                  <div className="imp-row">
                    <input type="date" value={e.date} onChange={(ev) => update(i, { date: ev.target.value })} aria-label={t("Datum")} />
                    {e.startTime !== null ? (
                      <>
                        <input type="time" value={e.startTime} onChange={(ev) => update(i, { startTime: ev.target.value })} aria-label={t("Van")} />
                        <input type="time" value={e.endTime ?? ""} onChange={(ev) => update(i, { endTime: ev.target.value || null })} aria-label={t("Tot")} />
                      </>
                    ) : <span className="badge">{t("Hele dag")}</span>}
                    {e.repeat !== "none" && <span className="badge">🔁 {REPEAT[e.repeat]}{e.repeatUntil ? ` t/m ${DSHORT[weekday(e.repeatUntil)]} ${Number(e.repeatUntil.slice(8))} ${MSHORT[Number(e.repeatUntil.slice(5, 7)) - 1]}` : ""}</span>}
                  </div>
                  <div className="picks">
                    {data?.members.map((m) => {
                      const on = e.members.some((n) => n.toLocaleLowerCase("nl") === m.name.toLocaleLowerCase("nl"));
                      return <button key={m.id} type="button" className="pick" style={{ "--c": m.color } as React.CSSProperties} aria-pressed={on}
                        onClick={() => update(i, { members: on ? e.members.filter((n) => n.toLocaleLowerCase("nl") !== m.name.toLocaleLowerCase("nl")) : [...e.members, m.name] })}>{m.avatar} {m.name}</button>;
                    })}
                    {!e.members.length && <span className="hint" style={{ alignSelf: "center" }}>{t("hele gezin")}</span>}
                  </div>
                  {(e.location || e.notes) && <small className="muted">{[e.location, e.notes].filter(Boolean).join(" · ")}</small>}
                  <small className="muted">{cap(longDate(e.date))}{e.startTime ? ` · ${fmtTime(e.startTime)}${e.endTime ? ` – ${fmtTime(e.endTime)}` : ""}` : ""}</small>
                </div>
              </div>
            ))}
          </div>
          {result.listItems.length > 0 && (
            <div className="field"><span>Meebrengen of kopen → {shop?.name ?? "lijst"}</span>
              <div className="picks">{result.listItems.map((it, i) => (
                <button key={i} type="button" className="pick" aria-pressed={pickedItems.has(i)} onClick={() => setPickedItems((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; })}>🛒 {it}</button>
              ))}</div>
            </div>
          )}
          <div className="actions">
            <button className="btn ghost" onClick={() => setResult(null)}>{t("Terug")}</button>
            <button className="btn" onClick={commit} disabled={!picked.size && !pickedItems.size}>{picked.size ? `${picked.size} toevoegen` : t("Toevoegen")}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

/** "zwemles di 17u Lina" → afspraak (opent het formulier ter controle). */
export function QuickAdd({ onParsed }: { onParsed: (p: Proposal & { memberIds: string[] }) => void }) {
  const { data } = useData();
  const act = useAction();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  if (!data?.assistant.available) return null;
  const go = async () => {
    if (text.trim().length < 2) return;
    setBusy(true);
    const p = await act(() => api.post<Proposal>("/events/quick", { text: text.trim() }));
    setBusy(false);
    if (p) {
      setText("");
      onParsed({ ...p, memberIds: p.members.map((n) => data.members.find((m) => m.name.toLocaleLowerCase("nl") === n.toLocaleLowerCase("nl"))?.id).filter((x): x is string => !!x) });
    }
  };
  return (
    <form className="quickadd" onSubmit={(e) => { e.preventDefault(); go(); }}>
      <span aria-hidden>✨</span>
      <input id="quickadd" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Snel toevoegen: “zwemles dinsdag 17u Lina”")} aria-label={t("Snel een afspraak toevoegen")} disabled={busy} />
      <button className="btn small" type="submit" disabled={busy || text.trim().length < 2}>{busy ? "…" : t("Toevoegen")}</button>
    </form>
  );
}
