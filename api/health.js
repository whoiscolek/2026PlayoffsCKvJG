import { json } from "./utils.js";
export default function handler(req, res) {
  return json(res, 200, { ok: true, app: "Jamie Cole NBA Bets", time: new Date().toISOString() });
}
