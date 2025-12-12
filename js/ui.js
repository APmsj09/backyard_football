import {
    calculateOverall,
    getRelationshipLevel,
    getScoutedPlayerInfo,
    getGameState,
    substitutePlayers,
    getRosterObjects,
    changeFormation,
    getPlayer
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

// --- Live stats counters (updated as logs are processed) ---
let liveGameStats = { home: { yards: 0, td: 0, turnovers: 0, punts: 0, returns: 0 }, away: { yards: 0, td: 0, turnovers: 0, punts: 0, returns: 0 } };
// Per-player live stat snapshots (id -> stats)
let livePlayerStats = new Map();


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

/** Helper: Gets full player objects from a team's roster of IDs. */
function getUIRosterObjects(team) {
    if (!team || !Array.isArray(team.roster)) return [];

    // 1. Legacy Support: Handle old saves where roster has full objects
    if (team.roster.length > 0 && typeof team.roster[0] === 'object') {
        return team.roster.filter(p => p);
    }

    // 2. Optimized Lookup: Map IDs directly to players
    return team.roster
        .map(id => getPlayer(id)) 
        .filter(p => p); 
}

/**
 * Grabs references to all necessary DOM elements and stores them in the 'elements' object.
 */
export function setupElements() {
    console.log("Running setupElements...");

    // Helper to grab ID and warn if missing
    const getEl = (id) => {
        const el = document.getElementById(id);
        if (!el) console.warn(`⚠️ MISSING UI ELEMENT: ID "${id}" was not found in the HTML.`);
        return el;
    };

    elements = {
        // --- Screens ---
        screens: {
            'start-screen': getEl('start-screen'),
            'loading-screen': getEl('loading-screen'),
            'team-creation-screen': getEl('team-creation-screen'),
            'draft-screen': getEl('draft-screen'),
            'dashboard-screen': getEl('dashboard-screen'),
            'offseason-screen': getEl('offseason-screen'),
            'game-sim-screen': getEl('game-sim-screen'),
            // Aliases
            startScreen: getEl('start-screen'),
            loadingScreen: getEl('loading-screen'),
            teamCreationScreen: getEl('team-creation-screen'),
            draftScreen: getEl('draft-screen'),
            dashboardScreen: getEl('dashboard-screen'),
            offseasonScreen: getEl('offseason-screen'),
            gameSimScreen: getEl('game-sim-screen'),
        },

        // --- Common ---
        modal: getEl('modal'),
        modalTitle: getEl('modal-title'),
        modalBody: getEl('modal-body'),
        modalDefaultClose: getEl('modal-default-close'),
        loadingProgress: getEl('loading-progress'),
        teamNameSuggestions: getEl('team-name-suggestions'),
        customTeamName: getEl('custom-team-name'),
        confirmTeamBtn: getEl('confirm-team-btn'),

        // --- Draft ---
        draftHeader: getEl('draft-header'),
        draftYear: getEl('draft-year'),
        draftPickNumber: getEl('draft-pick-number'),
        draftPickingTeam: getEl('draft-picking-team'),
        draftPoolTbody: getEl('draft-pool-tbody'),
        selectedPlayerCard: getEl('selected-player-card'),
        draftPlayerBtn: getEl('draft-player-btn'),
        rosterCount: getEl('roster-count'),
        draftRosterList: getEl('draft-roster-list'),
        rosterSummary: getEl('roster-summary'),
        draftSearch: getEl('draft-search'),
        draftFilterPos: getEl('draft-filter-pos'),
        draftSort: getEl('draft-sort'),

        // --- Dashboard Main ---
        dashboardTeamName: getEl('dashboard-team-name'),
        dashboardRecord: getEl('dashboard-record'),
        dashboardYear: getEl('dashboard-year'),
        dashboardWeek: getEl('dashboard-week'),
        dashboardTabs: getEl('dashboard-tabs'),
        dashboardContent: getEl('dashboard-content'),
        advanceWeekBtn: getEl('advance-week-btn'),

        // --- Dashboard Tabs  ---
        myTeamRoster: getEl('my-team-roster'),
        scheduleList: getEl('schedule-list'),
        standingsContainer: getEl('standings-container'),
        playerStatsContainer: getEl('player-stats-container'),
        statsFilterTeam: getEl('stats-filter-team'),
        statsSort: getEl('stats-sort'),
        hallOfFameList: getEl('hall-of-fame-list'),
        messagesList: getEl('messages-list'),
        messagesNotificationDot: getEl('messages-notification-dot'),

        // --- Depth Chart ---
        depthChartSubTabs: getEl('depth-chart-subtabs'),
        offenseFormationSelect: getEl('offense-formation-select'),
        defenseFormationSelect: getEl('defense-formation-select'),
        offenseDepthChartPane: getEl('depth-chart-offense-pane'),
        defenseDepthChartPane: getEl('depth-chart-defense-pane'),
        offenseVisualField: getEl('offense-visual-field'),
        defenseVisualField: getEl('defense-visual-field'),
        offenseBenchTable: getEl('offense-bench-table'),
        defenseBenchTable: getEl('defense-bench-table'),
        positionalOverallsContainer: getEl('positional-overalls-container'),
        depthOrderContainer: getEl('depth-order-container'),
        depthOrderGrid: getEl('depth-order-list'),
        autoReorderBtn: getEl('auto-reorder-btn'),

        // --- Game Sim ---
        simScoreboard: getEl('sim-scoreboard'),
        simAwayTeam: getEl('sim-away-team'),
        simAwayScore: getEl('sim-away-score'),
        simHomeTeam: getEl('sim-home-team'),
        simHomeScore: getEl('sim-home-score'),
        simGameDrive: getEl('sim-game-drive'),
        simGameDown: getEl('sim-game-down'),
        simPossession: getEl('sim-possession'),
        fieldCanvas: getEl('field-canvas'),
        fieldCanvasCtx: getEl('field-canvas')?.getContext('2d'),
        simPlayLog: getEl('sim-play-log'),
        simSpeedBtns: document.querySelectorAll('.sim-speed-btn'),
        simSkipBtn: getEl('sim-skip-btn'),
        simLiveStats: getEl('sim-live-stats'),
        simStatsAway: getEl('sim-stats-away'),
        simStatsHome: getEl('sim-stats-home'),
        simPlayersPanel: getEl('sim-players-panel'),
        simPlayersList: getEl('sim-players-list'),
        simMatchupBanner: getEl('sim-matchup-banner'),
        simBannerOffense: getEl('sim-banner-offense'),
        simBannerDefense: getEl('sim-banner-defense'),

        // --- Offseason ---
        offseasonYear: getEl('offseason-year'),
        playerDevelopmentContainer: getEl('player-development-container'),
        retirementsList: getEl('retirements-list'),
        hofInducteesList: getEl('hof-inductees-list'),
        leavingPlayersList: getEl('leaving-players-list'),
        goToNextDraftBtn: getEl('go-to-next-draft-btn'),
    };

    if (elements.draftSort) {
        elements.draftSort.innerHTML = `
            <option value="default">Potential (Default)</option>
            <option value="age-asc">Age (Youngest)</option>
            <option value="age-desc">Age (Oldest)</option>
            <option value="speed-desc">Speed (Fastest)</option>
            <option value="strength-desc">Strength (Strongest)</option>
            <option value="agility-desc">Agility (Most Agile)</option>
            <option value="potential-desc">Potential (Highest)</option>
        `;
    }

    if (elements.modalDefaultClose) {
        elements.modalDefaultClose.addEventListener('click', () => {
            try { hideModal(); } catch (e) { }
        });
    }

    setupFormationListeners();
    setupDepthChartTabs();
    console.log("UI Elements setup complete.");
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

    // --- 💡 FIX: Use .roster.length (array of IDs is fine for a count) ---
    const currentTeamRosterSize = pickingTeam.roster?.length || 0;
    const playerCanPick = pickingTeam.id === playerTeam.id && currentTeamRosterSize < ROSTER_LIMIT;

    if (elements.draftYear) elements.draftYear.textContent = year;
    if (elements.draftPickNumber) elements.draftPickNumber.textContent = `${currentPick + 1} (${currentTeamRosterSize}/${ROSTER_LIMIT} players)`;
    if (elements.draftPickingTeam) elements.draftPickingTeam.textContent = pickingTeam.name || 'Unknown Team';

    renderDraftPool(gameState, onPlayerSelect, sortColumn, sortDirection);
    renderPlayerRoster(gameState.playerTeam);
    updateDraftSortIndicators(sortColumn, sortDirection);

    if (currentSelectedId) {
        // Find the player object from the master list (sorted or unsorted)
        const playerObj = gameState.players.find(p => p.id === currentSelectedId);
        if (playerObj) {
            renderSelectedPlayerCard(playerObj, gameState);
        }
    }

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

    // --- 💡 FIX: Get roster objects for relationship calc ---
    const playerRoster = getUIRosterObjects(gameState.playerTeam);

    const undraftedPlayers = gameState.players.filter(p => p && !p.teamId);
    const searchTerm = elements.draftSearch?.value.toLowerCase() || '';
    const posFilter = elements.draftFilterPos?.value || '';


    let filteredPlayers = undraftedPlayers.filter(p =>
        p.name.toLowerCase().includes(searchTerm) &&
        (!posFilter || p.favoriteOffensivePosition === posFilter || p.favoriteDefensivePosition === posFilter)
    );

    // --- IMPROVED SORT LOGIC WITH TIE-BREAKER ---
    const potentialOrder = { 'A': 5, 'B': 4, 'C': 3, 'D': 2, 'F': 1 };

    // Helper: Sorts by primary key, then breaks ties with Overall Rating
    const sortPlayer = (a, b, key, category = null) => {
        // 1. Primary Sort (e.g., Speed)
        const valA = category ? (a?.attributes?.[category]?.[key] || 0) : (a?.[key] || 0);
        const valB = category ? (b?.attributes?.[category]?.[key] || 0) : (b?.[key] || 0);

        if (valA !== valB) {
            return sortDirection === 'asc' ? valA - valB : valB - valA;
        }

        // 2. Tie-Breaker: Overall Rating (Always Descending)
        // We want the best player at the top, even if we are sorting by age/height
        const ovrA = calculateOverall(a, estimateBestPosition(a));
        const ovrB = calculateOverall(b, estimateBestPosition(b));

        return ovrB - ovrA;
    };

    switch (sortColumn) {
        case 'name':
            filteredPlayers.sort((a, b) => sortDirection === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name));
            break;
        case 'age':
            filteredPlayers.sort((a, b) => sortPlayer(a, b, 'age'));
            break;
        case 'position':
            filteredPlayers.sort((a, b) => {
                const posA = a.favoriteOffensivePosition || a.favoriteDefensivePosition;
                const posB = b.favoriteOffensivePosition || b.favoriteDefensivePosition;
                // Use overall as tiebreaker here too
                if (posA !== posB) return sortDirection === 'asc' ? posA.localeCompare(posB) : posB.localeCompare(posA);
                return calculateOverall(b, estimateBestPosition(b)) - calculateOverall(a, estimateBestPosition(a));
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
            // Improved Default Sort: Potential Letter -> Overall Rating
            filteredPlayers.sort((a, b) => {
                const valA = potentialOrder[a?.potential] || 0;
                const valB = potentialOrder[b?.potential] || 0;

                if (valA !== valB) {
                    return sortDirection === 'asc' ? valA - valB : valB - valA;
                }
                // If potential is same (e.g. both 'A'), sort by Overall
                const ovrA = calculateOverall(a, estimateBestPosition(a));
                const ovrB = calculateOverall(b, estimateBestPosition(b));
                return ovrB - ovrA;
            });
            break;
    }

    elements.draftPoolTbody.innerHTML = '';

    if (filteredPlayers.length === 0) {
        elements.draftPoolTbody.innerHTML = `<tr><td colspan="18" class="p-4 text-center text-gray-500">No players match filters.</td></tr>`;
        return;
    }

    filteredPlayers.forEach(player => {
        // --- 💡 FIX: Use the playerRoster objects we fetched earlier ---
        const maxLevel = playerRoster.reduce(
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

    // --- 💡 FIX: Get roster objects for relationship calc ---
    const playerRoster = getUIRosterObjects(gameState.playerTeam);
    const maxLevel = playerRoster.reduce(
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

    // --- 💡 FIX: Get roster objects ---
    const roster = getUIRosterObjects(playerTeam);
    const ROSTER_LIMIT = 10;

    elements.rosterCount.textContent = `${roster.length}/${ROSTER_LIMIT}`;
    elements.draftRosterList.innerHTML = '';

    if (roster.length === 0) {
        elements.draftRosterList.innerHTML = '<li class="p-2 text-center text-gray-500">No players drafted yet.</li>';
    } else {
        roster.forEach(player => {
            if (!player) return;
            const li = document.createElement('li');
            const estimatedPos = estimateBestPosition(player, positionOverallWeights);
            li.className = 'p-2';
            li.textContent = `${player.name} (${estimatedPos ?? '?'})`;
            elements.draftRosterList.appendChild(li);
        });
    }

    // --- 💡 FIX: Pass the full roster objects ---
    renderRosterSummary(roster);
}

/** Renders the average overall ratings for the player's current roster. */
function renderRosterSummary(roster) { // 💡 FIX: Now accepts the roster objects directly
    if (!elements.rosterSummary) return;

    if (roster.length === 0) {
        elements.rosterSummary.innerHTML = '<p class="text-xs text-gray-500">Your roster is empty.</p>';
        return;
    }

    let summaryHtml = '<h5 class="font-bold text-sm mb-1">Team Starters</h5><div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">';

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
    // 💡 FIXED: Include ties in the displayed record
    const recordText = `Record: ${playerTeam.wins || 0} - ${playerTeam.losses || 0}` +
        ((playerTeam.ties && playerTeam.ties > 0) ? ` - ${playerTeam.ties}` : '');
    if (elements.dashboardRecord) elements.dashboardRecord.textContent = recordText;
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
    console.log(`🖱️ Switching to tab: "${tabId}"`);

    if (!elements.dashboardContent || !elements.dashboardTabs) {
        console.error("CRITICAL: Dashboard containers not found in setupElements.");
        return;
    }

    // 1. Visual Toggle: Hide all panes, Show selected pane
    elements.dashboardContent.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));

    // Deactivate all buttons
    elements.dashboardTabs.querySelectorAll('.tab-button').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
    });

    // Activate the specific DOM elements
    const contentPane = document.getElementById(`tab-content-${tabId}`);
    const tabButton = elements.dashboardTabs.querySelector(`[data-tab="${tabId}"]`);

    if (contentPane) contentPane.classList.remove('hidden');
    else console.error(`❌ HTML Error: ID "tab-content-${tabId}" not found in index.html`);

    if (tabButton) {
        tabButton.classList.add('active');
        tabButton.setAttribute('aria-selected', 'true');
    }

    // 2. Data Check
    if (!gameState) {
        console.warn("⚠️ No GameState provided to switchTab.");
        if (contentPane) contentPane.innerHTML = '<p class="p-4 text-red-500">Game data is missing.</p>';
        return;
    }

    // 3. Routing: Call the correct render function
    try {
        switch (tabId) {
            case 'my-team':
                renderMyTeamTab(gameState);
                break;
            case 'depth-chart':
                // Depth chart handles its own sub-logic
                if (typeof renderDepthChartTab === 'function') renderDepthChartTab(gameState);
                break;
            case 'schedule':
                console.log("📅 Rendering Schedule...");
                renderScheduleTab(gameState);
                break;
            case 'standings':
                console.log("🏆 Rendering Standings...");
                renderStandingsTab(gameState);
                break;
            case 'player-stats':
                console.log("📊 Rendering Stats...");
                renderPlayerStatsTab(gameState);
                break;
            case 'hall-of-fame':
                console.log("🏛️ Rendering Hall of Fame...");
                renderHallOfFameTab(gameState);
                break;
            case 'messages':
                console.log("📩 Rendering Messages...");
                renderMessagesTab(gameState);
                break;
            default:
                console.warn(`❓ Unknown tab ID: ${tabId}`);
        }
    } catch (error) {
        console.error(`💥 CRASH in switchTab for "${tabId}":`, error);
        if (contentPane) contentPane.innerHTML = `<p class="p-4 text-red-500">Error rendering this tab: ${error.message}</p>`;
    }
}

/** Renders the 'My Team' tab content (roster table). */
function renderMyTeamTab(gameState) {
    if (!elements.myTeamRoster || !gameState?.playerTeam?.roster || !Array.isArray(gameState.playerTeam.roster)) {
        console.error("Cannot render My Team tab: Missing elements or invalid roster data.");
        if (elements.myTeamRoster) elements.myTeamRoster.innerHTML = '<p class="text-red-500">Error loading roster data.</p>';
        return;
    }
    const roster = getUIRosterObjects(gameState.playerTeam);

    const physicalAttrs = ['height', 'weight', 'speed', 'strength', 'agility', 'stamina'];
    const mentalAttrs = ['playbookIQ', 'clutch', 'consistency', 'toughness'];
    const technicalAttrs = ['throwingAccuracy', 'catchingHands', 'blocking', 'tackling', 'blockShedding'];

    let tableHtml = `<div class="overflow-x-auto"><table class="min-w-full bg-white text-sm"><thead class="bg-gray-800 text-white sticky top-0 z-10"><tr>
        <th scope="col" class="py-2 px-3 text-left sticky left-0 bg-gray-800 z-20">Name</th>
        <th scope="col" class="py-2 px-3 text-center" title="Captain">C</th> <th scope="col" class="py-2 px-3">#</th>
        <th scope="col" class="py-2 px-3">Type</th>
        <th scope="col" class="py-2 px-3">Age</th>
        <th scope="col" class="py-2 px-3">Pot</th>
        <th scope="col" class="py-2 px-3">Status</th>
        ${physicalAttrs.map(h => `<th scope="col" class="py-2 px-3 uppercase">${h.slice(0, 3)}</th>`).join('')}
        ${mentalAttrs.map(h => `<th scope="col" class="py-2 px-3 uppercase">${h.slice(0, 3)}</th>`).join('')}
        ${technicalAttrs.map(h => `<th scope="col" class="py-2 px-3 uppercase">${h.slice(0, 3)}</th>`).join('')}
    </tr></thead><tbody class="divide-y">`;

    if (roster.length === 0) {
        tableHtml += `<tr><td colspan="22" class="p-4 text-center text-gray-500">Your roster is empty.</td></tr>`;
    } else {
        roster.forEach(p => {
            if (!p || !p.attributes || !p.status) return;
            const statusClass = p.status.duration > 0 ? 'text-red-500 font-semibold' : 'text-green-600';
            const statusText = p.status.description || 'Healthy';
            const typeTag = p.status.type === 'temporary' ? '<span class="status-tag temporary" title="Temporary Friend">[T]</span>' : '<span class="status-tag permanent" title="Permanent Roster">[P]</span>';

            // --- CAPTAIN LOGIC ---
            const isCaptain = gameState.playerTeam.captainId === p.id;
            const captainBtn = isCaptain 
                ? '<span class="text-amber-500 font-bold text-lg" title="Current Captain">★</span>' 
                : `<button onclick="app.setCaptain('${p.id}')" class="text-gray-300 hover:text-amber-400 font-bold text-lg transition" title="Make Captain">☆</button>`;

            tableHtml += `<tr data-player-id="${p.id}" class="cursor-pointer hover:bg-amber-100">
                 <th scope="row" class="py-2 px-3 font-semibold sticky left-0 bg-white z-10">${p.name}</th>
                 <td class="text-center py-2 px-3">${captainBtn}</td> <td class="text-center py-2 px-3 font-medium">${p.number || '?'}</td>
                 <td class="text-center py-2 px-3">${typeTag}</td>
                 <td class="text-center py-2 px-3">${p.age}</td>
                 <td class="text-center py-2 px-3 font-medium">${p.potential || '?'}</td>
                 <td class="text-center py-2 px-3 ${statusClass}" title="${statusText}">${statusText} ${p.status.duration > 0 ? `(${p.status.duration}w)` : ''}</td>`;

            const renderAttr = (val, attrName) => {
                const breakthroughClass = p.breakthroughAttr === attrName ? ' breakthrough font-bold text-green-600' : '';
                const displayValue = attrName === 'height' ? formatHeight(val) : (val ?? '?');
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
    // FORCE fresh state retrieval. 
    // This prevents stale props from overwriting recent drag-and-drop changes.
    const gs = getGameState();

    if (!gs || !gs.playerTeam || !gs.playerTeam.roster || !gs.playerTeam.formations || !gs.playerTeam.depthChart) {
        console.error("Cannot render depth chart: Invalid game state.");
        if (elements.positionalOverallsContainer) elements.positionalOverallsContainer.innerHTML = '<p class="text-red-500">Error loading depth chart data.</p>';
        return;
    }

    const permanentRoster = getUIRosterObjects(gs.playerTeam)
        .filter(p => p && p.status?.type !== 'temporary');

    renderPositionalOveralls(permanentRoster);

    // Pass specific current formation names from the fresh state
    renderFormationDropdown('offense', Object.values(offenseFormations), gs.playerTeam.formations.offense);
    renderFormationDropdown('defense', Object.values(defenseFormations), gs.playerTeam.formations.defense);

    renderDepthChartSide('offense', gs);
    renderDepthChartSide('defense', gs);
}

/** Populates the formation selection dropdown. */
function renderFormationDropdown(side, formations, currentFormationName) {
    const selectEl = elements[`${side}FormationSelect`];
    if (!selectEl) { console.error(`Formation select element for "${side}" not found.`); return; }

    // Sort formations by name for consistency
    const sortedFormations = Object.values(formations).sort((a, b) => a.name.localeCompare(b.name));

    selectEl.innerHTML = sortedFormations.map(f => {
        let label = f.name;

        // SMART UI: Add Personnel Counts (e.g., "3 WR, 1 RB")
        if (f.personnel) {
            const parts = [];
            if (f.personnel.RB > 0) parts.push(`${f.personnel.RB} RB`);
            if (f.personnel.WR > 0) parts.push(`${f.personnel.WR} WR`);
            if (f.personnel.TE > 0) parts.push(`${f.personnel.TE} TE`);
            if (f.personnel.LB > 0) parts.push(`${f.personnel.LB} LB`);
            if (f.personnel.DB > 0) parts.push(`${f.personnel.DB} DB`);

            if (parts.length > 0) label += ` (${parts.join(', ')})`;
        }

        return `<option value="${f.name}" ${f.name === currentFormationName ? 'selected' : ''}>${label}</option>`;
    }).join('');
}

/** Renders the table showing overall ratings for each player at each position. */
function renderPositionalOveralls() {
    const pane = document.getElementById("positional-overalls-container");
    const gameState = getGameState();
    if (!pane || !gameState) return;

    const positions = {};
    const roster = getUIRosterObjects(gameState.playerTeam);

    for (const p of roster) {
        // FIX: Use estimated position if p.pos is missing
        const pos = p.pos || estimateBestPosition(p);
        if (!positions[pos]) positions[pos] = [];
        positions[pos].push(p);
    }

    // Sort position groups alphabetically or by standard order
    const order = ['QB', 'RB', 'WR', 'OL', 'DL', 'LB', 'DB', 'K', 'P'];
    const sortedKeys = Object.keys(positions).sort((a, b) => {
        return order.indexOf(a) - order.indexOf(b);
    });

    const html = `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">` +
        sortedKeys.map(pos => `
        <div class="mb-4 p-4 bg-gray-50 rounded border shadow-sm">
            <h4 class="font-bold text-gray-700 mb-2 border-b pb-1 flex justify-between">
                <span>${pos}</span>
                <span class="text-xs font-normal text-gray-500 self-center">${positions[pos].length} Players</span>
            </h4>
            <div class="space-y-1 max-h-60 overflow-y-auto">
                ${positions[pos]
                .sort((a, b) => calculateOverall(b, pos) - calculateOverall(a, pos))
                .map(x => {
                    const ovr = calculateOverall(x, pos);
                    // Highlight high overalls
                    const colorClass = ovr >= 80 ? 'text-green-600 font-bold' : (ovr >= 70 ? 'text-blue-600' : 'text-gray-600');
                    return `
                        <div class="flex justify-between text-sm hover:bg-gray-100 p-1 rounded">
                            <span>${x.name}</span>
                            <span class="${colorClass}">${ovr}</span>
                        </div>`;
                })
                .join("")}
            </div>
        </div>
    `).join("") + `</div>`;

    pane.innerHTML = html;
}


/** Renders the depth chart slots and available players for one side. */
function renderDepthChartSide(side, gameState) {
    const visualFieldContainer = document.getElementById(`${side}-visual-field`);
    const benchTableContainer = document.getElementById(`${side}-bench-table`);

    if (!visualFieldContainer || !benchTableContainer || !gameState?.playerTeam?.roster || !gameState?.playerTeam?.depthChart) {
        console.error(`Cannot render depth chart side "${side}": Missing elements or game state.`);
        if (visualFieldContainer) visualFieldContainer.innerHTML = '<p class="text-red-500">Error</p>';
        if (benchTableContainer) benchTableContainer.innerHTML = '<p class="text-red-500">Error</p>';
        return;
    }

    const { depthChart, formations } = gameState.playerTeam;
    // --- 💡 FIX: Get roster objects ---
    const roster = getUIRosterObjects(gameState.playerTeam);

    const currentChart = depthChart[side] || {};
    const formationName = formations[side];
    const formationData = (side === 'offense' ? offenseFormations[formationName] : defenseFormations[formationName]);

    const playersStartingOnThisSide = new Set(Object.values(currentChart).filter(Boolean)); // Set of IDs

    // --- 💡 FIX: Filter from our full roster object list ---
    const benchedPlayers = roster.filter(p => p && !playersStartingOnThisSide.has(p.id));

    renderVisualFormationSlots(visualFieldContainer, currentChart, formationData, benchedPlayers, roster, side);
    renderDepthChartBench(benchTableContainer, benchedPlayers, side);
}


/**
 * Renders the visual, on-field player slots and their assignment dropdowns.
 * UPDATED: Shows full roster, contextual overalls, and swap indicators.
 */
function renderVisualFormationSlots(container, currentChart, formationData, benchedPlayers, allRoster, side) {
    container.innerHTML = '';
    container.classList.add('visual-field-container');

    if (!formationData || !formationData.slots || !formationData.coordinates) {
        container.innerHTML = '<div class="flex h-full items-center justify-center text-white/70 italic">Select a formation to view alignment.</div>';
        return;
    }

    // Add Line of Scrimmage
    const LOS_PERCENT = side === 'offense' ? 60 : 40;
    const losEl = document.createElement('div');
    losEl.className = 'los-marker';
    losEl.style.top = `${LOS_PERCENT}%`;
    container.appendChild(losEl);

    // --- 1. INCREASE SPACING ---
    // Was 2.5, changed to 4.2 to spread players out horizontally
    const X_SPACING_MULTIPLIER = 4.2;
    const Y_SPACING_MULTIPLIER = 4.5;
    const PADDING_OFFSET = 7;

    formationData.slots.forEach(slot => {
        const playerId = currentChart[slot];
        const currentPlayer = allRoster.find(p => p && p.id === playerId);
        const relCoords = formationData.coordinates[slot] || [0, 0];

        // 1. Determine Position Context (e.g., "WR" from "WR1")
        const basePosition = slot.replace(/\d/g, '');

        // 2. Build Dropdown Options (FULL ROSTER)
        // Map every player to an option object with their OVR for THIS specific position
        const rosterOptions = allRoster
            .filter(p => p) // Filter out temporary/helping friends if desired
            .map(p => {
                // Check if this player is assigned to ANY slot in the current chart
                const assignedSlot = Object.keys(currentChart).find(key => currentChart[key] === p.id);
                const isAssignedHere = assignedSlot === slot;
                const isAssignedElsewhere = assignedSlot && !isAssignedHere;

                return {
                    id: p.id,
                    name: p.name,
                    ovr: calculateOverall(p, basePosition), // Context-aware rating
                    assignedSlot: assignedSlot,
                    isAssignedHere: isAssignedHere,
                    isAssignedElsewhere: isAssignedElsewhere
                };
            });

        // Sort by OVR descending (Best fit for this slot at the top)
        rosterOptions.sort((a, b) => b.ovr - a.ovr);

        // Generate HTML for options
        let optionsHtml = '<option value="null">-- Empty --</option>';

        rosterOptions.forEach(opt => {
            let label = `${opt.name} - ${opt.ovr}`;
            let styleClass = "";
            let suffix = "";

            if (opt.isAssignedHere) {
                suffix = " (Current)";
                styleClass = "font-bold bg-gray-200 text-black";
            } else if (opt.isAssignedElsewhere) {
                // SWAP SCENARIO -> Change this to "Also playing..."
                suffix = ` (Also at ${opt.assignedSlot})`;
                styleClass = "text-blue-700 font-semibold bg-blue-50"; // Changed color to blue/info
            } else {
                // BENCH SCENARIO
                suffix = " (Bench)";
                styleClass = "text-green-600 bg-white";
            }

            // Add the option
            optionsHtml += `<option value="${opt.id}" ${opt.isAssignedHere ? 'selected' : ''} class="${styleClass}">
                ${label}${suffix}
            </option>`;
        });

        // --- Coordinate Mapping ---
        const x_percent = 50 + (relCoords[0] * X_SPACING_MULTIPLIER);
        let y_percent;
        if (side === 'offense') {
            y_percent = LOS_PERCENT + (relCoords[1] * Y_SPACING_MULTIPLIER);
        } else {
            y_percent = LOS_PERCENT - (relCoords[1] * Y_SPACING_MULTIPLIER);
        }

        const clampedX = Math.max(PADDING_OFFSET, Math.min(100 - PADDING_OFFSET, x_percent));
        const clampedY = Math.max(PADDING_OFFSET, Math.min(100 - PADDING_OFFSET, y_percent));

        const slotEl = document.createElement('div');
        slotEl.className = 'player-slot-visual';
        slotEl.dataset.positionSlot = slot;
        slotEl.dataset.side = side;
        slotEl.style.left = `${clampedX}%`;
        slotEl.style.top = `${clampedY}%`;

        // --- 2. CENTER THE ELEMENT ---
        // This ensures the box is centered on the coordinate, preventing left-side overlap
        slotEl.style.transform = 'translate(-50%, -50%)';
        // Optional: Ensure high z-index on hover so you can see overlapped cards
        slotEl.style.zIndex = '10';

        if (currentPlayer) {
            slotEl.draggable = true;
            slotEl.dataset.playerId = currentPlayer.id;
        }

        // Badge Logic
        let overallHtml = '';
        if (currentPlayer) {
            const overall = calculateOverall(currentPlayer, basePosition);
            let colorClass = 'bg-gray-500';
            if (overall >= 90) colorClass = 'bg-green-600';
            else if (overall >= 80) colorClass = 'bg-blue-600';
            else if (overall >= 70) colorClass = 'bg-amber-600';
            else if (overall >= 60) colorClass = 'bg-red-600';

            overallHtml = `<div class="slot-overall ${colorClass}">${overall}</div>`;
        } else {
            overallHtml = `<div class="slot-overall bg-gray-500">--</div>`;
        }

        slotEl.innerHTML = `
            <span class="slot-label">${slot}</span>
            ${overallHtml}
            <select class="slot-select" data-slot="${slot}" data-side="${side}">
                ${optionsHtml}
            </select>
        `;

        const select = slotEl.querySelector('select');
        select.addEventListener('change', (e) => {
            const newPlayerId = e.target.value;

            // Dispatch event to Main.js to handle the data update (and the swap logic)
            const event = new CustomEvent('depth-chart-changed', {
                detail: {
                    playerId: newPlayerId === 'null' ? null : newPlayerId,
                    slot: slot,
                    side: side
                }
            });
            document.dispatchEvent(event);
        });

        slotEl.onmouseenter = () => { slotEl.style.zIndex = '50'; };
        slotEl.onmouseleave = () => { slotEl.style.zIndex = '10'; };

        container.appendChild(slotEl);
    });
}

/**
 * Renders the bench players into a sortable, draggable table.
 */
function renderDepthChartBench(container, benchedPlayers, side) {
    const physicalAttrs = ['height', 'weight', 'speed', 'strength', 'agility', 'stamina'];
    const mentalAttrs = ['playbookIQ', 'clutch', 'consistency', 'toughness'];
    const technicalAttrs = ['throwingAccuracy', 'catchingHands', 'blocking', 'tackling', 'blockShedding'];

    let tableHtml = `<table class="min-w-full bg-white text-sm"><thead class="bg-gray-100 sticky top-0 z-10"><tr>
        <th scope="col" class="py-2 px-3 text-left sticky left-0 bg-gray-100 z-20">Name</th>
        <th scope="col" class="py-2 px-3">Age</th>
        <th scope="col" class="py-2 px-3">Pot</th>
        <th scope="col" class="py-2 px-3">Status</th>
        ${physicalAttrs.map(h => `<th scope="col" class="py-2 px-3 uppercase">${h.slice(0, 3)}</th>`).join('')}
        ${mentalAttrs.map(h => `<th scope="col" class="py-2 px-3 uppercase">${h.slice(0, 3)}</th>`).join('')}
        ${technicalAttrs.map(h => `<th scope="col" class="py-2 px-3 uppercase">${h.slice(0, 3)}</th>`).join('')}
    </tr></thead><tbody class="divide-y">`;

    if (benchedPlayers.length === 0) {
        tableHtml += `<tr><td colspan="20" class="p-4 text-center text-gray-500">All players are starting.</td></tr>`;
    } else {
        benchedPlayers.forEach(p => {
            if (!p || !p.attributes || !p.status) return;

            const statusClass = p.status.duration > 0 ? 'text-red-500 font-semibold' : 'text-green-600';
            const statusText = p.status.description || 'Healthy';

            tableHtml += `
                <tr class="bench-player-row" draggable="true" data-player-id="${p.id}" data-side="${side}">
                    <th scope="row" class="py-2 px-3 font-semibold sticky left-0 bg-white z-10">${p.name}</th>
                    <td class="text-center py-2 px-3">${p.age}</td>
                    <td class="text-center py-2 px-3 font-medium">${p.potential || '?'}</td>
                    <td class="text-center py-2 px-3 ${statusClass}" title="${statusText}">
                        ${statusText} ${p.status.duration > 0 ? `(${p.status.duration}w)` : ''}
                    </td>
            `;

            const renderAttr = (val, attrName) => {
                const displayValue = attrName === 'height' ? formatHeight(val) : (val ?? '?');
                return `<td class="text-center py-2 px-3" title="${attrName}">${displayValue}</td>`;
            };

            physicalAttrs.forEach(attr => tableHtml += renderAttr(p.attributes.physical?.[attr], attr));
            mentalAttrs.forEach(attr => tableHtml += renderAttr(p.attributes.mental?.[attr], attr));
            technicalAttrs.forEach(attr => tableHtml += renderAttr(p.attributes.technical?.[attr], attr));

            tableHtml += `</tr>`;
        });
    }
    container.innerHTML = tableHtml + `</tbody></table>`;
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

        // --- Unified Drag Logic ---
        // Always allow drag if player exists.
        playerEl.draggable = true;
        playerEl.setAttribute('title', `Drag ${player.name ?? 'Player'} to ${side} slot`);

        // Optional: Visual distinction without disabling functionality
        if (player.status?.type === 'temporary') {
            playerEl.classList.add('text-amber-700', 'font-semibold');
        }
        container.appendChild(playerEl);
    });
}

/** Renders the 'Messages' tab content. */
export function renderMessagesTab(gameState) {
    if (!elements.messagesList) return;

    if (!gameState?.messages || !Array.isArray(gameState.messages) || gameState.messages.length === 0) {
        elements.messagesList.innerHTML = `<div class="p-8 text-center text-gray-400 flex flex-col items-center">
            <svg class="w-12 h-12 mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path></svg>
            <p>No messages yet.</p>
        </div>`;
        return;
    }

    elements.messagesList.innerHTML = gameState.messages.map(msg => {
        const readClass = msg.isRead ? 'bg-white text-gray-600' : 'bg-blue-50 border-l-4 border-blue-500 font-semibold text-gray-800';
        return `
            <div class="message-item ${readClass} p-3 rounded shadow-sm cursor-pointer hover:bg-gray-50 transition mb-2" 
                 data-message-id="${msg.id}">
                <div class="flex justify-between items-center">
                    <span class="truncate">${msg.subject || '(No Subject)'}</span>
                    <span class="text-xs text-gray-400">${msg.week ? 'Wk ' + msg.week : ''}</span>
                </div>
            </div>
        `;
    }).join('');

    updateMessagesNotification(gameState.messages);
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
    if (!elements.scheduleList) return;

    if (!gameState?.schedule || !Array.isArray(gameState.schedule)) {
        elements.scheduleList.innerHTML = '<p class="text-gray-500 p-4">No schedule data available.</p>';
        return;
    }

    let html = '';
    const numTeams = gameState.teams?.length || 0;
    const gamesPerWeek = numTeams > 0 ? Math.floor(numTeams / 2) : 0;
    const numWeeks = 9; // Or gameState.totalWeeks if available

    for (let i = 0; i < numWeeks; i++) {
        const weekStartIndex = i * gamesPerWeek;
        const weekEndIndex = weekStartIndex + gamesPerWeek;
        const weekGames = gameState.schedule.slice(weekStartIndex, weekEndIndex);

        const isCurrentWeek = i === gameState.currentWeek;
        const isPastWeek = i < gameState.currentWeek;

        let weekHtml = `<div class="p-4 rounded mb-4 ${isCurrentWeek ? 'bg-amber-100 border-2 border-amber-500' : 'bg-gray-100'}">
            <h4 class="font-bold text-lg mb-2">Week ${i + 1}</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">`;

        if (weekGames.length > 0) {
            weekGames.forEach(g => {
                if (!g || !g.home || !g.away) return;

                // Try to find the result for this specific game
                let result = null;
                if (isPastWeek && gameState.gameResults) {
                    result = gameState.gameResults.find(r =>
                        r && r.homeTeam.id === g.home.id && r.awayTeam.id === g.away.id
                    );
                }

                let content;
                let resultClass = '';

                if (result) {
                    // Game is finished, show score
                    const homeWin = result.homeScore > result.awayScore;
                    const awayWin = result.awayScore > result.homeScore;

                    content = `
                        <span class="${awayWin ? 'font-bold' : ''}">${g.away.name} ${result.awayScore}</span> 
                        <span class="text-gray-400 mx-1">@</span> 
                        <span class="${homeWin ? 'font-bold' : ''}">${g.home.name} ${result.homeScore}</span>
                    `;

                    // Highlight win/loss for player
                    if (result.homeTeam.id === gameState.playerTeam.id) {
                        resultClass = homeWin ? 'border-l-4 border-green-500 bg-green-50' : (result.homeScore < result.awayScore ? 'border-l-4 border-red-500 bg-red-50' : '');
                    } else if (result.awayTeam.id === gameState.playerTeam.id) {
                        resultClass = awayWin ? 'border-l-4 border-green-500 bg-green-50' : (result.awayScore < result.homeScore ? 'border-l-4 border-red-500 bg-red-50' : '');
                    }
                } else {
                    // Game not played yet
                    content = `<span>${g.away.name}</span> <span class="text-gray-400 mx-1">@</span> <span>${g.home.name}</span>`;
                }

                weekHtml += `<div class="bg-white p-2 rounded shadow-sm flex justify-center items-center ${resultClass}">${content}</div>`;
            });
        } else {
            weekHtml += `<p class="text-gray-500 md:col-span-2 italic">Bye Week / No Games</p>`;
        }
        weekHtml += `</div></div>`;
        html += weekHtml;
    }
    elements.scheduleList.innerHTML = html;
}

/** Renders the 'Standings' tab content. */
function renderStandingsTab(gameState) {
    if (!elements.standingsContainer) return;

    if (!gameState?.divisions || !gameState.teams) {
        elements.standingsContainer.innerHTML = '<p class="text-red-500 p-4">Standings data unavailable.</p>';
        return;
    }

    elements.standingsContainer.innerHTML = '';

    for (const [divName, divisionTeamIdsArray] of Object.entries(gameState.divisions)) {
        if (!Array.isArray(divisionTeamIdsArray)) continue;

        const divisionTeamIds = new Set(divisionTeamIdsArray);

        // Filter teams belonging to this division
        const divTeams = gameState.teams
            .filter(t => t && divisionTeamIds.has(t.id))
            .sort((a, b) => {
                // Sort by Win % -> Wins -> Name
                const getWinPct = (t) => {
                    const games = (t.wins || 0) + (t.losses || 0) + (t.ties || 0);
                    return games === 0 ? 0 : ((t.wins || 0) + 0.5 * (t.ties || 0)) / games;
                };
                if (getWinPct(a) !== getWinPct(b)) return getWinPct(b) - getWinPct(a);
                if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
                return a.name.localeCompare(b.name);
            });

        const divEl = document.createElement('div');
        divEl.className = 'mb-6 bg-gray-50 rounded-lg overflow-hidden border border-gray-200';

        let tableHtml = `
            <div class="bg-gray-200 px-4 py-2 font-bold text-gray-700 border-b border-gray-300">${divName} Division</div>
            <table class="min-w-full text-sm">
                <thead class="bg-gray-100 text-gray-600 text-xs uppercase">
                    <tr>
                        <th class="py-2 px-3 text-left">Team</th>
                        <th class="py-2 px-3 text-center">W</th>
                        <th class="py-2 px-3 text-center">L</th>
                        <th class="py-2 px-3 text-center">T</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-200">
        `;

        divTeams.forEach(t => {
            const isPlayer = t.id === gameState.playerTeam.id;
            const rowClass = isPlayer ? 'bg-amber-100 font-bold' : 'bg-white';

            tableHtml += `
                <tr class="${rowClass}">
                    <td class="py-2 px-3 text-left">${t.name}</td>
                    <td class="text-center py-2 px-3 font-semibold">${t.wins || 0}</td>
                    <td class="text-center py-2 px-3 text-gray-600">${t.losses || 0}</td>
                    <td class="text-center py-2 px-3 text-gray-400">${t.ties || 0}</td>
                </tr>`;
        });

        tableHtml += `</tbody></table>`;
        divEl.innerHTML = tableHtml;
        elements.standingsContainer.appendChild(divEl);
    }
}

/** Renders the 'Player Stats' tab content. */
function renderPlayerStatsTab(gameState) {
    if (!elements.playerStatsContainer) return;

    if (!gameState?.players || !Array.isArray(gameState.players)) {
        elements.playerStatsContainer.innerHTML = '<p class="text-red-500 p-4">Player stats unavailable.</p>';
        return;
    }

    const teamIdFilter = elements.statsFilterTeam?.value || '';
    const sortStat = elements.statsSort?.value || 'touchdowns';

    // Filter and Sort
    let playersToShow = gameState.players.filter(p => p && (teamIdFilter ? p.teamId === teamIdFilter : true));

    playersToShow.sort((a, b) => {
        const valA = a.seasonStats?.[sortStat] || 0;
        const valB = b.seasonStats?.[sortStat] || 0;
        return valB - valA; // Descending
    });

    // Limit to top 50 to improve performance
    playersToShow = playersToShow.slice(0, 50);

    const statsConfig = [
        { key: 'passYards', label: 'PASS YDS' },
        { key: 'passCompletions', label: 'COMP' },
        { key: 'rushYards', label: 'RUSH YDS' },
        { key: 'recYards', label: 'REC YDS' },
        { key: 'receptions', label: 'REC' },
        { key: 'touchdowns', label: 'TD' },
        { key: 'tackles', label: 'TKL' },
        { key: 'sacks', label: 'SACK' },
        { key: 'interceptions', label: 'INT' }
    ];

    let tableHtml = `
        <div class="overflow-x-auto">
        <table class="min-w-full bg-white text-sm">
            <thead class="bg-gray-800 text-white sticky top-0 z-10">
                <tr>
                    <th class="py-2 px-3 text-left sticky left-0 bg-gray-800 z-20">Name</th>
                    <th class="py-2 px-3 text-left">Team</th>
                    ${statsConfig.map(s => `<th class="py-2 px-3 text-center whitespace-nowrap">${s.label}</th>`).join('')}
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-200">
    `;

    if (playersToShow.length === 0) {
        tableHtml += `<tr><td colspan="${statsConfig.length + 2}" class="p-4 text-center text-gray-500">No stats found.</td></tr>`;
    } else {
        playersToShow.forEach(p => {
            const isMyTeam = p.teamId === gameState.playerTeam.id;
            const teamName = gameState.teams.find(t => t.id === p.teamId)?.name || 'FA';

            tableHtml += `
                <tr class="${isMyTeam ? 'bg-amber-50' : 'hover:bg-gray-50'}">
                    <td class="py-2 px-3 font-semibold sticky left-0 ${isMyTeam ? 'bg-amber-50' : 'bg-white'} z-10">${p.name}</td>
                    <td class="py-2 px-3 text-gray-500 text-xs">${teamName}</td>
                    ${statsConfig.map(s => `
                        <td class="text-center py-2 px-3 ${s.key === sortStat ? 'font-bold text-black' : 'text-gray-600'}">
                            ${p.seasonStats?.[s.key] || 0}
                        </td>
                    `).join('')}
                </tr>`;
        });
    }

    elements.playerStatsContainer.innerHTML = tableHtml + `</tbody></table></div>`;
}

/** Renders the 'Hall of Fame' tab content. */
function renderHallOfFameTab(gameState) {
    if (!elements.hallOfFameList) return;

    if (!gameState?.hallOfFame || gameState.hallOfFame.length === 0) {
        elements.hallOfFameList.innerHTML = `
            <div class="p-8 text-center text-gray-400 border-2 border-dashed border-gray-300 rounded-lg">
                <p>The Hall of Fame is currently empty.</p>
                <p class="text-xs mt-2">Players are inducted upon retirement if they meet specific criteria.</p>
            </div>`;
        return;
    }

    elements.hallOfFameList.innerHTML = '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
        gameState.hallOfFame.map(p => {
            return `
            <div class="bg-gradient-to-br from-amber-50 to-white p-4 rounded-lg shadow border border-amber-200">
                <div class="flex justify-between items-start mb-2">
                    <h4 class="font-bold text-lg text-amber-800">${p.name}</h4>
                    <span class="text-xs bg-amber-200 text-amber-800 px-2 py-1 rounded-full">Inducted Year ${p.retiredYear || '?'}</span>
                </div>
                <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-700">
                    <span>TDs: <strong>${p.careerStats?.touchdowns || 0}</strong></span>
                    <span>Pass Yds: <strong>${p.careerStats?.passYards || 0}</strong></span>
                    <span>Rush Yds: <strong>${p.careerStats?.rushYards || 0}</strong></span>
                    <span>Rec Yds: <strong>${p.careerStats?.recYards || 0}</strong></span>
                    <span>Tackles: <strong>${p.careerStats?.tackles || 0}</strong></span>
                    <span>Sacks: <strong>${p.careerStats?.sacks || 0}</strong></span>
                </div>
            </div>`;
        }).join('') +
        '</div>';
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
        // FIX: Use closest()
        const target = e.target.closest('.bench-player-row') || e.target.closest('.player-slot-visual[draggable="true"]');

        if (target) {
            draggedEl = target;
            dragPlayerId = target.dataset.playerId;
            dragSide = target.dataset.side;

            if (dragPlayerId && dragSide) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', dragPlayerId);
                setTimeout(() => draggedEl?.classList.add('dragging'), 0);
            } else {
                e.preventDefault();
            }
        } else {
            e.preventDefault();
        }
    });

    container.addEventListener('dragend', e => {
        if (draggedEl) {
            draggedEl.classList.remove('dragging');
        }
        draggedEl = null; dragPlayerId = null; dragSide = null;
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });

    container.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        // --- 💡 FIX: Target the new visual slot ---
        const targetSlot = e.target.closest('.player-slot-visual');

        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

        if (targetSlot && targetSlot.dataset.side === dragSide) {
            targetSlot.classList.add('drag-over');
        }
    });

    container.addEventListener('dragleave', e => {
        const targetSlot = e.target.closest('.player-slot-visual');
        if (targetSlot) {
            targetSlot.classList.remove('drag-over');
        }
        if (!e.relatedTarget || !container.contains(e.relatedTarget)) {
            document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        }
    });

    container.addEventListener('drop', e => {
        e.preventDefault();
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

        // --- 💡 FIX: Target the new visual slot ---
        const dropSlot = e.target.closest('.player-slot-visual');
        const dropSide = dropSlot?.dataset.side;

        if (dropSlot && dropSlot.dataset.positionSlot && dragPlayerId && dropSide === dragSide) {
            onDrop(dragPlayerId, dropSlot.dataset.positionSlot, dropSide);
        } else {
            console.log("Invalid drop target.");
        }
        draggedEl = null; dragPlayerId = null; dragSide = null;
    });
}

