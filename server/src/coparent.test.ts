import { test } from "node:test";
import assert from "node:assert/strict";
import { withCtx, setSettings } from "./db.ts";
import { createUser, createHousehold, createInvite, acceptInvite } from "./accounts.ts";
import { createEvent } from "./events.ts";
import * as S from "./store.ts";
import * as F from "./family.ts";
import * as CP from "./coparent.ts";
import { buildBriefing } from "./manager.ts";

const ev = (title: string, date: string, members: string[]) => createEvent({ title, date, endDate: null, startTime: "10:00", endTime: "11:00", allDay: false, repeat: "none", repeatUntil: null, exdates: [], members, location: "", notes: "", countdown: false } as never);

test("co-ouderschap: kinderen in twee huizen, verblijfsregeling, overdracht, kostenpot en pincode van papa", async () => {
  const um = createUser({ name: "Sarah", email: `cpm${Date.now()}@x.be`, password: "geheim123" });
  const hm = createHousehold(um, "Mama");
  const up = createUser({ name: "Kristof", email: `cpp${Date.now()}@x.be`, password: "geheim123" });
  const hp = createHousehold(up, "Papa");
  const { token } = createInvite(um, hm, { kind: "link", label: "" });
  acceptInvite(token, up, hp);
  const M = { userId: um, householdId: hm }, P = { userId: up, householdId: hp };

  let lars = "", link = "";
  withCtx(M, () => {
    lars = S.createMember({ name: "Lars", color: "#3366aa", role: "kind", birthday: "2016-03-01" }).id;
    link = F.listLinks()[0].id;
    S.createChore({ memberId: lars, title: "Tanden poetsen", icon: "🪥", days: [0, 1, 2, 3, 4, 5, 6], points: 1, moment: "ochtend" });
    assert.throws(() => withCtx(P, () => CP.setMemberShared(link, lars, true)), /eigen gezin/);
    CP.setMemberShared(link, lars, true);
    // week om week, vrijdag 6 november 2026 gaan de kinderen naar mama (cyclus begint bij ons)
    CP.setCustody(link, { cycle: CP.CUSTODY_PRESETS.week.cycle, anchor: "2026-11-06", startWithMe: true, handoverTime: "16:00", mySplit: 50 });
    CP.addHandoverItem({ memberId: lars, text: "Pufjes", icon: "💨" });
    setSettings({ settings_pin: "1111" });
  });

  await withCtx(P, async () => {
    // Lars is in papa's gezin te gast, met zijn taken en sterren
    const g = S.listMembers().find((m) => m.id === lars);
    assert.ok(g && g.guestOf === "Mama");
    assert.equal(S.listChores().filter((c) => c.memberId === lars).length, 1, "taken lopen door bij papa");
    const chore = S.listChores().find((c) => c.memberId === lars)!;
    S.setChoreDone(chore.id, "2026-11-14", true);
    assert.equal(S.points()[lars].earned, 1);
    // papa zet een tandartsafspraak voor Lars
    ev("Tandarts Lars", "2026-11-17", [lars]);
    // de regeling vanuit papa: kinderen hier van vrijdag 13 tot donderdag 19
    const cus = CP.getCustody(link)!;
    assert.equal(cus.cycle, "bbbbbbbaaaaaaa", "vanuit papa gezien is 'a' altijd 'wij'");
    assert.equal(CP.custodyHousehold(link, "2026-11-12"), hm);
    assert.equal(CP.custodyHousehold(link, "2026-11-13"), hp);
    const t = CP.custodyToday("2026-11-13");
    assert.ok(t[0].withUs && t[0].handoverToday && t[0].handover?.date === "2026-11-20" && t[0].until === "2026-11-19");
    // overdrachtslijst en briefing op de overdrachtsdag
    const ho = CP.handoverFor("2026-11-13");
    assert.ok(ho.handoverToday && ho.kids[0].items[0].text === "Pufjes");
    const b = await buildBriefing("morning", "2026-11-13", null);
    assert.ok(b.items.some((i) => /komt Lars terug van Mama/.test(i.text)), `overdracht in de briefing: ${JSON.stringify(b.items)}`);
    assert.ok(b.items.some((i) => /Pufjes/.test(i.text)), "met wat mee moet");
    // papa betaalt voetbalschoenen van 80 euro: mama is 40 schuldig
    CP.addExpense(link, { title: "Voetbalschoenen", amount: 80, date: "2026-11-14", memberId: lars, kind: "cost", note: "" });
    assert.equal(CP.costPot(link).balance, 40);
  });

  withCtx(M, () => {
    // bij mama: de afspraak van papa staat in de agenda (alleen-lezen), de ster ook, en de regeling als blok
    const layer = CP.layerEvents("2026-11-01", "2026-11-30");
    assert.ok(layer.some((o) => o.title === "Tandarts Lars" && o.readOnly && o.source === "anderhuis"));
    assert.ok(layer.some((o) => o.source === "verblijf" && o.title === "🏠 Bij Papa" && o.on === "2026-11-13" && o.until === "2026-11-19"));
    assert.equal(S.points()[lars].earned, 1, "sterren tellen in beide huizen");
    const pot = CP.costPot(link);
    assert.equal(pot.balance, -40); assert.equal(pot.items[0].payer, "Papa");
    CP.addExpense(link, { title: "Terugbetaald", amount: 40, date: "2026-11-15", memberId: null, kind: "settle", note: "" });
    assert.equal(CP.costPot(link).balance, 0);
    // vakantie: overschrijving van de regeling
    CP.addOverride(link, { from: "2026-12-21", to: "2026-12-27", withMe: true, note: "Kerst" });
    assert.equal(CP.custodyHousehold(link, "2026-12-25"), hm);
    // routineherinnering alleen in het huis waar Lars die dag is
    assert.equal(CP.isPresent(lars, "2026-11-14"), false);
    assert.equal(CP.isPresent(lars, "2026-11-10"), true);
  });

  // pincode van papa op de kindertablet van Lars (die bij mama hoort)
  withCtx(P, () => setSettings({ settings_pin: "2222" }));
  assert.equal(CP.otherParentPinOk(lars, "2222"), true);
  assert.equal(CP.otherParentPinOk(lars, "3333"), false);

  // verbinding verbreken: Lars hoort weer alleen bij mama
  withCtx(M, () => F.deleteLink(link));
  withCtx(P, () => assert.equal(S.listMembers().some((m) => m.id === lars), false));
});
