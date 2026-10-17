import { useEffect, useState } from "react";
import { api } from "../api";
import { useAction, useData } from "../store";
import { Modal, Pic } from "./ui";
import { openRecipe } from "./Recipes";
import { navParam, useNavParam } from "../nav";
import { t, getLang } from "../i18n";

interface Cat { key: string; name: string; icon: string; n: number }
interface Row { id: string; sourceUrl: string; site: string; category: string; title: string; titleTr: string; image: string | null; minutes: number | null; servings: string; translated: boolean; inLibrary: boolean }
interface Full { id: string; title: string; ingredients: string; instructions: string; minutes: number | null; image: string | null; sourceUrl: string | null; servings: string; lang: string; category: string; original: { title: string; ingredients: string; instructions: string; lang: string } | null; inLibraryId: string | null; warnings: string[] }
interface Overview { categories: Cat[]; total: number; crawl: { running: boolean; site: string | null; done: number; total: number; added: number; finishedAt: string | null } }

const PAGE = 60;
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

/** Bladeren door alle Turkse recepten (gedeelde bibliotheek), per categorie. */
export function LibraryBrowser() {
  const { data } = useData();
  const act = useAction();
  const [ov, setOv] = useState<Overview | null>(null);
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState(() => navParam("lib") ?? "");
  const [typed, setTyped] = useState(q);
  useNavParam("lib", (v) => { setTyped(v); setQ(v); setCat(null); });
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const admin = data?.me.role === "beheerder";
  // namen in het Turks tonen (per toestel onthouden)
  const [tr, setTr] = useState(() => { try { const v = localStorage.getItem("gb.libtr"); return v === null ? getLang() === "tr" : v === "1"; } catch { return getLang() === "tr"; } });
  const toggleTr = () => { setTr(!tr); try { localStorage.setItem("gb.libtr", tr ? "0" : "1"); } catch { /* */ } };

  const loadOverview = () => api.get<Overview>("/library/categories").then(setOv).catch(() => {});
  useEffect(() => { loadOverview(); }, []);
  useEffect(() => {
    if (!ov?.crawl.running) return;
    const t = setInterval(loadOverview, 5000);
    return () => clearInterval(t);
  }, [ov?.crawl.running]);
  useEffect(() => { const t = setTimeout(() => { setQ(typed.trim()); if (typed.trim()) setCat(null); }, 300); return () => clearTimeout(t); }, [typed]); // zoeken gaat over alle categorieën

  const load = async (offset: number) => {
    setBusy(true);
    const params = new URLSearchParams({ offset: String(offset), limit: String(PAGE) });
    if (cat) params.set("category", cat);
    if (q) params.set("q", q);
    const r = await api.get<{ total: number; items: Row[] }>(`/library?${params}`).catch(() => ({ total: 0, items: [] as Row[] }));
    setTotal(r.total);
    setRows((prev) => (offset ? [...prev, ...r.items] : r.items));
    setBusy(false);
  };
  useEffect(() => { load(0); }, [cat, q]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ov) return <p className="hint">{t("Bibliotheek laden…")}</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {ov.crawl.running && <p className="hint">⏳ De bibliotheek wordt opgebouwd: {ov.crawl.site ?? "…"} · {ov.crawl.done}/{ov.crawl.total} pagina's gelezen, {ov.crawl.added} recepten toegevoegd. Je kunt ondertussen al bladeren.</p>}
      {!ov.total && !ov.crawl.running && (
        <p className="empty">De gedeelde bibliotheek is nog leeg. {admin ? <button className="linkbtn" onClick={() => act(() => api.post("/library/crawl"), t("Opbouwen gestart")).then(loadOverview)}>{t("Nu opbouwen")}</button> : t("De beheerder kan ze laten opbouwen.")}</p>
      )}
      <div className="addrow">
        <input id="lb-q" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t("Zoek in {n} Turkse recepten (Nederlands of Turks)", { n: ov.total })} aria-label={t("Zoek in alle Turkse recepten")} />
        {ov.total > 0 && <button className="btn ghost small" aria-pressed={tr} title={t("Namen in het Turks tonen")} onClick={toggleTr}>{tr ? "🇹🇷" : "🇳🇱"}</button>}
        {ov.total > 0 && <button className="btn ghost small" title={t("Een willekeurig recept uit deze selectie")} onClick={async () => {
          const params = new URLSearchParams({ limit: "1", random: "1" }); if (cat) params.set("category", cat); if (q) params.set("q", q);
          const r = await api.get<{ items: Row[] }>(`/library?${params}`).catch(() => null);
          if (r?.items[0]) setOpen(r.items[0].id);
        }}>{t("🎲 Verras me")}</button>}
        {admin && !ov.crawl.running && ov.total > 0 && <button className="btn ghost small" title={t("Nieuwe recepten van de sites ophalen")} onClick={() => act(() => api.post("/library/crawl"), t("Bijwerken gestart")).then(loadOverview)}>⟳</button>}
      </div>
      <div className="picks catrow">
        <button className="pick" aria-pressed={!cat} onClick={() => setCat(null)}>{t("Alles")}{" "}<small className="muted">{ov.total}</small></button>
        {ov.categories.map((c) => <button key={c.key} className="pick" aria-pressed={cat === c.key} onClick={() => setCat(c.key)}>{c.icon} {c.name} <small className="muted">{c.n}</small></button>)}
      </div>
      <div className="rgrid">
        {rows.map((r) => (
          <button className="rcard" key={r.id} onClick={() => setOpen(r.id)}>
            <Pic src={r.image} className="rcard-img" phClass="rcard-ph" />
            <span className="rcard-body">
              <b>{tr ? r.titleTr : r.title}</b>
              {r.title !== r.titleTr && <small lang={tr ? "nl" : "tr"}>{tr ? `🇳🇱 ${r.title}` : `🇹🇷 ${r.titleTr}`}</small>}
              <small>{[r.minutes ? `${r.minutes} min` : null, r.site, r.inLibrary ? t("✓ in je bibliotheek") : null].filter(Boolean).join(" · ")}</small>
            </span>
          </button>
        ))}
      </div>
      {!busy && !rows.length && ov.total > 0 && <p className="empty">Niets gevonden{q ? ` voor “${q}”` : ""}.</p>}
      {rows.length < total && <button className="btn ghost" disabled={busy} onClick={() => load(rows.length)}>{busy ? t("Laden…") : `Meer tonen (${rows.length} van ${total})`}</button>}
      {open && <LibraryDetail id={open} onClose={() => setOpen(null)} onAdded={() => load(0)} />}
    </div>
  );
}

