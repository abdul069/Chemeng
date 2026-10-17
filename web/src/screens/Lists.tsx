import { useState } from "react";
import { navParam, useNavParam } from "../nav";
import { api } from "../api";
import { useAction, useData } from "../store";
import { isShopping, type List, type ListItem, type Staple } from "../types";
import { useRemote } from "../store";
import { Confirm, Modal } from "../components/ui";
import { Icon } from "../components/Icons";
import { diffDays, shortDate, todayIso } from "../dates";
import { AISLES, AISLE_INFO, aisleOf } from "../aisles";
import { PantryCook } from "../components/LibraryBrowser";

/** Houdbaarheid van een voorraad-item: "verlopen", "vandaag", "nog 3 dagen" … */
function expiry(i: ListItem): { label: string; cls: string } | null {
  if (!i.expires) return null;
  const d = diffDays(todayIso(), i.expires);
  if (d < 0) return { label: `verlopen (${shortDate(i.expires)})`, cls: "exp bad" };
  if (d === 0) return { label: "verloopt vandaag", cls: "exp bad" };
  if (d <= 3) return { label: `verloopt over ${d} dag${d > 1 ? "en" : ""}`, cls: "exp warn" };
  return { label: `tot ${shortDate(i.expires)}`, cls: "exp" };
}

