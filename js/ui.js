import { calculateOverall, positionOverallWeights } from './game.js';
import { offenseFormations, defenseFormations } from './data.js';

let elements = {};
let selectedPlayerId = null;
let dragPlayerId = null;
let dragSide = null; // 'offense' or 'defense'
let debounceTimeout = null; // For debouncing input
// State for live game sim interval
let liveGameInterval = null; // Holds interval ID
let liveGameSpeed = 1000; // Default speed (ms)
let liveGameCurrentIndex = 0; // Track current play index
let liveGameLog = []; // Store the log for the current sim
let liveGameCallback = null; // Callback for when sim finishes


/**
 * Debounce function to limit rapid function calls (e.g., on input).
 * @param {Function} func - The function to debounce.
 * @param {number} delay - The debounce delay in milliseconds.
 */
function debounce(func, delay) {
    // Returns a function that delays invoking 'func' until after 'delay' ms
    // have elapsed since the last time the debounced function was invoked.
    return function(...args) {
        clearTimeout(debounceTimeout); // Clear existing timeout
        debounceTimeout = setTimeout(() => {
            func.apply(this, args); // Call the original function after delay
        }, delay);
    };
}


/**
 * Grabs references to all necessary DOM elements.
 * Explicitly gets each required element by ID for reliability.
 */
export function setupElements() {
    console.log("Running setupElements..."); // Log start
    elements = {
        // --- Explicit Screen Registration ---
        screens: {
            startScreen: document.getElementById('start-screen'),
            loadingScreen: document.getElementById('loading-screen'),
            teamCreationScreen: document.getElementById('team-creation-screen'),
            draftScreen: document.getElementById('draft-screen'),
            dashboardScreen: document.getElementById('dashboard-screen'),
            offseasonScreen: document.getElementById('offseason-screen'),
            gameSimScreen: document.getElementById('game-sim-screen'),
        },
        // --- End Screen Registration ---

        // --- Register other non-screen elements manually ---
        modal: document.getElementById('modal'),
        modalTitle: document.getElementById('modal-title'),
        modalBody: document.getElementById('modal-body'),
        loadingProgress: document.getElementById('loading-progress'),
        teamNameSuggestions: document.getElementById('team-name-suggestions'),
        customTeamName: document.getElementById('custom-team-name'),
        confirmTeamBtn: document.getElementById('confirm-team-btn'),
        draftHeader: document.getElementById('draft-header'),
        draftYear: document.getElementById('draft-year'),
        draftPickNumber: document.getElementById('draft-pick-number'),
        draftPickingTeam: document.getElementById('draft-picking-team'),
        draftPoolTbody: document.getElementById('draft-pool-tbody'),
        selectedPlayerCard: document.getElementById('selected-player-card'),
        draftPlayerBtn: document.getElementById('draft-player-btn'),
        rosterCount: document.getElementById('roster-count'),
        draftRosterList: document.getElementById('draft-roster-list'),
        rosterSummary: document.getElementById('roster-summary'),
        draftSearch: document.getElementById('draft-search'),
        draftFilterPos: document.getElementById('draft-filter-pos'),
        draftSort: document.getElementById('draft-sort'),
        dashboardTeamName: document.getElementById('dashboard-team-name'),
        dashboardRecord: document.getElementById('dashboard-record'),
        dashboardYear: document.getElementById('dashboard-year'),
        dashboardWeek: document.getElementById('dashboard-week'),
        dashboardTabs: document.getElementById('dashboard-tabs'),
        dashboardContent: document.getElementById('dashboard-content'),
        advanceWeekBtn: document.getElementById('advance-week-btn'),
        myTeamRoster: document.getElementById('my-team-roster'),
        messagesList: document.getElementById('messages-list'),
        messagesNotificationDot: document.getElementById('messages-notification-dot'),
        scheduleList: document.getElementById('schedule-list'),
        standingsContainer: document.getElementById('standings-container'),
        playerStatsContainer: document.getElementById('player-stats-container'),
        statsFilterTeam: document.getElementById('stats-filter-team'),
        statsSort: document.getElementById('stats-sort'),
        hallOfFameList: document.getElementById('hall-of-fame-list'),
        depthChartSubTabs: document.getElementById('depth-chart-sub-tabs'),
        offenseFormationSelect: document.getElementById('offense-formation-select'),
        defenseFormationSelect: document.getElementById('defense-formation-select'),
        offenseDepthChartPane: document.getElementById('depth-chart-offense-pane'),
        defenseDepthChartPane: document.getElementById('depth-chart-defense-pane'),
        offenseDepthChartSlots: document.getElementById('offense-depth-chart-slots'),
        offenseDepthChartRoster: document.getElementById('offense-depth-chart-roster'),
        defenseDepthChartSlots: document.getElementById('defense-depth-chart-slots'),
        defenseDepthChartRoster: document.getElementById('defense-depth-chart-roster'),
        positionalOverallsContainer: document.getElementById('positional-overalls-container'),
        offseasonYear: document.getElementById('offseason-year'),
        playerDevelopmentContainer: document.getElementById('player-development-container'),
        retirementsList: document.getElementById('retirements-list'),
        hofInducteesList: document.getElementById('hof-inductees-list'),
        leavingPlayersList: document.getElementById('leaving-players-list'),
        goToNextDraftBtn: document.getElementById('go-to-next-draft-btn'),
        // Sim Screen Elements
        simScoreboard: document.getElementById('sim-scoreboard'),
        simAwayTeam: document.getElementById('sim-away-team'),
        simAwayScore: document.getElementById('sim-away-score'),
        simHomeTeam: document.getElementById('sim-home-team'),
        simHomeScore: document.getElementById('sim-home-score'),
        simGameDrive: document.getElementById('sim-game-drive'),
        simGameDown: document.getElementById('sim-game-down'),
        simPossession: document.getElementById('sim-possession'),
        fieldDisplay: document.getElementById('field-display'),
        simPlayLog: document.getElementById('sim-play-log'), // Target the correct log container
        simSpeedBtns: document.querySelectorAll('.sim-speed-btn'),
        simSkipBtn: document.getElementById('sim-skip-btn'),
    };

     // Log found screen keys for confirmation
     console.log("Screens registered explicitly:", Object.keys(elements.screens).filter(key => elements.screens[key]));
     // Log missing screen keys for debugging
     Object.keys(elements.screens).forEach(key => {
         if (!elements.screens[key]) {
             console.error(`!!! Element with ID "${key}" NOT FOUND during setupElements.`);
         }
     });


    // Add new sort options to the dropdown (kept from previous state)
    if (elements.draftSort) {
        const sortOptions = `
            <option value="default">Potential (Default)</option>
            <option value="age-asc">Age (Youngest)</option>
            <option value="age-desc">Age (Oldest)</option>
            <option value="speed-desc">Speed (Fastest)</option>
            <option value="strength-desc">Strength (Strongest)</option>
            <option value="agility-desc">Agility (Most Agile)</option>
        `;
        elements.draftSort.innerHTML = sortOptions;
    }
    console.log("UI Elements setup check complete.");
}

/**
 * Shows a specific screen div and hides all others.
 * Includes improved logging and checks.
 * @param {string} screenId - The ID of the screen to show.
 */
export function showScreen(screenId) {
    // Ensure the 'elements' object and 'screens' property exist
    if (!elements || !elements.screens) {
         console.error("Screen elements object (elements.screens) not initialized when showScreen was called.");
         return;
    }

    // Log the attempt and current state
    console.log(`showScreen called for: ${screenId}. Current elements.screens keys found:`, Object.keys(elements.screens).filter(k => elements.screens[k]));

    // Check if the screen ID exists in the registered elements
    if (!elements.screens[screenId]) {
        console.error(`Error in showScreen: Screen element with ID "${screenId}" was NOT FOUND during setupElements or dynamically.`);
        // Attempt a direct lookup *now* as a final fallback
        const element = document.getElementById(screenId);
        if (element) {
            console.warn(`Screen "${screenId}" found via direct lookup now. Storing reference.`);
            elements.screens[screenId] = element; // Store the found element
        } else {
            console.error(`CRITICAL: Screen element with ID "${screenId}" still not found.`);
            return; // Stop if definitely not found
        }
    }

    // Hide all *found* screens first
    Object.keys(elements.screens).forEach(key => {
        const screenElement = elements.screens[key];
        // Check if the element actually exists and has classList before hiding
        if (screenElement && screenElement.classList) {
            screenElement.classList.add('hidden');
        }
    });

    // Show the target screen (re-check existence just in case)
    const targetScreen = elements.screens[screenId];
    if (targetScreen && targetScreen.classList) {
        targetScreen.classList.remove('hidden');
    } else {
        console.error(`CRITICAL: Attempted to show screen "${screenId}" but element reference became invalid.`);
    }
}


/**
 * Displays the universal modal with custom content and actions.
 * @param {string} title - The title for the modal.
 * @param {string} bodyHtml - The HTML content for the modal body.
 * @param {Function|null} onConfirm - Callback function when confirm button is clicked.
 * @param {string} confirmText - Text for the confirm button.
 * @param {Function|null} onCancel - Callback function when cancel/close button is clicked.
 * @param {string} cancelText - Text for the cancel/close button.
 */
