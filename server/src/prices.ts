/** Prijsgeheugen van het gezin: wat kostte wat, waar en wanneer. Uit kassatickets (foto), prijsetiketten (foto) of handmatig.
 *  Elke prijs wordt omgerekend per kg, per liter of per stuk zodat winkels en verpakkingen vergelijkbaar zijn. */
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { db, all, get, run, newId, hid, getSettings } from "./db.js";
import { today, addDays } from "./dates.js";
import * as S from "./store.js";
import { getClient, aiReady } from "./ai.js";
import { MODELS, aiAllowed, recordUsage } from "./billing.js";
import { L, asLang } from "./i18n.js";
import type { ImageInput } from "./importer.js";

db.exec(`
CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  store TEXT NOT NULL, seen_on TEXT NOT NULL, total REAL, items INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS prices (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  receipt_id TEXT REFERENCES receipts(id) ON DELETE CASCADE,
  product TEXT NOT NULL, label TEXT NOT NULL, store TEXT NOT NULL, seen_on TEXT NOT NULL,
  price REAL NOT NULL, qty REAL NOT NULL, unit TEXT NOT NULL, unit_price REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS prices_household_product ON prices(household_id, product);
`);
try { db.exec("ALTER TABLE prices ADD COLUMN valid_until TEXT"); } catch { /* bestaat al */ }

export const STORE_NAMES = ["Colruyt", "Delhaize", "Carrefour", "Lidl", "Aldi", "Albert Heijn", "Jumbo", "Okay", "Spar", "Kruidvat", "Action", "Markt", "Bakker", "Slager", "Turkse winkel"];
export type Unit = "kg" | "l" | "st";
export interface Price { id: string; receiptId: string | null; product: string; label: string; store: string; seenOn: string; price: number; qty: number; unit: Unit; unitPrice: number; source: string; /** promo: geldig tot en met */ validUntil: string | null }
export interface Receipt { id: string; store: string; seenOn: string; total: number | null; items: number; createdAt: string }

