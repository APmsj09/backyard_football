import { calculateOverall, positionOverallWeights } from './game.js';
import { offenseFormations, defenseFormations } from './data.js';

let elements = {};
let selectedPlayerId = null;
let dragPlayerId = null;
let dragSide = null; // 'offense' or 'defense'
let debounceTimeout = null; // For debouncing input
// NEW: State for live game sim interval
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
    return function(...args) {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}


/**
 * Grabs references to all necessary DOM elements.
 * Explicitly gets each required element by ID.
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
            gameSimScreen: document.getElementById('game-sim-screen'), // Keep this one too
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
    if (elements.screens) {
        // Log the attempt and current state
        console.log(`showScreen called for: ${screenId}. Current elements.screens keys found during setup:`, Object.keys(elements.screens).filter(k => elements.screens[k]));

        // Check if the screen ID exists in the registered elements
        if (!elements.screens[screenId]) {
            console.error(`Error in showScreen: Screen element with ID "${screenId}" was NOT FOUND during setupElements.`);
             // Attempt a direct lookup *now* as a last resort
             const element = document.getElementById(screenId);
             if (element) {
                 console.warn(`Screen "${screenId}" found via direct lookup, but wasn't registered correctly. Check setupElements.`);
                 elements.screens[screenId] = element; // Add it dynamically if found now
             } else {
                 console.error(`CRITICAL: Screen element with ID "${screenId}" still not found.`);
                 return; // Stop if definitely not found
             }
        }

        // Hide all *found* screens first
        Object.keys(elements.screens).forEach(key => {
            const screenElement = elements.screens[key];
            // Check if the element actually exists before trying to add 'hidden'
            if (screenElement && screenElement.classList) {
                screenElement.classList.add('hidden');
            }
        });

        // Show the target screen
        elements.screens[screenId].classList.remove('hidden');

    } else {
        console.error("Screen elements object (elements.screens) not initialized when showScreen was called.");
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
    let actionsDiv = modalContent.querySelector('#modal-actions');
    // Remove existing actions div if it exists
    if (actionsDiv) {
        actionsDiv.remove();
    }
    // Create new actions container
    actionsDiv = document.createElement('div');
    actionsDiv.id = 'modal-actions';
    actionsDiv.className = 'mt-6 text-right space-x-2';

    // Helper to create a button
    const createButton = (text, classes, onClick) => {
        const button = document.createElement('button');
        button.textContent = text;
        button.className = classes;
        button.onclick = onClick;
        return button;
    };

    // Create Cancel/Close button
    const closeAction = () => {
        if (onCancel) onCancel();
        hideModal();
    };
    actionsDiv.appendChild(createButton(cancelText, 'bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-6 rounded-lg', closeAction));

    // Create Confirm button if needed
    if (onConfirm) {
        const confirmAction = () => {
            onConfirm();
            hideModal();
        };
        actionsDiv.appendChild(createButton(confirmText, 'bg-amber-500 hover:bg-amber-600 text-white font-bold py-2 px-6 rounded-lg', confirmAction));
    }

    modalContent.appendChild(actionsDiv);
    // --- End Refined Modal Actions ---

    elements.modal.classList.remove('hidden');
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
        elements.loadingProgress.style.width = `${Math.min(100, progress * 100)}%`;
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
    if (!gameState || !gameState.teams || !gameState.players || !gameState.draftOrder || !gameState.playerTeam) {
        console.error("renderDraftScreen called without valid gameState.");
        // Optionally show an error state on the screen itself
        if(elements.draftHeader) elements.draftHeader.innerHTML = `<h2 class="text-3xl font-bold text-red-500">Draft Error: Invalid Game State</h2>`;
        return;
    }
    const { year, draftOrder, currentPick, playerTeam, players, teams } = gameState;

    // --- Robust Draft End Condition Checks ---
    const totalPossiblePicks = (draftOrder?.length || 0);
    const undraftedPlayersCount = players.filter(p => !p.teamId).length;
    const allNeedsMetOrFull = teams.every(t => {
        const needs = t.draftNeeds || 0;
        const picksMade = (draftOrder || []).slice(0, currentPick).filter(teamInOrder => teamInOrder.id === t.id).length;
        return t.roster.length >= 10 || picksMade >= needs;
    });

    // Check if the draft should end
    if (currentPick >= totalPossiblePicks || undraftedPlayersCount === 0 || allNeedsMetOrFull) {
        elements.draftHeader.innerHTML = `<h2 class="text-3xl font-bold">Season ${year} Draft Complete</h2><p>All teams have filled their rosters, met draft needs, or the player pool is empty.</p>`;
        elements.draftPlayerBtn.disabled = true;
        elements.draftPlayerBtn.textContent = 'Draft Complete';
        renderSelectedPlayerCard(null, gameState); // Clear selection card
        updateSelectedPlayerRow(null); // Clear table highlight
        if (elements.draftPoolTbody) elements.draftPoolTbody.innerHTML = '<tr><td colspan="13" class="text-center p-4 text-gray-500">Draft pool is empty or draft is complete.</td></tr>'; // Clear pool
        return;
    }
    // --- End Robust Draft End Checks ---

    // Ensure pick is valid before proceeding (redundant check, but safe)
    if (currentPick >= draftOrder.length) {
        console.error(`Draft Error: currentPick (${currentPick}) is out of bounds for draftOrder array (length ${draftOrder?.length}).`);
        elements.draftHeader.innerHTML = `<h2 class="text-3xl font-bold text-red-500">Draft Error Occurred</h2>`;
        return; // Stop rendering if state is invalid
    }

    const pickingTeam = draftOrder[currentPick];
    const playerCanPick = pickingTeam.id === playerTeam.id && playerTeam.roster.length < 10;

    // Update header elements
    elements.draftYear.textContent = year;
    elements.draftPickNumber.textContent = currentPick + 1;
    elements.draftPickingTeam.textContent = pickingTeam.name;

    // Render dynamic parts
    renderDraftPool(gameState, onPlayerSelect);
    renderPlayerRoster(gameState.playerTeam);

    // Update draft button state
    elements.draftPlayerBtn.disabled = !playerCanPick || currentSelectedId === null;
    elements.draftPlayerBtn.textContent = playerCanPick ? 'Draft Player' : `Waiting for ${pickingTeam.name}...`;
}

/**
 * Renders the table of available players in the draft pool, applying filters and sorting.
 * @param {object} gameState - The current game state object.
 * @param {Function} onPlayerSelect - Callback function when a player row is clicked.
 */
