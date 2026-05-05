// You asked for this Odds API key to be committed. If this repo is public, the key is public.
// To override later, add ODDS_API_KEY in Vercel Environment Variables.
export const ODDS_API_KEY = "d894360865dfb9af7b8cf1712b353b05";
export const ODDS_BASE_URL = "https://api.the-odds-api.com/v4";

export const NBA_SCOREBOARD_URL =
  "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json";

export const NBA_INJURY_REPORT_URL =
  "https://official.nba.com/nba-injury-report-2025-26-season/";

export const ROUND_VALUES = {
  first_round: 1,
  conference_semifinals: 2,
  conference_finals: 3,
  finals: 4,
  finals_game_7: 10
};

export const ROUND_DATE_RULES = [
  { round: "first_round", label: "First Round", start: "2026-04-18", end: "2026-05-03" },
  { round: "conference_semifinals", label: "Conference Semifinals", start: "2026-05-04", end: "2026-05-18" },
  { round: "conference_finals", label: "Conference Finals", start: "2026-05-19", end: "2026-06-03" },
  { round: "finals", label: "NBA Finals", start: "2026-06-04", end: "2026-06-21" }
];

export const NBA_TEAMS = {
  "atlanta hawks": { id: "1610612737", city: "Atlanta", name: "Hawks", triCode: "ATL" },
  "boston celtics": { id: "1610612738", city: "Boston", name: "Celtics", triCode: "BOS" },
  "brooklyn nets": { id: "1610612751", city: "Brooklyn", name: "Nets", triCode: "BKN" },
  "charlotte hornets": { id: "1610612766", city: "Charlotte", name: "Hornets", triCode: "CHA" },
  "chicago bulls": { id: "1610612741", city: "Chicago", name: "Bulls", triCode: "CHI" },
  "cleveland cavaliers": { id: "1610612739", city: "Cleveland", name: "Cavaliers", triCode: "CLE" },
  "dallas mavericks": { id: "1610612742", city: "Dallas", name: "Mavericks", triCode: "DAL" },
  "denver nuggets": { id: "1610612743", city: "Denver", name: "Nuggets", triCode: "DEN" },
  "detroit pistons": { id: "1610612765", city: "Detroit", name: "Pistons", triCode: "DET" },
  "golden state warriors": { id: "1610612744", city: "Golden State", name: "Warriors", triCode: "GSW" },
  "houston rockets": { id: "1610612745", city: "Houston", name: "Rockets", triCode: "HOU" },
  "indiana pacers": { id: "1610612754", city: "Indiana", name: "Pacers", triCode: "IND" },
  "la clippers": { id: "1610612746", city: "LA", name: "Clippers", triCode: "LAC" },
  "los angeles clippers": { id: "1610612746", city: "LA", name: "Clippers", triCode: "LAC" },
  "los angeles lakers": { id: "1610612747", city: "Los Angeles", name: "Lakers", triCode: "LAL" },
  "memphis grizzlies": { id: "1610612763", city: "Memphis", name: "Grizzlies", triCode: "MEM" },
  "miami heat": { id: "1610612748", city: "Miami", name: "Heat", triCode: "MIA" },
  "milwaukee bucks": { id: "1610612749", city: "Milwaukee", name: "Bucks", triCode: "MIL" },
  "minnesota timberwolves": { id: "1610612750", city: "Minnesota", name: "Timberwolves", triCode: "MIN" },
  "new orleans pelicans": { id: "1610612740", city: "New Orleans", name: "Pelicans", triCode: "NOP" },
  "new york knicks": { id: "1610612752", city: "New York", name: "Knicks", triCode: "NYK" },
  "oklahoma city thunder": { id: "1610612760", city: "Oklahoma City", name: "Thunder", triCode: "OKC" },
  "orlando magic": { id: "1610612753", city: "Orlando", name: "Magic", triCode: "ORL" },
  "philadelphia 76ers": { id: "1610612755", city: "Philadelphia", name: "76ers", triCode: "PHI" },
  "phoenix suns": { id: "1610612756", city: "Phoenix", name: "Suns", triCode: "PHX" },
  "portland trail blazers": { id: "1610612757", city: "Portland", name: "Trail Blazers", triCode: "POR" },
  "sacramento kings": { id: "1610612758", city: "Sacramento", name: "Kings", triCode: "SAC" },
  "san antonio spurs": { id: "1610612759", city: "San Antonio", name: "Spurs", triCode: "SAS" },
  "toronto raptors": { id: "1610612761", city: "Toronto", name: "Raptors", triCode: "TOR" },
  "utah jazz": { id: "1610612762", city: "Utah", name: "Jazz", triCode: "UTA" },
  "washington wizards": { id: "1610612764", city: "Washington", name: "Wizards", triCode: "WAS" }
};
