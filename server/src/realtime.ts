// Live-updates: elk scherm van het gezin (en wie meekijkt in een gedeelde agenda) hoort meteen wat er veranderde.
import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { sessionFromCookie } from "./auth.js";
import { viewersOfHousehold } from "./accounts.js";
import { hid } from "./db.js";

export type Topic = "members" | "events" | "chores" | "meals" | "recipes" | "lists" | "photos" | "calendars" | "settings" | "rewards" | "access" | "sharing";

const sockets = new Map<WebSocket, { userId: string; householdId: string | null }>();

export function attachRealtime(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws, req) => {
    const s = sessionFromCookie(req.headers.cookie);
    if (!s) {
      ws.close(4401, "unauthorized");
      return;
    }
    sockets.set(ws, { userId: s.user.id, householdId: s.householdId });
    ws.on("close", () => sockets.delete(ws));
    ws.send(JSON.stringify({ type: "hello" }));
  });
  // houd verbindingen achter een proxy levend
  setInterval(() => sockets.forEach((_, c) => c.readyState === WebSocket.OPEN && c.ping()), 30_000).unref();
}

function send(filter: (s: { userId: string; householdId: string | null }) => boolean, topics: Topic[]) {
  const msg = JSON.stringify({ type: "changed", topics });
  sockets.forEach((s, c) => { if (c.readyState === WebSocket.OPEN && filter(s)) c.send(msg); });
}

export function broadcastTo(householdId: string, topics: Topic[]) {
  send((s) => s.householdId === householdId, topics);
  if (topics.includes("events") || topics.includes("members")) {
    const viewers = new Set(viewersOfHousehold(householdId));
    if (viewers.size) send((s) => viewers.has(s.userId) && s.householdId !== householdId, ["events", "sharing"]);
  }
}

/** Meldt een wijziging aan het gezin van het huidige verzoek. */
export const broadcast = (...topics: Topic[]) => broadcastTo(hid(), topics);

export const notifyUsers = (userIds: string[], topics: Topic[]) => {
  const set = new Set(userIds);
  send((s) => set.has(s.userId), topics);
};
