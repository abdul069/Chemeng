/** Het huis: onderhoud en keuringen, afvalkalender, gezondheid en slim huis. Vier tabbladen, één plek. */
import { useEffect, useRef, useState } from "react";
import { api, photoUrl } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { HaState, HealthItem, HealthKind, Member, Upkeep, UpkeepTemplate, WasteData } from "../types";
import { Avatar, Confirm, Fold, Modal, cvar } from "./ui";
import { DAYS, DSHORT, addDays, cap, diffDays, fmtTime, longDate, relDay, shortDate, todayIso } from "../dates";
import { getDevice } from "../device";
import { t, getLang } from "../i18n";

type Tab = "upkeep" | "waste" | "care" | "smart";
const CATS: Record<string, string> = { auto: "Auto", verwarming: "Verwarming", veiligheid: "Veiligheid", water: "Water en lucht", verzekering: "Verzekeringen", administratie: "Administratie", tuin: "Tuin en buiten", huisdier: "Huisdier", overig: "Overig" };
const STATUS_LABEL: Record<Upkeep["status"], string> = { ok: "In orde", soon: "Binnenkort", due: "Nu plannen", late: "Te laat", none: "Nog geen datum" };

/* ---------- Onderhoud en keuringen ---------- */
function UpkeepForm({ u, onClose }: { u?: Upkeep; onClose: () => void }) {
  const { data } = useData();
  const act = useAction();
  const people = (data?.members ?? []).filter((m) => m.role !== "huisdier" && m.role !== "kind");
  const [f, setF] = useState({ title: u?.title ?? "", category: u?.category ?? "overig", icon: u?.icon ?? "🔧", intervalMonths: u?.intervalMonths ?? 12, lastDone: u?.lastDone ?? "", nextDue: u?.nextDue ?? "", leadDays: u?.leadDays ?? 30, memberId: u?.memberId ?? null as string | null, provider: u?.provider ?? "", providerPhone: u?.providerPhone ?? "", providerUrl: u?.providerUrl ?? "", cost: u?.cost ?? "", notes: u?.notes ?? "" });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!f.title.trim()) return;
    const body = { ...f, lastDone: f.lastDone || null, nextDue: f.nextDue || null, intervalMonths: Number(f.intervalMonths) || 0, leadDays: Number(f.leadDays) || 0 };
    if (await act(() => (u ? api.put(`/upkeep/${u.id}`, body) : api.post("/upkeep", body)), t("Bewaard"))) onClose();
  };
  return (
    <Modal title={u ? t("Onderhoud bewerken") : t("Nieuw onderhoud of keuring")} onClose={onClose}>
      <div className="grid2">
        <label className="field"><span>{t("Wat")}</span><input value={f.title} autoFocus onChange={(e) => set("title", e.target.value)} placeholder={t("bv. Autokeuring Toyota")} /></label>
        <label className="field"><span>{t("Pictogram")}</span><input value={f.icon} maxLength={4} onChange={(e) => set("icon", e.target.value)} /></label>
        <label className="field"><span>{t("Categorie")}</span><select value={f.category} onChange={(e) => set("category", e.target.value)}>{Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select></label>
        <label className="field"><span>{t("Om de … maanden (0 = eenmalig)")}</span><input type="number" min={0} max={240} value={f.intervalMonths} onChange={(e) => set("intervalMonths", Number(e.target.value))} /></label>
        <label className="field"><span>{t("Laatst gedaan")}</span><input type="date" value={f.lastDone} onChange={(e) => set("lastDone", e.target.value)} /></label>
        <label className="field"><span>{t("Uiterste datum")}</span><input type="date" value={f.nextDue} onChange={(e) => set("nextDue", e.target.value)} /></label>
        <label className="field"><span>{t("Verwittig … dagen vooraf")}</span><input type="number" min={0} max={365} value={f.leadDays} onChange={(e) => set("leadDays", Number(e.target.value))} /></label>
        <label className="field"><span>{t("Kosten (richtprijs)")}</span><input value={f.cost} onChange={(e) => set("cost", e.target.value)} placeholder="€ 150" /></label>
        <label className="field"><span>{t("Firma of dienst")}</span><input value={f.provider} onChange={(e) => set("provider", e.target.value)} placeholder={t("bv. Keuringscentrum Hasselt")} /></label>
        <label className="field"><span>{t("Telefoon")}</span><input value={f.providerPhone} onChange={(e) => set("providerPhone", e.target.value)} placeholder="011 …" /></label>
        <label className="field" style={{ gridColumn: "1 / -1" }}><span>{t("Website om af te spreken")}</span><input type="url" value={f.providerUrl} onChange={(e) => set("providerUrl", e.target.value)} placeholder="https://" /></label>
      </div>
      {people.length > 1 && <div className="field"><span>{t("Wie regelt het")}</span><div className="picks"><button type="button" className="pick" aria-pressed={f.memberId === null} onClick={() => set("memberId", null)}>{t("Iemand")}</button>{people.map((m) => <button type="button" key={m.id} className="pick pick-person" style={cvar(m.color)} aria-pressed={f.memberId === m.id} onClick={() => set("memberId", m.id)}><Avatar m={m} size={22} dot={false} /> {m.name}</button>)}</div></div>}
      <label className="field"><span>{t("Notities")}</span><textarea rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder={t("Wat meenemen, waar het attest ligt…")} /></label>
      <div className="actions"><button className="btn ghost" onClick={onClose}>{t("Annuleren")}</button><button className="btn" disabled={!f.title.trim()} onClick={save}>{t("Bewaren")}</button></div>
    </Modal>
  );
}

