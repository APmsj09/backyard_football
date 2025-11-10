import {
    calculateOverall,
    getRelationshipLevel,
    getScoutedPlayerInfo,
    getGameState,
    substitutePlayers
} from './game.js';
import {
    offenseFormations,
    defenseFormations,
    relationshipLevels // <-- Added
} from './data.js';
import {
    positionOverallWeights,
    estimateBestPosition
} from './game/player.js';

// At the top of ui.js
import { getRandom, getRandomInt, formatHeight } from './utils.js';

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
let liveGameIsConversion = false;

// --- Live Game Sim State ---
let liveGameInterval = null; // Holds interval ID for stopping/starting
let liveGameSpeed = 50; // Current sim speed in milliseconds
let liveGameCurrentIndex = 0; // Current index in the game log array
let liveGameLog = []; // Stores the log entries for the current sim
let liveGameCallback = null; // Function to call when sim completes or is skipped
let currentLiveGameResult = null; // Stores the full gameResult object for accurate final display
let userPreferredSpeed = 50;
let huddleTimeout = null;

let liveGameLogIndex = 0;
let liveGameCurrentHomeScore = 0;
let liveGameCurrentAwayScore = 0;
let liveGameBallOn = 20;
let liveGameDown = 1;
let liveGameToGo = 10;
let liveGameDriveActive = false;
let liveGamePossessionName = '';
let liveGameDriveText = '';


/**
 * Debounce function to limit rapid function calls (e.g., on input).
 * @param {Function} func - The function to debounce.
 * @param {number} delay - The debounce delay in milliseconds.
 */
