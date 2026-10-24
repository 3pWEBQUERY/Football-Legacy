/**
 * Spielergesichter: aus Spieler-ID, Name und Nationalität wird ein festes
 * Porträt erzeugt (Kopfform, Haut, Haare, Augen, Nase, Mund, Bart). Das Alter
 * verändert das Gesicht über die Karriere: Geheimratsecken, graue Haare,
 * Falten. Ausgabe ist ein eigenständiges SVG.
 */
import { COUNTRY_BY_CODE } from "./data/countries";
import { Rng, hashString } from "./rng";

export interface FaceInput {
  id: number;
  /** Vollständiger Name (Teil des Seeds) */
  name: string;
  age: number;
  nationality: string;
}

export interface FaceKit {
  primary: string;
  secondary: string;
}

type Texture = "straight" | "wavy" | "curly" | "coily";
type Ancestry = "nordic" | "west" | "central" | "south" | "east" | "mena" | "africa" | "eastAsia" | "southAsia" | "seAsia" | "latin" | "pacific";

/** Hauttöne von hell bis dunkel */
const SKIN = [
  "#f3d5c0", "#ecc7ac", "#e4b897", "#d9a783", "#cd9672", "#be8462",
  "#ab7152", "#955e42", "#7d4d35", "#683f2c", "#553323", "#45291d",
];
const HAIR = {
  black: "#17130f", darkBrown: "#2b1f17", brown: "#47321f", lightBrown: "#6a4c31",
  darkBlond: "#8f6c43", blond: "#bb9455", lightBlond: "#d4b67a", red: "#8a4524", auburn: "#5f2e1b",
} as const;
type HairColor = keyof typeof HAIR;
const EYES = { darkBrown: "#2c1a10", brown: "#4b2e18", hazel: "#6b5226", green: "#4d6b3c", blue: "#4f7396", grey: "#6f7c86" } as const;
type EyeColor = keyof typeof EYES;

interface AncestryProfile {
  skin: [number, number];
  hair: Partial<Record<HairColor, number>>;
  eyes: Partial<Record<EyeColor, number>>;
  texture: [number, number, number, number];
  monolid: number;
  nose: [number, number];
  lips: [number, number];
  beard: number;
}

const ANCESTRY: Record<Ancestry, AncestryProfile> = {
  nordic: { skin: [0, 2], hair: { lightBlond: 3, blond: 4, darkBlond: 4, lightBrown: 3, brown: 2, red: 1 }, eyes: { blue: 5, grey: 2, green: 2, hazel: 1, brown: 1 }, texture: [6, 3, 1, 0], monolid: 0, nose: [3.6, 4.6], lips: [0.9, 1.4], beard: 1 },
  west: { skin: [0, 3], hair: { blond: 1, darkBlond: 3, lightBrown: 4, brown: 4, darkBrown: 3, red: 1, auburn: 1 }, eyes: { blue: 3, grey: 1, green: 2, hazel: 2, brown: 3 }, texture: [5, 4, 1, 0], monolid: 0, nose: [3.7, 4.8], lips: [1, 1.5], beard: 1 },
  central: { skin: [0, 3], hair: { blond: 1, darkBlond: 3, lightBrown: 4, brown: 5, darkBrown: 4, black: 1 }, eyes: { blue: 3, grey: 2, green: 2, hazel: 2, brown: 4 }, texture: [6, 3, 1, 0], monolid: 0, nose: [3.8, 4.9], lips: [1, 1.5], beard: 1 },
  east: { skin: [0, 2], hair: { blond: 1, darkBlond: 3, lightBrown: 5, brown: 5, darkBrown: 3 }, eyes: { blue: 4, grey: 3, green: 2, hazel: 1, brown: 3 }, texture: [7, 3, 0, 0], monolid: 0.04, nose: [3.8, 4.9], lips: [0.9, 1.4], beard: 0.9 },
  south: { skin: [1, 5], hair: { lightBrown: 1, brown: 4, darkBrown: 6, black: 5 }, eyes: { brown: 6, darkBrown: 4, hazel: 3, green: 1, blue: 1 }, texture: [4, 5, 2, 0], monolid: 0, nose: [4, 5.2], lips: [1.1, 1.6], beard: 1.3 },
  mena: { skin: [2, 6], hair: { darkBrown: 4, black: 7, brown: 1 }, eyes: { darkBrown: 6, brown: 5, hazel: 2, green: 0.5 }, texture: [3, 4, 3, 0.5], monolid: 0, nose: [4.2, 5.4], lips: [1.2, 1.7], beard: 1.6 },
  africa: { skin: [7, 11], hair: { black: 9, darkBrown: 2 }, eyes: { darkBrown: 8, brown: 3 }, texture: [0, 0, 1, 9], monolid: 0, nose: [5, 6.6], lips: [1.6, 2.3], beard: 1 },
  eastAsia: { skin: [0, 3], hair: { black: 8, darkBrown: 3 }, eyes: { darkBrown: 7, brown: 3 }, texture: [9, 1, 0, 0], monolid: 0.75, nose: [3.8, 4.8], lips: [1.1, 1.6], beard: 0.4 },
  southAsia: { skin: [4, 8], hair: { black: 8, darkBrown: 3 }, eyes: { darkBrown: 7, brown: 4 }, texture: [5, 4, 2, 0], monolid: 0, nose: [4.3, 5.4], lips: [1.2, 1.8], beard: 1.3 },
  seAsia: { skin: [3, 7], hair: { black: 8, darkBrown: 3 }, eyes: { darkBrown: 7, brown: 3 }, texture: [7, 2, 1, 0], monolid: 0.5, nose: [4.4, 5.6], lips: [1.3, 1.8], beard: 0.5 },
  latin: { skin: [2, 7], hair: { darkBrown: 5, black: 6, brown: 2 }, eyes: { darkBrown: 6, brown: 5, hazel: 2, green: 0.5 }, texture: [4, 4, 2, 1], monolid: 0, nose: [4.3, 5.6], lips: [1.2, 1.8], beard: 1.1 },
  pacific: { skin: [5, 9], hair: { black: 8, darkBrown: 2 }, eyes: { darkBrown: 7, brown: 3 }, texture: [1, 3, 5, 2], monolid: 0, nose: [5, 6.4], lips: [1.5, 2.1], beard: 1 },
};

