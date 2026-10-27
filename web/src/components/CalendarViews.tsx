import { useEffect, useRef, useState } from "react";
import { useData } from "../store";
import type { Member, Occurrence, Weather } from "../types";
import { Avatar, MemberDots, cvar } from "./ui";
import { DSHORT, MSHORT, addDays, cap, fmtRange, fmtTime, longDate, nowMin, startOfMonth, startOfWeek, toMin, todayIso, weekday, clock } from "../dates";
import { t as tr } from "../i18n";

const START_H = 6;
const END_H = 24;
const HOUR = 60;
const FAMILY: Member = { id: "__gezin", name: "Gezin", color: "#7b8696", avatar: "🏠", photo: null, role: "ouder", sort: 999 };

export const occColor = (o: Occurrence, member: (id: string) => Member | undefined) =>
  member(o.members[0])?.color ?? FAMILY.color;

/** Zet elkaar overlappende afspraken naast elkaar. */
function lanes(list: Occurrence[]) {
  const res = new Map<string, { i: number; n: number }>();
  let group: string[] = [];
  let ends: number[] = [];
  let groupEnd = -1;
  const flush = () => { const n = Math.max(1, ends.length); group.forEach((k) => (res.get(k)!.n = n)); group = []; ends = []; };
  [...list].sort((a, b) => toMin(a.startTime) - toMin(b.startTime)).forEach((e) => {
    const s = toMin(e.startTime);
    const f = Math.max(toMin(e.endTime), s + 30);
    if (s >= groupEnd) flush();
    let i = ends.findIndex((x) => x <= s);
    if (i < 0) { i = ends.length; ends.push(f); } else ends[i] = f;
    res.set(e.key, { i, n: 1 });
    group.push(e.key);
    groupEnd = Math.max(groupEnd, f);
  });
  flush();
  return res;
}

function useNow() {
  const [n, setN] = useState(nowMin());
  useEffect(() => { const t = setInterval(() => setN(nowMin()), 30_000); return () => clearInterval(t); }, []);
  return n;
}