// ---------- normaliseren ----------
const fold = (s: string) => s.toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");
/** "Bio halfvolle melk 1L" → "bio halfvolle melk": zonder hoeveelheid, leestekens en dubbele spaties. */
export function productKey(label: string): string {
  return fold(label)
    .replace(/\d+(?:[.,]\d+)?\s*(?:x\s*\d+(?:[.,]\d+)?\s*)?(?:kg|g|gr|gram|l|ml|cl|dl|liter|st|stuks|stuk|pcs|x)\b\.?/g, " ")
    .replace(/\b\d+(?:[.,]\d+)?\b/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
}
const toBase: Record<string, [number, Unit]> = { kg: [1, "kg"], g: [0.001, "kg"], gr: [0.001, "kg"], gram: [0.001, "kg"], l: [1, "l"], liter: [1, "l"], ml: [0.001, "l"], cl: [0.01, "l"], dl: [0.1, "l"], st: [1, "st"], stuk: [1, "st"], stuks: [1, "st"], pcs: [1, "st"], x: [1, "st"] };
/** "6 x 250 g" → 1,5 kg · "1,5 l" → 1,5 l · "500g" → 0,5 kg · "12 stuks" → 12 st · niets → 1 st */
export function parseQty(text: string): { qty: number; unit: Unit } {
  const t = fold(text);
  const multi = t.match(/(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*(kg|g|gr|l|ml|cl|dl|st)?\b/);
  if (multi) { const [f, u] = toBase[multi[3] ?? "st"]; return { qty: Number(multi[1].replace(",", ".")) * Number(multi[2].replace(",", ".")) * f, unit: u }; }
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(kg|gram|gr|g|liter|ml|cl|dl|l|stuks|stuk|st|pcs)\b/);
  if (m) { const [f, u] = toBase[m[2]]; return { qty: Number(m[1].replace(",", ".")) * f, unit: u }; }
  const n = t.match(/^(\d+)\b/);
  return { qty: n ? Number(n[1]) : 1, unit: "st" };
}
export const unitLabel = (u: Unit, lang = asLang(getSettings().language)) => (u === "kg" ? "kg" : u === "l" ? "l" : L(lang, { nl: "st", tr: "ad", en: "pc" }));

// ---------- opslag ----------
type Row = { id: string; receipt_id: string | null; product: string; label: string; store: string; seen_on: string; price: number; qty: number; unit: Unit; unit_price: number; source: string; valid_until: string | null };
const shape = (r: Row): Price => ({ id: r.id, receiptId: r.receipt_id, product: r.product, label: r.label, store: r.store, seenOn: r.seen_on, price: r.price, qty: r.qty, unit: r.unit, unitPrice: r.unit_price, source: r.source, validUntil: r.valid_until ?? null });

export const PriceInput = z.object({
  label: z.string().trim().min(1).max(120),
  store: z.string().trim().min(1).max(60),
  price: z.number().min(0).max(10000),
  /** hoeveelheid als tekst ("500 g", "1,5 l", "6 stuks") of getal + unit */
  qtyText: z.string().max(40).optional(),
  qty: z.number().positive().max(100000).optional(),
  unit: z.enum(["kg", "l", "st"]).optional(),
  seenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  source: z.enum(["ticket", "label", "manual", "deal"]).default("manual"),
  /** promo geldig tot en met (alleen bij source deal) */
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
export function addPrice(i: z.infer<typeof PriceInput>, receiptId: string | null = null, h = hid()): Price {
  const q = i.qty && i.unit ? { qty: i.qty, unit: i.unit } : parseQty(i.qtyText || i.label);
  const unitPrice = q.qty > 0 ? i.price / q.qty : i.price;
  const id = newId();
  run("INSERT INTO prices(id, household_id, receipt_id, product, label, store, seen_on, price, qty, unit, unit_price, source, valid_until) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    id, h, receiptId, productKey(i.label) || fold(i.label), i.label, i.store.trim(), i.seenOn ?? today(), i.price, q.qty, q.unit, unitPrice, i.source, i.source === "deal" ? i.validUntil ?? null : null);
  return shape(get<Row>("SELECT * FROM prices WHERE id=?", id)!);
}
export const deletePrice = (id: string, h = hid()) => run("DELETE FROM prices WHERE id=? AND household_id=?", id, h);
export function listPrices(opts: { product?: string; store?: string; days?: number; limit?: number } = {}, h = hid()): Price[] {
  const since = addDays(today(), -(opts.days ?? 365));
  // promo's die voorbij zijn tellen niet meer mee
  const rows = all<Row>(`SELECT * FROM prices WHERE household_id=? AND seen_on>=? AND (valid_until IS NULL OR valid_until>=?) ${opts.product ? "AND product=?" : ""} ${opts.store ? "AND store=?" : ""} ORDER BY seen_on DESC, created_at DESC LIMIT ?`,
    h, since, today(), ...(opts.product ? [opts.product] : []), ...(opts.store ? [opts.store] : []), opts.limit ?? 500);
  return rows.map(shape);
}
export function listReceipts(h = hid(), limit = 50): Receipt[] {
  return all<{ id: string; store: string; seen_on: string; total: number | null; items: number; created_at: string }>("SELECT id, store, seen_on, total, items, created_at FROM receipts WHERE household_id=? ORDER BY seen_on DESC, created_at DESC LIMIT ?", h, limit)
    .map((r) => ({ id: r.id, store: r.store, seenOn: r.seen_on, total: r.total, items: r.items, createdAt: r.created_at }));
}
export const deleteReceipt = (id: string, h = hid()) => run("DELETE FROM receipts WHERE id=? AND household_id=?", id, h);

// ---------- opzoeken en vergelijken ----------
/** Welke bewaarde prijzen horen bij een lijstitem? Zelfde sleutel, of de ene bevat de andere (minstens 3 letters). */
function matches(itemKey: string, productKey_: string) {
  if (!itemKey || !productKey_) return false;
  if (itemKey === productKey_) return true;
  const words = itemKey.split(" ").filter((w) => w.length >= 3);
  return words.length > 0 && words.every((w) => productKey_.includes(w));
}
export interface PriceInfo { text: string; latest: Price | null; cheapest: Price | null; byStore: Price[] }
/** Per item: de laatste prijs per winkel (laatste 180 dagen), de laatste overall en de goedkoopste per eenheid. */
export function lookup(texts: string[], h = hid()): PriceInfo[] {
  const recent = listPrices({ days: 180, limit: 3000 }, h);
  return texts.map((text) => {
    const key = productKey(text);
    const hits = recent.filter((p) => matches(key, p.product));
    const byStore = new Map<string, Price>();
    for (const p of hits) if (!byStore.has(p.store)) byStore.set(p.store, p); // gesorteerd op datum: eerste = laatste
    const stores = [...byStore.values()];
    const sameUnit = (a: Price, b: Price) => a.unit === b.unit;
    const latest = hits[0] ?? null;
    const cheapest = latest ? stores.filter((p) => sameUnit(p, latest)).sort((a, b) => a.unitPrice - b.unitPrice)[0] ?? null : null;
    return { text, latest, cheapest, byStore: stores };
  });
}
/** Beste winkel voor een hele lijst: per winkel de som van de laatste bekende prijs per item en hoeveel items bekend zijn. */
export function bestStores(texts: string[], h = hid()) {
  const infos = lookup(texts, h);
  const stores = new Map<string, { store: string; total: number; known: number; items: { text: string; price: number }[] }>();
  for (const i of infos) for (const p of i.byStore) {
    const s = stores.get(p.store) ?? { store: p.store, total: 0, known: 0, items: [] };
    s.total += p.price; s.known++; s.items.push({ text: i.text, price: p.price }); stores.set(p.store, s);
  }
  const ranked = [...stores.values()].sort((a, b) => b.known - a.known || a.total - b.total);
  // slim splitsen: elk item bij zijn goedkoopste winkel
  const split = infos.filter((i) => i.cheapest).reduce((acc, i) => { acc.total += i.cheapest!.price; acc.stores.add(i.cheapest!.store); return acc; }, { total: 0, stores: new Set<string>() });
  const known = infos.filter((i) => i.byStore.length).length;
  return { items: texts.length, known, stores: ranked, split: { total: Math.round(split.total * 100) / 100, stores: [...split.stores] }, infos };
}
export function history(product: string, h = hid()) {
  const key = productKey(product);
  return listPrices({ days: 730, limit: 3000 }, h).filter((p) => matches(key, p.product)).sort((a, b) => a.seenOn.localeCompare(b.seenOn));
}
/** Uitgaven per maand per winkel uit de kassatickets (totaal van het ticket, anders de som van de regels). */
export function spend(months = 6, h = hid()) {
  const since = addDays(today(), -31 * months).slice(0, 7) + "-01";
  return all<{ month: string; store: string; total: number; tickets: number }>(
    `SELECT substr(r.seen_on,1,7) AS month, r.store, SUM(COALESCE(r.total, (SELECT SUM(p.price) FROM prices p WHERE p.receipt_id=r.id))) AS total, COUNT(*) AS tickets
     FROM receipts r WHERE r.household_id=? AND r.seen_on>=? GROUP BY month, r.store ORDER BY month DESC, total DESC`, h, since);
}

// ---------- foto van ticket of etiket lezen ----------
const ScanItem = z.object({ label: z.string().describe("Productnaam zoals op het ticket of in de folder, zonder prijs"), qty: z.number().describe("Hoeveelheid; 1 als onbekend"), unit: z.enum(["kg", "g", "l", "ml", "st"]).describe("Eenheid van qty; st = stuks"), price: z.number().describe("Betaalde of promoprijs voor deze regel in euro, na korting") });
const Scan = z.object({ store: z.string().describe("Winkelnaam, leeg als onbekend"), date: z.string().describe("Datum YYYY-MM-DD, leeg als onbekend"), total: z.number().nullable().describe("Totaalbedrag van het ticket, null bij een etiket of folder"), validUntil: z.string().nullable().describe("Folder: geldig tot en met, YYYY-MM-DD; anders null"), items: z.array(ScanItem) });
export type ScanResult = z.infer<typeof Scan>;
export const scanAvailable = () => aiReady();
export async function scanImage(image: ImageInput, kind: "ticket" | "label" | "folder"): Promise<ScanResult> {
  const client = getClient(); if (!client) throw new Error("De assistent is niet ingesteld: vul de Claude API-sleutel in bij Instellingen → Assistent.");
  if (!aiAllowed("import")) throw new Error("Het AI-budget van dit gezin is deze maand op.");
  const system = kind === "ticket"
    ? `Je leest een kassaticket van een supermarkt of winkel voor het prijsgeheugen van een gezin. Vandaag is ${today()}.
Geef de winkelnaam, de datum en elke productregel met de betaalde prijs (na korting; statiegeld en zakken overslaan). Haal de hoeveelheid uit de productnaam of de regel ("1L", "500G", "2 x 250 g", "0,742 kg x 9,99 €/kg"); bij gewichtsartikelen is qty het gewogen gewicht. Onbekende hoeveelheid: qty 1, unit "st". Houd productnamen leesbaar (bv. "Halfvolle melk 1L" in plaats van "HV MELK"). Verzin niets.`
    : kind === "folder"
    ? `Je leest een pagina van een reclamefolder van een supermarkt. Geef de winkel, de periode waarin de promo's gelden (validUntil = laatste dag, YYYY-MM-DD; vandaag is ${today()}) en elke aanbieding als item: productnaam, verpakkingshoeveelheid (qty + unit) en de promoprijs per verpakking in euro (bij "2 + 1 gratis" of "-30 %" de effectieve prijs per stuk als die te berekenen is, anders de prijs die erbij staat). Verzin niets; sla producten zonder prijs over.`
    : `Je leest een prijsetiket in een winkel (schapkaartje). Geef één item: productnaam, de verpakkingshoeveelheid, en de prijs. Staat er een winkelnaam of logo, geef die als store. Datum: ${today()}. Verzin niets.`;
  const content: Anthropic.ContentBlockParam[] = [{ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } }, { type: "text", text: kind === "ticket" ? "Lees het kassaticket." : kind === "folder" ? "Lees de folderpagina." : "Lees het prijsetiket." }];
  const res = await client.messages.parse({ model: MODELS.light, max_tokens: 6000, output_config: { effort: "medium", format: zodOutputFormat(Scan) }, system, messages: [{ role: "user", content }] });
  recordUsage("import", MODELS.light, res.usage);
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error("Ik kon hier geen prijzen uit lezen.");
  const out = res.parsed_output;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.date)) out.date = today();
  if (out.validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(out.validUntil)) out.validUntil = null;
  return out;
}
export const CommitInput = z.object({
  store: z.string().trim().min(1).max(60), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), total: z.number().nullable().optional(),
  items: z.array(z.object({ label: z.string().trim().min(1).max(120), qty: z.number().positive(), unit: z.enum(["kg", "g", "l", "ml", "st"]), price: z.number().min(0) })).min(1).max(200),
  source: z.enum(["ticket", "label", "folder"]).default("ticket"),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  /** gekochte dingen ook in de voorraad zetten */ toPantry: z.boolean().default(false),
  /** overeenkomende open items op de boodschappenlijst afvinken */ tickList: z.boolean().default(true),
});
export function commit(i: z.infer<typeof CommitInput>, h = hid()) {
  const receiptId = i.source === "ticket" ? newId() : null;
  if (receiptId) run("INSERT INTO receipts(id, household_id, store, seen_on, total, items) VALUES (?,?,?,?,?,?)", receiptId, h, i.store.trim(), i.date, i.total ?? null, i.items.length);
  const prices: Price[] = [];
  for (const it of i.items) {
    const [f, u] = toBase[it.unit];
    prices.push(addPrice({ label: it.label, store: i.store, price: it.price, qty: it.qty * f, unit: u, seenOn: i.date, source: i.source === "folder" ? "deal" : i.source, validUntil: i.source === "folder" ? i.validUntil ?? null : null }, receiptId, h));
  }
  let ticked = 0, stocked = 0;
  if (i.source !== "folder" && (i.tickList || i.toPantry)) {
    const shop = S.shoppingList(); const pantry = i.toPantry ? S.ensurePantryList() : null;
    for (const it of i.items) {
      const key = productKey(it.label);
      let hit = false;
      if (i.tickList && shop) for (const li of shop.items.filter((x) => !x.done)) { const lk = productKey(li.text); if (matches(lk, key) || matches(key, lk)) { S.updateItem(li.id, { done: true }); S.syncShopPantry(li.id, true); li.done = true; ticked++; hit = true; break; } }
      if (pantry && !hit) { S.addItem(pantry, it.label, { qty: it.unit === "st" ? (it.qty > 1 ? `${it.qty}` : "") : `${it.qty} ${it.unit}` }); stocked++; }
    }
  }
  return { receiptId, prices: prices.length, ticked, stocked };
}