/** Herkunftsverteilung je Namensregion */
const REGION_MIX: Record<string, Partial<Record<Ancestry, number>>> = {
  en: { west: 8, africa: 2 }, de: { central: 9, south: 1, mena: 1, africa: 1 }, fr: { west: 5, south: 2, africa: 4, mena: 2 },
  es: { south: 9, latin: 1, africa: 0.5 }, it: { south: 9, africa: 0.4 }, pt: { south: 8, africa: 2 }, nl: { west: 7, africa: 2, mena: 1 },
  nordic: { nordic: 9, africa: 0.6, mena: 0.4 }, slavicE: { east: 10 }, slavicW: { east: 6, central: 4 }, balkan: { south: 5, east: 5 },
  ro: { east: 6, south: 4 }, hu: { central: 5, east: 5 }, gr: { south: 10 }, tr: { mena: 6, south: 4 }, caucasus: { mena: 6, south: 4 },
  arab: { mena: 10, africa: 0.6 }, persian: { mena: 9, south: 1 }, br: { south: 4, latin: 2, africa: 4 }, latam: { latin: 7, south: 3, africa: 0.6 },
  waf: { africa: 10 }, eaf: { africa: 10 }, jp: { eastAsia: 10 }, kr: { eastAsia: 10 }, cn: { eastAsia: 10 }, in: { southAsia: 10 }, sea: { seAsia: 10 },
};

/** Abweichungen für einzelne Länder */
const COUNTRY_MIX: Record<string, Partial<Record<Ancestry, number>>> = {
  ENG: { west: 7, africa: 3, southAsia: 0.3 }, FRA: { west: 4, south: 2, africa: 5, mena: 2 }, BEL: { west: 6, africa: 3, mena: 1 },
  NED: { west: 7, africa: 3, mena: 1 }, POR: { south: 8, africa: 3 }, GER: { central: 8, south: 1, mena: 1, africa: 1.5 },
  SUI: { central: 7, south: 2, africa: 1.5 }, SWE: { nordic: 8, africa: 1, mena: 1 }, IRL: { west: 9, africa: 0.5 }, SCO: { west: 10 },
  USA: { west: 5, africa: 3, latin: 2 }, CAN: { west: 6, africa: 2, latin: 1 }, AUS: { west: 8, south: 1, pacific: 0.5 },
  NZL: { west: 6, pacific: 4 }, JAM: { africa: 10 }, TRI: { africa: 8, southAsia: 2 }, HAI: { africa: 10 }, CUB: { latin: 3, south: 3, africa: 4 },
  DOM: { latin: 4, africa: 6 }, COL: { latin: 7, africa: 2, south: 1 }, ECU: { latin: 7, africa: 3 }, VEN: { latin: 6, south: 2, africa: 2 },
  ARG: { south: 8, latin: 2 }, URU: { south: 8, latin: 1, africa: 1 }, CHI: { latin: 6, south: 4 }, PAN: { latin: 5, africa: 5 },
  CRC: { latin: 7, south: 2, africa: 1 }, HON: { latin: 7, africa: 3 }, RSA: { africa: 8, west: 2 }, CPV: { africa: 7, south: 3 },
  MAD: { africa: 6, seAsia: 4 }, FIJ: { pacific: 8, southAsia: 2 }, PNG: { pacific: 10 }, SOL: { pacific: 10 }, TAH: { pacific: 8, west: 2 },
  NCL: { pacific: 7, west: 3 }, ISR: { mena: 6, central: 4 }, KAZ: { eastAsia: 5, east: 5 }, UZB: { mena: 5, eastAsia: 3, east: 2 },
  KGZ: { eastAsia: 7, east: 3 }, TJK: { mena: 10 }, TKM: { mena: 10 }, SUD: { africa: 7, mena: 3 }, MTN: { mena: 5, africa: 5 },
  EGY: { mena: 9, africa: 1 }, PHI: { seAsia: 9, south: 1 }, SIN: { eastAsia: 6, seAsia: 3, southAsia: 1 }, MAS: { seAsia: 7, eastAsia: 2, southAsia: 1 },
  MLT: { south: 10 }, GIB: { south: 6, west: 4 }, AND: { south: 10 }, SMR: { south: 10 }, CYP: { south: 10 }, AZE: { mena: 8, east: 2 },
  LUX: { central: 6, south: 3, africa: 1 },
};

type HairStyle = "buzz" | "crop" | "sidePart" | "quiff" | "curlyTop" | "afro" | "long" | "shaved" | "bun" | "fade" | "cornrows" | "dreads" | "fringe" | "slick";
type Beard = "none" | "stubble" | "short" | "full" | "goatee" | "moustache";

export interface FaceSpec {
  ancestry: Ancestry;
  skin: number;
  hairColor: string;
  eyeColor: string;
  texture: Texture;
  style: HairStyle;
  beard: Beard;
  monolid: boolean;
  headTop: number;
  foreheadW: number;
  cheekW: number;
  jawW: number;
  chinW: number;
  chinY: number;
  eyeY: number;
  eyeGap: number;
  eyeW: number;
  eyeH: number;
  eyeTilt: number;
  browW: number;
  browArch: number;
  browY: number;
  noseW: number;
  noseY: number;
  noseLen: number;
  mouthW: number;
  mouthY: number;
  upperLip: number;
  lowerLip: number;
  smile: number;
  earSize: number;
  neckW: number;
  volume: number;
  recede: number;
  greyAge: number;
  freckles: boolean;
  collar: "crew" | "vneck" | "polo";
  part: number;
}

function pickWeighted<T extends string>(rng: Rng, weights: Partial<Record<T, number>>): T {
  const keys = Object.keys(weights) as T[];
  return keys[rng.weighted(keys.map((k) => weights[k] ?? 0))];
}

