import * as Game from './game.js';
import * as UI from './ui.js';

let gameState = null;
let selectedPlayerId = null;

// --- Event Handlers ---

async function startNewGame() {
    try {
        UI.showScreen('loadingScreen');
        await new Promise(resolve => setTimeout(resolve, 50));
        await Game.initializeLeague(UI.updateLoadingProgress);
        gameState = Game.getGameState();
        UI.renderTeamNameSuggestions(['Jets', 'Sharks', 'Tigers', 'Bulldogs', 'Panthers', 'Giants'], handleTeamNameSelection);
        UI.showScreen('teamCreationScreen');
    } catch (error) {
        console.error("Error starting game:", error);
    }
}

function handleTeamNameSelection(name) {
    const customNameInput = document.getElementById('custom-team-name');
    if (customNameInput) {
        customNameInput.value = name;
    }
}

function handleConfirmTeam() {
    const customNameInput = document.getElementById('custom-team-name');
    const customName = customNameInput ? customNameInput.value.trim() : '';

    if (customName) {
        Game.createPlayerTeam(customName);
        Game.setupDraft();
        gameState = Game.getGameState();
        UI.renderSelectedPlayerCard(null, gameState); // Pass gameState
        UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId);
        UI.showScreen('draftScreen');
        runAIDraftPicks();
    } else {
        UI.showModal("Team Name Required", "<p>Please enter or select a team name to continue.</p>");
    }
}


function handlePlayerSelectInDraft(playerId) {
    selectedPlayerId = playerId;
    const player = gameState.players.find(p => p.id === playerId);
    UI.updateSelectedPlayerRow(playerId);
    UI.renderSelectedPlayerCard(player, gameState); // Pass gameState
}

function handleDraftPlayer() {
    if (selectedPlayerId) {
        const player = gameState.players.find(p => p.id === selectedPlayerId);
        const team = Game.getGameState().playerTeam;
        if (team.roster.length >= 10) {
             UI.showModal("Roster Full", "<p>Your roster is full! You cannot draft more players.</p>");
             return;
        }
        
        if (Game.addPlayerToTeam(player, team)) {
            selectedPlayerId = null;
            gameState.currentPick++;
            UI.renderSelectedPlayerCard(null, gameState); // Pass gameState
            runAIDraftPicks();
        }
    }
}

async function runAIDraftPicks() {
    const checkDraftEnd = () => {
        const undraftedPlayers = gameState.players.filter(p => !p.teamId).length;
        const allNeedsMet = gameState.teams.every(t => t.roster.length >= 10 || t.draftNeeds === 0);
        
        if (gameState.currentPick >= gameState.draftOrder.length || undraftedPlayers === 0 || allNeedsMet) {
            handleDraftEnd();
            return true;
        }
        return false;
    };

    if (checkDraftEnd()) return;
    
    let currentPickingTeam = gameState.draftOrder[gameState.currentPick];

    while (currentPickingTeam.id !== gameState.playerTeam.id) {
        UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId);
        await new Promise(resolve => setTimeout(resolve, 100)); // AI pick speed

        Game.simulateAIPick(currentPickingTeam); // This function now handles skipping if roster is full
        gameState.currentPick++;

        if (checkDraftEnd()) return;
        
        currentPickingTeam = gameState.draftOrder[gameState.currentPick];
    }
    
    // It's player's turn or draft ended while AI was picking
    if (!checkDraftEnd()) {
        // If player's team roster is full, skip their pick
        if (gameState.playerTeam.roster.length >= 10) {
            console.log("Player roster full, skipping pick.");
            gameState.currentPick++;
            runAIDraftPicks(); // Go back to AI picks
        } else {
            UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId); // Render for player
        }
    }
}


function handleDraftEnd() {
    console.log("Draft has concluded.");
    gameState.teams.forEach(team => {
        Game.aiSetDepthChart(team);
    });

    UI.showModal("Draft Complete!", "<p>The draft has concluded. Get ready for the season!</p>");
    Game.generateSchedule();
    gameState = Game.getGameState();
    UI.renderDashboard(gameState);
    UI.switchTab('my-team', gameState);
    UI.showScreen('dashboardScreen');
}

