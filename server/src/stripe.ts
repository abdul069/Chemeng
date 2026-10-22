/** Betalen in de app via Stripe Checkout (abonnement Gezin of Gezin+, per maand of per jaar) en het klantenportaal
 *  (kaart wijzigen, opzeggen, facturen). Zonder STRIPE_SECRET_KEY blijft alles "binnenkort". Geen SDK: de Stripe-API is
 *  gewoon formulier-POST over HTTPS. Webhook met handtekening (STRIPE_WEBHOOK_SECRET) zet de formule van het gezin. */
import crypto from "node:crypto";
import { db, get, run } from "./db.js";
import { setPlan, clearPlan, subscription, type Plan } from "./billing.js";
import { broadcastTo } from "./realtime.js";

db.exec(`
CREATE TABLE IF NOT EXISTS stripe_customers (
  household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL, subscription_id TEXT, status TEXT NOT NULL DEFAULT '', price_id TEXT NOT NULL DEFAULT '', period_end TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS stripe_customers_customer ON stripe_customers(customer_id);
CREATE TABLE IF NOT EXISTS stripe_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
`);

export type Interval = "month" | "year";
export type PaidPlan = Extract<Plan, "gezin" | "plus">;
const KEY = () => process.env.STRIPE_SECRET_KEY || "";
export const available = () => KEY().length > 0;
/** Prijs-id's uit Stripe (price_…), per formule en interval. */
export const prices = (): Record<PaidPlan, Record<Interval, string>> => ({
  gezin: { month: process.env.STRIPE_PRICE_GEZIN_MONTH || "", year: process.env.STRIPE_PRICE_GEZIN_YEAR || "" },
  plus: { month: process.env.STRIPE_PRICE_PLUS_MONTH || "", year: process.env.STRIPE_PRICE_PLUS_YEAR || "" },
});
export function planForPrice(priceId: string): PaidPlan | null {
  const p = prices();
  for (const plan of ["gezin", "plus"] as const) for (const i of ["month", "year"] as const) if (p[plan][i] && p[plan][i] === priceId) return plan;
  return null;
}

