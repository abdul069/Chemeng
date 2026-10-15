// Spraak via de browser: herkenning (Chrome, Edge, Android) en voorlezen (alle moderne browsers).
type Rec = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};

const Ctor = (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition;

export const canListen = () => !!Ctor;

export function listen(handlers: { onPartial: (t: string) => void; onFinal: (t: string) => void; onEnd: () => void; onError: (msg: string) => void }) {
  if (!Ctor) { handlers.onError("Spraakherkenning werkt niet in deze browser. Typ je vraag of gebruik Chrome."); handlers.onEnd(); return () => {}; }
  const rec = new Ctor();
  rec.lang = "nl-BE";
  rec.interimResults = true;
  rec.continuous = false;
  let finalSent = false;
  rec.onresult = (e) => {
    const results = Array.from(e.results);
    const text = results.map((r) => r[0].transcript).join("");
    if (results[results.length - 1].isFinal) { finalSent = true; handlers.onFinal(text.trim()); }
    else handlers.onPartial(text);
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") handlers.onError("Geef de app toegang tot de microfoon om te praten.");
    else if (e.error === "no-speech") handlers.onError("Ik hoorde niets. Probeer opnieuw.");
    else if (e.error !== "aborted") handlers.onError("De microfoon werkte niet. Probeer opnieuw.");
  };
  rec.onend = () => { handlers.onEnd(); void finalSent; };
  try { rec.start(); } catch { handlers.onEnd(); }
  return () => { try { rec.abort(); } catch { /* */ } };
}

let voice: SpeechSynthesisVoice | null = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  voice = vs.find((v) => v.lang === "nl-BE") ?? vs.find((v) => v.lang.startsWith("nl")) ?? null;
}
if ("speechSynthesis" in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

export function speak(text: string, onEnd?: () => void) {
  if (!("speechSynthesis" in window)) { onEnd?.(); return; }
  speechSynthesis.cancel();
  const clean = text.replace(/[*_#`>]/g, "").replace(/\n+/g, ". ");
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = voice?.lang ?? "nl-BE";
  if (voice) u.voice = voice;
  u.rate = 1.02;
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  speechSynthesis.speak(u);
}
export const stopSpeaking = () => { if ("speechSynthesis" in window) speechSynthesis.cancel(); };
