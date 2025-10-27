import * as Game from './game.js';
import * as UI from './ui.js';
import { positionOverallWeights } from './game.js'; // For 'Call Friend' overall display

let gameState = null;
let selectedPlayerId = null;
let currentLiveSimResult = null; // Store result for potential skip

// --- Constants ---
const ROSTER_LIMIT = 10;
const MIN_HEALTHY_PLAYERS = 7;
const WEEKS_IN_SEASON = 9; // Number of weeks in the regular season

// --- Event Handlers ---

/**
 * Initializes the league and navigates to the team creation screen.
 */
async function startNewGame() {
    try {
        UI.showScreen('loadingScreen');
        await new Promise(resolve => setTimeout(resolve, 50)); // Brief pause for UI
        await Game.initializeLeague(UI.updateLoadingProgress); // Generate players and AI teams
        gameState = Game.getGameState(); // Get initial state
        if (!gameState) throw new Error("Failed to get game state after initialization."); // Robustness check
        // Populate team name suggestions
        UI.renderTeamNameSuggestions(['Jets', 'Sharks', 'Tigers', 'Bulldogs', 'Panthers', 'Giants'], handleTeamNameSelection);
        UI.showScreen('teamCreationScreen'); // Show team creation UI
    } catch (error) {
        console.error("Error starting game:", error);
        // Show an error modal to the user
        UI.showModal("Error", `Could not start a new game: ${error.message}. Please check the console for details.`, null, '', null, 'Close');
    }
}

/**
 * Updates the custom team name input when a suggestion is clicked.
 * @param {string} name - The selected team name suggestion.
 */
function handleTeamNameSelection(name) {
    const customNameInput = document.getElementById('custom-team-name');
    if (customNameInput) {
        customNameInput.value = name;
    }
}

/**
 * Creates the player's team, sets up the draft, and navigates to the draft screen.
 */
function handleConfirmTeam() {
    const customNameInput = document.getElementById('custom-team-name');
    const customName = customNameInput ? customNameInput.value.trim() : '';

    if (customName) {
        try {
            Game.createPlayerTeam(customName); // Create player team in game state
            Game.setupDraft(); // Determine draft order based on needs/standings
            gameState = Game.getGameState(); // Refresh state
            if (!gameState || !gameState.playerTeam) throw new Error("Failed to get game state after creating team.");
            UI.renderSelectedPlayerCard(null, gameState); // Clear player card initially
            UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId); // Render draft UI
            UI.showScreen('draftScreen'); // Show the draft screen
            runAIDraftPicks(); // Start simulating AI picks until player's turn
        } catch (error) {
            console.error("Error confirming team:", error);
            UI.showModal("Error", `Could not create team or start draft: ${error.message}.`, null, '', null, 'Close');
        }
    } else {
        UI.showModal("Team Name Required", "<p>Please enter or select a team name to continue.</p>");
    }
}

/**
 * Handles selecting a player from the draft pool list.
 * Updates the UI to show the selected player's details.
 * @param {string} playerId - The ID of the selected player.
 */
function handlePlayerSelectInDraft(playerId) {
    if (!gameState || !gameState.players) {
        console.error("Cannot select player: Game state or players list not available.");
        return;
    }
    selectedPlayerId = playerId;
    const player = gameState.players.find(p => p.id === playerId);
    UI.updateSelectedPlayerRow(playerId); // Highlight the selected row
    UI.renderSelectedPlayerCard(player, gameState); // Show player details (passes gameState for context)
}

/**
 * Handles the 'Draft Player' button click.
 * Adds the selected player to the player's team and advances the draft.
 */
function handleDraftPlayer() {
    if (!gameState || !gameState.playerTeam || !gameState.players) {
        console.error("Cannot draft player: Game state invalid.");
        return;
    }
    if (selectedPlayerId) {
        const player = gameState.players.find(p => p.id === selectedPlayerId);
        const team = gameState.playerTeam;

        // Check roster limit
        if (team.roster.length >= ROSTER_LIMIT) {
             UI.showModal("Roster Full", `<p>Your roster is full (${ROSTER_LIMIT} players)! You cannot draft more players.</p>`);
             return;
        }

        // Add player to team and advance draft state
        if (player && Game.addPlayerToTeam(player, team)) {
            selectedPlayerId = null; // Clear selection
            gameState.currentPick++; // Advance to next pick
            // gameState might need refresh here if addPlayerToTeam modifies it significantly, but likely ok.
            UI.renderSelectedPlayerCard(null, gameState); // Clear player card
            runAIDraftPicks(); // Continue with AI picks or render for player
        } else {
             console.error(`Failed to add player ${selectedPlayerId} to team or player not found.`);
             UI.showModal("Draft Error", "Could not draft the selected player. Please check the console.", null,'',null,'Close');
        }
    } else {
         console.warn("Draft Player button clicked but no player selected.");
    }
}

