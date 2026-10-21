/** Instellingen → Abonnement en AI-gebruik: formule, budget van deze maand, ledencode; voor de eigenaar van de server ook partners en codes. */
import { useState } from "react";
import { api } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { Billing, Partner } from "../types";
import { Fold } from "./ui";
import { t } from "../i18n";

const eur = (micro: number) => `€${(micro / 1_000_000 * 0.92).toFixed(2)}`; // dollar naar euro, ruwe koers
const TASK_LABEL: Record<string, string> = { chat: "Assistent", briefing: "Briefings", import: "Documenten lezen", translate: "Vertalen", search: "Recepten zoeken", deals: "Folders en deals", inbox: "Gezinsinbox", other: "Overig" };

export function BillingSection() {
  const { data } = useData();
  const act = useAction();
  const [b, reload] = useRemote<Billing | null>("/billing", ["settings"], null);
  const [code, setCode] = useState(""); const [ident, setIdent] = useState("");
  const admin = data?.me.role === "beheerder";
  if (!b) return null;
  const sub = b.subscription;
  return (
    <Fold title={t("Abonnement en AI-gebruik")} hint={`${b.planLabel}${b.budgetMicro !== null ? ` · ${b.pct}%` : ""}`}>
      <div className="planrow">
        <span className={`planbadge ${b.plan}`}>{b.planLabel}</span>
        <span className="muted">
          {sub.source === "partner" && sub.partnerName ? t("via {p}", { p: sub.partnerName }) : sub.source === "expired" ? t("ledenperiode voorbij") : sub.source === "operator" ? t("onbeperkt, eigen sleutel") : ""}
          {sub.validUntil && sub.source === "partner" ? ` · ${t("tot")} ${sub.validUntil.slice(0, 10)}` : ""}
          {sub.discountPct > 0 && sub.source === "expired" ? ` · ${t("{n}% korting bij verlenging", { n: sub.discountPct })}` : ""}
        </span>
      </div>
      {b.budgetMicro !== null ? (
        <>
          <div className="budgetbar" role="progressbar" aria-valuenow={b.pct} aria-valuemax={100}><i style={{ width: `${b.pct}%` }} className={b.blocked ? "full" : b.pct > 80 ? "warn" : ""} /></div>
          <p className="hint">{t("Deze maand {u} van {b} aan AI gebruikt.", { u: eur(b.usedMicro), b: eur(b.budgetMicro) })} {b.blocked ? t("Het budget is op: de assistent wacht tot volgende maand, briefings en al de rest werken gewoon.") : ""}</p>
        </>
      ) : <p className="hint">{t("Geen budgetgrens: dit gezin gebruikt de eigen sleutel van de server. Deze maand {u}.", { u: eur(b.usedMicro) })}</p>}
      {b.perTask.length > 0 && <div className="chips">{b.perTask.map((x) => <span className="chip" key={x.task}>{t(TASK_LABEL[x.task] ?? x.task)} · {x.calls}× · {eur(x.costMicro)}</span>)}</div>}
      <p className="hint">{t("Modellen: assistent {c}, sjabloonwerk {l}. Briefings, inbox en vertalingen gebruiken het kleine model; alleen de assistent het grotere.", { c: b.models.chat, l: b.models.light })}</p>
      {admin && (
        <div className="field"><span>{t("Ledencode (Gezinsbond, mutualiteit, werkgever …)")}</span>
          <div className="addrow">
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("bv. GEZINSBOND-ABC123")} aria-label={t("Code")} style={{ flex: "0 1 220px" }} />
            <input value={ident} onChange={(e) => setIdent(e.target.value)} placeholder={t("lidnummer of e-mail (indien gevraagd)")} aria-label={t("Lidnummer")} />
            <button className="btn" disabled={code.trim().length < 3} onClick={async () => { if (await act(() => api.post("/billing/redeem", { code: code.trim(), identifier: ident.trim() || undefined }), t("Ledenvoordeel geactiveerd 🎉"))) { setCode(""); setIdent(""); reload(); } }}>{t("Inwisselen")}</button>
          </div>
        </div>
      )}
      <div className="plans">
        {b.plans.map((p) => <div className={`plancard${p.id === b.plan ? " on" : ""}`} key={p.id}><b>{p.label}</b><small>{p.id === "free" ? t("zelf hosten, eigen sleutel") : p.id === "gezin" ? t("€4,99 per maand of €49 per jaar · manager, 150 vragen, inbox") : t("€8,99 per maand · onbeperkte assistent, gezinsnetwerk, slim huis")}</small></div>)}
      </div>
      <p className="hint">{t("Betalen via de app komt eraan; tot dan zet de eigenaar van de server de formule, of gebruik je een ledencode.")}</p>
      {data?.assistant.canEditKey && <PartnerAdmin />}
    </Fold>
  );
}

