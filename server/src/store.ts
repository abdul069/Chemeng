import { z } from "zod";
import { all, get, run, newId, tx, hid } from "./db.js";
import { weekday } from "./dates.js";

// ---------- gezinsleden ----------
export interface Member { id: string; name: string; color: string; avatar: string; photo: string | null; role: "ouder" | "kind"; sort: number; userId: string | null }
export const MemberInput = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  avatar: z.string().max(16).default(""),
  photo: z.string().nullable().optional(),
  role: z.enum(["ouder", "kind"]).default("kind"),
});
type MemberRow = Omit<Member, "userId"> & { user_id: string | null };
const MEMBER_SQL = `SELECT m.id, m.name, m.color, m.avatar, m.photo, m.role, m.sort, hu.user_id
  FROM members m LEFT JOIN household_users hu ON hu.member_id = m.id AND hu.household_id = m.household_id`;
const toMember = ({ user_id, ...m }: MemberRow): Member => ({ ...m, userId: user_id });
export const listMembers = (h = hid()) => all<MemberRow>(`${MEMBER_SQL} WHERE m.household_id=? ORDER BY m.sort, m.name`, h).map(toMember);
export const getMember = (id: string) => listMembers().find((m) => m.id === id);
export function createMember(i: z.infer<typeof MemberInput>, h = hid()): Member {
  const id = newId();
  const sort = get<{ n: number }>("SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM members WHERE household_id=?", h)?.n ?? 0;
  run("INSERT INTO members(id, household_id, name, color, avatar, photo, role, sort) VALUES (?,?,?,?,?,?,?,?)", id, h, i.name, i.color, i.avatar, i.photo ?? null, i.role, sort);
  return listMembers(h).find((m) => m.id === id)!;
}
export function updateMember(id: string, i: z.infer<typeof MemberInput>) {
  run("UPDATE members SET name=?, color=?, avatar=?, photo=?, role=? WHERE id=? AND household_id=?", i.name, i.color, i.avatar, i.photo ?? null, i.role, id, hid());
  return getMember(id);
}
export function deleteMember(id: string) {
  const h = hid();
  tx(() => {
    run("DELETE FROM members WHERE id=? AND household_id=?", id, h);
    // verwijder het lid ook uit afspraken en agenda-koppelingen
    for (const t of ["events", "calendars"]) {
      for (const r of all<{ id: string; members: string }>(`SELECT id, members FROM ${t} WHERE household_id=? AND members LIKE ?`, h, `%${id}%`)) {
        run(`UPDATE ${t} SET members=? WHERE id=?`, JSON.stringify((JSON.parse(r.members) as string[]).filter((m) => m !== id)), r.id);
      }
    }
  });
}
export function reorderMembers(ids: string[]) {
  const h = hid();
  tx(() => ids.forEach((id, i) => run("UPDATE members SET sort=? WHERE id=? AND household_id=?", i, id, h)));
}
export const memberByName = (name: string) =>
  listMembers().find((m) => m.name.toLocaleLowerCase("nl") === name.trim().toLocaleLowerCase("nl"));

