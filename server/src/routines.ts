/** Routinepakketten: kant-en-klare dagelijkse taken per kind (tanden poetsen, bed maken, kamer opruimen, huiswerk …).
 *  Eén tik per kind in plaats van elke taak intikken. Taken die er al staan (zelfde titel en moment) worden overgeslagen. */
import { all, hid } from "./db.js";
import { createChore, type Moment } from "./store.js";
import { L, type Lang } from "./i18n.js";

const WEEK = [0, 1, 2, 3, 4, 5, 6]; const SCHOOL = [1, 2, 3, 4, 5];
export interface RoutineItem { key: string; icon: string; title: { nl: string; tr: string; en: string }; moment: Moment; days: number[]; points: number; group: "ochtend" | "school" | "avond" | "huis" }
export const ROUTINES: RoutineItem[] = [
  { key: "aankleden", icon: "👕", title: { nl: "Aankleden", tr: "Giyinmek", en: "Get dressed" }, moment: "ochtend", days: WEEK, points: 1, group: "ochtend" },
  { key: "ontbijt", icon: "🥣", title: { nl: "Ontbijten", tr: "Kahvaltı yapmak", en: "Eat breakfast" }, moment: "ochtend", days: WEEK, points: 1, group: "ochtend" },
  { key: "tanden_ochtend", icon: "🪥", title: { nl: "Tanden poetsen (ochtend)", tr: "Diş fırçalamak (sabah)", en: "Brush teeth (morning)" }, moment: "ochtend", days: WEEK, points: 1, group: "ochtend" },
  { key: "bed", icon: "🛏️", title: { nl: "Bed opmaken", tr: "Yatağı toplamak", en: "Make the bed" }, moment: "ochtend", days: WEEK, points: 1, group: "ochtend" },
  { key: "haar", icon: "💇", title: { nl: "Haar kammen en gezicht wassen", tr: "Saç taramak ve yüz yıkamak", en: "Comb hair and wash face" }, moment: "ochtend", days: WEEK, points: 1, group: "ochtend" },
  { key: "boekentas", icon: "🎒", title: { nl: "Boekentas klaarzetten", tr: "Okul çantasını hazırlamak", en: "Pack the school bag" }, moment: "avond", days: [0, 1, 2, 3, 4], points: 1, group: "school" },
  { key: "huiswerk", icon: "📚", title: { nl: "Huiswerk gemaakt", tr: "Ödev yapıldı", en: "Homework done" }, moment: "middag", days: SCHOOL, points: 2, group: "school" },
  { key: "lezen", icon: "📖", title: { nl: "10 minuten lezen", tr: "10 dakika okumak", en: "Read for 10 minutes" }, moment: "avond", days: WEEK, points: 1, group: "school" },
  { key: "agenda", icon: "📝", title: { nl: "Schoolagenda laten tekenen", tr: "Okul ajandasını imzalatmak", en: "Get the school diary signed" }, moment: "avond", days: SCHOOL, points: 1, group: "school" },
  { key: "brooddoos", icon: "🍱", title: { nl: "Brooddoos en drinkbus leegmaken", tr: "Beslenme kutusunu ve matarayı boşaltmak", en: "Empty lunchbox and bottle" }, moment: "middag", days: SCHOOL, points: 1, group: "school" },
  { key: "kamer", icon: "🧸", title: { nl: "Kamer opruimen", tr: "Odayı toplamak", en: "Tidy the room" }, moment: "avond", days: WEEK, points: 2, group: "avond" },
  { key: "speelgoed", icon: "🧩", title: { nl: "Speelgoed opruimen", tr: "Oyuncakları toplamak", en: "Put toys away" }, moment: "avond", days: WEEK, points: 1, group: "avond" },
  { key: "pyjama", icon: "🩳", title: { nl: "Pyjama aan, kleren in de wasmand", tr: "Pijama giymek, kıyafetleri sepete atmak", en: "Pyjamas on, clothes in the laundry basket" }, moment: "avond", days: WEEK, points: 1, group: "avond" },
  { key: "tanden_avond", icon: "🪥", title: { nl: "Tanden poetsen (avond)", tr: "Diş fırçalamak (akşam)", en: "Brush teeth (evening)" }, moment: "avond", days: WEEK, points: 1, group: "avond" },
  { key: "schermen", icon: "📵", title: { nl: "Schermen uit voor het slapen", tr: "Uyumadan önce ekranları kapatmak", en: "Screens off before bed" }, moment: "avond", days: WEEK, points: 1, group: "avond" },
  { key: "bidden", icon: "🤲", title: { nl: "Avondgebed", tr: "Akşam duası", en: "Evening prayer" }, moment: "avond", days: WEEK, points: 1, group: "avond" },
  { key: "tafel", icon: "🍽️", title: { nl: "Tafel dekken of afruimen", tr: "Sofrayı kurmak ya da toplamak", en: "Set or clear the table" }, moment: "avond", days: WEEK, points: 1, group: "huis" },
  { key: "vaatwasser", icon: "🫧", title: { nl: "Vaatwasser in- of uitladen", tr: "Bulaşık makinesini doldurmak ya da boşaltmak", en: "Load or unload the dishwasher" }, moment: "altijd", days: WEEK, points: 2, group: "huis" },
  { key: "huisdier", icon: "🐾", title: { nl: "Huisdier eten geven", tr: "Evcil hayvanı beslemek", en: "Feed the pet" }, moment: "altijd", days: WEEK, points: 1, group: "huis" },
  { key: "planten", icon: "🪴", title: { nl: "Planten water geven", tr: "Çiçekleri sulamak", en: "Water the plants" }, moment: "altijd", days: [1, 4], points: 1, group: "huis" },
  { key: "vuilnis", icon: "🗑️", title: { nl: "Vuilnis buitenzetten", tr: "Çöpü çıkarmak", en: "Take the bin out" }, moment: "avond", days: [0], points: 2, group: "huis" },
  { key: "was", icon: "🧺", title: { nl: "Eigen was opplooien", tr: "Kendi çamaşırını katlamak", en: "Fold your own laundry" }, moment: "altijd", days: [6], points: 2, group: "huis" },
];
/** Leeftijdsvoorstellen: welke sleutels standaard aangevinkt staan. */
export const AGE_SETS: Record<"kleuter" | "lagere" | "tiener", string[]> = {
  kleuter: ["aankleden", "tanden_ochtend", "speelgoed", "pyjama", "tanden_avond"],
  lagere: ["aankleden", "tanden_ochtend", "bed", "boekentas", "huiswerk", "lezen", "agenda", "brooddoos", "kamer", "pyjama", "tanden_avond", "schermen"],
  tiener: ["tanden_ochtend", "bed", "huiswerk", "kamer", "tanden_avond", "schermen", "tafel", "vaatwasser", "was"],
};
export const GROUP_LABEL: Record<RoutineItem["group"], { nl: string; tr: string; en: string }> = { ochtend: { nl: "🌅 Ochtend", tr: "🌅 Sabah", en: "🌅 Morning" }, school: { nl: "🎒 School", tr: "🎒 Okul", en: "🎒 School" }, avond: { nl: "🌙 Avond", tr: "🌙 Akşam", en: "🌙 Evening" }, huis: { nl: "🏠 In huis helpen", tr: "🏠 Evde yardım", en: "🏠 Helping at home" } };
export const catalog = (lang: Lang) => ({ items: ROUTINES.map((r) => ({ key: r.key, icon: r.icon, title: L(lang, r.title), moment: r.moment, days: r.days, points: r.points, group: r.group })), groups: (Object.keys(GROUP_LABEL) as RoutineItem["group"][]).map((g) => ({ id: g, label: L(lang, GROUP_LABEL[g]) })), ageSets: AGE_SETS });
/** Pakket toepassen voor één gezinslid; geeft terug wat er bijkwam en wat al bestond. */
export function apply(memberId: string, keys: string[], lang: Lang): { added: string[]; skipped: string[] } {
  const have = new Set(all<{ title: string; moment: string }>("SELECT title, moment FROM chores WHERE household_id=? AND member_id=?", hid(), memberId).map((c) => `${c.title.toLowerCase()}|${c.moment}`));
  const added: string[] = [], skipped: string[] = [];
  for (const key of keys) {
    const r = ROUTINES.find((x) => x.key === key); if (!r) continue;
    const title = L(lang, r.title);
    if (have.has(`${title.toLowerCase()}|${r.moment}`)) { skipped.push(title); continue; }
    createChore({ memberId, title, icon: r.icon, days: r.days, points: r.points, moment: r.moment });
    have.add(`${title.toLowerCase()}|${r.moment}`); added.push(title);
  }
  return { added, skipped };
}
