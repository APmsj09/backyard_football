import * as Game from './game.js';
import * as UI from './ui.js';
import { positionOverallWeights } from './game.js'; // <<< ADDED IMPORT

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
        UI.renderSelectedPlayerCard(null, gameState); // Pass gameState
        UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId);
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
    UI.renderSelectedPlayerCard(player, gameState); // Pass gameState
}

function handleDraftPlayer() {
    if (selectedPlayerId) {
        const player = gameState.players.find(p => p.id === selectedPlayerId);
        const team = Game.getGameState().playerTeam;
        if (team.roster.length >= 10) {
             UI.showModal("Roster Full", "<p>Your roster is full! You cannot draft more players.</p>");
             return;
        }

        if (Game.addPlayerToTeam(player, team)) {
            selectedPlayerId = null;
            gameState.currentPick++;
            UI.renderSelectedPlayerCard(null, gameState); // Pass gameState
            runAIDraftPicks();
        }
    }
}

async function runAIDraftPicks() {
    const checkDraftEnd = () => {
        const undraftedPlayers = gameState.players.filter(p => !p.teamId).length;
        // Check if ALL teams have either a full roster (10 players) or have made all their needed picks
        const allNeedsMetOrFull = gameState.teams.every(t => {
                const needs = t.draftNeeds || 0;
                const picksMade = (gameState.draftOrder || []).slice(0, gameState.currentPick).filter(teamInOrder => teamInOrder.id === t.id).length;
                return t.roster.length >= 10 || picksMade >= needs;
            });

        if (gameState.currentPick >= gameState.draftOrder.length || undraftedPlayers === 0 || allNeedsMetOrFull) {
            handleDraftEnd();
            return true;
        }
        return false;
    };


    if (checkDraftEnd()) return;

    let currentPickingTeam = gameState.draftOrder[gameState.currentPick];

    while (currentPickingTeam.id !== gameState.playerTeam.id) {
        UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId);
        await new Promise(resolve => setTimeout(resolve, 100)); // AI pick speed

        Game.simulateAIPick(currentPickingTeam); // This function now handles skipping if roster is full
        gameState.currentPick++;

        if (checkDraftEnd()) return;

        currentPickingTeam = gameState.draftOrder[gameState.currentPick];
    }

    // It's player's turn or draft ended while AI was picking
    if (!checkDraftEnd()) {
        // If player's team roster is full, skip their pick
        if (gameState.playerTeam.roster.length >= 10) {
            console.log("Player roster full, skipping pick.");
            gameState.currentPick++;
            runAIDraftPicks(); // Go back to AI picks
        } else {
            UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId); // Render for player
        }
    }
}


function handleDraftEnd() {
    console.log("Draft has concluded.");
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
    UI.switchTab('depth-chart', gameState); // Re-render the tab
}

function handleFormationChange(e) {
    const side = e.target.id.includes('offense') ? 'offense' : 'defense';
    const formationName = e.target.value;
    Game.changeFormation(side, formationName);
    gameState = Game.getGameState();
    UI.switchTab('depth-chart', gameState); // Re-render the tab
}

async function handleAdvanceWeek() {

    // Check for player's game this week
    const gamesPerWeek = gameState.teams.length / 2; // Should be 10
    const weekStartIndex = gameState.currentWeek * gamesPerWeek;
    const weekEndIndex = weekStartIndex + gamesPerWeek;
    const playerGameMatch = gameState.schedule.slice(weekStartIndex, weekEndIndex)
                                     .find(g => g.home.id === gameState.playerTeam.id || g.away.id === gameState.playerTeam.id);

    if(playerGameMatch) {
         UI.showModal("Game Day!",
           `<p>It's Week ${gameState.currentWeek + 1}! Your opponent is <strong>${playerGameMatch.home.id === gameState.playerTeam.id ? playerGameMatch.away.name : playerGameMatch.home.name}</strong>.</p>`,
           () => startLiveGame(playerGameMatch), // onConfirm = Watch Game
           "Watch Game Live",
           () => simulateRestOfWeek(), // onCancel = Sim Week
           "Sim Week" // Explicitly set cancel text
         );
    } else if (gameState.currentWeek >= 9) {
        // Season is over, go directly to offseason
        handleSeasonEnd();
    }
     else {
        // This *really* shouldn't happen with the current scheduler, but handle it
        console.warn(`No game found for player team in Week ${gameState.currentWeek + 1}. Simulating week.`);
        simulateRestOfWeek();
    }
}

