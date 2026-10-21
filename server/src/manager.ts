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
import { MODEL } from "./assistant.js";
import { pushToUsers, usersFor } from "./push.js";
import { broadcastTo } from "./realtime.js";

export type BriefingKind = "morning" | "evening";
export interface Item { icon: string; text: string; memberId?: string | null; kind: "event" | "task" | "meal" | "weather" | "prayer" | "countdown" | "pantry" | "list" | "stars" | "note" }
export type Proposal =
  | { id: string; kind: "plan_meal"; title: string; why: string; date: string; slot: "diner" | "lunch" | "ontbijt"; recipeId: string; recipe: string }
  | { id: string; kind: "move_event"; title: string; why: string; eventId: string; on: string; newStart: string; newEnd: string }
  | { id: string; kind: "add_list"; title: string; why: string; items: string[] }
  | { id: string; kind: "remind"; title: string; why: string; memberId: string | null; text: string };
export interface Briefing { kind: BriefingKind; date: string; memberId: string | null; title: string; narration: string; items: Item[]; proposals: Proposal[]; conflicts: number }

const DAYS_NL = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
const DAYS_TR = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const PRAYER_NL: Record<string, string> = { fajr: "ochtendgebed", sunrise: "zonsopgang", dhuhr: "middaggebed", asr: "namiddaggebed", maghrib: "avondgebed", isha: "nachtgebed" };
const PRAYER_TR: Record<string, string> = { fajr: "sabah", sunrise: "güneş", dhuhr: "öğle", asr: "ikindi", maghrib: "akşam", isha: "yatsı" };
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
function conflictProposals(evs: Occurrence[], members: S.Member[], lang: "nl" | "tr"): { proposals: Proposal[]; count: number } {
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
        title: lang === "tr" ? `${mov.title} → ${slot[0]}` : `${mov.title} verzetten naar ${slot[0]}`,
        why: lang === "tr" ? `${m.name} aynı anda ${other.title} etkinliğinde (${other.startTime}–${other.endTime}).` : `${m.name} heeft dan ook ${other.title} (${other.startTime}–${other.endTime}).` });
    }
  }
  return { proposals, count };
}

// ---------- maaltijdvoorstellen ----------
function mealProposal(date: string, slot: "diner" | "lunch", lang: "nl" | "tr"): Proposal | null {
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
  const slotNl = slot === "diner" ? "avondeten" : "lunch", slotTr = slot === "diner" ? "akşam yemeği" : "öğle yemeği";
  return { id: `meal:${date}:${slot}`, kind: "plan_meal", date, slot, recipeId: best.id, recipe: best.title,
    title: lang === "tr" ? `${slotTr}: ${best.title}` : `${slotNl[0].toUpperCase()}${slotNl.slice(1)}: ${best.title}`,
    why: uses.length ? (lang === "tr" ? `${uses.join(", ")} bugünlerde bozulacak; bu tarif onları kullanır.` : `${uses.join(", ")} ${uses.length > 1 ? "zijn" : "is"} bijna over datum; dit recept gebruikt ${uses.length > 1 ? "ze" : "het"}.`)
      : (lang === "tr" ? `Henüz ${slotTr} planlanmadı; bu son iki haftada yenmedi.` : `Er is nog geen ${slotNl} gepland; dit stond de voorbije twee weken niet op tafel.`) };
}

