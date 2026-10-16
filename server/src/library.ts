// Gedeelde receptenbibliotheek: alle recepten van de Turkse receptsites worden via hun sitemaps opgehaald,
// per categorie opgeslagen en (zodra de assistent beschikbaar is) naar het Nederlands vertaald.
import { all, get, run, newId, db } from "./db.js";
import { TURKISH_SITES, parseRecipeHtml, translateTitles, translateRecipe, aiAvailable, recipeNodes } from "./recipes.js";
import type { RecipeInputT } from "./store.js";

db.exec(`
CREATE TABLE IF NOT EXISTS library (
  id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL UNIQUE,
  site TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'overig',
  title_tr TEXT NOT NULL,
  title_nl TEXT,
  image TEXT,
  minutes INTEGER,
  servings TEXT NOT NULL DEFAULT '',
  ingredients_tr TEXT NOT NULL DEFAULT '',
  instructions_tr TEXT NOT NULL DEFAULT '',
  ingredients_nl TEXT,
  instructions_nl TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS library_cat ON library(category);
CREATE TABLE IF NOT EXISTS library_seen (url TEXT PRIMARY KEY, status TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS global_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

// zoekkolom zonder accenten/Turkse tekens, zodat "imam" ook "İmam" vindt en "corba" ook "çorba"
try { db.exec("ALTER TABLE library ADD COLUMN search TEXT"); } catch { /* bestaat al */ }
export const fold = (s: string) => s.toLocaleLowerCase("tr").replace(/ı/g, "i").replace(/İ/g, "i").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ç/g, "c").replace(/ö/g, "o").replace(/ü/g, "u");
const searchText = (r: { title_tr: string; title_nl?: string | null; ingredients_tr: string; ingredients_nl?: string | null }) => fold([r.title_tr, r.title_nl ?? "", r.ingredients_tr, r.ingredients_nl ?? ""].join(" | "));
for (const r of all<{ id: string; title_tr: string; title_nl: string | null; ingredients_tr: string; ingredients_nl: string | null }>("SELECT id, title_tr, title_nl, ingredients_tr, ingredients_nl FROM library WHERE search IS NULL")) run("UPDATE library SET search=? WHERE id=?", searchText(r), r.id);

/** Categorieën met Nederlandse naam, icoon en Turkse/Nederlandse trefwoorden om een recept in te delen. */
export const CATEGORIES: { key: string; name: string; icon: string; words: RegExp }[] = [
  { key: "soep", name: "Soepen", icon: "🍲", words: /çorba|soep|soup/i },
  { key: "ontbijt", name: "Ontbijt", icon: "🍳", words: /kahvaltı|menemen|omlet|yumurta|ontbijt|breakfast|pancake|krep|sucuklu/i },
  { key: "borek", name: "Börek & deeg", icon: "🥐", words: /börek|böre[gğ]|bore[kg]|poğaça|pogaca|gözleme|lahmacun|pide|hamur|ekmek|simit|açma|çörek|bazlama|mantı|manti|erişte|pizza|puf/i },
  { key: "kebap", name: "Kebab & grill", icon: "🍢", words: /kebap|kebab|köfte|kofte|şiş|sis\b|ızgara|izgara|mangal|döner|doner|tantuni|kokoreç|adana|urfa/i },
  { key: "vlees", name: "Vleesgerechten", icon: "🥩", words: /\bet\b|etli|kuzu|dana|kıyma|kiyma|biftek|tas kebabı|güveç|guvec|sote|haşlama|kavurma|ciğer|ciger|bonfile|pirzola|rosto|sarma|dolma/i },
  { key: "kip", name: "Kip", icon: "🍗", words: /tavuk|piliç|pilic|hindi|kanat|but\b|chicken|kip/i },
  { key: "vis", name: "Vis & zeevruchten", icon: "🐟", words: /balık|balik|hamsi|levrek|çipura|somon|karides|midye|kalamar|ton ?balığı|uskumru|vis\b|fish/i },
  { key: "groente", name: "Groenten & olijfolie", icon: "🥦", words: /sebze|zeytinyağlı|zeytinyagli|patlıcan|patlican|kabak|ıspanak|ispanak|pırasa|pirasa|bamya|enginar|fasulye|bezelye|lahana|karnabahar|brokoli|mantar|imam bayıldı|karnıyarık|karniyarik|musakka|türlü|turlu|biber|domates|semizotu|pazı|yaprak/i },
  { key: "peulvruchten", name: "Peulvruchten", icon: "🫘", words: /nohut|mercimek|kuru fasulye|barbunya|bakla|börülce|borulce|fasülye/i },
  { key: "rijst", name: "Rijst, bulgur & pasta", icon: "🍚", words: /pilav|pilavı|bulgur|makarna|spaghetti|noodle|erişte|risotto|kısır|kisir|firik/i },
  { key: "salade", name: "Salades & meze", icon: "🥗", words: /salata|meze|cacık|cacik|haydari|humus|ezme|piyaz|çoban|coban|atom|babagannuş|tarator|turşu|tursu/i },
  { key: "aardappel", name: "Aardappelgerechten", icon: "🥔", words: /patates|kumpir|aardappel|friet|patatas/i },
  { key: "dessert", name: "Desserts & gebak", icon: "🍰", words: /tatlı|tatli|tatlısı|baklava|sütlaç|sutlac|künefe|kunefe|revani|helva|lokum|kazandibi|muhallebi|kek|pasta|kurabiye|cheesecake|tart|brownie|cookie|puding|dondurma|şerbet|serbet|aşure|asure|güllaç|gullac|tulumba|lokma|şekerpare|sekerpare|irmik|kadayıf|kadayif|profiterol|mousse|tiramisu|waffle|krep|muffin|cupcake|browni|dessert|taart|koek/i },
  { key: "drank", name: "Dranken", icon: "🥤", words: /içecek|icecek|ayran|limonata|şerbet|smoothie|kahve|çay\b|cay\b|milkshake|kokteyl|boza|salep|sahlep|şalgam|salgam|drank|juice|suyu/i },
  { key: "saus", name: "Sauzen & basis", icon: "🫙", words: /sos\b|sosu|salça|salca|reçel|recel|marmelat|turşu|tursu|baharat|hamuru|mayası|mayasi|peynir|yoğurt|yogurt|tereyağı/i },
];
const CAT_KEYS = new Set(CATEGORIES.map((c) => c.key));

/** Deelt een recept in op basis van de categorie van de site, de URL en de titel. */
export function classify(title: string, url: string, siteCategory = ""): string {
  const hay = [siteCategory, url.replace(/https?:\/\/[^/]+/, "").replace(/-/g, " "), title].join(" | ");
  // dessert en soep eerst: "tavuk çorbası" is een soep, "havuçlu kek" een dessert
  // volgorde telt: "tavuk sote" is kip (niet vlees), "mercimek köftesi" is een peulvruchtengerecht
  const order = ["soep", "dessert", "drank", "salade", "borek", "kebap", "ontbijt", "kip", "vis", "peulvruchten", "rijst", "aardappel", "groente", "vlees", "saus"];
  for (const key of order) if (CATEGORIES.find((x) => x.key === key)!.words.test(hay)) return key;
  return "overig";
}

export interface LibraryRow {
  id: string; sourceUrl: string; site: string; category: string; title: string; titleTr: string; image: string | null; minutes: number | null;
  servings: string; translated: boolean;
}
const toRow = (r: Record<string, unknown>): LibraryRow => ({
  id: r.id as string, sourceUrl: r.source_url as string, site: r.site as string, category: r.category as string,
  title: (r.title_nl as string | null) || (r.title_tr as string), titleTr: r.title_tr as string, image: r.image as string | null,
  minutes: r.minutes as number | null, servings: r.servings as string, translated: !!r.ingredients_nl,
});

export function libraryCategories() {
  const counts = all<{ category: string; n: number }>("SELECT category, COUNT(*) AS n FROM library GROUP BY category");
  const by = Object.fromEntries(counts.map((c) => [c.category, c.n]));
  return [...CATEGORIES.map((c) => ({ ...c, words: undefined, n: by[c.key] ?? 0 })), { key: "overig", name: "Overige", icon: "🍽️", n: by.overig ?? 0 }].filter((c) => c.n > 0);
}

export function libraryList(opts: { category?: string; q?: string; offset?: number; limit?: number; site?: string }) {
  const where: string[] = []; const args: unknown[] = [];
  if (opts.category && (CAT_KEYS.has(opts.category) || opts.category === "overig")) { where.push("category=?"); args.push(opts.category); }
  if (opts.site) { where.push("site=?"); args.push(opts.site); }
  if (opts.q) for (const w of fold(opts.q).split(/\s+/).filter(Boolean)) { where.push("search LIKE ?"); args.push(`%${w}%`); }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM library ${w}`, ...args)?.n ?? 0;
  const limit = Math.min(Math.max(opts.limit ?? 60, 1), 200);
  const rows = all<Record<string, unknown>>(
    `SELECT id, source_url, site, category, title_tr, title_nl, image, minutes, servings, ingredients_nl FROM library ${w} ORDER BY (image IS NULL), COALESCE(title_nl, title_tr) LIMIT ? OFFSET ?`,
    ...args, limit, Math.max(opts.offset ?? 0, 0),
  );
  return { total, items: rows.map(toRow) };
}

