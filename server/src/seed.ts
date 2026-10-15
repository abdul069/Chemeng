// Vult het actieve gezin met voorbeeldgegevens, zodat je kunt zien hoe alles werkt.
// Alles is achteraf aan te passen of te verwijderen.
import { ctx, get } from "./db.js";
import { createEvent } from "./events.js";
import { addItem, createChore, createList, createMember, createRecipe, createReward, findList, listMembers, setMeal, setChoreDone, RecipeInput } from "./store.js";
import { addDays, today, weekday } from "./dates.js";

export function seedDemo() {
  const { userId, householdId } = ctx();

  const t = today();
  const monday = addDays(t, -((weekday(t) + 6) % 7));
  const d = (n: number) => addDays(monday, n);

  // het eigen profiel van wie de voorbeeldgegevens laadt, speelt de rol van "Papa"
  const ownId = get<{ member_id: string | null }>("SELECT member_id FROM household_users WHERE household_id=? AND user_id=?", householdId, userId)?.member_id;
  const papa = listMembers().find((m) => m.id === ownId) ?? createMember({ name: "Papa", color: "#4a7bd8", avatar: "🧔", role: "ouder" });
  const mama = createMember({ name: "Mama", color: "#d9576b", avatar: "👩", role: "ouder" });
  const noah = createMember({ name: "Noah", color: "#4f9e5b", avatar: "🧒", role: "kind" });
  const lina = createMember({ name: "Lina", color: "#8a62d1", avatar: "👧", role: "kind" });
  const adam = createMember({ name: "Adam", color: "#e08a3c", avatar: "👶", role: "kind" });
  const all = [papa, mama, noah, lina, adam].map((m) => m.id);

  const ev = (title: string, date: string, startTime: string | null, endTime: string | null, members: string[], extra: Partial<Parameters<typeof createEvent>[0]> = {}) =>
    createEvent({ title, date, startTime, endTime, members, allDay: !startTime, repeat: "none", notes: "", location: "", ...extra });

  ev("Werk", d(0), "07:00", "16:00", [papa.id], { repeat: "weekly" });
  ev("Werk", d(1), "07:00", "16:00", [papa.id], { repeat: "weekly" });
  ev("Werk", d(3), "07:00", "16:00", [papa.id], { repeat: "weekly" });
  ev("Werk", d(0), "08:30", "15:30", [mama.id], { repeat: "weekly" });
  ev("Werk", d(2), "08:30", "12:30", [mama.id], { repeat: "weekly" });
  ev("Voetbaltraining", d(2), "16:00", "17:30", [noah.id], { repeat: "weekly", location: "Sporthal" });
  ev("Zwemles", d(1), "17:00", "18:00", [lina.id], { repeat: "weekly", location: "Zwembad" });
  ev("Dansles", d(3), "16:30", "17:30", [lina.id], { repeat: "weekly" });
  ev("Opvang ophalen", d(4), "15:30", "16:00", [mama.id, adam.id], { repeat: "weekly" });
  ev("Spelletjesavond", d(4), "19:00", "20:00", all);
  ev("Tandarts", d(5), "10:00", "10:30", [adam.id, papa.id]);
  ev("Brunch bij oma", d(6), "11:00", "13:00", all);
  ev("Verjaardag oma", d(9), null, null, all);
  ev("Oudercontact school", d(8), "19:30", "21:00", [papa.id, mama.id]);
  ev("Afvalophaling", d(1), null, null, [], { repeat: "biweekly" });

  const c = (m: string, title: string, icon: string, points = 1, days = [0, 1, 2, 3, 4, 5, 6]) => createChore({ memberId: m, title, icon, points, days });
  const choreBed = c(noah.id, "Bed opmaken", "🛏️");
  c(noah.id, "Huiswerk", "📚", 2, [1, 2, 3, 4]);
  c(noah.id, "Hond uitlaten", "🐕", 2);
  const choreTeeth = c(lina.id, "Tanden poetsen", "🪥");
  c(lina.id, "Speelgoed opruimen", "🧸");
  c(lina.id, "Tafel dekken", "🍴");
  c(adam.id, "Schoenen wegzetten", "👟");
  c(adam.id, "Tanden poetsen", "🪥");
  const choreTrash = c(papa.id, "Vuilnis buiten", "🗑️", 1, [1]);
  c(papa.id, "Afwas", "🍽️");
  c(mama.id, "Was draaien", "🧺", 1, [1, 3, 5]);
  c(mama.id, "Planten water geven", "🪴", 1, [0, 3]);
  setChoreDone(choreBed.id, t, true);
  setChoreDone(choreTeeth.id, t, true);
  if (weekday(t) === 1) setChoreDone(choreTrash.id, t, true);

  createReward({ title: "Kiezen wat we eten", icon: "🍕", cost: 15 });
  createReward({ title: "Half uur langer opblijven", icon: "🌙", cost: 20 });
  createReward({ title: "Uitstap naar de speeltuin", icon: "🛝", cost: 40 });

  const bolo = createRecipe(RecipeInput.parse({ title: "Spaghetti bolognese", minutes: 40, ingredients: "500 g gehakt\n1 ui\n2 teentjes look\n1 blik tomatenblokjes\n500 g spaghetti\nGeraspte kaas", instructions: "Stoof ui en look, bak het gehakt rul, voeg tomaten toe en laat 20 minuten sudderen. Kook de spaghetti en serveer met kaas." }));
  const pizza = createRecipe(RecipeInput.parse({ title: "Zelfgemaakte pizza", minutes: 45, ingredients: "Pizzadeeg\nTomatensaus\nMozzarella\nHam\nChampignons", instructions: "Rol het deeg uit, beleg en bak 12 minuten op 230 °C." }));
  createRecipe(RecipeInput.parse({ title: "Linzensoep", minutes: 35, ingredients: "250 g rode linzen\n1 ui\n2 wortels\n1 l groentebouillon\nKomijn", instructions: "Fruit ui en wortel, voeg linzen, kruiden en bouillon toe, kook 20 minuten en mix fijn." }));

  const menu: [string, string, string][] = [
    ["Yoghurt met fruit", "Boterhammen", "Spaghetti bolognese"],
    ["Havermout", "Tomatensoep", "Kip met rijst en groenten"],
    ["Pannenkoekjes", "Wraps", "Vispakketjes met puree"],
    ["Muesli", "Pastasalade", "Linzensoep met brood"],
    ["Eitjes met toast", "Boterhammen", "Zelfgemaakte pizza"],
    ["Croissants", "Restjes", "Kebab met salade"],
    ["Brunch bij oma", "", "Groentesoep en tosti"],
  ];
  menu.forEach(([o, l, dn], i) => {
    setMeal(d(i), "ontbijt", o);
    if (l) setMeal(d(i), "lunch", l);
    setMeal(d(i), "diner", dn, dn === "Spaghetti bolognese" ? bolo : dn === "Zelfgemaakte pizza" ? pizza : null);
  });

  const shop = findList("Boodschappen")?.id ?? createList("Boodschappen", "🛒");
  ["Melk", "Brood", "Bananen", "Kaas", "Wasmiddel"].forEach((x) => addItem(shop, x));
  const todo = findList("To-do")?.id ?? createList("To-do", "✅");
  ["Turnzak Lina wassen", "Cadeau oma kopen", "Afspraak garage maken"].forEach((x) => addItem(todo, x));

}
