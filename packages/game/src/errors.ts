/** Fehler mit Nachricht für die Oberfläche und HTTP-Status. */
export class GameError extends Error {
  /** code: maschinenlesbarer Grund für die Oberfläche (z. B. "mfa_required") */
  constructor(message: string, public status = 400, public code?: string) {
    super(message);
  }
}
