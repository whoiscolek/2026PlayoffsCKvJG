import { ODDS_API_KEY, ODDS_BASE_URL, NBA_SCOREBOARD_BASE_URL, NBA_INJURY_REPORT_URL } from "./config.js";
import { json, normalizeTeamName, sameDateChicago, inferRoundForDate, americanOddsToString } from "./utils.js";

function getChicagoDateString() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const year = parts.find(part => part.type === "year").value;
  const month = parts.find(part => part.type === "month").value;
  const day = parts.find(part => part.type === "day").value;

  return `${year}${month}${day}`;
}

function getScoreboardUrl(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedDate = url.searchParams.get("date");

  if (requestedDate) {
    const cleanDate = requestedDate.replaceAll("-", "");
    return `${NBA_SCOREBOARD_BASE_URL}/scoreboard_${cleanDate}.json`;
  }

  return `${NBA_SCOREBOARD_BASE_URL}/scoreboard_${getChicagoDateString()}.json`;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${url}`);
  }
  return response.json();
}

async function getOdds() {
  if (!ODDS_API_KEY) return [];
  const url = `${ODDS_BASE_URL}/sports/basketball_nba/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h&oddsFormat=american&dateFormat=iso`;
  try {
    return await fetchJson(url);
  } catch (error) {
    console.error("Odds fetch failed", error);
    return [];
  }
}

function findMatchingOdds(nbaGame, oddsGames) {
  const home = normalizeTeamName(nbaGame.homeTeam.teamName || nbaGame.homeTeam.teamCity + " " + nbaGame.homeTeam.teamName);
  const away = normalizeTeamName(nbaGame.awayTeam.teamName || nbaGame.awayTeam.teamCity + " " + nbaGame.awayTeam.teamName);
  const homeFull = normalizeTeamName(`${nbaGame.homeTeam.teamCity} ${nbaGame.homeTeam.teamName}`);
  const awayFull = normalizeTeamName(`${nbaGame.awayTeam.teamCity} ${nbaGame.awayTeam.teamName}`);

  return oddsGames.find(game => {
    const oddsHome = normalizeTeamName(game.home_team);
    const oddsAway = normalizeTeamName(game.away_team);
    return (
      (oddsHome.includes(home) || homeFull.includes(oddsHome) || oddsHome.includes(homeFull)) &&
      (oddsAway.includes(away) || awayFull.includes(oddsAway) || oddsAway.includes(awayFull))
    ) || (
      (oddsHome.includes(away) || awayFull.includes(oddsHome) || oddsHome.includes(awayFull)) &&
      (oddsAway.includes(home) || homeFull.includes(oddsAway) || oddsAway.includes(homeFull))
    );
  });
}

function selectBestBookmaker(oddsGame) {
  if (!oddsGame?.bookmakers?.length) return null;
  const preferred = ["draftkings", "fanduel", "betmgm", "caesars", "betrivers", "espnbet"];
  return oddsGame.bookmakers.find(book => preferred.includes(book.key)) || oddsGame.bookmakers[0];
}

function mapOddsToTeams(nbaGame, oddsGame) {
  const empty = {
    bookmaker: "No listed book",
    homeOdds: "—",
    awayOdds: "—",
    lastUpdate: null
  };
  if (!oddsGame) return empty;
  const book = selectBestBookmaker(oddsGame);
  const market = book?.markets?.find(m => m.key === "h2h");
  if (!market) return empty;

  const homeFull = normalizeTeamName(`${nbaGame.homeTeam.teamCity} ${nbaGame.homeTeam.teamName}`);
  const awayFull = normalizeTeamName(`${nbaGame.awayTeam.teamCity} ${nbaGame.awayTeam.teamName}`);
  let homePrice = null;
  let awayPrice = null;

  for (const outcome of market.outcomes || []) {
    const name = normalizeTeamName(outcome.name);
    if (homeFull.includes(name) || name.includes(homeFull) || name.includes(normalizeTeamName(nbaGame.homeTeam.teamName))) {
      homePrice = outcome.price;
    }
    if (awayFull.includes(name) || name.includes(awayFull) || name.includes(normalizeTeamName(nbaGame.awayTeam.teamName))) {
      awayPrice = outcome.price;
    }
  }

  return {
    bookmaker: book?.title || "Listed book",
    homeOdds: americanOddsToString(homePrice),
    awayOdds: americanOddsToString(awayPrice),
    lastUpdate: book?.last_update || oddsGame.commence_time || null
  };
}

function makeSeriesText(game) {
  const label = game.gameLabel || game.gameEt || "";
  const seriesText = game.seriesText || "";
  return seriesText || label || "Series info updates when listed by NBA.";
}

function mapNbaGame(game, oddsGames) {
  const gameDate = sameDateChicago(game.gameTimeUTC || game.gameTimeLTZ || Date.now());
  const round = inferRoundForDate(gameDate, game.gameLabel || game.gameEt || "");
  const oddsGame = findMatchingOdds(game, oddsGames);
  const odds = mapOddsToTeams(game, oddsGame);
  const homeTeam = {
    id: String(game.homeTeam.teamId),
    city: game.homeTeam.teamCity,
    name: game.homeTeam.teamName,
    fullName: `${game.homeTeam.teamCity} ${game.homeTeam.teamName}`,
    triCode: game.homeTeam.teamTricode,
    score: Number(game.homeTeam.score || 0)
  };
  const awayTeam = {
    id: String(game.awayTeam.teamId),
    city: game.awayTeam.teamCity,
    name: game.awayTeam.teamName,
    fullName: `${game.awayTeam.teamCity} ${game.awayTeam.teamName}`,
    triCode: game.awayTeam.teamTricode,
    score: Number(game.awayTeam.score || 0)
  };
  const isFinal = Number(game.gameStatus) === 3 || /final/i.test(game.gameStatusText || "");
  const winnerTeamId = isFinal
    ? (homeTeam.score > awayTeam.score ? homeTeam.id : awayTeam.score > homeTeam.score ? awayTeam.id : null)
    : null;

  return {
    gameId: String(game.gameId),
    gameCode: game.gameCode,
    date: gameDate,
    status: Number(game.gameStatus || 1),
    statusText: game.gameStatusText || "Scheduled",
    period: game.period || 0,
    clock: game.gameClock || "",
    gameTimeUTC: game.gameTimeUTC,
    arena: game.arenaName || "",
    homeTeam,
    awayTeam,
    seriesText: makeSeriesText(game),
    gameLabel: game.gameLabel || game.gameEt || "",
    round,
    odds,
    isFinal,
    winnerTeamId,
    injuryReportUrl: NBA_INJURY_REPORT_URL,
    recapSeed: {
      title: `${awayTeam.fullName} at ${homeTeam.fullName}`,
      summary: `${awayTeam.fullName} visit ${homeTeam.fullName}. ${makeSeriesText(game)}. Current moneyline is ${awayTeam.triCode} ${odds.awayOdds} and ${homeTeam.triCode} ${odds.homeOdds} via ${odds.bookmaker}.`,
      injuryNote: "Use the linked official NBA injury report for the latest availability before tipoff.",
      oddsNote: odds.lastUpdate ? `Odds last updated ${new Date(odds.lastUpdate).toLocaleString("en-US", { timeZone: "America/Chicago" })}.` : "Odds may not be posted yet."
    }
  };
}

export default async function handler(req, res) {
  try {
    const scoreboardUrl = getScoreboardUrl(req);
    const [scoreboard, oddsGames] = await Promise.all([fetchJson(scoreboardUrl), getOdds()]);
    const games = scoreboard?.scoreboard?.games || [];
    const today = new URL(req.url, `http://${req.headers.host}`).searchParams.get("date") || null;
    const mapped = games
      .map(game => mapNbaGame(game, oddsGames))
      .filter(game => !today || game.date === today);

    return json(res, 200, {
      generatedAt: new Date().toISOString(),
      source: "NBA live scoreboard + The Odds API",
      games: mapped
    });
  } catch (error) {
    console.error(error);
    return json(res, 500, {
      error: "Failed to load NBA games.",
      details: error.message
    });
  }
}
