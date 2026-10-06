import * as Game from './game.js';
import {
    saveGameState, getRelationshipLevel, getScoutedPlayerInfo, getGameState,
    getRosterObjects, getPlayer, rebuildDepthChartFromOrder, assignPlayerToSlot
} from './game.js';
import { offenseFormations, defenseFormations, relationshipLevels } from './data.js';
import { positionOverallWeights, estimateBestPosition, calculateOverall } from './game/player.js';
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
            'draft-screen': getEl('draft-screen'),
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
    const setupTabGroup = (btn1, btn2, pane1, pane2, colorClass) => {
        if (!btn1 || !btn2 || !pane1 || !pane2) return;
        const activate = (activeBtn, inactiveBtn, activePane, inactivePane) => {
            activeBtn.className = `flex-1 py-2.5 text-xs font-bold text-white bg-gray-900 border-t-2 border-${colorClass} transition-colors`;
            inactiveBtn.className = `flex-1 py-2.5 text-xs font-bold text-gray-400 hover:text-white border-t-2 border-transparent bg-gray-800 transition-colors`;
            activePane.classList.remove('hidden');
            inactivePane.classList.add('hidden');
        };
        btn1.addEventListener('click', () => activate(btn1, btn2, pane1, pane2));
        btn2.addEventListener('click', () => activate(btn2, btn1, pane2, pane1));
    };

    setupTabGroup(
        document.getElementById('tab-btn-subs'), document.getElementById('tab-btn-strategy'),
        document.getElementById('pane-subs'), document.getElementById('pane-strategy'),
        'amber-500'
    );
    setupTabGroup(
        document.getElementById('tab-btn-log'), document.getElementById('tab-btn-stats'),
        document.getElementById('pane-log'), document.getElementById('pane-stats'),
        'blue-500'
    );
}

export function showScreen(screenId) {
    if (!elements?.screens) return;
    Object.values(elements.screens).forEach(screen => {
        if (screen?.classList) screen.classList.add('hidden');
    });
    const target = elements.screens[screenId] || document.getElementById(screenId);
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

    if (currentPick >= draftOrder.length) {
        if (elements.draftHeader) elements.draftHeader.innerHTML = `<h2 class="text-3xl font-bold">Season ${year} Draft Complete</h2>`;
        if (elements.draftPlayerBtn) { elements.draftPlayerBtn.disabled = true; elements.draftPlayerBtn.textContent = 'Draft Complete'; }
        renderSelectedPlayerCard(null, gameState);
        updateSelectedPlayerRow(null);
        if (elements.draftPoolTbody) elements.draftPoolTbody.innerHTML = `<tr><td colspan="18" class="p-4 text-center text-gray-500">Draft Complete.</td></tr>`;
        return;
    }

    const pickingTeam = draftOrder[currentPick];
    if (!pickingTeam) return;

    const currentRosterSize = pickingTeam.roster?.length || 0;
    const playerCanPick = pickingTeam.id === playerTeam.id && currentRosterSize < ROSTER_LIMIT;

    if (elements.draftYear) elements.draftYear.textContent = year;
    if (elements.draftPickNumber) elements.draftPickNumber.textContent = `#${currentPick + 1} (${currentRosterSize}/${ROSTER_LIMIT})`;
    if (elements.draftPickingTeam) elements.draftPickingTeam.textContent = pickingTeam.name || 'Unknown Team';

    renderDraftPool(gameState, onPlayerSelect, sortColumn, sortDirection);
    renderPlayerRoster(gameState.playerTeam);
    updateDraftSortIndicators(sortColumn, sortDirection);

    if (currentSelectedId) {
        const playerObj = gameState.players.find(p => p.id === currentSelectedId);
        if (playerObj) renderSelectedPlayerCard(playerObj, gameState);
    }

    if (elements.draftPlayerBtn) {
        elements.draftPlayerBtn.disabled = !playerCanPick || currentSelectedId === null;
        elements.draftPlayerBtn.textContent = playerCanPick ? 'Draft Player' : `Waiting for ${pickingTeam.name || 'AI'}...`;
    }
}

