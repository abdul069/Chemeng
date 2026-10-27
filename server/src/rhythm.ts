// Ritme per persoon: eigen taal, een ploegenrooster dat je één keer instelt, stille uren (ook vanzelf na een nachtdienst)
// en doelen voor tieners in plaats van sterren.
import { z } from "zod";
import { db, all, get, run, newId, hid, addColumn, getSettings } from "./db.js";
import { addDays, diffDays, weekday } from "./dates.js";
import type { Occurrence } from "./events.js";
import { asLang, type Lang } from "./i18n.js";

// ---------- per gezinslid ----------
addColumn("members", "lang", "TEXT NOT NULL DEFAULT ''");
// tienermodus: '' = vanzelf vanaf 13 jaar, '1' = aan, '0' = uit
addColumn("members", "teen", "TEXT NOT NULL DEFAULT ''");
addColumn("members", "quiet_from", "TEXT NOT NULL DEFAULT ''");
addColumn("members", "quiet_until", "TEXT NOT NULL DEFAULT ''");
addColumn("members", "sleep_hours", "INTEGER NOT NULL DEFAULT 8");

db.exec(`
-- een kind dat ook lid is van een verbonden gezin (co-ouderschap): taken, sterren en agenda lopen in beide huizen door
CREATE TABLE IF NOT EXISTS member_shares (
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (member_id, household_id)
);
CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  weeks TEXT NOT NULL,
  until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  title TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '🎯', kind TEXT NOT NULL DEFAULT 'count',
  target REAL NOT NULL, unit TEXT NOT NULL DEFAULT '', due TEXT, done_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS goal_entries (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  amount REAL NOT NULL, note TEXT NOT NULL DEFAULT '', date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

/** Taal van een gezinslid; leeg = de taal van het gezin. */
export function langOf(memberId: string | null | undefined, h = hid()): Lang {
  const own = memberId ? get<{ lang: string }>("SELECT lang FROM members WHERE id=?", memberId)?.lang : "";
  return asLang(own || getSettings(h).language);
}
/** Taal van een gebruiker in dit gezin (via het profiel waaraan het account hangt). */
export function langOfUser(userId: string, h: string): Lang {
  const m = get<{ member_id: string | null }>("SELECT member_id FROM household_users WHERE household_id=? AND user_id=?", h, userId)?.member_id;
  return langOf(m, h);
}

export const ageOf = (birthday: string | null | undefined, on = new Date()) => (birthday ? Math.floor((on.getTime() - Date.parse(birthday)) / (365.25 * 864e5)) : null);
export const isTeen = (m: { teen?: string; birthday: string | null; role: string }) =>
  m.role === "kind" && (m.teen === "1" || (m.teen !== "0" && (ageOf(m.birthday) ?? 0) >= 13));

// ---------- ploegenrooster ----------
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const ShiftWeek = z.object({ name: z.string().trim().min(1).max(40), icon: z.string().max(8).default("🏭"), start: time.nullable(), end: time.nullable(), days: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]) });
export const ShiftInput = z.object({ memberId: z.string(), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), weeks: z.array(ShiftWeek).min(1).max(8), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() });
export type ShiftWeekT = z.infer<typeof ShiftWeek>;
export interface Shift { id: string; memberId: string; startDate: string; weeks: ShiftWeekT[]; until: string | null }
type ShiftRow = { id: string; member_id: string; start_date: string; weeks: string; until: string | null };
const toShift = (r: ShiftRow): Shift => ({ id: r.id, memberId: r.member_id, startDate: r.start_date, weeks: JSON.parse(r.weeks), until: r.until });

/** Kant-en-klare roosters; de gebruiker kiest er één en past de uren aan. */
export const SHIFT_PRESETS: Record<string, { label: string; weeks: ShiftWeekT[] }> = {
  drie: { label: "3 ploegen (vroeg, laat, nacht)", weeks: [
    { name: "Vroege dienst", icon: "🌅", start: "06:00", end: "14:00", days: [1, 2, 3, 4, 5] },
    { name: "Late dienst", icon: "🌇", start: "14:00", end: "22:00", days: [1, 2, 3, 4, 5] },
    { name: "Nachtdienst", icon: "🌙", start: "22:00", end: "06:00", days: [1, 2, 3, 4, 5] },
  ] },
  twee: { label: "2 ploegen (vroeg, laat)", weeks: [
    { name: "Vroege dienst", icon: "🌅", start: "06:00", end: "14:00", days: [1, 2, 3, 4, 5] },
    { name: "Late dienst", icon: "🌇", start: "14:00", end: "22:00", days: [1, 2, 3, 4, 5] },
  ] },
  dag: { label: "Dagdienst met een vrije week", weeks: [
    { name: "Dagdienst", icon: "🏭", start: "08:00", end: "16:30", days: [1, 2, 3, 4, 5] },
    { name: "Vrije week", icon: "🏖️", start: null, end: null, days: [] },
  ] },
};

export const listShifts = (h = hid()) => all<ShiftRow>("SELECT id, member_id, start_date, weeks, until FROM shifts WHERE household_id=? ORDER BY created_at", h).map(toShift);
export function saveShift(i: z.infer<typeof ShiftInput>, id?: string, h = hid()): Shift {
  if (!get("SELECT 1 FROM members WHERE id=? AND household_id=?", i.memberId, h)) throw new Error("Onbekend gezinslid");
  // de cyclus begint op een maandag, zodat "week 1" overeenkomt met een echte week
  const start = addDays(i.startDate, -((weekday(i.startDate) + 6) % 7));
  if (id && get("SELECT 1 FROM shifts WHERE id=? AND household_id=?", id, h)) run("UPDATE shifts SET member_id=?, start_date=?, weeks=?, until=? WHERE id=?", i.memberId, start, JSON.stringify(i.weeks), i.until ?? null, id);
  else { id = newId(); run("INSERT INTO shifts(id, household_id, member_id, start_date, weeks, until) VALUES (?,?,?,?,?,?)", id, h, i.memberId, start, JSON.stringify(i.weeks), i.until ?? null); }
  return listShifts(h).find((s) => s.id === id)!;
}
export const deleteShift = (id: string, h = hid()) => run("DELETE FROM shifts WHERE id=? AND household_id=?", id, h);

/** Welke week van de cyclus valt op deze datum (null vóór de start of na het einde)? */
export function shiftWeekOn(s: Shift, date: string): ShiftWeekT | null {
  if (date < s.startDate || (s.until && date > s.until)) return null;
  const idx = Math.floor(diffDays(s.startDate, date) / 7) % s.weeks.length;
  return s.weeks[idx] ?? null;
}
const toMin = (t: string) => { const [a, b] = t.split(":").map(Number); return a * 60 + b; };
const hhmm = (n: number) => `${String(Math.floor(((n % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(((n % 60) + 60) % 60).padStart(2, "0")}`;

/** Diensten als blokken in de agenda. Een nachtdienst wordt twee blokken: tot middernacht en de ochtend erna. */
export function shiftOccurrences(from: string, to: string, h = hid()): Occurrence[] {
  const out: Occurrence[] = [];
  for (const s of listShifts(h)) {
    for (let d = addDays(from, -1); d <= to; d = addDays(d, 1)) {
      const w = shiftWeekOn(s, d);
      if (!w || !w.start || !w.end || !w.days.includes(weekday(d))) continue;
      const night = toMin(w.end) <= toMin(w.start);
      const base = { notes: "", location: "", endDate: null, allDay: false, repeat: "none" as const, repeatUntil: null, exdates: [], members: [s.memberId], source: "ploeg", readOnly: true, countdown: false };
      if (d >= from) out.push({ ...base, id: `shift:${s.id}:${d}`, key: `shift:${s.id}@${d}`, title: night ? `${w.icon} ${w.name} (tot ${w.end})` : `${w.icon} ${w.name}`, date: d, on: d, until: d, startTime: w.start, endTime: night ? "23:59" : w.end });
      if (night && w.end !== "00:00") { const n = addDays(d, 1); if (n >= from && n <= to) out.push({ ...base, id: `shift:${s.id}:${d}:n`, key: `shift:${s.id}@${n}:n`, title: `${w.icon} ${w.name}`, date: n, on: n, until: n, startTime: "00:00", endTime: w.end }); }
    }
  }
  return out;
}

// ---------- stille uren ----------
export interface QuietWindow { memberId: string; from: string; until: string; reason: "manual" | "night" }
/** Stille vensters van een gezinslid die op deze dag beginnen, in minuten vanaf middernacht (einde mag na 24u). */
function windowsStarting(memberId: string, date: string, h: string): { s: number; e: number; reason: QuietWindow["reason"] }[] {
  const m = get<{ quiet_from: string; quiet_until: string; sleep_hours: number }>("SELECT quiet_from, quiet_until, sleep_hours FROM members WHERE id=?", memberId);
  if (!m) return [];
  const out: { s: number; e: number; reason: QuietWindow["reason"] }[] = [];
  if (m.quiet_from && m.quiet_until) { const s = toMin(m.quiet_from); let e = toMin(m.quiet_until); if (e <= s) e += 1440; out.push({ s, e, reason: "manual" }); }
  // na een nachtdienst (die gisteren begon en vandaag 's ochtends eindigt) slaapt men vanaf het einde van de dienst
  for (const s of listShifts(h).filter((x) => x.memberId === memberId)) {
    const y = addDays(date, -1); const w = shiftWeekOn(s, y);
    if (!w || !w.start || !w.end || !w.days.includes(weekday(y))) continue;
    if (toMin(w.end) <= toMin(w.start) && toMin(w.end) <= 12 * 60) out.push({ s: toMin(w.end), e: toMin(w.end) + Math.max(4, Math.min(12, m.sleep_hours || 8)) * 60, reason: "night" });
  }
  return out;
}
/** Is dit gezinslid nu in stille uren? Geeft het einde terug ("14:00") of null. */
export function quietNow(memberId: string, now = new Date(), h = hid()): QuietWindow | null {
  const date = localDate(now); const min = now.getHours() * 60 + now.getMinutes();
  for (const [d, shift] of [[date, 0], [addDays(date, -1), 1440]] as const) {
    for (const w of windowsStarting(memberId, d, h)) {
      const s = w.s - shift, e = w.e - shift;
      if (min >= s && min < e) return { memberId, from: hhmm(w.s), until: hhmm(w.e), reason: w.reason };
    }
  }
  return null;
}
export const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Iedereen van het gezin die nu slaapt of stil wil zijn. */
export function quietMembers(now = new Date(), h = hid()): QuietWindow[] {
  return all<{ id: string }>("SELECT id FROM members WHERE household_id=?", h).map((m) => quietNow(m.id, now, h)).filter((x): x is QuietWindow => !!x);
}
/** Gebruikers die nu geen melding mogen krijgen (hun profiel in eender welk gezin is stil). */
export function quietUsers(userIds: string[], now = new Date()): Set<string> {
  const out = new Set<string>();
  if (!userIds.length) return out;
  for (const r of all<{ user_id: string; member_id: string | null; household_id: string }>(`SELECT user_id, member_id, household_id FROM household_users WHERE member_id IS NOT NULL AND user_id IN (${userIds.map(() => "?").join(",")})`, ...userIds)) {
    if (r.member_id && quietNow(r.member_id, now, r.household_id)) out.add(r.user_id);
  }
  return out;
}

// ---------- doelen voor tieners ----------
export const GoalInput = z.object({ memberId: z.string(), title: z.string().trim().min(1).max(80), icon: z.string().max(16).default("🎯"), kind: z.enum(["money", "count"]).default("count"), target: z.number().positive().max(1_000_000), unit: z.string().max(20).default(""), due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() });
export const GoalEntryInput = z.object({ amount: z.number().min(-1_000_000).max(1_000_000), note: z.string().max(120).default(""), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
export interface Goal { id: string; memberId: string; title: string; icon: string; kind: "money" | "count"; target: number; unit: string; due: string | null; doneAt: string | null; progress: number; entries: { id: string; amount: number; note: string; date: string }[] }
/** Voorbeelden die een tiener met één tik kan kiezen. */
export const GOAL_TEMPLATES = [
  { title: "Rijlessen", icon: "🚗", kind: "count", target: 20, unit: "lessen" },
  { title: "Theorie-examen oefenen", icon: "📘", kind: "count", target: 30, unit: "testen" },
  { title: "Sparen", icon: "💶", kind: "money", target: 500, unit: "€" },
  { title: "Stage-uren", icon: "🔧", kind: "count", target: 120, unit: "uur" },
  { title: "Boeken lezen", icon: "📚", kind: "count", target: 12, unit: "boeken" },
  { title: "Sporten", icon: "🏃", kind: "count", target: 50, unit: "keer" },
] as const;

const visibleMember = (memberId: string, h: string) => !!get("SELECT 1 FROM members WHERE id=? AND household_id=? UNION SELECT 1 FROM member_shares WHERE member_id=? AND household_id=?", memberId, h, memberId, h);
export function listGoals(memberId?: string, h = hid()): Goal[] {
  const rows = all<{ id: string; member_id: string; title: string; icon: string; kind: Goal["kind"]; target: number; unit: string; due: string | null; done_at: string | null }>(
    `SELECT g.id, g.member_id, g.title, g.icon, g.kind, g.target, g.unit, g.due, g.done_at FROM goals g WHERE (g.household_id=? OR g.member_id IN (SELECT id FROM members WHERE household_id=?) OR g.member_id IN (SELECT member_id FROM member_shares WHERE household_id=?))${memberId ? " AND g.member_id=?" : ""} ORDER BY g.done_at IS NOT NULL, g.created_at`,
    h, h, h, ...(memberId ? [memberId] : []));
  return rows.map((r) => {
    const entries = all<{ id: string; amount: number; note: string; date: string }>("SELECT id, amount, note, date FROM goal_entries WHERE goal_id=? ORDER BY date DESC, created_at DESC", r.id);
    return { id: r.id, memberId: r.member_id, title: r.title, icon: r.icon, kind: r.kind, target: r.target, unit: r.unit, due: r.due, doneAt: r.done_at, progress: entries.reduce((s, e) => s + e.amount, 0), entries };
  });
}
export function createGoal(i: z.infer<typeof GoalInput>, h = hid()): Goal {
  if (!visibleMember(i.memberId, h)) throw new Error("Onbekend gezinslid");
  const id = newId();
  run("INSERT INTO goals(id, household_id, member_id, title, icon, kind, target, unit, due) VALUES (?,?,?,?,?,?,?,?,?)", id, h, i.memberId, i.title, i.icon, i.kind, i.target, i.unit, i.due ?? null);
  return listGoals(i.memberId, h).find((g) => g.id === id)!;
}
const ownsGoal = (id: string, h: string) => { const g = get<{ member_id: string }>("SELECT member_id FROM goals WHERE id=?", id); return !!g && visibleMember(g.member_id, h); };
export function deleteGoal(id: string, h = hid()) { if (ownsGoal(id, h)) run("DELETE FROM goals WHERE id=?", id); }
export function addGoalEntry(goalId: string, i: z.infer<typeof GoalEntryInput>, h = hid()) {
  if (!ownsGoal(goalId, h)) throw new Error("Onbekend doel");
  run("INSERT INTO goal_entries(id, goal_id, amount, note, date) VALUES (?,?,?,?,?)", newId(), goalId, i.amount, i.note, i.date);
  const g = listGoals(undefined, h).find((x) => x.id === goalId)!;
  run("UPDATE goals SET done_at=? WHERE id=?", g.progress >= g.target ? (g.doneAt ?? new Date().toISOString()) : null, goalId);
  return listGoals(undefined, h).find((x) => x.id === goalId)!;
}
export function deleteGoalEntry(entryId: string, h = hid()) {
  const e = get<{ goal_id: string }>("SELECT goal_id FROM goal_entries WHERE id=?", entryId);
  if (!e || !ownsGoal(e.goal_id, h)) return;
  run("DELETE FROM goal_entries WHERE id=?", entryId);
  const g = listGoals(undefined, h).find((x) => x.id === e.goal_id);
  if (g && g.progress < g.target) run("UPDATE goals SET done_at=NULL WHERE id=?", g.id);
}
