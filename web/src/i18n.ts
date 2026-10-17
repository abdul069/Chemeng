import { useSyncExternalStore } from "react";
import { TR } from "./i18n.tr";
import { applyDateLang } from "./dates";

export type Lang = "nl" | "tr";
const KEY = "gezinsbord.lang";
let lang: Lang = (() => { try { return (localStorage.getItem(KEY) as Lang) || "nl"; } catch { return "nl"; } })();
const subs = new Set<() => void>();

/** Vertaal een Nederlandse tekst naar de actieve taal; {naam} wordt ingevuld met vars. */
export function t(s: string, vars?: Record<string, string | number>): string {
  let out = lang === "tr" ? (TR[s] ?? s) : s;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}
export const getLang = () => lang;
export function setLang(l: Lang) {
  if (l !== "nl" && l !== "tr") l = "nl";
  if (l === lang) return;
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* */ }
  document.documentElement.lang = l;
  applyDateLang(l);
  subs.forEach((f) => f());
}
applyDateLang(lang);
document.documentElement.lang = lang;
export function useLang() { return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => lang); }
