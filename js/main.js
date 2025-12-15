// main.js
import * as Game from './game.js';
import * as UI from './ui.js';
import { positionOverallWeights } from './game/player.js';
import { relationshipLevels } from './data.js';
import { formatHeight } from './utils.js';

// --- Global State ---
let gameState = null;
let selectedPlayerId = null;
let currentLiveSimResult = null;
let currentSortColumn = 'potential';
let currentSortDirection = 'desc';
let activeSaveKey = 'backyardFootballGameState';

// --- Constants ---
const ROSTER_LIMIT = 10;
const MIN_HEALTHY_PLAYERS = 7;
const WEEKS_IN_SEASON = 9;

function yieldToMain() { return new Promise(resolve => setTimeout(resolve, 0)); }

// =============================================================
// --- CORE HANDLERS ---
// =============================================================

async function startNewGame() {
    try {
        UI.showScreen("loading-screen");
        UI.startLoadingMessages();
        await new Promise(resolve => setTimeout(resolve, 50));

        await Game.initializeLeague(UI.updateLoadingProgress);
        UI.stopLoadingMessages();

        gameState = Game.getGameState();
        if (!gameState) throw new Error("Failed to get game state.");

        UI.renderTeamNameSuggestions(
            ['Jets', 'Sharks', 'Tigers', 'Bulldogs', 'Panthers', 'Giants'],
            handleTeamNameSelection
        );
        UI.showScreen('team-creation-screen');
    } catch (error) {
        console.error("Error starting game:", error);
        UI.stopLoadingMessages();
        UI.showModal("Error", `Could not start game: ${error.message}`, null, '', null, 'Close');
    }
}

function handleTeamNameSelection(name) {
    const customNameInput = document.getElementById('custom-team-name');
    if (customNameInput) customNameInput.value = name;
}

function handleConfirmTeam() {
    const customNameInput = document.getElementById('custom-team-name');
    const customName = customNameInput ? customNameInput.value.trim() : '';

    if (customName) {
        try {
            Game.createPlayerTeam(customName);
            Game.setupDraft();
            gameState = Game.getGameState();

            UI.renderSelectedPlayerCard(null, gameState);
            UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId, currentSortColumn, currentSortDirection);
            UI.showScreen('draft-screen');
            runAIDraftPicks();
        } catch (error) {
            console.error("Error confirming team:", error);
            UI.showModal("Error", `Could not create team: ${error.message}`, null, '', null, 'Close');
        }
    } else {
        UI.showModal("Team Name Required", "<p>Please enter a team name.</p>");
    }
}

function handlePlayerSelectInDraft(playerId) {
    if (!gameState) return;
    selectedPlayerId = playerId;
    const player = gameState.players.find(p => p.id === playerId);
    UI.updateSelectedPlayerRow(playerId);
    UI.renderSelectedPlayerCard(player, gameState);
}

function handleDraftPlayer() {
    if (!gameState) return;
    if (selectedPlayerId) {
        const player = gameState.players.find(p => p.id === selectedPlayerId);
        const team = gameState.playerTeam;
        if (team.roster.length >= ROSTER_LIMIT) {
            UI.showModal("Roster Full", `<p>Roster full (${ROSTER_LIMIT} players).</p>`);
            return;
        }

        if (player && Game.addPlayerToTeam(player, team)) {
            selectedPlayerId = null;
            gameState.currentPick++;
            UI.renderSelectedPlayerCard(null, gameState);
            runAIDraftPicks();
        } else {
            UI.showModal("Draft Error", "Could not draft player.", null, '', null, 'Close');
        }
    }
}

