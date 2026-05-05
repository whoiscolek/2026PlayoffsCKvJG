import {
  ODDS_API_KEY,
  ODDS_BASE_URL,
  NBA_SCOREBOARD_URL,
  NBA_SCOREBOARD_V3_URL,
  NBA_INJURY_REPORT_URL
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

async function fetchNbaStatsJson(url) {
  return fetchJson(url, {
    headers: {
      "Accept": "application/json, text/plain, */*",
      "Origin": "https://www.nba.com",
      "Referer": "https://www.nba.com/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "x-nba-stats-origin": "stats",
      "x-nba-stats-token": "true"
    }
  });
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

function getChicagoDateString() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const year = parts.find(part => part.type === "year")?.value;
  const month = parts.find(part => part.type === "month")?.value;
  const day = parts.find(part => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

function getRequestedDate(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  return url.searchParams.get("date") || getChicagoDateString();
}

function getScoreboardV3Url(dateString) {
  return `${NBA_SCOREBOARD_V3_URL}?GameDate=${encodeURIComponent(dateString)}&LeagueID=00`;
}

function resultSetToObjects(resultSet) {
  if (!resultSet) return [];

  const headers =
    resultSet.headers ||
    resultSet.Headers ||
    resultSet.columns ||
    resultSet.Columns ||
    [];

  const rows =
    resultSet.rowSet ||
    resultSet.RowSet ||
    resultSet.rows ||
    resultSet.Rows ||
    [];

  return rows.map(row => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = row[index];
    });
    return obj;
  });
}

function getResultSet(payload, name) {
  const sets = payload?.resultSets || payload?.ResultSets;

  if (!sets) return null;

  if (Array.isArray(sets)) {
    return sets.find(set =>
      String(set.name || set.Name || "").toLowerCase() === name.toLowerCase()
    );
  }

  return sets[name] || sets[name.toLowerCase()] || null;
}

