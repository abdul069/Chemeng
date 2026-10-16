import express, { type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { z, ZodError } from "zod";
import { PHOTO_DIR, getSettings, setSettings, run, get, newId, hid, ctx, all } from "./db.js";
import {
  EventInput, countdowns, createEvent, deleteEvent, endSeriesBefore, eventsBetween, getEvent, skipOccurrence, updateEvent,
} from "./events.js";
import * as S from "./store.js";
import { broadcast, broadcastTo, notifyUsers } from "./realtime.js";
import { getWeather, geocode } from "./weather.js";
import { syncAll, syncCalendar } from "./ics.js";
import { chat, assistantAvailable, MODEL } from "./assistant.js";
import {
  clearFailures, endSession, isAdmin, noteFailure, requireAdmin, requireHousehold, requireUser, startSession, tooManyAttempts, verifyPassword, hashPassword,
} from "./auth.js";
import * as A from "./accounts.js";
import { seedDemo } from "./seed.js";
import { fetchRecipe, searchTurkishRecipes, translateRecipe, RecipeError, aiAvailable } from "./recipes.js";
import { findDishPhotos, fillMissingPhotos } from "./dishphotos.js";
import * as L from "./library.js";
import { extractEvents, parseQuickAdd, importAvailable, Proposal } from "./importer.js";
import { VAPID_PUBLIC, subscribe, unsubscribe, subscriptionsOf, notifyHousehold, pushToUsers } from "./push.js";
import { isDate, today, addDays } from "./dates.js";

export const api = express.Router();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const p = (req: Request) => req.params.id as string;
const inviteUrl = (req: Request, token: string) => `${req.protocol}://${req.get("host")}/uitnodiging/${token}`;

api.get("/health", (_req, res) => { res.json({ ok: true }); });

// eenvoudige rem op aanmaken van accounts per adres
const regHits = new Map<string, { n: number; until: number }>();
api.use("/auth/register", (req, res, next) => {
  const a = regHits.get(req.ip ?? "") ?? { n: 0, until: Date.now() + 3600_000 };
  if (a.until < Date.now()) { a.n = 0; a.until = Date.now() + 3600_000; }
  if (++a.n > 20) return void res.status(429).json({ error: "Te veel accounts in korte tijd. Probeer het later opnieuw." });
  regHits.set(req.ip ?? "", a);
  next();
});



// ---------- aanmelden ----------
api.post("/auth/register", (req, res) => {
  const b = A.RegisterInput.parse(req.body);
  if (get("SELECT 1 FROM users WHERE email=?", b.email)) return void res.status(409).json({ error: "Er bestaat al een account met dit e-mailadres. Meld je aan." });
  const invite = b.invite ? A.describeInvite(b.invite) : null;
  if (invite && !invite.valid) return void res.status(400).json({ error: invite.reason });
  const userId = A.createUser(b);
  let householdId: string | null = null;
  // wie in een gezin uitgenodigd wordt, krijgt geen eigen leeg gezin
  if (invite?.valid && invite.kind === "household") householdId = A.acceptInvite(b.invite!, userId).householdId;
  else {
    householdId = A.createHousehold(userId, `Gezin ${b.name}`);
    if (invite?.valid && invite.kind === "agenda") {
      const r = A.acceptInvite(b.invite!, userId);
      if (r.ownerId) notifyUsers([r.ownerId], ["sharing"]);
    }
  }
  startSession(res, req, userId, householdId);
  res.json({ ok: true });
});

api.post("/auth/login", (req, res) => {
  const b = z.object({ email: z.string().trim().toLowerCase(), password: z.string() }).parse(req.body);
  const key = `${req.ip}|${b.email}`;
  if (tooManyAttempts(key)) return void res.status(429).json({ error: "Te veel pogingen. Probeer het over een kwartier opnieuw." });
  const u = get<{ id: string; password_hash: string }>("SELECT id, password_hash FROM users WHERE email=?", b.email);
  if (!u || !verifyPassword(b.password, u.password_hash)) {
    noteFailure(key);
    return void res.status(401).json({ error: "E-mailadres of wachtwoord klopt niet." });
  }
  clearFailures(key);
  startSession(res, req, u.id, A.householdsOf(u.id)[0]?.id ?? null);
  res.json({ ok: true });
});

api.post("/auth/logout", (req, res) => { endSession(req, res); res.json({ ok: true }); });

api.get("/invites/:token", (req, res) => { res.json(A.describeInvite(req.params.token as string)); });

api.get("/reset/:token", (req, res) => {
  const t = A.resetTarget(req.params.token as string);
  res.json(t ? { valid: true, name: t.name } : { valid: false, reason: "Deze herstel-link is niet (meer) geldig. Vraag de beheerder van je gezin om een nieuwe." });
});
api.post("/reset/:token", (req, res) => {
  const t = A.resetTarget(req.params.token as string);
  if (!t) return void res.status(400).json({ error: "Deze herstel-link is niet (meer) geldig." });
  const pw = z.object({ password: z.string().min(8, "Kies een wachtwoord van minstens 8 tekens").max(200) }).parse(req.body).password;
  run("UPDATE users SET password_hash=? WHERE id=?", hashPassword(pw), t.userId);
  run("DELETE FROM sessions WHERE user_id=?", t.userId);
  A.consumeReset(req.params.token as string);
  startSession(res, req, t.userId, A.householdsOf(t.userId)[0]?.id ?? null);
  res.json({ ok: true });
});

api.use(requireUser);

api.get("/auth/me", (req, res) => {
  const s = req.session!;
  res.json({ user: s.user, households: A.householdsOf(s.user.id), householdId: s.householdId });
});

api.post("/invites/:token/accept", (req, res) => {
  const s = req.session!;
  const r = A.acceptInvite(req.params.token as string, s.user.id);
  if (r.householdId) {
    run("UPDATE sessions SET household_id=? WHERE token_hash=?", r.householdId, s.tokenHash);
    broadcastTo(r.householdId, ["members", "access"]);
  }
  if (r.ownerId) notifyUsers([r.ownerId], ["sharing"]);
  res.json(r);
});

// ---------- account ----------
api.put("/account", (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }).parse(req.body);
  run("UPDATE users SET name=?, color=COALESCE(?, color) WHERE id=?", b.name, b.color ?? null, req.session!.user.id);
  res.json({ ok: true });
});
api.put("/account/password", (req, res) => {
  const b = z.object({ current: z.string(), next: z.string().min(8, "Kies een wachtwoord van minstens 8 tekens").max(200) }).parse(req.body);
  const u = get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id=?", req.session!.user.id)!;
  if (!verifyPassword(b.current, u.password_hash)) return void res.status(400).json({ error: "Je huidige wachtwoord klopt niet." });
  run("UPDATE users SET password_hash=? WHERE id=?", hashPassword(b.next), req.session!.user.id);
  run("DELETE FROM sessions WHERE user_id=? AND token_hash<>?", req.session!.user.id, req.session!.tokenHash);
  res.json({ ok: true });
});

