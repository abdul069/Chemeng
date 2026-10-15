import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "data");
export const PHOTO_DIR = path.join(DATA_DIR, "photos");
fs.mkdirSync(PHOTO_DIR, { recursive: true });

export const db = new DatabaseSync(process.env.DB_FILE ?? path.join(DATA_DIR, "gezinsbord.sqlite"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

export const newId = () => crypto.randomUUID();

db.exec(`
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '',
  photo TEXT,
  role TEXT NOT NULL DEFAULT 'kind',
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
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
CREATE INDEX IF NOT EXISTS events_date ON events(date);
CREATE INDEX IF NOT EXISTS events_source ON events(source);
CREATE TABLE IF NOT EXISTS chores (
  id TEXT PRIMARY KEY,
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
  title TEXT NOT NULL,
  ingredients TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  minutes INTEGER
);
CREATE TABLE IF NOT EXISTS meals (
  date TEXT NOT NULL,
  slot TEXT NOT NULL,
  title TEXT NOT NULL,
  recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL,
  PRIMARY KEY (date, slot)
);
CREATE TABLE IF NOT EXISTS lists (
  id TEXT PRIMARY KEY,
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
  filename TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS calendars (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  members TEXT NOT NULL DEFAULT '[]',
  last_sync TEXT,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

type Row = Record<string, unknown>;
export const all = <T = Row>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...(p as never[])) as T[];
export const get = <T = Row>(sql: string, ...p: unknown[]) => db.prepare(sql).get(...(p as never[])) as T | undefined;
export const run = (sql: string, ...p: unknown[]) => db.prepare(sql).run(...(p as never[]));

export function tx<T>(fn: () => T): T {
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

export const DEFAULT_SETTINGS: Record<string, string> = {
  family_name: "Ons gezin",
  city: "Brussel",
  latitude: "50.85",
  longitude: "4.35",
  screensaver_minutes: "10",
  week_start: "1",
  assistant_voice: "1",
  settings_pin: "",
};

export function getSettings(): Record<string, string> {
  const rows = all<{ key: string; value: string }>("SELECT key, value FROM settings");
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value;
  return s;
}

export function setSettings(values: Record<string, unknown>) {
  tx(() => {
    for (const [k, v] of Object.entries(values)) {
      if (!(k in DEFAULT_SETTINGS)) continue;
      run("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", k, String(v ?? ""));
    }
  });
}
