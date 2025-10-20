import * as Game from './game.js';
import * as UI from './ui.js';
import { teamNames } from './data.js';

let currentlySelectedPlayerId = null;

// --- MAIN APPLICATION FLOW & EVENT HANDLERS ---

/**
 * Starts the entire game flow from the beginning.
 */
async function startNewGame() {
    try {
        UI.showScreen('loading');
        await new Promise(resolve => setTimeout(resolve, 50)); 
        
        await Game.initializeLeague(UI.updateLoadingProgress);
        
        UI.renderTeamCreation(teamNames, handlePremadeTeamClick);
        UI.showScreen('teamCreation');

    } catch (error) {
        console.error("Error starting game:", error);
    }
}

/**
 * Handles the click on a premade team name button.
 * @param {string} name - The name of the team that was clicked.
 */
function handlePremadeTeamClick(name) {
    const input = document.getElementById('team-name-input');
    if (input) {
        input.value = name;
    }
}

/**
 * Confirms the team name and moves to the draft screen.
 */
function handleConfirmTeamClick() {
    const input = document.getElementById('team-name-input');
    const teamName = input.value.trim();
    if (!teamName) {
        alert("Please enter or select a team name!");
        return;
    }

    Game.createPlayerTeam(teamName);
    Game.setupDraft();
    
    const game = Game.getGameState();
    UI.showScreen('draft');
    UI.renderDraftPool(game.players.filter(p => !p.teamId), handlePlayerCardClick);
    UI.updateRoster(game.playerTeam);
    
    runNextDraftPick();
}

/**
 * Handles a click on a player card in the draft pool.
 * @param {object} player - The player object associated with the clicked card.
 */
function handlePlayerCardClick(player) {
    currentlySelectedPlayerId = player.id;
    UI.renderPlayerDetailCard(player);
    UI.selectPlayerCard(player.id);
}


/**
 * Controls the flow of the draft, turn by turn.
 */
async function runNextDraftPick() {
    const game = Game.getGameState();
    const currentPickNumber = game.currentPick;
    
    // Check if draft is over
    if (currentPickNumber >= game.draftOrder.length) {
        console.log("Draft is complete!");
        Game.generateSchedule();
        startSeasonPhase();
        return;
    }

    const currentTeam = game.draftOrder[currentPickNumber];
    UI.updateDraftClock(currentTeam, currentPickNumber + 1);

    if (currentTeam.id === game.playerTeam.id) {
        // Player's turn
        UI.setDraftButtonState(true);
        console.log("Player is on the clock.");
    } else {
        // AI's turn
        UI.setDraftButtonState(false);
        console.log(`${currentTeam.name} is on the clock.`);
        
        // AI picks much faster now
        await new Promise(resolve => setTimeout(resolve, 200)); 

        const pickedPlayer = Game.simulateAIPick(currentTeam);
        if (pickedPlayer) {
            UI.addPickToLog(currentTeam, pickedPlayer, currentPickNumber + 1);
            UI.removePlayerCard(pickedPlayer.id);
        }
        
        game.currentPick++;
        runNextDraftPick(); // Proceed to the next pick
    }
}


/**
 * Handles the click event for the player drafting a player.
 */
function handleDraftClick() {
    if (!currentlySelectedPlayerId) {
        alert("Please select a player to draft!");
        return;
    }
    
    const game = Game.getGameState();
    const player = game.players.find(p => p.id === currentlySelectedPlayerId);
    
    if (player && Game.addPlayerToTeam(player, game.playerTeam)) {
        UI.updateRoster(game.playerTeam);
        UI.removePlayerCard(player.id);
        UI.addPickToLog(game.playerTeam, player, game.currentPick + 1);
        
        currentlySelectedPlayerId = null; // Reset selection
        
        game.currentPick++;
        runNextDraftPick(); // Proceed to next pick
    }
}


/**
 * Transitions the game from draft/off-season to the regular season.
 */
