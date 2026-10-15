import { api } from "../api";
import { useAction, useData, useRemote } from "../store";
import { cvar } from "./ui";
import { weekday } from "../dates";

/** "Taken vandaag": per gezinslid de icoontjes om af te vinken. */
export function ChoreTracker({ date }: { date: string }) {
  const { data } = useData();
  const act = useAction();
  const [done, reload] = useRemote<string[]>(`/chores/done?from=${date}&to=${date}`, ["chores"], []);
  if (!data) return null;
  const set = new Set(done);
  const wd = weekday(date);
  const rows = data.members.map((m) => ({ m, chores: data.chores.filter((c) => c.memberId === m.id && c.days.includes(wd)) })).filter((r) => r.chores.length);
  if (!rows.length) return <p className="empty">Geen taken vandaag.</p>;
  const toggle = async (id: string) => {
    const now = !set.has(`${date}|${id}`);
    await act(() => api.put(`/chores/${id}/done`, { date, done: now }), now ? "Goed gedaan! ⭐" : undefined);
    reload();
  };
  return (
    <div>
      {rows.map(({ m, chores }) => {
        const n = chores.filter((c) => set.has(`${date}|${c.id}`)).length;
        return (
          <div className="trow" key={m.id} style={cvar(m.color)}>
            <div className="who">{m.name}<small>{n}/{chores.length}</small></div>
            <div className="ticons">
              {chores.map((c) => (
                <button key={c.id} className="tico" title={c.title} aria-label={`${c.title} (${m.name})`} aria-pressed={set.has(`${date}|${c.id}`)} onClick={() => toggle(c.id)}>{c.icon}</button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