function UpkeepCard({ u, members }: { u: Upkeep; members: Member[] }) {
  const { toast } = useData();
  const act = useAction();
  const [edit, setEdit] = useState(false); const [ask, setAsk] = useState(false); const [doneAsk, setDoneAsk] = useState(false);
  const [note, setNote] = useState(""); const [doneOn, setDoneOn] = useState(todayIso());
  const fileRef = useRef<HTMLInputElement>(null);
  const who = u.memberId ? members.find((m) => m.id === u.memberId) : null;
  const upload = async (file: File) => {
    const fd = new FormData(); fd.append("photo", file);
    try { const r = await fetch(`/api/upkeep/${u.id}/attest`, { method: "POST", body: fd, credentials: "include" }); if (!r.ok) throw new Error(); toast(t("Attest bewaard 📎")); } catch { toast(t("Uploaden mislukte")); }
  };
  const when = u.nextDue ? (u.daysLeft === 0 ? t("vandaag") : u.daysLeft! < 0 ? t("{d} dagen te laat", { d: -u.daysLeft! }) : u.daysLeft! === 1 ? t("morgen") : t("over {d} dagen", { d: u.daysLeft! })) : "";
  return (
    <div className={`upk ${u.status}`}>
      <span className="upk-ic" aria-hidden>{u.icon}</span>
      <span className="upk-txt">
        <b>{u.title}</b>
        <small>{u.nextDue ? <>{shortDate(u.nextDue)} · {when}</> : t("Nog geen datum")}{u.intervalMonths ? ` · ${t("om de {n} mnd", { n: u.intervalMonths })}` : ""}{who ? ` · ${who.name}` : ""}</small>
        {(u.provider || u.providerPhone) && <small className="muted">{u.provider}{u.providerPhone && <> · <a href={`tel:${u.providerPhone.replace(/\s/g, "")}`}>{u.providerPhone}</a></>}</small>}
      </span>
      <span className={`badge st-${u.status}`}>{t(STATUS_LABEL[u.status])}</span>
      <span className="upk-btns">
        {u.providerUrl && <a className="btn small ghost" href={u.providerUrl} target="_blank" rel="noreferrer">{t("Afspreken")}</a>}
        <button className="btn small" onClick={() => setDoneAsk(true)}>✓ {t("Gedaan")}</button>
        <button className="iconbtn" aria-label={t("Attest of foto toevoegen")} onClick={() => fileRef.current?.click()}>📎</button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
        <button className="iconbtn" aria-label={t("Bewerken")} onClick={() => setEdit(true)}>✎</button>
        <button className="iconbtn" aria-label={t("Verwijderen")} onClick={() => setAsk(true)}>✕</button>
      </span>
      {(u.attest || u.log.length > 0 || u.notes) && (
        <div className="upk-more">
          {u.notes && <p className="hint">{u.notes}</p>}
          {u.attest && <a href={photoUrl(u.attest)} target="_blank" rel="noreferrer" className="upk-attest"><img src={photoUrl(u.attest)} alt={t("Attest")} /> {t("Attest")}</a>}
          {u.log.length > 0 && <small className="muted">{t("Gedaan op")}: {u.log.slice(0, 4).map((l) => shortDate(l.doneOn)).join(", ")}</small>}
        </div>
      )}
      {edit && <UpkeepForm u={u} onClose={() => setEdit(false)} />}
      {ask && <Confirm title={t("Verwijderen?")} text={u.title} onClose={() => setAsk(false)} actions={[{ label: t("Verwijderen"), kind: "danger", run: () => act(() => api.del(`/upkeep/${u.id}`), t("Verwijderd")) }]} />}
      {doneAsk && (
        <Modal title={`✓ ${u.title}`} onClose={() => setDoneAsk(false)}>
          <label className="field"><span>{t("Gedaan op")}</span><input type="date" value={doneOn} onChange={(e) => setDoneOn(e.target.value)} /></label>
          <label className="field"><span>{t("Notitie (optioneel)")}</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("bv. goedgekeurd, volgende keer banden")} /></label>
          {u.intervalMonths > 0 && <p className="hint">{t("De volgende datum wordt vanzelf {n} maanden later gezet.", { n: u.intervalMonths })}</p>}
          <div className="actions"><button className="btn ghost" onClick={() => setDoneAsk(false)}>{t("Annuleren")}</button><button className="btn" onClick={async () => { if (await act(() => api.post(`/upkeep/${u.id}/done`, { date: doneOn, note }), t("Afgevinkt ✔"))) setDoneAsk(false); }}>{t("Afvinken")}</button></div>
        </Modal>
      )}
    </div>
  );
}

