/** Barcode scannen met de camera van de telefoon (BarcodeDetector, Chrome op Android) of intikken; product via Open Food Facts. */
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Modal } from "./ui";
import { t } from "../i18n";

export interface Product { ean: string; name: string; brand: string; quantity: string; label: string; kcal100: number | null }
type Detector = { detect: (src: ImageBitmapSource) => Promise<{ rawValue: string }[]> };
const hasDetector = () => typeof (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector === "function";

export function BarcodeScan({ onPick, onClose }: { onPick: (p: Product) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [ean, setEan] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Product | null>(null);
  const [camera, setCamera] = useState(hasDetector());
  const lookup = async (code: string) => {
    if (!/^\d{8,14}$/.test(code)) { setErr(t("Een barcode heeft 8 tot 14 cijfers.")); return; }
    setBusy(true); setErr("");
    try { setFound(await api.get<Product>(`/products/barcode/${code}`)); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setFound(null); }
    setBusy(false);
  };
  useEffect(() => {
    if (!camera) return;
    let stream: MediaStream | null = null; let timer = 0; let stopped = false;
    const Ctor = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    const det = new Ctor({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then((s) => {
      if (stopped) { s.getTracks().forEach((x) => x.stop()); return; }
      stream = s; if (video.current) { video.current.srcObject = s; void video.current.play(); }
      const tick = async () => {
        if (stopped || !video.current || video.current.readyState < 2) { timer = window.setTimeout(tick, 300); return; }
        try { const codes = await det.detect(video.current); if (codes[0]?.rawValue) { stopped = true; stream?.getTracks().forEach((x) => x.stop()); setEan(codes[0].rawValue); void lookup(codes[0].rawValue); return; } } catch { /* */ }
        timer = window.setTimeout(tick, 300);
      };
      timer = window.setTimeout(tick, 400);
    }).catch(() => setCamera(false));
    return () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach((x) => x.stop()); };
  }, [camera]);
  return (
    <Modal title={`📷 ${t("Barcode")}`} onClose={onClose}>
      {camera && !found && <video ref={video} className="scan-video" muted playsInline />}
      {!camera && <p className="hint">{t("Camera-scannen werkt in Chrome op Android. Tik de cijfers onder de streepjescode in.")}</p>}
      <form className="addrow" onSubmit={(e) => { e.preventDefault(); void lookup(ean.trim()); }}>
        <input inputMode="numeric" value={ean} onChange={(e) => setEan(e.target.value)} placeholder="5400141…" />
        <button className="btn" type="submit" disabled={busy}>{busy ? "…" : t("Opzoeken")}</button>
      </form>
      {err && <p className="error">{err}</p>}
      {found && (
        <div className="upk ok">
          <span className="upk-ic" aria-hidden>🛒</span>
          <span className="upk-txt"><b>{found.label || found.ean}</b><small className="muted">{[found.brand, found.quantity, found.kcal100 !== null ? `${found.kcal100} kcal/100 g` : null].filter(Boolean).join(" · ")}</small></span>
          <span className="upk-btns"><button className="btn small" onClick={() => onPick(found)}>{t("Gebruiken")}</button></span>
        </div>
      )}
      <p className="hint">{t("Productgegevens van Open Food Facts, de vrije productdatabank.")}</p>
    </Modal>
  );
}
