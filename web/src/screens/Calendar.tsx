import { useState } from "react";
import { useData, useRemote } from "../store";
import type { Occurrence, Weather } from "../types";
import { AgendaView, DayView, EventRow, MonthView, WeekView } from "../components/CalendarViews";
import { Modal, PeopleBar } from "../components/ui";
import { Icon } from "../components/Icons";
import type { EditorState } from "../components/EventEditor";
import { MONTHS, MSHORT, addDays, addMonths, cap, longDate, shortDate, startOfMonth, startOfWeek, todayIso } from "../dates";
import { api } from "../api";
import { Importer, QuickAdd } from "../components/Importer";

type View = "D" | "W" | "M" | "L";
const VIEW_KEY = "gezinsbord.view";

export function CalendarScreen({ openEditor, header }: { openEditor: (s: EditorState) => void; header: React.ReactNode }) {
  const { data, hidden, toast } = useData();
  const weekStart = Number(data?.settings.week_start ?? 1);
  const [view, setViewState] = useState<View>(() => { try { return (localStorage.getItem(VIEW_KEY) as View) || "W"; } catch { return "W"; } });
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* */ } };
  const [cursor, setCursor] = useState(todayIso());
  const [dayPop, setDayPop] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);

  const range = (() => {
    if (view === "D") return { from: cursor, to: cursor };
    if (view === "W") { const s = startOfWeek(cursor, weekStart); return { from: s, to: addDays(s, 13) }; }
    if (view === "L") return { from: cursor, to: addDays(cursor, 29) };
    const s = startOfWeek(startOfMonth(cursor), weekStart);
    return { from: s, to: addDays(s, 41) };
  })();
  const [events] = useRemote<Occurrence[]>(`/events?from=${range.from}&to=${range.to}`, ["events", "members"], []);
  const [weather] = useRemote<Weather | null>("/weather", ["settings"], null);
  const visible = events.filter((e) => !e.members.length || e.members.some((m) => !hidden.has(m)));

  const step = (n: number) => setCursor((c) => (view === "D" ? addDays(c, n) : view === "W" ? addDays(c, 7 * n) : view === "L" ? addDays(c, 30 * n) : addMonths(c, n)));
  const label = (() => {
    if (view === "D") return shortDate(cursor);
    if (view === "M") return `${cap(MONTHS[Number(cursor.slice(5, 7)) - 1])} ${cursor.slice(0, 4)}`;
    const a = range.from, b = view === "W" ? addDays(range.from, 6) : range.to;
    const ma = Number(a.slice(5, 7)) - 1, mb = Number(b.slice(5, 7)) - 1;
    return ma === mb ? `${Number(a.slice(8))}–${Number(b.slice(8))} ${MSHORT[mb]}` : `${Number(a.slice(8))} ${MSHORT[ma]} – ${Number(b.slice(8))} ${MSHORT[mb]}`;
  })();
  const open = (o: Occurrence) => openEditor({ occ: o });
  const sync = async () => {
    setSyncing(true);
    try { await api.post("/calendars/sync"); toast("Agenda's bijgewerkt"); } catch (e) { toast(e instanceof Error ? e.message : "Bijwerken mislukt"); }
    setSyncing(false);
  };

  return (
    <>
      <div className="topbar">
        {header}
        <div className="right">
          <button className="iconbtn" onClick={() => step(-1)} aria-label="Vorige"><Icon.left /></button>
          <span className="range">{label}</span>
          <button className="iconbtn" onClick={() => step(1)} aria-label="Volgende"><Icon.right /></button>
          <button className="pill" onClick={() => setCursor(todayIso())}>Vandaag</button>
          <label className="iconbtn datejump" title="Naar een datum springen">
            <Icon.calpick />
            <input type="date" aria-label="Naar een datum springen" value={cursor}
              onClick={(e) => { try { (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* */ } }}
              onChange={(e) => e.target.value && setCursor(e.target.value)} />
          </label>
          <div className="seg" role="group" aria-label="Weergave">
            {([["D", "Dag"], ["W", "Week"], ["M", "Maand"], ["L", "Lijst"]] as [View, string][]).map(([v, l]) => (
              <button key={v} aria-pressed={view === v} title={l} onClick={() => setView(v)}>{v}</button>
            ))}
          </div>
          {!!data?.calendars.length && <button className="iconbtn" onClick={sync} disabled={syncing} aria-label="Gekoppelde agenda's bijwerken"><Icon.sync /></button>}
          <button className="pill" onClick={() => setImporting(true)} title="Foto van een brief of flyer, of geplakte tekst, wordt afspraken">📷 Importeren</button>
        </div>
      </div>
      <PeopleBar />
      <QuickAdd onParsed={(p) => openEditor({ defaults: { title: p.title, date: p.date, endDate: p.endDate, startTime: p.startTime, endTime: p.endTime, allDay: !p.startTime, members: p.memberIds, location: p.location, notes: p.notes, repeat: p.repeat, repeatUntil: p.repeatUntil } })} />
      <section className="card board">
        {view === "D" && <DayView date={cursor} events={visible} onOpen={open} onSlot={(date, startTime, m) => openEditor({ defaults: { date, startTime, endTime: addHour(startTime), members: m ? [m] : [] } })} />}
        {view === "W" && <WeekView start={range.from} events={visible} weather={weather} onOpen={open} onDay={(d) => { setCursor(d); setView("D"); }} onNextWeek={() => step(1)} />}
        {view === "M" && <MonthView month={cursor} events={visible} weekStart={weekStart} onDay={setDayPop} />}
        {view === "L" && <AgendaView from={range.from} days={30} events={visible} onOpen={open} />}
      </section>
      {importing && <Importer onClose={() => setImporting(false)} />}
      {dayPop && (
        <Modal title={cap(longDate(dayPop))} onClose={() => setDayPop(null)}>
          {(() => {
            const list = visible.filter((e) => e.on <= dayPop && e.until >= dayPop);
            return (
              <>
                <p className="hint">{list.length === 1 ? "1 afspraak" : `${list.length} afspraken`}</p>
                <div className="upnext">{list.map((e) => <EventRow key={e.key} e={e} onOpen={(o) => { setDayPop(null); open(o); }} />)}</div>
              </>
            );
          })()}
          <div className="actions">
            <button className="btn ghost" onClick={() => { setCursor(dayPop); setView("D"); setDayPop(null); }}>Dag openen</button>
            <button className="btn" onClick={() => { openEditor({ defaults: { date: dayPop } }); setDayPop(null); }}>+ Afspraak</button>
          </div>
        </Modal>
      )}
    </>
  );
}

const addHour = (t: string) => `${String(Math.min(23, Number(t.slice(0, 2)) + 1)).padStart(2, "0")}${t.slice(2)}`;
