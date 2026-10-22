/** Voorlezen, betrouwbaar op Android. In de app (Capacitor) via de Android-stem (TextToSpeech); in de browser via de Web Speech API,
 *  met de eigenaardigheden van Chrome op Android: alleen na een tik, nooit meteen na cancel(), en een stem in de juiste taal kiezen. */
import { Capacitor } from "@capacitor/core";
import { TextToSpeech } from "@capacitor-community/text-to-speech";
import { getLang } from "./i18n";

const clean = (t: string) => t.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{20E3}]/gu, "").replace(/\s+/g, " ").trim();
const langTag = () => (getLang() === "tr" ? "tr-TR" : getLang() === "en" ? "en-GB" : "nl-NL");
let unlocked = false;
let voices: SpeechSynthesisVoice[] = [];
if (typeof speechSynthesis !== "undefined") {
  const load = () => { voices = speechSynthesis.getVoices(); };
  load(); speechSynthesis.addEventListener?.("voiceschanged", load);
  // Chrome op Android laat spraak pas toe na een aanraking: bij de eerste tik een stille uitspraak zodat de rest werkt
  const unlock = () => { if (unlocked) return; unlocked = true; try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u); } catch { /* */ } };
  window.addEventListener("pointerdown", unlock, { once: true, passive: true });
}
export function canSpeak(): boolean { return Capacitor.isNativePlatform() || typeof speechSynthesis !== "undefined"; }
/** Lees een tekst voor. In de browser werkt dit pas na de eerste tik op de pagina. */
export async function say(text: string, rate = 0.9): Promise<void> {
  const t = clean(text); if (!t) return;
  if (Capacitor.isNativePlatform()) {
    try { await TextToSpeech.stop().catch(() => {}); await TextToSpeech.speak({ text: t, lang: langTag(), rate, pitch: 1.05, volume: 1, category: "ambient" }); return; } catch { /* valt terug op web */ }
  }
  if (typeof speechSynthesis === "undefined") return;
  try {
    const speakNow = () => {
      const u = new SpeechSynthesisUtterance(t);
      u.lang = langTag(); u.rate = rate; u.pitch = 1.1;
      const want = langTag().slice(0, 2);
      const v = voices.find((x) => x.lang.toLowerCase().startsWith(want) && /google|natural|premium/i.test(x.name)) ?? voices.find((x) => x.lang.toLowerCase().startsWith(want));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    };
    // Android Chrome: speak() vlak na cancel() wordt soms genegeerd; even wachten
    if (speechSynthesis.speaking || speechSynthesis.pending) { speechSynthesis.cancel(); setTimeout(speakNow, 120); } else speakNow();
  } catch { /* geen stem */ }
}
export function stopSpeaking() { try { if (Capacitor.isNativePlatform()) void TextToSpeech.stop(); if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel(); } catch { /* */ } }
