import { ratingForSlot } from "./player";
import type { Duty, Formation, Player, PlayerInstruction, Position, Tactic, TacticStyle } from "./types";

export interface Slot {
  position: Position;
  /** x: 0 eigenes Tor → 1 gegnerisches Tor, y: 0 links → 1 rechts (in Spielrichtung). */
  x: number;
  y: number;
}

const S = (position: Position, x: number, y: number): Slot => ({ position, x, y });

export const FORMATIONS: Record<Formation, Slot[]> = {
  "4-4-2": [
    S("GK", 0.04, 0.5), S("DL", 0.24, 0.12), S("DC", 0.2, 0.38), S("DC", 0.2, 0.62), S("DR", 0.24, 0.88),
    S("ML", 0.5, 0.12), S("MC", 0.46, 0.38), S("MC", 0.46, 0.62), S("MR", 0.5, 0.88),
    S("ST", 0.74, 0.4), S("ST", 0.74, 0.6),
  ],
  "4-3-3": [
    S("GK", 0.04, 0.5), S("DL", 0.24, 0.12), S("DC", 0.2, 0.38), S("DC", 0.2, 0.62), S("DR", 0.24, 0.88),
    S("MC", 0.44, 0.3), S("DM", 0.38, 0.5), S("MC", 0.44, 0.7),
    S("AML", 0.7, 0.16), S("ST", 0.78, 0.5), S("AMR", 0.7, 0.84),
  ],
  "4-2-3-1": [
    S("GK", 0.04, 0.5), S("DL", 0.24, 0.12), S("DC", 0.2, 0.38), S("DC", 0.2, 0.62), S("DR", 0.24, 0.88),
    S("DM", 0.38, 0.4), S("DM", 0.38, 0.6),
    S("AML", 0.62, 0.16), S("AMC", 0.6, 0.5), S("AMR", 0.62, 0.84), S("ST", 0.8, 0.5),
  ],
  "3-5-2": [
    S("GK", 0.04, 0.5), S("DC", 0.2, 0.28), S("DC", 0.18, 0.5), S("DC", 0.2, 0.72),
    S("ML", 0.5, 0.08), S("MC", 0.44, 0.34), S("DM", 0.38, 0.5), S("MC", 0.44, 0.66), S("MR", 0.5, 0.92),
    S("ST", 0.76, 0.4), S("ST", 0.76, 0.6),
  ],
  "4-1-4-1": [
    S("GK", 0.04, 0.5), S("DL", 0.24, 0.12), S("DC", 0.2, 0.38), S("DC", 0.2, 0.62), S("DR", 0.24, 0.88),
    S("DM", 0.36, 0.5),
    S("ML", 0.54, 0.12), S("MC", 0.5, 0.38), S("MC", 0.5, 0.62), S("MR", 0.54, 0.88),
    S("ST", 0.8, 0.5),
  ],
  "5-3-2": [
    S("GK", 0.04, 0.5), S("DL", 0.28, 0.08), S("DC", 0.18, 0.3), S("DC", 0.16, 0.5), S("DC", 0.18, 0.7), S("DR", 0.28, 0.92),
    S("MC", 0.44, 0.32), S("MC", 0.42, 0.5), S("MC", 0.44, 0.68),
    S("ST", 0.74, 0.4), S("ST", 0.74, 0.6),
  ],
  "4-4-1-1": [
    S("GK", 0.04, 0.5), S("DL", 0.24, 0.12), S("DC", 0.2, 0.38), S("DC", 0.2, 0.62), S("DR", 0.24, 0.88),
    S("ML", 0.48, 0.12), S("MC", 0.44, 0.38), S("MC", 0.44, 0.62), S("MR", 0.48, 0.88),
    S("AMC", 0.64, 0.5), S("ST", 0.8, 0.5),
  ],
  "3-4-3": [
    S("GK", 0.04, 0.5), S("DC", 0.2, 0.28), S("DC", 0.18, 0.5), S("DC", 0.2, 0.72),
    S("ML", 0.48, 0.1), S("MC", 0.44, 0.38), S("MC", 0.44, 0.62), S("MR", 0.48, 0.9),
    S("AML", 0.72, 0.18), S("ST", 0.8, 0.5), S("AMR", 0.72, 0.82),
  ],
};