export function showModal(title, bodyHtml, onConfirm = null, confirmText = 'Confirm', onCancel = null, cancelText = 'Close') {
    if (!elements.modal || !elements.modalTitle || !elements.modalBody) {
        console.error("Modal elements not found.");
        return;
    }

    elements.modalTitle.textContent = title;
    elements.modalBody.innerHTML = bodyHtml;

    // --- Refined Modal Action Button Creation ---
    const modalContent = elements.modal.querySelector('#modal-content');
    if (!modalContent) {
        console.error("Modal content area not found.");
        return;
    }
    let actionsDiv = modalContent.querySelector('#modal-actions');
    if (actionsDiv) actionsDiv.remove(); // Remove existing actions div if it exists

    actionsDiv = document.createElement('div');
    actionsDiv.id = 'modal-actions';
    actionsDiv.className = 'mt-6 text-right space-x-2';

    // Helper to create a button with standard styling and click logic
    const createButton = (text, classes, onClick) => {
        const button = document.createElement('button');
        button.textContent = text;
        button.className = classes; // Apply base and specific classes
        button.onclick = onClick;
        return button;
    };

    // Create Cancel/Close button
    const closeAction = () => {
        if (onCancel) onCancel(); // Execute callback if provided
        hideModal(); // Always close modal on cancel/close
    };
    actionsDiv.appendChild(createButton(cancelText, 'bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-6 rounded-lg', closeAction));

    // Create Confirm button only if an onConfirm callback is provided
    if (onConfirm && typeof onConfirm === 'function') {
        const confirmAction = () => {
            onConfirm(); // Execute confirm callback
            hideModal(); // Close modal after confirm
        };
        actionsDiv.appendChild(createButton(confirmText, 'bg-amber-500 hover:bg-amber-600 text-white font-bold py-2 px-6 rounded-lg', confirmAction));
    }

    modalContent.appendChild(actionsDiv);
    // --- End Refined Modal Actions ---

    elements.modal.classList.remove('hidden'); // Make the modal visible
}

/**
 * Hides the universal modal.
 */
export function hideModal() {
    if (elements.modal) {
        elements.modal.classList.add('hidden');
    }
}

/**
 * Updates the loading progress bar.
 * @param {number} progress - Progress value between 0 and 1.
 */
export function updateLoadingProgress(progress) {
    if (elements.loadingProgress) {
        // Ensure progress is within 0-1 range before calculating width
        const validProgress = Math.max(0, Math.min(1, progress));
        elements.loadingProgress.style.width = `${validProgress * 100}%`;
        // Update ARIA attribute for screen readers
        elements.loadingProgress.parentElement?.setAttribute('aria-valuenow', Math.round(validProgress * 100));
    }
}

/**
 * Renders suggested team names as clickable buttons.
 * @param {string[]} names - Array of team names.
 * @param {Function} onSelect - Callback function when a name is selected.
 */
export function renderTeamNameSuggestions(names, onSelect) {
    if (!elements.teamNameSuggestions) return;
    elements.teamNameSuggestions.innerHTML = ''; // Clear previous suggestions
    names.forEach(name => {
        const button = document.createElement('button');
        button.className = 'bg-gray-200 hover:bg-amber-500 hover:text-white text-gray-700 font-semibold py-2 px-4 rounded-lg transition';
        button.textContent = name;
        button.type = 'button'; // Explicitly set type to prevent form submission if wrapped
        button.onclick = () => onSelect(name);
        elements.teamNameSuggestions.appendChild(button);
    });
}

/**
 * Renders the main draft screen UI.
 * @param {object} gameState - The current game state object.
 * @param {Function} onPlayerSelect - Callback function when a player row is clicked.
 * @param {string|null} currentSelectedId - The ID of the currently selected player (for highlighting).
 */
export function renderDraftScreen(gameState, onPlayerSelect, currentSelectedId) {
    // Robust check for essential gameState properties
    if (!gameState || !gameState.teams || !gameState.players || !gameState.draftOrder || !gameState.playerTeam) {
        console.error("renderDraftScreen called without valid gameState.");
        if(elements.draftHeader) elements.draftHeader.innerHTML = `<h2 class="text-3xl font-bold text-red-500">Draft Error: Invalid Game State</h2>`;
        return;
    }
    const { year, draftOrder, currentPick, playerTeam, players, teams } = gameState;

    // --- Draft End Condition Checks ---
    // Condition 1: Current pick index exceeds the total number of picks scheduled.
    const pickLimitReached = currentPick >= draftOrder.length;
    // Condition 2: No more undrafted players available.
    const undraftedPlayersCount = players.filter(p => p && !p.teamId).length;
    const noPlayersLeft = undraftedPlayersCount === 0;
    // Condition 3: Every team has either a full roster (10) OR has made picks equal to their initial draft need.
    const allNeedsMetOrFull = teams.every(t => {
        if (!t) return true; // Skip invalid team data
        const needs = t.draftNeeds || 0;
        const picksMade = draftOrder.slice(0, currentPick).filter(teamInOrder => teamInOrder?.id === t.id).length;
        return (t.roster?.length || 0) >= 10 || picksMade >= needs;
    });

    // Check if the draft should end based on any condition
    if (pickLimitReached || noPlayersLeft || allNeedsMetOrFull) {
        // Display draft complete message
        if(elements.draftHeader) elements.draftHeader.innerHTML = `<h2 class="text-3xl font-bold">Season ${year} Draft Complete</h2><p>All teams filled rosters/needs or pool empty.</p>`;
        // Disable draft button
        if(elements.draftPlayerBtn) { elements.draftPlayerBtn.disabled = true; elements.draftPlayerBtn.textContent = 'Draft Complete'; }
        // Clear UI elements related to active drafting
        renderSelectedPlayerCard(null, gameState);
        updateSelectedPlayerRow(null);
        if (elements.draftPoolTbody) elements.draftPoolTbody.innerHTML = '<tr><td colspan="13" class="p-4 text-center text-gray-500">Draft Complete.</td></tr>';
        return; // Stop rendering the active draft state
    }
    // --- End Draft End Checks ---

    // Additional check for pick validity (team exists at current pick)
    const pickingTeam = draftOrder[currentPick];
    if (!pickingTeam) {
        console.error(`Draft Error: No valid team found at current pick index (${currentPick}).`);
        if(elements.draftHeader) elements.draftHeader.innerHTML = `<h2 class="text-3xl font-bold text-red-500">Draft Error Occurred</h2>`;
        return;
    }

    // Determine if it's the player's turn to pick
    const playerCanPick = pickingTeam.id === playerTeam.id && (playerTeam.roster?.length || 0) < 10;

    // Update header elements safely
    if (elements.draftYear) elements.draftYear.textContent = year;
    if (elements.draftPickNumber) elements.draftPickNumber.textContent = currentPick + 1;
    if (elements.draftPickingTeam) elements.draftPickingTeam.textContent = pickingTeam.name || 'Unknown Team';

    // Render the dynamic parts of the screen
    renderDraftPool(gameState, onPlayerSelect); // Player list
    renderPlayerRoster(gameState.playerTeam); // Player's current roster

    // Update the draft button's state and text
    if (elements.draftPlayerBtn) {
        elements.draftPlayerBtn.disabled = !playerCanPick || currentSelectedId === null;
        elements.draftPlayerBtn.textContent = playerCanPick ? 'Draft Player' : `Waiting for ${pickingTeam.name || 'AI'}...`;
    }
}


/**
 * Renders the table of available players in the draft pool, applying filters and sorting.
 * @param {object} gameState - The current game state object.
 * @param {Function} onPlayerSelect - Callback function when a player row is clicked.
 */
export function renderDraftPool(gameState, onPlayerSelect) {
    if (!elements.draftPoolTbody || !gameState || !gameState.players) {
        console.error("Cannot render draft pool: Missing element or game state.");
        if(elements.draftPoolTbody) elements.draftPoolTbody.innerHTML = '<tr><td colspan="13" class="p-4 text-center text-red-500">Error loading players.</td></tr>';
        return;
    }

    const undraftedPlayers = gameState.players.filter(p => p && !p.teamId); // Filter out invalid player entries
    const searchTerm = elements.draftSearch?.value.toLowerCase() || '';
    const posFilter = elements.draftFilterPos?.value || '';
    const sortMethod = elements.draftSort?.value || 'default';

    // Filter players based on search term and position
    let filteredPlayers = undraftedPlayers.filter(p =>
        p.name.toLowerCase().includes(searchTerm) && // Name check
        (!posFilter || p.favoriteOffensivePosition === posFilter || p.favoriteDefensivePosition === posFilter) // Position check
    );

    // Sort players based on selected method
    switch (sortMethod) {
        case 'age-asc': filteredPlayers.sort((a, b) => (a?.age || 99) - (b?.age || 99)); break; // Safe access age
        case 'age-desc': filteredPlayers.sort((a, b) => (b?.age || 0) - (a?.age || 0)); break; // Safe access age
        case 'speed-desc': filteredPlayers.sort((a, b) => (b?.attributes?.physical?.speed || 0) - (a?.attributes?.physical?.speed || 0)); break;
        case 'strength-desc': filteredPlayers.sort((a, b) => (b?.attributes?.physical?.strength || 0) - (a?.attributes?.physical?.strength || 0)); break;
        case 'agility-desc': filteredPlayers.sort((a, b) => (b?.attributes?.physical?.agility || 0) - (a?.attributes?.physical?.agility || 0)); break;
        default: break; // Default: No specific sort beyond initial filtering
    }

    elements.draftPoolTbody.innerHTML = ''; // Clear previous content

    if (filteredPlayers.length === 0) {
        elements.draftPoolTbody.innerHTML = '<tr><td colspan="13" class="p-4 text-center text-gray-500">No players match filters.</td></tr>';
        return;
    }

    // Populate table rows with player data using safe access
    filteredPlayers.forEach(player => {
        const row = document.createElement('tr');
        row.className = `cursor-pointer hover:bg-amber-100 draft-player-row ${player.id === selectedPlayerId ? 'bg-amber-200' : ''}`;
        row.dataset.playerId = player.id;
        // Use nullish coalescing (??) for safer defaults
        row.innerHTML = `
            <td class="py-2 px-3 font-semibold">${player.name ?? 'N/A'}</td>
            <td class="text-center py-2 px-3">${player.age ?? '?'}</td>
            <td class="text-center py-2 px-3">${player.favoriteOffensivePosition || '-'}/${player.favoriteDefensivePosition || '-'}</td>
            <td class="text-center py-2 px-3">${player.attributes?.physical?.height ?? '?'}</td>
            <td class="text-center py-2 px-3">${player.attributes?.physical?.weight ?? '?'}</td>
            <td class="text-center py-2 px-3">${player.attributes?.physical?.speed ?? '?'}</td>
            <td class="text-center py-2 px-3">${player.attributes?.physical?.strength ?? '?'}</td>
            <td class="text-center py-2 px-3">${player.attributes?.physical?.agility ?? '?'}</td>
            <td class="text-center py-2 px-3">${player.attributes?.technical?.throwingAccuracy ?? '?'}</td>
            <td class="text-center py-2 px-3">${player.attributes?.technical?.catchingHands ?? '?'}</td>
            <td class="text-center py-2 px-3">${player.attributes?.technical?.blocking ?? '?'}</td>
            <td class="text-center py-2 px-3">${player.attributes?.technical?.tackling ?? '?'}</td>
            <td class="text-center py-2 px-3">${player.attributes?.technical?.blockShedding ?? '?'}</td>
        `;
        row.onclick = () => onPlayerSelect(player.id); // Attach click handler
        elements.draftPoolTbody.appendChild(row);
    });
}


