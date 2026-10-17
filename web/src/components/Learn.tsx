import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { Member, Surah } from "../types";
import { Avatar } from "./ui";
import { Icon } from "./Icons";
import { Celebration } from "./Profile";
import { ayahAudioUrl } from "../islam";
import { getLang, t as tr } from "../i18n";
import { ORDERS, PAIRS, QUIZ, SURAHS, TOPICS, type Bi } from "../learn-content";

type Game = "quiz" | "match" | "order" | "surah" | "sums" | "tables" | "speed";
type Subject = "islam" | "rekenen";
const bi = (b: Bi) => (getLang() === "tr" ? b.tr : b.nl);
/** Vrolijke geluidjes zonder bestanden (WebAudio). */
function beep(kind: "good" | "bad" | "win") {
  try {
    const ctx = new AudioContext();
    const notes = kind === "good" ? [660, 880] : kind === "bad" ? [220, 180] : [523, 659, 784, 1047];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = kind === "bad" ? "sawtooth" : "sine"; o.frequency.value = f;
      const t0 = ctx.currentTime + i * (kind === "win" ? 0.16 : 0.12);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
      o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + 0.3);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1500);
  } catch { /* stil */ }
}
/** Korte confetti-regen bij een juist antwoord. */
function Burst() {
  const bits = useMemo(() => Array.from({ length: 18 }, (_, i) => ({ i, x: 20 + Math.random() * 60, d: Math.random() * 0.3, c: ["#ff8a4c", "#48d1c4", "#6d7cff", "#ffd34d", "#ff6b9d"][i % 5], r: Math.random() * 360 })), []);
  return <span className="burst" aria-hidden>{bits.map((b) => <i key={b.i} style={{ left: `${b.x}%`, background: b.c, animationDelay: `${b.d}s`, transform: `rotate(${b.r}deg)` }} />)}</span>;
}
const shuffle = <T,>(a: T[]) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
const GAMES: { id: Game; subject: Subject; icon: string; color: string; title: Bi; sub: Bi }[] = [
  { id: "sums", subject: "rekenen", icon: "🧮", color: "#ffd34d", title: { nl: "Sommen", tr: "İşlemler" }, sub: { nl: "Plus, min, keer en delen", tr: "Toplama, çıkarma, çarpma, bölme" } },
  { id: "tables", subject: "rekenen", icon: "🐙", color: "#b58cf0", title: { nl: "Tafels", tr: "Çarpım tablosu" }, sub: { nl: "Oefen een tafel naar keuze", tr: "İstediğin tabloyu çalış" } },
  { id: "speed", subject: "rekenen", icon: "🚀", color: "#ff8a80", title: { nl: "Snelheidsronde", tr: "Hız turu" }, sub: { nl: "Zoveel mogelijk in 60 seconden", tr: "60 saniyede olabildiğince çok" } },
  { id: "quiz", subject: "islam", icon: "🦉", color: "#48d1c4", title: { nl: "Weetjesquiz", tr: "Bilgi yarışması" }, sub: { nl: "Kies het juiste antwoord", tr: "Doğru cevabı seç" } },
  { id: "match", subject: "islam", icon: "🐘", color: "#ff8a4c", title: { nl: "Woordparen", tr: "Kelime eşleştirme" }, sub: { nl: "Arabisch bij de betekenis", tr: "Arapçayı anlamıyla eşleştir" } },
  { id: "order", subject: "islam", icon: "🐢", color: "#6fb7ff", title: { nl: "Op volgorde", tr: "Sıraya koy" }, sub: { nl: "Zet de stappen juist", tr: "Adımları doğru sırala" } },
  { id: "surah", subject: "islam", icon: "🐦", color: "#8ed081", title: { nl: "Soera's leren", tr: "Sure öğren" }, sub: { nl: "Luister en zeg na", tr: "Dinle ve tekrar et" } },
];

