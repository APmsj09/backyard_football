// main.js
import * as Game from './game.js';
import * as UI from './ui.js';
import { positionOverallWeights } from './game/player.js';
import { relationshipLevels } from './data.js'; // Added this line
import { formatHeight } from './utils.js'; // <<< --- ADD THIS LINE ---

let gameState = null;
let selectedPlayerId = null;
let currentLiveSimResult = null; // Store result for potential skip
let currentSortColumn = 'potential'; // Default sort
let currentSortDirection = 'desc';   // Default direction

// --- Constants ---
const ROSTER_LIMIT = 10;
const MIN_HEALTHY_PLAYERS = 7;
const WEEKS_IN_SEASON = 9; // Number of weeks in the regular season

// --- Event Handlers ---
/** Yields control to the main thread briefly. */
function yieldToMain() { return new Promise(resolve => setTimeout(resolve, 0)); }

/**
 * Initializes the league and navigates to the team creation screen.
 */
async function startNewGame() {
  try {
    // Show the loading screen + start animated messages
    UI.showScreen("loading-screen");
    UI.startLoadingMessages();

    // Small delay to ensure the UI renders before the heavy work starts
    await new Promise(resolve => setTimeout(resolve, 50));

    // Initialize the game world and update the progress bar
    await Game.initializeLeague(UI.updateLoadingProgress);

    // Stop rotating messages when done
    UI.stopLoadingMessages();

    // Retrieve the generated game state
    gameState = Game.getGameState();
    if (!gameState) throw new Error("Failed to get game state after initialization.");

    // Prepare team name suggestions
    UI.renderTeamNameSuggestions(
      ['Jets', 'Sharks', 'Tigers', 'Bulldogs', 'Panthers', 'Giants'],
      handleTeamNameSelection
    );

    // Transition to team creation screen
    UI.showScreen('team-creation-screen');
  } catch (error) {
    console.error("Error starting game:", error);
    UI.stopLoadingMessages(); // <-- make sure to stop them if something fails
    UI.showModal(
      "Error",
      `Could not start a new game: ${error.message}. Please check the console for details.`,
      null,
      '',
      null,
      'Close'
    );
  }
}


/**
 * Updates the custom team name input when a suggestion is clicked.
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
            Game.createPlayerTeam(customName);
            Game.setupDraft();
            gameState = Game.getGameState(); // Includes playerTeam and global relationships map
            if (!gameState || !gameState.playerTeam) throw new Error("Failed to get game state after creating team.");
            UI.renderSelectedPlayerCard(null, gameState); // Pass gameState
            UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId, currentSortColumn, currentSortDirection, positionOverallWeights);
            UI.showScreen('draftScreen');
            runAIDraftPicks();
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
 */
function handlePlayerSelectInDraft(playerId) {
    if (!gameState || !gameState.players) {
        console.error("Cannot select player: Game state or players list not available.");
        return;
    }
    selectedPlayerId = playerId;
    const player = gameState.players.find(p => p.id === playerId);
    UI.updateSelectedPlayerRow(playerId);
    // Pass original player object and gameState (needed for relationships/scouting inside renderSelectedPlayerCard)
    UI.renderSelectedPlayerCard(player, gameState, positionOverallWeights);
}

/**
 * Handles the 'Draft Player' button click.
 */
function handleDraftPlayer() {
    if (!gameState || !gameState.playerTeam || !gameState.players) {
        console.error("Cannot draft player: Game state invalid.");
        return;
    }
    if (selectedPlayerId) {
        const player = gameState.players.find(p => p.id === selectedPlayerId);
        const team = gameState.playerTeam;
        if (team.roster.length >= ROSTER_LIMIT) {
            UI.showModal("Roster Full", `<p>Your roster is full (${ROSTER_LIMIT} players)! You cannot draft more players.</p>`);
            return;
        }

        if (player && Game.addPlayerToTeam(player, team)) {
            selectedPlayerId = null;
            gameState.currentPick++;
            UI.renderSelectedPlayerCard(null, gameState, positionOverallWeights);
            runAIDraftPicks(); // Continue draft
        } else {
            console.error(`Failed to add player ${selectedPlayerId} to team or player not found.`);
            UI.showModal("Draft Error", "Could not draft the selected player. Please check the console.", null, '', null, 'Close');
        }
    } else {
        console.warn("Draft Player button clicked but no player selected.");
    }
}

/**
 * Simulates AI draft picks until it's the player's turn or the draft ends.
 * Includes fix for potential infinite loop when skipping player picks.
 */
