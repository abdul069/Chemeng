// Pushmeldingen op telefoon en tablet (Web Push): herinneringen voor afspraken, routines en memo's.
import webpush from "web-push";
import { all, get, run, newId, db } from "./db.js";
import { rowsBetween, toEvent, expand } from "./events.js";
import { today, addDays } from "./dates.js";

db.exec(`
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  subscription TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS push_sent (key TEXT PRIMARY KEY, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS global_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

// VAPID-sleutels: eenmaal aanmaken en bewaren in de database (of via env)
function vapid() {
  let pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    const row = get<{ value: string }>("SELECT value FROM global_settings WHERE key='vapid'");
    if (row) ({ pub, priv } = JSON.parse(row.value));
    else {
      const k = webpush.generateVAPIDKeys();
      pub = k.publicKey; priv = k.privateKey;
      run("INSERT INTO global_settings(key, value) VALUES('vapid', ?)", JSON.stringify({ pub, priv }));
    }
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:gezinsbord@example.com", pub!, priv!);
  return pub!;
}
export const VAPID_PUBLIC = vapid();

export function subscribe(userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, label: string) {
  run(
    "INSERT INTO push_subscriptions(id, user_id, endpoint, subscription, label) VALUES (?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, subscription=excluded.subscription, label=excluded.label",
    newId(), userId, sub.endpoint, JSON.stringify(sub), label,
  );
}
export const unsubscribe = (userId: string, endpoint: string) => run("DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?", userId, endpoint);
export const subscriptionsOf = (userId: string) => all<{ endpoint: string; label: string; created_at: string }>("SELECT endpoint, label, created_at FROM push_subscriptions WHERE user_id=?", userId);

export interface PushMessage { title: string; body: string; url?: string; tag?: string }

/** Stuurt een melding naar alle toestellen van deze gebruikers. */
export async function pushToUsers(userIds: string[], msg: PushMessage) {
  if (!userIds.length) return;
  const rows = all<{ endpoint: string; subscription: string }>(
    `SELECT endpoint, subscription FROM push_subscriptions WHERE user_id IN (${userIds.map(() => "?").join(",")})`, ...userIds,
  );
  await Promise.all(rows.map(async (r) => {
    try {
      await webpush.sendNotification(JSON.parse(r.subscription), JSON.stringify(msg), { TTL: 3600 });
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) run("DELETE FROM push_subscriptions WHERE endpoint=?", r.endpoint);
    }
  }));
}

/** Gebruikers van een gezin, optioneel enkel wie aan deze profielen gekoppeld is. */
function usersFor(householdId: string, memberIds: string[]): string[] {
  const rows = all<{ user_id: string; member_id: string | null }>("SELECT user_id, member_id FROM household_users WHERE household_id=?", householdId);
  if (!memberIds.length) return rows.map((r) => r.user_id);
  const direct = rows.filter((r) => r.member_id && memberIds.includes(r.member_id)).map((r) => r.user_id);
  // afspraken van kinderen zonder account: de ouders verwittigen
  const kidIds = memberIds.filter((m) => !rows.some((r) => r.member_id === m));
  const parents = kidIds.length ? rows.filter((r) => r.member_id && !!get("SELECT 1 FROM members WHERE id=? AND role='ouder'", r.member_id)).map((r) => r.user_id) : [];
  return [...new Set([...direct, ...parents])];
}

const once = (key: string) => {
  try { run("INSERT INTO push_sent(key) VALUES (?)", key); return true; } catch { return false; }
};

/** Elke minuut: afspraken die over 15 minuten beginnen, en om 7:30 een dagoverzicht. */
export async function tick() {
  const t = today();
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const households = all<{ id: string; name: string }>("SELECT id, name FROM households");
  for (const h of households) {
    const occ = rowsBetween(h.id, t, t).flatMap((r) => expand(toEvent(r), t, t));
    for (const o of occ) {
      if (o.allDay || !o.startTime || o.source === "shared") continue;
      const [sh, sm] = o.startTime.split(":").map(Number);
      const minutes = sh * 60 + sm - (now.getHours() * 60 + now.getMinutes());
      if (minutes >= 14 && minutes <= 15 && once(`ev|${o.key}|${t}`)) {
        await pushToUsers(usersFor(h.id, o.members), { title: `Over 15 minuten: ${o.title}`, body: `${o.startTime}${o.location ? ` · ${o.location}` : ""}`, url: "/#calendar", tag: `ev-${o.id}` });
      }
    }
    if (hm === "07:30" && once(`morning|${h.id}|${t}`)) {
      const todays = occ.filter((o) => o.source !== "shared").sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
      const chores = get<{ n: number }>("SELECT COUNT(*) AS n FROM chores WHERE household_id=?", h.id)?.n ?? 0;
      const lines = todays.slice(0, 4).map((o) => `${o.allDay ? "hele dag" : o.startTime} ${o.title}`);
      // voorraad die vandaag of morgen over datum gaat
      const expiring = all<{ text: string; expires: string }>(
        "SELECT i.text, i.expires FROM list_items i JOIN lists l ON l.id = i.list_id WHERE l.household_id=? AND l.kind='pantry' AND i.done=0 AND i.expires IS NOT NULL AND i.expires <= ? ORDER BY i.expires LIMIT 4", h.id, addDays(t, 1),
      );
      const expLine = expiring.length ? `\n🥫 Op eten: ${expiring.map((e) => `${e.text}${e.expires < t ? " (over datum)" : e.expires === t ? " (vandaag)" : ""}`).join(", ")}` : "";
      const dinner = get<{ title: string }>("SELECT title FROM meals WHERE household_id=? AND date=? AND slot='diner'", h.id, t)?.title;
      const body = (lines.length ? lines.join("\n") : "Geen afspraken vandaag.") + (todays.length > 4 ? `\n+${todays.length - 4} meer` : "") + (chores ? `\n${chores} taken staan klaar.` : "") + (dinner ? `\n🍽 Vanavond: ${dinner}` : "") + expLine;
      await pushToUsers(usersFor(h.id, []), { title: "Goeiemorgen! Dit staat er vandaag op", body, url: "/#today", tag: "morning" });
    }
  }
  run("DELETE FROM push_sent WHERE at < datetime('now','-3 days')");
}

export function startPushScheduler() {
  const run1 = () => tick().catch((e) => console.warn("[push]", e));
  setTimeout(run1, 10_000).unref();
  setInterval(run1, 60_000).unref();
}

/** Voor meldingen over een nieuwe memo of een nieuwe afspraak van iemand anders. */
export const notifyHousehold = (householdId: string, msg: PushMessage, exceptUser?: string) =>
  pushToUsers(usersFor(householdId, []).filter((u) => u !== exceptUser), msg);