function Templates({ onClose }: { onClose: () => void }) {
  const act = useAction();
  const [tpl] = useRemote<UpkeepTemplate[]>("/upkeep/templates", [], []);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const tr = getLang() === "tr";
  const groups = new Map<string, UpkeepTemplate[]>(); for (const x of tpl) groups.set(x.category, [...(groups.get(x.category) ?? []), x]);
  return (
    <Modal title={t("Kies wat voor jullie huis geldt")} onClose={onClose} wide>
      <p className="hint">{t("Wettelijke keuringen en gewone onderhoudsbeurten voor een Belgisch gezin, met de juiste termijn. Zet daarna per item de laatste datum, en {brand} verwittigt op tijd.")}</p>
      {[...groups.entries()].map(([cat, list]) => (
        <div className="field" key={cat}><span>{t(CATS[cat] ?? cat)}</span>
          <div className="picks">{list.map((x) => <button type="button" key={x.key} className="pick" aria-pressed={sel.has(x.key)} onClick={() => setSel((s) => { const n = new Set(s); if (n.has(x.key)) n.delete(x.key); else n.add(x.key); return n; })}>{x.icon} {tr ? x.titleTr : x.title} <small className="muted">· {x.intervalMonths} {t("mnd")}</small></button>)}</div>
        </div>
      ))}
      <div className="actions"><button className="btn ghost" onClick={onClose}>{t("Annuleren")}</button><button className="btn" disabled={!sel.size} onClick={async () => { if (await act(() => api.post("/upkeep/templates", { keys: [...sel] }), t("Toegevoegd ✔"))) onClose(); }}>{t("Toevoegen")} ({sel.size})</button></div>
    </Modal>
  );
}

function UpkeepTab() {
  const { data } = useData();
  const [list] = useRemote<Upkeep[]>("/upkeep", ["home"], []);
  const [add, setAdd] = useState(false); const [tpl, setTpl] = useState(false);
  const order: Upkeep["status"][] = ["late", "due", "soon", "none", "ok"];
  const sorted = [...list].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || (a.nextDue ?? "9").localeCompare(b.nextDue ?? "9"));
  return (
    <div className="home-tab">
      <div className="section-title"><h2>{t("Onderhoud en keuringen")}</h2><div style={{ display: "flex", gap: 6 }}><button className="btn small ghost" onClick={() => setTpl(true)}>📋 {t("Uit de lijst")}</button><button className="btn small" onClick={() => setAdd(true)}>+ {t("Nieuw")}</button></div></div>
      {!list.length && <div className="empty-card"><p className="empty">{t("Autokeuring, CV-ketel, rookmelders, verzekeringen, Kids-ID… Kies uit de lijst wat voor jullie huis geldt; {brand} verwittigt op tijd en zet het op voorstel in de agenda.")}</p><button className="btn" onClick={() => setTpl(true)}>📋 {t("Kies uit de lijst")}</button></div>}
      <div className="upks">{sorted.map((u) => <UpkeepCard key={u.id} u={u} members={data?.members ?? []} />)}</div>
      {add && <UpkeepForm onClose={() => setAdd(false)} />}
      {tpl && <Templates onClose={() => setTpl(false)} />}
    </div>
  );
}