// ---------- Stripe-API ----------
type Json = Record<string, unknown>;
function form(params: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
}
export class StripeError extends Error {}
async function call(method: "GET" | "POST", path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<Json> {
  if (!available()) throw new StripeError("Betalen is nog niet ingeschakeld op deze server.");
  const body = method === "POST" ? form(params) : "";
  const r = await fetch(`https://api.stripe.com/v1/${path}${method === "GET" && body === "" && Object.keys(params).length ? `?${form(params)}` : ""}`, {
    method, headers: { authorization: `Bearer ${KEY()}`, "content-type": "application/x-www-form-urlencoded" }, body: method === "POST" ? body : undefined, signal: AbortSignal.timeout(15_000),
  });
  const j = (await r.json().catch(() => ({}))) as Json & { error?: { message?: string } };
  if (!r.ok) throw new StripeError(j.error?.message || `Stripe antwoordde ${r.status}`);
  return j;
}

export interface CustomerRow { household_id: string; customer_id: string; subscription_id: string | null; status: string; price_id: string; period_end: string | null }
export const customerOf = (h: string) => get<CustomerRow>("SELECT * FROM stripe_customers WHERE household_id=?", h) ?? null;
const householdOfCustomer = (customerId: string) => get<{ household_id: string }>("SELECT household_id FROM stripe_customers WHERE customer_id=?", customerId)?.household_id ?? null;

async function ensureCustomer(h: string, email: string | null, name: string): Promise<string> {
  const row = customerOf(h); if (row) return row.customer_id;
  const c = await call("POST", "customers", { email: email ?? undefined, name, "metadata[household_id]": h });
  run("INSERT INTO stripe_customers(household_id, customer_id) VALUES (?,?) ON CONFLICT(household_id) DO UPDATE SET customer_id=excluded.customer_id, updated_at=datetime('now')", h, c.id as string);
  return c.id as string;
}
/** Een Checkout-sessie: de gebruiker betaalt op de Stripe-pagina en komt terug naar de app. Kortingscodes (ledenvoordeel) kunnen daar ingevuld worden. */
export async function checkout(h: string, plan: PaidPlan, interval: Interval, origin: string, who: { email: string | null; name: string }): Promise<string> {
  const price = prices()[plan][interval];
  if (!price) throw new StripeError("Voor deze formule is nog geen prijs ingesteld.");
  const customer = await ensureCustomer(h, who.email, who.name);
  const sub = subscription(h);
  const s = await call("POST", "checkout/sessions", {
    mode: "subscription", customer, client_reference_id: h, "line_items[0][price]": price, "line_items[0][quantity]": 1,
    success_url: `${origin}/?billing=ok`, cancel_url: `${origin}/?billing=cancel`, allow_promotion_codes: true, locale: "auto",
    "subscription_data[metadata][household_id]": h, "subscription_data[metadata][plan]": plan,
    ...(sub.source === "expired" && sub.discountPct > 0 && process.env[`STRIPE_COUPON_${sub.discountPct}`] ? { "discounts[0][coupon]": process.env[`STRIPE_COUPON_${sub.discountPct}`] } : {}),
  });
  return s.url as string;
}
/** Klantenportaal: kaart wijzigen, factuur, opzeggen. */
export async function portal(h: string, origin: string): Promise<string> {
  const row = customerOf(h); if (!row) throw new StripeError("Dit gezin heeft nog geen betaling via de app.");
  const s = await call("POST", "billing_portal/sessions", { customer: row.customer_id, return_url: `${origin}/?billing=portal` });
  return s.url as string;
}

// ---------- webhook ----------
/** Handtekening van Stripe controleren: header "t=…,v1=…", HMAC-SHA256 over "t.body", max 5 minuten oud. */
export function verifySignature(raw: Buffer | string, header: string | undefined, secret: string, now = Date.now()): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t); const v1s = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !v1s.length || Math.abs(now / 1000 - t) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${typeof raw === "string" ? raw : raw.toString("utf8")}`).digest("hex");
  return v1s.some((v) => v.length === expected.length && crypto.timingSafeEqual(Buffer.from(v), Buffer.from(expected)));
}
export function sign(raw: string, secret: string, now = Date.now()): string { const t = Math.floor(now / 1000); return `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`; }

interface StripeSub { id: string; customer: string; status: string; metadata?: Record<string, string>; current_period_end?: number; cancel_at_period_end?: boolean; items?: { data?: { price?: { id: string }; current_period_end?: number }[] } }
export interface StripeEvent { id: string; type: string; data: { object: Json } }
/** Eén gebeurtenis verwerken (idempotent). Geeft terug welk gezin geraakt is. */
export function handleEvent(evt: StripeEvent): { household: string | null; applied: boolean } {
  if (get("SELECT 1 FROM stripe_events WHERE id=?", evt.id)) return { household: null, applied: false };
  run("INSERT INTO stripe_events(id, type) VALUES (?,?)", evt.id, evt.type);
  const o = evt.data.object;
  if (evt.type === "checkout.session.completed") {
    const h = (o.client_reference_id as string | null) ?? (o.metadata as Record<string, string> | undefined)?.household_id ?? null;
    const customer = typeof o.customer === "string" ? o.customer : null;
    if (h && customer) run("INSERT INTO stripe_customers(household_id, customer_id, subscription_id) VALUES (?,?,?) ON CONFLICT(household_id) DO UPDATE SET customer_id=excluded.customer_id, subscription_id=COALESCE(excluded.subscription_id, subscription_id), updated_at=datetime('now')", h, customer, typeof o.subscription === "string" ? o.subscription : null);
    return { household: h, applied: false };
  }
  if (/^customer\.subscription\.(created|updated|deleted)$/.test(evt.type)) {
    const s = o as unknown as StripeSub;
    const h = s.metadata?.household_id || householdOfCustomer(s.customer);
    if (!h) return { household: null, applied: false };
    const priceId = s.items?.data?.[0]?.price?.id ?? "";
    const plan = planForPrice(priceId) ?? (s.metadata?.plan === "plus" ? "plus" : s.metadata?.plan === "gezin" ? "gezin" : null);
    const endSec = s.current_period_end ?? s.items?.data?.[0]?.current_period_end ?? null;
    const periodEnd = endSec ? new Date(endSec * 1000).toISOString() : null;
    run("INSERT INTO stripe_customers(household_id, customer_id, subscription_id, status, price_id, period_end) VALUES (?,?,?,?,?,?) ON CONFLICT(household_id) DO UPDATE SET customer_id=excluded.customer_id, subscription_id=excluded.subscription_id, status=excluded.status, price_id=excluded.price_id, period_end=excluded.period_end, updated_at=datetime('now')", h, s.customer, s.id, s.status, priceId, periodEnd);
    const live = evt.type !== "customer.subscription.deleted" && ["active", "trialing", "past_due"].includes(s.status);
    if (live && plan) setPlan(h, plan, { source: "stripe", validUntil: periodEnd ? new Date(Date.parse(periodEnd) + 3 * 864e5).toISOString() : null });
    else clearPlan(h, "stripe");
    broadcastTo(h, ["settings"]);
    return { household: h, applied: true };
  }
  return { household: null, applied: false };
}
/** De Express-handler voor POST /api/billing/stripe/webhook (verwacht de ruwe body als Buffer). */
export function webhook(raw: Buffer, signature: string | undefined): { status: number; body: Json } {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || "";
  if (!secret) return { status: 503, body: { error: "STRIPE_WEBHOOK_SECRET ontbreekt" } };
  if (!verifySignature(raw, signature, secret)) return { status: 400, body: { error: "Ongeldige handtekening" } };
  let evt: StripeEvent; try { evt = JSON.parse(raw.toString("utf8")); } catch { return { status: 400, body: { error: "Geen JSON" } }; }
  const r = handleEvent(evt);
  return { status: 200, body: { received: true, ...r } };
}
/** Voor de instellingen: is betalen mogelijk en loopt er een abonnement via de app? */
export function state(h: string) {
  const row = customerOf(h); const p = prices();
  return { available: available(), managed: !!row?.subscription_id && !!row.status && row.status !== "canceled", status: row?.status ?? null, periodEnd: row?.period_end ?? null, offers: { gezin: { month: !!p.gezin.month, year: !!p.gezin.year }, plus: { month: !!p.plus.month, year: !!p.plus.year } } };
}
