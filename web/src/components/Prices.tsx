/** Prijsgeheugen: wat kostte wat, waar en wanneer. Kassaticket of etiket fotograferen, handmatig invoeren, prijzen op de lijst, beste winkel. */
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { List, Price, PriceInfo, ScanResult, StoreTotal } from "../types";
import { Fold, Modal } from "./ui";
import { shortDate, todayIso } from "../dates";
import { t, getLang } from "../i18n";

const SEP = "\u001f";
export const euro = (n: number) => `€${n.toFixed(2).replace(".", ",")}`;
const unitLabel = (u: string) => (u === "st" ? t("st") : u);
export const perUnit = (p: Price) => `${euro(p.unitPrice)}/${unitLabel(p.unit)}`;

/** Prijzen voor een rij lijstitems; herlaadt bij nieuwe prijzen. */
export function usePriceLookup(texts: string[]): Map<string, PriceInfo> {
  const key = texts.join(SEP);
  const [infos] = useRemote<PriceInfo[]>(texts.length ? `/prices/lookup?items=${encodeURIComponent(key)}` : null, ["prices"], []);
  return useMemo(() => new Map(infos.map((i) => [i.text, i])), [infos]);
}

/** Regeltje onder een lijstitem: laatste prijs en waar, en goedkoper elders als dat zo is. */
export function PriceTag({ info }: { info?: PriceInfo }) {
  if (!info?.latest) return null;
  const l = info.latest; const c = info.cheapest;
  const cheaper = c && c.store !== l.store && c.unitPrice < l.unitPrice * 0.97;
  const deal = c?.validUntil ? c : l.validUntil ? l : null;
  return (
    <small className="pricetag">
      {l.validUntil ? <span className="deal">🏷️ {t("promo")} {euro(l.price)} · {l.store} · {t("tot {d}", { d: shortDate(l.validUntil) })}</span> : <span>{euro(l.price)} · {perUnit(l)} · {l.store}</span>}
      {cheaper && <span className={c.validUntil ? "deal" : "cheaper"}>↓ {c.validUntil ? "🏷️ " : ""}{c.store} {perUnit(c)}{c.validUntil && deal === c ? ` · ${t("tot {d}", { d: shortDate(c.validUntil) })}` : ""}</span>}
    </small>
  );
}

function readFile(f: File): Promise<string> { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); }); }