function startLiveGame(playerGameMatch) {
    console.log("Starting live game...");
    const gamesPerWeek = gameState.teams.length / 2;
    const allGames = gameState.schedule.slice(gameState.currentWeek * gamesPerWeek, (gameState.currentWeek + 1) * gamesPerWeek);
    let playerGameResult = null;
    let allResults = []; // Store results for finishWeekSimulation

    // Simulate all games instantly BUT store the player's game result separately
     allGames.forEach(match => {
        try {
            const result = Game.simulateGame(match.home, match.away);
             allResults.push(result); // Add to results list
            if (result.breakthroughs) {
                result.breakthroughs.forEach(b => {
                    if (b.player.teamId === gameState.playerTeam?.id) {
                         // Game.addMessage is not directly accessible here, need to call via Game module if made public or handle differently
                         // For now, log it:
                         console.log(`Player Breakthrough: ${b.player.name} improved ${b.attr}! (Will show in messages later)`);
                    }
                });
                // Assuming Game.addBreakthrough or similar exists to store globally:
                // Game.addBreakthroughs(result.breakthroughs);
            }
            if (match.home.id === playerGameMatch.home.id && match.away.id === playerGameMatch.away.id) {
                playerGameResult = result; // Found the specific game to simulate live
            }
        } catch(error) {
             console.error(`Error simulating game during live sim week (${match?.away?.name} @ ${match?.home?.name}):`, error);
             // Potentially add a placeholder result or skip
        }
    });

    // Add results to game state and advance week *after* all sims are done
    gameState.gameResults.push(...allResults);
    gameState.currentWeek++;
    gameState = Game.getGameState(); // Refresh gameState reference

    if (playerGameResult) {
        UI.showScreen('gameSimScreen'); // <<< Error occurs here if screen not found
        UI.startLiveGameSim(playerGameResult, () => {
            // This is the callback function for when the sim finishes OR is skipped
            console.log("Live sim finished or skipped.");
            // Pass *all* results from the week to the finish function
            finishWeekSimulation(allResults);
        });
    } else {
        // Failsafe if player game wasn't found (shouldn't happen)
        console.error("Player game result not found after simulating week for live view.");
        finishWeekSimulation(allResults);
    }
}


function simulateRestOfWeek() {
    console.log("Simulating rest of week...");
    const results = Game.simulateWeek(); // This will simulate all games and advance the week

    if (results !== null) { // simulateWeek returns null if season ended
         finishWeekSimulation(results);
    } else {
        // Season is over
        handleSeasonEnd();
    }
}

