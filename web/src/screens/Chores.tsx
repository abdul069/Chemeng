import { useEffect, useState } from "react";
import { api } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { Chore, Member } from "../types";
import { Avatar, Confirm, EmojiPicker, Fold, Modal, cvar, useIsPhone } from "../components/ui";
import { Icon } from "../components/Icons";
import { DSHORT, addDays, relDay, todayIso, weekday } from "../dates";
import { Celebration, ProfileModal, StarsRanking } from "../components/Profile";
import { t } from "../i18n";

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 0];
type Moment = "ochtend" | "middag" | "avond" | "alles";
const MOMENTS: [Moment, string, string][] = [["ochtend", "🌅", "Ochtend"], ["middag", "☀️", "Middag"], ["avond", "🌙", "Avond"], ["alles", "📋", "Alles"]];
/** Het moment van de dag waar we nu in zitten: zo staat de juiste tab meteen open. */
const nowMoment = (): Moment => { const h = new Date().getHours(); return h < 12 ? "ochtend" : h < 17 ? "middag" : "avond"; };

export function ChoresScreen({ header }: { header: React.ReactNode }) {
  const { data } = useData();
  const act = useAction();
  const [date, setDate] = useState(todayIso());
  const [done, reload] = useRemote<string[]>(`/chores/done?from=${date}&to=${date}`, ["chores"], []);
  const [edit, setEdit] = useState<{ chore?: Chore; memberId: string } | null>(null);
  const [rewardsOpen, setRewardsOpen] = useState(false);
  const [routineFor, setRoutineFor] = useState<Member | null>(null);
  const [profile, setProfile] = useState<Member | null>(null);
  const [celebrate, setCelebrate] = useState<string | null>(null);
  const phone = useIsPhone();
  const [who, setWho] = useState<string | null>(null);
  const [mom, setMom] = useState<Moment>(nowMoment);
  if (!data) return null;
  const set = new Set(done);
  const wd = weekday(date);

  const toggle = async (c: Chore) => {
    const now = !set.has(`${date}|${c.id}`);
    await act(() => api.put(`/chores/${c.id}/done`, { date, done: now }), now ? `+${c.points} ⭐` : undefined);
    reload();
    // laatste taak van de dag afgevinkt → vieren
    const todays = data.chores.filter((x) => x.memberId === c.memberId && x.days.includes(wd));
    if (now && date === todayIso()) { const fresh = new Set(await api.get<string[]>(`/chores/done?from=${date}&to=${date}`).catch(() => [])); if (todays.every((x) => fresh.has(`${date}|${x.id}`))) setCelebrate(data.members.find((m) => m.id === c.memberId)?.name ?? ""); }
  };

  return (
    <>
      <div className="topbar">
        {header}
        <div className="right">
          <button className="iconbtn" onClick={() => setDate(addDays(date, -1))} aria-label={t("Vorige dag")}><Icon.left /></button>
          <span className="range">{relDay(date)}</span>
          <button className="iconbtn" onClick={() => setDate(addDays(date, 1))} aria-label={t("Volgende dag")}><Icon.right /></button>
          <button className="pill" onClick={() => setRewardsOpen(true)}>{t("🎁 Beloningen")}</button>
        </div>
      </div>
      <div className="page-scroll" style={{ flex: 1, minHeight: 0 }}>
        <div className="chores-layout">
        {phone && data.members.length > 1 && (
          <div className="picks who-picks">{data.members.map((m) => <button type="button" key={m.id} className="pick pick-person" style={cvar(m.color)} aria-pressed={m.id === (who ?? data.members[0]?.id)} onClick={() => setWho(m.id)}><Avatar m={m} size={22} dot={false} /> {m.name}</button>)}</div>
        )}
        <div className="grid-cards">
          {(phone ? data.members.filter((m) => m.id === (who ?? data.members[0]?.id)) : data.members).map((m) => {
            const all = data.chores.filter((c) => c.memberId === m.id);
            const today = all.filter((c) => c.days.includes(wd));
            const shown = mom === "alles" ? today : today.filter((c) => c.moment === mom || c.moment === "altijd");
            const n = today.filter((c) => set.has(`${date}|${c.id}`)).length;
            const earned = today.filter((c) => set.has(`${date}|${c.id}`)).reduce((a, c) => a + c.points, 0);
            const count = (k: Moment) => today.filter((c) => (k === "alles" ? true : c.moment === k || c.moment === "altijd") && !set.has(`${date}|${c.id}`)).length;
            return (
              <section className="member-card routine-card" key={m.id} style={cvar(m.color)}>
                <header>
                  <button className="who" onClick={() => setProfile(m)} title={`Profiel van ${m.name}`}>
                    <Avatar m={m} size={44} dot={false} />
                    <h2>{m.name}</h2>
                  </button>
                  <span className="stars" title={t("Sterren om in te ruilen")}>⭐ {data.points[m.id]?.balance ?? 0}{data.points[m.id]?.today ? <small className="muted"> +{data.points[m.id].today}</small> : null}</span>
                </header>
                <div className="progress" role="progressbar" aria-valuenow={n} aria-valuemax={today.length} aria-label={`${n} van ${today.length} taken gedaan`}>
                  <i style={{ width: `${today.length ? (n / today.length) * 100 : 0}%` }} />
                </div>
                <nav className="moments" aria-label={t("Moment van de dag")}>
                  {MOMENTS.map(([k, ic, label]) => (
                    <button type="button" key={k} className={`moment${mom === k ? " on" : ""}`} aria-pressed={mom === k} onClick={() => setMom(k)}>
                      <span className="moment-ic">{ic}</span><small>{t(label)}</small>{count(k) > 0 && <i className="moment-n">{count(k)}</i>}
                    </button>
                  ))}
                </nav>
                <div className="rtasks">
                  {shown.map((c) => {
                    const d = set.has(`${date}|${c.id}`);
                    return (
                      <div className={`rtask${d ? " done" : ""}`} key={c.id}>
                        <span className="rtask-ic" aria-hidden>{c.icon}</span>
                        <button className="rtask-main" aria-label={`${c.title} bewerken`} onClick={() => setEdit({ chore: c, memberId: m.id })}>
                          <b>{c.title}</b>
                          <small>{c.points}⭐{c.streak >= 2 && <span title={t("dagen op rij")}> · 🔥{c.streak}</span>}{mom === "alles" && c.moment !== "altijd" && <span> · {t(c.moment)}</span>}</small>
                        </button>
                        <button className={`rcheck${d ? " on" : ""}`} aria-pressed={d} aria-label={`${c.title} ${d ? t("terug open zetten") : "afvinken"}`} onClick={() => toggle(c)}>{d && "✓"}</button>
                      </div>
                    );
                  })}
                  {!shown.length && today.length > 0 && <p className="empty">{t("Niets voor dit moment — alles al gedaan? 🎈")}</p>}
                  {!today.length && <p className="empty">{t("Niets te doen vandaag — geniet ervan! 🎈")}</p>}
                </div>
                <footer className="rfoot">
                  <span>⭐ {t("{n} sterren vandaag verdiend", { n: earned })}</span>
                  <span className="muted">{n}/{today.length}</span>
                  <button className="btn ghost small" onClick={() => setRoutineFor(m)} title={t("Kant-en-klare dagelijkse routine kiezen")}>📋 {t("Routine")}</button>
                  <button className="btn ghost small" onClick={() => setEdit({ memberId: m.id })}><Icon.plus />{" "}{t("Taak")}</button>
                </footer>
                {all.length > today.length && <p className="hint">{t("{n} andere taak/taken op andere dagen.", { n: all.length - today.length })}</p>}
              </section>
            );
          })}
        </div>
        {phone ? <Fold title={t("Wie schittert deze week?")} gap={8}><StarsRanking bare /></Fold> : <StarsRanking />}
        </div>
      </div>
      {profile && <ProfileModal member={profile} onClose={() => setProfile(null)} />}
      {celebrate !== null && <Celebration name={celebrate} onDone={() => setCelebrate(null)} />}
      {edit && <ChoreEditor chore={edit.chore} memberId={edit.memberId} onClose={() => setEdit(null)} />}
      {rewardsOpen && <Rewards onClose={() => setRewardsOpen(false)} />}
      {routineFor && <RoutinePicker member={routineFor} onClose={() => setRoutineFor(null)} />}
    </>
  );
}

