// Feestdagen: Belgische wettelijke feestdagen (berekend) en de islamitische feestdagen (vaste lijst, want maankalender).
import type { Occurrence } from "./events.js";
import { addDays } from "./dates.js";

/** Paaszondag (Gregoriaans, algoritme van Meeus/Jones/Butcher). */
export function easter(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export type HolidayKind = "be" | "nl" | "uk" | "de" | "fr" | "tr" | "ma" | "islam" | "sinterklaas";
export const HOLIDAY_KINDS: HolidayKind[] = ["be", "nl", "uk", "de", "fr", "tr", "ma", "islam", "sinterklaas"];
export const isHolidayKind = (k: string): k is HolidayKind => (HOLIDAY_KINDS as string[]).includes(k);
export interface Holiday { date: string; endDate?: string; title: string; icon: string; kind: HolidayKind }

export function belgianHolidays(year: number): Holiday[] {
  const p = easter(year); const y = String(year);
  return [
    { date: `${y}-01-01`, title: "Nieuwjaar", icon: "🎆", kind: "be" },
    { date: addDays(p, 1), title: "Paasmaandag", icon: "🐣", kind: "be" },
    { date: `${y}-05-01`, title: "Dag van de Arbeid", icon: "🛠️", kind: "be" },
    { date: addDays(p, 39), title: "O.L.H. Hemelvaart", icon: "⛪", kind: "be" },
    { date: addDays(p, 50), title: "Pinkstermaandag", icon: "🕊️", kind: "be" },
    { date: `${y}-07-11`, title: "Feest van de Vlaamse Gemeenschap", icon: "🦁", kind: "be" },
    { date: `${y}-07-21`, title: "Nationale feestdag", icon: "🇧🇪", kind: "be" },
    { date: `${y}-08-15`, title: "O.L.V. Hemelvaart", icon: "⛪", kind: "be" },
    { date: `${y}-11-01`, title: "Allerheiligen", icon: "🕯️", kind: "be" },
    { date: `${y}-11-11`, title: "Wapenstilstand", icon: "🌹", kind: "be" },
    { date: `${y}-12-25`, title: "Kerstmis", icon: "🎄", kind: "be" },
  ];
}

export function dutchHolidays(year: number): Holiday[] {
  const p = easter(year); const y = String(year);
  const kd = `${y}-04-27`; const koningsdag = new Date(kd + "T12:00:00").getDay() === 0 ? `${y}-04-26` : kd; // op zondag: de zaterdag ervoor
  return [
    { date: `${y}-01-01`, title: "Nieuwjaarsdag", icon: "🎆", kind: "nl" },
    { date: addDays(p, -2), title: "Goede Vrijdag", icon: "✝️", kind: "nl" },
    { date: p, endDate: addDays(p, 1), title: "Pasen", icon: "🐣", kind: "nl" },
    { date: koningsdag, title: "Koningsdag", icon: "🧡", kind: "nl" },
    { date: `${y}-05-05`, title: "Bevrijdingsdag", icon: "🕊️", kind: "nl" },
    { date: addDays(p, 39), title: "Hemelvaartsdag", icon: "⛪", kind: "nl" },
    { date: addDays(p, 49), endDate: addDays(p, 50), title: "Pinksteren", icon: "🕊️", kind: "nl" },
    { date: `${y}-12-25`, endDate: `${y}-12-26`, title: "Kerstmis", icon: "🎄", kind: "nl" },
  ];
}
/** Tradities van het eindejaar, voor wie dat viert: Sinterklaas, advent, Kerst en oudejaar. */
/** Vaste datum die in het weekend valt, schuift naar de maandag erna (Britse "substitute day"). */
const substitute = (d: string): string => { const w = new Date(d + "T12:00:00Z").getUTCDay(); return w === 6 ? addDays(d, 2) : w === 0 ? addDays(d, 1) : d; };
const nthMonday = (y: number, m: number, n: number): string => { const first = new Date(Date.UTC(y, m - 1, 1)); const off = (8 - first.getUTCDay()) % 7; return addDays(`${y}-${String(m).padStart(2, "0")}-01`, off + (n - 1) * 7); };
const lastMonday = (y: number, m: number): string => { const d = new Date(Date.UTC(y, m, 0)); return addDays(d.toISOString().slice(0, 10), -((d.getUTCDay() + 6) % 7)); };
/** Engeland en Wales (bank holidays). */
export function ukHolidays(year: number): Holiday[] {
  const y = year, p = easter(y);
  const xmas = substitute(`${y}-12-25`); const boxing = substitute(`${y}-12-26`) === xmas ? addDays(xmas, 1) : substitute(`${y}-12-26`);
  return [
    { date: substitute(`${y}-01-01`), title: "New Year's Day", icon: "🎆", kind: "uk" },
    { date: addDays(p, -2), title: "Good Friday", icon: "✝️", kind: "uk" },
    { date: addDays(p, 1), title: "Easter Monday", icon: "🐣", kind: "uk" },
    { date: nthMonday(y, 5, 1), title: "Early May bank holiday", icon: "🌼", kind: "uk" },
    { date: lastMonday(y, 5), title: "Spring bank holiday", icon: "🌳", kind: "uk" },
    { date: lastMonday(y, 8), title: "Summer bank holiday", icon: "☀️", kind: "uk" },
    { date: xmas, title: "Christmas Day", icon: "🎄", kind: "uk" },
    { date: boxing, title: "Boxing Day", icon: "🎁", kind: "uk" },
  ];
}
/** Duitsland, landelijke feestdagen. */
export function germanHolidays(year: number): Holiday[] {
  const y = year, p = easter(y);
  return [
    { date: `${y}-01-01`, title: "Neujahr", icon: "🎆", kind: "de" },
    { date: addDays(p, -2), title: "Karfreitag", icon: "✝️", kind: "de" },
    { date: addDays(p, 1), title: "Ostermontag", icon: "🐣", kind: "de" },
    { date: `${y}-05-01`, title: "Tag der Arbeit", icon: "🛠️", kind: "de" },
    { date: addDays(p, 39), title: "Christi Himmelfahrt", icon: "⛪", kind: "de" },
    { date: addDays(p, 50), title: "Pfingstmontag", icon: "🕊️", kind: "de" },
    { date: `${y}-10-03`, title: "Tag der Deutschen Einheit", icon: "🇩🇪", kind: "de" },
    { date: `${y}-12-25`, endDate: `${y}-12-26`, title: "Weihnachten", icon: "🎄", kind: "de" },
  ];
}
/** Frankrijk. */
export function frenchHolidays(year: number): Holiday[] {
  const y = year, p = easter(y);
  return [
    { date: `${y}-01-01`, title: "Jour de l'an", icon: "🎆", kind: "fr" },
    { date: addDays(p, 1), title: "Lundi de Pâques", icon: "🐣", kind: "fr" },
    { date: `${y}-05-01`, title: "Fête du Travail", icon: "🛠️", kind: "fr" },
    { date: `${y}-05-08`, title: "Victoire 1945", icon: "🕊️", kind: "fr" },
    { date: addDays(p, 39), title: "Ascension", icon: "⛪", kind: "fr" },
    { date: addDays(p, 50), title: "Lundi de Pentecôte", icon: "🕊️", kind: "fr" },
    { date: `${y}-07-14`, title: "Fête nationale", icon: "🇫🇷", kind: "fr" },
    { date: `${y}-08-15`, title: "Assomption", icon: "⛪", kind: "fr" },
    { date: `${y}-11-01`, title: "Toussaint", icon: "🕯️", kind: "fr" },
    { date: `${y}-11-11`, title: "Armistice 1918", icon: "🌹", kind: "fr" },
    { date: `${y}-12-25`, title: "Noël", icon: "🎄", kind: "fr" },
  ];
}
/** Turkije, nationale feestdagen (de religieuze staan in het pakket islam). */
export function turkishHolidays(year: number): Holiday[] {
  const y = year;
  return [
    { date: `${y}-01-01`, title: "Yılbaşı", icon: "🎆", kind: "tr" },
    { date: `${y}-04-23`, title: "23 Nisan Ulusal Egemenlik ve Çocuk Bayramı", icon: "🎈", kind: "tr" },
    { date: `${y}-05-01`, title: "1 Mayıs Emek ve Dayanışma Günü", icon: "🛠️", kind: "tr" },
    { date: `${y}-05-19`, title: "19 Mayıs Atatürk'ü Anma, Gençlik ve Spor Bayramı", icon: "🏃", kind: "tr" },
    { date: `${y}-07-15`, title: "15 Temmuz Demokrasi ve Millî Birlik Günü", icon: "🇹🇷", kind: "tr" },
    { date: `${y}-08-30`, title: "30 Ağustos Zafer Bayramı", icon: "🎖️", kind: "tr" },
    { date: `${y}-10-29`, title: "29 Ekim Cumhuriyet Bayramı", icon: "🇹🇷", kind: "tr" },
  ];
}
/** Marokko, nationale feestdagen (de religieuze staan in het pakket islam). */
export function moroccanHolidays(year: number): Holiday[] {
  const y = year;
  return [
    { date: `${y}-01-01`, title: "Nieuwjaar (Marokko)", icon: "🎆", kind: "ma" },
    { date: `${y}-01-11`, title: "Manifest van de Onafhankelijkheid", icon: "📜", kind: "ma" },
    { date: `${y}-01-14`, title: "Amazigh Nieuwjaar (Yennayer)", icon: "ⵣ", kind: "ma" },
    { date: `${y}-05-01`, title: "Dag van de Arbeid (Marokko)", icon: "🛠️", kind: "ma" },
    { date: `${y}-07-30`, title: "Troonfeest", icon: "👑", kind: "ma" },
    { date: `${y}-08-14`, title: "Oued Ed-Dahab", icon: "🇲🇦", kind: "ma" },
    { date: `${y}-08-20`, title: "Revolutie van Koning en Volk", icon: "🇲🇦", kind: "ma" },
    { date: `${y}-08-21`, title: "Jeugdfeest", icon: "🎈", kind: "ma" },
    { date: `${y}-11-06`, title: "Groene Mars", icon: "🟢", kind: "ma" },
    { date: `${y}-11-18`, title: "Onafhankelijkheidsdag", icon: "🇲🇦", kind: "ma" },
  ];
}
export function sinterklaasKerst(year: number, country: string): Holiday[] {
  const y = String(year);
  return [
    { date: country === "NL" ? `${y}-12-05` : `${y}-12-06`, title: country === "NL" ? "Pakjesavond (Sinterklaas)" : "Sinterklaas", icon: "🎁", kind: "sinterklaas" },
    { date: `${y}-12-01`, endDate: `${y}-12-24`, title: "Advent", icon: "🕯️", kind: "sinterklaas" },
    { date: `${y}-12-24`, title: "Kerstavond", icon: "🌟", kind: "sinterklaas" },
    { date: `${y}-12-25`, title: "Kerstmis", icon: "🎄", kind: "sinterklaas" },
    { date: `${y}-12-31`, title: "Oudejaarsavond", icon: "🎇", kind: "sinterklaas" },
  ];
}
/** Islamitische feestdagen (Diyanet-kalender). Het eerste jaar is zeker; latere jaren kunnen één dag verschuiven. */
const ISLAMIC: Holiday[] = [
  { date: "2026-02-18", title: "Begin van de Ramadan", icon: "🌙", kind: "islam" },
  { date: "2026-03-20", endDate: "2026-03-22", title: "Ramazan Bayramı (Suikerfeest)", icon: "🍬", kind: "islam" },
  { date: "2026-05-27", endDate: "2026-05-30", title: "Kurban Bayramı (Offerfeest)", icon: "🐑", kind: "islam" },
  { date: "2027-02-08", title: "Begin van de Ramadan (±1 dag)", icon: "🌙", kind: "islam" },
  { date: "2027-03-09", endDate: "2027-03-11", title: "Ramazan Bayramı (Suikerfeest, ±1 dag)", icon: "🍬", kind: "islam" },
  { date: "2027-05-16", endDate: "2027-05-19", title: "Kurban Bayramı (Offerfeest, ±1 dag)", icon: "🐑", kind: "islam" },
  { date: "2028-01-28", title: "Begin van de Ramadan (±1 dag)", icon: "🌙", kind: "islam" },
  { date: "2028-02-26", endDate: "2028-02-28", title: "Ramazan Bayramı (Suikerfeest, ±1 dag)", icon: "🍬", kind: "islam" },
  { date: "2028-05-05", endDate: "2028-05-08", title: "Kurban Bayramı (Offerfeest, ±1 dag)", icon: "🐑", kind: "islam" },
];

const TR_TITLES: Record<string, string> = {
  "Nieuwjaarsdag": "Yılbaşı", "Goede Vrijdag": "Kutsal Cuma", "Pasen": "Paskalya", "Koningsdag": "Kral Günü", "Bevrijdingsdag": "Kurtuluş Günü", "Hemelvaartsdag": "İsa'nın Göğe Yükselişi", "Pinksteren": "Pentekost",
  "Sinterklaas": "Sinterklaas", "Pakjesavond (Sinterklaas)": "Hediye akşamı (Sinterklaas)", "Advent": "Advent", "Kerstavond": "Noel arifesi", "Oudejaarsavond": "Yılbaşı gecesi",
  "Nieuwjaar": "Yılbaşı", "Paasmaandag": "Paskalya Pazartesisi", "Dag van de Arbeid": "İşçi Bayramı", "O.L.H. Hemelvaart": "İsa'nın Göğe Yükselişi", "Pinkstermaandag": "Pentekost Pazartesisi",
  "Feest van de Vlaamse Gemeenschap": "Flaman Topluluğu Bayramı", "Nationale feestdag": "Belçika Ulusal Bayramı", "O.L.V. Hemelvaart": "Meryem Ana Günü", "Allerheiligen": "Azizler Günü", "Wapenstilstand": "Ateşkes Günü", "Kerstmis": "Noel",
  "Begin van de Ramadan": "Ramazan başlangıcı", "Begin van de Ramadan (±1 dag)": "Ramazan başlangıcı (±1 gün)",
  "Ramazan Bayramı (Suikerfeest)": "Ramazan Bayramı", "Ramazan Bayramı (Suikerfeest, ±1 dag)": "Ramazan Bayramı (±1 gün)",
  "Kurban Bayramı (Offerfeest)": "Kurban Bayramı", "Kurban Bayramı (Offerfeest, ±1 dag)": "Kurban Bayramı (±1 gün)",
  "Nieuwjaar (Marokko)": "Yılbaşı (Fas)", "Manifest van de Onafhankelijkheid": "Bağımsızlık Bildirgesi", "Amazigh Nieuwjaar (Yennayer)": "Amazigh Yılbaşı (Yennayer)", "Dag van de Arbeid (Marokko)": "İşçi Bayramı (Fas)", "Troonfeest": "Taht Bayramı", "Revolutie van Koning en Volk": "Kral ve Halk Devrimi", "Jeugdfeest": "Gençlik Bayramı", "Groene Mars": "Yeşil Yürüyüş", "Onafhankelijkheidsdag": "Bağımsızlık Günü", "Weihnachten": "Noel", "Neujahr": "Yılbaşı", "Karfreitag": "Kutsal Cuma", "Ostermontag": "Paskalya Pazartesisi", "Tag der Arbeit": "İşçi Bayramı", "Christi Himmelfahrt": "İsa'nın Göğe Yükselişi", "Pfingstmontag": "Pentekost Pazartesisi", "Tag der Deutschen Einheit": "Alman Birliği Günü", "Jour de l'an": "Yılbaşı", "Lundi de Pâques": "Paskalya Pazartesisi", "Fête du Travail": "İşçi Bayramı", "Victoire 1945": "1945 Zaferi", "Ascension": "İsa'nın Göğe Yükselişi", "Lundi de Pentecôte": "Pentekost Pazartesisi", "Fête nationale": "Fransa Ulusal Bayramı", "Assomption": "Meryem Ana Günü", "Toussaint": "Azizler Günü", "Armistice 1918": "Ateşkes Günü", "Noël": "Noel", "New Year's Day": "Yılbaşı", "Good Friday": "Kutsal Cuma", "Easter Monday": "Paskalya Pazartesisi", "Christmas Day": "Noel", "Boxing Day": "Noel'in ikinci günü",
};
/** Feestdagnamen in de taal van het gezin. */
const EN_TITLES: Record<string, string> = {
  "Nieuwjaar": "New Year's Day", "Paasmaandag": "Easter Monday", "Dag van de Arbeid": "Labour Day", "O.L.H. Hemelvaart": "Ascension Day", "Pinkstermaandag": "Whit Monday",
  "Feest van de Vlaamse Gemeenschap": "Flemish Community Day", "Nationale feestdag": "Belgian National Day", "O.L.V. Hemelvaart": "Assumption Day", "Allerheiligen": "All Saints' Day", "Wapenstilstand": "Armistice Day", "Kerstmis": "Christmas",
  "Begin van de Ramadan": "Start of Ramadan", "Begin van de Ramadan (±1 dag)": "Start of Ramadan (±1 day)",
  "Ramazan Bayramı (Suikerfeest)": "Eid al-Fitr", "Kurban Bayramı (Offerfeest)": "Eid al-Adha", "Ramazan Bayramı (Suikerfeest, ±1 dag)": "Eid al-Fitr (±1 day)", "Kurban Bayramı (Offerfeest, ±1 dag)": "Eid al-Adha (±1 day)",
  "Nieuwjaarsdag": "New Year's Day", "Goede Vrijdag": "Good Friday", "Pasen": "Easter", "Koningsdag": "King's Day", "Bevrijdingsdag": "Liberation Day", "Hemelvaartsdag": "Ascension Day", "Pinksteren": "Whitsun",
  "Sinterklaas": "Saint Nicholas", "Pakjesavond (Sinterklaas)": "Saint Nicholas' Eve", "Advent": "Advent", "Kerstavond": "Christmas Eve", "Oudejaarsavond": "New Year's Eve",
  "Nieuwjaar (Marokko)": "New Year's Day (Morocco)", "Manifest van de Onafhankelijkheid": "Independence Manifesto Day", "Amazigh Nieuwjaar (Yennayer)": "Amazigh New Year (Yennayer)", "Dag van de Arbeid (Marokko)": "Labour Day (Morocco)", "Troonfeest": "Throne Day", "Revolutie van Koning en Volk": "Revolution of the King and the People", "Jeugdfeest": "Youth Day", "Groene Mars": "Green March", "Onafhankelijkheidsdag": "Independence Day", "Weihnachten": "Christmas", "Neujahr": "New Year's Day", "Karfreitag": "Good Friday", "Ostermontag": "Easter Monday", "Tag der Arbeit": "Labour Day", "Christi Himmelfahrt": "Ascension Day", "Pfingstmontag": "Whit Monday", "Tag der Deutschen Einheit": "German Unity Day", "Jour de l'an": "New Year's Day", "Lundi de Pâques": "Easter Monday", "Fête du Travail": "Labour Day", "Victoire 1945": "Victory in Europe Day", "Ascension": "Ascension Day", "Lundi de Pentecôte": "Whit Monday", "Fête nationale": "Bastille Day", "Assomption": "Assumption Day", "Toussaint": "All Saints' Day", "Armistice 1918": "Armistice Day", "Noël": "Christmas", "Yılbaşı": "New Year's Day", "23 Nisan Ulusal Egemenlik ve Çocuk Bayramı": "National Sovereignty and Children's Day", "1 Mayıs Emek ve Dayanışma Günü": "Labour and Solidarity Day", "19 Mayıs Atatürk'ü Anma, Gençlik ve Spor Bayramı": "Commemoration of Atatürk, Youth and Sports Day", "15 Temmuz Demokrasi ve Millî Birlik Günü": "Democracy and National Unity Day", "30 Ağustos Zafer Bayramı": "Victory Day", "29 Ekim Cumhuriyet Bayramı": "Republic Day",
};
export const localizeHoliday = (h: Holiday, lang: string): Holiday => (lang === "tr" ? { ...h, title: TR_TITLES[h.title] ?? h.title } : lang === "en" ? { ...h, title: EN_TITLES[h.title] ?? h.title } : h);
/** In welke ramadan zitten we (dag x van 30), met de datum van het Suikerfeest? */
export function ramadan(date: string): { day: number; total: number; start: string; end: string; eid: string } | null {
  for (let i = 0; i < ISLAMIC.length; i++) {
    const h = ISLAMIC[i]; if (!h.title.startsWith("Begin van de Ramadan")) continue;
    const eid = ISLAMIC.slice(i + 1).find((x) => x.title.startsWith("Ramazan Bayramı")); if (!eid) continue;
    const end = addDays(eid.date, -1);
    if (date >= h.date && date <= end) { const day = Math.round((Date.parse(date) - Date.parse(h.date)) / 864e5) + 1; const total = Math.round((Date.parse(end) - Date.parse(h.date)) / 864e5) + 1; return { day, total, start: h.date, end, eid: eid.date }; }
  }
  return null;
}
/** Bayram die eraan komt of bezig is (binnen 7 dagen vooraf): Suikerfeest of Offerfeest. */
export function bayram(date: string): { title: string; icon: string; start: string; end: string; daysUntil: number; day: number | null } | null {
  for (const h of ISLAMIC) {
    if (!/Bayramı/.test(h.title)) continue;
    const end = h.endDate ?? h.date;
    const until = Math.round((Date.parse(h.date) - Date.parse(date)) / 864e5);
    if (date <= end && until <= 7) return { title: h.title, icon: h.icon, start: h.date, end, daysUntil: Math.max(0, until), day: date >= h.date ? Math.round((Date.parse(date) - Date.parse(h.date)) / 864e5) + 1 : null };
  }
  return null;
}
export function holidaysBetween(from: string, to: string, kinds: Holiday["kind"][] = ["be", "islam"], country = "BE"): Holiday[] {
  const years: number[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) years.push(y);
  const all = [...years.flatMap(belgianHolidays), ...years.flatMap(dutchHolidays), ...years.flatMap(ukHolidays), ...years.flatMap(germanHolidays), ...years.flatMap(frenchHolidays), ...years.flatMap(turkishHolidays), ...years.flatMap(moroccanHolidays), ...years.flatMap((y) => sinterklaasKerst(y, country)), ...ISLAMIC].filter((h) => kinds.includes(h.kind));
  return all.filter((h) => (h.endDate ?? h.date) >= from && h.date <= to).sort((a, b) => a.date.localeCompare(b.date));
}

/** Als kalenderafspraken (alleen-lezen, voor het hele gezin). */
export function holidayOccurrences(from: string, to: string, kinds?: Holiday["kind"][], country = "BE"): Occurrence[] {
  return holidaysBetween(from, to, kinds, country).flatMap((h) => {
    const end = h.endDate ?? h.date;
    const days: Occurrence[] = [];
    for (let d = h.date; d <= end; d = addDays(d, 1)) {
      if (d < from || d > to) continue;
      days.push({
        id: `holiday-${h.kind}-${h.date}`, title: `${h.icon} ${h.title}`, notes: "", location: "", date: h.date, endDate: h.endDate ?? null,
        startTime: null, endTime: null, allDay: true, repeat: "none", repeatUntil: null, exdates: [], members: [], source: "holiday", readOnly: true, countdown: false,
        on: d, until: end, key: `holiday-${h.kind}-${h.date}-${d}`,
      });
    }
    return days;
  });
}
