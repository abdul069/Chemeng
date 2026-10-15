import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { photoUrl } from "../api";
import type { Member } from "../types";
import { useData } from "../store";
import { Icon } from "./Icons";

export const cvar = (c: string) => ({ "--c": c }) as CSSProperties;

export function Avatar({ m, size = 52, dot = true }: { m: Member; size?: number; dot?: boolean }) {
  const style = { ...cvar(m.color), "--size": `${size}px` } as CSSProperties;
  if (m.photo) {
    return (
      <span className="avatar photo" style={{ ...style, backgroundImage: `url(${photoUrl(m.photo)})` }} aria-hidden>
        {dot && <span className="dot" />}
      </span>
    );
  }
  return (
    <span className="avatar" style={style} aria-hidden>
      {m.avatar || m.name.charAt(0).toUpperCase()}
      {dot && <span className="dot" />}
    </span>
  );
}

export function MemberDots({ ids }: { ids: string[] }) {
  const { member } = useData();
  return <span className="dots">{ids.map((id) => <i key={id} style={cvar(member(id)?.color ?? "#999")} title={member(id)?.name} />)}</span>;
}

/** De rij gezinsleden bovenaan; tikken verbergt of toont iemand in de kalender. */
export function PeopleBar({ count }: { count?: string }) {
  const { data, hidden, toggleHidden } = useData();
  if (!data) return null;
  return (
    <div className="people">
      {count && <span className="count-chip">{count}</span>}
      {[...data.members, ...data.shared].map((m, i) => (
        <span key={m.id} style={{ display: "contents" }}>
          {m.shared && i === data.members.length && <span className="people-sep" aria-hidden><span>Gedeeld</span></span>}
          <button className={`person${m.shared ? " shared" : ""}`} aria-pressed={!hidden.has(m.id)} onClick={() => toggleHidden(m.id)}
            title={`${m.shared ? "Gedeelde agenda van " : ""}${m.name}: tik om te ${hidden.has(m.id) ? "tonen" : "verbergen"}`}>
            <Avatar m={m} />
            <span className="pname">{m.name}</span>
          </button>
        </span>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    ref.current?.querySelector<HTMLElement>("input, textarea, select, button:not(.iconbtn)")?.focus();
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" ref={ref}>
        <div className="modal-h">
          <h2>{title}</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Sluiten"><Icon.close /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Bevestigen binnen de app zelf (geen browser-popup op een kioskscherm). */
export function Confirm({ title, text, actions, onClose }: { title: string; text?: string; actions: { label: string; kind?: string; run: () => void }[]; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose}>
      {text && <p className="hint">{text}</p>}
      <div className="actions">
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        {actions.map((a) => <button key={a.label} className={`btn ${a.kind ?? ""}`} onClick={() => { a.run(); onClose(); }}>{a.label}</button>)}
      </div>
    </Modal>
  );
}

export const EMOJIS = ["✅", "🛏️", "🪥", "🧸", "📚", "🐕", "🐈", "🗑️", "🍽️", "🍴", "🧺", "👕", "🧹", "🧽", "🪴", "🛒", "👟", "🎒", "🚿", "💊", "🎹", "⚽", "🏊", "🩰", "📖", "🥪", "🚗", "♻️", "🧦", "🌱"];
export const AVATARS = ["🧔", "👩", "👨", "👵", "👴", "🧒", "👧", "👦", "👶", "🧑", "🐶", "🐱", "🦊", "🐻", "🐼", "🦁", "🐸", "🦄", "🐝", "🌟"];

export function EmojiPicker({ value, onChange, options = EMOJIS }: { value: string; onChange: (v: string) => void; options?: string[] }) {
  return (
    <div className="emoji-grid">
      {options.map((e) => <button type="button" key={e} aria-pressed={value === e} onClick={() => onChange(e)}>{e}</button>)}
    </div>
  );
}

export function MemberPicks({ value, onChange, all = true }: { value: string[]; onChange: (v: string[]) => void; all?: boolean }) {
  const { data } = useData();
  const members = data?.members ?? [];
  const set = new Set(value);
  const everyone = members.length > 0 && members.every((m) => set.has(m.id));
  return (
    <div className="picks">
      {members.map((m) => (
        <button type="button" key={m.id} className="pick" style={cvar(m.color)} aria-pressed={set.has(m.id)}
          onClick={() => onChange(set.has(m.id) ? value.filter((x) => x !== m.id) : [...value, m.id])}>
          {m.avatar} {m.name}
        </button>
      ))}
      {all && members.length > 1 && (
        <button type="button" className="pick" aria-pressed={everyone} onClick={() => onChange(everyone ? [] : members.map((m) => m.id))}>Iedereen</button>
      )}
    </div>
  );
}
