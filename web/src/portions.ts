/** Hoeveelheden in ingrediëntregels omrekenen naar een ander aantal porties. */
const FRAC: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };
const NUM = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+[.,]\d+|\d+|[½¼¾⅓⅔⅛])(\s*[-–]\s*(\d+[.,]\d+|\d+))?/;

function parseNum(s: string): number {
  s = s.trim();
  if (FRAC[s] !== undefined) return FRAC[s];
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(s.replace(",", "."));
}
export function fmtNum(n: number): string {
  const whole = Math.floor(n + 1e-9); const rest = n - whole;
  const parts: [number, string][] = [[0.25, "¼"], [1 / 3, "⅓"], [0.5, "½"], [2 / 3, "⅔"], [0.75, "¾"]];
  const f = whole < 10 ? parts.find(([v]) => Math.abs(rest - v) < 0.04) : undefined; // breuken alleen bij kleine aantallen, niet bij grammen
  if (f) return `${whole || ""}${f[1]}`;
  if (whole >= 100) return String(Math.round(n));
  if (rest < 0.04) return String(whole);
  return String(Math.round(n * 10) / 10).replace(".", ",");
}
/** "2 su bardağı un" ×1,5 → "3 su bardağı un"; regels zonder getal vooraan blijven zoals ze zijn. */
export function scaleLine(line: string, factor: number): string {
  if (Math.abs(factor - 1) < 1e-6) return line;
  const m = line.match(NUM);
  if (!m) return line;
  const a = fmtNum(parseNum(m[1]) * factor);
  const b = m[3] ? `–${fmtNum(parseNum(m[3]) * factor)}` : "";
  return a + b + line.slice(m[0].length);
}
/** "4 kişilik", "6-8 personen", "Voor 4" → 4 */
export function parseServings(s: string): number | null {
  const m = s.match(/\d+/);
  const n = m ? Number(m[0]) : NaN;
  return n >= 1 && n <= 50 ? n : null;
}
