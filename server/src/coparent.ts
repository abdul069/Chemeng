// Co-ouderschap: kinderen die in twee verbonden gezinnen wonen. Verblijfsregeling (bij wie zijn de kinderen),
// kinderen als lid van beide huizen, een overdrachtslijst per kind, een gedeelde kostenpot en afspraken over en weer.
import { z } from "zod";
import { db, all, get, run, newId, hid } from "./db.js";
import { addDays, diffDays } from "./dates.js";
import { rowsBetween, toEvent, expand, type Occurrence } from "./events.js";
import { listLinks } from "./family.js";
import { shiftOccurrences } from "./rhythm.js";

db.exec(`
CREATE TABLE IF NOT EXISTS custody (
  link_id TEXT PRIMARY KEY REFERENCES household_links(id) ON DELETE CASCADE,
  cycle TEXT NOT NULL,
  anchor TEXT NOT NULL,
  handover_time TEXT NOT NULL DEFAULT '16:00',
  split_a INTEGER NOT NULL DEFAULT 50,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS custody_overrides (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL REFERENCES household_links(id) ON DELETE CASCADE,
  from_date TEXT NOT NULL, to_date TEXT NOT NULL, household_id TEXT NOT NULL, note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS handover_items (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  text TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '🎒', sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS handover_checks (
  item_id TEXT NOT NULL REFERENCES handover_items(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  PRIMARY KEY (item_id, date)
);
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL REFERENCES household_links(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL,
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'cost',
  title TEXT NOT NULL, amount INTEGER NOT NULL, date TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const hhName = (id: string) => get<{ name: string }>("SELECT name FROM households WHERE id=?", id)?.name ?? "Gezin";
const linkRow = (linkId: string) => get<{ id: string; a: string; b: string }>("SELECT id, a, b FROM household_links WHERE id=?", linkId);
function myLink(linkId: string, h: string) {
  const l = linkRow(linkId);
  if (!l || (l.a !== h && l.b !== h)) throw new Error("Deze verbinding hoort niet bij jullie gezin.");
  return l;
}

// ---------- kinderen in twee gezinnen ----------
/** Profielen die in dit gezin zichtbaar zijn: de eigen leden plus de kinderen die een verbonden gezin met ons deelt. */
export const visibleMemberIds = (h = hid()) => all<{ id: string }>("SELECT id FROM members WHERE household_id=? UNION SELECT member_id AS id FROM member_shares WHERE household_id=?", h, h).map((r) => r.id);
export const isVisibleMember = (memberId: string, h = hid()) => !!get("SELECT 1 FROM members WHERE id=? AND household_id=? UNION SELECT 1 FROM member_shares WHERE member_id=? AND household_id=?", memberId, h, memberId, h);
/** Welke van onze kinderen zijn ook lid van het andere gezin van deze verbinding? */
export function sharedKids(linkId: string, h = hid()): { memberId: string; home: string; guestIn: string }[] {
  const l = myLink(linkId, h);
  return all<{ member_id: string; home: string; household_id: string }>(
    "SELECT s.member_id, m.household_id AS home, s.household_id FROM member_shares s JOIN members m ON m.id = s.member_id WHERE (m.household_id=? AND s.household_id=?) OR (m.household_id=? AND s.household_id=?)",
    l.a, l.b, l.b, l.a).map((r) => ({ memberId: r.member_id, home: r.home, guestIn: r.household_id }));
}
/** Zet een eigen kind ook in het andere gezin (of haal het er weer uit). Alleen het thuisgezin van het kind beslist. */
export function setMemberShared(linkId: string, memberId: string, on: boolean, h = hid()) {
  const l = myLink(linkId, h); const other = l.a === h ? l.b : l.a;
  if (!get("SELECT 1 FROM members WHERE id=? AND household_id=?", memberId, h)) throw new Error("Alleen het eigen gezin van het kind kan het delen.");
  if (on) run("INSERT OR IGNORE INTO member_shares(member_id, household_id) VALUES (?,?)", memberId, other);
  else run("DELETE FROM member_shares WHERE member_id=? AND household_id=?", memberId, other);
  return other;
}
/** Het thuisgezin en het naam van de kinderen die in dit gezin te gast zijn. */
export function guestMembers(h = hid()) {
  return all<{ id: string; name: string; color: string; avatar: string; photo: string | null; role: "ouder" | "kind" | "huisdier"; sort: number; birthday: string | null; diet: string; lang: string; teen: string; quiet_from: string; quiet_until: string; sleep_hours: number; home: string }>(
    "SELECT m.id, m.name, m.color, m.avatar, m.photo, m.role, m.sort, m.birthday, m.diet, m.lang, m.teen, m.quiet_from, m.quiet_until, m.sleep_hours, m.household_id AS home FROM member_shares s JOIN members m ON m.id = s.member_id WHERE s.household_id=? ORDER BY m.sort, m.name", h);
}
/** Afspraken van het andere huis waarin onze gedeelde kinderen staan (alleen-lezen hier). */
export function otherHouseEvents(from: string, to: string, h = hid()): Occurrence[] {
  const pairs = all<{ member_id: string; other: string }>(
    `SELECT s.member_id, s.household_id AS other FROM member_shares s JOIN members m ON m.id = s.member_id WHERE m.household_id=?
     UNION SELECT s.member_id, m.household_id AS other FROM member_shares s JOIN members m ON m.id = s.member_id WHERE s.household_id=?`, h, h);
  const byHouse = new Map<string, Set<string>>();
  for (const p of pairs) { if (!byHouse.has(p.other)) byHouse.set(p.other, new Set()); byHouse.get(p.other)!.add(p.member_id); }
  const out: Occurrence[] = [];
  for (const [other, kids] of byHouse) {
    const name = hhName(other);
    for (const r of rowsBetween(other, from, to)) {
      const ev = toEvent(r);
      const mine = ev.members.filter((m) => kids.has(m));
      if (!mine.length) continue;
      for (const o of expand(ev, from, to)) out.push({ ...o, id: `oh:${o.id}`, key: `oh:${o.key}`, members: mine, notes: o.notes ? `${o.notes}\n\n${name}` : name, source: "anderhuis", readOnly: true });
    }
  }
  return out;
}

// ---------- verblijfsregeling ----------
/** Een cyclus is een rij van a en b (a = het gezin dat de verbinding maakte), te beginnen op de ankerdag. */
export const CUSTODY_PRESETS: Record<string, { label: string; cycle: string }> = {
  week: { label: "Week om week", cycle: "aaaaaaabbbbbbb" },
  "2-2-3": { label: "2-2-3 (om de beurt het weekend)", cycle: "aabbaaabbaabbb" },
  weekend: { label: "Om het weekend bij de andere ouder", cycle: "aaaaaaaaaaabbb" },
  "5-2": { label: "Week bij de ene, weekend bij de andere", cycle: "aaaaabb" },
};
export const CustodyInput = z.object({
  cycle: z.string().regex(/^[ab]{1,28}$/),
  anchor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** wie heeft de kinderen op de ankerdag: wij of zij */
  startWithMe: z.boolean().default(true),
  handoverTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("16:00"),
  /** mijn deel van de kosten in procent */
  mySplit: z.number().int().min(0).max(100).default(50),
});
export interface Custody { linkId: string; cycle: string; anchor: string; handoverTime: string; mySplit: number; meIsA: boolean }
export function getCustody(linkId: string, h = hid()): Custody | null {
  const l = myLink(linkId, h);
  const r = get<{ cycle: string; anchor: string; handover_time: string; split_a: number }>("SELECT cycle, anchor, handover_time, split_a FROM custody WHERE link_id=?", linkId);
  if (!r) return null;
  const meIsA = l.a === h;
  // de cyclus wordt bewaard vanuit a; vanuit b keren we hem om, zodat "a" in het antwoord altijd "wij" betekent
  return { linkId, cycle: meIsA ? r.cycle : flip(r.cycle), anchor: r.anchor, handoverTime: r.handover_time, mySplit: meIsA ? r.split_a : 100 - r.split_a, meIsA };
}
const flip = (c: string) => c.replace(/[ab]/g, (x) => (x === "a" ? "b" : "a"));
export function setCustody(linkId: string, i: z.infer<typeof CustodyInput>, h = hid()) {
  const l = myLink(linkId, h); const meIsA = l.a === h;
  const mine = i.startWithMe ? i.cycle : flip(i.cycle);
  const cycleA = meIsA ? mine : flip(mine);
  run("INSERT INTO custody(link_id, cycle, anchor, handover_time, split_a) VALUES (?,?,?,?,?) ON CONFLICT(link_id) DO UPDATE SET cycle=excluded.cycle, anchor=excluded.anchor, handover_time=excluded.handover_time, split_a=excluded.split_a, updated_at=datetime('now')",
    linkId, cycleA, i.anchor, i.handoverTime, meIsA ? i.mySplit : 100 - i.mySplit);
  return [l.a, l.b];
}
export const deleteCustody = (linkId: string, h = hid()) => { const l = myLink(linkId, h); run("DELETE FROM custody WHERE link_id=?", linkId); return [l.a, l.b]; };

export const OverrideInput = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), withMe: z.boolean(), note: z.string().max(80).default("") });
export function addOverride(linkId: string, i: z.infer<typeof OverrideInput>, h = hid()) {
  const l = myLink(linkId, h);
  if (i.to < i.from) throw new Error("De einddatum ligt voor de begindatum.");
  run("INSERT INTO custody_overrides(id, link_id, from_date, to_date, household_id, note) VALUES (?,?,?,?,?,?)", newId(), linkId, i.from, i.to, i.withMe ? h : (l.a === h ? l.b : l.a), i.note);
  return [l.a, l.b];
}
export const listOverrides = (linkId: string, h = hid()) => { myLink(linkId, h); return all<{ id: string; from_date: string; to_date: string; household_id: string; note: string }>("SELECT id, from_date, to_date, household_id, note FROM custody_overrides WHERE link_id=? ORDER BY from_date", linkId).map((o) => ({ id: o.id, from: o.from_date, to: o.to_date, withMe: o.household_id === h, note: o.note })); };
export const deleteOverride = (id: string, h = hid()) => { const o = get<{ link_id: string }>("SELECT link_id FROM custody_overrides WHERE id=?", id); if (!o) return []; const l = myLink(o.link_id, h); run("DELETE FROM custody_overrides WHERE id=?", id); return [l.a, l.b]; };

export const handoverTime = (linkId: string) => get<{ handover_time: string }>("SELECT handover_time FROM custody WHERE link_id=?", linkId)?.handover_time ?? "";
/** Bij welk gezin zijn de kinderen van deze verbinding op die dag? */
export function custodyHousehold(linkId: string, date: string): string | null {
  const l = linkRow(linkId); if (!l) return null;
  const r = get<{ cycle: string; anchor: string }>("SELECT cycle, anchor FROM custody WHERE link_id=?", linkId); if (!r) return null;
  const o = get<{ household_id: string }>("SELECT household_id FROM custody_overrides WHERE link_id=? AND from_date<=? AND to_date>=? ORDER BY rowid DESC LIMIT 1", linkId, date, date);
  if (o) return o.household_id;
  const n = r.cycle.length; const i = ((diffDays(r.anchor, date) % n) + n) % n;
  return r.cycle[i] === "a" ? l.a : l.b;
}
export interface CustodyDay { linkId: string; otherId: string; otherName: string; kids: string[]; withUs: boolean; handover: { date: string; time: string; toUs: boolean } | null; handoverToday: boolean; until: string | null }
/** Stand van zaken per verbinding met een verblijfsregeling: waar zijn de kinderen, en wanneer is de volgende overdracht? */
export function custodyToday(date: string, h = hid()): CustodyDay[] {
  const out: CustodyDay[] = [];
  for (const l of listLinks(h)) {
    const c = get<{ handover_time: string }>("SELECT handover_time FROM custody WHERE link_id=?", l.id); if (!c) continue;
    const here = custodyHousehold(l.id, date); const before = custodyHousehold(l.id, addDays(date, -1));
    let next: CustodyDay["handover"] = null; let until: string | null = null;
    for (let d = addDays(date, 1), i = 0; i < 120; i++, d = addDays(d, 1)) {
      const w = custodyHousehold(l.id, d);
      if (w !== here) { next = { date: d, time: c.handover_time, toUs: w === h }; until = addDays(d, -1); break; }
    }
    out.push({ linkId: l.id, otherId: l.otherId, otherName: l.otherName, kids: sharedKids(l.id, h).map((k) => k.memberId), withUs: here === h, handover: next, handoverToday: here !== before, until });
  }
  return out;
}
/** Is dit gedeelde kind die dag in dit gezin? (true als er geen regeling is) */
export function isPresent(memberId: string, date: string, h = hid()): boolean {
  for (const l of listLinks(h)) {
    if (!sharedKids(l.id, h).some((k) => k.memberId === memberId)) continue;
    const w = custodyHousehold(l.id, date);
    if (w) return w === h;
  }
  return true;
}
/** De regeling als blokken in de agenda: "Bij papa" van maandag tot vrijdag. */
export function custodyOccurrences(from: string, to: string, h = hid()): Occurrence[] {
  const out: Occurrence[] = [];
  for (const l of listLinks(h)) {
    const kids = sharedKids(l.id, h).map((k) => k.memberId);
    if (!kids.length || !get("SELECT 1 FROM custody WHERE link_id=?", l.id)) continue;
    let start = from; let cur = custodyHousehold(l.id, from);
    const push = (s: string, e: string, who: string | null) => {
      if (!who) return;
      out.push({ id: `custody:${l.id}:${s}`, key: `custody:${l.id}@${s}`, title: `🏠 Bij ${hhName(who)}`, notes: "", location: "", date: s, endDate: e > s ? e : null, startTime: null, endTime: null, allDay: true, repeat: "none", repeatUntil: null, exdates: [], members: kids, source: "verblijf", readOnly: true, countdown: false, on: s, until: e });
    };
    for (let d = addDays(from, 1); d <= addDays(to, 1); d = addDays(d, 1)) {
      const w = d > to ? "__end" : custodyHousehold(l.id, d);
      if (w !== cur) { push(start, addDays(d, -1), cur); start = d; cur = w as string; }
    }
  }
  return out;
}

// ---------- overdrachtslijst ----------
export const HandoverItemInput = z.object({ memberId: z.string(), text: z.string().trim().min(1).max(60), icon: z.string().max(16).default("🎒") });
export function addHandoverItem(i: z.infer<typeof HandoverItemInput>, h = hid()) {
  if (!isVisibleMember(i.memberId, h)) throw new Error("Onbekend gezinslid");
  const sort = get<{ n: number }>("SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM handover_items WHERE member_id=?", i.memberId)?.n ?? 0;
  const id = newId(); run("INSERT INTO handover_items(id, member_id, text, icon, sort) VALUES (?,?,?,?,?)", id, i.memberId, i.text, i.icon, sort);
  return id;
}
const ownsItem = (id: string, h: string) => { const r = get<{ member_id: string }>("SELECT member_id FROM handover_items WHERE id=?", id); return !!r && isVisibleMember(r.member_id, h); };
export function deleteHandoverItem(id: string, h = hid()) { if (ownsItem(id, h)) run("DELETE FROM handover_items WHERE id=?", id); }
export function checkHandoverItem(id: string, date: string, done: boolean, h = hid()) {
  if (!ownsItem(id, h)) return;
  if (done) run("INSERT OR IGNORE INTO handover_checks(item_id, date) VALUES (?,?)", id, date);
  else run("DELETE FROM handover_checks WHERE item_id=? AND date=?", id, date);
}
/** Gezinnen die dit lijstje ook zien: het thuisgezin van het kind en de gezinnen waar het te gast is. */
export function householdsOfMember(memberId: string): string[] {
  const home = get<{ household_id: string }>("SELECT household_id FROM members WHERE id=?", memberId)?.household_id;
  return [...new Set([...(home ? [home] : []), ...all<{ household_id: string }>("SELECT household_id FROM member_shares WHERE member_id=?", memberId).map((r) => r.household_id)])];
}
export interface HandoverKid { memberId: string; items: { id: string; text: string; icon: string; done: boolean }[] }
export function handoverFor(date: string, h = hid()): { date: string; handoverToday: boolean; time: string | null; kids: HandoverKid[] } {
  const ids = visibleMemberIds(h);
  const cus = custodyToday(date, h).filter((c) => c.handoverToday);
  const kids = ids.map((memberId) => ({ memberId, items: all<{ id: string; text: string; icon: string; done: number }>(
    "SELECT i.id, i.text, i.icon, EXISTS(SELECT 1 FROM handover_checks c WHERE c.item_id = i.id AND c.date=?) AS done FROM handover_items i WHERE i.member_id=? ORDER BY i.sort, i.created_at", date, memberId)
    .map((r) => ({ id: r.id, text: r.text, icon: r.icon, done: !!r.done })) })).filter((k) => k.items.length);
  const time = cus.length ? get<{ handover_time: string }>("SELECT handover_time FROM custody WHERE link_id=?", cus[0].linkId)?.handover_time ?? null : null;
  return { date, handoverToday: cus.length > 0, time, kids };
}

// ---------- gedeelde kostenpot ----------
export const ExpenseInput = z.object({ title: z.string().trim().min(1).max(80), amount: z.number().positive().max(100000), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), memberId: z.string().nullable().optional(), kind: z.enum(["cost", "settle"]).default("cost"), note: z.string().max(200).default("") });
export interface Expense { id: string; title: string; amount: number; date: string; memberId: string | null; kind: "cost" | "settle"; note: string; paidByMe: boolean; payer: string }
export function addExpense(linkId: string, i: z.infer<typeof ExpenseInput>, h = hid()) {
  const l = myLink(linkId, h);
  run("INSERT INTO expenses(id, link_id, household_id, member_id, kind, title, amount, date, note) VALUES (?,?,?,?,?,?,?,?,?)", newId(), linkId, h, i.memberId ?? null, i.kind, i.title, Math.round(i.amount * 100), i.date, i.note);
  return [l.a, l.b];
}
export function deleteExpense(id: string, h = hid()) {
  const e = get<{ link_id: string; household_id: string }>("SELECT link_id, household_id FROM expenses WHERE id=?", id);
  if (!e) return [];
  const l = myLink(e.link_id, h);
  if (e.household_id !== h) throw new Error("Alleen wie de kost ingaf, kan ze verwijderen.");
  run("DELETE FROM expenses WHERE id=?", id);
  return [l.a, l.b];
}
/** Alle kosten van de verbinding en het saldo: positief = het andere gezin is ons geld schuldig. */
export function costPot(linkId: string, h = hid()): { items: Expense[]; mySplit: number; balance: number; totalThisYear: number; otherName: string } {
  const l = myLink(linkId, h);
  const c = get<{ split_a: number }>("SELECT split_a FROM custody WHERE link_id=?", linkId);
  const mySplit = (l.a === h ? c?.split_a ?? 50 : 100 - (c?.split_a ?? 50)) / 100;
  const rows = all<{ id: string; household_id: string; member_id: string | null; kind: "cost" | "settle"; title: string; amount: number; date: string; note: string }>("SELECT id, household_id, member_id, kind, title, amount, date, note FROM expenses WHERE link_id=? ORDER BY date DESC, created_at DESC", linkId);
  let bal = 0; let year = 0; const y = new Date().getFullYear().toString();
  for (const r of rows) {
    const mine = r.household_id === h;
    if (r.kind === "settle") bal += mine ? r.amount : -r.amount;
    else { bal += mine ? r.amount * (1 - mySplit) : -r.amount * mySplit; if (r.date.startsWith(y)) year += r.amount; }
  }
  return {
    items: rows.map((r) => ({ id: r.id, title: r.title, amount: r.amount / 100, date: r.date, memberId: r.member_id, kind: r.kind, note: r.note, paidByMe: r.household_id === h, payer: hhName(r.household_id) })),
    mySplit: Math.round(mySplit * 100), balance: Math.round(bal) / 100, totalThisYear: year / 100, otherName: hhName(l.a === h ? l.b : l.a),
  };
}

// ---------- ouderpoort: pincode van de andere ouder ----------
/** Een pincode van een verbonden gezin waarmee dit kind gedeeld is, telt ook op de kindertablet (beperkte rechten). */
export function otherParentPinOk(memberId: string, pin: string): boolean {
  if (!pin) return false;
  return all<{ household_id: string }>("SELECT household_id FROM member_shares WHERE member_id=?", memberId)
    .some((r) => get<{ value: string }>("SELECT value FROM settings WHERE household_id=? AND key='settings_pin'", r.household_id)?.value === pin);
}

/** Lagen bovenop de eigen agenda: diensten, de verblijfsregeling en afspraken van het andere huis voor onze kinderen. */
export const layerEvents = (from: string, to: string, h = hid()): Occurrence[] => [...shiftOccurrences(from, to, h), ...custodyOccurrences(from, to, h), ...otherHouseEvents(from, to, h)];
