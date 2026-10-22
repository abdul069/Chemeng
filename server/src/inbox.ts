/** De gezinsinbox: een e-mailadres voor het gezin. Stuur de schoolbrief, de dokter, de keuringsbrief of een kassaticket door
 *  en Kinday haalt er afspraken, boodschappen en prijzen uit. Twee opstellingen:
 *  - gedeelde mailbox van de operator (INBOX_IMAP_*): elk gezin krijgt een plus-adres, bv. inbox+k7f3a2@kinday.be;
 *  - eigen mailbox van het gezin: IMAP-gegevens in de koppeling. */
import { z } from "zod";
import crypto from "node:crypto";
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { db, all, get, run, newId, hid, withCtx } from "./db.js";
import { extractEvents, importAvailable, type ImportResult } from "./importer.js";
import { scanImage, type ScanResult } from "./prices.js";
import { broadcastTo } from "./realtime.js";

db.exec(`
CREATE TABLE IF NOT EXISTS inbox_items (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  msg_id TEXT NOT NULL, sender TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '', received_at TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other', summary TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', data TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(household_id, msg_id)
);
`);

export type Kind = "school" | "receipt" | "other";
export interface InboxItem { id: string; msgId: string; sender: string; subject: string; receivedAt: string; kind: Kind; summary: string; body: string; data: { events?: ImportResult["events"]; listItems?: string[]; scan?: ScanResult; images?: number }; status: "new" | "done" | "dismissed"; createdAt: string }
type Row = { id: string; msg_id: string; sender: string; subject: string; received_at: string; kind: Kind; summary: string; body: string; data: string; status: InboxItem["status"]; created_at: string };
const shape = (r: Row): InboxItem => { let data = {}; try { data = JSON.parse(r.data); } catch { /* */ } return { id: r.id, msgId: r.msg_id, sender: r.sender, subject: r.subject, receivedAt: r.received_at, kind: r.kind, summary: r.summary, body: r.body, data, status: r.status, createdAt: r.created_at }; };

export const listItems = (h = hid(), status?: InboxItem["status"]) => all<Row>(`SELECT * FROM inbox_items WHERE household_id=? ${status ? "AND status=?" : ""} ORDER BY received_at DESC LIMIT 200`, h, ...(status ? [status] : [])).map(shape);
export const getItem = (id: string, h = hid()) => { const r = get<Row>("SELECT * FROM inbox_items WHERE id=? AND household_id=?", id, h); return r ? shape(r) : null; };
export const setStatus = (id: string, status: InboxItem["status"], h = hid()) => run("UPDATE inbox_items SET status=? WHERE id=? AND household_id=?", status, id, h);
export const deleteItem = (id: string, h = hid()) => run("DELETE FROM inbox_items WHERE id=? AND household_id=?", id, h);
export const newCount = (h = hid()) => get<{ n: number }>("SELECT COUNT(*) AS n FROM inbox_items WHERE household_id=? AND status='new'", h)?.n ?? 0;

// ---------- gedeelde mailbox van de operator ----------
export const shared = () => (process.env.INBOX_IMAP_HOST && process.env.INBOX_IMAP_USER && process.env.INBOX_IMAP_PASS ? { host: process.env.INBOX_IMAP_HOST, port: Number(process.env.INBOX_IMAP_PORT || 993), user: process.env.INBOX_IMAP_USER, pass: process.env.INBOX_IMAP_PASS, address: process.env.INBOX_ADDRESS || process.env.INBOX_IMAP_USER } : null);
/** Korte, stabiele code per gezin voor het plus-adres (inbox+code@…). */
export const householdTag = (h: string) => crypto.createHash("sha256").update(`inbox:${h}`).digest("base64url").replace(/[^a-z0-9]/gi, "").slice(0, 7).toLowerCase();
export function plusAddress(h: string): string | null { const s = shared(); if (!s) return null; const [u, d] = s.address.split("@"); return d ? `${u}+${householdTag(h)}@${d}` : null; }