async function runAIDraftPicks() {
    if (!gameState) return;

    const checkDraftEnd = () => {
        const pickLimitReached = gameState.currentPick >= gameState.draftOrder.length;
        const noPlayersLeft = gameState.players.filter(p => p && !p.teamId).length === 0;
        const allTeamsFull = gameState.teams.every(t => !t || !t.roster || t.roster.length >= ROSTER_LIMIT);
        return pickLimitReached || noPlayersLeft || allTeamsFull;
    };

    let safetyCounter = 0;
    const MAX_PICKS_WITHOUT_PROGRESS = 50;

    const advancePick = () => {
        gameState.currentPick = (gameState.currentPick || 0) + 1;
        if (gameState.draftOrder && gameState.currentPick > gameState.draftOrder.length) gameState.currentPick = gameState.draftOrder.length;
    };

    if (checkDraftEnd()) {
        handleDraftEnd();
        return;
    }

    let currentPickingTeam = gameState.draftOrder[gameState.currentPick];

    while (currentPickingTeam && currentPickingTeam.id !== gameState.playerTeam.id) {
        if (safetyCounter++ > MAX_PICKS_WITHOUT_PROGRESS) {
            handleDraftEnd();
            return;
        }

        if (!currentPickingTeam || !currentPickingTeam.roster || currentPickingTeam.roster.length >= ROSTER_LIMIT) {
            advancePick();
            currentPickingTeam = gameState.draftOrder[gameState.currentPick];
            continue;
        }

        UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId, currentSortColumn, currentSortDirection);
        await new Promise(resolve => setTimeout(resolve, 50));

        const result = Game.simulateAIPick(currentPickingTeam);
        if (result) safetyCounter = 0;
        advancePick();

        if (checkDraftEnd()) {
            handleDraftEnd();
            return;
        }
        currentPickingTeam = gameState.draftOrder[gameState.currentPick];
    }

    if (!checkDraftEnd()) {
        if (gameState.playerTeam.roster.length >= ROSTER_LIMIT) {
            advancePick();
            if (checkDraftEnd()) {
                handleDraftEnd();
            } else {
                runAIDraftPicks();
            }
        } else {
            UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId, currentSortColumn, currentSortDirection);
        }
    } else {
        handleDraftEnd();
    }
}

async function handleDraftEnd() {
    if (!gameState) return;

    let _draftFinalized = false;
    const finalizeDraft = async () => {
        if (_draftFinalized) return;
        _draftFinalized = true;
        try {
            Game.generateSchedule();
            gameState = Game.getGameState();
            UI.renderDashboard(gameState);
            UI.switchTab('my-team', gameState);
            UI.showScreen('dashboard-screen');
            try { UI.hideModal(); } catch (e) { }
        } catch (error) {
            UI.showModal("Error", `Could not proceed: ${error.message}`, null, '', null, 'Close');
        }
    };

    UI.showModal("Draft Complete!", "<p>Finalizing rosters... Please wait.</p>", finalizeDraft, "Start Season");

    const modalConfirmBtn = document.querySelector('#modal-actions button.bg-amber-500');
    if (modalConfirmBtn) {
        modalConfirmBtn.disabled = true;
        modalConfirmBtn.textContent = "Loading...";
    }

    await yieldToMain();

    console.log("Setting depth charts...");
    for (const team of gameState.teams) {
        if (!team) continue;
        try { Game.aiSetDepthChart(team); } catch (error) { console.error(error); }
    }

    const modalBody = document.getElementById('modal-body');
    if (modalBody) modalBody.innerHTML = "<p>Draft complete. Get ready for the season!</p>";
    if (modalConfirmBtn) {
        modalConfirmBtn.disabled = false;
        modalConfirmBtn.textContent = "Start Season";
    }

    try { await yieldToMain(); finalizeDraft(); } catch (e) { }
}

// --- LOADING & SAVING ---

async function handleLoadGame(saveKey) {
    try {
        const keyToLoad = saveKey || 'backyardFootballGameState';
        const loadedState = Game.loadGameState(keyToLoad);

        if (!loadedState || !loadedState.teams) {
            UI.showModal("Load Failed", "<p>No saved game data found.</p>");
            return;
        }

        gameState = loadedState;
        selectedPlayerId = null;
        activeSaveKey = keyToLoad;

        // 💡 NEW: Force the Depth Chart to rebuild from the saved Order immediately.
        // This fixes the "Ghost Players" issue on load.
        if (gameState.playerTeam) {
            Game.rebuildDepthChartFromOrder(gameState.playerTeam);
        }

        if (gameState.currentWeek >= 0) {
            UI.renderDashboard(gameState);
            UI.switchTab('my-team', gameState);
            UI.showScreen('dashboard-screen');
        } else {
            UI.renderSelectedPlayerCard(null, gameState);
            UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId, currentSortColumn, currentSortDirection);
            UI.showScreen('draft-screen');
        }
    } catch (error) {
        console.error("Load Error:", error);
        UI.showModal("Error", `Could not load game: ${error.message}`, null, '', null, 'Close');
    }
}