/** Dagweergave met een kolom per gezinslid, zoals op het scherm in de keuken. */
export function DayView({ date, events, onOpen, onSlot, compact }: {
  date: string; events: Occurrence[]; onOpen: (o: Occurrence) => void; onSlot?: (date: string, time: string, member?: string) => void; compact?: boolean;
}) {
  const { people, hidden } = useData();
  const now = useNow();
  const scroller = useRef<HTMLDivElement>(null);
  const isToday = date === todayIso();
  const cols = people.filter((m) => !hidden.has(m.id));
  const dayEvents = events.filter((e) => e.on <= date && e.until >= date);
  if (dayEvents.some((e) => !e.members.length)) cols.push(FAMILY);

  useEffect(() => {
    const target = isToday ? Math.max(0, now / 60 - 1.5) : 8;
    scroller.current?.scrollTo({ top: (target - START_H) * HOUR });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const inCol = (e: Occurrence, m: Member) => (m.id === FAMILY.id ? !e.members.length : e.members.includes(m.id));
  const timed = (e: Occurrence) => !e.allDay && e.on === date;
  const showNow = isToday && now >= START_H * 60;
  const nowTop = ((now - START_H * 60) / 60) * HOUR;

  return (
    <div className="scroll" ref={scroller}>
      <div className="day-grid" style={{ "--cols": Math.max(cols.length, 1) } as React.CSSProperties}>
        <div className="colhead corner" />
        {cols.map((m) => (
          <div className="colhead" key={m.id}>
            <Avatar m={m} size={compact ? 46 : 40} dot={false} />
            <span>{m.name}</span>
          </div>
        ))}
        <div className="allday-lbl">{tr("hele dag")}</div>
        {cols.map((m) => (
          <div className="allday-cell" key={m.id}>
            {dayEvents.filter((e) => (e.allDay || e.on !== date) && inCol(e, m)).map((e) => (
              <button key={e.key} className={`chip${e.readOnly ? tr(" ext") : ""}`} style={cvar(m.color)} onClick={() => onOpen(e)}><b>{e.title}</b></button>
            ))}
          </div>
        ))}
        <div className="hours">
          {Array.from({ length: END_H - START_H }, (_, i) => <div className="hour-lbl" key={i}>{i ? `${START_H + i}u` : ""}</div>)}
        </div>
        {cols.map((m, ci) => {
          const list = dayEvents.filter((e) => timed(e) && inCol(e, m));
          const L = lanes(list);
          return (
            <div className="col" key={m.id} style={{ height: (END_H - START_H) * HOUR }}
              onClick={(ev) => {
                if (!onSlot || ev.target !== ev.currentTarget) return;
                const y = ev.nativeEvent.offsetY;
                const h = Math.min(23, START_H + Math.floor(y / HOUR));
                onSlot(date, `${String(h).padStart(2, "0")}:00`, m.id === FAMILY.id ? undefined : m.id);
              }}>
              {list.map((e) => {
                const s = Math.max(toMin(e.startTime), START_H * 60);
                const top = ((s - START_H * 60) / 60) * HOUR;
                const h = Math.max(26, ((Math.max(toMin(e.endTime), s + 30) - s) / 60) * HOUR - 2);
                const l = L.get(e.key)!;
                const w = 100 / l.n;
                return (
                  <button key={e.key} className={`ev${e.readOnly ? tr(" ext") : ""}`} onClick={() => onOpen(e)}
                    style={{ ...cvar(m.color), top, height: h, left: `calc(${l.i * w}% + 3px)`, width: `calc(${w}% - 6px)` }}>
                    <b>{e.title}</b>
                    {h > 34 && <small>{fmtRange(e)}</small>}
                  </button>
                );
              })}
              {showNow && <div className="nowline" style={{ top: nowTop }} />}
              {showNow && ci === 0 && <span className="nowtag" style={{ top: nowTop }}>{clock()}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Afspraak als compacte gekleurde tegel: tijd, titel en de gezichtjes van wie meegaat. */
function Chip({ e, onOpen }: { e: Occurrence; onOpen: (o: Occurrence) => void }) {
  const { member } = useData();
  return (
    <button className={`chip tile${e.readOnly ? tr(" ext") : ""}`} style={cvar(occColor(e, member))} onClick={() => onOpen(e)}>
      <span className="tile-body">
        <small>{e.allDay ? tr("hele dag") : fmtRange(e)}</small>
        <b>{e.title}</b>
      </span>
      {e.members.length > 0 && <MemberDots ids={e.members} max={3} />}
    </button>
  );
}

function weekMood(n: number, busiest: number) {
  if (n === 0) return "Nog niets gepland. Tijd voor iets leuks samen?";
  if (n <= 4) return "Een rustige week. Of toch niet?";
  if (busiest >= 5) return "Een drukke week: plan wat rust in.";
  return "Een gewone week met genoeg te doen.";
}

export function WeekView({ start, events, weather, onOpen, onDay, onNextWeek }: {
  start: string; events: Occurrence[]; weather?: Weather | null; onOpen: (o: Occurrence) => void; onDay: (d: string) => void; onNextWeek?: () => void;
}) {
  const t = todayIso();
  const next = addDays(start, 7);
  const nextEnd = addDays(start, 13);
  const nextEvents = events.filter((e) => e.until >= next && e.on <= nextEnd);
  const perDay = Array.from({ length: 7 }, (_, i) => { const d = addDays(next, i); return nextEvents.filter((e) => e.on <= d && e.until >= d).length; });
  return (
    <div className="scroll">
      <div className="week">
        {Array.from({ length: 7 }, (_, i) => {
          const d = addDays(start, i);
          const list = events.filter((e) => e.on <= d && e.until >= d);
          const w = weather?.days.find((x) => x.date === d);
          return (
            <div className={`wday${d === t ? " today" : ""}`} key={d}>
              <button className="wday-h" onClick={() => onDay(d)} aria-label={`Open ${longDate(d)}`}>
                <strong>{DSHORT[weekday(d)]} <span className="datebadge">{Number(d.slice(8))}</span></strong>
                <span className="n">{w ? <span className="wday-weather">{w.icon} {w.max}°</span> : list.length ? `${list.length} ${tr("afspr.")}` : ""}</span>
              </button>
              {list.map((e) => <Chip key={e.key} e={e} onOpen={onOpen} />)}
              {!list.length && <p className="empty">{tr("Een rustige dag.")}</p>}
            </div>
          );
        })}
      </div>
      {onNextWeek && (
        <button className="nextweek" onClick={onNextWeek}>
          <span className="nw-h">{Number(next.slice(8))} {MSHORT[Number(next.slice(5, 7)) - 1]} – {Number(nextEnd.slice(8))} {MSHORT[Number(nextEnd.slice(5, 7)) - 1]}</span>
          <span className="nw-mood">{weekMood(nextEvents.length, Math.max(...perDay))}</span>
          <span className="nw-bars" aria-hidden>{perDay.map((n, i) => <i key={i} style={{ height: `${Math.min(100, 12 + n * 16)}%` }} />)}</span>
          <span className="muted">{nextEvents.length} afspraken · bekijk volgende week →</span>
        </button>
      )}
    </div>
  );
}

export function MonthView({ month, events, weekStart, onDay }: { month: string; events: Occurrence[]; weekStart: number; onDay: (d: string) => void }) {
  const { member } = useData();
  const first = startOfMonth(month);
  const gridStart = startOfWeek(first, weekStart);
  const t = todayIso();
  const cells: string[] = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    if (i >= 35 && d.slice(0, 7) !== month.slice(0, 7)) break;
    cells.push(d);
  }
  return (
    <div className="scroll">
      <div className="month">
        {Array.from({ length: 7 }, (_, i) => <div className="mhead" key={i}>{DSHORT[(weekStart + i) % 7]}</div>)}
        {cells.map((d) => {
          const list = events.filter((e) => e.on <= d && e.until >= d);
          return (
            <button key={d} className={`mcell${d.slice(0, 7) !== month.slice(0, 7) ? " out" : ""}${d === t ? " today" : ""}`} onClick={() => onDay(d)} aria-label={`${longDate(d)}, ${list.length} ${tr("afspraken")}`}>
              <span className="mnum"><span className="datebadge">{Number(d.slice(8))}</span>{list.length > 0 && <span className="c">{list.length}</span>}</span>
              {list.slice(0, 3).map((e) => (
                <span key={e.key} className="mchip" style={cvar(occColor(e, member))}>
                  {e.members.length > 0 && <MemberDots ids={e.members} max={2} />}
                  <span className="mchip-txt">{!e.allDay && e.on === d ? <small>{fmtTime(e.startTime)} </small> : null}{e.title}</span>
                </span>
              ))}
              {list.length > 3 && <span className="more">+{list.length - 3} meer</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AgendaView({ from, days, events, onOpen }: { from: string; days: number; events: Occurrence[]; onOpen: (o: Occurrence) => void }) {
  const out = Array.from({ length: days }, (_, i) => addDays(from, i))
    .map((d) => ({ d, list: events.filter((e) => e.on <= d && e.until >= d) }))
    .filter((x) => x.list.length);
  return (
    <div className="scroll">
      <div className="agenda">
        {out.map(({ d, list }) => (
          <section className="agenda-day" key={d}>
            <h3>{cap(longDate(d))}</h3>
            <div className="upnext">{list.map((e) => <EventRow key={e.key} e={e} onOpen={onOpen} />)}</div>
          </section>
        ))}
        {!out.length && <p className="empty">{tr("Niets gepland in deze periode.")}</p>}
      </div>
    </div>
  );
}

export function EventRow({ e, onOpen }: { e: Occurrence; onOpen: (o: Occurrence) => void }) {
  const { member } = useData();
  return (
    <button className="item" onClick={() => onOpen(e)} style={cvar(occColor(e, member))}>
      <span className="bar" />
      <span style={{ flex: 1, minWidth: 0 }}>
        <b>{e.title}</b>
        <small>{fmtRange(e)}{e.location ? ` · ${e.location}` : ""}</small>
      </span>
      <MemberDots ids={e.members} />
    </button>
  );
}