/** Gesichtsmerkmale eines Spielers (ohne Alterseinfluss). */
export function faceSpec(p: FaceInput): FaceSpec {
  const rng = new Rng(hashString(`face|${p.id}|${p.name}`));
  const region = COUNTRY_BY_CODE[p.nationality]?.region ?? "en";
  const mix = COUNTRY_MIX[p.nationality] ?? REGION_MIX[region] ?? { west: 1 };
  const ancestry = pickWeighted(rng, mix);
  const a = ANCESTRY[ancestry];
  const skin = Math.max(0, Math.min(SKIN.length - 1, rng.int(a.skin[0], a.skin[1])));
  const hairKey = pickWeighted(rng, a.hair);
  const eyeKey = pickWeighted(rng, a.eyes);
  const texture = (["straight", "wavy", "curly", "coily"] as const)[rng.weighted(a.texture)];
  const styles: Record<Texture, Partial<Record<HairStyle, number>>> = {
    straight: { crop: 6, sidePart: 4, quiff: 3, buzz: 3, fade: 4, slick: 2, fringe: 2, long: 1, bun: 1, shaved: 1 },
    wavy: { crop: 5, sidePart: 3, quiff: 3, fade: 3, slick: 2, curlyTop: 2, long: 2, bun: 1.5, buzz: 2, shaved: 1 },
    curly: { curlyTop: 6, crop: 3, fade: 3, long: 1.5, afro: 1, buzz: 2, bun: 1, shaved: 1 },
    coily: { buzz: 6, fade: 6, curlyTop: 3, afro: 1.5, cornrows: 1.2, dreads: 1.5, shaved: 2.5 },
  };
  const style = pickWeighted(rng, styles[texture]);
  const beardOdds: Partial<Record<Beard, number>> = p.age < 20
    ? { none: 8, stubble: 2 }
    : { none: 4, stubble: 3 * a.beard, short: 2 * a.beard, full: 0.8 * a.beard, goatee: 0.5, moustache: 0.3 };
  const beard = pickWeighted(rng, beardOdds);
  const monolid = rng.chance(a.monolid);
  const eyeY = rng.range(45.5, 48);
  const chinY = rng.range(74, 78);
  return {
    ancestry, skin,
    hairColor: HAIR[hairKey],
    eyeColor: EYES[eyeKey],
    texture, style, beard, monolid,
    headTop: rng.range(15, 18),
    foreheadW: rng.range(16.5, 19),
    cheekW: rng.range(18, 20.5),
    jawW: rng.range(14.5, 17.5),
    chinW: rng.range(5, 8),
    chinY,
    eyeY,
    eyeGap: rng.range(7.6, 9),
    eyeW: rng.range(6.8, 8.2),
    eyeH: monolid ? rng.range(2, 2.6) : rng.range(2.7, 3.5),
    eyeTilt: monolid ? rng.range(0.3, 0.9) : rng.range(-0.4, 0.5),
    browW: rng.range(1.1, 2.2),
    browArch: rng.range(0.4, 1.8),
    browY: eyeY - rng.range(5, 6.3),
    noseW: rng.range(a.nose[0], a.nose[1]) / 2 + 0.6,
    noseY: eyeY + rng.range(11, 13.5),
    noseLen: rng.range(0.8, 1.2),
    mouthW: rng.range(4.2, 5.6),
    mouthY: chinY - rng.range(9.5, 11.5),
    upperLip: rng.range(a.lips[0], a.lips[1]) * 0.8,
    lowerLip: rng.range(a.lips[0], a.lips[1]),
    smile: rng.chance(0.35) ? rng.range(0.3, 0.9) : rng.range(-0.2, 0.2),
    earSize: rng.range(0.9, 1.1),
    neckW: rng.range(9.5, 12),
    volume: rng.range(0.7, 1.3),
    recede: rng.chance(0.35) ? rng.range(0.3, 1) : rng.range(0, 0.15),
    greyAge: rng.range(31, 42),
    freckles: skin <= 1 && (hairKey === "red" || hairKey === "auburn" || rng.chance(0.12)),
    collar: (["crew", "vneck", "polo"] as const)[rng.weighted([5, 3, 2])],
    part: rng.chance(0.5) ? 1 : -1,
  };
}

/* ---------- Farben ---------- */

function hex(c: string): [number, number, number] {
  const h = c.replace("#", "");
  const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}
function mix(a: string, b: string, t: number): string {
  const x = hex(a);
  const y = hex(b);
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
const safeColor = (c: string | undefined, fallback: string) => (c && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c) ? c : fallback);
const n = (v: number) => (Math.round(v * 100) / 100).toString();

/* ---------- Zeichnen ---------- */

type Pt = [number, number];
type Seg = [Pt, Pt, Pt];

/** Rechte Hälfte (von oben nach unten) spiegeln und zu einem geschlossenen Pfad verbinden. */
function symmetric(start: Pt, segs: Seg[]): string {
  const m = (p: Pt): Pt => [100 - p[0], p[1]];
  const fmt = (p: Pt) => `${n(p[0])},${n(p[1])}`;
  let d = `M${fmt(start)}`;
  for (const s of segs) d += `C${fmt(s[0])} ${fmt(s[1])} ${fmt(s[2])}`;
  const points = [start, ...segs.map((s) => s[2])];
  for (let i = segs.length - 1; i >= 0; i--) d += `C${fmt(m(segs[i][1]))} ${fmt(m(segs[i][0]))} ${fmt(m(points[i]))}`;
  return d + "Z";
}

function headPath(f: FaceSpec): string {
  const cy = f.eyeY + 3;
  const jawY = f.chinY - 9;
  return symmetric([50, f.headTop], [
    [[50 + f.foreheadW * 0.5, f.headTop], [50 + f.foreheadW, f.headTop + 8], [50 + f.foreheadW, f.headTop + 15]],
    [[50 + f.foreheadW, cy - 7], [50 + f.cheekW, cy - 5], [50 + f.cheekW, cy]],
    [[50 + f.cheekW, cy + 8], [50 + f.jawW + 2, jawY - 4], [50 + f.jawW, jawY]],
    [[50 + f.jawW - 0.6, jawY + 5.5], [50 + f.chinW + 3.5, f.chinY], [50, f.chinY]],
  ]);
}

function hairlineY(f: FaceSpec, age: number) {
  const r = f.recede * Math.max(0, Math.min(1, (age - 23) / 14));
  return { center: f.headTop + 10.5 + r * 4, corner: f.headTop + 11.5 + r * 8, r };
}

/** Haarkappe über dem Schädel bis zum Haaransatz. */
function capPath(f: FaceSpec, age: number, vol: number, side: number, fringeDrop = 0): string {
  const { center, corner } = hairlineY(f, age);
  const top = f.headTop - vol;
  const fw = f.foreheadW;
  const sideY = f.eyeY - 1;
  const burn = f.eyeY + 2.2;
  const sw = Math.max(fw + side, f.cheekW + 0.3 + side * 0.3);
  const L = 50 - sw;
  const R = 50 + sw;
  const c = center + fringeDrop;
  const k = corner + fringeDrop * 0.6;
  return [
    `M${n(L)},${n(sideY)}`,
    `L${n(50 - fw - side)},${n(f.headTop + 15)}`,
    `C${n(50 - fw - side)},${n(top + 8 + vol * 0.3)} ${n(50 - (fw + side) * 0.5)},${n(top)} 50,${n(top)}`,
    `C${n(50 + (fw + side) * 0.5)},${n(top)} ${n(50 + fw + side)},${n(top + 8 + vol * 0.3)} ${n(50 + fw + side)},${n(f.headTop + 15)}`,
    `L${n(R)},${n(sideY)}`,
    `L${n(50 + f.cheekW + 0.2)},${n(burn)}`,
    `L${n(50 + f.cheekW - 1.5)},${n(burn)}`,
    `L${n(50 + fw - 1.4)},${n(k + 2)}`,
    `Q${n(50 + fw - 3)},${n(k - 0.5)} ${n(50 + fw - 6)},${n(k)}`,
    `Q${n(50 + 3)},${n(c - 0.4)} 50,${n(c)}`,
    `Q${n(50 - 3)},${n(c - 0.4)} ${n(50 - fw + 6)},${n(k)}`,
    `Q${n(50 - fw + 3)},${n(k - 0.5)} ${n(50 - fw + 1.4)},${n(k + 2)}`,
    `L${n(50 - f.cheekW + 1.5)},${n(burn)}`,
    `L${n(50 - f.cheekW - 0.2)},${n(burn)}Z`,
  ].join("");
}

