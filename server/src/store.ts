import { z } from "zod";
import { all, get, run, newId, tx, hid } from "./db.js";
import { weekday, today as todayStr, addDays as addDaysStr } from "./dates.js";

// ---------- gezinsleden ----------
export interface Member { id: string; name: string; color: string; avatar: string; photo: string | null; role: "ouder" | "kind" | "huisdier"; sort: number; userId: string | null; birthday: string | null; /** vermijden: allergieën en voorkeuren, komma-gescheiden */ diet: string }
export const MemberInput = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  avatar: z.string().max(16).default(""),
  photo: z.string().nullable().optional(),
  role: z.enum(["ouder", "kind", "huisdier"]).default("kind"),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  diet: z.string().max(200).default(""),
});
type MemberRow = Omit<Member, "userId"> & { user_id: string | null };
const MEMBER_SQL = `SELECT m.id, m.name, m.color, m.avatar, m.photo, m.role, m.sort, m.birthday, m.diet, hu.user_id
  FROM members m LEFT JOIN household_users hu ON hu.member_id = m.id AND hu.household_id = m.household_id`;
const toMember = ({ user_id, ...m }: MemberRow): Member => ({ ...m, userId: user_id });
export const listMembers = (h = hid()) => all<MemberRow>(`${MEMBER_SQL} WHERE m.household_id=? ORDER BY m.sort, m.name`, h).map(toMember);
export const getMember = (id: string) => listMembers().find((m) => m.id === id);
export function createMember(i: z.input<typeof MemberInput>, h = hid()): Member {
  const id = newId();
  const sort = get<{ n: number }>("SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM members WHERE household_id=?", h)?.n ?? 0;
  run("INSERT INTO members(id, household_id, name, color, avatar, photo, role, sort, birthday, diet) VALUES (?,?,?,?,?,?,?,?,?,?)", id, h, i.name, i.color, i.avatar ?? "", i.photo ?? null, i.role ?? "kind", sort, i.birthday ?? null, (i.diet ?? "").trim());
  return listMembers(h).find((m) => m.id === id)!;
}
export function updateMember(id: string, i: z.input<typeof MemberInput>) {
  run("UPDATE members SET name=?, color=?, avatar=?, photo=?, role=?, birthday=?, diet=? WHERE id=? AND household_id=?", i.name, i.color, i.avatar ?? "", i.photo ?? null, i.role ?? "kind", i.birthday ?? null, (i.diet ?? "").trim(), id, hid());
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
export const MOMENTS = ["ochtend", "middag", "avond", "altijd"] as const;
export type Moment = (typeof MOMENTS)[number];
export interface Chore { id: string; memberId: string; title: string; icon: string; days: number[]; points: number; moment: Moment; streak: number }
export const ChoreInput = z.object({
  memberId: z.string(),
  title: z.string().trim().min(1).max(80),
  icon: z.string().max(16).default("✅"),
  days: z.array(z.number().int().min(0).max(6)).min(1).default([0, 1, 2, 3, 4, 5, 6]),
  points: z.number().int().min(0).max(100).default(1),
  moment: z.enum(MOMENTS).default("altijd"),
});
type ChoreRow = { id: string; member_id: string; title: string; icon: string; days: string; points: number; moment: string };
const toChore = (r: ChoreRow, streak = 0): Chore => ({ id: r.id, memberId: r.member_id, title: r.title, icon: r.icon, days: JSON.parse(r.days), points: r.points, moment: (MOMENTS as readonly string[]).includes(r.moment) ? (r.moment as Moment) : "altijd", streak });
/** Hoeveel geplande dagen op rij is deze taak gedaan (vandaag telt mee als ze al gedaan is)? */
function streaks(h: string): Map<string, number> {
  const done = new Map<string, Set<string>>();
  for (const r of all<{ chore_id: string; date: string }>("SELECT d.chore_id, d.date FROM chore_done d JOIN chores c ON c.id = d.chore_id WHERE c.household_id=? AND d.date >= date('now','-120 days')", h)) {
    if (!done.has(r.chore_id)) done.set(r.chore_id, new Set());
    done.get(r.chore_id)!.add(r.date);
  }
  const out = new Map<string, number>();
  const t = todayStr();
  for (const c of all<ChoreRow>("SELECT * FROM chores WHERE household_id=?", h)) {
    const days: number[] = JSON.parse(c.days);
    const set = done.get(c.id) ?? new Set<string>();
    let n = 0;
    let d = t;
    // vandaag mag nog open staan zonder de reeks te breken
    if (!set.has(d)) d = addDaysStr(d, -1);
    for (let i = 0; i < 120; i++, d = addDaysStr(d, -1)) {
      if (!days.includes(weekday(d))) continue;
      if (set.has(d)) n++; else break;
    }
    out.set(c.id, n);
  }
  return out;
}
export const listChores = () => {
  const st = streaks(hid());
  return all<ChoreRow>("SELECT * FROM chores WHERE household_id=? ORDER BY sort, title", hid()).map((r) => toChore(r, st.get(r.id) ?? 0));
};
const ownsMember = (memberId: string) => !!get("SELECT 1 FROM members WHERE id=? AND household_id=?", memberId, hid());
const ownsChore = (choreId: string) => !!get("SELECT 1 FROM chores WHERE id=? AND household_id=?", choreId, hid());
export function createChore(i: z.infer<typeof ChoreInput>) {
  if (!ownsMember(i.memberId)) throw new Error("Onbekend gezinslid");
  const id = newId();
  run("INSERT INTO chores(id, household_id, member_id, title, icon, days, points, moment) VALUES (?,?,?,?,?,?,?,?)", id, hid(), i.memberId, i.title, i.icon, JSON.stringify(i.days), i.points, i.moment);
  return toChore(get<ChoreRow>("SELECT * FROM chores WHERE id=?", id)!);
}
export function updateChore(id: string, i: z.infer<typeof ChoreInput>) {
  if (!ownsMember(i.memberId)) throw new Error("Onbekend gezinslid");
  run("UPDATE chores SET member_id=?, title=?, icon=?, days=?, points=?, moment=? WHERE id=? AND household_id=?", i.memberId, i.title, i.icon, JSON.stringify(i.days), i.points, i.moment, id, hid());
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
/** Sterren verdiend in een periode, per gezinslid (voor "vandaag" en het weekklassement). */
export function pointsBetween(from: string, to: string): Record<string, number> {
  const rows = all<{ member_id: string; n: number }>(
    "SELECT c.member_id, SUM(c.points) AS n FROM chore_done d JOIN chores c ON c.id = d.chore_id WHERE c.household_id=? AND d.date BETWEEN ? AND ? GROUP BY c.member_id", hid(), from, to,
  );
  return Object.fromEntries(rows.map((r) => [r.member_id, r.n]));
}
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
  /** categorie (soep, kip, dessert …), zoals in de gedeelde bibliotheek */
  category: z.string().max(30).default(""),
  favorite: z.boolean().default(false),
  /** taal van title/ingredients/instructions */
  lang: z.string().max(8).default("nl"),
  original: z.object({ title: z.string(), ingredients: z.string(), instructions: z.string(), lang: z.string().max(8) }).nullable().optional(),
});
export type RecipeInputT = z.infer<typeof RecipeInput>;
export interface Recipe {
  id: string; title: string; ingredients: string; instructions: string; minutes: number | null; image: string | null; sourceUrl: string | null;
  servings: string; cuisine: string; lang: string; original: { title: string; ingredients: string; instructions: string; lang: string } | null;
  category: string; favorite: boolean; /** hoe vaak ingepland (ooit) */ cooked: number;
}
type RecipeRow = Omit<Recipe, "sourceUrl" | "original" | "favorite"> & { source_url: string | null; orig_title: string | null; orig_ingredients: string | null; orig_instructions: string | null; orig_lang: string | null; favorite: number };
export const listRecipes = (): Recipe[] =>
  all<RecipeRow>(
    `SELECT r.id, r.title, r.ingredients, r.instructions, r.minutes, r.image, r.source_url, r.servings, r.cuisine, r.lang, r.orig_title, r.orig_ingredients, r.orig_instructions, r.orig_lang,
            r.category, r.favorite, (SELECT COUNT(*) FROM meals m WHERE m.recipe_id = r.id AND m.date <= date('now')) AS cooked
     FROM recipes r WHERE r.household_id=? ORDER BY r.title`, hid(),
  ).map(({ source_url, orig_title, orig_ingredients, orig_instructions, orig_lang, favorite, ...r }) => ({
    ...r, favorite: !!favorite, sourceUrl: source_url,
    original: orig_title ? { title: orig_title, ingredients: orig_ingredients ?? "", instructions: orig_instructions ?? "", lang: orig_lang ?? "tr" } : null,
  }));
