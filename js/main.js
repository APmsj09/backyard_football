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
        // Maybe show an error message to the user
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
        // Draft needs are set during offseason, initialize to 10 for first draft
        gameState = Game.getGameState();
        gameState.teams.forEach(t => t.draftNeeds = 10);
        Game.setupDraft();
        gameState = Game.getGameState(); // Get state again after setup
        UI.renderSelectedPlayerCard(null);
        UI.renderDraftScreen(gameState, handlePlayerSelectInDraft);
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
    UI.renderSelectedPlayerCard(player);
}

function handleDraftPlayer() {
    const team = Game.getGameState().playerTeam;
    if (selectedPlayerId && team.roster.length < 10) {
        const player = gameState.players.find(p => p.id === selectedPlayerId);
        if (Game.addPlayerToTeam(player, team)) {
            selectedPlayerId = null;
            gameState.currentPick++;
            UI.renderSelectedPlayerCard(null);
            runAIDraftPicks(); // Proceed to next pick
        } else {
            // This case should ideally not happen due to the check above, but as failsafe:
            UI.showModal("Error", "<p>Could not draft player.</p>");
        }
    } else if (team.roster.length >= 10) {
         UI.showModal("Roster Full", "<p>Your roster is full! You cannot draft more players.</p>");
    }
}

/**
 * Manages the draft flow, handling AI picks and player picks.
 */
async function runAIDraftPicks() {
    gameState = Game.getGameState(); // Ensure we have the latest state
    const undraftedPlayers = gameState.players.filter(p => !p.teamId);
    const maxPicksPossible = gameState.draftOrder.length; // Total slots in the draft order

    // Loop continues as long as there are picks left in the order AND players available
    while (gameState.currentPick < maxPicksPossible && undraftedPlayers.length > 0) {
        
        // Check if draft should end (e.g., all teams full) - More robust check might be needed
        const needsMorePlayers = gameState.teams.some(t => t.roster.length < 10);
        if (!needsMorePlayers && undraftedPlayers.length > 0) {
             console.log("All teams have full rosters. Ending draft early.");
             break; // Exit loop if all rosters are full
        }

        const currentPickingTeam = gameState.draftOrder[gameState.currentPick];

        if (currentPickingTeam.id !== gameState.playerTeam.id) {
            // AI's turn
             UI.renderDraftScreen(gameState, handlePlayerSelectInDraft); // Update UI to show who's picking
            await new Promise(resolve => setTimeout(resolve, 100)); // Short delay

            if (currentPickingTeam.roster.length < 10) {
                Game.simulateAIPick(currentPickingTeam);
            } else {
                 console.log(`${currentPickingTeam.name} skips pick (roster full).`);
            }
            gameState.currentPick++;
            // Re-fetch undrafted players count for the loop condition
            undraftedPlayers.length = gameState.players.filter(p => !p.teamId).length;
        } else {
            // Player's turn
            if (gameState.playerTeam.roster.length < 10) {
                 UI.renderDraftScreen(gameState, handlePlayerSelectInDraft); // Update UI for player pick
                return; // Wait for player input
            } else {
                 console.log("Player roster full, skipping pick.");
                 gameState.currentPick++; // Skip player pick if roster is full
            }
        }
    }

    // If the loop finishes, the draft is over
    handleDraftEnd();
}


function handleDraftEnd() {
    UI.showModal("Draft Complete!", "<p>The draft has concluded. Finalizing rosters and generating schedule!</p>");
    gameState.teams.forEach(team => {
        Game.aiSetDepthChart(team); // Set initial depth charts
    });
    Game.generateSchedule();
    gameState = Game.getGameState();
    UI.renderDashboard(gameState);
    UI.switchTab('my-team', gameState);
    UI.showScreen('dashboardScreen');
    checkForNewMessages();
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
    UI.switchTab('depth-chart', gameState); // Re-render depth chart
}

function handleFormationChange(e) {
    const side = e.target.id.includes('offense') ? 'offense' : 'defense';
    const formationName = e.target.value;
    Game.changeFormation(side, formationName);
    gameState = Game.getGameState();
    UI.switchTab('depth-chart', gameState); // Re-render depth chart
}

