import { useEffect, useState } from "react";
import { api } from "../api";
import { useAction, useData } from "../store";
import { Modal } from "./ui";
import { openRecipe } from "./Recipes";
import { navParam, useNavParam } from "../nav";

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

  if (!ov) return <p className="hint">Bibliotheek laden…</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {ov.crawl.running && <p className="hint">⏳ De bibliotheek wordt opgebouwd: {ov.crawl.site ?? "…"} · {ov.crawl.done}/{ov.crawl.total} pagina's gelezen, {ov.crawl.added} recepten toegevoegd. Je kunt ondertussen al bladeren.</p>}
      {!ov.total && !ov.crawl.running && (
        <p className="empty">De gedeelde bibliotheek is nog leeg. {admin ? <button className="linkbtn" onClick={() => act(() => api.post("/library/crawl"), "Opbouwen gestart").then(loadOverview)}>Nu opbouwen</button> : "De beheerder kan ze laten opbouwen."}</p>
      )}
      <div className="addrow">
        <input id="lb-q" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={`Zoek in ${ov.total} Turkse recepten (Nederlands of Turks)`} aria-label="Zoek in alle Turkse recepten" />
        {ov.total > 0 && <button className="btn ghost small" title="Een willekeurig recept uit deze selectie" onClick={async () => {
          const params = new URLSearchParams({ limit: "1", random: "1" }); if (cat) params.set("category", cat); if (q) params.set("q", q);
          const r = await api.get<{ items: Row[] }>(`/library?${params}`).catch(() => null);
          if (r?.items[0]) setOpen(r.items[0].id);
        }}>🎲 Verras me</button>}
        {admin && !ov.crawl.running && ov.total > 0 && <button className="btn ghost small" title="Nieuwe recepten van de sites ophalen" onClick={() => act(() => api.post("/library/crawl"), "Bijwerken gestart").then(loadOverview)}>⟳</button>}
      </div>
      <div className="picks catrow">
        <button className="pick" aria-pressed={!cat} onClick={() => setCat(null)}>Alles <small className="muted">{ov.total}</small></button>
        {ov.categories.map((c) => <button key={c.key} className="pick" aria-pressed={cat === c.key} onClick={() => setCat(c.key)}>{c.icon} {c.name} <small className="muted">{c.n}</small></button>)}
      </div>
      <div className="rgrid">
        {rows.map((r) => (
          <button className="rcard" key={r.id} onClick={() => setOpen(r.id)}>
            {r.image ? <img src={r.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="rcard-ph" aria-hidden>🍲</span>}
            <span className="rcard-body">
              <b>{r.title}</b>
              {r.title !== r.titleTr && <small lang="tr">🇹🇷 {r.titleTr}</small>}
              <small>{[r.minutes ? `${r.minutes} min` : null, r.site, r.inLibrary ? "✓ in je bibliotheek" : null].filter(Boolean).join(" · ")}</small>
            </span>
          </button>
        ))}
      </div>
      {!busy && !rows.length && ov.total > 0 && <p className="empty">Niets gevonden{q ? ` voor “${q}”` : ""}.</p>}
      {rows.length < total && <button className="btn ghost" disabled={busy} onClick={() => load(rows.length)}>{busy ? "Laden…" : `Meer tonen (${rows.length} van ${total})`}</button>}
      {open && <LibraryDetail id={open} onClose={() => setOpen(null)} onAdded={() => load(0)} />}
    </div>
  );
}

function LibraryDetail({ id, onClose, onAdded }: { id: string; onClose: () => void; onAdded: () => void }) {
  const { data, toast } = useData();
  const act = useAction();
  const [r, setR] = useState<Full | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [orig, setOrig] = useState(false);
  const [adding, setAdding] = useState(false);
  useEffect(() => { api.get<Full>(`/library/${id}`).then(setR).catch((e) => setErr((e as Error).message)); }, [id]);
  const v = r && orig && r.original ? r.original : r;
  const add = async () => {
    setAdding(true);
    const res = await act(() => api.post<{ id: string; existing: boolean }>(`/library/${id}/add`));
    setAdding(false);
    if (res) { toast(res.existing ? "Stond al in je bibliotheek" : "In je bibliotheek gezet"); onAdded(); onClose(); setTimeout(() => openRecipe(res.id), 400); }
  };
  return (
    <Modal title={v?.title ?? "Recept"} onClose={onClose} wide>
      {err && <p className="error">{err}</p>}
      {!r && !err && <p className="hint">Recept laden{data?.assistant.available ? " en vertalen" : ""}…</p>}
      {r && v && (
        <>
          {r.image && <img src={r.image} alt="" style={{ width: "100%", maxHeight: 260, objectFit: "cover", borderRadius: 16 }} referrerPolicy="no-referrer" />}
          <div className="picks">
            {r.original && <button className="pick" aria-pressed={!orig} onClick={() => setOrig(false)}>🇳🇱 Nederlands</button>}
            {r.original && <button className="pick" aria-pressed={orig} onClick={() => setOrig(true)}>🇹🇷 Türkçe</button>}
            {!r.original && r.lang === "tr" && <span className="badge">🇹🇷 Turks origineel{data?.assistant.available ? "" : " · vertalen kan zodra de assistent ingesteld is"}</span>}
            {r.minutes && <span className="badge">⏱ {r.minutes} min</span>}
            {r.warnings?.length > 0 && <span className="badge warn">⚠️ Bevat: {r.warnings.join(", ")}</span>}
            {r.servings && <span className="badge">🍽 {r.servings}</span>}
          </div>
          <div className="recipe-cols">
            <div><h3>Ingrediënten</h3><ul>{lines(v.ingredients).map((l, i) => <li key={i}>{l}</li>)}</ul></div>
            <div><h3>Bereiding</h3><ol>{lines(v.instructions).map((l, i) => <li key={i}>{l.replace(/^\d+[.)]\s*/, "")}</li>)}</ol></div>
          </div>
          <div className="actions">
            {r.sourceUrl && <a className="btn ghost small left" href={r.sourceUrl} target="_blank" rel="noreferrer">Bron ↗</a>}
            <button className="btn ghost" onClick={onClose}>Sluiten</button>
            {r.inLibraryId
              ? <button className="btn" onClick={() => { onClose(); openRecipe(r.inLibraryId!); }}>Openen in mijn bibliotheek</button>
              : <button className="btn accent" disabled={adding} onClick={add}>{adding ? "Toevoegen…" : "+ In mijn bibliotheek"}</button>}
          </div>
        </>
      )}
    </Modal>
  );
}