function finishWeekSimulation(results) {
    // Check if results array exists and is not empty
    if (!results || results.length === 0) {
        console.warn("finishWeekSimulation called with no game results. Skipping UI updates for results.");
         // Still proceed with other end-of-week logic like AI roster moves and free agents
    } else {
        const playerGame = results.find(r => r.homeTeam.id === gameState.playerTeam.id || r.awayTeam.id === gameState.playerTeam.id);
        const playerTeamResultText = playerGame
            ? (playerGame.homeTeam.id === gameState.playerTeam.id
                ? (playerGame.homeScore > playerGame.awayScore ? 'WON' : (playerGame.homeScore < playerGame.awayScore ? 'LOST' : 'TIED'))
                : (playerGame.awayScore > playerGame.homeScore ? 'WON' : (playerGame.awayScore < playerGame.homeScore ? 'LOST' : 'TIED')))
            : 'BYE / Did not play?'; // Should not happen

        const breakthroughs = Game.getBreakthroughs(); // Get breakthroughs stored during simulation

        let resultsHtml = `<h4>Your Result: ${playerTeamResultText}</h4>`;
         if (playerGame) {
             resultsHtml += `<p>${playerGame.awayTeam.name} ${playerGame.awayScore} @ ${playerGame.homeTeam.name} ${playerGame.homeScore}</p>`;
         }
         resultsHtml += '<h4 class="mt-4">All Weekly Results</h4><div class="space-y-1 text-sm mt-2">';

        results.forEach(r => {
            const isPlayerGame = r.homeTeam.id === gameState.playerTeam.id || r.awayTeam.id === gameState.playerTeam.id;
            resultsHtml += `<p class="${isPlayerGame ? 'font-bold text-amber-600' : ''}">${r.awayTeam.name} ${r.awayScore} @ ${r.homeTeam.name} ${r.homeScore}</p>`;
        });
        resultsHtml += '</div>';

        if (breakthroughs && breakthroughs.length > 0) {
            resultsHtml += `<h4 class="font-bold mt-4 mb-2">Player Breakthroughs!</h4><div class="space-y-1 text-sm">`;
            breakthroughs.forEach(b => {
                 // Check if the player belongs to the user's team for display emphasis
                 const isUserPlayer = b.player.teamId === gameState.playerTeam?.id;
                 resultsHtml += `<p class=${isUserPlayer ? '"font-semibold"' : ''}><strong>${b.player.name}</strong> (${b.teamName || 'Your Team'}) improved their <strong>${b.attr}</strong>!</p>`;
            });
            resultsHtml += `</div>`;
        }

        UI.showModal(`Week ${gameState.currentWeek} Results`, resultsHtml); // currentWeek was already advanced
    }


    // Handle AI roster moves and generate new free agents AFTER showing results
    gameState.teams.filter(t => t.id !== gameState.playerTeam.id).forEach(Game.aiManageRoster);
    Game.generateWeeklyFreeAgents();

    // Update dashboard AFTER AI moves / FA generation
    gameState = Game.getGameState(); // Refresh state again
    UI.renderDashboard(gameState);
    const activeTabEl = document.querySelector('#dashboard-tabs .tab-button.active');
    const activeTab = activeTabEl ? activeTabEl.dataset.tab : 'my-team'; // Default to 'my-team' if somehow none active
    UI.switchTab(activeTab, gameState); // Re-render current tab
    UI.showScreen('dashboardScreen'); // Ensure dashboard is visible

    // Check if season ended after this week
    if (gameState.currentWeek >= 9) {
         handleSeasonEnd(); // Go to offseason directly
         return; // Don't prompt for friend call if season is over
    }

    // Check for new injuries/events and prompt for "Call a Friend"
    const hasUnavailablePlayer = gameState.playerTeam.roster.some(p => p.status.duration > 0);
    const healthyCount = gameState.playerTeam.roster.filter(p => p.status.duration === 0).length;
    // Prompt only if players are unavailable AND the team has less than 7 healthy players
    if (hasUnavailablePlayer && healthyCount < 7) {
        promptCallFriend();
    }
}

function handleSeasonEnd() {
    UI.showModal("Season Over", "<p>The regular season has concluded. Advancing to the offseason!</p>");
    const offseasonReport = Game.advanceToOffseason();
    gameState = Game.getGameState(); // Get new state after offseason logic
    UI.renderOffseasonScreen(offseasonReport, gameState.year);
    UI.showScreen('offseasonScreen');
}

function handleGoToNextDraft() {
    Game.setupDraft();
    gameState = Game.getGameState();
    selectedPlayerId = null;
    UI.renderSelectedPlayerCard(null, gameState);
    UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId);
    UI.showScreen('draftScreen');
    runAIDraftPicks();
}

