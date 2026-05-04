// You asked for this Odds API key to be committed. If this repo is public, the key is public.
// To override later, add ODDS_API_KEY in Vercel Environment Variables.
export const ODDS_API_KEY = process.env.ODDS_API_KEY || "d894360865dfb9af7b8cf1712b353b05";

export const ODDS_BASE_URL = "https://api.the-odds-api.com/v4";
export const NBA_SCOREBOARD_URL = "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json";
export const NBA_INJURY_REPORT_URL = "https://official.nba.com/nba-injury-report-2025-26-season/";

export const ROUND_VALUES = {
  first_round: 1,
  conference_semifinals: 2,
  conference_finals: 3,
  finals: 4,
  finals_game_7: 10
};

// Update these dates if NBA moves the 2026 playoff calendar. Firestore/admin overrides can also be added from the UI.
export const ROUND_DATE_RULES = [
  { round: "first_round", label: "First Round", start: "2026-04-18", end: "2026-05-03" },
  { round: "conference_semifinals", label: "Conference Semifinals", start: "2026-05-04", end: "2026-05-18" },
  { round: "conference_finals", label: "Conference Finals", start: "2026-05-19", end: "2026-06-01" },
  { round: "finals", label: "NBA Finals", start: "2026-06-04", end: "2026-06-21" }
];
