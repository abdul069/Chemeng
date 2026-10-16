import { useState } from "react";
import { api } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { Meal, Slot } from "../types";
import { Modal } from "../components/ui";
import { Icon } from "../components/Icons";
import { RecipeCard, RecipeEditor, RecipeImport, RecipeSearch, RecipeThumb, openRecipe } from "../components/Recipes";
import { LibraryBrowser } from "../components/LibraryBrowser";
import { useNavParam } from "../nav";
import { CATS } from "../categories";
import { PhotoPicker } from "../components/PhotoPicker";
import { DSHORT, MSHORT, addDays, startOfWeek, todayIso, weekday } from "../dates";

const SLOTS: Slot[] = ["ontbijt", "lunch", "diner"];
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
          <div className="seg" role="tablist" aria-label="Maaltijden">
            <button aria-pressed={tab === "week"} onClick={() => go("week")} style={{ padding: "0 14px" }}>Weekmenu</button>
            <button aria-pressed={tab === "recipes"} onClick={() => go("recipes")} style={{ padding: "0 14px" }}>Recepten</button>
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
  const recipe = (id: string | null) => (id ? data?.recipes.find((r) => r.id === id) : undefined);

  return (
    <div className="page-scroll" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="weeknav">
        <button className="iconbtn" onClick={() => setStart(addDays(start, -7))} aria-label="Vorige week"><Icon.left /></button>
        <span className="range">{Number(start.slice(8))} {MSHORT[Number(start.slice(5, 7)) - 1]} – {Number(end.slice(8))} {MSHORT[Number(end.slice(5, 7)) - 1]}</span>
        <button className="iconbtn" onClick={() => setStart(addDays(start, 7))} aria-label="Volgende week"><Icon.right /></button>
        <button className="pill" title="Lege avonden krijgen een recept uit je bibliotheek" onClick={async () => {
          const r = await act(() => api.post<{ planned: { date: string }[]; left: number }>("/meals/autoplan", { from: start, days: 7, slot: "diner" }));
          if (r) toast(r.planned.length ? `${r.planned.length} avondmalen ingepland${r.left ? ` · ${r.left} nog leeg: voeg recepten toe aan je bibliotheek` : ""}` : r.left ? "Geen recepten in je bibliotheek om in te plannen" : "Alle avonden waren al ingevuld");
        }}>✨ Week vullen</button>
        <button className="pill" title="Alle ingrediënten van de ingeplande recepten op de boodschappenlijst" onClick={async () => {
          const r = await act(() => api.post<{ added: number; recipes: number; list: string }>("/meals/week-to-list", { from: start, to: end }));
          if (r) toast(r.recipes ? (r.added ? `${r.added} ingrediënten van ${r.recipes} recepten op ${r.list}` : "Alles stond al op de lijst") : "Geen recepten ingepland deze week");
        }}>🛒 Boodschappen voor de week</button>
        <button className="iconbtn" aria-label="Weekmenu delen" title="Weekmenu delen (WhatsApp, sms…)" onClick={async () => {
          const lines = Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((d) => {
            const ms = SLOTS.map((s) => meals.find((x) => x.date === d && x.slot === s)).filter((m): m is Meal => !!m && !!m.title);
            return `${DSHORT[weekday(d)]} ${Number(d.slice(8))}: ${ms.length ? ms.map((m) => `${m.slot}: ${m.title}`).join(" · ") : "—"}`;
          });
          const text = `Weekmenu ${Number(start.slice(8))} ${MSHORT[Number(start.slice(5, 7)) - 1]} – ${Number(end.slice(8))} ${MSHORT[Number(end.slice(5, 7)) - 1]}\n${lines.join("\n")}`;
          try { if (navigator.share) await navigator.share({ title: "Weekmenu", text }); else { await navigator.clipboard.writeText(text); toast("Weekmenu gekopieerd"); } } catch { /* geannuleerd */ }
        }}>↗</button>
      </div>
      <div style={{ overflowX: "auto", paddingBottom: 6 }}>
        <div className="mealweek">
          {Array.from({ length: 7 }, (_, i) => {
            const d = addDays(start, i);
            return (
              <section className={`mealday${d === t ? " today" : ""}`} key={d}>
                <h3>{DSHORT[weekday(d)]} {Number(d.slice(8))}{d === t ? " · vandaag" : ""}</h3>
                {SLOTS.map((s) => {
                  const m = meals.find((x) => x.date === d && x.slot === s);
                  const r = recipe(m?.recipeId ?? null);
                  return (
                    <button key={s} className={`slot${m ? " filled" : ""}${m?.image ? " has-img" : ""}`} onClick={() => (r ? openRecipe(r.id) : setSlot({ date: d, slot: s }))}
                      onContextMenu={(e) => { e.preventDefault(); setSlot({ date: d, slot: s }); }}>
                      {m?.image && <img className="slot-img" src={m.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                      <span className="slot-txt"><small>{s}{r ? " · recept" : ""}</small>{m?.title ?? <span className="muted">+ toevoegen</span>}</span>
                    </button>
                  );
                })}
              </section>
            );
          })}
        </div>
      </div>
      <p className="hint">Tik op een gerecht met recept om het te openen. Lang indrukken om het te wijzigen.</p>
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
    if (await act(() => api.put("/meals", { date, slot, title: t, recipeId }), t ? "Maaltijd gepland" : "Maaltijd gewist")) onClose();
  };
  const recipes = (data?.recipes ?? []).filter((r) => !q || r.title.toLocaleLowerCase("tr").includes(q.toLocaleLowerCase("tr")));
  return (
    <Modal title={`${slot[0].toUpperCase()}${slot.slice(1)} · ${DSHORT[weekday(date)]} ${Number(date.slice(8))} ${MSHORT[Number(date.slice(5, 7)) - 1]}`} onClose={onClose}>
      {current && (
        <div className="slot-photo">
          {current.image ? <img src={current.image} alt="" referrerPolicy="no-referrer" /> : <span className="rthumb ph" style={{ width: 72, height: 72 }}>🍲</span>}
          <button className="btn ghost small" onClick={() => setPhoto(true)}>📷 {current.image ? "Andere foto" : "Foto kiezen"}</button>
          {current.recipeId && <button className="btn ghost small" onClick={() => { onClose(); openRecipe(current.recipeId!); }}>Recept openen</button>}
        </div>
      )}
      <label className="field"><span>Wat eten we?</span><input id="meal-title" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && title.trim() && save(title.trim())} placeholder="bv. Stoofvlees met frietjes" /></label>
      {!!data?.recipes.length && (
        <div className="field"><span>Of kies uit je receptenbibliotheek</span>
          <input id="meal-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek een recept" aria-label="Zoek een recept" />
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
        {current && <button className="btn danger left" onClick={() => save("")}>Wissen</button>}
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button className="btn" onClick={() => save(title.trim())} disabled={!title.trim()}>Bewaren</button>
      </div>
      {photo && current && <PhotoPicker title={current.title} current={current.image}
        onPick={(image) => act(() => (current.recipeId ? api.put(`/recipes/${current.recipeId}/image`, { image }) : api.put("/meals/image", { date, slot, image })), image ? "Foto bewaard" : "Foto weggehaald")}
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
  const [view, setView] = useState<"mine" | "all">(() => { try { if (sessionStorage.getItem("gb.lib") !== null) return "all"; } catch { /* */ } return (data?.recipes.length ?? 0) ? "mine" : "all"; });
  useNavParam("lib", () => setView("all"));
  const recipes = data?.recipes ?? [];
  const cats = [...new Set(recipes.map((r) => r.category).filter(Boolean))];
  const hasFav = recipes.some((r) => r.favorite), hasOften = recipes.some((r) => r.cooked >= 2);
  const shown = recipes.filter((r) =>
    (!filter || (filter === "fav" ? r.favorite : filter === "often" ? r.cooked >= 2 : r.category === filter)) &&
    (!q || `${r.title}\n${r.ingredients}`.toLocaleLowerCase("tr").includes(q.toLocaleLowerCase("tr"))))
    .sort((a, b) => (filter === "often" ? b.cooked - a.cooked : Number(b.favorite) - Number(a.favorite) || a.title.localeCompare(b.title)));
  return (
    <div className="page-scroll" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="seg lib" role="tablist" aria-label="Bibliotheek">
        <button role="tab" aria-pressed={view === "mine"} onClick={() => setView("mine")}>Mijn recepten{recipes.length ? ` (${recipes.length})` : ""}</button>
        <button role="tab" aria-pressed={view === "all"} onClick={() => setView("all")}>🇹🇷 Alle Turkse recepten</button>
      </div>
      {view === "all" ? <LibraryBrowser /> : <>
      <div className="lib-actions">
        <button className="btn accent" onClick={() => setModal("search")}>🔎 Turkse recepten zoeken</button>
        <button className="btn ghost" onClick={() => setModal("import")}>🔗 Via link toevoegen</button>
        <button className="btn ghost" onClick={() => setModal("new")}>✍️ Eigen recept</button>
        {recipes.some((r) => !r.image) && <button className="btn ghost" onClick={() => act(() => api.post("/dish-photos/fill"), "Foto's worden gezocht…")}>📷 Ontbrekende foto's zoeken</button>}
      </div>
      <div className="addrow">
        <input id="lib-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Zoek in je ${recipes.length} recepten, ook op ingrediënt`} aria-label="Zoek in de bibliotheek" />
      </div>
      {(hasFav || hasOften || cats.length > 0) && (
        <div className="picks catrow">
          <button className="pick" aria-pressed={!filter} onClick={() => setFilter(null)}>Alles <small className="muted">{recipes.length}</small></button>
          {hasFav && <button className="pick" aria-pressed={filter === "fav"} onClick={() => setFilter("fav")}>★ Favorieten</button>}
          {hasOften && <button className="pick" aria-pressed={filter === "often"} onClick={() => setFilter("often")}>🔥 Vaak gekookt</button>}
          {cats.map((c) => <button key={c} className="pick" aria-pressed={filter === c} onClick={() => setFilter(c)}>{CATS[c]?.icon} {CATS[c]?.name ?? c} <small className="muted">{recipes.filter((r) => r.category === c).length}</small></button>)}
        </div>
      )}
      <div className="rgrid">{shown.map((r) => <RecipeCard key={r.id} r={r} onOpen={() => openRecipe(r.id)} />)}</div>
      {!recipes.length && <p className="empty">Je eigen bibliotheek is nog leeg. Blader door <button className="linkbtn" onClick={() => setView("all")}>alle Turkse recepten</button> of plak de link van een recept dat je lekker vindt.</p>}
      {recipes.length > 0 && !shown.length && <p className="empty">Geen recepten gevonden voor “{q}”.</p>}
      </>}
      {modal === "search" && <RecipeSearch onClose={() => setModal(null)} />}
      {modal === "import" && <RecipeImport onClose={() => setModal(null)} />}
      {modal === "new" && <RecipeEditor onClose={() => setModal(null)} />}
    </div>
  );
}
