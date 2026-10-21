// Gezinsnetwerk: gezinnen die met elkaar verbonden zijn (oma, co-ouderschap, familie in het buitenland).
// Elk gezin kiest zelf wat het met het andere deelt; het andere huis ziet dat op zijn eigen Bord.
import { z } from "zod";
import { all, get, run, newId, hid } from "./db.js";
import { rowsBetween, toEvent, expand } from "./events.js";
import { today, addDays } from "./dates.js";

export const SHARE_KINDS = ["events", "photos", "notes", "birthdays"] as const;
export type ShareKind = typeof SHARE_KINDS[number];
const ALL_SHARE = SHARE_KINDS.join(",");

export interface Link { id: string; otherId: string; otherName: string; myShare: ShareKind[]; theirShare: ShareKind[]; createdAt: string }
type Row = { id: string; a: string; b: string; a_share: string; b_share: string; created_at: string };

const parseShare = (s: string) => s.split(",").filter((x): x is ShareKind => (SHARE_KINDS as readonly string[]).includes(x));

export function listLinks(h = hid()): Link[] {
  return all<Row>("SELECT id, a, b, a_share, b_share, created_at FROM household_links WHERE a=? OR b=? ORDER BY created_at", h, h).map((r) => {
    const mine = r.a === h; const other = mine ? r.b : r.a;
    return { id: r.id, otherId: other, otherName: get<{ name: string }>("SELECT name FROM households WHERE id=?", other)?.name ?? "Gezin", myShare: parseShare(mine ? r.a_share : r.b_share), theirShare: parseShare(mine ? r.b_share : r.a_share), createdAt: r.created_at };
  });
}
export const linkedHouseholdIds = (h: string) => all<{ a: string; b: string }>("SELECT a, b FROM household_links WHERE a=? OR b=?", h, h).map((r) => (r.a === h ? r.b : r.a));

export function createLink(a: string, b: string) {
  if (a === b) throw new Error("Een gezin kan niet met zichzelf verbinden.");
  const ex = get<{ id: string }>("SELECT id FROM household_links WHERE (a=? AND b=?) OR (a=? AND b=?)", a, b, b, a);
  if (ex) return ex.id;
  const id = newId();
  run("INSERT INTO household_links(id, a, b, a_share, b_share) VALUES (?,?,?,?,?)", id, a, b, ALL_SHARE, ALL_SHARE);
  return id;
}
export function setMyShare(linkId: string, share: ShareKind[], h = hid()) {
  const r = get<Row>("SELECT id, a, b, a_share, b_share, created_at FROM household_links WHERE id=? AND (a=? OR b=?)", linkId, h, h);
  if (!r) return false;
  run(`UPDATE household_links SET ${r.a === h ? "a_share" : "b_share"}=? WHERE id=?`, share.join(","), linkId);
  return true;
}
export const deleteLink = (linkId: string, h = hid()) => run("DELETE FROM household_links WHERE id=? AND (a=? OR b=?)", linkId, h, h);

export interface FamilyCard {
  linkId: string; household: string; name: string;
  members: { id: string; name: string; color: string; avatar: string; photo: string | null }[];
  events: { on: string; title: string; startTime: string | null; endTime: string | null; allDay: boolean; members: string[] }[];
  birthdays: { name: string; date: string; days: number; age: number | null }[];
  photos: { id: string; filename: string; householdId: string }[];
  notes: { id: string; text: string; color: string; author: string | null; createdAt: string; pinned: boolean }[];
  shares: ShareKind[];
}
/** Wat de verbonden gezinnen met ons delen: voor het Bord en Mijn dag. */
export function familyFeed(h = hid()): FamilyCard[] {
  const t = today(); const to = addDays(t, 7);
  return listLinks(h).map((l) => {
    const other = l.otherId; const sh = new Set(l.theirShare);
    const members = all<{ id: string; name: string; color: string; avatar: string; photo: string | null; birthday: string | null }>("SELECT id, name, color, avatar, photo, birthday FROM members WHERE household_id=? ORDER BY sort, rowid", other);
    const events = sh.has("events") ? rowsBetween(other, t, to).map(toEvent).flatMap((e) => expand(e, t, to)).sort((a, b) => a.on.localeCompare(b.on) || Number(b.allDay) - Number(a.allDay) || (a.startTime ?? "").localeCompare(b.startTime ?? "")).slice(0, 12).map((o) => ({ on: o.on, title: o.title, startTime: o.startTime, endTime: o.endTime, allDay: o.allDay, members: o.members })) : [];
    const birthdays = sh.has("birthdays") ? members.filter((m) => m.birthday).map((m) => { const [, mm, dd] = m.birthday!.split("-").map(Number); const y = Number(t.slice(0, 4)); let next = `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`; if (next < t) next = `${y + 1}${next.slice(4)}`; const days = Math.round((Date.parse(next) - Date.parse(t)) / 864e5); return { name: m.name, date: next, days, age: Number(next.slice(0, 4)) - Number(m.birthday!.slice(0, 4)) || null }; }).filter((b) => b.days <= 30).sort((a, b) => a.days - b.days) : [];
    const photos = sh.has("photos") ? all<{ id: string; filename: string }>("SELECT id, filename FROM photos WHERE household_id=? ORDER BY created_at DESC LIMIT 6", other).map((p) => ({ ...p, householdId: other })) : [];
    const notes = sh.has("notes") ? all<{ id: string; text: string; color: string; author: string | null; member_id: string | null; created_at: string; pinned: number }>("SELECT n.id, n.text, n.color, n.author, n.member_id, n.created_at, n.pinned FROM notes n WHERE n.household_id=? ORDER BY n.pinned DESC, n.created_at DESC LIMIT 4", other)
      .map((n) => ({ id: n.id, text: n.text, color: n.color, author: n.author ?? (n.member_id ? members.find((m) => m.id === n.member_id)?.name ?? null : null), createdAt: n.created_at, pinned: !!n.pinned })) : [];
    return { linkId: l.id, household: other, name: l.otherName, members: members.map(({ id, name, color, avatar, photo }) => ({ id, name, color, avatar, photo })), events, birthdays, photos, notes, shares: l.theirShare };
  });
}
/** Mag dit gezin die foto van het andere huis zien? */
export function canSeePhoto(h: string, filename: string): boolean {
  const owner = get<{ household_id: string }>("SELECT household_id FROM photos WHERE filename=?", filename)?.household_id;
  if (!owner) return false;
  if (owner === h) return true;
  return listLinks(h).some((l) => l.otherId === owner && l.theirShare.includes("photos"));
}

export const FamilyNoteInput = z.object({ text: z.string().trim().min(1).max(500), color: z.string().max(10).default("geel"), author: z.string().trim().max(60).default("") });
/** Een briefje naar het andere huis: komt op hun prikbord met de naam van het gezin erbij. */
export function sendFamilyNote(linkId: string, i: z.infer<typeof FamilyNoteInput>, h = hid()): string | null {
  const l = listLinks(h).find((x) => x.id === linkId);
  if (!l) return null;
  const myName = get<{ name: string }>("SELECT name FROM households WHERE id=?", h)?.name ?? "Familie";
  const id = newId();
  run("INSERT INTO notes(id, household_id, member_id, text, color, pinned, from_household, author) VALUES (?,?,?,?,?,?,?,?)", id, l.otherId, null, i.text, i.color, 0, h, `${i.author ? `${i.author} · ` : ""}${myName}`);
  return l.otherId;
}
