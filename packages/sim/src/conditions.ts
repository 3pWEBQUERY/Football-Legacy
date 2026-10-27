/**
 * Spielbedingungen: Wetter (nach Land und Monat) und Schiedsrichter (Strenge).
 * Beides wird deterministisch aus Seed und Spiel bestimmt und wirkt in der
 * Engine: Regen und Schnee erschweren Technik und Torhüter, Wind lange Bälle,
 * Hitze kostet Kondition; strenge Schiedsrichter zeigen mehr Karten.
 */
import { COUNTRY_BY_CODE } from "./data/countries";
import { NAME_POOLS } from "./data/names";
import { Rng, clamp, seedFor } from "./rng";
import type { AttrKey } from "./types";

export type WeatherKind = "sunny" | "cloudy" | "rain" | "heavyRain" | "snow" | "wind" | "heat" | "fog";

export const WEATHER: Record<WeatherKind, { label: string; icon: string; text: string }> = {
  sunny: { label: "Sonnig", icon: "☀️", text: "Beste Bedingungen." },
  cloudy: { label: "Bewölkt", icon: "☁️", text: "Gute Bedingungen." },
  rain: { label: "Regen", icon: "🌧️", text: "Nasser Rasen: Ballannahme, Pässe und Torhüter leiden etwas." },
  heavyRain: { label: "Starkregen", icon: "⛈️", text: "Tiefer Boden: deutlich mehr Fehler, Torhüter rutschen öfter weg, mehr Kraftaufwand." },
  snow: { label: "Schnee", icon: "🌨️", text: "Schwer bespielbar: Technik und Tempo leiden, Kraft zählt mehr." },
  wind: { label: "Starker Wind", icon: "💨", text: "Flanken, Fernschüsse und lange Bälle werden ungenauer." },
  heat: { label: "Hitze", icon: "🔥", text: "Die Kraft lässt schneller nach – Wechsel werden wichtiger." },
  fog: { label: "Nebel", icon: "🌫️", text: "Eingeschränkte Sicht: lange Pässe und Übersicht leiden leicht." },
};

/** Faktor je Attribut (nur abweichende Werte). */
export const WEATHER_MODS: Record<WeatherKind, Partial<Record<AttrKey, number>>> = {
  sunny: {},
  cloudy: {},
  rain: { firstTouch: 0.96, passing: 0.97, technique: 0.97, goalkeeping: 0.96 },
  heavyRain: { firstTouch: 0.92, passing: 0.94, technique: 0.94, dribbling: 0.95, goalkeeping: 0.93, pace: 0.97 },
  snow: { firstTouch: 0.93, passing: 0.94, technique: 0.94, dribbling: 0.93, pace: 0.95, goalkeeping: 0.96 },
  wind: { crossing: 0.93, longShots: 0.92, freeKicks: 0.94, vision: 0.97 },
  heat: {},
  fog: { vision: 0.95, crossing: 0.97, longShots: 0.96 },
};

/** Zusätzlicher Konditionsverbrauch. */
export const WEATHER_STAMINA: Record<WeatherKind, number> = {
  sunny: 1, cloudy: 1, rain: 1.03, heavyRain: 1.1, snow: 1.1, wind: 1.02, heat: 1.3, fog: 1,
};

export interface Referee { name: string; strictness: number }
export interface MatchConditions { weather: WeatherKind; temperature: number; referee: Referee }

export function refereeStyle(strictness: number): "streng" | "normal" | "grosszügig" {
  return strictness >= 1.12 ? "streng" : strictness <= 0.88 ? "grosszügig" : "normal";
}

const SOUTH = new Set(["ARG", "URU", "CHI", "PAR", "BRA", "BOL", "PER", "RSA", "AUS", "NZL"]);
const CLIMATE_REGION: Record<string, [number, number]> = {
  nordic: [5, 9], slavicE: [6, 12], slavicW: [9, 10], de: [10, 9], nl: [11, 7], hu: [11, 11], ro: [11, 11], caucasus: [12, 11],
  en: [10, 6], fr: [12, 8], es: [16, 8], it: [15, 9], pt: [16, 6], gr: [17, 9], balkan: [13, 10], tr: [14, 10],
  br: [22, 4], latam: [20, 5], arab: [24, 9], persian: [18, 12], waf: [27, 2], eaf: [19, 5], jp: [15, 10], kr: [13, 13],
  cn: [15, 13], sea: [27, 1.5], in: [25, 6],
};
const CLIMATE_CODE: Record<string, [number, number]> = {
  ISL: [4, 6], RUS: [5, 14], KAZ: [7, 16], CAN: [6, 14], USA: [13, 10], AUS: [18, 6], JAM: [27, 1.5], TRI: [27, 1.5],
  HAI: [27, 1.5], MLT: [19, 6], GIB: [19, 6], CYP: [19, 8], MEX: [21, 4], ARG: [16, 7], URU: [16, 6], CHI: [14, 6],
};

/** Mittlere Temperatur eines Landes im Monat (1–12). */
export function monthTemperature(countryCode: string, month: number): number {
  const region = COUNTRY_BY_CODE[countryCode]?.region ?? "de";
  const [mean, amp] = CLIMATE_CODE[countryCode] ?? CLIMATE_REGION[region] ?? [12, 8];
  // Wärmster Monat: Juli (Norden) bzw. Januar (Süden)
  const peak = SOUTH.has(countryCode) ? 1 : 7;
  return mean + amp * Math.cos(((month - peak) / 12) * 2 * Math.PI);
}

export function weatherFor(seed: number, key: string | number, countryCode: string, month: number): { kind: WeatherKind; temperature: number } {
  const rng = new Rng(seedFor(seed, "weather", key));
  const temperature = Math.round(monthTemperature(countryCode, month) + rng.normal(0, 3.5));
  const autumn = SOUTH.has(countryCode) ? month >= 4 && month <= 7 : month >= 10 || month <= 2;
  const weights: [WeatherKind, number][] = [
    ["sunny", temperature >= 12 ? 30 : 14],
    ["cloudy", 30],
    ["rain", autumn ? 22 : 13],
    ["heavyRain", autumn ? 6 : 3],
    ["snow", temperature <= 1 ? 28 : temperature <= 3 ? 8 : 0],
    ["wind", 7],
    ["heat", temperature >= 30 ? 45 : temperature >= 27 ? 18 : 0],
    ["fog", autumn && temperature <= 10 ? 6 : 0],
  ];
  const kind = weights[rng.weighted(weights.map((w) => w[1]))][0];
  return { kind, temperature };
}

export function refereeFor(seed: number, key: string | number, countryCode: string): Referee {
  const rng = new Rng(seedFor(seed, "referee", key));
  const pool = NAME_POOLS[COUNTRY_BY_CODE[countryCode]?.region ?? "de"] ?? NAME_POOLS.de;
  // Ein fester Stamm von Schiedsrichtern je Land: Namen wiederholen sich über die Saison
  const ref = new Rng(seedFor(seed, "referee-pool", countryCode, rng.int(0, 19)));
  const name = `${ref.pick(pool.first)} ${ref.pick(pool.last)}`;
  const strictness = Math.round(clamp(ref.normal(1, 0.15), 0.7, 1.35) * 100) / 100;
  return { name, strictness };
}

export function conditionsFor(seed: number, key: string | number, countryCode: string, month: number): MatchConditions {
  const w = weatherFor(seed, key, countryCode, month);
  return { weather: w.kind, temperature: w.temperature, referee: refereeFor(seed, key, countryCode) };
}
