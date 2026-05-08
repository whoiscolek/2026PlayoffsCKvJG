import { json } from "./utils.js";

async function fetchNbaBoxscore(gameId) {
  const url = `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${gameId}.json`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0"
    }
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from NBA boxscore endpoint`);
  }

  return response.json();
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const gameId = url.searchParams.get("gameId");

    if (!gameId) {
      return json(res, 400, {
        error: "Missing gameId."
      });
    }

    const data = await fetchNbaBoxscore(gameId);
    const game = data?.game;

    if (!game) {
      return json(res, 404, {
        error: "NBA boxscore did not return game data.",
        gameId
      });
    }

    return json(res, 200, {
      gameId,
      source: "NBA live boxscore",
      game
    });
  } catch (error) {
    console.error(error);

    return json(res, 500, {
      error: "Failed to retrieve NBA boxscore.",
      details: error.message
    });
  }
}
