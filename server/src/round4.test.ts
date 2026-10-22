import { test } from "node:test";
import assert from "node:assert/strict";
import { withCtx } from "./db.ts";
import { createUser, createHousehold } from "./accounts.ts";
import * as S from "./store.ts";
import { createConnection, getConnection, connectorCalendar, connectorBriefing, findWebhook, bumpWebhook, connectorById } from "./connectors.ts";
import { breaksBetween, isSchoolBreak } from "./schoolyear.ts";
import { addPrice, lookup, commit, listPrices } from "./prices.ts";
import { today, addDays } from "./dates.ts";

test("ronde 4: schoolvakanties in de agenda en briefing, webhook-sleutel, promo's met vervaldatum", async () => {
  assert.equal(breaksBetween("vl", "2026-12-25", "2026-12-25", "nl")[0].title, "Kerstvakantie");
  assert.equal(breaksBetween("nl-zuid", "2027-02-15", "2027-02-15", "en")[0].title, "Spring half-term");
  assert.ok(isSchoolBreak("fwb", "2026-10-20")); assert.ok(!isSchoolBreak("vl", "2026-10-20"));

  const userId = createUser({ name: "Test", email: `r4${Date.now()}@x.be`, password: "geheim123" });
  const householdId = createHousehold(userId, "Testgezin");
  await withCtx({ userId, householdId }, async () => {
    createConnection({ connector: "school_holidays", config: { region: "vl" }, onBoard: false, enabled: true });
    const cal = connectorCalendar("2026-12-01", "2027-01-31");
    assert.ok(cal.some((c) => c.title.includes("Kerstvakantie") && c.date === "2026-12-21" && c.endDate === "2027-01-03"));
    const b = connectorBriefing({ kind: "evening", date: "2026-12-20", memberId: null, lang: "nl" });
    assert.ok(b.items.some((i) => i.text.startsWith("Morgen begint de kerstvakantie")), JSON.stringify(b.items));

    // webhook: sleutel wordt automatisch gemaakt, is terug te vinden en telt ontvangsten
    const id = createConnection({ connector: "webhooks", config: {}, onBoard: false, enabled: true });
    const c = getConnection(id)!;
    assert.ok(typeof c.config.token === "string" && (c.config.token as string).length >= 20);
    assert.equal(findWebhook(c.config.token as string)?.id, id);
    assert.equal(findWebhook("kort"), null);
    bumpWebhook(c); assert.equal(getConnection(id)!.state.count, 1);
    assert.equal(connectorById("deals_feed")?.status, "ready");

    // promo: telt mee zolang hij geldig is, daarna niet meer
    addPrice({ label: "Halfvolle melk 1L", store: "Colruyt", price: 1.39, source: "manual" });
    addPrice({ label: "Halfvolle melk 1L", store: "Lidl", price: 0.89, source: "deal", validUntil: addDays(today(), 3) });
    addPrice({ label: "Halfvolle melk 1L", store: "Aldi", price: 0.5, source: "deal", validUntil: addDays(today(), -1) });
    const [melk] = lookup(["melk"]);
    assert.equal(melk.cheapest?.store, "Lidl", "de lopende promo wint, de verlopen promo telt niet mee");
    assert.equal(melk.cheapest?.validUntil, addDays(today(), 3));
    // folderfoto inboeken: deals zonder ticket, geen afvinken
    const shop = S.ensureShoppingList(); S.addItem(shop, "kaas");
    const r = commit({ store: "Delhaize", date: today(), total: null, validUntil: addDays(today(), 6), items: [{ label: "Jonge kaas 400g", qty: 400, unit: "g", price: 3.99 }], source: "folder", toPantry: true, tickList: true });
    assert.equal(r.prices, 1); assert.equal(r.ticked, 0); assert.equal(r.stocked, 0); assert.equal(r.receiptId, null);
    const deal = listPrices({ store: "Delhaize" })[0];
    assert.equal(deal.source, "deal"); assert.equal(deal.validUntil, addDays(today(), 6));
  });
});
