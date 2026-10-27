// De huishoudmanager: ochtendbriefing en avondafsluiting per gezinslid, conflicten opsporen en zelf voorstellen doen.
// Werkt zonder AI (sjablonen); met een Claude-sleutel wordt de tekst warmer verwoord.
import { z } from "zod";
import { all, get, run, newId, hid, getSettings, withCtx } from "./db.js";
import { eventsBetween, getEvent, updateEvent, countdowns, type Occurrence } from "./events.js";
import * as S from "./store.js";
import { addDays, today, weekday } from "./dates.js";
import { getWeather } from "./weather.js";
import { prayerTimes } from "./prayer.js";
import { getClient, aiReady } from "./ai.js";
import { MODELS, aiAllowed, recordUsage } from "./billing.js";
import { pushToUsers, usersFor } from "./push.js";
import { broadcastTo } from "./realtime.js";
import * as H from "./home.js";
import * as HA from "./smarthome.js";
import { createEvent } from "./events.js";
import { L, asLang, type Lang } from "./i18n.js";
import { langOf, quietUsers } from "./rhythm.js";
import * as CP from "./coparent.js";

export type BriefingKind = "morning" | "evening";
export interface Item { icon: string; text: string; memberId?: string | null; kind: "event" | "task" | "meal" | "weather" | "prayer" | "countdown" | "pantry" | "list" | "stars" | "note" | "upkeep" | "waste" | "health" | "home" }
export type Proposal =
  | { id: string; kind: "plan_meal"; title: string; why: string; date: string; slot: "diner" | "lunch" | "ontbijt"; recipeId: string; recipe: string }
  | { id: string; kind: "move_event"; title: string; why: string; eventId: string; on: string; newStart: string; newEnd: string }
  | { id: string; kind: "add_list"; title: string; why: string; items: string[] }
  | { id: string; kind: "remind"; title: string; why: string; memberId: string | null; text: string }
  | { id: string; kind: "upkeep_event"; title: string; why: string; upkeepId: string; date: string; eventTitle: string; memberId: string | null }
  | { id: string; kind: "ha_service"; title: string; why: string; domain: string; service: string; data: Record<string, unknown> }
  | { id: string; kind: "link"; title: string; why: string; url: string };
export interface Briefing { kind: BriefingKind; date: string; memberId: string | null; title: string; narration: string; items: Item[]; proposals: Proposal[]; conflicts: number }

