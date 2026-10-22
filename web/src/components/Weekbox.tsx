/** De Weekbox: de manager stelt het avondeten voor de week voor; één tik om te plannen, daarna één gebundelde boodschappenlijst met prijsschatting. */
import { useEffect, useState } from "react";
import { api } from "../api";
import { useAction, useData } from "../store";
import type { WeekboxBasket, WeekboxDay } from "../types";
import { Modal } from "./ui";
import { RecipeThumb } from "./Recipes";
import { DSHORT, MSHORT, addDays, todayIso, weekday } from "../dates";
import { euro } from "./Prices";
import { LinkButtons } from "./Connectors";
import { t } from "../i18n";

type Step = "days" | "plan" | "basket";

export function WeekboxWizard({ start, onClose }: { start: string; onClose: () => void }) {
  const { data, toast } = useData();
  const act = useAction();
  const week = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const [days, setDays] = useState<Set<string>>(() => { const from = week.filter((d) => d >= todayIso()); return new Set(from.length ? from : week); });
  const [step, setStep] = useState<Step>("days");
  const [plan, setPlan] = useState<WeekboxDay[]>([]);
  const [busy, setBusy] = useState(false);
  const [basket, setBasket] = useState<WeekboxBasket | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const label = (d: string) => `${DSHORT[weekday(d)]} ${Number(d.slice(8))} ${MSHORT[Number(d.slice(5, 7)) - 1]}`;
  const recipesCount = data?.recipes.length ?? 0;

  const proposeAll = async () => {
    setBusy(true);
    const r = await act(() => api.post<WeekboxDay[]>("/meals/weekbox/propose", { from: start, dates: [...days].sort() }));
    setBusy(false);
    if (r) { setPlan(r); setStep("plan"); }
  };
  const replace = async (date: string) => {
    const exclude = plan.map((p) => p.recipeId).filter((x): x is string => !!x);
    const r = await act(() => api.post<WeekboxDay[]>("/meals/weekbox/propose", { from: start, dates: [date], exclude }));
    if (r?.[0]) setPlan((p) => p.map((x) => (x.date === date ? r[0] : x)));
  };
  const drop = (date: string) => setPlan((p) => p.filter((x) => x.date !== date));
  const applyPlan = async () => {
    const items = plan.filter((p) => p.recipeId).map((p) => ({ date: p.date, recipeId: p.recipeId!, title: p.title }));
    if (!items.length) return;
    const r = await act(() => api.post<{ planned: number }>("/meals/weekbox/apply", { items }), t("{n} avondmalen ingepland", { n: items.length }));
    if (r) { setStep("basket"); }
  };
  useEffect(() => {
    if (step !== "basket") return;
    const from = [...days].sort()[0] ?? start, to = [...days].sort().at(-1) ?? addDays(start, 6);
    api.get<WeekboxBasket>(`/meals/weekbox/basket?from=${from}&to=${to}`).then(setBasket).catch(() => setBasket(null));
  }, [step, days, start]);
  const toList = async () => {
    const from = [...days].sort()[0] ?? start, to = [...days].sort().at(-1) ?? addDays(start, 6);
    const r = await act(() => api.post<{ added: number; list: string }>("/meals/weekbox/to-list", { from, to, skip: [...skip] }));
    if (r) { toast(r.added ? t("{a} ingrediënten op {l}", { a: r.added, l: r.list }) : t("Alles stond al op de lijst")); onClose(); }
  };
  const q = basket ? basket.items.filter((i) => !i.inHouse && !skip.has(i.name)).map((i) => i.name).slice(0, 1).join(" ") : "";

  return (
    <Modal title={`✨ ${t("Weekbox")}`} onClose={onClose} wide>
      {step === "days" && (
        <>
          <p className="hint">{t("Kies de avonden. De manager kiest per avond een gerecht: snel op drukke avonden (agenda), met wat bijna vervalt in de voorraad, zonder wat iemand vermijdt, en gevarieerd.")}</p>
          {recipesCount < 3 && <p className="error">{t("Je bibliotheek heeft maar {n} recepten. Voeg er eerst een paar toe (Recepten → Bibliotheek) voor een gevarieerde week.", { n: recipesCount })}</p>}
          <div className="picks">{week.map((d) => <button type="button" key={d} className="pick" aria-pressed={days.has(d)} onClick={() => setDays((s) => { const n = new Set(s); if (n.has(d)) n.delete(d); else n.add(d); return n; })}>{label(d)}</button>)}</div>
          <div className="actions"><button className="btn ghost" onClick={onClose}>{t("Annuleren")}</button><button className="btn" disabled={busy || !days.size || !recipesCount} onClick={proposeAll}>{busy ? "…" : t("Stel voor")}</button></div>
        </>
      )}
      {step === "plan" && (
        <>
          <div className="wb-days">
            {plan.map((p) => (
              <div className={`wb-day${p.busy ? " busy" : ""}`} key={p.date}>
                <div className="wb-date"><b>{label(p.date)}</b>{p.busy && <small>⏱ {t("drukke avond")}</small>}{p.current && <small className="muted">{t("nu")}: {p.current}</small>}</div>
                {p.recipeId ? <RecipeThumb r={{ image: p.image, title: p.title }} size={56} /> : <span className="rthumb ph" style={{ width: 56, height: 56 }}>🍲</span>}
                <div className="wb-txt"><b>{p.title || t("Geen voorstel")}</b><small className="muted">{[p.minutes ? `${p.minutes} min` : null, p.why].filter(Boolean).join(" · ")}</small></div>
                <div className="wb-btns"><button className="btn small ghost" onClick={() => replace(p.date)}>🎲 {t("Andere")}</button><button className="iconbtn" aria-label={t("Deze avond overslaan")} onClick={() => drop(p.date)}>✕</button></div>
              </div>
            ))}
            {!plan.length && <p className="empty">{t("Geen avonden meer.")}</p>}
          </div>
          <div className="actions"><button className="btn ghost" onClick={() => setStep("days")}>{t("Terug")}</button><button className="btn" disabled={!plan.some((p) => p.recipeId)} onClick={applyPlan}>📅 {t("Plannen")} ({plan.filter((p) => p.recipeId).length})</button></div>
        </>
      )}
      {step === "basket" && (
        <>
          {!basket && <p className="empty">…</p>}
          {basket && (
            <>
              <p className="hint">{t("Ingrediënten van {r} gerechten, gebundeld en geschaald naar {p} personen. Wat al in huis is, staat grijs.", { r: basket.recipes.length, p: basket.people })}</p>
              <div className="wb-basket">
                {basket.items.map((i) => (
                  <label className={`wb-item${i.inHouse ? " have" : ""}${skip.has(i.name) ? " skip" : ""}`} key={i.name}>
                    <input type="checkbox" checked={!i.inHouse && !skip.has(i.name)} disabled={i.inHouse} onChange={() => setSkip((s) => { const n = new Set(s); if (n.has(i.name)) n.delete(i.name); else n.add(i.name); return n; })} />
                    <span className="wb-name"><b>{i.name}</b>{i.amount && <small> · {i.amount}</small>}<small className="muted"> · {i.recipes.join(", ")}</small></span>
                    <span className="wb-price">{i.inHouse ? t("in huis") : i.price ? `${euro(i.price.price)} · ${i.price.store}` : ""}</span>
                  </label>
                ))}
              </div>
              <div className="scan-foot">
                <span>{basket.estimate.known > 0 ? t("Geschat {e} voor {k} van {n} items ({s})", { e: euro(basket.estimate.total), k: basket.estimate.known, n: basket.estimate.toBuy, s: basket.estimate.stores.join(", ") }) : t("Nog geen prijzen bekend: lees een kassaticket in en de schatting verschijnt hier.")}</span>
              </div>
              {q && <LinkButtons kind="list" q={q} label={t("Zoek bij")} />}
              <div className="actions"><button className="btn ghost" onClick={onClose}>{t("Sluiten")}</button><button className="btn" onClick={toList}>🛒 {t("Op de boodschappenlijst")}</button></div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
