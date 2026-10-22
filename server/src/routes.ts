import express, { type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { z, ZodError } from "zod";
import { PHOTO_DIR, getSettings, setSettings, run, get, newId, hid, ctx, all, tx, withCtx } from "./db.js";
import {
  EventInput, countdowns, createEvent, deleteEvent, endSeriesBefore, eventsBetween, getEvent, skipOccurrence, updateEvent,
} from "./events.js";
import * as S from "./store.js";
import { broadcast, broadcastTo, notifyUsers, castTo } from "./realtime.js";
import { getWeather, geocode } from "./weather.js";
import { syncAll, syncCalendar } from "./ics.js";
import { chat, assistantAvailable, MODEL } from "./assistant.js";
import {
  clearFailures, endSession, isAdmin, noteFailure, requireAdmin, requireHousehold, requireUser, startSession, tooManyAttempts, verifyPassword, hashPassword,
} from "./auth.js";
import * as A from "./accounts.js";
import { seedDemo } from "./seed.js";
import { fetchRecipe, searchTurkishRecipes, translateRecipe, RecipeError, aiAvailable } from "./recipes.js";
import { findDishPhotos, fillMissingPhotos, wikipedia } from "./dishphotos.js";
import * as L from "./library.js";
import { extractEvents, parseQuickAdd, importAvailable, Proposal } from "./importer.js";
import { VAPID_PUBLIC, subscribe, unsubscribe, subscriptionsOf, notifyHousehold, pushToUsers } from "./push.js";
import { isDate, today, addDays, weekday } from "./dates.js";
import { holidayOccurrences, holidaysBetween, localizeHoliday, isHolidayKind, ramadan, bayram } from "./holidays.js";
import { METHODS, PRAYERS, prayerTimes, type Prayer } from "./prayer.js";
import { quranSurahs, quranSurah, RECITERS, TRANSLATIONS } from "./quran.js";
import { searchEzan } from "./ezan.js";
import { FOODS, searchFoods, macrosFor, estimateLine } from "./nutrition.js";
import * as F from "./family.js";
import * as B from "./billing.js";
import * as Stripe from "./stripe.js";
import * as C from "./connectors.js";
import * as P from "./prices.js";
import * as W from "./weekbox.js";
import * as Inbox from "./inbox.js";
import * as R from "./routines.js";
import { BRAND, UA as USER_AGENT, asLang, L as LT } from "./i18n.js";
import * as H from "./home.js";
import * as HA from "./smarthome.js";
import * as Tuya from "./tuya.js";
import { buildBriefing, applyProposal, ProposalInput, listMemory, remember, forget, MemoryInput } from "./manager.js";
import { saveApiKey, saveWorkspace, checkAi, clearApiKey, keySource, operatorHousehold, workspaceId } from "./ai.js";

export const api = express.Router();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const p = (req: Request) => req.params.id as string;
const inviteUrl = (req: Request, token: string) => `${req.protocol}://${req.get("host")}/uitnodiging/${token}`;

api.get("/health", (_req, res) => { res.json({ ok: true }); });

/** Webhook van buitenaf (Siri, IFTTT, n8n): {list}, {note} of {event}. Geen sessie nodig; de sleutel in het adres is de toegang. */
api.post("/hooks/:token", (req, res) => {
  const c = C.findWebhook(String(req.params.token ?? ""));
  if (!c) return void res.status(404).json({ error: "Onbekende sleutel" });
  const b = z.object({
    list: z.union([z.string().min(1).max(200), z.array(z.string().min(1).max(200)).max(50)]).optional(),
    note: z.string().min(1).max(500).optional(),
    event: z.object({ title: z.string().min(1).max(200), date: day, startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), location: z.string().max(200).optional() }).optional(),
  }).parse(req.body ?? {});
  withCtx({ userId: "", householdId: c.householdId } as never, () => {
    const did: string[] = [];
    if (b.list) { const id = S.ensureShoppingList(); for (const x of Array.isArray(b.list) ? b.list : [b.list]) { S.addItem(id, x); did.push(`list:${x}`); } broadcastTo(c.householdId, ["lists"]); }
    if (b.note) { S.createNote({ text: b.note, color: "geel", memberId: null, pinned: false }); did.push("note"); broadcastTo(c.householdId, ["notes"]); }
    if (b.event) { createEvent({ title: b.event.title, date: b.event.date, endDate: null, startTime: b.event.startTime ?? null, endTime: b.event.endTime ?? (b.event.startTime ? `${String((Number(b.event.startTime.slice(0, 2)) + 1) % 24).padStart(2, "0")}${b.event.startTime.slice(2)}` : null), allDay: !b.event.startTime, repeat: "none", repeatUntil: null, exdates: [], members: [], location: b.event.location ?? "", notes: "", countdown: false } as never); did.push("event"); broadcastTo(c.householdId, ["events"]); }
    C.bumpWebhook(c);
    res.json({ ok: true, did });
  });
});