/**
 * Simulates AI draft picks until it's the player's turn or the draft ends.
 */
async function runAIDraftPicks() {
    if (!gameState || !gameState.teams || !gameState.players || !gameState.draftOrder || !gameState.playerTeam) {
        console.error("Cannot run AI draft picks: Game state invalid.");
        return; // Stop if game state is broken
    }
    // Helper function to check draft completion conditions
    const checkDraftEnd = () => {
        // Condition 1: Current pick exceeds the total number of picks in the defined order
        const pickLimitReached = gameState.currentPick >= gameState.draftOrder.length;

        // Condition 2: No more players available to draft
        const noPlayersLeft = gameState.players.filter(p => !p.teamId).length === 0;

        // Condition 3: All teams have either filled their roster or met their specific draft needs for this draft
        const allNeedsMetOrFull = gameState.teams.every(t => {
                const needs = t.draftNeeds || 0; // How many players this team *needed* at the start of the draft
                // Count how many picks this team has *actually* made so far in the draft order
                const picksMade = gameState.draftOrder.slice(0, gameState.currentPick).filter(teamInOrder => teamInOrder.id === t.id).length;
                // Team is satisfied if roster full OR they've made enough picks to meet initial need
                return t.roster.length >= ROSTER_LIMIT || picksMade >= needs;
            });

        // Draft ends if any of these conditions are true
        return pickLimitReached || noPlayersLeft || allNeedsMetOrFull;
    };


    if (checkDraftEnd()) {
        console.log("Draft end condition met before AI picks.");
        handleDraftEnd(); // Ensure draft end logic runs if condition met immediately
        return;
    }

    let currentPickingTeam = gameState.draftOrder[gameState.currentPick];

    // Loop while it's an AI team's turn and the draft isn't over
    while (currentPickingTeam && currentPickingTeam.id !== gameState.playerTeam.id) {
        UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId); // Update UI to show AI is picking
        await new Promise(resolve => setTimeout(resolve, 50)); // Short delay for visual feedback

        Game.simulateAIPick(currentPickingTeam); // AI makes its selection (or skips if full)
        gameState.currentPick++; // Advance pick number

        if (checkDraftEnd()) {
            handleDraftEnd(); // End draft immediately if conditions met
            return;
        }

        // Get next picking team, handle potential end of draft order
        currentPickingTeam = gameState.draftOrder[gameState.currentPick];
    }

    // It's player's turn (or draft ended while AI was picking)
    if (!checkDraftEnd()) {
        // If player's team roster is full, automatically skip their pick
        if (gameState.playerTeam.roster.length >= ROSTER_LIMIT) {
            console.log("Player roster full, skipping pick.");
            gameState.currentPick++;

            // Check if skipping ended the draft
            if (checkDraftEnd()) {
                 handleDraftEnd();
            } else {
                 runAIDraftPicks(); // Go back to simulating AI picks ONLY if draft isn't over
            }

        } else {
            // Render the draft screen for the player's input
            UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId);
        }
    } else if (gameState.currentPick < gameState.draftOrder.length) {
         // Draft ended but technically wasn't player's turn yet (e.g., another team filled up before player)
         handleDraftEnd();
    } else { // --- ADD THIS ELSE BLOCK ---
        // This handles the case where checkDraftEnd() is true because the pick limit was reached
        // (e.g., currentPick is now >= draftOrder.length), often after the last AI pick.
        handleDraftEnd();
    }
} // --- End of runAIDraftPicks function ---


/**
 * Finalizes the draft, sets initial depth charts, generates schedule, and navigates to the dashboard.
 */
