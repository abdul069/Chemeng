// Datumhulpjes op basis van 'YYYY-MM-DD'-tekst, onafhankelijk van tijdzones.
const DAY = 86_400_000;

export const toUtc = (d: string) => {
  const [y, m, dd] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, dd);
};
export const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => fromUtc(toUtc(d) + n * DAY);
export const diffDays = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / DAY);
export const weekday = (d: string) => new Date(toUtc(d)).getUTCDay();
export const isDate = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
export const isTime = (t: unknown): t is string => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

export function addMonths(d: string, n: number): string | null {
  const [y, m, dd] = d.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, dd));
  // 31 januari + 1 maand bestaat niet: die maand slaan we over
  if (target.getUTCDate() !== dd) return null;
  return fromUtc(target.getTime());
}

/** Lokale datum van de server als 'YYYY-MM-DD' (in de tijdzone van TZ). */
export function today(tz = process.env.TZ): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return parts;
}
