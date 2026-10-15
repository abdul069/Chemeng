// Live-updates: elk scherm in huis krijgt meteen te horen wat er veranderde.
import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { checkCode } from "./auth.js";

export type Topic = "members" | "events" | "chores" | "meals" | "recipes" | "lists" | "photos" | "calendars" | "settings" | "rewards";

let wss: WebSocketServer | null = null;

export function attachRealtime(server: Server) {
  wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws, req) => {
    const code = new URL(req.url ?? "", "http://x").searchParams.get("code");
    if (!checkCode(code)) {
      ws.close(4401, "unauthorized");
      return;
    }
    ws.send(JSON.stringify({ type: "hello" }));
  });
  // houd verbindingen achter een proxy levend
  setInterval(() => wss?.clients.forEach((c) => c.readyState === WebSocket.OPEN && c.ping()), 30_000).unref();
}

export function broadcast(...topics: Topic[]) {
  const msg = JSON.stringify({ type: "changed", topics });
  wss?.clients.forEach((c) => c.readyState === WebSocket.OPEN && c.send(msg));
}
