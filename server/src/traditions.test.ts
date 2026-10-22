import { test } from "node:test";
import assert from "node:assert/strict";
import { holidaysBetween, dutchHolidays, sinterklaasKerst, ramadan, localizeHoliday } from "./holidays.ts";

test("tradities: Nederlandse feestdagen, Sinterklaas per land, ramadan-dag en vertaalde namen", () => {
  const nl2027 = dutchHolidays(2027);
  assert.equal(nl2027.find((h) => h.title === "Koningsdag")!.date, "2027-04-27");
  assert.equal(dutchHolidays(2025).find((h) => h.title === "Koningsdag")!.date, "2025-04-26", "27 april 2025 is een zondag, dus de zaterdag ervoor");
  assert.equal(nl2027.find((h) => h.title === "Pasen")!.date, "2027-03-28");
  assert.equal(sinterklaasKerst(2026, "BE").find((h) => h.title === "Sinterklaas")!.date, "2026-12-06");
  assert.equal(sinterklaasKerst(2026, "NL")[0].date, "2026-12-05");
  const dec = holidaysBetween("2026-12-01", "2026-12-31", ["be", "sinterklaas"], "BE");
  assert.ok(dec.some((h) => h.title === "Advent") && dec.some((h) => h.title === "Sinterklaas") && dec.some((h) => h.kind === "be" && h.title === "Kerstmis"));
  assert.ok(!holidaysBetween("2026-12-01", "2026-12-31", ["be"]).some((h) => h.kind === "sinterklaas"), "pakket uit = niets ervan");
  const r = ramadan("2026-03-01")!;
  assert.equal(r.day, 12); assert.equal(r.eid, "2026-03-20"); assert.equal(r.total, 30);
  assert.equal(ramadan("2026-04-01"), null);
  assert.equal(localizeHoliday({ date: "2027-04-27", title: "Koningsdag", icon: "🧡", kind: "nl" }, "en").title, "King's Day");
  assert.equal(localizeHoliday({ date: "2026-12-06", title: "Sinterklaas", icon: "🎁", kind: "sinterklaas" }, "tr").title, "Sinterklaas");
});
