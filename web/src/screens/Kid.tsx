/** De kindertablet: één kind, grote tegels, geen instellingen. Mijn dag met routine en afspraken, leren en spelen, Koran als dat pakket
 *  aanstaat, foto's, het weekmenu, en de apps die de ouders toelaten. Bedtijd dimt het scherm, schermtijd per dag kan begrensd worden;
 *  een ouder geeft vrij met de pincode. Op Android (device owner) staat de tablet in kiosk-modus en komt het kind er niet uit. */
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { Chore, Member, Occurrence, Weather } from "../types";
import { Avatar, cvar } from "../components/ui";
import { addDays, cap, clock, greeting, longDate, todayIso, weekday } from "../dates";
import { setDevice, useDevice } from "../device";
import { Celebration } from "../components/Profile";
import { kiosk, launchApp } from "../native";
import { t } from "../i18n";

const LearnApp = lazy(() => import("../components/Learn").then((m) => ({ default: m.LearnApp })));
const QuranApp = lazy(() => import("../components/Quran").then((m) => ({ default: m.QuranApp })));
const PhotosScreen = lazy(() => import("../screens/Photos").then((m) => ({ default: m.PhotosScreen })));
const MealsScreen = lazy(() => import("../screens/Meals").then((m) => ({ default: m.MealsScreen })));

export interface KidApp { label: string; package: string; url?: string; icon?: string }
export const parseKidApps = (s: string | undefined): KidApp[] => { try { const a = JSON.parse(s || "[]"); return Array.isArray(a) ? a.filter((x) => x && typeof x.label === "string").slice(0, 12) : []; } catch { return []; } };
type View = "home" | "day" | "learn" | "quran" | "photos" | "meals";
const hm = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const inWindow = (from: string, until: string, now = hm()) => !!from && !!until && (from < until ? now >= from && now < until : now >= from || now < until);
const usedKey = (d: string) => `gb.kid.used.${d}`;
const readUsed = (d: string) => { try { return Number(localStorage.getItem(usedKey(d)) || 0); } catch { return 0; } };

