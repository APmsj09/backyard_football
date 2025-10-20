import * as Game from './game.js';
import * as UI from './ui.js';

// --- MAIN APPLICATION FLOW & EVENT HANDLERS ---

/**
 * Starts the entire game flow from the beginning.
 */
async function startNewGame() {
    try {
        UI.showScreen('loading');
        // This tiny delay forces the browser to render the loading screen before starting heavy work.
        await new Promise(resolve => setTimeout(resolve, 50)); 
        
        await Game.initializeLeague(UI.updateLoadingProgress);
        Game.setupDraft();
        
        const game = Game.getGameState();
        UI.showScreen('draft');
        UI.renderDraftPool(game.players.filter(p => !p.teamId));
        UI.updateRoster(game.playerTeam);
        
        runNextDraftPick();

    } catch (error) {
        console.error("Error starting game:", error);
    }
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
        
        // Add a delay for suspense
        await new Promise(resolve => setTimeout(resolve, 1500)); 

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
    const game = Game.getGameState();
    const playerPoolContainer = document.getElementById('player-pool');
    const selectedCard = playerPoolContainer.querySelector('.player-card.selected');
    
    if (selectedCard) {
        const player = game.players.find(p => p.id === selectedCard.dataset.playerId);
        
        if (Game.addPlayerToTeam(player, game.playerTeam)) {
            UI.updateRoster(game.playerTeam);
            UI.removePlayerCard(player.id);
            UI.addPickToLog(game.playerTeam, player, game.currentPick + 1);
            
            game.currentPick++;
            runNextDraftPick(); // Proceed to next pick
        }
    } else {
        alert("Please select a player to draft!");
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
    
    UI.showScreen('draft');
    UI.renderDraftPool(game.players.filter(p => !p.teamId));
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
    const draftBtn = document.getElementById('draft-player-btn');
    const simWeekBtn = document.getElementById('sim-week-btn');
    const nextSeasonBtn = document.getElementById('next-season-btn');

    if (startGameBtn) {
        startGameBtn.addEventListener('click', startNewGame);
    } else {
        console.error("Fatal Error: Start button with ID 'start-game-btn' not found on page load.");
        return;
    }
    
    if(draftBtn) draftBtn.addEventListener('click', handleDraftClick);
    if(simWeekBtn) simWeekBtn.addEventListener('click', handleSimWeekClick);
    if(nextSeasonBtn) nextSeasonBtn.addEventListener('click', startNextSeason);
    
    UI.showScreen('start');
}

// Start the game when the DOM is fully loaded and ready
document.addEventListener('DOMContentLoaded', main);

