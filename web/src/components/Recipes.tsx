import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAction, useData } from "../store";
import type { Recipe, RecipeHit, Slot } from "../types";
import { Confirm, Modal } from "./ui";
import { PhotoPicker } from "./PhotoPicker";
import { DSHORT, MSHORT, addDays, todayIso, weekday } from "../dates";

/** Een recept openen vanaf eender welk scherm. */
export const openRecipe = (id: string) => window.dispatchEvent(new CustomEvent("gb:recipe", { detail: id }));

export function RecipeHost() {
  const { data } = useData();
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const h = (e: Event) => setId((e as CustomEvent<string>).detail);
    window.addEventListener("gb:recipe", h);
    return () => window.removeEventListener("gb:recipe", h);
  }, []);
  const recipe = data?.recipes.find((r) => r.id === id);
  if (!id || !recipe) return null;
  return <RecipeDetail recipe={recipe} onClose={() => setId(null)} />;
}

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export function RecipeThumb({ r, size = 56 }: { r: Pick<Recipe, "image" | "title">; size?: number }) {
  return r.image
    ? <img className="rthumb" src={r.image} alt="" style={{ width: size, height: size }} loading="lazy" referrerPolicy="no-referrer" />
    : <span className="rthumb ph" style={{ width: size, height: size }} aria-hidden>🍲</span>;
}

