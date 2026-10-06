// js/main.js
import * as Game from './game.js';
import * as UI from './ui.js';
import { positionOverallWeights, estimateBestPosition, calculateOverall } from './game/player.js';
import { coachPersonalities, offenseFormations, defenseFormations } from './data.js';
import { formatHeight } from './utils.js';

let gameState = null;
let selectedPlayerId = null;
let currentSortColumn = 'potential';
let currentSortDirection = 'desc';
let activeSaveKey = 'backyardFootballGameState';
let isDraftingLocked = false;

const ROSTER_LIMIT = 18;
const MIN_HEALTHY_PLAYERS = 8;
const WEEKS_IN_SEASON = 9;

async function startNewGame() {
    const styleOptions = coachPersonalities.map(c => `<option value="${c.type}">${c.type}</option>`).join('');
    const offOptions = Object.keys(offenseFormations)
        .filter(k => k !== 'Punt' && k !== 'Punt_Return')
        .map(k => `<option value="${k}">${offenseFormations[k].name}</option>`).join('');
    const defOptions = Object.keys(defenseFormations)
        .filter(k => k !== 'Punt_Return' && k !== 'Punt')
        .map(k => `<option value="${k}">${defenseFormations[k].name}</option>`).join('');

    const container = document.querySelector('#team-creation-screen > div');
    if (container) {
        container.innerHTML = `
            <h2 class="text-4xl font-bold mb-2 text-center text-gray-800">Create Your Franchise</h2>
            <p class="text-sm text-gray-500 mb-6 text-center">Establish your identity. Running your preferred formations gives players a +5 IQ and Consistency boost.</p>
            
            <div class="space-y-4 text-sm text-gray-700 text-left">
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block font-bold mb-1">Coach Name:</label>
                        <input id="setup-coach-name" type="text" placeholder="e.g. Coach Taylor" class="w-full border border-gray-300 rounded p-2 focus:ring-amber-500">
                    </div>
                    <div>
                        <label class="block font-bold mb-1">Coaching Style:</label>
                        <select id="setup-coach-style" class="w-full border border-gray-300 rounded p-2 focus:ring-amber-500">
                            ${styleOptions}
                        </select>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-4 border-t border-gray-100 pt-4 mt-2">
                    <div>
                        <label class="block font-bold mb-1">Preferred Offense:</label>
                        <select id="setup-pref-off" class="w-full border border-gray-300 rounded p-2 focus:ring-amber-500">
                            ${offOptions}
                        </select>
                    </div>
                    <div>
                        <label class="block font-bold mb-1">Preferred Defense:</label>
                        <select id="setup-pref-def" class="w-full border border-gray-300 rounded p-2 focus:ring-amber-500">
                            ${defOptions}
                        </select>
                    </div>
                </div>

                <div class="border-t border-gray-100 pt-4 mt-2">
                    <label class="block font-bold mb-1">Team Name:</label>
                    <input id="setup-team-name" type="text" placeholder="e.g. The Bulldogs" class="w-full border border-gray-300 rounded p-2 focus:ring-amber-500">
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block font-bold mb-1">Primary Color:</label>
                        <input type="color" id="setup-primary-color" value="#2563EB" class="w-full h-10 rounded cursor-pointer border border-gray-300 p-0.5">
                    </div>
                    <div>
                        <label class="block font-bold mb-1">Secondary Color:</label>
                        <input type="color" id="setup-secondary-color" value="#FFFFFF" class="w-full h-10 rounded cursor-pointer border border-gray-300 p-0.5">
                    </div>
                </div>
            </div>

            <button id="confirm-team-btn" class="mt-8 btn bg-amber-600 hover:bg-amber-700 text-white font-bold py-4 px-8 rounded-xl w-full text-xl shadow-lg transition">
                Start Franchise →
            </button>
        `;

        document.getElementById('confirm-team-btn')?.addEventListener('click', handleConfirmTeam);
    }
    UI.showScreen('team-creation-screen');
}