export function renderDraftPool(gameState, onPlayerSelect) {
    if (!elements.draftPoolTbody || !gameState || !gameState.players) return; // Exit if table body or state isn't found

    const undraftedPlayers = gameState.players.filter(p => !p.teamId);

    // Get filter/sort values safely
    const searchTerm = elements.draftSearch?.value.toLowerCase() || '';
    const posFilter = elements.draftFilterPos?.value || '';
    const sortMethod = elements.draftSort?.value || 'default';

    // Filter players
    let filteredPlayers = undraftedPlayers.filter(p =>
        p.name.toLowerCase().includes(searchTerm) &&
        (!posFilter || p.favoriteOffensivePosition === posFilter || p.favoriteDefensivePosition === posFilter)
    );

    // Sort players based on selection
    switch (sortMethod) {
        case 'age-asc':
            filteredPlayers.sort((a, b) => a.age - b.age);
            break;
        case 'age-desc':
            filteredPlayers.sort((a, b) => b.age - a.age);
            break;
        case 'speed-desc':
            filteredPlayers.sort((a, b) => (b.attributes?.physical?.speed || 0) - (a.attributes?.physical?.speed || 0));
            break;
        case 'strength-desc':
            filteredPlayers.sort((a, b) => (b.attributes?.physical?.strength || 0) - (a.attributes?.physical?.strength || 0));
            break;
        case 'agility-desc':
            filteredPlayers.sort((a, b) => (b.attributes?.physical?.agility || 0) - (a.attributes?.physical?.agility || 0));
            break;
        // Add more cases here for other attributes if needed
        default:
            // Default sort: maybe young potential? Basic sort for now.
            // Consider adding a 'potential' calculation later if desired.
            break;
    }

    elements.draftPoolTbody.innerHTML = ''; // Clear previous table body

    if (filteredPlayers.length === 0) {
        elements.draftPoolTbody.innerHTML = '<tr><td colspan="13" class="text-center p-4 text-gray-500">No players match the current filters.</td></tr>';
        return;
    }

    // Populate table rows
    filteredPlayers.forEach(player => {
        const row = document.createElement('tr');
        // Add selected class if this player is the currently selected one
        row.className = `cursor-pointer hover:bg-amber-100 draft-player-row ${player.id === selectedPlayerId ? 'bg-amber-200' : ''}`;
        row.dataset.playerId = player.id;
        // Use helper function or template literal for cleaner HTML generation
        row.innerHTML = `
            <td class="py-2 px-3 font-semibold">${player.name}</td>
            <td class="text-center py-2 px-3">${player.age}</td>
            <td class="text-center py-2 px-3">${player.favoriteOffensivePosition || 'N/A'}/${player.favoriteDefensivePosition || 'N/A'}</td>
            <td class="text-center py-2 px-3">${player.attributes?.physical?.height || '?'}</td>
            <td class="text-center py-2 px-3">${player.attributes?.physical?.weight || '?'}</td>
            <td class="text-center py-2 px-3">${player.attributes?.physical?.speed || '?'}</td>
            <td class="text-center py-2 px-3">${player.attributes?.physical?.strength || '?'}</td>
            <td class="text-center py-2 px-3">${player.attributes?.physical?.agility || '?'}</td>
            <td class="text-center py-2 px-3">${player.attributes?.technical?.throwingAccuracy || '?'}</td>
            <td class="text-center py-2 px-3">${player.attributes?.technical?.catchingHands || '?'}</td>
            <td class="text-center py-2 px-3">${player.attributes?.technical?.blocking || '?'}</td>
            <td class="text-center py-2 px-3">${player.attributes?.technical?.tackling || '?'}</td>
            <td class="text-center py-2 px-3">${player.attributes?.technical?.blockShedding || '?'}</td>
        `;
        row.onclick = () => onPlayerSelect(player.id);
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
    selectedPlayerId = newSelectedId; // Update internal state for use in renderDraftPool
    // Update visual highlighting immediately
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
        positions.forEach(pos => {
            overallsHtml += `
                <div class="bg-gray-200 p-2 rounded">
                    <p class="font-semibold text-xs">${pos} OVR</p>
                    <p class="font-bold text-xl">${calculateOverall(player, pos)}</p>
                </div>
            `;
        });
        overallsHtml += '</div>';

        elements.selectedPlayerCard.innerHTML = `
            <h4 class="font-bold text-lg">${player.name}</h4>
            <p class="text-sm text-gray-600">Age: ${player.age} | ${player.attributes?.physical?.height || '?'} | ${player.attributes?.physical?.weight || '?'} lbs</p>
            ${overallsHtml}
        `;
    }

    // Update draft button state (requires gameState)
    if (gameState && elements.draftPlayerBtn) {
        const { draftOrder, currentPick, playerTeam } = gameState;
        // Check if draft order exists and pick is valid
        if (draftOrder && currentPick >= 0 && currentPick < draftOrder.length && playerTeam) {
            const pickingTeam = draftOrder[currentPick];
            const playerCanPick = pickingTeam.id === playerTeam.id && playerTeam.roster.length < 10;
            elements.draftPlayerBtn.disabled = !playerCanPick || !player;
        } else {
            // Draft likely over or error state
             console.warn("Updating draft button state: Draft order invalid or pick out of bounds.");
            elements.draftPlayerBtn.disabled = true; // Disable if state is invalid
        }
    } else if (elements.draftPlayerBtn) {
        // Fallback if gameState isn't provided
        elements.draftPlayerBtn.disabled = !player;
    }
}

/**
 * Renders the player's current roster list in the draft side panel.
 * @param {object} playerTeam - The player's team object.
 */
export function renderPlayerRoster(playerTeam) {
    if (!elements.rosterCount || !elements.draftRosterList || !playerTeam) return;

    const roster = playerTeam.roster || []; // Handle case where roster might be missing
    elements.rosterCount.textContent = `${roster.length}/10`;
    elements.draftRosterList.innerHTML = ''; // Clear previous list

    if (roster.length === 0) {
        const li = document.createElement('li');
        li.className = 'p-2 text-center text-gray-500';
        li.textContent = 'No players drafted yet.';
        elements.draftRosterList.appendChild(li);
    } else {
        roster.forEach(player => {
            const li = document.createElement('li');
            li.className = 'p-2';
            li.textContent = `${player.name} (${player.favoriteOffensivePosition || '?'}/${player.favoriteDefensivePosition || '?'})`;
            elements.draftRosterList.appendChild(li);
        });
    }
    renderRosterSummary(playerTeam); // Update summary stats
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

    let summaryHtml = '<h5 class="font-bold text-sm mb-1">Team Average Overalls</h5><div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">';

    positions.forEach(pos => {
        const totalOvr = roster.reduce((sum, player) => sum + calculateOverall(player, pos), 0);
        const avgOvr = Math.round(totalOvr / roster.length); // length is checked > 0 above

        summaryHtml += `
            <div class="flex justify-between">
                <span class="font-semibold">${pos}:</span>
                <span class="font-bold">${avgOvr}</span>
            </div>
        `;
    });

    summaryHtml += '</div>';
    elements.rosterSummary.innerHTML = summaryHtml;
}

// --- Start of functions previously replaced by placeholder ---

/**
 * Renders the main dashboard header and populates team filter.
 * @param {object} gameState - The current game state object.
 */
export function renderDashboard(gameState) {
    if (!gameState || !gameState.playerTeam) {
        console.error("renderDashboard called with invalid gameState.");
        return;
    }
    const { playerTeam, year, currentWeek, messages, teams } = gameState;
    const currentW = currentWeek < 9 ? `Week ${currentWeek + 1}` : 'Offseason'; // Calculate week text

    // Update header elements safely
    if (elements.dashboardTeamName) elements.dashboardTeamName.textContent = playerTeam.name;
    if (elements.dashboardRecord) elements.dashboardRecord.textContent = `Record: ${playerTeam.wins} - ${playerTeam.losses}`;
    if (elements.dashboardYear) elements.dashboardYear.textContent = year;
    if (elements.dashboardWeek) elements.dashboardWeek.textContent = currentW;
    if (elements.advanceWeekBtn) elements.advanceWeekBtn.textContent = currentWeek < 9 ? 'Advance Week' : 'Go to Offseason';

    // Populate team filter dropdown on stats page
    if (elements.statsFilterTeam && teams) {
        let teamOptions = '<option value="">All Teams</option>';
        // Sort teams alphabetically for the dropdown
        teams.sort((a, b) => a.name.localeCompare(b.name)).forEach(t => teamOptions += `<option value="${t.id}">${t.name}</option>`);
        elements.statsFilterTeam.innerHTML = teamOptions;
    }

    if (messages) updateMessagesNotification(messages);
    renderMyTeamTab(gameState); // Render the default 'My Team' tab
}

/**
 * Handles switching between dashboard tabs.
 * @param {string} tabId - The ID of the tab to switch to (e.g., 'my-team').
 * @param {object} gameState - The current game state object.
 */
export function switchTab(tabId, gameState) {
    if (!elements.dashboardContent || !elements.dashboardTabs) {
         console.error("Dashboard elements missing, cannot switch tab.");
         return;
     }

    // Hide all tab content panes
    elements.dashboardContent.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
    // Deactivate all tab buttons
    elements.dashboardTabs.querySelectorAll('.tab-button').forEach(b => {
         b.classList.remove('active');
         b.setAttribute('aria-selected', 'false'); // Accessibility update
     });

    // Show the selected tab content and activate the button
    const contentPane = document.getElementById(`tab-content-${tabId}`);
    const tabButton = elements.dashboardTabs.querySelector(`[data-tab="${tabId}"]`);
    if (contentPane) {
         contentPane.classList.remove('hidden');
    } else {
        console.warn(`Content pane for tab "${tabId}" not found.`);
    }
    if (tabButton) {
         tabButton.classList.add('active');
         tabButton.setAttribute('aria-selected', 'true'); // Accessibility update
     } else {
         console.warn(`Button for tab "${tabId}" not found.`);
     }

    // Render the content for the selected tab - Ensure gameState is valid
    if (!gameState) {
        console.warn(`switchTab called for "${tabId}" without valid gameState.`);
        if(contentPane) contentPane.innerHTML = '<p class="text-red-500">Error: Game state not available.</p>'; // Show error in tab
        return;
    }
    try { // Add try-catch around rendering logic
        switch (tabId) {
            case 'my-team': renderMyTeamTab(gameState); break;
            case 'depth-chart': renderDepthChartTab(gameState); break;
            case 'messages': renderMessagesTab(gameState); break;
            case 'schedule': renderScheduleTab(gameState); break;
            case 'standings': renderStandingsTab(gameState); break;
            case 'player-stats': renderPlayerStatsTab(gameState); break;
            case 'hall-of-fame': renderHallOfFameTab(gameState); break;
            default:
                console.warn(`Unknown tab ID: ${tabId}`);
                if(contentPane) contentPane.innerHTML = `<p>Content for tab "${tabId}" not implemented.</p>`;
        }
    } catch (error) {
         console.error(`Error rendering tab "${tabId}":`, error);
         if(contentPane) contentPane.innerHTML = `<p class="text-red-500">Error rendering ${tabId} content. Check console.</p>`;
    }

    // Mark messages as read when switching to the messages tab
    if (tabId === 'messages' && gameState.messages) {
        updateMessagesNotification(gameState.messages, true); // Mark all as read
    }
}

/**
 * Renders the 'My Team' tab content (roster table).
 * @param {object} gameState - The current game state object.
 */
function renderMyTeamTab(gameState) {
    if (!elements.myTeamRoster || !gameState?.playerTeam?.roster) {
        if(elements.myTeamRoster) elements.myTeamRoster.innerHTML = '<p class="text-gray-500">Roster data not available.</p>';
        return;
    }

    const roster = gameState.playerTeam.roster;
    const physicalAttrs = ['height', 'weight', 'speed', 'strength', 'agility', 'stamina'];
    const mentalAttrs = ['playbookIQ', 'clutch', 'consistency', 'toughness'];
    const technicalAttrs = ['throwingAccuracy', 'catchingHands', 'blocking', 'tackling', 'blockShedding'];

    let tableHtml = `<div class="overflow-x-auto"><table class="min-w-full bg-white text-sm"><thead class="bg-gray-800 text-white sticky top-0 z-10"><tr>
        <th scope="col" class="py-2 px-3 text-left sticky left-0 bg-gray-800 z-20">Name</th>
        <th scope="col" class="py-2 px-3">Type</th>
        <th scope="col" class="py-2 px-3">Age</th>
        <th scope="col" class="py-2 px-3">Status</th>
        ${physicalAttrs.map(h => `<th scope="col" class="py-2 px-3 uppercase">${h.slice(0,3)}</th>`).join('')}
        ${mentalAttrs.map(h => `<th scope="col" class="py-2 px-3 uppercase">${h.slice(0,3)}</th>`).join('')}
        ${technicalAttrs.map(h => `<th scope="col" class="py-2 px-3 uppercase">${h.slice(0,3)}</th>`).join('')}
    </tr></thead><tbody class="divide-y">`;

    if (roster.length === 0) {
        tableHtml += '<tr><td colspan="15" class="text-center p-4 text-gray-500">Your roster is empty.</td></tr>';
    } else {
        roster.forEach(p => {
            const statusClass = p.status?.duration > 0 ? 'text-red-500 font-semibold' : 'text-green-600';
            const statusText = p.status?.description || 'Healthy';
            const typeTag = p.status?.type === 'temporary' ? '<span class="status-tag temporary" title="Temporary Friend">[TEMP]</span>' : '<span class="status-tag permanent" title="Permanent Roster">[PERM]</span>';

            // Use row header for player name for accessibility
            tableHtml += `<tr>
                <th scope="row" class="py-2 px-3 font-semibold sticky left-0 bg-white z-10">${p.name}</th>
                <td class="text-center py-2 px-3">${typeTag}</td>
                <td class="text-center py-2 px-3">${p.age}</td>
                <td class="text-center py-2 px-3 ${statusClass}" title="${statusText}">${statusText} ${p.status?.duration > 0 ? `(${p.status.duration}w)` : ''}</td>`;

            const renderAttr = (val, attrName) => {
                // Add 'breakthrough' class if this attribute improved last game
                const breakthroughClass = p.breakthroughAttr === attrName ? ' breakthrough font-bold text-green-600' : '';
                return `<td class="text-center py-2 px-3${breakthroughClass}" title="${attrName}">${val ?? '?'}</td>`; // Use ?? '?' for safety
            };

            physicalAttrs.forEach(attr => tableHtml += renderAttr(p.attributes?.physical?.[attr], attr));
            mentalAttrs.forEach(attr => tableHtml += renderAttr(p.attributes?.mental?.[attr], attr));
            technicalAttrs.forEach(attr => tableHtml += renderAttr(p.attributes?.technical?.[attr], attr));

            tableHtml += `</tr>`;
        });
    }

    elements.myTeamRoster.innerHTML = tableHtml + `</tbody></table></div>`;
}


/**
 * Renders the 'Depth Chart' tab content.
 * @param {object} gameState - The current game state object.
 */
function renderDepthChartTab(gameState) {
    if (!gameState || !gameState.playerTeam || !gameState.playerTeam.roster) {
         console.error("Cannot render depth chart: Invalid game state or roster missing.");
         // Optionally clear the containers or show an error message
         if(elements.positionalOverallsContainer) elements.positionalOverallsContainer.innerHTML = '<p class="text-red-500">Error loading depth chart data.</p>';
         if(elements.offenseDepthChartSlots) elements.offenseDepthChartSlots.innerHTML = '';
         if(elements.defenseDepthChartSlots) elements.defenseDepthChartSlots.innerHTML = '';
         return;
     }
    // Render the table comparing player overalls across all positions
    renderPositionalOveralls(gameState.playerTeam.roster.filter(p => p.status?.type !== 'temporary')); // Filter safely

    // Set up and render the offensive depth chart
    renderFormationDropdown('offense', Object.values(offenseFormations), gameState.playerTeam.formations?.offense); // Check formations exist
    renderDepthChartSide('offense', gameState, elements.offenseDepthChartSlots, elements.offenseDepthChartRoster);

    // Set up and render the defensive depth chart
    renderFormationDropdown('defense', Object.values(defenseFormations), gameState.playerTeam.formations?.defense);
    renderDepthChartSide('defense', gameState, elements.defenseDepthChartSlots, elements.defenseDepthChartRoster);
}

/**
 * Populates the formation selection dropdown for offense or defense.
 * @param {string} side - 'offense' or 'defense'.
 * @param {object[]} formations - Array of formation objects available for that side.
 * @param {string} currentFormationName - The name of the team's currently selected formation.
 */
function renderFormationDropdown(side, formations, currentFormationName) {
    const selectEl = elements[`${side}FormationSelect`];
    if (!selectEl) return;
    // Generate <option> elements, marking the current formation as selected
    selectEl.innerHTML = formations
        .map(f => `<option value="${f.name}" ${f.name === currentFormationName ? 'selected' : ''}>${f.name}</option>`)
        .join('');
}

/**
 * Renders the table showing overall ratings for each player at each position.
 * @param {object[]} roster - Array of player objects (typically filtered).
 */
function renderPositionalOveralls(roster) {
    if (!elements.positionalOverallsContainer) return;
    const positions = Object.keys(positionOverallWeights);
    // Build table header
    let table = `<table class="min-w-full text-sm text-left"><thead class="bg-gray-100"><tr><th scope="col" class="p-2 font-semibold sticky left-0 bg-gray-100 z-10">Player</th>${positions.map(p => `<th scope="col" class="p-2 font-semibold text-center">${p}</th>`).join('')}</tr></thead><tbody>`;
    // Add row for each player
    if (roster.length > 0) {
        roster.forEach(player => {
            // Use row header for player name
            table += `<tr class="border-b"><th scope="row" class="p-2 font-bold sticky left-0 bg-white z-0">${player.name}</th>${positions.map(p => `<td class="p-2 text-center">${calculateOverall(player, p)}</td>`).join('')}</tr>`;
        });
    } else {
        table += `<tr><td colspan="${positions.length + 1}" class="text-center p-4 text-gray-500">No permanent roster players found.</td></tr>`;
    }
    elements.positionalOverallsContainer.innerHTML = table + '</tbody></table>';
}

/**
 * Renders the depth chart slots and available players for one side (offense/defense).
 * @param {string} side - 'offense' or 'defense'.
 * @param {object} gameState - The current game state object.
 * @param {HTMLElement} slotsContainer - The DOM element for starter slots.
 * @param {HTMLElement} rosterContainer - The DOM element for available players list.
 */
function renderDepthChartSide(side, gameState, slotsContainer, rosterContainer) {
    if (!slotsContainer || !rosterContainer || !gameState?.playerTeam?.roster || !gameState?.playerTeam?.depthChart) {
         console.error(`Cannot render depth chart side "${side}": Missing elements or game state.`);
         return;
     }

    const { roster, depthChart } = gameState.playerTeam;
    // Get slots defined by the current formation for this side, handle potential undefined chart
    const currentChart = depthChart[side] || {};
    const slots = Object.keys(currentChart);

    slotsContainer.innerHTML = ''; // Clear previous slots
    // Add header row for slots table
    const header = document.createElement('div');
    header.className = 'depth-chart-slot flex items-center justify-between font-bold text-xs text-gray-500 px-2';
    // Define columns for the starter display
    header.innerHTML = `<span class="w-1/4">POS</span><div class="player-details-grid w-3/4"><span>NAME</span><span>OVR</span><span>SPD</span><span>STR</span><span>AGI</span><span>THR</span><span>CAT</span></div>`;
    slotsContainer.appendChild(header);
    // Render each starter slot based on current depth chart
    slots.forEach(slot => renderSlot(slot, roster, currentChart, slotsContainer, side));

    // Determine available players (those not starting on *this* specific side)
    const playersStartingOnThisSide = new Set(Object.values(currentChart).filter(Boolean)); // Use Set for efficient lookup
    const availablePlayers = roster.filter(p => !playersStartingOnThisSide.has(p.id));

    // Render the list of available (draggable) players
    renderAvailablePlayerList(availablePlayers, rosterContainer, side);
}

/**
 * Renders a single depth chart slot (starter position), making it draggable if occupied.
 * @param {string} positionSlot - The name of the slot (e.g., 'QB1', 'WR2').
 * @param {object[]} roster - The full team roster array.
 * @param {object} chart - The depth chart object for the current side ({ QB1: playerId, ... }).
 * @param {HTMLElement} container - The parent element to append the slot element to.
 * @param {string} side - 'offense' or 'defense'.
 */
function renderSlot(positionSlot, roster, chart, container, side) {
    const playerId = chart[positionSlot]; // Get player ID assigned to this slot
    const player = roster.find(p => p.id === playerId); // Find the player object
    // Calculate overall based on the base position (e.g., 'QB' from 'QB1')
    const basePosition = positionSlot.replace(/\d/g, '');
    const overall = player ? calculateOverall(player, basePosition) : '---';
    // Add tag for temporary players
    const typeTag = player?.status?.type === 'temporary' ? '<span class="status-tag temporary" title="Temporary Friend">[T]</span>' : '';

    const slotEl = document.createElement('div');
    // Base classes, plus conditional draggable attribute
    slotEl.className = 'depth-chart-slot bg-gray-200 p-2 rounded flex items-center justify-between';
    slotEl.dataset.positionSlot = positionSlot; // Store slot name for drop target identification
    slotEl.dataset.side = side; // Store side for drop validation

    // Make slot draggable *only if* it contains a player
    if (player) {
        slotEl.draggable = true;
        slotEl.dataset.playerId = player.id; // Store player ID for drag source identification
        slotEl.setAttribute('title', `Drag ${player.name}`); // Tooltip for draggable item
    } else {
        slotEl.setAttribute('title', `Drop player here for ${positionSlot}`); // Tooltip for empty slot
    }

    // Populate slot content with player details or 'Empty' - Use safe navigation
    slotEl.innerHTML = `
        <span class="font-bold w-1/4">${positionSlot}</span>
        <div class="player-details-grid w-3/4">
            <span>${typeTag} ${player ? player.name : 'Empty'}</span>
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
 * Renders the list of available players (not starting on the current side) as draggable items.
 * @param {object[]} players - Array of available player objects.
 * @param {HTMLElement} container - The parent element to append the list items to.
 * @param {string} side - 'offense' or 'defense'.
 */
function renderAvailablePlayerList(players, container, side) {
    if (!container) return;
    container.innerHTML = ''; // Clear previous list
    if (players.length === 0) {
        container.innerHTML = '<p class="text-xs text-gray-500 p-2">No players available (all starting). Drag starters here to make them available.</p>';
        return;
    }
    players.forEach(player => {
        // Add tag for temporary players
        const typeTag = player.status?.type === 'temporary' ? '<span class="status-tag temporary" title="Temporary Friend">[T]</span> ' : '';
        const playerEl = document.createElement('div');
        playerEl.className = 'draggable-player';
        playerEl.draggable = true; // Make player name draggable
        playerEl.dataset.playerId = player.id; // Store player ID for drag source
        playerEl.dataset.side = side; // Store side for drag validation
        playerEl.innerHTML = `${typeTag}${player.name}`;
        playerEl.setAttribute('title', `Drag ${player.name} to a ${side} starting slot`);
        container.appendChild(playerEl);
    });
}


/**
 * Renders the 'Messages' tab content.
 * @param {object} gameState - The current game state object.
 */
function renderMessagesTab(gameState) {
    if (!elements.messagesList || !gameState?.messages) {
        if(elements.messagesList) elements.messagesList.innerHTML = '<p class="text-gray-500">Messages not available.</p>';
        return;
    }
    const messages = gameState.messages;

    if (messages.length === 0) {
        elements.messagesList.innerHTML = `<p class="text-gray-500">No messages yet.</p>`;
        return;
    }

    // Build list items, applying styling for read/unread status
    // Make items focusable and use button role for accessibility
    elements.messagesList.innerHTML = messages.map(msg => `
        <div class="message-item ${msg.isRead ? 'bg-gray-100 text-gray-600' : 'bg-amber-100 font-semibold border-l-4 border-amber-400'}" data-message-id="${msg.id}" role="button" tabindex="0" aria-label="View message: ${msg.subject}">
            ${msg.subject}
        </div>
    `).join('');

    updateMessagesNotification(messages); // Ensure notification dot is correct
}

/**
 * Updates the visibility of the unread messages notification dot.
 * Can also mark all messages as read.
 * @param {object[]} messages - Array of message objects.
 * @param {boolean} [markAllAsRead=false] - If true, modify the messages array to mark all as read.
 */
function updateMessagesNotification(messages, markAllAsRead = false) {
    if (!elements.messagesNotificationDot || !messages) return;

    if (markAllAsRead) {
        messages.forEach(msg => { msg.isRead = true; }); // Modify the array directly
    }
    // Check if *any* message is unread
    const hasUnread = messages.some(m => !m.isRead);
    // Toggle visibility based on unread status
    elements.messagesNotificationDot.classList.toggle('hidden', !hasUnread);
}


/**
 * Renders the 'Schedule' tab content, showing past results and upcoming games.
 * @param {object} gameState - The current game state object.
 */
function renderScheduleTab(gameState) {
    if (!elements.scheduleList || !gameState?.schedule || !gameState.teams || !gameState.playerTeam) {
        if(elements.scheduleList) elements.scheduleList.innerHTML = '<p class="text-gray-500">Schedule data not available.</p>';
        return;
    }

    let html = '';
    const gamesPerWeek = gameState.teams.length / 2;
    const numWeeks = 9; // Assuming a 9-week season

    for (let i = 0; i < numWeeks; i++) {
        const weekStartIndex = i * gamesPerWeek;
        const weekEndIndex = weekStartIndex + gamesPerWeek;
        // Slice schedule safely, handling potential short arrays
        const weekGames = gameState.schedule.slice(weekStartIndex, weekEndIndex);
        const isPastWeek = i < gameState.currentWeek;
        const isCurrentWeek = i === gameState.currentWeek;

        // Apply visual distinction for current week
        let weekHtml = `<div class="p-4 rounded mb-4 ${isCurrentWeek ? 'bg-amber-100 border-2 border-amber-500' : 'bg-gray-100'}">
                            <h4 class="font-bold text-lg mb-2">Week ${i + 1}</h4>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">`;

        if (weekGames.length > 0) {
            weekGames.forEach(g => {
                let content;
                // Find game result only if it's a past week
                const result = isPastWeek ? (gameState.gameResults || []).find(r => r && r.homeTeam.id === g.home.id && r.awayTeam.id === g.away.id) : null; // Added null check for r
                let resultClass = ''; // For styling W/L for player's team

                if (result) {
                    // Display scores and bold the winner
                    content = `
                        <span class="${result.awayScore > result.homeScore ? 'font-bold' : ''}">${g.away.name} ${result.awayScore}</span>
                        <span class="mx-2 font-bold text-gray-400">@</span>
                        <span class="${result.homeScore > result.awayScore ? 'font-bold' : ''}">${g.home.name} ${result.homeScore}</span>
                    `;
                    // Check if player's team was involved and apply win/loss class
                    if (result.homeTeam.id === gameState.playerTeam.id) {
                        resultClass = result.homeScore > result.awayScore ? 'player-win' : (result.homeScore < result.awayScore ? 'player-loss' : '');
                    } else if (result.awayTeam.id === gameState.playerTeam.id) {
                        resultClass = result.awayScore > result.homeScore ? 'player-win' : (result.awayScore < result.homeScore ? 'player-loss' : '');
                    }
                } else {
                    // Display future matchup
                    content = `<span>${g.away.name}</span><span class="mx-2 font-bold text-gray-400">@</span><span>${g.home.name}</span>`;
                }
                // Add game div to week's HTML
                weekHtml += `<div class="bg-white p-2 rounded shadow-sm flex justify-center items-center ${resultClass}">${content}</div>`;
            });
        } else {
            weekHtml += '<p class="text-gray-500 md:col-span-2">No games scheduled for this week.</p>';
        }
        weekHtml += `</div></div>`;
        html += weekHtml; // Append week's HTML to overall output
    }
    elements.scheduleList.innerHTML = html; // Update DOM
}

