import { test } from "node:test";
import assert from "node:assert/strict";
import { isoMinutes, parseRecipeHtml, RecipeError } from "./recipes.js";

const yoast = `<html><head><script type="application/ld+json" class="yoast-schema-graph">{"@context":"https://schema.org","@graph":[
  {"@type":"WebPage","name":"Karnıyarık Tarifi"},
  {"@type":"Recipe","name":"Karnıyarık Tarifi","image":["https://cdn.example.com/karniyarik.jpg"],
   "recipeYield":"4 kişilik","prepTime":"PT20M","cookTime":"PT40M",
   "recipeIngredient":["5 adet patlıcan","250 gr kıyma","1 adet soğan","2 adet domates","1 su bardağı sıcak su"],
   "recipeInstructions":[{"@type":"HowToStep","text":"Patlıcanları alacalı soyun ve kızartın."},{"@type":"HowToStep","text":"Kıymayı soğanla kavurun &amp; domatesi ekleyin."},{"@type":"HowToStep","text":"Patlıcanları doldurup 180 derece fırında 30 dakika pişirin."}]}
]}</script></head><body></body></html>`;

test("leest een recept uit een @graph (Yoast, zoals op veel Turkse sites)", () => {
  const r = parseRecipeHtml(yoast, "https://www.nefisyemektarifleri.com/karniyarik-tarifi/");
  assert.equal(r.title, "Karnıyarık Tarifi");
  assert.equal(r.image, "https://cdn.example.com/karniyarik.jpg");
  assert.equal(r.minutes, 60);
  assert.equal(r.servings, "4 kişilik");
  assert.equal(r.cuisine, "Turks");
  assert.equal(r.lang, "tr");
  assert.equal(r.ingredients.split("\n").length, 5);
  assert.match(r.instructions, /^1\. Patlıcanları/);
  assert.match(r.instructions, /kavurun & domatesi/);
});

test("leest secties met stappen en een losse afbeelding", () => {
  const html = `<script type="application/ld+json">[{"@type":["Recipe"],"name":"Mercimek Çorbası","image":{"url":"https://x/y.jpg"},"totalTime":"PT45M",
    "recipeIngredient":["1 su bardağı kırmızı mercimek"],"recipeInstructions":[{"@type":"HowToSection","name":"Çorba","itemListElement":[{"text":"Mercimeği yıkayın."}]}]}]</script>`;
  const r = parseRecipeHtml(html, "https://yemek.com/tarif/mercimek-corbasi/");
  assert.equal(r.image, "https://x/y.jpg");
  assert.equal(r.minutes, 45);
  assert.match(r.instructions, /Çorba/);
});

test("geeft een duidelijke fout als er geen recept op de pagina staat", () => {
  assert.throws(() => parseRecipeHtml("<html><body>Geen recept</body></html>", "https://x"), RecipeError);
  assert.equal(isoMinutes("PT1H30M"), 90);
});

test("neemt de hoofdfoto van de pagina als het recept zelf geen foto heeft", () => {
  const html = `<html lang="tr"><head><meta property="og:image" content="https://cdn.site/mercimek.jpg"><script type="application/ld+json">{"@type":"Recipe","name":"Mercimek","recipeIngredient":["mercimek"],"recipeInstructions":"Pişirin."}</script></head></html>`;
  const r = parseRecipeHtml(html, "https://lezzet.com.tr/yemek-tarifleri/mercimek");
  assert.equal(r.image, "https://cdn.site/mercimek.jpg");
  assert.equal(r.lang, "tr");
});

test("leest stappen die als geneste array staan (yemek.com)", () => {
  const html = `<html><script type="application/ld+json">${JSON.stringify({ "@type": "Recipe", name: "Aşure", recipeIngredient: ["250 g buğday", "1 l su"], recipeInstructions: [["Buğdayı yıkayın.", "Suyu ekleyin ve pişirin."]] })}</script></html>`;
  const r = parseRecipeHtml(html, "https://yemek.com/tarif/asure/");
  assert.equal(r.instructions, "1. Buğdayı yıkayın.\n2. Suyu ekleyin ve pişirin.");
});

test("splitst één regel met alle ingrediënten, maar niet in '1,5'", async () => {
  const { splitJoined } = await import("./recipes.js");
  assert.deepEqual(splitJoined(["1 litre süt,100 gram tereyağı,1,5 tatlı kaşığı tuz,1,5 su bardağı mısır nişastası"]), ["1 litre süt", "100 gram tereyağı", "1,5 tatlı kaşığı tuz", "1,5 su bardağı mısır nişastası"]);
  assert.deepEqual(splitJoined(["2 adet soğan", "tuz, karabiber"]), ["2 adet soğan", "tuz, karabiber"]);
});
