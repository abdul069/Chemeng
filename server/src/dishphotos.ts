// Foto's van gerechten zoeken: eerst gratis via Wikipedia (Turks, Nederlands, Engels),
// en als de assistent ingesteld is ook op Turkse receptsites.
import { all, get, run } from "./db.js";
import { searchTurkishRecipes, aiAvailable } from "./recipes.js";

export interface DishPhoto { url: string; source: string; title: string }

type Fetch = typeof fetch;
let fetcher: Fetch = (...a) => fetch(...a);
/** Alleen voor tests. */
export const setFetcher = (f: Fetch) => { fetcher = f; };

const norm = (s: string) => s.trim().toLocaleLowerCase("tr").replace(/\s+/g, " ");
// woorden die geen gerecht zijn: daar zoeken we geen foto voor
const SKIP = /^(restjes|restje|uit eten|op restaurant|afhaal|takeaway|niets|geen|vasten|\?+|-+)$/i;

async function wikipedia(lang: string, query: string): Promise<DishPhoto[]> {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  url.search = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: query, gsrlimit: "4", gsrnamespace: "0",
    prop: "pageimages", piprop: "thumbnail", pithumbsize: "800", format: "json", origin: "*",
  }).toString();
  const res = await fetcher(url, { headers: { "user-agent": "Gezinsbord/1.0 (gezinsapp)" }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return [];
  const j = (await res.json()) as { query?: { pages?: Record<string, { title: string; index?: number; thumbnail?: { source: string } }> } };
  return Object.values(j.query?.pages ?? {})
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .filter((p) => p.thumbnail?.source && !/\.svg/i.test(p.thumbnail.source))
    .map((p) => ({ url: p.thumbnail!.source, source: `${lang}.wikipedia.org`, title: p.title }));
}

/** Kandidaat-foto's voor een gerecht, de beste eerst: foto's van receptpagina's, dan Wikipedia. */
export async function findDishPhotos(query: string, opts: { withSites?: boolean } = {}): Promise<DishPhoto[]> {
  const q = query.trim();
  if (!q || SKIP.test(q)) return [];
  const out: DishPhoto[] = [];
  for (const lang of ["tr", "nl", "en"]) {
    try { out.push(...(await wikipedia(lang, q))); } catch { /* volgende taal */ }
    if (out.length >= 6) break;
  }
  if (opts.withSites && aiAvailable()) {
    try {
      const hits = await searchTurkishRecipes(q, { translate: false, max: 6 });
      out.unshift(...hits.filter((h) => h.image).map((h) => ({ url: h.image!, source: h.site, title: h.title })));
    } catch { /* geen extra foto's */ }
  }
  const seen = new Set<string>();
  return out.filter((p) => (seen.has(p.url) ? false : (seen.add(p.url), true))).slice(0, 9);
}

/** Eén foto voor een gerecht, onthouden zodat we niet steeds opnieuw zoeken. */
export async function autoDishPhoto(title: string): Promise<string | null> {
  const key = norm(title);
  if (!key || SKIP.test(key)) return null;
  const cached = get<{ image: string | null; tried_at: string }>("SELECT image, tried_at FROM dish_photos WHERE title=?", key);
  if (cached && (cached.image || !get("SELECT 1 WHERE ? < datetime('now','-7 days')", cached.tried_at))) return cached.image;
  let image: string | null = null;
  // eerst een foto van een echte receptpagina, Wikipedia alleen als reserve
  try { image = (await findDishPhotos(title, { withSites: true }))[0]?.url ?? null; } catch { image = null; }
  run("INSERT INTO dish_photos(title, image, tried_at) VALUES (?,?,datetime('now')) ON CONFLICT(title) DO UPDATE SET image=excluded.image, tried_at=excluded.tried_at", key, image);
  return image;
}

/** Vult foto's aan voor maaltijden en recepten van een gezin die er nog geen hebben. */
export async function fillMissingPhotos(householdId: string, onChange: (topics: ("meals" | "recipes")[]) => void) {
  let meals = false, recipes = false;
  for (const r of all<{ id: string; title: string }>("SELECT id, title FROM recipes WHERE household_id=? AND (image IS NULL OR image='') LIMIT 30", householdId)) {
    const img = await autoDishPhoto(r.title);
    if (img) { run("UPDATE recipes SET image=? WHERE id=? AND (image IS NULL OR image='')", img, r.id); recipes = true; }
  }
  for (const m of all<{ date: string; slot: string; title: string }>(
    "SELECT date, slot, title FROM meals WHERE household_id=? AND recipe_id IS NULL AND (image IS NULL OR image='') AND date >= date('now','-7 days') LIMIT 60", householdId,
  )) {
    const img = await autoDishPhoto(m.title);
    if (img) { run("UPDATE meals SET image=? WHERE household_id=? AND date=? AND slot=? AND (image IS NULL OR image='')", img, householdId, m.date, m.slot); meals = true; }
  }
  const t: ("meals" | "recipes")[] = [];
  if (meals) t.push("meals");
  if (recipes) t.push("recipes");
  if (t.length) onChange(t);
}
