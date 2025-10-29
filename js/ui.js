import {
    calculateOverall,
    positionOverallWeights,
    getRelationshipLevel, // <-- Added
    getScoutedPlayerInfo // <-- Added
} from './game.js';
import {
    offenseFormations,
    defenseFormations,
    relationshipLevels // <-- Added
} from './data.js';

// --- Visualization Constants (Must match game.js) ---
const FIELD_LENGTH = 120;
const FIELD_WIDTH = 53.3;
const CENTER_X = FIELD_WIDTH / 2;
const HASH_LEFT_X = 18.0;
const HASH_RIGHT_X = 35.3;

// --- Global UI State & Elements ---
let elements = {};
let selectedPlayerId = null; // Used for highlighting in draft pool
let dragPlayerId = null; // ID of player being dragged in depth chart
let dragSide = null; // 'offense' or 'defense' being dragged from/to
let debounceTimeout = null; // For debouncing input

// --- Live Game Sim State ---
let liveGameInterval = null; // Holds interval ID for stopping/starting
let liveGameSpeed = 1000; // Current sim speed in milliseconds
let liveGameCurrentIndex = 0; // Current index in the game log array
let liveGameLog = []; // Stores the log entries for the current sim
let liveGameCallback = null; // Function to call when sim completes or is skipped
let currentLiveGameResult = null; // Stores the full gameResult object for accurate final display

/**
 * Debounce function to limit rapid function calls (e.g., on input).
 * @param {Function} func - The function to debounce.
 * @param {number} delay - The debounce delay in milliseconds.
 */
function debounce(func, delay) {
    return function(...args) {
        clearTimeout(debounceTimeout); // Clear existing timeout
        debounceTimeout = setTimeout(() => {
            func.apply(this, args); // Call the original function after delay
        }, delay);
    };
}

/**
 * Grabs references to all necessary DOM elements and stores them in the 'elements' object.
 */
export function setupElements() {
    console.log("Running setupElements...");
    elements = {
        // --- Screens ---
        screens: {
            startScreen: document.getElementById('start-screen'),
            loadingScreen: document.getElementById('loading-screen'),
            teamCreationScreen: document.getElementById('team-creation-screen'),
            draftScreen: document.getElementById('draft-screen'),
            dashboardScreen: document.getElementById('dashboard-screen'),
            offseasonScreen: document.getElementById('offseason-screen'),
            gameSimScreen: document.getElementById('game-sim-screen'),
        },

        // --- Other Common UI Elements ---
        modal: document.getElementById('modal'),
        modalTitle: document.getElementById('modal-title'),
        modalBody: document.getElementById('modal-body'),
        loadingProgress: document.getElementById('loading-progress'),
        teamNameSuggestions: document.getElementById('team-name-suggestions'),
        customTeamName: document.getElementById('custom-team-name'),
        confirmTeamBtn: document.getElementById('confirm-team-btn'),

        // --- Draft Screen Elements ---
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

        // --- Dashboard Elements ---
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

        // --- Offseason Screen Elements ---
        offseasonYear: document.getElementById('offseason-year'),
        playerDevelopmentContainer: document.getElementById('player-development-container'),
        retirementsList: document.getElementById('retirements-list'),
        hofInducteesList: document.getElementById('hof-inductees-list'),
        leavingPlayersList: document.getElementById('leaving-players-list'),
        goToNextDraftBtn: document.getElementById('go-to-next-draft-btn'),

        // --- Live Game Sim Elements ---
        simScoreboard: document.getElementById('sim-scoreboard'),
        simAwayTeam: document.getElementById('sim-away-team'),
        simAwayScore: document.getElementById('sim-away-score'),
        simHomeTeam: document.getElementById('sim-home-team'),
        simHomeScore: document.getElementById('sim-home-score'),
        simGameDrive: document.getElementById('sim-game-drive'),
        simGameDown: document.getElementById('sim-game-down'),
        simPossession: document.getElementById('sim-possession'),
        fieldCanvas: document.getElementById('field-canvas'),
        fieldCanvasCtx: document.getElementById('field-canvas')?.getContext('2d'),
        simPlayLog: document.getElementById('sim-play-log'),
        simSpeedBtns: document.querySelectorAll('.sim-speed-btn'),
        simSkipBtn: document.getElementById('sim-skip-btn'),
        simLiveStats: document.getElementById('sim-live-stats'),
        simStatsAway: document.getElementById('sim-stats-away'),
        simStatsHome: document.getElementById('sim-stats-home')
    };

    // Log checks for missing elements
    console.log("Screens registered explicitly:", Object.keys(elements.screens).filter(key => elements.screens[key]));
    Object.keys(elements.screens).forEach(key => {
        if (!elements.screens[key]) console.error(`!!! Screen element ID "${key}" NOT FOUND.`);
    });

    // Populate draft sort options
    if (elements.draftSort) {
        const sortOptions = `
            <option value="default">Potential (Default)</option>
            <option value="age-asc">Age (Youngest)</option>
            <option value="age-desc">Age (Oldest)</option>
            <option value="speed-desc">Speed (Fastest)</option>
            <option value="strength-desc">Strength (Strongest)</option>
            <option value="agility-desc">Agility (Most Agile)</option>
            <option value="potential-desc">Potential (Highest)</option>
        `;
        elements.draftSort.innerHTML = sortOptions;
    }
    console.log("UI Elements setup check complete.");
}

/**
 * Shows a specific screen div and hides all others.
 */
export function showScreen(screenId) {
    if (!elements || !elements.screens) {
        console.error("Screen elements object not initialized.");
        return;
    }
    console.log(`showScreen called for: ${screenId}.`);

    if (!elements.screens[screenId]) {
        console.warn(`Screen element "${screenId}" not found in initial setup. Attempting direct lookup.`);
        const element = document.getElementById(screenId);
        if (element) { elements.screens[screenId] = element; }
        else { console.error(`CRITICAL: Screen element ID "${screenId}" still not found.`); return; }
    }

    Object.values(elements.screens).forEach(screenElement => {
        if (screenElement && screenElement.classList) {
            screenElement.classList.add('hidden');
        }
    });

    const targetScreen = elements.screens[screenId];
    if (targetScreen && targetScreen.classList) {
        targetScreen.classList.remove('hidden');
    } else {
        console.error(`Attempted to show screen "${screenId}" but element reference invalid.`);
    }
}

/**
 * Displays the universal modal.
 */
export function showModal(title, bodyHtml, onConfirm = null, confirmText = 'Confirm', onCancel = null, cancelText = 'Close') {
    if (!elements.modal || !elements.modalTitle || !elements.modalBody) {
        console.error("Modal elements not found."); return;
    }

    elements.modalTitle.textContent = title;
    elements.modalBody.innerHTML = bodyHtml;

    const modalContent = elements.modal.querySelector('#modal-content');
    let actionsDiv = modalContent?.querySelector('#modal-actions');
    if (actionsDiv) actionsDiv.remove();

    actionsDiv = document.createElement('div');
    actionsDiv.id = 'modal-actions';
    actionsDiv.className = 'mt-6 text-right space-x-2';

    // --- FIX: Added the missing createButton helper function ---
    const createButton = (text, classes, onClick) => {
        const button = document.createElement('button');
        button.textContent = text;
        button.className = `btn ${classes}`;
        button.onclick = onClick;
        return button;
     };
    // --- END FIX ---

    // Cancel/Close button
    const closeAction = () => { if (onCancel) onCancel(); hideModal(); };
    actionsDiv.appendChild(createButton(cancelText, 'bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-6 rounded-lg', closeAction));

    // Confirm button
    if (onConfirm && typeof onConfirm === 'function') {
        const confirmAction = () => { onConfirm(); hideModal(); };
        actionsDiv.appendChild(createButton(confirmText, 'bg-amber-500 hover:bg-amber-600 text-white font-bold py-2 px-6 rounded-lg', confirmAction));
    }

    modalContent?.appendChild(actionsDiv);
    elements.modal.classList.remove('hidden');
}

/** Hides the universal modal. */
export function hideModal() {
    elements.modal?.classList.add('hidden');
}

/** Updates the loading progress bar. */
export function updateLoadingProgress(progress) {
    if (elements.loadingProgress) {
        const validProgress = Math.max(0, Math.min(1, progress));
        elements.loadingProgress.style.width = `${validProgress * 100}%`;
        elements.loadingProgress.parentElement?.setAttribute('aria-valuenow', Math.round(validProgress * 100));
    }
}

/** Renders suggested team names. */
export function renderTeamNameSuggestions(names, onSelect) {
    if (!elements.teamNameSuggestions) return;
    elements.teamNameSuggestions.innerHTML = '';
    names.forEach(name => {
        const button = document.createElement('button');
        button.className = 'bg-gray-200 hover:bg-amber-500 hover:text-white text-gray-700 font-semibold py-2 px-4 rounded-lg transition';
        button.textContent = name;
        button.type = 'button';
        button.onclick = () => onSelect(name);
        elements.teamNameSuggestions.appendChild(button);
    });
}

/**
 * Renders the main draft screen UI.
 */
