import { test } from "node:test";
import assert from "node:assert/strict";
import { withCtx } from "./db.ts";
import { createUser, createHousehold } from "./accounts.ts";
import * as S from "./store.ts";
import { productKey, parseQty, addPrice, lookup, bestStores, commit, history, spend, listReceipts } from "./prices.ts";

test("prijsgeheugen: normalisatie, prijs per eenheid, goedkoopste winkel, beste winkel voor de lijst, ticket inboeken", async () => {
  assert.equal(productKey("Bio halfvolle melk 1L"), "bio halfvolle melk");
  assert.equal(productKey("GEHAKT 500G"), "gehakt");
  assert.deepEqual(parseQty("500 g"), { qty: 0.5, unit: "kg" });
  assert.deepEqual(parseQty("6 x 250 g"), { qty: 1.5, unit: "kg" });
  assert.deepEqual(parseQty("1,5 l"), { qty: 1.5, unit: "l" });
  assert.deepEqual(parseQty("12 stuks"), { qty: 12, unit: "st" });
  assert.deepEqual(parseQty("melk"), { qty: 1, unit: "st" });

  const userId = createUser({ name: "Test", email: `p${Date.now()}@x.be`, password: "geheim123" });
  const householdId = createHousehold(userId, "Testgezin");
  await withCtx({ userId, householdId }, async () => {
    const a = addPrice({ label: "Halfvolle melk 1L", store: "Colruyt", price: 1.39, source: "manual", seenOn: "2026-10-01" });
    assert.equal(a.unit, "l"); assert.equal(a.unitPrice, 1.39);
    addPrice({ label: "Halfvolle melk 2L", store: "Lidl", price: 2.18, source: "manual", seenOn: "2026-10-10" }); // 1,09 per liter
    addPrice({ label: "Gehakt 500g", store: "Colruyt", price: 4.99, source: "manual", seenOn: "2026-10-05" });
    addPrice({ label: "Gehakt 1 kg", store: "Delhaize", price: 10.5, source: "manual", seenOn: "2026-10-12" });

    const [melk, gehakt, brood] = lookup(["melk", "gehakt", "brood"]);
    assert.equal(melk.latest?.store, "Lidl"); assert.equal(melk.cheapest?.store, "Lidl"); assert.equal(melk.byStore.length, 2);
    assert.equal(gehakt.cheapest?.store, "Colruyt", "per kg is Colruyt goedkoper (9,98 vs 10,50)");
    assert.equal(brood.latest, null);

    const best = bestStores(["melk", "gehakt", "brood"]);
    assert.equal(best.known, 2);
    assert.equal(best.stores[0].store, "Colruyt", "Colruyt kent beide items");
    assert.equal(best.split.total, Math.round((2.18 + 4.99) * 100) / 100);

    // ticket inboeken: vinkt af op de boodschappenlijst, zet de rest in de voorraad, boekt uitgaven
    const shop = S.ensureShoppingList(); S.addItem(shop, "melk"); S.addItem(shop, "bananen");
    const r = commit({ store: "Aldi", date: "2026-10-20", total: 7.5, items: [{ label: "Halfvolle melk 1L", qty: 1, unit: "l", price: 0.99 }, { label: "Kipfilet", qty: 600, unit: "g", price: 5.49 }], source: "ticket", toPantry: true, tickList: true });
    assert.equal(r.prices, 2); assert.equal(r.ticked, 1); assert.equal(r.stocked, 1);
    assert.ok(S.listLists().find((l) => l.id === shop)!.items.find((i) => i.text === "melk")!.done, "melk is afgevinkt");
    assert.ok(S.pantryList()!.items.some((i) => i.text === "Kipfilet" && i.qty === "600 g"), "kipfilet staat in de voorraad");
    assert.equal(lookup(["melk"])[0].cheapest?.store, "Aldi");
    assert.equal(history("melk").length, 3);
    assert.equal(listReceipts().length, 1);
    const sp = spend(3); assert.equal(sp[0].store, "Aldi"); assert.equal(sp[0].total, 7.5);
  });
});
