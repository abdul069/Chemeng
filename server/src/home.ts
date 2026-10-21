// Het huis: onderhoud en verplichtingen (autokeuring, CV-ketel, rookmelders …), de afvalkalender en gezondheid per gezinslid.
import { z } from "zod";
import ical, { type VEvent } from "node-ical";
import { all, get, run, newId, hid, getSettings } from "./db.js";
import { today, addDays } from "./dates.js";
import { asLang, type Lang } from "./i18n.js";

// ---------- onderhoud en verplichtingen ----------
export const UPKEEP_CATS = ["auto", "verwarming", "veiligheid", "water", "verzekering", "administratie", "tuin", "huisdier", "overig"] as const;
export const UpkeepInput = z.object({
  title: z.string().trim().min(1).max(120),
  category: z.enum(UPKEEP_CATS).default("overig"),
  icon: z.string().max(16).default("🔧"),
  intervalMonths: z.number().int().min(0).max(240).default(12),
  lastDone: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  nextDue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  leadDays: z.number().int().min(0).max(365).default(30),
  memberId: z.string().nullable().optional(),
  provider: z.string().max(120).default(""),
  providerPhone: z.string().max(40).default(""),
  providerUrl: z.string().max(400).default(""),
  cost: z.string().max(40).default(""),
  notes: z.string().max(2000).default(""),
});
export interface Upkeep { id: string; title: string; category: string; icon: string; intervalMonths: number; lastDone: string | null; nextDue: string | null; leadDays: number; memberId: string | null; provider: string; providerPhone: string; providerUrl: string; cost: string; notes: string; attest: string | null; daysLeft: number | null; status: "ok" | "soon" | "due" | "late" | "none"; log: { id: string; doneOn: string; note: string }[] }