function ChoreEditor({ chore, memberId, onClose }: { chore?: Chore; memberId: string; onClose: () => void }) {
  const { data } = useData();
  const act = useAction();
  const [f, setF] = useState({ title: chore?.title ?? "", icon: chore?.icon ?? "✅", days: chore?.days ?? [0, 1, 2, 3, 4, 5, 6], points: chore?.points ?? 1, memberId: chore?.memberId ?? memberId, moment: chore?.moment ?? "altijd" });
  const [confirm, setConfirm] = useState(false);
  const save = async () => {
    if (!f.title.trim() || !f.days.length) return;
    const ok = await act(() => (chore ? api.put(`/chores/${chore.id}`, f) : api.post("/chores", f)), t("Taak bewaard"));
    if (ok) onClose();
  };
  return (
    <Modal title={chore ? t("Taak bewerken") : t("Nieuwe taak")} onClose={onClose}>
      <label className="field"><span>{t("Taak")}</span><input id="ch-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={t("bv. Tafel afruimen")} /></label>
      <div className="field"><span>{t("Icoon")}</span><EmojiPicker value={f.icon} onChange={(icon) => setF({ ...f, icon })} /></div>
      <div className="field"><span>{t("Voor wie")}</span>
        <div className="picks">{data?.members.map((m: Member) => <button type="button" key={m.id} className="pick pick-person" style={cvar(m.color)} aria-pressed={f.memberId === m.id} onClick={() => setF({ ...f, memberId: m.id })}><Avatar m={m} size={22} dot={false} /> {m.name}</button>)}</div>
      </div>
      <div className="field"><span>{t("Op welke dagen")}</span>
        <div className="picks">{ALL_DAYS.map((d) => (
          <button type="button" key={d} className="pick" aria-pressed={f.days.includes(d)} onClick={() => setF({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d] })}>{DSHORT[d]}</button>
        ))}</div>
      </div>
      <div className="field"><span>{t("Wanneer")}</span>
        <div className="picks">{([["ochtend", "🌅 Ochtendroutine"], ["middag", "☀️ Middag"], ["avond", "🌙 Avondroutine"], ["altijd", "Gelijk wanneer"]] as const).map(([v, l]) => (
          <button type="button" key={v} className="pick" aria-pressed={f.moment === v} onClick={() => setF({ ...f, moment: v })}>{l}</button>
        ))}</div>
      </div>
      <label className="field"><span>{t("Sterren per keer")}</span><input id="ch-points" type="number" min={0} max={20} value={f.points} onChange={(e) => setF({ ...f, points: Math.max(0, Number(e.target.value) || 0) })} /></label>
      <div className="actions">
        {chore && <button className="btn danger left" onClick={() => setConfirm(true)}>{t("Verwijderen")}</button>}
        <button className="btn ghost" onClick={onClose}>{t("Annuleren")}</button>
        <button className="btn" onClick={save} disabled={!f.title.trim() || !f.days.length}>{t("Bewaren")}</button>
      </div>
      {confirm && chore && <Confirm title={t("Taak verwijderen?")} text={t("De verdiende sterren blijven niet bewaard voor deze taak.")} onClose={() => setConfirm(false)}
        actions={[{ label: t("Verwijderen"), run: async () => { if (await act(() => api.del(`/chores/${chore.id}`), t("Taak verwijderd"))) onClose(); } }]} />}
    </Modal>
  );
}

