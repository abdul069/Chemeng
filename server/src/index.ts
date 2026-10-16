import "./env.js";
import express from "express";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { api } from "./routes.js";
import { attachRealtime, broadcastTo } from "./realtime.js";
import { syncAll } from "./ics.js";
import { assistantAvailable } from "./assistant.js";
import { startPushScheduler } from "./push.js";
import { startLibraryScheduler } from "./library.js";
import { createList } from "./store.js";
import { all } from "./db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
const WEB_DIR = path.resolve(process.env.WEB_DIR ?? path.join(here, "../../web/dist"));

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()");
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use("/api", api);

if (fs.existsSync(WEB_DIR)) {
  app.use(express.static(WEB_DIR, { index: false, maxAge: "1h" }));
  // alle andere routes horen bij de app zelf
  app.get(/^\/(?!api|ws).*/, (_req, res) => res.sendFile(path.join(WEB_DIR, "index.html")));
}

const server = http.createServer(app);
attachRealtime(server);

const SYNC_MIN = Number(process.env.CALENDAR_SYNC_MINUTES ?? 15);
const doSync = () => syncAll((h) => broadcastTo(h, ["calendars", "events"])).catch((e) => console.warn("[agenda]", e));
setTimeout(doSync, 5_000).unref();
setInterval(doSync, SYNC_MIN * 60_000).unref();
startPushScheduler();
startLibraryScheduler();
// bestaande gezinnen van vóór de voorraadlijst krijgen er alsnog een
for (const h of all<{ id: string }>("SELECT id FROM households WHERE id NOT IN (SELECT household_id FROM lists WHERE kind='pantry')")) createList("Voorraad", "🥫", h.id, "pantry");

server.listen(PORT, () => {
  console.log(`[gezinsbord] luistert op http://localhost:${PORT}`);
  if (!assistantAvailable()) console.log("[gezinsbord] Nog geen Claude API-sleutel: de assistent staat uit (in te vullen bij Instellingen → Assistent).");
});
