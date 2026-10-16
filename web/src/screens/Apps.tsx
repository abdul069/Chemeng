import { useEffect, useRef, useState } from "react";
import { api, photoUrl } from "../api";
import { useAction, useRemote } from "../store";
import type { Memo, Weather } from "../types";
import { Confirm } from "../components/ui";
import { Icon } from "../components/Icons";
import { PhotosScreen } from "./Photos";
import { fmtLeft, useTimers, type Alarm } from "../components/Timers";
import { BrandIcon, OWN_ICONS } from "../components/AppIcons";
import { DAYS, DSHORT, cap, clock, longDate, todayIso } from "../dates";

export type AppView = "grid" | "photos" | "weather" | "clock" | "memos";

interface Tile { id: string; label: string; icon: string; color: string; view?: AppView; href?: string; goto?: "meals"; domain?: string }
const TILES: Tile[] = [
  { id: "photos", label: "Foto's", icon: "🖼️", color: "#e9f6f4", view: "photos" },
  { id: "weather", label: "Weer", icon: "⛅", color: "#eaf2fd", view: "weather" },
  { id: "clock", label: "Klok & timers", icon: "⏰", color: "#fdf1e6", view: "clock" },
  { id: "memos", label: "Spraakmemo's", icon: "🎙️", color: "#f4edfb", view: "memos" },
  { id: "recipes", label: "Recepten", icon: "🍲", color: "#fdecea", goto: "meals" },
  { id: "yt", label: "YouTube", icon: "▶️", color: "#fff", href: "https://www.youtube.com", domain: "youtube.com" },
  { id: "ytm", label: "YouTube Music", icon: "🎵", color: "#fff", href: "https://music.youtube.com", domain: "music.youtube.com" },
  { id: "spotify", label: "Spotify", icon: "🎧", color: "#fff", href: "https://open.spotify.com", domain: "open.spotify.com" },
  { id: "gphotos", label: "Google Foto's", icon: "📷", color: "#fff", href: "https://photos.google.com", domain: "photos.google.com" },
  { id: "gcal", label: "Google Agenda", icon: "📆", color: "#fff", href: "https://calendar.google.com", domain: "calendar.google.com" },
  { id: "maps", label: "Google Maps", icon: "🗺️", color: "#fff", href: "https://maps.google.com", domain: "maps.google.com" },
  { id: "netflix", label: "Netflix", icon: "🎬", color: "#fff", href: "https://www.netflix.com", domain: "netflix.com" },
  { id: "disney", label: "Disney+", icon: "✨", color: "#fff", href: "https://www.disneyplus.com", domain: "disneyplus.com" },
  { id: "whatsapp", label: "WhatsApp", icon: "💬", color: "#fff", href: "https://web.whatsapp.com", domain: "whatsapp.com" },
  { id: "news", label: "Nieuws", icon: "📰", color: "#eef0f3", href: "https://www.vrt.be/vrtnws/nl/" },
];

