// Edit this file when the playoff round dates become clearer.
// The app uses this to decide whether the wager is $1/$2/$3/$4/$10.

export const PLAYERS = ["Coleman", "Jamie"];

export const STARTING_LEDGER = {
  Coleman: -11,
  Jamie: 11
};

// Dates use the user's local dashboard date: YYYY-MM-DD.
// 2026 ranges are intentionally editable because the exact day a series starts can shift.
export const ROUND_DATE_RANGES = [
  { id: "first_round", label: "First Round", value: 1, start: "2026-04-18", end: "2026-05-03" },
  { id: "conference_semifinals", label: "Conference Semifinals", value: 2, start: "2026-05-04", end: "2026-05-18" },
  { id: "conference_finals", label: "Conference Finals", value: 3, start: "2026-05-19", end: "2026-06-03" },
  { id: "finals", label: "NBA Finals", value: 4, start: "2026-06-04", end: "2026-06-21" }
];

// Use this for edge cases. Example:
// "0042500407": { roundId: "finals", label: "NBA Finals Game 7", value: 10 }
export const GAME_OVERRIDES = {};

export function getRoundInfo(game, dashboardDate) {
  if (GAME_OVERRIDES[game.gameId]) return GAME_OVERRIDES[game.gameId];

  const finalsGame7 =
    game.roundId === "finals" &&
    String(game.gameLabel || "").toLowerCase().includes("game 7");

  if (finalsGame7) {
    return { id: "finals_game_7", label: "NBA Finals Game 7", value: 10 };
  }

  const match = ROUND_DATE_RANGES.find(r => dashboardDate >= r.start && dashboardDate <= r.end);
  if (match) return match;

  return { id: "unknown", label: "Playoff Game", value: 1 };
}
