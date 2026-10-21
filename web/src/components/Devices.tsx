/** Instellingen → Toestellen: welk scherm is de hub, welke telefoons horen erbij, en een QR-code om een telefoon te koppelen. */
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAction, useData, useRemote } from "../store";
import type { Device } from "../types";
import { Avatar, Fold, Modal, cvar } from "./ui";
import { setDevice, useDevice, type DeviceRole, type HubVariant } from "../device";
import { t } from "../i18n";

const ROLE_ICON: Record<string, string> = { wall: "🖼️", table: "🪑", phone: "📱" };
const roleLabel = (d: { role: string; variant: string }) => d.role === "hub" ? (d.variant === "table" ? t("Tafelmodel") : t("Wandscherm")) : t("Telefoon");
const seen = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso + "Z")) / 60_000); return m < 3 ? t("nu online") : m < 60 ? t("{n} min geleden", { n: m }) : m < 1440 ? t("{n} u geleden", { n: Math.round(m / 60) }) : t("{n} dagen geleden", { n: Math.round(m / 1440) }); };

export function QrPair({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    api.post<{ id: string; url: string }>("/invites", { kind: "household", role: "lid", label: t("Telefoon koppelen via QR") }).then((r) => setUrl(r.url)).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => {
    if (!url || !canvas.current) return;
    import("qrcode").then((q) => q.toCanvas(canvas.current!, url, { width: 240, margin: 1, color: { dark: "#1e2632", light: "#ffffff" } })).catch(() => setErr(t("QR-code maken lukte niet.")));
  }, [url]);
  return (
    <Modal title={t("Telefoon koppelen")} onClose={onClose}>
      <ol className="steps-sm">
        <li>{t("Open de camera op de telefoon en richt op de code.")}</li>
        <li>{t("Maak een account of meld je aan.")}</li>
        <li>{t("Kies in de app “Mijn telefoon” en wie je bent. Klaar!")}</li>
      </ol>
      <div className="qr-wrap">{err ? <p className="error">{err}</p> : <canvas ref={canvas} width={240} height={240} aria-label={t("QR-code met uitnodiging")} />}</div>
      {url && <div className="linkbox"><code>{url}</code></div>}
      <p className="hint">{t("De code werkt één keer en is 7 dagen geldig. De telefoon ziet daarna alles van het gezin en kan dit scherm bedienen.")}</p>
    </Modal>
  );
}

export function DevicesSection() {
  const { data } = useData();
  const act = useAction();
  const me = useDevice();
  const [devices] = useRemote<Device[]>("/devices", ["devices", "members"], []);
  const [qr, setQr] = useState(false);
  const [rename, setRename] = useState(me.name);
  const setRole = (role: DeviceRole, variant: HubVariant | "") => { setDevice({ role, variant, memberId: role === "hub" ? null : me.memberId }); };
  const hubs = devices.filter((d) => d.role === "hub"), phones = devices.filter((d) => d.role === "phone");
  return (
    <Fold title={t("Toestellen")} action={<button className="btn accent small" onClick={() => setQr(true)}>{t("📱 Telefoon koppelen")}</button>}>
      <div className="thisdev">
        <b>{t("Dit toestel")}</b>
        <div className="picks">
          {([["hub", "wall", "🖼️ Wandscherm"], ["hub", "table", "🪑 Tafelmodel"], ["phone", "", "📱 Telefoon"]] as const).map(([r, v, l]) => (
            <button key={l} type="button" className="pick" aria-pressed={me.role === r && (r === "phone" || me.variant === v)} onClick={() => setRole(r, v)}>{t(l)}</button>
          ))}
        </div>
        {me.role === "phone" && (
          <div className="field"><span>{t("Van wie is deze telefoon?")}</span>
            <div className="picks">{data?.members.filter((m) => m.role !== "huisdier").map((m) => <button type="button" key={m.id} className="pick pick-person" style={cvar(m.color)} aria-pressed={me.memberId === m.id} onClick={() => setDevice({ memberId: me.memberId === m.id ? null : m.id })}><Avatar m={m} size={22} dot={false} /> {m.name}</button>)}</div>
          </div>
        )}
        <div className="addrow"><input value={rename} onChange={(e) => setRename(e.target.value)} aria-label={t("Naam van dit toestel")} /><button className="btn ghost" disabled={!rename.trim() || rename === me.name} onClick={() => setDevice({ name: rename.trim() })}>{t("Naam bewaren")}</button></div>
      </div>
      <div className="devlist">
        {[...hubs, ...phones].map((d) => {
          const m = d.memberId ? data?.members.find((x) => x.id === d.memberId) : undefined;
          return (
            <div className={`devrow${d.online ? " online" : ""}${d.id === me.id ? " me" : ""}`} key={d.id}>
              <span className="dev-ic" aria-hidden>{ROLE_ICON[d.role === "hub" ? (d.variant || "wall") : "phone"]}</span>
              <span className="dev-txt"><b>{d.name}{d.id === me.id ? ` · ${t("dit toestel")}` : ""}</b><small>{roleLabel(d)}{m ? ` · ${m.name}` : ""} · <i className={`dot${d.online ? " on" : ""}`} /> {seen(d.lastSeen)}</small></span>
              {d.id !== me.id && <button className="iconbtn" aria-label={t("Toestel verwijderen")} onClick={() => act(() => api.del(`/devices/${d.id}`), t("Toestel verwijderd"))}>✕</button>}
            </div>
          );
        })}
        {!devices.length && <p className="empty">{t("Nog geen toestellen aangemeld.")}</p>}
      </div>
      <p className="hint">{t("Het wandscherm of tafelmodel is het gedeelde scherm van het gezin. Telefoons zien hun eigen dag en kunnen een recept of scherm naar het keukenscherm sturen.")}</p>
      {qr && <QrPair onClose={() => setQr(false)} />}
    </Fold>
  );
}
