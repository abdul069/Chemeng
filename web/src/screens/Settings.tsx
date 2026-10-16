import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { CalendarSub, Member } from "../types";
import { AVATARS, Avatar, Confirm, EmojiPicker, MemberPicks, Modal } from "../components/ui";
import { Icon } from "../components/Icons";
import { AccountSection, AgendaSharing, HouseholdAccess } from "./Access";

const COLORS = ["#4a7bd8", "#d9576b", "#4f9e5b", "#8a62d1", "#e08a3c", "#2bb3a8", "#c9a227", "#d36fb3", "#5b6b7f", "#3d9bd1"];
const THEME_KEY = "gezinsbord.theme";

/** De app heeft één vaste, lichte stijl, los van licht/donker op het toestel. */
export function applyTheme() {
  document.documentElement.removeAttribute("data-theme");
  try { localStorage.removeItem(THEME_KEY); } catch { /* */ }
}

export function SettingsScreen({ header }: { header: React.ReactNode }) {
  const { data } = useData();
  const [unlocked, setUnlocked] = useState(false);
  if (!data) return null;
  if (data.settings.has_pin && !unlocked) return <><div className="topbar">{header}</div><PinLock onOk={() => setUnlocked(true)} /></>;
  return (
    <>
      <div className="topbar">{header}</div>
      <div className="page-scroll" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 16, maxWidth: 900 }}>
        <AccountSection />
        <Family />
        <HouseholdAccess />
        <AgendaSharing />
        <Calendars />
        <Place />
        <Screen />
        <Notifications />
        <Security />
        <LibraryStatus />
        <Assistant />
      </div>
    </>
  );
}

function PinLock({ onOk }: { onOk: () => void }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);
  const check = async () => {
    const r = await api.post<{ ok: boolean }>("/settings/verify-pin", { pin }).catch(() => ({ ok: false }));
    if (r.ok) onOk(); else { setErr(true); setPin(""); }
  };
  return (
    <div className="center">
      <div className="card login">
        <h1><Icon.lock /> Instellingen</h1>
        <p className="hint">Voer de ouder-pincode in om instellingen te wijzigen.</p>
        <input id="pin" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => { setPin(e.target.value); setErr(false); }} onKeyDown={(e) => e.key === "Enter" && check()} aria-label="Pincode" />
        {err && <p className="error">Die pincode klopt niet.</p>}
        <button className="btn" onClick={check} disabled={!pin}>Openen</button>
      </div>
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="section-title" style={{ marginBottom: 0 }}><h2>{title}</h2>{action}</div>
      {children}
    </section>
  );
}

function useSetting() {
  const act = useAction();
  return (values: Record<string, string | number | boolean>, msg = "Bewaard") => act(() => api.put("/settings", values), msg);
}

