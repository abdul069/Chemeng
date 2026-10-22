/** Telegram-bot van het gezin: maak via @BotFather een bot, plak de token in de koppeling, en stuur de bot een foto van de
 *  schoolbrief, een kassaticket of gewoon "melk, brood, luiers". Alles komt in de gezinsinbox; de bot bevestigt. */
import { processMessage, type InboxItem } from "./inbox.js";
import { broadcastTo } from "./realtime.js";
import { L, type Lang } from "./i18n.js";
import { UA as USER_AGENT } from "./i18n.js";

export interface TgUpdate { update_id: number; message?: TgMessage }
export interface TgMessage { message_id: number; date: number; chat: { id: number; type: string; title?: string; first_name?: string }; from?: { first_name?: string; last_name?: string; username?: string }; text?: string; caption?: string; photo?: { file_id: string; file_size?: number }[]; document?: { file_id: string; mime_type?: string; file_size?: number } }
export type Send = (chatId: number, text: string) => Promise<void>;
export type GetFile = (fileId: string) => Promise<{ content: Buffer; contentType: string } | null>;

const api = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;
async function call(token: string, method: string, body?: Record<string, unknown>): Promise<unknown> {
  const r = await fetch(api(token, method), { method: body ? "POST" : "GET", headers: { "content-type": "application/json", "user-agent": USER_AGENT }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string };
  if (!r.ok || !j.ok) throw new Error(j.description || `Telegram antwoordde ${r.status}`);
  return j.result;
}
export async function botInfo(token: string): Promise<{ username: string; name: string }> { const r = (await call(token, "getMe")) as { username?: string; first_name?: string }; return { username: r.username ?? "", name: r.first_name ?? "" }; }
export const sendText = (token: string): Send => async (chatId, text) => { await call(token, "sendMessage", { chat_id: chatId, text }); };
export const fileFetcher = (token: string): GetFile => async (fileId) => {
  const f = (await call(token, "getFile", { file_id: fileId })) as { file_path?: string };
  if (!f.file_path) return null;
  const r = await fetch(`https://api.telegram.org/file/bot${token}/${f.file_path}`, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) return null;
  const ct = r.headers.get("content-type") || (f.file_path.endsWith(".png") ? "image/png" : "image/jpeg");
  return { content: Buffer.from(await r.arrayBuffer()), contentType: ct.split(";")[0] };
};

const who = (m: TgMessage) => [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || m.chat.title || m.from?.username || String(m.chat.id);
/** Updates verwerken, los van het netwerk zodat het testbaar is. Geeft de nieuwe offset en het aantal items terug. */
export async function handleUpdates(updates: TgUpdate[], h: string, lang: Lang, send: Send, getFile: GetFile): Promise<{ offset: number; items: number; chats: number[] }> {
  let offset = 0, items = 0; const chats = new Set<number>();
  for (const u of updates) {
    offset = Math.max(offset, u.update_id + 1);
    const m = u.message; if (!m) continue;
    chats.add(m.chat.id);
    const text = (m.text ?? m.caption ?? "").trim();
    if (/^\/start\b/.test(text)) {
      await send(m.chat.id, L(lang, { nl: "Hallo! Stuur me een foto van de schoolbrief of een kassaticket, of typ gewoon wat er op de lijst moet. Alles komt in de gezinsinbox van de app.", tr: "Merhaba! Bana okul mektubunun ya da fişin fotoğrafını gönder, ya da listeye ne gerekiyorsa yaz. Hepsi uygulamadaki aile gelen kutusuna düşer.", en: "Hi! Send me a photo of the school letter or a receipt, or just type what needs to go on the list. Everything lands in the family inbox of the app." }));
      continue;
    }
    const images: { content: Buffer; contentType: string }[] = [];
    const photo = m.photo?.length ? m.photo[m.photo.length - 1] : null;
    if (photo) { const f = await getFile(photo.file_id); if (f) images.push(f); }
    else if (m.document && /^image\//.test(m.document.mime_type ?? "") && (m.document.file_size ?? 0) < 8 * 1024 * 1024) { const f = await getFile(m.document.file_id); if (f) images.push(f); }
    if (!text && !images.length) continue;
    const item = await processMessage({ msgId: `tg:${m.chat.id}:${m.message_id}`, sender: `Telegram · ${who(m)}`, subject: text.slice(0, 80), date: new Date(m.date * 1000), text, images }, h);
    if (item) {
      items++;
      await send(m.chat.id, ack(item, lang));
    }
  }
  if (items) broadcastTo(h, ["inbox"]);
  return { offset, items, chats: [...chats] };
}
function ack(item: InboxItem, lang: Lang): string {
  const n = item.data.events?.length ?? 0; const li = item.data.listItems?.length ?? 0;
  if (item.kind === "receipt") return L(lang, { nl: `✅ Kassaticket gelezen: ${item.summary}. Kijk het na in de gezinsinbox.`, tr: `✅ Fiş okundu: ${item.summary}. Aile gelen kutusunda kontrol et.`, en: `✅ Receipt read: ${item.summary}. Review it in the family inbox.` });
  if (n || li) return L(lang, { nl: `✅ Gelezen: ${n ? `${n} afspra${n === 1 ? "ak" : "ken"}` : ""}${n && li ? " en " : ""}${li ? `${li} ${li === 1 ? "boodschap" : "boodschappen"}` : ""}. Eén tik in de gezinsinbox en het staat erin.`, tr: `✅ Okundu: ${n ? `${n} randevu` : ""}${n && li ? " ve " : ""}${li ? `${li} alışveriş` : ""}. Aile gelen kutusunda tek dokunuşla eklenir.`, en: `✅ Read: ${n ? `${n} appointment${n === 1 ? "" : "s"}` : ""}${n && li ? " and " : ""}${li ? `${li} list item${li === 1 ? "" : "s"}` : ""}. One tap in the family inbox and it's in.` });
  return L(lang, { nl: "✅ Ontvangen, staat in de gezinsinbox.", tr: "✅ Alındı, aile gelen kutusunda.", en: "✅ Received, it's in the family inbox." });
}
/** Nieuwe berichten ophalen (long polling zonder wachten) en verwerken. */
export async function poll(token: string, offset: number, h: string, lang: Lang) {
  const updates = (await call(token, "getUpdates", { offset: offset || undefined, timeout: 0, allowed_updates: ["message"], limit: 50 })) as TgUpdate[];
  return handleUpdates(updates, h, lang, sendText(token), fileFetcher(token));
}
