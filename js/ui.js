import * as Game from './game.js';
import {
    saveGameState, getRelationshipLevel, getScoutedPlayerInfo, getGameState,
    getRosterObjects, getPlayer, rebuildDepthChartFromOrder, assignPlayerToSlot
} from './game.js';
import { offenseFormations, defenseFormations, relationshipLevels, firstNames, lastNames, offensivePlaybook, defensivePlaybook, routeTree } from './data.js';
import { positionOverallWeights, estimateBestPosition, calculateOverall, getProspectSignatureSkills } from './game/player.js';
import { formatHeight } from './utils.js';
import { drawFieldVisualization, formatGameClock, showPlayOverlay } from './ui/field_visualizer.js';
import { renderDepthOrderPane } from './ui/depth_order.js';
import { getCurrentRosterLimit } from './game/season.js';
import { DEFAULT_PLAYBACK_INTERVAL_MS, getPlaybackIntervalMs } from './game/simulation_config.js';

let elements = {};
let selectedPlayerId = null;
let dragPlayerId = null;
let dragSide = null;
let debounceTimeout = null;
let depthOrderSortCol = 'overall';
let depthOrderSortDir = 'desc';
let activeDepthOrderTab = 'QB';

let liveGameSpeed = DEFAULT_PLAYBACK_INTERVAL_MS;
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

const SCOUTING_LEVEL_LABELS = [
    'Unscouted',
    'Initial',
    'Evaluated',
    'Detailed',
    'Fully scouted'
];
const SCOUTING_LEVEL_THRESHOLDS = [0, 4, 12, 24, 40];

function getScoutingAwarePlayerView(player, team, reportOverride = undefined) {
    if (!player) return null;

    const isOwnedByTeam = player.teamId === team?.id ||
        (Array.isArray(team?.roster) &&
            team.roster.some(id => String(id) === String(player.id)));

    // Your own players remain fully known.
    if (isOwnedByTeam) return player;

    const report = reportOverride === undefined
        ? Game.getTeamScoutingReport?.(team, player.id) || null
        : reportOverride;

    const rawLevel = Number(report?.level);
    const scoutingLevel = Number.isInteger(rawLevel)
        ? Math.max(0, Math.min(4, rawLevel))
        : 0;

    const attributes = {};

    // Preserve public measurements; conceal every other attribute until
    // the team's own scouting report supplies an estimated range.
    for (const [category, values] of Object.entries(player.attributes || {})) {
        if (!values || typeof values !== 'object' || Array.isArray(values)) continue;

        const safeValues = {};

        for (const [attribute] of Object.entries(values)) {
            if (
                category === 'physical' &&
                ['height', 'weight'].includes(attribute)
            ) {
                safeValues[attribute] = values[attribute];
                continue;
            }

            const range = report?.attributeRanges?.[category]?.[attribute];

            safeValues[attribute] =
                range &&
                Number.isFinite(range.low) &&
                Number.isFinite(range.high)
                    ? `${range.low} - ${range.high}`
                    : '?';
        }

        attributes[category] = safeValues;
    }

    const potentialRange = report?.potentialRange || null;

    return {
        id: player.id,
        name: player.name,
        age: player.age,
        pos: player.pos || null,
        teamId: player.teamId,
        status: player.status
            ? {
                type: player.status.type,
                duration: player.status.duration
            }
            : null,
        attributes,
        potential: potentialRange
            ? `${potentialRange.bestPossible}–${potentialRange.worstPossible}`
            : '?',
        potentialRange,
        scoutingLevel,
        scoutingProgressPoints: Math.max(
            0,
            Number(report?.progressPoints) || 0
        ),
        scoutingConfidence: Number(report?.confidence) || 0,
        scoutingEvaluation: report?.evaluation || null,
        scoutingReport: report,
        isExternalProspect: true
    };
}

const OFFENSIVE_POSITION_FITS = ['QB', 'RB', 'WR', 'TE', 'OL'];
const DEFENSIVE_POSITION_FITS = ['DL', 'LB', 'DB'];

const PUBLIC_STAT_LABELS = {
    passYards: 'Pass Yds',
    passCompletions: 'Completions',
    passAttempts: 'Pass Att',
    interceptionsThrown: 'INT Thrown',
    rushYards: 'Rush Yds',
    rushAttempts: 'Carries',
    receptions: 'Receptions',
    recYards: 'Rec Yds',
    targets: 'Targets',
    drops: 'Drops',
    tackles: 'Tackles',
    sacks: 'Sacks',
    interceptions: 'INT',
    touchdowns: 'TD',
    returnYards: 'Return Yds',
    fumblesRecovered: 'Fum Rec'
};

const PUBLIC_STATS_BY_POSITION = {
    QB: ['passYards', 'passCompletions', 'passAttempts', 'touchdowns', 'interceptionsThrown', 'rushYards'],
    RB: ['rushYards', 'rushAttempts', 'receptions', 'recYards', 'touchdowns'],
    WR: ['receptions', 'recYards', 'targets', 'touchdowns', 'drops', 'returnYards'],
    TE: ['receptions', 'recYards', 'targets', 'touchdowns', 'drops'],
    OL: ['touchdowns', 'rushYards'],
    DL: ['tackles', 'sacks', 'interceptions', 'fumblesRecovered', 'touchdowns'],
    LB: ['tackles', 'sacks', 'interceptions', 'fumblesRecovered', 'touchdowns'],
    DB: ['tackles', 'interceptions', 'returnYards', 'touchdowns']
};

function renderPublicStatSummary(stats, position) {
    if (!stats || typeof stats !== 'object') {
        return '<span class="text-slate-400 italic">No recorded statistics</span>';
    }

    const fields = PUBLIC_STATS_BY_POSITION[position] ||
        Object.keys(PUBLIC_STAT_LABELS);

    const entries = fields
        .filter(field => Number.isFinite(stats[field]))
        .map(field => ({
            label: PUBLIC_STAT_LABELS[field],
            value: stats[field]
        }));

    if (entries.length === 0) {
        return '<span class="text-slate-400 italic">No tracked statistics for this position</span>';
    }

    return entries.map(entry => `
        <span class="inline-flex items-center gap-1 bg-white border border-slate-200 rounded px-1.5 py-0.5 whitespace-nowrap">
            <span class="text-slate-500">${entry.label}</span>
            <b class="text-slate-800">${entry.value}</b>
        </span>
    `).join('');
}

function renderPublicPlayerRecord(info) {
    if (!info) {
        return `
            <div class="rounded border border-slate-200 bg-slate-50 p-2">
                <p class="text-slate-500 italic">Public player record unavailable.</p>
            </div>`;
    }

    const details = [
        info.listedPosition ? `Listed: ${info.listedPosition}` : null,
        info.height != null ? formatHeight(info.height) : null,
        info.weight != null ? `${info.weight} lbs` : null,
        info.currentTeamName || null
    ].filter(Boolean);

    const recentSeasons = Array.isArray(info.recentSeasons)
        ? info.recentSeasons.slice(-3).reverse()
        : [];

    const historyHtml = recentSeasons.length > 0
        ? recentSeasons.map(season => `
            <div class="border-t border-slate-200 pt-1.5 first:border-t-0 first:pt-0">
                <div class="flex flex-wrap items-center justify-between gap-1 mb-1">
                    <span class="font-bold text-slate-700">
                        ${season.year != null ? `Year ${season.year}` : 'Season record'}
                        ${season.age != null ? ` · Age ${season.age}` : ''}
                    </span>
                    <span class="text-slate-400">${season.teamName || ''}</span>
                </div>
                <div class="flex flex-wrap gap-1">
                    ${renderPublicStatSummary(season.stats, info.listedPosition)}
                </div>
            </div>
        `).join('')
        : '<p class="text-slate-400 italic">No season history recorded.</p>';

    const careerHtml = info.careerStats
        ? renderPublicStatSummary(info.careerStats, info.listedPosition)
        : '<span class="text-slate-400 italic">No career totals recorded</span>';

    return `
        <section class="rounded border border-slate-200 bg-slate-50 p-2 space-y-2">
            <div class="flex flex-wrap items-center justify-between gap-1">
                <span class="font-black tracking-wide text-slate-700">PUBLIC RECORD</span>
                <span class="text-[9px] text-slate-400">Available without scouting</span>
            </div>

            <div class="flex flex-wrap gap-1">
                ${details.map(detail => `
                    <span class="bg-white border border-slate-200 rounded px-1.5 py-0.5 text-slate-600">
                        ${detail}
                    </span>
                `).join('')}
            </div>

            <div>
                <p class="text-[9px] font-bold uppercase tracking-wide text-slate-500 mb-1">
                    Recent seasons
                </p>
                <div class="space-y-1.5">
                    ${historyHtml}
                </div>
            </div>

            <div>
                <p class="text-[9px] font-bold uppercase tracking-wide text-slate-500 mb-1">
                    Career totals${info.seasonsPlayed > 0 ? ` · ${info.seasonsPlayed} seasons` : ''}
                </p>
                <div class="flex flex-wrap gap-1">
                    ${careerHtml}
                </div>
            </div>
        </section>`;
}

function hasScoutingUncertainty(player) {
    return Object.values(player?.attributes || {}).some(category =>
        category &&
        Object.values(category).some(value =>
            typeof value === 'string' &&
            (
                value.trim() === '?' ||
                /^\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?$/.test(value.trim())
            )
        )
    );
}

function getPlayerForPositionRatings(player) {
    if (!player?.attributes) return player;

    const attributes = {};

    for (const [category, values] of Object.entries(player.attributes)) {
        if (!values || typeof values !== 'object' || Array.isArray(values)) {
            attributes[category] = values;
            continue;
        }

        attributes[category] = {};

        for (const [key, value] of Object.entries(values)) {
            if (typeof value !== 'string') {
                attributes[category][key] = value;
                continue;
            }

            const trimmed = value.trim();
            const range = trimmed.match(
                /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/
            );

            if (range) {
                // Estimate from the midpoint of the scouting range.
                attributes[category][key] =
                    (Number(range[1]) + Number(range[2])) / 2;
            } else {
                const parsed = Number(trimmed);

                // Unknown attributes use a neutral estimate, not the hidden rating.
                attributes[category][key] =
                    trimmed !== '' && Number.isFinite(parsed) ? parsed : 50;
            }
        }
    }

    return { ...player, attributes };
}

function calculateDisplayOverall(player, position) {
    return calculateOverall(
        getPlayerForPositionRatings(player),
        position
    );
}

function getBestPositionFit(player, positions) {
    if (!player) {
        return { position: '—', ovr: 0, estimated: false };
    }

    const ratingPlayer = getPlayerForPositionRatings(player);
    const validPositions = positions.filter(position =>
        positionOverallWeights[position]
    );

    // Prefer positions the player can actually fill.
    const viablePositions = validPositions.filter(position =>
        Game.isPlayerViableForPosition(ratingPlayer, position)
    );

    // Fall back to the available position ratings if none pass the viability check.
    const positionsToEvaluate = viablePositions.length > 0
        ? viablePositions
        : validPositions;

    const ratings = positionsToEvaluate.map(position => ({
        position,
        ovr: calculateOverall(ratingPlayer, position),
        estimated: hasScoutingUncertainty(player)
    }));

    ratings.sort((a, b) => b.ovr - a.ovr);

    return ratings[0] || { position: '—', ovr: 0, estimated: false };
}

function getBestTwoWayFits(player) {
    if (player?.isExternalProspect) {
        const getReportedFit = (fit) => {
            if (
                !player.scoutingLevel ||
                !fit ||
                !Number.isFinite(fit.low) ||
                !Number.isFinite(fit.high)
            ) {
                return {
                    position: '—',
                    ovr: '',
                    estimated: true,
                    available: false
                };
            }

            return {
                position: fit.position,
                ovr: Math.round((fit.low + fit.high) / 2),
                low: fit.low,
                high: fit.high,
                estimated: true,
                available: true
            };
        };

        return {
            offense: getReportedFit(player.scoutingEvaluation?.offenseFit),
            defense: getReportedFit(player.scoutingEvaluation?.defenseFit)
        };
    }

    return {
        offense: getBestPositionFit(player, OFFENSIVE_POSITION_FITS),
        defense: getBestPositionFit(player, DEFENSIVE_POSITION_FITS)
    };
}