/**
 * Renders the 'Standings' tab content, grouped by division.
 * @param {object} gameState - The current game state object.
 */
function renderStandingsTab(gameState) {
    if (!elements.standingsContainer || !gameState?.divisions || !gameState.teams || !gameState.playerTeam) {
        if(elements.standingsContainer) elements.standingsContainer.innerHTML = '<p class="text-gray-500">Standings data not available.</p>';
        return;
    }

    elements.standingsContainer.innerHTML = ''; // Clear previous standings

    // Iterate through each defined division
    for (const divName in gameState.divisions) {
        const divisionTeamIds = new Set(gameState.divisions[divName]); // Use Set for quick lookup
        const divEl = document.createElement('div');
        divEl.className = 'mb-6'; // Add margin between divisions

        // Build table header
        let tableHtml = `<h4 class="text-xl font-bold mb-2">${divName} Division</h4><table class="min-w-full bg-white text-sm"><thead class="bg-gray-800 text-white"><tr><th scope="col" class="text-left py-2 px-3">Team</th><th scope="col" class="py-2 px-3">Wins</th><th scope="col" class="py-2 px-3">Losses</th></tr></thead><tbody class="divide-y">`;

        // Filter teams belonging to this division and sort by wins (desc)
        const divTeams = gameState.teams
            .filter(t => divisionTeamIds.has(t.id))
            .sort((a, b) => b.wins - a.wins || a.losses - b.losses); // Sort by wins, then losses asc

        // Add row for each team, highlighting player's team
        if (divTeams.length > 0) {
            divTeams.forEach(t => {
                tableHtml += `<tr class="${t.id === gameState.playerTeam.id ? 'bg-amber-100 font-semibold' : ''}">
                                <th scope="row" class="py-2 px-3 text-left">${t.name}</th>
                                <td class="text-center py-2 px-3">${t.wins}</td>
                                <td class="text-center py-2 px-3">${t.losses}</td>
                              </tr>`;
            });
        } else {
            tableHtml += '<tr><td colspan="3" class="text-center p-4 text-gray-500">No teams found in this division.</td></tr>';
        }

        divEl.innerHTML = tableHtml + `</tbody></table>`;
        elements.standingsContainer.appendChild(divEl);
    }
}

