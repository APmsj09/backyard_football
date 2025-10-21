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
            runAIDraftPicks();
        } else {
            UI.showModal("Roster Full", "<p>Your roster is full! You cannot draft more players.</p>");
        }
    }
}

async function runAIDraftPicks() {
    const checkDraftEnd = () => {
        if (gameState.currentPick >= gameState.draftOrder.length) {
            handleDraftEnd();
            return true;
        }
        return false;
    };

    if (checkDraftEnd()) return;
    
    while (gameState.draftOrder[gameState.currentPick].id !== gameState.playerTeam.id) {
        UI.renderDraftScreen(gameState, handlePlayerSelectInDraft);
        await new Promise(resolve => setTimeout(resolve, 100));

        const currentPickingTeam = gameState.draftOrder[gameState.currentPick];
        Game.simulateAIPick(currentPickingTeam);
        gameState.currentPick++;

        if (checkDraftEnd()) return;
    }

    UI.renderDraftScreen(gameState, handlePlayerSelectInDraft);
}


function handleDraftEnd() {
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
    UI.switchTab('depth-chart', gameState);
}

function handleFormationChange(e) {
    const side = e.target.id.includes('offense') ? 'offense' : 'defense';
    const formationName = e.target.value;
    Game.changeFormation(side, formationName);
    gameState = Game.getGameState();
    UI.switchTab('depth-chart', gameState);
}

async function handleAdvanceWeek() {
    const results = Game.simulateWeek();

    if (results) {
        const playerGame = results.find(r => r.homeTeam.id === gameState.playerTeam.id || r.awayTeam.id === gameState.playerTeam.id);
        
        let resultsHtml = '';
        if (playerGame) {
            resultsHtml += `<div class="text-center mb-4">
                <p class="text-2xl font-bold">${playerGame.awayTeam.name} ${playerGame.awayScore} @ ${playerGame.homeTeam.name} ${playerGame.homeScore}</p>
            </div>
            <h4 class="font-bold mb-2">Game Log</h4>
            <div class="game-log bg-gray-100 p-2 rounded h-48 overflow-y-auto text-sm">
                ${playerGame.gameLog.join('<br>')}
            </div>
            `;
        }
        
        UI.showModal(`Week ${gameState.currentWeek} Results`, resultsHtml);

        gameState.teams.filter(t => t.id !== gameState.playerTeam.id).forEach(Game.aiManageRoster);
        Game.generateWeeklyFreeAgents();

        gameState = Game.getGameState();
        UI.renderDashboard(gameState);
        const activeTab = document.querySelector('.tab-button.active').dataset.tab;
        UI.switchTab(activeTab, gameState);
    } else {
        UI.showModal("Season Over", "<p>The regular season has concluded. Advancing to the offseason!</p>");
        Game.advanceToOffseason();
        gameState = Game.getGameState();

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
    if (target.matches('.call-friend-btn')) {
        const playerId = target.dataset.playerId;
        const result = Game.callFriend(playerId);
        UI.showModal("Calling a Friend...", `<p>${result.message}</p>`);
        gameState = Game.getGameState();
        UI.switchTab('free-agency', gameState);
        UI.switchTab('my-team', gameState);
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
        document.getElementById('dashboard-content')?.addEventListener('click', handleDashboardClicks);

        document.getElementById('draft-search')?.addEventListener('input', () => UI.renderDraftPool(gameState, handlePlayerSelectInDraft));
        document.getElementById('draft-filter-pos')?.addEventListener('change', () => UI.renderDraftPool(gameState, handlePlayerSelectInDraft));
        document.getElementById('draft-sort')?.addEventListener('change', () => UI.renderDraftPool(gameState, handlePlayerSelectInDraft));
        
        document.getElementById('offense-formation-select')?.addEventListener('change', handleFormationChange);
        document.getElementById('defense-formation-select')?.addEventListener('change', handleFormationChange);


        UI.setupDragAndDrop(handleDepthChartDrop);
        UI.setupDepthChartTabs();

        UI.showScreen('startScreen');
    } catch (error) {
        console.error("Fatal error during initialization:", error);
    }
}

document.addEventListener('DOMContentLoaded', main);

