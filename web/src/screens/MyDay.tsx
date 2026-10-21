/** "Mijn dag": het startscherm van de telefoon-app. Persoonlijk (jouw afspraken, taken en eten) en de afstandsbediening van het keukenscherm. */
import { useState } from "react";
import { api } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { Device, Meal, Occurrence, Weather } from "../types";
import { isShopping } from "../types";
import { EventRow } from "../components/CalendarViews";
import type { EditorState } from "../components/EventEditor";
import { Avatar, cvar } from "../components/ui";
import { Icon } from "../components/Icons";
import { RecipeThumb, openRecipe, recipeTitle } from "../components/Recipes";
import { PrikbordWidget } from "../components/Prikbord";
import { BriefingCard } from "../components/Briefing";
import { FamilyWidget } from "../components/Family";
import { ConnectorWidgets } from "../components/Connectors";
import { addDays, cap, greeting, longDate, todayIso, weekday } from "../dates";
import { cast, setDevice, useDevice } from "../device";
import { t as tr } from "../i18n";

const SLOT_LABEL: Record<string, string> = { ontbijt: "Ontbijt", lunch: "Lunch", diner: "Avondeten" };
const SLOT_ICON: Record<string, string> = { ontbijt: "🥣", lunch: "🥪", diner: "🍽️" };

