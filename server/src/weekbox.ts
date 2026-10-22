/** De Weekbox: de manager stelt het avondeten voor de week voor, op maat van de agenda (drukke avonden = snel gerecht),
 *  dieetprofielen, voorraad die bijna vervalt, variatie en lievelingen. Daarna één gebundelde ingrediëntenlijst
 *  (porties maal gezinsgrootte, voorraad eraf) met een prijsschatting uit het prijsgeheugen. */
import { z } from "zod";
import * as S from "./store.js";
import { eventsBetween } from "./events.js";
import { addDays, today } from "./dates.js";
const toMin = (t: string | null) => { if (!t) return 0; const [h, m] = t.split(":").map(Number); return h * 60 + m; };
import { lookup, productKey } from "./prices.js";
import { L, asLang, type Lang } from "./i18n.js";
import { getSettings } from "./db.js";

// ---------- ingrediëntregels lezen en schalen ----------
const FRAC: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };
const UNITS = "kg|g|gr|gram|ml|cl|dl|l|liter|el|tl|eetlepels?|theelepels?|kop(?:je)?s?|cups?|su bardağı|çay bardağı|yemek kaşığı|tatlı kaşığı|çay kaşığı|yk|ck|blik(?:je)?|pak(?:je)?|paket|zak(?:je)?|snee(?:tje)?s?|dilim|teen(?:tje)?s?|diş|dis|stuks?|st|adet|tane|bos(?:je)?|demet|takje|dal|snuf(?:je)?|tutam|plak(?:je)?s?|handvol|avuç|glas|bardak|scheut(?:je)?|portie";
const LINE = new RegExp(`^(\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+[.,]\\d+|\\d+|[½¼¾⅓⅔⅛])(?:\\s*[-–à]\\s*(?:\\d+[.,]\\d+|\\d+))?\\s*(${UNITS})?\\.?\\s+(.+)$`, "iu");
function num(s: string): number {
  s = s.trim(); if (FRAC[s] !== undefined) return FRAC[s];
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/); if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/); if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(s.replace(",", "."));
}
export interface Ing { name: string; qty: number | null; unit: string; raw: string }
export function parseLine(line: string): Ing | null {
  const clean = line.replace(/^[-•*\s]+/, "").trim(); if (!clean) return null;
  const m = clean.match(LINE);
  if (!m) return { name: clean, qty: null, unit: "", raw: clean };
  return { name: m[3].trim(), qty: num(m[1]), unit: (m[2] ?? "").toLowerCase(), raw: clean };
}
const fmt = (n: number) => { const r = Math.round(n * 10) / 10; return r >= 10 ? String(Math.round(r)) : String(r).replace(".", ","); };
/** Hoeveelheden optellen in een gezamenlijke eenheid (g/kg → g, ml/cl/dl/l → ml). */
const toBase = (qty: number, unit: string): { q: number; u: string } => {
  if (/^(kg)$/.test(unit)) return { q: qty * 1000, u: "g" };
  if (/^(g|gr|gram)$/.test(unit)) return { q: qty, u: "g" };
  if (/^(l|liter)$/.test(unit)) return { q: qty * 1000, u: "ml" };
  if (/^(dl)$/.test(unit)) return { q: qty * 100, u: "ml" };
  if (/^(cl)$/.test(unit)) return { q: qty * 10, u: "ml" };
  if (/^(ml)$/.test(unit)) return { q: qty, u: "ml" };
  return { q: qty, u: unit };
};
const COUNTABLE = /^(|st|stuks?|stuk|adet|tane|blik(?:je)?|pak(?:je)?|paket|zak(?:je)?|teen(?:tje)?s?|diş|dis|bos(?:je)?|demet|snee(?:tje)?s?|dilim|plak(?:je)?s?|takje|dal)$/;
const fmtBase = (q: number, u: string) => (u === "g" && q >= 1000 ? `${fmt(q / 1000)} kg` : u === "ml" && q >= 1000 ? `${fmt(q / 1000)} l` : COUNTABLE.test(u) ? `${Math.ceil(q - 1e-9)}${u ? ` ${u}` : ""}` : `${fmt(q)}${u ? ` ${u}` : ""}`);

