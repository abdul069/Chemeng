import express, { type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { z, ZodError } from "zod";
import { PHOTO_DIR, getSettings, setSettings, run, get, newId } from "./db.js";
import {
  EventInput, createEvent, deleteEvent, endSeriesBefore, eventsBetween, getEvent, skipOccurrence, updateEvent,
} from "./events.js";
import * as S from "./store.js";
import { broadcast } from "./realtime.js";
import { getWeather, geocode } from "./weather.js";
import { syncAll, syncCalendar } from "./ics.js";
import { chat, assistantAvailable, MODEL } from "./assistant.js";
import { authRequired, requireCode } from "./auth.js";
import { isDate } from "./dates.js";

export const api = express.Router();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const p = (req: Request) => req.params.id as string;

api.get("/health", (_req, res) => { res.json({ ok: true, authRequired: authRequired() }); });
api.use(requireCode);

function publicSettings() {
  const { settings_pin, ...rest } = getSettings();
  return { ...rest, has_pin: settings_pin.length > 0 };
}

api.get("/bootstrap", (_req, res) => {
  res.json({
    members: S.listMembers(), chores: S.listChores(), rewards: S.listRewards(), points: S.points(),
    lists: S.listLists(), recipes: S.listRecipes(), calendars: S.listCalendars(), photos: S.listPhotos(),
    settings: publicSettings(), assistant: { available: assistantAvailable(), model: MODEL },
  });
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
  res.json(eventsBetween(from, to, members));
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
});
api.post("/recipes", (req, res) => { res.json({ id: S.createRecipe(S.RecipeInput.parse(req.body)) }); broadcast("recipes"); });
api.put("/recipes/:id", (req, res) => { S.updateRecipe(p(req), S.RecipeInput.parse(req.body)); res.json({ ok: true }); broadcast("recipes"); });
api.delete("/recipes/:id", (req, res) => { S.deleteRecipe(p(req)); res.json({ ok: true }); broadcast("recipes", "meals"); });
api.post("/recipes/:id/to-list", (req, res) => {
  const recipe = S.listRecipes().find((r) => r.id === p(req));
  if (!recipe) return void res.status(404).json({ error: "Recept niet gevonden." });
  const listId = z.object({ listId: z.string() }).parse(req.body).listId;
  const items = recipe.ingredients.split("\n").map((s) => s.replace(/^[-*•\s]+/, "").trim()).filter(Boolean);
  items.forEach((it) => S.addItem(listId, it));
  res.json({ added: items.length });
  broadcast("lists");
});

// ---------- lijsten ----------
api.post("/lists", (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(60), icon: z.string().max(16).default("📝") }).parse(req.body);
  res.json({ id: S.createList(b.name, b.icon) });
  broadcast("lists");
});
api.delete("/lists/:id", (req, res) => { S.deleteList(p(req)); res.json({ ok: true }); broadcast("lists"); });
api.post("/lists/:id/items", (req, res) => {
  const text = z.object({ text: z.string().trim().min(1).max(200) }).parse(req.body).text;
  res.json({ id: S.addItem(p(req), text) });
  broadcast("lists");
});
api.post("/lists/:id/clear-done", (req, res) => { S.clearDone(p(req)); res.json({ ok: true }); broadcast("lists"); });
api.patch("/items/:id", (req, res) => {
  const b = z.object({ done: z.boolean().optional(), text: z.string().trim().min(1).max(200).optional() }).parse(req.body);
  if (b.done !== undefined) S.setItemDone(p(req), b.done);
  if (b.text) S.updateItemText(p(req), b.text);
  res.json({ ok: true });
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
  for (const f of files) run("INSERT INTO photos(id, filename) VALUES (?,?)", newId(), f.filename);
  res.json({ added: files.length });
  broadcast("photos");
});
api.post("/avatar", upload.single("photo"), (req, res) => {
  if (!req.file) return void res.status(400).json({ error: "Kies een afbeelding (jpg, png of webp)." });
  res.json({ filename: req.file.filename });
});
api.delete("/photos/:id", (req, res) => {
  const ph = get<{ filename: string }>("SELECT filename FROM photos WHERE id=?", p(req));
  if (ph) {
    run("DELETE FROM photos WHERE id=?", p(req));
    fs.rm(path.join(PHOTO_DIR, path.basename(ph.filename)), { force: true }, () => {});
  }
  res.json({ ok: true });
  broadcast("photos");
});
api.get("/photos/file/:name", (req, res) => {
  res.sendFile(path.join(PHOTO_DIR, path.basename(req.params.name as string)), { maxAge: "30d" }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// ---------- gekoppelde agenda's ----------
api.post("/calendars", async (req, res) => {
  const b = S.CalendarInput.parse(req.body);
  const id = newId();
  run("INSERT INTO calendars(id, name, url, members) VALUES (?,?,?,?)", id, b.name, b.url, JSON.stringify(b.members));
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
  run("UPDATE calendars SET name=?, url=?, members=? WHERE id=?", b.name, b.url, JSON.stringify(b.members), p(req));
  const cal = S.listCalendars().find((c) => c.id === p(req));
  if (cal) await syncCalendar(cal).catch(() => {});
  res.json({ ok: true });
  broadcast("calendars", "events");
});
api.delete("/calendars/:id", (req, res) => {
  run("DELETE FROM events WHERE source=?", p(req));
  run("DELETE FROM calendars WHERE id=?", p(req));
  res.json({ ok: true });
  broadcast("calendars", "events");
});
api.post("/calendars/sync", async (_req, res) => {
  await syncAll(() => broadcast("calendars", "events"));
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

// ---------- assistent ----------
const ChatBody = z.object({ messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) })).min(1).max(40) });
api.post("/assistant", async (req, res) => {
  const { messages } = ChatBody.parse(req.body);
  try {
    const out = await chat(messages);
    res.json(out);
    if (out.changes.length) broadcast("events", "meals", "chores", "lists", "rewards");
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
  console.error(err);
  res.status(500).json({ error: "Er ging iets mis op de server." });
});
