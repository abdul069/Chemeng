// Slim importeren: een foto (schoolbrief, flyer, uitnodiging) of geplakte tekst wordt een lijst afspraken.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { listMembers } from "./store.js";
import { today, weekday } from "./dates.js";

const client = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? new Anthropic() : null;
const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
export const importAvailable = () => client !== null;

const DAYS = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];

export const Proposal = z.object({
  title: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  location: z.string(),
  notes: z.string(),
  members: z.array(z.string()).describe("Namen van gezinsleden waarvoor dit geldt; leeg = hele gezin"),
  repeat: z.enum(["none", "daily", "weekly", "biweekly", "monthly", "yearly"]),
  repeatUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});
export type ProposalT = z.infer<typeof Proposal>;
const Result = z.object({
  summary: z.string().describe("Eén zin over wat er gevonden is"),
  events: z.array(Proposal),
  listItems: z.array(z.string()).describe("Dingen die meegebracht of gekocht moeten worden (bv. 'turnpantoffels', 'cake voor de bakverkoop')"),
});
export type ImportResult = z.infer<typeof Result>;

export type ImageInput = { data: string; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" };

export async function extractEvents(input: { text?: string; image?: ImageInput; hint?: string }): Promise<ImportResult> {
  if (!client) throw new Error("De assistent is niet ingesteld (ANTHROPIC_API_KEY).");
  const t = today();
  const members = listMembers().map((m) => `${m.name} (${m.role})`).join(", ");
  const instructions = `Je leest documenten voor een gezinskalender: schoolbrieven, flyers, uitnodigingen, e-mails, lesroosters, sportkalenders.
Vandaag is ${DAYS[weekday(t)]} ${t}. Gezinsleden: ${members || "onbekend"}.
Haal alle afspraken met een datum eruit. Zet relatieve datums ("volgende vrijdag") om naar echte datums; datums zonder jaar vallen in de toekomst, zo dicht mogelijk bij vandaag. Een afspraak zonder uur is een hele dag. Herhaalt iets elke week (bv. een lesrooster), gebruik dan repeat "weekly" met de einddatum als die er staat.
Zet bij members de gezinsleden die het aangaat (bv. het kind van die klas, of de ouder die moet meegaan); laat het leeg als het het hele gezin betreft of je het niet weet. Zet praktische info (meebrengen, kostprijs, lokaal) in notes. Verzin niets dat niet in het document staat.
${input.hint ? `Extra aanwijzing van de gebruiker: ${input.hint}` : ""}`;
  const content: Anthropic.ContentBlockParam[] = [];
  if (input.image) content.push({ type: "image", source: { type: "base64", media_type: input.image.mediaType, data: input.image.data } });
  content.push({ type: "text", text: input.text ? `Document:\n${input.text}` : "Lees het document op de foto." });
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: "medium", format: zodOutputFormat(Result) },
    system: instructions,
    messages: [{ role: "user", content }],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) return { summary: "Ik kon hier geen afspraken uit halen.", events: [], listItems: [] };
  return res.parsed_output;
}

/** Eén zin zoals "zwemles di 17u Lina" wordt een afspraak. */
export async function parseQuickAdd(text: string): Promise<ProposalT | null> {
  const r = await extractEvents({ text, hint: "Dit is een korte, snel getypte zin van de gebruiker; maak er precies één afspraak van. Zonder duur: één uur." });
  return r.events[0] ?? null;
}