function Family() {
  const { data } = useData();
  const act = useAction();
  const save = useSetting();
  const [edit, setEdit] = useState<Member | "new" | null>(null);
  const [name, setName] = useState(data!.settings.family_name);
  const move = (i: number, d: number) => {
    const ids = data!.members.map((m) => m.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    act(() => api.post("/members/reorder", { ids }));
  };
  return (
    <Section title="Gezin" action={<button className="btn small" onClick={() => setEdit("new")}><Icon.plus /> Gezinslid</button>}>
      <label className="field"><span>Naam van het gezin</span>
        <div className="addrow"><input id="fam-name" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn ghost" disabled={name === data!.settings.family_name} onClick={() => save({ family_name: name })}>Bewaren</button></div>
      </label>
      <div className="upnext">
        {data!.members.map((m, i) => (
          <div className="item" key={m.id}>
            <Avatar m={m} size={40} dot={false} />
            <span style={{ flex: 1 }}><b>{m.name}</b><small>{m.role === "ouder" ? "Ouder" : m.role === "huisdier" ? "Huisdier" : "Kind"}{m.userId ? " · heeft een account" : ""}</small></span>
            <button className="iconbtn" aria-label={`${m.name} omhoog`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
            <button className="iconbtn" aria-label={`${m.name} omlaag`} disabled={i === data!.members.length - 1} onClick={() => move(i, 1)}>↓</button>
            <button className="btn ghost small" onClick={() => setEdit(m)}>Bewerken</button>
          </div>
        ))}
      </div>
      {data!.me.role === "beheerder" && data!.members.length <= 1 && (
        <button className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={() => act(() => api.post("/household/demo"), "Voorbeeldgezin geladen")}>Voorbeeldgegevens laden om te proberen</button>
      )}
      {edit && <MemberEditor member={edit === "new" ? undefined : edit} onClose={() => setEdit(null)} />}
    </Section>
  );
}

function MemberEditor({ member, onClose }: { member?: Member; onClose: () => void }) {
  const act = useAction();
  const [f, setF] = useState({ name: member?.name ?? "", color: member?.color ?? COLORS[0], avatar: member?.avatar ?? "🙂", photo: member?.photo ?? null as string | null, role: member?.role ?? "kind", birthday: member?.birthday ?? "", diet: member?.diet ?? "" });
  const [confirm, setConfirm] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const upload = async (fl: FileList | null) => {
    if (!fl?.[0]) return;
    const fd = new FormData();
    fd.append("photo", fl[0]);
    const r = await act(() => api.post<{ filename: string }>("/avatar", fd));
    if (r) setF((x) => ({ ...x, photo: r.filename }));
  };
  const save = async () => {
    if (!f.name.trim()) return;
    const body = { ...f, birthday: f.birthday || null };
    if (await act(() => (member ? api.put(`/members/${member.id}`, body) : api.post("/members", body)), "Gezinslid bewaard")) onClose();
  };
  const preview: Member = { id: "p", sort: 0, ...f, name: f.name || "?" };
  return (
    <Modal title={member ? member.name : "Nieuw gezinslid"} onClose={onClose}>
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <Avatar m={preview} size={72} dot={false} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn ghost small" onClick={() => file.current?.click()}><Icon.upload /> Foto</button>
          {f.photo && <button className="btn ghost small" onClick={() => setF({ ...f, photo: null })}>Foto weghalen</button>}
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files)} />
        </div>
      </div>
      <div className="row2">
        <label className="field"><span>Naam</span><input id="mb-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field"><span>Verjaardag (voor het aftellen)</span><input id="mb-bd" type="date" value={f.birthday} onChange={(e) => setF({ ...f, birthday: e.target.value })} /></label>
        <label className="field"><span>Vermijden: allergieën of voorkeuren (komma's)</span><input id="mb-diet" value={f.diet} onChange={(e) => setF({ ...f, diet: e.target.value })} placeholder="bv. noten, varkensvlees, garnalen" /></label>
      </div>
      <div className="field"><span>Rol</span>
        <div className="picks">
          {(["ouder", "kind", "huisdier"] as const).map((r) => <button key={r} type="button" className="pick" aria-pressed={f.role === r} onClick={() => setF({ ...f, role: r, avatar: r === "huisdier" && f.avatar === "🙂" ? "🐶" : f.avatar })}>{r === "ouder" ? "Ouder" : r === "kind" ? "Kind" : "🐾 Huisdier"}</button>)}
        </div>
      </div>
      <div className="field"><span>Kleur</span>
        <div className="picks">{COLORS.map((c) => <button key={c} type="button" className="pick" aria-label={c} aria-pressed={f.color === c} style={{ "--c": c, width: 40, height: 40, padding: 0 } as React.CSSProperties} onClick={() => setF({ ...f, color: c })} />)}</div>
      </div>
      {!f.photo && <div className="field"><span>Figuurtje</span><EmojiPicker value={f.avatar} onChange={(avatar) => setF({ ...f, avatar })} options={AVATARS} /></div>}
      <div className="actions">
        {member && <button className="btn danger left" onClick={() => setConfirm(true)}>Verwijderen</button>}
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button className="btn" onClick={save} disabled={!f.name.trim()}>Bewaren</button>
      </div>
      {confirm && member && <Confirm title={`${member.name} verwijderen?`} text="Ook de taken van dit gezinslid worden verwijderd. Afspraken blijven bestaan voor de anderen." onClose={() => setConfirm(false)}
        actions={[{ label: "Verwijderen", run: async () => { if (await act(() => api.del(`/members/${member.id}`), "Gezinslid verwijderd")) onClose(); } }]} />}
    </Modal>
  );
}

function Calendars() {
  const { data } = useData();
  const act = useAction();
  const [edit, setEdit] = useState<CalendarSub | "new" | null>(null);
  return (
    <Section title="Gekoppelde agenda's" action={<button className="btn small" onClick={() => setEdit("new")}><Icon.plus /> Agenda</button>}>
      <p className="hint">Koppel Google Agenda, Outlook of iCloud via het iCal-adres. In Google Agenda vind je dat bij Instellingen → je agenda → <b>Geheim adres in iCal-indeling</b>. De afspraken worden elk kwartier bijgewerkt.</p>
      <HolidayToggles />
      <div className="upnext">
        {data!.calendars.map((c) => (
          <div className="item" key={c.id}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b>{c.name}</b>
              <small>{c.lastError ? <span className="error">{c.lastError}</span> : c.lastSync ? `Bijgewerkt ${new Date(c.lastSync + "Z").toLocaleString("nl-BE")}` : "Nog niet bijgewerkt"}</small>
            </span>
            <button className="btn ghost small" onClick={() => setEdit(c)}>Bewerken</button>
          </div>
        ))}
        {!data!.calendars.length && <p className="hint">Nog geen agenda's gekoppeld.</p>}
      </div>
      {!!data!.calendars.length && <button className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={() => act(() => api.post("/calendars/sync"), "Agenda's bijgewerkt")}><Icon.sync /> Nu bijwerken</button>}
      {edit && <CalendarEditor cal={edit === "new" ? undefined : edit} onClose={() => setEdit(null)} />}
    </Section>
  );
}

function CalendarEditor({ cal, onClose }: { cal?: CalendarSub; onClose: () => void }) {
  const act = useAction();
  const { toast } = useData();
  const [f, setF] = useState({ name: cal?.name ?? "", url: cal?.url ?? "", members: cal?.members ?? [] });
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await act(() => (cal ? api.put(`/calendars/${cal.id}`, f) : api.post<{ ok: boolean; events?: number; error?: string }>("/calendars", f)));
    setBusy(false);
    if (!r) return;
    const res = r as { ok: boolean; events?: number; error?: string };
    if (res.ok === false) toast(`Gekoppeld, maar ophalen mislukte: ${res.error}`);
    else toast(res.events !== undefined ? `${res.events} afspraken opgehaald` : "Agenda bewaard");
    onClose();
  };
  return (
    <Modal title={cal ? cal.name : "Agenda koppelen"} onClose={onClose}>
      <label className="field"><span>Naam</span><input id="cal-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="bv. Werk Papa" /></label>
      <label className="field"><span>iCal-adres</span><input id="cal-url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" /></label>
      <div className="field"><span>Toon bij</span><MemberPicks value={f.members} onChange={(members) => setF({ ...f, members })} /></div>
      <div className="actions">
        {cal && <button className="btn danger left" onClick={() => setConfirm(true)}>Ontkoppelen</button>}
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button className="btn" onClick={save} disabled={busy || !f.name.trim() || !f.url.trim()}>{busy ? "Ophalen…" : "Bewaren"}</button>
      </div>
      {confirm && cal && <Confirm title="Agenda ontkoppelen?" text="De afspraken uit deze agenda verdwijnen van het scherm. In de agenda zelf blijven ze bestaan." onClose={() => setConfirm(false)}
        actions={[{ label: "Ontkoppelen", run: async () => { if (await act(() => api.del(`/calendars/${cal.id}`), "Agenda ontkoppeld")) onClose(); } }]} />}
    </Modal>
  );
}

function Place() {
  const { data } = useData();
  const save = useSetting();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ name: string; latitude: number; longitude: number; region: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => api.get<typeof results>(`/geocode?q=${encodeURIComponent(q)}`).then(setResults).catch(() => setResults([])), 350);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <Section title="Weer en woonplaats">
      <p className="hint">Huidige woonplaats: <b>{data!.settings.city}</b>. Het weer komt van Open-Meteo.</p>
      <input id="city" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek je gemeente…" aria-label="Gemeente zoeken" />
      <div className="picks">
        {results.map((r) => (
          <button key={`${r.latitude},${r.longitude}`} className="pick" onClick={async () => { await save({ city: r.name, latitude: r.latitude, longitude: r.longitude }, `Woonplaats: ${r.name}`); setQ(""); }}>
            {r.name} <small className="muted">{r.region}</small>
          </button>
        ))}
      </div>
    </Section>
  );
}

