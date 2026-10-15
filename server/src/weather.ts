// Weerbericht via Open-Meteo (gratis, geen sleutel nodig).
import { getSettings } from "./db.js";

export interface Weather {
  city: string;
  current: { temp: number; code: number; label: string; icon: string; wind: number };
  days: { date: string; max: number; min: number; code: number; label: string; icon: string; rain: number }[];
}

const CODES: [number[], string, string][] = [
  [[0], "Zonnig", "☀️"],
  [[1, 2], "Licht bewolkt", "🌤️"],
  [[3], "Bewolkt", "☁️"],
  [[45, 48], "Mist", "🌫️"],
  [[51, 53, 55, 56, 57], "Motregen", "🌦️"],
  [[61, 63, 65, 66, 67, 80, 81, 82], "Regen", "🌧️"],
  [[71, 73, 75, 77, 85, 86], "Sneeuw", "🌨️"],
  [[95, 96, 99], "Onweer", "⛈️"],
];
const describe = (code: number) => {
  const hit = CODES.find(([c]) => c.includes(code));
  return { label: hit?.[1] ?? "Onbekend", icon: hit?.[2] ?? "🌡️" };
};

let cache: { key: string; at: number; data: Weather } | null = null;

export async function getWeather(): Promise<Weather> {
  const s = getSettings();
  const key = `${s.latitude},${s.longitude}`;
  if (cache && cache.key === key && Date.now() - cache.at < 20 * 60_000) return cache.data;
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: s.latitude, longitude: s.longitude, timezone: "auto", forecast_days: "7",
    current: "temperature_2m,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
  }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Weerdienst gaf foutcode ${res.status}`);
  const j = (await res.json()) as {
    current: { temperature_2m: number; weather_code: number; wind_speed_10m: number };
    daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[] };
  };
  const data: Weather = {
    city: s.city,
    current: { temp: Math.round(j.current.temperature_2m), code: j.current.weather_code, wind: Math.round(j.current.wind_speed_10m), ...describe(j.current.weather_code) },
    days: j.daily.time.map((date, i) => ({
      date, max: Math.round(j.daily.temperature_2m_max[i]), min: Math.round(j.daily.temperature_2m_min[i]),
      code: j.daily.weather_code[i], rain: j.daily.precipitation_probability_max[i] ?? 0, ...describe(j.daily.weather_code[i]),
    })),
  };
  cache = { key, at: Date.now(), data };
  return data;
}

export async function geocode(q: string) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.search = new URLSearchParams({ name: q, count: "5", language: "nl", format: "json" }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Zoeken gaf foutcode ${res.status}`);
  const j = (await res.json()) as { results?: { name: string; latitude: number; longitude: number; country?: string; admin1?: string }[] };
  return (j.results ?? []).map((r) => ({ name: r.name, latitude: r.latitude, longitude: r.longitude, region: [r.admin1, r.country].filter(Boolean).join(", ") }));
}