async function handleAdvanceWeek() {
    const results = Game.simulateWeek();

    if (results) {
        const playerGame = results.find(r => r.homeTeam.id === gameState.playerTeam.id || r.awayTeam.id === gameState.playerTeam.id);
        const playerTeamResult = playerGame ? (playerGame.homeTeam.id === gameState.playerTeam.id ? (playerGame.homeScore > playerGame.awayScore ? 'W' : 'L') : (playerGame.awayScore > playerGame.homeScore ? 'W' : 'L')) : '';
        const breakthroughs = Game.getBreakthroughs();

        let resultsHtml = '';
        if (playerGame) {
            resultsHtml += `<div class="text-center mb-4">
                <p class="text-2xl font-bold">${playerGame.awayTeam.name} ${playerGame.awayScore} @ ${playerGame.homeTeam.name} ${playerGame.homeScore} <span class="text-${playerTeamResult === 'W' ? 'green' : 'red'}-500">(${playerTeamResult})</span></p>
            </div>
            <h4 class="font-bold mb-2">Game Log</h4>
            <div class="game-log bg-gray-100 p-2 rounded h-48 overflow-y-auto text-sm">
                ${playerGame.gameLog.join('<br>')}
            </div>
            `;
        }
        if (breakthroughs.length > 0) {
            resultsHtml += `<h4 class="font-bold mt-4 mb-2">Player Breakthroughs!</h4><div class="space-y-1 text-sm">`;
            breakthroughs.forEach(b => {
                 resultsHtml += `<p><strong>${b.player.name}</strong> had a great game and improved their <strong>${b.attr}</strong>!</p>`;
            });
            resultsHtml += `</div>`;
        }
        
        UI.showModal(`Week ${gameState.currentWeek} Results`, resultsHtml);

        gameState.teams.filter(t => t.id !== gameState.playerTeam.id).forEach(Game.aiManageRoster);
        Game.generateWeeklyFreeAgents();

        gameState = Game.getGameState();
        UI.renderDashboard(gameState);
        const activeTab = document.querySelector('.tab-button.active')?.dataset.tab || 'my-team';
        UI.switchTab(activeTab, gameState);
        checkForNewMessages(); // Check for messages (injuries etc.)
    } else {
        // Season is over, advance to offseason screen
        gameState = Game.getGameState(); 
        const offseasonReport = Game.advanceToOffseason();
        UI.renderOffseasonScreen(offseasonReport, gameState.year);
        UI.showScreen('offseasonScreen');
        checkForNewMessages(); // Check for offseason messages
    }
}

function handleGoToNextDraft() {
    Game.setupDraft();
    gameState = Game.getGameState();
    selectedPlayerId = null;
    UI.renderSelectedPlayerCard(null);
    UI.renderDraftScreen(gameState, handlePlayerSelectInDraft);
    UI.showScreen('draftScreen');
    runAIDraftPicks();
}

function handleDashboardClicks(e) {
    const target = e.target;
    if (target.matches('.call-friend-btn')) {
        const playerId = target.dataset.playerId;
        const result = Game.callFriend(playerId);
        UI.showModal("Calling a Friend...", `<p>${result.message}</p>`);
        gameState = Game.getGameState();
        // Refresh relevant tabs
        const activeTab = document.querySelector('.tab-button.active')?.dataset.tab || 'my-team';
        if (activeTab === 'my-team') {
            UI.switchTab('my-team', gameState);
        } else {
             UI.switchTab(activeTab, gameState); // Refresh current
             // Potentially force refresh My Team in background if needed later
        }
         checkForNewMessages();
    }
}

function handleStatsChange() {
    UI.switchTab('player-stats', gameState); // Just re-render the stats tab
}

function checkForNewMessages() {
    gameState = Game.getGameState(); // Ensure latest state
    if (gameState.messages.some(msg => !msg.isRead)) {
        UI.updateMessagesNotification(gameState.messages);
    }
}

function main() {
    console.log("Game starting... Document loaded.");
    try {
        UI.setupElements();

        // --- Core Button Listeners ---
        document.getElementById('start-game-btn')?.addEventListener('click', startNewGame);
        document.getElementById('confirm-team-btn')?.addEventListener('click', handleConfirmTeam);
        document.getElementById('draft-player-btn')?.addEventListener('click', handleDraftPlayer);
        document.getElementById('advance-week-btn')?.addEventListener('click', handleAdvanceWeek);
        document.getElementById('go-to-next-draft-btn')?.addEventListener('click', handleGoToNextDraft);
        
        // --- Tab Navigation ---
        document.getElementById('dashboard-tabs')?.addEventListener('click', handleTabSwitch);

        // --- Dynamic Content Interactions ---
        document.getElementById('dashboard-content')?.addEventListener('click', handleDashboardClicks); // Handles call friend etc.

        // --- Filter/Sort Listeners ---
        document.getElementById('draft-search')?.addEventListener('input', () => UI.renderDraftPool(gameState, handlePlayerSelectInDraft));
        document.getElementById('draft-filter-pos')?.addEventListener('change', () => UI.renderDraftPool(gameState, handlePlayerSelectInDraft));
        document.getElementById('draft-sort')?.addEventListener('change', () => UI.renderDraftPool(gameState, handlePlayerSelectInDraft));
        document.getElementById('stats-filter-team')?.addEventListener('change', handleStatsChange);
        document.getElementById('stats-sort')?.addEventListener('change', handleStatsChange);
        
        // --- Formation Selection ---
        document.getElementById('offense-formation-select')?.addEventListener('change', handleFormationChange);
        document.getElementById('defense-formation-select')?.addEventListener('change', handleFormationChange);

        // --- Drag & Drop ---
        UI.setupDragAndDrop(handleDepthChartDrop);
        UI.setupDepthChartTabs();

        // --- Initial Screen ---
        UI.showScreen('startScreen');
    } catch (error) {
        console.error("Fatal error during initialization:", error);
        alert("A critical error occurred during startup. Please check the console (F12) for details.");
    }
}

// Start the game when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', main);