// ---------- de briefing ----------
export async function buildBriefing(kind: BriefingKind, date: string, memberId: string | null): Promise<Briefing> {
  const s = getSettings(); const lang = s.language === "tr" ? "tr" : "nl";
  const members = S.listMembers();
  const me = memberId ? members.find((m) => m.id === memberId) ?? null : null;
  const focus = kind === "morning" ? date : addDays(date, 1); // 's avonds kijken we naar morgen
  const items: Item[] = []; const proposals: Proposal[] = [];
  const evs = eventsBetween(focus, focus);
  const forMe = (e: Occurrence) => !me || !e.members.length || e.members.includes(me.id);
  const mine = evs.filter(forMe).sort((a, b) => Number(b.allDay) - Number(a.allDay) || toMin(a.startTime) - toMin(b.startTime));
  const who = (e: Occurrence) => (me || !e.members.length ? "" : ` (${e.members.map((id) => members.find((m) => m.id === id)?.name ?? "?").join(", ")})`);
  for (const e of mine.slice(0, 8)) items.push({ kind: "event", icon: e.allDay ? "📌" : "🕐", text: `${e.allDay ? "" : `${e.startTime} `}${e.title}${e.location ? ` · ${e.location}` : ""}${who(e)}`, memberId: me?.id ?? null });
  // vroeg op?
  const first = mine.find((e) => !e.allDay);
  if (kind === "evening" && first && toMin(first.startTime) <= 8 * 60 + 30) items.push({ kind: "note", icon: "⏰", text: lang === "tr" ? `Yarın erken: ${first.startTime} ${first.title}.` : `Morgen vroeg op: ${first.title} om ${first.startTime}.` });
  // taken
  const done = new Set(S.doneBetween(focus, focus));
  const chores = S.choresOn(focus).filter((c) => !me || c.memberId === me.id);
  const open = chores.filter((c) => !done.has(`${focus}|${c.id}`));
  if (kind === "morning" && chores.length) {
    const perPerson = members.map((m) => [m.name, chores.filter((c) => c.memberId === m.id).length] as const).filter(([, n]) => n > 0).map(([n, k]) => `${n} ${k}`).join(", ");
    const list = me ? chores.slice(0, 4).map((c) => `${c.icon} ${c.title}`).join(", ") + (chores.length > 4 ? "…" : "") : perPerson;
    items.push({ kind: "task", icon: "✅", text: lang === "tr" ? `${chores.length} görev: ${list}` : `${chores.length} ${chores.length === 1 ? "taak" : "taken"}: ${list}` });
  }
  if (kind === "evening") {
    const todayDone = new Set(S.doneBetween(date, date)); const todayChores = S.choresOn(date).filter((c) => !me || c.memberId === me.id);
    const left = todayChores.filter((c) => !todayDone.has(`${date}|${c.id}`));
    if (todayChores.length && !left.length) items.push({ kind: "stars", icon: "🌟", text: lang === "tr" ? "Bugünkü tüm görevler tamam. Aferin!" : "Alle taken van vandaag zijn af. Knap gedaan!" });
    else if (left.length) items.push({ kind: "task", icon: "⏳", text: lang === "tr" ? `Hâlâ açık: ${left.map((c) => `${c.icon} ${c.title}${me ? "" : ` (${members.find((m) => m.id === c.memberId)?.name})`}`).join(", ")}` : `Nog open: ${left.map((c) => `${c.icon} ${c.title}${me ? "" : ` (${members.find((m) => m.id === c.memberId)?.name})`}`).join(", ")}` });
  }
  // eten
  const meals = S.mealsBetween(focus, focus);
  const dinner = meals.find((m) => m.slot === "diner" && m.title), lunch = meals.find((m) => m.slot === "lunch" && m.title);
  if (dinner) items.push({ kind: "meal", icon: "🍽️", text: lang === "tr" ? `${kind === "evening" ? "Yarın akşam" : "Bu akşam"}: ${dinner.title}` : `${kind === "evening" ? "Morgen" : "Vanavond"} eten we ${dinner.title}.` });
  const mp = mealProposal(focus, "diner", lang); if (mp) proposals.push(mp);
  if (kind === "evening" && !lunch && weekday(focus) >= 1 && weekday(focus) <= 5) items.push({ kind: "meal", icon: "🥪", text: lang === "tr" ? "Yarın için öğle yemeği planlanmadı." : "Lunch voor morgen staat nog niet gepland." });
  // weer
  if (kind === "morning") { try { const w = await getWeather(); const d = w.days[0]; items.push({ kind: "weather", icon: w.current.icon, text: lang === "tr" ? `${w.current.temp}°, ${w.current.label.toLowerCase()}; ${d.min}° ile ${d.max}° arası${d.rain >= 50 ? ", şemsiye al" : ""}.` : `${w.current.temp}°, ${w.current.label.toLowerCase()}; vandaag ${d.min}° tot ${d.max}°${d.rain >= 50 ? ", neem een paraplu mee" : ""}.` }); } catch { /* geen weer */ } }
  // gebed
  if (s.ezan_on === "1") {
    try {
      let adjust: Record<string, number> = {}; try { adjust = JSON.parse(s.ezan_adjust || "{}"); } catch { /* */ }
      const pt = prayerTimes({ date: focus, latitude: Number(s.latitude), longitude: Number(s.longitude), method: s.ezan_method, asr: s.ezan_asr === "hanafi" ? "hanafi" : "standard", adjust } as never);
      const next = (["fajr", "dhuhr", "asr", "maghrib", "isha"] as const).map((p) => [p, pt[p]] as const).find(([, t]) => kind === "evening" || t > Date.now());
      if (next) items.push({ kind: "prayer", icon: "🕌", text: lang === "tr" ? `${kind === "evening" ? "Yarın s" : "S"}ıradaki namaz: ${PRAYER_TR[next[0]]} ${hm(next[1])}` : `${kind === "evening" ? "Morgen eerste gebed" : "Volgend gebed"}: ${PRAYER_NL[next[0]]} om ${hm(next[1])}` });
    } catch { /* */ }
  }
  // aftellen en verjaardagen
  for (const c of countdowns(members, 6).filter((c) => c.days <= 3 && (!me || !c.memberId || c.memberId === me.id)).slice(0, 2)) items.push({ kind: "countdown", icon: c.icon, text: c.days === 0 ? (lang === "tr" ? `Bugün: ${c.title}!` : `Vandaag: ${c.title}!`) : c.days === 1 ? (lang === "tr" ? `Yarın: ${c.title}` : `Morgen: ${c.title}`) : (lang === "tr" ? `${c.days} gün sonra: ${c.title}` : `Over ${c.days} dagen: ${c.title}`) });
  // voorraad en boodschappen (alleen voor ouders of het hele gezin)
  if (!me || me.role === "ouder") {
    const pantry = (S.pantryList()?.items ?? []).filter((i) => !i.done && i.expires && i.expires <= addDays(date, 1));
    if (pantry.length) items.push({ kind: "pantry", icon: "🥫", text: lang === "tr" ? `Son kullanma yaklaşıyor: ${pantry.map((i) => i.text).join(", ")}.` : `Bijna over datum: ${pantry.map((i) => i.text).join(", ")}.` });
    const shop = S.listLists().find((l) => l.kind === "shopping"); const n = shop?.items.filter((i) => !i.done).length ?? 0;
    if (n >= 5 && kind === "morning") items.push({ kind: "list", icon: "🛒", text: lang === "tr" ? `Alışveriş listesinde ${n} ürün var.` : `${n} dingen op de boodschappenlijst.` });
  }
  // conflicten
  const conf = conflictProposals(evs.filter((e) => !me || e.members.includes(me.id)), me ? [me] : members, lang);
  proposals.push(...conf.proposals);
  const name = me?.name ?? s.family_name;
  const title = kind === "morning" ? (lang === "tr" ? `Günaydın${name ? `, ${name}` : ""}` : `Goeiemorgen${name ? `, ${name}` : ""}`) : (lang === "tr" ? `İyi akşamlar${name ? `, ${name}` : ""}` : `Goeienavond${name ? `, ${name}` : ""}`);
  const b: Briefing = { kind, date, memberId: me?.id ?? null, title, narration: "", items, proposals, conflicts: conf.count };
  b.narration = await narrate(b, lang, me?.name ?? null, focus);
  return b;
}

