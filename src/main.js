import { db, collection, doc, getDoc, getDocs, setDoc, deleteDoc, onSnapshot, serverTimestamp, query, orderBy } from "./firebase.js";
import { loadTodayGames } from "./api.js";
import { formatMoney, formatGameTime, isLocked, ROUND_VALUES } from "./config.js";
import { getPickTeamLabel, getBetState, gradeGame, calculateBalances } from "./bettingLogic.js";

const state = {
  games: [],
  picks: new Map(),
  ledger: [],
  roundOverrides: new Map(),
  selectedTab: "games"
};

const els = {
  gamesList: document.querySelector("#games-list"),
  ledgerList: document.querySelector("#ledger-list"),
  lastUpdated: document.querySelector("#last-updated"),
  coleBalance: document.querySelector("#cole-balance"),
  jamieBalance: document.querySelector("#jamie-balance"),
  refreshBtn: document.querySelector("#refresh-btn"),
  template: document.querySelector("#game-card-template"),
  manualGameId: document.querySelector("#manual-game-id"),
  manualWinnerId: document.querySelector("#manual-winner-id"),
  manualGradeBtn: document.querySelector("#manual-grade-btn"),
  roundGameId: document.querySelector("#round-game-id"),
  roundKey: document.querySelector("#round-key"),
  roundSaveBtn: document.querySelector("#round-save-btn")
};

init();

async function init() {
  wireTabs();
  wireAdmin();
  els.refreshBtn.addEventListener("click", refreshAll);
  subscribeToPicks();
  subscribeToLedger();
  subscribeToRoundOverrides();
  await refreshAll();
  setInterval(refreshAll, 90_000);
}

function wireTabs() {
  document.querySelectorAll(".tab").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(tab => tab.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.remove("active"));
      button.classList.add("active");
      document.querySelector(`#${button.dataset.tab}-tab`).classList.add("active");
      state.selectedTab = button.dataset.tab;
    });
  });
}

function wireAdmin() {
  els.manualGradeBtn.addEventListener("click", async () => {
    const gameId = els.manualGameId.value.trim();
    const winnerTeamId = els.manualWinnerId.value.trim();
    const game = state.games.find(g => g.gameId === gameId);
    if (!game || !winnerTeamId) return alert("Need a valid game ID and winner team ID.");
    const manualGame = { ...game, isFinal: true, winnerTeamId };
    await maybeGradeAndSave(manualGame);
    alert("Manual settlement attempted. Check ledger.");
  });

  els.roundSaveBtn.addEventListener("click", async () => {
    const gameId = els.roundGameId.value.trim();
    const key = els.roundKey.value;
    const round = { key, label: ROUND_VALUES[key].label, value: ROUND_VALUES[key].value };
    await setDoc(doc(db, "roundOverrides", gameId), { gameId, round, updatedAt: serverTimestamp() }, { merge: true });
    alert("Round override saved.");
  });
}

function subscribeToPicks() {
  onSnapshot(collection(db, "picks"), snapshot => {
    state.picks.clear();
    snapshot.forEach(item => state.picks.set(item.id, item.data()));
    render();
  });
}

function subscribeToLedger() {
  onSnapshot(query(collection(db, "ledger"), orderBy("createdAt", "desc")), snapshot => {
    state.ledger = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    renderLedger();
    renderBalances();
  });
}

function subscribeToRoundOverrides() {
  onSnapshot(collection(db, "roundOverrides"), snapshot => {
    state.roundOverrides.clear();
    snapshot.forEach(item => state.roundOverrides.set(item.id, item.data().round));
    applyRoundOverrides();
    render();
  });
}

async function refreshAll() {
  els.refreshBtn.disabled = true;
  els.refreshBtn.textContent = "Refreshing...";
  try {
    const data = await loadTodayGames();
    state.games = data.games || [];
    applyRoundOverrides();
    els.lastUpdated.textContent = `Updated ${new Date(data.generatedAt).toLocaleTimeString("en-US", { timeZone: "America/Chicago" })} CT · ${data.source}`;
    await autoGradeFinalGames();
    render();
  } catch (error) {
    console.error(error);
    els.gamesList.innerHTML = `<div class="empty-card">Could not load today's games. ${escapeHtml(error.message)}</div>`;
    els.lastUpdated.textContent = "Data load failed.";
  } finally {
    els.refreshBtn.disabled = false;
    els.refreshBtn.textContent = "Refresh";
  }
}

function applyRoundOverrides() {
  state.games = state.games.map(game => {
    const override = state.roundOverrides.get(game.gameId);
    return override ? { ...game, round: override } : game;
  });
}

async function autoGradeFinalGames() {
  for (const game of state.games) {
    if (game.isFinal) await maybeGradeAndSave(game);
  }
}

async function maybeGradeAndSave(game) {
  const pickDoc = state.picks.get(game.gameId);
  if (!pickDoc) return;
  const existing = await getDoc(doc(db, "ledger", game.gameId));
  if (existing.exists()) return;
  const result = gradeGame(game, pickDoc);
  if (!result) return;
  await setDoc(doc(db, "ledger", game.gameId), {
    ...result,
    matchup: `${game.awayTeam.triCode} at ${game.homeTeam.triCode}`,
    finalScore: `${game.awayTeam.triCode} ${game.awayTeam.score}, ${game.homeTeam.triCode} ${game.homeTeam.score}`,
    createdAt: serverTimestamp()
  });
}

function render() {
  renderBalances();
  renderGames();
  renderLedger();
}

