import * as Game from './game.js';
import {
    saveGameState, getRelationshipLevel, getScoutedPlayerInfo, getGameState,
    getRosterObjects, getPlayer, rebuildDepthChartFromOrder, assignPlayerToSlot
} from './game.js';
import { offenseFormations, defenseFormations, relationshipLevels, firstNames, lastNames, offensivePlaybook, defensivePlaybook } from './data.js';
import { positionOverallWeights, estimateBestPosition, calculateOverall, getProspectSignatureSkills } from './game/player.js';
import { formatHeight } from './utils.js';
import { drawFieldVisualization, formatGameClock, showPlayOverlay } from './ui/field_visualizer.js';
import { renderDepthOrderPane } from './ui/depth_order.js';

let elements = {};
let selectedPlayerId = null;
let dragPlayerId = null;
let dragSide = null;
let debounceTimeout = null;
let depthOrderSortCol = 'overall';
let depthOrderSortDir = 'desc';
let activeDepthOrderTab = 'QB';

let liveGameSpeed = 80;
let liveGameCurrentIndex = 0;
let currentLiveGameResult = null;
let huddleTimeout = null;
let activeLiveGame = null;
let liveGameCallback = null;
let liveGameInterval = null;
let isSkipping = false;
let isPaused = false;

let livePlayerStats = new Map();
let playerNameIdMap = new Map();
let livePlayContext = { type: 'run', lastReceiverId: null, isPassComplete: false };

// Draft view and watchlist state
export let activeDraftView = 'overview';
export let draftWatchlist = new Set();
let currentDraftOnSelect = null;
let currentDraftSortCol = 'potential';
let currentDraftSortDir = 'desc';

// Standings league sub-tab state
let activeStandingsLeague = 'tier1'; // 'tier1', 'tier2', 'youth'
window.app_switchStandingsLeague = function (leagueKey) {
    activeStandingsLeague = leagueKey;
    const gs = getGameState();
    if (gs) renderStandingsTab(gs);
};

function debounce(func, delay) {
    return function (...args) {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => func.apply(this, args), delay);
    };
}

function getUIRosterObjects(team) {
    if (!team || !Array.isArray(team.roster)) return [];
    const gs = getGameState();
    return team.roster.map(id => {
        let p = getPlayer(id);
        if (!p && gs?.players) p = gs.players.find(pl => pl.id === id);
        if (!p && typeof id === 'object' && id.id) p = id;
        return p;
    }).filter(Boolean);
}

export function setupElements() {
    const getEl = (id) => document.getElementById(id);
    elements = {
        screens: {
            'start-screen': getEl('start-screen'),
            'loading-screen': getEl('loading-screen'),
            'team-creation-screen': getEl('team-creation-screen'),
            'team-select-screen': getEl('team-select-screen'),
            'draft-screen': getEl('draft-screen'),
            'offseason-fa-screen': getEl('offseason-fa-screen'),
            'dashboard-screen': getEl('dashboard-screen'),
            'offseason-screen': getEl('offseason-screen'),
            'game-sim-screen': getEl('game-sim-screen')
        },
        modal: getEl('modal'),
        modalTitle: getEl('modal-title'),
        modalBody: getEl('modal-body'),
        modalDefaultClose: getEl('modal-default-close'),
        loadingProgress: getEl('loading-progress'),
        teamNameSuggestions: getEl('team-name-suggestions'),
        customTeamName: getEl('custom-team-name'),
        confirmTeamBtn: getEl('confirm-team-btn'),
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
        dashboardTeamName: getEl('dashboard-team-name'),
        dashboardRecord: getEl('dashboard-record'),
        dashboardYear: getEl('dashboard-year'),
        dashboardWeek: getEl('dashboard-week'),
        dashboardTabs: getEl('dashboard-tabs'),
        dashboardContent: getEl('dashboard-content'),
        advanceWeekBtn: getEl('advance-week-btn'),
        myTeamRoster: getEl('my-team-roster'),
        scheduleList: getEl('schedule-list'),
        standingsContainer: getEl('standings-container'),
        playerStatsContainer: getEl('player-stats-container'),
        statsFilterTeam: getEl('stats-filter-team'),
        statsSort: getEl('stats-sort'),
        hallOfFameList: getEl('hall-of-fame-list'),
        messagesList: getEl('messages-list'),
        messagesNotificationDot: getEl('messages-notification-dot'),
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
        simScoreboard: getEl('sim-scoreboard'),
        simAwayTeam: getEl('sim-away-team'),
        simAwayScore: getEl('sim-away-score'),
        simHomeTeam: getEl('sim-home-team'),
        simHomeScore: getEl('sim-home-score'),
        simGameDrive: getEl('sim-game-drive'),
        simGameDown: getEl('sim-game-down'),
        simPossession: getEl('sim-possession'),
        simFieldPlayers: getEl('sim-field-players'),
        simPlayersList: getEl('sim-field-players'),
        simLiveStats: getEl('sim-live-stats'),
        simStatsAway: getEl('sim-stats-away'),
        simStatsHome: getEl('sim-stats-home'),
        fieldCanvas: getEl('field-canvas'),
        simPlayLog: getEl('sim-play-log'),
        simSpeedBtns: document.querySelectorAll('.sim-speed-btn'),
        simSkipBtn: getEl('sim-skip-btn'),
        simBannerOffense: getEl('sim-banner-offense'),
        simBannerDefense: getEl('sim-banner-defense'),
        offseasonYear: getEl('offseason-year'),
        playerDevelopmentContainer: getEl('player-development-container'),
        retirementsList: getEl('retirements-list'),
        hofInducteesList: getEl('hof-inductees-list'),
        leavingPlayersList: getEl('leaving-players-list'),
        goToNextDraftBtn: getEl('go-to-next-draft-btn')
    };

    if (elements.fieldCanvas) elements.fieldCanvasCtx = elements.fieldCanvas.getContext('2d');
    if (elements.modalDefaultClose) elements.modalDefaultClose.addEventListener('click', hideModal);

    setupFormationListeners();
    setupDepthChartTabs();
    setupSimTabs();
}

function setupSimTabs() {
    const tabs = [
        { id: 'log', btn: document.getElementById('tab-btn-log'), pane: document.getElementById('pane-log'), color: 'blue-500' },
        { id: 'subs', btn: document.getElementById('tab-btn-subs'), pane: document.getElementById('pane-subs'), color: 'amber-500' },
        { id: 'stats', btn: document.getElementById('tab-btn-stats'), pane: document.getElementById('pane-stats'), color: 'emerald-500' },
        { id: 'strategy', btn: document.getElementById('tab-btn-strategy'), pane: document.getElementById('pane-strategy'), color: 'purple-500' }
    ];

    tabs.forEach(activeTab => {
        if (!activeTab.btn || !activeTab.pane) return;
        activeTab.btn.addEventListener('click', () => {
            tabs.forEach(t => {
                if (t.id === activeTab.id) {
                    t.btn.className = `flex-1 py-3 font-black text-white bg-gray-900 border-t-2 border-${t.color} transition-colors tracking-wider text-[10px] sm:text-xs`;
                    t.pane.classList.remove('hidden');
                } else {
                    t.btn.className = `flex-1 py-3 font-bold text-gray-400 hover:text-white border-t-2 border-transparent bg-gray-800 transition-colors tracking-wider text-[10px] sm:text-xs`;
                    t.pane.classList.add('hidden');
                }
            });
        });
    });
}

export function showScreen(screenId) {
    // Bulletproof safeguard: hide every screen section in the DOM
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    if (elements?.screens) {
        Object.values(elements.screens).forEach(screen => {
            if (screen?.classList) screen.classList.add('hidden');
        });
    }
    const target = elements?.screens?.[screenId] || document.getElementById(screenId);
    if (target?.classList) target.classList.remove('hidden');
}

export function showModal(title, bodyHtml, onConfirm = null, confirmText = 'Confirm', onCancel = null, cancelText = 'Close') {
    if (!elements.modal) return;
    elements.modalTitle.innerHTML = title;
    elements.modalBody.innerHTML = bodyHtml;

    const modalContent = elements.modal.querySelector('#modal-content');
    modalContent?.querySelector('#modal-actions')?.remove();

    const actionsDiv = document.createElement('div');
    actionsDiv.id = 'modal-actions';
    actionsDiv.className = 'mt-6 text-right space-x-2';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = cancelText;
    cancelBtn.className = 'btn bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-6 rounded-lg text-sm';
    cancelBtn.onclick = () => { if (onCancel) onCancel(); hideModal(); };
    actionsDiv.appendChild(cancelBtn);

    if (onConfirm) {
        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = confirmText;
        confirmBtn.className = 'btn bg-amber-500 hover:bg-amber-600 text-white font-bold py-2 px-6 rounded-lg text-sm';
        confirmBtn.onclick = () => { onConfirm(); hideModal(); };
        actionsDiv.appendChild(confirmBtn);
    }

    modalContent?.appendChild(actionsDiv);
    elements.modal.classList.remove('hidden');
}

export function hideModal() {
    elements.modal?.classList.add('hidden');
}

export function updateLoadingProgress(progress) {
    const el = document.getElementById('loading-progress');
    const txt = document.getElementById('loading-progress-text');
    if (el) el.style.width = `${progress}%`;
    if (txt) txt.textContent = `${progress}%`;
}

let messageInterval = null;
const loadingMessages = [
    "Scouting rookies...", "Building team rosters...", "Analyzing player stats...",
    "Setting up salary caps...", "Scheduling season games...", "Drafting prospects...",
    "Signing free agents...", "Preparing preseason matchups...", "Almost ready for kickoff!"
];

export function startLoadingMessages() {
    const el = document.getElementById('loading-message');
    if (!el) return;
    if (messageInterval) clearInterval(messageInterval);
    let idx = 1;
    el.textContent = loadingMessages[0];
    messageInterval = setInterval(() => {
        el.textContent = loadingMessages[idx];
        idx = (idx + 1) % loadingMessages.length;
    }, 2500);
}

export function stopLoadingMessages() {
    if (messageInterval) clearInterval(messageInterval);
}

export function renderTeamNameSuggestions(names, onSelect) {
    if (!elements.teamNameSuggestions) return;
    elements.teamNameSuggestions.innerHTML = '';
    names.forEach(name => {
        const btn = document.createElement('button');
        btn.className = 'bg-gray-200 hover:bg-amber-500 hover:text-white text-gray-700 font-semibold py-2 px-4 rounded-lg transition text-sm';
        btn.textContent = name;
        btn.type = 'button';
        btn.onclick = () => onSelect(name);
        elements.teamNameSuggestions.appendChild(btn);
    });
}

export function renderDraftScreen(gameState, onPlayerSelect, currentSelectedId, sortColumn, sortDirection) {
    if (!gameState?.playerTeam) return;
    const { year, draftOrder, currentPick, playerTeam } = gameState;
    const ROSTER_LIMIT = 18;

    if (!draftOrder || currentPick >= draftOrder.length) {
        if (elements.draftHeader) elements.draftHeader.innerHTML = `<h2 class="text-2xl font-bold">Season ${year} Draft Complete</h2>`;
        if (elements.draftPlayerBtn) { elements.draftPlayerBtn.disabled = true; elements.draftPlayerBtn.textContent = 'Draft Complete'; }
        renderSelectedPlayerCard(null, gameState);
        updateSelectedPlayerRow(null);
        if (elements.draftPoolTbody) elements.draftPoolTbody.innerHTML = `<tr><td colspan="9" class="p-6 text-center text-slate-400">Draft Complete.</td></tr>`;
        return;
    }

    const pickingTeam = draftOrder[currentPick];
    if (!pickingTeam) return;

    const currentRosterSize = pickingTeam.roster?.length || 0;
    const playerCanPick = pickingTeam.id === playerTeam.id && currentRosterSize < ROSTER_LIMIT;

    if (elements.draftYear) elements.draftYear.textContent = year;
    if (elements.draftPickNumber) elements.draftPickNumber.textContent = `#${currentPick + 1}`;
    if (elements.draftPickingTeam) elements.draftPickingTeam.textContent = pickingTeam.name || 'Unknown Team';

    // 1. Render User Upcoming Picks Roadmap
    const userPicksEl = document.getElementById('draft-user-picks');
    if (userPicksEl && draftOrder) {
        const myPicks = [];
        draftOrder.forEach((t, idx) => {
            if (t.id === playerTeam.id && idx >= currentPick) {
                const roundNum = Math.floor(idx / (gameState.teams.filter(tm => tm.leagueType === 'main').length || 20)) + 1;
                myPicks.push(`R${roundNum} (#${idx + 1})`);
            }
        });
        userPicksEl.textContent = myPicks.length > 0 ? `Your Upcoming: ${myPicks.slice(0, 3).join(', ')}` : 'No picks remaining';
    }

    // 2. Render Recent Picks Ticker
    const tickerContainer = document.getElementById('draft-ticker-items');
    if (tickerContainer && gameState.pickHistory) {
        const recent = gameState.pickHistory.slice(-4).reverse();
        if (recent.length > 0) {
            tickerContainer.innerHTML = recent.map(p => `
                <span class="inline-flex items-center gap-1.5 bg-slate-900 px-2 py-0.5 rounded border border-slate-700">
                    <b class="text-amber-400">#${p.pick}</b> 
                    <span class="text-slate-300 font-bold">${p.playerName}</span> 
                    <span class="text-[9px] bg-slate-800 text-slate-400 px-1 rounded">${p.pos}</span> 
                    <span class="text-slate-500 font-sans text-[10px]">(${p.teamName.replace('The ', '')})</span>
                </span>
            `).join('');
        }
    }

    renderDraftPool(gameState, onPlayerSelect, sortColumn, sortDirection);
    renderPlayerRoster(gameState.playerTeam);

    if (currentSelectedId) {
        const playerObj = gameState.players.find(p => p.id === currentSelectedId);
        if (playerObj) renderSelectedPlayerCard(playerObj, gameState);
    }

    if (elements.draftPlayerBtn) {
        elements.draftPlayerBtn.disabled = !playerCanPick || currentSelectedId === null;
        elements.draftPlayerBtn.textContent = playerCanPick ? `Draft Player to ${playerTeam.name}` : `Waiting on ${pickingTeam.name}...`;
    }
}

export function renderDraftPool(gameState, onPlayerSelect, sortColumn = 'potential', sortDirection = 'desc') {
    if (!elements.draftPoolTbody || !gameState?.players) return;

    // Cache active parameters for sub-view switches and watchlist star toggles
    if (onPlayerSelect) currentDraftOnSelect = onPlayerSelect;
    currentDraftSortCol = sortColumn;
    currentDraftSortDir = sortDirection;

    const thead = document.getElementById('draft-pool-thead');
    const playerRoster = getUIRosterObjects(gameState.playerTeam);

    const watchlistCountEl = document.getElementById('draft-watchlist-count');
    if (watchlistCountEl) watchlistCountEl.textContent = draftWatchlist.size;

    // 1. Strict Draft Pool Filtering (Culls 18-20 year olds from rookie drafts)
    const poolSource = (gameState.draftClass && gameState.draftClass.length > 0)
        ? gameState.draftClass
        : gameState.players;

    let undraftedPlayers = poolSource.filter(p =>
        p && !p.teamId &&
        p.status?.type !== 'retired' &&
        p.status?.type !== 'departed' &&
        (p.personality?.entersDraft !== false) &&
        (gameState.draftClass && gameState.draftClass.length > 0 ? true : (p.age <= 13 || p.lifecycle === 'draft_eligible'))
    );

    if (activeDraftView === 'watchlist') {
        undraftedPlayers = undraftedPlayers.filter(p => draftWatchlist.has(p.id));
    }

    const searchTerm = elements.draftSearch?.value.toLowerCase() || '';
    const posFilter = elements.draftFilterPos?.value || '';

    let filtered = undraftedPlayers.filter(p => {
        const matchesName = p.name.toLowerCase().includes(searchTerm);
        const bestP = p.pos || estimateBestPosition(p);
        const matchesPos = !posFilter || bestP === posFilter || p.favoriteOffensivePosition === posFilter || p.favoriteDefensivePosition === posFilter;
        return matchesName && matchesPos;
    });

    // 2. Render Dynamic Table Header based on View Tab
    if (thead) {
        if (activeDraftView === 'overview') {
            thead.innerHTML = `
                <tr>
                    <th class="py-2 px-2 text-center w-8">★</th>
                    <th class="py-2 px-2 text-center w-12 cursor-pointer hover:bg-slate-200" data-sort="position">Pos</th>
                    <th class="py-2 px-3 text-left cursor-pointer hover:bg-slate-200" data-sort="name">Prospect / Style</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="age">Age</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="potential">Pot</th>
                    <th class="py-2 px-2 text-center">Rel</th>
                    <th class="py-2 px-2 text-center">Frame</th>
                    <th class="py-2 px-3 text-center">Key Skills</th>
                    <th class="py-2 px-2 text-center">Est OVR</th>
                </tr>`;
        } else if (activeDraftView === 'physicals') {
            thead.innerHTML = `
                <tr>
                    <th class="py-2 px-2 text-center w-8">★</th>
                    <th class="py-2 px-2 text-center w-12 cursor-pointer hover:bg-slate-200" data-sort="position">Pos</th>
                    <th class="py-2 px-3 text-left cursor-pointer hover:bg-slate-200" data-sort="name">Prospect</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="height">Hgt</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="weight">Wgt</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200 text-blue-600" data-sort="speed">Speed</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="strength">Strength</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="agility">Agility</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="stamina">Stamina</th>
                </tr>`;
        } else if (activeDraftView === 'skills') {
            thead.innerHTML = `
                <tr>
                    <th class="py-2 px-2 text-center w-8">★</th>
                    <th class="py-2 px-2 text-center w-12 cursor-pointer hover:bg-slate-200" data-sort="position">Pos</th>
                    <th class="py-2 px-3 text-left cursor-pointer hover:bg-slate-200" data-sort="name">Prospect</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="throwingAccuracy">Throw</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="catchingHands">Hands</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="blocking">Block</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="tackling">Tackle</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="blockShedding">B.Shed</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="playbookIQ">IQ</th>
                </tr>`;
        } else {
            // Watchlist View (mirrors overview)
            thead.innerHTML = `
                <tr>
                    <th class="py-2 px-2 text-center w-8">★</th>
                    <th class="py-2 px-2 text-center w-12 cursor-pointer hover:bg-slate-200" data-sort="position">Pos</th>
                    <th class="py-2 px-3 text-left cursor-pointer hover:bg-slate-200" data-sort="name">Prospect</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="age">Age</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="potential">Pot</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200 text-blue-600" data-sort="speed">Speed</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="catchingHands">Hands</th>
                    <th class="py-2 px-2 text-center">Est OVR</th>
                </tr>`;
        }
    }

    // 3. Sorting
    const potentialOrder = { 'A': 5, 'B': 4, 'C': 3, 'D': 2, 'F': 1 };
    filtered.sort((a, b) => {
        if (sortColumn === 'potential') {
            const valA = potentialOrder[a?.potential] || 0;
            const valB = potentialOrder[b?.potential] || 0;
            if (valA !== valB) return sortDirection === 'asc' ? valA - valB : valB - valA;
            return calculateOverall(b, estimateBestPosition(b)) - calculateOverall(a, estimateBestPosition(a));
        }
        if (sortColumn === 'position') {
            const posA = a.pos || estimateBestPosition(a);
            const posB = b.pos || estimateBestPosition(b);
            return sortDirection === 'asc' ? posA.localeCompare(posB) : posB.localeCompare(posA);
        }
        if (sortColumn === 'name') return sortDirection === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
        if (sortColumn === 'age') return sortDirection === 'asc' ? a.age - b.age : b.age - a.age;

        const getAttr = (p) => {
            const cats = ['physical', 'mental', 'technical'];
            for (const c of cats) if (p.attributes?.[c]?.[sortColumn] !== undefined) return Number(p.attributes[c][sortColumn]) || 0;
            return 0;
        };
        const valA = getAttr(a);
        const valB = getAttr(b);
        return sortDirection === 'asc' ? valA - valB : valB - valA;
    });

    elements.draftPoolTbody.innerHTML = '';
    if (filtered.length === 0) {
        const msg = activeDraftView === 'watchlist' ? 'No prospects pinned to your watchlist yet. Click the ★ next to any player to shortlist them.' : 'No prospects match filters.';
        elements.draftPoolTbody.innerHTML = `<tr><td colspan="9" class="p-6 text-center text-slate-400 font-sans italic">${msg}</td></tr>`;
        return;
    }

    // 4. Render Table Rows
    filtered.forEach(player => {
        const maxLevel = playerRoster.reduce((max, rp) => Math.max(max, getRelationshipLevel(rp.id, player.id)), relationshipLevels.STRANGER.level);
        const scouted = getScoutedPlayerInfo(player, maxLevel);
        if (!scouted) return;

        const relInfo = Object.values(relationshipLevels).find(rl => rl.level === maxLevel) || relationshipLevels.STRANGER;
        const pos = scouted.pos || estimateBestPosition(scouted);
        const ovr = calculateOverall(scouted, pos);
        const isStarred = draftWatchlist.has(player.id);

        const row = document.createElement('tr');
        row.className = `cursor-pointer hover:bg-amber-50 draft-player-row transition ${scouted.id === selectedPlayerId ? 'bg-amber-100 font-bold' : ''}`;
        row.dataset.playerId = scouted.id;

        const starBtn = `<button class="star-btn text-base leading-none ${isStarred ? 'text-amber-500 font-bold' : 'text-slate-300 hover:text-amber-400'}" onclick="event.stopPropagation(); window.app_toggleWatchlist('${player.id}')">${isStarred ? '★' : '☆'}</button>`;
        const posBadge = `<span class="bg-slate-100 text-slate-800 font-bold text-[10px] px-1.5 py-0.5 rounded border border-slate-300">${pos}</span>`;

        if (activeDraftView === 'overview') {
            const sigSkills = getProspectSignatureSkills(scouted, pos);
            const sigSkillsHtml = sigSkills.map(s =>
                `<span class="inline-block bg-slate-100 text-slate-800 text-[10px] px-1.5 py-0.5 rounded font-mono mr-1 border border-slate-200">
                    <span class="text-slate-500 font-normal">${s.label}:</span> <b>${s.val}</b>
                </span>`
            ).join('');

            row.innerHTML = `
                <td class="py-2 px-2 text-center">${starBtn}</td>
                <td class="py-2 px-2 text-center">${posBadge}</td>
                <td class="py-2 px-3 font-sans truncate max-w-[150px]">
                    <span class="block font-semibold text-slate-900 truncate leading-tight">${scouted.name}</span>
                    <span class="block text-[10px] text-slate-500 truncate leading-tight">${scouted.archetypeName || 'Athlete'}</span>
                </td>
                <td class="text-center py-2 px-2 text-slate-600 font-mono">${scouted.age}</td>
                <td class="text-center py-2 px-2 font-bold ${scouted.potential === 'A' ? 'text-amber-600' : (scouted.potential === 'B' ? 'text-blue-600' : 'text-slate-500')}">${scouted.potential}</td>
                <td class="text-center py-2 px-2 ${relInfo.color} text-[10px] uppercase font-sans font-bold" title="${relInfo.name}">${relInfo.name.substring(0, 4)}</td>
                <td class="text-center py-2 px-2 text-slate-500 text-[10px]">${formatHeight(scouted.attributes?.physical?.height)} / ${scouted.attributes?.physical?.weight}#</td>
                <td class="text-center py-2 px-3 whitespace-nowrap">${sigSkillsHtml}</td>
                <td class="text-center py-2 px-2 font-black text-slate-900 font-mono">${ovr}</td>
            `;
        } else if (activeDraftView === 'physicals') {
            row.innerHTML = `
                <td class="py-2 px-2 text-center">${starBtn}</td>
                <td class="py-2 px-2 text-center">${posBadge}</td>
                <td class="py-2 px-3 font-semibold text-slate-900 font-sans truncate max-w-[140px]">${scouted.name}</td>
                <td class="text-center py-2 px-2">${formatHeight(scouted.attributes?.physical?.height)}</td>
                <td class="text-center py-2 px-2">${scouted.attributes?.physical?.weight}#</td>
                <td class="text-center py-2 px-2 text-blue-600 font-bold">${scouted.attributes?.physical?.speed ?? '?'}</td>
                <td class="text-center py-2 px-2">${scouted.attributes?.physical?.strength ?? '?'}</td>
                <td class="text-center py-2 px-2">${scouted.attributes?.physical?.agility ?? '?'}</td>
                <td class="text-center py-2 px-2">${scouted.attributes?.physical?.stamina ?? '?'}</td>
            `;
        } else if (activeDraftView === 'skills') {
            row.innerHTML = `
                <td class="py-2 px-2 text-center">${starBtn}</td>
                <td class="py-2 px-2 text-center">${posBadge}</td>
                <td class="py-2 px-3 font-semibold text-slate-900 font-sans truncate max-w-[140px]">${scouted.name}</td>
                <td class="text-center py-2 px-2">${scouted.attributes?.technical?.throwingAccuracy ?? '?'}</td>
                <td class="text-center py-2 px-2">${scouted.attributes?.technical?.catchingHands ?? '?'}</td>
                <td class="text-center py-2 px-2">${scouted.attributes?.technical?.blocking ?? '?'}</td>
                <td class="text-center py-2 px-2">${scouted.attributes?.technical?.tackling ?? '?'}</td>
                <td class="text-center py-2 px-2">${scouted.attributes?.technical?.blockShedding ?? '?'}</td>
                <td class="text-center py-2 px-2">${scouted.attributes?.mental?.playbookIQ ?? '?'}</td>
            `;
        } else {
            row.innerHTML = `
                <td class="py-2 px-2 text-center">${starBtn}</td>
                <td class="py-2 px-2 text-center">${posBadge}</td>
                <td class="py-2 px-3 font-semibold text-slate-900 font-sans truncate max-w-[140px]">${scouted.name}</td>
                <td class="text-center py-2 px-2">${scouted.age}</td>
                <td class="text-center py-2 px-2 font-bold text-amber-600">${scouted.potential}</td>
                <td class="text-center py-2 px-2 text-blue-600 font-bold">${scouted.attributes?.physical?.speed ?? '?'}</td>
                <td class="text-center py-2 px-2">${scouted.attributes?.technical?.catchingHands ?? '?'}</td>
                <td class="text-center py-2 px-2 font-black text-slate-900">${ovr}</td>
            `;
        }

        row.onclick = () => onPlayerSelect(scouted.id);
        elements.draftPoolTbody.appendChild(row);
    });
}