// ---------- taken ----------
export interface Chore { id: string; memberId: string; title: string; icon: string; days: number[]; points: number }
export const ChoreInput = z.object({
  memberId: z.string(),
  title: z.string().trim().min(1).max(80),
  icon: z.string().max(16).default("✅"),
  days: z.array(z.number().int().min(0).max(6)).min(1).default([0, 1, 2, 3, 4, 5, 6]),
  points: z.number().int().min(0).max(100).default(1),
});
type ChoreRow = { id: string; member_id: string; title: string; icon: string; days: string; points: number };
const toChore = (r: ChoreRow): Chore => ({ id: r.id, memberId: r.member_id, title: r.title, icon: r.icon, days: JSON.parse(r.days), points: r.points });
export const listChores = () => all<ChoreRow>("SELECT * FROM chores WHERE household_id=? ORDER BY sort, title", hid()).map(toChore);
const ownsMember = (memberId: string) => !!get("SELECT 1 FROM members WHERE id=? AND household_id=?", memberId, hid());
const ownsChore = (choreId: string) => !!get("SELECT 1 FROM chores WHERE id=? AND household_id=?", choreId, hid());
export function createChore(i: z.infer<typeof ChoreInput>) {
  if (!ownsMember(i.memberId)) throw new Error("Onbekend gezinslid");
  const id = newId();
  run("INSERT INTO chores(id, household_id, member_id, title, icon, days, points) VALUES (?,?,?,?,?,?,?)", id, hid(), i.memberId, i.title, i.icon, JSON.stringify(i.days), i.points);
  return toChore(get<ChoreRow>("SELECT * FROM chores WHERE id=?", id)!);
}
export function updateChore(id: string, i: z.infer<typeof ChoreInput>) {
  if (!ownsMember(i.memberId)) throw new Error("Onbekend gezinslid");
  run("UPDATE chores SET member_id=?, title=?, icon=?, days=?, points=? WHERE id=? AND household_id=?", i.memberId, i.title, i.icon, JSON.stringify(i.days), i.points, id, hid());
}
export const deleteChore = (id: string) => run("DELETE FROM chores WHERE id=? AND household_id=?", id, hid());
export const choresOn = (date: string) => listChores().filter((c) => c.days.includes(weekday(date)));
export const doneBetween = (from: string, to: string) =>
  all<{ chore_id: string; date: string }>(
    "SELECT d.chore_id, d.date FROM chore_done d JOIN chores c ON c.id = d.chore_id WHERE c.household_id=? AND d.date BETWEEN ? AND ?", hid(), from, to,
  ).map((r) => `${r.date}|${r.chore_id}`);
export function setChoreDone(choreId: string, date: string, done: boolean) {
  if (!ownsChore(choreId)) return;
  if (done) run("INSERT OR IGNORE INTO chore_done(chore_id, date) VALUES (?,?)", choreId, date);
  else run("DELETE FROM chore_done WHERE chore_id=? AND date=?", choreId, date);
}

// ---------- beloningen ----------
export const RewardInput = z.object({ title: z.string().trim().min(1).max(80), icon: z.string().max(16).default("🎁"), cost: z.number().int().min(1).max(10000) });
export const listRewards = () => all<{ id: string; title: string; icon: string; cost: number }>("SELECT id, title, icon, cost FROM rewards WHERE household_id=? ORDER BY cost", hid());
export function createReward(i: z.infer<typeof RewardInput>) {
  run("INSERT INTO rewards(id, household_id, title, icon, cost) VALUES (?,?,?,?,?)", newId(), hid(), i.title, i.icon, i.cost);
}
export const deleteReward = (id: string) => run("DELETE FROM rewards WHERE id=? AND household_id=?", id, hid());
export function points(): Record<string, { earned: number; spent: number; balance: number }> {
  const h = hid();
  const earned = all<{ member_id: string; n: number }>(
    "SELECT c.member_id, SUM(c.points) AS n FROM chore_done d JOIN chores c ON c.id = d.chore_id WHERE c.household_id=? GROUP BY c.member_id", h,
  );
  const spent = all<{ member_id: string; n: number }>(
    "SELECT rc.member_id, SUM(rc.cost) AS n FROM reward_claims rc JOIN members m ON m.id = rc.member_id WHERE m.household_id=? GROUP BY rc.member_id", h,
  );
  const out: Record<string, { earned: number; spent: number; balance: number }> = {};
  for (const m of listMembers()) {
    const e = earned.find((r) => r.member_id === m.id)?.n ?? 0;
    const s = spent.find((r) => r.member_id === m.id)?.n ?? 0;
    out[m.id] = { earned: e, spent: s, balance: e - s };
  }
  return out;
}
export function claimReward(rewardId: string, memberId: string): string | null {
  const r = get<{ cost: number }>("SELECT cost FROM rewards WHERE id=? AND household_id=?", rewardId, hid());
  if (!r) return "Deze beloning bestaat niet meer.";
  if (!ownsMember(memberId)) return "Onbekend gezinslid.";
  if ((points()[memberId]?.balance ?? 0) < r.cost) return "Niet genoeg sterren voor deze beloning.";
  run("INSERT INTO reward_claims(id, reward_id, member_id, cost) VALUES (?,?,?,?)", newId(), rewardId, memberId, r.cost);
  return null;
}

