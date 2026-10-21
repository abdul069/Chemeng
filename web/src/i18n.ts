import { useSyncExternalStore } from "react";
import { applyDateLang } from "./dates";

/** Talen van de app. De bronteksten in de code zijn (nog) Nederlands; Turks en Engels zijn woordenboeken op die sleutel. */
export type Lang = "nl" | "tr" | "en";
export const LANGS: Lang[] = ["nl", "en", "tr"];
export const asLang = (v: unknown): Lang => (v === "tr" || v === "en" ? v : "nl");
const KEY = "gezinsbord.lang";
let lang: Lang = (() => { try { return asLang(localStorage.getItem(KEY)); } catch { return "nl"; } })();
const subs = new Set<() => void>();

/** Merknaam: één instelling, komt van de server (BRAND_NAME). Overal in teksten staat {brand}. */
let brandName = "Kinday";
export const brand = () => brandName;
export function setBrand(name: string | undefined | null) {
  if (!name || name === brandName) return;
  brandName = name; document.title = name; subs.forEach((f) => f());
}

/** Woordenboeken worden pas geladen als die taal actief is (scheelt 50 kB per taal bij de start). */
const dicts: Partial<Record<Lang, Record<string, string>>> = {};
const loading: Partial<Record<Lang, Promise<void>>> = {};
function loadDict(l: Lang): Promise<void> {
  if (l === "nl" || dicts[l]) return Promise.resolve();
  if (loading[l]) return loading[l]!;
  const p = (l === "tr" ? import("./i18n.tr").then((m) => m.TR) : import("./i18n.en").then((m) => m.EN))
    .then((d) => { dicts[l] = d; subs.forEach((f) => f()); })
    .catch(() => { delete loading[l]; });
  loading[l] = p; return p;
}
if (lang !== "nl") void loadDict(lang);

/** Vertaal een Nederlandse tekst naar de actieve taal; {naam} wordt ingevuld met vars, {brand} met de merknaam. */
export function t(s: string, vars?: Record<string, string | number>): string {
  let out = lang === "nl" ? s : (dicts[lang]?.[s] ?? s);
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  if (out.includes("{brand}")) out = out.split("{brand}").join(brandName);
  return out;
}
export const getLang = () => lang;
/** Zet de taal; de belofte is klaar zodra het woordenboek geladen is. */
export function setLang(l: Lang): Promise<void> {
  l = asLang(l);
  if (l === lang) return loadDict(l);
  lang = l;
  const ready = loadDict(l);
  try { localStorage.setItem(KEY, l); } catch { /* */ }
  document.documentElement.lang = l;
  applyDateLang(l);
  subs.forEach((f) => f());
  return ready;
}
applyDateLang(lang);
document.documentElement.lang = lang;
export function useLang() { return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => lang); }
