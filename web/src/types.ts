export interface Member { id: string; name: string; color: string; avatar: string; photo: string | null; role: "ouder" | "kind"; sort: number }
export type Repeat = "none" | "daily" | "weekly" | "biweekly" | "monthly" | "yearly";
export interface CalEvent {
  id: string; title: string; notes: string; location: string;
  date: string; endDate: string | null; startTime: string | null; endTime: string | null;
  allDay: boolean; repeat: Repeat; repeatUntil: string | null; exdates: string[];
  members: string[]; source: string; readOnly: boolean;
}
export interface Occurrence extends CalEvent { on: string; until: string; key: string }
export interface Chore { id: string; memberId: string; title: string; icon: string; days: number[]; points: number }
export interface Reward { id: string; title: string; icon: string; cost: number }
export interface Points { earned: number; spent: number; balance: number }
export interface ListItem { id: string; text: string; done: boolean }
export interface List { id: string; name: string; icon: string; items: ListItem[] }
export interface Recipe { id: string; title: string; ingredients: string; instructions: string; minutes: number | null }
export interface Meal { date: string; slot: Slot; title: string; recipeId: string | null }
export type Slot = "ontbijt" | "lunch" | "diner" | "snack";
export interface Photo { id: string; filename: string; created_at: string }
export interface CalendarSub { id: string; name: string; url: string; members: string[]; lastSync: string | null; lastError: string | null }
export interface Settings {
  family_name: string; city: string; latitude: string; longitude: string;
  screensaver_minutes: string; week_start: string; assistant_voice: string; has_pin: boolean;
}
export interface Weather {
  city: string;
  current: { temp: number; code: number; label: string; icon: string; wind: number };
  days: { date: string; max: number; min: number; code: number; label: string; icon: string; rain: number }[];
}
export interface Bootstrap {
  members: Member[]; chores: Chore[]; rewards: Reward[]; points: Record<string, Points>;
  lists: List[]; recipes: Recipe[]; calendars: CalendarSub[]; photos: Photo[]; settings: Settings;
  assistant: { available: boolean; model: string };
}
export type Topic = "members" | "events" | "chores" | "meals" | "recipes" | "lists" | "photos" | "calendars" | "settings" | "rewards";
export type Change =
  | { kind: "event_added"; event: CalEvent }
  | { kind: "event_removed"; title: string }
  | { kind: "meal"; date: string; slot: string; title: string }
  | { kind: "chore"; title: string; member: string }
  | { kind: "list"; list: string; items: string[] };
