import { test } from "node:test";
import assert from "node:assert/strict";
import { withCtx } from "./db.ts";
import { createUser, createHousehold } from "./accounts.ts";
import * as S from "./store.ts";
import { encrypt, decrypt, parseFeed, catalog, createConnection, getConnection, updateConnection, publicConn, listConnections, connectorLinks, connectorWidgets, connectorBriefing, deleteConnection } from "./connectors.ts";

test("koppelingen: versleuteling, feedlezer, catalogus, opslag zonder geheimen, links en widgets", async () => {
  // versleuteling: rondreis en geen klare tekst in de opslag
  const enc = encrypt({ apiKey: "geheim-123", url: "https://x" });
  assert.ok(!enc.includes("geheim-123"));
  assert.deepEqual(decrypt(enc), { apiKey: "geheim-123", url: "https://x" });

  // RSS en Atom
  const rss = `<rss><channel><item><title><![CDATA[Code oranje &amp; storm]]></title><link>https://meteo.be/a</link><pubDate>Tue, 21 Oct 2025 06:00:00 GMT</pubDate><description><p>Veel wind</p></description></item></channel></rss>`;
  const atom = `<feed><entry><title>Kop</title><link href="https://vrt.be/k"/><updated>2025-10-21T06:00:00Z</updated><summary>Tekst</summary></entry></feed>`;
  const r = parseFeed(rss); const a = parseFeed(atom);
  assert.equal(r[0].title, "Code oranje & storm"); assert.equal(r[0].link, "https://meteo.be/a"); assert.equal(r[0].summary, "Veel wind"); assert.ok(r[0].date?.startsWith("2025-10-21"));
  assert.equal(a[0].link, "https://vrt.be/k"); assert.equal(a[0].title, "Kop");

  const userId = createUser({ name: "Test", email: `c${Date.now()}@x.be`, password: "geheim123" });
  const householdId = createHousehold(userId, "Testgezin");
  await withCtx({ userId, householdId }, async () => {
    const kid = S.createMember({ name: "Elif", color: "#f06292", avatar: "🧒", role: "kind" });
    const dad = S.createMember({ name: "Abdul", color: "#4a7bd8", avatar: "🧔", role: "ouder" });

    // catalogus: Belgische lijst, aanbevelingen, geen functies naar buiten
    const cat = catalog();
    assert.ok(cat.some((c) => c.id === "nmbs") && cat.some((c) => c.id === "stores"));
    assert.ok(cat.find((c) => c.id === "waste_ical")!.recommended);
    assert.ok(!("sync" in cat[0]));

    // "soon" kan niet aangezet worden; verplichte velden worden nagekeken
    assert.throws(() => createConnection({ connector: "delijn", config: {}, onBoard: false, enabled: true }), /volgende ronde/);
    assert.throws(() => createConnection({ connector: "nmbs", memberId: dad.id, config: { from: "Hasselt" }, onBoard: false, enabled: true }), /Aankomststation/);

    // winkels (gezin) en rit (per persoon), UiT met geheime sleutel
    const stores = createConnection({ connector: "stores", config: { stores: ["collectgo", "delhaize"] }, onBoard: false, enabled: true });
    const rides = createConnection({ connector: "rides", memberId: dad.id, config: { services: ["uber", "maps"] }, onBoard: false, enabled: true });
    const uit = createConnection({ connector: "uit", config: { postal: "3500", apiKey: "sleutel-xyz" }, onBoard: false, enabled: true });
    assert.equal(listConnections().length, 3);
    assert.ok(catalog().find((c) => c.id === "stores")!.connected);

    // geheimen gemaskeerd naar de browser; masker terugsturen laat het geheim staan
    const pub = publicConn(getConnection(uit)!);
    assert.equal(pub.config.apiKey, "••••••"); assert.equal(pub.config.postal, "3500");
    updateConnection(uit, { config: { postal: "3600", apiKey: "••••••" } });
    assert.deepEqual(getConnection(uit)!.config, { postal: "3600", apiKey: "sleutel-xyz" });

    // lijst-links: alleen gezinsbrede en eigen koppelingen tellen mee
    const listLinks = connectorLinks({ kind: "list", q: "melk, brood" }, null);
    assert.equal(listLinks.length, 2);
    assert.ok(listLinks[0].url.includes(encodeURIComponent("melk, brood")));
    assert.equal(connectorLinks({ kind: "event", address: "Grote Markt 1, Hasselt" }, kid.id).length, 0, "Elif heeft geen ritkoppeling");
    const ride = connectorLinks({ kind: "event", address: "Grote Markt 1, Hasselt" }, dad.id);
    assert.equal(ride.length, 2); assert.ok(ride[0].url.startsWith("https://m.uber.com/ul/"));
    assert.equal(connectorLinks({ kind: "event" }, dad.id).length, 0, "zonder adres geen rit");

    // widgets: folders op het bord; onzichtbaar voor een persoon zonder eigen koppeling blijft het gezinsbrede
    const board = connectorWidgets(null, true, "nl");
    assert.ok(board.some((w) => w.connector === "stores" && w.widget.lines.length === 2));
    // uitzetten → verdwijnt overal
    updateConnection(stores, { enabled: false });
    assert.ok(!connectorWidgets(null, true, "nl").some((w) => w.connector === "stores"));
    assert.equal(connectorLinks({ kind: "list", q: "x" }, null).length, 0);

    // briefing: zonder gesynchroniseerde staat geen regels, en nooit een fout naar buiten
    const b = connectorBriefing({ kind: "morning", date: new Date().toISOString().slice(0, 10), memberId: dad.id, lang: "nl" });
    assert.deepEqual(b.items, []);

    deleteConnection(rides);
    assert.equal(listConnections().length, 2);
  });
});