/** Volledig recept uit de bibliotheek, als invoer voor de gezinsbibliotheek (Nederlands als dat er is). */
export async function libraryRecipe(id: string, translate = true): Promise<(RecipeInputT & { id: string; category: string }) | null> {
  const r = get<Record<string, unknown>>("SELECT * FROM library WHERE id=?", id);
  if (!r) return null;
  const tr: RecipeInputT = {
    title: r.title_tr as string, ingredients: r.ingredients_tr as string, instructions: r.instructions_tr as string, minutes: r.minutes as number | null,
    image: r.image as string | null, sourceUrl: r.source_url as string, servings: r.servings as string, cuisine: "Turks", lang: "tr", original: null,
  };
  if (r.ingredients_nl) {
    return { ...tr, id, category: r.category as string, title: (r.title_nl as string) || tr.title, ingredients: r.ingredients_nl as string, instructions: r.instructions_nl as string, lang: "nl", original: { title: tr.title, ingredients: tr.ingredients, instructions: tr.instructions, lang: "tr" } };
  }
  if (translate && aiAvailable()) {
    try {
      const t = await translateRecipe(tr);
      if (t.lang === "nl") {
        run("UPDATE library SET title_nl=?, ingredients_nl=?, instructions_nl=?, servings=?, search=? WHERE id=?", t.title, t.ingredients, t.instructions, t.servings, searchText({ title_tr: tr.title, title_nl: t.title, ingredients_tr: tr.ingredients, ingredients_nl: t.ingredients }), id);
        return { ...t, id, category: r.category as string };
      }
    } catch (e) { console.warn("[library] vertalen mislukt", (e as Error).message); }
  }
  return { ...tr, id, category: r.category as string, title: (r.title_nl as string) || tr.title };
}

