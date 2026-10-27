// Vertalen voor wie de gezinstaal niet (goed) spreekt: schoolbrieven uit de inbox, briefjes, de briefing.
// Met het lichte AI-model; zelfde tekst en taal komt uit de cache.
import crypto from "node:crypto";
import { db, get, run } from "./db.js";
import { getClient } from "./ai.js";
import { MODELS, aiAllowed, recordUsage } from "./billing.js";
import type { Lang } from "./i18n.js";

db.exec(`CREATE TABLE IF NOT EXISTS translations (key TEXT PRIMARY KEY, lang TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);

const NAMES: Record<Lang, string> = { nl: "Nederlands", tr: "Turks", en: "Engels" };
export class TranslateError extends Error {}

/** Vertaal een tekst naar de taal van de lezer; eenvoudige woorden, namen en uren blijven staan. */
export async function translate(text: string, lang: Lang): Promise<string> {
  const clean = text.trim().slice(0, 12000);
  if (!clean) return "";
  const key = crypto.createHash("sha256").update(`${lang}\u0000${clean}`).digest("hex");
  const hit = get<{ text: string }>("SELECT text FROM translations WHERE key=?", key);
  if (hit) return hit.text;
  const client = getClient();
  if (!client) throw new TranslateError("Vertalen kan pas als de assistent aanstaat (Instellingen → Assistent).");
  if (!aiAllowed("translate")) throw new TranslateError("Het AI-budget van deze maand is op; vertalen kan weer volgende maand.");
  const r = await client.messages.create({
    model: MODELS.light, max_tokens: 4000, output_config: { effort: "low" } as never,
    system: `Je vertaalt berichten voor een ouder die ${NAMES[lang]} spreekt. Vertaal naar eenvoudig, duidelijk ${NAMES[lang]}. Houd namen, data, uren, bedragen en adressen exact. Geef alleen de vertaling, zonder uitleg.`,
    messages: [{ role: "user", content: clean }],
  });
  recordUsage("translate", MODELS.light, r.usage);
  const out = r.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n").trim();
  if (!out) throw new TranslateError("De vertaling lukte niet; probeer het later opnieuw.");
  run("INSERT OR REPLACE INTO translations(key, lang, text) VALUES (?,?,?)", key, lang, out);
  return out;
}
