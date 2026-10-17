import { useEffect, useRef, useState } from "react";
import { api, photoUrl } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { EzanSound, Prayer, PrayerDay } from "../types";
import { EZAN_PRAYERS, PRAYER_ICON, PRAYER_NAME, PRAYER_ORDER, PRAYER_TR, hijri, hm, nextPrayer, untilText } from "../islam";
import { Icon } from "./Icons";
import { Confirm } from "./ui";
import { cap, longDate, todayIso } from "../dates";
import { t as tr } from "../i18n";

const DEVICE_KEY = "gezinsbord.ezan.device";
export const ezanOnThisDevice = () => { try { return localStorage.getItem(DEVICE_KEY) !== "0"; } catch { return true; } };

/** Gebedstijden van vandaag, met de ezan-instellingen eronder. */
export function PrayerApp() {
  const { data, toast } = useData();
  const act = useAction();
  const s = data!.settings;
  const [day] = useRemote<PrayerDay | null>("/prayer", ["settings"], null);
  const [sounds, reloadSounds] = useRemote<EzanSound[]>("/ezan/sounds", ["ezan"], []);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);
  const save = (values: Record<string, string>, msg = "Bewaard") => act(() => api.put("/settings", values), msg);
  const [device, setDevice] = useState(ezanOnThisDevice);
  const [del, setDel] = useState<EzanSound | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<HTMLAudioElement | null>(null);

  const nxt = nextPrayer(day, now);
  const on = s.ezan_on === "1";
  const chosen = new Set(s.ezan_prayers.split(",").filter(Boolean));
  const soundOf: Record<string, string> = (() => { try { return JSON.parse(s.ezan_sounds); } catch { return {}; } })();
  const adjust: Record<string, number> = (() => { try { return JSON.parse(s.ezan_adjust); } catch { return {}; } })();
  const admin = data!.me.role === "beheerder";

  const upload = async (fl: FileList | null) => {
    if (!fl?.[0]) return;
    setBusy(true);
    const fd = new FormData(); fd.append("audio", fl[0]); fd.append("name", fl[0].name.replace(/\.[a-z0-9]+$/i, ""));
    await act(() => api.post("/ezan/sounds", fd), tr("Ezan toegevoegd"));
    setBusy(false); reloadSounds();
  };
  const fromUrl = async () => {
    if (!url.trim()) return;
    setBusy(true);
    const r = await act(() => api.post("/ezan/sounds/url", { url: url.trim() }), tr("Ezan opgehaald en bewaard"));
    setBusy(false); if (r) { setUrl(""); reloadSounds(); }
  };
  const listen = (snd: EzanSound | null) => {
    preview?.pause();
    if (!snd) { setPreview(null); return; }
    const a = new Audio(photoUrl(snd.filename)); a.volume = Number(s.ezan_volume) / 100; a.play().catch(() => toast(tr("Afspelen lukte niet. Tik eerst ergens op het scherm.")));
    setPreview(a);
  };
  const pick = (p: Prayer, id: string) => save({ ezan_sounds: JSON.stringify({ ...soundOf, [p]: id }) }, tr("Ezan voor {p} ingesteld", { p: PRAYER_NAME[p] }));
  const togglePrayer = (p: Prayer) => { const n = new Set(chosen); if (n.has(p)) n.delete(p); else n.add(p); save({ ezan_prayers: EZAN_PRAYERS.filter((x) => n.has(x)).join(",") }); };
  const bump = (p: Prayer, d: number) => save({ ezan_adjust: JSON.stringify({ ...adjust, [p]: Math.max(-30, Math.min(30, (adjust[p] ?? 0) + d)) }) }, "Bijgesteld");

  return (
    <div className="page-scroll" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 14 }}>
      <section className="card card-pad prayer-head">
        <div className="prayer-next">
          <small>{cap(longDate(todayIso()))} · {hijri()}</small>
          {nxt ? <><b>{PRAYER_ICON[nxt.prayer]} {PRAYER_NAME[nxt.prayer]} <span className="muted" style={{ fontWeight: 500 }}>({PRAYER_TR[nxt.prayer]})</span></b><span className="prayer-when num">{hm(new Date(nxt.at).toISOString())} <small>{untilText(nxt.at - now)}{nxt.tomorrow ? tr(" · morgen") : ""}</small></span></> : <b>{tr("Gebedstijden laden…")}</b>}
          <small>{day?.city} · {day?.methods.find((m) => m.id === s.ezan_method)?.label ?? s.ezan_method}{s.ezan_asr === "hanafi" ? tr(" · asr volgens Hanafi") : ""}</small>
        </div>
        {day && (
          <div className="prayer-row">
            {PRAYER_ORDER.map((p) => {
              const t = new Date(day.times[p]).getTime();
              const past = t < now;
              const isNext = nxt && !nxt.tomorrow && nxt.prayer === p;
              return (
                <div key={p} className={`prayer-cell${past ? tr(" past") : ""}${isNext ? tr(" next") : ""}`}>
                  <span className="prayer-ic" aria-hidden>{PRAYER_ICON[p]}</span>
                  <b>{tr(PRAYER_NAME[p])}</b>
                  <small>{PRAYER_TR[p]}</small>
                  <span className="num prayer-t">{hm(day.times[p])}</span>
                  {p !== "sunrise" && on && chosen.has(p) && <span className="prayer-bell" title={tr("Ezan klinkt")}>🔔</span>}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="section-title" style={{ marginBottom: 0 }}><h2>{tr("Ezan")}</h2>
          <label className="switch"><input type="checkbox" checked={on} onChange={(e) => save({ ezan_on: e.target.checked ? "1" : "0" }, e.target.checked ? tr("Ezan staat aan") : tr("Ezan staat uit"))} /><span /> {on ? tr("Aan") : tr("Uit")}</label>
        </div>
        <p className="hint">{tr("Als de ezan aanstaat, klinkt op elk scherm van het gezin de oproep op de gebedstijd. Je kiest hieronder welke gebeden en welk geluid. Zet het per scherm uit als bv. een telefoon stil moet blijven.")}</p>
        <label className="check-row"><input type="checkbox" checked={device} onChange={(e) => { setDevice(e.target.checked); try { localStorage.setItem(DEVICE_KEY, e.target.checked ? "1" : "0"); } catch { /* */ } }} />{" "}{tr("Ezan laten horen op dit scherm")}</label>
        <div className="row2">
          <label className="field"><span>{tr("Rekenmethode")}</span>
            <select value={s.ezan_method} onChange={(e) => save({ ezan_method: e.target.value }, "Rekenmethode gewijzigd")} disabled={!admin}>
              {(day?.methods ?? [{ id: s.ezan_method, label: s.ezan_method }]).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <label className="field"><span>{tr("Asr-berekening")}</span>
            <select value={s.ezan_asr} onChange={(e) => save({ ezan_asr: e.target.value })} disabled={!admin}>
              <option value="standard">{tr("Standaard (Shafi'i, Maliki, Hanbali, Diyanet)")}</option>
              <option value="hanafi">{tr("Hanafi (later)")}</option>
            </select>
          </label>
        </div>
        <label className="field"><span>{tr("Volume")}: {s.ezan_volume}%</span><input type="range" min={10} max={100} step={5} value={s.ezan_volume} onChange={(e) => save({ ezan_volume: e.target.value }, "Volume bewaard")} /></label>
      </section>

      <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="section-title" style={{ marginBottom: 0 }}><h2>{tr("Per gebed")}</h2><span className="hint">{tr("welke ezan klinkt, en minuten bijstellen")}</span></div>
        {EZAN_PRAYERS.map((p) => (
          <div className="prayer-pref" key={p}>
            <label className="check-row prayer-pref-h"><input type="checkbox" checked={chosen.has(p)} onChange={() => togglePrayer(p)} /> <b>{PRAYER_ICON[p]} {PRAYER_NAME[p]}</b> <span className="muted">{PRAYER_TR[p]}{day ? ` · ${hm(day.times[p])}` : ""}</span></label>
            <select value={soundOf[p] ?? ""} onChange={(e) => pick(p, e.target.value)} aria-label={tr("Ezan voor {p}", { p: PRAYER_NAME[p] })} disabled={!admin}>
              <option value="">{tr("Standaard (eerste geluid uit de lijst)")}</option>
              {sounds.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              <option value="chime">{tr("Zacht belletje")}</option>
              <option value="silent">{tr("Stil (alleen melding op het scherm)")}</option>
            </select>
            <span className="prayer-adj">
              <button className="iconbtn" onClick={() => bump(p, -1)} aria-label={tr("Een minuut vroeger")} disabled={!admin}>−</button>
              <span className="num">{(adjust[p] ?? 0) > 0 ? "+" : ""}{adjust[p] ?? 0} min</span>
              <button className="iconbtn" onClick={() => bump(p, 1)} aria-label={tr("Een minuut later")} disabled={!admin}>+</button>
            </span>
          </div>
        ))}
      </section>

      <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="section-title" style={{ marginBottom: 0 }}><h2>{tr("Ezan-geluiden")}</h2><span className="hint">{sounds.length} in de bibliotheek</span></div>
        <p className="hint">{tr("Voeg je favoriete ezan toe als mp3: upload een bestand of plak een link (bv. van een moskee- of Diyanet-site). De server bewaart het geluid, zodat het ook speelt als de link later verdwijnt.")}</p>
        <div className="upnext">
          {sounds.map((x) => (
            <div className="item" key={x.id}>
              <button className="iconbtn" onClick={() => listen(preview && !preview.paused && preview.src.endsWith(encodeURIComponent(x.filename)) ? null : x)} aria-label={tr("Beluisteren")}><Icon.play /></button>
              <span style={{ flex: 1, minWidth: 0 }}><b>{x.name}</b><small className="muted" style={{ display: "block" }}>{EZAN_PRAYERS.filter((p) => soundOf[p] === x.id).map((p) => PRAYER_NAME[p]).join(", ") || (sounds[0]?.id === x.id ? "standaard" : "")}</small></span>
              {admin && <button className="iconbtn" onClick={() => setDel(x)} aria-label={tr("Verwijderen")}><Icon.trash /></button>}
            </div>
          ))}
          {!sounds.length && <p className="empty">{tr("Nog geen ezan toegevoegd. Zonder geluid klinkt een zacht belletje.")}</p>}
        </div>
        {admin && <EzanSearch onSaved={() => reloadSounds()} volume={Number(s.ezan_volume) / 100} />}
        {admin && (
          <>
            <p className="hint" style={{ marginTop: 4 }}>{tr("Of zelf toevoegen: plak een link naar een mp3 of kies een bestand van dit toestel.")}</p>
            <div className="addrow">
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={tr("https://… /ezan.mp3")} aria-label={tr("Link naar een ezan-bestand")} />
              <button className="btn ghost" onClick={fromUrl} disabled={busy || !url.trim()}>{busy ? tr("Bezig…") : tr("Ophalen")}</button>
              <button className="btn ghost" onClick={() => file.current?.click()} disabled={busy}><Icon.upload />{" "}{tr("Bestand")}</button>
              <input ref={file} type="file" accept="audio/*" hidden onChange={(e) => upload(e.target.files)} />
            </div>
          </>
        )}
      </section>
      {del && <Confirm title={tr("{n} verwijderen?", { n: del.name })} onClose={() => setDel(null)} actions={[{ label: tr("Verwijderen"), run: async () => { await act(() => api.del(`/ezan/sounds/${del.id}`), tr("Verwijderd")); reloadSounds(); } }]} />}
    </div>
  );
}

const PRESETS = ["Mekke ezanı", "Medine ezanı", "İstanbul ezan", "Diyanet ezan", "Sabah ezanı", "adhan makkah", "adhan madinah", "adhan Mishary Alafasy"];

/** Online zoeken naar ezan-opnames, beluisteren en bewaren in de bibliotheek. */
function EzanSearch({ onSaved, volume }: { onSaved: () => void; volume: number }) {
  const act = useAction();
  const { toast } = useData();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; title: string; url: string; size: number; source: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [playing, setPlaying] = useState<{ url: string; a: HTMLAudioElement } | null>(null);
  const search = async (term: string) => {
    setQ(term); setBusy(true); setHits(null);
    const r = await act(() => api.get<typeof hits>(`/ezan/search?q=${encodeURIComponent(term)}`));
    setHits(r ?? []); setBusy(false);
  };
  const preview = (url: string) => {
    if (playing?.url === url) { playing.a.pause(); setPlaying(null); return; }
    playing?.a.pause();
    const a = new Audio(url); a.volume = volume; a.play().catch(() => toast("Afspelen lukte niet; probeer een andere opname."));
    a.addEventListener("ended", () => setPlaying((p) => (p?.url === url ? null : p)));
    setPlaying({ url, a });
  };
  const save = async (h: { title: string; url: string }) => {
    setSaving(h.url);
    const r = await act(() => api.post("/ezan/sounds/url", { url: h.url, name: h.title.slice(0, 80) }), `“${h.title.slice(0, 40)}” bewaard. Kies het hierboven per gebed.`);
    setSaving(null); if (r) onSaved();
  };
  useEffect(() => () => playing?.a.pause(), [playing]);
  return (
    <div className="ezan-search">
      <b style={{ fontSize: 14 }}>{tr("Online ezan-opnames")}</b>
      <form className="addrow" onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 2) search(q.trim()); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Zoek bv. Mekke ezanı, Diyanet, Alafasy…")} aria-label={tr("Zoek een ezan-opname")} />
        <button className="btn ghost" type="submit" disabled={busy || q.trim().length < 2}>{busy ? tr("Zoeken…") : tr("Zoeken")}</button>
      </form>
      <div className="picks">{PRESETS.map((p) => <button key={p} type="button" className="pick" aria-pressed={q === p} onClick={() => search(p)}>{p}</button>)}</div>
      {busy && <p className="hint">{tr("Even zoeken in het Internet Archive…")}</p>}
      {hits && !hits.length && !busy && <p className="hint">{tr("Niets gevonden. Probeer een andere zoekterm.")}</p>}
      {!!hits?.length && (
        <div className="upnext">
          {hits.map((h) => (
            <div className="item" key={h.id}>
              <button className="iconbtn" onClick={() => preview(h.url)} aria-label={playing?.url === h.url ? tr("Stoppen") : tr("Beluisteren")}>{playing?.url === h.url ? "■" : <Icon.play />}</button>
              <span style={{ flex: 1, minWidth: 0 }}><b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.title}</b><small className="muted">{h.source}{h.size ? ` · ${(h.size / 1048576).toFixed(1)} MB` : ""}</small></span>
              <button className="btn small" onClick={() => save(h)} disabled={saving === h.url}>{saving === h.url ? tr("Bewaren…") : tr("Bewaren")}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
