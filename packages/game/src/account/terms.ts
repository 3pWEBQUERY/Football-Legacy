/**
 * Nutzungsbedingungen und Mindestalter: Wer sich registriert, bestätigt,
 * mindestens MIN_AGE Jahre alt zu sein, und akzeptiert die aktuelle Fassung.
 * Ändert sich die Fassung (TERMS_VERSION), wird die Zustimmung beim nächsten
 * Besuch erneut eingeholt.
 */
import { pool, query } from "../db";
import { GameError } from "../errors";

export const TERMS_VERSION = 1;
export const MIN_AGE = 16;

export interface Consent { acceptTerms?: unknown; ageConfirmed?: unknown }

/** Prüft die Zustimmung aus einem Formular; wirft eine verständliche Meldung, wenn etwas fehlt. */
export function requireConsent(input: Consent): { acceptTerms: true; ageConfirmed: true } {
  if (input.ageConfirmed !== true) throw new GameError(`Football Legacy ist ab ${MIN_AGE} Jahren. Bitte bestätige dein Alter.`);
  if (input.acceptTerms !== true) throw new GameError("Bitte akzeptiere die Nutzungsbedingungen.");
  return { acceptTerms: true, ageConfirmed: true };
}

export async function acceptTerms(accountId: string, input: Consent) {
  requireConsent(input);
  await query(pool(),
    "update accounts set terms_version = $2, terms_accepted_at = now(), age_confirmed = true where id = $1", [accountId, TERMS_VERSION]);
  return { ok: true, termsVersion: TERMS_VERSION };
}
