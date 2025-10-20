import * as Game from './game.js';
import * as UI from './ui.js';
import { teamNames } from './data.js';

let currentlySelectedPlayerId = null;
let draggedPlayerId = null;

// --- MAIN APPLICATION FLOW & EVENT HANDLERS ---

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

function handlePremadeTeamClick(name) {
    const input = document.getElementById('team-name-input');
    if (input) input.value = name;
}

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
    UI.renderDraftPool(game.players.filter(p => !p.teamId), handlePlayerRowClick);
    UI.updateDraftRoster(game.playerTeam);
    runNextDraftPick();
}

function handlePlayerRowClick(playerId) {
    currentlySelectedPlayerId = playerId;
    UI.selectPlayerRow(playerId);
}

async function runNextDraftPick() {
    const game = Game.getGameState();
    const currentPickNumber = game.currentPick;
    
    if (currentPickNumber >= game.draftOrder.length) {
        console.log("Draft is complete!");
        startSeasonPhase();
        return;
    }

    const currentTeam = game.draftOrder[currentPickNumber];
    UI.updateDraftClock(currentTeam, currentPickNumber + 1);

    if (currentTeam.id === game.playerTeam.id) {
        UI.setDraftButtonState(true);
    } else {
        UI.setDraftButtonState(false);
        await new Promise(resolve => setTimeout(resolve, 100));
        const pickedPlayer = Game.simulateAIPick(currentTeam);
        if (pickedPlayer) {
            UI.addPickToLog(currentTeam, pickedPlayer, currentPickNumber + 1);
            UI.removePlayerRow(pickedPlayer.id);
        }
        game.currentPick++;
        runNextDraftPick();
    }
}

function handleDraftClick() {
    if (!currentlySelectedPlayerId) {
        alert("Please select a player to draft!");
        return;
    }
    const game = Game.getGameState();
    const player = game.players.find(p => p.id === currentlySelectedPlayerId);
    if (player && Game.addPlayerToTeam(player, game.playerTeam)) {
        UI.updateDraftRoster(game.playerTeam);
        UI.removePlayerRow(player.id);
        UI.addPickToLog(game.playerTeam, player, game.currentPick + 1);
        currentlySelectedPlayerId = null;
        game.currentPick++;
        runNextDraftPick();
    } else {
        alert("Your roster is full!");
    }
}

function updateAllTabs() {
    const game = Game.getGameState();
    UI.renderMyTeam(game.playerTeam, game.schedule, game.currentWeek);
    UI.renderRoster(game.playerTeam);
    UI.renderDepthChart(game.playerTeam, game.players, { dragStart: handleDragStart, dragOver: handleDragOver, drop: handleDrop });
    UI.renderFreeAgency(game.freeAgents, handleFreeAgentSignClick);
    UI.renderSchedule(game.schedule, game.currentWeek);
    UI.renderStandings(game.teams, game.divisions);
    UI.renderPlayerStats(game.players);
    UI.renderHallOfFame(game.hallOfFame);
}

function startSeasonPhase() {
    Game.generateSchedule();
    Game.generateWeeklyFreeAgents();
    UI.showScreen('season');
    UI.setActiveTab('my-team');
    updateAllTabs();
}

function handleSimWeekClick() {
    const game = Game.getGameState();
    const results = Game.simulateWeek();
    if (results) {
        Game.generateWeeklyFreeAgents(); // New agents for next week
        updateAllTabs(); // Refresh all data
        // Could add a popup for weekly results here
    } else {
        UI.showScreen('endSeason');
        UI.updateEndSeasonUI(game.year);
    }
}

function handleFreeAgentSignClick(playerId) {
    const game = Game.getGameState();
    const player = game.freeAgents.find(p => p.id === playerId);
    if (!player) return;
    const chances = { 'Close Friend': 0.9, 'Friend': 0.6, 'Acquaintance': 0.3 };
    if (Math.random() < chances[player.friendship]) {
        if (!Game.addPlayerToTeam(player, game.playerTeam)) {
            alert("Your roster is full!");
        }
    } else {
        alert(`${player.name} couldn't make it this week!`);
    }
    updateAllTabs();
}

async function startNextSeason() {
    UI.showScreen('loading');
    UI.updateLoadingProgress(0.25, "Aging players and checking for legends...");
    await Game.yieldToMain();
    Game.advanceToOffseason();
    UI.updateLoadingProgress(0.75, "Generating new rookies...");
    await Game.yieldToMain();
    const game = Game.getGameState();
    Game.setupDraft();
    UI.updateLoadingProgress(1, "Done!");
    await new Promise(res => setTimeout(res, 500));
    currentlySelectedPlayerId = null;
    UI.showScreen('draft');
    UI.renderDraftPool(game.players.filter(p => !p.teamId), handlePlayerRowClick);
    UI.updateDraftRoster(game.playerTeam);
    runNextDraftPick();
}

// --- Drag and Drop Handlers ---
function handleDragStart(e) {
    draggedPlayerId = e.target.dataset.playerId;
    e.target.classList.add('dragging');
}

function handleDragOver(e) {
    e.preventDefault(); // Necessary to allow dropping
}

function handleDrop(e) {
    e.preventDefault();
    const draggedEl = document.querySelector('.dragging');
    if (draggedEl) draggedEl.classList.remove('dragging');

    const targetSlot = e.target.closest('.depth-chart-slot');
    if (!targetSlot || !draggedPlayerId) return;

    const slotId = targetSlot.dataset.slotId;
    Game.updateDepthChart(draggedPlayerId, slotId);
    updateAllTabs(); // Re-render to show the change
    draggedPlayerId = null;
}


// --- INITIALIZATION ---
function main() {
    console.log("Game starting... Document loaded.");
    UI.setupElements();
    
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
    
    document.querySelectorAll('.tab-btn').forEach(button => {
        button.addEventListener('click', () => UI.setActiveTab(button.dataset.tab));
    });

    UI.showScreen('start');
}

document.addEventListener('DOMContentLoaded', main);