// eenvoudige rem op aanmaken van accounts per adres
const regHits = new Map<string, { n: number; until: number }>();
api.use("/auth/register", (req, res, next) => {
  if (regHits.size > 1000) for (const [k, v] of regHits) if (v.until < Date.now()) regHits.delete(k);
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
    if (invite?.valid && (invite.kind === "agenda" || invite.kind === "link")) {
      const r = A.acceptInvite(b.invite!, userId, householdId);
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
  const r = A.acceptInvite(req.params.token as string, s.user.id, s.householdId);
  if (r.kind === "link" && r.linked && s.householdId) { broadcastTo(r.linked, ["family", "settings"]); broadcastTo(s.householdId, ["family", "settings"]); }
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
  await pushToUsers([req.session!.user.id], { title: BRAND, body: LT(asLang(getSettings().language), { nl: "Meldingen werken op dit toestel. 🎉", tr: "Bildirimler bu cihazda çalışıyor. 🎉", en: "Notifications work on this device. 🎉" }), url: "/#today", tag: "test" });
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
  if (!A.canSeePhoto(req.session!.user.id, name) && !(req.session!.householdId && F.canSeePhoto(req.session!.householdId, name))) return void res.status(404).end();
  res.sendFile(path.join(PHOTO_DIR, name), { maxAge: "30d" }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// uitnodiging maken: voor je agenda kan dat ook zonder actief gezin
api.post("/invites", (req, res, next) => {
  const b = A.InviteInput.parse(req.body);
  const s = req.session!;
  if (b.kind === "household" || b.kind === "link") {
    if (!s.householdId || !isAdmin(s.user.id, s.householdId)) return void res.status(403).json({ error: "Alleen een beheerder kan mensen of gezinnen uitnodigen." });
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
  const { settings_pin, ha_token, ...rest } = getSettings();
  return { ...rest, has_pin: settings_pin.length > 0, ha_configured: !!(rest.ha_url && ha_token) || !!Tuya.connectionFor(hid()) };
}

/** Aftellen: ook de eerstvolgende feestdagen (volgens de instelling), tot 6 in totaal. */
function withHolidayCountdowns(list: ReturnType<typeof countdowns>) {
  const kinds = getSettings().holidays.split(",").filter(isHolidayKind);
  if (!kinds.length) return list;
  const t = today();
  const hol = holidaysBetween(t, addDays(t, 120), kinds, getSettings().country || "BE").filter((h) => h.title !== "Advent").slice(0, 3).map((h) => localizeHoliday(h, getSettings().language)).map((h) => ({ title: h.title, date: h.date, days: Math.round((Date.parse(h.date) - Date.parse(t)) / 864e5), icon: h.icon, memberId: null, kind: "holiday" as const }));
  return [...list, ...hol].sort((a, b) => a.days - b.days).slice(0, 6);
}
/** Claude API-sleutel invullen in de app (beheerder). De sleutel wordt eerst gecontroleerd. */
const requireOperator = (req: Request, res: Response, next: NextFunction) => {
  if (hid() !== operatorHousehold()) return void res.status(403).json({ error: "Alleen de beheerder van het eerste gezin op deze server kan de gedeelde sleutel wijzigen." });
  requireAdmin(req, res, next);
};
api.put("/settings/api-key", requireOperator, async (req, res) => {
  const { key, workspace } = z.object({ key: z.string().min(10).max(300), workspace: z.string().max(120).optional() }).parse(req.body);
  const r = await saveApiKey(key, workspace ?? "");
  if (!r.ok) return void res.status(400).json({ error: r.error, needsWorkspace: r.needsWorkspace ?? false });
  res.json({ ok: true });
  broadcast("settings", "recipes");
  // de hele bibliotheek van Nederlandse titels voorzien (op de achtergrond, in groepjes)
  L.translateMissingTitles(100_000).catch(() => {});
});
/** Workspace-ID bij een bestaande sleutel (bv. uit de omgeving) zetten. */
api.put("/settings/api-workspace", requireOperator, async (req, res) => {
  const r = await saveWorkspace(z.object({ workspace: z.string().max(120) }).parse(req.body).workspace);
  if (!r.ok) return void res.status(400).json({ error: r.error });
  res.json({ ok: true });
  broadcast("settings", "recipes");
  L.translateMissingTitles(100_000).catch(() => {});
});
/** Controle: werkt de assistent echt? */
api.get("/settings/api-check", requireAdmin, async (_req, res) => { res.json({ ...(await checkAi()), workspace: !!workspaceId() }); });
api.delete("/settings/api-key", requireOperator, (_req, res) => { clearApiKey(); res.json({ ok: true }); broadcast("settings"); });
/** Sterren van vandaag en van deze week erbij (voor het profiel en het klassement). */
function withPeriods(pts: ReturnType<typeof S.points>) {
  const t = today();
  const weekStart = addDays(t, -((new Date(t + "T12:00:00").getDay() + 6) % 7));
  const td = S.pointsBetween(t, t), wk = S.pointsBetween(weekStart, t);
  return Object.fromEntries(Object.entries(pts).map(([id, p]) => [id, { ...p, today: td[id] ?? 0, week: wk[id] ?? 0 }]));
}
api.get("/bootstrap", (req, res) => {
  const { userId, householdId } = ctx();
  const me = A.householdsOf(userId).find((h) => h.id === householdId)!;
  const members = S.listMembers();
  res.json({
    members, shared: A.sharedPeople(userId, householdId), countdowns: withHolidayCountdowns(countdowns(members)),
    chores: S.listChores(), rewards: S.listRewards(), points: withPeriods(S.points()),
    lists: (S.ensureShoppingList(), S.ensurePantryList(), S.listLists()), recipes: S.listRecipes(), calendars: S.listCalendars(), photos: S.listPhotos(),
    settings: publicSettings(), assistant: { available: assistantAvailable(), model: MODEL, keySource: keySource(), canEditKey: me.role === "beheerder" && householdId === operatorHousehold() },
    me: { id: userId, name: req.session!.user.name, email: req.session!.user.email, role: me.role, memberId: me.memberId },
    build: process.env.GB_BUILD || null,
    brand: { name: BRAND },
  });
});


// ---------- prijsgeheugen ----------
const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 }, fileFilter: (_req, f, cb) => cb(null, /^image\/(jpeg|png|gif|webp)$/.test(f.mimetype)) });
api.get("/prices", (req, res) => { const q = z.object({ product: z.string().optional(), store: z.string().optional(), days: z.coerce.number().int().min(1).max(730).optional() }).parse(req.query); res.json(P.listPrices({ product: q.product ? P.productKey(q.product) : undefined, store: q.store, days: q.days, limit: 300 })); });
api.post("/prices", (req, res) => { res.json(P.addPrice(P.PriceInput.parse(req.body))); broadcast("prices"); });
api.delete("/prices/:id", (req, res) => { P.deletePrice(p(req)); res.json({ ok: true }); broadcast("prices"); });
api.get("/prices/stores", (_req, res) => { const own = [...new Set(P.listPrices({ days: 730, limit: 3000 }).map((x) => x.store))]; res.json([...new Set([...own, ...P.STORE_NAMES])]); });
api.get("/prices/lookup", (req, res) => { const items = String(req.query.items ?? "").split("\u001f").filter(Boolean).slice(0, 200); res.json(P.lookup(items)); });
api.get("/prices/list/:id", (req, res) => { const list = S.listLists().find((l) => l.id === p(req)); if (!list) return void res.status(404).json({ error: "Niet gevonden" }); const texts = list.items.filter((i) => !i.done).map((i) => i.text); const r = P.bestStores(texts); res.json({ ...r, infos: undefined }); });
api.get("/prices/history", (req, res) => { const q = z.object({ product: z.string().min(1) }).parse(req.query); res.json(P.history(q.product)); });
api.get("/prices/spend", (req, res) => { const q = z.object({ months: z.coerce.number().int().min(1).max(24).default(6) }).parse(req.query); res.json(P.spend(q.months)); });
api.get("/prices/receipts", (_req, res) => { res.json(P.listReceipts()); });
api.delete("/prices/receipts/:id", (req, res) => { P.deleteReceipt(p(req)); res.json({ ok: true }); broadcast("prices"); });
api.post("/prices/scan", memUpload.single("image"), async (req, res) => {
  const kind = req.body?.kind === "label" ? "label" : req.body?.kind === "folder" ? "folder" : "ticket";
  if (!req.file) return void res.status(400).json({ error: "Geen foto" });
  if (!P.scanAvailable()) return void res.status(400).json({ error: "De assistent is niet ingesteld; prijzen lezen van een foto vraagt de Claude-sleutel." });
  try { res.json(await P.scanImage({ data: req.file.buffer.toString("base64"), mediaType: req.file.mimetype as "image/jpeg" }, kind)); }
  catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : "Lezen mislukte" }); }
});
api.post("/prices/commit", (req, res) => { const r = P.commit(P.CommitInput.parse(req.body)); res.json(r); broadcast("prices", "lists"); });

// ---------- koppelingen ----------
api.get("/connectors", (_req, res) => { res.json(C.catalog()); });
api.get("/connections", (_req, res) => { res.json(C.listConnections().map(C.publicConn)); });
api.post("/connections", async (req, res) => {
  const b = C.ConnectionInput.parse(req.body);
  const def = C.connectorById(b.connector);
  if (def?.plan === "plus" && !["plus", "operator"].includes(B.subscription().plan)) return void res.status(402).json({ error: "Deze koppeling zit in Gezin+." });
  try {
    const id = C.createConnection(b);
    const c = await C.syncConnection(C.getConnection(id)!);
    res.json(C.publicConn(c)); broadcast("connections", "settings");
  } catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : "Mislukt" }); }
});
api.put("/connections/:id", async (req, res) => {
  const b = C.ConnectionInput.partial().parse(req.body);
  if (!C.updateConnection(p(req), b)) return void res.status(404).json({ error: "Niet gevonden" });
  const c = b.config ? await C.syncConnection(C.getConnection(p(req))!) : C.getConnection(p(req))!;
  res.json(C.publicConn(c)); broadcast("connections", "settings");
});
api.post("/connections/:id/sync", async (req, res) => { const c = C.getConnection(p(req)); if (!c) return void res.status(404).json({ error: "Niet gevonden" }); res.json(C.publicConn(await C.syncConnection(c))); broadcast("connections"); });
api.delete("/connections/:id", (req, res) => { C.deleteConnection(p(req)); res.json({ ok: true }); broadcast("connections", "settings"); });
api.get("/connections/widgets", (req, res) => { const q = z.object({ member: z.string().optional(), board: z.string().optional() }).parse(req.query); res.json(C.connectorWidgets(q.member || null, q.board === "1", asLang(getSettings().language))); });
api.get("/connections/links", (req, res) => { const q = z.object({ kind: z.enum(["list", "meal", "event", "store"]), q: z.string().optional(), address: z.string().optional(), title: z.string().optional(), member: z.string().optional() }).parse(req.query); res.json(C.connectorLinks(q, q.member || null)); });

