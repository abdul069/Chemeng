import { useCallback, useEffect, useRef, useState } from "react";
import { connectRealtime, onConnection, setCode, api, ApiError } from "./api";
import { useData } from "./store";
import { Icon } from "./components/Icons";
import { EventEditor, type EditorState } from "./components/EventEditor";
import { Screensaver } from "./components/Screensaver";
import { Assistant, type Msg } from "./assistant/Assistant";
import { TodayScreen } from "./screens/Today";
import { CalendarScreen } from "./screens/Calendar";
import { ChoresScreen } from "./screens/Chores";
import { MealsScreen } from "./screens/Meals";
import { ListsScreen } from "./screens/Lists";
import { PhotosScreen } from "./screens/Photos";
import { SettingsScreen } from "./screens/Settings";
import { cap, clock, longDate, todayIso } from "./dates";

type Screen = "today" | "calendar" | "chores" | "meals" | "lists" | "photos" | "settings";
const NAV: { id: Screen; label: string; icon: keyof typeof Icon; title: string }[] = [
  { id: "today", label: "Vandaag", icon: "home", title: "Vandaag" },
  { id: "calendar", label: "Kalender", icon: "calendar", title: "Kalender" },
  { id: "chores", label: "Taken", icon: "tasks", title: "Taken" },
  { id: "meals", label: "Maaltijden", icon: "meals", title: "Maaltijden" },
  { id: "lists", label: "Lijsten", icon: "lists", title: "Lijsten" },
  { id: "photos", label: "Foto's", icon: "photos", title: "Foto's" },
];

export function App() {
  const { data, error } = useData();
  const [screen, setScreen] = useState<Screen>(() => (location.hash.slice(1) as Screen) || "today");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [assist, setAssist] = useState<{ prompt?: string; key: number } | null>(null);
  const [convo, setConvo] = useState<Msg[]>([]);
  const [saver, setSaver] = useState(false);
  const [online, setOnline] = useState(true);
  const [time, setTime] = useState(clock());
  const lastActivity = useRef(Date.now());

  useEffect(() => { onConnection(setOnline); connectRealtime(); }, []);
  useEffect(() => { history.replaceState(null, "", `#${screen}`); }, [screen]);
  useEffect(() => {
    const h = () => { const s = location.hash.slice(1) as Screen; if (s) setScreen(s); };
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  useEffect(() => { const t = setInterval(() => setTime(clock()), 15_000); return () => clearInterval(t); }, []);

  // Fotolijst na een periode zonder aanraking; gesprek met de assistent vergeten na 10 minuten.
  const minutes = Number(data?.settings.screensaver_minutes ?? 10);
  useEffect(() => {
    const bump = () => { lastActivity.current = Date.now(); };
    const evs = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = setInterval(() => {
      const idle = Date.now() - lastActivity.current;
      if (minutes > 0 && idle > minutes * 60_000 && !assist) setSaver(true);
      if (idle > 10 * 60_000) setConvo((c) => (c.length ? [] : c));
    }, 15_000);
    return () => { evs.forEach((e) => window.removeEventListener(e, bump)); clearInterval(t); };
  }, [minutes, assist]);

  // Scherm wakker houden op een keukenscherm
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const req = () => (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<typeof lock> } }).wakeLock?.request("screen").then((l) => { lock = l; }).catch(() => {});
    req();
    const vis = () => document.visibilityState === "visible" && req();
    document.addEventListener("visibilitychange", vis);
    return () => { document.removeEventListener("visibilitychange", vis); lock?.release().catch(() => {}); };
  }, []);

  const openAssistant = useCallback((prompt?: string) => setAssist({ prompt, key: Date.now() }), []);

  if (error && !data) return <Login error={error} />;
  if (!data) return <div className="center"><div className="mascot thinking" aria-label="Laden" /></div>;

  const current = NAV.find((n) => n.id === screen);
  const header = (
    <div className="titleblock">
      <span className="eyebrow">{time} · {cap(longDate(todayIso()))}{!online && <span className="offline" style={{ marginLeft: 8 }}>Offline</span>}</span>
      <h1>{screen === "settings" ? "Instellingen" : current?.title}</h1>
    </div>
  );
  const openEditor = (s: EditorState) => setEditor(s);

  return (
    <div className="shell">
      <nav className="rail" aria-label="Hoofdmenu">
        <button className="mascot-btn brand" onClick={() => openAssistant()} aria-label="Assistent openen"><div className="mascot" style={{ width: 48, height: 48 }} /></button>
        {NAV.map((n) => {
          const I = Icon[n.icon];
          return <button key={n.id} className="navbtn" aria-current={screen === n.id ? "page" : undefined} onClick={() => setScreen(n.id)}><I />{n.label}</button>;
        })}
        <span className="spacer" />
        <button className="navbtn" aria-current={screen === "settings" ? "page" : undefined} onClick={() => setScreen("settings")}><Icon.settings />Instellingen</button>
      </nav>
      <main className="page">
        {screen === "today" && <TodayScreen header={header} openEditor={openEditor} openAssistant={openAssistant} goto={(s) => setScreen(s)} />}
        {screen === "calendar" && <CalendarScreen header={header} openEditor={openEditor} />}
        {screen === "chores" && <ChoresScreen header={header} />}
        {screen === "meals" && <MealsScreen header={header} />}
        {screen === "lists" && <ListsScreen header={header} />}
        {screen === "photos" && <PhotosScreen header={header} startSlideshow={() => setSaver(true)} />}
        {screen === "settings" && <SettingsScreen header={header} />}
      </main>
      {(screen === "today" || screen === "calendar") && <button className="fab" onClick={() => openEditor({ defaults: { date: todayIso() } })} aria-label="Afspraak toevoegen">+</button>}
      <button className="mascot-btn mascot-float" onClick={() => openAssistant()} aria-label="Assistent openen"><div className="mascot" /></button>
      {editor && <EventEditor state={editor} onClose={() => setEditor(null)} />}
      {assist && <Assistant key={assist.key} convo={convo} setConvo={setConvo} initial={assist.prompt} onClose={() => setAssist(null)} />}
      {saver && <Screensaver onWake={() => { lastActivity.current = Date.now(); setSaver(false); }} />}
    </div>
  );
}

function Login({ error }: { error: string }) {
  const { reload } = useData();
  const [code, setC] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [needsCode, setNeedsCode] = useState<boolean | null>(null);
  useEffect(() => { api.get<{ authRequired: boolean }>("/health").then((h) => setNeedsCode(h.authRequired)).catch(() => setNeedsCode(false)); }, []);
  const go = async () => {
    setCode(code.trim());
    try { await api.get("/bootstrap"); reload(); location.reload(); }
    catch (e) { setMsg(e instanceof ApiError && e.status === 401 ? "Die code klopt niet." : (e as Error).message); }
  };
  return (
    <div className="center">
      <div className="card login">
        <div className="mascot" />
        <h1>Gezinsbord</h1>
        {needsCode ? (
          <>
            <p className="hint">Voer de toegangscode van je gezinsbord in. Je vindt ze bij wie de server installeerde.</p>
            <input id="code" type="password" value={code} onChange={(e) => setC(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} aria-label="Toegangscode" autoFocus />
            {msg && <p className="error">{msg}</p>}
            <button className="btn" onClick={go} disabled={!code.trim()}>Openen</button>
          </>
        ) : (
          <>
            <p className="error">{error}</p>
            <button className="btn" onClick={() => location.reload()}>Opnieuw proberen</button>
          </>
        )}
      </div>
    </div>
  );
}
