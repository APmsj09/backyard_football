import * as Game from './game.js';
import * as UI from './ui.js';

// --- State ---
let selectedPlayerId = null;

// --- Game Flow Functions ---

async function startNewGame() {
    try {
        UI.showScreen('loadingScreen');
        // Add a tiny delay to ensure the browser renders the loading screen
        await new Promise(resolve => setTimeout(resolve, 50));
        
        await Game.initializeLeague(UI.updateLoadingProgress);
        
        const suggestions = ['Rockets', 'Sharks', 'Tigers', 'Comets', 'Jets'];
        UI.renderTeamNameSuggestions(suggestions, (name) => {
            document.getElementById('custom-team-name').value = name;
        });

        UI.showScreen('teamCreationScreen');
    } catch (error) {
        console.error("Error starting new game:", error);
    }
}

function handleTeamCreation() {
    const customName = document.getElementById('custom-team-name').value;
    if (customName.trim() === '') {
        alert("Please enter a team name.");
        return;
    }
    Game.createPlayerTeam(customName);
    Game.setupDraft();
    startDraft();
}

function startDraft() {
    const gameState = Game.getGameState();
    if (gameState.currentPick >= gameState.draftOrder.length) {
        finishDraft();
        return;
    }

    UI.showScreen('draftScreen');
    UI.renderDraftScreen(gameState, handlePlayerSelect);

    const pickingTeam = gameState.draftOrder[gameState.currentPick];
    if (pickingTeam.id !== gameState.playerTeam.id) {
        // AI's turn
        setTimeout(() => {
            Game.simulateAIPick(pickingTeam);
            gameState.currentPick++;
            startDraft(); // Move to the next pick
        }, 1000); // 1-second delay for AI picks
    }
    // If it's the player's turn, we wait for their action.
}

function handlePlayerSelect(playerId) {
    selectedPlayerId = playerId;
    const player = Game.getGameState().players.find(p => p.id === playerId);
    UI.renderSelectedPlayerCard(player);
    UI.renderDraftPool(Game.getGameState(), handlePlayerSelect); // Re-render to show selection
}

function handleDraftPlayer() {
    const gameState = Game.getGameState();
    const pickingTeam = gameState.draftOrder[gameState.currentPick];

    if (selectedPlayerId && pickingTeam.id === gameState.playerTeam.id) {
        const player = gameState.players.find(p => p.id === selectedPlayerId);
        Game.addPlayerToTeam(player, gameState.playerTeam);
        selectedPlayerId = null;
        UI.renderSelectedPlayerCard(null);
        gameState.currentPick++;
        startDraft();
    }
}

function finishDraft() {
    Game.generateSchedule();
    const gameState = Game.getGameState();
    UI.showScreen('dashboardScreen');
    UI.renderDashboard(gameState);
    UI.switchTab('my-team', gameState);
}


// --- Event Handlers ---

function setupEventListeners() {
    // Start Screen
    document.getElementById('start-game-btn').addEventListener('click', startNewGame);
    
    // Team Creation Screen
    document.getElementById('confirm-team-btn').addEventListener('click', handleTeamCreation);

    // Draft Screen
    document.getElementById('draft-player-btn').addEventListener('click', handleDraftPlayer);
    document.getElementById('draft-search').addEventListener('input', () => UI.renderDraftPool(Game.getGameState(), handlePlayerSelect));
    document.getElementById('draft-filter-pos').addEventListener('change', () => UI.renderDraftPool(Game.getGameState(), handlePlayerSelect));
    document.getElementById('draft-sort').addEventListener('change', () => UI.renderDraftPool(Game.getGameState(), handlePlayerSelect));


    // Dashboard
    document.getElementById('dashboard-tabs').addEventListener('click', (e) => {
        if (e.target.matches('.tab-button')) {
            UI.switchTab(e.target.dataset.tab, Game.getGameState());
        }
    });

    UI.setupDragAndDrop((playerId, newPositionSlot) => {
        Game.updateDepthChart(playerId, newPositionSlot);
        UI.switchTab('depth-chart', Game.getGameState()); // Re-render the tab
    });
    
    // Set up listeners for the new Offense/Defense tabs
    UI.setupDepthChartTabs();
}


// --- Initialization ---

function main() {
    console.log("Game starting... Document loaded.");
    // This is the critical change: setupElements() MUST be called before any other UI function.
    UI.setupElements();
    
    // Now that elements are ready, we can set up listeners and show the first screen.
    setupEventListeners();
    UI.showScreen('startScreen');
}

// Start the game when the DOM is ready
document.addEventListener('DOMContentLoaded', main);