async function runAIDraftPicks() {
    if (!gameState || !gameState.teams || !gameState.players || !gameState.draftOrder || !gameState.playerTeam) {
        console.error("Cannot run AI draft picks: Game state invalid.");
        return; // Stop if game state is broken
    }
    // Helper function to check draft completion conditions
    const checkDraftEnd = () => {
        // Safety check for invalid game state
        if (!gameState.draftOrder || !gameState.players || !gameState.teams) {
            console.error("Invalid game state in checkDraftEnd");
            return true; // End draft if game state is invalid
        }

        // Condition 1: Current pick exceeds the total number of picks in the defined order
        const pickLimitReached = gameState.currentPick >= gameState.draftOrder.length;

        // Condition 2: No more players available to draft
        const noPlayersLeft = gameState.players.filter(p => p && !p.teamId).length === 0;

        // Condition 3: All valid teams have filled their roster
        const allTeamsFull = gameState.teams.every(t => !t || !t.roster || t.roster.length >= ROSTER_LIMIT);

        // Debug logging
        if (pickLimitReached) console.log("Draft ending: Pick limit reached");
        if (noPlayersLeft) console.log("Draft ending: No undrafted players left");
        if (allTeamsFull) console.log("Draft ending: All teams have full rosters");

        // Draft ends if any of these conditions are true
        return pickLimitReached || noPlayersLeft || allTeamsFull;
    };

    // Add safety counter to prevent infinite loops
    let safetyCounter = 0;
    const MAX_PICKS_WITHOUT_PROGRESS = 50;

    // Helper to advance pick safely and clamp to draftOrder length
    const advancePick = () => {
        if (!gameState) return;
        gameState.currentPick = (gameState.currentPick || 0) + 1;
        if (gameState.draftOrder && gameState.currentPick > gameState.draftOrder.length) gameState.currentPick = gameState.draftOrder.length;
    };

    if (checkDraftEnd()) {
        console.log("Draft end condition met before AI picks.");
        handleDraftEnd(); // Ensure draft end logic runs if condition met immediately
        return;
    }

    let currentPickingTeam = gameState.draftOrder[gameState.currentPick];

    // Loop while it's an AI team's turn and the draft isn't over
    while (currentPickingTeam && currentPickingTeam.id !== gameState.playerTeam.id) {
        // Safety check to prevent infinite loops
        if (safetyCounter++ > MAX_PICKS_WITHOUT_PROGRESS) {
            console.error("Draft appears stuck - forcing end");
            handleDraftEnd();
            return;
        }

        // Skip invalid teams or teams with full rosters
        if (!currentPickingTeam || !currentPickingTeam.roster || currentPickingTeam.roster.length >= ROSTER_LIMIT) {
            console.log(`Skipping pick for ${currentPickingTeam?.name || 'invalid team'} (roster full or invalid team)`);
            advancePick();
            currentPickingTeam = gameState.draftOrder[gameState.currentPick];
            continue;
        }

        UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId, currentSortColumn, currentSortDirection, positionOverallWeights);
        await new Promise(resolve => setTimeout(resolve, 50)); // Short delay for visual feedback

        const result = Game.simulateAIPick(currentPickingTeam);
        if (result) safetyCounter = 0; // Reset counter if a pick was made successfully
        advancePick();

        if (checkDraftEnd()) {
            handleDraftEnd(); // End draft immediately if conditions met
            return;
        }

        // Get next picking team, handle potential end of draft order
        currentPickingTeam = gameState.draftOrder[gameState.currentPick];
    }

    // Player's turn (or draft ended while AI was picking)
    if (!checkDraftEnd()) {
        // If player's team roster is full, automatically skip their pick
        if (gameState.playerTeam.roster.length >= ROSTER_LIMIT) {
            console.log("Player roster full, skipping pick.");
            advancePick();
            // Check if skipping ended the draft (Fix for loop)
            if (checkDraftEnd()) {
                handleDraftEnd();
            } else {
                runAIDraftPicks(); // Go back to simulating AI picks ONLY if draft isn't over
            }
        } else { // Render for player input
            UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId, currentSortColumn, currentSortDirection, positionOverallWeights);
        }
    } else { // Draft ended, call handler
        handleDraftEnd();
    }
}


/**
 * Finalizes the draft, sets depth charts, generates schedule, navigates to dashboard.
 */