async function handleConfirmTeam() {
    const teamName = document.getElementById('setup-team-name')?.value.trim();
    const coachName = document.getElementById('setup-coach-name')?.value.trim();
    const coachStyle = document.getElementById('setup-coach-style')?.value;
    const prefOff = document.getElementById('setup-pref-off')?.value;
    const prefDef = document.getElementById('setup-pref-def')?.value;
    const primaryColor = document.getElementById('setup-primary-color')?.value;
    const secondaryColor = document.getElementById('setup-secondary-color')?.value;

    if (!teamName || !coachName) {
        UI.showModal("Missing Info", "<p>Please provide both a Team Name and a Coach Name.</p>");
        return;
    }

    activeSaveKey = 'backyardFootballGameState';

    try {
        UI.showScreen("loading-screen");
        UI.startLoadingMessages();
        await new Promise(resolve => setTimeout(resolve, 50));

        await Game.initializeLeague((progress) => {
            UI.updateLoadingProgress(Math.round(progress * 100));
        });

        Game.createPlayerTeam(teamName, {
            coachName, coachStyle, prefOff, prefDef, primaryColor, secondaryColor
        });

        gameState = Game.getGameState();
        gameState.draftCompleted = false;

        generateDraftPreviewMessage();
        UI.stopLoadingMessages();

        const advBtn = document.getElementById('advance-week-btn');
        if (advBtn) {
            advBtn.innerHTML = `<span>Start Draft</span>`;
            advBtn.classList.remove('bg-amber-500');
            advBtn.classList.add('bg-green-600');
        }

        UI.renderDashboard(gameState);
        UI.switchTab('messages', gameState);
        UI.showScreen('dashboard-screen');
    } catch (error) {
        console.error("Error starting game:", error);
        UI.stopLoadingMessages();
        UI.showModal("Error", `Could not start game: ${error.message}`);
    }
}

function generateDraftPreviewMessage() {
    Game.addMessage("League Office", `Welcome to Backyard GM, Coach! Your squad has entered the league. Check your roster, scout the draft class, and click "Start Draft" when you're ready to pick your players.`, false, gameState);
}

function handlePlayerSelectInDraft(playerId) {
    if (!gameState) return;
    selectedPlayerId = playerId;
    const player = gameState.players.find(p => p.id === playerId);
    UI.updateSelectedPlayerRow(playerId);
    UI.renderSelectedPlayerCard(player, gameState);
}

function handleDraftPlayer() {
    if (!gameState || isDraftingLocked) return;
    if (selectedPlayerId) {
        const player = gameState.players.find(p => p.id === selectedPlayerId);
        const team = gameState.playerTeam;
        if (team.roster.length >= ROSTER_LIMIT) {
            UI.showModal("Roster Full", `<p>Your roster is full (${ROSTER_LIMIT} players).</p>`);
            return;
        }

        if (player && Game.addPlayerToTeam(player, team)) {
            const gs = Game.getGameState();
            if (!gs.pickHistory) gs.pickHistory = [];

            gs.pickHistory.push({
                pick: gs.currentPick + 1,
                teamName: team.name,
                teamId: team.id,
                playerName: player.name,
                pos: estimateBestPosition(player),
                ovr: Game.calculateOverall(player, estimateBestPosition(player)),
                potential: player.potential
            });

            selectedPlayerId = null;
            gs.currentPick++;
            UI.renderSelectedPlayerCard(null, gs);
            UI.renderDraftScreen(gs, handlePlayerSelectInDraft, null, currentSortColumn, currentSortDirection);
            runAIDraftPicks();
        }
    }
}

async function runAIDraftPicks() {
    if (!gameState || isDraftingLocked) return;
    isDraftingLocked = true;

    try {
        while (true) {
            const pickLimitReached = gameState.currentPick >= gameState.draftOrder.length;
            const noPlayersLeft = gameState.players.filter(p => p && !p.teamId).length === 0;
            const allTeamsFull = gameState.teams.every(t => !t || !t.roster || t.roster.length >= ROSTER_LIMIT);

            if (pickLimitReached || noPlayersLeft || allTeamsFull) {
                await handleDraftEnd();
                break;
            }

            let currentPickingTeam = gameState.draftOrder[gameState.currentPick];

            if (currentPickingTeam && currentPickingTeam.id === gameState.playerTeam.id) {
                if (gameState.playerTeam.roster.length >= ROSTER_LIMIT) {
                    gameState.currentPick++;
                    UI.renderSelectedPlayerCard(null, gameState);
                    continue;
                } else {
                    UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId, currentSortColumn, currentSortDirection);
                    break;
                }
            }

            if (!currentPickingTeam || !currentPickingTeam.roster || currentPickingTeam.roster.length >= ROSTER_LIMIT) {
                gameState.currentPick++;
            } else {
                Game.simulateAIPick(currentPickingTeam);
                gameState.currentPick++;
            }
        }
    } catch (e) {
        console.error("Draft loop error:", e);
    } finally {
        isDraftingLocked = false;
    }
}

