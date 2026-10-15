// Accounts en sessies: inloggen met e-mail en wachtwoord, sessie in een httpOnly-cookie.
import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { get, run, all, withCtx } from "./db.js";

export const COOKIE = "gb_session";
const MAX_AGE_DAYS = 180;

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, s, k] = stored.split("$");
  if (alg !== "scrypt" || !s || !k) return false;
  const key = Buffer.from(k, "base64");
  const test = crypto.scryptSync(pw, Buffer.from(s, "base64"), key.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(key, test);
}

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const randomToken = () => crypto.randomBytes(32).toString("base64url");

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export interface SessionUser { id: string; email: string; name: string; color: string }
export interface Session { tokenHash: string; user: SessionUser; householdId: string | null }

/** Leest de sessie uit de cookie en kiest het actieve gezin. */
export function sessionFromCookie(cookieHeader: string | undefined): Session | null {
  const token = parseCookies(cookieHeader)[COOKIE];
  if (!token) return null;
  const tokenHash = sha256(token);
  const row = get<{ user_id: string; household_id: string | null; last_seen: string }>(
    "SELECT user_id, household_id, last_seen FROM sessions WHERE token_hash=? AND last_seen > datetime('now', ?)", tokenHash, `-${MAX_AGE_DAYS} days`,
  );
  if (!row) return null;
  const user = get<SessionUser>("SELECT id, email, name, color FROM users WHERE id=?", row.user_id);
  if (!user) return null;
  const memberships = all<{ household_id: string }>("SELECT household_id FROM household_users WHERE user_id=? ORDER BY rowid", user.id).map((r) => r.household_id);
  const householdId = row.household_id && memberships.includes(row.household_id) ? row.household_id : memberships[0] ?? null;
  // niet bij elk verzoek schrijven: één keer per uur volstaat
  run("UPDATE sessions SET last_seen=datetime('now'), household_id=? WHERE token_hash=? AND (last_seen < datetime('now','-1 hour') OR household_id IS NOT ?)", householdId, tokenHash, householdId);
  return { tokenHash, user, householdId };
}

export function startSession(res: Response, req: Request, userId: string, householdId: string | null) {
  const token = randomToken();
  run("INSERT INTO sessions(token_hash, user_id, household_id) VALUES (?,?,?)", sha256(token), userId, householdId);
  run("DELETE FROM sessions WHERE last_seen < datetime('now', ?)", `-${MAX_AGE_DAYS} days`);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: MAX_AGE_DAYS * 864e5, path: "/" });
}

export function endSession(req: Request, res: Response) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) run("DELETE FROM sessions WHERE token_hash=?", sha256(token));
  res.clearCookie(COOKIE, { path: "/" });
}

declare module "express-serve-static-core" {
  interface Request { session?: Session }
}

/** Vereist een ingelogde gebruiker (zonder gezin is ook goed). */
export function requireUser(req: Request, res: Response, next: NextFunction) {
  const s = sessionFromCookie(req.headers.cookie);
  if (!s) return void res.status(401).json({ error: "Meld je aan om verder te gaan.", code: "login" });
  req.session = s;
  next();
}

/** Vereist een actief gezin en zet de context voor alle gegevens. */
export function requireHousehold(req: Request, res: Response, next: NextFunction) {
  const s = req.session!;
  if (!s.householdId) return void res.status(409).json({ error: "Je hoort nog bij geen gezin.", code: "no_household" });
  withCtx({ userId: s.user.id, householdId: s.householdId }, next);
}

export function isAdmin(userId: string, householdId: string) {
  return get<{ role: string }>("SELECT role FROM household_users WHERE user_id=? AND household_id=?", userId, householdId)?.role === "beheerder";
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const s = req.session!;
  if (!s.householdId || !isAdmin(s.user.id, s.householdId)) return void res.status(403).json({ error: "Alleen een beheerder van het gezin kan dit." });
  next();
}

// eenvoudige rem op wachtwoord raden
const attempts = new Map<string, { n: number; until: number }>();
export function tooManyAttempts(key: string): boolean {
  const a = attempts.get(key);
  return !!a && a.n >= 8 && a.until > Date.now();
}
export function noteFailure(key: string) {
  const a = attempts.get(key);
  if (!a || a.until < Date.now()) attempts.set(key, { n: 1, until: Date.now() + 15 * 60_000 });
  else a.n++;
}
export const clearFailures = (key: string) => attempts.delete(key);