async function handleDraftEnd() {
    console.log("Draft has concluded.");
    if (!gameState || !gameState.teams) {
        console.error("Cannot end draft: Game state invalid.");
        return;
    }

    // --- FIX: Show the modal *before* doing the heavy lifting ---
    console.log("Showing draft completion modal...");

    // Make an idempotent finalizer so we can auto-run it after background work or via the modal confirm
    let _draftFinalized = false;
    const finalizeDraft = async () => {
        if (_draftFinalized) return;
        _draftFinalized = true;
        console.log("Finalizing draft and transitioning to dashboard...");
        try {
            Game.generateSchedule();
            gameState = Game.getGameState();
            if (!gameState) throw new Error("Failed to get game state after schedule generation.");
            UI.renderDashboard(gameState);
            UI.switchTab('my-team', gameState);
            UI.showScreen('dashboard-screen');
            // Hide modal if still visible
            try { UI.hideModal(); } catch (e) { /* ignore */ }
        } catch (error) {
            console.error("Error transitioning to dashboard after draft:", error);
            UI.showModal("Error", `Could not proceed to season: ${error.message}.`, null, '', null, 'Close');
        }
    };

    // Show modal with confirm wired to finalizeDraft
    UI.showModal("Draft Complete!", "<p>Finalizing rosters and generating schedule... Please wait.</p>", finalizeDraft, "Start Season");

    // --- Now, do the slow part *after* showing the modal ---
    // 1. Get the modal button and disable it
    const modalConfirmBtn = document.querySelector('#modal-actions button.bg-amber-500');
    if (modalConfirmBtn) {
        modalConfirmBtn.disabled = true;
        modalConfirmBtn.textContent = "Loading...";
    }

    // 2. Yield to let the UI update (show the modal)
    await yieldToMain();

    // 3. Set depth charts (the slow part)
    console.log("Setting depth charts in the background...");
    for (const team of gameState.teams) {
        if (!team) continue;
        try {
            Game.aiSetDepthChart(team);
        } catch (error) {
            console.error(`Error setting depth chart for ${team.name}:`, error);
        }
    }

    // 4. Update the modal text and re-enable the button
    console.log("Depth charts set.");
    const modalBody = document.getElementById('modal-body');
    if (modalBody) {
        modalBody.innerHTML = "<p>The draft has concluded. Get ready for the season!</p>";
    }
    if (modalConfirmBtn) {
        modalConfirmBtn.disabled = false;
        modalConfirmBtn.textContent = "Start Season";
    }

    // Auto-finalize draft so the game progresses even if the user doesn't click
    try {
        await yieldToMain();
        finalizeDraft();
    } catch (e) { console.error('Auto-finalize draft error:', e); }
}
/**
 * A generic function to load a game from a save key and navigate to the correct screen.
 * @param {string} [saveKey] - The localStorage key to load. Defaults to the main save.
 */
async function handleLoadGame(saveKey) { // <<< --- "async" KEYWORD ADDED HERE
    console.log(`Attempting to load from key: ${saveKey || 'default'}`);
    try {
        // 1. Call the load function
        // We pass 'saveKey' (which is undefined for the default "Load Game" button)
        const loadedState = Game.loadGameState(saveKey);

        // 2. Check if it worked
        if (!loadedState || !loadedState.teams || loadedState.teams.length === 0) {
            UI.showModal("Load Failed", "<p>No saved game data was found.</p>");
            return;
        }

        // 3. Set the global gameState
        gameState = loadedState;
        selectedPlayerId = null; // Clear any old selection

        // 4. Navigate to the correct screen
        if (gameState.currentWeek >= 0) {
            // Game is in progress, go to dashboard
            console.log("Save file found (in-season). Loading dashboard...");
            UI.renderDashboard(gameState);
            UI.switchTab('my-team', gameState);
            UI.showScreen('dashboard-screen');
        } else {
            // Game is in the middle of a draft
            console.log("Save file found (mid-draft). Loading draft screen...");

            // This 'await' is why the function must be async
            const { positionOverallWeights } = await import('./game/player.js');

            UI.renderSelectedPlayerCard(null, gameState, positionOverallWeights);
            UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId, currentSortColumn, currentSortDirection, positionOverallWeights);
            UI.showScreen('draftScreen');
            // We do NOT call runAIDraftPicks, just load the state
        }
    } catch (error) {
        console.error("Error loading game:", error);
        UI.showModal("Error", `Could not load game data: ${error.message}`, null, '', null, 'Close');
    }
}

/**
 * Handles the "Load Test Roster" button click.
 * This is just a wrapper for handleLoadGame with a specific key.
 */
async function handleLoadTestRoster() { // <<< --- "async" KEYWORD ADDED HERE
    await handleLoadGame('my_test_roster');
}

/**
 * Handles the "Save as Test Roster" button click.
 */
function handleSaveTestRoster() {
    // ... (this function is fine as-is)
    if (!gameState) {
        UI.showModal("Save Failed", "<p>No game data to save.</p>");
        return;
    }

    Game.saveGameState('my_test_roster');

    UI.showModal("Test Roster Saved", "<p>Your current game state has been saved as the 'Test Roster'. You can now load it from the start screen.</p>");
}

/**
 * Handles clicks on dashboard navigation tabs.
 */
function handleTabSwitch(e) {
    if (e.target.matches('.tab-button')) {
        const tabId = e.target.dataset.tab;

        // --- THIS IS THE FIX ---
        // Force a refresh of the gameState variable from the source
        // to ensure we have the absolute latest version.
        gameState = Game.getGameState();
        // --- END FIX ---

        if (!gameState) {
            console.error("Cannot switch tab: Game state not available.");
            return;
        }
        UI.switchTab(tabId, gameState); // Pass the freshly-fetched gameState
    }
}

/**
 * Handles depth chart drop event.
 */
function handleDepthChartDrop(playerId, newPositionSlot, side) {
    if (!gameState) {
        console.error("Cannot update depth chart: Game state not available.");
        return;
    }
    Game.updateDepthChart(playerId, newPositionSlot, side);
    gameState = Game.getGameState();
    Game.saveGameState();
    UI.switchTab('depth-chart', gameState); // Re-render tab with updated state
}

/**
 * Handles formation change event.
 */
