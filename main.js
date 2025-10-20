// js/main.js - The entry point of the application. Handles UI events and game flow.

import * as Game from './game.js';
import * as UI from './ui.js';

// --- Event Handlers ---

function handleStartClick() {
    console.log("Start new game button clicked.");
    startNewGame();
}

function handleDraftClick(event) {
    console.log("Draft button clicked.");
    const selectedPlayerCard = document.querySelector('.player-card.selected');
    if (selectedPlayerCard) {
        const playerId = selectedPlayerCard.dataset.playerId;
        const player = Game.getGameState().players.find(p => p.id === playerId);
        const playerTeam = Game.getGameState().playerTeam;

        const success = Game.addPlayerToTeam(player, playerTeam);
        if (success) {
            UI.updateRoster(playerTeam);
            UI.removePlayerCard(playerId);
            UI.updateDraftUI();

            // Check if player's draft is complete
            if (playerTeam.roster.length >= 10) {
                 console.log("Player draft complete. Starting season.");
                 // This was changed to go to the team review screen first.
                 UI.showScreen('team-screen');
                 UI.renderFinalTeam(playerTeam);
            }
        } else {
            // Handle roster full case if needed
            console.log("Roster is full.");
        }
    }
}

function handleSimWeekClick() {
    console.log("Simulate week button clicked.");
    const results = Game.simulateWeek();
    if (results) {
        UI.renderWeeklyResults(results, Game.getGameState().currentWeek);
        UI.renderStandings(Game.getGameState().teams, Game.getGameState().divisions);
        UI.updateYourRoster(Game.getGameState().playerTeam); // Update roster to show new stats
    } else {
        console.log("Season is over.");
        // This logic is now handled by the UI rendering.
        UI.showSeasonEnd(Game.getGameState().teams);
    }
}


function handleFreeAgentSignClick(event) {
    const playerCard = event.target.closest('.player-card');
    if (!playerCard) return;

    const playerId = playerCard.dataset.playerId;
    const player = Game.getGameState().freeAgents.find(p => p.id === playerId);
    const playerTeam = Game.getGameState().playerTeam;

    // Friendship logic
    const friendshipChances = {
        'Close Friend': 0.9,
        'Friend': 0.6,
        'Acquaintance': 0.3
    };

    if (Math.random() < friendshipChances[player.friendship]) {
        if (playerTeam.roster.length < 10) {
            Game.addPlayerToTeam(player, playerTeam);
            console.log(`Successfully signed ${player.name}`);
            UI.showNotification(`${player.name} joined for the week!`);
            startSeasonPhase(); // Move to the next phase
        } else {
            // In a real game, you'd show a "roster full" message or allow cuts.
            console.log("Roster full, can't sign player.");
            alert("Your roster is full! You need to cut a player first."); // Simple alert for now
        }
    } else {
        console.log(`${player.name} was busy and couldn't play.`);
        UI.showNotification(`${player.name} was busy and couldn't make it.`, 'error');
        startSeasonPhase(); // Move to the next phase even if signing fails
    }
}

function handleStartSeasonClick() {
    console.log("Start The Season button clicked.");
    Game.generateSchedule();
    startSeasonPhase();
}

function handleNextSeasonClick() {
    console.log("Starting next season...");
    startNextSeason();
}


// --- Game Flow Functions ---

async function startNewGame() {
    try {
        UI.showScreen('loading-screen');
        await Game.initializeLeague(UI.updateLoadingProgress);

        const gameState = Game.getGameState();
        if (!gameState) {
            throw new Error("Game state failed to initialize.");
        }

        UI.showScreen('draft-screen');
        UI.renderDraftPool(gameState.players.filter(p => !p.teamId));
        UI.updateRoster(gameState.playerTeam);
        UI.updateDraftUI(gameState.playerTeam);
    } catch (error) {
        console.error("CRITICAL ERROR starting game:", error);
        alert("A critical error occurred. Please check the console (F12) for details and ensure you are running this on a local server.");
    }
}

function startSeasonPhase() {
    Game.generateWeeklyFreeAgents();
    UI.showScreen('season-screen');
    UI.renderStandings(Game.getGameState().teams, Game.getGameState().divisions);
    UI.renderSchedule(Game.getGameState().schedule, Game.getGameState().currentWeek);
    UI.updateYourRoster(Game.getGameState().playerTeam);
    UI.updateSeasonHeader(Game.getGameState().currentWeek, Game.getGameState().year);

    // AI teams manage their rosters automatically
    const aiTeams = Game.getGameState().teams.filter(t => t.id !== Game.getGameState().playerTeam.id);
    aiTeams.forEach(team => Game.aiManageRoster(team));

    // After AI moves, refresh the free agent pool for the player
    UI.renderFreeAgents(Game.getGameState().freeAgents, handleFreeAgentSignClick);
}

async function startNextSeason() {
    UI.showScreen('loading-screen');
    // A simplified progress for the offseason
    UI.updateLoadingProgress(0.25, "Aging players...");
    await new Promise(res => setTimeout(res, 200));
    Game.advanceToOffseason();
    UI.updateLoadingProgress(0.75, "Generating rookies...");
    await new Promise(res => setTimeout(res, 200));

    UI.updateLoadingProgress(1, "Done!");
    await new Promise(res => setTimeout(res, 500));
    
    // Go to the draft for the new season
    UI.showScreen('draft-screen');
    UI.renderDraftPool(Game.getGameState().players.filter(p => !p.teamId));
    UI.updateRoster(Game.getGameState().playerTeam);
    UI.updateDraftUI(Game.getGameState().playerTeam);
}


// --- Initialization ---

function main() {
    console.log("Game starting... Document loaded.");
    // More direct event listener setup for key buttons
    const startGameBtn = document.getElementById('start-game-btn');
    if (startGameBtn) {
        startGameBtn.addEventListener('click', handleStartClick);
    } else {
        console.error("#start-game-btn not found!");
    }

    const startSeasonBtn = document.getElementById('start-season-btn');
     if (startSeasonBtn) {
        startSeasonBtn.addEventListener('click', handleStartSeasonClick);
    } else {
        console.error("#start-season-btn not found!");
    }


    // Defensive check to ensure UI is ready
    if (!UI.isReady()) {
         console.error("UI elements not found. Make sure your HTML IDs match the ones in ui.js.");
         return;
    }
    UI.setupEventListeners({
        onDraftClick: handleDraftClick,
        onSimWeekClick: handleSimWeekClick,
        onNextSeasonClick: handleNextSeasonClick
    });
    UI.showScreen('start-screen');
}

// Start the game when the DOM is ready
document.addEventListener('DOMContentLoaded', main);

