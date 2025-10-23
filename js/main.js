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
        gameState = Game.getGameState();
        gameState.teams.forEach(t => t.draftNeeds = 10);
        Game.setupDraft();
        gameState = Game.getGameState(); 
        selectedPlayerId = null; // Reset selection for the new draft
        UI.renderSelectedPlayerCard(null);
        // Pass the initial null selectedPlayerId
        UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId); 
        UI.showScreen('draftScreen');
        runAIDraftPicks();
    } else {
        UI.showModal("Team Name Required", "<p>Please enter or select a team name to continue.</p>");
    }
}


function handlePlayerSelectInDraft(playerId) {
    selectedPlayerId = playerId; // Update state in main.js
    const player = gameState.players.find(p => p.id === playerId);
    UI.updateSelectedPlayerRow(playerId); // Just handles highlighting
    UI.renderSelectedPlayerCard(player); // Renders the details card
    // *** Update the draft screen (specifically the button state) after selection ***
    UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId);
}

function handleDraftPlayer() {
    const team = Game.getGameState().playerTeam;
    if (selectedPlayerId && team.roster.length < 10) {
        const player = gameState.players.find(p => p.id === selectedPlayerId);
        if (Game.addPlayerToTeam(player, team)) {
            const previouslySelected = selectedPlayerId; // Store before resetting
            selectedPlayerId = null; // Reset selection
            gameState.currentPick++;
            UI.renderSelectedPlayerCard(null); // Clear card
            // Important: Update the draft pool *before* running AI picks to remove the drafted player visually
            UI.renderDraftPool(gameState, handlePlayerSelectInDraft, selectedPlayerId); 
            runAIDraftPicks(); // Proceed to next pick
        } else {
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
    gameState = Game.getGameState(); 
    let undraftedPlayersCount = gameState.players.filter(p => !p.teamId).length; // Use let for count
    const maxPicksPossible = gameState.draftOrder.length; 

    while (gameState.currentPick < maxPicksPossible && undraftedPlayersCount > 0) {
        
        const needsMorePlayers = gameState.teams.some(t => t.roster.length < 10);
        if (!needsMorePlayers && undraftedPlayersCount > 0) {
             console.log("All teams have full rosters. Ending draft early.");
             break; 
        }

        // Ensure currentPick is valid before accessing draftOrder
        if (gameState.currentPick >= gameState.draftOrder.length) {
             console.error("Draft Error: currentPick went out of bounds unexpectedly.");
             break;
        }
        const currentPickingTeam = gameState.draftOrder[gameState.currentPick];

        if (currentPickingTeam.id !== gameState.playerTeam.id) {
             // Pass current selectedPlayerId (though AI doesn't use it, keep consistent)
             UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId); 
            await new Promise(resolve => setTimeout(resolve, 100)); 

            if (currentPickingTeam.roster.length < 10) {
                Game.simulateAIPick(currentPickingTeam);
            } else {
                 console.log(`${currentPickingTeam.name} skips pick (roster full).`);
            }
            gameState.currentPick++;
            undraftedPlayersCount = gameState.players.filter(p => !p.teamId).length; // Update count
        } else {
            if (gameState.playerTeam.roster.length < 10) {
                 // Pass current selectedPlayerId
                 UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId); 
                return; // Wait for player input
            } else {
                 console.log("Player roster full, skipping pick.");
                 gameState.currentPick++; 
            }
        }
    }

    handleDraftEnd();
}


function handleDraftEnd() {
    UI.showModal("Draft Complete!", "<p>The draft has concluded. Finalizing rosters and generating schedule!</p>");
    gameState.teams.forEach(team => {
        Game.aiSetDepthChart(team); 
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

        // Check for injuries *after* showing results, trigger Call Friend modal if needed
        gameState = Game.getGameState(); // Update state after sim
        const injuredPlayers = gameState.playerTeam.roster.filter(p => p.status.duration > 0 && p.status.isNew); // Only new injuries this week
        if (injuredPlayers.length > 0 && gameState.playerTeam.roster.filter(p => p.status.duration === 0).length < 7) {
             // Only pop up if they might forfeit next week
             setTimeout(() => { // Delay slightly after the results modal closes
                 UI.showModal("Call a Friend?", `<p>Looks like you have some injuries (${injuredPlayers.map(p=>p.name).join(', ')}). Want to call a friend to help out next week?</p>`, () => {
                     // If confirmed, switch to messages tab where they can see who is available (simpler than full FA tab)
                     UI.switchTab('messages', gameState);
                 });
             }, 500);
        }


        gameState.teams.filter(t => t.id !== gameState.playerTeam.id).forEach(Game.aiManageRoster);
        Game.generateWeeklyFreeAgents(); // Generate *after* AI might use them

        UI.renderDashboard(gameState);
        const activeTab = document.querySelector('.tab-button.active')?.dataset.tab || 'my-team';
        UI.switchTab(activeTab, gameState);
        checkForNewMessages(); 
    } else {
        // Season is over
        gameState = Game.getGameState(); 
        const offseasonReport = Game.advanceToOffseason();
        UI.renderOffseasonScreen(offseasonReport, gameState.year);
        UI.showScreen('offseasonScreen');
        checkForNewMessages(); 
    }
}

function handleGoToNextDraft() {
    Game.setupDraft();
    gameState = Game.getGameState();
    selectedPlayerId = null;
    UI.renderSelectedPlayerCard(null);
     // Pass initial null selectedPlayerId
    UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId);
    UI.showScreen('draftScreen');
    runAIDraftPicks();
}

function handleDashboardClicks(e) {
    const target = e.target;
    // Removed .call-friend-btn listener - now handled by modal confirmation/messages tab
}

function handleStatsChange() {
    UI.switchTab('player-stats', gameState); 
}

function handleMessageClick(messageId) {
    const message = gameState.messages.find(m => m.id === messageId);
    if(message) {
        UI.showModal(message.subject, `<p>${message.body}</p>`);
        Game.markMessageAsRead(messageId);
        UI.updateMessagesNotification(gameState.messages);
        // Re-render message list to show read status immediately
        UI.renderMessagesTab(gameState, handleMessageClick);
    }
}


function checkForNewMessages() {
    gameState = Game.getGameState(); 
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
        // Removed dashboard click handler as Call Friend button is gone
        // document.getElementById('dashboard-content')?.addEventListener('click', handleDashboardClicks);

         // Add listener specifically for messages list clicks
        document.getElementById('messages-list')?.addEventListener('click', (e) => {
            const messageItem = e.target.closest('.message-item');
            if (messageItem && messageItem.dataset.messageId) {
                handleMessageClick(messageItem.dataset.messageId);
            }
        });


        // --- Filter/Sort Listeners ---
        document.getElementById('draft-search')?.addEventListener('input', () => UI.renderDraftPool(gameState, handlePlayerSelectInDraft, selectedPlayerId));
        document.getElementById('draft-filter-pos')?.addEventListener('change', () => UI.renderDraftPool(gameState, handlePlayerSelectInDraft, selectedPlayerId));
        document.getElementById('draft-sort')?.addEventListener('change', () => UI.renderDraftPool(gameState, handlePlayerSelectInDraft, selectedPlayerId));
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

document.addEventListener('DOMContentLoaded', main);

