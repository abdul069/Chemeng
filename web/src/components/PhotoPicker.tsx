import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAction } from "../store";
import type { DishPhoto } from "../types";
import { Modal } from "./ui";
import { Icon } from "./Icons";
import { t } from "../i18n";

/** Een foto kiezen voor een gerecht: zoeken, zelf een foto nemen of uploaden. */
export function PhotoPicker({ title, current, onPick, onClose }: { title: string; current: string | null; onPick: (image: string | null) => void; onClose: () => void }) {
  const act = useAction();
  const [q, setQ] = useState(title);
  const [hits, setHits] = useState<DishPhoto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const search = async (query: string) => {
    setBusy(true);
    setHits(null);
    setHits((await act(() => api.post<DishPhoto[]>("/dish-photos", { query }))) ?? []);
    setBusy(false);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (title.trim().length > 1) search(title); }, []);

  const upload = async (files: FileList | null) => {
    if (!files?.[0]) return;
    const fd = new FormData();
    fd.append("photo", files[0]);
    const r = await act(() => api.post<{ image: string }>("/dish-photos/upload", fd));
    if (r) { onPick(r.image); onClose(); }
  };

  return (
    <Modal title={t("Foto van het gerecht")} onClose={onClose} wide>
      <form className="addrow" onSubmit={(e) => { e.preventDefault(); if (q.trim().length > 1) search(q.trim()); }}>
        <input id="pp-q" value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Zoek een foto")} placeholder={t("Naam van het gerecht")} />
        <button className="btn" type="submit" disabled={busy}>{busy ? t("Zoeken…") : t("Zoeken")}</button>
        <button type="button" className="btn ghost" onClick={() => file.current?.click()}><Icon.upload />{" "}{t("Eigen foto")}</button>
        <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={(e) => upload(e.target.files)} />
      </form>
      <p className="hint">{t("Tip: zoek op de Turkse naam (bv. “mercimek çorbası”) voor de beste foto's. Met “Eigen foto” neem je een foto van wat je zelf kookte.")}</p>
      {busy && <p className="hint">{t("Foto's zoeken…")}</p>}
      {hits && !hits.length && !busy && <p className="empty">{t("Geen foto's gevonden. Probeer een andere naam of neem zelf een foto.")}</p>}
      <div className="pgrid">
        {hits?.map((h) => (
          <button key={h.url} className={`pgrid-item${current === h.url ? " on" : ""}`} onClick={() => { onPick(h.url); onClose(); }} title={`${h.title} · ${h.source}`}>
            <img src={h.url} alt={h.title} loading="lazy" referrerPolicy="no-referrer" />
            <small>{h.source}</small>
          </button>
        ))}
      </div>
      <div className="actions">
        {current && <button className="btn danger left" onClick={() => { onPick(null); onClose(); }}>{t("Foto weghalen")}</button>}
        <button className="btn ghost" onClick={onClose}>{t("Sluiten")}</button>
      </div>
    </Modal>
  );
}