function bumps(cx: number, cy: number, rx: number, ry: number, from: number, to: number, count: number, r: number, color: string): string {
  let out = "";
  for (let i = 0; i <= count; i++) {
    const t = from + ((to - from) * i) / count;
    const x = cx + Math.cos(t) * rx;
    const y = cy + Math.sin(t) * ry;
    out += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}"${color ? ` fill="${color}"` : ""}/>`;
  }
  return out;
}

interface HairLayers {
  back: string;
  front: string;
}

function hair(f: FaceSpec, age: number, color: string, tex: string): HairLayers {
  const dark = mix(color, "#000000", 0.35);
  const light = mix(color, "#ffffff", 0.22);
  const fw = f.foreheadW;
  const v = f.volume;
  const strands = (count: number, y0: number, y1: number, spread: number) => {
    let s = "";
    for (let i = 0; i < count; i++) {
      const x = 50 - spread + (2 * spread * (i + 0.5)) / count;
      s += `M${n(x)},${n(y0)}Q${n(x + f.part * 2)},${n((y0 + y1) / 2)} ${n(x + f.part * 3.2)},${n(y1)}`;
    }
    return `<path d="${s}" stroke="${dark}" stroke-width="0.45" fill="none" opacity="0.45"/>`;
  };
  const highlight = (top: number) =>
    `<path d="M${n(50 - fw * 0.55)},${n(top + 4)}Q50,${n(top + 0.6)} ${n(50 + fw * 0.4)},${n(top + 3.2)}" stroke="${light}" stroke-width="1.4" fill="none" opacity="0.35" stroke-linecap="round"/>`;
  const { center } = hairlineY(f, age);
  /** Gleiche Form einmal in Haarfarbe und einmal mit Lockenstruktur */
  const textured = (shape: string, op = 0.55) => `<g fill="${color}">${shape}</g><g fill="${tex}" opacity="${op}">${shape}</g>`;
  switch (f.style) {
    case "shaved":
      return { back: "", front: `<path d="${capPath(f, age, 0.3, 0.3)}" fill="${color}" opacity="0.22"/>` };
    case "buzz":
      return { back: "", front: `<g opacity="0.9">${textured(`<path d="${capPath(f, age, 0.8, 0.5)}"/>`, f.texture === "coily" ? 0.5 : 0.2)}</g>` };
    case "crop": {
      const top = f.headTop - 2.4 * v;
      return { back: "", front: `<path d="${capPath(f, age, 2.4 * v, 1)}" fill="${color}"/>${strands(7, top + 2, center - 1, fw - 4)}${highlight(top)}` };
    }
    case "sidePart": {
      const top = f.headTop - 3.4 * v;
      const px = 50 + f.part * 7;
      return {
        back: "",
        front: `<path d="${capPath(f, age, 3.4 * v, 1.2, 0.6)}" fill="${color}"/>`
          + `<path d="M${n(px)},${n(top + 1)}Q${n(px + f.part * 0.6)},${n(top + 5)} ${n(px + f.part * 1.2)},${n(center - 2)}" stroke="${dark}" stroke-width="0.6" fill="none" opacity="0.7"/>`
          + strands(6, top + 2, center - 1, fw - 5) + highlight(top),
      };
    }
    case "quiff": {
      const top = f.headTop - 6.5 * v;
      const quiff = `<path d="M${n(50 - fw + 3)},${n(center + 0.5)}C${n(50 - fw + 2)},${n(top + 2)} ${n(50 - 4)},${n(top - 1)} ${n(50 + 4)},${n(top)}C${n(50 + fw - 1)},${n(top + 1)} ${n(50 + fw)},${n(top + 6)} ${n(50 + fw - 2)},${n(center + 1)}Z" fill="${color}"/>`;
      return { back: "", front: `<path d="${capPath(f, age, 2.2, 0.6)}" fill="${color}" opacity="0.92"/>${quiff}${strands(6, top + 1.5, center - 0.5, fw - 6)}${highlight(top)}` };
    }
    case "slick": {
      const top = f.headTop - 2.2 * v;
      let lines = "";
      for (let i = -3; i <= 3; i++) lines += `M${n(50 + i * 2.6)},${n(center - 0.5)}C${n(50 + i * 2.9)},${n(top + 6)} ${n(50 + i * 3.6)},${n(top + 2)} ${n(50 + i * 4.4)},${n(top + 0.8)}`;
      return { back: "", front: `<path d="${capPath(f, age, 2.2 * v, 0.9)}" fill="${color}"/><path d="${lines}" stroke="${light}" stroke-width="0.5" fill="none" opacity="0.4"/>` };
    }
    case "fringe": {
      const top = f.headTop - 3 * v;
      const drop = 5.5;
      let teeth = `M${n(50 - fw + 1.5)},${n(center + 1)}`;
      for (let i = 0; i <= 8; i++) {
        const x = 50 - fw + 1.5 + ((2 * fw - 3) * i) / 8;
        teeth += `L${n(x)},${n(center + drop + (i % 2 ? -1.2 : 0.4))}`;
      }
      teeth += `L${n(50 + fw - 1.5)},${n(center + 1)}Z`;
      return { back: "", front: `<path d="${capPath(f, age, 3 * v, 1.2)}" fill="${color}"/><path d="${teeth}" fill="${color}"/>${strands(8, top + 2, center + drop - 1, fw - 3)}${highlight(top)}` };
    }
    case "curlyTop": {
      const top = f.headTop - 3 * v;
      return {
        back: "",
        front: textured(`<path d="${capPath(f, age, 2.6 * v, 1)}"/>` + bumps(50, f.headTop + 7, fw - 0.5, 8 + 2.4 * v, Math.PI * 1.04, Math.PI * 1.96, 18, 2.3, "") + bumps(50, f.headTop + 8, fw - 4, 6.5 + 2.4 * v, Math.PI * 1.12, Math.PI * 1.88, 10, 2.2, ""))
          + highlight(top + 1),
      };
    }
    case "afro": {
      const r = fw + 5 + 2 * v;
      const cy = f.headTop + 9;
      return {
        back: textured(`<ellipse cx="50" cy="${n(cy)}" rx="${n(r)}" ry="${n(r - 2)}"/>` + bumps(50, cy, r - 0.5, r - 2.5, Math.PI * 0.9, Math.PI * 2.1, 18, 1.8, "")),
        front: textured(`<path d="${capPath(f, age, 4, 2)}"/>`),
      };
    }
    case "long": {
      const top = f.headTop - 2.6 * v;
      const back = `<path d="M${n(50 - fw - 3)},${n(f.headTop + 8)}C${n(50 - fw - 5)},${n(f.eyeY + 10)} ${n(50 - fw - 4)},${n(f.chinY)} ${n(50 - fw - 1)},${n(f.chinY + 6)}L${n(50 + fw + 1)},${n(f.chinY + 6)}C${n(50 + fw + 4)},${n(f.chinY)} ${n(50 + fw + 5)},${n(f.eyeY + 10)} ${n(50 + fw + 3)},${n(f.headTop + 8)}Z" fill="${dark}"/>`;
      const sides = `<path d="M${n(50 - fw - 1.8)},${n(f.eyeY - 2)}C${n(50 - fw - 2.5)},${n(f.eyeY + 8)} ${n(50 - fw - 1.5)},${n(f.chinY - 4)} ${n(50 - fw + 0.5)},${n(f.chinY + 2)}L${n(50 - fw + 1.6)},${n(f.eyeY - 2)}Z M${n(50 + fw + 1.8)},${n(f.eyeY - 2)}C${n(50 + fw + 2.5)},${n(f.eyeY + 8)} ${n(50 + fw + 1.5)},${n(f.chinY - 4)} ${n(50 + fw - 0.5)},${n(f.chinY + 2)}L${n(50 + fw - 1.6)},${n(f.eyeY - 2)}Z" fill="${color}"/>`;
      return {
        back,
        front: `<path d="${capPath(f, age, 2.6 * v, 1.6, 0.8)}" fill="${color}"/>${sides}`
          + `<path d="M50,${n(top + 1)}L${n(50 + f.part * 0.6)},${n(center)}" stroke="${dark}" stroke-width="0.6" opacity="0.6"/>${strands(8, top + 2, center, fw - 3)}${highlight(top)}`,
      };
    }
    case "bun": {
      const top = f.headTop - 1.6;
      return {
        back: "",
        front: `<path d="${capPath(f, age, 1.6, 0.8)}" fill="${color}"/><ellipse cx="50" cy="${n(top - 2.4)}" rx="4.6" ry="3.4" fill="${color}"/><ellipse cx="50" cy="${n(top - 2.8)}" rx="2.6" ry="1.4" fill="${light}" opacity="0.25"/>`
          + `<path d="M${n(50 - 6)},${n(center - 0.5)}Q${n(48)},${n(top + 4)} ${n(49)},${n(top + 0.6)}M${n(50 + 6)},${n(center - 0.5)}Q${n(52)},${n(top + 4)} ${n(51)},${n(top + 0.6)}" stroke="${dark}" stroke-width="0.5" fill="none" opacity="0.5"/>`,
      };
    }
    case "fade": {
      const top = f.headTop - 3.2 * v;
      const block = `<path d="M${n(50 - fw + 1.2)},${n(center + 1)}C${n(50 - fw + 0.5)},${n(top + 3)} ${n(50 - 6)},${n(top)} 50,${n(top)}C${n(50 + 6)},${n(top)} ${n(50 + fw - 0.5)},${n(top + 3)} ${n(50 + fw - 1.2)},${n(center + 1)}Q50,${n(center - 0.6)} ${n(50 - fw + 1.2)},${n(center + 1)}Z"/>`;
      const coily = f.texture === "coily";
      return { back: "", front: `<g opacity="0.55">${textured(`<path d="${capPath(f, age, 0.5, 0.4)}"/>`, 0.3)}</g>${textured(block, coily ? 0.55 : 0.15)}${coily ? "" : strands(6, top + 1.5, center, fw - 5)}` };
    }
    case "cornrows": {
      let rows = "";
      for (let i = -3; i <= 3; i++) rows += `M${n(50 + i * 2.8)},${n(center + 0.3)}C${n(50 + i * 3.1)},${n(f.headTop + 4)} ${n(50 + i * 3.6)},${n(f.headTop)} ${n(50 + i * 4.4)},${n(f.headTop - 0.6)}`;
      return { back: "", front: `<path d="${capPath(f, age, 1.2, 0.6)}" fill="${color}"/><path d="${rows}" stroke="${light}" stroke-width="0.55" fill="none" opacity="0.5"/>` };
    }
    case "dreads": {
      let locks = "";
      for (const sd of [-1, 1]) {
        for (let k = 0; k < 4; k++) {
          const x = 50 + sd * (fw - 1.5 + k * 1.5);
          const len = f.chinY - 6 + ((k * 7 + (sd > 0 ? 3 : 0)) % 5) * 1.6;
          locks += `<path d="M${n(x)},${n(f.headTop + 5)}Q${n(x + sd * 1.4)},${n((f.headTop + len) / 2)} ${n(x + sd * 0.6)},${n(len)}" stroke="${k % 2 ? dark : color}" stroke-width="2.6" stroke-linecap="round" fill="none"/>`;
        }
      }
      return {
        back: locks,
        front: textured(`<path d="${capPath(f, age, 3, 1.6)}"/>` + bumps(50, f.headTop + 6, fw, 9, Math.PI * 1.05, Math.PI * 1.95, 10, 2, "")),
      };
    }
  }
}