const DAYS_NL = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
const DAYS_TR = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const PRAYER_NL: Record<string, string> = { fajr: "ochtendgebed", sunrise: "zonsopgang", dhuhr: "middaggebed", asr: "namiddaggebed", maghrib: "avondgebed", isha: "nachtgebed" };
const PRAYER_TR: Record<string, string> = { fajr: "sabah", sunrise: "güneş", dhuhr: "öğle", asr: "ikindi", maghrib: "akşam", isha: "yatsı" };
const PRAYER_EN: Record<string, string> = { fajr: "fajr", sunrise: "sunrise", dhuhr: "dhuhr", asr: "asr", maghrib: "maghrib", isha: "isha" };
const hm = (iso: string | number) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const toMin = (t: string | null) => { if (!t) return 0; const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fromMin = (n: number) => `${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

// ---------- gezinsgeheugen ----------
export const MemoryInput = z.object({ text: z.string().trim().min(2).max(300), memberId: z.string().nullable().optional(), source: z.string().max(30).default("user") });
export interface Memory { id: string; text: string; memberId: string | null; source: string; createdAt: string }
export function listMemory(h = hid()): Memory[] {
  return all<{ id: string; text: string; member_id: string | null; source: string; created_at: string }>("SELECT id, text, member_id, source, created_at FROM memory WHERE household_id=? ORDER BY created_at DESC", h)
    .map((m) => ({ id: m.id, text: m.text, memberId: m.member_id, source: m.source, createdAt: m.created_at }));
}
export function remember(i: z.infer<typeof MemoryInput>, h = hid()) {
  // hetzelfde feit niet twee keer
  const dup = get<{ id: string }>("SELECT id FROM memory WHERE household_id=? AND lower(text)=lower(?)", h, i.text);
  if (dup) return dup.id;
  const id = newId();
  run("INSERT INTO memory(id, household_id, member_id, text, source) VALUES (?,?,?,?,?)", id, h, i.memberId ?? null, i.text, i.source);
  return id;
}
export const forget = (id: string, h = hid()) => run("DELETE FROM memory WHERE id=? AND household_id=?", id, h);
/** Korte tekst voor in de context van de assistent. */
export function memoryContext(h = hid()): string {
  const ms = listMemory(h).slice(0, 40);
  if (!ms.length) return "";
  const members = S.listMembers();
  return "Wat je over dit gezin onthouden hebt:\n" + ms.map((m) => `- ${m.memberId ? `${members.find((x) => x.id === m.memberId)?.name ?? "?"}: ` : ""}${m.text}`).join("\n");
}

// ---------- conflicten en vrije plekken ----------
function overlaps(a: Occurrence, b: Occurrence) {
  if (a.allDay || b.allDay || a.on !== b.on) return false;
  return toMin(a.startTime) < toMin(b.endTime) && toMin(b.startTime) < toMin(a.endTime);
}
/** Eerste vrije plek van dezelfde duur op die dag (tussen 7u en 22u), of null. */
function freeSlot(day: Occurrence[], dur: number, from: number, skipKey: string): [string, string] | null {
  const busy = day.filter((e) => !e.allDay && e.key !== skipKey).map((e) => [toMin(e.startTime), toMin(e.endTime)] as const).sort((a, b) => a[0] - b[0]);
  for (let s = Math.max(from, 7 * 60); s + dur <= 22 * 60; s += 15) {
    if (!busy.some(([bs, be]) => s < be && bs < s + dur)) return [fromMin(s), fromMin(s + dur)];
  }
  return null;
}
function conflictProposals(evs: Occurrence[], members: S.Member[], lang: Lang): { proposals: Proposal[]; count: number } {
  const proposals: Proposal[] = []; let count = 0; const seen = new Set<string>();
  for (const m of members) {
    const mine = evs.filter((e) => e.members.includes(m.id) && !e.allDay).sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
    for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) {
      const a = mine[i], b = mine[j];
      if (!overlaps(a, b)) continue;
      const pair = [a.key, b.key].sort().join("|"); if (seen.has(pair)) continue; seen.add(pair); count++;
      const mov = !b.readOnly && b.repeat === "none" ? b : !a.readOnly && a.repeat === "none" ? a : null;
      if (!mov) continue;
      const other = mov === a ? b : a;
      const dur = toMin(mov.endTime) - toMin(mov.startTime);
      const slot = freeSlot(evs.filter((e) => e.members.some((x) => mov.members.includes(x)) && e.on === mov.on), dur, toMin(other.endTime), mov.key);
      if (!slot) continue;
      proposals.push({ id: `move:${mov.id}:${mov.on}`, kind: "move_event", eventId: mov.id, on: mov.on, newStart: slot[0], newEnd: slot[1],
        title: L(lang, { nl: `${mov.title} verzetten naar ${slot[0]}`, tr: `${mov.title} → ${slot[0]}`, en: `Move ${mov.title} to ${slot[0]}` }),
        why: L(lang, { nl: `${m.name} heeft dan ook ${other.title} (${other.startTime}–${other.endTime}).`, tr: `${m.name} aynı anda ${other.title} etkinliğinde (${other.startTime}–${other.endTime}).`, en: `${m.name} also has ${other.title} then (${other.startTime}–${other.endTime}).` }) });
    }
  }
  return { proposals, count };
}

// ---------- maaltijdvoorstellen ----------
function mealProposal(date: string, slot: "diner" | "lunch", lang: Lang): Proposal | null {
  const planned = S.mealsBetween(date, date).some((m) => m.slot === slot && m.title);
  if (planned) return null;
  const recent = new Set(S.mealsBetween(addDays(date, -14), addDays(date, -1)).map((m) => m.recipeId).filter(Boolean));
  const avoid = S.avoidWords();
  const pantry = (S.pantryList()?.items ?? []).filter((i) => !i.done);
  const expiring = pantry.filter((i) => i.expires && i.expires <= addDays(date, 2)).map((i) => i.text.toLocaleLowerCase("tr"));
  const pool = S.listRecipes().filter((r) => !recent.has(r.id) && !S.dietHits(r.ingredients, avoid).length);
  if (!pool.length) return null;
  const score = (r: S.Recipe) => { const ing = r.ingredients.toLocaleLowerCase("tr"); return expiring.filter((x) => ing.includes(x)).length * 10 + pantry.filter((i) => ing.includes(i.text.toLocaleLowerCase("tr"))).length + (r.favorite ? 2 : 0) + Math.random(); };
  const best = [...pool].sort((a, b) => score(b) - score(a))[0];
  const uses = expiring.filter((x) => best.ingredients.toLocaleLowerCase("tr").includes(x));
  const slotNl = slot === "diner" ? "avondeten" : "lunch", slotTr = slot === "diner" ? "akşam yemeği" : "öğle yemeği", slotEn = slot === "diner" ? "dinner" : "lunch";
  return { id: `meal:${date}:${slot}`, kind: "plan_meal", date, slot, recipeId: best.id, recipe: best.title,
    title: L(lang, { nl: `${slotNl[0].toUpperCase()}${slotNl.slice(1)}: ${best.title}`, tr: `${slotTr}: ${best.title}`, en: `${slotEn[0].toUpperCase()}${slotEn.slice(1)}: ${best.title}` }),
    why: uses.length ? L(lang, { nl: `${uses.join(", ")} ${uses.length > 1 ? "zijn" : "is"} bijna over datum; dit recept gebruikt ${uses.length > 1 ? "ze" : "het"}.`, tr: `${uses.join(", ")} bugünlerde bozulacak; bu tarif onları kullanır.`, en: `${uses.join(", ")} ${uses.length > 1 ? "are" : "is"} about to expire; this recipe uses ${uses.length > 1 ? "them" : "it"}.` })
      : L(lang, { nl: `Er is nog geen ${slotNl} gepland; dit stond de voorbije twee weken niet op tafel.`, tr: `Henüz ${slotTr} planlanmadı; bu son iki haftada yenmedi.`, en: `No ${slotEn} planned yet; this was not on the table in the past two weeks.` }) };
}

// ---------- de briefing ----------
export async function buildBriefing(kind: BriefingKind, date: string, memberId: string | null): Promise<Briefing> {
  const s = getSettings();
  const members = S.listMembers();
  const me = memberId ? members.find((m) => m.id === memberId) ?? null : null;
  // ieder in zijn eigen taal; het gezinsscherm in de taal van het gezin
  const lang = me ? langOf(me.id) : asLang(s.language);
  const focus = kind === "morning" ? date : addDays(date, 1); // 's avonds kijken we naar morgen
  const items: Item[] = []; const proposals: Proposal[] = [];
  const evs = [...eventsBetween(focus, focus), ...CP.layerEvents(focus, focus).filter((e) => e.source !== "verblijf")];
  // co-ouderschap: overdracht vandaag of morgen, met de spullen die mee moeten
  for (const c of CP.custodyToday(focus)) {
    if (!c.handoverToday || !c.kids.length || (me && !c.kids.includes(me.id) && me.role !== "ouder")) continue;
    const names = c.kids.map((id) => members.find((m) => m.id === id)?.name).filter(Boolean).join(", ");
    const time = CP.handoverTime(c.linkId);
    const many = c.kids.length > 1; const when = kind === "evening" ? L(lang, { nl: "Morgen", tr: "Yarın", en: "Tomorrow" }) : L(lang, { nl: "Vandaag", tr: "Bugün", en: "Today" });
    items.push({ kind: "note", icon: "🏠", text: c.withUs
      ? L(lang, { nl: `${when} ${many ? "komen" : "komt"} ${names} terug van ${c.otherName}${time ? ` (${time})` : ""}.`, tr: `${when} ${names} ${c.otherName} evinden dönüyor${time ? ` (${time})` : ""}.`, en: `${when} ${names} ${many ? "come" : "comes"} back from ${c.otherName}${time ? ` (${time})` : ""}.` })
      : L(lang, { nl: `${when} ${many ? "gaan" : "gaat"} ${names} naar ${c.otherName}${time ? ` om ${time}` : ""}.`, tr: `${when} ${names} ${c.otherName} evine gidiyor${time ? ` (${time})` : ""}.`, en: `${when} ${names} ${many ? "go" : "goes"} to ${c.otherName}${time ? ` at ${time}` : ""}.` }) });
    const ho = CP.handoverFor(focus).kids.filter((k) => c.kids.includes(k.memberId) && (!me || me.role === "ouder" || k.memberId === me.id));
    const stuff = ho.flatMap((k) => k.items.filter((i) => !i.done).map((i) => `${i.icon} ${i.text}`));
    if (stuff.length) items.push({ kind: "task", icon: "🎒", text: `${L(lang, { nl: "Mee te nemen", tr: "Yanına alınacaklar", en: "To pack" })}: ${stuff.slice(0, 8).join(", ")}` });
  }
  const forMe = (e: Occurrence) => !me || !e.members.length || e.members.includes(me.id);
  const mine = evs.filter(forMe).sort((a, b) => Number(b.allDay) - Number(a.allDay) || toMin(a.startTime) - toMin(b.startTime));
  const who = (e: Occurrence) => (me || !e.members.length ? "" : ` (${e.members.map((id) => members.find((m) => m.id === id)?.name ?? "?").join(", ")})`);
  for (const e of mine.slice(0, 8)) items.push({ kind: "event", icon: e.allDay ? "📌" : "🕐", text: `${e.allDay ? "" : `${e.startTime} `}${e.title}${e.location ? ` · ${e.location}` : ""}${who(e)}`, memberId: me?.id ?? null });
  // vroeg op?
  const first = mine.find((e) => !e.allDay);
  if (kind === "evening" && first && toMin(first.startTime) <= 8 * 60 + 30) items.push({ kind: "note", icon: "⏰", text: L(lang, { nl: `Morgen vroeg op: ${first.title} om ${first.startTime}.`, tr: `Yarın erken: ${first.startTime} ${first.title}.`, en: `Early start tomorrow: ${first.title} at ${first.startTime}.` }) });
  // taken
  const done = new Set(S.doneBetween(focus, focus));
  const chores = S.choresOn(focus).filter((c) => !me || c.memberId === me.id);
  const open = chores.filter((c) => !done.has(`${focus}|${c.id}`));
  if (kind === "morning" && chores.length) {
    const perPerson = members.map((m) => [m.name, chores.filter((c) => c.memberId === m.id).length] as const).filter(([, n]) => n > 0).map(([n, k]) => `${n} ${k}`).join(", ");
    const list = me ? chores.slice(0, 4).map((c) => `${c.icon} ${c.title}`).join(", ") + (chores.length > 4 ? "…" : "") : perPerson;
    items.push({ kind: "task", icon: "✅", text: L(lang, { nl: `${chores.length} ${chores.length === 1 ? "taak" : "taken"}: ${list}`, tr: `${chores.length} görev: ${list}`, en: `${chores.length} ${chores.length === 1 ? "chore" : "chores"}: ${list}` }) });
  }
  if (kind === "evening") {
    const todayDone = new Set(S.doneBetween(date, date)); const todayChores = S.choresOn(date).filter((c) => !me || c.memberId === me.id);
    const left = todayChores.filter((c) => !todayDone.has(`${date}|${c.id}`));
    if (todayChores.length && !left.length) items.push({ kind: "stars", icon: "🌟", text: L(lang, { nl: "Alle taken van vandaag zijn af. Knap gedaan!", tr: "Bugünkü tüm görevler tamam. Aferin!", en: "All of today's chores are done. Well done!" }) });
    else if (left.length) items.push({ kind: "task", icon: "⏳", text: `${L(lang, { nl: "Nog open", tr: "Hâlâ açık", en: "Still open" })}: ${left.map((c) => `${c.icon} ${c.title}${me ? "" : ` (${members.find((m) => m.id === c.memberId)?.name})`}`).join(", ")}` });
  }
  // eten
  const meals = S.mealsBetween(focus, focus);
  const dinner = meals.find((m) => m.slot === "diner" && m.title), lunch = meals.find((m) => m.slot === "lunch" && m.title);
  if (dinner) items.push({ kind: "meal", icon: "🍽️", text: L(lang, { nl: `${kind === "evening" ? "Morgen" : "Vanavond"} eten we ${dinner.title}.`, tr: `${kind === "evening" ? "Yarın akşam" : "Bu akşam"}: ${dinner.title}`, en: `${kind === "evening" ? "Tomorrow" : "Tonight"} we eat ${dinner.title}.` }) });
  const mp = mealProposal(focus, "diner", lang); if (mp) proposals.push(mp);
  if (kind === "evening" && !lunch && weekday(focus) >= 1 && weekday(focus) <= 5) items.push({ kind: "meal", icon: "🥪", text: L(lang, { nl: "Lunch voor morgen staat nog niet gepland.", tr: "Yarın için öğle yemeği planlanmadı.", en: "Lunch for tomorrow is not planned yet." }) });
  // weer
  if (kind === "morning") { try { const w = await getWeather(); const d = w.days[0]; items.push({ kind: "weather", icon: w.current.icon, text: L(lang, { nl: `${w.current.temp}°, ${w.current.label.toLowerCase()}; vandaag ${d.min}° tot ${d.max}°${d.rain >= 50 ? ", neem een paraplu mee" : ""}.`, tr: `${w.current.temp}°, ${w.current.label.toLowerCase()}; ${d.min}° ile ${d.max}° arası${d.rain >= 50 ? ", şemsiye al" : ""}.`, en: `${w.current.temp}°, ${w.current.label.toLowerCase()}; today ${d.min}° to ${d.max}°${d.rain >= 50 ? ", take an umbrella" : ""}.` }) }); } catch { /* geen weer */ } }
  // gebed
  if (s.ezan_on === "1") {
    try {
      let adjust: Record<string, number> = {}; try { adjust = JSON.parse(s.ezan_adjust || "{}"); } catch { /* */ }
      const pt = prayerTimes({ date: focus, latitude: Number(s.latitude), longitude: Number(s.longitude), method: s.ezan_method, asr: s.ezan_asr === "hanafi" ? "hanafi" : "standard", adjust } as never);
      const next = (["fajr", "dhuhr", "asr", "maghrib", "isha"] as const).map((p) => [p, pt[p]] as const).find(([, t]) => kind === "evening" || t > Date.now());
      if (next) items.push({ kind: "prayer", icon: "🕌", text: L(lang, { nl: `${kind === "evening" ? "Morgen eerste gebed" : "Volgend gebed"}: ${PRAYER_NL[next[0]]} om ${hm(next[1])}`, tr: `${kind === "evening" ? "Yarın s" : "S"}ıradaki namaz: ${PRAYER_TR[next[0]]} ${hm(next[1])}`, en: `${kind === "evening" ? "First prayer tomorrow" : "Next prayer"}: ${PRAYER_EN[next[0]]} at ${hm(next[1])}` }) });
    } catch { /* */ }
  }
  // aftellen en verjaardagen
  for (const c of countdowns(members, 6).filter((c) => c.days <= 3 && (!me || !c.memberId || c.memberId === me.id)).slice(0, 2)) items.push({ kind: "countdown", icon: c.icon, text: c.days === 0 ? L(lang, { nl: `Vandaag: ${c.title}!`, tr: `Bugün: ${c.title}!`, en: `Today: ${c.title}!` }) : c.days === 1 ? L(lang, { nl: `Morgen: ${c.title}`, tr: `Yarın: ${c.title}`, en: `Tomorrow: ${c.title}` }) : L(lang, { nl: `Over ${c.days} dagen: ${c.title}`, tr: `${c.days} gün sonra: ${c.title}`, en: `In ${c.days} days: ${c.title}` }) });
  // voorraad en boodschappen (alleen voor ouders of het hele gezin)
  if (!me || me.role === "ouder") {
    const pantry = (S.pantryList()?.items ?? []).filter((i) => !i.done && i.expires && i.expires <= addDays(date, 1));
    if (pantry.length) items.push({ kind: "pantry", icon: "🥫", text: `${L(lang, { nl: "Bijna over datum", tr: "Son kullanma yaklaşıyor", en: "About to expire" })}: ${pantry.map((i) => i.text).join(", ")}.` });
    const shop = S.listLists().find((l) => l.kind === "shopping"); const n = shop?.items.filter((i) => !i.done).length ?? 0;
    if (n >= 5 && kind === "morning") items.push({ kind: "list", icon: "🛒", text: L(lang, { nl: `${n} dingen op de boodschappenlijst.`, tr: `Alışveriş listesinde ${n} ürün var.`, en: `${n} items on the shopping list.` }) });
  }
  // het huis: onderhoud dat eraan komt, afval morgen, gezondheid en medicatie, slim huis
  if (!me || me.role === "ouder") {
    for (const u of H.listUpkeep().filter((u) => u.status !== "ok" && u.status !== "none").slice(0, 3)) {
      const txt = u.status === "late" ? L(lang, { nl: `${u.title} is ${-u.daysLeft!} ${u.daysLeft === -1 ? "dag" : "dagen"} over tijd`, tr: `${u.title}: ${-u.daysLeft!} gün gecikti`, en: `${u.title} is ${-u.daysLeft!} ${u.daysLeft === -1 ? "day" : "days"} overdue` }) : u.status === "due" ? L(lang, { nl: `Vandaag: ${u.title}`, tr: `Bugün: ${u.title}`, en: `Today: ${u.title}` }) : L(lang, { nl: `${u.title} over ${u.daysLeft} dagen`, tr: `${u.title}: ${u.daysLeft} gün sonra`, en: `${u.title} in ${u.daysLeft} days` });
      items.push({ kind: "upkeep", icon: u.icon, text: txt + (u.provider ? ` · ${u.provider}${u.providerPhone ? ` ${u.providerPhone}` : ""}` : "") });
      if (u.nextDue && u.status === "soon" && !eventsBetween(u.nextDue, u.nextDue).some((e) => e.title.toLowerCase().includes(u.title.toLowerCase().slice(0, 12))))
        proposals.push({ id: `upk:${u.id}`, kind: "upkeep_event", upkeepId: u.id, date: u.nextDue, eventTitle: u.title, memberId: u.memberId, title: L(lang, { nl: `${u.title} in de agenda zetten`, tr: `${u.title} takvime koy`, en: `Put ${u.title} in the calendar` }), why: L(lang, { nl: `Uiterste datum ${u.nextDue}; in de agenda ziet iedereen het.`, tr: `Son tarih ${u.nextDue}; takvimde herkes görür.`, en: `Due ${u.nextDue}; in the calendar everyone sees it.` }) });
    }
    const wasteDay = kind === "evening" ? addDays(date, 1) : date;
    const fr = H.wasteOn(wasteDay);
    if (fr.length) { const names = fr.map((f) => `${H.fractionIcon(f)} ${H.fractionLabel(f, lang)}`).join(", "); items.push({ kind: "waste", icon: "♻️", text: L(lang, { nl: `${kind === "evening" ? "Morgen" : "Vandaag"} ophaling: ${names}${kind === "evening" ? " — vanavond buitenzetten" : ""}`, tr: `${kind === "evening" ? "Yarın" : "Bugün"} çöp: ${names}${kind === "evening" ? " — bu akşam dışarı koy" : ""}`, en: `${kind === "evening" ? "Collection tomorrow" : "Collection today"}: ${names}${kind === "evening" ? " — put it out tonight" : ""}` }) }); }
  }
  {
    const hs = H.listHealth(hid(), me?.id).filter((x) => !x.done && x.kind !== "medication" && x.date && x.date >= focus && x.date <= addDays(focus, kind === "evening" ? 0 : 2));
    for (const x of hs.slice(0, 3)) { const who = me ? "" : `${members.find((m) => m.id === x.memberId)?.name ?? "?"}: `; items.push({ kind: "health", icon: x.kind === "vaccine" ? "💉" : "🩺", text: `${who}${x.title}${x.date !== focus ? ` (${x.date})` : ""}${x.time ? ` ${x.time}` : ""}${x.provider ? ` · ${x.provider}` : ""}`, memberId: x.memberId }); }
    const meds = H.medicationOn(focus, hid(), me?.id);
    for (const m of meds.slice(0, 3)) { const who = me ? "" : `${members.find((x) => x.id === m.memberId)?.name ?? "?"}: `; items.push({ kind: "health", icon: "💊", text: `${who}${m.title}${m.timesList.length ? ` ${L(lang, { nl: "om", tr: "saat", en: "at" })} ${m.timesList.join(", ")}` : ""}${m.stock !== null && m.stock <= 7 ? L(lang, { nl: ` · nog ${m.stock}, bijbestellen`, tr: ` · stok ${m.stock}, yenile`, en: ` · ${m.stock} left, reorder` }) : ""}`, memberId: m.memberId }); }
  }
  if ((!me || me.role === "ouder") && HA.haConfig()) {
    try {
      const st = await HA.haStates(false);
      const home = st.filter((x) => x.entity_id.startsWith("person.")); const nobody = home.length > 0 && home.every((x) => x.state !== "home");
      const heating = st.filter((x) => x.entity_id.startsWith("climate.") && x.state !== "off" && Number(x.attributes.temperature) >= 20);
      if (nobody && heating.length && kind === "morning") for (const c of heating.slice(0, 1)) proposals.push({ id: `ha:${c.entity_id}`, kind: "ha_service", domain: "climate", service: "set_temperature", data: { entity_id: c.entity_id, temperature: 17 }, title: L(lang, { nl: `Verwarming op 17° zetten`, tr: `Kaloriferi 17°'ye al`, en: `Set heating to 17°` }), why: L(lang, { nl: `Niemand thuis en ${c.attributes.friendly_name ?? c.entity_id} staat op ${c.attributes.temperature}°.`, tr: `Kimse evde değil ve ${c.attributes.friendly_name ?? c.entity_id} ${c.attributes.temperature}°'de.`, en: `Nobody home and ${c.attributes.friendly_name ?? c.entity_id} is at ${c.attributes.temperature}°.` }) });
      const open = st.filter((x) => x.entity_id.startsWith("lock.") && x.state === "unlocked");
      if (open.length && kind === "evening") items.push({ kind: "home", icon: "🔓", text: `${L(lang, { nl: "Niet op slot", tr: "Kilitli değil", en: "Not locked" })}: ${open.map((x) => x.attributes.friendly_name ?? x.entity_id).join(", ")}` });
    } catch { /* HA niet bereikbaar */ }
  }
  // weekbox: zondagavond (of zaterdag) en de komende week is nog niet gepland
  if ((!me || me.role === "ouder") && kind === "evening" && weekday(date) === 0) {
    const planned = S.mealsBetween(addDays(date, 1), addDays(date, 7)).filter((m) => m.slot === "diner" && m.title).length;
    if (planned < 3) items.push({ kind: "meal", icon: "✨", text: L(lang, { nl: `De komende week is nog ${planned ? "bijna " : ""}niet gepland: open Maaltijden → Weekbox en ik stel het avondeten voor.`, tr: `Gelecek hafta henüz planlanmadı: Yemekler → Haftalık kutu'yu aç, akşam yemeklerini önereyim.`, en: `The coming week is ${planned ? "mostly " : ""}unplanned: open Meals → Weekbox and I will suggest the dinners.` }) });
  }
  // koppelingen: elk hoogstens twee regels en één voorstel
  try { const { connectorBriefing } = await import("./connectors.js"); const cb = connectorBriefing({ kind, date, memberId: me?.id ?? null, lang }); items.push(...cb.items); proposals.push(...cb.proposals); } catch { /* */ }
  // conflicten
  const conf = conflictProposals(evs.filter((e) => !me || e.members.includes(me.id)), me ? [me] : members, lang);
  proposals.push(...conf.proposals);
  const name = me?.name ?? s.family_name;
  const title = `${kind === "morning" ? L(lang, { nl: "Goeiemorgen", tr: "Günaydın", en: "Good morning" }) : L(lang, { nl: "Goeienavond", tr: "İyi akşamlar", en: "Good evening" })}${name ? `, ${name}` : ""}`;
  const b: Briefing = { kind, date, memberId: me?.id ?? null, title, narration: "", items, proposals, conflicts: conf.count };
  b.narration = await narrate(b, lang, me?.name ?? null, focus);
  return b;
}

