import { db, collection, doc, getDoc, getDocs, setDoc, deleteDoc, onSnapshot, serverTimestamp, query, orderBy } from "./firebase.js";
import { loadTodayGames } from "./api.js";
import { formatMoney, formatGameTime, isLocked, ROUND_VALUES } from "./config.js";
import { getPickTeamLabel, getBetState, gradeGame, calculateBalances } from "./bettingLogic.js";

const state = {
  games: [],
  picks: new Map(),
  ledger: [],
  roundOverrides: new Map(),
  selectedTab: "games",
  access: null,
  auth: {
    cole: localStorage.getItem("jcnb_role_cole") === "true",
    jamie: localStorage.getItem("jcnb_role_jamie") === "true",
    admin: localStorage.getItem("jcnb_role_admin") === "true"
  }
};

const DEFAULT_PASSWORDS = {
  cole: "cole",
  jamie: "jamie",
  admin: "admin"
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
  overrideGameId: document.querySelector("#override-game-id"),
  overrideColeTeamId: document.querySelector("#override-cole-team-id"),
  overrideJamieTeamId: document.querySelector("#override-jamie-team-id"),
  overridePicksBtn: document.querySelector("#override-picks-btn"),
  roundKey: document.querySelector("#round-key"),
  roundSaveBtn: document.querySelector("#round-save-btn"),
  authStatus: document.querySelector("#auth-status"),
  loginColeBtn: document.querySelector("#login-cole-btn"),
  loginJamieBtn: document.querySelector("#login-jamie-btn"),
  loginAdminBtn: document.querySelector("#login-admin-btn"),
  logoutBtn: document.querySelector("#logout-btn"),
  passwordRole: document.querySelector("#password-role"),
  currentPassword: document.querySelector("#current-password"),
  newPassword: document.querySelector("#new-password"),
  changePasswordBtn: document.querySelector("#change-password-btn"),
  adminOnlyControls: document.querySelectorAll(".admin-only-control")
};

init().catch(error => {
  console.error("App failed to initialize:", error);
  if (els.authStatus) {
    els.authStatus.textContent = "App error — open Console for details.";
  }
});

async function init() {
  wireTabs();
  wireAdmin();
  wireAuth();

  if (els.refreshBtn) {
    els.refreshBtn.addEventListener("click", refreshAll);
  }

  renderAuth();

  try {
    subscribeToPicks();
    subscribeToLedger();
    subscribeToRoundOverrides();
  } catch (error) {
    console.error("Firestore listener setup failed:", error);
  }

  try {
    await ensureAccessDoc();
    renderAuth();
  } catch (error) {
    console.error("Access/password setup failed:", error);
    if (els.authStatus) {
      els.authStatus.textContent = "Login setup failed — check Firestore rules.";
    }
  }

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
  if (els.manualGradeBtn) {
    els.manualGradeBtn.addEventListener("click", async () => {
      const ok = await requireLogin("admin");
      if (!ok) return;

      const gameId = els.manualGameId?.value.trim();
      const winnerTeamId = els.manualWinnerId?.value.trim();
      const game = state.games.find(g => g.gameId === gameId);

      if (!game || !winnerTeamId) {
        return alert("Need a valid game ID and winner team ID.");
      }

      const manualGame = { ...game, isFinal: true, winnerTeamId };
      await maybeGradeAndSave(manualGame);
      alert("Manual settlement attempted. Check ledger.");
    });
  }

  if (els.roundSaveBtn) {
    els.roundSaveBtn.addEventListener("click", async () => {
      const ok = await requireLogin("admin");
      if (!ok) return;

      const gameId = els.roundGameId?.value.trim();
      const key = els.roundKey?.value;

      if (!gameId || !key) {
        return alert("Need a valid game ID and round.");
      }

      const round = {
        key,
        label: ROUND_VALUES[key].label,
        value: ROUND_VALUES[key].value
      };

      await setDoc(doc(db, "roundOverrides", gameId), {
        gameId,
        round,
        updatedAt: serverTimestamp()
      }, { merge: true });

      alert("Round override saved.");
    });
  }

  if (els.overridePicksBtn) {
    els.overridePicksBtn.addEventListener("click", overridePicks);
  }
}