/**
 * Renders the 'Player Stats' tab content, with filtering and sorting.
 * @param {object} gameState - The current game state object.
 */
function renderPlayerStatsTab(gameState) {
    if (!elements.playerStatsContainer || !gameState?.players) {
        if(elements.playerStatsContainer) elements.playerStatsContainer.innerHTML = '<p class="text-gray-500">Player stats data not available.</p>';
        return;
    }

    const teamIdFilter = elements.statsFilterTeam?.value || '';
    const sortStat = elements.statsSort?.value || 'touchdowns'; // Default sort

    // Filter players by team if a filter is selected
    let playersToShow = teamIdFilter
        ? gameState.players.filter(p => p.teamId === teamIdFilter)
        : [...gameState.players]; // Use all players if no filter

    // Sort players based on the selected season statistic (descending)
    playersToShow.sort((a, b) => (b.seasonStats?.[sortStat] || 0) - (a.seasonStats?.[sortStat] || 0));

    // Define stats columns to display
    const stats = ['passYards', 'rushYards', 'recYards', 'receptions', 'touchdowns', 'tackles', 'sacks', 'interceptions'];
    // Format stat names for headers (e.g., 'passYards' -> 'PASS YARDS')
    const statHeaders = stats.map(s => s.replace(/([A-Z])/g, ' $1').toUpperCase());

    // Build table HTML
    let tableHtml = `<div class="overflow-x-auto"><table class="min-w-full bg-white text-sm"><thead class="bg-gray-800 text-white sticky top-0 z-10"><tr><th scope="col" class="text-left py-2 px-3 sticky left-0 bg-gray-800 z-20">Name</th>${statHeaders.map(h => `<th scope="col" class="py-2 px-3">${h}</th>`).join('')}</tr></thead><tbody class="divide-y">`;

    if (playersToShow.length === 0) {
        tableHtml += '<tr><td colspan="9" class="text-center p-4 text-gray-500">No players found matching criteria.</td></tr>';
    } else {
        // Add row for each player
        playersToShow.forEach(p => {
            // Highlight rows belonging to the player's team
            const playerTeamClass = p.teamId === gameState.playerTeam?.id ? 'bg-amber-50' : '';
            // Generate stat cells, defaulting to 0 if stat is missing
            const statCells = stats.map(s => `<td class="text-center py-2 px-3">${p.seasonStats?.[s] || 0}</td>`).join('');
            // Use row header for player name
            tableHtml += `<tr class="${playerTeamClass}"><th scope="row" class="py-2 px-3 font-semibold sticky left-0 bg-white z-10 text-left">${p.name}</th>${statCells}</tr>`;
        });
    }

    elements.playerStatsContainer.innerHTML = tableHtml + `</tbody></table></div>`;
}