// ---------- ophalen (crawler) ----------
const UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "accept-language": "tr-TR,tr;q=0.9,nl;q=0.5" };
/** Laatste reden waarom een pagina niet opgehaald kon worden (voor de logboeken). */
let lastFetchError = "";
let fetcher: typeof fetch = (...a) => fetch(...a);
/** Voor tests: een andere fetch gebruiken. */
export const setLibraryFetcher = (f: typeof fetch) => { fetcher = f; };
async function getText(url: string, ms = 20_000): Promise<string | null> {
  try {
    const res = await fetcher(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(ms) });
    if (!res.ok) { lastFetchError = `HTTP ${res.status}`; return null; }
    const ct = res.headers.get("content-type") ?? "";
    if (/gzip|octet-stream/.test(ct) || url.endsWith(".gz")) {
      const { gunzipSync } = await import("node:zlib");
      return gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8");
    }
    return await res.text();
  } catch (e) { lastFetchError = (e as Error).message; return null; }
}

/** Herkent de URL van één recept per site; overzichts- en categoriepagina's worden overgeslagen. */
const RECIPE_URL: Record<string, RegExp> = {
  "nefisyemektarifleri.com": /^https?:\/\/(www\.)?nefisyemektarifleri\.com\/[a-z0-9-]+-(tarifi|yapimi|nasil-yapilir)\/?$/i,
  "yemek.com": /^https?:\/\/(www\.)?yemek\.com\/tarif\/[a-z0-9-]+\/?$/i,
  "lezzet.com.tr": /^https?:\/\/(www\.)?lezzet\.com\.tr\/yemek-tarifleri\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\/?$/i,
  "ardaninmutfagi.com": /^https?:\/\/(www\.)?ardaninmutfagi\.com\/[a-z0-9-]+\/?$/i,
  "refikaninmutfagi.com": /^https?:\/\/(www\.)?refikaninmutfagi\.com\/[a-z0-9-]+\/[a-z0-9-]+\/?$/i,
  "yemektarifleri.com": /^https?:\/\/(www\.)?yemektarifleri\.com\/tarif\/[a-z0-9-]+\/?$/i,
  "mutfaksirlari.com": /^https?:\/\/(www\.)?mutfaksirlari\.com\/[a-z0-9-]+\.html$/i,
};
const SKIP = /\/(kategori|category|etiket|tag|yazar|author|page|sayfa|arama|search|video|haber|blog|uye|login)\b|\?|#/i;