export function ListsScreen({ header }: { header: React.ReactNode }) {
  const { data, toast } = useData();
  const act = useAction();
  const [sel, setSel] = useState<string | null>(() => navParam("list"));
  useNavParam("list", setSel);
  const [text, setText] = useState("");
  const [qty, setQty] = useState("");
  const [expires, setExpires] = useState("");
  const [newList, setNewList] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [edit, setEdit] = useState<ListItem | null>(null);
  const [cook, setCook] = useState(false);
  const [grouped, setGrouped] = useState(() => { try { return localStorage.getItem("gb.aisles") !== "0"; } catch { return true; } });
  if (!data) return null;
  const list = data.lists.find((l) => l.id === sel) ?? data.lists[0];
  const pantry = list?.kind === "pantry";
  // boodschappen per afdeling in de winkel; afgevinkte onderaan
  const isShop = !!list && isShopping(list);
  const toggleGrouped = () => { setGrouped(!grouped); try { localStorage.setItem("gb.aisles", grouped ? "0" : "1"); } catch { /* */ } };
  const sections: { key: string; items: ListItem[] }[] = (() => {
    if (!list) return [];
    if (!(isShop && grouped)) return [{ key: "", items: list.items }];
    const open = list.items.filter((i) => !i.done); const done = list.items.filter((i) => i.done);
    const by = new Map<string, ListItem[]>();
    for (const i of open) { const k = i.aisle ?? aisleOf(i.text); by.set(k, [...(by.get(k) ?? []), i]); }
    const order = [...AISLES.map((a) => a.key), "overig"];
    return [...order.filter((k) => by.has(k)).map((k) => ({ key: k, items: by.get(k)! })), ...(done.length ? [{ key: "done", items: done }] : [])];
  })();

  const add = async () => {
    const parts = text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (!list || !parts.length) return;
    setText("");
    for (const p of parts) await act(() => api.post(`/lists/${list.id}/items`, pantry ? { text: p, qty, expires: expires || null } : { text: p }));
    setQty(""); setExpires("");
  };
  const soon = pantry ? list.items.filter((i) => !i.done && i.expires && diffDays(todayIso(), i.expires) <= 3).length : 0;

  return (
    <>
      <div className="topbar">
        {header}
        <div className="right"><button className="pill" onClick={() => setNewList(true)}>+ Nieuwe lijst</button></div>
      </div>
      <div className="lists">
        <nav className="list-nav" aria-label="Lijsten">
          {data.lists.map((l) => {
            const warn = l.kind === "pantry" ? l.items.filter((i) => !i.done && i.expires && diffDays(todayIso(), i.expires) <= 3).length : 0;
            return (
              <button key={l.id} aria-current={l.id === list?.id} onClick={() => setSel(l.id)}>
                <span>{l.icon}</span>{l.name}<span className="n">{warn ? <i className="exp warn" title="bijna over datum">⚠️{warn} </i> : null}{l.items.filter((i) => !i.done).length}</span>
              </button>
            );
          })}
        </nav>
        {list ? (
          <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0, overflow: "auto" }}>
            <div className="section-title">
              <h2>{list.icon} {list.name}</h2>
              <div style={{ display: "flex", gap: 6 }}>
                {list.items.some((i) => i.done) && <button className="linkbtn" onClick={() => act(() => api.post(`/lists/${list.id}/clear-done`), pantry ? "Opgebruikte items gewist" : "Afgevinkte items gewist")}>{pantry ? "Opgebruikte wissen" : "Afgevinkte wissen"}</button>}
                {isShop && <button className="linkbtn" onClick={toggleGrouped}>{grouped ? "Per afdeling ✓" : "Per afdeling"}</button>}
                <button className="iconbtn" aria-label="Lijst delen" title="Lijst delen (WhatsApp, sms…)" onClick={async () => {
                  const open = list.items.filter((i) => !i.done);
                  const text = `${list.icon} ${list.name}\n${open.map((i) => `• ${i.text}${i.qty ? ` (${i.qty})` : ""}`).join("\n")}`;
                  try { if (navigator.share) await navigator.share({ title: list.name, text }); else { await navigator.clipboard.writeText(text); toast("Lijst gekopieerd"); } } catch { /* geannuleerd */ }
                }}>↗</button>
                <button className="iconbtn" aria-label="Lijst verwijderen" onClick={() => setConfirm(true)}><Icon.trash /></button>
              </div>
            </div>
            {pantry && list.items.some((i) => !i.done) && <button className="btn accent" style={{ alignSelf: "flex-start" }} onClick={() => setCook(true)}>🍳 Koken met wat in huis is</button>}
            {pantry && <p className="hint">Wat er in huis is, met houdbaarheidsdatum. {soon ? `${soon} item(s) zijn bijna of al over datum. ` : ""}Vink af wat op is: het komt vanzelf op de boodschappenlijst. Wat je koopt en afvinkt op Boodschappen, komt hier terug.</p>}
            {isShop ? <StaplesInline list={list} /> : (
            <form className="addrow" onSubmit={(e) => { e.preventDefault(); add(); }}>
              <input id="item-new" value={text} onChange={(e) => setText(e.target.value)} placeholder={pantry ? "bv. yoghurt" : "Toevoegen… (meerdere met komma's)"} aria-label="Nieuw item" />
              {pantry && <input id="item-qty" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="aantal" aria-label="Aantal" style={{ width: 90, flex: "none" }} />}
              {pantry && <input id="item-exp" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} aria-label="Houdbaar tot" style={{ width: 150, flex: "none" }} />}
              <button className="btn" type="submit" disabled={!text.trim()}>Toevoegen</button>
            </form>)}
            <div className="items">
              {sections.map((sec) => (<div key={sec.key || "all"} className="items">
              {sec.key && <div className="aisle-h">{sec.key === "done" ? "✓ Afgevinkt" : `${AISLE_INFO[sec.key].icon} ${AISLE_INFO[sec.key].name}`}<span className="muted num">{sec.items.length}</span></div>}
              {sec.items.map((i) => {
                const ex = pantry ? expiry(i) : null;
                return (
                  <div className={`item${i.done ? " done" : ""}`} key={i.id}>
                    <button className="check" aria-pressed={i.done} aria-label={`${i.text} ${i.done ? "terug open zetten" : pantry ? "als op markeren" : "afvinken"}`} onClick={async () => { const r = await act(() => api.patch<{ ok: boolean; moved: { to: string } | null }>(`/items/${i.id}`, { done: !i.done })); if (r?.moved) toast(`${i.text} → ${r.moved.to}`); }}>{i.done ? "✓" : ""}</button>
                    <span className="txt" style={{ flex: 1, minWidth: 0 }}>
                      {i.text}{i.qty && <small className="muted"> · {i.qty}</small>}
                      {ex && <small className={ex.cls} style={{ display: "block" }}>{ex.label}</small>}
                    </span>
                    {(pantry || isShop) && <button className="iconbtn" style={{ width: 36, height: 36 }} aria-label={`${i.text} bewerken`} onClick={() => setEdit(i)}>✎</button>}
                    <button className="iconbtn" style={{ width: 36, height: 36 }} aria-label={`${i.text} verwijderen`} onClick={() => act(() => api.del(`/items/${i.id}`))}><Icon.trash /></button>
                  </div>
                );
              })}
              </div>))}
              {!list.items.length && <p className="empty">{pantry ? "Nog niets in voorraad. Voeg toe wat je in huis hebt, met houdbaarheidsdatum." : isShop ? "De lijst is leeg. Tik hierboven aan wat je nodig hebt." : "De lijst is leeg. Typ hierboven of vraag het aan de assistent."}</p>}
            </div>
          </section>
        ) : <p className="empty">Nog geen lijsten.</p>}
      </div>
      {newList && <NewList onClose={() => setNewList(false)} onCreated={setSel} hasPantry={data.lists.some((l) => l.kind === "pantry")} hasShop={data.lists.some(isShopping)} />}
      {edit && <ItemEditor item={edit} shop={isShop} onClose={() => setEdit(null)} />}
      {cook && <PantryCook onClose={() => setCook(false)} />}
      {confirm && list && <Confirm title={`${list.name} verwijderen?`} text="Alle items op deze lijst verdwijnen." onClose={() => setConfirm(false)}
        actions={[{ label: "Verwijderen", run: () => { act(() => api.del(`/lists/${list.id}`), "Lijst verwijderd"); setSel(null); } }]} />}
    </>
  );
}