function renderBalances() {
  const balances = calculateBalances(state.ledger);
  els.coleBalance.textContent = formatMoney(balances.cole);
  els.jamieBalance.textContent = formatMoney(balances.jamie);
  els.coleBalance.className = balances.cole >= 0 ? "positive" : "negative";
  els.jamieBalance.className = balances.jamie >= 0 ? "positive" : "negative";
}

function renderGames() {
  if (!state.games.length) {
    els.gamesList.innerHTML = `<div class="empty-card">No NBA games are listed for today yet. The dashboard will update when NBA posts games.</div>`;
    return;
  }

  els.gamesList.innerHTML = "";
  for (const game of state.games) {
    els.gamesList.appendChild(renderGameCard(game));
  }
}

function renderGameCard(game) {
  const node = els.template.content.cloneNode(true);
  const card = node.querySelector(".game-card");
  const pickDoc = state.picks.get(game.gameId) || {};
  const betState = getBetState(game, pickDoc);
  const locked = isLocked(game);
  const ledgerEvent = state.ledger.find(event => event.gameId === game.gameId);

  card.dataset.gameId = game.gameId;
  node.querySelector(".round-pill").textContent = game.round.label;
  node.querySelector(".matchup-title").textContent = `${game.awayTeam.fullName} at ${game.homeTeam.fullName}`;
  node.querySelector(".game-meta").textContent = `${formatGameTime(game.gameTimeUTC)} CT · ${game.statusText} · ${game.seriesText}`;
  node.querySelector(".value-badge").textContent = `$${game.round.value}`;

  node.querySelector(".away-code").textContent = game.awayTeam.triCode;
  node.querySelector(".away-name").textContent = game.awayTeam.fullName;
  node.querySelector(".away-odds").textContent = game.odds.awayOdds;
  node.querySelector(".home-code").textContent = game.homeTeam.triCode;
  node.querySelector(".home-name").textContent = game.homeTeam.fullName;
  node.querySelector(".home-odds").textContent = game.odds.homeOdds;

  node.querySelector(".cole-pick").textContent = getPickTeamLabel(game, pickDoc?.picks?.cole);
  node.querySelector(".jamie-pick").textContent = getPickTeamLabel(game, pickDoc?.picks?.jamie);
  node.querySelector(".bet-status").textContent = ledgerEvent ? `${ledgerEvent.summary} · ${ledgerEvent.finalScore}` : betState.label;

  const picker = node.querySelector(".picker-person");
  node.querySelectorAll(".team-pick").forEach(button => {
    const team = button.dataset.side === "home" ? game.homeTeam : game.awayTeam;
    button.dataset.teamId = team.id;
    if (String(pickDoc?.picks?.cole) === String(team.id)) button.classList.add("cole-selected");
    if (String(pickDoc?.picks?.jamie) === String(team.id)) button.classList.add("jamie-selected");
    button.disabled = locked;
    button.title = locked ? "Picks are locked after tipoff." : `Pick ${team.fullName}`;
    button.addEventListener("click", () => savePick(game, picker.value, team.id));
  });

  const clear = node.querySelector(".clear-picks");
  clear.disabled = locked;
  clear.addEventListener("click", () => clearPicks(game.gameId));

  node.querySelector(".recap-summary").textContent = game.recapSeed.summary;
  node.querySelector(".odds-note").textContent = `${game.recapSeed.oddsNote} Book: ${game.odds.bookmaker}.`;
  const injuryLink = node.querySelector(".injury-link");
  injuryLink.href = game.injuryReportUrl;

  let footnote = `Game ID: ${game.gameId}. Home team ID: ${game.homeTeam.id}. Away team ID: ${game.awayTeam.id}.`;
  if (locked && !game.isFinal) footnote += " Picks are locked.";
  if (game.isFinal) footnote += ` Final: ${game.awayTeam.triCode} ${game.awayTeam.score}, ${game.homeTeam.triCode} ${game.homeTeam.score}.`;
  node.querySelector(".game-footnote").textContent = footnote;

  return node;
}

async function savePick(game, person, teamId) {
  if (isLocked(game)) return alert("Picks are locked at scheduled tipoff.");
  const previous = state.picks.get(game.gameId) || {};
  const picks = { ...(previous.picks || {}), [person]: teamId };
  await setDoc(doc(db, "picks", game.gameId), {
    gameId: game.gameId,
    matchup: `${game.awayTeam.fullName} at ${game.homeTeam.fullName}`,
    gameTimeUTC: game.gameTimeUTC,
    round: game.round,
    teams: { home: game.homeTeam, away: game.awayTeam },
    picks,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function clearPicks(gameId) {
  await deleteDoc(doc(db, "picks", gameId));
}

function renderLedger() {
  if (!state.ledger.length) {
    els.ledgerList.innerHTML = `<div class="empty-card">No settled bets yet. Jamie starts at +$11 and Cole starts at -$11.</div>`;
    return;
  }

  els.ledgerList.innerHTML = state.ledger.map(event => `
    <article class="ledger-event">
      <div>
        <strong>${escapeHtml(event.matchup || event.gameId)}</strong>
        <p>${escapeHtml(event.finalScore || "Final score pending")}</p>
      </div>
      <div class="ledger-event-right">
        <span>${escapeHtml(event.summary || "Settled")}</span>
        <strong>${event.winner === "cole" ? "Cole" : "Jamie"}</strong>
      </div>
    </article>
  `).join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