// ---------- gezinnen ----------
api.post("/households", (req, res) => {
  const name = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body).name;
  const id = A.createHousehold(req.session!.user.id, name);
  run("UPDATE sessions SET household_id=? WHERE token_hash=?", id, req.session!.tokenHash);
  res.json({ id });
});
api.post("/households/switch", (req, res) => {
  const id = z.object({ householdId: z.string() }).parse(req.body).householdId;
  if (!A.householdsOf(req.session!.user.id).some((h) => h.id === id)) return void res.status(403).json({ error: "Je hoort niet bij dit gezin." });
  run("UPDATE sessions SET household_id=? WHERE token_hash=?", id, req.session!.tokenHash);
  res.json({ ok: true });
});

// ---------- pushmeldingen ----------
api.get("/push/key", (req, res) => { res.json({ key: VAPID_PUBLIC, devices: subscriptionsOf(req.session!.user.id) }); });
api.post("/push/subscribe", (req, res) => {
  const b = z.object({ subscription: z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }).passthrough(), label: z.string().max(80).default("") }).parse(req.body);
  subscribe(req.session!.user.id, b.subscription as { endpoint: string; keys: { p256dh: string; auth: string } }, b.label);
  res.json({ ok: true });
});
api.post("/push/unsubscribe", (req, res) => {
  unsubscribe(req.session!.user.id, z.object({ endpoint: z.string() }).parse(req.body).endpoint);
  res.json({ ok: true });
});
api.post("/push/test", async (req, res) => {
  await pushToUsers([req.session!.user.id], { title: "Gezinsbord", body: "Meldingen werken op dit toestel. 🎉", url: "/#today", tag: "test" });
  res.json({ ok: true });
});

// ---------- agenda delen ----------
api.get("/sharing", (req, res) => { res.json(A.sharingOverview(req.session!.user.id)); });
const Level = z.object({ level: z.enum(["details", "bezet"]) });
api.put("/sharing/viewers/:id", (req, res) => {
  run("UPDATE shares SET level=? WHERE owner_id=? AND viewer_id=?", Level.parse(req.body).level, req.session!.user.id, p(req));
  res.json({ ok: true });
  notifyUsers([p(req)], ["sharing", "events"]);
});
api.delete("/sharing/viewers/:id", (req, res) => {
  run("DELETE FROM shares WHERE owner_id=? AND viewer_id=?", req.session!.user.id, p(req));
  res.json({ ok: true });
  notifyUsers([p(req)], ["sharing", "events"]);
});
api.delete("/sharing/following/:id", (req, res) => {
  run("DELETE FROM shares WHERE owner_id=? AND viewer_id=?", p(req), req.session!.user.id);
  res.json({ ok: true });
  notifyUsers([p(req)], ["sharing"]);
});
// mijn agenda terug delen met iemand die de zijne al met mij deelt
api.post("/sharing/share-back/:id", (req, res) => {
  const me = req.session!.user.id;
  if (!get("SELECT 1 FROM shares WHERE owner_id=? AND viewer_id=?", p(req), me)) return void res.status(400).json({ error: "Je kunt alleen terugdelen met iemand die zijn agenda met jou deelt. Stuur anders een uitnodiging." });
  if (!A.linkedMembers(me).length) return void res.status(400).json({ error: "Koppel je account eerst aan je eigen profiel in je gezin." });
  run("INSERT INTO shares(owner_id, viewer_id, level) VALUES (?,?,?) ON CONFLICT(owner_id, viewer_id) DO UPDATE SET level=excluded.level", me, p(req), Level.parse(req.body).level);
  res.json({ ok: true });
  notifyUsers([p(req)], ["sharing", "events"]);
});