function handleDraftEnd() {
    console.log("Draft has concluded.");
    if (!gameState || !gameState.teams) {
        console.error("Cannot end draft: Game state invalid.");
        return;
    }
    // Set initial depth charts for all teams (including player's)
    gameState.teams.forEach(team => {
        try {
            Game.aiSetDepthChart(team); // AI sets its own, player's might need manual adjustment later
        } catch(error) {
            console.error(`Error setting depth chart for ${team?.name}:`, error);
        }
    });

    // Show confirmation modal
    UI.showModal("Draft Complete!", "<p>The draft has concluded. Get ready for the season!</p>", () => {
        // Actions *after* modal is closed
        try {
            Game.generateSchedule(); // Create the season schedule
            gameState = Game.getGameState(); // Refresh state
            if (!gameState) throw new Error("Failed to get game state after schedule generation.");
            UI.renderDashboard(gameState); // Render the main dashboard UI
            UI.switchTab('my-team', gameState); // Set the default active tab
            UI.showScreen('dashboardScreen'); // Show the dashboard
        } catch (error) {
             console.error("Error transitioning to dashboard after draft:", error);
             UI.showModal("Error", `Could not proceed to season: ${error.message}.`, null, '', null, 'Close');
        }
    }, "Start Season"); // Change confirm button text
}

/**
 * Handles clicks on the main dashboard navigation tabs.
 * @param {Event} e - The click event.
 */
function handleTabSwitch(e) {
    if (e.target.matches('.tab-button')) {
        const tabId = e.target.dataset.tab;
        if (!gameState) {
            console.error("Cannot switch tab: Game state not available.");
            return; // Don't switch if state is missing
        }
        UI.switchTab(tabId, gameState); // Tell UI module to switch content
    }
}

/**
 * Handles the drop event on the depth chart (player moved to a new slot).
 * @param {string} playerId - ID of the player being dropped.
 * @param {string} newPositionSlot - The slot the player was dropped onto.
 * @param {string} side - 'offense' or 'defense'.
 */
function handleDepthChartDrop(playerId, newPositionSlot, side) {
    if (!gameState) {
        console.error("Cannot update depth chart: Game state not available.");
        return;
    }
    Game.updateDepthChart(playerId, newPositionSlot, side); // Update game state
    gameState = Game.getGameState(); // Refresh state
    UI.switchTab('depth-chart', gameState); // Re-render the depth chart tab
}

/**
 * Handles changing the offensive or defensive formation via the dropdown.
 * @param {Event} e - The change event from the select element.
 */
function handleFormationChange(e) {
    if (!gameState) {
        console.error("Cannot change formation: Game state not available.");
        return;
    }
    const side = e.target.id.includes('offense') ? 'offense' : 'defense';
    const formationName = e.target.value;
    Game.changeFormation(side, formationName); // Update game state
    gameState = Game.getGameState(); // Refresh state
    UI.switchTab('depth-chart', gameState); // Re-render the depth chart tab
}

/**
 * Handles the 'Advance Week' / 'Go to Offseason' button click.
 * Presents options (watch/sim) if it's game day, otherwise simulates the week or advances to offseason.
 */
async function handleAdvanceWeek() {
    if (!gameState || !gameState.schedule || !gameState.teams || !gameState.playerTeam) {
        console.error("Cannot advance week: Game state invalid.");
        UI.showModal("Error", "Cannot advance week due to invalid game state.", null,'',null,'Close');
        return;
    }
    // Check if the season is already over
    if (gameState.currentWeek >= WEEKS_IN_SEASON) {
        handleSeasonEnd();
        return;
    }

    // Find the player's game for the current week
    const gamesPerWeek = gameState.teams.length / 2;
    const weekStartIndex = gameState.currentWeek * gamesPerWeek;
    const weekEndIndex = weekStartIndex + gamesPerWeek;
    const playerGameMatch = gameState.schedule.slice(weekStartIndex, weekEndIndex)
                                            .find(g => g.home.id === gameState.playerTeam.id || g.away.id === gameState.playerTeam.id);

    if (playerGameMatch) {
        // Game day! Show modal with options to watch live or simulate the week.
         UI.showModal("Game Day!",
            `<p>It's Week ${gameState.currentWeek + 1}! Your opponent is <strong>${playerGameMatch.home.id === gameState.playerTeam.id ? playerGameMatch.away.name : playerGameMatch.home.name}</strong>.</p>`,
            () => startLiveGame(playerGameMatch), // onConfirm -> Watch Game
            "Watch Game Live",
            () => simulateRestOfWeek(), // onCancel -> Sim Week
            "Sim Week" // Explicitly set cancel button text
          );
    } else {
        // This case should ideally not happen with round-robin in divisions.
        console.warn(`No game found for player team in Week ${gameState.currentWeek + 1}. Simulating week anyway.`);
        simulateRestOfWeek();
    }
}