function handleDashboardClicks(e) {
    const target = e.target;
    // Call friend button clicks are now handled inside promptCallFriend's modal listener setup
    // if (target.matches('.call-friend-btn')) { ... }
}

function handleStatsChange() {
    UI.switchTab('player-stats', gameState);
}

function handleMessageClick(messageId) {
    const message = gameState.messages.find(m => m.id === messageId);
    if (message) {
        UI.showModal(message.subject, `<p class="whitespace-pre-wrap">${message.body}</p>`);
        Game.markMessageAsRead(messageId);
        // Re-render messages tab immediately to show read status and update dot
        UI.renderMessagesTab(gameState); // Removed handleMessageClick arg, not needed
        UI.updateMessagesNotification(gameState.messages); // Update dot explicitly
    }
}

function promptCallFriend() {
    // Game.generateWeeklyFreeAgents(); // Ensure FAs generated *before* this prompt if needed, now done in finishWeekSimulation
    gameState = Game.getGameState(); // Make sure state is fresh
    const { freeAgents, playerTeam } = gameState;
    const unavailableCount = playerTeam.roster.filter(p => p.status.duration > 0).length;
    const healthyCount = playerTeam.roster.length - unavailableCount;

    // Only proceed if actually needed (healthy < 7) and FAs exist
     if (healthyCount >= 7 || !freeAgents || freeAgents.length === 0) {
        if (healthyCount < 7 && (!freeAgents || freeAgents.length === 0)) {
            // Log or message that no friends are available if needed
            // Game.addMessage("No Friends Available", "Your roster is short, but no friends were available this week.");
            console.log("Roster short, but no free agents available to call.");
        }
        return; // Don't show modal if not needed or no options
    }

    let modalBody = `<p>You only have ${healthyCount} healthy players available for the next game! Call a friend to fill in?</p>
                       <div class="mt-4 space-y-2">`;

    freeAgents.forEach(p => {
        const bestPos = Object.keys(positionOverallWeights).reduce((best, pos) => { // <<< Now defined
            const currentOvr = Game.calculateOverall(p, pos); // calculateOverall is already in Game module
            return currentOvr > best.ovr ? { pos, ovr: currentOvr } : best;
        }, { pos: 'N/A', ovr: 0 });


        modalBody += `
            <div class="flex items-center justify-between p-2 bg-gray-100 rounded">
                <div>
                    <p class="font-bold">${p.name}</p>
                    <p class="text-sm text-gray-600">${p.relationship} (Best: ${bestPos.pos} - ${bestPos.ovr} Ovr)</p>
                </div>
                <button data-player-id="${p.id}" class="call-friend-btn bg-green-500 hover:bg-green-600 text-white px-3 py-1 text-xs rounded font-semibold">CALL</button>
            </div>
        `;
    });
    modalBody += `</div>`;

    // Show the modal - IMPORTANT: Do not provide onConfirm/onCancel here, handle buttons internally
    UI.showModal("Call a Friend?", modalBody, null, '', null, 'Maybe Later'); // Just provide a close option

    // Add temporary event listeners specifically to the buttons INSIDE this modal instance
    const modalElement = document.getElementById('modal'); // Get modal reference
    const callButtons = modalElement.querySelectorAll('.call-friend-btn'); // Find buttons within modal

    const callButtonClickHandler = (e) => {
        const playerId = e.target.dataset.playerId;
        const result = Game.callFriend(playerId);
        UI.hideModal(); // Close the 'Call Friend' modal first
        // Show result in a new, simpler modal
        // Use setTimeout to ensure the first modal is hidden before showing the second
        setTimeout(() => {
            UI.showModal("Call Result", `<p>${result.message}</p>`);
             // Update game state and relevant tabs
            gameState = Game.getGameState();
            // Force re-render of the active tab, likely 'my-team' or 'depth-chart'
             const activeTabEl = document.querySelector('#dashboard-tabs .tab-button.active');
             const activeTab = activeTabEl ? activeTabEl.dataset.tab : 'my-team';
             UI.switchTab(activeTab, gameState);
        }, 100); // Small delay
    };

    callButtons.forEach(btn => {
        // Clone and replace to remove any previous listeners before adding a new one
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', callButtonClickHandler, { once: true }); // Use {once: true} for cleanup
    });
    // Ensure modal close button also cleans up if needed, though hideModal doesn't strictly need it.
}