async function handleLoadTestRoster() { await handleLoadGame('my_test_roster'); }

function handleSaveTestRoster() {
    if (!gameState) return;
    Game.saveGameState('my_test_roster');
    activeSaveKey = 'my_test_roster';
    UI.showModal("Saved", "<p>Game saved as 'Test Roster'.</p>");
}

// --- DASHBOARD INTERACTION ---

function handleTabSwitch(e) {
    // Use closest() to handle clicks on child elements (icons, spans, text)
    const button = e.target.closest('.tab-button');

    if (button) {
        const tabId = button.dataset.tab;

        // 1. Update visual active state immediately (Optional, improves perceived speed)
        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.classList.remove('active');
            btn.setAttribute('aria-selected', 'false');
        });
        button.classList.add('active');
        button.setAttribute('aria-selected', 'true');

        // 2. Refresh data and render
        gameState = Game.getGameState();
        if (gameState) {
            UI.switchTab(tabId, gameState);
        }
    }
}
function handleFormationChange(e) {
    if (!gameState) return;
    const side = e.target.id.includes('offense') ? 'offense' : 'defense';
    const formationName = e.target.value;

    // 1. Update Game Logic (This now auto-triggers rebuildDepthChartFromOrder)
    Game.changeFormation(side, formationName);

    // 2. Save
    Game.saveGameState(activeSaveKey);

    // 3. Refresh UI to show the new slots
    // We use the event dispatcher so UI.js knows to re-render the visual field
    document.dispatchEvent(new CustomEvent('refresh-ui'));
}

function handleDepthChartDrop(playerId, newPositionSlot, side) {
    if (!gameState) return;

    // 1. Update the specific slot in Game Logic
    Game.updateDepthChart(playerId, newPositionSlot, side);

    // 2. Refresh local state reference
    gameState = Game.getGameState();

    // 3. Save immediately
    Game.saveGameState(activeSaveKey);

    // 4. Force UI Refresh
    // We trigger the event instead of calling switchTab manually, 
    // which ensures all parts of the UI (lists + field) stay in sync.
    document.dispatchEvent(new CustomEvent('refresh-ui'));
}

function handleDepthChartSelect(e) {
    if (!e.target.matches('.slot-select')) return;
    const selectEl = e.target;
    const playerId = selectEl.value === 'null' ? null : selectEl.value;
    const newPositionSlot = selectEl.dataset.slot;
    const side = selectEl.dataset.side;
    if (newPositionSlot && side && gameState) {
        handleDepthChartDrop(playerId, newPositionSlot, side);
        // Force a UI refresh event so the visual field updates immediately
        document.dispatchEvent(new CustomEvent('refresh-ui'));
    }
}


// 💡 REMOVED: handleFormationChange
// Reason: UI.js now handles the "Revert to Default" fix logic internally 
// via setupFormationListeners to prevent race conditions.

// --- SIMULATION & WEEK ADVANCE ---

async function handleAdvanceWeek() {
    if (!gameState) return;

    const rosterObjects = Game.getRosterObjects(gameState.playerTeam);
    const healthyCount = rosterObjects.filter(p => p && p.status?.duration === 0).length;

    if (healthyCount < MIN_HEALTHY_PLAYERS) {
        const hasFreeAgents = gameState.freeAgents && gameState.freeAgents.length > 0;
        if (hasFreeAgents) {
            console.log("Roster check failed: Prompting Call Friend.");
            promptCallFriend(proceedWithAdvanceWeek);
            return;
        } else {
            UI.showModal("Warning: Short Roster",
                `<p>You only have ${healthyCount} healthy players. You need ${MIN_HEALTHY_PLAYERS} to avoid forfeiting.</p><p>No friends are available to call.</p>`,
                () => proceedWithAdvanceWeek(), "Proceed Anyway"
            );
            return;
        }
    }
    proceedWithAdvanceWeek();
}