/** Haalt alle sitemap-URL's van een site op (robots.txt → sitemap index → sitemaps). */
export async function discoverUrls(site: string, max: number, log: (s: string) => void): Promise<string[]> {
  const roots = new Set<string>();
  const robots = await getText(`https://www.${site}/robots.txt`, 10_000) ?? await getText(`https://${site}/robots.txt`, 10_000);
  if (!robots) log(`${site}: robots.txt niet opgehaald (${lastFetchError}); sitemap op de gebruikelijke plaatsen proberen`);
  for (const m of robots?.matchAll(/^sitemap:\s*(\S+)/gim) ?? []) roots.add(m[1]);
  if (!roots.size) for (const p of ["sitemap.xml", "sitemap_index.xml", "sitemap-index.xml", "sitemaps.xml", "post-sitemap.xml"]) roots.add(`https://www.${site}/${p}`);
  const found = new Set<string>();
  const queue = [...roots]; const seen = new Set<string>();
  const test = RECIPE_URL[site];
  // alleen pagina's tellen die we nog niet hebben (anders komen we nooit voorbij de eerste sitemaps)
  const known = (u: string) => !!get("SELECT 1 FROM library WHERE source_url=?", u) || !!get("SELECT 1 FROM library_seen WHERE url=? AND at > datetime('now','-30 days')", u);
  while (queue.length && found.size < max && seen.size < 400) {
    const u = queue.shift()!;
    if (seen.has(u)) continue;
    seen.add(u);
    const xml = await getText(u);
    if (!xml) { if (seen.size <= 6) log(`${site}: ${u.replace(/^https?:\/\/(www\.)?/, "")} niet opgehaald (${lastFetchError})`); continue; }
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].trim());
    const isIndex = /<sitemapindex/i.test(xml);
    let n = 0;
    for (const loc of locs) {
      if (isIndex || /sitemap[^/]*\.xml(\.gz)?$/i.test(loc)) { if (!/(image|video|news|tag|category|kategori|author|page)/i.test(loc)) queue.push(loc); }
      else if (test ? test.test(loc) && !SKIP.test(loc) : !SKIP.test(loc)) { if (known(loc)) continue; found.add(loc); n++; if (found.size >= max) break; }
    }
    log(`${site}: ${u.replace(/^https?:\/\/(www\.)?/, "")} → ${n} recept-URL's (${found.size} totaal)`);
  }
  return [...found];
}

export interface CrawlStatus { running: boolean; site: string | null; done: number; added: number; failed: number; total: number; log: string[]; startedAt: string | null; finishedAt: string | null }
export const crawlStatus: CrawlStatus = { running: false, site: null, done: 0, added: 0, failed: 0, total: 0, log: [], startedAt: null, finishedAt: null };
const log = (s: string) => { crawlStatus.log.push(`${new Date().toISOString().slice(11, 19)} ${s}`); if (crawlStatus.log.length > 200) crawlStatus.log.shift(); console.log("[library]", s); };