function main() {
    console.log("Game starting... Document loaded.");
    try {
        UI.setupElements();

        // Screen Buttons
        document.getElementById('start-game-btn')?.addEventListener('click', startNewGame);
        document.getElementById('confirm-team-btn')?.addEventListener('click', handleConfirmTeam);
        document.getElementById('draft-player-btn')?.addEventListener('click', handleDraftPlayer);
        document.getElementById('advance-week-btn')?.addEventListener('click', handleAdvanceWeek);
        document.getElementById('go-to-next-draft-btn')?.addEventListener('click', handleGoToNextDraft);

        // Sim Screen Controls
        document.getElementById('sim-skip-btn')?.addEventListener('click', () => {
             // Need to pass the current gameResult to skip function for final score display
             // This requires storing the current sim's gameResult accessible to this handler
             // For now, skipping won't show final score correctly. Needs refactor.
             console.warn("Skip button clicked, but final score might not display correctly yet.");
             // Placeholder: find the *last* simulated player game result
             const lastPlayerGame = (gameState?.gameResults || [])
                .filter(r => r.homeTeam.id === gameState?.playerTeam?.id || r.awayTeam.id === gameState?.playerTeam?.id)
                .pop();
             UI.skipLiveGameSim(lastPlayerGame); // Pass potential last game result
        });
        document.getElementById('sim-speed-play')?.addEventListener('click', () => UI.setSimSpeed(1000));
        document.getElementById('sim-speed-fast')?.addEventListener('click', () => UI.setSimSpeed(400));
        document.getElementById('sim-speed-faster')?.addEventListener('click', () => UI.setSimSpeed(100));

        // Dashboard Listeners
        document.getElementById('dashboard-tabs')?.addEventListener('click', handleTabSwitch);
        document.getElementById('dashboard-content')?.addEventListener('click', handleDashboardClicks); // For dynamic buttons
        document.getElementById('messages-list')?.addEventListener('click', (e) => {
             const messageItem = e.target.closest('.message-item');
             if (messageItem) {
                 handleMessageClick(messageItem.dataset.messageId);
             }
        });

        // Filter/Sort Listeners
        document.getElementById('draft-search')?.addEventListener('input', () => UI.debouncedRenderDraftPool(gameState, handlePlayerSelectInDraft)); // Use debounced version
        document.getElementById('draft-filter-pos')?.addEventListener('change', () => UI.renderDraftPool(gameState, handlePlayerSelectInDraft));
        document.getElementById('draft-sort')?.addEventListener('change', () => UI.renderDraftPool(gameState, handlePlayerSelectInDraft));

        document.getElementById('offense-formation-select')?.addEventListener('change', handleFormationChange);
        document.getElementById('defense-formation-select')?.addEventListener('change', handleFormationChange);

        document.getElementById('stats-filter-team')?.addEventListener('change', handleStatsChange);
        document.getElementById('stats-sort')?.addEventListener('change', handleStatsChange);

        // Setup Drag & Drop and Sub-tabs
        UI.setupDragAndDrop(handleDepthChartDrop);
        UI.setupDepthChartTabs();

        UI.showScreen('startScreen');
    } catch (error) {
        console.error("Fatal error during initialization:", error);
         // Display error to user?
         const body = document.body;
         if (body) {
            body.innerHTML = `<div style="padding: 20px; color: red; font-family: sans-serif;"><h1>Initialization Error</h1><p>Something went wrong setting up the game. Please check the console (F12) for details.</p><pre>${error.stack}</pre></div>`;
         }
    }
}

document.addEventListener('DOMContentLoaded', main);