function Screen() {
  const { data } = useData();
  const save = useSetting();
  const s = data!.settings;
  return (
    <Section title="Scherm">
      <div className="row2">
        <label className="field"><span>Fotolijst na</span>
          <select id="saver" value={s.screensaver_minutes} onChange={(e) => save({ screensaver_minutes: e.target.value })}>
            {["0", "2", "5", "10", "15", "30", "60"].map((v) => <option key={v} value={v}>{v === "0" ? "Nooit" : `${v} minuten`}</option>)}
          </select>
        </label>
        <label className="field"><span>Week begint op</span>
          <select id="weekstart" value={s.week_start} onChange={(e) => save({ week_start: e.target.value })}>
            <option value="1">Maandag</option><option value="0">Zondag</option>
          </select>
        </label>
      </div>
      <div className="row3">
        <label className="field"><span>Nachtrust van</span><input id="sleep-from" type="time" value={s.sleep_from} onChange={(e) => save({ sleep_from: e.target.value })} /></label>
        <label className="field"><span>tot</span><input id="sleep-until" type="time" value={s.sleep_until} onChange={(e) => save({ sleep_until: e.target.value })} /></label>
        <label className="field"><span>Terug naar Vandaag na</span>
          <select id="home-after" value={s.home_after_minutes} onChange={(e) => save({ home_after_minutes: e.target.value })}>
            {["0", "1", "3", "5", "10"].map((v) => <option key={v} value={v}>{v === "0" ? "Nooit" : `${v} min zonder aanraking`}</option>)}
          </select>
        </label>
      </div>
      <p className="hint">Tijdens de nachtrust toont het scherm alleen een gedimde klok. Tik om het even wakker te maken. Laat beide uren leeg om dit uit te zetten.</p>
      <label className="check-row"><input id="voice" type="checkbox" checked={s.assistant_voice === "1"} onChange={(e) => save({ assistant_voice: e.target.checked ? "1" : "0" })} /> Antwoorden van de assistent voorlezen</label>
    </Section>
  );
}