function renderPositionFit(fit, side, includeSideLabel = false) {
    const isOffense = side === 'offense';
    const colorClass = isOffense
        ? 'text-emerald-700'
        : 'text-blue-700';
    const sideLabel = isOffense ? 'OFF' : 'DEF';
    const hasFit = fit.available !== false;
    const title = !hasFit
        ? 'Unscouted: assign staff time to estimate this fit'
        : Number.isFinite(fit.low) && Number.isFinite(fit.high)
            ? `Estimated range: ${fit.low}-${fit.high}`
            : '';

    return `
        <span class="inline-flex items-center gap-1 whitespace-nowrap ${colorClass}" title="${title}">
            ${includeSideLabel
                ? `<span class="text-[8px] font-black">${sideLabel}</span>`
                : ''}
            <span class="font-black">${hasFit ? fit.position : '—'}</span>
            <span class="font-mono font-bold">${hasFit
                ? `${fit.estimated ? '~' : ''}${fit.ovr}`
                : 'Unscouted'}</span>
        </span>`;
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

    let confirmBtn = null;

    cancelBtn.onclick = () => {
        cancelBtn.disabled = true;
        if (confirmBtn) confirmBtn.disabled = true;
        hideModal();
        if (onCancel) onCancel();
    };
    actionsDiv.appendChild(cancelBtn);

    if (onConfirm) {
        confirmBtn = document.createElement('button');
        confirmBtn.textContent = confirmText;
        confirmBtn.className = 'btn bg-amber-500 hover:bg-amber-600 text-white font-bold py-2 px-6 rounded-lg text-sm';
        confirmBtn.onclick = () => {
            confirmBtn.disabled = true;
            cancelBtn.disabled = true;
            hideModal();
            if (onConfirm) onConfirm();
        };
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
    const rosterLimit = getCurrentRosterLimit(gameState);

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
    const playerCanPick = pickingTeam.id === playerTeam.id && currentRosterSize < rosterLimit;

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
        const report = Game.getTeamScoutingReport?.(gameState.playerTeam, p.id);
        const reportedPositions = [
            report?.evaluation?.offenseFit?.position,
            report?.evaluation?.defenseFit?.position
        ];

        const matchesPos = !posFilter ||
            p.pos === posFilter ||
            reportedPositions.includes(posFilter);

        return matchesName && matchesPos;
    });

    // 2. Render Dynamic Table Header based on View Tab
    if (thead) {
        if (activeDraftView === 'overview') {
            thead.innerHTML = `
                <tr>
                    <th class="py-2 px-2 text-center w-8">★</th>
                    <th class="py-2 px-2 text-center">Off Fit</th>
                    <th class="py-2 px-2 text-center">Def Fit</th>
                    <th class="py-2 px-3 text-left cursor-pointer hover:bg-slate-200" data-sort="name">Prospect / Style</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="age">Age</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="potential">Pot</th>
                    <th class="py-2 px-2 text-center">Scout</th>
                    <th class="py-2 px-2 text-center">Frame</th>
                    <th class="py-2 px-3 text-center">Key Skills</th>
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
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="throwingAccuracy">Acc</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="throwPower">Pow</th>
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
    const scoutingReports = Game.getTeamScoutingReports?.(gameState.playerTeam) || {};
    const getReport = p => scoutingReports[String(p.id)] || null;

    const getPotentialScore = p => {
        const range = getReport(p)?.potentialRange;
        if (!range) return null;

        const best = potentialOrder[range.bestPossible];
        const worst = potentialOrder[range.worstPossible];

        return Number.isFinite(best) && Number.isFinite(worst)
            ? (best + worst) / 2
            : null;
    };

    const getTwoWayScore = p => {
        const evaluation = getReport(p)?.evaluation;
        const fits = [evaluation?.offenseFit, evaluation?.defenseFit]
            .filter(fit =>
                fit &&
                Number.isFinite(fit.low) &&
                Number.isFinite(fit.high)
            );

        if (fits.length === 0) return null;

        return fits.reduce(
            (sum, fit) => sum + (fit.low + fit.high) / 2,
            0
        ) / fits.length;
    };

    const getPositionSortKey = p => {
        const evaluation = getReport(p)?.evaluation;
        return p.pos ||
            evaluation?.offenseFit?.position ||
            evaluation?.defenseFit?.position ||
            '—';
    };

    const getAttributeScore = p => {
        const report = getReport(p);

        for (const category of ['physical', 'mental', 'technical']) {
            if (p.attributes?.[category]?.[sortColumn] === undefined) continue;

            if (
                category === 'physical' &&
                ['height', 'weight'].includes(sortColumn)
            ) {
                return Number.isFinite(p.attributes[category][sortColumn])
                    ? p.attributes[category][sortColumn]
                    : null;
            }

            const range = report?.attributeRanges?.[category]?.[sortColumn];

            return range &&
                Number.isFinite(range.low) &&
                Number.isFinite(range.high)
                ? (range.low + range.high) / 2
                : null;
        }

        return null;
    };

    const compareReportedValues = (a, b) => {
        if (a == null && b == null) return 0;
        if (a == null) return 1;
        if (b == null) return -1;

        return sortDirection === 'asc' ? a - b : b - a;
    };

    filtered.sort((a, b) => {
        if (sortColumn === 'potential') {
            const potentialCompare = compareReportedValues(
                getPotentialScore(a),
                getPotentialScore(b)
            );
            if (potentialCompare !== 0) return potentialCompare;

            const fitCompare = compareReportedValues(
                getTwoWayScore(a),
                getTwoWayScore(b)
            );
            if (fitCompare !== 0) return fitCompare;

            return a.name.localeCompare(b.name);
        }

        if (sortColumn === 'position') {
            const posA = getPositionSortKey(a);
            const posB = getPositionSortKey(b);

            return sortDirection === 'asc'
                ? posA.localeCompare(posB)
                : posB.localeCompare(posA);
        }

        if (sortColumn === 'name') {
            return sortDirection === 'asc'
                ? a.name.localeCompare(b.name)
                : b.name.localeCompare(a.name);
        }

        if (sortColumn === 'age') {
            return sortDirection === 'asc'
                ? a.age - b.age
                : b.age - a.age;
        }

        const attrCompare = compareReportedValues(
            getAttributeScore(a),
            getAttributeScore(b)
        );

        return attrCompare || a.name.localeCompare(b.name);
    });

    elements.draftPoolTbody.innerHTML = '';
    if (filtered.length === 0) {
        const msg = activeDraftView === 'watchlist' ? 'No prospects pinned to your watchlist yet. Click the ★ next to any player to shortlist them.' : 'No prospects match filters.';
        elements.draftPoolTbody.innerHTML = `<tr><td colspan="9" class="p-6 text-center text-slate-400 font-sans italic">${msg}</td></tr>`;
        return;
    }

    // 4. Render Table Rows
        filtered.forEach(player => {
        const report = getReport(player);
        const scouted = getScoutingAwarePlayerView(
            player,
            gameState.playerTeam,
            report
        );
        if (!scouted) return;

        const scoutingLevel = scouted.scoutingLevel || 0;
        const progressPoints = scouted.scoutingProgressPoints || 0;
        const nextThreshold = SCOUTING_LEVEL_THRESHOLDS[scoutingLevel + 1];
        const scoutingLabel = SCOUTING_LEVEL_LABELS[scoutingLevel] || 'Unscouted';
        const scoutingProgressLabel = scoutingLevel < 4
            ? `${Math.floor(progressPoints)}/${nextThreshold}`
            : 'Complete';
        const scoutingStatusHtml = `
            <span class="text-[10px] font-bold text-slate-600 whitespace-nowrap"
                title="${scoutingLevel > 0
                    ? `Estimated confidence: ${Math.round(scouted.scoutingConfidence * 100)}%`
                    : 'No scouting report yet. Assign weekly staff time to begin.'}">
                ${scoutingLabel}
                <span class="block text-[9px] font-normal text-slate-400">${scoutingProgressLabel}</span>
            </span>`;

        const fits = getBestTwoWayFits(scouted);
        const pos = scouted.pos ||
            (fits.offense.available !== false ? fits.offense.position : '—');
        const ovr = scoutingLevel > 0 && pos !== '—'
            ? Math.round(calculateDisplayOverall(scouted, pos))
            : null;
        const ovrDisplay = ovr === null ? 'Unscouted' : `~${ovr}`;
        const offFitHtml = renderPositionFit(fits.offense, 'offense');
        const defFitHtml = renderPositionFit(fits.defense, 'defense');
        const bothFitsHtml = `
            <div class="flex flex-col items-center gap-0.5 text-[10px] leading-tight">
                ${renderPositionFit(fits.offense, 'offense', true)}
                ${renderPositionFit(fits.defense, 'defense', true)}
            </div>`;
        const isStarred = draftWatchlist.has(player.id);

        const row = document.createElement('tr');
        row.className = `cursor-pointer hover:bg-amber-50 draft-player-row transition ${scouted.id === selectedPlayerId ? 'bg-amber-100 font-bold' : ''}`;
        row.dataset.playerId = scouted.id;

        const starBtn = `<button class="star-btn text-base leading-none ${isStarred ? 'text-amber-500 font-bold' : 'text-slate-300 hover:text-amber-400'}" onclick="event.stopPropagation(); window.app_toggleWatchlist('${player.id}')">${isStarred ? '★' : '☆'}</button>`;
        const posBadge = `<span class="bg-slate-100 text-slate-800 font-bold text-[10px] px-1.5 py-0.5 rounded border border-slate-300">${pos}</span>`;

        if (activeDraftView === 'overview') {
            const sigSkills = scoutingLevel > 0
                ? getProspectSignatureSkills(getPlayerForPositionRatings(scouted), pos)
                : [];

            const sigSkillsHtml = scoutingLevel === 0
                ? '<span class="text-[10px] text-slate-400 italic">Scout to reveal skill estimates</span>'
                : sigSkills.map(s =>
                    `<span class="inline-block bg-slate-100 text-slate-800 text-[10px] px-1.5 py-0.5 rounded font-mono mr-1 border border-slate-200">
                        <span class="text-slate-500 font-normal">${s.label}:</span> <b>~${s.val}</b>
                    </span>`
                ).join('');

            row.innerHTML = `
                <td class="py-2 px-2 text-center">${starBtn}</td>
                <td class="py-2 px-2 text-center">${offFitHtml}</td>
                <td class="text-center py-2 px-2">${defFitHtml}</td>
                <td class="py-2 px-3 font-sans truncate max-w-[150px]">
                    <span class="block font-semibold text-slate-900 truncate leading-tight">${scouted.name}</span>
                    <span class="block text-[10px] text-slate-500 truncate leading-tight">${scouted.scoutingEvaluation?.projectedRole || (scoutingLevel > 0 ? 'Role projection developing' : 'Unscouted prospect')}</span>
                </td>
                <td class="text-center py-2 px-2 text-slate-600 font-mono">${scouted.age}</td>
                <td class="text-center py-2 px-2 font-bold ${scouted.potential === 'A' ? 'text-amber-600' : (scouted.potential === 'B' ? 'text-blue-600' : 'text-slate-500')}">${scouted.potential}</td>
                 <td class="text-center py-2 px-2">${scoutingStatusHtml}</td>
                <td class="text-center py-2 px-2 text-slate-500 text-[10px]">${formatHeight(scouted.attributes?.physical?.height)} / ${scouted.attributes?.physical?.weight}#</td>
                <td class="text-center py-2 px-3 whitespace-nowrap">${sigSkillsHtml}</td>
            `;
        } else if (activeDraftView === 'physicals') {
            row.innerHTML = `
                <td class="py-2 px-2 text-center">${starBtn}</td>
                <td class="py-2 px-2 text-center">${bothFitsHtml}</td>
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
                <td class="py-2 px-2 text-center">${bothFitsHtml}</td>
                <td class="py-2 px-3 font-semibold text-slate-900 font-sans truncate max-w-[140px]">${scouted.name}</td>
                <td class="text-center py-2 px-2">${scouted.attributes?.technical?.throwingAccuracy ?? '?'}</td>
                <td class="text-center py-2 px-2">${scouted.attributes?.technical?.throwPower ?? scouted.attributes?.physical?.strength ?? '?'}</td>
                <td class="text-center py-2 px-2">${scouted.attributes?.technical?.catchingHands ?? '?'}</td>
                <td class="text-center py-2 px-2">${scouted.attributes?.technical?.blocking ?? '?'}</td>
                <td class="text-center py-2 px-2">${scouted.attributes?.technical?.tackling ?? '?'}</td>
                <td class="text-center py-2 px-2">${scouted.attributes?.technical?.blockShedding ?? '?'}</td>
                <td class="text-center py-2 px-2">${scouted.attributes?.mental?.playbookIQ ?? '?'}</td>
            `;
        } else {
            row.innerHTML = `
                <td class="py-2 px-2 text-center">${starBtn}</td>
                <td class="py-2 px-2 text-center">${bothFitsHtml}</td>
                <td class="py-2 px-3 font-semibold text-slate-900 font-sans truncate max-w-[140px]">${scouted.name}</td>
                <td class="text-center py-2 px-2">${scouted.age}</td>
                <td class="text-center py-2 px-2 font-bold text-amber-600">${scouted.potential}</td>
                <td class="text-center py-2 px-2 text-blue-600 font-bold">${scouted.attributes?.physical?.speed ?? '?'}</td>
                <td class="text-center py-2 px-2">${scouted.attributes?.technical?.catchingHands ?? '?'}</td>
                <td class="text-center py-2 px-2 font-black text-slate-900">${ovrDisplay}</td>
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
    const scouted = getScoutingAwarePlayerView(player, gameState.playerTeam);

    if (!scouted) return;

    const pos = scouted.pos || '—';
    const fits = getBestTwoWayFits(scouted);
    const scoutingLevel = scouted.scoutingLevel || 0;
    const scoutingLabel = SCOUTING_LEVEL_LABELS[scoutingLevel] || 'Known player';
    const characterSummary = scouted.scoutingEvaluation?.characterSummary ||
        (scoutingLevel >= 3 ? 'Not included in this report' : 'Not assessed yet');
    const publicInfo = Game.getPublicPlayerInfo?.(player) || null;
    const publicRecordHtml = renderPublicPlayerRecord(publicInfo);

    const bestFriend = playerRoster.find(r => r.id === player.social?.bestFriendId);
    const friendsOnTeam = playerRoster.filter(r => player.social?.goodFriendIds?.includes(r.id));
    const rivalOnTeam = playerRoster.find(r => player.social?.rivalIds?.includes(r.id));

    let socialBadgeHtml = '';
    if (bestFriend) socialBadgeHtml += `<span class="bg-amber-100 text-amber-800 border border-amber-300 px-1 py-0.5 rounded text-[9px] font-bold">🤝 BFF: ${bestFriend.name.split(' ')[0]}</span>`;
    if (friendsOnTeam.length > 0) socialBadgeHtml += `<span class="bg-emerald-100 text-emerald-800 border border-emerald-300 px-1 py-0.5 rounded text-[9px] font-bold">Friends: ${friendsOnTeam.length}</span>`;
    if (rivalOnTeam) socialBadgeHtml += `<span class="bg-rose-100 text-rose-800 border border-rose-300 px-1 py-0.5 rounded text-[9px] font-bold">⚠️ Rival</span>`;

    // Character estimates will be displayed only when the scouting report
    // explicitly includes them. Do not read hidden external-player traits here.

    const positions = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'];
    let overallsHtml = '<div class="grid grid-cols-4 gap-1 text-center">';

    positions.forEach(pKey => {
        const pOvr = scouted.isExternalProspect && scoutingLevel === 0
            ? '—'
            : `~${Math.round(calculateDisplayOverall(scouted, pKey))}`;
        const isBestOffense = pKey === fits.offense.position;
        const isBestDefense = pKey === fits.defense.position;

        const fitCardClass = isBestOffense
            ? 'bg-emerald-700 text-white border-emerald-700'
            : isBestDefense
                ? 'bg-blue-700 text-white border-blue-700'
                : 'bg-slate-100 text-slate-700';

        const fitLabelClass = isBestOffense
            ? 'text-emerald-100'
            : isBestDefense
                ? 'text-blue-100'
                : 'text-slate-400';

        overallsHtml += `
            <div class="${fitCardClass} p-1 rounded border">
                <p class="text-[9px] font-bold uppercase ${fitLabelClass}">${pKey}</p>
                <p class="font-black text-xs">${pOvr}</p>
            </div>`;
    });

    overallsHtml += '</div>';

    /*// Identify top secondary position for two-way scouting preview
    const secPosList = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'].filter(pKey => pKey !== pos);
    const topSecPos = secPosList.map(pKey => ({ pos: pKey, ovr: calculateOverall(scouted, pKey) }))
                                .sort((a, b) => b.ovr - a.ovr)[0];
    const twoWaySnippet = topSecPos && topSecPos.ovr >= ovr - 8
        ? `<span class="bg-indigo-50 text-indigo-700 border border-indigo-200 px-1 py-0.2 rounded text-[8px] font-bold">2-Way: ${topSecPos.pos} (${topSecPos.ovr})</span>`
        : '';*/

    elements.selectedPlayerCard.innerHTML = `
        <div class="flex flex-col">
            <!-- Compact Header -->
            <div class="flex justify-between items-center mb-1.5 pb-1 border-b border-slate-200">
                <div class="truncate pr-1">
                    <div class="flex items-center gap-1.5">
                        <h3 class="font-black text-sm text-slate-900 truncate leading-tight">${scouted.name}</h3>
                    </div>
                    <p class="text-[10px] text-slate-500 font-mono">${scouted.age}yo • ${formatHeight(scouted.attributes?.physical?.height)} • ${scouted.attributes?.physical?.weight}#</p>
                    <p class="text-[9px] text-slate-500">${scoutingLabel}${scoutingLevel > 0 ? ` · ${Math.round(scouted.scoutingConfidence * 100)}% confidence` : ' · Assign scouting time to begin'}</p>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                    <div class="text-right bg-emerald-50 border border-emerald-200 px-2 py-1 rounded">
                        <span class="text-[8px] uppercase tracking-wider block text-emerald-700">Off Fit</span>
                        <span class="text-sm font-black leading-none text-emerald-800">
                            ${fits.offense.available === false ? 'Unscouted' : `${fits.offense.position} ${fits.offense.estimated ? '~' : ''}${fits.offense.ovr}`}
                        </span>
                    </div>
                    <div class="text-right bg-blue-50 border border-blue-200 px-2 py-1 rounded">
                        <span class="text-[8px] uppercase tracking-wider block text-blue-700">Def Fit</span>
                        <span class="text-sm font-black leading-none text-blue-800">
                             ${fits.defense.available === false ? 'Unscouted' : `${fits.defense.position} ${fits.defense.estimated ? '~' : ''}${fits.defense.ovr}`}
                        </span>
                    </div>
                </div>
            </div>

            <!-- Dossier Navigation Tabs -->
            <div class="flex gap-1 mb-2 border-b border-slate-200 pb-1.5">
                <button class="dossier-tab-btn flex-1 py-1 rounded text-[10px] font-bold transition ${activeDossierTab === 'overview' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}" data-dtab="overview" onclick="window.app_switchDossierTab('overview')">
                    Overview
                </button>
                <button class="dossier-tab-btn flex-1 py-1 rounded text-[10px] font-bold transition ${activeDossierTab === 'matrix' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}" data-dtab="matrix" onclick="window.app_switchDossierTab('matrix')">
                    8-Way Matrix
                </button>
                <button class="dossier-tab-btn flex-1 py-1 rounded text-[10px] font-bold transition ${activeDossierTab === 'bio' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}" data-dtab="bio" onclick="window.app_switchDossierTab('bio')">
                    Scouting Bio
                </button>
            </div>

            <!-- Tab 1: Overview Pane (Clean & Compact) -->
            <div id="dossier-pane-overview" class="dossier-pane ${activeDossierTab === 'overview' ? '' : 'hidden'} text-[10px] space-y-1.5">
                ${publicRecordHtml}
                <div class="flex flex-wrap items-center gap-1">
                    <span class="bg-amber-100 text-amber-900 font-bold px-1.5 py-0.5 rounded border border-amber-200">Role: ${scouted.scoutingEvaluation?.projectedRole || (scoutingLevel > 0 ? 'Under evaluation' : 'Unscouted')}</span>
                    <span class="bg-indigo-100 text-indigo-900 font-bold px-1.5 py-0.5 rounded border border-indigo-200">Character: ${characterSummary}</span>
                    ${socialBadgeHtml}
                    <p class="w-full text-slate-600 italic">${scouted.scoutingEvaluation?.summary || (scoutingLevel > 0 ? 'Your staff is still developing this evaluation.' : 'No scouting report yet. Allocate staff time to begin learning about this prospect.')}</p>
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
        const fits = getBestTwoWayFits(p);

        return `
        <li class="py-1.5 px-3 flex justify-between items-center text-xs hover:bg-slate-50 transition cursor-pointer" onclick="app.openPlayerCard('${p.id}')">
            <div class="flex items-center gap-1.5 truncate pr-2">
                <span class="text-slate-400 font-mono text-[10px] w-4">#${p.number || '--'}</span>
                <span class="font-semibold text-slate-900 truncate">${p.name}</span>
                <span class="text-[10px] text-slate-400 font-mono">(${p.age}yo)</span>
            </div>
            <div class="text-right shrink-0 flex flex-col items-end gap-0.5 text-[10px] leading-tight">
                ${renderPositionFit(fits.offense, 'offense', true)}
                ${renderPositionFit(fits.defense, 'defense', true)}
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

    // Update the button appearance based on current phase and roster limit
    if (elements.advanceWeekBtn) {
        const rosterLimit = getCurrentRosterLimit(gameState);
        const isOverLimit = gameState.draftCompleted && (playerTeam.roster?.length || 0) > rosterLimit;

        if (currentWeek === 0 && !gameState.draftCompleted) {
            elements.advanceWeekBtn.innerHTML = `<span>Start Draft</span>`;
            elements.advanceWeekBtn.className = 'btn bg-emerald-700 hover:bg-emerald-800 text-white font-bold py-2 px-6 rounded-sm text-sm uppercase tracking-wider transition shadow-sm border border-emerald-900 flex items-center gap-2';
        } else if (isOverLimit) {
            const excess = playerTeam.roster.length - rosterLimit;
            elements.advanceWeekBtn.innerHTML = `<span>⚠️ Cut ${excess} Player${excess > 1 ? 's' : ''}</span>`;
            elements.advanceWeekBtn.className = 'btn bg-rose-700 hover:bg-rose-800 text-white font-bold py-2 px-6 rounded-sm text-sm uppercase tracking-wider transition shadow-sm border border-rose-900 animate-pulse flex items-center gap-2';
        } else if (currentWeek >= 9) {
            elements.advanceWeekBtn.innerHTML = `<span>Advance to Offseason →</span>`;
            elements.advanceWeekBtn.className = 'btn bg-emerald-700 hover:bg-emerald-800 text-white font-bold py-2 px-6 rounded-sm text-sm uppercase tracking-wider transition shadow-sm border border-emerald-900 flex items-center gap-2';
        } else {
            elements.advanceWeekBtn.innerHTML = `<span>Play Week ${currentWeek + 1}</span>`;
            elements.advanceWeekBtn.className = 'btn bg-emerald-700 hover:bg-emerald-800 text-white font-bold py-2 px-6 rounded-sm text-sm uppercase tracking-wider transition shadow-sm border border-emerald-900 flex items-center gap-2';
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
        case 'my-team': 
            if (gameState.playerTeam) renderMyTeamTab(gameState); 
            break;
        case 'depth-chart': 
            if (gameState.playerTeam) {
                renderDepthChartTab(gameState);
            }
            break;
        case 'free-agents': renderFreeAgentsTab(gameState); break;
        case 'messages': renderMessagesTab(gameState); break;
        
        case 'front-office': {
            const foSub =
                document.querySelector('.fo-tab.active')?.dataset.subTab || 'staff';

            if (foSub === 'staff') {
                renderStaffTab(gameState);
            }

            if (foSub === 'staff-market') {
                renderStaffMarketTab(gameState);
            }

            if (foSub === 'finances') {
                window.app?.renderStoreTab?.(gameState);
            }

            if (foSub === 'social') {
                window.app?.renderSocialNetworkTab?.(gameState);
            }

            break;
        }
            
        case 'league':
            const lgSub = document.querySelector('.league-tab.active')?.dataset.subTab || 'standings';
            if (lgSub === 'standings') renderStandingsTab(gameState);
            if (lgSub === 'schedule') renderScheduleTab(gameState);
            if (lgSub === 'player-stats') renderPlayerStatsTab(gameState);
            if (lgSub === 'history') renderHistoryTab(gameState);
            if (lgSub === 'hall-of-fame') renderHallOfFameTab(gameState);
            break;
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
                            <button class="bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-2.5 py-1 rounded text-[10px] uppercase tracking-wider shadow-sm transition" onclick="app.openBidModal('${p.id}')">
                                Pitch Contract 🤝
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

    if (gameState) {
        gameState._faDay = 1;
        gameState._activeFaMarket = new Map();
    }

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

                    // Check active multi-day negotiation state
                    const marketState = gameState._activeFaMarket?.get(p.id);
                    let marketStatusHtml = '';

                    if (marketState) {
                        const isUserLeading = marketState.leaderTeamId === gameState.playerTeam.id;
                        marketStatusHtml = isUserLeading
                            ? `<span class="bg-emerald-100 text-emerald-800 border border-emerald-300 font-black px-1.5 py-0.5 rounded text-[9px] animate-pulse">👑 You Lead (${marketState.leaderOffer.role}, ${marketState.leaderOffer.tokensOffered}🪙)</span>`
                            : `<span class="bg-rose-100 text-rose-800 border border-rose-300 font-black px-1.5 py-0.5 rounded text-[9px]">⚠️ ${marketState.leaderTeamName} Leads (${marketState.leaderOffer.tokensOffered}🪙)</span>`;
                    } else if (intel.heat === 'HOT') {
                        marketStatusHtml = `<span class="bg-amber-100 text-amber-900 border border-amber-300 font-bold px-1.5 py-0.5 rounded text-[9px]">🔥 Hot (${intel.suitorNames.map(n => n.replace('The ', '')).join(', ')})</span>`;
                    } else {
                        marketStatusHtml = `<span class="bg-slate-100 text-slate-500 font-bold px-1.5 py-0.5 rounded text-[9px]">💤 Uncontested</span>`;
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
                            <div class="flex items-center gap-1.5 truncate max-w-[260px]">
                                ${marketStatusHtml}
                                <span class="text-[10px] text-slate-500 truncate italic" title="${intel.rumorText}">${intel.rumorText}</span>
                            </div>
                        </td>
                        <td class="text-right py-2 px-3 font-sans" onclick="event.stopPropagation()">
                            ${userBid ? `
                            <button class="bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 font-bold px-2 py-1 rounded text-[10px] uppercase tracking-tight flex items-center gap-1 shadow-sm transition" onclick="app.openBidModal('${p.id}')" title="Counter-bid or modify terms">
                                <span>Bid: ${userBid.offer.role}</span>
                                <span class="text-amber-700 font-mono">(${userBid.offer.tokensOffered}🪙)</span>
                                <span>✏️</span>
                            </button>` : `
                            <button class="bg-slate-900 hover:bg-slate-800 text-white font-bold px-3 py-1 rounded text-[10px] uppercase tracking-wider transition shadow-sm" onclick="app.openBidModal('${p.id}')">
                                ${marketState ? 'Counter' : 'Bid'}
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

window.app_openBidModal = function(playerId) {
    const gs = getGameState();
    if (!gs?.playerTeam) return;

    const player = Game.getPlayer(playerId) || gs.players.find(p => p.id === playerId);
    if (!player) return;

    const team = gs.playerTeam;
    const pos = player.pos || estimateBestPosition(player);
    const ovr = calculateOverall(player, pos);
    const existingBid = offseasonFABids.find(b => b.playerId === playerId);

    const availableTokens = (team.socialProfile?.favorTokens || 0) -
        offseasonFABids.filter(b => b.playerId !== playerId).reduce((sum, b) => sum + (b.offer.tokensOffered || 0), 0);

    const intel = Game.getPlayerMarketIntel ? Game.getPlayerMarketIntel(player, gs) : { heat: 'QUIET', rumorText: 'No other active suitors.' };

    const modalHtml = `
        <div class="space-y-3.5 text-left text-xs">
            <!-- Prospect Snapshot Header -->
            <div class="bg-slate-900 text-white p-3 rounded flex justify-between items-center shadow-sm">
                <div>
                    <div class="flex items-center gap-2">
                        <h4 class="font-black text-sm text-white">${player.name}</h4>
                        <span class="bg-slate-800 text-amber-400 font-bold px-1.5 py-0.5 rounded text-[10px]">${player.age}yo • ${pos}</span>
                    </div>
                    <p class="text-[11px] text-slate-400 mt-0.5">${player.archetypeName || 'Athlete'} • Style: ${player.personality?.clique || 'Regular'}</p>
                </div>
                <div class="text-right">
                    <span class="text-[9px] uppercase tracking-wider text-slate-400 block">Rating</span>
                    <span class="font-black text-lg text-amber-400">${ovr} OVR</span>
                </div>
            </div>

            <!-- Market Intel Banner -->
            <div class="p-2.5 rounded border ${intel.heat === 'HOT' ? 'bg-rose-50 border-rose-300 text-rose-950' : 'bg-slate-50 border-slate-200 text-slate-700'} text-[11px]">
                <span class="font-bold uppercase tracking-wider block text-[9px] text-slate-500 mb-0.5">Blacktop Grapevine</span>
                <p class="italic">"${intel.rumorText || 'Listening to pitches across the neighborhood.'}"</p>
            </div>

            <!-- Pitch Parameters -->
            <div class="space-y-3 bg-white p-3 border border-slate-200 rounded">
                <div>
                    <label class="block text-[10px] font-black uppercase tracking-wider text-slate-600 mb-1">
                        Promised Roster Role
                    </label>
                    <select id="fa-pitch-role" class="w-full p-2 border border-slate-300 rounded font-bold text-slate-800 bg-white text-xs outline-none">
                        <option value="STARTER" ${(existingBid?.offer?.role === 'STARTER' || !existingBid) ? 'selected' : ''}>Guaranteed Starter (High attraction for top players)</option>
                        <option value="ROTATIONAL" ${existingBid?.offer?.role === 'ROTATIONAL' ? 'selected' : ''}>Key Rotational Reserve / Two-Way Specialist</option>
                        <option value="DEVELOPMENTAL" ${existingBid?.offer?.role === 'DEVELOPMENTAL' ? 'selected' : ''}>Developmental Prospect (Low expectation)</option>
                    </select>
                </div>

                <div>
                    <label class="block text-[10px] font-black uppercase tracking-wider text-slate-600 mb-1">
                        Offensive Focal Point Guarantee
                    </label>
                    <select id="fa-pitch-touches" class="w-full p-2 border border-slate-300 rounded font-bold text-slate-800 bg-white text-xs outline-none">
                        <option value="BALANCED" ${(existingBid?.offer?.promiseTouches === 'BALANCED' || !existingBid) ? 'selected' : ''}>Team-First / Balanced Touch Distribution</option>
                        <option value="FEATURED" ${existingBid?.offer?.promiseTouches === 'FEATURED' ? 'selected' : ''}>Featured Weapon (High targets & handoff share)</option>
                    </select>
                </div>

                <div>
                    <div class="flex justify-between items-center mb-1">
                        <label class="text-[10px] font-black uppercase tracking-wider text-slate-600">
                            Favor Token Sweetener
                        </label>
                        <span class="text-[10px] text-slate-500 font-mono">Available: <b>${Math.max(0, availableTokens)}</b></span>
                    </div>
                    <select id="fa-pitch-tokens" class="w-full p-2 border border-slate-300 rounded font-bold text-slate-800 bg-white text-xs outline-none">
                        <option value="0" ${(!existingBid || existingBid?.offer?.tokensOffered === 0) ? 'selected' : ''}>0 Tokens (Standard pitch)</option>
                        ${availableTokens >= 1 ? `<option value="1" ${existingBid?.offer?.tokensOffered === 1 ? 'selected' : ''}>1 Token (Bike lend, new gloves, playground concessions)</option>` : ''}
                        ${availableTokens >= 2 ? `<option value="2" ${existingBid?.offer?.tokensOffered === 2 ? 'selected' : ''}>2 Tokens (Substantial commitment & personal favors)</option>` : ''}
                        ${availableTokens >= 3 ? `<option value="3" ${existingBid?.offer?.tokensOffered === 3 ? 'selected' : ''}>3 Tokens (All-in neighborhood recruit)</option>` : ''}
                    </select>
                </div>
            </div>
        </div>
    `;

    showModal(`Recruit Prospect: ${player.name}`, modalHtml, () => {
        const role = document.getElementById('fa-pitch-role')?.value || 'STARTER';
        const promiseTouches = document.getElementById('fa-pitch-touches')?.value || 'BALANCED';
        const tokensOffered = parseInt(document.getElementById('fa-pitch-tokens')?.value || '0', 10);

        addOffseasonFABid({
            playerId: player.id,
            teamId: team.id,
            offer: { role, promiseTouches, tokensOffered }
        });

        renderOffseasonFAScreen(gs);
    }, existingBid ? "Update Offer" : "Submit Contract Offer");
};

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

        Game.ensureTeamCoachingStaff?.(team);

        const currentStaffCoaches = (
            Array.isArray(team.coaches) ? team.coaches : []
        ).filter(coach =>
            coach?.id != null && !coach.isUserCoach
        ).slice(0, 3);

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

                ${isHeadCoach ? `
                <div class="rounded border border-blue-200 bg-blue-50 p-3">
                    <label
                        for="staff-replacement-coach"
                        class="block text-[10px] font-black uppercase tracking-wider text-blue-900 mb-1">
                        Replace Which Coach?
                    </label>

                    <select
                        id="staff-replacement-coach"
                        class="w-full p-2 border border-blue-300 rounded bg-white text-xs font-bold text-slate-800">
                        ${currentStaffCoaches.map((coach, index) => `
                            <option value="${coach.id}">
                                ${coach.name || `Staff Coach ${index + 1}`}
                            </option>
                        `).join('')}
                    </select>

                    <p class="text-[10px] text-blue-800 mt-2">
                        The selected coach will return to the free-agent market
                        if this candidate accepts.
                    </p>
                </div>
                ` : ''}

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
                        <div class="flex justify-between items-center mb-1">
                            <label class="text-[10px] font-black uppercase tracking-wider text-slate-600">
                                Upfront Equipment & Coffee Stipend
                            </label>
                            <span class="text-[9px] font-mono text-emerald-700 font-bold">Fund: $${(team.finances?.balance || 0).toFixed(2)}</span>
                        </div>
                        <select id="staff-pitch-cash" class="w-full p-2 border border-slate-300 rounded font-bold text-slate-800 bg-white text-xs outline-none mb-2">
                            <option value="0">$0.00 (Volunteer / No upfront compensation)</option>
                            ${(team.finances?.balance || 0) >= 3 ? '<option value="3">$3.00 (Gas money / Whistle fund)</option>' : ''}
                            ${(team.finances?.balance || 0) >= 6 ? '<option value="6">$6.00 (New clipboard, cones & breakfast donuts)</option>' : ''}
                            ${(team.finances?.balance || 0) >= 10 ? '<option value="10">$10.00 (Full equipment bag & personal cooler)</option>' : ''}
                            ${(team.finances?.balance || 0) >= 15 ? '<option value="15">$15.00 (Premium sideline buyout)</option>' : ''}
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
            const cashOffered = parseFloat(document.getElementById('staff-pitch-cash')?.value || '0');
            const schemePromise = document.getElementById('staff-scheme-promise')?.value || 'GM_CHOICE';
            const practiceFocus = document.getElementById('staff-practice-focus')?.value || 'BALANCED';
            const replacementCoachId =
                document.getElementById('staff-replacement-coach')?.value || '';

            const pitch = {
                tokensOffered,
                cashOffered,
                schemePromise,
                practiceFocus,
                replacementCoachId
            };
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
                const activeCoaches = Array.isArray(team.coaches)
                    ? team.coaches
                    : [];

                let replacementCoachSlot = -1;
                let outgoingCoach = null;

                if (roleKey === 'coach') {
                    replacementCoachSlot = activeCoaches.findIndex(coach =>
                        coach &&
                        !coach.isUserCoach &&
                        replacementCoachId !== '' &&
                        String(coach.id) === String(replacementCoachId)
                    );

                    if (replacementCoachSlot < 0) {
                        showModal(
                            'Coach No Longer Available',
                            'The selected coach could not be found. Close this offer and select a current staff coach.',
                            null,
                            null,
                            null,
                            'Close'
                        );
                        return;
                    }

                    outgoingCoach = activeCoaches[replacementCoachSlot];
                }

                if (tokensOffered > 0) {
                    team.socialProfile.favorTokens = Math.max(0, team.socialProfile.favorTokens - tokensOffered);
                }
                if (cashOffered > 0 && team.finances) {
                    const balanceBeforeOffer = Math.max(
                        0,
                        Number(team.finances.balance) || 0
                    );
                    const cashActuallyPaid = Math.min(
                        balanceBeforeOffer,
                        cashOffered
                    );

                    team.finances.balance = balanceBeforeOffer - cashActuallyPaid;

                    const transactionYear = Number(gameState.year);
                    const transactionWeek = Number(gameState.currentWeek);

                    if (
                        cashActuallyPaid > 0 &&
                        Number.isInteger(transactionYear) &&
                        transactionYear >= 5 &&
                        Number.isInteger(transactionWeek)
                    ) {
                        if (!Array.isArray(team.finances.ledger)) {
                            team.finances.ledger = [];
                        }

                        const transactionCategory =
                            `staff_hire_${staff.id}_${Date.now()}_${team.finances.ledger.length}`;

                        team.finances.ledger.push({
                            key: `${transactionYear}:${transactionWeek}:${transactionCategory}`,
                            year: transactionYear,
                            week: transactionWeek,
                            category: transactionCategory,
                            label: `Staff offer: ${staff.name}`,
                            amount: -cashActuallyPaid,
                            balanceAfter: team.finances.balance
                        });

                        if (team.finances.ledger.length > 80) {
                            team.finances.ledger.splice(
                                0,
                                team.finances.ledger.length - 80
                            );
                        }
                    }
                }


                const oldStaff = team.staff?.[roleKey] || null;

                const returnToMarket = outgoingStaff => {
                    if (
                        !outgoingStaff ||
                        outgoingStaff.id == null ||
                        String(outgoingStaff.id) === String(staff.id)
                    ) {
                        return;
                    }

                    outgoingStaff.teamId = null;

                    if (!Array.isArray(gameState.availableStaff)) {
                        gameState.availableStaff = [];
                    }

                    const alreadyAvailable = gameState.availableStaff.some(
                        candidate =>
                            String(candidate.id) === String(outgoingStaff.id)
                    );

                    if (!alreadyAvailable) {
                        gameState.availableStaff.push(outgoingStaff);
                    }
                };

                if (roleKey === 'coach') {
                    returnToMarket(outgoingCoach);

                    const oldStaffStillCoaching = activeCoaches.some(
                        coach =>
                            coach &&
                            oldStaff?.id != null &&
                            String(coach.id) === String(oldStaff.id)
                    );

                    if (
                        oldStaff &&
                        !oldStaffStillCoaching &&
                        String(oldStaff.id) !== String(outgoingCoach?.id)
                    ) {
                        returnToMarket(oldStaff);
                    }
                } else {
                    returnToMarket(oldStaff);
                }

                const idx = gameState.availableStaff.findIndex(
                    candidate => String(candidate.id) === String(staffId)
                );

                if (idx > -1) {
                    gameState.availableStaff.splice(idx, 1);
                }

                staff.role = roleKey;
                staff.teamId = team.id;

                staff.role = roleKey;
                staff.teamId = team.id;

                if (!team.staff) {
                    team.staff = {};
                }

                const replacesLegacyLeadCoach =
                    roleKey === 'coach' &&
                    (
                        (
                            !team.coach?.id &&
                            !team.staff.coach?.id
                        ) ||
                        (
                            outgoingCoach?.id != null &&
                            (
                                String(team.coach?.id) ===
                                    String(outgoingCoach.id) ||
                                String(team.staff.coach?.id) ===
                                    String(outgoingCoach.id)
                            )
                        )
                    );

                if (
                    roleKey !== 'coach' ||
                    replacesLegacyLeadCoach
                ) {
                    team.staff[roleKey] = staff;
                }

                if (roleKey === 'coach') {
                    activeCoaches[replacementCoachSlot] = staff;
                    team.coaches = activeCoaches;

                    // Keep legacy Scout and Trainer references aligned
                    // with the current three-person coaching group.
                    const staffCoaches = activeCoaches
                        .filter(coach => coach && !coach.isUserCoach)
                        .slice(0, 3);

                    team.staff.scout = staffCoaches[1] || null;
                    team.staff.trainer = staffCoaches[2] || null;

                    if (replacesLegacyLeadCoach) {
                        team.coach = staff;
                        team.staff.coach = staff;
                    }

                    const assignments = team.staffWorkPlan?.assignments;

                    if (
                        Array.isArray(assignments) &&
                        outgoingCoach?.id != null
                    ) {
                        assignments.forEach(assignment => {
                            if (
                                String(assignment.coachId) ===
                                String(outgoingCoach.id)
                            ) {
                                assignment.coachId = String(staff.id);
                            }
                        });
                    }

                    if (
                        schemePromise === 'COACH_CHOICE' &&
                        staff.preferredOffense
                    ) {
                        team.formations.offense = staff.preferredOffense;
                    }

                    if (
                        schemePromise === 'COACH_CHOICE' &&
                        staff.preferredDefense
                    ) {
                        team.formations.defense = staff.preferredDefense;
                    }
                }

                const marketPane = document.getElementById('fo-pane-staff-market');

                if (marketPane && !marketPane.classList.contains('hidden')) {
                    renderStaffMarketTab(gameState);
                } else {
                    renderStaffTab(gameState);
                }

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

        <!-- Optional Automation -->
        <section class="mb-5 rounded-lg border border-blue-200 bg-blue-50/60 p-4">
            <div class="mb-3">
                <div class="flex items-center gap-2">
                    <h4 class="text-sm font-black uppercase tracking-wider text-slate-900">
                        Optional Automation
                    </h4>
                    <span class="rounded bg-blue-100 px-2 py-0.5 text-[9px] font-bold uppercase text-blue-700">
                        Your choice
                    </span>
                </div>
                <p class="mt-1 text-xs leading-relaxed text-slate-600">
                    Let your coaches handle routine weekly decisions, or keep
                    control yourself. You can change these settings at any time.
                </p>
            </div>

            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label class="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3">
                    <input
                        type="checkbox"
                        class="mt-1 h-4 w-4 shrink-0 accent-blue-600"
                        ${team.gameplan?.delegatePractice ? 'checked' : ''}
                        onchange="app_setManagementAutomation('delegatePractice', this.checked)"
                    >
                    <span>
                        <span class="block text-xs font-bold text-slate-800">
                            Delegate weekly practice
                        </span>
                        <span class="mt-1 block text-[11px] leading-relaxed text-slate-500">
                            Coaches choose the weekly practice focus for you.
                        </span>
                    </span>
                </label>

                <label class="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3">
                    <input
                        type="checkbox"
                        class="mt-1 h-4 w-4 shrink-0 accent-blue-600"
                        ${team.gameplan?.delegateGameplan ? 'checked' : ''}
                        onchange="app_setManagementAutomation('delegateGameplan', this.checked)"
                    >
                    <span>
                        <span class="block text-xs font-bold text-slate-800">
                            Delegate game planning
                        </span>
                        <span class="mt-1 block text-[11px] leading-relaxed text-slate-500">
                            Coaches manage the weekly offensive and defensive game plan.
                        </span>
                    </span>
                </label>
            </div>

            <p class="mt-3 text-[10px] leading-relaxed text-slate-500">
                Automation affects these decisions only. Your staff workload
                assignments and other team-management responsibilities remain
                under your control.
            </p>
        </section>

        <!-- 1. Current Coaching Group -->
    `;

    Game.ensureTeamCoachingStaff?.(team);

    // Migrate older staff records before their cards render.
    Game.ensureTeamStaffWorkPlan?.(team);

    const currentCoaches = Array.isArray(team.coaches)
        ? team.coaches.filter(Boolean)
        : [];

    const staffSkill = value => {
        if (value == null || value === '') return null;
        const number = Number(value);
        return Number.isFinite(number)
            ? Math.max(0, Math.min(100, Math.round(number)))
            : null;
    };

        const staffAverage = (...values) => {
        const valid = values.map(staffSkill)
            .filter(value => value !== null);

        return valid.length
            ? Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length)
            : null;
    };

    const developmentWorkPlan = Game.ensureTeamStaffWorkPlan?.(team);
    const developmentAssignments = Array.isArray(
        developmentWorkPlan?.assignments
    )
        ? developmentWorkPlan.assignments
        : [];

    const currentYear = Number(gameState.year);
    const currentWeek = Number(gameState.currentWeek);

    const developmentRows = currentCoaches.map(coach => {
        const development = coach.development || {};
        const history = Array.isArray(development.history)
            ? development.history
            : [];

        const latest = [...history].sort((a, b) =>
            (Number(b.year) - Number(a.year)) ||
            (Number(b.week) - Number(a.week))
        )[0] || null;

        const assignedHours = developmentAssignments.reduce(
            (sum, assignment) =>
                String(assignment.coachId) === String(coach.id)
                    ? sum + Math.max(0, Number(assignment.hours) || 0)
                    : sum,
            0
        );

        const progressBySkill = development.progressBySkill || {};
        const skillCeilings = development.skillCeilings || {};
        const ratings = coach.ratings || {};

        const hasAccumulatedProgress = Object.entries(
            progressBySkill
        ).some(([skill, progress]) => {
            const ceiling = Number(skillCeilings[skill]);
            const rating = Number(ratings[skill]);

            return Number(progress) > 0 &&
                (
                    !Number.isFinite(ceiling) ||
                    !Number.isFinite(rating) ||
                    rating < ceiling
                );
        });

        const remainingGrowth = Number(
            development.remainingGrowthPoints
        );

        let weeksSinceImprovement = null;
        if (
            latest &&
            Number(latest.year) === currentYear &&
            Number.isFinite(currentWeek) &&
            Number.isFinite(Number(latest.week))
        ) {
            weeksSinceImprovement = Math.max(
                0,
                currentWeek - Number(latest.week)
            );
        }

        let status = 'No recorded skill increase yet';

        if (
            Number.isFinite(remainingGrowth) &&
            remainingGrowth <= 0
        ) {
            status = 'Career growth budget exhausted';
        } else if (hasAccumulatedProgress) {
            status = 'Progress accumulating';
        }

        if (
            Number.isFinite(remainingGrowth) &&
            remainingGrowth > 0 &&
            latest &&
            Number.isFinite(currentYear) &&
            Number(latest.year) < currentYear
        ) {
            status = 'No increase recorded this season';
        } else if (weeksSinceImprovement !== null) {
            if (weeksSinceImprovement >= 6) {
                status = `No increase in ${weeksSinceImprovement} weeks`;
            } else if (weeksSinceImprovement <= 4) {
                status = weeksSinceImprovement === 0
                    ? 'Improved this week'
                    : `Improved ${weeksSinceImprovement} week${weeksSinceImprovement === 1 ? '' : 's'} ago`;
            } else {
                status = 'Awaiting next increase';
            }
        }

        return {
            id: coach.id,
            name: coach.name || 'Unnamed Coach',
            improvements: history.length,
            latest,
            assignedHours,
            status,
            weeksSinceImprovement
        };
    });

    const totalRecordedImprovements = developmentRows.reduce(
        (sum, row) => sum + row.improvements,
        0
    );

    const recentlyImprovedCoaches = developmentRows.filter(
        row =>
            row.weeksSinceImprovement !== null &&
            row.weeksSinceImprovement <= 4
    ).length;

    const coachesWithAssignments = developmentRows.filter(
        row => row.assignedHours > 0
    ).length;

    const developmentSummaryHtml = `
        <section class="mb-5 rounded-lg border border-slate-300 bg-white p-4 shadow-sm">
            <div class="mb-3">
                <h4 class="font-black text-sm uppercase tracking-wide text-slate-900">
                    Staff Development Overview
                </h4>
                <p class="text-xs text-slate-500 mt-1">
                    Track recorded skill increases alongside the current weekly workload.
                </p>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
                <div class="rounded border border-slate-200 bg-slate-50 p-3">
                    <p class="text-[10px] uppercase tracking-wide text-slate-500">
                        Recorded Increases
                    </p>
                    <p class="text-2xl font-black text-slate-900">
                        ${totalRecordedImprovements}
                    </p>
                    <p class="text-[10px] text-slate-500">
                        Across the current coaching staff
                    </p>
                </div>

                <div class="rounded border border-slate-200 bg-slate-50 p-3">
                    <p class="text-[10px] uppercase tracking-wide text-slate-500">
                        Recent Improvements
                    </p>
                    <p class="text-2xl font-black text-emerald-700">
                        ${recentlyImprovedCoaches}/${developmentRows.length}
                    </p>
                    <p class="text-[10px] text-slate-500">
                        Improved in the last four weeks
                    </p>
                </div>

                <div class="rounded border border-slate-200 bg-slate-50 p-3">
                    <p class="text-[10px] uppercase tracking-wide text-slate-500">
                        Assigned Work
                    </p>
                    <p class="text-2xl font-black text-blue-700">
                        ${coachesWithAssignments}/${developmentRows.length}
                    </p>
                    <p class="text-[10px] text-slate-500">
                        Coaches with weekly hours assigned
                    </p>
                </div>
            </div>

            <div class="space-y-2">
                ${developmentRows.map(row => `
                    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
                        <div class="min-w-0">
                            <p class="text-xs font-bold text-slate-800">
                                ${row.name}
                            </p>
                            <p class="text-[10px] text-slate-500">
                                ${row.latest
                                    ? `Last increase: Year ${row.latest.year}, Week ${row.latest.week}`
                                    : 'No improvement recorded yet'}
                                · ${row.improvements} total
                            </p>
                        </div>

                        <div class="flex flex-wrap items-center gap-2">
                            <span class="text-[10px] font-semibold ${
                                row.weeksSinceImprovement !== null &&
                                row.weeksSinceImprovement >= 6
                                    ? 'text-amber-700'
                                    : 'text-slate-600'
                            }">
                                ${row.status}
                            </span>
                            <span class="rounded bg-slate-100 px-2 py-1 text-[10px] font-mono text-slate-700">
                                ${row.assignedHours}/40 hrs
                            </span>
                        </div>
                    </div>
                `).join('')}
            </div>

            <p class="mt-3 text-[10px] leading-relaxed text-slate-500">
                Weekly hours reflect current assignments, while improvements are historical.
                They help you compare workload and outcomes but do not prove that the current
                assignments caused a past increase.
            </p>
        </section>
    `;

    html += `
        <section class="mb-6">
            <h4 class="font-black text-base uppercase text-slate-900 mb-1">
                Coaching Staff
            </h4>
                        <p class="text-sm text-slate-600 mb-4">
                Compare strengths and assign weekly responsibilities below.
            </p>

            ${developmentSummaryHtml}

            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                ${currentCoaches.map((coach, index) => {
                    const r = coach.ratings || {};

                    const availability = coach.availability || {};

                    const rawWeeklyHours = availability.weeklyHours;
                    const parsedWeeklyHours = Number(rawWeeklyHours);

                    const weeklyHours =
                        rawWeeklyHours != null &&
                        Number.isFinite(parsedWeeklyHours)
                            ? Math.max(0, Math.min(40, Math.floor(parsedWeeklyHours)))
                            : null;

                    const availableDays = Array.isArray(availability.availableDays)
                        ? availability.availableDays
                            .filter(day => typeof day === 'string' && day.trim())
                        : [];

                    const daysLabel = availableDays.length
                        ? availableDays.join(' · ')
                        : 'Not specified';

                    const timeWindowLabels = {
                        evening: 'Evenings',
                        daytime: 'Daytime',
                        mixed: 'Mixed availability',
                        flexible: 'Flexible hours'
                    };

                    const scheduleLabel =
                        availability.scheduleLabel || 'Schedule not set';

                    const timeWindowLabel =
                        timeWindowLabels[availability.timeWindow] ||
                        'Not specified';

                    const rawReliability = availability.reliability;
                    const parsedReliability = Number(rawReliability);

                    const reliability =
                        rawReliability != null &&
                        Number.isFinite(parsedReliability)
                            ? Math.max(0, Math.min(100, Math.round(parsedReliability)))
                            : null;

                    const escapeStaffCardText = value =>
                        String(value ?? '').replace(/[&<>"']/g, char => ({
                            '&': '&amp;',
                            '<': '&lt;',
                            '>': '&gt;',
                            '"': '&quot;',
                            "'": '&#39;'
                        })[char]);

                    const skills = [
                        ['Offense Scheme', staffSkill(r.offSchemeMastery), 'bg-emerald-500'],
                        ['Defense Scheme', staffSkill(r.defSchemeMastery), 'bg-blue-500'],
                        ['Player Evaluation', staffAverage(r.evalPhysicals, r.evalTechnique, r.evalCharacter), 'bg-violet-500'],
                        ['Teaching', staffSkill(r.teaching), 'bg-amber-500'],
                        ['Game Planning', staffAverage(r.gameplanInstinct, r.inGameAdjustments), 'bg-sky-500'],
                        ['Practice', staffAverage(r.practiceDiscipline, r.conditioning), 'bg-rose-500']
                    ];

                                        const rated = skills.filter(skill => skill[1] !== null);
                    const overall = staffAverage(...rated.map(skill => skill[1]));
                    const strongest = [...rated].sort(
                        (a, b) => b[1] - a[1]
                    )[0];

                    const development = coach.development || {};
                    const recentDevelopmentHistory = Array.isArray(
                        development.history
                    )
                        ? development.history.slice(-5).reverse()
                        : [];
                    const skillCeilings = development.skillCeilings || {};
                    const progressBySkill = development.progressBySkill || {};

                    const growthSkillLabels = {
                        offSchemeMastery: 'Offense Scheme',
                        defSchemeMastery: 'Defense Scheme',
                        evalPhysicals: 'Physical Evaluation',
                        evalTechnique: 'Technique Evaluation',
                        evalCharacter: 'Character Evaluation',
                        teaching: 'Teaching',
                        gameplanInstinct: 'Game Planning',
                        inGameAdjustments: 'In-Game Adjustments',
                        practiceDiscipline: 'Practice Discipline',
                        conditioning: 'Conditioning'
                    };

                    const remainingGrowth = Number(
                        development.remainingGrowthPoints
                    );

                    const growthOutlook = !Number.isFinite(remainingGrowth)
                        ? 'Not yet established'
                        : remainingGrowth >= 12
                            ? 'High development runway'
                            : remainingGrowth >= 6
                                ? 'Moderate development runway'
                                : remainingGrowth > 0
                                    ? 'Limited development runway'
                                    : 'Career growth budget exhausted';

                    const nextGrowth = Object.entries(progressBySkill)
                        .map(([skill, progress]) => ({
                            skill,
                            label: growthSkillLabels[skill],
                            progress: Math.max(0, Number(progress) || 0),
                            rating: Number(r[skill]),
                            ceiling: Number(skillCeilings[skill])
                        }))
                        .filter(item =>
                            item.label &&
                            Number.isFinite(item.rating) &&
                            Number.isFinite(item.ceiling) &&
                            item.rating < item.ceiling &&
                            remainingGrowth > 0
                        )
                        .sort((a, b) => b.progress - a.progress)[0];

                    const growthProgress = nextGrowth
                        ? Math.min(100, Math.floor(nextGrowth.progress))
                        : 0;

                    const staffNumber = currentCoaches
                        .slice(0, index + 1)
                        .filter(c => !c.isUserCoach).length;

                    return `
                        <article class="bg-white rounded-lg border border-slate-300 shadow-sm overflow-hidden">
                            <div class="bg-slate-50 border-b border-slate-200 p-4">
                                <span class="text-[10px] font-black uppercase tracking-widest text-blue-700">
                                    ${coach.isUserCoach ? 'Your Coaching Profile' : `Staff Coach ${staffNumber}`}
                                </span>
                                <div class="flex justify-between items-center gap-2 mt-1">
                                    <h5 class="font-black text-lg text-slate-900">
                                        ${coach.name || 'Unnamed Coach'}
                                    </h5>
                                    <span class="text-lg font-black text-slate-900">
                                        ${overall ?? '—'}
                                    </span>
                                </div>
                                <p class="text-[10px] text-slate-500">Overall skill average</p>

                                ${strongest ? `
                                    <div class="mt-3 text-xs font-bold text-emerald-900 bg-emerald-50 border border-emerald-200 rounded p-2">
                                        Strongest: ${strongest[0]} (${strongest[1]})
                                    </div>
                                ` : ''}
                            </div>

                            <div class="p-4 space-y-3">
                                                                ${skills.map(([label, value, color]) => `
                                    <div>
                                        <div class="flex justify-between items-center gap-2 mb-1">
                                            <span class="text-xs font-semibold text-slate-700">${label}</span>
                                            <span class="text-sm font-black text-slate-900">
                                                ${value ?? '—'}
                                            </span>
                                        </div>
                                        <div class="h-2.5 rounded-full bg-slate-200 overflow-hidden">
                                            <div class="h-full rounded-full ${color}"
                                                style="width:${value ?? 0}%">
                                            </div>
                                        </div>
                                    </div>
                                `).join('')}

                                <details class="mt-3 rounded-lg border border-slate-200 bg-slate-50">
                                    <summary class="cursor-pointer list-none flex items-center justify-between gap-2 px-3 py-2.5 text-xs font-bold text-slate-700">
                                        <span>More coach details</span>
                                        <span class="text-[10px] font-semibold text-slate-500">
                                            Development · History · Availability
                                        </span>
                                    </summary>

                                    <div class="px-3 pb-3 space-y-3">
                                <div class="rounded-lg border border-sky-200 bg-sky-50 p-3">
                                    <div class="flex justify-between items-start gap-2">
                                        <div>
                                            <h6 class="text-[10px] font-black uppercase tracking-wide text-sky-900">
                                                Coach Development
                                            </h6>
                                            <p class="text-xs font-bold text-sky-950 mt-1">
                                                ${growthOutlook}
                                            </p>
                                        </div>
                                        <span class="text-[10px] font-semibold text-sky-800">
                                            ${development.experienceWeeks || 0} weeks
                                        </span>
                                    </div>

                                    ${nextGrowth ? `
                                        <div class="mt-3">
                                            <div class="flex justify-between items-center gap-2 mb-1">
                                                <span class="text-[11px] font-semibold text-slate-700">
                                                    Next: ${nextGrowth.label}
                                                </span>
                                                <span class="text-[10px] font-bold text-sky-900">
                                                    ${growthProgress}/100
                                                </span>
                                            </div>
                                            <div class="h-2 rounded-full bg-sky-100 overflow-hidden">
                                                <div
                                                    class="h-full rounded-full bg-sky-500"
                                                    style="width:${growthProgress}%">
                                                </div>
                                            </div>
                                            ${growthProgress >= 100 ? `
                                                <p class="text-[10px] text-sky-800 mt-1">
                                                    Ready for the weekly development check.
                                                </p>
                                            ` : ''}
                                        </div>
                                    ` : `
                                        <p class="text-[10px] text-sky-800 mt-2">
                                            ${remainingGrowth <= 0
                                                ? 'This coach has used their lifetime growth budget.'
                                                : 'Skill-specific progress will appear as the coach gains experience in assigned work.'}
                                        </p>
                                    `}
                                </div>

                                <div class="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                                    <div class="flex items-center justify-between gap-2">
                                        <h6 class="text-[10px] font-black uppercase tracking-wide text-slate-700">
                                            Development History
                                        </h6>
                                        <span class="text-[10px] text-slate-500">
                                            ${recentDevelopmentHistory.length} recent
                                        </span>
                                    </div>

                                    ${recentDevelopmentHistory.length > 0 ? `
                                        <div class="mt-3 space-y-2">
                                            ${recentDevelopmentHistory.map(entry => `
                                                <div class="flex items-center justify-between gap-3 border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
                                                    <div class="min-w-0">
                                                        <div class="text-xs font-bold text-slate-800">
                                                            ${growthSkillLabels[entry.skill] || entry.skill}
                                                        </div>
                                                        <div class="text-[10px] text-slate-500">
                                                            Year ${entry.year}, Week ${entry.week}
                                                        </div>
                                                    </div>

                                                    <div class="shrink-0 text-right">
                                                        <div class="text-xs font-black text-emerald-700">
                                                            ${entry.previousRating} → ${entry.newRating}
                                                        </div>
                                                        <div class="text-[9px] font-semibold text-slate-500">
                                                            Skill improved
                                                        </div>
                                                    </div>
                                                </div>
                                            `).join('')}
                                        </div>
                                    ` : `
                                        <p class="mt-2 text-xs text-slate-500">
                                            No skill improvements recorded yet.
                                        </p>
                                    `}
                                </div>

                                <div class="border-t border-slate-200 pt-3 space-y-2 text-xs">
                                    <div>
                                        <span class="text-slate-500">Tactical style</span>
                                        <p class="font-bold text-slate-800">
                                            ${coach.biases?.tactical?.name || 'Balanced'}
                                        </p>
                                    </div>
                                    <div>
                                        <span class="text-slate-500">Scouting style</span>
                                        <p class="font-bold text-slate-800">
                                            ${coach.biases?.scouting?.name || 'Balanced Evaluator'}
                                        </p>
                                    </div>
                                    <div>
                                        <span class="text-slate-500">Personality</span>
                                        <p class="font-bold text-slate-800">
                                            ${coach.biases?.personality?.name || 'Balanced'}
                                        </p>
                                    </div>
                                </div>

                                <div class="border-t border-slate-200 pt-3 space-y-3">
                                    <div class="flex items-start justify-between gap-2">
                                        <div>
                                            <span class="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                                Weekly availability
                                            </span>
                                            <p class="mt-1 text-sm font-black text-slate-900">
                                                ${weeklyHours === null ? 'Not set' : `${weeklyHours} hrs/week`}
                                            </p>
                                        </div>

                                        <span class="shrink-0 rounded bg-blue-50 border border-blue-200 px-2 py-1 text-[10px] font-bold text-blue-700">
                                            ${escapeStaffCardText(timeWindowLabel)}
                                        </span>
                                    </div>

                                    <div>
                                        <span class="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                            Preferred schedule
                                        </span>
                                        <p class="mt-1 text-xs font-semibold text-slate-800">
                                            ${escapeStaffCardText(scheduleLabel)}
                                        </p>
                                        <p class="mt-1 text-[11px] leading-relaxed text-slate-500">
                                            ${escapeStaffCardText(daysLabel)}
                                        </p>
                                    </div>

                                    <div>
                                        <div class="flex items-center justify-between gap-2 mb-1">
                                            <span class="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                                Reliability
                                            </span>
                                            <span class="text-xs font-black text-slate-800">
                                                ${reliability === null ? 'Not set' : `${reliability}%`}
                                            </span>
                                        </div>

                                        <div
                                            class="h-2 rounded-full bg-slate-200 overflow-hidden"
                                            role="progressbar"
                                            aria-label="Staff reliability"
                                            aria-valuemin="0"
                                            aria-valuemax="100"
                                            aria-valuenow="${reliability ?? 0}"
                                        >
                                            <div
                                                class="h-full rounded-full bg-emerald-500"
                                                style="width: ${reliability ?? 0}%"
                                            ></div>
                                        </div>

                                        <p class="mt-1 text-[10px] leading-relaxed text-slate-500">
                                            Likelihood of following through on assigned commitments. Actual effects come in the next patch.
                                        </p>
                                    </div>
                                </div>
                                    </div>
                                </details>
                            </div>
                        </article>
                    `;
                }).join('')}
            </div>
        </section>
    `;

    // 2. Weekly Staff Workload
    const workCoaches = Game.ensureTeamCoachingStaff?.(team) ||
        (Array.isArray(team.coaches) ? team.coaches : []);
    const workPlan = Game.ensureTeamStaffWorkPlan?.(team);

    if (workPlan && Array.isArray(workPlan.assignments)) {
        const taskLabels = {
            scouting: 'Prospect Scouting',
            training: 'Player Development',
            offensePrep: 'Offensive Preparation',
            defensePrep: 'Defensive Preparation'
        };

        const focusOptions = {
            scouting: [
                ['all', 'General scouting'],
                ['watchlist', 'Watchlist targets'],
                ['draft', 'Draft prospects'],
                ['freeAgents', 'Free agents'],
                ['opponents', 'Players on other teams']
            ],
            training: [
                ['all', 'All position groups'],
                ['offense', 'Offense'],
                ['defense', 'Defense'],
                ['QB', 'Quarterbacks'],
                ['RB', 'Running backs'],
                ['WR', 'Wide receivers'],
                ['TE', 'Tight ends'],
                ['OL', 'Offensive line'],
                ['DL', 'Defensive line'],
                ['LB', 'Linebackers'],
                ['DB', 'Defensive backs']
            ]
        };

        const skillOptions = [
            ['', 'Automatic skill focus'],
            ['speed', 'Speed'],
            ['strength', 'Strength'],
            ['agility', 'Agility'],
            ['explosiveness', 'Explosiveness'],
            ['jumping', 'Jumping'],
            ['stamina', 'Stamina'],
            ['playbookIQ', 'Playbook IQ'],
            ['clutch', 'Clutch'],
            ['consistency', 'Consistency'],
            ['toughness', 'Toughness'],
            ['decisionMaking', 'Decision making'],
            ['throwingAccuracy', 'Throwing accuracy'],
            ['throwPower', 'Throw power'],
            ['catchingHands', 'Hands'],
            ['carrying', 'Ball security'],
            ['tackling', 'Tackling'],
            ['blocking', 'Blocking'],
            ['blockShedding', 'Block shedding'],
            ['coverage', 'Coverage']
        ];

        const getPreparationPlayKeys = (task, targetTeam = team) => {
            const isOffense = task === 'offensePrep';
            if (!isOffense && task !== 'defensePrep') return [];

            const foundationKeys = isOffense
                ? [
                    'Uni_InsideZone',
                    'Uni_StretchRight',
                    'Uni_QuickSlants',
                    'Uni_FourVerts'
                ]
                : [
                    'Cover_2_Zone_Base',
                    'Cover_1_Robber',
                    'Man_Blitz_Base',
                    'GoalLine_RunStuff'
                ];

            const installedKeys = isOffense
                ? targetTeam?.gameplan?.installedOffense
                : targetTeam?.gameplan?.installedDefense;

            return [
                ...new Set([
                    ...foundationKeys,
                    ...(Array.isArray(installedKeys)
                        ? installedKeys.slice(0, 8)
                        : [])
                ])
            ];
        };

        const getDefaultPreparationPlayKeys = (
            task,
            targetTeam = team
        ) => {
            const available = getPreparationPlayKeys(task, targetTeam);
            const isOffense = task === 'offensePrep';

            if (!available.length) return [];

            const installedKeys = isOffense
                ? targetTeam?.gameplan?.installedOffense
                : targetTeam?.gameplan?.installedDefense;

            const foundationKeys = isOffense
                ? [
                    'Uni_InsideZone',
                    'Uni_StretchRight',
                    'Uni_QuickSlants',
                    'Uni_FourVerts'
                ]
                : [
                    'Cover_2_Zone_Base',
                    'Cover_1_Robber',
                    'Man_Blitz_Base',
                    'GoalLine_RunStuff'
                ];

            const priorityInstalled = [
                ...new Set(
                    (Array.isArray(installedKeys) ? installedKeys : [])
                        .slice(0, 8)
                        .filter(key => available.includes(key))
                )
            ].slice(0, 4);

            const foundationFallback = foundationKeys
                .filter(key =>
                    available.includes(key) &&
                    !priorityInstalled.includes(key)
                )
                .slice(0, 4 - priorityInstalled.length);

            return [...priorityInstalled, ...foundationFallback];
        };

        const getPreparationPlayOptions = (task, targetTeam = team) => {
            const isOffense = task === 'offensePrep';
            const playbook = isOffense
                ? offensivePlaybook
                : defensivePlaybook;

            const installedKeys = isOffense
                ? targetTeam?.gameplan?.installedOffense || []
                : targetTeam?.gameplan?.installedDefense || [];

            return getPreparationPlayKeys(task, targetTeam).map(key => [
                key,
                `${playbook[key]?.name || key} (${
                    installedKeys.includes(key)
                        ? 'Installed'
                        : 'Foundation'
                })`
            ]);
        };

        const workHours = assignment =>
            Math.max(0, Number(assignment.hours) || 0);

        // Respect each coach's personal weekly time commitment.
        // The 8-hour fallback is for staff profiles not yet migrated
        // to the availability model.
        const getCoachWeeklyCapacity = coach => {
            const planCap = Math.min(
                40,
                Number(workPlan.weeklyHoursPerCoach) || 40
            );

            const statedAvailability =
                coach?.availability?.weeklyHours ??
                coach?.weeklyHoursAvailable ??
                coach?.weeklyCommitmentHours;

            const availableHours = statedAvailability == null
                ? 8
                : Number(statedAvailability);

            return Math.max(
                0,
                Math.min(
                    planCap,
                    Math.floor(
                        Number.isFinite(availableHours)
                            ? availableHours
                            : 8
                    )
                )
            );
        };

        const getCoachHours = coachId =>
            workPlan.assignments.reduce(
                (sum, assignment) =>
                    String(assignment.coachId) === String(coachId)
                        ? sum + workHours(assignment)
                        : sum,
                0
            );


        const renderOptions = (options, selectedValue) =>
            options.map(([value, label]) => `
                <option value="${value}" ${
                    String(value) === String(selectedValue ?? '')
                        ? 'selected'
                        : ''
                }>${label}</option>
            `).join('');

        window.app_setManagementAutomation = (setting, enabled) => {
            const gs = getGameState();
            const currentTeam = gs?.playerTeam;

            const allowedSettings = new Set([
                'delegatePractice',
                'delegateGameplan'
            ]);

            if (!currentTeam || !allowedSettings.has(setting)) return;

            if (!currentTeam.gameplan) {
                currentTeam.gameplan = {};
            }

            currentTeam.gameplan[setting] = Boolean(enabled);

            saveGameState();
            renderStaffTab(gs);
        };                

        window.app_autoAssignStaffWorkload = () => {
            const gs = getGameState();
            const currentTeam = gs?.playerTeam;
            if (!currentTeam) return;

            const plan = Game.ensureTeamStaffWorkPlan?.(currentTeam);
            const coaches = Game.ensureTeamCoachingStaff?.(currentTeam) ||
                currentTeam.coaches || [];

            if (!plan || !Array.isArray(plan.assignments)) return;

            const taskSkills = {
                scouting: [
                    'evalPhysicals',
                    'evalTechnique',
                    'evalCharacter'
                ],
                training: [
                    'teaching',
                    'practiceDiscipline',
                    'conditioning'
                ],
                offensePrep: [
                    'offSchemeMastery',
                    'gameplanInstinct',
                    'inGameAdjustments'
                ],
                defensePrep: [
                    'defSchemeMastery',
                    'gameplanInstinct',
                    'inGameAdjustments'
                ]
            };

            const tasks = Object.keys(taskSkills);
            const week = Math.max(0, Number(gs.currentWeek) || 0);

            // Prioritize scouting around the draft, and preparation
            // during the regular season.
            const taskNeeds = week === 0
                ? {
                    scouting: 1.45,
                    training: 1.00,
                    offensePrep: 0.85,
                    defensePrep: 0.85
                }
                : week <= 9
                    ? {
                        scouting: 0.85,
                        training: 1.10,
                        offensePrep: 1.25,
                        defensePrep: 1.25
                    }
                    : {
                        scouting: 1.15,
                        training: 1.10,
                        offensePrep: 0.85,
                        defensePrep: 0.85
                    };

            const getTaskSkill = (coach, task) => {
                const ratings = coach?.ratings || {};
                const skills = taskSkills[task];

                const values = skills.map(key => {
                    const value = Number(ratings[key]);

                    return Number.isFinite(value)
                        ? Math.max(0, Math.min(100, value))
                        : 50;
                });

                return values.reduce((sum, value) => sum + value, 0) /
                    values.length;
            };

            const buildAssignments = () => {
                const assignments = [];

                coaches
                    .filter(coach => coach?.id != null)
                    .forEach(coach => {
                        const capacity = getCoachWeeklyCapacity(coach);

                        if (capacity <= 0) return;

                        // Stronger coaches lean toward their specialties,
                        // while every task can still receive some coverage.
                        const weights = tasks.map(task => {
                            const skillScore = getTaskSkill(coach, task);

                            return {
                                task,
                                weight: taskNeeds[task] *
                                    (0.5 + skillScore / 100)
                            };
                        });

                        const totalWeight = weights.reduce(
                            (sum, item) => sum + item.weight,
                            0
                        );

                        if (totalWeight <= 0) return;

                        const allocations = weights.map(item => {
                            const exactHours =
                                capacity * item.weight / totalWeight;

                            return {
                                task: item.task,
                                hours: Math.floor(exactHours),
                                remainder: exactHours -
                                    Math.floor(exactHours)
                            };
                        });

                        let remaining = capacity - allocations.reduce(
                            (sum, item) => sum + item.hours,
                            0
                        );

                        allocations
                            .slice()
                            .sort((a, b) => b.remainder - a.remainder)
                            .forEach(item => {
                                if (remaining <= 0) return;

                                const allocation = allocations.find(
                                    candidate => candidate.task === item.task
                                );

                                allocation.hours++;
                                remaining--;
                            });

                        allocations.forEach(allocation => {
                            if (allocation.hours <= 0) return;

                            const assignment = {
                                coachId: String(coach.id),
                                task: allocation.task,
                                hours: allocation.hours,
                                focus: 'all'
                            };

                            if (allocation.task === 'scouting') {
                                assignment.focus = week === 0
                                    ? 'draft'
                                    : 'all';
                                assignment.maxTargets = 2;
                            }

                            if (allocation.task === 'training') {
                                assignment.maxTargets = 4;
                            }

                            assignments.push(assignment);
                        });
                    });

                return assignments;
            };

            showModal(
                'Auto-assign staff workload?',
                `
                    <div class="space-y-2 text-sm text-slate-700">
                        <p>
                            The assistant will distribute available hours
                            across scouting, player development, and offensive
                            and defensive preparation.
                        </p>
                        <p>
                            Each coach's recorded weekly availability and
                            skill ratings will guide the assignments.
                        </p>
                        <p class="font-semibold text-amber-800">
                            Your existing workload assignments will be replaced.
                            You can edit the new assignments afterward.
                        </p>
                    </div>
                `,
                () => {
                    const latestState = getGameState();
                    const latestTeam = latestState?.playerTeam;
                    const latestPlan =
                        Game.ensureTeamStaffWorkPlan?.(latestTeam);

                    if (!latestTeam || !latestPlan ||
                        !Array.isArray(latestPlan.assignments)) {
                        return;
                    }

                    latestPlan.assignments = buildAssignments();

                    latestPlan.autoAssignedFor = {
                        year: latestState.year ?? null,
                        week: latestState.currentWeek ?? null
                    };

                    saveGameState();
                    renderStaffTab(latestState);

                    const workloadSection = document.getElementById(
                        'staff-workload-assignments'
                    );

                    workloadSection?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                },
                'Auto-assign',
                null,
                'Cancel'
            );
        };

        window.app_addStaffWorkAssignment = () => {
            const gs = getGameState();
            const currentTeam = gs?.playerTeam;
            if (!currentTeam) return;

            const plan = Game.ensureTeamStaffWorkPlan?.(currentTeam);
            const coaches = Game.ensureTeamCoachingStaff?.(currentTeam) ||
                currentTeam.coaches || [];

            if (!plan || !Array.isArray(plan.assignments)) return;

            const availableCoach = coaches.find(
                coach => coach?.id &&
                    getCoachHours(coach.id) < getCoachWeeklyCapacity(coach)
            );

            if (!availableCoach) return;

            const remainingHours = Math.max(
                0,
                getCoachWeeklyCapacity(availableCoach) -
                    getCoachHours(availableCoach.id)
            );

            plan.assignments.push({
                coachId: String(availableCoach.id),
                task: 'scouting',
                hours: Math.min(4, remainingHours),
                focus: 'all',
                maxTargets: 1
            });

            saveGameState();
            renderStaffTab(gs);
        };

        window.app_removeStaffWorkAssignment = index => {
            const gs = getGameState();
            const currentTeam = gs?.playerTeam;
            const plan = currentTeam?.staffWorkPlan;

            if (!plan || !Array.isArray(plan.assignments)) return;
            if (!Number.isInteger(index) ||
                index < 0 ||
                index >= plan.assignments.length) {
                return;
            }

            plan.assignments.splice(index, 1);
            saveGameState();
            renderStaffTab(gs);
        };

        window.app_updateStaffWorkAssignment = (index, field, value) => {
            const gs = getGameState();
            const currentTeam = gs?.playerTeam;
            const plan = currentTeam?.staffWorkPlan;

            if (!plan || !Array.isArray(plan.assignments)) return;
            if (!Number.isInteger(index) ||
                index < 0 ||
                index >= plan.assignments.length) {
                return;
            }

            const assignment = plan.assignments[index];
            const allowedFields = new Set([
                'coachId',
                'task',
                'hours',
                'focus',
                'skill',
                'maxTargets',
                'opponentTeamId'
            ]);

            if (!allowedFields.has(field)) return;

            if (field === 'coachId') {
                const validCoach = currentTeam.coaches?.some(
                    coach => String(coach.id) === String(value)
                );
                if (!validCoach) return;

                assignment.coachId = String(value);
            } else if (field === 'task') {
                if (!Object.prototype.hasOwnProperty.call(taskLabels, value)) {
                    return;
                }
                assignment.task = value;
                assignment.focus = 'all';
                delete assignment.skill;
                delete assignment.opponentTeamId;
                delete assignment.playKeys;
            } else if (field === 'hours') {
                const requestedHours = Number(value);

                if (!Number.isFinite(requestedHours)) return;

                const otherHours = plan.assignments.reduce(
                    (sum, other, otherIndex) =>
                        otherIndex !== index &&
                        String(other.coachId) === String(assignment.coachId)
                            ? sum + workHours(other)
                            : sum,
                    0
                );

                const assignedCoach = workCoaches.find(
                    coach => String(coach.id) === String(assignment.coachId)
                );

                const cap = getCoachWeeklyCapacity(assignedCoach);

                assignment.hours = Math.max(
                    0,
                    Math.min(
                        cap - otherHours,
                        Math.floor(requestedHours)
                    )
                );
            } else if (field === 'maxTargets') {
                const targets = Number(value);
                if (!Number.isInteger(targets) || targets < 1 || targets > 12) {
                    return;
                }
                assignment.maxTargets = targets;
            } else if (field === 'skill') {
                if (value && !skillOptions.some(option => option[0] === value)) {
                    return;
                }

                if (value) assignment.skill = value;
                else delete assignment.skill;
            } else if (field === 'focus') {
                const validOptions = focusOptions[assignment.task] || [];

                if (!validOptions.some(option => option[0] === value)) {
                    return;
                }

                assignment.focus = value;
            } else if (field === 'opponentTeamId') {
                const validOpponent = gs.teams?.some(
                    otherTeam =>
                        String(otherTeam.id) === String(value) &&
                        otherTeam.id !== currentTeam.id
                );

                if (value && !validOpponent) return;

                if (value) assignment.opponentTeamId = String(value);
                else delete assignment.opponentTeamId;
            }

            // Enforce the shared 40-hour budget after coach reassignment too.
            const assignedCoach = workCoaches.find(
                coach => String(coach.id) === String(assignment.coachId)
            );

            const cap = getCoachWeeklyCapacity(assignedCoach);
            const otherHours = plan.assignments.reduce(
                (sum, other, otherIndex) =>
                    otherIndex !== index &&
                    String(other.coachId) === String(assignment.coachId)
                        ? sum + workHours(other)
                        : sum,
                0
            );

            assignment.hours = Math.max(
                0,
                Math.min(workHours(assignment), cap - otherHours)
            );

            saveGameState();
            renderStaffTab(gs);
                };

        window.app_toggleStaffWorkPlay = (index, playKey, checked) => {
            const gs = getGameState();
            const currentTeam = gs?.playerTeam;
            const plan = currentTeam?.staffWorkPlan;

            if (
                !plan ||
                !Array.isArray(plan.assignments) ||
                !Number.isInteger(index) ||
                index < 0 ||
                index >= plan.assignments.length
            ) {
                return;
            }

            const assignment = plan.assignments[index];

            if (
                !['offensePrep', 'defensePrep'].includes(assignment.task)
            ) {
                return;
            }

            const allowedKeys = getPreparationPlayKeys(
                assignment.task,
                currentTeam
            );

            if (!allowedKeys.includes(playKey)) return;

            const selected = new Set(
                Array.isArray(assignment.playKeys)
                    ? assignment.playKeys
                    : getDefaultPreparationPlayKeys(
                        assignment.task,
                        currentTeam
                    )
            );

            if (checked) selected.add(playKey);
            else selected.delete(playKey);

            assignment.playKeys = allowedKeys.filter(
                key => selected.has(key)
            );

            saveGameState();
            renderStaffTab(gs);
        };

        window.app_resetStaffWorkPlays = index => {
            const gs = getGameState();
            const plan = gs?.playerTeam?.staffWorkPlan;

            if (
                !plan ||
                !Array.isArray(plan.assignments) ||
                !Number.isInteger(index) ||
                index < 0 ||
                index >= plan.assignments.length
            ) {
                return;
            }

            const assignment = plan.assignments[index];

            if (
                !['offensePrep', 'defensePrep'].includes(assignment.task)
            ) {
                return;
            }

            delete assignment.playKeys;

            saveGameState();
            renderStaffTab(gs);
        };

        const totalRequestedHours = workPlan.assignments.reduce(
            (sum, assignment) => sum + workHours(assignment),
            0
        );

        html += `
            <section id="staff-workload-assignments" class="mt-6 mb-6 bg-white rounded border border-slate-300 p-4 shadow-sm">
                <div class="flex flex-col md:flex-row justify-between gap-3 mb-4">
                    <div>
                        <h4 class="font-black text-sm uppercase tracking-wider text-slate-900">
                            Weekly Staff Workload
                        </h4>
                        <p class="text-[11px] text-slate-500 mt-1">
                            Each coach has a personal weekly time budget.
                            Scouting, development, and preparation compete
                            for the same limited free time.
                        </p>
                    </div>
                    <div class="text-xs font-mono bg-slate-50 border border-slate-200 rounded px-3 py-2">
                        <b>${totalRequestedHours}</b> hours assigned across
                        <b>${workCoaches.length}</b> coaches
                    </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2 mb-4">
                    ${workCoaches.map(coach => {
                        const assigned = getCoachHours(coach.id);
                        const capacity = getCoachWeeklyCapacity(coach);
                        const percentage = capacity > 0
                            ? Math.min(100, assigned / capacity * 100)
                            : 0;
                        const overBudget = assigned > capacity;

                        return `
                            <div class="rounded border ${
                                overBudget
                                    ? 'border-rose-300 bg-rose-50'
                                    : 'border-slate-200 bg-slate-50'
                            } p-2.5">
                                <div class="flex items-center justify-between gap-2">
                                    <span class="font-bold text-xs text-slate-800">
                                        ${coach.name}
                                    </span>
                                    <span class="text-[10px] font-mono ${
                                        overBudget ? 'text-rose-700' : 'text-slate-500'
                                    }">${assigned}/${capacity} hrs</span>
                                </div>
                                <div class="mt-2 h-1.5 rounded bg-slate-200 overflow-hidden">
                                    <div class="h-full rounded ${
                                        overBudget ? 'bg-rose-500' : 'bg-emerald-500'
                                    }" style="width:${percentage}%"></div>
                                </div>
                                ${coach.isUserCoach
                                    ? '<p class="mt-1 text-[9px] text-slate-500">Your coaching time</p>'
                                    : `<p class="mt-1 text-[9px] text-slate-500">${
                                        coach.biases?.scouting?.name || 'Staff coach'
                                    }</p>`}
                            </div>`;
                    }).join('')}
                </div>

                <div class="space-y-2">
                    ${workPlan.assignments.map((assignment, index) => {
                        const task = taskLabels[assignment.task]
                            ? assignment.task
                            : 'scouting';

                        const focusList = focusOptions[task] || [];
                        const showTargets = task === 'scouting' ||
                            task === 'training';

                        const prepPlayOptions =
                            getPreparationPlayOptions(task);

                        const selectedPrepPlayKeys = new Set(
                            Array.isArray(assignment.playKeys)
                                ? assignment.playKeys
                                : getDefaultPreparationPlayKeys(task)
                        );

                        const assignedCoach = workCoaches.find(
                            coach => String(coach.id) ===
                                String(assignment.coachId)
                        );

                        const capacity = getCoachWeeklyCapacity(assignedCoach);
                        const currentHours = workHours(assignment);

                        const hoursOptions = Array.from(
                            { length: Math.max(capacity, currentHours) + 1 },
                            (_, i) => i
                        ).filter(hours =>
                            hours <= capacity || hours === currentHours
                        );

                        const coachOptions = workCoaches.map(coach => [
                            String(coach.id),
                            coach.isUserCoach
                                ? `${coach.name} (You)`
                                : coach.name
                        ]);

                        const opponentOptions = [
                            ['', 'Any opponent'],
                            ...(gameState.teams || [])
                                .filter(other => other &&
                                    other.id !== team.id &&
                                    other.leagueType === team.leagueType)
                                .map(other => [
                                    String(other.id),
                                    other.name
                                ])
                        ];

                        return `
                            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-2 items-end border border-slate-200 rounded p-3">
                                <label class="block min-w-0">
                                    <span class="block text-[9px] font-bold uppercase text-slate-500 mb-1">Coach</span>
                                    <select class="w-full text-xs border border-slate-300 rounded p-2 bg-white"
                                        aria-label="Assigned coach"
                                        onchange="app_updateStaffWorkAssignment(${index}, 'coachId', this.value)">
                                        ${renderOptions(
                                            coachOptions,
                                            assignment.coachId
                                        )}
                                    </select>
                                </label>

                                <label class="block min-w-0">
                                    <span class="block text-[9px] font-bold uppercase text-slate-500 mb-1">Task</span>
                                    <select class="w-full text-xs border border-slate-300 rounded p-2 bg-white"
                                        aria-label="Staff task"
                                        onchange="app_updateStaffWorkAssignment(${index}, 'task', this.value)">
                                        ${renderOptions(
                                            Object.entries(taskLabels),
                                            task
                                        )}
                                    </select>
                                </label>

                                ${focusList.length > 0 ? `
                                    <label class="block min-w-0">
                                        <span class="block text-[9px] font-bold uppercase text-slate-500 mb-1">Focus</span>
                                        <select class="w-full text-xs border border-slate-300 rounded p-2 bg-white"
                                            aria-label="Task focus"
                                            onchange="app_updateStaffWorkAssignment(${index}, 'focus', this.value)">
                                            ${renderOptions(
                                                focusList,
                                                assignment.focus || 'all'
                                            )}
                                        </select>
                                    </label>
                                ` : task === 'defensePrep' ? `
                                    <label class="block min-w-0">
                                        <span class="block text-[9px] font-bold uppercase text-slate-500 mb-1">Opponent</span>
                                        <select class="w-full text-xs border border-slate-300 rounded p-2 bg-white"
                                            aria-label="Preparation opponent"
                                            onchange="app_updateStaffWorkAssignment(${index}, 'opponentTeamId', this.value)">
                                            ${renderOptions(
                                                opponentOptions,
                                                assignment.opponentTeamId || ''
                                            )}
                                        </select>
                                    </label>
                                ` : `
                                    <div class="text-[10px] text-slate-500">
                                        All active offensive plays
                                    </div>
                                `}

                                ${task === 'training' ? `
                                    <label class="block min-w-0">
                                        <span class="block text-[9px] font-bold uppercase text-slate-500 mb-1">Skill</span>
                                        <select class="w-full text-xs border border-slate-300 rounded p-2 bg-white"
                                            aria-label="Training skill"
                                            onchange="app_updateStaffWorkAssignment(${index}, 'skill', this.value)">
                                            ${renderOptions(
                                                skillOptions,
                                                assignment.skill || ''
                                            )}
                                        </select>
                                    </label>
                                ` : '<div></div>'}

                                ${showTargets ? `
                                    <label class="block min-w-0">
                                        <span class="block text-[9px] font-bold uppercase text-slate-500 mb-1">Max targets</span>
                                        <select class="w-full text-xs border border-slate-300 rounded p-2 bg-white"
                                            aria-label="Maximum targets"
                                            onchange="app_updateStaffWorkAssignment(${index}, 'maxTargets', this.value)">
                                            ${renderOptions(
                                                [[1, '1 player'], [2, '2 players'], [3, '3 players'], [4, '4 players'], [6, '6 players'], [8, '8 players'], [12, '12 players']],
                                                assignment.maxTargets || (task === 'training' ? 4 : 1)
                                            )}
                                        </select>
                                    </label>
                                ` : '<div></div>'}

                                                                <div class="flex items-end gap-2">
                                    <label class="block flex-1 min-w-0">
                                        <span class="block text-[9px] font-bold uppercase text-slate-500 mb-1">Hours</span>
                                        <select class="w-full text-xs border border-slate-300 rounded p-2 bg-white"
                                            aria-label="Assigned hours"
                                            onchange="app_updateStaffWorkAssignment(${index}, 'hours', this.value)">
                                            ${renderOptions(
                                                hoursOptions.map(hours => [
                                                    hours,
                                                    `${hours} hrs`
                                                ]),
                                                workHours(assignment)
                                            )}
                                        </select>
                                    </label>
                                    <button class="px-2 py-2 text-xs font-bold text-rose-600 border border-rose-200 rounded hover:bg-rose-50"
                                        title="Remove assignment"
                                        aria-label="Remove assignment"
                                        onclick="app_removeStaffWorkAssignment(${index})">
                                        ×
                                    </button>
                                </div>
                                ${prepPlayOptions.length > 0 ? `
                                    <div class="md:col-span-2 xl:col-span-6 rounded border border-slate-200 bg-slate-50 p-3">
                                        <div class="flex flex-wrap justify-between items-start gap-2 mb-2">
                                            <div>
                                                <span class="block text-[10px] font-bold uppercase tracking-wide text-slate-700">
                                                    Plays to Emphasize
                                                </span>
                                                <p class="text-[10px] text-slate-500 mt-1">
                                                    Select the plays this coach should prepare.
                                                    Changes are saved immediately.
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                class="text-[10px] font-bold text-blue-700 hover:text-blue-900 underline"
                                                onclick="app_resetStaffWorkPlays(${index})">
                                                Reset to automatic
                                            </button>
                                        </div>
                                        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                            ${prepPlayOptions.map(([key, label]) => `
                                                <label class="flex items-start gap-2 rounded border border-slate-200 bg-white p-2 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        class="mt-0.5 accent-blue-600"
                                                        value="${key}"
                                                        ${selectedPrepPlayKeys.has(key) ? 'checked' : ''}
                                                        onchange="app_toggleStaffWorkPlay(${index}, '${key}', this.checked)">
                                                    <span class="text-[10px] text-slate-700">${label}</span>
                                                </label>
                                            `).join('')}
                                        </div>
                                        ${selectedPrepPlayKeys.size === 0 ? `
                                            <p class="text-[10px] text-amber-700 mt-2">
                                                No plays selected: preparation score can accumulate, but no play mastery will increase.
                                            </p>
                                        ` : ''}
                                    </div>
                                ` : ''}
                            </div>`;
                    }).join('')}
                </div>

                <div class="flex justify-between items-center mt-4 gap-3">
                    <p class="text-[10px] text-slate-500">
                        Assignments are saved immediately. Unassigned hours remain available.
                    </p>
                    <button class="shrink-0 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded"
                        onclick="app_addStaffWorkAssignment()">
                        + Add Assignment
                    </button>
                </div>
            </section>
        `;
    }

    // Staff candidates are displayed in the separate Staff Free Agents pane.
    container.innerHTML = html;
}