// ---------- één bericht verwerken ----------
const RECEIPT_RE = /\b(kassaticket|kassabon|ticket|bon|receipt|aankoopbewijs|fiş|fis|kasa fişi)\b/i;
const isImage = (ct: string) => /^image\/(jpeg|png|gif|webp)$/.test(ct);
const addrText = (a: ParsedMail["to"]) => (Array.isArray(a) ? a.map((x) => x.text).join(", ") : a?.text ?? "");
/** Van een geparsede mail een inbox-item maken: kassaticket → prijzen; anders afspraken en lijstjes. Zonder AI blijft de tekst leesbaar. */
export async function processMail(mail: ParsedMail, h: string): Promise<InboxItem | null> {
  const msgId = mail.messageId || `${mail.date?.toISOString() ?? Date.now()}-${crypto.createHash("md5").update(mail.subject ?? "").digest("hex").slice(0, 8)}`;
  if (get("SELECT 1 FROM inbox_items WHERE household_id=? AND msg_id=?", h, msgId)) return null;
  const sender = addrText(mail.from); const subject = mail.subject ?? ""; const received = (mail.date ?? new Date()).toISOString();
  const text = (mail.text || (typeof mail.html === "string" ? mail.html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ") : "")).replace(/\s+/g, " ").trim().slice(0, 20000);
  const images = (mail.attachments ?? []).filter((a) => isImage(a.contentType) && a.content.length < 8 * 1024 * 1024).slice(0, 3);
  let kind: Kind = "other"; let summary = ""; const data: InboxItem["data"] = { images: images.length };
  const ai = importAvailable();
  try {
    if (ai && images.length && RECEIPT_RE.test(`${subject} ${text.slice(0, 300)}`)) {
      const scan = await scanImage({ data: images[0].content.toString("base64"), mediaType: images[0].contentType as "image/jpeg" }, "ticket");
      kind = "receipt"; data.scan = scan; summary = `${scan.store || "?"} · ${scan.items.length} ${scan.items.length === 1 ? "regel" : "regels"}${scan.total !== null ? ` · €${scan.total.toFixed(2).replace(".", ",")}` : ""}`;
    } else if (ai && (text.length > 20 || images.length)) {
      const r = await extractEvents({ text: text || undefined, image: images[0] ? { data: images[0].content.toString("base64"), mediaType: images[0].contentType as "image/jpeg" } : undefined, hint: `E-mail van ${sender}, onderwerp "${subject}".` });
      summary = r.summary; data.events = r.events; data.listItems = r.listItems;
      kind = r.events.length ? "school" : "other";
    } else summary = text.slice(0, 160);
  } catch (e) { summary = `${text.slice(0, 120)} (${e instanceof Error ? e.message : "lezen mislukte"})`; }
  const id = newId();
  run("INSERT INTO inbox_items(id, household_id, msg_id, sender, subject, received_at, kind, summary, body, data) VALUES (?,?,?,?,?,?,?,?,?,?)", id, h, msgId, sender.slice(0, 200), subject.slice(0, 300), received, kind, summary.slice(0, 500), text.slice(0, 4000), JSON.stringify(data));
  return getItem(id, h);
}
export const parseRaw = (raw: Buffer | string) => simpleParser(raw);

// ---------- ophalen via IMAP ----------
export interface ImapConfig { host: string; port: number; user: string; pass: string; folder?: string; /** alleen mails aan dit plus-adres (gedeelde mailbox) */ tag?: string }
export async function fetchNew(cfg: ImapConfig, h: string): Promise<{ fetched: number; items: number }> {
  const client = new ImapFlow({ host: cfg.host, port: cfg.port, secure: cfg.port === 993, auth: { user: cfg.user, pass: cfg.pass }, logger: false });
  let fetched = 0, items = 0;
  await client.connect();
  try {
    const lock = await client.getMailboxLock(cfg.folder || "INBOX");
    try {
      const query: Record<string, unknown> = { seen: false };
      if (cfg.tag) query.or = [{ to: cfg.tag }, { header: { "delivered-to": cfg.tag } }];
      const uids = (await client.search(query, { uid: true })) || [];
      for (const uid of uids.slice(0, 25)) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        fetched++;
        const mail = await simpleParser(msg.source);
        if (cfg.tag && !`${addrText(mail.to)} ${String(mail.headers.get("delivered-to") ?? "")}`.toLowerCase().includes(cfg.tag.toLowerCase())) continue;
        const item = await withCtx({ userId: "", householdId: h } as never, () => processMail(mail, h));
        if (item) items++;
        await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      }
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => {}); }
  if (items) broadcastTo(h, ["inbox"]);
  return { fetched, items };
}

export const ApplyInput = z.object({ events: z.boolean().default(true), listItems: z.boolean().default(true), toPantry: z.boolean().default(true) });