/**
 * Simulates all games for the week, stores the player's game result, and starts the live simulation UI.
 * @param {object} playerGameMatch - The specific schedule entry for the player's game.
 */
function startLiveGame(playerGameMatch) {
    console.log("Simulating week's games before starting live view...");
    if (!gameState || !gameState.schedule || !gameState.teams) {
         console.error("Cannot start live game: Invalid game state.");
         return;
    }
    currentLiveSimResult = null; // Clear previous live sim result
    const gamesPerWeek = gameState.teams.length / 2;
    const allGames = gameState.schedule.slice(gameState.currentWeek * gamesPerWeek, (gameState.currentWeek + 1) * gamesPerWeek);
    let allResults = []; // Store results for finishWeekSimulation

    // Simulate all games instantly, storing the player's game result separately
      allGames.forEach(match => {
        try {
            // Ensure teams exist before simulating
            if (!match.home || !match.away) {
                 console.error("Skipping simulation due to missing team:", match);
                 return; // Skip this iteration
            }
            const result = Game.simulateGame(match.home, match.away);
             allResults.push(result); // Add to results list
            // Handle breakthroughs
            if (result.breakthroughs) {
                result.breakthroughs.forEach(b => {
                    if (b.player.teamId === gameState.playerTeam?.id) {
                         // Use Game.addMessage if available and exported
                         if (Game.addMessage) { // Check if function exists
                             Game.addMessage("Player Breakthrough!", `${b.player.name} improved ${b.attr}!`);
                         } else {
                           console.log(`Player Breakthrough: ${b.player.name} improved ${b.attr}! (AddMessage not exported)`);
                         }
                    }
                });
                // Store breakthroughs globally if the Game module handles it
                if (Game.storeBreakthroughs) Game.storeBreakthroughs(result.breakthroughs);
            }
            // Store the specific result for the game to be watched live
            if (match.home.id === playerGameMatch.home.id && match.away.id === playerGameMatch.away.id) {
                currentLiveSimResult = result; // Store for live sim and skip button
            }
        } catch(error) {
             console.error(`Error simulating game during live sim week (${match?.away?.name} @ ${match?.home?.name}):`, error);
             // Add a placeholder? For now, just skip adding to results.
        }
    });

    // Add results to game state and advance week *after* all simulations are done
    // Assuming simulateGame modifies the team objects directly for W/L,
    // we just need to store results and advance week.
    if (!gameState.gameResults) gameState.gameResults = []; // Ensure array exists
    gameState.gameResults.push(...allResults);
    gameState.currentWeek++;
    // gameState = Game.getGameState(); // Re-getting might overwrite changes made during simulation if not careful

    // Start the live simulation UI if the player's game result was successfully captured
    if (currentLiveSimResult) {
        UI.showScreen('gameSimScreen');
        UI.startLiveGameSim(currentLiveSimResult, () => {
            // Callback for when sim finishes naturally OR is skipped
            console.log("Live sim finished or skipped.");
            finishWeekSimulation(allResults); // Pass *all* results to post-week handler
            currentLiveSimResult = null; // Clear stored result after use
        });
    } else {
        // Failsafe if player's game simulation failed or wasn't found
        console.error("Player game result not found or failed simulation. Proceeding without live view.");
        finishWeekSimulation(allResults); // Still process the rest of the week's results
    }
}


/**
 * Simulates the entire week's games instantly using Game.simulateWeek.
 */
function simulateRestOfWeek() {
    console.log("Simulating entire week...");
    let results = null;
    try {
        if (!gameState || gameState.currentWeek >= WEEKS_IN_SEASON) {
             console.log("Attempted to simulate week, but season is already over.");
             handleSeasonEnd(); // Go to offseason if needed
             return;
        }
        results = Game.simulateWeek(); // This simulates all games AND advances the week
    } catch (error) {
        console.error(`Error during Game.simulateWeek (for Week ${gameState?.currentWeek + 1}):`, error);
        UI.showModal("Simulation Error", "An error occurred during week simulation. Check console. Advancing state might be unstable.", null, '', null, 'OK');
        // Attempt to recover? Cautiously advance week if state exists
        if (gameState) gameState.currentWeek++;
        results = []; // Treat as empty results to prevent total crash
    }


    if (results !== null) { // simulateWeek returns null if season ended *before* simulation
         finishWeekSimulation(results);
    } else if (gameState && gameState.currentWeek >= WEEKS_IN_SEASON) {
        // Season ended (simulateWeek returned null because week was >= 9)
        handleSeasonEnd();
    } else {
        // simulateWeek returned null unexpectedly mid-season OR error occurred
        console.error("simulateWeek finished unexpectedly or errored mid-season.");
        // Refresh state and try to show dashboard
        gameState = Game.getGameState();
        if (gameState) {
             UI.renderDashboard(gameState);
             UI.showScreen('dashboardScreen');
        } else {
             UI.showModal("Critical Error", "Game state lost after simulation error. Please refresh.", null,'',null,'OK');
        }
    }
}