export const FORMATION_LIST = Object.keys(FORMATIONS) as Formation[];

export interface RoleDef {
  id: string;
  name: string;
  positions: Position[];
  description: string;
  /** Multiplikatoren für Aktionswahl und Laufverhalten. */
  mod: { pass: number; dribble: number; shoot: number; cross: number; forward: number; defend: number };
}

const M = (pass = 1, dribble = 1, shoot = 1, cross = 1, forward = 0, defend = 1) => ({ pass, dribble, shoot, cross, forward, defend });

export const ROLES: RoleDef[] = [
  { id: "gk", name: "Torwart", positions: ["GK"], description: "Hält den Kasten sauber.", mod: M() },
  { id: "sweeper_keeper", name: "Mitspielender Torwart", positions: ["GK"], description: "Spielt weit mit und eröffnet das Spiel.", mod: M(1.2, 1, 1, 1, 0.05, 1) },
  { id: "cb", name: "Innenverteidiger", positions: ["DC"], description: "Verteidigt kompromisslos.", mod: M(0.9, 0.6, 0.5, 0.5, -0.02, 1.15) },
  { id: "bpd", name: "Ballspielender IV", positions: ["DC"], description: "Eröffnet mit langen Bällen.", mod: M(1.25, 0.8, 0.5, 0.5, 0, 1) },
  { id: "fb", name: "Aussenverteidiger", positions: ["DR", "DL"], description: "Ausgewogen zwischen Abwehr und Angriff.", mod: M() },
  { id: "wb", name: "Flügelverteidiger", positions: ["DR", "DL"], description: "Schaltet sich offensiv mit ein.", mod: M(1, 1.1, 0.8, 1.4, 0.08, 0.9) },
  { id: "anchor", name: "Abräumer", positions: ["DM"], description: "Bleibt vor der Abwehr und erobert Bälle.", mod: M(0.9, 0.7, 0.6, 0.5, -0.04, 1.25) },
  { id: "dlp", name: "Tiefer Spielmacher", positions: ["DM", "MC"], description: "Verteilt die Bälle aus der Tiefe.", mod: M(1.35, 0.8, 0.8, 0.8, 0, 1) },
  { id: "b2b", name: "Box-to-Box", positions: ["MC"], description: "Läuft von Strafraum zu Strafraum.", mod: M(1, 1.05, 1.1, 0.9, 0.05, 1.05) },
  { id: "playmaker", name: "Spielmacher", positions: ["MC", "AMC"], description: "Kreativzentrale mit Steilpässen.", mod: M(1.4, 1.05, 0.9, 0.8, 0.02, 0.85) },
  { id: "winger", name: "Flügelflitzer", positions: ["MR", "ML", "AMR", "AML"], description: "Geht ins Dribbling und flankt.", mod: M(0.85, 1.45, 0.9, 1.4, 0.05, 0.8) },
  { id: "wide_mid", name: "Breiter Mittelfeldspieler", positions: ["MR", "ML"], description: "Arbeitet nach hinten mit.", mod: M(1.05, 1, 0.8, 1.1, 0, 1.1) },
  { id: "inside_fwd", name: "Inverser Flügel", positions: ["AMR", "AML"], description: "Zieht nach innen und schliesst ab.", mod: M(0.9, 1.35, 1.5, 0.7, 0.06, 0.75) },
  { id: "am", name: "Offensiver Mittelfeldspieler", positions: ["AMC"], description: "Sucht den Abschluss aus der zweiten Reihe.", mod: M(1.15, 1.15, 1.25, 0.8, 0.04, 0.8) },
  { id: "poacher", name: "Knipser", positions: ["ST"], description: "Lauert im Strafraum.", mod: M(0.7, 0.9, 1.6, 0.5, 0.08, 0.6) },
  { id: "target", name: "Zielspieler", positions: ["ST"], description: "Behauptet Bälle, stark im Kopfball.", mod: M(1.05, 0.7, 1.2, 0.6, 0.03, 0.8) },
  { id: "complete_fwd", name: "Kompletter Stürmer", positions: ["ST"], description: "Kann alles: Abschluss, Kombination, Tempo.", mod: M(1, 1.15, 1.3, 0.6, 0.05, 0.75) },
  { id: "false9", name: "Falsche Neun", positions: ["ST"], description: "Lässt sich fallen und bindet die Mitspieler ein.", mod: M(1.35, 1.1, 1, 0.6, -0.04, 0.85) },
];

