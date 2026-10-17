// Gezinnen, uitnodigingen en het delen van je eigen agenda met mensen buiten je gezin.
import { z } from "zod";
import { all, get, run, newId, tx } from "./db.js";
import { createMember, createList } from "./store.js";
import { expand, rowsBetween, toEvent, type Occurrence } from "./events.js";
import { hashPassword, randomToken, sha256 } from "./auth.js";

export const COLORS = ["#4a7bd8", "#d9576b", "#4f9e5b", "#8a62d1", "#e08a3c", "#2bb3a8", "#c9a227", "#d36fb3", "#3d9bd1"];
const pickColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

export const RegisterInput = z.object({
  name: z.string().trim().min(1, "Vul je naam in").max(40),
  email: z.string().trim().toLowerCase().email("Dat is geen geldig e-mailadres"),
  password: z.string().min(8, "Kies een wachtwoord van minstens 8 tekens").max(200),
  invite: z.string().optional(),
});

export function createUser(i: { name: string; email: string; password: string }) {
  const id = newId();
  run("INSERT INTO users(id, email, name, password_hash, color) VALUES (?,?,?,?,?)", id, i.email, i.name, hashPassword(i.password), pickColor());
  return id;
}

/** Nieuw gezin met de gebruiker als beheerder en als eerste gezinslid. */
export function createHousehold(userId: string, name: string) {
  const user = get<{ name: string; color: string }>("SELECT name, color FROM users WHERE id=?", userId)!;
  const hid = newId();
  tx(() => {
    run("INSERT INTO households(id, name) VALUES (?,?)", hid, name);
    const m = createMember({ name: user.name, color: user.color, avatar: "🙂", role: "ouder" }, hid);
    run("INSERT INTO household_users(household_id, user_id, role, member_id) VALUES (?,?,?,?)", hid, userId, "beheerder", m.id);
    createList("Boodschappen", "🛒", hid, "shopping");
    createList("To-do", "✅", hid);
    createList("Voorraad", "🥫", hid, "pantry");
  });
  return hid;
}

export function householdsOf(userId: string) {
  return all<{ id: string; name: string; role: string; member_id: string | null }>(
    `SELECT h.id, h.name, hu.role, hu.member_id FROM household_users hu JOIN households h ON h.id = hu.household_id
     WHERE hu.user_id=? ORDER BY hu.rowid`, userId,
  ).map((h) => ({ id: h.id, name: h.name, role: h.role as "beheerder" | "lid", memberId: h.member_id }));
}

// ---------- uitnodigingen ----------
export const InviteInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("household"), memberId: z.string().nullable().optional(), role: z.enum(["beheerder", "lid"]).default("lid"), label: z.string().max(60).default("") }),
  z.object({ kind: z.literal("agenda"), level: z.enum(["details", "bezet"]).default("details"), label: z.string().max(60).default("") }),
]);

export function createInvite(userId: string, householdId: string | null, i: z.infer<typeof InviteInput>) {
  const token = randomToken();
  const id = newId();
  if (i.kind === "household") {
    if (i.memberId) {
      const m = get("SELECT 1 FROM members WHERE id=? AND household_id=?", i.memberId, householdId);
      if (!m) throw new UserError("Dat gezinslid bestaat niet.");
      if (get("SELECT 1 FROM household_users WHERE member_id=?", i.memberId)) throw new UserError("Dit gezinslid is al aan een account gekoppeld.");
    }
    run(
      "INSERT INTO invites(id, token_hash, kind, created_by, household_id, member_id, role, label, expires_at) VALUES (?,?,?,?,?,?,?,?, datetime('now','+7 days'))",
      id, sha256(token), "household", userId, householdId, i.memberId ?? null, i.role, i.label,
    );
  } else {
    if (!linkedMembers(userId).length) throw new UserError("Koppel je account eerst aan je eigen profiel in een gezin; dan weten we welke afspraken van jou zijn.");
    run(
      "INSERT INTO invites(id, token_hash, kind, created_by, role, label, expires_at) VALUES (?,?,?,?,?,?, datetime('now','+7 days'))",
      id, sha256(token), "agenda", userId, i.level, i.label,
    );
  }
  return { id, token };
}

type InviteRow = { id: string; kind: "household" | "agenda"; created_by: string; household_id: string | null; member_id: string | null; role: string; label: string; expires_at: string; used_at: string | null };
function findInvite(token: string) {
  return get<InviteRow>("SELECT * FROM invites WHERE token_hash=?", sha256(token));
}