const cache = new Map<string, { at: number; text: string }>();
async function narrate(b: Briefing, lang: Lang, name: string | null, focus: string): Promise<string> {
  const key = `${hid()}|${b.kind}|${b.date}|${b.memberId}|${b.items.map((i) => i.text).join(";")}|${b.proposals.length}`;
  const hit = cache.get(key); if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.text;
  let text = template(b, lang, name, focus);
  if (aiReady() && aiAllowed("briefing")) {
    try {
      const client = getClient()!;
      const r = await client.messages.create({ model: MODELS.light, max_tokens: 300, output_config: { effort: "low" } as never,
        system: L(lang, { nl: "Je bent de assistent op het keukenscherm van een gezin. Vertel de notities hieronder in 2 tot 4 korte, warme spreektaalzinnen in het Nederlands (Vlaams mag); ze worden voorgelezen. Voeg niets toe, houd uren en namen exact, geen emoji en geen titel.", tr: "Sen bir ailenin mutfak ekranındaki yardımcısın. Aşağıdaki notları 2-4 kısa, sıcak, konuşma dilinde Türkçe cümleyle anlat; sesli okunacak. Yeni bilgi ekleme, saatleri ve isimleri aynen koru, emoji ve başlık kullanma.", en: "You are the assistant on a family's kitchen screen. Tell the notes below in 2 to 4 short, warm, conversational English sentences; they will be read aloud. Add nothing, keep times and names exact, no emoji and no title." }),
        messages: [{ role: "user", content: `${b.title}.\n${b.items.map((i) => `- ${i.text}`).join("\n")}${b.proposals.length ? `\nVoorstellen die de gebruiker kan aanvaarden: ${b.proposals.map((p) => p.title).join("; ")}.` : ""}${memoryContext() ? `\n${memoryContext()}` : ""}` }] });
      recordUsage("briefing", MODELS.light, r.usage);
      const out = r.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join(" ").trim();
      if (out) text = out;
    } catch { /* sjabloon volstaat */ }
  }
  cache.set(key, { at: Date.now(), text });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return text;
}
function template(b: Briefing, lang: Lang, name: string | null, focus: string): string {
  const ev = b.items.filter((i) => i.kind === "event"), rest = b.items.filter((i) => i.kind !== "event");
  const day = (lang === "tr" ? DAYS_TR : lang === "en" ? DAYS_EN : DAYS_NL)[weekday(focus)];
  const parts: string[] = [];
  if (lang === "en") {
    parts.push(b.kind === "morning" ? `${b.title}! It's ${day}.` : `${b.title}. Tomorrow is ${day}.`);
    parts.push(ev.length ? `${ev.length === 1 ? "One event" : `${ev.length} events`}: ${ev.map((e) => e.text).join("; ")}.` : (b.kind === "morning" ? pick(["No events today, a quiet day.", "The calendar is empty; enjoy it."]) : "Nothing planned for tomorrow."));
  } else if (lang === "tr") {
    parts.push(b.kind === "morning" ? `${b.title}! Bugün ${day}.` : `${b.title}. Yarın ${day}.`);
    parts.push(ev.length ? `${ev.length} plan var: ${ev.map((e) => e.text).join("; ")}.` : (b.kind === "morning" ? pick(["Bugün plan yok, sakin bir gün.", "Takvim boş; keyfini çıkar."]) : "Yarın için plan yok."));
  } else {
    parts.push(b.kind === "morning" ? `${b.title}! Het is ${day}.` : `${b.title}. Morgen is het ${day}.`);
    parts.push(ev.length ? `${ev.length === 1 ? "Eén afspraak" : `${ev.length} afspraken`}: ${ev.map((e) => e.text).join("; ")}.` : (b.kind === "morning" ? pick(["Geen afspraken vandaag, een rustige dag.", "De agenda is leeg; geniet ervan."]) : "Morgen staat er niets gepland."));
  }
  for (const r of rest) parts.push(r.text.endsWith(".") || r.text.endsWith("!") ? r.text : r.text + ".");
  if (b.proposals.length) parts.push(L(lang, { nl: `Ik heb ${b.proposals.length === 1 ? "een voorstel" : `${b.proposals.length} voorstellen`} voor je.`, tr: `${b.proposals.length} önerim var.`, en: `I have ${b.proposals.length === 1 ? "a suggestion" : `${b.proposals.length} suggestions`} for you.` }));
  return parts.join(" ");
}

