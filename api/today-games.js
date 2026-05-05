import {
  ODDS_API_KEY,
  ODDS_BASE_URL,
  NBA_SCOREBOARD_URL,
  NBA_INJURY_REPORT_URL,
  NBA_TEAMS
} from "./config.js";

import {
  json,
  normalizeTeamName,
  sameDateChicago,
  inferRoundForDate,
  americanOddsToString
} from "./utils.js";

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${url}`);
  }

  return response.json();
}

function getChicagoDateString() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function getRequestedDate(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  return url.searchParams.get("date") || getChicagoDateString();
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

async function getLiveScoreboardGames() {
  try {
    const livePayload = await fetchJson(NBA_SCOREBOARD_URL);
    return livePayload?.scoreboard?.games || [];
  } catch (error) {
    console.error("NBA live scoreboard fetch failed", error);
    return [];
  }
}

function teamFromName(fullName) {
  const key = normalizeTeamName(fullName);
  const team = NBA_TEAMS[key];

  if (team) {
    return {
      id: team.id,
      city: team.city,
      name: team.name,
      fullName: `${team.city} ${team.name}`,
      triCode: team.triCode,
      score: 0
    };
  }

  const parts = String(fullName || "Unknown Team").split(" ");
  const name = parts.pop() || "Team";
  const city = parts.join(" ") || "Unknown";

  return {
    id: key || fullName,
    city,
    name,
    fullName: `${city} ${name}`.trim(),
    triCode: name.slice(0, 3).toUpperCase(),
    score: 0
  };
}

function selectBestBookmaker(oddsGame) {
  if (!oddsGame?.bookmakers?.length) return null;

  const preferred = ["draftkings", "fanduel", "betmgm", "caesars", "betrivers", "espnbet"];
  return oddsGame.bookmakers.find(book => preferred.includes(book.key)) || oddsGame.bookmakers[0];
}

function getH2HMarket(oddsGame) {
  const book = selectBestBookmaker(oddsGame);
  const market = book?.markets?.find(item => item.key === "h2h") || null;
  return { book, market };
}

function oddsForTeam(market, teamFullName) {
  const teamKey = normalizeTeamName(teamFullName);
  const outcome = market?.outcomes?.find(item => {
    const outcomeKey = normalizeTeamName(item.name);
    return outcomeKey === teamKey || outcomeKey.includes(teamKey) || teamKey.includes(outcomeKey);
  });

  return americanOddsToString(outcome?.price);
}

function makeSeriesText(game) {
  const label = game.gameLabel || game.gameEt || "";
  const seriesText = game.seriesText || "";
  return seriesText || label || "Series info updates when listed by NBA.";
}

function liveGameMatchesOddsGame(liveGame, oddsGame) {
  const liveHome = normalizeTeamName(`${liveGame.homeTeam?.teamCity || ""} ${liveGame.homeTeam?.teamName || ""}`);
  const liveAway = normalizeTeamName(`${liveGame.awayTeam?.teamCity || ""} ${liveGame.awayTeam?.teamName || ""}`);
  const oddsHome = normalizeTeamName(oddsGame.home_team);
  const oddsAway = normalizeTeamName(oddsGame.away_team);

  return (
    (liveHome.includes(oddsHome) || oddsHome.includes(liveHome)) &&
    (liveAway.includes(oddsAway) || oddsAway.includes(liveAway))
  ) || (
    (liveHome.includes(oddsAway) || oddsAway.includes(liveHome)) &&
    (liveAway.includes(oddsHome) || oddsHome.includes(liveAway))
  );
}

function findLiveMatchForOddsGame(oddsGame, liveGames) {
  return liveGames.find(game => liveGameMatchesOddsGame(game, oddsGame)) || null;
}

function mapOddsGameToDashboardGame(oddsGame, liveGames) {
  const liveGame = findLiveMatchForOddsGame(oddsGame, liveGames);
  const gameDate = sameDateChicago(oddsGame.commence_time);
  const round = inferRoundForDate(gameDate, liveGame?.gameLabel || liveGame?.gameEt || "");

  const homeTeam = teamFromName(oddsGame.home_team);
  const awayTeam = teamFromName(oddsGame.away_team);

  if (liveGame) {
    homeTeam.id = String(liveGame.homeTeam?.teamId || homeTeam.id);
    homeTeam.city = liveGame.homeTeam?.teamCity || homeTeam.city;
    homeTeam.name = liveGame.homeTeam?.teamName || homeTeam.name;
    homeTeam.fullName = `${homeTeam.city} ${homeTeam.name}`;
    homeTeam.triCode = liveGame.homeTeam?.teamTricode || homeTeam.triCode;
    homeTeam.score = Number(liveGame.homeTeam?.score || 0);

    awayTeam.id = String(liveGame.awayTeam?.teamId || awayTeam.id);
    awayTeam.city = liveGame.awayTeam?.teamCity || awayTeam.city;
    awayTeam.name = liveGame.awayTeam?.teamName || awayTeam.name;
    awayTeam.fullName = `${awayTeam.city} ${awayTeam.name}`;
    awayTeam.triCode = liveGame.awayTeam?.teamTricode || awayTeam.triCode;
    awayTeam.score = Number(liveGame.awayTeam?.score || 0);
  }

  const { book, market } = getH2HMarket(oddsGame);

  const odds = {
    bookmaker: book?.title || "No listed book",
    homeOdds: oddsForTeam(market, oddsGame.home_team),
    awayOdds: oddsForTeam(market, oddsGame.away_team),
    lastUpdate: book?.last_update || oddsGame.commence_time || null
  };

  const isFinal = liveGame
    ? Number(liveGame.gameStatus) === 3 || /final/i.test(liveGame.gameStatusText || "")
    : false;

  const winnerTeamId = isFinal
    ? homeTeam.score > awayTeam.score
      ? homeTeam.id
      : awayTeam.score > homeTeam.score
        ? awayTeam.id
        : null
    : null;

  const gameId = liveGame?.gameId
    ? String(liveGame.gameId)
    : `odds-${gameDate}-${awayTeam.triCode}-${homeTeam.triCode}`;

  return {
    gameId,
    gameCode: liveGame?.gameCode || `${gameDate.replaceAll("-", "")}/${awayTeam.triCode}${homeTeam.triCode}`,
    date: gameDate,
    status: Number(liveGame?.gameStatus || 1),
    statusText: liveGame?.gameStatusText || new Date(oddsGame.commence_time).toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short"
    }),
    period: Number(liveGame?.period || 0),
    clock: liveGame?.gameClock || "",
    gameTimeUTC: oddsGame.commence_time,
    arena: liveGame?.arenaName || "",
    homeTeam,
    awayTeam,
    seriesText: liveGame ? makeSeriesText(liveGame) : "Series info updates when listed by NBA.",
    gameLabel: liveGame?.gameLabel || liveGame?.gameEt || "",
    round,
    odds,
    isFinal,
    winnerTeamId,
    injuryReportUrl: NBA_INJURY_REPORT_URL,
    recapSeed: {
      title: `${awayTeam.fullName} at ${homeTeam.fullName}`,
      summary: `${awayTeam.fullName} visit ${homeTeam.fullName}. Current moneyline is ${awayTeam.triCode} ${odds.awayOdds} and ${homeTeam.triCode} ${odds.homeOdds} via ${odds.bookmaker}.`,
      injuryNote: "Use the linked official NBA injury report for the latest availability before tipoff.",
      oddsNote: odds.lastUpdate
        ? `Odds last updated ${new Date(odds.lastUpdate).toLocaleString("en-US", { timeZone: "America/Chicago" })}.`
        : "Odds may not be posted yet."
    }
  };
}

function mapLiveGameToDashboardGame(game, oddsGames) {
  const gameDate = sameDateChicago(game.gameTimeUTC || game.gameTimeLTZ || Date.now());
  const matchingOdds = oddsGames.find(oddsGame => liveGameMatchesOddsGame(game, oddsGame));
  const round = inferRoundForDate(gameDate, game.gameLabel || game.gameEt || "");

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

  const { book, market } = getH2HMarket(matchingOdds);

  const odds = {
    bookmaker: book?.title || "No listed book",
    homeOdds: oddsForTeam(market, homeTeam.fullName),
    awayOdds: oddsForTeam(market, awayTeam.fullName),
    lastUpdate: book?.last_update || matchingOdds?.commence_time || null
  };

  const isFinal = Number(game.gameStatus) === 3 || /final/i.test(game.gameStatusText || "");

  const winnerTeamId = isFinal
    ? homeTeam.score > awayTeam.score
      ? homeTeam.id
      : awayTeam.score > homeTeam.score
        ? awayTeam.id
        : null
    : null;

  return {
    gameId: String(game.gameId),
    gameCode: game.gameCode,
    date: gameDate,
    status: Number(game.gameStatus || 1),
    statusText: game.gameStatusText || "Scheduled",
    period: Number(game.period || 0),
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
      oddsNote: odds.lastUpdate
        ? `Odds last updated ${new Date(odds.lastUpdate).toLocaleString("en-US", { timeZone: "America/Chicago" })}.`
        : "Odds may not be posted yet."
    }
  };
}

function dedupeGames(games) {
  const seen = new Set();
  const output = [];

  for (const game of games) {
    const key = game.gameId || `${game.date}-${game.awayTeam.triCode}-${game.homeTeam.triCode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(game);
  }

  return output.sort((a, b) => new Date(a.gameTimeUTC) - new Date(b.gameTimeUTC));
}

export default async function handler(req, res) {
  try {
    const requestedDate = getRequestedDate(req);

    const [oddsGames, liveGames] = await Promise.all([
      getOdds(),
      getLiveScoreboardGames()
    ]);

    const oddsDashboardGames = oddsGames
      .filter(game => sameDateChicago(game.commence_time) === requestedDate)
      .map(game => mapOddsGameToDashboardGame(game, liveGames));

    const liveDashboardGames = liveGames
      .map(game => mapLiveGameToDashboardGame(game, oddsGames))
      .filter(game => game.date === requestedDate);

    const games = dedupeGames([...oddsDashboardGames, ...liveDashboardGames]);

    return json(res, 200, {
      generatedAt: new Date().toISOString(),
      requestedDate,
      source: "The Odds API schedule + NBA live scoreboard",
      debugCounts: {
        oddsGames: oddsGames.length,
        liveGames: liveGames.length,
        oddsGamesForRequestedDate: oddsDashboardGames.length,
        liveGamesForRequestedDate: liveDashboardGames.length
      },
      games
    });
  } catch (error) {
    console.error(error);

    return json(res, 500, {
      error: "Failed to load NBA games.",
      details: error.message
    });
  }
}