/**
 * Renders the 'Hall of Fame' tab content.
 * @param {object} gameState - The current game state object.
 */
function renderHallOfFameTab(gameState) {
    if (!elements.hallOfFameList || !gameState?.hallOfFame) {
         if(elements.hallOfFameList) elements.hallOfFameList.innerHTML = '<p class="text-gray-500">Hall of Fame data not available.</p>';
        return;
    }
    const inductees = gameState.hallOfFame;

    if (inductees.length === 0) {
        elements.hallOfFameList.innerHTML = '<p class="text-gray-500">The Hall of Fame is currently empty. Legends will be made!</p>';
        return;
    }

    // Build cards for each inductee
    elements.hallOfFameList.innerHTML = '<div class="space-y-4">' + inductees.map(p => `
        <article class="bg-gray-100 p-4 rounded-lg shadow" aria-labelledby="hof-${p.id}">
            <h4 id="hof-${p.id}" class="font-bold text-lg text-amber-600">${p.name}</h4>
            <p class="text-sm text-gray-600">Seasons Played: ${p.careerStats?.seasonsPlayed || 'N/A'}</p>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2 text-sm">
                <span>TDs: <strong>${p.careerStats?.touchdowns || 0}</strong></span>
                <span>Pass Yds: <strong>${p.careerStats?.passYards || 0}</strong></span>
                <span>Rush Yds: <strong>${p.careerStats?.rushYards || 0}</strong></span>
                <span>Rec Yds: <strong>${p.careerStats?.recYards || 0}</strong></span>
                <span>Tackles: <strong>${p.careerStats?.tackles || 0}</strong></span>
                <span>Sacks: <strong>${p.careerStats?.sacks || 0}</strong></span>
                <span>INTs: <strong>${p.careerStats?.interceptions || 0}</strong></span>
            </div>
        </article>
    `).join('') + '</div>';
}

