// De namen worden in-place aangepast bij een taalwissel (zie i18n.ts), zodat alle schermen dezelfde arrays blijven gebruiken.
export const DAYS = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
export const DSHORT = ["zo", "ma", "di", "wo", "do", "vr", "za"];
export const MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
export const MSHORT = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const NAMES = {
  nl: { days: [...DAYS], dshort: [...DSHORT], months: [...MONTHS], mshort: [...MSHORT] },
  en: { days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], dshort: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], mshort: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] },
  tr: { days: ["pazar", "pazartesi", "salı", "çarşamba", "perşembe", "cuma", "cumartesi"], dshort: ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"], months: ["ocak", "şubat", "mart", "nisan", "mayıs", "haziran", "temmuz", "ağustos", "eylül", "ekim", "kasım", "aralık"], mshort: ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"] },
};
let dateLang: "nl" | "tr" | "en" = "nl";
export function applyDateLang(l: "nl" | "tr" | "en") {
  dateLang = l;
  const n = NAMES[l];
  DAYS.splice(0, DAYS.length, ...n.days); DSHORT.splice(0, DSHORT.length, ...n.dshort);
  MONTHS.splice(0, MONTHS.length, ...n.months); MSHORT.splice(0, MSHORT.length, ...n.mshort);
}

const pad = (n: number) => String(n).padStart(2, "0");
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (s: string, n: number) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
export const addMonths = (s: string, n: number) => { const d = parse(s); return iso(new Date(d.getFullYear(), d.getMonth() + n, 1)); };
export const todayIso = () => iso(new Date());
export const weekday = (s: string) => parse(s).getDay();
export const startOfWeek = (s: string, weekStart = 1) => addDays(s, -((weekday(s) - weekStart + 7) % 7));
export const startOfMonth = (s: string) => s.slice(0, 8) + "01";
export const toMin = (t: string | null) => { if (!t) return 0; const [h, m] = t.split(":").map(Number); return h * 60 + m; };
export const fmtTime = (t: string | null) => { if (!t) return ""; const [h, m] = t.split(":"); return m === "00" ? `${+h}u` : `${+h}:${m}`; };
export const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
export const clock = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const longDate = (s: string) => { const d = parse(s); return dateLang === "en" ? `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}` : dateLang === "tr" ? `${d.getDate()} ${cap(MONTHS[d.getMonth()])} ${cap(DAYS[d.getDay()])}` : `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
export const shortDate = (s: string) => { const d = parse(s); return dateLang === "tr" ? `${d.getDate()} ${MSHORT[d.getMonth()]} ${DSHORT[d.getDay()]}` : `${DSHORT[d.getDay()]} ${d.getDate()} ${MSHORT[d.getMonth()]}`; };
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function relDay(s: string): string {
  const diff = Math.round((parse(s).getTime() - parse(todayIso()).getTime()) / 864e5);
  if (diff === 0) return dateLang === "tr" ? "Bugün" : dateLang === "en" ? "Today" : "Vandaag";
  if (diff === 1) return dateLang === "tr" ? "Yarın" : dateLang === "en" ? "Tomorrow" : "Morgen";
  if (diff === -1) return dateLang === "tr" ? "Dün" : dateLang === "en" ? "Yesterday" : "Gisteren";
  return cap(longDate(s));
}

export function fmtRange(e: { allDay: boolean; startTime: string | null; endTime: string | null; on?: string; until?: string; date: string; endDate: string | null }) {
  const multi = (e.until ?? e.endDate) && (e.until ?? e.endDate) !== (e.on ?? e.date);
  if (e.allDay) return multi ? `${dateLang === "tr" ? "→" : "t/m"} ${shortDate((e.until ?? e.endDate)!)}` : dateLang === "tr" ? "Tüm gün" : "Hele dag";
  return `${fmtTime(e.startTime)} – ${fmtTime(e.endTime)}`;
}

export function greeting() {
  const h = new Date().getHours();
  if (dateLang === "tr") return h < 6 ? "İyi geceler" : h < 12 ? "Günaydın" : h < 18 ? "İyi günler" : "İyi akşamlar";
  if (dateLang === "en") return h < 6 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return h < 6 ? "Goeienacht" : h < 12 ? "Goeiemorgen" : h < 18 ? "Goeiemiddag" : "Goeienavond";
}
export const diffDays = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 864e5);
