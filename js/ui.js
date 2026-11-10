//ui.js
import * as Game from './game.js';
import {
    saveGameState, getRelationshipLevel, getScoutedPlayerInfo, getGameState,
    getRosterObjects, getPlayer, rebuildDepthChartFromOrder, assignPlayerToSlot
} from './game.js';
import { offenseFormations, defenseFormations, relationshipLevels, firstNames, lastNames, offensivePlaybook, defensivePlaybook, routeTree, getFormationSlotLabel } from './data.js';
import { positionOverallWeights, estimateBestPosition, calculateOverall, getProspectSignatureSkills } from './game/player.js';
import { formatHeight } from './utils.js';
import { drawFieldVisualization, formatGameClock, showPlayOverlay } from './ui/field_visualizer.js';
import { renderDepthOrderPane } from './ui/depth_order.js';
import { applyRecruitingSweetener, buildAutomatedStaffAssignmentsForTeam } from './game/staff.js';
import { DEFAULT_PLAYBACK_INTERVAL_MS, getPlaybackIntervalMs } from './game/simulation_config.js';
import {
    getCurrentRosterLimit,
    setRecruitingOffer
} from './game/season.js';
import {
    acceptCommunityFavor as acceptCommunityFavorAction
} from './game/community.js';
import {
    initializeInheritedScoutingReports,
    recordScoutingReportOutcome,
    processWeeklyScoutingAssignments,
    advanceRecruitingTryoutScoutingReport
} from './game/scouting.js';

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
let lastRenderedFrame = null;
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
    fumbles: 'Fumbles',
    fumblesLost: 'Fumbles Lost',
    returnYards: 'Return Yds',
    fumblesRecovered: 'Fum Rec',
    safeties: 'Safeties'
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
                    ${renderPublicStatSummary(season.stats, null)}
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

function renderPeeWeeHistory(player) {
    const rawHistory = Array.isArray(player?.youthSeasonHistory)
        ? player.youthSeasonHistory
        : [];

    // Deduplicate recorded seasons by year without modifying saved history.
    const seenYears = new Set();
    const history = rawHistory
        .filter(season => {
            if (!season || typeof season !== 'object') return false;

            const year = Number(season.year);

            // Keep legacy rows with an unknown year rather than discarding them.
            if (!Number.isInteger(year)) return true;
            if (seenYears.has(year)) return false;

            seenYears.add(year);
            return true;
        })
        .sort(
            (a, b) => (Number(a.year) || 0) - (Number(b.year) || 0)
        );

    // Preserve saved totals, then reconstruct missing fields only when every
    // recorded season contains a valid numeric value for that statistic.
    const savedCareerStats = player?.youthCareerStats;
    const careerStats = savedCareerStats &&
        typeof savedCareerStats === 'object'
        ? { ...savedCareerStats }
        : {};

    const statKeys = new Set(Object.keys(careerStats));

    history.forEach(season => {
        Object.keys(season.stats || {}).forEach(key => statKeys.add(key));
    });

    for (const statKey of statKeys) {
        const savedValue = careerStats[statKey];

        if (
            savedValue !== undefined &&
            savedValue !== null &&
            Number.isFinite(Number(savedValue))
        ) {
            careerStats[statKey] = Number(savedValue);
            continue;
        }

        if (history.length === 0) continue;

        const seasonValues = history.map(
            season => season.stats?.[statKey]
        );

        const hasCompleteHistory = seasonValues.every(value =>
            value !== undefined &&
            value !== null &&
            Number.isFinite(Number(value))
        );

        if (hasCompleteHistory) {
            careerStats[statKey] = seasonValues.reduce(
                (total, value) => total + Number(value),
                0
            );
        }
    }

    const hasCareerStats = Object.values(careerStats).some(value =>
        value !== undefined &&
        value !== null &&
        Number.isFinite(Number(value))
    );

    const seasonsPlayed = history.length ||
        (Number(player?.youthSeasonsPlayed) || 0);
    const position = player?.pos || null;

    const seasonHistoryHtml = history.length > 0
        ? history.map(season => `
            <div class="border-t border-slate-200 pt-2 first:border-t-0 first:pt-0">
                <div class="flex flex-wrap items-center justify-between gap-1 mb-1">
                    <span class="font-bold text-slate-700">
                        Year ${season.year ?? '?'}
                        ${season.age != null ? `· Age ${season.age}` : ''}
                    </span>
                    <span class="text-slate-400">${season.teamName || 'Pee Wee'}</span>
                </div>
                <div class="flex flex-wrap gap-1">
                    ${renderPublicStatSummary(season.stats, position)}
                </div>
            </div>
        `).join('')
        : '<p class="text-slate-400 italic">No season-by-season Pee Wee stats recorded.</p>';

    const careerHtml = hasCareerStats
        ? renderPublicStatSummary(careerStats, null)
        : '<span class="text-slate-400 italic">No Pee Wee career totals recorded.</span>';

    return `
        <section class="rounded border border-amber-200 bg-amber-50/60 p-2 space-y-2">
            <div class="flex flex-wrap items-center justify-between gap-1">
                <span class="font-black tracking-wide text-amber-900">PEE WEE CAREER</span>
                <span class="text-[9px] text-slate-500">
                    ${seasonsPlayed} completed season${seasonsPlayed === 1 ? '' : 's'}
                </span>
            </div>

            <div>
                <p class="text-[9px] font-bold uppercase tracking-wide text-slate-500 mb-1">
                    Season-by-season history
                </p>
                <div class="space-y-2">
                    ${seasonHistoryHtml}
                </div>
            </div>

            <div>
                <p class="text-[9px] font-bold uppercase tracking-wide text-slate-500 mb-1">
                    Pee Wee career totals
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

    const sidebarToggleBtn = document.getElementById('sim-sidebar-toggle');
    if (sidebarToggleBtn) {
        sidebarToggleBtn.addEventListener('click', () => {
            toggleSimSidebar();
        });
    }
}

function toggleSimSidebar() {
    const simSidebar = document.getElementById('sim-sidebar');
    const toggleIcon = document.getElementById('sim-sidebar-toggle-icon');
    const toggleText = document.getElementById('sim-sidebar-toggle-text');
    if (!simSidebar) return;

    const isHidden = simSidebar.classList.contains('hidden');
    if (isHidden) {
        simSidebar.classList.remove('hidden');
        if (toggleIcon) toggleIcon.textContent = '▶';
        if (toggleText) toggleText.textContent = 'Hide Sideline';
    } else {
        simSidebar.classList.add('hidden');
        if (toggleIcon) toggleIcon.textContent = '◀';
        if (toggleText) toggleText.textContent = 'Show Sideline';
    }

    if (elements?.fieldCanvas) {
        elements.fieldCanvas.width = elements.fieldCanvas.clientWidth;
        elements.fieldCanvas.height = elements.fieldCanvas.clientHeight;
        if (lastRenderedFrame) {
            drawLiveGameFieldFrame(lastRenderedFrame);
        }
    }
    window.dispatchEvent(new Event('resize'));
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

    // 1. Use active Pee Wee rosters for youth stats, but keep the actual
    // rookie draft restricted to eligible, unassigned prospects.
    const isYouthStatsView = activeDraftView === 'youthStats';

    const poolSource = isYouthStatsView
        ? (gameState.players || []).filter(player => {
            if (!player) return false;

            // Retain graduates and former Pee Wee players in the history view.
            const hasYouthHistory =
                Array.isArray(player.youthSeasonHistory) &&
                player.youthSeasonHistory.length > 0;

            if (hasYouthHistory) return true;

            if (!player.teamId) return false;

            const assignedTeam = (gameState.teams || []).find(team =>
                String(team?.id) === String(player.teamId)
            );

            return (
                player.lifecycle === 'youth' &&
                assignedTeam?.leagueType === 'youth'
            );
        })
        : Array.isArray(gameState.draftClass)
            ? gameState.draftClass
            : [];

    const isInauguralDraft = Number(gameState.year) === 1;

    let undraftedPlayers = poolSource.filter(player => {
        if (
            !player ||
            ['retired', 'departed', 'temporary'].includes(
                player.status?.type
            )
        ) {
            return false;
        }

        // Youth Stats is a scouting/research view, not a draft-eligibility list.
        if (isYouthStatsView) {
            const age = Number(player.age);

            const isActiveYouth =
                player.lifecycle === 'youth' &&
                player.teamId != null &&
                Number.isInteger(age) &&
                age >= 8 &&
                age <= 11;

            const hasYouthHistory =
                Array.isArray(player.youthSeasonHistory) &&
                player.youthSeasonHistory.length > 0;

            return isActiveYouth || hasYouthHistory;
        }

        // The actual draft must only show unassigned eligible prospects.
        if (
            player.teamId ||
            player.personality?.entersDraft === false
        ) {
            return false;
        }

        // Year 1 fills initial rosters and does not require Pee Wee history.
        if (isInauguralDraft) {
            return Number(player.age) >= 11;
        }

        // All subsequent rookie drafts require documented Pee Wee eligibility.
        const age = Number(player.age);
        const entryAge = Number(player.youthEntryAge);
        const seasonsPlayed = Number(player.youthSeasonsPlayed);

        if (
            player.lifecycle !== 'draft_eligible' ||
            !Number.isInteger(age) ||
            age < 12 ||
            !Number.isInteger(entryAge) ||
            entryAge < 8 ||
            entryAge > 11 ||
            !Number.isInteger(seasonsPlayed) ||
            seasonsPlayed < 0
        ) {
            return false;
        }

        const history = Array.isArray(player.youthSeasonHistory)
            ? player.youthSeasonHistory
            : [];

        const recordedSeasonYears = new Set(
            history
                .filter(season =>
                    season?.year != null &&
                    Number.isInteger(Number(season.year))
                )
                .map(season => Number(season.year))
        );

        const requiredSeasons = 12 - entryAge;

        return (
            seasonsPlayed >= requiredSeasons &&
            recordedSeasonYears.size >= requiredSeasons
        );
    });

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
        } else if (activeDraftView === 'youthStats') {
            thead.innerHTML = `
                <tr>
                    <th class="py-2 px-2 text-center w-8">★</th>
                    <th class="py-2 px-2 text-center">Pos</th>
                    <th class="py-2 px-3 text-left cursor-pointer hover:bg-slate-200" data-sort="name">Prospect</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="age">Age</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="youthSeasons">Seasons</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="youthPassYards">Pass Yds</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="youthRushYards">Rush Yds</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="youthRecYards">Rec Yds</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="youthTouchdowns">TD</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="youthTackles">Tackles</th>
                    <th class="py-2 px-2 text-center cursor-pointer hover:bg-slate-200" data-sort="youthInterceptions">INT</th>
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

    const YOUTH_STAT_SORT_FIELDS = {
        youthPassYards: 'passYards',
        youthRushYards: 'rushYards',
        youthRecYards: 'recYards',
        youthTouchdowns: 'touchdowns',
        youthTackles: 'tackles',
        youthInterceptions: 'interceptions'
    };

    // Read recorded youth career totals, rebuilding from season history
    // when an aggregate field is missing in an older or partially migrated save.
        const getYouthStatTotal = (player, statKey) => {
        const history = Array.isArray(player?.youthSeasonHistory)
            ? player.youthSeasonHistory
            : [];

        let total = 0;
        let foundRecordedValue = false;

        history.forEach(season => {
            const stats = season?.stats;
            const value = stats?.[statKey];

            if (
                value === undefined ||
                value === null ||
                !Number.isFinite(Number(value))
            ) {
                return;
            }

            total += Number(value);
            foundRecordedValue = true;
        });

        // Per-season history is the source of truth when it contains this stat.
        if (foundRecordedValue) return total;

        // Fall back to the aggregate for players with no recorded stat history.
        const careerValue = player?.youthCareerStats?.[statKey];

        if (
            careerValue !== undefined &&
            careerValue !== null &&
            Number.isFinite(Number(careerValue))
        ) {
            return Number(careerValue);
        }

        // Missing historical data stays missing rather than becoming a fake zero.
        return null;
    };

    const getYouthStatScore = (player, key) => {
        const history = Array.isArray(player.youthSeasonHistory)
            ? player.youthSeasonHistory
            : [];

        if (key === 'youthSeasons') {
            const seasons = history.length ||
                (Number(player.youthSeasonsPlayed) || 0);

            return seasons > 0 ? seasons : null;
        }

        const statKey = YOUTH_STAT_SORT_FIELDS[key];
        if (!statKey) return null;

        return getYouthStatTotal(player, statKey);
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

        if (
            sortColumn === 'youthSeasons' ||
            Object.prototype.hasOwnProperty.call(
                YOUTH_STAT_SORT_FIELDS,
                sortColumn
            )
        ) {
            const youthCompare = compareReportedValues(
                getYouthStatScore(a, sortColumn),
                getYouthStatScore(b, sortColumn)
            );

            return youthCompare || a.name.localeCompare(b.name);
        }

        const attrCompare = compareReportedValues(
            getAttributeScore(a),
            getAttributeScore(b)
        );

        return attrCompare || a.name.localeCompare(b.name);
    });

    elements.draftPoolTbody.innerHTML = '';
    if (filtered.length === 0) {
        const hasEligibleClass = undraftedPlayers.length > 0;

        const msg = activeDraftView === 'watchlist'
            ? 'No prospects pinned to your watchlist yet. Click the ★ next to any player to shortlist them.'
            : activeDraftView === 'youthStats'
                ? 'No active Pee Wee players match these filters.'
                : (!hasEligibleClass && Number(gameState.year) !== 1
                    ? 'No eligible Pee Wee graduates are available in this draft class.'
                    : 'No prospects match filters.');
        const emptyColspan = activeDraftView === 'youthStats' ? 11 : 9;
        elements.draftPoolTbody.innerHTML = `<tr><td colspan="${emptyColspan}" class="p-6 text-center text-slate-400 font-sans italic">${msg}</td></tr>`;
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
        } else if (activeDraftView === 'youthStats') {
            const youthHistory = Array.isArray(player.youthSeasonHistory)
                ? player.youthSeasonHistory
                : [];

            const youthSeasons = youthHistory.length ||
                (Number(player.youthSeasonsPlayed) || 0);

            const youthStatDisplay = statKey => {
                if (youthHistory.length === 0) return '—';

                const value = getYouthStatTotal(player, statKey);

                return value === null ? '—' : value.toLocaleString();
            };

            row.innerHTML = `
                <td class="py-2 px-2 text-center">${starBtn}</td>
                <td class="py-2 px-2 text-center">${posBadge}</td>
                <td class="py-2 px-3 font-semibold text-slate-900 font-sans truncate max-w-[150px]">${scouted.name}</td>
                <td class="text-center py-2 px-2">${scouted.age}</td>
                <td class="text-center py-2 px-2">${youthSeasons > 0 ? youthSeasons : '—'}</td>
                <td class="text-center py-2 px-2">${youthStatDisplay('passYards')}</td>
                <td class="text-center py-2 px-2">${youthStatDisplay('rushYards')}</td>
                <td class="text-center py-2 px-2">${youthStatDisplay('recYards')}</td>
                <td class="text-center py-2 px-2 font-bold">${youthStatDisplay('touchdowns')}</td>
                <td class="text-center py-2 px-2">${youthStatDisplay('tackles')}</td>
                <td class="text-center py-2 px-2">${youthStatDisplay('interceptions')}</td>
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

let activeDraftSidebarTab = 'prospect';

window.app_switchDraftSidebarTab = function(tab) {
    if (!['prospect', 'team'].includes(tab)) return;

    activeDraftSidebarTab = tab;

    document.querySelectorAll('.draft-sidebar-tab-btn').forEach(btn => {
        const isActive = btn.dataset.sidebarTab === tab;

        btn.className = `draft-sidebar-tab-btn py-2 rounded text-xs font-black uppercase tracking-wider transition ${
            isActive
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
        }`;
    });

    document.getElementById('draft-sidebar-prospect-pane')
        ?.classList.toggle('hidden', tab !== 'prospect');

    document.getElementById('draft-sidebar-team-pane')
        ?.classList.toggle('hidden', tab !== 'team');
};

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
    const youthRecordHtml = renderPeeWeeHistory(player);

    // External prospects' exact relationships are hidden until the game
    // has a dedicated scouting report field for verified connections.
    const canShowDirectSocialInfo = !scouted.isExternalProspect;

    const bestFriend = canShowDirectSocialInfo
        ? playerRoster.find(r => r.id === player.social?.bestFriendId)
        : null;

    const friendsOnTeam = canShowDirectSocialInfo
        ? playerRoster.filter(r =>
            player.social?.goodFriendIds?.includes(r.id)
        )
        : [];

    const rivalOnTeam = canShowDirectSocialInfo
        ? playerRoster.find(r => player.social?.rivalIds?.includes(r.id))
        : null;

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
                ${youthRecordHtml}
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

    // 1. Render a compact, full-width two-way roster list.
    elements.draftRosterList.innerHTML = roster.map(p => {
        const fits = getBestTwoWayFits(p);

        return `
        <li
            class="px-2.5 py-1.5 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-xs hover:bg-slate-100 transition cursor-pointer"
            onclick="app.openPlayerCard('${p.id}')">

            <div class="flex items-center gap-1.5 min-w-0">
                <span class="text-slate-400 font-mono text-[10px] shrink-0">
                    #${p.number || '--'}
                </span>

                <span class="font-semibold text-slate-900 truncate">
                    ${p.name}
                </span>

                <span class="text-[10px] text-slate-400 font-mono shrink-0">
                    (${p.age}yo)
                </span>
            </div>

            <div class="flex items-center justify-end flex-wrap gap-x-2 gap-y-0.5 text-[10px] shrink-0">
                ${renderPositionFit(fits.offense, 'offense', true)}
                ${renderPositionFit(fits.defense, 'defense', true)}
            </div>
        </li>`;
    }).join('') || `
        <li class="p-6 text-center text-slate-400 text-xs italic">
            No players drafted yet.
        </li>`;

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
        case 'community': renderCommunityTab(gameState); break;
        case 'messages': renderMessagesTab(gameState); break;
        
        case 'front-office': {
            const foSub =
                document.querySelector('.fo-tab.active')?.dataset.subTab || 'staff';

            if (foSub === 'staff') {
                renderStaffTab(gameState);
            }

            if (foSub === 'staff-market') {
                renderStaffCarouselTab(gameState);
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

/**
 * Renders the shared community request board for the player's team.
 */
export function renderCommunityFavorsTab(gameState) {
    const container = document.getElementById(
        'community-favors-container'
    );

    if (!container) return;

    const team = gameState?.playerTeam;

    if (!team) {
        container.innerHTML = `
            <p class="p-6 text-center text-slate-400">
                Team information is unavailable.
            </p>
        `;
        return;
    }

    const escapeHtml = value => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const community = gameState.community || {};
    const teamKey = String(team.id);

    const reputationValue = Number(
        community.teamReputations?.[teamKey]?.score
    );

    const reputation = Number.isFinite(reputationValue)
        ? Math.max(0, Math.min(100, reputationValue))
        : 50;

    const year = Number(gameState.year);
    const week = Number(gameState.currentWeek);

    const absoluteWeek =
        Number.isInteger(year) && Number.isInteger(week)
            ? ((year - 1) * 9) + week
            : null;

    const favors = Array.isArray(community.favors)
        ? community.favors.filter(Boolean)
        : [];

    const openFavors = favors
        .filter(favor =>
            favor.status === 'open' &&
            (
                absoluteWeek === null ||
                !Number.isFinite(Number(favor.deadlineWeek)) ||
                Number(favor.deadlineWeek) >= absoluteWeek
            )
        )
        .sort((a, b) =>
            Number(a.deadlineWeek || Infinity) -
            Number(b.deadlineWeek || Infinity)
        );

    const acceptedFavors = favors
        .filter(favor =>
            favor.status === 'accepted' &&
            String(favor.acceptedByTeamId) === teamKey
        );

    const resolvedStatuses = new Set([
        'completed',
        'partial',
        'unsuccessful'
    ]);

    const recentHistory = favors
        .filter(favor =>
            resolvedStatuses.has(favor.status) &&
            String(favor.acceptedByTeamId) === teamKey
        )
        .sort((a, b) =>
            Number(b.resolvedWeek ?? b.completedWeek ?? 0) -
            Number(a.resolvedWeek ?? a.completedWeek ?? 0)
        )
        .slice(0, 5);

    const reputationColor = reputation >= 70
        ? 'text-emerald-700'
        : reputation >= 40
            ? 'text-amber-700'
            : 'text-rose-700';

    const formatHours = value =>
        `${Math.max(0, Number(value) || 0).toFixed(1)} hours`;

    const openRequestsHtml = openFavors.length > 0
        ? openFavors.map(favor => {
            const hours = formatHours(favor.estimatedHours);

            const expense = Math.max(
                0,
                Number(favor.estimatedCashExpense) || 0
            );

            const deadline = Number(favor.deadlineWeek);

            const dueLabel = Number.isFinite(deadline) &&
                absoluteWeek !== null
                    ? deadline === absoluteWeek
                        ? 'Due this week'
                        : `Due in ${deadline - absoluteWeek} week(s)`
                    : 'Deadline not specified';

            return `
                <article class="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
                    <div class="flex flex-wrap justify-between gap-2">
                        <div>
                            <h4 class="font-black text-slate-900">
                                ${escapeHtml(favor.title || 'Community request')}
                            </h4>
                            <p class="text-[11px] text-slate-500 mt-1">
                                Requested by ${escapeHtml(
                                    favor.requesterName || 'Community contact'
                                )}
                            </p>
                        </div>

                        <span class="text-[10px] font-bold uppercase text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                            Open request
                        </span>
                    </div>

                    <p class="text-sm text-slate-700 mt-3">
                        ${escapeHtml(favor.description || '')}
                    </p>

                    <div class="flex flex-wrap gap-x-5 gap-y-2 mt-3 text-xs text-slate-500">
                        <span>🕒 ${hours}</span>
                        <span>💵 Estimated expense: $${expense.toFixed(2)}</span>
                        <span>📅 ${escapeHtml(dueLabel)}</span>
                    </div>

                    <div class="mt-4">
                        <button
                            type="button"
                            class="bg-slate-900 hover:bg-slate-700 text-white font-bold text-xs uppercase tracking-wide px-4 py-2 rounded transition"
                            onclick="window.app_acceptCommunityFavor('${escapeHtml(favor.id)}')">
                            Accept Request
                        </button>
                    </div>
                </article>
            `;
        }).join('')
        : `
            <div class="bg-white border border-slate-200 rounded-lg p-6 text-center">
                <div class="text-2xl mb-2">🌱</div>
                <h4 class="font-bold text-slate-700">
                    No open community requests
                </h4>
                <p class="text-xs text-slate-500 mt-1">
                    New opportunities appear periodically. Some weeks there may be none.
                </p>
            </div>
        `;

    const acceptedHtml = acceptedFavors.length > 0
        ? `
            <section class="space-y-2">
                <h3 class="text-xs font-black uppercase tracking-wider text-slate-700">
                    Your Team's Commitments
                </h3>

                ${acceptedFavors.map(favor => `
                    <article class="bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <div class="flex flex-wrap justify-between gap-2">
                            <strong class="text-sm text-slate-800">
                                ${escapeHtml(favor.title)}
                            </strong>
                            <span class="text-[10px] font-bold uppercase text-blue-800">
                                Accepted
                            </span>
                        </div>
                        <p class="text-xs text-slate-600 mt-1">
                            ${escapeHtml(favor.requesterName)}
                        </p>
                        <p class="text-xs text-slate-500 mt-2">
                            Assigned to ${escapeHtml(
                                favor.assignedStaffName || 'Assigned staff'
                            )}
                            · ${formatHours(favor.committedVolunteerHours)}
                        </p>
                    </article>
                `).join('')}
            </section>
        `
        : '';

    const historyHtml = recentHistory.length > 0
        ? `
            <section class="space-y-2">
                <h3 class="text-xs font-black uppercase tracking-wider text-slate-700">
                    Recent Service History
                </h3>

                ${recentHistory.map(favor => {
                    const statusLabels = {
                        completed: 'Completed',
                        partial: 'Partially completed',
                        unsuccessful: 'Unsuccessful'
                    };

                    const statusColors = {
                        completed: 'text-emerald-700',
                        partial: 'text-amber-700',
                        unsuccessful: 'text-rose-700'
                    };

                    return `
                        <article class="bg-white border border-slate-200 rounded-lg p-3">
                            <div class="flex justify-between gap-2">
                                <strong class="text-sm text-slate-800">
                                    ${escapeHtml(favor.title)}
                                </strong>
                                <span class="text-[10px] font-bold ${
                                    statusColors[favor.status]
                                }">
                                    ${statusLabels[favor.status]}
                                </span>
                            </div>
                            <p class="text-xs text-slate-500 mt-1">
                                ${escapeHtml(favor.requesterName)}
                            </p>
                            <p class="text-xs text-slate-600 mt-2">
                                ${escapeHtml(favor.outcome || '')}
                            </p>
                        </article>
                    `;
                }).join('')}
            </section>
        `
        : '';

    container.innerHTML = `
        <section class="bg-slate-900 text-white rounded-lg p-4 flex flex-wrap justify-between items-center gap-3">
            <div>
                <p class="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
                    Community standing
                </p>
                <h3 class="text-lg font-black mt-1">
                    ${escapeHtml(team.name)}
                </h3>
                <p class="text-xs text-slate-400 mt-1">
                    Reputation built through consistent local involvement.
                </p>
            </div>

            <div class="text-right">
                <span class="text-3xl font-black ${reputationColor}">
                    ${reputation}
                </span>
                <span class="block text-[9px] text-slate-400 uppercase tracking-wider">
                    Reputation / 100
                </span>
            </div>
        </section>

        <section class="space-y-3">
            <div>
                <h3 class="text-xs font-black uppercase tracking-wider text-slate-700">
                    Available Requests
                </h3>
                <p class="text-xs text-slate-500 mt-1">
                    Accepting a request commits staff time from your shared weekly work budget.
                </p>
            </div>

            ${openRequestsHtml}
        </section>

        ${acceptedHtml}
        ${historyHtml}
    `;
}

/**
 * Accepts a community request for the player's team.
 */
window.app_acceptCommunityFavor = function(favorId) {
    const gs = getGameState();
    const team = gs?.playerTeam;

    if (!gs || !team) return;

    const year = Number(gs.year);
    const week = Number(gs.currentWeek);

    if (
        !Number.isInteger(year) ||
        !Number.isInteger(week)
    ) {
        return;
    }

    const absoluteWeek = ((year - 1) * 9) + week;

    const acceptedFavor = acceptCommunityFavor(
        gs,
        favorId,
        team.id,
        absoluteWeek
    );

    if (!acceptedFavor) {
        showModal(
            'Request Not Accepted',
            `<p class="text-sm text-slate-600">
                This request may have expired, already been accepted by another team,
                or your staff may not have enough available time.
            </p>`,
            null,
            'Close'
        );

        renderCommunityFavorsTab(gs);
        return;
    }

    saveGameState();

    renderCommunityFavorsTab(gs);

    showModal(
        'Community Request Accepted',
        `<p class="text-sm text-slate-600">
            Your team accepted <strong>${String(
                acceptedFavor.title || 'the community request'
            ).replace(/[&<>"']/g, character => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            })[character])}</strong>.
            The assigned staff member's time is now committed to this work.
        </p>`,
        null,
        'Close'
    );
};


export function renderCommunityTab(gameState) {
    const container = document.getElementById('community-favors-container');
    const playerTeam = gameState?.playerTeam;

    if (!container || !gameState || !playerTeam) return;

    const community = gameState.community;
    const favors = Array.isArray(community?.favors)
        ? community.favors.filter(Boolean)
        : [];

    const contacts = Array.isArray(community?.contacts)
        ? community.contacts.filter(Boolean)
        : [];

    const teamId = String(playerTeam.id);

    const escapeHtml = value => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    // Show all available requests and the player's own favor history.
    // Requests accepted by another team are no longer available here.
    const visibleFavors = favors.filter(favor => {
        if (favor.status === 'open') return true;

        return (
            favor.acceptedByTeamId != null &&
            String(favor.acceptedByTeamId) === teamId
        );
    });

    const statusInfo = {
        open: {
            label: 'Available',
            classes: 'bg-emerald-100 text-emerald-800 border-emerald-200'
        },
        accepted: {
            label: 'In Progress',
            classes: 'bg-blue-100 text-blue-800 border-blue-200'
        },
        completed: {
            label: 'Completed',
            classes: 'bg-emerald-100 text-emerald-800 border-emerald-200'
        },
        partial: {
            label: 'Partially Completed',
            classes: 'bg-amber-100 text-amber-800 border-amber-200'
        },
        unsuccessful: {
            label: 'Unsuccessful',
            classes: 'bg-rose-100 text-rose-800 border-rose-200'
        }
    };

    const statusOrder = {
        open: 0,
        accepted: 1,
        partial: 2,
        completed: 3,
        unsuccessful: 4
    };

    visibleFavors.sort((a, b) =>
        (statusOrder[a.status] ?? 5) -
        (statusOrder[b.status] ?? 5)
    );

    if (visibleFavors.length === 0) {
        container.innerHTML = `
            <div class="rounded-lg border border-slate-200 bg-white p-8 text-center">
                <div class="text-3xl mb-3">🤝</div>
                <h3 class="font-bold text-slate-700">
                    No community requests right now
                </h3>
                <p class="text-sm text-slate-500 mt-1">
                    Local residents and organizations may need help in future weeks.
                    Check back as your community's needs change.
                </p>
            </div>
        `;
        return;
    }

    container.innerHTML = visibleFavors.map(favor => {
        const contact = contacts.find(candidate =>
            String(candidate.id) === String(favor.contactId)
        );

        const title = escapeHtml(
            favor.title ||
            favor.requestTitle ||
            favor.favorType ||
            'Community request'
        );

        const description = escapeHtml(
            favor.description ||
            favor.details ||
            favor.summary ||
            'A local community member is requesting help.'
        );

        const contactName = escapeHtml(
            contact?.name ||
            contact?.organization ||
            favor.contactName ||
            'Local contact'
        );

        const category = escapeHtml(
            favor.category ||
            favor.favorType ||
            'Community Service'
        );

        const hours = Number(favor.estimatedHours);
        const hoursLabel = Number.isFinite(hours)
            ? `${hours} estimated staff hours`
            : 'Staff time required';

        const cashExpense = Number(favor.estimatedCashExpense);
        const cashLabel = Number.isFinite(cashExpense) && cashExpense > 0
            ? `$${cashExpense.toFixed(2)} estimated expense`
            : 'No estimated cash expense';

        const status = statusInfo[favor.status] || {
            label: escapeHtml(favor.status || 'Unknown'),
            classes: 'bg-slate-100 text-slate-700 border-slate-200'
        };

        const actionHtml = favor.status === 'open'
            ? `
                <div class="mt-3 pt-3 border-t border-slate-100 flex justify-end">
                    <button
                        type="button"
                        data-community-favor-accept="${escapeHtml(favor.id)}"
                        class="bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold uppercase tracking-wide px-4 py-2 rounded shadow-sm transition">
                        Accept Request
                    </button>
                </div>
            `
            : '';

        return `
            <article class="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div class="p-4">
                    <div class="flex flex-wrap items-start justify-between gap-2 mb-2">
                        <div class="min-w-0">
                            <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                ${category}
                            </div>
                            <h4 class="font-black text-slate-900 text-base mt-1">
                                ${title}
                            </h4>
                        </div>
                        <span class="shrink-0 text-[10px] font-bold uppercase px-2 py-1 rounded border ${status.classes}">
                            ${status.label}
                        </span>
                    </div>

                    <p class="text-sm text-slate-600 leading-relaxed">
                        ${description}
                    </p>

                    <div class="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
                        <span>
                            <b class="text-slate-700">Contact:</b>
                            ${contactName}
                        </span>
                        <span>
                            <b class="text-slate-700">Time:</b>
                            ${escapeHtml(hoursLabel)}
                        </span>
                        <span>
                            <b class="text-slate-700">Cost:</b>
                            ${escapeHtml(cashLabel)}
                        </span>
                    </div>
                    ${actionHtml}
                </div>
            </article>
        `;
    }).join('');

    container.querySelectorAll('[data-community-favor-accept]')
        .forEach(button => {
            button.addEventListener('click', () => {
                const favorId = button.dataset.communityFavorAccept;

                if (!favorId) return;

                window.app?.acceptCommunityFavor?.(favorId);
            });
        });
}

function getFreeAgentScoutingView(team, player) {
    const report = Game.getTeamScoutingReport?.(
        team,
        player?.id
    ) || null;

    const rawLevel = Number(report?.level);
    const level =
        Number.isInteger(rawLevel) &&
        rawLevel >= 1 &&
        rawLevel <= 4
            ? rawLevel
            : 0;

    const rawProgress = Number(report?.progressPoints);
    const progress = Number.isFinite(rawProgress)
        ? Math.max(0, rawProgress)
        : 0;

    const rawConfidence = Number(report?.confidence);
    const confidence = Number.isFinite(rawConfidence)
        ? Math.max(0, Math.min(1, rawConfidence))
        : null;

    const evaluation = report?.evaluation || {};

    const getFit = fit => {
        if (
            level < 1 ||
            !fit ||
            typeof fit.position !== 'string' ||
            !Number.isFinite(Number(fit.low)) ||
            !Number.isFinite(Number(fit.high))
        ) {
            return null;
        }

        const low = Math.round(Number(fit.low));
        const high = Math.round(Number(fit.high));

        return {
            position: fit.position,
            low: Math.min(low, high),
            high: Math.max(low, high),
            estimate: (low + high) / 2
        };
    };

    const offense = getFit(evaluation.offenseFit);
    const defense = getFit(evaluation.defenseFit);

    const levelThresholds = [0, 4, 12, 24, 40];

    const progressStart = levelThresholds[level];
    const progressEnd = level >= 4
        ? 40
        : levelThresholds[level + 1];

    const progressToNextPercent = level >= 4
        ? 100
        : Math.max(
            0,
            Math.min(
                100,
                ((progress - progressStart) /
                    (progressEnd - progressStart)) * 100
            )
        );

    const status = level > 0
        ? `Level ${level}${confidence !== null
            ? ` · ${Math.round(confidence * 100)}% confidence`
            : ''}`
        : progress > 0
            ? 'Scouting in progress'
            : 'Unscouted';

    const pointsWithinLevel = Math.max(
        0,
        Math.min(
            progressEnd - progressStart,
            progress - progressStart
        )
    );

    const pointsNeeded = progressEnd - progressStart;

    const progressLabel = level >= 4
        ? 'Fully scouted'
        : `${pointsWithinLevel.toFixed(1)} / ${pointsNeeded} pts to Level ${level + 1}`;

    const fitScores = [offense, defense]
        .filter(Boolean)
        .map(fit => fit.estimate);

    return {
        level,
        progress,
        status,
        progressToNextPercent,
        progressLabel,
        offense,
        defense,
        projectedRole: level > 0
            ? evaluation.projectedRole || null
            : null,

        // Used only for table ordering. Never substitute the actual OVR.
        sortScore: fitScores.length > 0
            ? Math.max(...fitScores)
            : -1
    };
}

function compareFreeAgentsByScouting(a, b, team) {
    const reportA = getFreeAgentScoutingView(team, a);
    const reportB = getFreeAgentScoutingView(team, b);

    // Prefer players with meaningful reports, then better estimated fits.
    if (reportA.level !== reportB.level) {
        return reportB.level - reportA.level;
    }

    if (
        reportA.sortScore !== reportB.sortScore &&
        reportA.sortScore >= 0 &&
        reportB.sortScore >= 0
    ) {
        return reportB.sortScore - reportA.sortScore;
    }

    // Unknown players are not ranked by their hidden abilities.
    if (
        (reportA.progress > 0) !== (reportB.progress > 0)
    ) {
        return reportA.progress > 0 ? -1 : 1;
    }

    return a.age - b.age ||
        String(a.name || '').localeCompare(String(b.name || ''));
}

function formatFreeAgentScoutingFit(fit) {
    return fit
        ? `${fit.position} ${fit.low}–${fit.high}`
        : 'Not assessed';
}

function getFreeAgentDisplayPosition(team, player) {
    const declaredPosition =
        typeof player?.pos === 'string'
            ? player.pos.trim()
            : '';

    if (declaredPosition) return declaredPosition;

    const scouting = getFreeAgentScoutingView(team, player);

    return scouting.offense?.position ||
        scouting.defense?.position ||
        'ATH';
}

function matchesFreeAgentPositionFilter(team, player, requestedPosition) {
    if (!requestedPosition) return true;

    const requested = String(requestedPosition).toUpperCase();
    const declared = String(player?.pos || '').toUpperCase();

    // A player's declared position is visible without a scouting report.
    if (declared === requested) return true;

    // Additional positional fits require our team's scouting report.
    const scouting = getFreeAgentScoutingView(team, player);

    if (scouting.level < 1) return false;

    return (
        String(scouting.offense?.position || '').toUpperCase() === requested ||
        String(scouting.defense?.position || '').toUpperCase() === requested
    );
}

window.app_updatePlayerDbFilter = function () {
    const gs = getGameState();
    if (gs) renderFreeAgentsTab(gs);
};

export function renderFreeAgentsTab(gameState) {
    const container = document.getElementById('free-agents-container');
    if (!container || !gameState) return;

    const userTeam = gameState.playerTeam;
    const posFilter = document.getElementById('fa-filter-pos')?.value || '';
    const scopeFilter = document.getElementById('player-db-scope')?.value || 'free_agents';
    const searchQuery = (document.getElementById('player-db-search')?.value || '').trim().toLowerCase();

    const teamsById = new Map((gameState.teams || []).map(t => [String(t.id), t]));
    const isOffseasonRecruiting = gameState.offseasonState?.phase === 'recruiting' && !gameState.offseasonState?.completed;
    const isRegularSeason = Number(gameState.currentWeek) > 0 && gameState.currentWeek <= 9;

    // Check emergency roster shortage criteria (fewer than 8 healthy players)
    const myRoster = getRosterObjects(userTeam);
    const healthyCount = myRoster.filter(p => !['departed', 'retired'].includes(p.status?.type) && !(Number(p.status?.duration) > 0)).length;
    const isEmergencyNeed = isRegularSeason && healthyCount < 8 && (Number(userTeam?.socialProfile?.favorTokens) || 0) > 0;

    let pool = (gameState.players || []).filter(p => {
        if (!p || p.id == null) return false;
        if (['retired', 'departed'].includes(p.status?.type)) return false;

        // Search text
        if (searchQuery && !p.name.toLowerCase().includes(searchQuery)) return false;

        // Scope filter
        const team = p.teamId ? teamsById.get(String(p.teamId)) : null;
        if (scopeFilter === 'free_agents' && p.teamId != null) return false;
        if (scopeFilter === 'my_team' && p.teamId !== userTeam?.id) return false;
        if (scopeFilter === 'tier1' && team?.tier !== 1) return false;
        if (scopeFilter === 'tier2' && team?.tier !== 2) return false;
        if (scopeFilter === 'youth' && team?.leagueType !== 'youth') return false;

        return true;
    });

    if (posFilter) {
        pool = pool.filter(p => matchesFreeAgentPositionFilter(userTeam, p, posFilter));
    }

    // Sort by known team fit or scouting level
    pool.sort((a, b) => compareFreeAgentsByScouting(a, b, userTeam));

    // Cap at top 75 records to preserve DOM performance
    const totalCount = pool.length;
    pool = pool.slice(0, 75);

    if (pool.length === 0) {
        container.innerHTML = `
            <div class="p-12 text-center text-slate-400 font-sans">
                <span class="text-3xl block mb-2">🔍</span>
                <p class="font-bold text-sm text-slate-700">No players match the current filters.</p>
                <p class="text-xs text-slate-500 mt-1">Try broadening your search query or selecting a different team scope.</p>
            </div>`;
        return;
    }

    container.innerHTML = `
        ${isEmergencyNeed ? `
            <div class="bg-rose-50 border-b border-rose-200 p-2.5 px-4 flex justify-between items-center text-xs text-rose-900 shrink-0">
                <div class="flex items-center gap-2">
                    <span class="text-base">🚨</span>
                    <span><b>Emergency Short Roster:</b> You have only <b>${healthyCount}</b> healthy players (8 required). Call in an available connected free agent using 1 Favor Token.</span>
                </div>
            </div>
        ` : ''}

        <div class="bg-slate-50 px-3 py-1.5 border-b border-slate-200 text-[10px] font-mono text-slate-500 flex justify-between">
            <span>Showing top ${pool.length} of ${totalCount} matching players</span>
            <span>External players display imperfect scouting estimates</span>
        </div>

        <table class="min-w-full text-xs font-mono">
            <thead class="bg-slate-900 text-white uppercase text-[10px] select-none sticky top-0 z-10">
                <tr>
                    <th class="py-2.5 px-3 text-left font-sans">Player</th>
                    <th class="py-2 px-2 text-center">Team / Status</th>
                    <th class="py-2 px-2 text-center">Pos</th>
                    <th class="py-2 px-2 text-center">Age</th>
                    <th class="py-2 px-3 text-left font-sans">Scouting Report</th>
                    <th class="py-2 px-2 text-center">OFF Fit</th>
                    <th class="py-2 px-2 text-center">DEF Fit</th>
                    <th class="py-2 px-3 text-right font-sans">Action</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                ${pool.map(p => {
                    const isMyPlayer = p.teamId === userTeam?.id;
                    const assignedTeam = p.teamId ? teamsById.get(String(p.teamId)) : null;
                    const pos = isMyPlayer ? (p.pos || estimateBestPosition(p)) : getFreeAgentDisplayPosition(userTeam, p);
                    const scouting = getFreeAgentScoutingView(userTeam, p);

                    let offFitDisplay = '—';
                    let defFitDisplay = '—';

                    if (isMyPlayer) {
                        const fits = getBestTwoWayFits(p);
                        offFitDisplay = `<span class="font-bold text-emerald-700">${fits.offense.position} ${fits.offense.ovr}</span>`;
                        defFitDisplay = `<span class="font-bold text-blue-700">${fits.defense.position} ${fits.defense.ovr}</span>`;
                    } else {
                        offFitDisplay = formatFreeAgentScoutingFit(scouting.offense);
                        defFitDisplay = formatFreeAgentScoutingFit(scouting.defense);
                    }

                    const scoutingClass = isMyPlayer
                        ? 'text-emerald-700 font-black'
                        : scouting.level >= 3
                            ? 'text-emerald-700'
                            : scouting.level > 0
                                ? 'text-blue-700'
                                : 'text-slate-400';

                    const scoutingLabel = isMyPlayer
                        ? 'Rostered Player (Full Intel)'
                        : scouting.status;

                    // Action buttons by phase and context
                    let actionButton = `
                        <button class="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-2.5 py-1 rounded text-[10px] uppercase tracking-wider transition" onclick="app.openPlayerCard('${p.id}')">
                            Dossier 📋
                        </button>
                    `;

                    if (!p.teamId && isOffseasonRecruiting) {
                        actionButton = `
                            <button class="bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-2.5 py-1 rounded text-[10px] uppercase tracking-wider shadow-sm transition" onclick="app.openBidModal('${p.id}')">
                                Recruit 🤝
                            </button>
                        `;
                    } else if (!p.teamId && isEmergencyNeed) {
                        actionButton = `
                            <button class="bg-rose-700 hover:bg-rose-800 text-white font-bold px-2.5 py-1 rounded text-[10px] uppercase tracking-wider shadow-sm transition animate-pulse" onclick="window.app_callEmergencyFriend('${p.id}')">
                                Call Up 📞
                            </button>
                        `;
                    }

                    const teamBadge = isMyPlayer
                        ? `<span class="bg-amber-100 text-amber-900 border border-amber-300 font-bold px-1.5 py-0.5 rounded text-[9px]">YOUR ROSTER</span>`
                        : assignedTeam
                            ? `<span class="bg-slate-100 text-slate-700 border border-slate-200 font-semibold px-1.5 py-0.5 rounded text-[9px] truncate max-w-[110px] inline-block">${assignedTeam.name}</span>`
                            : `<span class="bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold px-1.5 py-0.5 rounded text-[9px]">FREE AGENT</span>`;

                    return `
                    <tr class="hover:bg-slate-50 transition cursor-pointer" onclick="app.openPlayerCard('${p.id}')">
                        <td class="py-2 px-3 font-sans font-semibold text-slate-900">
                            <span>${p.name}</span>
                            ${p.status?.duration > 0 ? `<span class="ml-1 text-[9px] text-rose-600 font-bold">🩹 ${p.status.description}</span>` : ''}
                        </td>
                        <td class="text-center py-2 px-2 font-sans">${teamBadge}</td>
                        <td class="text-center py-2 px-2">
                            <span class="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-bold text-[10px]">${pos}</span>
                        </td>
                        <td class="text-center py-2 px-2 text-slate-600">${p.age}</td>
                        <td class="py-2 px-3 font-sans min-w-[140px]">
                            <span class="font-bold ${scoutingClass}">${scoutingLabel}</span>
                            ${!isMyPlayer ? `
                                <div class="h-1.5 bg-slate-200 rounded-full overflow-hidden mt-1">
                                    <div class="h-full bg-indigo-500 rounded-full" style="width: ${scouting.progressToNextPercent}%"></div>
                                </div>
                                <span class="block text-[9px] text-slate-400 mt-0.5">${scouting.progressLabel}</span>
                            ` : ''}
                        </td>
                        <td class="text-center py-2 px-2 font-mono text-slate-700">${offFitDisplay}</td>
                        <td class="text-center py-2 px-2 font-mono text-slate-700">${defFitDisplay}</td>
                        <td class="text-right py-2 px-3 font-sans" onclick="event.stopPropagation()">
                            ${actionButton}
                        </td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>
    `;
}

let offseasonFABids = [];
let offseasonFADay = 1;
let recruitingActiveTab = 'prospects';

let recruitingQuickAssignDefaults = {
    coachId: '',
    actionType: 'outreach',
    hours: 2
};

const recruitingQuickSelectedIds = new Set();
const recruitingTryoutSelectedIds = new Set();

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
    const userCashEl = document.getElementById('fa-user-cash');
    const userStaffHoursEl = document.getElementById('fa-user-staff-hours');
    const userTargetCountEl = document.getElementById('fa-user-target-count');
    const userStaffHoursUsedEl = document.getElementById('fa-user-staff-hours-used');
    const userActiveOffersEl = document.getElementById('fa-user-active-offers');
    const userCommitmentsEl = document.getElementById('fa-user-commitments');
    const advanceBtn = document.getElementById('fa-advance-day-btn');

    const state = gameState.offseasonState || {};
    const progress = state.recruitingProgress || {};

    const normalizedPhase = String(state.phase || '')
        .toLowerCase()
        .replace(/[^a-z]/g, '');

    const isRosterFinalization =
        normalizedPhase === 'rosterfinalization';

    const isFinalizationRecovery =
        normalizedPhase === 'recruiting' &&
        progress.completed === true;

    const currentDay = Math.max(
        1,
        Math.floor(Number(state.recruitingDay) || 1)
    );
    const totalDays = Math.max(
        1,
        Math.floor(Number(state.recruitingDays) || 7)
    );

    const team = gameState.playerTeam;
    const totalTokens = Math.max(
        0,
        Math.floor(Number(team.socialProfile?.favorTokens) || 0)
    );

    const rosterSize = Game.getRosterObjects(team).length;
    const rosterLimit = Game.getCurrentRosterLimit?.(gameState) || 18;

    const teamBalance = Number(team.finances?.balance);

    const recruitingCash = Number.isFinite(teamBalance)
        ? teamBalance
        : 0;

    const staffBudgets =
        Game.getRecruitingStaffHourBudget?.(team, gameState) || [];

    const staffHours = staffBudgets.reduce(
        (totals, coach) => {
            const weeklyCapacity = Math.max(
                0,
                Number(
                    coach.weeklyCapacity ?? coach.weeklyHours
                ) || 0
            );
            const remainingHours = Math.max(
                0,
                Number(
                    coach.remainingHours ?? weeklyCapacity
                ) || 0
            );

            totals.total += weeklyCapacity;
            totals.remaining += remainingHours;

            return totals;
        },
        { total: 0, remaining: 0 }
    );

    const formatStaffHours = value =>
        (Math.round(value * 10) / 10).toString();

    // Recruiting list size.
    const recruitingTeamKey = String(team.id);

    const recruitingList = Array.isArray(
        progress.teamRecruitingLists?.[recruitingTeamKey]
    )
        ? progress.teamRecruitingLists[recruitingTeamKey]
        : [];

    const recruitingTargetCount = recruitingList.length;

    // Hours committed across the shared staff workload.
    // This includes recruiting, scouting, and other assigned work.
    const staffHoursUsed = Math.max(
        0,
        staffHours.total - staffHours.remaining
    );

    // Count every active roster invitation from our team,
    // including invitations to prospects not currently on our list.
    const activeOfferCount = Object.values(
        progress.recruits || {}
    ).reduce((total, record) => {
        const offer =
            record?.offersByTeam?.[recruitingTeamKey];

        return total + (
            offer?.status === 'active' ? 1 : 0
        );
    }, 0);

    // Count commitments belonging specifically to our team.
    const commitmentIds = new Set(
        (
            Array.isArray(progress.commitments)
                ? progress.commitments
                : []
        )
            .filter(commitment =>
                commitment?.playerId != null &&
                String(commitment.teamId) === recruitingTeamKey
            )
            .map(commitment => String(commitment.playerId))
    );

    const commitmentCount = commitmentIds.size;

    if (userTargetCountEl) {
        userTargetCountEl.textContent =
            String(recruitingTargetCount);
    }

    if (userStaffHoursUsedEl) {
        userStaffHoursUsedEl.textContent =
            `${formatStaffHours(staffHoursUsed)}h / ` +
            `${formatStaffHours(staffHours.total)}h`;
    }

    if (userActiveOffersEl) {
        userActiveOffersEl.textContent =
            String(activeOfferCount);
    }

    if (userCommitmentsEl) {
        userCommitmentsEl.textContent =
            String(commitmentCount);
    }

    if (userCashEl) {
        userCashEl.textContent = recruitingCash.toFixed(2);
    }

    if (userStaffHoursEl) {
        userStaffHoursEl.textContent =
            `${formatStaffHours(staffHours.remaining)} / ` +
            `${formatStaffHours(staffHours.total)}h`;
    }

    if (roundIndicator) {
        if (isRosterFinalization) {
            roundIndicator.textContent =
                'Recruiting Complete · Roster Finalization';
        } else if (isFinalizationRecovery) {
            roundIndicator.textContent =
                'Recruiting Resolved · Finalization Retry';
        } else {
            roundIndicator.textContent =
                `Recruiting · Day ${currentDay} of ${totalDays}` +
                (currentDay === totalDays ? ' · Final Day' : '');
        }
    }

    if (userTokensEl) {
        userTokensEl.textContent = `${totalTokens} available`;
    }

    if (userRosterEl) {
        userRosterEl.textContent = `${rosterSize}/${rosterLimit}`;
    }

    if (advanceBtn) {
        advanceBtn.className =
            'bg-emerald-700 hover:bg-emerald-800 text-white font-bold ' +
            'px-4 py-2 rounded text-xs uppercase tracking-wider shadow-sm transition';

        if (isRosterFinalization) {
            advanceBtn.textContent = 'Review Final Roster →';
            advanceBtn.onclick = () =>
                window.app.finishOffseasonFAMinigame();
        } else if (isFinalizationRecovery) {
            advanceBtn.textContent = 'Retry Finalization →';
            advanceBtn.onclick = () =>
                window.app.advanceOffseasonFADay();
        } else {
            advanceBtn.textContent = currentDay >= totalDays
                ? 'Resolve Final Day & Review Roster →'
                : `Resolve Day ${currentDay} & Continue →`;

            advanceBtn.onclick = () =>
                window.app.advanceOffseasonFADay();
        }
    }

    renderOffseasonFAPool(gameState);
    renderRecruitingActivityPanel(gameState);
}

function renderRecruitingActivityPanel(gameState) {
    const activityEl = document.getElementById('fa-pending-bids-list');
    const countEl = document.getElementById('fa-bids-count');

    if (!activityEl) return;

    const state = gameState?.offseasonState;
    const progress = state?.recruitingProgress;
    const team = gameState?.teams?.find(
        t => String(t.id) === String(gameState.playerTeam?.id)
    );

    if (!team || !progress?.initialized) {
        activityEl.innerHTML = `
            <div class="text-sm text-gray-400">
                Recruiting activity will appear here once recruiting begins.
            </div>
        `;

        if (countEl) countEl.textContent = '0 Today';
        return;
    }

    const teamId = String(team.id);
    const day = Math.max(1, Number(state.recruitingDay) || 1);

    const escapeHtml = value => String(value ?? '').replace(
        /[&<>"']/g,
        character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[character]
    );

    const budget = Game.getRecruitingStaffHourBudget?.(team, gameState);
    const coaches = Array.isArray(budget) ? budget : [];

    const coachRows = coaches.map(entry => {
        const coach = entry?.coach || entry;
        const coachId = String(entry?.coachId ?? coach?.id ?? '');
        const coachName = entry?.coachName
            || entry?.name
            || [coach?.firstName, coach?.lastName].filter(Boolean).join(' ')
            || 'Staff member';

        const weeklyHours = Math.max(
            0,
            Number(
                entry?.weeklyCapacity ??
                entry?.weeklyHours ??
                entry?.hours ??
                entry?.availableHours
            ) || 0
        );

        const remainingHours = Math.max(
            0,
            Number(entry?.remainingHours ?? weeklyHours) || 0
        );

        const recruitingHours = Math.max(
            0,
            Number(entry?.recruitingHours) || 0
        );

        const otherHours = Math.max(
            0,
            Number(entry?.otherAssignedHours) || 0
        );

        const coachActions = (
            Array.isArray(progress.dailyActivity)
                ? progress.dailyActivity
                : []
        ).filter(activity =>
            activity?.type === 'recruiting_action' &&
            String(activity.teamId) === teamId &&
            String(activity.coachId) === coachId
        );

        const deliveredRecruitingHours = coachActions.reduce(
            (total, activity) =>
                total + Math.max(
                    0,
                    Number(
                        activity.effectiveHours ?? activity.hours
                    ) || 0
                ),
            0
        );

        return `
            <div class="flex items-center justify-between gap-3 py-2 border-b border-gray-700/50">
                <div class="min-w-0">
                    <div class="text-sm text-gray-200 truncate">
                        ${escapeHtml(coachName)}
                    </div>
                    <div class="text-xs text-gray-500">
                        ${escapeHtml(entry?.role ?? coach?.role ?? 'Staff')}
                    </div>
                </div>
                <div class="text-sm text-right whitespace-nowrap">
                    <div class="text-[10px] text-gray-400">
                        Recruiting ${recruitingHours}h assigned · ${deliveredRecruitingHours.toFixed(1)}h delivered
                    </div>
                    <div class="text-[10px] text-gray-500">
                        Other work ${otherHours}h
                    </div>
                    <div class="text-xs ${remainingHours > 0 ? 'text-emerald-400' : 'text-amber-400'}">
                        ${remainingHours}h recruiting allowance left / ${weeklyHours}h weekly
                    </div>
                </div>
            </div>
        `;
    }).join('');

        const visibleActivity = (Array.isArray(progress.dailyActivity)
        ? progress.dailyActivity
        : []
    ).filter(activity => {
        const activityDay = activity?.type === 'recruiting_outcome'
            ? Number(activity?.decisionDay)
            : Number(activity?.day);

        // Keep activity from the current recruiting week, including
        // earlier commitments that the user may have missed.
        if (
            !Number.isFinite(activityDay) ||
            activityDay < 1 ||
            activityDay > day
        ) {
            return false;
        }

        // Our own recruiting actions and gifts.
        if ([
            'recruiting_action',
            'recruiting_sweetener'
        ].includes(activity?.type)) {
            return String(activity?.teamId) === teamId;
        }

        // Show our roster offers and rival offers to prospects
        // that our program has pursued.
        if (activity?.type === 'recruiting_offer') {
            if (String(activity?.teamId) === teamId) {
                return true;
            }

            const recruitRecord = progress.recruits?.[
                String(activity.playerId)
            ];

            const ourInterest = Number(
                recruitRecord?.interestByTeam?.[teamId]
            ) || 0;

            return ourInterest > 0;
        }

        // Show commitments by any program when we had pursued that player.
        if (activity?.type === 'commitment') {
            if (String(activity?.teamId) === teamId) {
                return true;
            }

            const recruitRecord = progress.recruits?.[
                String(activity.playerId)
            ];

            const ourInterest = Number(
                recruitRecord?.interestByTeam?.[teamId]
            ) || 0;

            return ourInterest > 0;
        }

        // Unsigned outcomes are player decisions rather than team actions.
        if (activity?.type === 'recruiting_outcome') {
            const recruitRecord = progress.recruits?.[
                String(activity.playerId)
            ];

            const ourInterest = Number(
                recruitRecord?.interestByTeam?.[teamId]
            ) || 0;

            return ourInterest > 0;
        }

        return false;
    });

    if (countEl) {
        countEl.textContent = `${visibleActivity.length} This Week`;
    }

    const activityRows = visibleActivity
        .slice()
        .reverse()
        .slice(0, 8)
        .map(activity => {
            const playerId = String(activity?.playerId ?? '');
            const recruit = progress.recruits?.[playerId];
            const player = gameState.players?.find(
                p => String(p.id) === playerId
            );

            const playerName = activity?.playerName
                || recruit?.name
                || (player
                    ? `${player.firstName || ''} ${player.lastName || ''}`.trim()
                    : '')
                || 'Recruit';

            let description = '';

            const interestGain = Number(activity?.interestGain) || 0;
            const interestGainText = interestGain > 0
                ? ` · +${Math.round(interestGain)} interest`
                : '';

            if (activity?.type === 'recruiting_action') {
                const actionLabels = {
                    outreach: 'Personal outreach',
                    teammateConnection: 'Teammate connection',
                    roleDiscussion: 'Role discussion',
                    practiceInvitation: 'Practice invitation'
                };

                const actionLabel =
                    activity.label ||
                    actionLabels[activity.action] ||
                    'Recruiting action';

                const coachName = activity.coachName || 'Staff';

                const requestedHours = Number(
                    activity.requestedHours
                );

                const deliveredHours = Math.max(
                    0,
                    Number(
                        activity.effectiveHours ?? activity.hours
                    ) || 0
                );

                const hoursDetail =
                    Number.isFinite(requestedHours) &&
                    requestedHours > 0
                        ? `${requestedHours}h assigned · ${deliveredHours.toFixed(1)}h delivered`
                        : `${deliveredHours.toFixed(1)}h delivered`;

                description =
                    `${actionLabel} · ${coachName} · ${hoursDetail}` +
                    interestGainText;

            } else if (activity?.type === 'recruiting_sweetener') {
                const resourceDetails = [];

                const cashSpent = Math.max(
                    0,
                    Number(activity.cashSpent) || 0
                );

                const tokensSpent = Math.max(
                    0,
                    Number(activity.tokensSpent) || 0
                );

                if (cashSpent > 0) {
                    resourceDetails.push(
                        `$${cashSpent.toFixed(2)}`
                    );
                }

                if (tokensSpent > 0) {
                    resourceDetails.push(
                        `${tokensSpent} Favor Token${tokensSpent === 1 ? '' : 's'}`
                    );
                }

                description =
                    (activity.label || 'Recruiting support') +
                    (
                        resourceDetails.length > 0
                            ? ` · ${resourceDetails.join(' · ')}`
                            : ''
                    ) +
                    interestGainText;

            } else if (activity?.type === 'recruiting_offer') {
                const fromOurTeam =
                    String(activity.teamId) === teamId;

                const offerTeamName =
                    activity.teamName || 'Another program';

                description = fromOurTeam
                    ? 'Your program extended a roster invitation'
                    : `${offerTeamName} extended a roster invitation`;

            } else if (activity?.type === 'commitment') {
                const committedToOurTeam =
                    String(activity.teamId) === teamId;

                const teamName = activity.teamName || 'Unknown program';

                const chosenProgramInterest = Number(
                    activity.interestAtCommit
                );

                const chosenProgramFit = Number(
                    activity.teamFitAtCommit
                );

                const recruitRecord = progress.recruits?.[playerId];

                const ourInterestAtDecision = Number(
                    recruitRecord?.interestByTeam?.[teamId]
                );

                const decisionLabel = committedToOurTeam
                    ? 'Committed to your program'
                    : `Committed elsewhere: ${teamName}`;

                description = decisionLabel +
                    (
                        !committedToOurTeam
                            ? ` · Your interest ${Math.round(
                                Number.isFinite(ourInterestAtDecision)
                                    ? ourInterestAtDecision
                                    : 0
                            )}/100`
                            : ''
                    ) +
                    (
                        Number.isFinite(chosenProgramInterest)
                            ? ` · Chosen program interest ${Math.round(chosenProgramInterest)}/100`
                            : ''
                    ) +
                    (
                        Number.isFinite(chosenProgramFit)
                            ? ` · Chosen program fit ${Math.round(chosenProgramFit)}/100`
                            : ''
                    );

            } else if (activity?.type === 'recruiting_outcome') {
                description =
                    activity.outcome === 'remained_unsigned_after_offers'
                        ? 'Received serious recruiting interest but remained unsigned'
                        : activity.outcome === 'remained_unsigned_without_serious_offers'
                            ? 'Finished recruiting without a serious offer'
                            : 'Remained unsigned';

            } else {
                description =
                    activity?.description ||
                    activity?.actionLabel ||
                    activity?.action ||
                    activity?.type?.replace(/_/g, ' ') ||
                    'Recruiting activity';
            }

            // Preserve explicit descriptions supplied by future activity
            // types without overriding the more detailed recruiting labels.
            if (
                ![
                    'recruiting_action',
                    'recruiting_sweetener',
                    'recruiting_offer',
                    'commitment',
                    'recruiting_outcome'
                ].includes(activity?.type)
            ) {
                description = activity.description ||
                    activity.actionLabel ||
                    description;
            }

            return `
                <div class="py-2 border-b border-gray-700/50">
                    <div class="flex items-start justify-between gap-3">
                        <div class="text-sm text-gray-200">
                            ${escapeHtml(playerName)}
                        </div>
                        <div class="text-xs text-gray-500 whitespace-nowrap">
                            Day ${
                                activity?.type === 'recruiting_outcome'
                                    ? Number(activity.decisionDay) || '—'
                                    : Number(activity.day) || '—'
                            }
                        </div>
                    </div>
                    <div class="text-xs text-gray-400 mt-1">
                        ${escapeHtml(description)}
                    </div>
                </div>
            `;
        }).join('');

    activityEl.innerHTML = `
        <div class="space-y-4">
            <section>
                <div class="text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">
                    Weekly Staff Hours
                </div>
                ${coachRows || `
                    <div class="text-sm text-gray-500 py-2">
                        No recruiting staff hours are available.
                    </div>
                `}
            </section>

            <section>
                <div class="text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">
                    Recruiting Week Activity
                </div>
                ${activityRows || `
                    <div class="text-sm text-gray-500 py-2">
                        No recruiting actions recorded today.
                    </div>
                `}
            </section>
        </div>
    `;
}


export function renderOffseasonFAPool(gameState) {
    const container = document.getElementById('fa-minigame-pool-tbody');
    if (!container || !gameState) return;

    const state = gameState.offseasonState || {};
    const progress = state.recruitingProgress || {};

    const recruitingAutonomy = String(
        gameState.playerTeam?.teamInstructions
            ?.departments?.recruiting?.autonomy || 'guided'
    )
        .trim()
        .toLowerCase();

    const offerManagementMessage =
        recruitingAutonomy === 'direct'
            ? 'Direct control: Coaches do not recruit or extend offers automatically. You decide which prospects to pursue and when to offer a roster spot.'
            : recruitingAutonomy === 'delegate'
                ? 'Delegate: Coaches handle recruiting and may extend roster offers when their evaluations support it and capacity is available. They have more discretion over your priorities. You can still make or withdraw offers manually.'
                : 'Guided: Coaches handle recruiting and may extend roster offers when their evaluations support it and capacity is available. They follow your recruiting priorities more closely. You can still make or withdraw offers manually.';

    const normalizedPhase = String(state.phase || '')
        .toLowerCase()
        .replace(/[^a-z]/g, '');

    const recruitingActive =
        normalizedPhase === 'recruiting' &&
        progress.initialized === true &&
        progress.completed !== true &&
        Number(progress.seasonYear) === Number(gameState.year);

    if (!recruitingActive) {
        container.innerHTML = `
            <div class="p-8 text-center text-slate-400 italic text-xs">
                Recruiting is closed. Review your roster before the new season begins.
            </div>
        `;
        return;
    }

    const filterPos =
        document.getElementById('fa-minigame-filter-pos')?.value || '';

    const searchTerm = (
        document.getElementById('fa-minigame-search')?.value || ''
    ).trim().toLowerCase();

    const protectedDraftIds = new Set(
        (Array.isArray(gameState.draftClass) ? gameState.draftClass : [])
            .filter(prospect => prospect?.id != null)
            .map(prospect => String(prospect.id))
    );

    let pool = (Array.isArray(gameState.players) ? gameState.players : [])
        .filter(player => {
            if (!player || player.id == null || player.teamId != null) {
                return false;
            }

            const record = progress.recruits?.[String(player.id)];
            const age = Number(player.age);

            const statusType = String(
                player.status?.type || ''
            ).toLowerCase();

            const lifecycle = String(
                player.lifecycle || ''
            ).toLowerCase();

            const lifecycleStatus = String(
                player.lifecycleStatus || player.lifecycle?.status || ''
            ).toLowerCase();

            return (
                record?.status === 'available' &&
                record.committedTeamId == null &&
                Number.isFinite(age) &&
                age >= 12 &&
                age <= 18 &&
                !protectedDraftIds.has(String(player.id)) &&
                lifecycle !== 'draft_eligible' &&
                lifecycleStatus !== 'draft_eligible' &&
                !['retired', 'departed', 'temporary'].includes(statusType) &&
                !['retired', 'departed', 'temporary'].includes(lifecycleStatus) &&
                !(Number(player.status?.duration) > 0) &&
                !(Number(player.injury?.duration || player.injuryDuration || 0) > 0)
            );
        });

    if (searchTerm) {
        pool = pool.filter(player => {
            const playerName = String(
                player.name ||
                [
                    player.firstName,
                    player.lastName
                ].filter(Boolean).join(' ')
            ).toLowerCase();

            return playerName.includes(searchTerm);
        });
    }

    if (filterPos) {
        pool = pool.filter(p =>
            matchesFreeAgentPositionFilter(
                gameState.playerTeam,
                p,
                filterPos
            )
        );
    }

    const resultCountEl = document.getElementById(
        'fa-minigame-result-count'
    );

    if (resultCountEl) {
        resultCountEl.textContent =
            `${pool.length} matching prospect${pool.length === 1 ? '' : 's'}`;
    }

    pool.sort((a, b) =>
        compareFreeAgentsByScouting(
            a,
            b,
            gameState.playerTeam
        )
    );
    // Build the shared quick-assignment coach list using remaining
    // weekly hours, not just each coach's original capacity.
    const quickBudget =
        Game.getRecruitingStaffHourBudget?.(
            gameState.playerTeam,
            gameState
        ) || [];

    const quickCoachRecords = [
        ...(Array.isArray(gameState.playerTeam.coaches)
            ? gameState.playerTeam.coaches
            : []),
        ...Object.values(gameState.playerTeam.staff || {})
    ];

    const quickAssignCoaches = quickBudget.map(coach => {
        const profile = quickCoachRecords.find(candidate =>
            String(candidate?.id) === String(coach.coachId)
        );
        const recruitingSkills = [
            'teaching',
            'evalCharacter',
            'gameplanInstinct',
            'conditioning'
        ].map(key => Number(profile?.ratings?.[key]))
            .filter(Number.isFinite);

        return {
            ...coach,
            role: profile?.role || 'Volunteer coach',
            skillEstimate: recruitingSkills.length > 0
                ? Math.round(
                    recruitingSkills.reduce((total, value) => total + value, 0) /
                    recruitingSkills.length
                )
                : 50,
            remainingHours: Math.max(
                0,
                Number(
                    coach.remainingHours ??
                    coach.weeklyCapacity ??
                    coach.weeklyHours
                ) || 0
            )
        };
    }).filter(coach => coach.remainingHours > 0);

    if (!quickAssignCoaches.some(coach =>
        String(coach.coachId) === String(recruitingQuickAssignDefaults.coachId)
    )) {
        recruitingQuickAssignDefaults.coachId =
            quickAssignCoaches[0]?.coachId || '';
    }

    const quickSelectedCoach = quickAssignCoaches.find(coach =>
        String(coach.coachId) ===
        String(recruitingQuickAssignDefaults.coachId)
    );

    const quickMaxHours = quickSelectedCoach?.remainingHours || 1;

    recruitingQuickAssignDefaults.hours = Math.max(
        1,
        Math.min(
            quickMaxHours,
            Math.floor(Number(recruitingQuickAssignDefaults.hours) || 2)
        )
    );

    const quickEscapeHtml = value => String(value ?? '').replace(
        /[&<>"']/g,
        character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[character]
    );

    const playerTeamKey = String(gameState.playerTeam.id);

    const userRecruitingList = Array.isArray(
        progress.teamRecruitingLists?.[playerTeamKey]
    )
        ? progress.teamRecruitingLists[playerTeamKey]
        : [];

    const userRecruitingListIds = new Set(
        userRecruitingList
            .filter(entry => entry?.playerId != null)
            .map(entry => String(entry.playerId))
    );

    // Clear group-tryout selections for prospects no longer on the list.
    for (const selectedId of recruitingTryoutSelectedIds) {
        if (!userRecruitingListIds.has(String(selectedId))) {
            recruitingTryoutSelectedIds.delete(selectedId);
        }
    }

    const listCoachOptions = quickBudget
        .filter(coach => coach?.coachId != null)
        .map(coach => {
            const profile = quickCoachRecords.find(candidate =>
                String(candidate?.id) === String(coach.coachId)
            );

            const remainingHours = Math.max(
                0,
                Number(
                    coach.remainingHours ??
                    coach.weeklyCapacity ??
                    coach.weeklyHours
                ) || 0
            );

            return {
                coachId: String(coach.coachId),
                coachName:
                    profile?.name ||
                    profile?.coachName ||
                    coach.coachName ||
                    `Coach ${coach.coachId}`,
                remainingHours
            };
        });

    const teamTryoutActivities = (
        Array.isArray(progress.dailyActivity)
            ? progress.dailyActivity
            : []
    ).filter(activity =>
        String(activity.teamId) === playerTeamKey &&
        Number(activity.year) === Number(gameState.year) &&
        Number(activity.day) >= 1 &&
        Number(activity.day) <= 7 &&
        (
            activity.type === 'recruiting_tryout' ||
            ['tryout', 'tryout_batch'].includes(
                String(activity.action || '')
            )
        )
    );

    const canHostGroupTryout = listCoachOptions.some(
        coach => coach.remainingHours >= 2
    );

    const userRecruitingListHtml = userRecruitingList.map(
        (entry, index) => {
            const playerId = String(entry?.playerId ?? '');

            const player = gameState.players.find(candidate =>
                String(candidate?.id) === playerId
            );

            const record = progress.recruits?.[playerId];

            const interest = Math.max(
                0,
                Math.min(
                    100,
                    Number(
                        record?.interestByTeam?.[playerTeamKey]
                    ) || 0
                )
            );

            const committedTeamId =
                record?.committedTeamId ?? player?.teamId ?? null;

            const statusLabel = committedTeamId != null
                ? String(committedTeamId) === playerTeamKey
                    ? 'Committed to your team'
                    : 'Committed elsewhere'
                : player && record?.status === 'available' &&
                  player.teamId == null
                    ? 'Available'
                    : 'Unavailable';

            const hasTryoutThisWeek =
                teamTryoutActivities.some(activity =>
                    String(activity.playerId) === playerId
                ) ||
                (
                    Array.isArray(record?.history) &&
                    record.history.some(activity =>
                        String(activity.teamId) === playerTeamKey &&
                        Number(activity.year) === Number(gameState.year) &&
                        (
                            activity.type === 'recruiting_tryout' ||
                            (
                                activity.type === 'recruiting_action' &&
                                ['tryout', 'tryout_batch'].includes(
                                    String(activity.action || '')
                                )
                            )
                        )
                    )
                );

            const canJoinGroupTryout =
                statusLabel === 'Available' &&
                !hasTryoutThisWeek;

            if (!canJoinGroupTryout) {
                recruitingTryoutSelectedIds.delete(playerId);
            }

            const userOffer =
                record?.offersByTeam?.[playerTeamKey] || null;

            const hasActiveOffer =
                userOffer?.status === 'active';

            const offerStatusLabel = hasActiveOffer
                ? 'Offer active · Roster spot reserved'
                : userOffer?.status === 'withdrawn'
                    ? 'Previous offer withdrawn'
                    : userOffer?.status === 'accepted'
                        ? 'Offer accepted'
                        : userOffer?.status === 'declined'
                            ? 'Offer declined'
                            : 'No roster offer';

            const canManageOffer =
                statusLabel === 'Available';

            const offerActionHtml = canManageOffer
                ? `
                    <button
                        type="button"
                        onclick="window.app_setRecruitingOffer('${quickEscapeHtml(playerId)}', '${hasActiveOffer ? 'withdraw' : 'extend'}')"
                        class="${hasActiveOffer
                            ? 'border border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100'
                            : 'bg-emerald-700 text-white hover:bg-emerald-800'
                        } rounded px-3 py-1.5 text-[10px] font-black uppercase tracking-wide">
                        ${hasActiveOffer ? 'Withdraw Offer' : 'Offer Spot'}
                    </button>
                `
                : `
                    <span class="rounded bg-slate-100 px-2 py-1.5 text-[9px] font-bold text-slate-400">
                        Offer unavailable
                    </span>
                `;

            const manualRecruitingActionsHtml =
                statusLabel === 'Available'
                    ? `
                        <div class="flex min-w-[116px] flex-col gap-1.5">
                            <button
                                type="button"
                                onclick="window.app_openRecruitingActionModal('${quickEscapeHtml(playerId)}')"
                                class="w-full rounded bg-slate-900 px-2 py-1.5 text-[10px] font-black uppercase tracking-wide text-white hover:bg-slate-800">
                                Recruit
                            </button>

                            <button
                                type="button"
                                onclick="window.app_openRecruitingSweetenerModal('${quickEscapeHtml(playerId)}')"
                                class="w-full rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-[10px] font-black uppercase tracking-wide text-amber-900 hover:bg-amber-100">
                                Gift / Favor
                            </button>
                        </div>
                    `
                    : `
                        <span class="text-[9px] font-semibold text-slate-400">
                            Actions unavailable
                        </span>
                    `;

            const position = player
                ? getFreeAgentDisplayPosition(
                    gameState.playerTeam,
                    player
                )
                : entry?.position || '—';

            const assignedCoachId =
                entry?.assignedCoachId == null
                    ? ''
                    : String(entry.assignedCoachId);

            const assignedCoach = listCoachOptions.find(coach =>
                coach.coachId === assignedCoachId
            );

            const assignedCoachLabel = assignedCoach?.coachName ||
                (
                    assignedCoachId
                        ? 'Previously assigned coach'
                        : 'Any available coach'
                );

            const coachPickerOptionsHtml = `
                <button
                    type="button"
                    onclick="window.app_setRecruitingListCoach('${quickEscapeHtml(playerId)}', '')"
                    class="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-xs hover:bg-emerald-50">
                    <span class="font-bold text-slate-800">
                        Any available coach
                    </span>
                    <span class="text-[9px] text-slate-500">
                        Delegate
                    </span>
                </button>

                <div class="my-1 border-t border-slate-200"></div>

                ${listCoachOptions.map(coach => {
                    const isCurrent =
                        coach.coachId === assignedCoachId;

                    const isUnavailable =
                        coach.remainingHours <= 0 && !isCurrent;

                    return `
                        <button
                            type="button"
                            onclick="window.app_setRecruitingListCoach('${quickEscapeHtml(playerId)}', '${quickEscapeHtml(coach.coachId)}')"
                            ${isUnavailable ? 'disabled' : ''}
                            class="flex w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40">
                            <span class="truncate text-xs font-bold text-slate-800">
                                ${quickEscapeHtml(coach.coachName)}
                            </span>
                            <span class="shrink-0 text-[9px] font-semibold text-slate-500">
                                ${coach.remainingHours}h left
                            </span>
                        </button>
                    `;
                }).join('')}
            `;

            const actionLabels = {
                outreach: 'Personal outreach',
                teammateConnection: 'Teammate connection',
                roleDiscussion: 'Role discussion',
                practiceInvitation: 'Practice invitation',
                tryout: 'Individual tryout',
                tryout_batch: 'Group tryout'
            };

            // Use the actual activity log as the source of truth.
            const allStaffActivities = (
                Array.isArray(progress.dailyActivity)
                    ? progress.dailyActivity
                    : []
            )
                .filter(activity =>
                    String(activity.playerId) === playerId &&
                    String(activity.teamId) === playerTeamKey &&
                    Number(activity.year) === Number(gameState.year) &&
                    [
                        'recruiting_action',
                        'recruiting_sweetener'
                    ].includes(activity.type)
                )
                .sort((a, b) =>
                    (Number(b.day) || 0) -
                    (Number(a.day) || 0)
                );

            const workedRecruitingDays = new Set(
                allStaffActivities
                    .filter(activity =>
                        activity.type === 'recruiting_action'
                    )
                    .map(activity => Number(activity.day))
                    .filter(day =>
                        Number.isInteger(day) &&
                        day >= 1 &&
                        day <= 7
                    )
            );

            const recentStaffActivities =
                allStaffActivities.slice(0, 3);

            const recentWorkHtml =
                recentStaffActivities.length > 0
                    ? recentStaffActivities.map(activity => {
                        const isTeamActivity =
                            activity.type === 'recruiting_sweetener';

                        const coach = !isTeamActivity &&
                            activity.coachId != null
                            ? listCoachOptions.find(candidate =>
                                candidate.coachId === String(activity.coachId)
                            )
                            : null;

                        const coachName = isTeamActivity
                            ? 'Team'
                            : activity.coachName ||
                              coach?.coachName ||
                              'Staff';

                        const actionLabel = isTeamActivity
                            ? activity.label || 'Recruiting gift / favor'
                            : actionLabels[activity.action] ||
                              activity.label ||
                              'Recruiting contact';

                        // Gifts and favors do not consume staff hours.
                        const hours = isTeamActivity
                            ? 0
                            : Math.max(
                                0,
                                Number(activity.hours) || 0
                            );

                        return `
                            <div class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[9px]">
                                <span class="font-black text-slate-700">
                                    Day ${Math.max(1, Number(activity.day) || 1)}
                                </span>

                                <span class="${
                                    isTeamActivity
                                        ? 'font-bold text-amber-700'
                                        : 'text-slate-500'
                                }">
                                    ${quickEscapeHtml(coachName)}
                                </span>

                                <span class="text-slate-400">·</span>

                                <span class="text-slate-600">
                                    ${quickEscapeHtml(actionLabel)}
                                </span>

                                ${
                                    hours > 0
                                        ? `
                                            <span class="font-bold text-indigo-700">
                                                ${hours}h
                                            </span>
                                        `
                                        : ''
                                }
                            </div>
                        `;
                    }).join('')
                    : entry?.lastWorkedDay != null
                        ? `
                            <div class="text-[10px] font-semibold text-slate-700">
                                Last recorded: Day ${entry.lastWorkedDay}
                            </div>
                            <div class="mt-1 text-[9px] text-slate-500">
                                Detailed activity history unavailable
                            </div>
                        `
                        : `
                            <div class="text-[10px] font-semibold text-amber-700">
                                No staff work recorded yet
                            </div>
                        `;

            const workedDayCount = workedRecruitingDays.size;

            const workDayTrackerHtml = `
                <div class="flex items-center gap-1.5">
                    ${Array.from({ length: 7 }, (_, dayIndex) => {
                        const day = dayIndex + 1;
                        const worked = workedRecruitingDays.has(day);

                        return `
                            <div
                                class="flex flex-col items-center gap-1"
                                title="Day ${day}: ${
                                    worked
                                        ? 'Staff contact recorded'
                                        : 'No staff contact recorded'
                                }">

                                <span class="h-3.5 w-3.5 rounded-full border ${
                                    worked
                                        ? 'border-emerald-700 bg-emerald-500'
                                        : 'border-slate-300 bg-slate-100'
                                }"></span>

                                <span class="text-[8px] font-bold text-slate-400">
                                    ${day}
                                </span>
                            </div>
                        `;
                    }).join('')}
                </div>

                <div class="mt-1 text-[9px] font-bold ${
                    workedDayCount >= 5
                        ? 'text-emerald-700'
                        : workedDayCount > 0
                            ? 'text-slate-600'
                            : 'text-amber-700'
                }">
                    ${workedDayCount}/7 days contacted
                </div>
            `;

            return `
                <tr class="border-b border-slate-200 hover:bg-slate-50 ${
                    index % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'
                }">

                    <!-- Group tryout selection -->
                    <td class="w-10 px-3 py-3 text-center">
                        <input
                            type="checkbox"
                            class="fa-tryout-select h-4 w-4 accent-emerald-700 disabled:cursor-not-allowed disabled:opacity-30"
                            value="${quickEscapeHtml(playerId)}"
                            data-tryout-eligible="${canJoinGroupTryout ? 'true' : 'false'}"
                            ${recruitingTryoutSelectedIds.has(playerId) ? 'checked' : ''}
                            ${!canJoinGroupTryout ? 'disabled' : ''}
                            onchange="window.app_toggleRecruitingTryoutSelection('${quickEscapeHtml(playerId)}', this.checked)"
                            title="${
                                hasTryoutThisWeek
                                    ? 'Already tried out this recruiting week'
                                    : canJoinGroupTryout
                                        ? 'Select for a group tryout'
                                        : 'Prospect unavailable'
                            }"
                        />
                    </td>

                    <!-- Priority rank -->
                    <td class="w-12 px-3 py-3 text-center">
                        <span class="inline-flex h-7 w-7 items-center justify-center rounded bg-slate-900 text-xs font-black text-white">
                            ${index + 1}
                        </span>
                    </td>

                    <!-- Prospect -->
                    <td class="min-w-[155px] px-3 py-3">
                        <div class="text-xs font-black text-slate-900">
                            ${quickEscapeHtml(
                                player?.name ||
                                entry?.playerName ||
                                'Unknown prospect'
                            )}
                        </div>

                        <div class="mt-1 flex items-center gap-2">
                            <span class="rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold text-slate-700">
                                ${quickEscapeHtml(position)}
                            </span>

                            <span class="text-[9px] text-slate-500">
                                ${player?.age != null
                                    ? `Age ${quickEscapeHtml(player.age)}`
                                    : ''}
                            </span>
                        </div>

                        <div class="mt-1 text-[9px] text-slate-500">
                            ${quickEscapeHtml(statusLabel)}
                        </div>
                    </td>

                    <!-- Interest -->
                    <td class="w-36 px-3 py-3">
                        <div class="flex items-center justify-between gap-2">
                            <span class="text-[9px] font-bold uppercase text-slate-500">
                                Interest
                            </span>

                            <span class="font-mono text-xs font-black ${
                                interest >= 70
                                    ? 'text-emerald-700'
                                    : interest >= 35
                                        ? 'text-amber-700'
                                        : 'text-slate-700'
                            }">
                                ${interest}/100
                            </span>
                        </div>

                        <div class="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200">
                            <div
                                class="h-full rounded-full ${
                                    interest >= 70
                                        ? 'bg-emerald-600'
                                        : interest >= 35
                                            ? 'bg-amber-500'
                                            : 'bg-slate-500'
                                }"
                                style="width: ${interest}%">
                            </div>
                        </div>
                    </td>

                    <!-- Seven-day staff contact tracker -->
                    <td class="min-w-[155px] px-3 py-3">
                        ${workDayTrackerHtml}
                    </td>

                    <!-- Recruiting coach -->
                    <td class="relative min-w-[190px] px-3 py-3">
                        <button
                            type="button"
                            id="fa-list-coach-trigger-${quickEscapeHtml(playerId)}"
                            aria-expanded="false"
                            onclick="window.app_toggleRecruitingListCoachPicker('${quickEscapeHtml(playerId)}')"
                            class="flex w-full items-center justify-between gap-2 rounded border border-slate-300 bg-white px-2 py-2 text-left text-[10px] font-bold text-slate-700 hover:border-emerald-600">

                            <span class="truncate">
                                ${quickEscapeHtml(assignedCoachLabel)}
                            </span>

                            <span class="shrink-0 text-slate-400">
                                Change
                            </span>
                        </button>

                        <div
                            id="fa-list-coach-options-${quickEscapeHtml(playerId)}"
                            class="absolute left-3 top-full z-30 hidden max-h-64 w-[220px] overflow-y-auto rounded border border-slate-300 bg-white p-1 shadow-xl">

                            ${coachPickerOptionsHtml}

                        </div>
                    </td>

                    <!-- Actual recorded recruiting activity -->
                    <td class="min-w-[200px] px-3 py-3">
                        <div class="mb-1 text-[9px] font-black uppercase tracking-wide text-slate-400">
                            Recent Staff Work
                        </div>

                        <div class="space-y-1">
                            ${recentWorkHtml}
                        </div>
                    </td>

                    <!-- Manual recruiting actions -->
                    <td class="min-w-[130px] px-3 py-3">
                        ${manualRecruitingActionsHtml}
                    </td>

                    <!-- Roster offer -->
                    <td class="min-w-[145px] px-3 py-3">
                        <div class="mb-2">
                            <span class="text-[9px] font-bold ${
                                hasActiveOffer
                                    ? 'text-emerald-700'
                                    : 'text-slate-500'
                            }">
                                ${quickEscapeHtml(offerStatusLabel)}
                            </span>
                        </div>

                        ${offerActionHtml}
                    </td>

                    <!-- Priority and removal controls -->
                    <td class="w-24 px-3 py-3">
                        <div class="flex items-center justify-center gap-1">

                            <button
                                type="button"
                                title="Move prospect up"
                                aria-label="Move prospect up"
                                ${index === 0 ? 'disabled' : ''}
                                onclick="window.app_moveRecruitingListItem('${quickEscapeHtml(playerId)}', -1)"
                                class="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-black text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30">
                                ↑
                            </button>

                            <button
                                type="button"
                                title="Move prospect down"
                                aria-label="Move prospect down"
                                ${index === userRecruitingList.length - 1 ? 'disabled' : ''}
                                onclick="window.app_moveRecruitingListItem('${quickEscapeHtml(playerId)}', 1)"
                                class="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-black text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30">
                                ↓
                            </button>

                            <button
                                type="button"
                                title="Remove prospect"
                                aria-label="Remove prospect"
                                onclick="window.app_removeRecruitingListItem('${quickEscapeHtml(playerId)}')"
                                class="rounded border border-red-200 bg-white px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-50">
                                ×
                            </button>

                        </div>
                    </td>
                </tr>
            `;
        }
    ).join('');

    const userRecruitingListPanel = `
        <section class="mb-3 overflow-hidden rounded-lg border border-slate-300 bg-white">
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                <div>
                    <div class="text-[11px] font-black uppercase tracking-wide text-slate-800">
                        Your Recruiting List
                    </div>

                    <p class="mt-0.5 text-[9px] text-slate-500">
                        Staff work from the top down. Your order determines prospect priority.
                    </p>
                </div>

                <span class="rounded bg-slate-200 px-2 py-1 text-[10px] font-black text-slate-700">
                    ${userRecruitingList.length} prospects
                </span>
            </div>

            ${
                userRecruitingList.length > 0
                    ? `
                        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-emerald-50/50 px-3 py-3">
                            <div>
                                <div class="text-[10px] font-black uppercase tracking-wide text-slate-800">
                                    Group Tryout
                                </div>

                                <p class="mt-1 text-[9px] text-slate-600">
                                    Select up to 8 available prospects. One coach hosts the session for 2 staff hours total.
                                </p>

                                <div class="fa-tryout-selected-count mt-1 text-[10px] font-bold text-emerald-800">
                                    ${recruitingTryoutSelectedIds.size}/8 selected
                                </div>
                            </div>

                            <div class="flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    onclick="window.app_selectEligibleRecruitingTryoutTargets()"
                                    class="rounded border border-slate-300 bg-white px-3 py-2 text-[10px] font-bold text-slate-700 hover:bg-slate-100">
                                    Select Up to 8
                                </button>

                                <button
                                    type="button"
                                    onclick="window.app_clearRecruitingTryoutSelection()"
                                    class="rounded border border-slate-300 bg-white px-3 py-2 text-[10px] font-bold text-slate-600 hover:bg-slate-100">
                                    Clear
                                </button>

                                <button
                                    type="button"
                                    id="fa-open-recruiting-tryout-batch"
                                    data-can-host="${canHostGroupTryout ? 'true' : 'false'}"
                                    onclick="window.app_openSelectedRecruitingTryoutBatch()"
                                    ${recruitingTryoutSelectedIds.size === 0 || !canHostGroupTryout ? 'disabled' : ''}
                                    class="rounded bg-emerald-700 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40">
                                    Host Group Tryout (${recruitingTryoutSelectedIds.size})
                                </button>
                            </div>
                        </div>
                    `
                    : ''
            }

            ${
                userRecruitingList.length > 0
                    ? `
                        <div class="overflow-x-auto">
                            <table class="w-full min-w-[1280px] text-left">
                                <thead class="bg-slate-100">
                                    <tr class="text-[9px] font-black uppercase tracking-wide text-slate-500">
                                        <th class="px-3 py-2 text-center">Tryout</th>
                                        <th class="px-3 py-2 text-center">Rank</th>
                                        <th class="px-3 py-2">Prospect</th>
                                        <th class="px-3 py-2">Interest</th>
                                        <th class="px-3 py-2">7-Day Staff Work</th>
                                        <th class="px-3 py-2">Recruiting Coach</th>
                                        <th class="px-3 py-2">Latest Activity</th>
                                        <th class="px-3 py-2">Manual Actions</th>
                                        <th class="px-3 py-2">Roster Offer</th>
                                        <th class="px-3 py-2 text-center">Priority</th>
                                    </tr>
                                </thead>

                                <tbody>
                                    ${userRecruitingListHtml}
                                </tbody>
                            </table>
                        </div>
                    `
                    : `
                        <div class="px-3 py-8 text-center">
                            <div class="text-xs font-bold text-slate-600">
                                Your recruiting list is empty
                            </div>

                            <p class="mt-1 text-[10px] text-slate-500">
                                Find prospects in the Prospects tab and add them here. Your staff will work through your ranked list.
                            </p>
                        </div>
                    `
            }
        </section>
    `;

    // Build the Recruiting Battle Board from observable activity.
    // User-team interest is shown exactly; rival interest stays estimated.
    const battleBoardEntries = pool.map(player => {
        const intel = Game.getPlayerMarketIntel(player, gameState);

        const playerRecord =
            progress.recruits?.[String(player.id)];

        const recordedSchools = Array.isArray(intel?.suitorDetails)
            ? intel.suitorDetails
            : [];

        const teamById = new Map(
            (Array.isArray(gameState.teams) ? gameState.teams : [])
                .filter(team => team?.id != null)
                .map(team => [String(team.id), team])
        );

        const recordedSchoolIds = new Set(
            recordedSchools.map(detail =>
                String(detail.teamId ?? detail.team?.id ?? '')
            )
        );

        // An active roster offer is observable recruiting activity
        // and should appear even without a separate contact record.
        const activeOfferTeamIds = Object.entries(
            playerRecord?.offersByTeam || {}
        )
            .filter(([, offer]) => offer?.status === 'active')
            .map(([teamId]) => String(teamId));

        const schoolsToDisplay = [
            ...recordedSchools,
            ...activeOfferTeamIds
                .filter(teamId => !recordedSchoolIds.has(teamId))
                .map(teamId => ({
                    teamId,
                    teamName:
                        teamById.get(teamId)?.name || 'Unknown Team'
                }))
        ];

        if (schoolsToDisplay.length === 0) return null;

        const userTeamId = String(gameState.playerTeam?.id ?? '');

        const battleActivities = Array.isArray(progress.dailyActivity)
            ? progress.dailyActivity
            : [];

        const userInterest = Math.max(
            0,
            Math.min(
                100,
                Number(
                    playerRecord?.interestByTeam?.[userTeamId]
                ) || 0
            )
        );

        const schools = schoolsToDisplay.map(detail => {
            const teamId = detail.teamId ?? detail.team?.id;
            const offerRecord =
                playerRecord?.offersByTeam?.[String(teamId)] || null;

            const hasActiveOffer =
                offerRecord?.status === 'active';

            const offerStatus = hasActiveOffer
                ? 'Active offer'
                : offerRecord?.status
                    ? String(offerRecord.status)
                        .replace(/_/g, ' ')
                : 'No offer';

            const schoolActivities = battleActivities
                .filter(activity =>
                    String(activity.playerId) === String(player.id) &&
                    String(activity.teamId) === String(teamId) &&
                    Number(activity.year) === Number(gameState.year) &&
                    [
                        'recruiting_action',
                        'recruiting_sweetener',
                        'recruiting_offer'
                    ].includes(activity.type)
                )
                .sort((a, b) =>
                    (Number(a.day) || 0) - (Number(b.day) || 0)
                )
                .slice(-3)
                .reverse()
                .map(activity => {
                    const actionLabels = {
                        outreach: 'Personal outreach',
                        teammateConnection: 'Teammate connection',
                        roleDiscussion: 'Role discussion',
                        practiceInvitation: 'Practice invitation',
                        tryout: 'Individual tryout',
                        tryout_batch: 'Group tryout'
                    };

                    const isSweetener =
                        activity.type === 'recruiting_sweetener';

                    const isOffer =
                        activity.type === 'recruiting_offer';

                    const description = isOffer
                        ? activity.status === 'active'
                            ? 'Roster offer extended'
                            : `Roster offer ${activity.status || 'updated'}`
                        : isSweetener
                            ? activity.label || 'Gift or favor used'
                            : actionLabels[activity.action] ||
                              activity.label ||
                              'Recruiting contact';

                    const hours = Math.max(
                        0,
                        Number(activity.hours) || 0
                    );

                    return {
                        day: Math.max(0, Number(activity.day) || 0),
                        description,
                        effort: !isSweetener && !isOffer && hours > 0
                            ? `${hours}h`
                            : ''
                    };
                });

            const isUserTeam =
                teamId != null &&
                String(teamId) === userTeamId;

            const rawRange = detail.estimatedInterestRange || {};

            const low = isUserTeam
                ? userInterest
                : Math.max(
                    0,
                    Math.min(100, Math.floor(Number(rawRange.low) || 0))
                );

            const high = isUserTeam
                ? userInterest
                : Math.max(
                    low,
                    Math.min(100, Math.ceil(Number(rawRange.high) || low))
                );

            const midpoint = isUserTeam
                ? userInterest
                : Math.round((low + high) / 2);

            const actionCount = Math.max(
                0,
                Number(detail.actionCount) || 0
            );

            const sweetenerCount = Math.max(
                0,
                Number(detail.sweetenerCount) || 0
            );

            const totalHours = Math.max(
                0,
                Number(detail.totalHours) || 0
            );

            const activityParts = [];

            if (actionCount > 0) {
                activityParts.push(
                    `${actionCount} staff action${actionCount === 1 ? '' : 's'}`
                );
            }

            if (sweetenerCount > 0) {
                activityParts.push(
                    `${sweetenerCount} gift/favor`
                );
            }

            if (totalHours > 0) {
                activityParts.push(`${totalHours} staff hrs`);
            }

            return {
                teamId: String(teamId),

                teamName:
                    detail.teamName ||
                    detail.team?.name ||
                    teamById.get(String(teamId))?.name ||
                    'Unknown Team',

                isUserTeam,
                hasActiveOffer,
                offerStatus,

                hasInterestEstimate: isUserTeam || (
                    rawRange.low != null &&
                    rawRange.high != null &&
                    Number.isFinite(Number(rawRange.low)) &&
                    Number.isFinite(Number(rawRange.high))
                ),

                hasObservedActivity:
                    actionCount > 0 ||
                    sweetenerCount > 0 ||
                    totalHours > 0,

                low,
                high,
                midpoint,

                momentum: detail.momentum || 'Unknown',
                momentumScore: Math.max(
                    0,
                    Math.min(100, Number(detail.momentumScore) || 0)
                ),
                activeDaysCount: Math.max(
                    0,
                    Number(detail.activeDaysCount) || 0
                ),

                activityLevel: detail.activityLevel || 'Recorded',
                confidence: isUserTeam
                    ? 'Exact'
                    : detail.confidence || 'Low',

                lastActivityDay:
                    Number(detail.lastActivityDay) || 0,

                daysSinceContact: Math.max(
                    0,
                    Number(detail.daysSinceContact) || 0
                ),

                activitySummary:
                    activityParts.join(' · ') || 'Recorded contact',

                recentActivity: schoolActivities
            };
        }).sort((a, b) => b.midpoint - a.midpoint);

        const leader = [...schools].sort(
            (a, b) => b.midpoint - a.midpoint
        )[0];

        const runnerUp = [...schools]
            .filter(school => school !== leader)
            .sort((a, b) => b.midpoint - a.midpoint)[0] || null;

        const momentumLeader = [...schools].sort(
            (a, b) =>
                b.momentumScore - a.momentumScore ||
                b.activeDaysCount - a.activeDaysCount
        )[0];

        let leadSummary = 'Only recorded pursuing team';

        if (runnerUp) {
            leadSummary =
                leader.low > runnerUp.high
                    ? `Estimated interest lead: ${leader.teamName}`
                    : 'Estimated interest race is close or uncertain';
        }

        const momentumSummary = momentumLeader
            ? `Strongest momentum: ${momentumLeader.teamName} (${momentumLeader.momentum})`
            : 'No momentum estimate';

        return {
            playerName: player.name || 'Unknown Prospect',
            position: getFreeAgentDisplayPosition(
                gameState.playerTeam,
                player
            ),
            userInterest,
            schools,
            leadSummary,
            momentumSummary
        };
    })
        .filter(Boolean)
        .sort((a, b) =>
            b.schools.length - a.schools.length ||
            b.schools[0].midpoint - a.schools[0].midpoint
        );

    const contestedBattleCount = battleBoardEntries.filter(
        entry => entry.schools.length >= 2
    ).length;

    const activeOfferCount = battleBoardEntries.reduce(
        (total, entry) =>
            total + entry.schools.filter(
                school => school.hasActiveOffer
            ).length,
        0
    );

    const battleBoardHtml = `
        <section class="mb-4 overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">

            <div class="flex flex-wrap items-center justify-between gap-3 bg-slate-900 px-4 py-3 text-white">
                <div>
                    <h3 class="text-sm font-black uppercase tracking-wide">
                        Recruiting Battle Board
                    </h3>
                    <p class="mt-0.5 text-[10px] text-slate-300">
                        Interest, recruiting activity, and roster offers by prospect
                    </p>
                </div>

                <div class="flex flex-wrap items-center gap-4 text-right">
                    <div>
                        <div class="text-lg font-black">
                            ${battleBoardEntries.length}
                        </div>
                        <div class="text-[9px] uppercase tracking-wide text-slate-300">
                            Prospects
                        </div>
                    </div>

                    <div>
                        <div class="text-lg font-black">
                            ${contestedBattleCount}
                        </div>
                        <div class="text-[9px] uppercase tracking-wide text-slate-300">
                            Contested
                        </div>
                    </div>

                    <div>
                        <div class="text-lg font-black">
                            ${activeOfferCount}
                        </div>
                        <div class="text-[9px] uppercase tracking-wide text-slate-300">
                            Active Offers
                        </div>
                    </div>
                </div>
            </div>

            <div class="overflow-x-auto">
                <table class="w-full min-w-[760px] border-collapse text-left">
                    <thead class="bg-slate-100 text-[9px] font-black uppercase tracking-wide text-slate-500">
                        <tr>
                            <th class="w-[21%] px-3 py-2">Prospect</th>
                            <th class="w-[13%] px-3 py-2">Your Interest</th>
                            <th class="px-3 py-2">Recruiting Teams, Offers & Activity</th>
                        </tr>
                    </thead>

                    <tbody class="divide-y divide-slate-200">
                        ${
                            battleBoardEntries.length > 0
                                ? battleBoardEntries.map(entry => {
                                    const exactInterest = Math.max(
                                        0,
                                        Math.min(
                                            100,
                                            Number(entry.userInterest) || 0
                                        )
                                    );

                                    const schoolRows = entry.schools.map(school => {
                                        const interestLabel = school.isUserTeam
                                            ? `Your team · ${school.midpoint}/100`
                                            : school.hasInterestEstimate
                                                ? `${school.low}–${school.high}/100 estimated`
                                                : 'Interest estimate unavailable';

                                        const offerText = school.hasActiveOffer
                                            ? 'Active roster offer'
                                            : school.offerStatus &&
                                              school.offerStatus !== 'No offer'
                                                ? `Offer ${school.offerStatus}`
                                                : 'No roster offer';

                                        const offerClass = school.hasActiveOffer
                                            ? 'bg-emerald-100 text-emerald-800'
                                            : school.offerStatus === 'withdrawn'
                                                ? 'bg-slate-100 text-slate-500'
                                                : 'bg-amber-50 text-amber-800';

                                        const activityText = school.hasObservedActivity
                                            ? [
                                                school.activitySummary,
                                                school.activeDaysCount > 0
                                                    ? `${school.activeDaysCount} active days`
                                                    : '',
                                                school.momentum &&
                                                school.momentum !== 'Unknown'
                                                    ? school.momentum
                                                    : ''
                                            ].filter(Boolean).join(' · ')
                                            : 'No staff contact recorded';

                                        const latestActivity =
                                            Array.isArray(school.recentActivity)
                                                ? school.recentActivity[0]
                                                : null;

                                        return `
                                            <div class="rounded-md border border-slate-200 bg-white px-2.5 py-2">
                                                <div class="flex flex-wrap items-center justify-between gap-2">
                                                    <div class="flex flex-wrap items-center gap-2">
                                                        <span class="text-[11px] font-bold text-slate-900">
                                                            ${quickEscapeHtml(school.teamName)}
                                                        </span>

                                                        ${
                                                            school.isUserTeam
                                                                ? `<span class="rounded bg-emerald-100 px-1.5 py-0.5 text-[8px] font-black uppercase text-emerald-800">Your Team</span>`
                                                                : ''
                                                        }
                                                    </div>

                                                    <span class="font-mono text-[10px] font-bold ${
                                                        school.isUserTeam
                                                            ? 'text-emerald-700'
                                                            : 'text-indigo-700'
                                                    }">
                                                        ${quickEscapeHtml(interestLabel)}
                                                    </span>
                                                </div>

                                                <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                                                    <span class="rounded px-1.5 py-0.5 text-[8px] font-black uppercase ${offerClass}">
                                                        ${quickEscapeHtml(offerText)}
                                                    </span>

                                                    <span class="text-[9px] text-slate-500">
                                                        ${quickEscapeHtml(activityText)}
                                                    </span>
                                                </div>

                                                ${
                                                    latestActivity
                                                        ? `
                                                            <div class="mt-1 text-[9px] text-slate-400">
                                                                Latest: Day ${latestActivity.day}
                                                                · ${quickEscapeHtml(latestActivity.description)}
                                                                ${latestActivity.effort
                                                                    ? ` · ${quickEscapeHtml(latestActivity.effort)}`
                                                                    : ''}
                                                            </div>
                                                        `
                                                        : ''
                                                }
                                            </div>
                                        `;
                                    }).join('');

                                    return `
                                        <tr class="align-top hover:bg-slate-50">
                                            <td class="px-3 py-3">
                                                <div class="text-xs font-black text-slate-900">
                                                    ${quickEscapeHtml(entry.playerName)}
                                                </div>

                                                <div class="mt-1 flex flex-wrap items-center gap-1">
                                                    <span class="rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold text-slate-700">
                                                        ${quickEscapeHtml(entry.position)}
                                                    </span>

                                                    <span class="text-[9px] text-slate-500">
                                                        ${entry.schools.length} team${entry.schools.length === 1 ? '' : 's'}
                                                    </span>
                                                </div>
                                            </td>

                                            <td class="px-3 py-3">
                                                <div class="font-mono text-sm font-black ${
                                                    exactInterest > 0
                                                        ? 'text-emerald-700'
                                                        : 'text-slate-400'
                                                }">
                                                    ${exactInterest}/100
                                                </div>

                                                <div class="mt-1 text-[9px] text-slate-500">
                                                    Exact interest
                                                </div>
                                            </td>

                                            <td class="space-y-2 px-3 py-2">
                                                ${schoolRows}
                                            </td>
                                        </tr>
                                    `;
                                }).join('')
                                : `
                                    <tr>
                                        <td colspan="3" class="px-4 py-8 text-center">
                                            <div class="text-xs font-bold text-slate-600">
                                                No recorded recruiting battles yet
                                            </div>
                                            <p class="mt-1 text-[10px] text-slate-500">
                                                Prospects appear here when teams record recruiting activity or extend roster offers.
                                            </p>
                                        </td>
                                    </tr>
                                `
                        }
                    </tbody>
                </table>
            </div>

            <div class="border-t border-slate-200 bg-slate-50 px-3 py-2 text-[9px] text-slate-500">
                Your interest is exact. Rival interest is an estimate based on observable recruiting activity.
                An active roster offer is shown separately from recruiting contact; an offer alone does not reveal a team's private interest score.
            </div>
        </section>
    `;


    container.innerHTML = `
        <div class="mb-3 flex items-center gap-2 border-b border-slate-200 pb-2">
            <button
                type="button"
                id="fa-recruiting-tab-prospects"
                aria-pressed="${recruitingActiveTab === 'prospects'}"
                onclick="window.app_setRecruitingTab('prospects')"
                class="rounded-md px-3 py-2 text-xs font-bold ${
                    recruitingActiveTab === 'prospects'
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }">
                Neighborhood Prospects
                <span class="ml-1 opacity-70">${pool.length}</span>
            </button>

            <button
                type="button"
                id="fa-recruiting-tab-list"
                aria-pressed="${recruitingActiveTab === 'list'}"
                onclick="window.app_setRecruitingTab('list')"
                class="rounded-md px-3 py-2 text-xs font-bold ${
                    recruitingActiveTab === 'list'
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }">
                My Recruiting List
                <span class="ml-1 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-700">
                    ${userRecruitingList.length}
                </span>
            </button>

            <button
                type="button"
                id="fa-recruiting-tab-battles"
                aria-pressed="${recruitingActiveTab === 'battles'}"
                onclick="window.app_setRecruitingTab('battles')"
                class="rounded-md px-3 py-2 text-xs font-bold ${
                    recruitingActiveTab === 'battles'
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }">
                Battle Board
                <span class="ml-1 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-700">
                    ${contestedBattleCount}
                </span>
            </button>
        </div>

        <div
            id="fa-recruiting-prospects-panel"
            class="${recruitingActiveTab === 'prospects' ? '' : 'hidden'}">

            <!-- Contextual Filters Toolbar (Only visible in Prospects tab) -->
            <div class="mb-3 p-2.5 rounded-lg border border-slate-200 bg-slate-50 flex flex-wrap justify-between items-center gap-2">
                <div class="flex items-center gap-2">
                    <input
                        type="text"
                        id="fa-minigame-search"
                        placeholder="Search prospects..."
                        value="${quickEscapeHtml(searchTerm)}"
                        class="w-40 sm:w-52 p-1.5 border border-slate-300 rounded text-xs bg-white outline-none focus:border-emerald-500"
                        oninput="app.renderFAPool()">

                    <button
                        type="button"
                        class="px-2 py-1.5 border border-slate-300 rounded text-[10px] font-bold text-slate-600 bg-white hover:bg-slate-100"
                        onclick="
                            document.getElementById('fa-minigame-search').value = '';
                            window.app_setRecruitingPositionFilter('');
                        ">
                        Clear
                    </button>
                </div>

                <div class="flex items-center gap-2">
                    <span id="fa-minigame-result-count" class="text-[10px] font-bold text-slate-500 whitespace-nowrap">
                        ${pool.length} matching prospect${pool.length === 1 ? '' : 's'}
                    </span>

                    <input type="hidden" id="fa-minigame-filter-pos" value="${quickEscapeHtml(filterPos)}">
                    <div
                        class="flex max-w-full flex-nowrap gap-0.5 overflow-x-auto rounded border border-slate-300 bg-white p-0.5 hide-scrollbar"
                        role="group"
                        aria-label="Filter prospects by position">
                        <button type="button" data-fa-position="" aria-pressed="${filterPos === ''}" onclick="window.app_setRecruitingPositionFilter('')" class="shrink-0 rounded-sm px-1.5 py-1 text-[9px] font-black ${filterPos === '' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}">ALL</button>
                        <button type="button" data-fa-position="QB" aria-pressed="${filterPos === 'QB'}" onclick="window.app_setRecruitingPositionFilter('QB')" class="shrink-0 rounded-sm px-1.5 py-1 text-[9px] font-black ${filterPos === 'QB' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}">QB</button>
                        <button type="button" data-fa-position="RB" aria-pressed="${filterPos === 'RB'}" onclick="window.app_setRecruitingPositionFilter('RB')" class="shrink-0 rounded-sm px-1.5 py-1 text-[9px] font-black ${filterPos === 'RB' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}">RB</button>
                        <button type="button" data-fa-position="WR" aria-pressed="${filterPos === 'WR'}" onclick="window.app_setRecruitingPositionFilter('WR')" class="shrink-0 rounded-sm px-1.5 py-1 text-[9px] font-black ${filterPos === 'WR' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}">WR</button>
                        <button type="button" data-fa-position="TE" aria-pressed="${filterPos === 'TE'}" onclick="window.app_setRecruitingPositionFilter('TE')" class="shrink-0 rounded-sm px-1.5 py-1 text-[9px] font-black ${filterPos === 'TE' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}">TE</button>
                        <button type="button" data-fa-position="OL" aria-pressed="${filterPos === 'OL'}" onclick="window.app_setRecruitingPositionFilter('OL')" class="shrink-0 rounded-sm px-1.5 py-1 text-[9px] font-black ${filterPos === 'OL' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}">OL</button>
                        <button type="button" data-fa-position="DL" aria-pressed="${filterPos === 'DL'}" onclick="window.app_setRecruitingPositionFilter('DL')" class="shrink-0 rounded-sm px-1.5 py-1 text-[9px] font-black ${filterPos === 'DL' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}">DL</button>
                        <button type="button" data-fa-position="LB" aria-pressed="${filterPos === 'LB'}" onclick="window.app_setRecruitingPositionFilter('LB')" class="shrink-0 rounded-sm px-1.5 py-1 text-[9px] font-black ${filterPos === 'LB' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}">LB</button>
                        <button type="button" data-fa-position="DB" aria-pressed="${filterPos === 'DB'}" onclick="window.app_setRecruitingPositionFilter('DB')" class="shrink-0 rounded-sm px-1.5 py-1 text-[9px] font-black ${filterPos === 'DB' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}">DB</button>
                    </div>
                </div>
            </div>

            <div class="mb-3 rounded-lg border border-slate-200 bg-blue-50/60 px-3 py-2">
                <div class="flex flex-wrap items-center gap-2">
                    <span class="text-[10px] font-black uppercase tracking-wide text-slate-700">
                        Roster Offer Management
                    </span>
                    <span class="rounded bg-white border border-slate-200 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-600">
                        ${recruitingAutonomy === 'direct'
                            ? 'Manual'
                            : recruitingAutonomy === 'delegate'
                                ? 'Delegated'
                                : 'Guided'}
                    </span>
                </div>
                <p class="mt-1 text-[10px] leading-relaxed text-slate-600">
                    ${quickEscapeHtml(offerManagementMessage)}
                </p>
            </div>

            <!-- Prospect selection only adds players to the persistent list. -->
            <div class="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <div class="text-[10px] font-black uppercase tracking-wide text-slate-700">
                            Add Prospects to Your List
                        </div>

                        <p class="mt-1 text-[10px] text-slate-500">
                            Select prospects below. Adding them does not use staff hours or perform a recruiting action.
                        </p>

                        <div
                            id="fa-quick-selected-count"
                            class="fa-quick-selected-count mt-1 text-[10px] font-bold text-slate-600">
                            ${recruitingQuickSelectedIds.size} selected
                        </div>
                    </div>

                    <div class="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onclick="window.app_selectVisibleRecruitingTargets()"
                            class="rounded-sm border border-slate-300 bg-white px-3 py-2 text-[10px] font-bold text-slate-700 hover:bg-slate-100">
                            Select Visible
                        </button>

                        <button
                            type="button"
                            onclick="window.app_clearRecruitingTargetSelection()"
                            class="rounded-sm border border-slate-300 bg-white px-3 py-2 text-[10px] font-bold text-slate-600 hover:bg-slate-100">
                            Clear
                        </button>

                        <button
                            type="button"
                            id="fa-add-to-recruiting-list-button"
                            onclick="window.app_addSelectedRecruitingTargetsToList()"
                            ${recruitingQuickSelectedIds.size === 0 ? 'disabled' : ''}
                            class="rounded-sm bg-emerald-700 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40">
                            Add to List (${recruitingQuickSelectedIds.size})
                        </button>
                    </div>
                </div>
            </div>

            <div class="overflow-x-auto">
                <table class="min-w-full text-xs font-mono">

            <thead class="bg-slate-900 text-white uppercase text-[10px] select-none sticky top-0 z-10">
                <tr>
                    <th class="py-2 px-2 text-center">Add to List</th>
                    <th class="py-2 px-3 text-left font-sans">Free Agent</th>
                    <th class="py-2 px-2 text-center">Pos</th>
                    <th class="py-2 px-2 text-center">Scout Status</th>
                    <th class="py-2 px-2 text-center">OFF Estimate</th>
                    <th class="py-2 px-2 text-center">DEF Estimate</th>
                    <th class="py-2 px-3 text-left font-sans">Your Program</th>
                    <th class="py-2 px-3 text-left font-sans">Market Intel & Suitors</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                ${pool.length > 0 ? pool.map(p => {
                    const pos = getFreeAgentDisplayPosition(
                        gameState.playerTeam,
                        p
                    );
                    const scouting = getFreeAgentScoutingView(
                        gameState.playerTeam,
                        p
                    );
                    const recruitingRecord =
                        gameState.offseasonState?.recruitingProgress
                            ?.recruits?.[String(p.id)];

                    const teamKey = String(gameState.playerTeam.id);

                    const userInterest = Math.max(
                        0,
                        Math.min(
                            100,
                            Number(
                                recruitingRecord?.interestByTeam?.[
                                    teamKey
                                ]
                            ) || 0
                        )
                    );

                    const userOffer =
                        recruitingRecord?.offersByTeam?.[teamKey] || null;

                    const hasActiveOffer =
                        userOffer?.status === 'active';

                    const offerStatusHtml = hasActiveOffer
                        ? `
                            <span class="border border-emerald-300 bg-emerald-50 text-emerald-800 font-black px-1.5 py-0.5 rounded text-[9px]">
                                Roster Invitation Active
                            </span>
                        `
                        : `
                            <span class="text-[9px] text-slate-500">
                                No active roster invitation
                            </span>
                        `;

                    // Show the actual resources invested by our program.
                    // Missing values are normal for older recruiting records.
                    const recruitingPush =
                        recruitingRecord?.recruitingPushByTeam?.[teamKey] || {};

                    const hoursInvested = Math.max(
                        0,
                        Number(recruitingPush.hoursInvested) || 0
                    );

                    const cashSpent = Math.max(
                        0,
                        Number(recruitingPush.cashSpent) || 0
                    );

                    const favorTokensSpent = Math.max(
                        0,
                        Number(recruitingPush.favorTokensSpent) || 0
                    );

                    const formatHours = hoursInvested
                        .toFixed(1)
                        .replace(/\.0$/, '');

                    const investmentParts = [];

                    if (hoursInvested > 0) {
                        investmentParts.push(`${formatHours} staff hrs`);
                    }

                    if (cashSpent > 0) {
                        investmentParts.push(
                            `$${cashSpent.toFixed(0)} in gifts`
                        );
                    }

                    if (favorTokensSpent > 0) {
                        investmentParts.push(
                            `${favorTokensSpent} Favor Token${favorTokensSpent === 1 ? '' : 's'}`
                        );
                    }

                    const investmentSummary =
                        investmentParts.length > 0
                            ? investmentParts.join(' · ')
                            : 'No investment yet';

                    const intel = Game.getPlayerMarketIntel(p, gameState);

                    const interestColor = userInterest >= 70
                        ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                        : userInterest >= 35
                            ? 'bg-amber-100 text-amber-900 border-amber-300'
                            : 'bg-slate-100 text-slate-600 border-slate-200';

                    const marketStatusHtml = `
                        <div class="flex flex-col items-start gap-1.5">
                            <div class="flex items-center gap-1.5 flex-wrap">
                                <span class="border ${interestColor} font-black px-1.5 py-0.5 rounded text-[9px]">
                                    Your Interest: ${userInterest}/100
                                </span>
                            </div>
                            <span class="text-[9px] text-slate-500">
                                ${investmentSummary}
                            </span>
                            ${offerStatusHtml}
                        </div>
                    `;

                    const marketIntelHtml = `
                        <div class="flex flex-col items-start gap-1">
                            <span
                                class="text-[10px] text-slate-600 italic"
                                title="${intel.rumorText}">
                                ${intel.rumorText}
                            </span>
                            ${
                                Array.isArray(intel.suitorNames) &&
                                intel.suitorNames.length > 0
                                    ? `
                                        <span class="text-[9px] font-bold text-amber-700">
                                            Other suitors:
                                            ${intel.suitorNames.map(name =>
                                                name.replace('The ', '')
                                            ).join(', ')}
                                        </span>
                                    `
                                    : `
                                        <span class="text-[9px] text-slate-400">
                                            No known competing teams
                                        </span>
                                    `
                            }
                        </div>
                    `;

                    return `
                    <tr class="${
                        hasActiveOffer
                            ? 'bg-emerald-50 hover:bg-emerald-100'
                            : userInterest >= 70
                                ? 'bg-amber-50/60 hover:bg-amber-50'
                                : 'hover:bg-slate-50'
                    } transition cursor-pointer" onclick="app.openPlayerCard('${p.id}')">
                        <td class="py-2 px-2 text-center" onclick="event.stopPropagation()">
                            <input
                                type="checkbox"
                                class="fa-recruit-select h-4 w-4 accent-emerald-700 disabled:cursor-not-allowed disabled:opacity-30"
                                value="${p.id}"
                                ${recruitingQuickSelectedIds.has(String(p.id)) ? 'checked' : ''}
                                ${userRecruitingListIds.has(String(p.id)) ? 'disabled' : ''}
                                title="${userRecruitingListIds.has(String(p.id)) ? 'Already on your recruiting list' : 'Select to add to your recruiting list'}"
                                onchange="window.app_toggleRecruitingQuickSelection('${p.id}', this.checked)"
                            />
                        </td>
                        <td class="py-2 px-3 font-sans font-semibold text-slate-900 truncate max-w-[150px]">
                            <span>${p.name}</span>
                            <span class="block text-slate-400 text-[10px] font-mono">Age ${p.age}</span>
                        </td>
                        <td class="text-center py-2 px-2">
                            <span class="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-bold text-[10px]">${pos}</span>
                        </td>
                        <td class="text-center py-2 px-2 font-sans text-[10px] min-w-0">
                            <span class="${
                                scouting.level >= 3
                                    ? 'text-emerald-700'
                                    : scouting.level > 0
                                        ? 'text-blue-700'
                                        : 'text-amber-700'
                            } font-bold">
                                ${scouting.status}
                            </span>

                            <div class="h-1.5 bg-slate-200 rounded-full overflow-hidden mt-1.5">
                                <div
                                    class="h-full bg-indigo-500 rounded-full"
                                    style="width: ${scouting.progressToNextPercent}%"
                                ></div>
                            </div>

                            <span class="block text-[9px] text-slate-500 mt-1">
                                ${scouting.progressLabel}
                            </span>

                            ${scouting.projectedRole
                                ? `<span class="block text-slate-500 mt-0.5">${scouting.projectedRole}</span>`
                                : ''}
                        </td>
                        <td class="text-center py-2 px-2 font-mono text-slate-700">
                            ${formatFreeAgentScoutingFit(scouting.offense)}
                        </td>
                        <td class="text-center py-2 px-2 font-mono text-slate-700">
                            ${formatFreeAgentScoutingFit(scouting.defense)}
                        </td>
                        <td class="py-2 px-3 font-sans min-w-0 whitespace-normal break-words">
                            ${marketStatusHtml}
                        </td>
                        <td class="py-2 px-3 font-sans min-w-0 whitespace-normal break-words">
                            ${marketIntelHtml}
                        </td>
                    </tr>`;
                }).join('') : `
                    <tr>
                        <td
                            colspan="8"
                            class="px-4 py-10 text-center">

                            <div class="text-xs font-bold text-slate-600">
                                No matching prospects
                            </div>

                            <p class="mt-1 text-[10px] text-slate-500">
                                Try changing your position filter or search.
                                Your Recruiting List and Battle Board remain available.
                            </p>
                        </td>
                    </tr>
                `}
            </tbody>
                </table>
            </div>
        </div>

        <div
            id="fa-recruiting-list-panel"
            class="${recruitingActiveTab === 'list' ? '' : 'hidden'}">

            ${userRecruitingListPanel}

        </div>

        <div
            id="fa-recruiting-battles-panel"
            class="${recruitingActiveTab === 'battles' ? '' : 'hidden'}">
            ${battleBoardHtml}
        </div>
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

window.app_setRecruitingOffer = function(
    playerId,
    action = 'extend'
) {
    const gs = getGameState();
    const team = gs?.playerTeam;
    const state = gs?.offseasonState;
    const progress = state?.recruitingProgress;

    const escapeHtml = value => String(value ?? '').replace(
        /[&<>"']/g,
        character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[character]
    );

    const normalizedPhase = String(state?.phase || '')
        .toLowerCase()
        .replace(/[^a-z]/g, '');

    if (
        !team ||
        normalizedPhase !== 'recruiting' ||
        !progress ||
        progress.initialized !== true ||
        progress.completed === true ||
        Number(progress.seasonYear) !== Number(gs.year)
    ) {
        showModal(
            'Recruiting Unavailable',
            '<p>The recruiting week is not currently active.</p>'
        );
        return;
    }

    const player = gs.players?.find(
        candidate =>
            String(candidate?.id) === String(playerId)
    );

    const record = progress.recruits?.[String(playerId)];

    if (
        !player ||
        player.teamId != null ||
        !record ||
        record.status !== 'available' ||
        record.committedTeamId != null
    ) {
        showModal(
            'Prospect Unavailable',
            '<p>This prospect is no longer available for a roster invitation.</p>'
        );
        return;
    }

    if (!['extend', 'withdraw'].includes(action)) {
        showModal(
            'Invalid Offer Action',
            '<p>Please refresh the recruiting screen and try again.</p>'
        );
        return;
    }

    const result = setRecruitingOffer(
        gs,
        team.id,
        player.id,
        action
    );

    if (!result?.success) {
        showModal(
            'Offer Could Not Be Updated',
            `<p>${escapeHtml(
                result?.message || 'The roster invitation could not be updated.'
            )}</p>`
        );
        return;
    }

    Game.saveGameState?.('backyardFootballGameState');

    renderOffseasonFAScreen(getGameState());

    showModal(
        action === 'extend'
            ? 'Roster Spot Offered'
            : 'Roster Invitation Withdrawn',
        `<p>${escapeHtml(
            result.message ||
            'The recruiting offer has been updated.'
        )}</p>`,
        null,
        'Continue'
    );
};

window.app_setRecruitingTab = function(tab) {
    if (!['prospects', 'list', 'battles'].includes(tab)) return;

    recruitingActiveTab = tab;

    const panels = {
        prospects: document.getElementById(
            'fa-recruiting-prospects-panel'
        ),
        list: document.getElementById(
            'fa-recruiting-list-panel'
        ),
        battles: document.getElementById(
            'fa-recruiting-battles-panel'
        )
    };

    const buttons = {
        prospects: document.getElementById(
            'fa-recruiting-tab-prospects'
        ),
        list: document.getElementById(
            'fa-recruiting-tab-list'
        ),
        battles: document.getElementById(
            'fa-recruiting-tab-battles'
        )
    };

    const activeClass =
        'rounded-md px-3 py-2 text-xs font-bold bg-slate-900 text-white';

    const inactiveClass =
        'rounded-md px-3 py-2 text-xs font-bold border border-slate-300 bg-white text-slate-700 hover:bg-slate-50';

    Object.entries(panels).forEach(([key, panel]) => {
        panel?.classList.toggle('hidden', key !== tab);
    });

    Object.entries(buttons).forEach(([key, button]) => {
        if (!button) return;

        const isActive = key === tab;

        button.className = isActive
            ? activeClass
            : inactiveClass;

        button.setAttribute(
            'aria-pressed',
            String(isActive)
        );
    });

    if (tab === 'list') {
        window.app_refreshRecruitingTryoutSelection?.();
    }
};

window.app_refreshRecruitingTryoutSelection = function() {
    const selectedCount = recruitingTryoutSelectedIds.size;

    document.querySelectorAll(
        '#fa-recruiting-list-panel .fa-tryout-select'
    ).forEach(checkbox => {
        const playerId = String(checkbox.value);
        const isSelected = recruitingTryoutSelectedIds.has(playerId);
        const isEligible =
            checkbox.dataset.tryoutEligible === 'true';

        checkbox.checked = isSelected;

        checkbox.disabled =
            !isEligible ||
            (
                selectedCount >= 8 &&
                !isSelected
            );
    });

    document.querySelectorAll('.fa-tryout-selected-count')
        .forEach(element => {
            element.textContent = `${selectedCount}/8 selected`;
        });

    const button = document.getElementById(
        'fa-open-recruiting-tryout-batch'
    );

    if (button) {
        button.textContent =
            `Host Group Tryout (${selectedCount})`;

        button.disabled =
            selectedCount === 0 ||
            button.dataset.canHost !== 'true';
    }
};

window.app_toggleRecruitingTryoutSelection = function(
    playerId,
    checked
) {
    const id = String(playerId ?? '');

    if (!id) return;

    if (checked) {
        if (
            recruitingTryoutSelectedIds.size >= 8 &&
            !recruitingTryoutSelectedIds.has(id)
        ) {
            window.app_refreshRecruitingTryoutSelection();
            return;
        }

        recruitingTryoutSelectedIds.add(id);
    } else {
        recruitingTryoutSelectedIds.delete(id);
    }

    window.app_refreshRecruitingTryoutSelection();
};

window.app_selectEligibleRecruitingTryoutTargets = function() {
    const checkboxes = document.querySelectorAll(
        '#fa-recruiting-list-panel .fa-tryout-select'
    );

    for (const checkbox of checkboxes) {
        if (recruitingTryoutSelectedIds.size >= 8) break;

        if (
            checkbox.dataset.tryoutEligible !== 'true' ||
            checkbox.disabled
        ) {
            continue;
        }

        recruitingTryoutSelectedIds.add(
            String(checkbox.value)
        );
    }

    window.app_refreshRecruitingTryoutSelection();
};

window.app_clearRecruitingTryoutSelection = function() {
    recruitingTryoutSelectedIds.clear();

    window.app_refreshRecruitingTryoutSelection();
};

window.app_openSelectedRecruitingTryoutBatch = function() {
    const selectedIds = [
        ...recruitingTryoutSelectedIds
    ].slice(0, 8);

    if (selectedIds.length === 0) return;

    if (
        typeof window.app_openRecruitingTryoutBatchModal !== 'function'
    ) {
        showModal(
            'Tryout Unavailable',
            '<p>The group tryout screen is unavailable.</p>'
        );
        return;
    }

    window.app_openRecruitingTryoutBatchModal(selectedIds);
};

window.app_updateRecruitingQuickDefaults = function() {
    const coachInput = document.getElementById('fa-quick-coach');
    const actionInput = document.getElementById('fa-quick-action');
    const hoursInput = document.getElementById('fa-quick-hours');

    if (!coachInput || !actionInput || !hoursInput) return;

    const selectedOption = [...document.querySelectorAll('[data-quick-coach-id]')]
        .find(button => button.dataset.quickCoachId === coachInput.value);
    const maxHours = Math.max(
        0,
        Math.floor(Number(selectedOption?.dataset.remainingHours) || 0)
    );

    hoursInput.max = String(maxHours);

    const requestedHours = Math.floor(Number(hoursInput.value) || 1);

    hoursInput.value = String(
        Math.max(1, Math.min(maxHours || 1, requestedHours))
    );

    recruitingQuickAssignDefaults = {
        coachId: coachInput.value,
        actionType: actionInput.value,
        hours: Number(hoursInput.value)
    };
};

window.app_toggleRecruitingCoachPicker = function() {
    const panel = document.getElementById('fa-quick-coach-options');
    const trigger = document.getElementById('fa-quick-coach-trigger');

    if (!panel || !trigger) return;

    const isOpening = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !isOpening);
    trigger.setAttribute('aria-expanded', String(isOpening));
};

window.app_selectRecruitingQuickCoach = function(coachId) {
    const input = document.getElementById('fa-quick-coach');
    const label = document.getElementById('fa-quick-coach-label');
    const selectedButton = [...document.querySelectorAll('[data-quick-coach-id]')]
        .find(button => button.dataset.quickCoachId === String(coachId));

    if (!input || !selectedButton) return;

    input.value = String(coachId);
    document.querySelectorAll('[data-quick-coach-id]').forEach(button => {
        const selected = button.dataset.quickCoachId === String(coachId);
        button.setAttribute('aria-pressed', String(selected));
        button.className = `flex w-full items-center justify-between gap-3 rounded-sm px-2 py-2 text-left hover:bg-emerald-50 ${selected ? 'bg-emerald-50' : ''}`;
    });

    if (label) {
        const name = selectedButton.querySelector('.text-xs.font-bold')?.textContent || 'Coach';
        label.textContent = `${name} · ${selectedButton.dataset.remainingHours}h`;
    }

    document.getElementById('fa-quick-coach-options')?.classList.add('hidden');
    document.getElementById('fa-quick-coach-trigger')?.setAttribute('aria-expanded', 'false');
    window.app_updateRecruitingQuickDefaults();
};

window.app_selectRecruitingQuickAction = function(actionType) {
    const input = document.getElementById('fa-quick-action');
    if (!input) return;

    input.value = actionType;
    document.querySelectorAll('[data-quick-action]').forEach(button => {
        const selected = button.dataset.quickAction === actionType;
        button.setAttribute('aria-pressed', String(selected));
        button.className = `rounded-sm border px-2 py-1.5 text-left ${selected ? 'border-emerald-700 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`;
    });

    window.app_updateRecruitingQuickDefaults();
};

window.app_setStaffPitchChoice = function(controlId, value) {
    const input = document.getElementById(controlId);
    if (!input) return;

    input.value = String(value);
    document.querySelectorAll(
        `[data-staff-pitch-control="${controlId}"]`
    ).forEach(button => {
        const selected = button.dataset.staffPitchValue === String(value);
        button.setAttribute('aria-pressed', String(selected));
        button.className = `rounded-sm border px-2 py-1.5 text-left text-[10px] font-bold ${selected ? 'border-emerald-700 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`;
    });
};

window.app_selectRecruitingSweetenerType = function(value, showGiftAmount = false) {
    const input = document.getElementById('recruiting-sweetener-type');
    if (!input) return;

    input.value = String(value);
    document.querySelectorAll('[data-recruiting-sweetener-option]').forEach(button => {
        const selected = button.dataset.sweetenerValue === String(value);
        const isFavor = String(value) === 'favor';

        button.setAttribute('aria-pressed', String(selected));
        button.className = `rounded-sm border px-2 py-2 text-left disabled:cursor-not-allowed disabled:opacity-40 ${selected ? (isFavor ? 'border-amber-600 bg-amber-50 text-amber-900' : 'border-emerald-700 bg-emerald-50 text-emerald-900') : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`;
    });

    if (showGiftAmount) {
        document.getElementById('recruiting-gift-amount-wrap')
            ?.classList.toggle('hidden', String(value) !== 'gift');
    }
};

window.app_toggleStaffReplacementPicker = function() {
    const popover = document.getElementById(
        'staff-replacement-coach-popover'
    );
    const trigger = document.getElementById(
        'staff-replacement-coach-trigger'
    );
    if (!popover || !trigger) return;

    const isOpening = popover.classList.contains('hidden');
    popover.classList.toggle('hidden', !isOpening);
    trigger.setAttribute('aria-expanded', String(isOpening));
};

window.app_selectStaffReplacementCoach = function(button) {
    const input = document.getElementById('staff-replacement-coach');
    const label = document.getElementById('staff-replacement-coach-label');
    if (!input || !button) return;

    input.value = button.dataset.replacementCoachId || '';
    if (label) {
        label.textContent = button.dataset.replacementCoachName || 'Choose a coach to replace';
    }

    document.querySelectorAll('[data-replacement-coach-id]').forEach(option => {
        const selected = option === button;
        option.setAttribute('aria-pressed', String(selected));
        option.className = `grid w-full grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] gap-2 border-t border-slate-100 px-2 py-2 text-left text-[10px] ${selected ? 'bg-blue-50' : 'hover:bg-slate-50'}`;
    });

    document.getElementById('staff-replacement-coach-popover')?.classList.add('hidden');
    document.getElementById('staff-replacement-coach-trigger')?.setAttribute('aria-expanded', 'false');
};

window.app_selectRecruitingActionChoice = function(controlId, value) {
    const input = document.getElementById(controlId);
    if (!input) return;

    input.value = String(value);
    document.querySelectorAll(
        `[data-recruiting-choice-control="${controlId}"]`
    ).forEach(button => {
        const selected =
            button.dataset.recruitingChoiceValue === String(value);
        button.setAttribute('aria-pressed', String(selected));
        button.className = `rounded-sm border px-2 py-1.5 text-left ${selected ? 'border-emerald-700 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`;
    });

    if (controlId === 'recruiting-action-coach') {
        const option = [...document.querySelectorAll(
            '[data-recruiting-choice-control="recruiting-action-coach"]'
        )].find(button =>
            button.dataset.recruitingChoiceValue === String(value)
        );
        const hoursInput = document.getElementById(
            'recruiting-action-hours'
        );

        if (option && hoursInput) {
            const maxHours = Math.max(
                1,
                Number(option.dataset.remainingHours) || 1
            );
            hoursInput.max = String(maxHours);
            hoursInput.value = String(Math.min(
                maxHours,
                Math.max(1, Number(hoursInput.value) || 1)
            ));
        }
    }
};

window.app_setRecruitingPositionFilter = function(position) {
    const input = document.getElementById('fa-minigame-filter-pos');
    if (!input) return;

    input.value = position;
    document.querySelectorAll('[data-fa-position]').forEach(button => {
        const selected = button.dataset.faPosition === position;
        button.setAttribute('aria-pressed', String(selected));
        button.className = `shrink-0 rounded-sm px-1.5 py-1 text-[9px] font-black ${selected ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`;
    });

    const currentState = getGameState();
    if (currentState) renderOffseasonFAPool(currentState);
};

window.app_setPositionFilter = function(inputId, position) {
    const input = document.getElementById(inputId);
    if (!input) return;

    input.value = position;

    document.querySelectorAll(
        `[data-position-filter="${inputId}"]`
    ).forEach(button => {
        const selected = button.dataset.position === position;
        button.setAttribute('aria-pressed', String(selected));
        button.className = `position-filter-button ${selected ? 'is-active' : ''}`;
    });

    input.dispatchEvent(new Event('change', { bubbles: true }));
};

window.app_toggleRecruitingQuickSelection = function(playerId, checked) {
    const key = String(playerId);

    if (checked) {
        recruitingQuickSelectedIds.add(key);
    } else {
        recruitingQuickSelectedIds.delete(key);
    }

    const button = document.getElementById('fa-quick-add-button');

    if (button) {
        button.textContent =
            `Add to Recruiting List (${recruitingQuickSelectedIds.size})`;
    }

    const count = document.getElementById(
        'fa-quick-selected-count'
    );

    if (count) {
        count.textContent =
            `${recruitingQuickSelectedIds.size} selected`;
    }
};

window.app_selectVisibleRecruitingTargets = function() {
    document.querySelectorAll(
        '#fa-minigame-pool-tbody .fa-recruit-select'
    ).forEach(checkbox => {
        if (checkbox.disabled) return;

        checkbox.checked = true;
        recruitingQuickSelectedIds.add(String(checkbox.value));
    });

    const button = document.getElementById('fa-quick-add-button');

    if (button) {
        button.textContent =
            `Add to Recruiting List (${recruitingQuickSelectedIds.size})`;
    }

    const count = document.getElementById(
        'fa-quick-selected-count'
    );

    if (count) {
        count.textContent =
            `${recruitingQuickSelectedIds.size} selected`;
    }
};

window.app_clearRecruitingTargetSelection = function() {
    recruitingQuickSelectedIds.clear();

    document.querySelectorAll(
        '#fa-minigame-pool-tbody .fa-recruit-select'
    ).forEach(checkbox => {
        checkbox.checked = false;
    });

    const button = document.getElementById('fa-quick-add-button');

    if (button) {
        button.textContent = 'Add to Recruiting List (0)';
    }

    const count = document.getElementById(
        'fa-quick-selected-count'
    );

    if (count) {
        count.textContent = '0 selected';
    }
};

window.app_addSelectedRecruitingTargetsToList = function() {
    const gs = getGameState();
    const team = gs?.playerTeam;
    const state = gs?.offseasonState;
    const progress = state?.recruitingProgress;

    const phase = String(state?.phase || '')
        .toLowerCase()
        .replace(/[^a-z]/g, '');

    if (
        !team ||
        phase !== 'recruiting' ||
        !progress?.initialized ||
        progress.completed === true ||
        Number(progress.seasonYear) !== Number(gs.year)
    ) {
        showModal(
            'Recruiting Unavailable',
            '<p>The recruiting period is not currently active.</p>'
        );
        return;
    }

    const selectedIds = [...recruitingQuickSelectedIds];

    if (selectedIds.length === 0) {
        showModal(
            'No Prospects Selected',
            '<p>Select at least one prospect before adding to your recruiting list.</p>'
        );
        return;
    }

    if (
        !progress.teamRecruitingLists ||
        typeof progress.teamRecruitingLists !== 'object' ||
        Array.isArray(progress.teamRecruitingLists)
    ) {
        progress.teamRecruitingLists = {};
    }

    const teamKey = String(team.id);

    const recruitingList = Array.isArray(
        progress.teamRecruitingLists[teamKey]
    )
        ? progress.teamRecruitingLists[teamKey]
        : [];

    const existingIds = new Set(
        recruitingList
            .filter(entry => entry?.playerId != null)
            .map(entry => String(entry.playerId))
    );

    let addedCount = 0;
    const skipped = [];

    const currentDay = Math.max(
        1,
        Math.floor(Number(state.recruitingDay) || 1)
    );

    for (const playerId of selectedIds) {
        const player = gs.players?.find(candidate =>
            String(candidate?.id) === playerId
        );

        const record =
            progress.recruits?.[playerId];

        if (
            !player ||
            player.teamId != null ||
            !record ||
            record.status !== 'available' ||
            record.committedTeamId != null
        ) {
            skipped.push({
                playerName: player?.name || playerId,
                reason: 'No longer available'
            });

            continue;
        }

        if (existingIds.has(playerId)) {
            skipped.push({
                playerName: player.name,
                reason: 'Already on your recruiting list'
            });

            continue;
        }

        recruitingList.push({
            playerId,
            assignedCoachId: null,
            addedDay: currentDay,
            lastWorkedDay: null,
            lastCoachId: null,
            lastAction: null
        });

        existingIds.add(playerId);
        addedCount++;
    }

    progress.teamRecruitingLists[teamKey] = recruitingList;

    recruitingQuickSelectedIds.clear();

    Game.saveGameState?.('backyardFootballGameState');

    const latestState = getGameState() || gs;

    renderOffseasonFAScreen(latestState);

    const escapeHtml = value => String(value ?? '').replace(
        /[&<>"']/g,
        character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[character]
    );

    const skippedHtml = skipped.length > 0
        ? `
            <div class="mt-3">
                <div class="font-bold text-amber-800">
                    Not added (${skipped.length})
                </div>

                <div class="mt-1 space-y-1 text-xs text-slate-600">
                    ${skipped.map(item => `
                        <div>
                            <b>${escapeHtml(item.playerName)}</b>:
                            ${escapeHtml(item.reason)}
                        </div>
                    `).join('')}
                </div>
            </div>
        `
        : '';

    showModal(
        addedCount > 0
            ? 'Recruiting List Updated'
            : 'No Prospects Added',
        `
            <div class="space-y-2 text-sm">
                <p>
                    Added <b>${addedCount}</b> prospect(s) to your recruiting list.
                </p>

                <p class="text-xs text-slate-500">
                    No staff hours were used. Your staff will begin working through the list as you advance recruiting days.
                </p>

                ${skippedHtml}
            </div>
        `,
        null,
        'Continue'
    );
};

function getPlayerRecruitingListContext() {
    const gs = getGameState();
    const team = gs?.playerTeam;
    const state = gs?.offseasonState;
    const progress = state?.recruitingProgress;

    const phase = String(state?.phase || '')
        .toLowerCase()
        .replace(/[^a-z]/g, '');

    if (
        !team ||
        phase !== 'recruiting' ||
        !progress?.initialized ||
        progress.completed === true ||
        Number(progress.seasonYear) !== Number(gs.year)
    ) {
        return null;
    }

    if (
        !progress.teamRecruitingLists ||
        typeof progress.teamRecruitingLists !== 'object' ||
        Array.isArray(progress.teamRecruitingLists)
    ) {
        progress.teamRecruitingLists = {};
    }

    const teamKey = String(team.id);

    if (!Array.isArray(progress.teamRecruitingLists[teamKey])) {
        progress.teamRecruitingLists[teamKey] = [];
    }

    return {
        gs,
        team,
        progress,
        teamKey,
        list: progress.teamRecruitingLists[teamKey]
    };
}

function savePlayerRecruitingList(context) {
    if (!context) return;

    Game.saveGameState?.('backyardFootballGameState');

    renderOffseasonFAScreen(
        getGameState() || context.gs
    );
}

window.app_toggleRecruitingListCoachPicker = function(playerId) {
    const picker = document.getElementById(
        `fa-list-coach-options-${playerId}`
    );

    const trigger = document.getElementById(
        `fa-list-coach-trigger-${playerId}`
    );

    if (!picker || !trigger) return;

    const shouldOpen = picker.classList.contains('hidden');

    // Close any other prospect's coach picker first.
    document.querySelectorAll(
        '[id^="fa-list-coach-options-"]'
    ).forEach(element => {
        element.classList.add('hidden');
    });

    document.querySelectorAll(
        '[id^="fa-list-coach-trigger-"]'
    ).forEach(element => {
        element.setAttribute('aria-expanded', 'false');
    });

    picker.classList.toggle('hidden', !shouldOpen);

    trigger.setAttribute(
        'aria-expanded',
        String(shouldOpen)
    );
};

window.app_setRecruitingListCoach = function(playerId, coachId) {
    const context = getPlayerRecruitingListContext();

    if (!context) {
        showModal(
            'Recruiting Unavailable',
            '<p>The recruiting period is not currently active.</p>'
        );
        return;
    }

    const entry = context.list.find(candidate =>
        String(candidate?.playerId) === String(playerId)
    );

    if (!entry) return;

    const normalizedCoachId = String(coachId || '');

    if (normalizedCoachId) {
        const staffBudget =
            Game.getRecruitingStaffHourBudget?.(
                context.team,
                context.gs
            ) || [];

        const validCoach = staffBudget.some(coach =>
            String(coach?.coachId) === normalizedCoachId
        );

        if (!validCoach) {
            showModal(
                'Coach Unavailable',
                '<p>That coach is no longer part of your available recruiting staff.</p>'
            );

            renderOffseasonFAScreen(context.gs);
            return;
        }

        entry.assignedCoachId = normalizedCoachId;
    } else {
        entry.assignedCoachId = null;
    }

    savePlayerRecruitingList(context);
};

window.app_moveRecruitingListItem = function(playerId, direction) {
    const context = getPlayerRecruitingListContext();

    if (!context) return;

    const index = context.list.findIndex(entry =>
        String(entry?.playerId) === String(playerId)
    );

    if (index < 0) return;

    const offset = Number(direction);

    if (offset !== -1 && offset !== 1) return;

    const nextIndex = index + offset;

    if (
        nextIndex < 0 ||
        nextIndex >= context.list.length
    ) {
        return;
    }

    [
        context.list[index],
        context.list[nextIndex]
    ] = [
        context.list[nextIndex],
        context.list[index]
    ];

    savePlayerRecruitingList(context);
};

window.app_removeRecruitingListItem = function(playerId) {
    const context = getPlayerRecruitingListContext();

    if (!context) return;

    const index = context.list.findIndex(entry =>
        String(entry?.playerId) === String(playerId)
    );

    if (index < 0) return;

    context.list.splice(index, 1);

    savePlayerRecruitingList(context);
};

window.app_quickAssignSelectedRecruitingTargets = function() {
    const gs = getGameState();
    const team = gs?.playerTeam;
    const state = gs?.offseasonState;
    const progress = state?.recruitingProgress;

    const phase = String(state?.phase || '')
        .toLowerCase()
        .replace(/[^a-z]/g, '');

    if (
        !team ||
        phase !== 'recruiting' ||
        !progress?.initialized ||
        progress.completed === true ||
        Number(progress.seasonYear) !== Number(gs.year)
    ) {
        showModal(
            'Recruiting Unavailable',
            '<p>The recruiting period is not currently active.</p>'
        );
        return;
    }

    const selectedIds = [...recruitingQuickSelectedIds];

    if (selectedIds.length === 0) {
        showModal(
            'No Prospects Selected',
            '<p>Select at least one prospect before assigning recruiting work.</p>'
        );
        return;
    }

    const coachId = document.getElementById('fa-quick-coach')?.value;
    const actionType = document.getElementById('fa-quick-action')?.value;
    const hours = Number(
        document.getElementById('fa-quick-hours')?.value
    );

    if (
        !coachId ||
        ![
            'outreach',
            'teammateConnection',
            'roleDiscussion',
            'practiceInvitation'
        ].includes(actionType) ||
        !Number.isSafeInteger(hours) ||
        hours < 1
    ) {
        showModal(
            'Invalid Quick Assignment',
            '<p>Choose a valid coach, action, and positive whole number of hours.</p>'
        );
        return;
    }

    let assignedCount = 0;
    const assignedNames = [];
    const skipped = [];

    for (const playerId of selectedIds) {
        const currentState = getGameState() || gs;

        const player = currentState.players?.find(
            candidate => String(candidate?.id) === playerId
        );

        const record =
            currentState.offseasonState?.recruitingProgress
                ?.recruits?.[playerId];

        if (
            !player ||
            player.teamId != null ||
            !record ||
            record.status !== 'available' ||
            record.committedTeamId != null
        ) {
            skipped.push({
                playerName: player?.name || playerId,
                reason: 'No longer available'
            });

            recruitingQuickSelectedIds.delete(playerId);
            continue;
        }

        const result = Game.executeRecruitingAction(
            currentState,
            team.id,
            coachId,
            player.id,
            actionType,
            hours
        );

        if (result?.success) {
            assignedCount++;
            assignedNames.push(player.name);
            recruitingQuickSelectedIds.delete(playerId);
        } else {
            skipped.push({
                playerName: player.name,
                reason: result?.message || 'Assignment failed'
            });

            // No remaining hours means further assignments to this
            // coach cannot succeed with the selected hours-per-player.
            if (
                Number.isFinite(Number(result?.remainingHours)) &&
                Number(result.remainingHours) < hours
            ) {
                break;
            }
        }
    }

    Game.saveGameState?.('backyardFootballGameState');

    const latestState = getGameState() || gs;

    renderOffseasonFAScreen(latestState);

    const escapeHtml = value => String(value ?? '').replace(
        /[&<>"']/g,
        character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[character]
    );

    const skippedHtml = skipped.length > 0
        ? `
            <div class="mt-3">
                <div class="font-bold text-amber-800">
                    Not assigned (${skipped.length})
                </div>
                <div class="mt-1 space-y-1 text-xs text-slate-600">
                    ${skipped.map(item => `
                        <div>
                            <b>${escapeHtml(item.playerName)}</b>:
                            ${escapeHtml(item.reason)}
                        </div>
                    `).join('')}
                </div>
            </div>
        `
        : '';

    showModal(
        'Quick Recruiting Results',
        `
            <div class="space-y-2 text-sm">
                <p>
                    Successfully assigned work to
                    <b>${assignedCount}</b> prospect(s).
                </p>
                ${skippedHtml}
                <p class="text-xs text-slate-500">
                    Successful assignments have been saved. Any remaining
                    selected prospects can be retried or handled individually.
                </p>
            </div>
        `,
        null,
        'Continue'
    );
};

window.app_openRecruitingActionModal = function(playerId) {
    const gs = getGameState();
    const team = gs?.playerTeam;

    if (!team) return;

    const state = gs.offseasonState;
    const progress = state?.recruitingProgress;

    if (
        String(state?.phase || '').toLowerCase().replace(/[^a-z]/g, '') !== 'recruiting' ||
        !progress ||
        progress.initialized !== true ||
        progress.completed === true
    ) {
        showModal(
            'Recruiting Unavailable',
            '<p>The seven-day recruiting week is not active.</p>'
        );
        return;
    }

    const player = Game.getPlayer(playerId) ||
        gs.players?.find(p => String(p?.id) === String(playerId));

    const record = progress.recruits?.[String(playerId)];

    if (
        !player ||
        !record ||
        record.status !== 'available' ||
        player.teamId != null
    ) {
        showModal(
            'Recruit Unavailable',
            '<p>This player is no longer available to recruit.</p>'
        );
        return;
    }

    const budget = Game.getRecruitingStaffHourBudget?.(team, gs) || [];

    const coaches = budget.map(coach => {
        return {
            ...coach,
            remainingHours: Math.max(
                0,
                Number(
                    coach.remainingHours ??
                    coach.weeklyCapacity ??
                    coach.weeklyHours
                ) || 0
            )
        };
    }).filter(coach => coach.remainingHours > 0);

    if (coaches.length === 0) {
        showModal(
            'No Recruiting Hours Available',
            '<p>Your staff has no recruiting hours remaining this week.</p>'
        );
        return;
    }

    const position = getFreeAgentDisplayPosition(team, player);
    const scouting = getFreeAgentScoutingView(team, player);

    const interest = Math.max(
        0,
        Math.min(
            100,
            Number(
                record.interestByTeam?.[String(team.id)]
            ) || 0
        )
    );

    const escapeHtml = value => String(value ?? '').replace(
        /[&<>"']/g,
        character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[character]
    );

    const coachProfiles = [
        ...(Array.isArray(team.coaches) ? team.coaches : []),
        ...Object.values(team.staff || {})
    ];
    const coachChoices = coaches.map(coach => {
        const profile = coachProfiles.find(candidate =>
            String(candidate?.id) === String(coach.coachId)
        );
        const recruitingSkills = [
            'teaching',
            'evalCharacter',
            'gameplanInstinct',
            'conditioning'
        ].map(key => Number(profile?.ratings?.[key]))
            .filter(Number.isFinite);

        return {
            ...coach,
            role: profile?.role || 'Volunteer coach',
            skillEstimate: recruitingSkills.length > 0
                ? Math.round(
                    recruitingSkills.reduce((total, value) => total + value, 0) /
                    recruitingSkills.length
                )
                : 50
        };
    });
    const teamRecruitingList = Array.isArray(
        progress.teamRecruitingLists?.[String(team.id)]
    )
        ? progress.teamRecruitingLists[String(team.id)]
        : [];

    const assignedListEntry = teamRecruitingList.find(entry =>
        String(entry?.playerId) === String(player.id)
    );

    const assignedCoachId =
        assignedListEntry?.assignedCoachId == null
            ? ''
            : String(assignedListEntry.assignedCoachId);

    const assignedCoachIndex = coachChoices.findIndex(coach =>
        String(coach.coachId) === assignedCoachId
    );

    // Prefer the assigned coach when they have hours available.
    // Otherwise, default to the first available coach.
    const initialCoachIndex = assignedCoachIndex >= 0
        ? assignedCoachIndex
        : 0;

    const initialCoach = coachChoices[initialCoachIndex];

    const initialHours = Math.min(
        4,
        initialCoach.remainingHours
    );
    const actionOptions = [
        ['outreach', 'Outreach', 'Build familiarity'],
        ['teammateConnection', 'Teammate', 'Use known connections'],
        ['roleDiscussion', 'Role fit', 'Discuss playing opportunity'],
        ['practiceInvitation', 'Practice', 'Show development fit']
    ];

    const modalHtml = `
        <div class="space-y-4 text-left text-xs">
            <div class="rounded bg-slate-900 p-3 text-white">
                <div class="flex items-start justify-between gap-3">
                    <div>
                        <h4 class="font-black text-sm">
                            ${escapeHtml(player.name)}
                        </h4>
                        <p class="mt-1 text-slate-300">
                            Age ${Number(player.age) || '—'} ·
                            ${escapeHtml(position)}
                        </p>
                    </div>
                    <div class="text-right">
                        <div class="text-[9px] uppercase tracking-wider text-slate-400">
                            Scouting Estimate
                        </div>
                        <div class="mt-1 font-bold text-amber-300">
                            OFF ${escapeHtml(formatFreeAgentScoutingFit(scouting.offense))}
                        </div>
                        <div class="font-bold text-amber-300">
                            DEF ${escapeHtml(formatFreeAgentScoutingFit(scouting.defense))}
                        </div>
                    </div>
                </div>

                <div class="mt-3">
                    <div class="flex justify-between text-[10px]">
                        <span>Your recruiting interest</span>
                        <b>${interest}/100</b>
                    </div>
                    <div class="mt-1 h-2 overflow-hidden rounded bg-slate-700">
                        <div
                            class="h-full rounded bg-emerald-400"
                            style="width:${interest}%">
                        </div>
                    </div>
                </div>
            </div>

            <div>
                <div class="mb-1 font-black uppercase tracking-wide text-slate-600">
                    Assign Coach
                </div>
                <input type="hidden" id="recruiting-action-coach" value="${escapeHtml(initialCoach.coachId)}">
                <div class="grid grid-cols-1 gap-1 sm:grid-cols-3" role="group" aria-label="Assign recruiting coach">
                    ${coachChoices.map((coach, index) => `
                        <button
                            type="button"
                            data-recruiting-choice-control="recruiting-action-coach"
                            data-recruiting-choice-value="${escapeHtml(coach.coachId)}"
                            data-remaining-hours="${coach.remainingHours}"
                            aria-pressed="${String(coach.coachId) === String(initialCoach.coachId)}"
                            onclick="window.app_selectRecruitingActionChoice('recruiting-action-coach', '${escapeHtml(coach.coachId)}')"
                            class="rounded-sm border px-2 py-1.5 text-left ${String(coach.coachId) === String(initialCoach.coachId) ? 'border-emerald-700 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}">
                            <span class="block truncate text-[10px] font-black">${escapeHtml(coach.coachName)}</span>
                            <span class="block truncate text-[9px] opacity-70">${escapeHtml(coach.role)} · Skill ${coach.skillEstimate}</span>
                            <span class="mt-0.5 block text-[9px] font-bold">${coach.remainingHours}h available</span>
                        </button>
                    `).join('')}
                </div>
            </div>

            <div>
                <div class="mb-1 font-black uppercase tracking-wide text-slate-600">
                    Recruiting Action
                </div>
                <input type="hidden" id="recruiting-action-type" value="outreach">
                <div class="grid grid-cols-2 gap-1" role="group" aria-label="Recruiting action">
                    ${actionOptions.map(([value, label, detail], index) => `
                        <button
                            type="button"
                            data-recruiting-choice-control="recruiting-action-type"
                            data-recruiting-choice-value="${value}"
                            aria-pressed="${index === 0}"
                            title="${detail}"
                            onclick="window.app_selectRecruitingActionChoice('recruiting-action-type', '${value}')"
                            class="rounded-sm border px-2 py-1.5 text-left ${index === 0 ? 'border-emerald-700 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}">
                            <span class="block text-[10px] font-black">${label}</span>
                            <span class="block truncate text-[9px] opacity-70">${detail}</span>
                        </button>
                    `).join('')}
                </div>
                <p class="mt-1 text-[10px] text-slate-500">
                    Matching staff skills and varying approaches improves the pitch.
                </p>
            </div>

            <div>
                <label for="recruiting-action-hours"
                    class="mb-1 block font-black uppercase tracking-wide text-slate-600">
                    Staff Hours
                </label>
                <input
                    type="number"
                    id="recruiting-action-hours"
                    min="1"
                    max="${initialCoach.remainingHours}"
                    step="1"
                    value="${Math.min(2, initialHours)}"
                    class="w-24 rounded-sm border border-slate-300 bg-white p-2 text-xs">
            </div>

            <p class="text-[10px] text-slate-500">
                Staff hours are limited across the entire recruiting week.
                Assigned hours cannot be reused on another day.
            </p>
        </div>
    `;

    showModal(
        `Recruit ${player.name}`,
        modalHtml,
        () => {
            const coachId = document.getElementById(
                'recruiting-action-coach'
            )?.value;

            const actionType = document.getElementById(
                'recruiting-action-type'
            )?.value;

            const hours = Number(
                document.getElementById(
                    'recruiting-action-hours'
                )?.value
            );

            // Refresh state because the modal may have been open while
            // recruiting progress or staff availability changed.
            const currentState = getGameState();
            const currentTeam = currentState?.playerTeam;
            const currentOffseason = currentState?.offseasonState;
            const currentProgress =
                currentOffseason?.recruitingProgress;

            const currentPhase = String(
                currentOffseason?.phase || ''
            ).toLowerCase().replace(/[^a-z]/g, '');

            const currentRecord =
                currentProgress?.recruits?.[String(player.id)];

            const currentPlayer = currentState?.players?.find(
                p => String(p?.id) === String(player.id)
            );

            if (
                currentPhase !== 'recruiting' ||
                !currentProgress?.initialized ||
                currentProgress.completed === true ||
                !currentTeam ||
                !currentRecord ||
                currentRecord.status !== 'available' ||
                currentRecord.committedTeamId != null ||
                !currentPlayer ||
                currentPlayer.teamId != null
            ) {
                showModal(
                    'Recruiting Action Unavailable',
                    '<p>This recruit is no longer available, or the recruiting period has ended. Refresh the recruiting screen and try again.</p>'
                );
                return;
            }

            if (
                !coachId ||
                ![
                    'outreach',
                    'teammateConnection',
                    'roleDiscussion',
                    'practiceInvitation'
                ].includes(actionType) ||
                !Number.isInteger(hours) ||
                hours < 1
            ) {
                showModal(
                    'Invalid Recruiting Action',
                    '<p>Choose a valid coach, recruiting action, and number of hours.</p>'
                );
                return;
            }

            const result = Game.executeRecruitingAction(
                currentState,
                currentTeam.id,
                coachId,
                currentPlayer.id,
                actionType,
                hours
            );

            if (!result?.success) {
                showModal(
                    'Recruiting Action Failed',
                    `<p>${escapeHtml(
                        result?.message || 'The recruiting action could not be completed.'
                    )}</p>`
                );
                return;
            }

            Game.saveGameState?.('backyardFootballGameState');

            renderOffseasonFAScreen(getGameState());

            const completionMessage =
                result.message ||
                'Your staff completed the recruiting action.';

            showModal(
                'Recruiting Action Complete',
                `<p>${escapeHtml(completionMessage)}</p>`,
                null,
                'Continue'
            );
        },
        'Perform Recruiting Action'
    );
};

window.app_openRecruitingTryoutBatchModal = function(playerIds) {
    const gs = getGameState();
    const team = gs?.playerTeam;
    const progress = gs?.offseasonState?.recruitingProgress;

    const SESSION_HOURS = 2;
    const MAX_PARTICIPANTS = 8;

    if (!team || !progress?.initialized || progress.completed === true) {
        showModal(
            'Tryout Unavailable',
            '<p>The recruiting week is not active.</p>'
        );
        return;
    }

    const selectedIds = [
        ...new Set(
            (Array.isArray(playerIds) ? playerIds : [])
                .filter(id => id != null)
                .map(String)
        )
    ];

    if (selectedIds.length === 0 || selectedIds.length > MAX_PARTICIPANTS) {
        showModal(
            'Invalid Tryout Group',
            `<p>Select between 1 and ${MAX_PARTICIPANTS} recruits for a group tryout.</p>`
        );
        return;
    }

    const teamKey = String(team.id);
    const year = Number(gs.year);

    const teamRecruitingList =
        progress.teamRecruitingLists?.[teamKey];

    const listedIds = new Set(
        (Array.isArray(teamRecruitingList) ? teamRecruitingList : [])
            .map(entry => String(entry?.playerId))
    );

    const participants = [];

    for (const recruitId of selectedIds) {
        const player = gs.players?.find(
            candidate => String(candidate?.id) === recruitId
        );

        const record = progress.recruits?.[recruitId];

        if (
            !listedIds.has(recruitId) ||
            !player ||
            player.teamId != null ||
            !record ||
            record.status !== 'available' ||
            record.committedTeamId != null
        ) {
            showModal(
                'Recruit Unavailable',
                `<p>${player?.name || 'A selected recruit'} is no longer available or is not on your recruiting list.</p>`
            );
            return;
        }

        const hasAlreadyAttended = (
            Array.isArray(record.history) ? record.history : []
        ).some(entry =>
            String(entry?.teamId) === teamKey &&
            Number(entry?.year) === year &&
            (
                entry.action === 'tryout_batch' ||
                entry.action === 'tryout' ||
                entry.type === 'recruiting_tryout'
            )
        );

        if (hasAlreadyAttended) {
            showModal(
                'Already Attended',
                `<p>${player.name} has already attended one of your group tryouts this recruiting week. Remove that recruit from the selection and try again.</p>`
            );
            return;
        }

        participants.push(player);
    }

    const budget = Game.getRecruitingStaffHourBudget?.(team, gs) || [];

    const coachProfiles = [
        ...(Array.isArray(team.coaches) ? team.coaches : []),
        ...Object.values(team.staff || {})
    ];

    const coaches = budget
        .filter(coach =>
            Number(coach.remainingHours) >= SESSION_HOURS
        )
        .map(coach => {
            const profile = coachProfiles.find(candidate =>
                String(candidate?.id) === String(coach.coachId)
            );

            return {
                ...coach,
                role: profile?.role || 'Volunteer coach'
            };
        });

    if (coaches.length === 0) {
        showModal(
            'Not Enough Staff Time',
            `<p>Your staff needs at least ${SESSION_HOURS} recruiting hours available with one coach to host a group tryout.</p>`
        );
        return;
    }

    const escapeHtml = value => String(value ?? '').replace(
        /[&<>"']/g,
        character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[character]
    );

    const modalHtml = `
        <div class="space-y-4 text-left text-xs">
            <div class="rounded bg-slate-900 p-3 text-white">
                <div class="text-sm font-black">
                    Group Tryout
                </div>
                <div class="mt-1 text-slate-300">
                    ${participants.length} recruit${participants.length === 1 ? '' : 's'} selected
                </div>
                <div class="mt-2 text-amber-300 font-bold">
                    Fixed session cost: ${SESSION_HOURS} staff hours
                </div>
                <div class="mt-1 text-[10px] text-slate-400">
                    The same session cost applies regardless of the number of attendees.
                </div>
            </div>

            <div>
                <div class="mb-2 font-black uppercase tracking-wide text-slate-600">
                    Attendees
                </div>
                <div class="max-h-48 overflow-y-auto rounded border border-slate-200 bg-white divide-y divide-slate-100">
                    ${participants.map(player => `
                        <div class="flex items-center justify-between gap-2 px-3 py-2">
                            <span class="font-bold text-slate-800">
                                ${escapeHtml(player.name)}
                            </span>
                            <span class="text-[10px] text-slate-500">
                                Age ${Number(player.age) || '—'} · ${escapeHtml(player.pos || '—')}
                            </span>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div>
                <label for="recruiting-tryout-coach"
                    class="mb-1 block font-black uppercase tracking-wide text-slate-600">
                    Host Coach
                </label>
                <select
                    id="recruiting-tryout-coach"
                    class="w-full rounded-sm border border-slate-300 bg-white p-2 text-xs">
                    ${coaches.map(coach => `
                        <option value="${escapeHtml(coach.coachId)}">
                            ${escapeHtml(coach.coachName)} · ${escapeHtml(coach.role)} · ${coach.remainingHours}h remaining
                        </option>
                    `).join('')}
                </select>
            </div>

            <p class="text-[10px] text-slate-500">
                Each recruit can attend one group tryout per team during this recruiting week. The host coach provides a modest interest boost and an individual scouting update for every attendee.
            </p>
        </div>
    `;

    showModal(
        'Hold Group Tryout',
        modalHtml,
        () => {
            const currentState = getGameState();
            const currentTeam = currentState?.playerTeam;
            const currentProgress =
                currentState?.offseasonState?.recruitingProgress;

            const coachId = document.getElementById(
                'recruiting-tryout-coach'
            )?.value;

            if (
                !currentTeam ||
                !currentProgress?.initialized ||
                currentProgress.completed === true ||
                !coachId
            ) {
                showModal(
                    'Tryout Unavailable',
                    '<p>The recruiting state or selected coach is no longer available.</p>'
                );
                return;
            }

            if (
                typeof Game.advanceRecruitingTryoutScoutingReport !== 'function'
            ) {
                showModal(
                    'Tryout Unavailable',
                    '<p>The scouting evaluation system is unavailable. No session was charged.</p>'
                );
                return;
            }

            if (
                typeof Game.executeRecruitingTryoutBatch !== 'function' ||
                typeof Game.advanceRecruitingTryoutScoutingReport !== 'function'
            ) {
                showModal(
                    'Tryout Unavailable',
                    '<p>The group tryout or scouting evaluation system is unavailable. No session was charged.</p>'
                );
                return;
            }

            const selectedEvaluator = Game.ensureTeamCoachingStaff(
                currentTeam
            ).find(
                coach =>
                    String(coach?.id) === String(coachId)
            );

            const selectedPlayers = selectedIds.map(playerId =>
                currentState.players.find(
                    player =>
                        String(player?.id) === String(playerId)
                )
            );

            const rosterIds = new Set(
                Game.getRosterObjects(currentTeam)
                    .filter(player => player?.id != null)
                    .map(player => String(player.id))
            );

            const invalidScoutingCandidate = selectedPlayers.some(
                player =>
                    !player ||
                    !player.attributes ||
                    player.teamId != null ||
                    rosterIds.has(String(player.id))
            );

            if (!selectedEvaluator || invalidScoutingCandidate) {
                showModal(
                    'Tryout Unavailable',
                    '<p>Every attendee must have a valid scouting profile, and the selected coach must still be on your staff. No session was charged.</p>'
                );
                return;
            }

            const result = Game.executeRecruitingTryoutBatch(
                currentState,
                currentTeam.id,
                coachId,
                selectedIds
            );

            if (!result?.success) {
                showModal(
                    'Group Tryout Failed',
                    `<p>${escapeHtml(result?.message || 'The group tryout could not be completed.')}</p>`
                );
                return;
            }

            const evaluator = selectedEvaluator;

            const scoutingResults = [];

            for (const attendee of result.participants || []) {
                const player = currentState.players?.find(
                    candidate =>
                        String(candidate?.id) ===
                        String(attendee.playerId)
                );

                if (!player || !evaluator) {
                    scoutingResults.push({
                        playerName: attendee.playerName || 'Recruit',
                        levelText: 'Scouting update unavailable'
                    });
                    continue;
                }

                const scoutingResult =
                    Game.advanceRecruitingTryoutScoutingReport(
                        currentTeam,
                        player,
                        evaluator,
                        50,
                        Number(currentState.year),
                        0,
                        result.sessionId
                );

                scoutingResults.push({
                    playerName: player.name,
                    levelText: scoutingResult?.success
                        ? scoutingResult.alreadyFullyScouted
                            ? 'Already fully scouted'
                            : scoutingResult.levelGain > 0
                                ? `Scouting +${scoutingResult.levelGain} level${scoutingResult.levelGain === 1 ? '' : 's'}`
                                : 'Scouting progress updated'
                        : 'Scouting report unchanged'
                });
            }

            Game.saveGameState?.('backyardFootballGameState');

            renderOffseasonFAScreen(getGameState());

            const attendeeRows = scoutingResults.map(entry => `
                <div class="flex items-center justify-between gap-3 border-b border-slate-100 py-2">
                    <span class="font-bold text-slate-800">
                        ${escapeHtml(entry.playerName)}
                    </span>
                    <span class="text-right text-[10px] text-slate-600">
                        ${escapeHtml(entry.levelText)}
                    </span>
                </div>
            `).join('');

            showModal(
                'Group Tryout Complete',
                `
                    <div class="space-y-3 text-left text-xs">
                        <p>
                            ${escapeHtml(result.coachName)} hosted a session with
                            ${result.participantCount} recruit${result.participantCount === 1 ? '' : 's'}.
                        </p>
                        <p class="font-bold text-emerald-800">
                            ${result.hours} staff hours used for the entire group.
                        </p>
                        <div class="rounded border border-slate-200 bg-white px-3">
                            ${attendeeRows}
                        </div>
                    </div>
                `,
                null,
                'Continue'
            );
        },
        'Hold Group Tryout'
    );
};

window.app_openRecruitingSweetenerModal = function(playerId) {
    const gs = getGameState();
    const team = gs?.playerTeam;

    if (!team) return;

    const state = gs.offseasonState;
    const progress = state?.recruitingProgress;

    const normalizedPhase = String(state?.phase || '')
        .toLowerCase()
        .replace(/[^a-z]/g, '');

    if (
        normalizedPhase !== 'recruiting' ||
        !progress ||
        progress.initialized !== true ||
        progress.completed === true ||
        Number(progress.seasonYear) !== Number(gs.year)
    ) {
        showModal(
            'Recruiting Unavailable',
            '<p>The seven-day recruiting week is not active.</p>'
        );
        return;
    }

    const player = Game.getPlayer(playerId) ||
        gs.players?.find(
            candidate =>
                String(candidate?.id) === String(playerId)
        );

    const record = progress.recruits?.[String(playerId)];

    if (
        !player ||
        player.teamId != null ||
        !record ||
        record.status !== 'available' ||
        record.committedTeamId != null
    ) {
        showModal(
            'Recruit Unavailable',
            '<p>This prospect is no longer available for a recruiting gift or favor.</p>'
        );
        return;
    }

    const teamKey = String(team.id);

    const currentInterest = Math.max(
        0,
        Math.min(
            100,
            Number(record.interestByTeam?.[teamKey]) || 0
        )
    );

    if (currentInterest >= 100) {
        showModal(
            'Interest Already Maximized',
            `<p>Your team has already maximized ${player.name}'s recruiting interest.</p>`
        );
        return;
    }

    const finances = team.finances || {
        balance: 10,
        waivedDues: [],
        autoSnack: 'none'
    };

    const rawBalance = Number(finances.balance);

    const availableCash = Number.isFinite(rawBalance)
        ? Math.max(0, rawBalance)
        : 0;

    const history = Array.isArray(record.history)
        ? record.history
        : [];

    const teamSweeteners = history.filter(entry =>
        entry?.type === 'recruiting_sweetener' &&
        String(entry.teamId) === teamKey
    );

    const favorAlreadyUsed = teamSweeteners.some(
        entry => entry.sweetenerType === 'favor'
    );

    const favorTokens = Math.max(
        0,
        Math.floor(
            Number(team.socialProfile?.favorTokens) || 0
        )
    );

    const canUseFavor =
        !favorAlreadyUsed &&
        favorTokens > 0;

    const canSendGift = availableCash >= 0.01;

    if (!canUseFavor && !canSendGift) {
        showModal(
            'No Recruiting Resources Available',
            `<p>Your team does not have enough cash or an available Favor Token to support ${player.name}.</p>`
        );
        return;
    }

    const initialType =
        !canSendGift && canUseFavor
            ? 'favor'
            : 'gift';

    const initialGiftAmount = Math.min(
        10,
        availableCash
    );

    const escapeHtml = value => String(value ?? '').replace(
        /[&<>"']/g,
        character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[character]
    );

    const modalHtml = `
        <div class="space-y-4 text-left text-xs">

            <div class="rounded bg-slate-900 p-3 text-white">
                <div class="flex items-center justify-between gap-3">
                    <div>
                        <h4 class="font-black text-sm">
                            ${escapeHtml(player.name)}
                        </h4>
                        <p class="mt-1 text-slate-300">
                            Age ${Number(player.age) || '—'} ·
                            Recruiting interest: ${currentInterest}/100
                        </p>
                    </div>
                    <div class="text-right">
                        <div class="text-[9px] uppercase tracking-wider text-slate-400">
                            Available Resources
                        </div>
                        <div class="mt-1 font-bold text-emerald-300">
                            $${availableCash.toFixed(2)}
                        </div>
                        <div class="font-bold text-amber-300">
                            ${favorTokens} Favor Token${favorTokens === 1 ? '' : 's'}
                        </div>
                    </div>
                </div>
            </div>

            <div>
                <label
                    for="recruiting-sweetener-type"
                    class="mb-1 block font-black uppercase tracking-wide text-slate-600">
                    Recruiting Support
                </label>

                <input type="hidden" id="recruiting-sweetener-type" value="${initialType}">
                <div class="grid grid-cols-2 gap-1" role="group" aria-label="Recruiting support">
                    <button type="button" data-recruiting-sweetener-option data-sweetener-value="gift" aria-pressed="${initialType === 'gift'}" ${!canSendGift ? 'disabled' : ''} onclick="window.app_selectRecruitingSweetenerType('gift', true)" class="rounded-sm border px-2 py-2 text-left disabled:cursor-not-allowed disabled:opacity-40 ${initialType === 'gift' ? 'border-emerald-700 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}"><span class="block text-[10px] font-black">Cash gift</span><span class="mt-0.5 block text-[9px] text-slate-500">Spend from team funds</span></button>
                    <button type="button" data-recruiting-sweetener-option data-sweetener-value="favor" aria-pressed="${initialType === 'favor'}" ${!canUseFavor ? 'disabled' : ''} onclick="window.app_selectRecruitingSweetenerType('favor', true)" class="rounded-sm border px-2 py-2 text-left disabled:cursor-not-allowed disabled:opacity-40 ${initialType === 'favor' ? 'border-amber-600 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}"><span class="block text-[10px] font-black">Favor Token</span><span class="mt-0.5 block text-[9px] text-slate-500">${favorTokens} available</span></button>
                </div>
            </div>

            <div
                id="recruiting-gift-amount-wrap"
                class="${initialType === 'favor' ? 'hidden' : ''}">

                <label
                    for="recruiting-gift-amount"
                    class="mb-1 block font-black uppercase tracking-wide text-slate-600">
                    Gift Amount
                </label>

                <div class="relative">
                    <span class="absolute left-3 top-2 text-slate-500 font-bold">
                        $
                    </span>
                    <input
                        id="recruiting-gift-amount"
                        type="number"
                        min="0.01"
                        max="${availableCash.toFixed(2)}"
                        step="0.01"
                        value="${initialGiftAmount.toFixed(2)}"
                        class="w-full rounded border border-slate-300 bg-white p-2 pl-7 text-sm font-bold"
                        ${!canSendGift ? 'disabled' : ''}>
                </div>

                <p class="mt-1 text-[10px] text-slate-500">
                    Enter any amount up to your available team balance.
                    The amount will be deducted from team finances.
                </p>
            </div>

            <div class="rounded border border-amber-200 bg-amber-50 p-3">
                <p class="font-bold text-amber-900 text-[11px]">
                    Recruiting investment has diminishing returns
                </p>
                <p class="mt-1 text-[10px] text-amber-800">
                    Larger gifts can make a stronger impression, but repeated
                    spending on the same prospect produces progressively
                    smaller interest gains. A gift does not guarantee a commitment.
                </p>
            </div>

            <p class="text-[10px] text-slate-500">
                A Favor Token can only be used once for this prospect during
                the recruiting week.
            </p>
        </div>
    `;

    showModal(
        `Gift / Favor: ${player.name}`,
        modalHtml,
        () => {
            const sweetenerType = document.getElementById(
                'recruiting-sweetener-type'
            )?.value;

            const giftAmount = sweetenerType === 'gift'
                ? Number(
                    document.getElementById(
                        'recruiting-gift-amount'
                    )?.value
                )
                : null;

            const currentState = getGameState();
            const currentTeam = currentState?.playerTeam;
            const currentOffseason = currentState?.offseasonState;
            const currentProgress =
                currentOffseason?.recruitingProgress;

            const currentPhase = String(
                currentOffseason?.phase || ''
            ).toLowerCase().replace(/[^a-z]/g, '');

            const currentRecord =
                currentProgress?.recruits?.[String(playerId)];

            const currentPlayer = currentState?.players?.find(
                candidate =>
                    String(candidate?.id) === String(playerId)
            );

            if (
                currentPhase !== 'recruiting' ||
                !currentProgress?.initialized ||
                currentProgress.completed === true ||
                Number(currentProgress.seasonYear) !==
                    Number(currentState?.year) ||
                !currentTeam ||
                !currentRecord ||
                currentRecord.status !== 'available' ||
                currentRecord.committedTeamId != null ||
                !currentPlayer ||
                currentPlayer.teamId != null
            ) {
                showModal(
                    'Recruiting Sweetener Unavailable',
                    '<p>This prospect is no longer available, or the recruiting period has ended. Refresh the recruiting screen and try again.</p>'
                );
                return;
            }

            if (!['gift', 'favor'].includes(sweetenerType)) {
                showModal(
                    'Invalid Recruiting Support',
                    '<p>Choose either a cash gift or a Favor Token.</p>'
                );
                return;
            }

            if (
                sweetenerType === 'gift' &&
                (
                    !Number.isFinite(giftAmount) ||
                    giftAmount <= 0
                )
            ) {
                showModal(
                    'Invalid Gift Amount',
                    '<p>Enter a valid gift amount greater than zero.</p>'
                );
                return;
            }

            const result = applyRecruitingSweetener(
                currentState,
                currentTeam.id,
                currentPlayer.id,
                sweetenerType,
                giftAmount
            );

            if (!result?.success) {
                showModal(
                    'Recruiting Support Failed',
                    `<p>${escapeHtml(
                        result?.message ||
                        'The recruiting gift or favor could not be completed.'
                    )}</p>`
                );
                return;
            }

            Game.saveGameState?.('backyardFootballGameState');

            renderOffseasonFAScreen(getGameState());

            showModal(
                'Recruiting Support Complete',
                `<p>${escapeHtml(
                    result.message ||
                    'Your recruiting support was applied successfully.'
                )}</p>
                <p class="mt-2 text-[10px] text-slate-500">
                    Interest: ${result.interestBefore}/100 →
                    ${result.interestAfter}/100
                    ${result.cashSpent > 0
                        ? ` · Cash spent: $${Number(result.cashSpent).toFixed(2)}`
                        : ''}
                </p>`,
                null,
                'Continue'
            );
        },
        'Apply Recruiting Support'
    );
};

window.app_openBidModal = function(playerId) {
    if (
        typeof window.app_openRecruitingActionModal !== 'function'
    ) {
        showModal(
            'Recruiting Unavailable',
            '<p>The recruiting action interface could not be opened.</p>'
        );
        return;
    }

    window.app_openRecruitingActionModal(playerId);
};

let staffWorkloadExpanded = false;

export function renderStaffTab(gameState, targetContainerId = null) {
    const carouselScreen = document.getElementById('staff-carousel-screen');

    const isDedicatedCarouselVisible =
        carouselScreen && !carouselScreen.classList.contains('hidden');

    const containerId = targetContainerId || (
        isDedicatedCarouselVisible
            ? 'staff-carousel-staff-container'
            : 'staff-container'
    );

    const container = document.getElementById(containerId);

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

    const isStaffChangeWindowOpen = () => {
        const currentState = Game.getGameState() || gameState;

        const offseasonPhase = String(
            currentState?.offseasonState?.phase ?? ''
        ).toLowerCase().replace(/[^a-z]/g, '');

        const carouselScreen = document.getElementById(
            'staff-carousel-screen'
        );

        const isCarouselVisible =
            carouselScreen &&
            !carouselScreen.classList.contains('hidden');

        return (
            offseasonPhase === 'staffreview' &&
            currentState?.offseasonState?.completed !== true &&
            currentState?.offseasonState?.staffCarouselOpened === true &&
            isCarouselVisible
        );
    };

    window.app_hireStaff = (staffId, roleKey) => {
        if (!isStaffChangeWindowOpen()) {
            showModal(
                'Staff Changes Closed',
                'Coaching staff can only be hired or replaced during the offseason. You can continue managing your current staff and weekly workload during the regular season.',
                null,
                null,
                null,
                'Close'
            );
            return;
        }

        const isStaffEmployed = candidateId => {
            const id = String(candidateId);
            const latestState = Game.getGameState() || gameState;

            const teamsToCheck = [
                ...(Array.isArray(latestState?.teams)
                    ? latestState.teams
                    : []),
                ...(latestState?.playerTeam
                    ? [latestState.playerTeam]
                    : [])
            ];

            return teamsToCheck.some(candidateTeam => {
                if (!candidateTeam) return false;

                const coachingGroup = Array.isArray(candidateTeam.coaches)
                    ? candidateTeam.coaches
                    : [];

                const legacyStaff = [
                    candidateTeam.coach,
                    candidateTeam.staff?.coach,
                    candidateTeam.staff?.scout,
                    candidateTeam.staff?.trainer
                ];

                return [...coachingGroup, ...legacyStaff].some(member =>
                    member?.id != null &&
                    String(member.id) === id
                );
            });
        };

        const marketMatches = (
            Array.isArray(gameState.availableStaff)
                ? gameState.availableStaff
                : []
        ).filter(candidate =>
            candidate?.id != null &&
            String(candidate.id) === String(staffId)
        );

        let staff = marketMatches[0];

        if (!staff) return;

        if (
            staff.teamId != null ||
            marketMatches.some(candidate => candidate.teamId != null) ||
            isStaffEmployed(staff.id)
        ) {
            showModal(
                'Staff Member Unavailable',
                'This coach is already assigned to a team or is no longer available. Refresh the staff market before making another offer.',
                null,
                null,
                null,
                'Close'
            );
            return;
        }

        Game.ensureTeamCoachingStaff?.(team);

        const currentStaffCoaches = (
            Array.isArray(team.coaches) ? team.coaches : []
        ).filter(coach =>
            coach?.id != null && !coach.isUserCoach
        ).slice(0, 3);

        // The active coaching group determines whether this is a new hire
        // into an open slot or a replacement for an existing coach.
        const hasOpenCoachingSlot = currentStaffCoaches.length < 3;

        const tokensAvailable = team.socialProfile?.favorTokens || 0;
        const roleLabels = { coach: 'Head Coach', scout: 'Park Scout', trainer: 'Sideline Trainer' };
        const roleName = roleLabels[roleKey] || roleKey.toUpperCase();
        const isHeadCoach = roleKey === 'coach';

        const getCoachSkillAverage = coach => {
            const ratings = coach?.ratings || {};

            const readRating = key => {
                const rawValue = ratings[key];

                if (rawValue == null || rawValue === '') {
                    return null;
                }

                const value = Number(rawValue);

                return Number.isFinite(value)
                    ? Math.max(0, Math.min(100, Math.round(value)))
                    : null;
            };

            const average = values => {
                const valid = values.filter(value => value !== null);

                return valid.length
                    ? Math.round(
                        valid.reduce((sum, value) => sum + value, 0) /
                        valid.length
                    )
                    : null;
            };

            return average([
                readRating('offSchemeMastery'),
                readRating('defSchemeMastery'),
                average([
                    readRating('evalPhysicals'),
                    readRating('evalTechnique'),
                    readRating('evalCharacter')
                ]),
                readRating('teaching'),
                average([
                    readRating('gameplanInstinct'),
                    readRating('inGameAdjustments')
                ]),
                average([
                    readRating('practiceDiscipline'),
                    readRating('conditioning')
                ])
            ]);
        };

        const getCoachRoleFit = (coach, role) => {
            const calculateRoleFit =
                typeof Game.calculateCoachRoleFit === 'function'
                    ? Game.calculateCoachRoleFit
                    : typeof Game.staff?.calculateCoachRoleFit === 'function'
                        ? Game.staff.calculateCoachRoleFit
                        : null;

            if (!calculateRoleFit) return null;

            const score = Number(calculateRoleFit(coach, role));

            return Number.isFinite(score)
                ? Math.max(0, Math.min(100, Math.round(score)))
                : null;
        };

        const pitchModalHtml = `
            <div class="space-y-3.5 text-left text-xs">
                <!-- Candidate Identity Header -->
                <div class="bg-slate-900 text-white p-3 rounded flex justify-between items-start">
                    <div>
                        <div class="flex items-center gap-2">
                            <h4 class="font-black text-sm text-white">${staff.name}</h4>
                            <span class="text-[9px] bg-slate-800 text-amber-400 font-bold px-1.5 py-0.5 rounded border border-slate-700">${staff.age}yo</span>
                        </div>
                        <p class="text-[11px] text-slate-400 mt-0.5 font-sans">${staff.biases?.personality?.displayName || staff.biases?.personality?.name || 'Coach'} • ${staff.biases?.tactical?.displayName || staff.biases?.tactical?.name || 'Tactician'}</p>
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

                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div class="rounded border border-slate-200 bg-white p-2">
                        <span class="block text-[9px] font-bold uppercase text-slate-500">
                            Skill average
                        </span>
                        <span class="mt-1 block text-lg font-black tabular-nums text-slate-900">
                            ${getCoachSkillAverage(staff) ?? '—'}
                        </span>
                    </div>

                    <div class="rounded border border-slate-200 bg-white p-2">
                        <span class="block text-[9px] font-bold uppercase text-slate-500">
                            General fit
                        </span>
                        <span class="mt-1 block text-lg font-black tabular-nums text-slate-900">
                            ${getCoachRoleFit(staff, 'general') ?? '—'}
                        </span>
                    </div>

                    <div class="rounded border border-slate-200 bg-white p-2">
                        <span class="block text-[9px] font-bold uppercase text-slate-500">
                            Scouting fit
                        </span>
                        <span class="mt-1 block text-lg font-black tabular-nums text-slate-900">
                            ${getCoachRoleFit(staff, 'scouting') ?? '—'}
                        </span>
                    </div>

                    <div class="rounded border border-slate-200 bg-white p-2">
                        <span class="block text-[9px] font-bold uppercase text-slate-500">
                            Training fit
                        </span>
                        <span class="mt-1 block text-lg font-black tabular-nums text-slate-900">
                            ${getCoachRoleFit(staff, 'training') ?? '—'}
                        </span>
                    </div>
                </div>

                ${isHeadCoach && !hasOpenCoachingSlot ? `
                <div class="rounded border border-blue-200 bg-blue-50 p-3">
                    <label
                        for="staff-replacement-coach"
                        class="block text-[10px] font-black uppercase tracking-wider text-blue-900 mb-1">
                        Replace Which Coach?
                    </label>

                    <input type="hidden" id="staff-replacement-coach" value="${currentStaffCoaches[0]?.id || ''}">
                    <button
                        type="button"
                        id="staff-replacement-coach-trigger"
                        aria-expanded="false"
                        aria-controls="staff-replacement-coach-popover"
                        onclick="window.app_toggleStaffReplacementPicker()"
                        class="flex w-full items-center justify-between gap-3 rounded border border-blue-300 bg-white px-2 py-2 text-left text-xs font-bold text-slate-800 hover:border-blue-500">
                        <span id="staff-replacement-coach-label" class="truncate">${overviewEscape(currentStaffCoaches[0]?.name || 'Choose a coach to replace')}</span>
                        <span aria-hidden="true" class="text-slate-400">▾</span>
                    </button>
                    <div id="staff-replacement-coach-popover" class="absolute left-3 right-3 z-30 mt-1 hidden max-h-56 overflow-y-auto rounded border border-blue-300 bg-white p-2 shadow-xl">
                        <div class="overflow-hidden rounded-sm border border-slate-200">
                            <div class="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] gap-2 bg-slate-100 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-slate-500">
                                <span>Coach</span><span class="text-right">Skill avg</span><span class="text-right">General fit</span>
                            </div>
                            ${currentStaffCoaches.map((coach, index) => {
                            const skillAverage = getCoachSkillAverage(coach);
                            const generalFit = getCoachRoleFit(coach, 'general');

                            return `
                                <button type="button" data-replacement-coach-id="${overviewEscape(coach.id)}" data-replacement-coach-name="${overviewEscape(coach.name || `Staff Coach ${index + 1}`)}" aria-pressed="${index === 0}" onclick="window.app_selectStaffReplacementCoach(this)" class="grid w-full grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] gap-2 border-t border-slate-100 px-2 py-2 text-left text-[10px] ${index === 0 ? 'bg-blue-50' : 'hover:bg-slate-50'}">
                                    <span class="truncate font-semibold">${overviewEscape(coach.name || `Staff Coach ${index + 1}`)}</span>
                                    <span class="text-right">${skillAverage ?? '—'}</span>
                                    <span class="text-right">${generalFit ?? '—'}</span>
                                </button>
                            `;
                        }).join('')}
                        </div>
                    </div>

                    <p class="text-[10px] text-blue-800 mt-2">
                        The selected coach will return to the free-agent market
                        if this candidate accepts.
                    </p>
                </div>
                ` : isHeadCoach ? `
                <div class="rounded border border-emerald-200 bg-emerald-50 p-3">
                    <h4 class="text-[10px] font-black uppercase tracking-wider text-emerald-900">
                        Open Coaching Position
                    </h4>
                    <p class="text-[11px] text-emerald-800 mt-1">
                        Your coaching group has an open position. An accepted offer
                        will fill the vacancy without dismissing a current coach.
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
                        <input type="hidden" id="staff-scheme-promise" value="COACH_CHOICE">
                        <div class="grid grid-cols-1 gap-1 sm:grid-cols-2" role="group" aria-label="Scheme autonomy">
                            <button type="button" data-staff-pitch-control="staff-scheme-promise" data-staff-pitch-value="COACH_CHOICE" aria-pressed="true" onclick="window.app_setStaffPitchChoice('staff-scheme-promise', 'COACH_CHOICE')" class="rounded-sm border border-emerald-700 bg-emerald-50 px-2 py-2 text-left text-[10px] font-bold text-emerald-900">Coach autonomy<span class="mt-0.5 block text-[9px] font-normal text-slate-600">Coach sets the gameplan · improves pitch</span></button>
                            <button type="button" data-staff-pitch-control="staff-scheme-promise" data-staff-pitch-value="GM_CHOICE" aria-pressed="false" onclick="window.app_setStaffPitchChoice('staff-scheme-promise', 'GM_CHOICE')" class="rounded-sm border border-slate-200 bg-white px-2 py-2 text-left text-[10px] font-bold text-slate-700">GM control<span class="mt-0.5 block text-[9px] font-normal text-slate-500">Front office sets both formations</span></button>
                        </div>
                    </div>` : ''}

                    <div>
                        <label class="block text-[10px] font-black uppercase tracking-wider text-slate-600 mb-1">
                            Program Practice Focus & Sideline Culture
                        </label>
                        <input type="hidden" id="staff-practice-focus" value="CONDITIONING">
                        <div class="grid grid-cols-1 gap-1 sm:grid-cols-3" role="group" aria-label="Practice focus">
                            ${[
                                ['CONDITIONING', 'Conditioning', 'Favors stamina and grit'],
                                ['CHALK_TALK', 'Film & playbook', 'Favors tactical learning'],
                                ['FUN_SCRIMMAGE', 'Team chemistry', 'Favors morale and relationships']
                            ].map(([value, label, detail], index) => `
                                <button type="button" data-staff-pitch-control="staff-practice-focus" data-staff-pitch-value="${value}" aria-pressed="${index === 0}" onclick="window.app_setStaffPitchChoice('staff-practice-focus', '${value}')" class="rounded-sm border px-2 py-2 text-left text-[10px] font-bold ${index === 0 ? 'border-emerald-700 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}">${label}<span class="mt-0.5 block text-[9px] font-normal text-slate-500">${detail}</span></button>
                            `).join('')}
                        </div>
                    </div>

                    <div>
                        <div class="flex justify-between items-center mb-1">
                            <label class="text-[10px] font-black uppercase tracking-wider text-slate-600">
                                Upfront Equipment & Coffee Stipend
                            </label>
                            <span class="text-[9px] font-mono text-emerald-700 font-bold">Fund: $${(team.finances?.balance || 0).toFixed(2)}</span>
                        </div>
                        <input
                            type="number"
                            id="staff-pitch-cash"
                            min="0"
                            max="${Math.floor(Math.max(0, Number(team.finances?.balance) || 0))}"
                            step="1"
                            value="0"
                            inputmode="numeric"
                            class="w-full p-2 border border-slate-300 rounded font-bold text-slate-800 bg-white text-xs outline-none"
                        />
                        <p class="text-[10px] text-slate-500 mt-1">
                            Enter any whole-dollar amount. Charged only if the offer is accepted.
                        </p>
                    </div>

                    <div>
                        <label class="block text-[10px] font-black uppercase tracking-wider text-slate-600 mb-1">
                            Favor Token Sweetener (Available: ${tokensAvailable})
                        </label>
                        <input type="hidden" id="staff-pitch-tokens" value="0">
                        <div class="grid grid-cols-1 gap-1 sm:grid-cols-3" role="group" aria-label="Favor token sweetener">
                            ${[
                                ['0', 'No tokens', 'Standard pitch'],
                                ...(tokensAvailable >= 1 ? [['1', '1 token', 'Small favor']] : []),
                                ...(tokensAvailable >= 2 ? [['2', '2 tokens', 'Major favor']] : [])
                            ].map(([value, label, detail], index) => `
                                <button type="button" data-staff-pitch-control="staff-pitch-tokens" data-staff-pitch-value="${value}" aria-pressed="${index === 0}" onclick="window.app_setStaffPitchChoice('staff-pitch-tokens', '${value}')" class="rounded-sm border px-2 py-1.5 text-left text-[10px] font-bold ${index === 0 ? 'border-amber-600 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}">${label}<span class="mt-0.5 block text-[9px] font-normal text-slate-500">${detail}</span></button>
                            `).join('')}
                        </div>
                    </div>
                </div>
            </div>
        `;

        showModal(`Recruit ${roleName}: ${staff.name}`, pitchModalHtml, () => {
            if (!isStaffChangeWindowOpen()) {
                showModal(
                    'Staff Changes Closed',
                    'The offseason staff-change window has closed. No offer has been processed and no resources have been spent.',
                    null,
                    null,
                    null,
                    'Close'
                );
                return;
            }

            // Read the current game state again because the candidate may
            // have been hired or removed while the offer modal was open.
            const latestState = Game.getGameState() || gameState;

            const latestMarketMatches = (
                Array.isArray(latestState?.availableStaff)
                    ? latestState.availableStaff
                    : []
            ).filter(candidate =>
                candidate?.id != null &&
                String(candidate.id) === String(staff.id)
            );

            const candidateStillAvailable =
                latestMarketMatches.length > 0 &&
                latestMarketMatches.every(candidate =>
                    candidate.teamId == null
                ) &&
                !isStaffEmployed(staff.id);

            if (!candidateStillAvailable) {
                showModal(
                    'Staff Member No Longer Available',
                    'This coach has already been hired or removed from the market. No offer costs have been charged.',
                    null,
                    null,
                    null,
                    'Close'
                );
                return;
            }

            // Use the latest market record rather than a potentially stale
            // object captured when the offer modal was opened.
            staff = latestMarketMatches[0];

            const tokensOffered = parseInt(document.getElementById('staff-pitch-tokens')?.value || '0', 10);
            const cashOffered = parseFloat(document.getElementById('staff-pitch-cash')?.value || '0');
            const schemePromise = document.getElementById('staff-scheme-promise')?.value || 'GM_CHOICE';
            const practiceFocus = document.getElementById('staff-practice-focus')?.value || 'BALANCED';
            const replacementCoachId =
                document.getElementById('staff-replacement-coach')?.value || '';

            // Revalidate the offer against current resources. The modal may
            // have been open while another transaction changed the balance.
            const cashBalanceValue = Number(team.finances?.balance);
            const currentCashBalance = Number.isFinite(cashBalanceValue)
                ? Math.max(0, cashBalanceValue)
                : 0;

            const tokenBalanceValue = Number(
                team.socialProfile?.favorTokens
            );
            const currentTokenBalance = Number.isFinite(tokenBalanceValue)
                ? Math.max(0, Math.floor(tokenBalanceValue))
                : 0;

            const offerIsValid =
                Number.isInteger(tokensOffered) &&
                tokensOffered >= 0 &&
                tokensOffered <= 2 &&
                tokensOffered <= currentTokenBalance &&
                Number.isSafeInteger(cashOffered) &&
                cashOffered >= 0 &&
                cashOffered <= currentCashBalance;

            if (!offerIsValid) {
                showModal(
                    'Offer Terms No Longer Available',
                    `
                        <div class="space-y-2 text-sm text-slate-700">
                            <p>
                                Your available cash or Favor Tokens changed,
                                or the submitted offer terms are invalid.
                            </p>
                            <p>
                                Current cash: <b>$${currentCashBalance.toFixed(2)}</b><br>
                                Current Favor Tokens: <b>${currentTokenBalance}</b>
                            </p>
                            <p>
                                No resources have been spent. Close this message
                                and reopen the offer with affordable terms.
                            </p>
                        </div>
                    `,
                    null,
                    null,
                    null,
                    'Close'
                );
                return;
            }
            
        
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
                    const currentNpcCoaches = activeCoaches.filter(
                        coach => coach?.id != null && !coach.isUserCoach
                    );

                    // Recheck current state when the offer is finalized.
                    // A vacancy may have opened or another action may have
                    // changed the coaching group while this modal was open.
                    if (currentNpcCoaches.length >= 3) {
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

                    // Replace stale market copies with the actual outgoing
                    // coach object so career history and development data
                    // remain intact.
                    gameState.availableStaff =
                        gameState.availableStaff.filter(candidate =>
                            String(candidate?.id) !==
                            String(outgoingStaff.id)
                        );

                    gameState.availableStaff.push(outgoingStaff);
                };

                // Transfer existing assignments when a staff member is
                // replaced. Accepted community favors must also update
                // their authoritative assigned-staff reference.
                const transferStaffWorkAssignments = (
                    outgoingStaff,
                    incomingStaff
                ) => {
                    if (
                        !outgoingStaff ||
                        outgoingStaff.id == null ||
                        !incomingStaff ||
                        incomingStaff.id == null ||
                        String(outgoingStaff.id) ===
                            String(incomingStaff.id)
                    ) {
                        return;
                    }

                    const assignments =
                        team.staffWorkPlan?.assignments;

                    if (!Array.isArray(assignments)) return;

                    const outgoingId = String(outgoingStaff.id);
                    const incomingId = String(incomingStaff.id);
                    const incomingName =
                        incomingStaff.name || 'Coach';

                    for (const assignment of assignments) {
                        if (
                            !assignment ||
                            String(assignment.coachId) !== outgoingId
                        ) {
                            continue;
                        }

                        let favor = null;

                        if (
                            assignment.task === 'communityService'
                        ) {
                            if (assignment.favorId == null) continue;

                            const community = latestState?.community;

                            favor = (
                                Array.isArray(community?.favors)
                                    ? community.favors
                                    : []
                            ).find(entry =>
                                entry?.status === 'accepted' &&
                                entry.staffWorkResolved !== true &&
                                String(entry.id) ===
                                    String(assignment.favorId) &&
                                String(entry.acceptedByTeamId) ===
                                    String(team.id) &&
                                String(entry.assignedStaffId) === outgoingId
                            );

                            // Never transfer a workload record without
                            // its matching authoritative favor.
                            if (!favor) continue;
                        }

                        assignment.coachId = incomingId;

                        if ('coachName' in assignment) {
                            assignment.coachName = incomingName;
                        }

                        if (!favor) continue;

                        favor.assignedStaffId = incomingId;
                        favor.assignedStaffName = incomingName;

                        const community = latestState?.community;

                        const contact = community?.contacts?.find(
                            entry =>
                                String(entry.id) ===
                                String(favor.contactId)
                        );

                        const historyEntry =
                            contact?.favorHistory?.find(entry =>
                                String(entry.favorId) ===
                                String(favor.id)
                            );

                        if (historyEntry) {
                            historyEntry.assignedStaffId = incomingId;
                            historyEntry.assignedStaffName = incomingName;
                        }
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

                // Remove every duplicate record for this coach ID so a
                // second market entry cannot offer the same coach again.
                if (!Array.isArray(gameState.availableStaff)) {
                    gameState.availableStaff = [];
                }

                for (
                    let i = gameState.availableStaff.length - 1;
                    i >= 0;
                    i--
                ) {
                    if (
                        String(gameState.availableStaff[i]?.id) ===
                        String(staff.id)
                    ) {
                        gameState.availableStaff.splice(i, 1);
                    }
                }

                staff.role = roleKey;
                staff.teamId = team.id;

                if (!team.staff) {
                    team.staff = {};
                }

                // Determine whether a valid Head Coach reference still
                // points to a coach in this team's current coaching group.
                const currentNpcCoachIds = new Set(
                    activeCoaches
                        .filter(coach =>
                            coach?.id != null &&
                            !coach.isUserCoach
                        )
                        .map(coach => String(coach.id))
                );

                const legacyLeadReferences = [
                    team.coach,
                    team.staff?.coach
                ];

                const hasActiveLegacyLeadCoach =
                    legacyLeadReferences.some(coach =>
                        coach?.id != null &&
                        currentNpcCoachIds.has(String(coach.id))
                    );

                const outgoingWasLegacyLead =
                    outgoingCoach?.id != null &&
                    legacyLeadReferences.some(coach =>
                        coach?.id != null &&
                        String(coach.id) === String(outgoingCoach.id)
                    );

                const replacesLegacyLeadCoach =
                    roleKey === 'coach' &&
                    (
                        outgoingWasLegacyLead ||
                        !hasActiveLegacyLeadCoach
                    );

                if (
                    roleKey !== 'coach' ||
                    replacesLegacyLeadCoach
                ) {
                    team.staff[roleKey] = staff;
                }

                if (roleKey === 'coach') {
                    if (replacementCoachSlot >= 0) {
                        // Replace the selected coach.
                        activeCoaches[replacementCoachSlot] = staff;
                    } else {
                        // Fill an open slot without removing retained staff.
                        activeCoaches.push(staff);
                    }

                    team.coaches = activeCoaches;

                    // Keep the vacancy count synchronized with the active
                    // three-person NPC coaching group.
                    const staffCoaches = activeCoaches
                        .filter(coach => coach && !coach.isUserCoach)
                        .slice(0, 3);

                    team.coachingVacancies = Math.max(
                        0,
                        3 - staffCoaches.length
                    );

                    if (replacesLegacyLeadCoach) {
                        team.coach = staff;
                        team.staff.coach = staff;
                    }

                    // Keep legacy staff references aligned with the active
                    // coaching group and prevent one coach from filling
                    // multiple roles when enough distinct coaches exist.
                    const getActiveStaffCoach = member =>
                        member?.id == null
                            ? null
                            : staffCoaches.find(
                                coach =>
                                    String(coach.id) === String(member.id)
                            ) || null;

                    const headCoach =
                        getActiveStaffCoach(team.staff.coach) ||
                        getActiveStaffCoach(team.coach) ||
                        staffCoaches[0] ||
                        null;

                    team.staff.coach = headCoach;
                    team.coach = headCoach;

                    const assignedRoleCoachIds = new Set(
                        headCoach?.id != null
                            ? [String(headCoach.id)]
                            : []
                    );

                    const assignDistinctStaffRole = currentCoach => {
                        const currentActiveCoach =
                            getActiveStaffCoach(currentCoach);

                        if (
                            currentActiveCoach &&
                            !assignedRoleCoachIds.has(
                                String(currentActiveCoach.id)
                            )
                        ) {
                            assignedRoleCoachIds.add(
                                String(currentActiveCoach.id)
                            );
                            return currentActiveCoach;
                        }

                        const replacementCoach = staffCoaches.find(
                            coach =>
                                coach?.id != null &&
                                !assignedRoleCoachIds.has(String(coach.id))
                        );

                        if (!replacementCoach) return null;

                        assignedRoleCoachIds.add(
                            String(replacementCoach.id)
                        );

                        return replacementCoach;
                    };

                    team.staff.scout = assignDistinctStaffRole(
                        team.staff.scout
                    );

                    team.staff.trainer = assignDistinctStaffRole(
                        team.staff.trainer
                    );

                    transferStaffWorkAssignments(
                        outgoingCoach,
                        staff
                    );

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

                // Scout and Trainer hires also belong to the canonical
                // three-person coaching group. Replace the coach currently
                // assigned to that role rather than creating an orphaned hire.
                if (roleKey !== 'coach') {
                    const replacedRoleCoachSlot = activeCoaches.findIndex(
                        coach =>
                            coach?.id != null &&
                            oldStaff?.id != null &&
                            String(coach.id) === String(oldStaff.id)
                    );

                    if (replacedRoleCoachSlot >= 0) {
                        activeCoaches[replacedRoleCoachSlot] = staff;
                    } else {
                        const currentNpcCount = activeCoaches.filter(
                            coach => coach?.id != null && !coach.isUserCoach
                        ).length;

                        if (currentNpcCount < 3) {
                            activeCoaches.push(staff);
                        }
                    }

                    team.coaches = activeCoaches;

                    const activeNpcCoaches = activeCoaches.filter(
                        coach => coach?.id != null && !coach.isUserCoach
                    );

                    team.coachingVacancies = Math.max(
                        0,
                        3 - activeNpcCoaches.length
                    );

                    // Transfer the outgoing coach's assigned workload,
                    // including any accepted community-service obligation.
                    transferStaffWorkAssignments(
                        oldStaff,
                        staff
                    );

                    // Reconcile legacy role references with the updated group.
                    Game.ensureTeamCoachingStaff?.(team);
                }

                // Persist the completed transaction before rendering the UI.
                // This saves coach ownership, the free-agent pool, offer costs,
                // staff references, workload assignments, and vacancy count.
                saveGameState();

                const carouselScreen = document.getElementById(
                    'staff-carousel-screen'
                );

                const marketPane = document.getElementById(
                    'fo-pane-staff-carousel'
                );

                if (
                    carouselScreen &&
                    !carouselScreen.classList.contains('hidden')
                ) {
                    renderStaffCarouselTab(
                        gameState,
                        'staff-carousel-market-container'
                    );
                } else if (
                    marketPane &&
                    !marketPane.classList.contains('hidden')
                ) {
                    renderStaffCarouselTab(gameState);
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
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-3 py-2">
            <div class="min-w-0">
                <h3 class="text-sm font-black uppercase tracking-wide text-slate-900">
                    Coaching Staff
                </h3>
                <p class="text-[10px] text-slate-500">
                    Compare coaches, monitor development, and manage weekly workloads.
                </p>
            </div>
            <div class="shrink-0 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-mono text-slate-600">
                Budget: <b class="text-slate-900">${team.socialProfile?.favorTokens ?? 3} Tokens</b>
            </div>
        </div>

        <!-- Compact Automation Controls -->
        <section id="staff-hub-automation" class="mb-3 hidden flex flex-col gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex items-center gap-2">
                <h4 class="text-[11px] font-black uppercase tracking-wide text-slate-700">
                    Automation
                </h4>
                <span class="text-[10px] text-slate-400">Optional</span>
            </div>

            <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
                <label
                    class="inline-flex cursor-pointer items-center gap-2"
                    title="Let your coaches choose the weekly practice focus.">
                    <input
                        type="checkbox"
                        class="h-4 w-4 accent-blue-600"
                        ${team.gameplan?.delegatePractice ? 'checked' : ''}
                        onchange="app_setManagementAutomation('delegatePractice', this.checked)"
                    >
                    <span class="text-xs font-semibold text-slate-700">
                        Delegate practice
                    </span>
                </label>

                <label
                    class="inline-flex cursor-pointer items-center gap-2"
                    title="Let your coaches manage the weekly offensive and defensive game plan.">
                    <input
                        type="checkbox"
                        class="h-4 w-4 accent-blue-600"
                        ${team.gameplan?.delegateGameplan ? 'checked' : ''}
                        onchange="app_setManagementAutomation('delegateGameplan', this.checked)"
                    >
                    <span class="text-xs font-semibold text-slate-700">
                        Delegate game planning
                    </span>
                </label>
            </div>
        </section>

        <!-- 1. Current Coaching Group -->
    `;

    Game.ensureTeamCoachingStaff?.(team);

    // Migrate older staff records once before rendering staff panes.
    const developmentWorkPlan = Game.ensureTeamStaffWorkPlan?.(team);

    const currentCoaches = Array.isArray(team.coaches)
        ? team.coaches.filter(Boolean)
        : [];



    const developmentAssignments = Array.isArray(
        developmentWorkPlan?.assignments
    )
        ? developmentWorkPlan.assignments
        : [];

    const developmentRows = currentCoaches.map(coach => {
        const assignedHours = developmentAssignments.reduce(
            (sum, assignment) =>
                String(assignment.coachId) === String(coach.id)
                    ? sum + Math.max(0, Number(assignment.hours) || 0)
                    : sum,
            0
        );

        return {
            id: coach.id,
            assignedHours
        };
    });

        const gmStrategyDepartments =
        team.teamInstructions?.departments || {};

    const strategyPositions = [
        'QB',
        'RB',
        'WR',
        'TE',
        'OL',
        'DL',
        'LB',
        'DB'
    ];

    const strategyAutonomyOptions = [
        ['delegate', 'Delegate'],
        ['guided', 'Guided'],
        ['direct', 'Direct']
    ];

    const strategyPriorityOptions = [
        ['must', 'Must prioritize'],
        ['high', 'High priority'],
        ['normal', 'Normal'],
        ['monitor', 'Monitor'],
        ['ignore', 'Ignore']
    ];

    const strategyDepartmentCards = [
        {
            key: 'recruiting',
            label: 'Recruiting',
            description: 'Guide which position groups receive recruiting attention.',
            autonomy: true,
            positions: true
        },
        {
            key: 'scouting',
            label: 'Scouting',
            description: 'Direct routine scouting toward the positions your roster needs.',
            autonomy: false,
            positions: true
        },
        {
            key: 'development',
            label: 'Player Development',
            description: 'Tell coaches which position groups should receive development attention.',
            autonomy: false,
            positions: true
        },
        {
            key: 'practice',
            label: 'Practice',
            description: 'Control how closely weekly practice choices follow your direction.',
            autonomy: true,
            positions: false
        },
        {
            key: 'gameplan',
            label: 'Game Planning',
            description: 'Control how much discretion coaches have over weekly game planning.',
            autonomy: true,
            positions: false
        }
    ];

    const getStrategyAutonomy = department => {
        const rawValue = department === 'staff'
            ? team.teamInstructions?.autonomy
            : gmStrategyDepartments[department]?.autonomy;

        const value = String(rawValue || 'guided')
            .trim()
            .toLowerCase();

        return strategyAutonomyOptions.some(
            ([key]) => key === value
        )
            ? value
            : 'guided';
    };

    const getStrategyPriority = (department, position) => {
        const rawValue =
            gmStrategyDepartments[department]
                ?.positionPriorities?.[position];

        const value = String(rawValue || 'normal')
            .trim()
            .toLowerCase();

        return strategyPriorityOptions.some(
            ([key]) => key === value
        )
            ? value
            : 'normal';
    };

    const renderStrategyAutonomyControl = department => {
        const currentValue = getStrategyAutonomy(department);

        return `
            <div>
                <span class="mb-1 block text-[9px] font-bold uppercase tracking-wide text-slate-500">
                    Staff autonomy
                </span>
                <div class="flex rounded border border-slate-300 bg-white p-0.5" role="group" aria-label="Staff autonomy">
                    ${strategyAutonomyOptions.map(([value, label]) => `
                        <button
                            type="button"
                            aria-pressed="${currentValue === value}"
                            onclick="app_setTeamStrategySetting('${department}', 'autonomy', '', '${value}')"
                            class="flex-1 rounded-sm px-2 py-1.5 text-[10px] font-bold ${currentValue === value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}">
                            ${label}
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
    };

    const renderStrategyPositionControls = department => {
        return `
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                ${strategyPositions.map(position => {
                    const currentValue = getStrategyPriority(
                        department,
                        position
                    );

                    const menuId = `strategy-priority-menu-${department}-${position}`;
                    const currentLabel = strategyPriorityOptions.find(
                        ([value]) => value === currentValue
                    )?.[1] || 'Normal';

                    return `
                        <div class="relative min-w-0">
                            <span class="mb-1 block text-[9px] font-black uppercase text-slate-500">
                                ${position}
                            </span>
                            <button
                                type="button"
                                id="${menuId}-trigger"
                                aria-expanded="false"
                                aria-controls="${menuId}"
                                onclick="window.app_toggleStrategyPriorityMenu('${menuId}')"
                                class="flex w-full items-center justify-between gap-1 rounded-sm border border-slate-300 bg-white px-2 py-1.5 text-left text-[10px] font-semibold text-slate-700 hover:border-slate-500">
                                <span class="truncate">${currentLabel}</span>
                                <span aria-hidden="true" class="text-slate-400">▾</span>
                            </button>
                            <div id="${menuId}" data-strategy-priority-popover class="absolute left-0 top-full z-30 mt-1 hidden min-w-40 rounded-sm border border-slate-300 bg-white p-1 shadow-xl">
                                ${strategyPriorityOptions.map(([value, label]) => `
                                    <button
                                        type="button"
                                        onclick="app_setTeamStrategySetting('${department}', 'positionPriority', '${position}', '${value}')"
                                        class="block w-full rounded-sm px-2 py-1.5 text-left text-[10px] font-semibold ${currentValue === value ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}">
                                        ${label}
                                    </button>
                                `).join('')}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    };

        const strategyIndividualPriorityOptions = [
        ['inherit', 'Use position priority'],
        ['must', 'Must prioritize'],
        ['high', 'High priority'],
        ['normal', 'Normal'],
        ['monitor', 'Monitor'],
        ['ignore', 'Ignore']
    ];

    const strategyEscape = value =>
        String(value ?? '').replace(/[&<>"']/g, character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[character]);

    const strategyRosterIds = new Set(
        (team.roster || []).map(String)
    );

    const strategyProspects = (
        Array.isArray(gameState.players)
            ? gameState.players
            : []
    )
        .filter(player => {
            if (
                !player ||
                player.id == null ||
                strategyRosterIds.has(String(player.id)) ||
                String(player.teamId) === String(team.id)
            ) {
                return false;
            }

            const status = String(
                player.status?.type || ''
            ).toLowerCase();

            return ![
                'retired',
                'departed',
                'temporary'
            ].includes(status);
        })
        .sort((a, b) => {
            const positionComparison = String(
                a.pos || ''
            ).localeCompare(String(b.pos || ''));

            return positionComparison ||
                String(a.name || '').localeCompare(
                    String(b.name || '')
                );
        });

    const strategyRosterPlayers = (
        Game.getRosterObjects?.(team) || []
    )
        .filter(player =>
            player?.id != null
        )
        .sort((a, b) =>
            String(a.name || '').localeCompare(
                String(b.name || '')
            )
        );

    const getStrategyProspectLabel = player => {
        const name = strategyEscape(
            player.name || 'Unnamed player'
        );

        const position = strategyEscape(
            String(player.pos || 'Unknown').toUpperCase()
        );

        const age = Number.isFinite(Number(player.age))
            ? ` · Age ${Number(player.age)}`
            : '';

        return `${name} — ${position}${age}`;
    };

    const getStrategyIndividualPriority = (
        department,
        targetId,
        mapName
    ) => {
        if (targetId == null || targetId === '') {
            return 'inherit';
        }

        const map =
            gmStrategyDepartments[department]?.[mapName] || {};

        const value = String(map[String(targetId)] || '')
            .trim()
            .toLowerCase();

        return strategyIndividualPriorityOptions.some(
            ([key]) => key === value
        )
            ? value
            : 'inherit';
    };

    const getInitialStrategyTargetId = (
        players,
        priorityMaps
    ) => {
        const savedIds = priorityMaps.flatMap(map =>
            Object.keys(map || {})
        );

        const savedMatch = savedIds.find(id =>
            players.some(player =>
                String(player.id) === String(id)
            )
        );

        return savedMatch != null
            ? String(savedMatch)
            : String(players[0]?.id ?? '');
    };

    const strategyInitialProspectId =
        getInitialStrategyTargetId(
            strategyProspects,
            [
                gmStrategyDepartments.recruiting?.prospectPriorities,
                gmStrategyDepartments.scouting?.prospectPriorities
            ]
        );

    const strategyInitialPlayerId =
        getInitialStrategyTargetId(
            strategyRosterPlayers,
            [
                gmStrategyDepartments.development?.playerPriorities
            ]
        );

    const renderStrategyIndividualPrioritySelect = (
        id,
        department,
        targetId,
        mapName
    ) => {
        const currentValue = getStrategyIndividualPriority(
            department,
            targetId,
            mapName
        );

        return `
            <input type="hidden" id="${id}" value="${currentValue}">
            <div class="grid grid-cols-3 gap-1" role="group" aria-label="Individual strategy priority">
                ${strategyIndividualPriorityOptions.map(([value, label]) => `
                    <button
                        type="button"
                        data-strategy-priority-control="${id}"
                        data-strategy-priority-value="${value}"
                        aria-pressed="${currentValue === value}"
                        ${targetId ? '' : 'disabled'}
                        title="${label}"
                        onclick="window.app_setStrategyIndividualPriorityChoice('${id}', '${department}', '${value}')"
                        class="rounded-sm border px-1.5 py-1 text-[9px] font-bold disabled:cursor-not-allowed disabled:opacity-40 ${currentValue === value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'}">
                        ${value === 'inherit' ? 'Inherit' : label.replace(' priority', '')}
                    </button>
                `).join('')}
            </div>
        `;
    };

    const renderStrategyTargetPicker = (
        id,
        players,
        selectedId,
        targetType,
        label
    ) => {
        const selectedPlayer = players.find(player =>
            String(player.id) === String(selectedId)
        );

        return `
            <input type="hidden" id="${id}" value="${strategyEscape(selectedId)}">
            <div class="relative">
                <button
                    type="button"
                    id="${id}-trigger"
                    aria-expanded="false"
                    aria-controls="${id}-popover"
                    onclick="window.app_toggleStrategyListPicker('${id}')"
                    class="flex w-full items-center justify-between gap-2 rounded border border-slate-300 bg-white px-2 py-2 text-left text-xs font-semibold text-slate-800 hover:border-slate-500">
                    <span id="${id}-label" class="truncate">
                        ${selectedPlayer ? strategyEscape(getStrategyProspectLabel(selectedPlayer)) : label}
                    </span>
                    <span aria-hidden="true" class="text-slate-400">▾</span>
                </button>
                <div
                    id="${id}-popover"
                    class="strategy-list-popover absolute left-0 top-full z-30 mt-1 hidden max-h-80 w-full min-w-64 overflow-y-auto rounded border border-slate-300 bg-white p-2 shadow-xl">
                    <input
                        type="search"
                        data-strategy-list-search="${id}"
                        placeholder="Search ${label.toLowerCase()}..."
                        oninput="window.app_filterStrategyList('${id}')"
                        class="mb-2 w-full rounded border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-slate-500">
                    <div class="overflow-hidden rounded-sm border border-slate-200" role="listbox" aria-label="${label}">
                        <div class="grid grid-cols-[minmax(0,1fr)_3.25rem_3.5rem] gap-2 bg-slate-100 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-slate-500">
                            <span>Player</span>
                            <span>Pos</span>
                            <span>Age</span>
                        </div>
                        ${players.map(player => `
                            <button
                                type="button"
                                data-strategy-list-option="${id}"
                                data-strategy-list-value="${strategyEscape(player.id)}"
                                data-strategy-list-label="${strategyEscape(getStrategyProspectLabel(player))}"
                                data-strategy-list-search-text="${strategyEscape(getStrategyProspectLabel(player))}"
                                aria-pressed="${String(player.id) === String(selectedId)}"
                                onclick="window.app_selectStrategyListTarget(this, '${targetType}')"
                                class="grid w-full grid-cols-[minmax(0,1fr)_3.25rem_3.5rem] gap-2 border-t border-slate-100 px-2 py-1.5 text-left text-xs ${String(player.id) === String(selectedId) ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}">
                                <span class="truncate font-semibold">${strategyEscape(player.name || 'Unnamed player')}</span>
                                <span class="text-[10px]">${strategyEscape(String(player.pos || 'ATH').toUpperCase())}</span>
                                <span class="text-[10px]">${Number.isFinite(Number(player.age)) ? `Age ${Number(player.age)}` : '—'}</span>
                            </button>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    };

    const strategyEmphasisPriorityOptions = [
        ['inherit', 'Use broader priorities'],
        ...strategyPriorityOptions
    ];

    const getStrategyEmphasisOptions = side => {
        const isOffense = side === 'offense';

        const playbook = isOffense
            ? offensivePlaybook
            : defensivePlaybook;

        const installedKeys = isOffense
            ? team.gameplan?.installedOffense || []
            : team.gameplan?.installedDefense || [];

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

        const availableKeys = [
            ...new Set([
                ...foundationKeys,
                ...(
                    Array.isArray(installedKeys)
                        ? installedKeys.slice(0, 8)
                        : []
                )
            ])
        ];

        const descriptors = new Map();
        const specificPlays = [];

        const addDescriptor = (rawKey, group) => {
            if (
                typeof rawKey !== 'string' ||
                !rawKey.trim()
            ) {
                return;
            }

            const key = rawKey.trim().toLowerCase();

            if (!descriptors.has(key)) {
                descriptors.set(key, {
                    value: key,
                    groups: new Set()
                });
            }

            descriptors.get(key).groups.add(group);
        };

        availableKeys.forEach(playKey => {
            const play = playbook[playKey];

            if (!play) return;

            addDescriptor(play.type, 'Play Type');
            addDescriptor(play.concept, 'Concept');

            (Array.isArray(play.tags) ? play.tags : [])
                .forEach(tag =>
                    addDescriptor(tag, 'Tags')
                );

            if (play.blitz) {
                addDescriptor('blitz', 'Tags');
            }

            specificPlays.push({
                value: String(playKey).toLowerCase(),
                label: play.name || playKey
            });
        });

        const groups = new Map([
            ['Play Type', []],
            ['Concept', []],
            ['Tags', []],
            ['Specific Plays', specificPlays]
        ]);

        descriptors.forEach(descriptor => {
            descriptor.groups.forEach(group => {
                groups.get(group)?.push({
                    value: descriptor.value,
                    label: descriptor.value
                });
            });
        });

        return [...groups.entries()]
            .filter(([, options]) => options.length > 0)
            .map(([label, options]) => ({
                label,
                options
            }));
    };

    const getStrategyEmphasisMap = (
        department,
        side
    ) => {
        const instructions =
            gmStrategyDepartments[department] || {};

        const mapName = side === 'offense'
            ? 'offenseEmphasis'
            : 'defenseEmphasis';

        return instructions[mapName] || {};
    };

    const renderStrategyEmphasisEditor = (
        department,
        side
    ) => {
        const targetId =
            `strategy-emphasis-target-${department}-${side}`;

        const priorityId =
            `strategy-emphasis-priority-${department}-${side}`;

        const optionGroups = getStrategyEmphasisOptions(side);

        const priorityMap = getStrategyEmphasisMap(
            department,
            side
        );

        const savedTarget = Object.keys(priorityMap).find(key =>
            optionGroups.some(group =>
                group.options.some(option =>
                    option.value === String(key).toLowerCase()
                )
            )
        );

        const hasOptions = optionGroups.length > 0;

        const selectedTargetOption = optionGroups
            .flatMap(group => group.options)
            .find(option =>
                String(option.value) === String(savedTarget || '').toLowerCase()
            );

        const targetOptionsHtml = optionGroups.map(group => `
            <section class="mb-2 last:mb-0">
                <h5 class="px-2 py-1 text-[9px] font-black uppercase tracking-wide text-slate-400">
                    ${strategyEscape(group.label)}
                </h5>
                <div class="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
                    ${group.options.map(option => `
                        <button
                            type="button"
                            data-strategy-target-option="${targetId}"
                            data-strategy-target-value="${strategyEscape(option.value)}"
                            data-strategy-target-label="${strategyEscape(option.label)}"
                            data-strategy-target-search="${strategyEscape(`${group.label} ${option.label}`)}"
                            aria-pressed="${String(option.value) === String(savedTarget || '').toLowerCase()}"
                            onclick="window.app_selectStrategyTargetFromButton(this)"
                            class="rounded-sm px-2 py-1.5 text-left text-[10px] ${String(option.value) === String(savedTarget || '').toLowerCase() ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}">
                            ${strategyEscape(option.label)}
                        </button>
                    `).join('')}
                </div>
            </section>
        `).join('');

        const selectedPriority = savedTarget != null
            ? String(priorityMap[savedTarget] || 'normal')
                .trim()
                .toLowerCase()
            : 'inherit';

        return `
            <div class="space-y-2">
                <div class="relative">
                    <span class="mb-1 block text-[9px] font-bold uppercase tracking-wide text-slate-500">
                        Concept or play
                    </span>
                    <input type="hidden" id="${targetId}" value="${strategyEscape(savedTarget || '')}">
                    <button
                        type="button"
                        id="${targetId}-trigger"
                        aria-expanded="false"
                        aria-controls="${targetId}-popover"
                        onclick="window.app_toggleStrategyTargetPopover('${targetId}')"
                        class="flex w-full items-center justify-between gap-2 rounded border border-slate-300 bg-white px-2 py-1.5 text-left text-[10px] font-semibold text-slate-700 hover:border-slate-500 disabled:opacity-50"
                        ${hasOptions ? '' : 'disabled'}>
                        <span id="${targetId}-label" class="truncate">
                            ${strategyEscape(selectedTargetOption?.label || 'Choose a concept or play...')}
                        </span>
                        <span aria-hidden="true" class="text-slate-400">▾</span>
                    </button>
                    <div
                        id="${targetId}-popover"
                        class="strategy-target-popover absolute left-0 top-full z-30 mt-1 hidden max-h-80 w-full min-w-64 overflow-y-auto rounded border border-slate-300 bg-white p-2 shadow-xl">
                        <input
                            type="search"
                            data-strategy-target-search-input="${targetId}"
                            placeholder="Search concepts and plays..."
                            oninput="window.app_filterStrategyTargets('${targetId}')"
                            class="mb-2 w-full rounded border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-slate-500">
                        <div data-strategy-target-options="${targetId}" role="listbox" aria-label="Choose a concept or play">
                            ${targetOptionsHtml || '<p class="p-2 text-xs text-slate-500">No concepts or plays available.</p>'}
                        </div>
                    </div>
                </div>

                <label class="block">
                    <span class="mb-1 block text-[9px] font-bold uppercase tracking-wide text-slate-500">
                        Priority
                    </span>
                    <input type="hidden" id="${priorityId}" value="${selectedPriority}">
                    <div class="grid grid-cols-3 gap-1" role="group" aria-label="Concept priority">
                        ${strategyEmphasisPriorityOptions.map(([value, label]) => `
                            <button
                                type="button"
                                data-strategy-emphasis-control="${priorityId}"
                                data-strategy-emphasis-value="${value}"
                                aria-pressed="${selectedPriority === value}"
                                ${savedTarget != null ? '' : 'disabled'}
                                title="${label}"
                                onclick="window.app_setStrategyEmphasisPriority('${department}', '${side}', '${value}')"
                                class="rounded-sm border px-1.5 py-1 text-[9px] font-bold disabled:cursor-not-allowed disabled:opacity-40 ${selectedPriority === value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'}">
                                ${value === 'inherit' ? 'Inherit' : label.replace(' priority', '')}
                            </button>
                        `).join('')}
                    </div>
                </label>

                <p
                    id="strategy-emphasis-status-${department}-${side}"
                    class="text-[9px] font-bold text-emerald-700"
                    aria-live="polite">
                </p>
            </div>
        `;
    };

    window.app_toggleStrategyListPicker = targetId => {
        const popover = document.getElementById(`${targetId}-popover`);
        const trigger = document.getElementById(`${targetId}-trigger`);
        if (!popover || !trigger) return;

        const isOpening = popover.classList.contains('hidden');
        document.querySelectorAll('.strategy-list-popover').forEach(panel =>
            panel.classList.add('hidden')
        );
        document.querySelectorAll('[aria-controls$="-popover"]').forEach(button =>
            button.setAttribute('aria-expanded', 'false')
        );

        if (isOpening) {
            popover.classList.remove('hidden');
            trigger.setAttribute('aria-expanded', 'true');
            popover.querySelector('input[type="search"]')?.focus();
        }
    };

    window.app_filterStrategyList = targetId => {
        const query = String(
            document.querySelector(
                `[data-strategy-list-search="${targetId}"]`
            )?.value || ''
        ).trim().toLowerCase();

        document.querySelectorAll(
            `[data-strategy-list-option="${targetId}"]`
        ).forEach(button => {
            button.hidden = !String(
                button.dataset.strategyListSearchText || ''
            ).toLowerCase().includes(query);
        });
    };

    window.app_selectStrategyListTarget = (button, targetType) => {
        const targetId = button?.dataset.strategyListOption;
        const input = targetId
            ? document.getElementById(targetId)
            : null;
        const label = targetId
            ? document.getElementById(`${targetId}-label`)
            : null;
        const value = button?.dataset.strategyListValue;

        if (!input || !label || value == null) return;

        input.value = value;
        label.textContent = button.dataset.strategyListLabel || value;

        document.querySelectorAll(
            `[data-strategy-list-option="${targetId}"]`
        ).forEach(option => {
            const selected = option.dataset.strategyListValue === value;
            option.setAttribute('aria-pressed', String(selected));
            option.className = `block w-full rounded-sm px-2 py-1.5 text-left text-xs ${selected ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`;
        });

        document.getElementById(`${targetId}-popover`)?.classList.add('hidden');
        document.getElementById(`${targetId}-trigger`)?.setAttribute('aria-expanded', 'false');
        window.app_syncTeamStrategyIndividualPriority(targetType);
    };

    window.app_updateStrategyPriorityButtons = (
        controlId,
        value,
        disabled = false
    ) => {
        document.querySelectorAll(
            `[data-strategy-priority-control="${controlId}"]`
        ).forEach(button => {
            const selected =
                button.dataset.strategyPriorityValue === value;

            button.disabled = disabled;
            button.setAttribute('aria-pressed', String(selected));
            button.className = `rounded-sm border px-1.5 py-1 text-[9px] font-bold disabled:cursor-not-allowed disabled:opacity-40 ${selected ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'}`;
        });
    };

    window.app_setStrategyIndividualPriorityChoice = (
        controlId,
        department,
        value
    ) => {
        const input = document.getElementById(controlId);
        if (!input) return;

        input.value = value;
        window.app_setTeamStrategyIndividualPriority(
            department,
            value
        );
        window.app_updateStrategyPriorityButtons(controlId, value);
    };

    window.app_syncTeamStrategyIndividualPriority = targetType => {
        const gs = getGameState();
        const currentTeam = gs?.playerTeam;

        if (!currentTeam?.teamInstructions) return;

        if (targetType === 'prospect') {
            const targetId = document.getElementById(
                'strategy-prospect-target'
            )?.value;

            for (const department of [
                'recruiting',
                'scouting'
            ]) {
                const prioritySelect = document.getElementById(
                    `strategy-prospect-priority-${department}`
                );

                if (!prioritySelect) continue;

                const map =
                    currentTeam.teamInstructions
                        .departments?.[department]
                        ?.prospectPriorities || {};

                const value = String(
                    map[String(targetId)] || 'inherit'
                ).toLowerCase();

                prioritySelect.value =
                    strategyIndividualPriorityOptions.some(
                        ([key]) => key === value
                    )
                        ? value
                        : 'inherit';
                window.app_updateStrategyPriorityButtons(
                    prioritySelect.id,
                    prioritySelect.value,
                    !targetId
                );
            }
        } else if (targetType === 'player') {
            const targetId = document.getElementById(
                'strategy-player-target'
            )?.value;

            const prioritySelect = document.getElementById(
                'strategy-player-priority'
            );

            const map =
                currentTeam.teamInstructions
                    .departments?.development
                    ?.playerPriorities || {};

            const value = String(
                map[String(targetId)] || 'inherit'
            ).toLowerCase();

            if (prioritySelect) {
                prioritySelect.value =
                    strategyIndividualPriorityOptions.some(
                        ([key]) => key === value
                    )
                        ? value
                        : 'inherit';
                window.app_updateStrategyPriorityButtons(
                    prioritySelect.id,
                    prioritySelect.value,
                    !targetId
                );
            }
        }
    };

        window.app_syncTeamStrategyEmphasis = (
        department,
        side
    ) => {
        const gs = getGameState();
        const currentTeam = gs?.playerTeam;

        if (!currentTeam?.teamInstructions) return;

        if (
            !['practice', 'gameplan'].includes(department) ||
            !['offense', 'defense'].includes(side)
        ) {
            return;
        }

        const target = document.getElementById(
            `strategy-emphasis-target-${department}-${side}`
        );

        const priority = document.getElementById(
            `strategy-emphasis-priority-${department}-${side}`
        );

        if (!target || !priority) return;

        const mapName = side === 'offense'
            ? 'offenseEmphasis'
            : 'defenseEmphasis';

        const map =
            currentTeam.teamInstructions
                .departments?.[department]?.[mapName] || {};

        const value = target.value
            ? String(map[target.value] || 'inherit').toLowerCase()
            : 'inherit';

        priority.value =
            strategyEmphasisPriorityOptions.some(
                ([key]) => key === value
            )
                ? value
                : 'inherit';

        priority.disabled = !target.value;
        window.app_updateStrategyEmphasisButtons(
            priority.id,
            priority.value,
            priority.disabled
        );

        const status = document.getElementById(
            `strategy-emphasis-status-${department}-${side}`
        );

        if (status) status.textContent = '';
    };

    window.app_toggleStrategyTargetPopover = targetId => {
        const popover = document.getElementById(
            `${targetId}-popover`
        );
        const trigger = document.getElementById(
            `${targetId}-trigger`
        );
        if (!popover || !trigger) return;

        const isOpening = popover.classList.contains('hidden');
        document.querySelectorAll('.strategy-target-popover').forEach(panel =>
            panel.classList.add('hidden')
        );
        document.querySelectorAll('[aria-controls$="-popover"]').forEach(button =>
            button.setAttribute('aria-expanded', 'false')
        );

        if (isOpening) {
            popover.classList.remove('hidden');
            trigger.setAttribute('aria-expanded', 'true');
            popover.querySelector('input[type="search"]')?.focus();
        }
    };

    window.app_filterStrategyTargets = targetId => {
        const query = String(
            document.querySelector(
                `[data-strategy-target-search-input="${targetId}"]`
            )?.value || ''
        ).trim().toLowerCase();

        document.querySelectorAll(
            `[data-strategy-target-option="${targetId}"]`
        ).forEach(button => {
            button.hidden = !String(
                button.dataset.strategyTargetSearch || ''
            ).toLowerCase().includes(query);
        });
    };

    window.app_selectStrategyTargetFromButton = button => {
        const targetId = button?.dataset.strategyTargetOption;
        if (!targetId) return;

        const target = document.getElementById(targetId);
        const label = document.getElementById(`${targetId}-label`);
        const value = button.dataset.strategyTargetValue || '';

        if (!target || !label) return;

        target.value = value;
        label.textContent = button.dataset.strategyTargetLabel || value;

        document.querySelectorAll(
            `[data-strategy-target-option="${targetId}"]`
        ).forEach(option => {
            const selected =
                option.dataset.strategyTargetValue === value;
            option.setAttribute('aria-pressed', String(selected));
            option.classList.toggle('bg-slate-900', selected);
            option.classList.toggle('text-white', selected);
        });

        document.getElementById(`${targetId}-popover`)?.classList.add('hidden');
        document.getElementById(`${targetId}-trigger`)?.setAttribute('aria-expanded', 'false');

        const [, department, side] = targetId.match(
            /^strategy-emphasis-target-(practice|gameplan)-(offense|defense)$/
        ) || [];

        if (department && side) {
            window.app_syncTeamStrategyEmphasis(department, side);
        }
    };

    window.app_updateStrategyEmphasisButtons = (
        controlId,
        value,
        disabled = false
    ) => {
        document.querySelectorAll(
            `[data-strategy-emphasis-control="${controlId}"]`
        ).forEach(button => {
            const selected =
                button.dataset.strategyEmphasisValue === value;

            button.disabled = disabled;
            button.setAttribute('aria-pressed', String(selected));
            button.className = `rounded-sm border px-1.5 py-1 text-[9px] font-bold disabled:cursor-not-allowed disabled:opacity-40 ${selected ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'}`;
        });
    };

    window.app_setStrategyEmphasisPriority = (
        department,
        side,
        value
    ) => {
        const priority = document.getElementById(
            `strategy-emphasis-priority-${department}-${side}`
        );
        if (!priority || priority.disabled) return;

        priority.value = value;
        window.app_setTeamStrategyEmphasis(department, side, value);
        window.app_updateStrategyEmphasisButtons(
            priority.id,
            value
        );
    };

    window.app_setTeamStrategyEmphasis = (
        department,
        side,
        value
    ) => {
        const gs = getGameState();
        const currentTeam = gs?.playerTeam;

        if (!currentTeam) return;

        Game.ensureTeamStaffWorkPlan?.(currentTeam);

        if (
            !['practice', 'gameplan'].includes(department) ||
            !['offense', 'defense'].includes(side) ||
            !strategyEmphasisPriorityOptions.some(
                ([key]) => key === value
            )
        ) {
            return;
        }

        const target = document.getElementById(
            `strategy-emphasis-target-${department}-${side}`
        );

        const targetKey = String(target?.value || '')
            .trim()
            .toLowerCase();

        if (!targetKey) return;

        const departmentInstructions =
            currentTeam.teamInstructions?.departments?.[department];

        if (!departmentInstructions) return;

        const mapName = side === 'offense'
            ? 'offenseEmphasis'
            : 'defenseEmphasis';

        if (
            !departmentInstructions[mapName] ||
            typeof departmentInstructions[mapName] !== 'object' ||
            Array.isArray(departmentInstructions[mapName])
        ) {
            departmentInstructions[mapName] = {};
        }

        const priorityMap =
            departmentInstructions[mapName];

        if (value === 'inherit') {
            delete priorityMap[targetKey];
        } else {
            priorityMap[targetKey] = value;
        }

        saveGameState();

        const status = document.getElementById(
            `strategy-emphasis-status-${department}-${side}`
        );

        if (status) status.textContent = 'Saved';
    };

    window.app_setTeamStrategyIndividualPriority = (
        department,
        value
    ) => {
        const gs = getGameState();
        const currentTeam = gs?.playerTeam;

        if (!currentTeam) return;

        Game.ensureTeamStaffWorkPlan?.(currentTeam);

        const allowedDepartments = [
            'recruiting',
            'scouting',
            'development'
        ];

        const allowedValues =
            strategyIndividualPriorityOptions.map(
                ([key]) => key
            );

        if (
            !allowedDepartments.includes(department) ||
            !allowedValues.includes(value)
        ) {
            return;
        }

        const isDevelopment = department === 'development';

        const targetId = document.getElementById(
            isDevelopment
                ? 'strategy-player-target'
                : 'strategy-prospect-target'
        )?.value;

        if (!targetId) return;

        const departmentInstructions =
            currentTeam.teamInstructions?.departments?.[department];

        if (!departmentInstructions) return;

        const mapName = isDevelopment
            ? 'playerPriorities'
            : 'prospectPriorities';

        if (
            !departmentInstructions[mapName] ||
            typeof departmentInstructions[mapName] !== 'object' ||
            Array.isArray(departmentInstructions[mapName])
        ) {
            departmentInstructions[mapName] = {};
        }

        const priorityMap =
            departmentInstructions[mapName];

        if (value === 'inherit') {
            delete priorityMap[String(targetId)];
        } else {
            priorityMap[String(targetId)] = value;
        }

        saveGameState();

        const priorityControlId = isDevelopment
            ? 'strategy-player-priority'
            : `strategy-prospect-priority-${department}`;
        const priorityControl = document.getElementById(priorityControlId);

        if (priorityControl) {
            priorityControl.value = value;
            window.app_updateStrategyPriorityButtons(
                priorityControlId,
                value
            );
        }

        const statusId = isDevelopment
            ? 'strategy-player-priority-status'
            : 'strategy-prospect-priority-status';

        const statusElement = document.getElementById(statusId);

        if (statusElement) {
            statusElement.textContent = 'Saved';
        }
    };

    window.app_setTeamStrategySetting = (
        department,
        setting,
        position,
        value
    ) => {
        const gs = getGameState();
        const currentTeam = gs?.playerTeam;

        if (!currentTeam) return;

        Game.ensureTeamStaffWorkPlan?.(currentTeam);

        const instructions = currentTeam.teamInstructions;

        if (!instructions || typeof instructions !== 'object') {
            return;
        }

        const autonomyValues = strategyAutonomyOptions.map(
            ([key]) => key
        );

        const priorityValues = strategyPriorityOptions.map(
            ([key]) => key
        );

        if (setting === 'staffAutonomy') {
            if (!autonomyValues.includes(value)) return;

            instructions.autonomy = value;
        } else {
            const allowedDepartments = [
                'recruiting',
                'scouting',
                'development',
                'practice',
                'gameplan'
            ];

            if (!allowedDepartments.includes(department)) return;

            const departmentInstructions =
                instructions.departments?.[department];

            if (
                !departmentInstructions ||
                typeof departmentInstructions !== 'object'
            ) {
                return;
            }

            if (setting === 'autonomy') {
                if (
                    !['recruiting', 'practice', 'gameplan'].includes(
                        department
                    ) ||
                    !autonomyValues.includes(value)
                ) {
                    return;
                }

                departmentInstructions.autonomy = value;
            } else if (setting === 'positionPriority') {
                if (
                    !['recruiting', 'scouting', 'development'].includes(
                        department
                    ) ||
                    !strategyPositions.includes(position) ||
                    !priorityValues.includes(value)
                ) {
                    return;
                }

                if (
                    !departmentInstructions.positionPriorities ||
                    typeof departmentInstructions.positionPriorities !== 'object'
                ) {
                    departmentInstructions.positionPriorities = {};
                }

                departmentInstructions.positionPriorities[position] = value;
            } else {
                return;
            }
        }

        saveGameState();
        renderStaffTab(gs);
    };

    window.app_setTeamStaffAutonomy = value => {
        window.app_setTeamStrategySetting(
            'staff',
            'staffAutonomy',
            '',
            value
        );
    };

    window.app_toggleStrategyPriorityMenu = menuId => {
        const menu = document.getElementById(menuId);
        const trigger = document.getElementById(`${menuId}-trigger`);
        if (!menu || !trigger) return;

        const isOpening = menu.classList.contains('hidden');

        document.querySelectorAll('[data-strategy-priority-popover]').forEach(
            panel => panel.classList.add('hidden')
        );
        document.querySelectorAll('[id^="strategy-priority-menu-"][id$="-trigger"]').forEach(
            button => button.setAttribute('aria-expanded', 'false')
        );

        if (isOpening) {
            menu.classList.remove('hidden');
            trigger.setAttribute('aria-expanded', 'true');
        }
    };

    let activeStaffHubTab =
        container.querySelector(
            '.staff-hub-tab-btn.bg-slate-900'
        )?.dataset.staffTab || 'overview';

    window.app_switchStaffTab = tab => {
        const allowedTabs = [
            'overview',
            'strategy',
            'workload',
            'history'
        ];

        if (!allowedTabs.includes(tab)) return;

        activeStaffHubTab = tab;

        container.querySelectorAll('.staff-hub-tab-btn').forEach(button => {
            const active = button.dataset.staffTab === tab;

            button.className =
                `staff-hub-tab-btn flex-1 rounded px-3 py-2 text-xs font-bold uppercase tracking-wide transition ${
                    active
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-800'
                }`;
        });

        container.querySelectorAll('.staff-hub-pane').forEach(pane => {
            pane.classList.toggle(
                'hidden',
                pane.dataset.staffPane !== tab
            );
        });

        container.querySelector('#staff-hub-automation')?.classList.toggle(
            'hidden',
            tab !== 'workload'
        );
    };

    html += `
        <nav class="mb-3 flex gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1"
            aria-label="Staff management sections">

            <button
                type="button"
                class="staff-hub-tab-btn flex-1 rounded bg-slate-900 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white shadow-sm"
                data-staff-tab="overview"
                onclick="app_switchStaffTab('overview')">
                Overview
            </button>

            <button
                type="button"
                class="staff-hub-tab-btn flex-1 rounded px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500"
                data-staff-tab="strategy"
                onclick="app_switchStaffTab('strategy')">
                Strategy
            </button>

            <button
                type="button"
                class="staff-hub-tab-btn flex-1 rounded px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500"
                data-staff-tab="workload"
                onclick="app_switchStaffTab('workload')">
                Workload
            </button>

            <button
                type="button"
                class="staff-hub-tab-btn flex-1 rounded px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500"
                data-staff-tab="history"
                onclick="app_switchStaffTab('history')">
                History
            </button>
        </nav>
        <div
            class="staff-hub-pane hidden"
            data-staff-pane="strategy">

            <!-- 1. MANAGEMENT PRESETS -->
            <section class="mb-3 rounded border border-slate-200 bg-white p-3 shadow-sm">
                <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div>
                        <h4 class="text-[11px] font-black uppercase tracking-wide text-slate-900">
                            Management Style Presets
                        </h4>
                        <p class="text-[10px] text-slate-500">
                            One-click configurations to set how much you delegate to your staff.
                        </p>
                    </div>
                    <span class="rounded bg-slate-100 border border-slate-200 px-2 py-0.5 text-[9px] font-mono font-bold uppercase text-slate-600">
                        Active: ${(team.teamInstructions?.experiencePreset || 'casual_gm').replace(/_/g, ' ').toUpperCase()}
                    </span>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <button type="button"
                        onclick="window.app_setManagementPreset('casual_gm')"
                        class="p-2.5 rounded border text-left transition ${team.teamInstructions?.experiencePreset === 'casual_gm' ? 'border-amber-500 bg-amber-50/60 ring-1 ring-amber-500/40' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'}">
                        <div class="font-black text-xs text-slate-900">Casual GM</div>
                        <p class="text-[10px] text-slate-600 mt-1">Guided staff, automated routine tasks, auto-offers on top targets.</p>
                    </button>

                    <button type="button"
                        onclick="window.app_setManagementPreset('hands_on_gm')"
                        class="p-2.5 rounded border text-left transition ${team.teamInstructions?.experiencePreset === 'hands_on_gm' ? 'border-blue-500 bg-blue-50/60 ring-1 ring-blue-500/40' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'}">
                        <div class="font-black text-xs text-slate-900">Hands-On GM</div>
                        <p class="text-[10px] text-slate-600 mt-1">Direct control over playbooks, practice, and manual recruiting offers.</p>
                    </button>

                    <button type="button"
                        onclick="window.app_setManagementPreset('director_of_football_operations')"
                        class="p-2.5 rounded border text-left transition ${team.teamInstructions?.experiencePreset === 'director_of_football_operations' ? 'border-emerald-500 bg-emerald-50/60 ring-1 ring-emerald-500/40' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'}">
                        <div class="font-black text-xs text-slate-900">Director of Ops</div>
                        <p class="text-[10px] text-slate-600 mt-1">Full delegation of coaching duties; focus on staff, finances, and roster strategy.</p>
                    </button>
                </div>
            </section>

            <!-- 2. PROGRAM DIRECTION (ROSTER-LED IDENTITY) -->
            <section class="mb-3 rounded border border-slate-200 bg-white p-3 shadow-sm">
                <div class="mb-2">
                    <h4 class="text-[11px] font-black uppercase tracking-wide text-slate-900">
                        Program Direction (Team Identity)
                    </h4>
                    <p class="text-[10px] text-slate-500">
                        Guides scouting and recruiting priorities without locking your coaches into a rigid playbook scheme.
                    </p>
                </div>

                <div class="grid grid-cols-2 sm:grid-cols-5 gap-1.5" role="group" aria-label="Program Direction">
                    ${[
                        ['balanced', 'Balanced', 'Even development across all positions'],
                        ['physicality', 'Physicality', 'Power, trench dominance & strength'],
                        ['speed_and_space', 'Speed & Space', 'Playmakers, twitch & perimeter speed'],
                        ['versatility', 'Versatility', 'Two-way ironmen & multi-role athletes'],
                        ['defensive_pressure', 'Pressure', 'Aggressive front-7 & turnover hunting']
                    ].map(([key, label, desc]) => {
                        const active = (team.teamInstructions?.programDirection || 'balanced') === key;
                        return `
                            <button type="button"
                                aria-pressed="${active}"
                                onclick="window.app_setProgramDirection('${key}')"
                                class="p-2 rounded border text-left transition ${active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'}">
                                <span class="block text-xs font-bold leading-tight">${label}</span>
                                <span class="block text-[9px] mt-0.5 opacity-70 leading-snug">${desc}</span>
                            </button>
                        `;
                    }).join('')}
                </div>
            </section>

            <!-- 3. RECRUITING POLICY LIMITS (GIFT CEILING & AUTO-OFFER) -->
            <section class="mb-3 rounded border border-slate-200 bg-white p-3 shadow-sm">
                <h4 class="text-[11px] font-black uppercase tracking-wide text-slate-900 mb-2">
                    Recruiting Automation & Spending Limits
                </h4>
                
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <!-- Auto-Offer Policy -->
                    <div class="bg-slate-50 p-2.5 rounded border border-slate-200">
                        <div class="flex items-center justify-between mb-1.5">
                            <span class="text-xs font-bold text-slate-800">Automatic Roster Offers</span>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox"
                                    ${team.teamInstructions?.departments?.recruiting?.automaticOfferPolicy?.enabled ? 'checked' : ''}
                                    onchange="window.app_setRecruitingAutoPolicy('offerEnabled', this.checked)"
                                    class="h-4 w-4 accent-emerald-600">
                            </label>
                        </div>
                        <p class="text-[10px] text-slate-500 mb-2">
                            Allows staff to extend offers to high-priority targets when interest threshold is met.
                        </p>
                        <div class="flex items-center gap-2">
                            <span class="text-[10px] font-bold text-slate-600">Minimum Interest:</span>
                            <input type="number" min="15" max="90" step="5"
                                value="${team.teamInstructions?.departments?.recruiting?.automaticOfferPolicy?.minimumInterest ?? 25}"
                                onchange="window.app_setRecruitingAutoPolicy('offerThreshold', this.value)"
                                class="w-16 p-1 text-xs border border-slate-300 rounded font-bold text-center bg-white">
                            <span class="text-[10px] text-slate-400">/ 100</span>
                        </div>
                    </div>

                    <!-- Gift Spending Ceiling -->
                    <div class="bg-slate-50 p-2.5 rounded border border-slate-200">
                        <div class="flex items-center justify-between mb-1.5">
                            <span class="text-xs font-bold text-slate-800">Recruiting Gift Spending Cap</span>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox"
                                    ${team.teamInstructions?.departments?.recruiting?.giftSpendingPolicy?.allowGifts !== false ? 'checked' : ''}
                                    onchange="window.app_setRecruitingAutoPolicy('allowGifts', this.checked)"
                                    class="h-4 w-4 accent-emerald-600">
                            </label>
                        </div>
                        <p class="text-[10px] text-slate-500 mb-2">
                            Maximum team cash automated coaches can spend on gifts per recruit.
                        </p>
                        <div class="flex items-center gap-2">
                            <span class="text-[10px] font-bold text-slate-600">Max Gift / Recruit: $</span>
                            <input type="number" min="0" max="35" step="1"
                                value="${team.teamInstructions?.departments?.recruiting?.giftSpendingPolicy?.maxGiftPerRecruit ?? 10}"
                                onchange="window.app_setRecruitingAutoPolicy('maxGift', this.value)"
                                class="w-16 p-1 text-xs border border-slate-300 rounded font-bold text-center bg-white">
                        </div>
                    </div>
                </div>
            </section>

            <section class="mb-3 rounded border border-slate-200 bg-white p-3">
                <div class="mb-2">
                    <h4 class="text-[11px] font-black uppercase tracking-wide text-slate-800">
                        Overall Staff Delegation
                    </h4>
                    <p class="mt-1 text-[10px] text-slate-500">
                        Controls how much responsibility the staff receives
                        when the workload is automatically assigned.
                    </p>
                </div>

                <div class="block max-w-sm">
                    <span class="mb-1 block text-[9px] font-bold uppercase tracking-wide text-slate-500">
                        Staff operating mode
                    </span>
                    <div class="flex rounded border border-slate-300 bg-white p-0.5" role="group" aria-label="Overall staff operating mode">
                        ${strategyAutonomyOptions.map(([value, label]) => `
                            <button
                                type="button"
                                aria-pressed="${getStrategyAutonomy('staff') === value}"
                                onclick="app_setTeamStaffAutonomy('${value}')"
                                class="flex-1 rounded-sm px-2 py-1.5 text-[10px] font-bold ${getStrategyAutonomy('staff') === value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}">
                                ${label}
                            </button>
                        `).join('')}
                    </div>
                </div>

                <div class="mt-2 grid grid-cols-1 gap-1 text-[10px] text-slate-600 sm:grid-cols-3">
                    <p><b>Delegate:</b> Staff has more discretion.</p>
                    <p><b>Guided:</b> Staff follows GM priorities closely.</p>
                    <p><b>Direct:</b> Keep execution in your hands where supported.</p>
                </div>
            </section>

            <div class="space-y-3">
                ${strategyDepartmentCards.map(department => `
                    <section class="rounded border border-slate-200 bg-white p-3">
                        <div class="mb-3">
                            <h4 class="text-[11px] font-black uppercase tracking-wide text-slate-800">
                                ${department.label}
                            </h4>
                            <p class="mt-1 text-[10px] leading-relaxed text-slate-500">
                                ${department.description}
                            </p>
                        </div>

                        ${department.autonomy ? `
                            <div class="mb-3 max-w-sm">
                                ${renderStrategyAutonomyControl(department.key)}
                            </div>
                        ` : ''}

                        ${department.positions ? `
                            <div class="border-t border-slate-100 pt-3">
                                <h5 class="mb-2 text-[9px] font-black uppercase tracking-wide text-slate-500">
                                    Position Priorities
                                </h5>
                                ${renderStrategyPositionControls(department.key)}
                            </div>
                        ` : ''}

                        ${['practice', 'gameplan'].includes(department.key) ? `
                            <div class="border-t border-slate-100 pt-3">
                                <h5 class="mb-2 text-[9px] font-black uppercase tracking-wide text-slate-500">
                                    Offensive Emphasis
                                </h5>
                                ${renderStrategyEmphasisEditor(
                                    department.key,
                                    'offense'
                                )}
                            </div>

                            <div class="mt-3 border-t border-slate-100 pt-3">
                                <h5 class="mb-2 text-[9px] font-black uppercase tracking-wide text-slate-500">
                                    Defensive Emphasis
                                </h5>
                                ${renderStrategyEmphasisEditor(
                                    department.key,
                                    'defense'
                                )}
                            </div>
                        ` : ''}
                    </section>
                `).join('')}
            </div>

                        <section class="mt-3 rounded border border-slate-200 bg-white p-3">
                <h4 class="text-[11px] font-black uppercase tracking-wide text-slate-800">
                    Individual Prospect Priorities
                </h4>
                <p class="mt-1 mb-3 text-[10px] leading-relaxed text-slate-500">
                    Override position priorities for specific players.
                    Recruiting and scouting can have different instructions
                    for the same prospect.
                </p>

                ${strategyProspects.length > 0 ? `
                    <div class="space-y-3">
                        <label class="block">
                            <span class="mb-1 block text-[9px] font-bold uppercase tracking-wide text-slate-500">
                                Select prospect
                            </span>
                            ${renderStrategyTargetPicker(
                                'strategy-prospect-target',
                                strategyProspects,
                                strategyInitialProspectId,
                                'prospect',
                                'Select prospect'
                            )}
                        </label>

                        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <label class="block">
                                <span class="mb-1 block text-[9px] font-black uppercase tracking-wide text-slate-500">
                                    Recruiting priority
                                </span>
                                ${renderStrategyIndividualPrioritySelect(
                                    'strategy-prospect-priority-recruiting',
                                    'recruiting',
                                    strategyInitialProspectId,
                                    'prospectPriorities'
                                )}
                            </label>

                            <label class="block">
                                <span class="mb-1 block text-[9px] font-black uppercase tracking-wide text-slate-500">
                                    Scouting priority
                                </span>
                                ${renderStrategyIndividualPrioritySelect(
                                    'strategy-prospect-priority-scouting',
                                    'scouting',
                                    strategyInitialProspectId,
                                    'prospectPriorities'
                                )}
                            </label>
                        </div>

                        <p
                            id="strategy-prospect-priority-status"
                            class="text-[9px] font-bold text-emerald-700"
                            aria-live="polite">
                        </p>
                    </div>
                ` : `
                    <p class="text-[10px] italic text-slate-500">
                        No external prospects are currently available.
                    </p>
                `}
            </section>

            <section class="mt-3 rounded border border-slate-200 bg-white p-3">
                <h4 class="text-[11px] font-black uppercase tracking-wide text-slate-800">
                    Individual Development Priorities
                </h4>
                <p class="mt-1 mb-3 text-[10px] leading-relaxed text-slate-500">
                    Give specific players development priority over the
                    default position-group setting.
                </p>

                ${strategyRosterPlayers.length > 0 ? `
                    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label class="block">
                            <span class="mb-1 block text-[9px] font-bold uppercase tracking-wide text-slate-500">
                                Select player
                            </span>
                            ${renderStrategyTargetPicker(
                                'strategy-player-target',
                                strategyRosterPlayers,
                                strategyInitialPlayerId,
                                'player',
                                'Select player'
                            )}
                        </label>

                        <label class="block">
                            <span class="mb-1 block text-[9px] font-bold uppercase tracking-wide text-slate-500">
                                Development priority
                            </span>
                            ${renderStrategyIndividualPrioritySelect(
                                'strategy-player-priority',
                                'development',
                                strategyInitialPlayerId,
                                'playerPriorities'
                            )}
                        </label>
                    </div>

                    <p
                        id="strategy-player-priority-status"
                        class="mt-2 text-[9px] font-bold text-emerald-700"
                        aria-live="polite">
                    </p>
                ` : `
                    <p class="text-[10px] italic text-slate-500">
                        No roster players are currently available.
                    </p>
                `}
            </section>

            <p class="mt-3 text-[10px] text-slate-500">
                Changes are saved immediately. You can still override
                individual staff assignments in the Workload tab.
            </p>
        </div>

        <div
            class="staff-hub-pane"
            data-staff-pane="overview">

    `;

    // Compact coaching overview. Detailed information lives in coach cards.
    const overviewEscape = value =>
        String(value ?? '').replace(/[&<>"']/g, character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[character]);

    const overviewSkillAverage = values => {
        const valid = values.filter(value => value !== null);

        return valid.length
            ? Math.round(
                valid.reduce((sum, value) => sum + value, 0) /
                valid.length
            )
            : null;
    };

    const overviewCoaches = currentCoaches.map(coach => {
        const ratings = coach.ratings || {};

        const readSkill = key => {
            const value = Number(ratings[key]);

            return Number.isFinite(value)
                ? Math.max(0, Math.min(100, value))
                : null;
        };

        const skillAverage = values => {
            const valid = values.filter(value => value !== null);

            return valid.length
                ? Math.round(
                    valid.reduce((sum, value) => sum + value, 0) /
                    valid.length
                )
                : null;
        };

        const specialties = [
            {
                name: 'Offense',
                value: readSkill('offSchemeMastery')
            },
            {
                name: 'Defense',
                value: readSkill('defSchemeMastery')
            },
            {
                name: 'Scouting',
                value: skillAverage([
                    readSkill('evalPhysicals'),
                    readSkill('evalTechnique'),
                    readSkill('evalCharacter')
                ])
            },
            {
                name: 'Teaching',
                value: readSkill('teaching')
            },
            {
                name: 'Game Planning',
                value: skillAverage([
                    readSkill('gameplanInstinct'),
                    readSkill('inGameAdjustments')
                ])
            },
            {
                name: 'Practice',
                value: skillAverage([
                    readSkill('practiceDiscipline'),
                    readSkill('conditioning')
                ])
            }
        ];

        const overall = skillAverage(
            specialties.map(item => item.value)
        );

        const coachId = String(coach.id ?? '').replace(
            /\\/g,
            '\\\\'
        ).replace(/'/g, "\\'");

        const isHeadCoach = [
            team.coach,
            team.staff?.coach
        ].some(member =>
            member?.id != null &&
            String(member.id) === String(coach.id)
        );

        const isScout =
            String(team.staff?.scout?.id ?? '') ===
            String(coach.id);

        const isTrainer =
            String(team.staff?.trainer?.id ?? '') ===
            String(coach.id);

        const role = coach.isUserCoach
            ? 'GM / Your Coaching Profile'
            : isHeadCoach
                ? 'Head Coach'
                : isScout
                    ? 'Assistant · Scouting'
                    : isTrainer
                        ? 'Assistant · Training'
                        : 'Assistant Coach';

        const workload = developmentRows.find(
            row => String(row.id) === String(coach.id)
        )?.assignedHours ?? 0;

        const availableHours = Number(
            coach.availability?.weeklyHours
        );

        const relevantSkills = coach.isUserCoach
            ? specialties.map(item => ({
                name: item.name,
                value: item.value
            }))
            : isHeadCoach
                ? [
                    { name: 'Offense', value: readSkill('offSchemeMastery') },
                    { name: 'Defense', value: readSkill('defSchemeMastery') },
                    { name: 'Game Planning', value: readSkill('gameplanInstinct') },
                    { name: 'Adjustments', value: readSkill('inGameAdjustments') }
                ]
                : isScout
                    ? [
                        { name: 'Physicals', value: readSkill('evalPhysicals') },
                        { name: 'Technique', value: readSkill('evalTechnique') },
                        { name: 'Character', value: readSkill('evalCharacter') }
                    ]
                    : isTrainer
                        ? [
                            { name: 'Teaching', value: readSkill('teaching') },
                            { name: 'Discipline', value: readSkill('practiceDiscipline') },
                            { name: 'Conditioning', value: readSkill('conditioning') }
                        ]
                        : specialties.map(item => ({
                            name: item.name,
                            value: item.value
                        }));

        const rankedSkills = relevantSkills
            .filter(item => item.value !== null)
            .sort((a, b) => b.value - a.value);

        const strongest = rankedSkills[0] || null;
        const weakest = rankedSkills[rankedSkills.length - 1] || null;

        const strengthsSummary = rankedSkills
            .slice(0, 2)
            .map(item => `${item.name} ${Math.round(item.value)}`)
            .join(' · ') || 'Ratings unavailable';

        const lowestSkillSummary = weakest
            ? `${weakest.name} ${Math.round(weakest.value)}`
            : 'Unavailable';

        const personalityProfile = coach.biases?.personality;

        const roleStyleProfile =
            isHeadCoach || coach.isUserCoach
                ? coach.biases?.tactical
                : isScout
                    ? coach.biases?.scouting
                    : null;

        const styleSummary = [
            personalityProfile?.displayName || personalityProfile?.name,
            roleStyleProfile?.displayName || roleStyleProfile?.name
        ].filter(Boolean).join(' · ') || 'Style not recorded';

        const availability = Number.isFinite(availableHours)
            ? `${Math.max(0, Math.min(40, Math.floor(availableHours)))} hrs available`
            : 'Availability not set';

        const ratingsSummary = [
            strongest
                ? `${strongest.name} ${Math.round(strongest.value)}`
                : 'Ratings unavailable',
            `Workload ${workload} hrs`,
            availability
        ];

        return {
            coach,
            coachId,
            role,
            overall,
            ratingsSummary,
            strengthsSummary,
            lowestSkillSummary,
            styleSummary,
            workload,
            availability
        };
    });

    const npcCoachCount = overviewCoaches.filter(
        entry => !entry.coach.isUserCoach
    ).length;

    const overviewAverage = overviewSkillAverage(
        overviewCoaches
            .filter(entry => !entry.coach.isUserCoach)
            .map(entry => entry.overall)
    );

    // Build the history overview from each active coach's recorded career.
    // This is presentation-only; no additional data is saved.
    const staffCareerHistoryHtml = overviewCoaches.map(entry => {
        const history = Array.isArray(entry.coach.careerHistory)
            ? [...entry.coach.careerHistory]
                .filter(record => record && typeof record === 'object')
                .sort((a, b) =>
                    (Number(b.year) || 0) - (Number(a.year) || 0)
                )
            : [];

        const historyRows = history.map(record => {
            const wins = Math.max(0, Number(record.wins) || 0);
            const losses = Math.max(0, Number(record.losses) || 0);
            const ties = Math.max(0, Number(record.ties) || 0);

            const milestones = Array.isArray(record.milestones)
                ? [...new Set(record.milestones)]
                    .filter(value => typeof value === 'string' && value.trim())
                    .map(value => overviewEscape(value))
                    .join(' · ')
                : '';

            const columns = [
                {
                    label: 'Year',
                    value: `Year ${overviewEscape(record.year ?? '—')}`
                },
                {
                    label: 'Team',
                    value: overviewEscape(record.teamName || 'Unknown Team')
                },
                {
                    label: 'Record',
                    value: `${wins}-${losses}-${ties}`
                },
                {
                    label: 'Position',
                    value: overviewEscape(record.role || 'Coaching Staff')
                },
                {
                    label: 'League',
                    value: [
                        record.tier != null
                            ? `Tier ${overviewEscape(record.tier)}`
                            : '',
                        record.leagueType
                            ? overviewEscape(record.leagueType)
                            : ''
                    ].filter(Boolean).join(' · ') || '—'
                }
            ];

            return `
                <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">

                    <div class="grid grid-cols-[0.7fr_1.35fr_0.8fr_1.65fr_1.1fr] items-center gap-3">

                        ${columns.map((column, index) => `
                            <div class="min-w-0 ${index === 2 ? 'text-center' : ''}">
                                <div class="mb-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                                    ${column.label}
                                </div>

                                <div class="text-xs font-bold ${
                                    index === 2
                                        ? 'font-mono text-slate-900'
                                        : 'text-slate-700'
                                } break-words">
                                    ${column.value}
                                </div>
                            </div>
                        `).join('')}

                    </div>

                    ${milestones
                        ? `
                            <div class="mt-2 border-t border-slate-200 pt-2 text-[10px] font-semibold text-amber-800">
                                ${milestones}
                            </div>
                        `
                        : ''}

                </div>
            `;
        }).join('');

        return `
            <section class="rounded-lg border border-slate-200 bg-white p-3">
                <div class="flex items-center justify-between gap-2 mb-3">
                    <div class="min-w-0">
                        <h5 class="text-sm font-black text-slate-900">
                            ${overviewEscape(entry.coach.name || 'Unnamed Coach')}
                        </h5>
                        <p class="text-[10px] text-slate-500">
                            ${overviewEscape(entry.role)}
                            · ${history.length} recorded season${history.length === 1 ? '' : 's'}
                        </p>
                    </div>

                    <button
                        type="button"
                        class="shrink-0 rounded border border-slate-200 px-2 py-1 text-[10px] font-bold text-blue-700 hover:bg-blue-50"
                        onclick="app.openCoachCard('${entry.coachId}')">
                        View Profile
                    </button>
                </div>

                ${historyRows
                    ? `<div class="space-y-2">${historyRows}</div>`
                    : `
                        <p class="rounded border border-dashed border-slate-300 bg-slate-50 p-3 text-center text-[10px] text-slate-500">
                            No recorded seasons yet. Career history will accumulate as seasons are completed.
                        </p>
                    `}
            </section>
        `;
    }).join('');

        // Include unemployed coaches with recorded careers.
    // Their canonical objects remain in availableStaff.
    const historyTeams = [
        ...(Array.isArray(gameState.teams) ? gameState.teams : []),
        ...(gameState.playerTeam ? [gameState.playerTeam] : [])
    ];

    const employedHistoryCoachIds = new Set(
        historyTeams.flatMap(candidateTeam => [
            ...(Array.isArray(candidateTeam?.coaches)
                ? candidateTeam.coaches
                : []),
            candidateTeam?.coach,
            candidateTeam?.staff?.coach,
            candidateTeam?.staff?.scout,
            candidateTeam?.staff?.trainer
        ])
            .filter(coach => coach?.id != null)
            .map(coach => String(coach.id))
    );

    const seenHistoryCoachIds = new Set();

    const freeAgentCareerCoaches = (
        Array.isArray(gameState.availableStaff)
            ? gameState.availableStaff
            : []
    ).filter(coach => {
        if (
            !coach ||
            coach.id == null ||
            coach.teamId != null ||
            employedHistoryCoachIds.has(String(coach.id)) ||
            seenHistoryCoachIds.has(String(coach.id)) ||
            !Array.isArray(coach.careerHistory) ||
            coach.careerHistory.length === 0
        ) {
            return false;
        }

        seenHistoryCoachIds.add(String(coach.id));
        return true;
    });

    const freeAgentCareerHistoryHtml = freeAgentCareerCoaches.map(coach => {
        const history = [...coach.careerHistory]
            .filter(entry => entry && typeof entry === 'object')
            .sort((a, b) =>
                (Number(b.year) || 0) - (Number(a.year) || 0)
            );

        const recordsHtml = history.map(record => {
            const wins = Math.max(0, Number(record.wins) || 0);
            const losses = Math.max(0, Number(record.losses) || 0);
            const ties = Math.max(0, Number(record.ties) || 0);

            const milestones = Array.isArray(record.milestones)
                ? [...new Set(record.milestones)]
                    .filter(value =>
                        typeof value === 'string' && value.trim()
                    )
                    .map(overviewEscape)
                    .join(' · ')
                : '';

            return `
                <div class="rounded border border-slate-200 bg-slate-50 p-3">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <span class="text-[9px] font-bold uppercase text-blue-700">
                                Year ${overviewEscape(record.year ?? '—')}
                            </span>
                            <p class="text-xs font-bold text-slate-900">
                                ${overviewEscape(record.teamName || 'Unknown Team')}
                            </p>
                        </div>

                        <span class="text-[10px] font-semibold text-slate-600">
                            ${overviewEscape(record.role || 'Coaching Staff')}
                        </span>
                    </div>

                    <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <span class="font-mono text-xs font-bold text-slate-800">
                            ${wins}-${losses}-${ties}
                        </span>

                        <span class="text-[10px] text-slate-500">
                            ${record.tier != null
                                ? `Tier ${overviewEscape(record.tier)}`
                                : ''}
                            ${record.leagueType
                                ? ` · ${overviewEscape(record.leagueType)}`
                                : ''}
                        </span>
                    </div>

                    ${milestones
                        ? `<p class="mt-2 text-[10px] font-semibold text-amber-800">${milestones}</p>`
                        : ''}
                </div>
            `;
        }).join('');

        const coachId = String(coach.id)
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'");

        return `
            <section class="rounded-lg border border-slate-200 bg-white p-3">
                <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div>
                        <h5 class="text-sm font-black text-slate-900">
                            ${overviewEscape(coach.name || 'Unnamed Coach')}
                        </h5>
                        <p class="text-[10px] text-slate-500">
                            Free Agent · ${history.length} recorded season${history.length === 1 ? '' : 's'}
                        </p>
                    </div>

                    <button
                        type="button"
                        class="rounded border border-slate-200 px-2 py-1 text-[10px] font-bold text-blue-700 hover:bg-blue-50"
                        onclick="app.openCoachCard('${coachId}')">
                        View Profile
                    </button>
                </div>

                <div class="space-y-2">
                    ${recordsHtml}
                </div>
            </section>
        `;
    }).join('');

        // Retired coaches retain compact career records in the permanent archive.
    const retiredCoachArchive = (
        Array.isArray(gameState.coachCareerArchive)
            ? gameState.coachCareerArchive
            : []
    ).filter(coach =>
        coach &&
        coach.id != null &&
        Array.isArray(coach.careerHistory)
    );

    const retiredCareerHistoryHtml = retiredCoachArchive.map(coach => {
        const history = [...coach.careerHistory]
            .filter(entry => entry && typeof entry === 'object')
            .sort((a, b) =>
                (Number(b.year) || 0) - (Number(a.year) || 0)
            );

        const recordsHtml = history.map(record => {
            const wins = Math.max(0, Number(record.wins) || 0);
            const losses = Math.max(0, Number(record.losses) || 0);
            const ties = Math.max(0, Number(record.ties) || 0);

            const milestones = Array.isArray(record.milestones)
                ? [...new Set(record.milestones)]
                    .filter(value =>
                        typeof value === 'string' && value.trim()
                    )
                    .map(overviewEscape)
                    .join(' · ')
                : '';

            return `
                <div class="rounded border border-slate-200 bg-slate-50 p-3">
                    <div class="flex flex-wrap justify-between items-center gap-2">
                        <div>
                            <span class="text-[9px] font-bold uppercase text-blue-700">
                                Year ${overviewEscape(record.year ?? '—')}
                            </span>
                            <p class="text-xs font-bold text-slate-900">
                                ${overviewEscape(record.teamName || 'Unknown Team')}
                            </p>
                        </div>

                        <span class="text-[10px] font-semibold text-slate-600">
                            ${overviewEscape(record.role || 'Coaching Staff')}
                        </span>
                    </div>

                    <div class="mt-2 flex flex-wrap justify-between items-center gap-2">
                        <span class="font-mono text-xs font-bold text-slate-800">
                            ${wins}-${losses}-${ties}
                        </span>

                        <span class="text-[10px] text-slate-500">
                            ${record.tier != null
                                ? `Tier ${overviewEscape(record.tier)}`
                                : ''}
                            ${record.leagueType
                                ? ` · ${overviewEscape(record.leagueType)}`
                                : ''}
                        </span>
                    </div>

                    ${milestones
                        ? `<p class="mt-2 text-[10px] font-semibold text-amber-800">${milestones}</p>`
                        : ''}
                </div>
            `;
        }).join('');

        return `
            <section class="rounded-lg border border-slate-200 bg-white p-3">
                <div class="flex flex-wrap justify-between items-center gap-2 mb-3">
                    <div>
                        <h5 class="text-sm font-black text-slate-900">
                            ${overviewEscape(coach.name || 'Unnamed Coach')}
                        </h5>
                        <p class="text-[10px] text-slate-500">
                            Retired Year ${overviewEscape(coach.retiredYear ?? '—')}
                            · Age ${overviewEscape(coach.retiredAge ?? '—')}
                        </p>
                    </div>

                    <span class="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[9px] font-bold uppercase text-slate-600">
                        Retired
                    </span>
                </div>

                <p class="mb-3 text-[10px] text-slate-500">
                    Last team: ${overviewEscape(coach.lastTeamName || 'Unknown')}
                </p>

                <div class="space-y-2">
                    ${recordsHtml || `
                        <p class="rounded border border-dashed border-slate-300 bg-slate-50 p-3 text-center text-[10px] text-slate-500">
                            No recorded coaching seasons.
                        </p>
                    `}
                </div>
            </section>
        `;
    }).join('');

    // Coaches removed because the local market reached capacity retain
    // their career records, but are not classified as retired.
    const coachMarketArchive = (
        Array.isArray(gameState.coachMarketArchive)
            ? gameState.coachMarketArchive
            : []
    ).filter(coach =>
        coach &&
        coach.id != null &&
        Array.isArray(coach.careerHistory)
    );

    const coachMarketExitHistoryHtml = coachMarketArchive.map(coach => {
        const history = [...coach.careerHistory]
            .filter(entry => entry && typeof entry === 'object')
            .sort((a, b) =>
                (Number(b.year) || 0) - (Number(a.year) || 0)
            );

        const recordsHtml = history.map(record => {
            const wins = Math.max(0, Number(record.wins) || 0);
            const losses = Math.max(0, Number(record.losses) || 0);
            const ties = Math.max(0, Number(record.ties) || 0);

            const milestones = Array.isArray(record.milestones)
                ? [...new Set(record.milestones)]
                    .filter(value =>
                        typeof value === 'string' && value.trim()
                    )
                    .map(overviewEscape)
                    .join(' · ')
                : '';

            return `
                <div class="rounded border border-slate-200 bg-slate-50 p-3">
                    <div class="flex flex-wrap justify-between items-center gap-2">
                        <div>
                            <span class="text-[9px] font-bold uppercase text-blue-700">
                                Year ${overviewEscape(record.year ?? '—')}
                            </span>
                            <p class="text-xs font-bold text-slate-900">
                                ${overviewEscape(record.teamName || 'Unknown Team')}
                            </p>
                        </div>

                        <span class="text-[10px] font-semibold text-slate-600">
                            ${overviewEscape(record.role || 'Coaching Staff')}
                        </span>
                    </div>

                    <div class="mt-2 flex flex-wrap justify-between items-center gap-2">
                        <span class="font-mono text-xs font-bold text-slate-800">
                            ${wins}-${losses}-${ties}
                        </span>

                        ${record.tier != null || record.leagueType
                            ? `<span class="text-[10px] text-slate-500">
                                ${record.tier != null
                                    ? `Tier ${overviewEscape(record.tier)}`
                                    : ''}
                                ${record.leagueType
                                    ? ` · ${overviewEscape(record.leagueType)}`
                                    : ''}
                            </span>`
                            : ''}
                    </div>

                    ${milestones
                        ? `<p class="mt-2 text-[10px] font-semibold text-amber-800">${milestones}</p>`
                        : ''}
                </div>
            `;
        }).join('');

        const exitReason = coach.exitReason === 'left_local_market'
            ? 'Local Market Capacity'
            : 'Market Exit';

        return `
            <section class="rounded-lg border border-slate-200 bg-white p-3">
                <div class="flex flex-wrap justify-between items-center gap-2 mb-3">
                    <div>
                        <h5 class="text-sm font-black text-slate-900">
                            ${overviewEscape(coach.name || 'Unnamed Coach')}
                        </h5>
                        <p class="text-[10px] text-slate-500">
                            Left Market Year ${overviewEscape(coach.exitedYear ?? '—')}
                        </p>
                    </div>

                    <span class="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[9px] font-bold uppercase text-slate-600">
                        ${overviewEscape(exitReason)}
                    </span>
                </div>

                <p class="mb-3 text-[10px] text-slate-500">
                    Last team: ${overviewEscape(coach.lastTeamName || 'Unknown')}
                </p>

                <div class="space-y-2">
                    ${recordsHtml || `
                        <p class="rounded border border-dashed border-slate-300 bg-slate-50 p-3 text-center text-[10px] text-slate-500">
                            No recorded coaching seasons.
                        </p>
                    `}
                </div>
            </section>
        `;
    }).join('');

    const historyCoaches = [
        ...overviewCoaches.map(entry => entry.coach),
        ...freeAgentCareerCoaches,
        ...retiredCoachArchive,
        ...coachMarketArchive
    ];

    const historyAppointmentCount = historyCoaches.reduce(
        (total, coach) =>
            total + (
                Array.isArray(coach.careerHistory)
                    ? coach.careerHistory.length
                    : 0
            ),
        0
    );

    const coachesWithHistory = historyCoaches.filter(
        coach =>
            Array.isArray(coach.careerHistory) &&
            coach.careerHistory.length > 0
    ).length;

    const totalAssignedHours = developmentRows.reduce(
        (sum, row) => sum + row.assignedHours,
        0
    );

    html += `
        <section class="mb-4 space-y-3">

            <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h4 class="text-sm font-black uppercase tracking-wide text-slate-900">
                        Current Coaching Staff
                    </h4>
                    <p class="text-[10px] text-slate-500">
                        Select a coach to open their individual profile.
                    </p>
                </div>

                <span class="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-600">
                    ${npcCoachCount}/3 Staff Positions
                </span>
            </div>

            <div class="grid grid-cols-1 2xl:grid-cols-[minmax(190px,0.55fr)_minmax(0,2fr)] gap-3">

                <div class="grid grid-cols-1 sm:grid-cols-3 2xl:grid-cols-1 gap-2">
                    <div class="flex items-center justify-between gap-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[10px]">
                        <span class="font-bold text-slate-600">STAFF</span>
                        <b class="text-slate-900">${npcCoachCount}/3</b>
                    </div>

                    <div class="flex items-center justify-between gap-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[10px]">
                        <span class="font-bold text-slate-600">AVG SKILLS</span>
                        <b class="text-slate-900">${overviewAverage ?? '—'}</b>
                    </div>

                    <div class="flex items-center justify-between gap-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[10px]">
                        <span class="font-bold text-slate-600">ASSIGNED HOURS</span>
                        <b class="text-slate-900">${totalAssignedHours}</b>
                    </div>
                </div>

                <div class="grid grid-cols-1 2xl:grid-cols-2 gap-2">
                ${overviewCoaches.map(entry => `
                    <button
                        type="button"
                        class="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left shadow-sm transition hover:border-blue-400 hover:bg-blue-50/40 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        onclick="app.openCoachCard('${entry.coachId}')"
                        aria-label="Open profile for ${overviewEscape(entry.coach.name)}">

                        <div class="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.8fr)_auto] lg:items-center lg:gap-4">

                            <div class="min-w-0">
                                <div class="flex flex-wrap items-center gap-2">
                                    <span class="text-sm font-black text-slate-900">
                                        ${overviewEscape(entry.coach.name || 'Unnamed Coach')}
                                    </span>

                                    <span class="rounded bg-slate-100 px-2 py-0.5 text-[9px] font-bold uppercase text-slate-600">
                                        ${overviewEscape(entry.role)}
                                    </span>
                                </div>

                                <p class="mt-1 whitespace-normal break-words text-[10px] leading-snug text-slate-500">
                                    ${overviewEscape(entry.styleSummary)}
                                </p>
                            </div>

                            <div class="min-w-0 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px]">
                                <span class="min-w-0 break-words text-slate-600">
                                    <b class="uppercase text-emerald-700">Strengths</b>
                                    ${overviewEscape(entry.strengthsSummary)}
                                </span>

                                <span class="min-w-0 break-words text-slate-600">
                                    <b class="uppercase text-amber-700">Lowest</b>
                                    ${overviewEscape(entry.lowestSkillSummary)}
                                </span>
                            </div>

                            <div class="flex items-center justify-between gap-3 sm:justify-end">
                                <div class="text-right text-[9px] leading-relaxed text-slate-500">
                                    <span class="block">
                                        ${entry.workload}h assigned
                                    </span>
                                    <span class="block">
                                        ${overviewEscape(entry.availability)}
                                    </span>
                                </div>

                                <div class="flex shrink-0 items-center gap-1">
                                    <div class="shrink-0 text-right">
                                        <span class="block text-[9px] uppercase text-slate-400">
                                            Overall
                                        </span>
                                        <span class="text-xl font-black tabular-nums text-slate-900">
                                            ${entry.overall ?? '—'}
                                        </span>
                                    </div>
                                    <span class="text-lg text-slate-400">›</span>
                                </div>
                            </div>
                        </div>
                    </button>
                `).join('')}
                </div>
            </div>
        </section>
    `;

    // Finish the overview before opening the other management sections.
    html += `
        </div>

                <div
            class="staff-hub-pane hidden"
            data-staff-pane="history">

            <section class="mb-3 rounded-lg border border-slate-200 bg-white p-4">
                <h4 class="text-sm font-black uppercase tracking-wide text-slate-900">
                    Coaching Career History
                </h4>

                <p class="mt-1 text-xs text-slate-500">
                    Follow your current staff's careers across teams, seasons,
                    coaching appointments, and accomplishments.
                </p>

                <div class="mt-3 grid grid-cols-2 gap-2">
                    <div class="rounded border border-slate-200 bg-slate-50 p-3">
                        <span class="block text-[9px] font-bold uppercase text-slate-500">
                            Coaches with History
                        </span>
                        <span class="text-xl font-black text-slate-900">
                            ${coachesWithHistory}/${historyCoaches.length}
                        </span>
                    </div>

                    <div class="rounded border border-slate-200 bg-slate-50 p-3">
                        <span class="block text-[9px] font-bold uppercase text-slate-500">
                            Recorded Appointments
                        </span>
                        <span class="text-xl font-black text-slate-900">
                            ${historyAppointmentCount}
                        </span>
                    </div>
                </div>
            </section>

            <div class="grid grid-cols-1 2xl:grid-cols-2 gap-3">
                ${staffCareerHistoryHtml}
            </div>

            ${freeAgentCareerCoaches.length > 0 ? `
                <section class="mt-5 space-y-3">
                    <div>
                        <h4 class="text-sm font-black uppercase tracking-wide text-slate-900">
                            Former Staff · Free Agents
                        </h4>
                        <p class="text-[10px] text-slate-500">
                            Coaches currently between teams whose career records remain available.
                        </p>
                    </div>

                    <div class="grid grid-cols-1 2xl:grid-cols-2 gap-3">
                        ${freeAgentCareerHistoryHtml}
                    </div>
                </section>
            ` : ''}

            ${retiredCoachArchive.length > 0 ? `
                <section class="mt-5 space-y-3">
                    <div>
                        <h4 class="text-sm font-black uppercase tracking-wide text-slate-900">
                            Retired Coaches
                        </h4>
                        <p class="text-[10px] text-slate-500">
                            Permanent career records for coaches who have retired.
                        </p>
                    </div>

                    <div class="grid grid-cols-1 2xl:grid-cols-2 gap-3">
                        ${retiredCareerHistoryHtml}
                    </div>
                </section>
            ` : ''}

            ${coachMarketArchive.length > 0 ? `
                <section class="mt-5 space-y-3">
                    <div>
                        <h4 class="text-sm font-black uppercase tracking-wide text-slate-900">
                            Left Local Market
                        </h4>
                        <p class="text-[10px] text-slate-500">
                            Coaches whose careers are preserved but who are no longer part of the local coaching pool.
                        </p>
                    </div>

                    <div class="grid grid-cols-1 2xl:grid-cols-2 gap-3">
                        ${coachMarketExitHistoryHtml}
                    </div>
                </section>
            ` : ''}

            <p class="mt-3 text-[10px] leading-relaxed text-slate-500">
                Records begin when career tracking is active. Earlier coaching
                seasons that were not recorded are intentionally excluded.
                Each coach's complete career history is also available from
                their individual profile.
            </p>
        </div>
    `;

    html += `
        <div
            class="staff-hub-pane hidden"
            data-staff-pane="workload">
    `;

    // 2. Weekly Staff Workload
    const workCoaches = currentCoaches;
    const workPlan = developmentWorkPlan;

    if (workPlan && Array.isArray(workPlan.assignments)) {
        const taskLabels = {
            scouting: 'Prospect Scouting',
            training: 'Player Development',
            offensePrep: 'Offensive Preparation',
            defensePrep: 'Defensive Preparation',
            communityService: 'Community Service'
        };

        // Community service is a committed assignment, not a task
        // that can be created through the regular workload editor.
        const editableTaskLabels = Object.fromEntries(
            Object.entries(taskLabels).filter(
                ([task]) => task !== 'communityService'
            )
        );

        const focusOptions = {
            scouting: [
                ['all', 'General scouting'],
                ['watchlist', 'Watchlist targets'],
                ['youth', 'Pee Wee prospects'],
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

            if (!plan || !Array.isArray(plan.assignments)) return;

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
                            GM department priorities, coach skills, and each
                            coach's available weekly hours will guide the
                            assignments.
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

                    // Accepted community requests are committed obligations.
                    // Preserve them when rebuilding the ordinary workload.
                    const committedCommunityAssignments =
                        latestPlan.assignments.filter(assignment =>
                            assignment?.task === 'communityService'
                        );

                    const assignments =
                        buildAutomatedStaffAssignmentsForTeam(
                            latestTeam,
                            latestState
                        );

                    if (!Array.isArray(assignments)) return;

                    latestPlan.assignments = [
                        ...assignments.filter(
                            assignment =>
                                assignment?.task !== 'communityService'
                        ),
                        ...committedCommunityAssignments
                    ];

                    latestPlan.autoAssignedFor = {
                        year: latestState.year ?? null,
                        week: latestState.currentWeek ?? null
                    };

                    staffWorkloadExpanded = true;

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

            // Accepted community commitments cannot be manually removed.
            if (plan.assignments[index]?.task === 'communityService') {
                return;
            }

            plan.assignments.splice(index, 1);
            saveGameState();
            renderStaffTab(gs);
        };

        const renderStaffWorkPicker = (
            index,
            field,
            label,
            options,
            selectedValue,
            detailHeader = 'Details'
        ) => {
            const pickerId = `staff-work-picker-${index}-${field}`;
            const selectedOption = options.find(option =>
                String(option[0]) === String(selectedValue)
            );

            return `
                <div class="relative min-w-0">
                    <span class="mb-1 block text-[9px] font-bold uppercase text-slate-500">${label}</span>
                    <button
                        type="button"
                        id="${pickerId}-trigger"
                        aria-expanded="false"
                        aria-controls="${pickerId}"
                        onclick="window.app_toggleStaffWorkPicker('${pickerId}')"
                        class="flex w-full items-center justify-between gap-2 rounded border border-slate-300 bg-white px-2 py-2 text-left text-xs hover:border-slate-500">
                        <span class="truncate font-semibold text-slate-700">${overviewEscape(selectedOption?.[1] || 'Choose...')}</span>
                        <span aria-hidden="true" class="text-slate-400">▾</span>
                    </button>
                    <div id="${pickerId}" class="staff-work-picker absolute left-0 top-full z-30 mt-1 hidden max-h-72 w-80 max-w-[90vw] overflow-y-auto rounded border border-slate-300 bg-white p-2 shadow-xl">
                        <input type="search" data-staff-work-search="${pickerId}" placeholder="Search ${overviewEscape(label.toLowerCase())}..." oninput="window.app_filterStaffWorkPicker('${pickerId}')" class="mb-2 w-full rounded border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-slate-500">
                        <div class="overflow-hidden rounded-sm border border-slate-200">
                            <div class="grid grid-cols-[minmax(0,1fr)_8rem] gap-2 bg-slate-100 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-slate-500">
                                <span>${label}</span>
                                <span>${detailHeader}</span>
                            </div>
                            ${options.map(([value, name, detail = '']) => `
                                <button
                                    type="button"
                                    data-staff-work-option="${pickerId}"
                                    data-staff-work-value="${overviewEscape(value)}"
                                    data-staff-work-search-text="${overviewEscape(`${name} ${detail}`)}"
                                    onclick="window.app_selectStaffWorkPicker(${index}, '${field}', this.dataset.staffWorkValue)"
                                    class="grid w-full grid-cols-[minmax(0,1fr)_8rem] gap-2 border-t border-slate-100 px-2 py-1.5 text-left text-[10px] ${String(value) === String(selectedValue) ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}">
                                    <span class="truncate font-semibold">${overviewEscape(name)}</span>
                                    <span class="truncate text-right ${String(value) === String(selectedValue) ? 'text-slate-200' : 'text-slate-500'}">${overviewEscape(detail)}</span>
                                </button>
                            `).join('')}
                        </div>
                    </div>
                </div>
            `;
        };

        window.app_toggleStaffWorkPicker = pickerId => {
            const picker = document.getElementById(pickerId);
            const trigger = document.getElementById(`${pickerId}-trigger`);
            if (!picker || !trigger) return;

            const isOpening = picker.classList.contains('hidden');
            document.querySelectorAll('.staff-work-picker').forEach(panel =>
                panel.classList.add('hidden')
            );
            document.querySelectorAll('[aria-controls^="staff-work-picker-"]').forEach(button =>
                button.setAttribute('aria-expanded', 'false')
            );

            if (isOpening) {
                picker.classList.remove('hidden');
                trigger.setAttribute('aria-expanded', 'true');
                picker.querySelector('input[type="search"]')?.focus();
            }
        };

        window.app_filterStaffWorkPicker = pickerId => {
            const query = String(
                document.querySelector(
                    `[data-staff-work-search="${pickerId}"]`
                )?.value || ''
            ).trim().toLowerCase();

            document.querySelectorAll(
                `[data-staff-work-option="${pickerId}"]`
            ).forEach(button => {
                button.hidden = !String(
                    button.dataset.staffWorkSearchText || ''
                ).toLowerCase().includes(query);
            });
        };

        window.app_selectStaffWorkPicker = (index, field, value) => {
            window.app_updateStaffWorkAssignment(index, field, value);
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

            // Preserve the coach, hours, and task attached to an accepted favor.
            if (assignment?.task === 'communityService') {
                return;
            }

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
                if (!Object.prototype.hasOwnProperty.call(
                    editableTaskLabels,
                    value
                )) {
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
            <details
                id="staff-workload-assignments"
                class="mt-3 mb-4 rounded border border-slate-300 bg-white shadow-sm"
                ${staffWorkloadExpanded ? 'open' : ''}>
                <summary class="flex cursor-pointer list-none flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h4 class="text-xs font-black uppercase tracking-wide text-slate-900">
                            Weekly Staff Workload
                        </h4>
                        <p class="mt-0.5 text-[10px] text-slate-500">
                            Edit coaching hours and task assignments.
                        </p>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-mono text-slate-700">
                            <b>${totalRequestedHours}</b> hrs ·
                            <b>${workCoaches.length}</b> coaches
                        </span>
                        <span class="text-[10px] font-bold text-blue-700">
                            ${staffWorkloadExpanded ? 'Collapse ↑' : 'Edit workload ↓'}
                        </span>
                    </div>
                </summary>

                <div class="border-t border-slate-200 p-3">
                    <div class="grid grid-cols-1 2xl:grid-cols-[minmax(280px,0.75fr)_minmax(0,2fr)] 2xl:gap-5">
                        <section class="min-w-0">
                            <div class="mb-3 flex justify-end">
                                <button
                                    type="button"
                                    class="shrink-0 rounded bg-blue-700 px-3 py-2 text-xs font-bold text-white hover:bg-blue-800"
                                    onclick="app_autoAssignStaffWorkload()"
                                    title="Allocate each coach's available hours across scouting, development, and preparation">
                                    Auto-assign workload
                                </button>
                            </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-2 gap-2 mb-4">
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
                                        coach.biases?.scouting?.displayName ||
                                        coach.biases?.scouting?.name ||
                                        'Staff coach'
                                    }</p>`}
                            </div>`;
                    }).join('')}
                </div>
                        </section>

                        <section class="min-w-0">
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

                        const isCommunityService =
                            assignment.task === 'communityService';

                        const communityFavor = isCommunityService
                            ? (
                                gameState.community?.favors || []
                            ).find(favor =>
                                String(favor.id) ===
                                String(assignment.favorId)
                            )
                            : null;

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
                                : coach.name,
                            `${getCoachHours(coach.id)}/${getCoachWeeklyCapacity(coach)} hrs`
                        ]);

                        const opponentOptions = [
                            ['', 'Any opponent', 'No team restriction'],
                            ...(gameState.teams || [])
                                .filter(other => other &&
                                    other.id !== team.id &&
                                    other.leagueType === team.leagueType)
                                .sort((a, b) =>
                                    String(a.name || '').localeCompare(String(b.name || ''))
                                )
                                .map(other => {
                                    const league = other.leagueType === 'youth'
                                        ? 'Pee-Wee'
                                        : Number(other.tier) === 1
                                            ? 'Premier'
                                            : Number(other.tier) === 2
                                                ? 'Sandlot'
                                                : 'League';
                                    const record = `${Number(other.wins) || 0}-${Number(other.losses) || 0}-${Number(other.ties) || 0}`;

                                    return [
                                        String(other.id),
                                        other.name,
                                        `${league} · ${record}`
                                    ];
                                })
                        ];

                        return `
                            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 items-end border border-slate-200 rounded p-3">
                                ${isCommunityService ? `
                                    <div class="min-w-0">
                                        <span class="block text-[9px] font-bold uppercase text-slate-500 mb-1">
                                            Assigned Coach
                                        </span>
                                        <div class="rounded border border-slate-200 bg-slate-50 p-2 text-xs font-semibold text-slate-700">
                                            ${overviewEscape(
                                                assignedCoach?.name || 'Assigned staff member'
                                            )}
                                        </div>
                                    </div>
                                ` : `
                                    <label class="block min-w-0">
                                        <span class="block text-[9px] font-bold uppercase text-slate-500 mb-1">Coach</span>
                                        ${renderStaffWorkPicker(
                                            index,
                                            'coachId',
                                            'Coach',
                                            coachOptions,
                                            assignment.coachId,
                                            'Week hours'
                                        )}
                                    </label>
                                `}

                                ${isCommunityService ? `
                                    <div class="min-w-0">
                                        <span class="block text-[9px] font-bold uppercase text-slate-500 mb-1">
                                            Task
                                        </span>
                                        <div class="rounded border border-emerald-200 bg-emerald-50 p-2 text-xs font-bold text-emerald-800">
                                            Community Service
                                        </div>
                                    </div>
                                ` : `
                                    <label class="block min-w-0">
                                        <span class="block text-[9px] font-bold uppercase text-slate-500 mb-1">Task</span>
                                        <div class="grid grid-cols-2 gap-1" role="group" aria-label="Staff task">
                                            ${Object.entries(editableTaskLabels).map(([value, label]) => `
                                                <button
                                                    type="button"
                                                    aria-pressed="${task === value}"
                                                    onclick="app_updateStaffWorkAssignment(${index}, 'task', '${value}')"
                                                    class="rounded-sm border px-2 py-1.5 text-left text-[10px] font-semibold ${task === value ? 'border-blue-700 bg-blue-50 text-blue-900' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}">
                                                    ${label}
                                                </button>
                                            `).join('')}
                                        </div>
                                    </label>
                                `}

                                ${isCommunityService ? `
                                    <div class="min-w-0">
                                        <span class="block text-[9px] font-bold uppercase text-slate-500 mb-1">
                                            Request
                                        </span>
                                        <div class="rounded border border-slate-200 bg-slate-50 p-2 text-[10px] text-slate-700">
                                            ${overviewEscape(
                                                communityFavor?.title ||
                                                'Accepted community request'
                                            )}
                                            <span class="block mt-1 text-[9px] font-semibold text-emerald-700">
                                                Committed assignment
                                            </span>
                                        </div>
                                    </div>
                                ` : focusList.length > 0 ? `
                                    <label class="block min-w-0">
                                        <span class="block text-[9px] font-bold uppercase text-slate-500 mb-1">Focus</span>
                                        <div class="grid grid-cols-2 gap-1" role="group" aria-label="Task focus">
                                            ${focusList.map(([value, label]) => `
                                                <button
                                                    type="button"
                                                    aria-pressed="${(assignment.focus || 'all') === String(value)}"
                                                    onclick="app_updateStaffWorkAssignment(${index}, 'focus', '${value}')"
                                                    title="${label}"
                                                    class="rounded-sm border px-1.5 py-1 text-left text-[9px] font-semibold ${((assignment.focus || 'all') === String(value)) ? 'border-blue-700 bg-blue-50 text-blue-900' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}">
                                                    ${label}
                                                </button>
                                            `).join('')}
                                        </div>
                                    </label>
                                ` : task === 'defensePrep' ? `
                                    <label class="block min-w-0">
                                        <span class="block text-[9px] font-bold uppercase text-slate-500 mb-1">Opponent</span>
                                        ${renderStaffWorkPicker(
                                            index,
                                            'opponentTeamId',
                                            'Opponent',
                                            opponentOptions,
                                            assignment.opponentTeamId || '',
                                            'League · Record'
                                        )}
                                    </label>
                                ` : `
                                    <div class="text-[10px] text-slate-500">
                                        All active offensive plays
                                    </div>
                                `}

                                ${task === 'training' ? `
                                    <label class="block min-w-0">
                                        <span class="block text-[9px] font-bold uppercase text-slate-500 mb-1">Skill</span>
                                        ${renderStaffWorkPicker(
                                            index,
                                            'skill',
                                            'Training skill',
                                            skillOptions.map(([value, name]) => [
                                                value,
                                                name,
                                                value ? 'Skill focus' : 'Coach chooses'
                                            ]),
                                            assignment.skill || '',
                                            'Focus'
                                        )}
                                    </label>
                                ` : '<div></div>'}

                                ${showTargets ? `
                                    <label class="block min-w-0">
                                        <span class="block text-[9px] font-bold uppercase text-slate-500 mb-1">Max targets</span>
                                        <input type="number" min="1" max="12" step="1" value="${assignment.maxTargets || (task === 'training' ? 4 : 1)}" class="w-full text-xs border border-slate-300 rounded p-2 bg-white"
                                            aria-label="Maximum targets"
                                            onchange="app_updateStaffWorkAssignment(${index}, 'maxTargets', this.value)">
                                    </label>
                                ` : '<div></div>'}

                                ${isCommunityService ? `
                                    <div class="min-w-0">
                                        <span class="block text-[9px] font-bold uppercase text-slate-500 mb-1">
                                            Committed Hours
                                        </span>
                                        <div class="rounded border border-emerald-200 bg-emerald-50 p-2 text-xs font-bold text-emerald-800">
                                            ${currentHours} hrs · Locked
                                        </div>
                                    </div>
                                ` : `
                                    <div class="flex items-end gap-2">
                                        <label class="block flex-1 min-w-0">
                                            <span class="block text-[9px] font-bold uppercase text-slate-500 mb-1">Hours</span>
                                            <input type="number" min="0" max="${Math.max(capacity, currentHours)}" step="1" value="${currentHours}" class="w-full text-xs border border-slate-300 rounded p-2 bg-white"
                                                aria-label="Assigned hours"
                                                onchange="app_updateStaffWorkAssignment(${index}, 'hours', this.value)">
                                        </label>
                                        <button class="px-2 py-2 text-xs font-bold text-rose-600 border border-rose-200 rounded hover:bg-rose-50"
                                            title="Remove assignment"
                                            aria-label="Remove assignment"
                                            onclick="app_removeStaffWorkAssignment(${index})">
                                            ×
                                        </button>
                                    </div>
                                `}
                                ${prepPlayOptions.length > 0 ? `
                                    <div class="md:col-span-2 xl:col-span-3 rounded border border-slate-200 bg-slate-50 p-3">
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
                            </div>
                        </section>
                    </div>
                </div>
            </details>
        `;
    }

    html += '</div>';

    // Staff candidates are displayed in the dedicated Staff Carousel pane.
    container.innerHTML = html;

    // Restore the user's selected destination after any UI refresh.
    window.app_switchStaffTab(activeStaffHubTab);

    const workloadDetails = container.querySelector(
        '#staff-workload-assignments'
    );

    if (workloadDetails) {
        workloadDetails.addEventListener('toggle', () => {
            staffWorkloadExpanded = workloadDetails.open;
        });
    }
}

let staffCarouselSearch = '';
let staffCarouselSort = 'overall';
let staffCarouselSortDirection = 'desc';
let staffCarouselFitRole = 'general';

export function renderStaffCarouselTab(
    gameState,
    targetContainerId = null
) {
    gameState = Game.getGameState() || gameState;

    const carouselScreen = document.getElementById('staff-carousel-screen');

    const isDedicatedCarouselVisible =
        carouselScreen && !carouselScreen.classList.contains('hidden');

    const containerId = targetContainerId || (
        isDedicatedCarouselVisible
            ? 'staff-carousel-market-container'
            : 'staff-carousel-container'
    );

    const container = document.getElementById(containerId);

    if (!container || !gameState?.playerTeam) return;

    // Initialize the hiring handlers and candidate pool.
    // renderStaffTab no longer renders the candidate market.
    renderStaffTab(gameState);

    const team = gameState.playerTeam;

    const carouselDayLabel = document.getElementById(
        'staff-carousel-day-label'
    );

    const reviewState = gameState.offseasonState || {};

    const reviewDayValue = Number(reviewState.staffReviewDay);
    const reviewDaysValue = Number(reviewState.staffReviewDays);

    const staffReviewDay =
        Number.isInteger(reviewDayValue) && reviewDayValue > 0
            ? reviewDayValue
            : 1;

    const staffReviewDays =
        Number.isInteger(reviewDaysValue) &&
        reviewDaysValue >= staffReviewDay
            ? reviewDaysValue
            : Math.max(staffReviewDay, COACH_CAROUSEL_DAYS);

    if (carouselDayLabel) {
        carouselDayLabel.textContent =
            `Staff Review · Day ${staffReviewDay} of ${staffReviewDays}`;
    }

    const carouselBudgetLabel = document.getElementById(
        'staff-carousel-budget-label'
    );

    if (carouselBudgetLabel) {
        carouselBudgetLabel.textContent = String(
            Math.max(
                0,
                Math.floor(
                    Number(team.socialProfile?.favorTokens) || 0
                )
            )
        );
    }

    const employedStaffIds = new Set();

    const teamsToCheck = [
        ...(Array.isArray(gameState.teams) ? gameState.teams : []),
        ...(gameState.playerTeam ? [gameState.playerTeam] : [])
    ];

    teamsToCheck.forEach(teamRecord => {
        if (!teamRecord) return;

        const coachingGroup = Array.isArray(teamRecord.coaches)
            ? teamRecord.coaches
            : [];

        const legacyStaff = [
            teamRecord.coach,
            teamRecord.staff?.coach,
            teamRecord.staff?.scout,
            teamRecord.staff?.trainer
        ];

        [...coachingGroup, ...legacyStaff].forEach(member => {
            if (member?.id != null) {
                employedStaffIds.add(String(member.id));
            }
        });
    });

    const seenCandidateIds = new Set();

    const candidates = (
        Array.isArray(gameState.availableStaff)
            ? gameState.availableStaff
            : []
    ).filter(candidate => {
        if (candidate?.id == null || candidate.teamId != null) {
            return false;
        }

        const candidateId = String(candidate.id);

        if (
            employedStaffIds.has(candidateId) ||
            seenCandidateIds.has(candidateId)
        ) {
            return false;
        }

        seenCandidateIds.add(candidateId);
        return true;
    });

    const offseasonPhase = String(
        gameState?.offseasonState?.phase ?? ''
    ).toLowerCase().replace(/[^a-z]/g, '');

    const staffChangesOpen =
        offseasonPhase === 'staffreview' &&
        gameState?.offseasonState?.completed !== true;

    if (!staffChangesOpen) {
        container.innerHTML = `
            <section class="mx-auto max-w-2xl rounded-lg border border-slate-300 bg-white p-6 shadow-sm">
                <div class="text-center">
                    <div class="text-3xl mb-3">🏈</div>
                    <h3 class="text-lg font-black uppercase tracking-wide text-slate-900">
                        Staff Carousel Closed
                    </h3>
                    <p class="mt-2 text-sm leading-relaxed text-slate-600">
                        Coaching changes are restricted to the offseason.
                        Your current staff remains in place throughout the season.
                    </p>
                    <div class="mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-left">
                        <p class="text-xs font-bold text-slate-800">
                            Available during the regular season
                        </p>
                        <p class="mt-1 text-xs leading-relaxed text-slate-600">
                            Manage staff workloads, review coach development,
                            and adjust weekly assignments from My Staff.
                        </p>
                    </div>
                    <p class="mt-4 text-[10px] text-slate-500">
                        The carousel reopens when the next offseason staff window begins.
                    </p>
                </div>
            </section>
        `;
        return;
    }

    const activeNpcCoaches = (
        Array.isArray(team.coaches) ? team.coaches : []
    ).filter(coach =>
        coach?.id != null && !coach.isUserCoach
    );

    const openCoachingSlots = Math.max(
        0,
        3 - activeNpcCoaches.length
    );

    if (candidates.length === 0) {
        container.innerHTML = `
            <section class="bg-white rounded border border-slate-300 p-6 text-center">
                <h3 class="font-black text-sm uppercase tracking-wide text-slate-800">
                    Staff Carousel
                </h3>
                <p class="text-xs text-slate-500 mt-2">
                    No candidates are currently available.
                </p>
            </section>`;
        return;
    }

    const candidateRating = (candidate, key) => {
        const rawValue = candidate?.ratings?.[key];

        if (rawValue == null || rawValue === '') {
            return null;
        }

        const value = Number(rawValue);

        return Number.isFinite(value)
            ? Math.max(0, Math.min(100, Math.round(value)))
            : null;
    };

    const averageRatings = values => {
        const valid = values.filter(value => value !== null);

        return valid.length
            ? Math.round(
                valid.reduce((sum, value) => sum + value, 0) /
                valid.length
            )
            : null;
    };

    const getCandidateRoleFit = (candidate, role) => {
        const calculateRoleFit =
            typeof Game.calculateCoachRoleFit === 'function'
                ? Game.calculateCoachRoleFit
                : typeof Game.staff?.calculateCoachRoleFit === 'function'
                    ? Game.staff.calculateCoachRoleFit
                    : null;

        if (!calculateRoleFit) return null;

        const score = Number(
            calculateRoleFit(candidate, role)
        );

        return Number.isFinite(score)
            ? Math.max(0, Math.min(100, Math.round(score)))
            : null;
    };

    const getCandidateMetric = (candidate, key) => {
        const offense = candidateRating(candidate, 'offSchemeMastery');
        const defense = candidateRating(candidate, 'defSchemeMastery');
        const scouting = averageRatings([
            candidateRating(candidate, 'evalPhysicals'),
            candidateRating(candidate, 'evalTechnique'),
            candidateRating(candidate, 'evalCharacter')
        ]);
        const teaching = candidateRating(candidate, 'teaching');
        const gameplan = averageRatings([
            candidateRating(candidate, 'gameplanInstinct'),
            candidateRating(candidate, 'inGameAdjustments')
        ]);
        const practice = averageRatings([
            candidateRating(candidate, 'practiceDiscipline'),
            candidateRating(candidate, 'conditioning')
        ]);

        switch (key) {
            case 'name':
                return String(candidate?.name || '').toLowerCase();
            case 'roleFit':
                return getCandidateRoleFit(candidate, staffCarouselFitRole);
            case 'offense':
                return offense;
            case 'defense':
                return defense;
            case 'scouting':
                return scouting;
            case 'teaching':
                return teaching;
            case 'gameplan':
                return gameplan;
            case 'stipend': {
                const stipend = Number(candidate?.stipendDemand);

                return Number.isFinite(stipend)
                    ? Math.max(0, stipend)
                    : null;
            }
            case 'overall':
            default:
                return averageRatings([
                    offense,
                    defense,
                    scouting,
                    teaching,
                    gameplan,
                    practice
                ]);
        }
    };

    const normalizedSearch = staffCarouselSearch.trim().toLowerCase();

    const displayCandidates = candidates
        .filter(candidate => {
            const searchableText = [
                candidate?.name,
                candidate?.age,

                candidate?.biases?.personality?.displayName,
                candidate?.biases?.personality?.name,

                candidate?.biases?.tactical?.displayName,
                candidate?.biases?.tactical?.name,

                candidate?.biases?.scouting?.displayName,
                candidate?.biases?.scouting?.name,

                candidate?.formerPlayerBio
            ].join(' ').toLowerCase();

            return searchableText.includes(normalizedSearch);
        })
        .sort((a, b) => {
            const first = getCandidateMetric(a, staffCarouselSort);
            const second = getCandidateMetric(b, staffCarouselSort);

            if (first == null && second != null) return 1;
            if (second == null && first != null) return -1;

            const comparison = staffCarouselSort === 'name'
                ? String(first ?? '').localeCompare(String(second ?? ''))
                : (Number(first) || 0) - (Number(second) || 0);

            return staffCarouselSortDirection === 'asc'
                ? comparison
                : -comparison;
        });

    const escapeStaffAttribute = value =>
        String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[char]);

    window.app_applyStaffCarouselSearch = () => {
        staffCarouselSearch =
            document.getElementById('staff-carousel-search')?.value || '';

        renderStaffCarouselTab(Game.getGameState() || gameState);
    };

    window.app_setStaffCarouselSort = key => {
        const allowedSorts = new Set([
            'overall',
            'name',
            'roleFit',
            'offense',
            'defense',
            'scouting',
            'teaching',
            'gameplan',
            'stipend'
        ]);

        if (!allowedSorts.has(key)) return;

        staffCarouselSort = key;
        staffCarouselSortDirection =
            key === 'name' || key === 'stipend' ? 'asc' : 'desc';

        renderStaffCarouselTab(Game.getGameState() || gameState);
    };

    window.app_setStaffCarouselFitRole = role => {
        const allowedRoles = new Set([
            'general',
            'scouting',
            'training'
        ]);

        if (!allowedRoles.has(role)) return;

        staffCarouselFitRole = role;

        renderStaffCarouselTab(Game.getGameState() || gameState);
    };

    window.app_toggleStaffCarouselSortMenu = () => {
        const menu = document.getElementById('staff-carousel-sort-menu');
        const trigger = document.getElementById('staff-carousel-sort-trigger');
        if (!menu || !trigger) return;

        const isOpening = menu.classList.contains('hidden');
        menu.classList.toggle('hidden', !isOpening);
        trigger.setAttribute('aria-expanded', String(isOpening));
    };

    window.app_toggleStaffCarouselSortDirection = () => {
        staffCarouselSortDirection =
            staffCarouselSortDirection === 'asc' ? 'desc' : 'asc';

        renderStaffCarouselTab(Game.getGameState() || gameState);
    };

    window.app_resetStaffCarouselFilters = () => {
        staffCarouselSearch = '';
        staffCarouselSort = 'overall';
        staffCarouselSortDirection = 'desc';
        staffCarouselFitRole = 'general';

        renderStaffCarouselTab(Game.getGameState() || gameState);
    };

    window.app_viewStaffCandidate = candidateId => {
        const latestState = Game.getGameState() || gameState;
        const normalizedCandidateId = String(candidateId);

        const candidate = (
            Array.isArray(latestState?.availableStaff)
                ? latestState.availableStaff
                : []
        ).find(member =>
            member?.id != null &&
            String(member.id) === normalizedCandidateId &&
            member.teamId == null
        );

        const teamsToCheck = [
            ...(Array.isArray(latestState?.teams)
                ? latestState.teams
                : []),
            ...(latestState?.playerTeam
                ? [latestState.playerTeam]
                : [])
        ];

        const isCurrentlyEmployed = teamsToCheck.some(teamRecord => {
            if (!teamRecord) return false;

            const coachingGroup = Array.isArray(teamRecord.coaches)
                ? teamRecord.coaches
                : [];

            const legacyStaff = [
                teamRecord.coach,
                teamRecord.staff?.coach,
                teamRecord.staff?.scout,
                teamRecord.staff?.trainer
            ];

            return [...coachingGroup, ...legacyStaff].some(member =>
                member?.id != null &&
                String(member.id) === normalizedCandidateId
            );
        });

        if (!candidate || isCurrentlyEmployed) {
            showModal(
                'Candidate Unavailable',
                'This candidate is no longer available in the staff market. Refresh the carousel before continuing.',
                null,
                null,
                null,
                'Close'
            );
            return;
        }

        const personality = candidate.biases?.personality || {};
        const tactical = candidate.biases?.tactical || {};
        const scouting = candidate.biases?.scouting || {};

        const profileSkills = [
            ['Offense scheme', 'offSchemeMastery'],
            ['Defense scheme', 'defSchemeMastery'],
            ['Physical evaluation', 'evalPhysicals'],
            ['Technique evaluation', 'evalTechnique'],
            ['Character evaluation', 'evalCharacter'],
            ['Teaching', 'teaching'],
            ['Gameplan instincts', 'gameplanInstinct'],
            ['In-game adjustments', 'inGameAdjustments'],
            ['Practice discipline', 'practiceDiscipline'],
            ['Conditioning', 'conditioning']
        ];

        const escapeProfileText = value =>
            String(value ?? '').replace(/[&<>"']/g, char => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            })[char]);

        // Show the candidate's actual recorded coaching career.
        const careerHistory = (
            Array.isArray(candidate.careerHistory)
                ? [...candidate.careerHistory]
                : []
        )
            .filter(record =>
                record && typeof record === 'object'
            )
            .sort((a, b) =>
                (Number(b.year) || 0) - (Number(a.year) || 0)
            );

        const careerTotals = careerHistory.reduce(
            (totals, record) => {
                totals.wins += Math.max(0, Number(record.wins) || 0);
                totals.losses += Math.max(0, Number(record.losses) || 0);
                totals.ties += Math.max(0, Number(record.ties) || 0);

                if (
                    record.roleKey === 'head_coach' ||
                    record.role === 'Head Coach'
                ) {
                    totals.headCoachSeasons++;
                }

                return totals;
            },
            {
                wins: 0,
                losses: 0,
                ties: 0,
                headCoachSeasons: 0
            }
        );

        const careerGames =
            careerTotals.wins +
            careerTotals.losses +
            careerTotals.ties;

        const careerWinPercentage = careerGames > 0
            ? Math.round(
                (
                    careerTotals.wins +
                    careerTotals.ties * 0.5
                ) / careerGames * 100
            )
            : null;

        const careerHistoryRows = careerHistory
            .slice(0, 6)
            .map(record => {
                const wins = Math.max(0, Number(record.wins) || 0);
                const losses = Math.max(0, Number(record.losses) || 0);
                const ties = Math.max(0, Number(record.ties) || 0);

                const milestones = Array.isArray(record.milestones)
                    ? [...new Set(record.milestones)]
                        .filter(value =>
                            typeof value === 'string' && value.trim()
                        )
                        .map(escapeProfileText)
                        .join(' · ')
                    : '';

                return `
                    <div class="rounded border border-slate-200 bg-slate-50 p-3">
                        <div class="flex flex-wrap justify-between items-center gap-2">
                            <div>
                                <span class="text-[9px] font-bold uppercase text-blue-700">
                                    Year ${escapeProfileText(record.year ?? '—')}
                                </span>
                                <p class="text-xs font-bold text-slate-900">
                                    ${escapeProfileText(record.teamName || 'Unknown Team')}
                                </p>
                            </div>

                            <span class="text-[10px] font-semibold text-slate-600">
                                ${escapeProfileText(record.role || 'Coaching Staff')}
                            </span>
                        </div>

                        <div class="mt-2 flex flex-wrap justify-between items-center gap-2">
                            <span class="font-mono text-xs font-bold text-slate-800">
                                ${wins}-${losses}-${ties}
                            </span>

                            <span class="text-[10px] text-slate-500">
                                ${record.tier != null
                                    ? `Tier ${escapeProfileText(record.tier)}`
                                    : ''}
                                ${record.leagueType
                                    ? ` · ${escapeProfileText(record.leagueType)}`
                                    : ''}
                            </span>
                        </div>

                        ${milestones
                            ? `<p class="mt-2 text-[10px] font-semibold text-amber-800">${milestones}</p>`
                            : ''}
                    </div>
                `;
            })
            .join('');

        const currentTeam = latestState.playerTeam || team;

        const tendencies =
            typeof Game.previewCoachTendencies === 'function'
                ? Game.previewCoachTendencies(candidate, currentTeam)
                : null;

        const profileHtml = `
            <div class="space-y-4 text-left">
                <section class="rounded-lg border border-slate-700 bg-slate-900 p-4 text-white">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h4 class="text-lg font-black">
                                ${escapeProfileText(candidate.name || 'Unnamed Coach')}
                            </h4>
                            <p class="mt-1 text-xs text-slate-300">
                                Age ${escapeProfileText(candidate.age ?? '—')}
                                · ${escapeProfileText(personality.displayName || personality.name || 'Unknown personality')}
                            </p>
                        </div>
                        ${candidate.formerPlayerBio ? `
                            <span class="rounded bg-amber-400 px-2 py-1 text-[10px] font-bold text-slate-950">
                                PARK ALUMNI
                            </span>
                        ` : ''}
                    </div>

                    ${candidate.formerPlayerBio ? `
                        <p class="mt-3 border-t border-slate-700 pt-3 text-xs leading-relaxed text-amber-100">
                            ${escapeProfileText(candidate.formerPlayerBio)}
                        </p>
                    ` : ''}
                </section>

                <section>
                    <h5 class="mb-2 text-xs font-black uppercase tracking-wide text-slate-700">
                        Coaching skill ratings
                    </h5>
                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        ${profileSkills.map(([label, key]) => `
                            <div class="rounded border border-slate-200 bg-slate-50 p-3">
                                <span class="block text-[10px] leading-tight text-slate-500">
                                    ${label}
                                </span>
                                <span class="mt-1 block font-mono text-xl font-black tabular-nums text-slate-900">
                                    ${candidateRating(candidate, key) ?? '—'}
                                </span>
                            </div>
                        `).join('')}
                    </div>
                </section>

                <section class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div class="rounded border border-slate-200 p-3">
                        <span class="block text-[10px] font-bold uppercase text-slate-500">
                            General fit
                        </span>
                        <span class="mt-1 block text-xl font-black text-slate-900">
                            ${getCandidateRoleFit(candidate, 'general') ?? '—'}
                        </span>
                    </div>
                    <div class="rounded border border-slate-200 p-3">
                        <span class="block text-[10px] font-bold uppercase text-slate-500">
                            Scouting fit
                        </span>
                        <span class="mt-1 block text-xl font-black text-slate-900">
                            ${getCandidateRoleFit(candidate, 'scouting') ?? '—'}
                        </span>
                    </div>
                    <div class="rounded border border-slate-200 p-3">
                        <span class="block text-[10px] font-bold uppercase text-slate-500">
                            Training fit
                        </span>
                        <span class="mt-1 block text-xl font-black text-slate-900">
                            ${getCandidateRoleFit(candidate, 'training') ?? '—'}
                        </span>
                    </div>
                </section>

                <section class="space-y-3">
                    <div class="rounded border border-slate-200 p-3">
                        <h5 class="text-xs font-black uppercase tracking-wide text-slate-700">
                            Tactical philosophy
                        </h5>
                        <p class="mt-1 text-sm font-bold text-slate-900">
                            ${escapeProfileText(tactical.displayName || tactical.name || 'Adaptive Strategist')}
                        </p>
                        <p class="mt-1 text-xs leading-relaxed text-slate-600">
                            ${escapeProfileText(tactical.desc || 'No tactical notes available.')}
                        </p>
                    </div>

                    <div class="rounded border border-slate-200 p-3">
                        <h5 class="text-xs font-black uppercase tracking-wide text-slate-700">
                            Scouting style
                        </h5>
                        <p class="mt-1 text-sm font-bold text-slate-900">
                            ${escapeProfileText(scouting.displayName || scouting.name || 'Balanced Evaluator')}
                        </p>
                        <p class="mt-1 text-xs leading-relaxed text-slate-600">
                            ${escapeProfileText(scouting.desc || 'No scouting notes available.')}
                        </p>
                    </div>

                    <div class="rounded border border-slate-200 p-3">
                        <h5 class="text-xs font-black uppercase tracking-wide text-slate-700">
                            Personality
                        </h5>
                        <p class="mt-1 text-sm font-bold text-slate-900">
                            ${escapeProfileText(personality.displayName || personality.name || 'Analytical Planner')}
                        </p>
                        <p class="mt-1 text-xs leading-relaxed text-slate-600">
                            ${escapeProfileText(personality.desc || 'No personality notes available.')}
                        </p>
                    </div>
                </section>

                <section class="rounded border border-slate-200 bg-slate-50 p-3">
                    <h5 class="text-xs font-black uppercase tracking-wide text-slate-700">
                        Market information
                    </h5>
                    <div class="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                        <div>
                            <span class="block text-slate-500">Stipend demand</span>
                            <span class="font-mono font-bold text-slate-900">
                                ${Number.isFinite(Number(candidate.stipendDemand))
                                    ? `$${Math.max(0, Number(candidate.stipendDemand))}`
                                    : 'Not listed'}
                            </span>
                        </div>
                        <div>
                            <span class="block text-slate-500">Weeks unemployed</span>
                            <span class="font-mono font-bold text-slate-900">
                                ${Number.isFinite(Number(candidate.weeksUnemployed))
                                    ? Math.max(0, Math.floor(Number(candidate.weeksUnemployed)))
                                    : '—'}
                            </span>
                        </div>
                        <div>
                            <span class="block text-slate-500">Skill average</span>
                            <span class="font-mono font-bold text-slate-900">
                                ${getCandidateMetric(candidate, 'overall') ?? '—'}
                            </span>
                        </div>
                    </div>
                </section>

                <section class="space-y-3">
                    <div>
                        <h5 class="text-xs font-black uppercase tracking-wide text-slate-700">
                            Coaching Experience
                        </h5>
                        <p class="mt-1 text-[10px] text-slate-500">
                            Recorded coaching history and completed season results.
                        </p>
                    </div>

                    ${careerHistory.length > 0 ? `
                        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            <div class="rounded border border-slate-200 bg-slate-50 p-3">
                                <span class="block text-[9px] font-bold uppercase text-slate-500">
                                    Seasons
                                </span>
                                <span class="text-lg font-black text-slate-900">
                                    ${careerHistory.length}
                                </span>
                            </div>

                            <div class="rounded border border-slate-200 bg-slate-50 p-3">
                                <span class="block text-[9px] font-bold uppercase text-slate-500">
                                    Career Record
                                </span>
                                <span class="text-lg font-black text-slate-900">
                                    ${careerTotals.wins}-${careerTotals.losses}-${careerTotals.ties}
                                </span>
                            </div>

                            <div class="rounded border border-slate-200 bg-slate-50 p-3">
                                <span class="block text-[9px] font-bold uppercase text-slate-500">
                                    Win Percentage
                                </span>
                                <span class="text-lg font-black text-slate-900">
                                    ${careerWinPercentage == null
                                        ? '—'
                                        : `${careerWinPercentage}%`}
                                </span>
                            </div>
                        </div>

                        ${careerTotals.headCoachSeasons > 0 ? `
                            <p class="text-[10px] font-semibold text-slate-600">
                                ${careerTotals.headCoachSeasons} season${careerTotals.headCoachSeasons === 1 ? '' : 's'} as a head coach.
                            </p>
                        ` : ''}

                        <div class="space-y-2">
                            ${careerHistoryRows}
                        </div>

                        ${careerHistory.length > 6 ? `
                            <p class="text-center text-[10px] text-slate-500">
                                Showing the six most recent seasons of ${careerHistory.length} recorded seasons.
                            </p>
                        ` : ''}
                    ` : `
                        <p class="rounded border border-dashed border-slate-300 bg-slate-50 p-3 text-center text-[10px] text-slate-500">
                            No recorded coaching seasons yet. This candidate may be new to coaching or entering from another background.
                        </p>
                    `}
                </section>

                ${tendencies ? `
                    <section class="rounded border border-slate-200 p-3">
                        <h5 class="text-xs font-black uppercase tracking-wide text-slate-700">
                            Expected play-calling tendencies
                        </h5>
                        <div class="mt-2 grid grid-cols-3 gap-2 text-center">
                            <div class="rounded bg-slate-50 p-2">
                                <span class="block text-[9px] text-slate-500">Run tendency</span>
                                <span class="font-mono font-black text-slate-900">
                                    ${Number(tendencies.earlyDownTendency) || 0}%
                                </span>
                            </div>
                            <div class="rounded bg-slate-50 p-2">
                                <span class="block text-[9px] text-slate-500">Blitz</span>
                                <span class="font-mono font-black text-slate-900">
                                    ${Number(tendencies.defenseAggressiveness) || 0}%
                                </span>
                            </div>
                            <div class="rounded bg-slate-50 p-2">
                                <span class="block text-[9px] text-slate-500">4th down</span>
                                <span class="font-mono font-black text-slate-900">
                                    ${Number(tendencies.fourthDownBravery) || 0}%
                                </span>
                            </div>
                        </div>
                    </section>
                ` : ''}
            </div>
        `;

        showModal(
            `Candidate Profile: ${escapeProfileText(candidate.name || 'Unnamed Coach')}`,
            profileHtml,
            null,
            null,
            null,
            'Close'
        );
    };

    container.innerHTML = `
        <section class="mb-4 bg-slate-900 text-white rounded p-4 border border-slate-700">
            <div class="flex flex-wrap justify-between items-center gap-3">
                <div>
                    <h3 class="text-lg font-black uppercase tracking-wide text-amber-400">
                        Staff Carousel
                    </h3>
                    <p class="text-xs text-slate-300 mt-1">
                        Compare skill ratings, specialty fit, personality, tactical
                        philosophy, and stipend demands. Skill Avg. is a broad summary,
                        not a role-fit score.
                        ${openCoachingSlots > 0
                            ? `${openCoachingSlots} coaching position${openCoachingSlots === 1 ? '' : 's'} available to fill.`
                            : 'All three coaching positions are occupied; hiring requires replacing a current coach.'}
                    </p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <span class="text-xs font-bold bg-amber-500 text-slate-950 rounded px-3 py-2">
                        STAFF REVIEW · DAY ${staffReviewDay} / ${staffReviewDays}
                    </span>
                    <span class="text-xs font-mono bg-slate-800 border border-slate-700 rounded px-3 py-2">
                        ${displayCandidates.length} matching candidates
                    </span>
                </div>
            </div>
        </section>

        <section class="mb-3 flex flex-col xl:flex-row xl:items-end justify-between gap-3 rounded border border-slate-300 bg-white p-3">
            <div class="flex flex-col sm:flex-row sm:items-end gap-2">
                <form
                    class="flex flex-col sm:flex-row sm:items-end gap-2"
                    onsubmit="event.preventDefault(); app_applyStaffCarouselSearch()">
                    <label class="block">
                        <span class="block text-[10px] font-bold uppercase tracking-wide text-slate-600 mb-1">
                            Search candidates
                        </span>
                        <input
                            id="staff-carousel-search"
                            type="search"
                            value="${escapeStaffAttribute(staffCarouselSearch)}"
                            placeholder="Name, personality, style..."
                            class="w-full sm:w-64 rounded border border-slate-300 px-3 py-2 text-xs outline-none focus:border-blue-500">
                    </label>
                    <button
                        type="submit"
                        class="rounded bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800">
                        Search
                    </button>
                </form>

                <div class="relative">
                    <span class="block text-[10px] font-bold uppercase tracking-wide text-slate-600 mb-1">
                        Sort candidates
                    </span>
                    <button type="button" id="staff-carousel-sort-trigger" aria-expanded="false" aria-controls="staff-carousel-sort-menu" onclick="window.app_toggleStaffCarouselSortMenu()" class="flex w-full sm:w-44 items-center justify-between gap-2 rounded border border-slate-300 bg-white px-2 py-2 text-left text-xs font-semibold text-slate-700 hover:border-slate-500">
                        <span class="truncate">${({ overall: 'Skill average', name: 'Name', offense: 'Offense scheme', defense: 'Defense scheme', scouting: 'Scouting', teaching: 'Teaching', gameplan: 'Game planning', stipend: 'Stipend demand', roleFit: 'Selected role fit' })[staffCarouselSort] || 'Skill average'}</span>
                        <span aria-hidden="true" class="text-slate-400">▾</span>
                    </button>
                    <div id="staff-carousel-sort-menu" class="absolute left-0 top-full z-30 mt-1 hidden w-56 rounded border border-slate-300 bg-white p-1 shadow-xl">
                        ${[
                            ['overall', 'Skill average'],
                            ['name', 'Name'],
                            ['offense', 'Offense scheme'],
                            ['defense', 'Defense scheme'],
                            ['scouting', 'Scouting'],
                            ['teaching', 'Teaching'],
                            ['gameplan', 'Game planning'],
                            ['stipend', 'Stipend demand'],
                            ['roleFit', 'Selected role fit']
                        ].map(([value, label]) => `
                            <button type="button" aria-pressed="${staffCarouselSort === value}" onclick="app_setStaffCarouselSort('${value}')" class="block w-full rounded-sm px-2 py-1.5 text-left text-xs ${staffCarouselSort === value ? 'bg-slate-900 font-bold text-white' : 'text-slate-700 hover:bg-slate-100'}">${label}</button>
                        `).join('')}
                    </div>
                </div>

                <div>
                    <span class="block text-[10px] font-bold uppercase tracking-wide text-slate-600 mb-1">
                        Fit focus
                    </span>
                    <div class="flex rounded border border-slate-300 bg-white p-0.5" role="group" aria-label="Candidate role fit">
                        ${[
                            ['general', 'General'],
                            ['scouting', 'Scouting'],
                            ['training', 'Training']
                        ].map(([value, label]) => `
                            <button type="button" aria-pressed="${staffCarouselFitRole === value}" onclick="app_setStaffCarouselFitRole('${value}')" class="flex-1 rounded-sm px-2 py-1.5 text-[10px] font-bold ${staffCarouselFitRole === value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}">${label}</button>
                        `).join('')}
                    </div>
                </div>

                <button
                    type="button"
                    class="rounded border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    onclick="app_toggleStaffCarouselSortDirection()">
                    ${staffCarouselSortDirection === 'asc' ? '↑ Ascending' : '↓ Descending'}
                </button>

                <button
                    type="button"
                    class="rounded border border-slate-300 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
                    onclick="app_resetStaffCarouselFilters()">
                    Reset
                </button>
            </div>

            <p class="text-[11px] font-mono text-slate-500">
                Showing <b class="text-slate-900">${displayCandidates.length}</b>
                of <b class="text-slate-900">${candidates.length}</b> candidates
            </p>
        </section>

        <div class="overflow-x-auto rounded border border-slate-300 bg-white shadow-sm">
            <table class="w-full min-w-[1100px] text-left text-xs">
                <thead class="sticky top-0 z-10 bg-slate-100 text-[10px] uppercase tracking-wide text-slate-600">
                    <tr>
                        <th class="px-3 py-2.5">Candidate</th>
                        <th class="px-2 py-2.5 text-center">Skill Avg.</th>
                        <th class="px-2 py-2.5 text-center">Role Fit</th>
                        <th class="px-2 py-2.5 text-center">Offense</th>
                        <th class="px-2 py-2.5 text-center">Defense</th>
                        <th class="px-2 py-2.5 text-center">Scouting</th>
                        <th class="px-2 py-2.5 text-center">Teaching</th>
                        <th class="px-2 py-2.5 text-center">Planning</th>
                        <th class="px-2 py-2.5 text-center">Practice</th>
                        <th class="px-2 py-2.5 text-center">Demand</th>
                        <th class="px-2 py-2.5 text-center">Weeks</th>
                        <th class="px-3 py-2.5 text-right">Action</th>
                    </tr>
                </thead>

                <tbody class="divide-y divide-slate-200">
                    ${displayCandidates.length > 0
                        ? displayCandidates.map(s => {
                            const personality = s.biases?.personality || {};

                            const overall = getCandidateMetric(s, 'overall');
                            const roleFit = getCandidateMetric(s, 'roleFit');
                            const offense = getCandidateMetric(s, 'offense');
                            const defense = getCandidateMetric(s, 'defense');
                            const scoutingScore = getCandidateMetric(s, 'scouting');
                            const teaching = getCandidateMetric(s, 'teaching');
                            const planning = getCandidateMetric(s, 'gameplan');
                            const practice = averageRatings([
                                candidateRating(s, 'practiceDiscipline'),
                                candidateRating(s, 'conditioning')
                            ]);
                            const stipend = getCandidateMetric(s, 'stipend');

                            const weeksValue = Number(s.weeksUnemployed);
                            const weeksUnemployed = Number.isFinite(weeksValue)
                                ? Math.max(0, Math.floor(weeksValue))
                                : null;

                            const scoreCell = value => `
                                <td class="px-2 py-2.5 text-center">
                                    <span class="font-mono text-sm font-black tabular-nums ${
                                        value !== null && value !== undefined
                                            ? 'text-slate-900'
                                            : 'text-slate-400'
                                    }">
                                        ${value ?? '—'}
                                    </span>
                                </td>
                            `;

                            return `
                                <tr class="align-top hover:bg-blue-50/40">
                                                                        <td class="px-3 py-2.5">
                                        <div class="min-w-0">
                                            <div class="flex items-center gap-2">
                                                <span class="font-bold text-slate-900">
                                                    ${escapeStaffAttribute(s.name || 'Unnamed Coach')}
                                                </span>
                                                ${s.formerPlayerBio ? `
                                                    <span class="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-900">
                                                        Alumni
                                                    </span>
                                                ` : ''}
                                            </div>

                                            <p class="mt-0.5 text-[10px] text-slate-500">
                                                Age ${escapeStaffAttribute(s.age ?? '—')}
                                                · ${escapeStaffAttribute(personality.displayName || personality.name || 'Unknown personality')}
                                            </p>

                                            <button
                                                type="button"
                                                data-staff-id="${escapeStaffAttribute(s.id)}"
                                                class="mt-2 rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-bold text-blue-700 hover:bg-blue-50"
                                                onclick="app_viewStaffCandidate(this.dataset.staffId)">
                                                View Profile
                                            </button>
                                        </div>
                                    </td>

                                    ${scoreCell(overall)}
                                    ${scoreCell(roleFit)}
                                    ${scoreCell(offense)}
                                    ${scoreCell(defense)}
                                    ${scoreCell(scoutingScore)}
                                    ${scoreCell(teaching)}
                                    ${scoreCell(planning)}
                                    ${scoreCell(practice)}

                                    <td class="px-2 py-2.5 text-center">
                                        <span class="font-mono font-bold tabular-nums text-slate-800">
                                            ${stipend === null ? '—' : `$${stipend}`}
                                        </span>
                                    </td>

                                    <td class="px-2 py-2.5 text-center font-mono tabular-nums text-slate-600">
                                        ${weeksUnemployed ?? '—'}
                                    </td>

                                    <td class="px-3 py-2.5 text-right">
                                        <button
                                            type="button"
                                            data-staff-id="${escapeStaffAttribute(s.id)}"
                                            class="whitespace-nowrap rounded bg-slate-900 px-3 py-2 text-[10px] font-bold text-white hover:bg-slate-700"
                                            onclick="app_hireStaff(this.dataset.staffId, 'coach')">
                                            ${openCoachingSlots > 0 ? 'Fill Vacancy' : 'Review Replacement'}
                                        </button>
                                    </td>
                                </tr>
                            `;
                        }).join('')
                        : `
                            <tr>
                                <td colspan="12" class="px-4 py-8 text-center">
                                    <p class="font-bold text-slate-700">
                                        No matching candidates
                                    </p>
                                    <p class="mt-1 text-xs text-slate-500">
                                        Try another search or reset your filters.
                                    </p>
                                </td>
                            </tr>
                        `
                    }
                </tbody>
            </table>
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

    const team = gameState.playerTeam;

    const unavailableCount = roster.filter(
        player => Number(player.status?.duration) > 0
    ).length;

    const readyCount = roster.length - unavailableCount;

    const offenseStarterIds = new Set(
        Object.values(team.depthChart?.offense || {})
            .filter(id => id != null)
            .map(id => String(id))
    );

    const defenseStarterIds = new Set(
        Object.values(team.depthChart?.defense || {})
            .filter(id => id != null)
            .map(id => String(id))
    );

    const twoWayStarterCount = roster.filter(player =>
        offenseStarterIds.has(String(player.id)) &&
        defenseStarterIds.has(String(player.id))
    ).length;

    const averageRosterEnergy = roster.length
        ? Math.round(
            roster.reduce((sum, player) => {
                const fatigue = Number(player.fatigue) || 0;

                return sum + Math.max(
                    0,
                    Math.min(100, 100 - fatigue)
                );
            }, 0) / roster.length
        )
        : null;

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
        <div class="space-y-3 bg-white border-b border-slate-200 p-3">

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div class="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                    <span class="block text-[9px] font-bold uppercase tracking-wide text-slate-500">
                        Rostered
                    </span>
                    <span class="block text-xl font-black tabular-nums text-slate-900">
                        ${roster.length}
                    </span>
                    <span class="text-[9px] text-slate-500">
                        Total players
                    </span>
                </div>

                <div class="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                    <span class="block text-[9px] font-bold uppercase tracking-wide text-slate-500">
                        Available
                    </span>
                    <span class="block text-xl font-black tabular-nums ${
                        readyCount >= 14 ? 'text-emerald-700' : 'text-amber-700'
                    }">
                        ${readyCount}
                    </span>
                    <span class="text-[9px] text-slate-500">
                        ${unavailableCount} unavailable
                    </span>
                </div>

                <div class="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                    <span class="block text-[9px] font-bold uppercase tracking-wide text-slate-500">
                        Two-Way Starters
                    </span>
                    <span class="block text-xl font-black tabular-nums text-amber-700">
                        ${twoWayStarterCount}
                    </span>
                    <span class="text-[9px] text-slate-500">
                        Starting both sides
                    </span>
                </div>

                <div class="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                    <span class="block text-[9px] font-bold uppercase tracking-wide text-slate-500">
                        Average Energy
                    </span>
                    <span class="block text-xl font-black tabular-nums text-slate-900">
                        ${averageRosterEnergy !== null
                            ? `${averageRosterEnergy}%`
                            : '—'}
                    </span>
                    <span class="text-[9px] text-slate-500">
                        Squad-wide
                    </span>
                </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2">
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
                    Select a player to open their profile
                </span>
            </div>
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

    // Summarize the two strongest players who can actually fill each position.
    const roomSummaries = positions.map(pos => {
        const eligiblePlayers = roster
            .filter(player =>
                Game.isPlayerViableForPosition(
                    getPlayerForPositionRatings(player),
                    pos
                )
            )
            .map(player => ({
                player,
                overall: calculateOverall(
                    getPlayerForPositionRatings(player),
                    pos
                )
            }))
            .sort((a, b) => b.overall - a.overall);

        return {
            pos,
            bestFit: eligiblePlayers[0] || null,
            nextFit: eligiblePlayers[1] || null
        };
    });

    pane.innerHTML = `
        <div class="grid grid-cols-1 2xl:grid-cols-[minmax(220px,0.62fr)_minmax(0,2.38fr)] gap-3 items-start min-w-0">
            <!-- Top Strategic Radar: Position Room Strength -->
            <div class="min-w-0 bg-slate-900 text-white rounded p-3 border border-slate-700 shadow-sm shrink-0">
            <div class="flex justify-between items-center mb-2 pb-1 border-b border-slate-800">
                <span class="text-[10px] font-black uppercase tracking-wider text-amber-400">Top Positional Fits</span>
                <span class="text-[10px] text-slate-400 font-mono">Ability, not lineup assignment</span>
            </div>
                <div class="grid grid-cols-2 sm:grid-cols-4 2xl:grid-cols-2 gap-2">
                ${roomSummaries.map(r => `
                    <div class="bg-slate-800/80 p-2 rounded border border-slate-700">
                        <span class="text-[10px] font-black uppercase text-slate-300 block">${r.pos}</span>
                        <div class="mt-1 flex items-center justify-between gap-2 text-[9px]">
                            <span class="min-w-0 truncate text-slate-300" title="${r.bestFit?.player.name || 'No eligible fit'}">Best · ${r.bestFit?.player.name || 'No eligible fit'}</span>
                            <b class="shrink-0 text-sm font-black ${r.bestFit?.overall >= 65 ? 'text-emerald-400' : (r.bestFit?.overall >= 50 ? 'text-amber-400' : 'text-slate-400')}">${r.bestFit?.overall ?? '—'}</b>
                        </div>
                        <div class="mt-0.5 flex items-center justify-between gap-2 text-[9px]">
                            <span class="min-w-0 truncate text-slate-500" title="${r.nextFit?.player.name || 'No second eligible fit'}">Next · ${r.nextFit?.player.name || '—'}</span>
                            <span class="shrink-0 font-mono text-slate-400">${r.nextFit?.overall ?? '—'}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>

        <!-- Master 8-Way Versatility Matrix Table -->
            <div class="min-w-0 bg-white rounded border border-slate-200 shadow-sm overflow-x-auto">
        <table class="w-full min-w-[1100px] table-fixed text-xs font-mono">
            <colgroup>
            <col style="width: 20%">
            <col style="width: 5%">
            <col style="width: 4%">
            <col style="width: 4%">
            <col style="width: 4%">
            <col style="width: 5.5%">
            <col style="width: 5.5%">
            <col style="width: 5.5%">
            <col style="width: 5.5%">
            <col style="width: 5.5%">
            <col style="width: 5.5%">
            <col style="width: 5.5%">
            <col style="width: 5.5%">
            <col style="width: 19%">
            </colgroup>
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
                        const offSlots = Object.entries(offChart)
                            .filter(([, id]) => String(id) === String(p.id))
                            .map(([slot]) => slot);
                        const defSlots = Object.entries(defChart)
                            .filter(([, id]) => String(id) === String(p.id))
                            .map(([slot]) => slot);
                        const isPR = String(stChart.PR) === String(p.id);

                        const rolesBadge = [
                            ...offSlots.map(slot =>
                                `<span class="bg-blue-50 text-blue-800 border border-blue-200 px-1 rounded text-[9px] font-bold font-sans">${slot}</span>`
                            ),
                            ...defSlots.map(slot =>
                                `<span class="bg-red-50 text-red-800 border border-red-200 px-1 rounded text-[9px] font-bold font-sans">${slot}</span>`
                            ),
                            ...(!offSlots.length && !defSlots.length
                                ? ['<span class="text-slate-400 font-sans text-[10px]">Reserve</span>']
                                : []),
                            ...(isPR
                                ? ['<span class="bg-purple-100 text-purple-900 border border-purple-200 px-1 rounded text-[9px] font-black font-sans">PR</span>']
                                : [])
                        ].join(' ');

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

    const otherFormKey = formations[otherSide] ||
        (otherSide === 'offense' ? 'Balanced' : '3-2-3');

    const offenseFormKey = side === 'offense' ? formKey : otherFormKey;
    const defenseFormKey = side === 'defense' ? formKey : otherFormKey;

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

                const slotLabel = getFormationSlotLabel(side, formKey, slotId);
                const hasRoleRating = slotLabel !== slotId;
                const ratingPosition = hasRoleRating ? slotLabel : posKey;
                const displayPosition = hasRoleRating ? slotLabel : posKey;

                const ovr = player ? calculateOverall(player, ratingPosition) : '--';
                const shortName = player ? getPlayerLastNameForStats(player) : 'EMPTY';
                const energy = player ? Math.max(0, Math.round(100 - (player.fatigue || 0))) : 100;
                const isUnavailable = player && player.status?.duration > 0;

                // Two-Way check
                const otherSlot = player ? Object.entries(otherChart).find(([_, id]) => id === player.id)?.[0] : null;
                const otherSlotLabel = otherSlot
                    ? getFormationSlotLabel(otherSide, otherFormKey, otherSlot)
                    : null;

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
                            ${slotLabel}
                        </span>

                        <!-- Punchy, Scaled-Up Avatar Circle (w-11 h-11) -->
                        <div class="relative w-11 h-11 rounded-full border-2 ${ringColor} shadow-xl flex flex-col items-center justify-center ${player ? 'bg-slate-900 text-white' : 'bg-slate-800/90 border-dashed border-slate-500 text-slate-400'} group-hover:scale-105 transition-transform">
                            <span class="text-[8px] font-mono text-slate-400 leading-none">${displayPosition}</span>
                            <span class="text-sm font-black leading-none mt-0.5">${ovr}</span>
                            ${isUnavailable ? '<span class="absolute -top-1 -right-1 text-[10px]">🩹</span>' : ''}
                            
                            <!-- Integrated Two-Way Ironman Badge -->
                            ${otherSlot ? `
                                <span class="absolute -bottom-1 -right-1.5 z-20 text-[7.5px] font-black uppercase px-1 py-0.2 rounded shadow-md border ${side === 'offense' ? 'bg-rose-950 text-rose-300 border-rose-800' : 'bg-blue-950 text-blue-300 border-blue-800'}" title="Also starts at ${otherSlotLabel} on ${otherSide}">
                                    ⚡${otherSlotLabel}
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

        const offSlotLabel = offSlot
            ? getFormationSlotLabel('offense', offenseFormKey, offSlot)
            : null;
        const defSlotLabel = defSlot
            ? getFormationSlotLabel('defense', defenseFormKey, defSlot)
            : null;

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
                    ${offSlot ? `<span class="bg-blue-50 text-blue-800 border border-blue-300 font-black px-1.5 py-0.5 rounded text-[10px]">${offSlotLabel}</span>` : '<span class="text-slate-300">--</span>'}
                </td>
                <td class="text-center py-2 px-2">
                    ${defSlot ? `<span class="bg-red-50 text-red-800 border border-red-300 font-black px-1.5 py-0.5 rounded text-[10px]">${defSlotLabel}</span>` : '<span class="text-slate-300">--</span>'}
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
                ${games.map(g => {
                    const isPlayed = Boolean(g.played || (g.homeScore != null && g.awayScore != null));
                    const awayScoreBadge = isPlayed ? `<span class="ml-1 px-1 rounded bg-slate-100 font-black text-slate-800 text-[11px]">${g.awayScore}</span>` : '';
                    const homeScoreBadge = isPlayed ? `<span class="ml-1 px-1 rounded bg-slate-100 font-black text-slate-800 text-[11px]">${g.homeScore}</span>` : '';
                    const centerBadge = isPlayed
                        ? `<span class="text-[9px] bg-slate-200 text-slate-700 font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">Final</span>`
                        : `<span class="text-gray-400 font-mono text-[10px]">@</span>`;
                    return `<div class="bg-white p-2 rounded border border-gray-200 shadow-sm flex justify-between items-center">
                        <span class="font-semibold text-gray-800 flex items-center">${g.away.name}${awayScoreBadge}</span>
                        ${centerBadge}
                        <span class="font-semibold text-gray-800 flex items-center">${g.home.name}${homeScoreBadge}</span>
                    </div>`;
                }).join('')}
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

window.app_toggleStatsPopover = function(popoverId, triggerId) {
    const popover = document.getElementById(popoverId);
    const trigger = document.getElementById(triggerId);
    if (!popover || !trigger) return;

    const isOpening = popover.classList.contains('hidden');

    document.querySelectorAll('.stats-popover').forEach(panel =>
        panel.classList.add('hidden')
    );
    document.querySelectorAll('[data-stats-popover-trigger]').forEach(button =>
        button.setAttribute('aria-expanded', 'false')
    );

    if (isOpening) {
        popover.classList.remove('hidden');
        trigger.setAttribute('aria-expanded', 'true');
        popover.querySelector('input')?.focus();
    }
};

window.app_setStatsLeagueFilter = function(league) {
    const input = document.getElementById('stats-filter-league');
    if (!input) return;

    input.value = league;
    document.querySelectorAll('.stats-league-button').forEach(button => {
        const selected = button.dataset.league === league;
        button.setAttribute('aria-pressed', String(selected));
        button.classList.toggle('is-active', selected);
    });

    renderPlayerStatsTab(getGameState());
};

window.app_filterStatsTeams = function() {
    const query = String(
        document.getElementById('stats-team-search')?.value || ''
    ).trim().toLowerCase();

    document.querySelectorAll('[data-stats-team-name]').forEach(button => {
        button.hidden = !String(button.dataset.statsTeamName || '')
            .toLowerCase()
            .includes(query);
    });
};

window.app_selectStatsTeam = function(teamId, teamName) {
    const input = document.getElementById('stats-filter-team');
    const label = document.getElementById('stats-team-label');
    if (!input || !label) return;

    input.value = String(teamId || '');
    label.textContent = teamName || 'All Teams';
    document.getElementById('stats-team-popover')?.classList.add('hidden');
    document.getElementById('stats-team-trigger')?.setAttribute('aria-expanded', 'false');
    renderPlayerStatsTab(getGameState());
};

window.app_filterStatsSort = function() {
    const query = String(
        document.getElementById('stats-sort-search')?.value || ''
    ).trim().toLowerCase();

    document.querySelectorAll('[data-stats-sort-label]').forEach(button => {
        button.hidden = !String(button.dataset.statsSortLabel || '')
            .toLowerCase()
            .includes(query);
    });
};

window.app_selectStatsSort = function(key, label) {
    const input = document.getElementById('stats-sort');
    const selectedLabel = document.getElementById('stats-sort-label');
    if (!input || !selectedLabel) return;

    input.value = key;
    selectedLabel.textContent = label;
    document.getElementById('stats-sort-popover')?.classList.add('hidden');
    document.getElementById('stats-sort-trigger')?.setAttribute('aria-expanded', 'false');
    renderPlayerStatsTab(getGameState());
};

window.app_setLeagueStatsView = function (view) {
    if (!['all', 'offense', 'defense'].includes(view)) return;

    leagueStatsView = view;
    renderPlayerStatsTab(getGameState());
};

export function renderPlayerStatsTab(gameState) {
    if (!elements.playerStatsContainer || !Array.isArray(gameState?.players)) return;

    const teams = Array.isArray(gameState.teams) ? gameState.teams : [];
    const teamById = new Map(teams.map(team => [String(team.id), team]));

    // Populate the searchable team pop-out before any early returns.
    if (elements.statsFilterTeam) {
        const previousTeamId = elements.statsFilterTeam.value || '';

        const sortedTeams = [...teams]
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

        elements.statsFilterTeam.value = teams.some(
            team => String(team.id) === previousTeamId
        ) ? previousTeamId : '';

        const escapeStatsText = value => String(value ?? '').replace(
            /[&<>"']/g,
            character => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            })[character]
        );

        const teamOptions = [
            `<button type="button" data-stats-team-name="all teams" data-team-id="" data-team-label="All Teams" onclick="window.app_selectStatsTeam(this.dataset.teamId, this.dataset.teamLabel)" class="stats-popover-option grid grid-cols-[minmax(0,1fr)_5rem] gap-2 font-bold" role="option"><span>All Teams</span><span class="text-right text-[10px] text-slate-400">League</span></button>`,
            ...sortedTeams.map(team => {
                const name = team.name || 'Unnamed Team';
                const league = team.leagueType === 'youth'
                    ? 'Pee-Wee'
                    : Number(team.tier) === 1
                        ? 'Premier'
                        : Number(team.tier) === 2
                            ? 'Sandlot'
                            : 'League';

                return `<button type="button" data-stats-team-name="${escapeStatsText(name)}" data-team-id="${escapeStatsText(team.id)}" data-team-label="${escapeStatsText(name)}" onclick="window.app_selectStatsTeam(this.dataset.teamId, this.dataset.teamLabel)" class="stats-popover-option grid grid-cols-[minmax(0,1fr)_5rem] gap-2 border-t border-slate-100" role="option"><span class="truncate">${escapeStatsText(name)}</span><span class="text-right text-[10px] text-slate-500">${league}</span></button>`;
            })
        ].join('');

        const teamOptionsElement = document.getElementById('stats-team-options');
        if (teamOptionsElement) teamOptionsElement.innerHTML = teamOptions;

        const selectedTeam = teams.find(
            team => String(team.id) === elements.statsFilterTeam.value
        );
        const teamLabel = document.getElementById('stats-team-label');
        if (teamLabel) {
            teamLabel.textContent = selectedTeam?.name || 'All Teams';
        }
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

    // Keep the sort choices synchronized with the active stat view.
    const previousSort = elements.statsSort?.value || 'touchdowns';

    const sortStat = activeStatColumns.some(stat => stat.key === previousSort)
        ? previousSort
        : activeStatColumns.find(stat => stat.key === 'touchdowns')?.key
            || activeStatColumns[0]?.key
            || 'touchdowns';

    if (elements.statsSort) {
        elements.statsSort.value = sortStat;

        const sortOptions = document.getElementById('stats-sort-options');
        if (sortOptions) {
            sortOptions.innerHTML = activeStatColumns.map(stat => `
                <button
                    type="button"
                    data-stats-sort-label="${stat.label}"
                    data-sort-key="${stat.key}"
                    onclick="window.app_selectStatsSort('${stat.key}', '${stat.label.replace(/'/g, '&#39;')}')"
                    class="stats-popover-option"
                    role="option">
                    ${stat.label}
                </button>
            `).join('');
        }

        const sortLabel = document.getElementById('stats-sort-label');
        if (sortLabel) {
            sortLabel.textContent = activeStatColumns.find(
                stat => stat.key === sortStat
            )?.label || 'Sort statistics';
        }
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

let activeHistoryReportView = 'overview';
let activeHistoryReportYear = null;

window.app_setHistoryReportView = function (view) {
    const debugEnabled =
        typeof Game.isDebugMode === 'function' &&
        Game.isDebugMode();

    const allowedViews = [
        'overview',
        'premier',
        'sandlot',
        'peewee',
        'graduating'
    ];

    if (debugEnabled) {
        allowedViews.push('simulationHealth');
    }

    activeHistoryReportView = allowedViews.includes(view)
        ? view
        : 'overview';

    const gameState = getGameState();

    if (gameState) renderHistoryTab(gameState);
};

window.app_openSeasonReport = function (year) {
    const targetYear = Number(year);

    if (!Number.isInteger(targetYear) || targetYear < 1) return;

    const gameState = getGameState();

    const season = [...(gameState?.history?.seasons || [])]
        .reverse()
        .find(item => Number(item?.year) === targetYear);

    if (!season) return;

    activeHistoryReportYear = targetYear;
    activeHistoryReportView = 'overview';

    renderHistoryTab(gameState);
};

function escapeHistoryHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderHistoryStandings(league) {
    const standings = Array.isArray(league?.standings)
        ? league.standings
        : [];

    if (!standings.length) {
        return '<p class="text-slate-400 py-3">No standings recorded.</p>';
    }

    return `
        <div class="overflow-x-auto">
            <table class="min-w-full text-xs">
                <thead class="bg-slate-800 text-white">
                    <tr>
                        <th class="p-2 text-left">#</th>
                        <th class="p-2 text-left">Team</th>
                        <th class="p-2 text-center">W</th>
                        <th class="p-2 text-center">L</th>
                        <th class="p-2 text-center">T</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                    ${standings.map(team => `
                        <tr>
                            <td class="p-2">${Number(team.place) || '—'}</td>
                            <td class="p-2 font-semibold">
                                ${escapeHistoryHtml(team.name)}
                            </td>
                            <td class="p-2 text-center">${Number(team.wins) || 0}</td>
                            <td class="p-2 text-center">${Number(team.losses) || 0}</td>
                            <td class="p-2 text-center">${Number(team.ties) || 0}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>`;
}

function renderHistoryLeagueReport(season, leagueKey, leagueLabel) {
    const league = season.reportSnapshot?.leagues?.[leagueKey];

    if (!league) {
        return `
            <section class="bg-white rounded-lg border border-slate-200 p-4">
                <h4 class="font-bold text-slate-800">
                    Year ${escapeHistoryHtml(season.year)} — ${leagueLabel}
                </h4>
                <p class="text-sm text-slate-400 mt-2">
                    No detailed report is available for this season.
                </p>
            </section>`;
    }

    const leaderLabels = {
        passing: 'Passing Yards',
        rushing: 'Rushing Yards',
        receiving: 'Receiving Yards',
        defense: 'Tackles',
        scoring: 'Touchdowns'
    };

    const leadersHtml = Object.entries(leaderLabels).map(([key, label]) => {
        const leaders = league.leaders?.[key] || [];

        return `
            <div class="border border-slate-200 rounded-lg p-3">
                <h5 class="font-bold text-slate-600 uppercase text-[10px] tracking-wider mb-2">
                    ${label}
                </h5>
                ${leaders.length
                    ? leaders.map((player, index) => `
                        <div class="flex justify-between gap-3 py-1 text-xs border-b last:border-0 border-slate-100">
                            <div class="min-w-0">
                                <span class="text-slate-400">${index + 1}.</span>
                                <span class="font-semibold text-slate-800">
                                    ${escapeHistoryHtml(player.name)}
                                </span>
                                <span class="block text-slate-400 truncate">
                                    ${escapeHistoryHtml(player.teamName)}
                                    · ${escapeHistoryHtml(player.position)}
                                </span>
                            </div>
                            <span class="font-black text-slate-900 whitespace-nowrap">
                                ${Number(player.value).toLocaleString()}
                            </span>
                        </div>
                    `).join('')
                    : '<p class="text-xs text-slate-400">No recorded production.</p>'}
            </div>`;
    }).join('');

    return `
        <section class="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <div class="bg-slate-900 text-white px-4 py-3 flex flex-wrap justify-between gap-2 items-center">
                <h4 class="font-black uppercase tracking-wide">
                    Year ${escapeHistoryHtml(season.year)} — ${leagueLabel}
                </h4>
                <span class="text-xs text-slate-300">
                    ${Number(league.teamCount) || 0} teams ·
                    ${Number(league.playerCount) || 0} players
                </span>
            </div>
            <div class="p-4">
                <h5 class="font-bold text-slate-700 mb-2">Final Standings</h5>
                ${renderHistoryStandings(league)}
                <h5 class="font-bold text-slate-700 mt-5 mb-3">
                    Top Statistical Performers
                </h5>
                <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    ${leadersHtml}
                </div>
            </div>
        </section>`;
}

function renderHistoryGraduatingClass(season) {
    const players = Array.isArray(season.reportSnapshot?.graduatingClass)
        ? season.reportSnapshot.graduatingClass
        : [];

    return `
        <section class="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <div class="bg-slate-900 text-white px-4 py-3">
                <h4 class="font-black uppercase tracking-wide">
                    Year ${escapeHistoryHtml(season.year)} — Pee Wee Graduation Class
                </h4>
                <p class="text-xs text-slate-300 mt-1">
                    Production and completed youth seasons before the rookie draft.
                </p>
            </div>
            ${players.length ? `
                <div class="overflow-x-auto">
                    <table class="min-w-full text-xs">
                        <thead class="bg-slate-100 text-slate-600">
                            <tr>
                                <th class="p-2 text-left">Player</th>
                                <th class="p-2 text-left">Team</th>
                                <th class="p-2 text-center">Age</th>
                                <th class="p-2 text-center">Seasons</th>
                                <th class="p-2 text-center">Draft Experience</th>
                                <th class="p-2 text-right">Pass Yds</th>
                                <th class="p-2 text-right">Rush Yds</th>
                                <th class="p-2 text-right">Rec Yds</th>
                                <th class="p-2 text-right">TDs</th>
                                <th class="p-2 text-right">Tackles</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${players.map(player => `
                                <tr>
                                    <td class="p-2">
                                        <span class="font-semibold">
                                            ${escapeHistoryHtml(player.name)}
                                        </span>
                                        <span class="block text-slate-400">
                                            ${escapeHistoryHtml(player.position)}
                                        </span>
                                    </td>
                                    <td class="p-2">${escapeHistoryHtml(player.teamName)}</td>
                                    <td class="p-2 text-center">
                                        ${Number(player.ageAtSeasonEnd) || '—'}
                                    </td>
                                    <td class="p-2 text-center">
                                        ${Number(player.youthSeasonsPlayed) || 0}/
                                        ${Number(player.requiredYouthSeasons) || 0}
                                    </td>
                                    <td class="p-2 text-center">
                                        <span class="${
                                            player.meetsDraftExperienceRule
                                                ? 'text-emerald-700'
                                                : 'text-amber-700'
                                        } font-semibold">
                                            ${player.meetsDraftExperienceRule
                                                ? 'Eligible by experience'
                                                : 'Short of requirement'}
                                        </span>
                                    </td>
                                    <td class="p-2 text-right">${Number(player.stats?.passYards) || 0}</td>
                                    <td class="p-2 text-right">${Number(player.stats?.rushYards) || 0}</td>
                                    <td class="p-2 text-right">${Number(player.stats?.recYards) || 0}</td>
                                    <td class="p-2 text-right">${Number(player.stats?.touchdowns) || 0}</td>
                                    <td class="p-2 text-right">${Number(player.stats?.tackles) || 0}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            ` : `
                <p class="p-4 text-sm text-slate-400">
                    No graduating-player data was captured for this season.
                </p>
            `}
        </section>`;
}

function renderHistorySimulationHealth(season) {
    const health = season.reportSnapshot?.debug?.simulationHealth;

    if (!health) {
        return `
            <section class="bg-white rounded-lg border border-slate-200 p-4">
                <h4 class="font-bold text-slate-800">
                    Year ${escapeHistoryHtml(season.year)} — Simulation Health
                </h4>
                <p class="text-sm text-slate-400 mt-2">
                    No diagnostic snapshot is available for this season.
                </p>
            </section>`;
    }

    const diagnostics = Array.isArray(health.diagnostics)
        ? health.diagnostics
        : [];

    const productionColumns = [
        { key: 'passYards', label: 'Pass Yds' },
        { key: 'rushYards', label: 'Rush Yds' },
        { key: 'recYards', label: 'Rec Yds' },
        { key: 'touchdowns', label: 'TDs' },
        { key: 'tackles', label: 'Tackles' }
    ];

    const formatProductionNumber = value =>
        (Number(value) || 0).toLocaleString();

    const renderProductionGroupTable = (title, groups) => {
        const rows = !Array.isArray(groups)
            ? `
                <tr>
                    <td colspan="7" class="p-3 text-slate-400">
                        Not captured for this season. Debug Mode may have
                        been disabled when the season was archived.
                    </td>
                </tr>`
            : groups.length
                ? groups.map(group => `
                    <tr class="border-t border-slate-100">
                        <td class="p-2 font-semibold whitespace-nowrap">
                            ${escapeHistoryHtml(group.group)}
                        </td>
                        <td class="p-2 text-center">
                            ${Number(group.producingPlayers) || 0}/
                            ${Number(group.playerCount) || 0}
                        </td>
                        ${productionColumns.map(column => `
                            <td class="p-2 text-right whitespace-nowrap">
                                ${formatProductionNumber(
                                    group.stats?.[column.key]
                                )}
                            </td>
                        `).join('')}
                    </tr>
                `).join('')
                : `
                    <tr>
                        <td colspan="8" class="p-3 text-slate-400">
                            No player groups recorded.
                        </td>
                    </tr>`;

        return `
            <div class="border border-slate-200 rounded-lg overflow-hidden">
                <h6 class="bg-slate-100 px-3 py-2 font-bold text-xs text-slate-700">
                    ${title}
                </h6>
                <div class="overflow-x-auto">
                    <table class="min-w-full text-xs">
                        <thead class="text-slate-500 bg-white">
                            <tr>
                                <th class="p-2 text-left">Group</th>
                                <th class="p-2 text-center">Producing / Total</th>
                                ${productionColumns.map(column => `
                                    <th class="p-2 text-right whitespace-nowrap">
                                        ${column.label}
                                    </th>
                                `).join('')}
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>`;
    };

    const leagueProductionSections = [
        { key: 'premier', label: 'Premier League' },
        { key: 'sandlot', label: 'Sandlot Circuit' },
        { key: 'peewee', label: 'Pee Wee League' }
    ].map(({ key, label }) => {
        const league = season.reportSnapshot?.leagues?.[key];

        if (!league) return '';

        return `
            <section class="border border-slate-200 rounded-lg p-3 space-y-3">
                <h5 class="font-black text-slate-800 uppercase tracking-wide">
                    ${label} — Production Breakdown
                </h5>
                <p class="text-xs text-slate-500">
                    Production is the combined season total for the group.
                    Producing / Total counts players with at least one recorded
                    passing, rushing, receiving, scoring, or defensive statistic.
                </p>
                ${renderProductionGroupTable(
                    'By Player Age',
                    league.productionByAge
                )}
                ${renderProductionGroupTable(
                    'By Seasons Played',
                    league.productionByExperience
                )}
            </section>`;
    }).join('');

    return `
        <section class="bg-white rounded-lg border border-amber-200 shadow-sm overflow-hidden">
            <div class="bg-amber-50 border-b border-amber-200 p-4">
                <h4 class="font-black text-amber-900 uppercase tracking-wide">
                    Year ${escapeHistoryHtml(season.year)} — Developer Diagnostics
                </h4>
                <p class="text-xs text-amber-800 mt-1">
                    ${Number(health.playersChecked) || 0} players checked ·
                    ${Number(health.warningCount) || 0} warning instances
                </p>
            </div>
            <div class="p-4 space-y-4">
                <div>
                    <h5 class="font-black text-slate-800 uppercase tracking-wide mb-3">
                        Production by Age & Experience
                    </h5>
                    <div class="space-y-4">
                        ${leagueProductionSections}
                    </div>
                </div>

                <div>
                    <h5 class="font-black text-slate-800 uppercase tracking-wide mb-3">
                        Data Integrity Checks
                    </h5>
                    <div class="space-y-3">
                        ${diagnostics.length ? diagnostics.map(item => `
                    <div class="border border-slate-200 rounded-lg p-3">
                        <div class="flex flex-wrap justify-between gap-2">
                            <code class="text-xs font-bold text-slate-800">
                                ${escapeHistoryHtml(item.code)}
                            </code>
                            <span class="text-xs font-bold text-amber-700">
                                ${Number(item.count) || 0} occurrence(s)
                            </span>
                        </div>
                        ${(item.examples || []).length ? `
                            <ul class="mt-2 space-y-1 text-xs text-slate-600">
                                ${item.examples.map(example => `
                                    <li class="border-l-2 border-amber-200 pl-2">
                                        ${escapeHistoryHtml(
                                            [
                                                example.playerName,
                                                example.stat,
                                                example.value !== undefined
                                                    ? `Value: ${example.value}`
                                                    : null,
                                                example.completions !== undefined
                                                    ? `Completions: ${example.completions}`
                                                    : null,
                                                example.attempts !== undefined
                                                    ? `Attempts: ${example.attempts}`
                                                    : null,
                                                example.receptions !== undefined
                                                    ? `Receptions: ${example.receptions}`
                                                    : null,
                                                example.targets !== undefined
                                                    ? `Targets: ${example.targets}`
                                                    : null,
                                                example.teamId !== undefined
                                                    ? `Team ID: ${example.teamId}`
                                                    : null
                                            ].filter(Boolean).join(' · ')
                                        )}
                                    </li>
                                `).join('')}
                            </ul>
                        ` : ''}
                    </div>
                `).join('') : `
                    <p class="text-sm text-emerald-700">
                        No stat-integrity warnings were recorded by these checks.
                    </p>
                `}
                    </div>
                    <p class="text-xs text-slate-400 mt-3">
                        These are targeted integrity checks, not proof that the
                        entire simulation behaved correctly.
                    </p>
                </div>
            </div>
        </section>`;
}

export function renderHistoryTab(gameState) {
    const container = document.getElementById('history-container');
    if (!container) return;

    if (!gameState?.history?.seasons || gameState.history.seasons.length === 0) {
        container.innerHTML = `<p class="text-slate-400 text-center py-12">No history available yet.</p>`;
        return;
    }

    const debugEnabled =
        typeof Game.isDebugMode === 'function' &&
        Game.isDebugMode();

    // Enforce the debug-only view even if a previous selection is stale.
    if (
        !debugEnabled &&
        activeHistoryReportView === 'simulationHealth'
    ) {
        activeHistoryReportView = 'overview';
    }

    const reportViews = [
        { key: 'overview', label: 'Season Overview' },
        { key: 'premier', label: 'Premier' },
        { key: 'sandlot', label: 'Sandlot' },
        { key: 'peewee', label: 'Pee Wee' },
        { key: 'graduating', label: 'Graduating Class' }
    ];

    if (debugEnabled) {
        reportViews.push({
            key: 'simulationHealth',
            label: 'Simulation Health'
        });
    }

    // Deduplicate by year and use only the newest six detailed snapshots.
    // Lightweight records for older years remain in the existing archive.
    const seenReportYears = new Set();
    const reportSeasons = [];

    for (const season of [...gameState.history.seasons].reverse()) {
        if (!season || !season.reportSnapshot) continue;

        const yearKey = String(season.year);

        if (seenReportYears.has(yearKey)) continue;

        seenReportYears.add(yearKey);
        reportSeasons.push(season);

        if (reportSeasons.length >= 6) break;
    }

    // An inbox link takes precedence over the default six-season view.
    // Older seasons can still open their lightweight historical record,
    // even when their detailed report snapshot has been pruned.
    if (activeHistoryReportYear !== null) {
        const selectedSeason = [...gameState.history.seasons]
            .reverse()
            .find(
                season =>
                    Number(season?.year) ===
                    Number(activeHistoryReportYear)
            );

        reportSeasons.length = 0;

        if (selectedSeason) {
            reportSeasons.push(selectedSeason);
        } else {
            activeHistoryReportYear = null;
        }
    }

    let reportContentHtml = '';

    if (activeHistoryReportView === 'overview') {
        const selectedSeason = activeHistoryReportYear !== null
            ? reportSeasons[0]
            : null;

        if (selectedSeason) {
            const premierLeaders =
                selectedSeason.reportSnapshot?.leagues?.premier?.leaders || {};

            const formatLeader = (key, suffix) => {
                const leader = premierLeaders[key]?.[0];

                return leader
                    ? `${escapeHistoryHtml(leader.name)} — ${
                        Number(leader.value).toLocaleString()
                    } ${suffix}`
                    : 'No recorded leader';
            };

            const hasSnapshot = !!selectedSeason.reportSnapshot;

            reportContentHtml = `
                <section class="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
                    <div class="bg-slate-900 text-white p-4">
                        <p class="text-xs uppercase tracking-widest text-slate-300">
                            Season Yearbook
                        </p>
                        <h4 class="font-black text-xl mt-1">
                            Year ${escapeHistoryHtml(selectedSeason.year)}
                        </h4>
                        <p class="text-sm text-amber-300 mt-2">
                            Premier Champion:
                            ${escapeHistoryHtml(selectedSeason.champion)}
                        </p>
                    </div>

                    <div class="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div class="rounded-lg border border-slate-200 p-3">
                            <p class="text-xs font-bold uppercase text-slate-400">
                                Sandlot Champion
                            </p>
                            <p class="font-bold text-slate-800 mt-1">
                                ${escapeHistoryHtml(selectedSeason.tier2Champion || 'Unknown')}
                            </p>
                        </div>

                        <div class="rounded-lg border border-slate-200 p-3">
                            <p class="text-xs font-bold uppercase text-slate-400">
                                Pee Wee Champion
                            </p>
                            <p class="font-bold text-slate-800 mt-1">
                                ${escapeHistoryHtml(selectedSeason.youthChampion || 'Unknown')}
                            </p>
                        </div>

                        <div class="rounded-lg border border-slate-200 p-3">
                            <p class="text-xs font-bold uppercase text-slate-400">
                                Premier Runner-Up
                            </p>
                            <p class="font-bold text-slate-800 mt-1">
                                ${escapeHistoryHtml(selectedSeason.runnerUp || 'Unknown')}
                            </p>
                        </div>
                    </div>

                    ${hasSnapshot ? `
                        <div class="px-4 pb-4">
                            <h5 class="font-bold text-slate-700 mb-2">
                                Premier League Standouts
                            </h5>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                                <p class="rounded bg-slate-50 p-3">
                                    <span class="block text-xs text-slate-400 font-bold uppercase">
                                        Passing
                                    </span>
                                    ${formatLeader('passing', 'yards')}
                                </p>
                                <p class="rounded bg-slate-50 p-3">
                                    <span class="block text-xs text-slate-400 font-bold uppercase">
                                        Rushing
                                    </span>
                                    ${formatLeader('rushing', 'yards')}
                                </p>
                                <p class="rounded bg-slate-50 p-3">
                                    <span class="block text-xs text-slate-400 font-bold uppercase">
                                        Receiving
                                    </span>
                                    ${formatLeader('receiving', 'yards')}
                                </p>
                                <p class="rounded bg-slate-50 p-3">
                                    <span class="block text-xs text-slate-400 font-bold uppercase">
                                        Touchdowns
                                    </span>
                                    ${formatLeader('scoring', 'TDs')}
                                </p>
                            </div>
                        </div>
                    ` : `
                        <p class="px-4 pb-4 text-sm text-slate-500">
                            The detailed snapshot for this older season has
                            been trimmed to conserve storage. Its historical
                            summary and standings remain in the archive below.
                        </p>
                    `}
                </section>`;
        } else {
            reportContentHtml = `
                <div class="rounded-lg border border-slate-200 bg-white p-4">
                    <h4 class="font-bold text-slate-800">The Season Yearbook</h4>
                    <p class="text-sm text-slate-600 mt-1">
                        Explore final standings, statistical leaders and the
                        graduating class. Your full season recap and all-time
                        records remain below.
                    </p>
                    <p class="text-xs text-slate-400 mt-2">
                        Detailed reports are retained for the six most recent
                        seasons; older season summaries remain in the archive.
                    </p>
                </div>`;
        }
    } else if (
        ['premier', 'sandlot', 'peewee'].includes(
            activeHistoryReportView
        )
    ) {
        const leagueConfig = {
            premier: {
                key: 'premier',
                label: 'Premier League'
            },
            sandlot: {
                key: 'sandlot',
                label: 'Sandlot Circuit'
            },
            peewee: {
                key: 'peewee',
                label: 'Pee Wee League'
            }
        }[activeHistoryReportView];

        reportContentHtml = reportSeasons.length
            ? reportSeasons.map(season =>
                renderHistoryLeagueReport(
                    season,
                    leagueConfig.key,
                    leagueConfig.label
                )
            ).join('')
            : `
                <p class="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
                    No detailed yearbook snapshots are available yet.
                    Existing season summaries are still preserved below.
                </p>`;
    } else if (activeHistoryReportView === 'graduating') {
        reportContentHtml = reportSeasons.length
            ? reportSeasons.map(renderHistoryGraduatingClass).join('')
            : `
                <p class="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
                    No detailed graduating-class snapshots are available yet.
                </p>`;
    } else if (
        activeHistoryReportView === 'simulationHealth' &&
        debugEnabled
    ) {
        reportContentHtml = reportSeasons.length
            ? reportSeasons.map(renderHistorySimulationHealth).join('')
            : `
                <p class="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
                    No diagnostic snapshots are available yet.
                </p>`;
    }

    const reportPanelHtml = `
        <section class="rounded-lg border border-slate-200 bg-slate-50 p-3 mb-6">
            <div class="flex flex-wrap gap-2" role="tablist" aria-label="Season yearbook sections">
                ${reportViews.map(view => `
                    <button
                        type="button"
                        role="tab"
                        aria-selected="${activeHistoryReportView === view.key}"
                        onclick="app_setHistoryReportView('${view.key}')"
                        class="px-3 py-2 rounded-md text-xs font-bold transition ${
                            activeHistoryReportView === view.key
                                ? 'bg-slate-900 text-white shadow-sm'
                                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                        }">
                        ${view.label}
                    </button>
                `).join('')}
            </div>
            <div class="mt-3 space-y-4">
                ${reportContentHtml}
            </div>
        </section>`;

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

    let html = '<div class="space-y-4 pb-6">' +
        reportPanelHtml +
        recordsHtml;
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
        const validTabs = [
            "depth-order",
            "offense",
            "defense",
            "overalls",
            "playbook",
            "practice"
        ];

        if (!validTabs.includes(subTab)) return;

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
        } else if (subTab === "defense") {
            renderFormationPills('defense', defenseFormations, gs?.playerTeam?.formations?.defense);
            renderDepthChartSide('defense', gs);
        } else if (subTab === "overalls") {
            renderPositionalOveralls();
        } else if (subTab === "depth-order") {
            renderDepthOrderPane(gs);
        } else if (subTab === "playbook") {
            renderPlaybookManager(gs);
        } else if (subTab === "practice") {
            renderPracticeManager(gs);
        }
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
                    <div class="flex rounded border border-slate-300 bg-white p-0.5" role="group" aria-label="Playcaller control">
                        <button type="button" aria-pressed="${!isGM}" onclick="app_updateClipboard('playcaller', 'COACH')" class="rounded-sm px-2 py-1.5 text-[10px] font-bold ${!isGM ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}">Coach</button>
                        <button type="button" aria-pressed="${isGM}" onclick="app_updateClipboard('playcaller', 'GM')" class="rounded-sm px-2 py-1.5 text-[10px] font-bold ${isGM ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}">GM</button>
                    </div>
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
                        <div class="grid grid-cols-1 gap-1" role="group" aria-label="Practice field arrangement">
                            ${[
                                ['community', 'Community field', 'Free · up to 2 sessions'],
                                ['school', 'School partnership', '$3/week · up to 3'],
                                ['dedicated', 'Dedicated field', '$8/week · up to 3']
                            ].map(([value, title, detail]) => `
                                <button
                                    type="button"
                                    aria-pressed="${practiceFieldAccess === value}"
                                    onclick="app_setPracticeFieldAccess('${value}')"
                                    class="flex items-center justify-between gap-2 rounded-sm border px-2 py-1.5 text-left ${practiceFieldAccess === value ? 'border-emerald-700 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}">
                                    <span class="text-[10px] font-bold">${title}</span>
                                    <span class="text-[9px] text-slate-500">${detail}</span>
                                </button>
                            `).join('')}
                        </div>
                    </div>

                    <div>
                        <label class="block text-[10px] font-black uppercase tracking-wide text-slate-600 mb-1">
                            Sessions per week
                        </label>
                        <div class="flex rounded border border-slate-300 bg-white p-0.5" role="group" aria-label="Sessions per week">
                            ${Array.from(
                                { length: selectedField.maxSessions },
                                (_, index) => index + 1
                            ).map(count => `
                                <button
                                    type="button"
                                    aria-pressed="${sessionsPerWeek === count}"
                                    onclick="app_setPracticeSchedule(${count}, ${minutesPerSession})"
                                    class="flex-1 rounded-sm px-2 py-1.5 text-xs font-bold ${sessionsPerWeek === count ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}">
                                    ${count}
                                </button>
                            `).join('')}
                        </div>
                    </div>

                    <div>
                        <label class="block text-[10px] font-black uppercase tracking-wide text-slate-600 mb-1">
                            Session length
                        </label>
                        <div class="flex items-center gap-2">
                            <input
                                type="number"
                                min="60"
                                max="120"
                                step="30"
                                value="${minutesPerSession}"
                                onchange="app_setPracticeSchedule(${sessionsPerWeek}, this.value)"
                                class="w-20 rounded-sm border border-slate-300 bg-white p-1.5 text-xs font-bold text-slate-800">
                            <span class="text-[10px] font-bold text-slate-500">minutes</span>
                        </div>
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
                <div class="grid w-full grid-cols-2 gap-1 sm:w-auto" role="group" aria-label="General manager directive">
                    ${[
                        ['COACH_AUTONOMY', 'Coach autonomy', 'Let the coach’s profile guide practice.'],
                        ['WIN_NOW', 'Win now', 'Favor preparation for the next opponent.'],
                        ['DEVELOP_YOUTH', 'Develop youth', 'Favor development and playbook learning.'],
                        ['HARD_CONDITIONING', 'Conditioning', 'Favor stamina and physical development.']
                    ].map(([value, label, detail]) => `
                        <button
                            type="button"
                            aria-pressed="${directive === value}"
                            onclick="app_setGmDirective('${value}')"
                            class="rounded-sm border px-2 py-1.5 text-left ${directive === value ? 'border-emerald-700 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}">
                            <span class="block text-[10px] font-black">${label}</span>
                            <span class="block text-[9px] text-slate-500">${detail}</span>
                        </button>
                    `).join('')}
                </div>
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

    const teams = Array.isArray(gameState?.teams) ? gameState.teams : [];
    const currentTeamId = String(selector.value || '');
    const selectedTeam = teams.find(team =>
        String(team.id) === currentTeamId
    ) || teams[0] || null;

    selector.value = selectedTeam?.id == null
        ? ''
        : String(selectedTeam.id);

    const escapeTeamText = value => String(value ?? '').replace(
        /[&<>"']/g,
        character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[character]
    );

    const teamLabel = document.getElementById('draft-team-label');
    if (teamLabel) {
        teamLabel.textContent = selectedTeam?.name || 'No teams available';
    }

    const teamOptions = document.getElementById('draft-team-options');
    if (teamOptions) {
        teamOptions.innerHTML = teams
            .slice()
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
            .map(team => `
                <button
                    type="button"
                    data-draft-team-id="${escapeTeamText(team.id)}"
                    data-draft-team-name="${escapeTeamText(team.name || 'Unnamed Team')}"
                    aria-pressed="${String(team.id) === selector.value}"
                    onclick="window.app_selectDraftTeam(this.dataset.draftTeamId)"
                    class="stats-popover-option ${String(team.id) === selector.value ? 'bg-slate-100 font-bold' : ''}"
                    role="option">
                    ${escapeTeamText(team.name || 'Unnamed Team')}
                </button>
            `).join('');
    }

    const team = selectedTeam;
    const roster = getUIRosterObjects(team);
    rosterDiv.innerHTML = roster.map(p => `
        <div class="flex justify-between py-1 border-b text-xs">
            <span>${p.name}</span><span class="text-gray-500">${estimateBestPosition(p)} (${calculateOverall(p, estimateBestPosition(p))})</span>
        </div>
    `).join('');
}

window.app_toggleDraftTeamPicker = function() {
    const popover = document.getElementById('draft-team-popover');
    const trigger = document.getElementById('draft-team-trigger');
    if (!popover || !trigger) return;

    const isOpening = popover.classList.contains('hidden');
    popover.classList.toggle('hidden', !isOpening);
    trigger.setAttribute('aria-expanded', String(isOpening));

    if (isOpening) {
        document.getElementById('draft-team-search')?.focus();
    }
};

window.app_filterDraftTeams = function() {
    const query = String(
        document.getElementById('draft-team-search')?.value || ''
    ).trim().toLowerCase();

    document.querySelectorAll('[data-draft-team-name]').forEach(button => {
        button.hidden = !button.dataset.draftTeamName
            .toLowerCase()
            .includes(query);
    });
};

window.app_selectDraftTeam = function(teamId) {
    const selector = document.getElementById('draft-team-selector');
    if (!selector) return;

    selector.value = String(teamId);
    document.getElementById('draft-team-popover')?.classList.add('hidden');
    document.getElementById('draft-team-trigger')?.setAttribute('aria-expanded', 'false');
    renderDraftTeamView(getGameState());
};

export function startLiveGameLoop(initialGameState, onComplete) {
    activeLiveGame = initialGameState;
    currentLiveGameResult = { homeTeam: activeLiveGame.homeTeam, awayTeam: activeLiveGame.awayTeam };
    liveGameCallback = onComplete;
    isSkipping = false;
    isPaused = false;
    liveGameCurrentIndex = 0;


    const userTeam = getGameState()?.playerTeam;
    if (!activeLiveGame.liveGmAdjustments) {
        activeLiveGame.liveGmAdjustments = userTeam?.liveGmAdjustments || {
            offenseFocus: 'balanced',
            defenseFocus: 'base',
            fourthDown: 'coach',
            tempo: 'normal'
        };
    }

    const livePlayerTeam = [activeLiveGame.homeTeam, activeLiveGame.awayTeam].find(
        t => t && (t.isPlayerControlled || (userTeam && String(t.id) === String(userTeam.id)))
    );
    if (livePlayerTeam) {
        livePlayerTeam.liveGmAdjustments = activeLiveGame.liveGmAdjustments;
    }

    // Reset sidebar visibility on game start
    const simSidebar = document.getElementById('sim-sidebar');
    if (simSidebar) simSidebar.classList.remove('hidden');
    const toggleIcon = document.getElementById('sim-sidebar-toggle-icon');
    const toggleText = document.getElementById('sim-sidebar-toggle-text');
    if (toggleIcon) toggleIcon.textContent = '▶';
    if (toggleText) toggleText.textContent = 'Hide Sideline';

    renderLiveStrategyControls();

    if (elements.simPlayLog) elements.simPlayLog.innerHTML = '';
    updateLiveScoreboard();
    runLiveGameStep();
}

function getLiveGameCoachQuote(adjustments, coachName) {
    const adj = adjustments || {};
    if (adj.tempo === 'hurry_up') {
        return `"No-huddle drill! We're speeding up the pace, catching their defense without time to substitute."`;
    }
    if (adj.tempo === 'chew_clock') {
        return `"Milking every tick off that play clock, boss. Taking our time and bleeding the clock."`;
    }
    if (adj.fourthDown === 'aggressive') {
        return `"I love the swagger, boss. We're keeping the offense on the field on short-yardage 4th downs."`;
    }
    if (adj.fourthDown === 'conservative') {
        return `"Playing smart field position. We'll pin them deep inside their 20."`;
    }
    if (adj.offenseFocus === 'pound_rock') {
        return `"Understood. We're leaning on the offensive line and feeding our runners to wear down their front."`;
    }
    if (adj.offenseFocus === 'air_it_out') {
        return `"Got it, boss. Dialing up deep verticals downfield to stretch their secondary."`;
    }
    if (adj.offenseFocus === 'quick_game') {
        return `"Smart call. Quick slants, flats, and screens to neutralize their pass rush and get the ball out."`;
    }
    if (adj.defenseFocus === 'stack_box') {
        return `"Loading up the tackle box! Daring them to test our corners on an island."`;
    }
    if (adj.defenseFocus === 'deep_shell') {
        return `"Two-high shell back there. Keeping everything in front of us—no cheap chunk plays."`;
    }
    if (adj.defenseFocus === 'bring_heat') {
        return `"Sending the house! Overload blitzes to force errant throws and sacks."`;
    }
    return `"Sticking to our base script, boss. Waiting for their defense to show its hand."`;
}

function renderLiveStrategyControls() {
    const team = getGameState()?.playerTeam;
    if (!activeLiveGame || !team) return;


    if (!activeLiveGame.liveGmAdjustments) {
        activeLiveGame.liveGmAdjustments = team.liveGmAdjustments || {
            offenseFocus: 'balanced',
            defenseFocus: 'base',
            fourthDown: 'coach',
            tempo: 'normal',
            autoSubTendency: 'balanced'
        };
    }
    const adjustments = activeLiveGame.liveGmAdjustments;

    // 1. Coach's Ear Card
    const coach = team.staff?.coach || team.coach || (Array.isArray(team.coaches) ? team.coaches[0] : null);
    const coachName = coach?.name ? `Coach ${coach.name}` : (team.coachName || 'Coach');
    const coachNameEl = document.getElementById('sim-coach-name');
    if (coachNameEl) coachNameEl.textContent = coachName;

    const coachQuoteEl = document.getElementById('sim-coach-quote');
    if (coachQuoteEl) {
        coachQuoteEl.textContent = getLiveGameCoachQuote(adjustments, coachName);
    }

    // 2. GM Tweak Buttons Visual State
    document.querySelectorAll('.gm-tweak-btn').forEach(btn => {
        const type = btn.getAttribute('data-gm-type');
        const val = btn.getAttribute('data-gm-val');
        const isSelected = adjustments[type] === val;

        if (type === 'offenseFocus') {
            if (isSelected) {
                btn.className = 'gm-tweak-btn text-left p-2 rounded border text-xs transition-all border-amber-500 bg-amber-950/60 text-amber-200 ring-1 ring-amber-500/50 shadow-sm';
            } else {
                btn.className = 'gm-tweak-btn text-left p-2 rounded border text-xs transition-all bg-gray-900 border-gray-700/80 text-gray-300 hover:border-gray-500 hover:text-white';
            }
        } else if (type === 'defenseFocus') {
            if (isSelected) {
                btn.className = 'gm-tweak-btn text-left p-2 rounded border text-xs transition-all border-blue-500 bg-blue-950/60 text-blue-200 ring-1 ring-blue-500/50 shadow-sm';
            } else {
                btn.className = 'gm-tweak-btn text-left p-2 rounded border text-xs transition-all bg-gray-900 border-gray-700/80 text-gray-300 hover:border-gray-500 hover:text-white';
            }
        } else if (type === 'fourthDown') {
            if (isSelected) {
                btn.className = 'gm-tweak-btn text-left px-2 py-1.5 rounded border text-[10px] transition-all border-emerald-500 bg-emerald-950/60 text-emerald-200 font-bold ring-1 ring-emerald-500/50 shadow-sm';
            } else {
                btn.className = 'gm-tweak-btn text-left px-2 py-1.5 rounded border text-[10px] transition-all bg-gray-900 border-gray-700 hover:border-gray-500 text-gray-300 hover:text-white font-bold';
            }
        } else if (type === 'tempo') {
            if (isSelected) {
                btn.className = 'gm-tweak-btn text-left px-2 py-1.5 rounded border text-[10px] transition-all border-cyan-500 bg-cyan-950/60 text-cyan-200 font-bold ring-1 ring-cyan-500/50 shadow-sm';
            } else {
                btn.className = 'gm-tweak-btn text-left px-2 py-1.5 rounded border text-[10px] transition-all bg-gray-900 border-gray-700 hover:border-gray-500 text-gray-300 hover:text-white font-bold';
            }
        } else if (type === 'autoSubTendency') {
            if (isSelected) {
                btn.className = 'gm-tweak-btn text-center px-1.5 py-1.5 rounded border text-[9px] transition-all border-purple-500 bg-purple-950/60 text-purple-200 font-bold ring-1 ring-purple-500/50 shadow-sm';
            } else {
                btn.className = 'gm-tweak-btn text-center px-1.5 py-1.5 rounded border text-[9px] transition-all bg-gray-900 border-gray-700 hover:border-gray-500 text-gray-300 hover:text-white font-bold';
            }
        }
    });

    // 3. Tactical Formations Selection
    const formationGroups = {
        offense: Object.entries(offenseFormations)
            .filter(([key]) => key !== 'Punt' && key !== 'Punt_Return'),
        defense: Object.entries(defenseFormations)
            .filter(([key]) => key !== 'Punt' && key !== 'Punt_Return')
    };

    for (const side of ['offense', 'defense']) {
        const formationMap = side === 'offense'
            ? offenseFormations
            : defenseFormations;
        const formationKey = team.formations?.[side];
        const formation = formationMap[formationKey];
        const choices = formationGroups[side];
        const input = document.getElementById(`sim-${side}-formation`);
        const label = document.getElementById(`sim-${side}-formation-label`);
        const menu = document.getElementById(`sim-${side}-formation-menu`);
        const personnel = document.getElementById(`sim-${side}-personnel`);

        if (input) input.value = formationKey || '';
        if (label) label.textContent = formation?.name || 'Choose formation';
        if (personnel) {
            const personnelText = Object.entries(formation?.personnel || {})
                .filter(([, count]) => Number(count) > 0)
                .map(([position, count]) => `${count} ${position}`)
                .join(' · ');
            personnel.textContent = personnelText
                ? `Personnel: ${personnelText}`
                : 'Personnel: Standard';
        }

        if (!menu) continue;

        menu.innerHTML = choices.map(([key, option]) => {
            const personnelText = Object.entries(option.personnel || {})
                .filter(([, count]) => Number(count) > 0)
                .map(([position, count]) => `${count} ${position}`)
                .join(' · ') || 'Standard personnel';
            const selected = key === formationKey;

            return `
                <button
                    type="button"
                    aria-pressed="${selected}"
                    onclick="window.app_setLiveFormation('${side}', '${key}')"
                    class="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-sm px-2 py-2 text-left ${selected ? 'bg-amber-500/15 text-amber-200' : 'text-gray-200 hover:bg-gray-800'}">
                    <span class="truncate text-xs font-bold">${option.name || key}</span>
                    <span class="text-right text-[9px] text-gray-400">${personnelText}</span>
                </button>
            `;
        }).join('');
    }
}

    window.app_setGmLiveTweak = function(category, value) {
        if (!activeLiveGame) return;
        if (!activeLiveGame.liveGmAdjustments) {
            activeLiveGame.liveGmAdjustments = {
                offenseFocus: 'balanced',
                defenseFocus: 'base',
                fourthDown: 'coach',
                tempo: 'normal',
                autoSubTendency: 'balanced'
            };
        }
    activeLiveGame.liveGmAdjustments[category] = value;

    const gameState = getGameState();
    const team = gameState?.playerTeam;
    if (team) {
        team.liveGmAdjustments = { ...activeLiveGame.liveGmAdjustments };
    }

    const livePlayerTeam = [activeLiveGame.homeTeam, activeLiveGame.awayTeam].find(
        t => t && (t.isPlayerControlled || (team && String(t.id) === String(team.id)))
    );
    if (livePlayerTeam) {
        livePlayerTeam.liveGmAdjustments = { ...activeLiveGame.liveGmAdjustments };
    }

    renderLiveStrategyControls();
};

window.app_toggleLiveFormationPicker = function(side) {
    if (!['offense', 'defense'].includes(side)) return;

    const menu = document.getElementById(`sim-${side}-formation-menu`);
    const trigger = document.getElementById(`sim-${side}-formation-trigger`);
    if (!menu || !trigger) return;

    const isOpening = menu.classList.contains('hidden');
    document.querySelectorAll('.live-formation-menu').forEach(panel =>
        panel.classList.add('hidden')
    );
    document.querySelectorAll('[aria-controls^="sim-"][aria-controls$="-formation-menu"]').forEach(button =>
        button.setAttribute('aria-expanded', 'false')
    );

    if (isOpening) {
        menu.classList.remove('hidden');
        trigger.setAttribute('aria-expanded', 'true');
    }
};

window.app_setLiveFormation = function(side, formationKey) {
    if (
        !activeLiveGame ||
        !['offense', 'defense'].includes(side) ||
        typeof formationKey !== 'string'
    ) {
        return;
    }

    const gameState = getGameState();
    const team = gameState?.playerTeam;
    const formations = side === 'offense'
        ? offenseFormations
        : defenseFormations;

    if (!team || !formations[formationKey]) return;

    Game.changeFormation(side, formationKey);

    const liveTeam = [
        activeLiveGame.homeTeam,
        activeLiveGame.awayTeam
    ].find(candidate =>
        String(candidate?.id) === String(team.id)
    );

    if (liveTeam && liveTeam !== team) {
        liveTeam.formations = { ...team.formations };
        liveTeam.depthChart = team.depthChart;
    }

    Game.saveGameState();
    renderLiveStrategyControls();
    document.getElementById(`sim-${side}-formation-menu`)?.classList.add('hidden');
    document.getElementById(`sim-${side}-formation-trigger`)?.setAttribute('aria-expanded', 'false');
};

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

// Attach Sub UI Functions to the Global Scope for Inline Handlers
window.app_toggleLiveSubDrawer = function(playerId) {
    const drawer = document.getElementById(`sub-drawer-${playerId}`);
    if (drawer) {
        drawer.classList.toggle('hidden');
    }
};

window.app_submitLiveSub = function(outId, inId) {
    const gs = Game.getGameState();
    const teamId = gs?.playerTeam?.id;
    if (!teamId || !activeLiveGame) return;
    
    Game.substitutePlayers(teamId, outId, inId, activeLiveGame.gameLog);
    
    // Close the drawer immediately
    const drawer = document.getElementById(`sub-drawer-${outId}`);
    if (drawer) drawer.classList.add('hidden');
    
    // Force a re-render to reflect the immediate UI change
    if (activeLiveGame.visualizationFrames?.length > 0) {
        const lastFrame = activeLiveGame.visualizationFrames[activeLiveGame.visualizationFrames.length - 1];
        renderLiveFieldLineup(lastFrame, gs);
    }
};

export function renderLiveFieldLineup(frameData, gameState) {
    const container = document.getElementById('sim-field-players');
    if (!container || !frameData?.players || !gameState?.playerTeam) return;

    const myTeamId = gameState.playerTeam.id;
    const team = gameState.playerTeam;
    const myPlayers = frameData.players.filter(p => p.teamId === myTeamId);

    if (myPlayers.length === 0) return;
    
    const fullRoster = Game.getGameDayRosterObjects(team);
    const activeOffense = new Set(Object.values(team.depthChart?.offense || {}).filter(Boolean));
    const activeDefense = new Set(Object.values(team.depthChart?.defense || {}).filter(Boolean));

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
        if (!fullPlayer) return;
        
        const energy = Math.max(0, Math.round(100 - (fullPlayer.fatigue || 0)));
        const energyColor = energy >= 75 ? 'bg-emerald-500' : (energy >= 50 ? 'bg-amber-500' : 'bg-rose-500');

        let actionText = p.action || 'idle';
        actionText = actionText.replace(/_/g, ' ');
        const isLocked = (fullPlayer.manualSubLock || 0) > 0;
        
        // Populate Eligible Bench Drawer Candidates
        const drawerCandidates = fullRoster.filter(c => 
            c.id !== fullPlayer.id && 
            !c.isResting && 
            !(c.status?.duration > 0) &&
            (p.isOffense ? !activeOffense.has(c.id) : !activeDefense.has(c.id))
        ).map(c => {
            return {
                player: c,
                suit: calculateSlotSuitability(c, p.slot, p.isOffense ? 'offense' : 'defense', team),
                energy: Math.max(0, Math.round(100 - (c.fatigue || 0)))
            };
        }).filter(c => c.suit > 25).sort((a,b) => b.suit - a.suit).slice(0, 4);

        html += `
            <!-- Active Player Row (Click to toggle drawer) -->
            <div class="p-2 hover:bg-slate-800/40 transition-colors flex items-center justify-between text-xs cursor-pointer select-none" onclick="window.app_toggleLiveSubDrawer('${fullPlayer.id}')">
                <div class="flex items-center gap-2 truncate pr-2">
                    <span class="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${p.isOffense ? 'bg-blue-950 text-blue-300 border border-blue-800' : 'bg-rose-950 text-rose-300 border border-rose-800'}">
                        ${p.slot || 'P'}
                    </span>
                    <div class="flex flex-col truncate">
                        <span class="font-bold text-slate-200 truncate flex items-center gap-1">
                            ${getPlayerLastNameForStats(fullPlayer)}
                            ${isLocked ? '<span class="text-[9px] text-amber-500" title="Manual Substitution Lock Active">🔒</span>' : ''}
                        </span>
                        <span class="text-[9px] text-slate-400 capitalize truncate">${actionText}</span>
                    </div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    <div class="w-10 bg-slate-800 rounded-full h-1.5 overflow-hidden">
                        <div class="${energyColor} h-full" style="width: ${energy}%"></div>
                    </div>
                    <span class="text-[9px] font-mono text-slate-400 w-6 text-right">${energy}%</span>
                    <span class="text-slate-600 ml-1">▾</span>
                </div>
            </div>
            
            <!-- Hidden Bench Drawer -->
            <div id="sub-drawer-${fullPlayer.id}" class="hidden bg-slate-950/80 border-t border-b border-slate-800/50 px-2 py-1.5 space-y-1">
                <div class="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 flex justify-between">
                    <span>Eligible Replacements</span>
                    <span>Energy / Suitability</span>
                </div>
                ${drawerCandidates.length > 0 ? drawerCandidates.map(c => `
                    <div class="flex justify-between items-center bg-slate-900 border border-slate-700/50 p-1.5 rounded-sm hover:border-slate-500 transition-colors">
                        <div class="flex items-center gap-1.5 truncate">
                            <span class="font-bold text-[10px] text-slate-300 truncate w-20">${getPlayerLastNameForStats(c.player)}</span>
                            <span class="text-[9px] text-slate-400 font-mono">${c.energy}%</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <div class="flex gap-0.5">
                                ${Array(5).fill(0).map((_, i) => `<div class="w-1.5 h-1.5 rounded-sm ${i < Math.round(c.suit/20) ? 'bg-emerald-500' : 'bg-slate-700'}"></div>`).join('')}
                            </div>
                            <button class="bg-slate-700 hover:bg-amber-600 text-white font-bold px-2 py-0.5 rounded-sm text-[9px] uppercase tracking-wider transition-colors shadow-sm" onclick="app_submitLiveSub('${fullPlayer.id}', '${c.player.id}')">
                                Sub In
                            </button>
                        </div>
                    </div>
                `).join('') : '<div class="text-[10px] text-slate-500 italic p-1">No rested bench players available.</div>'}
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

    lastRenderedFrame = frame;

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

export function showWeeklyStaffReport(report, gameState, onContinue = null) {
    if (!report) {
        if (onContinue) onContinue();
        return;
    }

    const escapeHtml = str => String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);

    const modalHtml = `
        <div class="space-y-4 text-left text-xs font-sans max-h-[75vh] overflow-y-auto pr-1">
            
            <!-- Banner Header -->
            <div class="bg-slate-900 text-white p-3.5 rounded border border-slate-700 flex justify-between items-center shadow-sm">
                <div>
                    <div class="flex items-center gap-2">
                        <span class="text-base">👔</span>
                        <h4 class="font-black text-sm uppercase tracking-wide text-amber-400">
                            Front Office Executive Review
                        </h4>
                    </div>
                    <p class="text-[11px] text-slate-300 mt-0.5">
                        ${escapeHtml(report.teamName)} · Season ${report.year}, Week ${report.week} Debrief
                    </p>
                </div>
                ${report.outcomes.matchResult ? `
                    <div class="text-right">
                        <span class="text-[9px] uppercase tracking-wider block font-bold ${report.outcomes.matchResult.won ? 'text-emerald-400' : 'text-rose-400'}">
                            ${report.outcomes.matchResult.won ? 'VICTORY' : 'DEFEAT'}
                        </span>
                        <span class="font-mono text-sm font-black">
                            ${report.outcomes.matchResult.teamScore} - ${report.outcomes.matchResult.oppScore}
                        </span>
                    </div>
                ` : ''}
            </div>

            <!-- 1. NEEDS ATTENTION (Urgent items first) -->
            ${report.attentionItems.length > 0 ? `
                <div class="rounded border border-rose-200 bg-rose-50/70 p-3">
                    <div class="flex items-center gap-1.5 mb-2 border-b border-rose-200 pb-1">
                        <span class="text-xs font-black uppercase text-rose-800">⚠️ Needs Attention (${report.attentionItems.length})</span>
                    </div>
                    <div class="space-y-1.5">
                        ${report.attentionItems.map(item => `
                            <div class="bg-white border border-rose-200 p-2 rounded flex items-start gap-2 text-[11px]">
                                <span class="text-sm shrink-0">${item.icon}</span>
                                <div class="min-w-0">
                                    <span class="font-bold text-slate-900">${escapeHtml(item.title)}</span>
                                    <p class="text-slate-600 mt-0.5">${escapeHtml(item.detail)}</p>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : `
                <div class="rounded border border-emerald-200 bg-emerald-50/50 p-2.5 text-center text-emerald-900 font-bold text-[11px]">
                    ✓ No urgent roster, health, or financial crises this week.
                </div>
            `}

            <!-- 2. EVIDENCE-BASED TACTICAL RECOMMENDATIONS -->
            <div class="rounded border border-slate-200 bg-white p-3 shadow-sm">
                <div class="flex items-center justify-between border-b border-slate-100 pb-1.5 mb-2">
                    <h5 class="font-black text-[10px] uppercase tracking-wider text-slate-700 flex items-center gap-1">
                        <span>💡</span> Staff Tactical & Practice Recommendations
                    </h5>
                    <span class="text-[9px] text-slate-400">Based on observed opponent snaps & mastery</span>
                </div>
                <div class="space-y-2">
                    ${report.recommendations.length > 0 ? report.recommendations.map(rec => `
                        <div class="bg-slate-50 border border-slate-200 p-2.5 rounded">
                            <span class="font-bold text-slate-900 block text-[11px]">${escapeHtml(rec.title)}</span>
                            <p class="text-slate-600 text-[10px] mt-0.5 leading-relaxed">${escapeHtml(rec.detail)}</p>
                        </div>
                    `).join('') : '<p class="text-slate-400 italic text-[11px] py-1">Staff has no specific strategic deviations to recommend.</p>'}
                </div>
            </div>

            <!-- 3. PERFORMANCE & BREAKTHROUGHS -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <!-- Coach Gains -->
                <div class="rounded border border-slate-200 bg-white p-3 shadow-sm">
                    <h5 class="font-black text-[10px] uppercase tracking-wider text-slate-700 border-b border-slate-100 pb-1 mb-2">
                        👔 Staff Skill Progression
                    </h5>
                    ${report.outcomes.coachImprovements.length > 0 ? `
                        <div class="space-y-1">
                            ${report.outcomes.coachImprovements.map(c => `
                                <div class="text-[10px] bg-slate-50 p-1.5 rounded flex justify-between items-center">
                                    <span class="font-semibold text-slate-800">${escapeHtml(c.coachName)}</span>
                                    <span class="font-bold text-blue-700">+1 ${escapeHtml(c.skill)} (${c.newRating})</span>
                                </div>
                            `).join('')}
                        </div>
                    ` : '<p class="text-slate-400 italic text-[10px]">No staff rating breakthroughs this week.</p>'}
                </div>

                <!-- Handled Automatically -->
                <div class="rounded border border-slate-200 bg-white p-3 shadow-sm">
                    <h5 class="font-black text-[10px] uppercase tracking-wider text-slate-700 border-b border-slate-100 pb-1 mb-2">
                        🟢 Handled by Staff (Automated)
                    </h5>
                    <div class="space-y-1.5">
                        ${report.automatedWork.map(w => `
                            <div class="text-[10px] text-slate-600">
                                <span class="font-bold text-slate-800">${w.icon} ${escapeHtml(w.title)}:</span> ${escapeHtml(w.detail)}
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>

        </div>
    `;

    showModal("Weekly Management Report", modalHtml, onContinue, "Acknowledge & Continue", null, "Close");
}

window.app_setManagementPreset = function (presetKey) {
    const gs = getGameState();
    const team = gs?.playerTeam;
    if (!team) return;

    import('./game/staff.js').then(s => {
        s.applyManagementPreset(team, presetKey);
        saveGameState();
        renderStaffTab(gs);
    }).catch(err => console.error("Failed to apply preset:", err));
};

window.app_setProgramDirection = function (directionKey) {
    const gs = getGameState();
    const team = gs?.playerTeam;
    if (!team?.teamInstructions) return;

    team.teamInstructions.programDirection = directionKey;
    saveGameState();
    renderStaffTab(gs);
};

window.app_setRecruitingAutoPolicy = function (field, value) {
    const gs = getGameState();
    const team = gs?.playerTeam;
    const recruiting = team?.teamInstructions?.departments?.recruiting;
    if (!recruiting) return;

    if (field === 'offerEnabled') {
        recruiting.automaticOfferPolicy.enabled = Boolean(value);
    } else if (field === 'offerThreshold') {
        recruiting.automaticOfferPolicy.minimumInterest = Math.max(10, Math.min(95, Number(value) || 25));
    } else if (field === 'allowGifts') {
        recruiting.giftSpendingPolicy.allowGifts = Boolean(value);
    } else if (field === 'maxGift') {
        recruiting.giftSpendingPolicy.maxGiftPerRecruit = Math.max(0, Math.min(50, Number(value) || 10));
    }

    saveGameState();
    renderStaffTab(gs);
};