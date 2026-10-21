/** Prikbord: briefjes voor het hele gezin, zoals post-its op de koelkast. Live op elk toestel. */
import { useState } from "react";
import { api } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { Note } from "../types";
import { Avatar, Modal, cvar } from "./ui";
import { getDevice } from "../device";
import { t } from "../i18n";

export const NOTE_COLORS: { id: string; bg: string; label: string }[] = [
  { id: "geel", bg: "#fff3a8", label: "Geel" }, { id: "roze", bg: "#ffd3e0", label: "Roze" }, { id: "blauw", bg: "#d6ecff", label: "Blauw" },
  { id: "groen", bg: "#d9f5dc", label: "Groen" }, { id: "paars", bg: "#e8dcff", label: "Paars" }, { id: "oranje", bg: "#ffe1c2", label: "Oranje" },
];
const bgOf = (c: string) => NOTE_COLORS.find((x) => x.id === c)?.bg ?? NOTE_COLORS[0].bg;

export function useNotes() { return useRemote<Note[]>("/notes", ["notes", "members"], []); }

function ago(iso: string) {
  const m = Math.round((Date.now() - Date.parse(iso + "Z")) / 60_000);
  if (m < 2) return t("zonet"); if (m < 60) return t("{n} min geleden", { n: m });
  const h = Math.round(m / 60); if (h < 24) return t("{n} u geleden", { n: h });
  const d = Math.round(h / 24); return d === 1 ? t("gisteren") : t("{n} dagen geleden", { n: d });
}

/** Eén briefje. */
export function NoteCard({ n, onEdit, small }: { n: Note; onEdit?: (n: Note) => void; small?: boolean }) {
  const { member } = useData();
  const act = useAction();
  const m = n.memberId ? member(n.memberId) : undefined;
  const rot = ((n.id.charCodeAt(0) + n.id.charCodeAt(1)) % 5) - 2;
  return (
    <article className={`note${small ? " small" : ""}${n.pinned ? " pinned" : ""}`} style={{ background: bgOf(n.color), "--rot": `${rot}deg` } as React.CSSProperties} onClick={() => onEdit?.(n)}>
      {n.pinned && <span className="note-pin" aria-label={t("Vastgeprikt")}>📌</span>}
      <p>{n.text}</p>
      <footer>
        {m ? <span className="note-by" style={cvar(m.color)}><Avatar m={m} size={20} dot={false} /> {m.name}</span> : <span />}
        <small>{ago(n.createdAt)}</small>
        {!small && onEdit && <button className="iconbtn note-del" aria-label={t("Briefje weg")} onClick={(e) => { e.stopPropagation(); act(() => api.del(`/notes/${n.id}`), t("Briefje weg")); }}>✕</button>}
      </footer>
    </article>
  );
}

export function NoteEditor({ note, onClose }: { note?: Note; onClose: () => void }) {
  const { data } = useData();
  const act = useAction();
  const dev = getDevice();
  const [f, setF] = useState({ text: note?.text ?? "", color: note?.color ?? "geel", memberId: note?.memberId ?? dev.memberId ?? data?.me.memberId ?? null, pinned: note?.pinned ?? false });
  const save = async () => {
    if (!f.text.trim()) return;
    const ok = await act(() => (note ? api.put(`/notes/${note.id}`, f) : api.post("/notes", f)), t("Op het prikbord"));
    if (ok) onClose();
  };
  return (
    <Modal title={note ? t("Briefje bewerken") : t("Nieuw briefje")} onClose={onClose}>
      <textarea className="note-input" style={{ background: bgOf(f.color) }} value={f.text} autoFocus maxLength={500} rows={4} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder={t("bv. Oma komt zondag eten 🍲")} />
      <div className="field"><span>{t("Kleur")}</span>
        <div className="picks">{NOTE_COLORS.map((c) => <button type="button" key={c.id} className="swatch" style={{ background: c.bg }} aria-pressed={f.color === c.id} aria-label={t(c.label)} onClick={() => setF({ ...f, color: c.id })} />)}</div>
      </div>
      <div className="field"><span>{t("Van wie")}</span>
        <div className="picks">{data?.members.map((m) => <button type="button" key={m.id} className="pick pick-person" style={cvar(m.color)} aria-pressed={f.memberId === m.id} onClick={() => setF({ ...f, memberId: f.memberId === m.id ? null : m.id })}><Avatar m={m} size={22} dot={false} /> {m.name}</button>)}</div>
      </div>
      <label className="check-row"><input type="checkbox" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} />{" "}{t("📌 Vastprikken (blijft bovenaan)")}</label>
      <div className="actions">
        {note && <button className="btn danger left" onClick={async () => { if (await act(() => api.del(`/notes/${note.id}`), t("Briefje weg"))) onClose(); }}>{t("Verwijderen")}</button>}
        <button className="btn ghost" onClick={onClose}>{t("Annuleren")}</button>
        <button className="btn" onClick={save} disabled={!f.text.trim()}>{t("Ophangen")}</button>
      </div>
    </Modal>
  );
}

/** Het volledige prikbord (app) */
export function PrikbordApp() {
  const [notes] = useNotes();
  const [edit, setEdit] = useState<{ note?: Note } | null>(null);
  return (
    <div className="page-scroll" style={{ flex: 1, minHeight: 0 }}>
      <div className="notes-top">
        <p className="hint">{t("Briefjes voor het hele gezin. Wat hier hangt, staat meteen op elk toestel.")}</p>
        <button className="btn accent" onClick={() => setEdit({})}>{t("+ Briefje")}</button>
      </div>
      <div className="notes">
        {notes.map((n) => <NoteCard key={n.id} n={n} onEdit={(x) => setEdit({ note: x })} />)}
        {!notes.length && <p className="empty">{t("Nog niets op het prikbord. Hang het eerste briefje op!")}</p>}
      </div>
      {edit && <NoteEditor note={edit.note} onClose={() => setEdit(null)} />}
    </div>
  );
}

/** Kleine versie voor het Bord en Mijn dag */
export function PrikbordWidget({ max = 4, onMore }: { max?: number; onMore?: () => void }) {
  const [notes] = useNotes();
  const [edit, setEdit] = useState<{ note?: Note } | null>(null);
  return (
    <section className="glass widget-sm">
      <div className="widget-h"><h2>{t("Prikbord")}</h2><span style={{ display: "flex", gap: 8 }}>{onMore && notes.length > max && <button className="linkbtn" onClick={onMore}>{t("Alles")} ({notes.length})</button>}<button className="linkbtn" onClick={() => setEdit({})}>{t("+ Briefje")}</button></span></div>
      <div className="notes mini">
        {notes.slice(0, max).map((n) => <NoteCard key={n.id} n={n} small onEdit={(x) => setEdit({ note: x })} />)}
        {!notes.length && <p className="empty">{t("Niets op het prikbord.")}</p>}
      </div>
      {edit && <NoteEditor note={edit.note} onClose={() => setEdit(null)} />}
    </section>
  );
}
