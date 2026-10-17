import { useState } from "react";
import { api, reconnectRealtime } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { HouseholdUser, Invite, Me, ShareRow } from "../types";
import { Avatar, Confirm, Fold, Modal } from "../components/ui";
import { Icon } from "../components/Icons";
import { t, getLang } from "../i18n";

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Fold title={title} action={action}>
      {children}
    </Fold>
  );
}

/** Toont een uitnodigingslink met knoppen om ze te kopiëren of door te sturen. */
function ShareLink({ url, text, onClose }: { url: string; text: string; onClose: () => void }) {
  const { toast } = useData();
  const message = `${text}\n${url}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast(t("Link gekopieerd")); }
    catch { toast(t("Kopiëren lukte niet. Selecteer de link en kopieer ze zelf.")); }
  };
  const share = async () => {
    try { await navigator.share({ title: "Gezinsbord", text, url }); } catch { /* geannuleerd */ }
  };
  return (
    <Modal title={t("Uitnodiging klaar")} onClose={onClose}>
      <p className="hint">{t("Stuur deze link naar de persoon die je wilt uitnodigen. De link werkt één keer en is 7 dagen geldig.")}</p>
      <div className="linkbox"><code>{url}</code></div>
      <div className="actions" style={{ justifyContent: "flex-start" }}>
        <button className="btn" onClick={copy}>{t("Link kopiëren")}</button>
        {"share" in navigator && <button className="btn ghost" onClick={share}>{t("Delen…")}</button>}
        <a className="btn ghost" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">{t("WhatsApp")}</a>
        <a className="btn ghost" href={`mailto:?subject=${encodeURIComponent("Uitnodiging voor Gezinsbord")}&body=${encodeURIComponent(message)}`}>{t("E-mail")}</a>
      </div>
    </Modal>
  );
}

export function AccountSection() {
  const { data } = useData();
  const act = useAction();
  const [me] = useRemote<Me | null>("/auth/me", ["access"], null);
  const [name, setName] = useState(data!.me.name);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [newHh, setNewHh] = useState(false);
  const switchTo = async (householdId: string) => {
    if (await act(() => api.post("/households/switch", { householdId }))) { reconnectRealtime(); location.reload(); }
  };
  return (
    <Section title={t("Mijn account")} action={<button className="btn ghost small" onClick={() => api.post("/auth/logout").then(() => { location.hash = ""; location.reload(); })}>{t("Afmelden")}</button>}>
      <p className="hint">{t("Aangemeld als")}{" "}<b>{data!.me.email}</b>{data!.me.role === "beheerder" ? t(" · beheerder van dit gezin") : ""}.</p>
      <label className="field"><span>{t("Je naam (zo zien anderen je)")}</span>
        <div className="addrow"><input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn ghost" disabled={!name.trim() || name === data!.me.name} onClick={() => act(() => api.put("/account", { name }), t("Naam bewaard"))}>{t("Bewaren")}</button></div>
      </label>
      <div className="field"><span>{t("Wachtwoord wijzigen")}</span>
        <div className="addrow">
          <input id="pw-cur" type="password" placeholder={t("Huidig")} value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" aria-label={t("Huidig wachtwoord")} />
          <input id="pw-new" type="password" placeholder={t("Nieuw (min. 8 tekens)")} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" aria-label={t("Nieuw wachtwoord")} />
          <button className="btn ghost" disabled={!pw.current || pw.next.length < 8} onClick={async () => { if (await act(() => api.put("/account/password", pw), "Wachtwoord gewijzigd; andere toestellen zijn afgemeld")) setPw({ current: "", next: "" }); }}>{t("Wijzigen")}</button>
        </div>
      </div>
      {me && (
        <div className="field"><span>{t("Mijn gezinnen")}</span>
          <div className="picks">
            {me.households.map((h) => <button key={h.id} className="pick" aria-pressed={h.id === me.householdId} onClick={() => h.id !== me.householdId && switchTo(h.id)}>{h.name}{h.role === "beheerder" ? t(" · beheerder") : ""}</button>)}
            <button className="pick" onClick={() => setNewHh(true)}>{t("+ Nieuw gezin")}</button>
          </div>
        </div>
      )}
      {newHh && <NewHousehold onClose={() => setNewHh(false)} />}
    </Section>
  );
}

function NewHousehold({ onClose }: { onClose: () => void }) {
  const act = useAction();
  const [name, setName] = useState("");
  return (
    <Modal title={t("Nieuw gezin")} onClose={onClose}>
      <p className="hint">{t("Bv. voor een tweede huishouden. Je wordt er beheerder van en kunt wisselen tussen je gezinnen.")}</p>
      <input id="nh-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Naam van het gezin")} aria-label={t("Naam van het gezin")} />
      <div className="actions"><button className="btn ghost" onClick={onClose}>{t("Annuleren")}</button>
        <button className="btn" disabled={!name.trim()} onClick={async () => { if (await act(() => api.post("/households", { name }))) { reconnectRealtime(); location.reload(); } }}>{t("Maken")}</button></div>
    </Modal>
  );
}

/** Wie heeft een account in dit gezin, aan welk profiel gekoppeld, en uitnodigen. */
export function HouseholdAccess() {
  const { data } = useData();
  const act = useAction();
  const [users] = useRemote<HouseholdUser[]>("/household/users", ["access", "members"], []);
  const [invites, reloadInvites] = useRemote<Invite[]>("/invites", ["access"], []);
  const [link, setLink] = useState<{ url: string; text: string } | null>(null);
  const [remove, setRemove] = useState<HouseholdUser | null>(null);
  const admin = data!.me.role === "beheerder";
  const linkedIds = new Set(users.map((u) => u.memberId).filter(Boolean));

  const invite = async (memberId: string | null, memberName?: string) => {
    const r = await act(() => api.post<{ url: string }>("/invites", { kind: "household", memberId, role: "lid", label: memberName ?? "" }));
    if (r) {
      reloadInvites();
      setLink({ url: r.url, text: `${t("{n} nodigt je uit in ons gezinsbord “{f}”", { n: data!.me.name, f: data!.settings.family_name })}${memberName ? ` ${t("als {m}", { m: memberName })}` : ""}.` });
    }
  };

  return (
    <Section title={t("Toegang tot het gezin")} action={admin && <button className="btn small" onClick={() => invite(null)}><Icon.plus />{" "}{t("Uitnodigen")}</button>}>
      <p className="hint">{t("Wie hier staat, ziet en beheert alles van dit gezin: kalender, taken, maaltijden, lijsten en foto's. Nodig bv. je partner uit en koppel haar of hem aan het juiste profiel.")}</p>
      <div className="upnext">
        {users.map((u) => {
          const m = data!.members.find((x) => x.id === u.memberId);
          return (
            <div className="item" key={u.id}>
              {m ? <Avatar m={m} size={40} dot={false} /> : <span className="avatar" style={{ "--c": "#7b8696", "--size": "40px" } as React.CSSProperties}>{u.name.charAt(0)}</span>}
              <span style={{ flex: 1, minWidth: 0 }}><b>{u.name}{u.id === data!.me.id ? t(" (jij)") : ""}</b><small>{u.email}{m ? ` · profiel ${m.name}` : t(" · nog geen profiel")}</small></span>
              <span className="badge">{u.role}</span>
              {admin && (
                <select aria-label={t("Profiel van {n}", { n: u.name })} style={{ width: "auto" }} value={u.memberId ?? ""}
                  onChange={(e) => act(() => api.put(`/household/users/${u.id}`, { role: u.role, memberId: e.target.value || null }), t("Profiel gekoppeld"))}>
                  <option value="">{t("Geen profiel")}</option>
                  {data!.members.filter((x) => !linkedIds.has(x.id) || x.id === u.memberId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              )}
              {admin && u.id !== data!.me.id && (
                <button className="btn ghost small" onClick={() => act(() => api.put(`/household/users/${u.id}`, { role: u.role === "beheerder" ? "lid" : "beheerder", memberId: u.memberId }), t("Rol gewijzigd"))}>
                  {u.role === "beheerder" ? t("Maak lid") : t("Maak beheerder")}
                </button>
              )}
              {admin && u.id !== data!.me.id && (
                <button className="btn ghost small" title={t("Herstel-link voor een nieuw wachtwoord")} onClick={async () => {
                  const r = await act(() => api.post<{ url: string }>(`/household/users/${u.id}/reset-link`));
                  if (r) setLink({ url: r.url, text: t("Hallo {n}, met deze link kies je een nieuw wachtwoord voor Gezinsbord (1 dag geldig).", { n: u.name }) });
                }}>{t("🔑 Wachtwoord")}</button>
              )}
              {(admin || u.id === data!.me.id) && <button className="iconbtn" aria-label={u.id === data!.me.id ? t("Gezin verlaten") : `${u.name} verwijderen`} onClick={() => setRemove(u)}><Icon.trash /></button>}
            </div>
          );
        })}
      </div>
      {admin && data!.members.some((m) => !linkedIds.has(m.id)) && (
        <div className="field"><span>{t("Profielen zonder account: nodig de persoon uit om het profiel over te nemen")}</span>
          <div className="picks">
            {data!.members.filter((m) => !linkedIds.has(m.id)).map((m) => <button key={m.id} className="pick" style={{ "--c": m.color } as React.CSSProperties} onClick={() => invite(m.id, m.name)}>✉️ {m.name}</button>)}
          </div>
        </div>
      )}
      {invites.filter((i) => i.kind === "household").length > 0 && (
        <div className="field"><span>{t("Openstaande uitnodigingen")}</span>
          {invites.filter((i) => i.kind === "household").map((i) => (
            <div className="item" key={i.id}>
              <span style={{ flex: 1 }}>{i.label ? t("Voor {n}", { n: i.label }) : t("Algemene uitnodiging")}<small>{t("geldig tot")} {new Date(i.expiresAt + "Z").toLocaleDateString(getLang() === "tr" ? "tr-TR" : "nl-BE")}</small></span>
              <button className="btn ghost small" onClick={() => act(() => api.del(`/invites/${i.id}`), t("Uitnodiging ingetrokken")).then(reloadInvites)}>{t("Intrekken")}</button>
            </div>
          ))}
        </div>
      )}
      {link && <ShareLink {...link} onClose={() => setLink(null)} />}
      {remove && (
        <Confirm title={remove.id === data!.me.id ? t("Dit gezin verlaten?") : `${remove.name} verwijderen?`}
          text={remove.id === data!.me.id ? t("Je ziet de gegevens van dit gezin dan niet meer.") : `${remove.name} ziet de gegevens van dit gezin dan niet meer. Het profiel en de afspraken blijven bestaan.`}
          onClose={() => setRemove(null)}
          actions={[{ label: remove.id === data!.me.id ? t("Verlaten") : t("Verwijderen"), run: async () => { if (await act(() => api.del(`/household/users/${remove.id}`)) && remove.id === data!.me.id) location.reload(); } }]} />
      )}
    </Section>
  );
}

/** Je eigen agenda delen met mensen buiten je gezin, en agenda's die anderen met jou delen. */
export function AgendaSharing() {
  const { data } = useData();
  const act = useAction();
  const [sharing] = useRemote<{ viewers: ShareRow[]; following: ShareRow[] }>("/sharing", ["sharing"], { viewers: [], following: [] });
  const [link, setLink] = useState<{ url: string; text: string } | null>(null);
  const [level, setLevel] = useState<"details" | "bezet">("details");
  const linked = !!data!.me.memberId;

  const invite = async () => {
    const r = await act(() => api.post<{ url: string }>("/invites", { kind: "agenda", level }));
    if (r) setLink({ url: r.url, text: `${data!.me.name} deelt zijn of haar agenda met je via Gezinsbord.` });
  };

  return (
    <Section title={t("Mijn agenda delen")}>
      <p className="hint">{t("Laat vrienden of familie buiten je gezin")}{" "}<b>{t("alleen jouw eigen agenda")}</b> zien. Afspraken samen met je partner of kinderen zien ze enkel als “Niet beschikbaar – familiale reden”. Je gezin, taken en lijsten zien ze nooit. Wie jij uitnodigt, is alleen voor jou zichtbaar; zij kunnen op hun beurt hun eigen agenda delen.</p>
      {!linked && <p className="error">Je account is nog niet aan een profiel gekoppeld. Koppel het hierboven bij “Toegang tot het gezin”; dan weten we welke afspraken van jou zijn.</p>}
      <div className="addrow" style={{ flexWrap: "wrap" }}>
        <select id="share-level" value={level} onChange={(e) => setLevel(e.target.value as "details" | "bezet")} style={{ width: "auto" }} aria-label={t("Wat ze zien")}>
          <option value="details">{t("Ze zien mijn afspraken")}</option>
          <option value="bezet">{t("Ze zien alleen wanneer ik bezet ben")}</option>
        </select>
        <button className="btn" disabled={!linked} onClick={invite}>{t("Uitnodigingslink maken")}</button>
      </div>
      <div className="field"><span>{t("Wie ziet mijn agenda")}</span>
        {sharing.viewers.map((v) => (
          <div className="item" key={v.id}>
            <span style={{ flex: 1, minWidth: 0 }}><b>{v.name}</b><small>{v.email}</small></span>
            <select aria-label={`Wat ${v.name} ziet`} style={{ width: "auto" }} value={v.level} onChange={(e) => act(() => api.put(`/sharing/viewers/${v.id}`, { level: e.target.value }), t("Bewaard"))}>
              <option value="details">{t("Afspraken")}</option><option value="bezet">{t("Alleen bezet")}</option>
            </select>
            <button className="btn ghost small" onClick={() => act(() => api.del(`/sharing/viewers/${v.id}`), `${v.name} ziet je agenda niet meer`)}>{t("Stoppen")}</button>
          </div>
        ))}
        {!sharing.viewers.length && <p className="hint">{t("Nog niemand.")}</p>}
      </div>
      <div className="field"><span>{t("Agenda's die met mij gedeeld worden")}</span>
        {sharing.following.map((f) => (
          <div className="item" key={f.id}>
            <span style={{ flex: 1, minWidth: 0 }}><b>{f.name}</b><small>{f.level === "bezet" ? t("alleen bezet") : "afspraken"}{f.iShareBack ? t(" · jij deelt terug") : ""}</small></span>
            {!f.iShareBack && <button className="btn small accent" disabled={!linked} onClick={() => act(() => api.post(`/sharing/share-back/${f.id}`, { level: "details" }), `${f.name} ziet nu ook jouw agenda`)}>{t("Mijn agenda terugdelen")}</button>}
            <button className="btn ghost small" onClick={() => act(() => api.del(`/sharing/following/${f.id}`), t("Niet meer zichtbaar"))}>{t("Verbergen")}</button>
          </div>
        ))}
        {!sharing.following.length && <p className="hint">{t("Nog niemand deelt zijn agenda met jou.")}</p>}
      </div>
      {link && <ShareLink {...link} onClose={() => setLink(null)} />}
    </Section>
  );
}