export function LibraryDetail({ id, onClose, onAdded }: { id: string; onClose: () => void; onAdded: () => void }) {
  const { data, toast } = useData();
  const act = useAction();
  const [r, setR] = useState<Full | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [orig, setOrig] = useState(getLang() === "tr");
  const [adding, setAdding] = useState(false);
  useEffect(() => { api.get<Full>(`/library/${id}`).then(setR).catch((e) => setErr((e as Error).message)); }, [id]);
  const v = r && orig && r.original ? r.original : r;
  const add = async () => {
    setAdding(true);
    const res = await act(() => api.post<{ id: string; existing: boolean }>(`/library/${id}/add`));
    setAdding(false);
    if (res) { toast(res.existing ? t("Stond al in je bibliotheek") : t("In je bibliotheek gezet")); onAdded(); onClose(); setTimeout(() => openRecipe(res.id), 400); }
  };
  return (
    <Modal title={v?.title ?? t("Recept")} onClose={onClose} wide>
      {err && <p className="error">{err}</p>}
      {!r && !err && <p className="hint">{data?.assistant.available ? t("Recept laden en vertalen…") : t("Recept laden…")}</p>}
      {r && v && (
        <>
          <Pic src={r.image} className="rhero" phClass="rhero ph" />
          <div className="picks">
            {r.original && <button className="pick" aria-pressed={!orig} onClick={() => setOrig(false)}>{t("🇳🇱 Nederlands")}</button>}
            {r.original && <button className="pick" aria-pressed={orig} onClick={() => setOrig(true)}>{t("🇹🇷 Türkçe")}</button>}
            {!r.original && r.lang === "tr" && <span className="badge">🇹🇷 Turks origineel{data?.assistant.available ? "" : t(" · vertalen kan zodra de assistent ingesteld is")}</span>}
            {r.minutes && <span className="badge">⏱ {r.minutes} min</span>}
            {r.warnings?.length > 0 && <span className="badge warn">⚠️ Bevat: {r.warnings.join(", ")}</span>}
            {r.servings && <span className="badge">🍽 {r.servings}</span>}
          </div>
          <div className="recipe-cols">
            <div><h3>{t("Ingrediënten")}</h3><ul>{lines(v.ingredients).map((l, i) => <li key={i}>{l}</li>)}</ul></div>
            <div><h3>{t("Bereiding")}</h3><ol>{lines(v.instructions).map((l, i) => <li key={i}>{l.replace(/^\d+[.)]\s*/, "")}</li>)}</ol></div>
          </div>
          <div className="actions">
            {r.sourceUrl && <a className="btn ghost small left" href={r.sourceUrl} target="_blank" rel="noreferrer">{t("Bron ↗")}</a>}
            <button className="btn ghost" onClick={onClose}>{t("Sluiten")}</button>
            {r.inLibraryId
              ? <button className="btn" onClick={() => { onClose(); openRecipe(r.inLibraryId!); }}>{t("Openen in mijn bibliotheek")}</button>
              : <button className="btn accent" disabled={adding} onClick={add}>{adding ? t("Toevoegen…") : t("+ In mijn bibliotheek")}</button>}
          </div>
        </>
      )}
    </Modal>
  );
}