/** Debounced version of renderDraftPool for input events */
export const debouncedRenderDraftPool = debounce(renderDraftPool, 300);


/**
 * Highlights the selected player row in the draft pool.
 * @param {string|null} newSelectedId - The ID of the player to highlight, or null to clear.
 */
export function updateSelectedPlayerRow(newSelectedId) {
    selectedPlayerId = newSelectedId; // Update internal state
    // Iterate through all player rows and toggle highlight class based on ID match
    document.querySelectorAll('.draft-player-row').forEach(row => {
        row.classList.toggle('bg-amber-200', row.dataset.playerId === newSelectedId);
    });
}

/**
 * Renders the details of the selected player in the draft side panel.
 * Also updates the draft button state.
 * @param {object|null} player - The selected player object, or null.
 * @param {object} gameState - The current game state object.
 */
export function renderSelectedPlayerCard(player, gameState) {
    if (!elements.selectedPlayerCard) return;

    if (!player) {
        elements.selectedPlayerCard.innerHTML = `<p class="text-gray-500">Select a player to see their details</p>`;
    } else {
        const positions = Object.keys(positionOverallWeights);
        let overallsHtml = '<div class="mt-2 grid grid-cols-4 gap-2 text-center">';
        // Calculate and display overall for each position
        positions.forEach(pos => {
            overallsHtml += `<div class="bg-gray-200 p-2 rounded"><p class="font-semibold text-xs">${pos} OVR</p><p class="font-bold text-xl">${calculateOverall(player, pos)}</p></div>`;
        });
        overallsHtml += '</div>';
        // Display player info with safe access using nullish coalescing
        elements.selectedPlayerCard.innerHTML = `
            <h4 class="font-bold text-lg">${player.name ?? 'Unknown Player'}</h4>
            <p class="text-sm text-gray-600">Age: ${player.age ?? '?'} | ${player.attributes?.physical?.height ?? '?'} | ${player.attributes?.physical?.weight ?? '?'} lbs</p>
            ${overallsHtml}`;
    }

    // Update draft button state (requires valid gameState)
    if (gameState && elements.draftPlayerBtn) {
        const { draftOrder, currentPick, playerTeam } = gameState;
        // Check conditions carefully: valid pick index, player team exists
        if (draftOrder && currentPick >= 0 && currentPick < draftOrder.length && playerTeam && draftOrder[currentPick]) {
            const pickingTeam = draftOrder[currentPick];
            const playerCanPick = pickingTeam.id === playerTeam.id && (playerTeam.roster?.length || 0) < 10;
            elements.draftPlayerBtn.disabled = !playerCanPick || !player; // Disable if not player's turn, roster full, or no player selected
        } else {
            console.warn("Update draft button: Invalid draft state."); elements.draftPlayerBtn.disabled = true; // Disable if state is invalid
        }
    } else if (elements.draftPlayerBtn) {
        // Fallback if gameState isn't provided (should be avoided)
        elements.draftPlayerBtn.disabled = !player;
    }
}


/**
 * Renders the player's current roster list in the draft side panel.
 * @param {object} playerTeam - The player's team object.
 */
export function renderPlayerRoster(playerTeam) {
    // Check if required elements and data exist
    if (!elements.rosterCount || !elements.draftRosterList || !playerTeam) {
        console.error("Cannot render player roster: Missing elements or playerTeam data.");
        return;
    }

    const roster = playerTeam.roster || []; // Default to empty array if roster missing
    elements.rosterCount.textContent = `${roster.length}/10`; // Update count display
    elements.draftRosterList.innerHTML = ''; // Clear previous list items

    // Display message if roster is empty, otherwise list players
    if (roster.length === 0) {
        const li = document.createElement('li');
        li.className = 'p-2 text-center text-gray-500';
        li.textContent = 'No players drafted yet.';
        elements.draftRosterList.appendChild(li);
    } else {
        roster.forEach(player => {
            if (!player) return; // Skip invalid player entries
            const li = document.createElement('li');
            li.className = 'p-2';
            // Display player name and preferred positions safely
            li.textContent = `${player.name} (${player.favoriteOffensivePosition || '-'}/${player.favoriteDefensivePosition || '-'})`;
            elements.draftRosterList.appendChild(li);
        });
    }
    renderRosterSummary(playerTeam); // Update the summary section as well
}

/**
 * Renders the average overall ratings for the player's current roster.
 * @param {object} playerTeam - The player's team object.
 */
function renderRosterSummary(playerTeam) {
    if (!elements.rosterSummary || !playerTeam) return;

    const roster = playerTeam.roster || [];
    const positions = Object.keys(positionOverallWeights);

    if (roster.length === 0) {
        elements.rosterSummary.innerHTML = '<p class="text-xs text-gray-500">Your roster is empty.</p>';
        return;
    }

    let summaryHtml = '<h5 class="font-bold text-sm mb-1">Team Averages</h5><div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">';

    // Calculate and display average overall for each position
    positions.forEach(pos => {
        // Filter out potentially invalid player entries before reducing
        const validPlayers = roster.filter(p => p && p.attributes);
        if (validPlayers.length === 0) { // Handle case where roster has entries but they are invalid
             summaryHtml += `<div class="flex justify-between"><span class="font-semibold">${pos}:</span><span class="font-bold">N/A</span></div>`;
             return; // Skip calculation for this position
        }
        const totalOvr = validPlayers.reduce((sum, player) => sum + calculateOverall(player, pos), 0);
        const avgOvr = Math.round(totalOvr / validPlayers.length);
        summaryHtml += `<div class="flex justify-between"><span class="font-semibold">${pos}:</span><span class="font-bold">${avgOvr}</span></div>`;
    });

    summaryHtml += '</div>';
    elements.rosterSummary.innerHTML = summaryHtml;
}


// --- Restoring previously implemented functions ---

/**
 * Renders the main dashboard header and populates team filter.
 * Added safety checks for gameState properties.
 * @param {object} gameState - The current game state object.
 */
export function renderDashboard(gameState) {
    // Check essential parts of gameState
    if (!gameState || !gameState.playerTeam || !gameState.teams) {
        console.error("renderDashboard: Invalid gameState provided.");
        // Optionally display an error message in the UI
        if(elements.dashboardTeamName) elements.dashboardTeamName.textContent = "Error Loading";
        if(elements.dashboardRecord) elements.dashboardRecord.textContent = "";
        return;
    }
    const { playerTeam, year, currentWeek, messages, teams } = gameState;
    const currentW = (typeof currentWeek === 'number' && currentWeek < 9) ? `Week ${currentWeek + 1}` : 'Offseason'; // Safer week calculation

    // Update header elements safely
    if (elements.dashboardTeamName) elements.dashboardTeamName.textContent = playerTeam.name || 'Your Team';
    if (elements.dashboardRecord) elements.dashboardRecord.textContent = `Record: ${playerTeam.wins || 0} - ${playerTeam.losses || 0}`;
    if (elements.dashboardYear) elements.dashboardYear.textContent = year || '?';
    if (elements.dashboardWeek) elements.dashboardWeek.textContent = currentW;
    if (elements.advanceWeekBtn) elements.advanceWeekBtn.textContent = (typeof currentWeek === 'number' && currentWeek < 9) ? 'Advance Week' : 'Go to Offseason';

    // Populate team filter dropdown, checking if teams is an array
    if (elements.statsFilterTeam && Array.isArray(teams)) {
        let teamOptions = '<option value="">All Teams</option>';
        teams
            .filter(t => t && t.id && t.name) // Ensure team objects are valid
            .sort((a, b) => a.name.localeCompare(b.name)) // Sort valid teams
            .forEach(t => teamOptions += `<option value="${t.id}">${t.name}</option>`);
        elements.statsFilterTeam.innerHTML = teamOptions;
    } else if (elements.statsFilterTeam) {
         elements.statsFilterTeam.innerHTML = '<option value="">Error loading teams</option>'; // Indicate error
    }

    if (messages && Array.isArray(messages)) updateMessagesNotification(messages); // Check messages is array

    // Determine and render the currently active tab (or default to 'my-team')
    const activeTabButton = elements.dashboardTabs?.querySelector('.tab-button.active');
    const activeTabId = activeTabButton ? activeTabButton.dataset.tab : 'my-team';
    switchTab(activeTabId, gameState);
}