/**
 * Renders the Offseason summary screen.
 * @param {object} offseasonReport - Object containing results like retirements, development, etc.
 * @param {number} year - The upcoming season year.
 */
export function renderOffseasonScreen(offseasonReport, year) {
    if (!offseasonReport) {
        console.error("Cannot render offseason screen: Report data missing.");
        // Optionally display error on screen
        if(elements.playerDevelopmentContainer) elements.playerDevelopmentContainer.innerHTML = '<p class="text-red-500">Error loading offseason report.</p>';
        return;
    }
    // Use default empty arrays if parts of report are missing
    const { retiredPlayers = [], hofInductees = [], developmentResults = [], leavingPlayers = [] } = offseasonReport;

    if (elements.offseasonYear) elements.offseasonYear.textContent = year;

    // Display Player Development results for the player's team
    let devHtml = '';
    if (developmentResults.length > 0) {
        developmentResults.forEach(res => {
            const playerName = res.player?.name || 'Unknown Player';
            const playerAge = res.player?.age || '?';
            devHtml += `<div class="p-2 bg-gray-100 rounded text-sm mb-1"><p class="font-bold">${playerName} (Age ${playerAge})</p><div class="flex flex-wrap gap-x-2">`;
            if (res.improvements && res.improvements.length > 0) {
                res.improvements.forEach(imp => {
                    devHtml += `<span class="text-green-600">${imp.attr} +${imp.increase}</span>`;
                });
            } else {
                devHtml += `<span class="text-gray-500">No improvements</span>`;
            }
            devHtml += '</div></div>';
        });
    } else {
        devHtml = '<p class="text-gray-500">No player development updates for your team this offseason.</p>';
    }
    if (elements.playerDevelopmentContainer) elements.playerDevelopmentContainer.innerHTML = devHtml;

    // Helper function to render list items or 'None'
    const renderList = (element, items, formatFn) => {
        if (element) {
            element.innerHTML = items.length > 0 ? items.map(formatFn).join('') : '<li>None</li>';
        }
    };

    // Display Retirements/Graduations
    renderList(elements.retirementsList, retiredPlayers, p => `<li>${p.name} (Graduated)</li>`);

    // Display Other Leaving Players
    renderList(elements.leavingPlayersList, leavingPlayers, l => `<li>${l.player?.name || '?'} (${l.reason})</li>`); // Safe access

    // Display HOF Inductees
    renderList(elements.hofInducteesList, hofInductees, p => `<li>${p.name}</li>`);
}

/**
 * Sets up drag and drop event listeners for the depth chart interface.
 * @param {Function} onDrop - Callback function `(playerId, newPositionSlot, side)` executed when a valid drop occurs.
 */
