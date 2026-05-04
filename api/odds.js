import { ODDS_API_KEY, ODDS_BASE_URL } from "./config.js";
import { json } from "./utils.js";

export default async function handler(req, res) {
  try {
    const url = `${ODDS_BASE_URL}/sports/basketball_nba/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h&oddsFormat=american&dateFormat=iso`;
    const response = await fetch(url);
    const data = await response.json();
    return json(res, response.ok ? 200 : response.status, data);
  } catch (error) {
    return json(res, 500, { error: error.message });
  }
}
