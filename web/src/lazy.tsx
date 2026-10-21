/** Schermen die pas bij openen laden. Na een update bestaan de oude bestanden niet meer op de server;
 *  dan laadt de pagina zichzelf één keer opnieuw in plaats van eeuwig te blijven draaien. */
import { Component, lazy, type ComponentType, type ReactNode } from "react";
import { t } from "./i18n";

const KEY = "gb.reloaded";

export function lazyRetry<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().catch((err) => {
      let last = 0;
      try { last = Number(sessionStorage.getItem(KEY) || 0); } catch { /* */ }
      if (Date.now() - last > 60_000) {
        try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* */ }
        location.reload();
        return new Promise<{ default: T }>(() => { /* de pagina herlaadt */ });
      }
      throw err;
    }),
  );
}

/** Vangt fouten bij het laden van een scherm op en toont een knop om opnieuw te laden. */
export class ScreenBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.error(err); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="center" style={{ flexDirection: "column", gap: 12, padding: 24, textAlign: "center" }}>
        <div className="mascot" aria-hidden />
        <p>{t("Dit scherm kon niet geladen worden. Waarschijnlijk is er net een update.")}</p>
        <button className="btn" onClick={() => { try { sessionStorage.removeItem(KEY); } catch { /* */ } location.reload(); }}>{t("Opnieuw laden")}</button>
      </div>
    );
  }
}
