import { test } from "node:test";
import assert from "node:assert/strict";
import { withCtx } from "./db.ts";
import { createUser, createHousehold } from "./accounts.ts";
import * as S from "./store.ts";
import * as H from "./home.ts";

const iso = (d: Date) => d.toISOString().slice(0, 10);

test("het huis: onderhoud met termijnen en logboek, afvalregels, gezondheid met opvolging en medicatie", () => {
  const userId = createUser({ name: "Test", email: `h${Date.now()}@x.be`, password: "geheim123" });
  const householdId = createHousehold(userId, "Testgezin");
  withCtx({ userId, householdId }, () => {
    // sjablonen
    assert.equal(H.applyTemplates(["keuring", "cv-gas", "rookmelders"]), 3);
    assert.equal(H.applyTemplates(["keuring"]), 0, "geen dubbels");
    let list = H.listUpkeep();
    assert.equal(list.length, 3);
    assert.ok(list.every((u) => u.status === "none"), "zonder datum nog geen status");
    // keuring gedaan op 1 maart → volgende over 12 maanden
    const keuring = list.find((u) => u.title === "Autokeuring")!;
    const after = H.upkeepDone(keuring.id, "2026-03-01", "Goedgekeurd zonder opmerkingen")!;
    assert.equal(after.nextDue, "2027-03-01");
    assert.equal(after.log.length, 1);
    // iets dat volgende week vervalt is "soon", iets van gisteren "late"
    const soon = iso(new Date(Date.now() + 5 * 864e5)), late = iso(new Date(Date.now() - 864e5));
    H.createUpkeep(H.UpkeepInput.parse({ title: "Filters", intervalMonths: 6, nextDue: soon, leadDays: 14 }));
    H.createUpkeep(H.UpkeepInput.parse({ title: "Zout", intervalMonths: 2, nextDue: late, leadDays: 7 }));
    list = H.listUpkeep();
    assert.equal(list.find((u) => u.title === "Filters")?.status, "soon");
    assert.equal(list.find((u) => u.title === "Zout")?.status, "late");
    assert.equal(list[0].title, "Zout", "dringendste eerst");

    // afval: PMD om de twee weken op de weekdag van vandaag, vanaf vandaag
    const t = iso(new Date()); const wd = new Date(t + "T12:00:00").getDay();
    H.createWaste(H.WasteInput.parse({ fraction: "pmd", weekday: wd, everyWeeks: 2, startDate: t }));
    H.createWaste(H.WasteInput.parse({ fraction: "rest", weekday: wd, everyWeeks: 1, startDate: t }));
    assert.deepEqual(H.wasteOn(t).sort(), ["pmd", "rest"]);
    const plus7 = iso(new Date(Date.now() + 7 * 864e5)), plus14 = iso(new Date(Date.now() + 14 * 864e5));
    assert.deepEqual(H.wasteOn(plus7), ["rest"], "PMD niet in de tussenweek");
    assert.deepEqual(H.wasteOn(plus14).sort(), ["pmd", "rest"]);
    assert.ok(H.wasteNext(15).length >= 3);

    // gezondheid: tandarts met controle over 6 maanden
    const m = S.listMembers()[0];
    const id = H.createHealth(H.HealthInput.parse({ memberId: m.id, kind: "visit", title: "Tandarts", date: "2026-10-01", time: "09:30", provider: "Dr. Peeters", followUpMonths: 6 }));
    const next = H.healthDone(id)!;
    assert.equal(next.kind, "checkup"); assert.equal(next.date, "2027-04-01"); assert.equal(next.provider, "Dr. Peeters");
    assert.equal(H.listHealth().filter((x) => !x.done).length, 1);
    // medicatie elke dag om 8u en 20u
    H.createHealth(H.HealthInput.parse({ memberId: m.id, kind: "medication", title: "Bloeddrukpil", times: "08:00, 20:00", stock: 5 }));
    const meds = H.medicationOn(t);
    assert.equal(meds.length, 1); assert.deepEqual(meds[0].timesList, ["08:00", "20:00"]);
  });
});