export function createRecipe(i: RecipeInputT) {
  const id = newId();
  run(
    `INSERT INTO recipes(id, household_id, title, ingredients, instructions, minutes, image, source_url, servings, cuisine, lang, orig_title, orig_ingredients, orig_instructions, orig_lang, category, favorite)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, hid(), i.title, i.ingredients, i.instructions, i.minutes ?? null, i.image ?? null, i.sourceUrl ?? null, i.servings, i.cuisine, i.lang,
    i.original?.title ?? null, i.original?.ingredients ?? null, i.original?.instructions ?? null, i.original?.lang ?? null, i.category, i.favorite ? 1 : 0,
  );
  return id;
}
/** Zet de vertaalde versie in een recept en bewaart het origineel. */
export function saveTranslation(id: string, t: RecipeInputT) {
  run(
    `UPDATE recipes SET title=?, ingredients=?, instructions=?, servings=?, lang=?,
       orig_title=COALESCE(orig_title, ?), orig_ingredients=COALESCE(orig_ingredients, ?), orig_instructions=COALESCE(orig_instructions, ?), orig_lang=COALESCE(orig_lang, ?)
     WHERE id=? AND household_id=?`,
    t.title, t.ingredients, t.instructions, t.servings, t.lang,
    t.original?.title ?? null, t.original?.ingredients ?? null, t.original?.instructions ?? null, t.original?.lang ?? null, id, hid(),
  );
}
export const updateRecipe = (id: string, i: RecipeInputT) =>
  run(
    "UPDATE recipes SET title=?, ingredients=?, instructions=?, minutes=?, image=?, source_url=?, servings=?, cuisine=?, category=? WHERE id=? AND household_id=?",
    i.title, i.ingredients, i.instructions, i.minutes ?? null, i.image ?? null, i.sourceUrl ?? null, i.servings, i.cuisine, i.category, id, hid(),
  );
export const setRecipeFavorite = (id: string, fav: boolean) => run("UPDATE recipes SET favorite=? WHERE id=? AND household_id=?", fav ? 1 : 0, id, hid());
export const deleteRecipe = (id: string) => run("DELETE FROM recipes WHERE id=? AND household_id=?", id, hid());
export const recipeBySource = (url: string) => listRecipes().find((r) => r.sourceUrl === url);

export const mealsBetween = (from: string, to: string) =>
  all<{ date: string; slot: string; title: string; recipe_id: string | null; image: string | null; rimage: string | null }>(
    `SELECT m.date, m.slot, m.title, m.recipe_id, m.image, r.image AS rimage FROM meals m LEFT JOIN recipes r ON r.id = m.recipe_id
     WHERE m.household_id=? AND m.date BETWEEN ? AND ? ORDER BY m.date`, hid(), from, to,
  ).map((m) => ({ date: m.date, slot: m.slot, title: m.title, recipeId: m.recipe_id, image: m.rimage || m.image || null }));
export function setMealImage(date: string, slot: string, image: string | null) {
  run("UPDATE meals SET image=? WHERE household_id=? AND date=? AND slot=?", image, hid(), date, slot);
}
export function setRecipeImage(id: string, image: string | null) {
  run("UPDATE recipes SET image=? WHERE id=? AND household_id=?", image, id, hid());
}
export function setMeal(date: string, slot: string, title: string, recipeId: string | null = null) {
  const h = hid();
  if (recipeId && !get("SELECT 1 FROM recipes WHERE id=? AND household_id=?", recipeId, h)) recipeId = null;
  if (!title.trim()) run("DELETE FROM meals WHERE household_id=? AND date=? AND slot=?", h, date, slot);
  else run(
    `INSERT INTO meals(household_id, date, slot, title, recipe_id) VALUES (?,?,?,?,?)
     ON CONFLICT(household_id, date, slot) DO UPDATE SET title=excluded.title, recipe_id=excluded.recipe_id,
       image=CASE WHEN meals.title=excluded.title THEN meals.image ELSE NULL END`,
    h, date, slot, title.trim(), recipeId,
  );
}

// ---------- lijsten ----------
export type ListKind = "list" | "pantry" | "shopping";
export const listLists = () => {
  const h = hid();
  const lists = all<{ id: string; name: string; icon: string; kind: ListKind }>("SELECT id, name, icon, kind FROM lists WHERE household_id=? ORDER BY sort, name", h);
  const items = all<{ id: string; list_id: string; text: string; done: number; expires: string | null; qty: string; member_id: string | null; aisle: string | null }>(
    "SELECT i.id, i.list_id, i.text, i.done, i.expires, i.qty, i.member_id, i.aisle FROM list_items i JOIN lists l ON l.id = i.list_id WHERE l.household_id=? ORDER BY i.done, COALESCE(i.expires, '9999'), i.created_at", h,
  );
  return lists.map((l) => ({ ...l, items: items.filter((i) => i.list_id === l.id).map((i) => ({ id: i.id, text: i.text, done: !!i.done, expires: i.expires, qty: i.qty, memberId: i.member_id, aisle: i.aisle })) }));
};
export function createList(name: string, icon = "📝", h = hid(), kind: ListKind = "list") {
  const id = newId();
  run("INSERT INTO lists(id, household_id, name, icon, sort, kind) VALUES (?,?,?,?,(SELECT COALESCE(MAX(sort),-1)+1 FROM lists WHERE household_id=?),?)", id, h, name, icon, h, kind);
  return id;
}
export const pantryList = () => listLists().find((l) => l.kind === "pantry");
export const shoppingList = () => { const ls = listLists(); return ls.find((l) => l.kind === "shopping") ?? ls.find((l) => l.kind === "list" && /boodschap/i.test(l.name)); };
/** Elk gezin heeft één boodschappenlijst; bestaat die nog niet, dan maken we ze. */
export function ensureShoppingList() {
  const existing = shoppingList();
  if (existing) return existing.id;
  return createList("Boodschappen", "🛒", hid(), "shopping");
}
export const AISLE_KEYS = ["groente", "zuivel", "vlees", "brood", "droog", "diepvries", "drank", "huishouden", "overig"] as const;
export function updateItem(id: string, patch: { text?: string; done?: boolean; expires?: string | null; qty?: string; memberId?: string | null; aisle?: string | null }) {
  const h = hid();
  if (patch.aisle !== undefined) run(`UPDATE list_items SET aisle=? WHERE ${ITEM_OWNED}`, patch.aisle, id, h);
  if (patch.memberId !== undefined) run(`UPDATE list_items SET member_id=? WHERE ${ITEM_OWNED}`, patch.memberId, id, h);
  if (patch.text !== undefined) run(`UPDATE list_items SET text=? WHERE ${ITEM_OWNED}`, patch.text.trim(), id, h);
  if (patch.done !== undefined) run(`UPDATE list_items SET done=? WHERE ${ITEM_OWNED}`, patch.done ? 1 : 0, id, h);
  if (patch.expires !== undefined) run(`UPDATE list_items SET expires=? WHERE ${ITEM_OWNED}`, patch.expires, id, h);
  if (patch.qty !== undefined) run(`UPDATE list_items SET qty=? WHERE ${ITEM_OWNED}`, patch.qty.trim(), id, h);
}
export const deleteList = (id: string) => run("DELETE FROM lists WHERE id=? AND household_id=?", id, hid());
export function findList(name: string) {
  const n = name.trim().toLocaleLowerCase("nl");
  return listLists().find((l) => l.name.toLocaleLowerCase("nl") === n || l.name.toLocaleLowerCase("nl").startsWith(n));
}
const ownsList = (listId: string) => !!get("SELECT 1 FROM lists WHERE id=? AND household_id=?", listId, hid());
const ITEM_OWNED = "id=? AND list_id IN (SELECT id FROM lists WHERE household_id=?)";
export function addItem(listId: string, text: string, extra: { expires?: string | null; qty?: string; memberId?: string | null; aisle?: string | null } = {}) {
  if (!ownsList(listId)) throw new Error("Onbekende lijst");
  const id = newId();
  run("INSERT INTO list_items(id, list_id, text, expires, qty, member_id, aisle) VALUES (?,?,?,?,?,?,?)", id, listId, text.trim(), extra.expires ?? null, extra.qty ?? "", extra.memberId ?? null, extra.aisle ?? null);
  return id;
}

// ---------- vaste boodschappen (standaardlijst om aan te vinken) ----------
export interface Staple { id: string; text: string; aisle: string | null }
export const DEFAULT_STAPLES: { text: string; aisle: string }[] = [
  ...["Melk", "Yoghurt", "Kaas", "Beyaz peynir", "Boter", "Eieren", "Ayran", "Kaymak"].map((text) => ({ text, aisle: "zuivel" })),
  ...["Brood", "Pide", "Yufka", "Lavaş", "Simit"].map((text) => ({ text, aisle: "brood" })),
  ...["Tomaten", "Komkommer", "Uien", "Knoflook", "Paprika", "Aardappelen", "Citroen", "Peterselie", "Sla", "Appels", "Bananen", "Druiven", "Spinazie", "Courgette", "Aubergine", "Wortelen", "Prei", "Munt", "Dille", "Champignons"].map((text) => ({ text, aisle: "groente" })),
  ...["Kipfilet", "Gehakt", "Lamsvlees", "Sucuk", "Vis", "Köfte"].map((text) => ({ text, aisle: "vlees" })),
  ...["Rijst", "Bulgur", "Pasta", "Bloem", "Linzen", "Kikkererwten", "Suiker", "Zout", "Olijfolie", "Zonnebloemolie", "Salça", "Thee", "Koffie", "Pul biber", "Komijn", "Olijven", "Tahin", "Pekmez", "Honing", "Noten"].map((text) => ({ text, aisle: "droog" })),
  ...["Water", "Vruchtensap", "Cola"].map((text) => ({ text, aisle: "drank" })),
  ...["Frieten", "IJs"].map((text) => ({ text, aisle: "diepvries" })),
  ...["WC-papier", "Keukenrol", "Afwasmiddel", "Wasmiddel", "Zeep", "Shampoo", "Tandpasta", "Vuilniszakken", "Luiers"].map((text) => ({ text, aisle: "huishouden" })),
];
export function listStaples(): Staple[] {
  const h = hid();
  let rows = all<Staple>("SELECT id, text, aisle FROM staples WHERE household_id=? ORDER BY sort, created_at", h);
  if (!rows.length) {
    tx(() => { DEFAULT_STAPLES.forEach((x, i) => run("INSERT INTO staples(id, household_id, text, aisle, sort) VALUES (?,?,?,?,?)", newId(), h, x.text, x.aisle, i)); });
    rows = all<Staple>("SELECT id, text, aisle FROM staples WHERE household_id=? ORDER BY sort, created_at", h);
  }
  return rows;
}
export function addStaple(text: string, aisle: string | null) {
  const h = hid();
  const t = text.trim();
  const dup = get<{ id: string }>("SELECT id FROM staples WHERE household_id=? AND lower(text)=lower(?)", h, t);
  if (dup) return dup.id;
  const id = newId();
  run("INSERT INTO staples(id, household_id, text, aisle, sort) VALUES (?,?,?,?,(SELECT COALESCE(MAX(sort),-1)+1 FROM staples WHERE household_id=?))", id, h, t, aisle, h);
  return id;
}
export const deleteStaple = (id: string) => run("DELETE FROM staples WHERE id=? AND household_id=?", id, hid());
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

/** Woorden die het gezin vermijdt (allergieën, voorkeuren), uit de profielen. */
export const avoidWords = (h = hid()) => [...new Set(listMembers(h).flatMap((m) => m.diet.split(/[,;\n]/).map((w) => w.trim().toLocaleLowerCase("tr")).filter((w) => w.length > 1)))];
/** Welke te vermijden woorden in deze ingrediënten voorkomen. */
const wordRe = (w: string) => new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[^\\p{L}]|$)`, "iu");
export const dietHits = (ingredients: string, words = avoidWords()) => { const t = ingredients.toLocaleLowerCase("tr"); return words.filter((w) => wordRe(w).test(t)); };