export function MyDayScreen({ openEditor, openAssistant, goto, openSearch, onPickMember }: {
  openEditor: (s: EditorState) => void; openAssistant: (prompt?: string) => void; goto: (s: "meals" | "chores" | "lists" | "calendar" | "apps") => void; openSearch: () => void; onPickMember: () => void;
}) {
  const { data, toast } = useData();
  const act = useAction();
  const dev = useDevice();
  const t = todayIso();
  const me = data?.members.find((m) => m.id === dev.memberId) ?? data?.members.find((m) => m.id === data.me.memberId) ?? null;
  const [events] = useRemote<Occurrence[]>(`/events?from=${t}&to=${addDays(t, 1)}`, ["events", "members"], []);
  const [meals] = useRemote<Meal[]>(`/meals?from=${t}&to=${t}`, ["meals"], []);
  const [weather] = useRemote<Weather | null>("/weather", ["settings"], null);
  const [devices] = useRemote<Device[]>("/devices", ["devices"], []);
  const [done, reloadDone] = useRemote<string[]>(`/chores/done?from=${t}&to=${t}`, ["chores"], []);
  const [quick, setQuick] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  if (!data) return null;
  const hubs = devices.filter((d) => d.role === "hub"), hubOnline = hubs.some((d) => d.online);
  const mine = events.filter((e) => e.on <= t && e.until >= t && (!me || !e.members.length || e.members.includes(me.id)));
  const wd = weekday(t), doneSet = new Set(done);
  const chores = data.chores.filter((c) => (!me || c.memberId === me.id) && c.days.includes(wd));
  const nDone = chores.filter((c) => doneSet.has(`${t}|${c.id}`)).length;
  const shop = data.lists.find(isShopping);
  const toggle = async (c: typeof chores[number]) => { const now = !doneSet.has(`${t}|${c.id}`); await act(() => api.put(`/chores/${c.id}/done`, { date: t, done: now }), now ? `+${c.points} ⭐` : undefined); reloadDone(); };
  const addQuick = async () => { if (!quick.trim() || !shop) return; if (await act(() => api.post(`/lists/${shop.id}/items`, { text: quick.trim() }), tr("Op {l} gezet", { l: shop.name }))) setQuick(""); };
  const toHub = async (kind: "screen" | "message", value: string) => { const r = await act(() => cast(kind, value)); if (r) toast(tr("Naar het keukenscherm gestuurd 📺")); };
  const hour = new Date().getHours();
  const order: ("ontbijt" | "lunch" | "diner")[] = hour < 10 ? ["ontbijt", "lunch", "diner"] : hour < 14 ? ["lunch", "diner", "ontbijt"] : ["diner", "lunch", "ontbijt"];

  return (
    <div className="myday page-scroll">
      <header className="myday-top">
        <button className="myday-who" onClick={onPickMember} aria-label={tr("Ander gezinslid kiezen")}>
          {me ? <Avatar m={me} size={46} dot={false} /> : <span className="avatar initial" style={{ "--size": "46px" } as React.CSSProperties}>👋</span>}
          <span><small>{greeting()}</small><b>{me?.name ?? data.settings.family_name}</b></span>
        </button>
        <span className="myday-meta">
          <b>{cap(longDate(t))}</b>
          {weather && <small>{weather.current.icon} {weather.current.temp}° · ↑{weather.days[0]?.max}° ↓{weather.days[0]?.min}°</small>}
        </span>
        <button className="iconbtn glass" onClick={openSearch} aria-label={tr("Zoeken")}><Icon.search /></button>
      </header>

      <section className={`hubcard${hubOnline ? " on" : ""}`}>
        <span className="hub-ic" aria-hidden>🖼️</span>
        <span className="hub-txt">
          <b>{hubs.length ? hubs[0].name : tr("Keukenscherm")}</b>
          <small>{hubOnline ? tr("Online · stuur iets naar het scherm") : hubs.length ? tr("Nu niet online") : tr("Nog geen wandscherm gekoppeld")}</small>
        </span>
        <span className="hub-btns">
          <button className="btn small" disabled={!hubOnline} onClick={() => toHub("screen", "today")}>{tr("Toon Bord")}</button>
          <button className="btn small ghost" disabled={!hubOnline} onClick={() => setMsg("")}>{tr("💬 Bericht")}</button>
        </span>
        {msg !== null && (
          <form className="addrow hub-msg" onSubmit={async (e) => { e.preventDefault(); if (msg.trim()) { await toHub("message", `${me ? me.name + ": " : ""}${msg.trim()}`); setMsg(null); } }}>
            <input value={msg} autoFocus onChange={(e) => setMsg(e.target.value)} placeholder={tr("bv. Ik ben om 18u thuis 🚗")} maxLength={200} />
            <button className="btn" type="submit" disabled={!msg.trim()}>{tr("Stuur")}</button>
          </form>
        )}
      </section>

      <div className="suggest myday-suggest">
        <button className="glass" onClick={() => openEditor({ defaults: { date: t, members: me ? [me.id] : [] } })}>📅 {tr("Afspraak")}</button>
        <button className="glass" onClick={() => goto("lists")}>🛒 {tr("Boodschappen")}{shop && shop.items.filter((i) => !i.done).length > 0 && <i className="count">{shop.items.filter((i) => !i.done).length}</i>}</button>
        <button className="glass" onClick={() => openAssistant()}>💧 {tr("Vraag het")}</button>
        <button className="glass" onClick={() => goto("apps")}>🎒 {tr("Apps")}</button>
      </div>

      <BriefingCard memberId={me?.id ?? null} compact />

      <section className="glass widget-sm">
        <div className="widget-h"><h2>{me ? tr("Mijn dag") : tr("Vandaag")}</h2><button className="linkbtn" onClick={() => goto("calendar")}>{tr("Agenda")}</button></div>
        <div className="upnext">
          {mine.map((e) => <EventRow key={e.key} e={e} onOpen={(o) => openEditor({ occ: o })} />)}
          {!mine.length && <p className="empty">{tr("Niets gepland — een rustige dag.")}</p>}
        </div>
      </section>

      <section className="glass widget-sm" style={me ? cvar(me.color) : undefined}>
        <div className="widget-h"><h2>{me ? tr("Mijn taken") : tr("Taken vandaag")} <small className="muted num">{nDone}/{chores.length}</small></h2><button className="linkbtn" onClick={() => goto("chores")}>{tr("Alles")}</button></div>
        <div className="rtasks">
          {chores.map((c) => { const d = doneSet.has(`${t}|${c.id}`); const owner = data.members.find((m) => m.id === c.memberId); return (
            <div className={`rtask${d ? " done" : ""}`} key={c.id} style={owner ? cvar(owner.color) : undefined}>
              <span className="rtask-ic" aria-hidden>{c.icon}</span>
              <span className="rtask-main"><b>{c.title}</b><small>{c.points}⭐{!me && owner ? ` · ${owner.name}` : ""}{c.moment !== "altijd" ? ` · ${tr(c.moment)}` : ""}</small></span>
              <button className={`rcheck${d ? " on" : ""}`} aria-pressed={d} aria-label={c.title} onClick={() => toggle(c)}>{d && "✓"}</button>
            </div>
          ); })}
          {!chores.length && <p className="empty">{tr("Geen taken vandaag 🎈")}</p>}
        </div>
      </section>

      <section className="glass widget-sm">
        <div className="widget-h"><h2>{tr("Eten vandaag")}</h2><button className="linkbtn" onClick={() => goto("meals")}>{tr("Weekmenu")}</button></div>
        <div className="mealstrip">
          {order.map((slot, i) => { const m = meals.find((x) => x.slot === slot); const r = m?.recipeId ? data.recipes.find((x) => x.id === m.recipeId) : undefined; return (
            <button className={`mealtile${i === 0 ? " main" : ""}${m ? "" : " empty"}`} key={slot} onClick={() => (r ? openRecipe(r.id) : goto("meals"))}>
              {m?.image || r ? <RecipeThumb r={{ image: m!.image, title: m!.title }} size={i === 0 ? 56 : 44} /> : <span className="mealtile-ic" aria-hidden>{SLOT_ICON[slot]}</span>}
              <span className="mealtile-txt"><small>{tr(SLOT_LABEL[slot])}</small><b>{(r ? recipeTitle(r) : m?.title) ?? tr("Nog niets")}</b></span>
            </button>
          ); })}
        </div>
      </section>

      {shop && (
        <section className="glass widget-sm">
          <div className="widget-h"><h2>🛒 {shop.name} <small className="muted num">{shop.items.filter((i) => !i.done).length}</small></h2><button className="linkbtn" onClick={() => goto("lists")}>{tr("Open")}</button></div>
          <form className="addrow" onSubmit={(e) => { e.preventDefault(); addQuick(); }}>
            <input value={quick} onChange={(e) => setQuick(e.target.value)} placeholder={tr("Snel iets toevoegen…")} aria-label={tr("Boodschap toevoegen")} />
            <button className="btn" type="submit" disabled={!quick.trim()}>+</button>
          </form>
          <div className="chips">{shop.items.filter((i) => !i.done).slice(0, 8).map((i) => <span className="chip" key={i.id}>{i.text}</span>)}</div>
        </section>
      )}

      <PrikbordWidget max={3} onMore={() => goto("apps")} />
      <ConnectorWidgets memberId={me?.id ?? null} />
      <FamilyWidget />
      {dev.role === "phone" && !dev.memberId && data.members.length > 0 && (
        <p className="hint center-text">{tr("Tip: kies van wie deze telefoon is, dan zie je alleen jouw afspraken en taken.")} <button className="linkbtn" onClick={() => setDevice({ memberId: data.me.memberId ?? data.members[0].id })}>{tr("Dat ben ik")}</button></p>
      )}
    </div>
  );
}