function startSeasonPhase() {
    const game = Game.getGameState();
    Game.generateWeeklyFreeAgents();
    UI.showScreen('season');
    UI.renderStandings(game.teams, game.divisions);
    UI.renderSchedule(game.schedule, game.currentWeek);
    UI.updateYourRoster(game.playerTeam);
    UI.updateSeasonHeader(game.currentWeek, game.year);
    game.teams.filter(t => t.id !== game.playerTeam.id).forEach(Game.aiManageRoster);
    UI.renderFreeAgents(game.freeAgents, handleFreeAgentSignClick);
}

/**
 * Handles the click event for simulating a week.
 */
function handleSimWeekClick() {
    const game = Game.getGameState();
    const results = Game.simulateWeek();
    if (results) {
        UI.renderWeeklyResults(results, game.currentWeek);
        UI.renderStandings(game.teams, game.divisions);
        UI.updateYourRoster(game.playerTeam);
    } else {
        UI.showScreen('endSeason');
        UI.updateEndSeasonUI(game.year);
    }
}

/**
 * Handles the click event for signing a free agent.
 * @param {Event} event - The click event from the free agent card.
 */
function handleFreeAgentSignClick(event) {
    const game = Game.getGameState();
    const playerCard = event.target.closest('.player-card');
    if (!playerCard) return;

    const player = game.freeAgents.find(p => p.id === playerCard.dataset.playerId);
    const chances = { 'Close Friend': 0.9, 'Friend': 0.6, 'Acquaintance': 0.3 };
    
    if (Math.random() < chances[player.friendship]) {
        if (game.playerTeam.roster.length < 10) {
            Game.addPlayerToTeam(player, game.playerTeam);
        } else {
            alert("Your roster is full! You need to drop a player to sign a friend.");
        }
    } else {
        alert(`${player.name} couldn't make it this week!`);
    }
    // Refresh the season phase to update UI after the transaction
    startSeasonPhase();
}

/**
 * Initiates the off-season and prepares for the next draft.
 */
async function startNextSeason() {
    UI.showScreen('loading');
    UI.updateLoadingProgress(0.25, "Aging players...");
    await Game.yieldToMain();
    
    Game.advanceToOffseason();
    
    UI.updateLoadingProgress(0.75, "Generating rookies...");
    await Game.yieldToMain();
    
    const game = Game.getGameState();
    Game.setupDraft(); // Set up the new draft order
    UI.updateLoadingProgress(1, "Done!");
    await new Promise(res => setTimeout(res, 500));
    
    currentlySelectedPlayerId = null; // Reset selection for new draft
    UI.showScreen('draft');
    UI.renderDraftPool(game.players.filter(p => !p.teamId), handlePlayerCardClick);
    UI.updateRoster(game.playerTeam);
    runNextDraftPick();
}

// --- INITIALIZATION ---
/**
 * Main function to set up the application once the DOM is ready.
 */
function main() {
    console.log("Game starting... Document loaded.");
    UI.setupElements();
    
    // Correctly get and assign event listeners
    const startGameBtn = document.getElementById('start-game-btn');
    const confirmTeamBtn = document.getElementById('confirm-team-btn');
    const draftBtn = document.getElementById('draft-player-btn');
    const simWeekBtn = document.getElementById('sim-week-btn');
    const nextSeasonBtn = document.getElementById('next-season-btn');

    if (startGameBtn) startGameBtn.addEventListener('click', startNewGame);
    if (confirmTeamBtn) confirmTeamBtn.addEventListener('click', handleConfirmTeamClick);
    if (draftBtn) draftBtn.addEventListener('click', handleDraftClick);
    if (simWeekBtn) simWeekBtn.addEventListener('click', handleSimWeekClick);
    if (nextSeasonBtn) nextSeasonBtn.addEventListener('click', startNextSeason);
    
    UI.showScreen('start');
}

// Start the game when the DOM is fully loaded and ready
document.addEventListener('DOMContentLoaded', main);

