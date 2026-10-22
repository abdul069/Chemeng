/** Eerste start op een toestel: is dit het wandscherm, het tafelmodel of een telefoon? En van wie is de telefoon? */
import { useState } from "react";
import { useData } from "../store";
import { Avatar, Modal, cvar } from "./ui";
import { setDevice, suggestRole, type DeviceRole, type HubVariant } from "../device";
import { t } from "../i18n";

const CHOICES: { role: DeviceRole; variant: HubVariant | ""; icon: string; title: string; text: string }[] = [
  { role: "hub", variant: "wall", icon: "🖼️", title: "Wandscherm", text: "Groot aanraakscherm aan de muur in de keuken of hal. Altijd aan, voor het hele gezin." },
  { role: "hub", variant: "table", icon: "🪑", title: "Tafelmodel", text: "Scherm op een standaard op het aanrecht of de tafel. Zelfde ervaring, kantelbaar." },
  { role: "phone", variant: "", icon: "📱", title: "Mijn telefoon", text: "Persoonlijke app: jouw dag, jouw taken en lijsten, en het keukenscherm op afstand bedienen." },
  { role: "kid", variant: "", icon: "🧒", title: "Kindertablet", text: "Een tablet voor één kind: eigen dag en routine, leren en spelen, en alleen de apps die de ouders toelaten. Ouders geven vrij met de pincode." },
];

export function DeviceSetup({ onDone }: { onDone: () => void }) {
  const { data } = useData();
  const suggested = suggestRole();
  const [step, setStep] = useState<"role" | "who">("role");
  const [picked, setPicked] = useState<typeof CHOICES[number] | null>(null);
  const [name, setName] = useState("");
  const finish = (memberId: string | null) => {
    if (!picked) return;
    const who = memberId ? data?.members.find((m) => m.id === memberId) : null;
    const def = picked.role === "hub" ? (picked.variant === "wall" ? t("Wandscherm keuken") : t("Tafelmodel")) : picked.role === "kid" ? t("Tablet van {n}", { n: who?.name ?? "" }) : undefined;
    setDevice({ role: picked.role, variant: picked.variant, memberId, name: name.trim() || def || undefined });
    onDone();
  };
  return (
    <Modal title={step === "role" ? t("Waar draait {brand} hier?") : picked?.role === "kid" ? t("Van welk kind is deze tablet?") : t("Van wie is deze telefoon?")} onClose={() => { setDevice({ role: suggested, variant: suggested === "hub" ? "wall" : "" }); onDone(); }} wide>
      {step === "role" ? (
        <>
          <p className="hint">{t("Zo weet {brand} hoe het zich moet gedragen: als het gedeelde scherm voor het hele gezin, of als jouw persoonlijke app.")}</p>
          <div className="devchoices">
            {CHOICES.map((c) => (
              <button key={c.title} className={`devchoice${c.role === suggested && (c.role === "phone" || c.variant === "wall") ? " suggested" : ""}`} onClick={() => { setPicked(c); if ((c.role === "phone" || c.role === "kid") && (data?.members.length ?? 0) > 0) setStep("who"); else { setPicked(c); setDevice({ role: c.role, variant: c.variant, memberId: null, name: c.role === "hub" ? (c.variant === "wall" ? t("Wandscherm keuken") : t("Tafelmodel")) : undefined }); onDone(); } }}>
                <span className="devchoice-ic" aria-hidden>{c.icon}</span>
                <b>{t(c.title)}</b>
                <small>{t(c.text)}</small>
                {c.role === suggested && (c.role === "phone" || c.variant === "wall") && <i className="devchoice-tag">{t("aanbevolen voor dit toestel")}</i>}
              </button>
            ))}
          </div>
          <p className="hint">{t("Je kunt dit later altijd wijzigen bij Instellingen → Toestellen.")}</p>
        </>
      ) : (
        <>
          <p className="hint">{t("Dan opent de app met jouw dag, jouw taken en jouw lijsten. Anderen kunnen later nog wisselen.")}</p>
          <div className="picks who-grid">
            {data?.members.filter((m) => m.role !== "huisdier" && (picked?.role !== "kid" || m.role === "kind")).map((m) => (
              <button key={m.id} className="pick pick-person big" style={cvar(m.color)} onClick={() => finish(m.id)}><Avatar m={m} size={34} dot={false} /> {m.name}</button>
            ))}
            {picked?.role !== "kid" && <button className="pick big" onClick={() => finish(null)}>{t("Gedeelde telefoon")}</button>}
          </div>
          <label className="field"><span>{t("Naam van dit toestel (optioneel)")}</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("bv. Telefoon van Elif")} /></label>
        </>
      )}
    </Modal>
  );
}
