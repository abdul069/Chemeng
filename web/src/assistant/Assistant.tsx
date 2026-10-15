import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useData } from "../store";
import type { Change } from "../types";
import { Icon } from "../components/Icons";
import { MemberDots } from "../components/ui";
import { SUGGESTIONS } from "../screens/Today";
import { canListen, listen, speak, stopSpeaking } from "./speech";
import { cap, fmtRange, greeting, longDate } from "../dates";

export interface Msg { role: "user" | "assistant"; content: string; changes?: Change[]; error?: boolean }

export function Assistant({ convo, setConvo, initial, onClose }: {
  convo: Msg[]; setConvo: (fn: (c: Msg[]) => Msg[]) => void; initial?: string; onClose: () => void;
}) {
  const { data } = useData();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const stopRef = useRef<() => void>(() => {});
  const scroller = useRef<HTMLDivElement>(null);
  const sentInitial = useRef(false);
  const voiceOn = data?.settings.assistant_voice !== "0";

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [convo, busy]);
  useEffect(() => () => { stopRef.current(); stopSpeaking(); }, []);
  useEffect(() => {
    if (initial && !sentInitial.current) { sentInitial.current = true; send(initial); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  async function send(q: string, spoken = false) {
    const question = q.trim();
    if (!question || busy) return;
    setText("");
    setNotice(null);
    stopSpeaking();
    const history: Msg[] = [...convo.filter((m) => !m.error), { role: "user", content: question }];
    setConvo(() => history);
    setBusy(true);
    try {
      const r = await api.post<{ reply: string; changes: Change[] }>("/assistant", { messages: history.map(({ role, content }) => ({ role, content })) });
      setConvo((c) => [...c, { role: "assistant", content: r.reply, changes: r.changes }]);
      if (voiceOn || spoken) speak(r.reply);
    } catch (e) {
      setConvo((c) => [...c, { role: "assistant", content: e instanceof Error ? e.message : "Er ging iets mis.", error: true }]);
    } finally {
      setBusy(false);
    }
  }

  const toggleMic = () => {
    if (listening) { stopRef.current(); setListening(false); return; }
    stopSpeaking();
    setListening(true);
    stopRef.current = listen({
      onPartial: setText,
      onFinal: (t) => { setText(""); send(t, true); },
      onEnd: () => setListening(false),
      onError: setNotice,
    });
  };

  return (
    <div className="assist" role="dialog" aria-modal="true" aria-label="Gezinsassistent">
      <div className="assist-inner">
        <div className="assist-top">
          <div className={`mascot${listening ? " listening" : busy ? " thinking" : ""}`} />
          <div className="bubble">
            {listening ? "Ik luister…" : busy ? "Even nadenken…" : convo.length ? "Nog iets?" : `${greeting()}! Waarmee kan ik helpen?`}
          </div>
          {convo.length > 0 && <button className="pill" onClick={() => { stopSpeaking(); setConvo(() => []); }}>Nieuw gesprek</button>}
          <button className="assist-close" onClick={onClose} aria-label="Sluiten"><Icon.close /></button>
        </div>
        {!data?.assistant.available && (
          <div className="bubble">De assistent is nog niet ingesteld op de server. Een ouder kan een ANTHROPIC_API_KEY toevoegen; zie Instellingen → Assistent.</div>
        )}
        {!convo.length && (
          <div className="suggest">
            {SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)}><Icon.send /> {s}</button>)}
          </div>
        )}
        <div className="convo" ref={scroller} aria-live="polite">
          {convo.map((m, i) => m.role === "user"
            ? <div key={i} className="bubble me">{m.content}</div>
            : (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div className={`bubble${m.error ? " error" : ""}`}>{m.content}</div>
                {!!m.changes?.length && <Changes changes={m.changes} />}
              </div>
            ))}
          {busy && <div className="bubble wait">…</div>}
        </div>
        {notice && <div className="bubble error">{notice}</div>}
        <form className="composer" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <input id="assist-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={listening ? "Ik luister…" : "Schrijf iets…"} autoComplete="off" aria-label="Vraag aan de assistent" />
          {text.trim() && !listening
            ? <button type="submit" className="talk" disabled={busy}><Icon.send /> Stuur</button>
            : <button type="button" className={`talk${listening ? " on" : ""}`} onClick={toggleMic} disabled={!canListen() && !listening} title={canListen() ? "Praat" : "Spraak wordt niet ondersteund in deze browser"}>
                {listening ? "■ Stop" : <><Icon.mic /> Praat</>}
              </button>}
        </form>
        <p className="disclaimer">De assistent kan fouten maken. Controleer belangrijke afspraken.</p>
      </div>
    </div>
  );
}

function Changes({ changes }: { changes: Change[] }) {
  const events = changes.filter((c): c is Extract<Change, { kind: "event_added" }> => c.kind === "event_added");
  const other = changes.filter((c) => c.kind !== "event_added");
  return (
    <div className="added">
      {events.length > 0 && <h4>{events.length === 1 ? "1 afspraak toegevoegd" : `${events.length} afspraken toegevoegd`}</h4>}
      {events.map(({ event: e }) => (
        <div className="row" key={e.id}>
          <span><b>{e.title}</b><small>{cap(longDate(e.date))} · {fmtRange(e)}</small></span>
          <MemberDots ids={e.members} />
        </div>
      ))}
      {other.map((c, i) => (
        <div className="row" key={i}>
          <span>
            {c.kind === "event_removed" && <><b>Verwijderd</b><small>{c.title}</small></>}
            {c.kind === "meal" && <><b>{c.title}</b><small>{cap(c.slot)} · {cap(longDate(c.date))}</small></>}
            {c.kind === "chore" && <><b>Nieuwe taak: {c.title}</b><small>voor {c.member}</small></>}
            {c.kind === "list" && <><b>{c.list}</b><small>{c.items.join(", ")}</small></>}
          </span>
        </div>
      ))}
    </div>
  );
}
