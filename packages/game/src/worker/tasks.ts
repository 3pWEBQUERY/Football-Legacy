/**
 * Rechenintensive Aufgaben, die über den Hintergrunddienst laufen können.
 * Die Web-API ruft `bg.<aufgabe>(…)` statt der Funktion direkt auf.
 */
import { createCareer } from "../career";
import { advance, continueMatch, quickMatch, startMatch, stepMatch } from "../match";
import { playOnlineRound, setOnlineReady } from "../online";
import { type JobMeta, registerTask, runTask } from "./queue";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function task<F extends (...a: any[]) => Promise<any>>(name: string, fn: F, meta: (...a: Parameters<F>) => JobMeta) {
  registerTask(name, fn);
  return (...a: Parameters<F>) => runTask<Awaited<ReturnType<F>>>(name, a, meta(...a));
}

const own = (careerId: string, accountId: string): JobMeta => ({ careerId, accountId });

export const bg = {
  advance: task("advance", advance, own),
  quickMatch: task("quickMatch", quickMatch, own),
  startMatch: task("startMatch", startMatch, own),
  stepMatch: task("stepMatch", stepMatch, own),
  continueMatch: task("continueMatch", continueMatch, own),
  createCareer: task("createCareer", createCareer, (accountId) => ({ accountId })),
  playOnlineRound: task("playOnlineRound", playOnlineRound, (accountId) => ({ accountId })),
  setOnlineReady: task("setOnlineReady", setOnlineReady, (accountId) => ({ accountId })),
};
