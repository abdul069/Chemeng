import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "data");
export const PHOTO_DIR = path.join(DATA_DIR, "photos");
fs.mkdirSync(PHOTO_DIR, { recursive: true });

const DB_FILE = process.env.DB_FILE ?? path.join(DATA_DIR, "gezinsbord.sqlite");

// Versie 1 had geen accounts. Die database bewaren we als back-up en we starten met het nieuwe schema.
function backupLegacy() {
  if (!fs.existsSync(DB_FILE)) return;
  const probe = new DatabaseSync(DB_FILE);
  const hasMembers = probe.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='members'").get();
  const hasHouseholds = probe.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='households'").get();
  probe.close();
  if (hasMembers && !hasHouseholds) {
    const backup = `${DB_FILE}.v1-${Date.now()}.bak`;
    for (const ext of ["", "-wal", "-shm"]) if (fs.existsSync(DB_FILE + ext)) fs.renameSync(DB_FILE + ext, backup + ext);
    console.log(`[gezinsbord] Oude database zonder accounts bewaard als ${backup}`);
  }
}
backupLegacy();

export const db = new DatabaseSync(DB_FILE);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

export const newId = () => crypto.randomUUID();

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#2bb3a8',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '',
  photo TEXT,
  role TEXT NOT NULL DEFAULT 'kind',
  sort INTEGER NOT NULL DEFAULT 0
);
-- Wie van welk gezin deel uitmaakt, en aan welk profiel het account gekoppeld is
CREATE TABLE IF NOT EXISTS household_users (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'lid',
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  PRIMARY KEY (household_id, user_id)
);
-- owner laat viewer zijn eigen agenda zien (niet die van zijn gezin)
CREATE TABLE IF NOT EXISTS shares (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'details',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (owner_id, viewer_id)
);
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id TEXT REFERENCES households(id) ON DELETE CASCADE,
  member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'lid',
  label TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  used_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  end_date TEXT,
  start_time TEXT,
  end_time TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  repeat TEXT NOT NULL DEFAULT 'none',
  repeat_until TEXT,
  exdates TEXT NOT NULL DEFAULT '[]',
  members TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'local',
  external_uid TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS events_hh_date ON events(household_id, date);