function handleFormationChange(e) {
    if (!gameState) {
        console.error("Cannot change formation: Game state not available.");
        return;
    }
    const side = e.target.id.includes('offense') ? 'offense' : 'defense';
    const formationName = e.target.value;
    Game.changeFormation(side, formationName);
    gameState = Game.getGameState();
    Game.saveGameState();
    UI.switchTab('depth-chart', gameState); // Re-render tab
}

/**
 * Handles 'Advance Week' / 'Go to Offseason' button click.
 */
async function handleAdvanceWeek() {
    if (!gameState || !gameState.schedule || !gameState.teams || !gameState.playerTeam) {
        console.error("Cannot advance week: Game state invalid.");
        UI.showModal("Error", "Cannot advance week due to invalid game state.", null, '', null, 'Close');
        return;
    }
    if (gameState.currentWeek >= WEEKS_IN_SEASON) { handleSeasonEnd(); return; }

    // Find player's game
    const gamesPerWeek = gameState.teams.length / 2;
    const weekStartIndex = gameState.currentWeek * gamesPerWeek;
    const weekEndIndex = weekStartIndex + gamesPerWeek;
    const playerGameMatch = gameState.schedule.slice(weekStartIndex, weekEndIndex)
        .find(g => g && g.home && g.away && (g.home.id === gameState.playerTeam.id || g.away.id === gameState.playerTeam.id)); // Added safety checks

    if (playerGameMatch) { // Game day
        UI.showModal("Game Day!",
            `<p>It's Week ${gameState.currentWeek + 1}! Your opponent is <strong>${playerGameMatch.home.id === gameState.playerTeam.id ? playerGameMatch.away.name : playerGameMatch.home.name}</strong>.</p>`,
            () => startLiveGame(playerGameMatch), "Watch Game Live",
            () => simulateRestOfWeek(), "Sim Week"
        );
    } else { // Bye week or error
        console.warn(`No game found for player team in Week ${gameState.currentWeek + 1}. Simulating week.`);
        simulateRestOfWeek();
    }
}

/**
 * Simulates week's games instantly, stores player result, starts live sim UI.
 */
function startLiveGame(playerGameMatch) {
    console.log("Simulating week's games before starting live view...");
    if (!gameState || !gameState.schedule || !gameState.teams) {
        console.error("Cannot start live game: Invalid game state.");
        return;
    }
    currentLiveSimResult = null;
    const gamesPerWeek = gameState.teams.length / 2;
    const allGames = gameState.schedule.slice(gameState.currentWeek * gamesPerWeek, (gameState.currentWeek + 1) * gamesPerWeek);
    let allResults = [];

    // Simulate all games
    allGames.forEach(match => {
        try {
            if (!match || !match.home || !match.away) { // Added !match check
                console.error("Skipping simulation due to invalid match data:", match);
                return;
            }
            // Use fastSim for all games except the one being watched
            const isPlayerGame = match.home.id === playerGameMatch.home.id && match.away.id === playerGameMatch.away.id;
            const result = Game.simulateGame(match.home, match.away, { fastSim: !isPlayerGame });
            if (!result) throw new Error("simulateGame returned null or undefined."); // Check result validity

            allResults.push(result);
            // Handle breakthroughs for player messages
            if (result.breakthroughs && Array.isArray(result.breakthroughs)) { // Check breakthroughs is array
                result.breakthroughs.forEach(b => {
                    if (b && b.player && b.player.teamId === gameState.playerTeam?.id) { // Added checks for b and b.player
                        // Use Game.addMessage if available
                        if (typeof Game.addMessage === 'function') { // Check type explicitly
                            Game.addMessage("Player Breakthrough!", `${b.player.name} improved ${b.attr}!`);
                        } else { console.log(`Player Breakthrough: ${b.player.name} improved ${b.attr}! (addMessage not found/exported)`); }
                    }
                });
            }
            // Store player's game result
            if (isPlayerGame) {
                currentLiveSimResult = result;
            }
        } catch (error) {
            const awayName = match && match.away ? match.away.name : '?';
            const homeName = match && match.home ? match.home.name : '?';
            console.error(`Error simulating game during live sim week (${awayName} @ ${homeName}):`, error);
        }
    });

    // Update state and start UI
    if (!gameState.gameResults) gameState.gameResults = [];

    // --- THIS IS THE FIX ---
    // We must save a minimal version of the result
    const minimalResults = allResults.filter(Boolean).map(r => ({
        homeTeam: { id: r.homeTeam.id, name: r.homeTeam.name },
        awayTeam: { id: r.awayTeam.id, name: r.awayTeam.name },
        homeScore: r.homeScore,
        awayScore: r.awayScore
    }));
    gameState.gameResults.push(...minimalResults);
    // --- END FIX ---

    gameState.currentWeek++;

    if (currentLiveSimResult) {
        UI.showScreen('gameSimScreen');
        UI.startLiveGameSim(currentLiveSimResult, () => { // Pass full result
            console.log("Live sim finished or skipped.");
            finishWeekSimulation(allResults.filter(Boolean)); // Pass valid results
            currentLiveSimResult = null; // Clear after use
        });
    } else {
        console.error("Player game result not found or failed simulation. Proceeding without live view.");
        finishWeekSimulation(allResults.filter(Boolean)); // Process valid results
    }
}