export function renderDraftPool(gameState, onPlayerSelect, sortColumn = 'potential', sortDirection = 'desc') {
    if (!elements.draftPoolTbody || !gameState?.players) return;
    const playerRoster = getUIRosterObjects(gameState.playerTeam);
    const undraftedPlayers = gameState.players.filter(p => p && !p.teamId && (p.personality?.entersDraft !== false));
    const searchTerm = elements.draftSearch?.value.toLowerCase() || '';
    const posFilter = elements.draftFilterPos?.value || '';

    let filtered = undraftedPlayers.filter(p =>
        p.name.toLowerCase().includes(searchTerm) &&
        (!posFilter || p.favoriteOffensivePosition === posFilter || p.favoriteDefensivePosition === posFilter)
    );

    const potentialOrder = { 'A': 5, 'B': 4, 'C': 3, 'D': 2, 'F': 1 };
    filtered.sort((a, b) => {
        if (sortColumn === 'potential') {
            const valA = potentialOrder[a?.potential] || 0;
            const valB = potentialOrder[b?.potential] || 0;
            if (valA !== valB) return sortDirection === 'asc' ? valA - valB : valB - valA;
            return calculateOverall(b, estimateBestPosition(b)) - calculateOverall(a, estimateBestPosition(a));
        }
        if (sortColumn === 'name') return sortDirection === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
        if (sortColumn === 'age') return sortDirection === 'asc' ? a.age - b.age : b.age - a.age;

        const getAttr = (p) => {
            const cats = ['physical', 'mental', 'technical'];
            for (const c of cats) if (p.attributes?.[c]?.[sortColumn] !== undefined) return p.attributes[c][sortColumn];
            return 0;
        };
        const valA = getAttr(a);
        const valB = getAttr(b);
        return sortDirection === 'asc' ? valA - valB : valB - valA;
    });

    elements.draftPoolTbody.innerHTML = '';
    if (filtered.length === 0) {
        elements.draftPoolTbody.innerHTML = `<tr><td colspan="18" class="p-4 text-center text-gray-500">No players match filters.</td></tr>`;
        return;
    }

    filtered.forEach(player => {
        const maxLevel = playerRoster.reduce(
            (max, rp) => Math.max(max, getRelationshipLevel(rp.id, player.id)),
            relationshipLevels.STRANGER.level
        );
        const scouted = getScoutedPlayerInfo(player, maxLevel);
        if (!scouted) return;
        const relInfo = Object.values(relationshipLevels).find(rl => rl.level === maxLevel) || relationshipLevels.STRANGER;

        const row = document.createElement('tr');
        row.className = `cursor-pointer hover:bg-amber-100 draft-player-row ${scouted.id === selectedPlayerId ? 'bg-amber-200' : ''}`;
        row.dataset.playerId = scouted.id;
        row.innerHTML = `
            <td class="py-2 px-3 font-semibold">${scouted.name ?? 'N/A'}</td>
            <td class="text-center py-2 px-3">${scouted.age ?? '?'}</td>
            <td class="text-center py-2 px-3 font-medium">${scouted.potential ?? '?'}</td>
            <td class="text-center py-2 px-3 ${relInfo.color}" title="${relInfo.name}">${relInfo.name.substring(0, 4)}</td>
            <td class="text-center py-2 px-3 font-bold">${estimateBestPosition(scouted)}</td>
            <td class="text-center py-2 px-3">${formatHeight(scouted.attributes?.physical?.height)}</td>
            <td class="text-center py-2 px-3">${scouted.attributes?.physical?.weight ?? '?'}</td>
            <td class="text-center py-2 px-3 text-blue-600 font-bold">${scouted.attributes?.physical?.speed ?? '?'}</td>
            <td class="text-center py-2 px-3">${scouted.attributes?.physical?.strength ?? '?'}</td>
            <td class="text-center py-2 px-3">${scouted.attributes?.physical?.agility ?? '?'}</td>
            <td class="text-center py-2 px-3">${scouted.attributes?.physical?.stamina ?? '?'}</td>
            <td class="text-center py-2 px-3">${scouted.attributes?.mental?.playbookIQ ?? '?'}</td>
            <td class="text-center py-2 px-3">${scouted.attributes?.mental?.toughness ?? '?'}</td>
            <td class="text-center py-2 px-3">${scouted.attributes?.technical?.throwingAccuracy ?? '?'}</td>
            <td class="text-center py-2 px-3">${scouted.attributes?.technical?.catchingHands ?? '?'}</td>
            <td class="text-center py-2 px-3">${scouted.attributes?.technical?.blocking ?? '?'}</td>
            <td class="text-center py-2 px-3">${scouted.attributes?.technical?.tackling ?? '?'}</td>
            <td class="text-center py-2 px-3">${scouted.attributes?.technical?.blockShedding ?? '?'}</td>
        `;
        row.onclick = () => onPlayerSelect(scouted.id);
        elements.draftPoolTbody.appendChild(row);
    });
}

