// Koppelingen als één systeem: elke koppeling is een module met een vaste vorm (eigenaar, wat ze nodig heeft, wat ze levert).
// Alles staat standaard uit; een koppeling vult alleen bestaande plekken: agenda-laag, briefingregel, widget, lijst-links, voorstel.
import { z } from "zod";
import crypto from "node:crypto";
import { db, all, get, run, newId, hid, getSettings } from "./db.js";
import { today, addDays } from "./dates.js";
import * as H from "./home.js";
import type { Item, Proposal } from "./manager.js";
import { L, asLang, UA as USER_AGENT, type Lang } from "./i18n.js";
import { REGIONS, breaksBetween, type Region } from "./schoolyear.js";
import { addPrice, listPrices, productKey } from "./prices.js";
import * as Inbox from "./inbox.js";
import * as TG from "./telegram.js";
import * as Tuya from "./tuya.js";

db.exec(`
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
  connector TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  on_board INTEGER NOT NULL DEFAULT 0,
  last_sync TEXT, status TEXT NOT NULL DEFAULT 'new', error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---------- versleuteling van de instellingen (sleutels, adressen) ----------
function secretKey(): Buffer {
  const env = process.env.GB_SECRET;
  if (env) return crypto.createHash("sha256").update(env).digest();
  let row = get<{ value: string }>("SELECT value FROM global_settings WHERE key='conn_key'");
  if (!row) { run("INSERT INTO global_settings(key, value) VALUES('conn_key', ?)", crypto.randomBytes(32).toString("hex")); row = get("SELECT value FROM global_settings WHERE key='conn_key'"); }
  return Buffer.from(row!.value, "hex");
}
export function encrypt(obj: unknown): string {
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return `${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${enc.toString("base64")}`;
}
export function decrypt<T = Record<string, unknown>>(s: string): T {
  if (!s) return {} as T;
  const [iv, tag, data] = s.split(".").map((x) => Buffer.from(x, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", secretKey(), iv); d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString("utf8")) as T;
}

// ---------- de vorm van een koppeling ----------
export type Category = "school" | "werk" | "uit" | "mobiliteit" | "huis" | "eten" | "winkelen" | "gezondheid" | "nieuws" | "tradities" | "automatisering";
export const CATEGORY_LABEL: Record<Category, string> = { school: "School en kinderen", werk: "Werk en agenda", uit: "Uit en vrije tijd", mobiliteit: "Mobiliteit", huis: "Huis en energie", eten: "Eten", winkelen: "Winkelen", gezondheid: "Gezondheid", nieuws: "Nieuws en weer", tradities: "Kalenders en tradities", automatisering: "Berichten en automatisering" };
const CATEGORY_LABEL_EN: Record<Category, string> = { school: "School and children", werk: "Work and calendar", uit: "Going out and leisure", mobiliteit: "Mobility", huis: "Home and energy", eten: "Food", winkelen: "Shopping", gezondheid: "Health", nieuws: "News and weather", tradities: "Calendars and traditions", automatisering: "Messages and automation" };
const CATEGORY_LABEL_TR: Record<Category, string> = { school: "Okul ve çocuklar", werk: "İş ve takvim", uit: "Gezi ve boş zaman", mobiliteit: "Ulaşım", huis: "Ev ve enerji", eten: "Yemek", winkelen: "Alışveriş", gezondheid: "Sağlık", nieuws: "Haber ve hava", tradities: "Takvimler ve gelenekler", automatisering: "Mesajlar ve otomasyon" };
/** Engelse naam en uitleg per koppeling (Nederlands staat in de definitie zelf). */
const EN_TEXT: Record<string, { name: string; description: string }> = {
  waste_ical: { name: "Waste calendar (iCal)", description: "The iCal or webcal address of your waste collector; {brand} reads a year ahead and tells you in the evening what goes out." },
  nmbs: { name: "Train (NMBS)", description: "Your usual route: delays and the next trains in your morning briefing and on your phone." },
  kmi: { name: "KMI weather warnings", description: "Yellow, orange or red code for storm, heat, ice or thunder: on the board and in the briefing as soon as the Belgian weather service warns." },
  rss: { name: "News (RSS)", description: "Headlines from any news source of your choice; on the board or only on your phone." },
  stores: { name: "Your shops", description: "Pick your supermarkets: put the list in their search box with one tap, see this week's flyer. One-tap ordering follows once the chains join." },
  food_delivery: { name: "Order food", description: "Takeaway, Uber Eats or Deliveroo as a way out when dinner is not planned: one tap to your favourite restaurant." },
  rides: { name: "Order a ride", description: "For an event with an address: one tap opens Uber or the route in Maps with the destination filled in." },
  uit: { name: "UiTinVlaanderen", description: "Family activities near you this weekend, from publiq's open database; the manager suggests them on Friday." },
  delijn: { name: "De Lijn", description: "The next buses and trams at your stop, real time, in the morning briefing and on the board. Needs a free key from De Lijn Open Data, or the admin sets one for everyone." },
  mivb: { name: "MIVB/STIB", description: "Metro, tram and bus in Brussels: the next departures at your stop, real time. Needs a free key from STIB Open Data, or the admin sets one for everyone." },
  inbox: { name: "Family inbox", description: "An email address for your family: forward the school letter, the doctor, the inspection letter or a receipt and {brand} turns it into events, groceries and prices. You review, one tap and it is in." },
  recycle: { name: "Recycle! (waste app)", description: "Straight from the Recycle! app. Unofficial connection that may break; prefer your waste collector's iCal address." },
  school_holidays: { name: "School holidays", description: "Flemish, French-community or Dutch school holidays as a calendar layer, with a nudge the day before they start and end." },
  teams_status: { name: "Teams status", description: "“Dad is in a meeting until 3pm” on the board. Coming in a next round." },
  withings: { name: "Withings", description: "Scale and blood pressure monitor in the diet and health section. Coming in a next round." },
  tuya: { name: "Tuya / Smart Life", description: "Lights, plugs, thermostats and sensors from Action (LSC), Lidl (Silvercrest), Nedis, Calex and many other brands that use the Smart Life app. They show up under The house → Smart home next to Home Assistant and take part in scenes and the manager's suggestions." },
  telegram: { name: "Telegram bot", description: "Your family's own bot: send a photo of the school letter or the receipt, or type \"milk, bread, nappies\". Everything lands in the family inbox and the bot confirms." },
  webhooks: { name: "Webhooks (Siri, IFTTT, n8n)", description: "A secret address through which Siri shortcuts, IFTTT, n8n or a smart speaker add something to the shopping list, the noticeboard or the calendar. POST JSON: {\"list\": \"milk\"}, {\"note\": \"…\"} or {\"event\": {\"title\", \"date\", \"startTime\"}}." },
  deals_feed: { name: "Flyers and deals (partner feed)", description: "A JSON feed with promotions from a partner (Promojagers, Tiendeo/ShopFully, a chain). Deals enter the price memory and count on the shopping list and in the Weekbox." },
};
export interface Field { key: string; label: string; type: "text" | "url" | "secret" | "select" | "multiselect" | "number" | "time" | "textarea"; options?: { value: string; label: string }[]; placeholder?: string; required?: boolean; hint?: string }
export interface Link { label: string; url: string; icon: string }
export interface Widget { title: string; icon: string; lines: { icon?: string; text: string; sub?: string; url?: string }[] }
export interface CalItem { id: string; title: string; date: string; endDate?: string | null; startTime?: string | null; endTime?: string | null; allDay: boolean; location?: string; url?: string }
export interface Conn { id: string; householdId: string; memberId: string | null; connector: string; config: Record<string, unknown>; state: Record<string, unknown>; enabled: boolean; onBoard: boolean; lastSync: string | null; status: string; error: string }
export interface Ctx { kind: "morning" | "evening"; date: string; memberId: string | null; lang: Lang }
export interface ConnectorDef {
  id: string; name: string; description: string; category: Category; icon: string;
  scope: "household" | "member"; plan: "gezin" | "plus"; country: string[]; status: "ready" | "unofficial" | "soon";
  fields: Field[]; provides: ("calendar" | "briefing" | "widget" | "links" | "proposal")[]; refreshMinutes: number;
  sync?: (c: Conn) => Promise<Record<string, unknown>>;
  briefing?: (c: Conn, ctx: Ctx) => Item[];
  proposals?: (c: Conn, ctx: Ctx) => Proposal[];
  widget?: (c: Conn, lang: Lang) => Widget | null;
  calendar?: (c: Conn, from: string, to: string) => CalItem[];
  links?: (c: Conn, context: { kind: "list" | "meal" | "event" | "store"; q?: string; address?: string; title?: string }) => Link[];
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
const enc = encodeURIComponent;
const ago = (iso: string | undefined) => (iso ? Date.now() - Date.parse(iso) : Number.POSITIVE_INFINITY);

async function fetchText(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT, ...headers }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Foutcode ${res.status} van ${new URL(url).hostname}`);
  return res.text();
}
/** Minimale RSS/Atom-lezer: titel, link, samenvatting, datum. */
export function parseFeed(xml: string): { title: string; link: string; summary: string; date: string | null }[] {
  const items: { title: string; link: string; summary: string; date: string | null }[] = [];
  const clean = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();
  const tag = (block: string, name: string) => { const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i")); return m ? clean(m[1]) : ""; };
  for (const m of xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const b = m[2];
    const linkAttr = b.match(/<link[^>]*href="([^"]+)"/i)?.[1];
    const dateRaw = tag(b, "pubDate") || tag(b, "updated") || tag(b, "published") || tag(b, "dc:date");
    const d = dateRaw ? new Date(dateRaw) : null;
    items.push({ title: tag(b, "title"), link: linkAttr ?? tag(b, "link"), summary: (tag(b, "description") || tag(b, "summary") || tag(b, "content")).slice(0, 400), date: d && !isNaN(d.getTime()) ? d.toISOString() : null });
  }
  return items;
}

