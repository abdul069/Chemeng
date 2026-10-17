import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateLine, estimateRecipe, energyNeed, searchFoods, matchFood } from "./nutrition.js";

test("ingrediëntregels worden herkend en omgerekend", () => {
  const g = estimateLine("500 g gehakt");
  assert.equal(g.food, "gehakt"); assert.equal(g.grams, 500); assert.equal(g.kcal, 1270);
  const ui = estimateLine("1 ui");
  assert.equal(ui.food, "ui"); assert.equal(ui.grams, 100);
  const look = estimateLine("2 teentjes look");
  assert.equal(look.food, "look"); assert.equal(look.grams, 10);
  const blik = estimateLine("1 blik tomatenblokjes");
  assert.equal(blik.food, "tomaat"); assert.equal(blik.grams, 400);
  const el = estimateLine("2 el olijfolie");
  assert.equal(el.food, "olie"); assert.equal(el.grams, 30);
  const tr = estimateLine("2 su bardağı pirinç");
  assert.equal(tr.food, "rijst_droog"); assert.equal(tr.grams, 400);
  const guess = estimateLine("Geraspte kaas");
  assert.equal(guess.food, "kaas"); assert.equal(guess.guessed, true);
  assert.equal(estimateLine("Een snufje liefde").food, null);
});

test("recept per portie", () => {
  const r = estimateRecipe("500 g gehakt\n1 ui\n2 teentjes look\n1 blik tomatenblokjes\n500 g spaghetti\n50 g geraspte kaas", "4 personen");
  assert.equal(r.servings, 4);
  assert.equal(r.matched, 6);
  assert.ok(r.perServing.kcal > 500 && r.perServing.kcal < 900, `kcal/portie ${r.perServing.kcal}`);
  assert.equal(estimateRecipe("1 ei", "").servings, 4);
});

test("energiebehoefte en zoeken", () => {
  const n = energyNeed({ sex: "m", age: 35, heightCm: 180, weightKg: 80, activity: 1.4, goal: "afvallen" });
  assert.equal(n.bmr, 1755); assert.equal(n.tdee, 2457); assert.equal(n.goalKcal, 1960);
  assert.equal(energyNeed({ sex: "v", age: 30, heightCm: 150, weightKg: 45, activity: 1.2, goal: "afvallen" }).goalKcal, 1200);
  assert.equal(searchFoods("yumurta")[0].id, "ei");
  assert.equal(matchFood("tavuk göğsü")?.id, "kip");
});