export const ROLE_BY_ID: Record<string, RoleDef> = Object.fromEntries(ROLES.map((r) => [r.id, r]));

export function defaultRole(position: Position): string {
  switch (position) {
    case "GK": return "gk";
    case "DC": return "cb";
    case "DR": case "DL": return "fb";
    case "DM": return "anchor";
    case "MC": return "b2b";
    case "MR": case "ML": return "winger";
    case "AMC": return "am";
    case "AMR": case "AML": return "inside_fwd";
    case "ST": return "complete_fwd";
  }
}

export function rolesFor(position: Position): RoleDef[] {
  return ROLES.filter((r) => r.positions.includes(position));
}

export const DEFAULT_STYLE: TacticStyle = {
  tempo: 50, passLength: 50, width: 50, risk: 50, pressing: 50, defensiveLine: 50, hardness: 50,
};

export const STYLE_LABEL: Record<keyof TacticStyle, [string, string, string]> = {
  tempo: ["Tempo", "langsam", "schnell"],
  passLength: ["Passlänge", "kurz", "lang"],
  width: ["Breite", "eng", "breit"],
  risk: ["Risiko", "sicher", "riskant"],
  pressing: ["Pressinghöhe", "tief", "hoch"],
  defensiveLine: ["Abwehrlinie", "tief", "hoch"],
  hardness: ["Härte", "fair", "hart"],
};

/** Taktik-Voreinstellungen (auch für KI-Vereine). */
export const STYLE_PRESETS: Record<string, { name: string; style: TacticStyle; mentality?: number }> = {
  balanced: { name: "Ausgewogen", style: { ...DEFAULT_STYLE } },
  possession: { name: "Ballbesitz", style: { tempo: 35, passLength: 25, width: 55, risk: 40, pressing: 60, defensiveLine: 60, hardness: 40 } },
  gegenpress: { name: "Gegenpressing", style: { tempo: 75, passLength: 45, width: 50, risk: 60, pressing: 85, defensiveLine: 70, hardness: 60 } },
  counter: { name: "Konter", style: { tempo: 80, passLength: 70, width: 45, risk: 55, pressing: 30, defensiveLine: 30, hardness: 55 } },
  park_bus: { name: "Mauern", style: { tempo: 30, passLength: 65, width: 30, risk: 25, pressing: 20, defensiveLine: 15, hardness: 65 } },
  wing_play: { name: "Flügelspiel", style: { tempo: 60, passLength: 55, width: 85, risk: 50, pressing: 50, defensiveLine: 50, hardness: 50 } },
  tiki_taka: { name: "Tiki-Taka", style: { tempo: 30, passLength: 10, width: 45, risk: 35, pressing: 75, defensiveLine: 75, hardness: 40 }, mentality: 1 },
  vertical_tiki: { name: "Vertikales Tiki-Taka", style: { tempo: 65, passLength: 25, width: 35, risk: 65, pressing: 70, defensiveLine: 65, hardness: 45 }, mentality: 1 },
  fluid_counter: { name: "Fluides Konterspiel", style: { tempo: 75, passLength: 55, width: 55, risk: 60, pressing: 45, defensiveLine: 40, hardness: 50 } },
  route_one: { name: "Route One", style: { tempo: 80, passLength: 95, width: 60, risk: 70, pressing: 40, defensiveLine: 40, hardness: 65 } },
  catenaccio: { name: "Catenaccio", style: { tempo: 40, passLength: 60, width: 35, risk: 30, pressing: 25, defensiveLine: 20, hardness: 60 }, mentality: -2 },
  high_press: { name: "Hohes Pressing", style: { tempo: 70, passLength: 40, width: 55, risk: 55, pressing: 95, defensiveLine: 85, hardness: 60 }, mentality: 1 },
};

// ---------------------------------------------------------------- Mentalität, Pflichten, Anweisungen

