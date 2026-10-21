import { useEffect, useState } from "react";
import { useData, useRemote } from "../store";
import type { Meal, Occurrence, Weather } from "../types";
import { DayView } from "../components/CalendarViews";
import { ChoreTracker } from "../components/ChoreTracker";
import type { EditorState } from "../components/EventEditor";
import { RecipeThumb, openRecipe, recipeTitle } from "../components/Recipes";
import { Icon } from "../components/Icons";
import { addDays, cap, clock, greeting, longDate, todayIso } from "../dates";
import type { PrayerDay } from "../types";
import { PRAYER_ICON, PRAYER_NAME, hm, nextPrayer } from "../islam";
import { PrikbordWidget } from "../components/Prikbord";
import { BriefingCard, BriefingModal } from "../components/Briefing";
import { FamilyWidget } from "../components/Family";
import { ConnectorWidgets } from "../components/Connectors";
import { HomeWidget } from "../components/Home";
import { t as tr } from "../i18n";

const SLOT_LABEL: Record<string, string> = { ontbijt: "Ontbijt", lunch: "Lunch", diner: "Avondeten", snack: "Tussendoor" };
const SLOT_ICON: Record<string, string> = { ontbijt: "🥣", lunch: "🥪", diner: "🍽️", snack: "🍎" };

/** Voorbeeldvragen met de echte namen uit dit gezin. */
export function useSuggestions() {
  const { data } = useData();
  const members = data?.members ?? [];
  const kid = members.find((m) => m.role === "kind") ?? members[0];
  const who = kid ? ` ${tr("voor {n}", { n: kid.name })}` : "";
  return [
    tr("🗓️ Wat staat er vandaag op de planning?"),
    tr("🍲 Wat kook ik vanavond?"),
    `${tr("📅 Zet zwemles op dinsdag om 17u")}${who}`,
    tr("🎉 Wat kunnen we dit weekend doen?"),
    tr("🛒 Zet melk en eieren op de boodschappenlijst"),
    tr("✅ Wie heeft nog taken open?"),
  ];
}

function useClock() {
  const [t, setT] = useState(clock());
  useEffect(() => { const i = setInterval(() => setT(clock()), 15_000); return () => clearInterval(i); }, []);
  return t;
}

