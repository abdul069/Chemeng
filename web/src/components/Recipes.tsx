import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAction, useData } from "../store";
import type { Recipe, RecipeHit, Slot } from "../types";
import { isShopping } from "../types";
import { getLang } from "../i18n";

/** Titel van een recept in de taal van de app: in het Turks het origineel als dat er is. */
export const recipeTitle = (r: Pick<Recipe, "title" | "original">) => (getLang() === "tr" && r.original?.lang === "tr" ? r.original.title : r.title);
import { Confirm, Modal, Pic } from "./ui";
import { PhotoPicker } from "./PhotoPicker";
import { DSHORT, addDays, todayIso, weekday, shortDate } from "../dates";
import { parseServings, scaleLine } from "../portions";
import { CookMode } from "./CookMode";
import { NutritionBlock } from "./RecipeCalories";
import { ingredientIcon, splitIngredient } from "../ingredients";

import { CATS, catLabel } from "../categories";
import { cast, getDevice } from "../device";
import { t } from "../i18n";

const LANG: Record<string, string> = { tr: "Türkçe", nl: "Nederlands", en: "English", fr: "Français", ar: "العربية", de: t("Deutsch") };
const FLAG: Record<string, string> = { tr: "🇹🇷", nl: "🇳🇱", en: "🇬🇧", fr: "🇫🇷", de: "🇩🇪" };

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

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean)
  .flatMap((l) => (l.split(/(?<!\d),|,(?!\d)/).length >= 3 && l.length > 40 ? l.split(/(?<!\d),|,(?!\d)/).map((x) => x.trim()).filter(Boolean) : [l]));

export function RecipeThumb({ r, size = 56 }: { r: Pick<Recipe, "image" | "title">; size?: number }) {
  return <Pic src={r.image} className="rthumb" phClass="rthumb ph" style={{ width: size, height: size }} />;
}

export function RecipeCard({ r, onOpen }: { r: Recipe; onOpen: () => void }) {
  return (
    <button className="rcard" onClick={onOpen}>
      <Pic src={r.image} className="rcard-img" phClass="rcard-ph" />
      <span className="rcard-body">
        <b>{r.favorite ? "★ " : ""}{recipeTitle(r)}</b>
        <small>{[r.minutes ? `${r.minutes} min` : null, r.category ? catLabel(r.category) : null, r.cooked ? t("{n}× gekookt", { n: r.cooked }) : null].filter(Boolean).join(" · ")}</small>
      </span>
    </button>
  );
}