export function RecipeCard({ r, onOpen }: { r: Recipe; onOpen: () => void }) {
  return (
    <button className="rcard" onClick={onOpen}>
      {r.image ? <img src={r.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="rcard-ph" aria-hidden>🍲</span>}
      <span className="rcard-body">
        <b>{r.title}</b>
        <small>{[r.minutes ? `${r.minutes} min` : null, `${lines(r.ingredients).length} ingrediënten`, r.cuisine || null].filter(Boolean).join(" · ")}</small>
      </span>
    </button>
  );
}

/** Het recept: ingrediënten afvinken, ontbrekende op de boodschappenlijst, inplannen en bereiden. */
export function RecipeDetail({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const { data, toast } = useData();
  const act = useAction();
  const ingredients = useMemo(() => lines(recipe.ingredients), [recipe.ingredients]);
  const steps = lines(recipe.instructions);
  const [have, setHave] = useState<Set<number>>(new Set());
  const [plan, setPlan] = useState(false);
  const [edit, setEdit] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState(false);
  const shop = data?.lists.find((l) => /boodschap/i.test(l.name)) ?? data?.lists[0];
  const missing = ingredients.filter((_, i) => !have.has(i));
  const toggle = (i: number) => setHave((h) => { const n = new Set(h); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  const toList = async () => {
    if (!shop) { toast("Maak eerst een boodschappenlijst bij Lijsten."); return; }
    const r = await act(() => api.post<{ added: number; skipped: number }>(`/recipes/${recipe.id}/to-list`, { listId: shop.id, items: missing }));
    if (r) toast(r.added ? `${r.added} op ${shop.name} gezet${r.skipped ? ` (${r.skipped} stonden er al)` : ""}` : "Alles stond al op de lijst");
  };
  const translate = async () => {
    setBusy(true);
    await act(() => api.post(`/recipes/${recipe.id}/translate`), "Vertaald naar het Nederlands");
    setBusy(false);
  };

  if (edit) return <RecipeEditor recipe={recipe} onClose={() => setEdit(false)} />;
  return (
    <Modal title={recipe.title} onClose={onClose} wide>
      <div className="rhero-wrap">
        {recipe.image ? <img className="rhero" src={recipe.image} alt="" referrerPolicy="no-referrer" /> : <div className="rhero ph" aria-hidden>🍲</div>}
        <button className="pill rhero-btn" onClick={() => setPhoto(true)}>📷 {recipe.image ? "Foto wijzigen" : "Foto toevoegen"}</button>
      </div>
      <div className="rmeta">
        {recipe.minutes && <span className="badge">⏱ {recipe.minutes} min</span>}
        {recipe.servings && <span className="badge">🍽 {recipe.servings}</span>}
        {recipe.cuisine && <span className="badge">{recipe.cuisine}</span>}
        {recipe.sourceUrl && <a className="linkbtn" href={recipe.sourceUrl} target="_blank" rel="noreferrer">Bron: {new URL(recipe.sourceUrl).hostname.replace(/^www\./, "")} ↗</a>}
      </div>
      <div className="actions" style={{ justifyContent: "flex-start" }}>
        <button className="btn accent" onClick={() => setPlan(true)}>📅 Inplannen</button>
        <button className="btn" onClick={toList} disabled={!missing.length}>🛒 {missing.length === ingredients.length ? "Alles" : `${missing.length} ontbrekende`} op {shop?.name ?? "de boodschappenlijst"}</button>
        {data?.assistant.available && recipe.cuisine === "Turks" && <button className="btn ghost" onClick={translate} disabled={busy}>{busy ? "Vertalen…" : "Vertaal naar Nederlands"}</button>}
      </div>
      <section>
        <div className="section-title"><h2>Ingrediënten</h2><span className="hint">Vink aan wat je al in huis hebt</span></div>
        <div className="ingr">
          {ingredients.map((x, i) => (
            <label key={i} className={`ingr-row${have.has(i) ? " have" : ""}`}>
              <input type="checkbox" checked={have.has(i)} onChange={() => toggle(i)} />
              <span>{x}</span>
            </label>
          ))}
          {!ingredients.length && <p className="hint">Geen ingrediënten ingevuld.</p>}
        </div>
      </section>
      <section>
        <div className="section-title"><h2>Bereiding</h2></div>
        <ol className="steps">{steps.map((s, i) => <li key={i} className={s.startsWith("—") ? "sect" : ""}>{s.replace(/^\d+[.)]\s*/, "")}</li>)}</ol>
        {!steps.length && <p className="hint">Geen bereiding ingevuld.</p>}
      </section>
      <div className="actions">
        <button className="btn danger left" onClick={() => setConfirm(true)}>Verwijderen</button>
        <button className="btn ghost" onClick={() => setEdit(true)}>Bewerken</button>
      </div>
      {plan && <PlanRecipe recipe={recipe} onClose={() => setPlan(false)} />}
      {photo && <PhotoPicker title={recipe.title.replace(/\s*(tarifi|\(.*\))\s*/gi, " ").trim()} current={recipe.image}
        onPick={(image) => act(() => api.put(`/recipes/${recipe.id}/image`, { image }), image ? "Foto bewaard" : "Foto weggehaald")} onClose={() => setPhoto(false)} />}
      {confirm && <Confirm title="Recept verwijderen?" onClose={() => setConfirm(false)}
        actions={[{ label: "Verwijderen", run: async () => { if (await act(() => api.del(`/recipes/${recipe.id}`), "Recept verwijderd")) onClose(); } }]} />}
    </Modal>
  );
}

function PlanRecipe({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const act = useAction();
  const [date, setDate] = useState(todayIso());
  const [slot, setSlot] = useState<Slot>("diner");
  const days = Array.from({ length: 7 }, (_, i) => addDays(todayIso(), i));
  const save = async () => {
    if (await act(() => api.put("/meals", { date, slot, title: recipe.title, recipeId: recipe.id }), `Ingepland op ${DSHORT[weekday(date)]} ${Number(date.slice(8))} ${MSHORT[Number(date.slice(5, 7)) - 1]}`)) onClose();
  };
  return (
    <Modal title="Wanneer koken we dit?" onClose={onClose}>
      <div className="picks">
        {days.map((d, i) => <button key={d} className="pick" aria-pressed={date === d} onClick={() => setDate(d)}>{i === 0 ? "Vandaag" : i === 1 ? "Morgen" : `${DSHORT[weekday(d)]} ${Number(d.slice(8))}`}</button>)}
      </div>
      <label className="field"><span>Of kies een datum</span><input id="plan-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <div className="picks">
        {(["ontbijt", "lunch", "diner", "snack"] as Slot[]).map((s) => <button key={s} className="pick" aria-pressed={slot === s} onClick={() => setSlot(s)}>{s}</button>)}
      </div>
      <div className="actions"><button className="btn ghost" onClick={onClose}>Annuleren</button><button className="btn" onClick={save}>Inplannen</button></div>
    </Modal>
  );
}

export function RecipeEditor({ recipe, onClose }: { recipe?: Recipe; onClose: () => void }) {
  const act = useAction();
  const [f, setF] = useState({
    title: recipe?.title ?? "", ingredients: recipe?.ingredients ?? "", instructions: recipe?.instructions ?? "",
    minutes: recipe?.minutes ?? (null as number | null), image: recipe?.image ?? null, sourceUrl: recipe?.sourceUrl ?? null,
    servings: recipe?.servings ?? "", cuisine: recipe?.cuisine ?? "",
  });
  const save = async () => {
    if (!f.title.trim()) return;
    if (await act(() => (recipe ? api.put(`/recipes/${recipe.id}`, f) : api.post("/recipes", f)), "Recept bewaard")) onClose();
  };
  return (
    <Modal title={recipe ? "Recept bewerken" : "Eigen recept"} onClose={onClose} wide>
      <div className="row2">
        <label className="field"><span>Naam</span><input id="rc-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="field"><span>Keuken</span><input id="rc-cuisine" value={f.cuisine} onChange={(e) => setF({ ...f, cuisine: e.target.value })} placeholder="bv. Turks" /></label>
      </div>
      <div className="row2">
        <label className="field"><span>Bereidingstijd (minuten)</span><input id="rc-min" type="number" min={0} value={f.minutes ?? ""} onChange={(e) => setF({ ...f, minutes: e.target.value ? Number(e.target.value) : null })} /></label>
        <label className="field"><span>Porties</span><input id="rc-serv" value={f.servings} onChange={(e) => setF({ ...f, servings: e.target.value })} placeholder="bv. 4 personen" /></label>
      </div>
      <label className="field"><span>Ingrediënten (één per regel)</span><textarea id="rc-ing" rows={7} value={f.ingredients} onChange={(e) => setF({ ...f, ingredients: e.target.value })} /></label>
      <label className="field"><span>Bereiding (één stap per regel)</span><textarea id="rc-ins" rows={7} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></label>
      <label className="field"><span>Link naar een foto (optioneel)</span><input id="rc-img" value={f.image ?? ""} onChange={(e) => setF({ ...f, image: e.target.value || null })} placeholder="https://…" /></label>
      <div className="actions"><button className="btn ghost" onClick={onClose}>Annuleren</button><button className="btn" onClick={save} disabled={!f.title.trim()}>Bewaren</button></div>
    </Modal>
  );
}

const IDEAS = ["Karnıyarık", "Mercimek çorbası", "İmam bayıldı", "Mantı", "Kuru fasulye", "Su böreği", "Tavuk sote", "Menemen", "Etli nohut", "Sütlaç"];

/** Zoeken op Turkse receptwebsites en in de bibliotheek zetten. */
export function RecipeSearch({ onClose }: { onClose: () => void }) {
  const { data, toast } = useData();
  const act = useAction();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<RecipeHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [translate, setTranslate] = useState(true);
  const search = async (query: string) => {
    setQ(query);
    setBusy(true);
    setHits(null);
    const r = await act(() => api.post<RecipeHit[]>("/recipes/search", { query }));
    setHits(r ?? []);
    setBusy(false);
  };
  const add = async (h: RecipeHit) => {
    setAdding(h.url);
    const r = await act(() => api.post<{ id: string; existing: boolean }>("/recipes/import", { url: h.url, translate }));
    setAdding(null);
    if (r) { toast(r.existing ? "Stond al in je bibliotheek" : "In de bibliotheek gezet"); onClose(); setTimeout(() => openRecipe(r.id), 400); }
  };
  const inLibrary = new Set(data?.recipes.map((r) => r.sourceUrl).filter(Boolean));
  return (
    <Modal title="Turkse recepten zoeken" onClose={onClose} wide>
      <p className="hint">We zoeken op nefisyemektarifleri.com, yemek.com, lezzet.com.tr, Arda'nın Mutfağı, Refika'nın Mutfağı en meer. Zoek in het Turks of het Nederlands.</p>
      <form className="addrow" onSubmit={(e) => { e.preventDefault(); if (q.trim().length > 1) search(q.trim()); }}>
        <input id="rs-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="bv. kip met rijst, köfte, linzensoep…" aria-label="Zoek een recept" />
        <button className="btn" type="submit" disabled={busy || q.trim().length < 2}>{busy ? "Zoeken…" : "Zoeken"}</button>
      </form>
      <div className="picks">{IDEAS.map((i) => <button key={i} className="pick" onClick={() => search(i)} disabled={busy}>{i}</button>)}</div>
      <label className="check-row"><input type="checkbox" checked={translate} onChange={(e) => setTranslate(e.target.checked)} disabled={!data?.assistant.available} /> Vertalen naar het Nederlands bij het toevoegen</label>
      {busy && <p className="hint">Even zoeken op de receptsites… dit duurt een halve minuut.</p>}
      {hits && !hits.length && !busy && <p className="empty">Niets gevonden. Probeer een ander woord, of plak de link van een recept via “Via link toevoegen”.</p>}
      <div className="rgrid">
        {hits?.map((h) => (
          <div className="rcard" key={h.url}>
            {h.image ? <img src={h.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="rcard-ph" aria-hidden>🍲</span>}
            <span className="rcard-body">
              <b>{h.title}</b>
              <small>{h.site}{h.minutes ? ` · ${h.minutes} min` : ""}</small>
              <span style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                {inLibrary.has(h.url)
                  ? <span className="badge">In je bibliotheek</span>
                  : <button className="btn small" onClick={() => add(h)} disabled={adding !== null}>{adding === h.url ? "Toevoegen…" : "+ Bibliotheek"}</button>}
                <a className="btn ghost small" href={h.url} target="_blank" rel="noreferrer">Bekijken ↗</a>
              </span>
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function RecipeImport({ onClose }: { onClose: () => void }) {
  const { data, toast } = useData();
  const act = useAction();
  const [url, setUrl] = useState("");
  const [translate, setTranslate] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const r = await act(() => api.post<{ id: string; existing: boolean }>("/recipes/import", { url: url.trim(), translate }));
    setBusy(false);
    if (r) { toast(r.existing ? "Stond al in je bibliotheek" : "Recept toegevoegd"); onClose(); setTimeout(() => openRecipe(r.id), 400); }
  };
  return (
    <Modal title="Recept via link" onClose={onClose}>
      <p className="hint">Plak de link van een recept, bv. van nefisyemektarifleri.com of yemek.com. Naam, foto, ingrediënten en bereiding worden overgenomen.</p>
      <input id="ri-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.nefisyemektarifleri.com/…" aria-label="Link naar het recept" />
      <label className="check-row"><input type="checkbox" checked={translate} onChange={(e) => setTranslate(e.target.checked)} disabled={!data?.assistant.available} /> Vertalen naar het Nederlands</label>
      <div className="actions"><button className="btn ghost" onClick={onClose}>Annuleren</button><button className="btn" onClick={go} disabled={busy || !/^https?:\/\//.test(url.trim())}>{busy ? "Ophalen…" : "Toevoegen"}</button></div>
    </Modal>
  );
}