// ---------- de koppelingen ----------
const STORES: Record<string, { name: string; search: string; folder: string; home: string }> = {
  collectgo: { name: "Collect&Go (Colruyt)", search: "https://www.collectandgo.be/colruyt/nl/zoeken?searchTerm=%s", folder: "https://www.colruyt.be/nl/folder", home: "https://www.collectandgo.be" },
  delhaize: { name: "Delhaize", search: "https://www.delhaize.be/nl/shop/search?q=%s", folder: "https://www.delhaize.be/nl/folders", home: "https://www.delhaize.be" },
  carrefour: { name: "Carrefour Drive", search: "https://drive.carrefour.be/nl/search?q=%s", folder: "https://www.carrefour.be/nl/folders", home: "https://drive.carrefour.be" },
  ah: { name: "Albert Heijn", search: "https://www.ah.be/zoeken?query=%s", folder: "https://www.ah.be/bonus", home: "https://www.ah.be" },
  lidl: { name: "Lidl", search: "https://www.lidl.be/nl/q/search?q=%s", folder: "https://www.lidl.be/nl/folder", home: "https://www.lidl.be" },
  aldi: { name: "Aldi", search: "https://www.aldi.be/nl/zoeken.html?q=%s", folder: "https://www.aldi.be/nl/folder.html", home: "https://www.aldi.be" },
  jumbo: { name: "Jumbo", search: "https://www.jumbo.com/zoeken?searchType=keyword&searchTerms=%s", folder: "https://www.jumbo.com/aanbiedingen", home: "https://www.jumbo.com" },
  kruidvat: { name: "Kruidvat", search: "https://www.kruidvat.be/nl/search?text=%s", folder: "https://www.kruidvat.be/nl/folder", home: "https://www.kruidvat.be" },
};
const DELIVERY: Record<string, { name: string; search: string }> = {
  takeaway: { name: "Takeaway.com", search: "https://www.takeaway.com/be/zoeken?q=%s" },
  ubereats: { name: "Uber Eats", search: "https://www.ubereats.com/be-nl/search?q=%s" },
  deliveroo: { name: "Deliveroo", search: "https://deliveroo.be/nl/search?q=%s" },
};
const uberLink = (address: string) => `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[formatted_address]=${enc(address)}`;
const mapsLink = (address: string) => `https://www.google.com/maps/dir/?api=1&destination=${enc(address)}`;