async function handleDraftEnd() {
    if (!gameState) return;
    Game.generateDraftSummary();
    Game.generateSchedule();
    gameState = Game.getGameState();
    gameState.draftCompleted = true;

    for (const team of gameState.teams) {
        if (!team) continue;
        try { Game.aiSetDepthChart(team); } catch (error) { console.error(error); }
    }

    const advBtn = document.getElementById('advance-week-btn');
    if (advBtn) {
        advBtn.innerHTML = `<span>Play Week</span>`;
        advBtn.classList.add('bg-amber-500');
        advBtn.classList.remove('bg-green-600');
    }

    UI.renderDashboard(gameState);
    UI.switchTab('my-team', gameState);
    UI.showScreen('dashboard-screen');
}

async function handleLoadGame(saveKey) {
    try {
        const keyToLoad = typeof saveKey === 'string' ? saveKey : 'backyardFootballGameState';
        const loadedState = Game.loadGameState(keyToLoad);

        if (!loadedState || !loadedState.teams) {
            UI.showModal("Load Failed", "<p>No saved game data found.</p>");
            return;
        }

        gameState = loadedState;
        selectedPlayerId = null;
        activeSaveKey = keyToLoad;

        if (gameState.playerTeam) {
            Game.rebuildDepthChartFromOrder(gameState.playerTeam);
        }

        UI.renderDashboard(gameState);
        UI.switchTab('my-team', gameState);
        UI.showScreen('dashboard-screen');
    } catch (error) {
        console.error("Load Error:", error);
    }
}

function handleLoadTestRoster() {
    handleLoadGame('my_test_roster');
}

function handleSaveTestRoster() {
    if (!gameState) return;
    Game.saveGameState('my_test_roster');
    activeSaveKey = 'my_test_roster';
    UI.showModal("Saved", "<p>Game saved as 'Test Roster'.</p>");
}

function handleTabSwitch(e) {
    const button = e.target.closest('.tab-button');
    if (button) {
        const tabId = button.dataset.tab;
        gameState = Game.getGameState();
        if (gameState) UI.switchTab(tabId, gameState);
    }
}

function handleFormationChange(e) {
    if (!gameState) return;
    const side = e.target.id.includes('offense') ? 'offense' : 'defense';
    Game.changeFormation(side, e.target.value);
    Game.saveGameState(activeSaveKey);
    document.dispatchEvent(new CustomEvent('refresh-ui'));
}

async function handleAdvanceWeek() {
    if (!gameState) return;

    if (gameState.currentWeek === 0 && !gameState.draftCompleted) {
        Game.setupDraft();
        gameState = Game.getGameState();
        selectedPlayerId = null;
        UI.renderSelectedPlayerCard(null, gameState);
        UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId, currentSortColumn, currentSortDirection);
        UI.showScreen('draft-screen');
        runAIDraftPicks();
        return;
    }

    const playerTeamId = gameState.playerTeam.id;
    const gamesPerWeek = gameState.teams.length / 2;
    const weekGames = gameState.schedule.slice(gameState.currentWeek * gamesPerWeek, (gameState.currentWeek + 1) * gamesPerWeek);
    const playerGameMatch = weekGames.find(g => g.home.id === playerTeamId || g.away.id === playerTeamId);

    if (playerGameMatch) {
        const isHome = playerGameMatch.home.id === playerTeamId;
        const opponentName = isHome ? playerGameMatch.away.name : playerGameMatch.home.name;

        UI.showModal(
            `Game Day: Week ${gameState.currentWeek + 1}`,
            `<p class="mb-4">Your team is playing <strong>${opponentName}</strong>.</p><p>How do you want to play?</p>`,
            () => startLiveGame(playerGameMatch), "Watch Game",
            () => simulateRestOfWeek(), "Quick Sim"
        );
    } else {
        simulateRestOfWeek();
    }
}

