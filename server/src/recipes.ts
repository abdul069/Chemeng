// Recepten ophalen van receptwebsites (via schema.org/Recipe in de pagina), zoeken op Turkse receptsites
// en optioneel vertalen naar het Nederlands.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { RecipeInputT } from "./store.js";

export const TURKISH_SITES = [
  "nefisyemektarifleri.com",
  "yemek.com",
  "lezzet.com.tr",
  "ardaninmutfagi.com",
  "refikaninmutfagi.com",
  "yemektarifleri.com",
  "mutfaksirlari.com",
];

import { getClient, aiReady } from "./ai.js";
const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
export const aiAvailable = () => aiReady();

export class RecipeError extends Error {}

// ---------- recept uit een webpagina halen ----------
type Json = Record<string, unknown>;
const asArray = <T,>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const decode = (s: string) =>
  s.replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ").trim();

function isRecipe(o: unknown): o is Json {
  if (!o || typeof o !== "object") return false;
  const t = (o as Json)["@type"];
  return asArray(t as string | string[]).some((x) => String(x).toLowerCase() === "recipe");
}

function findRecipes(node: unknown, out: Json[] = [], depth = 0): Json[] {
  if (depth > 6 || !node) return out;
  if (isRecipe(node)) out.push(node as Json);
  if (Array.isArray(node)) for (const n of node) findRecipes(n, out, depth + 1);
  else if (typeof node === "object") {
    const o = node as Json;
    for (const key of ["@graph", "mainEntity", "itemListElement", "item", "hasPart"]) if (o[key]) findRecipes(o[key], out, depth + 1);
  }
  return out;
}
/** Alle Recipe-objecten uit de ld+json-blokken van een pagina. */
export function recipeNodes(html: string): Json[] {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const out: Json[] = [];
  for (const raw of blocks) {
    let data: unknown;
    try { data = JSON.parse(raw.trim()); } catch {
      try { data = JSON.parse(raw.trim().replace(/[\u0000-\u001f]+/g, " ")); } catch { continue; }
    }
    findRecipes(data, out);
  }
  return out;
}
/** Sommige sites geven alle ingrediënten als één regel met komma's; die splitsen we (maar "1,5 kg" blijft heel). */
export function splitJoined(lines: string[]): string[] {
  return lines.flatMap((l) => (l.split(/,(?!\d)/).length >= 3 && l.length > 40 ? l.split(/,(?!\d)/).map((x) => x.trim()).filter(Boolean) : [l]));
}
/** Ingrediënten of stappen uit de HTML zelf, als het ld+json ze niet (volledig) heeft. */
function fromHtml(html: string, kind: "ingredient" | "step"): string[] {
  const pats = kind === "ingredient"
    ? [/itemprop=["']recipeIngredient["'][^>]*>([\s\S]*?)<\//gi, /<li[^>]*class=["'][^"']*(?:ingredient|malzeme)[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi]
    : [/itemprop=["']recipeInstructions["'][^>]*>([\s\S]*?)<\//gi, /<(?:li|p|div)[^>]*class=["'][^"']*(?:instruction|direction|step|yapilis|yapılış|adim|adım|hazirlan|hazırlan)[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|p|div)>/gi];
  for (const re of pats) {
    const found = [...html.matchAll(re)].map((m) => decode(m[1])).filter((x) => x.length > 2 && x.length < 600);
    if (found.length >= 2) return [...new Set(found)];
  }
  return [];
}

/** ISO 8601-duur (PT1H30M) naar minuten. */
export function isoMinutes(d: unknown): number | null {
  if (typeof d !== "string") return null;
  const m = d.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m) return null;
  const total = Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return total > 0 ? total : null;
}

function imageOf(v: unknown): string | null {
  for (const x of asArray(v as unknown)) {
    if (typeof x === "string" && /^https?:/.test(x)) return x;
    if (x && typeof x === "object" && typeof (x as Json).url === "string") return (x as Json).url as string;
  }
  return null;
}

function stepsOf(v: unknown): string[] {
  const out: string[] = [];
  for (const x of asArray(v as unknown)) {
    if (typeof x === "string") out.push(...x.split(/\n+/).map(decode).filter(Boolean));
    else if (Array.isArray(x)) out.push(...stepsOf(x)); // yemek.com: een array in een array
    else if (x && typeof x === "object") {
      const o = x as Json;
      if (o.itemListElement) {
        if (typeof o.name === "string") out.push(`— ${decode(o.name)} —`);
        out.push(...stepsOf(o.itemListElement));
      } else if (typeof o.text === "string") out.push(decode(o.text));
      else if (typeof o.name === "string") out.push(decode(o.name));
    }
  }
  return out.filter(Boolean);
}

const metaImage = (html: string) =>
  html.match(/<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
  html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1] ?? null;

function detectLang(html: string, url: string, r: Json): string {
  const declared = String(r.inLanguage ?? html.match(/<html[^>]*\blang=["']([a-z]{2})/i)?.[1] ?? "").slice(0, 2).toLowerCase();
  if (declared) return declared;
  if (TURKISH_SITES.some((d) => url.includes(d)) || /[ğışĞİŞ]/.test(String(r.name ?? ""))) return "tr";
  return "nl";
}

/** Leest het recept uit de HTML van een receptpagina. */
export function parseRecipeHtml(html: string, url: string): RecipeInputT {
  // het rijkste Recipe-object wint (sommige pagina's hebben er meerdere, bv. voor "gerelateerde recepten")
  const nodes = recipeNodes(html).map((r) => ({
    r,
    ingredients: asArray((r.recipeIngredient ?? r.ingredients) as string[]).map((x) => decode(String(x))).filter(Boolean),
    steps: stepsOf(r.recipeInstructions ?? r.recipeInstruction ?? r.instructions ?? r.step),
  })).sort((a, b) => (b.ingredients.length + b.steps.length) - (a.ingredients.length + a.steps.length));
  for (const n of nodes.slice(0, 1)) {
    const r = n.r;
    const ingredients = splitJoined(n.ingredients.length ? n.ingredients : fromHtml(html, "ingredient"));
    const steps = n.steps.length ? n.steps : fromHtml(html, "step");
    const title = decode(String(r.name ?? "")) || "Recept";
    const servings = decode(String(asArray(r.recipeYield as string | string[])[0] ?? ""));
    return {
      title,
      ingredients: ingredients.join("\n"),
      instructions: steps.map((s, i) => (s.startsWith("—") ? s : `${i + 1}. ${s}`)).join("\n"),
      minutes: isoMinutes(r.totalTime) ?? ((isoMinutes(r.prepTime) ?? 0) + (isoMinutes(r.cookTime) ?? 0) || null),
      image: imageOf(r.image) ?? (metaImage(html) ? new URL(decode(metaImage(html)!), url).toString() : null),
      sourceUrl: url,
      servings: servings.slice(0, 60),
      cuisine: TURKISH_SITES.some((d) => url.includes(d)) || /türk/i.test(String(r.recipeCuisine ?? "")) ? "Turks" : decode(String(asArray(r.recipeCuisine as string | string[])[0] ?? "")).slice(0, 60),
      lang: detectLang(html, url, r),
      original: null,
    };
  }
  throw new RecipeError("Op deze pagina staat geen recept dat we kunnen lezen. Probeer de link van één specifiek recept.");
}

export async function fetchRecipe(url: string): Promise<RecipeInputT> {
  let u: URL;
  try { u = new URL(url); } catch { throw new RecipeError("Dat is geen geldige link."); }
  if (!/^https?:$/.test(u.protocol)) throw new RecipeError("Gebruik een link die met https:// begint.");
  const res = await fetch(u, {
    headers: { "user-agent": "Mozilla/5.0 (Gezinsbord receptenbibliotheek)", "accept-language": "tr,nl;q=0.8,en;q=0.5", accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  }).catch(() => { throw new RecipeError("De receptsite reageert niet. Probeer het later opnieuw."); });
  if (!res.ok) throw new RecipeError(`De receptsite gaf foutcode ${res.status}.`);
  const html = await res.text();
  return parseRecipeHtml(html.slice(0, 3_000_000), res.url || url);
}

// ---------- zoeken op Turkse receptsites ----------
export interface RecipeHit { title: string; original: string; url: string; site: string; image: string | null; minutes: number | null }

/** Laat Claude op Turkse receptsites zoeken en geeft de gevonden receptpagina's terug. */
export async function searchTurkishRecipes(query: string, opts: { translate?: boolean; max?: number } = {}): Promise<RecipeHit[]> {
  const client = getClient();
  if (!client) throw new RecipeError("Zoeken naar recepten gebruikt de assistent. Vul eerst de Claude API-sleutel in bij Instellingen → Assistent. Een recept toevoegen via een link werkt wel.");
  const messages: Anthropic.MessageParam[] = [{
    role: "user",
    content: `Zoek Turkse recepten voor: "${query}". Zoek in het Turks (vertaal de vraag zo nodig, bv. "kip" → "tavuk"). Zoek naar pagina's van individuele recepten, geen overzichtspagina's. Doe hoogstens drie zoekopdrachten en antwoord daarna kort.`,
  }];
  const hits = new Map<string, string>();
  for (let i = 0; i < 4; i++) {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "low" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3, allowed_domains: TURKISH_SITES }],
      messages,
    });
    for (const block of msg.content) {
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) if (r.type === "web_search_result" && !hits.has(r.url)) hits.set(r.url, r.title);
      }
    }
    if (msg.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: msg.content });
  }
  // alleen pagina's die echt een recept bevatten, met foto en titel van de site zelf
  const candidates = [...hits.entries()].filter(([url]) => !/\/(kategori|category|etiket|tag|arama|search)\//i.test(url)).slice(0, opts.max ?? 10);
  const checked = await Promise.all(candidates.map(async ([url, title]) => {
    try {
      const r = await fetchRecipe(url);
      return { title: r.title || title, original: r.title || title, url, site: new URL(url).hostname.replace(/^www\./, ""), image: r.image ?? null, minutes: r.minutes ?? null };
    } catch {
      return null;
    }
  }));
  const found = checked.filter((x): x is RecipeHit => x !== null);
  if (opts.translate === false) return found;
  const nl = await translateTitles(found.map((h) => h.original));
  return found.map((h, i) => ({ ...h, title: nl[i] }));
}

// ---------- vertalen ----------
const Translated = z.object({
  title: z.string(),
  ingredients: z.array(z.string()),
  instructions: z.array(z.string()),
  servings: z.string(),
});

export async function translateRecipe(r: RecipeInputT): Promise<RecipeInputT> {
  const client = getClient();
  if (!client || r.lang === "nl") return r;
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: "low", format: zodOutputFormat(Translated) },
    messages: [{
      role: "user",
      content: `Vertaal dit recept naar het Nederlands (Vlaams mag). Behoud hoeveelheden en eenheden; zet Turkse maten om waar het helpt (bv. "1 su bardağı" → "1 waterglas (ca. 200 ml)", "1 yemek kaşığı" → "1 eetlepel"). Geef het gerecht een Nederlandse naam en zet de originele naam tussen haakjes, bv. "Gevulde aubergine (Karnıyarık)". Geef de bereiding als losse stappen zonder nummer.

Titel: ${r.title}
Porties: ${r.servings}
Ingrediënten:
${r.ingredients}
Bereiding:
${r.instructions}`,
    }],
  });
  const t = res.parsed_output;
  if (!t) return r;
  return {
    ...r,
    title: t.title || r.title,
    ingredients: t.ingredients.join("\n"),
    instructions: t.instructions.map((x, i) => `${i + 1}. ${x.replace(/^\d+[.)]\s*/, "")}`).join("\n"),
    servings: t.servings.slice(0, 60) || r.servings,
    lang: "nl",
    original: r.original ?? { title: r.title, ingredients: r.ingredients, instructions: r.instructions, lang: r.lang },
  };
}

/** Vertaalt een lijst receptnamen in één keer naar het Nederlands. */
/** Korte vertalingen (titels van de bibliotheek) mogen met een sneller, goedkoper model. */
const LIBRARY_MODEL = process.env.LIBRARY_MODEL ?? "claude-haiku-5-5";
export async function translateTitles(titles: string[]): Promise<string[]> {
  const client = getClient();
  if (!client || !titles.length) return titles;
  try {
    const res = await client.messages.parse({
      model: LIBRARY_MODEL,
      max_tokens: 2000,
      output_config: { effort: "low", format: zodOutputFormat(z.object({ titles: z.array(z.string()) })) },
      messages: [{ role: "user", content: `Vertaal deze Turkse receptnamen naar korte Nederlandse namen, in dezelfde volgorde. Laat "tarifi" weg.\n${titles.map((t, i) => `${i + 1}. ${t}`).join("\n")}` }],
    });
    const out = res.parsed_output?.titles ?? [];
    return titles.map((t, i) => out[i] || t);
  } catch {
    return titles;
  }
}