function proceedWithAdvanceWeek() {
    if (!gameState) return;

    if (gameState.currentWeek >= WEEKS_IN_SEASON) {
        handleSeasonEnd();
        return;
    }

    if (gameState.currentWeek === 0 && (!gameState.schedule || gameState.schedule.length === 0)) {
        Game.generateSchedule();
        gameState = Game.getGameState();
    }

    const gamesPerWeek = gameState.teams.length / 2;
    const weekStartIndex = gameState.currentWeek * gamesPerWeek;
    const weekEndIndex = weekStartIndex + gamesPerWeek;
    const playerGameMatch = gameState.schedule.slice(weekStartIndex, weekEndIndex)
        .find(g => g && g.home && g.away && (g.home.id === gameState.playerTeam.id || g.away.id === gameState.playerTeam.id));

    if (playerGameMatch) {
        UI.showModal("Game Day!",
            `<p>Week ${gameState.currentWeek + 1} vs <strong>${playerGameMatch.home.id === gameState.playerTeam.id ? playerGameMatch.away.name : playerGameMatch.home.name}</strong>.</p>`,
            () => startLiveGame(playerGameMatch), "Watch Game",
            () => simulateRestOfWeek(), "Sim Week"
        );
    } else {
        simulateRestOfWeek();
    }
}

function startLiveGame(playerGameMatch) {
    if (!gameState) return;
    currentLiveSimResult = null;
    const gamesPerWeek = gameState.teams.length / 2;
    const allGames = gameState.schedule.slice(gameState.currentWeek * gamesPerWeek, (gameState.currentWeek + 1) * gamesPerWeek);
    let allResults = [];

    allGames.forEach(match => {
        try {
            if (!match || !match.home || !match.away) return;
            const isPlayerGame = match.home.id === playerGameMatch.home.id && match.away.id === playerGameMatch.away.id;
            const result = Game.simulateGame(match.home, match.away, { fastSim: !isPlayerGame });
            if (!result) return;

            allResults.push(result);

            if (result.breakthroughs && Array.isArray(result.breakthroughs)) {
                result.breakthroughs.forEach(b => {
                    if (b && b.player && b.player.teamId === gameState.playerTeam?.id) {
                        if (typeof Game.addMessage === 'function') {
                            Game.addMessage("Player Breakthrough!", `${b.player.name} improved ${b.attr}!`);
                        }
                    }
                });
            }
            if (isPlayerGame) currentLiveSimResult = result;
        } catch (error) {
            console.error(`Sim error:`, error);
        }
    });

    if (!gameState.gameResults) gameState.gameResults = [];
    const minimalResults = allResults.filter(Boolean).map(r => ({
        homeTeam: { id: r.homeTeam.id, name: r.homeTeam.name },
        awayTeam: { id: r.awayTeam.id, name: r.awayTeam.name },
        homeScore: r.homeScore,
        awayScore: r.awayScore
    }));
    gameState.gameResults.push(...minimalResults);

    gameState.currentWeek++;

    if (currentLiveSimResult) {
        UI.showScreen('game-sim-screen');
        UI.startLiveGameSim(currentLiveSimResult, () => {
            finishWeekSimulation(allResults.filter(Boolean));
            currentLiveSimResult = null;
        });
    } else {
        finishWeekSimulation(allResults.filter(Boolean));
    }
}

function simulateRestOfWeek() {
    let results = null;
    try {
        if (!gameState || gameState.currentWeek >= WEEKS_IN_SEASON) {
            if (gameState) handleSeasonEnd();
            return;
        }
        if (typeof Game.simulateWeek === 'function') {
            results = Game.simulateWeek({ fastSim: true });
        }
    } catch (error) {
        console.error("Sim week error:", error);
        if (gameState) gameState.currentWeek++;
        results = [];
    }

    if (results !== null) {
        finishWeekSimulation(results);
    } else if (gameState && gameState.currentWeek >= WEEKS_IN_SEASON) {
        handleSeasonEnd();
    } else {
        gameState = Game.getGameState();
        if (gameState) {
            UI.renderDashboard(gameState);
            UI.showScreen('dashboard-screen');
        }
    }
}

