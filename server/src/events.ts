import { z } from "zod";
import { all, get, run, newId } from "./db.js";
import { addDays, addMonths, diffDays, isDate } from "./dates.js";

export const REPEATS = ["none", "daily", "weekly", "biweekly", "monthly", "yearly"] as const;

export interface EventRow {
  id: string; title: string; notes: string; location: string;
  date: string; end_date: string | null; start_time: string | null; end_time: string | null;
  all_day: number; repeat: string; repeat_until: string | null; exdates: string; members: string;
  source: string; external_uid: string | null;
}

export interface CalEvent {
  id: string; title: string; notes: string; location: string;
  date: string; endDate: string | null; startTime: string | null; endTime: string | null;
  allDay: boolean; repeat: (typeof REPEATS)[number]; repeatUntil: string | null; exdates: string[];
  members: string[]; source: string; readOnly: boolean;
}

export interface Occurrence extends CalEvent {
  /** Datum waarop deze herhaling valt */
  on: string;
  /** Laatste dag van deze herhaling (meerdaagse afspraken) */
  until: string;
  key: string;
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const EventInput = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(4000).default(""),
  location: z.string().max(300).default(""),
  date: day,
  endDate: day.nullable().optional(),
  startTime: time.nullable().optional(),
  endTime: time.nullable().optional(),
  allDay: z.boolean().default(false),
  repeat: z.enum(REPEATS).default("none"),
  repeatUntil: day.nullable().optional(),
  members: z.array(z.string()).default([]),
});
export type EventInputT = z.infer<typeof EventInput>;

export function toEvent(r: EventRow): CalEvent {
  return {
    id: r.id, title: r.title, notes: r.notes, location: r.location,
    date: r.date, endDate: r.end_date, startTime: r.start_time, endTime: r.end_time,
    allDay: !!r.all_day, repeat: (REPEATS as readonly string[]).includes(r.repeat) ? (r.repeat as CalEvent["repeat"]) : "none",
    repeatUntil: r.repeat_until, exdates: JSON.parse(r.exdates), members: JSON.parse(r.members),
    source: r.source, readOnly: r.source !== "local",
  };
}

function normalize(i: EventInputT) {
  const allDay = i.allDay || !i.startTime;
  let endTime = allDay ? null : i.endTime ?? null;
  if (!allDay && i.startTime && (!endTime || endTime <= i.startTime)) {
    const [h, m] = i.startTime.split(":").map(Number);
    endTime = `${String(Math.min(23, h + 1)).padStart(2, "0")}:${String(h >= 23 ? 59 : m).padStart(2, "0")}`;
  }
  const endDate = i.endDate && i.endDate > i.date ? i.endDate : null;
  return { ...i, allDay, startTime: allDay ? null : i.startTime ?? null, endTime, endDate };
}

export function createEvent(input: EventInputT, source = "local", externalUid: string | null = null): CalEvent {
  const e = normalize(input);
  const id = newId();
  run(
    `INSERT INTO events(id, title, notes, location, date, end_date, start_time, end_time, all_day, repeat, repeat_until, members, source, external_uid)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, e.title, e.notes, e.location, e.date, e.endDate, e.startTime, e.endTime, e.allDay ? 1 : 0,
    e.repeat, e.repeatUntil ?? null, JSON.stringify(e.members), source, externalUid,
  );
  return getEvent(id)!;
}

export function getEvent(id: string): CalEvent | undefined {
  const r = get<EventRow>("SELECT * FROM events WHERE id = ?", id);
  return r && toEvent(r);
}

export function updateEvent(id: string, input: EventInputT): CalEvent | undefined {
  const e = normalize(input);
  run(
    `UPDATE events SET title=?, notes=?, location=?, date=?, end_date=?, start_time=?, end_time=?, all_day=?, repeat=?, repeat_until=?, members=?
     WHERE id=? AND source='local'`,
    e.title, e.notes, e.location, e.date, e.endDate, e.startTime, e.endTime, e.allDay ? 1 : 0,
    e.repeat, e.repeatUntil ?? null, JSON.stringify(e.members), id,
  );
  return getEvent(id);
}

/** Verwijdert één herhaling uit een reeks door ze als uitzondering te bewaren. */
export function skipOccurrence(id: string, on: string) {
  const ev = getEvent(id);
  if (!ev || ev.readOnly) return;
  const ex = Array.from(new Set([...ev.exdates, on])).sort();
  run("UPDATE events SET exdates=? WHERE id=?", JSON.stringify(ex), id);
}

/** Beëindigt een reeks vóór de gegeven datum ("deze en volgende"). */
export function endSeriesBefore(id: string, on: string) {
  const ev = getEvent(id);
  if (!ev || ev.readOnly) return;
  if (on <= ev.date) run("DELETE FROM events WHERE id=?", id);
  else run("UPDATE events SET repeat_until=? WHERE id=?", addDays(on, -1), id);
}

export function deleteEvent(id: string) {
  run("DELETE FROM events WHERE id=? AND source='local'", id);
}

function* starts(ev: CalEvent, from: string, to: string): Generator<string> {
  const last = ev.repeatUntil && ev.repeatUntil < to ? ev.repeatUntil : to;
  const span = ev.endDate ? diffDays(ev.date, ev.endDate) : 0;
  if (ev.repeat === "none") {
    yield ev.date;
    return;
  }
  if (ev.repeat === "daily" || ev.repeat === "weekly" || ev.repeat === "biweekly") {
    const step = ev.repeat === "daily" ? 1 : ev.repeat === "weekly" ? 7 : 14;
    // spring meteen naar de eerste herhaling die nog in het venster kan vallen
    const behind = diffDays(ev.date, addDays(from, -span));
    let d = behind > 0 ? addDays(ev.date, Math.floor(behind / step) * step) : ev.date;
    for (let i = 0; d <= last && i < 2000; i++, d = addDays(d, step)) yield d;
    return;
  }
  const months = ev.repeat === "monthly" ? 1 : 12;
  for (let n = 0; n < 2400; n += months) {
    const d = addMonths(ev.date, n);
    if (d === null) continue;
    if (d > last) return;
    yield d;
  }
}

export function expand(ev: CalEvent, from: string, to: string): Occurrence[] {
  const span = ev.endDate ? diffDays(ev.date, ev.endDate) : 0;
  const out: Occurrence[] = [];
  for (const on of starts(ev, from, to)) {
    const until = addDays(on, span);
    if (until < from || on > to || ev.exdates.includes(on)) continue;
    out.push({ ...ev, on, until, key: `${ev.id}@${on}` });
  }
  return out;
}

export function eventsBetween(from: string, to: string, memberIds?: string[]): Occurrence[] {
  if (!isDate(from) || !isDate(to)) return [];
  const rows = all<EventRow>(
    `SELECT * FROM events WHERE date <= ? AND (
       COALESCE(end_date, date) >= ? OR (repeat != 'none' AND (repeat_until IS NULL OR repeat_until >= ?))
     )`,
    to, from, from,
  );
  const occ = rows.flatMap((r) => expand(toEvent(r), from, to));
  const filtered = memberIds?.length ? occ.filter((o) => !o.members.length || o.members.some((m) => memberIds.includes(m))) : occ;
  return filtered.sort((a, b) =>
    a.on.localeCompare(b.on) || Number(b.allDay) - Number(a.allDay) || (a.startTime ?? "").localeCompare(b.startTime ?? "") || a.title.localeCompare(b.title),
  );
}