/* ---------- Afvalkalender ---------- */
function WasteTab() {
  const { data, toast } = useData();
  const act = useAction();
  const [w, reload] = useRemote<WasteData | null>("/waste", ["home", "settings"], null);
  const [add, setAdd] = useState(false);
  const [f, setF] = useState({ fraction: "rest", weekday: 1, everyWeeks: 1, startDate: todayIso() });
  const [ical, setIcal] = useState(data?.settings.waste_ical ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setIcal(data?.settings.waste_ical ?? ""); }, [data?.settings.waste_ical]);
  const tr = getLang() === "tr";
  const label = (id: string) => { const x = w?.fractions.find((f) => f.id === id); return x ? `${x.icon} ${tr ? x.tr : x.nl}` : id; };
  const sync = async () => {
    setBusy(true);
    const ok = await act(() => api.put("/settings", { waste_ical: ical.trim() }));
    if (ok && ical.trim()) { const r = await act(() => api.post<{ count: number }>("/waste/sync")); if (r) toast(t("{n} ophaaldagen ingelezen", { n: r.count })); }
    setBusy(false); reload();
  };
  return (
    <div className="home-tab">
      <div className="section-title"><h2>{t("Afvalkalender")}</h2><button className="btn small" onClick={() => setAdd(true)}>+ {t("Vaste ophaaldag")}</button></div>
      <div className="grid2 home-two">
        <section className="card card-pad">
          <h3>{t("Komende ophalingen")}</h3>
          {w && !w.next.length && <p className="empty">{t("Nog niets. Plak hiernaast het iCal-adres van je intercommunale, of zet vaste ophaaldagen.")}</p>}
          <div className="waste-days">{(w?.next ?? []).slice(0, 10).map((d) => <div className="waste-day" key={d.date}><b>{diffDays(todayIso(), d.date) <= 6 ? cap(relDay(d.date)) : shortDate(d.date)}</b><small className="muted">{diffDays(todayIso(), d.date) <= 6 ? shortDate(d.date) : t("over {d} dagen", { d: diffDays(todayIso(), d.date) })}</small><span>{d.fractions.map((fr) => <i key={fr} className="chip-sm">{label(fr)}</i>)}</span></div>)}</div>
          <p className="hint">{t("De avond ervoor om {t} krijgt iedereen een seintje: “morgen PMD en papier”. Tijd te wijzigen bij Instellingen → Meldingen.", { t: data?.settings.waste_notify ?? "20:00" })}</p>
        </section>
        <section className="card card-pad">
          <h3>{t("Bron")}</h3>
          <label className="field"><span>{t("iCal-adres van je intercommunale")}</span><input type="url" value={ical} onChange={(e) => setIcal(e.target.value)} placeholder="https://… .ics" /></label>
          <small className="muted">{t("Limburg.net, Ilva, IVAREM, IOK, Interza en de meeste andere geven dit per adres via hun site of de Recycle!-app (“agenda exporteren”).")}</small>
          <div className="actions" style={{ justifyContent: "flex-start" }}><button className="btn" disabled={busy} onClick={sync}>{busy ? "…" : t("Bewaren en inlezen")}</button></div>
          {w && w.rules.length > 0 && <>
            <h3>{t("Vaste ophaaldagen")}</h3>
            {w.rules.map((r) => <div className="waste-rule" key={r.id}><span>{label(r.fraction)}</span><small className="muted">{t("elke")} {r.everyWeeks > 1 ? t("{n} weken op", { n: r.everyWeeks }) : ""} {DAYS[r.weekday]}</small><button className="iconbtn" aria-label={t("Verwijderen")} onClick={() => act(() => api.del(`/waste/${r.id}`))}>✕</button></div>)}
          </>}
        </section>
      </div>
      {add && (
        <Modal title={t("Vaste ophaaldag")} onClose={() => setAdd(false)}>
          <label className="field"><span>{t("Fractie")}</span><select value={f.fraction} onChange={(e) => setF({ ...f, fraction: e.target.value })}>{(w?.fractions ?? []).map((x) => <option key={x.id} value={x.id}>{x.icon} {tr ? x.tr : x.nl}</option>)}</select></label>
          <div className="field"><span>{t("Weekdag")}</span><div className="picks">{[1, 2, 3, 4, 5, 6, 0].map((d) => <button type="button" key={d} className="pick" aria-pressed={f.weekday === d} onClick={() => setF({ ...f, weekday: d })}>{cap(DSHORT[d])}</button>)}</div></div>
          <div className="grid2">
            <label className="field"><span>{t("Om de … weken")}</span><input type="number" min={1} max={8} value={f.everyWeeks} onChange={(e) => setF({ ...f, everyWeeks: Number(e.target.value) || 1 })} /></label>
            <label className="field"><span>{t("Eerste ophaling vanaf")}</span><input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></label>
          </div>
          <div className="actions"><button className="btn ghost" onClick={() => setAdd(false)}>{t("Annuleren")}</button><button className="btn" onClick={async () => { if (await act(() => api.post("/waste", f), t("Toegevoegd ✔"))) setAdd(false); }}>{t("Toevoegen")}</button></div>
        </Modal>
      )}
    </div>
  );
}

/* ---------- Gezondheid ---------- */
const KIND_ICON: Record<HealthKind, string> = { visit: "🩺", checkup: "🔁", vaccine: "💉", medication: "💊" };
const KIND_LABEL: Record<HealthKind, string> = { visit: "Doktersbezoek", checkup: "Controle", vaccine: "Vaccin", medication: "Medicatie" };