export const MENTALITY_LABEL: Record<string, string> = {
  "-3": "Sehr defensiv", "-2": "Defensiv", "-1": "Vorsichtig", "0": "Ausgewogen", "1": "Positiv", "2": "Offensiv", "3": "Sehr offensiv",
};

export const DUTY_LABEL: Record<Duty, { name: string; short: string; text: string }> = {
  defend: { name: "Verteidigen", short: "V", text: "Bleibt hinten, sichert ab und schaltet sich kaum ein." },
  support: { name: "Unterstützen", short: "U", text: "Ausgewogen: unterstützt Angriff und Abwehr." },
  attack: { name: "Angreifen", short: "A", text: "Rückt mit auf, sucht den Abschluss, arbeitet weniger nach hinten." },
};

export const INSTRUCTION_LABEL: Record<PlayerInstruction, { name: string; text: string }> = {
  shoot_more: { name: "Öfter schiessen", text: "Schliesst auch aus der Distanz ab." },
  dribble_more: { name: "Öfter dribbeln", text: "Sucht das Eins-gegen-eins." },
  pass_safe: { name: "Sichere Pässe", text: "Spielt einfache Bälle, verliert seltener den Ball." },
  cross_more: { name: "Öfter flanken", text: "Bringt den Ball früh in den Strafraum." },
  press_more: { name: "Aggressiver anlaufen", text: "Geht früher drauf und arbeitet mehr gegen den Ball (kostet Kraft)." },
  stay_back: { name: "Hinten bleiben", text: "Rückt nicht mit auf, auch wenn das Team angreift." },
  get_forward: { name: "Mehr nach vorne", text: "Stösst bei Ballbesitz in die Spitze vor." },
};

/** Sich gegenseitig ausschliessende Anweisungen */
export const INSTRUCTION_CONFLICTS: [PlayerInstruction, PlayerInstruction][] = [["stay_back", "get_forward"], ["dribble_more", "pass_safe"]];

export type RoleMod = RoleDef["mod"];

/** Rollenverhalten inkl. Pflicht, Spieleranweisungen und Mentalität. */
export function slotMod(roleId: string | undefined, position: Position, duty?: Duty | null, instructions?: PlayerInstruction[] | null, mentality = 0): RoleMod {
  const base = (ROLE_BY_ID[roleId ?? ""] ?? ROLE_BY_ID[defaultRole(position)]).mod;
  if (position === "GK") return base;
  const m = { ...base };
  if (duty === "attack") { m.forward += 0.04; m.shoot *= 1.1; m.dribble *= 1.05; m.defend *= 0.9; }
  if (duty === "defend") { m.forward -= 0.04; m.defend *= 1.12; m.shoot *= 0.85; m.cross *= 0.9; }
  for (const pi of instructions ?? []) {
    if (pi === "shoot_more") m.shoot *= 1.2;
    if (pi === "dribble_more") m.dribble *= 1.25;
    if (pi === "pass_safe") { m.pass *= 1.1; m.dribble *= 0.85; }
    if (pi === "cross_more") m.cross *= 1.3;
    if (pi === "press_more") m.defend *= 1.1;
    if (pi === "stay_back") m.forward -= 0.05;
    if (pi === "get_forward") m.forward += 0.05;
  }
  m.forward += mentality * 0.01;
  return m;
}

/** Mentalität verschiebt Tempo, Risiko, Abwehrlinie und Pressing. */
export function mentalityStyle(style: TacticStyle, mentality = 0): TacticStyle {
  if (!mentality) return style;
  const c = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
  return { ...style, tempo: c(style.tempo + mentality * 5), risk: c(style.risk + mentality * 6), defensiveLine: c(style.defensiveLine + mentality * 5), pressing: c(style.pressing + mentality * 3) };
}

/** Intensität 0–100: wie sehr die Spielweise an der Kraft zehrt (wie in der Engine). */
export function tacticIntensity(style: TacticStyle, mentality = 0, instructions?: PlayerInstruction[][]): number {
  const s = mentalityStyle(style, mentality);
  const raw = 0.7 + (s.pressing / 100) * 0.6 + (s.tempo / 100) * 0.2; // 0.7 … 1.5
  const press = (instructions ?? []).flat().filter((i) => i === "press_more").length;
  return Math.max(0, Math.min(100, Math.round(((raw - 0.7) / 0.8) * 100 + press * 2)));
}

