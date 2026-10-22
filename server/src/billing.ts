// Geld: modelkeuze per taak, gebruiksmeting en budget per gezin, abonnementen en partnercodes (ledenvoordeel).
import { z } from "zod";
import { db, all, get, run, newId, hid } from "./db.js";
import { operatorHousehold } from "./ai.js";

db.exec(`
CREATE TABLE IF NOT EXISTS ai_usage (
  household_id TEXT NOT NULL, month TEXT NOT NULL, task TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cache_read_tokens INTEGER NOT NULL DEFAULT 0, cost_micro INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (household_id, month, task)
);
CREATE TABLE IF NOT EXISTS subscriptions (
  household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  plan TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', partner_id TEXT, discount_pct INTEGER NOT NULL DEFAULT 0,
  valid_until TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, plan TEXT NOT NULL DEFAULT 'plus',
  free_months INTEGER NOT NULL DEFAULT 6, discount_pct INTEGER NOT NULL DEFAULT 30, verify TEXT NOT NULL DEFAULT 'none', domains TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS partner_codes (
  code TEXT PRIMARY KEY, partner_id TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  max_uses INTEGER NOT NULL DEFAULT 1000, uses INTEGER NOT NULL DEFAULT 0, expires_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS partner_members (partner_id TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE, identifier TEXT NOT NULL, PRIMARY KEY (partner_id, identifier));
`);

// ---------- modellen per taak ----------
/** chat = de gezinsassistent met tools; light = sjabloonwerk (briefing verwoorden, vertalen, documenten uitlezen, folders); premium = alleen op uitdrukkelijke keuze. */
export const MODELS = {
  chat: process.env.CLAUDE_MODEL_CHAT ?? process.env.CLAUDE_MODEL ?? "claude-sonnet-5-5",
  light: process.env.CLAUDE_MODEL_LIGHT ?? process.env.LIBRARY_MODEL ?? "claude-haiku-5-5",
  premium: process.env.CLAUDE_MODEL_PREMIUM ?? "claude-opus-5-5",
};
export type Task = "chat" | "briefing" | "import" | "translate" | "search" | "deals" | "inbox" | "other";
/** Prijs per miljoen tokens in microdollar (1 $ = 1.000.000); onbekend model = Sonnet-tarief. */
const PRICE: Record<string, { in: number; out: number; cache: number }> = {
  "claude-haiku-5-5": { in: 100_000, out: 500_000, cache: 10_000 },
  "claude-sonnet-5-5": { in: 2_000_000, out: 10_000_000, cache: 200_000 },
  "claude-sonnet-5": { in: 2_000_000, out: 10_000_000, cache: 200_000 },
  "claude-opus-5-5": { in: 4_000_000, out: 20_000_000, cache: 200_000 },
  "claude-opus-5": { in: 5_000_000, out: 25_000_000, cache: 500_000 },
};
export interface Usage { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }
export function costMicro(model: string, u: Usage): number {
  const p = PRICE[model] ?? PRICE["claude-sonnet-5-5"];
  const inp = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) * 1.25;
  return Math.round((inp * p.in + (u.output_tokens ?? 0) * p.out + (u.cache_read_input_tokens ?? 0) * p.cache) / 1_000_000);
}
const month = () => new Date().toISOString().slice(0, 7);
/** Boek het verbruik van één aanroep. */
export function recordUsage(task: Task, model: string, u: Usage | undefined | null, h = hid()) {
  if (!u) return;
  run(
    `INSERT INTO ai_usage(household_id, month, task, calls, input_tokens, output_tokens, cache_read_tokens, cost_micro) VALUES (?,?,?,1,?,?,?,?)
     ON CONFLICT(household_id, month, task) DO UPDATE SET calls=calls+1, input_tokens=input_tokens+excluded.input_tokens, output_tokens=output_tokens+excluded.output_tokens, cache_read_tokens=cache_read_tokens+excluded.cache_read_tokens, cost_micro=cost_micro+excluded.cost_micro`,
    h, month(), task, u.input_tokens ?? 0, u.output_tokens ?? 0, u.cache_read_input_tokens ?? 0, costMicro(model, u),
  );
}

// ---------- abonnementen en budget ----------
export const PLANS = ["free", "gezin", "plus", "operator"] as const;
export type Plan = typeof PLANS[number];
/** AI-budget per maand in microdollar; free = geen AI (tenzij eigen sleutel: dan operator). */
export const BUDGET: Record<Plan, number> = { free: 0, gezin: 2_500_000, plus: 8_000_000, operator: Number.POSITIVE_INFINITY };
export const PLAN_LABEL: Record<Plan, string> = { free: "Zelf hosten", gezin: "Gezin", plus: "Gezin+", operator: "Eigenaar van de server" };
const DEFAULT_PLAN = (process.env.DEFAULT_PLAN as Plan) || "gezin";

