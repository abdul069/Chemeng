/** Schoolvakanties per regio, als laag in de agenda en als seintje in de briefing.
 *  Bronnen: Vlaanderen (onderwijs.vlaanderen.be), Fédération Wallonie-Bruxelles (nieuwe ritme sinds 2022), Rijksoverheid (regio's noord, midden, zuid).
 *  Einddatums zijn de laatste vrije dag (zondag). 2027-2028 voor Wallonië-Brussel is nog niet officieel bevestigd. */
import type { Lang } from "./i18n.js";

export type Region = "vl" | "fwb" | "nl-noord" | "nl-midden" | "nl-zuid";
export const REGIONS: { id: Region; nl: string; en: string; tr: string }[] = [
  { id: "vl", nl: "Vlaanderen", en: "Flanders", tr: "Flaman Bölgesi" },
  { id: "fwb", nl: "Wallonië-Brussel (Franstalig)", en: "Wallonia-Brussels (French-speaking)", tr: "Valonya-Brüksel (Fransızca)" },
  { id: "nl-noord", nl: "Nederland, regio noord", en: "Netherlands, north", tr: "Hollanda, kuzey" },
  { id: "nl-midden", nl: "Nederland, regio midden", en: "Netherlands, middle", tr: "Hollanda, orta" },
  { id: "nl-zuid", nl: "Nederland, regio zuid", en: "Netherlands, south", tr: "Hollanda, güney" },
];
type Kind = "herfst" | "kerst" | "krokus" | "pasen" | "mei" | "zomer";
const NAMES: Record<Kind, { nl: string; en: string; tr: string; icon: string }> = {
  herfst: { nl: "Herfstvakantie", en: "Autumn break", tr: "Sonbahar tatili", icon: "🍂" },
  kerst: { nl: "Kerstvakantie", en: "Christmas break", tr: "Noel tatili", icon: "🎄" },
  krokus: { nl: "Krokusvakantie", en: "Spring half-term", tr: "Karnaval tatili", icon: "🌷" },
  pasen: { nl: "Paasvakantie", en: "Easter break", tr: "Paskalya tatili", icon: "🐣" },
  mei: { nl: "Meivakantie", en: "May break", tr: "Mayıs tatili", icon: "🌼" },
  zomer: { nl: "Zomervakantie", en: "Summer holiday", tr: "Yaz tatili", icon: "☀️" },
};
const FWB_NAMES: Partial<Record<Kind, string>> = { herfst: "Congé d'automne", kerst: "Vacances d'hiver", krokus: "Congé de détente", pasen: "Congé de printemps", zomer: "Vacances d'été" };
type Span = [Kind, string, string];
const DATA: Record<Region, Span[]> = {
  vl: [
    ["herfst", "2026-11-02", "2026-11-08"], ["kerst", "2026-12-21", "2027-01-03"], ["krokus", "2027-02-08", "2027-02-14"], ["pasen", "2027-03-29", "2027-04-11"], ["zomer", "2027-07-01", "2027-08-31"],
    ["herfst", "2027-11-01", "2027-11-07"], ["kerst", "2027-12-27", "2028-01-09"], ["krokus", "2028-02-28", "2028-03-05"], ["pasen", "2028-04-03", "2028-04-17"], ["zomer", "2028-07-01", "2028-08-31"],
  ],
  fwb: [
    ["herfst", "2026-10-19", "2026-11-01"], ["kerst", "2026-12-21", "2027-01-03"], ["krokus", "2027-02-22", "2027-03-07"], ["pasen", "2027-04-26", "2027-05-09"], ["zomer", "2027-07-03", "2027-08-29"],
    ["herfst", "2027-10-25", "2027-11-07"], ["kerst", "2027-12-27", "2028-01-09"], ["krokus", "2028-02-28", "2028-03-12"], ["pasen", "2028-05-01", "2028-05-14"], ["zomer", "2028-07-01", "2028-08-27"],
  ],
  "nl-noord": [
    ["herfst", "2026-10-10", "2026-10-18"], ["kerst", "2026-12-19", "2027-01-03"], ["krokus", "2027-02-20", "2027-02-28"], ["mei", "2027-04-24", "2027-05-02"], ["zomer", "2027-07-10", "2027-08-22"],
    ["herfst", "2027-10-16", "2027-10-24"], ["kerst", "2027-12-25", "2028-01-09"], ["krokus", "2028-02-19", "2028-02-27"], ["mei", "2028-04-29", "2028-05-07"], ["zomer", "2028-07-15", "2028-08-27"],
  ],
  "nl-midden": [
    ["herfst", "2026-10-17", "2026-10-25"], ["kerst", "2026-12-19", "2027-01-03"], ["krokus", "2027-02-20", "2027-02-28"], ["mei", "2027-04-24", "2027-05-02"], ["zomer", "2027-07-17", "2027-08-29"],
    ["herfst", "2027-10-16", "2027-10-24"], ["kerst", "2027-12-25", "2028-01-09"], ["krokus", "2028-02-26", "2028-03-05"], ["mei", "2028-04-29", "2028-05-07"], ["zomer", "2028-07-08", "2028-08-20"],
  ],
  "nl-zuid": [
    ["herfst", "2026-10-17", "2026-10-25"], ["kerst", "2026-12-19", "2027-01-03"], ["krokus", "2027-02-13", "2027-02-21"], ["mei", "2027-04-24", "2027-05-02"], ["zomer", "2027-07-24", "2027-09-05"],
    ["herfst", "2027-10-23", "2027-10-31"], ["kerst", "2027-12-25", "2028-01-09"], ["krokus", "2028-02-26", "2028-03-05"], ["mei", "2028-04-29", "2028-05-07"], ["zomer", "2028-07-22", "2028-09-03"],
  ],
};
export interface SchoolBreak { kind: Kind; title: string; icon: string; from: string; to: string }
export function schoolBreaks(region: Region, lang: Lang): SchoolBreak[] {
  return (DATA[region] ?? []).map(([kind, from, to]) => ({ kind, from, to, icon: NAMES[kind].icon, title: region === "fwb" && lang === "nl" ? `${NAMES[kind].nl} (${FWB_NAMES[kind] ?? ""})`.replace(" ()", "") : NAMES[kind][lang] }));
}
/** Vakanties die (deels) in het venster vallen. */
export const breaksBetween = (region: Region, from: string, to: string, lang: Lang) => schoolBreaks(region, lang).filter((b) => b.from <= to && b.to >= from);
export const isSchoolBreak = (region: Region, date: string) => (DATA[region] ?? []).some(([, f, t]) => f <= date && date <= t);