// ---------- abonnement, AI-budget en ledencodes ----------
api.get("/billing", (_req, res) => { res.json({ ...B.budgetState(), models: B.MODELS, plans: B.PLANS.filter((p) => p !== "operator").map((p) => ({ id: p, label: B.PLAN_LABEL[p], budgetMicro: B.BUDGET[p] })), stripe: Stripe.state(hid()) }); });
const originOf = (req: Request) => (process.env.PUBLIC_URL || req.header("origin") || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
/** Betalen in de app: Stripe Checkout openen (alleen een beheerder van het gezin). */
api.post("/billing/checkout", requireAdmin, async (req, res) => {
  const b = z.object({ plan: z.enum(["gezin", "plus"]), interval: z.enum(["month", "year"]).default("month") }).parse(req.body);
  try { const url = await Stripe.checkout(hid(), b.plan, b.interval, originOf(req), { email: req.session!.user.email ?? null, name: req.session!.user.name }); res.json({ url }); }
  catch (e) { res.status(e instanceof Stripe.StripeError ? 400 : 502).json({ error: e instanceof Error ? e.message : "Betalen mislukte" }); }
});
api.post("/billing/portal", requireAdmin, async (req, res) => {
  try { res.json({ url: await Stripe.portal(hid(), originOf(req)) }); }
  catch (e) { res.status(e instanceof Stripe.StripeError ? 400 : 502).json({ error: e instanceof Error ? e.message : "Portaal openen mislukte" }); }
});
api.post("/billing/redeem", requireAdmin, (req, res) => {
  const b = z.object({ code: z.string().trim().min(3).max(40), identifier: z.string().trim().max(120).optional() }).parse(req.body);
  try { res.json(B.redeem(b.code, b.identifier ?? null)); broadcast("settings"); }
  catch (e) { if (e instanceof B.RedeemError) return void res.status(400).json({ error: e.message }); throw e; }
});
// alleen de eigenaar van de server: partners, codes, handmatige abonnementen
api.get("/partners", requireOperator, (_req, res) => { res.json(B.listPartners().map((p) => ({ ...p, stats: B.partnerStats(p.id) }))); });
api.post("/partners", requireOperator, (req, res) => { res.json({ id: B.createPartner(B.PartnerInput.parse(req.body)) }); });
api.delete("/partners/:id", requireOperator, (req, res) => { B.deletePartner(p(req)); res.json({ ok: true }); });
api.post("/partners/:id/codes", requireOperator, (req, res) => { const b = z.object({ code: z.string().trim().max(40).optional(), maxUses: z.number().int().min(1).max(1_000_000).optional(), expiresAt: z.string().nullable().optional() }).parse(req.body ?? {}); res.json({ code: B.createCode(p(req), b) }); });
api.post("/partners/:id/members", requireOperator, (req, res) => { const b = z.object({ identifiers: z.array(z.string().min(2)).min(1) }).parse(req.body); B.addMembers(p(req), b.identifiers); res.json({ ok: true }); });
api.put("/billing/plan/:householdId", requireOperator, (req, res) => { const b = z.object({ plan: z.enum(["free", "gezin", "plus"]), validUntil: z.string().nullable().optional() }).parse(req.body); B.setPlan(req.params.householdId as string, b.plan, { source: "manual", validUntil: b.validUntil ?? null }); res.json({ ok: true }); broadcastTo(req.params.householdId as string, ["settings"]); });

// ---------- toestellen (wandscherm, tafelmodel, telefoons) en cast ----------
api.get("/devices", (_req, res) => { res.json(S.listDevices()); });
api.put("/devices/:id", (req, res) => {
  const id = p(req);
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(id)) return void res.status(400).json({ error: "Ongeldig toestel-id" });
  S.upsertDevice(id, req.session!.user.id, S.DeviceInput.parse(req.body));
  res.json({ ok: true });
  broadcast("devices");
});
api.post("/devices/:id/ping", (req, res) => { S.touchDevice(p(req)); res.json({ ok: true }); });
api.delete("/devices/:id", (req, res) => { S.deleteDevice(p(req)); res.json({ ok: true }); broadcast("devices"); });
/** Iets op een ander toestel tonen: een recept, een scherm of een berichtje. to = toestel-id, of null voor alle hubs. */
api.post("/cast", (req, res) => {
  const b = z.object({ to: z.string().nullable().default(null), kind: z.enum(["recipe", "screen", "message", "note"]), value: z.string().max(500), from: z.string().nullable().default(null) }).parse(req.body);
  const hubs = S.listDevices().filter((d) => d.role === "hub" && d.online);
  if (b.to === null && !hubs.length) return void res.status(409).json({ error: "Er is nu geen keukenscherm online." });
  castTo(hid(), b);
  res.json({ ok: true, hubs: b.to ? 1 : hubs.length });
});

// ---------- de manager: briefings, voorstellen en gezinsgeheugen ----------
api.get("/manager/briefing", async (req, res) => {
  const q = z.object({ kind: z.enum(["morning", "evening"]).optional(), member: z.string().optional(), date: day.optional() }).parse(req.query);
  const kind = q.kind ?? (new Date().getHours() >= 17 ? "evening" : "morning");
  res.json(await buildBriefing(kind, q.date ?? today(), q.member || null));
});
api.post("/manager/apply", async (req, res) => {
  try {
    const r = await applyProposal(ProposalInput.parse(req.body));
    res.json(r);
    if (r.topics.length) broadcast(...r.topics);
  } catch (e) { if (e instanceof ZodError) throw e; res.status(400).json({ error: e instanceof Error ? e.message : "Mislukt" }); }
});
api.get("/memory", (_req, res) => { res.json(listMemory()); });
api.post("/memory", (req, res) => { res.json({ id: remember(MemoryInput.parse(req.body)) }); broadcast("settings"); });
api.delete("/memory/:id", (req, res) => { forget(p(req)); res.json({ ok: true }); broadcast("settings"); });

// ---------- het huis: onderhoud, afval, gezondheid, slim huis ----------
api.get("/upkeep", (_req, res) => { res.json(H.listUpkeep()); });
api.get("/upkeep/templates", (_req, res) => { res.json(H.UPKEEP_TEMPLATES.map(({ key, title, titleTr, category, icon, intervalMonths, leadDays, notes }) => ({ key, title, titleTr, category, icon, intervalMonths, leadDays, notes }))); });
api.post("/upkeep/templates", (req, res) => { const b = z.object({ keys: z.array(z.string()).min(1) }).parse(req.body); res.json({ added: H.applyTemplates(b.keys) }); broadcast("home"); });
api.post("/upkeep", (req, res) => { res.json({ id: H.createUpkeep(H.UpkeepInput.parse(req.body)) }); broadcast("home"); });
api.put("/upkeep/:id", (req, res) => { if (!H.updateUpkeep(p(req), H.UpkeepInput.parse(req.body))) return void res.status(404).json({ error: "Niet gevonden" }); res.json({ ok: true }); broadcast("home"); });
api.post("/upkeep/:id/done", (req, res) => { const b = z.object({ date: day.default(today()), note: z.string().max(300).default("") }).parse(req.body ?? {}); const r = H.upkeepDone(p(req), b.date, b.note); if (!r) return void res.status(404).json({ error: "Niet gevonden" }); res.json(r); broadcast("home"); });
const attestUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 }, fileFilter: (_req, f, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(f.mimetype)) });
api.post("/upkeep/:id/attest", attestUpload.single("photo"), (req, res) => {
  if (!req.file) return void res.status(400).json({ error: "Geen foto" });
  const name = `attest-${crypto.randomUUID()}.${req.file.mimetype === "image/png" ? "png" : "jpg"}`;
  fs.writeFileSync(path.join(PHOTO_DIR, name), req.file.buffer);
  run("INSERT INTO photos(id, household_id, filename) VALUES (?,?,?)", newId(), hid(), name);
  H.setUpkeepAttest(p(req), name); res.json({ filename: name }); broadcast("home");
});
api.delete("/upkeep/:id", (req, res) => { H.deleteUpkeep(p(req)); res.json({ ok: true }); broadcast("home"); });

api.get("/waste", (_req, res) => { res.json({ rules: H.listWaste(), next: H.wasteNext(21), fractions: H.FRACTIONS.map(({ id, nl, tr, icon }) => ({ id, nl, tr, icon })) }); });
api.post("/waste", (req, res) => { res.json({ id: H.createWaste(H.WasteInput.parse(req.body)) }); broadcast("home"); });
api.delete("/waste/:id", (req, res) => { H.deleteWaste(p(req)); res.json({ ok: true }); broadcast("home"); });
api.post("/waste/sync", async (req, res) => {
  const url = getSettings().waste_ical;
  if (!url) return void res.status(400).json({ error: "Vul eerst het iCal-adres van de afvalkalender in." });
  try { const n = await H.syncWasteIcal(hid(), url); res.json({ ok: true, count: n }); broadcast("home"); } catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : "Inlezen mislukte" }); }
  void req;
});