async function startLiveGame(playerGameMatch) {
    if (!gameState) return;

    // Simulate CPU games for this week
    const gamesPerWeek = gameState.teams.length / 2;
    const allGames = gameState.schedule.slice(gameState.currentWeek * gamesPerWeek, (gameState.currentWeek + 1) * gamesPerWeek);
    const otherResults = [];

    for (const match of allGames) {
        if (match.home.id === playerGameMatch.home.id && match.away.id === playerGameMatch.away.id) continue;
        const result = Game.simulateMatchFast(match.home, match.away);
        if (result) otherResults.push(result);
    }

    Game.resetGameStats(playerGameMatch.home, playerGameMatch.away);

    const liveGameParams = {
        homeTeam: playerGameMatch.home,
        awayTeam: playerGameMatch.away,
        autoSubThreshold: gameState.playerTeam?.autoSubThreshold ?? 65,
        homeScore: 0, awayScore: 0,
        possession: Math.random() < 0.5 ? playerGameMatch.home : playerGameMatch.away,
        ballOn: 35, down: 1, yardsToGo: 10,
        gameLog: [`Coin Toss! ${playerGameMatch.home.name} vs ${playerGameMatch.away.name}`],
        isConversionAttempt: false, isGameOver: false, weather: 'Sunny', quarter: 1, clock: 720
    };

    UI.showScreen('game-sim-screen');
    UI.startLiveGameLoop(liveGameParams, (finalResult) => {
        Game.finalizeGameResults(finalResult.homeTeam, finalResult.awayTeam, finalResult.homeScore, finalResult.awayScore);
        const combined = [...otherResults, finalResult];
        finishWeekSimulation(combined);
    });
}

function simulateRestOfWeek() {
    if (!gameState || gameState.currentWeek >= WEEKS_IN_SEASON) return;
    const results = Game.simulateWeek({ fastSim: true });
    finishWeekSimulation(results || []);
}

function buildResultsModalHtml(results) {
    if (!gameState?.playerTeam || !Array.isArray(results)) return "<p>Week completed.</p>";
    const playerGame = results.find(r => r && (r.homeTeam?.id === gameState.playerTeam.id || r.awayTeam?.id === gameState.playerTeam.id));
    let resultText = 'BYE';
    if (playerGame) {
        const myScore = playerGame.homeTeam.id === gameState.playerTeam.id ? playerGame.homeScore : playerGame.awayScore;
        const oppScore = playerGame.homeTeam.id === gameState.playerTeam.id ? playerGame.awayScore : playerGame.homeScore;
        if (myScore > oppScore) resultText = "VICTORY!";
        else if (myScore < oppScore) resultText = "DEFEAT";
        else resultText = "TIE";
    }

    let html = `<h4 class="text-base font-bold text-amber-600 mb-2">Outcome: ${resultText}</h4>`;
    if (playerGame) {
        html += `<p class="font-bold text-lg mb-3 p-2 bg-amber-50 rounded border border-amber-200">${playerGame.awayTeam.name} ${playerGame.awayScore} @ ${playerGame.homeTeam.name} ${playerGame.homeScore}</p>`;
    }
    html += '<h5 class="font-bold text-sm text-gray-700 border-t pt-2 mt-2">League Scores:</h5><div class="space-y-1 text-xs mt-1 max-h-48 overflow-y-auto">';
    results.forEach(r => {
        if (!r) return;
        const isPlayerGame = r.homeTeam.id === gameState.playerTeam.id || r.awayTeam.id === gameState.playerTeam.id;
        html += `<p class="${isPlayerGame ? 'font-bold text-amber-600' : 'text-gray-700'}">${r.awayTeam.name} ${r.awayScore} @ ${r.homeTeam.name} ${r.homeScore}</p>`;
    });
    html += '</div>';
    return html;
}

function finishWeekSimulation(results) {
    Game.processEndOfWeek();
    gameState.currentWeek++;
    Game.saveGameState(activeSaveKey);

    if (results && results.length > 0) {
        UI.showModal(`Week ${gameState.currentWeek} Summary`, buildResultsModalHtml(results));
    }

    if (gameState.currentWeek >= WEEKS_IN_SEASON) {
        const report = Game.advanceToOffseason();
        gameState = Game.getGameState();
        Game.saveGameState(activeSaveKey);
        UI.renderOffseasonScreen(report, gameState.year);
        UI.showScreen('offseason-screen');
        return;
    }

    Game.generateWeeklyFreeAgents();
    gameState = Game.getGameState();
    UI.renderDashboard(gameState);
    UI.showScreen('dashboard-screen');
}

