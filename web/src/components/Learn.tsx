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
const shuffle = <T,>(a: T[]) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
const GAMES: { id: Game; subject: Subject; icon: string; title: Bi; sub: Bi }[] = [
  { id: "sums", subject: "rekenen", icon: "➕", title: { nl: "Sommen", tr: "İşlemler" }, sub: { nl: "Plus, min, keer en delen", tr: "Toplama, çıkarma, çarpma, bölme" } },
  { id: "tables", subject: "rekenen", icon: "✖️", title: { nl: "Tafels", tr: "Çarpım tablosu" }, sub: { nl: "Oefen een tafel naar keuze", tr: "İstediğin tabloyu çalış" } },
  { id: "speed", subject: "rekenen", icon: "⏱️", title: { nl: "Snelheidsronde", tr: "Hız turu" }, sub: { nl: "Zoveel mogelijk in 60 seconden", tr: "60 saniyede olabildiğince çok" } },
  { id: "quiz", subject: "islam", icon: "❓", title: { nl: "Weetjesquiz", tr: "Bilgi yarışması" }, sub: { nl: "Kies het juiste antwoord", tr: "Doğru cevabı seç" } },
  { id: "match", subject: "islam", icon: "🃏", title: { nl: "Woordparen", tr: "Kelime eşleştirme" }, sub: { nl: "Arabisch bij de betekenis", tr: "Arapçayı anlamıyla eşleştir" } },
  { id: "order", subject: "islam", icon: "🔢", title: { nl: "Op volgorde", tr: "Sıraya koy" }, sub: { nl: "Zet de stappen juist", tr: "Adımları doğru sırala" } },
  { id: "surah", subject: "islam", icon: "📖", title: { nl: "Soera's leren", tr: "Sure öğren" }, sub: { nl: "Luister en zeg na", tr: "Dinle ve tekrar et" } },
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
    <div className="page-scroll learn" style={{ flex: 1, minHeight: 0 }}>
      <section className="card card-pad learn-head">
        <div className="learn-who">
          <span className="hint">{tr("Wie speelt er?")}</span>
          <div className="picks">
            {members.map((m: Member) => <button key={m.id} type="button" className="pick pick-person" style={{ "--c": m.color } as React.CSSProperties} aria-pressed={m.id === me.id} onClick={() => setWho(m.id)}><Avatar m={m} size={22} dot={false} /> {m.name}</button>)}
          </div>
        </div>
        <div className="learn-stars">
          <b className="num">⭐ {p?.total ?? 0}</b>
          <small>{tr("verdiend met leren")}{p?.today ? ` · ${tr("vandaag")} +${p.today}` : ""}</small>
          <small className="muted">{tr("Max. {n} sterren per spel per dag. Ze tellen mee in de spaarpot.", { n: progress.dailyMax })}</small>
        </div>
      </section>
      {earned && <p className="hint learn-earned">{earned.given > 0 ? tr("+{n} sterren voor {name}! 🎉", { n: earned.given, name: me.name }) : tr("Goed gespeeld! Het dagmaximum voor dit spel is bereikt; morgen weer sterren.")}</p>}
      <div className="seg learn-subjects" role="group" aria-label={tr("Onderwerp")}>
        <button aria-pressed={subject === "islam"} onClick={() => pickSubject("islam")}>☪️ {tr("Islam")}</button>
        <button aria-pressed={subject === "rekenen"} onClick={() => pickSubject("rekenen")}>🔢 {tr("Rekenen")}</button>
      </div>
      <div className="learn-grid">
        {GAMES.filter((g) => g.subject === subject).map((g) => (
          <button key={g.id} className="learn-tile" onClick={() => { setEarned(null); setGame(g.id); }}>
            <span className="learn-ic" aria-hidden>{g.icon}</span>
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

function GameShell({ title, onClose, children, progress }: { title: string; onClose: () => void; children: React.ReactNode; progress?: number }) {
  return (
    <div className="learn-game">
      <div className="learn-bar">
        <button className="backbtn" onClick={onClose}><Icon.left /> {tr("Spelletjes")}</button>
        <b>{title}</b>
        {progress !== undefined && <span className="progress learn-progress"><i style={{ width: `${Math.round(progress * 100)}%` }} /></span>}
      </div>
      {children}
    </div>
  );
}

function Result({ stars, max, onDone }: { stars: number; max: number; onDone: () => void }) {
  return (
    <div className="learn-result">
      <span className="learn-result-ic" aria-hidden>{stars === max ? "🏆" : stars >= max / 2 ? "🌟" : "💪"}</span>
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
        {Object.entries(TOPICS).map(([k, v]) => <button key={k} className="learn-tile" onClick={() => setTopic(k)}><span className="learn-ic">{v.icon}</span><b>{bi(v)}</b><small>{QUIZ.filter((q) => q.topic === k).length} {tr("vragen")}</small></button>)}
      </div>
    </GameShell>
  );
  if (done) return <GameShell title={tr("Weetjesquiz")} onClose={onClose}><Result stars={score} max={qs.length} onDone={() => onDone(score)} /></GameShell>;
  const q = qs[i];
  const answer = (k: number) => { if (picked !== null) return; setPicked(k); if (k === q.answer) setScore((s) => s + 1); };
  const next = () => { if (i + 1 >= qs.length) setDone(true); else { setI(i + 1); setPicked(null); } };
  return (
    <GameShell title={`${TOPICS[topic].icon} ${bi(TOPICS[topic])}`} onClose={onClose} progress={i / qs.length}>
      <div className="learn-q">
        <small>{tr("Vraag {i} van {n}", { i: i + 1, n: qs.length })}</small>
        <h2>{bi(q.q)}</h2>
        <div className="learn-options">
          {q.options.map((o, k) => <button key={k} className={`learn-opt${picked !== null ? (k === q.answer ? " right" : k === picked ? " wrong" : "") : ""}`} onClick={() => answer(k)}>{bi(o)}</button>)}
        </div>
        {picked !== null && <p className="learn-feedback">{picked === q.answer ? tr("Juist! ⭐") : tr("Niet juist. Het goede antwoord staat groen.")}</p>}
        {picked !== null && <button className="btn" onClick={next}>{i + 1 >= qs.length ? tr("Klaar") : tr("Volgende vraag")}</button>}
      </div>
    </GameShell>
  );
}

/* ---------- Woordparen (memory) ---------- */
function MatchGame({ onDone, onClose }: { onDone: (stars: number) => void; onClose: () => void }) {
  const pairs = useMemo(() => shuffle(PAIRS).slice(0, 6), []);
  const cards = useMemo(() => shuffle(pairs.flatMap((p, idx) => [{ id: `a${idx}`, pair: idx, txt: `${p.ar}\n${p.latin}`, ar: true }, { id: `b${idx}`, pair: idx, txt: bi(p.meaning), ar: false }])), [pairs]);
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
      if (x.pair === y.pair && x.ar !== y.ar) { setTimeout(() => { setFound((f) => new Set([...f, x.pair])); setOpen([]); }, 500); }
      else setTimeout(() => setOpen([]), 900);
    }
  };
  const complete = found.size === pairs.length;
  const stars = complete ? Math.max(1, pairs.length - Math.max(0, tries - pairs.length - 2)) : 0;
  return (
    <GameShell title={tr("Woordparen")} onClose={onClose} progress={found.size / pairs.length}>
      {complete ? <Result stars={stars} max={pairs.length} onDone={() => onDone(stars)} /> : (
        <>
          <p className="hint">{tr("Draai twee kaarten om en zoek het Arabische woord bij zijn betekenis.")} · {tr("pogingen")}: {tries}</p>
          <div className="memory">
            {cards.map((c) => {
              const up = open.includes(c.id) || found.has(c.pair);
              return (
                <button key={c.id} className={`mcard${up ? " up" : ""}${found.has(c.pair) ? " found" : ""}${c.ar ? " ar" : ""}`} onClick={() => flip(c.id)} aria-label={up ? c.txt : tr("Kaart")}>
                  {up ? c.txt.split("\n").map((l, i) => <span key={i} lang={c.ar && i === 0 ? "ar" : undefined} dir={c.ar && i === 0 ? "rtl" : undefined}>{l}</span>) : <span className="mcard-back">☪</span>}
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
  const start = (k: number) => { setWhich(k); setPool(shuffle(ORDERS[k].steps.map((_, i) => i))); setPlaced([]); setMistakes(0); };
  if (!order) return (
    <GameShell title={tr("Op volgorde")} onClose={onClose}>
      <p className="hint">{tr("Tik de stappen aan in de juiste volgorde.")}</p>
      <div className="learn-grid">{ORDERS.map((o, k) => <button key={k} className="learn-tile" onClick={() => start(k)}><span className="learn-ic">🔢</span><b>{bi(o.title)}</b><small>{o.steps.length} {tr("stappen")}</small></button>)}</div>
    </GameShell>
  );
  const complete = placed.length === order.steps.length;
  const stars = Math.max(1, order.steps.length - mistakes);
  const pick = (idx: number) => {
    if (idx === placed.length) { setPlaced([...placed, idx]); setPool(pool.filter((x) => x !== idx)); }
    else setMistakes((m) => m + 1);
  };
  return (
    <GameShell title={bi(order.title)} onClose={() => setWhich(null)} progress={placed.length / order.steps.length}>
      {complete ? <Result stars={stars} max={order.steps.length} onDone={() => onDone(stars)} /> : (
        <div className="order">
          <ol className="order-placed">{placed.map((i) => <li key={i}>{bi(order.steps[i])}</li>)}{placed.length < order.steps.length && <li className="order-next">{tr("Wat komt nu?")}</li>}</ol>
          <div className="order-pool">{pool.map((i) => <button key={i} className="pick" onClick={() => pick(i)}>{bi(order.steps[i])}</button>)}</div>
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
    audio.onended = () => { setPlaying(false); setHeard((h) => new Set([...h, i])); };
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };
  const info = which !== null ? SURAHS.find((s) => s.n === which) : null;
  if (which === null) return (
    <GameShell title={tr("Soera's leren")} onClose={onClose}>
      <p className="hint">{tr("Luister vers per vers, zeg het na en lees wat het betekent. Elk beluisterd vers is een ster.")}</p>
      <div className="learn-grid">{SURAHS.map((s) => <button key={s.n} className="learn-tile" onClick={() => setWhich(s.n)}><span className="learn-ic">📖</span><b>{bi(s.name)}</b><small>{tr("soera")} {s.n}</small></button>)}</div>
    </GameShell>
  );
  const complete = !!surah && heard.size >= surah.ayahs.length;
  return (
    <GameShell title={info ? bi(info.name) : ""} onClose={() => { audio.pause(); setWhich(null); }} progress={surah ? heard.size / surah.ayahs.length : 0}>
      {info && <p className="hint">{bi(info.about)}</p>}
      {!surah && <p className="empty">{tr("Soera laden…")}</p>}
      {surah && complete && <Result stars={surah.ayahs.length} max={surah.ayahs.length} onDone={() => onDone(Math.min(10, surah.ayahs.length))} />}
      {surah && !complete && (
        <div className="learn-ayah">
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

function SumRow({ sum, onAnswer }: { sum: Sum; onAnswer: (ok: boolean) => void }) {
  const choices = useMemo(() => choicesFor(sum.answer), [sum]);
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => setPicked(null), [sum]);
  const pick = (c: number) => { if (picked !== null) return; setPicked(c); setTimeout(() => onAnswer(c === sum.answer), c === sum.answer ? 350 : 900); };
  return (
    <div className="learn-q math">
      <div className="math-sum num">{sum.a} {sum.op} {sum.b} = <span className="math-q">{picked ?? "?"}</span></div>
      <div className="math-choices">
        {choices.map((c) => <button key={c} className={`learn-opt num${picked !== null ? (c === sum.answer ? " right" : c === picked ? " wrong" : "") : ""}`} onClick={() => pick(c)}>{c}</button>)}
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
    <GameShell title={tr("Sommen")} onClose={onClose}>
      <p className="hint">{tr("Kies hoe moeilijk. Tien sommen, elke juiste is een ster.")}</p>
      <div className="learn-grid">{LEVELS.map((l) => <button key={l.id} className="learn-tile" onClick={() => start(l)}><span className="learn-ic">{"⭐".repeat(Math.min(3, Math.ceil(l.id / 2)))}</span><b>{bi(l.title)}</b></button>)}</div>
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
    <GameShell title={tr("Tafels")} onClose={onClose}>
      <p className="hint">{tr("Welke tafel wil je oefenen?")}</p>
      <div className="picks tables-pick">{Array.from({ length: 10 }, (_, k) => k + 1).map((n) => <button key={n} className="pick num" onClick={() => start(n)}>{tr("Tafel van {n}", { n })}</button>)}</div>
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
    <GameShell title={tr("Snelheidsronde")} onClose={onClose}>
      <div className="learn-result"><span className="learn-result-ic">⏱️</span><b>{tr("60 seconden")}</b><p>{tr("Zoveel mogelijk sommen tot 20. Elke twee juiste = een ster (max. 10).")}</p><button className="btn" onClick={() => { setRunning(true); setLeft(60); setScore(0); setTries(0); setSum(makeSum(20, ["+", "−"])); }}>{tr("Start!")}</button></div>
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
