/** Instellingen → De manager: wanneer de briefings komen, en wat Gezinsbord over het gezin onthoudt. */
import { useState } from "react";
import { api } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { Memory } from "../types";
import { Avatar, Fold, cvar } from "./ui";
import { t } from "../i18n";

export function ManagerSection() {
  const { data } = useData();
  const act = useAction();
  const s = data!.settings;
  const save = (v: Record<string, string>) => act(() => api.put("/settings", v));
  const [mem] = useRemote<Memory[]>("/memory", ["settings"], []);
  const [nw, setNw] = useState({ text: "", memberId: null as string | null });
  return (
    <Fold title={t("De manager")} hint={t("briefings en geheugen")}>
      <p className="hint">{t("Elke ochtend en avond maakt {brand} een korte briefing per gezinslid: afspraken, taken, eten, weer en voorstellen voor wat nog niet geregeld is. Op het keukenscherm staat ze op het Bord; telefoons krijgen een melding.")}</p>
      <div className="row3">
        <label className="field"><span>{t("Ochtendbriefing om")}</span><input type="time" value={s.briefing_morning} onChange={(e) => save({ briefing_morning: e.target.value })} /></label>
        <label className="field"><span>{t("Avondafsluiting om")}</span><input type="time" value={s.briefing_evening} onChange={(e) => save({ briefing_evening: e.target.value })} /></label>
        <label className="check-row" style={{ alignSelf: "end" }}><input type="checkbox" checked={s.briefing_push === "1"} onChange={(e) => save({ briefing_push: e.target.checked ? "1" : "0" })} />{" "}{t("Melding op de telefoons")}</label>
      </div>
      <div className="field"><span>{t("Wat {brand} over ons weet")}</span>
        <p className="hint">{t("Feiten die de assistent onthoudt en gebruikt in gesprekken en briefings. Vertel het de assistent, of voeg het hier toe.")}</p>
        <div className="memlist">
          {mem.map((m) => { const who = m.memberId ? data!.members.find((x) => x.id === m.memberId) : null; return (
            <div className="memrow" key={m.id}>
              {who ? <span className="note-by" style={cvar(who.color)}><Avatar m={who} size={20} dot={false} /> {who.name}</span> : <span className="note-by">👨‍👩‍👧</span>}
              <span className="mem-txt">{m.text}</span>
              <button className="iconbtn" aria-label={t("Vergeten")} onClick={() => act(() => api.del(`/memory/${m.id}`), t("Vergeten"))}>✕</button>
            </div>
          ); })}
          {!mem.length && <p className="empty">{t("Nog niets onthouden.")}</p>}
        </div>
        <div className="addrow">
          <select value={nw.memberId ?? ""} onChange={(e) => setNw({ ...nw, memberId: e.target.value || null })} aria-label={t("Over wie")} style={{ flex: "none", width: 130 }}>
            <option value="">{t("Gezin")}</option>{data!.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <input value={nw.text} onChange={(e) => setNw({ ...nw, text: e.target.value })} placeholder={t("bv. lust geen spinazie, training op dinsdag")} aria-label={t("Feit")} />
          <button className="btn" disabled={nw.text.trim().length < 2} onClick={async () => { if (await act(() => api.post("/memory", { text: nw.text.trim(), memberId: nw.memberId }), t("Onthouden"))) setNw({ text: "", memberId: null }); }}>+</button>
        </div>
      </div>
    </Fold>
  );
}