/** Sets up event listener for depth chart sub-tabs (Offense/Defense/Overalls). */
export function setupDepthChartTabs() {
    const subTabs = document.querySelectorAll(".depth-chart-tab");

    subTabs.forEach(tab => {
        tab.addEventListener("click", () => {
            const subTab = tab.dataset.subTab;

            // Update active class
            subTabs.forEach(t => {
                if (t.dataset.subTab === subTab) {
                    t.classList.add("active", "text-amber-600", "border-amber-500");
                } else {
                    t.classList.remove("active", "text-amber-600", "border-amber-500");
                }
            });

            // Show / hide sub-panes
            const offensePane = document.getElementById("depth-chart-offense-pane");
            const defensePane = document.getElementById("depth-chart-defense-pane");
            const overallsPane = document.getElementById("positional-overalls-container");
            const depthOrderPane = document.getElementById("depth-order-container");

            offensePane.classList.toggle("hidden", subTab !== "offense");
            defensePane.classList.toggle("hidden", subTab !== "defense");
            overallsPane.classList.toggle("hidden", subTab !== "overalls");
            depthOrderPane.classList.toggle("hidden", subTab !== "depth-order");

            // Render tab content as needed
            if (subTab === "overalls") renderPositionalOveralls();
            if (subTab === "depth-order") renderDepthOrderPane(getGameState());
        });
    });
}