function parseEtGameTimeToUtc(dateString, statusText) {
  const text = String(statusText || "");
  const match = text.match(/(\d{1,2}):(\d{2})\s*(am|pm)\s*ET/i);

  if (!match) {
    return `${dateString}T17:00:00Z`;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const ampm = match[3].toLowerCase();

  if (ampm === "pm" && hour !== 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;

  const month = Number(dateString.slice(5, 7));
  const easternOffsetHours = month >= 3 && month <= 11 ? 4 : 5;
  const utcHour = hour + easternOffsetHours;

  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCHours(utcHour, minute, 0, 0);

  return date.toISOString();
}

function normalizeV3PayloadToGames(payload, requestedDate) {
  if (payload?.scoreboard?.games?.length) {
    return payload.scoreboard.games;
  }

  if (payload?.games?.length) {
    return payload.games;
  }

  const gameHeaderSet = getResultSet(payload, "GameHeader");
  const lineScoreSet = getResultSet(payload, "LineScore");
  const seriesSet = getResultSet(payload, "SeriesStandings");

  const gameHeaders = resultSetToObjects(gameHeaderSet);
  const lineScores = resultSetToObjects(lineScoreSet);
  const seriesRows = resultSetToObjects(seriesSet);

  if (!gameHeaders.length) return [];

  return gameHeaders.map(header => {
    const gameId = String(header.GAME_ID || header.GameID || header.gameId || "");
    const homeTeamId = String(header.HOME_TEAM_ID || header.HomeTeamID || "");
    const awayTeamId = String(header.VISITOR_TEAM_ID || header.AWAY_TEAM_ID || header.AwayTeamID || "");

    const homeLine = lineScores.find(row => String(row.TEAM_ID) === homeTeamId) || {};
    const awayLine = lineScores.find(row => String(row.TEAM_ID) === awayTeamId) || {};

    const series = seriesRows.find(row => String(row.GAME_ID || row.GameID || "") === gameId) || {};

    const status = Number(header.GAME_STATUS_ID || header.GAME_STATUS || header.gameStatus || 1);
    const statusText = String(header.GAME_STATUS_TEXT || header.gameStatusText || header.STATUS_TEXT || "Scheduled");

    const gameDate =
      header.GAME_DATE_EST ||
      header.GAME_DATE ||
      header.GameDate ||
      requestedDate;

    const cleanDate = String(gameDate).slice(0, 10);

    return {
      gameId,
      gameCode: header.GAMECODE || header.GAME_CODE || header.gameCode || "",
      gameStatus: status,
      gameStatusText: statusText,
      period: Number(header.LIVE_PERIOD || header.PERIOD || header.period || 0),
      gameClock: header.LIVE_PC_TIME || header.GAME_CLOCK || header.gameClock || "",
      gameTimeUTC:
        header.GAME_TIME_UTC ||
        header.gameTimeUTC ||
        parseEtGameTimeToUtc(cleanDate, statusText),
      arenaName: header.ARENA_NAME || header.ARENA || header.arenaName || "",
      gameLabel: header.GAME_SUBTYPE || header.GAME_LABEL || header.gameLabel || "",
      seriesText:
        series.SERIES_TEXT ||
        series.SeriesText ||
        header.SERIES_TEXT ||
        header.seriesText ||
        "",

      homeTeam: {
        teamId: homeTeamId,
        teamCity:
          homeLine.TEAM_CITY_NAME ||
          header.HOME_TEAM_CITY ||
          header.HOME_TEAM_CITY_NAME ||
          "Home",
        teamName:
          homeLine.TEAM_NAME ||
          header.HOME_TEAM_NAME ||
          "Team",
        teamTricode:
          homeLine.TEAM_ABBREVIATION ||
          header.HOME_TEAM_ABBREVIATION ||
          header.HOME_TEAM_TRICODE ||
          "HOME",
        score:
          homeLine.PTS ||
          header.HOME_TEAM_SCORE ||
          0
      },

      awayTeam: {
        teamId: awayTeamId,
        teamCity:
          awayLine.TEAM_CITY_NAME ||
          header.VISITOR_TEAM_CITY ||
          header.AWAY_TEAM_CITY ||
          header.VISITOR_TEAM_CITY_NAME ||
          "Away",
        teamName:
          awayLine.TEAM_NAME ||
          header.VISITOR_TEAM_NAME ||
          header.AWAY_TEAM_NAME ||
          "Team",
        teamTricode:
          awayLine.TEAM_ABBREVIATION ||
          header.VISITOR_TEAM_ABBREVIATION ||
          header.AWAY_TEAM_ABBREVIATION ||
          header.VISITOR_TEAM_TRICODE ||
          "AWAY",
        score:
          awayLine.PTS ||
          header.VISITOR_TEAM_SCORE ||
          header.AWAY_TEAM_SCORE ||
          0
      }
    };
  });
}

async function getNbaGames(requestedDate) {
  let v3Games = [];
  let liveGames = [];
  let sourceParts = [];

  try {
    const v3Payload = await fetchNbaStatsJson(getScoreboardV3Url(requestedDate));
    v3Games = normalizeV3PayloadToGames(v3Payload, requestedDate);
    if (v3Games.length) sourceParts.push("NBA ScoreboardV3");
  } catch (error) {
    console.error("NBA ScoreboardV3 fetch failed", error);
  }

  try {
    const livePayload = await fetchJson(NBA_SCOREBOARD_URL);
    liveGames = livePayload?.scoreboard?.games || [];
    if (liveGames.length) sourceParts.push("NBA live scoreboard");
  } catch (error) {
    console.error("NBA live scoreboard fetch failed", error);
  }

  if (!v3Games.length && !liveGames.length) {
    throw new Error("No NBA scoreboard source returned games.");
  }

  const liveById = new Map(liveGames.map(game => [String(game.gameId), game]));

  const baseGames = v3Games.length ? v3Games : liveGames;

  const mergedGames = baseGames.map(game => {
    const live = liveById.get(String(game.gameId));
    return live ? { ...game, ...live } : game;
  });

  return {
    games: mergedGames,
    source: sourceParts.length ? `${sourceParts.join(" + ")} + The Odds API` : "NBA + The Odds API"
  };
}

function findMatchingOdds(nbaGame, oddsGames) {
  const home = normalizeTeamName(
    nbaGame.homeTeam.teamName ||
      `${nbaGame.homeTeam.teamCity} ${nbaGame.homeTeam.teamName}`
  );

  const away = normalizeTeamName(
    nbaGame.awayTeam.teamName ||
      `${nbaGame.awayTeam.teamCity} ${nbaGame.awayTeam.teamName}`
  );

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
  const market = book?.markets?.find(market => market.key === "h2h");

  if (!market) return empty;

  const homeFull = normalizeTeamName(`${nbaGame.homeTeam.teamCity} ${nbaGame.homeTeam.teamName}`);
  const awayFull = normalizeTeamName(`${nbaGame.awayTeam.teamCity} ${nbaGame.awayTeam.teamName}`);

  let homePrice = null;
  let awayPrice = null;

  for (const outcome of market.outcomes || []) {
    const name = normalizeTeamName(outcome.name);

    if (
      homeFull.includes(name) ||
      name.includes(homeFull) ||
      name.includes(normalizeTeamName(nbaGame.homeTeam.teamName))
    ) {
      homePrice = outcome.price;
    }

    if (
      awayFull.includes(name) ||
      name.includes(awayFull) ||
      name.includes(normalizeTeamName(nbaGame.awayTeam.teamName))
    ) {
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
        ? `Odds last updated ${new Date(odds.lastUpdate).toLocaleString("en-US", {
            timeZone: "America/Chicago"
          })}.`
        : "Odds may not be posted yet."
    }
  };
}

export default async function handler(req, res) {
  try {
    const requestedDate = getRequestedDate(req);

    const [nbaData, oddsGames] = await Promise.all([
      getNbaGames(requestedDate),
      getOdds()
    ]);

    const mapped = nbaData.games
      .map(game => mapNbaGame(game, oddsGames))
      .filter(game => game.date === requestedDate);

    return json(res, 200, {
      generatedAt: new Date().toISOString(),
      requestedDate,
      source: nbaData.source,
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
