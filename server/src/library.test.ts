import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, crawl, crawlStatus, discoverUrls, libraryCategories, libraryList, libraryRecipe, setLibraryFetcher } from "./library.js";

const page = (name: string, cat = "") => `<html lang="tr"><head><script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org", "@type": "Recipe", name, image: `https://img.example/${encodeURIComponent(name)}.jpg`, recipeCategory: cat, totalTime: "PT45M", recipeYield: "4 kişilik",
  recipeIngredient: ["2 patlıcan", "250 g kıyma"], recipeInstructions: [{ "@type": "HowToStep", text: "Patlıcanları kızartın." }, { "@type": "HowToStep", text: "Fırında pişirin." }],
})}</script></head><body></body></html>`;

const site = "https://www.nefisyemektarifleri.com";
const pages: Record<string, string> = {
  [`${site}/robots.txt`]: `User-agent: *\nSitemap: ${site}/sitemap_index.xml\n`,
  [`${site}/sitemap_index.xml`]: `<sitemapindex><sitemap><loc>${site}/post-sitemap1.xml</loc></sitemap><sitemap><loc>${site}/category-sitemap.xml</loc></sitemap></sitemapindex>`,
  [`${site}/post-sitemap1.xml`]: `<urlset><url><loc>${site}/karniyarik-tarifi/</loc></url><url><loc>${site}/mercimek-corbasi-tarifi/</loc></url><url><loc>${site}/sutlac-tarifi/</loc></url><url><loc>${site}/kategori/corbalar/</loc></url><url><loc>${site}/hakkimizda/</loc></url><url><loc>${site}/bozuk-tarifi/</loc></url></urlset>`,
  [`${site}/karniyarik-tarifi/`]: page("Karnıyarık Tarifi", "Sebze Yemekleri"),
  [`${site}/mercimek-corbasi-tarifi/`]: page("Mercimek Çorbası Tarifi", "Çorbalar"),
  [`${site}/sutlac-tarifi/`]: page("Fırın Sütlaç", "Tatlılar"),
  [`${site}/bozuk-tarifi/`]: "<html><body>geen recept</body></html>",
};
setLibraryFetcher((async (url: URL | string) => {
  const body = pages[String(url)];
  return body === undefined ? new Response("nee", { status: 404 }) : new Response(body, { headers: { "content-type": String(url).endsWith(".xml") ? "application/xml" : "text/html" } });
}) as typeof fetch);

test("deelt recepten in op titel, URL en sitecategorie", () => {
  assert.equal(classify("Tavuk Çorbası", "https://yemek.com/tarif/tavuk-corbasi/"), "soep");
  assert.equal(classify("Havuçlu Kek", "https://x/havuclu-kek/"), "dessert");
  assert.equal(classify("Tavuk Sote", "https://x/tavuk-sote/", "Tavuk Yemekleri"), "kip");
  assert.equal(classify("Su Böreği", "https://x/su-boregi/"), "borek");
  assert.equal(classify("Adana Kebap", "https://x/adana/"), "kebap");
  assert.equal(classify("Bilinmeyen", "https://x/bilinmeyen/"), "overig");
});

test("vindt recept-URL's via robots.txt en de sitemap-index, zonder categoriepagina's", async () => {
  const urls = await discoverUrls("nefisyemektarifleri.com", 100, () => {});
  assert.deepEqual(urls.sort(), [`${site}/bozuk-tarifi/`, `${site}/karniyarik-tarifi/`, `${site}/mercimek-corbasi-tarifi/`, `${site}/sutlac-tarifi/`]);
});

test("haalt de recepten op, zet ze per categorie in de bibliotheek en slaat pagina's zonder recept over", async () => {
  await crawl({ sites: ["nefisyemektarifleri.com"], concurrency: 2 });
  assert.equal(crawlStatus.added, 3);
  assert.equal(crawlStatus.failed, 1);
  const cats = libraryCategories();
  assert.deepEqual(cats.map((c) => `${c.key}:${c.n}`), ["soep:1", "groente:1", "dessert:1"]);
  const soep = libraryList({ category: "soep" });
  assert.equal(soep.total, 1);
  assert.equal(soep.items[0].titleTr, "Mercimek Çorbası", "'tarifi' wordt weggelaten");
  assert.equal(libraryList({ q: "patlıcan" }).total, 3);
  assert.equal(libraryList({ q: "patlican" }).total, 3, "zonder Turkse tekens");
  assert.equal(libraryList({ q: "CORBA" }).total, 1, "hoofdletters en ç");
  assert.equal(libraryList({ q: "mercimek corba" }).total, 1, "meerdere woorden");
  const r = await libraryRecipe(soep.items[0].id, false);
  assert.equal(r?.lang, "tr");
  assert.equal(r?.minutes, 45);
  assert.match(r?.ingredients ?? "", /kıyma/);
  // een tweede keer ophalen voegt niets toe
  await crawl({ sites: ["nefisyemektarifleri.com"] });
  assert.equal(crawlStatus.added, 0);
  assert.equal(crawlStatus.total, 0);
});

test("vermijden-woorden gelden als heel woord", async () => {
  const { dietHits } = await import("./store.js");
  assert.deepEqual(dietHits("250 g suiker\n1 ui\nkruiden", ["ui", "noten"]), ["ui"]);
  assert.deepEqual(dietHits("250 g suiker\nkruiden\nfruit", ["ui"]), []);
  assert.deepEqual(dietHits("100 g fındık\n2 yumurta", ["fındık", "ei"]), ["fındık"]);
});

test("koken met wat in huis is: recepten gerangschikt op voorraad-woorden", async () => {
  const { fromPantry } = await import("./library.js");
  const r = fromPantry(["Patlıcan", "250 g kıyma", "Yoghurt"]);
  assert.ok(r.words.includes("patlican") && r.words.includes("kiyma"));
  assert.ok(r.items.length >= 1);
  assert.ok(r.items[0].score >= 2, "het recept met aubergine én gehakt staat bovenaan");
});