export function KidShell({ onParent }: { onParent: () => void }) {
  const { data } = useData();
  const dev = useDevice();
  const [view, setView] = useState<View>("home");
  const [time, setTime] = useState(clock());
  const [used, setUsed] = useState(() => readUsed(todayIso()));
  const [extra, setExtra] = useState(0); // minuten die een ouder vandaag extra gaf
  const [pin, setPin] = useState(false);
  const holdTimer = useRef(0);
  const s = data?.settings;
  const me = data?.members.find((m) => m.id === dev.memberId) ?? null;
  const limit = Number(s?.kid_screen_minutes ?? 0);
  const bedtime = inWindow(s?.kid_bedtime_from ?? "", s?.kid_bedtime_until ?? "");
  // schermtijd tellen: elke minuut dat het scherm aan staat en niet in bedtijd
  useEffect(() => {
    const i = setInterval(() => {
      setTime(clock());
      if (document.visibilityState !== "visible" || bedtime) return;
      const d = todayIso(); const n = readUsed(d) + 0.25; try { localStorage.setItem(usedKey(d), String(n)); } catch { /* */ } setUsed(n);
    }, 15_000);
    return () => clearInterval(i);
  }, [bedtime]);
  // nog geen enkele taak voor dit kind? Dan zetten we het leeftijdspakket (tanden poetsen, bed opmaken, …) klaar; ouders passen het aan bij Taken
  const seeded = useRef(false);
  useEffect(() => {
    if (!data || !me || seeded.current) return;
    if (data.chores.some((c) => c.memberId === me.id)) return;
    seeded.current = true;
    const y = me.birthday ? (Date.now() - Date.parse(me.birthday)) / (365.25 * 864e5) : 8;
    const age = y < 6 ? "kleuter" : y < 12 ? "lagere" : "tiener";
    api.get<{ ageSets: Record<string, string[]> }>("/chores/routines").then((c) => api.post("/chores/routines", { memberId: me.id, keys: c.ageSets[age] ?? [] })).catch(() => {});
  }, [data, me]);
  // kiosk-modus op Android zodra dit een kindertablet is
  useEffect(() => { void kiosk("start"); return () => { void kiosk("stop"); }; }, []);
  const over = limit > 0 && used >= limit + extra;
  const startHold = () => { holdTimer.current = window.setTimeout(() => setPin(true), 1500); };
  const endHold = () => clearTimeout(holdTimer.current);
  if (!data) return null;
  const apps = parseKidApps(s?.kid_apps);
  const islam = (s?.holidays ?? "").split(",").includes("islam");
  const header = (title: string, back?: () => void) => <div className="titleblock"><div className="titlerow">{back && <button className="btn ghost" onClick={back}>← {t("Terug")}</button>}<h1>{title}</h1></div></div>;

  const lock = bedtime || over;
  return (
    <div className="kid">
      <header className="kid-top" onPointerDown={startHold} onPointerUp={endHold} onPointerLeave={endHold}>
        {me && <Avatar m={me} size={52} dot={false} />}
        <span className="kid-hello"><small>{greeting()}</small><b>{me?.name ?? data.settings.family_name}</b></span>
        <span className="kid-clock"><b className="num">{time}</b><small>{cap(longDate(todayIso()))}</small></span>
      </header>
      {lock ? (
        <div className="kid-lock" onPointerDown={startHold} onPointerUp={endHold} onPointerLeave={endHold}>
          <span className="kid-lock-ic">{bedtime ? "🌙" : "⏳"}</span>
          <h1>{bedtime ? t("Slaap lekker, {n}", { n: me?.name ?? "" }) : t("Genoeg voor vandaag, {n}", { n: me?.name ?? "" })}</h1>
          <p>{bedtime ? t("De tablet gaat weer aan om {t}.", { t: s?.kid_bedtime_until ?? "" }) : t("Je hebt {n} minuten gespeeld. Morgen weer!", { n: Math.round(used) })}</p>
          <small className="muted">{t("Ouders: houd bovenaan lang ingedrukt voor de pincode.")}</small>
        </div>
      ) : view === "home" ? (
        <KidHome me={me} apps={apps} islam={islam} limit={limit} used={used} extra={extra} onView={setView} />
      ) : (
        <div className="kid-view page-scroll">
          <Suspense fallback={<div className="center"><div className="mascot thinking" /></div>}>
            {view === "day" && <KidDay me={me} onBack={() => setView("home")} />}
            {view === "learn" && <><div className="topbar">{header(t("Leren & spelen"), () => setView("home"))}</div><LearnApp /></>}
            {view === "quran" && <><div className="topbar">{header(t("Koran"), () => setView("home"))}</div><QuranApp /></>}
            {view === "photos" && <PhotosScreen header={header(t("Foto's"), () => setView("home"))} startSlideshow={() => {}} />}
            {view === "meals" && <MealsScreen header={header(t("Wat eten we?"), () => setView("home"))} />}
          </Suspense>
        </div>
      )}
      {pin && <ParentGate onClose={() => setPin(false)} onOk={(what) => { setPin(false); if (what === "extra") setExtra((x) => x + 30); else if (what === "parent") onParent(); else if (what === "role") { void kiosk("stop"); setDevice({ role: null, memberId: null }); } }} hasPin={!!data.settings.has_pin} />}
    </div>
  );
}