export function renderDraftScreen(gameState, onPlayerSelect, currentSelectedId) {
    if (!gameState || !gameState.teams || !gameState.players || !gameState.draftOrder || !gameState.playerTeam) {
        console.error("renderDraftScreen called without valid gameState.");
        if(elements.draftHeader) elements.draftHeader.innerHTML = `<h2 class="text-3xl font-bold text-red-500">Draft Error: Invalid Game State</h2>`;
        return;
    }
    const { year, draftOrder, currentPick, playerTeam, players, teams } = gameState;
    const ROSTER_LIMIT = 10;

    // Check draft end conditions
    const pickLimitReached = currentPick >= draftOrder.length;
    const undraftedPlayersCount = players.filter(p => p && !p.teamId).length;
    const noPlayersLeft = undraftedPlayersCount === 0;
    const allNeedsMetOrFull = teams.every(t => {
        if (!t || !t.roster) return true;
        const needs = t.draftNeeds || 0;
        const picksMade = draftOrder.slice(0, currentPick).filter(teamInOrder => teamInOrder?.id === t.id).length;
        return (t.roster.length >= ROSTER_LIMIT) || picksMade >= needs;
    });

    if (pickLimitReached || noPlayersLeft || allNeedsMetOrFull) {
        if(elements.draftHeader) elements.draftHeader.innerHTML = `<h2 class="text-3xl font-bold">Season ${year} Draft Complete</h2><p>All picks made, pool empty, or rosters/needs filled.</p>`;
        if(elements.draftPlayerBtn) { elements.draftPlayerBtn.disabled = true; elements.draftPlayerBtn.textContent = 'Draft Complete'; }
        renderSelectedPlayerCard(null, gameState);
        updateSelectedPlayerRow(null);
        if (elements.draftPoolTbody) elements.draftPoolTbody.innerHTML = `<tr><td colspan="15" class="p-4 text-center text-gray-500">Draft Complete.</td></tr>`;
        return;
    }

    const pickingTeam = draftOrder[currentPick];
    if (!pickingTeam) {
        console.error(`Draft Error: No valid team found at current pick index (${currentPick}).`);
        if(elements.draftHeader) elements.draftHeader.innerHTML = `<h2 class="text-3xl font-bold text-red-500">Draft Error Occurred</h2>`;
        return;
    }

    const playerCanPick = pickingTeam.id === playerTeam.id && (playerTeam.roster?.length || 0) < ROSTER_LIMIT;

    // Update header
    if (elements.draftYear) elements.draftYear.textContent = year;
    if (elements.draftPickNumber) elements.draftPickNumber.textContent = currentPick + 1;
    if (elements.draftPickingTeam) elements.draftPickingTeam.textContent = pickingTeam.name || 'Unknown Team';

    renderDraftPool(gameState, onPlayerSelect);
    renderPlayerRoster(gameState.playerTeam);

    if (elements.draftPlayerBtn) {
        elements.draftPlayerBtn.disabled = !playerCanPick || currentSelectedId === null;
        elements.draftPlayerBtn.textContent = playerCanPick ? 'Draft Player' : `Waiting for ${pickingTeam.name || 'AI'}...`;
    }
}

/**
 * Renders the draft pool table with scouted info.
 */
export function renderDraftPool(gameState, onPlayerSelect) {
    if (!elements.draftPoolTbody || !gameState || !gameState.players || !gameState.playerTeam?.roster) {
        console.error("Cannot render draft pool: Missing elements or invalid game state/roster.");
        if(elements.draftPoolTbody) elements.draftPoolTbody.innerHTML = `<tr><td colspan="15" class="p-4 text-center text-red-500">Error loading players.</td></tr>`;
        return;
    }

    const undraftedPlayers = gameState.players.filter(p => p && !p.teamId);
    const searchTerm = elements.draftSearch?.value.toLowerCase() || '';
    const posFilter = elements.draftFilterPos?.value || '';
    const sortMethod = elements.draftSort?.value || 'default';

    let filteredPlayers = undraftedPlayers.filter(p =>
        p.name.toLowerCase().includes(searchTerm) &&
        (!posFilter || p.favoriteOffensivePosition === posFilter || p.favoriteDefensivePosition === posFilter)
    );

    const potentialOrder = { 'A': 5, 'B': 4, 'C': 3, 'D': 2, 'F': 1 };
    switch (sortMethod) {
        case 'age-asc': filteredPlayers.sort((a, b) => (a?.age || 99) - (b?.age || 99)); break;
        case 'age-desc': filteredPlayers.sort((a, b) => (b?.age || 0) - (a?.age || 0)); break;
        case 'speed-desc': filteredPlayers.sort((a, b) => (b?.attributes?.physical?.speed || 0) - (a?.attributes?.physical?.speed || 0)); break;
        case 'strength-desc': filteredPlayers.sort((a, b) => (b?.attributes?.physical?.strength || 0) - (a?.attributes?.physical?.strength || 0)); break;
        case 'agility-desc': filteredPlayers.sort((a, b) => (b?.attributes?.physical?.agility || 0) - (a?.attributes?.physical?.agility || 0)); break;
        case 'potential-desc': filteredPlayers.sort((a, b) => (potentialOrder[b?.potential] || 0) - (potentialOrder[a?.potential] || 0)); break;
        default:
             filteredPlayers.sort((a, b) => (potentialOrder[b?.potential] || 0) - (potentialOrder[a?.potential] || 0)); // Default sort by potential
             break;
    }

    elements.draftPoolTbody.innerHTML = '';

    if (filteredPlayers.length === 0) {
        elements.draftPoolTbody.innerHTML = `<tr><td colspan="15" class="p-4 text-center text-gray-500">No players match filters.</td></tr>`;
        return;
    }

    filteredPlayers.forEach(player => {
        const maxLevel = gameState.playerTeam.roster.reduce(
             (max, rp) => Math.max(max, getRelationshipLevel(rp.id, player.id)),
             relationshipLevels.STRANGER.level
         );
        const scoutedPlayer = getScoutedPlayerInfo(player, maxLevel);
        if (!scoutedPlayer) return;

        const relationshipInfo = Object.values(relationshipLevels).find(rl => rl.level === maxLevel) || relationshipLevels.STRANGER;

        const row = document.createElement('tr');
        row.className = `cursor-pointer hover:bg-amber-100 draft-player-row ${scoutedPlayer.id === selectedPlayerId ? 'bg-amber-200' : ''}`;
        row.dataset.playerId = scoutedPlayer.id;

        row.innerHTML = `
            <td class="py-2 px-3 font-semibold">${scoutedPlayer.name ?? 'N/A'}</td>
            <td class="text-center py-2 px-3">${scoutedPlayer.age ?? '?'}</td>
            <td class="text-center py-2 px-3 font-medium">${scoutedPlayer.potential ?? '?'}</td>
            <td class="text-center py-2 px-3 ${relationshipInfo.color}" title="${relationshipInfo.name}">${relationshipInfo.name.substring(0, 4)}</td>
            <td class="text-center py-2 px-3">${scoutedPlayer.favoriteOffensivePosition || '-'}/${scoutedPlayer.favoriteDefensivePosition || '-'}</td>
            <td class="text-center py-2 px-3">${scoutedPlayer.attributes?.physical?.height ?? '?'}</td>
            <td class="text-center py-2 px-3">${scoutedPlayer.attributes?.physical?.weight ?? '?'}</td>
            <td class="text-center py-2 px-3">${scoutedPlayer.attributes?.physical?.speed ?? '?'}</td>
            <td class="text-center py-2 px-3">${scoutedPlayer.attributes?.physical?.strength ?? '?'}</td>
            <td class="text-center py-2 px-3">${scoutedPlayer.attributes?.physical?.agility ?? '?'}</td>
            <td class="text-center py-2 px-3">${scoutedPlayer.attributes?.technical?.throwingAccuracy ?? '?'}</td>
            <td class="text-center py-2 px-3">${scoutedPlayer.attributes?.technical?.catchingHands ?? '?'}</td>
            <td class="text-center py-2 px-3">${scoutedPlayer.attributes?.technical?.blocking ?? '?'}</td>
            <td class="text-center py-2 px-3">${scoutedPlayer.attributes?.technical?.tackling ?? '?'}</td>
            <td class="text-center py-2 px-3">${scoutedPlayer.attributes?.technical?.blockShedding ?? '?'}</td>
        `;

        row.onclick = () => onPlayerSelect(scoutedPlayer.id);
        elements.draftPoolTbody.appendChild(row);
    });
}

/** Debounced version of renderDraftPool */
export const debouncedRenderDraftPool = debounce(renderDraftPool, 300);

/** Highlights the selected player row in the draft pool. */
export function updateSelectedPlayerRow(newSelectedId) {
    selectedPlayerId = newSelectedId;
    document.querySelectorAll('.draft-player-row').forEach(row => {
        row.classList.toggle('bg-amber-200', row.dataset.playerId === newSelectedId);
    });
}

/** Renders the selected player card with scouted info. */
export function renderSelectedPlayerCard(player, gameState) {
    if (!elements.selectedPlayerCard) return;

    if (!player || !gameState || !gameState.playerTeam || !gameState.playerTeam.roster) {
        elements.selectedPlayerCard.innerHTML = `<p class="text-gray-500">Select a player to see their details</p>`;
        if (elements.draftPlayerBtn) elements.draftPlayerBtn.disabled = true;
        return;
    }

    const maxLevel = gameState.playerTeam.roster.reduce(
        (max, rp) => Math.max(max, getRelationshipLevel(rp.id, player.id)),
        relationshipLevels.STRANGER.level
    );
    const scoutedPlayer = getScoutedPlayerInfo(player, maxLevel);

    if (!scoutedPlayer) {
        elements.selectedPlayerCard.innerHTML = `<p class="text-red-500">Error scouting player details.</p>`;
        if (elements.draftPlayerBtn) elements.draftPlayerBtn.disabled = true;
        return;
    }

    const positions = Object.keys(positionOverallWeights);
    let overallsHtml = '<div class="mt-2 grid grid-cols-4 gap-2 text-center">';
    positions.forEach(pos => {
        let displayOverall = '?';
        let isScoutedRange = false;
        if (scoutedPlayer.attributes) {
             isScoutedRange = Object.keys(positionOverallWeights[pos]).some(attrKey => {
                 for (const cat in scoutedPlayer.attributes) {
                     if (typeof scoutedPlayer.attributes[cat]?.[attrKey] === 'string') return true;
                 } return false;
             });
        }
        if (!isScoutedRange) displayOverall = calculateOverall(player, pos);

        overallsHtml += `<div class="bg-gray-200 p-2 rounded"><p class="font-semibold text-xs">${pos} OVR</p><p class="font-bold text-xl">${displayOverall}</p></div>`;
    });
    overallsHtml += '</div>';

    elements.selectedPlayerCard.innerHTML = `
        <h4 class="font-bold text-lg">${scoutedPlayer.name ?? 'Unknown Player'}</h4>
        <p class="text-sm text-gray-600">
            Age: ${scoutedPlayer.age ?? '?'} | H: ${scoutedPlayer.attributes?.physical?.height ?? '?'} | W: ${scoutedPlayer.attributes?.physical?.weight ?? '?'} lbs
        </p>
        <p class="text-sm text-gray-600">
            Potential: <span class="font-semibold">${scoutedPlayer.potential ?? '?'}</span> |
            Relationship: <span class="font-semibold ${scoutedPlayer.relationshipColor || ''}">${scoutedPlayer.relationshipName ?? '?'}</span>
         </p>
        ${overallsHtml}`;

    const { draftOrder, currentPick, playerTeam } = gameState;
    const ROSTER_LIMIT = 10;
    if (draftOrder && currentPick >= 0 && currentPick < draftOrder.length && playerTeam && draftOrder[currentPick]) {
        const pickingTeam = draftOrder[currentPick];
        const playerCanPick = pickingTeam.id === playerTeam.id && (playerTeam.roster?.length || 0) < ROSTER_LIMIT;
        elements.draftPlayerBtn.disabled = !playerCanPick || !player;
    } else {
         if (elements.draftPlayerBtn) elements.draftPlayerBtn.disabled = true;
    }
}