/**
 * 💡 FIX: Attach listeners to formation dropdowns.
 * Call this inside setupElements() or renderDepthChartTab().
 */
export function setupFormationListeners() {
    const offSelect = document.getElementById('offense-formation-select');
    const defSelect = document.getElementById('defense-formation-select');

    const handleFormationChange = (side, event) => {
        const newFormationName = event.target.value;
        if (!newFormationName) return;

        // 1. Snapshot the CURRENT (Old) assignments before they are wiped
        const gs = getGameState();
        // Create a shallow copy so we don't reference the object that gets wiped
        const oldChart = { ...gs.playerTeam.depthChart[side] };

        // 2. Execute the Formation Change (This resets the backend to defaults)
        changeFormation(side, newFormationName);

        // 3. Restore Players (Wrapped in setTimeout to run NEXT in the event loop)
        // This ensures 'changeFormation' is 100% complete before we apply fixes.
        setTimeout(() => {
            // Look up the definition of the NEW formation to see which slots exist
            const formationData = side === 'offense'
                ? offenseFormations[newFormationName]
                : defenseFormations[newFormationName];

            if (formationData && formationData.slots) {
                const validSlots = new Set(formationData.slots);

                // Iterate through our saved Snapshot
                Object.entries(oldChart).forEach(([slot, playerId]) => {
                    // If the player exists AND the new formation allows this slot (e.g. "QB1" -> "QB1")
                    if (playerId && validSlots.has(slot)) {

                        // Dispatch the event to put them back
                        const restoreEvent = new CustomEvent('depth-chart-changed', {
                            detail: {
                                playerId: playerId,
                                slot: slot,
                                side: side
                            }
                        });
                        document.dispatchEvent(restoreEvent);
                    }
                });
            }

            // 4. Force a UI Refresh only AFTER all restoration events have fired
            const refreshEvent = new CustomEvent('refresh-ui');
            document.dispatchEvent(refreshEvent);

        }, 50); // 50ms delay is imperceptible to user but huge for the event loop
    };

    if (offSelect) {
        // Remove old listeners to be safe (though usually not strictly necessary if elements are static)
        offSelect.onchange = (e) => handleFormationChange('offense', e);
    }
    if (defSelect) {
        defSelect.onchange = (e) => handleFormationChange('defense', e);
    }
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

        // Jiggle logic for engagement
        let jiggleX = 0;
        let jiggleY = 0;
        if (player.isEngaged) {
            const jiggleAmount = 0.8;
            jiggleX = (Math.random() - 0.5) * jiggleAmount;
            jiggleY = (Math.random() - 0.5) * jiggleAmount;
        }

        const drawX = player.y * scaleX + jiggleX;
        const drawY = player.x * scaleY + jiggleY;

        // Draw engagement halo
        if (player.isEngaged) {
            const gradient = ctx.createRadialGradient(drawX, drawY, 3, drawX, drawY, 10);
            gradient.addColorStop(0, 'rgba(255,255,255,0.12)');
            gradient.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(drawX, drawY, 10, 0, Math.PI * 2);
            ctx.fill();
        }

        // Draw stun effect
        if (player.stunnedTicks > 0) {
            const pulse = (Math.sin(Date.now() / 200) + 1) / 2;
            const pulseRadius = 8 + (pulse * 6);
            const pulseAlpha = 0.5 + (pulse * 0.4);

            ctx.save();
            ctx.beginPath();
            ctx.arc(drawX, drawY, pulseRadius, 0, Math.PI * 2);
            const stunGradient = ctx.createRadialGradient(drawX, drawY, 3, drawX, drawY, pulseRadius);
            stunGradient.addColorStop(0, `rgba(220, 38, 38, ${pulseAlpha})`);
            stunGradient.addColorStop(1, 'rgba(220, 38, 38, 0)');
            ctx.fillStyle = stunGradient;
            ctx.fill();
            ctx.restore();
        }

        // Draw player body
        const playerColor = player.primaryColor || (player.isOffense ? '#3b82f6' : '#ef4444');

        // Shadow
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

        // Ball carrier indicator
        if (player.isBallCarrier) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(drawX, drawY, 12, 0, Math.PI * 2);
            ctx.lineWidth = 3;
            ctx.strokeStyle = player.secondaryColor || 'rgba(251, 191, 36, 0.95)';
            ctx.stroke();
            ctx.restore();
        }

        // --- 💡 MOVEMENT TRAIL REMOVED HERE --- 

        // Draw player number/position text
        const displayPosition = (player.slot ? player.slot.replace(/\d+/g, '') : '') || player.position || player.favoriteOffensivePosition || player.favoriteDefensivePosition || '';

        let displayNumber;
        if (player.number != null && player.number !== '') {
            displayNumber = player.number.toString();
        } else {
            const seed = (player.name || player.id || 'player').toString();
            let sum = 0;
            for (let i = 0; i < seed.length; i++) sum += seed.charCodeAt(i);
            displayNumber = ((sum % 99) + 1).toString();
        }

        if (displayPosition) {
            ctx.font = '9px "Inter"';
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(displayPosition, drawX + 1, drawY - 11);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.fillText(displayPosition, drawX, drawY - 12);
        }

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
        return;
    }
    const { homeTeam, awayTeam } = gameResult;

    // Helper function to find top players and format their stats
    const generateTeamStatsHtml = (team) => {
        if (!team || !team.roster || team.roster.length === 0) return '<h5>No Player Data</h5>';

        // 💡 FIX: Convert Roster IDs to Player Objects so we can read stats
        const fullRoster = getUIRosterObjects(team);

        // Filters and sorts roster to find a specific stat leader
        const findTopStat = (statName) => fullRoster
            .filter(p => p && p.gameStats && p.gameStats[statName] > 0)
            .sort((a, b) => (b.gameStats[statName] || 0) - (a.gameStats[statName] || 0))[0];

        // --- OFFENSIVE LEADERS ---
        const qb = fullRoster.find(p => p && p.gameStats && p.gameStats.passAttempts > 0);
        const leadingRusher = findTopStat('rushYards');
        const leadingReceiver = findTopStat('recYards');
        const offensivePlayersLogged = new Set();

        let html = `<h5 class="text-lg font-semibold text-amber-400 mb-1 border-b border-gray-600 pb-1">${team.name}</h5>`;

        // 1. QB Stats
        if (qb) {
            html += `<p class="text-sm">${qb.name}: <strong>${qb.gameStats.passCompletions}/${qb.gameStats.passAttempts}, ${qb.gameStats.passYards} yds, ${qb.gameStats.touchdowns} TD, ${qb.gameStats.interceptionsThrown} INT</strong></p>`;
            offensivePlayersLogged.add(qb.id);
        }

        // 2. Running Leader
        if (leadingRusher && !offensivePlayersLogged.has(leadingRusher.id)) {
            html += `<p class="text-sm">${leadingRusher.name}: <strong>${leadingRusher.gameStats.rushYards} Rush Yds, ${leadingRusher.gameStats.touchdowns} TD</strong></p>`;
            offensivePlayersLogged.add(leadingRusher.id);
        }

        // 3. Receiving Leader
        if (leadingReceiver && !offensivePlayersLogged.has(leadingReceiver.id)) {
            let recHtml = `<p class="text-sm">${leadingReceiver.name}: <strong>${leadingReceiver.gameStats.receptions} Rec, ${leadingReceiver.gameStats.recYards} Yds, ${leadingReceiver.gameStats.touchdowns} TD`;
            if (leadingReceiver.gameStats.drops > 0) recHtml += `, ${leadingReceiver.gameStats.drops} Drop`;
            recHtml += `</strong></p>`;
            html += recHtml;
            offensivePlayersLogged.add(leadingReceiver.id);
        }

        // 4. Fumble Leaders (offensive turnovers)
        const fumbleLeader = fullRoster.filter(p => p && p.gameStats && p.gameStats.fumblesLost > 0)
            .sort((a, b) => (b.gameStats.fumblesLost || 0) - (a.gameStats.fumblesLost || 0))[0];
        if (fumbleLeader && !offensivePlayersLogged.has(fumbleLeader.id)) {
            html += `<p class="text-sm text-red-300">${fumbleLeader.name}: <strong>${fumbleLeader.gameStats.fumblesLost} Fum Lost</strong></p>`;
            offensivePlayersLogged.add(fumbleLeader.id);
        }

        // --- DEFENSIVE LEADERS ---
        const defensiveLeaders = [];

        fullRoster.forEach(p => {
            if (p?.gameStats && (p.gameStats.tackles > 0 || p.gameStats.sacks > 0 || p.gameStats.interceptions > 0 || p.gameStats.fumblesRecovered > 0)) {
                if (offensivePlayersLogged.has(p.id)) return;
                defensiveLeaders.push(p);
            }
        });

        // Sort by "Impact" (Int > Sack > FumRec > Tackle)
        defensiveLeaders.sort((a, b) => {
            const scoreA = (a.gameStats.interceptions * 10) + (a.gameStats.fumblesRecovered * 8) + (a.gameStats.sacks * 5) + a.gameStats.tackles;
            const scoreB = (b.gameStats.interceptions * 10) + (b.gameStats.fumblesRecovered * 8) + (b.gameStats.sacks * 5) + b.gameStats.tackles;
            return scoreB - scoreA;
        });

        // 5. Print Top 3 Defenders
        defensiveLeaders.slice(0, 3).forEach(d => {
            let defHtml = `<p class="text-sm">${d.name}: <strong>${d.gameStats.tackles} Tkl`;
            if (d.gameStats.sacks > 0) defHtml += `, ${d.gameStats.sacks} Sack`;
            if (d.gameStats.interceptions > 0) defHtml += `, ${d.gameStats.interceptions} INT`;
            if (d.gameStats.fumblesRecovered > 0) defHtml += `, ${d.gameStats.fumblesRecovered} FR`;
            defHtml += `</strong></p>`;
            html += defHtml;
        });

        if (offensivePlayersLogged.size === 0 && defensiveLeaders.length === 0) {
            html += '<p class="text-gray-400 text-xs">No significant stats.</p>';
        }

        return html;
    };

    // 💡 FIXED: Correctly assign away team stats to away stats box and home team to home stats box
    elements.simStatsAway.innerHTML = generateTeamStatsHtml(awayTeam);
    elements.simStatsHome.innerHTML = generateTeamStatsHtml(homeTeam);
}

