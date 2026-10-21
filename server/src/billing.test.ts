import { test } from "node:test";
import assert from "node:assert/strict";
import { withCtx } from "./db.ts";
import { createUser, createHousehold } from "./accounts.ts";
import * as B from "./billing.ts";

test("geld: kosten per model, verbruik en budget per gezin, ledencodes met controle", () => {
  // kosten: 1 miljoen invoer- en 100.000 uitvoertokens
  assert.equal(B.costMicro("claude-haiku-5-5", { input_tokens: 1_000_000, output_tokens: 100_000 }), 150_000, "Haiku: $0,10 + $0,05");
  assert.equal(B.costMicro("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 100_000 }), 3_000_000, "Sonnet: $2 + $1");
  assert.ok(B.costMicro("onbekend-model", { input_tokens: 1000 }) > 0, "onbekend model valt terug op Sonnet-tarief");

  const u1 = createUser({ name: "A", email: `b1${Date.now()}@x.be`, password: "geheim123" });
  const h1 = createHousehold(u1, "Eerste gezin");
  const u2 = createUser({ name: "B", email: `b2${Date.now()}@x.be`, password: "geheim123" });
  const h2 = createHousehold(u2, "Tweede gezin");
  // het eerste gezin op deze testserver is de eigenaar: onbeperkt
  withCtx({ userId: u1, householdId: h1 }, () => {
    const b = B.budgetState();
    assert.equal(b.plan === "operator" || b.plan === "gezin", true);
  });
  withCtx({ userId: u2, householdId: h2 }, () => {
    let b = B.budgetState();
    assert.equal(b.plan, "gezin"); assert.equal(b.usedMicro, 0); assert.equal(b.blocked, false);
    // verbruik boeken tot over het budget van Gezin ($2,50)
    B.recordUsage("chat", "claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 50_000 }); // $2,50
    b = B.budgetState();
    assert.equal(b.usedMicro, 2_500_000); assert.equal(b.pct, 100); assert.equal(b.blocked, true);
    assert.equal(B.aiAllowed("chat"), false, "chat valt stil op het budget");
    assert.equal(B.aiAllowed("briefing"), true, "sjabloonwerk mag tot 120 %");
    assert.equal(b.perTask[0].task, "chat"); assert.equal(b.perTask[0].calls, 1);
    // partner met e-maildomeincontrole
    const pid = B.createPartner(B.PartnerInput.parse({ name: "Gezinsbond", slug: "gezinsbond", plan: "plus", freeMonths: 6, discountPct: 30, verify: "domain", domains: "gezinsbond.be" }));
    const code = B.createCode(pid, { code: "GB-TEST", maxUses: 2 });
    assert.equal(code, "GB-TEST");
    assert.throws(() => B.redeem("GB-FOUT", null), /bestaat niet/);
    assert.throws(() => B.redeem("gb-test", "iemand@gmail.com"), /e-mailadres/);
    const sub = B.redeem("gb-test", "lid@gezinsbond.be");
    assert.equal(sub.plan, "plus"); assert.equal(sub.partnerName, "Gezinsbond"); assert.ok(sub.validUntil);
    b = B.budgetState();
    assert.equal(b.plan, "plus"); assert.equal(b.blocked, false, "met Gezin+ is er weer ruimte");
    // ledenlijst-controle
    const p2 = B.createPartner(B.PartnerInput.parse({ name: "Mutualiteit", slug: "mut", verify: "list", freeMonths: 0 }));
    B.addMembers(p2, ["12345", "Lid@Mut.be"]);
    const c2 = B.createCode(p2, { maxUses: 1 });
    assert.throws(() => B.redeem(c2, "99999"), /ledenlijst/);
    B.redeem(c2, "lid@mut.be");
    assert.throws(() => B.redeem(c2, "12345"), /maximale aantal/);
    const stats = B.partnerStats(p2);
    assert.equal(stats.redeemed, 1, "het gezin hangt nu aan de laatste partner"); assert.equal(stats.codes.length, 1);
    assert.equal(B.partnerStats(pid).redeemed, 0);
    // verlopen abonnement valt terug op de standaard, met korting onthouden
    B.setPlan(h2, "plus", { source: "partner", partnerId: pid, discountPct: 30, validUntil: "2020-01-01T00:00:00.000Z" });
    const s2 = B.subscription();
    assert.equal(s2.plan, "gezin"); assert.equal(s2.source, "expired"); assert.equal(s2.discountPct, 30);
  });
});