function finishWeekSimulation(results) {
    if (!gameState) {
        gameState = Game.getGameState();
        if (gameState) { UI.renderDashboard(gameState); UI.showScreen('dashboard-screen'); }
        return;
    }

    const buildResultsModalHtml = (results) => {
        if (!gameState?.playerTeam || !Array.isArray(results)) return "<p>Error.</p>";
        const playerGame = results.find(r => r && (r.homeTeam?.id === gameState.playerTeam.id || r.awayTeam?.id === gameState.playerTeam.id));

        let resultText = 'BYE';
        if (playerGame) {
            const myScore = playerGame.homeTeam.id === gameState.playerTeam.id ? playerGame.homeScore : playerGame.awayScore;
            const oppScore = playerGame.homeTeam.id === gameState.playerTeam.id ? playerGame.awayScore : playerGame.homeScore;
            if (myScore > oppScore) resultText = "WON";
            else if (myScore < oppScore) resultText = "LOST";
            else resultText = "TIED";
        }

        let html = `<h4>Your Result: ${resultText}</h4>`;
        if (playerGame) {
            html += `<p>${playerGame.awayTeam.name} ${playerGame.awayScore} @ ${playerGame.homeTeam.name} ${playerGame.homeScore}</p>`;
        }
        html += '<h4 class="mt-4">All Results</h4><div class="space-y-1 text-sm mt-2">';
        results.forEach(r => {
            if (!r) return;
            const isPlayerGame = r.homeTeam.id === gameState.playerTeam.id || r.awayTeam.id === gameState.playerTeam.id;
            html += `<p class="${isPlayerGame ? 'font-bold text-amber-600' : ''}">${r.awayTeam.name} ${r.awayScore} @ ${r.homeTeam.name} ${r.homeScore}</p>`;
        });
        html += '</div>';
        return html;
    };

    if (results && results.length > 0) {
        UI.showModal(`Week ${gameState.currentWeek} Results`, buildResultsModalHtml(results));
    }

    gameState.teams.filter(t => t && t.id !== gameState.playerTeam.id).forEach(team => {
        try { Game.aiManageRoster(team); } catch (e) { }
    });
    Game.generateWeeklyFreeAgents();

    gameState = Game.getGameState();
    if (!gameState) return;

    UI.renderDashboard(gameState);
    const activeTabEl = document.querySelector('#dashboard-tabs .tab-button.active');
    const activeTab = activeTabEl ? activeTabEl.dataset.tab : 'my-team';
    UI.switchTab(activeTab, gameState);
    UI.showScreen('dashboard-screen');

    if (gameState.currentWeek >= WEEKS_IN_SEASON) { handleSeasonEnd(); return; }

    const roster = Game.getRosterObjects(gameState.playerTeam);
    const healthyCount = roster.filter(p => p && p.status?.duration === 0).length;
    if (healthyCount < MIN_HEALTHY_PLAYERS) {
        promptCallFriend();
    }
}

function handleSeasonEnd() {
    try {
        const report = Game.advanceToOffseason();
        gameState = Game.getGameState();
        UI.renderOffseasonScreen(report, gameState.year);
        UI.showScreen('offseason-screen');
    } catch (error) {
        console.error(error);
    }
}

function handleGoToNextDraft() {
    try {
        Game.setupDraft();
        gameState = Game.getGameState();
        selectedPlayerId = null;
        UI.renderSelectedPlayerCard(null, gameState);
        UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId, currentSortColumn, currentSortDirection);
        UI.showScreen('draft-screen');
        runAIDraftPicks();
    } catch (error) {
        console.error(error);
    }
}