function debounce(func, delay) {
    return function (...args) {
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
            'start-screen': document.getElementById('start-screen'),
            'loading-screen': document.getElementById('loading-screen'),
            'team-creation-screen': document.getElementById('team-creation-screen'),
            'draft-screen': document.getElementById('draft-screen'),
            'dashboard-screen': document.getElementById('dashboard-screen'),
            'offseason-screen': document.getElementById('offseason-screen'),
            'game-sim-screen': document.getElementById('game-sim-screen'),
            // Also store camelCase versions for backward compatibility
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
        modalDefaultClose: document.getElementById('modal-default-close'),
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

        // --- Game Sim Screen Elements ---
        gameSimScreen: document.getElementById('game-sim-screen'),
        simScoreboard: document.getElementById('sim-scoreboard'),
        simAwayTeam: document.getElementById('sim-away-team'),
        simAwayScore: document.getElementById('sim-away-score'),
        simHomeTeam: document.getElementById('sim-home-team'),
        simHomeScore: document.getElementById('sim-home-score'),
        simGameDrive: document.getElementById('sim-game-drive'),
        simGameDown: document.getElementById('sim-game-down'),
        simPossession: document.getElementById('sim-possession'),
        fieldCanvas: document.getElementById('field-canvas'),
        simPlayLog: document.getElementById('sim-play-log'),
        simSpeedBtns: document.querySelectorAll('.sim-speed-btn'),
        simSkipBtn: document.getElementById('sim-skip-btn'),
        simLiveStats: document.getElementById('sim-live-stats'),
        simStatsAway: document.getElementById('sim-stats-away'),
        simStatsHome: document.getElementById('sim-stats-home'),

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
        ,
        // Players / substitution panel
        simPlayersPanel: document.getElementById('sim-players-panel'),
        simPlayersList: document.getElementById('sim-players-list')
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

    // Wire up default modal close if present (helps when showModal isn't used to create buttons)
    if (elements.modalDefaultClose) {
        elements.modalDefaultClose.addEventListener('click', () => {
            try { hideModal(); } catch (e) { console.warn('hideModal unavailable', e); }
        });
    }
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

    // Try to match the screen by converting kebab-case to camelCase
    const camelScreenId = screenId.replace(/-([a-z])/g, g => g[1].toUpperCase());
    if (!elements.screens[screenId] && !elements.screens[camelScreenId]) {
        console.warn(`Screen element "${screenId}" not found in initial setup. Attempting direct lookup.`);
        const element = document.getElementById(screenId);
        if (element) {
            elements.screens[screenId] = element;
            // Also store with camelCase key for future lookups
            elements.screens[camelScreenId] = element;
        }
        else { console.error(`CRITICAL: Screen element ID "${screenId}" still not found.`); return; }
    }

    // Use whichever key exists
    const screenElement = elements.screens[screenId] || elements.screens[camelScreenId];

    Object.values(elements.screens).forEach(screen => {
        if (screen && screen.classList) {
            screen.classList.add('hidden');
        }
    });

    if (screenElement && screenElement.classList) {
        screenElement.classList.remove('hidden');
    } else {
        console.error(`Attempted to show screen "${screenId}" but element reference invalid.`);
        return;
    }

    // Store screen reference for both kebab and camel case
    elements.screens[screenId] = screenElement;
    elements.screens[camelScreenId] = screenElement;
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

export function updateLoadingProgress(progress) {
    const progressElement = document.getElementById('loading-progress');
    const progressText = document.getElementById('loading-progress-text');

    if (progressElement) {
        progressElement.style.width = progress + "%";
        progressElement.setAttribute("aria-valuenow", progress);
    }

    if (progressText) {
        progressText.textContent = `${progress}%`;
    }
}

// Rotating loading messages
const loadingMessages = [
    "Scouting rookies...",
    "Building team rosters...",
    "Analyzing player stats...",
    "Setting up salary caps...",
    "Scheduling season games...",
    "Drafting prospects...",
    "Signing free agents...",
    "Preparing preseason matchups...",
    "Almost ready for kickoff!"
];

let messageIndex = 0;
let messageInterval = null;

export function startLoadingMessages() {
    const messageEl = document.getElementById('loading-message');
    if (!messageEl) return;

    messageEl.textContent = loadingMessages[0];
    messageIndex = 1;

    messageInterval = setInterval(() => {
        messageEl.style.opacity = 0;

        setTimeout(() => {
            messageEl.textContent = loadingMessages[messageIndex];
            messageEl.style.opacity = 1;
            messageIndex = (messageIndex + 1) % loadingMessages.length;
        }, 600);
    }, 2500);
}

export function stopLoadingMessages() {
    if (messageInterval) {
        clearInterval(messageInterval);
        messageInterval = null;
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
export function renderDraftScreen(gameState, onPlayerSelect, currentSelectedId, sortColumn, sortDirection) {
    if (!gameState || !gameState.teams || !gameState.players || !gameState.draftOrder || !gameState.playerTeam) {
        console.error("renderDraftScreen called without valid gameState.");
        if (elements.draftHeader) elements.draftHeader.innerHTML = `<h2 class="text-3xl font-bold text-red-500">Draft Error: Invalid Game State</h2>`;
        return;
    }
    const { year, draftOrder, currentPick, playerTeam, players, teams } = gameState;
    const ROSTER_LIMIT = 10;

    // Only check if we've reached the end of the draft order
    if (currentPick >= draftOrder.length) {
        if (elements.draftHeader) elements.draftHeader.innerHTML = `<h2 class="text-3xl font-bold">Season ${year} Draft Complete</h2>`;
        if (elements.draftPlayerBtn) { elements.draftPlayerBtn.disabled = true; elements.draftPlayerBtn.textContent = 'Draft Complete'; }
        renderSelectedPlayerCard(null, gameState);
        updateSelectedPlayerRow(null);
        if (elements.draftPoolTbody) elements.draftPoolTbody.innerHTML = `<tr><td colspan="15" class="p-4 text-center text-gray-500">Draft Complete.</td></tr>`;
        return;
    }

    const pickingTeam = draftOrder[currentPick];
    if (!pickingTeam) {
        console.error(`Draft Error: No valid team found at current pick index (${currentPick}).`);
        if (elements.draftHeader) elements.draftHeader.innerHTML = `<h2 class="text-3xl font-bold text-red-500">Draft Error Occurred</h2>`;
        return;
    }

    // Check if current team can still draft
    const currentTeamRosterSize = pickingTeam.roster?.length || 0;
    const playerCanPick = pickingTeam.id === playerTeam.id && currentTeamRosterSize < ROSTER_LIMIT;

    // Update header with detailed pick information
    if (elements.draftYear) elements.draftYear.textContent = year;
    if (elements.draftPickNumber) elements.draftPickNumber.textContent = `${currentPick + 1} (${currentTeamRosterSize}/${ROSTER_LIMIT} players)`;
    if (elements.draftPickingTeam) elements.draftPickingTeam.textContent = pickingTeam.name || 'Unknown Team';

    renderDraftPool(gameState, onPlayerSelect, sortColumn, sortDirection);
    renderPlayerRoster(gameState.playerTeam);
    updateDraftSortIndicators(sortColumn, sortDirection); // <<< Add this call

    if (elements.draftPlayerBtn) {
        elements.draftPlayerBtn.disabled = !playerCanPick || currentSelectedId === null;
        elements.draftPlayerBtn.textContent = playerCanPick ? 'Draft Player' : `Waiting for ${pickingTeam.name || 'AI'}...`;
    }
}

/**
 * Renders the draft pool table with scouted info.
 */
export function renderDraftPool(gameState, onPlayerSelect, sortColumn, sortDirection, positionOverallWeights) {
    if (!elements.draftPoolTbody || !gameState || !gameState.players || !gameState.playerTeam?.roster) {
        console.error("Cannot render draft pool: Missing elements or invalid game state/roster.");
        if (elements.draftPoolTbody) elements.draftPoolTbody.innerHTML = `<tr><td colspan="18" class="p-4 text-center text-red-500">Error loading players.</td></tr>`;
        return;
    }

    const undraftedPlayers = gameState.players.filter(p => p && !p.teamId);
    const searchTerm = elements.draftSearch?.value.toLowerCase() || '';
    const posFilter = elements.draftFilterPos?.value || '';


    let filteredPlayers = undraftedPlayers.filter(p =>
        p.name.toLowerCase().includes(searchTerm) &&
        (!posFilter || p.favoriteOffensivePosition === posFilter || p.favoriteDefensivePosition === posFilter)
    );

    // --- NEW SORT LOGIC ---
    const potentialOrder = { 'A': 5, 'B': 4, 'C': 3, 'D': 2, 'F': 1 };

    const sortPlayer = (a, b, key, category = null) => {
        const valA = category ? (a?.attributes?.[category]?.[key] || 0) : (a?.[key] || 0);
        const valB = category ? (b?.attributes?.[category]?.[key] || 0) : (b?.[key] || 0);
        return sortDirection === 'asc' ? valA - valB : valB - valA;
    };

    switch (sortColumn) {
        case 'name':
            filteredPlayers.sort((a, b) => sortDirection === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name));
            break;
        case 'age':
            filteredPlayers.sort((a, b) => sortPlayer(a, b, 'age'));
            break;
        case 'position':
            // This is a bit arbitrary, but sorts by one of the pref positions
            filteredPlayers.sort((a, b) => {
                const posA = a.favoriteOffensivePosition || a.favoriteDefensivePosition;
                const posB = b.favoriteOffensivePosition || b.favoriteDefensivePosition;
                return sortDirection === 'asc' ? posA.localeCompare(posB) : posB.localeCompare(posA);
            });
            break;
        case 'height':
            filteredPlayers.sort((a, b) => sortPlayer(a, b, 'height', 'physical'));
            break;
        case 'weight':
            filteredPlayers.sort((a, b) => sortPlayer(a, b, 'weight', 'physical'));
            break;
        case 'speed':
            filteredPlayers.sort((a, b) => sortPlayer(a, b, 'speed', 'physical'));
            break;
        case 'strength':
            filteredPlayers.sort((a, b) => sortPlayer(a, b, 'strength', 'physical'));
            break;
        case 'agility':
            filteredPlayers.sort((a, b) => sortPlayer(a, b, 'agility', 'physical'));
            break;
        case 'throwingAccuracy':
            filteredPlayers.sort((a, b) => sortPlayer(a, b, 'throwingAccuracy', 'technical'));
            break;
        case 'catchingHands':
            filteredPlayers.sort((a, b) => sortPlayer(a, b, 'catchingHands', 'technical'));
            break;
        case 'blocking':
            filteredPlayers.sort((a, b) => sortPlayer(a, b, 'blocking', 'technical'));
            break;
        case 'tackling':
            filteredPlayers.sort((a, b) => sortPlayer(a, b, 'tackling', 'technical'));
            break;
        case 'blockShedding':
            filteredPlayers.sort((a, b) => sortPlayer(a, b, 'blockShedding', 'technical'));
            break;
        case 'potential':
        default:
            filteredPlayers.sort((a, b) => {
                const valA = potentialOrder[a?.potential] || 0;
                const valB = potentialOrder[b?.potential] || 0;
                return sortDirection === 'asc' ? valA - valB : valB - valA;
            });
            break;
    }

    elements.draftPoolTbody.innerHTML = '';

    if (filteredPlayers.length === 0) {
        elements.draftPoolTbody.innerHTML = `<tr><td colspan="18" class="p-4 text-center text-gray-500">No players match filters.</td></tr>`;
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

        // Make sure this line starts and ends with BACKTICKS (`)
        row.innerHTML = `
            <td class="py-2 px-3 font-semibold">${scoutedPlayer.name ?? 'N/A'}</td>
            <td class="text-center py-2 px-3">${scoutedPlayer.age ?? '?'}</td>
            <td class="text-center py-2 px-3 font-medium">${scoutedPlayer.potential ?? '?'}</td>
            <td class="text-center py-2 px-3 ${relationshipInfo.color}" title="${relationshipInfo.name}">${relationshipInfo.name.substring(0, 4)}</td>
            <td class="text-center py-2 px-3 font-bold">${scoutedPlayer.estimatedPosition ?? '?'}</td>
            <td class="text-center py-2 px-3">${formatHeight(scoutedPlayer.attributes?.physical?.height) ?? '?'}</td>
            <td class="text-center py-2 px-3">${scoutedPlayer.attributes?.physical?.weight ?? '?'}</td>
            <td class="text-center py-2 px-3">${scoutedPlayer.attributes?.physical?.speed ?? '?'}</td>
            <td class="text-center py-2 px-3">${scoutedPlayer.attributes?.physical?.strength ?? '?'}</td>
            <td class="text-center py-2 px-3">${scoutedPlayer.attributes?.physical?.agility ?? '?'}</td>
            <td class="text-center py-2 px-3">${scoutedPlayer.attributes?.physical?.stamina ?? '?'}</td>
            <td class="text-center py-2 px-3">${scoutedPlayer.attributes?.mental?.playbookIQ ?? '?'}</td>
            <td class="text-center py-2 px-3">${scoutedPlayer.attributes?.mental?.toughness ?? '?'}</td>
            <td class="text-center py-2 px-3">${scoutedPlayer.attributes?.technical?.throwingAccuracy ?? '?'}</td>
            <td class="text-center py-2 px-3">${scoutedPlayer.attributes?.technical?.catchingHands ?? '?'}</td>
            <td class="text-center py-2 px-3">${scoutedPlayer.attributes?.technical?.blocking ?? '?'}</td>
            <td class="text-center py-2 px-3">${scoutedPlayer.attributes?.technical?.tackling ?? '?'}</td>
            <td class="text-center py-2 px-3">${scoutedPlayer.attributes?.technical?.blockShedding ?? '?'}</td>
        `; // <<< Make sure this closing backtick is present

        row.onclick = () => onPlayerSelect(scoutedPlayer.id);
        elements.draftPoolTbody.appendChild(row);
    });
}

export function updateDraftSortIndicators(sortColumn, sortDirection) {
    // Remove all indicators
    document.querySelectorAll('#draft-screen thead th .sort-indicator').forEach(span => {
        span.textContent = '';
    });

    // Add new indicator
    const headerCell = document.querySelector(`#draft-screen thead th[data-sort="${sortColumn}"] .sort-indicator`);
    if (headerCell) {
        headerCell.textContent = (sortDirection === 'desc') ? ' ▼' : ' ▲';
    }
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
            Age: ${scoutedPlayer.age ?? '?'} | H: ${formatHeight(scoutedPlayer.attributes?.physical?.height) ?? '?'} | W: ${scoutedPlayer.attributes?.physical?.weight ?? '?'} lbs
        </p>
        <p class="text-sm text-gray-600">
            Est. Position: <span class="font-bold">${scoutedPlayer.estimatedPosition ?? '?'}</span> | // <<< Add estimatedPosition
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
            const estimatedPos = estimateBestPosition(player, positionOverallWeights); // Recalculate based on known stats
            li.className = 'p-2';
            li.textContent = `${player.name} (${estimatedPos ?? '?'})`; // <<< Use estimate
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

    let summaryHtml = '<h5 class="font-bold text-sm mb-1">Team Starters</h5><div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">';

    // 1. Create a pool of players who can start
    //    (Not temporary and not injured)
    let availablePlayers = roster.filter(p =>
        p &&
        p.attributes &&
        p.status?.type !== 'temporary' &&
        p.status?.duration === 0
    );

    // 2. Loop through each position we need to fill
    Object.keys(positionOverallWeights).forEach(pos => {

        // 3. If no players are left in the pool, show N/A
        if (availablePlayers.length === 0) {
            summaryHtml += `<div class="flex justify-between"><span class="font-semibold">${pos}:</span><span class="font-bold text-gray-400">N/A</span></div>`;
            return;
        }

        // 4. Find the best player *in the available pool* for this position
        let bestPlayer = null;
        let bestOverall = -1;

        for (const player of availablePlayers) {
            const ovr = calculateOverall(player, pos);
            if (ovr > bestOverall) {
                bestOverall = ovr;
                bestPlayer = player;
            }
        }

        // 5. If we found a starter for this position...
        if (bestPlayer) {
            // ...add them to the HTML...
            summaryHtml += `<div class="flex justify-between" title="Starter: ${bestPlayer.name} (${bestOverall} Ovr)">
                              <span class="font-semibold">${pos}:</span>
                              <span class="font-bold">${bestOverall}</span>
                            </div>`;

            // 6. ...and REMOVE them from the pool so they can't start at another position.
            availablePlayers = availablePlayers.filter(p => p.id !== bestPlayer.id);

        } else {
            // Fallback in case no valid player was found (shouldn't happen if pool > 0)
            summaryHtml += `<div class="flex justify-between"><span class="font-semibold">${pos}:</span><span class="font-bold text-gray-400">N/A</span></div>`;
        }
    });

    summaryHtml += '</div>';
    elements.rosterSummary.innerHTML = summaryHtml;
}
/** Renders the main dashboard header and populates team filter. */
export function renderDashboard(gameState) {
    if (!gameState || !gameState.playerTeam || !gameState.teams) {
        console.error("renderDashboard: Invalid gameState provided.");
        if (elements.dashboardTeamName) elements.dashboardTeamName.textContent = "Error Loading";
        if (elements.dashboardRecord) elements.dashboardRecord.textContent = "";
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
    console.log(`Switching to tab: ${tabId}, Game state:`, gameState ? 'valid' : 'invalid');

    if (!elements.dashboardContent || !elements.dashboardTabs) {
        console.error("Dashboard elements missing.");
        return;
    }

    // Hide all panes first
    elements.dashboardContent.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
    elements.dashboardTabs.querySelectorAll('.tab-button').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
    });

    const contentPane = document.getElementById(`tab-content-${tabId}`);
    const tabButton = elements.dashboardTabs.querySelector(`[data-tab="${tabId}"]`);

    if (!contentPane) {
        console.error(`Content pane "tab-content-${tabId}" not found.`);
        return;
    }
    if (!tabButton) {
        console.error(`Tab button for "${tabId}" not found.`);
        return;
    }

    // Show the selected tab
    contentPane.classList.remove('hidden');
    tabButton.classList.add('active');
    tabButton.setAttribute('aria-selected', 'true');

    if (!gameState) {
        console.warn(`switchTab called for "${tabId}" without valid gameState.`);
        contentPane.innerHTML = '<p class="text-red-500">Error: Game state not available.</p>';
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
                if (contentPane) contentPane.innerHTML = `<p>Content for tab "${tabId}" not implemented.</p>`;
        }
    } catch (error) {
        console.error(`Error rendering tab "${tabId}":`, error);
        if (contentPane) contentPane.innerHTML = `<p class="text-red-500">Error rendering ${tabId} content. Check console.</p>`;
    }

    if (tabId === 'messages' && Array.isArray(gameState.messages)) {
        updateMessagesNotification(gameState.messages, true);
    }
}

