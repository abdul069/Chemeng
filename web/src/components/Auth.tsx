import { useEffect, useState } from "react";
import { api, ApiError, reconnectRealtime } from "../api";
import type { InviteInfo } from "../types";
import { t } from "../i18n";

export const inviteTokenFromUrl = () => location.pathname.match(/^\/uitnodiging\/([\w-]+)/)?.[1] ?? null;
export const resetTokenFromUrl = () => location.pathname.match(/^\/herstel\/([\w-]+)/)?.[1] ?? null;
const clearInviteUrl = () => history.replaceState(null, "", "/");

export function InviteCard({ info }: { info: InviteInfo }) {
  if (!info.valid) return <div className="invite-card"><b>{t("Uitnodiging niet geldig")}</b><p className="hint">{info.reason}</p></div>;
  return (
    <div className="invite-card">
      {info.kind === "link" ? (
        <>
          <b>{t("{n} wil gezin “{h}” met jouw gezin verbinden", { n: info.from, h: info.household })}</b>
          <p className="hint">{t("Jullie zien dan elkaars agenda, foto's, verjaardagen en briefjes op het Bord, en kunnen elkaar briefjes sturen. Wat je deelt kies je zelf bij Instellingen → Verbonden gezinnen. Je moet beheerder zijn van je eigen gezin.")}</p>
        </>
      ) : info.kind === "household" ? (
        <>
          <b>{t("{n} nodigt je uit in “{h}”", { n: info.from, h: info.household })}</b>
          <p className="hint">Je ziet en beheert dan de kalender, taken, maaltijden en lijsten van dit gezin{info.member ? `, als ${info.member}` : ""}.</p>
        </>
      ) : (
        <>
          <b>{info.from} deelt zijn of haar agenda met je</b>
          <p className="hint">{info.level === "bezet" ? t("Je ziet wanneer {n} bezet is", { n: info.from }) : t("Je ziet de afspraken van {n}", { n: info.from })}, {t("naast je eigen gezin.")} {t("Afspraken met de familie van {n} zie je enkel als “niet beschikbaar”. {n} ziet jouw agenda niet, tenzij je ze zelf terugdeelt.", { n: info.from })}</p>
        </>
      )}
    </div>
  );
}

function useInvite(token: string | null) {
  const [info, setInfo] = useState<InviteInfo | null>(null);
  useEffect(() => { if (token) api.get<InviteInfo>(`/invites/${token}`).then(setInfo).catch(() => setInfo({ valid: false, reason: t("De uitnodiging kon niet geladen worden.") })); }, [token]);
  return info;
}

/** Aanmelden of een account maken (eventueel via een uitnodiging). */
export function AuthScreen({ onDone }: { onDone: () => void }) {
  const token = inviteTokenFromUrl();
  const info = useInvite(token);
  const [mode, setMode] = useState<"login" | "register">(token ? "register" : "login");
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (mode === "register") {
        await api.post("/auth/register", { ...f, invite: info?.valid ? token : undefined });
      } else {
        await api.post("/auth/login", { email: f.email, password: f.password });
        if (token && info?.valid) await api.post(`/invites/${token}/accept`).catch(() => {});
      }
      clearInviteUrl();
      reconnectRealtime();
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("Er ging iets mis."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center">
      <form className="card auth" onSubmit={submit}>
        <div className="mascot" />
        <h1>{mode === "login" ? t("Aanmelden") : t("Account maken")}</h1>
        {info && <InviteCard info={info} />}
        {mode === "register" && (
          <label className="field"><span>{t("Je naam")}</span><input id="au-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" required /></label>
        )}
        <label className="field"><span>{t("E-mailadres")}</span><input id="au-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" required /></label>
        <label className="field"><span>Wachtwoord{mode === "register" ? t(" (minstens 8 tekens)") : ""}</span>
          <input id="au-pw" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "register" ? 8 : undefined} required />
        </label>
        {err && <p className="error">{err}</p>}
        <button className="btn" type="submit" disabled={busy}>{busy ? t("Even geduld…") : mode === "login" ? (token ? t("Aanmelden en uitnodiging aanvaarden") : t("Aanmelden")) : (token ? t("Account maken en aanvaarden") : t("Account maken"))}</button>
        <p className="switch">
          {mode === "login" ? t("Nog geen account? ") : t("Heb je al een account? ")}
          <button type="button" className="linkbtn" onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(null); }}>{mode === "login" ? t("Account maken") : t("Aanmelden")}</button>
        </p>
        {mode === "register" && !token && <p className="hint">{t("Je krijgt meteen je eigen gezin, waarin je daarna je partner en kinderen kunt toevoegen of uitnodigen.")}</p>}
        {mode === "login" && <p className="hint">{t("Wachtwoord vergeten? Vraag de beheerder van je gezin om een herstel-link (Instellingen → Toegang tot het gezin).")}</p>}
      </form>
    </div>
  );
}