function HealthForm({ h, memberId, onClose }: { h?: HealthItem; memberId: string; onClose: () => void }) {
  const act = useAction();
  const [f, setF] = useState({ memberId: h?.memberId ?? memberId, kind: h?.kind ?? "visit" as HealthKind, title: h?.title ?? "", date: h?.date ?? "", time: h?.time ?? "", provider: h?.provider ?? "", providerPhone: h?.providerPhone ?? "", notes: h?.notes ?? "", followUpMonths: h?.followUpMonths ?? 0, times: h?.times ?? "08:00", days: h?.days ?? [0, 1, 2, 3, 4, 5, 6], stock: h?.stock ?? null as number | null });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const med = f.kind === "medication";
  const save = async () => {
    if (!f.title.trim()) return;
    const body = { ...f, date: f.date || null, time: f.time || null, stock: med && f.stock !== null && !Number.isNaN(f.stock) ? f.stock : null, followUpMonths: Number(f.followUpMonths) || 0 };
    if (await act(() => (h ? api.put(`/care/${h.id}`, body) : api.post("/care", body)), t("Bewaard"))) onClose();
  };
  return (
    <Modal title={h ? t("Bewerken") : t("Nieuw")} onClose={onClose}>
      <div className="seg" style={{ alignSelf: "flex-start" }}>{(Object.keys(KIND_LABEL) as HealthKind[]).map((k) => <button key={k} aria-pressed={f.kind === k} onClick={() => set("kind", k)}>{KIND_ICON[k]} {t(KIND_LABEL[k])}</button>)}</div>
      <label className="field"><span>{t("Wat")}</span><input value={f.title} autoFocus onChange={(e) => set("title", e.target.value)} placeholder={med ? t("bv. Ventolin 2 pufs") : t("bv. Tandarts, oogarts, logopedie")} /></label>
      {!med && <div className="grid2">
        <label className="field"><span>{t("Datum")}</span><input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} /></label>
        <label className="field"><span>{t("Uur")}</span><input type="time" value={f.time} onChange={(e) => set("time", e.target.value)} /></label>
        <label className="field"><span>{t("Bij wie")}</span><input value={f.provider} onChange={(e) => set("provider", e.target.value)} placeholder={t("Dr. …")} /></label>
        <label className="field"><span>{t("Telefoon")}</span><input value={f.providerPhone} onChange={(e) => set("providerPhone", e.target.value)} /></label>
        <label className="field" style={{ gridColumn: "1 / -1" }}><span>{t("Opvolging: nieuwe controle na … maanden (0 = geen)")}</span><input type="number" min={0} max={120} value={f.followUpMonths} onChange={(e) => set("followUpMonths", Number(e.target.value))} /></label>
      </div>}
      {med && <>
        <label className="field"><span>{t("Innametijden (komma's)")}</span><input value={f.times} onChange={(e) => set("times", e.target.value)} placeholder="08:00, 20:00" /></label>
        <div className="field"><span>{t("Dagen")}</span><div className="picks">{[1, 2, 3, 4, 5, 6, 0].map((d) => <button type="button" key={d} className="pick" aria-pressed={f.days.includes(d)} onClick={() => set("days", f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d])}>{cap(DSHORT[d])}</button>)}</div></div>
        <div className="grid2">
          <label className="field"><span>{t("Voorraad (stuks, leeg = niet bijhouden)")}</span><input type="number" min={0} value={f.stock ?? ""} onChange={(e) => set("stock", e.target.value === "" ? null : Number(e.target.value))} /></label>
          <label className="field"><span>{t("Tot en met")}</span><input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} /></label>
        </div>
      </>}
      <label className="field"><span>{t("Notities")}</span><textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></label>
      <div className="actions"><button className="btn ghost" onClick={onClose}>{t("Annuleren")}</button><button className="btn" disabled={!f.title.trim()} onClick={save}>{t("Bewaren")}</button></div>
    </Modal>
  );
}

function CareTab() {
  const { data } = useData();
  const act = useAction();
  const dev = getDevice();
  const people = (data?.members ?? []).filter((m) => m.role !== "huisdier");
  const [who, setWho] = useState<string>(dev.memberId ?? data?.me.memberId ?? people[0]?.id ?? "");
  const [list] = useRemote<HealthItem[]>(who ? `/care?member=${who}` : null, ["home"], []);
  const [add, setAdd] = useState(false); const [edit, setEdit] = useState<HealthItem | null>(null);
  const open = list.filter((h) => !h.done); const done = list.filter((h) => h.done);
  const meds = open.filter((h) => h.kind === "medication"); const appts = open.filter((h) => h.kind !== "medication").sort((a, b) => (a.date ?? "9").localeCompare(b.date ?? "9"));
  const m = people.find((p) => p.id === who);
  return (
    <div className="home-tab" style={m ? cvar(m.color) : undefined}>
      <div className="section-title"><h2>{t("Gezondheid")}</h2><button className="btn small" disabled={!who} onClick={() => setAdd(true)}>+ {t("Nieuw")}</button></div>
      <div className="picks">{people.map((p) => <button type="button" key={p.id} className="pick pick-person" style={cvar(p.color)} aria-pressed={who === p.id} onClick={() => setWho(p.id)}><Avatar m={p} size={22} dot={false} /> {p.name}</button>)}</div>
      <p className="hint">{t("Per persoon, en alleen zichtbaar voor dit gezin. Een controle met opvolging plant zichzelf opnieuw; medicatie komt in de briefing van die persoon.")}</p>
      {!list.length && <p className="empty">{t("Nog niets voor {n}.", { n: m?.name ?? "" })}</p>}
      {appts.length > 0 && <div className="upks">{appts.map((h) => (
        <div className={`upk ${h.date && diffDays(todayIso(), h.date) < 0 ? "late" : h.date && diffDays(todayIso(), h.date) <= 7 ? "soon" : "ok"}`} key={h.id}>
          <span className="upk-ic" aria-hidden>{KIND_ICON[h.kind]}</span>
          <span className="upk-txt"><b>{h.title}</b><small>{h.date ? `${cap(relDay(h.date))}${h.time ? ` ${fmtTime(h.time)}` : ""} · ${shortDate(h.date)}` : t("Nog geen datum")}{h.provider ? ` · ${h.provider}` : ""}{h.followUpMonths ? ` · ${t("opvolging om de {n} mnd", { n: h.followUpMonths })}` : ""}</small>{h.providerPhone && <small className="muted"><a href={`tel:${h.providerPhone.replace(/\s/g, "")}`}>{h.providerPhone}</a></small>}</span>
          <span className="upk-btns"><button className="btn small" onClick={() => act(() => api.post(`/care/${h.id}/done`), h.followUpMonths ? t("Afgevinkt; volgende controle staat klaar") : t("Afgevinkt ✔"))}>✓ {t("Geweest")}</button><button className="iconbtn" aria-label={t("Bewerken")} onClick={() => setEdit(h)}>✎</button><button className="iconbtn" aria-label={t("Verwijderen")} onClick={() => act(() => api.del(`/care/${h.id}`))}>✕</button></span>
        </div>
      ))}</div>}
      {meds.length > 0 && <><h3 className="brief-sub">💊 {t("Medicatie")}</h3><div className="upks">{meds.map((h) => (
        <div className="upk ok" key={h.id}>
          <span className="upk-ic" aria-hidden>💊</span>
          <span className="upk-txt"><b>{h.title}</b><small>{h.times}{h.days.length < 7 ? ` · ${h.days.map((d) => DSHORT[d]).join(", ")}` : ""}{h.stock !== null ? ` · ${t("nog {n} stuks", { n: h.stock })}` : ""}{h.date ? ` · ${t("tot {d}", { d: shortDate(h.date) })}` : ""}</small></span>
          <span className="upk-btns"><button className="iconbtn" aria-label={t("Bewerken")} onClick={() => setEdit(h)}>✎</button><button className="iconbtn" aria-label={t("Stoppen")} onClick={() => act(() => api.post(`/care/${h.id}/done`), t("Gestopt"))}>✕</button></span>
        </div>
      ))}</div></>}
      {done.length > 0 && <Fold title={t("Geweest")} hint={`${done.length}`}><div className="upks">{done.slice(0, 20).map((h) => <div className="upk ok dim" key={h.id}><span className="upk-ic" aria-hidden>{KIND_ICON[h.kind]}</span><span className="upk-txt"><b>{h.title}</b><small>{h.date ? shortDate(h.date) : ""}{h.provider ? ` · ${h.provider}` : ""}</small></span><span className="upk-btns"><button className="iconbtn" aria-label={t("Verwijderen")} onClick={() => act(() => api.del(`/care/${h.id}`))}>✕</button></span></div>)}</div></Fold>}
      {add && who && <HealthForm memberId={who} onClose={() => setAdd(false)} />}
      {edit && <HealthForm h={edit} memberId={edit.memberId} onClose={() => setEdit(null)} />}
    </div>
  );
}

