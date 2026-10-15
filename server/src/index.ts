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

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
const WEB_DIR = path.resolve(process.env.WEB_DIR ?? path.join(here, "../../web/dist"));

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
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

server.listen(PORT, () => {
  console.log(`[gezinsbord] luistert op http://localhost:${PORT}`);
  if (!assistantAvailable()) console.log("[gezinsbord] Geen ANTHROPIC_API_KEY: de assistent staat uit.");
});
