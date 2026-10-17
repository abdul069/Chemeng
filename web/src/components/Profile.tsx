import { useEffect, useState } from "react";
import { api } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { Member } from "../types";
import { Avatar, Modal, cvar } from "./ui";
import { todayIso, weekday } from "../dates";
import { t as tr } from "../i18n";

/** Viering als alle taken van vandaag af zijn ("Ta-da!"). */
export function Celebration({ name, onDone }: { name: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3200); return () => clearTimeout(t); }, [onDone]);
  return (
    <div className="celebrate" onPointerDown={onDone} role="status">
      {Array.from({ length: 60 }, (_, i) => {
        const r = (k: number) => ((i * 9301 + k * 49297) % 233280) / 233280; // vaste "willekeur" per snipper
        return <i key={i} className={`confetti s${i % 3}`} style={{ left: `${r(1) * 100}%`, animationDelay: `${r(2) * 1.2}s`, animationDuration: `${2.6 + r(3) * 1.6}s`, width: 6 + r(4) * 8, height: 10 + r(5) * 10, background: ["#f6c343", "#e45b5b", "#4f9e5b", "#4a7ad8", "#b26ad8", "#f28c38", "#2bb3a3"][i % 7], ["--sway" as string]: `${(r(6) - 0.5) * 160}px` }} />;
      })}
      <div className="celebrate-card">
        <span className="celebrate-badge">🏅</span>
        <b>{tr("Goed gedaan, {n}!", { n: name })}</b>
        <p>{tr("Alles van vandaag is af. Lekker bezig — geniet van je vrije tijd.")}</p>
      </div>
    </div>
  );
}

