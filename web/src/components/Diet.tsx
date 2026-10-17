import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { Member, Slot } from "../types";
import { Avatar, Fold, Modal, cvar } from "./ui";
import { Icon } from "./Icons";
import { addDays, relDay, todayIso } from "../dates";
import { t as tr, getLang } from "../i18n";

/* ---------- types van de server ---------- */
interface Macros { kcal: number; protein: number; carbs: number; fat: number }
interface Profile { memberId: string; sex: "m" | "v"; age: number; heightCm: number; weightKg: number; activity: number; goal: "afvallen" | "behouden" | "aankomen"; kcalGoal: number | null; bmr: number; tdee: number; goal_kcal: number; targets: Omit<Macros, "kcal"> }
interface Entry extends Macros { id: string; memberId: string; date: string; slot: Slot; text: string; grams: number | null; recipeId: string | null }
interface Planned { slot: Slot; title: string; recipeId: string | null; kcal: number | null; logged: boolean }
interface Day { date: string; profile: Profile | null; entries: Entry[]; totals: Macros; week: { date: string; kcal: number }[]; weights: { date: string; kg: number }[]; planned: Planned[] }
interface Food { id: string; label: string; names: string[]; kcal: number; protein: number; carbs: number; fat: number; unit: number | null; cat: string }

const SLOTS: Slot[] = ["ontbijt", "lunch", "diner", "snack"];
const SLOT_ICON: Record<Slot, string> = { ontbijt: "🥐", lunch: "🥪", diner: "🍲", snack: "🍎" };
const slotName = (s: Slot) => tr({ ontbijt: "Ontbijt", lunch: "Lunch", diner: "Avondeten", snack: "Tussendoor" }[s]);
const ACTIVITIES: { v: number; nl: string; tr: string }[] = [
  { v: 1.2, nl: "Weinig beweging (zittend)", tr: "Az hareket (oturarak)" },
  { v: 1.4, nl: "Licht actief (1–3× sport per week)", tr: "Hafif aktif (haftada 1–3 spor)" },
  { v: 1.6, nl: "Actief (3–5× sport per week)", tr: "Aktif (haftada 3–5 spor)" },
  { v: 1.8, nl: "Heel actief (dagelijks sport of zwaar werk)", tr: "Çok aktif (her gün spor veya ağır iş)" },
];
const DEFAULT_SLOT = (): Slot => { const h = new Date().getHours(); return h < 10 ? "ontbijt" : h < 14 ? "lunch" : h < 17 ? "snack" : "diner"; };