function handleTabSwitch(e) {
    if (e.target.matches('.tab-button')) {
        const tabId = e.target.dataset.tab;
        UI.switchTab(tabId, gameState);
    }
}

function handleDepthChartDrop(playerId, newPositionSlot, side) {
    Game.updateDepthChart(playerId, newPositionSlot, side);
    gameState = Game.getGameState();
    UI.switchTab('depth-chart', gameState); // Re-render the tab
}

function handleFormationChange(e) {
    const side = e.target.id.includes('offense') ? 'offense' : 'defense';
    const formationName = e.target.value;
    Game.changeFormation(side, formationName);
    gameState = Game.getGameState();
    UI.switchTab('depth-chart', gameState); // Re-render the tab
}

async function handleAdvanceWeek() {
    
    // Check for player's game this week
    const playerGameMatch = gameState.schedule.slice(gameState.currentWeek * 10, (gameState.currentWeek + 1) * 10)
                                     .find(g => g.home.id === gameState.playerTeam.id || g.away.id === gameState.playerTeam.id);
    
    if(playerGameMatch) {
         UI.showModal("Game Day!", 
            `<p>It's Week ${gameState.currentWeek + 1}! Your opponent is <strong>${playerGameMatch.home.id === gameState.playerTeam.id ? playerGameMatch.away.name : playerGameMatch.home.name}</strong>.</p>`, 
            () => startLiveGame(playerGameMatch), // onConfirm = Watch Game
            "Watch Game Live",
            () => simulateRestOfWeek() // onCancel = Sim Week
         );
    } else {
        // This shouldn't happen with the new scheduler, but good failsafe
        simulateRestOfWeek();
    }
}

function startLiveGame(playerGameMatch) {
    console.log("Starting live game...");
    const allGames = gameState.schedule.slice(gameState.currentWeek * 10, (gameState.currentWeek + 1) * 10);
    let playerGameResult = null;

    // Simulate all games instantly
    const results = allGames.map(match => {
        const result = Game.simulateGame(match.home, match.away);
        if(result.breakthroughs) {
            result.breakthroughs.forEach(b => {
                if (b.player.teamId === gameState.playerTeam.id) {
                    addMessage("Player Breakthrough!", `${b.player.name} improved ${b.attr}!`);
                }
            });
            game.breakthroughs.push(...result.breakthroughs);
        }
        if (match.home.id === playerGameMatch.home.id && match.away.id === playerGameMatch.away.id) {
            playerGameResult = result;
        }
        return result;
    });

    game.gameResults.push(...results);
    game.currentWeek++;
    
    if (playerGameResult) {
        UI.showScreen('game-sim-screen');
        UI.startLiveGameSim(playerGameResult, () => {
            // This is the callback function for when the sim finishes
            console.log("Live sim finished.");
            finishWeekSimulation(results); // Go to post-game logic
        });
    } else {
        // Failsafe if player game wasn't found (shouldn't happen)
        finishWeekSimulation(results);
    }
}


function simulateRestOfWeek() {
    console.log("Simulating rest of week...");
    const results = Game.simulateWeek(); // This will simulate all games and advance the week
    
    if (results) {
         finishWeekSimulation(results);
    } else {
        // Season is over
        handleSeasonEnd();
    }
}

