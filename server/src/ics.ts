// Synchroniseert externe agenda's (Google Agenda, Outlook, iCloud) via hun iCal-adres.
import ical, { type VEvent } from "node-ical";
import { run, tx, get } from "./db.js";
import { listCalendars, type CalendarSub } from "./store.js";
import { addDays, today } from "./dates.js";

const TZ = process.env.TZ;
const fmtDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const fmtTime = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const text = (v: unknown) => (typeof v === "string" ? v : v && typeof v === "object" && "val" in v ? String((v as { val: unknown }).val) : "");

export async function syncCalendar(cal: CalendarSub): Promise<number> {
  try {
    const url = cal.url.replace(/^webcal:/i, "https:");
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`De agenda gaf foutcode ${res.status}. Controleer het iCal-adres.`);
    const body = await res.text();
    if (!body.includes("BEGIN:VCALENDAR")) throw new Error("Dit adres geeft geen iCal-agenda terug.");
    const data = ical.sync.parseICS(body);
    const from = new Date(`${addDays(today(), -60)}T00:00:00Z`);
    const to = new Date(`${addDays(today(), 400)}T00:00:00Z`);
    const rows: unknown[][] = [];
    for (const item of Object.values(data)) {
      if (!item || item.type !== "VEVENT") continue;
      const ev = item as VEvent;
      if (ev.status === "CANCELLED") continue;
      for (const inst of ical.expandRecurringEvent(ev, { from, to, expandOngoing: true })) {
        const start = inst.start as Date;
        const end = (inst.end as Date) ?? start;
        const title = text(inst.summary) || "(zonder titel)";
        if (inst.isFullDay) {
          const d = localDate(start);
          // DTEND is exclusief bij hele-dag-afspraken
          const last = addDays(localDate(end), -1);
          rows.push([title, text(inst.event.description), text(inst.event.location), d, last > d ? last : null, null, null, 1, `${ev.uid}@${d}`]);
        } else {
          const d = fmtDate(start);
          const e = fmtDate(end);
          rows.push([title, text(inst.event.description), text(inst.event.location), d, e > d ? e : null, fmtTime(start), e > d ? "23:59" : fmtTime(end), 0, `${ev.uid}@${start.toISOString()}`]);
        }
      }
    }
    tx(() => {
      run("DELETE FROM events WHERE source=?", cal.id);
      for (const r of rows) {
        run(
          `INSERT INTO events(id, title, notes, location, date, end_date, start_time, end_time, all_day, external_uid, members, source)
           VALUES (lower(hex(randomblob(16))),?,?,?,?,?,?,?,?,?,?,?)`,
          ...r, JSON.stringify(cal.members), cal.id,
        );
      }
      run("UPDATE calendars SET last_sync=datetime('now'), last_error=NULL WHERE id=?", cal.id);
    });
    return rows.length;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    run("UPDATE calendars SET last_sync=datetime('now'), last_error=? WHERE id=?", msg, cal.id);
    throw err;
  }
}

export async function syncAll(onChange: () => void) {
  for (const cal of listCalendars()) {
    try {
      await syncCalendar(cal);
    } catch (e) {
      console.warn(`[agenda] ${cal.name}:`, e instanceof Error ? e.message : e);
    }
  }
  onChange();
}

export function removeCalendarEvents(id: string) {
  run("DELETE FROM events WHERE source=?", id);
  return !!get("SELECT 1 FROM calendars WHERE id=?", id);
}