export function updateDraftSortIndicators(sortColumn, sortDirection) {
    document.querySelectorAll('#draft-screen thead th[data-sort]').forEach(th => {
        const existing = th.querySelector('.sort-indicator');
        if (existing) existing.remove();
    });

    const headerCell = document.querySelector(
        `#draft-screen thead th[data-sort="${sortColumn}"]`
    );

    if (!headerCell) return;

    const indicator = document.createElement('span');
    indicator.className = 'sort-indicator ml-1 text-amber-500';
    indicator.textContent = sortDirection === 'desc' ? '▼' : '▲';
    headerCell.appendChild(indicator);
}

export function setDraftView(view) {
    activeDraftView = view;
    document.querySelectorAll('.draft-view-btn').forEach(btn => {
        const isActive = btn.dataset.view === view;
        btn.classList.toggle('active', isActive);
        if (isActive) {
            btn.classList.add('bg-white', 'text-slate-900', 'shadow-sm');
            btn.classList.remove('text-slate-600');
        } else {
            btn.classList.remove('bg-white', 'text-slate-900', 'shadow-sm');
            if (btn.dataset.view !== 'watchlist') {
                btn.classList.add('text-slate-600');
            }
        }
    });
}

export function toggleWatchlistPlayer(playerId) {
    if (!playerId) return;
    if (draftWatchlist.has(playerId)) {
        draftWatchlist.delete(playerId);
    } else {
        draftWatchlist.add(playerId);
    }

    const countEl = document.getElementById('draft-watchlist-count');
    if (countEl) countEl.textContent = draftWatchlist.size;

    const gs = getGameState();
    if (gs) {
        renderDraftPool(gs, currentDraftOnSelect || window.app?.onDraftSelect, currentDraftSortCol, currentDraftSortDir);
    }
}

export const debouncedRenderDraftPool = debounce(renderDraftPool, 300);

export function updateSelectedPlayerRow(newSelectedId) {
    selectedPlayerId = newSelectedId;
    document.querySelectorAll('.draft-player-row').forEach(r => r.classList.toggle('bg-amber-100', r.dataset.playerId === newSelectedId));
}

let activeDossierTab = 'overview';
window.app_switchDossierTab = function(tab) {
    activeDossierTab = tab;
    document.querySelectorAll('.dossier-tab-btn').forEach(btn => {
        const isActive = btn.dataset.dtab === tab;
        btn.className = `dossier-tab-btn px-1.5 py-0.5 rounded text-[10px] font-bold transition ${isActive ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`;
    });
    document.querySelectorAll('.dossier-pane').forEach(p => p.classList.add('hidden'));
    document.getElementById(`dossier-pane-${tab}`)?.classList.remove('hidden');
};

export function renderSelectedPlayerCard(player, gameState) {
    if (!elements.selectedPlayerCard) return;
    if (!player || !gameState?.playerTeam) {
        elements.selectedPlayerCard.innerHTML = `<p class="text-slate-400 text-xs italic text-center py-4">Select a prospect from the board to examine report.</p>`;
        if (elements.draftPlayerBtn) elements.draftPlayerBtn.disabled = true;
        return;
    }

    const playerRoster = getUIRosterObjects(gameState.playerTeam);
    const maxLevel = playerRoster.reduce((max, rp) => Math.max(max, getRelationshipLevel(rp.id, player.id)), relationshipLevels.STRANGER.level);
    const scouted = getScoutedPlayerInfo(player, maxLevel);

    const pos = scouted.pos || estimateBestPosition(scouted);
    const ovr = calculateOverall(scouted, pos);

    const bestFriend = playerRoster.find(r => r.id === player.social?.bestFriendId);
    const friendsOnTeam = playerRoster.filter(r => player.social?.goodFriendIds?.includes(r.id));
    const rivalOnTeam = playerRoster.find(r => player.social?.rivalIds?.includes(r.id));

    let socialBadgeHtml = '';
    if (bestFriend) socialBadgeHtml += `<span class="bg-amber-100 text-amber-800 border border-amber-300 px-1 py-0.5 rounded text-[9px] font-bold">🤝 BFF: ${bestFriend.name.split(' ')[0]}</span>`;
    if (friendsOnTeam.length > 0) socialBadgeHtml += `<span class="bg-emerald-100 text-emerald-800 border border-emerald-300 px-1 py-0.5 rounded text-[9px] font-bold">Friends: ${friendsOnTeam.length}</span>`;
    if (rivalOnTeam) socialBadgeHtml += `<span class="bg-rose-100 text-rose-800 border border-rose-300 px-1 py-0.5 rounded text-[9px] font-bold">⚠️ Rival</span>`;

    const workEthic = player.personality?.workEthic || 50;
    const ego = player.personality?.ego || 50;
    const clique = player.personality?.clique || 'Regular';

    const positions = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'];
    let overallsHtml = '<div class="grid grid-cols-4 gap-1 text-center">';
    positions.forEach(pKey => {
        const pOvr = calculateOverall(scouted, pKey);
        const isBest = pKey === pos;
        overallsHtml += `
            <div class="${isBest ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'} p-1 rounded border border-slate-200">
                <p class="text-[9px] font-bold uppercase ${isBest ? 'text-amber-400' : 'text-slate-400'}">${pKey}</p>
                <p class="font-black text-xs">${pOvr}</p>
            </div>`;
    });
    overallsHtml += '</div>';

    elements.selectedPlayerCard.innerHTML = `
        <div class="flex flex-col">
            <!-- Compact Header -->
            <div class="flex justify-between items-center mb-1.5 pb-1 border-b border-slate-200">
                <div class="truncate pr-1">
                    <h3 class="font-black text-sm text-slate-900 truncate leading-tight">${scouted.name}</h3>
                    <p class="text-[10px] text-slate-500 font-mono">${scouted.age}yo • ${formatHeight(scouted.attributes?.physical?.height)} • ${scouted.attributes?.physical?.weight}#</p>
                </div>
                <div class="text-right bg-slate-900 text-white px-2 py-0.5 rounded shrink-0">
                    <span class="text-[8px] uppercase tracking-wider block text-slate-400">${pos}</span>
                    <span class="text-base font-black leading-none">${ovr}</span>
                </div>
            </div>

            <!-- Tab 1: Overview Pane (Clean & Compact) -->
            <div id="dossier-pane-overview" class="dossier-pane ${activeDossierTab === 'overview' ? '' : 'hidden'} text-[10px] space-y-1.5">
                <div class="flex flex-wrap items-center gap-1">
                    <span class="bg-amber-100 text-amber-900 font-bold px-1.5 py-0.5 rounded border border-amber-200">Style: ${player.archetypeName || 'Athlete'}</span>
                    <span class="bg-indigo-100 text-indigo-900 font-bold px-1.5 py-0.5 rounded border border-indigo-200">${clique}</span>
                    <span class="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-mono">Ethic: <b>${workEthic}</b></span>
                    <span class="${ego > 70 ? 'bg-rose-100 text-rose-800 font-bold' : 'bg-slate-100 text-slate-700'} px-1.5 py-0.5 rounded font-mono">Ego: <b>${ego}</b></span>
                    ${socialBadgeHtml}
                </div>
            </div>

            <!-- Tab 2: Positional Suitability Matrix -->
            <div id="dossier-pane-matrix" class="dossier-pane ${activeDossierTab === 'matrix' ? '' : 'hidden'}">
                ${overallsHtml}
            </div>

            <!-- Tab 3: Bio & Lore -->
            <div id="dossier-pane-bio" class="dossier-pane ${activeDossierTab === 'bio' ? '' : 'hidden'} text-[11px] text-slate-700 italic bg-amber-50/70 p-2 rounded border border-amber-200 max-h-24 overflow-y-auto">
                "${player.bio || 'A dependable playground competitor.'}"
            </div>
        </div>
    `;
}

export function resetDraftWatchlist() {
    draftWatchlist.clear();
}

let activeDraftTeamTab = 'roster';

window.app_switchDraftTeamTab = function(tab) {
    activeDraftTeamTab = tab;
    const rosterBtn = document.getElementById('draft-tab-roster-btn');
    const needsBtn = document.getElementById('draft-tab-needs-btn');
    const rosterPane = document.getElementById('draft-roster-pane');
    const needsPane = document.getElementById('draft-needs-pane');

    if (tab === 'roster') {
        rosterBtn?.classList.add('bg-slate-900', 'text-white', 'shadow-sm');
        rosterBtn?.classList.remove('bg-slate-200', 'text-slate-700');
        needsBtn?.classList.add('bg-slate-200', 'text-slate-700');
        needsBtn?.classList.remove('bg-slate-900', 'text-white', 'shadow-sm');
        rosterPane?.classList.remove('hidden');
        needsPane?.classList.add('hidden');
    } else {
        needsBtn?.classList.add('bg-slate-900', 'text-white', 'shadow-sm');
        needsBtn?.classList.remove('bg-slate-200', 'text-slate-700');
        rosterBtn?.classList.add('bg-slate-200', 'text-slate-700');
        rosterBtn?.classList.remove('bg-slate-900', 'text-white', 'shadow-sm');
        needsPane?.classList.remove('hidden');
        rosterPane?.classList.add('hidden');
    }
};

function calculateTwoWayDepthAnalysis(roster) {
    const positions = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'];
    const idealCounts = { QB: 1, RB: 2, WR: 3, TE: 1, OL: 3, DL: 3, LB: 2, DB: 3 };

    return positions.map(pos => {
        const ideal = idealCounts[pos];
        const viables = roster.filter(p => Game.isPlayerViableForPosition(p, pos));

        const evaluated = viables.map(p => ({
            player: p,
            ovr: calculateOverall(p, pos),
            isPrimary: (p.pos || estimateBestPosition(p)) === pos
        })).sort((a, b) => b.ovr - a.ovr);

        const primaryCount = evaluated.filter(e => e.isPrimary).length;
        const twoWayCount = evaluated.length - primaryCount;

        const topOvr = evaluated.length > 0 ? evaluated[0].ovr : 0;
        const starterGroup = evaluated.slice(0, ideal);
        const starterAvg = starterGroup.length > 0
            ? Math.round(starterGroup.reduce((sum, item) => sum + item.ovr, 0) / starterGroup.length)
            : 0;

        let status = 'Empty';
        let badgeColor = 'bg-rose-100 text-rose-800 border-rose-300';
        if (evaluated.length >= ideal && starterAvg >= 65) {
            status = 'Solid';
            badgeColor = 'bg-emerald-100 text-emerald-800 border-emerald-300';
        } else if (evaluated.length >= ideal && starterAvg >= 52) {
            status = 'Average';
            badgeColor = 'bg-blue-100 text-blue-800 border-blue-300';
        } else if (evaluated.length > 0) {
            status = 'Needs Upgrade';
            badgeColor = 'bg-amber-100 text-amber-800 border-amber-300';
        }

        return {
            pos, ideal, viableCount: evaluated.length,
            primaryCount, twoWayCount, topOvr, starterAvg,
            status, badgeColor, players: evaluated
        };
    });
}