/**
 * Handles switching between dashboard tabs.
 * Added safety checks and error handling for rendering.
 * @param {string} tabId - The ID of the tab to switch to (e.g., 'my-team').
 * @param {object} gameState - The current game state object.
 */
export function switchTab(tabId, gameState) {
    if (!elements.dashboardContent || !elements.dashboardTabs) { console.error("Dashboard elements missing."); return; }

    // Hide all tab content panes and deactivate buttons
    elements.dashboardContent.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
    elements.dashboardTabs.querySelectorAll('.tab-button').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });

    // Activate the selected tab and content pane
    const contentPane = document.getElementById(`tab-content-${tabId}`);
    const tabButton = elements.dashboardTabs.querySelector(`[data-tab="${tabId}"]`);
    if (contentPane) contentPane.classList.remove('hidden'); else console.warn(`Content pane "${tabId}" not found.`);
    if (tabButton) { tabButton.classList.add('active'); tabButton.setAttribute('aria-selected', 'true'); } else console.warn(`Tab button "${tabId}" not found.`);

    // Check gameState before attempting to render content
    if (!gameState) {
        console.warn(`switchTab called for "${tabId}" without valid gameState.`);
        if(contentPane) contentPane.innerHTML = '<p class="text-red-500">Error: Game state not available.</p>';
        return;
    }

    // Render content for the selected tab within a try-catch block
    try {
        switch (tabId) {
            case 'my-team': renderMyTeamTab(gameState); break;
            case 'depth-chart': renderDepthChartTab(gameState); break;
            case 'messages': renderMessagesTab(gameState); break;
            case 'schedule': renderScheduleTab(gameState); break;
            case 'standings': renderStandingsTab(gameState); break;
            case 'player-stats': renderPlayerStatsTab(gameState); break;
            case 'hall-of-fame': renderHallOfFameTab(gameState); break;
            default:
                console.warn(`Unknown tab: ${tabId}`);
                if(contentPane) contentPane.innerHTML = `<p>Content for tab "${tabId}" not implemented.</p>`;
        }
    } catch (error) {
        console.error(`Error rendering tab "${tabId}":`, error);
        if(contentPane) contentPane.innerHTML = `<p class="text-red-500">Error rendering ${tabId} content. Check console.</p>`;
    }

    // Mark messages as read if switching to the messages tab
    if (tabId === 'messages' && Array.isArray(gameState.messages)) {
        updateMessagesNotification(gameState.messages, true);
    }
}

/**
 * Renders the 'My Team' tab content (roster table). Added safety checks.
 * @param {object} gameState - The current game state object.
 */
function renderMyTeamTab(gameState) {
     // Check for required elements and data structure
     if (!elements.myTeamRoster || !gameState?.playerTeam?.roster || !Array.isArray(gameState.playerTeam.roster)) {
        console.error("Cannot render My Team tab: Missing elements or invalid roster data.");
        if(elements.myTeamRoster) elements.myTeamRoster.innerHTML = '<p class="text-red-500">Error loading roster data.</p>';
        return;
    }

     const roster = gameState.playerTeam.roster;
     // Define attribute groups for table columns
     const physicalAttrs = ['height', 'weight', 'speed', 'strength', 'agility', 'stamina'];
     const mentalAttrs = ['playbookIQ', 'clutch', 'consistency', 'toughness'];
     const technicalAttrs = ['throwingAccuracy', 'catchingHands', 'blocking', 'tackling', 'blockShedding'];

     // Build table header HTML
     let tableHtml = `<div class="overflow-x-auto"><table class="min-w-full bg-white text-sm"><thead class="bg-gray-800 text-white sticky top-0 z-10"><tr>
        <th scope="col" class="py-2 px-3 text-left sticky left-0 bg-gray-800 z-20">Name</th>
        <th scope="col" class="py-2 px-3">Type</th> <th scope="col" class="py-2 px-3">Age</th> <th scope="col" class="py-2 px-3">Status</th>
        ${physicalAttrs.map(h => `<th scope="col" class="py-2 px-3 uppercase">${h.slice(0,3)}</th>`).join('')}
        ${mentalAttrs.map(h => `<th scope="col" class="py-2 px-3 uppercase">${h.slice(0,3)}</th>`).join('')}
        ${technicalAttrs.map(h => `<th scope="col" class="py-2 px-3 uppercase">${h.slice(0,3)}</th>`).join('')}
    </tr></thead><tbody class="divide-y">`;

     if (roster.length === 0) {
        tableHtml += '<tr><td colspan="15" class="p-4 text-center text-gray-500">Your roster is empty.</td></tr>';
     } else {
        // Iterate through roster, adding a row for each valid player
        roster.forEach(p => {
             if (!p || !p.attributes || !p.status) return; // Skip invalid player entries
            const statusClass = p.status.duration > 0 ? 'text-red-500 font-semibold' : 'text-green-600';
            const statusText = p.status.description || 'Healthy';
            const typeTag = p.status.type === 'temporary' ? '<span class="status-tag temporary" title="Temporary Friend">[T]</span>' : '<span class="status-tag permanent" title="Permanent Roster">[P]</span>';

            // Use row header for name (accessibility)
            tableHtml += `<tr>
                <th scope="row" class="py-2 px-3 font-semibold sticky left-0 bg-white z-10">${p.name}</th>
                <td class="text-center py-2 px-3">${typeTag}</td> <td class="text-center py-2 px-3">${p.age}</td>
                <td class="text-center py-2 px-3 ${statusClass}" title="${statusText}">${statusText} ${p.status.duration > 0 ? `(${p.status.duration}w)` : ''}</td>`;

            // Helper to render attribute cells safely
            const renderAttr = (val, attrName) => {
                const breakthroughClass = p.breakthroughAttr === attrName ? ' breakthrough font-bold text-green-600' : '';
                return `<td class="text-center py-2 px-3${breakthroughClass}" title="${attrName}">${val ?? '?'}</td>`;
            };

            physicalAttrs.forEach(attr => tableHtml += renderAttr(p.attributes.physical?.[attr], attr));
            mentalAttrs.forEach(attr => tableHtml += renderAttr(p.attributes.mental?.[attr], attr));
            technicalAttrs.forEach(attr => tableHtml += renderAttr(p.attributes.technical?.[attr], attr));

            tableHtml += `</tr>`;
        });
    }

     elements.myTeamRoster.innerHTML = tableHtml + `</tbody></table></div>`; // Update DOM
 }

/**
 * Renders the 'Depth Chart' tab content. Added safety checks.
 * @param {object} gameState - The current game state object.
 */
function renderDepthChartTab(gameState) {
    // Check for essential game state and player team data
    if (!gameState || !gameState.playerTeam || !gameState.playerTeam.roster || !gameState.playerTeam.formations || !gameState.playerTeam.depthChart) {
         console.error("Cannot render depth chart: Invalid game state or missing required properties.");
         // Optionally clear the relevant UI areas or display an error
         if(elements.positionalOverallsContainer) elements.positionalOverallsContainer.innerHTML = '<p class="text-red-500">Error loading depth chart data.</p>';
         if(elements.offenseDepthChartPane) elements.offenseDepthChartPane.innerHTML = '<p class="text-red-500">Error loading offense data.</p>';
         if(elements.defenseDepthChartPane) elements.defenseDepthChartPane.innerHTML = '<p class="text-red-500">Error loading defense data.</p>';
         return;
     }

    // Filter roster safely for positional overalls table
    const permanentRoster = gameState.playerTeam.roster.filter(p => p && p.status?.type !== 'temporary');
    renderPositionalOveralls(permanentRoster);

    // Render offense side
    renderFormationDropdown('offense', Object.values(offenseFormations), gameState.playerTeam.formations.offense);
    renderDepthChartSide('offense', gameState, elements.offenseDepthChartSlots, elements.offenseDepthChartRoster);

    // Render defense side
    renderFormationDropdown('defense', Object.values(defenseFormations), gameState.playerTeam.formations.defense);
    renderDepthChartSide('defense', gameState, elements.defenseDepthChartSlots, elements.defenseDepthChartRoster);
}

/**
 * Populates the formation selection dropdown for offense or defense. Added safety check.
 * @param {string} side - 'offense' or 'defense'.
 * @param {object[]} formations - Array of formation objects available for that side.
 * @param {string} currentFormationName - The name of the team's currently selected formation.
 */
function renderFormationDropdown(side, formations, currentFormationName) {
    const selectEl = elements[`${side}FormationSelect`];
    if (!selectEl) {
        console.error(`Formation select element for "${side}" not found.`);
        return;
    }
    // Ensure formations is an array before mapping
    if (!Array.isArray(formations)) {
        console.error(`Invalid formations data provided for side "${side}".`);
        selectEl.innerHTML = '<option value="">Error</option>'; // Indicate error
        return;
    }
    // Generate <option> elements, marking the current formation as selected
    selectEl.innerHTML = formations
        .map(f => `<option value="${f.name}" ${f.name === currentFormationName ? 'selected' : ''}>${f.name}</option>`)
        .join('');
}