// ---------- foto's bekijken (eigen gezin of profielfoto van wie deelt) ----------
api.get("/photos/file/:name", (req, res) => {
  const name = path.basename(req.params.name as string);
  if (!A.canSeePhoto(req.session!.user.id, name)) return void res.status(404).end();
  res.sendFile(path.join(PHOTO_DIR, name), { maxAge: "30d" }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// uitnodiging maken: voor je agenda kan dat ook zonder actief gezin
api.post("/invites", (req, res, next) => {
  const b = A.InviteInput.parse(req.body);
  const s = req.session!;
  if (b.kind === "household") {
    if (!s.householdId || !isAdmin(s.user.id, s.householdId)) return void res.status(403).json({ error: "Alleen een beheerder kan mensen in het gezin uitnodigen." });
  }
  try {
    const { id, token } = A.createInvite(s.user.id, s.householdId, b);
    res.json({ id, url: inviteUrl(req, token) });
  } catch (e) {
    if (e instanceof A.UserError) return void res.status(400).json({ error: e.message });
    next(e);
  }
});
api.get("/invites", (req, res) => { res.json(A.pendingInvites(req.session!.user.id, req.session!.householdId)); });
api.delete("/invites/:id", (req, res) => {
  run("DELETE FROM invites WHERE id=? AND created_by=? AND used_at IS NULL", p(req), req.session!.user.id);
  res.json({ ok: true });
});

api.use(requireHousehold);

function publicSettings() {
  const { settings_pin, ...rest } = getSettings();
  return { ...rest, has_pin: settings_pin.length > 0 };
}

api.get("/bootstrap", (req, res) => {
  const { userId, householdId } = ctx();
  const me = A.householdsOf(userId).find((h) => h.id === householdId)!;
  const members = S.listMembers();
  res.json({
    members, shared: A.sharedPeople(userId, householdId), countdowns: countdowns(members),
    chores: S.listChores(), rewards: S.listRewards(), points: S.points(),
    lists: S.listLists(), recipes: S.listRecipes(), calendars: S.listCalendars(), photos: S.listPhotos(),
    settings: publicSettings(), assistant: { available: assistantAvailable(), model: MODEL },
    me: { id: userId, name: req.session!.user.name, email: req.session!.user.email, role: me.role, memberId: me.memberId },
  });
});

// ---------- toegang tot het gezin ----------
api.get("/household/users", (_req, res) => {
  res.json(all<{ id: string; name: string; email: string; role: string; member_id: string | null }>(
    "SELECT u.id, u.name, u.email, hu.role, hu.member_id FROM household_users hu JOIN users u ON u.id = hu.user_id WHERE hu.household_id=? ORDER BY hu.rowid", hid(),
  ).map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, memberId: u.member_id })));
});
const adminCount = () => get<{ n: number }>("SELECT COUNT(*) AS n FROM household_users WHERE household_id=? AND role='beheerder'", hid())!.n;
api.put("/household/users/:id", requireAdmin, (req, res) => {
  const b = z.object({ role: z.enum(["beheerder", "lid"]), memberId: z.string().nullable() }).parse(req.body);
  const cur = get<{ role: string }>("SELECT role FROM household_users WHERE household_id=? AND user_id=?", hid(), p(req));
  if (!cur) return void res.status(404).json({ error: "Deze persoon hoort niet bij het gezin." });
  if (cur.role === "beheerder" && b.role !== "beheerder" && adminCount() <= 1) return void res.status(400).json({ error: "Er moet minstens één beheerder blijven." });
  if (b.memberId) {
    if (!get("SELECT 1 FROM members WHERE id=? AND household_id=?", b.memberId, hid())) return void res.status(400).json({ error: "Onbekend gezinslid." });
    if (get("SELECT 1 FROM household_users WHERE member_id=? AND user_id<>?", b.memberId, p(req))) return void res.status(400).json({ error: "Dit profiel is al aan iemand anders gekoppeld." });
  }
  run("UPDATE household_users SET role=?, member_id=? WHERE household_id=? AND user_id=?", b.role, b.memberId, hid(), p(req));
  res.json({ ok: true });
  broadcast("access", "members");
});
api.delete("/household/users/:id", (req, res) => {
  const { userId } = ctx();
  const self = p(req) === userId;
  if (!self && !isAdmin(userId, hid())) return void res.status(403).json({ error: "Alleen een beheerder kan iemand verwijderen." });
  const cur = get<{ role: string }>("SELECT role FROM household_users WHERE household_id=? AND user_id=?", hid(), p(req));
  if (!cur) return void res.json({ ok: true });
  if (cur.role === "beheerder" && adminCount() <= 1) return void res.status(400).json({ error: "Er moet minstens één beheerder blijven. Maak eerst iemand anders beheerder." });
  run("DELETE FROM household_users WHERE household_id=? AND user_id=?", hid(), p(req));
  res.json({ ok: true });
  broadcast("access", "members");
  notifyUsers([p(req)], ["access"]);
});
api.post("/household/users/:id/reset-link", requireAdmin, (req, res) => {
  const token = A.createResetLink(ctx().userId, hid(), p(req));
  res.json({ url: `${req.protocol}://${req.get("host")}/herstel/${token}` });
});
/** Back-up van alle gegevens van dit gezin. */
api.get("/export", (_req, res) => {
  const h = hid();
  const data = {
    exportedAt: new Date().toISOString(), household: get("SELECT id, name, created_at FROM households WHERE id=?", h),
    members: S.listMembers(), events: all("SELECT * FROM events WHERE household_id=?", h), chores: S.listChores(),
    choreDone: all("SELECT d.chore_id, d.date FROM chore_done d JOIN chores c ON c.id = d.chore_id WHERE c.household_id=?", h),
    rewards: S.listRewards(), recipes: S.listRecipes(), meals: all("SELECT date, slot, title, recipe_id, image FROM meals WHERE household_id=?", h),
    lists: S.listLists(), calendars: S.listCalendars().map(({ url, ...c }) => ({ ...c, url: url.replace(/private-[^/]+/, "private-…") })), settings: publicSettings(),
  };
  res.setHeader("content-disposition", `attachment; filename="gezinsbord-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(data);
});
api.post("/household/demo", requireAdmin, (_req, res) => {
  if (get("SELECT 1 FROM events WHERE household_id=? LIMIT 1", hid())) return void res.status(400).json({ error: "Voorbeeldgegevens kunnen alleen in een leeg gezin." });
  seedDemo();
  res.json({ ok: true });
  autoPhotos();
  broadcast("members", "events", "chores", "meals", "recipes", "lists", "rewards");
});

// ---------- gezinsleden ----------
api.post("/members", (req, res) => { res.json(S.createMember(S.MemberInput.parse(req.body))); broadcast("members"); });
api.put("/members/:id", (req, res) => { res.json(S.updateMember(p(req), S.MemberInput.parse(req.body))); broadcast("members"); });
api.delete("/members/:id", (req, res) => { S.deleteMember(p(req)); res.json({ ok: true }); broadcast("members", "events", "chores", "calendars"); });
api.post("/members/reorder", (req, res) => { S.reorderMembers(z.array(z.string()).parse(req.body.ids)); res.json({ ok: true }); broadcast("members"); });

// ---------- afspraken ----------
api.get("/events", (req, res) => {
  const { from, to } = req.query;
  if (!isDate(from) || !isDate(to)) return void res.status(400).json({ error: "Geef from en to op als YYYY-MM-DD." });
  const members = typeof req.query.members === "string" && req.query.members ? req.query.members.split(",") : undefined;
  const { userId, householdId } = ctx();
  const list = [...eventsBetween(from, to, members), ...A.sharedEvents(userId, householdId, from, to)];
  res.json(list.sort((x, y) => x.on.localeCompare(y.on) || Number(y.allDay) - Number(x.allDay) || (x.startTime ?? "").localeCompare(y.startTime ?? "")));
});
api.post("/events", (req, res) => { res.json(createEvent(EventInput.parse(req.body))); broadcast("events"); });
api.put("/events/:id", (req, res) => {
  const body = EventInput.extend({ scope: z.enum(["all", "one"]).default("all"), on: day.optional() }).parse(req.body);
  const ev = getEvent(p(req));
  if (!ev) return void res.status(404).json({ error: "Deze afspraak bestaat niet meer." });
  if (ev.readOnly) return void res.status(400).json({ error: "Afspraken uit een gekoppelde agenda pas je aan in die agenda zelf." });
  const { scope, on, ...input } = body;
  if (scope === "one" && on && ev.repeat !== "none") {
    // maak een losse afspraak voor deze ene dag en sla die dag over in de reeks
    skipOccurrence(ev.id, on);
    res.json(createEvent({ ...input, repeat: "none", repeatUntil: null }));
  } else {
    res.json(updateEvent(ev.id, input));
  }
  broadcast("events");
});
api.delete("/events/:id", (req, res) => {
  const scope = req.query.scope ?? "all";
  const on = req.query.on;
  if (scope === "one" && isDate(on)) skipOccurrence(p(req), on);
  else if (scope === "following" && isDate(on)) endSeriesBefore(p(req), on);
  else deleteEvent(p(req));
  res.json({ ok: true });
  broadcast("events");
});

// ---------- slim importeren ----------
const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 }, fileFilter: (_req, f, cb) => cb(null, /^image\/(jpeg|png|gif|webp)$/.test(f.mimetype)) });
api.post("/import/extract", memUpload.single("image"), async (req, res) => {
  if (!importAvailable()) return void res.status(400).json({ error: "Importeren gebruikt de assistent. Zet eerst een ANTHROPIC_API_KEY op de server." });
  const text = typeof req.body?.text === "string" ? req.body.text.slice(0, 20000) : "";
  const hint = typeof req.body?.hint === "string" ? req.body.hint.slice(0, 500) : "";
  if (!text.trim() && !req.file) return void res.status(400).json({ error: "Plak tekst of kies een foto." });
  try {
    const r = await extractEvents({
      text: text.trim() || undefined, hint: hint || undefined,
      image: req.file ? { data: req.file.buffer.toString("base64"), mediaType: req.file.mimetype as "image/jpeg" } : undefined,
    });
    res.json(r);
  } catch (e) {
    console.error("[import]", e);
    res.status(502).json({ error: "Lezen lukte niet. Probeer een scherpere foto of plak de tekst." });
  }
});
/** Bevestigde voorstellen in één keer in de kalender zetten. */
api.post("/import/commit", (req, res) => {
  const b = z.object({ events: z.array(Proposal).max(100), listItems: z.array(z.string().trim().min(1).max(200)).max(100).default([]), listId: z.string().nullable().default(null) }).parse(req.body);
  const members = S.listMembers();
  const created = b.events.map((e) => createEvent({
    title: e.title, date: e.date, endDate: e.endDate, startTime: e.startTime, endTime: e.endTime, allDay: !e.startTime,
    location: e.location, notes: e.notes, repeat: e.repeat, repeatUntil: e.repeatUntil, countdown: false,
    members: e.members.map((n) => members.find((m) => m.name.toLocaleLowerCase("nl") === n.toLocaleLowerCase("nl"))?.id).filter((x): x is string => !!x),
  }));
  if (b.listId && b.listItems.length) b.listItems.forEach((it) => S.addItem(b.listId!, it));
  res.json({ added: created.length, items: b.listItems.length });
  broadcast("events", "lists");
});
api.post("/events/quick", async (req, res) => {
  const text = z.object({ text: z.string().trim().min(2).max(300) }).parse(req.body).text;
  if (!importAvailable()) return void res.status(400).json({ error: "Snel toevoegen met tekst gebruikt de assistent. Gebruik het formulier, of zet een ANTHROPIC_API_KEY op de server." });
  const p = await parseQuickAdd(text);
  if (!p) return void res.status(400).json({ error: "Ik kon daar geen afspraak van maken. Probeer bv. “zwemles dinsdag 17u Lina”." });
  res.json(p);
});

// ---------- taken & beloningen ----------
api.post("/chores", (req, res) => { res.json(S.createChore(S.ChoreInput.parse(req.body))); broadcast("chores"); });
api.put("/chores/:id", (req, res) => { S.updateChore(p(req), S.ChoreInput.parse(req.body)); res.json({ ok: true }); broadcast("chores"); });
api.delete("/chores/:id", (req, res) => { S.deleteChore(p(req)); res.json({ ok: true }); broadcast("chores", "rewards"); });
api.get("/chores/done", (req, res) => {
  const { from, to } = req.query;
  if (!isDate(from) || !isDate(to)) return void res.status(400).json({ error: "Geef from en to op als YYYY-MM-DD." });
  res.json(S.doneBetween(from, to));
});
api.put("/chores/:id/done", (req, res) => {
  const b = z.object({ date: day, done: z.boolean() }).parse(req.body);
  S.setChoreDone(p(req), b.date, b.done);
  res.json({ ok: true, points: S.points() });
  broadcast("chores", "rewards");
});
api.post("/rewards", (req, res) => { S.createReward(S.RewardInput.parse(req.body)); res.json({ ok: true }); broadcast("rewards"); });
api.delete("/rewards/:id", (req, res) => { S.deleteReward(p(req)); res.json({ ok: true }); broadcast("rewards"); });
api.post("/rewards/:id/claim", (req, res) => {
  const err = S.claimReward(p(req), z.object({ memberId: z.string() }).parse(req.body).memberId);
  if (err) return void res.status(400).json({ error: err });
  res.json({ ok: true, points: S.points() });
  broadcast("rewards");
});

// ---------- maaltijden & recepten ----------
api.get("/meals", (req, res) => {
  const { from, to } = req.query;
  if (!isDate(from) || !isDate(to)) return void res.status(400).json({ error: "Geef from en to op als YYYY-MM-DD." });
  res.json(S.mealsBetween(from, to));
});
api.put("/meals", (req, res) => {
  const b = z.object({ date: day, slot: z.enum(S.SLOTS), title: z.string().max(200), recipeId: z.string().nullable().optional() }).parse(req.body);
  S.setMeal(b.date, b.slot, b.title, b.recipeId ?? null);
  res.json({ ok: true });
  broadcast("meals");
  autoPhotos();
});

// ---------- foto's van gerechten ----------
/** Zoekt op de achtergrond foto's voor gerechten die er nog geen hebben. */
function autoPhotos() {
  const h = hid();
  setTimeout(() => fillMissingPhotos(h, (t) => broadcastTo(h, t)).catch((e) => console.warn("[gerechtfoto]", e)), 50);
}
const ImageUrl = z.string().max(2000).refine((u) => /^https?:\/\//.test(u) || u.startsWith("/api/photos/file/"), "Ongeldige foto").nullable();
api.post("/dish-photos", async (req, res) => {
  const q = z.object({ query: z.string().trim().min(2).max(120) }).parse(req.body).query;
  res.json(await findDishPhotos(q, { withSites: true }));
});
const dishUpload = multer({
  storage: multer.diskStorage({
    destination: PHOTO_DIR,
    filename: (_req, file, cb) => cb(null, `dish-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase() || ".jpg"}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif|heic|heif)$/.test(file.mimetype)),
});
api.post("/dish-photos/upload", dishUpload.single("photo"), (req, res) => {
  if (!req.file) return void res.status(400).json({ error: "Kies een foto (jpg, png of webp)." });
  res.json({ image: `/api/photos/file/${req.file.filename}` });
});
api.put("/recipes/:id/image", (req, res) => {
  S.setRecipeImage(p(req), ImageUrl.parse(req.body.image ?? null));
  res.json({ ok: true });
  broadcast("recipes", "meals");
});
api.put("/meals/image", (req, res) => {
  const b = z.object({ date: day, slot: z.enum(S.SLOTS), image: ImageUrl }).parse(req.body);
  S.setMealImage(b.date, b.slot, b.image);
  res.json({ ok: true });
  broadcast("meals");
});
api.post("/dish-photos/fill", (_req, res) => { autoPhotos(); res.json({ ok: true }); });
api.post("/recipes", (req, res) => { res.json({ id: S.createRecipe(S.RecipeInput.parse(req.body)) }); broadcast("recipes"); autoPhotos(); });
api.put("/recipes/:id", (req, res) => { S.updateRecipe(p(req), S.RecipeInput.parse(req.body)); res.json({ ok: true }); broadcast("recipes"); });
api.delete("/recipes/:id", (req, res) => { S.deleteRecipe(p(req)); res.json({ ok: true }); broadcast("recipes", "meals"); });
api.post("/recipes/:id/to-list", (req, res) => {
  const recipe = S.listRecipes().find((r) => r.id === p(req));
  if (!recipe) return void res.status(404).json({ error: "Recept niet gevonden." });
  const b = z.object({ listId: z.string(), items: z.array(z.string().trim().min(1).max(200)).max(100).optional() }).parse(req.body);
  const all = recipe.ingredients.split("\n").map((s) => s.replace(/^[-*•\s]+/, "").trim()).filter(Boolean);
  const items = b.items ?? all;
  // niets dubbel zetten wat nog open op de lijst staat
  const open = new Set(S.listLists().find((l) => l.id === b.listId)?.items.filter((i) => !i.done).map((i) => i.text.toLocaleLowerCase("nl")) ?? []);
  const fresh = items.filter((it) => !open.has(it.toLocaleLowerCase("nl")));
  fresh.forEach((it) => S.addItem(b.listId, it));
  res.json({ added: fresh.length, skipped: items.length - fresh.length });
  broadcast("lists");
});

