import { useState } from "react";
import { api } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { Chore, Member } from "../types";
import { Avatar, Confirm, EmojiPicker, Modal, cvar } from "../components/ui";
import { Icon } from "../components/Icons";
import { DSHORT, addDays, relDay, todayIso, weekday } from "../dates";
import { Celebration, ProfileModal, StarsRanking } from "../components/Profile";

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 0];

export function ChoresScreen({ header }: { header: React.ReactNode }) {
  const { data } = useData();
  const act = useAction();
  const [date, setDate] = useState(todayIso());
  const [done, reload] = useRemote<string[]>(`/chores/done?from=${date}&to=${date}`, ["chores"], []);
  const [edit, setEdit] = useState<{ chore?: Chore; memberId: string } | null>(null);
  const [rewardsOpen, setRewardsOpen] = useState(false);
  const [profile, setProfile] = useState<Member | null>(null);
  const [celebrate, setCelebrate] = useState<string | null>(null);
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
          <button className="iconbtn" onClick={() => setDate(addDays(date, -1))} aria-label="Vorige dag"><Icon.left /></button>
          <span className="range">{relDay(date)}</span>
          <button className="iconbtn" onClick={() => setDate(addDays(date, 1))} aria-label="Volgende dag"><Icon.right /></button>
          <button className="pill" onClick={() => setRewardsOpen(true)}>🎁 Beloningen</button>
        </div>
      </div>
      <div className="page-scroll" style={{ flex: 1, minHeight: 0 }}>
        <div className="chores-layout">
        <div className="grid-cards">
          {data.members.map((m) => {
            const all = data.chores.filter((c) => c.memberId === m.id);
            const today = all.filter((c) => c.days.includes(wd));
            const n = today.filter((c) => set.has(`${date}|${c.id}`)).length;
            return (
              <section className="member-card" key={m.id} style={cvar(m.color)}>
                <header>
                  <button className="who" onClick={() => setProfile(m)} title={`Profiel van ${m.name}`}>
                    <Avatar m={m} size={44} dot={false} />
                    <h2>{m.name}</h2>
                  </button>
                  <span className="stars" title="Sterren om in te ruilen">⭐ {data.points[m.id]?.balance ?? 0}{data.points[m.id]?.today ? <small className="muted"> +{data.points[m.id].today}</small> : null}</span>
                </header>
                <div className="progress" role="progressbar" aria-valuenow={n} aria-valuemax={today.length} aria-label={`${n} van ${today.length} taken gedaan`}>
                  <i style={{ width: `${today.length ? (n / today.length) * 100 : 0}%` }} />
                </div>
                {today.map((c) => {
                  const d = set.has(`${date}|${c.id}`);
                  return (
                    <div className={`task${d ? " done" : ""}`} key={c.id}>
                      <button className="tico" aria-pressed={d} aria-label={`${c.title} ${d ? "terug open zetten" : "afvinken"}`} onClick={() => toggle(c)}>{c.icon}</button>
                      <span className="title">{c.title}{c.moment !== "altijd" && <small className="muted"> · {c.moment}</small>}</span>
                      {c.streak >= 2 && <span className="pts" title="dagen op rij">🔥{c.streak}</span>}
                      <span className="pts">{c.points}⭐</span>
                      <button className="iconbtn" style={{ width: 34, height: 34 }} aria-label={`${c.title} bewerken`} onClick={() => setEdit({ chore: c, memberId: m.id })}>✎</button>
                    </div>
                  );
                })}
                {!today.length && <p className="empty">Vrije dag! Geen taken vandaag. 🎈</p>}
                {all.length > today.length && <p className="hint">{all.length - today.length} andere taak/taken op andere dagen.</p>}
                <button className="btn ghost small" onClick={() => setEdit({ memberId: m.id })}><Icon.plus /> Taak</button>
              </section>
            );
          })}
        </div>
        <StarsRanking />
        </div>
      </div>
      {profile && <ProfileModal member={profile} onClose={() => setProfile(null)} />}
      {celebrate !== null && <Celebration name={celebrate} onDone={() => setCelebrate(null)} />}
      {edit && <ChoreEditor chore={edit.chore} memberId={edit.memberId} onClose={() => setEdit(null)} />}
      {rewardsOpen && <Rewards onClose={() => setRewardsOpen(false)} />}
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
    const ok = await act(() => (chore ? api.put(`/chores/${chore.id}`, f) : api.post("/chores", f)), "Taak bewaard");
    if (ok) onClose();
  };
  return (
    <Modal title={chore ? "Taak bewerken" : "Nieuwe taak"} onClose={onClose}>
      <label className="field"><span>Taak</span><input id="ch-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="bv. Tafel afruimen" /></label>
      <div className="field"><span>Icoon</span><EmojiPicker value={f.icon} onChange={(icon) => setF({ ...f, icon })} /></div>
      <div className="field"><span>Voor wie</span>
        <div className="picks">{data?.members.map((m: Member) => <button type="button" key={m.id} className="pick" style={cvar(m.color)} aria-pressed={f.memberId === m.id} onClick={() => setF({ ...f, memberId: m.id })}>{m.avatar} {m.name}</button>)}</div>
      </div>
      <div className="field"><span>Op welke dagen</span>
        <div className="picks">{ALL_DAYS.map((d) => (
          <button type="button" key={d} className="pick" aria-pressed={f.days.includes(d)} onClick={() => setF({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d] })}>{DSHORT[d]}</button>
        ))}</div>
      </div>
      <div className="field"><span>Wanneer</span>
        <div className="picks">{([["ochtend", "🌅 Ochtendroutine"], ["middag", "☀️ Middag"], ["avond", "🌙 Avondroutine"], ["altijd", "Gelijk wanneer"]] as const).map(([v, l]) => (
          <button type="button" key={v} className="pick" aria-pressed={f.moment === v} onClick={() => setF({ ...f, moment: v })}>{l}</button>
        ))}</div>
      </div>
      <label className="field"><span>Sterren per keer</span><input id="ch-points" type="number" min={0} max={20} value={f.points} onChange={(e) => setF({ ...f, points: Math.max(0, Number(e.target.value) || 0) })} /></label>
      <div className="actions">
        {chore && <button className="btn danger left" onClick={() => setConfirm(true)}>Verwijderen</button>}
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button className="btn" onClick={save} disabled={!f.title.trim() || !f.days.length}>Bewaren</button>
      </div>
      {confirm && chore && <Confirm title="Taak verwijderen?" text="De verdiende sterren blijven niet bewaard voor deze taak." onClose={() => setConfirm(false)}
        actions={[{ label: "Verwijderen", run: async () => { if (await act(() => api.del(`/chores/${chore.id}`), "Taak verwijderd")) onClose(); } }]} />}
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
    <Modal title="Beloningen" onClose={onClose} wide>
      <p className="hint">Elke afgevinkte taak levert sterren op. Kies wie een beloning inruilt.</p>
      <div className="picks">{data.members.map((m) => (
        <button key={m.id} className="pick" style={cvar(m.color)} aria-pressed={who === m.id} onClick={() => setWho(m.id)}>{m.avatar} {m.name} · ⭐ {data.points[m.id]?.balance ?? 0}</button>
      ))}</div>
      <div className="rewards">
        {data.rewards.map((r) => (
          <div className="reward" key={r.id}>
            <span className="ic">{r.icon}</span>
            <span><b>{r.title}</b><small className="muted" style={{ display: "block" }}>{r.cost} sterren</small></span>
            <button className="btn small accent" disabled={balance < r.cost} onClick={() => act(() => api.post(`/rewards/${r.id}/claim`, { memberId: who }), "Beloning ingeruild 🎉")}>Inruilen</button>
            <button className="iconbtn" style={{ width: 34, height: 34 }} aria-label={`${r.title} verwijderen`} onClick={() => act(() => api.del(`/rewards/${r.id}`))}><Icon.trash /></button>
          </div>
        ))}
        {!data.rewards.length && <p className="empty">Nog geen beloningen. Voeg er hieronder een toe.</p>}
      </div>
      <div className="field"><span>Nieuwe beloning</span>
        <div className="addrow">
          <input id="rw-icon" value={nw.icon} onChange={(e) => setNw({ ...nw, icon: e.target.value })} style={{ width: 64, flex: "none" }} aria-label="Icoon" />
          <input id="rw-title" value={nw.title} onChange={(e) => setNw({ ...nw, title: e.target.value })} placeholder="bv. Film kiezen" aria-label="Beloning" />
          <input id="rw-cost" type="number" min={1} value={nw.cost} onChange={(e) => setNw({ ...nw, cost: Number(e.target.value) || 1 })} style={{ width: 90, flex: "none" }} aria-label="Sterren" />
          <button className="btn" disabled={!nw.title.trim()} onClick={async () => { if (await act(() => api.post("/rewards", nw), "Beloning toegevoegd")) setNw({ title: "", icon: "🎁", cost: 10 }); }}>+</button>
        </div>
      </div>
    </Modal>
  );
}