// ---------- voorstellen uitvoeren ----------
export const ProposalInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("plan_meal"), date: z.string(), slot: z.enum(["diner", "lunch", "ontbijt"]), recipeId: z.string(), recipe: z.string() }),
  z.object({ kind: z.literal("move_event"), eventId: z.string(), on: z.string(), newStart: z.string(), newEnd: z.string() }),
  z.object({ kind: z.literal("add_list"), items: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal("remind"), text: z.string(), memberId: z.string().nullable() }),
  z.object({ kind: z.literal("upkeep_event"), upkeepId: z.string(), date: z.string(), eventTitle: z.string(), memberId: z.string().nullable() }),
  z.object({ kind: z.literal("ha_service"), domain: z.string(), service: z.string(), data: z.record(z.string(), z.unknown()) }),
  z.object({ kind: z.literal("link"), url: z.string() }),
]);
export async function applyProposal(p: z.infer<typeof ProposalInput>, lang: Lang = asLang(getSettings().language)): Promise<{ ok: true; message: string; topics: ("meals" | "events" | "lists" | "home")[] }> {
  if (p.kind === "upkeep_event") {
    createEvent({ title: p.eventTitle, date: p.date, endDate: null, startTime: null, endTime: null, allDay: true, repeat: "none", repeatUntil: null, exdates: [], members: p.memberId ? [p.memberId] : [], location: "", notes: "", countdown: false } as never);
    return { ok: true, message: L(lang, { nl: `${p.eventTitle} staat in de agenda`, tr: `${p.eventTitle} takvimde`, en: `${p.eventTitle} is in the calendar` }), topics: ["events"] };
  }
  if (p.kind === "ha_service") { await HA.haCall(p.domain, p.service, p.data); return { ok: true, message: L(lang, { nl: "Doorgegeven aan het huis", tr: "Eve iletildi", en: "Sent to the home" }), topics: [] }; }
  if (p.kind === "link") return { ok: true, message: L(lang, { nl: "Geopend", tr: "Açıldı", en: "Opened" }), topics: [] };
  if (p.kind === "plan_meal") { S.setMeal(p.date, p.slot, p.recipe, p.recipeId); return { ok: true, message: `${L(lang, { nl: "Gepland", tr: "Planlandı", en: "Planned" })}: ${p.recipe}`, topics: ["meals"] }; }
  if (p.kind === "move_event") {
    const ev = getEvent(p.eventId); if (!ev) throw new Error(L(lang, { nl: "Die afspraak bestaat niet meer.", tr: "Bu etkinlik artık yok.", en: "That event no longer exists." }));
    if (ev.readOnly) throw new Error(L(lang, { nl: "Deze afspraak komt uit een gekoppelde agenda.", tr: "Bu etkinlik bağlı bir takvimden geliyor.", en: "This event comes from a connected calendar." }));
    updateEvent(p.eventId, { ...ev, startTime: p.newStart, endTime: p.newEnd, allDay: false } as never);
    return { ok: true, message: L(lang, { nl: `${ev.title} staat nu om ${p.newStart}`, tr: `${ev.title} artık ${p.newStart}'te`, en: `${ev.title} is now at ${p.newStart}` }), topics: ["events"] };
  }
  if (p.kind === "add_list") { const id = S.ensureShoppingList(); for (const it of p.items) S.addItem(id, it); return { ok: true, message: L(lang, { nl: `${p.items.length} op de boodschappenlijst`, tr: `${p.items.length} ürün alışveriş listesinde`, en: `${p.items.length} on the shopping list` }), topics: ["lists"] }; }
  return { ok: true, message: L(lang, { nl: "Genoteerd", tr: "Not edildi", en: "Noted" }), topics: [] };
}

