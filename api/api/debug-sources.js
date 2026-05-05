import {
  ODDS_BASE_URL,
  NBA_SCOREBOARD_URL,
  NBA_SCOREBOARD_V3_URL,
  NBA_INJURY_REPORT_URL
} from "./config.js";

export default async function handler(req, res) {
  const chicagoDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

  const scoreboardV3Url = NBA_SCOREBOARD_V3_URL
    ? `${NBA_SCOREBOARD_V3_URL}?GameDate=${encodeURIComponent(chicagoDate)}&LeagueID=00`
    : null;

  res.status(200).json({
    message: "Debug source check",
    generatedAt: new Date().toISOString(),
    chicagoDate,
    configuredSources: {
      nbaLiveScoreboard: NBA_SCOREBOARD_URL || null,
      nbaScoreboardV3: NBA_SCOREBOARD_V3_URL || null,
      nbaScoreboardV3ForToday: scoreboardV3Url,
      oddsBaseUrl: ODDS_BASE_URL || null,
      injuryReportUrl: NBA_INJURY_REPORT_URL || null
    }
  });
}