// recepten van receptwebsites
api.post("/recipes/import", async (req, res) => {
  const b = z.object({ url: z.string().trim().url("Dat is geen geldige link."), translate: z.boolean().default(true) }).parse(req.body);
  const existing = S.recipeBySource(b.url);
  if (existing) return void res.json({ id: existing.id, existing: true });
  try {
    let r = await fetchRecipe(b.url);
    if (b.translate) r = await translateRecipe(r);
    const id = S.createRecipe(r);
    res.json({ id, existing: false });
    broadcast("recipes");
    if (!r.image) autoPhotos();
  } catch (e) {
    if (e instanceof RecipeError) return void res.status(400).json({ error: e.message });
    throw e;
  }
});
// ---------- zoeken in alles ----------
api.get("/search", (req, res) => {
  const q = z.object({ q: z.string().trim().min(1).max(80) }).parse(req.query).q;
  const lq = q.toLocaleLowerCase("tr");
  const has = (...parts: (string | null | undefined)[]) => parts.some((x) => (x ?? "").toLocaleLowerCase("tr").includes(lq));
  const t = today();
  const events = eventsBetween(addDays(t, -60), addDays(t, 400)).filter((o) => has(o.title, o.location, o.notes))
    .sort((a, b) => (a.on >= t ? 0 : 1) - (b.on >= t ? 0 : 1) || a.on.localeCompare(b.on))
    .filter((o, i, arr) => arr.findIndex((x) => x.id === o.id) === i) // herhalingen: enkel de eerstvolgende keer
    .slice(0, 12)
    .map((o) => ({ id: o.id, title: o.title, date: o.on, startTime: o.startTime, allDay: o.allDay, location: o.location, members: o.members }));
  const recipes = S.listRecipes().filter((r) => has(r.title, r.ingredients, r.original?.title)).slice(0, 8).map((r) => ({ id: r.id, title: r.title, image: r.image, minutes: r.minutes }));
  const items = S.listLists().flatMap((l) => l.items.filter((i) => has(i.text)).map((i) => ({ id: i.id, text: i.text, done: i.done, list: l.name, listId: l.id, icon: l.icon }))).slice(0, 10);
  const members = S.listMembers();
  const chores = S.listChores().filter((c) => has(c.title)).slice(0, 8).map((c) => ({ id: c.id, title: c.title, icon: c.icon, member: members.find((m) => m.id === c.memberId)?.name ?? "" }));
  const library = L.libraryList({ q, limit: 6 });
  res.json({ events, recipes, items, chores, library: library.items, libraryTotal: library.total });
});

