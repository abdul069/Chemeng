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
  quran_reciter: string; quran_translation: string; language: string;
  briefing_morning: string; briefing_evening: string; briefing_push: string;
  country: string; waste_ical: string; waste_notify: string; ha_url: string; ha_entities: string; ha_scenes: string; ha_configured?: boolean;
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
  /** merknaam van deze server (BRAND_NAME) */
  brand?: { name: string };
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
  | { valid: true; kind: "agenda"; from: string; level: string }
  | { valid: true; kind: "link"; from: string; household: string };
export type ShareKind = "events" | "photos" | "notes" | "birthdays";
export interface FamilyLink { id: string; otherId: string; otherName: string; myShare: ShareKind[]; theirShare: ShareKind[]; createdAt: string }
export interface FamilyCard {
  linkId: string; household: string; name: string;
  members: { id: string; name: string; color: string; avatar: string; photo: string | null }[];
  events: { on: string; title: string; startTime: string | null; endTime: string | null; allDay: boolean; members: string[] }[];
  birthdays: { name: string; date: string; days: number; age: number | null }[];
  photos: { id: string; filename: string; householdId: string }[];
  notes: { id: string; text: string; color: string; author: string | null; createdAt: string; pinned: boolean }[];
  shares: ShareKind[];
}
export type Proposal =
  | { id: string; kind: "plan_meal"; title: string; why: string; date: string; slot: "diner" | "lunch" | "ontbijt"; recipeId: string; recipe: string }
  | { id: string; kind: "move_event"; title: string; why: string; eventId: string; on: string; newStart: string; newEnd: string }
  | { id: string; kind: "add_list"; title: string; why: string; items: string[] }
  | { id: string; kind: "remind"; title: string; why: string; memberId: string | null; text: string }
  | { id: string; kind: "upkeep_event"; title: string; why: string; upkeepId: string; date: string; eventTitle: string; memberId: string | null }
  | { id: string; kind: "ha_service"; title: string; why: string; domain: string; service: string; data: Record<string, unknown> }
  | { id: string; kind: "link"; title: string; why: string; url: string };
export interface BriefingItem { icon: string; text: string; memberId?: string | null; kind: string }
export interface Briefing { kind: "morning" | "evening"; date: string; memberId: string | null; title: string; narration: string; items: BriefingItem[]; proposals: Proposal[]; conflicts: number }
export interface Memory { id: string; text: string; memberId: string | null; source: string; createdAt: string }
export type Plan = "free" | "gezin" | "plus" | "operator";
export interface Subscription { plan: Plan; source: string; partnerId: string | null; partnerName: string | null; discountPct: number; validUntil: string | null }
export interface Billing { plan: Plan; planLabel: string; usedMicro: number; budgetMicro: number | null; pct: number; blocked: boolean; perTask: { task: string; calls: number; costMicro: number }[]; subscription: Subscription; models: { chat: string; light: string; premium: string }; plans: { id: Plan; label: string; budgetMicro: number }[] }
export interface Partner { id: string; name: string; slug: string; plan: Plan; freeMonths: number; discountPct: number; verify: string; domains: string; note: string; createdAt: string; stats: { redeemed: number; inFreePeriod: number; activeInFreePeriod: number; afterFreePeriod: number; retainedAfterFree: number; codes: { code: string; maxUses: number; uses: number; expiresAt: string | null }[] } }
export interface Device { id: string; name: string; role: "hub" | "phone"; variant: string; platform: string; memberId: string | null; userId: string | null; lastSeen: string; online: boolean }
export interface Note { id: string; text: string; color: string; memberId: string | null; pinned: boolean; createdAt: string }
export interface Cast { to: string | null; kind: "recipe" | "screen" | "message" | "note"; value: string; from: string | null }
export type Topic = "members" | "events" | "chores" | "meals" | "recipes" | "lists" | "photos" | "calendars" | "settings" | "rewards" | "access" | "sharing" | "memos" | "ezan" | "diet" | "devices" | "notes" | "family" | "home" | "connections" | "prices";
export type Change =
  | { kind: "event_added"; event: CalEvent }
  | { kind: "event_removed"; title: string }
  | { kind: "meal"; date: string; slot: string; title: string }
  | { kind: "chore"; title: string; member: string }
  | { kind: "list"; list: string; items: string[] }
  | { kind: "options"; options: string[] }
  | { kind: "recipe"; id: string; title: string; image: string | null };

/** Koppelingen: de catalogus (wat bestaat) en de verbindingen (wat dit gezin aanzette). */
export type ConnField = { key: string; label: string; type: "text" | "url" | "secret" | "select" | "multiselect" | "number" | "time" | "textarea"; options?: { value: string; label: string }[]; placeholder?: string; required?: boolean; hint?: string };
export interface Connector { id: string; name: string; description: string; category: string; categoryLabel: string; icon: string; scope: "household" | "member"; plan: "gezin" | "plus"; country: string[]; status: "ready" | "unofficial" | "soon"; fields: ConnField[]; provides: string[]; refreshMinutes: number; recommended: boolean; connected: boolean }
export interface Connection { id: string; memberId: string | null; connector: string; config: Record<string, unknown>; enabled: boolean; onBoard: boolean; lastSync: string | null; status: string; error: string }
export interface ConnWidget { id: string; connector: string; memberId: string | null; widget: { title: string; icon: string; lines: { icon?: string; text: string; sub?: string; url?: string }[] } }
export interface ConnLink { label: string; url: string; icon: string; connector: string }

/** Het huis: onderhoud en keuringen, afvalkalender, gezondheid, slim huis. */
export type UpkeepStatus = "ok" | "soon" | "due" | "late" | "none";
export interface Upkeep { id: string; title: string; category: string; icon: string; intervalMonths: number; lastDone: string | null; nextDue: string | null; leadDays: number; memberId: string | null; provider: string; providerPhone: string; providerUrl: string; cost: string; notes: string; attest: string | null; daysLeft: number | null; status: UpkeepStatus; log: { id: string; doneOn: string; note: string }[] }
export interface UpkeepTemplate { key: string; title: string; titleTr: string; category: string; icon: string; intervalMonths: number; leadDays: number; notes: string }
export interface WasteRule { id: string; fraction: string; weekday: number; everyWeeks: number; startDate: string; notes: string }
export interface WasteData { rules: WasteRule[]; next: { date: string; fractions: string[] }[]; fractions: { id: string; nl: string; tr: string; icon: string }[] }
export type HealthKind = "visit" | "checkup" | "vaccine" | "medication";
export interface HealthItem { id: string; memberId: string; kind: HealthKind; title: string; date: string | null; time: string | null; provider: string; providerPhone: string; notes: string; followUpMonths: number; times: string; days: number[]; stock: number | null; done: boolean; createdAt: string }
export interface HaState { entity_id: string; state: string; attributes: Record<string, unknown>; last_changed: string }

/** Prijsgeheugen */
export interface Price { id: string; receiptId: string | null; product: string; label: string; store: string; seenOn: string; price: number; qty: number; unit: "kg" | "l" | "st"; unitPrice: number; source: string }
export interface PriceInfo { text: string; latest: Price | null; cheapest: Price | null; byStore: Price[] }
export interface StoreTotal { store: string; total: number; known: number; items: { text: string; price: number }[] }
export interface ScanResult { store: string; date: string; total: number | null; items: { label: string; qty: number; unit: "kg" | "g" | "l" | "ml" | "st"; price: number }[] }
