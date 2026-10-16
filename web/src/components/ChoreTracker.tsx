import { api } from "../api";
import { useAction, useData, useRemote } from "../store";
import { Avatar, cvar } from "./ui";
import { weekday } from "../dates";

/** "Taken vandaag": per gezinslid de icoontjes om af te vinken. */
const MOMENT_LABEL: Record<string, string> = { ochtend: "🌅 Ochtendroutine", middag: "☀️ Middag", avond: "🌙 Avondroutine", altijd: "✅ Taken" };
const currentMoment = () => { const h = new Date().getHours(); return h < 12 ? "ochtend" : h < 17 ? "middag" : "avond"; };

/** "Taken vandaag": per gezinslid de icoontjes om af te vinken, gegroepeerd per dagdeel (het huidige eerst). */
export function ChoreTracker({ date, grouped = true, compact = false }: { date: string; grouped?: boolean; compact?: boolean }) {
  const { data } = useData();
  const act = useAction();
  const [done, reload] = useRemote<string[]>(`/chores/done?from=${date}&to=${date}`, ["chores"], []);
  if (!data) return null;
  const set = new Set(done);
  const wd = weekday(date);
  const todays = data.chores.filter((c) => c.days.includes(wd));
  if (!todays.length) return <p className="empty">Geen taken vandaag.</p>;
  const toggle = async (c: { id: string; points: number; streak: number }) => {
    const now = !set.has(`${date}|${c.id}`);
    await act(() => api.put(`/chores/${c.id}/done`, { date, done: now }), now ? (c.streak >= 2 ? `🔥 ${c.streak + 1} dagen op rij!` : "Goed gedaan! ⭐") : undefined);
    reload();
  };
  const cur = currentMoment();
  const order = grouped ? [cur, ...(["ochtend", "middag", "avond", "altijd"] as const).filter((m) => m !== cur)] : ["alles"];
  const rows = (moment: string) => data.members
    .map((m) => ({ m, chores: todays.filter((c) => c.memberId === m.id && (moment === "alles" || c.moment === moment)) }))
    .filter((r) => r.chores.length);
  return (
    <div className={`routines${compact ? " compact" : ""}`}>
      {order.map((moment) => {
        const rs = rows(moment);
        if (!rs.length) return null;
        const all = rs.flatMap((r) => r.chores);
        const n = all.filter((c) => set.has(`${date}|${c.id}`)).length;
        return (
          <section key={moment} className={`routine${moment === cur ? " now" : ""}`}>
            {grouped && <div className="routine-h"><b>{MOMENT_LABEL[moment]}</b><span className="muted num">{n}/{all.length}</span></div>}
            {rs.map(({ m, chores }) => {
              const dn = chores.filter((c) => set.has(`${date}|${c.id}`)).length;
              return (
                <div className="trow" key={m.id} style={cvar(m.color)}>
                  <div className="who">{compact ? <Avatar m={m} size={30} dot={false} /> : m.name}<small>{dn}/{chores.length}</small></div>
                  <div className="ticons">
                    {chores.map((c) => (
                      <button key={c.id} className="tico" title={`${c.title}${c.streak >= 2 ? ` · ${c.streak} dagen op rij` : ""}`} aria-label={`${c.title} (${m.name})`} aria-pressed={set.has(`${date}|${c.id}`)} onClick={() => toggle(c)}>
                        {c.icon}{c.streak >= 3 && <i className="streak">🔥{c.streak}</i>}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