// ---------- dagelijks schema: briefing als melding op de telefoons ----------
const sent = new Set<string>();
export function startManagerScheduler() {
  const tick = async () => {
    const now = new Date(); const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`; const d = today();
    for (const h of all<{ id: string }>("SELECT id FROM households")) {
      await withCtx({ userId: "", householdId: h.id } as never, async () => {
        const s = getSettings(h.id);
        // slim huis: nachtrust dimt het huis; afval- en medicatiemeldingen
        if (s.sleep_from && s.sleep_from === hhmm && !sent.has(`${h.id}|${d}|sleep`)) { sent.add(`${h.id}|${d}|sleep`); void HA.runMoment("sleep", h.id); }
        if (s.waste_notify && s.waste_notify === hhmm && !sent.has(`${h.id}|${d}|waste`)) {
          sent.add(`${h.id}|${d}|waste`);
          const fr = H.wasteOn(addDays(d, 1), h.id);
          if (fr.length) { const lang = asLang(s.language); await pushToUsers(usersFor(h.id, []), { title: L(lang, { nl: "Afval buitenzetten ♻️", tr: "Çöpü dışarı koy ♻️", en: "Put the bins out ♻️" }), body: fr.map((f) => `${H.fractionIcon(f)} ${H.fractionLabel(f, lang)}`).join(", "), tag: "waste", url: "/#today" }); }
        }
        for (const m of H.medicationOn(d, h.id)) for (const tm of m.timesList) {
          const key = `${h.id}|${d}|med|${m.id}|${tm}`;
          if (tm === hhmm && !sent.has(key)) { sent.add(key); await pushToUsers(usersFor(h.id, [m.memberId]), { title: `💊 ${m.title}`, body: L(langOf(m.memberId, h.id), { nl: `${tm} — tijd voor je medicatie`, tr: `${tm} — ilaç zamanı`, en: `${tm} — time for your medication` }), tag: `med-${m.id}`, url: "/#today", urgent: true }); }
        }
        // routines: wie heeft nog ochtend- of avondtaken open? Melding naar het kind (eigen telefoon) of de ouders.
        for (const [slot, at] of [["ochtend", s.routine_remind_morning], ["avond", s.routine_remind_evening]] as const) {
          if (!at || at !== hhmm || sent.has(`${h.id}|${d}|routine|${slot}`)) continue;
          sent.add(`${h.id}|${d}|routine|${slot}`);
          for (const r of routineReminders(slot, d, h.id)) await pushToUsers(usersFor(h.id, [r.memberId]), { title: r.title, body: r.body, tag: `routine-${r.memberId}`, url: "/#chores" });
        }
        if (s.briefing_push !== "1") return;
        for (const kind of ["morning", "evening"] as const) {
          const at = kind === "morning" ? s.briefing_morning : s.briefing_evening;
          if (!at || at !== hhmm) continue;
          const key = `${h.id}|${d}|${kind}`; if (sent.has(key)) continue; sent.add(key);
          if (kind === "morning") void HA.runMoment("morning", h.id);
          broadcastTo(h.id, ["settings"]); // hubs verversen de briefingkaart
          const rows = all<{ user_id: string; member_id: string | null }>("SELECT user_id, member_id FROM household_users WHERE household_id=?", h.id);
          for (const r of rows) {
            try {
              if (quietUsers([r.user_id]).size) continue; // slaapt na een nachtdienst
              const b = await buildBriefing(kind, d, r.member_id);
              const body = b.narration.length > 180 ? b.narration.slice(0, 177) + "…" : b.narration;
              await pushToUsers([r.user_id], { title: b.title, body, tag: `briefing-${kind}`, url: "/#today" });
            } catch (e) { console.warn("[manager]", e); }
          }
        }
      });
    }
    if (sent.size > 2000) sent.clear();
  };
  setInterval(() => tick().catch((e) => console.warn("[manager]", e)), 60_000).unref();
}
/** Per gezinslid de openstaande taken van dit moment van de dag (plus "altijd"), als korte melding in de gezinstaal. */
export function routineReminders(slot: "ochtend" | "avond", date: string, h = hid()): { memberId: string; name: string; open: { icon: string; title: string }[]; title: string; body: string }[] {
  const done = new Set(S.doneBetween(date, date));
  const out: { memberId: string; name: string; open: { icon: string; title: string }[]; title: string; body: string }[] = [];
  for (const m of S.listMembers()) {
    if (!CP.isPresent(m.id, date, h)) continue; // bij de andere ouder: die stuurt de herinnering
    const lang = langOf(m.id, h);
    const open = S.choresOn(date).filter((c) => c.memberId === m.id && (c.moment === slot || c.moment === "altijd") && !done.has(`${date}|${c.id}`));
    if (!open.length) continue;
    const n = open.length; const list = open.slice(0, 4).map((c) => `${c.icon} ${c.title}`).join(", ") + (n > 4 ? "…" : "");
    out.push({ memberId: m.id, name: m.name, open: open.map((c) => ({ icon: c.icon, title: c.title })),
      title: L(lang, { nl: `${m.name}, ${slot === "ochtend" ? "ochtendroutine" : "avondroutine"} ⭐`, tr: `${m.name}, ${slot === "ochtend" ? "sabah rutini" : "akşam rutini"} ⭐`, en: `${m.name}, ${slot === "ochtend" ? "morning routine" : "evening routine"} ⭐` }),
      body: L(lang, { nl: `Nog ${n} ${n === 1 ? "taak" : "taken"}: ${list}`, tr: `${n} görev kaldı: ${list}`, en: `${n} ${n === 1 ? "task" : "tasks"} left: ${list}` }) });
  }
  return out;
}
// usersFor wordt elders gebruikt voor meldingen aan ouders van een kind
export { usersFor };