/** Het recept: ingrediënten afvinken, ontbrekende op de boodschappenlijst, inplannen en bereiden. */
export function RecipeDetail({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const { data, toast } = useData();
  const act = useAction();
  // Nederlands is de standaard; het origineel (bv. Turks) is één tik verder
  const [showOrig, setShowOrig] = useState(() => getLang() === "tr" && recipe.original?.lang === "tr");
  const version = showOrig && recipe.original ? recipe.original : recipe;
  const baseServings = parseServings(recipe.servings) ?? 4;
  const [servings, setServings] = useState(baseServings);
  const factor = servings / baseServings;
  const ingredients = useMemo(() => lines(version.ingredients).map((l) => scaleLine(l, factor)), [version.ingredients, factor]);
  const steps = lines(version.instructions);
  const notTranslated = recipe.lang !== "nl" && !recipe.original;
  const origLang = LANG[recipe.original?.lang ?? recipe.lang] ?? (recipe.original?.lang ?? recipe.lang);
  const [plan, setPlan] = useState(false);
  const [edit, setEdit] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState(false);
  const [cook, setCook] = useState(false);
  const shop = data?.lists.find(isShopping);
  // aangevinkt = nodig (standaard alles); vink af wat je al in huis hebt
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const missing = ingredients.filter((_, i) => !skip.has(i));
  // allergieën/voorkeuren uit de profielen
  const toggle = (i: number) => setSkip((h) => { const n = new Set(h); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  const toList = async () => {
    if (!missing.length) { toast(t("Vink eerst aan wat je nodig hebt.")); return; }
    const r = await act(() => api.post<{ added: number; skipped: number; list: string }>(`/recipes/${recipe.id}/to-list`, { listId: shop?.id, items: missing }));
    if (r) toast(r.added ? `${t("{n} op {l} gezet", { n: r.added, l: r.list })}${r.skipped ? ` ${t("({n} stonden er al)", { n: r.skipped })}` : ""}` : t("Alles stond al op de lijst"));
  };
  const translate = async () => {
    setBusy(true);
    await act(() => api.post(`/recipes/${recipe.id}/translate`), t("Vertaald naar het Nederlands"));
    setBusy(false);
  };

  if (edit) return <RecipeEditor recipe={recipe} onClose={() => setEdit(false)} />;
  return (
    <Modal title={version.title} onClose={onClose} wide>
      {recipe.original && (
        <div className="seg langseg" role="group" aria-label={t("Taal van het recept")}>
          <button aria-pressed={!showOrig} onClick={() => { setShowOrig(false); setSkip(new Set()); }}>{t("🇳🇱 Nederlands")}</button>
          <button aria-pressed={showOrig} onClick={() => { setShowOrig(true); setSkip(new Set()); }}>{FLAG[recipe.original.lang] ?? "🌐"} {origLang}</button>
        </div>
      )}
      {notTranslated && (
        <div className="invite-card">
          <b>Dit recept is nog in het {origLang.toLowerCase()}.</b>
          <p className="hint">{data?.assistant.available ? "Tik op “Vertaal naar Nederlands”; het origineel blijft bewaard." : t("Vertalen kan zodra de assistent ingesteld is (ANTHROPIC_API_KEY).")}</p>
        </div>
      )}
      <div className="rhero-wrap">
        <Pic src={recipe.image} className="rhero" phClass="rhero ph" />
        <button className="pill rhero-btn" onClick={() => setPhoto(true)}>📷 {recipe.image ? t("Foto wijzigen") : t("Foto toevoegen")}</button>
      </div>
      <div className="rmeta">
        {recipe.minutes && <span className="badge">⏱ {recipe.minutes} min</span>}
        <span className="badge servings" title={t("Aantal porties: de hoeveelheden rekenen mee")}>🍽
          <button aria-label={t("Minder porties")} onClick={() => setServings((n) => Math.max(1, n - 1))} disabled={servings <= 1}>−</button>
          <b className="num">{servings}</b>
          <button aria-label={t("Meer porties")} onClick={() => setServings((n) => Math.min(50, n + 1))}>+</button>
          {servings !== baseServings && <small className="muted">(recept: {baseServings})</small>}
        </span>
        {recipe.category && <span className="badge">{catLabel(recipe.category)}</span>}
        {recipe.cooked > 0 && <span className="badge">🍳 {recipe.cooked}× gekookt</span>}
        <button className={`badge favbtn${recipe.favorite ? " on" : ""}`} aria-pressed={recipe.favorite} onClick={() => act(() => api.put(`/recipes/${recipe.id}/favorite`, { favorite: !recipe.favorite }), recipe.favorite ? t("Niet meer bij de lievelingen") : t("Bij de lievelingen ★"))}>{recipe.favorite ? t("★ Lieveling") : t("☆ Lieveling")}</button>
        {recipe.sourceUrl && <a className="linkbtn" href={recipe.sourceUrl} target="_blank" rel="noreferrer">Bron: {new URL(recipe.sourceUrl).hostname.replace(/^www\./, "")} ↗</a>}
      </div>
      <NutritionBlock recipeId={recipe.id} ingredients={`${recipe.ingredients}\n${recipe.original?.ingredients ?? ""}`} />
      <div className="actions" style={{ justifyContent: "flex-start" }}>
        <button className="btn accent" onClick={() => setPlan(true)}>{t("📅 Inplannen")}</button>
        {steps.length > 0 && <button className="btn" onClick={() => setCook(true)}>{t("👩‍🍳 Kookmodus")}</button>}
        {getDevice().role === "phone" && <button className="btn ghost" title={t("Toon dit recept op het keukenscherm")} onClick={async () => { const r = await act(() => cast("recipe", recipe.id)); if (r) toast(t("Staat op het keukenscherm 📺")); }}>{t("📺 Op keukenscherm")}</button>}
        <button className="btn ghost" title={t("Recept delen (WhatsApp, sms…)")} onClick={async () => {
          const text = `${version.title}\n\n${t("Ingrediënten")}:\n${ingredients.map((x) => `• ${x}`).join("\n")}\n\n${t("Bereiding")}:\n${steps.map((x, i) => `${i + 1}. ${x.replace(/^\d+[.)]\s*/, "")}`).join("\n")}${recipe.sourceUrl ? `\n\n${recipe.sourceUrl}` : ""}`;
          try { if (navigator.share) await navigator.share({ title: version.title, text }); else { await navigator.clipboard.writeText(text); toast(t("Recept gekopieerd")); } } catch { /* geannuleerd */ }
        }}>{t("↗ Delen")}</button>
        <button className="btn" onClick={toList} disabled={!missing.length}>🛒 {missing.length === ingredients.length ? t("Alles") : `${missing.length} ${missing.length === 1 ? t("ingrediënt") : t("ingrediënten")}`} {t("op")} {shop?.name ?? t("Boodschappen")}</button>
        {data?.assistant.available && notTranslated && <button className="btn ghost" onClick={translate} disabled={busy}>{busy ? t("Vertalen…") : t("Vertaal naar Nederlands")}</button>}
      </div>
      <section>
        <div className="section-title"><h2>{t("Ingrediënten")}</h2><span className="hint">{t("Aangevinkt = nodig · vink af wat je al in huis hebt")}{skip.size ? <> · <button className="linkbtn" onClick={() => setSkip(new Set())}>{t("alles aanvinken")}</button></> : null}</span></div>
        <div className="ingr">
          {ingredients.map((x, i) => (
            <label key={i} className={`ingr-row${skip.has(i) ? t(" have") : ""}`}>
              <input type="checkbox" checked={!skip.has(i)} onChange={() => toggle(i)} />
              <span className="ingr-ic" aria-hidden>{ingredientIcon(x)}</span>
              <span className="ingr-txt"><b>{splitIngredient(x).name}</b>{splitIngredient(x).amount && <small>{splitIngredient(x).amount}</small>}</span>
            </label>
          ))}
          {!ingredients.length && <p className="hint">{t("Geen ingrediënten ingevuld.")}</p>}
        </div>
      </section>
      <section>
        <div className="section-title"><h2>{t("Bereiding")}</h2></div>
        <ol className="steps">{steps.map((s, i) => <li key={i} className={s.startsWith("—") ? "sect" : ""}>{s.replace(/^\d+[.)]\s*/, "")}</li>)}</ol>
        {!steps.length && <p className="hint">{t("Geen bereiding ingevuld.")}</p>}
      </section>
      <div className="actions">
        <button className="btn danger left" onClick={() => setConfirm(true)}>{t("Verwijderen")}</button>
        <button className="btn ghost" onClick={() => setEdit(true)}>{t("Bewerken")}</button>
      </div>
      {plan && <PlanRecipe recipe={recipe} onClose={() => setPlan(false)} />}
      {cook && <CookMode title={version.title} ingredients={ingredients} steps={steps.filter((s) => !s.startsWith("—"))} onClose={() => setCook(false)} />}
      {photo && <PhotoPicker title={(recipe.original?.title ?? recipe.title).replace(/\s*(tarifi|\(.*\))\s*/gi, " ").trim()} current={recipe.image}
        onPick={(image) => act(() => api.put(`/recipes/${recipe.id}/image`, { image }), image ? t("Foto bewaard") : t("Foto weggehaald"))} onClose={() => setPhoto(false)} />}
      {confirm && <Confirm title={t("Recept verwijderen?")} onClose={() => setConfirm(false)}
        actions={[{ label: t("Verwijderen"), run: async () => { if (await act(() => api.del(`/recipes/${recipe.id}`), t("Recept verwijderd"))) onClose(); } }]} />}
    </Modal>
  );
}

export function PlanRecipe({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const act = useAction();
  const [date, setDate] = useState(todayIso());
  const [slot, setSlot] = useState<Slot>("diner");
  const days = Array.from({ length: 7 }, (_, i) => addDays(todayIso(), i));
  const save = async () => {
    if (await act(() => api.put("/meals", { date, slot, title: recipe.title, recipeId: recipe.id }), t("Ingepland op {d}", { d: shortDate(date) }))) onClose();
  };
  return (
    <Modal title={t("Wanneer koken we dit?")} onClose={onClose}>
      <div className="picks">
        {days.map((d, i) => <button key={d} className="pick" aria-pressed={date === d} onClick={() => setDate(d)}>{i === 0 ? t("Vandaag") : i === 1 ? t("Morgen") : `${DSHORT[weekday(d)]} ${Number(d.slice(8))}`}</button>)}
      </div>
      <label className="field"><span>{t("Of kies een datum")}</span><input id="plan-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <div className="picks">
        {(["ontbijt", "lunch", "diner", "snack"] as Slot[]).map((s) => <button key={s} className="pick" aria-pressed={slot === s} onClick={() => setSlot(s)}>{s}</button>)}
      </div>
      <div className="actions"><button className="btn ghost" onClick={onClose}>{t("Annuleren")}</button><button className="btn" onClick={save}>{t("Inplannen")}</button></div>
    </Modal>
  );
}

export function RecipeEditor({ recipe, onClose }: { recipe?: Recipe; onClose: () => void }) {
  const act = useAction();
  const [f, setF] = useState({
    title: recipe?.title ?? "", ingredients: recipe?.ingredients ?? "", instructions: recipe?.instructions ?? "",
    minutes: recipe?.minutes ?? (null as number | null), image: recipe?.image ?? null, sourceUrl: recipe?.sourceUrl ?? null,
    servings: recipe?.servings ?? "", cuisine: recipe?.cuisine ?? "", lang: recipe?.lang ?? "nl", category: recipe?.category ?? "", favorite: recipe?.favorite ?? false,
  });
  const save = async () => {
    if (!f.title.trim()) return;
    if (await act(() => (recipe ? api.put(`/recipes/${recipe.id}`, f) : api.post("/recipes", f)), t("Recept bewaard"))) onClose();
  };
  return (
    <Modal title={recipe ? t("Recept bewerken") : t("Eigen recept")} onClose={onClose} wide>
      <div className="row2">
        <label className="field"><span>{t("Naam")}</span><input id="rc-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="field"><span>{t("Keuken")}</span><input id="rc-cuisine" value={f.cuisine} onChange={(e) => setF({ ...f, cuisine: e.target.value })} placeholder={t("bv. Turks")} /></label>
        <label className="field"><span>{t("Categorie")}</span>
          <select id="rc-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            <option value="">{t("— geen —")}</option>
            {Object.entries(CATS).map(([k, c]) => <option key={k} value={k}>{c.icon} {c.name}</option>)}
          </select>
        </label>
      </div>
      <div className="row2">
        <label className="field"><span>{t("Bereidingstijd (minuten)")}</span><input id="rc-min" type="number" min={0} value={f.minutes ?? ""} onChange={(e) => setF({ ...f, minutes: e.target.value ? Number(e.target.value) : null })} /></label>
        <label className="field"><span>{t("Porties")}</span><input id="rc-serv" value={f.servings} onChange={(e) => setF({ ...f, servings: e.target.value })} placeholder={t("bv. 4 personen")} /></label>
      </div>
      <label className="field"><span>{t("Ingrediënten (één per regel)")}</span><textarea id="rc-ing" rows={7} value={f.ingredients} onChange={(e) => setF({ ...f, ingredients: e.target.value })} /></label>
      <label className="field"><span>{t("Bereiding (één stap per regel)")}</span><textarea id="rc-ins" rows={7} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></label>
      <label className="field"><span>{t("Link naar een foto (optioneel)")}</span><input id="rc-img" value={f.image ?? ""} onChange={(e) => setF({ ...f, image: e.target.value || null })} placeholder={t("https://…")} /></label>
      <div className="actions"><button className="btn ghost" onClick={onClose}>{t("Annuleren")}</button><button className="btn" onClick={save} disabled={!f.title.trim()}>{t("Bewaren")}</button></div>
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
    const r = await act(() => api.post<{ id: string; existing: boolean }>("/recipes/import", { url: h.url, translate: true }));
    setAdding(null);
    if (r) { toast(r.existing ? t("Stond al in je bibliotheek") : t("In de bibliotheek gezet")); onClose(); setTimeout(() => openRecipe(r.id), 400); }
  };
  const inLibrary = new Set(data?.recipes.map((r) => r.sourceUrl).filter(Boolean));
  return (
    <Modal title={t("Turkse recepten zoeken")} onClose={onClose} wide>
      <p className="hint">{t("We zoeken op nefisyemektarifleri.com, yemek.com, lezzet.com.tr, Arda'nın Mutfağı, Refika'nın Mutfağı en meer. Zoek in het Turks of het Nederlands.")}</p>
      <form className="addrow" onSubmit={(e) => { e.preventDefault(); if (q.trim().length > 1) search(q.trim()); }}>
        <input id="rs-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("bv. kip met rijst, köfte, linzensoep…")} aria-label={t("Zoek een recept")} />
        <button className="btn" type="submit" disabled={busy || q.trim().length < 2}>{busy ? t("Zoeken…") : t("Zoeken")}</button>
      </form>
      <div className="picks">{IDEAS.map((i) => <button key={i} className="pick" onClick={() => search(i)} disabled={busy}>{i}</button>)}</div>
      <p className="hint">{t("Recepten worden in het Nederlands in je bibliotheek gezet. Het Turkse origineel blijft bewaard: je wisselt met één tik.")}</p>
      {busy && <p className="hint">{t("Even zoeken op de receptsites… dit duurt een halve minuut.")}</p>}
      {hits && !hits.length && !busy && <p className="empty">{t("Niets gevonden. Probeer een ander woord, of plak de link van een recept via “Via link toevoegen”.")}</p>}
      <div className="rgrid">
        {hits?.map((h) => (
          <div className="rcard" key={h.url}>
            {h.image ? <img src={h.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="rcard-ph" aria-hidden>🍲</span>}
            <span className="rcard-body">
              <b>{h.title}</b>
              {h.original !== h.title && <small lang="tr">🇹🇷 {h.original}</small>}
              <small>{h.site}{h.minutes ? ` · ${h.minutes} min` : ""}</small>
              <span style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                {inLibrary.has(h.url)
                  ? <span className="badge">{t("In je bibliotheek")}</span>
                  : <button className="btn small" onClick={() => add(h)} disabled={adding !== null}>{adding === h.url ? t("Toevoegen…") : t("+ Bibliotheek")}</button>}
                <a className="btn ghost small" href={h.url} target="_blank" rel="noreferrer">{t("Bekijken ↗")}</a>
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
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const r = await act(() => api.post<{ id: string; existing: boolean }>("/recipes/import", { url: url.trim(), translate: true }));
    setBusy(false);
    if (r) { toast(r.existing ? t("Stond al in je bibliotheek") : t("Recept toegevoegd")); onClose(); setTimeout(() => openRecipe(r.id), 400); }
  };
  return (
    <Modal title={t("Recept via link")} onClose={onClose}>
      <p className="hint">{t("Plak de link van een recept, bv. van nefisyemektarifleri.com of yemek.com. Naam, foto, ingrediënten en bereiding worden overgenomen.")}</p>
      <input id="ri-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("https://www.nefisyemektarifleri.com/…")} aria-label={t("Link naar het recept")} />
      <p className="hint">{data?.assistant.available ? "Het recept wordt naar het Nederlands vertaald; het origineel blijft bewaard." : t("Vertalen naar het Nederlands kan zodra de assistent ingesteld is.")}</p>
      <div className="actions"><button className="btn ghost" onClick={onClose}>{t("Annuleren")}</button><button className="btn" onClick={go} disabled={busy || !/^https?:\/\//.test(url.trim())}>{busy ? t("Ophalen…") : t("Toevoegen")}</button></div>
    </Modal>
  );
}