function handleDashboardClicks(e) {
    const target = e.target;
    const playerRow = target.closest('#my-team-roster tbody tr[data-player-id]');

    if (playerRow && playerRow.dataset.playerId) {
        const clickedPlayerId = playerRow.dataset.playerId;
        if (!gameState) return;

        let clickedPlayer;
        if (typeof Game.getPlayer === 'function') {
            clickedPlayer = Game.getPlayer(clickedPlayerId);
        } else {
            clickedPlayer = gameState.players.find(p => p.id === clickedPlayerId);
        }

        if (clickedPlayer) {
            const positions = Object.keys(positionOverallWeights);
            let overallsHtml = '<div class="mt-4 grid grid-cols-4 gap-2 text-center">';
            positions.forEach(pos => {
                overallsHtml += `<div class="bg-gray-200 p-2 rounded"><p class="font-semibold text-xs">${pos}</p><p class="font-bold text-xl">${Game.calculateOverall(clickedPlayer, pos)}</p></div>`;
            });
            overallsHtml += '</div>';

            const playerInfoHtml = `
                <p class="text-sm text-gray-600">
                    Age: ${clickedPlayer.age} | H: ${formatHeight(clickedPlayer.attributes?.physical?.height)} | W: ${clickedPlayer.attributes?.physical?.weight} lbs
                </p>
                <p class="text-sm text-gray-600">Potential: <span class="font-semibold">${clickedPlayer.potential}</span></p>
                ${overallsHtml}
                <button class="mt-4 w-full bg-red-500 text-white py-2 rounded hover:bg-red-600" onclick="app.cutPlayer('${clickedPlayer.id}')">Cut Player</button>
            `;
            UI.showModal(`${clickedPlayer.name}`, playerInfoHtml, null, '', null, 'Close');
        }
    }
}

function handleStatsChange() {
    if (!gameState) return;
    UI.switchTab('player-stats', gameState);
}

function handleMessageClick(messageId) {
    if (!gameState || !gameState.messages) return;
    const message = gameState.messages.find(m => m && m.id === messageId);
    if (message) {
        UI.showModal(message.subject, `<p class="whitespace-pre-wrap">${message.body}</p>`);
        Game.markMessageAsRead(messageId);
        UI.renderMessagesTab(gameState);
        UI.updateMessagesNotification(gameState.messages);
    }
}

function buildCallFriendModalHtml(freeAgents) {
    let html = '<div class="mt-4 space-y-2">';
    if (!Array.isArray(freeAgents)) return '<p>Error.</p>';
    if (freeAgents.length === 0) return '<p>No friends available.</p>';

    freeAgents.forEach(p => {
        if (!p) return;
        const bestPos = Object.keys(positionOverallWeights).reduce((best, pos) => {
            const currentOvr = Game.calculateOverall(p, pos);
            return currentOvr > best.ovr ? { pos, ovr: currentOvr } : best;
        }, { pos: 'N/A', ovr: 0 });

        html += `
            <div class="flex items-center justify-between p-2 bg-gray-100 rounded">
                <div>
                    <p class="font-bold">${p.name}</p>
                    <p class="text-sm text-gray-600">${p.relationshipName} (Best: ${bestPos.pos} - ${bestPos.ovr})</p>
                </div>
                <button data-player-id="${p.id}" class="call-friend-btn bg-green-500 hover:bg-green-600 text-white px-3 py-1 text-xs rounded font-semibold transition">CALL</button>
            </div>
        `;
    });
    html += `</div>`;
    return html;
}