const b64ToU8 = (b64: string) => { const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64.length / 4) * 4, "=")); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
const deviceLabel = () => { const u = navigator.userAgent; return /iPhone|iPad/.test(u) ? "iPhone/iPad" : /Android/.test(u) ? "Android" : /Windows/.test(u) ? "Windows" : /Mac/.test(u) ? "Mac" : "Toestel"; };

/** Meldingen op dit toestel aan- of uitzetten. */
function Notifications() {
  const act = useAction();
  const { toast } = useData();
  const [info] = useRemote<{ key: string; devices: { endpoint: string; label: string; created_at: string }[] } | null>("/push/key", ["access"], null);
  const [mine, setMine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  useEffect(() => {
    if (!supported) return;
    navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => setMine(s?.endpoint ?? null)).catch(() => {});
  }, [supported]);
  const enable = async () => {
    if (!info) return;
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { toast("Meldingen zijn geweigerd. Zet ze aan in de instellingen van je browser of telefoon."); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(info.key) });
      await api.post("/push/subscribe", { subscription: sub.toJSON(), label: deviceLabel() });
      setMine(sub.endpoint);
      toast("Meldingen staan aan op dit toestel");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Meldingen aanzetten lukte niet.");
    } finally { setBusy(false); }
  };
  const disable = async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await api.post("/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
    setMine(null);
    toast("Meldingen staan uit op dit toestel");
  };
  return (
    <Section title="Meldingen">
      <p className="hint">Je krijgt een melding 15 minuten voor een afspraak waar jij (of je kind) bij hoort, elke ochtend om 7:30 een dagoverzicht, en bij een nieuwe spraakmemo. Zet dit aan op elk toestel apart. Op iPhone werkt het alleen als de app op het beginscherm staat.</p>
      {!supported && <p className="error">Deze browser ondersteunt geen meldingen. Installeer de app op je beginscherm en probeer opnieuw.</p>}
      <div className="actions" style={{ justifyContent: "flex-start" }}>
        {mine
          ? <><span className="badge">Aan op dit toestel</span><button className="btn ghost small" onClick={() => act(() => api.post("/push/test"), "Testmelding verstuurd")}>Testmelding</button><button className="btn ghost small" onClick={disable}>Uitzetten</button></>
          : <button className="btn" onClick={enable} disabled={!supported || busy || !info}>{busy ? "Even geduld…" : "Meldingen aanzetten op dit toestel"}</button>}
      </div>
      {!!info?.devices.length && <p className="hint">Toestellen met meldingen: {info.devices.map((d) => d.label || "toestel").join(", ")}.</p>}
    </Section>
  );
}