/** Alleen voor de eigenaar van de server: partners aanmaken, codes maken, cijfers zien. */
function PartnerAdmin() {
  const act = useAction();
  const [partners, reload] = useRemote<Partner[]>("/partners", ["settings"], []);
  const [f, setF] = useState({ name: "", slug: "", plan: "plus" as "gezin" | "plus", freeMonths: 6, discountPct: 30, verify: "none" as "none" | "domain" | "list", domains: "" });
  const [open, setOpen] = useState(false);
  return (
    <div className="partneradmin">
      <div className="section-title"><h2>{t("Partners en ledencodes")}</h2><button className="btn small ghost" onClick={() => setOpen(!open)}>{open ? t("Sluiten") : t("+ Partner")}</button></div>
      {open && (
        <div className="card-pad" style={{ background: "var(--surface-2)", borderRadius: 14 }}>
          <div className="row3">
            <label className="field"><span>{t("Naam")}</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, slug: f.slug || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") })} /></label>
            <label className="field"><span>{t("Korte naam (code-prefix)")}</span><input value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} /></label>
            <label className="field"><span>{t("Formule")}</span><select value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value as "gezin" | "plus" })}><option value="plus">Gezin+</option><option value="gezin">Gezin</option></select></label>
          </div>
          <div className="row3">
            <label className="field"><span>{t("Gratis maanden")}</span><input type="number" min={0} max={36} value={f.freeMonths} onChange={(e) => setF({ ...f, freeMonths: Number(e.target.value) || 0 })} /></label>
            <label className="field"><span>{t("Korting daarna (%)")}</span><input type="number" min={0} max={100} value={f.discountPct} onChange={(e) => setF({ ...f, discountPct: Number(e.target.value) || 0 })} /></label>
            <label className="field"><span>{t("Controle")}</span><select value={f.verify} onChange={(e) => setF({ ...f, verify: e.target.value as typeof f.verify })}><option value="none">{t("geen")}</option><option value="domain">{t("e-maildomein")}</option><option value="list">{t("ledenlijst")}</option></select></label>
          </div>
          {f.verify === "domain" && <label className="field"><span>{t("Toegelaten domeinen (komma's)")}</span><input value={f.domains} onChange={(e) => setF({ ...f, domains: e.target.value })} placeholder="gezinsbond.be, bedrijf.be" /></label>}
          <div className="actions"><button className="btn" disabled={!f.name.trim() || !/^[a-z0-9-]{2,40}$/.test(f.slug)} onClick={async () => { if (await act(() => api.post("/partners", f), t("Partner aangemaakt"))) { setOpen(false); setF({ ...f, name: "", slug: "", domains: "" }); reload(); } }}>{t("Aanmaken")}</button></div>
        </div>
      )}
      {partners.map((p) => (
        <div className="linkrow" key={p.id}>
          <div className="link-h"><b>{p.name}</b><span className="muted">{p.plan === "plus" ? "Gezin+" : "Gezin"} · {p.freeMonths} {t("maanden gratis")} · {p.discountPct}% {t("korting")} · {t("controle")}: {p.verify}</span><button className="iconbtn" aria-label={t("Partner verwijderen")} onClick={() => act(() => api.del(`/partners/${p.id}`), t("Verwijderd"))}>✕</button></div>
          <div className="chips">
            <span className="chip">{t("ingewisseld")} {p.stats.redeemed}</span><span className="chip">{t("in gratis periode")} {p.stats.inFreePeriod} ({p.stats.activeInFreePeriod} {t("actief")})</span><span className="chip">{t("na gratis periode")} {p.stats.afterFreePeriod} ({p.stats.retainedAfterFree} {t("gebleven")})</span>
          </div>
          <div className="chips">{p.stats.codes.map((c) => <span className="chip" key={c.code}><code>{c.code}</code> {c.uses}/{c.maxUses}</span>)}<button className="linkbtn" onClick={async () => { const r = await act(() => api.post<{ code: string }>(`/partners/${p.id}/codes`, { maxUses: 1000 })); if (r) { reload(); } }}>+ {t("code")}</button></div>
          {p.verify === "list" && <MemberUpload partnerId={p.id} />}
        </div>
      ))}
      {!partners.length && <p className="empty">{t("Nog geen partners.")}</p>}
    </div>
  );
}
function MemberUpload({ partnerId }: { partnerId: string }) {
  const act = useAction(); const [txt, setTxt] = useState("");
  return <div className="addrow"><input value={txt} onChange={(e) => setTxt(e.target.value)} placeholder={t("lidnummers of e-mails, gescheiden door komma's of regels")} /><button className="btn ghost" disabled={!txt.trim()} onClick={async () => { const ids = txt.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean); if (await act(() => api.post(`/partners/${partnerId}/members`, { identifiers: ids }), t("{n} leden toegevoegd", { n: ids.length }))) setTxt(""); }}>{t("Ledenlijst toevoegen")}</button></div>;
}