function beardPath(f: FaceSpec, kind: "full" | "goatee" | "moustache"): string {
  const cy = f.eyeY + 3;
  const mY = f.mouthY;
  const ms = `M${n(50 - f.mouthW - 0.8)},${n(mY + 0.6)}Q${n(50 - f.mouthW)},${n(f.noseY + 2.6)} ${n(50 - 3)},${n(f.noseY + 2.4)}Q50,${n(f.noseY + 2)} ${n(50 + 3)},${n(f.noseY + 2.4)}Q${n(50 + f.mouthW)},${n(f.noseY + 2.6)} ${n(50 + f.mouthW + 0.8)},${n(mY + 0.6)}L${n(50 + f.mouthW - 0.5)},${n(mY - 0.6)}Q50,${n(mY - f.upperLip - 1.6)} ${n(50 - f.mouthW + 0.5)},${n(mY - 0.6)}Z`;
  if (kind === "moustache") return ms;
  const chin = `M${n(50 - f.mouthW - 0.6)},${n(mY + 0.2)}C${n(50 - f.mouthW - 1)},${n(f.chinY - 2)} ${n(50 - f.chinW)},${n(f.chinY + 1.6)} 50,${n(f.chinY + 1.6)}C${n(50 + f.chinW)},${n(f.chinY + 1.6)} ${n(50 + f.mouthW + 1)},${n(f.chinY - 2)} ${n(50 + f.mouthW + 0.6)},${n(mY + 0.2)}Q50,${n(mY + f.lowerLip + 2.4)} ${n(50 - f.mouthW - 0.6)},${n(mY + 0.2)}Z`;
  if (kind === "goatee") return ms + chin;
  return `M${n(50 - f.foreheadW + 0.6)},${n(f.eyeY + 3)}L${n(50 - f.foreheadW + 2.4)},${n(f.eyeY + 3)}C${n(50 - f.cheekW + 2.5)},${n(cy + 8)} ${n(50 - f.mouthW - 4)},${n(mY - 4)} ${n(50 - f.mouthW - 1.2)},${n(mY - 0.6)}Q50,${n(mY + f.lowerLip + 2.2)} ${n(50 + f.mouthW + 1.2)},${n(mY - 0.6)}C${n(50 + f.mouthW + 4)},${n(mY - 4)} ${n(50 + f.cheekW - 2.5)},${n(cy + 8)} ${n(50 + f.foreheadW - 2.4)},${n(f.eyeY + 3)}L${n(50 + f.foreheadW - 0.6)},${n(f.eyeY + 3)}C${n(50 + f.cheekW + 0.5)},${n(cy + 8)} ${n(50 + f.jawW + 2.5)},${n(f.chinY - 12)} ${n(50 + f.jawW + 0.6)},${n(f.chinY - 8)}C${n(50 + f.jawW - 1.2)},${n(f.chinY - 2)} ${n(50 + f.chinW + 3)},${n(f.chinY + 2.4)} 50,${n(f.chinY + 2.4)}C${n(50 - f.chinW - 3)},${n(f.chinY + 2.4)} ${n(50 - f.jawW + 1.2)},${n(f.chinY - 2)} ${n(50 - f.jawW - 0.6)},${n(f.chinY - 8)}C${n(50 - f.jawW - 2.5)},${n(f.chinY - 12)} ${n(50 - f.cheekW - 0.5)},${n(cy + 8)} ${n(50 - f.foreheadW + 0.6)},${n(f.eyeY + 3)}Z` + ms;
}