/** Renders the 'My Team' tab content (roster table). */
function renderMyTeamTab(gameState) {
    if (!elements.myTeamRoster || !gameState?.playerTeam?.roster || !Array.isArray(gameState.playerTeam.roster)) {
        console.error("Cannot render My Team tab: Missing elements or invalid roster data.");
        if (elements.myTeamRoster) elements.myTeamRoster.innerHTML = '<p class="text-red-500">Error loading roster data.</p>';
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
        ${physicalAttrs.map(h => `<th scope="col" class="py-2 px-3 uppercase">${h.slice(0, 3)}</th>`).join('')}
        ${mentalAttrs.map(h => `<th scope="col" class="py-2 px-3 uppercase">${h.slice(0, 3)}</th>`).join('')}
        ${technicalAttrs.map(h => `<th scope="col" class="py-2 px-3 uppercase">${h.slice(0, 3)}</th>`).join('')}
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
                const displayValue = attrName === 'height' ? formatHeight(val) : (val ?? '?');

                // FIX: Change 'val' to 'displayValue' here
                return `<td class="text-center py-2 px-3${breakthroughClass}" title="${attrName}">${displayValue}</td>`;
            };

            physicalAttrs.forEach(attr => tableHtml += renderAttr(p.attributes.physical?.[attr], attr));
            mentalAttrs.forEach(attr => tableHtml += renderAttr(p.attributes.mental?.[attr], attr));
            technicalAttrs.forEach(attr => tableHtml += renderAttr(p.attributes.technical?.[attr], attr));

            tableHtml += `</tr>`;
        });
    }
    elements.myTeamRoster.innerHTML = tableHtml + `</tbody></table></div>`;
}

/**
 * NEW HELPER FUNCTION
 * Gets the correct group container ID for a given position slot.
 * @param {string} positionSlot - The slot name (e.g., "QB1", "WR1", "DL1").
 * @param {string} side - 'offense' or 'defense'.
 * @returns {string|null} The DOM ID of the container, or null if not found.
 */
function getSlotContainerId(positionSlot, side) {
    // Get the base position (e.g., "WR1" -> "WR")
    const basePosition = positionSlot.replace(/\d/g, '');

    if (side === 'offense') {
        switch (basePosition) {
            case 'QB':
                return 'offense-qb-slots';
            case 'WR':
            case 'TE': // Receivers and TEs go in the same group
                return 'offense-receiver-slots';
            case 'RB':
            case 'FB': // Running backs and Fullbacks go in the same group
                return 'offense-back-slots';
            case 'OL':
                return 'offense-line-slots';
            default:
                console.warn(`Unknown offensive slot container for: ${positionSlot}`);
                return null;
        }
    } else if (side === 'defense') {
        switch (basePosition) {
            case 'DL':
                return 'defense-line-slots';
            case 'LB':
                return 'defense-lb-slots';
            case 'DB': // All defensive backs (CB, S) go in this group
                return 'defense-db-slots';
            default:
                console.warn(`Unknown defensive slot container for: ${positionSlot}`);
                return null;
        }
    }
    return null;
}


/** Renders the 'Depth Chart' tab and its sub-components. */
function renderDepthChartTab(gameState) {
    if (!gameState || !gameState.playerTeam || !gameState.playerTeam.roster || !gameState.playerTeam.formations || !gameState.playerTeam.depthChart) {
        console.error("Cannot render depth chart: Invalid game state.");
        // Clear all panes just in case
        if (elements.positionalOverallsContainer) elements.positionalOverallsContainer.innerHTML = '<p class="text-red-500">Error loading depth chart data.</p>';
        if (elements.offenseDepthChartPane) elements.offenseDepthChartPane.innerHTML = '<p class="text-red-500">Error loading offense data.</p>';
        if (elements.defenseDepthChartPane) elements.defenseDepthChartPane.innerHTML = '<p class="text-red-500">Error loading defense data.</p>';
        return;
    }
    const permanentRoster = gameState.playerTeam.roster.filter(p => p && p.status?.type !== 'temporary');

    // These functions are still correct
    renderPositionalOveralls(permanentRoster);
    renderFormationDropdown('offense', Object.values(offenseFormations), gameState.playerTeam.formations.offense);
    renderFormationDropdown('defense', Object.values(defenseFormations), gameState.playerTeam.formations.defense);

    // Call the new side-rendering functions
    renderDepthChartSide('offense', gameState);
    renderDepthChartSide('defense', gameState);
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
function renderDepthChartSide(side, gameState) {
    // Get the roster container for this side (e.g., 'offense-depth-chart-roster')
    const rosterContainer = elements[`${side}DepthChartRoster`];

    if (!rosterContainer || !gameState?.playerTeam?.roster || !gameState?.playerTeam?.depthChart) {
        console.error(`Cannot render depth chart side "${side}": Missing elements or game state.`);
        if (rosterContainer) rosterContainer.innerHTML = '<p class="text-red-500">Error</p>';
        return;
    }

    const { roster, depthChart } = gameState.playerTeam;
    const currentChart = depthChart[side] || {};
    const slots = Object.keys(currentChart);

    // --- NEW LOGIC: Clear all grouped containers for this side ---
    const groupContainerIds = (side === 'offense')
        ? ['offense-qb-slots', 'offense-receiver-slots', 'offense-back-slots', 'offense-line-slots']
        : ['defense-line-slots', 'defense-lb-slots', 'defense-db-slots'];

    groupContainerIds.forEach(id => {
        const container = document.getElementById(id);
        if (container) {
            container.innerHTML = ''; // Clear the container
        } else {
            console.warn(`Depth chart group container #${id} not found in HTML.`);
        }
    });
    // --- END NEW LOGIC ---

    // Render each slot into its correct group
    slots.forEach(positionSlot => {
        // Find the specific container ID for this slot (e.g., "QB1" -> "offense-qb-slots")
        const containerId = getSlotContainerId(positionSlot, side);
        const containerElement = document.getElementById(containerId);

        if (containerElement) {
            // The existing renderSlot function is perfect for this!
            // We just tell it which player, chart, and *specific container* to use.
            renderSlot(positionSlot, roster, currentChart, containerElement, side);
        } else {
            console.warn(`No container found for slot ${positionSlot} (ID: ${containerId})`);
        }
    });

    // Find players who are not starting on this side
    const playersStartingOnThisSide = new Set(Object.values(currentChart).filter(Boolean));
    const availablePlayers = roster.filter(p => p && !playersStartingOnThisSide.has(p.id));

    // Render the available "bench" players
    renderAvailablePlayerList(availablePlayers, rosterContainer, side);
}

/** Helper to find a player's attribute value from any category. */
function getStat(player, attrKey) {
    if (!player || !player.attributes) return '-';
    if (attrKey === 'height') return formatHeight(player.attributes.physical?.height);
    if (attrKey === 'weight') return player.attributes.physical?.weight || '-';

    if (player.attributes.physical?.[attrKey] !== undefined) return player.attributes.physical[attrKey];
    if (player.attributes.mental?.[attrKey] !== undefined) return player.attributes.mental[attrKey];
    if (player.attributes.technical?.[attrKey] !== undefined) return player.attributes.technical[attrKey];

    return '-';
}

/** Renders a single depth chart slot. (NEW, CLEANER VERSION) */
function renderSlot(positionSlot, roster, chart, container, side) {
    const playerId = chart[positionSlot];
    const player = Array.isArray(roster) ? roster.find(p => p?.id === playerId) : null;
    const basePosition = positionSlot.replace(/\d/g, '');
    const overall = player ? calculateOverall(player, basePosition) : '---';
    const typeTag = player?.status?.type === 'temporary' ? '<span class="status-tag temporary">[T]</span>' : '';

    // --- 1. Get Key Attributes ---

    // These attributes will ALWAYS be shown
    const baseAttributes = [
        'height',
        'weight',
        'speed',
        'strength',
        'agility',
        'stamina',
        'playbookIQ'
    ];

    // These are the "skill" attributes
    const technicalKeys = ['throwingAccuracy', 'catchingHands', 'blocking', 'tackling', 'blockShedding'];

    // Get the important *technical* skills for this position
    const positionalAttributes = (positionOverallWeights && positionOverallWeights[basePosition])
        ? Object.keys(positionOverallWeights[basePosition])
            .filter(key => technicalKeys.includes(key)) // Only get skill keys
            .sort() // Sort them alphabetically
        : []; // Fallback

    // Combine the lists, removing any duplicates
    // (e.g., if 'playbookIQ' was in both, it won't be duplicated)
    const allAttributes = [...new Set([...baseAttributes, ...positionalAttributes])];

    // --- 2. Build Dynamic Stats HTML ---
    let statsHtml = '';

    for (const attr of allAttributes) {
        const value = getStat(player, attr);
        // Create an abbreviation for the title
        let abbr = attr.slice(0, 3).toUpperCase();
        if (attr === 'height') abbr = 'HGT';
        if (attr === 'weight') abbr = 'WGT';
        if (attr === 'playbookIQ') abbr = 'IQ';
        if (attr === 'throwingAccuracy') abbr = 'THR';
        if (attr === 'catchingHands') abbr = 'HND';
        if (attr === 'blockShedding') abbr = 'BSH';

        statsHtml += `<div class="text-center"><span class="font-semibold text-gray-500 text-xs" title="${attr}">${abbr}</span><p class="font-medium">${value}</p></div>`;
    }

    // --- 3. Build the final element ---
    const slotEl = document.createElement('div');
    slotEl.className = 'depth-chart-slot bg-gray-100 p-2 rounded flex items-center justify-between gap-4';
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

    // This new layout is 3 distinct parts, not one massive grid
    slotEl.innerHTML = `
        <div class="flex-shrink-0 w-1/3">
            <span class="font-bold block">${positionSlot}</span>
            <span class="text-sm font-medium truncate">${typeTag} ${player?.name ?? 'Empty'}</span>
        </div>

        <div class="flex-shrink-0 font-bold text-xl text-amber-600 px-4">
            ${overall}
        </div>

        <div class="flex-grow grid grid-flow-col auto-cols-fr gap-3 text-sm">
            ${statsHtml}
        </div>
    `;

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
        if (elements.scheduleList) elements.scheduleList.innerHTML = '<p class="text-red-500">Error loading schedule data.</p>';
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
                const result = isPastWeek ? (gameState.gameResults || []).find(r => r && r.homeTeam.id === g.home.id && r.awayTeam.id === g.away.id) : null;
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
        if (elements.standingsContainer) elements.standingsContainer.innerHTML = '<p class="text-red-500">Error loading standings data.</p>';
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
        if (elements.playerStatsContainer) elements.playerStatsContainer.innerHTML = '<p class="text-red-500">Error loading player stats.</p>';
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
        if (elements.hallOfFameList) elements.hallOfFameList.innerHTML = '<p class="text-red-500">Error loading Hall of Fame.</p>';
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
            devHtml += '</div></div>';
        });
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


