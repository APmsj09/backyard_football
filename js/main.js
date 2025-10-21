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
    if (selectedPlayerId) {
        const player = gameState.players.find(p => p.id === selectedPlayerId);
        const team = Game.getGameState().playerTeam;
        if (Game.addPlayerToTeam(player, team)) {
            selectedPlayerId = null;
            gameState.currentPick++;
            UI.renderSelectedPlayerCard(null);
            runAIDraftPicks(); // This will re-render the draft screen
        } else {
            UI.showModal("Roster Full", "<p>Your roster is full! You cannot draft more players.</p>");
        }
    }
}

async function runAIDraftPicks() {
    // Initial check to see if the draft is over before doing anything.
    if (gameState.currentPick >= gameState.draftOrder.length) {
        handleDraftEnd();
        return;
    }

    UI.renderDraftScreen(gameState, handlePlayerSelectInDraft);

    let currentPickingTeam = gameState.draftOrder[gameState.currentPick];
    // This loop runs as long as it's an AI's turn
    while (currentPickingTeam.id !== gameState.playerTeam.id) {
        // Safeguard: Double-check if the draft ended during the loop.
        if (gameState.currentPick >= gameState.draftOrder.length) {
            handleDraftEnd();
            return;
        }

        await new Promise(resolve => setTimeout(resolve, 200));

        Game.simulateAIPick(currentPickingTeam);
        gameState.currentPick++;
        UI.renderDraftScreen(gameState, handlePlayerSelectInDraft);

        // Check again after the pick, in case that was the last one.
        if (gameState.currentPick >= gameState.draftOrder.length) {
            handleDraftEnd();
            return;
        }
        currentPickingTeam = gameState.draftOrder[gameState.currentPick];
    }
    // Loop ends, it's the player's turn again.
    UI.renderDraftScreen(gameState, handlePlayerSelectInDraft);
}


function handleDraftEnd() {
    UI.showModal("Draft Complete!", "<p>The draft has concluded. Get ready for the season!</p>");
    Game.generateSchedule();
    gameState = Game.getGameState();
    UI.renderDashboard(gameState);
    UI.switchTab('my-team', gameState); // Start on my-team tab
    UI.showScreen('dashboardScreen');
}

function handleTabSwitch(e) {
    if (e.target.matches('.tab-button')) {
        const tabId = e.target.dataset.tab;
        UI.switchTab(tabId, gameState);
    }
}

function handleDepthChartDrop(playerId, newPositionSlot) {
    Game.updateDepthChart(playerId, newPositionSlot);
    gameState = Game.getGameState();
    UI.switchTab('depth-chart', gameState);
}

async function handleAdvanceWeek() {
    const results = Game.simulateWeek();
    
    if (results) {
        // Show weekly results in a modal
        let resultsHtml = '<div class="space-y-2">';
        const playerGame = results.find(r => r.homeTeam.id === gameState.playerTeam.id || r.awayTeam.id === gameState.playerTeam.id);
        if(playerGame) {
             resultsHtml += `<p class="text-lg font-bold text-center">${playerGame.awayTeam.name} ${playerGame.awayScore} @ ${playerGame.homeTeam.name} ${playerGame.homeScore}</p><hr class="my-2">`;
        }
        results.forEach(r => {
            resultsHtml += `<p>${r.awayTeam.name} ${r.awayScore} @ ${r.homeTeam.name} ${r.homeScore}</p>`;
        });
        resultsHtml += '</div>';
        UI.showModal(`Week ${gameState.currentWeek} Results`, resultsHtml);

        // Update AI rosters after the week is simulated
        gameState.teams.filter(t => t.id !== gameState.playerTeam.id).forEach(Game.aiManageRoster);
        Game.generateWeeklyFreeAgents();

        // Update dashboard
        gameState = Game.getGameState();
        UI.renderDashboard(gameState);
        const activeTab = document.querySelector('.tab-button.active').dataset.tab;
        UI.switchTab(activeTab, gameState); // Re-render current tab
    } else {
        // Season is over, advance to offseason
        UI.showModal("Season Over", "<p>The regular season has concluded. Advancing to the offseason!</p>");
        Game.advanceToOffseason();
        gameState = Game.getGameState();

        // Go to next year's draft
        Game.setupDraft();
        gameState = Game.getGameState();
        selectedPlayerId = null;
        UI.renderSelectedPlayerCard(null);
        UI.renderDraftScreen(gameState, handlePlayerSelectInDraft);
        UI.showScreen('draftScreen');
        runAIDraftPicks();
    }
}

function handleDashboardClicks(e) {
    const target = e.target;
    if(target.matches('.cut-player-btn')) {
        const playerId = target.dataset.playerId;
        const player = gameState.playerTeam.roster.find(p => p.id === playerId);
        if(confirm(`Are you sure you want to cut ${player.name}? This cannot be undone.`)){
            Game.playerCut(playerId);
            gameState = Game.getGameState();
            const activeTab = document.querySelector('.tab-button.active').dataset.tab;
            UI.switchTab(activeTab, gameState);
        }
    } else if(target.matches('.sign-player-btn')) {
        const playerId = target.dataset.playerId;
        const result = Game.playerSignFreeAgent(playerId);
        if(!result.success) {
            UI.showModal("Roster Management", `<p>${result.message}</p>`);
        }
        gameState = Game.getGameState();
        UI.switchTab('free-agency', gameState);
        UI.switchTab('my-team', gameState); // Also refresh my-team
    }
}

function main() {
    console.log("Game starting... Document loaded.");
    try {
        UI.setupElements();
        
        document.getElementById('start-game-btn')?.addEventListener('click', startNewGame);
        document.getElementById('confirm-team-btn')?.addEventListener('click', handleConfirmTeam);
        document.getElementById('draft-player-btn')?.addEventListener('click', handleDraftPlayer);
        document.getElementById('dashboard-tabs')?.addEventListener('click', handleTabSwitch);
        document.getElementById('advance-week-btn')?.addEventListener('click', handleAdvanceWeek);
        document.getElementById('modal-close-btn')?.addEventListener('click', UI.hideModal);
        document.getElementById('dashboard-content')?.addEventListener('click', handleDashboardClicks);

        document.getElementById('draft-search')?.addEventListener('input', () => UI.renderDraftPool(gameState, handlePlayerSelectInDraft));
        document.getElementById('draft-filter-pos')?.addEventListener('change', () => UI.renderDraftPool(gameState, handlePlayerSelectInDraft));
        document.getElementById('draft-sort')?.addEventListener('change', () => UI.renderDraftPool(gameState, handlePlayerSelectInDraft));

        UI.setupDragAndDrop(handleDepthChartDrop);
        UI.setupDepthChartTabs();

        UI.showScreen('startScreen');
    } catch (error) {
        console.error("Fatal error during initialization:", error);
    }
}

document.addEventListener('DOMContentLoaded', main);

