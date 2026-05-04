export const PLAYERS = {
  cole: { label: "Cole", startingBalance: -11 },
  jamie: { label: "Jamie", startingBalance: 11 }
};

export const ROUND_VALUES = {
  first_round: { label: "First Round", value: 1 },
  conference_semifinals: { label: "Conference Semifinals", value: 2 },
  conference_finals: { label: "Conference Finals", value: 3 },
  finals: { label: "NBA Finals", value: 4 },
  finals_game_7: { label: "NBA Finals Game 7", value: 10 }
};

export function formatMoney(value) {
  const n = Number(value || 0);
  if (n > 0) return `+$${n}`;
  if (n < 0) return `-$${Math.abs(n)}`;
  return "$0";
}

export function formatGameTime(iso) {
  if (!iso) return "Time TBA";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function isLocked(game) {
  if (game.isFinal) return true;
  if (!game.gameTimeUTC) return false;
  return Date.now() >= new Date(game.gameTimeUTC).getTime();
}