// ------------------
// Live stats helpers
// ------------------
function initLiveGameStats(gameResult) {
    liveGameStats = { home: { yards: 0, td: 0, turnovers: 0, punts: 0, returns: 0 }, away: { yards: 0, td: 0, turnovers: 0, punts: 0, returns: 0 } };
    // Optionally seed from gameResult if you want starting values
}

function initLivePlayerStats(gameResult) {
    livePlayerStats = new Map();
    if (!gameResult) return;
    const homeRoster = getUIRosterObjects(gameResult.homeTeam || {});
    const awayRoster = getUIRosterObjects(gameResult.awayTeam || {});
    const all = [...homeRoster, ...awayRoster];
    all.forEach(p => {
        if (!p || !p.id) return;
        livePlayerStats.set(p.id, {
            passAttempts: 0, passCompletions: 0, passYards: 0, interceptionsThrown: 0,
            receptions: 0, recYards: 0, drops: 0,
            rushAttempts: 0, rushYards: 0,
            returnYards: 0,
            touchdowns: 0, interceptions: 0, fumbles: 0
        });
    });
}

function updateStatsFromLogEntry(entry) {
    if (!entry || !currentLiveGameResult) return;

    // --- 1. Helper: Find Player ID by Name ---
    // We need this because logs contain Names ("Tom Brady"), but stats are keyed by ID.
    const findIdByName = (name) => {
        if (!name) return null;
        const homeRoster = getUIRosterObjects(currentLiveGameResult.homeTeam);
        const awayRoster = getUIRosterObjects(currentLiveGameResult.awayTeam);
        const p = [...homeRoster, ...awayRoster].find(pl => pl.name === name);
        return p ? p.id : null;
    };

    // --- 2. Helper: Get Stats Object ---
    const getStats = (pid) => {
        if (!pid) return null;
        if (!livePlayerStats.has(pid)) {
            livePlayerStats.set(pid, {
                passAttempts: 0, passCompletions: 0, passYards: 0, interceptionsThrown: 0,
                receptions: 0, recYards: 0, drops: 0,
                rushAttempts: 0, rushYards: 0,
                returnYards: 0,
                touchdowns: 0, interceptions: 0, fumbles: 0, fumblesLost: 0, fumblesRecovered: 0,
                tackles: 0, sacks: 0
            });
        }
        return livePlayerStats.get(pid);
    };

    // --- 3. Parse Logic ---

    // A. New Play / Context Reset
    if (entry.includes('---') || entry.includes('Offense:')) {
        livePlayContext = { type: 'run', passerId: null, receiverId: null, catchMade: false };
        if (entry.includes('Offense:')) {
            // Try to detect play type from name (e.g., "Offense: Spread_Three_Verts")
            if (entry.toLowerCase().includes('pass') || entry.toLowerCase().includes('verts') || entry.toLowerCase().includes('slants')) {
                livePlayContext.type = 'pass';
            }
        }
    }

    // B. Pass Attempt
    // Log: "🏈 [Name] throws to..."
    const throwMatch = entry.match(/🏈 (.*?) throws to/);
    if (throwMatch) {
        livePlayContext.type = 'pass'; // Confirm it's a pass
        const qbId = findIdByName(throwMatch[1]);
        if (qbId) {
            livePlayContext.passerId = qbId;
            const s = getStats(qbId);
            s.passAttempts++;
        }
    }

    // C. Reception
    // Log: "👍 CATCH! [Name] makes the reception!"
    const catchMatch = entry.match(/CATCH! (.*?) makes/);
    if (catchMatch) {
        livePlayContext.catchMade = true;
        const recId = findIdByName(catchMatch[1]);
        if (recId) {
            livePlayContext.receiverId = recId;
            const s = getStats(recId);
            s.receptions++;
        }
        // Credit Completion to QB immediately
        if (livePlayContext.passerId) {
            getStats(livePlayContext.passerId).passCompletions++;
        }
    }

    // D. Yards Gained (The big one)
    // Log: "✋ [Name] tackled by ... for a gain of X" OR "run out of bounds after a gain of X"
    // We look for the player name at the start of the interaction
    const gainMatch = entry.match(/(?:✋|🎉) (.*?) (?:tackled|ran out|scores|returns)/);
    const yardsMatch = entry.match(/gain of (-?\d+\.?\d*)|loss of (\d+\.?\d*)/);

    if (gainMatch && yardsMatch) {
        const carrierName = gainMatch[1];
        const carrierId = findIdByName(carrierName);
        const yards = parseFloat(yardsMatch[1] || `-${yardsMatch[2]}`);

        if (carrierId) {
            const s = getStats(carrierId);

            if (livePlayContext.type === 'pass' && livePlayContext.catchMade) {
                // It's a catch -> Receiving Yards
                s.recYards += Math.round(yards);

                // Credit Passing Yards to QB
                if (livePlayContext.passerId) {
                    getStats(livePlayContext.passerId).passYards += Math.round(yards);
                }
            } else if (livePlayContext.type === 'run' || (livePlayContext.type === 'pass' && !livePlayContext.passerId)) {
                // It's a run (or a scramble where 'throws to' never happened)
                // Only credit rush attempt if it wasn't a sack (sacks handled below)
                if (!entry.includes('SACK')) {
                    s.rushYards += Math.round(yards);
                    // Avoid double counting carries on the same play (logs sometimes duplicate context)
                    // We assume 1 carry per log entry with "gain of" for simplicity in live sim
                    s.rushAttempts++;
                }
            }
        }
    }

    // E. Touchdowns
    if (entry.includes('TOUCHDOWN')) {
        // Log: "🎉 TOUCHDOWN [Name]!"
        const tdMatch = entry.match(/TOUCHDOWN (.*?)!/);
        if (tdMatch) {
            const scorerId = findIdByName(tdMatch[1]);
            if (scorerId) {
                getStats(scorerId).touchdowns++;

                // If it was a pass, credit QB
                if (livePlayContext.type === 'pass' && livePlayContext.catchMade && livePlayContext.passerId) {
                    getStats(livePlayContext.passerId).touchdowns++;
                }
            }
        }
    }

    // F. Interceptions
    if (entry.includes('INTERCEPTION')) {
        // Log: "❗ INTERCEPTION! [Name] jumps the route!"
        const intMatch = entry.match(/INTERCEPTION! (.*?) jumps/);
        if (intMatch) {
            const defId = findIdByName(intMatch[1]);
            if (defId) getStats(defId).interceptions++;

            // Credit QB with INT thrown
            if (livePlayContext.passerId) {
                getStats(livePlayContext.passerId).interceptionsThrown++;
            }
        }
    }

    // G. Sacks
    if (entry.includes('SACK!')) {
        // Log: "💥 SACK! [Defender] drops [QB]!"
        const sackMatch = entry.match(/SACK! (.*?) drops (.*?)!/);
        if (sackMatch) {
            const defId = findIdByName(sackMatch[1]);
            const qbId = findIdByName(sackMatch[2]);
            if (defId) getStats(defId).sacks++;
            // Sacks count as negative rush yards in this engine usually, 
            // handled by the "gain/loss" logic if the log line appears, 
            // but we don't add a rush attempt.
        }
    }
}