function Rewards({ onClose }: { onClose: () => void }) {
  const { data } = useData();
  const act = useAction();
  const [who, setWho] = useState(data?.members.find((m) => m.role === "kind")?.id ?? data?.members[0]?.id ?? "");
  const [nw, setNw] = useState({ title: "", icon: "🎁", cost: 10 });
  if (!data) return null;
  const balance = data.points[who]?.balance ?? 0;
  return (
    <Modal title={t("Beloningen")} onClose={onClose} wide>
      <p className="hint">{t("Elke afgevinkte taak levert sterren op. Kies wie een beloning inruilt.")}</p>
      <div className="picks">{data.members.map((m) => (
        <button key={m.id} className="pick pick-person" style={cvar(m.color)} aria-pressed={who === m.id} onClick={() => setWho(m.id)}><Avatar m={m} size={22} dot={false} /> {m.name} · ⭐ {data.points[m.id]?.balance ?? 0}</button>
      ))}</div>
      <div className="rewards">
        {data.rewards.map((r) => (
          <div className="reward" key={r.id}>
            <span className="ic">{r.icon}</span>
            <span><b>{r.title}</b><small className="muted" style={{ display: "block" }}>{r.cost} sterren</small></span>
            <button className="btn small accent" disabled={balance < r.cost} onClick={() => act(() => api.post(`/rewards/${r.id}/claim`, { memberId: who }), t("Beloning ingeruild 🎉"))}>{t("Inruilen")}</button>
            <button className="iconbtn" style={{ width: 34, height: 34 }} aria-label={`${r.title} verwijderen`} onClick={() => act(() => api.del(`/rewards/${r.id}`))}><Icon.trash /></button>
          </div>
        ))}
        {!data.rewards.length && <p className="empty">{t("Nog geen beloningen. Voeg er hieronder een toe.")}</p>}
      </div>
      <div className="field"><span>{t("Nieuwe beloning")}</span>
        <div className="addrow">
          <input id="rw-icon" value={nw.icon} onChange={(e) => setNw({ ...nw, icon: e.target.value })} style={{ width: 64, flex: "none" }} aria-label={t("Icoon")} />
          <input id="rw-title" value={nw.title} onChange={(e) => setNw({ ...nw, title: e.target.value })} placeholder={t("bv. Film kiezen")} aria-label={t("Beloning")} />
          <input id="rw-cost" type="number" min={1} value={nw.cost} onChange={(e) => setNw({ ...nw, cost: Number(e.target.value) || 1 })} style={{ width: 90, flex: "none" }} aria-label={t("Sterren")} />
          <button className="btn" disabled={!nw.title.trim()} onClick={async () => { if (await act(() => api.post("/rewards", nw), t("Beloning toegevoegd"))) setNw({ title: "", icon: "🎁", cost: 10 }); }}>+</button>
        </div>
      </div>
    </Modal>
  );
}