export function renderStaffMarketTab(gameState) {
    const container = document.getElementById('staff-market-container');

    if (!container || !gameState?.playerTeam) return;

    // Initialize the hiring handlers and candidate pool.
    // renderStaffTab no longer renders the candidate market.
    renderStaffTab(gameState);

    const team = gameState.playerTeam;
    const candidates = Array.isArray(gameState.availableStaff)
        ? gameState.availableStaff
        : [];

    if (candidates.length === 0) {
        container.innerHTML = `
            <section class="bg-white rounded border border-slate-300 p-6 text-center">
                <h3 class="font-black text-sm uppercase tracking-wide text-slate-800">
                    Staff Free Agents
                </h3>
                <p class="text-xs text-slate-500 mt-2">
                    No candidates are currently available.
                </p>
            </section>`;
        return;
    }

    container.innerHTML = `
        <section class="mb-4 bg-slate-900 text-white rounded p-4 border border-slate-700">
            <div class="flex flex-wrap justify-between items-center gap-3">
                <div>
                    <h3 class="text-lg font-black uppercase tracking-wide text-amber-400">
                        Staff Free Agents
                    </h3>
                    <p class="text-xs text-slate-300 mt-1">
                        Compare coaching strengths, scouting ability, teaching,
                        personality, and tactical preferences before making an offer.
                    </p>
                </div>
                <span class="text-xs font-mono bg-slate-800 border border-slate-700 rounded px-3 py-2">
                    ${candidates.length} candidates available
                </span>
            </div>
        </section>

        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            ${candidates.map(s => {
                const ratings = s.ratings || {};
                const biases = s.biases || {};
                const personality = biases.personality || {};
                const tactical = biases.tactical || {};
                const scouting = biases.scouting || {};

                const skillValue = value => {
                    if (value == null || value === '') return null;
                    const number = Number(value);

                    return Number.isFinite(number)
                        ? Math.max(0, Math.min(100, Math.round(number)))
                        : null;
                };

                const skillAverage = (...values) => {
                    const valid = values
                        .map(skillValue)
                        .filter(value => value !== null);

                    return valid.length
                        ? Math.round(
                            valid.reduce((sum, value) => sum + value, 0) /
                            valid.length
                        )
                        : null;
                };

                const candidateSkills = [
                    {
                        label: 'Offense Scheme',
                        value: skillValue(ratings.offSchemeMastery),
                        color: 'bg-emerald-500'
                    },
                    {
                        label: 'Defense Scheme',
                        value: skillValue(ratings.defSchemeMastery),
                        color: 'bg-blue-500'
                    },
                    {
                        label: 'Player Evaluation',
                        value: skillAverage(
                            ratings.evalPhysicals,
                            ratings.evalTechnique,
                            ratings.evalCharacter
                        ),
                        color: 'bg-violet-500'
                    },
                    {
                        label: 'Teaching',
                        value: skillValue(ratings.teaching),
                        color: 'bg-amber-500'
                    },
                    {
                        label: 'Game Planning',
                        value: skillAverage(
                            ratings.gameplanInstinct,
                            ratings.inGameAdjustments
                        ),
                        color: 'bg-sky-500'
                    },
                    {
                        label: 'Practice & Conditioning',
                        value: skillAverage(
                            ratings.practiceDiscipline,
                            ratings.conditioning
                        ),
                        color: 'bg-rose-500'
                    }
                ];

                const ratedSkills = candidateSkills.filter(
                    skill => skill.value !== null
                );

                const overallRating = skillAverage(
                    ...ratedSkills.map(skill => skill.value)
                );

                const strongestSkill = [...ratedSkills].sort(
                    (a, b) => b.value - a.value
                )[0];

                const tend = Game.previewCoachTendencies(s, team);

                return `
                    <article class="bg-white rounded border border-slate-300 p-4 shadow-sm flex flex-col justify-between">
                        <div>
                            <div class="flex justify-between items-start gap-2 mb-2">
                                <div>
                                    <h4 class="font-black text-sm text-slate-900">
                                        ${s.name}
                                    </h4>
                                    <p class="text-[10px] text-slate-500 mt-0.5">
                                        Age ${s.age} · ${personality.name || 'Unknown personality'}
                                    </p>
                                </div>
                                ${s.formerPlayerBio ? `
                                    <span
                                        class="shrink-0 text-[9px] bg-amber-100 text-amber-900 font-bold px-1.5 py-1 rounded"
                                        title="${s.formerPlayerBio}">
                                        🎓 Park Legend
                                    </span>
                                ` : ''}
                            </div>

                            <p class="text-[11px] text-slate-600 italic mb-3">
                                ${tactical.desc || scouting.desc || personality.desc || 'No scouting notes available.'}
                            </p>

                            <div class="rounded-lg border border-slate-200 p-3 mb-3">
                                <div class="flex items-center justify-between gap-2 mb-3">
                                    <h5 class="text-[10px] font-black uppercase tracking-widest text-slate-600">
                                        Coaching Skills
                                    </h5>

                                    <span class="text-sm font-black text-slate-900 bg-slate-100 rounded px-2 py-1">
                                        ${overallRating ?? '—'} Avg.
                                    </span>
                                </div>

                                ${strongestSkill ? `
                                    <div class="rounded border border-emerald-200 bg-emerald-50 p-2 mb-3">
                                        <span class="block text-[9px] font-bold uppercase text-emerald-800">
                                            Strongest Area
                                        </span>
                                        <span class="text-xs font-black text-emerald-950">
                                            ${strongestSkill.label} · ${strongestSkill.value}
                                        </span>
                                    </div>
                                ` : ''}

                                <div class="space-y-3">
                                    ${candidateSkills.map(skill => `
                                        <div>
                                            <div class="flex items-center justify-between gap-2 mb-1">
                                                <span class="text-xs font-semibold text-slate-700">
                                                    ${skill.label}
                                                </span>
                                                <span class="text-sm font-black text-slate-900 tabular-nums">
                                                    ${skill.value ?? '—'}
                                                </span>
                                            </div>

                                            <div class="h-2.5 rounded-full bg-slate-200 overflow-hidden">
                                                <div
                                                    class="h-full rounded-full ${skill.color}"
                                                    style="width:${skill.value ?? 0}%">
                                                </div>
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                                <div class="rounded border border-slate-200 bg-slate-50 p-2">
                                    <span class="block text-[9px] uppercase text-slate-500">
                                        Offense Tactics
                                    </span>
                                    <b class="text-sm text-slate-900">
                                        ${ratings.offSchemeMastery ?? '—'}
                                    </b>
                                </div>
                                <div class="rounded border border-slate-200 bg-slate-50 p-2">
                                    <span class="block text-[9px] uppercase text-slate-500">
                                        Defense Tactics
                                    </span>
                                    <b class="text-sm text-slate-900">
                                        ${ratings.defSchemeMastery ?? '—'}
                                    </b>
                                </div>
                                <div class="rounded border border-slate-200 bg-slate-50 p-2">
                                    <span class="block text-[9px] uppercase text-slate-500">
                                        Scouting
                                    </span>
                                    <b class="text-sm text-slate-900">
                                        ${Math.round((
                                            (Number(ratings.evalPhysicals) || 0) +
                                            (Number(ratings.evalTechnique) || 0) +
                                            (Number(ratings.evalCharacter) || 0)
                                        ) / 3)}
                                    </b>
                                </div>
                                <div class="rounded border border-slate-200 bg-slate-50 p-2">
                                    <span class="block text-[9px] uppercase text-slate-500">
                                        Teaching
                                    </span>
                                    <b class="text-sm text-slate-900">
                                        ${ratings.teaching ?? '—'}
                                    </b>
                                </div>
                            </div>

                            <div class="border-t border-slate-200 pt-2">
                                <span class="block text-[9px] font-black uppercase tracking-wide text-slate-500 mb-1">
                                    Expected Playcalling DNA
                                </span>
                                <div class="flex flex-wrap gap-1.5 text-[10px] text-slate-700">
                                    <span class="bg-slate-100 border border-slate-200 rounded px-1.5 py-1">
                                        Run: <b>${tend.earlyDownTendency}%</b>
                                    </span>
                                    <span class="bg-slate-100 border border-slate-200 rounded px-1.5 py-1">
                                        Blitz: <b>${tend.defenseAggressiveness}%</b>
                                    </span>
                                    <span class="bg-slate-100 border border-slate-200 rounded px-1.5 py-1">
                                        4th Down: <b>${tend.fourthDownBravery}%</b>
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div class="border-t border-slate-200 pt-3 mt-3">
                            <button
                                class="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 rounded text-xs"
                                onclick="app_hireStaff('${s.id}', 'coach')">
                                Recruit to Coaching Staff
                            </button>
                            <p class="text-[10px] text-slate-500 text-center mt-2">
                                Recruit based on skills, philosophy, and fit with your staff.
                            </p>
                        </div>
                    </article>`;
            }).join('')}
        </div>
    `;
}

let rosterSortCol = 'ovr';
let rosterSortDir = 'desc';
let myRosterView = 'skills';
let leagueStatsView = 'all';

// These are the stat fields accumulated into seasonStats and careerStats.
const PLAYER_STAT_COLUMNS = [
    { key: 'passYards', label: 'Pass Yds' },
    { key: 'passAttempts', label: 'Pass Att' },
    { key: 'passCompletions', label: 'Pass Comp' },
    { key: 'interceptionsThrown', label: 'INT Thrown' },
    { key: 'rushYards', label: 'Rush Yds' },
    { key: 'rushAttempts', label: 'Rush Att' },
    { key: 'recYards', label: 'Rec Yds' },
    { key: 'receptions', label: 'Receptions' },
    { key: 'targets', label: 'Targets' },
    { key: 'drops', label: 'Drops' },
    { key: 'tackles', label: 'Tackles' },
    { key: 'sacks', label: 'Sacks' },
    { key: 'interceptions', label: 'INT' },
    { key: 'fumbles', label: 'Fumbles' },
    { key: 'fumblesLost', label: 'Fumbles Lost' },
    { key: 'fumblesRecovered', label: 'Fumbles Rec.' },
    { key: 'touchdowns', label: 'TD' },
    { key: 'returnYards', label: 'Return Yds' },
    { key: 'safeties', label: 'Safeties' }
];

window.app_setRosterSort = function (col) {
    if (rosterSortCol === col) {
        rosterSortDir = (rosterSortDir === 'desc') ? 'asc' : 'desc';
    } else {
        rosterSortCol = col;
        rosterSortDir = 'desc';
    }
    renderMyTeamTab(getGameState());
};

window.app_setMyRosterView = function (view) {
    if (!['skills', 'season', 'career'].includes(view)) return;

    myRosterView = view;
    renderMyTeamTab(getGameState());
};

function renderMyTeamTab(gameState) {
    if (!elements.myTeamRoster || !gameState?.playerTeam) return;
    const roster = getUIRosterObjects(gameState.playerTeam);

    const sortedRoster = [...roster].sort((a, b) => {
        const fitsA = getBestTwoWayFits(a);
        const fitsB = getBestTwoWayFits(b);
        const ovrA = Math.max(fitsA.offense.ovr, fitsA.defense.ovr);
        const ovrB = Math.max(fitsB.offense.ovr, fitsB.defense.ovr);

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

        const viewTabs = `
        <div class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-white border-b border-slate-200">
            <div class="flex flex-wrap gap-1 rounded border border-slate-300 bg-slate-100 p-1 text-[11px] font-bold">
                <button
                    class="px-3 py-1.5 rounded transition ${myRosterView === 'skills' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-white'}"
                    onclick="app_setMyRosterView('skills')">
                    Skills
                </button>
                <button
                    class="px-3 py-1.5 rounded transition ${myRosterView === 'season' ? 'bg-amber-500 text-slate-950 shadow-sm' : 'text-slate-600 hover:bg-white'}"
                    onclick="app_setMyRosterView('season')">
                    Season Stats
                </button>
                <button
                    class="px-3 py-1.5 rounded transition ${myRosterView === 'career' ? 'bg-blue-700 text-white shadow-sm' : 'text-slate-600 hover:bg-white'}"
                    onclick="app_setMyRosterView('career')">
                    Career Stats
                </button>
            </div>
            <span class="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                ${roster.length} players
            </span>
        </div>`;

    if (myRosterView === 'season' || myRosterView === 'career') {
        const isCareer = myRosterView === 'career';
        const statsKey = isCareer ? 'careerStats' : 'seasonStats';

        const statHeaders = PLAYER_STAT_COLUMNS
            .map(stat => `<th class="py-2 px-2 text-center whitespace-nowrap">${stat.label}</th>`)
            .join('');

        const extraHeader = isCareer
            ? `<th class="py-2 px-2 text-center whitespace-nowrap">Seasons</th>`
            : '';

        const statRows = sortedRoster.length > 0
            ? sortedRoster.map(p => {
                const stats = p[statsKey] || {};
                const pos = p.pos || estimateBestPosition(p);

                const statCells = PLAYER_STAT_COLUMNS.map(stat =>
                    `<td class="py-2 px-2 text-center text-slate-700">${Number(stats[stat.key]) || 0}</td>`
                ).join('');

                const seasonsCell = isCareer
                    ? `<td class="py-2 px-2 text-center font-bold text-slate-700">${Number(stats.seasonsPlayed) || 0}</td>`
                    : '';

                return `
                    <tr class="hover:bg-slate-50 transition cursor-pointer"
                        onclick="app.openPlayerCard('${p.id}')">
                        <td class="py-2 px-3 font-semibold text-slate-900 whitespace-nowrap">
                            <span class="font-mono text-[10px] text-slate-400 mr-1">#${p.number || '--'}</span>
                            ${p.name}
                        </td>
                        <td class="py-2 px-2 text-center">
                            <span class="font-bold text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
                                ${pos}
                            </span>
                        </td>
                        <td class="py-2 px-2 text-center text-slate-600">${p.age ?? '--'}</td>
                        ${statCells}
                        ${seasonsCell}
                    </tr>`;
            }).join('')
            : `<tr>
                <td colspan="${3 + PLAYER_STAT_COLUMNS.length + (isCareer ? 1 : 0)}"
                    class="p-6 text-center text-slate-400 italic">
                    Roster empty.
                </td>
            </tr>`;

        elements.myTeamRoster.innerHTML = rosterNotice + viewTabs + `
            <div class="overflow-x-auto">
                <table class="min-w-full bg-white text-xs">
                    <thead class="bg-slate-900 text-white sticky top-0 z-10 uppercase tracking-wider text-[10px]">
                        <tr>
                            <th class="py-2 px-3 text-left whitespace-nowrap">Player</th>
                            <th class="py-2 px-2 text-center">Pos</th>
                            <th class="py-2 px-2 text-center">Age</th>
                            ${statHeaders}
                            ${extraHeader}
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 font-mono">
                        ${statRows}
                    </tbody>
                </table>
            </div>`;

        return;
    }

    let html = rosterNotice + viewTabs + `
    <div class="overflow-x-auto">
        <table class="min-w-full bg-white text-xs">
            <thead class="bg-slate-900 text-white sticky top-0 z-10 select-none uppercase tracking-wider text-[11px]">
                <tr>
                    <th class="py-2.5 px-3 text-left sticky left-0 bg-slate-900 z-20 cursor-pointer hover:bg-slate-800" onclick="app_setRosterSort('name')">Player${getIndicator('name')}</th>
                    <th class="py-2.5 px-2 text-center cursor-pointer hover:bg-slate-800" onclick="app_setRosterSort('ovr')">OFF / DEF FIT${getIndicator('ovr')}</th>
                    <th class="py-2.5 px-2 text-center" title="Team Captain">Cap</th>
                    <th class="py-2.5 px-2 text-center cursor-pointer hover:bg-slate-800" onclick="app_setRosterSort('age')">Age${getIndicator('age')}</th>
                    <th class="py-2.5 px-2 text-center cursor-pointer hover:bg-slate-800" onclick="app_setRosterSort('pot')">Pot${getIndicator('pot')}</th>
                    <th class="py-2.5 px-2 text-center cursor-pointer hover:bg-slate-800" onclick="app_setRosterSort('energy')">Energy${getIndicator('energy')}</th>
                    <th class="py-2.5 px-2 text-center cursor-pointer hover:bg-slate-800 text-blue-400" onclick="app_setRosterSort('speed')">SPD${getIndicator('speed')}</th>
                    <th class="py-2.5 px-2 text-center cursor-pointer hover:bg-slate-800" onclick="app_setRosterSort('strength')">STR${getIndicator('strength')}</th>
                    <th class="py-2.5 px-2 text-center cursor-pointer hover:bg-slate-800" onclick="app_setRosterSort('agility')">AGI${getIndicator('agility')}</th>
                    <th class="py-2.5 px-2 text-center cursor-pointer hover:bg-slate-800" onclick="app_setRosterSort('playbookIQ')">IQ${getIndicator('playbookIQ')}</th>
                    <th class="py-2.5 px-2 text-center cursor-pointer hover:bg-slate-800" onclick="app_setRosterSort('throwingAccuracy')">ACC${getIndicator('throwingAccuracy')}</th>
                    <th class="py-2.5 px-2 text-center cursor-pointer hover:bg-slate-800" onclick="app_setRosterSort('throwPower')">POW${getIndicator('throwPower')}</th>
                    <th class="py-2.5 px-2 text-center cursor-pointer hover:bg-slate-800" onclick="app_setRosterSort('catchingHands')">HND${getIndicator('catchingHands')}</th>
                    <th class="py-2.5 px-2 text-center cursor-pointer hover:bg-slate-800" onclick="app_setRosterSort('blocking')">BLK${getIndicator('blocking')}</th>
                    <th class="py-2.5 px-2 text-center cursor-pointer hover:bg-slate-800" onclick="app_setRosterSort('tackling')">TKL${getIndicator('tackling')}</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-mono">`;

    if (sortedRoster.length === 0) {
        html += `<tr><td colspan="15" class="p-6 text-center text-slate-400 font-sans italic">Roster empty.</td></tr>`;
    } else {
        sortedRoster.forEach(p => {
            const isCap = gameState.playerTeam.captainId === p.id;
            const fits = getBestTwoWayFits(p);
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
                    <div class="flex flex-col items-center gap-0.5 text-[10px] leading-tight">
                        ${renderPositionFit(fits.offense, 'offense', true)}
                        ${renderPositionFit(fits.defense, 'defense', true)}
                    </div>
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
                <td class="text-center py-2 px-2 text-slate-700">${p.attributes?.technical?.throwPower ?? p.attributes?.physical?.strength ?? 0}</td>
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

    renderFormationPills('offense', offenseFormations, gs.playerTeam.formations.offense);
    renderFormationPills('defense', defenseFormations, gs.playerTeam.formations.defense);
    renderDepthChartSide('offense', gs);
    renderDepthChartSide('defense', gs);

    const activeSub = document.querySelector(".depth-chart-tab.active")?.dataset.subTab || "depth-order";
    const offensePane = document.getElementById("depth-chart-offense-pane");
    const defensePane = document.getElementById("depth-chart-defense-pane");
    const overallsPane = document.getElementById("positional-overalls-container");
    const depthOrderPane = document.getElementById("depth-order-container");
    const playbookPane = document.getElementById("playbook-manager-container");
    const practicePane = document.getElementById("practice-manager-container");

    if (offensePane) offensePane.classList.toggle("hidden", activeSub !== "offense");
    if (defensePane) defensePane.classList.toggle("hidden", activeSub !== "defense");
    if (overallsPane) overallsPane.classList.toggle("hidden", activeSub !== "overalls");
    if (depthOrderPane) depthOrderPane.classList.toggle("hidden", activeSub !== "depth-order");
    if (playbookPane) playbookPane.classList.toggle("hidden", activeSub !== "playbook");
    if (practicePane) practicePane.classList.toggle("hidden", activeSub !== "practice");

    if (activeSub === "depth-order") renderDepthOrderPane(gs);
    else if (activeSub === "overalls") renderPositionalOveralls();
    else if (activeSub === "playbook") renderPlaybookManager(gs);
    else if (activeSub === "practice") renderPracticeManager(gs);
}

function renderFormationPills(side, formationMap, selectedKey) {
    const container = document.getElementById(`${side}-formation-pills`);
    if (!container) return;

    const entries = Object.entries(formationMap).filter(([k]) => k !== 'Punt' && k !== 'Punt_Return');

    container.innerHTML = entries.map(([key, form]) => {
        const isSelected = key === selectedKey;
        const personnel = form?.personnel || {};
        const pBadge = Object.entries(personnel)
            .filter(([_, count]) => count > 0)
            .map(([pos, count]) => `${count}${pos}`)
            .join(' · ');

        return `
            <button class="px-2.5 py-1.5 rounded text-left transition border flex flex-col justify-between ${
                isSelected 
                    ? (side === 'offense' ? 'bg-blue-900 border-blue-950 text-white shadow-sm' : 'bg-rose-900 border-rose-950 text-white shadow-sm') 
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100 hover:border-slate-300'
            }" onclick="window.app_changeFormation('${side}', '${key}')">
                <div class="flex items-center gap-1.5">
                    <span class="font-black text-xs leading-none">${form.name || key}</span>
                    ${isSelected ? '<span class="text-[8px] bg-white/20 px-1 rounded font-bold uppercase">Active</span>' : ''}
                </div>
                <span class="text-[9px] font-mono mt-0.5 ${isSelected ? 'text-slate-200' : 'text-slate-500'}">
                    ${pBadge || 'Standard'}
                </span>
            </button>`;
    }).join('');
}

window.app_changeFormation = function(side, newKey) {
    const gs = getGameState();
    const team = gs?.playerTeam;
    if (!team) return;

    team.formations[side] = newKey;

    const stBackup = { ...(team.specialTeams || {}) };
    const specBackup = { ...(team.specialists || {}) };

    rebuildDepthChartFromOrder(team);

    if (!team.depthChart) team.depthChart = {};
    team.specialTeams = stBackup;
    team.specialists = specBackup;
    team.depthChart.specialTeams = stBackup;

    saveGameState();

    renderFormationPills(side, side === 'offense' ? offenseFormations : defenseFormations, newKey);
    renderDepthChartSide(side, gs);
    renderDepthOrderPane(gs);
    renderPositionalOveralls();
};

function renderPositionalOveralls() {
    const pane = document.getElementById("positional-overalls-container");
    const gs = getGameState();
    if (!pane || !gs?.playerTeam) return;

    const team = gs.playerTeam;
    const roster = getUIRosterObjects(team);
    const positions = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'];
    const offChart = team.depthChart?.offense || {};
    const defChart = team.depthChart?.defense || {};
    const stChart = team.depthChart?.specialTeams || {};

    // Calculate room quality for the top summary cards
    const roomSummaries = positions.map(pos => {
        const ratings = roster.map(p => calculateOverall(p, pos)).sort((a, b) => b - a);
        const top1 = ratings[0] || 0;
        const top2 = ratings[1] || 0;
        return { pos, top1, top2, avg: Math.round((top1 + top2) / 2) };
    });

    pane.innerHTML = `
        <!-- Top Strategic Radar: Position Room Strength -->
        <div class="mb-3 bg-slate-900 text-white rounded p-3 border border-slate-700 shadow-sm shrink-0">
            <div class="flex justify-between items-center mb-2 pb-1 border-b border-slate-800">
                <span class="text-[10px] font-black uppercase tracking-wider text-amber-400">Franchise Position Room Strength</span>
                <span class="text-[10px] text-slate-400 font-mono">Starter / Backup OVR</span>
            </div>
            <div class="grid grid-cols-4 sm:grid-cols-8 gap-2">
                ${roomSummaries.map(r => `
                    <div class="bg-slate-800/80 p-2 rounded border border-slate-700 text-center">
                        <span class="text-[10px] font-black uppercase text-slate-300 block">${r.pos}</span>
                        <span class="text-sm font-black ${r.top1 >= 65 ? 'text-emerald-400' : (r.top1 >= 50 ? 'text-amber-400' : 'text-slate-400')}">${r.top1}</span>
                        <span class="text-[9px] text-slate-400 block font-mono">bup: ${r.top2}</span>
                    </div>
                `).join('')}
            </div>
        </div>

        <!-- Master 8-Way Versatility Matrix Table -->
        <div class="bg-white rounded border border-slate-200 shadow-sm overflow-x-auto">
            <table class="min-w-full text-xs font-mono">
                <thead class="bg-slate-900 text-white uppercase text-[10px] tracking-wider select-none">
                    <tr>
                        <th class="py-2.5 px-3 text-left font-sans">Player</th>
                        <th class="py-2.5 px-2 text-center">Nat</th>
                        <th class="py-2.5 px-2 text-center">Age</th>
                        <th class="py-2.5 px-2 text-center">Pot</th>
                        <th class="py-2.5 px-2 text-center text-amber-400" title="Stamina: High stamina prevents two-way fatigue burn">STM</th>
                        <th class="py-2.5 px-2 text-center text-blue-300">QB</th>
                        <th class="py-2.5 px-2 text-center text-blue-300">RB</th>
                        <th class="py-2.5 px-2 text-center text-blue-300">WR</th>
                        <th class="py-2.5 px-2 text-center text-blue-300">TE</th>
                        <th class="py-2.5 px-2 text-center text-blue-300">OL</th>
                        <th class="py-2.5 px-2 text-center text-rose-300">DL</th>
                        <th class="py-2.5 px-2 text-center text-rose-300">LB</th>
                        <th class="py-2.5 px-2 text-center text-rose-300">DB</th>
                        <th class="py-2.5 px-3 text-left font-sans">Active Role</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                    ${roster.map(p => {
                        const fits = getBestTwoWayFits(p);
                        const natPos = p.pos || estimateBestPosition(p);
                        const stamina = p.attributes?.physical?.stamina || 50;

                        // Check active roles
                        const offSlot = Object.entries(offChart).find(([_, id]) => id === p.id)?.[0];
                        const defSlot = Object.entries(defChart).find(([_, id]) => id === p.id)?.[0];
                        const isPR = stChart['PR'] === p.id;

                        let rolesBadge = '';
                        if (offSlot && defSlot) rolesBadge = `<span class="bg-amber-100 text-amber-900 border border-amber-300 px-1 rounded text-[9px] font-black font-sans">⚡ ${offSlot} & ${defSlot}</span>`;
                        else if (offSlot) rolesBadge = `<span class="bg-blue-50 text-blue-800 border border-blue-200 px-1 rounded text-[9px] font-bold font-sans">${offSlot}</span>`;
                        else if (defSlot) rolesBadge = `<span class="bg-red-50 text-red-800 border border-red-200 px-1 rounded text-[9px] font-bold font-sans">${defSlot}</span>`;
                        else rolesBadge = `<span class="text-slate-400 font-sans text-[10px]">Reserve</span>`;

                        if (isPR) rolesBadge += ` <span class="bg-purple-100 text-purple-900 border border-purple-200 px-1 rounded text-[9px] font-black font-sans">PR</span>`;

                        return `
                        <tr class="hover:bg-slate-50 transition cursor-pointer" onclick="app.openPlayerCard('${p.id}')">
                            <td class="py-2 px-3 font-sans font-semibold text-slate-900 truncate max-w-[130px]">
                                <span>${p.name}</span>
                                <span class="text-slate-400 font-mono text-[10px] ml-1">#${p.number || '--'}</span>
                            </td>
                            <td class="text-center py-2 px-2"><span class="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-bold text-[10px]">${natPos}</span></td>
                            <td class="text-center py-2 px-2 text-slate-600">${p.age}</td>
                            <td class="text-center py-2 px-2 font-bold ${p.potential === 'A' ? 'text-amber-600' : 'text-slate-500'}">${p.potential || '?'}</td>
                            <td class="text-center py-2 px-2 font-bold ${stamina >= 70 ? 'text-emerald-700' : (stamina <= 45 ? 'text-rose-600' : 'text-slate-700')}">${stamina}</td>
                            ${positions.map(pos => {
                                const ovr = calculateOverall(p, pos);
                                const isBestOff = pos === fits.offense.position;
                                const isBestDef = pos === fits.defense.position;
                                let cellClass = 'text-slate-400';
                                if (isBestOff) cellClass = 'bg-emerald-50 text-emerald-900 font-black border-x border-emerald-200';
                                else if (isBestDef) cellClass = 'bg-blue-50 text-blue-900 font-black border-x border-blue-200';
                                else if (ovr >= 50) cellClass = 'text-slate-800 font-semibold';

                                return `<td class="text-center py-2 px-2 ${cellClass}">${ovr}</td>`;
                            }).join('')}
                            <td class="py-2 px-3">${rolesBadge}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
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

    const formKey = formations[side] || (side === 'offense' ? 'Balanced' : '3-2-3');
    const formationData = (side === 'offense' ? offenseFormations : defenseFormations)[formKey];

    visualField.innerHTML = '';
        const losMarker = document.createElement('div');
        losMarker.className = 'absolute left-0 w-full h-1.5 bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.9)] z-0';
        losMarker.style.top = side === 'offense' ? '18%' : '82%';
        visualField.appendChild(losMarker);

        // High-precision spacing: completely eliminates backfield & secondary overlaps
        const getVisualCoordinates = (rawX, rawY, currentSide) => {
            // 1. Horizontal De-Clustering
            let visualX = rawX;
            if (Math.abs(rawX) <= 4.0) {
                visualX = rawX * 2.2;
            } else {
                const sign = Math.sign(rawX);
                const excess = Math.abs(rawX) - 4.0;
                visualX = sign * (4.0 * 2.2 + excess * 1.25);
            }
            visualX = Math.max(-21.5, Math.min(21.5, visualX));
            const leftPercent = 50 + (visualX * 1.95);

            // 2. High-Spaced Vertical Tiers
            let topPercent = 50;

            if (currentSide === 'offense') {
                if (rawY >= -0.35) {
                    // Line of Scrimmage (OL, on-line WRs, inline TEs)
                    topPercent = 18.0;
                } else if (rawY > -1.35) {
                    // Flankers / Slot receivers just off the line
                    topPercent = 25.0;
                } else if (rawY > -2.5) {
                    // Under-Center QB (Power I, Jumbo)
                    topPercent = 34.0;
                } else if (rawY > -4.5) {
                    // Fullback in Power I / Jumbo (-3.2 to -3.4) vs Pistol QB (-4.0)
                    topPercent = rawY <= -3.6 ? 50.0 : 52.0;
                } else if (rawY > -6.5) {
                    // Deep Tailback in Power I (-5.6) vs Shotgun Pocket (-6.0)
                    if (Math.abs(rawX) < 1.0 && rawY > -5.8) {
                        topPercent = 72.0; // Deep I-Formation Tailback
                    } else {
                        topPercent = 64.0; // Shotgun pocket depth
                    }
                } else if (rawY > -8.5) {
                    // Deep Pistol Tailback (-7.0)
                    topPercent = 82.0;
                } else {
                    // Punter (-12.0)
                    topPercent = 88.0;
                }
            } else {
                // DEFENSIVE TIERS
                if (rawY <= 1.5) {
                    // Defensive Line along LOS
                    topPercent = 76.0;
                } else if (rawY <= 4.5) {
                    // Linebackers & nickel overhangs
                    topPercent = 55.0;
                } else if (rawY <= 8.5) {
                    // Cornerbacks / boundary DBs
                    topPercent = 38.0;
                } else if (rawY <= 18.0) {
                    // Deep Safeties
                    topPercent = 18.0;
                } else if (rawY <= 38.0) {
                    // Punt Up-Returner (prevents stacking with PR)
                    topPercent = 30.0;
                } else {
                    // Deep Punt Returner
                    topPercent = 12.0;
                }
            }

            return { leftPercent, topPercent };
        };

        if (formationData?.slots) {
            formationData.slots.forEach(slotId => {
                const coords = formationData.coordinates?.[slotId];
                if (!coords) return;
                const [yardsX, yardsY] = coords;
                const { leftPercent, topPercent } = getVisualCoordinates(yardsX, yardsY, side);

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
                const shortName = player ? getPlayerLastNameForStats(player) : 'EMPTY';
                const energy = player ? Math.max(0, Math.round(100 - (player.fatigue || 0))) : 100;
                const isUnavailable = player && player.status?.duration > 0;

                // Two-Way check
                const otherSlot = player ? Object.entries(otherChart).find(([_, id]) => id === player.id)?.[0] : null;

                let ringColor = 'border-slate-500';
                if (player) {
                    if (energy >= 75) ringColor = 'border-emerald-400';
                    else if (energy >= 50) ringColor = 'border-amber-400';
                    else ringColor = 'border-rose-500 animate-pulse';
                }

                // Enriched, larger card geometry (w-11 h-11 avatar with crisp typography)
                slotEl.className = 'absolute transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group z-10 cursor-pointer select-none';
                slotEl.innerHTML = `
                    <div class="relative flex flex-col items-center">
                        <!-- Floating Slot Badge -->
                        <span class="absolute -top-3 z-20 text-[8.5px] font-black tracking-wider uppercase px-1.5 py-0.2 rounded shadow-md ${side === 'offense' ? 'bg-blue-900 text-blue-200 border border-blue-700' : 'bg-red-900 text-red-200 border border-red-700'}">
                            ${slotId}
                        </span>

                        <!-- Punchy, Scaled-Up Avatar Circle (w-11 h-11) -->
                        <div class="relative w-11 h-11 rounded-full border-2 ${ringColor} shadow-xl flex flex-col items-center justify-center ${player ? 'bg-slate-900 text-white' : 'bg-slate-800/90 border-dashed border-slate-500 text-slate-400'} group-hover:scale-105 transition-transform">
                            <span class="text-[8px] font-mono text-slate-400 leading-none">${posKey}</span>
                            <span class="text-sm font-black leading-none mt-0.5">${ovr}</span>
                            ${isUnavailable ? '<span class="absolute -top-1 -right-1 text-[10px]">🩹</span>' : ''}
                            
                            <!-- Integrated Two-Way Ironman Badge -->
                            ${otherSlot ? `
                                <span class="absolute -bottom-1 -right-1.5 z-20 text-[7.5px] font-black uppercase px-1 py-0.2 rounded shadow-md border ${side === 'offense' ? 'bg-rose-950 text-rose-300 border-rose-800' : 'bg-blue-950 text-blue-300 border-blue-800'}" title="Also starts at ${otherSlot} on ${otherSide}">
                                    ⚡${otherSlot.substring(0, 2)}
                                </span>
                            ` : ''}
                        </div>
                    </div>

                    <!-- Clean Name Tag -->
                    <div class="mt-1 bg-slate-950 text-white text-[9px] font-bold px-2 py-0.5 rounded shadow-md text-center max-w-[76px] truncate border border-slate-700 group-hover:border-amber-400 transition-colors">
                        ${shortName}
                    </div>
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

/*window.app_openSlotModal = function (side, slotId) {
    const gs = getGameState();
    if (!gs?.playerTeam) return;
    const team = gs.playerTeam;
    const roster = getUIRosterObjects(team);
    const currentChart = team.depthChart[side] || {};
    const otherSide = side === 'offense' ? 'defense' : 'offense';
    const otherChart = team.depthChart[otherSide] || {};
    const currentId = currentChart[slotId];

    let posKey = slotId.replace(/\d+/g, '');
    if (['OT', 'OG', 'C'].includes(posKey)) posKey = 'OL';
    if (posKey === 'FB') posKey = 'RB';
    if (['DE', 'DT', 'NT'].includes(posKey)) posKey = 'DL';
    if (['CB', 'S', 'FS', 'SS'].includes(posKey)) posKey = 'DB';

    // Show all roster players so the coach is never locked out of making a choice
    const candidates = [...roster].filter(Boolean);
    candidates.sort((a, b) => calculateOverall(b, posKey) - calculateOverall(a, posKey));

    window.app_assignSlot = function (s, targetSlot, selectedPid) {
        if (!team.slotOverrides) team.slotOverrides = { offense: {}, defense: {} };
        if (!team.slotOverrides[s]) team.slotOverrides[s] = {};

        if (!selectedPid) {
            // Explicitly clear slot
            team.slotOverrides[s][targetSlot] = null;
            team.depthChart[s][targetSlot] = null;
        } else {
            // Check if player already starts in another slot on THIS side (Trigger clean swap)
            const existingSlot = Object.entries(team.depthChart[s] || {})
                .find(([sl, id]) => id === selectedPid && sl !== targetSlot)?.[0];
            const displacedPid = team.depthChart[s][targetSlot] || null;

            if (existingSlot) {
                if (displacedPid) {
                    team.slotOverrides[s][existingSlot] = displacedPid;
                    team.depthChart[s][existingSlot] = displacedPid;
                } else {
                    delete team.slotOverrides[s][existingSlot];
                    delete team.depthChart[s][existingSlot];
                }
            }

            team.slotOverrides[s][targetSlot] = selectedPid;
            team.depthChart[s][targetSlot] = selectedPid;
        }

        rebuildDepthChartFromOrder(team);
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

        const existingStarterSlotThisSide = Object.entries(currentChart).find(([sl, id]) => id === p.id && sl !== slotId)?.[0];
        let borderClass = isCurrent ? 'bg-amber-50 border-amber-400' : 'bg-white border-slate-200 hover:border-slate-400';
        let energyColor = energy >= 75 ? 'text-emerald-600' : (energy >= 50 ? 'text-amber-600' : 'text-rose-600 font-bold');

        return `
            <button class="w-full text-left p-3 border rounded-sm shadow-sm flex justify-between items-center transition-all ${borderClass}" onclick="app_assignSlot('${side}', '${slotId}', '${p.id}')">
                <div class="flex flex-col truncate pr-2">
                    <div class="flex items-center gap-2">
                        <span class="font-bold text-slate-900 text-sm truncate">${p.name}</span>
                        ${isCurrent ? '<span class="text-[9px] bg-amber-200 text-amber-900 px-1 rounded font-bold uppercase">Current Starter</span>' : ''}
                        ${existingStarterSlotThisSide ? `<span class="text-[9px] bg-blue-100 text-blue-900 border border-blue-300 px-1 rounded font-bold uppercase">⇄ Swap from ${existingStarterSlotThisSide}</span>` : ''}
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
};*/

window.app_openSlotModal = window.openSlotPicker;

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

window.app_setLeagueStatsView = function (view) {
    if (!['all', 'offense', 'defense'].includes(view)) return;

    leagueStatsView = view;
    renderPlayerStatsTab(getGameState());
};

export function renderPlayerStatsTab(gameState) {
    if (!elements.playerStatsContainer || !Array.isArray(gameState?.players)) return;

    const teams = Array.isArray(gameState.teams) ? gameState.teams : [];
    const teamById = new Map(teams.map(team => [String(team.id), team]));

    // Populate the Team dropdown before any early returns.
    // The HTML contains this select, but no initial team options.
    if (elements.statsFilterTeam) {
        const previousTeamId = elements.statsFilterTeam.value || '';

        const teamOptions = [...teams]
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
            .map(team =>
                `<option value="${team.id}">${team.name || 'Unnamed Team'}</option>`
            )
            .join('');

        elements.statsFilterTeam.innerHTML =
            `<option value="">All Teams</option>${teamOptions}`;

        elements.statsFilterTeam.value = teams.some(
            team => String(team.id) === previousTeamId
        ) ? previousTeamId : '';
    }

    const leagueSelect = document.getElementById('stats-filter-league');

    // Explicitly connect filter and sorting changes to the current renderer.
    if (elements.statsFilterTeam) {
        elements.statsFilterTeam.onchange = () =>
            renderPlayerStatsTab(getGameState());
    }

    if (leagueSelect) {
        leagueSelect.onchange = () =>
            renderPlayerStatsTab(getGameState());
    }

    if (elements.statsSort) {
        elements.statsSort.onchange = () =>
            renderPlayerStatsTab(getGameState());
    }

    // Offensive statistics.
    const offensiveStatKeys = [
        'passYards',
        'passAttempts',
        'passCompletions',
        'interceptionsThrown',
        'rushYards',
        'rushAttempts',
        'recYards',
        'receptions',
        'targets',
        'drops',
        'touchdowns',
        'fumbles',
        'fumblesLost',
        'returnYards'
    ];

    // Defensive statistics.
    const defensiveStatKeys = [
        'tackles',
        'sacks',
        'interceptions',
        'fumblesRecovered',
        'safeties',
        'touchdowns'
    ];

    const activeStatColumns = leagueStatsView === 'offense'
        ? PLAYER_STAT_COLUMNS.filter(stat => offensiveStatKeys.includes(stat.key))
        : leagueStatsView === 'defense'
            ? PLAYER_STAT_COLUMNS.filter(stat => defensiveStatKeys.includes(stat.key))
            : PLAYER_STAT_COLUMNS;

    // Keep the sort dropdown synchronized with the active stat view.
    const previousSort = elements.statsSort?.value || 'touchdowns';

    const sortStat = activeStatColumns.some(stat => stat.key === previousSort)
        ? previousSort
        : activeStatColumns.find(stat => stat.key === 'touchdowns')?.key
            || activeStatColumns[0]?.key
            || 'touchdowns';

    if (elements.statsSort) {
        elements.statsSort.innerHTML = activeStatColumns.map(stat =>
            `<option value="${stat.key}">Sort by: ${stat.label}</option>`
        ).join('');

        elements.statsSort.value = sortStat;
    }

    // Before Week 1, clear stale stats and show the kickoff message.
    // Dropdowns are now initialized even when this early return runs.
    if (gameState.currentWeek === 0) {
        const zeroedStats = Object.fromEntries(
            PLAYER_STAT_COLUMNS.map(stat => [stat.key, 0])
        );

        gameState.players.forEach(player => {
            if (!player?.seasonStats) return;

            const hasStats = PLAYER_STAT_COLUMNS.some(
                stat => Number(player.seasonStats[stat.key]) > 0
            );

            if (hasStats) {
                player.seasonStats = { ...zeroedStats };
            }
        });

        elements.playerStatsContainer.innerHTML = `
            <div class="p-8 text-center text-slate-400 font-sans">
                <span class="text-3xl block mb-2">🏈</span>
                <p class="font-bold text-sm text-slate-700 uppercase tracking-wider">
                    Season ${gameState.year || 1} Has Not Started
                </p>
                <p class="text-xs text-slate-500 mt-1">
                    League leaders will update after Week 1 kickoff.
                </p>
            </div>`;
        return;
    }

    const teamIdFilter = elements.statsFilterTeam?.value || '';
    const leagueFilter = leagueSelect?.value || '';

    let players = gameState.players.filter(player => {
        if (!player?.teamId) return false;

        if (
            teamIdFilter &&
            String(player.teamId) !== String(teamIdFilter)
        ) {
            return false;
        }

        const team = teamById.get(String(player.teamId));

        if (leagueFilter) {
            if (!team) return false;
            if (leagueFilter === 'tier1' && team.tier !== 1) return false;
            if (leagueFilter === 'tier2' && team.tier !== 2) return false;
            if (leagueFilter === 'youth' && team.leagueType !== 'youth') return false;
        }

        return true;
    });

    players.sort((a, b) =>
        (Number(b.seasonStats?.[sortStat]) || 0) -
        (Number(a.seasonStats?.[sortStat]) || 0)
    );

    // Preserve the existing 50-player display limit.
    players = players.slice(0, 50);

    const tabClass = view => leagueStatsView === view
        ? 'bg-slate-900 text-white shadow-sm'
        : 'text-slate-600 hover:bg-white';

    const statHeaders = activeStatColumns.map(stat =>
        `<th class="py-2 px-2 text-center whitespace-nowrap">${stat.label}</th>`
    ).join('');

    const playerRows = players.length > 0
        ? players.map(player => {
            const stats = player.seasonStats || {};
            const team = teamById.get(String(player.teamId));
            const pos = player.pos || estimateBestPosition(player);

            const leagueName = !team
                ? '—'
                : team.leagueType === 'youth'
                    ? 'Pee-Wee League'
                    : team.tier === 1
                        ? 'Premier Parks'
                        : team.tier === 2
                            ? 'Sandlot Circuit'
                            : '—';

            const statCells = activeStatColumns.map(stat =>
                `<td class="py-1.5 px-2 text-center whitespace-nowrap">
                    ${Number(stats[stat.key]) || 0}
                </td>`
            ).join('');

            return `
                <tr class="hover:bg-gray-50 cursor-pointer transition"
                    onclick="app.openPlayerCard('${player.id}')">
                    <td class="py-1.5 px-3 font-semibold text-gray-800 whitespace-nowrap">
                        ${player.name}
                    </td>
                    <td class="py-1.5 px-3 text-gray-700 whitespace-nowrap">
                        ${team?.name || '—'}
                    </td>
                    <td class="py-1.5 px-3 text-gray-600 whitespace-nowrap">
                        ${leagueName}
                    </td>
                    <td class="py-1.5 px-2 text-center">${player.age ?? '—'}</td>
                    <td class="py-1.5 px-2 text-center font-bold">${pos}</td>
                    ${statCells}
                </tr>`;
        }).join('')
        : `<tr>
            <td colspan="${5 + activeStatColumns.length}"
                class="p-6 text-center text-slate-400 italic">
                No players match the current filters.
            </td>
        </tr>`;

    elements.playerStatsContainer.innerHTML = `
        <div class="sticky top-0 z-20 bg-slate-50 border-b border-slate-200 p-3
                    flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap gap-1 rounded border border-slate-300
                        bg-slate-200 p-1 text-xs font-bold">
                <button
                    class="px-3 py-1.5 rounded transition ${tabClass('all')}"
                    onclick="app_setLeagueStatsView('all')">
                    All Stats
                </button>
                <button
                    class="px-3 py-1.5 rounded transition ${tabClass('offense')}"
                    onclick="app_setLeagueStatsView('offense')">
                    🏈 Offense
                </button>
                <button
                    class="px-3 py-1.5 rounded transition ${tabClass('defense')}"
                    onclick="app_setLeagueStatsView('defense')">
                    🛡️ Defense
                </button>
            </div>
            <span class="text-[10px] text-slate-500 font-mono">
                Showing ${players.length} players · Sorted by ${activeStatColumns.find(stat => stat.key === sortStat)?.label || sortStat}
            </span>
        </div>

        <div class="overflow-x-auto">
            <table class="min-w-full bg-white text-xs">
                <thead class="bg-gray-800 text-white uppercase text-[10px] tracking-wider">
                    <tr>
                        <th class="py-2 px-3 text-left whitespace-nowrap">Player</th>
                        <th class="py-2 px-3 text-left whitespace-nowrap">Team</th>
                        <th class="py-2 px-3 text-left whitespace-nowrap">League</th>
                        <th class="py-2 px-2 text-center">Age</th>
                        <th class="py-2 px-2 text-center">Pos</th>
                        ${statHeaders}
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                    ${playerRows}
                </tbody>
            </table>
        </div>`;
}

export function renderHallOfFameTab(gameState) {
    if (!elements.hallOfFameList) return;
    if (!gameState?.hallOfFame?.length) {
        elements.hallOfFameList.innerHTML = `<p class="text-gray-400 text-sm text-center py-12">Hall of Fame is empty.</p>`;
        return;
    }
    elements.hallOfFameList.innerHTML = gameState.hallOfFame.map(p => {
        const stats = p.careerStats || {};

        return `
            <div class="bg-white p-3 rounded-lg border border-amber-200 shadow-sm mb-2">
                <h4 class="font-bold text-amber-800">${p.name}</h4>

                <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2 text-xs text-gray-600">
                    <span>TDs: <b>${stats.touchdowns || 0}</b></span>
                    <span>Pass Yds: <b>${stats.passYards || 0}</b></span>
                    <span>Rush Yds: <b>${stats.rushYards || 0}</b></span>
                    <span>Rec Yds: <b>${stats.recYards || 0}</b></span>
                    <span>Tackles: <b>${stats.tackles || 0}</b></span>
                    <span>Sacks: <b>${stats.sacks || 0}</b></span>
                    <span>INTs: <b>${stats.interceptions || 0}</b></span>
                    <span>Seasons: <b>${stats.seasonsPlayed || 0}</b></span>
                </div>
            </div>
        `;
    }).join('');
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

/** Renders the 'Messages' tab content. */
export function renderMessagesTab(gameState) {
    if (!elements.messagesList) return;

    const messages = Array.isArray(gameState?.messages)
        ? gameState.messages.filter(Boolean)
        : [];

    if (messages.length === 0) {
        elements.messagesList.innerHTML = `
            <div class="rounded-lg border border-slate-200 bg-white p-8 text-center">
                <div class="text-3xl mb-3">✉️</div>
                <h3 class="font-bold text-slate-700">Your inbox is clear</h3>
                <p class="text-sm text-slate-500 mt-1">
                    Team updates, staff news, and important decisions will appear here.
                </p>
            </div>
        `;
        updateMessagesNotification(messages);
        return;
    }

    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const getCategory = (message) => {
        if (message.category) return message.category;

        // Fallback for messages created before category metadata existed.
        const subject = String(message.subject || '').toLowerCase();

        if (/(staff|coach|stipend|hiring|hire|fired|workload|availability)/.test(subject)) {
            return 'staff';
        }

        if (/(fund|dues|snack|store|favor token|budget|payment|financial|fundrais)/.test(subject)) {
            return 'finances';
        }

        if (/(draft|scout|scouting|prospect|rookie)/.test(subject)) {
            return 'scouting';
        }

        if (/(practice|training|development|gameplan|game plan|playbook|depth chart|opponent)/.test(subject)) {
            return 'preparation';
        }

        if (/(injur|recover|unavailable|roster|player joined|new player|signed|cut|retir|graduat|invite)/.test(subject)) {
            return 'roster';
        }

        if (/(season|offseason|promot|relegat|champion|week \d+)/.test(subject)) {
            return 'season';
        }

        if (/(friend|relationship|rival|happiness|morale|locker room)/.test(subject)) {
            return 'community';
        }

        return 'general';
    };

    const categoryLabels = {
        staff: 'Staff',
        finances: 'Finances',
        scouting: 'Scouting',
        preparation: 'Preparation',
        roster: 'Roster',
        season: 'Season',
        community: 'Community',
        general: 'General'
    };

    const categoryClasses = {
        staff: 'bg-violet-100 text-violet-700',
        finances: 'bg-emerald-100 text-emerald-700',
        scouting: 'bg-sky-100 text-sky-700',
        preparation: 'bg-indigo-100 text-indigo-700',
        roster: 'bg-amber-100 text-amber-800',
        season: 'bg-slate-200 text-slate-700',
        community: 'bg-pink-100 text-pink-700',
        general: 'bg-slate-100 text-slate-600'
    };

    const getPriorityScore = (message) => {
        if (message.priority === 'urgent') return 0;
        if (message.actionRequired || message.priority === 'important') return 1;
        if (!message.isRead) return 2;
        return 3;
    };

    const getPreview = (body) => {
        const plainText = String(body ?? '')
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/<\/p\s*>/gi, ' ')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const preview = plainText.length > 150
            ? `${plainText.slice(0, 147)}...`
            : plainText;

        return escapeHtml(preview || 'Open this message to read the details.');
    };

    const orderedMessages = messages
        .map((message, index) => ({ message, index }))
        .sort((a, b) => {
            const priorityDifference =
                getPriorityScore(a.message) - getPriorityScore(b.message);

            if (priorityDifference !== 0) return priorityDifference;

            const timeA = Number(a.message.createdAt);
            const timeB = Number(b.message.createdAt);

            if (Number.isFinite(timeA) && Number.isFinite(timeB) &&
                timeA > 0 && timeB > 0 && timeA !== timeB) {
                return timeB - timeA;
            }

            // Preserve the existing newest-first order for older messages.
            return a.index - b.index;
        });

    const unreadCount = messages.filter(message => !message.isRead).length;
    const actionCount = messages.filter(message =>
        message.actionRequired
    ).length;

    const messageCards = orderedMessages.map(({ message: msg }) => {
        const category = getCategory(msg);
        const categoryLabel = categoryLabels[category] || 'General';
        const categoryClass = categoryClasses[category] || categoryClasses.general;
        const isUnread = !msg.isRead;
        const needsAction = Boolean(msg.actionRequired);
        const isUrgent = msg.priority === 'urgent';

        const statusLabel = needsAction
            ? 'Action needed'
            : isUrgent
                ? 'Urgent'
                : isUnread
                    ? 'Unread'
                    : '';

        const statusClass = needsAction || isUrgent
            ? 'bg-rose-100 text-rose-700'
            : 'bg-blue-100 text-blue-700';

        const weekLabel = msg.week != null
            ? `Week ${escapeHtml(msg.week)}`
            : '';

        const yearLabel = msg.year != null
            ? `Season ${escapeHtml(msg.year)}`
            : '';

        const timelineLabel = [yearLabel, weekLabel]
            .filter(Boolean)
            .join(' · ');

        return `
            <button
                type="button"
                class="message-item group w-full text-left rounded-lg border p-3 sm:p-4 transition-colors mb-2
                    ${isUnread
                        ? 'bg-blue-50/70 border-blue-200 hover:bg-blue-50'
                        : 'bg-white border-slate-200 hover:bg-slate-50'}
                    ${needsAction ? 'ring-1 ring-rose-200' : ''}"
                data-message-id="${escapeHtml(msg.id)}"
            >
                <div class="flex items-start gap-3">
                    <div class="shrink-0 mt-1">
                        <span class="block w-2.5 h-2.5 rounded-full
                            ${isUnread ? 'bg-blue-600' : 'bg-transparent border border-slate-300'}"
                            aria-hidden="true"></span>
                    </div>

                    <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2 mb-1">
                            <span class="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${categoryClass}">
                                ${escapeHtml(categoryLabel)}
                            </span>

                            ${statusLabel ? `
                                <span class="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusClass}">
                                    ${escapeHtml(statusLabel)}
                                </span>
                            ` : ''}
                        </div>

                        <div class="flex items-start justify-between gap-3">
                            <span class="min-w-0 break-words text-sm
                                ${isUnread ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}">
                                ${escapeHtml(msg.subject || '(No Subject)')}
                            </span>

                            <span class="shrink-0 text-[10px] text-slate-400">
                                ${escapeHtml(timelineLabel)}
                            </span>
                        </div>

                        <p class="mt-1 text-xs leading-relaxed text-slate-500 font-normal">
                            ${getPreview(msg.body)}
                        </p>

                        <div class="mt-2 flex items-center justify-between gap-2">
                            <span class="text-[10px] text-slate-400">
                                ${isUnread ? 'New message' : 'Message'}
                            </span>
                            <span class="text-xs font-semibold text-slate-500 group-hover:text-slate-800">
                                Open →
                            </span>
                        </div>
                    </div>
                </div>
            </button>
        `;
    }).join('');

    elements.messagesList.innerHTML = `
        <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
                <h3 class="text-base font-bold text-slate-800">Team Inbox</h3>
                <p class="text-xs text-slate-500 mt-1">
                    Updates and decisions from around your team.
                </p>
            </div>

            <div class="flex flex-wrap gap-2">
                <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                    ${messages.length} total
                </span>
                <span class="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
                    ${unreadCount} unread
                </span>
                ${actionCount > 0 ? `
                    <span class="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">
                        ${actionCount} need${actionCount === 1 ? 's' : ''} attention
                    </span>
                ` : ''}
            </div>
        </div>

        <div class="space-y-1">
            ${messageCards}
        </div>
    `;

    updateMessagesNotification(messages);
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

    const legacyTabClasses = [
        "bg-blue-50",
        "text-blue-900",
        "border-blue-200",
        "bg-emerald-50",
        "text-emerald-900",
        "border-emerald-200",
        "text-amber-700",
        "bg-amber-50",
        "border-amber-200",
        "text-amber-600",
        "border-amber-500",
        "bg-slate-900",
        "text-white",
        "border-slate-900",
        "bg-white",
        "text-slate-600",
        "border-transparent",
        "shadow-sm",
        "border"
    ];

    const setActiveTabStyle = (activeSubTab) => {
        subTabs.forEach(t => {
            t.classList.remove(...legacyTabClasses);

            if (t.dataset.subTab === activeSubTab) {
                t.classList.add(
                    "active",
                    "bg-slate-900",
                    "text-white",
                    "border",
                    "border-slate-900",
                    "shadow-sm"
                );
            } else {
                t.classList.remove("active");
                t.classList.add(
                    "bg-white",
                    "text-slate-600",
                    "border",
                    "border-transparent"
                );
            }
        });
    };

    const switchSubTab = (subTab) => {
        setActiveTabStyle(subTab);

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

        const gs = getGameState();
        if (subTab === "offense") {
            renderFormationPills('offense', offenseFormations, gs?.playerTeam?.formations?.offense);
            renderDepthChartSide('offense', gs);
        }
        if (subTab === "defense") {
            renderFormationPills('defense', defenseFormations, gs?.playerTeam?.formations?.defense);
            renderDepthChartSide('defense', gs);
        }
        if (subTab === "overalls") renderPositionalOveralls();
        if (subTab === "depth-order") renderDepthOrderPane(gs);
        if (subTab === "playbook") renderPlaybookManager(gs);
        if (subTab === "practice") renderPracticeManager(gs);
    };

    const initialSubTab = document.querySelector(".depth-chart-tab.active")?.dataset.subTab || "depth-order";
    switchSubTab(initialSubTab);

    subTabs.forEach(tab => {
        tab.addEventListener("click", () => {
            switchSubTab(tab.dataset.subTab);
        });
    });
}

// Helper: Clean up display names for offensive & defensive plays (removes raw code underscores)
function getPlayDisplayName(play, key) {
    if (play?.name) return play.name;
    return key
        .replace(/^Uni_/, '')
        .replace(/^PA_/, 'PA ')
        .replace(/^RPO_/, 'RPO ')
        .replace(/^Trick_/, '')
        .replace(/_/g, ' ');
}

// Helper: Derive 8-man skill personnel packaging (e.g. "3 WR · 1 RB")
function getPlayPersonnelBadge(play, teamFormation) {
    const formKey = (play?.compatibleFormations && play.compatibleFormations[0]) || teamFormation || 'Balanced';
    const form = offenseFormations[formKey] || offenseFormations['Balanced'];
    const p = form?.personnel || { WR: 2, TE: 1, RB: 1 };

    const parts = [];
    if (p.WR) parts.push(`${p.WR} WR`);
    if (p.TE) parts.push(`${p.TE} TE`);
    if (p.RB) parts.push(`${p.RB} RB`);
    return parts.join(' · ') || 'Standard';
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

    if (!team.gameplan.situational) {
        Game.aiSetSituationalGameplan(team);
    }

    const sit = team.gameplan.situational;
    const isGM = sit.playcaller === 'GM';
    const clash = Game.calculateSchemeClash(team);
    const disabledAttr = isGM ? '' : 'disabled';
    const sliderOpac = isGM ? 'opacity-100' : 'opacity-50 cursor-not-allowed';

    let clashHtml = '';
    if (isGM) {
        if (clash === 0) clashHtml = `<span class="text-emerald-600 font-bold">Coach is aligned with your gameplan.</span>`;
        else if (clash < 6) clashHtml = `<span class="text-amber-600 font-bold">Coach is annoyed by your scheme (-${clash} IQ Penalty).</span>`;
        else clashHtml = `<span class="text-rose-600 font-bold">Coach is furious! Kids are confused (-${clash} IQ Penalty).</span>`;
    } else {
        clashHtml = `<span class="text-blue-600 font-bold">Coach has full control. Synergy bonuses active.</span>`;
    }

    // 4 Locked Standard Fundamentals per side (12 Total: 4 Fundamentals + 8 Napkin slots)
    const BASICS_OFF = ['Uni_InsideZone', 'Uni_StretchRight', 'Uni_QuickSlants', 'Uni_FourVerts'];
    const BASICS_DEF = ['Cover_2_Zone_Base', 'Cover_1_Robber', 'Man_Blitz_Base', 'GoalLine_RunStuff'];

    if (!team.gameplan) team.gameplan = {};

    // 1. Strip any locked BASICS out of custom arrays and eliminate any duplicate entries
    team.gameplan.installedOffense = Array.from(new Set(team.gameplan.installedOffense || []))
        .filter(k => !BASICS_OFF.includes(k) && offensivePlaybook[k])
        .slice(0, 8);

    team.gameplan.installedDefense = Array.from(new Set(team.gameplan.installedDefense || []))
        .filter(k => !BASICS_DEF.includes(k) && defensivePlaybook[k])
        .slice(0, 8);

    // Default starters if empty
    if (team.gameplan.installedOffense.length === 0) {
        team.gameplan.installedOffense = ['Uni_Stick', 'Uni_Drive', 'Uni_HB_Screen', 'PA_Crossers', 'Uni_Mesh', 'Uni_Counter_Trap', 'Uni_PowerLead', 'Uni_Double_Moves'];
    }
    if (team.gameplan.installedDefense.length === 0) {
        team.gameplan.installedDefense = ['Cover_3_Sky', 'Nickel_Tampa_2', 'Fire_Zone_3', 'Cover_6_Split', 'Cover_3_Drop', 'Nickel_Strong_Blitz', 'Overload_Blitz_Right', 'Dime_Lockdown'];
    }

    // Active 12-play unified lists (Guaranteed 0 duplicates)
    const activeOffKeys = [...BASICS_OFF, ...team.gameplan.installedOffense];
    const activeDefKeys = [...BASICS_DEF, ...team.gameplan.installedDefense];

    // Active Unit Switcher ('offense' vs 'defense') & Library Filter State
    window._activePlaybookUnit = window._activePlaybookUnit || 'offense';
    window._activePlaybookTabOff = window._activePlaybookTabOff || 'all';
    window._activePlaybookTabDef = window._activePlaybookTabDef || 'all';

    window.app_setPlaybookUnit = (unit) => {
        window._activePlaybookUnit = unit;
        renderPlaybookManager(gameState);
    };

    window.app_setPlaybookTab = (side, tabKey) => {
        if (side === 'offense') window._activePlaybookTabOff = tabKey;
        else window._activePlaybookTabDef = tabKey;
        renderPlaybookManager(gameState);
    };

    const isOffense = window._activePlaybookUnit === 'offense';

    window.app_toggleInstallPlay = (key, side) => {
        const list = side === 'offense' ? team.gameplan.installedOffense : team.gameplan.installedDefense;
        const maxCustom = 8; // Exactly 8 custom slots + 4 standard locks = 12 Total
        const idx = list.indexOf(key);

        if (idx > -1) {
            list.splice(idx, 1);
        } else {
            if (list.length >= maxCustom) {
                showModal("Gameplan Napkin Full", `
                    <div class="text-xs text-slate-700 space-y-2">
                        <p>Your team's active gameplan already has all <b>${maxCustom} custom slots filled</b> (12 total plays with fundamentals).</p>
                        <p class="text-slate-500 italic">Click <b>"Uninstall"</b> on any custom play above to free up a slot for this concept.</p>
                    </div>
                `);
                return;
            }
            list.push(key);
            if (!team.gameplan.mastery[key]) team.gameplan.mastery[key] = 40;
        }
        renderPlaybookManager(gameState);
        saveGameState();
    };

    const offAvailable = Object.entries(offensivePlaybook || {}).filter(([k]) => k !== 'Punt_Punt' && !BASICS_OFF.includes(k));
    const defAvailable = Object.entries(defensivePlaybook || {}).filter(([k]) => k !== 'PuntReturn_Classic' && !BASICS_DEF.includes(k));

    container.innerHTML = `
        <div class="space-y-4 text-xs font-sans pb-6">
            
            <!-- SIDELINE CLIPBOARD (SITUATIONAL TENDENCIES) -->
            <div class="bg-white border border-slate-300 rounded p-4 shadow-sm space-y-4">
                <div class="flex justify-between items-center border-b border-slate-200 pb-2">
                    <div>
                        <h4 class="font-black text-sm uppercase tracking-wider text-slate-900">Sideline Clipboard (Tendencies)</h4>
                        <p id="clipboard-clash-warning" class="text-[11px] mt-0.5">${clashHtml}</p>
                    </div>
                    <select class="p-1.5 border border-slate-300 rounded font-bold text-slate-800 bg-slate-50 outline-none" onchange="app_updateClipboard('playcaller', this.value)">
                        <option value="COACH" ${!isGM ? 'selected' : ''}>Delegate to Coach (Auto)</option>
                        <option value="GM" ${isGM ? 'selected' : ''}>GM Manual Control</option>
                    </select>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 ${sliderOpac}">
                    <!-- Offense Early Downs -->
                    <div>
                        <div class="flex justify-between text-[10px] font-bold text-slate-500 uppercase mb-1">
                            <span>Air it Out</span>
                            <span>Early Downs (1st & 2nd)</span>
                            <span>Ground & Pound</span>
                        </div>
                        <input type="range" min="0" max="100" value="${sit.earlyDownTendency}" class="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-amber-500" ${disabledAttr}
                            onchange="app_updateClipboard('earlyDownTendency', this.value)" oninput="document.getElementById('val-edt').textContent = this.value + '% Run'">
                        <div class="text-center text-[10px] font-mono text-slate-600 mt-0.5" id="val-edt">${sit.earlyDownTendency}% Run</div>
                    </div>

                    <!-- Offense 3rd Down -->
                    <div>
                        <div class="flex justify-between text-[10px] font-bold text-slate-500 uppercase mb-1">
                            <span>Safe / Draws</span>
                            <span>3rd & Long Aggression</span>
                            <span>Playground Hero</span>
                        </div>
                        <input type="range" min="0" max="100" value="${sit.thirdAndLongAggressiveness}" class="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-500" ${disabledAttr}
                            onchange="app_updateClipboard('thirdAndLongAggressiveness', this.value)" oninput="document.getElementById('val-3rd').textContent = this.value + '% Aggro'">
                        <div class="text-center text-[10px] font-mono text-slate-600 mt-0.5" id="val-3rd">${sit.thirdAndLongAggressiveness}% Aggro</div>
                    </div>

                    <!-- 4th Down Bravery -->
                    <div>
                        <div class="flex justify-between text-[10px] font-bold text-slate-500 uppercase mb-1">
                            <span>Always Punt</span>
                            <span>4th Down Bravery</span>
                            <span>Riverboat Gambler</span>
                        </div>
                        <input type="range" min="0" max="100" value="${sit.fourthDownBravery}" class="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-500" ${disabledAttr}
                            onchange="app_updateClipboard('fourthDownBravery', this.value)" oninput="document.getElementById('val-4th').textContent = this.value + '% Gambler'">
                        <div class="text-center text-[10px] font-mono text-slate-600 mt-0.5" id="val-4th">${sit.fourthDownBravery}% Gambler</div>
                    </div>

                    <!-- Defense Aggressiveness -->
                    <div>
                        <div class="flex justify-between text-[10px] font-bold text-slate-500 uppercase mb-1">
                            <span>Soft Zone / Prevent</span>
                            <span>Defense Aggression</span>
                            <span>Heavy Blitz / Man</span>
                        </div>
                        <input type="range" min="0" max="100" value="${sit.defenseAggressiveness}" class="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-rose-500" ${disabledAttr}
                            onchange="app_updateClipboard('defenseAggressiveness', this.value)" oninput="document.getElementById('val-def').textContent = this.value + '% Blitz'">
                        <div class="text-center text-[10px] font-mono text-slate-600 mt-0.5" id="val-def">${sit.defenseAggressiveness}% Blitz</div>
                    </div>
                </div>
            </div>

            <!-- Strategic Header & Unit Toggle Bar -->
            <div class="bg-slate-900 text-white p-3.5 rounded flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shadow-sm">
                <div>
                    <h4 class="font-black text-sm uppercase tracking-wider text-amber-400">Cafeteria Napkin Playbook (12 Plays Total)</h4>
                    <p class="text-slate-400 text-[11px] mt-0.5">4 Standard Fundamentals (Locked) + 8 Custom Gameplan Napkin slots.</p>
                </div>
                
                <!-- The Primary Offense / Defense Toggle Bar -->
                <div class="flex bg-slate-950 p-1 rounded border border-slate-700 gap-1 w-full sm:w-auto">
                    <button class="flex-1 sm:flex-none px-4 py-2 rounded text-xs font-black uppercase tracking-wider transition ${isOffense ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white bg-slate-800/80'}" onclick="app_setPlaybookUnit('offense')">
                        🏈 Offense (${4 + team.gameplan.installedOffense.length}/12)
                    </button>
                    <button class="flex-1 sm:flex-none px-4 py-2 rounded text-xs font-black uppercase tracking-wider transition ${!isOffense ? 'bg-rose-600 text-white shadow-md' : 'text-slate-400 hover:text-white bg-slate-800/80'}" onclick="app_setPlaybookUnit('defense')">
                        🛡️ Defense (${4 + team.gameplan.installedDefense.length}/12)
                    </button>
                </div>
            </div>

            ${isOffense ? `
            <!-- OFFENSIVE SECTION (4-IN-A-ROW GRID) -->
            <div class="bg-white border border-slate-300 rounded p-3 shadow-sm space-y-3">
                <div class="flex flex-wrap justify-between items-center border-b pb-2 gap-2">
                    <div>
                        <h5 class="font-black uppercase tracking-wider text-blue-950 text-xs">Active Offensive Gameplan (${4 + team.gameplan.installedOffense.length}/12 Plays Active)</h5>
                        <p class="text-[10px] text-slate-500 font-mono">Row 1: 4 Standard Fundamentals • Rows 2 & 3: Up to 8 Custom Installs</p>
                    </div>
                    <span class="text-[10px] font-mono bg-blue-50 text-blue-800 border border-blue-200 px-2 py-0.5 rounded font-bold">
                        Scheme: ${team.formations?.offense || 'Balanced'}
                    </span>
                </div>

                <!-- Active 12-Play Grid: Exactly 4 in a row -->
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    ${activeOffKeys.map((key, idx) => {
                        const play = offensivePlaybook[key] || { tags: ['run'] };
                        const isBasic = idx < BASICS_OFF.length;
                        const customSlotNum = idx - BASICS_OFF.length + 1;
                        const mastery = team.gameplan.mastery[key] || (isBasic ? 85 : 40);
                        const cleanName = getPlayDisplayName(play, key);
                        const personnelBadge = getPlayPersonnelBadge(play, team.formations?.offense);
                        let barColor = mastery >= 75 ? 'bg-emerald-500' : (mastery >= 50 ? 'bg-amber-500' : 'bg-rose-500');

                        return `
                        <div class="p-2.5 rounded border ${isBasic ? 'border-slate-300 bg-slate-50' : 'border-blue-300 bg-blue-50/50'} hover:shadow-md transition cursor-pointer flex flex-col justify-between group" onclick="app_previewPlay('${key}', 'offense')">
                            <div>
                                <div class="flex justify-between items-start mb-1">
                                    <span class="font-bold text-slate-900 group-hover:text-blue-700 transition truncate text-[11px]" title="${cleanName}">${cleanName} 🔍</span>
                                    <span class="text-[8px] font-black uppercase px-1 rounded ${isBasic ? 'bg-slate-200 text-slate-700' : 'bg-blue-700 text-white'}">
                                        ${isBasic ? 'LOCKED' : `#${customSlotNum}`}
                                    </span>
                                </div>
                                <div class="flex items-center gap-1.5 mb-1.5">
                                    <span class="text-[8px] bg-white border border-slate-200 text-slate-600 px-1 rounded font-mono">${personnelBadge}</span>
                                    <span class="text-[8px] bg-blue-100 text-blue-900 px-1 rounded font-bold uppercase">${play.tags?.[0] || play.type}</span>
                                </div>
                                <div class="flex items-center justify-between text-[9px] text-slate-500 font-mono">
                                    <span>Mastery: <b>${mastery}%</b></span>
                                    <div class="w-12 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                                        <div class="${barColor} h-full" style="width: ${mastery}%"></div>
                                    </div>
                                </div>
                            </div>
                            <div class="mt-2 pt-1 border-t ${isBasic ? 'border-slate-200' : 'border-blue-200'} flex justify-between items-center text-[9px]">
                                <span class="text-slate-400 capitalize truncate">${isBasic ? 'Backyard Basic' : 'Custom Gameplan'}</span>
                                ${isBasic ? '<span class="text-slate-400 font-bold uppercase">Basic</span>' : `
                                <button class="px-1.5 py-0.5 rounded font-bold uppercase bg-rose-100 text-rose-800 hover:bg-rose-200 transition" onclick="event.stopPropagation(); app_toggleInstallPlay('${key}', 'offense')">
                                    Uninstall
                                </button>`}
                            </div>
                        </div>`;
                    }).join('')}
                    ${Array.from({ length: Math.max(0, 8 - team.gameplan.installedOffense.length) }).map(() => `
                        <div class="p-3 rounded border border-dashed border-slate-300 bg-slate-50/50 flex flex-col items-center justify-center text-center text-slate-400 min-h-[75px]">
                            <span class="text-xs font-bold">+ Empty Slot</span>
                            <span class="text-[9px] text-slate-400">Install from library below</span>
                        </div>
                    `).join('')}
                </div>

                <!-- Available Library with Refined Tabs & Full Catalog View -->
                <div class="pt-3 border-t">
                    <div class="flex flex-wrap justify-between items-center mb-2 gap-2">
                        <span class="font-bold text-[10px] uppercase text-slate-600 tracking-wider">Offensive Playbook Catalog</span>
                        <div class="flex bg-slate-100 p-0.5 rounded border border-slate-300 text-[10px] font-bold">
                            <button class="px-2 py-0.5 rounded ${window._activePlaybookTabOff === 'all' ? 'bg-slate-900 text-white' : 'text-slate-600'}" onclick="app_setPlaybookTab('offense', 'all')">All</button>
                            <button class="px-2 py-0.5 rounded ${window._activePlaybookTabOff === 'scheme' ? 'bg-blue-600 text-white' : 'text-blue-700'}" onclick="app_setPlaybookTab('offense', 'scheme')" title="Plays matching your active ${team.formations?.offense} formation">⚡ Scheme Fits</button>
                            <button class="px-2 py-0.5 rounded ${window._activePlaybookTabOff === 'run' ? 'bg-slate-900 text-white' : 'text-slate-600'}" onclick="app_setPlaybookTab('offense', 'run')">Ground</button>
                            <button class="px-2 py-0.5 rounded ${window._activePlaybookTabOff === 'quick' ? 'bg-slate-900 text-white' : 'text-slate-600'}" onclick="app_setPlaybookTab('offense', 'quick')">Quick & Screen</button>
                            <button class="px-2 py-0.5 rounded ${window._activePlaybookTabOff === 'deep' ? 'bg-slate-900 text-white' : 'text-slate-600'}" onclick="app_setPlaybookTab('offense', 'deep')">Vertical & Cross</button>
                            <button class="px-2 py-0.5 rounded ${window._activePlaybookTabOff === 'action' ? 'bg-slate-900 text-white' : 'text-slate-600'}" onclick="app_setPlaybookTab('offense', 'action')">Action & Tricks</button>
                        </div>
                    </div>

                    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                        ${offAvailable.filter(([k, play]) => {
                            const isCompatible = !play.compatibleFormations || play.compatibleFormations.includes(team.formations?.offense || 'Balanced');
                            if (window._activePlaybookTabOff === 'scheme') return isCompatible;
                            if (window._activePlaybookTabOff === 'run') return play.type === 'run';
                            if (window._activePlaybookTabOff === 'quick') return play.tags?.includes('quick') || play.tags?.includes('short') || play.tags?.includes('screen');
                            if (window._activePlaybookTabOff === 'deep') return play.tags?.includes('deep') || play.tags?.includes('cross') || play.tags?.includes('flood') || play.tags?.includes('vertical');
                            if (window._activePlaybookTabOff === 'action') return play.tags?.includes('pa') || play.tags?.includes('rpo') || play.tags?.includes('trick');
                            return true;
                        }).map(([key, play]) => {
                            const isInstalledCustom = team.gameplan.installedOffense.includes(key);
                            const isLockedBasic = BASICS_OFF.includes(key);
                            const isActive = isInstalledCustom || isLockedBasic;
                            const mastery = team.gameplan.mastery[key] || (isLockedBasic ? 85 : 35);
                            const isCompatible = !play.compatibleFormations ||
                                play.compatibleFormations.includes(team.formations?.offense || 'Balanced');
                            const cleanName = getPlayDisplayName(play, key);
                            const personnelBadge = getPlayPersonnelBadge(play, team.formations?.offense);

                            const schemeFitBadge = !play.compatibleFormations
                                ? '<span class="text-[8px] bg-slate-100 text-slate-500 px-1 rounded">All Formations</span>'
                                : isCompatible
                                    ? '<span class="text-[8px] bg-emerald-100 text-emerald-800 px-1 rounded font-bold">✓ Scheme Fit</span>'
                                    : `<span class="text-[8px] bg-slate-100 text-slate-600 px-1 rounded font-bold"
                                               title="Compatible formations: ${play.compatibleFormations.join(', ')}">
                                           Fits: ${play.compatibleFormations.join(', ')}
                                       </span>`;

                            return `
                            <div class="p-2 rounded border ${isActive ? 'border-emerald-300 bg-emerald-50/30' : 'border-slate-200 bg-white hover:border-blue-400'} flex flex-col justify-between transition cursor-pointer group shadow-sm" onclick="app_previewPlay('${key}', 'offense')">
                                <div class="truncate mb-1.5">
                                    <div class="flex justify-between items-start">
                                        <span class="font-bold text-slate-800 group-hover:text-blue-700 truncate text-[11px]" title="${cleanName}">${cleanName} 🔍</span>
                                    </div>
                                    <div class="flex items-center gap-1 mt-0.5">
                                        <span class="text-[8px] bg-slate-100 text-slate-600 px-1 rounded font-mono">${personnelBadge}</span>
                                        ${schemeFitBadge}
                                    </div>
                                </div>
                                <div class="flex justify-between items-center border-t pt-1">
                                    <span class="text-[9px] text-slate-400 font-mono">${mastery}% Mst</span>
                                    ${isInstalledCustom ? `
                                        <div class="flex items-center gap-1">
                                            <span class="text-[9px] font-black uppercase text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">✓ In Plan</span>
                                            <button class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-rose-100 text-rose-800 hover:bg-rose-200 transition"
                                                    onclick="event.stopPropagation(); app_toggleInstallPlay('${key}', 'offense')">
                                                Uninstall
                                            </button>
                                        </div>
                                    ` : `
                                        <button class="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-slate-900 text-white hover:bg-slate-800 transition"
                                                onclick="event.stopPropagation(); app_toggleInstallPlay('${key}', 'offense')">
                                            + Install
                                        </button>
                                    `}
                                </div>
                            </div>`;
                        }).join('')}
                    </div>
                </div>
            </div>
            ` : `
            <!-- DEFENSIVE SECTION (4-IN-A-ROW GRID) -->
            <div class="bg-white border border-slate-300 rounded p-3 shadow-sm space-y-3">
                <div class="flex flex-wrap justify-between items-center border-b pb-2 gap-2">
                    <div>
                        <h5 class="font-black uppercase tracking-wider text-red-950 text-xs">Active Defensive Gameplan (${4 + team.gameplan.installedDefense.length}/12 Plays Active)</h5>
                        <p class="text-[10px] text-slate-500 font-mono">Row 1: 4 Standard Fundamentals • Rows 2 & 3: Up to 8 Custom Installs</p>
                    </div>
                    <span class="text-[10px] font-mono bg-red-50 text-red-800 border border-red-200 px-2 py-0.5 rounded font-bold">
                        Scheme: ${team.formations?.defense || '3-2-3'}
                    </span>
                </div>

                <!-- Active 12-Play Grid: Exactly 4 in a row -->
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    ${activeDefKeys.map((key, idx) => {
                        const play = defensivePlaybook[key] || { name: key };
                        const isBasic = idx < BASICS_DEF.length;
                        const customSlotNum = idx - BASICS_DEF.length + 1;
                        const mastery = team.gameplan.mastery[key] || (isBasic ? 85 : 40);
                        const cleanName = getPlayDisplayName(play, key);
                        const conceptLabel = play.concept || 'Scheme';
                        const tagLabel = (play.tags?.[0] || (play.blitz ? 'blitz' : 'coverage'))
                            .replace(/_/g, ' ');
                        const barColor = mastery >= 75
                            ? 'bg-emerald-500'
                            : (mastery >= 50 ? 'bg-amber-500' : 'bg-rose-500');

                        return `
                        <div class="p-2.5 rounded border ${isBasic ? 'border-slate-300 bg-slate-50' : 'border-red-300 bg-red-50/50'} hover:shadow-md transition cursor-pointer flex flex-col justify-between group"
                             onclick="app_previewPlay('${key}', 'defense')">
                            <div>
                                <div class="flex justify-between items-start mb-1">
                                    <span class="font-bold text-slate-900 group-hover:text-rose-700 transition truncate text-[11px]"
                                          title="${cleanName}">${cleanName} 🔍</span>
                                    <span class="text-[8px] font-black uppercase px-1 rounded ${isBasic ? 'bg-slate-200 text-slate-700' : 'bg-red-700 text-white'}">
                                        ${isBasic ? 'LOCKED' : `#${customSlotNum}`}
                                    </span>
                                </div>

                                <div class="flex items-center gap-1.5 mb-1.5">
                                    <span class="text-[8px] bg-white border border-slate-200 text-slate-600 px-1 rounded font-mono">${conceptLabel}</span>
                                    <span class="text-[8px] bg-red-100 text-red-900 px-1 rounded font-bold uppercase">${tagLabel}</span>
                                </div>

                                <div class="flex items-center justify-between text-[9px] text-slate-500 font-mono">
                                    <span>Mastery: <b>${mastery}%</b></span>
                                    <div class="w-12 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                                        <div class="${barColor} h-full" style="width: ${mastery}%"></div>
                                    </div>
                                </div>
                            </div>

                            <div class="mt-2 pt-1 border-t ${isBasic ? 'border-slate-200' : 'border-red-200'} flex justify-between items-center text-[9px]">
                                <span class="text-slate-400 capitalize truncate">${isBasic ? 'Backyard Basic' : 'Custom Gameplan'}</span>
                                ${isBasic ? '<span class="text-slate-400 font-bold uppercase">Basic</span>' : `
                                <button class="px-1.5 py-0.5 rounded font-bold uppercase bg-rose-100 text-rose-800 hover:bg-rose-200 transition"
                                        onclick="event.stopPropagation(); app_toggleInstallPlay('${key}', 'defense')">
                                    Uninstall
                                </button>`}
                            </div>
                        </div>`;
                    }).join('')}
                    ${Array.from({ length: Math.max(0, 8 - team.gameplan.installedDefense.length) }).map(() => `
                        <div class="p-3 rounded border border-dashed border-slate-300 bg-slate-50/50 flex flex-col items-center justify-center text-center text-slate-400 min-h-[75px]">
                            <span class="text-xs font-bold">+ Empty Slot</span>
                            <span class="text-[9px] text-slate-400">Install from library below</span>
                        </div>
                    `).join('')}
                </div>

                <!-- Available Library with Category Filter Tabs -->
                <div class="pt-3 border-t">
                    <div class="flex flex-wrap justify-between items-center mb-2 gap-2">
                        <span class="font-bold text-[10px] uppercase text-slate-600 tracking-wider">Defensive Library (Click to Install into Open Slots)</span>
                        <div class="flex bg-slate-100 p-0.5 rounded border border-slate-300 text-[10px] font-bold">
                            <button class="px-2 py-0.5 rounded ${window._activePlaybookTabDef === 'all' ? 'bg-slate-900 text-white' : 'text-slate-600'}" onclick="app_setPlaybookTab('defense', 'all')">All</button>
                            <button class="px-2 py-0.5 rounded ${window._activePlaybookTabDef === 'zone' ? 'bg-slate-900 text-white' : 'text-slate-600'}" onclick="app_setPlaybookTab('defense', 'zone')">Zone</button>
                            <button class="px-2 py-0.5 rounded ${window._activePlaybookTabDef === 'man' ? 'bg-slate-900 text-white' : 'text-slate-600'}" onclick="app_setPlaybookTab('defense', 'man')">Man</button>
                            <button class="px-2 py-0.5 rounded ${window._activePlaybookTabDef === 'blitz' ? 'bg-slate-900 text-white' : 'text-slate-600'}" onclick="app_setPlaybookTab('defense', 'blitz')">Blitzes</button>
                            <button class="px-2 py-0.5 rounded ${window._activePlaybookTabDef === 'short' ? 'bg-slate-900 text-white' : 'text-slate-600'}" onclick="app_setPlaybookTab('defense', 'short')">Run Stop / Prevent</button>
                        </div>
                    </div>

                    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                        ${defAvailable.filter(([k, play]) => {
                            if (window._activePlaybookTabDef === 'zone') return play.concept === 'Zone' && !play.blitz;
                            if (window._activePlaybookTabDef === 'man') return play.concept === 'Man' && !play.blitz;
                            if (window._activePlaybookTabDef === 'blitz') return play.blitz === true;
                            if (window._activePlaybookTabDef === 'short') return play.tags?.includes('runStop') || play.tags?.includes('prevent');
                            return true;
                        }).map(([key, play]) => {
                            const isInstalledCustom = team.gameplan.installedDefense.includes(key);
                            const mastery = team.gameplan.mastery[key] || 35;
                            const isCompatible = !play.compatibleFormations ||
                                play.compatibleFormations.includes(team.formations?.defense || '3-2-3');

                            const schemeFitBadge = !play.compatibleFormations
                                ? '<span class="text-[8px] bg-slate-100 text-slate-500 px-1 rounded">All Formations</span>'
                                : isCompatible
                                    ? '<span class="text-[8px] bg-emerald-100 text-emerald-800 px-1 rounded font-bold">✓ Scheme Fit</span>'
                                    : `<span class="text-[8px] bg-slate-100 text-slate-600 px-1 rounded font-bold"
                                               title="Compatible formations: ${play.compatibleFormations.join(', ')}">
                                           Fits: ${play.compatibleFormations.join(', ')}
                                       </span>`;

                            return `
                            <div class="p-2 rounded border ${isInstalledCustom ? 'border-emerald-300 bg-emerald-50/30' : 'border-slate-200 bg-white hover:border-red-400'} flex flex-col justify-between transition cursor-pointer group shadow-sm"
                                 onclick="app_previewPlay('${key}', 'defense')">
                                <div class="truncate mb-1.5">
                                    <div class="flex justify-between items-start">
                                        <span class="font-bold text-slate-800 group-hover:text-rose-700 truncate text-[11px]"
                                              title="${play.name || key}">${play.name || getPlayDisplayName(play, key)} 🔍</span>
                                    </div>
                                    <div class="flex items-center gap-1 mt-0.5 flex-wrap">
                                        <span class="text-[8px] bg-slate-100 text-slate-600 px-1 rounded uppercase font-bold">${play.concept || 'Scheme'}</span>
                                        ${schemeFitBadge}
                                    </div>
                                </div>
                                <div class="flex justify-between items-center border-t pt-1 mt-1">
                                    <span class="text-[9px] text-slate-400 font-mono">${mastery}% Mst</span>
                                    ${isInstalledCustom ? `
                                        <div class="flex items-center gap-1">
                                            <span class="text-[9px] font-black uppercase text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">✓ In Plan</span>
                                            <button class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-rose-100 text-rose-800 hover:bg-rose-200 transition"
                                                    onclick="event.stopPropagation(); app_toggleInstallPlay('${key}', 'defense')">
                                                Uninstall
                                            </button>
                                        </div>
                                    ` : `
                                        <button class="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-slate-900 text-white hover:bg-slate-800 transition"
                                                onclick="event.stopPropagation(); app_toggleInstallPlay('${key}', 'defense')">
                                            + Install
                                        </button>
                                    `}
                                </div>
                            </div>`;
                        }).join('')}
                    </div>
                </div>
            </div>
            `}
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
            practiceSchedule: {
                sessionsPerWeek: 2,
                minutesPerSession: 90
            },
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

        // Read the configured practice schedule without requiring the user
    const practiceFieldOptions = {
        community: {
            label: 'Community field',
            weeklyCost: 0,
            maxSessions: 2
        },
        school: {
            label: 'School partnership',
            weeklyCost: 3,
            maxSessions: 3
        },
        dedicated: {
            label: 'Dedicated field',
            weeklyCost: 8,
            maxSessions: 3
        }
    };

    const practiceSchedule = team.gameplan.practiceSchedule || {};

    const requestedFieldAccess = team.gameplan.practiceFieldAccess;

    const practiceFieldAccess = Object.prototype.hasOwnProperty.call(
        practiceFieldOptions,
        requestedFieldAccess
    )
        ? requestedFieldAccess
        : 'community';

    const selectedField = practiceFieldOptions[practiceFieldAccess];

    const requestedSessions = Number(practiceSchedule.sessionsPerWeek);
    const sessionsPerWeek = Number.isFinite(requestedSessions)
        ? Math.max(
            1,
            Math.min(
                selectedField.maxSessions,
                Math.round(requestedSessions)
            )
        )
        : 2;

    const requestedMinutes = Number(practiceSchedule.minutesPerSession);
    const minutesPerSession = [60, 90, 120].includes(requestedMinutes)
        ? requestedMinutes
        : 90;

    const weeklyPracticeMinutes =
        sessionsPerWeek * minutesPerSession;

    const fieldBookingCost = selectedField.weeklyCost;
    const currentBalance = Number(team.finances?.balance);

    const canAffordPracticeField = fieldBookingCost === 0 ||
        (
            Number.isFinite(currentBalance) &&
            currentBalance >= fieldBookingCost
        );

    // The selected field is the requested arrangement. The effective
    // access below records what the weekly resolver last secured.
    const completedWeeks = Number(gameState.currentWeek);
    const currentYear = Number(gameState.year);

    const hasRecentFieldResolution =
        Number.isInteger(currentYear) &&
        Number.isInteger(completedWeeks) &&
        completedWeeks >= 1 &&
        completedWeeks <= 9 &&
        team.gameplan.practiceFieldResolutionKey ===
            `${currentYear}:${completedWeeks}`;

    const lastEffectiveFieldAccess = hasRecentFieldResolution
        ? team.gameplan.practiceFieldEffectiveAccess
        : null;

    const lastEffectiveFieldLabel =
        hasRecentFieldResolution &&
        Object.prototype.hasOwnProperty.call(
            practiceFieldOptions,
            lastEffectiveFieldAccess
        )
            ? practiceFieldOptions[lastEffectiveFieldAccess].label
            : null;

    const practiceRoster = getRosterObjects(team).filter(Boolean);

    // Match the availability rule used by the weekly practice resolver.
    const availablePracticeCount = practiceRoster.filter(
        player => !(Number(player.status?.duration) > 0)
    ).length;

    const averageRosterFatigue = practiceRoster.length > 0
        ? Math.round(
            practiceRoster.reduce(
                (total, player) =>
                    total + Math.max(
                        0,
                        Math.min(100, Number(player.fatigue) || 0)
                    ),
                0
            ) / practiceRoster.length
        )
        : null;

    const practiceWorkloadLabel = weeklyPracticeMinutes <= 120
        ? 'Light'
        : weeklyPracticeMinutes <= 180
            ? 'Standard'
            : weeklyPracticeMinutes <= 270
                ? 'High'
                : 'Heavy';

    const recoveryStatus = averageRosterFatigue === null
        ? 'Not enough roster data'
        : averageRosterFatigue >= 45
            ? 'Elevated — consider reducing workload'
            : averageRosterFatigue >= 25
                ? 'Moderate — monitor recovery'
                : 'Low — normal workload looks reasonable';

    window.app_setPracticePlan = (plan) => {
        if (team.gameplan.delegatePractice) return;
        team.gameplan.weeklyPractice = plan;
        saveGameState();
        renderPracticeManager(gameState);
    };

    window.app_setPracticeFieldAccess = (access) => {
        const options = {
            community: 2,
            school: 3,
            dedicated: 3
        };

        if (!Object.prototype.hasOwnProperty.call(options, access)) {
            return;
        }

        team.gameplan.practiceFieldAccess = access;

        const currentSchedule = team.gameplan.practiceSchedule || {};
        const requestedSessions = Number(currentSchedule.sessionsPerWeek);

        team.gameplan.practiceSchedule = {
            sessionsPerWeek: Number.isFinite(requestedSessions)
                ? Math.max(
                    1,
                    Math.min(options[access], Math.round(requestedSessions))
                )
                : 2,
            minutesPerSession: [60, 90, 120].includes(
                Number(currentSchedule.minutesPerSession)
            )
                ? Number(currentSchedule.minutesPerSession)
                : 90
        };

        saveGameState();
        renderPracticeManager(gameState);
    };

    window.app_setPracticeSchedule = (sessions, minutes) => {
        const access = team.gameplan.practiceFieldAccess || 'community';
        const sessionLimit = access === 'community' ? 2 : 3;

        const sessionCount = Number(sessions);
        const sessionLength = Number(minutes);

        if (
            !Number.isInteger(sessionCount) ||
            sessionCount < 1 ||
            sessionCount > sessionLimit ||
            ![60, 90, 120].includes(sessionLength)
        ) {
            return;
        }

        team.gameplan.practiceSchedule = {
            sessionsPerWeek: sessionCount,
            minutesPerSession: sessionLength
        };

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

            <!-- Weekly Practice Summary -->
            <div class="bg-white border border-slate-200 rounded-lg p-3.5 shadow-sm">
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h5 class="font-black text-xs uppercase tracking-wider text-slate-800">
                            Weekly Practice Overview
                        </h5>
                        <p class="text-[11px] text-slate-500 mt-1">
                            Your schedule and current roster availability at a glance.
                        </p>
                    </div>
                    <span class="self-start rounded bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase text-slate-700">
                        ${practiceWorkloadLabel} workload
                    </span>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                    <div class="rounded border border-slate-100 bg-slate-50 p-2.5">
                        <p class="text-[9px] font-black uppercase tracking-wide text-slate-500">
                            Scheduled practice
                        </p>
                        <p class="text-sm font-black text-slate-900 mt-1">
                            ${sessionsPerWeek} × ${minutesPerSession} min
                        </p>
                        <p class="text-[10px] text-slate-500 mt-0.5">
                            ${(weeklyPracticeMinutes / 60).toFixed(1).replace(/\.0$/, '')} hours per week
                        </p>
                    </div>

                    <div class="rounded border border-slate-100 bg-slate-50 p-2.5">
                        <p class="text-[9px] font-black uppercase tracking-wide text-slate-500">
                            Available players
                        </p>
                        <p class="text-sm font-black text-slate-900 mt-1">
                            ${availablePracticeCount}/${practiceRoster.length}
                        </p>
                        <p class="text-[10px] text-slate-500 mt-0.5">
                            Based on current player statuses
                        </p>
                    </div>

                    <div class="rounded border border-slate-100 bg-slate-50 p-2.5">
                        <p class="text-[9px] font-black uppercase tracking-wide text-slate-500">
                            Average roster fatigue
                        </p>
                        <p class="text-sm font-black text-slate-900 mt-1">
                            ${averageRosterFatigue === null
                                ? 'N/A'
                                : `${averageRosterFatigue}/100`}
                        </p>
                        <p class="text-[10px] ${
                            averageRosterFatigue !== null &&
                            averageRosterFatigue >= 45
                                ? 'text-amber-700 font-semibold'
                                : 'text-slate-500'
                        } mt-0.5">
                            ${recoveryStatus}
                        </p>
                    </div>
                </div>
            </div>

            <!-- Practice Time & Field Access -->
            <div class="bg-white border border-slate-200 rounded-lg p-3.5 shadow-sm space-y-3">
                <div>
                    <h5 class="font-black text-xs uppercase tracking-wider text-slate-800">
                        Practice Time & Field Access
                    </h5>
                    <p class="text-[11px] text-slate-500 mt-1">
                        Set a manageable weekly schedule. Booking costs are charged when the week resolves during the regular season.
                    </p>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <label class="block text-[10px] font-black uppercase tracking-wide text-slate-600 mb-1">
                            Field arrangement
                        </label>
                        <select
                            class="w-full p-2 border border-slate-300 rounded text-xs font-bold text-slate-800 bg-white"
                            value="${practiceFieldAccess}"
                            onchange="app_setPracticeFieldAccess(this.value)"
                        >
                            <option value="community" ${practiceFieldAccess === 'community' ? 'selected' : ''}>
                                Community field — Free, up to 2 sessions
                            </option>
                            <option value="school" ${practiceFieldAccess === 'school' ? 'selected' : ''}>
                                School partnership — $3/week, up to 3
                            </option>
                            <option value="dedicated" ${practiceFieldAccess === 'dedicated' ? 'selected' : ''}>
                                Dedicated field — $8/week, up to 3
                            </option>
                        </select>
                    </div>

                    <div>
                        <label class="block text-[10px] font-black uppercase tracking-wide text-slate-600 mb-1">
                            Sessions per week
                        </label>
                        <select
                            class="w-full p-2 border border-slate-300 rounded text-xs font-bold text-slate-800 bg-white"
                            onchange="app_setPracticeSchedule(this.value, ${minutesPerSession})"
                        >
                            ${Array.from(
                                { length: selectedField.maxSessions },
                                (_, index) => index + 1
                            ).map(count => `
                                <option value="${count}" ${sessionsPerWeek === count ? 'selected' : ''}>
                                    ${count} session${count === 1 ? '' : 's'} per week
                                </option>
                            `).join('')}
                        </select>
                    </div>

                    <div>
                        <label class="block text-[10px] font-black uppercase tracking-wide text-slate-600 mb-1">
                            Session length
                        </label>
                        <select
                            class="w-full p-2 border border-slate-300 rounded text-xs font-bold text-slate-800 bg-white"
                            onchange="app_setPracticeSchedule(${sessionsPerWeek}, this.value)"
                        >
                            ${[60, 90, 120].map(minutes => `
                                <option value="${minutes}" ${minutesPerSession === minutes ? 'selected' : ''}>
                                    ${minutes} minutes
                                </option>
                            `).join('')}
                        </select>
                    </div>

                    <div class="rounded border border-slate-100 bg-slate-50 p-2">
                        <p class="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                            Estimated weekly booking
                        </p>
                        <p class="text-sm font-black text-slate-900 mt-1">
                            ${fieldBookingCost === 0 ? 'Free' : `$${fieldBookingCost.toFixed(2)}`}
                        </p>
                        <p class="text-[10px] mt-1 ${
                            !canAffordPracticeField
                                ? 'text-amber-700 font-semibold'
                                : 'text-slate-500'
                        }">
                            ${!canAffordPracticeField
                                ? 'Current balance is below the booking fee. The weekly resolver will fall back to community access.'
                                : `${selectedField.maxSessions} session${selectedField.maxSessions === 1 ? '' : 's'} maximum with this arrangement.`}
                        </p>
                    </div>
                </div>

                            <div class="mt-3 rounded border border-slate-200 bg-slate-50 p-2.5">
                    <p class="text-[10px] font-black uppercase tracking-wide text-slate-500">
                        Last Completed Field Booking
                    </p>

                    ${hasRecentFieldResolution
                        ? `
                            <p class="text-xs font-bold text-slate-800 mt-1">
                                ${lastEffectiveFieldLabel || 'Access not recorded'}
                            </p>
                            <p class="text-[10px] text-slate-500 mt-0.5">
                                Result from Week ${completedWeeks}. Your current selection applies at the next weekly resolution.
                            </p>
                        `
                        : `
                            <p class="text-xs font-semibold text-slate-700 mt-1">
                                No completed booking recorded for this season yet.
                            </p>
                            <p class="text-[10px] text-slate-500 mt-0.5">
                                The selected field is a preference until weekly access is resolved.
                            </p>
                        `
                    }
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

    const history = Array.isArray(gameState.pickHistory)
        ? gameState.pickHistory
        : [];

    const scoutingLevelLabels = [
        'Unscouted',
        'Initial',
        'Evaluated',
        'Detailed',
        'Fully scouted'
    ];

    const renderFit = (label, position, ovr, low, high, colorClass) => {
        if (!position || !Number.isFinite(ovr)) {
            return `<span class="text-slate-400">${label}: No estimate</span>`;
        }

        const rangeLabel = Number.isFinite(low) && Number.isFinite(high)
            ? `<span class="text-slate-400 font-normal">(${low}–${high})</span>`
            : '';

        return `
            <span class="${colorClass} font-bold whitespace-nowrap">
                ${label} ${position} ~${ovr} ${rangeLabel}
            </span>`;
    };

    list.innerHTML = history.slice().reverse().map(p => {
        const hasScoutingSnapshot = Number.isInteger(p.scoutingLevel);

        if (!hasScoutingSnapshot) {
            // Older saves retain their original single-position history.
            // Label these values as legacy records rather than implying
            // they were recorded using the new scouting system.
            const legacyDetails = [
                p.pos ? `Recorded position: ${p.pos}` : null,
                Number.isFinite(p.ovr) ? `Recorded OVR: ${p.ovr}` : null,
                p.potential ? `Recorded potential: ${p.potential}` : null
            ].filter(Boolean);

            return `
                <div class="p-2 bg-white rounded border border-gray-200 text-xs mb-1">
                    <div class="flex items-center justify-between gap-2">
                        <span class="font-bold text-slate-900">
                            #${p.pick} ${p.playerName}
                        </span>
                        <span class="text-gray-500">${p.teamName}</span>
                    </div>
                    <div class="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                        ${legacyDetails.map(detail => `
                            <span class="text-slate-600">${detail}</span>
                        `).join('')}
                    </div>
                    <p class="text-[9px] text-slate-400 mt-1">
                        Legacy record · Single-position format
                    </p>
                </div>`;
        }

        const level = Math.max(0, Math.min(4, p.scoutingLevel));
        const levelLabel = scoutingLevelLabels[level];
        const confidence = Number.isFinite(p.scoutingConfidence)
            ? `${Math.round(p.scoutingConfidence * 100)}% confidence`
            : null;

        const fitDetails = level > 0
            ? `
                ${renderFit(
                    'OFF',
                    p.offFitPosition,
                    p.offFitOvr,
                    p.offFitLow,
                    p.offFitHigh,
                    'text-emerald-700'
                )}
                ${renderFit(
                    'DEF',
                    p.defFitPosition,
                    p.defFitOvr,
                    p.defFitLow,
                    p.defFitHigh,
                    'text-blue-700'
                )}`
            : '<span class="text-slate-400">Unscouted at time of pick</span>';

        const potentialDetails = level > 0 && p.potential
            ? `<span class="text-slate-600">Potential estimate: ${p.potential}</span>`
            : '<span class="text-slate-400">Potential unknown</span>';

        return `
            <div class="p-2 bg-white rounded border border-gray-200 text-xs mb-1">
                <div class="flex items-center justify-between gap-2">
                    <div class="min-w-0">
                        <span class="font-bold text-slate-900">
                            #${p.pick} ${p.playerName}
                        </span>
                        ${p.listedPosition
                            ? `<span class="text-slate-400 ml-1">Listed ${p.listedPosition}</span>`
                            : ''}
                    </div>
                    <span class="text-gray-500 text-right shrink-0">${p.teamName}</span>
                </div>

                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                    ${fitDetails}
                </div>

                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                    <span class="text-slate-600">
                        ${levelLabel} at pick
                    </span>
                    ${confidence
                        ? `<span class="text-slate-400">${confidence}</span>`
                        : ''}
                    ${potentialDetails}
                </div>
            </div>`;
    }).join('') ||
        '<p class="text-gray-400 text-center py-8 text-xs">No picks yet.</p>';
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
    
    // UI Fix: Explicitly show '2PT TRY' instead of '1 & 3' during conversions
    if (elements.simGameDown) {
        if (activeLiveGame.isConversionAttempt) {
            elements.simGameDown.textContent = `2PT TRY`;
        } else {
            elements.simGameDown.textContent = `${activeLiveGame.down} & ${activeLiveGame.yardsToGo}`;
        }
    }
    
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
        updateLiveScoreboard();
        renderLiveBoxScore(activeLiveGame);
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

/*function getPlayerLastNameForStats(player) {
    if (typeof player?.lastName === 'string' && player.lastName.trim()) {
        return player.lastName.trim();
    }

    const fullName = typeof player?.name === 'string'
        ? player.name.trim()
        : '';

    if (!fullName) return 'Player';

    const nameParts = fullName.split(/\s+/);
    return nameParts[nameParts.length - 1] || 'Player';
}*/

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
                        <span class="font-bold text-slate-200 truncate">${getPlayerLastNameForStats(fullPlayer)}</span>
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

function drawLiveGameFieldFrame(frame) {
    if (!frame || !elements.fieldCanvas || !elements.fieldCanvasCtx) {
        return;
    }

    const homeTeam = activeLiveGame?.homeTeam;
    const awayTeam = activeLiveGame?.awayTeam;

    drawFieldVisualization(
        elements.fieldCanvas,
        elements.fieldCanvasCtx,
        frame,
        homeTeam?.primaryColor || '#0000aa',
        awayTeam?.primaryColor || '#aa0000',
        homeTeam?.name || 'HOME',
        awayTeam?.name || 'AWAY'
    );
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
                drawLiveGameFieldFrame(lastFrame);

                if (activeLiveGame) {
                    renderLiveFieldLineup(lastFrame, getGameState());
                }
            }

            if (onComplete) onComplete();
            return;
        }

        const frame = frames[index];

        if (frame && elements.fieldCanvas && elements.fieldCanvasCtx) {
            drawLiveGameFieldFrame(frame);

            if (activeLiveGame) {
                renderLiveFieldLineup(frame, getGameState());
            }
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

function getPlayerLastNameForStats(player) {
    if (typeof player?.lastName === 'string' && player.lastName.trim()) {
        return player.lastName.trim();
    }

    const fullName = typeof player?.name === 'string'
        ? player.name.trim()
        : '';

    if (!fullName) return 'Player';

    const nameParts = fullName.split(/\s+/);
    return nameParts[nameParts.length - 1] || fullName;
}

export function renderLiveBoxScore(activeGame) {
    const awayContainer = document.getElementById('sim-stats-away');
    const homeContainer = document.getElementById('sim-stats-home');
    if (!awayContainer || !homeContainer || !activeGame) return;

    const renderTeamStats = (team, container) => {
        const players = getUIRosterObjects(team);
        const passers = players.filter(
            p => (p.gameStats?.passAttempts || 0) > 0
        );
        const rushers = players.filter(
            p => (p.gameStats?.rushAttempts || 0) > 0
        );
        const receivers = players.filter(p =>
            (p.gameStats?.receptions || 0) > 0 ||
            (p.gameStats?.targets || 0) > 0 ||
            (p.gameStats?.drops || 0) > 0
        );
        const tacklers = players.filter(p =>
            (p.gameStats?.tackles || 0) > 0 ||
            (p.gameStats?.sacks || 0) > 0
        );
        const turnoverPlayers = players.filter(p =>
            (p.gameStats?.interceptions || 0) > 0 ||
            (p.gameStats?.interceptionsThrown || 0) > 0 ||
            (p.gameStats?.fumbles || 0) > 0 ||
            (p.gameStats?.fumblesLost || 0) > 0 ||
            (p.gameStats?.fumblesRecovered || 0) > 0
        );

        let html = `
            <div class="font-black text-xs uppercase tracking-wider mb-2 text-slate-200 border-b border-slate-700 pb-1">
                ${team.name} Stats
            </div>
            <div class="space-y-3 text-[11px] font-mono">
        `;

        if (passers.length > 0) {
            html += `<div><span class="text-slate-400 font-sans font-bold text-[10px] uppercase block">Passing</span>`;
            passers.forEach(p => {
                html += `<div class="flex justify-between gap-2">
                    <span>${getPlayerLastNameForStats(p)}</span>
                    <span>${p.gameStats.passCompletions || 0}/${p.gameStats.passAttempts || 0}, ${p.gameStats.passYards || 0}y, ${p.gameStats.touchdowns || 0}TD, ${p.gameStats.interceptionsThrown || 0}INT</span>
                </div>`;
            });
            html += `</div>`;
        }

        if (rushers.length > 0) {
            html += `<div><span class="text-slate-400 font-sans font-bold text-[10px] uppercase block">Rushing</span>`;
            rushers.forEach(p => {
                html += `<div class="flex justify-between gap-2"><span>${getPlayerLastNameForStats(p)}</span><span>${p.gameStats.rushAttempts || 0} car, ${p.gameStats.rushYards || 0}y</span></div>`;
            });
            html += `</div>`;
        }

        if (receivers.length > 0) {
            html += `<div><span class="text-slate-400 font-sans font-bold text-[10px] uppercase block">Receiving</span>`;
            receivers.forEach(p => {
                html += `<div class="flex justify-between gap-2">
                    <span>${getPlayerLastNameForStats(p)}</span>
                    <span>${p.gameStats.receptions || 0} rec/${p.gameStats.targets || 0} tgt, ${p.gameStats.recYards || 0}y, ${p.gameStats.drops || 0} drop</span>
                </div>`;
            });
            html += `</div>`;
        }

        if (tacklers.length > 0) {
            html += `<div><span class="text-slate-400 font-sans font-bold text-[10px] uppercase block">Defense</span>`;
            tacklers.forEach(p => {
                html += `<div class="flex justify-between gap-2"><span>${getPlayerLastNameForStats(p)}</span><span>${p.gameStats.tackles || 0} tkl, ${p.gameStats.sacks || 0} sck</span></div>`;
            });
            html += `</div>`;
        }

        if (turnoverPlayers.length > 0) {
            html += `
                <div>
                    <span class="text-slate-400 font-sans font-bold text-[10px] uppercase block">
                        Turnovers
                    </span>
            `;

            turnoverPlayers.forEach(p => {
                const stats = p.gameStats || {};

                html += `
                    <div class="flex justify-between gap-2">
                        <span>${getPlayerLastNameForStats(p)}</span>
                        <span>
                            ${stats.interceptions || 0} INT,
                            ${stats.fumbles || 0} FUM
                            (${stats.fumblesLost || 0} lost),
                            ${stats.fumblesRecovered || 0} FR
                        </span>
                    </div>
                `;
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

/**
 * Renders an on-the-fly chalkboard / napkin diagram for offensive and defensive plays.
 */
function drawPlayDiagram(canvas, playKey, side, team) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // 1. Chalkboard Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    // Subtle grid/yard lines
    const losY = 180;
    const centerX = w / 2;
    const scaleX = w / 42; // ~8px per yard
    const scaleY = 5.2;

    const toX = (x) => centerX + (x * scaleX);
    const toY = (y) => losY - (y * scaleY);

    // Faint 5-yard markers
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let yd = -10; yd <= 35; yd += 5) {
        const y = toY(yd);
        ctx.beginPath();
        ctx.moveTo(10, y);
        ctx.lineTo(w - 10, y);
        ctx.stroke();
    }

    // Line of Scrimmage
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(10, losY);
    ctx.lineTo(w - 10, losY);
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 9px monospace';
    ctx.fillText('LOS', 12, losY - 4);

    const drawArrow = (fromX, fromY, toXPos, toYPos, color, isDashed = false) => {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 2;
        if (isDashed) ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toXPos, toYPos);
        ctx.stroke();

        const angle = Math.atan2(toYPos - fromY, toXPos - fromX);
        const headLen = 6;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(toXPos, toYPos);
        ctx.lineTo(toXPos - headLen * Math.cos(angle - Math.PI / 6), toYPos - headLen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(toXPos - headLen * Math.cos(angle + Math.PI / 6), toYPos - headLen * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    };

    if (side === 'offense') {
        const play = offensivePlaybook[playKey] || {};
        
        // 1. CHOOSE THE PLAY'S INTENDED FORMATION:
        // Prioritize compatible formation if defined (e.g. Trips, Spread), otherwise fallback to team's scheme
        let formKey = team?.formations?.offense || 'Balanced';
        if (play.compatibleFormations && play.compatibleFormations.length > 0) {
            formKey = play.compatibleFormations.includes(formKey) ? formKey : play.compatibleFormations[0];
        } else if (playKey.includes('Trips')) {
            formKey = 'Trips';
        } else if (playKey.includes('Spread')) {
            formKey = 'Spread';
        } else if (playKey.includes('Power')) {
            formKey = 'Power';
        }

        const form = offenseFormations[formKey] || offenseFormations['Balanced'];
        const coords = form.coordinates || {};
        const mapping = form.mapping || {};
        const assignments = play.assignments || {};

        // Resolve diagram roles from the actual formation slots.
        // Extra backs such as RB2 are included when the formation contains them.
        const fallbackRoleBySlot = {
            QB1: 'QB',
            RB1: 'RB',
            RB2: 'RB2',
            FB: 'FB',
            WR1: 'X',
            WR2: 'Z',
            WR3: 'H',
            TE1: 'Y'
        };

        const roleSlots = (form.slots || Object.keys(coords))
            .filter(slot => coords[slot] && !/^OL\d+$/.test(slot))
            .map(slot => {
                const mappedRole = Object.entries(mapping)
                    .find(([role, mappedSlot]) =>
                        !Array.isArray(mappedSlot) && mappedSlot === slot
                    )?.[0];

                const role = mappedRole || fallbackRoleBySlot[slot] || slot;
                const isFullback = slot === 'RB2' || slot === 'FB' ||
                    role === 'RB2' || role === 'FB';

                return {
                    role,
                    slot,
                    label: isFullback ? 'FB' : role
                };
            });

        // Draw Offensive Linemen with proper pulling & screen release diagrams
        ['OL1', 'OL2', 'OL3'].forEach(olSlot => {
            const pt = coords[olSlot] || [0, -1.5];
            const px = toX(pt[0]);
            const py = toY(pt[1]);

            ctx.fillStyle = '#64748b';
            ctx.fillRect(px - 4, py - 4, 8, 8);

            const assign = assignments[olSlot] || assignments.OL || 'pass_block';

            if (assign.includes('pull_right') || assign.includes('pull_right_wide')) {
                drawArrow(px, py, px + 36, toY(2.5), '#fbbf24');
            } else if (assign.includes('pull_left') || assign.includes('pull_left_wide')) {
                drawArrow(px, py, px - 36, toY(2.5), '#fbbf24');
            } else if (assign.includes('screen_block') || assign.includes('Wall_Alley_Left')) {
                // Linemen slip out to the flat to build a screen wall
                drawArrow(px, py, px - 45, toY(4.5), '#38bdf8', true);
            } else if (assign.includes('Wall_Alley_Right')) {
                drawArrow(px, py, px + 45, toY(4.5), '#38bdf8', true);
            } else if (assign.includes('run_block')) {
                // Downhill run block arrow
                drawArrow(px, py, px, toY(2.0), '#f97316');
            } else {
                // Standard Pass Block T-Bar
                ctx.strokeStyle = '#94a3b8';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.lineTo(px, toY(0.5));
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(px - 5, toY(0.5));
                ctx.lineTo(px + 5, toY(0.5));
                ctx.stroke();
            }
        });

        // Draw Skill Players and Routes
        roleSlots.forEach(({ role, slot, label }) => {
            const startPt = coords[slot];
            if (!startPt) return;

            const sx = startPt[0];
            const sy = startPt[1];
            const px = toX(sx);
            const py = toY(sy);

            // Player Dot
            ctx.fillStyle = '#38bdf8';
            ctx.beginPath();
            ctx.arc(px, py, 6, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#0f172a';
            ctx.font = 'bold 8px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, px, py);

            const assign = assignments[role] ||
                assignments[slot] ||
                (label === 'FB' ? assignments.FB : null);
            if (!assign) return;

            // Route Path tracing
            const route = routeTree[assign];
            if (route && route.path) {
                const mirror = (route.mirror !== false && sx < 0) ? -1 : 1;
                let curX = sx;
                let curY = sy;

                route.path.forEach((node, i) => {
                    // Nodes in routeTree are relative to player's starting [sx, sy]
                    const nextX = sx + (node.x * mirror);
                    const nextY = sy + node.y;
                    const isLast = i === route.path.length - 1;

                    if (isLast) {
                        drawArrow(toX(curX), toY(curY), toX(nextX), toY(nextY), '#fde047');
                    } else {
                        ctx.strokeStyle = '#fde047';
                        ctx.lineWidth = 2;
                        ctx.beginPath();
                        ctx.moveTo(toX(curX), toY(curY));
                        ctx.lineTo(toX(nextX), toY(nextY));
                        ctx.stroke();
                    }
                    curX = nextX;
                    curY = nextY;
                });
            } else if (assign.startsWith('run_') && assign !== 'run_block') {
                // Ball-carrier run design; support directional suffixes like _r and _l.
                const goesRight = assign.includes('right') || /_r$/.test(assign);
                const goesLeft = assign.includes('left') || /_l$/.test(assign);
                const destX = goesRight ? sx + 10 : (goesLeft ? sx - 10 : sx);
                const destY = 6;

                drawArrow(px, py, toX(destX), toY(destY), '#fb923c', true);
            } else if (assign.startsWith('lead_') || assign.startsWith('pull_')) {
                // Lead blockers and pullers get a forward directional arrow.
                const goesRight = assign.includes('right') || /_r$/.test(assign);
                const goesLeft = assign.includes('left') || /_l$/.test(assign);
                const destX = sx + (goesRight ? 4 : (goesLeft ? -4 : 0));

                drawArrow(px, py, toX(destX), toY(sy + 3), '#fbbf24');
            } else if (assign === 'run_block' || assign === 'pass_block') {
                // Blocking assignment, not a ball-carrier run.
                const blockY = toY(sy + 1.2);

                ctx.strokeStyle = '#94a3b8';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.lineTo(toX(sx), blockY);
                ctx.moveTo(toX(sx) - 4, blockY);
                ctx.lineTo(toX(sx) + 4, blockY);
                ctx.stroke();
            }
        });

    } else {
        // DEFENSIVE SCHEME DIAGRAM
        const play = defensivePlaybook[playKey] || {};
        const formKey = team?.formations?.defense || '3-2-3';
        const form = defenseFormations[formKey] || defenseFormations['3-2-3'];
        const coords = form.coordinates || {};
        const assignments = play.assignments || {};

        form.slots.forEach(slot => {
            const pt = coords[slot];
            if (!pt) return;

            const px = toX(pt[0]);
            const py = toY(pt[1]);

            // Defense Player Dot
            ctx.fillStyle = '#f43f5e';
            ctx.beginPath();
            ctx.arc(px, py, 6, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 7px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(slot.substring(0, 2), px, py);

            const assign = assignments[slot] || '';
            if (assign.includes('rush') || assign.includes('blitz')) {
                drawArrow(px, py, px, toY(-2), '#f43f5e');
            } else if (assign.includes('zone_')) {
                // Zone Coverage Bubble
                ctx.save();
                ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
                ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
                ctx.lineWidth = 1;
                ctx.setLineDash([2, 2]);
                ctx.beginPath();
                ctx.ellipse(px, py - 10, 24, 16, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            } else if (assign.includes('man_cover')) {
                ctx.strokeStyle = '#cbd5e1';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([2, 2]);
                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.lineTo(px, toY(0));
                ctx.stroke();
            }
        });
    }
}

/**
 * Opens an in-game chalkboard popup modal detailing the play, routes, reads, and lore.
 */
window.app_previewPlay = function(playKey, side) {
    const gs = getGameState();
    const team = gs?.playerTeam;
    const play = side === 'offense' ? offensivePlaybook[playKey] : defensivePlaybook[playKey];
    if (!play) return;

    const playTitle = play.name || playKey.replace('Uni_', '').replace('PA_', 'Play-Action ');
    const reads = play.readProgression && play.readProgression.length > 0
        ? play.readProgression.map((r, i) => `<span class="bg-slate-800 text-amber-400 font-mono px-1.5 py-0.5 rounded text-[11px]">${i + 1}. ${r}</span>`).join(' → ')
        : '<span class="text-slate-400 italic">Pre-snap read / Ballcarrier run design</span>';

    const tags = (play.tags || []).map(t => `<span class="bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase">${t}</span>`).join(' ');

    let loreText = "Standard sandbox concept. Run with precision to stress defensive boundaries.";
    if (play.tags?.includes('screen')) loreText = "Lets blitzing rushers over-penetrate, then slips the ball into open alley with pulling offensive linemen.";
    else if (play.tags?.includes('pa')) loreText = "Heavy play-action fake freezes linebackers near the line of scrimmage, opening up deep crossing windows.";
    else if (play.tags?.includes('quick') || play.tags?.includes('short')) loreText = "Quick rhythm passing. Ball comes out in under 1.5 seconds to neutralize aggressive pressure.";
    else if (play.tags?.includes('deep') || play.tags?.includes('vertical')) loreText = "Stretches deep coverage vertically. Punishes single-high safeties when given adequate pass protection.";
    else if (play.tags?.includes('cross') || play.tags?.includes('mesh')) loreText = "Horizontal rub concept that creates natural picks against tight man-to-man coverage.";
    else if (play.tags?.includes('runStop') || play.blitz) loreText = "Brings heat into the gaps to blow up run lanes and collapse the pocket before deep passes develop.";
    else if (play.concept === 'Zone') loreText = "Discipline-first coverage shell. Keeps the ball in front to prevent explosive chunk plays.";

    const modalHtml = `
        <div class="space-y-3 text-left">
            <!-- Canvas Container -->
            <div class="flex justify-center bg-slate-950 p-2 rounded border border-slate-700 shadow-inner">
                <canvas id="play-diagram-canvas" width="340" height="260" class="rounded shadow"></canvas>
            </div>

            <!-- Progression & Reads -->
            <div class="bg-slate-50 border border-slate-200 p-2.5 rounded text-xs space-y-1">
                <span class="font-bold text-[10px] uppercase tracking-wider text-slate-500 block">QB Progression & Focal Reads</span>
                <div class="flex items-center gap-1.5 flex-wrap">${reads}</div>
            </div>

            <!-- Tactical Lore -->
            <div class="bg-amber-50/80 border border-amber-200 p-2.5 rounded text-xs text-slate-800">
                <span class="font-bold text-[10px] uppercase tracking-wider text-amber-900 block mb-0.5">Tactical Lore & Play Identity</span>
                <p class="italic text-[11px] leading-relaxed">"${loreText}"</p>
            </div>

            <div class="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                <div>Tags: ${tags}</div>
                <div class="font-mono text-slate-400">Scheme: ${side === 'offense' ? (team?.formations?.offense || 'Balanced') : (team?.formations?.defense || '3-2-3')}</div>
            </div>
        </div>
    `;

    showModal(`📋 Play Chalkboard: ${playTitle}`, modalHtml, null, null, null, "Close Chalkboard");

    // Render vector lines once the modal DOM element is present
    setTimeout(() => {
        const canvas = document.getElementById('play-diagram-canvas');
        if (canvas) drawPlayDiagram(canvas, playKey, side, team);
    }, 20);
};

export function skipLiveGameSim() { isSkipping = true; isPaused = false; }
export function togglePause() { isPaused = !isPaused; return isPaused; }
export function setSimSpeed(speedMultiplier) {
    const multiplier = Number(speedMultiplier);

    if (!Number.isFinite(multiplier) || multiplier <= 0) {
        return;
    }

    liveGameSpeed = getPlaybackIntervalMs(multiplier);
    isPaused = false;
}