/**
 * Simulates the entire week's games instantly.
 */
function simulateRestOfWeek() {
    console.log("Simulating entire week...");
    let results = null;
    try {
        if (!gameState || gameState.currentWeek >= WEEKS_IN_SEASON) {
            console.log("Attempted to simulate week, but season is already over or state invalid.");
            if (gameState) handleSeasonEnd(); // Only call if gameState exists
            return;
        }
        // Patch: Use fastSim for all games in simulateWeek
        if (typeof Game.simulateWeek === 'function') {
            results = Game.simulateWeek({ fastSim: true });
        } else {
            // Fallback: If simulateWeek does not support options, use normal
            results = Game.simulateWeek();
        }
    } catch (error) {
        console.error(`Error during Game.simulateWeek (Week ${gameState?.currentWeek + 1}):`, error); // Safe access currentWeek
        UI.showModal("Simulation Error", "An error occurred during week simulation. Check console.", null, '', null, 'OK');
        if (gameState) gameState.currentWeek++; // Cautiously advance week
        results = []; // Treat as empty results
    }

    if (results !== null) { // simulateWeek returns null if season ended BEFORE sim
        finishWeekSimulation(results);
    } else if (gameState && gameState.currentWeek >= WEEKS_IN_SEASON) { // Season ended AFTER sim attempt
        handleSeasonEnd();
    } else { // simulateWeek returned null unexpectedly or critical error
        console.error("simulateWeek finished unexpectedly or errored mid-season.");
        gameState = Game.getGameState(); // Attempt to refresh state
        if (gameState) {
            UI.renderDashboard(gameState);
            UI.showScreen('dashboardScreen');
        } else {
            UI.showModal("Critical Error", "Game state lost after simulation error. Please refresh.", null, '', null, 'OK');
        }
    }
}

/** Builds HTML for weekly results modal. */
function buildResultsModalHtml(results) {
    if (!gameState || !gameState.playerTeam) return "<p>Error displaying results: Game state missing.</p>";
    if (!Array.isArray(results)) return "<p>Error: Invalid results data.</p>";

    const playerGame = results.find(r => r && (r.homeTeam?.id === gameState.playerTeam.id || r.awayTeam?.id === gameState.playerTeam.id));
    const playerTeamResultText = playerGame
        ? (playerGame.homeTeam.id === gameState.playerTeam.id
            ? (playerGame.homeScore > playerGame.awayScore ? 'WON' : (playerGame.homeScore < playerGame.awayScore ? 'LOST' : 'TIED'))
            : (playerGame.awayScore > playerGame.homeScore ? 'WON' : (playerGame.awayScore < playerGame.homeScore ? 'LOST' : 'TIED')))
        : 'BYE / Error?';

    const breakthroughs = Game.getBreakthroughs() || [];

    let html = `<h4>Your Result: ${playerTeamResultText}</h4>`;
    if (playerGame) {
        html += `<p>${playerGame.awayTeam?.name || '?'} ${playerGame.awayScore ?? '?'} @ ${playerGame.homeTeam?.name || '?'} ${playerGame.homeScore ?? '?'}</p>`;
    }
    html += '<h4 class="mt-4">All Weekly Results</h4><div class="space-y-1 text-sm mt-2">';
    results.forEach(r => {
        if (!r || !r.homeTeam || !r.awayTeam) return;
        const isPlayerGame = r.homeTeam.id === gameState.playerTeam.id || r.awayTeam.id === gameState.playerTeam.id;
        html += `<p class="${isPlayerGame ? 'font-bold text-amber-600' : ''}">${r.awayTeam.name} ${r.awayScore ?? '?'} @ ${r.homeTeam.name} ${r.homeScore ?? '?'}</p>`;
    });
    html += '</div>';

    if (breakthroughs.length > 0) {
        html += `<h4 class="font-bold mt-4 mb-2">Player Breakthroughs!</h4><div class="space-y-1 text-sm">`;
        breakthroughs.forEach(b => {
            if (!b || !b.player) return;
            const isUserPlayer = b.player.teamId === gameState.playerTeam?.id;
            html += `<p class=${isUserPlayer ? '"font-semibold"' : ''}><strong>${b.player.name}</strong> (${b.teamName || 'Your Team'}) improved their <strong>${b.attr}</strong>!</p>`;
        });
        html += `</div>`;
    }
    return html;
}