function renderLiveStatsLive() {
    if (!elements.simLiveStats || !currentLiveGameResult) return;
    const home = currentLiveGameResult.homeTeam || {};
    const away = currentLiveGameResult.awayTeam || {};
    const homeName = home.name || 'Home';
    const awayName = away.name || 'Away';

    const h = liveGameStats.home;
    const a = liveGameStats.away;

    // --- Helper to build individual stats lines ---
    const getTopPerformersHtml = (team) => {
        if (!team) return '';
        const roster = getUIRosterObjects(team);
        const playersWithStats = roster.map(p => {
            const stats = livePlayerStats.get(p.id);
            // Return player object merged with their live stats if they exist
            return stats ? { name: p.name, ...stats } : null;
        }).filter(p => p); // Remove nulls

        let html = '';

        // 1. Passing Leader (Current QB)
        const qb = playersWithStats.find(p => p.passAttempts > 0);
        if (qb) {
            html += `<div class="text-xs text-gray-300 mt-1 truncate">
                <span class="text-amber-400">${qb.name}</span>: ${qb.passCompletions}/${qb.passAttempts}, ${qb.passYards} yds
                ${qb.touchdowns > 0 ? `, ${qb.touchdowns} TD` : ''}
                ${qb.interceptionsThrown > 0 ? `, ${qb.interceptionsThrown} INT` : ''}
            </div>`;
        }

        // 2. Rushing Leader
        const rusher = playersWithStats
            .filter(p => p.rushAttempts > 0)
            .sort((a, b) => b.rushYards - a.rushYards)[0];

        if (rusher) {
            html += `<div class="text-xs text-gray-300 truncate">
                <span class="text-blue-300">${rusher.name}</span>: ${rusher.rushAttempts} car, ${rusher.rushYards} yds
                ${rusher.touchdowns > 0 ? `, ${rusher.touchdowns} TD` : ''}
            </div>`;
        }

        // 3. Receiving Leader
        const receiver = playersWithStats
            .filter(p => p.receptions > 0)
            .sort((a, b) => b.recYards - a.recYards)[0];

        if (receiver) {
            html += `<div class="text-xs text-gray-300 truncate">
                <span class="text-green-300">${receiver.name}</span>: ${receiver.receptions} rec, ${receiver.recYards} yds
                ${receiver.touchdowns > 0 ? `, ${receiver.touchdowns} TD` : ''}
            </div>`;
        }

        return html;
    };

    // --- Build Final HTML ---
    const html = `
        <div class="flex justify-between h-full">
            <div class="w-1/2 pr-2 border-r border-gray-700">
                <h5 class="text-sm font-bold text-white mb-1">${awayName}</h5>
                <p class="text-xs text-gray-400 mb-2">
                    Yds: <strong class="text-white">${a.yards}</strong> • 
                    TOs: <strong class="text-white">${a.turnovers}</strong>
                </p>
                
                <div class="space-y-1">
                    ${getTopPerformersHtml(away)}
                </div>
            </div>

            <div class="w-1/2 pl-2">
                <h5 class="text-sm font-bold text-white mb-1">${homeName}</h5>
                <p class="text-xs text-gray-400 mb-2">
                    Yds: <strong class="text-white">${h.yards}</strong> • 
                    TOs: <strong class="text-white">${h.turnovers}</strong>
                </p>

                <div class="space-y-1">
                    ${getTopPerformersHtml(home)}
                </div>
            </div>
        </div>
    `;

    elements.simLiveStats.innerHTML = html;
}

