import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "../api";
import { useData, useRemote } from "../store";
import type { Change, Weather } from "../types";
import { Icon } from "../components/Icons";
import { MemberDots } from "../components/ui";
import { RecipeThumb, openRecipe } from "../components/Recipes";
import { useSuggestions } from "../screens/Today";
import { canListen, listen, speak, stopSpeaking } from "./speech";
import { cap, fmtRange, greeting, longDate, todayIso } from "../dates";
import { t, getLang } from "../i18n";

export interface Msg { role: "user" | "assistant"; content: string; changes?: Change[]; error?: boolean; rated?: 1 | -1 }

const stripEmoji = (s: string) => s.replace(/^[^\p{L}\p{N}]+\s*/u, "");

/** Eenvoudige opmaak: **vet**, genummerde lijsten en opsommingen. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <b key={i}>{part.slice(2, -2)}</b> : <Fragment key={i}>{part}</Fragment>));
}
export function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*\d+[.)]\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      out.push(<ol key={i}>{items.map((x, k) => <li key={k}>{inline(x)}</li>)}</ol>);
    } else if (/^\s*[-*•]\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*•]\s+/, ""));
      out.push(<ul key={i}>{items.map((x, k) => <li key={k}>{inline(x)}</li>)}</ul>);
    } else {
      if (l.trim()) out.push(<p key={i}>{inline(l.replace(/^#+\s*/, ""))}</p>);
      i++;
    }
  }
  return <div className="md">{out}</div>;
}

function Wave({ on }: { on: boolean }) {
  return <span className={`wave${on ? " on" : ""}`} aria-hidden>{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ animationDelay: `${(i % 7) * 0.09}s` }} />)}</span>;
}