function Security() {
  const { data } = useData();
  const save = useSetting();
  const [pin, setPin] = useState("");
  return (
    <Section title="Ouder-pincode">
      <p className="hint">Met een pincode kunnen kinderen de instellingen niet wijzigen. {data!.settings.has_pin ? "Er is een pincode ingesteld." : "Er is nog geen pincode."}</p>
      <div className="addrow">
        <input id="newpin" type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="Nieuwe pincode (4 tot 8 cijfers)" aria-label="Nieuwe pincode" />
        <button className="btn" disabled={pin.length < 4} onClick={async () => { await save({ settings_pin: pin }, "Pincode ingesteld"); setPin(""); }}>Instellen</button>
        {data!.settings.has_pin && <button className="btn ghost" onClick={() => save({ settings_pin: "" }, "Pincode verwijderd")}>Verwijderen</button>}
      </div>
      <p className="hint" style={{ marginTop: 8 }}>Back-up: download alle gegevens van je gezin (afspraken, taken, recepten, lijsten) als bestand. <a className="btn ghost small" href="/api/export" download>⬇️ Back-up downloaden</a></p>
    </Section>
  );
}

function Assistant() {
  const { data, toast } = useData();
  const act = useAction();
  const [key, setKey] = useState("");
  const [ws, setWs] = useState("");
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<{ ok: boolean; error?: string; needsWorkspace?: boolean } | null>(null);
  const admin = data!.me.role === "beheerder";
  useEffect(() => { if (admin && data!.assistant.available) api.get<{ ok: boolean; error?: string; needsWorkspace?: boolean }>("/settings/api-check").then(setCheck).catch(() => {}); }, [admin, data!.assistant.available, data!.assistant.keySource]);
  const save = async () => {
    setBusy(true);
    const ok = await act(() => api.put("/settings/api-key", { key: key.trim(), workspace: ws.trim() }), "Sleutel gecontroleerd en bewaard. De assistent is actief; de receptenbibliotheek wordt nu vertaald.");
    setBusy(false);
    if (ok) { setKey(""); setCheck({ ok: true }); }
  };
  const saveWs = async () => {
    setBusy(true);
    const ok = await act(() => api.put("/settings/api-workspace", { workspace: ws.trim() }), "Workspace-ID bewaard. De assistent werkt nu; de bibliotheek wordt vertaald.");
    setBusy(false);
    if (ok) setCheck({ ok: true });
  };
  return (
    <Section title="Assistent">
      {data!.assistant.available
        ? <p className="hint">De assistent is actief en gebruikt Claude ({data!.assistant.model}). Hij kan afspraken, maaltijden, taken, lijsten en recepten beheren, vertaalt de receptenbibliotheek en leest brieven en flyers. Tik op het figuurtje of op “Praat” en spreek je vraag in.</p>
        : <p className="hint">De assistent staat uit. Vul hieronder je Claude API-sleutel in (aanmaken op <b>console.anthropic.com</b> → API keys). Daarna werken de assistent, slim importeren en het vertalen van de receptenbibliotheek meteen.</p>}
      {data!.assistant.canEditKey && data!.assistant.keySource !== "env" && (
        <form className="addrow" onSubmit={(e) => { e.preventDefault(); if (key.trim()) save(); }}>
          <input id="api-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={data!.assistant.available ? "Nieuwe sleutel (sk-ant-…)" : "sk-ant-…"} aria-label="Claude API-sleutel" autoComplete="off" />
          <button className="btn" type="submit" disabled={busy || key.trim().length < 10}>{busy ? "Controleren…" : "Bewaren"}</button>
          {data!.assistant.available && data!.assistant.keySource === "app" && <button type="button" className="btn ghost" onClick={async () => { if (await act(() => api.del("/settings/api-key"), "Sleutel verwijderd")) toast("De assistent staat nu uit"); }}>Verwijderen</button>}
        </form>
      )}
      {check && !check.ok && (
        <div className="invite-card">
          <b>De sleutel werkt nog niet.</b>
          <p className="hint">{check.needsWorkspace ? "Anthropic meldt dat deze sleutel niet aan een workspace gekoppeld is. Vul de workspace-ID in (console.anthropic.com → Settings → Workspaces → de ID, begint met wrkspc_), of maak een nieuwe sleutel aan binnen een workspace." : check.error}</p>
          {data!.assistant.canEditKey && (
            <div className="addrow">
              <input id="api-ws" value={ws} onChange={(e) => setWs(e.target.value)} placeholder="wrkspc_…" aria-label="Workspace-ID" />
              <button className="btn" disabled={busy || ws.trim().length < 6} onClick={saveWs}>{busy ? "Controleren…" : "Workspace bewaren"}</button>
            </div>
          )}
        </div>
      )}
      {check?.ok && <p className="hint">✅ Verbinding met Claude gecontroleerd: alles werkt.</p>}
      {data!.assistant.keySource === "env" && <p className="hint">De sleutel staat in de omgeving van de server (ANTHROPIC_API_KEY{data!.assistant.canEditKey ? "; een workspace-ID kan hierboven of als ANTHROPIC_WORKSPACE_ID" : ""}).</p>}
      {!data!.assistant.canEditKey && !data!.assistant.available && <p className="hint">Alleen de beheerder van het eerste gezin op deze server kan de sleutel invullen.</p>}
    </Section>
  );
}

