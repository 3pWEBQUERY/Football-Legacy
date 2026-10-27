/** Englischer Katalog: Oberfläche, Spiellogik, Spielkommentar, Rechtstexte, Ergänzungen von Hand. */
import { createTranslator } from "./translator";
import ui from "../catalog/en.ui.json";
import game from "../catalog/en.game.json";
import sim from "../catalog/en.sim.json";
import legal from "../catalog/en.legal.json";
import manual from "../catalog/en.manual.json";

export const en = createTranslator(manual, ui, game, sim, legal);