/**
 * Renders the table showing overall ratings for each player at each position. Added safety checks.
 * @param {object[]} roster - Array of player objects (typically filtered).
 */
function renderPositionalOveralls(roster) {
    if (!elements.positionalOverallsContainer) return; // Element check
    const positions = Object.keys(positionOverallWeights);

    // Build table header with scope attributes for accessibility
    let table = `<table class="min-w-full text-sm text-left"><thead class="bg-gray-100"><tr><th scope="col" class="p-2 font-semibold sticky left-0 bg-gray-100 z-10">Player</th>${positions.map(p => `<th scope="col" class="p-2 font-semibold text-center">${p}</th>`).join('')}</tr></thead><tbody>`;

    // Add row for each valid player in the provided roster
    if (roster && roster.length > 0) {
        roster.forEach(player => {
            if (!player) return; // Skip null/undefined player entries
            // Use row header scope for player name
            table += `<tr class="border-b"><th scope="row" class="p-2 font-bold sticky left-0 bg-white z-0">${player.name}</th>${positions.map(p => `<td class="p-2 text-center">${calculateOverall(player, p)}</td>`).join('')}</tr>`;
        });
    } else {
        // Display message if roster is empty or contains only invalid entries
        table += `<tr><td colspan="${positions.length + 1}" class="text-center p-4 text-gray-500">No players found for positional overalls.</td></tr>`;
    }
    elements.positionalOverallsContainer.innerHTML = table + '</tbody></table>'; // Update DOM
}


/**
 * Renders the depth chart slots and available players for one side (offense/defense). Added safety checks.
 * @param {string} side - 'offense' or 'defense'.
 * @param {object} gameState - The current game state object.
 * @param {HTMLElement} slotsContainer - The DOM element for starter slots.
 * @param {HTMLElement} rosterContainer - The DOM element for available players list.
 */
function renderDepthChartSide(side, gameState, slotsContainer, rosterContainer) {
    // Check essential elements and gameState properties
    if (!slotsContainer || !rosterContainer || !gameState?.playerTeam?.roster || !gameState?.playerTeam?.depthChart) {
         console.error(`Cannot render depth chart side "${side}": Missing elements or game state.`);
         if(slotsContainer) slotsContainer.innerHTML = '<p class="text-red-500">Error</p>'; // Indicate error in UI
         if(rosterContainer) rosterContainer.innerHTML = '<p class="text-red-500">Error</p>';
         return;
     }

    const { roster, depthChart } = gameState.playerTeam;
    // Safely get the chart for the side, defaulting to empty object if missing
    const currentChart = depthChart[side] || {};
    const slots = Object.keys(currentChart);

    slotsContainer.innerHTML = ''; // Clear previous slots
    // Add header row for slots table
    const header = document.createElement('div');
    header.className = 'depth-chart-slot flex items-center justify-between font-bold text-xs text-gray-500 px-2';
    header.innerHTML = `<span class="w-1/4">POS</span><div class="player-details-grid w-3/4"><span>NAME</span><span>OVR</span><span>SPD</span><span>STR</span><span>AGI</span><span>THR</span><span>CAT</span></div>`;
    slotsContainer.appendChild(header);
    // Render each starter slot based on current depth chart
    slots.forEach(slot => renderSlot(slot, roster, currentChart, slotsContainer, side));

    // Determine available players (those not starting on *this* specific side)
    const playersStartingOnThisSide = new Set(Object.values(currentChart).filter(Boolean));
    // Filter roster safely, ensuring player 'p' exists before checking ID
    const availablePlayers = roster.filter(p => p && !playersStartingOnThisSide.has(p.id));

    // Render the list of available (draggable) players
    renderAvailablePlayerList(availablePlayers, rosterContainer, side);
}

/**
 * Renders a single depth chart slot. Added safety checks.
 * @param {string} positionSlot - The name of the slot (e.g., 'QB1').
 * @param {object[]} roster - The full team roster array.
 * @param {object} chart - The depth chart object for the current side.
 * @param {HTMLElement} container - The parent element to append the slot to.
 * @param {string} side - 'offense' or 'defense'.
 */
function renderSlot(positionSlot, roster, chart, container, side) {
    const playerId = chart[positionSlot];
    // Find player safely, checking if roster is array and player exists
    const player = Array.isArray(roster) ? roster.find(p => p?.id === playerId) : null;
    const basePosition = positionSlot.replace(/\d/g, '');
    const overall = player ? calculateOverall(player, basePosition) : '---';
    const typeTag = player?.status?.type === 'temporary' ? '<span class="status-tag temporary">[T]</span>' : '';

    const slotEl = document.createElement('div');
    slotEl.className = 'depth-chart-slot bg-gray-200 p-2 rounded flex items-center justify-between';
    slotEl.dataset.positionSlot = positionSlot;
    slotEl.dataset.side = side;

    if (player) {
        slotEl.draggable = true;
        slotEl.dataset.playerId = player.id;
        slotEl.setAttribute('title', `Drag ${player.name}`);
    } else {
        slotEl.setAttribute('title', `Drop player for ${positionSlot}`);
    }

    // Populate slot content safely using nullish coalescing
    slotEl.innerHTML = `
        <span class="font-bold w-1/4">${positionSlot}</span>
        <div class="player-details-grid w-3/4">
            <span>${typeTag} ${player?.name ?? 'Empty'}</span>
            <span class="font-bold text-amber-600">${overall}</span>
            <span>${player?.attributes?.physical?.speed ?? '-'}</span>
            <span>${player?.attributes?.physical?.strength ?? '-'}</span>
            <span>${player?.attributes?.physical?.agility ?? '-'}</span>
            <span>${player?.attributes?.technical?.throwingAccuracy ?? '-'}</span>
            <span>${player?.attributes?.technical?.catchingHands ?? '-'}</span>
        </div>`;
    container.appendChild(slotEl);
}


/**
 * Renders the list of available players as draggable items. Added safety checks.
 * @param {object[]} players - Array of available player objects.
 * @param {HTMLElement} container - The parent element to append the list items to.
 * @param {string} side - 'offense' or 'defense'.
 */
function renderAvailablePlayerList(players, container, side) {
    if (!container) return; // Check if container exists
    container.innerHTML = ''; // Clear previous list

    // Check if players array is valid and has players
    if (!Array.isArray(players) || players.length === 0) {
        container.innerHTML = '<p class="text-xs text-gray-500 p-2">No players available.</p>';
        return;
    }

    players.forEach(player => {
        if (!player) return; // Skip invalid player entries
        const typeTag = player.status?.type === 'temporary' ? '<span class="status-tag temporary">[T]</span> ' : '';
        const playerEl = document.createElement('div');
        playerEl.className = 'draggable-player';
        playerEl.draggable = true;
        playerEl.dataset.playerId = player.id;
        playerEl.dataset.side = side;
        playerEl.innerHTML = `${typeTag}${player.name ?? 'Unknown Player'}`; // Safe access to name
        playerEl.setAttribute('title', `Drag ${player.name ?? 'Player'} to ${side} slot`);
        container.appendChild(playerEl);
    });
}


/**
 * Renders the 'Messages' tab content. Added safety checks.
 * @param {object} gameState - The current game state object.
 */
function renderMessagesTab(gameState) {
    if (!elements.messagesList) { console.error("Messages list element not found."); return; } // Check element first
    // Check gameState and messages array
    if (!gameState?.messages || !Array.isArray(gameState.messages)) {
        elements.messagesList.innerHTML = '<p class="text-gray-500">Messages unavailable.</p>';
        return;
    }
    const messages = gameState.messages;

    if (messages.length === 0) {
        elements.messagesList.innerHTML = `<p class="text-gray-500">No messages yet.</p>`;
        return;
    }

    // Build list items safely, providing defaults for missing properties
    elements.messagesList.innerHTML = messages
        .map(msg => {
            if (!msg) return ''; // Skip invalid message entries
            const subject = msg.subject || '(No Subject)';
            const readClass = msg.isRead ? 'bg-gray-100 text-gray-600' : 'bg-amber-100 font-semibold border-l-4 border-amber-400';
            return `<div class="message-item ${readClass}" data-message-id="${msg.id}" role="button" tabindex="0" aria-label="View message: ${subject}">${subject}</div>`;
        })
        .join('');

    updateMessagesNotification(messages); // Update notification dot
}

/**
 * Updates the visibility of the unread messages notification dot. Added safety checks.
 * Can also mark all messages as read.
 * @param {object[]} messages - Array of message objects.
 * @param {boolean} [markAllAsRead=false] - If true, modify the messages array to mark all as read.
 */
function updateMessagesNotification(messages, markAllAsRead = false) {
    // Check for element and valid messages array
    if (!elements.messagesNotificationDot || !Array.isArray(messages)) return;

    if (markAllAsRead) {
        messages.forEach(msg => { if (msg) msg.isRead = true; }); // Mark valid messages as read
    }
    // Check if any *valid* message is unread
    const hasUnread = messages.some(m => m && !m.isRead);
    // Toggle visibility based on unread status
    elements.messagesNotificationDot.classList.toggle('hidden', !hasUnread);
}


/**
 * Renders the 'Schedule' tab content. Added safety checks.
 * @param {object} gameState - The current game state object.
 */