function eye(f: FaceSpec, side: -1 | 1, uid: string, skinShadow: string, lash: string): string {
  const cx = 50 + side * f.eyeGap;
  const y = f.eyeY;
  const w = f.eyeW / 2;
  const h = f.eyeH;
  const inner: Pt = [cx - side * w, y + 0.2];
  const outer: Pt = [cx + side * w, y - f.eyeTilt];
  const shape = `M${n(inner[0])},${n(inner[1])}Q${n(cx - side * w * 0.2)},${n(y - h * 1.05)} ${n(outer[0])},${n(outer[1])}Q${n(cx + side * w * 0.1)},${n(y + h * 0.75)} ${n(inner[0])},${n(inner[1])}Z`;
  const id = `${uid}e${side > 0 ? "r" : "l"}`;
  const ir = Math.min(h * 0.62, 1.75);
  const icx = cx - side * 0.15;
  const icy = y - h * 0.12;
  const crease = f.monolid
    ? `<path d="M${n(inner[0])},${n(inner[1] - 0.3)}Q${n(cx)},${n(y - h * 1.1)} ${n(outer[0] + side * 0.4)},${n(outer[1] - 0.2)}" stroke="${lash}" stroke-width="0.9" fill="none" opacity="0.75"/>`
    : `<path d="M${n(cx - side * w * 0.7)},${n(y - h * 0.95)}Q${n(cx)},${n(y - h * 1.65)} ${n(cx + side * w * 1.05)},${n(y - h * 0.8 - f.eyeTilt)}" stroke="${skinShadow}" stroke-width="0.5" fill="none" opacity="0.6"/>`;
  return `<clipPath id="${id}"><path d="${shape}"/></clipPath>`
    + `<path d="${shape}" fill="#efe9e2"/>`
    + `<g clip-path="url(#${id})"><circle cx="${n(icx)}" cy="${n(icy)}" r="${n(ir)}" fill="${f.eyeColor}"/><circle cx="${n(icx)}" cy="${n(icy)}" r="${n(ir * 0.48)}" fill="#0d0907"/>`
    + `<circle cx="${n(icx + 0.5)}" cy="${n(icy - 0.55)}" r="0.42" fill="#ffffff" opacity="0.85"/>`
    + `<path d="M${n(cx - w - 1)},${n(y - h)}L${n(cx + w + 1)},${n(y - h)}L${n(cx + w + 1)},${n(y - h * 0.45)}L${n(cx - w - 1)},${n(y - h * 0.45)}Z" fill="${skinShadow}" opacity="0.3"/></g>`
    + `<path d="M${n(inner[0])},${n(inner[1])}Q${n(cx - side * w * 0.2)},${n(y - h * 1.05)} ${n(outer[0])},${n(outer[1])}" stroke="${lash}" stroke-width="${f.monolid ? 0.85 : 0.7}" fill="none" stroke-linecap="round"/>`
    + crease;
}

function brow(f: FaceSpec, side: -1 | 1, color: string): string {
  const x0 = 50 + side * 3.2;
  const x1 = 50 + side * (f.eyeGap + f.eyeW / 2 + 1.2);
  const y = f.browY;
  const t = f.browW;
  const peakX = 50 + side * (f.eyeGap + 1.2);
  return `<path d="M${n(x0)},${n(y + 0.5)}Q${n(peakX)},${n(y - f.browArch - 0.4)} ${n(x1)},${n(y + 1.3)}Q${n(peakX)},${n(y - f.browArch + t)} ${n(x0)},${n(y + 0.5 + t)}Z" fill="${color}"/>`;
}

