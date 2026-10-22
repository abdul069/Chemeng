import { test } from "node:test";
import assert from "node:assert/strict";
import { withCtx } from "./db.ts";
import { createUser, createHousehold } from "./accounts.ts";
import { createEvent } from "./events.ts";
import * as S from "./store.ts";
import { addPrice } from "./prices.ts";
import { parseLine, propose, apply, basket, basketToList } from "./weekbox.ts";
import { addDays, today } from "./dates.ts";

test("weekbox: snel gerecht op een drukke avond, voorraad die vervalt eerst, gebundelde lijst met prijsschatting", async () => {
  assert.deepEqual(parseLine("500 g gehakt"), { name: "gehakt", qty: 500, unit: "g", raw: "500 g gehakt" });
  assert.deepEqual(parseLine("2 uien"), { name: "uien", qty: 2, unit: "", raw: "2 uien" });
  assert.equal(parseLine("zout en peper")!.qty, null);

  const userId = createUser({ name: "Test", email: `w${Date.now()}@x.be`, password: "geheim123" });
  const householdId = createHousehold(userId, "Testgezin");
  await withCtx({ userId, householdId }, async () => {
    S.createMember({ name: "Abdul", color: "#4a7bd8", avatar: "🧔", role: "ouder" }); S.createMember({ name: "Elif", color: "#f06292", avatar: "🧒", role: "kind" });
    const slow = S.createRecipe(S.RecipeInput.parse({ title: "Stoofvlees", ingredients: "1 kg rundvlees\n2 uien\n50 cl bier", instructions: "Stoof.", minutes: 180, servings: "4 personen" }));
    const fast = S.createRecipe(S.RecipeInput.parse({ title: "Omelet", ingredients: "6 eieren\n100 g kaas\n1 ui", instructions: "Bak.", minutes: 15, servings: "2 personen" }));
    const exp = S.createRecipe(S.RecipeInput.parse({ title: "Spinaziestamppot", ingredients: "500 g spinazie\n1 kg aardappelen\n200 ml melk", instructions: "Kook.", minutes: 40, servings: "4 personen" }));
    void slow; void fast; void exp;
    const d1 = addDays(today(), 1), d2 = addDays(today(), 2), d3 = addDays(today(), 3);
    createEvent({ title: "Zwemles", date: d1, endDate: null, startTime: "17:00", endTime: "18:00", allDay: false, repeat: "none", repeatUntil: null, exdates: [], members: [], location: "", notes: "", countdown: false } as never);
    const pantry = S.ensurePantryList(); S.addItem(pantry, "spinazie", { expires: addDays(today(), 1) }); S.addItem(pantry, "uien");

    const plan = propose({ from: d1, days: 3, exclude: [], maxMinutesBusy: 35 });
    assert.equal(plan.length, 3);
    assert.ok(plan[0].busy, "zwemles maakt de eerste avond druk");
    assert.equal(plan[0].title, "Omelet", "drukke avond krijgt het snelle gerecht");
    assert.equal(plan[1].title, "Spinaziestamppot", "spinazie vervalt morgen, dus die eerst");
    assert.equal(new Set(plan.map((p) => p.recipeId)).size, 3, "elk recept één keer");

    apply({ items: plan.map((p) => ({ date: p.date, recipeId: p.recipeId!, title: p.title })) });
    assert.equal(S.mealsBetween(d1, d3).filter((m) => m.slot === "diner").length, 3);

    addPrice({ label: "Eieren 12 stuks", store: "Lidl", price: 2.49, source: "manual" });
    const b = basket(d1, d3);
    assert.equal(b.people, 3, "Test (account), Abdul en Elif");
    const eggs = b.items.find((i) => i.name === "eieren")!;
    assert.equal(eggs.amount, "9", "omelet voor 2 bij een gezin van 3: 9 eieren");
    const meat = b.items.find((i) => i.name === "rundvlees")!;
    assert.equal(meat.amount, "750 g", "stoofvlees voor 4 geschaald naar 3");
    assert.ok(b.items.find((i) => i.name === "spinazie")!.inHouse, "spinazie staat in de voorraad");
    assert.ok(b.items.find((i) => i.name === "uien")!.inHouse);
    assert.equal(eggs.price?.store, "Lidl");
    assert.ok(b.estimate.known >= 1 && b.estimate.total >= 2.49);

    const r = basketToList(d1, d3);
    const shop = S.shoppingList()!;
    assert.ok(shop.items.some((i) => i.text === "eieren" && i.qty === "9"));
    assert.ok(!shop.items.some((i) => i.text === "spinazie"), "wat in huis is, komt niet op de lijst");
    assert.equal(basketToList(d1, d3).added, 0, "tweede keer geen dubbels");
    assert.ok(r.added >= 5);
  });
});