function ItemEditor({ item, shop, onClose }: { item: ListItem; shop?: boolean; onClose: () => void }) {
  const act = useAction();
  const [f, setF] = useState({ text: item.text, qty: item.qty, expires: item.expires ?? "", aisle: item.aisle ?? "" });
  const auto = aisleOf(f.text);
  const save = async () => {
    if (await act(() => api.patch(`/items/${item.id}`, { text: f.text, qty: f.qty, expires: f.expires || null, aisle: f.aisle || null }), "Bewaard")) onClose();
  };
  return (
    <Modal title={shop ? "Boodschap" : "Voorraad-item"} onClose={onClose}>
      <label className="field"><span>Wat</span><input id="ie-text" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></label>
      <label className="field"><span>Aantal</span><input id="ie-qty" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} placeholder="bv. 2 pakken" /></label>
      {shop && (
        <div className="field"><span>Afdeling</span>
          <div className="picks">
            <button type="button" className="pick" aria-pressed={!f.aisle} onClick={() => setF({ ...f, aisle: "" })}>Automatisch ({AISLE_INFO[auto].icon} {AISLE_INFO[auto].name})</button>
            {[...AISLES.map((a) => a.key), "overig"].map((k) => <button type="button" key={k} className="pick" aria-pressed={f.aisle === k} onClick={() => setF({ ...f, aisle: k })}>{AISLE_INFO[k].icon} {AISLE_INFO[k].name}</button>)}
          </div>
        </div>
      )}
      {!shop && <label className="field"><span>Houdbaar tot</span><input id="ie-exp" type="date" value={f.expires} onChange={(e) => setF({ ...f, expires: e.target.value })} /></label>}
      <div className="actions"><button className="btn ghost" onClick={onClose}>Annuleren</button><button className="btn" disabled={!f.text.trim()} onClick={save}>Bewaren</button></div>
    </Modal>
  );
}

function NewList({ onClose, onCreated, hasPantry, hasShop }: { onClose: () => void; onCreated: (id: string) => void; hasPantry: boolean; hasShop: boolean }) {
  const act = useAction();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("📝");
  const [kind, setKind] = useState<List["kind"]>("list");
  const save = async () => {
    const r = await act(() => api.post<{ id: string }>("/lists", { name, icon, kind }), "Lijst gemaakt");
    if (r) { onCreated(r.id); onClose(); }
  };
  return (
    <Modal title="Nieuwe lijst" onClose={onClose}>
      <div className="addrow">
        <input id="nl-icon" value={icon} onChange={(e) => setIcon(e.target.value)} style={{ width: 64, flex: "none" }} aria-label="Icoon" />
        <input id="nl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="bv. Inpaklijst vakantie" aria-label="Naam" onKeyDown={(e) => e.key === "Enter" && name.trim() && save()} />
      </div>
      {(!hasPantry || !hasShop) && (
        <div className="field"><span>Soort</span>
          <div className="picks">
            <button type="button" className="pick" aria-pressed={kind === "list"} onClick={() => setKind("list")}>📝 Gewone lijst</button>
            {!hasShop && <button type="button" className="pick" aria-pressed={kind === "shopping"} onClick={() => { setKind("shopping"); if (!name) setName("Boodschappen"); if (icon === "📝") setIcon("🛒"); }}>🛒 Boodschappen (per afdeling)</button>}
            {!hasPantry && <button type="button" className="pick" aria-pressed={kind === "pantry"} onClick={() => { setKind("pantry"); if (!name) setName("Voorraad"); if (icon === "📝") setIcon("🥫"); }}>🥫 Voorraad (met houdbaarheid)</button>}
          </div>
        </div>
      )}
      <div className="actions"><button className="btn ghost" onClick={onClose}>Annuleren</button><button className="btn" disabled={!name.trim()} onClick={save}>Maken</button></div>
    </Modal>
  );
}