/**
 * Builds the HTML content for the weekly results modal.
 * @param {Array} results - Array of game result objects for the week.
 * @returns {string} HTML string for the modal body.
 */
function buildResultsModalHtml(results) {
    if (!gameState || !gameState.playerTeam) return "<p>Error displaying results: Game state missing.</p>";

    const playerGame = results.find(r => r.homeTeam.id === gameState.playerTeam.id || r.awayTeam.id === gameState.playerTeam.id);
    const playerTeamResultText = playerGame
        ? (playerGame.homeTeam.id === gameState.playerTeam.id
            ? (playerGame.homeScore > playerGame.awayScore ? 'WON' : (playerGame.homeScore < playerGame.awayScore ? 'LOST' : 'TIED'))
            : (playerGame.awayScore > playerGame.homeScore ? 'WON' : (playerGame.awayScore < playerGame.homeScore ? 'LOST' : 'TIED')))
        : 'BYE / Did not play?';

    const breakthroughs = Game.getBreakthroughs() || []; // Ensure breakthroughs is an array

    let html = `<h4>Your Result: ${playerTeamResultText}</h4>`;
    if (playerGame) {
        html += `<p>${playerGame.awayTeam.name} ${playerGame.awayScore} @ ${playerGame.homeTeam.name} ${playerGame.homeScore}</p>`;
    }
    html += '<h4 class="mt-4">All Weekly Results</h4><div class="space-y-1 text-sm mt-2">';
    results.forEach(r => {
        const isPlayerGame = r.homeTeam.id === gameState.playerTeam.id || r.awayTeam.id === gameState.playerTeam.id;
        html += `<p class="${isPlayerGame ? 'font-bold text-amber-600' : ''}">${r.awayTeam.name} ${r.awayScore} @ ${r.homeTeam.name} ${r.homeScore}</p>`;
    });
    html += '</div>';

    if (breakthroughs.length > 0) {
        html += `<h4 class="font-bold mt-4 mb-2">Player Breakthroughs!</h4><div class="space-y-1 text-sm">`;
        breakthroughs.forEach(b => {
            const isUserPlayer = b.player.teamId === gameState.playerTeam?.id;
            html += `<p class=${isUserPlayer ? '"font-semibold"' : ''}><strong>${b.player.name}</strong> (${b.teamName || 'Your Team'}) improved their <strong>${b.attr}</strong>!</p>`;
        });
        html += `</div>`;
    }
    return html;
}


/**
 * Processes the results of a simulated week, updates UI, handles AI actions, and prompts for friend calls.
 * @param {Array} results - Array of game result objects for the completed week.
 */
