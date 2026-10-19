import { useEffect, useState } from "react";
import { api } from "../api";
import { useAction, useData } from "../store";
import { Avatar, Modal, cvar } from "./ui";
import { todayIso } from "../dates";
import { t as tr } from "../i18n";
import type { Slot } from "../types";

interface Macros { kcal: number; protein: number; carbs: number; fat: number }
const DEFAULT_SLOT = (): Slot => { const h = new Date().getHours(); return h < 10 ? "ontbijt" : h < 14 ? "lunch" : h < 17 ? "snack" : "diner"; };

/* ---------- in het recept: kcal per portie en “in dagboek” ---------- */
export interface Nutrition { kcal: number; perServing: Macros; servings: number; matched: number; lines: { line: string; food: string | null; grams: number | null; kcal: number | null; guessed: boolean }[]; guessed: number; manualKcal: number | null; source: "manual" | "estimate"; forbidden: { memberId: string; name: string; hits: string[] }[] }
export function useNutrition(recipeId: string) {
  const [n, setN] = useState<Nutrition | null>(null);
  const load = () => api.get<Nutrition>(`/recipes/${recipeId}/nutrition`).then(setN).catch(() => setN(null));
  useEffect(() => { void load(); }, [recipeId]); // eslint-disable-line react-hooks/exhaustive-deps
  return [n, load] as const;
}
export function RecipeCalories({ recipeId, servingsShown }: { recipeId: string; servingsShown: number }) {
  const { data, toast } = useData();
  const act = useAction();
  const [n, reload] = useNutrition(recipeId);
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState("");
  const [log, setLog] = useState(false);
  const members = (data?.members ?? []).filter((m) => m.role !== "huisdier");
  if (!n) return null;
  return (
    <>
      <button className={`badge kcal${n.source === "manual" ? " manual" : ""}`} onClick={() => { setManual(n.manualKcal ? String(n.manualKcal) : ""); setOpen(true); }} title={tr("Calorieën per portie: tik voor details")}>🔥 {n.kcal} kcal/{tr("portie")}{n.source === "estimate" ? " ≈" : ""}</button>
      <button className="badge" onClick={() => setLog(true)} title={tr("Zet dit recept in het dieetdagboek")}>📒 {tr("In dagboek")}</button>
      {n.forbidden.map((f) => <span key={f.memberId} className="badge warn" title={tr("Verboden ingrediënt volgens het profiel")}>⚠️ {tr("Niet voor {name}", { name: f.name })}: {f.hits.join(", ")}</span>)}
      {open && (
        <Modal title={tr("Voedingswaarde per portie")} onClose={() => setOpen(false)}>
          <p className="hint">{n.source === "manual" ? tr("Handmatig ingevuld: {k} kcal per portie.", { k: n.manualKcal ?? 0 }) : tr("Geschat uit de ingrediënten: {m} van {t} regels herkend, bij {g} zonder hoeveelheid is een portie gegokt. Recept voor {s} porties.", { m: n.matched, t: n.lines.length, g: n.guessed, s: n.servings })}</p>
          <div className="macros big">
            <span className="badge">🔥 {n.perServing.kcal} kcal</span><span className="badge">{tr("Eiwit")} {n.perServing.protein} g</span><span className="badge">{tr("Koolhydraten")} {n.perServing.carbs} g</span><span className="badge">{tr("Vet")} {n.perServing.fat} g</span>
          </div>
          <div className="upnext" style={{ maxHeight: "40vh", overflow: "auto" }}>
            {n.lines.map((l, i) => <div className="item" key={i}><span style={{ flex: 1 }}>{l.line}</span><small className="num">{l.food ? `${l.grams} g · ${l.kcal} kcal${l.guessed ? " ?" : ""}` : tr("niet herkend")}</small></div>)}
          </div>
          <div className="addrow">
            <input type="number" inputMode="numeric" min={0} max={5000} value={manual} onChange={(e) => setManual(e.target.value)} placeholder={tr("Eigen kcal per portie")} />
            <button className="btn" onClick={async () => { await act(() => api.put(`/recipes/${recipeId}/kcal`, { kcal: manual ? Number(manual) : null }), tr("Bewaard")); void reload(); setOpen(false); }}>{tr("Bewaren")}</button>
            {n.manualKcal !== null && <button className="pill" onClick={async () => { await act(() => api.put(`/recipes/${recipeId}/kcal`, { kcal: null })); void reload(); setOpen(false); }}>{tr("Terug naar schatting")}</button>}
          </div>
        </Modal>
      )}
      {log && (
        <Modal title={tr("In dagboek van…")} onClose={() => setLog(false)}>
          <p className="hint">{tr("1 portie van dit recept wordt genoteerd op vandaag.")} {servingsShown !== n.servings ? tr("(Je bekijkt het recept voor {s} porties; per portie blijft gelijk.)", { s: servingsShown }) : ""}</p>
          <div className="picks">
            {members.map((m) => <button key={m.id} className="pick pick-person" style={cvar(m.color)} onClick={async () => { const r = await act(() => api.post<{ entry: unknown; warning: string[] }>("/diet/log", { memberId: m.id, date: todayIso(), slot: DEFAULT_SLOT(), recipeId, portions: 1 }), tr("Genoteerd voor {name}", { name: m.name })); if (r?.warning.length) toast(tr("⚠️ Let op, {name} vermijdt: {w}", { name: m.name, w: r.warning.join(", ") })); setLog(false); }}><Avatar m={m} size={22} dot={false} /> {m.name}</button>)}
          </div>
        </Modal>
      )}
    </>
  );
}
