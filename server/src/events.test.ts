import { test } from "node:test";
import assert from "node:assert/strict";
import { expand, type CalEvent } from "./events.js";
import { addMonths, addDays } from "./dates.js";

const base: CalEvent = {
  id: "e1", title: "Test", notes: "", location: "", date: "2026-01-05", endDate: null, startTime: "17:00", endTime: "18:00",
  allDay: false, repeat: "none", repeatUntil: null, exdates: [], members: [], source: "local", readOnly: false,
};

test("eenmalige afspraak valt enkel op haar datum", () => {
  assert.deepEqual(expand(base, "2026-01-01", "2026-01-31").map((o) => o.on), ["2026-01-05"]);
  assert.equal(expand(base, "2026-02-01", "2026-02-28").length, 0);
});

test("wekelijkse afspraak springt correct naar het venster", () => {
  const ev = { ...base, repeat: "weekly" as const };
  assert.deepEqual(expand(ev, "2026-03-01", "2026-03-15").map((o) => o.on), ["2026-03-02", "2026-03-09"]);
});

test("tweewekelijks en uitzonderingen", () => {
  const ev = { ...base, repeat: "biweekly" as const, exdates: ["2026-01-19"] };
  assert.deepEqual(expand(ev, "2026-01-01", "2026-02-10").map((o) => o.on), ["2026-01-05", "2026-02-02"]);
});

test("herhaling stopt op de einddatum van de reeks", () => {
  const ev = { ...base, repeat: "daily" as const, repeatUntil: "2026-01-07" };
  assert.deepEqual(expand(ev, "2026-01-01", "2026-01-31").map((o) => o.on), ["2026-01-05", "2026-01-06", "2026-01-07"]);
});

test("maandelijks op de 31e slaat korte maanden over", () => {
  const ev = { ...base, date: "2026-01-31", repeat: "monthly" as const };
  assert.deepEqual(expand(ev, "2026-01-01", "2026-05-31").map((o) => o.on), ["2026-01-31", "2026-03-31", "2026-05-31"]);
  assert.equal(addMonths("2026-01-31", 1), null);
});

test("meerdaagse afspraak verschijnt als ze het venster overlapt", () => {
  const ev = { ...base, allDay: true, startTime: null, endTime: null, date: "2026-07-01", endDate: "2026-07-14" };
  const occ = expand(ev, "2026-07-10", "2026-07-12");
  assert.equal(occ.length, 1);
  assert.equal(occ[0].until, "2026-07-14");
});

test("jaarlijkse verjaardag", () => {
  const ev = { ...base, allDay: true, date: "2020-10-21", repeat: "yearly" as const };
  assert.deepEqual(expand(ev, "2026-10-01", "2026-10-31").map((o) => o.on), ["2026-10-21"]);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});