function openPlayerCard(playerId) {
    if (!gameState) return;
    const player = Game.getPlayer(playerId) || gameState.players.find(p => p.id === playerId);
    if (!player) return;

    const team = gameState.teams.find(t => t.id === player.teamId);
    const teamName = team ? team.name : 'Free Agent';
    const isMyTeam = player.teamId === gameState.playerTeam.id;

    const positions = Object.keys(positionOverallWeights);
    let overallsHtml = '<div class="mt-2 grid grid-cols-4 gap-1 text-center">';
    positions.forEach(pos => {
        overallsHtml += `<div class="bg-gray-100 p-1.5 rounded"><p class="text-[10px] font-bold text-gray-500">${pos}</p><p class="font-black text-sm text-gray-800">${calculateOverall(player, pos)}</p></div>`;
    });
    overallsHtml += '</div>';

    const s = player.seasonStats || {};
    const c = player.careerStats || {};

    let modalHtml = `
        <div class="mb-3 pb-2 border-b border-gray-200">
            <p class="text-xs font-bold uppercase text-gray-500">${teamName} • Age ${player.age} • Pot ${player.potential}</p>
            <p class="text-xs text-gray-700">H: ${formatHeight(player.attributes?.physical?.height)} | W: ${player.attributes?.physical?.weight} lbs</p>
        </div>

        <div class="mb-3">
            <h5 class="text-xs font-bold text-gray-700 uppercase mb-1">Ratings by Position</h5>
            ${overallsHtml}
        </div>

        <div class="grid grid-cols-2 gap-2 text-xs mb-3">
            <div class="bg-blue-50 p-2 rounded border border-blue-100">
                <h6 class="font-bold text-blue-900 border-b border-blue-200 pb-0.5 mb-1">Season Stats</h6>
                <p>Pass: ${s.passYards || 0} yds, ${s.passCompletions || 0}/${s.passAttempts || 0}</p>
                <p>Rush: ${s.rushYards || 0} yds, ${s.rushAttempts || 0} att</p>
                <p>Rec: ${s.recYards || 0} yds, ${s.receptions || 0} rec</p>
                <p>Tackles: ${s.tackles || 0} | Sacks: ${s.sacks || 0}</p>
                <p class="font-bold text-amber-700 mt-1">TDs: ${s.touchdowns || 0}</p>
            </div>
            <div class="bg-gray-50 p-2 rounded border border-gray-200">
                <h6 class="font-bold text-gray-800 border-b border-gray-200 pb-0.5 mb-1">Career & Traits</h6>
                <p>Seasons: ${c.seasonsPlayed || 0}</p>
                <p>Work Ethic: <strong>${player.personality?.workEthic || 50}</strong></p>
                <p>Dependability: <strong>${player.personality?.dependability || 50}</strong></p>
                <p>Street Cred: <strong>${player.personality?.streetCred || 50}</strong></p>
                <p class="font-bold text-amber-700 mt-1">Career TDs: ${c.touchdowns || 0}</p>
            </div>
        </div>

        ${isMyTeam ? `<button class="mt-2 w-full bg-red-500 hover:bg-red-600 text-white py-2 rounded font-bold text-xs transition shadow" onclick="app.cutPlayer('${player.id}')">Cut Player from Team</button>` : ''}
    `;

    UI.showModal(`${player.name}`, modalHtml);
}

function handleSetCaptain(playerId) {
    if (!gameState) return;
    if (Game.setTeamCaptain(gameState.playerTeam, playerId)) {
        UI.switchTab('my-team', gameState);
        Game.saveGameState(activeSaveKey);
    }
}

function handleGoToNextDraft() {
    Game.setupDraft();
    gameState = Game.getGameState();
    selectedPlayerId = null;
    UI.renderSelectedPlayerCard(null, gameState);
    UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId, currentSortColumn, currentSortDirection);
    UI.showScreen('draft-screen');
    runAIDraftPicks();
}

window.app = {
    startNewGame,
    handleLoadGame,
    handleLoadTestRoster,
    handleSaveTestRoster,
    openPlayerCard,
    handleConfirmTeam,
    handleDraftPlayer,
    onDraftSelect: handlePlayerSelectInDraft,
    setCaptain: handleSetCaptain,
    handleAdvanceWeek,
    handleGoToNextDraft,
    skipSim: () => UI.skipLiveGameSim(),
    setSpeed: (s) => UI.setSimSpeed(s),
    cutPlayer: (id) => {
        if (confirm("Cut this player?")) {
            Game.playerCut(id);
            UI.hideModal();
            gameState = Game.getGameState();
            UI.switchTab('my-team', gameState);
        }
    }
};

