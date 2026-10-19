const THEME_KEY = "gezinsbord.theme";
/** Eén lichte stijl; oude themakeuzes worden gewist. */
export function applyTheme() {
  document.documentElement.removeAttribute("data-theme");
  try { localStorage.removeItem(THEME_KEY); } catch { /* */ }
}