export function renderPlayerRoster(playerTeam) {
    if (!elements.rosterCount || !elements.draftRosterList || !playerTeam) return;
    const roster = getUIRosterObjects(playerTeam);
    elements.rosterCount.textContent = `${roster.length}/18`;

    // 1. Render Unsquished Full-Height Roster List
    elements.draftRosterList.innerHTML = roster.map(p => {
        const pos = p.pos || estimateBestPosition(p);
        const ovr = calculateOverall(p, pos);

        // Detect secondary two-way capabilities
        const secPositions = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'].filter(op =>
            op !== pos && Game.isPlayerViableForPosition(p, op)
        );
        const twoWayBadge = secPositions.length > 0
            ? `<span class="text-[9px] bg-slate-100 text-slate-500 font-bold px-1 rounded ml-1" title="Viable at: ${secPositions.join(', ')}">2W: ${secPositions[0]}</span>`
            : '';

        return `
        <li class="py-1.5 px-3 flex justify-between items-center text-xs hover:bg-slate-50 transition cursor-pointer" onclick="app.openPlayerCard('${p.id}')">
            <div class="flex items-center gap-1.5 truncate pr-2">
                <span class="text-slate-400 font-mono text-[10px] w-4">#${p.number || '--'}</span>
                <span class="font-semibold text-slate-900 truncate">${p.name}</span>
                <span class="text-[10px] text-slate-400 font-mono">(${p.age}yo)</span>
                ${twoWayBadge}
            </div>
            <div class="text-right shrink-0">
                <span class="font-bold text-[10px] bg-slate-100 text-slate-700 px-1 rounded mr-1">${pos}</span>
                <span class="font-mono text-xs font-black text-slate-900">${ovr}</span>
            </div>
        </li>`;
    }).join('') || '<li class="p-6 text-center text-slate-400 text-xs italic">No players drafted yet.</li>';

    // 2. Render Two-Way Positional Rooms & Quality Radar
    const summaryEl = document.getElementById('roster-summary');
    if (summaryEl) {
        const analysis = calculateTwoWayDepthAnalysis(roster);

        summaryEl.innerHTML = `
            <div class="space-y-1.5">
                <div class="flex justify-between items-center mb-1">
                    <span class="text-[10px] font-black uppercase tracking-wider text-slate-600">Unit Strength & 2-Way Depth</span>
                    <span class="text-[10px] text-slate-400 font-mono">Ideal vs. Viable (Avg Starter OVR)</span>
                </div>
                <div class="grid grid-cols-2 gap-1.5 font-mono text-xs">
                    ${analysis.map(item => {
                        return `
                        <div class="bg-white border p-1.5 rounded flex flex-col justify-between shadow-2xl hover:border-slate-400 transition" title="${item.viableCount} viable (${item.primaryCount} natural, ${item.twoWayCount} two-way). Top OVR: ${item.topOvr}">
                            <div class="flex justify-between items-center">
                                <span class="font-black text-slate-900 font-sans">${item.pos}</span>
                                <span class="text-[9px] font-black uppercase px-1 rounded border ${item.badgeColor}">${item.status}</span>
                            </div>
                            <div class="flex justify-between items-baseline mt-1 text-[11px]">
                                <span class="text-slate-500 font-bold">${item.viableCount}/${item.ideal} <span class="text-[9px] font-normal text-slate-400">(${item.twoWayCount > 0 ? `+${item.twoWayCount} 2W` : 'nat'})</span></span>
                                <span class="font-black text-slate-800">${item.starterAvg ? `${item.starterAvg} avg` : '--'}</span>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>
        `;
    }
}

// 3. Pop-Out Modal: Full Franchise Depth & Two-Way Analysis Window
window.app_openDraftTeamModal = function() {
    const gs = getGameState();
    if (!gs?.playerTeam) return;

    const roster = getUIRosterObjects(gs.playerTeam);
    const analysis = calculateTwoWayDepthAnalysis(roster);

    const modalHtml = `
        <div class="space-y-4">
            <!-- Strategic Header -->
            <div class="bg-slate-900 text-white p-3 rounded flex justify-between items-center text-xs">
                <div>
                    <h4 class="font-black text-sm uppercase tracking-wider text-amber-400">${gs.playerTeam.name} Depth Analysis</h4>
                    <p class="text-slate-400 text-[11px] mt-0.5">Roster Count: <b>${roster.length}/18</b> | Scheme: <b>${gs.playerTeam.formations?.offense || 'Balanced'}</b> / <b>${gs.playerTeam.formations?.defense || '3-2-3'}</b></p>
                </div>
                <div class="text-right">
                    <span class="text-[10px] text-slate-400 block uppercase">Street Cred</span>
                    <span class="font-black text-lg text-white">${gs.playerTeam.socialProfile?.streetCred || 50}</span>
                </div>
            </div>

            <!-- Two-Way Position Room Breakdown -->
            <div>
                <h5 class="text-xs font-black uppercase tracking-wider text-slate-700 mb-2">Positional Rooms & Quality (Starters vs. 2-Way Depth)</h5>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                    ${analysis.map(item => `
                        <div class="bg-white border border-slate-200 rounded p-2.5 shadow-sm">
                            <div class="flex justify-between items-center mb-1 pb-1 border-b border-slate-100">
                                <div class="flex items-center gap-2">
                                    <span class="font-black text-sm text-slate-900">${item.pos} Room</span>
                                    <span class="text-[9px] font-black uppercase px-1.5 py-0.2 rounded border ${item.badgeColor}">${item.status}</span>
                                </div>
                                <span class="font-mono text-xs font-bold text-slate-600">Starter Avg: <b class="text-slate-900">${item.starterAvg}</b></span>
                            </div>
                            <div class="text-[10px] text-slate-500 mb-1.5 flex justify-between">
                                <span>Ideal: <b>${item.ideal}</b> | Viable Total: <b>${item.viableCount}</b></span>
                                <span>(${item.primaryCount} Natural • ${item.twoWayCount} Two-Way)</span>
                            </div>
                            <div class="space-y-1 font-mono text-[11px]">
                                ${item.players.map(p => `
                                    <div class="flex justify-between items-center p-1 bg-slate-50 rounded hover:bg-slate-100 cursor-pointer" onclick="app.openPlayerCard('${p.player.id}')">
                                        <div class="flex items-center gap-1.5 truncate pr-2 font-sans">
                                            <span class="font-semibold text-slate-800 truncate">${p.player.name}</span>
                                            ${!p.isPrimary ? `<span class="bg-indigo-100 text-indigo-900 text-[8px] font-bold px-1 rounded uppercase">2-Way (${p.player.pos || 'ATH'})</span>` : ''}
                                        </div>
                                        <span class="font-bold text-slate-900">${p.ovr} OVR</span>
                                    </div>
                                `).join('') || '<p class="text-slate-400 italic text-[10px] py-1">No players viable at this position.</p>'}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;

    showModal("Franchise War Room & 2-Way Depth", modalHtml, null, null, null, "Close War Room");
};

export function renderDashboard(gameState) {
    if (!gameState?.playerTeam) return;
    const { playerTeam, year, currentWeek, messages } = gameState;
    const currentW = currentWeek < 9 ? `Week ${currentWeek + 1}` : 'Offseason';

    if (elements.dashboardTeamName) elements.dashboardTeamName.innerHTML = `${playerTeam.name}`;
    if (elements.dashboardRecord) elements.dashboardRecord.textContent = `${playerTeam.wins || 0} - ${playerTeam.losses || 0}${playerTeam.ties ? ` - ${playerTeam.ties}` : ''}`;
    if (elements.dashboardYear) elements.dashboardYear.textContent = year || '1';
    if (elements.dashboardWeek) elements.dashboardWeek.textContent = currentW;

    // Update the button appearance based on current phase
    if (elements.advanceWeekBtn) {
        if (currentWeek === 0 && !gameState.draftCompleted) {
            elements.advanceWeekBtn.innerHTML = `<span>Start Draft</span>`;
        } else if (currentWeek >= 9) {
            elements.advanceWeekBtn.innerHTML = `<span>Advance to Offseason →</span>`;
        } else {
            elements.advanceWeekBtn.innerHTML = `<span>Play Week ${currentWeek + 1}</span>`;
        }
    }

    if (messages) updateMessagesNotification(messages);
    const activeTab = elements.dashboardTabs?.querySelector('.tab-button.active')?.dataset.tab || 'my-team';
    switchTab(activeTab, gameState);
}


export function switchTab(tabId, gameState) {
    if (!elements.dashboardContent || !elements.dashboardTabs) return;

    elements.dashboardContent.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
    elements.dashboardTabs.querySelectorAll('.tab-button').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
    });

    const pane = document.getElementById(`tab-content-${tabId}`);
    const btn = elements.dashboardTabs.querySelector(`[data-tab="${tabId}"]`);
    if (pane) pane.classList.remove('hidden');
    if (btn) { btn.classList.add('active'); btn.setAttribute('aria-selected', 'true'); }

    if (!gameState) return;

    switch (tabId) {
        case 'my-team': renderMyTeamTab(gameState); break;
        case 'depth-chart': renderDepthChartTab(gameState); break;
        case 'schedule': renderScheduleTab(gameState); break;
        case 'standings': renderStandingsTab(gameState); break;
        case 'player-stats': renderPlayerStatsTab(gameState); break;
        case 'hall-of-fame': renderHallOfFameTab(gameState); break;
        case 'history': renderHistoryTab(gameState); break;
        case 'free-agents': renderFreeAgentsTab(gameState); break;
        case 'staff': renderStaffTab(gameState); break;
        case 'messages': renderMessagesTab(gameState); break;
    }
}

export function renderFreeAgentsTab(gameState) {
    const container = document.getElementById('free-agents-container');
    if (!container || !gameState) return;

    const posFilter = document.getElementById('fa-filter-pos')?.value || '';
    let pool = (gameState.players || []).filter(p =>
        p && !p.teamId &&
        p.status?.type !== 'retired' &&
        p.status?.type !== 'departed' &&
        p.age >= 12 && p.age <= 18
    );

    if (posFilter) {
        pool = pool.filter(p => {
            const pos = p.pos || estimateBestPosition(p);
            return pos === posFilter || p.favoriteOffensivePosition === posFilter || p.favoriteDefensivePosition === posFilter;
        });
    }

    pool.sort((a, b) => {
        const ovrA = calculateOverall(a, a.pos || estimateBestPosition(a));
        const ovrB = calculateOverall(b, b.pos || estimateBestPosition(b));
        return ovrB - ovrA;
    });

    if (pool.length === 0) {
        container.innerHTML = `<p class="p-8 text-center text-slate-400 italic text-xs">No free agents currently available matching filters.</p>`;
        return;
    }

    container.innerHTML = `
        <table class="min-w-full text-xs font-mono">
            <thead class="bg-slate-900 text-white uppercase text-[10px] select-none sticky top-0 z-10">
                <tr>
                    <th class="py-2.5 px-3 text-left font-sans">Prospect Name</th>
                    <th class="py-2 px-2 text-center">Pos</th>
                    <th class="py-2 px-2 text-center">OVR</th>
                    <th class="py-2 px-2 text-center">Age</th>
                    <th class="py-2 px-2 text-center">Pot</th>
                    <th class="py-2 px-2 text-center text-blue-400">SPD</th>
                    <th class="py-2 px-2 text-center">STR</th>
                    <th class="py-2 px-2 text-center">AGI</th>
                    <th class="py-2 px-2 text-center">HND</th>
                    <th class="py-2 px-2 text-center">TKL</th>
                    <th class="py-2 px-3 text-right font-sans">Action</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                ${pool.map(p => {
                    const pos = p.pos || estimateBestPosition(p);
                    const ovr = calculateOverall(p, pos);
                    return `
                    <tr class="hover:bg-slate-50 transition cursor-pointer" onclick="app.openPlayerCard('${p.id}')">
                        <td class="py-2 px-3 font-sans font-semibold text-slate-900 truncate">
                            <span>${p.name}</span>
                            <span class="text-slate-400 text-[10px] ml-1 font-mono">(${p.archetypeName || 'Athlete'})</span>
                        </td>
                        <td class="text-center py-2 px-2"><span class="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-bold text-[10px]">${pos}</span></td>
                        <td class="text-center py-2 px-2 font-black text-slate-900">${ovr}</td>
                        <td class="text-center py-2 px-2 text-slate-600">${p.age}</td>
                        <td class="text-center py-2 px-2 font-bold ${p.potential === 'A' ? 'text-amber-600' : 'text-slate-500'}">${p.potential || '?'}</td>
                        <td class="text-center py-2 px-2 text-blue-600 font-bold">${p.attributes?.physical?.speed || 0}</td>
                        <td class="text-center py-2 px-2">${p.attributes?.physical?.strength || 0}</td>
                        <td class="text-center py-2 px-2">${p.attributes?.physical?.agility || 0}</td>
                        <td class="text-center py-2 px-2">${p.attributes?.technical?.catchingHands || 0}</td>
                        <td class="text-center py-2 px-2">${p.attributes?.technical?.tackling || 0}</td>
                        <td class="text-right py-2 px-3 font-sans" onclick="event.stopPropagation()">
                            <button class="bg-slate-900 hover:bg-slate-800 text-white font-bold px-2.5 py-1 rounded text-[10px] uppercase tracking-wider" onclick="app.openPlayerCard('${p.id}')">
                                Pitch Contract
                            </button>
                        </td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>
    `;
}

let offseasonFABids = [];
let offseasonFADay = 1;

export function startOffseasonFAMinigame(gameState) {
    offseasonFABids = [];
    offseasonFADay = 1;
    Game.clearPlayerMarketCache?.(gameState);
    showScreen('offseason-fa-screen');
    renderOffseasonFAScreen(gameState);
}

export function renderOffseasonFAScreen(gameState) {
    if (!gameState?.playerTeam) return;

    const roundIndicator = document.getElementById('fa-round-indicator');
    const userTokensEl = document.getElementById('fa-user-tokens');
    const userRosterEl = document.getElementById('fa-user-roster-count');
    const advanceBtn = document.getElementById('fa-advance-day-btn');

    const totalTokens = gameState.playerTeam.socialProfile?.favorTokens || 0;
    const committedTokens = offseasonFABids.reduce((s, b) => s + (b.offer.tokensOffered || 0), 0);
    const availableTokens = Math.max(0, totalTokens - committedTokens);

    if (roundIndicator) {
        roundIndicator.textContent = offseasonFADay >= 3 ? "Day 3 of 3 (Final Day)" : `Day ${offseasonFADay} of 3`;
    }
    if (userTokensEl) {
        userTokensEl.textContent = `${availableTokens} (${committedTokens} committed)`;
    }
    if (userRosterEl) {
        userRosterEl.textContent = `${gameState.playerTeam.roster.length}/18`;
    }
    if (advanceBtn) {
        advanceBtn.className = "bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-4 py-2 rounded text-xs uppercase tracking-wider shadow-sm transition";
        advanceBtn.onclick = () => window.app.advanceOffseasonFADay();
        advanceBtn.textContent = offseasonFADay >= 3 
            ? "Submit Final Bids & Resolve Day 3 →" 
            : `Submit Bids & Advance to Day ${offseasonFADay + 1} →`;
    }

    renderOffseasonFAPool(gameState);
    renderPendingBidsList(gameState);
}


export function renderOffseasonFAPool(gameState) {
    const container = document.getElementById('fa-minigame-pool-tbody');
    if (!container || !gameState) return;

    const filterPos = document.getElementById('fa-minigame-filter-pos')?.value || '';
    let pool = (gameState.players || []).filter(p =>
        p && !p.teamId &&
        p.status?.type !== 'retired' &&
        p.status?.type !== 'departed' &&
        p.age >= 12 && p.age <= 18
    );

    if (filterPos) {
        pool = pool.filter(p => Game.isPlayerViableForPosition(p, filterPos));
    }

    pool.sort((a, b) => {
        const ovrA = calculateOverall(a, a.pos || estimateBestPosition(a));
        const ovrB = calculateOverall(b, b.pos || estimateBestPosition(b));
        return ovrB - ovrA;
    });

    if (pool.length === 0) {
        container.innerHTML = `<p class="p-8 text-center text-slate-400 italic text-xs">No free agents available matching this filter.</p>`;
        return;
    }

    container.innerHTML = `
        <table class="min-w-full text-xs font-mono">
            <thead class="bg-slate-900 text-white uppercase text-[10px] select-none sticky top-0 z-10">
                <tr>
                    <th class="py-2 px-3 text-left font-sans">Prospect Name</th>
                    <th class="py-2 px-2 text-center">Pos</th>
                    <th class="py-2 px-2 text-center">OVR</th>
                    <th class="py-2 px-2 text-center">Pot</th>
                    <th class="py-2 px-2 text-center text-blue-400">SPD</th>
                    <th class="py-2 px-2 text-center">STR</th>
                    <th class="py-2 px-3 text-left font-sans">Blacktop Grapevine & Suitors</th>
                    <th class="py-2 px-3 text-right font-sans">Action</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                ${pool.map(p => {
                    const pos = p.pos || estimateBestPosition(p);
                    const ovr = calculateOverall(p, pos);
                    const userBid = offseasonFABids.find(b => b.playerId === p.id);
                    const intel = Game.getPlayerMarketIntel(p, gameState);

                    let heatBadge = '<span class="bg-slate-100 text-slate-500 font-bold px-1.5 py-0.5 rounded text-[9px]">💤 Quiet</span>';
                    if (intel.heat === 'HOT') {
                        heatBadge = `<span class="bg-rose-100 text-rose-800 border border-rose-300 font-bold px-1.5 py-0.5 rounded text-[9px]" title="${intel.suitorNames.join(', ')}">🔥 Hot (${intel.suitorNames.map(n => n.replace('The ', '')).join(', ')})</span>`;
                    } else if (intel.heat === 'WARM') {
                        heatBadge = `<span class="bg-amber-100 text-amber-900 border border-amber-300 font-bold px-1.5 py-0.5 rounded text-[9px]" title="${intel.suitorNames.join(', ')}">💬 Warm (${intel.suitorNames.map(n => n.replace('The ', '')).join(', ')})</span>`;
                    }

                    return `
                    <tr class="hover:bg-slate-50 transition cursor-pointer" onclick="app.openPlayerCard('${p.id}')">
                        <td class="py-2 px-3 font-sans font-semibold text-slate-900 truncate max-w-[130px]">
                            <span>${p.name}</span>
                            <span class="text-slate-400 text-[10px] ml-1 font-mono">(${p.age}yo)</span>
                        </td>
                        <td class="text-center py-2 px-2"><span class="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-bold text-[10px]">${pos}</span></td>
                        <td class="text-center py-2 px-2 font-black text-slate-900">${ovr}</td>
                        <td class="text-center py-2 px-2 font-bold ${p.potential === 'A' ? 'text-amber-600' : 'text-slate-500'}">${p.potential || '?'}</td>
                        <td class="text-center py-2 px-2 text-blue-600 font-bold">${p.attributes?.physical?.speed || 0}</td>
                        <td class="text-center py-2 px-2 text-slate-700">${p.attributes?.physical?.strength || 0}</td>
                        <td class="py-2 px-3 font-sans">
                            <div class="flex items-center gap-1.5 truncate max-w-[240px]">
                                ${heatBadge}
                                <span class="text-[10px] text-slate-500 truncate italic" title="${intel.rumorText}">${intel.rumorText}</span>
                            </div>
                        </td>
                        <td class="text-right py-2 px-3 font-sans" onclick="event.stopPropagation()">
                            ${userBid ? `
                            <button class="bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 font-bold px-2 py-1 rounded text-[10px] uppercase tracking-tight flex items-center gap-1 shadow-sm transition" onclick="app.openBidModal('${p.id}')" title="Edit your offer">
                                <span>Bid: ${userBid.offer.role}</span>
                                <span class="text-amber-700 font-mono">(${userBid.offer.tokensOffered}🪙)</span>
                                <span>✏️</span>
                            </button>` : `
                            <button class="bg-slate-900 hover:bg-slate-800 text-white font-bold px-3 py-1 rounded text-[10px] uppercase tracking-wider transition shadow-sm" onclick="app.openBidModal('${p.id}')">
                                Bid
                            </button>`}
                        </td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>
    `;
}

export function renderPendingBidsList(gameState) {
    const list = document.getElementById('fa-pending-bids-list');
    const countEl = document.getElementById('fa-bids-count');
    if (!list) return;

    if (countEl) countEl.textContent = `${offseasonFABids.length} Active`;

    const totalTokens = gameState?.playerTeam?.socialProfile?.favorTokens || 0;
    const committedTokens = offseasonFABids.reduce((s, b) => s + (b.offer.tokensOffered || 0), 0);

    if (offseasonFABids.length === 0) {
        list.innerHTML = `
            <div class="p-4 text-center text-slate-400 italic text-[11px] bg-slate-50 border border-dashed rounded">
                No bids placed yet today. Click "Bid" on any prospect to make an offer.
            </div>`;
        return;
    }

    list.innerHTML = `
        <div class="text-[10px] font-mono text-slate-500 mb-1 flex justify-between border-b pb-1">
            <span>Tokens: <b>${committedTokens} Committed</b></span>
            <span>Available: <b>${Math.max(0, totalTokens - committedTokens)} Left</b></span>
        </div>
        <div class="space-y-1.5">
            ${offseasonFABids.map((b, idx) => {
                const p = Game.getPlayer(b.playerId);
                const pos = p ? (p.pos || estimateBestPosition(p)) : 'UTIL';
                const ovr = p ? calculateOverall(p, pos) : 0;
                const intel = p ? Game.getPlayerMarketIntel(p, gameState) : { heat: 'QUIET', suitorNames: [] };

                let heatNote = `<span class="text-[9px] text-slate-400 font-mono">💤 Uncontested</span>`;
                if (intel.heat === 'HOT') heatNote = `<span class="text-[9px] text-rose-600 font-bold font-mono">🔥 vs. ${intel.suitorNames.map(n => n.replace('The ', '')).join(', ')}</span>`;
                else if (intel.heat === 'WARM') heatNote = `<span class="text-[9px] text-amber-600 font-bold font-mono">💬 vs. ${intel.suitorNames.map(n => n.replace('The ', '')).join(', ')}</span>`;

                return `
                <div class="bg-slate-50 border border-slate-200 p-2 rounded flex justify-between items-center text-xs hover:border-slate-300 transition">
                    <div class="truncate pr-2">
                        <div class="flex items-center gap-1.5">
                            <span class="font-bold text-slate-900 truncate">${p?.name || 'Prospect'}</span>
                            <span class="bg-slate-200 text-slate-700 text-[9px] font-mono font-bold px-1 rounded">${pos} ${ovr}</span>
                        </div>
                        <div class="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                            <span class="font-bold text-slate-700">${b.offer.role}</span>
                            ${b.offer.promiseTouches === 'FEATURED' ? '• <span class="text-blue-600 font-bold">Focal</span>' : ''}
                            • <span>${b.offer.tokensOffered} Token(s)</span>
                        </div>
                        <div class="mt-0.5">${heatNote}</div>
                    </div>
                    <div class="flex items-center gap-1 shrink-0">
                        <button class="text-slate-500 hover:text-slate-800 bg-white border border-slate-200 font-bold text-[10px] px-1.5 py-0.5 rounded shadow-sm" onclick="app.openBidModal('${b.playerId}')" title="Edit offer">✏️</button>
                        <button class="text-rose-600 hover:text-rose-800 bg-white border border-rose-200 font-bold text-xs px-1.5 py-0.5 rounded shadow-sm" onclick="app.cancelOffseasonBid(${idx})" title="Cancel bid">✕</button>
                    </div>
                </div>`;
            }).join('')}
        </div>
    `;
}

export function getOffseasonFABids() { return offseasonFABids; }
export function addOffseasonFABid(bid) {
    const existingIndex = offseasonFABids.findIndex(b => b.playerId === bid.playerId);
    if (existingIndex >= 0) {
        offseasonFABids[existingIndex] = bid;
    } else {
        offseasonFABids.push(bid);
    }
}
export function removeOffseasonFABid(idx) { offseasonFABids.splice(idx, 1); }
export function getOffseasonFADay() { return offseasonFADay; }
export function incrementOffseasonFADay() { offseasonFADay++; }
export function clearOffseasonFABids() { offseasonFABids = []; }

export function renderStaffTab(gameState) {
    const container = document.getElementById('staff-container');
    if (!container || !gameState?.playerTeam) return;

    const team = gameState.playerTeam;
    if (!team.staff) Game.initializeTeamStaff(team);
    if (!gameState.availableStaff) gameState.availableStaff = Game.generateStaffPool(6);

    // Auto-repair: Prevent Head Coach from sharing the GM's exact name
    if (team.staff.coach && team.staff.gm && team.staff.coach.name === team.staff.gm.name) {
        const former = team.staff.coach.formerPlayerId ? Game.getPlayer(team.staff.coach.formerPlayerId) : null;
        team.staff.coach.name = former ? former.name : `${Game.getRandom(firstNames)} ${Game.getRandom(lastNames)}`;
        team.coach = team.staff.coach;
    }

    const roles = [
        { key: 'gm', title: 'General Manager (You)', icon: '👑', desc: 'Oversees the program, hires staff, and builds team culture.' },
        { key: 'coach', title: 'Head Coach (Sideline Boss)', icon: ' whistle', desc: 'Calls plays, sets offensive/defensive schemes, and manages timeouts.' },
        { key: 'scout', title: 'Park Informant (Scout)', icon: '🚲', desc: 'Drives draft board fog-of-war and detects character red flags.' },
        { key: 'trainer', title: 'Sideline Anchor (Trainer)', icon: '🧊', desc: 'Controls fatigue dissipation, conditioning, and injury rehabilitation.' }
    ];

    window.app_fireStaff = (roleKey) => {
        const member = team.staff[roleKey];
        if (!member) return;
        const roleLabels = { coach: 'Head Coach', scout: 'Park Scout', trainer: 'Sideline Trainer' };
        const roleLabel = roleLabels[roleKey] || roleKey.toUpperCase();

        const modalHtml = `
            <div class="space-y-3 text-left text-xs">
                <p class="text-slate-700 leading-relaxed">
                    Are you sure you want to relieve <b>${member.name}</b> (${roleLabel}) of their duties?
                </p>
                <div class="bg-amber-50 border border-amber-200 p-2.5 rounded text-amber-900 text-[11px]">
                    They will pack up their clipboard and return to the neighborhood sideline market. Your ${roleLabel} position will be vacant until you hire a replacement.
                </div>
            </div>
        `;

        showModal(
            `Relieve ${roleLabel} of Duties?`,
            modalHtml,
            () => {
                member.teamId = null;
                if (gameState.availableStaff) gameState.availableStaff.push(member);
                team.staff[roleKey] = null;
                if (roleKey === 'coach') team.coach = null;
                renderStaffTab(gameState);
            },
            "Relieve of Duties",
            null,
            "Keep on Staff"
        );
    };

    window.app_hireStaff = (staffId, roleKey) => {
        const staff = gameState.availableStaff.find(s => s.id === staffId);
        if (!staff) return;

        const tokensAvailable = team.socialProfile?.favorTokens || 0;
        const roleLabels = { coach: 'Head Coach', scout: 'Park Scout', trainer: 'Sideline Trainer' };
        const roleName = roleLabels[roleKey] || roleKey.toUpperCase();
        const isHeadCoach = roleKey === 'coach';

        const pitchModalHtml = `
            <div class="space-y-3.5 text-left text-xs">
                <!-- Candidate Identity Header -->
                <div class="bg-slate-900 text-white p-3 rounded flex justify-between items-start">
                    <div>
                        <div class="flex items-center gap-2">
                            <h4 class="font-black text-sm text-white">${staff.name}</h4>
                            <span class="text-[9px] bg-slate-800 text-amber-400 font-bold px-1.5 py-0.5 rounded border border-slate-700">${staff.age}yo</span>
                        </div>
                        <p class="text-[11px] text-slate-400 mt-0.5 font-sans">${staff.biases.personality.name} • ${staff.biases.tactical?.name || 'Tactician'}</p>
                    </div>
                    <span class="text-xs bg-amber-500 text-slate-950 font-black px-2 py-0.5 rounded uppercase">
                        ${roleName}
                    </span>
                </div>

                ${staff.formerPlayerBio ? `
                <div class="bg-amber-50 border border-amber-200 p-2 rounded text-amber-900 font-bold text-[10px]">
                    🎓 Park Alumni: ${staff.formerPlayerBio}
                </div>` : ''}

                <!-- Candidate Philosophy Bio -->
                <div class="bg-slate-50 border border-slate-200 p-2.5 rounded text-slate-700 italic text-[11px]">
                    "${staff.biases.tactical?.desc || staff.biases.personality.desc}"
                </div>

                <!-- Deep Pitch Options -->
                <div class="space-y-2.5">
                    ${isHeadCoach ? `
                    <div>
                        <label class="block text-[10px] font-black uppercase tracking-wider text-slate-600 mb-1">
                            Scheme Autonomy & Play-Calling Rights
                        </label>
                        <select id="staff-scheme-promise" class="w-full p-2 border border-slate-300 rounded font-bold text-slate-800 bg-white text-xs outline-none">
                            <option value="COACH_CHOICE" selected>Full Autonomy: Coach sets offensive/defensive gameplan (+Interest)</option>
                            <option value="GM_CHOICE">GM Override: Front office dictates formations</option>
                        </select>
                    </div>` : ''}

                    <div>
                        <label class="block text-[10px] font-black uppercase tracking-wider text-slate-600 mb-1">
                            Program Practice Focus & Sideline Culture
                        </label>
                        <select id="staff-practice-focus" class="w-full p-2 border border-slate-300 rounded font-bold text-slate-800 bg-white text-xs outline-none">
                            <option value="CONDITIONING">Grit & Conditioning (Tree runs, tire drills; favors tough coaches)</option>
                            <option value="CHALK_TALK">Chalk Talks & Film (Napkin route design, high playbook IQ study)</option>
                            <option value="FUN_SCRIMMAGE">Sandlot Chemistry (Scrimmages, freeze-pop breaks; favors player coaches)</option>
                        </select>
                    </div>

                    <div>
                        <label class="block text-[10px] font-black uppercase tracking-wider text-slate-600 mb-1">
                            Favor Token Sweetener (Available: ${tokensAvailable})
                        </label>
                        <select id="staff-pitch-tokens" class="w-full p-2 border border-slate-300 rounded font-bold text-slate-800 bg-white text-xs outline-none">
                            <option value="0">0 Tokens (Handshake & standard program pitch)</option>
                            ${tokensAvailable >= 1 ? '<option value="1">1 Token (Lend your bike, extra equipment)</option>' : ''}
                            ${tokensAvailable >= 2 ? '<option value="2">2 Tokens (Major favors, mowing park field, big concessions)</option>' : ''}
                        </select>
                    </div>
                </div>
            </div>
        `;

        showModal(`Recruit ${roleName}: ${staff.name}`, pitchModalHtml, () => {
            const tokensOffered = parseInt(document.getElementById('staff-pitch-tokens')?.value || '0', 10);
            const schemePromise = document.getElementById('staff-scheme-promise')?.value || 'GM_CHOICE';
            const practiceFocus = document.getElementById('staff-practice-focus')?.value || 'BALANCED';

            const pitch = { tokensOffered, schemePromise, practiceFocus };
            const negotiation = Game.evaluateStaffNegotiation(staff, team, roleKey, pitch);

            const resultHtml = `
                <div class="space-y-3 text-left text-xs">
                    <div class="p-3 rounded border ${negotiation.accepted ? 'bg-emerald-50 border-emerald-300 text-emerald-950' : 'bg-rose-50 border-rose-300 text-rose-950'}">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="text-base">${negotiation.accepted ? '🤝' : '✋'}</span>
                            <h4 class="font-black text-sm uppercase">${negotiation.accepted ? 'Offer Accepted!' : 'Offer Declined'}</h4>
                        </div>
                        <p class="italic text-[11px] leading-relaxed mb-2">${negotiation.quote}</p>
                        <div class="text-[10px] font-mono border-t pt-1.5 ${negotiation.accepted ? 'border-emerald-200' : 'border-rose-200'}">
                            Interest Score: <b>${negotiation.interestScore}/100</b> (Threshold: 45)
                        </div>
                    </div>

                    <div class="bg-slate-50 border border-slate-200 p-2.5 rounded">
                        <span class="font-black text-[10px] uppercase text-slate-500 block mb-1">Negotiation Factors</span>
                        <ul class="space-y-0.5 text-[11px] font-mono text-slate-700">
                            ${negotiation.reasons.map(r => `<li>• ${r}</li>`).join('')}
                        </ul>
                    </div>
                </div>
            `;

            if (negotiation.accepted) {
                if (tokensOffered > 0) {
                    team.socialProfile.favorTokens = Math.max(0, team.socialProfile.favorTokens - tokensOffered);
                }

                const oldStaff = team.staff[roleKey];
                if (oldStaff) {
                    oldStaff.teamId = null;
                    gameState.availableStaff.push(oldStaff);
                }

                const idx = gameState.availableStaff.findIndex(s => s.id === staffId);
                if (idx > -1) gameState.availableStaff.splice(idx, 1);

                staff.role = roleKey;
                staff.teamId = team.id;
                team.staff[roleKey] = staff;

                if (roleKey === 'coach') {
                    team.coach = staff;
                    if (schemePromise === 'COACH_CHOICE' && staff.preferredOffense) {
                        team.formations.offense = staff.preferredOffense;
                    }
                    if (schemePromise === 'COACH_CHOICE' && staff.preferredDefense) {
                        team.formations.defense = staff.preferredDefense;
                    }
                }

                renderStaffTab(gameState);
                showModal("Contract Finalized 🤝", resultHtml, null, null, null, "Great, Welcome Aboard!");
            } else {
                showModal("Pitch Rejected ✋", resultHtml, null, null, null, "Understood");
            }
        }, "Submit Contract Offer");
    };

    let html = `
        <div class="mb-4 bg-slate-900 text-white rounded p-4 border border-slate-700 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
            <div>
                <h3 class="text-lg font-black uppercase tracking-wider text-amber-400">Front Office & Sideline Staff</h3>
                <p class="text-xs text-slate-300">Staff traits and biases directly warp play-calling, scouting accuracy, and player development.</p>
            </div>
            <div class="text-[11px] font-mono text-slate-400 bg-slate-800 px-3 py-1.5 rounded border border-slate-700">
                Staff Budget: <b class="text-white">${team.socialProfile?.favorTokens || 3} Favor Tokens</b>
            </div>
        </div>

        <!-- 1. Current Staff Hierarchy Cards -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
    `;

    roles.forEach(r => {
        const member = team.staff[r.key];
        if (!member) {
            html += `
                <div class="bg-white rounded border border-dashed border-slate-300 p-4 flex flex-col justify-between items-center text-center shadow-sm min-h-[220px]">
                    <div>
                        <span class="text-2xl block mb-1">🪑</span>
                        <h4 class="font-bold text-xs uppercase text-slate-700">${r.title}</h4>
                        <p class="text-[10px] text-slate-400 mt-1">${r.desc}</p>
                    </div>
                    <span class="text-xs font-black text-rose-500 bg-rose-50 border border-rose-200 px-2 py-1 rounded">VACANT</span>
                </div>`;
            return;
        }

        const rt = member.ratings;
        const b = member.biases;
        const isUserGM = r.key === 'gm';

        html += `
            <div class="bg-white rounded border border-slate-300 p-3.5 shadow-sm flex flex-col justify-between min-h-[220px]">
                <div>
                    <div class="flex justify-between items-start mb-1.5 border-b border-slate-100 pb-1.5">
                        <div>
                            <span class="text-[9px] font-black uppercase text-amber-700 block tracking-wider">${r.title}</span>
                            <h4 class="font-bold text-sm text-slate-900 truncate">${member.name}</h4>
                            ${member.formerPlayerBio ? `<span class="text-[9px] bg-amber-100 text-amber-900 font-bold px-1 rounded block mt-0.5" title="${member.formerPlayerBio}">🎓 Park Legend</span>` : ''}
                        </div>
                        <span class="text-[10px] font-mono text-slate-400">${member.age}yo</span>
                    </div>

                    <!-- Traits & Biases -->
                    <div class="space-y-1 mb-2 text-[10px]">
                        ${b.tactical ? `<div class="bg-slate-50 border border-slate-200 p-1 rounded"><b class="text-blue-700">Scheme:</b> ${b.tactical.name}</div>` : ''}
                        ${b.scouting ? `<div class="bg-slate-50 border border-slate-200 p-1 rounded"><b class="text-indigo-700">Eye:</b> ${b.scouting.name}</div>` : ''}
                        ${b.personality ? `<div class="bg-slate-50 border border-slate-200 p-1 rounded"><b class="text-emerald-700">Style:</b> ${b.personality.name}</div>` : ''}
                    </div>

                    <!-- Key Ratings Matrix -->
                    <div class="grid grid-cols-2 gap-1 text-[10px] font-mono bg-slate-50 p-2 rounded border border-slate-200">
                        <div>Tactics: <b class="text-slate-800">${Math.round((rt.offSchemeMastery + rt.defSchemeMastery) / 2)}</b></div>
                        <div>Adjust: <b class="text-slate-800">${rt.inGameAdjustments}</b></div>
                        <div>Scout: <b class="text-slate-800">${Math.round((rt.evalPhysicals + rt.evalTechnique) / 2)}</b></div>
                        <div>Teach: <b class="text-slate-800">${rt.teaching}</b></div>
                    </div>
                </div>

                ${!isUserGM ? `
                <div class="mt-3 pt-2 border-t border-slate-100 flex justify-end">
                    <button class="text-rose-600 hover:text-rose-800 text-[10px] font-bold uppercase tracking-wider" onclick="app_fireStaff('${r.key}')">Fire Staff</button>
                </div>` : '<div class="mt-2 text-center text-[9px] text-slate-400 font-bold uppercase">Franchise Controller</div>'}
            </div>
        `;
    });

    html += `</div>`;

    // 2. The Sideline Candidate Market (Available Hires)
    html += `
        <div class="bg-white rounded border border-slate-300 p-4 shadow-sm">
            <h4 class="font-black text-xs uppercase tracking-wider text-slate-800 border-b border-slate-200 pb-2 mb-3">
                Neighborhood Sideline Market (Available Candidates)
            </h4>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                ${gameState.availableStaff.map(s => {
        return `
                    <div class="bg-slate-50 rounded border border-slate-200 p-3 flex flex-col justify-between text-xs hover:border-slate-400 transition">
                        <div>
                            <div class="flex justify-between items-start mb-1">
                                <div>
                                    <h5 class="font-bold text-slate-900">${s.name}</h5>
                                    <span class="text-[9px] text-slate-500">${s.age}yo • ${s.biases.personality.name}</span>
                                </div>
                                ${s.formerPlayerBio ? `<span class="text-[9px] bg-amber-100 text-amber-900 font-bold px-1 rounded" title="${s.formerPlayerBio}">🎓 Legend</span>` : ''}
                            </div>
                            <p class="text-[10px] text-slate-600 italic mb-2">"${s.biases.tactical?.desc || s.biases.scouting?.desc || s.biases.personality.desc}"</p>
                            
                            <div class="grid grid-cols-3 gap-1 text-[10px] font-mono text-center mb-3">
                                <div class="bg-white p-1 rounded border"><span>Tactics</span><br><b>${s.ratings.offSchemeMastery}</b></div>
                                <div class="bg-white p-1 rounded border"><span>Scout</span><br><b>${s.ratings.evalPhysicals}</b></div>
                                <div class="bg-white p-1 rounded border"><span>Teach</span><br><b>${s.ratings.teaching}</b></div>
                            </div>
                        </div>

                        <div class="flex gap-1.5 border-t border-slate-200 pt-2">
                            <button class="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-bold py-1 rounded text-[10px]" onclick="app_hireStaff('${s.id}', 'coach')">Hire Coach</button>
                            <button class="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold py-1 rounded text-[10px]" onclick="app_hireStaff('${s.id}', 'scout')">Hire Scout</button>
                            <button class="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold py-1 rounded text-[10px]" onclick="app_hireStaff('${s.id}', 'trainer')">Hire Trainer</button>
                        </div>
                    </div>`;
    }).join('')}
            </div>
        </div>
    `;

    container.innerHTML = html;
}

let rosterSortCol = 'ovr';
let rosterSortDir = 'desc';

window.app_setRosterSort = function (col) {
    if (rosterSortCol === col) {
        rosterSortDir = (rosterSortDir === 'desc') ? 'asc' : 'desc';
    } else {
        rosterSortCol = col;
        rosterSortDir = 'desc';
    }
    renderMyTeamTab(getGameState());
};

function renderMyTeamTab(gameState) {
    if (!elements.myTeamRoster || !gameState?.playerTeam) return;
    const roster = getUIRosterObjects(gameState.playerTeam);

    const sortedRoster = [...roster].sort((a, b) => {
        const bestPosA = a.pos || estimateBestPosition(a);
        const bestPosB = b.pos || estimateBestPosition(b);
        const ovrA = calculateOverall(a, bestPosA);
        const ovrB = calculateOverall(b, bestPosB);

        let valA, valB;
        if (rosterSortCol === 'name') { valA = a.name; valB = b.name; }
        else if (rosterSortCol === 'ovr') { valA = ovrA; valB = ovrB; }
        else if (rosterSortCol === 'age') { valA = a.age; valB = b.age; }
        else if (rosterSortCol === 'pot') { valA = a.potential || 'C'; valB = b.potential || 'C'; }
        else if (rosterSortCol === 'energy') { valA = 100 - (a.fatigue || 0); valB = 100 - (b.fatigue || 0); }
        else {
            valA = (a.attributes?.physical?.[rosterSortCol] ?? a.attributes?.technical?.[rosterSortCol] ?? a.attributes?.mental?.[rosterSortCol]) || 0;
            valB = (b.attributes?.physical?.[rosterSortCol] ?? b.attributes?.technical?.[rosterSortCol] ?? b.attributes?.mental?.[rosterSortCol]) || 0;
        }

        if (typeof valA === 'string') {
            return rosterSortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return rosterSortDir === 'asc' ? valA - valB : valB - valA;
    });

    const getIndicator = (col) => rosterSortCol === col ? (rosterSortDir === 'desc' ? ' ▼' : ' ▲') : '';

    let rosterNotice = '';
    if (roster.length < 14) {
        rosterNotice = `
        <div class="bg-amber-50 border-b border-amber-200 p-2.5 px-4 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900 shrink-0">
            <div class="flex items-center gap-2">
                <span class="text-base">⚠️</span>
                <span><b>Roster Depth Low (${roster.length}/18):</b> You need at least 14 players for two-way stamina and backup rotations.</span>
            </div>
            <div class="flex items-center gap-2">
                <button class="bg-slate-900 text-white font-bold px-2.5 py-1 rounded text-[11px] uppercase tracking-wider hover:bg-slate-800 transition" onclick="app.switchTab('free-agents')">
                    Browse Free Agents →
                </button>
                <button class="bg-emerald-700 text-white font-bold px-2.5 py-1 rounded text-[11px] uppercase tracking-wider hover:bg-emerald-800 transition shadow-sm" onclick="app.autoFillRoster()">
                    ⚡ Auto-Invite Walk-Ons
                </button>
            </div>
        </div>`;
    }

    let html = rosterNotice + `
    <div class="overflow-x-auto">
        <table class="min-w-full bg-white text-xs">
            <thead class="bg-slate-900 text-white sticky top-0 z-10 select-none uppercase tracking-wider text-[11px]">
                <tr>
                    <th class="py-2.5 px-3 text-left sticky left-0 bg-slate-900 z-20 cursor-pointer hover:bg-slate-800" onclick="app_setRosterSort('name')">Player${getIndicator('name')}</th>
                    <th class="py-2.5 px-2 text-center cursor-pointer hover:bg-slate-800" onclick="app_setRosterSort('ovr')">Pos / OVR${getIndicator('ovr')}</th>
                    <th class="py-2.5 px-2 text-center" title="Team Captain">Cap</th>
                    <th class="py-2.5 px-2 text-center cursor-pointer hover:bg-slate-800" onclick="app_setRosterSort('age')">Age${getIndicator('age')}</th>
                    <th class="py-2.5 px-2 text-center cursor-pointer hover:bg-slate-800" onclick="app_setRosterSort('pot')">Pot${getIndicator('pot')}</th>
                    <th class="py-2.5 px-2 text-center cursor-pointer hover:bg-slate-800" onclick="app_setRosterSort('energy')">Energy${getIndicator('energy')}</th>
                    <th class="py-2.5 px-2 text-center cursor-pointer hover:bg-slate-800 text-blue-400" onclick="app_setRosterSort('speed')">SPD${getIndicator('speed')}</th>
                    <th class="py-2.5 px-2 text-center cursor-pointer hover:bg-slate-800" onclick="app_setRosterSort('strength')">STR${getIndicator('strength')}</th>
                    <th class="py-2.5 px-2 text-center cursor-pointer hover:bg-slate-800" onclick="app_setRosterSort('agility')">AGI${getIndicator('agility')}</th>
                    <th class="py-2.5 px-2 text-center cursor-pointer hover:bg-slate-800" onclick="app_setRosterSort('playbookIQ')">IQ${getIndicator('playbookIQ')}</th>
                    <th class="py-2.5 px-2 text-center cursor-pointer hover:bg-slate-800" onclick="app_setRosterSort('throwingAccuracy')">THR${getIndicator('throwingAccuracy')}</th>
                    <th class="py-2.5 px-2 text-center cursor-pointer hover:bg-slate-800" onclick="app_setRosterSort('catchingHands')">HND${getIndicator('catchingHands')}</th>
                    <th class="py-2.5 px-2 text-center cursor-pointer hover:bg-slate-800" onclick="app_setRosterSort('blocking')">BLK${getIndicator('blocking')}</th>
                    <th class="py-2.5 px-2 text-center cursor-pointer hover:bg-slate-800" onclick="app_setRosterSort('tackling')">TKL${getIndicator('tackling')}</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-mono">`;

    if (sortedRoster.length === 0) {
        html += `<tr><td colspan="14" class="p-6 text-center text-slate-400 font-sans italic">Roster empty.</td></tr>`;
    } else {
        sortedRoster.forEach(p => {
            const isCap = gameState.playerTeam.captainId === p.id;
            const pos = p.pos || estimateBestPosition(p);
            const ovr = calculateOverall(p, pos);
            const energy = Math.max(0, Math.round(100 - (p.fatigue || 0)));
            const energyColor = energy > 75 ? 'bg-emerald-500' : (energy > 50 ? 'bg-amber-500' : 'bg-rose-500');

            html += `
            <tr data-player-id="${p.id}" class="hover:bg-slate-50 transition cursor-pointer group">
                <td class="py-2 px-3 font-semibold text-slate-900 sticky left-0 bg-white group-hover:bg-slate-50 z-10 flex items-center gap-2 truncate font-sans">
                    <span class="text-slate-400 font-mono text-[10px] w-4">#${p.number || '--'}</span>
                    <span class="truncate group-hover:text-amber-600 transition">${p.name}</span>
                    ${p.status?.duration > 0 ? `<span class="text-[9px] bg-rose-100 text-rose-700 px-1 py-0.5 rounded font-bold" title="${p.status.description}">🩹 ${p.status.duration}w</span>` : ''}
                </td>
                <td class="text-center py-2 px-2">
                    <span class="font-bold text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded mr-1">${pos}</span>
                    <span class="font-black text-xs ${ovr >= 40 ? 'text-emerald-700' : (ovr >= 30 ? 'text-slate-900' : 'text-slate-500')}">${ovr}</span>
                </td>
                <td class="text-center py-2 px-2" onclick="event.stopPropagation(); app.setCaptain('${p.id}');" title="Toggle Captain">
                    <button class="text-base font-bold ${isCap ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'} transition leading-none">${isCap ? '★' : '☆'}</button>
                </td>
                <td class="text-center py-2 px-2 text-slate-600">${p.age}</td>
                <td class="text-center py-2 px-2 font-bold ${p.potential === 'A' ? 'text-amber-600' : (p.potential === 'B' ? 'text-blue-600' : 'text-slate-500')}">${p.potential || '?'}</td>
                <td class="text-center py-2 px-2" title="${energy}% Stamina">
                    <div class="w-12 bg-slate-200 rounded-full h-1.5 mx-auto overflow-hidden">
                        <div class="${energyColor} h-full" style="width: ${energy}%"></div>
                    </div>
                </td>
                <td class="text-center py-2 px-2 font-bold text-blue-600">${p.attributes?.physical?.speed || 0}</td>
                <td class="text-center py-2 px-2 text-slate-700">${p.attributes?.physical?.strength || 0}</td>
                <td class="text-center py-2 px-2 text-slate-700">${p.attributes?.physical?.agility || 0}</td>
                <td class="text-center py-2 px-2 text-slate-700">${p.attributes?.mental?.playbookIQ || 0}</td>
                <td class="text-center py-2 px-2 text-slate-700">${p.attributes?.technical?.throwingAccuracy || 0}</td>
                <td class="text-center py-2 px-2 text-slate-700">${p.attributes?.technical?.catchingHands || 0}</td>
                <td class="text-center py-2 px-2 text-slate-700">${p.attributes?.technical?.blocking || 0}</td>
                <td class="text-center py-2 px-2 text-slate-700">${p.attributes?.technical?.tackling || 0}</td>
            </tr>`;
        });
    }
    elements.myTeamRoster.innerHTML = html + `</tbody></table></div>`;
}

window.app_autoResetLineup = function () {
    const gs = getGameState();
    if (!gs?.playerTeam) return;
    if (confirm("Reset lineup to optimal depth rankings? All manual slot locks will clear.")) {
        Game.autoResetLineup(gs.playerTeam);
        saveGameState();
        renderDepthChartTab(gs);
    }
};

function renderDepthChartTab(gameState) {
    const gs = getGameState();
    if (!gs?.playerTeam) return;

    renderFormationDropdown('offense', offenseFormations, gs.playerTeam.formations.offense);
    renderFormationDropdown('defense', defenseFormations, gs.playerTeam.formations.defense);
    renderDepthChartSide('offense', gs);
    renderDepthChartSide('defense', gs);
    renderPositionalOveralls();
}

function renderFormationDropdown(side, formationMap, selectedKey) {
    const select = document.getElementById(`${side}-formation-select`);
    if (!select) return;
    select.innerHTML = Object.entries(formationMap)
        .filter(([k]) => k !== 'Punt' && k !== 'Punt_Return')
        .map(([k, v]) => `<option value="${k}" ${k === selectedKey ? 'selected' : ''}>${v.name}</option>`)
        .join('');

    /*select.onchange = (e) => {
        const team = getGameState().playerTeam;
        team.formations[side] = e.target.value;
        rebuildDepthChartFromOrder(team);
        document.dispatchEvent(new CustomEvent('refresh-ui'));
    };*/

    // Add an inline Auto-Set button right next to the formation dropdown if not already present
    const parentContainer = select.parentElement;
    if (parentContainer && !parentContainer.querySelector('.auto-lineup-btn')) {
        const autoBtn = document.createElement('button');
        autoBtn.className = 'auto-lineup-btn ml-3 px-3 py-1.5 bg-slate-900 text-white rounded text-xs font-bold hover:bg-slate-800 transition shadow-sm uppercase tracking-wider';
        autoBtn.innerHTML = '⚡ Auto-Set Best';
        autoBtn.onclick = () => window.app_autoResetLineup();
        parentContainer.appendChild(autoBtn);
    }

    const formation = formationMap[selectedKey];
    const personnel = formation?.personnel || {};

    const personnelText = Object.entries(personnel)
        .filter(([_, count]) => count > 0)
        .map(([pos, count]) => `${count} ${pos}`)
        .join(' • ');

    let identityText = '';

    if (side === 'offense') {
        const labels = {
            Spread: 'Wide spacing • passing-friendly',
            Trips: 'Floods one side • stresses coverage',
            TripsLeft: 'Floods one side • stresses coverage',
            Empty: 'Maximum width • no RB protection',
            Power: 'Heavy set • downhill run threat',
            Jumbo: 'Heavy package • short-yardage power',
            Pistol: 'Balanced run/pass look',
            Wildcat: 'RB-led offense • QB as decoy',
            Balanced: 'Balanced personnel • flexible attack'
        };

        identityText = labels[selectedKey] || 'Flexible offensive package';
    } else {
        const labels = {
            '3-2-3': 'Balanced front • coverage flexibility',
            '2-3-3': 'Extra linebacker • stronger underneath',
            '4-2-2': 'Heavy front • designed to stop the run',
            '4-1-3': 'Extra DB • passing situations',
            '3-1-4': 'Hybrid defense • speed and flexibility',
            '3-0-5': 'Maximum coverage • vulnerable to the run'
        };

        identityText = labels[selectedKey] || 'Flexible defensive package';
    }

    const existingInfo = parentContainer.querySelector('.formation-info');
    if (existingInfo) existingInfo.remove();

    const info = document.createElement('div');
    info.className = 'formation-info mt-2 text-[10px] text-slate-500 leading-relaxed';

    info.innerHTML = `
    <div class="font-mono font-bold text-slate-700">
        ${personnelText || 'Personnel not specified'}
    </div>
    <div class="mt-0.5">
        ${identityText}
    </div>
`;

    parentContainer.appendChild(info);
}

function renderPositionalOveralls() {
    const pane = document.getElementById("positional-overalls-container");
    const gs = getGameState();
    if (!pane || !gs?.playerTeam) return;

    const team = gs.playerTeam;
    const roster = getUIRosterObjects(team);
    const depthOrder = team.depthOrder || {};
    const displayOrder = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'];

    // Map which starter slots players currently occupy
    const activeStarterMap = new Map();
    const offChart = team.depthChart?.offense || {};
    const defChart = team.depthChart?.defense || {};
    Object.entries(offChart).forEach(([slot, pId]) => { if (pId) activeStarterMap.set(pId, slot); });
    Object.entries(defChart).forEach(([slot, pId]) => { if (pId) activeStarterMap.set(pId, slot); });

    // Key attribute definitions per position for compact stat bars
    const keyAttrConfig = {
        QB: [
            { label: 'THR', get: p => p.attributes?.technical?.throwingAccuracy ?? 50 },
            { label: 'IQ', get: p => p.attributes?.mental?.playbookIQ ?? 50 },
            { label: 'SPD', get: p => p.attributes?.physical?.speed ?? 50 }
        ],
        RB: [
            { label: 'SPD', get: p => p.attributes?.physical?.speed ?? 50 },
            { label: 'AGI', get: p => p.attributes?.physical?.agility ?? 50 },
            { label: 'STR', get: p => p.attributes?.physical?.strength ?? 50 }
        ],
        WR: [
            { label: 'SPD', get: p => p.attributes?.physical?.speed ?? 50 },
            { label: 'HND', get: p => p.attributes?.technical?.catchingHands ?? 50 },
            { label: 'AGI', get: p => p.attributes?.physical?.agility ?? 50 }
        ],
        TE: [
            { label: 'HND', get: p => p.attributes?.technical?.catchingHands ?? 50 },
            { label: 'BLK', get: p => p.attributes?.technical?.blocking ?? 50 },
            { label: 'STR', get: p => p.attributes?.physical?.strength ?? 50 }
        ],
        OL: [
            { label: 'STR', get: p => p.attributes?.physical?.strength ?? 50 },
            { label: 'BLK', get: p => p.attributes?.technical?.blocking ?? 50 },
            { label: 'WGT', get: p => `${p.attributes?.physical?.weight ?? 200}#` }
        ],
        DL: [
            { label: 'STR', get: p => p.attributes?.physical?.strength ?? 50 },
            { label: 'BSH', get: p => p.attributes?.technical?.blockShedding ?? 50 },
            { label: 'TKL', get: p => p.attributes?.technical?.tackling ?? 50 }
        ],
        LB: [
            { label: 'TKL', get: p => p.attributes?.technical?.tackling ?? 50 },
            { label: 'IQ', get: p => p.attributes?.mental?.playbookIQ ?? 50 },
            { label: 'SPD', get: p => p.attributes?.physical?.speed ?? 50 }
        ],
        DB: [
            { label: 'SPD', get: p => p.attributes?.physical?.speed ?? 50 },
            { label: 'COV', get: p => (p.attributes?.technical?.coverage || p.attributes?.technical?.passCoverage) ?? 50 },
            { label: 'TKL', get: p => p.attributes?.technical?.tackling ?? 50 }
        ]
    };

    // Calculate group starter strength to give high-level strategic intelligence
    const groupInsights = displayOrder.map(pos => {
        const pIds = depthOrder[pos] || [];
        const topPlayer = pIds.length ? roster.find(p => p.id === pIds[0]) : null;
        const ovr = topPlayer ? calculateOverall(topPlayer, pos) : 0;
        return { pos, topOvr: ovr, topName: topPlayer ? topPlayer.name : 'None' };
    }).sort((a, b) => b.topOvr - a.topOvr);

    const strongestGroup = groupInsights[0];
    const weakestGroup = groupInsights[groupInsights.length - 1];

    let html = `
    <!-- Top Strategic Context Header -->
    <div class="mb-4 bg-slate-900 text-white rounded-sm p-3 border border-slate-700 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shrink-0">
        <div class="flex items-center gap-4 text-xs">
            <div>
                <span class="text-slate-400 uppercase text-[10px] font-bold tracking-wider block">Strongest Unit</span>
                <span class="font-black text-emerald-400 text-sm">${strongestGroup.pos} Room</span> 
                <span class="text-slate-300">(${strongestGroup.topName} • ${strongestGroup.topOvr} OVR)</span>
            </div>
            <div class="border-l border-slate-700 pl-4">
                <span class="text-slate-400 uppercase text-[10px] font-bold tracking-wider block">
                    Lowest-Rated Room
                </span>
                <span class="font-black text-amber-400 text-sm">
                    ${weakestGroup.pos} Room
                </span>
                <span class="text-slate-300">
                    (${weakestGroup.topName} • ${weakestGroup.topOvr} OVR)
                </span>
            </div>
        </div>
        <div class="text-[11px] text-slate-300 bg-slate-800/80 px-3 py-1.5 rounded border border-slate-700">
            <span class="text-slate-400 font-bold uppercase text-[9px] block">Active Schemes</span>
            Offense: <b class="text-white">${team.formations?.offense || 'Balanced'}</b> | Defense: <b class="text-white">${team.formations?.defense || '3-2-3'}</b>
        </div>
    </div>

    <!-- Positional Overall Grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 pb-6">`;

    displayOrder.forEach(pos => {
        const pIds = depthOrder[pos] || [];
        const players = pIds.map(id => roster.find(p => p && p.id === id)).filter(Boolean);
        const topOvr = players.length > 0 ? calculateOverall(players[0], pos) : 0;
        const attrsConfig = keyAttrConfig[pos] || [];

        html += `
        <div class="bg-white rounded-sm border border-slate-300 shadow-sm overflow-hidden flex flex-col">
            <div class="bg-slate-800 px-3 py-2 flex justify-between items-center text-white border-b border-slate-700">
                <div class="flex items-center gap-2">
                    <span class="font-black text-sm tracking-wider uppercase">${pos} DEPTH</span>
                    <span class="text-[10px] font-semibold text-slate-300 bg-slate-700 px-1.5 py-0.5 rounded">Starter: ${topOvr}</span>
                </div>
                <span class="text-[10px] font-bold bg-slate-700 px-2 py-0.5 rounded text-slate-200">${players.length} Players</span>
            </div>
            
            <div class="flex-1 overflow-y-auto max-h-80 p-1.5 space-y-1 divide-y divide-slate-100">
                ${players.map((p, i) => {
            const ovr = calculateOverall(p, pos);
            const natPos = p.pos || estimateBestPosition(p);
            const isOffPosition = natPos !== pos;
            const starterSlot = activeStarterMap.get(p.id);
            const isStarterHere = starterSlot && starterSlot.startsWith(pos);
            const isStarterElsewhere = starterSlot && !starterSlot.startsWith(pos);

            const statusAlert = p.status?.duration > 0
                ? `<span class="text-[9px] text-rose-600 font-bold ml-1" title="${p.status.description || 'Unavailable'}">🩹 ${p.status.duration}w</span>`
                : '';

            const energy = Math.round(100 - (p.fatigue || 0));
            const energyBadge = energy < 65
                ? `<span class="text-[8px] bg-amber-100 text-amber-800 px-1 rounded font-bold" title="Low Stamina">${energy}%</span>`
                : '';

            // Key stats preview row
            const statPills = attrsConfig.map(a =>
                `<span class="mr-1.5"><b class="text-slate-400 font-normal">${a.label}:</b> <span class="text-slate-700 font-semibold">${a.get(p)}</span></span>`
            ).join('');

            return `
                    <div class="p-1.5 rounded hover:bg-slate-50 transition cursor-pointer group flex items-center justify-between"
                         onclick="app.openPlayerCard('${p.id}')"
                         title="Click to view scouting dossier for ${p.name}">
                        
                        <div class="flex flex-col truncate pr-2 flex-1">
                            <div class="flex items-center gap-1.5 truncate">
                                <span class="font-mono text-xs font-bold text-slate-400 w-4">${i + 1}.</span>
                                <span class="font-bold text-xs text-slate-900 group-hover:text-amber-600 truncate">${p.name}</span>
                                ${statusAlert}
                                ${energyBadge}
                                ${isStarterHere ? `<span class="text-[8px] bg-emerald-100 text-emerald-800 font-black px-1 rounded uppercase tracking-tight border border-emerald-300">START • ${starterSlot}</span>` : ''}
                                ${isStarterElsewhere ? `<span class="text-[8px] bg-slate-100 text-slate-600 font-bold px-1 rounded uppercase tracking-tight" title="Starting at ${starterSlot}">• ${starterSlot}</span>` : ''}
                            </div>
                            
                            <!-- Micro-meta row: Age, Potential, Natural Pos, Key Stats -->
                            <div class="text-[10px] text-slate-500 flex items-center gap-2 mt-0.5 font-mono">
                                <span class="text-slate-400">${p.age}yo</span>
                                <span class="font-bold text-slate-600">Pot:${p.potential || '?'}</span>
                                ${isOffPosition ? `<span class="text-amber-700 bg-amber-50 px-1 rounded text-[9px] font-sans font-bold" title="Natural Position">NAT: ${natPos}</span>` : ''}
                                <span class="hidden sm:inline border-l border-slate-200 pl-1.5 text-[9px] text-slate-600 truncate">${statPills}</span>
                            </div>
                        </div>

                        <div class="text-right shrink-0">
                            <span class="font-black text-sm ${ovr >= 40 ? 'text-emerald-700' : (ovr >= 30 ? 'text-slate-900' : 'text-slate-400')}">${ovr}</span>
                            <span class="text-[9px] text-slate-400 block font-bold uppercase -mt-1 tracking-tighter">OVR</span>
                        </div>
                    </div>`;
        }).join('')}
                
                ${players.length === 0 ? `<div class="p-4 text-center text-xs text-slate-400 italic">No players available for this position.</div>` : ''}
            </div>
        </div>`;
    });

    html += `</div>`;
    pane.innerHTML = html;
}

function renderDepthChartSide(side, gameState) {
    const visualField = document.getElementById(`${side}-visual-field`);
    const benchTable = document.getElementById(`${side}-bench-table`);
    if (!visualField || !benchTable) return;

    const { depthChart, formations } = gameState.playerTeam;
    const roster = getUIRosterObjects(gameState.playerTeam);
    const currentChart = depthChart[side] || {};
    const otherSide = side === 'offense' ? 'defense' : 'offense';
    const otherChart = depthChart[otherSide] || {};

    const formKey = formations[side] || (side === 'offense' ? 'Balanced' : '3-2-3 Base');
    const formationData = (side === 'offense' ? offenseFormations : defenseFormations)[formKey];

    visualField.innerHTML = '';
    const losMarker = document.createElement('div');
    losMarker.className = 'absolute left-0 w-full h-1 bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)] z-0';
    losMarker.style.top = side === 'offense' ? '20%' : '80%';
    visualField.appendChild(losMarker);

    if (formationData?.slots) {
        formationData.slots.forEach(slotId => {
            const coords = formationData.coordinates?.[slotId];
            if (!coords) return;
            const [yardsX, yardsY] = coords;
            const leftPercent = 50 + (yardsX * 1.8);
            const topPercent = side === 'offense' ? 20 - (yardsY * 3.5) : 80 - (yardsY * 3.5);

            const slotEl = document.createElement('div');
            slotEl.style.left = `${leftPercent}%`;
            slotEl.style.top = `${topPercent}%`;
            slotEl.dataset.positionSlot = slotId;
            slotEl.dataset.side = side;

            const playerId = currentChart[slotId];
            const player = roster.find(p => p.id === playerId);
            let posKey = slotId.replace(/\d+/g, '');
            if (['OT', 'OG', 'C'].includes(posKey)) posKey = 'OL';
            if (['DE', 'DT', 'NT'].includes(posKey)) posKey = 'DL';
            if (['CB', 'S'].includes(posKey)) posKey = 'DB';

            const ovr = player ? calculateOverall(player, posKey) : '--';
            const shortName = player ? player.name.split(' ')[0] : 'EMPTY';
            const energy = player ? Math.max(0, Math.round(100 - (player.fatigue || 0))) : 100;
            const isUnavailable = player && player.status?.duration > 0;

            // Two-Way Check: Does this player also start on the other side?
            const otherSlot = player ? Object.entries(otherChart).find(([_, id]) => id === player.id)?.[0] : null;

            // Stamina ring border color
            let ringColor = 'border-slate-400';
            if (player) {
                if (energy >= 75) ringColor = 'border-emerald-400';
                else if (energy >= 50) ringColor = 'border-amber-400';
                else ringColor = 'border-rose-500 animate-pulse';
            }

            slotEl.className = 'absolute transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group z-10 cursor-pointer select-none';
            slotEl.innerHTML = `
                <!-- Slot Label Badge -->
                <span class="text-[8px] font-black tracking-wider uppercase px-1 rounded shadow-sm mb-0.5 ${side === 'offense' ? 'bg-blue-900 text-blue-200 border border-blue-700' : 'bg-red-900 text-red-200 border border-red-700'}">
                    ${slotId}
                </span>

                <!-- Avatar Circle with Stamina Halo -->
                <div class="relative w-11 h-11 rounded-full border-2 ${ringColor} shadow-xl flex flex-col items-center justify-center ${player ? 'bg-slate-900 text-white' : 'bg-slate-800/80 border-dashed border-slate-500 text-slate-400'}">
                    <span class="text-[8px] font-mono text-slate-400 leading-none">${posKey}</span>
                    <span class="text-sm font-black leading-none">${ovr}</span>
                    ${isUnavailable ? '<span class="absolute -top-1 -right-1 text-[10px]">🩹</span>' : ''}
                </div>

                <!-- Player Name Pill -->
                <div class="mt-0.5 bg-slate-950 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow text-center max-w-[75px] truncate border border-slate-700 group-hover:border-amber-400 transition-colors">
                    ${shortName}
                </div>

                <!-- Two-Way Ironman Badge -->
                ${otherSlot ? `
                    <span class="mt-0.5 text-[8px] font-black uppercase tracking-tight px-1 py-0.2 rounded shadow border ${side === 'offense' ? 'bg-rose-950 text-rose-300 border-rose-800' : 'bg-blue-950 text-blue-300 border-blue-800'}" title="Also starting at ${otherSlot} on ${otherSide}">
                        ⚡ ${otherSlot}
                    </span>
                ` : ''}
            `;
            slotEl.onclick = () => window.app_openSlotModal(side, slotId);
            visualField.appendChild(slotEl);
        });
    }

    // Build the Comprehensive Two-Way Deployment & Availability Command Table
    const offSlotsCount = Object.values(depthChart.offense || {}).filter(Boolean).length;
    const defSlotsCount = Object.values(depthChart.defense || {}).filter(Boolean).length;
    const ironmanCount = roster.filter(p => Object.values(depthChart.offense || {}).includes(p.id) && Object.values(depthChart.defense || {}).includes(p.id)).length;
    const injuredCount = roster.filter(p => p.status?.duration > 0).length;

    let tableHtml = `
    <!-- Top Telemetry Bar -->
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2 bg-slate-900 text-white p-2.5 rounded-sm border border-slate-800 text-xs shrink-0">
        <div class="flex items-center gap-3">
            <span class="font-bold text-[11px] uppercase tracking-wider text-slate-400">Roster Telemetry:</span>
            <span class="bg-blue-950 text-blue-300 border border-blue-800 px-2 py-0.5 rounded font-mono font-bold text-[10px]">🏈 Off: ${offSlotsCount}/8</span>
            <span class="bg-red-950 text-red-300 border border-red-800 px-2 py-0.5 rounded font-mono font-bold text-[10px]">🛡️ Def: ${defSlotsCount}/8</span>
            <span class="bg-amber-950 text-amber-300 border border-amber-800 px-2 py-0.5 rounded font-mono font-bold text-[10px]" title="Players starting both Offense and Defense">⚡ Ironmen: ${ironmanCount}</span>
            ${injuredCount > 0 ? `<span class="bg-rose-950 text-rose-300 border border-rose-800 px-2 py-0.5 rounded font-mono font-bold text-[10px]">🩹 Unavailable: ${injuredCount}</span>` : ''}
        </div>
        <div class="text-[10px] text-slate-400">
            Click any field position or player row to adjust assignments.
        </div>
    </div>

    <!-- Master Roster Deployment Table -->
    <div class="overflow-x-auto border border-slate-200 rounded-sm">
        <table class="min-w-full bg-white text-xs">
            <thead class="bg-slate-900 text-white uppercase tracking-wider text-[10px]">
                <tr>
                    <th class="py-2 px-3 text-left">Player</th>
                    <th class="py-2 px-2 text-center">Status</th>
                    <th class="py-2 px-2 text-center">Energy</th>
                    <th class="py-2 px-2 text-center text-blue-300">Offense Role</th>
                    <th class="py-2 px-2 text-center text-red-300">Defense Role</th>
                    <th class="py-2 px-2 text-center">Deployment</th>
                    <th class="py-2 px-2 text-center">Best OVR</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-mono text-[11px]">`;

    roster.forEach(p => {
        const offSlot = Object.entries(depthChart.offense || {}).find(([_, id]) => id === p.id)?.[0] || null;
        const defSlot = Object.entries(depthChart.defense || {}).find(([_, id]) => id === p.id)?.[0] || null;
        const isIronman = offSlot && defSlot;
        const energy = Math.max(0, Math.round(100 - (p.fatigue || 0)));
        const isUnavailable = p.status?.duration > 0;
        const bestPos = p.pos || estimateBestPosition(p);
        const bestOvr = calculateOverall(p, bestPos);

        let roleBadge = '<span class="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[9px] font-sans font-bold">🪑 Reserve</span>';
        if (isIronman) {
            roleBadge = '<span class="bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.5 rounded text-[9px] font-sans font-black tracking-tight" title="Starts both ways - higher fatigue burn">⚡ Ironman</span>';
        } else if (offSlot) {
            roleBadge = '<span class="bg-blue-100 text-blue-900 border border-blue-200 px-1.5 py-0.5 rounded text-[9px] font-sans font-bold">🏈 Off Only</span>';
        } else if (defSlot) {
            roleBadge = '<span class="bg-red-100 text-red-900 border border-red-200 px-1.5 py-0.5 rounded text-[9px] font-sans font-bold">🛡️ Def Only</span>';
        }

        const energyColor = energy >= 75 ? 'bg-emerald-500' : (energy >= 50 ? 'bg-amber-500' : 'bg-rose-500');

        tableHtml += `
            <tr class="hover:bg-slate-50 transition cursor-pointer ${isIronman ? 'bg-amber-50/40' : ''}" onclick="app.openPlayerCard('${p.id}')">
                <td class="py-2 px-3 font-sans font-semibold text-slate-900 truncate">
                    <span class="font-mono text-slate-400 text-[10px] mr-1">#${p.number || '--'}</span>
                    <span>${p.name}</span>
                    <span class="text-slate-400 text-[10px] ml-1 font-mono">(${p.age}yo)</span>
                </td>
                <td class="text-center py-2 px-2 font-sans">
                    ${isUnavailable ? `<span class="bg-rose-100 text-rose-800 px-1.5 py-0.5 rounded text-[9px] font-bold" title="${p.status.description}">🩹 Out ${p.status.duration}w</span>` : '<span class="text-emerald-700 text-[10px] font-bold">Active</span>'}
                </td>
                <td class="text-center py-2 px-2">
                    <div class="flex items-center justify-center gap-1.5">
                        <div class="w-12 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                            <div class="${energyColor} h-full" style="width: ${energy}%"></div>
                        </div>
                        <span class="text-[10px] text-slate-600 font-bold">${energy}%</span>
                    </div>
                </td>
                <td class="text-center py-2 px-2">
                    ${offSlot ? `<span class="bg-blue-50 text-blue-800 border border-blue-300 font-black px-1.5 py-0.5 rounded text-[10px]">${offSlot}</span>` : '<span class="text-slate-300">--</span>'}
                </td>
                <td class="text-center py-2 px-2">
                    ${defSlot ? `<span class="bg-red-50 text-red-800 border border-red-300 font-black px-1.5 py-0.5 rounded text-[10px]">${defSlot}</span>` : '<span class="text-slate-300">--</span>'}
                </td>
                <td class="text-center py-2 px-2">
                    ${roleBadge}
                </td>
                <td class="text-center py-2 px-2 font-black text-slate-800">
                    <span class="text-slate-400 text-[10px] mr-1">${bestPos}</span>${bestOvr}
                </td>
            </tr>`;
    });

    tableHtml += `</tbody></table></div>`;
    benchTable.innerHTML = tableHtml;
}

window.app_openSlotModal = function (side, slotId) {
    const gs = getGameState();
    if (!gs?.playerTeam) return;
    const roster = getUIRosterObjects(gs.playerTeam);
    const currentChart = gs.playerTeam.depthChart[side] || {};
    const otherSide = side === 'offense' ? 'defense' : 'offense';
    const otherChart = gs.playerTeam.depthChart[otherSide] || {};
    const currentId = currentChart[slotId];

    let posKey = slotId.replace(/\d+/g, '');
    if (['OT', 'OG', 'C'].includes(posKey)) posKey = 'OL';
    if (['DE', 'DT', 'NT'].includes(posKey)) posKey = 'DL';
    if (['CB', 'S'].includes(posKey)) posKey = 'DB';

    const candidates = roster.filter(p => p && (!Object.values(currentChart).includes(p.id) || p.id === currentId));
    candidates.sort((a, b) => calculateOverall(b, posKey) - calculateOverall(a, posKey));

    window.app_assignSlot = function (s, slot, pid) {
        assignPlayerToSlot(gs.playerTeam, pid, slot, s);
        saveGameState();
        renderDepthChartTab(gs);
        hideModal();
    };

    let modalHtml = `
    <div class="mb-3 p-2 bg-slate-100 rounded text-xs text-slate-600 flex justify-between items-center">
        <span>Target: <b class="text-slate-900">${side.toUpperCase()} ${slotId}</b> (${posKey})</span>
        <button class="px-2.5 py-1 bg-rose-100 text-rose-800 border border-rose-300 rounded font-bold hover:bg-rose-200 transition-colors" onclick="app_assignSlot('${side}', '${slotId}', '')">
            Clear Slot
        </button>
    </div>
    <div class="space-y-2 max-h-[60vh] overflow-y-auto pr-1 pb-2">
        ${candidates.map(p => {
        const slotOvr = calculateOverall(p, posKey);
        const energy = Math.max(0, Math.round(100 - (p.fatigue || 0)));
        const isUnavailable = p.status?.duration > 0;
        const otherSlot = Object.entries(otherChart).find(([_, id]) => id === p.id)?.[0] || null;
        const isCurrent = p.id === currentId;

        let borderClass = isCurrent ? 'bg-amber-50 border-amber-400' : 'bg-white border-slate-200 hover:border-slate-400';
        let energyColor = energy >= 75 ? 'text-emerald-600' : (energy >= 50 ? 'text-amber-600' : 'text-rose-600 font-bold');

        return `
            <button class="w-full text-left p-3 border rounded-sm shadow-sm flex justify-between items-center transition-all ${borderClass}" onclick="app_assignSlot('${side}', '${slotId}', '${p.id}')">
                <div class="flex flex-col truncate pr-2">
                    <div class="flex items-center gap-2">
                        <span class="font-bold text-slate-900 text-sm truncate">${p.name}</span>
                        ${isCurrent ? '<span class="text-[9px] bg-amber-200 text-amber-900 px-1 rounded font-bold uppercase">Current Starter</span>' : ''}
                        ${isUnavailable ? `<span class="text-[9px] bg-rose-100 text-rose-800 px-1 rounded font-bold">🩹 Out ${p.status.duration}w</span>` : ''}
                    </div>
                    <div class="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 mt-1 font-mono">
                        <span>Age: ${p.age}</span>
                        <span>•</span>
                        <span class="${energyColor}">⚡ ${energy}% Energy</span>
                        <span>•</span>
                        ${otherSlot
                ? `<span class="bg-amber-100 text-amber-800 border border-amber-300 px-1 rounded font-sans font-black text-[10px]" title="Already starting on ${otherSide}">⚡ Starts at ${otherSlot} (${otherSide.substring(0, 3)})</span>`
                : `<span class="text-slate-400 font-sans">🪑 Free on ${otherSide}</span>`}
                    </div>
                </div>
                <div class="text-right shrink-0">
                    <span class="text-xl font-black ${slotOvr >= 40 ? 'text-emerald-700' : (slotOvr >= 30 ? 'text-slate-900' : 'text-slate-500')}">${slotOvr}</span>
                    <span class="text-[9px] text-slate-400 uppercase font-bold block -mt-1">${posKey} OVR</span>
                </div>
            </button>`;
    }).join('')}
    </div>`;

    showModal(`Assign Slot: ${side.toUpperCase()} ${slotId}`, modalHtml);
};

export function renderScheduleTab(gameState) {
    if (!elements.scheduleList || !gameState?.schedule) return;
    const numTeams = gameState.teams?.length || 0;
    const gamesPerWeek = numTeams > 0 ? Math.floor(numTeams / 2) : 0;

    let html = '';
    for (let i = 0; i < 9; i++) {
        const weekGames = gameState.schedule.slice(i * gamesPerWeek, (i + 1) * gamesPerWeek);
        const isCurrent = i === gameState.currentWeek;

        const t1 = weekGames.filter(g => g.home.tier === 1);
        const t2 = weekGames.filter(g => g.home.tier === 2);
        const yth = weekGames.filter(g => g.home.leagueType === 'youth');

        const renderGames = (games, title, color) => {
            if (!games.length) return '';
            return `<div class="mb-3"><h5 class="text-[10px] font-bold uppercase text-${color}-600 mb-1 border-b border-${color}-100 pb-0.5">${title}</h5>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                ${games.map(g => `<div class="bg-white p-2 rounded border border-gray-200 shadow-sm flex justify-between items-center">
                    <span class="font-semibold text-gray-800">${g.away.name}</span><span class="text-gray-400 font-mono text-[10px]">@</span><span class="font-semibold text-gray-800">${g.home.name}</span>
                </div>`).join('')}
            </div></div>`;
        }

        html += `<div class="p-4 rounded-lg mb-4 ${isCurrent ? 'bg-amber-50 border-2 border-amber-500 shadow-sm' : 'bg-gray-50 border border-gray-200'}">
            <h4 class="font-bold text-lg mb-3 text-gray-800">Week ${i + 1}</h4>
            ${renderGames(t1, 'Premier Parks (Tier 1)', 'amber')}
            ${renderGames(t2, 'Sandlot Circuit (Tier 2)', 'blue')}
            ${renderGames(yth, 'Pee-Wee League (Youth)', 'green')}
        </div>`;
    }
    elements.scheduleList.innerHTML = html;
}

export function renderStandingsTab(gameState) {
    if (!elements.standingsContainer || !gameState) return;

    // League Tier Configurations
    const tierConfig = {
        tier1: {
            name: "Premier Parks (Tier 1)",
            subtitle: "The Elite Division",
            desc: "Playing under the floodlights. Champion takes the Neighborhood Trophy; bottom 2 teams are relegated to the Sandlot.",
            teams: gameState.teams.filter(t => t.tier === 1),
            badgeColor: "amber",
            hasRel: true,
            hasProm: false
        },
        tier2: {
            name: "Sandlot Circuit (Tier 2)",
            subtitle: "The Grassroots Battleground",
            desc: "Battles on dusty schoolyard fields. The top 2 finishers earn promotion to the Premier Parks under the big lights!",
            teams: gameState.teams.filter(t => t.tier === 2),
            badgeColor: "blue",
            hasRel: false,
            hasProm: true
        },
        youth: {
            name: "Pee-Wee League (Youth)",
            subtitle: "Future Prospects (Ages 8-11)",
            desc: "Playing for juice boxes and neighborhood bragging rights. Scouts watch graduating 12-year-olds for next year's Rookie Draft!",
            teams: gameState.teams.filter(t => t.leagueType === 'youth'),
            badgeColor: "emerald",
            hasRel: false,
            hasProm: false
        }
    };

    const activeTier = tierConfig[activeStandingsLeague] || tierConfig.tier1;
    const sortedTeams = [...activeTier.teams].sort((a, b) => {
        const winsDiff = (b.wins || 0) - (a.wins || 0);
        if (winsDiff !== 0) return winsDiff;
        return (a.losses || 0) - (b.losses || 0);
    });

    // 1. Find Standout Players in this specific league
    const leagueTeamIds = new Set(activeTier.teams.map(t => t.id));
    const leaguePlayers = (gameState.players || []).filter(p => leagueTeamIds.has(p.teamId));

    const hasPlayedGames = leaguePlayers.some(p =>
        (p.seasonStats?.passYards || 0) > 0 ||
        (p.seasonStats?.rushYards || 0) > 0 ||
        (p.seasonStats?.tackles || 0) > 0
    );

    let topPasser, topRusher, topDefender;
    let passerMetricLabel, rusherMetricLabel, defenderMetricLabel;

    if (hasPlayedGames) {
        topPasser = [...leaguePlayers].sort((a, b) => (b.seasonStats?.passYards || 0) - (a.seasonStats?.passYards || 0))[0];
        topRusher = [...leaguePlayers].sort((a, b) => (b.seasonStats?.rushYards || 0) - (a.seasonStats?.rushYards || 0))[0];
        topDefender = [...leaguePlayers].sort((a, b) => ((b.seasonStats?.tackles || 0) + (b.seasonStats?.sacks || 0) * 2) - ((a.seasonStats?.tackles || 0) + (a.seasonStats?.sacks || 0) * 2))[0];

        passerMetricLabel = `${topPasser?.seasonStats?.passYards || 0} YDS`;
        rusherMetricLabel = `${topRusher?.seasonStats?.rushYards || 0} YDS`;
        defenderMetricLabel = `${topDefender?.seasonStats?.tackles || 0} TKLS`;
    } else {
        // Preseason: Highlight the highest OVR QB, RB, and Defender
        const qbs = leaguePlayers.filter(p => estimateBestPosition(p) === 'QB').sort((a, b) => calculateOverall(b, 'QB') - calculateOverall(a, 'QB'));
        const rbs = leaguePlayers.filter(p => estimateBestPosition(p) === 'RB').sort((a, b) => calculateOverall(b, 'RB') - calculateOverall(a, 'RB'));
        const defs = leaguePlayers.filter(p => ['DL', 'LB', 'DB'].includes(estimateBestPosition(p))).sort((a, b) => calculateOverall(b, estimateBestPosition(b)) - calculateOverall(a, estimateBestPosition(a)));

        topPasser = qbs[0] || leaguePlayers[0];
        topRusher = rbs[0] || leaguePlayers[1];
        topDefender = defs[0] || leaguePlayers[2];

        passerMetricLabel = `${calculateOverall(topPasser, 'QB')} OVR`;
        rusherMetricLabel = `${calculateOverall(topRusher, 'RB')} OVR`;
        defenderMetricLabel = `${calculateOverall(topDefender, estimateBestPosition(topDefender))} OVR`;
    }

    // 2. Generate Dynamic Neighborhood Headline
    const leaderTeam = sortedTeams[0];
    let parkChatter = "Preseason buzz is building across the blacktop.";
    if (leaderTeam && (leaderTeam.wins || 0) > 0) {
        parkChatter = `🔥 <b>${leaderTeam.name}</b> are setting the pace in the ${activeTier.subtitle}, coached by <b>${leaderTeam.coach?.name || 'Coach'}</b>!`;
    } else if (leaderTeam) {
        parkChatter = `Every team in <b>${activeTier.name}</b> starts with a clean slate. Who will claim the playground throne?`;
    }

    // 3. Render HTML
    elements.standingsContainer.className = "p-4 overflow-y-auto flex-grow min-h-0 space-y-4";
    elements.standingsContainer.innerHTML = `
        <!-- Sub-Navigation Bar -->
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
            <div class="flex bg-slate-200 rounded p-1 border border-slate-300 text-xs font-bold">
                <button class="px-3 py-1.5 rounded transition ${activeStandingsLeague === 'tier1' ? 'bg-amber-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}" onclick="window.app_switchStandingsLeague('tier1')">
                    🏆 Premier (Tier 1)
                </button>
                <button class="px-3 py-1.5 rounded transition ${activeStandingsLeague === 'tier2' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}" onclick="window.app_switchStandingsLeague('tier2')">
                    🧢 Sandlot (Tier 2)
                </button>
                <button class="px-3 py-1.5 rounded transition ${activeStandingsLeague === 'youth' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}" onclick="window.app_switchStandingsLeague('youth')">
                    🧃 Pee-Wee (Youth)
                </button>
            </div>
            <div class="text-[11px] text-slate-500 font-mono">
                Week ${gameState.currentWeek < 9 ? gameState.currentWeek + 1 : 'Final'} of 9
            </div>
        </div>

        <!-- League Narrative Banner -->
        <div class="bg-slate-900 text-white rounded-sm p-4 border border-slate-800 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
            <div>
                <div class="flex items-center gap-2 mb-1">
                    <span class="text-xs font-black uppercase tracking-wider text-${activeTier.badgeColor}-400">${activeTier.subtitle}</span>
                    <span class="text-slate-600">•</span>
                    <span class="text-xs text-slate-300 font-bold">${activeTier.name}</span>
                </div>
                <p class="text-xs text-slate-300 leading-relaxed">${activeTier.desc}</p>
                <p class="text-[11px] text-amber-300 font-sans mt-2 bg-slate-800/80 px-2.5 py-1 rounded inline-block border border-slate-700">
                    ${parkChatter}
                </p>
            </div>
        </div>

        <!-- 2-Column Content Grid: Standings (Left) + Kings of the Park (Right) -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            
            <!-- Left: Rich Standings Table (8 cols) -->
            <div class="lg:col-span-8 bg-white rounded-sm border border-slate-300 overflow-hidden shadow-sm">
                <div class="bg-slate-800 text-white px-3 py-2 flex justify-between items-center text-xs font-black uppercase tracking-wider border-b border-slate-700">
                    <span>${activeTier.name} Standings</span>
                    <span class="text-[10px] text-slate-300 font-mono">${sortedTeams.length} Franchises</span>
                </div>
                <table class="min-w-full text-xs font-mono">
                    <thead class="bg-slate-100 text-slate-700 uppercase text-[10px] select-none">
                        <tr>
                            <th class="py-2 px-3 text-left">Team</th>
                            <th class="py-2 px-2 text-center">W</th>
                            <th class="py-2 px-2 text-center">L</th>
                            <th class="py-2 px-2 text-center">PCT</th>
                            <th class="py-2 px-2 text-center text-slate-800 font-sans">Power (OVR)</th>
                            <th class="py-2 px-2 text-center text-slate-800 font-sans">Cred</th>
                            <th class="py-2 px-3 text-right font-sans">Status</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                        ${sortedTeams.map((t, i) => {
        const isMe = t.id === gameState.playerTeam?.id;
        const total = (t.wins || 0) + (t.losses || 0);
        const pct = total > 0 ? ((t.wins || 0) / total).toFixed(3).replace(/^0+/, '') : '.000';
        const teamOvr = Game.getTeamOverall(t);

        let borderIndicator = '';
        let statusBadge = '<span class="text-slate-400 font-sans text-[10px]">-</span>';

        if (activeTier.hasProm && i < 2) {
            borderIndicator = 'border-l-4 border-emerald-500 bg-emerald-50/40';
            statusBadge = '<span class="text-[9px] bg-emerald-100 text-emerald-800 border border-emerald-300 px-1.5 py-0.5 rounded font-black font-sans">▲ PROMOTION</span>';
        } else if (activeTier.hasRel && i >= sortedTeams.length - 2) {
            borderIndicator = 'border-l-4 border-rose-500 bg-rose-50/40';
            statusBadge = '<span class="text-[9px] bg-rose-100 text-rose-800 border border-rose-300 px-1.5 py-0.5 rounded font-black font-sans">▼ RELEGATION</span>';
        } else if (i === 0) {
            statusBadge = '<span class="text-[9px] bg-amber-100 text-amber-800 border border-amber-300 px-1.5 py-0.5 rounded font-black font-sans">👑 #1 SEED</span>';
        }

        return `
                            <tr class="${borderIndicator} ${isMe ? 'bg-amber-50 font-bold' : 'hover:bg-slate-50 transition'}">
                                <td class="py-2 px-3 font-sans truncate flex items-center gap-2">
                                    <span class="w-4 font-mono text-[10px] text-slate-400">${i + 1}.</span>
                                    <span class="w-2.5 h-2.5 rounded-full shrink-0 border border-slate-300" style="background-color: ${t.primaryColor || '#333'}"></span>
                                    <span class="truncate ${isMe ? 'text-amber-900 font-black' : 'text-slate-900 font-semibold'}">${t.name}</span>
                                    ${isMe ? '<span class="bg-amber-200 text-amber-900 px-1 rounded text-[8px] font-black uppercase">YOU</span>' : ''}
                                </td>
                                <td class="py-2 px-2 text-center font-black ${t.wins > 0 ? 'text-slate-900' : 'text-slate-400'}">${t.wins || 0}</td>
                                <td class="py-2 px-2 text-center text-slate-500">${t.losses || 0}</td>
                                <td class="py-2 px-2 text-center font-bold text-slate-700">${pct}</td>
                                <td class="py-2 px-2 text-center font-bold text-slate-800">${teamOvr}</td>
                                <td class="py-2 px-2 text-center text-slate-600">${t.socialProfile?.streetCred || 50}</td>
                                <td class="py-2 px-3 text-right">${statusBadge}</td>
                            </tr>`;
    }).join('')}
                    </tbody>
                </table>
            </div>

            <!-- Right: Kings of the Park & Unit Spotlight (4 cols) -->
            <div class="lg:col-span-4 space-y-4">
                
                <!-- Kings of the Park (Top Performers in this Tier) -->
                <div class="bg-white rounded-sm border border-slate-300 p-3.5 shadow-sm">
                    <div class="flex justify-between items-center mb-2.5 border-b border-slate-200 pb-1.5">
                        <h4 class="font-bold text-xs uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                            <span>👑</span> Kings of the Park
                        </h4>
                        <span class="text-[9px] font-bold text-slate-400 uppercase tracking-widest">${activeTier.name.split(' ')[0]}</span>
                    </div>

                    <div class="space-y-2.5 text-xs">
                        <!-- Top Passer -->
                        <div class="p-2 bg-slate-50 rounded border border-slate-200 cursor-pointer hover:border-amber-400 transition" onclick="app.openPlayerCard('${topPasser?.id}')">
                            <span class="text-[9px] font-black uppercase text-blue-600 block mb-0.5">${hasPlayedGames ? 'Air General (Passing)' : '⭐ Preseason QB to Watch'}</span>
                            <div class="flex justify-between items-center">
                                <span class="font-bold text-slate-900 truncate">${topPasser?.name || 'No player'}</span>
                                <span class="font-mono font-bold text-slate-700">${passerMetricLabel}</span>
                            </div>
                            <span class="text-[10px] text-slate-500">${topPasser ? gameState.teams.find(t => t.id === topPasser.teamId)?.name : '-'}</span>
                        </div>

                        <!-- Top Rusher -->
                        <div class="p-2 bg-slate-50 rounded border border-slate-200 cursor-pointer hover:border-amber-400 transition" onclick="app.openPlayerCard('${topRusher?.id}')">
                            <span class="text-[9px] font-black uppercase text-amber-600 block mb-0.5">${hasPlayedGames ? 'Ground Enforcer (Rushing)' : '⭐ Preseason RB to Watch'}</span>
                            <div class="flex justify-between items-center">
                                <span class="font-bold text-slate-900 truncate">${topRusher?.name || 'No player'}</span>
                                <span class="font-mono font-bold text-slate-700">${rusherMetricLabel}</span>
                            </div>
                            <span class="text-[10px] text-slate-500">${topRusher ? gameState.teams.find(t => t.id === topRusher.teamId)?.name : '-'}</span>
                        </div>

                        <!-- Top Defender -->
                        <div class="p-2 bg-slate-50 rounded border border-slate-200 cursor-pointer hover:border-amber-400 transition" onclick="app.openPlayerCard('${topDefender?.id}')">
                            <span class="text-[9px] font-black uppercase text-rose-600 block mb-0.5">${hasPlayedGames ? 'Defensive Anchor (Tackles)' : '⭐ Preseason Defender to Watch'}</span>
                            <div class="flex justify-between items-center">
                                <span class="font-bold text-slate-900 truncate">${topDefender?.name || 'No player'}</span>
                                <span class="font-mono font-bold text-slate-700">${defenderMetricLabel}</span>
                            </div>
                            <span class="text-[10px] text-slate-500">${topDefender ? gameState.teams.find(t => t.id === topDefender.teamId)?.name : '-'}</span>
                        </div>
                    </div>
                </div>

                <!-- Division Lore Box -->
                <div class="bg-amber-50/70 border border-amber-200/80 rounded-sm p-3 text-xs text-slate-700">
                    <span class="font-bold uppercase tracking-wider text-[10px] text-amber-800 block mb-1">Playground Rulebook</span>
                    ${activeTier.hasRel
            ? `<p class="leading-relaxed">Teams finishing in the bottom 2 will drop down to Tier 2 next year, losing valuable playground Street Cred and fan turnout.</p>`
            : (activeTier.hasProm
                ? `<p class="leading-relaxed">The top 2 teams will earn direct promotion into Tier 1, earning +20 Street Cred and competing under the floodlights next season.</p>`
                : `<p class="leading-relaxed">Graduating 12-year-olds from this league enter the Rookie Draft pool. Older kids move on to Tier 1 and Tier 2 squads.</p>`)}
                </div>

            </div>
        </div>
    `;
}

export function renderPlayerStatsTab(gameState) {
    if (!elements.playerStatsContainer || !gameState?.players) return;

    // Before Week 1 games are played, clean any stale stats and show kickoff state
    if (gameState.currentWeek === 0) {
        gameState.players.forEach(p => {
            if (p.seasonStats && (p.seasonStats.touchdowns > 0 || p.seasonStats.passYards > 0 || p.seasonStats.rushYards > 0)) {
                p.seasonStats = { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0, sacks: 0, interceptions: 0, passAttempts: 0, passCompletions: 0, interceptionsThrown: 0 };
            }
        });
        elements.playerStatsContainer.innerHTML = `
            <div class="p-8 text-center text-slate-400 font-sans">
                <span class="text-3xl block mb-2">🏈</span>
                <p class="font-bold text-sm text-slate-700 uppercase tracking-wider">Season ${gameState.year || 1} Has Not Started</p>
                <p class="text-xs text-slate-500 mt-1">League leaders will update after Week 1 kickoff.</p>
            </div>`;
        return;
    }

    const teamIdFilter = elements.statsFilterTeam?.value || '';
    const leagueFilter = document.getElementById('stats-filter-league')?.value || '';
    const sortStat = elements.statsSort?.value || 'touchdowns';

    let players = gameState.players.filter(p => {
        if (teamIdFilter && p.teamId !== teamIdFilter) return false;
        if (leagueFilter) {
            const team = gameState.teams.find(t => t.id === p.teamId);
            if (!team) return false;
            if (leagueFilter === 'tier1' && team.tier !== 1) return false;
            if (leagueFilter === 'tier2' && team.tier !== 2) return false;
            if (leagueFilter === 'youth' && team.leagueType !== 'youth') return false;
        }
        return p.teamId; // Only show players currently on a team
    });
    players.sort((a, b) => ((b.seasonStats?.[sortStat]) || 0) - ((a.seasonStats?.[sortStat]) || 0));
    players = players.slice(0, 50);

    elements.playerStatsContainer.innerHTML = `
        <table class="min-w-full bg-white text-xs"><thead class="bg-gray-800 text-white"><tr>
            <th class="py-2 px-3 text-left">Name</th>
            <th class="py-2 px-3 text-center">PASS YDS</th>
            <th class="py-2 px-3 text-center">RUSH YDS</th>
            <th class="py-2 px-3 text-center">REC YDS</th>
            <th class="py-2 px-3 text-center">TDS</th>
            <th class="py-2 px-3 text-center">TKLS</th>
        </tr></thead><tbody class="divide-y">
            ${players.map(p => `<tr class="hover:bg-gray-50 cursor-pointer" onclick="app.openPlayerCard('${p.id}')">
                <td class="py-1.5 px-3 font-semibold text-gray-800">${p.name}</td>
                <td class="py-1.5 px-3 text-center">${p.seasonStats?.passYards || 0}</td>
                <td class="py-1.5 px-3 text-center">${p.seasonStats?.rushYards || 0}</td>
                <td class="py-1.5 px-3 text-center">${p.seasonStats?.recYards || 0}</td>
                <td class="py-1.5 px-3 text-center font-bold text-amber-600">${p.seasonStats?.touchdowns || 0}</td>
                <td class="py-1.5 px-3 text-center">${p.seasonStats?.tackles || 0}</td>
            </tr>`).join('')}
        </tbody></table>`;
}

export function renderHallOfFameTab(gameState) {
    if (!elements.hallOfFameList) return;
    if (!gameState?.hallOfFame?.length) {
        elements.hallOfFameList.innerHTML = `<p class="text-gray-400 text-sm text-center py-12">Hall of Fame is empty.</p>`;
        return;
    }
    elements.hallOfFameList.innerHTML = gameState.hallOfFame.map(p => `
        <div class="bg-white p-3 rounded-lg border border-amber-200 shadow-sm mb-2">
            <h4 class="font-bold text-amber-800">${p.name}</h4>
            <p class="text-xs text-gray-600">Total TDs: ${p.careerStats?.touchdowns || 0}</p>
        </div>
    `).join('');
}

export function renderHistoryTab(gameState) {
    const container = document.getElementById('history-container');
    if (!container) return;

    if (!gameState?.history?.seasons || gameState.history.seasons.length === 0) {
        container.innerHTML = `<p class="text-slate-400 text-center py-12">No history available yet.</p>`;
        return;
    }

    // Render Record Book
    let recordsHtml = '';
    if (gameState.records) {
        const formatRec = (rec, isCareer) => rec && rec.val > 0 ? `<span class="font-black text-slate-900">${rec.val}</span> <span class="text-slate-600">by ${rec.holder} ${isCareer ? '' : `(Yr ${rec.year})`}</span>` : '<span class="text-slate-400">None</span>';
        const r = gameState.records;

        recordsHtml = `
        <div class="bg-white rounded-sm border border-amber-300 shadow-sm overflow-hidden mb-6">
            <div class="bg-gradient-to-r from-amber-600 to-amber-500 text-white px-4 py-2">
                <h4 class="font-black text-base uppercase tracking-wider">🏆 All-Time Record Book</h4>
            </div>
            <div class="p-4 grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
                <div>
                    <h5 class="font-bold text-slate-400 uppercase text-[10px] tracking-widest border-b border-slate-100 pb-1 mb-2">Single Game</h5>
                    <ul class="space-y-1">
                        <li><span class="font-semibold text-slate-700 w-16 inline-block">Pass Yds:</span> ${formatRec(r.game.passYards, false)}</li>
                        <li><span class="font-semibold text-slate-700 w-16 inline-block">Rush Yds:</span> ${formatRec(r.game.rushYards, false)}</li>
                        <li><span class="font-semibold text-slate-700 w-16 inline-block">Rec Yds:</span> ${formatRec(r.game.recYards, false)}</li>
                        <li><span class="font-semibold text-slate-700 w-16 inline-block">TDs:</span> ${formatRec(r.game.touchdowns, false)}</li>
                        <li><span class="font-semibold text-slate-700 w-16 inline-block">Tackles:</span> ${formatRec(r.game.tackles, false)}</li>
                    </ul>
                </div>
                <div>
                    <h5 class="font-bold text-slate-400 uppercase text-[10px] tracking-widest border-b border-slate-100 pb-1 mb-2">Single Season</h5>
                    <ul class="space-y-1">
                        <li><span class="font-semibold text-slate-700 w-16 inline-block">Pass Yds:</span> ${formatRec(r.season.passYards, false)}</li>
                        <li><span class="font-semibold text-slate-700 w-16 inline-block">Rush Yds:</span> ${formatRec(r.season.rushYards, false)}</li>
                        <li><span class="font-semibold text-slate-700 w-16 inline-block">Rec Yds:</span> ${formatRec(r.season.recYards, false)}</li>
                        <li><span class="font-semibold text-slate-700 w-16 inline-block">TDs:</span> ${formatRec(r.season.touchdowns, false)}</li>
                        <li><span class="font-semibold text-slate-700 w-16 inline-block">Tackles:</span> ${formatRec(r.season.tackles, false)}</li>
                    </ul>
                </div>
                <div>
                    <h5 class="font-bold text-slate-400 uppercase text-[10px] tracking-widest border-b border-slate-100 pb-1 mb-2">Career</h5>
                    <ul class="space-y-1">
                        <li><span class="font-semibold text-slate-700 w-16 inline-block">Pass Yds:</span> ${formatRec(r.career.passYards, true)}</li>
                        <li><span class="font-semibold text-slate-700 w-16 inline-block">Rush Yds:</span> ${formatRec(r.career.rushYards, true)}</li>
                        <li><span class="font-semibold text-slate-700 w-16 inline-block">Rec Yds:</span> ${formatRec(r.career.recYards, true)}</li>
                        <li><span class="font-semibold text-slate-700 w-16 inline-block">TDs:</span> ${formatRec(r.career.touchdowns, true)}</li>
                        <li><span class="font-semibold text-slate-700 w-16 inline-block">Tackles:</span> ${formatRec(r.career.tackles, true)}</li>
                    </ul>
                </div>
            </div>
        </div>`;
    }

    // Filter out duplicates if any exist by year
    const seenYears = new Set();
    const uniqueSeasons = [];
    for (const s of [...gameState.history.seasons].reverse()) {
        if (!seenYears.has(s.year)) {
            seenYears.add(s.year);
            uniqueSeasons.push(s);
        }
    }

    let html = '<div class="space-y-4 pb-6">' + recordsHtml;
    uniqueSeasons.forEach(season => {
        const topPicks = (season.draftResults || []).slice(0, 3).map(p => `<strong>1.${p.pick}</strong> ${p.playerName} <span class="text-slate-500">(${p.teamName})</span>`).join('<br>');
        const l = season.leaders || {};

        html += `
        <div class="bg-white rounded-sm border border-slate-300 shadow-sm overflow-hidden">
            <div class="bg-slate-900 text-white px-4 py-2 flex justify-between items-center">
                <h4 class="font-black text-base uppercase tracking-wider">Season ${season.year}</h4>
                <span class="text-xs text-amber-400 font-bold uppercase tracking-wider">🏆 Champion: ${season.champion}</span>
            </div>
            <div class="p-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <!-- Column 1: Trophies & Movement -->
                <div class="space-y-2 border-r border-slate-100 pr-2">
                    <p><span class="font-bold text-slate-400 uppercase text-[10px] tracking-wider block">Premier Champion:</span> <span class="text-amber-600 font-black text-sm">${season.champion}</span></p>
                    <p><span class="font-bold text-slate-400 uppercase text-[10px] tracking-wider block">Runner-Up:</span> <span class="text-slate-800 font-semibold">${season.runnerUp}</span></p>
                    <p><span class="font-bold text-slate-400 uppercase text-[10px] tracking-wider block">Sandlot Champ (Tier 2):</span> <span class="text-blue-600 font-semibold">${season.tier2Champion || 'Unknown'}</span></p>
                    <p><span class="font-bold text-slate-400 uppercase text-[10px] tracking-wider block">Pee-Wee Champ:</span> <span class="text-green-600 font-semibold">${season.youthChampion || 'Unknown'}</span></p>
                    
                    <div class="pt-2 border-t border-slate-100 flex gap-4">
                        <div>
                            <span class="font-bold text-emerald-700 uppercase text-[10px] tracking-wider block">Promoted</span>
                            <p class="text-slate-700">${season.promoted?.join('<br>') || 'None'}</p>
                        </div>
                        <div>
                            <span class="font-bold text-rose-700 uppercase text-[10px] tracking-wider block">Relegated</span>
                            <p class="text-slate-700">${season.relegated?.join('<br>') || 'None'}</p>
                        </div>
                    </div>
                </div>

                <!-- Column 2: Statistical Leaders -->
                <div class="space-y-2 border-r border-slate-100 pr-2">
                    <span class="font-bold text-slate-400 uppercase text-[10px] tracking-wider block mb-1">League Leaders</span>
                    <p><span class="text-slate-500 font-semibold">Passing:</span> <br><b class="text-slate-900">${l.passer || 'None'}</b></p>
                    <p><span class="text-slate-500 font-semibold">Rushing:</span> <br><b class="text-slate-900">${l.rusher || 'None'}</b></p>
                    <p><span class="text-slate-500 font-semibold">Tackles:</span> <br><b class="text-slate-900">${l.tackler || 'None'}</b></p>
                </div>

                <!-- Column 3: Top Draft Picks -->
                <div class="bg-slate-50 p-3 rounded-sm border border-slate-200">
                    <p class="font-bold text-slate-400 uppercase text-[10px] tracking-wider mb-2">Rookie Draft Highlights</p>
                    <p class="text-slate-700 leading-relaxed">${topPicks || 'No draft data recorded.'}</p>
                </div>
            </div>
        </div>`;
    });
    html += '</div>';
    container.innerHTML = html;
}

export function renderMessagesTab(gameState) {
    if (!elements.messagesList) return;
    if (!gameState?.messages?.length) {
        elements.messagesList.innerHTML = `<p class="text-gray-400 text-sm text-center py-12">No messages.</p>`;
        return;
    }
    elements.messagesList.innerHTML = gameState.messages.map(msg => `
        <div class="message-item ${msg.isRead ? 'bg-white' : 'bg-blue-50 border-l-4 border-blue-500 font-semibold'} p-3 rounded shadow-sm cursor-pointer hover:bg-gray-50 transition mb-2" data-message-id="${msg.id}">
            <span class="text-sm text-gray-800">${msg.subject}</span>
        </div>
    `).join('');
}

export function updateMessagesNotification(messages) {
    if (!elements.messagesNotificationDot) return;
    const hasUnread = messages?.some(m => !m.isRead);
    elements.messagesNotificationDot.classList.toggle('hidden', !hasUnread);
}

export function renderOffseasonScreen(report, year) {
    if (elements.offseasonYear) elements.offseasonYear.textContent = year;

    // 1. Player Development List
    const devContainer = elements.playerDevelopmentContainer;
    if (devContainer) {
        if (report?.developmentResults && report.developmentResults.length > 0) {
            devContainer.innerHTML = report.developmentResults.map(r => `
                <div class="p-2.5 bg-white rounded border border-green-200 text-xs mb-1 shadow-sm">
                    <span class="font-bold text-gray-900">${r.player.name} (${r.player.age}yo)</span>
                    <div class="text-green-700 font-semibold mt-1">
                        ${r.improvements.map(i => `<span class="bg-green-50 px-1.5 py-0.5 rounded border border-green-200 mr-1">${i.attr} +${i.increase}</span>`).join('') || '<span class="text-gray-400">No gains</span>'}
                    </div>
                </div>
            `).join('');
        } else {
            devContainer.innerHTML = '<p class="text-gray-400 italic text-xs p-2">No player improvements this year.</p>';
        }
    }

    // 2. Retirements List
    if (elements.retirementsList) {
        elements.retirementsList.innerHTML = (report?.retiredPlayers || []).map(p =>
            `<li class="flex items-center gap-2"><span>👴</span><span><b>${p.name}</b> (Age ${p.age}) hung up his cleats.</span></li>`
        ).join('') || '<li class="text-gray-400 italic text-xs">No retirements this season.</li>';
    }

    // 3. Departures List
    if (elements.leavingPlayersList) {
        elements.leavingPlayersList.innerHTML = (report?.leavingPlayers || []).map(p =>
            `<li class="flex items-center gap-2"><span>🏃</span><span><b>${p.player?.name || p.name}</b>: ${p.reason}</span></li>`
        ).join('') || '<li class="text-gray-400 italic text-xs">No player departures.</li>';
    }

    // 4. Hall of Fame List
    if (elements.hofInducteesList) {
        elements.hofInducteesList.innerHTML = (report?.hofInductees || []).map(p =>
            `<li class="flex items-center gap-2"><span>🏆</span><span><b>${p.name}</b> (${p.careerStats?.touchdowns || 0} Career TDs)</span></li>`
        ).join('') || '<li class="text-amber-800/60 italic text-xs">No new Hall of Fame inductees.</li>';
    }
}

export function setupDragAndDrop(onDrop) { }

export function setupDepthChartTabs() {
    const subTabs = document.querySelectorAll(".depth-chart-tab");
    subTabs.forEach(tab => {
        tab.addEventListener("click", () => {
            const subTab = tab.dataset.subTab;
            subTabs.forEach(t => {
                if (t.dataset.subTab === subTab) {
                    t.classList.add("active", "text-amber-600", "border-amber-500");
                } else {
                    t.classList.remove("active", "text-amber-600", "border-amber-500");
                }
            });

            const offensePane = document.getElementById("depth-chart-offense-pane");
            const defensePane = document.getElementById("depth-chart-defense-pane");
            const overallsPane = document.getElementById("positional-overalls-container");
            const depthOrderPane = document.getElementById("depth-order-container");
            const playbookPane = document.getElementById("playbook-manager-container");
            const practicePane = document.getElementById("practice-manager-container");

            if (offensePane) offensePane.classList.toggle("hidden", subTab !== "offense");
            if (defensePane) defensePane.classList.toggle("hidden", subTab !== "defense");
            if (overallsPane) overallsPane.classList.toggle("hidden", subTab !== "overalls");
            if (depthOrderPane) depthOrderPane.classList.toggle("hidden", subTab !== "depth-order");
            if (playbookPane) playbookPane.classList.toggle("hidden", subTab !== "playbook");
            if (practicePane) practicePane.classList.toggle("hidden", subTab !== "practice");

            if (subTab === "overalls") renderPositionalOveralls();
            if (subTab === "depth-order") renderDepthOrderPane(getGameState());
            if (subTab === "playbook") renderPlaybookManager(getGameState());
            if (subTab === "practice") renderPracticeManager(getGameState());
        });
    });
}

export function renderPlaybookManager(gameState) {
    const container = document.getElementById('playbook-manager-container');
    if (!container || !gameState?.playerTeam) return;

    const team = gameState.playerTeam;
    if (!team.gameplan) {
        team.gameplan = {
            installedOffense: ['Uni_StretchRight', 'Uni_Stick', 'Uni_Drive', 'Uni_HB_Screen', 'PA_Crossers', 'Uni_Mesh'],
            installedDefense: ['Cover_3_Sky', 'Man_Blitz_Base', 'Nickel_Tampa_2', 'Fire_Zone_3'],
            mastery: {}
        };
    }

    const BASICS_OFF = ['Uni_InsideZone', 'Uni_QuickSlants', 'Uni_FourVerts'];
    const BASICS_DEF = ['Cover_2_Zone_Base', 'Cover_1_Robber', 'GoalLine_RunStuff'];

    window.app_toggleInstallPlay = (key, side) => {
        const list = side === 'offense' ? team.gameplan.installedOffense : team.gameplan.installedDefense;
        const max = side === 'offense' ? 6 : 4;
        const idx = list.indexOf(key);

        if (idx > -1) {
            list.splice(idx, 1);
        } else {
            if (list.length >= max) {
                // Helpful feedback: Tell the player how to make room
                showModal("Playbook Full", `
                    <div class="text-xs text-slate-700 space-y-2">
                        <p>Your cafeteria napkin has all <b>${max} ${side}</b> slots filled.</p>
                        <p class="text-slate-500 italic">Click <b>"Uninstall"</b> on any active play above to free up space before installing a new one.</p>
                    </div>
                `);
                return;
            }
            list.push(key);
            if (!team.gameplan.mastery[key]) team.gameplan.mastery[key] = 35;
        }
        renderPlaybookManager(gameState);
        saveGameState();
    };

    const offAvailable = Object.entries(offensivePlaybook || {}).filter(([k]) => k !== 'Punt_Punt' && !BASICS_OFF.includes(k));
    const defAvailable = Object.entries(defensivePlaybook || {}).filter(([k]) => k !== 'PuntReturn_Classic' && !BASICS_DEF.includes(k));

    container.innerHTML = `
        <div class="space-y-4 text-xs font-sans pb-6">
            <!-- Strategic Header -->
            <div class="bg-slate-900 text-white p-3.5 rounded flex justify-between items-center shadow-sm">
                <div>
                    <h4 class="font-black text-sm uppercase tracking-wider text-amber-400">Cafeteria Napkin Playbook (Active Gameplan)</h4>
                    <p class="text-slate-400 text-[11px] mt-0.5">Kids only call installed plays. Unpracticed plays hesitate; mastered plays explode with muscle memory.</p>
                </div>
                <div class="text-right font-mono text-[11px]">
                    <span class="bg-blue-900 text-blue-200 px-2 py-0.5 rounded border border-blue-700">Offense: ${team.gameplan.installedOffense.length}/6</span>
                    <span class="bg-red-900 text-red-200 px-2 py-0.5 rounded border border-red-700 ml-1">Defense: ${team.gameplan.installedDefense.length}/4</span>
                </div>
            </div>

            <!-- OFFENSIVE SECTION -->
            <div class="bg-white border border-slate-300 rounded p-3 shadow-sm space-y-3">
                <div class="flex justify-between items-center border-b pb-1">
                    <h5 class="font-black uppercase tracking-wider text-blue-950">Active Offensive Napkin (${team.gameplan.installedOffense.length}/6 Installed)</h5>
                    <span class="text-[10px] text-slate-500 font-mono">3 Basics + 6 Napkin Plays</span>
                </div>

                <!-- Installed + Basics Grid -->
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    ${[...BASICS_OFF, ...team.gameplan.installedOffense].map(key => {
                        const play = offensivePlaybook[key] || { tags: ['run'] };
                        const isBasic = BASICS_OFF.includes(key);
                        const mastery = team.gameplan.mastery[key] || (isBasic ? 85 : 40);
                        let barColor = mastery >= 75 ? 'bg-emerald-500' : (mastery >= 50 ? 'bg-amber-500' : 'bg-rose-500');

                        return `
                        <div class="p-2.5 rounded border border-blue-300 bg-blue-50/50 flex flex-col justify-between shadow-sm">
                            <div>
                                <div class="flex justify-between items-start">
                                    <span class="font-bold text-slate-900 truncate">${key.replace('Uni_', '').replace('PA_', 'PA ')}</span>
                                    <span class="text-[9px] font-black uppercase px-1 rounded ${isBasic ? 'bg-slate-200 text-slate-700' : 'bg-blue-700 text-white'}">
                                        ${isBasic ? 'Safety Net' : 'Installed'}
                                    </span>
                                </div>
                                <div class="mt-1 flex items-center justify-between text-[10px] text-slate-600 font-mono">
                                    <span>Mastery: <b>${mastery}%</b></span>
                                    <div class="w-16 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                                        <div class="${barColor} h-full" style="width: ${mastery}%"></div>
                                    </div>
                                </div>
                            </div>
                            <div class="mt-2 pt-1 border-t border-blue-200 flex justify-end">
                                ${isBasic ? '<span class="text-[9px] text-slate-400 italic">Always Active</span>' : `
                                <button class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-rose-100 text-rose-800 hover:bg-rose-200 border border-rose-300 transition" onclick="app_toggleInstallPlay('${key}', 'offense')">
                                    Uninstall
                                </button>`}
                            </div>
                        </div>`;
                    }).join('')}
                </div>

                <!-- Available Offense Library -->
                <div class="pt-2 border-t">
                    <span class="font-bold text-[10px] uppercase text-slate-500 block mb-1.5">Available Offense Library (Click to Install)</span>
                    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1.5">
                        ${offAvailable.map(([key, play]) => {
                            const isInstalled = team.gameplan.installedOffense.includes(key);
                            if (isInstalled) return '';
                            const mastery = team.gameplan.mastery[key] || 35;
                            return `
                            <div class="p-2 rounded border border-slate-200 bg-slate-50 hover:bg-white flex justify-between items-center transition">
                                <div class="truncate pr-1">
                                    <span class="font-semibold text-slate-800 truncate block text-[11px]">${key.replace('Uni_', '').replace('PA_', 'PA ')}</span>
                                    <span class="text-[9px] text-slate-400 font-mono">${mastery}% Mst</span>
                                </div>
                                <button class="shrink-0 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-900 text-white hover:bg-slate-800 transition shadow-sm" onclick="app_toggleInstallPlay('${key}', 'offense')">
                                    Install
                                </button>
                            </div>`;
                        }).join('')}
                    </div>
                </div>
            </div>

            <!-- DEFENSIVE SECTION -->
            <div class="bg-white border border-slate-300 rounded p-3 shadow-sm space-y-3">
                <div class="flex justify-between items-center border-b pb-1">
                    <h5 class="font-black uppercase tracking-wider text-red-950">Active Defensive Gameplan (${team.gameplan.installedDefense.length}/4 Installed)</h5>
                    <span class="text-[10px] text-slate-500 font-mono">3 Basics + 4 Napkin Schemes</span>
                </div>

                <!-- Installed + Basics Grid -->
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    ${[...BASICS_DEF, ...team.gameplan.installedDefense].map(key => {
                        const play = defensivePlaybook[key] || { name: key };
                        const isBasic = BASICS_DEF.includes(key);
                        const mastery = team.gameplan.mastery[key] || (isBasic ? 85 : 40);
                        let barColor = mastery >= 75 ? 'bg-emerald-500' : (mastery >= 50 ? 'bg-amber-500' : 'bg-rose-500');

                        return `
                        <div class="p-2.5 rounded border border-red-300 bg-red-50/50 flex flex-col justify-between shadow-sm">
                            <div>
                                <div class="flex justify-between items-start">
                                    <span class="font-bold text-slate-900 truncate">${play.name || key}</span>
                                    <span class="text-[9px] font-black uppercase px-1 rounded ${isBasic ? 'bg-slate-200 text-slate-700' : 'bg-red-700 text-white'}">
                                        ${isBasic ? 'Safety Net' : 'Installed'}
                                    </span>
                                </div>
                                <div class="mt-1 flex items-center justify-between text-[10px] text-slate-600 font-mono">
                                    <span>Mastery: <b>${mastery}%</b></span>
                                    <div class="w-16 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                                        <div class="${barColor} h-full" style="width: ${mastery}%"></div>
                                    </div>
                                </div>
                            </div>
                            <div class="mt-2 pt-1 border-t border-red-200 flex justify-end">
                                ${isBasic ? '<span class="text-[9px] text-slate-400 italic">Always Active</span>' : `
                                <button class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-rose-100 text-rose-800 hover:bg-rose-200 border border-rose-300 transition" onclick="app_toggleInstallPlay('${key}', 'defense')">
                                    Uninstall
                                </button>`}
                            </div>
                        </div>`;
                    }).join('')}
                </div>

                <!-- Available Defense Library -->
                <div class="pt-2 border-t">
                    <span class="font-bold text-[10px] uppercase text-slate-500 block mb-1.5">Available Defense Library (Click to Install)</span>
                    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1.5">
                        ${defAvailable.map(([key, play]) => {
                            const isInstalled = team.gameplan.installedDefense.includes(key);
                            if (isInstalled) return '';
                            const mastery = team.gameplan.mastery[key] || 35;
                            return `
                            <div class="p-2 rounded border border-slate-200 bg-slate-50 hover:bg-white flex justify-between items-center transition">
                                <div class="truncate pr-1">
                                    <span class="font-semibold text-slate-800 truncate block text-[11px]">${play.name || key}</span>
                                    <span class="text-[9px] text-slate-400 font-mono">${mastery}% Mst</span>
                                </div>
                                <button class="shrink-0 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-900 text-white hover:bg-slate-800 transition shadow-sm" onclick="app_toggleInstallPlay('${key}', 'defense')">
                                    Install
                                </button>
                            </div>`;
                        }).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;
}

export function renderPracticeManager(gameState) {
    const container = document.getElementById('practice-manager-container');
    if (!container || !gameState?.playerTeam) return;

    const team = gameState.playerTeam;
    if (!team.gameplan) {
        team.gameplan = {
            weeklyPractice: 'chalk_talk',
            installedOffense: [],
            installedDefense: [],
            mastery: {},
            delegatePractice: false,
            delegateGameplan: false,
            gmDirective: 'COACH_AUTONOMY'
        };
    }

    const coach = team.staff?.coach;
    const isDelegated = !!team.gameplan.delegatePractice;
    const directive = team.gameplan.gmDirective || 'COACH_AUTONOMY';
    const currentPlan = team.gameplan.weeklyPractice || 'chalk_talk';

    window.app_setPracticePlan = (plan) => {
        if (team.gameplan.delegatePractice) return;
        team.gameplan.weeklyPractice = plan;
        saveGameState();
        renderPracticeManager(gameState);
    };

    window.app_togglePracticeDelegation = (checked) => {
        team.gameplan.delegatePractice = checked;
        if (checked) {
            import('./game/staff.js').then(s => {
                team.gameplan.weeklyPractice = s.aiChooseWeeklyPractice(team, null, team.gameplan.gmDirective);
                saveGameState();
                renderPracticeManager(gameState);
            }).catch(() => {});
        } else {
            saveGameState();
            renderPracticeManager(gameState);
        }
    };

    window.app_setGmDirective = (newDirective) => {
        team.gameplan.gmDirective = newDirective;
        if (team.gameplan.delegatePractice) {
            import('./game/staff.js').then(s => {
                team.gameplan.weeklyPractice = s.aiChooseWeeklyPractice(team, null, newDirective);
                saveGameState();
                renderPracticeManager(gameState);
            }).catch(() => {});
        } else {
            saveGameState();
            renderPracticeManager(gameState);
        }
    };

    const plans = [
        { key: 'chalk_talk', title: '📋 Cafeteria Napkins & Walk-Throughs', badge: 'Playbook Mastery', desc: 'Focus on route timing and assignment mastery (+15% familiarity gain on active plays). Young prospects gain Playbook IQ reps.' },
        { key: 'conditioning', title: '🏃 Tire Pits & Sideline Tree Runs', badge: 'Conditioning', desc: 'Punishing physical conditioning. Increases player Stamina and Toughness; builds fourth-quarter closing endurance.' },
        { key: 'scrimmage', title: '🧃 Two-Hand Touch & Freeze Pops', badge: 'Morale & Skills', desc: 'Light sandlot scrimmage followed by team freeze-pops. Accelerates recovery, builds chemistry, and sharpens catching/tackling hands.' },
        { key: 'scouting', title: '🕵️ Spying on the Opponent at Recess', badge: 'Anti-Exploit Prep', desc: 'Watch your upcoming opponent practice to decode their go-to formation. Gives your defense a speed-reaction bonus on game day.' }
    ];

    container.innerHTML = `
        <div class="space-y-4 text-xs font-sans">
            <!-- Header & Front-Office Delegation Bar -->
            <div class="bg-slate-900 text-white p-3.5 rounded flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
                <div>
                    <h4 class="font-black text-sm uppercase tracking-wider text-emerald-400">After-School Sandlot Practice Schedule</h4>
                    <p class="text-slate-400 text-[11px] mt-0.5">Set weekly focus or delegate to Coach ${coach?.name || 'Coach'} according to your organizational directive.</p>
                </div>
                <div class="flex items-center gap-3 bg-slate-800 p-2 rounded border border-slate-700">
                    <label class="flex items-center gap-2 cursor-pointer text-[11px] font-bold text-amber-400">
                        <input type="checkbox" ${isDelegated ? 'checked' : ''} onchange="app_togglePracticeDelegation(this.checked)" class="rounded text-amber-500">
                        <span>Delegate to Head Coach</span>
                    </label>
                </div>
            </div>

            <!-- GM Directives Policy Card -->
            <div class="bg-white border border-slate-200 rounded p-3 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                <div>
                    <span class="font-black uppercase text-[10px] tracking-wider text-slate-500 block">General Manager Directive to Staff</span>
                    <p class="text-[11px] text-slate-700">How Coach ${coach?.name || 'Coach'} prioritizes drills when managing autonomously.</p>
                </div>
                <select class="p-1.5 border border-slate-300 rounded font-bold text-slate-800 text-xs bg-slate-50 outline-none" onchange="app_setGmDirective(this.value)">
                    <option value="COACH_AUTONOMY" ${directive === 'COACH_AUTONOMY' ? 'selected' : ''}>Full Coach Autonomy (Follows Coach's Biases)</option>
                    <option value="WIN_NOW" ${directive === 'WIN_NOW' ? 'selected' : ''}>Win-Now (Prioritizes Recess Opponent Prep)</option>
                    <option value="DEVELOP_YOUTH" ${directive === 'DEVELOP_YOUTH' ? 'selected' : ''}>Youth Development (Chalk Talks & Playbook IQ)</option>
                    <option value="HARD_CONDITIONING" ${directive === 'HARD_CONDITIONING' ? 'selected' : ''}>Physical Grit (Tire Runs & Fourth-Quarter Stamina)</option>
                </select>
            </div>

            ${isDelegated ? `
            <div class="p-3 bg-amber-50 border border-amber-300 rounded text-amber-950 flex items-center justify-between">
                <div>
                    <span class="font-black text-xs uppercase block">🤖 Coach's Decision: ${plans.find(p => p.key === currentPlan)?.title}</span>
                    <p class="text-[11px] text-amber-800 italic mt-0.5">"Running ${plans.find(p => p.key === currentPlan)?.badge} drills aligned with our directive. Discipline: ${coach?.ratings?.practiceDiscipline || 50}/100."</p>
                </div>
                <span class="text-[10px] bg-amber-200 text-amber-900 font-mono font-bold px-2 py-1 rounded">AUTOMATED</span>
            </div>` : ''}

            <!-- Practice Options Grid -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                ${plans.map(p => {
                    const isSelected = p.key === currentPlan;
                    const disabledClass = isDelegated ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:border-slate-300';
                    return `
                    <div class="p-3.5 rounded border ${isSelected ? 'border-emerald-500 bg-emerald-50/50 shadow-sm' : 'border-slate-200 bg-white'} ${disabledClass} flex flex-col justify-between transition" onclick="app_setPracticePlan('${p.key}')">
                        <div>
                            <div class="flex justify-between items-start mb-1">
                                <h5 class="font-black text-sm text-slate-900">${p.title}</h5>
                                <span class="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${isSelected ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}">${p.badge}</span>
                            </div>
                            <p class="text-slate-600 text-[11px] leading-relaxed mt-1">${p.desc}</p>
                        </div>
                        <div class="mt-3 pt-2 border-t border-slate-100 flex justify-between items-center">
                            <span class="text-[10px] font-bold ${isSelected ? 'text-emerald-700' : 'text-slate-400'}">${isSelected ? '✓ Active Plan' : (isDelegated ? 'Controlled by Coach' : 'Click to select')}</span>
                            <input type="radio" name="practice_choice" ${isSelected ? 'checked' : ''} ${isDelegated ? 'disabled' : ''} class="text-emerald-600">
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>
    `;
}

export function setupFormationListeners() {
    const offSelect = document.getElementById('offense-formation-select');
    const defSelect = document.getElementById('defense-formation-select');

    if (offSelect) {
        offSelect.onchange = (e) => {
            const team = getGameState()?.playerTeam;
            if (team) {
                team.formations.offense = e.target.value;
                rebuildDepthChartFromOrder(team);
                saveGameState();
                document.dispatchEvent(new CustomEvent('refresh-ui'));
            }
        };
    }

    if (defSelect) {
        defSelect.onchange = (e) => {
            const team = getGameState()?.playerTeam;
            if (team) {
                team.formations.defense = e.target.value;
                rebuildDepthChartFromOrder(team);
                saveGameState();
                document.dispatchEvent(new CustomEvent('refresh-ui'));
            }
        };
    }
}

export function renderPickHistory(gameState) {
    const list = document.getElementById('draft-history-list');
    if (!list) return;
    const history = gameState.pickHistory || [];
    list.innerHTML = history.slice().reverse().map(p => `
        <div class="flex items-center justify-between p-2 bg-white rounded border border-gray-200 text-xs mb-1">
            <span class="font-bold">#${p.pick} ${p.playerName} (${p.pos})</span>
            <span class="text-gray-500">${p.teamName}</span>
        </div>
    `).join('') || '<p class="text-gray-400 text-center py-8 text-xs">No picks yet.</p>';
}

export function renderDraftTeamView(gameState) {
    const selector = document.getElementById('draft-team-selector');
    const rosterDiv = document.getElementById('draft-team-roster');
    if (!selector || !rosterDiv) return;

    if (selector.options.length === 0) {
        gameState.teams.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id; opt.textContent = t.name;
            selector.appendChild(opt);
        });
        selector.onchange = () => renderDraftTeamView(gameState);
    }
    const team = gameState.teams.find(t => t.id === selector.value);
    const roster = getUIRosterObjects(team);
    rosterDiv.innerHTML = roster.map(p => `
        <div class="flex justify-between py-1 border-b text-xs">
            <span>${p.name}</span><span class="text-gray-500">${estimateBestPosition(p)} (${calculateOverall(p, estimateBestPosition(p))})</span>
        </div>
    `).join('');
}

export function startLiveGameLoop(initialGameState, onComplete) {
    activeLiveGame = initialGameState;
    currentLiveGameResult = { homeTeam: activeLiveGame.homeTeam, awayTeam: activeLiveGame.awayTeam };
    liveGameCallback = onComplete;
    isSkipping = false;
    isPaused = false;
    liveGameCurrentIndex = 0;

    if (elements.simPlayLog) elements.simPlayLog.innerHTML = '';
    updateLiveScoreboard();
    runLiveGameStep();
}

function updateLiveScoreboard() {
    if (!activeLiveGame) return;
    if (elements.simHomeTeam && activeLiveGame.homeTeam) elements.simHomeTeam.textContent = activeLiveGame.homeTeam.name;
    if (elements.simAwayTeam && activeLiveGame.awayTeam) elements.simAwayTeam.textContent = activeLiveGame.awayTeam.name;
    if (elements.simHomeScore) elements.simHomeScore.textContent = activeLiveGame.homeScore;
    if (elements.simAwayScore) elements.simAwayScore.textContent = activeLiveGame.awayScore;
    if (elements.simPossession && activeLiveGame.possession) {
        elements.simPossession.textContent = `🏈 ${activeLiveGame.possession.name}`;
    }
    if (elements.simGameDown) elements.simGameDown.textContent = `${activeLiveGame.down} & ${activeLiveGame.yardsToGo}`;
    if (elements.simGameDrive) elements.simGameDrive.textContent = `Q${activeLiveGame.quarter || 1} | ${formatGameClock(activeLiveGame.clock)}`;

    // Dynamically show which team is on Offense / Defense
    if (elements.simBannerOffense && elements.simBannerDefense && activeLiveGame.possession) {
        const isHomeOffense = activeLiveGame.possession.id === activeLiveGame.homeTeam?.id;
        elements.simBannerOffense.textContent = isHomeOffense ? "OFFENSE" : "DEFENSE";
        elements.simBannerOffense.className = `mt-1 ${isHomeOffense ? 'bg-blue-900/80 text-blue-200 border-blue-700' : 'bg-red-900/80 text-red-200 border-red-700'} text-[10px] px-2 py-0.5 rounded border font-bold uppercase tracking-tight truncate max-w-[140px]`;

        elements.simBannerDefense.textContent = isHomeOffense ? "DEFENSE" : "OFFENSE";
        elements.simBannerDefense.className = `mt-1 ${isHomeOffense ? 'bg-red-900/80 text-red-200 border-red-700' : 'bg-blue-900/80 text-blue-200 border-blue-700'} text-[10px] px-2 py-0.5 rounded border font-bold uppercase tracking-tight truncate max-w-[140px]`;
    }
}

function runLiveGameStep() {
    if (!activeLiveGame) return;
    if (activeLiveGame.isGameOver) {
        finishLiveGame();
        return;
    }

    updateLiveScoreboard();
    renderLiveBoxScore(activeLiveGame);
    let stepResult = Game.simulateLivePlayStep(activeLiveGame);

    if (stepResult.visualizationFrames?.length > 0) {
        playVisualization(stepResult.visualizationFrames, () => {
            flushLiveLogs();
            updateLiveScoreboard();
            if (isSkipping) runLiveGameStep();
            else setTimeout(runLiveGameStep, isPaused ? 100 : 1200);
        });
    } else {
        setTimeout(runLiveGameStep, 400);
    }
}

export function renderLiveFieldLineup(frameData, gameState) {
    const container = document.getElementById('sim-field-players');
    if (!container || !frameData?.players || !gameState?.playerTeam) return;

    const myTeamId = gameState.playerTeam.id;
    const myPlayers = frameData.players.filter(p => p.teamId === myTeamId);

    if (myPlayers.length === 0) return;

    let html = `
        <div class="p-2.5 bg-slate-900 border-b border-slate-800 text-[10px] uppercase font-bold text-slate-400 flex justify-between items-center">
            <span>On-Field Unit (${myPlayers.length}/8)</span>
            <span class="${myPlayers[0]?.isOffense ? 'text-blue-400' : 'text-rose-400'}">
                ${myPlayers[0]?.isOffense ? '🏈 OFFENSE' : '🛡️ DEFENSE'}
            </span>
        </div>
        <div class="divide-y divide-slate-800/60 overflow-y-auto">
    `;

    myPlayers.forEach(p => {
        const fullPlayer = getPlayer(p.id);
        const energy = Math.max(0, Math.round(100 - (fullPlayer?.fatigue || 0)));
        const energyColor = energy >= 75 ? 'bg-emerald-500' : (energy >= 50 ? 'bg-amber-500' : 'bg-rose-500');

        let actionText = p.action || 'idle';
        actionText = actionText.replace(/_/g, ' ');

        html += `
            <div class="p-2 hover:bg-slate-800/40 transition-colors flex items-center justify-between text-xs">
                <div class="flex items-center gap-2 truncate pr-2">
                    <span class="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${p.isOffense ? 'bg-blue-950 text-blue-300 border border-blue-800' : 'bg-rose-950 text-rose-300 border border-rose-800'}">
                        ${p.slot || 'P'}
                    </span>
                    <div class="flex flex-col truncate">
                        <span class="font-bold text-slate-200 truncate">${fullPlayer?.name || 'Player'}</span>
                        <span class="text-[9px] text-slate-400 capitalize truncate">${actionText}</span>
                    </div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    <div class="w-10 bg-slate-800 rounded-full h-1.5 overflow-hidden">
                        <div class="${energyColor} h-full" style="width: ${energy}%"></div>
                    </div>
                    <span class="text-[9px] font-mono text-slate-400 w-6 text-right">${energy}%</span>
                </div>
            </div>
        `;
    });

    html += `</div>`;
    container.innerHTML = html;
}

function flushLiveLogs() {
    if (!activeLiveGame?.gameLog) return;
    const fullLog = activeLiveGame.gameLog;
    if (fullLog.length > liveGameCurrentIndex) {
        const newEntries = fullLog.slice(liveGameCurrentIndex);
        newEntries.forEach(entry => {
            const p = document.createElement('p');
            p.className = "text-xs border-b border-gray-800 pb-1 mb-1 text-gray-300";
            p.textContent = entry;
            elements.simPlayLog?.appendChild(p);

            // Update the new "Last Play" ticker at the top of the field
            const ticker = document.getElementById('sim-last-play-ticker');
            if (ticker) {
                // Strip the [Tick X] bracket out of the string for a cleaner read
                ticker.textContent = entry.replace(/\[Tick \d+\] /, '');
            }
        });
        if (elements.simPlayLog) elements.simPlayLog.scrollTop = elements.simPlayLog.scrollHeight;
        liveGameCurrentIndex = fullLog.length;
    }
}

function playVisualization(frames, onComplete) {
    let index = 0;
    const runNext = () => {
        if (isPaused) {
            setTimeout(runNext, 100);
            return;
        }
        if (isSkipping) {
            const lastFrame = frames[frames.length - 1];
            if (lastFrame && elements.fieldCanvas && elements.fieldCanvasCtx) {
                drawFieldVisualization(elements.fieldCanvas, elements.fieldCanvasCtx, lastFrame);
            }
            if (onComplete) onComplete();
            return;
        }
        const frame = frames[index];
        if (frame && elements.fieldCanvas && elements.fieldCanvasCtx) {
            drawFieldVisualization(elements.fieldCanvas, elements.fieldCanvasCtx, frame);
            if (activeLiveGame) renderLiveFieldLineup(frame, getGameState());
        }
        index++;
        if (index >= frames.length) {
            if (onComplete) onComplete();
            return;
        }
        setTimeout(runNext, liveGameSpeed);
    };
    runNext();
}

export function renderLiveBoxScore(activeGame) {
    const awayContainer = document.getElementById('sim-stats-away');
    const homeContainer = document.getElementById('sim-stats-home');
    if (!awayContainer || !homeContainer || !activeGame) return;

    const renderTeamStats = (team, container) => {
        const players = getUIRosterObjects(team);
        const passers = players.filter(p => (p.gameStats?.passAttempts || 0) > 0);
        const rushers = players.filter(p => (p.gameStats?.rushAttempts || 0) > 0);
        const receivers = players.filter(p => (p.gameStats?.receptions || 0) > 0 || (p.gameStats?.targets || 0) > 0);
        const tacklers = players.filter(p => (p.gameStats?.tackles || 0) > 0 || (p.gameStats?.sacks || 0) > 0);

        let html = `
            <div class="font-black text-xs uppercase tracking-wider mb-2 text-slate-200 border-b border-slate-700 pb-1">
                ${team.name} Stats
            </div>
            <div class="space-y-3 text-[11px] font-mono">
        `;

        if (passers.length > 0) {
            html += `<div><span class="text-slate-400 font-sans font-bold text-[10px] uppercase block">Passing</span>`;
            passers.forEach(p => {
                html += `<div class="flex justify-between"><span>${p.name.split(' ')[0]}</span><span>${p.gameStats.passCompletions}/${p.gameStats.passAttempts}, ${p.gameStats.passYards}y, ${p.gameStats.touchdowns || 0}TD</span></div>`;
            });
            html += `</div>`;
        }

        if (rushers.length > 0) {
            html += `<div><span class="text-slate-400 font-sans font-bold text-[10px] uppercase block">Rushing</span>`;
            rushers.forEach(p => {
                html += `<div class="flex justify-between"><span>${p.name.split(' ')[0]}</span><span>${p.gameStats.rushAttempts} car, ${p.gameStats.rushYards}y</span></div>`;
            });
            html += `</div>`;
        }

        if (receivers.length > 0) {
            html += `<div><span class="text-slate-400 font-sans font-bold text-[10px] uppercase block">Receiving</span>`;
            receivers.forEach(p => {
                html += `<div class="flex justify-between"><span>${p.name.split(' ')[0]}</span><span>${p.gameStats.receptions} rec, ${p.gameStats.recYards}y</span></div>`;
            });
            html += `</div>`;
        }

        if (tacklers.length > 0) {
            html += `<div><span class="text-slate-400 font-sans font-bold text-[10px] uppercase block">Defense</span>`;
            tacklers.forEach(p => {
                html += `<div class="flex justify-between"><span>${p.name.split(' ')[0]}</span><span>${p.gameStats.tackles || 0} tkl, ${p.gameStats.sacks || 0} sck</span></div>`;
            });
            html += `</div>`;
        }

        html += `</div>`;
        container.innerHTML = html;
    };

    renderTeamStats(activeGame.awayTeam, awayContainer);
    renderTeamStats(activeGame.homeTeam, homeContainer);
}

function finishLiveGame() {
    if (liveGameCallback && activeLiveGame) {
        const res = activeLiveGame;
        activeLiveGame = null;
        liveGameCallback(res);
    }
}

export function skipLiveGameSim() { isSkipping = true; isPaused = false; }
export function togglePause() { isPaused = !isPaused; return isPaused; }
export function setSimSpeed(speed) { liveGameSpeed = speed; isPaused = false; }