/** Haalt één receptpagina op en zet ze in de bibliotheek. */
export async function ingestUrl(url: string, site: string, html?: string): Promise<"added" | "exists" | "failed"> {
  if (get("SELECT 1 FROM library WHERE source_url=?", url)) return "exists";
  const page = html ?? await getText(url);
  if (!page) { run("INSERT OR REPLACE INTO library_seen(url, status) VALUES (?, ?)", url, `fetch ${lastFetchError}`); noteFailure(url, `ophalen mislukt: ${lastFetchError}`); return "failed"; }
  try {
    const r = parseRecipeHtml(page.slice(0, 3_000_000), url);
    if (!r.ingredients.trim() || !r.instructions.trim()) throw new Error(`recept zonder ${!r.ingredients.trim() ? "ingrediënten" : "bereiding"}`);
    const title = r.title.replace(/\s*tarifi\s*$/i, "").trim() || r.title;
    const siteCat = page.match(/"recipeCategory"\s*:\s*"([^"]+)"/)?.[1] ?? page.match(/"articleSection"\s*:\s*"([^"]+)"/)?.[1] ?? "";
    run(
      "INSERT OR IGNORE INTO library(id, source_url, site, category, title_tr, image, minutes, servings, ingredients_tr, instructions_tr, search) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      newId(), url, site, classify(r.title, url, siteCat), title, r.image ?? null, r.minutes ?? null, r.servings, r.ingredients, r.instructions, searchText({ title_tr: title, ingredients_tr: r.ingredients }),
    );
    return "added";
  } catch (e) {
    const why = (e as Error).message.slice(0, 120);
    run("INSERT OR REPLACE INTO library_seen(url, status) VALUES (?, ?)", url, `norecipe ${why}`);
    noteFailure(url, `${why} (${page.length} tekens, ld+json: ${/application\/ld\+json/.test(page) ? "ja" : "nee"})`);
    // structuur van het receptblok in het logboek, zodat de parser verbeterd kan worden
    if ((failuresLogged.get(new URL(url).hostname.replace(/^www\./, "")) ?? 0) <= 2) for (const n of recipeNodes(page).slice(0, 2)) {
      const ins = n.recipeInstructions;
      log(`  recept-sleutels: ${Object.keys(n).join(",")} · instructies: ${Array.isArray(ins) ? `array[${ins.length}] ${JSON.stringify(ins[0]).slice(0, 300)}` : JSON.stringify(ins).slice(0, 300)}`);
    }
    return "failed";
  }
}
// de eerste paar mislukkingen per run in het logboek, zodat we op de server kunnen zien wat er misgaat
const failuresLogged = new Map<string, number>();
function noteFailure(url: string, why: string) {
  const site = new URL(url).hostname.replace(/^www\./, "");
  const n = (failuresLogged.get(site) ?? 0) + 1;
  failuresLogged.set(site, n);
  if (n <= 6) log(`mislukt ${url}: ${why}`);
}

/** Haalt de recepten van alle (of één) sites op, met een paar pagina's tegelijk en een kleine pauze. */
export async function crawl(opts: { sites?: string[]; maxPerSite?: number; concurrency?: number } = {}) {
  if (crawlStatus.running) return;
  const sites = opts.sites ?? TURKISH_SITES;
  const max = opts.maxPerSite ?? Number(process.env.LIBRARY_MAX_PER_SITE ?? 4000);
  const conc = opts.concurrency ?? 3;
  Object.assign(crawlStatus, { running: true, done: 0, added: 0, failed: 0, total: 0, log: [], startedAt: new Date().toISOString(), finishedAt: null });
  failuresLogged.clear();
  try {
    for (const site of sites) {
      crawlStatus.site = site;
      const urls = await discoverUrls(site, max, log);
      crawlStatus.total += urls.length;
      log(`${site}: ${urls.length} nieuwe pagina's ophalen`);
      let i = 0;
      await Promise.all(Array.from({ length: conc }, async () => {
        while (i < urls.length) {
          const u = urls[i++];
          const r = await ingestUrl(u, site);
          crawlStatus.done++;
          if (r === "added") crawlStatus.added++; else if (r === "failed") crawlStatus.failed++;
          if (crawlStatus.done % 50 === 0) log(`${site}: ${crawlStatus.done}/${crawlStatus.total} (${crawlStatus.added} toegevoegd)`);
          await new Promise((res) => setTimeout(res, 400));
        }
      }));
      log(`${site}: klaar, ${crawlStatus.added} recepten toegevoegd tot nu toe`);
    }
    await translateMissingTitles();
  } catch (e) {
    log(`fout: ${(e as Error).message}`);
  } finally {
    crawlStatus.running = false; crawlStatus.site = null; crawlStatus.finishedAt = new Date().toISOString();
    const withImg = get<{ n: number }>("SELECT COUNT(*) AS n FROM library WHERE image IS NOT NULL")?.n ?? 0;
    log(`klaar: ${crawlStatus.added} toegevoegd, ${crawlStatus.failed} mislukt · bibliotheek: ${libraryCount()} recepten, ${withImg} met foto`);
    if (crawlStatus.done > 0 || libraryCount() > 0) run("INSERT INTO global_settings(key, value) VALUES('library_crawled', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", new Date().toISOString());
  }
}

