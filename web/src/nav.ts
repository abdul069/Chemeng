import { useEffect } from "react";

/** Navigatie-parameters van "Zoeken" (bv. een datum of lijst): via sessionStorage voor een scherm dat nog moet laden,
 *  en via een event voor een scherm dat al open staat. */
export function navParam(key: string): string | null {
  try { const v = sessionStorage.getItem(`gb.${key}`); if (v !== null) sessionStorage.removeItem(`gb.${key}`); return v; } catch { return null; }
}
export function useNavParam(key: string, apply: (value: string) => void) {
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent<{ key: string; value: string }>).detail; if (d.key === key) apply(d.value); };
    window.addEventListener("gb:nav", h);
    return () => window.removeEventListener("gb:nav", h);
  }, [key, apply]);
}
export function emitNav(extra: Record<string, string>) {
  try { for (const [k, v] of Object.entries(extra)) sessionStorage.setItem(`gb.${k}`, v); } catch { /* */ }
  // na de wissel van scherm: open schermen bijwerken en de bewaarde waarden opruimen
  const fire = () => { for (const [k, v] of Object.entries(extra)) window.dispatchEvent(new CustomEvent("gb:nav", { detail: { key: k, value: v } })); };
  setTimeout(fire, 60);
  setTimeout(fire, 400); // ook voor onderdelen die pas na de eerste wissel gemonteerd worden
  // "meals" is het onthouden tabblad en blijft staan; de rest ruimen we na een tijdje op
  setTimeout(() => { try { for (const k of Object.keys(extra)) if (k !== "meals") sessionStorage.removeItem(`gb.${k}`); } catch { /* */ } }, 2000);
}