/** SVG-Porträt eines Spielers. */
export function faceSvg(p: FaceInput, kit?: FaceKit | null): string {
  const f = faceSpec(p);
  const age = p.age;
  const uid = `fc${hashString(`${p.id}|${p.name}`).toString(36)}a${age}`;
  const base = SKIN[f.skin];
  const shadow = mix(base, "#2a130a", 0.24 - f.skin * 0.008);
  const deep = mix(base, "#1c0d07", 0.42);
  const light = mix(base, "#fff4ea", 0.14 + f.skin * 0.014);
  const lash = mix(base, "#120a06", 0.8);
  const lip = f.skin >= 7 ? mix(base, "#3d1f1c", 0.3) : mix(base, "#9a4a40", 0.3);
  const greyT = Math.max(0, Math.min(0.85, (age - f.greyAge) / 14));
  const hairColor = greyT > 0 ? mix(f.hairColor, "#a8a6a2", greyT) : f.hairColor;
  const browColor = mix(hairColor, "#120c08", f.hairColor === HAIR.lightBlond || f.hairColor === HAIR.blond ? 0.3 : 0.15);
  const primary = safeColor(kit?.primary, "#39424f");
  const secondary = safeColor(kit?.secondary, "#d6d9de");
  const shirtShade = mix(primary, "#000000", 0.25);
  const head = headPath(f);
  const hairL = hair(f, age, hairColor, `url(#${uid}c)`);
  const wrinkle = Math.max(0, Math.min(0.4, (age - 29) * 0.035));

  // Hals und Trikot
  const nw = f.neckW;
  const neck = `<path d="M${n(50 - nw)},${n(f.chinY - 10)}L${n(50 - nw - 0.5)},90L${n(50 + nw + 0.5)},90L${n(50 + nw)},${n(f.chinY - 10)}Z" fill="${shadow}"/>`
    + `<path d="M${n(50 - nw + 2)},${n(f.chinY - 2)}Q50,${n(f.chinY + 9)} ${n(50 + nw - 2)},${n(f.chinY - 2)}" stroke="${deep}" stroke-width="3" fill="none" opacity="0.35"/>`;
  const shoulders = `<path d="M2,100C3,91 12,86 26,84C33,83 ${n(50 - nw - 2)},${n(84)} ${n(50 - nw)},84L${n(50 + nw)},84C${n(50 + nw + 2)},84 67,83 74,84C88,86 97,91 98,100Z" fill="${primary}"/>`
    + `<path d="M14,100C16,94 20,90 26,87.5" stroke="${shirtShade}" stroke-width="1.2" fill="none" opacity="0.6"/><path d="M86,100C84,94 80,90 74,87.5" stroke="${shirtShade}" stroke-width="1.2" fill="none" opacity="0.6"/>`;
  const collar = f.collar === "vneck"
    ? `<path d="M${n(50 - nw - 1)},84L50,93L${n(50 + nw + 1)},84L${n(50 + nw - 1.2)},84L50,90.6L${n(50 - nw + 1.2)},84Z" fill="${secondary}"/><path d="M${n(50 - nw + 1.2)},84L50,90.6L${n(50 + nw - 1.2)},84Z" fill="${shadow}"/>`
    : f.collar === "polo"
      ? `<path d="M${n(50 - nw - 1)},83.5L${n(50 - 5)},90L50,86L${n(50 + 5)},90L${n(50 + nw + 1)},83.5L${n(50 + nw - 1)},82.5L50,85.2L${n(50 - nw + 1)},82.5Z" fill="${secondary}"/><path d="M50,86L50,92" stroke="${shirtShade}" stroke-width="0.6"/>`
      : `<path d="M${n(50 - nw - 1)},84Q50,${n(90.5)} ${n(50 + nw + 1)},84L${n(50 + nw - 0.6)},83.4Q50,${n(88.6)} ${n(50 - nw + 0.6)},83.4Z" fill="${secondary}"/>`;

  // Ohren
  const earY = f.eyeY + 3.5;
  const ear = (side: -1 | 1) => {
    const x = 50 + side * (f.cheekW - 0.2);
    return `<ellipse cx="${n(x + side * 1.6)}" cy="${n(earY)}" rx="${n(3 * f.earSize)}" ry="${n(5.6 * f.earSize)}" fill="${shadow}"/>`
      + `<path d="M${n(x + side * 2.6)},${n(earY - 3.2)}Q${n(x + side * 3.6)},${n(earY)} ${n(x + side * 2.2)},${n(earY + 3.4)}" stroke="${deep}" stroke-width="0.7" fill="none" opacity="0.6"/>`;
  };

  // Gesichtsschatten
  const cy = f.eyeY + 3;
  const sideShade = `<path d="M${n(50 - f.foreheadW)},${n(f.headTop + 12)}C${n(50 - f.foreheadW - 0.5)},${n(cy - 4)} ${n(50 - f.cheekW)},${n(cy - 3)} ${n(50 - f.cheekW)},${n(cy + 2)}C${n(50 - f.cheekW)},${n(cy + 9)} ${n(50 - f.jawW - 2)},${n(f.chinY - 13)} ${n(50 - f.jawW)},${n(f.chinY - 9)}C${n(50 - f.jawW + 3)},${n(f.chinY - 12)} ${n(50 - f.cheekW + 5)},${n(cy + 4)} ${n(50 - f.cheekW + 4.5)},${n(cy - 2)}C${n(50 - f.cheekW + 4)},${n(cy - 8)} ${n(50 - f.foreheadW + 4)},${n(f.headTop + 14)} ${n(50 - f.foreheadW)},${n(f.headTop + 12)}Z" fill="${shadow}" opacity="0.45"/>`;
  const sockets = [-1, 1].map((s) => `<ellipse cx="${n(50 + s * f.eyeGap)}" cy="${n(f.eyeY - 0.6)}" rx="${n(f.eyeW / 2 + 1.6)}" ry="${n(f.eyeH + 1.2)}" fill="${shadow}" opacity="0.28"/>`).join("");
  const cheekLight = [-1, 1].map((s) => `<ellipse cx="${n(50 + s * (f.eyeGap + 1.5))}" cy="${n(f.eyeY + 7)}" rx="4.2" ry="2.6" fill="${light}" opacity="${s > 0 ? 0.16 : 0.06}"/>`).join("");

  // Nase
  const nwid = f.noseW;
  const ny = f.noseY;
  const nose = `<path d="M${n(50 - 2)},${n(f.eyeY + 1)}C${n(50 - 2.6)},${n(f.eyeY + 5)} ${n(50 - 2.8)},${n(ny - 4 * f.noseLen)} ${n(50 - nwid + 0.4)},${n(ny - 0.4)}" stroke="${shadow}" stroke-width="0.8" fill="none" opacity="0.55"/>`
    + `<path d="M${n(50 + 1.2)},${n(f.eyeY + 2)}L${n(50 + 1)},${n(ny - 3)}" stroke="${light}" stroke-width="1.2" opacity="0.35" stroke-linecap="round"/>`
    + `<path d="M${n(50 - nwid)},${n(ny)}Q${n(50 - nwid - 0.8)},${n(ny + 2.2)} ${n(50 - nwid * 0.42)},${n(ny + 2)}Q50,${n(ny + 3)} ${n(50 + nwid * 0.42)},${n(ny + 2)}Q${n(50 + nwid + 0.8)},${n(ny + 2.2)} ${n(50 + nwid)},${n(ny)}" stroke="${deep}" stroke-width="0.65" fill="none" opacity="0.7"/>`
    + `<ellipse cx="${n(50 - nwid * 0.45)}" cy="${n(ny + 1.75)}" rx="0.95" ry="0.5" fill="${deep}" opacity="0.75"/><ellipse cx="${n(50 + nwid * 0.45)}" cy="${n(ny + 1.75)}" rx="0.95" ry="0.5" fill="${deep}" opacity="0.75"/>`
    + `<ellipse cx="50" cy="${n(ny + 0.6)}" rx="${n(nwid * 0.45)}" ry="1" fill="${light}" opacity="0.3"/>`
    + `<ellipse cx="50" cy="${n(ny + 3.7)}" rx="2.6" ry="0.6" fill="${shadow}" opacity="0.35"/>`;

  // Mund
  const mw = f.mouthW;
  const my = f.mouthY;
  const s = f.smile;
  const upper = `M${n(50 - mw)},${n(my - s)}Q${n(50 - mw * 0.5)},${n(my - f.upperLip - 0.3)} ${n(50 - 0.9)},${n(my - f.upperLip)}Q50,${n(my - f.upperLip + 0.45)} ${n(50 + 0.9)},${n(my - f.upperLip)}Q${n(50 + mw * 0.5)},${n(my - f.upperLip - 0.3)} ${n(50 + mw)},${n(my - s)}Q50,${n(my + 0.5)} ${n(50 - mw)},${n(my - s)}Z`;
  const lower = `M${n(50 - mw)},${n(my - s)}Q50,${n(my + 0.5)} ${n(50 + mw)},${n(my - s)}Q${n(50 + mw * 0.6)},${n(my + f.lowerLip + 0.4)} 50,${n(my + f.lowerLip + 0.4)}Q${n(50 - mw * 0.6)},${n(my + f.lowerLip + 0.4)} ${n(50 - mw)},${n(my - s)}Z`;
  const mouth = `<path d="${upper}" fill="${mix(lip, "#000000", 0.12)}"/><path d="${lower}" fill="${lip}"/>`
    + `<path d="M${n(50 - mw)},${n(my - s)}Q50,${n(my + 0.55)} ${n(50 + mw)},${n(my - s)}" stroke="${mix(lip, "#120806", 0.6)}" stroke-width="0.55" fill="none"/>`
    + `<ellipse cx="50" cy="${n(my + f.lowerLip * 0.45)}" rx="${n(mw * 0.4)}" ry="0.45" fill="#ffffff" opacity="0.14"/>`
    + `<ellipse cx="50" cy="${n(my + f.lowerLip + 1.6)}" rx="${n(mw * 0.55)}" ry="0.75" fill="${shadow}" opacity="0.35"/>`
    + `<path d="M50,${n(ny + 3.2)}L50,${n(my - f.upperLip - 0.3)}" stroke="${shadow}" stroke-width="1.6" opacity="0.18"/>`;

  // Falten und Sommersprossen
  let lines = "";
  if (wrinkle > 0) {
    const { center } = hairlineY(f, age);
    const fy = (center + f.browY) / 2;
    lines += `<path d="M${n(50 - 7)},${n(fy)}Q50,${n(fy - 0.8)} ${n(50 + 7)},${n(fy)}M${n(50 - 5)},${n(fy + 2.2)}Q50,${n(fy + 1.5)} ${n(50 + 5)},${n(fy + 2.2)}" stroke="${shadow}" stroke-width="0.45" fill="none" opacity="${n(wrinkle * 1.6)}"/>`;
    lines += [-1, 1].map((sd) => `<path d="M${n(50 + sd * (nwid + 1.2))},${n(ny + 0.5)}Q${n(50 + sd * (mw + 1.8))},${n(my - 3)} ${n(50 + sd * (mw + 1.4))},${n(my + 1.5)}" stroke="${shadow}" stroke-width="0.55" fill="none" opacity="${n(wrinkle * 1.4)}"/>`
      + `<path d="M${n(50 + sd * (f.eyeGap - 2.4))},${n(f.eyeY + f.eyeH + 0.9)}Q${n(50 + sd * f.eyeGap)},${n(f.eyeY + f.eyeH + 1.8)} ${n(50 + sd * (f.eyeGap + 2.6))},${n(f.eyeY + f.eyeH + 0.6)}" stroke="${shadow}" stroke-width="0.4" fill="none" opacity="${n(wrinkle * 1.2)}"/>`).join("");
  } else {
    lines += [-1, 1].map((sd) => `<path d="M${n(50 + sd * (nwid + 1))},${n(ny + 1)}Q${n(50 + sd * (mw + 1.6))},${n(my - 2.5)} ${n(50 + sd * (mw + 1.2))},${n(my + 0.5)}" stroke="${shadow}" stroke-width="0.5" fill="none" opacity="0.18"/>`).join("");
  }
  if (f.freckles) {
    const fr = new Rng(hashString(`freckles|${p.id}`));
    for (let i = 0; i < 18; i++) {
      const sd = i % 2 ? 1 : -1;
      lines += `<circle cx="${n(50 + sd * fr.range(3.5, 11))}" cy="${n(f.eyeY + fr.range(4, 9))}" r="${n(fr.range(0.25, 0.45))}" fill="#a0603c" opacity="0.4"/>`;
    }
  }

  // Bart
  let beard = "";
  const beardColor = mix(f.hairColor, "#a8a6a2", Math.min(0.9, greyT * 1.15));
  if (f.beard !== "none") {
    const kind = f.beard === "stubble" || f.beard === "short" || f.beard === "full" ? "full" : f.beard;
    const textured = f.beard !== "full";
    const fill = textured ? `url(#${uid}s)` : beardColor;
    const op = f.beard === "stubble" ? 0.55 : textured ? 0.95 : 0.9;
    beard = `<g clip-path="url(#${uid}h)"><g filter="url(#${uid}b)">`
      + (textured && f.beard !== "stubble" ? `<path d="${beardPath(f, kind)}" fill="${beardColor}" opacity="0.4"/>` : "")
      + `<path d="${beardPath(f, kind)}" fill="${fill}" opacity="${op}"/></g></g>`;
    if (f.beard === "full") beard += `<path d="M${n(50 - f.jawW + 1)},${n(f.chinY - 3)}Q50,${n(f.chinY + 5)} ${n(50 + f.jawW - 1)},${n(f.chinY - 3)}Q50,${n(f.chinY + 1.6)} ${n(50 - f.jawW + 1)},${n(f.chinY - 3)}Z" fill="${beardColor}" opacity="0.92"/>`;
  }

  const defs = `<defs><radialGradient id="${uid}g" cx="0.58" cy="0.4" r="0.72"><stop offset="0" stop-color="${light}"/><stop offset="0.55" stop-color="${base}"/><stop offset="1" stop-color="${shadow}"/></radialGradient>`
    + `<clipPath id="${uid}h"><path d="${head}"/></clipPath><filter id="${uid}b" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="0.35"/></filter>`
    + `<filter id="${uid}sf" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="0.9"/></filter>`
    + `<filter id="${uid}hf" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="0.18"/></filter>`
    + `<pattern id="${uid}s" width="2.6" height="2.6" patternUnits="userSpaceOnUse" fill="${beardColor}">`
    + `<circle cx="0.4" cy="0.5" r="0.34"/><circle cx="1.5" cy="0.25" r="0.3"/><circle cx="2.2" cy="1.1" r="0.34"/><circle cx="0.9" cy="1.5" r="0.32"/><circle cx="1.9" cy="2.2" r="0.3"/><circle cx="0.3" cy="2.3" r="0.3"/><circle cx="1.3" cy="0.95" r="0.24"/></pattern>`
    + `<pattern id="${uid}c" width="2.2" height="2.2" patternUnits="userSpaceOnUse" fill="${mix(hairColor, "#000000", 0.45)}">`
    + `<circle cx="0.5" cy="0.6" r="0.45"/><circle cx="1.6" cy="1.5" r="0.45"/><circle cx="1.7" cy="0.3" r="0.3"/><circle cx="0.4" cy="1.8" r="0.3"/></pattern></defs>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="9 7 82 82" role="img" aria-hidden="true">${defs}`
    + hairL.back + neck + shoulders + collar + ear(-1) + ear(1)
    + `<path d="${head}" fill="url(#${uid}g)"/>`
    + `<g clip-path="url(#${uid}h)"><g filter="url(#${uid}sf)">${sideShade}${sockets}${cheekLight}${lines}</g></g>` + beard + nose + mouth
    + eye(f, -1, uid, shadow, lash) + eye(f, 1, uid, shadow, lash)
    + brow(f, -1, browColor) + brow(f, 1, browColor)
    + `<g filter="url(#${uid}hf)">${hairL.front}</g>`
    + `</svg>`;
}