// ---------- voorstellen ----------
export const ProposeInput = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), days: z.number().int().min(1).max(14).default(7), dates: z.array(z.string()).optional(), exclude: z.array(z.string()).default([]), maxMinutesBusy: z.number().int().default(35) });
export interface DayPlan { date: string; busy: boolean; recipeId: string | null; title: string; image: string | null; minutes: number | null; why: string; current: string | null }
function busyEvening(date: string): boolean {
  return eventsBetween(date, date).some((e) => !e.allDay && e.startTime && e.endTime && toMin(e.startTime) < 19 * 60 + 30 && toMin(e.endTime) > 16 * 60 + 30);
}
export function propose(i: z.infer<typeof ProposeInput>): DayPlan[] {
  const lang = asLang(getSettings().language);
  const dates = i.dates?.length ? i.dates : Array.from({ length: i.days }, (_, k) => addDays(i.from, k));
  const recent = new Set(S.mealsBetween(addDays(i.from, -14), addDays(i.from, -1)).map((m) => m.recipeId).filter(Boolean));
  const current = S.mealsBetween(dates[0], dates[dates.length - 1]);
  const avoid = S.avoidWords();
  const pantry = (S.pantryList()?.items ?? []).filter((x) => !x.done);
  const expiring = pantry.filter((x) => x.expires && x.expires <= addDays(today(), 4)).map((x) => productKey(x.text));
  const inHouse = pantry.map((x) => productKey(x.text));
  const used = new Set<string>(i.exclude);
  const NOT_DINNER = new Set(["ontbijt", "dessert", "drank", "saus"]);
  const all = S.listRecipes().filter((r) => !S.dietHits(r.ingredients, avoid).length && !NOT_DINNER.has(r.category));
  const out: DayPlan[] = [];
  for (const date of dates) {
    const busy = busyEvening(date);
    const cur = current.find((m) => m.date === date && m.slot === "diner" && m.title);
    const fresh = all.filter((r) => !used.has(r.id));
    const pool = fresh.length ? fresh : all.filter((r) => r.id !== cur?.recipeId); // alles al gebruikt: dan toch kiezen, behalve wat er nu staat
    const scored = pool.map((r) => {
      const ing = r.ingredients.toLocaleLowerCase("tr");
      const keys = r.ingredients.split("\n").map((l) => parseLine(l)).filter((x): x is Ing => !!x).map((x) => productKey(x.name));
      const exp = expiring.filter((e) => e && keys.some((k) => k.includes(e) || e.includes(k))).length;
      const have = inHouse.filter((e) => e && keys.some((k) => k.includes(e) || e.includes(k))).length;
      const fast = r.minutes !== null && r.minutes <= i.maxMinutesBusy;
      let score = Math.random() * 2;
      if (busy) score += fast ? 6 : r.minutes === null ? 0 : -6;
      if (recent.has(r.id)) score -= 8;
      if (used.has(r.id)) score -= 4;
      score += exp * 5 + have * 1.5 + (r.favorite ? 2 : 0) + Math.min(r.cooked, 5) * 0.3;
      const why: string[] = [];
      if (busy && fast) why.push(L(lang, { nl: `drukke avond, klaar in ${r.minutes} min`, tr: `yoğun akşam, ${r.minutes} dk`, en: `busy evening, ready in ${r.minutes} min` }));
      if (exp) why.push(L(lang, { nl: "gebruikt wat bijna vervalt", tr: "bozulmak üzere olanları kullanır", en: "uses what is about to expire" }));
      else if (have >= 2) why.push(L(lang, { nl: `${have} ingrediënten al in huis`, tr: `${have} malzeme evde var`, en: `${have} ingredients already at home` }));
      if (r.favorite) why.push(L(lang, { nl: "lieveling", tr: "favori", en: "favourite" }));
      if (!why.length) why.push(L(lang, { nl: "stond de voorbije twee weken niet op tafel", tr: "son iki haftada yenmedi", en: "not on the table in the past two weeks" }));
      void ing;
      return { r, score, why: why.join(" · ") };
    }).sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (best) used.add(best.r.id);
    out.push({ date, busy, recipeId: best?.r.id ?? null, title: best?.r.title ?? "", image: best?.r.image ?? null, minutes: best?.r.minutes ?? null, why: best?.why ?? L(lang, { nl: "geen recepten meer die passen", tr: "uygun tarif kalmadı", en: "no more matching recipes" }), current: cur?.title ?? null });
  }
  return out;
}
export const ApplyInput = z.object({ items: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), recipeId: z.string(), title: z.string().min(1) })).min(1) });
export function apply(i: z.infer<typeof ApplyInput>) { for (const it of i.items) S.setMeal(it.date, "diner", it.title, it.recipeId); return i.items.length; }