// ui.js

/** Sets up event listener for depth chart sub-tabs (Offense/Defense/Overalls). */
export function setupDepthChartTabs() {
    if (!elements.depthChartSubTabs) { console.error("Depth chart tabs container missing."); return; }

    elements.depthChartSubTabs.addEventListener('click', e => {
        if (e.target.matches('.depth-chart-tab')) {
            const subTab = e.target.dataset.subTab;

            // 1. Update button active states
            elements.depthChartSubTabs.querySelectorAll('.depth-chart-tab').forEach(t => {
                const isSelected = t === e.target;
                t.classList.toggle('active', isSelected);
                t.setAttribute('aria-selected', isSelected.toString());
            });

            // --- 💡 FIX: Find all three panes ---
            const offensePane = document.getElementById('depth-chart-offense-pane');
            const defensePane = document.getElementById('depth-chart-defense-pane');
            const overallsPane = document.getElementById('positional-overalls-container'); // <-- The missing pane

            // --- 💡 FIX: Toggle all three panes correctly ---
            if (offensePane) offensePane.classList.toggle('hidden', subTab !== 'offense');
            if (defensePane) defensePane.classList.toggle('hidden', subTab !== 'defense');
            if (overallsPane) overallsPane.classList.toggle('hidden', subTab !== 'overalls'); // <-- The new logic
        }
    });
}
// ===================================
// --- Live Game Sim UI Logic ---
// ===================================

/**
 * Draws the state of a play (players, ball) onto the field canvas.
 * Uses a zoomed camera that follows the play action.
 * @param {object} frameData - A single frame from resolvePlay.visualizationFrames.
 */
