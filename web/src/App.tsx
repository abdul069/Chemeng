import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ScreenBoundary, lazyRetry } from "./lazy";
import { connectRealtime, onCast, onConnection } from "./api";
import { useDevice, useDeviceRegistration, getDevice } from "./device";
import { useIsPhone } from "./components/ui";
import { MyDayScreen } from "./screens/MyDay";
const DeviceSetup = lazyRetry(() => import("./components/DeviceSetup").then((m) => ({ default: m.DeviceSetup })));
import { AcceptInvite, AuthScreen, NoHousehold, ResetPassword, inviteTokenFromUrl, resetTokenFromUrl } from "./components/Auth";
import { useData } from "./store";
import { Icon } from "./components/Icons";
import type { EditorState } from "./components/EventEditor";
const EventEditor = lazyRetry(() => import("./components/EventEditor").then((m) => ({ default: m.EventEditor })));
const Screensaver = lazyRetry(() => import("./components/Screensaver").then((m) => ({ default: m.Screensaver })));
import type { Msg } from "./assistant/Assistant";
const Assistant = lazyRetry(() => import("./assistant/Assistant").then((m) => ({ default: m.Assistant })));
import { TodayScreen } from "./screens/Today";
import { CalendarScreen } from "./screens/Calendar";
const ChoresScreen = lazyRetry(() => import("./screens/Chores").then((m) => ({ default: m.ChoresScreen })));
const MealsScreen = lazyRetry(() => import("./screens/Meals").then((m) => ({ default: m.MealsScreen })));
const ListsScreen = lazyRetry(() => import("./screens/Lists").then((m) => ({ default: m.ListsScreen })));
import type { AppView } from "./screens/Apps";
const AppsScreen = lazyRetry(() => import("./screens/Apps").then((m) => ({ default: m.AppsScreen })));
const Search = lazyRetry(() => import("./components/Search").then((m) => ({ default: m.Search })));
import { emitNav } from "./nav";
const RecipeHost = lazyRetry(() => import("./components/Recipes").then((m) => ({ default: m.RecipeHost })));
const SettingsScreen = lazyRetry(() => import("./screens/Settings").then((m) => ({ default: m.SettingsScreen })));
import { cap, clock, longDate, todayIso } from "./dates";
import { EzanOverlay, useEzan } from "./components/Ezan";
const QuranMiniPlayer = lazyRetry(() => import("./components/Quran").then((m) => ({ default: m.QuranMiniPlayer })));
import { openRecipe } from "./components/Recipes";
import { t as tr, brand } from "./i18n";

type Screen = "today" | "calendar" | "chores" | "meals" | "lists" | "apps" | "settings";
const NAV: { id: Screen; label: string; icon: keyof typeof Icon; title: string }[] = [
  { id: "today", label: "Bord", icon: "home", title: "Bord" },
  { id: "calendar", label: "Kalender", icon: "calendar", title: "Kalender" },
  { id: "chores", label: "Taken", icon: "tasks", title: "Taken" },
  { id: "meals", label: "Maaltijden", icon: "meals", title: "Maaltijden" },
  { id: "lists", label: "Lijsten", icon: "lists", title: "Lijsten" },
  { id: "apps", label: "Apps", icon: "apps", title: "Apps" },
];