/** Spelend islam leren: kies wie speelt, kies een spel, verdien sterren voor de spaarpot. */
export function LearnApp() {
  const { data } = useData();
  const act = useAction();
  const [progress, reload] = useRemote<{ progress: Record<string, { total: number; games: Record<string, number>; today: number }>; dailyMax: number }>("/learn/progress", ["chores"], { progress: {}, dailyMax: 10 });
  const members = data?.members ?? [];
  const [who, setWho] = useState<string>(() => { try { return localStorage.getItem("gb.learn.who") ?? ""; } catch { return ""; } });
  const me = members.find((m) => m.id === who) ?? members.find((m) => m.role === "kind") ?? members[0];
  const [game, setGame] = useState<Game | null>(null);
  const [subject, setSubject] = useState<Subject>(() => { try { return (localStorage.getItem("gb.learn.subject") as Subject) || "islam"; } catch { return "islam"; } });
  const pickSubject = (x: Subject) => { setSubject(x); try { localStorage.setItem("gb.learn.subject", x); } catch { /* */ } };
  const [celebrate, setCelebrate] = useState<string | null>(null);
  const [earned, setEarned] = useState<{ given: number; today: number; dailyMax: number } | null>(null);
  useEffect(() => { if (me) { try { localStorage.setItem("gb.learn.who", me.id); } catch { /* */ } } }, [me]);

  const finish = async (g: Game, stars: number, name: string) => {
    if (!me || stars <= 0) { setGame(null); return; }
    const r = await act(() => api.post<{ given: number; today: number; dailyMax: number }>("/learn/stars", { memberId: me.id, game: g, stars }));
    setGame(null);
    if (r) { setEarned(r); reload(); if (r.given > 0) setCelebrate(name); }
  };
  if (!me) return <p className="empty">{tr("Nog geen gezinsleden.")}</p>;
  const p = progress.progress[me.id];

  if (game === "quiz") return <QuizGame onDone={(s) => finish("quiz", s, me.name)} onClose={() => setGame(null)} />;
  if (game === "match") return <MatchGame onDone={(s) => finish("match", s, me.name)} onClose={() => setGame(null)} />;
  if (game === "order") return <OrderGame onDone={(s) => finish("order", s, me.name)} onClose={() => setGame(null)} />;
  if (game === "surah") return <SurahGame onDone={(s) => finish("surah", s, me.name)} onClose={() => setGame(null)} />;
  if (game === "sums") return <SumsGame onDone={(s) => finish("sums", s, me.name)} onClose={() => setGame(null)} />;
  if (game === "tables") return <TablesGame onDone={(s) => finish("tables", s, me.name)} onClose={() => setGame(null)} />;
  if (game === "speed") return <SpeedGame onDone={(s) => finish("speed", s, me.name)} onClose={() => setGame(null)} />;

  return (
    <div className="page-scroll learn kids" style={{ flex: 1, minHeight: 0 }}>
      <section className="card card-pad learn-head">
        <div className="learn-who">
          <span className="hint">{tr("Wie speelt er?")}</span>
          <div className="picks">
            {members.map((m: Member) => <button key={m.id} type="button" className="pick pick-person" style={{ "--c": m.color } as React.CSSProperties} aria-pressed={m.id === me.id} onClick={() => setWho(m.id)}><Avatar m={m} size={22} dot={false} /> {m.name}</button>)}
          </div>
        </div>
        <div className="learn-stars">
          <b className="num"><span className="spin-star" aria-hidden>⭐</span> {p?.total ?? 0}</b>
          <small>{tr("verdiend met leren")}{p?.today ? ` · ${tr("vandaag")} +${p.today}` : ""}</small>
          <small className="muted">{tr("Max. {n} sterren per spel per dag. Ze tellen mee in de spaarpot.", { n: progress.dailyMax })}</small>
        </div>
      </section>
      {earned && <p className="hint learn-earned">{earned.given > 0 ? tr("+{n} sterren voor {name}! 🎉", { n: earned.given, name: me.name }) : tr("Goed gespeeld! Het dagmaximum voor dit spel is bereikt; morgen weer sterren.")}</p>}
      <div className="learn-subjects kid-tabs" role="group" aria-label={tr("Onderwerp")}>
        <button className={subject === "islam" ? "on" : ""} aria-pressed={subject === "islam"} onClick={() => pickSubject("islam")}><span aria-hidden>🕌</span> {tr("Islam")}</button>
        <button className={subject === "rekenen" ? "on" : ""} aria-pressed={subject === "rekenen"} onClick={() => pickSubject("rekenen")}><span aria-hidden>🔢</span> {tr("Rekenen")}</button>
      </div>
      <div className="learn-grid">
        {GAMES.filter((g) => g.subject === subject).map((g) => (
          <button key={g.id} className="learn-tile kid" style={{ "--c": g.color } as React.CSSProperties} onClick={() => { setEarned(null); setGame(g.id); }}>
            <span className="learn-ic big wiggle" aria-hidden>{g.icon}</span>
            <b>{bi(g.title)}</b>
            <small>{bi(g.sub)}</small>
            {!!p?.games[g.id] && <span className="badge">⭐ {p.games[g.id]}</span>}
          </button>
        ))}
      </div>
      {celebrate && <Celebration name={celebrate} text={tr("Je hebt sterren verdiend met leren. Ga zo door!")} onDone={() => setCelebrate(null)} />}
    </div>
  );
}