function promptCallFriend(onIgnore = null) {
    gameState = Game.getGameState();
    if (!gameState) return;

    const { freeAgents, playerTeam } = gameState;
    const rosterObjects = Game.getRosterObjects(playerTeam);
    const healthyCount = rosterObjects.filter(p => p && p.status?.duration === 0).length;

    if (!onIgnore && (healthyCount >= MIN_HEALTHY_PLAYERS || !Array.isArray(freeAgents) || freeAgents.length === 0)) return;

    const modalBodyIntro = `<p>Only ${healthyCount} healthy players! Call a friend?</p>`;

    const freeAgentsWithRel = (freeAgents || []).map(p => {
        if (!p) return null;
        const maxLevel = rosterObjects.reduce(
            (max, rp) => Math.max(max, Game.getRelationshipLevel(rp?.id, p.id)),
            relationshipLevels.STRANGER.level
        );
        const relInfo = Object.values(relationshipLevels).find(rl => rl.level === maxLevel) || relationshipLevels.STRANGER;
        return { ...p, relationshipName: relInfo.name };
    }).filter(Boolean);

    const friendListHtml = buildCallFriendModalHtml(freeAgentsWithRel);
    const cancelText = onIgnore ? "Proceed Shorthanded" : "Later";
    const onCancel = onIgnore || null;

    UI.showModal("Call a Friend?", modalBodyIntro + friendListHtml, null, '', onCancel, cancelText);

    const modalBodyElement = document.getElementById('modal-body');
    if (!modalBodyElement) return;

    const callButtonDelegationHandler = (e) => {
        if (e.target.matches('.call-friend-btn')) {
            const playerId = e.target.dataset.playerId;
            if (!playerId) return;

            const result = Game.callFriend(playerId);
            UI.hideModal();

            setTimeout(() => {
                UI.showModal("Call Result", `<p>${result.message}</p>`);
                gameState = Game.getGameState();
                if (gameState) UI.switchTab('my-team', gameState);
            }, 100);
        }
    };
    modalBodyElement.addEventListener('click', callButtonDelegationHandler, { once: true });
}
function handleSetCaptain(playerId) {
    if (!gameState) return;

    if (Game.setTeamCaptain(gameState.playerTeam, playerId)) {
        // Refresh the UI to show the new "C" badge
        UI.switchTab('my-team', gameState);
        Game.saveGameState(activeSaveKey); // Save the change
    }
}

// --- Public API ---
window.app = {
    startNewGame,
    handleLoadGame,
    handleLoadTestRoster,
    handleSaveTestRoster,
    handleConfirmTeam,
    handleDraftPlayer,
    onDraftSelect: handlePlayerSelectInDraft,
    setCaptain: handleSetCaptain,
    handleAdvanceWeek,
    skipSim: UI.skipLiveGameSim,
    setSpeed: UI.setSimSpeed,
    cutPlayer: (id) => {
        if (confirm("Cut this player?")) {
            Game.playerCut(id);
            UI.hideModal();
            gameState = Game.getGameState();
            UI.switchTab('my-team', gameState);
        }
    }
};

// --- Initialization ---
// =============================================================
// --- INITIALIZATION & EVENT LISTENERS ---
// =============================================================

