import * as Game from './game.js';
import * as UI from './ui.js';

let gameState = null;
let selectedPlayerId = null;

// --- Event Handlers ---

/**
 * Starts the entire game flow. Shows loading screen, initializes league.
 */
async function startNewGame() {
    try {
        UI.showScreen('loadingScreen');
        // A small delay to ensure the UI updates before the heavy lifting begins.
        await new Promise(resolve => setTimeout(resolve, 50)); 
        await Game.initializeLeague(UI.updateLoadingProgress);
        gameState = Game.getGameState();
        UI.renderTeamNameSuggestions(['Jets', 'Sharks', 'Tigers', 'Bulldogs', 'Panthers', 'Giants'], handleTeamNameSelection);
        UI.showScreen('teamCreationScreen');
    } catch (error) {
        console.error("Error starting game:", error);
    }
}

/**
 * Handles the selection of a suggested team name.
 * @param {string} name - The selected team name.
 */
function handleTeamNameSelection(name) {
    UI.elements.customTeamName.value = name;
}

/**
 * Finalizes team creation and moves to the draft.
 */
function handleConfirmTeam() {
    const customName = UI.elements.customTeamName.value.trim();
    if (customName) {
        Game.createPlayerTeam(customName);
        Game.setupDraft();
        gameState = Game.getGameState();
        UI.renderSelectedPlayerCard(null);
        UI.renderDraftScreen(gameState, handlePlayerSelectInDraft);
        UI.showScreen('draftScreen');
        runAIDraftPicks(); 
    } else {
        alert("Please enter or select a team name.");
    }
}

/**
 * Handles a player being selected from the draft pool table.
 * @param {string} playerId - The ID of the selected player.
 */
function handlePlayerSelectInDraft(playerId) {
    selectedPlayerId = playerId;
    const player = gameState.players.find(p => p.id === playerId);
    UI.updateSelectedPlayerRow(playerId);
    UI.renderSelectedPlayerCard(player);
    UI.elements.draftPlayerBtn.disabled = false;
}

/**
 * Handles the player clicking the "Draft Player" button.
 */
function handleDraftPlayer() {
    if (selectedPlayerId) {
        const player = gameState.players.find(p => p.id === selectedPlayerId);
        const team = Game.getGameState().playerTeam;
        if (Game.addPlayerToTeam(player, team)) {
            selectedPlayerId = null;
            gameState.currentPick++;
            UI.renderSelectedPlayerCard(null);
            UI.renderDraftScreen(gameState, handlePlayerSelectInDraft);
            runAIDraftPicks();
        } else {
            alert("Your roster is full!");
        }
    }
}

/**
 * Manages the draft flow, simulating AI picks until it's the player's turn.
 */
async function runAIDraftPicks() {
    if (gameState.currentPick >= gameState.draftOrder.length) {
        handleDraftEnd();
        return;
    }

    let currentPickingTeam = gameState.draftOrder[gameState.currentPick];
    while (currentPickingTeam.id !== gameState.playerTeam.id) {
        UI.renderDraftScreen(gameState, handlePlayerSelectInDraft);
        await new Promise(resolve => setTimeout(resolve, 200)); // Short delay for effect

        Game.simulateAIPick(currentPickingTeam);
        gameState.currentPick++;

        if (gameState.currentPick >= gameState.draftOrder.length) {
            handleDraftEnd();
            return;
        }
        currentPickingTeam = gameState.draftOrder[gameState.currentPick];
    }
    // It's now the player's turn
    UI.renderDraftScreen(gameState, handlePlayerSelectInDraft);
}

/**
 * Finalizes the draft and moves to the main dashboard.
 */
function handleDraftEnd() {
    alert("The draft is complete!");
    Game.generateSchedule();
    gameState = Game.getGameState();
    UI.renderDashboard(gameState);
    UI.showScreen('dashboardScreen');
}


/**
 * Handles clicks on the main dashboard tabs.
 * @param {Event} e - The click event.
 */
function handleTabSwitch(e) {
    if (e.target.matches('.tab-button')) {
        const tabId = e.target.dataset.tab;
        UI.switchTab(tabId, gameState);
    }
}

/**
 * Handles dropping a player onto a depth chart slot.
 * @param {string} playerId - The ID of the player being dropped.
 * @param {string} newPositionSlot - The position slot they are dropped onto.
 */
function handleDepthChartDrop(playerId, newPositionSlot) {
    Game.updateDepthChart(playerId, newPositionSlot);
    gameState = Game.getGameState();
    UI.switchTab('depth-chart', gameState); // Re-render the depth chart
}

// --- Initialization ---

/**
 * The main function to set up the application.
 */
function main() {
    console.log("Game starting... Document loaded.");
    try {
        UI.setupElements();
        
        // Setup initial event listeners
        document.getElementById('start-game-btn')?.addEventListener('click', startNewGame);
        UI.elements.confirmTeamBtn?.addEventListener('click', handleConfirmTeam);
        UI.elements.draftPlayerBtn?.addEventListener('click', handleDraftPlayer);
        UI.elements.dashboardTabs?.addEventListener('click', handleTabSwitch);

        // Draft filtering/sorting listeners
        UI.elements.draftSearch?.addEventListener('input', () => UI.renderDraftPool(gameState, handlePlayerSelectInDraft));
        UI.elements.draftFilterPos?.addEventListener('change', () => UI.renderDraftPool(gameState, handlePlayerSelectInDraft));
        UI.elements.draftSort?.addEventListener('change', () => UI.renderDraftPool(gameState, handlePlayerSelectInDraft));

        UI.setupDragAndDrop(handleDepthChartDrop);
        UI.setupDepthChartTabs();

        UI.showScreen('startScreen');
    } catch (error) {
        console.error("Fatal error during initialization:", error);
    }
}

// Start the game when the DOM is ready
document.addEventListener('DOMContentLoaded', main);