export interface Subscription { plan: Plan; source: string; partnerId: string | null; partnerName: string | null; discountPct: number; validUntil: string | null }
export function subscription(h = hid()): Subscription {
  if (h === operatorHousehold()) return { plan: "operator", source: "operator", partnerId: null, partnerName: null, discountPct: 0, validUntil: null };
  const r = get<{ plan: Plan; source: string; partner_id: string | null; discount_pct: number; valid_until: string | null }>("SELECT plan, source, partner_id, discount_pct, valid_until FROM subscriptions WHERE household_id=?", h);
  if (!r) return { plan: DEFAULT_PLAN, source: "default", partnerId: null, partnerName: null, discountPct: 0, validUntil: null };
  const expired = r.valid_until !== null && r.valid_until < new Date().toISOString();
  const partnerName = r.partner_id ? get<{ name: string }>("SELECT name FROM partners WHERE id=?", r.partner_id)?.name ?? null : null;
  return { plan: expired ? DEFAULT_PLAN : r.plan, source: expired ? "expired" : r.source, partnerId: r.partner_id, partnerName, discountPct: expired ? r.discount_pct : 0, validUntil: r.valid_until };
}
export function setPlan(h: string, plan: Plan, opts: { source?: string; partnerId?: string | null; discountPct?: number; validUntil?: string | null } = {}) {
  run(
    `INSERT INTO subscriptions(household_id, plan, source, partner_id, discount_pct, valid_until) VALUES (?,?,?,?,?,?)
     ON CONFLICT(household_id) DO UPDATE SET plan=excluded.plan, source=excluded.source, partner_id=excluded.partner_id, discount_pct=excluded.discount_pct, valid_until=excluded.valid_until, updated_at=datetime('now')`,
    h, plan, opts.source ?? "manual", opts.partnerId ?? null, opts.discountPct ?? 0, opts.validUntil ?? null,
  );
}
/** Formule weghalen die door één bron gezet was (bv. Stripe na opzegging); een ledenvoordeel van een partner blijft staan. */
export function clearPlan(h: string, source: string) { run("DELETE FROM subscriptions WHERE household_id=? AND source=?", h, source); }
export interface BudgetState { plan: Plan; planLabel: string; usedMicro: number; budgetMicro: number | null; pct: number; blocked: boolean; perTask: { task: string; calls: number; costMicro: number }[]; subscription: Subscription }
export function budgetState(h = hid()): BudgetState {
  const sub = subscription(h);
  const rows = all<{ task: string; calls: number; cost_micro: number }>("SELECT task, calls, cost_micro FROM ai_usage WHERE household_id=? AND month=? ORDER BY cost_micro DESC", h, month());
  const used = rows.reduce((a, r) => a + r.cost_micro, 0);
  const budget = BUDGET[sub.plan];
  const finite = Number.isFinite(budget);
  return { plan: sub.plan, planLabel: PLAN_LABEL[sub.plan], usedMicro: used, budgetMicro: finite ? budget : null, pct: finite && budget > 0 ? Math.min(100, Math.round((used / budget) * 100)) : 0, blocked: finite && used >= budget, perTask: rows.map((r) => ({ task: r.task, calls: r.calls, costMicro: r.cost_micro })), subscription: sub };
}
/** Mag dit gezin nu AI gebruiken? Sjabloonwerk mag tot 120 % van het budget zodat briefings niet abrupt stilvallen. */
export function aiAllowed(task: Task, h = hid()): boolean {
  const b = budgetState(h);
  if (b.budgetMicro === null) return true;
  if (b.budgetMicro === 0) return false;
  const limit = task === "chat" || task === "search" ? b.budgetMicro : b.budgetMicro * 1.2;
  return b.usedMicro < limit;
}
export const BUDGET_MESSAGE: Record<"nl" | "tr" | "en", string> = { en: "This family's AI budget for this month is used up. Briefings and everything that does not need AI keep working. An upgrade to Family+ gives more room.", nl: "Het AI-budget van dit gezin is voor deze maand op. De briefings en alles wat geen AI nodig heeft, blijven gewoon werken. Een upgrade naar Gezin+ geeft meer ruimte.", tr: "Bu ailenin bu ayki yapay zekâ bütçesi doldu. Brifingler ve yapay zekâ gerektirmeyen her şey çalışmaya devam eder. Gezin+ yükseltmesi daha fazla alan verir." };