const addMonths = (d: string, n: number) => { const [y, m, day] = d.split("-").map(Number); const dt = new Date(y, m - 1 + n, day); if (dt.getDate() !== day) dt.setDate(0); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`; };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

type URow = { id: string; title: string; category: string; icon: string; interval_months: number; last_done: string | null; next_due: string | null; lead_days: number; member_id: string | null; provider: string; provider_phone: string; provider_url: string; cost: string; notes: string; attest: string | null };
function shape(r: URow): Upkeep {
  const t = today();
  const daysLeft = r.next_due ? daysBetween(t, r.next_due) : null;
  const status: Upkeep["status"] = daysLeft === null ? "none" : daysLeft < 0 ? "late" : daysLeft === 0 ? "due" : daysLeft <= r.lead_days ? "soon" : "ok";
  const log = all<{ id: string; done_on: string; note: string }>("SELECT id, done_on, note FROM upkeep_log WHERE upkeep_id=? ORDER BY done_on DESC LIMIT 12", r.id).map((l) => ({ id: l.id, doneOn: l.done_on, note: l.note }));
  return { id: r.id, title: r.title, category: r.category, icon: r.icon, intervalMonths: r.interval_months, lastDone: r.last_done, nextDue: r.next_due, leadDays: r.lead_days, memberId: r.member_id, provider: r.provider, providerPhone: r.provider_phone, providerUrl: r.provider_url, cost: r.cost, notes: r.notes, attest: r.attest, daysLeft, status, log };
}
export function listUpkeep(h = hid()): Upkeep[] {
  return all<URow>("SELECT * FROM upkeep WHERE household_id=? ORDER BY CASE WHEN next_due IS NULL THEN 1 ELSE 0 END, next_due, title", h).map(shape);
}
export function createUpkeep(i: z.infer<typeof UpkeepInput>, h = hid()) {
  const id = newId();
  const nextDue = i.nextDue ?? (i.lastDone && i.intervalMonths ? addMonths(i.lastDone, i.intervalMonths) : null);
  run("INSERT INTO upkeep(id, household_id, title, category, icon, interval_months, last_done, next_due, lead_days, member_id, provider, provider_phone, provider_url, cost, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    id, h, i.title, i.category, i.icon, i.intervalMonths, i.lastDone ?? null, nextDue, i.leadDays, i.memberId ?? null, i.provider, i.providerPhone, i.providerUrl, i.cost, i.notes);
  return id;
}
export function updateUpkeep(id: string, i: z.infer<typeof UpkeepInput>, h = hid()) {
  const nextDue = i.nextDue ?? (i.lastDone && i.intervalMonths ? addMonths(i.lastDone, i.intervalMonths) : null);
  return run("UPDATE upkeep SET title=?, category=?, icon=?, interval_months=?, last_done=?, next_due=?, lead_days=?, member_id=?, provider=?, provider_phone=?, provider_url=?, cost=?, notes=? WHERE id=? AND household_id=?",
    i.title, i.category, i.icon, i.intervalMonths, i.lastDone ?? null, nextDue, i.leadDays, i.memberId ?? null, i.provider, i.providerPhone, i.providerUrl, i.cost, i.notes, id, h).changes > 0;
}
export const deleteUpkeep = (id: string, h = hid()) => run("DELETE FROM upkeep WHERE id=? AND household_id=?", id, h);
/** "Gedaan" op een datum: in het logboek, en de volgende termijn berekend. */
export function upkeepDone(id: string, doneOn: string, note = "", h = hid()) {
  const r = get<URow>("SELECT * FROM upkeep WHERE id=? AND household_id=?", id, h);
  if (!r) return null;
  run("INSERT INTO upkeep_log(id, upkeep_id, done_on, note) VALUES (?,?,?,?)", newId(), id, doneOn, note);
  const next = r.interval_months ? addMonths(doneOn, r.interval_months) : null;
  run("UPDATE upkeep SET last_done=?, next_due=? WHERE id=?", doneOn, next, id);
  return shape(get<URow>("SELECT * FROM upkeep WHERE id=?", id)!);
}
export const setUpkeepAttest = (id: string, filename: string | null, h = hid()) => run("UPDATE upkeep SET attest=? WHERE id=? AND household_id=?", filename, id, h);

/** Belgische sjablonen met de gebruikelijke of wettelijke intervallen. */
export const UPKEEP_TEMPLATES: { key: string; title: string; titleTr: string; titleEn?: string; category: typeof UPKEEP_CATS[number]; icon: string; intervalMonths: number; leadDays: number; notes: string }[] = [
  { key: "keuring", title: "Autokeuring", titleTr: "Araç muayenesi", titleEn: "Car inspection", category: "auto", icon: "🚗", intervalMonths: 12, leadDays: 30, notes: "Jaarlijks vanaf het 4e jaar. Neem inschrijvingsbewijs, gelijkvormigheidsattest en vorig keuringsbewijs mee." },
  { key: "autoverzekering", title: "Autoverzekering vervaldag", titleTr: "Araç sigortası vadesi", titleEn: "Car insurance renewal", category: "verzekering", icon: "📄", intervalMonths: 12, leadDays: 45, notes: "Opzeggen kan tot 3 maanden voor de vervaldag." },
  { key: "banden", title: "Winter-/zomerbanden wisselen", titleTr: "Kış/yaz lastiği değişimi", titleEn: "Swap winter/summer tyres", category: "auto", icon: "🛞", intervalMonths: 6, leadDays: 14, notes: "" },
  { key: "cv-gas", title: "Onderhoud CV-ketel (gas)", titleTr: "Kombi bakımı (gaz)", titleEn: "Boiler service (gas)", category: "verwarming", icon: "🔥", intervalMonths: 24, leadDays: 45, notes: "Vlaanderen: verplicht om de 2 jaar door een erkend technicus; attest bewaren." },
  { key: "cv-stookolie", title: "Onderhoud CV-ketel (stookolie)", titleTr: "Kombi bakımı (fuel oil)", titleEn: "Boiler service (oil)", category: "verwarming", icon: "🔥", intervalMonths: 12, leadDays: 45, notes: "Verplicht jaarlijks; reinigings- en verbrandingsattest bewaren." },
  { key: "schoorsteen", title: "Schoorsteen vegen", titleTr: "Baca temizliği", titleEn: "Chimney sweep", category: "verwarming", icon: "🧹", intervalMonths: 12, leadDays: 30, notes: "Jaarlijks bij hout of stookolie; attest voor de verzekering." },
  { key: "rookmelders", title: "Rookmelders testen en batterij", titleTr: "Duman dedektörü testi ve pili", titleEn: "Test smoke detectors and battery", category: "veiligheid", icon: "🚨", intervalMonths: 12, leadDays: 14, notes: "Verplicht op elke verdieping. Vervang de melder zelf na 10 jaar." },
  { key: "co-melder", title: "CO-melder controleren", titleTr: "CO dedektörü kontrolü", titleEn: "Check CO detector", category: "veiligheid", icon: "⚠️", intervalMonths: 12, leadDays: 14, notes: "" },
  { key: "brandblusser", title: "Brandblusser nazicht", titleTr: "Yangın söndürücü kontrolü", titleEn: "Fire extinguisher check", category: "veiligheid", icon: "🧯", intervalMonths: 12, leadDays: 30, notes: "" },
  { key: "ventilatie", title: "Ventilatiefilters vervangen", titleTr: "Havalandırma filtresi değişimi", titleEn: "Replace ventilation filters", category: "water", icon: "🌬️", intervalMonths: 6, leadDays: 14, notes: "Systeem C/D: filters om de 6 maanden; kanalen om de 3 jaar reinigen." },
  { key: "ontharder", title: "Zout waterverzachter bijvullen", titleTr: "Su yumuşatıcı tuzu", titleEn: "Refill water softener salt", category: "water", icon: "🧂", intervalMonths: 2, leadDays: 7, notes: "" },
  { key: "boiler", title: "Boiler ontkalken", titleTr: "Termosifon kireç temizliği", titleEn: "Descale water heater", category: "water", icon: "🚿", intervalMonths: 24, leadDays: 30, notes: "" },
  { key: "dakgoot", title: "Dakgoten reinigen", titleTr: "Oluk temizliği", titleEn: "Clean gutters", category: "tuin", icon: "🍂", intervalMonths: 12, leadDays: 14, notes: "Na de herfst." },
  { key: "septisch", title: "Septische put ruimen", titleTr: "Fosseptik boşaltma", titleEn: "Empty septic tank", category: "water", icon: "🕳️", intervalMonths: 36, leadDays: 30, notes: "" },
  { key: "zonnepanelen", title: "Zonnepanelen en omvormer nazicht", titleTr: "Güneş paneli ve inverter kontrolü", titleEn: "Solar panels and inverter check", category: "overig", icon: "☀️", intervalMonths: 12, leadDays: 30, notes: "" },
  { key: "brandverzekering", title: "Brandverzekering vervaldag", titleTr: "Konut sigortası vadesi", titleEn: "Home insurance renewal", category: "verzekering", icon: "🏠", intervalMonths: 12, leadDays: 45, notes: "" },
  { key: "hospitalisatie", title: "Hospitalisatieverzekering vervaldag", titleTr: "Hastane sigortası vadesi", titleEn: "Hospital insurance renewal", category: "verzekering", icon: "🏥", intervalMonths: 12, leadDays: 45, notes: "" },
  { key: "meterstand", title: "Meterstanden doorgeven", titleTr: "Sayaç okuma bildirimi", titleEn: "Submit meter readings", category: "administratie", icon: "🔢", intervalMonths: 12, leadDays: 7, notes: "Water, en gas/elektriciteit bij een klassieke meter." },
  { key: "kids-id", title: "Kids-ID / identiteitskaart vernieuwen", titleTr: "Kids-ID / kimlik yenileme", titleEn: "Renew children's ID / ID card", category: "administratie", icon: "🪪", intervalMonths: 36, leadDays: 60, notes: "Kids-ID is 3 jaar geldig; aanvragen bij de gemeente, 2 à 3 weken wachttijd." },
  { key: "paspoort", title: "Paspoort vernieuwen", titleTr: "Pasaport yenileme", titleEn: "Renew passport", category: "administratie", icon: "🛂", intervalMonths: 84, leadDays: 90, notes: "Volwassenen 7 jaar, kinderen 5 jaar." },
  { key: "huisdier-vaccin", title: "Huisdier: vaccins en ontworming", titleTr: "Evcil hayvan: aşı ve kurt ilacı", titleEn: "Pet: vaccines and deworming", category: "huisdier", icon: "🐾", intervalMonths: 12, leadDays: 21, notes: "" },
];
export function applyTemplates(keys: string[], h = hid()) {
  const have = new Set(listUpkeep(h).map((u) => u.title.toLowerCase()));
  const lang = asLang(getSettings(h).language);
  let n = 0;
  for (const k of keys) {
    const tpl = UPKEEP_TEMPLATES.find((x) => x.key === k); if (!tpl || have.has(tpl.title.toLowerCase())) continue;
    createUpkeep(UpkeepInput.parse({ title: lang === "tr" ? tpl.titleTr : lang === "en" ? (tpl.titleEn ?? tpl.title) : tpl.title, category: tpl.category, icon: tpl.icon, intervalMonths: tpl.intervalMonths, leadDays: tpl.leadDays, notes: tpl.notes }), h); n++;
  }
  return n;
}

// ---------- afvalkalender ----------
export const FRACTIONS: { id: string; nl: string; tr: string; en: string; icon: string; words: string[] }[] = [
  { id: "rest", nl: "Restafval", tr: "Evsel atık", en: "General waste", icon: "🗑️", words: ["rest", "huisvuil", "restafval", "grijze"] },
  { id: "pmd", nl: "PMD", tr: "PMD (plastik, metal, içecek kartonu)", en: "Plastics, metal and cartons (PMD)", icon: "🧴", words: ["pmd", "plastic", "blauwe zak"] },
  { id: "papier", nl: "Papier & karton", tr: "Kâğıt ve karton", en: "Paper & cardboard", icon: "📦", words: ["papier", "karton"] },
  { id: "gft", nl: "GFT", tr: "Organik atık (GFT)", en: "Organic waste", icon: "🥬", words: ["gft", "groente", "tuinafval", "groen"] },
  { id: "glas", nl: "Glas", tr: "Cam", en: "Glass", icon: "🍾", words: ["glas"] },
  { id: "grof", nl: "Grofvuil", tr: "İri atık", en: "Bulky waste", icon: "🛋️", words: ["grof", "grofvuil", "grof huisvuil"] },
  { id: "textiel", nl: "Textiel", tr: "Tekstil", en: "Textiles", icon: "👕", words: ["textiel", "kledij"] },
  { id: "snoei", nl: "Snoeihout", tr: "Budama dalı", en: "Garden prunings", icon: "🌳", words: ["snoei", "takken"] },
];
export const WasteInput = z.object({ fraction: z.string().min(1).max(20), weekday: z.number().int().min(0).max(6), everyWeeks: z.number().int().min(1).max(8).default(1), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), notes: z.string().max(200).default("") });
export interface WasteRule { id: string; fraction: string; weekday: number; everyWeeks: number; startDate: string; notes: string }
export function listWaste(h = hid()): WasteRule[] {
  return all<{ id: string; fraction: string; weekday: number; every_weeks: number; start_date: string; notes: string }>("SELECT id, fraction, weekday, every_weeks, start_date, notes FROM waste WHERE household_id=? ORDER BY weekday, fraction", h)
    .map((r) => ({ id: r.id, fraction: r.fraction, weekday: r.weekday, everyWeeks: r.every_weeks, startDate: r.start_date, notes: r.notes }));
}
export function createWaste(i: z.infer<typeof WasteInput>, h = hid()) { const id = newId(); run("INSERT INTO waste(id, household_id, fraction, weekday, every_weeks, start_date, notes) VALUES (?,?,?,?,?,?,?)", id, h, i.fraction, i.weekday, i.everyWeeks, i.startDate, i.notes); return id; }
export const deleteWaste = (id: string, h = hid()) => run("DELETE FROM waste WHERE id=? AND household_id=?", id, h);
const wd = (d: string) => new Date(d + "T12:00:00").getDay();
/** Welke fracties worden op die dag opgehaald (handmatige regels + iCal)? */
export function wasteOn(date: string, h = hid()): string[] {
  const out = new Set<string>();
  for (const r of listWaste(h)) {
    if (wd(date) !== r.weekday || date < r.startDate) continue;
    const weeks = Math.floor(daysBetween(r.startDate, date) / 7);
    if (weeks % r.everyWeeks === 0) out.add(r.fraction);
  }
  for (const r of all<{ fraction: string }>("SELECT fraction FROM waste_dates WHERE household_id=? AND date=?", h, date)) out.add(r.fraction);
  return [...out];
}
export function wasteNext(days = 14, h = hid()) {
  const t = today(); const out: { date: string; fractions: string[] }[] = [];
  for (let i = 0; i < days; i++) { const d = addDays(t, i); const f = wasteOn(d, h); if (f.length) out.push({ date: d, fractions: f }); }
  return out;
}
export const fractionLabel = (id: string, lang: Lang) => { const f = FRACTIONS.find((x) => x.id === id); return f ? f[lang] : id; };
export const fractionIcon = (id: string) => FRACTIONS.find((x) => x.id === id)?.icon ?? "♻️";
const guessFraction = (title: string) => { const l = title.toLowerCase(); return FRACTIONS.find((f) => f.words.some((w) => l.includes(w)))?.id ?? null; };
/** De afvalkalender van de intercommunale via haar iCal-adres inlezen (een jaar vooruit). */
export async function syncWasteIcal(h: string, url: string): Promise<number> {
  const res = await fetch(url.replace(/^webcal:/i, "https:"), { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`De afvalkalender gaf foutcode ${res.status}.`);
  const body = await res.text();
  if (!body.includes("BEGIN:VCALENDAR")) throw new Error("Dit adres geeft geen iCal-kalender terug.");
  const data = ical.sync.parseICS(body);
  const from = new Date(`${addDays(today(), -7)}T00:00:00Z`), to = new Date(`${addDays(today(), 400)}T00:00:00Z`);
  const rows: [string, string][] = [];
  for (const item of Object.values(data)) {
    if (!item || item.type !== "VEVENT") continue;
    const ev = item as VEvent;
    for (const inst of ical.expandRecurringEvent(ev, { from, to, expandOngoing: true })) {
      const start = inst.start as Date; const d = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
      const title = typeof inst.summary === "string" ? inst.summary : String((inst.summary as { val?: string })?.val ?? "");
      const f = guessFraction(title) ?? title.slice(0, 20).toLowerCase();
      rows.push([d, f]);
    }
  }
  run("DELETE FROM waste_dates WHERE household_id=?", h);
  for (const [d, f] of rows) run("INSERT OR IGNORE INTO waste_dates(household_id, date, fraction) VALUES (?,?,?)", h, d, f);
  return rows.length;
}

// ---------- gezondheid ----------
export const HEALTH_KINDS = ["visit", "checkup", "vaccine", "medication"] as const;
export const HealthInput = z.object({
  memberId: z.string(),
  kind: z.enum(HEALTH_KINDS),
  title: z.string().trim().min(1).max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  provider: z.string().max(120).default(""),
  providerPhone: z.string().max(40).default(""),
  notes: z.string().max(2000).default(""),
  followUpMonths: z.number().int().min(0).max(120).default(0),
  // medicatie: innametijden en weekdagen, voorraad in stuks
  times: z.string().max(80).default(""),
  days: z.array(z.number().int().min(0).max(6)).default([0, 1, 2, 3, 4, 5, 6]),
  stock: z.number().int().min(0).max(10000).nullable().optional(),
  done: z.boolean().default(false),
});
export interface HealthItem { id: string; memberId: string; kind: typeof HEALTH_KINDS[number]; title: string; date: string | null; time: string | null; provider: string; providerPhone: string; notes: string; followUpMonths: number; times: string; days: number[]; stock: number | null; done: boolean; createdAt: string }
type HRow = { id: string; member_id: string; kind: HealthItem["kind"]; title: string; date: string | null; time: string | null; provider: string; provider_phone: string; notes: string; follow_up_months: number; times: string; days: string; stock: number | null; done: number; created_at: string };
const hshape = (r: HRow): HealthItem => ({ id: r.id, memberId: r.member_id, kind: r.kind, title: r.title, date: r.date, time: r.time, provider: r.provider, providerPhone: r.provider_phone, notes: r.notes, followUpMonths: r.follow_up_months, times: r.times, days: JSON.parse(r.days || "[]"), stock: r.stock, done: !!r.done, createdAt: r.created_at });
export function listHealth(h = hid(), memberId?: string): HealthItem[] {
  return all<HRow>(`SELECT * FROM health WHERE household_id=?${memberId ? " AND member_id=?" : ""} ORDER BY done, CASE WHEN date IS NULL THEN 1 ELSE 0 END, date, time`, ...(memberId ? [h, memberId] : [h])).map(hshape);
}
export function createHealth(i: z.infer<typeof HealthInput>, h = hid()) {
  const id = newId();
  run("INSERT INTO health(id, household_id, member_id, kind, title, date, time, provider, provider_phone, notes, follow_up_months, times, days, stock, done) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    id, h, i.memberId, i.kind, i.title, i.date ?? null, i.time ?? null, i.provider, i.providerPhone, i.notes, i.followUpMonths, i.times, JSON.stringify(i.days), i.stock ?? null, i.done ? 1 : 0);
  return id;
}
export function updateHealth(id: string, i: z.infer<typeof HealthInput>, h = hid()) {
  return run("UPDATE health SET member_id=?, kind=?, title=?, date=?, time=?, provider=?, provider_phone=?, notes=?, follow_up_months=?, times=?, days=?, stock=?, done=? WHERE id=? AND household_id=?",
    i.memberId, i.kind, i.title, i.date ?? null, i.time ?? null, i.provider, i.providerPhone, i.notes, i.followUpMonths, i.times, JSON.stringify(i.days), i.stock ?? null, i.done ? 1 : 0, id, h).changes > 0;
}
export const deleteHealth = (id: string, h = hid()) => run("DELETE FROM health WHERE id=? AND household_id=?", id, h);
/** Bezoek afgerond: klaar zetten en, als er een opvolgtermijn is, meteen de controle inplannen. */
export function healthDone(id: string, h = hid()): HealthItem | null {
  const r = get<HRow>("SELECT * FROM health WHERE id=? AND household_id=?", id, h);
  if (!r) return null;
  run("UPDATE health SET done=1 WHERE id=?", id);
  if (r.follow_up_months > 0 && r.date) {
    const next = addMonths(r.date, r.follow_up_months);
    const nid = newId();
    run("INSERT INTO health(id, household_id, member_id, kind, title, date, time, provider, provider_phone, notes, follow_up_months, times, days, stock, done) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)",
      nid, h, r.member_id, "checkup", r.kind === "checkup" ? r.title : `Controle: ${r.title}`, next, null, r.provider, r.provider_phone, "", r.follow_up_months, "", "[]", null);
    return hshape(get<HRow>("SELECT * FROM health WHERE id=?", nid)!);
  }
  return hshape(get<HRow>("SELECT * FROM health WHERE id=?", id)!);
}
/** Medicatie die op die dag ingenomen moet worden, met tijden. */
export function medicationOn(date: string, h = hid(), memberId?: string) {
  return listHealth(h, memberId).filter((x) => x.kind === "medication" && !x.done && x.days.includes(wd(date)) && (!x.date || x.date <= date)).map((m) => ({ ...m, timesList: m.times.split(",").map((s) => s.trim()).filter(Boolean) }));
}