/** Dieet & calorieën: per gezinslid een dagboek, caloriedoel, gewicht en verboden ingrediënten. */
export function DietApp() {
  const { data, toast } = useData();
  const act = useAction();
  const members = (data?.members ?? []).filter((m) => m.role !== "huisdier");
  const [who, setWho] = useState<string>(() => { try { return localStorage.getItem("gb.diet.who") ?? ""; } catch { return ""; } });
  const me = members.find((m) => m.id === who) ?? members[0];
  useEffect(() => { if (me) { try { localStorage.setItem("gb.diet.who", me.id); } catch { /* */ } } }, [me]);
  const [date, setDate] = useState(todayIso());
  const [day, reload] = useRemote<Day | null>(me ? `/diet/day?member=${me.id}&date=${date}` : null, ["diet", "meals", "recipes", "members"], null);
  const [pickRecipe, setPickRecipe] = useState(false);
  if (!me) return <p className="empty">{tr("Nog geen gezinsleden.")}</p>;
  const goal = day?.profile?.goal_kcal ?? null;
  const eaten = day?.totals.kcal ?? 0;
  const left = goal !== null ? goal - eaten : null;

  const addEntry = async (body: Record<string, unknown>) => {
    const r = await act(() => api.post<{ entry: Entry; warning: string[] }>("/diet/log", { memberId: me.id, date, ...body }));
    if (r) { reload(); if (r.warning.length) toast(tr("⚠️ Let op, {name} vermijdt: {w}", { name: me.name, w: r.warning.join(", ") })); }
    return !!r;
  };

  return (
    <div className="page-scroll diet" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="picks who-picks">
        {members.map((m: Member) => <button key={m.id} type="button" className="pick pick-person" style={cvar(m.color)} aria-pressed={m.id === me.id} onClick={() => setWho(m.id)}><Avatar m={m} size={22} dot={false} /> {m.name}</button>)}
      </div>
      <div className="weeknav">
        <button className="iconbtn" onClick={() => setDate(addDays(date, -1))} aria-label={tr("Vorige dag")}><Icon.left /></button>
        <span className="range">{relDay(date)}</span>
        <button className="iconbtn" onClick={() => setDate(addDays(date, 1))} aria-label={tr("Volgende dag")}><Icon.right /></button>
        {date !== todayIso() && <button className="pill" onClick={() => setDate(todayIso())}>{tr("Vandaag")}</button>}
      </div>

      <section className="card card-pad diet-top" style={cvar(me.color)}>
        <Ring value={eaten} max={goal ?? Math.max(2000, eaten)} />
        <div className="diet-sum">
          <b className="num">{eaten} <small>kcal</small></b>
          {goal !== null
            ? <span className={`diet-left${left! < 0 ? " over" : ""}`}>{left! >= 0 ? tr("nog {n} kcal te gaan", { n: left! }) : tr("{n} kcal over je doel", { n: -left! })} · {tr("doel")} {goal}</span>
            : <span className="hint">{tr("Vul hieronder je profiel in voor een persoonlijk caloriedoel.")}</span>}
          {day?.profile && (
            <div className="macros">
              <Macro label={tr("Eiwit")} v={day.totals.protein} max={day.profile.targets.protein} c="#48d1c4" />
              <Macro label={tr("Koolhydraten")} v={day.totals.carbs} max={day.profile.targets.carbs} c="#ffb75e" />
              <Macro label={tr("Vet")} v={day.totals.fat} max={day.profile.targets.fat} c="#b58cf0" />
            </div>
          )}
        </div>
      </section>

      <AddRow onAdd={addEntry} onRecipe={() => setPickRecipe(true)} />

      {!!day?.planned.length && (
        <div className="diet-planned">
          <span className="hint">{tr("Gepland vandaag")}:</span>
          {day.planned.map((p) => (
            <button key={p.slot} className={`pill${p.logged ? " done" : ""}`} disabled={p.logged || (!p.recipeId && p.kcal === null)} title={p.recipeId ? tr("Uit recept, 1 portie") : tr("Geen recept gekoppeld: voeg zelf de calorieën toe")}
              onClick={() => addEntry(p.recipeId ? { recipeId: p.recipeId, portions: 1, slot: p.slot } : { text: p.title, slot: p.slot })}>
              {SLOT_ICON[p.slot]} {p.title}{p.kcal !== null ? <small className="muted"> ~{p.kcal} kcal</small> : null}{p.logged ? " ✓" : " +"}
            </button>
          ))}
        </div>
      )}

      <section className="card card-pad diet-log">
        {!day?.entries.length && <p className="hint">{tr("Nog niets genoteerd. Typ hierboven wat je at, bv. “2 eieren” of “1 banaan”, of kies een recept.")}</p>}
        {SLOTS.filter((s) => day?.entries.some((e) => e.slot === s)).map((s) => (
          <div key={s} className="diet-slot">
            <div className="aisle-h"><b>{SLOT_ICON[s]} {slotName(s)}</b><span className="num muted">{Math.round(day!.entries.filter((e) => e.slot === s).reduce((a, e) => a + e.kcal, 0))} kcal</span></div>
            {day!.entries.filter((e) => e.slot === s).map((e) => (
              <div className="item diet-item" key={e.id}>
                <span className="diet-txt">{e.text}{e.recipeId && <small className="muted"> · {tr("recept")}</small>}</span>
                <span className="num diet-kcal">{Math.round(e.kcal)} <small>kcal</small></span>
                <small className="muted num diet-macro">{Math.round(e.protein)}E · {Math.round(e.carbs)}K · {Math.round(e.fat)}V</small>
                <button className="iconbtn" aria-label={tr("Verwijderen")} onClick={async () => { await act(() => api.del(`/diet/log/${e.id}`)); reload(); }}><Icon.trash /></button>
              </div>
            ))}
          </div>
        ))}
      </section>

      {day && <WeekBars week={day.week} goal={goal} />}
      <ProfileFold me={me} profile={day?.profile ?? null} onSaved={reload} />
      <ForbiddenFold me={me} />
      <WeightFold me={me} weights={day?.weights ?? []} onSaved={reload} />
      {pickRecipe && <RecipePicker onClose={() => setPickRecipe(false)} onPick={async (id, portions, slot) => { if (await addEntry({ recipeId: id, portions, slot })) setPickRecipe(false); }} />}
    </div>
  );
}