/** Persoonlijke pagina van een gezinslid: sterren, beloningen, taken van vandaag en eigen to-do's. */
export function ProfileModal({ member, onClose }: { member: Member; onClose: () => void }) {
  const { data, toast } = useData();
  const act = useAction();
  const t = todayIso();
  const [done, reload] = useRemote<string[]>(`/chores/done?from=${t}&to=${t}`, ["chores"], []);
  const [celebrate, setCelebrate] = useState(false);
  const [todo, setTodo] = useState("");
  if (!data) return null;
  const set = new Set(done);
  const chores = data.chores.filter((c) => c.memberId === member.id && c.days.includes(weekday(t)));
  const n = chores.filter((c) => set.has(`${t}|${c.id}`)).length;
  const pts = data.points[member.id] ?? { balance: 0, today: 0, week: 0, earned: 0, spent: 0 };
  const todoList = data.lists.find((l) => l.kind === "list" && /to-?do/i.test(l.name));
  const mine = todoList?.items.filter((i) => i.memberId === member.id) ?? [];
  const toggle = async (c: { id: string; points: number }) => {
    const now = !set.has(`${t}|${c.id}`);
    await act(() => api.put(`/chores/${c.id}/done`, { date: t, done: now }), now ? `+${c.points} ⭐` : undefined);
    reload();
    // vers van de server kijken of alles van vandaag af is
    if (now) { const fresh = new Set(await api.get<string[]>(`/chores/done?from=${t}&to=${t}`).catch(() => [])); if (chores.length && chores.every((x) => fresh.has(`${t}|${x.id}`))) setCelebrate(true); }
  };
  const addTodo = async () => {
    if (!todoList || !todo.trim()) return;
    if (await act(() => api.post(`/lists/${todoList.id}/items`, { text: todo.trim(), memberId: member.id }))) setTodo("");
  };
  return (
    <Modal title={`${member.name}`} onClose={onClose} wide>
      <div className="profile-head" style={cvar(member.color)}>
        <Avatar m={member} size={64} dot={false} />
        <div>
          <div className="num" style={{ fontSize: 28, fontWeight: 800 }}>⭐ {pts.balance}</div>
          <small className="muted">{pts.today ? `+${pts.today} vandaag · ` : ""}{pts.week} deze week · {pts.earned} ooit verdiend</small>
        </div>
      </div>
      <div className="profile-cols">
        <section>
          <div className="section-title"><h3>{tr("Vandaag te doen")}</h3><span className="muted num">{n}/{chores.length}</span></div>
          <div className="progress" style={{ marginBottom: 8 }}><i style={{ width: `${chores.length ? (n / chores.length) * 100 : 0}%` }} /></div>
          {!chores.length && <p className="empty">{tr("Niets te doen vandaag — geniet ervan! 🎈")}</p>}
          {chores.map((c) => {
            const d = set.has(`${t}|${c.id}`);
            return (
              <button key={c.id} className={`prof-chore${d ? tr(" done") : ""}`} onClick={() => toggle(c)} aria-pressed={d}>
                <span>{c.icon} {c.title}</span><small>⭐ {c.points}</small><i>{d ? "✓" : ""}</i>
              </button>
            );
          })}
          {chores.length > 0 && n === chores.length && <p className="hint">{tr("🏅 Alles van vandaag is af.")}</p>}
        </section>
        <section>
          <div className="section-title"><h3>{tr("Spaarpot")}</h3><span className="hint">⭐ {pts.balance} om in te ruilen</span></div>
          <div className="prof-rewards">
            {data.rewards.map((r) => (
              <div className="reward-card" key={r.id}>
                <span className="ic">{r.icon}</span>
                <b>{r.title}</b>
                <small>⭐ {r.cost}</small>
                <button className={`btn small${pts.balance >= r.cost ? tr(" accent") : ""}`} disabled={pts.balance < r.cost} onClick={() => act(() => api.post(`/rewards/${r.id}/claim`, { memberId: member.id }), tr("Beloning ingeruild 🎉"))}>{tr("Inruilen")}</button>
              </div>
            ))}
            {!data.rewards.length && <p className="empty">{tr("Nog niets om voor te sparen. Een ouder voegt beloningen toe bij Taken → Beloningen.")}</p>}
          </div>
        </section>
      </div>
      {todoList && (
        <section>
          <div className="section-title"><h3>{tr("Mijn briefjes")}</h3><span className="hint">{tr("eigen geheugensteuntjes")}</span></div>
          <form className="addrow" onSubmit={(e) => { e.preventDefault(); addTodo(); }}>
            <input value={todo} onChange={(e) => setTodo(e.target.value)} placeholder={tr("Iets voor {n}…", { n: member.name })} aria-label={tr("Nieuwe to-do")} />
            <button className="btn" type="submit" disabled={!todo.trim()}>{tr("Toevoegen")}</button>
          </form>
          <div className="items">
            {mine.map((i) => (
              <div className={`item${i.done ? tr(" done") : ""}`} key={i.id}>
                <button className="check" aria-pressed={i.done} onClick={() => act(() => api.patch(`/items/${i.id}`, { done: !i.done }))}>{i.done ? "✓" : ""}</button>
                <span className="txt">{i.text}</span>
                <button className="iconbtn" style={{ width: 36, height: 36 }} aria-label={tr("Verwijderen")} onClick={() => act(() => api.del(`/items/${i.id}`))}>🗑</button>
              </div>
            ))}
            {!mine.length && <p className="hint">Nog geen briefjes. Zet hier wat {member.name} zelf wil onthouden.</p>}
          </div>
        </section>
      )}
      {celebrate && <Celebration name={member.name} onDone={() => { setCelebrate(false); toast(tr("Alles af voor vandaag 🏅")); }} />}
    </Modal>
  );
}

/** Sterrenklassement van de week. */
export function StarsRanking() {
  const { data } = useData();
  if (!data) return null;
  const rows = data.members.filter((m) => m.role !== "huisdier").map((m) => ({ m, week: data.points[m.id]?.week ?? 0, balance: data.points[m.id]?.balance ?? 0 })).sort((a, b) => b.week - a.week || b.balance - a.balance);
  const medals = ["🥇", "🥈", "🥉"];
  const max = Math.max(1, ...rows.map((r) => r.week));
  return (
    <aside className="ranking card card-pad">
      <div className="section-title"><h3>{tr("Wie schittert deze week?")}</h3></div>
      {rows.map((r, i) => (
        <div className="rank-row" key={r.m.id} style={cvar(r.m.color)}>
          <span className="medal">{medals[i] ?? `${i + 1}.`}</span>
          <Avatar m={r.m} size={34} dot={false} />
          <span className="rank-body"><b>{r.m.name}</b><i className="rank-bar"><em style={{ width: `${(r.week / max) * 100}%` }} /></i></span>
          <span className="num">⭐ {r.week}</span>
        </div>
      ))}
      {!rows.length && <p className="hint">{tr("Nog geen gezinsleden.")}</p>}
    </aside>
  );
}