api.get("/care", (req, res) => { const q = z.object({ member: z.string().optional() }).parse(req.query); res.json(H.listHealth(hid(), q.member)); });
api.post("/care", (req, res) => { res.json({ id: H.createHealth(H.HealthInput.parse(req.body)) }); broadcast("home"); });
api.put("/care/:id", (req, res) => { if (!H.updateHealth(p(req), H.HealthInput.parse(req.body))) return void res.status(404).json({ error: "Niet gevonden" }); res.json({ ok: true }); broadcast("home"); });
api.post("/care/:id/done", (req, res) => { const r = H.healthDone(p(req)); if (!r) return void res.status(404).json({ error: "Niet gevonden" }); res.json(r); broadcast("home"); });
api.delete("/care/:id", (req, res) => { H.deleteHealth(p(req)); res.json({ ok: true }); broadcast("home"); });

api.get("/ha/states", async (req, res) => {
  const q = z.object({ all: z.string().optional() }).parse(req.query);
  // Home Assistant en Tuya naast elkaar; als één van de twee ontbreekt of hapert, tonen we de andere
  const h = hid(); const hasHa = !!HA.haConfig(h); const hasTuya = !!Tuya.connectionFor(h);
  if (!hasHa && !hasTuya) return void res.status(502).json({ error: "Home Assistant of Tuya is nog niet gekoppeld." });
  const [ha, tuya] = await Promise.allSettled([hasHa ? HA.haStates(q.all !== "1") : Promise.resolve([]), hasTuya ? Tuya.statesFor(h) : Promise.resolve([])]);
  const states = [...(ha.status === "fulfilled" ? ha.value : []), ...(tuya.status === "fulfilled" ? tuya.value : [])];
  const errors = [ha, tuya].filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
  if (!states.length && errors.length) return void res.status(502).json({ error: errors.join(" · ") });
  res.json(states);
});
api.post("/ha/test", async (_req, res) => { try { const r = await HA.haTest(); res.json({ ok: true, message: r.message }); } catch (e) { res.status(502).json({ error: e instanceof Error ? e.message : "Niet bereikbaar" }); } });
api.post("/ha/call", async (req, res) => {
  const b = z.object({ domain: z.string().regex(/^[a-z_]+$/), service: z.string().regex(/^[a-z_]+$/), data: z.record(z.string(), z.unknown()).default({}) }).parse(req.body);
  try {
    const ent = typeof b.data.entity_id === "string" ? b.data.entity_id : "";
    if (ent && Tuya.isTuyaEntity(ent)) { await Tuya.callFor(hid(), ent, b.service, b.data); } else await HA.haCall(b.domain, b.service, b.data);
    res.json({ ok: true });
  } catch (e) { res.status(502).json({ error: e instanceof Error ? e.message : "Mislukt" }); }
});
api.post("/ha/moment", async (req, res) => { const b = z.object({ moment: z.enum(["sleep", "morning", "ezan", "away", "home"]) }).parse(req.body); res.json({ ok: await HA.runMoment(b.moment) }); });

// ---------- gezinsnetwerk ----------
api.get("/family/links", (_req, res) => { res.json(F.listLinks()); });
api.put("/family/links/:id/share", requireAdmin, (req, res) => {
  const b = z.object({ share: z.array(z.enum(F.SHARE_KINDS)) }).parse(req.body);
  if (!F.setMyShare(p(req), b.share)) return void res.status(404).json({ error: "Deze verbinding bestaat niet." });
  res.json({ ok: true });
  const l = F.listLinks().find((x) => x.id === p(req)); if (l) broadcastTo(l.otherId, ["family"]); broadcast("settings");
});
api.delete("/family/links/:id", requireAdmin, (req, res) => {
  const l = F.listLinks().find((x) => x.id === p(req));
  F.deleteLink(p(req)); res.json({ ok: true });
  if (l) broadcastTo(l.otherId, ["family", "settings"]); broadcast("family", "settings");
});
api.get("/family/feed", (_req, res) => { res.json(F.familyFeed()); });
api.post("/family/links/:id/note", (req, res) => {
  const other = F.sendFamilyNote(p(req), F.FamilyNoteInput.parse(req.body));
  if (!other) return void res.status(404).json({ error: "Deze verbinding bestaat niet." });
  res.json({ ok: true });
  broadcastTo(other, ["notes"]);
});

// ---------- prikbord ----------
api.get("/notes", (_req, res) => { res.json(S.listNotes()); });
api.post("/notes", (req, res) => { res.json({ id: S.createNote(S.NoteInput.parse(req.body)) }); broadcast("notes"); });
api.put("/notes/:id", (req, res) => { if (!S.updateNote(p(req), S.NoteInput.partial().parse(req.body))) return void res.status(404).json({ error: "Briefje niet gevonden" }); res.json({ ok: true }); broadcast("notes"); });
api.delete("/notes/:id", (req, res) => { S.deleteNote(p(req)); res.json({ ok: true }); broadcast("notes"); });

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
  const kinds = getSettings().holidays.split(",").filter(isHolidayKind);
  const connItems = C.connectorCalendar(from, to).map((e) => ({ id: `conn:${e.id}`, title: e.title, notes: e.url ?? "", location: e.location ?? "", date: e.date, endDate: e.endDate ?? null, startTime: e.startTime ?? null, endTime: e.endTime ?? null, allDay: e.allDay, repeat: "none" as const, repeatUntil: null, exdates: [], members: [], source: "koppeling", readOnly: true, countdown: false, on: e.date, until: e.endDate ?? e.date, key: `conn:${e.id}@${e.date}` }));
  const list = [...eventsBetween(from, to, members), ...A.sharedEvents(userId, householdId, from, to), ...connItems, ...(kinds.length ? holidayOccurrences(from, to, kinds, getSettings().country || "BE").map((o) => (getSettings().language === "tr" ? { ...o, title: o.title.replace(/^(\S+\s)(.*)$/, (_m, ic: string, tt: string) => ic + (localizeHoliday({ date: o.date, title: tt, icon: "", kind: "be" }, "tr").title)) } : o)) : [])];
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
api.post("/import/extract", memUpload.single("image"), async (req, res) => {
  if (!importAvailable()) return void res.status(400).json({ error: "Importeren gebruikt de assistent. Vul eerst de Claude API-sleutel in bij Instellingen → Assistent." });
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
  if (!importAvailable()) return void res.status(400).json({ error: "Snel toevoegen met tekst gebruikt de assistent. Gebruik het formulier, of vul de Claude API-sleutel in bij Instellingen → Assistent." });
  const p = await parseQuickAdd(text);
  if (!p) return void res.status(400).json({ error: "Ik kon daar geen afspraak van maken. Probeer bv. “zwemles dinsdag 17u Lina”." });
  res.json(p);
});

// ---------- taken & beloningen ----------
/** Routinepakketten: catalogus in de taal van het gezin, en toepassen per gezinslid. */
api.get("/chores/routines", (_req, res) => { res.json(R.catalog(asLang(getSettings().language))); });
api.post("/chores/routines", (req, res) => { const b = z.object({ memberId: z.string(), keys: z.array(z.string()).min(1).max(50) }).parse(req.body); res.json(R.apply(b.memberId, b.keys, asLang(getSettings().language))); broadcast("chores"); });
api.post("/chores", (req, res) => { res.json(S.createChore(S.ChoreInput.parse(req.body))); broadcast("chores"); });
api.put("/chores/:id", (req, res) => { S.updateChore(p(req), S.ChoreInput.parse(req.body)); res.json({ ok: true }); broadcast("chores"); });
api.delete("/chores/:id", (req, res) => { S.deleteChore(p(req)); res.json({ ok: true }); broadcast("chores", "rewards"); });
/** Weekoverzicht per gezinslid: per dag gedaan/totaal en sterren, plus de langste reeks. */
api.get("/chores/week", (req, res) => {
  const { memberId, from } = req.query; const start = isDate(from) ? from : today();
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const done = new Set(S.doneBetween(days[0], days[6]));
  const chores = S.listChores().filter((c) => !memberId || c.memberId === memberId);
  const t = today();
  const rows = days.map((d) => { const planned = chores.filter((c) => c.days.includes(weekday(d))); const did = planned.filter((c) => done.has(`${d}|${c.id}`)); return { date: d, total: planned.length, done: did.length, stars: did.reduce((a, c) => a + c.points, 0), future: d > t }; });
  res.json({ days: rows, stars: rows.reduce((a, r) => a + r.stars, 0), perfect: rows.filter((r) => r.total && r.done === r.total && !r.future).length });
});
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