const cache = new Map<string, { at: number; text: string }>();
async function narrate(b: Briefing, lang: "nl" | "tr", name: string | null, focus: string): Promise<string> {
  const key = `${hid()}|${b.kind}|${b.date}|${b.memberId}|${b.items.map((i) => i.text).join(";")}|${b.proposals.length}`;
  const hit = cache.get(key); if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.text;
  let text = template(b, lang, name, focus);
  if (aiReady()) {
    try {
      const client = getClient()!;
      const r = await client.messages.create({ model: MODEL, max_tokens: 300, output_config: { effort: "low" } as never,
        system: lang === "tr" ? "Sen bir ailenin mutfak ekranındaki yardımcısın. Aşağıdaki notları 2-4 kısa, sıcak, konuşma dilinde Türkçe cümleyle anlat; sesli okunacak. Yeni bilgi ekleme, saatleri ve isimleri aynen koru, emoji ve başlık kullanma." : "Je bent de assistent op het keukenscherm van een gezin. Vertel de notities hieronder in 2 tot 4 korte, warme spreektaalzinnen in het Nederlands (Vlaams mag); ze worden voorgelezen. Voeg niets toe, houd uren en namen exact, geen emoji en geen titel.",
        messages: [{ role: "user", content: `${b.title}.\n${b.items.map((i) => `- ${i.text}`).join("\n")}${b.proposals.length ? `\nVoorstellen die de gebruiker kan aanvaarden: ${b.proposals.map((p) => p.title).join("; ")}.` : ""}${memoryContext() ? `\n${memoryContext()}` : ""}` }] });
      const out = r.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join(" ").trim();
      if (out) text = out;
    } catch { /* sjabloon volstaat */ }
  }
  cache.set(key, { at: Date.now(), text });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return text;
}
function template(b: Briefing, lang: "nl" | "tr", name: string | null, focus: string): string {
  const ev = b.items.filter((i) => i.kind === "event"), rest = b.items.filter((i) => i.kind !== "event");
  const day = lang === "tr" ? DAYS_TR[weekday(focus)] : DAYS_NL[weekday(focus)];
  const parts: string[] = [];
  if (lang === "tr") {
    parts.push(b.kind === "morning" ? `${b.title}! Bugün ${day}.` : `${b.title}. Yarın ${day}.`);
    parts.push(ev.length ? `${ev.length} plan var: ${ev.map((e) => e.text).join("; ")}.` : (b.kind === "morning" ? pick(["Bugün plan yok, sakin bir gün.", "Takvim boş; keyfini çıkar."]) : "Yarın için plan yok."));
  } else {
    parts.push(b.kind === "morning" ? `${b.title}! Het is ${day}.` : `${b.title}. Morgen is het ${day}.`);
    parts.push(ev.length ? `${ev.length === 1 ? "Eén afspraak" : `${ev.length} afspraken`}: ${ev.map((e) => e.text).join("; ")}.` : (b.kind === "morning" ? pick(["Geen afspraken vandaag, een rustige dag.", "De agenda is leeg; geniet ervan."]) : "Morgen staat er niets gepland."));
  }
  for (const r of rest) parts.push(r.text.endsWith(".") || r.text.endsWith("!") ? r.text : r.text + ".");
  if (b.proposals.length) parts.push(lang === "tr" ? `${b.proposals.length} önerim var.` : `Ik heb ${b.proposals.length === 1 ? "een voorstel" : `${b.proposals.length} voorstellen`} voor je.`);
  return parts.join(" ");
}