function renderSimPlayers(frame) {
    const findTeamInResult = (playerTeamId) => {
        if (!currentLiveGameResult) return null;
        if (currentLiveGameResult.homeTeam?.id === playerTeamId) return currentLiveGameResult.homeTeam;
        if (currentLiveGameResult.awayTeam?.id === playerTeamId) return currentLiveGameResult.awayTeam;
        return null;
    };

    try {
        if (!elements.simPlayersList || !currentLiveGameResult) {
            return;
        }

        const gs = getGameState();
        const playerTeamId = gs?.playerTeam?.id;
        const team = findTeamInResult(playerTeamId); // This is the team object with roster IDs

        if (!team || !playerTeamId) {
            elements.simPlayersList.innerHTML = '<p class="text-gray-400">No team data available for this game.</p>';
            return;
        }

        const roster = getUIRosterObjects(team);
        const depth = team.depthChart || {};

        const fatigueMap = new Map();
        if (frame && frame.players) {
            frame.players.forEach(pState => {
                if (pState.teamId === team.id) {
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
            const currentFatigue = fatigueMap.get(p.id) || 0;
            const fatigue = Math.max(0, Math.min(100, Math.round(currentFatigue)));
            const energyPct = Math.max(0, Math.round(100 - (fatigue / Math.max(1, stamina)) * 100));

            // 💡 FIX: Find the player's current slot from the depth chart
            let currentSlot = 'Bench';
            if (isStarter) {
                for (const side in depth) {
                    for (const slot in depth[side]) {
                        if (depth[side][slot] === p.id) {
                            currentSlot = slot;
                            break;
                        }
                    }
                    if (currentSlot !== 'Bench') break;
                }
            }
            // 💡 END FIX

            // 💡 FIX: Use the 'status' object from the main player object in 'roster'
            const statusText = (p.status?.duration > 0) ? `${p.status.description} (${p.status.duration}w)` : 'Healthy';
            const statusClass = (p.status?.duration > 0) ? 'text-red-400' : 'text-gray-300';
            // 💡 END FIX

            return `
                <div class="flex items-center justify-between p-2 border-b border-gray-600">
                    <div class="flex items-center gap-3">
                        <div class="w-36">
                            <div class="text-sm font-semibold">${p.name}</div>
                            <div class="text-xs text-gray-300">#${p.number || '—'} • ${currentSlot}</div>
                        </div>
                        <div class="w-40">
                            <div class="relative h-3 bg-gray-600 rounded">
                                <div style="width:${energyPct}%" class="absolute left-0 top-0 h-3 bg-amber-400 rounded"></div>
                            </div>
                            <div class="text-xs text-gray-300">Energy: ${energyPct}% • Fatigue: ${fatigue.toFixed(1)}</div>
                        </div>
                        <div class="text-xs ${statusClass} w-28">Status: ${statusText}</div>
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
                const inId = btn.dataset.playerId;
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
                const outId = btn.dataset.playerId;
                // Choose incoming bench player to swap with
                const benchPlayers = roster.filter(p => p && !starterIds.has(p.id));
                if (benchPlayers.length === 0) {
                    showModal('No Bench', '<p>No bench players available to sub in.</p>', null, 'OK');
                    return;
                }
                const options = benchPlayers.map(b => `<option value="${b.id}">${b.name} (#${b.number || '—'})</option>`).join('');
                const selectHtml = `<select id="_sub_in_select" class="w-full p-2 bg-white text-black">${options}</select>`;
                showModal('Select Bench Player to Sub In', selectHtml, () => {
                    // --- 💡💡💡 THIS IS THE FIX 💡💡💡 ---
                    // Player IDs are strings (UUIDs), not integers.
                    const inId = document.getElementById('_sub_in_select')?.value;
                    // --- 💡💡💡 END OF FIX 💡💡💡 ---

                    if (!inId) return;

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
        // Render final stats now that the sim has concluded
        try { renderLiveStatsBox(finalResult); } catch (e) { console.error('renderLiveStatsBox final render error:', e); }
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

    let playHasEnded = false; // Flag to track end of play

    // --- 3. Sync Log Entries & Update State (The Combined Step) ---
    if (ticker && frame.logIndex > liveGameLogIndex) {
        for (let i = liveGameLogIndex; i < frame.logIndex; i++) {
            const playLogEntry = allLogs[i];
            if (!playLogEntry) continue;

            const p = document.createElement('p');
            let styleClass = '';
            let descriptiveText = playLogEntry;

            // --- COMBINED LOGIC: Parse log AND set styles ---
            try {
                if (playLogEntry.includes('Conversion Attempt')) {
                    liveGameIsConversion = true; // Set the flag
                    styleClass = 'font-bold text-amber-400 mt-2';
                    descriptiveText = `🏈 ${playLogEntry} 🏈`;
                }
                // --- SMART UI: Update Broadcast Banner from Logs ---
                if (playLogEntry.includes('**Offense:**')) {
                    // Strip the emoji and bold markdown to get clean text
                    const cleanText = playLogEntry.replace('🏈', '').replace(/\*\*/g, '').replace('Offense:', '').trim();
                    if (elements.simBannerOffense) elements.simBannerOffense.textContent = cleanText;

                    // Reset defense text when new play starts
                    if (elements.simBannerDefense) elements.simBannerDefense.textContent = "...";

                    // Visual Pulse Effect
                    if (elements.simMatchupBanner) {
                        elements.simMatchupBanner.classList.add('bg-gray-800');
                        setTimeout(() => elements.simMatchupBanner?.classList.remove('bg-gray-800'), 200);
                    }
                }

                if (playLogEntry.includes('**Defense:**')) {
                    const cleanText = playLogEntry.replace('🛡️', '').replace(/\*\*/g, '').replace('Defense:', '').trim();
                    if (elements.simBannerDefense) elements.simBannerDefense.textContent = cleanText;
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

                    // --- 💡💡💡 START PUNT LOGIC FIX 💡💡💡 ---
                } else if (playLogEntry.includes('PUNT by')) {
                    styleClass = 'font-semibold text-blue-300'; // Special teams color
                    descriptiveText = playLogEntry;
                    // This log is an *outcome* if it includes one of these phrases
                    if (playLogEntry.includes('TOUCHBACK') || playLogEntry.includes('FAIR CATCH') || playLogEntry.includes('returns for') || playLogEntry.includes('No healthy returner')) {
                        liveGameDriveActive = false;
                        playHasEnded = true;
                    }
                    // If it's just "PUNT by..." it's part of a muff sequence, so we don't end the play

                } else if (playLogEntry.includes('MUFFED PUNT')) {
                    styleClass = 'font-bold text-red-500';
                    descriptiveText = playLogEntry;
                    playHasEnded = false; // The muff itself doesn't pause, the recovery does

                } else if (playLogEntry.includes('recovers the muff')) {
                    // **CRITICAL FIX**: This logic was inverted.
                    // If the offense's name is in the log, they kept possession.
                    liveGameDriveActive = playLogEntry.includes(liveGamePossessionName);
                    styleClass = 'font-semibold text-yellow-300';
                    descriptiveText = playLogEntry;
                    playHasEnded = true; // The recovery is the end of the play

                } else if (playLogEntry.includes('PUNT FAILED')) {
                    liveGameDriveActive = false;
                    styleClass = 'font-bold text-red-500';
                    descriptiveText = playLogEntry;
                    playHasEnded = true;
                    // --- 💡💡💡 END PUNT LOGIC FIX 💡💡💡 ---

                } else if (playLogEntry.startsWith('🎉 TOUCHDOWN') || playLogEntry.startsWith('🎉 PUNT RETURN TOUCHDOWN')) {
                    if (!liveGameIsConversion) {
                        // 💡 ENHANCED: Correctly attribute TDs to the team that just scored
                        // Check which team's name appears in the log entry
                        const homeName = currentLiveGameResult.homeTeam?.name || '';
                        const awayName = currentLiveGameResult.awayTeam?.name || '';

                        let isHomeTD = false;

                        // First priority: check if either team name is explicitly mentioned
                        if (playLogEntry.includes(homeName)) {
                            isHomeTD = true;
                        } else if (playLogEntry.includes(awayName)) {
                            isHomeTD = false;
                        }
                        // Fallback: if return TD and no team mentioned, it's the opposing team
                        else if (playLogEntry.includes('RETURN TOUCHDOWN')) {
                            // Return TDs are scored by the team that's NOT on offense
                            isHomeTD = liveGamePossessionName !== homeName;
                        }
                        // Last resort: attribute to team with possession (shouldn't reach here)
                        else {
                            isHomeTD = liveGamePossessionName === homeName;
                        }

                        if (isHomeTD) {
                            liveGameCurrentHomeScore += 6;
                        } else {
                            liveGameCurrentAwayScore += 6;
                        }
                    }

                } else if (playLogEntry.includes('SAFETY') || playLogEntry.includes('Safety')) {
                    // Safety = 2 points for the Defense (the team NOT with the ball)
                    if (liveGamePossessionName === currentLiveGameResult.homeTeam.name) {
                        liveGameCurrentAwayScore += 2;
                    } else {
                        liveGameCurrentHomeScore += 2;
                    }

                    liveGameDriveActive = false; // Ends the drive
                    styleClass = 'font-bold text-red-500 text-lg';
                    descriptiveText = `🚨 ${playLogEntry} (+2 Pts)`;
                    playHasEnded = true;

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
                else if (playLogEntry.includes('Play ends') || playLogEntry.includes('⏱️')) {
                    // 💡 FIX: Catch-all for end of play
                    styleClass = 'text-gray-400 italic';
                    descriptiveText = playLogEntry;
                    playHasEnded = true;
                }

                if (liveGameDown > 4 && liveGameDriveActive) {
                    liveGameDriveActive = false;
                    // Note: The "Turnover on downs!" log will trigger 'playHasEnded' on its own
                }

            } catch (parseError) {
                console.error("Error parsing log entry for sim state:", playLogEntry, parseError);
            }

            // Update lightweight live stats from this entry
            try {
                updateStatsFromLogEntry(playLogEntry);
            } catch (err) { console.error('Error updating live stats from log:', err); }

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
        // Render compact live stats summary
        try { renderLiveStatsLive(); } catch (e) { console.error('renderLiveStatsLive error:', e); }
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

    // --- NEW: Huddle Logic ---
    if (playHasEnded && liveGameCurrentIndex < allFrames.length) {
        // The play is over! Stop the "action" clock.
        clearInterval(liveGameInterval);
        liveGameInterval = null;
        clearTimeout(huddleTimeout);

        // 💡 UPDATED TIMING:
        // 2.0 seconds to view the tackle (Post-Play)
        // + 2.5 seconds for the Huddle/Log reading
        // = 4.5 seconds Total Pause before the next lineup appears
        const POST_PLAY_VIEWING_MS = 2000;
        const HUDDLE_TIME_MS = 2500;
        const TOTAL_PAUSE_MS = POST_PLAY_VIEWING_MS + HUDDLE_TIME_MS;

        huddleTimeout = setTimeout(startNextPlay, TOTAL_PAUSE_MS);
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

    // Reset Banner
    if (elements.simBannerOffense) elements.simBannerOffense.textContent = "Waiting for snap...";
    if (elements.simBannerDefense) elements.simBannerDefense.textContent = "Reading offense...";

    drawFieldVisualization(null); // Clear field
    // Don't render final stats at start of live sim — show a placeholder
    if (elements.simLiveStats) elements.simLiveStats.innerHTML = '<p class="text-sm text-gray-400">Live stats will populate at game end.</p>';
    // Initialize live stats counters for this game
    initLiveGameStats(gameResult);
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


function renderDepthOrderPane(gameState) {
    const pane = document.getElementById("depth-order-container");
    if (!pane || !gameState) return;

    const roster = getUIRosterObjects(gameState.playerTeam);

    if (!roster || roster.length === 0) {
        pane.innerHTML = "<p class='p-4 text-gray-500'>No roster data found.</p>";
        return;
    }

    // 1. Group players for the top panes
    const groups = {
        'QB': [], 'RB': [], 'WR': [], 'OL': [],
        'DL': [], 'LB': [], 'DB': [], 'ST': []
    };

    roster.forEach(p => {
        let pos = p.pos || estimateBestPosition(p);
        if (pos === 'TE') pos = 'WR';
        if (pos === 'K' || pos === 'P') pos = 'ST';
        if (!groups[pos]) groups[pos] = [];
        groups[pos].push(p);
    });

    // 2. Sort groups by current Depth Order
    const currentOrder = gameState.playerTeam.depthOrder || [];
    Object.keys(groups).forEach(key => {
        groups[key].sort((a, b) => {
            const idxA = currentOrder.indexOf(a.id);
            const idxB = currentOrder.indexOf(b.id);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA === -1) return 1;
            if (idxB === -1) return -1;
            return calculateOverall(b, key === 'ST' ? 'K' : key) - calculateOverall(a, key === 'ST' ? 'K' : key);
        });
    });

    // 3. Build Tab Navigation
    const displayOrder = ['QB', 'RB', 'WR', 'OL', 'DL', 'LB', 'DB', 'ST'];
    let tabsHtml = `<div class="flex flex-wrap gap-2 mb-4 border-b border-gray-200 pb-2">`;
    displayOrder.forEach((pos, index) => {
        const isActive = index === 0 ? 'bg-amber-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300';
        tabsHtml += `<button class="depth-pos-tab px-4 py-2 rounded font-bold text-sm transition ${isActive}" data-target="${pos}">${pos}</button>`;
    });
    tabsHtml += `</div>`;

    // 4. Build Sortable Lists
    let listsHtml = `<div id="depth-lists-container" class="mb-8">`;
    displayOrder.forEach((groupKey, index) => {
        const isHidden = index !== 0 ? 'hidden' : '';
        const players = groups[groupKey] || [];

        listsHtml += `
            <div id="group-${groupKey}" class="depth-group-container ${isHidden}">
                <h4 class="font-bold text-lg text-gray-800 mb-2">${groupKey} Depth Chart</h4>
                <p class="text-xs text-gray-500 mb-2 italic">Drag from list or bottom table to reorder.</p>
                
                <div class="depth-sortable-list space-y-2 bg-gray-50 p-2 rounded border border-gray-200 min-h-[150px]" data-group="${groupKey}">
                    ${players.map((p, i) => {
            const ovr = calculateOverall(p, groupKey === 'ST' ? 'K' : groupKey);
            const rankStyle = i === 0 ? 'border-l-4 border-green-500' : (i === 1 ? 'border-l-4 border-blue-500' : 'border-l-4 border-transparent');
            const rankBadge = i === 0 ? '<span class="bg-green-100 text-green-800 text-xs px-1 rounded ml-2">Starter</span>' : '';

            return `
                        <div class="depth-order-item bg-white p-3 rounded shadow-sm border border-gray-200 cursor-move hover:bg-amber-50 flex justify-between items-center ${rankStyle}"
                             draggable="true" 
                             data-player-id="${p.id}"
                             data-player-name="${p.name}"
                             data-player-ovr="${ovr}">
                            <div class="flex items-center gap-3">
                                <span class="rank-number font-bold text-gray-400 w-4 text-center">${i + 1}</span>
                                <div>
                                    <span class="font-bold text-gray-800">${p.name}</span>
                                    ${rankBadge}
                                </div>
                            </div>
                            <div class="text-right">
                                <span class="text-sm font-bold text-gray-600">OVR: ${ovr}</span>
                            </div>
                        </div>
                        `;
        }).join('')}
                </div>
            </div>
        `;
    });
    listsHtml += `</div>`;

    // 5. Build Full Roster Table (NOW DRAGGABLE)
    let rosterHtml = `
        <div class="mt-8 border-t pt-4">
            <h4 class="font-bold text-lg text-gray-800 mb-3">Full Roster (Drag to Above)</h4>
            <div class="overflow-x-auto max-h-60 overflow-y-auto border rounded">
                <table class="min-w-full text-sm bg-white">
                    <thead class="bg-gray-100 sticky top-0 z-10">
                        <tr>
                            <th class="py-2 px-3 text-left">Name</th>
                            <th class="py-2 px-3 text-center">Pos</th>
                            <th class="py-2 px-3 text-center">Age</th>
                            <th class="py-2 px-3 text-center">Ovr</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y">
                        ${roster.map(p => {
        const pos = p.pos || estimateBestPosition(p);
        const ovr = calculateOverall(p, pos);
        return `
                            <tr class="roster-row-item cursor-move hover:bg-blue-50" 
                                draggable="true" 
                                data-player-id="${p.id}" 
                                data-player-name="${p.name}" 
                                data-player-ovr="${ovr}">
                                <td class="py-1 px-3 font-medium">${p.name}</td>
                                <td class="py-1 px-3 text-center">${pos}</td>
                                <td class="py-1 px-3 text-center">${p.age}</td>
                                <td class="py-1 px-3 text-center font-bold">${ovr}</td>
                            </tr>
                            `;
    }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    pane.innerHTML = tabsHtml + listsHtml + rosterHtml;

    setupDepthTabs();
    setupDepthOrderDragEvents();
}

/** Helper to check if a player is in any starting slot */
function isPlayerStarting(playerId, team) {
    if (!team.depthChart) return false;
    const allStarters = [
        ...Object.values(team.depthChart.offense || {}),
        ...Object.values(team.depthChart.defense || {})
    ];
    return allStarters.includes(playerId);
}

/** Handles the hiding/showing of position tabs in Depth Order. */
function setupDepthTabs() {
    const tabs = document.querySelectorAll('.depth-pos-tab');
    const groups = document.querySelectorAll('.depth-group-container');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Update Tab Styles
            tabs.forEach(t => t.classList.replace('bg-amber-500', 'bg-gray-200'));
            tabs.forEach(t => t.classList.replace('text-white', 'text-gray-700'));
            tab.classList.replace('bg-gray-200', 'bg-amber-500');
            tab.classList.replace('text-gray-700', 'text-white');

            // Show/Hide Content
            const target = tab.dataset.target;
            groups.forEach(g => {
                if (g.id === `group-${target}`) {
                    g.classList.remove('hidden');
                } else {
                    g.classList.add('hidden');
                }
            });
        });
    });
}


/**
 * Sets up drag-and-drop for the sorting lists.
 * Triggers a full Depth Chart update immediately upon drop.
 */
function setupDepthOrderDragEvents() {
    const draggables = document.querySelectorAll('.depth-order-item, .roster-row-item');
    const containers = document.querySelectorAll('.depth-sortable-list');

    draggables.forEach(draggable => {
        draggable.addEventListener('dragstart', (e) => {
            // 1. Set Data Transfer Payload
            e.dataTransfer.effectAllowed = 'copyMove';
            e.dataTransfer.setData('text/plain', draggable.dataset.playerId);
            e.dataTransfer.setData('player-name', draggable.dataset.playerName);
            e.dataTransfer.setData('player-ovr', draggable.dataset.playerOvr);
            
            // Mark source
            if (draggable.classList.contains('roster-row-item')) {
                draggable.dataset.source = 'roster';
            } else {
                draggable.dataset.source = 'list';
            }

            // 2. TIMING FIX: Delay the visual styling!
            // This ensures the browser captures the full-opacity element as the drag image
            // BEFORE we turn it grey.
            setTimeout(() => {
                draggable.classList.add('dragging');
                draggable.classList.add('opacity-50');
            }, 0);
        });

        draggable.addEventListener('dragend', () => {
            // Remove styles immediately
            draggable.classList.remove('dragging');
            draggable.classList.remove('opacity-50');
            delete draggable.dataset.source;
            
            // Trigger save/refresh
            setTimeout(() => {
                applyDepthOrderToChart();
                containers.forEach(c => updateRankNumbers(c));
            }, 50);
        });
    });

    containers.forEach(container => {
        container.addEventListener('dragover', e => {
            e.preventDefault(); // Necessary to allow dropping
            
            const draggable = document.querySelector('.dragging');
            if (!draggable) return;

            // Logic A: Dragging from Full Roster Table (Copy behavior)
            if (draggable.classList.contains('roster-row-item')) {
                e.dataTransfer.dropEffect = 'copy'; 
                // We do NOT move the DOM element here because we can't put a <tr> inside a <div>.
                // We just allow the drop.
                return; 
            }

            // Logic B: Sorting within the lists (Move behavior)
            // Only allow sorting if we are hovering over the list container
            if (container.contains(draggable)) {
                e.dataTransfer.dropEffect = 'move';
                const afterElement = getDragAfterElement(container, e.clientY);
                if (afterElement == null) {
                    container.appendChild(draggable);
                } else {
                    container.insertBefore(draggable, afterElement);
                }
            }
        });

        container.addEventListener('drop', e => {
            e.preventDefault();
            
            // If we dropped a Roster Item, we need to MANUALLY create the new card
            const source = document.querySelector('.dragging')?.dataset.source;
            
            if (source === 'roster') {
                const playerId = e.dataTransfer.getData('text/plain');
                const name = e.dataTransfer.getData('player-name');
                const ovr = e.dataTransfer.getData('player-ovr');

                // 1. Remove if already in this specific list to prevent duplicates
                const existing = container.querySelector(`[data-player-id="${playerId}"]`);
                if (existing) existing.remove();

                // 2. Create the new card element
                const newItem = document.createElement('div');
                newItem.className = "depth-order-item bg-white p-3 rounded shadow-sm border border-gray-200 cursor-move hover:bg-amber-50 flex justify-between items-center";
                newItem.draggable = true;
                newItem.dataset.playerId = playerId;
                newItem.dataset.playerName = name;
                newItem.dataset.playerOvr = ovr;
                
                newItem.innerHTML = `
                    <div class="flex items-center gap-3">
                        <span class="rank-number font-bold text-gray-400 w-4 text-center">-</span>
                        <div><span class="font-bold text-gray-800">${name}</span></div>
                    </div>
                    <div class="text-right"><span class="text-sm font-bold text-gray-600">OVR: ${ovr}</span></div>
                `;

                // 3. Insert it where the mouse is
                const afterElement = getDragAfterElement(container, e.clientY);
                if (afterElement == null) {
                    container.appendChild(newItem);
                } else {
                    container.insertBefore(newItem, afterElement);
                }

                // 4. Important: Make the new item draggable immediately
                newItem.addEventListener('dragstart', (ev) => {
                    setTimeout(() => {
                        newItem.classList.add('dragging');
                        newItem.classList.add('opacity-50');
                    }, 0);
                    ev.dataTransfer.setData('text/plain', playerId);
                });
                newItem.addEventListener('dragend', () => {
                    newItem.classList.remove('dragging');
                    newItem.classList.remove('opacity-50');
                    setTimeout(() => { applyDepthOrderToChart(); containers.forEach(c => updateRankNumbers(c)); }, 50);
                });
                
                // 5. Trigger update immediately
                setTimeout(() => {
                    applyDepthOrderToChart(); 
                    containers.forEach(c => updateRankNumbers(c));
                }, 50);
            }
        });
    });
}

function setupDepthOrderDrag() {
    const list = document.getElementById("depth-order-list");
    if (!list) return;

    const items = list.querySelectorAll(".depth-order-item");
    let dragged = null;

    items.forEach(item => {
        item.addEventListener("dragstart", () => {
            dragged = item;
            item.classList.add("opacity-50");
        });

        item.addEventListener("dragend", () => {
            dragged = null;
            item.classList.remove("opacity-50");
        });

        item.addEventListener("dragover", e => {
            e.preventDefault();
            const rect = item.getBoundingClientRect();
            const offset = e.clientY - rect.top;

            if (offset > rect.height / 2) {
                item.after(dragged);
            } else {
                item.before(dragged);
            }
        });
    });

    list.addEventListener("drop", () => {
        const newOrder = [...list.querySelectorAll(".depth-order-item")]
            .map(el => el.dataset.playerId);

        if (typeof Game.updateDepthOrder === "function") {
            Game.updateDepthOrder(newOrder);
        }

        document.dispatchEvent(new CustomEvent("refresh-ui"));
    });
}

/** Helper for List Reordering Logic */
function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.depth-order-item:not(.dragging)')];

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

/** Helper to update the "1, 2, 3" visual numbers after a drop */
function updateRankNumbers(container) {
    const items = container.querySelectorAll('.depth-order-item');
    items.forEach((item, index) => {
        const numberSpan = item.querySelector('span.text-center');
        if (numberSpan) numberSpan.textContent = index + 1;

        // Update styling for top 2
        item.classList.remove('border-green-500', 'border-blue-500', 'border-transparent');
        if (index === 0) item.classList.add('border-green-500');
        else if (index === 1) item.classList.add('border-blue-500');
        else item.classList.add('border-transparent');
    });
}
/**
 * Applies the visual Depth Order to the actual Depth Chart state.
 * Implements the "Rank 1 > Rank 2" priority rule.
 */
export function applyDepthOrderToChart() {
    console.log("Applying Depth Order with Priority Logic...");
    const gs = getGameState();
    const newDepthChart = { offense: {}, defense: {}, special: {} };

    // 1. Gather all lists from the DOM
    // We scrape the current order directly from the UI to capture user drags
    const lists = document.querySelectorAll('.depth-sortable-list');
    const orderMap = {}; // { 'QB': [id1, id2], 'WR': [id1, id2, id3] }

    lists.forEach(list => {
        const group = list.dataset.group;
        const ids = [...list.querySelectorAll('[draggable="true"]')].map(el => el.dataset.playerId);
        orderMap[group] = ids;
    });

    // 2. Define Slot Mappings (Must match the UI rendering logic)
    const slotDefinitions = {
        'QB': ['QB1'],
        'RB': ['RB1', 'RB2'],
        'WR': ['WR1', 'WR2', 'WR3', 'WR4', 'WR5'],
        'OL': ['OL1', 'OL2', 'OL3'],
        'DL': ['DL1', 'DL2', 'DL3'],
        'LB': ['LB1', 'LB2', 'LB3'],
        'DB': ['DB1', 'DB2', 'DB3', 'DB4', 'DB5'],
        'ST': ['K', 'P']
    };

    const sides = {
        'QB': 'offense', 'RB': 'offense', 'WR': 'offense', 'OL': 'offense',
        'DL': 'defense', 'LB': 'defense', 'DB': 'defense', 'ST': 'special'
    };

    // 3. PRIORITY ALGORITHM
    // We iterate by RANK (index), filling all #1 slots, then all #2 slots.
    // This ensures a Rank 1 QB always beats a Rank 2 WR for an offensive slot.

    const maxDepth = 6; // Check up to 6 players deep
    const assignedPlayers = { offense: new Set(), defense: new Set(), special: new Set() };

    for (let rank = 0; rank < maxDepth; rank++) {

        // Look at every position group (QB, RB, WR...) for this specific Rank
        Object.keys(slotDefinitions).forEach(group => {
            const playerList = orderMap[group] || [];
            const targetSlots = slotDefinitions[group];
            const side = sides[group];

            // If this group has a slot for this rank (e.g., WR has a WR3, but QB doesn't have a QB3)
            if (rank < targetSlots.length && rank < playerList.length) {
                const playerId = playerList[rank];
                const slotName = targetSlots[rank];

                // CHECK CONFLICTS:
                // Is this player already assigned to a slot on THIS SIDE?
                if (!assignedPlayers[side].has(playerId)) {

                    // Assign them
                    newDepthChart[side][slotName] = playerId;
                    assignedPlayers[side].add(playerId);

                } else {
                    // CONFLICT: Player is already assigned on this side (e.g. playing QB1).
                    // Logic: Since we process Rank 0 before Rank 1, the higher priority slot was already filled.
                    // We simply skip this assignment. The slot remains empty for now.
                    // (Optional: You could try to fill this slot with the NEXT available player in the list immediately,
                    // but simply skipping allows the next Rank loop to catch it naturally).
                }
            }
        });
    }

    // 4. Fill Holes (Backfill)
    // If a slot was skipped because the #1 guy was busy, we need to find the next best available guy.
    Object.keys(slotDefinitions).forEach(group => {
        const side = sides[group];
        const targetSlots = slotDefinitions[group];
        const playerList = orderMap[group] || [];

        targetSlots.forEach(slot => {
            // If slot is empty
            if (!newDepthChart[side][slot]) {
                // Find first player in list NOT assigned on this side
                const filler = playerList.find(pid => !assignedPlayers[side].has(pid));
                if (filler) {
                    newDepthChart[side][slot] = filler;
                    assignedPlayers[side].add(filler);
                }
            }
        });
    });

    // 5. SPECIAL 7v7 RULE: Auto-Assign Punter
    if (newDepthChart.offense['QB1']) {
        newDepthChart.special['P'] = newDepthChart.offense['QB1'];
    }

    // 6. Save & Refresh
    gs.playerTeam.depthChart = newDepthChart;

    // This event tells the Dashboard to re-read the gs.playerTeam.depthChart 
    // and redraw the Visual Field and Bench tables.
    document.dispatchEvent(new CustomEvent('refresh-ui'));

    console.log("Depth Chart Updated:", newDepthChart);
}
/**
 * Handles formation changes with "Snapshot & Restore" logic.
 * This prevents the "Revert to Default" bug.
 */
export function changeFormationSmart(side, newFormationName) {
    // 1. Snapshot the CURRENT (Old) assignments
    const gs = getGameState();
    const oldChart = { ...gs.playerTeam.depthChart[side] };

    // 2. Execute the Formation Change (Resets backend to defaults)
    changeFormation(side, newFormationName);

    // 3. Restore Players (Delayed to ensure backend is done)
    setTimeout(() => {
        // Look up the definition of the NEW formation
        const formationData = side === 'offense'
            ? offenseFormations[newFormationName]
            : defenseFormations[newFormationName];

        if (formationData && formationData.slots) {
            const validSlots = new Set(formationData.slots);

            // Iterate through our saved Snapshot
            Object.entries(oldChart).forEach(([slot, playerId]) => {
                // If the player exists AND the new formation has this slot (e.g. "WR1")
                if (playerId && validSlots.has(slot)) {
                    // Dispatch the event to put them back
                    document.dispatchEvent(new CustomEvent('depth-chart-changed', {
                        detail: { playerId, slot, side }
                    }));
                }
            });
        }

        // 4. Force a UI Refresh & Save (Main.js listens for this)
        document.dispatchEvent(new CustomEvent('refresh-ui'));

    }, 50); // Small delay to let the reset finish
}
