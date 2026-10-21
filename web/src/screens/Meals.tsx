import { useState } from "react";
import { api } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { Meal, Recipe, Slot } from "../types";
import { Modal, useIsPhone } from "../components/ui";
import { Icon } from "../components/Icons";
import { PlanRecipe, RecipeEditor, RecipeImport, RecipeSearch, RecipeThumb, openRecipe, recipeTitle } from "../components/Recipes";
import { LibraryBrowser } from "../components/LibraryBrowser";
import { useNavParam } from "../nav";
import { CATS, catName } from "../categories";
import { PhotoPicker } from "../components/PhotoPicker";
import { DSHORT, MSHORT, addDays, startOfWeek, todayIso, weekday } from "../dates";
import { t as tr } from "../i18n";

const SLOTS: Slot[] = ["ontbijt", "lunch", "diner"];
const SLOT_NAME: Record<string, string> = { ontbijt: "Ontbijt", lunch: "Lunch", diner: "Avondeten", snack: "Tussendoor" };
type Tab = "week" | "recipes";

export function MealsScreen({ header }: { header: React.ReactNode }) {
  const [tab, setTab] = useState<Tab>(() => (sessionStorage.getItem("gb.meals") as Tab) || "week");
  useNavParam("meals", (v) => go(v as Tab));
  const go = (t: Tab) => { setTab(t); try { sessionStorage.setItem("gb.meals", t); } catch { /* */ } };
  return (
    <>
      <div className="topbar">
        {header}
        <div className="right">
          <div className="seg" role="tablist" aria-label={tr("Maaltijden")}>
            <button aria-pressed={tab === "week"} onClick={() => go("week")} style={{ padding: tr("0 14px") }}>{tr("Weekmenu")}</button>
            <button aria-pressed={tab === "recipes"} onClick={() => go("recipes")} style={{ padding: tr("0 14px") }}>{tr("Recepten")}</button>
          </div>
        </div>
      </div>
      {tab === "week" ? <WeekMenu /> : <Library />}
    </>
  );
}