// ---------- voorstellen uitvoeren ----------
export const ProposalInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("plan_meal"), date: z.string(), slot: z.enum(["diner", "lunch", "ontbijt"]), recipeId: z.string(), recipe: z.string() }),
  z.object({ kind: z.literal("move_event"), eventId: z.string(), on: z.string(), newStart: z.string(), newEnd: z.string() }),
  z.object({ kind: z.literal("add_list"), items: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal("remind"), text: z.string(), memberId: z.string().nullable() }),
]);
export function applyProposal(p: z.infer<typeof ProposalInput>): { ok: true; message: string; topics: ("meals" | "events" | "lists")[] } {
  if (p.kind === "plan_meal") { S.setMeal(p.date, p.slot, p.recipe, p.recipeId); return { ok: true, message: `Gepland: ${p.recipe}`, topics: ["meals"] }; }
  if (p.kind === "move_event") {
    const ev = getEvent(p.eventId); if (!ev) throw new Error("Die afspraak bestaat niet meer.");
    if (ev.readOnly) throw new Error("Deze afspraak komt uit een gekoppelde agenda.");
    updateEvent(p.eventId, { ...ev, startTime: p.newStart, endTime: p.newEnd, allDay: false } as never);
    return { ok: true, message: `${ev.title} staat nu om ${p.newStart}`, topics: ["events"] };
  }
  if (p.kind === "add_list") { const id = S.ensureShoppingList(); for (const it of p.items) S.addItem(id, it); return { ok: true, message: `${p.items.length} op de boodschappenlijst`, topics: ["lists"] }; }
  return { ok: true, message: "Genoteerd", topics: [] };
}

// ---------- dagelijks schema: briefing als melding op de telefoons ----------
const sent = new Set<string>();
export function startManagerScheduler() {
  const tick = async () => {
    const now = new Date(); const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`; const d = today();
    for (const h of all<{ id: string }>("SELECT id FROM households")) {
      await withCtx({ userId: "", householdId: h.id } as never, async () => {
        const s = getSettings(h.id);
        if (s.briefing_push !== "1") return;
        for (const kind of ["morning", "evening"] as const) {
          const at = kind === "morning" ? s.briefing_morning : s.briefing_evening;
          if (!at || at !== hhmm) continue;
          const key = `${h.id}|${d}|${kind}`; if (sent.has(key)) continue; sent.add(key);
          broadcastTo(h.id, ["settings"]); // hubs verversen de briefingkaart
          const rows = all<{ user_id: string; member_id: string | null }>("SELECT user_id, member_id FROM household_users WHERE household_id=?", h.id);
          for (const r of rows) {
            try {
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
// usersFor wordt elders gebruikt voor meldingen aan ouders van een kind
export { usersFor };
