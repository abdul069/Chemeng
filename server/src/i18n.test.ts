import { test } from "node:test";
import assert from "node:assert/strict";
import { withCtx, setSettings } from "./db.ts";
import { createUser, createHousehold } from "./accounts.ts";
import { createEvent } from "./events.ts";
import * as S from "./store.ts";
import { buildBriefing, applyProposal } from "./manager.ts";
import { catalog } from "./connectors.ts";
import { fractionLabel } from "./home.ts";
import { localizeHoliday } from "./holidays.ts";
import { L, asLang } from "./i18n.ts";

const iso = (d: Date) => d.toISOString().slice(0, 10);

test("talen: Engels als derde taal in briefing, koppelingen, afval en feestdagen; onbekende taal valt terug op Nederlands", async () => {
  assert.equal(asLang("en"), "en"); assert.equal(asLang("fr"), "nl"); assert.equal(asLang(undefined), "nl");
  assert.equal(L("en", { nl: "a", tr: "b", en: "c" }), "c");
  assert.equal(L("en", { nl: "a", tr: "b" }), "a", "zonder Engels valt L terug op Nederlands");
  assert.equal(fractionLabel("pmd", "en"), "Plastics, metal and cartons (PMD)");
  assert.equal(localizeHoliday({ date: "2026-12-25", title: "Kerstmis", icon: "🎄", kind: "be" }, "en").title, "Christmas");

  const userId = createUser({ name: "Test", email: `i${Date.now()}@x.be`, password: "geheim123" });
  const householdId = createHousehold(userId, "Smiths");
  await withCtx({ userId, householdId }, async () => {
    setSettings({ language: "en" });
    const kid = S.createMember({ name: "Mia", color: "#f06292", avatar: "🧒", role: "kind" });
    const tomorrow = iso(new Date(Date.now() + 864e5)); const today = iso(new Date());
    createEvent({ title: "Swimming", date: tomorrow, endDate: null, startTime: "17:00", endTime: "18:00", allDay: false, repeat: "none", repeatUntil: null, exdates: [], members: [kid.id], location: "", notes: "", countdown: false } as never);
    createEvent({ title: "Party", date: tomorrow, endDate: null, startTime: "17:30", endTime: "19:00", allDay: false, repeat: "none", repeatUntil: null, exdates: [], members: [kid.id], location: "", notes: "", countdown: false } as never);
    S.createRecipe(S.RecipeInput.parse({ title: "Lentil soup", ingredients: "200 g red lentils\n1 onion", instructions: "Cook.", minutes: 30 }));

    const b = await buildBriefing("evening", today, kid.id);
    assert.ok(b.title.startsWith("Good evening, Mia"), b.title);
    assert.ok(b.narration.includes("Tomorrow is"), b.narration);
    const move = b.proposals.find((p) => p.kind === "move_event");
    assert.ok(move && move.title.startsWith("Move "), "verzet-voorstel in het Engels");
    const meal = b.proposals.find((p) => p.kind === "plan_meal");
    assert.ok(meal && meal.title.startsWith("Dinner:"), "maaltijdvoorstel in het Engels");
    if (meal && meal.kind === "plan_meal") { const r = await applyProposal({ kind: "plan_meal", date: meal.date, slot: meal.slot, recipeId: meal.recipeId, recipe: meal.recipe }); assert.ok(r.message.startsWith("Planned:"), r.message); }

    const cat = catalog();
    const nmbs = cat.find((c) => c.id === "nmbs")!;
    assert.equal(nmbs.name, "Train (NMBS)"); assert.equal(nmbs.categoryLabel, "Mobility");

    setSettings({ language: "nl" });
    assert.equal(catalog().find((c) => c.id === "nmbs")!.name, "Trein (NMBS)");
  });
});
