import { test } from "node:test";
import assert from "node:assert/strict";
import { pickAudioFiles } from "./ezan.ts";

test("geluidsbestanden uit een archiefitem kiezen", () => {
  const hits = pickAudioFiles("ezan-mekke", "Mekke Ezanı", [
    { name: "ezan.mp3", size: "2400000" },
    { name: "ezan_64kb.mp3", size: "900000" },
    { name: "ezan.png" },
    { name: "huge.mp3", size: String(60 * 1024 * 1024) },
    { name: "sabah ezani.ogg", size: "1200000" },
  ]);
  assert.deepEqual(hits.map((h) => h.url), ["https://archive.org/download/ezan-mekke/ezan.mp3", "https://archive.org/download/ezan-mekke/sabah%20ezani.ogg"]);
  assert.ok(hits[1].title.includes("sabah ezani"));
});
