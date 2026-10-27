/** Push-Mitteilungen für Online-Ligen: Spieltage, Saisonstart, Beitritte, Nachrichten. */
import { notifyLater } from "./account/push";

interface League { id: string; name: string; owner_id: string }
interface Member { id: number; account_id: string | null; bot: boolean; manager: string; team: { name: string } }
interface Result { home_id: number; away_id: number; hg: number; ag: number }

const humans = (ms: Member[], except?: string | null) =>
  ms.filter((m) => !m.bot && m.account_id && m.account_id !== except).map((m) => m.account_id as string);
const url = (l: League) => `/online/${l.id}`;

export function pushRound(l: League, round: number, ms: Member[], results: Result[], champion: string | null) {
  const name = new Map(ms.map((m) => [m.id, m.team.name]));
  for (const m of ms) {
    if (m.bot || !m.account_id) continue;
    const own = results.find((r) => r.home_id === m.id || r.away_id === m.id);
    const line = own ? `${name.get(own.home_id)} ${own.hg}:${own.ag} ${name.get(own.away_id)}` : "Dein Team war spielfrei.";
    notifyLater([m.account_id], "online", {
      title: `${l.name} · ${round}. Spieltag`,
      body: champion ? `${line}\n🏆 ${champion} ist Meister!` : line,
      url: url(l),
      tag: `online-${l.id}-round`,
    });
  }
}

export function pushSeason(l: League, season: number, rounds: number, ms: Member[], actor: string) {
  notifyLater(humans(ms, actor), "online", { title: l.name, body: `Saison ${season} hat begonnen: ${rounds} Spieltage.`, url: url(l), tag: `online-${l.id}-season` });
}

export function pushJoin(l: League, manager: string, team: string) {
  notifyLater([l.owner_id], "online", { title: l.name, body: `${manager} ist mit ${team} beigetreten.`, url: url(l), tag: `online-${l.id}-join` });
}

export function pushChat(l: League, ms: Member[], author: { id: string; name: string }, text: string) {
  notifyLater(humans(ms, author.id), "online", {
    title: `${author.name} in ${l.name}`,
    body: text.length > 140 ? `${text.slice(0, 137)}…` : text,
    url: url(l),
    tag: `online-${l.id}-chat`,
  });
}
