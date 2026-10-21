import { test } from "node:test";
import assert from "node:assert/strict";
import { withCtx } from "./db.ts";
import { createUser, createHousehold, createInvite, describeInvite, acceptInvite } from "./accounts.ts";
import { createEvent } from "./events.ts";
import * as S from "./store.ts";
import * as F from "./family.ts";

const iso = (d: Date) => d.toISOString().slice(0, 10);

test("gezinsnetwerk: verbinden via uitnodiging, delen kiezen, feed en briefje naar het andere huis", () => {
  const u1 = createUser({ name: "Abdul", email: `f1${Date.now()}@x.be`, password: "geheim123" });
  const h1 = createHousehold(u1, "Gezin Abdul");
  const u2 = createUser({ name: "Oma", email: `f2${Date.now()}@x.be`, password: "geheim123" });
  const h2 = createHousehold(u2, "Oma Fatma");
  // Abdul maakt een verbindingsuitnodiging; Oma aanvaardt ze vanuit haar eigen gezin
  const { token } = createInvite(u1, h1, { kind: "link", label: "" });
  const d = describeInvite(token);
  assert.ok(d.valid && d.kind === "link" && d.household === "Gezin Abdul");
  assert.throws(() => acceptInvite(token, u1, h1), /eigen gezin|eigen uitnodiging/);
  const r = acceptInvite(token, u2, h2);
  assert.equal(r.kind, "link"); assert.equal(r.linked, h1);
  withCtx({ userId: u2, householdId: h2 }, () => {
    const links = F.listLinks();
    assert.equal(links.length, 1); assert.equal(links[0].otherName, "Gezin Abdul");
    assert.deepEqual(links[0].myShare, ["events", "photos", "notes", "birthdays"]);
    // Oma zet een afspraak en deelt alleen agenda en verjaardagen
    createEvent({ title: "Dokter", date: iso(new Date(Date.now() + 2 * 864e5)), endDate: null, startTime: "10:00", endTime: "11:00", allDay: false, repeat: "none", repeatUntil: null, exdates: [], members: [], location: "", notes: "", countdown: false } as never);
    assert.ok(F.setMyShare(links[0].id, ["events", "birthdays"]));
    S.createNote({ text: "Prive briefje van oma", color: "geel", memberId: null, pinned: false });
  });
  withCtx({ userId: u1, householdId: h1 }, () => {
    const feed = F.familyFeed();
    assert.equal(feed.length, 1);
    assert.equal(feed[0].name, "Oma Fatma");
    assert.ok(feed[0].events.some((e) => e.title === "Dokter"), "Oma's afspraak staat in de feed");
    assert.equal(feed[0].notes.length, 0, "prikbord wordt niet gedeeld");
    assert.deepEqual(feed[0].shares, ["events", "birthdays"]);
    // Abdul stuurt een briefje naar oma
    const other = F.sendFamilyNote(feed[0].linkId, { text: "Zondag komen we eten!", color: "roze", author: "Abdul" });
    assert.equal(other, h2);
  });
  withCtx({ userId: u2, householdId: h2 }, () => {
    const notes = S.listNotes();
    assert.ok(notes.some((n) => n.text === "Zondag komen we eten!"), "het briefje hangt op oma's prikbord");
    // verbinding verbreken
    F.deleteLink(F.listLinks()[0].id);
    assert.equal(F.listLinks().length, 0);
  });
  withCtx({ userId: u1, householdId: h1 }, () => { assert.equal(F.familyFeed().length, 0); });
});
