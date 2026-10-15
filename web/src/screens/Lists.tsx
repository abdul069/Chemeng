import { useState } from "react";
import { api } from "../api";
import { useAction, useData } from "../store";
import { Confirm, Modal } from "../components/ui";
import { Icon } from "../components/Icons";

export function ListsScreen({ header }: { header: React.ReactNode }) {
  const { data } = useData();
  const act = useAction();
  const [sel, setSel] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [newList, setNewList] = useState(false);
  const [confirm, setConfirm] = useState(false);
  if (!data) return null;
  const list = data.lists.find((l) => l.id === sel) ?? data.lists[0];

  const add = async () => {
    const parts = text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (!list || !parts.length) return;
    setText("");
    for (const p of parts) await act(() => api.post(`/lists/${list.id}/items`, { text: p }));
  };

  return (
    <>
      <div className="topbar">
        {header}
        <div className="right"><button className="pill" onClick={() => setNewList(true)}>+ Nieuwe lijst</button></div>
      </div>
      <div className="lists">
        <nav className="list-nav" aria-label="Lijsten">
          {data.lists.map((l) => (
            <button key={l.id} aria-current={l.id === list?.id} onClick={() => setSel(l.id)}>
              <span>{l.icon}</span>{l.name}<span className="n">{l.items.filter((i) => !i.done).length}</span>
            </button>
          ))}
        </nav>
        {list ? (
          <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0, overflow: "auto" }}>
            <div className="section-title">
              <h2>{list.icon} {list.name}</h2>
              <div style={{ display: "flex", gap: 6 }}>
                {list.items.some((i) => i.done) && <button className="linkbtn" onClick={() => act(() => api.post(`/lists/${list.id}/clear-done`), "Afgevinkte items gewist")}>Afgevinkte wissen</button>}
                <button className="iconbtn" aria-label="Lijst verwijderen" onClick={() => setConfirm(true)}><Icon.trash /></button>
              </div>
            </div>
            <form className="addrow" onSubmit={(e) => { e.preventDefault(); add(); }}>
              <input id="item-new" value={text} onChange={(e) => setText(e.target.value)} placeholder="Toevoegen… (meerdere met komma's)" aria-label="Nieuw item" />
              <button className="btn" type="submit" disabled={!text.trim()}>Toevoegen</button>
            </form>
            <div className="items">
              {list.items.map((i) => (
                <div className={`item${i.done ? " done" : ""}`} key={i.id}>
                  <button className="check" aria-pressed={i.done} aria-label={`${i.text} ${i.done ? "terug open zetten" : "afvinken"}`} onClick={() => act(() => api.patch(`/items/${i.id}`, { done: !i.done }))}>{i.done ? "✓" : ""}</button>
                  <span className="txt">{i.text}</span>
                  <button className="iconbtn" style={{ width: 36, height: 36 }} aria-label={`${i.text} verwijderen`} onClick={() => act(() => api.del(`/items/${i.id}`))}><Icon.trash /></button>
                </div>
              ))}
              {!list.items.length && <p className="empty">De lijst is leeg. Typ hierboven of vraag het aan de assistent.</p>}
            </div>
          </section>
        ) : <p className="empty">Nog geen lijsten.</p>}
      </div>
      {newList && <NewList onClose={() => setNewList(false)} onCreated={setSel} />}
      {confirm && list && <Confirm title={`${list.name} verwijderen?`} text="Alle items op deze lijst verdwijnen." onClose={() => setConfirm(false)}
        actions={[{ label: "Verwijderen", run: () => { act(() => api.del(`/lists/${list.id}`), "Lijst verwijderd"); setSel(null); } }]} />}
    </>
  );
}

function NewList({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const act = useAction();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("📝");
  const save = async () => {
    const r = await act(() => api.post<{ id: string }>("/lists", { name, icon }), "Lijst gemaakt");
    if (r) { onCreated(r.id); onClose(); }
  };
  return (
    <Modal title="Nieuwe lijst" onClose={onClose}>
      <div className="addrow">
        <input id="nl-icon" value={icon} onChange={(e) => setIcon(e.target.value)} style={{ width: 64, flex: "none" }} aria-label="Icoon" />
        <input id="nl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="bv. Inpaklijst vakantie" aria-label="Naam" onKeyDown={(e) => e.key === "Enter" && name.trim() && save()} />
      </div>
      <div className="actions"><button className="btn ghost" onClick={onClose}>Annuleren</button><button className="btn" disabled={!name.trim()} onClick={save}>Maken</button></div>
    </Modal>
  );
}