function WeekMenu() {
  const { data, toast } = useData();
  const act = useAction();
  const [start, setStart] = useState(() => startOfWeek(todayIso(), Number(data?.settings.week_start ?? 1)));
  const end = addDays(start, 6);
  const [meals] = useRemote<Meal[]>(`/meals?from=${start}&to=${end}`, ["meals", "recipes"], []);
  const [slot, setSlot] = useState<{ date: string; slot: Slot } | null>(null);
  const t = todayIso();
  const phone = useIsPhone();
  const [dayPick, setDayPick] = useState<string | null>(null);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const shownDay = weekDays.includes(dayPick ?? "") ? dayPick! : weekDays.includes(t) ? t : weekDays[0];
  const recipe = (id: string | null) => (id ? data?.recipes.find((r) => r.id === id) : undefined);

  return (
    <div className="page-scroll" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="weeknav">
        <button className="iconbtn" onClick={() => setStart(addDays(start, -7))} aria-label={tr("Vorige week")}><Icon.left /></button>
        <span className="range">{Number(start.slice(8))} {MSHORT[Number(start.slice(5, 7)) - 1]} – {Number(end.slice(8))} {MSHORT[Number(end.slice(5, 7)) - 1]}</span>
        <button className="iconbtn" onClick={() => setStart(addDays(start, 7))} aria-label={tr("Volgende week")}><Icon.right /></button>
        <button className="pill" title={tr("Lege avonden krijgen een recept uit je bibliotheek")} onClick={async () => {
          const r = await act(() => api.post<{ planned: { date: string }[]; left: number }>("/meals/autoplan", { from: start, days: 7, slot: "diner" }));
          if (r) toast(r.planned.length ? `${tr("{n} avondmalen ingepland", { n: r.planned.length })}${r.left ? ` · ${tr("{n} nog leeg: voeg recepten toe aan je bibliotheek", { n: r.left })}` : ""}` : r.left ? tr("Geen recepten in je bibliotheek om in te plannen") : tr("Alle avonden waren al ingevuld"));
        }}>{tr("✨ Week vullen")}</button>
        <button className="pill" title={tr("Alle ingrediënten van de ingeplande recepten op de boodschappenlijst")} onClick={async () => {
          const r = await act(() => api.post<{ added: number; recipes: number; list: string }>("/meals/week-to-list", { from: start, to: end }));
          if (r) toast(r.recipes ? (r.added ? tr("{a} ingrediënten van {r} recepten op {l}", { a: r.added, r: r.recipes, l: r.list }) : tr("Alles stond al op de lijst")) : tr("Geen recepten ingepland deze week"));
        }}>{tr("🛒 Boodschappen voor de week")}</button>
        <button className="iconbtn" aria-label={tr("Weekmenu delen")} title={tr("Weekmenu delen (WhatsApp, sms…)")} onClick={async () => {
          const lines = Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((d) => {
            const ms = SLOTS.map((s) => meals.find((x) => x.date === d && x.slot === s)).filter((m): m is Meal => !!m && !!m.title);
            return `${DSHORT[weekday(d)]} ${Number(d.slice(8))}: ${ms.length ? ms.map((m) => `${m.slot}: ${m.title}`).join(" · ") : "—"}`;
          });
          const text = `${tr("Weekmenu")} ${Number(start.slice(8))} ${MSHORT[Number(start.slice(5, 7)) - 1]} – ${Number(end.slice(8))} ${MSHORT[Number(end.slice(5, 7)) - 1]}\n${lines.join("\n")}`;
          try { if (navigator.share) await navigator.share({ title: "Weekmenu", text }); else { await navigator.clipboard.writeText(text); toast(tr("Weekmenu gekopieerd")); } } catch { /* geannuleerd */ }
        }}>↗</button>
      </div>
      {phone && <div className="picks day-picks">{weekDays.map((d) => <button type="button" key={d} className={`pick${d === t ? " today" : ""}`} aria-pressed={d === shownDay} onClick={() => setDayPick(d)}>{DSHORT[weekday(d)]} {Number(d.slice(8))}</button>)}</div>}
      <div className="mealgrid-wrap">
        <div className={`mealgrid${phone ? " one" : ""}`}>
          {!phone && <div className="mg-head"><span /> {SLOTS.map((s) => <span key={s} className="mg-slot">{tr(SLOT_NAME[s])}</span>)}</div>}
          {(phone ? [shownDay] : weekDays).map((d) => (
            <div className={`mg-row${d === t ? " today" : ""}`} key={d}>
              <div className="mg-day"><b className="num">{Number(d.slice(8))}</b><span>{DSHORT[weekday(d)]}</span>{d === t && <small>{tr("vandaag")}</small>}</div>
              {SLOTS.map((s) => {
                const m = meals.find((x) => x.date === d && x.slot === s);
                const r = recipe(m?.recipeId ?? null);
                const title = (r ? recipeTitle(r) : m?.title) ?? "";
                return (
                  <button key={s} className={`mtile${m ? " filled" : ""}${m?.image ? " has-img" : ""}`} title={title || tr(SLOT_NAME[s])} aria-label={`${tr(SLOT_NAME[s])}: ${title || tr("+ toevoegen")}`}
                    onClick={() => (r ? openRecipe(r.id) : setSlot({ date: d, slot: s }))} onContextMenu={(e) => { e.preventDefault(); setSlot({ date: d, slot: s }); }}>
                    {m?.image ? <img src={m.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { const tile = e.currentTarget.parentElement; e.currentTarget.remove(); if (tile) { tile.classList.remove("has-img"); const ph = document.createElement("span"); ph.className = "mtile-ph"; ph.textContent = "🍲"; tile.prepend(ph); } }} /> : m ? <span className="mtile-ph">🍲</span> : <span className="mtile-plus">+</span>}
                    {phone && <small className="mtile-slot">{tr(SLOT_NAME[s])}</small>}
                    {m && <span className="mtile-title">{title}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="hint">{tr("Tik op een gerecht met recept om het te openen. Lang indrukken om het te wijzigen.")}</p>
      {slot && <SlotEditor {...slot} current={meals.find((m) => m.date === slot.date && m.slot === slot.slot)} onClose={() => setSlot(null)} />}
    </div>
  );
}

function SlotEditor({ date, slot, current, onClose }: { date: string; slot: Slot; current?: Meal; onClose: () => void }) {
  const { data } = useData();
  const act = useAction();
  const [title, setTitle] = useState(current?.title ?? "");
  const [q, setQ] = useState("");
  const [photo, setPhoto] = useState(false);
  const save = async (t: string, recipeId: string | null = null) => {
    if (await act(() => api.put("/meals", { date, slot, title: t, recipeId }), t ? tr("Maaltijd gepland") : tr("Maaltijd gewist"))) onClose();
  };
  const recipes = (data?.recipes ?? []).filter((r) => !q || r.title.toLocaleLowerCase("tr").includes(q.toLocaleLowerCase("tr")));
  return (
    <Modal title={`${slot[0].toUpperCase()}${slot.slice(1)} · ${DSHORT[weekday(date)]} ${Number(date.slice(8))} ${MSHORT[Number(date.slice(5, 7)) - 1]}`} onClose={onClose}>
      {current && (
        <div className="slot-photo">
          {current.image ? <img src={current.image} alt="" referrerPolicy="no-referrer" /> : <span className="rthumb ph" style={{ width: 72, height: 72 }}>🍲</span>}
          <button className="btn ghost small" onClick={() => setPhoto(true)}>📷 {current.image ? tr("Andere foto") : tr("Foto kiezen")}</button>
          {current.recipeId && <button className="btn ghost small" onClick={() => { onClose(); openRecipe(current.recipeId!); }}>{tr("Recept openen")}</button>}
        </div>
      )}
      <label className="field"><span>Wat eten we?</span><input id="meal-title" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && title.trim() && save(title.trim())} placeholder={tr("bv. Stoofvlees met frietjes")} /></label>
      {!!data?.recipes.length && (
        <div className="field"><span>{tr("Of kies uit je receptenbibliotheek")}</span>
          <input id="meal-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Zoek een recept")} aria-label={tr("Zoek een recept")} />
          <div className="rpick">
            {recipes.slice(0, 30).map((r) => (
              <button key={r.id} className={`rpick-item${current?.recipeId === r.id ? " on" : ""}`} onClick={() => save(r.title, r.id)}>
                <RecipeThumb r={r} size={44} /><span>{r.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="actions">
        {current && <button className="btn danger left" onClick={() => save("")}>{tr("Wissen")}</button>}
        <button className="btn ghost" onClick={onClose}>{tr("Annuleren")}</button>
        <button className="btn" onClick={() => save(title.trim())} disabled={!title.trim()}>{tr("Bewaren")}</button>
      </div>
      {photo && current && <PhotoPicker title={current.title} current={current.image}
        onPick={(image) => act(() => (current.recipeId ? api.put(`/recipes/${current.recipeId}/image`, { image }) : api.put("/meals/image", { date, slot, image })), image ? tr("Foto bewaard") : tr("Foto weggehaald"))}
        onClose={() => setPhoto(false)} />}
    </Modal>
  );
}

function Library() {
  const { data } = useData();
  const act = useAction();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string | null>(null); // "fav" | "often" | categorie
  const [modal, setModal] = useState<"search" | "import" | "new" | null>(null);
  const [planFor, setPlanFor] = useState<Recipe | null>(null);
  const wk = startOfWeek(todayIso(), Number(data?.settings.week_start ?? 1));
  const [weekMeals] = useRemote<Meal[]>(`/meals?from=${wk}&to=${addDays(wk, 6)}`, ["meals"], []);
  const plannedIds = new Set(weekMeals.map((m) => m.recipeId).filter((x): x is string => !!x));
  const [view, setView] = useState<"mine" | "all">(() => { try { if (sessionStorage.getItem("gb.lib") !== null) return "all"; } catch { /* */ } return (data?.recipes.length ?? 0) ? "mine" : "all"; });
  useNavParam("lib", () => setView("all"));
  const recipes = data?.recipes ?? [];
  const cats = [...new Set(recipes.map((r) => r.category).filter(Boolean))];
  const hasFav = recipes.some((r) => r.favorite), hasOften = recipes.some((r) => r.cooked >= 2);
  const shown = recipes.filter((r) =>
    (!filter || (filter === "fav" ? r.favorite : filter === "often" ? r.cooked >= 2 : filter === "planned" ? plannedIds.has(r.id) : r.category === filter)) &&
    (!q || `${r.title}\n${r.ingredients}`.toLocaleLowerCase("tr").includes(q.toLocaleLowerCase("tr"))))
    .sort((a, b) => (filter === "often" ? b.cooked - a.cooked : Number(b.favorite) - Number(a.favorite) || a.title.localeCompare(b.title)));
  return (
    <div className="page-scroll" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="seg lib" role="tablist" aria-label={tr("Bibliotheek")}>
        <button role="tab" aria-pressed={view === "mine"} onClick={() => setView("mine")}>Mijn recepten{recipes.length ? ` (${recipes.length})` : ""}</button>
        <button role="tab" aria-pressed={view === "all"} onClick={() => setView("all")}>{tr("🇹🇷 Alle Turkse recepten")}</button>
      </div>
      {view === "all" ? <LibraryBrowser /> : <>
      <div className="libbox">
        <nav className="libnav" aria-label={tr("Categorieën")}>
          {hasOften && <button className={filter === "often" ? "on" : ""} onClick={() => setFilter("often")}><span className="libnav-ic">🕒</span><span>{tr("Vaak gekozen")}</span></button>}
          <button className={!filter ? "on" : ""} onClick={() => setFilter(null)}><span className="libnav-ic">🍽️</span><span>{tr("Alles")}</span><small>{recipes.length}</small></button>
          <button className={filter === "planned" ? "on" : ""} onClick={() => setFilter("planned")}><span className="libnav-ic">📅</span><span>{tr("Mijn maaltijden")}</span>{plannedIds.size > 0 && <small>{plannedIds.size}</small>}</button>
          {hasFav && <button className={filter === "fav" ? "on" : ""} onClick={() => setFilter("fav")}><span className="libnav-ic">♡</span><span>{tr("Lievelingen")}</span></button>}
          {cats.map((c) => <button key={c} className={filter === c ? "on" : ""} onClick={() => setFilter(c)}><span className="libnav-ic">{CATS[c]?.icon ?? "🍲"}</span><span>{catName(c)}</span><small>{recipes.filter((r) => r.category === c).length}</small></button>)}
        </nav>
        <div className="libmain">
          <div className="addrow libsearch">
            <Icon.search />
            <input id="lib-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Zoek recepten…")} aria-label={tr("Zoek in de bibliotheek")} />
          </div>
          <div className="lib-actions">
            <button className="btn ghost" onClick={() => setModal("import")}>🔗 {tr("Recept importeren")}</button>
            <button className="btn" onClick={() => setModal("new")}>+ {tr("Recept maken")}</button>
            <button className="btn ghost" onClick={() => setModal("search")}>🇹🇷 {tr("Turkse recepten zoeken")}</button>
            {recipes.some((r) => !r.image) && <button className="btn ghost small" onClick={() => act(() => api.post("/dish-photos/fill"), tr("Foto's worden gezocht…"))}>📷 {tr("Foto's zoeken")}</button>}
          </div>
          <div className="rlist">
            {shown.map((r) => (
              <div key={r.id} className="rrow">
                <button className="rrow-main" onClick={() => openRecipe(r.id)}>
                  <RecipeThumb r={r} size={64} />
                  <span className="rrow-txt"><b>{r.favorite ? "★ " : ""}{recipeTitle(r)}</b><small>{[r.minutes ? `${r.minutes} min` : null, r.category ? catName(r.category) : null, r.cooked ? tr("{n}× gekookt", { n: r.cooked }) : null, plannedIds.has(r.id) ? tr("deze week gepland") : null].filter(Boolean).join(" · ")}</small></span>
                </button>
                <button className="iconbtn rrow-plus" aria-label={tr("Inplannen")} title={tr("Inplannen")} onClick={() => setPlanFor(r)}>+</button>
              </div>
            ))}
          </div>
          {planFor && <PlanRecipe recipe={planFor} onClose={() => setPlanFor(null)} />}
        </div>
      </div>
      {recipes.length > 0 && !shown.length && <p className="empty">Geen recepten gevonden voor “{q}”.</p>}
      </>}
      {modal === "search" && <RecipeSearch onClose={() => setModal(null)} />}
      {modal === "import" && <RecipeImport onClose={() => setModal(null)} />}
      {modal === "new" && <RecipeEditor onClose={() => setModal(null)} />}
    </div>
  );
}