function renderScheduleTab(gameState) {
    // Check for required elements and data
    if (!elements.scheduleList || !gameState?.schedule || !Array.isArray(gameState.schedule) || !gameState.teams || !gameState.playerTeam) {
        console.error("Cannot render schedule: Missing elements or invalid game state.");
        if(elements.scheduleList) elements.scheduleList.innerHTML = '<p class="text-red-500">Error loading schedule data.</p>';
        return;
    }

    let html = '';
    // Ensure gamesPerWeek is calculated correctly, avoid division by zero
    const gamesPerWeek = gameState.teams.length > 0 ? gameState.teams.length / 2 : 0;
    const numWeeks = 9;

    for (let i = 0; i < numWeeks; i++) {
        const weekStartIndex = i * gamesPerWeek;
        const weekEndIndex = weekStartIndex + gamesPerWeek;
        const weekGames = gameState.schedule.slice(weekStartIndex, weekEndIndex);
        const isPastWeek = i < gameState.currentWeek;
        const isCurrentWeek = i === gameState.currentWeek;

        let weekHtml = `<div class="p-4 rounded mb-4 ${isCurrentWeek ? 'bg-amber-100 border-2 border-amber-500' : 'bg-gray-100'}"><h4 class="font-bold text-lg mb-2">Week ${i + 1}</h4><div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">`;

        if (weekGames.length > 0) {
            weekGames.forEach(g => {
                // Skip if game, home team, or away team data is missing
                if (!g || !g.home || !g.away) {
                    console.warn(`Skipping rendering schedule entry: Invalid game data for Week ${i+1}.`);
                    return;
                }
                let content;
                // Find result safely, checking gameResults array and team IDs
                const result = isPastWeek ? (gameState.gameResults || []).find(r => r && r.homeTeam?.id === g.home.id && r.awayTeam?.id === g.away.id) : null;
                let resultClass = '';

                if (result) {
                    // Display result safely using nullish coalescing
                    content = `<span class="${result.awayScore > result.homeScore ? 'font-bold' : ''}">${g.away.name ?? '?'} ${result.awayScore ?? '?'}</span> @ <span class="${result.homeScore > result.awayScore ? 'font-bold' : ''}">${g.home.name ?? '?'} ${result.homeScore ?? '?'}</span>`;
                    // Determine win/loss class safely
                    if (result.homeTeam?.id === gameState.playerTeam.id) { resultClass = result.homeScore > result.awayScore ? 'player-win' : (result.homeScore < result.awayScore ? 'player-loss' : ''); }
                    else if (result.awayTeam?.id === gameState.playerTeam.id) { resultClass = result.awayScore > result.homeScore ? 'player-win' : (result.awayScore < result.homeScore ? 'player-loss' : ''); }
                } else {
                    // Display future matchup safely
                    content = `<span>${g.away.name ?? '?'}</span> @ <span>${g.home.name ?? '?'}</span>`;
                }
                weekHtml += `<div class="bg-white p-2 rounded shadow-sm flex justify-center items-center ${resultClass}">${content}</div>`;
            });
        } else {
            weekHtml += `<p class="text-gray-500 md:col-span-2">No games scheduled for this week.</p>`;
        }
        weekHtml += `</div></div>`;
        html += weekHtml;
    }
    elements.scheduleList.innerHTML = html;
}


/**
 * Renders the 'Standings' tab content. Added safety checks.
 * @param {object} gameState - The current game state object.
 */
function renderStandingsTab(gameState) {
    // Check required data
    if (!elements.standingsContainer || !gameState?.divisions || !gameState.teams || !Array.isArray(gameState.teams) || !gameState.playerTeam) {
        console.error("Cannot render standings: Missing elements or invalid game state.");
        if(elements.standingsContainer) elements.standingsContainer.innerHTML = '<p class="text-red-500">Error loading standings data.</p>';
        return;
    }

    elements.standingsContainer.innerHTML = ''; // Clear

    for (const divName in gameState.divisions) {
        // Ensure division data is valid
        const divisionTeamIdsArray = gameState.divisions[divName];
        if (!Array.isArray(divisionTeamIdsArray)) {
            console.warn(`Skipping division "${divName}": Invalid team ID list.`);
            continue;
        }
        const divisionTeamIds = new Set(divisionTeamIdsArray);
        const divEl = document.createElement('div');
        divEl.className = 'mb-6';

        let tableHtml = `<h4 class="text-xl font-bold mb-2">${divName} Division</h4><table class="min-w-full bg-white text-sm"><thead class="bg-gray-800 text-white"><tr><th scope="col" class="py-2 px-3 text-left">Team</th><th scope="col" class="py-2 px-3">W</th><th scope="col" class="py-2 px-3">L</th></tr></thead><tbody class="divide-y">`;

        // Filter and sort teams safely
        const divTeams = gameState.teams
            .filter(t => t && divisionTeamIds.has(t.id)) // Ensure team 't' exists before checking ID
            .sort((a, b) => (b?.wins || 0) - (a?.wins || 0) || (a?.losses || 0) - (b?.losses || 0)); // Safe sort

        if (divTeams.length > 0) {
            divTeams.forEach(t => {
                // Use row header scope for team name
                tableHtml += `<tr class="${t.id === gameState.playerTeam.id ? 'bg-amber-100 font-semibold' : ''}"><th scope="row" class="py-2 px-3 text-left">${t.name}</th><td class="text-center py-2 px-3">${t.wins || 0}</td><td class="text-center py-2 px-3">${t.losses || 0}</td></tr>`;
            });
        } else {
            tableHtml += '<tr><td colspan="3" class="p-4 text-center text-gray-500">No teams found in division.</td></tr>';
        }

        divEl.innerHTML = tableHtml + `</tbody></table>`;
        elements.standingsContainer.appendChild(divEl);
    }
}

/**
 * Renders the 'Player Stats' tab content. Added safety checks.
 * @param {object} gameState - The current game state object.
 */
function renderPlayerStatsTab(gameState) {
    if (!elements.playerStatsContainer || !gameState?.players || !Array.isArray(gameState.players)) {
        console.error("Cannot render player stats: Missing element or invalid player data.");
        if(elements.playerStatsContainer) elements.playerStatsContainer.innerHTML = '<p class="text-red-500">Error loading player stats.</p>';
        return;
    }

    const teamIdFilter = elements.statsFilterTeam?.value || '';
    const sortStat = elements.statsSort?.value || 'touchdowns';
    // Filter valid players
    let playersToShow = gameState.players.filter(p => p && (teamIdFilter ? p.teamId === teamIdFilter : true));
    // Sort safely using nullish coalescing
    playersToShow.sort((a, b) => (b?.seasonStats?.[sortStat] || 0) - (a?.seasonStats?.[sortStat] || 0));

    const stats = ['passYards', 'rushYards', 'recYards', 'receptions', 'touchdowns', 'tackles', 'sacks', 'interceptions'];
    const statHeaders = stats.map(s => s.replace(/([A-Z])/g, ' $1').toUpperCase());

    let tableHtml = `<div class="overflow-x-auto"><table class="min-w-full bg-white text-sm"><thead class="bg-gray-800 text-white sticky top-0 z-10"><tr><th scope="col" class="py-2 px-3 text-left sticky left-0 bg-gray-800 z-20">Name</th>${statHeaders.map(h => `<th scope="col" class="py-2 px-3">${h}</th>`).join('')}</tr></thead><tbody class="divide-y">`;

    if (playersToShow.length === 0) {
        tableHtml += '<tr><td colspan="9" class="p-4 text-center text-gray-500">No players match criteria.</td></tr>';
    } else {
        playersToShow.forEach(p => {
            const playerTeamClass = p.teamId === gameState.playerTeam?.id ? 'bg-amber-50' : ''; // Safe access playerTeam.id
            // Generate stat cells safely
            const statCells = stats.map(s => `<td class="text-center py-2 px-3">${p.seasonStats?.[s] || 0}</td>`).join('');
            // Use row header scope for name
            tableHtml += `<tr class="${playerTeamClass}"><th scope="row" class="py-2 px-3 font-semibold sticky left-0 bg-white z-10 text-left">${p.name}</th>${statCells}</tr>`;
        });
    }

    elements.playerStatsContainer.innerHTML = tableHtml + `</tbody></table></div>`;
}


/**
 * Renders the 'Hall of Fame' tab content. Added safety checks.
 * @param {object} gameState - The current game state object.
 */
function renderHallOfFameTab(gameState) {
    if (!elements.hallOfFameList || !gameState?.hallOfFame || !Array.isArray(gameState.hallOfFame)) {
        console.error("Cannot render Hall of Fame: Missing element or invalid data.");
        if(elements.hallOfFameList) elements.hallOfFameList.innerHTML = '<p class="text-red-500">Error loading Hall of Fame.</p>';
        return;
    }
    const inductees = gameState.hallOfFame;

    if (inductees.length === 0) {
        elements.hallOfFameList.innerHTML = '<p class="text-gray-500">The Hall of Fame is empty.</p>';
        return;
    }

    // Build cards safely
    elements.hallOfFameList.innerHTML = '<div class="space-y-4">' + inductees.map(p => {
        if (!p || !p.careerStats) return ''; // Skip invalid entries
        return `<article class="bg-gray-100 p-4 rounded-lg shadow" aria-labelledby="hof-${p.id}">
            <h4 id="hof-${p.id}" class="font-bold text-lg text-amber-600">${p.name ?? '?'}</h4>
            <p class="text-sm">Seasons: ${p.careerStats.seasonsPlayed ?? '?'}</p>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2 text-sm">
                <span>TDs: <strong>${p.careerStats.touchdowns || 0}</strong></span>
                <span>PassYds: <strong>${p.careerStats.passYards || 0}</strong></span>
                <span>RushYds: <strong>${p.careerStats.rushYards || 0}</strong></span>
                <span>RecYds: <strong>${p.careerStats.recYards || 0}</strong></span>
                <span>Tackles: <strong>${p.careerStats.tackles || 0}</strong></span>
                <span>Sacks: <strong>${p.careerStats.sacks || 0}</strong></span>
                <span>INTs: <strong>${p.careerStats.interceptions || 0}</strong></span>
            </div>
        </article>`;
    }).join('') + '</div>';
}