export function Assistant({ convo, setConvo, initial, onClose }: {
  convo: Msg[]; setConvo: (fn: (c: Msg[]) => Msg[]) => void; initial?: string; onClose: () => void;
}) {
  const { data } = useData();
  const suggestions = useSuggestions();
  const [weather] = useRemote<Weather | null>("/weather", ["settings"], null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [handsfree, setHandsfree] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const stopListen = useRef<() => void>(() => {});
  const handsfreeRef = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const sentInitial = useRef(false);
  const voiceOn = data?.settings.assistant_voice !== "0";

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [convo, busy]);
  useEffect(() => () => { stopListen.current(); stopSpeaking(); }, []);
  useEffect(() => {
    if (initial && !sentInitial.current) { sentInitial.current = true; send(stripEmoji(initial)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const play = (idx: number, content: string, then?: () => void) => {
    setSpeakingIdx(idx);
    speak(content, () => { setSpeakingIdx(null); then?.(); });
  };

  function startListening() {
    stopSpeaking();
    setSpeakingIdx(null);
    setListening(true);
    stopListen.current = listen({
      onPartial: setText,
      onFinal: (t) => { setText(""); if (t) send(t, true); },
      onEnd: () => setListening(false),
      onError: (m) => { setNotice(m); if (/niets/.test(m) && handsfreeRef.current) setTimeout(() => handsfreeRef.current && startListening(), 400); else stopHandsfree(); },
    });
  }
  function startHandsfree() {
    setNotice(null);
    handsfreeRef.current = true;
    setHandsfree(true);
    startListening();
  }
  function stopHandsfree() {
    handsfreeRef.current = false;
    setHandsfree(false);
    stopListen.current();
    setListening(false);
  }

  async function send(q: string, spoken = false) {
    const question = q.trim();
    if (!question || busy) return;
    setText("");
    setNotice(null);
    stopSpeaking();
    const base = convo.filter((m) => !m.error);
    if (base.length && base[base.length - 1].role === "user" && base[base.length - 1].content === question) base.pop(); // opnieuw proberen: vraag niet dubbel
    const history: Msg[] = [...base, { role: "user", content: question }];
    setConvo(() => history);
    setBusy(true);
    try {
      const ask = () => api.post<{ reply: string; changes: Change[] }>("/assistant", { lang: getLang(), messages: history.map(({ role, content }) => ({ role, content })) });
      let r: Awaited<ReturnType<typeof ask>>;
      try { r = await ask(); } catch (e) {
        // netwerk even weg (bv. wifi zonder internet): één keer stil opnieuw proberen
        if (e instanceof ApiError && e.status === 0) { await new Promise((ok) => setTimeout(ok, 2000)); r = await ask(); } else throw e;
      }
      const idx = history.length;
      setConvo((c) => [...c, { role: "assistant", content: r.reply, changes: r.changes }]);
      // handsfree: na het voorlezen meteen opnieuw luisteren
      if (voiceOn || spoken) play(idx, r.reply, () => { if (handsfreeRef.current) startListening(); });
      else if (handsfreeRef.current) startListening();
    } catch (e) {
      setConvo((c) => [...c, { role: "assistant", content: e instanceof Error ? e.message : "Er ging iets mis.", error: true }]);
      if (handsfreeRef.current) stopHandsfree();
    } finally {
      setBusy(false);
    }
  }

  const rate = (idx: number, rating: 1 | -1) => {
    const answer = convo[idx];
    const question = [...convo.slice(0, idx)].reverse().find((m) => m.role === "user")?.content ?? "";
    setConvo((c) => c.map((m, i) => (i === idx ? { ...m, rated: rating } : m)));
    api.post("/assistant/feedback", { rating, question, answer: answer.content }).catch(() => {});
  };

  const lastOptions = (() => {
    const last = convo[convo.length - 1];
    return last?.role === "assistant" ? last.changes?.find((c): c is Extract<Change, { kind: "options" }> => c.kind === "options")?.options : undefined;
  })();

  return (
    <div className="assist" role="dialog" aria-modal="true" aria-label={t("Gezinsassistent")}>
      <div className="assist-inner">
        <div className="assist-top">
          <div className={`mascot${listening ? t(" listening") : busy ? t(" thinking") : ""}`} />
          <div className="assist-head">
            <div className="bubble">
              {listening ? t("Ik luister…") : busy ? t("Even nadenken…") : convo.length ? t("Nog iets?") : `${greeting()}! ${t("Waarmee kan ik helpen?")}`}
            </div>
            <div className="assist-date">
              <span>{longDate(todayIso()).toUpperCase()}</span>
              {weather && <span className="num">{weather.current.icon} {weather.current.temp}° · ↑{weather.days[0]?.max}° ↓{weather.days[0]?.min}°</span>}
            </div>
          </div>
          {convo.length > 0 && <button className="pill" onClick={() => { stopSpeaking(); setConvo(() => []); }}>{t("Nieuw gesprek")}</button>}
          <button className="assist-close" onClick={onClose} aria-label={t("Sluiten")}><Icon.close /></button>
        </div>
        {!data?.assistant.available && (
          <div className="bubble">{t("De assistent is nog niet ingesteld op de server. Een beheerder voegt een ANTHROPIC_API_KEY toe in Railway (Variables).")}</div>
        )}
        {!convo.length && (
          <div className="suggest">
            {suggestions.map((s) => <button key={s} onClick={() => send(stripEmoji(s))}>{s} <Icon.send /></button>)}
          </div>
        )}
        <div className="convo" ref={scroller} aria-live="polite">
          {convo.map((m, i) => m.role === "user"
            ? <div key={i} className="bubble me">{m.content}</div>
            : (
              <div key={i} className="answer">
                <div className={`bubble${m.error ? t(" error") : ""}`}>
                  {!m.error && (
                    <button className="playbtn" onClick={() => (speakingIdx === i ? (stopSpeaking(), setSpeakingIdx(null)) : play(i, m.content))} aria-label={speakingIdx === i ? t("Voorlezen stoppen") : t("Voorlezen")}>
                      {speakingIdx === i ? "❚❚" : "▶"} <Wave on={speakingIdx === i} />
                    </button>
                  )}
                  <Markdown text={m.content} />
                  {m.error && i === convo.length - 1 && convo[i - 1]?.role === "user" && (
                    <button className="pill" style={{ marginTop: 8 }} onClick={() => send(convo[i - 1].content)}>{t("↻ Opnieuw proberen")}</button>
                  )}
                  {!m.error && (
                    <div className="rate">
                      <button aria-label={t("Goed antwoord")} aria-pressed={m.rated === 1} onClick={() => rate(i, 1)}>👍</button>
                      <button aria-label={t("Slecht antwoord")} aria-pressed={m.rated === -1} onClick={() => rate(i, -1)}>👎</button>
                    </div>
                  )}
                </div>
                {!!m.changes?.length && <Changes changes={m.changes} />}
              </div>
            ))}
          {busy && <div className="bubble wait"><span className="dots3"><i /><i /><i /></span></div>}
        </div>
        {lastOptions && !busy && (
          <div className="options">{lastOptions.map((o) => <button key={o} onClick={() => send(o)}>{o}</button>)}</div>
        )}
        {notice && <div className="bubble error">{notice}</div>}
        {handsfree ? (
          <div className="stopbar">
            <button className="stopbar-x" onClick={stopHandsfree} aria-label={t("Gesprek stoppen")}><Icon.close /></button>
            <span className="stopbar-mid">{listening ? <><Wave on /> {text || t("Ik luister…")}</> : busy ? t("Even nadenken…") : speakingIdx !== null ? <><Wave on /> {t("Aan het praten…")}</> : "…"}</span>
            <button className="stopbar-stop" onClick={stopHandsfree}>{t("● Stop")}</button>
          </div>
        ) : (
          <form className="composer" onSubmit={(e) => { e.preventDefault(); send(text); }}>
            <input id="assist-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Schrijf iets…")} autoComplete="off" aria-label={t("Vraag aan de assistent")} />
            {text.trim()
              ? <button type="submit" className="talk" disabled={busy}><Icon.send />{" "}{t("Stuur")}</button>
              : <button type="button" className="talk" onClick={startHandsfree} disabled={!canListen()} title={canListen() ? t("Praat met de assistent zonder te tikken") : t("Spraak werkt niet in deze browser")}><Icon.mic />{" "}{t("Praat")}</button>}
          </form>
        )}
        <p className="disclaimer">{t("De assistent kan fouten maken. Controleer belangrijke afspraken.")}</p>
      </div>
    </div>
  );
}

function Changes({ changes }: { changes: Change[] }) {
  const events = changes.filter((c): c is Extract<Change, { kind: "event_added" }> => c.kind === "event_added");
  const recipes = changes.filter((c): c is Extract<Change, { kind: "recipe" }> => c.kind === "recipe");
  const other = changes.filter((c) => c.kind !== "event_added" && c.kind !== "options" && c.kind !== "recipe");
  if (!events.length && !recipes.length && !other.length) return null;
  return (
    <div className="added">
      {events.length > 0 && <h4>{events.length === 1 ? t("1 afspraak toegevoegd") : `${events.length} afspraken toegevoegd`}</h4>}
      {events.map(({ event: e }) => (
        <div className="row" key={e.id}>
          <span><b>{e.title}</b><small>📅 {cap(longDate(e.date))} · {fmtRange(e)}</small></span>
          <MemberDots ids={e.members} />
        </div>
      ))}
      {recipes.map((r) => (
        <button className="row rrow" key={r.id} onClick={() => openRecipe(r.id)}>
          <RecipeThumb r={r} size={44} />
          <span style={{ flex: 1 }}><b>{r.title}</b><small>{t("In je receptenbibliotheek · tik om te openen")}</small></span>
        </button>
      ))}
      {other.map((c, i) => (
        <div className="row" key={i}>
          <span>
            {c.kind === "event_removed" && <><b>{t("Verwijderd")}</b><small>{c.title}</small></>}
            {c.kind === "meal" && <><b>{c.title}</b><small>{cap(c.slot)} · {cap(longDate(c.date))}</small></>}
            {c.kind === "chore" && <><b>Nieuwe taak: {c.title}</b><small>voor {c.member}</small></>}
            {c.kind === "list" && <><b>{c.list}</b><small>{c.items.join(", ")}</small></>}
          </span>
        </div>
      ))}
    </div>
  );
}