export const CONNECTORS: ConnectorDef[] = [
  {
    id: "waste_ical", name: "Afvalkalender (iCal)", description: "Het iCal- of webcal-adres van je intercommunale; Gezinsbord leest een jaar vooruit en zegt 's avonds wat buiten moet.", category: "huis", icon: "♻️",
    scope: "household", plan: "gezin", country: ["BE", "NL"], status: "ready", refreshMinutes: 24 * 60, provides: ["briefing"],
    fields: [{ key: "url", label: "iCal-adres", type: "url", required: true, placeholder: "https://… .ics", hint: "Limburg.net, Ilva, IVAREM, IOK, Interza en andere geven dit per adres." }],
    sync: async (c) => { const n = await H.syncWasteIcal(c.householdId, str(c.config.url)); return { count: n }; },
  },
  {
    id: "nmbs", name: "Trein (NMBS)", description: "Je vaste traject: vertragingen en de volgende treinen in je ochtendbriefing en op je telefoon.", category: "mobiliteit", icon: "🚆",
    scope: "member", plan: "gezin", country: ["BE"], status: "ready", refreshMinutes: 10, provides: ["briefing", "widget"],
    fields: [{ key: "from", label: "Vertrekstation", type: "text", required: true, placeholder: "Hasselt" }, { key: "to", label: "Aankomststation", type: "text", required: true, placeholder: "Brussel-Centraal" }, { key: "time", label: "Gewoonlijk vertrek rond", type: "time", placeholder: "07:30" }],
    sync: async (c) => {
      const t = str(c.config.time) || "07:30";
      const url = `https://api.irail.be/connections/?from=${enc(str(c.config.from))}&to=${enc(str(c.config.to))}&time=${t.replace(":", "")}&timesel=departure&format=json&lang=nl`;
      const data = JSON.parse(await fetchText(url)) as { connection?: { departure: { time: string; delay: string; station: string; platform: string; canceled: string }; arrival: { time: string; station: string }; duration: string }[] };
      const list = (data.connection ?? []).slice(0, 4).map((x) => ({ dep: new Date(Number(x.departure.time) * 1000).toISOString(), delay: Math.round(Number(x.departure.delay) / 60), platform: x.departure.platform, canceled: x.departure.canceled === "1", arr: new Date(Number(x.arrival.time) * 1000).toISOString(), to: x.arrival.station }));
      return { list, at: new Date().toISOString() };
    },
    briefing: (c, ctx) => {
      if (ctx.kind !== "morning") return [];
      const list = (c.state.list as { dep: string; delay: number; canceled: boolean; platform: string }[] | undefined) ?? [];
      const first = list[0]; if (!first) return [];
      const hm = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
      if (first.canceled) return [{ kind: "note", icon: "🚆", text: L(ctx.lang, { nl: `Trein van ${hm(first.dep)} naar ${str(c.config.to)} is afgeschaft; volgende om ${list[1] ? hm(list[1].dep) : "?"}.`, tr: `${hm(first.dep)} treni ${str(c.config.to)} yönüne iptal; sonraki ${list[1] ? hm(list[1].dep) : "?"}.`, en: `The ${hm(first.dep)} train to ${str(c.config.to)} is cancelled; next one at ${list[1] ? hm(list[1].dep) : "?"}.` }) }];
      if (first.delay > 0) return [{ kind: "note", icon: "🚆", text: L(ctx.lang, { nl: `Trein van ${hm(first.dep)} naar ${str(c.config.to)}: ${first.delay} min vertraging, spoor ${first.platform}.`, tr: `${hm(first.dep)} treni ${str(c.config.to)}: +${first.delay} dk gecikme, peron ${first.platform}.`, en: `The ${hm(first.dep)} train to ${str(c.config.to)}: ${first.delay} min delay, platform ${first.platform}.` }) }];
      return [{ kind: "note", icon: "🚆", text: L(ctx.lang, { nl: `Trein van ${hm(first.dep)} naar ${str(c.config.to)} rijdt op tijd, spoor ${first.platform}.`, tr: `${hm(first.dep)} treni ${str(c.config.to)} zamanında, peron ${first.platform}.`, en: `The ${hm(first.dep)} train to ${str(c.config.to)} is on time, platform ${first.platform}.` }) }];
    },
    widget: (c, lang) => {
      const list = (c.state.list as { dep: string; delay: number; canceled: boolean; platform: string; arr: string }[] | undefined) ?? [];
      if (!list.length) return null;
      const hm = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
      return { title: `${str(c.config.from)} → ${str(c.config.to)}`, icon: "🚆", lines: list.slice(0, 3).map((x) => ({ icon: x.canceled ? "❌" : x.delay > 0 ? "⚠️" : "✅", text: `${hm(x.dep)} → ${hm(x.arr)}`, sub: x.canceled ? L(lang, { nl: "afgeschaft", tr: "iptal", en: "cancelled" }) : x.delay > 0 ? `+${x.delay} min · ${L(lang, { nl: "spoor", tr: "peron", en: "platform" })} ${x.platform}` : `${L(lang, { nl: "op tijd · spoor", tr: "zamanında · peron", en: "on time · platform" })} ${x.platform}` })) };
    },
  },
  {
    id: "kmi", name: "KMI-waarschuwingen", description: "Code geel, oranje of rood voor storm, hitte, gladheid of onweer: op het bord en in de briefing zodra het KMI waarschuwt.", category: "nieuws", icon: "⛈️",
    scope: "household", plan: "gezin", country: ["BE"], status: "ready", refreshMinutes: 30, provides: ["briefing", "widget"],
    fields: [{ key: "url", label: "RSS-adres (standaard volstaat)", type: "url", placeholder: "https://www.meteo.be/services/alarm/rss?lang=nl" }],
    sync: async (c) => { const items = parseFeed(await fetchText(str(c.config.url) || "https://www.meteo.be/services/alarm/rss?lang=nl")).slice(0, 6); return { items, at: new Date().toISOString() }; },
    briefing: (c, ctx) => {
      const items = (c.state.items as { title: string; date: string | null }[] | undefined) ?? [];
      const fresh = items.filter((i) => !i.date || ago(i.date) < 36 * 3600_000).filter((i) => /geel|oranje|rood|waarschuwing|sarı|turuncu|kırmızı|uyarı/i.test(i.title));
      return fresh.slice(0, 1).map((i) => ({ kind: "weather" as const, icon: "⛈️", text: `${L(ctx.lang, { nl: "KMI waarschuwt", tr: "KMI uyarısı", en: "KMI warning" })}: ${i.title}` }));
    },
    widget: (c, lang) => { const items = (c.state.items as { title: string; link: string; date: string | null }[] | undefined) ?? []; const fresh = items.filter((i) => !i.date || ago(i.date) < 36 * 3600_000); return fresh.length ? { title: L(lang, { nl: "KMI-waarschuwingen", tr: "KMI uyarıları", en: "KMI warnings" }), icon: "⛈️", lines: fresh.slice(0, 3).map((i) => ({ text: i.title, url: i.link })) } : null; },
  },
  {
    id: "rss", name: "Nieuws (RSS)", description: "Koppen van VRT NWS, HLN, De Standaard of een andere bron naar keuze; op het bord of alleen op jouw telefoon.", category: "nieuws", icon: "📰",
    scope: "member", plan: "gezin", country: [], status: "ready", refreshMinutes: 30, provides: ["widget"],
    fields: [{ key: "name", label: "Naam", type: "text", placeholder: "VRT NWS" }, { key: "url", label: "RSS-adres", type: "url", required: true, placeholder: "https://www.vrt.be/vrtnws/nl.rss.articles.xml" }],
    sync: async (c) => ({ items: parseFeed(await fetchText(str(c.config.url))).slice(0, 8), at: new Date().toISOString() }),
    widget: (c) => { const items = (c.state.items as { title: string; link: string }[] | undefined) ?? []; return items.length ? { title: str(c.config.name) || "Nieuws", icon: "📰", lines: items.slice(0, 5).map((i) => ({ text: i.title, url: i.link })) } : null; },
  },
  {
    id: "stores", name: "Jouw winkels", description: "Kies je supermarkten: zet de lijst met één tik in hun zoekvak, bekijk hun folder van de week. Bestellen met één tik volgt zodra de ketens meedoen.", category: "winkelen", icon: "🛒",
    scope: "household", plan: "gezin", country: ["BE", "NL"], status: "ready", refreshMinutes: 0, provides: ["links", "widget"],
    fields: [{ key: "stores", label: "Winkels", type: "multiselect", required: true, options: Object.entries(STORES).map(([value, s]) => ({ value, label: s.name })) }],
    links: (c, context) => {
      const chosen = arr(c.config.stores).filter((s) => STORES[s]);
      if (context.kind === "store") return chosen.map((s) => ({ label: `${STORES[s].name}: folder`, url: STORES[s].folder, icon: "📰" }));
      if (context.kind === "list") return chosen.map((s) => ({ label: STORES[s].name, url: STORES[s].search.replace("%s", enc(context.q ?? "")), icon: "🛒" }));
      return [];
    },
    widget: (c, lang) => { const chosen = arr(c.config.stores).filter((s) => STORES[s]); return chosen.length ? { title: L(lang, { nl: "Folders van de week", tr: "Haftanın broşürleri", en: "This week's flyers" }), icon: "📰", lines: chosen.map((s) => ({ icon: "🛒", text: STORES[s].name, url: STORES[s].folder })) } : null; },
  },
  {
    id: "food_delivery", name: "Eten bestellen", description: "Takeaway, Uber Eats of Deliveroo als uitweg wanneer het avondeten niet gepland is: één tik naar je favoriete restaurant.", category: "eten", icon: "🍕",
    scope: "household", plan: "gezin", country: ["BE", "NL"], status: "ready", refreshMinutes: 0, provides: ["links", "proposal"],
    fields: [{ key: "services", label: "Diensten", type: "multiselect", required: true, options: Object.entries(DELIVERY).map(([value, s]) => ({ value, label: s.name })) }, { key: "favorites", label: "Favoriete restaurants of gerechten (komma's)", type: "text", placeholder: "Da Mario, pizza, kebab" }],
    links: (c, context) => { const q = context.q ?? arr(c.config.favorites)[0] ?? ""; return arr(c.config.services).filter((s) => DELIVERY[s]).map((s) => ({ label: DELIVERY[s].name, url: DELIVERY[s].search.replace("%s", enc(q)), icon: "🍕" })); },
    proposals: (c, ctx) => {
      if (ctx.kind !== "evening") return [];
      const h = new Date().getHours(); if (h < 16) return [];
      const dinner = H.listUpkeep; void dinner; // (geen onderhoud nodig hier)
      const planned = all<{ title: string }>("SELECT title FROM meals WHERE household_id=? AND date=? AND slot='diner' AND title<>''", c.householdId, ctx.date).length > 0;
      if (planned) return [];
      const fav = arr(c.config.favorites)[0] ?? ""; const svc = arr(c.config.services).filter((s) => DELIVERY[s])[0]; if (!svc) return [];
      return [{ id: `food:${ctx.date}`, kind: "link", title: L(ctx.lang, { nl: `Bestellen bij ${DELIVERY[svc].name}${fav ? ` (${fav})` : ""}`, tr: `${DELIVERY[svc].name}'ten sipariş ver${fav ? ` (${fav})` : ""}`, en: `Order from ${DELIVERY[svc].name}${fav ? ` (${fav})` : ""}` }), why: L(ctx.lang, { nl: "Er is vanavond niets gepland.", tr: "Bu akşam için yemek planlanmadı.", en: "Nothing is planned for tonight." }), url: DELIVERY[svc].search.replace("%s", enc(fav)) }];
    },
  },
  {
    id: "rides", name: "Rit bestellen", description: "Bij een afspraak met een adres: één tik opent Uber of de route in Maps met de bestemming al ingevuld.", category: "mobiliteit", icon: "🚕",
    scope: "member", plan: "gezin", country: [], status: "ready", refreshMinutes: 0, provides: ["links"],
    fields: [{ key: "services", label: "Diensten", type: "multiselect", required: true, options: [{ value: "uber", label: "Uber" }, { value: "maps", label: "Route (Google Maps)" }] }],
    links: (c, context) => { if (context.kind !== "event" || !context.address) return []; const out: Link[] = []; const s = arr(c.config.services); if (s.includes("uber")) out.push({ label: "Uber", url: uberLink(context.address), icon: "🚕" }); if (s.includes("maps")) out.push({ label: "Route", url: mapsLink(context.address), icon: "🗺️" }); return out; },
  },
  {
    id: "uit", name: "UiTinVlaanderen", description: "Gezinsactiviteiten in jouw buurt dit weekend, uit de open databank van publiq; de manager stelt ze vrijdag voor.", category: "uit", icon: "🎪",
    scope: "household", plan: "gezin", country: ["BE"], status: "ready", refreshMinutes: 6 * 60, provides: ["widget", "briefing"],
    fields: [{ key: "postal", label: "Postcode", type: "text", required: true, placeholder: "3500" }, { key: "apiKey", label: "API-sleutel van publiq (leeg = die van de server)", type: "secret", placeholder: "…", hint: "Gratis aan te vragen op publiq.be/projectaanvraag." }],
    sync: async (c) => {
      const key = str(c.config.apiKey) || process.env.UIT_API_KEY || ""; if (!key) throw new Error("Geen API-sleutel voor UiTdatabank.");
      const from = today(); const to = addDays(from, 9);
      const url = `https://search.uitdatabank.be/events/?q=${enc(`address.\\*.postalCode:${str(c.config.postal)}`)}&dateFrom=${from}T00:00:00%2B02:00&dateTo=${to}T23:59:59%2B02:00&audienceType=everyone&limit=12&sort[availableTo]=asc&embed=true`;
      const data = JSON.parse(await fetchText(url, { "X-Api-Key": key })) as { member?: { name?: Record<string, string>; startDate?: string; location?: { name?: Record<string, string>; address?: Record<string, { addressLocality?: string }> }; sameAs?: string[]; "@id"?: string }[] };
      const items = (data.member ?? []).map((e) => ({ title: e.name?.nl ?? Object.values(e.name ?? {})[0] ?? "Activiteit", date: e.startDate ? e.startDate.slice(0, 10) : null, place: e.location?.name?.nl ?? "", city: Object.values(e.location?.address ?? {})[0]?.addressLocality ?? "", url: e.sameAs?.[0] ?? `https://www.uitinvlaanderen.be/agenda/e/-/${(e["@id"] ?? "").split("/").pop()}` }));
      return { items, at: new Date().toISOString() };
    },
    widget: (c, lang) => { const items = (c.state.items as { title: string; date: string | null; place: string; url: string }[] | undefined) ?? []; return items.length ? { title: L(lang, { nl: "Uit in de buurt", tr: "Yakınında etkinlikler", en: "Things to do nearby" }), icon: "🎪", lines: items.slice(0, 4).map((i) => ({ icon: "🎪", text: i.title, sub: [i.date, i.place].filter(Boolean).join(" · "), url: i.url })) } : null; },
    briefing: (c, ctx) => { const wd = new Date(ctx.date + "T12:00:00").getDay(); if (wd !== 5 || ctx.kind !== "evening") return []; const items = (c.state.items as { title: string }[] | undefined) ?? []; return items.length ? [{ kind: "note", icon: "🎪", text: `${L(ctx.lang, { nl: "Dit weekend in de buurt", tr: "Bu hafta sonu yakınında", en: "This weekend nearby" })}: ${items.slice(0, 2).map((i) => i.title).join(", ")}.` }] : []; },
  },
  {
    id: "delijn", name: "De Lijn", description: "De volgende bussen en trams aan je halte, realtime, in de ochtendbriefing en op het bord. Vraagt een gratis sleutel bij De Lijn Open Data (data.delijn.be), of de beheerder zet er één voor iedereen.", category: "mobiliteit", icon: "🚌",
    scope: "member", plan: "gezin", country: ["BE"], status: "ready", refreshMinutes: 2, provides: ["briefing", "widget"],
    fields: [
      { key: "stop", label: "Halte", type: "text", required: true, placeholder: "Hasselt Station perron 1", hint: "Naam van de halte zoals op het haltebord; het eerste zoekresultaat wordt gebruikt. Of het haltenummer (bv. 403219)." },
      { key: "line", label: "Alleen lijn (optioneel)", type: "text", placeholder: "45" },
      { key: "key", label: "API-sleutel (leeg = sleutel van de server)", type: "secret", hint: "Gratis via data.delijn.be → product 'Open Data Free Subscription'." },
    ],
    sync: async (c) => {
      const key = str(c.config.key) || process.env.DELIJN_API_KEY || ""; if (!key) throw new Error("Vul een API-sleutel van De Lijn in, of laat de beheerder DELIJN_API_KEY zetten.");
      const H = { "Ocp-Apim-Subscription-Key": key };
      const q = str(c.config.stop).trim(); if (!q) throw new Error("Vul een halte in.");
      let ent = str(c.state.ent), nr = str(c.state.nr), name = str(c.state.stopName);
      if (!ent || !nr || str(c.state.q) !== q) {
        if (/^\d{5,7}$/.test(q)) { const j = JSON.parse(await fetchText(`https://api.delijn.be/DLKernOpenData/api/v1/haltes/zoek/${enc(q)}`, H)) as { haltes?: { entiteitnummer: string; haltenummer: string; omschrijving: string }[] }; const h0 = (j.haltes ?? []).find((h) => h.haltenummer === q) ?? j.haltes?.[0]; if (!h0) throw new Error(`Halte ${q} niet gevonden.`); ent = h0.entiteitnummer; nr = h0.haltenummer; name = h0.omschrijving; }
        else { const j = JSON.parse(await fetchText(`https://api.delijn.be/DLKernOpenData/api/v1/haltes/zoek/${enc(q)}`, H)) as { haltes?: { entiteitnummer: string; haltenummer: string; omschrijving: string }[] }; const h0 = j.haltes?.[0]; if (!h0) throw new Error(`Geen halte gevonden voor "${q}".`); ent = h0.entiteitnummer; nr = h0.haltenummer; name = h0.omschrijving; }
      }
      const j = JSON.parse(await fetchText(`https://api.delijn.be/DLKernOpenData/api/v1/haltes/${ent}/${nr}/real-time?maxAantalDoorkomsten=8`, H)) as { halteDoorkomsten?: { doorkomsten?: { lijnnummer: number | string; bestemming: string; dienstregelingTijdstip: string; "real-timeTijdstip"?: string; predictionStatussen?: string[] }[] }[] };
      const line = str(c.config.line).trim();
      const list = (j.halteDoorkomsten?.[0]?.doorkomsten ?? []).filter((d) => !line || String(d.lijnnummer) === line).slice(0, 6).map((d) => ({ line: String(d.lijnnummer), to: d.bestemming, planned: d.dienstregelingTijdstip, rt: d["real-timeTijdstip"] ?? null, canceled: (d.predictionStatussen ?? []).includes("GESCHRAPT") }));
      return { q, ent, nr, stopName: name, list, at: new Date().toISOString() };
    },
    briefing: (c, ctx) => {
      if (ctx.kind !== "morning") return [];
      const list = (c.state.list as { line: string; to: string; planned: string; rt: string | null; canceled: boolean }[] | undefined) ?? []; const first = list.find((x) => !x.canceled); if (!first) return [];
      const d = first.rt ?? first.planned; const mins = Math.max(0, Math.round((Date.parse(d) - Date.now()) / 60_000));
      return [{ kind: "note", icon: "🚌", text: L(ctx.lang, { nl: `Lijn ${first.line} naar ${first.to} aan ${str(c.state.stopName)} over ${mins} min.`, tr: `${first.line} hattı ${first.to} yönüne, ${str(c.state.stopName)} durağından ${mins} dk sonra.`, en: `Line ${first.line} to ${first.to} at ${str(c.state.stopName)} in ${mins} min.` }) }];
    },
    widget: (c, lang) => {
      const list = (c.state.list as { line: string; to: string; planned: string; rt: string | null; canceled: boolean }[] | undefined) ?? []; if (!list.length) return null;
      const hm = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
      return { title: `🚌 ${str(c.state.stopName)}`, icon: "🚌", lines: list.slice(0, 4).map((x) => { const d = x.rt ?? x.planned; const mins = Math.round((Date.parse(d) - Date.now()) / 60_000); const late = x.rt ? Math.round((Date.parse(x.rt) - Date.parse(x.planned)) / 60_000) : 0; return { icon: x.canceled ? "❌" : late > 2 ? "⚠️" : "🚌", text: `${x.line} → ${x.to}`, sub: x.canceled ? L(lang, { nl: "geschrapt", tr: "iptal", en: "cancelled" }) : `${hm(d)} · ${mins <= 0 ? L(lang, { nl: "nu", tr: "şimdi", en: "now" }) : `${mins} min`}${late > 2 ? ` · +${late}` : ""}` }; }) };
    },
  },
  {
    id: "mivb", name: "MIVB/STIB", description: "Metro, tram en bus in Brussel: de volgende doorkomsten aan je halte, realtime. Vraagt een gratis sleutel bij MIVB Open Data (opendata.stib-mivb.be), of de beheerder zet er één voor iedereen.", category: "mobiliteit", icon: "🚇",
    scope: "member", plan: "gezin", country: ["BE"], status: "ready", refreshMinutes: 2, provides: ["briefing", "widget"],
    fields: [
      { key: "stop", label: "Haltenummer (pointid)", type: "text", required: true, placeholder: "8012", hint: "Het nummer van de halte staat op het haltebord en in de MIVB-app bij de halte-info." },
      { key: "name", label: "Naam van de halte (voor op het bord)", type: "text", placeholder: "Schuman" },
      { key: "key", label: "API-sleutel (leeg = sleutel van de server)", type: "secret", hint: "Gratis via opendata.stib-mivb.be → 'Access the API'." },
    ],
    sync: async (c) => {
      const key = str(c.config.key) || process.env.MIVB_API_KEY || ""; if (!key) throw new Error("Vul een API-sleutel van de MIVB in, of laat de beheerder MIVB_API_KEY zetten.");
      const stop = str(c.config.stop).replace(/\D/g, ""); if (!stop) throw new Error("Vul het haltenummer in.");
      const url = `https://data.stib-mivb.be/api/explore/v2.1/catalog/datasets/waiting-time-rt-production/records?where=${enc(`pointid="${stop}"`)}&limit=20&apikey=${enc(key)}`;
      const j = JSON.parse(await fetchText(url)) as { results?: { lineid: string; passingtimes: string }[] };
      const lang = asLang(getSettings(c.householdId).language);
      const list: { line: string; to: string; at: string }[] = [];
      for (const r of j.results ?? []) { try { for (const p of JSON.parse(r.passingtimes) as { destination?: { fr?: string; nl?: string }; expectedArrivalTime?: string; lineId?: string }[]) if (p.expectedArrivalTime) list.push({ line: p.lineId ?? r.lineid, to: (lang === "en" ? p.destination?.fr : p.destination?.nl) || p.destination?.fr || p.destination?.nl || "", at: p.expectedArrivalTime }); } catch { /* */ } }
      list.sort((a, b) => a.at.localeCompare(b.at));
      return { list: list.slice(0, 8), at: new Date().toISOString() };
    },
    briefing: (c, ctx) => {
      if (ctx.kind !== "morning") return [];
      const list = (c.state.list as { line: string; to: string; at: string }[] | undefined) ?? []; const first = list[0]; if (!first) return [];
      const mins = Math.max(0, Math.round((Date.parse(first.at) - Date.now()) / 60_000)); const stop = str(c.config.name) || str(c.config.stop);
      return [{ kind: "note", icon: "🚇", text: L(ctx.lang, { nl: `MIVB lijn ${first.line} naar ${first.to} aan ${stop} over ${mins} min.`, tr: `MIVB ${first.line} hattı ${first.to} yönüne, ${stop} durağından ${mins} dk sonra.`, en: `STIB line ${first.line} to ${first.to} at ${stop} in ${mins} min.` }) }];
    },
    widget: (c, lang) => {
      const list = (c.state.list as { line: string; to: string; at: string }[] | undefined) ?? []; if (!list.length) return null;
      const hm = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
      return { title: `🚇 ${str(c.config.name) || str(c.config.stop)}`, icon: "🚇", lines: list.slice(0, 4).map((x) => { const mins = Math.round((Date.parse(x.at) - Date.now()) / 60_000); return { icon: "🚇", text: `${x.line} → ${x.to}`, sub: `${hm(x.at)} · ${mins <= 0 ? L(lang, { nl: "nu", tr: "şimdi", en: "now" }) : `${mins} min`}` }; }) };
    },
  },

  {
    id: "inbox", name: "Gezinsinbox", description: "Een e-mailadres voor je gezin: stuur de schoolbrief, Smartschool of Gimme, de dokter, de keuringsbrief of een kassaticket door en {brand} maakt er afspraken, boodschappen en prijzen van. Jij kijkt na, één tik en het staat erin.", category: "school", icon: "📬",
    scope: "household", plan: "gezin", country: [], status: "ready", refreshMinutes: 5, provides: ["briefing", "widget"],
    fields: [
      { key: "host", label: "IMAP-server (leeg = de gedeelde inbox van de server)", type: "text", placeholder: "imap.gmail.com", hint: "Alleen nodig met een eigen mailbox. Gmail: app-wachtwoord; Outlook: imap-mail.outlook.com." },
      { key: "port", label: "Poort", type: "number", placeholder: "993" },
      { key: "user", label: "Gebruikersnaam (e-mailadres)", type: "text", placeholder: "gezin@gmail.com" },
      { key: "pass", label: "Wachtwoord", type: "secret" },
      { key: "folder", label: "Map", type: "text", placeholder: "INBOX" },
    ],
    sync: async (c) => {
      const own = str(c.config.host) && str(c.config.user) && str(c.config.pass);
      const sh = Inbox.shared();
      if (!own && !sh) throw new Error("Vul de IMAP-gegevens in, of laat de beheerder een gedeelde inbox instellen (INBOX_IMAP_*).");
      const cfg = own ? { host: str(c.config.host), port: Number(c.config.port) || 993, user: str(c.config.user), pass: str(c.config.pass), folder: str(c.config.folder) || "INBOX" } : { host: sh!.host, port: sh!.port, user: sh!.user, pass: sh!.pass, folder: "INBOX", tag: Inbox.plusAddress(c.householdId) ?? undefined };
      const r = await Inbox.fetchNew(cfg, c.householdId);
      return { ...c.state, address: own ? str(c.config.user) : Inbox.plusAddress(c.householdId), fetched: Number(c.state.fetched ?? 0) + r.fetched, items: Number(c.state.items ?? 0) + r.items, at: new Date().toISOString() };
    },
    briefing: (c, ctx) => { const n = Inbox.newCount(c.householdId); return n ? [{ kind: "note", icon: "📬", text: L(ctx.lang, { nl: `${n} ${n === 1 ? "nieuw bericht" : "nieuwe berichten"} in de gezinsinbox om na te kijken.`, tr: `Aile gelen kutusunda incelenecek ${n} yeni mesaj.`, en: `${n} new ${n === 1 ? "message" : "messages"} in the family inbox to review.` }) }] : []; },
    widget: (c, lang) => { const n = Inbox.newCount(c.householdId); const addr = str(c.state.address); return n || addr ? { title: L(lang, { nl: "Gezinsinbox", tr: "Aile gelen kutusu", en: "Family inbox" }), icon: "📬", lines: [{ icon: n ? "🔔" : "📭", text: n ? L(lang, { nl: `${n} na te kijken`, tr: `${n} incelenecek`, en: `${n} to review` }) : L(lang, { nl: "Niets nieuws", tr: "Yeni bir şey yok", en: "Nothing new" }), sub: addr }] } : null; },
  },
  {
    id: "tuya", name: "Tuya / Smart Life", description: "De lampen, stekkers, thermostaten en sensoren van Action (LSC), Lidl (Silvercrest), Nedis, Calex en veel andere merken die met de Smart Life-app werken. Ze verschijnen bij Het huis → Slim huis, naast Home Assistant, en doen mee met de scènes en voorstellen van de manager.", category: "huis", icon: "💡",
    scope: "household", plan: "plus", country: [], status: "ready", refreshMinutes: 10, provides: ["widget"],
    fields: [
      { key: "accessId", label: "Access ID (Client ID)", type: "text", required: true, placeholder: "a1b2c3…", hint: "Maak gratis een account op iot.tuya.com → Cloud → Create Cloud Project (regio Central Europe, Smart Home). Koppel je Smart Life-account onder Devices → Link App Account door de QR-code met Smart Life te scannen. Voeg bij Service API 'IoT Core' en 'Authorization' toe." },
      { key: "accessSecret", label: "Access Secret", type: "secret", required: true },
      { key: "region", label: "Regio van het project", type: "select", options: [{ value: "eu", label: "Central Europe" }, { value: "eu-w", label: "Western Europe" }, { value: "us", label: "Western America" }, { value: "us-e", label: "Eastern America" }, { value: "in", label: "India" }, { value: "cn", label: "China" }] },
    ],
    sync: async (c) => {
      const client = Tuya.clientFor(c); const devices = await client.devices(); Tuya.invalidate(c.householdId);
      const states = Tuya.toStates(devices);
      return { ...c.state, devices: devices.length, online: devices.filter((d) => d.online).length, lightsOn: states.filter((s) => s.entity_id.startsWith("light.") && s.state === "on").length, at: new Date().toISOString() };
    },
    widget: (c, lang) => { const n = Number(c.state.devices ?? 0); if (!n) return null; const on = Number(c.state.lightsOn ?? 0); return { title: L(lang, { nl: "Smart Life", tr: "Smart Life", en: "Smart Life" }), icon: "💡", lines: [{ icon: on ? "💡" : "🌑", text: on ? L(lang, { nl: `${on} ${on === 1 ? "lamp" : "lampen"} aan`, tr: `${on} lamba açık`, en: `${on} ${on === 1 ? "light" : "lights"} on` }) : L(lang, { nl: "Alle lampen uit", tr: "Tüm lambalar kapalı", en: "All lights off" }), sub: L(lang, { nl: `${Number(c.state.online ?? 0)} van ${n} apparaten online`, tr: `${n} cihazdan ${Number(c.state.online ?? 0)} çevrimiçi`, en: `${Number(c.state.online ?? 0)} of ${n} devices online` }) }] }; },
  },
  { id: "recycle", name: "Recycle! (afvalapp)", description: "Rechtstreeks uit de Recycle!-app. Onofficiële koppeling die kan breken; gebruik liever het iCal-adres van je intercommunale.", category: "huis", icon: "♻️", scope: "household", plan: "gezin", country: ["BE"], status: "soon", refreshMinutes: 0, provides: [], fields: [] },
  {
    id: "school_holidays", name: "Schoolvakanties", description: "Vlaamse, Franstalige of Nederlandse schoolvakanties als laag in de agenda, met een seintje de dag voor ze beginnen en eindigen.", category: "school", icon: "🏫",
    scope: "household", plan: "gezin", country: ["BE", "NL"], status: "ready", refreshMinutes: 0, provides: ["calendar", "briefing"],
    fields: [{ key: "region", label: "Regio", type: "select", required: true, options: REGIONS.map((r) => ({ value: r.id, label: r.nl })) }],
    calendar: (c, from, to) => breaksBetween(str(c.config.region) as Region, from, to, asLang(getSettings(c.householdId).language)).map((b) => ({ id: `school:${c.id}:${b.from}`, title: `${b.icon} ${b.title}`, date: b.from, endDate: b.to, allDay: true })),
    briefing: (c, ctx) => {
      const tomorrow = addDays(ctx.date, 1); const focus = ctx.kind === "evening" ? tomorrow : ctx.date;
      const out: Item[] = [];
      for (const b of breaksBetween(str(c.config.region) as Region, focus, focus, ctx.lang)) {
        if (b.from === focus) out.push({ kind: "note", icon: b.icon, text: L(ctx.lang, { nl: `${ctx.kind === "evening" ? "Morgen" : "Vandaag"} begint de ${b.title.toLowerCase()} (tot ${b.to}).`, tr: `${b.title} ${ctx.kind === "evening" ? "yarın" : "bugün"} başlıyor (${b.to} kadar).`, en: `${b.title} starts ${ctx.kind === "evening" ? "tomorrow" : "today"} (until ${b.to}).` }) });
        if (b.to === focus) out.push({ kind: "note", icon: "🎒", text: L(ctx.lang, { nl: `Laatste dag van de ${b.title.toLowerCase()}; de school herbegint.`, tr: `${b.title} son gün; okul yeniden başlıyor.`, en: `Last day of the ${b.title.toLowerCase()}; school starts again.` }) });
      }
      return out;
    },
  },
  { id: "teams_status", name: "Teams-status", description: "“Papa zit in vergadering tot 15u” op het bord. Komt in een volgende ronde.", category: "werk", icon: "💼", scope: "member", plan: "plus", country: [], status: "soon", refreshMinutes: 0, provides: [], fields: [] },
  { id: "withings", name: "Withings", description: "Weegschaal en bloeddrukmeter in het dieet- en gezondheidsdeel. Komt in een volgende ronde.", category: "gezondheid", icon: "⚖️", scope: "member", plan: "plus", country: [], status: "soon", refreshMinutes: 0, provides: [], fields: [] },
  {
    id: "telegram", name: "Telegram-bot", description: "Een eigen bot voor je gezin: stuur een foto van de schoolbrief of het kassaticket, of typ \"melk, brood, luiers\". Alles komt in de gezinsinbox en de bot bevestigt.", category: "automatisering", icon: "✈️",
    scope: "household", plan: "gezin", country: [], status: "ready", refreshMinutes: 1, provides: ["briefing", "widget"],
    fields: [{ key: "token", label: "Bot-token", type: "secret", required: true, placeholder: "123456:ABC-…", hint: "Open @BotFather in Telegram, stuur /newbot, kies een naam, en plak de token hier. Stuur daarna /start naar je bot." }],
    sync: async (c) => {
      const token = str(c.config.token); if (!token) throw new Error("Vul de bot-token in.");
      const lang = asLang(getSettings(c.householdId).language);
      const info = c.state.username ? { username: str(c.state.username), name: str(c.state.botName) } : await TG.botInfo(token);
      const r = await TG.poll(token, Number(c.state.offset ?? 0), c.householdId, lang);
      const chats = new Set<number>([...arr(c.state.chats).map(Number), ...r.chats]);
      return { ...c.state, username: info.username, botName: info.name, offset: r.offset || Number(c.state.offset ?? 0), items: Number(c.state.items ?? 0) + r.items, chats: [...chats].filter(Boolean), at: new Date().toISOString() };
    },
    briefing: (c, ctx) => { const n = Inbox.newCount(c.householdId, "Telegram"); return n ? [{ kind: "note", icon: "✈️", text: L(ctx.lang, { nl: `${n} ${n === 1 ? "bericht" : "berichten"} via Telegram om na te kijken in de gezinsinbox.`, tr: `Aile gelen kutusunda incelenecek ${n} Telegram mesajı.`, en: `${n} Telegram ${n === 1 ? "message" : "messages"} to review in the family inbox.` }) }] : []; },
    widget: (c, lang) => { const u = str(c.state.username); if (!u) return null; const n = Inbox.newCount(c.householdId, "Telegram"); return { title: L(lang, { nl: "Telegram-bot", tr: "Telegram botu", en: "Telegram bot" }), icon: "✈️", lines: [{ icon: n ? "🔔" : "✈️", text: n ? L(lang, { nl: `${n} na te kijken`, tr: `${n} incelenecek`, en: `${n} to review` }) : `@${u}`, sub: n ? `@${u}` : L(lang, { nl: "stuur een foto of een boodschap", tr: "bir fotoğraf ya da mesaj gönder", en: "send a photo or a message" }), url: `https://t.me/${u}` }] }; },
  },
  {
    id: "webhooks", name: "Webhooks (Siri, IFTTT, n8n)", description: "Een geheim adres waarmee Siri-opdrachten, IFTTT, n8n of een slimme speaker iets op de boodschappenlijst, het prikbord of in de agenda zetten. Stuur een POST met JSON: {\"list\": \"melk\"}, {\"note\": \"…\"} of {\"event\": {\"title\", \"date\", \"startTime\"}}.", category: "automatisering", icon: "🔗",
    scope: "household", plan: "plus", country: [], status: "ready", refreshMinutes: 0, provides: ["widget"],
    fields: [{ key: "token", label: "Geheime sleutel (leeg = automatisch)", type: "text", placeholder: "wordt ingevuld bij het aanzetten", hint: "Het adres is /api/hooks/<sleutel>. Deel het alleen met je eigen automatiseringen." }],
    widget: (c, lang) => ({ title: L(lang, { nl: "Webhook", tr: "Webhook", en: "Webhook" }), icon: "🔗", lines: [{ icon: "📬", text: `/api/hooks/${str(c.config.token)}`, sub: L(lang, { nl: `${Number(c.state.count ?? 0)} ontvangen`, tr: `${Number(c.state.count ?? 0)} alındı`, en: `${Number(c.state.count ?? 0)} received` }) }] }),
  },
  {
    id: "deals_feed", name: "Folders en deals (partnerfeed)", description: "Een JSON-feed met promoties van een partner (Promojagers, Tiendeo/ShopFully, een keten). De deals komen in het prijsgeheugen en tellen mee in de boodschappenlijst en de Weekbox.", category: "winkelen", icon: "🏷️",
    scope: "household", plan: "gezin", country: [], status: "ready", refreshMinutes: 6 * 60, provides: [],
    fields: [{ key: "url", label: "Feed-adres (JSON)", type: "url", required: true, placeholder: "https://…/deals.json", hint: "Formaat: { store, validUntil, items: [{ label, price, qty, unit }] } of een lijst daarvan." }],
    sync: async (c) => {
      const raw = JSON.parse(await fetchText(str(c.config.url))) as unknown;
      const feeds = (Array.isArray(raw) ? raw : [raw]) as { store?: string; validUntil?: string; items?: { label?: string; price?: number; qty?: number; unit?: string }[] }[];
      const have = new Set(listPrices({ days: 60, limit: 5000 }, c.householdId).filter((p) => p.source === "deal").map((p) => `${p.store}|${p.product}|${p.validUntil}`));
      let n = 0;
      for (const f of feeds) for (const it of f.items ?? []) {
        if (!f.store || !it.label || typeof it.price !== "number") continue;
        const key = `${f.store}|${productKey(it.label)}|${f.validUntil ?? null}`; if (have.has(key)) continue; have.add(key);
        const unit = it.unit === "kg" || it.unit === "l" || it.unit === "st" ? it.unit : it.unit === "g" ? "kg" : it.unit === "ml" ? "l" : undefined;
        const qty = typeof it.qty === "number" ? (it.unit === "g" || it.unit === "ml" ? it.qty / 1000 : it.qty) : undefined;
        addPrice({ label: it.label, store: f.store, price: it.price, qty, unit, source: "deal", validUntil: f.validUntil && /^\d{4}-\d{2}-\d{2}$/.test(f.validUntil) ? f.validUntil : null }, null, c.householdId); n++;
      }
      return { added: n, at: new Date().toISOString() };
    },
  },
];
export const connectorById = (id: string) => CONNECTORS.find((c) => c.id === id);