/** Feestdagen die automatisch in de kalender en bij het aftellen staan. */
function HolidayToggles() {
  const { data } = useData();
  const save = useSetting();
  const on = new Set((data!.settings.holidays ?? "").split(",").filter(Boolean));
  const toggle = (k: string) => { const n = new Set(on); if (n.has(k)) n.delete(k); else n.add(k); save({ holidays: [...n].join(",") }, "Feestdagen bijgewerkt"); };
  return (
    <div className="field"><span>Feestdagen automatisch in de kalender</span>
      <div className="picks">
        <button type="button" className="pick" aria-pressed={on.has("be")} onClick={() => toggle("be")}>🇧🇪 Belgische feestdagen</button>
        <button type="button" className="pick" aria-pressed={on.has("islam")} onClick={() => toggle("islam")}>🌙 Ramadan, Suiker- en Offerfeest</button>
      </div>
    </div>
  );
}

/** Stand van de gedeelde receptenbibliotheek, voor de beheerder. */
function LibraryStatus() {
  const { data } = useData();
  const act = useAction();
  const [ov, reload] = useRemote<{ categories: { key: string; name: string; icon: string; n: number }[]; total: number; translated?: number; crawl: { running: boolean; site: string | null; done: number; total: number; added: number; finishedAt: string | null } }>("/library/categories", ["recipes"], { categories: [], total: 0, crawl: { running: false, site: null, done: 0, total: 0, added: 0, finishedAt: null } });
  const admin = data!.me.role === "beheerder";
  return (
    <Section title="Receptenbibliotheek">
      <p className="hint">{ov.total} Turkse recepten in de gedeelde bibliotheek, verdeeld over {ov.categories.length} categorieën{ov.translated ? `, ${ov.translated} met Nederlandse naam` : ""}. Ze wordt elke dag aangevuld vanaf de receptsites.
        {ov.crawl.running ? ` Nu bezig: ${ov.crawl.site ?? "…"} (${ov.crawl.done}/${ov.crawl.total}, ${ov.crawl.added} nieuw).` : ov.crawl.finishedAt ? ` Laatste beurt: ${new Date(ov.crawl.finishedAt).toLocaleString("nl-BE", { dateStyle: "short", timeStyle: "short" })}.` : ""}
        {!data!.assistant.available && " Vertalen naar het Nederlands start zodra de Claude-sleutel ingevuld is (Instellingen → Assistent)."}</p>
      <div className="picks">{ov.categories.map((c) => <span key={c.key} className="badge">{c.icon} {c.name} {c.n}</span>)}</div>
      {admin && <div className="addrow">
        <button className="btn ghost small" disabled={ov.crawl.running} onClick={() => act(() => api.post("/library/crawl"), "Bijwerken gestart").then(() => setTimeout(reload, 1500))}>⟳ Nu bijwerken</button>
        {data!.assistant.available && <button className="btn ghost small" onClick={() => act(() => api.post("/library/translate-titles"), "Titels worden vertaald…")}>🇳🇱 Titels vertalen</button>}
      </div>}
    </Section>
  );
}