export function App() {
  const { data, error, errorCode, reload } = useData();
  const [inviteToken, setInviteToken] = useState(inviteTokenFromUrl);
  const [search, setSearch] = useState(false);
  const [resetToken, setResetToken] = useState(resetTokenFromUrl);
  const [screen, setScreenState] = useState<Screen>(() => { const h = location.hash.slice(1); return (h === "photos" ? "apps" : h as Screen) || "today"; });
  const [appView, setAppView] = useState<AppView>("grid");
  const setScreen = (s: Screen) => { setScreenState(s); if (s === "apps") { let v: AppView = "grid"; try { v = (sessionStorage.getItem("gb.app") as AppView) || "grid"; sessionStorage.removeItem("gb.app"); } catch { /* */ } setAppView(v); } };
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [assist, setAssist] = useState<{ prompt?: string; key: number } | null>(null);
  const [convo, setConvo] = useState<Msg[]>([]);
  const [saver, setSaver] = useState(false);
  const [sleeping, setSleeping] = useState(false);
  const wokeAt = useRef(0);
  const [online, setOnline] = useState(true);
  const [time, setTime] = useState(clock());
  const lastActivity = useRef(Date.now());
  const device = useDevice();
  const phoneLayout = useIsPhone();
  const [setup, setSetup] = useState(false);
  const [castMsg, setCastMsg] = useState<string | null>(null);
  useDeviceRegistration(!!data);
  // eerste start op dit toestel: vragen of het het wandscherm, het tafelmodel of een telefoon is
  useEffect(() => { if (data && !device.role) setSetup(true); }, [data, device.role]);
  // een telefoon stuurt iets naar dit scherm (alleen een hub reageert, of een toestel dat met naam genoemd wordt)
  useEffect(() => onCast((c) => {
    const me = getDevice();
    if (c.to ? c.to !== me.id : me.role !== "hub") return;
    lastActivity.current = Date.now(); setSaver(false); setSleeping(false);
    if (c.kind === "recipe") openRecipe(c.value);
    else if (c.kind === "screen") { setScreenState((c.value === "today" || c.value === "calendar" || c.value === "chores" || c.value === "meals" || c.value === "lists" || c.value === "apps" ? c.value : "today") as Screen); setAppView("grid"); }
    else if (c.kind === "message") { setCastMsg(c.value); setTimeout(() => setCastMsg(null), 20_000); }
  }), []);

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
      // na een tijdje zonder aanraking terug naar het startscherm
      const homeAfter = Number(data?.settings.home_after_minutes ?? 0);
      if (homeAfter > 0 && idle > homeAfter * 60_000 && !assist && !editor) { setScreenState((s) => (s === "today" ? s : "today")); setAppView("grid"); }
      // nachtrust
      const from = data?.settings.sleep_from, until = data?.settings.sleep_until;
      if (from && until && Date.now() - wokeAt.current > 2 * 60_000) {
        const now = new Date(); const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
        const inSleep = from < until ? hm >= from && hm < until : hm >= from || hm < until;
        setSleeping(inSleep);
      }
    }, 15_000);
    return () => { evs.forEach((e) => window.removeEventListener(e, bump)); clearInterval(t); };
  }, [minutes, assist, editor, data?.settings.home_after_minutes, data?.settings.sleep_from, data?.settings.sleep_until]);

  // Scherm wakker houden op een keukenscherm
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const req = () => (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<typeof lock> } }).wakeLock?.request("screen").then((l) => { lock = l; }).catch(() => {});
    req();
    const vis = () => document.visibilityState === "visible" && req();
    document.addEventListener("visibilitychange", vis);
    return () => { document.removeEventListener("visibilitychange", vis); lock?.release().catch(() => {}); };
  }, []);

  const ezan = useEzan();
  const openAssistant = useCallback((prompt?: string) => setAssist({ prompt, key: Date.now() }), []);

  if (resetToken) return <ResetPassword token={resetToken} onDone={() => { setResetToken(null); reload(); }} />;
  if (errorCode === "login") return <AuthScreen onDone={() => { setInviteToken(null); reload(); }} />;
  if (errorCode === "no_household" && !inviteToken) return <NoHousehold onDone={reload} />;
  if (errorCode === "no_household" && inviteToken) return <AcceptInvite token={inviteToken} onDone={() => { setInviteToken(null); reload(); }} />;
  if (error && !data) return <ErrorScreen error={error} />;
  if (!data) return <div className="center"><div className="mascot thinking" aria-label={tr("Laden")} /></div>;

  const current = NAV.find((n) => n.id === screen);
  const makeHeader = (title: string, back?: () => void) => (
    <div className="titleblock">
      {back
        ? <button className="backbtn" onClick={back}><Icon.left />{" "}{tr("Apps")}</button>
        : <span className="eyebrow">{time} · {cap(longDate(todayIso()))}{!online && <span className="offline" style={{ marginLeft: 8 }}>{tr("Offline")}</span>}</span>}
      <div className="titlerow"><h1>{title}</h1><button className="iconbtn search-top" onClick={() => setSearch(true)} aria-label={tr("Zoeken in alles")}><Icon.search /></button></div>
    </div>
  );
  const header = makeHeader(screen === "settings" ? tr("Instellingen") : tr(current?.title ?? ""));
  const openEditor = (s: EditorState) => setEditor(s);

  return (
    <div className="shell">
      <nav className="rail" aria-label={tr("Hoofdmenu")}>
        <button className="mascot-btn brand" onClick={() => openAssistant()} aria-label={tr("Assistent openen")}><div className="mascot" style={{ width: 48, height: 48 }} /></button>
        {NAV.map((n) => {
          const I = Icon[n.icon];
          const label = n.id === "today" && device.role === "phone" ? "Mijn dag" : n.label;
          return <button key={n.id} className="navbtn" aria-current={screen === n.id ? "page" : undefined} onClick={() => setScreen(n.id)}><I />{tr(label)}</button>;
        })}
        <span className="spacer" />
        <button className="navbtn nav-search" onClick={() => setSearch(true)} aria-label={tr("Zoeken in alles")}><Icon.search />{tr("Zoeken")}</button>
        {!phoneLayout && <button className="navbtn" aria-current={screen === "settings" ? "page" : undefined} onClick={() => setScreen("settings")}><Icon.settings />{tr("Instellingen")}</button>}
      </nav>
      <main className={`page${screen === "today" ? tr(" page-bord") : ""}`}>
        <ScreenBoundary><Suspense fallback={<div className="center"><div className="mascot thinking" aria-label={tr("Laden")} /></div>}>
        {screen === "today" && (device.role === "phone"
          ? <MyDayScreen openEditor={openEditor} openAssistant={openAssistant} goto={(s) => setScreen(s)} openSearch={() => setSearch(true)} onPickMember={() => setSetup(true)} />
          : <TodayScreen openEditor={openEditor} openAssistant={openAssistant} goto={(s) => setScreen(s)} openSearch={() => setSearch(true)} online={online} />)}
        {screen === "calendar" && <CalendarScreen header={header} openEditor={openEditor} />}
        {screen === "chores" && <ChoresScreen header={header} />}
        {screen === "meals" && <MealsScreen header={header} />}
        {screen === "lists" && <ListsScreen header={header} />}
        {screen === "apps" && <AppsScreen header={makeHeader} view={appView} setView={setAppView} gotoMeals={() => { try { sessionStorage.setItem("gb.meals", "recipes"); } catch { /* */ } setScreen("meals"); }} gotoSettings={() => setScreen("settings")} startSlideshow={() => setSaver(true)} />}
        {screen === "settings" && <SettingsScreen header={header} />}
        </Suspense></ScreenBoundary>
      </main>
      {(screen === "today" || screen === "calendar") && <button className="fab" onClick={() => openEditor({ defaults: { date: todayIso() } })} aria-label={tr("Afspraak toevoegen")}>+</button>}
      <button className="mascot-btn mascot-float" onClick={() => openAssistant()} aria-label={tr("Assistent openen")}><div className="mascot" /></button>
      <Suspense fallback={null}>{appView !== "quran" || screen !== "apps" ? <QuranMiniPlayer onOpen={() => { setScreenState("apps"); setAppView("quran"); }} /> : null}</Suspense>
      <Suspense fallback={null}>
      {editor && <EventEditor state={editor} onClose={() => setEditor(null)} />}
      <Suspense fallback={null}><RecipeHost /></Suspense>
      {search && <Search onClose={() => setSearch(false)} goto={(sc, extra) => { emitNav(extra ?? {}); setScreen(sc as Screen); }} />}
      {assist && <Assistant key={assist.key} convo={convo} setConvo={setConvo} initial={assist.prompt} onClose={() => setAssist(null)} />}
      {inviteToken && <AcceptInvite token={inviteToken} onDone={() => { setInviteToken(null); reload(); }} />}
      {ezan.active && <EzanOverlay prayer={ezan.active.prayer} at={ezan.active.at} onClose={ezan.stop} />}
      {sleeping && <SleepScreen onWake={() => { wokeAt.current = Date.now(); lastActivity.current = Date.now(); setSleeping(false); }} />}
      {saver && <Screensaver onWake={() => { lastActivity.current = Date.now(); setSaver(false); }} />}
      {setup && <DeviceSetup onDone={() => setSetup(false)} />}
      </Suspense>
      {castMsg && <div className="castmsg" role="status" onClick={() => setCastMsg(null)}><span className="castmsg-ic">📱</span><span>{castMsg}</span></div>}
    </div>
  );
}

/** Nachtrust: bijna zwart scherm met een gedimde klok. Tik om twee minuten wakker te maken. */
function SleepScreen({ onWake }: { onWake: () => void }) {
  const [t, setT] = useState(clock());
  useEffect(() => { const i = setInterval(() => setT(clock()), 10_000); return () => clearInterval(i); }, []);
  return <div className="sleep" onPointerDown={onWake} role="button" tabIndex={0} aria-label={tr("Scherm wakker maken")}><span className="num">{t}</span></div>;
}

function ErrorScreen({ error }: { error: string }) {
  return (
    <div className="center">
      <div className="card auth">
        <div className="mascot" />
        <h1>{brand()}</h1>
        <p className="error">{error}</p>
        <button className="btn" onClick={() => location.reload()}>{tr("Opnieuw proberen")}</button>
      </div>
    </div>
  );
}
