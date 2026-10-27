import { test } from "node:test";
import assert from "node:assert/strict";
import { withCtx, setSettings } from "./db.ts";
import { createUser, createHousehold } from "./accounts.ts";
import * as S from "./store.ts";
import * as RH from "./rhythm.ts";
import { buildBriefing } from "./manager.ts";
import { addDays } from "./dates.ts";

test("ritme: taal per persoon, ploegenrooster, stille uren na de nachtdienst en tienerdoelen", async () => {
  const u = createUser({ name: "Mehmet", email: `rh${Date.now()}@x.be`, password: "geheim123" });
  const h = createHousehold(u, "Gezin Yılmaz");
  await withCtx({ userId: u, householdId: h }, async () => {
    setSettings({ language: "nl" });
    const ayse = S.createMember({ name: "Ayşe", color: "#aa3366", role: "ouder", lang: "tr" });
    const mehmet = S.createMember({ name: "Mehmet", color: "#3366aa", role: "ouder" });
    const emre = S.createMember({ name: "Emre", color: "#33aa66", role: "kind", birthday: "2008-05-01" });
    const defne = S.createMember({ name: "Defne", color: "#aa9933", role: "kind", birthday: "2018-05-01" });
    assert.equal(RH.langOf(ayse.id), "tr");
    assert.equal(RH.langOf(mehmet.id), "nl", "zonder eigen taal: die van het gezin");
    assert.equal(S.listMembers().find((m) => m.id === emre.id)!.teen, true);
    assert.equal(S.listMembers().find((m) => m.id === defne.id)!.teen, false);

    // de briefing van Ayşe komt in het Turks, die van Mehmet in het Nederlands
    const d = "2026-11-02"; // een maandag
    assert.match((await buildBriefing("morning", d, ayse.id)).title, /Günaydın/);
    assert.match((await buildBriefing("morning", d, mehmet.id)).title, /Goeiemorgen/);

    // 3 ploegen vanaf maandag 2 november: week 1 vroeg, week 2 laat, week 3 nacht, week 4 weer vroeg
    const sh = RH.saveShift({ memberId: mehmet.id, startDate: "2026-11-04", weeks: RH.SHIFT_PRESETS.drie.weeks });
    assert.equal(sh.startDate, "2026-11-02", "de cyclus begint op maandag");
    assert.equal(RH.shiftWeekOn(sh, "2026-11-03")!.name, "Vroege dienst");
    assert.equal(RH.shiftWeekOn(sh, "2026-11-10")!.name, "Late dienst");
    assert.equal(RH.shiftWeekOn(sh, "2026-11-17")!.name, "Nachtdienst");
    assert.equal(RH.shiftWeekOn(sh, "2026-11-24")!.name, "Vroege dienst");
    const occ = RH.shiftOccurrences("2026-11-17", "2026-11-18");
    assert.ok(occ.some((o) => o.on === "2026-11-17" && o.startTime === "22:00"), "nachtdienst begint om 22u");
    assert.ok(occ.some((o) => o.on === "2026-11-18" && o.startTime === "00:00" && o.endTime === "06:00"), "en loopt door tot 6u de dag erna");
    assert.equal(RH.shiftOccurrences("2026-11-21", "2026-11-22").filter((o) => o.startTime === "22:00").length, 0, "geen dienst in het weekend");

    // na de nachtdienst slaapt Mehmet van 6u tot 14u: stil om 10u, niet meer om 15u
    const at = (date: string, hh: number) => { const [y, m, dd] = date.split("-").map(Number); return new Date(y, m - 1, dd, hh, 0); };
    const q = RH.quietNow(mehmet.id, at("2026-11-18", 10));
    assert.ok(q && q.reason === "night" && q.until === "14:00");
    assert.equal(RH.quietNow(mehmet.id, at("2026-11-18", 15)), null);
    assert.equal(RH.quietNow(mehmet.id, at("2026-11-04", 10)), null, "in de week van de vroege dienst niet");
    // zelf ingestelde stille uren over middernacht
    S.updateMember(ayse.id, { name: "Ayşe", color: "#aa3366", role: "ouder", quietFrom: "22:30", quietUntil: "06:30" });
    assert.ok(RH.quietNow(ayse.id, at("2026-11-05", 23)));
    assert.ok(RH.quietNow(ayse.id, at("2026-11-06", 5)));
    assert.equal(RH.quietNow(ayse.id, at("2026-11-06", 7)), null);
    assert.equal(S.listMembers().find((m) => m.id === ayse.id)!.lang, "tr", "taal blijft staan als ze niet meegestuurd wordt");

    // tienerdoelen: rijlessen tellen tot het doel bereikt is
    const g = RH.createGoal({ memberId: emre.id, title: "Rijlessen", icon: "🚗", kind: "count", target: 2, unit: "lessen" });
    RH.addGoalEntry(g.id, { amount: 1, note: "", date: d });
    let goal = RH.addGoalEntry(g.id, { amount: 1, note: "snelweg", date: addDays(d, 7) });
    assert.equal(goal.progress, 2); assert.ok(goal.doneAt, "doel bereikt");
    RH.deleteGoalEntry(goal.entries[0].id);
    goal = RH.listGoals(emre.id)[0];
    assert.equal(goal.progress, 1); assert.equal(goal.doneAt, null);
  });
});