export function updateDraftSortIndicators(sortColumn, sortDirection) {
    document.querySelectorAll('#draft-screen thead th .sort-indicator').forEach(s => s.textContent = '');
    const headerCell = document.querySelector(`#draft-screen thead th[data-sort="${sortColumn}"] .sort-indicator`);
    if (headerCell) headerCell.textContent = sortDirection === 'desc' ? ' ▼' : ' ▲';
}

export const debouncedRenderDraftPool = debounce(renderDraftPool, 300);

export function updateSelectedPlayerRow(newSelectedId) {
    selectedPlayerId = newSelectedId;
    document.querySelectorAll('.draft-player-row').forEach(r => r.classList.toggle('bg-amber-200', r.dataset.playerId === newSelectedId));
}

export function renderSelectedPlayerCard(player, gameState) {
    if (!elements.selectedPlayerCard) return;
    if (!player || !gameState?.playerTeam) {
        elements.selectedPlayerCard.innerHTML = `<p class="text-gray-400 text-sm italic text-center py-8">Select a player to view details.</p>`;
        if (elements.draftPlayerBtn) elements.draftPlayerBtn.disabled = true;
        return;
    }

    const playerRoster = getUIRosterObjects(gameState.playerTeam);
    const maxLevel = playerRoster.reduce((max, rp) => Math.max(max, getRelationshipLevel(rp.id, player.id)), relationshipLevels.STRANGER.level);
    const scouted = getScoutedPlayerInfo(player, maxLevel);

    const positions = Object.keys(positionOverallWeights);
    let overallsHtml = '<div class="mt-2 grid grid-cols-4 gap-1 text-center">';
    positions.forEach(pos => {
        overallsHtml += `<div class="bg-gray-100 p-1.5 rounded"><p class="text-[10px] font-bold text-gray-500">${pos}</p><p class="font-black text-sm text-gray-800">${calculateOverall(player, pos)}</p></div>`;
    });
    overallsHtml += '</div>';

    elements.selectedPlayerCard.innerHTML = `
        <h4 class="font-bold text-base text-gray-900">${scouted.name}</h4>
        <p class="text-xs text-gray-500">Age: ${scouted.age} | H: ${formatHeight(scouted.attributes?.physical?.height)} | W: ${scouted.attributes?.physical?.weight} lbs</p>
        <p class="text-xs text-gray-600 mt-1">Est. Pos: <span class="font-bold text-gray-900">${estimateBestPosition(scouted)}</span> | Pot: <span class="font-bold text-amber-600">${scouted.potential}</span></p>
        ${overallsHtml}
    `;
}

export function renderPlayerRoster(playerTeam) {
    if (!elements.rosterCount || !elements.draftRosterList || !playerTeam) return;
    const roster = getUIRosterObjects(playerTeam);
    elements.rosterCount.textContent = `${roster.length}/18`;
    elements.draftRosterList.innerHTML = roster.map(p => `
        <li class="py-1.5 px-3 flex justify-between items-center text-xs">
            <span class="font-semibold text-gray-800">${p.name}</span>
            <span class="text-gray-400 font-bold">${estimateBestPosition(p)} (${calculateOverall(p, estimateBestPosition(p))})</span>
        </li>
    `).join('') || '<li class="p-2 text-center text-gray-400 text-xs italic">No players drafted yet.</li>';
}

