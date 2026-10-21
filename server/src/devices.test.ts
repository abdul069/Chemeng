import { test } from "node:test";
import assert from "node:assert/strict";
import { withCtx } from "./db.ts";
import { createUser, createHousehold } from "./accounts.ts";
import * as S from "./store.ts";

test("toestellen: aanmelden, online-status, verwijderen; prikbord: briefjes vastprikken en bewerken", () => {
  const userId = createUser({ name: "Test", email: `d${Date.now()}@x.be`, password: "geheim123" });
  const householdId = createHousehold(userId, "Testgezin");
  withCtx({ userId, householdId }, () => {
    const member = S.listMembers()[0];
    S.upsertDevice("hub-aaaaaaaa", userId, { name: "Wandscherm keuken", role: "hub", variant: "wall", platform: "web", memberId: null });
    S.upsertDevice("phone-bbbbbbbb", userId, { name: "Telefoon van Elif", role: "phone", variant: "", platform: "android", memberId: member.id });
    let devs = S.listDevices();
    assert.equal(devs.length, 2);
    assert.equal(devs[0].role, "hub", "hubs eerst");
    assert.ok(devs.every((d) => d.online), "net aangemeld = online");
    assert.equal(devs[1].memberId, member.id);
    // nog eens aanmelden met een andere naam werkt bij (geen dubbel)
    S.upsertDevice("hub-aaaaaaaa", userId, { name: "Tafelmodel", role: "hub", variant: "table", platform: "web", memberId: null });
    devs = S.listDevices();
    assert.equal(devs.length, 2);
    assert.equal(devs.find((d) => d.id === "hub-aaaaaaaa")?.variant, "table");
    S.deleteDevice("phone-bbbbbbbb");
    assert.equal(S.listDevices().length, 1);

    const a = S.createNote({ text: "Oma komt zondag eten", color: "geel", memberId: member.id, pinned: false });
    const b = S.createNote({ text: "Vuilnis buiten!", color: "roze", memberId: null, pinned: true });
    let notes = S.listNotes();
    assert.equal(notes.length, 2);
    assert.equal(notes[0].id, b, "vastgeprikt staat bovenaan");
    assert.ok(S.updateNote(a, { pinned: true, color: "blauw" }));
    notes = S.listNotes();
    assert.equal(notes.find((n) => n.id === a)?.color, "blauw");
    assert.equal(notes.find((n) => n.id === a)?.memberId, member.id, "bewerken zonder memberId laat de auteur staan");
    assert.equal(S.updateNote("bestaat-niet", { text: "x" }), false);
    S.deleteNote(b);
    assert.equal(S.listNotes().length, 1);
  });
});