// ---------- opslag ----------
export const ConnectionInput = z.object({ connector: z.string(), memberId: z.string().nullable().optional(), config: z.record(z.string(), z.unknown()).default({}), onBoard: z.boolean().default(false), enabled: z.boolean().default(true) });
type Row = { id: string; household_id: string; member_id: string | null; connector: string; config: string; state: string; enabled: number; on_board: number; last_sync: string | null; status: string; error: string };
function shape(r: Row): Conn {
  let config: Record<string, unknown> = {}; try { config = decrypt(r.config); } catch { /* sleutel gewijzigd */ }
  let state: Record<string, unknown> = {}; try { state = JSON.parse(r.state || "{}"); } catch { /* */ }
  return { id: r.id, householdId: r.household_id, memberId: r.member_id, connector: r.connector, config, state, enabled: !!r.enabled, onBoard: !!r.on_board, lastSync: r.last_sync, status: r.status, error: r.error };
}
export function listConnections(h = hid()): Conn[] { return all<Row>("SELECT * FROM connections WHERE household_id=? ORDER BY created_at", h).map(shape); }
export function getConnection(id: string, h = hid()): Conn | null { const r = get<Row>("SELECT * FROM connections WHERE id=? AND household_id=?", id, h); return r ? shape(r) : null; }
/** Zonder geheimen naar de browser. */
export function publicConn(c: Conn) {
  const def = connectorById(c.connector);
  const config: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c.config)) config[k] = def?.fields.find((f) => f.key === k)?.type === "secret" ? (v ? "••••••" : "") : v;
  return { id: c.id, memberId: c.memberId, connector: c.connector, config, enabled: c.enabled, onBoard: c.onBoard, lastSync: c.lastSync, status: c.status, error: c.error };
}
export function createConnection(i: z.infer<typeof ConnectionInput>, h = hid()) {
  const def = connectorById(i.connector); if (!def) throw new Error("Onbekende koppeling.");
  if (def.status === "soon") throw new Error("Deze koppeling komt in een volgende ronde.");
  for (const f of def.fields) if (f.required && !i.config[f.key]) throw new Error(`Vul "${f.label}" in.`);
  if (def.id === "webhooks" && !i.config.token) i.config = { ...i.config, token: crypto.randomBytes(18).toString("base64url") };
  const id = newId();
  run("INSERT INTO connections(id, household_id, member_id, connector, config, enabled, on_board) VALUES (?,?,?,?,?,?,?)", id, h, def.scope === "member" ? i.memberId ?? null : null, i.connector, encrypt(i.config), i.enabled ? 1 : 0, i.onBoard ? 1 : 0);
  return id;
}
export function updateConnection(id: string, patch: Partial<z.infer<typeof ConnectionInput>>, h = hid()) {
  const c = getConnection(id, h); if (!c) return false;
  const def = connectorById(c.connector);
  let config = c.config;
  if (patch.config) { config = { ...c.config }; for (const [k, v] of Object.entries(patch.config)) { if (def?.fields.find((f) => f.key === k)?.type === "secret" && v === "••••••") continue; config[k] = v; } }
  run("UPDATE connections SET config=?, enabled=?, on_board=?, member_id=? WHERE id=?", encrypt(config), (patch.enabled ?? c.enabled) ? 1 : 0, (patch.onBoard ?? c.onBoard) ? 1 : 0, patch.memberId === undefined ? c.memberId : patch.memberId, id);
  return true;
}
export const deleteConnection = (id: string, h = hid()) => run("DELETE FROM connections WHERE id=? AND household_id=?", id, h);
/** Webhook opzoeken op sleutel (over alle gezinnen; alleen voor de publieke route). */
export function findWebhook(token: string): Conn | null {
  if (!token || token.length < 12) return null;
  for (const r of all<Row>("SELECT * FROM connections WHERE connector='webhooks' AND enabled=1")) { const c = shape(r); if (c.config.token === token) return c; }
  return null;
}
export const bumpWebhook = (c: Conn) => run("UPDATE connections SET state=?, last_sync=datetime('now'), status='ok' WHERE id=?", JSON.stringify({ ...c.state, count: Number(c.state.count ?? 0) + 1, last: new Date().toISOString() }), c.id);