const MOMENT_NOW = (): "ochtend" | "middag" | "avond" => { const h = new Date().getHours(); return h < 12 ? "ochtend" : h < 17 ? "middag" : "avond"; };
const STICKERS = ["🦁", "🐼", "🦄", "🐬", "🦊", "🐨", "🦋", "🐙"];
function KidHome({ me, apps, islam, limit, used, extra, onView }: { me: Member | null; apps: KidApp[]; islam: boolean; limit: number; used: number; extra: number; onView: (v: View) => void }) {
  const { data } = useData();
  const act = useAction();
  const d = todayIso(); const wd = weekday(d);
  const [done, reload] = useRemote<string[]>(`/chores/done?from=${d}&to=${d}`, ["chores"], []);
  const [weather] = useRemote<Weather | null>("/weather", ["settings"], null);
  const [party, setParty] = useState(false);
  const set = new Set(done);
  const chores = (data?.chores ?? []).filter((c) => me && c.memberId === me.id && c.days.includes(wd));
  const n = chores.filter((c) => set.has(`${d}|${c.id}`)).length;
  const moment = MOMENT_NOW();
  const now = chores.filter((c) => (c.moment === moment || c.moment === "altijd") && !set.has(`${d}|${c.id}`)).slice(0, 4);
  const pts = me ? data?.points[me.id] : undefined;
  const left = limit > 0 ? Math.max(0, Math.round(limit + extra - used)) : null;
  const sticker = STICKERS[(new Date().getDate() + (me?.name.length ?? 0)) % STICKERS.length];
  const cd = (data?.countdowns ?? []).filter((c) => c.days >= 0).slice(0, 2);
  const toggle = async (c: Chore) => {
    await act(() => api.put(`/chores/${c.id}/done`, { date: d, done: true }), `+${c.points} ⭐`); reload();
    const fresh = new Set(await api.get<string[]>(`/chores/done?from=${d}&to=${d}`).catch(() => [])); if (chores.length && chores.every((x) => fresh.has(`${d}|${x.id}`))) setParty(true);
  };
  const tiles: { id: View | `app:${number}`; icon: string; label: string; sub?: string; color: string }[] = [
    { id: "day", icon: "☀️", label: t("Mijn dag"), sub: chores.length ? `${n}/${chores.length} ${t("taken")}` : undefined, color: "linear-gradient(135deg,#ffe9a8,#ffd6a5)" },
    { id: "learn", icon: "🎒", label: t("Leren & spelen"), sub: pts ? `⭐ ${pts.balance}` : undefined, color: "linear-gradient(135deg,#cfe9ff,#dcd6ff)" },
    ...(islam ? [{ id: "quran" as View, icon: "📖", label: t("Koran"), color: "linear-gradient(135deg,#efe6c8,#f7f1dd)" }] : []),
    { id: "photos", icon: "🖼️", label: t("Foto's"), color: "linear-gradient(135deg,#d6f3ec,#e7f6ff)" },
    { id: "meals", icon: "🍽️", label: t("Wat eten we?"), color: "linear-gradient(135deg,#ffd9d0,#ffe8dc)" },
    ...apps.map((a, i) => ({ id: `app:${i}` as const, icon: a.icon || "📱", label: a.label, color: "linear-gradient(135deg,#ece9ff,#f6f0ff)" })),
  ];
  return (
    <div className="kid-home">
      <section className="kid-now">
        <div className="kid-now-h">
          <span className="kid-sticker" aria-hidden>{sticker}</span>
          <div className="kid-now-t">
            <b>{moment === "ochtend" ? t("Goeiemorgen! Dit doe je nu:") : moment === "middag" ? t("Goeiemiddag! Dit staat nog te doen:") : t("Bijna bedtijd! Nog even dit:")}</b>
            <small>{chores.length ? t("{n} van {m} taken gedaan", { n, m: chores.length }) : t("Nog geen taken, vraag mama of papa om je routine aan te zetten")}</small>
          </div>
          <span className="kid-stars">⭐ {pts?.balance ?? 0}{pts?.today ? <small> +{pts.today}</small> : null}</span>
        </div>
        <div className="kid-bar"><i style={{ width: `${chores.length ? (n / chores.length) * 100 : 0}%` }} /></div>
        <div className="kid-now-tasks">
          {now.map((c) => <button key={c.id} className="kid-task" onClick={() => toggle(c)}><span className="kid-task-ic">{c.icon}</span><b>{c.title}</b><span className="kid-task-check" /></button>)}
          {!now.length && chores.length > 0 && <p className="kid-done-msg">🎉 {n === chores.length ? t("Alles gedaan! Jij bent een kampioen.") : t("Niets meer voor nu. Straks komt er meer!")}</p>}
        </div>
      </section>
      <div className="kid-strip">
        {weather && <span className="kid-chip">{weather.current.icon} {weather.current.temp}°</span>}
        {cd.map((c) => <span className="kid-chip" key={c.title}>{c.icon} {c.days === 0 ? t("vandaag!") : t("nog {n} nachtjes", { n: c.days })} · {c.title}</span>)}
        {left !== null && <span className="kid-chip">⏳ {t("nog {n} minuten vandaag", { n: left })}</span>}
      </div>
      <div className="kid-tiles">
        {tiles.map((x) => (
          <button key={x.id} className="kid-tile" style={{ background: x.color }} onClick={() => { if (x.id.startsWith("app:")) { const a = apps[Number(x.id.slice(4))]; void launchApp(a.package, a.url); } else onView(x.id as View); }}>
            <span className="kid-tile-ic" aria-hidden>{x.icon}</span><b>{x.label}</b>{x.sub && <small>{x.sub}</small>}
          </button>
        ))}
      </div>
      {party && <Celebration name={me?.name ?? ""} onDone={() => setParty(false)} />}
    </div>
  );
}