/* ---------- Slim huis (Home Assistant) ---------- */
const MOMENTS: { id: string; label: string; icon: string }[] = [{ id: "morning", label: "Ochtend", icon: "☀️" }, { id: "sleep", label: "Slapen", icon: "🌙" }, { id: "away", label: "Weg", icon: "🚪" }, { id: "home", label: "Thuis", icon: "🏠" }, { id: "ezan", label: "Gebedstijd", icon: "🕌" }];
function stateLabel(s: HaState) {
  const unit = typeof s.attributes.unit_of_measurement === "string" ? s.attributes.unit_of_measurement : "";
  const map: Record<string, string> = { on: t("aan"), off: t("uit"), home: t("thuis"), not_home: t("weg"), locked: t("op slot"), unlocked: t("open"), open: t("open"), closed: t("dicht"), unavailable: t("niet bereikbaar"), heat: t("verwarmen"), idle: t("rust"), playing: t("speelt") };
  return `${map[s.state] ?? s.state}${unit ? ` ${unit}` : ""}`;
}
function SmartTab() {
  const { data, toast } = useData();
  const act = useAction();
  const s = data?.settings;
  const admin = data?.me.role === "beheerder";
  const [url, setUrl] = useState(s?.ha_url ?? ""); const [token, setToken] = useState(""); const [entities, setEntities] = useState(s?.ha_entities ?? "");
  const [scenes, setScenes] = useState<Record<string, string>>(() => { try { return JSON.parse(s?.ha_scenes || "{}"); } catch { return {}; } });
  const [setup, setSetup] = useState(false);
  const configured = !!s?.ha_configured || !!s?.ha_url;
  const [states, reload] = useRemote<HaState[] | { error: string }>(configured ? "/ha/states" : null, ["settings"], []);
  const [all] = useRemote<HaState[] | { error: string }>(setup && configured ? "/ha/states?all=1" : null, [], []);
  const list = Array.isArray(states) ? states : []; const allList = Array.isArray(all) ? all : [];
  const toggle = async (st: HaState) => { const [domain] = st.entity_id.split("."); const on = st.state === "on"; await act(() => api.post("/ha/call", { domain: domain === "light" || domain === "switch" || domain === "fan" || domain === "input_boolean" ? domain : "homeassistant", service: on ? "turn_off" : "turn_on", data: { entity_id: st.entity_id } })); setTimeout(reload, 600); };
  const lockOrCover = async (st: HaState, service: string) => { const [domain] = st.entity_id.split("."); await act(() => api.post("/ha/call", { domain, service, data: { entity_id: st.entity_id } })); setTimeout(reload, 800); };
  const saveSetup = async () => {
    const body: Record<string, string> = { ha_url: url.trim(), ha_entities: entities, ha_scenes: JSON.stringify(scenes) }; if (token.trim()) body.ha_token = token.trim();
    const ok = await act(() => api.put("/settings", body), t("Bewaard"));
    if (ok) { const r = await api.post<{ ok: boolean; message: string }>("/ha/test").catch((e: Error) => ({ ok: false, message: e.message })); toast(r.ok ? t("Verbonden met Home Assistant ✔") : `⚠️ ${r.message}`); setSetup(false); reload(); }
  };
  const groups = new Map<string, HaState[]>(); for (const st of list) { const d = st.entity_id.split(".")[0]; groups.set(d, [...(groups.get(d) ?? []), st]); }
  const DOM: Record<string, string> = { light: "Verlichting", switch: "Schakelaars", scene: "Scènes", script: "Scripts", climate: "Verwarming", lock: "Sloten", cover: "Rolluiken en poorten", person: "Wie is thuis", device_tracker: "Toestellen", sensor: "Sensoren", binary_sensor: "Melders", media_player: "Media", input_boolean: "Schakelaars", fan: "Ventilatie", vacuum: "Robotstofzuiger", alarm_control_panel: "Alarm" };
  const name = (st: HaState) => (typeof st.attributes.friendly_name === "string" ? st.attributes.friendly_name : st.entity_id);
  return (
    <div className="home-tab">
      <div className="section-title"><h2>{t("Slim huis")}</h2>{admin && <button className="btn small ghost" onClick={() => setSetup(true)}>⚙️ {configured ? t("Instellen") : t("Koppelen met Home Assistant")}</button>}</div>
      {!configured && <div className="empty-card"><p className="empty">{t("{brand} stuurt je huis via Home Assistant: dat praat met Philips Hue, IKEA, Shelly, Tado, Nest, Sonos, Somfy en honderden andere merken. Draai Home Assistant op een Raspberry Pi of mini-pc, maak een token aan, en kies hier wat je op het bord wilt. Lampen en stekkers van de Action, Lidl of een ander merk dat met de Smart Life-app werkt? Koppel die zonder Home Assistant via Instellingen → Koppelingen → Tuya / Smart Life.")}</p>{admin && <button className="btn" onClick={() => setSetup(true)}>{t("Koppelen met Home Assistant")}</button>}</div>}
      {configured && (
        <>
          <div className="picks">{MOMENTS.filter((m) => scenes[m.id]).map((m) => <button type="button" key={m.id} className="pick" onClick={() => act(() => api.post("/ha/moment", { moment: m.id }), t("{m} gestart", { m: t(m.label) }))}>{m.icon} {t(m.label)}</button>)}</div>
          {!Array.isArray(states) && states && "error" in states && <p className="error">⚠️ {states.error}</p>}
          {[...groups.entries()].map(([d, sts]) => (
            <section className="card card-pad" key={d}>
              <h3>{t(DOM[d] ?? d)}</h3>
              <div className="ha-grid">{sts.map((st) => {
                const toggleable = ["light", "switch", "fan", "input_boolean", "media_player"].includes(d); const on = st.state === "on" || st.state === "playing";
                return (
                  <div className={`ha-tile${on ? " on" : ""}`} key={st.entity_id}>
                    <b>{name(st)}</b>
                    <small>{stateLabel(st)}</small>
                    {toggleable && <label className="switch"><input type="checkbox" checked={on} onChange={() => toggle(st)} /><span /></label>}
                    {(d === "scene" || d === "script") && <button className="btn small" onClick={() => act(() => api.post("/ha/call", { domain: d, service: "turn_on", data: { entity_id: st.entity_id } }), t("Gestart"))}>▶</button>}
                    {d === "lock" && <button className="btn small ghost" onClick={() => lockOrCover(st, st.state === "locked" ? "unlock" : "lock")}>{st.state === "locked" ? "🔓" : "🔒"}</button>}
                    {d === "cover" && <span className="upk-btns"><button className="btn small ghost" onClick={() => lockOrCover(st, "open_cover")}>▲</button><button className="btn small ghost" onClick={() => lockOrCover(st, "close_cover")}>▼</button></span>}
                  </div>
                );
              })}</div>
            </section>
          ))}
          {configured && !list.length && Array.isArray(states) && <p className="empty">{t("Niets gekozen om te tonen. Kies toestellen bij ⚙️ Instellen.")}</p>}
        </>
      )}
      {setup && (
        <Modal title={t("Home Assistant")} onClose={() => setSetup(false)} wide>
          <label className="field"><span>{t("Adres van Home Assistant")}</span><input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://homeassistant.local:8123" /></label>
          <label className="field"><span>{t("Token (langdurig toegangstoken)")}</span><input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={s?.ha_configured ? "••••••  (" + t("leeg = ongewijzigd") + ")" : ""} autoComplete="off" /><small className="muted">{t("In Home Assistant: je profiel → Beveiliging → Langdurige toegangstokens. Wordt versleuteld bewaard en nooit naar de browser gestuurd.")}</small></label>
          {allList.length > 0 && (
            <div className="field"><span>{t("Wat op het bord mag ({n} gekozen)", { n: entities.split(",").filter(Boolean).length })}</span>
              <div className="picks ha-picks">{allList.filter((st) => !st.entity_id.startsWith("sensor.") || /temp|humid|power|energy|co2|batter/i.test(st.entity_id)).slice(0, 200).map((st) => { const set = new Set(entities.split(",").map((x) => x.trim()).filter(Boolean)); const onIt = set.has(st.entity_id); return <button type="button" key={st.entity_id} className="pick" aria-pressed={onIt} onClick={() => { if (onIt) set.delete(st.entity_id); else set.add(st.entity_id); setEntities([...set].join(",")); }}>{name(st)}</button>; })}</div>
            </div>
          )}
          <div className="field"><span>{t("Momenten: welke scène of script hoort erbij")}</span>
            {MOMENTS.map((m) => <label className="field" key={m.id} style={{ gap: 4 }}><span>{m.icon} {t(m.label)}</span>
              {allList.length ? <select value={scenes[m.id] ?? ""} onChange={(e) => setScenes({ ...scenes, [m.id]: e.target.value })}><option value="">—</option>{allList.filter((st) => st.entity_id.startsWith("scene.") || st.entity_id.startsWith("script.")).map((st) => <option key={st.entity_id} value={st.entity_id}>{name(st)}</option>)}</select>
                : <input value={scenes[m.id] ?? ""} onChange={(e) => setScenes({ ...scenes, [m.id]: e.target.value })} placeholder="scene.slapen" />}
            </label>)}
            <small className="muted">{t("Slapen en Ochtend lopen vanzelf op de slaaptijden van het bord; Gebedstijd bij de ezan; Weg en Thuis via het aanwezigheidsgevoel van Home Assistant.")}</small>
          </div>
          <div className="actions"><button className="btn ghost" onClick={() => setSetup(false)}>{t("Annuleren")}</button><button className="btn" disabled={!url.trim()} onClick={saveSetup}>{t("Bewaren en testen")}</button></div>
        </Modal>
      )}
    </div>
  );
}