// ---------- gedeelde receptenbibliotheek (alle recepten van de Turkse sites, per categorie) ----------
api.get("/library/categories", (_req, res) => { res.json({ categories: L.libraryCategories(), total: L.libraryCount(), crawl: { running: L.crawlStatus.running, site: L.crawlStatus.site, done: L.crawlStatus.done, total: L.crawlStatus.total, added: L.crawlStatus.added, finishedAt: L.crawlStatus.finishedAt } }); });
api.get("/library", (req, res) => {
  const q = z.object({ category: z.string().max(30).optional(), q: z.string().max(80).optional(), site: z.string().max(60).optional(), offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(200).default(60) }).parse(req.query);
  const mine = new Set(S.listRecipes().map((r) => r.sourceUrl).filter(Boolean));
  const r = L.libraryList(q);
  res.json({ ...r, items: r.items.map((i) => ({ ...i, inLibrary: mine.has(i.sourceUrl) })) });
});
api.get("/library/:id", async (req, res) => {
  const r = await L.libraryRecipe(p(req), z.object({ translate: z.string().optional() }).parse(req.query).translate !== "0");
  if (!r) return void res.status(404).json({ error: "Recept niet gevonden." });
  res.json({ ...r, inLibraryId: S.recipeBySource(r.sourceUrl!)?.id ?? null });
});
/** Zet een recept uit de gedeelde bibliotheek in de bibliotheek van het gezin (in het Nederlands als dat kan). */
api.post("/library/:id/add", async (req, res) => {
  const r = await L.libraryRecipe(p(req));
  if (!r) return void res.status(404).json({ error: "Recept niet gevonden." });
  const existing = S.recipeBySource(r.sourceUrl!);
  if (existing) return void res.json({ id: existing.id, existing: true });
  const { id: _id, category: _c, ...input } = r;
  const id = S.createRecipe(S.RecipeInput.parse(input));
  res.json({ id, existing: false });
  broadcast("recipes");
});
api.post("/library/crawl", requireAdmin, (req, res) => {
  const b = z.object({ sites: z.array(z.string()).optional(), maxPerSite: z.number().int().min(10).max(20000).optional() }).parse(req.body ?? {});
  if (L.crawlStatus.running) return void res.json({ ok: true, running: true });
  L.crawl(b).catch((e) => console.warn("[library]", e));
  res.json({ ok: true, running: true });
});
api.get("/library/crawl/status", (_req, res) => { res.json(L.crawlStatus); });
api.post("/library/probe", requireAdmin, async (req, res) => { res.json(await L.probe(z.object({ url: z.string().url() }).parse(req.body).url)); });
api.post("/library/translate-titles", requireAdmin, async (_req, res) => { res.json({ translated: await L.translateMissingTitles() }); });