/** Mijn dag voor het kind: routine afvinken met grote knoppen, en de afspraken van vandaag. */
function KidDay({ me, onBack }: { me: Member | null; onBack: () => void }) {
  const { data } = useData();
  const act = useAction();
  const d = todayIso(); const wd = weekday(d);
  const [done, reload] = useRemote<string[]>(`/chores/done?from=${d}&to=${d}`, ["chores"], []);
  const [events] = useRemote<Occurrence[]>(`/events?from=${d}&to=${addDays(d, 1)}`, ["events"], []);
  const [party, setParty] = useState(false);
  const set = new Set(done);
  const chores: Chore[] = (data?.chores ?? []).filter((c) => me && c.memberId === me.id && c.days.includes(wd));
  const mine = events.filter((e) => e.on <= d && e.until >= d && (!me || !e.members.length || e.members.includes(me.id)));
  const toggle = async (c: Chore) => {
    const now = !set.has(`${d}|${c.id}`);
    await act(() => api.put(`/chores/${c.id}/done`, { date: d, done: now }), now ? `+${c.points} ⭐` : undefined); reload();
    if (now) { const fresh = new Set(await api.get<string[]>(`/chores/done?from=${d}&to=${d}`).catch(() => [])); if (chores.every((x) => fresh.has(`${d}|${x.id}`))) setParty(true); }
  };
  const groups: [string, string, Chore[]][] = [["ochtend", "🌅", chores.filter((c) => c.moment === "ochtend")], ["middag", "☀️", chores.filter((c) => c.moment === "middag")], ["avond", "🌙", chores.filter((c) => c.moment === "avond")], ["altijd", "⭐", chores.filter((c) => c.moment === "altijd")]];
  return (
    <div className="kid-day" style={me ? cvar(me.color) : undefined}>
      <div className="topbar"><button className="btn ghost" onClick={onBack}>← {t("Terug")}</button><h1>☀️ {t("Mijn dag")}</h1></div>
      {groups.filter(([, , list]) => list.length).map(([k, ic, list]) => (
        <section key={k} className="kid-sect">
          <h2>{ic} {t(k === "altijd" ? "Ook nog" : k === "ochtend" ? "Ochtend" : k === "middag" ? "Middag" : "Avond")}</h2>
          <div className="kid-tasks">
            {list.map((c) => { const ok = set.has(`${d}|${c.id}`); return (
              <button key={c.id} className={`kid-task${ok ? " done" : ""}`} onClick={() => toggle(c)} aria-pressed={ok}>
                <span className="kid-task-ic">{c.icon}</span><b>{c.title}</b><span className="kid-task-check">{ok ? "✓" : ""}</span>
              </button>
            ); })}
          </div>
        </section>
      ))}
      {!chores.length && <p className="empty">{t("Geen taken vandaag 🎈")}</p>}
      <section className="kid-sect">
        <h2>📅 {t("Vandaag")}</h2>
        {mine.length ? mine.map((e) => <div key={e.key} className="kid-event"><b className="num">{e.allDay ? t("hele dag") : e.startTime}</b><span>{e.title}</span></div>) : <p className="empty">{t("Niets gepland — een rustige dag.")}</p>}
      </section>
      {party && <Celebration name={me?.name ?? ""} onDone={() => setParty(false)} />}
    </div>
  );
}

/** Ouderpoort: pincode, dan kiezen: 30 minuten extra, oudermodus (de volledige app tot je terugkeert) of de toestelrol wijzigen. */
function ParentGate({ onClose, onOk, hasPin }: { onClose: () => void; onOk: (what: "extra" | "parent" | "role") => void; hasPin: boolean }) {
  const [pin, setPin] = useState(""); const [ok, setOk] = useState(!hasPin); const [err, setErr] = useState(false);
  const check = async () => { const r = await api.post<{ ok: boolean }>("/settings/verify-pin", { pin }).catch(() => ({ ok: false })); if (r.ok) setOk(true); else { setErr(true); setPin(""); } };
  return (
    <div className="kid-gate" onPointerDown={(e) => e.stopPropagation()}>
      <div className="card login">
        <h1>🔒 {t("Voor ouders")}</h1>
        {!ok ? (
          <>
            <input type="password" inputMode="numeric" autoFocus autoComplete="off" value={pin} onChange={(e) => { setPin(e.target.value); setErr(false); }} onKeyDown={(e) => e.key === "Enter" && check()} aria-label={t("Pincode")} />
            {err && <p className="error">{t("Die pincode klopt niet.")}</p>}
            <div className="actions"><button className="btn ghost" onClick={onClose}>{t("Annuleren")}</button><button className="btn" onClick={check} disabled={!pin}>{t("Openen")}</button></div>
          </>
        ) : (
          <div className="kid-gate-btns">
            {!hasPin && <p className="hint">{t("Er is nog geen ouder-pincode. Stel die in bij Instellingen → Pincode, anders kan het kind dit ook.")}</p>}
            <button className="btn" onClick={() => onOk("extra")}>⏳ {t("30 minuten extra")}</button>
            <button className="btn" onClick={() => onOk("parent")}>👨‍👩‍👧 {t("Oudermodus (volledige app)")}</button>
            <button className="btn ghost" onClick={() => onOk("role")}>🔁 {t("Toestelrol wijzigen")}</button>
            <button className="btn ghost" onClick={onClose}>{t("Sluiten")}</button>
          </div>
        )}
      </div>
    </div>
  );
}