// ---------- recepten & maaltijden ----------
export const SLOTS = ["ontbijt", "lunch", "diner", "snack"] as const;
export const RecipeInput = z.object({
  title: z.string().trim().min(1).max(160),
  ingredients: z.string().max(6000).default(""),
  instructions: z.string().max(20000).default(""),
  minutes: z.number().int().min(0).max(1440).nullable().optional(),
  image: z.string().max(2000).nullable().optional(),
  sourceUrl: z.string().max(2000).nullable().optional(),
  servings: z.string().max(60).default(""),
  cuisine: z.string().max(60).default(""),
});
export type RecipeInputT = z.infer<typeof RecipeInput>;
export interface Recipe { id: string; title: string; ingredients: string; instructions: string; minutes: number | null; image: string | null; sourceUrl: string | null; servings: string; cuisine: string }
type RecipeRow = Omit<Recipe, "sourceUrl"> & { source_url: string | null };
export const listRecipes = (): Recipe[] =>
  all<RecipeRow>(
    "SELECT id, title, ingredients, instructions, minutes, image, source_url, servings, cuisine FROM recipes WHERE household_id=? ORDER BY title", hid(),
  ).map(({ source_url, ...r }) => ({ ...r, sourceUrl: source_url }));
export function createRecipe(i: RecipeInputT) {
  const id = newId();
  run(
    "INSERT INTO recipes(id, household_id, title, ingredients, instructions, minutes, image, source_url, servings, cuisine) VALUES (?,?,?,?,?,?,?,?,?,?)",
    id, hid(), i.title, i.ingredients, i.instructions, i.minutes ?? null, i.image ?? null, i.sourceUrl ?? null, i.servings, i.cuisine,
  );
  return id;
}
export const updateRecipe = (id: string, i: RecipeInputT) =>
  run(
    "UPDATE recipes SET title=?, ingredients=?, instructions=?, minutes=?, image=?, source_url=?, servings=?, cuisine=? WHERE id=? AND household_id=?",
    i.title, i.ingredients, i.instructions, i.minutes ?? null, i.image ?? null, i.sourceUrl ?? null, i.servings, i.cuisine, id, hid(),
  );
export const deleteRecipe = (id: string) => run("DELETE FROM recipes WHERE id=? AND household_id=?", id, hid());
export const recipeBySource = (url: string) => listRecipes().find((r) => r.sourceUrl === url);

export const mealsBetween = (from: string, to: string) =>
  all<{ date: string; slot: string; title: string; recipe_id: string | null }>(
    "SELECT date, slot, title, recipe_id FROM meals WHERE household_id=? AND date BETWEEN ? AND ? ORDER BY date", hid(), from, to,
  ).map((m) => ({ date: m.date, slot: m.slot, title: m.title, recipeId: m.recipe_id }));
export function setMeal(date: string, slot: string, title: string, recipeId: string | null = null) {
  const h = hid();
  if (recipeId && !get("SELECT 1 FROM recipes WHERE id=? AND household_id=?", recipeId, h)) recipeId = null;
  if (!title.trim()) run("DELETE FROM meals WHERE household_id=? AND date=? AND slot=?", h, date, slot);
  else run(
    `INSERT INTO meals(household_id, date, slot, title, recipe_id) VALUES (?,?,?,?,?)
     ON CONFLICT(household_id, date, slot) DO UPDATE SET title=excluded.title, recipe_id=excluded.recipe_id`,
    h, date, slot, title.trim(), recipeId,
  );
}