function main() {
    UI.setupElements();
    Game.loadGameState();
    gameState = Game.getGameState();

    document.getElementById('start-game-btn')?.addEventListener('click', startNewGame);
    document.getElementById('load-game-btn')?.addEventListener('click', () => handleLoadGame());
    document.getElementById('load-test-roster-btn')?.addEventListener('click', handleLoadTestRoster);
    document.getElementById('save-test-roster-btn')?.addEventListener('click', handleSaveTestRoster);
    document.getElementById('draft-player-btn')?.addEventListener('click', handleDraftPlayer);
    document.getElementById('advance-week-btn')?.addEventListener('click', handleAdvanceWeek);
    document.getElementById('dashboard-tabs')?.addEventListener('click', handleTabSwitch);
    document.getElementById('go-to-next-draft-btn')?.addEventListener('click', handleGoToNextDraft);

    // Live Sim Speed Controls
    document.getElementById('sim-speed-pause')?.addEventListener('click', () => UI.togglePause());
    document.getElementById('sim-skip-btn')?.addEventListener('click', () => UI.skipLiveGameSim());
    document.getElementById('sim-speed-play')?.addEventListener('click', () => UI.setSimSpeed(80));
    document.getElementById('sim-speed-fast')?.addEventListener('click', () => UI.setSimSpeed(40));
    document.getElementById('sim-speed-faster')?.addEventListener('click', () => UI.setSimSpeed(10));

    // Formation Selectors in Depth Chart
    document.getElementById('offense-formation-select')?.addEventListener('change', handleFormationChange);
    document.getElementById('defense-formation-select')?.addEventListener('change', handleFormationChange);

    // Draft Screen Tabs
    document.querySelectorAll('.draft-tab-btn').forEach(btn => {
        btn.onclick = () => {
            const tab = btn.dataset.draftTab;
            document.querySelectorAll('.draft-tab-btn').forEach(b => {
                b.classList.remove('active', 'bg-amber-600', 'text-white');
                b.classList.add('text-gray-400');
            });
            btn.classList.add('active', 'bg-amber-600', 'text-white');
            btn.classList.remove('text-gray-400');

            document.querySelectorAll('.draft-tab-content').forEach(c => c.classList.add('hidden'));
            const targetTab = document.getElementById(`draft-tab-${tab}`);
            if (targetTab) targetTab.classList.remove('hidden');

            if (tab === 'history') UI.renderPickHistory(gameState);
            if (tab === 'teams') UI.renderDraftTeamView(gameState);
        };
    });

    // Draft Search and Filtering
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

    // Stats Filters & Sorters
    document.getElementById('stats-filter-team')?.addEventListener('change', () => {
        if (gameState) UI.switchTab('player-stats', gameState);
    });
    document.getElementById('stats-sort')?.addEventListener('change', () => {
        if (gameState) UI.switchTab('player-stats', gameState);
    });

    // Inbox Messages
    document.getElementById('messages-list')?.addEventListener('click', (e) => {
        const messageItem = e.target.closest('.message-item');
        if (messageItem?.dataset.messageId && gameState?.messages) {
            const message = gameState.messages.find(m => m && m.id === messageItem.dataset.messageId);
            if (message) {
                UI.showModal(message.subject, `<p class="whitespace-pre-wrap">${message.body}</p>`);
                Game.markMessageAsRead(message.id);
                UI.renderMessagesTab(gameState);
                UI.updateMessagesNotification(gameState.messages);
            }
        }
    });

    // Player row click delegation in dashboard
    document.getElementById('dashboard-content')?.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
        const playerRow = e.target.closest('tr[data-player-id]');
        if (playerRow?.dataset.playerId) {
            openPlayerCard(playerRow.dataset.playerId);
        }
    });

    document.addEventListener('refresh-ui', () => {
        gameState = Game.getGameState();
        const activeTab = document.querySelector('.tab-button.active')?.dataset.tab || 'my-team';
        UI.switchTab(activeTab, gameState);
    });

    UI.showScreen('start-screen');
}

document.addEventListener('DOMContentLoaded', main);