export function renderDashboard(gameState) {
    if (!gameState?.playerTeam) return;
    const { playerTeam, year, currentWeek, messages } = gameState;
    const currentW = currentWeek < 9 ? `Week ${currentWeek + 1}` : 'Offseason';

    if (elements.dashboardTeamName) elements.dashboardTeamName.innerHTML = `${playerTeam.name}`;
    if (elements.dashboardRecord) elements.dashboardRecord.textContent = `${playerTeam.wins || 0} - ${playerTeam.losses || 0}${playerTeam.ties ? ` - ${playerTeam.ties}` : ''}`;
    if (elements.dashboardYear) elements.dashboardYear.textContent = year || '1';
    if (elements.dashboardWeek) elements.dashboardWeek.textContent = currentW;

    const credEl = document.getElementById('dashboard-cred');
    const favorsEl = document.getElementById('dashboard-favors');
    if (credEl) credEl.textContent = playerTeam.socialProfile?.streetCred || 50;
    if (favorsEl) favorsEl.textContent = playerTeam.socialProfile?.favorTokens || 0;

    if (elements.advanceWeekBtn) elements.advanceWeekBtn.textContent = currentWeek < 9 ? 'Play Week' : 'Go to Offseason';

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
        case 'messages': renderMessagesTab(gameState); break;
    }
}

function renderMyTeamTab(gameState) {
    if (!elements.myTeamRoster || !gameState?.playerTeam) return;
    const roster = getUIRosterObjects(gameState.playerTeam);

    let html = `<div class="overflow-x-auto"><table class="min-w-full bg-white text-sm"><thead class="bg-gray-800 text-white sticky top-0 z-10"><tr>
        <th class="py-2 px-3 text-left sticky left-0 bg-gray-800 z-20">Name</th>
        <th class="py-2 px-3 text-center">C</th><th class="py-2 px-3 text-center">#</th>
        <th class="py-2 px-3 text-center">Age</th><th class="py-2 px-3 text-center">Pot</th>
        <th class="py-2 px-3 text-center">Status</th>
        <th class="py-2 px-3 text-center">HGT</th><th class="py-2 px-3 text-center">WGT</th>
        <th class="py-2 px-3 text-center">SPD</th><th class="py-2 px-3 text-center">STR</th>
        <th class="py-2 px-3 text-center">AGI</th><th class="py-2 px-3 text-center">IQ</th>
        <th class="py-2 px-3 text-center">THR</th><th class="py-2 px-3 text-center">HND</th>
        <th class="py-2 px-3 text-center">BLK</th><th class="py-2 px-3 text-center">TKL</th>
    </tr></thead><tbody class="divide-y">`;

    if (roster.length === 0) {
        html += `<tr><td colspan="16" class="p-4 text-center text-gray-400">Roster empty.</td></tr>`;
    } else {
        roster.forEach(p => {
            const isCap = gameState.playerTeam.captainId === p.id;
            const capIcon = isCap ? '★' : '☆';
            html += `<tr data-player-id="${p.id}" class="cursor-pointer hover:bg-amber-50">
                <td class="py-2 px-3 font-semibold sticky left-0 bg-white z-10">${p.name}</td>
                <td class="text-center py-2 px-3 text-amber-500 font-bold">${capIcon}</td>
                <td class="text-center py-2 px-3 font-medium">${p.number || '--'}</td>
                <td class="text-center py-2 px-3">${p.age}</td>
                <td class="text-center py-2 px-3 font-bold text-amber-600">${p.potential || '?'}</td>
                <td class="text-center py-2 px-3 text-xs ${p.status?.duration > 0 ? 'text-red-500' : 'text-green-600'}">${p.status?.description || 'Healthy'}</td>
                <td class="text-center py-2 px-3">${formatHeight(p.attributes?.physical?.height)}</td>
                <td class="text-center py-2 px-3">${p.attributes?.physical?.weight || 0}</td>
                <td class="text-center py-2 px-3 font-bold text-blue-600">${p.attributes?.physical?.speed || 0}</td>
                <td class="text-center py-2 px-3">${p.attributes?.physical?.strength || 0}</td>
                <td class="text-center py-2 px-3">${p.attributes?.physical?.agility || 0}</td>
                <td class="text-center py-2 px-3">${p.attributes?.mental?.playbookIQ || 0}</td>
                <td class="text-center py-2 px-3">${p.attributes?.technical?.throwingAccuracy || 0}</td>
                <td class="text-center py-2 px-3">${p.attributes?.technical?.catchingHands || 0}</td>
                <td class="text-center py-2 px-3">${p.attributes?.technical?.blocking || 0}</td>
                <td class="text-center py-2 px-3">${p.attributes?.technical?.tackling || 0}</td>
            </tr>`;
        });
    }
    elements.myTeamRoster.innerHTML = html + `</tbody></table></div>`;
}

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

    select.onchange = (e) => {
        const team = getGameState().playerTeam;
        team.formations[side] = e.target.value;
        rebuildDepthChartFromOrder(team);
        document.dispatchEvent(new CustomEvent('refresh-ui'));
    };
}