export function drawFieldVisualization(frameData) {
    const ctx = elements.fieldCanvasCtx;
    const canvas = elements.fieldCanvas;
    if (!ctx || !canvas) return;

    // Create field gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#059669');   // Grass base color
    gradient.addColorStop(0.3, '#047857'); // Darker middle bands
    gradient.addColorStop(0.7, '#047857');
    gradient.addColorStop(1, '#059669');

    // Clear and fill with gradient
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw field texture (subtle noise pattern)
    ctx.save();
    ctx.globalAlpha = 0.05;
    for (let i = 0; i < canvas.width; i += 4) {
        for (let j = 0; j < canvas.height; j += 4) {
            if (Math.random() > 0.5) {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(i, j, 2, 2);
            }
        }
    }
    ctx.restore();

    // --- Camera Logic: Zoomable camera that keeps sidelines clamped and pans left/right only ---
    // Base scale that fits the full field width vertically
    const baseScale = canvas.height / FIELD_WIDTH;
    // Zoom multiplier: increase to make models larger; keep conservative default
    const ZOOM_MULTIPLIER = 1.0; // tweakable (1.0 = fit vertical exactly)
    const scale = baseScale * ZOOM_MULTIPLIER;
    const scaleX = scale;
    const scaleY = scale;

    // Find focal point along the field-length axis (y in world coords)
    let cameraFocusYField = (frameData && frameData.lineOfScrimmage) != null ? frameData.lineOfScrimmage : 60;
    if (frameData && frameData.ball) {
        if (frameData.ball.inAir) {
            cameraFocusYField = frameData.ball.y;
        } else {
            const ballCarrier = frameData.players?.find(p => p.isBallCarrier);
            if (ballCarrier) cameraFocusYField = ballCarrier.y;
        }
    }

    // Compute camera offset so the focusYField is horizontally centered.
    let cameraOffsetX = (canvas.width / 2) - (cameraFocusYField * scaleX);
    // If the scaled field length is wider than the canvas, allow negative translate (pan). Otherwise clamp to 0.
    const minOffsetX = Math.min(0, canvas.width - (FIELD_LENGTH * scaleX));
    const maxOffsetX = 0;
    cameraOffsetX = Math.max(minOffsetX, Math.min(maxOffsetX, cameraOffsetX));

    // Vertical offset: try to center on field sideline midpoint, but clamp so we never show beyond sidelines.
    let cameraOffsetY = (canvas.height / 2) - (CENTER_X * scaleY);
    const minOffsetY = Math.min(0, canvas.height - (FIELD_WIDTH * scaleY));
    const maxOffsetY = 0;
    cameraOffsetY = Math.max(minOffsetY, Math.min(maxOffsetY, cameraOffsetY));

    // Apply camera transform (we translate only; positions are multiplied by scaleX/scaleY elsewhere)
    ctx.save();
    ctx.translate(cameraOffsetX, cameraOffsetY);

    // Draw endzone areas with different shading
    ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.fillRect(0, 0, 10 * scaleX, FIELD_WIDTH * scaleY);
    ctx.fillRect(110 * scaleX, 0, 10 * scaleX, FIELD_WIDTH * scaleY);

    // Draw field markings with enhanced style
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.font = 'bold 14px "Inter"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Draw yard lines with enhanced visibility
    for (let y = 10; y <= 110; y += 10) {
        const drawX = y * scaleX;

        // Main yard lines (brighter)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(drawX, 0);
        ctx.lineTo(drawX, FIELD_WIDTH * scaleY);
        ctx.stroke();

        if (y > 10 && y < 110) {
            // Enhanced yard numbers with shadow effect
            const yardLineNum = y <= 60 ? y - 10 : 120 - y - 10;
            const numX = drawX;

            // Draw number shadows
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.fillText(yardLineNum.toString(), numX + 1, 16);
            ctx.fillText(yardLineNum.toString(), numX + 1, FIELD_WIDTH * scaleY - 14);

            // Draw numbers
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.fillText(yardLineNum.toString(), numX, 15);
            ctx.fillText(yardLineNum.toString(), numX, FIELD_WIDTH * scaleY - 15);
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

    // --- Draw LOS and First Down Lines ---
    if (frameData && frameData.lineOfScrimmage) {
        // Line of Scrimmage (Blue)
        const losX = frameData.lineOfScrimmage * scaleX;
        ctx.strokeStyle = '#3b82f6'; // Blue-500
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(losX, 0);
        ctx.lineTo(losX, canvas.height);
        ctx.stroke();

        // First Down Line (Yellow)
        if (frameData.firstDownY < FIELD_LENGTH - 10) { // Only draw if not in endzone
            const firstDownX = frameData.firstDownY * scaleX;
            ctx.strokeStyle = '#eab308'; // Yellow-500
            ctx.lineWidth = 3;
            ctx.setLineDash([8, 8]); // Make it dashed
            ctx.beginPath();
            ctx.moveTo(firstDownX, 0);
            ctx.lineTo(firstDownX, canvas.height);
            ctx.stroke();
            ctx.setLineDash([]); // Reset for other lines
        }
    }

    if (!frameData || !frameData.players) {
        ctx.restore(); // Don't forget to restore context
        return; // If no frame, just show empty field
    }

    // --- Draw Players (Enhanced) ---
    frameData.players.forEach(player => {
        if (player.x === undefined || player.y === undefined) return;

        // Calculate draw position with potential jiggle if engaged
        let jiggleX = 0;
        let jiggleY = 0;
        if (player.isEngaged) {
            const jiggleAmount = 1.5;
            jiggleX = (Math.random() - 0.5) * jiggleAmount;
            jiggleY = (Math.random() - 0.5) * jiggleAmount;
        }

        const drawX = player.y * scaleX + jiggleX;
        const drawY = player.x * scaleY + jiggleY;

        // Reduce engagement visuals to a subtle jiggle + soft halo (no bursts/ripples)
        if (player.isEngaged) {
            // Small soft halo so engaged players are still visible without being overbearing
            const gradient = ctx.createRadialGradient(drawX, drawY, 3, drawX, drawY, 10);
            gradient.addColorStop(0, 'rgba(255,255,255,0.12)');
            gradient.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(drawX, drawY, 10, 0, Math.PI * 2);
            ctx.fill();
        }

        if (player.stunnedTicks > 0) {
            // Create a pulsing effect based on time
            // This pulses between 0 (small) and 1 (large)
            const pulse = (Math.sin(Date.now() / 200) + 1) / 2;

            // The circle radius will pulse between 8px and 14px
            const pulseRadius = 8 + (pulse * 6);
            // The opacity will pulse between 0.5 and 0.9
            const pulseAlpha = 0.5 + (pulse * 0.4);

            ctx.save();
            ctx.beginPath();
            ctx.arc(drawX, drawY, pulseRadius, 0, Math.PI * 2);

            // Create a pulsing red glow
            const stunGradient = ctx.createRadialGradient(drawX, drawY, 3, drawX, drawY, pulseRadius);
            stunGradient.addColorStop(0, `rgba(220, 38, 38, ${pulseAlpha})`); // red-600 with pulsing alpha
            stunGradient.addColorStop(1, 'rgba(220, 38, 38, 0)'); // Fades to transparent

            ctx.fillStyle = stunGradient;
            ctx.fill();
            ctx.restore();
        }



        // Draw player body with 3D effect
        // Use the player's team color when available so the carrier keeps their team identity
        const playerColor = player.primaryColor || (player.isOffense ? '#3b82f6' : '#ef4444');

        // Body shadow
        ctx.beginPath();
        ctx.arc(drawX + 1, drawY + 1, 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fill();

        // Main body
        ctx.beginPath();
        ctx.arc(drawX, drawY, 8, 0, Math.PI * 2);
        ctx.fillStyle = playerColor;
        ctx.fill();

        // Highlight
        ctx.beginPath();
        ctx.arc(drawX - 2, drawY - 2, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fill();

        // Ball carrier ring indicator: small stroked ring so the carrier is easy to spot
        if (player.isBallCarrier) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(drawX, drawY, 12, 0, Math.PI * 2);
            ctx.lineWidth = 3;
            // Prefer a team secondary color for the ring if provided, else use amber
            ctx.strokeStyle = player.secondaryColor || 'rgba(251, 191, 36, 0.95)';
            ctx.stroke();
            ctx.restore();
        }

        // Draw movement indicator
        if (player.velocity && (Math.abs(player.velocity.x) > 0.1 || Math.abs(player.velocity.y) > 0.1)) {
            const speed = Math.sqrt(player.velocity.x ** 2 + player.velocity.y ** 2);
            const angle = Math.atan2(player.velocity.y, player.velocity.x);

            // Draw speed trail
            ctx.beginPath();
            ctx.moveTo(drawX, drawY);
            const trailLength = 10 + speed * 3;

            // Create gradient for trail
            const trailGradient = ctx.createLinearGradient(
                drawX, drawY,
                drawX + Math.cos(angle) * trailLength,
                drawY + Math.sin(angle) * trailLength
            );
            trailGradient.addColorStop(0, playerColor);
            trailGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

            ctx.lineTo(
                drawX - Math.cos(angle) * trailLength,
                drawY - Math.sin(angle) * trailLength
            );
            ctx.strokeStyle = trailGradient;
            ctx.lineWidth = 3;
            ctx.stroke();
        }

        // Draw player number and position (derive display-only values locally so we don't mutate physics state)
        // Prefer the slot assigned in the play (depth-chart placement) when available.
        const displayPosition = (player.slot ? player.slot.replace(/\d+/g, '') : '') || player.position || player.favoriteOffensivePosition || player.favoriteDefensivePosition || (typeof estimateBestPosition === 'function' ? estimateBestPosition(player) : '') || '';

        let displayNumber;
        if (player.number != null && player.number !== '') {
            displayNumber = player.number.toString();
        } else {
            // Derive a stable, non-colliding number from player name/id for display only
            const seed = (player.name || player.id || 'player').toString();
            let sum = 0;
            for (let i = 0; i < seed.length; i++) sum += seed.charCodeAt(i);
            displayNumber = ((sum % 99) + 1).toString();
        }

        // Position above number (if available)
        if (displayPosition) {
            ctx.font = '9px "Inter"';
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(displayPosition, drawX + 1, drawY - 11);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.fillText(displayPosition, drawX, drawY - 12);
        }

        // Number shadow and number (rendered from derived displayNumber, does not write back to player object)
        ctx.font = 'bold 11px "Inter"';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(displayNumber, drawX + 1, drawY + 1);

        ctx.fillStyle = '#ffffff';
        ctx.fillText(displayNumber, drawX, drawY);
    });

    // Draw ball only if it's in the air or this frame is the snap frame
    if (frameData.ball && (frameData.ball.inAir || frameData.isSnap || frameData.ball.isLoose)) {
        const drawX = frameData.ball.y * scaleX;
        const drawY = frameData.ball.x * scaleY;

        // Enhanced ball visualization (same as before, but only when visible)
        const ballX = drawX;
        const ballY = drawY;

        if (frameData.ball.inAir) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(ballX + 2, ballY + 2, 6, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
            ctx.fill();
            ctx.restore();

            const glowGradient = ctx.createRadialGradient(
                ballX, ballY, 2,
                ballX, ballY, 12
            );
            glowGradient.addColorStop(0, 'rgba(146, 64, 14, 0.6)');
            glowGradient.addColorStop(1, 'rgba(146, 64, 14, 0)');

            ctx.beginPath();
            ctx.arc(ballX, ballY, 12, 0, Math.PI * 2);
            ctx.fillStyle = glowGradient;
            ctx.fill();
        }

        // Ball shadow
        ctx.beginPath();
        ctx.arc(ballX + 1, ballY + 1, frameData.ball.inAir ? 5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fill();

        // Main ball
        ctx.beginPath();
        ctx.arc(ballX, ballY, frameData.ball.inAir ? 5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = '#92400e';
        ctx.fill();

        // Ball highlight
        ctx.beginPath();
        ctx.arc(ballX - 1, ballY - 1, frameData.ball.inAir ? 2 : 1, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fill();

        // Draw enhanced trajectory for passes
        if (frameData.ball.inAir && frameData.ball.velocity) {
            const angle = Math.atan2(frameData.ball.velocity.y, frameData.ball.velocity.x);
            const speed = Math.sqrt(frameData.ball.velocity.x ** 2 + frameData.ball.velocity.y ** 2);
            const trailLength = 20 + speed * 4;

            // Draw trail shadow
            ctx.beginPath();
            ctx.moveTo(ballX + 1, ballY + 1);
            ctx.lineTo(
                ballX + Math.cos(angle) * trailLength + 1,
                ballY + Math.sin(angle) * trailLength + 1
            );
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
            ctx.lineWidth = 3;
            ctx.stroke();

            // Draw main trail with gradient
            const trailGradient = ctx.createLinearGradient(
                ballX, ballY,
                ballX + Math.cos(angle) * trailLength,
                ballY + Math.sin(angle) * trailLength
            );
            trailGradient.addColorStop(0, '#92400e');
            trailGradient.addColorStop(1, 'rgba(146, 64, 14, 0)');

            ctx.beginPath();
            ctx.moveTo(ballX, ballY);
            ctx.lineTo(
                ballX + Math.cos(angle) * trailLength,
                ballY + Math.sin(angle) * trailLength
            );
            ctx.strokeStyle = trailGradient;
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    // Restore context to remove camera transform
    ctx.restore();
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

        // Filters and sorts roster to find a specific stat leader
        const findTopStat = (statName) => team.roster
            .filter(p => p && p.gameStats && p.gameStats[statName] > 0)
            .sort((a, b) => (b.gameStats[statName] || 0) - (a.gameStats[statName] || 0))[0];

        // --- OFFENSIVE LEADERS ---
        const qb = team.roster.find(p => p && p.gameStats && p.gameStats.passAttempts > 0); // Find QB by attempts
        const leadingRusher = findTopStat('rushYards');
        const leadingReceiver = findTopStat('recYards');
        const offensivePlayersLogged = new Set();

        let html = `<h5 class="text-lg font-semibold text-amber-400 mb-1 border-b border-gray-600 pb-1">${team.name}</h5>`;

        // 1. QB Stats
        if (qb) {
            html += `<p>${qb.name} (QB): <strong>${qb.gameStats.passCompletions || 0}/${qb.gameStats.passAttempts || 0}, ${qb.gameStats.passYards || 0} Yds, ${qb.gameStats.touchdowns || 0} TD, ${qb.gameStats.interceptionsThrown || 0} INT</strong></p>`;
            offensivePlayersLogged.add(qb.id);
        }

        // 2. Running Leader
        if (leadingRusher && !offensivePlayersLogged.has(leadingRusher.id)) {
            html += `<p>${leadingRusher.name} (Run): <strong>${leadingRusher.gameStats.rushYards || 0} Yds, ${leadingRusher.gameStats.touchdowns || 0} TD</strong></p>`;
            offensivePlayersLogged.add(leadingRusher.id);
        }

        // 3. Receiving Leader
        if (leadingReceiver && !offensivePlayersLogged.has(leadingReceiver.id)) {
            html += `<p>${leadingReceiver.name} (Rec): <strong>${leadingReceiver.gameStats.receptions || 0}-${leadingReceiver.gameStats.recYards || 0} Yds, ${leadingReceiver.gameStats.touchdowns || 0} TD</strong></p>`;
            offensivePlayersLogged.add(leadingReceiver.id);
        }

        // --- DEFENSIVE LEADERS ---
        const defensiveLeaders = {};

        // Aggregate all defensive stats into a single map based on player ID
        team.roster.forEach(p => {
            if (p?.gameStats && (p.gameStats.tackles > 0 || p.gameStats.sacks > 0 || p.gameStats.interceptions > 0)) {
                if (offensivePlayersLogged.has(p.id)) return; // Skip if already logged as an offensive leader

                defensiveLeaders[p.id] = {
                    name: p.name,
                    tkl: p.gameStats.tackles || 0,
                    sacks: p.gameStats.sacks || 0,
                    ints: p.gameStats.interceptions || 0
                };
            }
        });

        // Convert map to array and sort by importance (Tkl, then Sack, then INT)
        const sortedDefenders = Object.values(defensiveLeaders).sort((a, b) =>
            (b.tkl - a.tkl) || (b.sacks - a.sacks) || (b.ints - a.ints)
        ).slice(0, 3); // Limit to top 3 unique defensive players

        // 4. Print Top Defensive Players
        sortedDefenders.forEach(d => {
            let defHtml = `<p>${d.name} (Def): <strong>${d.tkl} Tkl`;
            if (d.sacks > 0) defHtml += `, ${d.sacks} Sack${d.sacks > 1 ? 's' : ''}`;
            if (d.ints > 0) defHtml += `, ${d.ints} INT${d.ints > 1 ? 's' : ''}`;
            defHtml += `</strong></p>`;
            html += defHtml;
        });

        // 5. Final Check
        if (offensivePlayersLogged.size === 0 && sortedDefenders.length === 0) {
            html += '<p class="text-gray-400">No significant stats recorded.</p>';
        }

        return html;
    };

    elements.simStatsAway.innerHTML = generateTeamStatsHtml(awayTeam);
    elements.simStatsHome.innerHTML = generateTeamStatsHtml(homeTeam);
}

/**
 * Renders the players / substitution panel for the player's team during live sim.
 */
/**
 * Renders the players / substitution panel for the player's team during live sim.
 * Reads live fatigue data from the provided frame.
 */
function renderSimPlayers(frame) {
    // Helper to find the correct team object (home or away) from the live game result
    const findTeamInResult = (playerTeamId) => {
        if (!currentLiveGameResult) return null;
        if (currentLiveGameResult.homeTeam?.id === playerTeamId) return currentLiveGameResult.homeTeam;
        if (currentLiveGameResult.awayTeam?.id === playerTeamId) return currentLiveGameResult.awayTeam;
        return null; // Player's team not in this game
    };

    try {
        if (!elements.simPlayersList || !currentLiveGameResult) {
            // Don't render if element is missing or game isn't running
            return;
        }

        // 1. FIX: Get the player's team from the LIVE game result, not global state
        const gs = getGameState(); // Still need this for the player's team ID
        const playerTeamId = gs?.playerTeam?.id;
        const team = findTeamInResult(playerTeamId);

        if (!team || !playerTeamId) {
            elements.simPlayersList.innerHTML = '<p class="text-gray-400">No team data available for this game.</p>';
            return;
        }
        const roster = team.roster || [];
        const depth = team.depthChart || {};

        // 2. Create a Map of current fatigue values from the frame
        const fatigueMap = new Map();
        if (frame && frame.players) {
            frame.players.forEach(pState => {
                if (pState.teamId === team.id) {
                    // Use 'pState.fatigue' which we added in Step 1
                    fatigueMap.set(pState.id, pState.fatigue);
                }
            });
        }

        // Build list grouped by starters and bench
        const starterIds = new Set();
        Object.keys(depth).forEach(side => {
            const chart = depth[side] || {};
            Object.values(chart).forEach(id => { if (id) starterIds.add(id); });
        });
        const starters = roster.filter(p => p && starterIds.has(p.id));
        const bench = roster.filter(p => p && !starterIds.has(p.id));

        const buildRow = (p, isStarter) => {
            const stamina = p.attributes?.physical?.stamina || 50;

            // 3. FIX: Get fatigue from the frame map if available,
            //    otherwise default to 0 (for benched players not in the frame).
            //    Do not use p.fatigue, which is the FINAL fatigue from the result object.
            const currentFatigue = fatigueMap.get(p.id) || 0;

            const fatigue = Math.max(0, Math.min(100, Math.round(currentFatigue)));

            const energyPct = Math.max(0, Math.round(100 - (fatigue / Math.max(1, stamina)) * 100));
            const statusText = p.status?.type ? `${p.status.type}${p.status.duration ? ' (' + p.status.duration + ')' : ''}` : 'healthy';

            return `
                <div class="flex items-center justify-between p-2 border-b border-gray-600">
                    <div class="flex items-center gap-3">
                        <div class="w-36">
                            <div class="text-sm font-semibold">${p.name}</div>
                            <div class="text-xs text-gray-300">#${p.number || '—'} • ${p.slot || '-'}</div>
                        </div>
                        <div class="w-40">
                            <div class="relative h-3 bg-gray-600 rounded">
                                <div style="width:${energyPct}%" class="absolute left-0 top-0 h-3 bg-amber-400 rounded"></div>
                            </div>
                            <div class="text-xs text-gray-300">Energy: ${energyPct}% • Fatigue: ${fatigue.toFixed(1)}</div>
                        </div>
                        <div class="text-xs text-gray-300 w-28">Status: ${statusText}</div>
                    </div>
                    <div>
                        ${isStarter ? `<button data-player-id="${p.id}" class="sub-out-btn btn bg-red-600 hover:bg-red-700 text-white text-xs py-1 px-2 rounded">Sub Out</button>` : `<button data-player-id="${p.id}" class="sub-in-btn btn bg-green-600 hover:bg-green-700 text-white text-xs py-1 px-2 rounded">Sub In</button>`}
                    </div>
                </div>
            `;
        };

        let html = '';
        if (starters.length > 0) {
            html += '<div class="mb-2"><div class="text-sm font-semibold text-amber-300 mb-1">Starters</div>';
            starters.forEach(s => { html += buildRow(s, true); });
            html += '</div>';
        }
        html += '<div><div class="text-sm font-semibold text-amber-300 mb-1">Bench</div>';
        bench.forEach(b => { html += buildRow(b, false); });
        html += '</div>';

        elements.simPlayersList.innerHTML = html;

        // Attach handlers
        elements.simPlayersList.querySelectorAll('.sub-in-btn').forEach(btn => {
            btn.onclick = (e) => {
                const inId = parseInt(btn.dataset.playerId, 10);
                // Build select of available starter slots (with side + slot)
                const slotOptions = [];
                Object.keys(depth).forEach(side => {
                    const chart = depth[side] || {};
                    Object.keys(chart).forEach(slot => {
                        const occupantId = chart[slot];
                        const occupant = roster.find(p => p && p.id === occupantId);
                        slotOptions.push({ value: `${side}|${slot}`, label: `${side.toUpperCase()} ${slot} (${occupant ? occupant.name : 'Vacant'})` });
                    });
                });
                const selectHtml = `<select id="_sub_slot_select" class="w-full p-2 bg-white text-black">${slotOptions.map(s => `<option value="${s.value}">${s.label}</option>`).join('')}</select>`;
                showModal('Select Slot to Sub Into', selectHtml, () => {
                    const chosen = document.getElementById('_sub_slot_select')?.value;
                    if (!chosen) return;
                    const [side, slot] = chosen.split('|');
                    const outId = team.depthChart?.[side]?.[slot];

                    // 4. FIX: Use the imported substitutePlayers function
                    const result = substitutePlayers(team.id, outId, inId);

                    if (!result.success) {
                        showModal('Sub Failed', `<p>${result.message}</p>`, null, 'OK');
                    } else {
                        renderSimPlayers(frame); // Re-render with current frame
                    }
                }, 'Confirm');
            };
        });

        elements.simPlayersList.querySelectorAll('.sub-out-btn').forEach(btn => {
            btn.onclick = (e) => {
                const outId = parseInt(btn.dataset.playerId, 10);
                // Choose incoming bench player to swap with
                const benchPlayers = roster.filter(p => p && !starterIds.has(p.id));
                if (benchPlayers.length === 0) {
                    showModal('No Bench', '<p>No bench players available to sub in.</p>', null, 'OK');
                    return;
                }
                const options = benchPlayers.map(b => `<option value="${b.id}">${b.name} (#${b.number || '—'})</option>`).join('');
                const selectHtml = `<select id="_sub_in_select" class="w-full p-2 bg-white text-black">${options}</select>`;
                showModal('Select Bench Player to Sub In', selectHtml, () => {
                    const inId = parseInt(document.getElementById('_sub_in_select')?.value, 10);
                    if (!inId) return;

                    // 5. FIX: Use the imported substitutePlayers function
                    const result = substitutePlayers(team.id, outId, inId);

                    if (!result.success) {
                        showModal('Sub Failed', `<p>${result.message}</p>`, null, 'OK');
                    } else {
                        renderSimPlayers(frame); // Re-render with current frame
                    }
                }, 'Confirm');
            };
        });

    } catch (err) {
        console.error('renderSimPlayers failed:', err);
    }
}

/**
 * Executes a single frame/tick of the live game simulation.
 * This is the core loop called by setInterval.
 */
/**
 * Executes a single frame/tick of the live game simulation.
 * This is the core loop called by setInterval.
 */
function runLiveGameTick() {
    // --- 1. End Condition Check ---
    if (!currentLiveGameResult || !currentLiveGameResult.visualizationFrames || liveGameCurrentIndex >= currentLiveGameResult.visualizationFrames.length) {
        clearInterval(liveGameInterval);
        liveGameInterval = null;

        // Use final result for absolute accuracy
        if (currentLiveGameResult) {
            elements.simAwayScore.textContent = currentLiveGameResult.awayScore;
            elements.simHomeScore.textContent = currentLiveGameResult.homeScore;
        }
        elements.simGameDown.textContent = "FINAL";
        elements.simPossession.textContent = "";
        drawFieldVisualization(null); // Clear field

        const finalResult = currentLiveGameResult; // Store before nulling
        currentLiveGameResult = null; // Clear game data

        if (liveGameCallback) {
            const cb = liveGameCallback;
            liveGameCallback = null;
            cb(finalResult); // Pass final result to callback
        }
        return;
    }

    // --- 2. Process Current Frame ---
    const allFrames = currentLiveGameResult.visualizationFrames;
    const allLogs = currentLiveGameResult.gameLog;
    const ticker = elements.simPlayLog;
    const frame = allFrames[liveGameCurrentIndex];

    if (!frame) {
        console.warn(`Skipping potentially empty frame at index ${liveGameCurrentIndex}`);
        liveGameCurrentIndex++;
        return;
    }

    let playHasEnded = false; // --- 🛠️ NEW: Flag to track end of play

    // --- 3. Sync Log Entries & Update State (The Combined Step) ---
    if (ticker && frame.logIndex > liveGameLogIndex) {
        for (let i = liveGameLogIndex; i < frame.logIndex; i++) {
            const playLogEntry = allLogs[i];
            if (!playLogEntry) continue;

            const p = document.createElement('p');
            let styleClass = '';
            let descriptiveText = playLogEntry;

            // --- 🛠️ COMBINED LOGIC: Parse log AND set styles ---
            try {
                if (playLogEntry.includes('Conversion Attempt')) {
                    liveGameIsConversion = true; // Set the flag
                    styleClass = 'font-bold text-amber-400 mt-2';
                    descriptiveText = `🏈 ${playLogEntry} 🏈`;
                }

                else if (playLogEntry.startsWith('-- Drive')) {
                    liveGameBallOn = 20; liveGameDown = 1; liveGameToGo = 10; liveGameDriveActive = true;
                    const driveMatch = playLogEntry.match(/(Drive \d+ \(H\d+\))/);
                    liveGamePossessionName = playLogEntry.includes(currentLiveGameResult.homeTeam.name) ? currentLiveGameResult.homeTeam.name : currentLiveGameResult.awayTeam.name;
                    if (driveMatch) liveGameDriveText = driveMatch[0];

                    styleClass = 'font-bold text-amber-400 mt-2';
                    descriptiveText = `🏈 ${playLogEntry.replace('-- Drive', 'New Drive:')} 🏈`;

                } else if (playLogEntry.startsWith('==== HALFTIME') || playLogEntry.startsWith('==== FINAL')) {
                    liveGameDriveActive = false;
                    styleClass = 'font-bold text-amber-400 mt-2 text-lg';
                    descriptiveText = `⏱️ ${playLogEntry} ⏱️`;
                    playHasEnded = true; // Treat halftime/final as a "pause"

                } else if (playLogEntry.startsWith('➡️ First down')) {
                    liveGameDown = 1;
                    const goalMatch = playLogEntry.match(/Goal at the (\d+)/);
                    const yardLineMatch = playLogEntry.match(/at the (own|opponent) (\d+)/);
                    if (yardLineMatch) {
                        const side = yardLineMatch[1]; const line = parseInt(yardLineMatch[2], 10);
                        liveGameBallOn = (side === 'own') ? line : 100 - line;
                    }
                    liveGameToGo = goalMatch ? parseInt(goalMatch[1], 10) : Math.min(10, 100 - liveGameBallOn);
                    if (liveGameToGo <= 0) liveGameToGo = 1; // Goal line fix

                    styleClass = 'text-yellow-300 font-semibold';
                    descriptiveText = playLogEntry;
                    playHasEnded = true; // A first down pauses the game

                } else if (playLogEntry.match(/gain of (-?\d+\.?\d*)|loss of (\d+\.?\d*)/)) {
                    const yardsMatch = playLogEntry.match(/gain of (-?\d+\.?\d*)|loss of (\d+\.?\d*)/);
                    let yards = 0;
                    if (yardsMatch) { yards = parseFloat(yardsMatch[1] || `-${yardsMatch[2]}`); }

                    if (liveGameDriveActive) {
                        liveGameBallOn += yards;
                        liveGameToGo -= yards;
                        liveGameBallOn = Math.round(Math.max(0, Math.min(100, liveGameBallOn)));
                        liveGameToGo = Math.round(liveGameToGo);
                        if (liveGameToGo > 0) liveGameDown++;
                    }

                    const fieldSide = liveGameBallOn <= 50 ? "own" : "opponent";
                    const yardLine = liveGameBallOn <= 50 ? liveGameBallOn : 100 - liveGameBallOn;
                    descriptiveText = `${playLogEntry} Ball at the ${fieldSide} ${yardLine}.`;
                    if (playLogEntry.startsWith('💥 SACK')) {
                        styleClass = 'text-orange-400';
                    } else if (yards >= 10) {
                        descriptiveText = `💨 ${playLogEntry}! Great play! Ball at the ${fieldSide} ${yardLine}.`;
                        styleClass = 'text-cyan-300';
                    } else if (yards > 0) {
                        styleClass = 'text-cyan-300';
                    }
                    playHasEnded = true; // A tackle/run ends the play

                } else if (playLogEntry.includes('incomplete') || playLogEntry.includes('INCOMPLETE') || playLogEntry.startsWith('❌') || playLogEntry.startsWith('🚫') || playLogEntry.startsWith('‹‹')) {
                    if (liveGameDriveActive) liveGameDown++;
                    styleClass = 'font-semibold text-red-400';
                    descriptiveText = playLogEntry;
                    playHasEnded = true; // An incompletion ends the play

                } else if (playLogEntry.startsWith('🎉 TOUCHDOWN')) {
                    if (!liveGameIsConversion) { // Only add 6 if it's NOT a conversion
                        if (liveGamePossessionName === currentLiveGameResult.homeTeam.name) {
                            liveGameCurrentHomeScore += 6;
                        } else {
                            liveGameCurrentAwayScore += 6;
                        }
                    }
                    liveGameBallOn = 100; liveGameDriveActive = false;
                    styleClass = 'font-semibold text-green-400';
                    descriptiveText = playLogEntry;
                    playHasEnded = true; // A TD ends the play

                } else if (playLogEntry.includes('conversion GOOD!')) {
                    const points = playLogEntry.includes('2-point') ? 2 : 1;
                    if (liveGamePossessionName === currentLiveGameResult.homeTeam.name) liveGameCurrentHomeScore += points; else liveGameCurrentAwayScore += points;
                    liveGameIsConversion = false;
                    liveGameDriveActive = false;

                    styleClass = 'font-semibold text-green-400';
                    descriptiveText = `✅ ${playLogEntry} Points are good!`;
                    playHasEnded = true; // Conversion ends

                } else if (playLogEntry.includes('Conversion FAILED!')) {
                    liveGameIsConversion = false;
                    liveGameDriveActive = false;
                    styleClass = 'font-semibold text-red-400';
                    descriptiveText = `❌ ${playLogEntry} No good!`;
                    playHasEnded = true; // Conversion ends

                } else if (playLogEntry.startsWith('Turnover') || playLogEntry.startsWith('❗ INTERCEPTION') || playLogEntry.startsWith('❗ FUMBLE')) {
                    liveGameDriveActive = false;
                    const yardLineMatch = playLogEntry.match(/at the (own|opponent) (\d+)/);
                    if (yardLineMatch) {
                        const side = yardLineMatch[1]; const line = parseInt(yardLineMatch[2], 10);
                        liveGameBallOn = (side === 'own') ? line : 100 - line;
                    }
                    styleClass = 'font-semibold text-red-400';
                    descriptiveText = playLogEntry;
                    playHasEnded = true; // Turnover ends the play
                }

                if (liveGameDown > 4 && liveGameDriveActive) {
                    liveGameDriveActive = false;
                    // Note: The "Turnover on downs!" log will trigger 'playHasEnded' on its own
                }

            } catch (parseError) {
                console.error("Error parsing log entry for sim state:", playLogEntry, parseError);
            }

            // --- 4. Append to Ticker ---
            p.className = styleClass;
            p.textContent = descriptiveText;
            ticker.appendChild(p);

        } // End FOR loop

        liveGameLogIndex = frame.logIndex;
        if (ticker) ticker.scrollTop = ticker.scrollHeight;

        // --- 5. Update Scoreboard UI ---
        elements.simAwayScore.textContent = liveGameCurrentAwayScore;
        elements.simHomeScore.textContent = liveGameCurrentHomeScore;
        elements.simGameDrive.textContent = liveGameDriveText;
        let downText = `FINAL`;
        if (liveGameDriveActive) {
            const downSuffix = liveGameDown === 1 ? 'st' : liveGameDown === 2 ? 'nd' : liveGameDown === 3 ? 'rd' : 'th';
            downText = `${liveGameDown}${downSuffix} & ${liveGameToGo <= 0 ? 'Goal' : liveGameToGo}`;
        } else if (liveGameCurrentIndex < allFrames.length - 1) {
            downText = 'Change of Possession';
        }
        elements.simGameDown.textContent = downText;
        elements.simPossession.textContent = liveGamePossessionName ? `${liveGamePossessionName} Ball` : '';
    }
    // --- End Log Sync ---

    // --- 6. Draw Visualization ---
    drawFieldVisualization(frame);
    // update players/substitution UI
    try { renderSimPlayers(frame); } catch (err) { console.error('renderSimPlayers error:', err); }

    // --- 7. Advance to Next Frame OR Start Huddle ---
    liveGameCurrentIndex++;

    // --- 🛠️ NEW: Huddle Logic ---
    if (playHasEnded && liveGameCurrentIndex < allFrames.length) {
        // The play is over! Stop the "action" clock.
        clearInterval(liveGameInterval);
        liveGameInterval = null;
        clearTimeout(huddleTimeout); // Clear any stray huddle just in case

        // Start the "huddle" clock (2.5 second pause)
        const HUDDLE_PAUSE_MS = 2500;

        // FIX: Store the timeout ID
        huddleTimeout = setTimeout(startNextPlay, HUDDLE_PAUSE_MS);
    }
    // --- END NEW LOGIC ---
}

/**
 * 🛠️ NEW HELPER FUNCTION
 * This function is called after the "huddle pause" (setTimeout) finishes.
 * It clears the field and restarts the fast "action" clock.
 */
function startNextPlay() {
    huddleTimeout = null;
    if (!currentLiveGameResult || liveGameCurrentIndex >= currentLiveGameResult.visualizationFrames.length) {
        // Failsafe: If the game ended on that last play, just run the tick again to exit.
        runLiveGameTick();
        return;
    }

    // Clear the field (players are in the huddle)
    drawFieldVisualization(null);

    // Restart the "action" clock using the user's preferred speed
    if (!liveGameInterval) {
        liveGameInterval = setInterval(runLiveGameTick, userPreferredSpeed);
    }
}

/** Starts the live game simulation, syncing frames with log entries. */
export function startLiveGameSim(gameResult, onComplete) {
    const ticker = elements.simPlayLog;
    const scoreboard = elements.simScoreboard;

    // --- 1. Validate Elements ---
    if (!ticker || !scoreboard || !elements.simAwayScore || !elements.simHomeScore || !elements.simGameDrive || !elements.simGameDown || !elements.simPossession || !elements.fieldCanvasCtx || !elements.simLiveStats) {
        console.error("Live sim UI elements missing!");
        if (onComplete) onComplete(gameResult); // Pass back result immediately
        return;
    }

    // --- 2. Validate Data ---
    if (!gameResult || !Array.isArray(gameResult.gameLog) || !gameResult.homeTeam || !gameResult.awayTeam || !Array.isArray(gameResult.visualizationFrames) || gameResult.visualizationFrames.length === 0) {
        console.warn("startLiveGameSim: invalid gameResult or missing frames.");
        if (ticker) ticker.innerHTML = '<p>No game events to display.</p>';
        if (onComplete) onComplete(gameResult); // Pass back result immediately
        return;
    }

    // --- 3. Clear Previous Simulation ---
    if (liveGameInterval) {
        clearInterval(liveGameInterval);
        liveGameInterval = null;
    }

    // --- 4. Reset Global State ---
    liveGameCallback = onComplete;
    currentLiveGameResult = gameResult; // The full result object
    liveGameCurrentIndex = 0;           // Start from the first frame
    liveGameLogIndex = 0;               // Start from the first log

    // Reset scoreboard state
    liveGameCurrentHomeScore = 0;
    liveGameCurrentAwayScore = 0;
    liveGameBallOn = 20;
    liveGameDown = 1;
    liveGameToGo = 10;
    liveGameDriveActive = false; // Will be set true by the first drive log
    liveGamePossessionName = ''; // Will be set by the first drive log
    liveGameDriveText = "Kickoff"; // Default text
    liveGameIsConversion = false;

    // --- 5. Render Initial/Static UI ---
    if (ticker) ticker.innerHTML = '';
    if (elements.simAwayTeam) elements.simAwayTeam.textContent = gameResult.awayTeam.name;
    if (elements.simHomeTeam) elements.simHomeTeam.textContent = gameResult.homeTeam.name;
    if (elements.simAwayScore) {
        elements.simAwayScore.textContent = liveGameCurrentAwayScore;
        elements.simAwayScore.classList.add('away');
        // optional: color by team primary color if available
        try { if (gameResult.awayTeam?.primaryColor) elements.simAwayScore.style.color = gameResult.awayTeam.primaryColor; } catch (e) { }
    }
    if (elements.simHomeScore) {
        elements.simHomeScore.textContent = liveGameCurrentHomeScore;
        elements.simHomeScore.classList.add('home');
        try { if (gameResult.homeTeam?.primaryColor) elements.simHomeScore.style.color = gameResult.homeTeam.primaryColor; } catch (e) { }
    }
    if (elements.simGameDrive) elements.simGameDrive.textContent = liveGameDriveText;
    if (elements.simGameDown) elements.simGameDown.textContent = "1st & 10";
    if (elements.simPossession) elements.simPossession.textContent = '';

    drawFieldVisualization(null); // Clear field
    renderLiveStatsBox(gameResult); // Render the static "final" stats
    try {
        renderSimPlayers(gameResult.visualizationFrames[0]);
    } catch (err) {
        console.error('renderSimPlayers init error:', err);
    }
    setSimSpeed(liveGameSpeed); // Set default button style

    // --- 6. Start the Interval Timer ---
    liveGameInterval = setInterval(runLiveGameTick, liveGameSpeed);
}

export function skipLiveGameSim() {
    if (liveGameInterval) { clearInterval(liveGameInterval); liveGameInterval = null; }

    clearTimeout(huddleTimeout); // FIX: Cancel any pending huddle
    huddleTimeout = null;
    const finalResult = currentLiveGameResult; // Get the result before we clear it

    // Call the end-state of the tick function immediately to show the final frame
    liveGameCurrentIndex = finalResult?.visualizationFrames?.length || 9999;
    runLiveGameTick(); // This will run the "End Condition Check" block

    // runLiveGameTick() now handles clearing state and calling the callback
    // with the finalResult, so this function is much simpler.

    const ticker = elements.simPlayLog;
    if (ticker) {
        const p = document.createElement('p');
        p.className = 'italic text-gray-400 mt-2';
        p.textContent = '--- Simulation skipped to end ---';
        ticker.appendChild(p);
        ticker.scrollTop = ticker.scrollHeight;
    }
}

/** Changes the speed of the live game simulation interval. */
export function setSimSpeed(speed) {
    liveGameSpeed = speed;

    userPreferredSpeed = speed;

    // Update button styles
    elements.simSpeedBtns?.forEach(btn => {
        btn.classList.remove('active', 'bg-blue-500', 'hover:bg-blue-600');
        btn.classList.add('bg-gray-500', 'hover:bg-gray-600');
    });

    let activeButtonId;
    if (speed === 50) activeButtonId = 'sim-speed-play';  // 1x Speed
    else if (speed === 20) activeButtonId = 'sim-speed-fast';  // Fast-forward
    else if (speed === 150) activeButtonId = 'sim-speed-faster'; // Slow-mo

    const activeButton = document.getElementById(activeButtonId);
    if (activeButton) {
        activeButton.classList.remove('bg-gray-500', 'hover:bg-gray-600');
        activeButton.classList.add('active', 'bg-blue-500', 'hover:bg-blue-600');
    }

    clearTimeout(huddleTimeout); // FIX: Cancel any pending huddle
    huddleTimeout = null;

    // If sim is running, clear and restart interval with the new speed
    if (currentLiveGameResult && liveGameCurrentIndex < currentLiveGameResult.visualizationFrames.length) {
        if (liveGameInterval) {
            clearInterval(liveGameInterval); // Clear old action clock
        }
        // Start new action clock immediately, effectively skipping the huddle
        liveGameInterval = setInterval(runLiveGameTick, liveGameSpeed);
    }
}