CREATE INDEX IF NOT EXISTS events_source ON events(source);
CREATE TABLE IF NOT EXISTS chores (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '✅',
  days TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
  points INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS chore_done (
  chore_id TEXT NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  PRIMARY KEY (chore_id, date)
);
CREATE TABLE IF NOT EXISTS rewards (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '🎁',
  cost INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reward_claims (
  id TEXT PRIMARY KEY,
  reward_id TEXT NOT NULL REFERENCES rewards(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  cost INTEGER NOT NULL,
  claimed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  ingredients TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  minutes INTEGER
);
CREATE TABLE IF NOT EXISTS meals (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  slot TEXT NOT NULL,
  title TEXT NOT NULL,
  recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL,
  PRIMARY KEY (household_id, date, slot)
);
CREATE TABLE IF NOT EXISTS lists (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '📝',
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS list_items (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS calendars (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  members TEXT NOT NULL DEFAULT '[]',
  last_sync TEXT,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (household_id, key)
);
`);

// kolommen die later bijkwamen
function addColumn(table: string, col: string, def: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumn("recipes", "image", "TEXT");
addColumn("list_items", "aisle", "TEXT");
addColumn("recipes", "source_url", "TEXT");
addColumn("recipes", "servings", "TEXT NOT NULL DEFAULT ''");
addColumn("recipes", "cuisine", "TEXT NOT NULL DEFAULT ''");
addColumn("meals", "image", "TEXT");
// het origineel (bv. Turks) naast de Nederlandse versie
addColumn("recipes", "orig_title", "TEXT");
addColumn("recipes", "orig_ingredients", "TEXT");
addColumn("recipes", "orig_instructions", "TEXT");
addColumn("recipes", "orig_lang", "TEXT");
addColumn("recipes", "lang", "TEXT NOT NULL DEFAULT 'nl'");
addColumn("members", "birthday", "TEXT");
addColumn("members", "diet", "TEXT NOT NULL DEFAULT ''");
addColumn("recipes", "favorite", "INTEGER NOT NULL DEFAULT 0");
addColumn("recipes", "category", "TEXT NOT NULL DEFAULT ''");
addColumn("list_items", "member_id", "TEXT");
addColumn("lists", "kind", "TEXT NOT NULL DEFAULT 'list'");
// bestaande boodschappenlijsten krijgen de eigen soort "shopping"
db.exec("UPDATE lists SET kind='shopping' WHERE kind='list' AND (lower(name) LIKE '%boodschap%' OR lower(name) LIKE '%alışveriş%' OR lower(name) LIKE '%alisveris%')");
addColumn("list_items", "expires", "TEXT");
addColumn("list_items", "qty", "TEXT NOT NULL DEFAULT ''");
addColumn("events", "countdown", "INTEGER NOT NULL DEFAULT 0");
addColumn("chores", "moment", "TEXT NOT NULL DEFAULT 'altijd'");
db.exec(`CREATE TABLE IF NOT EXISTS dish_photos (title TEXT PRIMARY KEY, image TEXT, tried_at TEXT NOT NULL DEFAULT (datetime('now')))`);
db.exec(`
CREATE TABLE IF NOT EXISTS assistant_feedback (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS staples (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  aisle TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ezan_sounds (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filename TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS quran_cache (
  key TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS memos (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

type Row = Record<string, unknown>;
export const all = <T = Row>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...(p as never[])) as T[];
export const get = <T = Row>(sql: string, ...p: unknown[]) => db.prepare(sql).get(...(p as never[])) as T | undefined;
export const run = (sql: string, ...p: unknown[]) => db.prepare(sql).run(...(p as never[]));

export function tx<T>(fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// ---------- context van het verzoek: wie is ingelogd en welk gezin is actief ----------
export interface Ctx { userId: string; householdId: string }
const store = new AsyncLocalStorage<Ctx>();
export const withCtx = <T>(c: Ctx, fn: () => T) => store.run(c, fn);
export function ctx(): Ctx {
  const c = store.getStore();
  if (!c) throw new Error("Geen gezin actief");
  return c;
}
export const hid = () => ctx().householdId;

// ---------- instellingen per gezin ----------
export const DEFAULT_SETTINGS: Record<string, string> = {
  city: "Brussel",
  latitude: "50.85",
  longitude: "4.35",
  screensaver_minutes: "10",
  week_start: "1",
  // feestdagen in de kalender: "be" (Belgisch), "islam", beide gescheiden door een komma, of leeg
  holidays: "be,islam",
  assistant_voice: "1",
  settings_pin: "",
  // nachtrust: scherm gedimd tussen deze uren (leeg = uit)
  sleep_from: "",
  sleep_until: "",
  // na zoveel minuten zonder aanraking terug naar Vandaag (0 = nooit)
  home_after_minutes: "3",
  // ezan: aan/uit, rekenmethode, asr-school, welke gebeden klinken, geluid per gebed (JSON), minuten bijstellen (JSON), volume 0-100
  ezan_on: "0",
  ezan_method: "diyanet",
  ezan_asr: "standard",
  ezan_prayers: "fajr,dhuhr,asr,maghrib,isha",
  ezan_sounds: "{}",
  ezan_adjust: "{}",
  ezan_volume: "80",
  // taal van de app: nl of tr
  language: "nl",
  // koran: voordrager en vertaling
  quran_reciter: "ar.alafasy",
  quran_translation: "nl.siregar",
};

export function getSettings(householdId = hid()): Record<string, string> {
  const rows = all<{ key: string; value: string }>("SELECT key, value FROM settings WHERE household_id=?", householdId);
  const s: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value;
  s.family_name = get<{ name: string }>("SELECT name FROM households WHERE id=?", householdId)?.name ?? "";
  return s;
}

export function setSettings(values: Record<string, unknown>) {
  const h = hid();
  tx(() => {
    for (const [k, v] of Object.entries(values)) {
      if (k === "family_name") {
        const name = String(v ?? "").trim();
        if (name) run("UPDATE households SET name=? WHERE id=?", name.slice(0, 80), h);
        continue;
      }
      if (!(k in DEFAULT_SETTINGS)) continue;
      run("INSERT INTO settings(household_id, key, value) VALUES(?,?,?) ON CONFLICT(household_id, key) DO UPDATE SET value = excluded.value", h, k, String(v ?? ""));
    }
  });
}
