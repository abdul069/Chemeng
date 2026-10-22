import { test } from "node:test";
import assert from "node:assert/strict";
import { withCtx } from "./db.ts";
import { createUser, createHousehold } from "./accounts.ts";
import { subscription } from "./billing.ts";
import { verifySignature, sign, handleEvent, webhook, planForPrice, state, available } from "./stripe.ts";

test("stripe: handtekening, abonnement aan en uit via webhook, idempotent", async () => {
  process.env.STRIPE_PRICE_GEZIN_MONTH = "price_gezin_m"; process.env.STRIPE_PRICE_PLUS_YEAR = "price_plus_y"; process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  const userId = createUser({ name: "Test", email: `st${Date.now()}@x.be`, password: "geheim123" });
  createHousehold(userId, "Eigenaarsgezin"); // het eerste gezin op de server is de eigenaar en heeft geen formule nodig
  const h = createHousehold(userId, "Stripegezin");
  await withCtx({ userId, householdId: h }, async () => {
    assert.equal(available(), false, "zonder sleutel niet beschikbaar");
    assert.equal(planForPrice("price_plus_y"), "plus"); assert.equal(planForPrice("price_x"), null);
    const raw = JSON.stringify({ id: "evt_1", type: "customer.subscription.created", data: { object: { id: "sub_1", customer: "cus_1", status: "active", metadata: { household_id: h }, items: { data: [{ price: { id: "price_plus_y" }, current_period_end: 1_900_000_000 }] } } } });
    assert.equal(verifySignature(raw, sign(raw, "whsec_test"), "whsec_test"), true);
    assert.equal(verifySignature(raw, sign(raw, "whsec_fout"), "whsec_test"), false);
    assert.equal(verifySignature(raw, sign(raw, "whsec_test", Date.now() - 10 * 60_000), "whsec_test"), false, "te oud");
    assert.equal(webhook(Buffer.from(raw), "t=1,v1=00").status, 400);
    const r = webhook(Buffer.from(raw), sign(raw, "whsec_test"));
    assert.equal(r.status, 200); assert.equal(r.body.applied, true);
    let sub = subscription(h); assert.equal(sub.plan, "plus"); assert.equal(sub.source, "stripe"); assert.ok(sub.validUntil! > "2030");
    assert.equal(handleEvent(JSON.parse(raw)).applied, false, "zelfde gebeurtenis niet twee keer");
    assert.equal(state(h).managed, true);
    // opzegging: terug naar de standaardformule
    handleEvent({ id: "evt_2", type: "customer.subscription.deleted", data: { object: { id: "sub_1", customer: "cus_1", status: "canceled", items: { data: [{ price: { id: "price_plus_y" } }] } } } });
    sub = subscription(h); assert.notEqual(sub.source, "stripe"); assert.equal(state(h).managed, false);
    // checkout afgerond koppelt klant aan gezin, zodat latere gebeurtenissen zonder metadata ook aankomen
    handleEvent({ id: "evt_3", type: "checkout.session.completed", data: { object: { client_reference_id: h, customer: "cus_9", subscription: "sub_9" } } });
    handleEvent({ id: "evt_4", type: "customer.subscription.updated", data: { object: { id: "sub_9", customer: "cus_9", status: "active", current_period_end: 1_900_000_000, items: { data: [{ price: { id: "price_gezin_m" } }] } } } });
    assert.equal(subscription(h).plan, "gezin"); assert.equal(subscription(h).source, "stripe");
  });
  delete process.env.STRIPE_PRICE_GEZIN_MONTH; delete process.env.STRIPE_PRICE_PLUS_YEAR; delete process.env.STRIPE_WEBHOOK_SECRET;
});
