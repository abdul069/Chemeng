export interface Member { id: string; name: string; color: string; avatar: string; photo: string | null; role: "ouder" | "kind" | "huisdier"; sort: number; userId?: string | null; shared?: boolean; level?: "details" | "bezet"; birthday?: string | null; diet?: string }
export type Repeat = "none" | "daily" | "weekly" | "biweekly" | "monthly" | "yearly";
export interface CalEvent {
  id: string; title: string; notes: string; location: string;
  date: string; endDate: string | null; startTime: string | null; endTime: string | null;
  allDay: boolean; repeat: Repeat; repeatUntil: string | null; exdates: string[];
  members: string[]; source: string; readOnly: boolean; countdown: boolean;
}
export interface Occurrence extends CalEvent { on: string; until: string; key: string }
export type Moment = "ochtend" | "middag" | "avond" | "altijd";
export interface Chore { id: string; memberId: string; title: string; icon: string; days: number[]; points: number; moment: Moment; streak: number }
export interface Countdown { title: string; date: string; days: number; icon: string; memberId: string | null; kind: "birthday" | "event" | "holiday" }
export interface Reward { id: string; title: string; icon: string; cost: number }
export interface Points { earned: number; spent: number; balance: number; today: number; week: number }
export interface ListItem { id: string; text: string; done: boolean; /** houdbaar tot (voorraad) */ expires: string | null; qty: string; /** persoonlijke to-do van dit gezinslid */ memberId?: string | null; /** afdeling in de winkel, handmatig gekozen (anders automatisch) */ aisle?: string | null }
export interface List { id: string; name: string; icon: string; kind: "list" | "pantry" | "shopping"; items: ListItem[] }
export interface Staple { id: string; text: string; aisle: string | null }
export const isShopping = (l: Pick<List, "kind" | "name">) => l.kind === "shopping" || (l.kind === "list" && /boodschap|alışveriş|alisveris/i.test(l.name));
export interface Recipe {
  id: string; title: string; ingredients: string; instructions: string; minutes: number | null; image: string | null; sourceUrl: string | null; servings: string; cuisine: string;
  /** taal van de getoonde versie */ lang: string;
  /** het origineel, bv. Turks */ original: { title: string; ingredients: string; instructions: string; lang: string } | null;
  category: string; favorite: boolean; cooked: number;
}
export interface RecipeHit { title: string; original: string; url: string; site: string; image: string | null; minutes: number | null }
export interface Memo { id: string; title: string; filename: string; seconds: number; createdAt: string; by: string | null }
export interface Meal { date: string; slot: Slot; title: string; recipeId: string | null; image: string | null }
export interface DishPhoto { url: string; source: string; title: string }
export type Slot = "ontbijt" | "lunch" | "diner" | "snack";
export interface Photo { id: string; filename: string; created_at: string }
export interface CalendarSub { id: string; name: string; url: string; members: string[]; lastSync: string | null; lastError: string | null }
export interface Settings {
  family_name: string; city: string; latitude: string; longitude: string;
  screensaver_minutes: string; week_start: string; assistant_voice: string; holidays: string; has_pin: boolean;
  sleep_from: string; sleep_until: string; home_after_minutes: string;
  ezan_on: string; ezan_method: string; ezan_asr: string; ezan_prayers: string; ezan_sounds: string; ezan_adjust: string; ezan_volume: string;
  quran_reciter: string; quran_translation: string;
}
export type Prayer = "fajr" | "sunrise" | "dhuhr" | "asr" | "maghrib" | "isha";
export interface PrayerDay { date: string; times: Record<Prayer, string>; tomorrow: Record<Prayer, string>; methods: { id: string; label: string }[]; city: string }
export interface EzanSound { id: string; name: string; filename: string }
export interface SurahInfo { number: number; name: string; englishName: string; englishNameTranslation: string; numberOfAyahs: number; revelationType: string }
export interface Ayah { number: number; numberInSurah: number; text: string; translation: string; juz: number; page: number; sajda: boolean }
export interface Surah extends SurahInfo { translationId: string; ayahs: Ayah[] }
export interface Weather {
  city: string;
  current: { temp: number; code: number; label: string; icon: string; wind: number };
  days: { date: string; max: number; min: number; code: number; label: string; icon: string; rain: number }[];
}
export interface Bootstrap {
  /** bouwnummer van de server; verschilt het van dit scherm, dan is er een nieuwe versie */
  build?: string | null;
  members: Member[]; chores: Chore[]; rewards: Reward[]; points: Record<string, Points>;
  lists: List[]; recipes: Recipe[]; calendars: CalendarSub[]; photos: Photo[]; settings: Settings;
  assistant: { available: boolean; model: string; keySource?: "env" | "app" | null; canEditKey?: boolean };
  /** Mensen buiten het gezin die hun agenda met jou delen */
  shared: Member[];
  countdowns: Countdown[];
  me: { id: string; name: string; email: string; role: "beheerder" | "lid"; memberId: string | null };
}
export interface Me { user: { id: string; email: string; name: string; color: string }; households: { id: string; name: string; role: "beheerder" | "lid"; memberId: string | null }[]; householdId: string | null }
export interface HouseholdUser { id: string; name: string; email: string; role: "beheerder" | "lid"; memberId: string | null }
export interface ShareRow { id: string; name: string; email: string; level: "details" | "bezet"; iShareBack?: boolean }
export interface Invite { id: string; kind: "household" | "agenda"; memberId: string | null; role: string; label: string; expiresAt: string }
export type InviteInfo =
  | { valid: false; reason: string }
  | { valid: true; kind: "household"; from: string; household: string; member: string | null; role: string }
  | { valid: true; kind: "agenda"; from: string; level: string };
export type Topic = "members" | "events" | "chores" | "meals" | "recipes" | "lists" | "photos" | "calendars" | "settings" | "rewards" | "access" | "sharing" | "memos" | "ezan";
export type Change =
  | { kind: "event_added"; event: CalEvent }
  | { kind: "event_removed"; title: string }
  | { kind: "meal"; date: string; slot: string; title: string }
  | { kind: "chore"; title: string; member: string }
  | { kind: "list"; list: string; items: string[] }
  | { kind: "options"; options: string[] }
  | { kind: "recipe"; id: string; title: string; image: string | null };