function wireAuth() {
  if (els.loginColeBtn) {
    els.loginColeBtn.addEventListener("click", () => requireLogin("cole"));
  }

  if (els.loginJamieBtn) {
    els.loginJamieBtn.addEventListener("click", () => requireLogin("jamie"));
  }

  if (els.loginAdminBtn) {
    els.loginAdminBtn.addEventListener("click", () => requireLogin("admin"));
  }

  if (els.logoutBtn) {
    els.logoutBtn.addEventListener("click", logoutAll);
  }

  if (els.changePasswordBtn) {
    els.changePasswordBtn.addEventListener("click", changePassword);
  }
}

async function ensureAccessDoc() {
  const ref = doc(db, "settings", "access");
  const snap = await getDoc(ref);

  if (snap.exists()) {
    state.access = snap.data();
    return;
  }

  const defaults = {
    coleHash: await hashPassword("cole", DEFAULT_PASSWORDS.cole),
    jamieHash: await hashPassword("jamie", DEFAULT_PASSWORDS.jamie),
    adminHash: await hashPassword("admin", DEFAULT_PASSWORDS.admin),
    initializedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await setDoc(ref, defaults);
  state.access = defaults;
}

async function refreshAccessDoc() {
  const snap = await getDoc(doc(db, "settings", "access"));
  if (snap.exists()) {
    state.access = snap.data();
  }
}

async function requireLogin(role) {
  if (state.auth[role]) return true;

  const label = roleLabel(role);
  const password = window.prompt(`Enter ${label} password:`);

  if (!password) return false;

  try {
    await refreshAccessDoc();
  } catch (error) {
    console.error("Could not refresh password settings:", error);
  }

  const supplied = await hashPassword(role, password);
  const expected = state.access?.[`${role}Hash`] || await hashPassword(role, DEFAULT_PASSWORDS[role]);

  if (supplied !== expected) {
    alert(`Wrong ${label} password.`);
    return false;
  }

  state.auth[role] = true;
  localStorage.setItem(`jcnb_role_${role}`, "true");

  renderAuth();
  render();

  return true;
}

async function changePassword() {
  const role = els.passwordRole.value;
  const currentPassword = els.currentPassword.value;
  const newPassword = els.newPassword.value;

  if (!newPassword || newPassword.length < 4) {
    return alert("New password must be at least 4 characters.");
  }

  const loggedIn = await requireLogin(role);
  if (!loggedIn) return;

  await refreshAccessDoc();

  const currentHash = await hashPassword(role, currentPassword);
  const expected = state.access?.[`${role}Hash`];

  if (currentHash !== expected) {
    return alert("Current password is incorrect.");
  }

  const updates = {
    [`${role}Hash`]: await hashPassword(role, newPassword),
    updatedAt: serverTimestamp()
  };

  await setDoc(doc(db, "settings", "access"), updates, { merge: true });
  await refreshAccessDoc();

  els.currentPassword.value = "";
  els.newPassword.value = "";

  alert(`${roleLabel(role)} password changed.`);
}

function logoutAll() {
  ["cole", "jamie", "admin"].forEach(role => {
    state.auth[role] = false;
    localStorage.removeItem(`jcnb_role_${role}`);
  });

  renderAuth();
  render();
}

function renderAuth() {
  const active = ["cole", "jamie", "admin"].filter(role => state.auth[role]).map(roleLabel);

  els.authStatus.textContent = active.length
    ? `Signed in as: ${active.join(", ")}`
    : "No one is signed in. Picks require the matching password.";

  els.adminOnlyControls.forEach(item => {
    item.classList.toggle("locked-control", !state.auth.admin);
  });
}

async function hashPassword(role, password) {
  const data = new TextEncoder().encode(`jamie-cole-nba-bets::${role}::${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function roleLabel(role) {
  if (role === "cole") return "Cole";
  if (role === "jamie") return "Jamie";
  return "Admin";
}

function subscribeToPicks() {
  onSnapshot(collection(db, "picks"), snapshot => {
    state.picks.clear();
    snapshot.forEach(item => state.picks.set(item.id, item.data()));
    render();
  }, error => {
    console.error("Picks listener failed:", error);
  });
}

function subscribeToLedger() {
  onSnapshot(query(collection(db, "ledger"), orderBy("createdAt", "desc")), snapshot => {
    state.ledger = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    renderLedger();
    renderBalances();
  }, error => {
    console.error("Ledger listener failed:", error);
  });
}

function subscribeToRoundOverrides() {
  onSnapshot(collection(db, "roundOverrides"), snapshot => {
    state.roundOverrides.clear();
    snapshot.forEach(item => state.roundOverrides.set(item.id, item.data().round));
    applyRoundOverrides();
    render();
  }, error => {
    console.error("Round override listener failed:", error);
  });
}

async function refreshAll() {
  els.refreshBtn.disabled = true;
  els.refreshBtn.textContent = "Refreshing...";

  try {
    const data = await loadTodayGames();
    state.games = data.games || [];
    applyRoundOverrides();

    await archiveLoadedGames(state.games);

    els.lastUpdated.textContent = `Updated ${new Date(data.generatedAt).toLocaleTimeString("en-US", {
      timeZone: "America/Chicago"
    })} CT · ${data.source}`;

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

async function archiveLoadedGames(games) {
  for (const game of games || []) {
    if (!game?.gameId) continue;

    try {
      await setDoc(doc(db, "gameArchive", game.gameId), {
        ...game,
        archivedAt: serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.error(`Could not archive game ${game.gameId}:`, error);
    }
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
    if (game.isFinal) {
      await maybeGradeAndSave(game);
    }
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

  const scoreText = getScoreText(game);
  node.querySelector(".game-meta").textContent = `${formatGameTime(game.gameTimeUTC)} CT · ${game.statusText} · ${game.seriesText} · ${scoreText}`;

  node.querySelector(".value-badge").textContent = `$${game.round.value}`;

  node.querySelector(".away-code").textContent = game.awayTeam.triCode;
  node.querySelector(".away-name").textContent = game.awayTeam.fullName;
  node.querySelector(".away-odds").textContent = game.odds.awayOdds;

  node.querySelector(".home-code").textContent = game.homeTeam.triCode;
  node.querySelector(".home-name").textContent = game.homeTeam.fullName;
  node.querySelector(".home-odds").textContent = game.odds.homeOdds;

  node.querySelector(".cole-pick").textContent = getPickTeamLabel(game, pickDoc?.picks?.cole);
  node.querySelector(".jamie-pick").textContent = getPickTeamLabel(game, pickDoc?.picks?.jamie);

  node.querySelector(".bet-status").textContent = ledgerEvent
    ? `${ledgerEvent.summary} · ${ledgerEvent.finalScore}`
    : betState.label;

  node.querySelectorAll(".team-pick").forEach(button => {
    const team = button.dataset.side === "home" ? game.homeTeam : game.awayTeam;

    button.dataset.teamId = team.id;

    if (String(pickDoc?.picks?.cole) === String(team.id)) {
      button.classList.add("cole-selected");
    }

    if (String(pickDoc?.picks?.jamie) === String(team.id)) {
      button.classList.add("jamie-selected");
    }

    button.disabled = locked;
    button.title = locked ? "Picks are locked after tipoff." : `Pick ${team.fullName}`;

    button.addEventListener("click", () => {
      const person = getActivePickerRole();
      if (!person) return;
      savePick(game, person, team.id);
    });
  });

  const clear = node.querySelector(".clear-picks");
  clear.disabled = locked;
  clear.textContent = state.auth.admin ? "Clear picks" : "Clear picks (admin)";
  clear.addEventListener("click", () => clearPicks(game.gameId));

  const matchupIntel = getMatchupIntel(game, pickDoc, ledgerEvent);

  node.querySelector(".intel-title").textContent = matchupIntel.title;
  node.querySelector(".recap-summary").textContent = matchupIntel.summary;
  node.querySelector(".odds-note").textContent = matchupIntel.note;

  const injuryLink = node.querySelector(".injury-link");
  injuryLink.href = game.injuryReportUrl;

  let footnote = `Admin IDs — Game ID: ${game.gameId} · Away: ${game.awayTeam.fullName} = ${game.awayTeam.id} · Home: ${game.homeTeam.fullName} = ${game.homeTeam.id}`;

  if (locked && !game.isFinal) {
    footnote += " · Picks are locked.";
  }

  if (game.isFinal) {
    footnote += ` · Final: ${game.awayTeam.triCode} ${game.awayTeam.score}, ${game.homeTeam.triCode} ${game.homeTeam.score}.`;
  }

  node.querySelector(".game-footnote").textContent = footnote;

  return node;
}

function getScoreText(game) {
  const awayScore = Number(game.awayTeam?.score || 0);
  const homeScore = Number(game.homeTeam?.score || 0);

  if (game.status === 1 && awayScore === 0 && homeScore === 0) {
    return "Pregame";
  }

  if (game.status === 2) {
    const periodText = game.period ? `Q${game.period}` : "Live";
    const clockText = game.clock ? ` · ${game.clock}` : "";
    return `${game.awayTeam.triCode} ${awayScore}, ${game.homeTeam.triCode} ${homeScore} · ${periodText}${clockText}`;
  }

  if (game.status === 3 || game.isFinal) {
    return `Final: ${game.awayTeam.triCode} ${awayScore}, ${game.homeTeam.triCode} ${homeScore}`;
  }

  return `${game.awayTeam.triCode} ${awayScore}, ${game.homeTeam.triCode} ${homeScore}`;
}

function getMatchupIntel(game, pickDoc, ledgerEvent) {
  const awayScore = Number(game.awayTeam?.score || 0);
  const homeScore = Number(game.homeTeam?.score || 0);
  const awayOdds = game.odds?.awayOdds || "N/A";
  const homeOdds = game.odds?.homeOdds || "N/A";
  const book = game.odds?.bookmaker || "odds source";
  const value = game.round?.value || 0;

  const colePick = getPickTeamLabel(game, pickDoc?.picks?.cole);
  const jamiePick = getPickTeamLabel(game, pickDoc?.picks?.jamie);

  const favoriteText = getFavoriteText(game);
  const pickText = `Current picks: Cole — ${colePick}; Jamie — ${jamiePick}.`;

  if (game.status === 1 && !game.isFinal) {
    return {
      title: "Lead-up Intel",
      summary: `${game.awayTeam.fullName} visit ${game.homeTeam.fullName} in the ${game.round.label}. ${game.seriesText}. This is a $${value} game if Cole and Jamie land on opposite sides. ${favoriteText}`,
      note: `Pregame moneyline via ${book}: ${game.awayTeam.triCode} ${awayOdds}, ${game.homeTeam.triCode} ${homeOdds}. ${pickText} Check the official NBA injury report before tipoff for late availability changes.`
    };
  }

  if (game.status === 2) {
    const periodText = game.period ? `Q${game.period}` : "Live";
    const clockText = game.clock ? ` with ${game.clock} remaining` : "";
    const leader = getCurrentLeaderText(game);

    return {
      title: "Live Intel",
      summary: `${game.awayTeam.triCode} ${awayScore}, ${game.homeTeam.triCode} ${homeScore} — ${periodText}${clockText}. ${leader} Picks are locked because the game has tipped off.`,
      note: `Pregame moneyline was ${game.awayTeam.triCode} ${awayOdds}, ${game.homeTeam.triCode} ${homeOdds} via ${book}. ${pickText} This game is worth $${value}.`
    };
  }

  if (game.status === 3 || game.isFinal) {
    const winner = String(game.winnerTeamId) === String(game.awayTeam.id)
      ? game.awayTeam.fullName
      : String(game.winnerTeamId) === String(game.homeTeam.id)
        ? game.homeTeam.fullName
        : "Winner pending";

    const resultText = ledgerEvent
      ? `Bet result: ${ledgerEvent.summary}.`
      : "Bet result has not been posted to the ledger yet.";

    return {
      title: "Final Intel",
      summary: `Final: ${game.awayTeam.triCode} ${awayScore}, ${game.homeTeam.triCode} ${homeScore}. ${winner} won the game. ${resultText}`,
      note: `This was a $${value} ${game.round.label} game. ${pickText}`
    };
  }

  return {
    title: "Matchup Intel",
    summary: `${game.awayTeam.fullName} at ${game.homeTeam.fullName}. ${game.seriesText}.`,
    note: `Moneyline via ${book}: ${game.awayTeam.triCode} ${awayOdds}, ${game.homeTeam.triCode} ${homeOdds}. ${pickText}`
  };
}

function getFavoriteText(game) {
  const awayOdds = Number(game.odds?.awayOdds);
  const homeOdds = Number(game.odds?.homeOdds);

  if (!Number.isFinite(awayOdds) || !Number.isFinite(homeOdds)) {
    return "The current favorite is not available from the odds feed.";
  }

  if (awayOdds < homeOdds) {
    return `${game.awayTeam.fullName} enter as the betting favorite at ${game.odds.awayOdds}, while ${game.homeTeam.fullName} are listed at ${game.odds.homeOdds}.`;
  }

  if (homeOdds < awayOdds) {
    return `${game.homeTeam.fullName} enter as the betting favorite at ${game.odds.homeOdds}, while ${game.awayTeam.fullName} are listed at ${game.odds.awayOdds}.`;
  }

  return "The moneyline is currently even between both teams.";
}

function getCurrentLeaderText(game) {
  const awayScore = Number(game.awayTeam?.score || 0);
  const homeScore = Number(game.homeTeam?.score || 0);

  if (awayScore > homeScore) {
    return `${game.awayTeam.fullName} are currently leading.`;
  }

  if (homeScore > awayScore) {
    return `${game.homeTeam.fullName} are currently leading.`;
  }

  return "The game is currently tied.";
}

function getActivePickerRole() {
  const activePickers = ["cole", "jamie"].filter(role => state.auth[role]);

  if (activePickers.length === 1) {
    return activePickers[0];
  }

  if (activePickers.length === 0) {
    alert("Log in as Cole or Jamie before making a pick.");
    return null;
  }

  alert("Both Cole and Jamie are logged in. Log out, then log in as only the person making this pick.");
  return null;
}

async function savePick(game, person, teamId) {
  if (isLocked(game)) {
    return alert("Picks are locked at scheduled tipoff.");
  }

  const ok = await requireLogin(person);
  if (!ok) return;

  const previous = state.picks.get(game.gameId) || {};
  const picks = { ...(previous.picks || {}), [person]: teamId };

  await setDoc(doc(db, "picks", game.gameId), {
    gameId: game.gameId,
    matchup: `${game.awayTeam.fullName} at ${game.homeTeam.fullName}`,
    gameTimeUTC: game.gameTimeUTC,
    round: game.round,
    teams: {
      home: game.homeTeam,
      away: game.awayTeam
    },
    picks,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function clearPicks(gameId) {
  const ok = await requireLogin("admin");
  if (!ok) return;

  await deleteDoc(doc(db, "picks", gameId));
}

async function overridePicks() {
  const ok = await requireLogin("admin");
  if (!ok) return;

  const gameId = els.overrideGameId.value.trim();
  const coleTeamId = els.overrideColeTeamId.value.trim();
  const jamieTeamId = els.overrideJamieTeamId.value.trim();

  if (!gameId || !coleTeamId || !jamieTeamId) {
    return alert("Need Game ID, Cole Team ID, and Jamie Team ID.");
  }

  const game = state.games.find(g => g.gameId === gameId);

  if (!game) {
    return alert("That Game ID is not currently loaded on today's dashboard. Use a Game ID from one of the visible game cards.");
  }

  const validTeamIds = [
    String(game.homeTeam.id),
    String(game.awayTeam.id)
  ];

  if (!validTeamIds.includes(String(coleTeamId)) || !validTeamIds.includes(String(jamieTeamId))) {
    return alert("Cole/Jamie Team IDs must match the home or away Team IDs shown on that game card.");
  }

  await setDoc(doc(db, "picks", gameId), {
    gameId,
    matchup: `${game.awayTeam.fullName} at ${game.homeTeam.fullName}`,
    gameTimeUTC: game.gameTimeUTC,
    round: game.round,
    teams: {
      home: game.homeTeam,
      away: game.awayTeam
    },
    picks: {
      cole: coleTeamId,
      jamie: jamieTeamId
    },
    adminOverride: true,
    updatedAt: serverTimestamp()
  }, { merge: true });

  await deleteDoc(doc(db, "ledger", gameId));

  alert("Pick override saved. If the game is final, refresh or manually settle again so the ledger recalculates.");
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
