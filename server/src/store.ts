import { z } from "zod";
import { all, get, run, newId, tx } from "./db.js";
import { weekday } from "./dates.js";

// ---------- gezinsleden ----------
export interface Member { id: string; name: string; color: string; avatar: string; photo: string | null; role: "ouder" | "kind"; sort: number }
export const MemberInput = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  avatar: z.string().max(16).default(""),
  photo: z.string().nullable().optional(),
  role: z.enum(["ouder", "kind"]).default("kind"),
});
export const listMembers = () => all<Member>("SELECT * FROM members ORDER BY sort, name");
export function createMember(i: z.infer<typeof MemberInput>): Member {
  const id = newId();
  const sort = (get<{ n: number }>("SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM members")?.n ?? 0);
  run("INSERT INTO members(id, name, color, avatar, photo, role, sort) VALUES (?,?,?,?,?,?,?)", id, i.name, i.color, i.avatar, i.photo ?? null, i.role, sort);
  return get<Member>("SELECT * FROM members WHERE id=?", id)!;
}
export function updateMember(id: string, i: z.infer<typeof MemberInput>) {
  run("UPDATE members SET name=?, color=?, avatar=?, photo=?, role=? WHERE id=?", i.name, i.color, i.avatar, i.photo ?? null, i.role, id);
  return get<Member>("SELECT * FROM members WHERE id=?", id);
}
export function deleteMember(id: string) {
  tx(() => {
    run("DELETE FROM members WHERE id=?", id);
    // verwijder het lid ook uit afspraken en agenda-koppelingen
    for (const t of ["events", "calendars"]) {
      for (const r of all<{ id: string; members: string }>(`SELECT id, members FROM ${t} WHERE members LIKE ?`, `%${id}%`)) {
        run(`UPDATE ${t} SET members=? WHERE id=?`, JSON.stringify((JSON.parse(r.members) as string[]).filter((m) => m !== id)), r.id);
      }
    }
  });
}
export function reorderMembers(ids: string[]) {
  tx(() => ids.forEach((id, i) => run("UPDATE members SET sort=? WHERE id=?", i, id)));
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
export const listChores = () => all<ChoreRow>("SELECT * FROM chores ORDER BY sort, title").map(toChore);
export function createChore(i: z.infer<typeof ChoreInput>) {
  const id = newId();
  run("INSERT INTO chores(id, member_id, title, icon, days, points) VALUES (?,?,?,?,?,?)", id, i.memberId, i.title, i.icon, JSON.stringify(i.days), i.points);
  return toChore(get<ChoreRow>("SELECT * FROM chores WHERE id=?", id)!);
}
export function updateChore(id: string, i: z.infer<typeof ChoreInput>) {
  run("UPDATE chores SET member_id=?, title=?, icon=?, days=?, points=? WHERE id=?", i.memberId, i.title, i.icon, JSON.stringify(i.days), i.points, id);
}
export const deleteChore = (id: string) => run("DELETE FROM chores WHERE id=?", id);
export const choresOn = (date: string) => listChores().filter((c) => c.days.includes(weekday(date)));
export const doneBetween = (from: string, to: string) =>
  all<{ chore_id: string; date: string }>("SELECT chore_id, date FROM chore_done WHERE date BETWEEN ? AND ?", from, to).map((r) => `${r.date}|${r.chore_id}`);
export function setChoreDone(choreId: string, date: string, done: boolean) {
  if (done) run("INSERT OR IGNORE INTO chore_done(chore_id, date) VALUES (?,?)", choreId, date);
  else run("DELETE FROM chore_done WHERE chore_id=? AND date=?", choreId, date);
}

// ---------- beloningen ----------
export const RewardInput = z.object({ title: z.string().trim().min(1).max(80), icon: z.string().max(16).default("🎁"), cost: z.number().int().min(1).max(10000) });
export const listRewards = () => all<{ id: string; title: string; icon: string; cost: number }>("SELECT * FROM rewards ORDER BY cost");
export function createReward(i: z.infer<typeof RewardInput>) {
  run("INSERT INTO rewards(id, title, icon, cost) VALUES (?,?,?,?)", newId(), i.title, i.icon, i.cost);
}
export const deleteReward = (id: string) => run("DELETE FROM rewards WHERE id=?", id);
export function points(): Record<string, { earned: number; spent: number; balance: number }> {
  const earned = all<{ member_id: string; n: number }>(
    "SELECT c.member_id, SUM(c.points) AS n FROM chore_done d JOIN chores c ON c.id = d.chore_id GROUP BY c.member_id",
  );
  const spent = all<{ member_id: string; n: number }>("SELECT member_id, SUM(cost) AS n FROM reward_claims GROUP BY member_id");
  const out: Record<string, { earned: number; spent: number; balance: number }> = {};
  for (const m of listMembers()) {
    const e = earned.find((r) => r.member_id === m.id)?.n ?? 0;
    const s = spent.find((r) => r.member_id === m.id)?.n ?? 0;
    out[m.id] = { earned: e, spent: s, balance: e - s };
  }
  return out;
}
export function claimReward(rewardId: string, memberId: string): string | null {
  const r = get<{ cost: number }>("SELECT cost FROM rewards WHERE id=?", rewardId);
  if (!r) return "Deze beloning bestaat niet meer.";
  if ((points()[memberId]?.balance ?? 0) < r.cost) return "Niet genoeg sterren voor deze beloning.";
  run("INSERT INTO reward_claims(id, reward_id, member_id, cost) VALUES (?,?,?,?)", newId(), rewardId, memberId, r.cost);
  return null;
}

// ---------- recepten & maaltijden ----------
export const SLOTS = ["ontbijt", "lunch", "diner", "snack"] as const;
export const RecipeInput = z.object({
  title: z.string().trim().min(1).max(120),
  ingredients: z.string().max(4000).default(""),
  instructions: z.string().max(8000).default(""),
  minutes: z.number().int().min(0).max(1440).nullable().optional(),
});
export const listRecipes = () => all<{ id: string; title: string; ingredients: string; instructions: string; minutes: number | null }>("SELECT * FROM recipes ORDER BY title");
export function createRecipe(i: z.infer<typeof RecipeInput>) {
  const id = newId();
  run("INSERT INTO recipes(id, title, ingredients, instructions, minutes) VALUES (?,?,?,?,?)", id, i.title, i.ingredients, i.instructions, i.minutes ?? null);
  return id;
}
export const updateRecipe = (id: string, i: z.infer<typeof RecipeInput>) =>
  run("UPDATE recipes SET title=?, ingredients=?, instructions=?, minutes=? WHERE id=?", i.title, i.ingredients, i.instructions, i.minutes ?? null, id);
export const deleteRecipe = (id: string) => run("DELETE FROM recipes WHERE id=?", id);

export const mealsBetween = (from: string, to: string) =>
  all<{ date: string; slot: string; title: string; recipe_id: string | null }>("SELECT * FROM meals WHERE date BETWEEN ? AND ? ORDER BY date", from, to)
    .map((m) => ({ date: m.date, slot: m.slot, title: m.title, recipeId: m.recipe_id }));
export function setMeal(date: string, slot: string, title: string, recipeId: string | null = null) {
  if (!title.trim()) run("DELETE FROM meals WHERE date=? AND slot=?", date, slot);
  else run(
    "INSERT INTO meals(date, slot, title, recipe_id) VALUES (?,?,?,?) ON CONFLICT(date, slot) DO UPDATE SET title=excluded.title, recipe_id=excluded.recipe_id",
    date, slot, title.trim(), recipeId,
  );
}

// ---------- lijsten ----------
export const listLists = () => {
  const lists = all<{ id: string; name: string; icon: string }>("SELECT id, name, icon FROM lists ORDER BY sort, name");
  const items = all<{ id: string; list_id: string; text: string; done: number }>("SELECT id, list_id, text, done FROM list_items ORDER BY done, created_at");
  return lists.map((l) => ({ ...l, items: items.filter((i) => i.list_id === l.id).map((i) => ({ id: i.id, text: i.text, done: !!i.done })) }));
};
export function createList(name: string, icon = "📝") {
  const id = newId();
  run("INSERT INTO lists(id, name, icon, sort) VALUES (?,?,?,(SELECT COALESCE(MAX(sort),-1)+1 FROM lists))", id, name, icon);
  return id;
}
export const deleteList = (id: string) => run("DELETE FROM lists WHERE id=?", id);
export function findList(name: string) {
  const n = name.trim().toLocaleLowerCase("nl");
  return listLists().find((l) => l.name.toLocaleLowerCase("nl") === n || l.name.toLocaleLowerCase("nl").startsWith(n));
}
export function addItem(listId: string, text: string) {
  const id = newId();
  run("INSERT INTO list_items(id, list_id, text) VALUES (?,?,?)", id, listId, text.trim());
  return id;
}
export const setItemDone = (id: string, done: boolean) => run("UPDATE list_items SET done=? WHERE id=?", done ? 1 : 0, id);
export const updateItemText = (id: string, text: string) => run("UPDATE list_items SET text=? WHERE id=?", text.trim(), id);
export const deleteItem = (id: string) => run("DELETE FROM list_items WHERE id=?", id);
export const clearDone = (listId: string) => run("DELETE FROM list_items WHERE list_id=? AND done=1", listId);

// ---------- foto's ----------
export const listPhotos = () => all<{ id: string; filename: string; created_at: string }>("SELECT * FROM photos ORDER BY created_at DESC");

// ---------- externe agenda's ----------
export interface CalendarSub { id: string; name: string; url: string; members: string[]; lastSync: string | null; lastError: string | null }
export const CalendarInput = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().trim().url().refine((u) => /^(https?|webcal):/i.test(u), "Gebruik een https:// of webcal:// adres"),
  members: z.array(z.string()).default([]),
});
export const listCalendars = (): CalendarSub[] =>
  all<{ id: string; name: string; url: string; members: string; last_sync: string | null; last_error: string | null }>("SELECT * FROM calendars ORDER BY name")
    .map((c) => ({ id: c.id, name: c.name, url: c.url, members: JSON.parse(c.members), lastSync: c.last_sync, lastError: c.last_error }));
