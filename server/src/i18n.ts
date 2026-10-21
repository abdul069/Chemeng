/** Talen op de server: wat de server zelf aan tekst maakt (briefings, meldingen, koppelingen) komt in de taal van het gezin. */
export type Lang = "nl" | "tr" | "en";
export const asLang = (v: unknown): Lang => (v === "tr" || v === "en" ? v : "nl");
/** Kies de tekst voor een taal; ontbreekt die, dan Engels, dan Nederlands. */
export const L = (lang: Lang, t: { nl: string; tr?: string; en?: string }): string => t[lang] ?? t.en ?? t.nl;
/** Merknaam: één instelling voor de hele server (BRAND_NAME). */
export const BRAND = process.env.BRAND_NAME || "Kinday";
export const UA = `${BRAND.replace(/\s+/g, "")}/2.0 (family hub)`;