/** Vertaalt de titels zonder Nederlandse naam, in groepjes van 40 (zodra de assistent beschikbaar is). */
export async function translateMissingTitles(limit = 2000) {
  if (!aiAvailable()) return 0;
  let n = 0;
  while (n < limit) {
    const rows = all<{ id: string; title_tr: string }>("SELECT id, title_tr FROM library WHERE title_nl IS NULL LIMIT 40");
    if (!rows.length) break;
    const nl = await translateTitles(rows.map((r) => r.title_tr));
    if (nl.every((t, i) => t === rows[i].title_tr)) break; // vertalen werkt niet (bv. geen sleutel)
    for (let i = 0; i < rows.length; i++) run("UPDATE library SET title_nl=?, search=search || ' | ' || ? WHERE id=?", nl[i], fold(nl[i]), rows[i].id);
    n += rows.length;
  }
  if (n) log(`${n} titels vertaald`);
  return n;
}

/** Bij een verbeterde parser worden eerder mislukte pagina's opnieuw geprobeerd. */
const PARSER_VERSION = "4";
if (get<{ value: string }>("SELECT value FROM global_settings WHERE key='library_parser'")?.value !== PARSER_VERSION) {
  run("DELETE FROM library_seen WHERE status LIKE 'norecipe%' OR status LIKE 'fetch%'");
  run("INSERT INTO global_settings(key, value) VALUES('library_parser', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", PARSER_VERSION);
}
export const libraryCount = () => get<{ n: number }>("SELECT COUNT(*) AS n FROM library")?.n ?? 0;

/** Bij het opstarten: bibliotheek opbouwen als ze leeg is, en daarna elke week bijwerken. */
export function startLibraryScheduler() {
  if (process.env.LIBRARY_AUTOCRAWL === "0") return;
  const kick = () => crawl().catch((e) => console.warn("[library]", e));
  // bij het opstarten: opbouwen zolang de bibliotheek klein is of de laatste beurt lang geleden (of onderbroken) was
  const last = get<{ value: string }>("SELECT value FROM global_settings WHERE key='library_crawled'")?.value ?? "";
  const stale = !last || Date.now() - Date.parse(last) > 6 * 24 * 3600_000;
  if (libraryCount() < 500 || stale) setTimeout(kick, 30_000).unref();
  setInterval(kick, 24 * 3600_000).unref(); // elke dag verder opbouwen tot alle recepten binnen zijn
  // titels vertalen zodra een sleutel aanwezig is
  setTimeout(() => translateMissingTitles().catch(() => {}), 120_000).unref();
}

/** Eén pagina proberen (voor de beheerder): wat komt er terug? */
export async function probe(url: string) {
  const page = await getText(url);
  if (!page) return { ok: false, error: lastFetchError };
  try {
    const r = parseRecipeHtml(page.slice(0, 3_000_000), url);
    return { ok: true, title: r.title, ingredients: r.ingredients.split("\n").length, steps: r.instructions.split("\n").length, image: r.image, category: classify(r.title, url) };
  } catch (e) {
    return { ok: false, error: (e as Error).message, length: page.length, ldjson: /application\/ld\+json/.test(page), snippet: page.slice(0, 300) };
  }
}