export function describeInvite(token: string) {
  const inv = findInvite(token);
  if (!inv || (inv.kind as string) === "reset") return { valid: false as const, reason: "Deze uitnodiging bestaat niet." };
  if (inv.used_at) return { valid: false as const, reason: "Deze uitnodiging is al gebruikt." };
  if (get("SELECT 1 WHERE datetime('now') > ?", inv.expires_at)) return { valid: false as const, reason: "Deze uitnodiging is verlopen. Vraag een nieuwe." };
  const from = get<{ name: string }>("SELECT name FROM users WHERE id=?", inv.created_by)?.name ?? "Iemand";
  if (inv.kind === "household") {
    const household = get<{ name: string }>("SELECT name FROM households WHERE id=?", inv.household_id)?.name ?? "";
    const member = inv.member_id ? get<{ name: string }>("SELECT name FROM members WHERE id=?", inv.member_id)?.name : null;
    return { valid: true as const, kind: "household" as const, from, household, member, role: inv.role };
  }
  return { valid: true as const, kind: "agenda" as const, from, level: inv.role };
}

export class UserError extends Error {}

/** Aanvaardt een uitnodiging; geeft het gezin terug waar de gebruiker naartoe moet. */
export function acceptInvite(token: string, userId: string): { householdId: string | null; kind: "household" | "agenda"; ownerId?: string } {
  const d = describeInvite(token);
  if (!d.valid) throw new UserError(d.reason);
  const inv = findInvite(token)!;
  if (inv.created_by === userId) throw new UserError("Dit is je eigen uitnodiging. Stuur de link naar de persoon die je wilt uitnodigen.");
  return tx(() => {
    run("UPDATE invites SET used_by=?, used_at=datetime('now') WHERE id=?", userId, inv.id);
    if (inv.kind === "household") {
      const hid = inv.household_id!;
      const existing = get("SELECT 1 FROM household_users WHERE household_id=? AND user_id=?", hid, userId);
      let memberId = inv.member_id;
      if (memberId && get("SELECT 1 FROM household_users WHERE member_id=?", memberId)) memberId = null;
      if (!memberId && !existing) {
        const u = get<{ name: string; color: string }>("SELECT name, color FROM users WHERE id=?", userId)!;
        memberId = createMember({ name: u.name, color: u.color, avatar: "🙂", role: "ouder" }, hid).id;
      }
      if (existing) {
        if (memberId) run("UPDATE household_users SET member_id=? WHERE household_id=? AND user_id=? AND member_id IS NULL", memberId, hid, userId);
      } else {
        run("INSERT INTO household_users(household_id, user_id, role, member_id) VALUES (?,?,?,?)", hid, userId, inv.role, memberId);
      }
      return { householdId: hid, kind: "household" as const };
    }
    run(
      "INSERT INTO shares(owner_id, viewer_id, level) VALUES (?,?,?) ON CONFLICT(owner_id, viewer_id) DO UPDATE SET level=excluded.level",
      inv.created_by, userId, inv.role,
    );
    return { householdId: null, kind: "agenda" as const, ownerId: inv.created_by };
  });
}

/** Herstel-link voor een gezinslid dat zijn wachtwoord vergat (maakt de beheerder aan). */
export function createResetLink(adminId: string, householdId: string, userId: string) {
  if (!get("SELECT 1 FROM household_users WHERE household_id=? AND user_id=?", householdId, userId)) throw new UserError("Deze persoon hoort niet bij je gezin.");
  const token = randomToken();
  run("INSERT INTO invites(id, token_hash, kind, created_by, household_id, used_by, expires_at) VALUES (?,?,?,?,?,?, datetime('now','+1 day'))", newId(), sha256(token), "reset", adminId, householdId, userId);
  return token;
}
export function resetTarget(token: string): { userId: string; name: string } | null {
  const inv = get<{ used_by: string; used_at: string | null; expires_at: string }>("SELECT used_by, used_at, expires_at FROM invites WHERE token_hash=? AND kind='reset'", sha256(token));
  if (!inv || inv.used_at || get("SELECT 1 WHERE datetime('now') > ?", inv.expires_at)) return null;
  const u = get<{ name: string }>("SELECT name FROM users WHERE id=?", inv.used_by);
  return u ? { userId: inv.used_by, name: u.name } : null;
}
export const consumeReset = (token: string) => run("UPDATE invites SET used_at=datetime('now') WHERE token_hash=?", sha256(token));

export function pendingInvites(userId: string, householdId: string | null) {
  return all<{ id: string; kind: string; member_id: string | null; role: string; label: string; expires_at: string }>(
    `SELECT id, kind, member_id, role, label, expires_at FROM invites
     WHERE used_at IS NULL AND expires_at > datetime('now') AND created_by=? AND kind<>'reset' AND (kind='agenda' OR household_id=?)
     ORDER BY created_at DESC`, userId, householdId,
  ).map((i) => ({ id: i.id, kind: i.kind, memberId: i.member_id, role: i.role, label: i.label, expiresAt: i.expires_at }));
}

// ---------- agenda delen ----------
/** De profielen waarmee een gebruiker in gezinnen gekoppeld is. */
export const linkedMembers = (userId: string) =>
  all<{ household_id: string; member_id: string }>("SELECT household_id, member_id FROM household_users WHERE user_id=? AND member_id IS NOT NULL", userId);