function finishWeekSimulation(results) {
    const playerGame = results.find(r => r.homeTeam.id === gameState.playerTeam.id || r.awayTeam.id === gameState.playerTeam.id);
    const playerTeamResult = playerGame ? (playerGame.homeTeam.id === gameState.playerTeam.id ? (playerGame.homeScore > playerGame.awayScore ? 'W' : 'L') : (playerGame.awayScore > playerGame.homeScore ? 'W' : 'L')) : '';
    const breakthroughs = Game.getBreakthroughs();

    let resultsHtml = '<h4>All Weekly Results</h4><div class="space-y-1 text-sm mt-2">';
    results.forEach(r => {
        const isPlayerGame = r.homeTeam.id === gameState.playerTeam.id || r.awayTeam.id === gameState.playerTeam.id;
        resultsHtml += `<p class="${isPlayerGame ? 'font-bold' : ''}">${r.awayTeam.name} ${r.awayScore} @ ${r.homeTeam.name} ${r.homeScore}</p>`;
    });
     resultsHtml += '</div>';

    if (breakthroughs.length > 0) {
        resultsHtml += `<h4 class="font-bold mt-4 mb-2">Player Breakthroughs!</h4><div class="space-y-1 text-sm">`;
        breakthroughs.forEach(b => {
             resultsHtml += `<p><strong>${b.player.name}</strong> (${b.player.teamName || 'Your Team'}) had a great game and improved their <strong>${b.attr}</strong>!</p>`;
        });
        resultsHtml += `</div>`;
    }
    
    UI.showModal(`Week ${gameState.currentWeek} Results`, resultsHtml); // currentWeek was already advanced by simulateWeek
    
    // Handle AI roster moves and generate new free agents
    gameState.teams.filter(t => t.id !== gameState.playerTeam.id).forEach(Game.aiManageRoster);
    Game.generateWeeklyFreeAgents();

    // Update dashboard
    gameState = Game.getGameState();
    UI.renderDashboard(gameState);
    const activeTab = document.querySelector('.tab-button.active').dataset.tab;
    UI.switchTab(activeTab, gameState); // Re-render current tab
    UI.showScreen('dashboardScreen'); // Ensure dashboard is visible
    
    // Check for new injuries/events and prompt for "Call a Friend"
    const hasUnavailablePlayer = gameState.playerTeam.roster.some(p => p.status.duration > 0);
    if (hasUnavailablePlayer) {
        promptCallFriend();
    }
}

function handleSeasonEnd() {
    UI.showModal("Season Over", "<p>The regular season has concluded. Advancing to the offseason!</p>");
    const offseasonReport = Game.advanceToOffseason();
    gameState = Game.getGameState(); // Get new state after offseason logic
    UI.renderOffseasonScreen(offseasonReport, gameState.year);
    UI.showScreen('offseasonScreen');
}

function handleGoToNextDraft() {
    Game.setupDraft();
    gameState = Game.getGameState();
    selectedPlayerId = null;
    UI.renderSelectedPlayerCard(null, gameState);
    UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId);
    UI.showScreen('draftScreen');
    runAIDraftPicks();
}

function handleDashboardClicks(e) {
    const target = e.target;
    // This is now handled in the modal
    // if (target.matches('.call-friend-btn')) { ... }
}

function handleStatsChange() {
    UI.switchTab('player-stats', gameState);
}

function handleMessageClick(messageId) {
    const message = gameState.messages.find(m => m.id === messageId);
    if (message) {
        UI.showModal(message.subject, `<p class="whitespace-pre-wrap">${message.body}</p>`);
        Game.markMessageAsRead(messageId);
        UI.updateMessagesNotification(gameState.messages);
        UI.renderMessagesTab(gameState, handleMessageClick); // Re-render messages to update read status
    }
}

