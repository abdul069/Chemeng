/**
 * Gebedstijden: astronomische berekening (zoals PrayTimes), met verschillende rekenmethodes.
 * Alle tijden komen terug als UTC-tijdstempels; het scherm toont ze in zijn eigen tijdzone.
 */
export type Prayer = "fajr" | "sunrise" | "dhuhr" | "asr" | "maghrib" | "isha";
export const PRAYERS: Prayer[] = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];
export const PRAYER_LABEL: Record<Prayer, string> = { fajr: "Fajr (ochtend)", sunrise: "Zonsopgang", dhuhr: "Dhuhr (middag)", asr: "Asr (namiddag)", maghrib: "Maghrib (avond)", isha: "Isha (nacht)" };

export interface Method { id: string; label: string; fajr: number; isha: number | { min: number }; maghrib?: number; /** vaste minuten erbij per gebed (temkin) */ adjust?: Partial<Record<Prayer, number>> }
export const METHODS: Method[] = [
  { id: "diyanet", label: "Diyanet (Turkije)", fajr: 18, isha: 17, adjust: { fajr: -2, sunrise: -7, dhuhr: 6, asr: 4, maghrib: 7, isha: 2 } },
  { id: "mwl", label: "Muslim World League", fajr: 18, isha: 17 },
  { id: "isna", label: "ISNA (Noord-Amerika)", fajr: 15, isha: 15 },
  { id: "egypt", label: "Egyptische autoriteit", fajr: 19.5, isha: 17.5 },
  { id: "makkah", label: "Umm al-Qura (Mekka)", fajr: 18.5, isha: { min: 90 } },
  { id: "karachi", label: "Universiteit Karachi", fajr: 18, isha: 18 },
  { id: "uoif", label: "UOIF (Frankrijk, 12°)", fajr: 12, isha: 12 },
  { id: "kuwait", label: "Koeweit", fajr: 18, isha: 17.5 },
  { id: "singapore", label: "Singapore (MUIS)", fajr: 20, isha: 18 },
  { id: "tehran", label: "Teheran (Geofysica)", fajr: 17.7, isha: 14, maghrib: 4.5 },
  { id: "jafari", label: "Jafari (sjiitisch)", fajr: 16, isha: 14, maghrib: 4 },
];

const D2R = Math.PI / 180;
const sin = (d: number) => Math.sin(d * D2R), cos = (d: number) => Math.cos(d * D2R), tan = (d: number) => Math.tan(d * D2R);
const asin = (x: number) => Math.asin(x) / D2R, acos = (x: number) => Math.acos(Math.max(-1, Math.min(1, x))) / D2R, atan2 = (y: number, x: number) => Math.atan2(y, x) / D2R;
const acot = (x: number) => Math.atan(1 / x) / D2R;
const fixAngle = (a: number) => ((a % 360) + 360) % 360;
const fixHour = (h: number) => ((h % 24) + 24) % 24;

/** Juliaanse dag om 0u UTC. */
function julian(y: number, m: number, d: number) {
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}

function sunPosition(jd: number) {
  const D = jd - 2451545.0;
  const g = fixAngle(357.529 + 0.98560028 * D);
  const q = fixAngle(280.459 + 0.98564736 * D);
  const L = fixAngle(q + 1.915 * sin(g) + 0.020 * sin(2 * g));
  const e = 23.439 - 0.00000036 * D;
  const RA = fixHour(atan2(cos(e) * sin(L), cos(L)) / 15);
  return { declination: asin(sin(e) * sin(L)), equation: q / 15 - RA };
}

export interface PrayerInput { date: string; latitude: number; longitude: number; method?: string; asr?: "standard" | "hanafi"; adjust?: Partial<Record<Prayer, number>>; }

/** Geeft per gebed een UTC-tijdstempel (ms) voor de opgegeven kalenderdag (lokale datum, yyyy-mm-dd). */
export function prayerTimes(i: PrayerInput): Record<Prayer, number> {
  const method = METHODS.find((m) => m.id === i.method) ?? METHODS[0];
  const [y, mo, d] = i.date.split("-").map(Number);
  const jd = julian(y, mo, d) - i.longitude / (15 * 24);
  const lat = i.latitude;
  const midDay = (t: number) => fixHour(12 - sunPosition(jd + t).equation);
  const angleTime = (angle: number, t: number, ccw = false) => {
    const decl = sunPosition(jd + t).declination;
    const noon = midDay(t);
    const x = (-sin(angle) - sin(decl) * sin(lat)) / (cos(decl) * cos(lat));
    const tt = acos(x) / 15;
    return noon + (ccw ? -tt : tt);
  };
  const asrTime = (factor: number, t: number) => {
    const decl = sunPosition(jd + t).declination;
    const angle = -acot(factor + tan(Math.abs(lat - decl)));
    return angleTime(angle, t);
  };
  const rise = 0.833;
  // eerste schatting, dan verfijning
  let t: Record<Prayer, number> = { fajr: 5, sunrise: 6, dhuhr: 12, asr: 13, maghrib: 18, isha: 18 };
  for (let k = 0; k < 2; k++) {
    const sunset = angleTime(rise, t.maghrib / 24);
    t = {
      fajr: angleTime(method.fajr, t.fajr / 24, true),
      sunrise: angleTime(rise, t.sunrise / 24, true),
      dhuhr: midDay(t.dhuhr / 24),
      asr: asrTime(i.asr === "hanafi" ? 2 : 1, t.asr / 24),
      maghrib: method.maghrib ? angleTime(method.maghrib, t.maghrib / 24) : sunset,
      isha: typeof method.isha === "number" ? angleTime(method.isha, t.isha / 24) : sunset + method.isha.min / 60,
    };
  }
  // van lokale zonnetijd naar UTC
  const base = Date.UTC(y, mo - 1, d);
  const out = {} as Record<Prayer, number>;
  for (const p of PRAYERS) {
    const hoursUtc = t[p] - i.longitude / 15;
    const adj = (method.adjust?.[p] ?? 0) + (i.adjust?.[p] ?? 0);
    out[p] = base + Math.round((hoursUtc * 60 + adj) * 60) * 1000;
  }
  return out;
}
