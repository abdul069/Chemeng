import { test } from "node:test";
import assert from "node:assert/strict";
import { holidaysBetween, dutchHolidays, sinterklaasKerst, ramadan, bayram, localizeHoliday, ukHolidays, germanHolidays, frenchHolidays, turkishHolidays, moroccanHolidays } from "./holidays.ts";

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
  assert.equal(bayram("2026-03-15")!.daysUntil, 5); assert.equal(bayram("2026-03-21")!.day, 2); assert.equal(bayram("2026-03-01"), null); assert.equal(bayram("2026-05-28")!.title, "Kurban Bayramı (Offerfeest)");
  assert.equal(localizeHoliday({ date: "2027-04-27", title: "Koningsdag", icon: "🧡", kind: "nl" }, "en").title, "King's Day");
  assert.equal(localizeHoliday({ date: "2026-12-06", title: "Sinterklaas", icon: "🎁", kind: "sinterklaas" }, "tr").title, "Sinterklaas");
});

test("tradities: landenpakketten UK, DE, FR, TR en MA", () => {
  const uk2026 = ukHolidays(2026);
  assert.equal(uk2026.find((h) => h.title === "Early May bank holiday")!.date, "2026-05-04");
  assert.equal(uk2026.find((h) => h.title === "Spring bank holiday")!.date, "2026-05-25");
  assert.equal(uk2026.find((h) => h.title === "Summer bank holiday")!.date, "2026-08-31");
  assert.equal(ukHolidays(2027).find((h) => h.title === "Boxing Day")!.date, "2027-12-28", "26 december 2027 is een zondag en 25 een zaterdag: Kerst → maandag 27, Boxing Day → dinsdag 28");
  assert.equal(ukHolidays(2027).find((h) => h.title === "Christmas Day")!.date, "2027-12-27");
  assert.equal(germanHolidays(2026).find((h) => h.title === "Tag der Deutschen Einheit")!.date, "2026-10-03");
  assert.equal(frenchHolidays(2026).find((h) => h.title === "Lundi de Pentecôte")!.date, "2026-05-25");
  assert.equal(turkishHolidays(2026).find((h) => h.title === "29 Ekim Cumhuriyet Bayramı")!.date, "2026-10-29");
  assert.equal(moroccanHolidays(2026).find((h) => h.title === "Troonfeest")!.date, "2026-07-30");
  const jul = holidaysBetween("2026-07-01", "2026-07-31", ["fr", "tr", "ma"]);
  assert.deepEqual(jul.map((h) => h.kind).sort(), ["fr", "ma", "tr"]);
  assert.ok(!holidaysBetween("2026-07-01", "2026-07-31", ["be"]).some((h) => h.kind !== "be"));
  assert.equal(localizeHoliday({ date: "2026-07-30", title: "Troonfeest", icon: "👑", kind: "ma" }, "en").title, "Throne Day");
  assert.equal(localizeHoliday({ date: "2026-10-29", title: "29 Ekim Cumhuriyet Bayramı", icon: "🇹🇷", kind: "tr" }, "en").title, "Republic Day");
});