function main() {
    console.log("Game starting... Document loaded.");
    try {
        UI.setupElements();

        // --- Load game state from localStorage if available ---
        Game.loadGameState();
        gameState = Game.getGameState();

        // --- Setup Global Event Listeners ---
        document.getElementById('start-game-btn')?.addEventListener('click', startNewGame);
        document.getElementById('confirm-team-btn')?.addEventListener('click', handleConfirmTeam);
        document.getElementById('load-game-btn')?.addEventListener('click', handleLoadGame);
        document.getElementById('load-test-roster-btn')?.addEventListener('click', handleLoadTestRoster);
        document.getElementById('save-test-roster-btn')?.addEventListener('click', handleSaveTestRoster);
        document.getElementById('draft-player-btn')?.addEventListener('click', handleDraftPlayer);
        document.getElementById('advance-week-btn')?.addEventListener('click', handleAdvanceWeek);
        document.getElementById('go-to-next-draft-btn')?.addEventListener('click', handleGoToNextDraft);

        // Live Sim Controls
        document.getElementById('sim-skip-btn')?.addEventListener('click', () => {
            UI.skipLiveGameSim();
            UI.drawFieldVisualization(null);
        });
        document.getElementById('sim-speed-play')?.addEventListener('click', () => UI.setSimSpeed(50));
        document.getElementById('sim-speed-fast')?.addEventListener('click', () => UI.setSimSpeed(20));
        document.getElementById('sim-speed-faster')?.addEventListener('click', () => UI.setSimSpeed(150));

        // Dashboard Navigation and Content Interaction
        document.getElementById('dashboard-tabs')?.addEventListener('click', handleTabSwitch);
        document.getElementById('dashboard-content')?.addEventListener('click', handleDashboardClicks);
        document.getElementById('dashboard-content')?.addEventListener('change', handleDepthChartSelect);

        // Messages List (Event Delegation)
        document.getElementById('messages-list')?.addEventListener('click', (e) => {
            const messageItem = e.target.closest('.message-item');
            if (messageItem?.dataset.messageId) {
                handleMessageClick(messageItem.dataset.messageId);
            }
        });

        // Draft Filters/Sorting
        document.getElementById('draft-search')?.addEventListener('input', () => {
            if (gameState) UI.debouncedRenderDraftPool(gameState, handlePlayerSelectInDraft, currentSortColumn, currentSortDirection);
        });
        document.getElementById('draft-filter-pos')?.addEventListener('change', () => {
            if (gameState) UI.renderDraftPool(gameState, handlePlayerSelectInDraft, currentSortColumn, currentSortDirection);
        });
        document.querySelector('#draft-screen thead tr')?.addEventListener('click', (e) => {
            const headerCell = e.target.closest('th[data-sort]');
            if (!headerCell || !gameState) return;

            const newSortColumn = headerCell.dataset.sort;

            if (currentSortColumn === newSortColumn) {
                currentSortDirection = (currentSortDirection === 'desc') ? 'asc' : 'desc';
            } else {
                currentSortColumn = newSortColumn;
                currentSortDirection = 'desc';
            }

            UI.renderDraftPool(gameState, handlePlayerSelectInDraft, currentSortColumn, currentSortDirection);
            UI.updateDraftSortIndicators(currentSortColumn, currentSortDirection);
        });

        // Depth Chart Formation Changes
        document.getElementById('offense-formation-select')?.addEventListener('change', handleFormationChange);
        document.getElementById('defense-formation-select')?.addEventListener('change', handleFormationChange);

        // Player Stats Filters/Sorting
        document.getElementById('stats-filter-team')?.addEventListener('change', handleStatsChange);
        document.getElementById('stats-sort')?.addEventListener('change', handleStatsChange);

        // Setup Complex UI Interactions
        UI.setupDragAndDrop(handleDepthChartDrop);
        UI.setupDepthChartTabs();

        // 💡 NEW: Listener for "Refresh UI" (fired by new Depth Order tab)
        // Ensures game state is saved when you reorder the list
        document.addEventListener('refresh-ui', () => {
            // 1. Get fresh data from the game logic
            gameState = Game.getGameState();

            // 2. Save to browser storage so progress isn't lost
            Game.saveGameState(activeSaveKey);

            // 3. FORCE RE-RENDER of the currently visible tab
            // This ensures that if you cut a player or change a setting, 
            // the table updates instantly without needing a page reload.
            const activeTabEl = document.querySelector('.tab-button.active');
            if (activeTabEl) {
                const tabId = activeTabEl.dataset.tab;
                UI.switchTab(tabId, gameState);
            }

            console.log("Game state saved and UI refreshed.");
        });

        // 💡 NEW: Listener for "Depth Chart Changed" (fired by Formation Revert Fix)
        // Ensures specific player slot updates are processed and saved
        document.addEventListener('depth-chart-changed', (e) => {
            const { playerId, slot, side } = e.detail;
            handleDepthChartDrop(playerId, slot, side);
        });

        // Show the initial screen
        UI.showScreen('startScreen');

    } catch (error) {
        console.error("Fatal error during initialization:", error);
        const body = document.body;
        if (body) {
            body.innerHTML = `<div style="padding: 20px; color: #b91c1c; background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; font-family: sans-serif;">
                                 <h1 style="font-size: 1.5em; margin-bottom: 10px; color: #991b1b;">Initialization Error</h1>
                                 <p>We're sorry, but the game couldn't start due to an unexpected error.</p>
                                 <p>Please try refreshing the page. If the problem persists, check the browser console.</p>
                                 <pre style="margin-top: 15px; padding: 10px; background-color: #fee2e2; border-radius: 4px; font-size: 0.9em; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word;">${error.stack || error.message}</pre>
                               </div>`;
        }
    }
}

// Start the application once the DOM is fully loaded
document.addEventListener('DOMContentLoaded', main);