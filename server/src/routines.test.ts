import { test } from "node:test";
import assert from "node:assert/strict";
import { withCtx } from "./db.ts";
import { createUser, createHousehold } from "./accounts.ts";
import { createMember, listChores } from "./store.ts";
import { apply, catalog, AGE_SETS } from "./routines.ts";

test("routinepakket: taken per kind in de gezinstaal, dubbels overgeslagen, leeftijdssets bestaan", async () => {
  const userId = createUser({ name: "Test", email: `rt${Date.now()}@x.be`, password: "geheim123" });
  const h = createHousehold(userId, "Routinegezin");
  await withCtx({ userId, householdId: h }, async () => {
    const kid = createMember({ name: "Elif", color: "#ff0000", role: "kind" });
    const r = apply(kid.id, AGE_SETS.lagere, "tr");
    assert.equal(r.added.length, AGE_SETS.lagere.length); assert.equal(r.skipped.length, 0);
    const chores = listChores().filter((c) => c.memberId === kid.id);
    assert.ok(chores.some((c) => c.title === "Diş fırçalamak (sabah)" && c.moment === "ochtend"));
    assert.ok(chores.some((c) => c.title === "Ödev yapıldı" && c.days.length === 5), "huiswerk alleen op schooldagen");
    const again = apply(kid.id, ["tanden_ochtend", "huisdier"], "tr");
    assert.deepEqual(again.skipped, ["Diş fırçalamak (sabah)"]); assert.deepEqual(again.added, ["Evcil hayvanı beslemek"]);
    const cat = catalog("en");
    assert.ok(cat.items.find((i) => i.key === "bed")!.title === "Make the bed"); assert.equal(cat.groups.length, 4);
    for (const keys of Object.values(AGE_SETS)) for (const k of keys) assert.ok(cat.items.some((i) => i.key === k), `onbekende sleutel ${k}`);
  });
});