/** Voor wie al aangemeld is en een uitnodigingslink opent. */
export function AcceptInvite({ token, onDone }: { token: string; onDone: () => void }) {
  const info = useInvite(token);
  const [err, setErr] = useState<string | null>(null);
  const accept = async () => {
    try {
      await api.post(`/invites/${token}/accept`);
      clearInviteUrl();
      reconnectRealtime();
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("Aanvaarden mislukte."));
    }
  };
  return (
    <div className="modal-back">
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-h"><h2>{t("Uitnodiging")}</h2></div>
        {info ? <InviteCard info={info} /> : <p className="hint">{t("Laden…")}</p>}
        {err && <p className="error">{err}</p>}
        <div className="actions">
          <button className="btn ghost" onClick={() => { clearInviteUrl(); onDone(); }}>{t("Niet nu")}</button>
          {info?.valid && <button className="btn" onClick={accept}>{t("Aanvaarden")}</button>}
        </div>
      </div>
    </div>
  );
}

/** Aangemeld, maar nog geen gezin (bv. na verwijderd te zijn uit een gezin). */
export function NoHousehold({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const create = async () => {
    try { await api.post("/households", { name }); reconnectRealtime(); onDone(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="center">
      <div className="card auth">
        <div className="mascot" />
        <h1>{t("Je gezin")}</h1>
        <p className="hint">{t("Je hoort nog bij geen gezin. Maak je eigen gezin, of open de uitnodigingslink die je van je partner kreeg.")}</p>
        <label className="field"><span>{t("Naam van je gezin")}</span><input id="hh-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("bv. Familie Daldal")} /></label>
        {err && <p className="error">{err}</p>}
        <button className="btn" disabled={!name.trim()} onClick={create}>{t("Gezin maken")}</button>
        <button className="linkbtn" onClick={() => api.post("/auth/logout").then(() => location.reload())}>{t("Afmelden")}</button>
      </div>
    </div>
  );
}

/** Nieuw wachtwoord kiezen via een herstel-link van de beheerder (/herstel/:token). */
export function ResetPassword({ token, onDone }: { token: string; onDone: () => void }) {
  const [info, setInfo] = useState<{ valid: boolean; name?: string; reason?: string } | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get<{ valid: boolean; name?: string; reason?: string }>(`/reset/${token}`).then(setInfo).catch(() => setInfo({ valid: false, reason: t("De link kon niet gecontroleerd worden.") })); }, [token]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) return setErr("De twee wachtwoorden zijn niet gelijk.");
    setBusy(true); setErr(null);
    try {
      await api.post(`/reset/${token}`, { password: pw });
      history.replaceState(null, "", "/");
      reconnectRealtime();
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : t("Er ging iets mis.")); }
    finally { setBusy(false); }
  };
  return (
    <div className="center">
      <form className="card auth" onSubmit={submit}>
        <div className="mascot" />
        <h1>{t("Nieuw wachtwoord")}</h1>
        {!info && <p className="hint">{t("Link controleren…")}</p>}
        {info && !info.valid && <div className="invite-card"><b>{t("Link niet geldig")}</b><p className="hint">{info.reason}</p><button type="button" className="linkbtn" onClick={() => { history.replaceState(null, "", "/"); onDone(); }}>{t("Naar aanmelden")}</button></div>}
        {info?.valid && (
          <>
            <p className="hint">Hallo {info.name}, kies een nieuw wachtwoord. Je wordt daarna meteen aangemeld; op andere toestellen moet je opnieuw aanmelden.</p>
            <label className="field"><span>{t("Nieuw wachtwoord (minstens 8 tekens)")}</span><input id="rp-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" minLength={8} required /></label>
            <label className="field"><span>{t("Nog eens")}</span><input id="rp-pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" minLength={8} required /></label>
            {err && <p className="error">{err}</p>}
            <button className="btn" type="submit" disabled={busy || pw.length < 8}>{busy ? t("Even geduld…") : t("Wachtwoord bewaren")}</button>
          </>
        )}
      </form>
    </div>
  );
}
