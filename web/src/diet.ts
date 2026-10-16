import type { Member } from "./types";

/** Woorden die het gezin vermijdt (allergieën/voorkeuren uit de profielen) en welke ervan in een tekst voorkomen, als heel woord. */
export const avoidWords = (members: Member[]) => [...new Set(members.flatMap((m) => (m.diet ?? "").split(/[,;]/).map((w) => w.trim().toLocaleLowerCase("tr")).filter((w) => w.length > 1)))];
const wordRe = (w: string) => new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[^\\p{L}]|$)`, "iu");
export const dietHits = (text: string, words: string[]) => { const t = text.toLocaleLowerCase("tr"); return words.filter((w) => wordRe(w).test(t)); };