export function AppsScreen({ header, view, setView, gotoMeals, startSlideshow }: {
  header: (title: string, back?: () => void) => React.ReactNode; view: AppView; setView: (v: AppView) => void; gotoMeals: () => void; startSlideshow: () => void;
}) {
  const back = () => setView("grid");
  if (view === "photos") return <PhotosScreen header={header("Foto's", back)} startSlideshow={startSlideshow} />;
  if (view === "weather") return <><div className="topbar">{header("Weer", back)}</div><WeatherApp /></>;
  if (view === "clock") return <><div className="topbar">{header("Klok & timers", back)}</div><ClockApp /></>;
  if (view === "memos") return <><div className="topbar">{header("Spraakmemo's", back)}</div><MemosApp /></>;
  return (
    <>
      <div className="topbar">{header("Apps")}</div>
      <div className="page-scroll" style={{ flex: 1, minHeight: 0 }}>
        <div className="appgrid">
          {TILES.map((t) => t.href ? (
            <a key={t.id} className="app" href={t.href} target="_blank" rel="noreferrer">
              <span className="app-ic">{t.domain ? <BrandIcon domain={t.domain} fallback={t.icon} /> : OWN_ICONS[t.id] ?? t.icon}</span><span>{t.label}</span>
            </a>
          ) : (
            <button key={t.id} className="app" onClick={() => (t.goto ? gotoMeals() : setView(t.view!))}>
              <span className="app-ic">{OWN_ICONS[t.id] ?? t.icon}</span><span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function WeatherApp() {
  const [w] = useRemote<Weather | null>("/weather", ["settings"], null);
  if (!w) return <p className="empty">Het weerbericht wordt geladen… Lukt het niet, kies dan je woonplaats in Instellingen.</p>;
  return (
    <div className="page-scroll" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 14 }}>
      <section className="card card-pad weather-now-big">
        <span className="wx-ic" aria-hidden>{w.current.icon}</span>
        <div>
          <div className="wx-t">{w.current.temp}°</div>
          <div><b>{w.current.label}</b> · {w.city}</div>
          <div className="muted">Wind {w.current.wind} km/u · vandaag {w.days[0]?.min}° tot {w.days[0]?.max}°</div>
        </div>
      </section>
      <section className="card card-pad">
        <div className="section-title"><h2>Komende 7 dagen</h2></div>
        <div className="wx-days">
          {w.days.map((d, i) => (
            <div className="wx-day" key={d.date}>
              <b>{i === 0 ? "Vandaag" : i === 1 ? "Morgen" : cap(DAYS[new Date(d.date + "T12:00").getDay()])}</b>
              <span className="wx-di" aria-hidden>{d.icon}</span>
              <span className="muted">{d.label}</span>
              <span className="num">{d.min}° / <b>{d.max}°</b></span>
              <span className="muted num">💧 {d.rain}%</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const PRESETS = [1, 3, 5, 10, 15, 20, 30, 45, 60];

function ClockApp() {
  const { timers, alarms, now, addTimer, removeTimer, saveAlarm, removeAlarm } = useTimers();
  const [custom, setCustom] = useState({ min: "", label: "" });
  const [na, setNa] = useState<Alarm>({ id: "", time: "07:00", label: "", days: [], on: true });
  const d = new Date(now);
  return (
    <div className="page-scroll" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 14 }}>
      <section className="card card-pad bigclock">
        <div className="bc-time num">{clock(d)}<small>:{String(d.getSeconds()).padStart(2, "0")}</small></div>
        <div className="muted">{cap(longDate(todayIso()))}</div>
      </section>
      <section className="card card-pad">
        <div className="section-title"><h2>Kookwekker</h2></div>
        <div className="picks">{PRESETS.map((m) => <button key={m} className="pick" onClick={() => addTimer(m)}>{m < 60 ? `${m} min` : "1 uur"}</button>)}</div>
        <form className="addrow" style={{ marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); const m = Number(custom.min); if (m > 0) { addTimer(m, custom.label); setCustom({ min: "", label: "" }); } }}>
          <input id="t-min" type="number" min={1} max={600} value={custom.min} onChange={(e) => setCustom({ ...custom, min: e.target.value })} placeholder="Minuten" style={{ maxWidth: 120 }} aria-label="Minuten" />
          <input id="t-label" value={custom.label} onChange={(e) => setCustom({ ...custom, label: e.target.value })} placeholder="Waarvoor? bv. Rijst" aria-label="Naam van de kookwekker" />
          <button className="btn" type="submit" disabled={!(Number(custom.min) > 0)}>Starten</button>
        </form>
        <div className="timers">
          {timers.map((t) => {
            const left = t.endsAt - now;
            return (
              <div className="timer" key={t.id}>
                <svg viewBox="0 0 36 36" className="ring-svg" aria-hidden>
                  <circle cx="18" cy="18" r="16" fill="none" stroke="var(--line)" strokeWidth="3" />
                  <circle cx="18" cy="18" r="16" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round"
                    strokeDasharray={`${Math.max(0, (left / t.total) * 100.5)} 100.5`} transform="rotate(-90 18 18)" />
                </svg>
                <span style={{ flex: 1 }}><b className="num" style={{ fontSize: 26 }}>{fmtLeft(left)}</b><small className="muted" style={{ display: "block" }}>{t.label || "Kookwekker"}</small></span>
                <button className="iconbtn" aria-label="Kookwekker stoppen" onClick={() => removeTimer(t.id)}><Icon.close /></button>
              </div>
            );
          })}
        </div>
      </section>
      <section className="card card-pad">
        <div className="section-title"><h2>Wekkers</h2><span className="hint">op dit scherm</span></div>
        {alarms.map((a) => (
          <div className="item" key={a.id}>
            <b className="num" style={{ fontSize: 24 }}>{a.time}</b>
            <span style={{ flex: 1 }}>{a.label || "Wekker"}<small>{a.days.length ? a.days.map((x) => DSHORT[x]).join(" ") : "elke dag"}</small></span>
            <label className="check-row"><input type="checkbox" checked={a.on} onChange={(e) => saveAlarm({ ...a, on: e.target.checked })} /> aan</label>
            <button className="iconbtn" aria-label="Wekker verwijderen" onClick={() => removeAlarm(a.id)}><Icon.trash /></button>
          </div>
        ))}
        <div className="addrow" style={{ marginTop: 10 }}>
          <input id="a-time" type="time" value={na.time} onChange={(e) => setNa({ ...na, time: e.target.value })} style={{ maxWidth: 140 }} aria-label="Tijd" />
          <input id="a-label" value={na.label} onChange={(e) => setNa({ ...na, label: e.target.value })} placeholder="bv. Kinderen wakker maken" aria-label="Naam van de wekker" />
          <button className="btn" onClick={() => { saveAlarm({ ...na, id: "" }); setNa({ ...na, label: "" }); }}>Toevoegen</button>
        </div>
        <div className="picks" style={{ marginTop: 8 }}>
          {[1, 2, 3, 4, 5, 6, 0].map((x) => <button key={x} className="pick" aria-pressed={na.days.includes(x)} onClick={() => setNa({ ...na, days: na.days.includes(x) ? na.days.filter((y) => y !== x) : [...na.days, x] })}>{DSHORT[x]}</button>)}
          <span className="hint" style={{ alignSelf: "center" }}>Geen dag gekozen = elke dag</span>
        </div>
      </section>
    </div>
  );
}

function MemosApp() {
  const act = useAction();
  const [memos] = useRemote<Memo[]>("/memos", ["memos"], []);
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [secs, setSecs] = useState(0);
  const [title, setTitle] = useState("");
  const [del, setDel] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const started = useRef(0);
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setSecs(Math.round((Date.now() - started.current) / 1000)), 500);
    return () => clearInterval(t);
  }, [rec]);

  const start = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((m) => MediaRecorder.isTypeSupported?.(m)) ?? "";
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: r.mimeType || "audio/webm" });
        const fd = new FormData();
        fd.append("audio", blob, `memo.${/mp4/.test(blob.type) ? "m4a" : "webm"}`);
        fd.append("title", title.trim() || `Memo ${clock()}`);
        fd.append("seconds", String(Math.round((Date.now() - started.current) / 1000)));
        await act(() => api.post("/memos", fd), "Memo bewaard");
        setTitle("");
      };
      started.current = Date.now();
      setSecs(0);
      r.start();
      setRec(r);
    } catch {
      setErr("Geef de app toegang tot de microfoon om een memo op te nemen.");
    }
  };
  const stop = () => { rec?.stop(); setRec(null); };

  return (
    <div className="page-scroll" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 14 }}>
      <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <p className="hint">Spreek een boodschap in voor de rest van het gezin, bv. “Vergeet de turnzak niet!”. Iedereen in het gezin hoort ze op elk toestel.</p>
        <input id="memo-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titel (optioneel)" aria-label="Titel van de memo" disabled={!!rec} />
        <button className={`talk big${rec ? " on" : ""}`} onClick={rec ? stop : start}>
          {rec ? <>■ Stoppen · <span className="num">{fmtLeft(secs * 1000)}</span></> : <><Icon.mic /> Opnemen</>}
        </button>
        {err && <p className="error">{err}</p>}
      </section>
      <div className="upnext">
        {memos.map((m) => (
          <div className="item" key={m.id}>
            <span style={{ flex: "1 1 180px", minWidth: 0 }}><b>{m.title}</b><small>{m.by ?? "Iemand"} · {new Date(m.createdAt + "Z").toLocaleString("nl-BE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small></span>
            <audio controls preload="none" src={photoUrl(m.filename)} style={{ flex: "1 1 240px", maxWidth: "100%" }} />
            <button className="iconbtn" aria-label="Memo verwijderen" onClick={() => setDel(m.id)}><Icon.trash /></button>
          </div>
        ))}
        {!memos.length && <p className="empty">Nog geen memo's.</p>}
      </div>
      {del && <Confirm title="Memo verwijderen?" onClose={() => setDel(null)} actions={[{ label: "Verwijderen", run: () => act(() => api.del(`/memos/${del}`), "Memo verwijderd") }]} />}
    </div>
  );
}