function renderPositionalOveralls() {
    const pane = document.getElementById("positional-overalls-container");
    const gs = getGameState();
    if (!pane || !gs?.playerTeam) return;

    const team = gs.playerTeam;
    const roster = getUIRosterObjects(team);
    const depthOrder = team.depthOrder || {};
    const displayOrder = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'];

    let html = `<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">`;
    displayOrder.forEach(pos => {
        const pIds = depthOrder[pos] || [];
        const players = pIds.map(id => roster.find(p => p && p.id === id)).filter(Boolean);

        html += `
        <div class="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden flex flex-col">
            <div class="bg-gray-800 px-3 py-2 flex justify-between items-center text-white">
                <h4 class="font-bold text-sm">${pos} DEPTH</h4>
                <span class="text-[10px] font-bold bg-gray-700 px-2 py-0.5 rounded-full">${players.length}</span>
            </div>
            <div class="flex-1 overflow-y-auto max-h-64 p-2 space-y-1">
                ${players.map((p, i) => `
                    <div class="flex items-center justify-between p-1.5 rounded text-sm hover:bg-gray-50">
                        <span class="truncate">${i + 1}. ${p.name}</span>
                        <span class="font-bold text-gray-700">${calculateOverall(p, pos)}</span>
                    </div>
                `).join('')}
            </div>
        </div>`;
    });
    pane.innerHTML = html + `</div>`;
}

function renderDepthChartSide(side, gameState) {
    const visualField = document.getElementById(`${side}-visual-field`);
    const benchTable = document.getElementById(`${side}-bench-table`);
    if (!visualField || !benchTable) return;

    const { depthChart, formations } = gameState.playerTeam;
    const roster = getUIRosterObjects(gameState.playerTeam);
    const currentChart = depthChart[side] || {};
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

            const ovr = player ? calculateOverall(player, posKey) : '?';
            const shortName = player ? player.name.split(' ')[0] : 'Empty';

            slotEl.className = 'absolute transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group z-10 cursor-pointer';
            slotEl.innerHTML = `
                <div class="relative w-10 h-10 rounded-full border-2 border-white shadow-lg flex flex-col items-center justify-center bg-gray-800 text-white">
                    <span class="text-[8px] font-bold uppercase leading-none">${posKey}</span>
                    <span class="text-sm font-black leading-none">${ovr}</span>
                </div>
                <div class="mt-1 bg-gray-900 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow text-center max-w-[70px] truncate border border-gray-700">
                    ${shortName}
                </div>
            `;
            slotEl.onclick = () => window.app_openSlotModal(side, slotId);
            visualField.appendChild(slotEl);
        });
    }

    const starters = new Set(Object.values(currentChart).filter(Boolean));
    const benched = roster.filter(p => !starters.has(p.id));

    benchTable.innerHTML = `<table class="min-w-full bg-white text-xs"><thead class="bg-gray-100"><tr>
        <th class="py-1 px-2 text-left">Name</th><th class="py-1 px-2 text-center">Pos</th><th class="py-1 px-2 text-center">OVR</th>
    </tr></thead><tbody class="divide-y">
        ${benched.map(p => `
            <tr>
                <td class="py-1 px-2 font-semibold">${p.name}</td>
                <td class="py-1 px-2 text-center text-gray-500">${estimateBestPosition(p)}</td>
                <td class="py-1 px-2 text-center font-bold">${calculateOverall(p, estimateBestPosition(p))}</td>
            </tr>
        `).join('')}
    </tbody></table>`;
}