// ---------- lijsten ----------
export const listLists = () => {
  const h = hid();
  const lists = all<{ id: string; name: string; icon: string }>("SELECT id, name, icon FROM lists WHERE household_id=? ORDER BY sort, name", h);
  const items = all<{ id: string; list_id: string; text: string; done: number }>(
    "SELECT i.id, i.list_id, i.text, i.done FROM list_items i JOIN lists l ON l.id = i.list_id WHERE l.household_id=? ORDER BY i.done, i.created_at", h,
  );
  return lists.map((l) => ({ ...l, items: items.filter((i) => i.list_id === l.id).map((i) => ({ id: i.id, text: i.text, done: !!i.done })) }));
};
export function createList(name: string, icon = "📝", h = hid()) {
  const id = newId();
  run("INSERT INTO lists(id, household_id, name, icon, sort) VALUES (?,?,?,?,(SELECT COALESCE(MAX(sort),-1)+1 FROM lists WHERE household_id=?))", id, h, name, icon, h);
  return id;
}
export const deleteList = (id: string) => run("DELETE FROM lists WHERE id=? AND household_id=?", id, hid());
export function findList(name: string) {
  const n = name.trim().toLocaleLowerCase("nl");
  return listLists().find((l) => l.name.toLocaleLowerCase("nl") === n || l.name.toLocaleLowerCase("nl").startsWith(n));
}
const ownsList = (listId: string) => !!get("SELECT 1 FROM lists WHERE id=? AND household_id=?", listId, hid());
const ITEM_OWNED = "id=? AND list_id IN (SELECT id FROM lists WHERE household_id=?)";
export function addItem(listId: string, text: string) {
  if (!ownsList(listId)) throw new Error("Onbekende lijst");
  const id = newId();
  run("INSERT INTO list_items(id, list_id, text) VALUES (?,?,?)", id, listId, text.trim());
  return id;
}
export const setItemDone = (id: string, done: boolean) => run(`UPDATE list_items SET done=? WHERE ${ITEM_OWNED}`, done ? 1 : 0, id, hid());
export const updateItemText = (id: string, text: string) => run(`UPDATE list_items SET text=? WHERE ${ITEM_OWNED}`, text.trim(), id, hid());
export const deleteItem = (id: string) => run(`DELETE FROM list_items WHERE ${ITEM_OWNED}`, id, hid());
export const clearDone = (listId: string) => { if (ownsList(listId)) run("DELETE FROM list_items WHERE list_id=? AND done=1", listId); };

// ---------- foto's ----------
export const listPhotos = () => all<{ id: string; filename: string; created_at: string }>("SELECT id, filename, created_at FROM photos WHERE household_id=? ORDER BY created_at DESC", hid());

// ---------- externe agenda's ----------
export interface CalendarSub { id: string; householdId: string; name: string; url: string; members: string[]; lastSync: string | null; lastError: string | null }
export const CalendarInput = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().trim().url().refine((u) => /^(https?|webcal):/i.test(u), "Gebruik een https:// of webcal:// adres"),
  members: z.array(z.string()).default([]),
});
type CalRow = { id: string; household_id: string; name: string; url: string; members: string; last_sync: string | null; last_error: string | null };
const toCal = (c: CalRow): CalendarSub => ({ id: c.id, householdId: c.household_id, name: c.name, url: c.url, members: JSON.parse(c.members), lastSync: c.last_sync, lastError: c.last_error });
export const listCalendars = (): CalendarSub[] => all<CalRow>("SELECT * FROM calendars WHERE household_id=? ORDER BY name", hid()).map(toCal);
export const allCalendars = (): CalendarSub[] => all<CalRow>("SELECT * FROM calendars").map(toCal);
