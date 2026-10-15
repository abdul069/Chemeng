import { useData, useRemote } from "../store";
import type { Meal, Occurrence, Weather } from "../types";
import { DayView, EventRow } from "../components/CalendarViews";
import { ChoreTracker } from "../components/ChoreTracker";
import type { EditorState } from "../components/EventEditor";
import { addDays, greeting, nowMin, toMin, todayIso } from "../dates";

const SLOT_ICON: Record<string, string> = { ontbijt: "🌅", lunch: "☀️", diner: "🌙", snack: "🍎" };

export const SUGGESTIONS = [
  "Wat staat er vandaag op de planning?",
  "Wat eten we deze week?",
  "Zet zwemles op dinsdag om 17u voor Lina",
  "Wat kunnen we dit weekend doen?",
  "Zet melk en eieren op de boodschappenlijst",
  "Wie heeft nog taken open?",
];

export function TodayScreen({ openEditor, openAssistant, goto, header }: {
  openEditor: (s: EditorState) => void; openAssistant: (prompt?: string) => void; goto: (s: "meals" | "chores") => void; header: React.ReactNode;
}) {
  const { data, hidden } = useData();
  const t = todayIso();
  const [events] = useRemote<Occurrence[]>(`/events?from=${t}&to=${addDays(t, 1)}`, ["events", "members"], []);
  const [meals] = useRemote<Meal[]>(`/meals?from=${t}&to=${t}`, ["meals"], []);
  const [weather] = useRemote<Weather | null>("/weather", ["settings"], null);
  const visible = events.filter((e) => !e.members.length || e.members.some((m) => !hidden.has(m)));
  const now = nowMin();
  const upcoming = visible
    .filter((e) => (e.on === t && (e.allDay || toMin(e.endTime) >= now)) || e.on > t)
    .slice(0, 4);

  return (
    <>
      <div className="topbar">{header}</div>
      <div className="hub">
        <section className="hub-hero">
          <div className="greet">
            <button className="mascot-btn" onClick={() => openAssistant()} aria-label="Assistent openen"><div className="mascot" /></button>
            <div className="bubble">{greeting()}{data?.settings.family_name ? `, ${data.settings.family_name}` : ""}! Waarmee kan ik het gezin vandaag helpen?</div>
          </div>
          {weather && (
            <div className="weather-now" title={`${weather.city}: ${weather.current.label}`}>
              <span style={{ fontSize: 38 }}>{weather.current.icon}</span>
              <span>
                <span className="t">{weather.current.temp}°</span>
                <small className="muted" style={{ display: "block" }}>↑{weather.days[0]?.max}° ↓{weather.days[0]?.min}° · {weather.city}</small>
              </span>
            </div>
          )}
          <div className="suggest">
            {SUGGESTIONS.slice(0, 4).map((s) => <button key={s} onClick={() => openAssistant(s)}>{s}</button>)}
          </div>
        </section>
        <section className="card hub-main board">
          <DayView date={t} events={visible} compact onOpen={(o) => openEditor({ occ: o })}
            onSlot={(date, startTime, m) => openEditor({ defaults: { date, startTime, members: m ? [m] : [] } })} />
        </section>
        <aside className="hub-side">
          <section className="card card-pad">
            <div className="section-title"><h2>Straks</h2></div>
            {upcoming.length ? <div className="upnext">{upcoming.map((e) => <EventRow key={e.key} e={e} onOpen={(o) => openEditor({ occ: o })} />)}</div> : <p className="empty">Niets meer gepland. Tijd voor jezelf.</p>}
          </section>
          <section className="card card-pad">
            <div className="section-title"><h2>Maaltijden vandaag</h2><button className="linkbtn" onClick={() => goto("meals")}>Plannen</button></div>
            {(["ontbijt", "lunch", "diner"] as const).map((slot) => {
              const m = meals.find((x) => x.slot === slot);
              return (
                <div className="meal-row" key={slot}>
                  <span className="ic" aria-hidden>{SLOT_ICON[slot]}</span>
                  <span><small>{slot}</small>{m?.title ?? <span className="muted">Nog niets gepland</span>}</span>
                </div>
              );
            })}
          </section>
          <section className="card card-pad">
            <div className="section-title"><h2>Taken vandaag</h2><button className="linkbtn" onClick={() => goto("chores")}>Alles</button></div>
            <ChoreTracker date={t} />
          </section>
        </aside>
      </div>
    </>
  );
}