interface RoutineCatalog { items: { key: string; icon: string; title: string; moment: string; days: number[]; points: number; group: string }[]; groups: { id: string; label: string }[]; ageSets: Record<string, string[]> }
const AGE_LABEL: Record<string, string> = { kleuter: "🧒 Kleuter (3-6)", lagere: "🎒 Lagere school (6-12)", tiener: "🎧 Tiener (12+)" };
/** Kant-en-klare routine per kind: leeftijdsvoorstel kiezen, taken aan- of afvinken, één tik en ze staan in de dagplanning. */
function RoutinePicker({ member, onClose }: { member: Member; onClose: () => void }) {
  const { data } = useData();
  const act = useAction();
  const [cat, setCat] = useState<RoutineCatalog | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [age, setAge] = useState<string>("");
  useEffect(() => { api.get<RoutineCatalog>("/chores/routines").then((c) => { setCat(c); const guess = ageFor(member.birthday); setAge(guess); setSel(new Set(c.ageSets[guess] ?? [])); }).catch(() => {}); }, [member]);
  const have = new Set((data?.chores ?? []).filter((c) => c.memberId === member.id).map((c) => `${c.title.toLowerCase()}|${c.moment}`));
  const toggle = (k: string) => { const n = new Set(sel); if (n.has(k)) n.delete(k); else n.add(k); setSel(n); };
  const save = async () => {
    const r = await act(() => api.post<{ added: string[]; skipped: string[] }>("/chores/routines", { memberId: member.id, keys: [...sel] }));
    if (r) { onClose(); }
  };
  const dayLabel = (d: number[]) => d.length === 7 ? t("elke dag") : d.length === 5 && !d.includes(0) && !d.includes(6) ? t("schooldagen") : d.map((x) => DSHORT[x]).join(" ");
  return (
    <Modal title={`📋 ${t("Routine voor {n}", { n: member.name })}`} onClose={onClose}>
      {!cat ? <p className="hint">…</p> : (
        <>
          <div className="picks">{Object.keys(cat.ageSets).map((k) => <button type="button" key={k} className="pick" aria-pressed={age === k} onClick={() => { setAge(k); setSel(new Set(cat.ageSets[k])); }}>{t(AGE_LABEL[k] ?? k)}</button>)}</div>
          <p className="hint">{t("Een voorstel per leeftijd; vink aan wat bij jullie past. Tanden poetsen, bed maken, kamer opruimen en huiswerk komen als dagelijkse taken met sterren in de ochtend-, middag- of avondroutine.")}</p>
          {cat.groups.map((g) => (
            <div className="field" key={g.id}><span>{g.label}</span>
              <div className="rtn-list">
                {cat.items.filter((i) => i.group === g.id).map((i) => { const exists = have.has(`${i.title.toLowerCase()}|${i.moment}`); return (
                  <label key={i.key} className={`rtn-item${exists ? " has" : ""}`}>
                    <input type="checkbox" checked={exists || sel.has(i.key)} disabled={exists} onChange={() => toggle(i.key)} />
                    <span className="rtn-ic" aria-hidden>{i.icon}</span>
                    <span className="rtn-txt"><b>{i.title}</b><small className="muted">{exists ? t("staat er al") : `${t(i.moment)} · ${dayLabel(i.days)} · ${i.points}⭐`}</small></span>
                  </label>
                ); })}
              </div>
            </div>
          ))}
          <div className="actions">
            <button className="btn ghost" onClick={onClose}>{t("Annuleren")}</button>
            <button className="btn" disabled={![...sel].some((k) => { const i = cat.items.find((x) => x.key === k); return i && !have.has(`${i.title.toLowerCase()}|${i.moment}`); })} onClick={save}>{t("Toevoegen")}</button>
          </div>
        </>
      )}
    </Modal>
  );
}
function ageFor(birthday: string | null | undefined): string {
  if (!birthday) return "lagere";
  const y = (Date.now() - Date.parse(birthday)) / (365.25 * 864e5);
  return y < 6 ? "kleuter" : y < 12 ? "lagere" : "tiener";
}