function promptCallFriend() {
    Game.generateWeeklyFreeAgents(); // Make sure FAs are available
    gameState = Game.getGameState();
    const { freeAgents, playerTeam } = gameState;
    const unavailableCount = playerTeam.roster.filter(p => p.status.duration > 0).length;

    if (freeAgents.length === 0) {
        addMessage("No Friends Available", "You have unavailable players, but none of your friends were available to call this week.");
        return;
    }

    let modalBody = `<p>You have ${unavailableCount} player(s) unavailable for the next game. Do you want to call a friend to fill in?</p>
                     <div class="mt-4 space-y-2">`;
    
    freeAgents.forEach(p => {
        const bestPos = Object.keys(positionOverallWeights).reduce((best, pos) => {
            const currentOvr = Game.calculateOverall(p, pos);
            return currentOvr > best.ovr ? { pos, ovr: currentOvr } : best;
        }, { pos: 'N/A', ovr: 0 });

        modalBody += `
            <div class="flex items-center justify-between p-2 bg-gray-100 rounded">
                <div>
                    <p class="font-bold">${p.name}</p>
                    <p class="text-sm text-gray-600">${p.relationship} (Best: ${bestPos.pos} - ${bestPos.ovr} Ovr)</p>
                </div>
                <button data-player-id="${p.id}" class="call-friend-btn bg-green-500 hover:bg-green-600 text-white px-3 py-1 text-xs rounded font-semibold">CALL</button>
            </div>
        `;
    });
    modalBody += `</div>`;

    UI.showModal("Call a Friend?", modalBody);
    
    // Add temporary event listeners to the modal for the new buttons
    document.querySelectorAll('.call-friend-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const playerId = e.target.dataset.playerId;
            const result = Game.callFriend(playerId);
            // Show result in a new, simpler modal
            UI.showModal("Call Result", `<p>${result.message}</p>`);
            // Update game state and relevant tabs
            gameState = Game.getGameState();
            UI.switchTab('my-team', gameState);
            if(document.querySelector('[data-tab="messages"]')?.classList.contains('active')) {
                 UI.renderMessagesTab(gameState, handleMessageClick);
            }
        });
    });
}


function main() {
    console.log("Game starting... Document loaded.");
    try {
        UI.setupElements();

        // Screen Buttons
        document.getElementById('start-game-btn')?.addEventListener('click', startNewGame);
        document.getElementById('confirm-team-btn')?.addEventListener('click', handleConfirmTeam);
        document.getElementById('draft-player-btn')?.addEventListener('click', handleDraftPlayer);
        document.getElementById('advance-week-btn')?.addEventListener('click', handleAdvanceWeek);
        document.getElementById('go-to-next-draft-btn')?.addEventListener('click', handleGoToNextDraft);
        
        // Sim Screen Controls
        document.getElementById('sim-skip-btn')?.addEventListener('click', UI.skipLiveGameSim);
        document.getElementById('sim-speed-play')?.addEventListener('click', () => UI.setSimSpeed(1000));
        document.getElementById('sim-speed-fast')?.addEventListener('click', () => UI.setSimSpeed(400));
        document.getElementById('sim-speed-faster')?.addEventListener('click', () => UI.setSimSpeed(100));

        // Dashboard Listeners
        document.getElementById('dashboard-tabs')?.addEventListener('click', handleTabSwitch);
        document.getElementById('dashboard-content')?.addEventListener('click', handleDashboardClicks); // For dynamic buttons
        document.getElementById('messages-list')?.addEventListener('click', (e) => {
             const messageItem = e.target.closest('.message-item');
             if (messageItem) {
                 handleMessageClick(messageItem.dataset.messageId);
             }
        });

        // Filter/Sort Listeners
        document.getElementById('draft-search')?.addEventListener('input', () => UI.renderDraftPool(gameState, handlePlayerSelectInDraft));
        document.getElementById('draft-filter-pos')?.addEventListener('change', () => UI.renderDraftPool(gameState, handlePlayerSelectInDraft));
        document.getElementById('draft-sort')?.addEventListener('change', () => UI.renderDraftPool(gameState, handlePlayerSelectInDraft));
        
        document.getElementById('offense-formation-select')?.addEventListener('change', handleFormationChange);
        document.getElementById('defense-formation-select')?.addEventListener('change', handleFormationChange);
        
        document.getElementById('stats-filter-team')?.addEventListener('change', handleStatsChange);
        document.getElementById('stats-sort')?.addEventListener('change', handleStatsChange);

        // Setup
        UI.setupDragAndDrop(handleDepthChartDrop);
        UI.setupDepthChartTabs();

        UI.showScreen('startScreen');
    } catch (error) {
        console.error("Fatal error during initialization:", error);a
    }
}

document.addEventListener('DOMContentLoaded', main);