// ---------- partners en ledenvoordeel ----------
export const PartnerInput = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().regex(/^[a-z0-9-]{2,40}$/),
  plan: z.enum(["gezin", "plus"]).default("plus"),
  freeMonths: z.number().int().min(0).max(36).default(6),
  discountPct: z.number().int().min(0).max(100).default(30),
  verify: z.enum(["none", "domain", "list"]).default("none"),
  domains: z.string().max(400).default(""),
  note: z.string().max(400).default(""),
});
export interface Partner { id: string; name: string; slug: string; plan: Plan; freeMonths: number; discountPct: number; verify: string; domains: string; note: string; createdAt: string }
const pshape = (r: Record<string, unknown>): Partner => ({ id: r.id as string, name: r.name as string, slug: r.slug as string, plan: r.plan as Plan, freeMonths: r.free_months as number, discountPct: r.discount_pct as number, verify: r.verify as string, domains: r.domains as string, note: r.note as string, createdAt: r.created_at as string });
export const listPartners = () => all("SELECT * FROM partners ORDER BY name").map(pshape);
export function createPartner(i: z.infer<typeof PartnerInput>) {
  const id = newId();
  run("INSERT INTO partners(id, name, slug, plan, free_months, discount_pct, verify, domains, note) VALUES (?,?,?,?,?,?,?,?,?)", id, i.name, i.slug, i.plan, i.freeMonths, i.discountPct, i.verify, i.domains, i.note);
  return id;
}
export const deletePartner = (id: string) => run("DELETE FROM partners WHERE id=?", id);
export function createCode(partnerId: string, opts: { code?: string; maxUses?: number; expiresAt?: string | null } = {}) {
  const code = (opts.code ?? `${get<{ slug: string }>("SELECT slug FROM partners WHERE id=?", partnerId)?.slug ?? "gb"}-${Math.random().toString(36).slice(2, 8)}`).toUpperCase();
  run("INSERT INTO partner_codes(code, partner_id, max_uses, expires_at) VALUES (?,?,?,?)", code, partnerId, opts.maxUses ?? 1000, opts.expiresAt ?? null);
  return code;
}
export const listCodes = (partnerId: string) => all<{ code: string; max_uses: number; uses: number; expires_at: string | null }>("SELECT code, max_uses, uses, expires_at FROM partner_codes WHERE partner_id=? ORDER BY created_at DESC", partnerId).map((c) => ({ code: c.code, maxUses: c.max_uses, uses: c.uses, expiresAt: c.expires_at }));
export function addMembers(partnerId: string, identifiers: string[]) { for (const i of identifiers) run("INSERT OR IGNORE INTO partner_members(partner_id, identifier) VALUES (?,?)", partnerId, i.trim().toLowerCase()); }

export class RedeemError extends Error {}
/** Een ledencode inwisselen: controleert code, aantal, vervaldatum en (indien gevraagd) e-maildomein of ledenlijst. */
export function redeem(code: string, identifier: string | null, h = hid()): Subscription {
  const c = get<{ code: string; partner_id: string; max_uses: number; uses: number; expires_at: string | null }>("SELECT * FROM partner_codes WHERE code=?", code.trim().toUpperCase());
  if (!c) throw new RedeemError("Deze code bestaat niet. Controleer de spelling.");
  if (c.uses >= c.max_uses) throw new RedeemError("Deze code is al door het maximale aantal gezinnen gebruikt.");
  if (c.expires_at && c.expires_at < new Date().toISOString()) throw new RedeemError("Deze code is verlopen.");
  const p = pshape(get("SELECT * FROM partners WHERE id=?", c.partner_id)!);
  const id = (identifier ?? "").trim().toLowerCase();
  if (p.verify === "domain") {
    const doms = p.domains.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
    if (!id.includes("@") || !doms.some((d) => id.endsWith("@" + d))) throw new RedeemError(`Vul het e-mailadres in dat je bij ${p.name} gebruikt (${doms.join(", ")}).`);
  }
  if (p.verify === "list" && !get("SELECT 1 FROM partner_members WHERE partner_id=? AND identifier=?", p.id, id)) throw new RedeemError(`Dit lidnummer of e-mailadres staat niet in de ledenlijst van ${p.name}.`);
  const until = p.freeMonths > 0 ? new Date(Date.now() + p.freeMonths * 30.44 * 864e5).toISOString() : null;
  setPlan(h, p.plan, { source: "partner", partnerId: p.id, discountPct: p.discountPct, validUntil: until });
  run("UPDATE partner_codes SET uses=uses+1 WHERE code=?", c.code);
  return subscription(h);
}
/** Cijfers voor het partnerdashboard, zonder persoonsgegevens. */
export function partnerStats(partnerId: string) {
  const subs = all<{ household_id: string; valid_until: string | null }>("SELECT household_id, valid_until FROM subscriptions WHERE partner_id=?", partnerId);
  const now = new Date().toISOString(); const since = new Date(Date.now() - 30 * 864e5).toISOString().replace("T", " ").slice(0, 19);
  const active = (h: string) => !!get("SELECT 1 FROM devices WHERE household_id=? AND last_seen > ?", h, since) || !!get("SELECT 1 FROM ai_usage WHERE household_id=? AND month=?", h, month());
  const inFree = subs.filter((s) => !s.valid_until || s.valid_until > now);
  const afterFree = subs.filter((s) => s.valid_until && s.valid_until <= now);
  return { redeemed: subs.length, inFreePeriod: inFree.length, activeInFreePeriod: inFree.filter((s) => active(s.household_id)).length, afterFreePeriod: afterFree.length, retainedAfterFree: afterFree.filter((s) => active(s.household_id)).length, codes: listCodes(partnerId) };
}
