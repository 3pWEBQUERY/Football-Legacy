/** Spieloptionen pro Karriere: automatische Wechsel und Stopps beim Weiterspielen. */
import { withCareer } from "./career";
import { saveCareer } from "./repo";

/** Kategorien des Posteingangs, bei denen "Weiter" standardmässig anhält. */
export const DEFAULT_STOP_ON: Record<string, boolean> = {
  transfer: true, contract: true, medical: true, scout: true, youth: true, board: true,
  international: true, award: true, career: true, news: false, finance: false, training: false,
};

export const STOP_ON_LABEL: Record<string, string> = {
  transfer: "Transfers und Angebote", contract: "Verträge", medical: "Verletzungen und Genesungen", scout: "Scoutberichte",
  youth: "Jugendakademie", board: "Vorstand", international: "Nationalmannschaften", award: "Auszeichnungen", career: "Jobangebote und Bewerbungen",
  news: "Neuigkeiten aus der Fussballwelt", finance: "Finanzberichte", training: "Trainingsereignisse",
};

export async function updateCareerSettings(careerId: string, accountId: string, input: { autoSubs?: unknown; stopOn?: unknown }) {
  return withCareer(careerId, accountId, async (db, career) => {
    if (typeof input.autoSubs === "boolean") career.manager.autoSubs = input.autoSubs;
    if (input.stopOn && typeof input.stopOn === "object") {
      const next = { ...DEFAULT_STOP_ON, ...(career.manager.stopOn ?? {}) };
      for (const [k, v] of Object.entries(input.stopOn as Record<string, unknown>)) {
        if (k in DEFAULT_STOP_ON && typeof v === "boolean") next[k] = v;
      }
      career.manager.stopOn = next;
    }
    await saveCareer(db, career);
    return { autoSubs: career.manager.autoSubs ?? true, stopOn: { ...DEFAULT_STOP_ON, ...(career.manager.stopOn ?? {}) }, labels: STOP_ON_LABEL };
  });
}
