import { test } from "node:test";
import assert from "node:assert/strict";
import { withCtx } from "./db.ts";
import { createUser, createHousehold } from "./accounts.ts";
import { createEvent } from "./events.ts";
import * as S from "./store.ts";
import { buildBriefing, applyProposal, remember, listMemory, memoryContext } from "./manager.ts";

const iso = (d: Date) => d.toISOString().slice(0, 10);

test("manager: briefing met afspraken, overlappende afspraken als voorstel, maaltijdvoorstel en geheugen", async () => {
  const userId = createUser({ name: "Test", email: `m${Date.now()}@x.be`, password: "geheim123" });
  const householdId = createHousehold(userId, "Testgezin");
  await withCtx({ userId, householdId }, async () => {
    const kid = S.createMember({ name: "Elif", color: "#f06292", avatar: "🧒", role: "kind" });
    const tomorrow = iso(new Date(Date.now() + 864e5));
    const today = iso(new Date());
    // twee overlappende afspraken voor Elif morgen
    createEvent({ title: "Zwemles", date: tomorrow, endDate: null, startTime: "17:00", endTime: "18:00", allDay: false, repeat: "none", repeatUntil: null, exdates: [], members: [kid.id], location: "", notes: "", countdown: false } as never);
    createEvent({ title: "Verjaardagsfeest", date: tomorrow, endDate: null, startTime: "17:30", endTime: "19:00", allDay: false, repeat: "none", repeatUntil: null, exdates: [], members: [kid.id], location: "", notes: "", countdown: false } as never);
    S.createRecipe(S.RecipeInput.parse({ title: "Mercimek çorbası", ingredients: "200 g rode linzen\n1 ui\n1 wortel", instructions: "Kook.", minutes: 30 }));

    const evening = await buildBriefing("evening", today, kid.id);
    assert.equal(evening.memberId, kid.id);
    assert.ok(evening.items.some((i) => i.kind === "event" && i.text.includes("Zwemles")), "afspraken van morgen staan in de avondafsluiting");
    assert.equal(evening.conflicts, 1, "één overlap gevonden");
    const move = evening.proposals.find((p) => p.kind === "move_event");
    assert.ok(move, "verzetten voorgesteld");
    assert.equal(move!.kind === "move_event" && move!.newStart, "18:00", "naar de eerste vrije plek na de andere afspraak");
    const meal = evening.proposals.find((p) => p.kind === "plan_meal");
    assert.ok(meal && meal.kind === "plan_meal" && meal.recipe === "Mercimek çorbası", "avondeten voor morgen voorgesteld uit de eigen recepten");
    assert.ok(evening.narration.includes("Zwemles"), "de sjabloontekst noemt de afspraak");

    // voorstellen uitvoeren
    if (move && move.kind === "move_event") applyProposal({ kind: "move_event", eventId: move.eventId, on: move.on, newStart: move.newStart, newEnd: move.newEnd });
    if (meal && meal.kind === "plan_meal") applyProposal({ kind: "plan_meal", date: meal.date, slot: meal.slot, recipeId: meal.recipeId, recipe: meal.recipe });
    const after = await buildBriefing("evening", today, kid.id);
    assert.equal(after.conflicts, 0, "na het verzetten geen overlap meer");
    assert.ok(!after.proposals.some((p) => p.kind === "plan_meal"), "avondeten staat gepland, geen voorstel meer");
    assert.ok(after.items.some((i) => i.kind === "meal" && i.text.includes("Mercimek")));

    // gezinsbriefing noemt wie
    const fam = await buildBriefing("evening", today, null);
    assert.ok(fam.items.some((i) => i.kind === "event" && i.text.includes("Elif")));

    // geheugen
    remember({ text: "Elif lust geen spinazie", memberId: kid.id, source: "assistent" });
    remember({ text: "elif lust geen spinazie", memberId: kid.id, source: "user" }); // dubbel, andere hoofdletters
    assert.equal(listMemory().length, 1);
    assert.ok(memoryContext().includes("Elif: Elif lust geen spinazie"));
  });
});
