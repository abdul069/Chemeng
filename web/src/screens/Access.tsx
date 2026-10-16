import { useState } from "react";
import { api, reconnectRealtime } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { HouseholdUser, Invite, Me, ShareRow } from "../types";
import { Avatar, Confirm, Modal } from "../components/ui";
import { Icon } from "../components/Icons";

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="section-title" style={{ marginBottom: 0 }}><h2>{title}</h2>{action}</div>
      {children}
    </section>
  );
}

/** Toont een uitnodigingslink met knoppen om ze te kopiëren of door te sturen. */
function ShareLink({ url, text, onClose }: { url: string; text: string; onClose: () => void }) {
  const { toast } = useData();
  const message = `${text}\n${url}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast("Link gekopieerd"); }
    catch { toast("Kopiëren lukte niet. Selecteer de link en kopieer ze zelf."); }
  };
  const share = async () => {
    try { await navigator.share({ title: "Gezinsbord", text, url }); } catch { /* geannuleerd */ }
  };
  return (
    <Modal title="Uitnodiging klaar" onClose={onClose}>
      <p className="hint">Stuur deze link naar de persoon die je wilt uitnodigen. De link werkt één keer en is 7 dagen geldig.</p>
      <div className="linkbox"><code>{url}</code></div>
      <div className="actions" style={{ justifyContent: "flex-start" }}>
        <button className="btn" onClick={copy}>Link kopiëren</button>
        {"share" in navigator && <button className="btn ghost" onClick={share}>Delen…</button>}
        <a className="btn ghost" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">WhatsApp</a>
        <a className="btn ghost" href={`mailto:?subject=${encodeURIComponent("Uitnodiging voor Gezinsbord")}&body=${encodeURIComponent(message)}`}>E-mail</a>
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
    <Section title="Mijn account" action={<button className="btn ghost small" onClick={() => api.post("/auth/logout").then(() => { location.hash = ""; location.reload(); })}>Afmelden</button>}>
      <p className="hint">Aangemeld als <b>{data!.me.email}</b>{data!.me.role === "beheerder" ? " · beheerder van dit gezin" : ""}.</p>
      <label className="field"><span>Je naam (zo zien anderen je)</span>
        <div className="addrow"><input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn ghost" disabled={!name.trim() || name === data!.me.name} onClick={() => act(() => api.put("/account", { name }), "Naam bewaard")}>Bewaren</button></div>
      </label>
      <div className="field"><span>Wachtwoord wijzigen</span>
        <div className="addrow">
          <input id="pw-cur" type="password" placeholder="Huidig" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" aria-label="Huidig wachtwoord" />
          <input id="pw-new" type="password" placeholder="Nieuw (min. 8 tekens)" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" aria-label="Nieuw wachtwoord" />
          <button className="btn ghost" disabled={!pw.current || pw.next.length < 8} onClick={async () => { if (await act(() => api.put("/account/password", pw), "Wachtwoord gewijzigd; andere toestellen zijn afgemeld")) setPw({ current: "", next: "" }); }}>Wijzigen</button>
        </div>
      </div>
      {me && (
        <div className="field"><span>Mijn gezinnen</span>
          <div className="picks">
            {me.households.map((h) => <button key={h.id} className="pick" aria-pressed={h.id === me.householdId} onClick={() => h.id !== me.householdId && switchTo(h.id)}>{h.name}{h.role === "beheerder" ? " · beheerder" : ""}</button>)}
            <button className="pick" onClick={() => setNewHh(true)}>+ Nieuw gezin</button>
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
    <Modal title="Nieuw gezin" onClose={onClose}>
      <p className="hint">Bv. voor een tweede huishouden. Je wordt er beheerder van en kunt wisselen tussen je gezinnen.</p>
      <input id="nh-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Naam van het gezin" aria-label="Naam van het gezin" />
      <div className="actions"><button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button className="btn" disabled={!name.trim()} onClick={async () => { if (await act(() => api.post("/households", { name }))) { reconnectRealtime(); location.reload(); } }}>Maken</button></div>
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
      setLink({ url: r.url, text: `${data!.me.name} nodigt je uit in ons gezinsbord “${data!.settings.family_name}”${memberName ? ` als ${memberName}` : ""}.` });
    }
  };

  return (
    <Section title="Toegang tot het gezin" action={admin && <button className="btn small" onClick={() => invite(null)}><Icon.plus /> Uitnodigen</button>}>
      <p className="hint">Wie hier staat, ziet en beheert alles van dit gezin: kalender, taken, maaltijden, lijsten en foto's. Nodig bv. je partner uit en koppel haar of hem aan het juiste profiel.</p>
      <div className="upnext">
        {users.map((u) => {
          const m = data!.members.find((x) => x.id === u.memberId);
          return (
            <div className="item" key={u.id}>
              {m ? <Avatar m={m} size={40} dot={false} /> : <span className="avatar" style={{ "--c": "#7b8696", "--size": "40px" } as React.CSSProperties}>{u.name.charAt(0)}</span>}
              <span style={{ flex: 1, minWidth: 0 }}><b>{u.name}{u.id === data!.me.id ? " (jij)" : ""}</b><small>{u.email}{m ? ` · profiel ${m.name}` : " · nog geen profiel"}</small></span>
              <span className="badge">{u.role}</span>
              {admin && (
                <select aria-label={`Profiel van ${u.name}`} style={{ width: "auto" }} value={u.memberId ?? ""}
                  onChange={(e) => act(() => api.put(`/household/users/${u.id}`, { role: u.role, memberId: e.target.value || null }), "Profiel gekoppeld")}>
                  <option value="">Geen profiel</option>
                  {data!.members.filter((x) => !linkedIds.has(x.id) || x.id === u.memberId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              )}
              {admin && u.id !== data!.me.id && (
                <button className="btn ghost small" onClick={() => act(() => api.put(`/household/users/${u.id}`, { role: u.role === "beheerder" ? "lid" : "beheerder", memberId: u.memberId }), "Rol gewijzigd")}>
                  {u.role === "beheerder" ? "Maak lid" : "Maak beheerder"}
                </button>
              )}
              {admin && u.id !== data!.me.id && (
                <button className="btn ghost small" title="Herstel-link voor een nieuw wachtwoord" onClick={async () => {
                  const r = await act(() => api.post<{ url: string }>(`/household/users/${u.id}/reset-link`));
                  if (r) setLink({ url: r.url, text: `Hallo ${u.name}, met deze link kies je een nieuw wachtwoord voor Gezinsbord (1 dag geldig).` });
                }}>🔑 Wachtwoord</button>
              )}
              {(admin || u.id === data!.me.id) && <button className="iconbtn" aria-label={u.id === data!.me.id ? "Gezin verlaten" : `${u.name} verwijderen`} onClick={() => setRemove(u)}><Icon.trash /></button>}
            </div>
          );
        })}
      </div>
      {admin && data!.members.some((m) => !linkedIds.has(m.id)) && (
        <div className="field"><span>Profielen zonder account: nodig de persoon uit om het profiel over te nemen</span>
          <div className="picks">
            {data!.members.filter((m) => !linkedIds.has(m.id)).map((m) => <button key={m.id} className="pick" style={{ "--c": m.color } as React.CSSProperties} onClick={() => invite(m.id, m.name)}>✉️ {m.name}</button>)}
          </div>
        </div>
      )}
      {invites.filter((i) => i.kind === "household").length > 0 && (
        <div className="field"><span>Openstaande uitnodigingen</span>
          {invites.filter((i) => i.kind === "household").map((i) => (
            <div className="item" key={i.id}>
              <span style={{ flex: 1 }}>{i.label ? `Voor ${i.label}` : "Algemene uitnodiging"}<small>geldig tot {new Date(i.expiresAt + "Z").toLocaleDateString("nl-BE")}</small></span>
              <button className="btn ghost small" onClick={() => act(() => api.del(`/invites/${i.id}`), "Uitnodiging ingetrokken").then(reloadInvites)}>Intrekken</button>
            </div>
          ))}
        </div>
      )}
      {link && <ShareLink {...link} onClose={() => setLink(null)} />}
      {remove && (
        <Confirm title={remove.id === data!.me.id ? "Dit gezin verlaten?" : `${remove.name} verwijderen?`}
          text={remove.id === data!.me.id ? "Je ziet de gegevens van dit gezin dan niet meer." : `${remove.name} ziet de gegevens van dit gezin dan niet meer. Het profiel en de afspraken blijven bestaan.`}
          onClose={() => setRemove(null)}
          actions={[{ label: remove.id === data!.me.id ? "Verlaten" : "Verwijderen", run: async () => { if (await act(() => api.del(`/household/users/${remove.id}`)) && remove.id === data!.me.id) location.reload(); } }]} />
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
    <Section title="Mijn agenda delen">
      <p className="hint">Laat vrienden of familie buiten je gezin <b>alleen jouw eigen agenda</b> zien. Afspraken samen met je partner of kinderen zien ze enkel als “Niet beschikbaar – familiale reden”. Je gezin, taken en lijsten zien ze nooit. Wie jij uitnodigt, is alleen voor jou zichtbaar; zij kunnen op hun beurt hun eigen agenda delen.</p>
      {!linked && <p className="error">Je account is nog niet aan een profiel gekoppeld. Koppel het hierboven bij “Toegang tot het gezin”; dan weten we welke afspraken van jou zijn.</p>}
      <div className="addrow" style={{ flexWrap: "wrap" }}>
        <select id="share-level" value={level} onChange={(e) => setLevel(e.target.value as "details" | "bezet")} style={{ width: "auto" }} aria-label="Wat ze zien">
          <option value="details">Ze zien mijn afspraken</option>
          <option value="bezet">Ze zien alleen wanneer ik bezet ben</option>
        </select>
        <button className="btn" disabled={!linked} onClick={invite}>Uitnodigingslink maken</button>
      </div>
      <div className="field"><span>Wie ziet mijn agenda</span>
        {sharing.viewers.map((v) => (
          <div className="item" key={v.id}>
            <span style={{ flex: 1, minWidth: 0 }}><b>{v.name}</b><small>{v.email}</small></span>
            <select aria-label={`Wat ${v.name} ziet`} style={{ width: "auto" }} value={v.level} onChange={(e) => act(() => api.put(`/sharing/viewers/${v.id}`, { level: e.target.value }), "Bewaard")}>
              <option value="details">Afspraken</option><option value="bezet">Alleen bezet</option>
            </select>
            <button className="btn ghost small" onClick={() => act(() => api.del(`/sharing/viewers/${v.id}`), `${v.name} ziet je agenda niet meer`)}>Stoppen</button>
          </div>
        ))}
        {!sharing.viewers.length && <p className="hint">Nog niemand.</p>}
      </div>
      <div className="field"><span>Agenda's die met mij gedeeld worden</span>
        {sharing.following.map((f) => (
          <div className="item" key={f.id}>
            <span style={{ flex: 1, minWidth: 0 }}><b>{f.name}</b><small>{f.level === "bezet" ? "alleen bezet" : "afspraken"}{f.iShareBack ? " · jij deelt terug" : ""}</small></span>
            {!f.iShareBack && <button className="btn small accent" disabled={!linked} onClick={() => act(() => api.post(`/sharing/share-back/${f.id}`, { level: "details" }), `${f.name} ziet nu ook jouw agenda`)}>Mijn agenda terugdelen</button>}
            <button className="btn ghost small" onClick={() => act(() => api.del(`/sharing/following/${f.id}`), "Niet meer zichtbaar")}>Verbergen</button>
          </div>
        ))}
        {!sharing.following.length && <p className="hint">Nog niemand deelt zijn agenda met jou.</p>}
      </div>
      {link && <ShareLink {...link} onClose={() => setLink(null)} />}
    </Section>
  );
}
