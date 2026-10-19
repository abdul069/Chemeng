import { useSyncExternalStore } from "react";
import { applyDateLang } from "./dates";

export type Lang = "nl" | "tr";
const KEY = "gezinsbord.lang";
let lang: Lang = (() => { try { return (localStorage.getItem(KEY) as Lang) || "nl"; } catch { return "nl"; } })();
const subs = new Set<() => void>();
/** Het Turkse woordenboek wordt alleen geladen als Turks actief is (scheelt 50 kB bij de start). */
let TR: Record<string, string> = {};
let trLoading: Promise<void> | null = null;
function loadTr() {
  if (Object.keys(TR).length || trLoading) return trLoading ?? Promise.resolve();
  trLoading = import("./i18n.tr").then((m) => { TR = m.TR; subs.forEach((f) => f()); }).catch(() => { trLoading = null; });
  return trLoading;
}
if (lang === "tr") void loadTr();

/** Vertaal een Nederlandse tekst naar de actieve taal; {naam} wordt ingevuld met vars. */
export function t(s: string, vars?: Record<string, string | number>): string {
  let out = lang === "tr" ? (TR[s] ?? s) : s;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}
export const getLang = () => lang;
/** Zet de taal; de belofte is klaar zodra het woordenboek geladen is. */
export function setLang(l: Lang): Promise<void> {
  if (l !== "nl" && l !== "tr") l = "nl";
  if (l === lang) return l === "tr" ? loadTr() : Promise.resolve();
  lang = l;
  const ready = l === "tr" ? loadTr() : Promise.resolve();
  try { localStorage.setItem(KEY, l); } catch { /* */ }
  document.documentElement.lang = l;
  applyDateLang(l);
  subs.forEach((f) => f());
  return ready;
}
applyDateLang(lang);
document.documentElement.lang = lang;
export function useLang() { return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => lang); }
