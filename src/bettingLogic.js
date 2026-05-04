import { PLAYERS } from "./config.js";

export function getPickTeamLabel(game, teamId) {
  if (!teamId) return "No pick";
  if (String(teamId) === String(game.homeTeam.id)) return game.homeTeam.triCode;
  if (String(teamId) === String(game.awayTeam.id)) return game.awayTeam.triCode;
  return "Unknown";
}

export function getBetState(game, pickDoc) {
  const colePick = pickDoc?.picks?.cole || null;
  const jamiePick = pickDoc?.picks?.jamie || null;
  if (!colePick && !jamiePick) return { key: "waiting", label: "No picks yet", active: false };
  if (!colePick || !jamiePick) return { key: "waiting", label: "Waiting for both", active: false };
  if (String(colePick) === String(jamiePick)) return { key: "canceled", label: "Canceled: same team", active: false };
  return { key: "active", label: "Active bet", active: true };
}

export function gradeGame(game, pickDoc) {
  const state = getBetState(game, pickDoc);
  if (!game.isFinal || !game.winnerTeamId || !state.active) return null;
  const value = Number(pickDoc.round?.value || game.round?.value || 0);
  const coleWon = String(pickDoc.picks.cole) === String(game.winnerTeamId);
  const jamieWon = String(pickDoc.picks.jamie) === String(game.winnerTeamId);
  if (!coleWon && !jamieWon) return null;

  return {
    gameId: game.gameId,
    value,
    winner: coleWon ? "cole" : "jamie",
    loser: coleWon ? "jamie" : "cole",
    deltas: {
      cole: coleWon ? value : -value,
      jamie: jamieWon ? value : -value
    },
    summary: `${coleWon ? PLAYERS.cole.label : PLAYERS.jamie.label} won $${value}`
  };
}

export function calculateBalances(ledgerEvents = []) {
  const balances = {
    cole: PLAYERS.cole.startingBalance,
    jamie: PLAYERS.jamie.startingBalance
  };
  for (const event of ledgerEvents) {
    balances.cole += Number(event.deltas?.cole || 0);
    balances.jamie += Number(event.deltas?.jamie || 0);
  }
  return balances;
}