export function setupDragAndDrop(onDrop) {
    const container = document.getElementById('dashboard-content');
    if (!container) {
         console.error("Cannot setup drag and drop: Dashboard content container not found.");
         return;
     }

    let draggedEl = null; // Reference to the element being dragged

    // --- Drag Start ---
    container.addEventListener('dragstart', e => {
        if (e.target.matches('.draggable-player, .depth-chart-slot[draggable="true"]')) {
            draggedEl = e.target;
            dragPlayerId = e.target.dataset.playerId;
            dragSide = e.target.closest('.depth-chart-sub-pane')?.id.includes('offense') ? 'offense' :
                       e.target.closest('.depth-chart-sub-pane')?.id.includes('defense') ? 'defense' :
                       e.target.closest('.roster-list')?.id.includes('offense') ? 'offense' :
                       e.target.closest('.roster-list')?.id.includes('defense') ? 'defense' : null;

            if (dragPlayerId && dragSide) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', dragPlayerId); // Necessary for Firefox
                setTimeout(() => draggedEl?.classList.add('dragging'), 0);
            } else {
                console.warn("Drag start ignored: Missing playerId or side context.");
                e.preventDefault();
            }
        } else {
            e.preventDefault();
        }
    });

    // --- Drag End ---
    container.addEventListener('dragend', e => {
        if (draggedEl) {
            draggedEl.classList.remove('dragging');
        }
        draggedEl = null;
        dragPlayerId = null;
        dragSide = null;
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });

    // --- Drag Over ---
    container.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const targetSlot = e.target.closest('.depth-chart-slot');
        // Clear previous drag-over highlights first
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        // Highlight ONLY if dropping onto a valid slot of the SAME side
        if (targetSlot && targetSlot.dataset.side === dragSide) {
            targetSlot.classList.add('drag-over');
        }
    });

    // --- Drag Leave ---
    container.addEventListener('dragleave', e => {
        const targetSlot = e.target.closest('.depth-chart-slot');
        if (targetSlot) {
            targetSlot.classList.remove('drag-over');
        }
        // Also remove if leaving the general container area while drag over was active
        if (!e.relatedTarget || !container.contains(e.relatedTarget)) {
             document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        }
    });

    // --- Drop ---
    container.addEventListener('drop', e => {
        e.preventDefault();
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        const dropSlot = e.target.closest('.depth-chart-slot');
        const dropSide = dropSlot?.dataset.side;

        if (dropSlot && dropSlot.dataset.positionSlot && dragPlayerId && dropSide === dragSide) {
            onDrop(dragPlayerId, dropSlot.dataset.positionSlot, dropSide);
        } else {
            console.log("Invalid drop target or side mismatch.");
        }
        // Cleanup happens in dragend
    });
}


/**
 * Sets up event listener for switching between offense/defense depth chart views using tabs.
 */
export function setupDepthChartTabs() {
    if (!elements.depthChartSubTabs) return;
    elements.depthChartSubTabs.addEventListener('click', e => {
        if (e.target.matches('.depth-chart-tab')) {
            const subTab = e.target.dataset.subTab;
            // Update active button style and aria-selected
            elements.depthChartSubTabs.querySelectorAll('.depth-chart-tab').forEach(t => {
                const isSelected = t === e.target;
                t.classList.toggle('active', isSelected);
                t.setAttribute('aria-selected', isSelected.toString());
            });
            // Toggle visibility of the offense and defense panes using aria-controls
            const offensePane = document.getElementById('depth-chart-offense-pane');
            const defensePane = document.getElementById('depth-chart-defense-pane');
            if (offensePane) offensePane.classList.toggle('hidden', subTab !== 'offense');
            if (defensePane) defensePane.classList.toggle('hidden', subTab !== 'defense');
        }
    });
}


// ===================================
// --- NEW Live Game Sim UI Logic ---
// ===================================

/** Helper to update field visualization */
function updateField(ballOnYard, possessionTeamName, homeTeamName) {
    if (!elements.fieldDisplay) return; // Guard against missing element

    const field = Array(12).fill(' . '); // 10 field sections + 2 endzones
    const ballMarker = !possessionTeamName ? ' ' : // No marker if no possession
                       possessionTeamName === homeTeamName ? 'H' : 'A';

    if (ballOnYard <= 0 && possessionTeamName) field[0] = `[${ballMarker}]`; // Own endzone
    else if (ballOnYard >= 100 && possessionTeamName) field[11] = `[${ballMarker}]`; // Opponent's endzone
    else if (possessionTeamName) { // Only place marker if there's possession
        const fieldIndex = Math.floor(ballOnYard / 10) + 1; // Index 1-10 for field
        const safeIndex = Math.max(1, Math.min(10, fieldIndex)); // Clamp index
        field[safeIndex] = ` ${ballMarker} `;
    }
    // Display field visualization using preformatted text
    elements.fieldDisplay.textContent = `AWAY [${field.slice(0, 6).join('')}] [${field.slice(6, 12).join('')}] HOME`;
}

/**
 * Starts the simplified live game simulation using setInterval.
 * @param {object} gameResult - The result object containing gameLog array, teams, and scores.
 * @param {Function} onComplete - Callback function when simulation ends.
 */
export function startLiveGameSim(gameResult, onComplete) {
    const ticker = elements.simPlayLog;
    const scoreboard = elements.simScoreboard;

    if (!ticker || !scoreboard) {
        console.error("Live sim UI elements (simPlayLog or simScoreboard) not found!");
        if (onComplete) onComplete();
        return;
    }
    if (!gameResult || !gameResult.gameLog || gameResult.gameLog.length === 0 || !gameResult.homeTeam || !gameResult.awayTeam) {
        console.warn("startLiveGameSim called with invalid or empty gameResult.");
        ticker.innerHTML = '<p class="text-gray-400">No game events to display.</p>';
        if (onComplete) onComplete();
        return;
    }

    if (liveGameInterval) clearInterval(liveGameInterval); // Clear any existing interval
    ticker.innerHTML = ''; // Clear previous game events
    liveGameCurrentIndex = 0;
    liveGameLog = gameResult.gameLog;
    liveGameCallback = onComplete;
    let currentHomeScore = 0; // Track score dynamically during playback
    let currentAwayScore = 0;
    let ballOn = 20; // Track ball position dynamically
    let down = 1;
    let toGo = 10;
    let possessionTeamName = null; // Track possession dynamically
    let currentDriveText = 'Pre-Game';

    // --- Initialize UI state ---
     if (elements.simAwayScore) elements.simAwayScore.textContent = '0';
     if (elements.simHomeScore) elements.simHomeScore.textContent = '0';
     if (elements.simGameDrive) elements.simGameDrive.textContent = currentDriveText;
     if (elements.simGameDown) elements.simGameDown.textContent = '';
     if (elements.simPossession) elements.simPossession.textContent = '';
     updateField(ballOn, null, gameResult.homeTeam.name); // Show initial empty field
    // --- End Initial UI ---


    // --- Function to process the next log entry ---
    function nextEntry() {
        if (liveGameCurrentIndex >= liveGameLog.length) {
            clearInterval(liveGameInterval);
            liveGameInterval = null;
            // Ensure Final Score is Correct
            if (elements.simAwayScore) elements.simAwayScore.textContent = gameResult.awayScore;
            if (elements.simHomeScore) elements.simHomeScore.textContent = gameResult.homeScore;
            if (elements.simGameDown) elements.simGameDown.textContent = "FINAL";
            if (elements.simPossession) elements.simPossession.textContent = "";
            if (liveGameCallback) liveGameCallback();
            liveGameCallback = null;
            return;
        }

        const play = liveGameLog[liveGameCurrentIndex];
        const p = document.createElement('p');
        // Apply styling (same as before)
        if (play.startsWith('-- Drive') || play.startsWith('====')) { /* ... */ p.className = 'font-bold text-amber-400 mt-2'; if (play.startsWith('==== FINAL')) p.classList.add('text-lg');}
        else if (play.startsWith('TOUCHDOWN') || play.includes('GOOD!')) { /* ... */ p.className = 'font-semibold text-green-400'; }
        else if (play.startsWith('Turnover') || play.startsWith('INTERCEPTION') || play.startsWith('FUMBLE') || play.includes('FAILED!')) { /* ... */ p.className = 'font-semibold text-red-400';}
        else if (play.startsWith('SACK')) { /* ... */ p.className = 'text-orange-400';}
        else if (play.startsWith('INJURY')) { /* ... */ p.className = 'text-purple-400 italic';}

        p.textContent = play;
        ticker.appendChild(p);
        ticker.scrollTop = ticker.scrollHeight;

        // --- Update Scoreboard/Field based on log ---
         if (play.startsWith('-- Drive')) {
             ballOn = 20; down = 1; toGo = 10;
             const driveMatch = play.match(/(Drive \d+ \(H\d+\))/);
             possessionTeamName = play.includes(gameResult.homeTeam.name) ? gameResult.homeTeam.name : gameResult.awayTeam.name;
             if(elements.simGameDrive && driveMatch) currentDriveText = driveMatch[0];
         } else if (play.startsWith('First down!')) {
             down = 1; toGo = 10;
         } else if (play.match(/for (-?\d+) yards?/)) {
             const yards = parseInt(play.match(/for (-?\d+) yards?/)[1], 10);
             ballOn += yards; toGo -= yards; ballOn = Math.max(0,Math.min(100, ballOn));
             if (toGo <= 0) { /* Handled by 'First down!' log */ } else { down++; }
         } else if (play.startsWith('INCOMPLETE')) {
             down++;
         } else if (play.startsWith('TOUCHDOWN')) {
             ballOn = 100; // Indicate TD position
         } else if (play.includes('conversion GOOD!')) {
             const points = play.startsWith('2') ? 2 : 1;
             if(possessionTeamName === gameResult.homeTeam.name) currentHomeScore += (6 + points);
             else currentAwayScore += (6 + points);
         } else if (play.includes('Conversion FAILED!')) {
             const points = 6;
             if(possessionTeamName === gameResult.homeTeam.name) currentHomeScore += points;
             else currentAwayScore += points;
         } else if (play.startsWith('Turnover') || play.startsWith('INTERCEPTION') || play.startsWith('FUMBLE')) {
             down = 1; toGo = 10; // Reset for next possession implicitly
             possessionTeamName = (possessionTeamName === gameResult.homeTeam.name) ? gameResult.awayTeam.name : gameResult.homeTeam.name; // Flip possession
         }
         if (down > 4) { // Turnover on downs implied if down goes > 4
            down = 1; toGo = 10;
            possessionTeamName = (possessionTeamName === gameResult.homeTeam.name) ? gameResult.awayTeam.name : gameResult.homeTeam.name;
         }

        // Update UI elements based on parsed state
         if (elements.simAwayScore) elements.simAwayScore.textContent = currentAwayScore;
         if (elements.simHomeScore) elements.simHomeScore.textContent = currentHomeScore;
         if (elements.simGameDrive) elements.simGameDrive.textContent = currentDriveText;
         if (elements.simGameDown) elements.simGameDown.textContent = (down <= 4) ? `${down} & ${toGo <= 0 ? 'Goal' : toGo}` : 'Change of Possession';
         if (elements.simPossession) elements.simPossession.textContent = possessionTeamName ? `${possessionTeamName} Ball` : '';
         updateField(ballOn, possessionTeamName, gameResult.homeTeam.name);
        // --- End Scoreboard/Field Update ---

        liveGameCurrentIndex++;
    }
    // --- End nextEntry function ---

    // Start the interval
    liveGameInterval = setInterval(nextEntry, liveGameSpeed);
}

