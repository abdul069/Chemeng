import { useEffect, useState } from "react";
import { photoUrl } from "../api";
import { useData, useRemote } from "../store";
import { Occurrence, Weather , isShopping } from "../types";
import { addDays, cap, clock, fmtRange, longDate, nowMin, relDay, toMin, todayIso } from "../dates";
import { t as tr } from "../i18n";

/** Fotolijst: foto's van het gezin met de klok en de volgende afspraak. Tik om terug te gaan. */
export function Screensaver({ onWake }: { onWake: () => void }) {
  const { data } = useData();
  const photos = data?.photos ?? [];
  const [i, setI] = useState(0);
  const [time, setTime] = useState(clock());
  const t = todayIso();
  const [events] = useRemote<Occurrence[]>(`/events?from=${t}&to=${addDays(t, 7)}`, ["events"], []);
  const [weather] = useRemote<Weather | null>("/weather", ["settings"], null);

  useEffect(() => {
    const a = setInterval(() => setTime(clock()), 10_000);
    const b = setInterval(() => setI((x) => x + 1), 12_000);
    return () => { clearInterval(a); clearInterval(b); };
  }, []);

  const n = nowMin();
  const next = events.find((e) => !e.allDay && (e.on > t || toMin(e.startTime) >= n)) ?? events.find((e) => e.on > t);
  const order = photos.length ? i % photos.length : 0;
  const cur = photos[order];

  return (
    <div className={`saver${cur ? "" : tr(" noimg")}`} onPointerDown={onWake} onKeyDown={onWake} role="button" tabIndex={0} aria-label={tr("Terug naar het gezinsbord")}>
      {photos.map((p, k) => (
        <span key={p.id}>
          {k === order && <img className="bg on" src={photoUrl(p.filename)} alt="" />}
          <img className={k === order ? "on" : ""} src={photoUrl(p.filename)} alt="" loading={Math.abs(k - order) <= 1 ? "eager" : "lazy"} />
        </span>
      ))}
      <div className="widgets" aria-hidden>
        {(() => {
          const shop = data?.lists.find(isShopping);
          const todo = data?.lists.find((l) => l.kind === "list" && /to-?do/i.test(l.name));
          return [shop, todo].filter((l): l is NonNullable<typeof l> => !!l && l.items.some((i) => !i.done)).map((l) => (
            <div className="widget" key={l.id}>
              <b>{l.icon} {l.name}</b>
              {l.items.filter((i) => !i.done).slice(0, 5).map((i) => <div key={i.id}>· {i.text}</div>)}
              {l.items.filter((i) => !i.done).length > 5 && <div style={{ opacity: .6 }}>+{l.items.filter((i) => !i.done).length - 5} meer</div>}
            </div>
          ));
        })()}
      </div>
      <div className="info">
        <div>
          <div className="time">{time}</div>
          <div style={{ fontSize: 22 }}>{cap(longDate(t))}{weather ? ` · ${weather.current.icon} ${weather.current.temp}°` : ""}</div>
        </div>
        {next && (
          <div className="next">
            <div style={{ opacity: 0.8, fontSize: 15 }}>{tr("Volgende")}</div>
            <b>{next.title}</b> · {relDay(next.on)} {fmtRange(next)}
          </div>
        )}
      </div>
    </div>
  );
}