function finishWeekSimulation(results) {
    if (!gameState || !gameState.teams || !gameState.playerTeam) {
        console.error("Cannot finish week simulation: Game state invalid.");
        // Attempt to recover?
        gameState = Game.getGameState(); // Try refreshing state
        if (gameState) {
             UI.renderDashboard(gameState);
             UI.showScreen('dashboardScreen');
        } else {
             UI.showModal("Critical Error", "Game state lost after simulation. Please refresh.", null,'',null,'OK');
        }
        return;
    }
    // Show results modal (only if results exist)
    if (results && results.length > 0) {
        const resultsHtml = buildResultsModalHtml(results);
        UI.showModal(`Week ${gameState.currentWeek} Results`, resultsHtml); // currentWeek was already advanced
    } else {
        console.warn("finishWeekSimulation called with no valid game results.");
        UI.showModal(`Week ${gameState.currentWeek} Advanced`, "<p>The week has advanced, but there were issues simulating games. Please check the console.</p>");
    }


    // --- Post-Results Logic ---
    // AI roster management
    gameState.teams.filter(t => t.id !== gameState.playerTeam.id).forEach(team => {
        try { Game.aiManageRoster(team); } catch(e) { console.error(`Error during AI roster management for ${team.name}:`, e)}
    });
    // Generate new Free Agents for the upcoming week
    Game.generateWeeklyFreeAgents();

    // Refresh game state and dashboard UI
    gameState = Game.getGameState(); // Refresh state *after* AI actions
    UI.renderDashboard(gameState);
    const activeTabEl = document.querySelector('#dashboard-tabs .tab-button.active');
    const activeTab = activeTabEl ? activeTabEl.dataset.tab : 'my-team';
    UI.switchTab(activeTab, gameState); // Re-render current tab
    UI.showScreen('dashboardScreen'); // Ensure dashboard is visible

    // Check if season ended AFTER this week's simulation completed
    if (gameState.currentWeek >= WEEKS_IN_SEASON) {
         handleSeasonEnd(); // Go directly to offseason screen
         return; // Skip friend call prompt
    }

    // Prompt player to call a friend if roster is short
    const hasUnavailablePlayer = gameState.playerTeam.roster.some(p => p.status.duration > 0);
    const healthyCount = gameState.playerTeam.roster.filter(p => p.status.duration === 0).length;
    if (hasUnavailablePlayer && healthyCount < MIN_HEALTHY_PLAYERS) {
        promptCallFriend();
    }
}

/**
 * Handles the end of the regular season, advances to offseason, and shows the offseason report.
 */
function handleSeasonEnd() {
    try {
        const offseasonReport = Game.advanceToOffseason(); // Process aging, development, retirements, rookies
        gameState = Game.getGameState(); // Get updated state
        if (!gameState) throw new Error("Game state lost after advancing to offseason.");
        UI.renderOffseasonScreen(offseasonReport, gameState.year); // Display report
        UI.showScreen('offseasonScreen'); // Show offseason screen
    } catch(error) {
        console.error("Error during offseason processing:", error);
        UI.showModal("Offseason Error", `Could not process offseason: ${error.message}. Please check console.`, null,'',null,'Close');
    }
}

/**
 * Handles the 'Proceed to Next Draft' button click on the offseason screen.
 */
function handleGoToNextDraft() {
    try {
        Game.setupDraft(); // Setup draft based on last season's results
        gameState = Game.getGameState(); // Refresh state
        if (!gameState) throw new Error("Game state lost after setting up next draft.");
        selectedPlayerId = null; // Reset draft selection
        UI.renderSelectedPlayerCard(null, gameState); // Clear player card
        UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId); // Render draft UI
        UI.showScreen('draftScreen'); // Show draft screen
        runAIDraftPicks(); // Start AI picks
    } catch (error) {
        console.error("Error proceeding to next draft:", error);
        UI.showModal("Draft Setup Error", `Could not start next draft: ${error.message}.`, null,'',null,'Close');
    }
}

/**
 * Placeholder for potential future click handlers within the main dashboard content area.
 * @param {Event} e - The click event.
 */
function handleDashboardClicks(e) {
    const target = e.target;
    // Example: Could handle clicks on player names in tables, etc.
    // Call friend button clicks are now handled inside promptCallFriend's modal listener setup
}

/**
 * Re-renders the player stats tab when filters or sorting change.
 */
function handleStatsChange() {
    if (!gameState) {
        console.error("Cannot update stats: Game state not available.");
        return;
    }
    UI.switchTab('player-stats', gameState); // Simply re-render the stats tab
}

/**
 * Handles clicking on a message in the messages list. Shows message content in a modal.
 * @param {string} messageId - The ID of the clicked message.
 */
function handleMessageClick(messageId) {
     if (!gameState || !gameState.messages) {
         console.error("Cannot handle message click: Game state or messages not available.");
         return;
     }
    const message = gameState.messages.find(m => m.id === messageId);
    if (message) {
        UI.showModal(message.subject, `<p class="whitespace-pre-wrap">${message.body}</p>`);
        Game.markMessageAsRead(messageId); // Update game state
        // Re-render messages tab immediately to show read status and update dot
        UI.renderMessagesTab(gameState); // Re-render the list
        UI.updateMessagesNotification(gameState.messages); // Update the notification dot
    } else {
        console.warn(`Message with ID ${messageId} not found.`);
    }
}