/** Kassaticket of prijsetiket fotograferen → lezen → nakijken → inboeken. */
export function ReceiptScan({ kind, onClose }: { kind: "ticket" | "label" | "folder"; onClose: () => void }) {
  const { data, toast } = useData();
  const act = useAction();
  const [stores] = useRemote<string[]>("/prices/stores", ["prices"], []);
  const camera = useRef<HTMLInputElement>(null); const gallery = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState<ScanResult | null>(null);
  const [toPantry, setToPantry] = useState(kind === "ticket");
  const [tickList, setTickList] = useState(true);
  const manual = () => setDraft({ store: "", date: todayIso(), total: null, items: [{ label: "", qty: 1, unit: "st", price: 0 }] });
  const choose = async (f: File | null) => {
    if (!f) return;
    setErr(""); setBusy(true); setPreview(await readFile(f));
    const fd = new FormData(); fd.append("image", f); fd.append("kind", kind);
    try {
      const r = await fetch("/api/prices/scan", { method: "POST", body: fd, credentials: "include" });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "Lezen mislukte");
      setDraft(j as ScanResult);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };
  const set = (i: number, patch: Partial<ScanResult["items"][number]>) => setDraft((d) => d && { ...d, items: d.items.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  const sum = draft ? draft.items.reduce((a, x) => a + (Number(x.price) || 0), 0) : 0;
  const save = async () => {
    if (!draft) return;
    const items = draft.items.filter((x) => x.label.trim() && Number(x.qty) > 0);
    if (!draft.store.trim()) { setErr(t("Vul de winkel in.")); return; }
    if (!items.length) { setErr(t("Geen regels om te bewaren.")); return; }
    const r = await act(() => api.post<{ prices: number; ticked: number; stocked: number }>("/prices/commit", { store: draft.store.trim(), date: draft.date || todayIso(), total: draft.total, validUntil: kind === "folder" ? draft.validUntil || null : null, items: items.map((x) => ({ ...x, qty: Number(x.qty), price: Number(x.price) })), source: kind, toPantry, tickList }));
    if (r) { toast(kind === "folder" ? t("{n} promo's bewaard", { n: r.prices }) : t("{n} prijzen bewaard · {a} afgevinkt · {s} in voorraad", { n: r.prices, a: r.ticked, s: r.stocked })); onClose(); }
  };
  return (
    <Modal title={kind === "ticket" ? `🧾 ${t("Kassaticket")}` : kind === "folder" ? `📰 ${t("Folder")}` : `🏷️ ${t("Prijsetiket")}`} onClose={onClose} wide>
      {!draft && (
        <>
          <p className="hint">{kind === "ticket" ? t("Fotografeer het kassaticket: elke regel wordt een prijs in het geheugen, gekochte boodschappen worden afgevinkt en komen in de voorraad.") : kind === "folder" ? t("Fotografeer een pagina van de folder: de promo's komen met hun einddatum in het prijsgeheugen en tellen mee op de boodschappenlijst en in de Weekbox.") : t("Fotografeer het schapkaartje in de winkel; de prijs per kg, liter of stuk wordt bewaard om te vergelijken.")}</p>
          {!data?.assistant.available && <p className="error">{t("Prijzen lezen van een foto vraagt de Claude-sleutel (Instellingen → Assistent). Handmatig invoeren kan altijd.")}</p>}
          <div className="actions" style={{ justifyContent: "flex-start" }}>
            <button className="btn" disabled={busy || !data?.assistant.available} onClick={() => camera.current?.click()}>📷 {t("Foto nemen")}</button>
            <button className="btn ghost" disabled={busy || !data?.assistant.available} onClick={() => gallery.current?.click()}>🖼️ {t("Foto kiezen")}</button>
            <button className="btn ghost" onClick={manual}>✍️ {t("Handmatig")}</button>
          </div>
          <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => choose(e.target.files?.[0] ?? null)} />
          <input ref={gallery} type="file" accept="image/*" hidden onChange={(e) => choose(e.target.files?.[0] ?? null)} />
          {busy && <p className="hint">⏳ {t("Aan het lezen…")}</p>}
          {preview && <img src={preview} alt="" className="scan-preview" />}
          {err && <p className="error">{err}</p>}
        </>
      )}
      {draft && (
        <>
          <div className="grid2">
            <label className="field"><span>{t("Winkel")}</span><input list="gb-stores" value={draft.store} onChange={(e) => setDraft({ ...draft, store: e.target.value })} placeholder="Colruyt" /><datalist id="gb-stores">{stores.map((s) => <option key={s} value={s} />)}</datalist></label>
            <label className="field"><span>{kind === "folder" ? t("Geldig tot en met") : t("Datum")}</span><input type="date" value={kind === "folder" ? draft.validUntil ?? "" : draft.date} onChange={(e) => setDraft(kind === "folder" ? { ...draft, validUntil: e.target.value } : { ...draft, date: e.target.value })} /></label>
          </div>
          <div className="scan-rows">
            <div className="scan-row head"><span>{t("Product")}</span><span>{t("Aantal")}</span><span>{t("Eenheid")}</span><span>{t("Prijs")}</span><span /></div>
            {draft.items.map((x, i) => (
              <div className="scan-row" key={i}>
                <input value={x.label} onChange={(e) => set(i, { label: e.target.value })} placeholder={t("bv. Halfvolle melk")} />
                <input type="number" step="any" min={0} value={x.qty} onChange={(e) => set(i, { qty: Number(e.target.value) })} />
                <select value={x.unit} onChange={(e) => set(i, { unit: e.target.value as ScanResult["items"][number]["unit"] })}>{["st", "g", "kg", "ml", "l"].map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}</select>
                <input type="number" step="0.01" min={0} value={x.price} onChange={(e) => set(i, { price: Number(e.target.value) })} />
                <button className="iconbtn" aria-label={t("Verwijderen")} onClick={() => setDraft({ ...draft, items: draft.items.filter((_, k) => k !== i) })}>✕</button>
              </div>
            ))}
            <button className="linkbtn" onClick={() => setDraft({ ...draft, items: [...draft.items, { label: "", qty: 1, unit: "st", price: 0 }] })}>+ {t("Regel")}</button>
          </div>
          <div className="scan-foot">
            <span>{t("Som van de regels")}: <b>{euro(sum)}</b>{draft.total !== null && Math.abs(draft.total - sum) > 0.02 && <small className="muted"> · {t("ticket")}: {euro(draft.total)}</small>}</span>
          </div>
          {kind === "ticket" && <>
            <label className="check-row"><input type="checkbox" checked={tickList} onChange={(e) => setTickList(e.target.checked)} /> {t("Gekochte items afvinken op de boodschappenlijst (ze gaan naar de voorraad)")}</label>
            <label className="check-row"><input type="checkbox" checked={toPantry} onChange={(e) => setToPantry(e.target.checked)} /> {t("De rest ook in de voorraad zetten")}</label>
          </>}
          {err && <p className="error">{err}</p>}
          <div className="actions"><button className="btn ghost" onClick={() => setDraft(null)}>{t("Terug")}</button><button className="btn" onClick={save}>{t("Bewaren")}</button></div>
        </>
      )}
    </Modal>
  );
}

/** Prijzen-overzicht: beste winkel voor deze lijst, uitgaven per maand, prijsverloop van een product. */
export function PricesPanel({ list, onClose }: { list: List | undefined; onClose: () => void }) {
  const act = useAction();
  const [best] = useRemote<{ items: number; known: number; stores: StoreTotal[]; split: { total: number; stores: string[] } } | null>(list ? `/prices/list/${list.id}` : null, ["prices", "lists"], null);
  const [spend] = useRemote<{ month: string; store: string; total: number; tickets: number }[]>("/prices/spend?months=6", ["prices"], []);
  const [q, setQ] = useState("");
  const [hist, setHist] = useState<Price[]>([]);
  useEffect(() => { if (!q.trim()) { setHist([]); return; } const h = setTimeout(() => api.get<Price[]>(`/prices/history?product=${encodeURIComponent(q.trim())}`).then(setHist).catch(() => setHist([])), 300); return () => clearTimeout(h); }, [q]);
  const months = useMemo(() => { const m = new Map<string, { total: number; stores: { store: string; total: number }[] }>(); for (const s of spend) { const x = m.get(s.month) ?? { total: 0, stores: [] }; x.total += s.total; x.stores.push({ store: s.store, total: s.total }); m.set(s.month, x); } return [...m.entries()]; }, [spend]);
  const lang = getLang();
  const monthName = (ym: string) => new Date(ym + "-01T12:00:00").toLocaleDateString(lang === "tr" ? "tr-TR" : lang === "en" ? "en-GB" : "nl-BE", { month: "long", year: "numeric" });
  const max = Math.max(1, ...hist.map((p) => p.unitPrice));
  const bestSingle = best?.stores[0];
  const saving = best && bestSingle && best.split.stores.length > 1 && bestSingle.known === best.known ? Math.round((bestSingle.total - best.split.total) * 100) / 100 : 0;
  return (
    <Modal title={`💶 ${t("Prijzen")}`} onClose={onClose} wide>
      {list && (
        <section>
          <h3 className="brief-sub">{t("Beste winkel voor {l}", { l: list.name })}</h3>
          {best && best.known === 0 && <p className="empty">{t("Nog geen prijzen voor deze items. Fotografeer een kassaticket, dan leert Kinday wat alles kost.").split("Kinday").join(t("{brand}"))}</p>}
          {best && best.known > 0 && (
            <>
              <p className="hint">{t("{k} van {n} items hebben een bekende prijs.", { k: best.known, n: best.items })}{saving > 0.5 && ` ${t("Splitsen over {s} bespaart {e}.", { s: best.split.stores.join(" + "), e: euro(saving) })}`}</p>
              <div className="storerows">{best.stores.map((s) => <div className="storerow" key={s.store}><b>{s.store}</b><small className="muted">{t("{k} items bekend", { k: s.known })}</small><span className="num">{euro(s.total)}</span></div>)}</div>
            </>
          )}
        </section>
      )}
      <section>
        <h3 className="brief-sub">{t("Prijsverloop")}</h3>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Product, bv. melk")} />
        {hist.length > 0 && (
          <div className="hist">
            {hist.map((p) => <div className="hist-row" key={p.id}><small className="muted">{shortDate(p.seenOn)}</small><span className="hist-bar" style={{ width: `${Math.max(8, (p.unitPrice / max) * 100)}%` }} /><span>{perUnit(p)}</span><small className="muted">{p.store} · {p.label}</small><button className="iconbtn" aria-label={t("Verwijderen")} onClick={() => act(() => api.del(`/prices/${p.id}`)).then(() => setHist((h) => h.filter((x) => x.id !== p.id)))}>✕</button></div>)}
          </div>
        )}
        {q.trim() && !hist.length && <p className="empty">{t("Nog geen prijzen voor {q}.", { q: q.trim() })}</p>}
      </section>
      <section>
        <h3 className="brief-sub">{t("Uitgaven per maand (uit kassatickets)")}</h3>
        {!months.length && <p className="empty">{t("Nog geen kassatickets ingelezen.")}</p>}
        {months.map(([m, x]) => <div className="storerow" key={m}><b>{monthName(m)}</b><small className="muted">{x.stores.map((s) => `${s.store} ${euro(s.total)}`).join(" · ")}</small><span className="num">{euro(x.total)}</span></div>)}
      </section>
    </Modal>
  );
}

/** Knoppenrij voor de lijstkop: ticket, etiket, prijzen. */
export function PriceButtons({ list }: { list: List | undefined }) {
  const [scan, setScan] = useState<"ticket" | "label" | "folder" | null>(null);
  const [panel, setPanel] = useState(false);
  return (
    <>
      <button className="btn small ghost" onClick={() => setScan("ticket")}>🧾 {t("Kassaticket")}</button>
      <button className="btn small ghost" onClick={() => setScan("label")}>🏷️ {t("Etiket")}</button>
      <button className="btn small ghost" onClick={() => setScan("folder")}>📰 {t("Folder")}</button>
      <button className="btn small ghost" onClick={() => setPanel(true)}>💶 {t("Prijzen")}</button>
      {scan && <ReceiptScan kind={scan} onClose={() => setScan(null)} />}
      {panel && <PricesPanel list={list} onClose={() => setPanel(false)} />}
    </>
  );
}

/** Instellingen-blokje: wat het prijsgeheugen is en de laatste tickets. */
export function PricesSection() {
  const act = useAction();
  const [receipts] = useRemote<{ id: string; store: string; seenOn: string; total: number | null; items: number }[]>("/prices/receipts", ["prices"], []);
  return (
    <Fold title={t("Prijsgeheugen")} hint={t("kassatickets en prijzen")}>
      <p className="hint">{t("Elke prijs die je bewaart (ticket, etiket of handmatig) wordt omgerekend per kg, liter of stuk. Op de boodschappenlijst zie je de laatste prijs en waar het goedkoper is; bij Prijzen de beste winkel voor je hele lijst en je uitgaven per maand. Alles blijft binnen dit gezin.")}</p>
      {receipts.map((r) => <div className="storerow" key={r.id}><b>{r.store}</b><small className="muted">{shortDate(r.seenOn)} · {r.items} {t("regels")}</small><span className="num">{r.total !== null ? euro(r.total) : ""}</span><button className="iconbtn" aria-label={t("Verwijderen")} onClick={() => act(() => api.del(`/prices/receipts/${r.id}`), t("Ticket verwijderd"))}>✕</button></div>)}
      {!receipts.length && <p className="empty">{t("Nog geen kassatickets ingelezen.")}</p>}
    </Fold>
  );
}