/** Boodschappen kies je uit de vaste producten van het gezin; typen is alleen nodig voor iets nieuws, en dat wordt dan meteen een vast product. */
function StaplesInline({ list }: { list: List }) {
  const act = useAction();
  const [staples, reload] = useRemote<Staple[]>("/staples", ["lists"], []);
  const [q, setQ] = useState("");
  const [manage, setManage] = useState(false);
  const [open, setOpen] = useState(() => { try { return localStorage.getItem("gb.staples.open") !== "0"; } catch { return true; } });
  const toggleOpen = () => { setOpen(!open); try { localStorage.setItem("gb.staples.open", open ? "0" : "1"); } catch { /* */ } };
  const onList = new Map(list.items.filter((i) => !i.done).map((i) => [i.text.toLocaleLowerCase("nl"), i]));
  const fold = (x: string) => x.toLocaleLowerCase("nl").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const f = fold(q.trim());
  const shown = f ? staples.filter((st) => fold(st.text).includes(f)) : staples;
  const exact = staples.some((st) => fold(st.text) === f);
  const toggle = async (st: Staple) => {
    const on = onList.get(st.text.toLocaleLowerCase("nl"));
    if (on) await act(() => api.del(`/items/${on.id}`));
    else await act(() => api.post(`/lists/${list.id}/items`, { text: st.text, aisle: st.aisle ?? aisleOf(st.text) }));
  };
  /** Iets nieuws: op de lijst én in de vaste producten (één keer typen, daarna altijd aan te tikken). */
  const addNew = async () => {
    const parts = q.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return;
    setQ("");
    for (const t of parts) {
      const existing = staples.find((st) => fold(st.text) === fold(t));
      if (!existing) await act(() => api.post("/staples", { text: t, aisle: aisleOf(t) }));
      if (!onList.has(t.toLocaleLowerCase("nl"))) await act(() => api.post(`/lists/${list.id}/items`, { text: existing?.text ?? t, aisle: existing?.aisle ?? aisleOf(t) }));
    }
    reload();
  };
  const groups = [...AISLES.map((a) => a.key), "overig"].map((k) => ({ k, items: shown.filter((st) => (st.aisle ?? aisleOf(st.text)) === k) })).filter((g) => g.items.length);
  return (
    <div className="staples-inline">
      <form className="addrow" onSubmit={(e) => { e.preventDefault(); if (f && !exact) addNew(); else if (shown.length === 1) { toggle(shown[0]); setQ(""); } }}>
        <input id="item-new" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek of typ een product… (nieuw = ook vast product)" aria-label="Zoek of typ een product" />
        {f && !exact && <button className="btn" type="submit">+ “{q.trim()}” toevoegen</button>}
        {q && <button type="button" className="iconbtn" onClick={() => setQ("")} aria-label="Wissen"><Icon.close /></button>}
      </form>
      <div className="section-title" style={{ marginBottom: 0 }}>
        <button className="linkbtn" onClick={toggleOpen} aria-expanded={open}>{open ? "▾" : "▸"} Vaste producten <span className="muted num">({staples.length})</span></button>
        <span className="hint">Tik aan = op de lijst · nog eens = eraf{open ? <> · <button className="linkbtn" onClick={() => setManage(!manage)}>{manage ? "Klaar" : "Beheren"}</button></> : null}</span>
      </div>
      {(open || f) && (
        <div className="staples">
          {groups.map((g) => (
            <section key={g.k}>
              <div className="aisle-h">{AISLE_INFO[g.k].icon} {AISLE_INFO[g.k].name}</div>
              <div className="picks">
                {g.items.map((st) => {
                  const on = onList.has(st.text.toLocaleLowerCase("nl"));
                  return (
                    <button key={st.id} type="button" className={`pick staple${manage ? " manage" : ""}`} aria-pressed={on}
                      onClick={() => (manage ? act(() => api.del(`/staples/${st.id}`), `${st.text} is geen vast product meer`).then(() => reload()) : toggle(st))}
                      title={manage ? "Uit de vaste producten halen" : on ? "Van de lijst halen" : "Op de lijst zetten"}>
                      {on && !manage ? "✓ " : manage ? "✕ " : ""}{st.text}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          {f && !shown.length && <p className="hint">Nog geen vast product met “{q.trim()}”. Druk op Enter om het toe te voegen; voortaan kun je het aantikken.</p>}
        </div>
      )}
    </div>
  );
}
