/** Koppelingen als één systeem: catalogus, aanzetten met één formulier, en de plekken waar ze iets tonen (widget, knoppen). */
import { useMemo, useState } from "react";
import { api } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { ConnField, ConnLink, ConnWidget, Connection, Connector, Member, Subscription } from "../types";
import { Avatar, Confirm, Fold, Modal, cvar } from "./ui";
import { getDevice } from "../device";
import { t } from "../i18n";

const STATUS_BADGE: Record<Connector["status"], string | null> = { ready: null, unofficial: "Onofficieel", soon: "Binnenkort" };

/** Opent een adres buiten de app (nieuw tabblad in de browser, de app zelf op een telefoon). */
export const openUrl = (url: string) => { window.open(url, "_blank", "noopener,noreferrer"); };

function FieldInput({ f, value, onChange }: { f: ConnField; value: unknown; onChange: (v: unknown) => void }) {
  if (f.type === "multiselect") {
    const set = new Set(Array.isArray(value) ? (value as string[]) : []);
    return <div className="picks">{(f.options ?? []).map((o) => <button type="button" key={o.value} className="pick" aria-pressed={set.has(o.value)} onClick={() => { const n = new Set(set); if (n.has(o.value)) n.delete(o.value); else n.add(o.value); onChange([...n]); }}>{o.label}</button>)}</div>;
  }
  if (f.type === "select") return <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}><option value="">—</option>{(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
  if (f.type === "textarea") return <textarea rows={3} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} />;
  const type = f.type === "secret" ? "password" : f.type === "number" ? "number" : f.type === "time" ? "time" : f.type === "url" ? "url" : "text";
  return <input type={type} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} autoComplete="off" />;
}

