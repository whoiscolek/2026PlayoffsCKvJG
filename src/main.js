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
  // Wire all buttons first so a Firebase/API failure does not leave the page dead.
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
  els.manualGradeBtn.addEventListener("click", async () => {
    const ok = await requireLogin("admin");
    if (!ok) return;
    const gameId = els.manualGameId.value.trim();
    const winnerTeamId = els.manualWinnerId.value.trim();
    const game = state.games.find(g => g.gameId === gameId);
    if (!game || !winnerTeamId) return alert("Need a valid game ID and winner team ID.");
    const manualGame = { ...game, isFinal: true, winnerTeamId };
    await maybeGradeAndSave(manualGame);
    alert("Manual settlement attempted. Check ledger.");
  });

  els.roundSaveBtn.addEventListener("click", async () => {
    const ok = await requireLogin("admin");
    if (!ok) return;
    const gameId = els.roundGameId.value.trim();
    const key = els.roundKey.value;
    const round = { key, label: ROUND_VALUES[key].label, value: ROUND_VALUES[key].value };
    await setDoc(doc(db, "roundOverrides", gameId), { gameId, round, updatedAt: serverTimestamp() }, { merge: true });
    alert("Round override saved.");
  });
}

function wireAuth() {
  els.loginColeBtn.addEventListener("click", () => requireLogin("cole"));
  els.loginJamieBtn.addEventListener("click", () => requireLogin("jamie"));
  els.loginAdminBtn.addEventListener("click", () => requireLogin("admin"));
  els.logoutBtn.addEventListener("click", logoutAll);
  els.changePasswordBtn.addEventListener("click", changePassword);
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
  if (snap.exists()) state.access = snap.data();
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
  if (!newPassword || newPassword.length < 4) return alert("New password must be at least 4 characters.");

  const loggedIn = await requireLogin(role);
  if (!loggedIn) return;

  await refreshAccessDoc();
  const currentHash = await hashPassword(role, currentPassword);
  const expected = state.access?.[`${role}Hash`];
  if (currentHash !== expected) return alert("Current password is incorrect.");

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
  els.authStatus.textContent = active.length ? `Signed in as: ${active.join(", ")}` : "No one is signed in. Picks require the matching password.";
  els.adminOnlyControls.forEach(item => {
    item.classList.toggle("locked-control", !state.auth.admin);
  });
}

async function hashPassword(role, password) {
  const data = new TextEncoder().encode(`jamie-cole-nba-bets::${role}::${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
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
  node.querySelector(".bet-status").textContent = ledgerEvent
    ? `${ledgerEvent.summary} · ${ledgerEvent.finalScore}`
    : betState.label;

  const picker = node.querySelector(".picker-person");

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
    button.addEventListener("click", () => savePick(game, picker.value, team.id));
  });

  const clear = node.querySelector(".clear-picks");
  clear.disabled = locked;
  clear.textContent = state.auth.admin ? "Clear picks" : "Clear picks (admin)";
  clear.addEventListener("click", () => clearPicks(game.gameId));

  node.querySelector(".recap-summary").textContent = game.recapSeed.summary;
  node.querySelector(".odds-note").textContent = `${game.recapSeed.oddsNote} Book: ${game.odds.bookmaker}.`;

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

async function savePick(game, person, teamId) {
  if (isLocked(game)) return alert("Picks are locked at scheduled tipoff.");
  const ok = await requireLogin(person);
  if (!ok) return;
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
  const ok = await requireLogin("admin");
  if (!ok) return;
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