window.app_openSlotModal = function (side, slotId) {
    const gs = getGameState();
    if (!gs?.playerTeam) return;
    const roster = getUIRosterObjects(gs.playerTeam);
    const currentChart = gs.playerTeam.depthChart[side] || {};
    const currentId = currentChart[slotId];
    let posKey = slotId.replace(/\d+/g, '');
    if (['OT', 'OG', 'C'].includes(posKey)) posKey = 'OL';

    const candidates = roster.filter(p => p && (!Object.values(currentChart).includes(p.id) || p.id === currentId));
    candidates.sort((a, b) => calculateOverall(b, posKey) - calculateOverall(a, posKey));

    window.app_assignSlot = function (s, slot, pid) {
        assignPlayerToSlot(gs.playerTeam, pid, slot, s);
        saveGameState();
        renderDepthChartTab(gs);
        hideModal();
    };

    let modalHtml = `<div class="space-y-2 max-h-[60vh] overflow-y-auto pr-2 pb-2">
        <button class="w-full text-left p-3 border border-red-200 rounded-lg hover:bg-red-50 text-red-600 font-bold" onclick="app_assignSlot('${side}', '${slotId}', '')">
            Clear Slot
        </button>
        ${candidates.map(p => `
            <button class="w-full text-left p-3 border rounded-lg hover:bg-gray-50 flex justify-between items-center ${p.id === currentId ? 'bg-amber-50 border-amber-300' : 'border-gray-200'}" onclick="app_assignSlot('${side}', '${slotId}', '${p.id}')">
                <div>
                    <span class="font-bold text-gray-800">${p.name}</span>
                    <span class="text-xs text-gray-500 block">Age: ${p.age} • ${formatHeight(p.attributes?.physical?.height)}</span>
                </div>
                <span class="font-black text-xl text-gray-800">${calculateOverall(p, posKey)} OVR</span>
            </button>
        `).join('')}
    </div>`;

    showModal(`Assign Player: ${slotId}`, modalHtml);
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
    elements.standingsContainer.innerHTML = '';

    const tiers = [
        { name: 'Premier Parks (Tier 1)', teams: gameState.teams.filter(t => t.tier === 1) },
        { name: 'Sandlot Circuit (Tier 2)', teams: gameState.teams.filter(t => t.tier === 2) },
        { name: 'Pee-Wee League (Youth)', teams: gameState.teams.filter(t => t.leagueType === 'youth') }
    ];

    tiers.forEach(tier => {
        if (tier.teams.length === 0) return;
        const sorted = tier.teams.sort((a, b) => (b.wins || 0) - (a.wins || 0));
        elements.standingsContainer.innerHTML += `
            <div class="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm mb-4">
                <div class="bg-gray-800 text-white px-3 py-2 font-bold text-sm">${tier.name}</div>
                <table class="min-w-full text-xs">
                    <thead class="bg-gray-50 text-gray-500">
                        <tr><th class="py-1 px-3 text-left">Team</th><th class="py-1 px-3 text-center">W</th><th class="py-1 px-3 text-center">L</th></tr>
                    </thead>
                    <tbody class="divide-y">
                        ${sorted.map(t => `<tr>
                            <td class="py-1.5 px-3 font-semibold ${t.id === gameState.playerTeam.id ? 'text-amber-600' : 'text-gray-800'}">${t.name}</td>
                            <td class="py-1.5 px-3 text-center font-bold">${t.wins || 0}</td>
                            <td class="py-1.5 px-3 text-center text-gray-500">${t.losses || 0}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>`;
    });
}

export function renderPlayerStatsTab(gameState) {
    if (!elements.playerStatsContainer || !gameState?.players) return;
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
        container.innerHTML = `<p class="text-gray-400 text-center py-12">No history available yet.</p>`;
        return;
    }

    let html = '<div class="space-y-6">';
    // Reverse to show the most recent season at the top
    const seasons = [...gameState.history.seasons].reverse();

    seasons.forEach(season => {
        const topPicks = (season.draftResults || []).slice(0, 3).map(p => `<strong>1.${p.pick}</strong> ${p.playerName} (${p.teamName})`).join('<br>');

        html += `
        <div class="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div class="bg-gray-800 text-white px-4 py-2 flex justify-between items-center">
                <h4 class="font-bold text-lg">Season ${season.year}</h4>
                <span class="text-sm text-amber-400 font-bold uppercase tracking-wider">🏆 ${season.champion}</span>
            </div>
            <div class="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div class="space-y-2">
                    <p><span class="font-bold text-gray-500 uppercase text-xs tracking-wider">Champion:</span> <span class="text-amber-600 font-bold text-base block">${season.champion}</span></p>
                    <p><span class="font-bold text-gray-500 uppercase text-xs tracking-wider">Runner-Up:</span> <span class="text-gray-800 font-semibold block">${season.runnerUp}</span></p>
                    <div class="pt-2 mt-2 border-t border-gray-100">
                        <p><span class="font-bold text-gray-500 uppercase text-xs tracking-wider">Sandlot Champ (Tier 2):</span> <span class="text-blue-600 font-semibold block">${season.tier2Champion || 'Unknown'}</span></p>
                        <p><span class="font-bold text-gray-500 uppercase text-xs tracking-wider">Pee-Wee Champ:</span> <span class="text-green-600 font-semibold block">${season.youthChampion || 'Unknown'}</span></p>
                    </div>
                    
                    <div class="pt-2 mt-2 border-t border-gray-100 flex gap-4">
                        <div>
                            <span class="font-bold text-green-600 uppercase text-xs tracking-wider">Promoted (Tier 1)</span>
                            <p class="text-gray-700">${season.promoted.join('<br>') || 'None'}</p>
                        </div>
                        <div>
                            <span class="font-bold text-red-600 uppercase text-xs tracking-wider">Relegated (Tier 2)</span>
                            <p class="text-gray-700">${season.relegated.join('<br>') || 'None'}</p>
                        </div>
                    </div>
                </div>
                <div class="bg-gray-50 p-3 rounded-lg border border-gray-100 h-full">
                    <p class="font-bold text-gray-500 uppercase text-xs tracking-wider mb-2">Top Draft Picks</p>
                    <p class="text-sm text-gray-700 leading-relaxed">${topPicks || 'No draft data available.'}</p>
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
    const container = elements.playerDevelopmentContainer;
    if (container && report?.developmentResults) {
        container.innerHTML = report.developmentResults.map(r => `
            <div class="p-2 bg-white rounded border border-gray-200 text-xs mb-1">
                <span class="font-bold text-gray-800">${r.player.name} (${r.player.age}yo)</span>
                <span class="text-green-600 font-semibold ml-2">${r.improvements.map(i => `${i.attr} +${i.increase}`).join(', ') || 'No gains'}</span>
            </div>
        `).join('');
    }
}

export function setupDragAndDrop(onDrop) {}

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

            if (offensePane) offensePane.classList.toggle("hidden", subTab !== "offense");
            if (defensePane) defensePane.classList.toggle("hidden", subTab !== "defense");
            if (overallsPane) overallsPane.classList.toggle("hidden", subTab !== "overalls");
            if (depthOrderPane) depthOrderPane.classList.toggle("hidden", subTab !== "depth-order");

            if (subTab === "overalls") renderPositionalOveralls();
            if (subTab === "depth-order") renderDepthOrderPane(getGameState());
        });
    });
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
    if (elements.simHomeScore) elements.simHomeScore.textContent = activeLiveGame.homeScore;
    if (elements.simAwayScore) elements.simAwayScore.textContent = activeLiveGame.awayScore;
    if (elements.simPossession && activeLiveGame.possession) {
        elements.simPossession.textContent = `🏈 ${activeLiveGame.possession.name}`;
    }
    if (elements.simGameDown) elements.simGameDown.textContent = `${activeLiveGame.down} & ${activeLiveGame.yardsToGo}`;
    if (elements.simGameDrive) elements.simGameDrive.textContent = `Q${activeLiveGame.quarter || 1} | ${formatGameClock(activeLiveGame.clock)}`;
}

function runLiveGameStep() {
    if (!activeLiveGame) return;
    if (activeLiveGame.isGameOver) {
        finishLiveGame();
        return;
    }

    updateLiveScoreboard();
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
        const frame = frames[index];
        if (frame && elements.fieldCanvas && elements.fieldCanvasCtx) {
            drawFieldVisualization(elements.fieldCanvas, elements.fieldCanvasCtx, frame);
        }
        index++;
        if (index >= frames.length) {
            if (onComplete) onComplete();
            return;
        }
        setTimeout(runNext, isSkipping ? 5 : liveGameSpeed);
    };
    runNext();
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
