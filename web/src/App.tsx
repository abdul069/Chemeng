import { useCallback, useEffect, useRef, useState } from "react";
import { connectRealtime, onConnection } from "./api";
import { AcceptInvite, AuthScreen, NoHousehold, inviteTokenFromUrl } from "./components/Auth";
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
import { AppsScreen, type AppView } from "./screens/Apps";
import { RecipeHost } from "./components/Recipes";
import { SettingsScreen } from "./screens/Settings";
import { cap, clock, longDate, todayIso } from "./dates";

type Screen = "today" | "calendar" | "chores" | "meals" | "lists" | "apps" | "settings";
const NAV: { id: Screen; label: string; icon: keyof typeof Icon; title: string }[] = [
  { id: "today", label: "Vandaag", icon: "home", title: "Vandaag" },
  { id: "calendar", label: "Kalender", icon: "calendar", title: "Kalender" },
  { id: "chores", label: "Taken", icon: "tasks", title: "Taken" },
  { id: "meals", label: "Maaltijden", icon: "meals", title: "Maaltijden" },
  { id: "lists", label: "Lijsten", icon: "lists", title: "Lijsten" },
  { id: "apps", label: "Apps", icon: "apps", title: "Apps" },
];

export function App() {
  const { data, error, errorCode, reload } = useData();
  const [inviteToken, setInviteToken] = useState(inviteTokenFromUrl);
  const [screen, setScreenState] = useState<Screen>(() => { const h = location.hash.slice(1); return (h === "photos" ? "apps" : h as Screen) || "today"; });
  const [appView, setAppView] = useState<AppView>("grid");
  const setScreen = (s: Screen) => { setScreenState(s); if (s === "apps") setAppView("grid"); };
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

  if (errorCode === "login") return <AuthScreen onDone={() => { setInviteToken(null); reload(); }} />;
  if (errorCode === "no_household" && !inviteToken) return <NoHousehold onDone={reload} />;
  if (errorCode === "no_household" && inviteToken) return <AcceptInvite token={inviteToken} onDone={() => { setInviteToken(null); reload(); }} />;
  if (error && !data) return <ErrorScreen error={error} />;
  if (!data) return <div className="center"><div className="mascot thinking" aria-label="Laden" /></div>;

  const current = NAV.find((n) => n.id === screen);
  const makeHeader = (title: string, back?: () => void) => (
    <div className="titleblock">
      {back
        ? <button className="backbtn" onClick={back}><Icon.left /> Apps</button>
        : <span className="eyebrow">{time} · {cap(longDate(todayIso()))}{!online && <span className="offline" style={{ marginLeft: 8 }}>Offline</span>}</span>}
      <h1>{title}</h1>
    </div>
  );
  const header = makeHeader(screen === "settings" ? "Instellingen" : current?.title ?? "");
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
        {screen === "apps" && <AppsScreen header={makeHeader} view={appView} setView={setAppView} gotoMeals={() => { try { sessionStorage.setItem("gb.meals", "recipes"); } catch { /* */ } setScreen("meals"); }} startSlideshow={() => setSaver(true)} />}
        {screen === "settings" && <SettingsScreen header={header} />}
      </main>
      {(screen === "today" || screen === "calendar") && <button className="fab" onClick={() => openEditor({ defaults: { date: todayIso() } })} aria-label="Afspraak toevoegen">+</button>}
      <button className="mascot-btn mascot-float" onClick={() => openAssistant()} aria-label="Assistent openen"><div className="mascot" /></button>
      {editor && <EventEditor state={editor} onClose={() => setEditor(null)} />}
      <RecipeHost />
      {assist && <Assistant key={assist.key} convo={convo} setConvo={setConvo} initial={assist.prompt} onClose={() => setAssist(null)} />}
      {inviteToken && <AcceptInvite token={inviteToken} onDone={() => { setInviteToken(null); reload(); }} />}
      {saver && <Screensaver onWake={() => { lastActivity.current = Date.now(); setSaver(false); }} />}
    </div>
  );
}

function ErrorScreen({ error }: { error: string }) {
  return (
    <div className="center">
      <div className="card auth">
        <div className="mascot" />
        <h1>Gezinsbord</h1>
        <p className="error">{error}</p>
        <button className="btn" onClick={() => location.reload()}>Opnieuw proberen</button>
      </div>
    </div>
  );
}