export function sharingOverview(userId: string) {
  const viewers = all<{ id: string; name: string; email: string; level: string }>(
    "SELECT u.id, u.name, u.email, s.level FROM shares s JOIN users u ON u.id = s.viewer_id WHERE s.owner_id=? ORDER BY u.name", userId,
  );
  const following = all<{ id: string; name: string; email: string; level: string }>(
    "SELECT u.id, u.name, u.email, s.level FROM shares s JOIN users u ON u.id = s.owner_id WHERE s.viewer_id=? ORDER BY u.name", userId,
  );
  const sharedBack = new Set(viewers.map((v) => v.id));
  return { viewers, following: following.map((f) => ({ ...f, iShareBack: sharedBack.has(f.id) })) };
}

export interface SharedPerson { id: string; userId: string; name: string; color: string; avatar: string; photo: string | null; role: "ouder"; sort: number; shared: true; level: string }

/** Mensen buiten het gezin die hun agenda met deze gebruiker delen. */
export function sharedPeople(viewerId: string, householdId: string): SharedPerson[] {
  const rows = all<{ owner_id: string; level: string; name: string; color: string }>(
    "SELECT s.owner_id, s.level, u.name, u.color FROM shares s JOIN users u ON u.id = s.owner_id WHERE s.viewer_id=? ORDER BY u.name", viewerId,
  );
  return rows
    // wie al in hetzelfde gezin zit, zie je daar al volledig
    .filter((r) => !get("SELECT 1 FROM household_users WHERE household_id=? AND user_id=?", householdId, r.owner_id))
    .map((r, i) => {
      const m = get<{ avatar: string; photo: string | null }>(
        "SELECT m.avatar, m.photo FROM household_users hu JOIN members m ON m.id = hu.member_id WHERE hu.user_id=? ORDER BY hu.rowid LIMIT 1", r.owner_id,
      );
      return { id: `u:${r.owner_id}`, userId: r.owner_id, name: r.name, color: r.color, avatar: m?.avatar || r.name.charAt(0).toUpperCase(), photo: m?.photo ?? null, role: "ouder" as const, sort: 1000 + i, shared: true as const, level: r.level };
    });
}

export const FAMILY_TITLE = "Niet beschikbaar – familiale reden";

/** Afspraken van gedeelde agenda's: alleen afspraken waar de eigenaar zelf aan deelneemt. */
export function sharedEvents(viewerId: string, householdId: string, from: string, to: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const p of sharedPeople(viewerId, householdId)) {
    for (const link of linkedMembers(p.userId)) {
      if (link.household_id === householdId) continue;
      for (const row of rowsBetween(link.household_id, from, to)) {
        const ev = toEvent(row);
        if (!ev.members.includes(link.member_id)) continue;
        // met andere gezinsleden (kind, partner): wel zichtbaar als niet beschikbaar, zonder details over het gezin
        const withFamily = ev.members.some((m) => m !== link.member_id);
        const title = p.level === "bezet" ? "Bezet" : withFamily ? FAMILY_TITLE : null;
        for (const o of expand(ev, from, to)) {
          out.push({
            ...o, id: `shared:${o.id}`, key: `shared:${o.key}`, title: title ?? o.title, notes: title ? "" : o.notes, location: title ? "" : o.location,
            members: [p.id], source: "shared", readOnly: true, exdates: [],
          });
        }
      }
    }
  }
  return out;
}

/** Mag deze gebruiker dit fotobestand zien? (eigen gezin, of profielfoto van iemand die deelt) */
export function canSeePhoto(userId: string, filename: string): boolean {
  const own = get(
    `SELECT 1 FROM household_users hu WHERE hu.user_id=? AND (
       EXISTS (SELECT 1 FROM photos p WHERE p.household_id = hu.household_id AND p.filename = ?)
       OR EXISTS (SELECT 1 FROM members m WHERE m.household_id = hu.household_id AND m.photo = ?)
       OR EXISTS (SELECT 1 FROM memos mm WHERE mm.household_id = hu.household_id AND mm.filename = ?)
       OR EXISTS (SELECT 1 FROM recipes r WHERE r.household_id = hu.household_id AND r.image = ?)
       OR EXISTS (SELECT 1 FROM meals ml WHERE ml.household_id = hu.household_id AND ml.image = ?))`,
    userId, filename, filename, filename, `/api/photos/file/${filename}`, `/api/photos/file/${filename}`,
  );
  if (own) return true;
  return !!get(
    `SELECT 1 FROM shares s JOIN household_users hu ON hu.user_id = s.owner_id JOIN members m ON m.id = hu.member_id
     WHERE s.viewer_id=? AND m.photo=?`, userId, filename,
  );
}

/** Gebruikers die meekijken in de agenda van iemand uit dit gezin (voor live updates). */
export function viewersOfHousehold(householdId: string): string[] {
  return all<{ viewer_id: string }>(
    "SELECT DISTINCT s.viewer_id FROM shares s JOIN household_users hu ON hu.user_id = s.owner_id WHERE hu.household_id=?", householdId,
  ).map((r) => r.viewer_id);
}
