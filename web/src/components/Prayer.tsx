import { useEffect, useRef, useState } from "react";
import { api, photoUrl } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { EzanSound, Prayer, PrayerDay } from "../types";
import { EZAN_PRAYERS, PRAYER_ICON, PRAYER_NAME, PRAYER_ORDER, PRAYER_TR, hijri, hm, nextPrayer, untilText } from "../islam";
import { Icon } from "./Icons";
import { Confirm } from "./ui";
import { cap, longDate, todayIso } from "../dates";

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
    await act(() => api.post("/ezan/sounds", fd), "Ezan toegevoegd");
    setBusy(false); reloadSounds();
  };
  const fromUrl = async () => {
    if (!url.trim()) return;
    setBusy(true);
    const r = await act(() => api.post("/ezan/sounds/url", { url: url.trim() }), "Ezan opgehaald en bewaard");
    setBusy(false); if (r) { setUrl(""); reloadSounds(); }
  };
  const listen = (snd: EzanSound | null) => {
    preview?.pause();
    if (!snd) { setPreview(null); return; }
    const a = new Audio(photoUrl(snd.filename)); a.volume = Number(s.ezan_volume) / 100; a.play().catch(() => toast("Afspelen lukte niet. Tik eerst ergens op het scherm."));
    setPreview(a);
  };
  const pick = (p: Prayer, id: string) => save({ ezan_sounds: JSON.stringify({ ...soundOf, [p]: id }) }, `Ezan voor ${PRAYER_NAME[p]} ingesteld`);
  const togglePrayer = (p: Prayer) => { const n = new Set(chosen); if (n.has(p)) n.delete(p); else n.add(p); save({ ezan_prayers: EZAN_PRAYERS.filter((x) => n.has(x)).join(",") }); };
  const bump = (p: Prayer, d: number) => save({ ezan_adjust: JSON.stringify({ ...adjust, [p]: Math.max(-30, Math.min(30, (adjust[p] ?? 0) + d)) }) }, "Bijgesteld");

  return (
    <div className="page-scroll" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 14 }}>
      <section className="card card-pad prayer-head">
        <div className="prayer-next">
          <small>{cap(longDate(todayIso()))} · {hijri()}</small>
          {nxt ? <><b>{PRAYER_ICON[nxt.prayer]} {PRAYER_NAME[nxt.prayer]} <span className="muted" style={{ fontWeight: 500 }}>({PRAYER_TR[nxt.prayer]})</span></b><span className="prayer-when num">{hm(new Date(nxt.at).toISOString())} <small>{untilText(nxt.at - now)}{nxt.tomorrow ? " · morgen" : ""}</small></span></> : <b>Gebedstijden laden…</b>}
          <small>{day?.city} · {day?.methods.find((m) => m.id === s.ezan_method)?.label ?? s.ezan_method}{s.ezan_asr === "hanafi" ? " · asr volgens Hanafi" : ""}</small>
        </div>
        {day && (
          <div className="prayer-row">
            {PRAYER_ORDER.map((p) => {
              const t = new Date(day.times[p]).getTime();
              const past = t < now;
              const isNext = nxt && !nxt.tomorrow && nxt.prayer === p;
              return (
                <div key={p} className={`prayer-cell${past ? " past" : ""}${isNext ? " next" : ""}`}>
                  <span className="prayer-ic" aria-hidden>{PRAYER_ICON[p]}</span>
                  <b>{PRAYER_NAME[p]}</b>
                  <small>{PRAYER_TR[p]}</small>
                  <span className="num prayer-t">{hm(day.times[p])}</span>
                  {p !== "sunrise" && on && chosen.has(p) && <span className="prayer-bell" title="Ezan klinkt">🔔</span>}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="section-title" style={{ marginBottom: 0 }}><h2>Ezan</h2>
          <label className="switch"><input type="checkbox" checked={on} onChange={(e) => save({ ezan_on: e.target.checked ? "1" : "0" }, e.target.checked ? "Ezan staat aan" : "Ezan staat uit")} /><span /> {on ? "Aan" : "Uit"}</label>
        </div>
        <p className="hint">Als de ezan aanstaat, klinkt op elk scherm van het gezin de oproep op de gebedstijd. Je kiest hieronder welke gebeden en welk geluid. Zet het per scherm uit als bv. een telefoon stil moet blijven.</p>
        <label className="check-row"><input type="checkbox" checked={device} onChange={(e) => { setDevice(e.target.checked); try { localStorage.setItem(DEVICE_KEY, e.target.checked ? "1" : "0"); } catch { /* */ } }} /> Ezan laten horen op dit scherm</label>
        <div className="row2">
          <label className="field"><span>Rekenmethode</span>
            <select value={s.ezan_method} onChange={(e) => save({ ezan_method: e.target.value }, "Rekenmethode gewijzigd")} disabled={!admin}>
              {(day?.methods ?? [{ id: s.ezan_method, label: s.ezan_method }]).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <label className="field"><span>Asr-berekening</span>
            <select value={s.ezan_asr} onChange={(e) => save({ ezan_asr: e.target.value })} disabled={!admin}>
              <option value="standard">Standaard (Shafi'i, Maliki, Hanbali, Diyanet)</option>
              <option value="hanafi">Hanafi (later)</option>
            </select>
          </label>
        </div>
        <label className="field"><span>Volume: {s.ezan_volume}%</span><input type="range" min={10} max={100} step={5} value={s.ezan_volume} onChange={(e) => save({ ezan_volume: e.target.value }, "Volume bewaard")} /></label>
      </section>

      <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="section-title" style={{ marginBottom: 0 }}><h2>Per gebed</h2><span className="hint">welke ezan klinkt, en minuten bijstellen</span></div>
        {EZAN_PRAYERS.map((p) => (
          <div className="prayer-pref" key={p}>
            <label className="check-row prayer-pref-h"><input type="checkbox" checked={chosen.has(p)} onChange={() => togglePrayer(p)} /> <b>{PRAYER_ICON[p]} {PRAYER_NAME[p]}</b> <span className="muted">{PRAYER_TR[p]}{day ? ` · ${hm(day.times[p])}` : ""}</span></label>
            <select value={soundOf[p] ?? ""} onChange={(e) => pick(p, e.target.value)} aria-label={`Ezan voor ${PRAYER_NAME[p]}`} disabled={!admin}>
              <option value="">Standaard (eerste geluid uit de lijst)</option>
              {sounds.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              <option value="chime">Zacht belletje</option>
              <option value="silent">Stil (alleen melding op het scherm)</option>
            </select>
            <span className="prayer-adj">
              <button className="iconbtn" onClick={() => bump(p, -1)} aria-label="Een minuut vroeger" disabled={!admin}>−</button>
              <span className="num">{(adjust[p] ?? 0) > 0 ? "+" : ""}{adjust[p] ?? 0} min</span>
              <button className="iconbtn" onClick={() => bump(p, 1)} aria-label="Een minuut later" disabled={!admin}>+</button>
            </span>
          </div>
        ))}
      </section>

      <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="section-title" style={{ marginBottom: 0 }}><h2>Ezan-geluiden</h2><span className="hint">{sounds.length} in de bibliotheek</span></div>
        <p className="hint">Voeg je favoriete ezan toe als mp3: upload een bestand of plak een link (bv. van een moskee- of Diyanet-site). De server bewaart het geluid, zodat het ook speelt als de link later verdwijnt.</p>
        <div className="upnext">
          {sounds.map((x) => (
            <div className="item" key={x.id}>
              <button className="iconbtn" onClick={() => listen(preview && !preview.paused && preview.src.endsWith(encodeURIComponent(x.filename)) ? null : x)} aria-label="Beluisteren"><Icon.play /></button>
              <span style={{ flex: 1, minWidth: 0 }}><b>{x.name}</b><small className="muted" style={{ display: "block" }}>{EZAN_PRAYERS.filter((p) => soundOf[p] === x.id).map((p) => PRAYER_NAME[p]).join(", ") || (sounds[0]?.id === x.id ? "standaard" : "")}</small></span>
              {admin && <button className="iconbtn" onClick={() => setDel(x)} aria-label="Verwijderen"><Icon.trash /></button>}
            </div>
          ))}
          {!sounds.length && <p className="empty">Nog geen ezan toegevoegd. Zonder geluid klinkt een zacht belletje.</p>}
        </div>
        {admin && (
          <>
            <div className="addrow">
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… /ezan.mp3" aria-label="Link naar een ezan-bestand" />
              <button className="btn ghost" onClick={fromUrl} disabled={busy || !url.trim()}>{busy ? "Bezig…" : "Ophalen"}</button>
              <button className="btn ghost" onClick={() => file.current?.click()} disabled={busy}><Icon.upload /> Bestand</button>
              <input ref={file} type="file" accept="audio/*" hidden onChange={(e) => upload(e.target.files)} />
            </div>
          </>
        )}
      </section>
      {del && <Confirm title={`${del.name} verwijderen?`} onClose={() => setDel(null)} actions={[{ label: "Verwijderen", run: async () => { await act(() => api.del(`/ezan/sounds/${del.id}`), "Verwijderd"); reloadSounds(); } }]} />}
    </div>
  );
}
