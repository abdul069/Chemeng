import { test } from "node:test";
import assert from "node:assert/strict";
import { prayerTimes, METHODS } from "./prayer.ts";

const fmt = (ms: number) => new Date(ms).toISOString().slice(11, 16);

test("gebedstijden Brussel midden oktober liggen in de verwachte volgorde en buurt", () => {
  const t = prayerTimes({ date: "2026-10-17", latitude: 50.85, longitude: 4.35, method: "mwl" });
  const order = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"] as const;
  for (let i = 1; i < order.length; i++) assert.ok(t[order[i]] > t[order[i - 1]], `${order[i]} na ${order[i - 1]}`);
  // Brussel 17 okt: zonsopgang ≈ 06:10 UTC, zonsondergang ≈ 16:45 UTC, middag ≈ 11:28 UTC
  assert.ok(Math.abs(t.sunrise - Date.UTC(2026, 9, 17, 6, 10)) < 10 * 60_000, `zonsopgang ${fmt(t.sunrise)}`);
  assert.ok(Math.abs(t.maghrib - Date.UTC(2026, 9, 17, 16, 45)) < 10 * 60_000, `zonsondergang ${fmt(t.maghrib)}`);
  assert.ok(Math.abs(t.dhuhr - Date.UTC(2026, 9, 17, 11, 28)) < 6 * 60_000, `middag ${fmt(t.dhuhr)}`);
});

test("hanafi-asr is later dan standaard; diyanet-temkin verschuift tijden", () => {
  const a = prayerTimes({ date: "2026-06-21", latitude: 51.2, longitude: 4.4, method: "mwl" });
  const b = prayerTimes({ date: "2026-06-21", latitude: 51.2, longitude: 4.4, method: "mwl", asr: "hanafi" });
  assert.ok(b.asr - a.asr > 30 * 60_000);
  const d = prayerTimes({ date: "2026-06-21", latitude: 51.2, longitude: 4.4, method: "diyanet" });
  assert.equal(d.dhuhr - a.dhuhr, 6 * 60_000);
  assert.ok(METHODS.length >= 8);
  const m = prayerTimes({ date: "2026-03-01", latitude: 21.4, longitude: 39.8, method: "makkah" });
  assert.equal(m.isha - m.maghrib, 90 * 60_000);
});
