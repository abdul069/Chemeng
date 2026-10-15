import { useEffect, useState } from "react";
import { api, ApiError, reconnectRealtime } from "../api";
import type { InviteInfo } from "../types";

export const inviteTokenFromUrl = () => location.pathname.match(/^\/uitnodiging\/([\w-]+)/)?.[1] ?? null;
const clearInviteUrl = () => history.replaceState(null, "", "/");

export function InviteCard({ info }: { info: InviteInfo }) {
  if (!info.valid) return <div className="invite-card"><b>Uitnodiging niet geldig</b><p className="hint">{info.reason}</p></div>;
  return (
    <div className="invite-card">
      {info.kind === "household" ? (
        <>
          <b>{info.from} nodigt je uit in “{info.household}”</b>
          <p className="hint">Je ziet en beheert dan de kalender, taken, maaltijden en lijsten van dit gezin{info.member ? `, als ${info.member}` : ""}.</p>
        </>
      ) : (
        <>
          <b>{info.from} deelt zijn of haar agenda met je</b>
          <p className="hint">Je ziet {info.level === "bezet" ? "wanneer" : "de afspraken van"} {info.from}{info.level === "bezet" ? " bezet is" : ""}, naast je eigen gezin. Afspraken met de familie van {info.from} zie je enkel als “niet beschikbaar”. {info.from} ziet jouw agenda niet, tenzij je ze zelf terugdeelt.</p>
        </>
      )}
    </div>
  );
}

function useInvite(token: string | null) {
  const [info, setInfo] = useState<InviteInfo | null>(null);
  useEffect(() => { if (token) api.get<InviteInfo>(`/invites/${token}`).then(setInfo).catch(() => setInfo({ valid: false, reason: "De uitnodiging kon niet geladen worden." })); }, [token]);
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
      setErr(e instanceof Error ? e.message : "Er ging iets mis.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center">
      <form className="card auth" onSubmit={submit}>
        <div className="mascot" />
        <h1>{mode === "login" ? "Aanmelden" : "Account maken"}</h1>
        {info && <InviteCard info={info} />}
        {mode === "register" && (
          <label className="field"><span>Je naam</span><input id="au-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" required /></label>
        )}
        <label className="field"><span>E-mailadres</span><input id="au-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" required /></label>
        <label className="field"><span>Wachtwoord{mode === "register" ? " (minstens 8 tekens)" : ""}</span>
          <input id="au-pw" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "register" ? 8 : undefined} required />
        </label>
        {err && <p className="error">{err}</p>}
        <button className="btn" type="submit" disabled={busy}>{busy ? "Even geduld…" : mode === "login" ? (token ? "Aanmelden en uitnodiging aanvaarden" : "Aanmelden") : (token ? "Account maken en aanvaarden" : "Account maken")}</button>
        <p className="switch">
          {mode === "login" ? "Nog geen account? " : "Heb je al een account? "}
          <button type="button" className="linkbtn" onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(null); }}>{mode === "login" ? "Account maken" : "Aanmelden"}</button>
        </p>
        {mode === "register" && !token && <p className="hint">Je krijgt meteen je eigen gezin, waarin je daarna je partner en kinderen kunt toevoegen of uitnodigen.</p>}
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
      setErr(e instanceof ApiError ? e.message : "Aanvaarden mislukte.");
    }
  };
  return (
    <div className="modal-back">
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-h"><h2>Uitnodiging</h2></div>
        {info ? <InviteCard info={info} /> : <p className="hint">Laden…</p>}
        {err && <p className="error">{err}</p>}
        <div className="actions">
          <button className="btn ghost" onClick={() => { clearInviteUrl(); onDone(); }}>Niet nu</button>
          {info?.valid && <button className="btn" onClick={accept}>Aanvaarden</button>}
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
        <h1>Je gezin</h1>
        <p className="hint">Je hoort nog bij geen gezin. Maak je eigen gezin, of open de uitnodigingslink die je van je partner kreeg.</p>
        <label className="field"><span>Naam van je gezin</span><input id="hh-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="bv. Familie Daldal" /></label>
        {err && <p className="error">{err}</p>}
        <button className="btn" disabled={!name.trim()} onClick={create}>Gezin maken</button>
        <button className="linkbtn" onClick={() => api.post("/auth/logout").then(() => location.reload())}>Afmelden</button>
      </div>
    </div>
  );
}