/** Eén formulier voor elke koppeling: de velden komen uit de catalogus. */
function ConnectionForm({ def, conn, onClose }: { def: Connector; conn?: Connection; onClose: () => void }) {
  const { data } = useData();
  const act = useAction();
  const dev = getDevice();
  const people = (data?.members ?? []).filter((m) => m.role !== "huisdier");
  const [config, setConfig] = useState<Record<string, unknown>>(() => ({ ...(conn?.config ?? {}) }));
  const [memberId, setMemberId] = useState<string | null>(conn?.memberId ?? dev.memberId ?? data?.me.memberId ?? people[0]?.id ?? null);
  const [onBoard, setOnBoard] = useState(conn?.onBoard ?? false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const missing = def.fields.filter((f) => f.required && !(Array.isArray(config[f.key]) ? (config[f.key] as unknown[]).length : config[f.key]));
  const save = async () => {
    if (missing.length) { setErr(t("Vul eerst in: {f}", { f: missing.map((f) => f.label).join(", ") })); return; }
    setBusy(true); setErr("");
    const body = { connector: def.id, memberId: def.scope === "member" ? memberId : null, config, onBoard, enabled: true };
    const r = await act(() => (conn ? api.put<Connection>(`/connections/${conn.id}`, body) : api.post<Connection>("/connections", body)), conn ? t("Koppeling bewaard") : t("Koppeling aangezet ✔"));
    setBusy(false);
    if (r) onClose();
  };
  return (
    <Modal title={<>{def.icon} {def.name}</>} onClose={onClose}>
      <p className="hint">{def.description}</p>
      {def.scope === "member" && (
        <div className="field"><span>{t("Voor wie")}</span>
          <div className="picks">{people.map((m) => <button type="button" key={m.id} className="pick pick-person" style={cvar(m.color)} aria-pressed={memberId === m.id} onClick={() => setMemberId(m.id)}><Avatar m={m} size={22} dot={false} /> {m.name}</button>)}</div>
        </div>
      )}
      {def.fields.map((f) => (
        <label className="field" key={f.key}><span>{f.label}{f.required ? " *" : ""}</span>
          <FieldInput f={f} value={config[f.key]} onChange={(v) => setConfig((c) => ({ ...c, [f.key]: v }))} />
          {f.hint && <small className="muted">{f.hint}</small>}
        </label>
      ))}
      {def.scope === "member" && def.provides.includes("widget") && (
        <label className="check-row"><input type="checkbox" checked={onBoard} onChange={(e) => setOnBoard(e.target.checked)} /> {t("Ook op het Bord tonen (anders alleen op de telefoon van deze persoon)")}</label>
      )}
      {err && <p className="error">{err}</p>}
      <div className="actions"><button className="btn ghost" onClick={onClose}>{t("Annuleren")}</button><button className="btn" disabled={busy} onClick={save}>{busy ? "…" : conn ? t("Bewaren") : t("Aanzetten")}</button></div>
    </Modal>
  );
}

function ConnectionRow({ c, def, members, onEdit }: { c: Connection; def: Connector; members: Member[]; onEdit: () => void }) {
  const act = useAction();
  const [ask, setAsk] = useState(false);
  const who = c.memberId ? members.find((m) => m.id === c.memberId) : null;
  const when = c.lastSync ? new Date(c.lastSync.endsWith("Z") ? c.lastSync : c.lastSync + "Z") : null;
  return (
    <div className={`connrow${c.enabled ? "" : " off"}`}>
      <span className="conn-ic" aria-hidden>{def.icon}</span>
      <span className="conn-txt">
        <b>{def.name}{who ? <small className="muted"> · {who.name}</small> : null}{c.onBoard && who ? <small className="muted"> · {t("op het Bord")}</small> : null}</b>
        <small className={c.status === "error" ? "error" : "muted"}>
          {c.status === "error" ? `⚠️ ${c.error}` : !c.enabled ? t("Uit") : when ? t("Bijgewerkt {t}", { t: when.toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" }) }) : t("Aan")}
        </small>
      </span>
      <span className="conn-btns">
        <label className="switch" aria-label={t("Aan of uit")}><input type="checkbox" checked={c.enabled} onChange={() => act(() => api.put(`/connections/${c.id}`, { enabled: !c.enabled }))} /><span /></label>
        {def.refreshMinutes > 0 && <button className="iconbtn" aria-label={t("Nu verversen")} onClick={() => act(() => api.post(`/connections/${c.id}/sync`), t("Ververst"))}>↻</button>}
        <button className="iconbtn" aria-label={t("Instellen")} onClick={onEdit}>✎</button>
        <button className="iconbtn" aria-label={t("Verwijderen")} onClick={() => setAsk(true)}>✕</button>
      </span>
      {ask && <Confirm title={t("Koppeling verwijderen?")} text={t("De instellingen en opgehaalde gegevens van deze koppeling worden gewist.")} onClose={() => setAsk(false)} actions={[{ label: t("Verwijderen"), kind: "danger", run: () => act(() => api.del(`/connections/${c.id}`), t("Koppeling verwijderd")) }]} />}
    </div>
  );
}

/** Instellingen → Koppelingen: wat aan staat, en de catalogus om meer aan te zetten. */
export function ConnectorsSection() {
  const { data } = useData();
  const [cat] = useRemote<Connector[]>("/connectors", ["connections", "settings"], []);
  const [conns] = useRemote<Connection[]>("/connections", ["connections"], []);
  const [sub] = useRemote<Subscription | null>("/billing", ["settings"], null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<{ def: Connector; conn?: Connection } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const members = data?.members ?? [];
  const plus = sub ? ["plus", "operator"].includes(sub.plan) : false;
  const byId = useMemo(() => new Map(cat.map((c) => [c.id, c])), [cat]);
  const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const shown = cat.filter((c) => !q.trim() || fold(`${c.name} ${c.description} ${c.categoryLabel}`).includes(fold(q.trim())));
  const groups = useMemo(() => { const m = new Map<string, Connector[]>(); for (const c of shown) m.set(c.categoryLabel, [...(m.get(c.categoryLabel) ?? []), c]); return [...m.entries()]; }, [shown]);
  const recommended = cat.filter((c) => c.recommended && c.status === "ready");
  return (
    <Fold title={t("Koppelingen")} hint={t("trein, afval, winkels, nieuws, uit…")} action={<span className="badge">{conns.filter((c) => c.enabled).length} {t("aan")}</span>}>
      <p className="hint">{t("Alles staat standaard uit. Een koppeling maakt geen nieuw scherm: ze vult je agenda, je briefing of een widget op het Bord, of zet een knop waar die van pas komt. Elk gezinslid kiest zelf wat hij of zij koppelt; ouders zien alles.")}</p>
      {conns.length > 0 && <div className="connrows">{conns.map((c) => { const def = byId.get(c.connector); return def ? <ConnectionRow key={c.id} c={c} def={def} members={members} onEdit={() => setOpen({ def, conn: c })} /> : null; })}</div>}
      {recommended.length > 0 && !q && (
        <div className="field"><span>{t("Aanbevolen voor jullie")}</span>
          <div className="picks">{recommended.map((c) => <button type="button" key={c.id} className="pick" onClick={() => setOpen({ def: c })}>{c.icon} {c.name}</button>)}</div>
        </div>
      )}
      <div className="conn-search"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Zoek een koppeling…")} /><button className="linkbtn" onClick={() => setShowAll(!showAll)}>{showAll || q ? t("Catalogus inklappen") : t("Hele catalogus")}</button></div>
      {(showAll || q.trim()) && groups.map(([label, list]) => (
        <div className="conn-group" key={label}>
          <h3>{label}</h3>
          <div className="conn-grid">
            {list.map((c) => {
              const badge = c.status !== "ready" ? STATUS_BADGE[c.status] : c.plan === "plus" ? "Gezin+" : null;
              const locked = c.plan === "plus" && !plus;
              return (
                <button type="button" key={c.id} className={`conn-card${c.status === "soon" ? " soon" : ""}`} disabled={c.status === "soon"} onClick={() => { if (locked) return; setOpen({ def: c }); }} title={locked ? t("Zit in Gezin+") : undefined}>
                  <span className="conn-ic" aria-hidden>{c.icon}</span>
                  <span className="conn-txt"><b>{c.name}{c.connected && <small className="muted"> ✓</small>}</b><small>{c.description}</small></span>
                  {badge && <span className={`badge conn-badge ${c.status}`}>{t(badge)}</span>}
                  {locked && <span className="badge conn-badge lock">🔒 Gezin+</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {!cat.length && <p className="empty">…</p>}
      {open && <ConnectionForm def={open.def} conn={open.conn} onClose={() => setOpen(null)} />}
    </Fold>
  );
}

/** Widgets van koppelingen op het Bord (gezinsbreed + "ook op het bord") of op Mijn dag (één persoon). Toont niets als er niets te melden is. */
export function ConnectorWidgets({ memberId, board, max = 6 }: { memberId?: string | null; board?: boolean; max?: number }) {
  const url = board ? "/connections/widgets?board=1" : `/connections/widgets${memberId ? `?member=${memberId}` : ""}`;
  const [ws] = useRemote<ConnWidget[]>(url, ["connections", "settings"], []);
  if (!ws.length) return null;
  return (
    <>
      {ws.slice(0, max).map((w) => (
        <section className="glass widget-sm connw" key={w.id}>
          <div className="widget-h"><h2><span aria-hidden>{w.widget.icon}</span> {w.widget.title}</h2></div>
          <div className="connw-lines">
            {w.widget.lines.slice(0, 5).map((l, i) => {
              const inner = <>{l.icon && <span aria-hidden>{l.icon}</span>}<span className="connw-txt"><b>{l.text}</b>{l.sub && <small className="muted">{l.sub}</small>}</span></>;
              return l.url ? <a key={i} className="connw-line" href={l.url} target="_blank" rel="noreferrer">{inner}</a> : <div key={i} className="connw-line">{inner}</div>;
            })}
          </div>
        </section>
      ))}
    </>
  );
}

/** Knoppen die een koppeling op een bestaande plek zet: "Open bij Delhaize" op een lijst, "Uber" bij een afspraak met adres. */
export function LinkButtons({ kind, q, address, title, memberId, label }: { kind: "list" | "meal" | "event" | "store"; q?: string; address?: string; title?: string; memberId?: string | null; label?: string }) {
  const params = new URLSearchParams({ kind }); if (q) params.set("q", q); if (address) params.set("address", address); if (title) params.set("title", title); if (memberId) params.set("member", memberId);
  const [links] = useRemote<ConnLink[]>(`/connections/links?${params.toString()}`, ["connections"], []);
  if (!links.length) return null;
  return (
    <div className="linkbtns">
      {label && <small className="muted">{label}</small>}
      {links.map((l, i) => <a key={i} className="btn small ghost" href={l.url} target="_blank" rel="noreferrer">{l.icon} {l.label}</a>)}
    </div>
  );
}