/**
 * Stops the live game simulation interval, clears the ticker, and triggers the onComplete callback.
 * @param {object} gameResult - Pass the final gameResult to ensure final score is shown.
 */
export function skipLiveGameSim(gameResult) { // Added gameResult parameter
    if (liveGameInterval) {
        clearInterval(liveGameInterval);
        liveGameInterval = null;
    }
    const ticker = elements.simPlayLog;
    if (ticker) {
        const p = document.createElement('p');
        p.className = 'italic text-gray-400 mt-2';
        p.textContent = '--- Simulation skipped ---';
        ticker.appendChild(p);
        ticker.scrollTop = ticker.scrollHeight;
    }
     // --- Ensure Final Score on Skip ---
     if (gameResult) {
         if (elements.simAwayScore) elements.simAwayScore.textContent = gameResult.awayScore;
         if (elements.simHomeScore) elements.simHomeScore.textContent = gameResult.homeScore;
         if (elements.simGameDown) elements.simGameDown.textContent = "FINAL";
         if (elements.simPossession) elements.simPossession.textContent = "";
     }
     // ---
     if (liveGameCallback) {
          const cb = liveGameCallback;
          liveGameCallback = null;
          cb();
     }
}

/**
 * Changes the speed of the live game simulation interval.
 * @param {number} speed - New speed in milliseconds.
 */
export function setSimSpeed(speed) {
    liveGameSpeed = speed;
    // Update button styles
    elements.simSpeedBtns?.forEach(btn => btn.classList.remove('active', 'bg-blue-500', 'hover:bg-blue-600'));
    elements.simSpeedBtns?.forEach(btn => btn.classList.add('bg-gray-500', 'hover:bg-gray-600'));

    let activeButtonId;
    if (speed === 1000) activeButtonId = 'sim-speed-play';
    else if (speed === 400) activeButtonId = 'sim-speed-fast';
    else if (speed === 100) activeButtonId = 'sim-speed-faster';

    const activeButton = document.getElementById(activeButtonId);
    if (activeButton) {
        activeButton.classList.remove('bg-gray-500', 'hover:bg-gray-600');
        activeButton.classList.add('active', 'bg-blue-500', 'hover:bg-blue-600');
    }

    // If an interval is currently running, clear and restart it with the new speed
    if (liveGameInterval) {
        clearInterval(liveGameInterval);
        // Need access to the `nextEntry` function or recreate it.
        // Recreating it here for simplicity, reusing the outer scope variables.
        function nextEntryForRestart() { // Recreate function locally for restart
             if (liveGameCurrentIndex >= liveGameLog.length) {
                 clearInterval(liveGameInterval);
                 liveGameInterval = null;
                 // Ensure final score shown on natural completion after speed change
                // Try to get the *actual* final result for accuracy
                const finalGameResult = game?.gameResults?.[game.gameResults.length-1]; // Access global game state cautiously
                if(finalGameResult) {
                    if (elements.simAwayScore) elements.simAwayScore.textContent = finalGameResult.awayScore;
                    if (elements.simHomeScore) elements.simHomeScore.textContent = finalGameResult.homeScore;
                    if (elements.simGameDown) elements.simGameDown.textContent = "FINAL";
                    if (elements.simPossession) elements.simPossession.textContent = "";
                } else {
                     console.warn("Could not retrieve final game result to update scoreboard after speed change completion.");
                }
                 if (liveGameCallback) liveGameCallback();
                 liveGameCallback = null;
                 return;
             }
             const play = liveGameLog[liveGameCurrentIndex];
             const p = document.createElement('p');
             // Styling logic... (Ensuring consistency with the main nextEntry)
             if (play.startsWith('-- Drive') || play.startsWith('====')) { p.className = 'font-bold text-amber-400 mt-2'; if (play.startsWith('==== FINAL')) p.classList.add('text-lg'); }
             else if (play.startsWith('TOUCHDOWN') || play.includes('GOOD!')) { p.className = 'font-semibold text-green-400'; }
             else if (play.startsWith('Turnover') || play.startsWith('INTERCEPTION') || play.startsWith('FUMBLE') || play.includes('FAILED!')) { p.className = 'font-semibold text-red-400'; }
             else if (play.startsWith('SACK')) { p.className = 'text-orange-400'; }
             else if (play.startsWith('INJURY')) { p.className = 'text-purple-400 italic'; }
             p.textContent = play;
             elements.simPlayLog.appendChild(p);
             elements.simPlayLog.scrollTop = elements.simPlayLog.scrollHeight;
              // Add simplified scoreboard/field update logic here if desired during restart
             liveGameCurrentIndex++;
        }
        liveGameInterval = setInterval(nextEntryForRestart, liveGameSpeed); // Restart with new speed
    }
}