/**
 * Renders the Offseason summary screen. Added safety checks.
 * @param {object} offseasonReport - Object containing results.
 * @param {number} year - The upcoming season year.
 */
export function renderOffseasonScreen(offseasonReport, year) {
    if (!offseasonReport) { console.error("Offseason report missing."); return; }
    // Use default empty arrays safely
    const { retiredPlayers = [], hofInductees = [], developmentResults = [], leavingPlayers = [] } = offseasonReport;

    if (elements.offseasonYear) elements.offseasonYear.textContent = year ?? '?';

    // Player Development
    let devHtml = '';
    if (developmentResults.length > 0) {
        developmentResults.forEach(res => {
            const playerName = res?.player?.name ?? '?'; const playerAge = res?.player?.age ?? '?';
            devHtml += `<div class="p-2 bg-gray-100 rounded text-sm mb-1"><p class="font-bold">${playerName} (${playerAge})</p><div class="flex flex-wrap gap-x-2">`;
            if (res?.improvements?.length > 0) { res.improvements.forEach(imp => { devHtml += `<span class="text-green-600">${imp?.attr ?? '?'} +${imp?.increase ?? '?'}</span>`; }); }
            else { devHtml += `<span>No improvements</span>`; }
            devHtml += '</div></div>'; });
    } else { devHtml = '<p>No development updates.</p>'; }
    if (elements.playerDevelopmentContainer) elements.playerDevelopmentContainer.innerHTML = devHtml;

    // Helper for lists
    const renderList = (element, items, formatFn) => { if (element) { element.innerHTML = items.length > 0 ? items.map(formatFn).join('') : '<li>None</li>'; } };

    renderList(elements.retirementsList, retiredPlayers, p => `<li>${p?.name ?? '?'} (Graduated)</li>`);
    renderList(elements.leavingPlayersList, leavingPlayers, l => `<li>${l?.player?.name ?? '?'} (${l?.reason || '?'})</li>`);
    renderList(elements.hofInducteesList, hofInductees, p => `<li>${p?.name ?? '?'}</li>`);
}

/**
 * Sets up drag and drop event listeners. Added safety checks.
 * @param {Function} onDrop - Callback `(playerId, newPositionSlot, side)`.
 */
