/**
 * Koran-tekst en -vertalingen via de open API van alquran.cloud, met een blijvende cache in de databank
 * zodat een soera na de eerste keer meteen en ook zonder internet opent. Audio per vers komt rechtstreeks
 * van cdn.islamic.network naar het scherm.
 */
import { get, run } from "./db.js";

const API = "https://api.alquran.cloud/v1";
export const RECITERS = [
  { id: "ar.alafasy", label: "Mishary Rashid Alafasy" },
  { id: "ar.abdulbasitmurattal", label: "Abdul Basit (murattal)" },
  { id: "ar.husary", label: "Mahmoud Khalil Al-Husary" },
  { id: "ar.minshawi", label: "Mohamed Siddiq Al-Minshawi" },
  { id: "ar.abdurrahmaansudais", label: "Abdurrahman As-Sudais" },
  { id: "ar.mahermuaiqly", label: "Maher Al-Muaiqly" },
  { id: "ar.saoodshuraym", label: "Saud Ash-Shuraym" },
  { id: "ar.hudhaify", label: "Ali Al-Hudhaify" },
];
export const TRANSLATIONS = [
  { id: "nl.siregar", label: "Nederlands (Siregar)" },
  { id: "nl.keyzer", label: "Nederlands (Keyzer)" },
  { id: "tr.diyanet", label: "Türkçe (Diyanet)" },
  { id: "tr.yazir", label: "Türkçe (Elmalılı Hamdi Yazır)" },
  { id: "en.sahih", label: "English (Saheeh International)" },
  { id: "fr.hamidullah", label: "Français (Hamidullah)" },
];

export interface SurahInfo { number: number; name: string; englishName: string; englishNameTranslation: string; numberOfAyahs: number; revelationType: string }
export interface Ayah { number: number; numberInSurah: number; text: string; translation: string; juz: number; page: number; sajda: boolean }
export interface Surah extends SurahInfo { translationId: string; ayahs: Ayah[] }

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const row = get<{ json: string }>("SELECT json FROM quran_cache WHERE key=?", key);
  if (row) return JSON.parse(row.json) as T;
  const v = await load();
  run("INSERT OR REPLACE INTO quran_cache(key, json) VALUES (?,?)", key, JSON.stringify(v));
  return v;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "user-agent": "Gezinsbord/1.0" } });
  if (!r.ok) throw new Error(`De Koran-dienst antwoordde met ${r.status}.`);
  const j = (await r.json()) as { code: number; data: T };
  if (j.code !== 200) throw new Error("De Koran-dienst gaf een fout terug.");
  return j.data;
}

export const quranSurahs = () => cached<SurahInfo[]>("surahs", async () =>
  (await getJson<SurahInfo[]>(`${API}/surah`)).map((s) => ({ number: s.number, name: s.name, englishName: s.englishName, englishNameTranslation: s.englishNameTranslation, numberOfAyahs: s.numberOfAyahs, revelationType: s.revelationType })));

export const quranSurah = (n: number, translation: string) => cached<Surah>(`surah:${n}:${translation}`, async () => {
  type Ed = SurahInfo & { ayahs: { number: number; numberInSurah: number; text: string; juz: number; page: number; sajda: boolean | object }[] };
  const [ar, tr] = await getJson<Ed[]>(`${API}/surah/${n}/editions/quran-uthmani,${encodeURIComponent(translation)}`);
  return {
    number: ar.number, name: ar.name, englishName: ar.englishName, englishNameTranslation: ar.englishNameTranslation, numberOfAyahs: ar.numberOfAyahs, revelationType: ar.revelationType,
    translationId: translation,
    ayahs: ar.ayahs.map((a, i) => ({ number: a.number, numberInSurah: a.numberInSurah, text: a.text, translation: tr?.ayahs[i]?.text ?? "", juz: a.juz, page: a.page, sajda: !!a.sajda })),
  };
});