/* ---------- het scherm ---------- */
export function HomeApp() {
  const [tab, setTab] = useState<Tab>(() => { try { return (sessionStorage.getItem("gb.home.tab") as Tab) || "upkeep"; } catch { return "upkeep"; } });
  const pick = (x: Tab) => { setTab(x); try { sessionStorage.setItem("gb.home.tab", x); } catch { /* */ } };
  return (
    <div className="page-scroll home" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="seg home-seg">
        <button aria-pressed={tab === "upkeep"} onClick={() => pick("upkeep")}>🔧 {t("Onderhoud")}</button>
        <button aria-pressed={tab === "waste"} onClick={() => pick("waste")}>♻️ {t("Afval")}</button>
        <button aria-pressed={tab === "care"} onClick={() => pick("care")}>🩺 {t("Gezondheid")}</button>
        <button aria-pressed={tab === "smart"} onClick={() => pick("smart")}>💡 {t("Slim huis")}</button>
      </div>
      {tab === "upkeep" && <UpkeepTab />}
      {tab === "waste" && <WasteTab />}
      {tab === "care" && <CareTab />}
      {tab === "smart" && <SmartTab />}
    </div>
  );
}

/** Widget op het Bord: wat er aan het huis te doen is. Toont niets als alles in orde is. */
export function HomeWidget({ onOpen }: { onOpen?: () => void }) {
  const [upk] = useRemote<Upkeep[]>("/upkeep", ["home"], []);
  const [w] = useRemote<WasteData | null>("/waste", ["home", "settings"], null);
  const tr = getLang() === "tr";
  const todo = upk.filter((u) => u.status === "late" || u.status === "due" || u.status === "soon").slice(0, 3);
  const tomorrow = addDays(todayIso(), 1);
  const nextWaste = (w?.next ?? []).find((d) => d.date === todayIso() || d.date === tomorrow);
  if (!todo.length && !nextWaste) return null;
  const label = (id: string) => { const x = w?.fractions.find((f) => f.id === id); return x ? `${x.icon} ${tr ? x.tr : x.nl}` : id; };
  return (
    <section className="glass widget-sm homew">
      <div className="widget-h"><h2>🏠 {t("Het huis")}</h2>{onOpen && <button className="linkbtn" onClick={onOpen}>{t("Alles")}</button>}</div>
      {nextWaste && <div className="fam-line"><span>♻️</span><span>{nextWaste.date === todayIso() ? t("Vandaag ophaling") : t("Morgen ophaling, vanavond buitenzetten")}: {nextWaste.fractions.map(label).join(", ")}</span></div>}
      {todo.map((u) => <div className="fam-line" key={u.id}><span>{u.icon}</span><span><b>{u.title}</b> · <span className={`st-${u.status}`}>{u.nextDue ? (u.daysLeft! < 0 ? t("{d} dagen te laat", { d: -u.daysLeft! }) : u.daysLeft === 0 ? t("vandaag") : t("{d}", { d: longDate(u.nextDue) })) : ""}</span></span></div>)}
    </section>
  );
}