/**
 * Builds the HTML content for the 'Call Friend' modal body.
 * @param {Array} freeAgents - List of available free agent players.
 * @returns {string} HTML string for the modal body.
 */
function buildCallFriendModalHtml(freeAgents) {
    let html = '<div class="mt-4 space-y-2">';
    freeAgents.forEach(p => {
        // Calculate best overall for display purposes
        const bestPos = Object.keys(positionOverallWeights).reduce((best, pos) => {
            const currentOvr = Game.calculateOverall(p, pos);
            return currentOvr > best.ovr ? { pos, ovr: currentOvr } : best;
        }, { pos: 'N/A', ovr: 0 });

        html += `
            <div class="flex items-center justify-between p-2 bg-gray-100 rounded">
                <div>
                    <p class="font-bold">${p.name}</p>
                    <p class="text-sm text-gray-600">${p.relationship} (Best: ${bestPos.pos} - ${bestPos.ovr} Ovr)</p>
                </div>
                <button data-player-id="${p.id}" class="call-friend-btn bg-green-500 hover:bg-green-600 text-white px-3 py-1 text-xs rounded font-semibold">CALL</button>
            </div>
        `;
    });
    html += `</div>`;
    return html;
}

/**
 * Displays a modal allowing the player to call a free agent friend if their roster is short.
 */
function promptCallFriend() {
    gameState = Game.getGameState(); // Ensure state is fresh
     if (!gameState || !gameState.playerTeam || !gameState.playerTeam.roster) {
         console.error("Cannot prompt call friend: Invalid game state.");
         return;
       }

    const { freeAgents, playerTeam } = gameState;
    const unavailableCount = playerTeam.roster.filter(p => p.status.duration > 0).length;
    const healthyCount = playerTeam.roster.length - unavailableCount;

    // Exit if not needed or no free agents available
      if (healthyCount >= MIN_HEALTHY_PLAYERS || !freeAgents || freeAgents.length === 0) {
        if (healthyCount < MIN_HEALTHY_PLAYERS && (!freeAgents || freeAgents.length === 0)) {
            console.log("Roster short, but no free agents available to call.");
            // Optionally add a game message if Game.addMessage is exported
            // if (Game.addMessage) Game.addMessage("No Friends Available", "Your roster is short, but no friends were available this week.");
        }
        return;
    }

    // Build modal content
    const modalBodyIntro = `<p>You only have ${healthyCount} healthy players available for the next game! Call a friend to fill in?</p>`;
    const friendListHtml = buildCallFriendModalHtml(freeAgents);
    const modalBody = modalBodyIntro + friendListHtml;


    // Show the modal - Only provide a close/cancel button initially
    UI.showModal("Call a Friend?", modalBody, null, '', null, 'Maybe Later');

    // Add event listeners to the 'CALL' buttons *within this specific modal instance*
    const modalElement = document.getElementById('modal');
    if (!modalElement) return; // Exit if modal doesn't exist

    const callButtons = modalElement.querySelectorAll('.call-friend-btn');

    // Define the handler function (needs to be defined here to be removed correctly)
    const callButtonClickHandler = (e) => {
        const playerId = e.target.dataset.playerId;
        if (!playerId) return; // Exit if button doesn't have ID

        const result = Game.callFriend(playerId); // Attempt to call friend
        UI.hideModal(); // Close the 'Call Friend' selection modal

        // Show the result in a *new* modal after a brief delay
        setTimeout(() => {
            UI.showModal("Call Result", `<p>${result.message}</p>`);
             // Update game state and refresh the currently active dashboard tab
            gameState = Game.getGameState();
            if (!gameState) return; // Check state again
             const activeTabEl = document.querySelector('#dashboard-tabs .tab-button.active');
             const activeTab = activeTabEl ? activeTabEl.dataset.tab : 'my-team';
             UI.switchTab(activeTab, gameState);
        }, 100); // Delay allows the first modal to fully close visually
    };

    // Attach the handler to each button using event delegation on the modal body for robustness
    // This avoids issues with cloning/replacing nodes inside the modal body
    const modalBodyElement = document.getElementById('modal-body');
      if(modalBodyElement) {
          // Remove previous listener if exists (safer for potential re-calls)
          modalBodyElement.removeEventListener('click', callButtonDelegationHandler);
          modalBodyElement.addEventListener('click', callButtonDelegationHandler);
      }

      function callButtonDelegationHandler(e) {
          if (e.target.matches('.call-friend-btn')) {
              callButtonClickHandler(e);
              // Once handled, remove the listener to prevent memory leaks
               modalBodyElement.removeEventListener('click', callButtonDelegationHandler);
          }
      }
}