api.post("/recipes/search", async (req, res) => {
  const q = z.object({ query: z.string().trim().min(2, "Typ minstens twee letters.").max(100) }).parse(req.body).query;
  try {
    res.json(await searchTurkishRecipes(q));
  } catch (e) {
    if (e instanceof RecipeError) return void res.status(400).json({ error: e.message });
    console.error("[recepten zoeken]", e);
    res.status(502).json({ error: "Zoeken lukte niet. Probeer het zo opnieuw." });
  }
});
api.post("/recipes/:id/translate", async (req, res) => {
  const r = S.listRecipes().find((x) => x.id === p(req));
  if (!r) return void res.status(404).json({ error: "Recept niet gevonden." });
  if (!aiAvailable()) return void res.status(400).json({ error: "Vertalen gebruikt de assistent. Zet eerst een ANTHROPIC_API_KEY op de server." });
  const t = await translateRecipe(S.RecipeInput.parse({ ...r, lang: r.lang === "nl" && r.cuisine === "Turks" && !r.original ? "tr" : r.lang }));
  S.saveTranslation(r.id, t);
  res.json({ ok: true });
  broadcast("recipes", "meals");
});

// ---------- lijsten ----------
api.post("/lists", (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(60), icon: z.string().max(16).default("📝"), kind: z.enum(["list", "pantry"]).default("list") }).parse(req.body);
  res.json({ id: S.createList(b.name, b.icon, hid(), b.kind) });
  broadcast("lists");
});
api.delete("/lists/:id", (req, res) => { S.deleteList(p(req)); res.json({ ok: true }); broadcast("lists"); });
api.post("/lists/:id/items", (req, res) => {
  const b = z.object({ text: z.string().trim().min(1).max(200), expires: day.nullable().optional(), qty: z.string().max(40).optional() }).parse(req.body);
  res.json({ id: S.addItem(p(req), b.text, { expires: b.expires ?? null, qty: b.qty }) });
  broadcast("lists");
});
api.post("/lists/:id/clear-done", (req, res) => { S.clearDone(p(req)); res.json({ ok: true }); broadcast("lists"); });
api.patch("/items/:id", (req, res) => {
  const b = z.object({ done: z.boolean().optional(), text: z.string().trim().min(1).max(200).optional(), expires: day.nullable().optional(), qty: z.string().max(40).optional() }).parse(req.body);
  S.updateItem(p(req), b);
  res.json({ ok: true });
  broadcast("lists");
});
/** Voorraad-item op de boodschappenlijst zetten (het item blijft in de voorraad staan). */
api.post("/items/:id/to-shopping", (req, res) => {
  const it = get<{ text: string }>("SELECT i.text FROM list_items i JOIN lists l ON l.id = i.list_id WHERE i.id=? AND l.household_id=?", p(req), hid());
  const shop = S.shoppingList();
  if (!it || !shop) return void res.status(400).json({ error: "Geen boodschappenlijst gevonden." });
  const open = shop.items.some((x) => !x.done && x.text.toLocaleLowerCase("nl") === it.text.toLocaleLowerCase("nl"));
  if (!open) S.addItem(shop.id, it.text);
  res.json({ ok: true, list: shop.name, existed: open });
  broadcast("lists");
});
api.delete("/items/:id", (req, res) => { S.deleteItem(p(req)); res.json({ ok: true }); broadcast("lists"); });