/** Eén koppeling verversen; fouten komen netjes in de status. */
export async function syncConnection(c: Conn): Promise<Conn> {
  const def = connectorById(c.connector);
  if (!def?.sync) return c;
  try {
    const state = await def.sync(c);
    run("UPDATE connections SET state=?, last_sync=datetime('now'), status='ok', error='' WHERE id=?", JSON.stringify(state), c.id);
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? ` (${e.cause.message})` : "";
    run("UPDATE connections SET last_sync=datetime('now'), status='error', error=? WHERE id=?", ((e instanceof Error ? e.message : String(e)) + cause).slice(0, 300), c.id);
  }
  return getConnection(c.id, c.householdId)!;
}
/** Alles wat aan verversen toe is, over alle gezinnen. */
export async function syncDue() {
  const rows = all<Row>("SELECT * FROM connections WHERE enabled=1").map(shape);
  for (const c of rows) {
    const def = connectorById(c.connector); if (!def?.sync || !def.refreshMinutes) continue;
    if (c.lastSync && Date.now() - Date.parse(c.lastSync + "Z") < def.refreshMinutes * 60_000 && c.status !== "new") continue;
    await syncConnection(c);
  }
}
export function startConnectorScheduler() { const tick = () => syncDue().catch((e) => console.warn("[koppelingen]", e)); setTimeout(tick, 20_000).unref(); setInterval(tick, 5 * 60_000).unref(); }

