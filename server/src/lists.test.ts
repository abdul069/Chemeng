import { test } from "node:test";
import assert from "node:assert/strict";
import { withCtx } from "./db.ts";
import { createUser, createHousehold } from "./accounts.ts";
import * as S from "./store.ts";

test("gekocht gaat naar de voorraad, op gaat terug naar de boodschappen", () => {
  const userId = createUser({ name: "Test", email: `t${Date.now()}@x.be`, password: "geheim123" });
  const householdId = createHousehold(userId, "Testgezin");
  withCtx({ userId, householdId }, () => {
    const shopId = S.ensureShoppingList();
    const pantryId = S.ensurePantryList();
    const melk = S.addItem(shopId, "Melk");
    // afvinken op boodschappen = gekocht → in de voorraad
    S.updateItem(melk, { done: true });
    const moved = S.syncShopPantry(melk, true);
    assert.equal(moved?.to, "Voorraad");
    const pantry = () => S.listLists().find((l) => l.id === pantryId)!;
    assert.ok(pantry().items.some((i) => i.text === "Melk" && !i.done));
    // nog eens afvinken zet geen tweede melk
    S.syncShopPantry(melk, true);
    assert.equal(pantry().items.filter((i) => i.text === "Melk").length, 1);
    // terug open zetten haalt de melk weer uit de voorraad
    S.updateItem(melk, { done: false }); S.syncShopPantry(melk, false);
    assert.equal(pantry().items.filter((i) => i.text === "Melk").length, 0);
    // voorraad: op → terug op de boodschappen (zonder dubbels)
    S.deleteItem(melk);
    const eieren = S.addItem(pantryId, "Eieren");
    S.updateItem(eieren, { done: true });
    const back = S.syncShopPantry(eieren, true);
    assert.equal(back?.to, "Boodschappen");
    const shop = () => S.listLists().find((l) => l.id === shopId)!;
    assert.equal(shop().items.filter((i) => i.text === "Eieren" && !i.done).length, 1);
    S.syncShopPantry(eieren, true);
    assert.equal(shop().items.filter((i) => i.text === "Eieren").length, 1);
  });
});