// ---------- foto's ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: PHOTO_DIR,
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase() || ".jpg"}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif|heic|heif)$/.test(file.mimetype)),
});
api.post("/photos", upload.array("photos", 50), (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  for (const f of files) run("INSERT INTO photos(id, household_id, filename) VALUES (?,?,?)", newId(), hid(), f.filename);
  res.json({ added: files.length });
  broadcast("photos");
});
api.post("/avatar", upload.single("photo"), (req, res) => {
  if (!req.file) return void res.status(400).json({ error: "Kies een afbeelding (jpg, png of webp)." });
  res.json({ filename: req.file.filename });
});
api.delete("/photos/:id", (req, res) => {
  const ph = get<{ filename: string }>("SELECT filename FROM photos WHERE id=? AND household_id=?", p(req), hid());
  if (ph) {
    run("DELETE FROM photos WHERE id=?", p(req));
    fs.rm(path.join(PHOTO_DIR, path.basename(ph.filename)), { force: true }, () => {});
  }
  res.json({ ok: true });
  broadcast("photos");
});

// ---------- gekoppelde agenda's ----------
api.post("/calendars", async (req, res) => {
  const b = S.CalendarInput.parse(req.body);
  const id = newId();
  run("INSERT INTO calendars(id, household_id, name, url, members) VALUES (?,?,?,?,?)", id, hid(), b.name, b.url, JSON.stringify(b.members));
  const cal = S.listCalendars().find((c) => c.id === id)!;
  try {
    const n = await syncCalendar(cal);
    res.json({ ok: true, events: n });
  } catch (e) {
    res.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
  broadcast("calendars", "events");
});
api.put("/calendars/:id", async (req, res) => {
  const b = S.CalendarInput.parse(req.body);
  run("UPDATE calendars SET name=?, url=?, members=? WHERE id=? AND household_id=?", b.name, b.url, JSON.stringify(b.members), p(req), hid());
  const cal = S.listCalendars().find((c) => c.id === p(req));
  if (cal) await syncCalendar(cal).catch(() => {});
  res.json({ ok: true });
  broadcast("calendars", "events");
});
api.delete("/calendars/:id", (req, res) => {
  if (get("SELECT 1 FROM calendars WHERE id=? AND household_id=?", p(req), hid())) {
    run("DELETE FROM events WHERE source=? AND household_id=?", p(req), hid());
    run("DELETE FROM calendars WHERE id=?", p(req));
  }
  res.json({ ok: true });
  broadcast("calendars", "events");
});
api.post("/calendars/sync", async (_req, res) => {
  await syncAll((h) => broadcastTo(h, ["calendars", "events"]), S.listCalendars());
  res.json({ calendars: S.listCalendars() });
});

// ---------- instellingen ----------
api.put("/settings", (req, res) => {
  const body = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).parse(req.body);
  setSettings(body);
  res.json(publicSettings());
  broadcast("settings");
});
api.post("/settings/verify-pin", (req, res) => {
  const pin = getSettings().settings_pin;
  res.json({ ok: !pin || String(req.body?.pin ?? "") === pin });
});

