import { ROUND_DATE_RULES, ROUND_VALUES } from "./config.js";

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.end(JSON.stringify(body));
}

export function normalizeTeamName(name = "") {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(los angeles)\b/g, "la")
    .replace(/\bnew york knicks\b/g, "knicks")
    .replace(/\s+/g, " ")
    .trim();
}

export function sameDateChicago(iso) {
  const date = new Date(iso || Date.now());
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function currentChicagoDate() {
  return sameDateChicago(new Date().toISOString());
}

export function isIsoDateBetween(dateStr, start, end) {
  return dateStr >= start && dateStr <= end;
}

export function inferRoundForDate(dateStr, gameLabel = "") {
  const lowerLabel = String(gameLabel).toLowerCase();
  const isGame7 = /game\s*7/.test(lowerLabel);
  const finalsRule = ROUND_DATE_RULES.find(rule => rule.round === "finals");
  if (finalsRule && isIsoDateBetween(dateStr, finalsRule.start, finalsRule.end) && isGame7) {
    return { key: "finals_game_7", label: "NBA Finals — Game 7", value: ROUND_VALUES.finals_game_7 };
  }
  const rule = ROUND_DATE_RULES.find(rule => isIsoDateBetween(dateStr, rule.start, rule.end));
  if (!rule) return { key: "conference_semifinals", label: "Conference Semifinals", value: ROUND_VALUES.conference_semifinals };
  return { key: rule.round, label: rule.label, value: ROUND_VALUES[rule.round] };
}

export function americanOddsToString(price) {
  if (price === undefined || price === null || Number.isNaN(Number(price))) return "—";
  const n = Number(price);
  return n > 0 ? `+${n}` : String(n);
}