export function setupDragAndDrop(onDrop) {
    const container = document.getElementById('dashboard-content'); if (!container) { console.error("Drag/drop container missing."); return; }
    let draggedEl = null;
    container.addEventListener('dragstart', e => { /* ... same logic ... */ if (e.target.matches('.draggable-player, .depth-chart-slot[draggable="true"]')) { draggedEl = e.target; dragPlayerId = e.target.dataset.playerId; dragSide = e.target.closest('.depth-chart-sub-pane')?.id.includes('offense') ? 'offense' : e.target.closest('.depth-chart-sub-pane')?.id.includes('defense') ? 'defense' : e.target.closest('.roster-list')?.id.includes('offense') ? 'offense' : e.target.closest('.roster-list')?.id.includes('defense') ? 'defense' : null; if (dragPlayerId && dragSide) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragPlayerId); setTimeout(() => draggedEl?.classList.add('dragging'), 0); } else { console.warn("Drag start ignored."); e.preventDefault(); } } else { e.preventDefault(); } });
    container.addEventListener('dragend', e => { /* ... same logic ... */ if (draggedEl) { draggedEl.classList.remove('dragging'); } draggedEl = null; dragPlayerId = null; dragSide = null; document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over')); });
    container.addEventListener('dragover', e => { /* ... same logic ... */ e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const targetSlot = e.target.closest('.depth-chart-slot'); document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over')); if (targetSlot && targetSlot.dataset.side === dragSide) { targetSlot.classList.add('drag-over'); } });
    container.addEventListener('dragleave', e => { /* ... same logic ... */ const targetSlot = e.target.closest('.depth-chart-slot'); if (targetSlot) { targetSlot.classList.remove('drag-over'); } if (!e.relatedTarget || !container.contains(e.relatedTarget)) { document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over')); } });
    container.addEventListener('drop', e => { /* ... same logic ... */ e.preventDefault(); document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over')); const dropSlot = e.target.closest('.depth-chart-slot'); const dropSide = dropSlot?.dataset.side; if (dropSlot && dropSlot.dataset.positionSlot && dragPlayerId && dropSide === dragSide) { onDrop(dragPlayerId, dropSlot.dataset.positionSlot, dropSide); } else { console.log("Invalid drop."); } });
}


/**
 * Sets up event listener for depth chart tabs. Added safety check.
 */
export function setupDepthChartTabs() {
    if (!elements.depthChartSubTabs) { console.error("Depth chart tabs container missing."); return; }
    elements.depthChartSubTabs.addEventListener('click', e => {
        if (e.target.matches('.depth-chart-tab')) {
            const subTab = e.target.dataset.subTab;
            elements.depthChartSubTabs.querySelectorAll('.depth-chart-tab').forEach(t => { const isSelected = t === e.target; t.classList.toggle('active', isSelected); t.setAttribute('aria-selected', isSelected.toString()); });
            const offensePane = document.getElementById('depth-chart-offense-pane'); const defensePane = document.getElementById('depth-chart-defense-pane');
            if (offensePane) offensePane.classList.toggle('hidden', subTab !== 'offense'); if (defensePane) defensePane.classList.toggle('hidden', subTab !== 'defense');
        }
    });
}


// ===================================
// --- Live Game Sim UI Logic (Simplified) ---
// ===================================

/** Helper to update field visualization */
function updateField(ballOnYard, possessionTeamName, homeTeamName) {
    if (!elements.fieldDisplay) return; // Guard
    const field = Array(12).fill(' . '); const ballMarker = !possessionTeamName ? ' ' : possessionTeamName === homeTeamName ? 'H' : 'A';
    if (ballOnYard <= 0 && possessionTeamName) field[0] = `[${ballMarker}]`; else if (ballOnYard >= 100 && possessionTeamName) field[11] = `[${ballMarker}]`; else if (possessionTeamName) { const fieldIndex = Math.floor(ballOnYard / 10) + 1; const safeIndex = Math.max(1, Math.min(10, fieldIndex)); field[safeIndex] = ` ${ballMarker} `; }
    elements.fieldDisplay.textContent = `AWAY [${field.slice(0, 6).join('')}] [${field.slice(6, 12).join('')}] HOME`;
}

/**
 * Starts the simplified live game simulation. Added safety checks and state parsing.
 * @param {object} gameResult - The result object containing gameLog, teams, and scores.
 * @param {Function} onComplete - Callback function when simulation ends.
 */
export function startLiveGameSim(gameResult, onComplete) {
    const ticker = elements.simPlayLog; const scoreboard = elements.simScoreboard;
    // Check essential elements and gameResult structure
    if (!ticker || !scoreboard || !elements.simAwayScore || !elements.simHomeScore || !elements.simGameDrive || !elements.simGameDown || !elements.simPossession || !elements.fieldDisplay) { console.error("Live sim UI elements missing!"); if (onComplete) onComplete(); return; }
    if (!gameResult || !Array.isArray(gameResult.gameLog) || gameResult.gameLog.length === 0 || !gameResult.homeTeam || !gameResult.awayTeam) { console.warn("startLiveGameSim: invalid gameResult."); ticker.innerHTML = '<p>No game events.</p>'; if (onComplete) onComplete(); return; }

    if (liveGameInterval) clearInterval(liveGameInterval); // Clear previous interval
    ticker.innerHTML = ''; // Clear log
    liveGameCurrentIndex = 0; liveGameLog = gameResult.gameLog; liveGameCallback = onComplete;
    // Initialize simulation state variables
    let currentHomeScore = 0; let currentAwayScore = 0; let ballOn = 20; let down = 1; let toGo = 10; let possessionTeamName = null; let currentDriveText = 'Pre-Game'; let driveActive = false;

    // --- Initialize UI state ---
     elements.simAwayScore.textContent = '0'; elements.simHomeScore.textContent = '0'; elements.simGameDrive.textContent = currentDriveText; elements.simGameDown.textContent = ''; elements.simPossession.textContent = '';
     updateField(ballOn, null, gameResult.homeTeam.name);
    // --- End Initial UI ---

    // --- Function to process the next log entry ---
    function nextEntry() {
        if (liveGameCurrentIndex >= liveGameLog.length) { // End condition
            clearInterval(liveGameInterval); liveGameInterval = null;
            // Ensure Final Score is Correct
            elements.simAwayScore.textContent = gameResult.awayScore; elements.simHomeScore.textContent = gameResult.homeScore; elements.simGameDown.textContent = "FINAL"; elements.simPossession.textContent = "";
            if (liveGameCallback) { const cb = liveGameCallback; liveGameCallback = null; cb(); } // Clear callback after calling
            return;
        }

        const play = liveGameLog[liveGameCurrentIndex];
        const p = document.createElement('p');
        // Apply styling based on log entry type
        if (play.startsWith('-- Drive') || play.startsWith('====')) { p.className = 'font-bold text-amber-400 mt-2'; if (play.startsWith('==== FINAL')) p.classList.add('text-lg');}
        else if (play.startsWith('TOUCHDOWN') || play.includes('GOOD!')) { p.className = 'font-semibold text-green-400'; }
        else if (play.startsWith('Turnover') || play.startsWith('INTERCEPTION') || play.startsWith('FUMBLE') || play.includes('FAILED!')) { p.className = 'font-semibold text-red-400';}
        else if (play.startsWith('SACK')) { p.className = 'text-orange-400';}
        else if (play.startsWith('INJURY')) { p.className = 'text-purple-400 italic';}
        p.textContent = play; ticker.appendChild(p); ticker.scrollTop = ticker.scrollHeight; // Auto-scroll

        // --- Update Internal Simulation State based on log ---
         if (play.startsWith('-- Drive')) {
             ballOn = 20; down = 1; toGo = 10; driveActive = true;
             const driveMatch = play.match(/(Drive \d+ \(H\d+\))/);
             possessionTeamName = play.includes(gameResult.homeTeam.name) ? gameResult.homeTeam.name : gameResult.awayTeam.name;
             if(driveMatch) currentDriveText = driveMatch[0];
         } else if (play.startsWith('First down!')) {
             down = 1; toGo = 10;
         } else if (play.match(/for (-?\d+) yards?/)) { // Handles gains and losses
             const yards = parseInt(play.match(/for (-?\d+) yards?/)[1], 10);
             if (driveActive) { // Only update if drive is active
                 ballOn += yards; toGo -= yards; ballOn = Math.max(0,Math.min(100, ballOn)); // Clamp ball position
                 if (toGo <= 0) { /* First down handled by 'First down!' log */ } else { down++; }
             }
         } else if (play.startsWith('INCOMPLETE')) {
             if (driveActive) down++;
         } else if (play.startsWith('TOUCHDOWN')) {
             ballOn = 100; driveActive = false; // Drive pauses for conversion
         } else if (play.includes('conversion GOOD!')) {
             const points = play.startsWith('2') ? 2 : 1;
             if(possessionTeamName === gameResult.homeTeam.name) currentHomeScore += (6 + points); else currentAwayScore += (6 + points);
             driveActive = false; // Drive ends after conversion
         } else if (play.includes('Conversion FAILED!')) {
             const points = 6;
             if(possessionTeamName === gameResult.homeTeam.name) currentHomeScore += points; else currentAwayScore += points;
             driveActive = false; // Drive ends after conversion
         } else if (play.startsWith('Turnover') || play.startsWith('INTERCEPTION') || play.startsWith('FUMBLE')) {
             driveActive = false; // Drive ends
             // Possession switch happens implicitly on the next '-- Drive' log
         } else if (play.startsWith('==== FINAL') || play.startsWith('==== HALFTIME')) {
             driveActive = false; // Drive/Game ends
         }

         // Check for turnover on downs after down potentially increments
         if (down > 4 && driveActive) {
             driveActive = false; // Turnover on downs
             // Possession switch happens implicitly on the next '-- Drive' log
         }
        // --- End State Update ---

        // --- Update UI elements based on current state ---
        elements.simAwayScore.textContent = currentAwayScore;
        elements.simHomeScore.textContent = currentHomeScore;
        elements.simGameDrive.textContent = currentDriveText;
        elements.simGameDown.textContent = driveActive ? `${down} & ${toGo <= 0 ? 'Goal' : toGo}` : 'Change of Possession';
        elements.simPossession.textContent = possessionTeamName ? `${possessionTeamName} Ball` : '';
        updateField(ballOn, possessionTeamName, gameResult.homeTeam.name);
        // --- End UI Update ---

        liveGameCurrentIndex++; // Move to next log entry
    }
    // --- End nextEntry function ---

    // Start the interval timer
    liveGameInterval = setInterval(nextEntry, liveGameSpeed);
}


/**
 * Stops the live game simulation interval, updates UI to final state, and triggers the onComplete callback.
 * @param {object} gameResult - Pass the final gameResult to ensure final score is shown accurately.
 */
export function skipLiveGameSim(gameResult) {
    if (liveGameInterval) { clearInterval(liveGameInterval); liveGameInterval = null; } // Stop the timer

    const ticker = elements.simPlayLog;
    if (ticker) { // Add skip message to log
        const p = document.createElement('p'); p.className = 'italic text-gray-400 mt-2'; p.textContent = '--- Simulation skipped ---'; ticker.appendChild(p); ticker.scrollTop = ticker.scrollHeight;
    }

     // --- Ensure Final Score and Status are Displayed ---
     if (gameResult) { // Use provided final result data
         if (elements.simAwayScore) elements.simAwayScore.textContent = gameResult.awayScore;
         if (elements.simHomeScore) elements.simHomeScore.textContent = gameResult.homeScore;
         if (elements.simGameDown) elements.simGameDown.textContent = "FINAL";
         if (elements.simPossession) elements.simPossession.textContent = "";
         // Optionally update field to final state or clear it
         // updateField(100, null, gameResult.homeTeam.name); // Example: Clear field
     } else {
          console.warn("skipLiveGameSim called without gameResult, final score might be inaccurate.");
     }
     // --- End Final Score Update ---

     // Trigger the completion callback if it exists
     if (liveGameCallback) {
          const cb = liveGameCallback; liveGameCallback = null; // Clear callback reference
          cb(); // Execute the callback
     }
}

/**
 * Changes the speed of the live game simulation interval.
 * Restarts the interval timer with the new speed.
 * @param {number} speed - New speed in milliseconds (e.g., 1000, 400, 100).
 */
export function setSimSpeed(speed) {
    liveGameSpeed = speed; // Update the speed variable

    // Update button visual styles to show active speed
    elements.simSpeedBtns?.forEach(btn => btn.classList.remove('active', 'bg-blue-500', 'hover:bg-blue-600'));
    elements.simSpeedBtns?.forEach(btn => btn.classList.add('bg-gray-500', 'hover:bg-gray-600'));
    let activeButtonId;
    if (speed === 1000) activeButtonId = 'sim-speed-play'; else if (speed === 400) activeButtonId = 'sim-speed-fast'; else if (speed === 100) activeButtonId = 'sim-speed-faster';
    const activeButton = document.getElementById(activeButtonId);
    if (activeButton) { activeButton.classList.remove('bg-gray-500', 'hover:bg-gray-600'); activeButton.classList.add('active', 'bg-blue-500', 'hover:bg-blue-600'); }

    // If a simulation interval is currently running, clear and restart it with the new speed
    if (liveGameInterval) {
        clearInterval(liveGameInterval);

        // Recreate the 'nextEntry' function locally to capture current state correctly for the restart
        // This avoids complex scoping issues or needing to pass 'nextEntry' around.
        // It reuses the globally scoped liveGameLog, liveGameCurrentIndex, etc.
        function nextEntryForRestart() {
             if (liveGameCurrentIndex >= liveGameLog.length) { // End condition
                 clearInterval(liveGameInterval); liveGameInterval = null;
                 // Try to get final result to display accurately on completion
                 const finalGameResult = game?.gameResults?.[game.gameResults.length-1]; // Access global game cautiously
                 if(finalGameResult) {
                     if (elements.simAwayScore) elements.simAwayScore.textContent = finalGameResult.awayScore;
                     if (elements.simHomeScore) elements.simHomeScore.textContent = finalGameResult.homeScore;
                     if (elements.simGameDown) elements.simGameDown.textContent = "FINAL";
                     if (elements.simPossession) elements.simPossession.textContent = "";
                 } else { console.warn("Could not get final game result after speed change completion."); }
                 if (liveGameCallback) { const cb = liveGameCallback; liveGameCallback = null; cb(); } // Call and clear callback
                 return;
             }

             // --- Logic identical to the main nextEntry function ---
             const play = liveGameLog[liveGameCurrentIndex];
             const p = document.createElement('p');
             // Apply styling
             if (play.startsWith('-- Drive') || play.startsWith('====')) { p.className = 'font-bold text-amber-400 mt-2'; if (play.startsWith('==== FINAL')) p.classList.add('text-lg'); }
             else if (play.startsWith('TOUCHDOWN') || play.includes('GOOD!')) { p.className = 'font-semibold text-green-400'; }
             else if (play.startsWith('Turnover') || play.startsWith('INTERCEPTION') || play.startsWith('FUMBLE') || play.includes('FAILED!')) { p.className = 'font-semibold text-red-400'; }
             else if (play.startsWith('SACK')) { p.className = 'text-orange-400'; }
             else if (play.startsWith('INJURY')) { p.className = 'text-purple-400 italic'; }
             p.textContent = play;
             if (elements.simPlayLog) { // Check element exists before appending
                 elements.simPlayLog.appendChild(p);
                 elements.simPlayLog.scrollTop = elements.simPlayLog.scrollHeight;
             }
             // NOTE: This simplified sim doesn't re-parse the state dynamically on speed change.
             // It just continues adding log lines at the new speed. Scoreboard updates might lag/jump.
             liveGameCurrentIndex++;
             // --- End identical logic ---
        }

        // Restart the interval with the *new* speed
        liveGameInterval = setInterval(nextEntryForRestart, liveGameSpeed);
    }
}

