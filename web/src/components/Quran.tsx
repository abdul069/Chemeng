import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useAction, useData } from "../store";
import type { Surah, SurahInfo } from "../types";
import { player, setSurahLoader, usePlayer } from "../islam";
import { Icon } from "./Icons";

const cache = new Map<string, Promise<Surah>>();
const loadSurah = (n: number, translation: string) => {
  const k = `${n}:${translation}`;
  if (!cache.has(k)) cache.set(k, api.get<Surah>(`/quran/surah/${n}?translation=${encodeURIComponent(translation)}`).catch((e) => { cache.delete(k); throw e; }));
  return cache.get(k)!;
};
const fold = (s: string) => s.toLocaleLowerCase("nl").normalize("NFD").replace(/[̀-ͯ]/g, "");
const LAST_KEY = "gezinsbord.quran.last";

/** Koran: lezen (Arabisch + vertaling), luisteren en meevolgen, en op de achtergrond verder luisteren. */
export function QuranApp() {
  const { data } = useData();
  const act = useAction();
  const s = data!.settings;
  const [meta, setMeta] = useState<{ surahs: SurahInfo[]; reciters: { id: string; label: string }[]; translations: { id: string; label: string }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(() => { try { const v = localStorage.getItem(LAST_KEY); return v ? Number(v) : null; } catch { return null; } });
  const [surah, setSurah] = useState<Surah | null>(null);
  const [showTr, setShowTr] = useState(true);
  const [size, setSize] = useState(() => { try { return Number(localStorage.getItem("gezinsbord.quran.size") || 30); } catch { return 30; } });
  const p = usePlayer();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { api.get<typeof meta>("/quran/surahs").then(setMeta).catch((e) => setErr(e instanceof Error ? e.message : "Laden mislukt")); }, []);
  useEffect(() => { player.set({ reciter: s.quran_reciter }); }, [s.quran_reciter]);
  useEffect(() => { setSurahLoader((n) => (n <= 114 ? loadSurah(n, s.quran_translation) : Promise.resolve(null))); }, [s.quran_translation]);
  useEffect(() => {
    if (open == null) { setSurah(null); return; }
    try { localStorage.setItem(LAST_KEY, String(open)); } catch { /* */ }
    let live = true;
    setSurah(p.surah?.number === open && p.surah.translationId === s.quran_translation ? p.surah : null);
    loadSurah(open, s.quran_translation).then((x) => live && setSurah(x)).catch((e) => live && setErr(e instanceof Error ? e.message : "Laden mislukt"));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, s.quran_translation]);
  // meevolgen: het spelende vers in beeld houden
  useEffect(() => {
    if (!p.follow || !p.surah || p.surah.number !== surah?.number) return;
    listRef.current?.querySelector<HTMLElement>(`[data-i="${p.index}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [p.index, p.follow, p.surah, surah?.number]);
  // als de speler naar de volgende soera gaat, mee openen
  useEffect(() => { if (p.surah && p.playing && open != null && p.surah.number !== open && p.follow) setOpen(p.surah.number); }, [p.surah, p.playing, open, p.follow]);

  const filtered = useMemo(() => {
    const list = meta?.surahs ?? [];
    const f = fold(q.trim());
    if (!f) return list;
    return list.filter((x) => String(x.number) === f || fold(x.englishName).includes(f) || fold(x.englishNameTranslation).includes(f) || x.name.includes(q.trim()));
  }, [meta, q]);

  const save = (values: Record<string, string>, msg: string) => act(() => api.put("/settings", values), msg);
  const setSize2 = (n: number) => { setSize(n); try { localStorage.setItem("gezinsbord.quran.size", String(n)); } catch { /* */ } };

  if (err && !meta) return <p className="empty">{err}<br /><small>De Koran-tekst komt van alquran.cloud; het scherm heeft internet nodig voor de eerste keer.</small></p>;

  if (open != null) {
    const isThis = p.surah?.number === open;
    return (
      <div className="quran">
        <div className="quran-bar">
          <button className="backbtn" onClick={() => setOpen(null)}><Icon.left /> Soera's</button>
          {surah && <span className="quran-title"><b>{surah.number}. {surah.englishName}</b><small>{surah.englishNameTranslation} · {surah.numberOfAyahs} verzen · {surah.revelationType === "Meccan" ? "Mekkaans" : "Medinisch"}</small></span>}
          <span className="quran-tools">
            <button className="pill" onClick={() => setShowTr(!showTr)} aria-pressed={showTr}>{showTr ? "Vertaling aan" : "Alleen Arabisch"}</button>
            <span className="seg" role="group" aria-label="Lettergrootte"><button onClick={() => setSize2(Math.max(22, size - 4))} aria-label="Kleiner">A−</button><button onClick={() => setSize2(Math.min(54, size + 4))} aria-label="Groter">A+</button></span>
            <label className="check-row" title="Het spelende vers oplichten en in beeld houden"><input type="checkbox" checked={p.follow} onChange={(e) => player.set({ follow: e.target.checked })} /> Meevolgen</label>
          </span>
        </div>
        {!surah && <p className="empty">Soera laden…</p>}
        {surah && (
          <div className="quran-read" ref={listRef} style={{ "--ar": `${size}px` } as React.CSSProperties}>
            {surah.number !== 1 && surah.number !== 9 && <p className="basmala" lang="ar" dir="rtl">بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ</p>}
            {surah.ayahs.map((a, i) => {
              const cur = isThis && p.index === i;
              return (
                <button key={a.number} data-i={i} className={`ayah${cur ? " playing" : ""}`} onClick={() => (cur ? player.toggle() : player.play(surah, i))} title={cur ? (p.playing ? "Pauzeren" : "Verder") : "Vanaf hier luisteren"}>
                  <span className="ayah-ar" lang="ar" dir="rtl">{surah.number !== 1 && i === 0 ? a.text.replace(/^بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ\s*/, "") : a.text} <span className="ayah-n">{toArabicNum(a.numberInSurah)}</span></span>
                  {showTr && <span className="ayah-tr"><small>{a.numberInSurah}</small> {a.translation}</span>}
                </button>
              );
            })}
            <div className="quran-foot">
              {surah.number < 114 && <button className="btn ghost" onClick={() => setOpen(surah.number + 1)}>Volgende soera →</button>}
            </div>
          </div>
        )}
        {surah && (
          <div className="quran-ctl">
            <button className="iconbtn" onClick={() => player.prev()} aria-label="Vorig vers" disabled={!isThis}>⏮</button>
            <button className="btn quran-play" onClick={() => (isThis ? player.toggle() : player.play(surah, 0))}>{isThis && p.playing ? "❚❚ Pauze" : isThis ? "▶ Verder" : "▶ Luisteren"}</button>
            <button className="iconbtn" onClick={() => player.next()} aria-label="Volgend vers" disabled={!isThis}>⏭</button>
            <label className="check-row"><input type="checkbox" checked={p.repeat} onChange={(e) => player.set({ repeat: e.target.checked })} /> Vers herhalen</label>
            <label className="check-row"><input type="checkbox" checked={p.continueNext} onChange={(e) => player.set({ continueNext: e.target.checked })} /> Doorlopen naar volgende soera</label>
            <span className="hint" style={{ marginLeft: "auto" }}>Het luisteren loopt door als je naar een ander scherm gaat.</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="quran">
      <div className="quran-bar">
        <label className="appsearch glass" style={{ flex: 1, maxWidth: 420 }}><Icon.search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek een soera (naam of nummer)" aria-label="Zoek een soera" /></label>
        <label className="field" style={{ minWidth: 200 }}><span>Voordrager</span>
          <select value={s.quran_reciter} onChange={(e) => save({ quran_reciter: e.target.value }, "Voordrager gewijzigd")}>{(meta?.reciters ?? []).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
        </label>
        <label className="field" style={{ minWidth: 200 }}><span>Vertaling</span>
          <select value={s.quran_translation} onChange={(e) => save({ quran_translation: e.target.value }, "Vertaling gewijzigd")}>{(meta?.translations ?? []).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
        </label>
      </div>
      {p.surah && <button className="quran-resume glass" onClick={() => setOpen(p.surah!.number)}>▶ Verder met {p.surah.englishName}, vers {p.index + 1}</button>}
      <div className="page-scroll" style={{ flex: 1, minHeight: 0 }}>
        {!meta && !err && <p className="empty">Soera's laden…</p>}
        <div className="surahs">
          {filtered.map((x) => (
            <button key={x.number} className={`surah${p.surah?.number === x.number ? " on" : ""}`} onClick={() => setOpen(x.number)}>
              <span className="surah-n num">{x.number}</span>
              <span className="surah-txt"><b>{x.englishName}</b><small>{x.englishNameTranslation} · {x.numberOfAyahs} verzen</small></span>
              <span className="surah-ar" lang="ar" dir="rtl">{x.name.replace(/^سُورَةُ\s*/, "")}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const toArabicNum = (n: number) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);

/** Kleine speler onderaan als de Koran op de achtergrond speelt. */
export function QuranMiniPlayer({ onOpen }: { onOpen: () => void }) {
  const p = usePlayer();
  if (!p.surah) return null;
  const a = p.surah.ayahs[p.index];
  return (
    <div className="miniplayer glass" role="region" aria-label="Koran-speler">
      <button className="miniplayer-txt" onClick={onOpen}><b>{p.surah.englishName} · vers {a.numberInSurah}/{p.surah.numberOfAyahs}</b><small>{a.translation.slice(0, 90)}{a.translation.length > 90 ? "…" : ""}</small></button>
      <button className="iconbtn" onClick={() => player.prev()} aria-label="Vorig vers">⏮</button>
      <button className="iconbtn" onClick={() => player.toggle()} aria-label={p.playing ? "Pauzeren" : "Verder"}>{p.playing ? "❚❚" : "▶"}</button>
      <button className="iconbtn" onClick={() => player.next()} aria-label="Volgend vers">⏭</button>
      <button className="iconbtn" onClick={() => player.stop()} aria-label="Stoppen"><Icon.close /></button>
    </div>
  );
}