// ---------- weer ----------
api.get("/weather", async (_req, res) => {
  try { res.json(await getWeather()); } catch (e) { console.warn("[weer]", e instanceof Error ? e.message : e); res.status(502).json({ error: "Het weerbericht is nu niet beschikbaar." }); }
});
api.get("/geocode", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q.length < 2) return void res.json([]);
  try { res.json(await geocode(q)); } catch (e) { res.status(502).json({ error: e instanceof Error ? e.message : "Zoeken mislukt" }); }
});

// ---------- spraakmemo's ----------
const audio = multer({
  storage: multer.diskStorage({
    destination: PHOTO_DIR,
    filename: (_req, file, cb) => cb(null, `memo-${crypto.randomUUID()}${/mp4|m4a|aac/.test(file.mimetype) ? ".m4a" : /ogg/.test(file.mimetype) ? ".ogg" : ".webm"}`),
  }),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^audio\//.test(file.mimetype) || file.mimetype === "video/webm"),
});
api.get("/memos", (_req, res) => {
  res.json(all<{ id: string; title: string; filename: string; seconds: number; created_at: string; name: string | null }>(
    "SELECT m.id, m.title, m.filename, m.seconds, m.created_at, u.name FROM memos m LEFT JOIN users u ON u.id = m.user_id WHERE m.household_id=? ORDER BY m.created_at DESC", hid(),
  ).map((m) => ({ id: m.id, title: m.title, filename: m.filename, seconds: m.seconds, createdAt: m.created_at, by: m.name })));
});
api.post("/memos", audio.single("audio"), (req, res) => {
  if (!req.file) return void res.status(400).json({ error: "De opname kwam niet goed door. Probeer opnieuw." });
  const title = String(req.body?.title ?? "").trim().slice(0, 80) || "Spraakmemo";
  const seconds = Math.max(0, Math.min(3600, Math.round(Number(req.body?.seconds) || 0)));
  run("INSERT INTO memos(id, household_id, user_id, title, filename, seconds) VALUES (?,?,?,?,?,?)", newId(), hid(), ctx().userId, title, req.file.filename, seconds);
  res.json({ ok: true });
  broadcast("memos");
  notifyHousehold(hid(), { title: `🎙️ Nieuwe memo van ${req.session!.user.name}`, body: title, url: "/#apps", tag: "memo" }, ctx().userId).catch(() => {});
});
api.delete("/memos/:id", (req, res) => {
  const m = get<{ filename: string }>("SELECT filename FROM memos WHERE id=? AND household_id=?", p(req), hid());
  if (m) {
    run("DELETE FROM memos WHERE id=?", p(req));
    fs.rm(path.join(PHOTO_DIR, path.basename(m.filename)), { force: true }, () => {});
  }
  res.json({ ok: true });
  broadcast("memos");
});

api.post("/assistant/feedback", (req, res) => {
  const b = z.object({ rating: z.union([z.literal(1), z.literal(-1)]), question: z.string().max(4000), answer: z.string().max(8000) }).parse(req.body);
  run("INSERT INTO assistant_feedback(id, household_id, user_id, rating, question, answer) VALUES (?,?,?,?,?,?)", newId(), hid(), ctx().userId, b.rating, b.question, b.answer);
  res.json({ ok: true });
});

// ---------- assistent ----------
const ChatBody = z.object({ messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) })).min(1).max(40) });
api.post("/assistant", async (req, res) => {
  const { messages } = ChatBody.parse(req.body);
  try {
    const out = await chat(messages);
    res.json(out);
    if (out.changes.some((c) => c.kind !== "options")) broadcast("events", "meals", "chores", "lists", "rewards", "recipes");
  } catch (e) {
    console.error("[assistent]", e);
    res.status(502).json({ error: "De assistent is even niet bereikbaar. Probeer het zo opnieuw." });
  }
});

// ---------- fouten ----------
api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Controleer de ingevulde gegevens.", details: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    return;
  }
  if (err instanceof A.UserError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof Error && /^Onbekend/.test(err.message)) {
    res.status(400).json({ error: `${err.message}.` });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Er ging iets mis op de server." });
});