/** Processes results, updates UI, triggers AI actions, prompts call friend. */
function finishWeekSimulation(results) {
    if (!gameState || !gameState.teams || !gameState.playerTeam || !gameState.playerTeam.roster) {
        console.error("Cannot finish week simulation: Game state invalid.");
        gameState = Game.getGameState();
        if (gameState) { UI.renderDashboard(gameState); UI.showScreen('dashboardScreen'); }
        else { UI.showModal("Critical Error", "Game state lost. Please refresh.", null, '', null, 'OK'); }
        return;
    }
    // Show results modal
    if (results && results.length > 0) {
        const resultsHtml = buildResultsModalHtml(results);
        UI.showModal(`Week ${gameState.currentWeek} Results`, resultsHtml); // currentWeek was already advanced
    } else {
        console.warn("finishWeekSimulation called with no valid game results.");
        UI.showModal(`Week ${gameState.currentWeek} Advanced`, "<p>The week has advanced, but no game results were found.</p>");
    }

    // Post-Results Logic
    gameState.teams.filter(t => t && t.id !== gameState.playerTeam.id).forEach(team => {
        try { Game.aiManageRoster(team); } catch (e) { console.error(`Error during AI roster management for ${team.name}:`, e) }
    });
    Game.generateWeeklyFreeAgents();


    // Refresh state and UI
    gameState = Game.getGameState();
    if (!gameState) { UI.showModal("Critical Error", "Game state lost after AI management. Please refresh.", null, '', null, 'OK'); return; }

    UI.renderDashboard(gameState);
    const activeTabEl = document.querySelector('#dashboard-tabs .tab-button.active');
    const activeTab = activeTabEl ? activeTabEl.dataset.tab : 'my-team';
    UI.switchTab(activeTab, gameState);
    UI.showScreen('dashboardScreen');

    if (gameState.currentWeek >= WEEKS_IN_SEASON) { handleSeasonEnd(); return; }

    // Prompt call friend if needed
    const hasUnavailablePlayer = gameState.playerTeam.roster.some(p => p && p.status?.duration > 0);
    const healthyCount = gameState.playerTeam.roster.filter(p => p && p.status?.duration === 0).length;
    if (hasUnavailablePlayer && healthyCount < MIN_HEALTHY_PLAYERS) {
        promptCallFriend();
    }
}

/** Handles end of season logic. */
function handleSeasonEnd() {
    try {
        const offseasonReport = Game.advanceToOffseason();
        gameState = Game.getGameState();
        if (!gameState) throw new Error("Game state lost after advancing to offseason.");
        UI.renderOffseasonScreen(offseasonReport, gameState.year);
        UI.showScreen('offseasonScreen');
    } catch (error) {
        console.error("Error during offseason processing:", error);
        UI.showModal("Offseason Error", `Could not process offseason: ${error.message}. Check console.`, null, '', null, 'Close');
    }
}

/** Handles proceeding to next draft from offseason screen. */
function handleGoToNextDraft() {
    try {
        Game.setupDraft(); // Set up the draft order and rounds
        gameState = Game.getGameState(); // Refresh the game state
        if (!gameState) throw new Error("Game state lost after setting up next draft.");
        selectedPlayerId = null; // Clear any previous player selection
        UI.renderSelectedPlayerCard(null, gameState, positionOverallWeights);
        UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId, currentSortColumn, currentSortDirection, positionOverallWeights); // Pass sort state
        UI.showScreen('draftScreen'); // Display the draft screen
        runAIDraftPicks(); // Start the AI draft picks simulation
    } catch (error) {
        console.error("Error proceeding to next draft:", error);
        UI.showModal("Draft Setup Error", `Could not start next draft: ${error.message}. Please check console.`, null, '', null, 'Close');
    }
}

/**
 * Handles clicks within the main dashboard content area.
 * Supports clicking player names in the 'My Team' roster.
 * @param {Event} e - The click event.
 */
function handleDashboardClicks(e) {
    const target = e.target;

    // --- Player Click in Roster Table ---
    const playerRow = target.closest('#my-team-roster tbody tr[data-player-id]');

    if (playerRow && playerRow.dataset.playerId) {
        const clickedPlayerId = playerRow.dataset.playerId;
        // console.log(`Clicked on player row with ID: ${clickedPlayerId}`); // For debugging

        if (!gameState || !gameState.players) {
            console.error("Cannot show player details: Game state or players list missing.");
            return;
        }

        // Find the full player object
        const clickedPlayer = gameState.players.find(p => p.id === clickedPlayerId);

        if (clickedPlayer) {
            // --- Show Player Details Modal ---
            const positions = Object.keys(positionOverallWeights);
            let overallsHtml = '<div class="mt-4 grid grid-cols-4 gap-2 text-center">';
            positions.forEach(pos => {
                overallsHtml += `<div class="bg-gray-200 p-2 rounded"><p class="font-semibold text-xs">${pos} OVR</p><p class="font-bold text-xl">${Game.calculateOverall(clickedPlayer, pos)}</p></div>`;
            });
            overallsHtml += '</div>';

            // Basic player info
            const playerInfoHtml = `
                <p class="text-sm text-gray-600">
                    Age: ${clickedPlayer.age ?? '?'} |
                    H: ${formatHeight(clickedPlayer.attributes?.physical?.height) ?? '?'} | // <<< Use formatHeight
                    W: ${clickedPlayer.attributes?.physical?.weight ?? '?'} lbs
                </p>
                <p class="text-sm text-gray-600">
                    Potential: <span class="font-semibold">${clickedPlayer.potential ?? '?'}</span>
                    {/* Could add relationship info here if needed */}
                </p>
                ${overallsHtml}
                {/* TODO: Add season/career stats display */}
            `;

            // Show modal with player info
            // TODO: Add action buttons like 'Cut Player'
            UI.showModal(`${clickedPlayer.name}`, playerInfoHtml, null, '', null, 'Close');

        } else {
            console.warn(`Player with ID ${clickedPlayerId} not found in game state.`);
        }
    }
    // --- End Player Click ---
}

