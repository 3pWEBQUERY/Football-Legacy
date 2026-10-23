/** Fehler mit Nachricht für die Oberfläche und HTTP-Status. */
export class GameError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}