/** Renders the player's current roster list in the draft panel. */
export function renderPlayerRoster(playerTeam) {
    if (!elements.rosterCount || !elements.draftRosterList || !playerTeam) {
        console.error("Cannot render player roster: Missing elements or playerTeam data.");
        return;
    }
    const roster = playerTeam.roster || [];
    const ROSTER_LIMIT = 10;
    elements.rosterCount.textContent = `${roster.length}/${ROSTER_LIMIT}`;
    elements.draftRosterList.innerHTML = '';

    if (roster.length === 0) {
        elements.draftRosterList.innerHTML = '<li class="p-2 text-center text-gray-500">No players drafted yet.</li>';
    } else {
        roster.forEach(player => {
            if (!player) return;
            const li = document.createElement('li');
            li.className = 'p-2';
            li.textContent = `${player.name} (${player.favoriteOffensivePosition || '-'}/${player.favoriteDefensivePosition || '-'})`;
            elements.draftRosterList.appendChild(li);
        });
    }
    renderRosterSummary(playerTeam);
}

/** Renders the average overall ratings for the player's current roster. */
function renderRosterSummary(playerTeam) {
    if (!elements.rosterSummary || !playerTeam) return;
    const roster = playerTeam.roster || [];
    if (roster.length === 0) {
         elements.rosterSummary.innerHTML = '<p class="text-xs text-gray-500">Your roster is empty.</p>';
         return;
    }

    let summaryHtml = '<h5 class="font-bold text-sm mb-1">Team Averages</h5><div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">';
    Object.keys(positionOverallWeights).forEach(pos => {
        const validPlayers = roster.filter(p => p && p.attributes);
        if (validPlayers.length === 0) {
            summaryHtml += `<div class="flex justify-between"><span class="font-semibold">${pos}:</span><span class="font-bold">N/A</span></div>`;
            return;
        }
        const totalOvr = validPlayers.reduce((sum, player) => sum + calculateOverall(player, pos), 0);
        const avgOvr = Math.round(totalOvr / validPlayers.length);
        summaryHtml += `<div class="flex justify-between"><span class="font-semibold">${pos}:</span><span class="font-bold">${avgOvr}</span></div>`;
    });
    summaryHtml += '</div>';
    elements.rosterSummary.innerHTML = summaryHtml;
}
/** Renders the main dashboard header and populates team filter. */
export function renderDashboard(gameState) {
    if (!gameState || !gameState.playerTeam || !gameState.teams) {
        console.error("renderDashboard: Invalid gameState provided.");
        if(elements.dashboardTeamName) elements.dashboardTeamName.textContent = "Error Loading";
        if(elements.dashboardRecord) elements.dashboardRecord.textContent = "";
        return;
    }
    const { playerTeam, year, currentWeek, messages, teams } = gameState;
    const WEEKS_IN_SEASON = 9; // Consider getting from game.js or config
    const currentW = (typeof currentWeek === 'number' && currentWeek < WEEKS_IN_SEASON) ? `Week ${currentWeek + 1}` : 'Offseason';

    if (elements.dashboardTeamName) elements.dashboardTeamName.textContent = playerTeam.name || 'Your Team';
    if (elements.dashboardRecord) elements.dashboardRecord.textContent = `Record: ${playerTeam.wins || 0} - ${playerTeam.losses || 0}`;
    if (elements.dashboardYear) elements.dashboardYear.textContent = year || '?';
    if (elements.dashboardWeek) elements.dashboardWeek.textContent = currentW;
    if (elements.advanceWeekBtn) elements.advanceWeekBtn.textContent = (typeof currentWeek === 'number' && currentWeek < WEEKS_IN_SEASON) ? 'Advance Week' : 'Go to Offseason';

    if (elements.statsFilterTeam && Array.isArray(teams)) {
        let teamOptions = '<option value="">All Teams</option>';
        teams
            .filter(t => t && t.id && t.name)
            .sort((a, b) => a.name.localeCompare(b.name))
            .forEach(t => teamOptions += `<option value="${t.id}">${t.name}</option>`);
        elements.statsFilterTeam.innerHTML = teamOptions;
    } else if (elements.statsFilterTeam) {
        elements.statsFilterTeam.innerHTML = '<option value="">Error loading teams</option>';
    }

    if (messages && Array.isArray(messages)) updateMessagesNotification(messages);

    const activeTabButton = elements.dashboardTabs?.querySelector('.tab-button.active');
    const activeTabId = activeTabButton ? activeTabButton.dataset.tab : 'my-team';
    switchTab(activeTabId, gameState);
}

/** Handles switching between dashboard tabs and rendering content. */
export function switchTab(tabId, gameState) {
    if (!elements.dashboardContent || !elements.dashboardTabs) { console.error("Dashboard elements missing."); return; }

    elements.dashboardContent.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
    elements.dashboardTabs.querySelectorAll('.tab-button').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });

    const contentPane = document.getElementById(`tab-content-${tabId}`);
    const tabButton = elements.dashboardTabs.querySelector(`[data-tab="${tabId}"]`);
    if (contentPane) contentPane.classList.remove('hidden'); else console.warn(`Content pane "${tabId}" not found.`);
    if (tabButton) { tabButton.classList.add('active'); tabButton.setAttribute('aria-selected', 'true'); } else console.warn(`Tab button "${tabId}" not found.`);

    if (!gameState) {
        console.warn(`switchTab called for "${tabId}" without valid gameState.`);
        if(contentPane) contentPane.innerHTML = '<p class="text-red-500">Error: Game state not available.</p>';
        return;
    }

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

    if (tabId === 'messages' && Array.isArray(gameState.messages)) {
        updateMessagesNotification(gameState.messages, true);
    }
}