// ---------- gebundelde boodschappen ----------
export interface BasketItem { name: string; amount: string; recipes: string[]; inHouse: boolean; price: { store: string; price: number; unitPrice: number; unit: string } | null }
export function basket(from: string, to: string, lang: Lang = asLang(getSettings().language)) {
  const people = S.listMembers().filter((m) => m.role !== "huisdier").length || 2;
  const recipes = S.listRecipes();
  const planned = S.mealsBetween(from, to).filter((m) => m.slot === "diner").map((m) => recipes.find((r) => r.id === m.recipeId)).filter((r): r is S.Recipe => !!r);
  const pantryKeys = (S.pantryList()?.items ?? []).filter((x) => !x.done).map((x) => productKey(x.text)).filter(Boolean);
  const agg = new Map<string, { name: string; qty: Map<string, number>; raw: string[]; recipes: Set<string> }>();
  for (const r of planned) {
    const serv = Number((r.servings.match(/\d+/) ?? ["0"])[0]) || 4;
    const factor = people / serv;
    for (const line of r.ingredients.split("\n")) {
      const ing = parseLine(line); if (!ing) continue;
      const key = productKey(ing.name) || ing.name.toLowerCase();
      const a = agg.get(key) ?? { name: ing.name, qty: new Map<string, number>(), raw: [] as string[], recipes: new Set<string>() };
      if (ing.qty !== null) { const b = toBase(ing.qty * factor, ing.unit); a.qty.set(b.u, (a.qty.get(b.u) ?? 0) + b.q); } else a.raw.push(ing.raw);
      a.recipes.add(r.title); agg.set(key, a);
    }
  }
  const names = [...agg.values()].map((a) => a.name);
  const prices = new Map(lookup(names).map((p) => [p.text, p]));
  const items: BasketItem[] = [...agg.entries()].map(([key, a]) => {
    const amount = [...a.qty.entries()].map(([u, q]) => fmtBase(q, u)).join(" + ") || (a.raw.length ? L(lang, { nl: "naar smaak", tr: "damak tadına göre", en: "to taste" }) : "");
    const inHouse = pantryKeys.some((p) => key === p || (p.length >= 3 && key.includes(p)) || (key.length >= 3 && p.includes(key)));
    const info = prices.get(a.name); const c = info?.cheapest ?? info?.latest ?? null;
    return { name: a.name, amount, recipes: [...a.recipes], inHouse, price: c ? { store: c.store, price: c.price, unitPrice: c.unitPrice, unit: c.unit } : null };
  }).sort((x, y) => Number(x.inHouse) - Number(y.inHouse) || x.name.localeCompare(y.name));
  const toBuy = items.filter((x) => !x.inHouse);
  const known = toBuy.filter((x) => x.price);
  const estimate = { total: Math.round(known.reduce((s, x) => s + x.price!.price, 0) * 100) / 100, known: known.length, toBuy: toBuy.length, stores: [...new Set(known.map((x) => x.price!.store))] };
  return { people, recipes: planned.map((r) => r.title), items, estimate };
}
/** De te kopen items op de boodschappenlijst zetten (zonder dubbels). */
export function basketToList(from: string, to: string, skip: string[] = []) {
  const shop = S.shoppingList(); if (!shop) return { added: 0 };
  const b = basket(from, to);
  const open = new Set(shop.items.filter((i) => !i.done).map((i) => productKey(i.text)));
  let added = 0;
  for (const it of b.items) {
    if (it.inHouse || skip.includes(it.name)) continue;
    const k = productKey(it.name); if (open.has(k)) continue; open.add(k);
    S.addItem(shop.id, it.name, { qty: it.amount && it.amount !== "naar smaak" ? it.amount : "" }); added++;
  }
  return { added, list: shop.name };
}
