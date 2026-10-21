// Koppelingen als één systeem: elke koppeling is een module met een vaste vorm (eigenaar, wat ze nodig heeft, wat ze levert).
// Alles staat standaard uit; een koppeling vult alleen bestaande plekken: agenda-laag, briefingregel, widget, lijst-links, voorstel.
import { z } from "zod";
import crypto from "node:crypto";
import { db, all, get, run, newId, hid, getSettings } from "./db.js";
import { today, addDays } from "./dates.js";
import * as H from "./home.js";
import type { Item, Proposal } from "./manager.js";

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
export interface Field { key: string; label: string; type: "text" | "url" | "secret" | "select" | "multiselect" | "number" | "time" | "textarea"; options?: { value: string; label: string }[]; placeholder?: string; required?: boolean; hint?: string }
export interface Link { label: string; url: string; icon: string }
export interface Widget { title: string; icon: string; lines: { icon?: string; text: string; sub?: string; url?: string }[] }
export interface CalItem { id: string; title: string; date: string; endDate?: string | null; startTime?: string | null; endTime?: string | null; allDay: boolean; location?: string; url?: string }
export interface Conn { id: string; householdId: string; memberId: string | null; connector: string; config: Record<string, unknown>; state: Record<string, unknown>; enabled: boolean; onBoard: boolean; lastSync: string | null; status: string; error: string }
export interface Ctx { kind: "morning" | "evening"; date: string; memberId: string | null; lang: "nl" | "tr" }
export interface ConnectorDef {
  id: string; name: string; description: string; category: Category; icon: string;
  scope: "household" | "member"; plan: "gezin" | "plus"; country: string[]; status: "ready" | "unofficial" | "soon";
  fields: Field[]; provides: ("calendar" | "briefing" | "widget" | "links" | "proposal")[]; refreshMinutes: number;
  sync?: (c: Conn) => Promise<Record<string, unknown>>;
  briefing?: (c: Conn, ctx: Ctx) => Item[];
  proposals?: (c: Conn, ctx: Ctx) => Proposal[];
  widget?: (c: Conn, lang: "nl" | "tr") => Widget | null;
  calendar?: (c: Conn, from: string, to: string) => CalItem[];
  links?: (c: Conn, context: { kind: "list" | "meal" | "event" | "store"; q?: string; address?: string; title?: string }) => Link[];
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
const enc = encodeURIComponent;
const ago = (iso: string | undefined) => (iso ? Date.now() - Date.parse(iso) : Number.POSITIVE_INFINITY);

async function fetchText(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers: { "user-agent": "Gezinsbord/2.0 (+https://gezinsbord.be)", ...headers }, signal: AbortSignal.timeout(15_000) });
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
      if (first.canceled) return [{ kind: "note", icon: "🚆", text: ctx.lang === "tr" ? `${hm(first.dep)} treni ${str(c.config.to)} yönüne iptal; sonraki ${list[1] ? hm(list[1].dep) : "?"}.` : `Trein van ${hm(first.dep)} naar ${str(c.config.to)} is afgeschaft; volgende om ${list[1] ? hm(list[1].dep) : "?"}.` }];
      if (first.delay > 0) return [{ kind: "note", icon: "🚆", text: ctx.lang === "tr" ? `${hm(first.dep)} treni ${str(c.config.to)}: +${first.delay} dk gecikme, peron ${first.platform}.` : `Trein van ${hm(first.dep)} naar ${str(c.config.to)}: ${first.delay} min vertraging, spoor ${first.platform}.` }];
      return [{ kind: "note", icon: "🚆", text: ctx.lang === "tr" ? `${hm(first.dep)} treni ${str(c.config.to)} zamanında, peron ${first.platform}.` : `Trein van ${hm(first.dep)} naar ${str(c.config.to)} rijdt op tijd, spoor ${first.platform}.` }];
    },
    widget: (c, lang) => {
      const list = (c.state.list as { dep: string; delay: number; canceled: boolean; platform: string; arr: string }[] | undefined) ?? [];
      if (!list.length) return null;
      const hm = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
      return { title: `${str(c.config.from)} → ${str(c.config.to)}`, icon: "🚆", lines: list.slice(0, 3).map((x) => ({ icon: x.canceled ? "❌" : x.delay > 0 ? "⚠️" : "✅", text: `${hm(x.dep)} → ${hm(x.arr)}`, sub: x.canceled ? (lang === "tr" ? "iptal" : "afgeschaft") : x.delay > 0 ? `+${x.delay} min · ${lang === "tr" ? "peron" : "spoor"} ${x.platform}` : `${lang === "tr" ? "zamanında · peron" : "op tijd · spoor"} ${x.platform}` })) };
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
      return fresh.slice(0, 1).map((i) => ({ kind: "weather" as const, icon: "⛈️", text: ctx.lang === "tr" ? `KMI uyarısı: ${i.title}` : `KMI waarschuwt: ${i.title}` }));
    },
    widget: (c, lang) => { const items = (c.state.items as { title: string; link: string; date: string | null }[] | undefined) ?? []; const fresh = items.filter((i) => !i.date || ago(i.date) < 36 * 3600_000); return fresh.length ? { title: lang === "tr" ? "KMI uyarıları" : "KMI-waarschuwingen", icon: "⛈️", lines: fresh.slice(0, 3).map((i) => ({ text: i.title, url: i.link })) } : null; },
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
    widget: (c, lang) => { const chosen = arr(c.config.stores).filter((s) => STORES[s]); return chosen.length ? { title: lang === "tr" ? "Haftanın broşürleri" : "Folders van de week", icon: "📰", lines: chosen.map((s) => ({ icon: "🛒", text: STORES[s].name, url: STORES[s].folder })) } : null; },
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
      return [{ id: `food:${ctx.date}`, kind: "link", title: ctx.lang === "tr" ? `${DELIVERY[svc].name}'ten sipariş ver${fav ? ` (${fav})` : ""}` : `Bestellen bij ${DELIVERY[svc].name}${fav ? ` (${fav})` : ""}`, why: ctx.lang === "tr" ? "Bu akşam için yemek planlanmadı." : "Er is vanavond niets gepland.", url: DELIVERY[svc].search.replace("%s", enc(fav)) }];
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
    widget: (c, lang) => { const items = (c.state.items as { title: string; date: string | null; place: string; url: string }[] | undefined) ?? []; return items.length ? { title: lang === "tr" ? "Yakınında etkinlikler" : "Uit in de buurt", icon: "🎪", lines: items.slice(0, 4).map((i) => ({ icon: "🎪", text: i.title, sub: [i.date, i.place].filter(Boolean).join(" · "), url: i.url })) } : null; },
    briefing: (c, ctx) => { const wd = new Date(ctx.date + "T12:00:00").getDay(); if (wd !== 5 || ctx.kind !== "evening") return []; const items = (c.state.items as { title: string }[] | undefined) ?? []; return items.length ? [{ kind: "note", icon: "🎪", text: ctx.lang === "tr" ? `Bu hafta sonu yakınında: ${items.slice(0, 2).map((i) => i.title).join(", ")}.` : `Dit weekend in de buurt: ${items.slice(0, 2).map((i) => i.title).join(", ")}.` }] : []; },
  },
  { id: "delijn", name: "De Lijn", description: "Realtime vertrektijden van je halte. Vraagt een gratis API-sleutel bij De Lijn Open Data; komt in een volgende ronde.", category: "mobiliteit", icon: "🚌", scope: "member", plan: "gezin", country: ["BE"], status: "soon", refreshMinutes: 0, provides: [], fields: [] },
  { id: "mivb", name: "MIVB", description: "Realtime metro, tram en bus in Brussel. Komt in een volgende ronde.", category: "mobiliteit", icon: "🚇", scope: "member", plan: "gezin", country: ["BE"], status: "soon", refreshMinutes: 0, provides: [], fields: [] },
  { id: "inbox", name: "Gezinsinbox", description: "Een e-mailadres voor je gezin: stuur Smartschool, Gimme, de dokter of de keuringsbrief door en Gezinsbord maakt er afspraken en taken van.", category: "school", icon: "📬", scope: "household", plan: "gezin", country: [], status: "soon", refreshMinutes: 0, provides: [], fields: [] },
  { id: "recycle", name: "Recycle! (afvalapp)", description: "Rechtstreeks uit de Recycle!-app. Onofficiële koppeling die kan breken; gebruik liever het iCal-adres van je intercommunale.", category: "huis", icon: "♻️", scope: "household", plan: "gezin", country: ["BE"], status: "soon", refreshMinutes: 0, provides: [], fields: [] },
  { id: "school_holidays", name: "Schoolvakanties", description: "Vlaamse of Franstalige schoolvakanties als laag in de agenda.", category: "school", icon: "🏫", scope: "household", plan: "gezin", country: ["BE"], status: "soon", refreshMinutes: 0, provides: [], fields: [] },
  { id: "teams_status", name: "Teams-status", description: "“Papa zit in vergadering tot 15u” op het bord. Komt in een volgende ronde.", category: "werk", icon: "💼", scope: "member", plan: "plus", country: [], status: "soon", refreshMinutes: 0, provides: [], fields: [] },
  { id: "withings", name: "Withings", description: "Weegschaal en bloeddrukmeter in het dieet- en gezondheidsdeel. Komt in een volgende ronde.", category: "gezondheid", icon: "⚖️", scope: "member", plan: "plus", country: [], status: "soon", refreshMinutes: 0, provides: [], fields: [] },
  { id: "telegram", name: "Telegram-bot", description: "Stuur een foto van de schoolbrief of een boodschap naar de bot. Komt in een volgende ronde.", category: "automatisering", icon: "✈️", scope: "household", plan: "gezin", country: [], status: "soon", refreshMinutes: 0, provides: [], fields: [] },
  { id: "webhooks", name: "Webhooks (Siri, IFTTT, n8n)", description: "Een adres om van buitenaf iets op de lijst of in de agenda te zetten. Komt in een volgende ronde.", category: "automatisering", icon: "🔗", scope: "household", plan: "plus", country: [], status: "soon", refreshMinutes: 0, provides: [], fields: [] },
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
export function connectorWidgets(memberId: string | null, board: boolean, lang: "nl" | "tr", h = hid()): { id: string; connector: string; memberId: string | null; widget: Widget }[] {
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
  const s = getSettings(h); const country = s.country || "BE";
  const have = new Set(listConnections(h).map((c) => c.connector));
  const recommended = ["waste_ical", "nmbs", "kmi", "stores", "uit"];
  return CONNECTORS.filter((c) => !c.country.length || c.country.includes(country)).map(({ sync, briefing, proposals, widget, calendar, links, ...pub }) => { void sync; void briefing; void proposals; void widget; void calendar; void links; return { ...pub, categoryLabel: CATEGORY_LABEL[pub.category], recommended: recommended.includes(pub.id) && !have.has(pub.id), connected: have.has(pub.id) }; });
}
