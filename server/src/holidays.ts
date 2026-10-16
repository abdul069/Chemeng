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

export interface Holiday { date: string; endDate?: string; title: string; icon: string; kind: "be" | "islam" }

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

export function holidaysBetween(from: string, to: string, kinds: Holiday["kind"][] = ["be", "islam"]): Holiday[] {
  const years: number[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) years.push(y);
  const all = [...years.flatMap(belgianHolidays), ...ISLAMIC].filter((h) => kinds.includes(h.kind));
  return all.filter((h) => (h.endDate ?? h.date) >= from && h.date <= to).sort((a, b) => a.date.localeCompare(b.date));
}

/** Als kalenderafspraken (alleen-lezen, voor het hele gezin). */
export function holidayOccurrences(from: string, to: string, kinds?: Holiday["kind"][]): Occurrence[] {
  return holidaysBetween(from, to, kinds).flatMap((h) => {
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
