import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { Member, Surah } from "../types";
import { Avatar } from "./ui";
import { Icon } from "./Icons";
import { Celebration } from "./Profile";
import { ayahAudioUrl } from "../islam";
import { getLang, t as tr } from "../i18n";
import { say } from "../speech";
import { ORDERS, PAIRS, QUIZ, SURAHS, TOPICS, type Bi } from "../learn-content";
import { SETS, GROUP_LABEL, groupFor, clockQuestions, type AgeGroup, type ChoiceSet } from "../learn-age";

type Game = "quiz" | "match" | "order" | "surah" | "sums" | "tables" | "speed" | "clock" | `set:${string}`;

/** Echte, kleurrijke tekening van het web voor een emoji: Google Noto-emoji, bewegend waar dat bestaat,
 *  anders de stilstaande tekening, en als het web niet meewerkt het emoji zelf. */
const notoId = (e: string) => [...e].map((c) => c.codePointAt(0)!).filter((cp) => cp !== 0xfe0f).map((cp) => cp.toString(16).padStart(4, "0")).join("_");
const NOTO = "https://fonts.gstatic.com/s/e/notoemoji/latest/";
const PHONE = typeof matchMedia !== "undefined" && matchMedia("(max-width: 820px)").matches;
function Illu({ e, className = "", still = PHONE }: { e: string; className?: string; still?: boolean }) {
  const [step, setStep] = useState(still ? 1 : 0);
  useEffect(() => setStep(still ? 1 : 0), [e, still]);
  if (!e || step > 1) return <span className={`illu-txt ${className}`} aria-hidden>{e}</span>;
  const src = step === 0 ? `${NOTO}${notoId(e)}/512.webp` : `${NOTO}${notoId(e)}/emoji.svg`;
  return <img key={src} className={`illu ${className}`} src={src} alt="" draggable={false} loading="lazy" onError={() => setStep((x) => x + 1)} />;
}
/** Leest tekst voor met de stem van het toestel (kinderen kunnen nog niet alles lezen). */
let voiceOn = (() => { try { return localStorage.getItem("gb.learn.voice") !== "0"; } catch { return true; } })();
function speak(text: string, force = false) { if (!voiceOn && !force) return; void say(text, 0.92); }
/** Korte kindertekst: zonder haakjes-uitleg. */
const kidText = (s: string) => s.replace(/\s*\([^)]*\)/g, "").trim() || s;
type Mood = "idle" | "ask" | "happy" | "oops" | "party";
const MASCOT: Record<Mood, string> = { idle: "🦉", ask: "🤔", happy: "😍", oops: "🤗", party: "🥳" };
/** Nuri de uil: praat in een tekstballon, leest voor en reageert blij of troostend. */
function Mascot({ mood, say }: { mood: Mood; say: string }) {
  const [, bump] = useState(0);
  useEffect(() => { if (say) { const tm = setTimeout(() => speak(say), 250); return () => clearTimeout(tm); } }, [say]);
  return (
    <div className={`nuri mood-${mood}`}>
      <Illu e={MASCOT[mood]} className="nuri-ic" />
      <div className="mbubble">
        <span>{say}</span>
        <button type="button" className="say" aria-label={tr("Lees voor")} onClick={() => { voiceOn = true; try { localStorage.setItem("gb.learn.voice", "1"); } catch { /* */ } bump((x) => x + 1); speak(say, true); }}>🔊</button>
      </div>
    </div>
  );
}
/** Sfeerfoto van Wikipedia bij een onderwerp. */
function Photo({ q, className = "" }: { q: string; className?: string }) {
  const [p, setP] = useState<{ url: string; title: string } | null | undefined>(undefined);
  useEffect(() => { let live = true; api.get<{ url: string; title: string } | null>(`/learn/photo?q=${encodeURIComponent(q)}`).then((r) => live && setP(r)).catch(() => live && setP(null)); return () => { live = false; }; }, [q]);
  if (!p) return null;
  return <img className={`learn-photo ${className}`} src={p.url} alt={p.title} loading="lazy" referrerPolicy="no-referrer" />;
}
type Subject = "islam" | "rekenen" | "spelen" | "taal" | "wereld";
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
  const islamOn = (data?.settings.holidays ?? "").split(",").includes("islam") || data?.settings.ezan_on === "1";
  const [groupOverride, setGroupOverride] = useState<Record<string, AgeGroup>>(() => { try { return JSON.parse(localStorage.getItem("gb.learn.group") || "{}"); } catch { return {}; } });
  const group: AgeGroup = (me && groupOverride[me.id]) || groupFor(me?.birthday);
  const setGroup = (g: AgeGroup) => { if (!me) return; const n = { ...groupOverride, [me.id]: g }; setGroupOverride(n); try { localStorage.setItem("gb.learn.group", JSON.stringify(n)); } catch { /* */ } };
  // onderwerpen per leeftijd: kleuters spelen met kleuren en dieren, lagere school leest en rekent, tieners talen en wetenschap; islam alleen als het pakket aanstaat
  const subjects: { id: Subject; icon: string; label: string }[] = [
    ...(group === "kleuter" ? [{ id: "spelen" as Subject, icon: "🧸", label: tr("Spelen") }] : []),
    ...(group !== "kleuter" ? [{ id: "rekenen" as Subject, icon: "🔢", label: tr("Rekenen") }] : []),
    ...(group !== "kleuter" ? [{ id: "taal" as Subject, icon: "📖", label: group === "tiener" ? tr("Talen") : tr("Lezen en Engels") }] : []),
    ...(group !== "kleuter" ? [{ id: "wereld" as Subject, icon: "🌍", label: tr("Wereld") }] : []),
    ...(islamOn ? [{ id: "islam" as Subject, icon: "🕌", label: tr("Islam") }] : []),
  ];
  const [subjectRaw, setSubject] = useState<Subject>(() => { try { return (localStorage.getItem("gb.learn.subject") as Subject) || "spelen"; } catch { return "spelen"; } });
  const subject: Subject = subjects.some((x) => x.id === subjectRaw) ? subjectRaw : subjects[0]?.id ?? "rekenen";
  const sets = SETS.filter((x) => x.group === group);
  const ageGames: { id: Game; subject: Subject; icon: string; color: string; title: Bi; sub: Bi }[] = [
    ...sets.map((x) => ({ id: `set:${x.id}` as Game, subject: (group === "kleuter" ? "spelen" : ["words", "spell", "english", "french", "english2"].includes(x.id) ? "taal" : "wereld") as Subject, icon: x.icon, color: x.color, title: x.title, sub: x.sub })),
    ...(group !== "kleuter" ? [{ id: "clock" as Game, subject: "rekenen" as Subject, icon: "🕒", color: "#6fb7ff", title: { nl: "Klok lezen", tr: "Saat okuma" }, sub: { nl: "Hoe laat is het?", tr: "Saat kaç?" } }] : []),
  ];
  const allGames = [...GAMES, ...ageGames];
  const currentSet: ChoiceSet | undefined = typeof game === "string" && game.startsWith("set:") ? SETS.find((x) => `set:${x.id}` === game) : undefined;
  const pickSubject = (x: Subject) => { setSubject(x); try { localStorage.setItem("gb.learn.subject", x); } catch { /* */ } };
  const [celebrate, setCelebrate] = useState<string | null>(null);
  const [earned, setEarned] = useState<{ given: number; today: number; dailyMax: number } | null>(null);
  useEffect(() => { if (me) { try { localStorage.setItem("gb.learn.who", me.id); } catch { /* */ } } }, [me]);
  // Op de telefoon vult een spel het hele scherm (geen kop, geen onderbalk), zodat niets hoeft te scrollen.
  useEffect(() => { document.body.classList.toggle("gb-kidsgame", !!game); return () => document.body.classList.remove("gb-kidsgame"); }, [game]);

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
  if (game === "clock") return <ClockGame onDone={(s) => finish("clock", s, me.name)} onClose={() => setGame(null)} />;
  if (currentSet) return <ChoiceGame key={currentSet.id} set={currentSet} onDone={(s) => finish(currentSet.id.replace(/[^a-z-]/g, "") as Game, s, me.name)} onClose={() => setGame(null)} />;

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
      <Mascot mood="idle" say={tr("Hoi {name}! Waar heb je zin in?", { name: me.name })} />
      {earned && <p className="hint learn-earned">{earned.given > 0 ? tr("+{n} sterren voor {name}! 🎉", { n: earned.given, name: me.name }) : tr("Goed gespeeld! Het dagmaximum voor dit spel is bereikt; morgen weer sterren.")}</p>}
      <div className="learn-age picks">
        {(Object.keys(GROUP_LABEL) as AgeGroup[]).map((g) => <button key={g} type="button" className="pick" aria-pressed={group === g} onClick={() => setGroup(g)}>{GROUP_LABEL[g].icon} {bi(GROUP_LABEL[g])}</button>)}
      </div>
      <div className="learn-subjects kid-tabs" role="group" aria-label={tr("Onderwerp")}>
        {subjects.map((x) => <button key={x.id} className={subject === x.id ? "on" : ""} aria-pressed={subject === x.id} onClick={() => pickSubject(x.id)}><span aria-hidden>{x.icon}</span> {x.label}</button>)}
      </div>
      <div className="learn-grid">
        {allGames.filter((g) => g.subject === subject).map((g) => (
          <button key={g.id} className="learn-tile kid" style={{ "--c": g.color } as React.CSSProperties} onClick={() => { setEarned(null); setGame(g.id); }}>
            <Illu e={g.icon} className="learn-ic big wiggle" />
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
        <button className="backbtn kid-back" onClick={onClose} aria-label={tr("Spelletjes")}><Icon.left /><span className="kid-back-txt"> {tr("Spelletjes")}</span></button>
        {icon && <Illu e={icon} className="learn-bar-ic bob" />}
        <b title={title}>{kidText(title)}</b>
        {progress !== undefined && (
          <span className="kid-progress" aria-hidden>
            <i style={{ width: `${Math.round(progress * 100)}%` }} />
            <span className="kid-progress-star" style={{ left: `calc(${Math.round(progress * 100)}% - 12px)` }}>⭐</span>
          </span>
        )}
      </div>
      <div className="learn-body">{children}</div>
    </div>
  );
}

function Result({ stars, max, onDone }: { stars: number; max: number; onDone: () => void }) {
  useEffect(() => { beep("win"); speak(stars === max ? tr("Alles juist! {s} sterren!", { s: stars }) : tr("Goed gedaan! {s} van {m} sterren.", { s: stars, m: max })); }, [stars, max]);
  return (
    <div className="learn-result kid-pop">
      <Burst />
      <Illu e="🥳" className="result-mascot" />
      <Illu e={stars === max ? "🏆" : stars >= max / 2 ? "🌟" : "💪"} className="learn-result-ic bounce" />
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
  const [tried, setTried] = useState<number[]>([]); // fout geprobeerde antwoorden van deze vraag
  const [solved, setSolved] = useState(false);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const open = (k: string | null) => { setTopic(k); setI(0); setTried([]); setSolved(false); setScore(0); setDone(false); };
  if (!topic) return (
    <GameShell title={tr("Weetjesquiz")} onClose={onClose}>
      <Mascot mood="idle" say={tr("Hoi! Kies een onderwerp, dan stel ik je vragen.")} />
      <div className="learn-grid">
        {Object.entries(TOPICS).map(([k, v], i) => <button key={k} className="learn-tile kid" style={{ "--c": ["#48d1c4", "#ffd34d", "#ff8a4c", "#b58cf0", "#ff6b9d", "#6fb7ff"][i % 6] } as React.CSSProperties} onClick={() => open(k)}><Illu e={v.icon} className="learn-ic big wiggle" /><Photo q={v.photo} className="tile-photo" /><b>{bi(v)}</b><small>{QUIZ.filter((q) => q.topic === k).length} {tr("vragen")}</small></button>)}
      </div>
    </GameShell>
  );
  if (done) return <GameShell title={tr("Weetjesquiz")} onClose={onClose}><Result stars={score} max={qs.length} onDone={() => onDone(score)} /></GameShell>;
  const q = qs[i];
  const answer = (k: number) => {
    if (solved || tried.includes(k)) return;
    if (k === q.answer) { setSolved(true); if (tried.length === 0) setScore((s) => s + 1); beep("good"); }
    else { setTried([...tried, k]); beep("bad"); }
  };
  const next = () => { if (i + 1 >= qs.length) setDone(true); else { setI(i + 1); setTried([]); setSolved(false); } };
  const say = solved ? (tried.length === 0 ? tr("Juist! Een ster voor jou!") : tr("Ja, dat is het! Goed gevonden.")) : tried.length ? tr("Oeps, bijna! Probeer nog eens.") : bi(q.q);
  return (
    <GameShell title={bi(TOPICS[topic])} icon={TOPICS[topic].icon} onClose={() => open(null)} progress={i / qs.length}>
      <Photo q={TOPICS[topic].photo} className="banner" />
      <Mascot mood={solved ? "happy" : tried.length ? "oops" : "ask"} say={say} />
      <div className="learn-q kid-card">
        {solved && <Burst />}
        <small>{tr("Vraag {i} van {n}", { i: i + 1, n: qs.length })}</small>
        <div className="kid-question"><Illu e={q.icon ?? TOPICS[topic].icon} className="kid-q-ic bob" /><h2>{bi(q.q)}</h2></div>
        <div className="learn-options pics">
          {q.options.map((o, k) => {
            const state = solved ? (k === q.answer ? " right" : " dim") : tried.includes(k) ? " wrong dim" : tried.length && k === tried[tried.length - 1] ? " shake" : "";
            return <button key={k} className={`learn-opt pic${state}`} style={{ "--c": ["#ffd34d", "#48d1c4", "#ff8a4c", "#b58cf0"][k % 4] } as React.CSSProperties} onClick={() => answer(k)} disabled={solved || tried.includes(k)}><Illu e={q.optionIcons?.[k] ?? "⬜"} className="opt-ic" /><span>{kidText(bi(o))}</span></button>;
          })}
        </div>
        {solved && q.why && <p className="learn-feedback good">{bi(q.why)}</p>}
        {solved && <button className="btn kid-next" onClick={next}>{i + 1 >= qs.length ? tr("Klaar") + " 🎉" : tr("Volgende vraag") + " ➜"}</button>}
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
                  {up ? <>{c.icon && <Illu e={c.icon} className="mcard-ic" />}{c.txt.split("\n").map((l, i) => <span key={i} lang={c.ar && i === 0 ? "ar" : undefined} dir={c.ar && i === 0 ? "rtl" : undefined}>{l}</span>)}</> : <Illu e={["🌙", "⭐", "🕌", "📖", "🌸", "🐪"][ci % 6]} className="mcard-back" />}
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
      <Mascot mood="idle" say={tr("Tik de stappen aan in de juiste volgorde.")} />
      <div className="learn-grid">{ORDERS.map((o, k) => <button key={k} className="learn-tile kid" style={{ "--c": ["#6fb7ff", "#ffd34d", "#48d1c4", "#b58cf0", "#ff8a4c"][k % 5] } as React.CSSProperties} onClick={() => start(k)}><Illu e={o.icon} className="learn-ic big wiggle" /><Photo q={o.photo} className="tile-photo" /><b>{bi(o.title)}</b><small>{o.steps.length} {tr("stappen")}</small></button>)}</div>
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
          <Photo q={order.photo} className="banner" />
          <Mascot mood={mistakes && shakeId !== null ? "oops" : placed.length ? "happy" : "ask"} say={shakeId !== null ? tr("Oeps, bijna! Probeer nog eens.") : placed.length === 0 ? tr("Wat doen we eerst?") : tr("Wat komt nu?")} />
          <div className="order-path">
            {order.steps.map((_, k) => {
              const done = k < placed.length;
              return (
                <div key={k} className={`path-step${done ? " done kid-pop" : k === placed.length ? " next" : ""}`}>
                  <span className="path-n">{k + 1}</span>
                  {done ? <Illu e={order.icons[k]} className="path-ic" /> : <span className="path-ic" aria-hidden>{k === placed.length ? "❓" : "·"}</span>}
                  {done && <small>{kidText(bi(order.steps[k]))}</small>}
                </div>
              );
            })}
          </div>
          <div className="order-pool pics">{pool.map((i) => <button key={i} className={`learn-opt pic${shakeId === i ? " wrong shake" : ""}`} style={{ "--c": ["#ffd34d", "#48d1c4", "#ff8a4c", "#b58cf0", "#6fb7ff", "#ff6b9d"][i % 6] } as React.CSSProperties} onClick={() => pick(i)}><Illu e={order.icons[i]} className="opt-ic" /><span>{kidText(bi(order.steps[i]))}</span></button>)}</div>
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
      <div className="learn-grid">{SURAHS.map((s, k) => <button key={s.n} className="learn-tile kid" style={{ "--c": ["#8ed081", "#ffd34d", "#48d1c4", "#6fb7ff", "#ff8a4c", "#b58cf0", "#ff6b9d"][k % 7] } as React.CSSProperties} onClick={() => setWhich(s.n)}><Illu e={["🌅", "☝️", "🌄", "👥", "🏞️", "⏳", "🏁"][k % 7]} className="learn-ic big wiggle" /><b>{bi(s.name)}</b><small>{tr("soera")} {s.n}</small></button>)}</div>
    </GameShell>
  );
  const complete = !!surah && heard.size >= surah.ayahs.length;
  return (
    <GameShell title={info ? bi(info.name) : ""} icon="🐦" onClose={() => { audio.pause(); setWhich(null); }} progress={surah ? heard.size / surah.ayahs.length : 0}>
      {info && <Photo q={info.photo} className="banner" />}
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

const OPWORD: Record<Op, Bi> = { "+": { nl: "plus", tr: "artı" }, "−": { nl: "min", tr: "eksi" }, "×": { nl: "keer", tr: "çarpı" }, "÷": { nl: "gedeeld door", tr: "bölü" } };
const FRUIT = ["🍎", "🍓", "🍊", "🍇", "🐟", "⭐", "🧁", "🐥"];
function Objects({ n, icon }: { n: number; icon: string }) {
  return <span className="objs" aria-hidden>{Array.from({ length: n }, (_, i) => <span key={i} style={{ animationDelay: `${i * 0.04}s` }}><Illu e={icon} className="obj" /></span>)}</span>;
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
      <Mascot mood={picked === null ? "ask" : picked === sum.answer ? "happy" : "oops"} say={picked === null ? `${sum.a} ${OPWORD[sum.op][getLang() === "tr" ? "tr" : "nl"]} ${sum.b}?` : picked === sum.answer ? tr("Juist! Een ster voor jou!") : tr("Bijna! Het juiste antwoord is {n}.", { n: sum.answer })} />
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
      <div className="learn-grid">{LEVELS.map((l, k) => <button key={l.id} className="learn-tile kid" style={{ "--c": ["#8ed081", "#48d1c4", "#6fb7ff", "#b58cf0", "#ff8a4c"][k % 5] } as React.CSSProperties} onClick={() => start(l)}><Illu e={["🐣", "🐤", "🐥", "🦜", "🦅"][k % 5]} className="learn-ic big wiggle" /><b>{bi(l.title)}</b><small>{"⭐".repeat(Math.min(3, Math.ceil(l.id / 2)))}</small></button>)}</div>
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
      <div className="learn-grid tables-grid">{Array.from({ length: 10 }, (_, k) => k + 1).map((n) => <button key={n} className="learn-tile kid small" style={{ "--c": ["#ffd34d", "#48d1c4", "#ff8a4c", "#b58cf0", "#6fb7ff", "#8ed081", "#ff6b9d", "#ffb75e", "#5ad1c9", "#c9a24a"][n - 1] } as React.CSSProperties} onClick={() => start(n)}><Illu e={["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"][n - 1]} className="learn-ic big" /><b>{tr("Tafel van {n}", { n })}</b></button>)}</div>
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
      <div className="learn-result kid-pop"><Illu e="🚀" className="learn-result-ic bounce" /><b>{tr("60 seconden")}</b><p>{tr("Zoveel mogelijk sommen tot 20. Elke twee juiste = een ster (max. 10).")}</p><button className="btn" onClick={() => { setRunning(true); setLeft(60); setScore(0); setTries(0); setSum(makeSum(20, ["+", "−"])); }}>{tr("Start!")}</button></div>
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

/* ---------- Keuzespel per leeftijd: kleuren, dieren, tellen, vormen, lezen, spelling, Engels, Frans, wereld, wetenschap ---------- */
function ChoiceGame({ set, onDone, onClose }: { set: ChoiceSet; onDone: (stars: number) => void; onClose: () => void }) {
  const qs = useMemo(() => set.make(), [set]);
  const [i, setI] = useState(0);
  const [tried, setTried] = useState<number[]>([]);
  const [solved, setSolved] = useState(false);
  const [score, setScore] = useState(0);
  const q = qs[i];
  useEffect(() => { if (q?.speak) speak(bi(q.prompt), true); }, [q]);
  if (!q) return <GameShell title={bi(set.title)} onClose={onClose}><Result stars={score} max={qs.length} onDone={() => onDone(score)} /></GameShell>;
  const answer = (k: number) => {
    if (solved || tried.includes(k)) return;
    if (k === q.answer) { setSolved(true); if (tried.length === 0) setScore((s) => s + 1); beep("good"); speak(bi(q.options[k])); }
    else { setTried([...tried, k]); beep("bad"); }
  };
  const next = () => { setI(i + 1); setTried([]); setSolved(false); };
  const say = solved ? (tried.length === 0 ? tr("Juist! Een ster voor jou!") : tr("Ja, dat is het! Goed gevonden.")) : tried.length ? tr("Oeps, bijna! Probeer nog eens.") : bi(q.prompt);
  const manyIcons = (q.promptIcon?.length ?? 0) > 4;
  return (
    <GameShell title={bi(set.title)} icon={set.icon} onClose={onClose} progress={i / qs.length}>
      <Mascot mood={solved ? "happy" : tried.length ? "oops" : "ask"} say={say} />
      <div className="learn-q kid-card">
        {solved && <Burst />}
        <small>{tr("Vraag {i} van {n}", { i: i + 1, n: qs.length })}</small>
        <div className="kid-question">{q.promptIcon && (manyIcons ? <div className="kid-count" aria-hidden>{q.promptIcon}</div> : <Illu e={q.promptIcon} className={`kid-q-ic bob${q.big ? " huge" : ""}`} />)}<h2>{bi(q.prompt)}</h2><button className="iconbtn kid-say" aria-label={tr("Lees voor")} onClick={() => speak(bi(q.prompt), true)}>🔊</button></div>
        <div className={`learn-options${q.optionIcons ? " pics" : " words"}`}>
          {q.options.map((o, k) => {
            const state = solved ? (k === q.answer ? " right" : " dim") : tried.includes(k) ? " wrong dim" : tried.length && k === tried[tried.length - 1] ? " shake" : "";
            return <button key={k} className={`learn-opt${q.optionIcons ? " pic" : " word"}${state}`} style={{ "--c": ["#ffd34d", "#48d1c4", "#ff8a4c", "#b58cf0"][k % 4] } as React.CSSProperties} onClick={() => answer(k)} disabled={solved || tried.includes(k)}>{q.optionIcons?.[k] && <Illu e={q.optionIcons[k]} className="opt-ic" />}{q.optionIcons?.[k] !== bi(o) && <span className={q.optionIcons ? "opt-txt" : undefined}>{bi(o)}</span>}</button>;
          })}
        </div>
        {solved && <button className="btn kid-next" onClick={next}>{i + 1 >= qs.length ? tr("Klaar") + " 🎉" : tr("Volgende vraag") + " ➜"}</button>}
      </div>
    </GameShell>
  );
}

/* ---------- Klok lezen ---------- */
function ClockFace({ h, m }: { h: number; m: number }) {
  const ha = ((h % 12) + m / 60) * 30, ma = m * 6;
  const hand = (deg: number, len: number, w: number) => <line x1="50" y1="50" x2={50 + len * Math.sin((deg * Math.PI) / 180)} y2={50 - len * Math.cos((deg * Math.PI) / 180)} stroke="#1e2632" strokeWidth={w} strokeLinecap="round" />;
  return (
    <svg viewBox="0 0 100 100" className="kid-clock-face" aria-hidden>
      <circle cx="50" cy="50" r="46" fill="#fff" stroke="#ffd34d" strokeWidth="5" />
      {Array.from({ length: 12 }, (_, i) => { const a = (i * 30 * Math.PI) / 180; return <text key={i} x={50 + 37 * Math.sin(a)} y={50 - 37 * Math.cos(a) + 3.5} textAnchor="middle" fontSize="9" fontWeight="700" fill="#1e2632">{i === 0 ? 12 : i}</text>; })}
      {hand(ha, 22, 5)}{hand(ma, 32, 3)}<circle cx="50" cy="50" r="3" fill="#ff8a4c" />
    </svg>
  );
}
function ClockGame({ onDone, onClose }: { onDone: (stars: number) => void; onClose: () => void }) {
  const [level, setLevel] = useState<1 | 2 | 3 | null>(null);
  const [qs, setQs] = useState<ReturnType<typeof clockQuestions>>([]);
  const [i, setI] = useState(0); const [score, setScore] = useState(0); const [tried, setTried] = useState<number[]>([]); const [solved, setSolved] = useState(false);
  const start = (l: 1 | 2 | 3) => { setLevel(l); setQs(clockQuestions(l)); setI(0); setScore(0); setTried([]); setSolved(false); };
  if (!level) return (
    <GameShell title={tr("Klok lezen")} icon="🕒" onClose={onClose}>
      <p className="hint">{tr("Hoe laat is het op de klok? Kies hoe moeilijk.")}</p>
      <div className="learn-grid">{([[1, "Hele uren", "Tam saatler", "🐣"], [2, "Halve uren", "Buçuklar", "🐤"], [3, "Kwartieren", "Çeyrekler", "🦆"]] as const).map(([l, nl, trr, ic], k) => <button key={l} className="learn-tile kid" style={{ "--c": ["#8ed081", "#48d1c4", "#6fb7ff"][k] } as React.CSSProperties} onClick={() => start(l)}><Illu e={ic} className="learn-ic big wiggle" /><b>{bi({ nl, tr: trr })}</b></button>)}</div>
    </GameShell>
  );
  const q = qs[i];
  if (!q) return <GameShell title={tr("Klok lezen")} onClose={onClose}><Result stars={score} max={qs.length} onDone={() => onDone(score)} /></GameShell>;
  const answer = (k: number) => { if (solved || tried.includes(k)) return; if (k === q.answer) { setSolved(true); if (!tried.length) setScore((s) => s + 1); beep("good"); } else { setTried([...tried, k]); beep("bad"); } };
  return (
    <GameShell title={tr("Klok lezen")} icon="🕒" onClose={() => setLevel(null)} progress={i / qs.length}>
      <Mascot mood={solved ? "happy" : tried.length ? "oops" : "ask"} say={solved ? tr("Juist! Een ster voor jou!") : tried.length ? tr("Oeps, bijna! Probeer nog eens.") : tr("Hoe laat is het?")} />
      <div className="learn-q kid-card">
        {solved && <Burst />}
        <small>{tr("Vraag {i} van {n}", { i: i + 1, n: qs.length })}</small>
        <ClockFace h={q.h} m={q.m} />
        <div className="learn-options words">
          {q.options.map((o, k) => { const state = solved ? (k === q.answer ? " right" : " dim") : tried.includes(k) ? " wrong dim" : ""; return <button key={k} className={`learn-opt word num${state}`} onClick={() => answer(k)} disabled={solved || tried.includes(k)}>{o.replace(":00", " uur").replace(":30", " uur 30").replace(":15", " uur 15").replace(":45", " uur 45")}</button>; })}
        </div>
        {solved && <button className="btn kid-next" onClick={() => { setI(i + 1); setTried([]); setSolved(false); }}>{i + 1 >= qs.length ? tr("Klaar") + " 🎉" : tr("Volgende vraag") + " ➜"}</button>}
      </div>
    </GameShell>
  );
}
