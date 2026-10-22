/** Tradities op het Bord, alleen als ze spelen: ramadan (iftar en sahur) en advent (aftellen naar Kerst). Opt-in via Instellingen → Feestdagen. */
import { useEffect, useState } from "react";
import { useAction, useRemote } from "../store";
import { api } from "../api";
import { hm } from "../islam";
import { t } from "../i18n";

interface Today { ramadan?: { day: number; total: number; eid: string; iftar: string; imsak: string; imsakTomorrow: string }; advent?: { day: number }; bayram?: { title: string; icon: string; start: string; end: string; daysUntil: number; day: number | null; visits: number } }

function left(iso: string): string {
  const ms = Date.parse(iso) - Date.now(); if (ms <= 0) return "";
  const h = Math.floor(ms / 3600_000), m = Math.floor((ms % 3600_000) / 60_000);
  return h ? t("over {h}u{m}", { h, m: String(m).padStart(2, "0") }) : t("over {m} min", { m });
}

export function TraditionsWidget({ goto }: { goto?: (s: "calendar" | "meals" | "lists") => void } = {}) {
  const act = useAction();
  const [d] = useRemote<Today>("/traditions/today", ["settings"], {});
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(i); }, []);
  if (!d.ramadan && !d.advent && !d.bayram) return null;
  const bayramList = async () => { const r = await act(() => api.post<{ ok: boolean; did: string[] }>("/traditions/bayram-list"), t("Feestboodschappen op de lijst")); void r; };
  return (
    <section className="glass widget-sm trad">
      {d.ramadan && (
        <>
          <div className="widget-h"><h2>🌙 {t("Ramadan")} · {t("dag {d} van {n}", { d: d.ramadan.day, n: d.ramadan.total })}</h2></div>
          <div className="trad-rows">
            <div className="trad-row"><span>🌇</span><span><b>{t("Iftar")} {hm(d.ramadan.iftar)}</b><small className="muted">{Date.parse(d.ramadan.iftar) > Date.now() ? left(d.ramadan.iftar) : t("eet smakelijk")}</small></span></div>
            <div className="trad-row"><span>🌅</span><span><b>{t("Sahur tot")} {hm(Date.parse(d.ramadan.imsak) > Date.now() ? d.ramadan.imsak : d.ramadan.imsakTomorrow)}</b><small className="muted">{Date.parse(d.ramadan.imsak) > Date.now() ? left(d.ramadan.imsak) : t("morgenochtend")}</small></span></div>
            <div className="trad-row"><span>🍬</span><span><small className="muted">{t("Suikerfeest op {d}", { d: d.ramadan.eid })}</small></span></div>
          </div>
        </>
      )}
      {d.bayram && (
        <>
          <div className="widget-h"><h2>{d.bayram.icon} {d.bayram.title}{d.bayram.day ? ` · ${t("dag {d}", { d: d.bayram.day })}` : d.bayram.daysUntil === 0 ? "" : ` · ${t("over {d} dagen", { d: d.bayram.daysUntil })}`}</h2></div>
          <div className="trad-rows">
            <div className="trad-row"><span>🤝</span><span><b>{d.bayram.visits ? t("{n} bezoeken gepland", { n: d.bayram.visits }) : t("Nog geen bezoeken gepland")}</b><small className="muted">{t("Zet de familiebezoeken in de agenda, dan ziet iedereen wie wanneer komt.")}</small></span>{goto && <button className="btn small ghost" onClick={() => goto("calendar")}>{t("Plannen")}</button>}</div>
            <div className="trad-row"><span>🍬</span><span><b>{t("Feestboodschappen")}</b><small className="muted">{t("snoep, chocolade, baklava, koffie, thee, servetten")}</small></span><button className="btn small ghost" onClick={bayramList}>{t("Op de lijst")}</button></div>
            {goto && <div className="trad-row"><span>🍽️</span><span><b>{t("Feestmenu")}</b><small className="muted">{t("Plan de feestdagen in het weekmenu")}</small></span><button className="btn small ghost" onClick={() => goto("meals")}>{t("Weekmenu")}</button></div>}
          </div>
        </>
      )}
      {d.advent && (
        <>
          <div className="widget-h"><h2>🕯️ {t("Advent")} · {t("dag {d} van {n}", { d: d.advent.day, n: 24 })}</h2></div>
          <div className="trad-rows"><div className="trad-row"><span>🎄</span><span><b>{24 - d.advent.day === 0 ? t("Vanavond is het Kerstavond!") : t("nog {n} nachtjes tot Kerst", { n: 24 - d.advent.day })}</b></span></div></div>
        </>
      )}
    </section>
  );
}
