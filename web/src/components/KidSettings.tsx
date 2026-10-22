/** Instellingen → Kindertablet: bedtijd, schermtijd, toegelaten apps, en op Android de kiosk-vergrendeling (startscherm, device owner, QR). */
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useData } from "../store";
import { Fold } from "./ui";
import { useSetting } from "./settings-hooks";
import { isNative, kiosk, kioskStatus, type KioskStatus } from "../native";
import { parseKidApps, type KidApp } from "../screens/Kid";
import { t } from "../i18n";

const SUGGEST: KidApp[] = [
  { label: "YouTube Kids", package: "com.google.android.apps.youtube.kids", url: "https://www.youtubekids.com", icon: "📺" },
  { label: "Ketnet", package: "be.vrt.ketnet", url: "https://www.ketnet.be", icon: "🎈" },
  { label: "Khan Academy Kids", package: "org.khankids.android", icon: "🧠" },
  { label: "Duolingo", package: "com.duolingo", url: "https://www.duolingo.com", icon: "🦉" },
  { label: "Bingel", package: "be.vanin.bingel", url: "https://www.bingel.be", icon: "📘" },
];

export function KidSettings() {
  const { data } = useData();
  const save = useSetting();
  const s = data!.settings;
  const [apps, setApps] = useState<KidApp[]>(() => parseKidApps(s.kid_apps));
  const [nw, setNw] = useState<KidApp>({ label: "", package: "", url: "", icon: "📱" });
  const [ks, setKs] = useState<KioskStatus>(null);
  const [prov, setProv] = useState<Record<string, unknown> | { error: string } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => { kioskStatus().then(setKs); }, []);
  useEffect(() => { if (!prov || "error" in prov || !canvas.current) return; import("qrcode").then((q) => q.toCanvas(canvas.current!, JSON.stringify(prov), { width: 260, margin: 1 })).catch(() => {}); }, [prov]);
  const persist = (list: KidApp[]) => { setApps(list); save({ kid_apps: JSON.stringify(list) }, t("Apps voor de kindertablet bewaard")); };
  return (
    <Fold title={t("Kindertablet")} hint={t("bedtijd, schermtijd, apps, vergrendeling")}>
      <p className="hint">{t("Maak van een gewone Android-tablet een tablet voor één kind: kies bij het eerste opstarten (of bij Toestellen) de rol Kindertablet. Het kind ziet zijn dag en routine, leren en spelen, foto's en het weekmenu, en alleen de apps die je hier toelaat. Vrijgeven doe je door bovenaan lang te drukken en de ouder-pincode in te geven.")}</p>
      <div className="row3">
        <label className="field"><span>{t("Bedtijd van")}</span><input type="time" value={s.kid_bedtime_from ?? ""} onChange={(e) => save({ kid_bedtime_from: e.target.value })} /></label>
        <label className="field"><span>{t("tot")}</span><input type="time" value={s.kid_bedtime_until ?? ""} onChange={(e) => save({ kid_bedtime_until: e.target.value })} /></label>
        <label className="field"><span>{t("Schermtijd per dag")}</span>
          <select value={s.kid_screen_minutes ?? "0"} onChange={(e) => save({ kid_screen_minutes: e.target.value })}>
            {["0", "30", "45", "60", "90", "120", "180"].map((v) => <option key={v} value={v}>{v === "0" ? t("Geen grens") : `${v} min`}</option>)}
          </select>
        </label>
      </div>
      <p className="hint">{t("Tijdens de bedtijd toont de tablet een gedimde klok. Is de schermtijd op, dan stopt het spelen; taken afvinken en de agenda bekijken tellen niet mee als de tablet uit staat. Een ouder kan met de pincode 30 minuten extra geven.")}</p>
      <div className="field"><span>{t("Toegelaten apps")}</span>
        <div className="chips">
          {apps.map((a, i) => <span className="chip" key={i}>{a.icon} {a.label} <button className="linkbtn" aria-label={t("Verwijderen")} onClick={() => persist(apps.filter((_, j) => j !== i))}>✕</button></span>)}
          {!apps.length && <span className="muted">{t("Nog geen extra apps; het kind ziet alleen {brand}.")}</span>}
        </div>
        <div className="chips">{SUGGEST.filter((x) => !apps.some((a) => a.package === x.package)).map((x) => <button key={x.package} className="chip" onClick={() => persist([...apps, x])}>+ {x.icon} {x.label}</button>)}</div>
        <div className="addrow">
          <input value={nw.label} onChange={(e) => setNw({ ...nw, label: e.target.value })} placeholder={t("Naam")} aria-label={t("Naam")} style={{ flex: "0 1 160px" }} />
          <input value={nw.package} onChange={(e) => setNw({ ...nw, package: e.target.value })} placeholder="com.voorbeeld.app" aria-label={t("Pakketnaam")} />
          <input value={nw.url} onChange={(e) => setNw({ ...nw, url: e.target.value })} placeholder="https://…" aria-label={t("Webadres (optioneel)")} />
          <button className="btn ghost" disabled={!nw.label.trim() || (!nw.package.trim() && !nw.url?.trim())} onClick={() => { persist([...apps, { ...nw, label: nw.label.trim(), package: nw.package.trim() }]); setNw({ label: "", package: "", url: "", icon: "📱" }); }}>{t("Toevoegen")}</button>
        </div>
        <small className="muted">{t("De pakketnaam vind je in de Play Store-link van de app, achter id=. Met een vergrendelde tablet mag het kind alleen deze apps openen; op een gewone tablet opent Kinday ze gewoon.")}</small>
      </div>
      <div className="field"><span>{t("Vergrendelen (kiosk)")}</span>
        {isNative() ? (
          <>
            <p className="hint">{ks ? (ks.deviceOwner ? t("Deze tablet is beheerd door {brand}: het kind komt niet uit de app. {s}", { s: ks.lockTask ? t("Vergrendeling actief.") : t("Vergrendeling staat nu uit.") }) : t("Deze tablet is niet door {brand} beheerd. Als startscherm werkt het al; echt dicht wordt het alleen met de QR-methode op een fabrieksnieuwe tablet (zie onder).")) : t("Status onbekend.")}</p>
            <div className="actions" style={{ justifyContent: "flex-start" }}>
              <button className="btn ghost" onClick={() => kiosk("launcher")}>{t("Als startscherm instellen")}</button>
              {ks?.deviceOwner && <button className="btn ghost" onClick={async () => { await kiosk(ks.lockTask ? "stop" : "start", apps.map((a) => a.package).filter(Boolean)); setKs(await kioskStatus()); }}>{ks.lockTask ? t("Vergrendeling uit") : t("Vergrendeling aan")}</button>}
            </div>
          </>
        ) : <p className="hint">{t("Open dit op de tablet zelf (Android-app) om ze als startscherm in te stellen of te vergrendelen.")}</p>}
        <details className="kid-prov">
          <summary>{t("Nieuwe tablet volledig vergrendelen met een QR-code")}</summary>
          <ol className="steps-sm">
            <li>{t("Tablet terugzetten naar fabrieksinstellingen (of nieuw uit de doos). Nog geen Google-account toevoegen.")}</li>
            <li>{t("Op het welkomstscherm zes keer op dezelfde plek tikken: de QR-scanner verschijnt. Verbind met wifi.")}</li>
            <li>{t("Scan de code hieronder. Android installeert {brand} en maakt het de beheerder van de tablet.")}</li>
            <li>{t("Meld aan, kies Kindertablet en het kind. Klaar: alleen nog {brand} en de toegelaten apps.")}</li>
          </ol>
          {!prov && <button className="btn ghost small" onClick={() => api.get<Record<string, unknown>>("/kiosk/provisioning").then(setProv).catch((e: Error) => setProv({ error: e.message }))}>{t("QR-code tonen")}</button>}
          {prov && ("error" in prov ? <p className="error">{String(prov.error)}</p> : <div className="qr-wrap"><canvas ref={canvas} width={260} height={260} aria-label={t("QR-code voor het instellen van de tablet")} /></div>)}
        </details>
      </div>
    </Fold>
  );
}