/** Het Bord: het startscherm voor het scherm in de keuken — assistent bovenaan, de dag per gezinslid in het midden, eten en taken onderaan. */
export function TodayScreen({ openEditor, openAssistant, goto, openSearch, online }: {
  openEditor: (s: EditorState) => void; openAssistant: (prompt?: string) => void; goto: (s: "meals" | "chores" | "apps") => void; openSearch: () => void; online: boolean;
}) {
  const { data, hidden } = useData();
  const t = todayIso();
  const time = useClock();
  const suggestions = useSuggestions();
  const [events] = useRemote<Occurrence[]>(`/events?from=${t}&to=${addDays(t, 1)}`, ["events", "members"], []);
  const [meals] = useRemote<Meal[]>(`/meals?from=${t}&to=${t}`, ["meals"], []);
  const [weather] = useRemote<Weather | null>("/weather", ["settings"], null);
  const ezanOn = data?.settings.ezan_on === "1";
  const [prayerDay] = useRemote<PrayerDay | null>(ezanOn ? "/prayer" : null, ["settings"], null);
  const nxt = ezanOn ? nextPrayer(prayerDay) : null;
  const visible = events.filter((e) => !e.members.length || e.members.some((m) => !hidden.has(m)));
  const hour = new Date().getHours();
  const mealOrder: ("ontbijt" | "lunch" | "diner")[] = hour < 10 ? ["ontbijt", "lunch", "diner"] : hour < 14 ? ["lunch", "diner", "ontbijt"] : ["diner", "lunch", "ontbijt"];
  const mealTitle = hour < 10 ? tr("Vandaag eten") : hour < 14 ? tr("Straks eten") : tr("Vanavond eten");
  const [briefOpen, setBriefOpen] = useState(false);

  return (
    <div className="bord">
      <div className="bord-top">
        <div className="bord-greet">
          <button className="drop-btn" onClick={() => openAssistant()} aria-label={tr("Assistent openen")}><span className="drop" aria-hidden /></button>
          <button className="bubble glass bord-bubble" onClick={() => openAssistant()}>
            {greeting()}{data?.settings.family_name ? `, ${data.settings.family_name}` : ""}! {tr("Waarmee kan ik vandaag helpen?")}
          </button>
        </div>
        <div className="bord-meta">
          <span className="bord-time num">{time}</span>
          <span className="bord-date">{cap(longDate(t))}{!online && <span className="offline" style={{ marginLeft: 8 }}>{tr("Offline")}</span>}</span>
          {weather && <span className="bord-wx num" title={`${weather.city}: ${weather.current.label}`}>{weather.current.icon} {weather.current.temp}° <small>↑{weather.days[0]?.max}° ↓{weather.days[0]?.min}°</small></span>}
          {nxt && <span className="bord-wx num" title={tr("Volgend gebed")}>{PRAYER_ICON[nxt.prayer]} {PRAYER_NAME[nxt.prayer]} <small>{hm(new Date(nxt.at).toISOString())}</small></span>}
          <button className="iconbtn glass" onClick={openSearch} aria-label={tr("Zoeken in alles")}><Icon.search /></button>
        </div>
      </div>
      <div className="suggest bord-suggest">
        {suggestions.slice(0, 4).map((s) => <button key={s} className="glass" onClick={() => openAssistant(s)}>{s}</button>)}
      </div>
      <section className="glass bord-cal board">
        <DayView date={t} events={visible} compact onOpen={(o) => openEditor({ occ: o })}
          onSlot={(date, startTime, m) => openEditor({ defaults: { date, startTime, members: m ? [m] : [] } })} />
      </section>
      <div className="bord-widgets">
        <BriefingCard memberId={null} compact onOpen={() => setBriefOpen(true)} />
        <section className="glass widget-sm">
          <div className="widget-h"><h2>{mealTitle}</h2><button className="linkbtn" onClick={() => goto("meals")}>{tr("Plannen")}</button></div>
          <div className="mealstrip">
            {mealOrder.map((slot, i) => {
              const m = meals.find((x) => x.slot === slot);
              const r = m?.recipeId ? data?.recipes.find((x) => x.id === m.recipeId) : undefined;
              const open = () => (r ? openRecipe(r.id) : goto("meals"));
              return (
                <button className={`mealtile${i === 0 ? tr(" main") : ""}${m ? "" : tr(" empty")}`} key={slot} onClick={open}>
                  {m?.image || r ? <RecipeThumb r={{ image: m!.image, title: m!.title }} size={i === 0 ? 64 : 48} /> : <span className="mealtile-ic" aria-hidden>{SLOT_ICON[slot]}</span>}
                  <span className="mealtile-txt"><small>{tr(SLOT_LABEL[slot])}</small><b>{(r ? recipeTitle(r) : m?.title) ?? tr("Nog niets")}</b></span>
                </button>
              );
            })}
          </div>
        </section>
        <section className="glass widget-sm">
          <div className="widget-h"><h2>{tr("Taken vandaag")}</h2><button className="linkbtn" onClick={() => goto("chores")}>{tr("Alles")}</button></div>
          <ChoreTracker date={t} grouped={false} compact />
        </section>
        <PrikbordWidget max={3} />
        <HomeWidget onOpen={() => { try { sessionStorage.setItem("gb.app", "home"); } catch { /* */ } goto("apps"); }} />
        <FamilyWidget />
        <ConnectorWidgets board />
        {!!data?.countdowns.length && (
          <section className="glass widget-sm">
            <div className="widget-h"><h2>{tr("Aftellen")}</h2></div>
            <div className="cdstrip">
              {data.countdowns.slice(0, 4).map((c) => {
                const m = c.memberId ? data.members.find((x) => x.id === c.memberId) : null;
                return (
                  <div className="cd-sm" key={c.kind + c.title + c.date} style={{ "--c": m?.color ?? "var(--accent)" } as React.CSSProperties}>
                    <span className="cd-ic" aria-hidden>{c.icon}</span>
                    <span><b className="num">{c.days === 0 ? tr("Vandaag!") : c.days === 1 ? tr("Morgen") : `${c.days} ${tr("dagen")}`}</b><small>{c.title}</small></span>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
      {briefOpen && <BriefingModal onClose={() => setBriefOpen(false)} />}
    </div>
  );
}
