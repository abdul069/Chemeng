import { useState } from "react";
import { api } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { Meal, Recipe, Slot } from "../types";
import { Confirm, Modal } from "../components/ui";
import { Icon } from "../components/Icons";
import { DSHORT, MSHORT, addDays, startOfWeek, todayIso, weekday } from "../dates";

const SLOTS: Slot[] = ["ontbijt", "lunch", "diner"];

export function MealsScreen({ header }: { header: React.ReactNode }) {
  const { data } = useData();
  const [start, setStart] = useState(() => startOfWeek(todayIso(), Number(data?.settings.week_start ?? 1)));
  const end = addDays(start, 6);
  const [meals] = useRemote<Meal[]>(`/meals?from=${start}&to=${end}`, ["meals", "recipes"], []);
  const [slot, setSlot] = useState<{ date: string; slot: Slot } | null>(null);
  const [recipe, setRecipe] = useState<Recipe | "new" | null>(null);
  const t = todayIso();

  return (
    <>
      <div className="topbar">
        {header}
        <div className="right">
          <button className="iconbtn" onClick={() => setStart(addDays(start, -7))} aria-label="Vorige week"><Icon.left /></button>
          <span className="range">{Number(start.slice(8))} {MSHORT[Number(start.slice(5, 7)) - 1]} – {Number(end.slice(8))} {MSHORT[Number(end.slice(5, 7)) - 1]}</span>
          <button className="iconbtn" onClick={() => setStart(addDays(start, 7))} aria-label="Volgende week"><Icon.right /></button>
          <button className="pill" onClick={() => setRecipe("new")}>+ Recept</button>
        </div>
      </div>
      <div className="page-scroll" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ overflowX: "auto", paddingBottom: 6 }}>
          <div className="mealweek">
            {Array.from({ length: 7 }, (_, i) => {
              const d = addDays(start, i);
              return (
                <section className={`mealday${d === t ? " today" : ""}`} key={d}>
                  <h3>{DSHORT[weekday(d)]} {Number(d.slice(8))}{d === t ? " · vandaag" : ""}</h3>
                  {SLOTS.map((s) => {
                    const m = meals.find((x) => x.date === d && x.slot === s);
                    return (
                      <button key={s} className={`slot${m ? " filled" : ""}`} onClick={() => setSlot({ date: d, slot: s })}>
                        <small>{s}</small>{m?.title ?? <span className="muted">+ toevoegen</span>}
                      </button>
                    );
                  })}
                </section>
              );
            })}
          </div>
        </div>
        <section>
          <div className="section-title"><h2>Recepten</h2></div>
          <div className="grid-cards">
            {data?.recipes.map((r) => (
              <button key={r.id} className="recipe" onClick={() => setRecipe(r)}>
                <h3>{r.title}</h3>
                <span className="muted">{r.minutes ? `${r.minutes} min · ` : ""}{r.ingredients.split("\n").filter(Boolean).length} ingrediënten</span>
              </button>
            ))}
            {!data?.recipes.length && <p className="empty">Nog geen recepten. Voeg je favorieten toe om ze snel in te plannen.</p>}
          </div>
        </section>
      </div>
      {slot && <SlotEditor {...slot} current={meals.find((m) => m.date === slot.date && m.slot === slot.slot)} onClose={() => setSlot(null)} />}
      {recipe && <RecipeEditor recipe={recipe === "new" ? undefined : recipe} onClose={() => setRecipe(null)} />}
    </>
  );
}

function SlotEditor({ date, slot, current, onClose }: { date: string; slot: Slot; current?: Meal; onClose: () => void }) {
  const { data } = useData();
  const act = useAction();
  const [title, setTitle] = useState(current?.title ?? "");
  const save = async (t: string, recipeId: string | null = null) => {
    if (await act(() => api.put("/meals", { date, slot, title: t, recipeId }), t ? "Maaltijd gepland" : "Maaltijd gewist")) onClose();
  };
  return (
    <Modal title={`${slot[0].toUpperCase()}${slot.slice(1)} · ${DSHORT[weekday(date)]} ${Number(date.slice(8))} ${MSHORT[Number(date.slice(5, 7)) - 1]}`} onClose={onClose}>
      <label className="field"><span>Wat eten we?</span><input id="meal-title" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save(title.trim())} placeholder="bv. Stoofvlees met frietjes" /></label>
      {!!data?.recipes.length && (
        <div className="field"><span>Of kies een recept</span>
          <div className="picks">{data.recipes.map((r) => <button key={r.id} className="pick" aria-pressed={current?.recipeId === r.id} onClick={() => save(r.title, r.id)}>{r.title}</button>)}</div>
        </div>
      )}
      <div className="actions">
        {current && <button className="btn danger left" onClick={() => save("")}>Wissen</button>}
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button className="btn" onClick={() => save(title.trim())} disabled={!title.trim()}>Bewaren</button>
      </div>
    </Modal>
  );
}

function RecipeEditor({ recipe, onClose }: { recipe?: Recipe; onClose: () => void }) {
  const { data } = useData();
  const act = useAction();
  const [f, setF] = useState({ title: recipe?.title ?? "", ingredients: recipe?.ingredients ?? "", instructions: recipe?.instructions ?? "", minutes: recipe?.minutes ?? null as number | null });
  const [confirm, setConfirm] = useState(false);
  const shop = data?.lists.find((l) => /boodschap/i.test(l.name)) ?? data?.lists[0];
  const save = async () => {
    if (!f.title.trim()) return;
    if (await act(() => (recipe ? api.put(`/recipes/${recipe.id}`, f) : api.post("/recipes", f)), "Recept bewaard")) onClose();
  };
  return (
    <Modal title={recipe ? recipe.title : "Nieuw recept"} onClose={onClose} wide>
      <div className="row2">
        <label className="field"><span>Naam</span><input id="rc-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="field"><span>Bereidingstijd (minuten)</span><input id="rc-min" type="number" min={0} value={f.minutes ?? ""} onChange={(e) => setF({ ...f, minutes: e.target.value ? Number(e.target.value) : null })} /></label>
      </div>
      <label className="field"><span>Ingrediënten (één per regel)</span><textarea id="rc-ing" rows={6} value={f.ingredients} onChange={(e) => setF({ ...f, ingredients: e.target.value })} /></label>
      <label className="field"><span>Bereiding</span><textarea id="rc-ins" rows={5} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></label>
      <div className="actions">
        {recipe && <button className="btn danger left" onClick={() => setConfirm(true)}>Verwijderen</button>}
        {recipe && shop && (
          <button className="btn ghost" onClick={() => act(() => api.post(`/recipes/${recipe.id}/to-list`, { listId: shop.id }), `Ingrediënten op ${shop.name} gezet`)}>🛒 Naar {shop.name}</button>
        )}
        <button className="btn" onClick={save} disabled={!f.title.trim()}>Bewaren</button>
      </div>
      {confirm && recipe && <Confirm title="Recept verwijderen?" onClose={() => setConfirm(false)}
        actions={[{ label: "Verwijderen", run: async () => { if (await act(() => api.del(`/recipes/${recipe.id}`), "Recept verwijderd")) onClose(); } }]} />}
    </Modal>
  );
}