/** Week vullen: lege avondmaal-vakjes krijgen een recept uit de eigen bibliotheek (gevarieerd, niet wat vorige week al stond),
 *  aangevuld uit de gedeelde bibliotheek als er te weinig eigen recepten zijn. */
api.post("/meals/autoplan", async (req, res) => {
  const b = z.object({ from: day, days: z.number().int().min(1).max(14).default(7), slot: z.enum(S.SLOTS).default("diner"), overwrite: z.boolean().default(false) }).parse(req.body ?? {});
  const to = addDays(b.from, b.days - 1);
  const current = S.mealsBetween(b.from, to);
  const recent = new Set(S.mealsBetween(addDays(b.from, -14), addDays(b.from, -1)).map((m) => m.recipeId).filter(Boolean));
  const avoid = S.avoidWords();
  const inWeek = new Set(current.map((m) => m.recipeId).filter(Boolean)); // niet twee keer in dezelfde week
  const ok = (r: S.Recipe) => !inWeek.has(r.id) && !S.dietHits(r.ingredients, avoid).length;
  let pool = S.listRecipes().filter((r) => !recent.has(r.id) && ok(r));
  const needed = Array.from({ length: b.days }, (_, i) => addDays(b.from, i)).filter((d) => b.overwrite || !current.some((m) => m.date === d && m.slot === b.slot && m.title));
  // te weinig eigen recepten: hoofdgerechten uit de gedeelde bibliotheek erbij halen
  if (pool.length < needed.length) {
    const cats = ["kip", "vlees", "groente", "peulvruchten", "vis", "rijst", "kebap", "borek", "aardappel"];
    for (const c of cats) {
      if (pool.length >= needed.length + 3) break;
      const { items } = L.libraryList({ category: c, limit: 40 });
      const pick = items.filter((i) => i.image).sort(() => Math.random() - 0.5).slice(0, 2);
      for (const it of pick) {
        if (S.recipeBySource(it.sourceUrl)) continue;
        const r = await L.libraryRecipe(it.id, false); // vertalen gebeurt later, bij het openen
        if (!r || S.dietHits(r.ingredients, avoid).length) continue;
        const added = await L.addToFamily(it.id, { translate: false, loaded: r });
        if (added && !added.existing) pool.push(added.recipe);
      }
    }
  }
  if (!pool.length) pool = S.listRecipes().filter(ok); // alles stond onlangs al op tafel: dan toch kiezen (maar nooit wat vermeden wordt)
  pool = pool.sort(() => Math.random() - 0.5);
  // elk recept hoogstens één keer per beurt; te weinig recepten → de rest blijft leeg
  const planned: { date: string; title: string }[] = [];
  needed.slice(0, pool.length).forEach((d, i) => {
    S.setMeal(d, b.slot, pool[i].title, pool[i].id);
    planned.push({ date: d, title: pool[i].title });
  });
  res.json({ planned, left: needed.length - planned.length });
  broadcast("meals", "recipes");
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
api.put("/recipes/:id/favorite", (req, res) => { S.setRecipeFavorite(p(req), z.object({ favorite: z.boolean() }).parse(req.body).favorite); res.json({ ok: true }); broadcast("recipes"); });
api.delete("/recipes/:id", (req, res) => { S.deleteRecipe(p(req)); res.json({ ok: true }); broadcast("recipes", "meals"); });
api.post("/recipes/:id/to-list", (req, res) => {
  const recipe = S.listRecipes().find((r) => r.id === p(req));
  if (!recipe) return void res.status(404).json({ error: "Recept niet gevonden." });
  const b = z.object({ listId: z.string().optional(), items: z.array(z.string().trim().min(1).max(200)).max(100).optional() }).parse(req.body);
  const all = recipe.ingredients.split("\n").map((s) => s.replace(/^[-*•\s]+/, "").trim()).filter(Boolean);
  const items = b.items ?? all;
  const listId = b.listId ?? S.ensureShoppingList();
  const list = S.listLists().find((l) => l.id === listId);
  if (!list) return void res.status(404).json({ error: "Lijst niet gevonden." });
  // niets dubbel zetten wat nog open op de lijst staat
  const open = new Set(list.items.filter((i) => !i.done).map((i) => i.text.toLocaleLowerCase("nl")));
  const fresh = items.filter((it) => !open.has(it.toLocaleLowerCase("nl")));
  tx(() => fresh.forEach((it) => S.addItem(listId, it)));
  res.json({ added: fresh.length, skipped: items.length - fresh.length, list: list.name });
  broadcast("lists");
});

/** Boodschappen voor de hele week: alle ingrediënten van de ingeplande recepten, zonder wat al open op de lijst staat. */


// ---------- gezinsinbox ----------
api.get("/inbox", (req, res) => { const q = z.object({ status: z.enum(["new", "done", "dismissed"]).optional() }).parse(req.query); res.json({ items: Inbox.listItems(hid(), q.status), address: Inbox.plusAddress(hid()), shared: !!Inbox.shared() }); });
api.post("/inbox/sync", async (_req, res) => {
  const c = C.listConnections().find((x) => x.connector === "inbox" && x.enabled);
  if (!c) return void res.status(400).json({ error: "Zet eerst de koppeling Gezinsinbox aan (Instellingen → Koppelingen)." });
  const r = await C.syncConnection(c); res.json(C.publicConn(r)); broadcast("inbox", "connections");
});
/** Voorstellen uit een bericht toepassen: afspraken in de agenda, boodschappen op de lijst, een ticket in het prijsgeheugen en de voorraad. */
api.post("/inbox/:id/apply", (req, res) => {
  const it = Inbox.getItem(p(req)); if (!it) return void res.status(404).json({ error: "Niet gevonden" });
  const b = Inbox.ApplyInput.parse(req.body ?? {});
  const members = S.listMembers(); let events = 0, items = 0, prices = 0;
  if (b.events) for (const e of it.data.events ?? []) { createEvent({ title: e.title, date: e.date, endDate: e.endDate, startTime: e.startTime, endTime: e.endTime, allDay: !e.startTime, location: e.location, notes: e.notes, repeat: e.repeat, repeatUntil: e.repeatUntil, countdown: false, members: e.members.map((n) => members.find((m) => m.name.toLocaleLowerCase("nl") === n.toLocaleLowerCase("nl"))?.id).filter((x): x is string => !!x) } as never); events++; }
  if (b.listItems && it.data.listItems?.length) { const id = S.ensureShoppingList(); for (const x of it.data.listItems) { S.addItem(id, x); items++; } }
  if (it.data.scan && it.data.scan.items.length) { const r = P.commit({ store: it.data.scan.store || "?", date: it.data.scan.date, total: it.data.scan.total, items: it.data.scan.items, source: "ticket", toPantry: b.toPantry, tickList: true }); prices = r.prices; }
  Inbox.setStatus(it.id, "done");
  res.json({ ok: true, events, items, prices }); broadcast("events", "lists", "prices", "inbox");
});
api.post("/inbox/:id/dismiss", (req, res) => { Inbox.setStatus(p(req), "dismissed"); res.json({ ok: true }); broadcast("inbox"); });
api.delete("/inbox/:id", (req, res) => { Inbox.deleteItem(p(req)); res.json({ ok: true }); broadcast("inbox"); });
/** Een bericht met de hand aanleveren (test, of een mailserver die naar deze route doorstuurt). */
api.post("/inbox/raw", express.text({ type: "*/*", limit: "15mb" }), async (req, res) => {
  const mail = await Inbox.parseRaw(typeof req.body === "string" ? req.body : "");
  const item = await Inbox.processMail(mail, hid());
  res.json(item ?? { skipped: true }); if (item) broadcast("inbox");
});

// ---------- weekbox ----------
api.post("/meals/weekbox/propose", (req, res) => { res.json(W.propose(W.ProposeInput.parse(req.body ?? {}))); });
api.post("/meals/weekbox/apply", (req, res) => { const n = W.apply(W.ApplyInput.parse(req.body)); res.json({ planned: n }); broadcast("meals"); autoPhotos(); });
api.get("/meals/weekbox/basket", (req, res) => { const q = z.object({ from: day, to: day }).parse(req.query); res.json(W.basket(q.from, q.to)); });
api.post("/meals/weekbox/to-list", (req, res) => { const b = z.object({ from: day, to: day, skip: z.array(z.string()).default([]) }).parse(req.body); res.json(W.basketToList(b.from, b.to, b.skip)); broadcast("lists"); });
api.post("/meals/week-to-list", (req, res) => {
  const b = z.object({ from: day, to: day, listId: z.string().optional() }).parse(req.body);
  const shop = b.listId ? S.listLists().find((l) => l.id === b.listId) : S.shoppingList();
  if (!shop) return void res.status(400).json({ error: "Geen boodschappenlijst gevonden." });
  const recipes = S.listRecipes();
  const planned = S.mealsBetween(b.from, b.to).map((m) => recipes.find((r) => r.id === m.recipeId)).filter((r): r is S.Recipe => !!r);
  const open = new Set(shop.items.filter((i) => !i.done).map((i) => i.text.toLocaleLowerCase("nl")));
  const seen = new Set<string>(); let added = 0;
  for (const r of planned) for (const line of r.ingredients.split("\n").map((x) => x.replace(/^[-*•\s]+/, "").trim()).filter(Boolean)) {
    const k = line.toLocaleLowerCase("nl");
    if (open.has(k) || seen.has(k)) continue;
    seen.add(k); S.addItem(shop.id, line); added++;
  }
  res.json({ added, recipes: planned.length, list: shop.name });
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
api.get("/library/categories", (_req, res) => { res.json({ categories: L.libraryCategories(), total: L.libraryCount(), translated: get<{ n: number }>("SELECT COUNT(*) AS n FROM library WHERE title_nl IS NOT NULL")?.n ?? 0, crawl: { running: L.crawlStatus.running, site: L.crawlStatus.site, done: L.crawlStatus.done, total: L.crawlStatus.total, added: L.crawlStatus.added, finishedAt: L.crawlStatus.finishedAt } }); });
api.get("/library", (req, res) => {
  const q = z.object({ category: z.string().max(30).optional(), q: z.string().max(80).optional(), site: z.string().max(60).optional(), offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(200).default(60), random: z.coerce.boolean().optional() }).parse(req.query);
  const mine = new Set(S.listRecipes().map((r) => r.sourceUrl).filter(Boolean));
  const r = L.libraryList(q);
  res.json({ ...r, items: r.items.map((i) => ({ ...i, inLibrary: mine.has(i.sourceUrl) })) });
});
/** Koken met wat in huis is: recepten die de meeste voorraad-items gebruiken. */
api.get("/library/from-pantry", (_req, res) => {
  const pantry = S.pantryList();
  const items = pantry?.items.filter((i) => !i.done).map((i) => i.text) ?? [];
  const mine = new Set(S.listRecipes().map((r) => r.sourceUrl).filter(Boolean));
  const r = L.fromPantry(items);
  res.json({ ...r, items: r.items.map((i) => ({ ...i, inLibrary: mine.has(i.sourceUrl) })), pantryCount: items.length });
});
api.get("/library/:id", async (req, res) => {
  const r = await L.libraryRecipe(p(req), z.object({ translate: z.string().optional() }).parse(req.query).translate !== "0");
  if (!r) return void res.status(404).json({ error: "Recept niet gevonden." });
  res.json({ ...r, inLibraryId: S.recipeBySource(r.sourceUrl!)?.id ?? null, warnings: S.dietHits(`${r.ingredients}\n${r.original?.ingredients ?? ""}`) });
});
/** Zet een recept uit de gedeelde bibliotheek in de bibliotheek van het gezin (in het Nederlands als dat kan). */
api.post("/library/:id/add", async (req, res) => {
  const added = await L.addToFamily(p(req));
  if (!added) return void res.status(404).json({ error: "Recept niet gevonden." });
  res.json({ id: added.id, existing: added.existing });
  if (!added.existing) broadcast("recipes");
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
  if (!aiAvailable()) return void res.status(400).json({ error: "Vertalen gebruikt de assistent. Vul eerst de Claude API-sleutel in bij Instellingen → Assistent." });
  const t = await translateRecipe(S.RecipeInput.parse({ ...r, lang: r.lang === "nl" && r.cuisine === "Turks" && !r.original ? "tr" : r.lang }));
  S.saveTranslation(r.id, t);
  res.json({ ok: true });
  broadcast("recipes", "meals");
});

// ---------- lijsten ----------
api.post("/lists", (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(60), icon: z.string().max(16).default("📝"), kind: z.enum(["list", "pantry", "shopping"]).default("list") }).parse(req.body);
  res.json({ id: S.createList(b.name, b.icon, hid(), b.kind) });
  broadcast("lists");
});
api.delete("/lists/:id", (req, res) => { S.deleteList(p(req)); res.json({ ok: true }); broadcast("lists"); });
const aisle = z.enum(S.AISLE_KEYS).nullable().optional();
api.post("/lists/:id/items", (req, res) => {
  const b = z.object({ text: z.string().trim().min(1).max(200), expires: day.nullable().optional(), qty: z.string().max(40).optional(), memberId: z.string().nullable().optional(), aisle }).parse(req.body);
  res.json({ id: S.addItem(p(req), b.text, { expires: b.expires ?? null, qty: b.qty, memberId: b.memberId ?? null, aisle: b.aisle ?? null }) });
  broadcast("lists");
});
/** Meerdere items in één keer (vaste boodschappen aanvinken); wat al open op de lijst staat, wordt overgeslagen. */
api.post("/lists/:id/items/bulk", (req, res) => {
  const b = z.object({ items: z.array(z.object({ text: z.string().trim().min(1).max(200), aisle })).min(1).max(200) }).parse(req.body);
  const list = S.listLists().find((l) => l.id === p(req));
  if (!list) return void res.status(404).json({ error: "Lijst niet gevonden." });
  const open = new Set(list.items.filter((i) => !i.done).map((i) => i.text.toLocaleLowerCase("nl")));
  let added = 0;
  tx(() => { for (const it of b.items) { if (open.has(it.text.toLocaleLowerCase("nl"))) continue; S.addItem(list.id, it.text, { aisle: it.aisle ?? null }); open.add(it.text.toLocaleLowerCase("nl")); added++; } });
  res.json({ added, skipped: b.items.length - added });
  broadcast("lists");
});
// vaste boodschappen: de standaardlijst om aan te vinken in plaats van te typen
api.get("/staples", (_req, res) => { res.json(S.listStaples()); });
api.post("/staples", (req, res) => {
  const b = z.object({ text: z.string().trim().min(1).max(80), aisle }).parse(req.body);
  res.json({ id: S.addStaple(b.text, b.aisle ?? null), staples: S.listStaples() });
});
api.delete("/staples/:id", (req, res) => { S.deleteStaple(p(req)); res.json(S.listStaples()); });
api.post("/lists/:id/clear-done", (req, res) => { S.clearDone(p(req)); res.json({ ok: true }); broadcast("lists"); });
api.patch("/items/:id", (req, res) => {
  const b = z.object({ done: z.boolean().optional(), text: z.string().trim().min(1).max(200).optional(), expires: day.nullable().optional(), qty: z.string().max(40).optional(), memberId: z.string().nullable().optional(), aisle }).parse(req.body);
  let moved: { to: string } | null = null;
  tx(() => { S.updateItem(p(req), b); if (b.done !== undefined) moved = S.syncShopPantry(p(req), b.done); });
  res.json({ ok: true, moved });
  broadcast("lists");
});
/** Gekochte (afgevinkte) boodschappen naar de voorraad verplaatsen. */
api.post("/lists/:id/done-to-pantry", (req, res) => {
  const list = S.listLists().find((l) => l.id === p(req));
  const pantry = S.pantryList();
  if (!list || !pantry) return void res.status(400).json({ error: "Geen voorraadlijst gevonden." });
  if (list.id === pantry.id) return void res.status(400).json({ error: "Dit is de voorraad zelf." });
  const have = new Set(pantry.items.filter((i) => !i.done).map((i) => i.text.toLocaleLowerCase("nl")));
  let moved = 0;
  tx(() => {
    for (const it of list.items.filter((i) => i.done)) {
      if (!have.has(it.text.toLocaleLowerCase("nl"))) { S.addItem(pantry.id, it.text, { qty: it.qty }); have.add(it.text.toLocaleLowerCase("nl")); moved++; }
      S.deleteItem(it.id);
    }
  });
  res.json({ moved, pantry: pantry.name });
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

// ---------- gebedstijden en ezan ----------
const parseJson = <T,>(s: string, fb: T): T => { try { return JSON.parse(s) as T; } catch { return fb; } };
function prayerDay(date: string) {
  const s = getSettings();
  const adjust = parseJson<Partial<Record<Prayer, number>>>(s.ezan_adjust, {});
  const times = prayerTimes({ date, latitude: Number(s.latitude), longitude: Number(s.longitude), method: s.ezan_method, asr: s.ezan_asr === "hanafi" ? "hanafi" : "standard", adjust });
  return { date, times: Object.fromEntries(PRAYERS.map((p) => [p, new Date(times[p]).toISOString()])) as Record<Prayer, string> };
}
/** Barcode opzoeken bij Open Food Facts: naam, merk, inhoud. */
api.get("/products/barcode/:ean", async (req, res) => {
  const ean = String(req.params.ean ?? "").replace(/\D/g, ""); if (ean.length < 8 || ean.length > 14) return void res.status(400).json({ error: "Geen geldige barcode" });
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${ean}.json?fields=product_name,product_name_nl,product_name_en,brands,quantity,categories_tags,nutriments`, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(8000) });
    const j = (await r.json()) as { status?: number; product?: { product_name?: string; product_name_nl?: string; product_name_en?: string; brands?: string; quantity?: string; nutriments?: Record<string, number> } };
    if (!j.product || j.status === 0) return void res.status(404).json({ error: "Niet gevonden bij Open Food Facts" });
    const pr = j.product; const name = pr.product_name_nl || pr.product_name || pr.product_name_en || "";
    res.json({ ean, name, brand: pr.brands ?? "", quantity: pr.quantity ?? "", label: [pr.brands?.split(",")[0]?.trim(), name, pr.quantity].filter(Boolean).join(" "), kcal100: pr.nutriments?.["energy-kcal_100g"] ?? null });
  } catch { res.status(502).json({ error: "Open Food Facts is nu niet bereikbaar, probeer straks nog eens" }); }
});
/** Feestboodschappen voor bayram op de lijst (zonder dubbels). */
api.post("/traditions/bayram-list", (_req, res) => {
  const lang = asLang(getSettings().language);
  const items = lang === "tr" ? ["şeker", "çikolata", "baklava", "kahve", "çay", "peçete", "kolonya"] : lang === "en" ? ["sweets", "chocolate", "baklava", "coffee", "tea", "napkins", "cologne"] : ["snoep", "chocolade", "baklava", "koffie", "thee", "servetten", "eau de cologne"];
  const id = S.ensureShoppingList(); const shop = S.listLists().find((l) => l.id === id)!;
  const open = new Set(shop.items.filter((i) => !i.done).map((i) => i.text.toLowerCase())); const did: string[] = [];
  for (const it of items) if (!open.has(it)) { S.addItem(id, it); did.push(it); }
  res.json({ ok: true, did }); broadcast("lists");
});
/** Tradities van vandaag: ramadan (dag, iftar, sahur), bayram en advent. Leeg als er niets speelt. */
api.get("/traditions/today", (_req, res) => {
  const s = getSettings(); const t = today(); const kinds = s.holidays.split(",").filter(isHolidayKind);
  const out: { ramadan?: { day: number; total: number; eid: string; iftar: string; imsak: string; imsakTomorrow: string }; advent?: { day: number }; bayram?: { title: string; icon: string; start: string; end: string; daysUntil: number; day: number | null; visits: number } } = {};
  if (kinds.includes("islam")) {
    const r = ramadan(t);
    if (r) { const pd = prayerDay(t); const pt = prayerDay(addDays(t, 1)); out.ramadan = { day: r.day, total: r.total, eid: r.eid, iftar: pd.times.maghrib, imsak: pd.times.fajr, imsakTomorrow: pt.times.fajr }; }
  }
  if (kinds.includes("islam")) { const b = bayram(t); if (b) { const lb = localizeHoliday({ date: b.start, title: b.title, icon: b.icon, kind: "islam" }, s.language); out.bayram = { ...b, title: lb.title, visits: eventsBetween(b.start, b.end).filter((e) => /bezoek|ziyaret|visit|bayram/i.test(e.title)).length }; } }
  if (kinds.includes("sinterklaas") && t.slice(5) >= "12-01" && t.slice(5) <= "12-24") out.advent = { day: Number(t.slice(8)) };
  res.json(out);
});
api.get("/prayer", (req, res) => {
  const q = z.object({ date: z.string().optional() }).parse(req.query);
  const date = q.date && isDate(q.date) ? q.date : today();
  res.json({ ...prayerDay(date), tomorrow: prayerDay(addDays(date, 1)).times, methods: METHODS.map((m) => ({ id: m.id, label: m.label })), city: getSettings().city });
});
const ezanAudio = multer({
  storage: multer.diskStorage({
    destination: PHOTO_DIR,
    filename: (_req, file, cb) => cb(null, `ezan-${crypto.randomUUID()}${/mp4|m4a|aac/.test(file.mimetype) ? ".m4a" : /ogg/.test(file.mimetype) ? ".ogg" : /wav/.test(file.mimetype) ? ".wav" : ".mp3"}`),
  }),
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^audio\//.test(file.mimetype)),
});
const listEzanSounds = () => all<{ id: string; name: string; filename: string }>("SELECT id, name, filename FROM ezan_sounds WHERE household_id=? ORDER BY created_at", hid());
api.get("/ezan/sounds", (_req, res) => { res.json(listEzanSounds()); });
api.post("/ezan/sounds", requireAdmin, ezanAudio.single("audio"), (req, res) => {
  if (!req.file) return void res.status(400).json({ error: "Het geluidsbestand kwam niet goed door. Kies een mp3-, m4a- of ogg-bestand." });
  const name = String(req.body?.name ?? "").trim().slice(0, 80) || req.file.originalname.replace(/\.[a-z0-9]+$/i, "").slice(0, 80) || "Ezan";
  run("INSERT INTO ezan_sounds(id, household_id, name, filename) VALUES (?,?,?,?)", newId(), hid(), name, req.file.filename);
  res.json(listEzanSounds());
  broadcast("ezan");
});
/** Een ezan van een link halen (de server downloadt, zodat het ook werkt als de bron later verdwijnt). */
api.post("/ezan/sounds/url", requireAdmin, async (req, res) => {
  const b = z.object({ url: z.string().trim().url("Dat is geen geldige link."), name: z.string().trim().max(80).default("") }).parse(req.body);
  const r = await fetch(b.url, { signal: AbortSignal.timeout(60_000), headers: { "user-agent": USER_AGENT } });
  if (!r.ok) return void res.status(502).json({ error: `De link antwoordde met ${r.status}.` });
  const type = r.headers.get("content-type") ?? "";
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 40 * 1024 * 1024) return void res.status(413).json({ error: "Dat bestand is te groot (max. 40 MB)." });
  if (!/^audio\//.test(type) && !/\.(mp3|m4a|ogg|wav)(\?|$)/i.test(b.url)) return void res.status(415).json({ error: "De link wijst niet naar een geluidsbestand." });
  const ext = /mp4|m4a|aac|\.m4a/.test(type + b.url) ? ".m4a" : /ogg/.test(type + b.url) ? ".ogg" : /wav/.test(type + b.url) ? ".wav" : ".mp3";
  const filename = `ezan-${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(PHOTO_DIR, filename), buf);
  const name = b.name || decodeURIComponent(path.basename(new URL(b.url).pathname)).replace(/\.[a-z0-9]+$/i, "").slice(0, 80) || "Ezan";
  run("INSERT INTO ezan_sounds(id, household_id, name, filename) VALUES (?,?,?,?)", newId(), hid(), name, filename);
  res.json(listEzanSounds());
  broadcast("ezan");
});
/** Online ezan-opnames zoeken (Internet Archive). */
api.get("/ezan/search", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q.length < 2) return void res.json([]);
  try { res.json(await searchEzan(q)); } catch (e) { res.status(502).json({ error: e instanceof Error ? e.message : "Zoeken mislukt." }); }
});
api.delete("/ezan/sounds/:id", requireAdmin, (req, res) => {
  const m = get<{ filename: string }>("SELECT filename FROM ezan_sounds WHERE id=? AND household_id=?", p(req), hid());
  if (m) { run("DELETE FROM ezan_sounds WHERE id=?", p(req)); fs.rm(path.join(PHOTO_DIR, path.basename(m.filename)), { force: true }, () => {}); }
  res.json(listEzanSounds());
  broadcast("ezan");
});

// ---------- spelend islam leren (kinderen) ----------
/** Een sfeerfoto bij een onderwerp (Wikipedia), met cache zodat het snel blijft. */
const photoCache = new Map<string, { url: string; title: string } | null>();
api.get("/learn/photo", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
  if (!q) return void res.json(null);
  if (!photoCache.has(q)) {
    let hit: { url: string; title: string } | null = null;
    for (const lang of ["en", "tr", "nl"]) { try { const r = await wikipedia(lang, q); if (r[0]) { hit = { url: r[0].url, title: r[0].title }; break; } } catch { /* volgende */ } }
    photoCache.set(q, hit);
  }
  res.set("Cache-Control", "public, max-age=86400");
  res.json(photoCache.get(q) ?? null);
});
api.get("/learn/progress", (_req, res) => { res.json({ progress: S.learnProgress(), dailyMax: S.LEARN_DAILY_MAX }); });
api.post("/learn/stars", (req, res) => {
  const b = z.object({ memberId: z.string(), game: z.string().regex(/^[a-z-]{2,30}$/), stars: z.number().int().min(1).max(20) }).parse(req.body);
  const given = S.addLearnStars(b.memberId, b.game, b.stars, today());
  res.json({ given, today: S.learnStarsToday(b.memberId, b.game, today()), dailyMax: S.LEARN_DAILY_MAX });
  broadcast("chores");
});

// ---------- dieet & calorieën ----------
api.get("/diet/foods", (req, res) => { res.json(searchFoods(String(req.query.q ?? ""), 20).map((f) => ({ id: f.id, label: f.label, names: f.names.slice(0, 4), kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat, unit: f.unit ?? null, cat: f.cat }))); });
api.get("/diet/day", (req, res) => {
  const memberId = String(req.query.member ?? ""); const date = isDate(req.query.date) ? String(req.query.date) : today();
  if (!memberId) return void res.status(400).json({ error: "member ontbreekt" });
  const profile = S.dietProfile(memberId);
  const entries = S.dietEntries(memberId, date);
  const totals = entries.reduce((a, e) => ({ kcal: a.kcal + e.kcal, protein: a.protein + e.protein, carbs: a.carbs + e.carbs, fat: a.fat + e.fat }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  const planned = S.mealsBetween(date, date).filter((m) => m.title).map((m) => { const n = m.recipeId ? S.recipeNutrition(m.recipeId) : null; return { slot: m.slot, title: m.title, recipeId: m.recipeId, kcal: n?.kcal ?? null, logged: entries.some((e) => e.slot === m.slot && ((m.recipeId !== null && e.recipeId === m.recipeId) || e.text === m.title || e.text.startsWith(m.title + " ×"))) }; });
  res.json({ date, profile, entries, totals: { kcal: Math.round(totals.kcal), protein: Math.round(totals.protein), carbs: Math.round(totals.carbs), fat: Math.round(totals.fat) }, week: S.dietWeek(memberId, date), weights: S.weights(memberId), planned });
});
api.put("/diet/profile/:memberId", (req, res) => { res.json(S.saveDietProfile(req.params.memberId, S.parseDietProfile(req.body))); broadcast("diet"); });
api.post("/diet/weight", (req, res) => {
  const b = z.object({ memberId: z.string(), date: z.string().refine(isDate), kg: z.number().min(10).max(350) }).parse(req.body);
  S.addWeight(b.memberId, b.date, b.kg); res.json({ ok: true }); broadcast("diet");
});
const SlotZ = z.enum(["ontbijt", "lunch", "diner", "snack"]);
api.post("/diet/log", (req, res) => {
  const b = z.object({
    memberId: z.string(), date: z.string().refine(isDate), slot: SlotZ.default("snack"),
    foodId: z.string().optional(), grams: z.number().min(1).max(5000).optional(),
    recipeId: z.string().optional(), portions: z.number().min(0.25).max(10).optional(),
    text: z.string().max(200).optional(), kcal: z.number().min(0).max(10000).optional(), protein: z.number().min(0).optional(), carbs: z.number().min(0).optional(), fat: z.number().min(0).optional(),
  }).parse(req.body);
  let entry: Omit<S.DietEntry, "id">;
  if (b.recipeId) {
    const r = S.getRecipe(b.recipeId); const n = S.recipeNutrition(b.recipeId);
    if (!r || !n) return void res.status(404).json({ error: "Recept niet gevonden" });
    const p = b.portions ?? 1; const per = n.perServing;
    entry = { memberId: b.memberId, date: b.date, slot: b.slot, text: `${r.title}${p !== 1 ? ` × ${p}` : ""}`, grams: null, kcal: (n.manualKcal ?? per.kcal) * p, protein: per.protein * p, carbs: per.carbs * p, fat: per.fat * p, recipeId: b.recipeId };
  } else if (b.foodId) {
    const f = FOODS.find((x) => x.id === b.foodId); if (!f) return void res.status(404).json({ error: "Onbekend voedingsmiddel" });
    const grams = b.grams ?? f.unit ?? 100; const m = macrosFor(f, grams);
    entry = { memberId: b.memberId, date: b.date, slot: b.slot, text: `${b.text?.trim() || f.names[0]} (${Math.round(grams)} g)`, grams, ...m, recipeId: null };
  } else if (b.text && b.kcal === undefined) {
    // vrije tekst zoals "2 eieren" of "1 banaan": schatten uit de tabel
    const est = estimateLine(b.text); const f = est.food ? FOODS.find((x) => x.id === est.food) : null;
    if (!f || est.grams === null) return void res.status(422).json({ error: "Onbekend product: geef de calorieën zelf op." });
    const m = macrosFor(f, est.grams);
    entry = { memberId: b.memberId, date: b.date, slot: b.slot, text: `${b.text.trim()} (${est.grams} g)`, grams: est.grams, ...m, recipeId: null };
  } else {
    if (!b.text || b.kcal === undefined) return void res.status(400).json({ error: "Geef een omschrijving en calorieën op." });
    entry = { memberId: b.memberId, date: b.date, slot: b.slot, text: b.text.trim(), grams: b.grams ?? null, kcal: b.kcal, protein: b.protein ?? 0, carbs: b.carbs ?? 0, fat: b.fat ?? 0, recipeId: null };
  }
  const saved = S.addDietEntry(entry);
  const warn = S.forbiddenFor(saved.text + " " + (b.recipeId ? (S.getRecipe(b.recipeId)?.ingredients ?? "") : "")).find((w) => w.memberId === b.memberId);
  res.json({ entry: saved, warning: warn ? warn.hits : [] }); broadcast("diet");
});
api.delete("/diet/log/:id", (req, res) => { S.deleteDietEntry(req.params.id); res.json({ ok: true }); broadcast("diet"); });
api.get("/recipes/:id/nutrition", (req, res) => {
  const n = S.recipeNutrition(req.params.id); if (!n) return void res.status(404).json({ error: "Recept niet gevonden" });
  const r = S.getRecipe(req.params.id);
  res.json({ ...n, forbidden: S.forbiddenFor(`${r?.title ?? ""}\n${r?.ingredients ?? ""}\n${r?.original?.ingredients ?? ""}`) });
});
api.put("/recipes/:id/kcal", (req, res) => { const b = z.object({ kcal: z.number().int().min(0).max(5000).nullable() }).parse(req.body); S.setRecipeKcal(req.params.id, b.kcal); res.json({ ok: true }); broadcast("recipes", "diet"); });

// ---------- koran ----------
api.get("/quran/surahs", async (_req, res) => {
  try { res.json({ surahs: await quranSurahs(), reciters: RECITERS, translations: TRANSLATIONS }); } catch (e) { res.status(502).json({ error: e instanceof Error ? e.message : "De Koran kon niet geladen worden." }); }
});
api.get("/quran/surah/:n", async (req, res) => {
  const n = Number(req.params.n);
  if (!(n >= 1 && n <= 114)) return void res.status(404).json({ error: "Onbekende soera." });
  const q = z.object({ translation: z.string().regex(/^[a-z]{2}\.[a-z0-9-]+$/).optional() }).parse(req.query);
  try { res.json(await quranSurah(n, q.translation ?? getSettings().quran_translation)); } catch (e) { res.status(502).json({ error: e instanceof Error ? e.message : "De soera kon niet geladen worden." }); }
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
