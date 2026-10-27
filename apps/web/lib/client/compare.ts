/** Vergleichsliste je Karriere im lokalen Speicher (höchstens drei Spieler). */
export const COMPARE_MAX = 3;
const key = (careerId: string) => `fl-compare-${careerId}`;

export function compareList(careerId: string): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(careerId)) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => Number.isInteger(x)).slice(0, COMPARE_MAX) : [];
  } catch {
    return [];
  }
}

export function saveCompare(careerId: string, ids: number[]) {
  try {
    localStorage.setItem(key(careerId), JSON.stringify(ids.slice(0, COMPARE_MAX)));
  } catch { /* privater Modus */ }
}

/** Fügt einen Spieler hinzu (der älteste fällt raus, wenn die Liste voll ist). */
export function addToCompare(careerId: string, playerId: number): number[] {
  const list = compareList(careerId).filter((x) => x !== playerId);
  const next = [...list, playerId].slice(-COMPARE_MAX);
  saveCompare(careerId, next);
  return next;
}
