// Live-updates: elk scherm van het gezin (en wie meekijkt in een gedeelde agenda) hoort meteen wat er veranderde.
import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { sessionFromCookie } from "./auth.js";
import { viewersOfHousehold } from "./accounts.js";
import { hid } from "./db.js";
import { linkedHouseholdIds } from "./family.js";

export type Topic = "members" | "events" | "chores" | "meals" | "recipes" | "lists" | "photos" | "calendars" | "settings" | "rewards" | "access" | "sharing" | "memos" | "ezan" | "diet" | "devices" | "notes" | "family" | "home" | "connections" | "prices";

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
  // verbonden gezinnen zien onze agenda, foto's en briefjes op hun Bord
  if (topics.some((t) => t === "events" || t === "photos" || t === "notes" || t === "members")) {
    const linked = new Set(linkedHouseholdIds(householdId));
    if (linked.size) send((s) => !!s.householdId && linked.has(s.householdId), ["family"]);
  }
  if (topics.includes("events") || topics.includes("members")) {
    const viewers = new Set(viewersOfHousehold(householdId));
    if (viewers.size) send((s) => viewers.has(s.userId) && s.householdId !== householdId, ["events", "sharing"]);
  }
}

/** Een gericht bericht aan het gezin, bv. "toon dit recept op het keukenscherm". Elk toestel kijkt zelf of het voor hem is. */
export function castTo(householdId: string, cast: { to: string | null; kind: string; value: string; from: string | null }) {
  const msg = JSON.stringify({ type: "cast", ...cast });
  sockets.forEach((s, c) => { if (c.readyState === WebSocket.OPEN && s.householdId === householdId) c.send(msg); });
}

/** Meldt een wijziging aan het gezin van het huidige verzoek. */
export const broadcast = (...topics: Topic[]) => broadcastTo(hid(), topics);

export const notifyUsers = (userIds: string[], topics: Topic[]) => {
  const set = new Set(userIds);
  send((s) => set.has(s.userId), topics);
};