/** "Koken met wat in huis is": recepten die de meeste voorraad-items gebruiken. */
export function PantryCook({ onClose }: { onClose: () => void }) {
  const [r, setR] = useState<{ words: string[]; items: (Row & { score: number })[]; pantryCount: number } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { api.get<{ words: string[]; items: (Row & { score: number })[]; pantryCount: number }>("/library/from-pantry").then(setR).catch(() => setR({ words: [], items: [], pantryCount: 0 })); }, []);
  return (
    <Modal title={t("Koken met wat in huis is")} onClose={onClose} wide>
      {!r && <p className="hint">{t("Even kijken wat er in de voorraad staat…")}</p>}
      {r && !r.pantryCount && <p className="empty">{t("De voorraad is leeg. Zet erin wat je in huis hebt (Lijsten → Voorraad), dan zoeken we er recepten bij.")}</p>}
      {r && r.pantryCount > 0 && <p className="hint">Gezocht op: {r.words.join(", ")}. Hoe meer van je voorraad een recept gebruikt, hoe hoger het staat.</p>}
      {r && r.pantryCount > 0 && !r.items.length && <p className="empty">{t("Nog geen recepten gevonden met deze ingrediënten.")}</p>}
      <div className="rgrid">
        {r?.items.map((x) => (
          <button className="rcard" key={x.id} onClick={() => setOpen(x.id)}>
            <Pic src={x.image} className="rcard-img" phClass="rcard-ph" />
            <span className="rcard-body"><b>{x.title}</b><small>✓ {x.score} uit je voorraad{x.minutes ? ` · ${x.minutes} min` : ""}{x.inLibrary ? t(" · in je bibliotheek") : ""}</small></span>
          </button>
        ))}
      </div>
      {open && <LibraryDetail id={open} onClose={() => setOpen(null)} onAdded={() => {}} />}
    </Modal>
  );
}