/** Renders the 'My Team' tab content (roster table). */
function renderMyTeamTab(gameState) {
     if (!elements.myTeamRoster || !gameState?.playerTeam?.roster || !Array.isArray(gameState.playerTeam.roster)) {
         console.error("Cannot render My Team tab: Missing elements or invalid roster data.");
         if(elements.myTeamRoster) elements.myTeamRoster.innerHTML = '<p class="text-red-500">Error loading roster data.</p>';
         return;
     }
     const roster = gameState.playerTeam.roster;

     const physicalAttrs = ['height', 'weight', 'speed', 'strength', 'agility', 'stamina'];
     const mentalAttrs = ['playbookIQ', 'clutch', 'consistency', 'toughness'];
     const technicalAttrs = ['throwingAccuracy', 'catchingHands', 'blocking', 'tackling', 'blockShedding'];

     let tableHtml = `<div class="overflow-x-auto"><table class="min-w-full bg-white text-sm"><thead class="bg-gray-800 text-white sticky top-0 z-10"><tr>
        <th scope="col" class="py-2 px-3 text-left sticky left-0 bg-gray-800 z-20">Name</th>
        <th scope="col" class="py-2 px-3">#</th> {/* Number */}
        <th scope="col" class="py-2 px-3">Type</th>
        <th scope="col" class="py-2 px-3">Age</th>
        <th scope="col" class="py-2 px-3">Pot</th> {/* Potential */}
        <th scope="col" class="py-2 px-3">Status</th>
        ${physicalAttrs.map(h => `<th scope="col" class="py-2 px-3 uppercase">${h.slice(0,3)}</th>`).join('')}
        ${mentalAttrs.map(h => `<th scope="col" class="py-2 px-3 uppercase">${h.slice(0,3)}</th>`).join('')}
        ${technicalAttrs.map(h => `<th scope="col" class="py-2 px-3 uppercase">${h.slice(0,3)}</th>`).join('')}
    </tr></thead><tbody class="divide-y">`; // Total columns: 6 + 6 + 4 + 5 = 21

     if (roster.length === 0) {
         tableHtml += `<tr><td colspan="21" class="p-4 text-center text-gray-500">Your roster is empty.</td></tr>`; // Updated colspan
     } else {
         roster.forEach(p => {
             if (!p || !p.attributes || !p.status) return;
             const statusClass = p.status.duration > 0 ? 'text-red-500 font-semibold' : 'text-green-600';
             const statusText = p.status.description || 'Healthy';
             const typeTag = p.status.type === 'temporary' ? '<span class="status-tag temporary" title="Temporary Friend">[T]</span>' : '<span class="status-tag permanent" title="Permanent Roster">[P]</span>';

             tableHtml += `<tr data-player-id="${p.id}" class="cursor-pointer hover:bg-amber-100">
                 <th scope="row" class="py-2 px-3 font-semibold sticky left-0 bg-white z-10">${p.name}</th>
                 <td class="text-center py-2 px-3 font-medium">${p.number || '?'}</td> {/* Number */}
                 <td class="text-center py-2 px-3">${typeTag}</td>
                 <td class="text-center py-2 px-3">${p.age}</td>
                 <td class="text-center py-2 px-3 font-medium">${p.potential || '?'}</td> {/* Potential */}
                 <td class="text-center py-2 px-3 ${statusClass}" title="${statusText}">${statusText} ${p.status.duration > 0 ? `(${p.status.duration}w)` : ''}</td>`;

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
     elements.myTeamRoster.innerHTML = tableHtml + `</tbody></table></div>`;
 }


/** Renders the 'Depth Chart' tab and its sub-components. */
function renderDepthChartTab(gameState) {
    if (!gameState || !gameState.playerTeam || !gameState.playerTeam.roster || !gameState.playerTeam.formations || !gameState.playerTeam.depthChart) {
        console.error("Cannot render depth chart: Invalid game state.");
        if(elements.positionalOverallsContainer) elements.positionalOverallsContainer.innerHTML = '<p class="text-red-500">Error loading depth chart data.</p>';
        if(elements.offenseDepthChartPane) elements.offenseDepthChartPane.innerHTML = '<p class="text-red-500">Error loading offense data.</p>';
        if(elements.defenseDepthChartPane) elements.defenseDepthChartPane.innerHTML = '<p class="text-red-500">Error loading defense data.</p>';
        return;
    }
    const permanentRoster = gameState.playerTeam.roster.filter(p => p && p.status?.type !== 'temporary');
    renderPositionalOveralls(permanentRoster);
    renderFormationDropdown('offense', Object.values(offenseFormations), gameState.playerTeam.formations.offense);
    renderDepthChartSide('offense', gameState, elements.offenseDepthChartSlots, elements.offenseDepthChartRoster);
    renderFormationDropdown('defense', Object.values(defenseFormations), gameState.playerTeam.formations.defense);
    renderDepthChartSide('defense', gameState, elements.defenseDepthChartSlots, elements.defenseDepthChartRoster);
}

/** Populates the formation selection dropdown. */
function renderFormationDropdown(side, formations, currentFormationName) {
    const selectEl = elements[`${side}FormationSelect`];
    if (!selectEl) { console.error(`Formation select element for "${side}" not found.`); return; }
    if (!Array.isArray(formations)) { console.error(`Invalid formations data for "${side}".`); selectEl.innerHTML = '<option value="">Error</option>'; return; }
    selectEl.innerHTML = formations
        .map(f => `<option value="${f.name}" ${f.name === currentFormationName ? 'selected' : ''}>${f.name}</option>`)
        .join('');
}

/** Renders the table showing overall ratings for each player at each position. */
function renderPositionalOveralls(roster) {
    if (!elements.positionalOverallsContainer) return;
    const positions = Object.keys(positionOverallWeights);
    let table = `<table class="min-w-full text-sm text-left"><thead class="bg-gray-100"><tr><th scope="col" class="p-2 font-semibold sticky left-0 bg-gray-100 z-10">Player</th>${positions.map(p => `<th scope="col" class="p-2 font-semibold text-center">${p}</th>`).join('')}</tr></thead><tbody>`;
    if (roster && roster.length > 0) {
        roster.forEach(player => {
            if (!player) return;
            table += `<tr class="border-b"><th scope="row" class="p-2 font-bold sticky left-0 bg-white z-0">${player.name}</th>${positions.map(p => `<td class="p-2 text-center">${calculateOverall(player, p)}</td>`).join('')}</tr>`;
        });
    } else {
        table += `<tr><td colspan="${positions.length + 1}" class="text-center p-4 text-gray-500">No players on roster for positional overalls.</td></tr>`;
    }
    elements.positionalOverallsContainer.innerHTML = table + '</tbody></table>';
}

/** Renders the depth chart slots and available players for one side. */
function renderDepthChartSide(side, gameState, slotsContainer, rosterContainer) {
    if (!slotsContainer || !rosterContainer || !gameState?.playerTeam?.roster || !gameState?.playerTeam?.depthChart) {
        console.error(`Cannot render depth chart side "${side}": Missing elements or game state.`);
        if(slotsContainer) slotsContainer.innerHTML = '<p class="text-red-500">Error</p>';
        if(rosterContainer) rosterContainer.innerHTML = '<p class="text-red-500">Error</p>';
        return;
    }
    const { roster, depthChart } = gameState.playerTeam;
    const currentChart = depthChart[side] || {};
    const slots = Object.keys(currentChart);
    slotsContainer.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'depth-chart-slot flex items-center justify-between font-bold text-xs text-gray-500 px-2';
    header.innerHTML = `<span class="w-1/4">POS</span><div class="player-details-grid w-3/4"><span>NAME</span><span>OVR</span><span>SPD</span><span>STR</span><span>AGI</span><span>THR</span><span>CAT</span></div>`;
    slotsContainer.appendChild(header);
    slots.forEach(slot => renderSlot(slot, roster, currentChart, slotsContainer, side));
    const playersStartingOnThisSide = new Set(Object.values(currentChart).filter(Boolean));
    const availablePlayers = roster.filter(p => p && !playersStartingOnThisSide.has(p.id));
    renderAvailablePlayerList(availablePlayers, rosterContainer, side);
}

/** Renders a single depth chart slot. */
function renderSlot(positionSlot, roster, chart, container, side) {
    const playerId = chart[positionSlot];
    const player = Array.isArray(roster) ? roster.find(p => p?.id === playerId) : null;
    const basePosition = positionSlot.replace(/\d/g, '');
    const overall = player ? calculateOverall(player, basePosition) : '---';
    const typeTag = player?.status?.type === 'temporary' ? '<span class="status-tag temporary">[T]</span>' : '';
    const slotEl = document.createElement('div');
    slotEl.className = 'depth-chart-slot bg-gray-200 p-2 rounded flex items-center justify-between';
    slotEl.dataset.positionSlot = positionSlot;
    slotEl.dataset.side = side;
    if (player && player.status?.type !== 'temporary') {
        slotEl.draggable = true;
        slotEl.dataset.playerId = player.id;
        slotEl.setAttribute('title', `Drag ${player.name}`);
    } else if (!player) {
        slotEl.setAttribute('title', `Drop player for ${positionSlot}`);
    } else {
        slotEl.setAttribute('title', `${player.name} (Temporary)`);
    }
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

/** Renders the list of available players as draggable items. */
function renderAvailablePlayerList(players, container, side) {
    if (!container) return;
    container.innerHTML = '';
    if (!Array.isArray(players) || players.length === 0) {
        container.innerHTML = '<p class="text-xs text-gray-500 p-2">No players available.</p>';
        return;
    }
    players.forEach(player => {
        if (!player) return;
        const typeTag = player.status?.type === 'temporary' ? '<span class="status-tag temporary">[T]</span> ' : '';
        const playerEl = document.createElement('div');
        playerEl.className = 'draggable-player';
        playerEl.dataset.playerId = player.id;
        playerEl.dataset.side = side;
        playerEl.innerHTML = `${typeTag}${player.name ?? 'Unknown Player'}`;
        playerEl.setAttribute('title', `Drag ${player.name ?? 'Player'} to ${side} slot`);
        if (player.status?.type !== 'temporary') {
             playerEl.draggable = true;
        } else {
             playerEl.draggable = false;
             playerEl.classList.add('opacity-50', 'cursor-not-allowed');
             playerEl.setAttribute('title', `${player.name ?? 'Player'} (Temporary - Cannot move)`);
        }
        container.appendChild(playerEl);
    });
}

/** Renders the 'Messages' tab content. */
export function renderMessagesTab(gameState) {
    if (!elements.messagesList) { console.error("Messages list element not found."); return; }
    if (!gameState?.messages || !Array.isArray(gameState.messages)) {
        elements.messagesList.innerHTML = '<p class="text-gray-500">Messages unavailable.</p>';
        return;
    }
    const messages = gameState.messages;
    if (messages.length === 0) {
        elements.messagesList.innerHTML = `<p class="text-gray-500">No messages yet.</p>`;
        return;
    }
    elements.messagesList.innerHTML = messages.map(msg => {
        if (!msg) return '';
        const subject = msg.subject || '(No Subject)';
        const readClass = msg.isRead ? 'bg-gray-100 text-gray-600' : 'bg-amber-100 font-semibold border-l-4 border-amber-400';
        return `<div class="message-item ${readClass}" data-message-id="${msg.id}" role="button" tabindex="0" aria-label="View message: ${subject}">${subject}</div>`;
    }).join('');
    updateMessagesNotification(messages);
}

/** Updates the visibility of the unread messages notification dot. */
export function updateMessagesNotification(messages, markAllAsRead = false) {
    if (!elements.messagesNotificationDot || !Array.isArray(messages)) return;
    if (markAllAsRead) {
        messages.forEach(msg => { if (msg) msg.isRead = true; });
    }
    const hasUnread = messages.some(m => m && !m.isRead);
    elements.messagesNotificationDot.classList.toggle('hidden', !hasUnread);
}

/** Renders the 'Schedule' tab content. */
function renderScheduleTab(gameState) {
    if (!elements.scheduleList || !gameState?.schedule || !Array.isArray(gameState.schedule) || !gameState.teams || !gameState.playerTeam) {
        console.error("Cannot render schedule: Missing elements or invalid game state.");
        if(elements.scheduleList) elements.scheduleList.innerHTML = '<p class="text-red-500">Error loading schedule data.</p>';
        return;
    }
    let html = '';
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
                if (!g || !g.home || !g.away) { return; }
                let content;
                const result = isPastWeek ? (gameState.gameResults || []).find(r => r && r.homeTeam?.id === g.home.id && r.awayTeam?.id === g.away.id) : null;
                let resultClass = '';
                if (result) {
                    content = `<span class="${result.awayScore > result.homeScore ? 'font-bold' : ''}">${g.away.name ?? '?'} ${result.awayScore ?? '?'}</span> @ <span class="${result.homeScore > result.awayScore ? 'font-bold' : ''}">${g.home.name ?? '?'} ${result.homeScore ?? '?'}</span>`;
                    if (result.homeTeam?.id === gameState.playerTeam.id) { resultClass = result.homeScore > result.awayScore ? 'player-win' : (result.homeScore < result.awayScore ? 'player-loss' : ''); }
                    else if (result.awayTeam?.id === gameState.playerTeam.id) { resultClass = result.awayScore > result.homeScore ? 'player-win' : (result.awayScore < result.homeScore ? 'player-loss' : ''); }
                } else {
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

/** Renders the 'Standings' tab content. */
function renderStandingsTab(gameState) {
    if (!elements.standingsContainer || !gameState?.divisions || !gameState.teams || !Array.isArray(gameState.teams) || !gameState.playerTeam) {
        console.error("Cannot render standings: Missing elements or invalid game state.");
        if(elements.standingsContainer) elements.standingsContainer.innerHTML = '<p class="text-red-500">Error loading standings data.</p>';
        return;
    }
    elements.standingsContainer.innerHTML = '';
    for (const divName in gameState.divisions) {
        const divisionTeamIdsArray = gameState.divisions[divName];
        if (!Array.isArray(divisionTeamIdsArray)) { continue; }
        const divisionTeamIds = new Set(divisionTeamIdsArray);
        const divEl = document.createElement('div');
        divEl.className = 'mb-6';
        let tableHtml = `<h4 class="text-xl font-bold mb-2">${divName} Division</h4><table class="min-w-full bg-white text-sm"><thead class="bg-gray-800 text-white"><tr><th scope="col" class="py-2 px-3 text-left">Team</th><th scope="col" class="py-2 px-3">W</th><th scope="col" class="py-2 px-3">L</th></tr></thead><tbody class="divide-y">`;
        const divTeams = gameState.teams
            .filter(t => t && divisionTeamIds.has(t.id))
            .sort((a, b) => (b?.wins || 0) - (a?.wins || 0) || (a?.losses || 0) - (b?.losses || 0));
        if (divTeams.length > 0) {
            divTeams.forEach(t => {
                tableHtml += `<tr class="${t.id === gameState.playerTeam.id ? 'bg-amber-100 font-semibold' : ''}"><th scope="row" class="py-2 px-3 text-left">${t.name}</th><td class="text-center py-2 px-3">${t.wins || 0}</td><td class="text-center py-2 px-3">${t.losses || 0}</td></tr>`;
            });
        } else {
            tableHtml += '<tr><td colspan="3" class="p-4 text-center text-gray-500">No teams found.</td></tr>';
        }
        divEl.innerHTML = tableHtml + `</tbody></table>`;
        elements.standingsContainer.appendChild(divEl);
    }
}

/** Renders the 'Player Stats' tab content. */
function renderPlayerStatsTab(gameState) {
    if (!elements.playerStatsContainer || !gameState?.players || !Array.isArray(gameState.players)) {
        console.error("Cannot render player stats: Missing element or invalid player data.");
        if(elements.playerStatsContainer) elements.playerStatsContainer.innerHTML = '<p class="text-red-500">Error loading player stats.</p>';
        return;
    }
    const teamIdFilter = elements.statsFilterTeam?.value || '';
    const sortStat = elements.statsSort?.value || 'touchdowns';
    let playersToShow = gameState.players.filter(p => p && (teamIdFilter ? p.teamId === teamIdFilter : true));
    playersToShow.sort((a, b) => (b?.seasonStats?.[sortStat] || 0) - (a?.seasonStats?.[sortStat] || 0));
    const stats = ['passYards', 'passCompletions', 'passAttempts', 'rushYards', 'recYards', 'receptions', 'touchdowns', 'tackles', 'sacks', 'interceptions', 'interceptionsThrown'];
    const statHeaders = stats.map(s => {
        if (s === 'passYards') return 'PASS YDS';
        if (s === 'passCompletions') return 'COMP';
        if (s === 'passAttempts') return 'ATT';
        if (s === 'rushYards') return 'RUSH YDS';
        if (s === 'recYards') return 'REC YDS';
        if (s === 'receptions') return 'REC';
        if (s === 'touchdowns') return 'TDS';
        if (s === 'tackles') return 'TKL';
        if (s === 'sacks') return 'SACK';
        if (s === 'interceptions') return 'INT';
        if (s === 'interceptionsThrown') return 'INT THR';
        return s.toUpperCase();
    });

    let tableHtml = `<div class="overflow-x-auto"><table class="min-w-full bg-white text-sm"><thead class="bg-gray-800 text-white sticky top-0 z-10"><tr><th scope="col" class="py-2 px-3 text-left sticky left-0 bg-gray-800 z-20">Name</th>${statHeaders.map(h => `<th scope="col" class="py-2 px-3">${h}</th>`).join('')}</tr></thead><tbody class="divide-y">`;
    const numStats = stats.length + 1; // +1 for name
    if (playersToShow.length === 0) {
        tableHtml += `<tr><td colspan="${numStats}" class="p-4 text-center text-gray-500">No players match criteria.</td></tr>`;
    } else {
        playersToShow.forEach(p => {
            const playerTeamClass = p.teamId === gameState.playerTeam?.id ? 'bg-amber-50' : '';
            const statCells = stats.map(s => `<td class="text-center py-2 px-3">${p.seasonStats?.[s] || 0}</td>`).join('');
            tableHtml += `<tr class="${playerTeamClass}"><th scope="row" class="py-2 px-3 font-semibold sticky left-0 bg-white z-10 text-left">${p.name}</th>${statCells}</tr>`;
        });
    }
    elements.playerStatsContainer.innerHTML = tableHtml + `</tbody></table></div>`;
}

/** Renders the 'Hall of Fame' tab content. */
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
    elements.hallOfFameList.innerHTML = '<div class="space-y-4">' + inductees.map(p => {
        if (!p || !p.careerStats) return '';
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

/** Renders the Offseason summary screen. */
export function renderOffseasonScreen(offseasonReport, year) {
    if (!offseasonReport) { console.error("Offseason report missing."); return; }
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
    } else { devHtml = '<p>No player development updates for your team.</p>'; }
    if (elements.playerDevelopmentContainer) elements.playerDevelopmentContainer.innerHTML = devHtml;

    // Helper for lists
    const renderList = (element, items, formatFn) => { if (element) { element.innerHTML = items.length > 0 ? items.map(formatFn).join('') : '<li>None</li>'; } };

    renderList(elements.retirementsList, retiredPlayers, p => `<li>${p?.name ?? '?'} (Graduated)</li>`);
    renderList(elements.leavingPlayersList, leavingPlayers, l => `<li>${l?.player?.name ?? '?'} (${l?.reason || '?'})</li>`);
    renderList(elements.hofInducteesList, hofInductees, p => `<li>${p?.name ?? '?'}</li>`);
}

/** Sets up drag and drop event listeners for depth chart. */
export function setupDragAndDrop(onDrop) {
    const container = document.getElementById('dashboard-content');
    if (!container) { console.error("Drag/drop container (dashboard-content) missing."); return; }
    let draggedEl = null;
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
                e.dataTransfer.setData('text/plain', dragPlayerId);
                setTimeout(() => draggedEl?.classList.add('dragging'), 0);
            } else { e.preventDefault(); }
        } else { e.preventDefault(); }
    });
    container.addEventListener('dragend', e => {
        if (draggedEl) { draggedEl.classList.remove('dragging'); }
        draggedEl = null; dragPlayerId = null; dragSide = null;
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
    container.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const targetSlot = e.target.closest('.depth-chart-slot');
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        if (targetSlot && targetSlot.dataset.side === dragSide) {
            targetSlot.classList.add('drag-over');
        }
    });
    container.addEventListener('dragleave', e => {
        const targetSlot = e.target.closest('.depth-chart-slot');
        if (targetSlot) { targetSlot.classList.remove('drag-over'); }
        if (!e.relatedTarget || !container.contains(e.relatedTarget)) {
            document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        }
    });
    container.addEventListener('drop', e => {
        e.preventDefault();
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        const dropSlot = e.target.closest('.depth-chart-slot');
        const dropSide = dropSlot?.dataset.side;
        if (dropSlot && dropSlot.dataset.positionSlot && dragPlayerId && dropSide === dragSide) {
            onDrop(dragPlayerId, dropSlot.dataset.positionSlot, dropSide);
        } else { console.log("Invalid drop target."); }
        draggedEl = null; dragPlayerId = null; dragSide = null;
    });
}


/** Sets up event listener for depth chart sub-tabs (Offense/Defense). */
export function setupDepthChartTabs() {
    if (!elements.depthChartSubTabs) { console.error("Depth chart tabs container missing."); return; }
    elements.depthChartSubTabs.addEventListener('click', e => {
        if (e.target.matches('.depth-chart-tab')) {
            const subTab = e.target.dataset.subTab;
            elements.depthChartSubTabs.querySelectorAll('.depth-chart-tab').forEach(t => {
                const isSelected = t === e.target;
                t.classList.toggle('active', isSelected);
                t.setAttribute('aria-selected', isSelected.toString());
            });
            const offensePane = document.getElementById('depth-chart-offense-pane');
            const defensePane = document.getElementById('depth-chart-defense-pane');
            if (offensePane) offensePane.classList.toggle('hidden', subTab !== 'offense');
            if (defensePane) defensePane.classList.toggle('hidden', subTab !== 'defense');
        }
    });
}
// ===================================
// --- Live Game Sim UI Logic ---
// ===================================

/**
 * Draws the state of a play (players, ball) onto the field canvas.
 * FIELD (120yds) is mapped to CANVAS WIDTH (horizontal).
 * FIELD (53.3yds) is mapped to CANVAS HEIGHT (vertical).
 * @param {object} frameData - A single frame from resolvePlay.visualizationFrames.
 */
export function drawFieldVisualization(frameData) {
    const ctx = elements.fieldCanvasCtx;
    const canvas = elements.fieldCanvas;
    if (!ctx || !canvas) return;

    // Clear canvas
    ctx.fillStyle = '#059669'; // Tailwind green-700
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // --- Scaling (SWAPPED) ---
    // Map 120 yards (FIELD_LENGTH) to canvas WIDTH (e.g., 840px)
    const scaleX = canvas.width / FIELD_LENGTH; // e.g., 840 / 120 = 7
    // Map 53.3 yards (FIELD_WIDTH) to canvas HEIGHT (e.g., 375px)
    const scaleY = canvas.height / FIELD_WIDTH; // e.g., 375 / 53.3 = ~7
    // --- End Scaling ---

    // --- Draw Field Markings (Rotated) ---
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.font = 'bold 12px "Inter"'; // <-- Made text bigger
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Draw 10-yard lines (now vertical)
    for (let y = 10; y <= 110; y += 10) { 
        const drawX = y * scaleX; // Use Y-yard for X-coordinate
        ctx.beginPath();
        ctx.moveTo(drawX, 0);
        ctx.lineTo(drawX, canvas.height);
        ctx.stroke();

        if (y > 10 && y < 110) {
            // Draw yard line numbers
            const yardLineNum = y <= 60 ? y - 10 : 120 - y - 10;
            ctx.fillText(yardLineNum.toString(), drawX, 15); // Near top sideline
            ctx.fillText(yardLineNum.toString(), drawX, canvas.height - 15); // Near bottom sideline
        }
    }
    
    // Draw Hash Marks (now horizontal)
    const hashTopY = HASH_LEFT_X * scaleY; // Use X-hash for Y-coordinate
    const hashBottomY = HASH_RIGHT_X * scaleY;
    for (let y = 11; y < 110; y++) { // Every yard
        if (y % 10 === 0) continue; // Skip main lines
        const drawX = y * scaleX;
        ctx.beginPath();
        ctx.moveTo(drawX, hashTopY - 3);
        ctx.lineTo(drawX, hashTopY + 3);
        ctx.moveTo(drawX, hashBottomY - 3);
        ctx.lineTo(drawX, hashBottomY + 3);
        ctx.stroke();
    }
    // --- End Field Markings ---

    if (!frameData || !frameData.players) return; // If no frame, just show empty field

    // --- Draw Players (Rotated & Bigger) ---
    const playerRadius = 8; // <-- Made bigger (was 7)
    
    frameData.players.forEach(pState => {
        if (pState.x === undefined || pState.y === undefined) return;

        // --- SWAPPED COORDINATES ---
        const drawX = pState.y * scaleX; // Player Y-position maps to Canvas X
        const drawY = pState.x * scaleY; // Player X-position maps to Canvas Y
        // --- END SWAP ---

        // Use Team Colors
        ctx.fillStyle = pState.primaryColor || (pState.isOffense ? '#DC2626' : '#E5E7EB');
        ctx.beginPath();
        ctx.arc(drawX, drawY, playerRadius, 0, 2 * Math.PI);
        ctx.fill();

        // Draw Player Number
        ctx.fillStyle = pState.secondaryColor || (pState.isOffense ? '#FFFFFF' : '#000000');
        ctx.font = 'bold 10px "Inter"'; // <-- Made bigger (was 9px)
        ctx.fillText(pState.number || '?', drawX, drawY + 1);

        // Highlight ball carrier
        if (pState.isBallCarrier) {
            ctx.strokeStyle = '#FBBF24';
            ctx.lineWidth = 3; // <-- Made bigger (was 2.5)
            ctx.beginPath();
            ctx.arc(drawX, drawY, playerRadius + 4, 0, 2 * Math.PI); // <-- Made bigger
            ctx.stroke();
        }
    });

    // --- Draw Ball (Rotated & Bigger) ---
    if (frameData.ball && frameData.ball.inAir) {
        // --- SWAPPED COORDINATES ---
        const ballDrawX = frameData.ball.y * scaleX; // Ball Y maps to Canvas X
        const ballDrawY = frameData.ball.x * scaleY; // Ball X maps to Canvas Y
        // --- END SWAP ---
        
        // Shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.beginPath();
        ctx.arc(ballDrawX + 2, ballDrawY + 2, 5, 0, 2 * Math.PI); // <-- Made bigger (was 4)
        ctx.fill();
        // Ball
        ctx.fillStyle = '#854D0E'; // brown-700
        ctx.beginPath();
        ctx.arc(ballDrawX, ballDrawY, 5, 0, 2 * Math.PI); // <-- Made bigger (was 4)
        ctx.fill();
    }
}

/** Renders the live stats box with key player performances for the game. */
function renderLiveStatsBox(gameResult) {
    if (!elements.simLiveStats || !elements.simStatsAway || !elements.simStatsHome || !gameResult) {
        console.warn("Cannot render live stats box: Missing elements or gameResult.");
        return;
    }
    const { homeTeam, awayTeam } = gameResult;

    // Helper function to find top players and format their stats
    const generateTeamStatsHtml = (team) => {
        if (!team || !team.roster || team.roster.length === 0) return '<h5>No Player Data</h5>';

        const findTopStat = (statName) => team.roster
            .filter(p => p && p.gameStats && p.gameStats[statName] > 0)
            .sort((a, b) => (b.gameStats[statName] || 0) - (a.gameStats[statName] || 0))[0];

        const qb = team.roster.find(p => p && p.gameStats && p.gameStats.passYards > 0);
        const leadingRusher = findTopStat('rushYards');
        const leadingReceiver = findTopStat('recYards');
        const leadingTackler = findTopStat('tackles');
        const topSacker = findTopStat('sacks');
        const topInterceptor = findTopStat('interceptions');

        let html = `<h5 class="text-lg font-semibold text-amber-400 mb-1 border-b border-gray-600 pb-1">${team.name}</h5>`;
        let statsAdded = false;

        if (qb) {
            html += `<p>${qb.name} (QB): <strong>${qb.gameStats.passCompletions || 0}/${qb.gameStats.passAttempts || 0}, ${qb.gameStats.passYards || 0} Yds, ${qb.gameStats.touchdowns || 0} TD, ${qb.gameStats.interceptionsThrown || 0} INT</strong></p>`;
            statsAdded = true;
        }
        if (leadingRusher && leadingRusher.id !== qb?.id) {
            html += `<p>${leadingRusher.name} (Run): <strong>${leadingRusher.gameStats.rushYards || 0} Yds, ${leadingRusher.gameStats.touchdowns || 0} TD</strong></p>`;
            statsAdded = true;
        }
        if (leadingReceiver) {
            html += `<p>${leadingReceiver.name} (Rec): <strong>${leadingReceiver.gameStats.receptions || 0}-${leadingReceiver.gameStats.recYards || 0} Yds, ${leadingReceiver.gameStats.touchdowns || 0} TD</strong></p>`;
            statsAdded = true;
        }
         if (leadingTackler) {
             const sacks = (topSacker && topSacker.id === leadingTackler.id) ? (leadingTackler.gameStats.sacks || 0) : 0;
             const ints = (topInterceptor && topInterceptor.id === leadingTackler.id) ? (leadingTackler.gameStats.interceptions || 0) : 0;
             html += `<p>${leadingTackler.name} (Def): <strong>${leadingTackler.gameStats.tackles || 0} Tkl${sacks > 0 ? `, ${sacks} Sack` : ''}${ints > 0 ? `, ${ints} INT` : ''}</strong></p>`;
             statsAdded = true;
         }
         if (topSacker && topSacker.id !== leadingTackler?.id) {
              html += `<p>${topSacker.name} (Def): <strong>${topSacker.gameStats.sacks || 0} Sack</strong></p>`;
              statsAdded = true;
         }
          if (topInterceptor && topInterceptor.id !== leadingTackler?.id && topInterceptor.id !== topSacker?.id) {
              html += `<p>${topInterceptor.name} (Def): <strong>${topInterceptor.gameStats.interceptions || 0} INT</strong></p>`;
              statsAdded = true;
          }

        if (!statsAdded) {
             html += '<p class="text-gray-400">No significant stats recorded.</p>';
        }
        return html;
    };

    elements.simStatsAway.innerHTML = generateTeamStatsHtml(awayTeam);
    elements.simStatsHome.innerHTML = generateTeamStatsHtml(homeTeam);
}

/** Starts the live game simulation, syncing frames with log entries. */
export function startLiveGameSim(gameResult, onComplete) {
    const ticker = elements.simPlayLog;
    const scoreboard = elements.simScoreboard;

    // --- 1. Validate Elements ---
    if (!ticker || !scoreboard || !elements.simAwayScore || !elements.simHomeScore || !elements.simGameDrive || !elements.simGameDown || !elements.simPossession || !elements.fieldCanvasCtx || !elements.simLiveStats) {
        console.error("Live sim UI elements missing!");
        if (onComplete) onComplete();
        return;
    }

    // --- 2. Validate Data ---
    if (!gameResult || !Array.isArray(gameResult.gameLog) || !gameResult.homeTeam || !gameResult.awayTeam || !Array.isArray(gameResult.visualizationFrames)) {
        console.warn("startLiveGameSim: invalid gameResult or missing frames.");
        if(ticker) ticker.innerHTML = '<p>No game events to display.</p>';
        if (onComplete) onComplete();
        return;
    }

    // --- Clear Previous Simulation ---
    if (liveGameInterval) {
        clearInterval(liveGameInterval);
        liveGameInterval = null;
    }

    // --- 3. Setup State ---
    let logIndexToShow = 0;
    const allFrames = gameResult.visualizationFrames;
    const allLogs = gameResult.gameLog;
    liveGameCallback = onComplete;
    currentLiveGameResult = gameResult;
    liveGameCurrentIndex = 0;

    // --- NEW: Add state variables for tracking game situation ---
    let currentHomeScore = 0;
    let currentAwayScore = 0;
    let ballOn = 20; // Initial kickoff position assumed
    let down = 1;
    let toGo = 10;
    let driveActive = false; // Will be set true on first drive log
    let possessionTeamName = gameResult.homeTeam.name; // Assume home starts? Or parse from first log? Let's assume home for now. Needs update on turnover/kickoff.
    let currentDriveText = "Opening Drive";
    // --- End NEW state variables ---

    // --- 4. Render Initial/Static UI ---
    if(ticker) ticker.innerHTML = '';
    if(elements.simAwayTeam) elements.simAwayTeam.textContent = gameResult.awayTeam.name;
    if(elements.simHomeTeam) elements.simHomeTeam.textContent = gameResult.homeTeam.name;
    if(elements.simAwayScore) elements.simAwayScore.textContent = currentAwayScore; // Use state var
    if(elements.simHomeScore) elements.simHomeScore.textContent = currentHomeScore; // Use state var
    if(elements.simGameDrive) elements.simGameDrive.textContent = currentDriveText; // Use state var
    if(elements.simGameDown) elements.simGameDown.textContent = driveActive ? `${down} & ${toGo <= 0 ? 'Goal' : toGo}` : ""; // Use state vars
    if(elements.simPossession) elements.simPossession.textContent = possessionTeamName ? `${possessionTeamName} Ball` : ''; // Use state var
    drawFieldVisualization(null);
    renderLiveStatsBox(gameResult);

    // --- 5. Frame-by-Frame Playback Function ---
    function nextFrame() {
        // --- End Condition Check ---
        if (liveGameCurrentIndex >= allFrames.length) {
            clearInterval(liveGameInterval);
            liveGameInterval = null;
            if (currentLiveGameResult) { // Use final result for absolute accuracy
                if(elements.simAwayScore) elements.simAwayScore.textContent = currentLiveGameResult.awayScore;
                if(elements.simHomeScore) elements.simHomeScore.textContent = currentLiveGameResult.homeScore;
            } else { console.warn("Final score update skipped: currentLiveGameResult was null"); }
            if(elements.simGameDown) elements.simGameDown.textContent = "FINAL";
            if(elements.simPossession) elements.simPossession.textContent = "";
            drawFieldVisualization(null);
            currentLiveGameResult = null;
            if (liveGameCallback) { const cb = liveGameCallback; liveGameCallback = null; cb(); }
            return;
        }

        // --- Process Current Frame ---
        const frame = allFrames[liveGameCurrentIndex];
        if (!frame) {
            console.warn(`Skipping potentially empty or invalid frame at index ${liveGameCurrentIndex}`);
            liveGameCurrentIndex++;
            return;
        }

        // --- Sync Log Entries ---
        if (ticker && frame.logIndex > logIndexToShow) {
            for (let i = logIndexToShow; i < frame.logIndex; i++) {
                const playLogEntry = allLogs[i];
                if (!playLogEntry) continue;

                const p = document.createElement('p');
                let styleClass = '';

                // --- INTEGRATED Descriptive Text Logic ---
                let descriptiveText = playLogEntry;
                // Use 'ballOn' state variable that's updated below
                const fieldSide = ballOn <= 50 ? (possessionTeamName === gameResult.homeTeam.name ? "own" : "opponent") : (possessionTeamName === gameResult.homeTeam.name ? "opponent" : "own");
                const yardLine = ballOn <= 50 ? ballOn : 100 - ballOn;

                if (playLogEntry.startsWith('-- Drive') || playLogEntry.startsWith('====')) {
                    styleClass = 'font-bold text-amber-400 mt-2';
                    if (playLogEntry.startsWith('==== FINAL')) styleClass += ' text-lg';
                    descriptiveText = `🏈 ${playLogEntry.replace('-- Drive', 'New Drive:')} 🏈`;
                    if (playLogEntry.startsWith('====')) descriptiveText = `⏱️ ${playLogEntry} ⏱️`;
                } else if (playLogEntry.startsWith('🎉 TOUCHDOWN')) {
                    descriptiveText = playLogEntry;
                    styleClass = 'font-semibold text-green-400';
                } else if (playLogEntry.includes('conversion GOOD!')) {
                    descriptiveText = `✅ ${playLogEntry} Points are good!`;
                    styleClass = 'font-semibold text-green-400';
                } else if (playLogEntry.includes('Conversion FAILED!')) {
                    descriptiveText = `❌ ${playLogEntry} No good!`;
                    styleClass = 'font-semibold text-red-400';
                } else if (playLogEntry.startsWith('❗ INTERCEPTION') || playLogEntry.startsWith('❗ FUMBLE')) {
                    descriptiveText = playLogEntry;
                    styleClass = 'font-semibold text-red-400';
                } else if (playLogEntry.startsWith('✋ Turnover on downs')) {
                    descriptiveText = playLogEntry;
                    styleClass = 'font-semibold text-red-400';
                } else if (playLogEntry.startsWith('💥 SACK')) {
                     // Calculate post-sack yard line based on current ballOn state
                     const loss = parseInt(playLogEntry.match(/loss of (\d+\.?\d*)/)?.[1] || 0);
                     const postSackBallOn = Math.max(0, ballOn - loss); // ballOn is *before* sack here
                     const postSackFieldSide = postSackBallOn <= 50 ? (possessionTeamName === gameResult.homeTeam.name ? "own" : "opponent") : (possessionTeamName === gameResult.homeTeam.name ? "opponent" : "own");
                     const postSackYardLine = postSackBallOn <= 50 ? postSackBallOn : 100 - postSackBallOn;
                     descriptiveText = `${playLogEntry.replace('SACK!', 'SACK!')} Ball on the ${postSackFieldSide} ${postSackYardLine}.`;
                     styleClass = 'text-orange-400';
                } else if (playLogEntry.includes('stuffed near the line')) {
                    descriptiveText = `🧱 ${playLogEntry} Stopped at the ${fieldSide} ${yardLine}!`;
                    styleClass = 'text-orange-300';
                } else if (playLogEntry.includes(' passes to ')) {
                    const passer = playLogEntry.match(/^(.*?) passes to/)?.[1];
                    const receiver = playLogEntry.match(/passes to (.*?)\.\.\./)?.[1];
                    descriptiveText = `🏈 ${passer} passes to ${receiver}...`;
                } else if (playLogEntry.includes('Caught by') && playLogEntry.includes('yards')) { // Removed '.' dependency
                    const yardsMatch = playLogEntry.match(/for (-?\d+\.?\d*) yards/);
                    const yards = yardsMatch ? parseFloat(yardsMatch[1]) : 0;
                    const newYardLine = Math.round(ballOn + yards); // Use state ballOn
                    const newFieldSide = newYardLine <= 50 ? (possessionTeamName === gameResult.homeTeam.name ? "own" : "opponent") : (possessionTeamName === gameResult.homeTeam.name ? "opponent" : "own");
                    const newYardLineNum = newYardLine <= 50 ? newYardLine : 100 - newYardLine;
                    if (yards >= 15) { descriptiveText = `🎯 ${playLogEntry.replace('Caught by', 'Hauled in by')} for a big gain! Ball at the ${newFieldSide} ${newYardLineNum}.`; }
                    else if (yards > 0) { descriptiveText = `👍 ${playLogEntry.replace('Caught by', 'Complete to')}. Ball at the ${newFieldSide} ${newYardLineNum}.`; }
                    else { descriptiveText = `✋ ${playLogEntry}. Stopped for minimal gain.`; }
                } else if (playLogEntry.includes('INCOMPLETE')) {
                    if (playLogEntry.includes('Defended by')) { descriptiveText = `🚫 ${playLogEntry.replace('INCOMPLETE pass to', 'Pass intended for')} Knocked away!`; }
                    else if (playLogEntry.includes('Off target')) { descriptiveText = ` overthrown... ${playLogEntry}`; } // Simplified
                    else { descriptiveText = `❌ ${playLogEntry}`; }
                    styleClass = 'font-semibold text-red-400'; // Apply style for all incompletes
                } else if (playLogEntry.match(/(\w+\s+'?\w+'?) (bursts through|shakes off|breaks into|is loose!|finds a small crease|runs out of bounds)/)) {
                     const yardsMatch = playLogEntry.match(/gain of (\d+\.?\d*)|loss of (\d+\.?\d*)/); // Check gain or loss
                     let yards = 0;
                     if(yardsMatch) {
                         yards = parseFloat(yardsMatch[1] || `-${yardsMatch[2]}`); // Gain positive, loss negative
                     } else if (playLogEntry.includes("crease")) {
                         yards = getRandomInt(1,3); // Assume small gain if not specified
                     } else {
                         yards = getRandomInt(4,7); // Assume medium gain if not specified
                     }
                     const newYardLine = Math.round(ballOn + yards); // Use state ballOn
                     const newFieldSide = newYardLine <= 50 ? (possessionTeamName === gameResult.homeTeam.name ? "own" : "opponent") : (possessionTeamName === gameResult.homeTeam.name ? "opponent" : "own");
                     const newYardLineNum = newYardLine <= 50 ? newYardLine : 100 - newYardLine;
                     if (yards >= 10) { descriptiveText = `💨 HE'S LOOSE! ${playLogEntry}! Great run! Ball at the ${newFieldSide} ${newYardLineNum}.`; }
                     else if (yards > 0) { descriptiveText = `➡️ ${playLogEntry}. Nice gain on the ground. Ball at the ${newFieldSide} ${newYardLineNum}.`; }
                     else { descriptiveText = `✋ ${playLogEntry}. Stopped near the line. Ball at the ${newFieldSide} ${newYardLineNum}.`; }
                     styleClass = 'text-cyan-300';
                } else if (playLogEntry.includes('tackled by') || playLogEntry.includes('Stopped by') || playLogEntry.includes('dragged down') || playLogEntry.includes('Caught from behind')) {
                     const yardsMatch = playLogEntry.match(/gain of (\d+\.?\d*)|loss of (\d+\.?\d*)/); // Check gain or loss
                     let yards = 0;
                     if(yardsMatch) { yards = parseFloat(yardsMatch[1] || `-${yardsMatch[2]}`); }
                     const newYardLine = Math.round(ballOn + yards); // Use state ballOn
                     const newFieldSide = newYardLine <= 50 ? (possessionTeamName === gameResult.homeTeam.name ? "own" : "opponent") : (possessionTeamName === gameResult.homeTeam.name ? "opponent" : "own");
                     const newYardLineNum = newYardLine <= 50 ? newYardLine : 100 - newYardLine;
                     descriptiveText = `✋ ${playLogEntry} Ball at the ${newFieldSide} ${newYardLineNum}.`;
                } else if (playLogEntry.startsWith('➡️ First down')) {
                    descriptiveText = playLogEntry;
                    styleClass = 'text-yellow-300 font-semibold';
                } else if (playLogEntry.startsWith('🚑 INJURY')) {
                    descriptiveText = playLogEntry;
                    styleClass = 'text-purple-400 italic';
                }
                // --- End INTEGRATED Descriptive Text Logic ---

                p.className = styleClass;
                p.textContent = descriptiveText;
                ticker.appendChild(p);

                // --- INTEGRATED Update Internal Simulation State ---
                try {
                    if (playLogEntry.startsWith('-- Drive')) {
                        ballOn = 20; down = 1; toGo = 10; driveActive = true;
                        const driveMatch = playLogEntry.match(/(Drive \d+ \(H\d+\))/);
                        possessionTeamName = playLogEntry.includes(gameResult.homeTeam.name) ? gameResult.homeTeam.name : gameResult.awayTeam.name;
                        if(driveMatch) currentDriveText = driveMatch[0];
                    } else if (playLogEntry.startsWith('➡️ First down')) {
                        down = 1;
                        const goalMatch = playLogEntry.match(/Goal at the (\d+)/);
                        const yardLineMatch = playLogEntry.match(/at the (own|opponent) (\d+)/);
                        if (yardLineMatch) {
                            const side = yardLineMatch[1]; const line = parseInt(yardLineMatch[2], 10);
                            if (side === 'own') ballOn = line; else ballOn = 100 - line;
                        }
                         toGo = goalMatch ? parseInt(goalMatch[1], 10) : Math.min(10, 100 - ballOn); // Set toGo based on new ballOn
                         if (toGo <= 0) toGo = 1; // Ensure toGo is at least 1 if it's Goal
                    } else if (playLogEntry.match(/gain of (\d+\.?\d*)|loss of (\d+\.?\d*)/)) {
                         const yardsMatch = playLogEntry.match(/gain of (\d+\.?\d*)|loss of (\d+\.?\d*)/);
                         let yards = 0;
                         if(yardsMatch) { yards = parseFloat(yardsMatch[1] || `-${yardsMatch[2]}`); }
                        if (driveActive) {
                             ballOn += yards;
                             toGo -= yards;
                             ballOn = Math.round(Math.max(0,Math.min(100, ballOn)));
                             toGo = Math.round(toGo);
                             if (toGo > 0) down++; else if (ballOn < 100) down=1; // Reset down if first down, but not TD
                         }
                    } else if (playLogEntry.includes('INCOMPLETE') || playLogEntry.startsWith('❌') || playLogEntry.startsWith('🚫') || playLogEntry.startsWith('‹‹')) {
                        if (driveActive) down++;
                    } else if (playLogEntry.startsWith('🎉 TOUCHDOWN')) {
                        ballOn = 100; driveActive = false; // TD ends drive
                    } else if (playLogEntry.includes('conversion GOOD!')) {
                        const points = playLogEntry.includes('2-point') ? 2 : 1;
                        if(possessionTeamName === gameResult.homeTeam.name) currentHomeScore += (6 + points); else currentAwayScore += (6 + points);
                        driveActive = false; // Conversion attempt ends drive possession
                    } else if (playLogEntry.includes('Conversion FAILED!')) {
                        const points = 6;
                        if(possessionTeamName === gameResult.homeTeam.name) currentHomeScore += points; else currentAwayScore += points;
                        driveActive = false; // Conversion attempt ends drive possession
                    } else if (playLogEntry.startsWith('Turnover') || playLogEntry.startsWith('❗ INTERCEPTION') || playLogEntry.startsWith('❗ FUMBLE')) {
                        driveActive = false; // Turnover ends drive
                        const yardLineMatch = playLogEntry.match(/at the (own|opponent) (\d+)/);
                        if (yardLineMatch) { // Update ballOn for next possession
                            const side = yardLineMatch[1]; const line = parseInt(yardLineMatch[2], 10);
                            // 'own'/'opponent' is relative to the *new* team with possession
                            if (side === 'own') ballOn = line; else ballOn = 100 - line;
                        }
                         // Flip possession for next drive (handled when next drive starts)
                    } else if (playLogEntry.startsWith('==== FINAL') || playLogEntry.startsWith('==== HALFTIME')) {
                        driveActive = false; // End of period
                    }
                    if (down > 4 && driveActive) {
                         driveActive = false; // Turnover on downs ends drive
                         // Flip possession (handled when next drive starts)
                         // Ball position remains where it ended
                    }
                } catch (parseError) {
                    console.error("Error parsing log entry for sim state:", playLogEntry, parseError);
                }
                // --- End INTEGRATED Internal State Update ---

            } // End FOR loop for log entries

            logIndexToShow = frame.logIndex;
            if(ticker) ticker.scrollTop = ticker.scrollHeight;

             // --- Update UI elements AFTER processing logs for this frame ---
             if(elements.simAwayScore) elements.simAwayScore.textContent = currentAwayScore;
             if(elements.simHomeScore) elements.simHomeScore.textContent = currentHomeScore;
             if(elements.simGameDrive) elements.simGameDrive.textContent = currentDriveText;
             if(elements.simGameDown) elements.simGameDown.textContent = driveActive ? `${down} & ${toGo <= 0 ? 'Goal' : toGo}` : ( (liveGameCurrentIndex >= allFrames.length -1) ? "FINAL" : 'Change of Possession');
             if(elements.simPossession) elements.simPossession.textContent = possessionTeamName ? `${possessionTeamName} Ball` : '';
             // --- End UI Update ---

        } // End IF for syncing logs
        // --- End Sync Log Entries ---

        // --- Draw Visualization ---
        drawFieldVisualization(frame);

        // --- Advance to Next Frame ---
        liveGameCurrentIndex++;

    } // <<< End of 'nextFrame' function definition

    // --- 6. Start the Interval Timer ---
    liveGameInterval = setInterval(nextFrame, liveGameSpeed);

} // <<< End of 'startLiveGameSim' function

export function skipLiveGameSim(gameResult) {
    if (liveGameInterval) { clearInterval(liveGameInterval); liveGameInterval = null; }
    const ticker = elements.simPlayLog;
    if (ticker) {
        const p = document.createElement('p'); p.className = 'italic text-gray-400 mt-2'; p.textContent = '--- Simulation skipped ---'; ticker.appendChild(p); ticker.scrollTop = ticker.scrollHeight;
    }
    const finalResult = gameResult || currentLiveGameResult;
    if (finalResult) {
        if (elements.simAwayScore) elements.simAwayScore.textContent = finalResult.awayScore;
        if (elements.simHomeScore) elements.simHomeScore.textContent = finalResult.homeScore;
    } else { console.warn("skipLiveGameSim: No final result data available."); }
    if (elements.simGameDown) elements.simGameDown.textContent = "FINAL";
    if (elements.simPossession) elements.simPossession.textContent = "";
    drawFieldVisualization(null); // Clear canvas

    currentLiveGameResult = null;
    if (liveGameCallback) { const cb = liveGameCallback; liveGameCallback = null; cb(); }
}

/** Changes the speed of the live game simulation interval. */
export function setSimSpeed(speed) {
    liveGameSpeed = speed;

    // Update button styles
    elements.simSpeedBtns?.forEach(btn => btn.classList.remove('active', 'bg-blue-500', 'hover:bg-blue-600'));
    elements.simSpeedBtns?.forEach(btn => btn.classList.add('bg-gray-500', 'hover:bg-gray-600'));
    let activeButtonId;
    if (speed === 1000) activeButtonId = 'sim-speed-play'; else if (speed === 400) activeButtonId = 'sim-speed-fast'; else if (speed === 100) activeButtonId = 'sim-speed-faster';
    const activeButton = document.getElementById(activeButtonId);
    if (activeButton) { activeButton.classList.remove('bg-gray-500', 'hover:bg-gray-600'); activeButton.classList.add('active', 'bg-blue-500', 'hover:bg-blue-600'); }

    // If sim is running, clear and restart interval with the new speed
    if (liveGameInterval) {
        clearInterval(liveGameInterval);

        // --- Re-create the nextFrame function locally ---
        // (This function is identical to the one in startLiveGameSim)
        function nextFrameForRestart() {
            if (!currentLiveGameResult || !currentLiveGameResult.visualizationFrames || !currentLiveGameResult.gameLog) {
                 clearInterval(liveGameInterval); liveGameInterval = null; return;
            }
            
            const allFrames = currentLiveGameResult.visualizationFrames;
            const allLogs = currentLiveGameResult.gameLog;
            const ticker = elements.simPlayLog;
            
            // We need to know the *current* frame index
            let frameIndex = liveGameCurrentIndex;
            
            // We must find the log index *up to the current frame*
            let logIndexToShow = 0;
            if (frameIndex > 0 && frameIndex < allFrames.length) {
                // Find the log index of the *previous* frame to know what's already been printed
                logIndexToShow = allFrames[frameIndex - 1].logIndex;
            }

            if (frameIndex >= allFrames.length) { // End condition
                clearInterval(liveGameInterval); liveGameInterval = null;
                if (currentLiveGameResult) {
                    elements.simAwayScore.textContent = currentLiveGameResult.awayScore;
                    elements.simHomeScore.textContent = currentLiveGameResult.homeScore;
                }
                elements.simGameDown.textContent = "FINAL";
                elements.simPossession.textContent = "";
                drawFieldVisualization(null);
                
                currentLiveGameResult = null;
                if (liveGameCallback) { const cb = liveGameCallback; liveGameCallback = null; cb(); }
                return;
            }

            const frame = allFrames[frameIndex];
            
            // --- SYNC LOGS ---
            if (ticker && frame.logIndex > logIndexToShow) {
                for (let i = logIndexToShow; i < frame.logIndex; i++) {
                    const playLogEntry = allLogs[i];
                    if (!playLogEntry) continue;
                    const p = document.createElement('p');
                    let styleClass = '';
                    if (playLogEntry.startsWith('-- Drive') || playLogEntry.startsWith('====')) styleClass = 'font-bold text-amber-400 mt-2';
                    else if (playLogEntry.startsWith('🎉') || playLogEntry.startsWith('✅')) styleClass = 'font-semibold text-green-400';
                    else if (playLogEntry.startsWith('❗') || playLogEntry.startsWith('✋') || playLogEntry.startsWith('❌') || playLogEntry.startsWith('‹‹')) styleClass = 'font-semibold text-red-400';
                    else if (playLogEntry.startsWith('💥')) styleClass = 'text-orange-400';
                    else if (playLogEntry.startsWith('➡️')) styleClass = 'text-yellow-300 font-semibold';
                    else if (playLogEntry.startsWith('🚑')) styleClass = 'text-purple-400 italic';
                    
                    p.className = styleClass;
                    p.textContent = playLogEntry;
                    ticker.appendChild(p);
                }
                // logIndexToShow = frame.logIndex; // Don't update the global, just used for this loop
                ticker.scrollTop = ticker.scrollHeight;
            }
            // --- END SYNC LOGS ---
            
            drawFieldVisualization(frame);
            
            liveGameCurrentIndex++; // Increment the *global* frame index
        }
        // --- END NEW function ---

        liveGameInterval = setInterval(nextFrameForRestart, liveGameSpeed);
    }
} // End setSimSpeed