function GameShell({ title, onClose, children, progress, icon }: { title: string; onClose: () => void; children: React.ReactNode; progress?: number; icon?: string }) {
  return (
    <div className="learn-game kids">
      <div className="learn-bar">
        <button className="backbtn kid-back" onClick={onClose}><Icon.left /> {tr("Spelletjes")}</button>
        {icon && <span className="learn-bar-ic bob" aria-hidden>{icon}</span>}
        <b>{title}</b>
        {progress !== undefined && (
          <span className="kid-progress" aria-hidden>
            <i style={{ width: `${Math.round(progress * 100)}%` }} />
            <span className="kid-progress-star" style={{ left: `calc(${Math.round(progress * 100)}% - 12px)` }}>⭐</span>
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Result({ stars, max, onDone }: { stars: number; max: number; onDone: () => void }) {
  useEffect(() => { beep("win"); }, []);
  return (
    <div className="learn-result kid-pop">
      <Burst />
      <span className="learn-result-ic bounce" aria-hidden>{stars === max ? "🏆" : stars >= max / 2 ? "🌟" : "💪"}</span>
      <div className="star-row" aria-hidden>{Array.from({ length: max }, (_, i) => <span key={i} className={i < stars ? "lit" : ""} style={{ animationDelay: `${i * 0.08}s` }}>⭐</span>)}</div>
      <b>{stars === max ? tr("Alles juist!") : tr("Goed gedaan!")}</b>
      <p>{tr("{s} van {m} sterren", { s: stars, m: max })}</p>
      <button className="btn" onClick={onDone}>{tr("Sterren ophalen")}</button>
    </div>
  );
}

/* ---------- Quiz ---------- */
function QuizGame({ onDone, onClose }: { onDone: (stars: number) => void; onClose: () => void }) {
  const [topic, setTopic] = useState<string | null>(null);
  const qs = useMemo(() => (topic ? shuffle(QUIZ.filter((q) => q.topic === topic)).slice(0, 6) : []), [topic]);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  if (!topic) return (
    <GameShell title={tr("Weetjesquiz")} onClose={onClose}>
      <p className="hint">{tr("Kies een onderwerp. Zes vragen, elke juiste is een ster.")}</p>
      <div className="learn-grid">
        {Object.entries(TOPICS).map(([k, v], i) => <button key={k} className="learn-tile kid" style={{ "--c": ["#48d1c4", "#ffd34d", "#ff8a4c", "#b58cf0", "#ff6b9d", "#6fb7ff"][i % 6] } as React.CSSProperties} onClick={() => setTopic(k)}><span className="learn-ic big wiggle">{v.icon}</span><b>{bi(v)}</b><small>{QUIZ.filter((q) => q.topic === k).length} {tr("vragen")}</small></button>)}
      </div>
    </GameShell>
  );
  if (done) return <GameShell title={tr("Weetjesquiz")} onClose={onClose}><Result stars={score} max={qs.length} onDone={() => onDone(score)} /></GameShell>;
  const q = qs[i];
  const answer = (k: number) => { if (picked !== null) return; setPicked(k); if (k === q.answer) { setScore((s) => s + 1); beep("good"); } else beep("bad"); };
  const next = () => { if (i + 1 >= qs.length) setDone(true); else { setI(i + 1); setPicked(null); } };
  return (
    <GameShell title={bi(TOPICS[topic])} icon={TOPICS[topic].icon} onClose={() => setTopic(null)} progress={i / qs.length}>
      <div className="learn-q kid-card">
        {picked !== null && picked === q.answer && <Burst />}
        <small>{tr("Vraag {i} van {n}", { i: i + 1, n: qs.length })}</small>
        <div className="kid-question"><span className="kid-q-ic bob" aria-hidden>{q.icon ?? TOPICS[topic].icon}</span><h2>{bi(q.q)}</h2></div>
        <div className="learn-options pics">
          {q.options.map((o, k) => <button key={k} className={`learn-opt pic${picked !== null ? (k === q.answer ? " right" : k === picked ? " wrong shake" : " dim") : ""}`} onClick={() => answer(k)}><span className="opt-ic" aria-hidden>{q.optionIcons?.[k] ?? "⬜"}</span><span>{bi(o)}</span></button>)}
        </div>
        {picked !== null && <p className={`learn-feedback ${picked === q.answer ? "good" : "oops"}`}>{picked === q.answer ? tr("Juist! ⭐") : tr("Niet juist. Het goede antwoord staat groen.")}</p>}
        {picked !== null && <button className="btn" onClick={next}>{i + 1 >= qs.length ? tr("Klaar") : tr("Volgende vraag")}</button>}
      </div>
    </GameShell>
  );
}

/* ---------- Woordparen (memory) ---------- */
function MatchGame({ onDone, onClose }: { onDone: (stars: number) => void; onClose: () => void }) {
  const pairs = useMemo(() => shuffle(PAIRS).slice(0, 6), []);
  const cards = useMemo(() => shuffle(pairs.flatMap((p, idx) => [{ id: `a${idx}`, pair: idx, txt: `${p.ar}\n${p.latin}`, ar: true, icon: "" }, { id: `b${idx}`, pair: idx, txt: bi(p.meaning), ar: false, icon: p.icon }])), [pairs]);
  const [open, setOpen] = useState<string[]>([]);
  const [found, setFound] = useState<Set<number>>(new Set());
  const [tries, setTries] = useState(0);
  const flip = (id: string) => {
    if (open.includes(id) || open.length === 2) return;
    const nxt = [...open, id];
    setOpen(nxt);
    if (nxt.length === 2) {
      const [x, y] = nxt.map((c) => cards.find((k) => k.id === c)!);
      setTries((n) => n + 1);
      if (x.pair === y.pair && x.ar !== y.ar) { beep("good"); setTimeout(() => { setFound((f) => new Set([...f, x.pair])); setOpen([]); }, 500); }
      else { beep("bad"); setTimeout(() => setOpen([]), 900); }
    }
  };
  const complete = found.size === pairs.length;
  const stars = complete ? Math.max(1, pairs.length - Math.max(0, tries - pairs.length - 2)) : 0;
  return (
    <GameShell title={tr("Woordparen")} icon="🐘" onClose={onClose} progress={found.size / pairs.length}>
      {complete ? <Result stars={stars} max={pairs.length} onDone={() => onDone(stars)} /> : (
        <>
          <p className="hint">{tr("Draai twee kaarten om en zoek het Arabische woord bij zijn betekenis.")} · {tr("pogingen")}: {tries}</p>
          <div className="memory">
            {cards.map((c, ci) => {
              const up = open.includes(c.id) || found.has(c.pair);
              return (
                <button key={c.id} className={`mcard${up ? " up" : ""}${found.has(c.pair) ? " found" : ""}${c.ar ? " ar" : ""}`} onClick={() => flip(c.id)} aria-label={up ? c.txt : tr("Kaart")}>
                  {up ? <>{c.icon && <span className="mcard-ic" aria-hidden>{c.icon}</span>}{c.txt.split("\n").map((l, i) => <span key={i} lang={c.ar && i === 0 ? "ar" : undefined} dir={c.ar && i === 0 ? "rtl" : undefined}>{l}</span>)}</> : <span className="mcard-back">{["🌙", "⭐", "🕌", "📖", "🌸", "🐪"][ci % 6]}</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </GameShell>
  );
}

/* ---------- Op volgorde ---------- */
function OrderGame({ onDone, onClose }: { onDone: (stars: number) => void; onClose: () => void }) {
  const [which, setWhich] = useState<number | null>(null);
  const order = which !== null ? ORDERS[which] : null;
  const [pool, setPool] = useState<number[]>([]);
  const [placed, setPlaced] = useState<number[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [shakeId, setShakeId] = useState<number | null>(null);
  const start = (k: number) => { setWhich(k); setPool(shuffle(ORDERS[k].steps.map((_, i) => i))); setPlaced([]); setMistakes(0); };
  if (!order) return (
    <GameShell title={tr("Op volgorde")} onClose={onClose}>
      <p className="hint">{tr("Tik de stappen aan in de juiste volgorde.")}</p>
      <div className="learn-grid">{ORDERS.map((o, k) => <button key={k} className="learn-tile kid" style={{ "--c": ["#6fb7ff", "#ffd34d", "#48d1c4", "#b58cf0", "#ff8a4c"][k % 5] } as React.CSSProperties} onClick={() => start(k)}><span className="learn-ic big wiggle">{o.icon}</span><b>{bi(o.title)}</b><small>{o.steps.length} {tr("stappen")}</small></button>)}</div>
    </GameShell>
  );
  const complete = placed.length === order.steps.length;
  const stars = Math.max(1, order.steps.length - mistakes);
  const pick = (idx: number) => {
    if (idx === placed.length) { beep("good"); setPlaced([...placed, idx]); setPool(pool.filter((x) => x !== idx)); }
    else { beep("bad"); setMistakes((m) => m + 1); setShakeId(idx); setTimeout(() => setShakeId(null), 500); }
  };
  return (
    <GameShell title={bi(order.title)} icon={order.icon} onClose={() => setWhich(null)} progress={placed.length / order.steps.length}>
      {complete ? <Result stars={stars} max={order.steps.length} onDone={() => onDone(stars)} /> : (
        <div className="order kids">
          <div className="order-path">
            {order.steps.map((_, k) => {
              const done = k < placed.length;
              return (
                <div key={k} className={`path-step${done ? " done kid-pop" : k === placed.length ? " next" : ""}`}>
                  <span className="path-n">{k + 1}</span>
                  <span className="path-ic" aria-hidden>{done ? order.icons[k] : k === placed.length ? "❓" : "·"}</span>
                  {done && <small>{bi(order.steps[k])}</small>}
                </div>
              );
            })}
          </div>
          <p className="hint kid-hint">{tr("Wat komt nu?")} 👇</p>
          <div className="order-pool pics">{pool.map((i) => <button key={i} className={`learn-opt pic${shakeId === i ? " wrong shake" : ""}`} onClick={() => pick(i)}><span className="opt-ic" aria-hidden>{order.icons[i]}</span><span>{bi(order.steps[i])}</span></button>)}</div>
          {mistakes > 0 && <p className="hint">{tr("{n} keer mis, geeft niet: probeer verder!", { n: mistakes })}</p>}
        </div>
      )}
    </GameShell>
  );
}

/* ---------- Soera's leren: luister per vers, zeg na, lees de betekenis ---------- */
function SurahGame({ onDone, onClose }: { onDone: (stars: number) => void; onClose: () => void }) {
  const { data } = useData();
  const [which, setWhich] = useState<number | null>(null);
  const [surah, setSurah] = useState<Surah | null>(null);
  const [i, setI] = useState(0);
  const [heard, setHeard] = useState<Set<number>>(new Set());
  const [playing, setPlaying] = useState(false);
  const [audio] = useState(() => new Audio());
  const reciter = data?.settings.quran_reciter ?? "ar.alafasy";
  useEffect(() => {
    if (which === null) return;
    setSurah(null); setI(0); setHeard(new Set());
    api.get<Surah>(`/quran/surah/${which}?translation=${encodeURIComponent(data?.settings.quran_translation ?? "nl.siregar")}`).then(setSurah).catch(() => setSurah(null));
  }, [which, data?.settings.quran_translation]);
  useEffect(() => () => audio.pause(), [audio]);
  const play = () => {
    if (!surah) return;
    audio.src = ayahAudioUrl(reciter, surah.ayahs[i].number);
    audio.onended = () => { setPlaying(false); setHeard((h) => { if (!h.has(i)) beep("good"); return new Set([...h, i]); }); };
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };
  const info = which !== null ? SURAHS.find((s) => s.n === which) : null;
  if (which === null) return (
    <GameShell title={tr("Soera's leren")} onClose={onClose}>
      <p className="hint">{tr("Luister vers per vers, zeg het na en lees wat het betekent. Elk beluisterd vers is een ster.")}</p>
      <div className="learn-grid">{SURAHS.map((s, k) => <button key={s.n} className="learn-tile kid" style={{ "--c": ["#8ed081", "#ffd34d", "#48d1c4", "#6fb7ff", "#ff8a4c", "#b58cf0", "#ff6b9d"][k % 7] } as React.CSSProperties} onClick={() => setWhich(s.n)}><span className="learn-ic big wiggle">{["🌅", "☝️", "🌄", "👥", "🏞️", "⏳", "🏁"][k % 7]}</span><b>{bi(s.name)}</b><small>{tr("soera")} {s.n}</small></button>)}</div>
    </GameShell>
  );
  const complete = !!surah && heard.size >= surah.ayahs.length;
  return (
    <GameShell title={info ? bi(info.name) : ""} icon="🐦" onClose={() => { audio.pause(); setWhich(null); }} progress={surah ? heard.size / surah.ayahs.length : 0}>
      {info && <p className="hint">{bi(info.about)}</p>}
      {!surah && <p className="empty">{tr("Soera laden…")}</p>}
      {surah && complete && <Result stars={surah.ayahs.length} max={surah.ayahs.length} onDone={() => onDone(Math.min(10, surah.ayahs.length))} />}
      {surah && !complete && (
        <div className="learn-ayah kid-card">
          <small>{tr("Vers {i} van {n}", { i: i + 1, n: surah.ayahs.length })}</small>
          <p className="ayah-ar learn-ar" lang="ar" dir="rtl">{surah.ayahs[i].text}</p>
          <p className="learn-tr">{surah.ayahs[i].translation}</p>
          <div className="learn-ctl">
            <button className="iconbtn" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0} aria-label={tr("Vorig vers")}>⏮</button>
            <button className="btn" onClick={play}>{playing ? tr("Speelt…") : heard.has(i) ? tr("Nog eens luisteren") : tr("▶ Luister en zeg na")}</button>
            <button className="iconbtn" onClick={() => setI(Math.min(surah.ayahs.length - 1, i + 1))} disabled={i >= surah.ayahs.length - 1} aria-label={tr("Volgend vers")}>⏭</button>
          </div>
          <div className="learn-dots">{surah.ayahs.map((_, k) => <i key={k} className={heard.has(k) ? "on" : k === i ? "cur" : ""} />)}</div>
        </div>
      )}
    </GameShell>
  );
}

/* ---------- Rekenen ---------- */
type Op = "+" | "−" | "×" | "÷";
interface Sum { a: number; b: number; op: Op; answer: number }
const LEVELS: { id: number; title: Bi; max: number; ops: Op[] }[] = [
  { id: 1, title: { nl: "Tot 10 (plus en min)", tr: "10'a kadar (toplama ve çıkarma)" }, max: 10, ops: ["+", "−"] },
  { id: 2, title: { nl: "Tot 20 (plus en min)", tr: "20'ye kadar (toplama ve çıkarma)" }, max: 20, ops: ["+", "−"] },
  { id: 3, title: { nl: "Tot 100 (plus en min)", tr: "100'e kadar (toplama ve çıkarma)" }, max: 100, ops: ["+", "−"] },
  { id: 4, title: { nl: "Keer en delen (tafels tot 10)", tr: "Çarpma ve bölme (10'a kadar)" }, max: 10, ops: ["×", "÷"] },
  { id: 5, title: { nl: "Alles door elkaar tot 100", tr: "100'e kadar karışık" }, max: 100, ops: ["+", "−", "×", "÷"] },
];
const rnd = (n: number) => Math.floor(Math.random() * (n + 1));
function makeSum(max: number, ops: Op[]): Sum {
  const op = ops[rnd(ops.length - 1)];
  if (op === "+") { const a = rnd(max), b = rnd(max - a); return { a, b, op, answer: a + b }; }
  if (op === "−") { const a = rnd(max), b = rnd(a); return { a, b, op, answer: a - b }; }
  const t = Math.min(10, Math.max(2, max >= 100 ? 10 : max)); const a = 1 + rnd(t - 1), b = 1 + rnd(9);
  if (op === "×") return { a, b, op, answer: a * b };
  return { a: a * b, b: a, op, answer: b };
}
const choicesFor = (answer: number) => { const set = new Set([answer]); while (set.size < 4) { const d = answer + (rnd(10) - 5) * (answer > 20 ? 2 : 1); if (d >= 0 && d !== answer) set.add(d); } return shuffle([...set]); };

const FRUIT = ["🍎", "🍓", "🍊", "🍇", "🐟", "⭐", "🧁", "🐥"];
function Objects({ n, icon }: { n: number; icon: string }) {
  return <span className="objs" aria-hidden>{Array.from({ length: n }, (_, i) => <span key={i} style={{ animationDelay: `${i * 0.04}s` }}>{icon}</span>)}</span>;
}
function SumRow({ sum, onAnswer }: { sum: Sum; onAnswer: (ok: boolean) => void }) {
  const choices = useMemo(() => choicesFor(sum.answer), [sum]);
  const [picked, setPicked] = useState<number | null>(null);
  const icon = useMemo(() => FRUIT[Math.floor(Math.random() * FRUIT.length)], [sum]);
  useEffect(() => setPicked(null), [sum]);
  const pick = (c: number) => { if (picked !== null) return; setPicked(c); beep(c === sum.answer ? "good" : "bad"); setTimeout(() => onAnswer(c === sum.answer), c === sum.answer ? 500 : 1100); };
  const visual = (sum.op === "+" || sum.op === "−") && sum.a <= 10 && sum.b <= 10;
  return (
    <div className="learn-q math kid-card">
      {picked === sum.answer && <Burst />}
      {visual && (
        <div className="math-visual">
          <Objects n={sum.a} icon={icon} />
          <span className="math-op">{sum.op}</span>
          <Objects n={sum.b} icon={sum.op === "−" ? "❌" : icon} />
        </div>
      )}
      <div className="math-sum num">{sum.a} {sum.op} {sum.b} = <span className={`math-q${picked !== null ? (picked === sum.answer ? " good" : " oops") : ""}`}>{picked ?? "?"}</span></div>
      <div className="math-choices">
        {choices.map((c, k) => <button key={c} className={`learn-opt num bubble${picked !== null ? (c === sum.answer ? " right" : c === picked ? " wrong shake" : " dim") : ""}`} style={{ "--c": ["#ffd34d", "#48d1c4", "#ff8a4c", "#b58cf0"][k % 4] } as React.CSSProperties} onClick={() => pick(c)}>{c}</button>)}
      </div>
      {picked !== null && <p className="learn-feedback">{picked === sum.answer ? tr("Juist! ⭐") : tr("Bijna! Het juiste antwoord is {n}.", { n: sum.answer })}</p>}
    </div>
  );
}

function SumsGame({ onDone, onClose }: { onDone: (stars: number) => void; onClose: () => void }) {
  const [level, setLevel] = useState<typeof LEVELS[number] | null>(null);
  const [sums, setSums] = useState<Sum[]>([]);
  const [i, setI] = useState(0);
  const [score, setScore] = useState(0);
  const start = (l: typeof LEVELS[number]) => { setLevel(l); setSums(Array.from({ length: 10 }, () => makeSum(l.max, l.ops))); setI(0); setScore(0); };
  if (!level) return (
    <GameShell title={tr("Sommen")} icon="🧮" onClose={onClose}>
      <p className="hint">{tr("Kies hoe moeilijk. Tien sommen, elke juiste is een ster.")}</p>
      <div className="learn-grid">{LEVELS.map((l, k) => <button key={l.id} className="learn-tile kid" style={{ "--c": ["#8ed081", "#48d1c4", "#6fb7ff", "#b58cf0", "#ff8a4c"][k % 5] } as React.CSSProperties} onClick={() => start(l)}><span className="learn-ic big wiggle">{["🐣", "🐤", "🐥", "🦜", "🦅"][k % 5]}</span><b>{bi(l.title)}</b><small>{"⭐".repeat(Math.min(3, Math.ceil(l.id / 2)))}</small></button>)}</div>
    </GameShell>
  );
  if (i >= sums.length) return <GameShell title={bi(level.title)} onClose={onClose}><Result stars={score} max={sums.length} onDone={() => onDone(score)} /></GameShell>;
  return (
    <GameShell title={bi(level.title)} onClose={() => setLevel(null)} progress={i / sums.length}>
      <small className="hint">{tr("Som {i} van {n}", { i: i + 1, n: sums.length })} · ⭐ {score}</small>
      <SumRow sum={sums[i]} onAnswer={(ok) => { if (ok) setScore((s) => s + 1); setI(i + 1); }} />
    </GameShell>
  );
}

function TablesGame({ onDone, onClose }: { onDone: (stars: number) => void; onClose: () => void }) {
  const [table, setTable] = useState<number | null>(null);
  const [qs, setQs] = useState<Sum[]>([]);
  const [i, setI] = useState(0);
  const [score, setScore] = useState(0);
  const start = (n: number) => { setTable(n); setQs(shuffle(Array.from({ length: 10 }, (_, k) => ({ a: k + 1, b: n, op: "×" as Op, answer: (k + 1) * n }))).slice(0, 10)); setI(0); setScore(0); };
  if (table === null) return (
    <GameShell title={tr("Tafels")} icon="🐙" onClose={onClose}>
      <p className="hint">{tr("Welke tafel wil je oefenen?")}</p>
      <div className="learn-grid tables-grid">{Array.from({ length: 10 }, (_, k) => k + 1).map((n) => <button key={n} className="learn-tile kid small" style={{ "--c": ["#ffd34d", "#48d1c4", "#ff8a4c", "#b58cf0", "#6fb7ff", "#8ed081", "#ff6b9d", "#ffb75e", "#5ad1c9", "#c9a24a"][n - 1] } as React.CSSProperties} onClick={() => start(n)}><span className="learn-ic big">{["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"][n - 1]}</span><b>{tr("Tafel van {n}", { n })}</b></button>)}</div>
    </GameShell>
  );
  if (i >= qs.length) return <GameShell title={tr("Tafel van {n}", { n: table })} onClose={onClose}><Result stars={score} max={qs.length} onDone={() => onDone(score)} /></GameShell>;
  return (
    <GameShell title={tr("Tafel van {n}", { n: table })} onClose={() => setTable(null)} progress={i / qs.length}>
      <small className="hint">{tr("Som {i} van {n}", { i: i + 1, n: qs.length })} · ⭐ {score}</small>
      <SumRow sum={qs[i]} onAnswer={(ok) => { if (ok) setScore((s) => s + 1); setI(i + 1); }} />
    </GameShell>
  );
}

function SpeedGame({ onDone, onClose }: { onDone: (stars: number) => void; onClose: () => void }) {
  const [running, setRunning] = useState(false);
  const [left, setLeft] = useState(60);
  const [sum, setSum] = useState<Sum>(() => makeSum(20, ["+", "−"]));
  const [score, setScore] = useState(0);
  const [tries, setTries] = useState(0);
  useEffect(() => { if (!running) return; if (left <= 0) { setRunning(false); return; } const tm = setTimeout(() => setLeft(left - 1), 1000); return () => clearTimeout(tm); }, [running, left]);
  const done = !running && left <= 0;
  const stars = Math.min(10, Math.floor(score / 2));
  if (!running && !done) return (
    <GameShell title={tr("Snelheidsronde")} icon="🚀" onClose={onClose}>
      <div className="learn-result kid-pop"><span className="learn-result-ic bounce">🚀</span><b>{tr("60 seconden")}</b><p>{tr("Zoveel mogelijk sommen tot 20. Elke twee juiste = een ster (max. 10).")}</p><button className="btn" onClick={() => { setRunning(true); setLeft(60); setScore(0); setTries(0); setSum(makeSum(20, ["+", "−"])); }}>{tr("Start!")}</button></div>
    </GameShell>
  );
  if (done) return <GameShell title={tr("Snelheidsronde")} onClose={onClose}><div className="learn-result"><span className="learn-result-ic">{score >= 15 ? "🏆" : "🌟"}</span><b>{tr("{n} juist van {m}", { n: score, m: tries })}</b><p>{tr("{s} van {m} sterren", { s: stars, m: 10 })}</p><button className="btn" onClick={() => onDone(stars)}>{tr("Sterren ophalen")}</button></div></GameShell>;
  return (
    <GameShell title={tr("Snelheidsronde")} onClose={onClose} progress={1 - left / 60}>
      <small className="hint num">⏱️ {left}s · ⭐ {score}</small>
      <SumRow sum={sum} onAnswer={(ok) => { if (ok) setScore((s) => s + 1); setTries((n) => n + 1); setSum(makeSum(20, ["+", "−"])); }} />
    </GameShell>
  );
}