/**
 * Main function to initialize the game and set up event listeners.
 */
function main() {
    console.log("Game starting... Document loaded.");
    try {
        UI.setupElements(); // Get references to all DOM elements

        // --- Setup Global Event Listeners ---
        // Screen Navigation Buttons
        document.getElementById('start-game-btn')?.addEventListener('click', startNewGame);
        document.getElementById('confirm-team-btn')?.addEventListener('click', handleConfirmTeam);
        document.getElementById('draft-player-btn')?.addEventListener('click', handleDraftPlayer);
        document.getElementById('advance-week-btn')?.addEventListener('click', handleAdvanceWeek);
        document.getElementById('go-to-next-draft-btn')?.addEventListener('click', handleGoToNextDraft);

        // Live Game Simulation Controls
        document.getElementById('sim-skip-btn')?.addEventListener('click', () => {
             // Pass the stored game result for the *current* live sim to the skip function
             if (currentLiveSimResult) {
                 UI.skipLiveGameSim(currentLiveSimResult); // Pass the result for final score display
             } else {
                 console.warn("Skip button clicked, but no live sim result available.");
                 UI.skipLiveGameSim(); // Call skip without result
             }
        });
        document.getElementById('sim-speed-play')?.addEventListener('click', () => UI.setSimSpeed(1000));
        document.getElementById('sim-speed-fast')?.addEventListener('click', () => UI.setSimSpeed(400));
        document.getElementById('sim-speed-faster')?.addEventListener('click', () => UI.setSimSpeed(100));

        // Dashboard Navigation and Content Interaction
        document.getElementById('dashboard-tabs')?.addEventListener('click', handleTabSwitch);
        document.getElementById('dashboard-content')?.addEventListener('click', handleDashboardClicks); // General clicks inside content area
        // Use event delegation for dynamically added message items
        document.getElementById('messages-list')?.addEventListener('click', (e) => {
             const messageItem = e.target.closest('.message-item');
             if (messageItem && messageItem.dataset.messageId) { // Ensure it has the ID
                 handleMessageClick(messageItem.dataset.messageId);
             }
        });

        // Draft Filters/Sorting (Using debounced for search)
        document.getElementById('draft-search')?.addEventListener('input', () => { if(gameState) UI.debouncedRenderDraftPool(gameState, handlePlayerSelectInDraft); });
        document.getElementById('draft-filter-pos')?.addEventListener('change', () => { if(gameState) UI.renderDraftPool(gameState, handlePlayerSelectInDraft); });
        document.getElementById('draft-sort')?.addEventListener('change', () => { if(gameState) UI.renderDraftPool(gameState, handlePlayerSelectInDraft); });

        // Depth Chart Formation Changes
        document.getElementById('offense-formation-select')?.addEventListener('change', handleFormationChange);
        document.getElementById('defense-formation-select')?.addEventListener('change', handleFormationChange);

        // Player Stats Filters/Sorting
        document.getElementById('stats-filter-team')?.addEventListener('change', handleStatsChange);
        document.getElementById('stats-sort')?.addEventListener('change', handleStatsChange);

        // Setup Complex UI Interactions
        UI.setupDragAndDrop(handleDepthChartDrop);
        UI.setupDepthChartTabs();

        // Show the initial screen
        UI.showScreen('startScreen');

    } catch (error) {
        // --- Graceful Initialization Error Handling ---
        console.error("Fatal error during initialization:", error);
         const body = document.body;
         if (body) {
             body.innerHTML = `<div style="padding: 20px; color: #b91c1c; background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; font-family: sans-serif;">
                                 <h1 style="font-size: 1.5em; margin-bottom: 10px; color: #991b1b;">Initialization Error</h1>
                                 <p>We're sorry, but the game couldn't start due to an unexpected error.</p>
                                 <p>Please try refreshing the page. If the problem persists, check the browser console (usually by pressing F12) for more technical details.</p>
                                 <pre style="margin-top: 15px; padding: 10px; background-color: #fee2e2; border-radius: 4px; font-size: 0.9em; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word;">${error.stack || error.message}</pre>
                               </div>`;
         }
         // --- End Graceful Error Handling ---
    }
}

// Start the application once the DOM is fully loaded
document.addEventListener('DOMContentLoaded', main);