function Ring({ value, max }: { value: number; max: number }) {
  const r = 44; const c = 2 * Math.PI * r; const p = Math.min(1, value / Math.max(1, max)); const over = value > max;
  return (
    <svg className="ring" viewBox="0 0 100 100" aria-hidden>
      <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(30,38,50,.1)" strokeWidth="10" />
      <circle cx="50" cy="50" r={r} fill="none" stroke={over ? "var(--danger)" : "var(--c, var(--accent))"} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${c * p} ${c}`} transform="rotate(-90 50 50)" style={{ transition: "stroke-dasharray .5s ease" }} />
      <text x="50" y="47" textAnchor="middle" fontSize="20" fontWeight="700" fill="currentColor">{Math.round(p * 100)}%</text>
      <text x="50" y="63" textAnchor="middle" fontSize="9" fill="var(--muted)">{tr("van doel")}</text>
    </svg>
  );
}
function Macro({ label, v, max, c }: { label: string; v: number; max: number; c: string }) {
  return <span className="macro"><small>{label} <b className="num">{Math.round(v)}</b><span className="muted">/{max} g</span></small><i><em style={{ width: `${Math.min(100, (v / Math.max(1, max)) * 100)}%`, background: c }} /></i></span>;
}
function WeekBars({ week, goal }: { week: { date: string; kcal: number }[]; goal: number | null }) {
  const max = Math.max(goal ?? 0, ...week.map((w) => w.kcal), 1);
  const DAYS = getLang() === "tr" ? ["Pz", "Pt", "Sa", "Ça", "Pe", "Cu", "Ct"] : ["zo", "ma", "di", "wo", "do", "vr", "za"];
  return (
    <section className="card card-pad">
      <div className="section-title" style={{ marginBottom: 6 }}><h2>{tr("Deze week")}</h2>{goal !== null && <span className="hint">{tr("doel")} {goal} kcal/dag</span>}</div>
      <div className="weekbars">
        {goal !== null && <i className="goal-line" style={{ bottom: `calc(18px + (100% - 24px) * ${goal / max})` }} />}
        {week.map((w) => <span key={w.date} className={`wb${goal !== null && w.kcal > goal ? " over" : ""}`} title={`${w.date}: ${w.kcal} kcal`}><em style={{ height: `${(w.kcal / max) * 100}%` }} /><small>{DAYS[new Date(w.date + "T12:00:00").getDay()]}</small></span>)}
      </div>
    </section>
  );
}

/* ---------- toevoegen: vrije tekst, zoeken in de tabel, of recept ---------- */
function AddRow({ onAdd, onRecipe }: { onAdd: (b: Record<string, unknown>) => Promise<boolean>; onRecipe: () => void }) {
  const [text, setText] = useState("");
  const [slot, setSlot] = useState<Slot>(DEFAULT_SLOT());
  const [foods, setFoods] = useState<Food[]>([]);
  const [food, setFood] = useState<Food | null>(null);
  const [grams, setGrams] = useState("");
  const [manual, setManual] = useState<null | { kcal: string }>(null);
  useEffect(() => {
    const q = text.replace(/^[\d.,½¼¾\s]+(g|gr|gram|ml|el|tl|stuks?|adet)?\s*/i, "").trim();
    if (q.length < 2 || food) { setFoods([]); return; }
    let live = true; const tm = setTimeout(() => api.get<Food[]>(`/diet/foods?q=${encodeURIComponent(q)}`).then((r) => live && setFoods(r)).catch(() => {}), 150);
    return () => { live = false; clearTimeout(tm); };
  }, [text, food]);
  const reset = () => { setText(""); setFood(null); setGrams(""); setFoods([]); setManual(null); };
  const submit = async () => {
    if (food) { if (await onAdd({ foodId: food.id, grams: Number(grams) || food.unit || 100, text: food.label, slot })) reset(); return; }
    if (manual) { if (await onAdd({ text, kcal: Number(manual.kcal) || 0, slot })) reset(); return; }
    if (!text.trim()) return;
    const ok = await onAdd({ text, slot });
    if (ok) reset(); else setManual({ kcal: "" });
  };
  return (
    <div className="card card-pad diet-add">
      <div className="addrow">
        <input value={text} onChange={(e) => { setText(e.target.value); setFood(null); setManual(null); }} placeholder={tr("Wat heb je gegeten? bv. 2 eieren, 1 banaan, 150 g kip")} aria-label={tr("Eten toevoegen")} onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
        <select value={slot} onChange={(e) => setSlot(e.target.value as Slot)} aria-label={tr("Maaltijd")}>{SLOTS.map((s) => <option key={s} value={s}>{SLOT_ICON[s]} {slotName(s)}</option>)}</select>
        {food && <input className="grams" type="number" inputMode="numeric" min={1} value={grams} onChange={(e) => setGrams(e.target.value)} placeholder={`${food.unit ?? 100} g`} aria-label={tr("Gram")} />}
        {manual && <input className="grams" type="number" inputMode="numeric" min={0} value={manual.kcal} onChange={(e) => setManual({ kcal: e.target.value })} placeholder="kcal" aria-label="kcal" autoFocus />}
        <button className="btn" onClick={() => void submit()} disabled={!text.trim()}>{tr("Toevoegen")}</button>
        <button className="pill" onClick={onRecipe}>🍲 {tr("Recept")}</button>
      </div>
      {manual && <p className="hint">{tr("Dit product staat niet in de tabel. Vul de calorieën zelf in.")}</p>}
      {!!foods.length && !food && (
        <div className="food-hits">
          {foods.map((f) => <button key={f.id} className="pill" onClick={() => { setFood(f); setText(f.label); setFoods([]); }}>{f.label} <small className="muted num">{f.kcal} kcal/100 g</small></button>)}
        </div>
      )}
      {food && <p className="hint">{tr("{n} kcal per 100 g · {p} g eiwit · {c} g koolhydraten · {f} g vet", { n: food.kcal, p: food.protein, c: food.carbs, f: food.fat })}{food.unit ? ` · 1 ${tr("stuk")} ≈ ${food.unit} g` : ""}</p>}
    </div>
  );
}

function RecipePicker({ onClose, onPick }: { onClose: () => void; onPick: (id: string, portions: number, slot: Slot) => void }) {
  const { data } = useData();
  const [q, setQ] = useState("");
  const [portions, setPortions] = useState(1);
  const [slot, setSlot] = useState<Slot>(DEFAULT_SLOT());
  const [kcal, setKcal] = useState<Record<string, number>>({});
  const list = useMemo(() => (data?.recipes ?? []).filter((r) => r.title.toLowerCase().includes(q.toLowerCase())).slice(0, 40), [data?.recipes, q]);
  useEffect(() => { list.slice(0, 12).forEach((r) => { if (kcal[r.id] === undefined) api.get<{ kcal: number }>(`/recipes/${r.id}/nutrition`).then((n) => setKcal((k) => ({ ...k, [r.id]: n.kcal }))).catch(() => {}); }); }, [list]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title={tr("Recept in dagboek")} onClose={onClose}>
      <div className="addrow">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Zoek een recept")} autoFocus />
        <select value={slot} onChange={(e) => setSlot(e.target.value as Slot)}>{SLOTS.map((s) => <option key={s} value={s}>{SLOT_ICON[s]} {slotName(s)}</option>)}</select>
        <label className="field inline"><span>{tr("Porties")}</span><input type="number" min={0.5} step={0.5} max={10} value={portions} onChange={(e) => setPortions(Number(e.target.value) || 1)} style={{ width: 70 }} /></label>
      </div>
      <div className="upnext" style={{ maxHeight: "50vh", overflow: "auto" }}>
        {list.map((r) => <button key={r.id} className="item" onClick={() => onPick(r.id, portions, slot)}><span style={{ flex: 1 }}>{r.title}</span><small className="num">{kcal[r.id] !== undefined ? `~${Math.round(kcal[r.id] * portions)} kcal` : "…"}</small></button>)}
        {!list.length && <p className="hint">{tr("Geen recept gevonden.")}</p>}
      </div>
    </Modal>
  );
}

/* ---------- profiel & doel ---------- */
function ProfileFold({ me, profile, onSaved }: { me: Member; profile: Profile | null; onSaved: () => void }) {
  const act = useAction();
  const [f, setF] = useState({ sex: profile?.sex ?? "v", age: String(profile?.age ?? ""), heightCm: String(profile?.heightCm ?? ""), weightKg: String(profile?.weightKg ?? ""), activity: profile?.activity ?? 1.4, goal: profile?.goal ?? "behouden", kcalGoal: profile?.kcalGoal ? String(profile.kcalGoal) : "" });
  useEffect(() => { setF({ sex: profile?.sex ?? "v", age: String(profile?.age ?? ""), heightCm: String(profile?.heightCm ?? ""), weightKg: String(profile?.weightKg ?? ""), activity: profile?.activity ?? 1.4, goal: profile?.goal ?? "behouden", kcalGoal: profile?.kcalGoal ? String(profile.kcalGoal) : "" }); }, [profile, me.id]);
  const valid = Number(f.age) >= 2 && Number(f.heightCm) >= 60 && Number(f.weightKg) >= 10;
  const save = async () => {
    const r = await act(() => api.put<Profile>(`/diet/profile/${me.id}`, { sex: f.sex, age: Number(f.age), heightCm: Number(f.heightCm), weightKg: Number(f.weightKg), activity: Number(f.activity), goal: f.goal, kcalGoal: f.kcalGoal ? Number(f.kcalGoal) : null }), tr("Profiel bewaard"));
    if (r) onSaved();
  };
  return (
    <Fold title={tr("Profiel en caloriedoel van {name}", { name: me.name })} open={!profile} hint={profile ? `${profile.goal_kcal} kcal/dag` : undefined}>
      <div className="diet-form">
        <label className="field"><span>{tr("Geslacht")}</span><select value={f.sex} onChange={(e) => setF({ ...f, sex: e.target.value as "m" | "v" })}><option value="v">{tr("Vrouw")}</option><option value="m">{tr("Man")}</option></select></label>
        <label className="field"><span>{tr("Leeftijd")}</span><input type="number" inputMode="numeric" min={2} max={110} value={f.age} onChange={(e) => setF({ ...f, age: e.target.value })} /></label>
        <label className="field"><span>{tr("Lengte (cm)")}</span><input type="number" inputMode="numeric" min={60} max={250} value={f.heightCm} onChange={(e) => setF({ ...f, heightCm: e.target.value })} /></label>
        <label className="field"><span>{tr("Gewicht (kg)")}</span><input type="number" inputMode="decimal" step={0.1} min={10} max={350} value={f.weightKg} onChange={(e) => setF({ ...f, weightKg: e.target.value })} /></label>
        <label className="field wide"><span>{tr("Beweging")}</span><select value={f.activity} onChange={(e) => setF({ ...f, activity: Number(e.target.value) })}>{ACTIVITIES.map((a) => <option key={a.v} value={a.v}>{getLang() === "tr" ? a.tr : a.nl}</option>)}</select></label>
        <label className="field"><span>{tr("Doel")}</span><select value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value as Profile["goal"] })}><option value="afvallen">{tr("Afvallen (−500 kcal)")}</option><option value="behouden">{tr("Gewicht behouden")}</option><option value="aankomen">{tr("Aankomen (+300 kcal)")}</option></select></label>
        <label className="field"><span>{tr("Eigen doel (kcal, leeg = berekend)")}</span><input type="number" inputMode="numeric" min={800} max={6000} value={f.kcalGoal} onChange={(e) => setF({ ...f, kcalGoal: e.target.value })} placeholder={profile ? String(profile.tdee + (f.goal === "afvallen" ? -500 : f.goal === "aankomen" ? 300 : 0)) : ""} /></label>
      </div>
      {profile && <p className="hint">{tr("Rustverbranding {b} kcal · dagelijks verbruik {t} kcal · doel {g} kcal (Mifflin-St Jeor).", { b: profile.bmr, t: profile.tdee, g: profile.goal_kcal })}</p>}
      <div><button className="btn" onClick={() => void save()} disabled={!valid}>{tr("Bewaren")}</button></div>
    </Fold>
  );
}

/* ---------- verboden ingrediënten per persoon ---------- */
const SUGGEST = ["noten", "pinda", "gluten", "lactose", "melk", "ei", "vis", "schaaldieren", "soja", "sesam", "varkensvlees", "alcohol", "gelatine", "suiker", "rundvlees", "kip"];
function ForbiddenFold({ me }: { me: Member }) {
  const act = useAction();
  const words = (me.diet ?? "").split(/[,;\n]/).map((w) => w.trim()).filter(Boolean);
  const [txt, setTxt] = useState("");
  const save = (list: string[]) => act(() => api.put(`/members/${me.id}`, { name: me.name, color: me.color, avatar: me.avatar, photo: me.photo, role: me.role, birthday: me.birthday ?? null, diet: list.join(", ") }));
  const add = (w: string) => { const v = w.trim(); if (!v || words.some((x) => x.toLowerCase() === v.toLowerCase())) return; void save([...words, v]); setTxt(""); };
  return (
    <Fold title={tr("Verboden ingrediënten voor {name}", { name: me.name })} hint={words.length ? words.join(", ") : tr("geen")}>
      <p className="hint">{tr("Allergieën, intoleranties of wat {name} niet eet. Recepten en het dagboek waarschuwen als het erin zit.", { name: me.name })}</p>
      <div className="picks">
        {words.map((w) => <button key={w} className="pill on" onClick={() => void save(words.filter((x) => x !== w))} title={tr("Verwijderen")}>{w} ✕</button>)}
        {!words.length && <span className="hint">{tr("Nog niets ingesteld.")}</span>}
      </div>
      <div className="addrow">
        <input value={txt} onChange={(e) => setTxt(e.target.value)} placeholder={tr("Ingrediënt toevoegen, bv. noten")} onKeyDown={(e) => { if (e.key === "Enter") add(txt); }} />
        <button className="btn" onClick={() => add(txt)} disabled={!txt.trim()}>{tr("Toevoegen")}</button>
      </div>
      <div className="picks">{SUGGEST.filter((s) => !words.some((w) => w.toLowerCase() === s)).map((s) => <button key={s} className="pill small" onClick={() => add(s)}>+ {tr(s)}</button>)}</div>
    </Fold>
  );
}

/* ---------- gewicht ---------- */
function WeightFold({ me, weights, onSaved }: { me: Member; weights: { date: string; kg: number }[]; onSaved: () => void }) {
  const act = useAction();
  const [kg, setKg] = useState("");
  const last = weights[weights.length - 1];
  const first = weights[0];
  const min = Math.min(...weights.map((w) => w.kg)), max = Math.max(...weights.map((w) => w.kg));
  return (
    <Fold title={tr("Gewicht")} hint={last ? `${last.kg} kg` : undefined}>
      <div className="addrow">
        <input type="number" inputMode="decimal" step={0.1} min={10} max={350} value={kg} onChange={(e) => setKg(e.target.value)} placeholder={last ? `${last.kg}` : "kg"} aria-label="kg" />
        <button className="btn" disabled={!Number(kg)} onClick={async () => { const r = await act(() => api.post("/diet/weight", { memberId: me.id, date: todayIso(), kg: Number(kg) }), tr("Gewicht genoteerd")); if (r) { setKg(""); onSaved(); } }}>{tr("Vandaag noteren")}</button>
      </div>
      {weights.length >= 2 && (
        <>
          <svg className="spark" viewBox="0 0 300 60" preserveAspectRatio="none" aria-hidden>
            <polyline fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" points={weights.map((w, i) => `${(i / (weights.length - 1)) * 300},${55 - ((w.kg - min) / Math.max(0.1, max - min)) * 50}`).join(" ")} />
          </svg>
          <p className="hint num">{first.date} {first.kg} kg → {last.date} {last.kg} kg · {last.kg - first.kg >= 0 ? "+" : ""}{Math.round((last.kg - first.kg) * 10) / 10} kg</p>
        </>
      )}
    </Fold>
  );
}

/* ---------- in het recept: kcal per portie en “in dagboek” ---------- */
export interface Nutrition { kcal: number; perServing: Macros; servings: number; matched: number; lines: { line: string; food: string | null; grams: number | null; kcal: number | null; guessed: boolean }[]; guessed: number; manualKcal: number | null; source: "manual" | "estimate"; forbidden: { memberId: string; name: string; hits: string[] }[] }
export function useNutrition(recipeId: string) {
  const [n, setN] = useState<Nutrition | null>(null);
  const load = () => api.get<Nutrition>(`/recipes/${recipeId}/nutrition`).then(setN).catch(() => setN(null));
  useEffect(() => { void load(); }, [recipeId]); // eslint-disable-line react-hooks/exhaustive-deps
  return [n, load] as const;
}
export function RecipeCalories({ recipeId, servingsShown }: { recipeId: string; servingsShown: number }) {
  const { data, toast } = useData();
  const act = useAction();
  const [n, reload] = useNutrition(recipeId);
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState("");
  const [log, setLog] = useState(false);
  const members = (data?.members ?? []).filter((m) => m.role !== "huisdier");
  if (!n) return null;
  return (
    <>
      <button className={`badge kcal${n.source === "manual" ? " manual" : ""}`} onClick={() => { setManual(n.manualKcal ? String(n.manualKcal) : ""); setOpen(true); }} title={tr("Calorieën per portie: tik voor details")}>🔥 {n.kcal} kcal/{tr("portie")}{n.source === "estimate" ? " ≈" : ""}</button>
      <button className="badge" onClick={() => setLog(true)} title={tr("Zet dit recept in het dieetdagboek")}>📒 {tr("In dagboek")}</button>
      {n.forbidden.map((f) => <span key={f.memberId} className="badge warn" title={tr("Verboden ingrediënt volgens het profiel")}>⚠️ {tr("Niet voor {name}", { name: f.name })}: {f.hits.join(", ")}</span>)}
      {open && (
        <Modal title={tr("Voedingswaarde per portie")} onClose={() => setOpen(false)}>
          <p className="hint">{n.source === "manual" ? tr("Handmatig ingevuld: {k} kcal per portie.", { k: n.manualKcal ?? 0 }) : tr("Geschat uit de ingrediënten: {m} van {t} regels herkend, bij {g} zonder hoeveelheid is een portie gegokt. Recept voor {s} porties.", { m: n.matched, t: n.lines.length, g: n.guessed, s: n.servings })}</p>
          <div className="macros big">
            <span className="badge">🔥 {n.perServing.kcal} kcal</span><span className="badge">{tr("Eiwit")} {n.perServing.protein} g</span><span className="badge">{tr("Koolhydraten")} {n.perServing.carbs} g</span><span className="badge">{tr("Vet")} {n.perServing.fat} g</span>
          </div>
          <div className="upnext" style={{ maxHeight: "40vh", overflow: "auto" }}>
            {n.lines.map((l, i) => <div className="item" key={i}><span style={{ flex: 1 }}>{l.line}</span><small className="num">{l.food ? `${l.grams} g · ${l.kcal} kcal${l.guessed ? " ?" : ""}` : tr("niet herkend")}</small></div>)}
          </div>
          <div className="addrow">
            <input type="number" inputMode="numeric" min={0} max={5000} value={manual} onChange={(e) => setManual(e.target.value)} placeholder={tr("Eigen kcal per portie")} />
            <button className="btn" onClick={async () => { await act(() => api.put(`/recipes/${recipeId}/kcal`, { kcal: manual ? Number(manual) : null }), tr("Bewaard")); void reload(); setOpen(false); }}>{tr("Bewaren")}</button>
            {n.manualKcal !== null && <button className="pill" onClick={async () => { await act(() => api.put(`/recipes/${recipeId}/kcal`, { kcal: null })); void reload(); setOpen(false); }}>{tr("Terug naar schatting")}</button>}
          </div>
        </Modal>
      )}
      {log && (
        <Modal title={tr("In dagboek van…")} onClose={() => setLog(false)}>
          <p className="hint">{tr("1 portie van dit recept wordt genoteerd op vandaag.")} {servingsShown !== n.servings ? tr("(Je bekijkt het recept voor {s} porties; per portie blijft gelijk.)", { s: servingsShown }) : ""}</p>
          <div className="picks">
            {members.map((m) => <button key={m.id} className="pick pick-person" style={cvar(m.color)} onClick={async () => { const r = await act(() => api.post<{ entry: unknown; warning: string[] }>("/diet/log", { memberId: m.id, date: todayIso(), slot: DEFAULT_SLOT(), recipeId, portions: 1 }), tr("Genoteerd voor {name}", { name: m.name })); if (r?.warning.length) toast(tr("⚠️ Let op, {name} vermijdt: {w}", { name: m.name, w: r.warning.join(", ") })); setLog(false); }}><Avatar m={m} size={22} dot={false} /> {m.name}</button>)}
          </div>
        </Modal>
      )}
    </>
  );
}