/** Vertrautheit (0–100) wirkt in der Engine leicht auf alle Aktionen. */
export function familiarityFactor(familiarity = 85): number {
  return 0.94 + 0.06 * Math.max(0, Math.min(100, familiarity)) / 100;
}

export function isAvailable(p: Player): boolean {
  return p.injuryWeeks <= 0 && p.suspendedWeeks <= 0;
}

/** Wählt die beste verfügbare Elf für eine Formation (greedy nach Slot-Wichtigkeit). */
export function autoLineup(players: Player[], formation: Formation): { lineup: number[]; bench: number[] } {
  const slots = FORMATIONS[formation];
  const available = players.filter(isAvailable);
  const used = new Set<number>();
  const lineup: number[] = new Array(slots.length).fill(-1);
  // Torwart zuerst, dann Positionen mit wenigen Kandidaten
  const order = slots
    .map((s, i) => ({ s, i, cands: available.filter((p) => p.position === s.position).length }))
    .sort((a, b) => (a.s.position === "GK" ? -1 : b.s.position === "GK" ? 1 : a.cands - b.cands));
  for (const { s, i } of order) {
    let best: Player | null = null;
    let bestScore = -Infinity;
    for (const p of available) {
      if (used.has(p.id)) continue;
      const score = ratingForSlot(p, s.position) * (0.85 + p.fitness / 650) + p.form * 0.4;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (best) {
      lineup[i] = best.id;
      used.add(best.id);
    }
  }
  const bench = available
    .filter((p) => !used.has(p.id))
    .sort((a, b) => b.rating - a.rating);
  // Bank: ein Torwart plus die besten Feldspieler
  const benchGk = bench.find((p) => p.position === "GK");
  const benchField = bench.filter((p) => p !== benchGk).slice(0, benchGk ? 8 : 9);
  return {
    lineup,
    bench: [...(benchGk ? [benchGk.id] : []), ...benchField.map((p) => p.id)],
  };
}

export function defaultTactic(players: Player[], formation: Formation = "4-4-2", style: TacticStyle = DEFAULT_STYLE): Tactic {
  const { lineup, bench } = autoLineup(players, formation);
  const byId = new Map(players.map((p) => [p.id, p]));
  const lineupPlayers = lineup.map((id) => byId.get(id)).filter(Boolean) as Player[];
  const best = (key: "corners" | "freeKicks" | "penalties") =>
    lineupPlayers.length ? lineupPlayers.reduce((a, b) => (b.attrs[key] > a.attrs[key] ? b : a)).id : null;
  return {
    formation,
    style: { ...style },
    lineup,
    bench,
    roles: FORMATIONS[formation].map((s) => defaultRole(s.position)),
    setPieces: { corners: "far", cornerTaker: best("corners"), freeKickTaker: best("freeKicks"), penaltyTaker: best("penalties") },
  };
}

/**
 * Prüft eine gespeicherte Taktik gegen den aktuellen Kader und füllt Lücken
 * (verletzte, gesperrte oder verkaufte Spieler) automatisch auf.
 */
export function validateTactic(tactic: Tactic, players: Player[]): Tactic {
  const byId = new Map(players.map((p) => [p.id, p]));
  const slots = FORMATIONS[tactic.formation];
  const lineup = slots.map((_, i) => {
    const id = tactic.lineup[i];
    const p = id != null ? byId.get(id) : undefined;
    return p && isAvailable(p) ? p.id : null;
  });
  const used = new Set(lineup.filter((x): x is number => x !== null));
  if (used.size < slots.length) {
    // Lücken mit dem besten Spieler für den Slot füllen
    for (let i = 0; i < slots.length; i++) {
      if (lineup[i] !== null) continue;
      const candidates = players.filter((p) => isAvailable(p) && !used.has(p.id));
      candidates.sort((a, b) => ratingForSlot(b, slots[i].position) - ratingForSlot(a, slots[i].position));
      const c = candidates[0];
      if (c) {
        lineup[i] = c.id;
        used.add(c.id);
      }
    }
  }
  // Ersatzbank: die gewählte Grösse bleibt erhalten; nicht verfügbare Spieler werden ersetzt
  const wanted = Math.min(9, (tactic.bench ?? []).length);
  let bench = (tactic.bench ?? []).filter((id, i, all) => {
    const p = byId.get(id);
    return p && isAvailable(p) && !used.has(id) && all.indexOf(id) === i;
  });
  if (bench.length < wanted) {
    const extra = players
      .filter((p) => isAvailable(p) && !used.has(p.id) && !bench.includes(p.id))
      .sort((a, b) => b.rating - a.rating)
      .slice(0, wanted - bench.length)
      .map((p) => p.id);
    bench = [...bench, ...extra];
  }
  const roles = slots.map((s, i) => {
    const r = tactic.roles[i];
    return r && ROLE_BY_ID[r]?.positions.includes(s.position) ? r : defaultRole(s.position);
  });
  const onPitch = (id: number | null) => (id !== null && used.has(id) ? id : null);
  // Standardschützen: leer bedeutet automatisch (die Engine wählt den Besten auf dem Platz)
  return {
    ...tactic,
    lineup,
    bench: bench.slice(0, 9),
    roles,
    setPieces: {
      corners: tactic.setPieces?.corners ?? "far",
      cornerTaker: onPitch(tactic.setPieces?.cornerTaker ?? null),
      freeKickTaker: onPitch(tactic.setPieces?.freeKickTaker ?? null),
      penaltyTaker: onPitch(tactic.setPieces?.penaltyTaker ?? null),
    },
  };
}

/** Mannschaftsstärke = Durchschnitt der besten Elf. */
export function teamRating(players: Player[]): number {
  if (players.length === 0) return 0;
  const { lineup } = autoLineup(players.map((p) => ({ ...p, injuryWeeks: 0, suspendedWeeks: 0 })), "4-4-2");
  const slots = FORMATIONS["4-4-2"];
  const byId = new Map(players.map((p) => [p.id, p]));
  let sum = 0;
  let n = 0;
  lineup.forEach((id, i) => {
    const p = byId.get(id);
    if (p) {
      sum += ratingForSlot(p, slots[i].position);
      n++;
    }
  });
  return n ? Math.round(sum / n) : 0;
}

export type ShapePhase = "base" | "attack" | "defend";

/**
 * Wo stehen die Spieler mit bzw. gegen den Ball? Gleiche Formeln wie die
 * Laufwege der Engine (moveTeams), mit dem Ball im Mittelfeld als Bezug.
 * Koordinaten wie die Formations-Slots: x 0 = eigenes Tor → 1 gegnerisches Tor, y 0 links → 1 rechts.
 */
export function shapePositions(
  slots: { position: Position; x: number; y: number }[],
  roles: string[],
  rawStyle: TacticStyle,
  phase: ShapePhase,
  extra: { duties?: (Duty | null)[]; instructions?: PlayerInstruction[][]; mentality?: number } = {},
): { x: number; y: number }[] {
  if (phase === "base") return slots.map((s) => ({ x: s.x, y: s.y }));
  const style = mentalityStyle(rawStyle, extra.mentality ?? 0);
  const attack = phase === "attack";
  const ballA = attack ? 0.55 : 0.45;
  const widthF = attack ? 0.72 + (style.width / 100) * 0.5 : 0.55 + (style.width / 100) * 0.15;
  const lineAdj = ((style.defensiveLine - 50) / 100) * 0.12;
  return slots.map((s, i) => {
    if (s.position === "GK") return { x: 0.03 + ballA * 0.1, y: 0.5 };
    const mod = slotMod(roles[i], s.position, extra.duties?.[i], extra.instructions?.[i], extra.mentality ?? 0);
    const x = attack
      ? s.x * 0.75 + ballA * 0.42 - 0.02 + mod.forward + lineAdj * 0.5 + ((style.risk - 50) / 100) * 0.04 * s.x
      : s.x * 0.6 + ballA * 0.38 - 0.06 + lineAdj;
    const y = 0.5 + (s.y - 0.5) * widthF;
    return { x: Math.max(0.02, Math.min(0.96, x)), y: Math.max(0.03, Math.min(0.97, y)) };
  });
}
