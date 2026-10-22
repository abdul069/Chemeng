import { test } from "node:test";
import assert from "node:assert/strict";
import { withCtx } from "./db.ts";
import { createUser, createHousehold } from "./accounts.ts";
import { processMail, parseRaw, listItems, newCount, setStatus, householdTag, plusAddress, shared } from "./inbox.ts";

const RAW = `From: Juf Els <els@school.be>
To: Gezin Daldal <inbox+abc1234@kinday.be>
Subject: Schoolreis vrijdag 24 oktober
Date: Wed, 21 Oct 2026 09:00:00 +0200
Message-ID: <test-1@school.be>
Content-Type: text/plain; charset=utf-8

Beste ouders, op vrijdag 24 oktober gaan we op schoolreis. Vertrek om 8u30 aan de school. Meebrengen: lunchpakket en regenjas.
`;

test("gezinsinbox: bericht wordt een item, dubbels worden overgeslagen, zonder AI blijft de tekst leesbaar, plus-adres per gezin", async () => {
  const userId = createUser({ name: "Test", email: `in${Date.now()}@x.be`, password: "geheim123" });
  const householdId = createHousehold(userId, "Testgezin");
  await withCtx({ userId, householdId }, async () => {
    const mail = await parseRaw(RAW);
    const item = await processMail(mail, householdId);
    assert.ok(item);
    assert.equal(item!.subject, "Schoolreis vrijdag 24 oktober");
    assert.ok(item!.sender.includes("els@school.be"));
    assert.ok(item!.body.includes("lunchpakket"));
    assert.equal(item!.status, "new");
    assert.equal(newCount(), 1);
    assert.equal(await processMail(await parseRaw(RAW), householdId), null, "zelfde Message-ID wordt niet twee keer bewaard");
    assert.equal(listItems().length, 1);
    setStatus(item!.id, "done"); assert.equal(newCount(), 0);
  });
  const tag = householdTag(householdId);
  assert.ok(/^[a-z0-9]{7}$/.test(tag)); assert.equal(tag, householdTag(householdId), "stabiel");
  assert.equal(shared(), null); assert.equal(plusAddress(householdId), null, "zonder gedeelde mailbox geen plus-adres");
  process.env.INBOX_IMAP_HOST = "imap.example.be"; process.env.INBOX_IMAP_USER = "inbox@kinday.be"; process.env.INBOX_IMAP_PASS = "x";
  assert.equal(plusAddress(householdId), `inbox+${tag}@kinday.be`);
  delete process.env.INBOX_IMAP_HOST; delete process.env.INBOX_IMAP_USER; delete process.env.INBOX_IMAP_PASS;
});