/** Handles stat filter/sort changes by re-rendering the stats tab. */
function handleStatsChange() {
    if (!gameState) {
        console.error("Cannot update stats: Game state not available.");
        return;
    }
    UI.switchTab('player-stats', gameState); // Re-render the stats tab
}

/** Handles clicking a message - shows modal and marks as read. */
function handleMessageClick(messageId) {
    if (!gameState || !gameState.messages) {
        console.error("Cannot handle message click: Game state or messages not available.");
        UI.showModal("Error", "Could not load message details.", null, '', null, 'Close');
        return;
    }
    const message = gameState.messages.find(m => m && m.id === messageId); // Added m check
    if (message) {
        UI.showModal(message.subject, `<p class="whitespace-pre-wrap">${message.body}</p>`);
        Game.markMessageAsRead(messageId);
        UI.renderMessagesTab(gameState); // Re-render list
        UI.updateMessagesNotification(gameState.messages); // Update dot
    } else {
        console.warn(`Message with ID ${messageId} not found.`);
        UI.showModal("Error", "Message not found.", null, '', null, 'Close');
    }
}

/** Builds HTML for the Call Friend modal body. */
function buildCallFriendModalHtml(freeAgents) {
    let html = '<div class="mt-4 space-y-2">';
    if (!Array.isArray(freeAgents)) {
        console.error("buildCallFriendModalHtml: Invalid freeAgents data provided.");
        return '<p class="text-red-500">Error loading available friends.</p>';
    }
    if (freeAgents.length === 0) {
        return '<p class="text-gray-500">No friends available to call this week.</p>';
    }
    freeAgents.forEach(p => {
        if (!p) return; // Skip invalid
        // Calculate best overall safely
        const bestPos = Object.keys(positionOverallWeights).reduce((best, pos) => {
            const currentOvr = Game.calculateOverall(p, pos);
            return currentOvr > best.ovr ? { pos, ovr: currentOvr } : best;
        }, { pos: 'N/A', ovr: 0 });

        html += `
            <div class="flex items-center justify-between p-2 bg-gray-100 rounded">
                <div>
                    <p class="font-bold">${p.name || '?'}</p>
                    <p class="text-sm text-gray-600">${p.relationshipName || 'Unknown'} (Best: ${bestPos.pos} - ${bestPos.ovr} Ovr)</p>
                </div>
                <button data-player-id="${p.id}" class="call-friend-btn bg-green-500 hover:bg-green-600 text-white px-3 py-1 text-xs rounded font-semibold transition">CALL</button>
            </div>
        `;
    });
    html += `</div>`;
    return html;
}

/** Displays Call Friend modal and sets up event listeners for the CALL buttons. */
function promptCallFriend() {
    gameState = Game.getGameState(); // Refresh state
    if (!gameState || !gameState.playerTeam || !gameState.playerTeam.roster) {
        console.error("Cannot prompt call friend: Invalid game state or missing player team/roster.");
        UI.showModal("Error", "Cannot display call friend options due to game state error.", null, '', null, 'Close');
        return;
    }

    const { freeAgents, playerTeam } = gameState;
    const unavailableCount = playerTeam.roster.filter(p => p && p.status?.duration > 0).length;
    const healthyCount = playerTeam.roster.length - unavailableCount;

    // Exit if not needed or no FAs
    if (healthyCount >= MIN_HEALTHY_PLAYERS || !Array.isArray(freeAgents) || freeAgents.length === 0) {
        if (healthyCount < MIN_HEALTHY_PLAYERS && (!Array.isArray(freeAgents) || freeAgents.length === 0)) {
            console.log("Roster short, but no free agents available to call.");
        }
        return; // Don't show modal
    }

    // Build modal content
    const modalBodyIntro = `<p>You only have ${healthyCount} healthy players available! Call a friend to fill in?</p>`;
    // Map free agents to include their relationship name for display
    const freeAgentsWithRel = freeAgents.map(p => {
        if (!p) return null;
        const maxLevel = playerTeam.roster.reduce(
            (max, rp) => Math.max(max, Game.getRelationshipLevel(rp?.id, p.id)), // Safe access rp.id
            relationshipLevels.STRANGER.level
        );
        const relInfo = Object.values(relationshipLevels).find(rl => rl.level === maxLevel) || relationshipLevels.STRANGER;
        return { ...p, relationshipName: relInfo.name };
    }).filter(Boolean); // Remove nulls

    const friendListHtml = buildCallFriendModalHtml(freeAgentsWithRel);
    const modalBody = modalBodyIntro + friendListHtml;

    UI.showModal("Call a Friend?", modalBody, null, '', null, 'Maybe Later');

    // Add event listener using delegation
    const modalBodyElement = document.getElementById('modal-body');
    if (!modalBodyElement) return;

    const callButtonDelegationHandler = (e) => {
        if (e.target.matches('.call-friend-btn')) {
            const playerId = e.target.dataset.playerId;
            if (!playerId) return;
            modalBodyElement.removeEventListener('click', callButtonDelegationHandler); // Remove listener

            const result = Game.callFriend(playerId);
            UI.hideModal();

            setTimeout(() => {
                UI.showModal("Call Result", `<p>${result.message}</p>`);
                gameState = Game.getGameState(); // Refresh state
                if (!gameState) return;
                const activeTabEl = document.querySelector('#dashboard-tabs .tab-button.active');
                const activeTab = activeTabEl ? activeTabEl.dataset.tab : 'my-team';
                UI.switchTab(activeTab, gameState); // Update UI
            }, 100);
        }
    };
    // Remove previous listener (safety) before adding new one
    modalBodyElement.removeEventListener('click', callButtonDelegationHandler);
    modalBodyElement.addEventListener('click', callButtonDelegationHandler);
}


