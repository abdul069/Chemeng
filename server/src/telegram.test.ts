import { test } from "node:test";
import assert from "node:assert/strict";
import { withCtx } from "./db.ts";
import { createUser, createHousehold } from "./accounts.ts";
import { listItems, newCount } from "./inbox.ts";
import { handleUpdates } from "./telegram.ts";

test("telegram: /start krijgt uitleg, tekst en foto worden inbox-items, bevestiging in de taal van het gezin, dubbels overgeslagen", async () => {
  const userId = createUser({ name: "Test", email: `tg${Date.now()}@x.be`, password: "geheim123" });
  const h = createHousehold(userId, "Telegramgezin");
  const sent: { chat: number; text: string }[] = [];
  const send = async (chat: number, text: string) => { sent.push({ chat, text }); };
  const getFile = async () => ({ content: Buffer.from("not-really-a-jpeg"), contentType: "image/jpeg" });
  const updates = [
    { update_id: 10, message: { message_id: 1, date: 1_760_000_000, chat: { id: 42, type: "private", first_name: "Ayşe" }, from: { first_name: "Ayşe" }, text: "/start" } },
    { update_id: 11, message: { message_id: 2, date: 1_760_000_100, chat: { id: 42, type: "private" }, from: { first_name: "Ayşe" }, text: "melk, brood, luiers" } },
    { update_id: 12, message: { message_id: 3, date: 1_760_000_200, chat: { id: 42, type: "private" }, from: { first_name: "Ayşe" }, caption: "schoolbrief", photo: [{ file_id: "small" }, { file_id: "big" }] } },
    { update_id: 13, message: { message_id: 4, date: 1_760_000_300, chat: { id: 42, type: "private" }, from: { first_name: "Ayşe" }, text: "melk, brood, luiers" } },
  ];
  await withCtx({ userId, householdId: h }, async () => {
    const r = await handleUpdates(updates, h, "tr", send, getFile);
    assert.equal(r.offset, 14); assert.equal(r.items, 3); assert.deepEqual(r.chats, [42]);
    assert.ok(sent[0].text.startsWith("Merhaba"), "uitleg bij /start");
    assert.equal(sent.length, 4); assert.ok(sent[1].text.startsWith("✅"));
    const items = listItems(h);
    assert.equal(items.length, 3);
    assert.ok(items.every((i) => i.sender.startsWith("Telegram · Ayşe")));
    assert.equal(items.find((i) => i.subject === "schoolbrief")!.data.images, 1);
    assert.equal(newCount(h, "Telegram"), 3); assert.equal(newCount(h, "Mail"), 0);
    const again = await handleUpdates([updates[1]], h, "tr", send, getFile);
    assert.equal(again.items, 0, "zelfde bericht-id wordt niet twee keer bewaard");
  });
});
