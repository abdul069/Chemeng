/** Tradities op het Bord, alleen als ze spelen: ramadan (iftar en sahur) en advent (aftellen naar Kerst). Opt-in via Instellingen → Feestdagen. */
import { useEffect, useState } from "react";
import { useRemote } from "../store";
import { hm } from "../islam";
import { t } from "../i18n";

interface Today { ramadan?: { day: number; total: number; eid: string; iftar: string; imsak: string; imsakTomorrow: string }; advent?: { day: number } }

function left(iso: string): string {
  const ms = Date.parse(iso) - Date.now(); if (ms <= 0) return "";
  const h = Math.floor(ms / 3600_000), m = Math.floor((ms % 3600_000) / 60_000);
  return h ? t("over {h}u{m}", { h, m: String(m).padStart(2, "0") }) : t("over {m} min", { m });
}

export function TraditionsWidget() {
  const [d] = useRemote<Today>("/traditions/today", ["settings"], {});
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(i); }, []);
  if (!d.ramadan && !d.advent) return null;
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
      {d.advent && (
        <>
          <div className="widget-h"><h2>🕯️ {t("Advent")} · {t("dag {d} van {n}", { d: d.advent.day, n: 24 })}</h2></div>
          <div className="trad-rows"><div className="trad-row"><span>🎄</span><span><b>{24 - d.advent.day === 0 ? t("Vanavond is het Kerstavond!") : t("nog {n} nachtjes tot Kerst", { n: 24 - d.advent.day })}</b></span></div></div>
        </>
      )}
    </section>
  );
}