/**
 * Main function to initialize the game and set up event listeners.
 */
function main() {
    console.log("Game starting... Document loaded.");
    try {
        UI.setupElements();

        // --- Load game state from localStorage if available ---
        Game.loadGameState();
        gameState = Game.getGameState();

        // --- Setup Global Event Listeners ---
        document.getElementById('start-game-btn')?.addEventListener('click', startNewGame);
        document.getElementById('confirm-team-btn')?.addEventListener('click', handleConfirmTeam);
        document.getElementById('load-game-btn')?.addEventListener('click', handleLoadGame);
        document.getElementById('load-test-roster-btn')?.addEventListener('click', handleLoadTestRoster);
        document.getElementById('save-test-roster-btn')?.addEventListener('click', handleSaveTestRoster);
        document.getElementById('draft-player-btn')?.addEventListener('click', handleDraftPlayer);
        document.getElementById('advance-week-btn')?.addEventListener('click', handleAdvanceWeek);
        document.getElementById('go-to-next-draft-btn')?.addEventListener('click', handleGoToNextDraft);


        // Live Sim Controls
        document.getElementById('sim-skip-btn')?.addEventListener('click', () => {
            UI.skipLiveGameSim(); // No argument needed!
            UI.drawFieldVisualization(null);
        });
        document.getElementById('sim-speed-play')?.addEventListener('click', () => UI.setSimSpeed(50));  // 50ms = 1x (Real-time)
        document.getElementById('sim-speed-fast')?.addEventListener('click', () => UI.setSimSpeed(20));  // 20ms = 2.5x Fast-forward
        document.getElementById('sim-speed-faster')?.addEventListener('click', () => UI.setSimSpeed(150)); // 150ms = 3x Slow-mo
        // Dashboard Navigation and Content Interaction
        document.getElementById('dashboard-tabs')?.addEventListener('click', handleTabSwitch);
        document.getElementById('dashboard-content')?.addEventListener('click', handleDashboardClicks);
        // Messages List (Event Delegation)
        document.getElementById('messages-list')?.addEventListener('click', (e) => {
            const messageItem = e.target.closest('.message-item');
            if (messageItem?.dataset.messageId) { // Safe access
                handleMessageClick(messageItem.dataset.messageId);
            }
        });

        // Draft Filters/Sorting
        document.getElementById('draft-search')?.addEventListener('input', () => {
            if (gameState) UI.debouncedRenderDraftPool(gameState, handlePlayerSelectInDraft, currentSortColumn, currentSortDirection, positionOverallWeights);
        });
        document.getElementById('draft-filter-pos')?.addEventListener('change', () => {
            if (gameState) UI.renderDraftPool(gameState, handlePlayerSelectInDraft, currentSortColumn, currentSortDirection, positionOverallWeights);
        });
        document.querySelector('#draft-screen thead tr')?.addEventListener('click', (e) => {
            const headerCell = e.target.closest('th[data-sort]');
            if (!headerCell || !gameState) return; // Not a sortable header or game not ready

            const newSortColumn = headerCell.dataset.sort;

            if (currentSortColumn === newSortColumn) {
                // Flip direction if clicking the same column
                currentSortDirection = (currentSortDirection === 'desc') ? 'asc' : 'desc';
            } else {
                // New column, set to default
                currentSortColumn = newSortColumn;
                currentSortDirection = 'desc'; // Default to descending
            }

            // Re-render the pool with new sorting
            UI.renderDraftPool(gameState, handlePlayerSelectInDraft, currentSortColumn, currentSortDirection, positionOverallWeights);
            // Update the arrows in the header
            UI.updateDraftSortIndicators(currentSortColumn, currentSortDirection);
        });
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
