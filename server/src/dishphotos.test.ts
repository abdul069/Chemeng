import { test } from "node:test";
import assert from "node:assert/strict";
import { autoDishPhoto, findDishPhotos, setFetcher } from "./dishphotos.js";

const calls: string[] = [];
setFetcher((async (url: URL | string) => {
  const u = new URL(String(url));
  calls.push(u.hostname);
  const q = u.searchParams.get("gsrsearch") ?? "";
  const pages = u.hostname.startsWith("tr.") && /karnıyarık/i.test(q)
    ? { "1": { title: "Karnıyarık", index: 1, thumbnail: { source: "https://upload.wikimedia.org/karniyarik.jpg" } }, "2": { title: "Logo", index: 2, thumbnail: { source: "https://upload.wikimedia.org/logo.svg" } } }
    : u.hostname.startsWith("en.") ? { "1": { title: "Spaghetti alla bolognese", index: 1, thumbnail: { source: "https://upload.wikimedia.org/bolo.jpg" } } } : {};
  return new Response(JSON.stringify({ query: { pages } }), { headers: { "content-type": "application/json" } });
}) as typeof fetch);

test("vindt een foto van een Turks gerecht op Wikipedia en slaat svg's over", async () => {
  const r = await findDishPhotos("Karnıyarık");
  assert.equal(r[0].url, "https://upload.wikimedia.org/karniyarik.jpg");
  assert.ok(!r.some((x) => x.url.endsWith(".svg")));
});

test("valt terug op andere talen en onthoudt het resultaat", async () => {
  assert.equal(await autoDishPhoto("Spaghetti bolognese"), "https://upload.wikimedia.org/bolo.jpg");
  const before = calls.length;
  assert.equal(await autoDishPhoto("spaghetti  Bolognese"), "https://upload.wikimedia.org/bolo.jpg");
  assert.equal(calls.length, before, "tweede keer uit het geheugen");
});

test("zoekt geen foto voor 'restjes'", async () => {
  assert.equal(await autoDishPhoto("Restjes"), null);
});
