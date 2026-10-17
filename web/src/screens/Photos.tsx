import { useRef, useState } from "react";
import { api, photoUrl } from "../api";
import { useAction, useData } from "../store";
import { Confirm } from "../components/ui";
import { Icon } from "../components/Icons";
import { t } from "../i18n";

export function PhotosScreen({ header, startSlideshow }: { header: React.ReactNode; startSlideshow: () => void }) {
  const { data, toast } = useData();
  const act = useAction();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState<string | null>(null);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("photos", f));
    const r = await act(() => api.post<{ added: number }>("/photos", fd));
    if (r) toast(r.added === files.length ? t("{n} foto('s) toegevoegd", { n: r.added }) : t("{n} van {m} toegevoegd (alleen jpg, png, webp, gif of heic)", { n: r.added, m: files.length }));
    setBusy(false);
    if (input.current) input.current.value = "";
  };

  return (
    <>
      <div className="topbar">
        {header}
        <div className="right">
          <button className="pill" onClick={startSlideshow} disabled={!data?.photos.length}><Icon.play />{" "}{t("Diavoorstelling")}</button>
          <button className="btn" onClick={() => input.current?.click()} disabled={busy}><Icon.upload /> {busy ? t("Bezig…") : t("Foto's toevoegen")}</button>
          <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
        </div>
      </div>
      <p className="hint">{t("Deze foto's verschijnen als het scherm een tijdje niet gebruikt wordt, samen met de klok en de volgende afspraak. Je kunt ook foto's toevoegen vanaf je telefoon via dezelfde app.")}</p>
      <div className="page-scroll" style={{ flex: 1, minHeight: 0 }}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}>
        <div className="photos">
          {data?.photos.map((p) => (
            <div className="photo" key={p.id}>
              <img src={photoUrl(p.filename)} alt="" loading="lazy" />
              <button aria-label={t("Foto verwijderen")} onClick={() => setDel(p.id)}>×</button>
            </div>
          ))}
        </div>
        {!data?.photos.length && <p className="empty">{t("Nog geen foto's. Voeg vakantiefoto's of tekeningen van de kinderen toe.")}</p>}
      </div>
      {del && <Confirm title={t("Foto verwijderen?")} onClose={() => setDel(null)} actions={[{ label: t("Verwijderen"), run: () => act(() => api.del(`/photos/${del}`), t("Foto verwijderd")) }]} />}
    </>
  );
}