// ---------- wat de koppelingen leveren ----------
const forMember = (c: Conn, memberId: string | null) => c.enabled && (c.memberId === null || c.memberId === memberId);
export function connectorBriefing(ctx: Ctx, h = hid()): { items: Item[]; proposals: Proposal[] } {
  const items: Item[] = []; const proposals: Proposal[] = [];
  for (const c of listConnections(h).filter((c) => forMember(c, ctx.memberId))) {
    const def = connectorById(c.connector); if (!def) continue;
    try { if (def.briefing) items.push(...def.briefing(c, ctx).slice(0, 2)); if (def.proposals) proposals.push(...def.proposals(c, ctx).slice(0, 1)); } catch { /* */ }
  }
  return { items, proposals };
}
/** Widgets voor het bord (gezin + "ook op het bord") of voor één persoon. */
export function connectorWidgets(memberId: string | null, board: boolean, lang: Lang, h = hid()): { id: string; connector: string; memberId: string | null; widget: Widget }[] {
  const out: { id: string; connector: string; memberId: string | null; widget: Widget }[] = [];
  for (const c of listConnections(h).filter((c) => c.enabled)) {
    const def = connectorById(c.connector); if (!def?.widget) continue;
    const show = board ? (c.memberId === null || c.onBoard) : (c.memberId === null || c.memberId === memberId);
    if (!show) continue;
    try { const w = def.widget(c, lang); if (w) out.push({ id: c.id, connector: c.connector, memberId: c.memberId, widget: w }); } catch { /* */ }
  }
  return out;
}
export function connectorLinks(context: { kind: "list" | "meal" | "event" | "store"; q?: string; address?: string; title?: string }, memberId: string | null, h = hid()): (Link & { connector: string })[] {
  const out: (Link & { connector: string })[] = [];
  for (const c of listConnections(h).filter((c) => forMember(c, memberId))) {
    const def = connectorById(c.connector); if (!def?.links) continue;
    try { out.push(...def.links(c, context).map((l) => ({ ...l, connector: c.connector }))); } catch { /* */ }
  }
  return out;
}
export function connectorCalendar(from: string, to: string, h = hid()): CalItem[] {
  const out: CalItem[] = [];
  for (const c of listConnections(h).filter((c) => c.enabled)) { const def = connectorById(c.connector); if (def?.calendar) { try { out.push(...def.calendar(c, from, to)); } catch { /* */ } } }
  return out;
}
/** Catalogus: wat er bestaat, met aanbevelingen voor dit gezin. */
export function catalog(h = hid()) {
  const s = getSettings(h); const country = s.country || "BE"; const lang = asLang(s.language);
  const have = new Set(listConnections(h).map((c) => c.connector));
  const recommended = ["waste_ical", "nmbs", "kmi", "stores", "uit"];
  return CONNECTORS.filter((c) => !c.country.length || c.country.includes(country)).map(({ sync, briefing, proposals, widget, calendar, links, ...pub }) => { void sync; void briefing; void proposals; void widget; void calendar; void links; const en = EN_TEXT[pub.id]; const name = lang === "en" && en ? en.name : pub.name; const description = lang === "en" && en ? en.description : pub.description; return { ...pub, name, description, categoryLabel: (lang === "en" ? CATEGORY_LABEL_EN : lang === "tr" ? CATEGORY_LABEL_TR : CATEGORY_LABEL)[pub.category], recommended: recommended.includes(pub.id) && !have.has(pub.id), connected: have.has(pub.id) }; });
}
