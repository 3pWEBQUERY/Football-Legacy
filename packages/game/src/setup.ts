/** Baut Engine-Eingaben aus Vereins- und Spielerdaten. */
import { type Player, type Tactic, type TeamSetup, autoLineup, defaultTactic, validateTactic } from "@fl/sim";
import type { ClubRow } from "./repo";

/** KI: beste verfügbare Elf in der Lieblingsformation. */
export function aiTactic(club: ClubRow, squad: Player[]): Tactic {
  const base = club.tactic ?? defaultTactic(squad);
  const { lineup, bench } = autoLineup(squad, base.formation);
  return validateTactic({ ...base, lineup, bench, slotOffsets: undefined }, squad);
}

export function teamSetup(club: ClubRow, squad: Player[], tactic: Tactic, autoSubs = true): TeamSetup {
  return {
    clubId: club.id,
    name: club.name,
    shortName: club.short_name,
    colors: club.colors,
    tactic,
    players: squad,
    autoSubs,
  };
}
