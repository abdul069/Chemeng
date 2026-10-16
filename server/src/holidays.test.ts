import { test } from "node:test";
import assert from "node:assert/strict";
import { easter, belgianHolidays, holidaysBetween, holidayOccurrences } from "./holidays.js";

test("berekent Pasen", () => {
  assert.equal(easter(2026), "2026-04-05");
  assert.equal(easter(2027), "2027-03-28");
  assert.equal(easter(2024), "2024-03-31");
});

test("Belgische feestdagen 2026", () => {
  const h = Object.fromEntries(belgianHolidays(2026).map((x) => [x.title, x.date]));
  assert.equal(h["Paasmaandag"], "2026-04-06");
  assert.equal(h["O.L.H. Hemelvaart"], "2026-05-14");
  assert.equal(h["Pinkstermaandag"], "2026-05-25");
  assert.equal(h["Nationale feestdag"], "2026-07-21");
});

test("feestdagen in een periode, meerdaags feest per dag", () => {
  const list = holidaysBetween("2026-05-20", "2026-06-01");
  assert.deepEqual(list.map((h) => h.title), ["Pinkstermaandag", "Kurban Bayramı (Offerfeest)"]);
  const occ = holidayOccurrences("2026-05-28", "2026-05-29", ["islam"]);
  assert.equal(occ.length, 2, "twee dagen van het Offerfeest binnen de periode");
  assert.ok(occ.every((o) => o.readOnly && o.allDay && o.source === "holiday"));
  assert.equal(holidaysBetween("2026-05-20", "2026-06-01", ["be"]).length, 1);
});

test("alle jaren binnen een lange periode", () => {
  const titles = holidaysBetween("2026-12-01", "2028-02-01", ["be"]).map((h) => h.date);
  assert.ok(titles.includes("2027-07-21"), "2027 zit ertussen");
  assert.ok(titles.includes("2026-12-25") && titles.includes("2028-01-01"));
});
