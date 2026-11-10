//game/season.js

import { getRandom, getRandomInt } from '../utils.js';
import { isDebugMode } from './debug_mode.js';
import {
    game, setGame, playerMap, getPlayer, getRosterObjects, addMessage,
    getRelationshipLevel, improveRelationship, decreaseRelationship,
    getScoutedPlayerInfo, getTeamScoutingReport
} from './state.js';
import {
    generatePlayer, generateDraftClassModifiers, calculateOverall, estimateBestPosition
} from './player.js';
import {
    coachPersonalities, offenseFormations, defenseFormations,
    offensivePlaybook, defensivePlaybook,
    teamNames, divisionNames, relationshipLevels
} from '../data.js';
import {
    getOffensivePlayKnowledge,
    getDefensivePlayKnowledge
} from './playcalling_knowledge.js';
import {
    resetGameStats, finalizeGameResults
} from './state.js';
import {
    rebuildDepthChartFromOrder, aiSetDepthChart, assignTeamCaptain, isPlayerViableForPosition
} from './depth_chart.js';
import { simulateYouthMatch } from './youth_simulation.js';
import {
    initializeTeamStaff, generateStaffPool, checkRetiredPlayerToCoach,
    aiBuildGameplan, aiChooseWeeklyPractice,
    ensureAiStaffWorkPlan, getTeamCoachingSpecialist,
    processWeeklyCoachDevelopment, ensureTeamStaffWorkPlan,
    getEffectiveStaffWorkHours, processWeeklyStaffPreparation,
    processCoachOffseasonRetention, resolveCoachCarousel,
    processStaffMarketDecay, getStaffBehaviorTendency
} from './staff.js';
import {
    evaluatePlayerRetention,
    evaluatePlayerNegotiation,
    resolvePlayerBiddingWar,
    calculateAiTeamNeedAndDesire,
    createPlayerPromise,
    evaluateAiRetentionPitch
} from './negotiations.js';
import {
    processWeeklyScoutingAssignments,
    applyBankedDraftScoutingReports,
    initializeInheritedScoutingReports
} from './scouting.js';
import {
    createCommunityState,
    initializeCommunityContacts,
    generateCommunityFavorRequests,
    processAiCommunityFavorDecisions,
    resolveCommunityFavorOutcomes
} from './community.js';

export const ROSTER_LIMIT = 18;
export const REGULAR_SEASON_ROSTER_LIMIT = 18;
export const SUMMER_ROSTER_LIMIT = 24;
export const MIN_HEALTHY_PLAYERS = 8;
export const TEMPORARY_HELP_THRESHOLD = 12;
export const SEASON_DUES_PER_PLAYER = 9;

const COMMUNITY_WEEKS_PER_SEASON = 9;

export const COACH_CAROUSEL_DAYS = 2;
export const FREE_AGENCY_RECRUITING_DAYS = 7;

export const OFFSEASON_PHASES = Object.freeze({
    STAFF_REVIEW: 'staff_review',
    DRAFT: 'draft',
    RECRUITING: 'recruiting',
    ROSTER_FINALIZATION: 'roster_finalization',
    REGULAR_SEASON: 'regular_season'
});

const OFFSEASON_PHASE_TRANSITIONS = Object.freeze({
    [OFFSEASON_PHASES.STAFF_REVIEW]: [
        OFFSEASON_PHASES.DRAFT
    ],
    [OFFSEASON_PHASES.DRAFT]: [
        OFFSEASON_PHASES.RECRUITING
    ],
    [OFFSEASON_PHASES.RECRUITING]: [
        OFFSEASON_PHASES.ROSTER_FINALIZATION
    ],
    [OFFSEASON_PHASES.ROSTER_FINALIZATION]: [
        OFFSEASON_PHASES.REGULAR_SEASON
    ],
    [OFFSEASON_PHASES.REGULAR_SEASON]: []
});

/**
 * Retrieves or initializes persisted offseason phase state.
 * Missing state is treated as a legacy save entering staff review.
 */
export function getOffseasonState(gameState = game) {
    if (!gameState) return null;

    if (
        !gameState.offseasonState ||
        typeof gameState.offseasonState !== 'object'
    ) {
        gameState.offseasonState = {
            seasonYear: Number(gameState.year) || null,
            completedSeasonYear: null,
            phase: OFFSEASON_PHASES.STAFF_REVIEW,
            staffReviewDay: 1,
            staffReviewDays: COACH_CAROUSEL_DAYS,
            recruitingDay: 0,
            recruitingDays: FREE_AGENCY_RECRUITING_DAYS,
            completed: false
        };
    }

    const state = gameState.offseasonState;

    state.staffReviewDays = COACH_CAROUSEL_DAYS;
    state.recruitingDays = FREE_AGENCY_RECRUITING_DAYS;

    const staffDay = Number(state.staffReviewDay);

    state.staffReviewDay = Math.max(
        1,
        Math.min(
            COACH_CAROUSEL_DAYS,
            Number.isFinite(staffDay) ? Math.floor(staffDay) : 1
        )
    );

    const recruitingDay = Number(state.recruitingDay);

    state.recruitingDay = Math.max(
        0,
        Math.min(
            FREE_AGENCY_RECRUITING_DAYS,
            Number.isFinite(recruitingDay)
                ? Math.floor(recruitingDay)
                : 0
        )
    );

    return state;
}

/**
 * Moves the offseason forward only along an explicitly permitted transition.
 *
 * finishEarly may be used to complete the coach carousel before Day 2 ends.
 */
export function transitionOffseasonPhase(
    nextPhase,
    gameState = game,
    options = {}
) {
    if (!gameState) {
        return {
            success: false,
            message: 'Game state is unavailable.'
        };
    }

    const state = getOffseasonState(gameState);
    const currentPhase = state.phase;

    if (!Object.values(OFFSEASON_PHASES).includes(currentPhase)) {
        return {
            success: false,
            message: 'The saved offseason phase is missing or invalid. The game has not advanced to prevent repeating offseason actions.'
        };
    }

    if (!Object.values(OFFSEASON_PHASES).includes(nextPhase)) {
        return {
            success: false,
            message: `Unknown offseason phase: ${nextPhase}.`
        };
    }

    if (
        !OFFSEASON_PHASE_TRANSITIONS[currentPhase]?.includes(nextPhase)
    ) {
        return {
            success: false,
            message: `Cannot move from ${currentPhase} to ${nextPhase}.`
        };
    }

    if (
        currentPhase === OFFSEASON_PHASES.DRAFT &&
        nextPhase === OFFSEASON_PHASES.RECRUITING &&
        gameState.draftCompleted !== true
    ) {
        return {
            success: false,
            message: 'Complete the rookie draft before beginning free-agent recruiting.'
        };
    }

    if (
        currentPhase === OFFSEASON_PHASES.STAFF_REVIEW &&
        state.staffReviewDay < COACH_CAROUSEL_DAYS &&
        options.finishEarly !== true
    ) {
        return {
            success: false,
            message: 'Complete Day 2 of staff review or choose to finish early.'
        };
    }

    if (
        currentPhase === OFFSEASON_PHASES.RECRUITING &&
        state.recruitingDay < FREE_AGENCY_RECRUITING_DAYS
    ) {
        return {
            success: false,
            message: 'Complete all seven recruiting days before finalizing the roster.'
        };
    }

    if (
        currentPhase === OFFSEASON_PHASES.RECRUITING &&
        nextPhase === OFFSEASON_PHASES.ROSTER_FINALIZATION
    ) {
        const recruitingProgress = state.recruitingProgress;

        const finalDayResolved = Array.isArray(
            recruitingProgress?.resolvedDays
        ) && recruitingProgress.resolvedDays.some(
            resolvedDay =>
                Number(resolvedDay) === FREE_AGENCY_RECRUITING_DAYS
        );

        if (
            recruitingProgress?.completed !== true ||
            Number(recruitingProgress.completedDay) !==
                FREE_AGENCY_RECRUITING_DAYS ||
            Number(recruitingProgress.seasonYear) !==
                Number(gameState.year) ||
            !finalDayResolved
        ) {
            return {
                success: false,
                message: 'Resolve Recruiting Day 7 before finalizing the roster.'
            };
        }
    }

    if (
        currentPhase === OFFSEASON_PHASES.ROSTER_FINALIZATION &&
        nextPhase === OFFSEASON_PHASES.REGULAR_SEASON
    ) {
        if (
            gameState.draftCompleted !== true ||
            gameState.offseasonFACompleted !== true
        ) {
            return {
                success: false,
                message: 'Complete roster finalization before starting the regular season.'
            };
        }

        const playerRosterSize = Array.isArray(
            gameState.playerTeam?.roster
        )
            ? gameState.playerTeam.roster.length
            : 0;

        if (playerRosterSize > REGULAR_SEASON_ROSTER_LIMIT) {
            return {
                success: false,
                message: `Your roster must be reduced to ${REGULAR_SEASON_ROSTER_LIMIT} players before the regular season begins.`
            };
        }
    }

    // Resolve AI hiring only when the staff carousel closes.
    // The player gets the existing two-day review window first.
    if (
        currentPhase === OFFSEASON_PHASES.STAFF_REVIEW &&
        nextPhase === OFFSEASON_PHASES.DRAFT
    ) {
        const completedSeasonYear = Number(
            state.completedSeasonYear
        );

        const carouselYear =
            Number.isInteger(completedSeasonYear) &&
            completedSeasonYear > 0
                ? completedSeasonYear
                : Number(gameState.year);

        const carouselResult = resolveCoachCarousel(
            gameState,
            carouselYear
        );

        if (
            carouselResult?.resolved !== true &&
            carouselResult?.alreadyResolved !== true
        ) {
            return {
                success: false,
                message: 'The coach carousel could not be completed. The offseason remains in staff review.'
            };
        }
    }

    state.phase = nextPhase;

    if (nextPhase === OFFSEASON_PHASES.DRAFT) {
        gameState.draftCompleted = false;
    }

    if (nextPhase === OFFSEASON_PHASES.RECRUITING) {
        state.recruitingDay = 1;
        state.recruitingDays = FREE_AGENCY_RECRUITING_DAYS;
        state.completed = false;

        const recruitingTeams = gameState.teams.filter(
            team => team && team.leagueType === 'main'
        );

        // Do not let recruiting consume prospects still reserved for a draft.
        const protectedDraftProspectIds = new Set(
            (Array.isArray(gameState.draftClass) ? gameState.draftClass : [])
                .map(prospect =>
                    prospect && typeof prospect === 'object'
                        ? prospect.id
                        : prospect
                )
                .filter(id => id != null)
                .map(id => String(id))
        );

        const eligibleRecruits = (gameState.players || []).filter(player => {
            if (!player || player.id == null || player.teamId != null) {
                return false;
            }

            const age = Number(player.age);
            const status = player.status || {};

            const statusType = String(
                status.type || ''
            ).toLowerCase();

            const lifecycle = String(
                player.lifecycle || ''
            ).toLowerCase();

            const lifecycleStatus = String(
                player.lifecycleStatus || player.lifecycle?.status || ''
            ).toLowerCase();

            return (
                Number.isFinite(age) &&
                age >= 12 &&
                age <= 18 &&
                !['retired', 'departed', 'temporary'].includes(statusType) &&
                !['retired', 'departed', 'temporary'].includes(lifecycleStatus) &&
                lifecycle !== 'draft_eligible' &&
                lifecycleStatus !== 'draft_eligible' &&
                !protectedDraftProspectIds.has(String(player.id))
            );
        });

        // Preserve prior-season interest for unsigned prospects.
        // Staff assignments and action history reset each campaign,
        // but relationships built with a prospect carry forward.
        const previousRecruitingProgress =
            state.recruitingProgress?.initialized === true &&
            Number(state.recruitingProgress.seasonYear) < Number(gameState.year)
                ? state.recruitingProgress
                : null;

        const previousRecruitRecords =
            previousRecruitingProgress?.recruits || {};

        const getCarryoverInterest = (player, team) => {
            const previousRecord =
                previousRecruitRecords[String(player.id)];

            if (
                !previousRecord ||
                previousRecord.status === 'committed' ||
                previousRecord.committedTeamId != null
            ) {
                return 0;
            }

            const rawInterest =
                previousRecord.interestByTeam?.[String(team.id)];

            const interest = Number(rawInterest);

            return (
                rawInterest != null &&
                String(rawInterest).trim() !== '' &&
                Number.isFinite(interest)
            )
                ? Math.max(0, Math.min(100, interest))
                : 0;
        };

        const recruits = Object.fromEntries(
            eligibleRecruits.map(player => [
                String(player.id),
                {
                    playerId: player.id,
                    interestByTeam: Object.fromEntries(
                        recruitingTeams.map(team => [
                            String(team.id),
                            getCarryoverInterest(player, team)
                        ])
                    ),
                    offersByTeam: {},
                    history: [],
                    status: 'available',
                    committedTeamId: null
                }
            ])
        );

        // Plain serializable data persists safely in normal game saves.
        state.recruitingProgress = {
            version: 1,
            seasonYear: Number(gameState.year) || null,
            initialized: true,
            recruits,
            teamDailyWork: {},
            teamRecruitingLists: {},
            aiProcessedDays: {},
            resolvedDays: [],
            dailyActivity: [],
            commitments: [],
            completed: false
        };

        gameState.offseasonFACompleted = false;
        gameState._faDay = 1;

        const playerTeamId = gameState.playerTeam?.id == null
            ? null
            : String(gameState.playerTeam.id);

        recruitingTeams.forEach(team => {
            const isPlayerTeam =
                team.isPlayerControlled === true ||
                (
                    playerTeamId !== null &&
                    String(team.id) === playerTeamId
                );

            if (isPlayerTeam) {
                const recruitingAutonomy = String(
                    team.teamInstructions?.departments?.recruiting?.autonomy ||
                    'guided'
                ).toLowerCase();

                ensureTeamStaffWorkPlan(
                    team,
                    Number(gameState.year),
                    0,
                    recruitingAutonomy === 'direct' ? null : true
                );
            } else {
                ensureAiStaffWorkPlan(
                    team,
                    gameState,
                    Number(gameState.year),
                    0
                );
            }
        });
    }

    if (nextPhase === OFFSEASON_PHASES.ROSTER_FINALIZATION) {
        state.completed = false;
    }

    if (nextPhase === OFFSEASON_PHASES.REGULAR_SEASON) {
        state.completed = true;
        gameState.offseasonFACompleted = true;

        const regularSeasonYear = Number(gameState.year);
        const regularSeasonWeek = Number(gameState.currentWeek);

        // Restore the player's normal training workload after
        // the temporary recruiting-hour reserve is no longer needed.
        const playerTeam = gameState.playerTeam ||
            gameState.teams.find(team =>
                team?.isPlayerControlled === true &&
                team.leagueType === 'main'
            );

        const seasonWorkWeek =
            Number.isInteger(regularSeasonWeek) &&
            regularSeasonWeek >= 0
                ? regularSeasonWeek
                : 0;

        if (Number.isInteger(regularSeasonYear)) {
            if (playerTeam) {
                ensureTeamStaffWorkPlan(
                    playerTeam,
                    regularSeasonYear,
                    seasonWorkWeek,
                    false
                );
            }

            // Rebuild every AI team's workload for the regular season.
            // This removes offseason recruiting work while preserving
            // valid pending community-service commitments.
            const playerTeamId = playerTeam?.id == null
                ? null
                : String(playerTeam.id);

            gameState.teams.forEach(team => {
                if (
                    !team ||
                    team.leagueType !== 'main' ||
                    team.isPlayerControlled === true ||
                    (
                        playerTeamId !== null &&
                        String(team.id) === playerTeamId
                    )
                ) {
                    return;
                }

                ensureAiStaffWorkPlan(
                    team,
                    gameState,
                    regularSeasonYear,
                    seasonWorkWeek
                );
            });
        }

        // Publish the opening community requests before the first
        // regular-season game. Historical seasons are excluded.
        if (
            Number.isInteger(regularSeasonYear) &&
            regularSeasonYear >= 5 &&
            regularSeasonWeek === 0
        ) {
            const openingAbsoluteWeek =
                (regularSeasonYear - 1) *
                COMMUNITY_WEEKS_PER_SEASON;

            generateCommunityFavorRequests(
                gameState,
                {
                    absoluteWeek: openingAbsoluteWeek,
                    season: 'autumn',
                    maxRequests: 3
                }
            );
        }
    }

    return {
        success: true,
        previousPhase: currentPhase,
        phase: nextPhase,
        state
    };
}

function processEndSeasonFinances(gameState) {
    if (!gameState || !gameState.teams) return;
    
    const year = Number(gameState.year);
    if (!Number.isInteger(year)) return;

    gameState.teams.forEach(team => {
        if (!team || team.leagueType !== 'main') return;
        
        if (!team.finances) {
            team.finances = { balance: 10.00, waivedDues: [], autoSnack: 'none' };
        }
        
        // Base community funding
        let revenue = 35.00;
        
        // League Tier TV/Merch Revenue
        if (team.tier === 1) revenue += 40.00;
        else if (team.tier === 2) revenue += 15.00;
        
        // Performance Bonus
        const wins = Number(team.wins) || 0;
        revenue += wins * 6.00;
        
        // Street Cred / Fan Turnout
        const cred = Number(team.socialProfile?.streetCred) || 50;
        revenue += (cred / 100) * 35.00;
        
        // Championship Bonus
        const isPremierChamp = gameState.history?.seasons?.some(
            s => s.year === year && s.champion === team.name
        );
        const isSandlotChamp = gameState.history?.seasons?.some(
            s => s.year === year && s.tier2Champion === team.name
        );
        
        if (isPremierChamp) revenue += 50.00;
        else if (isSandlotChamp) revenue += 25.00;

        const totalRevenue = Math.round(revenue * 100) / 100;
        
        const currentBalance = Number.isFinite(Number(team.finances.balance)) 
            ? Number(team.finances.balance) 
            : 10.00;
            
        team.finances.balance = Math.round((currentBalance + totalRevenue) * 100) / 100;
        
        // Record the transaction. (recordFinanceLedgerEntry safely ignores Years 1-4 to save memory)
        recordFinanceLedgerEntry(
            team, 
            gameState, 
            'season_revenue', 
            `End of Season ${year} Revenue`, 
            totalRevenue
        );
    });
}

/**
 * Advances the two-day coach carousel without forcing an immediate transition
 * to the rookie draft.
 */
export function advanceOffseasonStaffReviewDay(gameState = game) {
    if (!gameState) {
        return {
            success: false,
            message: 'Game state is unavailable.'
        };
    }

    const state = getOffseasonState(gameState);

    if (state.phase !== OFFSEASON_PHASES.STAFF_REVIEW) {
        return {
            success: false,
            message: 'Staff review is not currently active.'
        };
    }

    state.staffReviewDay = Math.min(
        COACH_CAROUSEL_DAYS,
        state.staffReviewDay + 1
    );

    return {
        success: true,
        day: state.staffReviewDay,
        days: COACH_CAROUSEL_DAYS,
        readyForDraft: state.staffReviewDay >= COACH_CAROUSEL_DAYS,
        state
    };
}

/**
 * Allows the player to skip the remaining carousel day and proceed.
 */
export function finishOffseasonStaffReviewEarly(gameState = game) {
    return transitionOffseasonPhase(
        OFFSEASON_PHASES.DRAFT,
        gameState,
        { finishEarly: true }
    );
}

/**
 * Advances recruiting by one day. After Day 7, the next advance finalizes
 * recruiting and moves to roster finalization.
 */
export function advanceOffseasonRecruitingDay(gameState = game) {
    if (!gameState) {
        return {
            success: false,
            message: 'Game state is unavailable.'
        };
    }

    const state = getOffseasonState(gameState);

    if (state.phase !== OFFSEASON_PHASES.RECRUITING) {
        return {
            success: false,
            message: 'Player recruiting is not currently active.'
        };
    }

    const currentDay = Number(state.recruitingDay);
    const recruitingProgress = state.recruitingProgress;

    const currentDayResolved =
        recruitingProgress?.initialized === true &&
        Number(recruitingProgress.seasonYear) ===
            Number(gameState.year) &&
        Array.isArray(recruitingProgress.resolvedDays) &&
        recruitingProgress.resolvedDays.some(
            resolvedDay => Number(resolvedDay) === currentDay
        );

    if (
        !Number.isInteger(currentDay) ||
        currentDay < 1 ||
        currentDay > FREE_AGENCY_RECRUITING_DAYS ||
        !currentDayResolved
    ) {
        return {
            success: false,
            message: 'Resolve the current recruiting day before advancing.'
        };
    }

    if (state.recruitingDay < FREE_AGENCY_RECRUITING_DAYS) {
        state.recruitingDay++;

        gameState._faDay = state.recruitingDay;

        return {
            success: true,
            day: state.recruitingDay,
            days: FREE_AGENCY_RECRUITING_DAYS,
            recruitingComplete: false,
            state
        };
    }

    const transitionResult = transitionOffseasonPhase(
        OFFSEASON_PHASES.ROSTER_FINALIZATION,
        gameState
    );

    return {
        ...transitionResult,
        recruitingComplete: transitionResult.success
    };
}

const createEmptySeasonStats = () => ({
    passYards: 0,
    passAttempts: 0,
    passCompletions: 0,
    interceptionsThrown: 0,
    rushYards: 0,
    rushAttempts: 0,
    recYards: 0,
    receptions: 0,
    targets: 0,
    drops: 0,
    pancakes: 0,
    tackles: 0,
    sacks: 0,
    interceptions: 0,
    fumbles: 0,
    fumblesLost: 0,
    fumblesRecovered: 0,
    touchdowns: 0,
    returnYards: 0,
    safeties: 0
});

const SEASON_REPORT_STAT_KEYS = [
    'passYards', 'passAttempts', 'passCompletions', 'interceptionsThrown',
    'rushYards', 'rushAttempts', 'recYards', 'receptions', 'targets', 'drops',
    'pancakes', 'tackles', 'sacks', 'interceptions', 'fumbles',
    'fumblesLost', 'fumblesRecovered', 'touchdowns', 'returnYards', 'safeties'
];

const SEASON_REPORT_TOTAL_KEYS = [
    'passYards', 'rushYards', 'recYards', 'touchdowns',
    'tackles', 'sacks', 'interceptions'
];

const SEASON_REPORT_LEADER_GROUPS = [
    {
        key: 'passing',
        stat: 'passYards',
        statKeys: [
            'passYards', 'passAttempts', 'passCompletions',
            'interceptionsThrown', 'touchdowns'
        ]
    },
    {
        key: 'rushing',
        stat: 'rushYards',
        statKeys: ['rushYards', 'rushAttempts', 'touchdowns']
    },
    {
        key: 'receiving',
        stat: 'recYards',
        statKeys: [
            'recYards', 'receptions', 'targets', 'drops', 'touchdowns'
        ]
    },
    {
        key: 'defense',
        stat: 'tackles',
        statKeys: [
            'tackles', 'sacks', 'interceptions',
            'fumblesRecovered', 'returnYards', 'touchdowns'
        ]
    },
    {
        key: 'scoring',
        stat: 'touchdowns',
        statKeys: [
            'touchdowns', 'passYards', 'rushYards', 'recYards'
        ]
    }
];

function buildSeasonReportSnapshot(
    gameState,
    seasonYear,
    tier1Teams,
    tier2Teams,
    youthTeams
) {
    const allPlayers = Array.isArray(gameState?.players)
        ? gameState.players
        : [];

    const allTeams = Array.isArray(gameState?.teams)
        ? gameState.teams
        : [];

    // Debug-only summaries and diagnostics must not run or be stored
    // when Debug Mode is disabled.
    const debugEnabled = isDebugMode();

    const teamById = new Map(
        allTeams
            .filter(team => team?.id != null)
            .map(team => [String(team.id), team])
    );

    const readStat = (player, key) => {
        const value = Number(player?.seasonStats?.[key]);

        return Number.isFinite(value) && value > 0
            ? value
            : 0;
    };

    const copyStats = (player, keys = SEASON_REPORT_STAT_KEYS) =>
        Object.fromEntries(
            keys.map(key => [key, readStat(player, key)])
        );

    const makeLeagueSnapshot = (teams, tier) => {
        const safeTeams = Array.isArray(teams) ? teams : [];
        const teamIds = new Set(
            safeTeams.map(team => String(team.id))
        );

        const leaguePlayers = allPlayers.filter(player =>
            player?.teamId != null &&
            teamIds.has(String(player.teamId))
        );

        const standings = safeTeams.map((team, index) => ({
            id: team.id,
            name: team.name || 'Unknown',
            place: index + 1,
            wins: Number(team.wins) || 0,
            losses: Number(team.losses) || 0,
            ties: Number(team.ties) || 0,
            tier
        }));

        const leaders = {};

        for (const group of SEASON_REPORT_LEADER_GROUPS) {
            leaders[group.key] = leaguePlayers
                .map(player => ({
                    player,
                    team: teamById.get(String(player.teamId)),
                    value: readStat(player, group.stat)
                }))
                .filter(entry => entry.value > 0)
                .sort((a, b) =>
                    b.value - a.value ||
                    String(a.player.name || '').localeCompare(
                        String(b.player.name || '')
                    )
                )
                .slice(0, 3)
                .map(({ player, team, value }) => {
                    const priorSeasons = Number(
                        player.careerStats?.seasonsPlayed
                    );

                    const age = Number(player.age);

                    return {
                        id: player.id,
                        name: player.name || 'Unknown',
                        teamName: team?.name || 'Unknown',
                        position: player.pos ||
                            estimateBestPosition(player) ||
                            'ATH',
                        age: Number.isFinite(age) ? age : null,
                        yearsPlayed: (
                            Number.isFinite(priorSeasons)
                                ? Math.max(0, priorSeasons)
                                : 0
                        ) + 1,
                        value,
                        stats: copyStats(player, group.statKeys)
                    };
                });
        }

        const totals = Object.fromEntries(
            SEASON_REPORT_TOTAL_KEYS.map(key => [
                key,
                leaguePlayers.reduce(
                    (sum, player) => sum + readStat(player, key),
                    0
                )
            ])
        );

        // Compact aggregate statistics reveal whether production is
        // concentrated among younger players or experienced veterans.
        // Keep only a small set of meaningful production categories.
        const productionStatKeys = [
            'passYards',
            'rushYards',
            'recYards',
            'touchdowns',
            'tackles',
            'sacks',
            'interceptions'
        ];

        const summarizeProductionGroups = getGroup => {
            const groups = new Map();

            leaguePlayers.forEach(player => {
                const descriptor = getGroup(player);

                if (!descriptor) return;

                let group = groups.get(descriptor.key);

                if (!group) {
                    group = {
                        group: descriptor.label,
                        value: descriptor.value,
                        playerCount: 0,
                        producingPlayers: 0,
                        stats: Object.fromEntries(
                            productionStatKeys.map(key => [key, 0])
                        )
                    };

                    groups.set(descriptor.key, group);
                }

                group.playerCount++;

                let hasProduction = false;

                productionStatKeys.forEach(key => {
                    const value = readStat(player, key);

                    group.stats[key] += value;

                    if (value > 0) hasProduction = true;
                });

                if (hasProduction) group.producingPlayers++;
            });

            return [...groups.values()].sort((a, b) =>
                (a.value ?? 999) - (b.value ?? 999)
            );
        };

        const productionByAge = debugEnabled
            ? summarizeProductionGroups(player => {
                const rawAge = Number(player.age);

                if (!Number.isFinite(rawAge)) {
                    return {
                        key: 'unknown',
                        label: 'Unknown age',
                        value: null
                    };
                }

                const age = Math.floor(rawAge);

                return {
                    key: String(age),
                    label: `Age ${age}`,
                    value: age
                };
            })
            : null;

        const productionByExperience = debugEnabled
            ? summarizeProductionGroups(player => {
                const rawSeasons = Number(
                    player.careerStats?.seasonsPlayed
                );

                const priorSeasons = Number.isFinite(rawSeasons)
                    ? Math.max(0, Math.floor(rawSeasons))
                    : 0;

                const yearsPlayed = priorSeasons + 1;

                return {
                    key: String(yearsPlayed),
                    label: yearsPlayed === 1
                        ? '1 season'
                        : `${yearsPlayed} seasons`,
                    value: yearsPlayed
                };
            })
            : null;

        return {
            teamCount: safeTeams.length,
            playerCount: leaguePlayers.length,
            standings,
            leaders,
            totals,
            ...(debugEnabled
                ? { productionByAge, productionByExperience }
                : {})
        };
    };

    // Build a small diagnostic record. Examples are capped so that a bad
    // season cannot create an enormous report.
    const diagnosticCounts = {};
    const diagnosticExamples = {};

    const recordDiagnostic = (code, example) => {
        diagnosticCounts[code] =
            (diagnosticCounts[code] || 0) + 1;

        if (!diagnosticExamples[code]) {
            diagnosticExamples[code] = [];
        }

        if (diagnosticExamples[code].length < 5) {
            diagnosticExamples[code].push(example);
        }
    };

    const productionKeys = [
        'passYards', 'rushYards', 'recYards',
        'touchdowns', 'tackles', 'sacks', 'interceptions'
    ];

    if (debugEnabled) {
        allPlayers.forEach(player => {
            if (!player) return;

        for (const key of SEASON_REPORT_STAT_KEYS) {
            const rawValue = player.seasonStats?.[key];

            if (rawValue === undefined || rawValue === null) continue;

            const value = Number(rawValue);

            if (!Number.isFinite(value) || value < 0) {
                recordDiagnostic('invalid_stat_value', {
                    playerId: player.id ?? null,
                    playerName: player.name || 'Unknown',
                    stat: key,
                    value: String(rawValue)
                });
            }
        }

        const passAttempts = readStat(player, 'passAttempts');
        const passCompletions = readStat(player, 'passCompletions');

        if (passCompletions > passAttempts) {
            recordDiagnostic('completions_exceed_attempts', {
                playerId: player.id ?? null,
                playerName: player.name || 'Unknown',
                completions: passCompletions,
                attempts: passAttempts
            });
        }

        const targets = readStat(player, 'targets');
        const receptions = readStat(player, 'receptions');

        if (receptions > targets) {
            recordDiagnostic('receptions_exceed_targets', {
                playerId: player.id ?? null,
                playerName: player.name || 'Unknown',
                receptions,
                targets
            });
        }

        const hasProduction = productionKeys.some(
            key => readStat(player, key) > 0
        );

        if (
            hasProduction &&
            (
                player.teamId == null ||
                !teamById.has(String(player.teamId))
            )
        ) {
            recordDiagnostic('production_without_team', {
                playerId: player.id ?? null,
                playerName: player.name || 'Unknown',
                teamId: player.teamId ?? null
            });
        }
        });
    }

    const graduatingClass = allPlayers
        .filter(player => {
            const team = player?.teamId != null
                ? teamById.get(String(player.teamId))
                : null;

            return team?.leagueType === 'youth' &&
                Number(player.age) >= 11;
        })
        .map(player => {
            const team = teamById.get(String(player.teamId));
            const youthHistory = Array.isArray(player.youthSeasonHistory)
                ? player.youthSeasonHistory
                : [];

            const alreadyRecorded = youthHistory.some(
                season => Number(season?.year) === Number(seasonYear)
            );

            const trackedSeasons = Number(player.youthSeasonsPlayed);

            const completedSeasons = Math.max(
                0,
                Number.isFinite(trackedSeasons)
                    ? trackedSeasons
                    : youthHistory.length
            ) + (alreadyRecorded ? 0 : 1);

            const rawEntryAge = Number(player.youthEntryAge);
            const entryAge = Number.isFinite(rawEntryAge)
                ? Math.max(8, Math.min(11, rawEntryAge))
                : Math.max(
                    8,
                    Math.min(11, Number(player.age) || 8)
                );

            const requiredSeasons = Math.max(1, 12 - entryAge);
            const age = Number(player.age) || 0;

            return {
                id: player.id,
                name: player.name || 'Unknown',
                position: player.pos ||
                    estimateBestPosition(player) ||
                    'ATH',
                ageAtSeasonEnd: age,
                teamName: team?.name || 'Unknown',
                youthSeasonsPlayed: completedSeasons,
                requiredYouthSeasons: requiredSeasons,
                meetsDraftExperienceRule:
                    age + 1 >= 12 &&
                    completedSeasons >= requiredSeasons,
                stats: copyStats(player)
            };
        })
        .sort((a, b) =>
            Number(b.meetsDraftExperienceRule) -
                Number(a.meetsDraftExperienceRule) ||
            b.ageAtSeasonEnd - a.ageAtSeasonEnd ||
            (
                (b.stats.passYards + b.stats.rushYards + b.stats.recYards) -
                (a.stats.passYards + a.stats.rushYards + a.stats.recYards)
            ) ||
            b.stats.touchdowns - a.stats.touchdowns
        );

    const diagnostics = debugEnabled
        ? Object.keys(diagnosticCounts).map(code => ({
            code,
            count: diagnosticCounts[code],
            examples: diagnosticExamples[code] || []
        }))
        : null;

    return {
        schemaVersion: 1,
        seasonYear: Number(seasonYear) || null,

        leagues: {
            premier: makeLeagueSnapshot(tier1Teams, 1),
            sandlot: makeLeagueSnapshot(tier2Teams, 2),
            peewee: makeLeagueSnapshot(youthTeams, null)
        },

        graduatingClass,

        // Do not create or store diagnostic data when Debug Mode is off.
        ...(debugEnabled
            ? {
                debug: {
                    simulationHealth: {
                        playersChecked: allPlayers.length,
                        warningCount: diagnostics.reduce(
                            (sum, item) => sum + item.count,
                            0
                        ),
                        diagnostics
                    }
                }
            }
            : {})
    };
}

export function getCurrentRosterLimit(gameState) {
    // Week 0 Summer expansion (24) only applies while draft and offseason FA are active
    if (gameState && gameState.currentWeek === 0 && !gameState.offseasonFACompleted) {
        return SUMMER_ROSTER_LIMIT;
    }
    return ROSTER_LIMIT;
}

const teamColors = [
    { primary: '#DC2626', secondary: '#FFFFFF' },
    { primary: '#2563EB', secondary: '#FFFFFF' },
    { primary: '#FBBF24', secondary: '#000000' },
    { primary: '#D1D5DB', secondary: '#000000' },
    { primary: '#10B981', secondary: '#000000' },
    { primary: '#F97316', secondary: '#FFFFFF' },
    { primary: '#6366F1', secondary: '#FFFFFF' },
    { primary: '#EC4899', secondary: '#FFFFFF' },
    { primary: '#000000', secondary: '#FFFFFF' },
    { primary: '#84CC16', secondary: '#000000' },
    { primary: '#A855F7', secondary: '#FFFFFF' },
    { primary: '#14B8A6', secondary: '#FFFFFF' }
];

let availableColors = [...teamColors];

function yieldToMain() { return new Promise(resolve => setTimeout(resolve, 0)); }

export function buildSocialNetworks(targetPlayers, allPlayers) {
    const playersToProcess = Array.isArray(targetPlayers)
        ? targetPlayers.filter(player =>
            player && typeof player === 'object'
        )
        : [];

    const networkPlayers = Array.isArray(allPlayers)
        ? allPlayers.filter(player =>
            player && typeof player === 'object'
        )
        : playersToProcess;

    // Initialize every participant before creating any relationships.
    // Players can be referenced as friends or rivals before their own
    // turn in the targetPlayers loop.
    const allParticipants = [
        ...new Set([
            ...networkPlayers,
            ...playersToProcess
        ])
    ];

    allParticipants.forEach(player => {
        if (
            !player.personality ||
            typeof player.personality !== 'object' ||
            Array.isArray(player.personality)
        ) {
            player.personality = {};
        }

        const rawLikeability = player.personality.likeability;
        const likeability = Number(rawLikeability);

        player.personality.likeability =
            rawLikeability != null &&
            String(rawLikeability).trim() !== '' &&
            Number.isFinite(likeability)
                ? Math.max(0, Math.min(100, likeability))
                : 50;

        if (
            !player.social ||
            typeof player.social !== 'object' ||
            Array.isArray(player.social)
        ) {
            player.social = {};
        }

        if (player.social.bestFriendId === undefined) {
            player.social.bestFriendId = null;
        }

        if (!Array.isArray(player.social.goodFriendIds)) {
            player.social.goodFriendIds = [];
        }

        if (!Array.isArray(player.social.rivalIds)) {
            player.social.rivalIds = [];
        }
    });

    // All players now have valid personality and social structures.
    playersToProcess.forEach(p => {
        let maxGoodFriends = 3;
        let maxRivals = 2;

        if (p.personality.likeability > 70) {
            maxGoodFriends = getRandomInt(4, 7);
            maxRivals = getRandomInt(0, 1);
        } else if (p.personality.likeability < 35) {
            maxGoodFriends = getRandomInt(1, 2);
            maxRivals = getRandomInt(2, 3);
        }

        const sameClique = p.personality.clique != null
            ? networkPlayers.filter(o =>
                o.id !== p.id &&
                o.personality?.clique === p.personality.clique
            )
            : [];

        const others = networkPlayers.filter(o =>
            o.id !== p.id
        );

        if (
            !p.social.bestFriendId &&
            Math.random() < 0.8 &&
            sameClique.length > 0
        ) {
            const bf = getRandom(sameClique);

            if (!bf.social.bestFriendId) {
                p.social.bestFriendId = bf.id;
                bf.social.bestFriendId = p.id;
            }
        }

        let attempts = 0;

        while (
            p.social.goodFriendIds.length < maxGoodFriends &&
            attempts < 10
        ) {
            const friendPool =
                sameClique.length > 0 && Math.random() < 0.6
                    ? sameClique
                    : others;

            const gf = getRandom(friendPool);

            if (
                gf &&
                gf.id !== p.id &&
                gf.id !== p.social.bestFriendId &&
                !p.social.goodFriendIds.includes(gf.id)
            ) {
                p.social.goodFriendIds.push(gf.id);

                if (!gf.social.goodFriendIds.includes(p.id)) {
                    gf.social.goodFriendIds.push(p.id);
                }
            }

            attempts++;
        }

        attempts = 0;

        while (
            p.social.rivalIds.length < maxRivals &&
            attempts < 10
        ) {
            const rv = getRandom(others);

            if (
                rv &&
                rv.id !== p.id &&
                rv.personality?.clique !== p.personality?.clique &&
                !p.social.goodFriendIds.includes(rv.id) &&
                rv.id !== p.social.bestFriendId
            ) {
                if (!p.social.rivalIds.includes(rv.id)) {
                    p.social.rivalIds.push(rv.id);
                }

                if (!rv.social.rivalIds.includes(p.id)) {
                    rv.social.rivalIds.push(p.id);
                }
            }

            attempts++;
        }
    });
}

export function getPlayerScore(player, coach) {
    if (!player || !player.attributes || !coach || !coach.attributePreferences) return 0;
    let score = 0;
    for (const category in player.attributes) {
        for (const attr in player.attributes[category]) {
            score += (player.attributes[category][attr] || 0) * (coach.attributePreferences[category]?.[attr] || 1.0);
        }
    }
    if (coach.type === 'Youth Scout' && player.age) score += (18 - player.age) * 10;
    return score;
}

export async function initializeLeague(onProgress) {
    const newGame = {
        year: 1, teams: [], players: [], freeAgents: [], draftClass: [], playerTeam: null, schedule: [],
        currentWeek: 0, draftOrder: [], currentPick: 0, hallOfFame: [],
        gameResults: [], messages: [], relationships: new Map(),
        pickHistory: [], history: { seasons: [] },
        community: createCommunityState(),
        availableStaff: generateStaffPool(6),
        coachCareerArchive: [],
        coachMarketArchive: [],
        records: {
            game: {},
            season: {},
            career: {}
        }
    };
    setGame(newGame);

    addMessage("Welcome!", "Generating the league and players...");

    // Generate enough players for the 20 initial main-team rosters
    // plus a small free-agent pool. Future rookie classes come from Pee Wee.
    const totalPlayers = 425;
    const initialClassModifiers = generateDraftClassModifiers();

    for (let i = 0; i < totalPlayers; i++) {
        game.players.push(generatePlayer(12, 18, initialClassModifiers)); // Age 12-18 for main league
        if (i % 10 === 0 && onProgress) {
            onProgress((i / totalPlayers) * 0.7);
            await yieldToMain();
        }
    }
    if (onProgress) onProgress(0.7);
    await yieldToMain();

    playerMap.clear();
    game.players.forEach(p => {
        if (p && p.id) playerMap.set(p.id, p);
    });

    buildSocialNetworks(game.players, game.players);
    if (onProgress) onProgress(0.9);
    await yieldToMain();

    if (onProgress) onProgress(0.9);
    await yieldToMain();

    availableColors = [...teamColors];
    const availableTeamNames = [...teamNames];

    for (let i = 0; i < 20; i++) {
        const nameIndex = getRandomInt(0, availableTeamNames.length - 1);
        const teamName = `The ${availableTeamNames.splice(nameIndex, 1)[0]}`;
        const tier = i < 10 ? 1 : 2;
        const coach = getRandom(coachPersonalities);

        const prefOff = offenseFormations[coach.preferredOffense] ? coach.preferredOffense : 'Balanced';
        const prefDef = defenseFormations[coach.preferredDefense] ? coach.preferredDefense : '3-2-3';

        const offenseFormationData = offenseFormations[prefOff] || offenseFormations['Balanced'];
        const defenseFormationData = defenseFormations[prefDef] || defenseFormations['3-2-3'];

        if (availableColors.length === 0) availableColors = [...teamColors];
        const colorSet = availableColors.splice(getRandomInt(0, availableColors.length - 1), 1)[0];

        const team = {
            id: crypto.randomUUID(), name: teamName, roster: [], coach, wins: 0, losses: 0,
            leagueType: 'main',
            tier: tier,
            ageMin: 12,
            ageMax: 18,
            primaryColor: colorSet?.primary || teamColors[0].primary,
            secondaryColor: colorSet?.secondary || teamColors[0].secondary,
            formations: { offense: prefOff, defense: prefDef },
            depthChart: {
                offense: Object.fromEntries((offenseFormationData?.slots || []).map(slot => [slot, null])),
                defense: Object.fromEntries((defenseFormationData?.slots || []).map(slot => [slot, null])),
                special: { P: null }
            },
            draftNeeds: 0,
            socialProfile: {
                streetCred: tier === 1 ? 60 : 35,
                favorTokens: 3
            },
            gameplan: {
                weeklyPractice: 'chalk_talk',
                practiceSchedule: {
                    sessionsPerWeek: 2,
                    minutesPerSession: 90
                },
                practiceFieldAccess: 'community',
                delegatePractice: false,
                delegateGameplan: false,
                delegateDepthChart: false,
                gmDirective: 'COACH_AUTONOMY', // 'COACH_AUTONOMY', 'WIN_NOW', 'DEVELOP_YOUTH', 'HARD_CONDITIONING'
                installedOffense: ['Uni_StretchRight', 'Uni_Stick', 'Uni_Drive', 'Uni_HB_Screen', 'PA_Crossers', 'Uni_Mesh'],
                installedDefense: ['Cover_3_Sky', 'Man_Blitz_Base', 'Nickel_Tampa_2', 'Fire_Zone_3'],
                mastery: {
                    'Uni_InsideZone': 85,
                    'Uni_QuickSlants': 85,
                    'Uni_FourVerts': 80,
                    'Cover_2_Zone_Base': 85,
                    'Cover_1_Robber': 80,
                    'GoalLine_RunStuff': 85,
                    'Uni_StretchRight': 55,
                    'Uni_Stick': 60,
                    'Uni_Drive': 50,
                    'Uni_HB_Screen': 45,
                    'PA_Crossers': 40,
                    'Uni_Mesh': 50,
                    'Cover_3_Sky': 55,
                    'Man_Blitz_Base': 50,
                    'Nickel_Tampa_2': 45,
                    'Fire_Zone_3': 40
                }
            }
        };
        initializeTeamStaff(team);
        game.teams.push(team);

        if (i % 4 === 0) await yieldToMain();
    }

    const youthMascots = [
        "Lil' Tykes",
        "Mini Monsters",
        "Sandlot Pups",
        "Junior Jets",
        "Tots",
        "Wildcats",
        "Little Legends",
        "Rookie Rockets",
        "Backyard Bandits",
        "Tiny Titans",
        "Playground Panthers",
        "Grassroots Giants",
        "Sidewalk Sharks",
        "Rookie Raccoons",
        "Little Lightning",
        "Sandlot Spartans",
        "Mini Mavericks",
        "Junior Jaguars",
        "Backyard Bears",
        "Playground Pros",
        "Rookie Rebels",
        "Little Comets",
        "Kickoff Cubs",
        "Endzone Eagles"
    ];

    for (let i = 0; i < youthMascots.length; i++) {
        const yTeam = {
            id: crypto.randomUUID(), name: `The ${youthMascots[i]}`, roster: [],
            coach: getRandom(coachPersonalities), wins: 0, losses: 0, ties: 0,
            leagueType: 'youth',
            tier: null,
            ageMin: 8,
            ageMax: 11,
            formations: { offense: 'Balanced', defense: '3-2-3' },
            depthChart: { offense: {}, defense: {}, special: { P: null } },
            isYouth: true
        };

        for (let j = 0; j < 14; j++) {
            const kid = generatePlayer(8, 11, initialClassModifiers);
            kid.teamId = yTeam.id;
            kid.lifecycle = 'youth';

            // Track original Pee Wee entry age and completed seasons.
            kid.youthEntryAge = Number(kid.age) || 8;
            kid.youthSeasonsPlayed = 0;
            kid.youthSeasonHistory = [];
            kid.youthCareerStats = createEmptySeasonStats();

            yTeam.roster.push(kid.id);
            game.players.push(kid);
            playerMap.set(kid.id, kid);
        }
        aiSetDepthChart(yTeam);
        game.teams.push(yTeam); // ✅ Now unified in game.teams
    }

    // Populate initial main-team rosters with positional balance and tier variance.
    const tier1Teams = game.teams.filter(t => t.tier === 1);
    const tier2Teams = game.teams.filter(t => t.tier === 2);

    const INITIAL_POSITION_TARGETS = {
        QB: 1,
        RB: 1,
        WR: 2,
        TE: 1,
        OL: 3,
        DL: 2,
        LB: 1,
        DB: 2
    };

    // Keep the overall talent pool sorted. Position-specific selections below
    // preserve that ordering, allowing Tier 1 to draw from stronger candidates.
    const unassigned = game.players
        .filter(p => !p.teamId && p.age >= 12 && p.age <= 18)
        .sort((a, b) =>
            calculateOverall(b, estimateBestPosition(b)) -
            calculateOverall(a, estimateBestPosition(a))
        );

    const pickInitialPlayer = (team, position, tier) => {
        const positionPool = unassigned.filter(
            p => (p.pos || estimateBestPosition(p)) === position
        );

        if (positionPool.length === 0) return false;

        // Tier 1 selects from the top 40% of available players at that position.
        // Tier 2 draws from the remaining pool.
        const candidatePool = tier === 1
            ? positionPool.slice(
                0,
                Math.max(1, Math.ceil(positionPool.length * 0.4))
            )
            : positionPool;

        const player = getRandom(candidatePool);
        if (!player || !addPlayerToTeam(player, team)) return false;

        const poolIndex = unassigned.findIndex(p => p.id === player.id);
        if (poolIndex !== -1) unassigned.splice(poolIndex, 1);

        return true;
    };

    const fillInitialRoster = (team, tier) => {
        const targetRosterSize = 14;

        // Fill the required positional groups first.
        for (const [position, targetCount] of Object.entries(INITIAL_POSITION_TARGETS)) {
            let assignedCount = 0;

            while (assignedCount < targetCount && team.roster.length < targetRosterSize) {
                if (!pickInitialPlayer(team, position, tier)) break;
                assignedCount++;
            }
        }

        // Use the remaining roster spot(s) for best available talent.
        while (team.roster.length < targetRosterSize && unassigned.length > 0) {
            const candidatePool = tier === 1
                ? unassigned.slice(
                    0,
                    Math.max(1, Math.ceil(unassigned.length * 0.4))
                )
                : unassigned;

            const player = getRandom(candidatePool);
            if (!player || !addPlayerToTeam(player, team)) break;

            const poolIndex = unassigned.findIndex(p => p.id === player.id);
            if (poolIndex !== -1) unassigned.splice(poolIndex, 1);
        }

        aiSetDepthChart(team);
    };

    // Tier 1 receives stronger options at each position before Tier 2 is filled.
    tier1Teams.forEach(team => fillInitialRoster(team, 1));
    tier2Teams.forEach(team => fillInitialRoster(team, 2));

    game.teams.forEach(team => {
        if (team) assignTeamCaptain(team);
    });

    initializeCommunityContacts(game);

    if (onProgress) onProgress(1.0);
    addMessage("Ready!", "League generated. Time to create your team.");
}

export function createPlayerTeam(teamName, options = {}) {
    if (!game || !game.teams) return;

    const { coachName, coachStyle, prefOff, prefDef, primaryColor, secondaryColor } = options;
    const finalTeamName = teamName.toLowerCase().startsWith("the ") ? teamName : `The ${teamName}`;

    let baseCoach = coachPersonalities.find(c => c.type === coachStyle) || coachPersonalities[0];
    const customCoach = JSON.parse(JSON.stringify(baseCoach));
    customCoach.name = coachName || 'Coach';
    if (prefOff) customCoach.preferredOffense = prefOff;
    if (prefDef) customCoach.preferredDefense = prefDef;

    let defaultOffense = prefOff || 'Balanced';
    let defaultDefense = prefDef || '3-2-3';
    if (!offenseFormations[defaultOffense]) defaultOffense = Object.keys(offenseFormations)[0];
    if (!defenseFormations[defaultDefense]) defaultDefense = Object.keys(defenseFormations)[0];

    const defaultOffenseSlots = offenseFormations[defaultOffense]?.slots || [];
    const defaultDefenseSlots = defenseFormations[defaultDefense]?.slots || [];

    const playerTeam = {
        id: crypto.randomUUID(),
        name: finalTeamName,
        roster: [],
        coach: customCoach,
        leagueType: 'main',
        tier: 1,
        ageMin: 12,
        ageMax: 18,
        wins: 0,
        losses: 0,
        primaryColor: primaryColor || '#2563EB',
        secondaryColor: secondaryColor || '#FFFFFF',
        formations: { offense: defaultOffense, defense: defaultDefense },
        depthChart: {
            offense: Object.fromEntries(defaultOffenseSlots.map(slot => [slot, null])),
            defense: Object.fromEntries(defaultDefenseSlots.map(slot => [slot, null])),
            special: { P: null }
        },
        draftNeeds: 0,
        isPlayerControlled: true,
        socialProfile: {
            streetCred: 50,
            favorTokens: 3
        }
    };

    game.teams.push(playerTeam);
    game.playerTeam = playerTeam;
    return playerTeam;
}

export function addPlayerToTeam(player, team, gameState = game) {
    if (
        !player ||
        !team ||
        !Array.isArray(team.roster) ||
        player.id == null
    ) {
        return false;
    }

    // A player already assigned to another team must be released from
    // that team before being added here. This prevents duplicate ownership.
    if (
        player.teamId != null &&
        String(player.teamId) !== String(team.id)
    ) {
        return false;
    }

    // A player who permanently walked away over a broken promise cannot
    // return to that specific team through any recruiting pathway.
    const hasRefusedThisTeam =
        Array.isArray(player.refusedTeamIds) &&
        player.refusedTeamIds.some(
            refusedTeamId =>
                String(refusedTeamId) === String(team.id)
        );

    if (hasRefusedThisTeam) return false;

    // Reject players who are still listed on another team's roster,
    // even if their player.teamId field is missing or stale.
    const listedOnAnotherTeam =
        Array.isArray(gameState?.teams) &&
        gameState.teams.some(candidateTeam => {
            if (
                !candidateTeam ||
                String(candidateTeam.id) === String(team.id) ||
                !Array.isArray(candidateTeam.roster)
            ) {
                return false;
            }

            return candidateTeam.roster.some(entry => {
                const rosterPlayerId =
                    entry && typeof entry === 'object'
                        ? entry.id
                        : entry;

                return (
                    rosterPlayerId != null &&
                    String(rosterPlayerId) === String(player.id)
                );
            });
        });

    if (listedOnAnotherTeam) return false;

    const currentLimit = getCurrentRosterLimit(gameState);
    if (team.roster.length >= currentLimit) return false;

    const alreadyOnRoster = team.roster.some(
        rosterPlayerId =>
            String(rosterPlayerId) === String(player.id)
    );

    if (alreadyOnRoster) return false;

    if (player.number == null) {
        // Use the publicly listed position for jersey-number preferences.
        // Do not inspect hidden ratings just to choose a uniform number.
        const primaryPos = normalizeTrainingPosition(
            player.pos ||
            player.position ||
            player.Pos
        ) || 'ATH';

        let preferredRanges = [];
        switch (primaryPos) {
            case 'QB': preferredRanges.push([1, 19]); break;
            case 'WR': preferredRanges.push([10, 19], [80, 89]); break;
            case 'RB': preferredRanges.push([20, 39]); break;
            case 'DB': preferredRanges.push([20, 49]); break;
            case 'LB': preferredRanges.push([40, 59], [90, 99]); break;
            case 'OL': preferredRanges.push([60, 79]); break;
            case 'DL': preferredRanges.push([60, 79], [90, 99]); break;
            default: preferredRanges.push([1, 99]);
        }

        const fullRoster = getRosterObjects(team);
        const existingNumbers = new Set(fullRoster.map(p => p.number).filter(n => n !== null));

        let preferredNumbers = [];
        for (const range of preferredRanges) {
            for (let i = range[0]; i <= range[1]; i++) {
                if (!existingNumbers.has(i)) preferredNumbers.push(i);
            }
        }
        preferredNumbers.sort(() => 0.5 - Math.random());

        if (preferredNumbers.length > 0) {
            player.number = preferredNumbers[0];
        } else {
            let fallbackNumber;
            let attempts = 0;
            do {
                fallbackNumber = getRandomInt(1, 99);
                attempts++;
            } while (existingNumbers.has(fallbackNumber) && attempts < 200);

            if (existingNumbers.has(fallbackNumber)) {
                for (let i = 1; i <= 99; i++) {
                    if (!existingNumbers.has(i)) { fallbackNumber = i; break; }
                }
            }
            player.number = fallbackNumber;
        }
    }

    player.teamId = team.id;
    team.roster.push(player.id);

    if (
        !team.depthOrder ||
        typeof team.depthOrder !== 'object' ||
        Array.isArray(team.depthOrder)
    ) {
        team.depthOrder = {
            QB: [],
            RB: [],
            WR: [],
            TE: [],
            OL: [],
            DL: [],
            LB: [],
            DB: []
        };
    }

    // Ensure every standard position has a valid depth-order array.
    for (const position of [
        'QB', 'RB', 'WR', 'TE',
        'OL', 'DL', 'LB', 'DB'
    ]) {
        if (!Array.isArray(team.depthOrder[position])) {
            team.depthOrder[position] = [];
        }
    }

    let offPos = player.favoriteOffensivePosition || 'WR';
    if (['FB'].includes(offPos)) offPos = 'RB';
    if (['ATH', 'K', 'P'].includes(offPos)) offPos = 'WR';
    if (['OT', 'OG', 'C'].includes(offPos)) offPos = 'OL';
    if (!team.depthOrder[offPos]) offPos = 'WR';

    let defPos = player.favoriteDefensivePosition || 'DB';
    if (['CB', 'S', 'FS', 'SS'].includes(defPos)) defPos = 'DB';
    if (['DE', 'DT', 'NT'].includes(defPos)) defPos = 'DL';
    if (!team.depthOrder[defPos]) defPos = 'DB';

    // Add the player only when that ID is not already present.
    const addToDepthOrder = position => {
        const depthList = team.depthOrder[position];

        const alreadyListed = depthList.some(entry => {
            const existingId =
                entry && typeof entry === 'object'
                    ? entry.id
                    : entry;

            return (
                existingId != null &&
                String(existingId) === String(player.id)
            );
        });

        if (!alreadyListed) {
            depthList.push(player.id);
        }
    };

    addToDepthOrder(offPos);

    if (defPos !== offPos) {
        addToDepthOrder(defPos);
    }

    return true;
}

/*export function simulateAIPick(team) {
    if (!team || !team.roster || !game || !game.players || !team.coach) return null;
    if (team.roster.length >= ROSTER_LIMIT) return null;

    const undraftedPlayers = game.players.filter(p =>
        p && !p.teamId && (!p.status || p.status.duration === 0) &&
        p.status?.type !== 'retired' && p.status?.type !== 'departed'
    );
    if (undraftedPlayers.length === 0) return null;

    const rosterObjs = getRosterObjects(team);
    let qbCount = 0, trenchCount = 0, skillCount = 0;

    rosterObjs.forEach(p => {
        const pos = estimateBestPosition(p);
        if (pos === 'QB') qbCount++;
        else if (['OL', 'DL', 'C', 'DT', 'DE', 'OT', 'OG'].includes(pos)) trenchCount++;
        else skillCount++;
    });

    let bestPick = { player: null, score: -Infinity };

    undraftedPlayers.forEach(player => {
        const pos = estimateBestPosition(player);
        let baseScore = getPlayerScore(player, team.coach);
        let needMultiplier = 1.0;

        if (pos === 'QB') {
            if (qbCount === 0) needMultiplier = 3.0;
            else if (qbCount === 1) needMultiplier = 1.2;
            else needMultiplier = 0.1;
        } else if (['OL', 'DL', 'C', 'DT', 'DE', 'OT', 'OG'].includes(pos)) {
            if (trenchCount < 4) needMultiplier = 2.2;
            else if (trenchCount < 7) needMultiplier = 1.4;
            else needMultiplier = 0.5;
        } else {
            if (skillCount < 6) needMultiplier = 1.6;
            else if (skillCount < 10) needMultiplier = 1.1;
            else needMultiplier = 0.7;
        }

        const finalScore = baseScore * needMultiplier;
        if (finalScore > bestPick.score) {
            bestPick = { player, score: finalScore };
        }
    });

    if (bestPick.player) {
        addPlayerToTeam(bestPick.player, team);
    }
    return bestPick.player;
}*/

export function generateDraftSummary() {
    if (!game || !game.pickHistory || game.pickHistory.length === 0) return;
    const history = game.pickHistory;
    const topPick = history[0];

    let steal = topPick;
    if (history.length > 5) {
        steal = [...history].sort((a, b) => (b.ovr - (b.pick * 0.5)) - (a.ovr - (a.pick * 0.5)))[0];
    }

    const teamGrades = {};
    history.forEach(p => {
        if (!teamGrades[p.teamName]) teamGrades[p.teamName] = { total: 0, count: 0 };
        teamGrades[p.teamName].total += p.ovr;
        teamGrades[p.teamName].count++;
    });

    const bestDraft = Object.entries(teamGrades)
        .map(([name, data]) => ({ name, avg: data.total / data.count }))
        .sort((a, b) => b.avg - a.avg)[0];

    let body = `The draft has officially concluded! Here is the league-wide wrap-up:\n\n` +
        `**No. 1 Overall Pick:** ${topPick.teamName} selected **${topPick.playerName}** (${topPick.pos}). Scouts expect him to be a day-one starter.\n\n`;

    if (steal && steal.pick > 5) {
        body += `**Steal of the Draft:** Everyone is talking about **${steal.playerName}**, who fell to pick #${steal.pick}. ${steal.teamName} got incredible value for a player of his caliber.\n\n`;
    }

    if (bestDraft) {
        body += `**Best Draft Class:** **${bestDraft.name}** is receiving high marks from analysts, drafting a class with an average OVR of ${Math.round(bestDraft.avg)}.\n\n`;
    }

    body += `The preseason is now underway. Check your roster and set your depth charts!`;
    addMessage("Draft Recap: Winners and Losers", body, false, game);
}

export function getTeamOverall(team) {
    const roster = getRosterObjects(team);
    if (!roster || !roster.length) return 50;

    // ZenGM Style: A team's OVR is dictated by its top 8 starters, not dragged down by bench scrubs
    const sortedOvr = roster
        .map(p => calculateOverall(p, estimateBestPosition(p)))
        .sort((a, b) => b - a);

    const top8 = sortedOvr.slice(0, 8);
    if (top8.length === 0) return 50;

    const sum = top8.reduce((s, val) => s + val, 0);
    return Math.round(sum / top8.length);
}

export function generateHistoricalStats(team, score) {
    const roster = getRosterObjects(team);

    // Initialize all gameStats for active roster players
    roster.forEach(p => {
        if (p && !p.gameStats) {
            p.gameStats = {
                passAttempts: 0,
                passCompletions: 0,
                passYards: 0,
                interceptionsThrown: 0,
                rushAttempts: 0,
                rushYards: 0,
                receptions: 0,
                recYards: 0,
                targets: 0,
                drops: 0,
                pancakes: 0,
                tackles: 0,
                sacks: 0,
                interceptions: 0,
                fumbles: 0,
                fumblesLost: 0,
                fumblesRecovered: 0,
                returnYards: 0,
                touchdowns: 0,
                safeties: 0
            };
        }

        if (p?.gameStats && !Number.isFinite(p.gameStats.pancakes)) {
            p.gameStats.pancakes = 0;
        }
    });

    // Helper: Gathers starters AND rotational backups so the entire roster gets realistic reps
    const getRoleEntries = (side, positionPrefix) => {
        const depth = team.depthChart?.[side] || {};
        const depthPool = team.depthOrder?.[positionPrefix] || [];
        const seenPlayerIds = new Set();
        const entries = [];

        // 1. Primary starters from depth chart slots (includes FB mapping for RB)
        Object.entries(depth).forEach(([slot, playerId]) => {
            if (!playerId) return;
            const isMatch = slot.startsWith(positionPrefix) || (positionPrefix === 'RB' && slot.startsWith('FB'));
            if (isMatch && !seenPlayerIds.has(String(playerId))) {
                const player = roster.find(p => p && String(p.id) === String(playerId));
                if (player?.gameStats) {
                    seenPlayerIds.add(String(playerId));
                    const ovr = calculateOverall(player, positionPrefix);
                    const stamina = player.attributes?.physical?.stamina || 50;
                    entries.push({ slot, player, tier: 'starter', ovr, stamina });
                }
            }
        });

        // 2. Rotational backups & reserves from depth order and roster viability
        depthPool.forEach((playerId, index) => {
            if (!playerId || seenPlayerIds.has(String(playerId))) return;
            const player = roster.find(p => p && String(p.id) === String(playerId));
            if (player?.gameStats) {
                seenPlayerIds.add(String(playerId));
                const ovr = calculateOverall(player, positionPrefix);
                const stamina = player.attributes?.physical?.stamina || 50;
                entries.push({
                    slot: `${positionPrefix}_sub_${index + 1}`,
                    player,
                    tier: index === 0 ? 'rotation' : 'reserve',
                    ovr,
                    stamina
                });
            }
        });

        // 3. Fallback: Catch any natural players at this position not yet placed
        const favoritePositionKey = side === 'offense' ? 'favoriteOffensivePosition' : 'favoriteDefensivePosition';
        roster.forEach(player => {
            if (!player?.gameStats || seenPlayerIds.has(String(player.id))) return;
            const natPos = player[favoritePositionKey] || player.pos;
            if (natPos === positionPrefix || isPlayerViableForPosition(player, positionPrefix)) {
                seenPlayerIds.add(String(player.id));
                const ovr = calculateOverall(player, positionPrefix);
                const stamina = player.attributes?.physical?.stamina || 50;
                entries.push({
                    slot: `${positionPrefix}_bench`,
                    player,
                    tier: 'reserve',
                    ovr,
                    stamina
                });
            }
        });

        // Compute baseline benchmark from the top starter(s) in this room
        const starterEntries = entries.filter(e => e.tier === 'starter');
        const topStarterOvr = starterEntries.length > 0
            ? Math.max(...starterEntries.map(s => s.ovr))
            : (entries[0]?.ovr || 50);

        const topStarterStamina = starterEntries.length > 0
            ? Math.round(starterEntries.reduce((sum, s) => sum + s.stamina, 0) / starterEntries.length)
            : 50;

        entries.forEach(e => {
            e.topStarterOvr = topStarterOvr;
            e.topStarterStamina = topStarterStamina;
        });

        return entries;
    };

    // Role weights: Scaled by Base, Skill Gap vs. Starter, and Stamina
    const getRoleWeight = entry => {
        const position = entry.slot.split('_')[0].replace(/\d+$/, '');
        const isStarter = entry.tier === 'starter' || !entry.tier;
        const isRotation = entry.tier === 'rotation';

        let baseWeight = 4;
        if (position === 'WR') baseWeight = 5;
        else if (position === 'TE') baseWeight = 4;
        else if (position === 'RB' || position === 'FB') baseWeight = 6;
        else if (position === 'QB') baseWeight = 14;
        else if (position === 'DL' || position === 'LB' || position === 'DB') baseWeight = 5;

        // 1. Stamina Factor: high stamina gives greater volume capacity without fatigue
        const stamina = entry.stamina || 50;
        const staminaFactor = Math.max(0.70, Math.min(1.30, 0.75 + (stamina / 200)));

        if (isStarter) {
            return Math.max(1, Math.round(baseWeight * staminaFactor * 10) / 10);
        }

        // 2. Skill Gap: close skill creates a committee; wide gap creates a bellcow
        const ovrGap = Math.max(0, (entry.topStarterOvr || 50) - (entry.ovr || 50));
        const gapAdjustment = Math.max(-0.12, Math.min(0.16, (10 - ovrGap) * 0.01));

        // 3. Starter Stamina Need: low starter stamina forces more backup rotations
        const starterStamina = entry.topStarterStamina || 50;
        const starterFatigueNeed = (50 - starterStamina) * 0.003;

        let shareRatio = isRotation ? 0.22 : 0.07;
        shareRatio += gapAdjustment + starterFatigueNeed;

        // Position-specific ratio guardrails
        if (position === 'QB') {
            // Backup QBs rarely take snaps unless blowout or starter gassed
            shareRatio = Math.max(0.04, Math.min(0.18, shareRatio));
        } else if (position === 'RB') {
            // RBs frequently form 65/35 committees
            shareRatio = Math.max(0.06, Math.min(0.42, shareRatio));
        } else {
            shareRatio = Math.max(0.05, Math.min(0.35, shareRatio));
        }

        const finalWeight = baseWeight * shareRatio * staminaFactor;
        return Math.max(0.5, Math.round(finalWeight * 10) / 10);
    };

    const distributeTotal = (total, entries) => {
        if (entries.length === 0) return [];

        const safeTotal = Math.max(0, Math.floor(Number(total) || 0));
        const weights = entries.map(getRoleWeight);
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

        if (totalWeight <= 0) return entries.map(() => 0);

        let cumulativeWeight = 0;
        return weights.map(weight => {
            const before = Math.floor(safeTotal * cumulativeWeight / totalWeight);
            cumulativeWeight += weight;
            const after = Math.floor(safeTotal * cumulativeWeight / totalWeight);
            return after - before;
        });
    };

    const addStat = (entry, stat, amount) => {
        if (!entry?.player?.gameStats || !Number.isFinite(amount) || amount <= 0) return;
        const stats = entry.player.gameStats;
        stats[stat] = (Number(stats[stat]) || 0) + amount;
    };

    const qbs = getRoleEntries('offense', 'QB');
    const runningBacks = getRoleEntries('offense', 'RB');
    const wideReceivers = getRoleEntries('offense', 'WR');
    const tightEnds = getRoleEntries('offense', 'TE');
    const offensiveLine = getRoleEntries('offense', 'OL');

    const defensiveLine = getRoleEntries('defense', 'DL');
    const linebackers = getRoleEntries('defense', 'LB');
    const defensiveBacks = getRoleEntries('defense', 'DB');

    const totalTouchdowns = Math.floor(Math.max(0, score) / 7);
    const passTds = qbs.length > 0 ? Math.floor(totalTouchdowns * 0.6) : 0;
    const rushTds = totalTouchdowns - passTds;

    // --- 1. PASSING (Starter QB gets ~85%, backup gets ~15% in garbage time) ---
    const totalPassAttempts = getRandomInt(16, 26);
    const qbAttemptShares = distributeTotal(totalPassAttempts, qbs);
    const qbTdShares = distributeTotal(passTds, qbs);

    qbs.forEach((entry, idx) => {
        const att = qbAttemptShares[idx] || 0;
        if (att <= 0) return;
        const comp = Math.floor(att * (0.52 + Math.random() * 0.18));
        addStat(entry, 'passAttempts', att);
        addStat(entry, 'passCompletions', comp);
        addStat(entry, 'passYards', comp * getRandomInt(8, 12));
        addStat(entry, 'touchdowns', qbTdShares[idx] || 0);
        if (Math.random() < 0.35) addStat(entry, 'interceptionsThrown', 1);
    });

    // --- 2. RUSHING (RB1 takes lead, RB2 & backup take rotational carries) ---
    const rushers = runningBacks.length > 0 ? runningBacks : qbs;
    const totalRushes = getRandomInt(12, 22);
    const rushAttemptShares = distributeTotal(totalRushes, rushers);
    const rushTdShares = distributeTotal(rushTds, rushers);

    rushers.forEach((entry, index) => {
        const attempts = rushAttemptShares[index] || 0;
        if (attempts <= 0) return;
        addStat(entry, 'rushAttempts', attempts);
        addStat(entry, 'rushYards', attempts * getRandomInt(3, 6));
        addStat(entry, 'touchdowns', rushTdShares[index] || 0);
    });

    // --- 3. RECEIVING (All WRs, TEs, and RBs get realistic target distribution) ---
    const receiverMap = new Map();
    [...wideReceivers, ...tightEnds, ...runningBacks].forEach(entry => {
        const playerId = String(entry.player.id);
        const existing = receiverMap.get(playerId);
        if (!existing || getRoleWeight(entry) > getRoleWeight(existing)) {
            receiverMap.set(playerId, entry);
        }
    });

    const receivers = [...receiverMap.values()];
    const totalCompletions = qbs.reduce((sum, qb) => sum + (qb.player.gameStats?.passCompletions || 0), 0);
    const targetShares = distributeTotal(totalPassAttempts, receivers);
    const receptionShares = distributeTotal(totalCompletions, receivers);
    const receivingTdShares = distributeTotal(passTds, receivers);

    receivers.forEach((entry, index) => {
        const targets = targetShares[index] || 0;
        const receptions = Math.min(targets, receptionShares[index] || 0);
        if (targets <= 0) return;

        const isTightEnd = entry.slot.includes('TE');
        const yardsPerCatch = getRandomInt(isTightEnd ? 8 : 9, isTightEnd ? 13 : 15);

        addStat(entry, 'targets', targets);
        addStat(entry, 'receptions', receptions);
        addStat(entry, 'recYards', receptions * yardsPerCatch);

        if (targets > receptions && Math.random() < 0.12) {
            addStat(entry, 'drops', 1);
        }
        addStat(entry, 'touchdowns', Math.min(receptions, receivingTdShares[index] || 0));
    });

    // --- 4. OFFENSIVE LINE (All linemen log pancake blocks) ---
    offensiveLine.forEach(entry => {
        const isStarter = entry.tier === 'starter';
        addStat(entry, 'pancakes', isStarter ? getRandomInt(0, 3) : (Math.random() < 0.4 ? 1 : 0));
    });

    // --- 5. DEFENSE (Starters & rotational depth accumulate tackles & takeaways) ---
    defensiveLine.forEach(entry => {
        const isStarter = entry.tier === 'starter';
        addStat(entry, 'tackles', isStarter ? getRandomInt(1, 4) : getRandomInt(0, 2));
        if (Math.random() < (isStarter ? 0.22 : 0.08)) addStat(entry, 'sacks', 1);
        if (Math.random() < 0.02) addStat(entry, 'fumblesRecovered', 1);
    });

    linebackers.forEach(entry => {
        const isStarter = entry.tier === 'starter';
        addStat(entry, 'tackles', isStarter ? getRandomInt(2, 5) : getRandomInt(1, 3));
        if (Math.random() < (isStarter ? 0.12 : 0.04)) addStat(entry, 'sacks', 1);
        if (Math.random() < (isStarter ? 0.04 : 0.01)) addStat(entry, 'interceptions', 1);
        if (Math.random() < 0.02) addStat(entry, 'fumblesRecovered', 1);
    });

    defensiveBacks.forEach(entry => {
        const isStarter = entry.tier === 'starter';
        addStat(entry, 'tackles', isStarter ? getRandomInt(1, 4) : getRandomInt(0, 2));
        if (Math.random() < (isStarter ? 0.06 : 0.02)) {
            addStat(entry, 'interceptions', 1);
            addStat(entry, 'returnYards', getRandomInt(5, 25));
        }
        if (Math.random() < 0.015) addStat(entry, 'fumblesRecovered', 1);
    });
}

export function simulateHistoricalMatch(homeTeam, awayTeam) {
    // Only youth league matchups use the probabilistic youth simulator
    if (homeTeam?.leagueType === 'youth' && awayTeam?.leagueType === 'youth') {
        try {
            const result = simulateYouthMatch(homeTeam, awayTeam);

            if (
                !result ||
                !Number.isFinite(result.homeScore) ||
                !Number.isFinite(result.awayScore)
            ) {
                throw new Error('Historical simulator returned an invalid result.');
            }

            return result;
        } catch (error) {
            console.error(
                `[Historical Sim] Failed: ${
                    homeTeam.name || homeTeam.id || 'Home'
                } vs ${
                    awayTeam.name || awayTeam.id || 'Away'
                }`,
                error
            );

            throw error;
        }
    }

    // Main-League Franchises (Tier 1 & Tier 2) generate full box scores and player stats
    const homeOvr = getTeamOverall(homeTeam);
    const awayOvr = getTeamOverall(awayTeam);

    const homeAdvantage = 3;
    let homeScore = Math.max(0, Math.floor(homeOvr / 5 + homeAdvantage + getRandomInt(-14, 14)));
    let awayScore = Math.max(0, Math.floor(awayOvr / 5 + getRandomInt(-14, 14)));

    if (homeScore === awayScore) homeScore += Math.random() > 0.5 ? 3 : -3;
    homeScore = Math.max(0, homeScore);
    awayScore = Math.max(0, awayScore);

    resetGameStats(homeTeam, awayTeam);
    generateHistoricalStats(homeTeam, homeScore);
    generateHistoricalStats(awayTeam, awayScore);

        // Record realistic snap distribution across starters, rotation, and reserves with stamina influence
        [homeTeam, awayTeam].forEach(team => {
            const offStarters = new Set(Object.values(team.depthChart?.offense || {}).filter(Boolean));
            const defStarters = new Set(Object.values(team.depthChart?.defense || {}).filter(Boolean));

            getRosterObjects(team).forEach(p => {
                if (!p.careerStats) p.careerStats = { seasonsPlayed: 0 };
                const isStarter = offStarters.has(p.id) || defStarters.has(p.id);
                const isTwoWay = offStarters.has(p.id) && defStarters.has(p.id);

                const stm = p.attributes?.physical?.stamina || 50;
                const stmOffset = Math.round((stm - 50) * 0.08); // -3 to +3 snaps based on conditioning

                const baseSnaps = isTwoWay ? getRandomInt(42, 48) : (isStarter ? getRandomInt(30, 36) : getRandomInt(8, 16));
                const finalSnaps = Math.max(4, baseSnaps + stmOffset);
                p.careerStats.snapsThisSeason = (p.careerStats.snapsThisSeason || 0) + finalSnaps;
            });
        });

    finalizeGameResults(homeTeam, awayTeam, homeScore, awayScore);
}

export function simulateHistoricalSeason(yearNum, gameInstance) {
    if (!gameInstance?.teams || !gameInstance?.players) return;

    // Every historical season starts with clean standings and player totals.
    // Career statistics and historical records remain intact.
    gameInstance.teams.forEach(team => {
        if (!team) return;

        team.wins = 0;
        team.losses = 0;
        team.ties = 0;
    });

    gameInstance.players.forEach(player => {
        if (!player) return;

        player.seasonStats = createEmptySeasonStats();
        player.gameStats = null;

        if (
            player.careerStats &&
            typeof player.careerStats === 'object'
        ) {
            player.careerStats.snapsThisSeason = 0;
        }
    });

    gameInstance.currentWeek = 0;
    generateSchedule();

    // Collect season-start dues for all main teams during historical
    // simulation. seasonDuesYear prevents duplicate charges.
    processSeasonStartDues(gameInstance);

    const numWeeks = 9;
    const gamesPerWeek = gameInstance.teams.length / 2;

    for (let w = 0; w < numWeeks; w++) {
        const startIndex = w * gamesPerWeek;
        const endIndex = startIndex + gamesPerWeek;
        const weeklyGames = gameInstance.schedule.slice(startIndex, endIndex);

        weeklyGames.forEach(match => {
            if (match && match.home && match.away) {
                simulateHistoricalMatch(match.home, match.away);
            }
        });

        // Run the normal postgame systems for this historical week:
        // finances, AI preparation, practice, scouting, events, and growth.
        processEndOfWeek();

        gameInstance.currentWeek++;
    }

    const mainTeams = gameInstance.teams.filter(t => t.leagueType === 'main');
    const tier1Teams = mainTeams.filter(t => t.tier === 1).sort((a, b) => (b.wins || 0) - (a.wins || 0) || (a.losses || 0) - (b.losses || 0));
    const tier2Teams = mainTeams.filter(t => t.tier === 2).sort((a, b) => (b.wins || 0) - (a.wins || 0) || (a.losses || 0) - (b.losses || 0));
    const youthTeams = gameInstance.teams.filter(t => t.leagueType === 'youth').sort((a, b) => (b.wins || 0) - (a.wins || 0) || (a.losses || 0) - (b.losses || 0));

    const champion = tier1Teams[0];
    const runnerUp = tier1Teams[1];
    const relegated = tier1Teams.slice(-2);
    const promoted = tier2Teams.slice(0, 2);

    // Capture historical season league leaders before stats reset
    const allPlayers = gameInstance.players || [];
    const topPasser = [...allPlayers].sort((a, b) => (b.seasonStats?.passYards || 0) - (a.seasonStats?.passYards || 0))[0];
    const topRusher = [...allPlayers].sort((a, b) => (b.seasonStats?.rushYards || 0) - (a.seasonStats?.rushYards || 0))[0];
    const topTackler = [...allPlayers].sort((a, b) => (b.seasonStats?.tackles || 0) - (a.seasonStats?.tackles || 0))[0];

    gameInstance.history = gameInstance.history || { seasons: [] };
    gameInstance.history.seasons.push({
        year: yearNum,
        champion: champion ? champion.name : "Unknown",
        runnerUp: runnerUp ? runnerUp.name : "Unknown",
        tier2Champion: tier2Teams[0] ? tier2Teams[0].name : "Unknown",
        youthChampion: youthTeams[0] ? youthTeams[0].name : "Unknown",
        leaders: {
            passer: topPasser && (topPasser.seasonStats?.passYards || 0) > 0 ? `${topPasser.name} (${topPasser.seasonStats.passYards} yds)` : 'None',
            rusher: topRusher && (topRusher.seasonStats?.rushYards || 0) > 0 ? `${topRusher.name} (${topRusher.seasonStats.rushYards} yds)` : 'None',
            tackler: topTackler && (topTackler.seasonStats?.tackles || 0) > 0 ? `${topTackler.name} (${topTackler.seasonStats.tackles} tkls)` : 'None'
        },
        standings: [
            ...tier1Teams.map(t => ({
                id: t.id,
                name: t.name,
                wins: t.wins,
                losses: t.losses,
                ties: t.ties || 0,
                tier: 1
            })),
            ...tier2Teams.map(t => ({
                id: t.id,
                name: t.name,
                wins: t.wins,
                losses: t.losses,
                ties: t.ties || 0,
                tier: 2
            }))
        ],
        promoted: promoted.map(t => t.name),
        relegated: relegated.map(t => t.name),
        draftResults: [],
        reportSnapshot: buildSeasonReportSnapshot(
            gameInstance,
            yearNum,
            tier1Teams,
            tier2Teams,
            youthTeams
        )
    });
}

export function generateSchedule() {
    if (!game || !game.teams) return;
    game.schedule = [];
    game.currentWeek = 0;
    const numWeeks = 9;
    const allWeeklyGames = Array(numWeeks).fill(null).map(() => []);

    const schedulePool = (poolTeams) => {
        if (poolTeams.length < 2) return;
        const t0 = poolTeams[0];
        const others = poolTeams.slice(1);

        for (let round = 0; round < numWeeks; round++) {
            if (others.length > 0) {
                allWeeklyGames[round].push({ home: t0, away: others[0] });
                for (let i = 1; i < others.length / 2; i++) {
                    const home = others[i];
                    const away = others[others.length - i];
                    if (home && away) {
                        allWeeklyGames[round].push(round % 2 === 0 ? { home, away } : { home: away, away: home });
                    }
                }
                others.push(others.shift());
            }
        }
    };

    schedulePool(game.teams.filter(t => t.tier === 1));
    schedulePool(game.teams.filter(t => t.tier === 2));
    schedulePool(game.teams.filter(t => t.leagueType === 'youth'));

    game.schedule = allWeeklyGames.flat();
}

export function updatePlayerStatuses() {
    if (!game || !game.players) return;
    for (const player of game.players) {
        if (!player || !player.status) continue;
        if (player.status.duration > 0) {
            player.status.duration--;
            if (player.status.duration === 0 && player.status.type !== 'temporary') {
                player.status.type = 'healthy';
                player.status.description = '';
                if (player.teamId === game.playerTeam?.id) {
                    addMessage('Player Recovered', `${player.name} is now available.`);
                }
            }
        }
        if (player.breakthroughAttr) delete player.breakthroughAttr;
        if (player.status.isNew) player.status.isNew = false;
    }
}

export function endOfWeekCleanup() {
    if (!game || !game.teams) return;

    game.teams.forEach(team => {
        if (!team || !Array.isArray(team.roster)) return;

        // Remove any legacy temporary players still stored in the
        // permanent roster.
        team.roster = team.roster.filter(id => {
            const player = getPlayer(id);

            if (!player) return false;

            if (player.status?.type === 'temporary') {
                player.teamId = null;
                player.number = null;
                return false;
            }

            return true;
        });

        if (!Array.isArray(team.temporaryPlayers)) {
            team.temporaryPlayers = [];
        }

        // Only healthy, available permanent players count toward
        // the minimum roster needed to field an 8v8 game.
        const availablePermanentCount = getRosterObjects(team).filter(player =>
            player &&
            !['departed', 'retired'].includes(player.status?.type) &&
            (
                !player.status ||
                Number(player.status.duration || 0) <= 0
            )
        ).length;

        if (availablePermanentCount >= 8) {
            // The permanent roster has recovered. Release all friends.
            team.temporaryPlayers.forEach(id => {
                const player = getPlayer(id);

                if (!player) return;

                if (player.status?.type === 'temporary') {
                    player.status = {
                        type: 'healthy',
                        description: '',
                        duration: 0
                    };
                }

                player.teamId = null;
                player.number = null;
            });

            team.temporaryPlayers = [];
        } else {
            // Keep valid temporary friends while the permanent roster
            // is still too short to field a team.
            const seen = new Set();

            team.temporaryPlayers = team.temporaryPlayers.filter(id => {
                if (id == null) return false;

                const player = getPlayer(id);
                const playerId = String(id);

                if (
                    !player ||
                    player.id == null ||
                    seen.has(playerId) ||
                    player.teamId != null ||
                    player.status?.type !== 'temporary'
                ) {
                    return false;
                }

                // A temporary friend cannot help two teams at once.
                const assignedToAnotherTeam = game.teams.some(other =>
                    other &&
                    String(other.id) !== String(team.id) &&
                    Array.isArray(other.temporaryPlayers) &&
                    other.temporaryPlayers.some(
                        otherId => String(otherId) === playerId
                    )
                );

                if (assignedToAnotherTeam) return false;

                seen.add(playerId);
                return true;
            });
        }

        rebuildDepthChartFromOrder(team);
    });
}

export function generateWeeklyEvents() {
    if (!game || !game.teams) return;

    game.teams.forEach(team => {
        const roster = getRosterObjects(team);
        if (roster.length === 0) return;

        roster.forEach(player => {
            if (player.status?.type === 'temporary' || player.status?.duration > 0) return;

            const dependability = player.personality?.dependability || 60;
            const flakeChance = (100 - dependability) / 1800;

            if (Math.random() < flakeChance) {
                const reasons = [
                    'Grounded for bad report card',
                    'Family road trip to visit grandma',
                    'Has to babysit younger sibling',
                    'Got detention after school'
                ];
                const reason = getRandom(reasons);
                player.status = { type: 'busy', description: reason, duration: getRandomInt(1, 2), isNew: true };
                if (team.id === game.playerTeam?.id) {
                    addMessage('Unavailable this week', `⚠️ ${player.name} cannot play: ${reason}.`);
                }
                return;
            }

            if (Math.random() < 0.004) {
                const buddy = roster.find(other =>
                    other.id !== player.id &&
                    getRelationshipLevel(player.id, other.id) >= relationshipLevels.GOOD_FRIEND.level
                );

                if (buddy && buddy.status?.duration === 0) {
                    player.status = { type: 'busy', description: 'Flat bike tire / missed ride', duration: 1, isNew: true };
                    buddy.status = { type: 'busy', description: 'Flat bike tire / missed ride', duration: 1, isNew: true };
                    if (team.id === game.playerTeam?.id) {
                        addMessage('Bike Disaster!', `🚲 ${player.name} and ${buddy.name} ride together to games, but their bike chain snapped on the way! Both miss this week.`);
                    }
                    return;
                }
            }

            if (dependability < 40 && Math.random() < 0.01) {
                const smartTeammate = roster.find(other => (other.attributes?.mental?.playbookIQ || 50) > 75);
                if (smartTeammate) {
                    player.personality.dependability = Math.min(99, dependability + 5);
                    improveRelationship(player.id, smartTeammate.id);
                    if (team.id === game.playerTeam?.id) {
                        addMessage('Study Session', `📚 ${smartTeammate.name} helped ${player.name} pass his algebra test. His dependability improved (+5)!`);
                    }
                    return;
                }
            }

            if (Math.random() < 0.005) {
                const injuries = ['Sprained wrist climbing tree', 'Skateboard scrape', 'Jammed pinky in gym class'];
                const injury = getRandom(injuries);
                player.status = { type: 'injured', description: injury, duration: 1, isNew: true };
                if (team.id === game.playerTeam?.id) {
                    addMessage('Minor Injury', `🩹 ${player.name} is resting: ${injury}.`);
                }
            }
        });
    });
}

export function processRelationshipEvents() {
    if (!game || !game.players || game.players.length < 2) return;
    const numEvents = getRandomInt(1, 3);
    const eventChanceImprove = 0.6;
    for (let i = 0; i < numEvents; i++) {
        let p1Index = getRandomInt(0, game.players.length - 1);
        let p2Index = getRandomInt(0, game.players.length - 1);
        let attempts = 0;
        while (p1Index === p2Index && attempts < 10) {
            p2Index = getRandomInt(0, game.players.length - 1); attempts++;
        }
        if (p1Index === p2Index) continue;
        const p1 = game.players[p1Index];
        const p2 = game.players[p2Index];
        if (!p1 || !p2) continue;
        if (Math.random() < eventChanceImprove) {
            improveRelationship(p1.id, p2.id);
        } else {
            decreaseRelationship(p1.id, p2.id);
        }
    }
}

export function processWeeklyPlayerGrowth() {
    if (!game || !game.teams) return;

    const offensivePositions = new Set([
        'QB', 'RB', 'WR', 'TE', 'OL'
    ]);

    const defensivePositions = new Set([
        'DL', 'LB', 'DB'
    ]);

    const automaticSkillsByPosition = {
        QB: [
            'throwingAccuracy', 'throwPower', 'decisionMaking',
            'playbookIQ', 'consistency', 'clutch'
        ],
        RB: [
            'speed', 'agility', 'explosiveness', 'carrying',
            'playbookIQ', 'catchingHands', 'stamina', 'toughness'
        ],
        WR: [
            'speed', 'agility', 'explosiveness', 'jumping',
            'catchingHands', 'playbookIQ', 'consistency', 'clutch'
        ],
        TE: [
            'strength', 'speed', 'agility', 'jumping',
            'catchingHands', 'blocking', 'playbookIQ', 'toughness'
        ],
        OL: [
            'strength', 'blocking', 'toughness',
            'stamina', 'playbookIQ', 'consistency'
        ],
        DL: [
            'strength', 'blockShedding', 'tackling',
            'toughness', 'stamina', 'playbookIQ'
        ],
        LB: [
            'tackling', 'speed', 'blockShedding',
            'coverage', 'playbookIQ', 'toughness', 'agility'
        ],
        DB: [
            'speed', 'agility', 'coverage', 'catchingHands',
            'playbookIQ', 'decisionMaking', 'clutch'
        ]
    };

    const getTrainingPosition = (player, team) =>
        getTrainingPlayerPosition(player, team);

    const getTrainingSkillValue = (player, skill, team) => {
        if (!player?.attributes || !skill) return null;

        return getTrainingAttributeScore(player, skill, team);
    };

    const increaseTrainingSkill = (player, skill) => {
        if (!player?.attributes || !skill) return false;

        for (const category of Object.values(player.attributes)) {
            const value = category?.[skill];

            if (
                typeof value === 'number' &&
                Number.isFinite(value) &&
                value < 95
            ) {
                category[skill] = value + 1;
                return true;
            }
        }

        return false;
    };

    const getAutomaticTrainingSkill = (player, team) => {
        const position = getTrainingPosition(player, team);

        const positionSkills =
            automaticSkillsByPosition[position] ||
            [
                'speed', 'agility', 'strength',
                'playbookIQ', 'consistency', 'toughness'
            ];

        // General football fundamentals remain useful across positions.
        const skillPool = [
            ...new Set([
                ...positionSkills,
                'playbookIQ',
                'consistency',
                'toughness'
            ])
        ];

        return skillPool
            .map(skill => ({
                skill,
                value: getTrainingSkillValue(player, skill, team)
            }))
            .filter(item =>
                item.value !== null &&
                item.value < 95
            )
            .sort((a, b) => a.value - b.value)[0]?.skill || null;
    };

    const matchesTrainingFocus = (player, focus, team) => {
        const position = getTrainingPosition(player, team);
        const normalizedFocus = String(focus || 'all').trim();

        if (normalizedFocus === 'all') return true;

        if (normalizedFocus === 'offense') {
            return offensivePositions.has(position);
        }

        if (normalizedFocus === 'defense') {
            return defensivePositions.has(position);
        }

        return position === normalizedFocus.toUpperCase();
    };

    const getCoachTrainingQuality = coach => {
        const ratings = coach?.ratings || {};

        const values = [
            ratings.teaching,
            ratings.practiceDiscipline,
            ratings.conditioning
        ].map(value => {
            const rating = Number(value);

            return Number.isFinite(rating)
                ? Math.max(0, Math.min(100, rating))
                : 50;
        });

        return values.reduce((sum, value) => sum + value, 0) /
            values.length;
    };

    game.teams.forEach(team => {
        const roster = getRosterObjects(team);

        // ---------------------------------------------------------------
        // 1. FOCUSED STAFF TRAINING
        // ---------------------------------------------------------------

        const coaches = Array.isArray(team.coaches)
            ? team.coaches.filter(coach => coach?.id != null)
            : [];

    const focusedTrainingPlayers = new Set();

    // Automated coaches must use their own scouting evidence rather than
    // accessing a player's hidden potential or personality ratings.
    const getReportedTrainingTraits = player => {
        const report = getTeamScoutingReport(team, player.id);

        const rawConfidence = Number(report?.confidence);

        const confidence = Number.isFinite(rawConfidence)
            ? Math.max(
                0,
                Math.min(
                    1,
                    rawConfidence > 1
                        ? rawConfidence / 100
                        : rawConfidence
                )
            )
            : 0;

        let workEthic = 50;

        const characterSummary = String(
            report?.evaluation?.characterSummary || ''
        ).toLowerCase();

        let reportedEffort = null;

        if (characterSummary.includes('strong effort/reliability signals')) {
            reportedEffort = 75;
        } else if (characterSummary.includes('generally steady effort')) {
            reportedEffort = 60;
        } else if (
            characterSummary.includes('effort/reliability need closer review')
        ) {
            reportedEffort = 35;
        }

        if (reportedEffort !== null && confidence >= 0.50) {
            workEthic =
                50 + ((reportedEffort - 50) * confidence);
        }

        const potentialPriorityValues = {
            A: 2.0,
            B: 1.5,
            C: 1.0,
            D: 0.5,
            F: 0
        };

        const potentialGrowthValues = {
            A: 1.12,
            B: 1.07,
            C: 1.0,
            D: 0.93,
            F: 0.86
        };

        let potentialPriority = 1.0;
        let potentialGrowthFactor = 1.0;

        const potentialRange = report?.potentialRange;

        if (potentialRange && confidence >= 0.50) {
            const bestGrade = String(
                potentialRange.bestPossible || ''
            ).toUpperCase();

            const worstGrade = String(
                potentialRange.worstPossible || ''
            ).toUpperCase();

            const bestPriority = potentialPriorityValues[bestGrade];
            const worstPriority = potentialPriorityValues[worstGrade];

            const bestGrowth = potentialGrowthValues[bestGrade];
            const worstGrowth = potentialGrowthValues[worstGrade];

            if (
                Number.isFinite(bestPriority) &&
                Number.isFinite(worstPriority) &&
                Number.isFinite(bestGrowth) &&
                Number.isFinite(worstGrowth)
            ) {
                const estimatedPriority =
                    (bestPriority + worstPriority) / 2;

                const estimatedGrowth =
                    (bestGrowth + worstGrowth) / 2;

                // Blend the report estimate toward neutral according
                // to its confidence. Wider uncertainty has less impact.
                potentialPriority =
                    1 + ((estimatedPriority - 1) * confidence);

                potentialGrowthFactor =
                    1 + ((estimatedGrowth - 1) * confidence);
            }
        }

        return {
            workEthic: Math.max(0, Math.min(100, workEthic)),
            potentialPriority,
            potentialGrowthFactor
        };
    };

    const trainingAssignments = (
            team.staffWorkPlan?.assignments || []
        ).map((assignment, index) => {
            if (
                assignment?.task !== 'training' ||
                assignment.coachId == null
            ) {
                return null;
            }

            const coach = coaches.find(
                candidate =>
                    String(candidate.id) === String(assignment.coachId)
            );

            if (!coach) return null;

            const hours = getEffectiveStaffWorkHours(
                team,
                assignment
            );

            if (!Number.isFinite(hours) || hours <= 0) {
                return null;
            }

            return {
                assignment,
                coach,
                hours,
                index
            };
        }).filter(Boolean);

        // Give assignments with more effective hours and stronger coaches
        // first opportunity to select targets. This also makes overlapping
        // assignments resolve consistently rather than stacking their odds.
        trainingAssignments.sort((a, b) => {
            const scoreA =
                a.hours * (0.5 + getCoachTrainingQuality(a.coach) / 100);

            const scoreB =
                b.hours * (0.5 + getCoachTrainingQuality(b.coach) / 100);

            return scoreB - scoreA || a.index - b.index;
        });

        trainingAssignments.forEach(item => {
            const { assignment, coach, hours, index } = item;

            const requestedTargets = Number(assignment.maxTargets);

            const maxTargets = Math.max(
                1,
                Math.min(
                    12,
                    Math.floor(
                        Number.isFinite(requestedTargets) &&
                        requestedTargets > 0
                            ? requestedTargets
                            : 4
                    )
                )
            );

            const requestedSkill = String(
                assignment.skill || ''
            ).trim();

            const candidates = roster
                .filter(player =>
                    player &&
                    player.attributes &&
                    !focusedTrainingPlayers.has(player) &&
                    matchesTrainingFocus(
                        player,
                        assignment.focus
                    )
                )
                .map(player => {
                    const instructionPriority =
                        getTeamDevelopmentPriority(team, player);

                    if (instructionPriority.ignored) {
                        return null;
                    }

                    const skill = requestedSkill ||
                        getAutomaticTrainingSkill(player);

                    const skillValue = skill
                        ? getTrainingSkillValue(player, skill)
                        : null;

                    // A chosen skill at its cap does not silently turn into
                    // another skill. The user chose what to train.
                    if (
                        !skill ||
                        skillValue === null ||
                        skillValue >= 95
                    ) {
                        return null;
                    }

                    const ageValue = Number(player.age);
                    const age = Number.isFinite(ageValue)
                        ? ageValue
                        : 14;

                    const ethicValue = Number(
                        player.personality?.workEthic
                    );

                    const workEthic = Number.isFinite(ethicValue)
                        ? Math.max(0, Math.min(100, ethicValue))
                        : 50;

                    const potentialFactor = {
                        A: 2.0,
                        B: 1.5,
                        C: 1.0,
                        D: 0.5,
                        F: 0
                    }[player.potential] ?? 1.0;

                    // Preserve the existing development assessment.
                    const priority =
                        (95 - skillValue) * 0.45 +
                        Math.max(0, 18 - age) * 1.1 +
                        (workEthic - 50) * 0.035 +
                        potentialFactor;

                    return {
                        player,
                        skill,
                        skillValue,
                        priority,
                        instructionPriority: instructionPriority.rank
                    };
                })
                .filter(Boolean)
                .sort((a, b) =>
                    b.instructionPriority - a.instructionPriority ||
                    b.priority - a.priority
                );

            if (candidates.length === 0) return;

            // Consider a pool twice the target count, then rotate within it.
            // This helps prevent the same few players from monopolizing
            // training every single week.
            const candidatePool = candidates.slice(
                0,
                Math.min(candidates.length, maxTargets * 2)
            );

            const rotationSeed = Math.abs(
                (Number(game.year) || 0) * 11 +
                (Number(game.currentWeek) || 0) * 5 +
                index * 3
            );

            // Rotate within each priority tier rather than allowing
            // lower-priority players to displace Must or High targets.
            const priorityTiers = [
                ...new Set(
                    candidatePool.map(candidate =>
                        candidate.instructionPriority
                    )
                )
            ].sort((a, b) => b - a);

            const targets = [];

            for (const tier of priorityTiers) {
                const tierCandidates = candidatePool.filter(
                    candidate =>
                        candidate.instructionPriority === tier
                );

                if (tierCandidates.length === 0) continue;

                const rotationOffset =
                    rotationSeed % tierCandidates.length;

                const rotatedTier = [
                    ...tierCandidates.slice(rotationOffset),
                    ...tierCandidates.slice(0, rotationOffset)
                ];

                const remainingTargets =
                    maxTargets - targets.length;

                targets.push(
                    ...rotatedTier.slice(0, remainingTargets)
                );

                if (targets.length >= maxTargets) break;
            }

            targets.forEach(({
                player,
                skill,
                workEthic,
                potentialGrowthFactor
            }) => {
                // A player only receives one focused-training attempt per
                // week, even if several assignments cover the same player.
                focusedTrainingPlayers.add(player);

                const hoursFactor = Math.min(1, hours / 8);
                const coachQuality = getCoachTrainingQuality(coach);

                const coachFactor = 0.75 + coachQuality / 200;

                const ethicFactor = 0.70 + workEthic / 200;

                const ageValue = Number(player.age);
                const age = Number.isFinite(ageValue)
                    ? ageValue
                    : 14;

                const ageFactor = age <= 15
                    ? 1.12
                    : age <= 16
                        ? 1.0
                        : age <= 17
                            ? 0.90
                            : 0.80;

                const potentialFactor = potentialGrowthFactor;

                // Focused training is a modest weekly advantage, not a
                // guaranteed point or a replacement for natural growth.
                // Group instruction reaches more players, but each player's
                // individual development chance decreases as the group grows.
                // Square-root dilution rewards group efficiency without
                // letting expected gains increase linearly with target count.
                const targetDistributionFactor =
                    1 / Math.sqrt(Math.max(1, targets.length));

                const growthChance = Math.min(
                    0.18,
                    (0.025 + 0.075 * hoursFactor) *
                        coachFactor *
                        ethicFactor *
                        ageFactor *
                        potentialFactor *
                        targetDistributionFactor
                );

                if (
                    Math.random() < growthChance &&
                    increaseTrainingSkill(player, skill)
                ) {
                    if (
                        team.id === game?.playerTeam?.id &&
                        Math.random() < 0.15
                    ) {
                        addMessage(
                            'Focused Staff Training',
                            `📈 <b>${player.name}</b> improved ${skill} through focused staff training this week!`
                        );
                    }
                }
            });
        });

        // ---------------------------------------------------------------
        // 2. EXISTING GAME-REP GROWTH
        // ---------------------------------------------------------------

        roster.forEach(player => {
            if (!player || !player.attributes) return;

            // Use participation snaps because finalizeGameResults clears gameStats.
            const snapsThisWeek = player.snapsThisWeek || 0;

            const isYoung = player.age <= 15;
            const growthChance = isYoung ? 0.12 : 0.05;

            if (snapsThisWeek > 0 && Math.random() < growthChance) {
                const ethic = player.personality?.workEthic || 50;
                const canLearn = Math.random() < (ethic / 100);

                if (canLearn) {
                    const learnable = [
                        'playbookIQ',
                        'consistency',
                        'catchingHands',
                        'tackling',
                        'throwingAccuracy'
                    ];

                    const chosen = getRandom(learnable);

                    for (const cat in player.attributes) {
                        if (
                            player.attributes[cat]?.[chosen] !== undefined &&
                            player.attributes[cat][chosen] < 95
                        ) {
                            player.attributes[cat][chosen] += 1;

                            if (
                                team.id === game?.playerTeam?.id &&
                                Math.random() < 0.25
                            ) {
                                addMessage(
                                    'Weekly Rep Growth',
                                    `💡 <b>${player.name}</b> showed great progress in practice and game reps this week (+1 ${chosen})!`
                                );
                            }

                            break;
                        }
                    }
                }
            }
        });
    });

    // Reset weekly participation only after every team's growth is processed.
    (game.players || []).forEach(player => {
        if (player) player.snapsThisWeek = 0;
    });
}


function recordFinanceLedgerEntry(
    team,
    gameState,
    category,
    label,
    amount
) {
    if (!team?.finances || !gameState) return;
    if (Number(gameState.year) < 5) return;

    const year = Number(gameState.year);
    const week = Number(gameState.currentWeek);
    const value = Number(amount);

    if (
        !Number.isInteger(year) ||
        !Number.isInteger(week) ||
        !Number.isFinite(value) ||
        Math.abs(value) < 0.005
    ) {
        return;
    }

    if (!Array.isArray(team.finances.ledger)) {
        team.finances.ledger = [];
    }

    const key = `${year}:${week}:${category}`;

    const entry = {
        key,
        year,
        week,
        category,
        label,
        amount: Math.round(value * 100) / 100,
        balanceAfter: Math.round(
            (Number(team.finances.balance) || 0) * 100
        ) / 100
    };

    const existingIndex = team.finances.ledger.findIndex(
        item => item?.key === key ||
            (
                Number(item?.year) === year &&
                Number(item?.week) === week &&
                item?.category === category
            )
    );

    if (existingIndex >= 0) {
        team.finances.ledger[existingIndex] = entry;
    } else {
        team.finances.ledger.push(entry);
    }

    team.finances.ledger.sort(
        (a, b) => a.year - b.year || a.week - b.week
    );

    if (team.finances.ledger.length > 80) {
        team.finances.ledger.splice(
            0,
            team.finances.ledger.length - 80
        );
    }
}

function recordFinanceWeeklySummary(
    team,
    gameState,
    openingBalance,
    closingBalance
) {
    if (!team?.finances || !gameState) return;
    if (Number(gameState.year) < 5) return;

    const year = Number(gameState.year);
    const week = Number(gameState.currentWeek);
    const opening = Number(openingBalance);
    const closing = Number(closingBalance);

    if (
        !Number.isInteger(year) ||
        !Number.isInteger(week) ||
        !Number.isFinite(opening) ||
        !Number.isFinite(closing)
    ) {
        return;
    }

    if (!Array.isArray(team.finances.weeklyHistory)) {
        team.finances.weeklyHistory = [];
    }

    const key = `${year}:${week}`;

    const snapshot = {
        key,
        year,
        week,
        openingBalance: Math.round(opening * 100) / 100,
        closingBalance: Math.round(closing * 100) / 100,
        netChange: Math.round((closing - opening) * 100) / 100
    };

    const existingIndex = team.finances.weeklyHistory.findIndex(
        item => item?.key === key
    );

    if (existingIndex >= 0) {
        team.finances.weeklyHistory[existingIndex] = snapshot;
    } else {
        team.finances.weeklyHistory.push(snapshot);
    }

    team.finances.weeklyHistory.sort(
        (a, b) => a.year - b.year || a.week - b.week
    );

    if (team.finances.weeklyHistory.length > 12) {
        team.finances.weeklyHistory.splice(
            0,
            team.finances.weeklyHistory.length - 12
        );
    }
}


export function processEndOfWeek({ financesOnly = false } = {}) {
    if (!game) return;

    const processingYear = Number(game.year);
    const processingWeek = Number(game.currentWeek);
    const processingWeekKey =
        Number.isInteger(processingYear) &&
        Number.isInteger(processingWeek)
            ? `${processingYear}:${processingWeek}`
            : null;

    if (
        processingWeekKey &&
        game.lastProcessedEndOfWeekKey === processingWeekKey
    ) {
        return false;
    }

    // === PROCESS FINANCES & SNACK FUND (UNIVERSAL AI & PLAYER) ===
    const mainTeams = game.teams.filter(t => t.leagueType === 'main');
    const financeOpeningBalances = new Map();

    mainTeams.forEach(team => {
        if (!team.finances) {
            team.finances = { balance: 10.00, waivedDues: [] };
        }

        if (!Array.isArray(team.finances.waivedDues)) {
            team.finances.waivedDues = [];
        }

        const openingBalance = Number(team.finances.balance);
        financeOpeningBalances.set(String(team.id), openingBalance);

        const coach = team.staff?.coach || team.coach;

        const relationshipOrientation = getStaffBehaviorTendency(
            coach,
            'relationshipOrientation'
        );

        const riskTolerance = getStaffBehaviorTendency(
            coach,
            'riskTolerance'
        );

        const rawDiscipline = Number(coach?.ratings?.practiceDiscipline);
        const discipline = Number.isFinite(rawDiscipline)
            ? rawDiscipline
            : 50;

        const gmDirective =
            team.gameplan?.gmDirective || 'COACH_AUTONOMY';
                const isUser = team.isPlayerControlled;
        const roster = getRosterObjects(team);

        // Coaches are volunteers; retaining staff creates no recurring expense.
        // One-time recruiting gifts will be charged when an offer is accepted.

        // Clear obsolete payroll markers from older saves.
        // These no longer participate in the finance system.
        delete team.finances.staffPayrollKey;
        delete team.finances.lastStaffPayroll;

        // Weekly community allowance.
        // Player dues are collected only by processSeasonStartDues(),
        // once per season. Do not collect them again here.
        const weeklyAllowance = 5.00;
        const currentBalance = Number(team.finances.balance);
        const balanceBeforeAllowance = Number.isFinite(currentBalance)
            ? currentBalance
            : 10.00;

        team.finances.balance = Math.round(
            (balanceBeforeAllowance + weeklyAllowance) * 100
        ) / 100;

        // Record the weekly allowance for the user's finance ledger.
        const transactionYear = Number(game.year);
        const transactionWeek = Number(game.currentWeek);

        if (
            team.id === game.playerTeam?.id &&
            transactionYear >= 5 &&
            Number.isInteger(transactionYear) &&
            Number.isInteger(transactionWeek)
        ) {
            if (!Array.isArray(team.finances.ledger)) {
                team.finances.ledger = [];
            }

            const category = 'allowance';
            const key = `${transactionYear}:${transactionWeek}:${category}`;

            const existingIndex = team.finances.ledger.findIndex(entry =>
                entry?.key === key ||
                (
                    Number(entry?.year) === transactionYear &&
                    Number(entry?.week) === transactionWeek &&
                    entry?.category === category
                )
            );

            const entry = {
                key,
                year: transactionYear,
                week: transactionWeek,
                category,
                label: 'Weekly Community Allowance',
                amount: weeklyAllowance,
                balanceAfter: team.finances.balance
            };

            if (existingIndex >= 0) {
                team.finances.ledger[existingIndex] = entry;
            } else {
                team.finances.ledger.push(entry);
            }

            if (team.finances.ledger.length > 80) {
                team.finances.ledger.splice(
                    0,
                    team.finances.ledger.length - 80
                );
            }
        }

        // The weekly allowance is recorded above.
        // Player dues are seasonal and recorded by processSeasonStartDues().

        if (isUser && game.gameLog) {
            game.gameLog.push(`💰 Weekly Community Allowance: +$${weeklyAllowance.toFixed(2)}.`);
            
            // --- USER AUTO-SNACK SUBSCRIPTION ---
            const autoSnack = team.finances.autoSnack || 'none';
            const snackCosts = { none: 0, orange: 2.00, caprisun: 6.00, pizza: 25.00 };
            const cost = snackCosts[autoSnack];

            if (autoSnack !== 'none') {
                if (team.finances.balance >= cost) {
                    team.finances.balance -= cost;

                    recordFinanceLedgerEntry(
                        team,
                        game,
                        'autoSnack',
                        `Auto-snack plan: ${autoSnack}`,
                        -cost
                    );
                    if (autoSnack === 'orange') {
                        roster.forEach(p => p.fatigue = Math.max(0, (p.fatigue || 0) - 10));
                        game.gameLog.push(`🍊 Weekly Snacks: Auto-purchased Orange Slices (-$2.00). Team recovered +10 Energy.`);
                    } else if (autoSnack === 'caprisun') {
                        roster.forEach(p => p.fatigue = Math.max(0, (p.fatigue || 0) - 30));
                        game.gameLog.push(`🧃 Weekly Snacks: Auto-purchased Capri Suns (-$6.00). Team recovered +30 Energy.`);
                    } else if (autoSnack === 'pizza') {
                        roster.forEach(p => {
                            if (p.expectations) p.expectations.happiness = 100;
                            if (p.social) p.social.rivalIds = []; // Squash the beefs!
                        });
                        game.gameLog.push(`🍕 Weekly Snacks: Auto-purchased Pizza Party (-$25.00). Morale maxed, locker room beefs squashed.`);
                    }
                } else {
                    game.gameLog.push(`❌ Snack Fund Alert: Insufficient funds for planned ${autoSnack.toUpperCase()} snacks (Needed $${cost.toFixed(2)}).`);
                }
            }
            
            // Re-log the final balance so user knows exactly what they have entering next week
            game.gameLog.push(`💵 Final Snack Fund Balance: $${team.finances.balance.toFixed(2)}`);
        }

        // --- 3. AI INTELLIGENT SPENDING PHASE ---
        if (!isUser) {
            const avgFatigue = roster.reduce((sum, p) => sum + (p.fatigue || 0), 0) / Math.max(1, roster.length);
            const avgHappiness = roster.reduce((sum, p) => sum + (p.expectations?.happiness || 100), 0) / Math.max(1, roster.length);
            const hasLockerRoomBeef = roster.some(p => p.social?.rivalIds?.some(rId => team.roster.includes(rId)));

            // A. PIZZA PARTY ($25) - Morale
            // Relationship-oriented coaches place more value on team morale.
            if (
                team.finances.balance >= 25.00 &&
                (avgHappiness < 65 || hasLockerRoomBeef) &&
                relationshipOrientation >= 60
            ) {
                team.finances.balance -= 25.00;

                recordFinanceLedgerEntry(
                    team,
                    game,
                    'aiMorale',
                    'AI pizza party',
                    -25.00
                );

                roster.forEach(p => {
                    if (p.expectations) p.expectations.happiness = 100;
                    if (p.social) p.social.rivalIds = []; // Pizza squashes all beefs
                });
            }
            // B. CAPRI SUNS ($6) & ORANGES ($2) - Energy
            // Disciplinarians buy these so they can run harder practices.
            else if (avgFatigue > 45 && team.finances.balance >= 6.00) {
                team.finances.balance = Math.round(
                    (team.finances.balance - 6.00) * 100
                ) / 100;

                recordFinanceLedgerEntry(
                    team,
                    game,
                    'aiCapriSun',
                    'AI recovery snacks: Capri Suns',
                    -6.00
                );

                roster.forEach(p => {
                    p.fatigue = Math.max(0, (p.fatigue || 0) - 30);
                });
            } else if (avgFatigue > 25 && team.finances.balance >= 2.00) {
                team.finances.balance = Math.round(
                    (team.finances.balance - 2.00) * 100
                ) / 100;

                recordFinanceLedgerEntry(
                    team,
                    game,
                    'aiOrangeSlices',
                    'AI recovery snacks: Orange Slices',
                    -2.00
                );

                roster.forEach(p => {
                    p.fatigue = Math.max(0, (p.fatigue || 0) - 10);
                });
            }

            // C. BUYING FAVOR TOKENS ($3) - Recruiting
            // Win-now directives or risk-tolerant coaches favor a larger
            // reserve for competitive recruiting opportunities.
            const isAggressiveFA =
                gmDirective === 'WIN_NOW' ||
                riskTolerance >= 65;

            const tokenHoardTarget = isAggressiveFA ? 4 : 2;

            // If team has leftover cash and needs tokens, buy them!
            if (team.finances.balance >= 3.00 && (team.socialProfile?.favorTokens || 0) < tokenHoardTarget) {
                team.finances.balance -= 3.00;

                recordFinanceLedgerEntry(
                    team,
                    game,
                    'aiToken',
                    'AI favor-token purchase',
                    -3.00
                );

                if (!team.socialProfile) team.socialProfile = { favorTokens: 0, streetCred: 50 };
                team.socialProfile.favorTokens += 1;
            }
        }

    });

    // Historical simulation can reuse the established finance rules without
    // running live-week bidding, events, practice, scouting, or other systems.
    if (financesOnly) {
        if (processingWeekKey) {
            game.lastProcessedEndOfWeekKey = processingWeekKey;
        }

        return true;
    }

    // AI teams consider requests published for the current week.
    // Requests were generated at the end of the previous week, giving
    // the player the same opportunity to accept them.
    const communityYear = Number(game.year);
    const communityWeek = Number(game.currentWeek);

    const hasValidCommunityWeek =
        Number.isInteger(communityYear) &&
        communityYear >= 5 &&
        Number.isInteger(communityWeek) &&
        communityWeek >= 0 &&
        communityWeek < COMMUNITY_WEEKS_PER_SEASON;

    const communityAbsoluteWeek = hasValidCommunityWeek
        ? (
            (communityYear - 1) * COMMUNITY_WEEKS_PER_SEASON +
            communityWeek
        )
        : null;

    if (hasValidCommunityWeek) {
        initializeCommunityContacts(game);

        const community = game.community;
        const communityWeekKey =
            `${communityYear}:${communityWeek}`;

        if (
            community &&
            community.lastProcessedWeekKey !== communityWeekKey
        ) {
            processAiCommunityFavorDecisions(
                game,
                communityAbsoluteWeek
            );

            community.lastProcessedWeekKey = communityWeekKey;
        }
    }

    // Retire legacy in-season bidding records.
    // Permanent player additions are handled during offseason recruiting.
    // Emergency in-season help is managed separately through temporary friends.
    if (Array.isArray(game.weeklyBids)) {
        game.weeklyBids = [];
    }

    updatePlayerStatuses();
    generateWeeklyEvents();
    processRelationshipEvents();

    // Update unemployed coaches' market demands as part of this week's
    // resolution, before the game advances to another week.
    processStaffMarketDecay(game);

    // Process Coach-Player Culture & Morale across all teams
    game.teams.forEach(t => {
        processLockerRoomCulture(t, game.gameLog);
    });

    // Process gameplans & practices before applying this week's practice.
    // These staff functions are statically imported, so their results are
    // available immediately rather than arriving after practice has run.
    game.teams.forEach(t => {
        // Youth teams do not use the main league's weekly gameplan system.
        if (!t || t.leagueType !== 'main') return;

        // Safeguard older saves or teams missing their gameplan.
        if (!t.gameplan) {
            t.gameplan = {
                weeklyPractice: 'chalk_talk',
                practiceSchedule: {
                    sessionsPerWeek: 2,
                    minutesPerSession: 90
                },
                practiceFieldAccess: 'community',
                delegatePractice: false,
                delegateGameplan: false,
                delegateDepthChart: false,
                gmDirective: 'COACH_AUTONOMY',
                installedOffense: [],
                installedDefense: [],
                mastery: {}
            };
        }

        // Establish each team's workload before the gameplan is rebuilt.
        if (t.id === game.playerTeam?.id) {
            ensureTeamStaffWorkPlan(
                t,
                game.year,
                game.currentWeek
            );
        } else {
            ensureAiStaffWorkPlan(
                t,
                game,
                game.year,
                game.currentWeek
            );
        }

        const practiceAutonomy = String(
            t.teamInstructions?.departments?.practice?.autonomy ??
            (t.gameplan.delegatePractice ? 'delegate' : 'guided')
        ).toLowerCase();

        const gameplanAutonomy = String(
            t.teamInstructions?.departments?.gameplan?.autonomy ??
            (t.gameplan.delegateGameplan ? 'delegate' : 'guided')
        ).toLowerCase();

        const shouldDelegatePractice =
            !t.isPlayerControlled ||
            practiceAutonomy !== 'direct';

        const shouldDelegateGameplan =
            !t.isPlayerControlled ||
            gameplanAutonomy !== 'direct';

        // Identify the upcoming opponent for every team, including
        // player-controlled teams managing their own preparation.
        const nextPracticeWeekIndex =
            Number(game.currentWeek) + 1;

        const gamesPerWeek = Math.max(
            1,
            Math.floor(game.teams.length / 2)
        );

        const hasNextPracticeWeek =
            Number.isInteger(nextPracticeWeekIndex) &&
            nextPracticeWeekIndex >= 0 &&
            nextPracticeWeekIndex < 9;

        const upcomingWeekGames =
            hasNextPracticeWeek &&
            Array.isArray(game.schedule)
                ? game.schedule.slice(
                    nextPracticeWeekIndex * gamesPerWeek,
                    (nextPracticeWeekIndex + 1) * gamesPerWeek
                )
                : [];

        const upcomingMatch = upcomingWeekGames.find(match =>
            match?.home?.id != null &&
            match?.away?.id != null &&
            (
                String(match.home.id) === String(t.id) ||
                String(match.away.id) === String(t.id)
            )
        );

        const upcomingOpponent = !upcomingMatch
            ? null
            : String(upcomingMatch.home.id) === String(t.id)
                ? upcomingMatch.away
                : upcomingMatch.home;

        // Resolve this week's staff work before the AI builds its next
        // gameplan, so its decisions can use the intelligence gathered.
        processWeeklyStaffPreparation(
            t,
            game.year,
            game.currentWeek,
            upcomingOpponent
        );

        if (shouldDelegatePractice || shouldDelegateGameplan) {
            const directive = t.gameplan?.gmDirective || 'COACH_AUTONOMY';

            if (shouldDelegateGameplan) {
                aiBuildGameplan(t, upcomingOpponent, directive);
            }

            if (shouldDelegatePractice) {
                t.gameplan.weeklyPractice = aiChooseWeeklyPractice(
                    t,
                    upcomingOpponent,
                    directive
                );
            }
        }

        processWeeklyPractice(t, game.gameLog);
        // Apply effective staff capacity to every executable work type
        // without permanently changing the requested assignments.
        const weeklyWorkAssignments = (
            t.staffWorkPlan?.assignments || []
        ).filter(assignment =>
            assignment &&
            [
                'scouting',
                'training',
                'offensePrep',
                'defensePrep'
            ].includes(assignment.task) &&
            assignment.coachId != null
        );

        // Calculate every assignment before modifying any requested hours.
        const effectiveWorkHours = weeklyWorkAssignments.map(assignment => ({
            assignment,
            hours: getEffectiveStaffWorkHours(t, assignment)
        }));

        const originalWorkHours = weeklyWorkAssignments.map(assignment => ({
            assignment,
            hadHours: Object.prototype.hasOwnProperty.call(
                assignment,
                'hours'
            ),
            hours: assignment.hours
        }));

        try {
            effectiveWorkHours.forEach(({ assignment, hours }) => {
                assignment.hours = hours;
            });

            processWeeklyScoutingAssignments(
                t,
                game,
                game.year,
                game.currentWeek
            );
        } finally {
            // Restore requested hours even if staff work processing fails.
            originalWorkHours.forEach(({
                assignment,
                hadHours,
                hours
            }) => {
                if (hadHours) {
                    assignment.hours = hours;
                } else {
                    delete assignment.hours;
                }
            });
        }

        // Develop coaching staffs and record gains for weekly reporting
        const coachGains = processWeeklyCoachDevelopment(
            t,
            game.year,
            game.currentWeek
        );
        t._lastCoachImprovements = coachGains || [];
    });

    // Resolve accepted community favors exactly once, after all weekly
    // staff work and coach development have been processed.
    if (hasValidCommunityWeek) {
        resolveCommunityFavorOutcomes(
            game,
            {
                year: communityYear,
                week: communityWeek,
                absoluteWeek: communityAbsoluteWeek
            }
        );
    }

    // Charge completed community-favor expenses before recording
    // each team's weekly closing balance.
    if (hasValidCommunityWeek) {
        for (const favor of game.community?.favors || []) {
            if (
                !favor ||
                favor.cashExpensePendingLedger !== true ||
                favor.cashExpenseLedgered === true ||
                Number(favor.cashExpenseYear) !== communityYear ||
                Number(favor.cashExpenseWeek) !== communityWeek
            ) {
                continue;
            }

            const team = mainTeams.find(candidate =>
                String(candidate.id) ===
                String(favor.acceptedByTeamId)
            );

            if (!team?.finances) continue;

            const expense = Math.round(
                Math.max(
                    0,
                    Number(favor.actualCashExpense) || 0
                ) * 100
            ) / 100;

            if (expense <= 0) {
                favor.cashExpensePaid = 0;
                favor.cashExpenseShortfall = 0;
                favor.cashExpensePendingLedger = false;
                favor.cashExpenseLedgered = true;
                continue;
            }

            const balanceValue = Number(team.finances.balance);
            const availableBalance = Number.isFinite(balanceValue)
                ? Math.max(0, balanceValue)
                : 0;

            const cashPaid = Math.min(
                availableBalance,
                expense
            );

            team.finances.balance = Math.round(
                (availableBalance - cashPaid) * 100
            ) / 100;

            if (cashPaid > 0) {
                recordFinanceLedgerEntry(
                    team,
                    game,
                    `community_favor_${favor.id}`,
                    `Community service: ${favor.title || 'Community favor'}`,
                    -cashPaid
                );
            }

            favor.cashExpensePaid = cashPaid;
            favor.cashExpenseShortfall = Math.round(
                (expense - cashPaid) * 100
            ) / 100;

            favor.cashExpensePendingLedger = false;
            favor.cashExpenseLedgered = true;
        }
    }

    // Publish requests for the upcoming week only after this week's
    // commitments have been resolved.
    const nextCommunityWeek = communityWeek + 1;

    if (
        hasValidCommunityWeek &&
        nextCommunityWeek < COMMUNITY_WEEKS_PER_SEASON
    ) {
        const nextAbsoluteWeek =
            communityAbsoluteWeek + 1;

        const community = game.community;

        // Prevent duplicate generation if weekly processing is repeated.
        if (
            community &&
            Number(community.lastGeneratedAbsoluteWeek) !==
                nextAbsoluteWeek
        ) {
            generateCommunityFavorRequests(
                game,
                {
                    absoluteWeek: nextAbsoluteWeek,
                    season: 'autumn',
                    maxRequests: 3
                }
            );
        }
    }

    // Record closing balances after weekly practice, scouting,
    // and community-favor expenses.
    // Neighborhood Hustle can earn money during practice.
    mainTeams.forEach(team => {
        const openingBalance = financeOpeningBalances.get(
            String(team.id)
        );

        recordFinanceWeeklySummary(
            team,
            game,
            openingBalance,
            team.finances?.balance
        );
    });

    processWeeklyPlayerGrowth();

    endOfWeekCleanup();

    if (processingWeekKey) {
        game.lastProcessedEndOfWeekKey = processingWeekKey;
    }

    return true;
}

export function processSeasonStartDues(gameState = game) {
    if (!gameState?.teams) {
        return {
            teamsCharged: 0,
            totalCollected: 0,
            playersCharged: 0,
            playersWaived: 0,
            playersMissed: 0
        };
    }

    const year = Number(gameState.year);

    if (!Number.isInteger(year)) {
        return {
            teamsCharged: 0,
            totalCollected: 0,
            playersCharged: 0,
            playersWaived: 0,
            playersMissed: 0
        };
    }

    const summary = {
        teamsCharged: 0,
        totalCollected: 0,
        playersCharged: 0,
        playersWaived: 0,
        playersMissed: 0
    };

    const mainTeams = gameState.teams.filter(
        team => team?.leagueType === 'main'
    );

    mainTeams.forEach(team => {
        if (!team.finances) {
            team.finances = {
                balance: 10.00,
                waivedDues: [],
                autoSnack: 'none'
            };
        }

        if (!Array.isArray(team.finances.waivedDues)) {
            team.finances.waivedDues = [];
        }

        // Prevent duplicate charges if the season-start flow runs twice.
        if (team.finances.seasonDuesYear === year) return;

        const roster = getRosterObjects(team).filter(player =>
            player &&
            !['temporary', 'retired', 'departed'].includes(
                player.status?.type
            )
        );

        const waivedIds = new Set(
            team.finances.waivedDues.map(String)
        );

        const coach = team.staff?.coach || team.coach;

        const relationshipOrientation = getStaffBehaviorTendency(
            coach,
            'relationshipOrientation'
        );

        const discipline = coach?.ratings?.practiceDiscipline ?? 50;

        const isUserTeam =
            team.isPlayerControlled ||
            team.id === gameState.playerTeam?.id;

        let collected = 0;
        let paidPlayers = 0;
        let waivedPlayers = 0;
        let missedPayments = 0;

        roster.forEach(player => {
            const isAiWaiver =
                !isUserTeam &&
                relationshipOrientation >= 75 &&
                (player.expectations?.happiness ?? 100) < 60;

            if (waivedIds.has(String(player.id)) || isAiWaiver) {
                if (player.expectations) {
                    player.expectations.happiness = Math.min(
                        100,
                        (player.expectations.happiness ?? 50) + 10
                    );
                }

                waivedPlayers++;
                return;
            }

            // Preserve the existing "forgot his wallet" behavior,
            // but resolve it once for the entire season's contribution.
            const ego = player.personality?.ego ?? 50;
            const forgetChance = ego > 75
                ? Math.max(0, 0.50 - (discipline / 150))
                : 0;

            if (Math.random() < forgetChance) {
                missedPayments++;
                return;
            }

            collected += SEASON_DUES_PER_PLAYER;
            paidPlayers++;
        });

        const currentBalance = Number(team.finances.balance);
        team.finances.balance = Math.round(
            (
                (Number.isFinite(currentBalance) ? currentBalance : 10.00) +
                collected
            ) * 100
        ) / 100;

        recordFinanceLedgerEntry(
            team,
            gameState,
            'seasonDues',
            'Season-start player dues',
            collected
        );

        // Record the year even if no one paid, so the team is not
        // charged repeatedly in the same season.
        team.finances.seasonDuesYear = year;

        // Waivers apply to this collection only.
        team.finances.waivedDues = [];

        summary.teamsCharged++;
        summary.totalCollected += collected;
        summary.playersCharged += paidPlayers;
        summary.playersWaived += waivedPlayers;
        summary.playersMissed += missedPayments;

        if (isUserTeam) {
            addMessage(
                'Season Dues Collected',
                `Season ${year} dues are settled. Your team collected $${collected.toFixed(2)} from ${paidPlayers} players at $${SEASON_DUES_PER_PLAYER.toFixed(2)} each. ${waivedPlayers} player(s) had dues waived, and ${missedPayments} player(s) missed payment.`,
                false,
                gameState
            );

            if (Array.isArray(gameState.gameLog)) {
                gameState.gameLog.push(
                    `💵 Season dues: +$${collected.toFixed(2)}. ` +
                    `${paidPlayers} paid, ${waivedPlayers} waived, ` +
                    `${missedPayments} missed.`
                );
            }
        }
    });

    return summary;
}

export function getTeamNetworkRecruits(team) {
    if (
        !team ||
        !Array.isArray(team.roster) ||
        !game ||
        !Array.isArray(game.players)
    ) {
        return [];
    }

    const rosterIds = new Set(
        team.roster
            .map(entry =>
                entry && typeof entry === 'object'
                    ? entry.id
                    : entry
            )
            .filter(id => id != null)
            .map(String)
    );

    // Exclude players already assigned to a permanent roster,
    // even if their player.teamId field is missing or stale.
    const permanentlyAssignedIds = new Set();

    // Temporary friends are unavailable to every other team.
    const temporarilyAssignedIds = new Set();

    for (const candidateTeam of game.teams || []) {
        if (!candidateTeam) continue;

        for (const entry of candidateTeam.roster || []) {
            const id =
                entry && typeof entry === 'object'
                    ? entry.id
                    : entry;

            if (id != null) {
                permanentlyAssignedIds.add(String(id));
            }
        }

        for (const id of candidateTeam.temporaryPlayers || []) {
            if (id != null) {
                temporarilyAssignedIds.add(String(id));
            }
        }
    }

    const unassignedPlayers = game.players.filter(player => {
        if (
            !player ||
            player.id == null ||
            player.teamId != null
        ) {
            return false;
        }

        const playerId = String(player.id);

        const statusType = String(
            player.status?.type || ''
        ).toLowerCase();

        const lifecycle = String(
            player.lifecycle || ''
        ).toLowerCase();

        const lifecycleStatus = String(
            player.lifecycleStatus ||
            player.lifecycle?.status ||
            ''
        ).toLowerCase();

        const refusedThisTeam =
            Array.isArray(player.refusedTeamIds) &&
            player.refusedTeamIds.some(
                refusedId =>
                    String(refusedId) === String(team.id)
            );

        const previousDecline =
            team.temporaryFriendDeclines?.[playerId];

        const declinedThisWeek =
            Number(previousDecline?.seasonYear) ===
                Number(game.year) &&
            Number(previousDecline?.week) ===
                Number(game.currentWeek);

        return (
            !declinedThisWeek &&
            !permanentlyAssignedIds.has(playerId) &&
            !temporarilyAssignedIds.has(playerId) &&
            !rosterIds.has(playerId) &&
            ![
                'retired',
                'departed',
                'temporary',
                'injured'
            ].includes(statusType) &&
            ![
                'retired',
                'departed',
                'temporary',
                'injured',
                'draft_eligible'
            ].includes(lifecycle) &&
            ![
                'retired',
                'departed',
                'temporary',
                'injured',
                'draft_eligible'
            ].includes(lifecycleStatus) &&
            !(Number(player.status?.duration) > 0) &&
            !(
                Number(
                    player.injury?.duration ||
                    player.injuryDuration ||
                    0
                ) > 0
            ) &&
            !refusedThisTeam
        );
    });

    const connectedRecruits = [];

    unassignedPlayers.forEach(freeAgent => {
        let highestRelationship = relationshipLevels.STRANGER.level;
        let connectedTeammate = null;

        for (const rosterPlayerId of rosterIds) {
            const rel = getRelationshipLevel(
                rosterPlayerId,
                freeAgent.id
            );

            if (rel > highestRelationship) {
                highestRelationship = rel;
                connectedTeammate = getPlayer(rosterPlayerId);
            }
        }

        if (
            highestRelationship >=
            relationshipLevels.ACQUAINTANCE.level
        ) {
            const scouted = getScoutedPlayerInfo(
                freeAgent,
                highestRelationship,
                team
            );

            if (!scouted) return;

            scouted.connectedBuddyName =
                connectedTeammate?.name || 'A teammate';

            scouted.networkStrength = highestRelationship;

            connectedRecruits.push(scouted);
        }
    });

    return connectedRecruits.sort(
        (a, b) => b.networkStrength - a.networkStrength
    );
}

export function generateWeeklyFreeAgents() {
    if (!game || !game.playerTeam) return;
    game.freeAgents = getTeamNetworkRecruits(game.playerTeam).slice(0, 6);
}

export function callFriend(playerId) {
    if (!game || !game.playerTeam || !game.playerTeam.roster || !game.freeAgents) {
        return { success: false, message: "Game state error prevented calling friend." };
    }
    const team = game.playerTeam;

    // Temporary friends are an in-season emergency option.
    // Week 0 is reserved for offseason roster management.
    const currentWeek = Number(game.currentWeek);

    if (
        !Number.isInteger(currentWeek) ||
        currentWeek <= 0
    ) {
        return {
            success: false,
            message: 'Temporary friends can only be called during the regular season.'
        };
    }
    if (!team.socialProfile) team.socialProfile = { favorTokens: 3, streetCred: 50 };
    if (team.socialProfile.favorTokens <= 0) {
        return { success: false, message: "You are out of Favor Tokens for this season! No one owes you a ride." };
    }

    const permanentRoster = getRosterObjects(team);

    const availablePermanentPlayers = permanentRoster.filter(p =>
        p &&
        !['departed', 'retired', 'temporary'].includes(p.status?.type) &&
        (!p.status || Number(p.status.duration || 0) <= 0)
    );

    const temporaryRoster = (team.temporaryPlayers || [])
        .map(id =>
            (game.players || []).find(
                p => p && String(p.id) === String(id)
            )
        )
        .filter(p =>
            p &&
            p.id != null &&
            p.teamId == null &&
            p.status?.type === 'temporary' &&
            !['departed', 'retired'].includes(p.status.type) &&
            !game.teams?.some(other =>
                other &&
                String(other.id) !== String(team.id) &&
                Array.isArray(other.temporaryPlayers) &&
                other.temporaryPlayers.some(
                    id => String(id) === String(p.id)
                )
            )
        );

    // Include existing temporary friends in social and positional
    // evaluations, but keep the permanent count separate.
    const roster = [...permanentRoster, ...temporaryRoster];

    const healthyCount = availablePermanentPlayers.length;
    const activeCount = healthyCount + temporaryRoster.length;

    if (activeCount >= 8) {
        return {
            success: false,
            message: `Your team already has ${activeCount} available players. Friends can only be called when fewer than 8 players are available.`
        };
    }
    // Confirm the player is still in the available network-recruit pool.
    // The pool entry is a scouting-safe display object, not the full player.
    const networkRecruit = game.freeAgents.find(
        p => p && String(p.id) === String(playerId)
    );

    if (!networkRecruit) {
        return {
            success: false,
            message: "That player is no longer hanging around the park this week."
        };
    }

    // Resolve the underlying player for internal relationship and
    // acceptance calculations. Do not expose this object through the
    // network-recruit display data.
    const player = getPlayer(playerId) ||
        (game.players || []).find(
            p => p && String(p.id) === String(playerId)
        );

    if (!player) {
        return {
            success: false,
            message: "That player could not be found."
        };
    }

    const alreadyHelpingAnotherTeam = (game.teams || []).some(other =>
        other &&
        Array.isArray(other.temporaryPlayers) &&
        other.temporaryPlayers.some(
            id => String(id) === String(player.id)
        )
    );

    if (
        player.teamId != null ||
        alreadyHelpingAnotherTeam ||
        ['departed', 'retired', 'temporary'].includes(player.status?.type) ||
        (player.status && Number(player.status.duration || 0) > 0)
    ) {
        return {
            success: false,
            message: `${player.name} is not currently available to help out.`
        };
    }

    // --- LOGIC-BASED ACCEPTANCE CALCULATION ---
    let interestScore = Math.round((team.socialProfile.streetCred || 50) * 0.3);
    if (team.tier === 1) interestScore += 8; // Prestige of playing under the lights

    let decisionReasons = [];

    // 1. Friend & Clique Anchors
    const hasBestFriend = player.social?.bestFriendId && roster.some(r => r.id === player.social.bestFriendId);
    if (hasBestFriend) {
        interestScore += 35;
        const bfName = roster.find(r => r.id === player.social.bestFriendId)?.name || 'his best friend';
        decisionReasons.push(`wanted to play with ${bfName}`);
    }

    const friendsOnTeam = roster.filter(r => player.social?.goodFriendIds?.includes(r.id)).length;
    if (friendsOnTeam > 0) {
        const boost = Math.min(24, friendsOnTeam * 12);
        interestScore += boost;
        decisionReasons.push(`has ${friendsOnTeam} friend(s) on the squad`);
    }

    const captain = roster.find(r => r.id === team.captainId);
    if (captain && captain.personality?.clique === player.personality?.clique) {
        interestScore += 10;
        decisionReasons.push(
            `shares a team-culture connection with captain ${captain.name.split(' ')[0]}`
        );
    }

    // 2. Sworn Rival Penalty
    const rivalOnTeam = roster.find(r => player.social?.rivalIds?.includes(r.id));
    if (rivalOnTeam) {
        interestScore -= 50;
        decisionReasons.push(`refuses to wear the same jersey as his rival ${rivalOnTeam.name}`);
    }

    // 3. Caliber, Ego & Positional Reality Check
    // External prospect ability must come from this team's scouting report,
    // never from the prospect's actual hidden attributes.
    const {
        report: prospectReport,
        confidence: prospectConfidence
    } = getTrainingReportConfidence(team, player);

    const listedPosition = normalizeTrainingPosition(
        player.pos ||
        player.position ||
        player.Pos
    );

    const reportedFits = [
        prospectReport?.evaluation?.offenseFit,
        prospectReport?.evaluation?.defenseFit
    ]
        .map(fit => {
            const position = normalizeTrainingPosition(fit?.position);
            const low = Number(fit?.low);
            const high = Number(fit?.high);

            if (
                !position ||
                fit?.low == null ||
                fit?.high == null ||
                !Number.isFinite(low) ||
                !Number.isFinite(high) ||
                high < low ||
                (
                    listedPosition &&
                    position !== listedPosition
                )
            ) {
                return null;
            }

            return {
                position,
                low,
                high,
                estimate: low +
                    ((high - low) / 2) * prospectConfidence
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.estimate - a.estimate);

    const bestReportedFit = prospectConfidence >= 0.50
        ? reportedFits[0] || null
        : null;

    const bestPos =
        listedPosition ||
        bestReportedFit?.position ||
        null;

    const hasAbilityEstimate =
        prospectReport != null &&
        prospectConfidence >= 0.50 &&
        bestReportedFit !== null;

    const myOvr = hasAbilityEstimate
        ? bestReportedFit.estimate
        : 50;

    const ego = player.personality?.ego || 50;

    // Compare against the actual ability of our own roster players.
    const posCompetitors = bestPos
        ? roster.filter(p =>
            isPlayerViableForPosition(p, bestPos)
        )
        : [];

    const topStarterOvr = bestPos
        ? posCompetitors
            .map(p => calculateOverall(p, bestPos))
            .sort((a, b) => b - a)[0] || 0
        : 0;

    if (
        hasAbilityEstimate &&
        bestPos &&
        topStarterOvr >= myOvr + 4 &&
        ego > 60
    ) {
        interestScore -= 24;
        decisionReasons.push(`won't ride the pine behind established starter at ${bestPos}`);
    } else if (
        (hasAbilityEstimate && myOvr >= 45) ||
        healthyCount < 9
    ) {
        interestScore += 14;
    } else if (hasAbilityEstimate && ego > 65) {
        interestScore -= 20;
        decisionReasons.push(`demands real playing time before lending a hand`);
    }

    // Pass catchers check the QB before burning their Saturday
    if (['WR', 'TE'].includes(bestPos)) {
        const qb1 = roster.find(p => isPlayerViableForPosition(p, 'QB'));
        if ((qb1?.attributes?.technical?.throwingAccuracy || 35) < 40) {
            interestScore -= 16;
            decisionReasons.push(`doesn't want to run wind sprints for an inaccurate QB`);
        }
    }

    // Dynamic threshold: Stars won't show up for a simple favor without massive friendship ties
    let callThreshold = 50;

    if (hasAbilityEstimate && myOvr >= 58) {
        callThreshold = 66;
    } else if (hasAbilityEstimate && myOvr >= 48) {
        callThreshold = 56;
    }

    if (interestScore >= callThreshold) {
        // Player accepts as a temporary friend, not a permanent roster member.
        if (!Array.isArray(team.temporaryPlayers)) {
            team.temporaryPlayers = [];
        }

        if (
            team.temporaryPlayers.some(
                id => String(id) === String(player.id)
            ) ||
            team.roster.some(
                id => String(id) === String(player.id)
            )
        ) {
            return {
                success: false,
                message: `${player.name} is already part of the team.`
            };
        }

        // Remove the prospect only after their acceptance is confirmed.
        game.freeAgents = game.freeAgents.filter(
            candidate =>
                candidate &&
                String(candidate.id) !== String(player.id)
        );

        player.status = {
            type: 'temporary',
            description: 'Helping Out',
            duration: 0
        };

        player.teamId = null;
        player.number = null;

        team.temporaryPlayers.push(player.id);
        team.socialProfile.favorTokens -= 1;

        roster.forEach(rosterPlayer => {
            if (rosterPlayer && rosterPlayer.id !== player.id) {
                improveRelationship(rosterPlayer.id, player.id);
            }
        });

        const reasonBlurb = decisionReasons.length > 0
            ? ` (${decisionReasons.join(', ')})`
            : '';

        const message = `🤝 ${player.name} agreed to help out!${reasonBlurb} [Favors Left: ${team.socialProfile.favorTokens}]`;

        addMessage("Roster Update: Friend Joined", message);
        return { success: true, message };
    } else {
        // Record the decline for this team and week.
        // The prospect can become available again next week.
        if (
            !team.temporaryFriendDeclines ||
            typeof team.temporaryFriendDeclines !== 'object' ||
            Array.isArray(team.temporaryFriendDeclines)
        ) {
            team.temporaryFriendDeclines = {};
        }

        team.temporaryFriendDeclines[String(player.id)] = {
            seasonYear: Number(game.year),
            week: Number(game.currentWeek)
        };

        // Remove this prospect from the current weekly display.
        game.freeAgents = game.freeAgents.filter(
            candidate =>
                candidate &&
                String(candidate.id) !== String(player.id)
        );

        const declineReason =
            decisionReasons.slice(-1)[0] ||
            'was not interested in joining right now';

        const message =
            `✋ ${player.name} declined the invite: ${declineReason}. ` +
            '(Favor Token preserved).';

        addMessage('Roster Update: Invite Declined', message);

        return { success: false, message };
    }
}

export function processLockerRoomCulture(team, gameLog = null) {
    if (!team || !team.roster) return;

    const coach = getTeamCoachingSpecialist(team, 'training');
    if (!coach) return;

    const discipline = getStaffBehaviorTendency(
        coach,
        'discipline'
    );

    const relationshipOrientation = getStaffBehaviorTendency(
        coach,
        'relationshipOrientation'
    );

    const developmentFocus = getStaffBehaviorTendency(
        coach,
        'developmentFocus'
    );

    const roster = getRosterObjects(team);

    roster.forEach(player => {
        if (!player?.personality) return;

        const ethicValue = Number(player.personality.workEthic);
        const ethic = Number.isFinite(ethicValue)
            ? ethicValue
            : 50;

        const egoValue = Number(player.personality.ego);
        const ego = Number.isFinite(egoValue)
            ? egoValue
            : 50;

        if (!player.expectations) {
            player.expectations = { happiness: 100 };
        }

        const currentHappiness = Number(
            player.expectations.happiness
        );

        const happiness = Number.isFinite(currentHappiness)
            ? Math.max(0, Math.min(100, currentHappiness))
            : 100;

        player.expectations.happiness = happiness;

        // Demanding coaches can clash with high-ego players, while
        // hardworking players may respond positively to firm standards.
        if (discipline >= 65) {
            if (ego > 75) {
                player.expectations.happiness = Math.max(
                    10,
                    player.expectations.happiness - 4
                );

                if (
                    team.id === game?.playerTeam?.id &&
                    Math.random() < 0.08
                ) {
                    gameLog?.push(
                        `⚡ Locker Room Drama: ${player.name} complained to his parents about Coach ${coach.name}'s strict drills.`
                    );
                }
            } else if (ethic > 70) {
                const currentLoyalty = Number(
                    player.personality.loyalty
                );

                const loyalty = Number.isFinite(currentLoyalty)
                    ? currentLoyalty
                    : 50;

                player.personality.loyalty = Math.min(
                    99,
                    loyalty + 1
                );
            }
        }

        // Relationship-oriented coaches provide additional morale support.
        // This is independent of discipline, so demanding coaches can
        // still build positive relationships with the rest of the roster.
        if (relationshipOrientation >= 65) {
            player.expectations.happiness = Math.min(
                100,
                player.expectations.happiness + 3
            );
        }

        // Development-focused coaches occasionally help players improve
        // mental toughness through their team's training culture.
        const toughnessValue = Number(
            player.attributes?.mental?.toughness
        );

        if (
            developmentFocus >= 70 &&
            Number.isFinite(toughnessValue) &&
            toughnessValue > 0 &&
            toughnessValue < 90 &&
            Math.random() < 0.10
        ) {
            player.attributes.mental.toughness = toughnessValue + 1;
        }
    });
}

export function processOffseasonFADay(
    gameState,
    userBids = [],
    { finalDay = 3 } = {}
) {
    if (!gameState || !gameState.players) return { daySignings: [], rejectedBids: [], userBidResults: [], activeNegotiations: [] };

    const activeTeams = gameState.teams.filter(t => t.leagueType === 'main');
    const daySignings = [];
    const rejectedBids = [];
    const userBidResults = [];
    const activeNegotiations = [];
    const playerBidsMap = new Map();

    const currentDay = gameState._faDay || 1;
    const finalRecruitingDay = Math.max(
        1,
        Math.floor(Number(finalDay) || 3)
    );

    gameState._activeFaMarket = gameState._activeFaMarket || new Map();

    // 1. REGISTER USER BIDS
    // Historical simulation runs without a user-controlled team.
    const seenUserPlayerIds = new Set();

    if (gameState.playerTeam && Array.isArray(userBids)) {
        userBids.forEach(ub => {
            if (seenUserPlayerIds.has(ub.playerId)) return;
            seenUserPlayerIds.add(ub.playerId);

            const pList = playerBidsMap.get(ub.playerId) || [];
            pList.push({
                team: gameState.playerTeam,
                teamId: gameState.playerTeam.id,
                offer: ub.offer
            });
            playerBidsMap.set(ub.playerId, pList);
        });
    }

    // 2. SMART AI BIDDING & COUNTER-BIDDING
    // AI coaches recruit up to the current phase's roster limit.
    const rosterLimit = getCurrentRosterLimit(gameState);
    const aiBidAudit = {
        currentWeek: gameState.currentWeek ?? null,
        rosterLimit,
        teamsEvaluated: 0,
        teamsAtRosterCap: 0,
        prospectsEvaluated: 0,
        candidatesPassingFilters: 0,
        teamsWithCandidates: 0,
        offersGenerated: 0,
        teamDetails: []
    };

    activeTeams.forEach(aiTeam => {
        if (aiTeam.isPlayerControlled) return;

        const rosterSize = aiTeam.roster?.length || 0;
        const rosterSpots = Math.max(0, rosterLimit - rosterSize);

        aiBidAudit.teamsEvaluated++;

        if (rosterSpots === 0) {
            aiBidAudit.teamsAtRosterCap++;
            aiBidAudit.teamDetails.push({
                team: aiTeam.name,
                rosterSize,
                rosterSpots,
                availableProspects: 0,
                candidatesPassingFilters: 0,
                offersGenerated: 0
            });
            return;
        }

        // Players on the incoming draft board must remain available
        // for the rookie draft, especially during the Year 5 takeover.
        const protectedDraftProspectIds = new Set(
            (Array.isArray(gameState.draftClass) ? gameState.draftClass : [])
                .map(prospect =>
                    prospect && typeof prospect === 'object'
                        ? prospect.id
                        : prospect
                )
                .filter(id => id != null)
                .map(id => String(id))
        );

        const availableProspects = gameState.players.filter(p =>
            p &&
            !p.teamId &&
            !protectedDraftProspectIds.has(String(p.id)) &&
            p.status?.type !== 'retired' &&
            p.status?.type !== 'departed' &&
            p.age >= 12 &&
            p.age <= 18
        );

        // Rank targets using roster need, market momentum, coach temperament,
        // and a controlled amount of uncertainty.
        const coach = aiTeam.staff?.coach || aiTeam.coach;

        // Resolve stable IDs first, retaining compatibility with old saves.
        const legacyPersonalityIds = {
            "Players' Coach": 'player_centered',
            'Old-School Disciplinarian': 'traditionalist',
            "Peaked in '94": 'hard_nosed_competitor',
            'Analytical Savant': 'analytical_planner'
        };

        const legacyTacticalIds = {
            'Smashmouth Zealot': 'power_run_specialist',
            'Air Raid Purist': 'spread_passing_specialist',
            'Blitz Addict': 'pressure_oriented_defender',
            'Conservative Turtler': 'conservative_game_manager',
            'Balanced Tactician': 'adaptive_strategist'
        };

        const personalityId =
            coach?.profileIds?.personality ||
            coach?.biases?.personality?.id ||
            legacyPersonalityIds[
                coach?.biases?.personality?.name
            ] ||
            'player_centered';

        const tacticalId =
            coach?.profileIds?.tactical ||
            coach?.biases?.tactical?.id ||
            legacyTacticalIds[
                coach?.biases?.tactical?.name
            ] ||
            'adaptive_strategist';

        const riskTolerance = getStaffBehaviorTendency(
            coach,
            'riskTolerance'
        );

        const gmDirective =
            aiTeam.gameplan?.gmDirective || 'COACH_AUTONOMY';

        const isAggressiveRecruiter =
            personalityId === 'hard_nosed_competitor' ||
            tacticalId === 'pressure_oriented_defender' ||
            riskTolerance >= 65 ||
            gmDirective === 'WIN_NOW';

        const isConservativeRecruiter =
            tacticalId === 'conservative_game_manager' ||
            personalityId === 'analytical_planner' ||
            riskTolerance <= 35;

        const coachInstinct = Number(
            coach?.ratings?.gameplanInstinct ?? 50
        );

        const evaluatedTargets = availableProspects
            .map(prospect => {
                const activeLead =
                    gameState._activeFaMarket.get(prospect.id);

                const currentTopScore =
                    activeLead?.topScore || 0;

                const evalResult = calculateAiTeamNeedAndDesire(
                    aiTeam,
                    prospect,
                    gameState,
                    currentTopScore,
                    rosterLimit
                );

                if (!evalResult.shouldBid) return null;

                // Respond to terms the player raised during an earlier day.
                // Different coaching temperaments require different levels
                // of recruitment interest before conceding on the offer.
                const counterRequest = activeLead?.counterRequest;

                const willingnessThreshold = isConservativeRecruiter
                    ? 70
                    : isAggressiveRecruiter
                        ? 54
                        : 62;

                if (
                    counterRequest &&
                    evalResult.offer &&
                    evalResult.desireScore >= willingnessThreshold
                ) {
                    const updatedOffer = { ...evalResult.offer };

                    if (
                        counterRequest.role === 'STARTER' &&
                        updatedOffer.role !== 'STARTER'
                    ) {
                        updatedOffer.role = 'STARTER';
                    }

                    const teamTokensAvailable = Math.max(
                        0,
                        Math.floor(
                            Number(aiTeam.socialProfile?.favorTokens) || 0
                        )
                    );

                    const currentOfferTokens = Math.max(
                        0,
                        Math.floor(Number(updatedOffer.tokensOffered) || 0)
                    );

                    const requestedTokens = Math.max(
                        0,
                        Math.min(
                            2,
                            Math.floor(
                                Number(counterRequest.minimumTokens) || 0
                            )
                        )
                    );

                    const affordableRequestedTokens = Math.min(
                        requestedTokens,
                        teamTokensAvailable
                    );

                    if (affordableRequestedTokens > currentOfferTokens) {
                        updatedOffer.tokensOffered = affordableRequestedTokens;
                    }

                    evalResult.offer = updatedOffer;
                }

                const alreadyLeading = String(
                    activeLead?.leaderTeamId ?? ''
                ) === String(aiTeam.id);

                // Reward continuing a meaningful pursuit instead of
                // abandoning yesterday's target just because of a small
                // change in the rankings.
                const marketMomentumBonus = !activeLead
                    ? 0
                    : alreadyLeading
                        ? 14
                        : 5;

                // Better decision-makers behave more consistently.
                // Aggressive coaches tolerate more risk; conservative
                // coaches stay closer to their preferred rankings.
                const noiseRange = isConservativeRecruiter
                    ? 3
                    : isAggressiveRecruiter
                        ? 12
                        : 8;

                const decisionNoise =
                    (Math.random() - 0.5) * noiseRange;

                const instinctAdjustment =
                    (coachInstinct - 50) * 0.08;

                const targetScore =
                    evalResult.desireScore +
                    marketMomentumBonus +
                    instinctAdjustment +
                    decisionNoise;

                return {
                    prospect,
                    ...evalResult,
                    targetScore
                };
            })
            .filter(Boolean)
            .sort((a, b) => b.targetScore - a.targetScore);

        // Teams with larger vacancies can pursue more prospects per day.
        // The number of targets never exceeds the number of open roster spots.
        const targetBudget = Math.min(
            rosterSpots,
            rosterSpots >= 6
                ? 4
                : rosterSpots >= 3
                    ? 3
                    : 2
        );

        // Conservative teams stick close to the top of their rankings.
        // Other teams can consider a broader shortlist, with aggressive
        // coaches showing more willingness to explore alternatives.
        const shortlistMultiplier = isConservativeRecruiter
            ? 1
            : isAggressiveRecruiter
                ? 3
                : 2;

        const shortlistSize = Math.min(
            evaluatedTargets.length,
            Math.max(
                targetBudget,
                targetBudget * shortlistMultiplier
            )
        );

        const shortlist = evaluatedTargets.slice(
            0,
            shortlistSize
        );

        const teamBids = [];

        while (
            teamBids.length < targetBudget &&
            shortlist.length > 0
        ) {
            const windowSize = isConservativeRecruiter
                ? 1
                : Math.min(
                    shortlist.length,
                    isAggressiveRecruiter ? 5 : 3
                );

            const candidateWindow = shortlist.slice(
                0,
                windowSize
            );

            let selectedIndex = 0;

            if (candidateWindow.length > 1) {
                const exponent = isAggressiveRecruiter
                    ? 1.3
                    : 2;

                const weights = candidateWindow.map(
                    (_, index) =>
                        Math.pow(
                            candidateWindow.length - index,
                            exponent
                        )
                );

                const totalWeight = weights.reduce(
                    (sum, weight) => sum + weight,
                    0
                );

                let draw = Math.random() * totalWeight;

                for (let i = 0; i < weights.length; i++) {
                    draw -= weights[i];

                    if (draw <= 0) {
                        selectedIndex = i;
                        break;
                    }
                }
            }

            const [selected] = shortlist.splice(
                selectedIndex,
                1
            );

            teamBids.push(selected);
        }

        aiBidAudit.prospectsEvaluated += availableProspects.length;
        aiBidAudit.candidatesPassingFilters += evaluatedTargets.length;

        if (evaluatedTargets.length > 0) {
            aiBidAudit.teamsWithCandidates++;
        }

        aiBidAudit.offersGenerated += teamBids.length;
        aiBidAudit.teamDetails.push({
            team: aiTeam.name,
            rosterSize,
            rosterSpots,
            availableProspects: availableProspects.length,
            candidatesPassingFilters: evaluatedTargets.length,
            offersGenerated: teamBids.length
        });

        teamBids.forEach(bidTarget => {
            const pList = playerBidsMap.get(bidTarget.prospect.id) || [];
            pList.push({ team: aiTeam, teamId: aiTeam.id, offer: bidTarget.offer });
            playerBidsMap.set(bidTarget.prospect.id, pList);
        });
    });

    // 3. MULTI-DAY BID RESOLUTION
    // Day 1 & Day 2: Contested high-OVR players remain in active negotiation allowing counter-offers.
    // Day 3 (Final Day): All remaining negotiations finalize.
    playerBidsMap.forEach((bids, playerId) => {
        const player = getPlayer(playerId);
        if (!player || player.teamId) return;

        const resolution = resolvePlayerBiddingWar(player, bids);
        const userTeamId = gameState.playerTeam?.id;
        const userBidOnThisPlayer = userTeamId == null
            ? null
            : bids.find(
                b => String(b.teamId) === String(userTeamId)
            );

        if (!resolution?.winner) {
            const reason = resolution?.rejectedReason || "Offers failed to satisfy player caliber.";
            rejectedBids.push({ player, reason });
            if (userBidOnThisPlayer) {
                userBidResults.push({ player, won: false, rejected: true, message: `✋ REJECTED: ${player.name} rejected your pitch: ${reason}` });
            }
            gameState._activeFaMarket.delete(playerId);
            return;
        }

        const win = resolution.winner;
        const leaderTeam = win.team;
        const leaderScore = win.score;
        const pos = player.pos || estimateBestPosition(player);
        const playerOvr = calculateOverall(player, pos);

        // Determine if player finalizes today or remains in negotiation for counter-offers
        const isBlowaway = win.offer.tokensOffered >= 2 && win.offer.role === 'STARTER' && win.evaluation.interestScore >= 82;
        const isLowTierUncontested = bids.length === 1 && playerOvr < 48;
        const shouldFinalizeNow =
            currentDay >= finalRecruitingDay ||
            isBlowaway ||
            isLowTierUncontested;

        if (shouldFinalizeNow) {
            // FINALIZE CONTRACT
            if (addPlayerToTeam(player, leaderTeam)) {
                if (win.offer.tokensOffered > 0 && leaderTeam.socialProfile) {
                    leaderTeam.socialProfile.favorTokens = Math.max(0, leaderTeam.socialProfile.favorTokens - win.offer.tokensOffered);
                }

                player.activePromise = createPlayerPromise(
                    player,
                    leaderTeam,
                    win.offer,
                    { promiseSeason: gameState.year, source: 'offseasonFA' }
                );

                player.status = { type: 'healthy', description: '', duration: 0 };
                aiSetDepthChart(leaderTeam);

                daySignings.push({
                    player,
                    team: leaderTeam,
                    runnerUp: resolution.competingBids[1]?.team || null,
                    tokens: win.offer.tokensOffered,
                    userWon: leaderTeam.id === gameState.playerTeam.id,
                    wasUserBid: !!userBidOnThisPlayer
                });

                if (userBidOnThisPlayer) {
                    if (leaderTeam.id === gameState.playerTeam.id) {
                        const runnerUpName = resolution.competingBids[1]?.team?.name;
                        userBidResults.push({
                            player, won: true, tokensSpent: win.offer.tokensOffered,
                            message: `🎉 SIGNED! ${player.name} accepted your offer!${runnerUpName ? ` (Beat out ${runnerUpName})` : ''}`
                        });
                    } else {
                        userBidResults.push({
                            player, won: false, winnerTeam: leaderTeam.name,
                            message: `❌ OUTBID! ${player.name} signed with ${leaderTeam.name} over your pitch.`
                        });
                    }
                }
            }
            gameState._activeFaMarket.delete(playerId);
        } else {
            // REMAINS IN ACTIVE NEGOTIATION FOR NEXT DAY'S COUNTER-BIDS
            const offeredTokens = Math.max(
                0,
                Math.floor(Number(win.offer.tokensOffered) || 0)
            );

            const playerEgo = Math.max(
                0,
                Math.min(
                    100,
                    Number(player.personality?.ego ?? 50)
                )
            );

            let counterRequest = null;

            // High-ego prospects who are good enough to contribute may
            // push back when offered a non-starter role.
            if (
                win.offer.role !== 'STARTER' &&
                playerOvr >= 48 &&
                playerEgo >= 65
            ) {
                counterRequest = {
                    role: 'STARTER',
                    label: 'a STARTER role'
                };
            } else {
                // Better prospects can ask for a stronger commitment.
                const requestedTokens =
                    playerOvr >= 60 && playerEgo >= 70
                        ? 2
                        : playerOvr >= 54
                            ? 1
                            : 0;

                if (requestedTokens > offeredTokens) {
                    counterRequest = {
                        minimumTokens: requestedTokens,
                        label: `at least ${requestedTokens} Favor Token${requestedTokens === 1 ? '' : 's'}`
                    };
                }
            }

            const interestScore = Number(
                win.evaluation?.interestScore ?? 0
            );

            const responseNote = counterRequest
                ? `Player counter-request: ${counterRequest.label}.`
                : interestScore >= 70
                    ? 'Player is interested but is still weighing competing offers.'
                    : 'Player remains uncertain about the fit and may need a stronger pitch.';

            gameState._activeFaMarket.set(playerId, {
                playerId,
                leaderTeamId: leaderTeam.id,
                leaderTeamName: leaderTeam.name,
                topScore: leaderScore,
                leaderOffer: win.offer,
                bidsCount: bids.length,
                counterRequest
            });

            activeNegotiations.push({
                player,
                leaderTeam,
                leaderOffer: win.offer,
                bidsCount: bids.length,
                isUserLeading: leaderTeam.id === gameState.playerTeam.id,
                counterRequest,
                responseNote
            });

            if (userBidOnThisPlayer) {
                if (leaderTeam.id === gameState.playerTeam.id) {
                    userBidResults.push({
                        player, won: false, inProgress: true,
                            message: `⏳ LEADING! You currently lead negotiations for ${player.name}. ${responseNote} Rival coaches may counter tomorrow!`
                    });
                } else {
                    userBidResults.push({
                        player, won: false, outbid: true,
                            message: `⚠️ OUTBID! ${leaderTeam.name} leads for ${player.name} (${win.offer.role}, ${win.offer.tokensOffered}🪙). ${responseNote} You can counter-bid tomorrow!`
                    });
                }
            }
        }
    });

    gameState._faDay = currentDay + 1;

    // Clear rumors cache so the next day generates fresh market chatter
    import('./negotiations.js').then(n => {
        if (n.clearPlayerMarketCache) n.clearPlayerMarketCache(gameState);
    }).catch(() => { });

    return {
        daySignings,
        rejectedBids,
        userBidResults,
        activeNegotiations,
        aiBidAudit
    };
}

/**
 * Extends or withdraws a formal invitation for a prospect to join a team.
 *
 * Active offers reserve roster places but do not increase player interest.
 * Both user-controlled and AI teams use the same validation.
 */
export function setRecruitingOffer(
    gameState,
    teamId,
    playerId,
    action = 'extend'
) {
    const state = gameState?.offseasonState;
    const progress = state?.recruitingProgress;

    const recruitingDay = Number(state?.recruitingDay);
    const recruitingDays = Number(state?.recruitingDays);

    if (
        !gameState?.teams ||
        !gameState?.players ||
        !progress ||
        progress.initialized !== true ||
        progress.completed === true ||
        Number(progress.seasonYear) !== Number(gameState.year) ||
        String(state?.phase || '').toLowerCase().replace(/[^a-z]/g, '') !== 'recruiting' ||
        !Number.isInteger(recruitingDay) ||
        !Number.isInteger(recruitingDays) ||
        recruitingDay < 1 ||
        recruitingDay > recruitingDays
    ) {
        return {
            success: false,
            message: 'The recruiting week is not active.'
        };
    }

    if (!['extend', 'withdraw'].includes(action)) {
        return {
            success: false,
            message: 'Invalid recruiting offer action.'
        };
    }

    const teamKey = String(teamId);
    const playerKey = String(playerId);

    const team = gameState.teams.find(
        candidate =>
            String(candidate?.id) === teamKey &&
            candidate.leagueType === 'main'
    );

    const player = gameState.players.find(
        candidate => String(candidate?.id) === playerKey
    );

    const record = progress.recruits?.[playerKey];

    if (
        !team ||
        !player ||
        player.teamId != null ||
        !record ||
        record.status !== 'available' ||
        record.committedTeamId != null
    ) {
        return {
            success: false,
            message: 'This prospect is no longer available.'
        };
    }

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

    const protectedDraftIds = new Set(
        (Array.isArray(gameState.draftClass) ? gameState.draftClass : [])
            .map(prospect =>
                prospect && typeof prospect === 'object'
                    ? prospect.id
                    : prospect
            )
            .filter(id => id != null)
            .map(id => String(id))
    );

    const hasRefusedTeam = (
        Array.isArray(player.refusedTeamIds) &&
        player.refusedTeamIds.some(
            refusedTeamId => String(refusedTeamId) === teamKey
        )
    );

    if (
        !Number.isFinite(age) ||
        age < 12 ||
        age > 18 ||
        hasRefusedTeam ||
        protectedDraftIds.has(playerKey) ||
        lifecycle === 'draft_eligible' ||
        lifecycleStatus === 'draft_eligible' ||
        ['retired', 'departed', 'temporary', 'injured'].includes(statusType) ||
        ['retired', 'departed', 'temporary', 'injured'].includes(lifecycleStatus) ||
        Number(player.status?.duration) > 0 ||
        Number(player.injury?.duration || player.injuryDuration || 0) > 0
    ) {
        return {
            success: false,
            message: 'This prospect is not eligible for an offer.'
        };
    }

    if (
        !record.offersByTeam ||
        typeof record.offersByTeam !== 'object' ||
        Array.isArray(record.offersByTeam)
    ) {
        record.offersByTeam = {};
    }

    const existingOffer = record.offersByTeam[teamKey];

    if (action === 'withdraw') {
        if (existingOffer?.status !== 'active') {
            return {
                success: false,
                message: 'Your team does not have an active offer for this prospect.'
            };
        }

        existingOffer.status = 'withdrawn';
        existingOffer.withdrawnDay = recruitingDay;

    } else {
        if (existingOffer?.status === 'active') {
            return {
                success: true,
                alreadyActive: true,
                message: `Your invitation to ${player.name} is already active.`
            };
        }

        if (existingOffer?.status === 'accepted') {
            return {
                success: false,
                message: 'This prospect has already accepted an offer.'
            };
        }

        // Count active invitations to other available prospects.
        // Each invitation reserves one place on the team's roster.
        const activeReservations = Object.entries(
            progress.recruits || {}
        ).reduce((total, [otherPlayerId, otherRecord]) => {
            if (
                String(otherPlayerId) === playerKey ||
                otherRecord?.status !== 'available' ||
                otherRecord?.committedTeamId != null
            ) {
                return total;
            }

            const otherOffer =
                otherRecord?.offersByTeam?.[teamKey];

            if (otherOffer?.status !== 'active') {
                return total;
            }

            const otherPlayer = gameState.players.find(
                candidate =>
                    String(candidate?.id) === String(otherPlayerId)
            );

            if (!otherPlayer || otherPlayer.teamId != null) {
                return total;
            }

            return total + 1;
        }, 0);

        const rosterSize = getRosterObjects(team).length;
        const rosterLimit = getCurrentRosterLimit(gameState);
        const availableSpots = Math.max(
            0,
            rosterLimit - rosterSize - activeReservations
        );

        if (availableSpots <= 0) {
            return {
                success: false,
                message:
                    `No roster spots are available for another invitation. ` +
                    `${activeReservations} spot(s) are already reserved by active offers.`
            };
        }

        record.offersByTeam[teamKey] = {
            status: 'active',
            offeredDay: recruitingDay,
            offeredYear: Number(gameState.year),
            withdrawnDay: null,
            respondedDay: null
        };
    }

    const offer = record.offersByTeam[teamKey];

    const activity = {
        type: 'recruiting_offer',
        year: Number(gameState.year),
        day: recruitingDay,
        teamId: team.id,
        teamName: team.name,
        playerId: player.id,
        playerName: player.name,
        action,
        status: offer.status,
        label: action === 'extend'
            ? 'Offered a roster spot'
            : 'Withdrew roster invitation'
    };

    record.history = Array.isArray(record.history)
        ? record.history
        : [];

    record.history.push(activity);

    progress.dailyActivity = Array.isArray(progress.dailyActivity)
        ? progress.dailyActivity
        : [];

    progress.dailyActivity.push(activity);

    return {
        success: true,
        action,
        offer,
        message: action === 'extend'
            ? `Your team has officially invited ${player.name} to join.`
            : `Your invitation to ${player.name} has been withdrawn.`
    };
}

/**
 * Resolves recruiting commitments for the current day.
 *
 * Days 2–6 can produce early commitments when a player has strong interest
 * in a leading team. Day 7 resolves all remaining players who have at least
 * one serious contender. Players without sufficient interest remain free
 * agents.
 */
export function resolveRecruitingDay(gameState = game) {
    const state = gameState?.offseasonState;
    const progress = state?.recruitingProgress;

    if (
        !gameState?.teams ||
        !gameState?.players ||
        String(state?.phase || '').toLowerCase().replace(/[^a-z]/g, '') !== 'recruiting' ||
        !progress ||
        progress.initialized !== true ||
        progress.completed === true ||
        Number(progress.seasonYear) !== Number(gameState.year)
    ) {
        return {
            success: false,
            message: 'The recruiting week is not active.',
            earlyCommitments: [],
            finalCommitments: []
        };
    }

    const day = Number(state.recruitingDay);
    const totalDays = Number(state.recruitingDays);

    if (
        !Number.isInteger(day) ||
        !Number.isInteger(totalDays) ||
        day < 1 ||
        day > totalDays
    ) {
        return {
            success: false,
            message: 'The current recruiting day is invalid.',
            earlyCommitments: [],
            finalCommitments: []
        };
    }

    if (!Array.isArray(progress.resolvedDays)) {
        progress.resolvedDays = [];
    }

    if (progress.resolvedDays.some(
        resolvedDay => Number(resolvedDay) === day
    )) {
        return {
            success: false,
            alreadyResolved: true,
            message: `Recruiting Day ${day} has already been resolved.`,
            earlyCommitments: [],
            finalCommitments: []
        };
    }

    const finalDay = day >= totalDays;
    const seriousInterestThreshold = 30;
    const earlyCommitments = [];
    const finalCommitments = [];

    const teamsById = new Map(
        gameState.teams
            .filter(team => team?.id != null)
            .map(team => [String(team.id), team])
    );

    const getEligibleTeam = (teamId, player = null) => {
        const team = teamsById.get(String(teamId));

        if (!team || team.leagueType !== 'main') return null;

        const hasBeenRefusedByPlayer =
            Array.isArray(player?.refusedTeamIds) &&
            player.refusedTeamIds.some(
                refusedTeamId =>
                    String(refusedTeamId) === String(team.id)
            );

        if (hasBeenRefusedByPlayer) return null;

        if (!Array.isArray(team.roster)) return null;

        const rosterPlayers = getRosterObjects(team);

        const alreadyOnRoster =
            player?.id != null &&
            rosterPlayers.some(
                rosterPlayer =>
                    String(rosterPlayer?.id) === String(player.id)
            );

        if (alreadyOnRoster) return null;

        const rosterSize = rosterPlayers.length;
        const rosterLimit = getCurrentRosterLimit(gameState);

        // Check actual roster capacity at commitment time.
        // Each successful commitment immediately adds the player to the
        // roster, so later prospects automatically see the updated size.
        // Active offers should not reserve spots here, since doing so can
        // prevent every prospect from claiming the same remaining spot.
        return rosterSize < rosterLimit
            ? team
            : null;
    };

    const protectedDraftIds = new Set(
        (Array.isArray(gameState.draftClass) ? gameState.draftClass : [])
            .map(prospect =>
                prospect && typeof prospect === 'object'
                    ? prospect.id
                    : prospect
            )
            .filter(id => id != null)
            .map(id => String(id))
    );

    const getAvailablePlayer = playerId => {
        const player = gameState.players.find(
            candidate => String(candidate?.id) === String(playerId)
        );

        if (!player || player.teamId != null) {
            return null;
        }

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

        if (
            !Number.isFinite(age) ||
            age < 12 ||
            age > 18 ||
            protectedDraftIds.has(String(player.id)) ||
            [
                'retired',
                'departed',
                'temporary',
                'injured',
                'draft_eligible'
            ].includes(lifecycle) ||
            [
                'retired',
                'departed',
                'temporary',
                'injured',
                'draft_eligible'
            ].includes(lifecycleStatus) ||
            ['retired', 'departed', 'temporary', 'injured'].includes(statusType) ||
            Number(player.status?.duration) > 0 ||
            Number(player.injury?.duration || player.injuryDuration || 0) > 0
        ) {
            return null;
        }

        return player;
    };

    const getInterest = (record, teamId) => {
        const value = Number(
            record?.interestByTeam?.[String(teamId)]
        );

        return Number.isFinite(value)
            ? Math.max(0, Math.min(100, value))
            : 0;
    };

        // Players differ in how eager they are to join a program.
    // Higher ego means greater selectivity and more willingness to wait.
    const getCommitmentProfile = player => {
        const rawEgo = Number(player?.personality?.ego);

        const ego = Number.isFinite(rawEgo)
            ? Math.max(0, Math.min(100, rawEgo))
            : 50;

        return {
            // Eager players can become viable contenders with less interest.
            // More selective players expect stronger recruiting attention.
            interestThreshold: Math.round(
                25 + ego * 0.15
            ),

            // Eager players can commit earlier in the week.
            earlyCommitInterest: Math.round(
                68 + ego * 0.14
            ),

            // Higher values make remaining unsigned more attractive.
            noCommitWeight: 3 + ego * 0.22
        };
    };

    const getPlayerRecruitingFit = (player, team) => {
        const preferences = player?.recruitingPreferences || {};
        const roster = getRosterObjects(team);

        const clamp = (value, min = 0, max = 100) =>
            Math.max(min, Math.min(max, value));

        const getPriority = key => {
            const value = Number(preferences[key]);

            return Number.isFinite(value)
                ? clamp(value, 5, 95)
                : 50;
        };

        // 1. Playing-time opportunity.
        // This uses positional competition, not hidden player ratings.
        const preferredPositions = [
            player?.pos,
            player?.favoriteOffensivePosition,
            player?.favoriteDefensivePosition
        ]
            .filter(Boolean)
            .map(position => String(position).toUpperCase());

        const positionalCompetitors = roster.filter(member => {
            const memberPositions = [
                member?.pos,
                member?.favoriteOffensivePosition,
                member?.favoriteDefensivePosition
            ]
                .filter(Boolean)
                .map(position => String(position).toUpperCase());

            return memberPositions.some(position =>
                preferredPositions.includes(position)
            );
        }).length;

        const roleFit = preferredPositions.length > 0
            ? clamp(90 - positionalCompetitors * 14, 15, 90)
            : 50;

        // 2. Relationships and chemistry.
        const bestFriendId = player?.social?.bestFriendId;

        const hasBestFriend = bestFriendId != null &&
            roster.some(member =>
                String(member?.id) === String(bestFriendId)
            );

        const goodFriendIds = Array.isArray(player?.social?.goodFriendIds)
            ? player.social.goodFriendIds.map(String)
            : [];

        const friendsOnTeam = roster.filter(member =>
            goodFriendIds.includes(String(member?.id))
        ).length;

        const rivalIds = Array.isArray(player?.social?.rivalIds)
            ? player.social.rivalIds.map(String)
            : [];

        const rivalsOnTeam = roster.filter(member =>
            rivalIds.includes(String(member?.id))
        ).length;

        const relationshipFit = clamp(
            50 +
                (hasBestFriend ? 30 : 0) +
                Math.min(20, friendsOnTeam * 10) -
                Math.min(45, rivalsOnTeam * 35)
        );

        // 3. Development environment.
        // The player can value the quality of the coaching staff.
        const trainingCoach = getTeamCoachingSpecialist(
            team,
            'training'
        );

        const teaching = Number(trainingCoach?.ratings?.teaching);
        const practiceDiscipline = Number(
            trainingCoach?.ratings?.practiceDiscipline
        );

        const developmentRatings = [
            teaching,
            practiceDiscipline
        ].filter(Number.isFinite);

        const developmentFit = developmentRatings.length > 0
            ? developmentRatings.reduce((sum, value) =>
                sum + clamp(value), 0
            ) / developmentRatings.length
            : 50;

        // 4. Winning environment.
        const wins = Math.max(0, Number(team.wins) || 0);
        const losses = Math.max(0, Number(team.losses) || 0);
        const ties = Math.max(0, Number(team.ties) || 0);
        const gamesPlayed = wins + losses + ties;

        const winningPercentage = gamesPlayed > 0
            ? (wins + ties * 0.5) / gamesPlayed
            : 0.5;

        const winningFit = 20 + winningPercentage * 60;

        // 5. Program reputation.
        const rawStreetCred = Number(team.socialProfile?.streetCred);

        const streetCred = Number.isFinite(rawStreetCred)
            ? clamp(rawStreetCred)
            : team.tier === 1 ? 60 : 35;

        const prestigeFit = streetCred;

        // 6. Scheme preference.
        // Formation names are only used when they provide a recognizable
        // style. Unknown formations receive a neutral score.
        const offenseName = [
            team.formations?.offense,
            team.coach?.preferredOffense
        ].filter(Boolean).join(' ').toLowerCase();

        const defenseName = [
            team.formations?.defense,
            team.coach?.preferredDefense
        ].filter(Boolean).join(' ').toLowerCase();

        const getOffenseStyle = name => {
            if (/(spread|shotgun|air|vertical|passing)/.test(name)) {
                return 'spread_passing';
            }

            if (/(power|run|heavy|jumbo|wing)/.test(name)) {
                return 'power_run';
            }

            if (/balanced/.test(name)) {
                return 'balanced';
            }

            return null;
        };

        const getDefenseStyle = name => {
            if (/(pressure|blitz|attack)/.test(name)) {
                return 'pressure';
            }

            if (/(coverage|cover|zone|quarters|nickel|dime)/.test(name)) {
                return 'coverage';
            }

            if (/(balanced|3-2-3|3-1-3|base)/.test(name)) {
                return 'balanced';
            }

            return null;
        };

        const preferredStyle = preferences.schemeStyle || {};

        const teamOffenseStyle = getOffenseStyle(offenseName);
        const teamDefenseStyle = getDefenseStyle(defenseName);

        const offenseSchemeFit =
            teamOffenseStyle && preferredStyle.offense
                ? (teamOffenseStyle === preferredStyle.offense ? 90 : 30)
                : 50;

        const defenseSchemeFit =
            teamDefenseStyle && preferredStyle.defense
                ? (teamDefenseStyle === preferredStyle.defense ? 90 : 30)
                : 50;

        const primarySide = String(
            player?.primarySide || ''
        ).toLowerCase();

        const schemeFit = primarySide.includes('off')
            ? offenseSchemeFit
            : primarySide.includes('def')
                ? defenseSchemeFit
                : (offenseSchemeFit + defenseSchemeFit) / 2;

        // Give greater influence to the things this individual player
        // actually values. Missing preferences receive neutral weight.
        const weightedFactors = [
            [getPriority('roleOpportunity'), roleFit],
            [getPriority('relationships'), relationshipFit],
            [getPriority('development'), developmentFit],
            [getPriority('winning'), winningFit],
            [getPriority('programPrestige'), prestigeFit],
            [getPriority('schemeFit'), schemeFit]
        ];

        const totalPriority = weightedFactors.reduce(
            (sum, [priority]) => sum + priority,
            0
        );

        if (totalPriority <= 0) return 50;

        return weightedFactors.reduce(
            (sum, [priority, fit]) => sum + priority * fit,
            0
        ) / totalPriority;
    };

        /**
     * Measures how well a team's actual installed and foundational
     * playbook concepts match a player's football preferences.
     *
     * Formation choices are intentionally ignored. The team can
     * choose formations situationally while keeping its playbook.
     *
     * Mastery influences appeal because having a concept installed
     * is not the same as being good at executing it.
     */
    const getTeamFootballConceptFit = (
        team,
        side,
        preferredConcepts
    ) => {
        if (
            !Array.isArray(preferredConcepts) ||
            preferredConcepts.length === 0
        ) {
            return 50;
        }

        const isOffense = side === 'offense';

        const playbook = isOffense
            ? offensivePlaybook
            : defensivePlaybook;

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
            ? team.gameplan?.installedOffense
            : team.gameplan?.installedDefense;

        const activeKeys = [
            ...new Set([
                ...foundationKeys,
                ...(Array.isArray(installedKeys)
                    ? installedKeys.slice(0, 8)
                    : [])
            ])
        ].filter(key => Boolean(playbook[key]));

        if (activeKeys.length === 0) return 50;

        const knowledgeFunction = isOffense
            ? getOffensivePlayKnowledge
            : getDefensivePlayKnowledge;

        const mastery = team.gameplan?.mastery || {};

        const conceptScores = preferredConcepts
            .filter(concept => typeof concept === 'string')
            .slice(0, 3)
            .map(preferredConcept => {
                const matchingPlays = activeKeys.filter(key => {
                    const knowledge = knowledgeFunction(
                        key,
                        playbook[key]
                    );

                    return knowledge.archetype === preferredConcept;
                });

                if (matchingPlays.length === 0) return 0;

                const masteryScores = matchingPlays.map(key => {
                    const rawMastery = Number(mastery[key]);

                    const playMastery = Number.isFinite(rawMastery)
                        ? Math.max(0, Math.min(100, rawMastery))
                        : 40;

                    return playMastery;
                });

                const bestMastery = Math.max(...masteryScores);

                // Availability matters most. Familiarity and additional
                // options provide smaller bonuses.
                const availabilityScore =
                    35 +
                    bestMastery * 0.55 +
                    Math.min(10, (matchingPlays.length - 1) * 3);

                return Math.max(
                    0,
                    Math.min(100, availabilityScore)
                );
            });

        if (conceptScores.length === 0) return 50;

        return Math.round(
            conceptScores.reduce((sum, score) => sum + score, 0) /
            conceptScores.length
        );
    };

    /**
     * Calculates how appealing a program is from the player's
     * perspective. Private preferences are read only here, during
     * the player's decision—not during AI recruiting evaluations.
     */
    const calculatePlayerRecruitingFit = (player, record, team) => {
        const clamp = value =>
            Math.max(0, Math.min(100, Math.round(value)));

        const getScore = (value, fallback = 50) => {
            const number = Number(value);

            return Number.isFinite(number)
                ? clamp(number)
                : fallback;
        };

        const preferences = player?.recruitingPreferences || {};

        const getPriority = key =>
            getScore(preferences[key], 50);

        const appeal = record?.teamAppealByTeam?.[String(team.id)] || {};

        const roleOpportunity = getScore(
            appeal.roster?.roleOpportunity
        );

        const coachingQuality = getScore(
            appeal.coaching?.coachingQuality
        );

        const recentSuccess = getScore(
            appeal.program?.recentSuccess
        );

        const programReputation = getScore(
            appeal.program?.reputation
        );

        // The player knows their own friendships and rivalries.
        // Use that personal perspective for relationships rather
        // than relying on what the recruiting staff has discovered.
        const rosterIds = new Set(
            getRosterObjects(team)
                .filter(member => member?.id != null)
                .map(member => String(member.id))
        );

        const social = player?.social || {};

        const friendIds = new Set([
            social.bestFriendId,
            ...(Array.isArray(social.goodFriendIds)
                ? social.goodFriendIds
                : [])
        ]
            .filter(id => id != null)
            .map(String));

        const rivalIds = new Set(
            (Array.isArray(social.rivalIds) ? social.rivalIds : [])
                .filter(id => id != null)
                .map(String)
        );

        const friendCount = [...friendIds].filter(
            id => rosterIds.has(id)
        ).length;

        const rivalCount = [...rivalIds].filter(
            id => rosterIds.has(id)
        ).length;

        const relationshipAppeal = clamp(
            50 + friendCount * 18 - rivalCount * 18
        );

        // Evaluate the actual football concepts available to this team.
        // The player's primary side receives greater weight, but
        // two-way opportunities still contribute to overall fit.
        const footballPreferences =
            player?.footballPreferences || {};

        const offenseConceptFit = getTeamFootballConceptFit(
            team,
            'offense',
            footballPreferences.preferredOffenseConcepts
        );

        const defenseConceptFit = getTeamFootballConceptFit(
            team,
            'defense',
            footballPreferences.preferredDefenseConcepts
        );

        const primarySide = String(
            player?.primarySide || ''
        ).toLowerCase();

        const offenseWeight = primarySide === 'defense'
            ? 0.35
            : 0.65;

        const footballFit = clamp(
            offenseConceptFit * offenseWeight +
            defenseConceptFit * (1 - offenseWeight)
        );

        // Higher priority means the player cares more about that factor.
        // Scheme preference is reserved for a later pass, when we have
        // a reliable player-side scheme/style profile to compare.
        const factors = [
            {
                priority: getPriority('roleOpportunity'),
                appeal: roleOpportunity
            },
            {
                priority: getPriority('relationships'),
                appeal: relationshipAppeal
            },
            {
                priority: getPriority('development'),
                appeal: coachingQuality
            },
            {
                priority: getPriority('winning'),
                appeal: recentSuccess
            },
            {
                priority: getPriority('programPrestige'),
                appeal: programReputation
            },
            {
                priority: getPriority('schemeFit'),
                appeal: footballFit
            }
        ];

        const totalPriority = factors.reduce(
            (sum, factor) => sum + factor.priority,
            0
        );

        const fitScore = totalPriority > 0
            ? clamp(
                factors.reduce(
                    (sum, factor) =>
                        sum + factor.priority * factor.appeal,
                    0
                ) / totalPriority
            )
            : 50;

        // Neutral fit = 1.00. Strong fit can improve a team's odds
        // by up to 20%; poor fit can reduce them by up to 20%.
        const fitMultiplier = 0.80 + fitScore / 250;

        return {
            fitScore,
            fitMultiplier,
            footballFit,
            offenseConceptFit,
            defenseConceptFit
        };
    };

        /**
     * Measures how much actual recruiting work a team invested
     * in a player, independently of accumulated interest.
     *
     * The player's private priorities influence which approaches
     * are most relevant, but are only read during the decision.
     */
    const calculateRecruitingPushMultiplier = (
        player,
        record,
        team
    ) => {
        const push = record?.recruitingPushByTeam?.[
            String(team.id)
        ];

        // Older recruiting records may not contain investment data.
        if (!push || typeof push !== 'object') {
            return 1;
        }

        const preferences = player?.recruitingPreferences || {};

        const getPriority = key => {
            const value = Number(preferences[key]);

            return Number.isFinite(value)
                ? Math.max(5, Math.min(95, value))
                : 50;
        };

        const actionPriority = {
            outreach: 'relationships',
            teammateConnection: 'relationships',
            roleDiscussion: 'roleOpportunity',
            practiceInvitation: 'development'
        };

        const effortByType =
            push.effectiveEffortByType &&
            typeof push.effectiveEffortByType === 'object'
                ? push.effectiveEffortByType
                : {};

        let relevantEffort = 0;
        let hasTypedEffort = false;

        for (const [actionType, rawEffort] of Object.entries(
            effortByType
        )) {
            const effort = Number(rawEffort);

            if (!Number.isFinite(effort) || effort <= 0) {
                continue;
            }

            hasTypedEffort = true;

            const preferenceKey = actionPriority[actionType];

            const relevance = preferenceKey
                ? 0.75 + getPriority(preferenceKey) / 200
                : 1;

            relevantEffort += effort * relevance;
        }

        // Fall back to aggregate effort for older records or records
        // without action-specific effort breakdowns.
        if (!hasTypedEffort) {
            const aggregateEffort = Number(push.effectiveEffort);

            relevantEffort = Number.isFinite(aggregateEffort)
                ? Math.max(0, aggregateEffort)
                : 0;
        }

        // Diminishing returns prevent extreme investment from
        // overwhelming the player's own preferences.
        const effortScore = 1 - Math.exp(
            -Math.max(0, relevantEffort) / 32
        );

        const effortBonus = effortScore * 0.12;

        const cashSpent = Math.max(
            0,
            Number(push.cashSpent) || 0
        );

        const favorTokensSpent = Math.max(
            0,
            Number(push.favorTokensSpent) || 0
        );

        // Gifts and favors provide a smaller, separate advantage.
        // The spending cap prevents unlimited financial influence.
        const sweetenerScore = Math.min(
            1,
            cashSpent / 35 +
            favorTokensSpent * 0.25
        );

        const sweetenerBonus = sweetenerScore * 0.05;

        return Math.max(
            1,
            Math.min(
                1.17,
                1 + effortBonus + sweetenerBonus
            )
        );
    };

    const commitPlayer = (
        player,
        record,
        team,
        interest,
        fitScore = 50,
        fitMultiplier = 1,
        pushMultiplier = 1,
        preferenceFit = 50,
        decisionScore = interest
    ) => {
        if (
            !player ||
            !record ||
            !team ||
            player.teamId != null ||
            record.status !== 'available' ||
            record.committedTeamId != null
        ) {
            return null;
        }

        // Use the established roster-assignment pipeline so roster IDs,
        // player.teamId, and related team state remain consistent.
        if (!addPlayerToTeam(player, team, gameState)) {
            return null;
        }

        player.lifecycle = 'active';

        player.status = {
            type: 'healthy',
            description: '',
            duration: 0
        };

        record.status = 'committed';
        record.committedTeamId = team.id;
        record.committedDay = day;

        // The player accepts the winning team's offer and declines
        // every other active invitation.
        record.offersByTeam =
            record.offersByTeam &&
            typeof record.offersByTeam === 'object' &&
            !Array.isArray(record.offersByTeam)
                ? record.offersByTeam
                : {};

        record.history = Array.isArray(record.history)
            ? record.history
            : [];

        progress.dailyActivity = Array.isArray(progress.dailyActivity)
            ? progress.dailyActivity
            : [];

        Object.entries(record.offersByTeam).forEach(
            ([offerTeamId, offer]) => {
                if (offer?.status !== 'active') return;

                const accepted =
                    String(offerTeamId) === String(team.id);

                offer.status = accepted ? 'accepted' : 'declined';
                offer.respondedDay = day;

                const offerTeam = teamsById.get(String(offerTeamId));

                const offerEvent = {
                    type: 'recruiting_offer_response',
                    year: Number(gameState.year),
                    day,
                    playerId: player.id,
                    playerName: player.name,
                    teamId: offerTeam?.id ?? offerTeamId,
                    teamName: offerTeam?.name || 'Unknown Team',
                    status: offer.status,
                    label: accepted
                        ? 'Accepted roster invitation'
                        : 'Declined roster invitation'
                };

                record.history.push(offerEvent);
                progress.dailyActivity.push(offerEvent);
            }
        );

        const normalizedPreferenceFit =
            preferenceFit != null &&
            String(preferenceFit).trim() !== '' &&
            Number.isFinite(Number(preferenceFit))
                ? Math.max(
                    0,
                    Math.min(100, Math.round(Number(preferenceFit)))
                )
                : 50;

        const normalizedDecisionScore =
            decisionScore != null &&
            String(decisionScore).trim() !== '' &&
            Number.isFinite(Number(decisionScore))
                ? Math.max(
                    0,
                    Math.min(120, Math.round(Number(decisionScore) * 10) / 10)
                )
                : Number.isFinite(Number(interest))
                    ? Math.max(0, Math.min(100, Number(interest)))
                    : 0;

        const decisionSummary = normalizedPreferenceFit >= 65
            ? 'Strong personal program fit influenced the choice.'
            : normalizedPreferenceFit <= 35
                ? 'Recruiting interest outweighed a weaker personal fit.'
                : 'Recruiting interest and personal program fit both contributed.';

        const commitment = {
            playerId: player.id,
            playerName: player.name,
            teamId: team.id,
            teamName: team.name || 'Unknown program',
            day,
            decisionDay: day,
            interestAtCommit: Number.isFinite(Number(interest))
                ? Math.max(
                    0,
                    Math.min(100, Number(interest))
                )
                : 0,
            teamFitAtCommit:
                fitScore != null &&
                String(fitScore).trim() !== '' &&
                Number.isFinite(Number(fitScore))
                    ? Math.max(
                        0,
                        Math.min(100, Math.round(Number(fitScore)))
                    )
                    : 50,

            teamFitMultiplierAtCommit:
                fitMultiplier != null &&
                String(fitMultiplier).trim() !== '' &&
                Number.isFinite(Number(fitMultiplier))
                    ? Math.max(
                        0.8,
                        Math.min(1.2, Number(fitMultiplier))
                    )
                    : 1,
            decisionType: finalDay
                ? 'end_of_week'
                : 'early_commitment',

            recruitingPushMultiplierAtCommit:
                Number.isFinite(Number(pushMultiplier))
                    ? Math.max(
                        1,
                        Math.min(1.17, Number(pushMultiplier))
                    )
                    : 1,
            preferenceFitAtCommit: normalizedPreferenceFit,
            decisionScoreAtCommit: normalizedDecisionScore,
            decisionSummary,
        };

        // Preserve successful recruiting campaigns on the player
        // so the history survives the end of the recruiting week.
        player.recruitingCampaignHistory =
            Array.isArray(player.recruitingCampaignHistory)
                ? player.recruitingCampaignHistory
                : [];

        const alreadyRecordedCommitment =
            player.recruitingCampaignHistory.some(entry =>
                entry?.type === 'commitment' &&
                Number(entry.seasonYear) === Number(gameState.year)
            );

        if (!alreadyRecordedCommitment) {
            player.recruitingCampaignHistory.push({
                type: 'commitment',
                seasonYear: Number(gameState.year),
                decisionDay: day,
                outcome: 'committed',
                teamId: team.id,
                teamName: team.name || 'Unknown program',
                interestAtCommit: commitment.interestAtCommit,
                teamFitAtCommit: commitment.teamFitAtCommit,
                teamFitMultiplierAtCommit:
                    commitment.teamFitMultiplierAtCommit,
                recruitingPushMultiplierAtCommit:
                    commitment.recruitingPushMultiplierAtCommit,
                decisionType: commitment.decisionType
            });
        }

        progress.commitments = Array.isArray(progress.commitments)
            ? progress.commitments
            : [];

        progress.commitments.push(commitment);

        record.history = Array.isArray(record.history)
            ? record.history
            : [];

        const recordEvent = {
            type: 'commitment',
            ...commitment
        };

        record.history.push(recordEvent);

        progress.dailyActivity = Array.isArray(progress.dailyActivity)
            ? progress.dailyActivity
            : [];

        progress.dailyActivity.push(recordEvent);

        aiSetDepthChart(team);

        return commitment;
    };

    const chooseWeightedCandidate = (
        candidates,
        commitmentProfile = {}
    ) => {
        if (candidates.length === 0) return null;

        const interestThreshold = Number.isFinite(
            Number(commitmentProfile.interestThreshold)
        )
            ? Number(commitmentProfile.interestThreshold)
            : seriousInterestThreshold;

        // Interest above the serious-contender threshold determines the
        // odds. A leader is favored, but the result isn't guaranteed.
        const weighted = candidates.map(candidate => {
            const fitMultiplier = Number.isFinite(
                Number(candidate.fitMultiplier)
            )
                ? Math.max(
                    0.8,
                    Math.min(1.2, Number(candidate.fitMultiplier))
                )
                : 1;

            const pushMultiplier = Number.isFinite(
                Number(candidate.pushMultiplier)
            )
                ? Math.max(
                    1,
                    Math.min(1.17, Number(candidate.pushMultiplier))
                )
                : 1;

            const preferenceFit =
                candidate.preferenceFit != null &&
                String(candidate.preferenceFit).trim() !== '' &&
                Number.isFinite(Number(candidate.preferenceFit))
                    ? Math.max(
                        0,
                        Math.min(100, Number(candidate.preferenceFit))
                    )
                    : 50;

            const decisionScore =
                candidate.decisionScore != null &&
                String(candidate.decisionScore).trim() !== '' &&
                Number.isFinite(Number(candidate.decisionScore))
                    ? Math.max(
                        0,
                        Math.min(120, Number(candidate.decisionScore))
                    )
                    : (
                        Number(candidate.interest) +
                        (preferenceFit - 50) * 0.35
                    );

            // Player-program fit matters substantially.
            // Additional recruiting effort helps, but has diminishing returns.
            const decisionMultiplier =
                Math.pow(fitMultiplier, 1.5) *
                Math.sqrt(pushMultiplier);

            return {
                ...candidate,
                weight: Math.pow(
                    Math.max(
                        1,
                        decisionScore - interestThreshold
                    ),
                    1.6
                ) * decisionMultiplier
            };
        });

        const totalWeight = weighted.reduce(
            (sum, candidate) => sum + candidate.weight,
            0
        );

        if (totalWeight <= 0) return null;

        // Players who are eager to join are less inclined to wait.
        // Higher-ego players are more willing to hold out for a better fit.
        const configuredNoCommitWeight = Number(
            commitmentProfile.noCommitWeight
        );

        const noCommitWeight = Number.isFinite(
            configuredNoCommitWeight
        )
            ? Math.max(0, configuredNoCommitWeight)
            : 55;

        let draw = Math.random() * (
            totalWeight + noCommitWeight
        );

        // The player rejects all available programs.
        if (draw >= totalWeight) {
            return null;
        }

        for (const candidate of weighted) {
            draw -= candidate.weight;

            if (draw <= 0) return candidate;
        }

        return weighted[weighted.length - 1] || null;
    };

    /**
     * Preserves a player's recruiting outcome between seasons.
     *
     * Remaining unsigned does not make a player ineligible for future
     * recruiting. A new campaign will reset team interest while this
     * personal history remains attached to the player.
     */
    const recordUnsignedOutcome = (
        player,
        record,
        contenders
    ) => {
        if (!player || !record) return;

        const seasonYear = Number(gameState.year);

        player.recruitingCampaignHistory =
            Array.isArray(player.recruitingCampaignHistory)
                ? player.recruitingCampaignHistory
                : [];

        // Prevent the same season's outcome from being recorded twice.
        const alreadyRecorded =
            player.recruitingCampaignHistory.some(entry =>
                entry?.type === 'unsigned_outcome' &&
                Number(entry.seasonYear) === seasonYear
            );

        if (alreadyRecorded) return;

        const interestValues = Object.entries(record.interestByTeam || {})
            .filter(([teamId]) => {
                const team = teamsById.get(String(teamId));
                return team?.leagueType === 'main';
            })
            .map(([, rawInterest]) => {
                if (rawInterest == null || String(rawInterest).trim() === '') return null;
                const interest = Number(rawInterest);
                return Number.isFinite(interest)
                    ? Math.max(0, Math.min(100, interest))
                    : null;
            })
            .filter(interest => interest !== null);

        const bestInterest = interestValues.length > 0
            ? Math.max(...interestValues)
            : 0;

        // Only count teams that actually made an active offer,
        // have roster capacity, and met this player's interest threshold.
        const seriousContenderCount = Array.isArray(contenders)
            ? contenders.filter(candidate => candidate?.team).length
            : 0;

        const hadSeriousOffer = seriousContenderCount > 0;

        const outcome = {
            type: 'unsigned_outcome',
            seasonYear,
            decisionDay: day,
            outcome: hadSeriousOffer
                ? 'remained_unsigned_after_offers'
                : 'remained_unsigned_without_serious_offers',
            seriousContenderCount,
            bestInterest
        };

        player.recruitingCampaignHistory.push(outcome);

        record.history = Array.isArray(record.history)
            ? record.history
            : [];

        const event = {
            type: 'recruiting_outcome',
            playerId: player.id,
            playerName: player.name,
            ...outcome
        };

        record.history.push(event);

        progress.dailyActivity = Array.isArray(
            progress.dailyActivity
        )
            ? progress.dailyActivity
            : [];

        progress.dailyActivity.push(event);
    };

    for (const [playerId, record] of Object.entries(
        progress.recruits || {}
    )) {
        if (
            record?.status !== 'available' ||
            record.committedTeamId != null
        ) {
            continue;
        }

        const player = getAvailablePlayer(playerId);

        if (!player) {
            const unavailablePlayer = gameState.players.find(
                candidate =>
                    String(candidate?.id) === String(playerId)
            );

            const unavailableStatusType = String(
                unavailablePlayer?.status?.type || ''
            ).toLowerCase();

            const unavailableLifecycle = String(
                unavailablePlayer?.lifecycle || ''
            ).toLowerCase();

            const unavailableLifecycleStatus = String(
                unavailablePlayer?.lifecycleStatus ||
                unavailablePlayer?.lifecycle?.status ||
                ''
            ).toLowerCase();

            const unavailableAge = Number(unavailablePlayer?.age);

            const statusDuration = Number(
                unavailablePlayer?.status?.duration
            );

            const injuryDuration = Number(
                unavailablePlayer?.injury?.duration ??
                unavailablePlayer?.injuryDuration ??
                0
            );

            // First establish that the player would otherwise be
            // eligible for this recruiting campaign.
            const isOtherwiseRecruitingEligible =
                unavailablePlayer?.teamId == null &&
                Number.isFinite(unavailableAge) &&
                unavailableAge >= 12 &&
                unavailableAge <= 18 &&
                !protectedDraftIds.has(String(unavailablePlayer?.id)) &&
                unavailableLifecycle !== 'draft_eligible' &&
                unavailableLifecycleStatus !== 'draft_eligible' &&
                !['retired', 'departed'].includes(
                    unavailableStatusType
                ) &&
                !['retired', 'departed'].includes(
                    unavailableLifecycleStatus
                );

            // An injury only qualifies for deferral when it actually
            // explains why an otherwise eligible player is unavailable.
            const isTemporarilyUnavailable =
                isOtherwiseRecruitingEligible &&
                (
                    (
                        Number.isFinite(statusDuration) &&
                        statusDuration > 0
                    ) ||
                    (
                        Number.isFinite(injuryDuration) &&
                        injuryDuration > 0
                    )
                );

            const isInjuryRelated =
                unavailableStatusType === 'injured' ||
                unavailableLifecycleStatus === 'injured' ||
                (
                    Number.isFinite(injuryDuration) &&
                    injuryDuration > 0
                );

            const deferredReason = isInjuryRelated
                ? 'injured_at_end_of_recruiting'
                : 'temporary_status_at_end_of_recruiting';

            // Give injured prospects the remaining recruiting days
            // to recover rather than permanently closing their campaign.
            if (isTemporarilyUnavailable && !finalDay) {
                continue;
            }

            const isDeferred = isTemporarilyUnavailable && finalDay;

            if (isDeferred) {
                record.status = 'deferred';
                record.deferredDay = day;
                record.deferredReason = deferredReason;
            } else {
                record.status = 'unavailable';
                record.unavailableDay = day;
                record.unavailableReason = 'no_longer_eligible';
            }

            const outcomeEvent = {
                type: isDeferred
                    ? 'recruiting_deferred'
                    : 'recruiting_unavailable',
                playerId,
                day,
                decisionDay: day,
                reason: isDeferred
                    ? deferredReason
                    : 'no_longer_eligible'
            };

            record.history = Array.isArray(record.history)
                ? record.history
                : [];

            record.history.push(outcomeEvent);

            progress.dailyActivity = Array.isArray(progress.dailyActivity)
                ? progress.dailyActivity
                : [];

            progress.dailyActivity.push(outcomeEvent);

            if (unavailablePlayer) {
                unavailablePlayer.recruitingCampaignHistory =
                    Array.isArray(
                        unavailablePlayer.recruitingCampaignHistory
                    )
                        ? unavailablePlayer.recruitingCampaignHistory
                        : [];

                const historyType = isDeferred
                    ? 'deferred_outcome'
                    : 'unavailable_outcome';

                const alreadyRecordedOutcome =
                    unavailablePlayer.recruitingCampaignHistory.some(
                        entry =>
                            entry?.type === historyType &&
                            Number(entry.seasonYear) ===
                                Number(gameState.year)
                    );

                if (!alreadyRecordedOutcome) {
                    unavailablePlayer.recruitingCampaignHistory.push({
                        type: historyType,
                        seasonYear: Number(gameState.year),
                        decisionDay: day,
                        outcome: isDeferred
                            ? (
                                isInjuryRelated
                                    ? 'deferred_due_to_injury'
                                    : 'deferred_due_to_temporary_status'
                            )
                            : 'campaign_ended_unavailable',
                        reason: isDeferred
                            ? deferredReason
                            : 'no_longer_eligible'
                    });
                }
            }

            continue;
        }

        const commitmentProfile = getCommitmentProfile(player);

        const contenders = Object.entries(
            record.offersByTeam || {}
        )
            .filter(([, offer]) =>
                offer?.status === 'active'
            )
            .map(([teamId]) => {
                const team = getEligibleTeam(teamId, player);
                const interest = getInterest(record, teamId);

                

                const playerFit = team
                    ? calculatePlayerRecruitingFit(
                        player,
                        record,
                        team
                    )
                    : null;

                const fitScore =
                    Number.isFinite(Number(playerFit?.fitScore))
                        ? Math.max(
                            0,
                            Math.min(100, Number(playerFit.fitScore))
                        )
                        : 50;

                const fitMultiplier =
                    Number.isFinite(Number(playerFit?.fitMultiplier))
                        ? Math.max(
                            0.8,
                            Math.min(1.2, Number(playerFit.fitMultiplier))
                        )
                        : 1;

                // Actual recruiting effort provides an additional,
                // diminishing advantage beyond accumulated interest.
                const pushMultiplier = team
                    ? calculateRecruitingPushMultiplier(
                        player,
                        record,
                        team
                    )
                    : 1;

                const preferenceFit = fitScore;

                const decisionScore =
                    interest + (preferenceFit - 50) * 0.35;

                return {
                    team,
                    interest,
                    fitScore,
                    fitMultiplier,
                    pushMultiplier,
                    preferenceFit,
                    decisionScore,
                };
            })
            .filter(candidate =>
                candidate.team &&
                candidate.interest >=
                    commitmentProfile.interestThreshold
            )
            .sort((a, b) =>
                b.decisionScore - a.decisionScore
            );

        if (contenders.length === 0) {
            if (finalDay) {
                recordUnsignedOutcome(
                    player,
                    record,
                    contenders
                );
            }

            continue;
        }

        let winner = null;

        // Day 2 onward, a strong leader may earn an early commitment.
        // Closely contested players are more likely to wait until Day 7.
        if (!finalDay && day >= 2) {
            const leader = contenders[0];
            const runnerUp = contenders[1] || null;

            const leadMargin = runnerUp
                ? Math.max(
                    0,
                    leader.decisionScore - runnerUp.decisionScore
                )
                : 0;

            const hasFewAlternatives = contenders.length === 1;
            const strongLead = leadMargin >= 18;

            const earlyCommitInterest =
                commitmentProfile.earlyCommitInterest;

            if (
                leader.interest >= earlyCommitInterest &&
                (hasFewAlternatives || strongLead)
            ) {
                // Strong recruiting interest can trigger an early
                // decision, but it does not dictate which team wins.
                const earlyCommitChance = Math.max(
                    0,
                    Math.min(
                        0.85,
                        0.35 +
                            (
                                leader.interest -
                                earlyCommitInterest
                            ) * 0.02 +
                            leadMargin * 0.006
                    )
                );  

                if (Math.random() < earlyCommitChance) {
                    // Let the player evaluate all serious offers using
                    // the same fit, recruiting investment, and
                    // willingness-to-remain-unsigned calculations
                    // used for the final recruiting decision.
                    winner = chooseWeightedCandidate(
                        contenders,
                        commitmentProfile
                    );
                }
            }
        }

        // End-of-week decisions consider all eligible serious contenders.
        if (finalDay && contenders.length > 0) {
            winner = chooseWeightedCandidate(
                contenders,
                commitmentProfile
            );
        }

        if (!winner) {
            if (finalDay) {
                recordUnsignedOutcome(
                    player,
                    record,
                    contenders
                );
            }

            continue;
        }

        const commitment = commitPlayer(
            player,
            record,
            winner.team,
            winner.interest,
            winner.fitScore,
            winner.fitMultiplier,
            winner.pushMultiplier,
            winner.preferenceFit,
            winner.decisionScore
        );

        if (!commitment) continue;

        if (finalDay) {
            finalCommitments.push(commitment);
        } else {
            earlyCommitments.push(commitment);
        }
    }

        // Any invitations still active after the final recruiting day
    // have expired without a commitment.
    if (finalDay) {
        progress.dailyActivity = Array.isArray(progress.dailyActivity)
            ? progress.dailyActivity
            : [];

        Object.entries(progress.recruits || {}).forEach(
            ([playerId, record]) => {
                if (
                    !record ||
                    record.committedTeamId != null ||
                    record.status === 'committed'
                ) {
                    return;
                }

                Object.entries(record.offersByTeam || {}).forEach(
                    ([teamId, offer]) => {
                        if (offer?.status !== 'active') return;

                        offer.status = 'declined';
                        offer.respondedDay = day;
                        offer.responseReason = 'recruiting_window_closed';

                        const player = gameState.players.find(
                            candidate =>
                                String(candidate?.id) === String(playerId)
                        );

                        const offerTeam = teamsById.get(String(teamId));

                        const offerEvent = {
                            type: 'recruiting_offer_response',
                            year: Number(gameState.year),
                            day,
                            playerId,
                            playerName: player?.name || 'Unknown Player',
                            teamId: offerTeam?.id ?? teamId,
                            teamName: offerTeam?.name || 'Unknown Team',
                            status: 'declined',
                            label: 'Roster invitation expired'
                        };

                        record.history = Array.isArray(record.history)
                            ? record.history
                            : [];

                        record.history.push(offerEvent);
                        progress.dailyActivity.push(offerEvent);
                    }
                );
            }
        );
    }

    // Record the day's resolution so revisiting or reloading the phase
    // cannot process the same day's commitments a second time.
    progress.resolvedDays.push(day);

    if (finalDay) {
        progress.completed = true;
        progress.completedDay = day;
        state.recruitingCompleted = true;
    }

    const remainingRecruits = Object.values(
        progress.recruits || {}
    ).filter(record =>
        record?.status === 'available' &&
        record.committedTeamId == null
    ).length;

    return {
        success: true,
        day,
        finalDay,
        earlyCommitments,
        finalCommitments,
        remainingRecruits,
        completed: progress.completed === true
    };
}

export function executeAICutDowns() {
    if (!game || !Array.isArray(game.teams)) return;

    const limit = REGULAR_SEASON_ROSTER_LIMIT;

    const playerTeamId = game.playerTeam?.id == null
        ? null
        : String(game.playerTeam.id);

    game.teams.forEach(team => {
        const isPlayerControlledTeam =
            team?.isPlayerControlled === true ||
            (
                playerTeamId !== null &&
                String(team?.id) === playerTeamId
            );

        if (
            !team ||
            isPlayerControlledTeam ||
            !Array.isArray(team.roster) ||
            team.roster.length <= limit
        ) {
            return;
        }

        const rosterObjs = getRosterObjects(team);

        // Use the flexible coaching group for roster evaluation.
        const coach = getAssignedCoachForTask(team, 'general') ||
            getTeamCoachingSpecialist(team, 'general');

        const scout = getAssignedCoachForTask(team, 'scouting') ||
            getTeamCoachingSpecialist(team, 'scouting');

        const discipline = getStaffBehaviorTendency(
            coach,
            'discipline'
        );

        const riskTolerance = getStaffBehaviorTendency(
            coach,
            'riskTolerance'
        );

        const relationshipOrientation = getStaffBehaviorTendency(
            coach,
            'relationshipOrientation'
        );

        const gmDirective =
            team.gameplan?.gmDirective || 'COACH_AUTONOMY';

        // Roster evaluations use this team's stored scouting reports.
        // Unscouted attributes remain unknown instead of being reconstructed
        // from the player's true ratings.
        const getCutEvaluationScore = p => {
            const { report, confidence } =
                getTrainingReportConfidence(team, p);

            const position = getTrainingPlayerPosition(p, team);

            // A public position does not reveal a player's ability.
            // Without a usable scouting report, positional ability stays neutral.
            let val = position
                ? getTrainingOverallScore(p, position, team)
                : 50;

            const playerAge = Number(p.age);

            // Age is observable information; hidden potential is not.
            if (
                gmDirective === 'DEVELOP_YOUTH' &&
                Number.isFinite(playerAge)
            ) {
                if (playerAge <= 13) {
                    val += 8;
                } else if (playerAge <= 15) {
                    val += 4;
                }
            }

            const characterSummary = String(
                report?.evaluation?.characterSummary || ''
            ).toLowerCase();

            let estimatedWorkEthic = 50;
            let estimatedTeamFit = 50;

            // Character evaluations require at least moderate confidence.
            // Blend reported signals toward neutral when confidence is limited.
            if (confidence >= 0.50) {
                let effortSignal = null;

                if (
                    characterSummary.includes(
                        'strong effort/reliability signals'
                    )
                ) {
                    effortSignal = 75;
                } else if (
                    characterSummary.includes(
                        'generally steady effort'
                    )
                ) {
                    effortSignal = 60;
                } else if (
                    characterSummary.includes(
                        'effort/reliability need closer review'
                    )
                ) {
                    effortSignal = 35;
                }

                if (effortSignal !== null) {
                    estimatedWorkEthic =
                        50 + (effortSignal - 50) * confidence;
                }

                let teamFitSignal = null;

                if (characterSummary.includes('team-oriented')) {
                    teamFitSignal = 75;
                } else if (
                    characterSummary.includes(
                        'may fit with clear expectations'
                    )
                ) {
                    teamFitSignal = 60;
                } else if (
                    characterSummary.includes(
                        'may need relationship-building'
                    )
                ) {
                    teamFitSignal = 35;
                }

                if (teamFitSignal !== null) {
                    estimatedTeamFit =
                        50 + (teamFitSignal - 50) * confidence;
                }
            }

            // Physical and mental traits also come from reported ranges.
            const toughness = getTrainingAttributeScore(
                p,
                'toughness',
                team
            );

            const strength = getTrainingAttributeScore(
                p,
                'strength',
                team
            );

            // Individual coaching tendencies influence cut-day evaluations.
            // They can favor certain player profiles, but cannot reveal
            // personality traits the team has not scouted.
            let coachingBias = 0;

            if (discipline >= 65) {
                if (estimatedWorkEthic < 40) {
                    coachingBias -= 12;
                }

                if (estimatedTeamFit < 40) {
                    coachingBias -= 10;
                }

                if (toughness > 65) {
                    coachingBias += 6;
                }
            }

            if (
                riskTolerance >= 65 &&
                strength > 60
            ) {
                coachingBias += 6;
            }

            if (
                relationshipOrientation >= 65 &&
                estimatedTeamFit > 65
            ) {
                coachingBias += 8;
            }

            coachingBias = Math.max(
                -20,
                Math.min(12, coachingBias)
            );

            val += coachingBias;

            // Experience is observable; this is a roster philosophy choice.
            if (
                gmDirective === 'WIN_NOW' &&
                Number.isFinite(playerAge) &&
                playerAge >= 16
            ) {
                val += 5;
            }

            return val;
        };

        // Sort by perceived value (highest value kept, lowest cut)
        rosterObjs.sort((a, b) => getCutEvaluationScore(b) - getCutEvaluationScore(a));

        // Identify who is getting cut
        const playersToKeep = rosterObjs.slice(0, limit);
        const playersToCut = rosterObjs.slice(limit);

        playersToCut.forEach(p => {
            p.teamId = null;
            p.number = null;

            const hasActiveInjury =
                String(p.status?.type || '').toLowerCase() === 'injured' ||
                Number(p.status?.duration) > 0 ||
                Number(
                    p.injury?.duration ||
                    p.injuryDuration ||
                    0
                ) > 0;

            // Cutting a player must not erase an existing injury.
            if (!hasActiveInjury) {
                p.status = {
                    type: 'healthy',
                    description: 'Cut during summer tryouts',
                    duration: 0
                };
            }

            team.roster = team.roster.filter(
                id => String(id) !== String(p.id)
            );
        });

        aiSetDepthChart(team);
    });
}

/**
 * Generates the player's post-recruiting walk-on invitation list.
 *
 * Invitations include unsigned prospects who showed interest in
 * this team during the completed recruiting campaign.
 * Evaluations use only the team's own scouting information.
 *
 * The invitation list is saved so loading or reopening the screen
 * cannot generate a different group of prospects.
 */
export function generateTeamWalkOnInvitations(gameState, teamId) {
    const state = gameState?.offseasonState;
    const progress = state?.recruitingProgress;

    const year = Number(gameState?.year);

    const normalizedPhase = String(state?.phase || '')
        .toLowerCase()
        .replace(/[^a-z]/g, '');

    const totalDays = Number(state?.recruitingDays);
    const currentDay = Number(state?.recruitingDay);

    const finalDayResolved =
        progress?.initialized === true &&
        progress?.completed === true &&
        Number(progress?.seasonYear) === year &&
        Number.isInteger(currentDay) &&
        Number.isInteger(totalDays) &&
        currentDay >= totalDays &&
        Array.isArray(progress?.resolvedDays) &&
        progress.resolvedDays.some(
            resolvedDay =>
                Number(resolvedDay) === currentDay
        );

    if (
        !gameState ||
        !progress ||
        !Number.isInteger(year) ||
        normalizedPhase !== 'rosterfinalization' ||
        gameState.offseasonFACompleted === true ||
        !finalDayResolved
    ) {
        return {
            success: false,
            message: 'Walk-on invitations can only be generated after recruiting is complete, during roster finalization.',
            offers: []
        };
    }

    const playerTeamId = gameState.playerTeam?.id == null
        ? null
        : String(gameState.playerTeam.id);

    const team = Array.isArray(gameState.teams)
        ? gameState.teams.find(
            candidate =>
                candidate &&
                String(candidate.id) === String(teamId)
        )
        : null;

    if (!team) {
        return {
            success: false,
            message: 'The requested team could not be found.',
            offers: []
        };
    }

    const isPlayerTeam =
        team.isPlayerControlled === true ||
        (
            playerTeamId !== null &&
            String(team.id) === playerTeamId
        );

    if (!isPlayerTeam) {
        return {
            success: false,
            message: 'Walk-on invitations are only generated for the player-controlled team.',
            offers: []
        };
    }

    const teamKey = String(team.id);
    const rosterSize = getRosterObjects(team).length;

    const targetRosterSize = 16;
    const maximumRosterSize = REGULAR_SEASON_ROSTER_LIMIT;

    // Restore the existing list before deciding whether new invitations
    // are needed. Never reroll an invitation for the same season.
    const existingInvitation =
        progress.walkOnInvitationsByTeam?.[teamKey];

    if (
        existingInvitation &&
        Number(existingInvitation.seasonYear) === year &&
        rosterSize >= maximumRosterSize
    ) {
        existingInvitation.currentRosterSize = rosterSize;
        existingInvitation.status = 'full';

        (existingInvitation.offers || []).forEach(candidate => {
            if (candidate.status === 'offered') {
                candidate.status = 'expired';
            }
        });

        return {
            success: true,
            needsWalkOns: false,
            invitation: existingInvitation,
            offers: existingInvitation.offers || []
        };
    }

    if (rosterSize >= maximumRosterSize) {
        return {
            success: true,
            needsWalkOns: false,
            offers: []
        };
    }

    if (
        existingInvitation &&
        Number(existingInvitation.seasonYear) === year
    ) {
        return {
            success: true,
            needsWalkOns: true,
            invitation: existingInvitation,
            offers: existingInvitation.offers || []
        };
    }

    const recruitingRecords = progress.recruits || {};

    const protectedDraftIds = new Set(
        (Array.isArray(gameState.draftClass)
            ? gameState.draftClass
            : []
        )
            .map(prospect =>
                prospect && typeof prospect === 'object'
                    ? prospect.id
                    : prospect
            )
            .filter(id => id != null)
            .map(String)
    );

    const rosterIds = new Set(
        (Array.isArray(team.roster) ? team.roster : [])
            .map(entry => {
                const id =
                    entry && typeof entry === 'object'
                        ? entry.id
                        : entry;

                return id == null ? null : String(id);
            })
            .filter(id => id !== null)
    );

    const candidates = gameState.players
        .filter(player => {
            if (
                !player ||
                player.id == null ||
                player.teamId != null ||
                rosterIds.has(String(player.id))
            ) {
                return false;
            }

            const record =
                recruitingRecords[String(player.id)];

            const age = Number(player.age);

            const statusType = String(
                player.status?.type || ''
            ).toLowerCase();

            const lifecycle = String(
                player.lifecycle || ''
            ).toLowerCase();

            const lifecycleStatus = String(
                player.lifecycleStatus ||
                player.lifecycle?.status ||
                ''
            ).toLowerCase();

            const interestRaw =
                record?.interestByTeam?.[teamKey];

            const interest = Number(interestRaw);

            const refusedThisTeam =
                Array.isArray(player.refusedTeamIds) &&
                player.refusedTeamIds.some(
                    refusedId =>
                        String(refusedId) === teamKey
                );

            return (
                record?.status === 'available' &&
                record.committedTeamId == null &&
                interestRaw != null &&
                String(interestRaw).trim() !== '' &&
                Number.isFinite(interest) &&
                interest > 0 &&
                Number.isFinite(age) &&
                age >= 12 &&
                age <= 18 &&
                !protectedDraftIds.has(String(player.id)) &&
                !refusedThisTeam &&
                ![
                    'retired',
                    'departed',
                    'temporary',
                    'injured'
                ].includes(statusType) &&
                ![
                    'retired',
                    'departed',
                    'temporary',
                    'injured',
                    'draft_eligible'
                ].includes(lifecycleStatus) &&
                ![
                    'retired',
                    'departed',
                    'temporary',
                    'injured',
                    'draft_eligible'
                ].includes(lifecycle) &&
                !(Number(player.status?.duration) > 0) &&
                !(
                    Number(
                        player.injury?.duration ||
                        player.injuryDuration ||
                        0
                    ) > 0
                )
            );
        })
        .map(player => {
            const record =
                recruitingRecords[String(player.id)];

            const interest = Math.max(
                0,
                Math.min(
                    100,
                    Number(record.interestByTeam?.[teamKey]) || 0
                )
            );

            const { report, confidence: rawConfidence } =
                getTrainingReportConfidence(team, player);

            const confidence = Math.max(
                0,
                Math.min(1, Number(rawConfidence) || 0)
            );

            // Only use the prospect's publicly listed position here.
            // Do not infer their best position from hidden attributes.
            const listedPosition = normalizeTrainingPosition(
                player?.pos ||
                player?.position ||
                player?.Pos
            );

            // Invitation rankings must use this team's scouting report,
            // even though this is the player-controlled organization.
            const reportedFits = [
                report?.evaluation?.offenseFit,
                report?.evaluation?.defenseFit
            ]
                .map(fit => {
                    const fitPosition =
                        normalizeTrainingPosition(fit?.position);

                    const low = Number(fit?.low);
                    const high = Number(fit?.high);

                    if (
                        !fitPosition ||
                        fit?.low == null ||
                        fit?.high == null ||
                        !Number.isFinite(low) ||
                        !Number.isFinite(high) ||
                        high < low ||
                        (
                            listedPosition &&
                            fitPosition !== listedPosition
                        )
                    ) {
                        return null;
                    }

                    return {
                        position: fitPosition,
                        estimate: low +
                            ((high - low) / 2) * confidence
                    };
                })
                .filter(Boolean)
                .sort((a, b) => b.estimate - a.estimate);

            const bestReportedFit = reportedFits[0] || null;

            const position =
                listedPosition ||
                bestReportedFit?.position ||
                'ATH';

            const estimatedOverall =
                report &&
                confidence >= 0.50 &&
                bestReportedFit
                    ? Number(bestReportedFit.estimate)
                    : null;

            const validEstimate =
                Number.isFinite(estimatedOverall)
                    ? estimatedOverall
                    : null;

            // Recruiting interest is the primary signal.
            // Reported ability contributes only when scouting
            // confidence is sufficient.
            const abilityAdjustment =
                validEstimate === null
                    ? 0
                    : (validEstimate - 50) *
                        0.25 *
                        confidence;

            const rankingScore =
                interest * 0.55 +
                abilityAdjustment +
                confidence * 2;

            return {
                playerId: player.id,
                playerName: player.name,
                age: Number(player.age),
                position: position || player.pos || 'ATH',
                recruitingInterest: interest,
                estimatedOverall: validEstimate,
                scoutingConfidence: confidence,
                rankingScore
            };
        })
        .sort((a, b) =>
            b.rankingScore - a.rankingScore ||
            b.recruitingInterest - a.recruitingInterest ||
            b.scoutingConfidence - a.scoutingConfidence ||
            String(a.playerId).localeCompare(String(b.playerId))
        );

    // Offer a few more prospects than the number of roster spots
    // needed to reach 16, while keeping the list between 3 and 7.
    const neededForTarget = Math.max(
        0,
        targetRosterSize - rosterSize
    );

    const offerCount = Math.min(
        7,
        Math.max(3, neededForTarget + 2),
        candidates.length
    );

    const offers = candidates
        .slice(0, offerCount)
        .map((candidate, index) => ({
            ...candidate,
            offerNumber: index + 1,
            status: 'offered'
        }));

    if (
        !progress.walkOnInvitationsByTeam ||
        typeof progress.walkOnInvitationsByTeam !== 'object' ||
        Array.isArray(progress.walkOnInvitationsByTeam)
    ) {
        progress.walkOnInvitationsByTeam = {};
    }

    const invitation = {
        seasonYear: year,
        teamId: team.id,
        teamName: team.name,
        createdDay: totalDays,
        targetRosterSize,
        maximumRosterSize,
        rosterSizeAtInvitation: rosterSize,
        status: offers.length > 0 ? 'pending' : 'none_available',
        offers,
        acceptedPlayerIds: [],
        declinedPlayerIds: []
    };

    progress.walkOnInvitationsByTeam[teamKey] = invitation;

    return {
        success: true,
        needsWalkOns: true,
        invitation,
        offers
    };
}

/**
 * Accepts one of the player's saved walk-on invitations.
 *
 * Walk-ons do not consume recruiting staff time or team cash.
 * They use the normal roster-assignment pipeline and are limited
 * to the 18-player regular-season maximum.
 */
export function acceptTeamWalkOnInvitation(gameState, playerId) {
    const state = gameState?.offseasonState;
    const progress = state?.recruitingProgress;

    const acceptancePhase = String(state?.phase || '')
        .toLowerCase()
        .replace(/[^a-z]/g, '');

    const acceptanceYear = Number(gameState?.year);
    const acceptanceTotalDays = Number(state?.recruitingDays);
    const acceptanceCurrentDay = Number(state?.recruitingDay);

    const acceptanceFinalDayResolved =
        progress?.initialized === true &&
        progress?.completed === true &&
        Number(progress?.seasonYear) === acceptanceYear &&
        Number.isInteger(acceptanceCurrentDay) &&
        Number.isInteger(acceptanceTotalDays) &&
        acceptanceCurrentDay >= acceptanceTotalDays &&
        Array.isArray(progress.resolvedDays) &&
        progress.resolvedDays.some(
            resolvedDay =>
                Number(resolvedDay) === acceptanceCurrentDay
        );

    if (
        !gameState ||
        acceptancePhase !== 'rosterfinalization' ||
        gameState.offseasonFACompleted === true ||
        !acceptanceFinalDayResolved
    ) {
        return {
            success: false,
            message: 'Walk-ons can only be accepted during roster finalization.'
        };
    }

    const teamId = gameState.playerTeam?.id;

    if (teamId == null) {
        return {
            success: false,
            message: 'The player-controlled team could not be found.'
        };
    }

    const teamKey = String(teamId);

    const team = gameState.teams?.find(
        candidate => String(candidate?.id) === teamKey
    );

    if (!team) {
        return {
            success: false,
            message: 'The player-controlled team could not be found.'
        };
    }

    const invitation =
        progress.walkOnInvitationsByTeam?.[teamKey];

    if (
        !invitation ||
        String(invitation.teamId) !== teamKey ||
        Number(invitation.seasonYear) !== acceptanceYear ||
        invitation.status !== 'pending' ||
        !Array.isArray(invitation.offers)
    ) {
        return {
            success: false,
            message: 'There is no active walk-on invitation list.'
        };
    }

    const playerKey = String(playerId);

    const offer = invitation.offers?.find(
        candidate =>
            String(candidate?.playerId) === playerKey
    );

    if (!offer || offer.status !== 'offered') {
        return {
            success: false,
            message: 'This player does not have an active walk-on offer.'
        };
    }

    const rosterIds = new Set(
        (Array.isArray(team.roster) ? team.roster : [])
            .map(entry => {
                const id =
                    entry && typeof entry === 'object'
                        ? entry.id
                        : entry;

                return id == null ? null : String(id);
            })
            .filter(id => id !== null)
    );

    const rosterSize = getRosterObjects(team).length;
    const maximumRosterSize = REGULAR_SEASON_ROSTER_LIMIT;

    if (rosterSize >= maximumRosterSize) {
        invitation.status = 'full';

        invitation.offers.forEach(candidate => {
            if (candidate.status === 'offered') {
                candidate.status = 'expired';
            }
        });

        return {
            success: false,
            message: 'Your roster is already at the 18-player limit.',
            rosterSize
        };
    }

    const player = gameState.players?.find(
        candidate => String(candidate?.id) === playerKey
    );

    const record =
        progress.recruits?.[playerKey];

    if (
        !player ||
        !record ||
        record.status !== 'available' ||
        record.committedTeamId != null ||
        player.teamId != null ||
        rosterIds.has(playerKey)
    ) {
        offer.status = 'unavailable';

        return {
            success: false,
            message: 'This prospect is no longer available.'
        };
    }

    const age = Number(player.age);

    const statusType = String(
        player.status?.type || ''
    ).toLowerCase();

    const lifecycle = String(
        player.lifecycle || ''
    ).toLowerCase();

    const lifecycleStatus = String(
        player.lifecycleStatus ||
        player.lifecycle?.status ||
        ''
    ).toLowerCase();

    const refusedThisTeam =
        Array.isArray(player.refusedTeamIds) &&
        player.refusedTeamIds.some(
            refusedId => String(refusedId) === teamKey
        );

    const protectedDraftIds = new Set(
        (Array.isArray(gameState.draftClass)
            ? gameState.draftClass
            : []
        )
            .map(prospect =>
                prospect && typeof prospect === 'object'
                    ? prospect.id
                    : prospect
            )
            .filter(id => id != null)
            .map(String)
    );

    const stillEligible =
        Number.isFinite(age) &&
        age >= 12 &&
        age <= 18 &&
        !protectedDraftIds.has(playerKey) &&
        !refusedThisTeam &&
        ![
            'retired',
            'departed',
            'temporary',
            'injured'
        ].includes(statusType) &&
        ![
            'retired',
            'departed',
            'temporary',
            'injured',
            'draft_eligible'
        ].includes(lifecycleStatus) &&
        ![
            'retired',
            'departed',
            'temporary',
            'injured',
            'draft_eligible'
        ].includes(lifecycle) &&
        !(Number(player.status?.duration) > 0) &&
        !(
            Number(
                player.injury?.duration ||
                player.injuryDuration ||
                0
            ) > 0
        );

    if (!stillEligible) {
        offer.status = 'unavailable';

        return {
            success: false,
            message: 'This prospect is no longer eligible to join.'
        };
    }

    // Use the established roster-assignment pipeline.
    if (!addPlayerToTeam(player, team)) {
        return {
            success: false,
            message: 'The player could not be added to your roster.'
        };
    }

    player.lifecycle = 'active';

    player.status = {
        type: 'healthy',
        description: '',
        duration: 0
    };

    const recruitingDay =
        Number(progress.completedDay) ||
        Number(invitation.createdDay) ||
        Number(state.recruitingDays) ||
        7;

    const interest = Math.max(
        0,
        Math.min(
            100,
            Number(record.interestByTeam?.[teamKey]) || 0
        )
    );

    record.status = 'committed';
    record.committedTeamId = team.id;
    record.committedDay = recruitingDay;

    const commitment = {
        playerId: player.id,
        playerName: player.name,
        teamId: team.id,
        teamName: team.name,
        day: recruitingDay,
        interestAtCommit: interest,
        decisionType: 'walk_on'
    };

    progress.commitments = Array.isArray(progress.commitments)
        ? progress.commitments
        : [];

    progress.commitments.push(commitment);

    record.history = Array.isArray(record.history)
        ? record.history
        : [];

    const recordEvent = {
        type: 'commitment',
        ...commitment
    };

    record.history.push(recordEvent);

    progress.dailyActivity = Array.isArray(progress.dailyActivity)
        ? progress.dailyActivity
        : [];

    progress.dailyActivity.push(recordEvent);

    offer.status = 'accepted';

    invitation.acceptedPlayerIds =
        Array.isArray(invitation.acceptedPlayerIds)
            ? invitation.acceptedPlayerIds
            : [];

    if (
        !invitation.acceptedPlayerIds.some(
            id => String(id) === playerKey
        )
    ) {
        invitation.acceptedPlayerIds.push(player.id);
    }

    invitation.currentRosterSize =
        getRosterObjects(team).length;

    if (invitation.currentRosterSize >= maximumRosterSize) {
        invitation.status = 'full';

        invitation.offers.forEach(candidate => {
            if (candidate.status === 'offered') {
                candidate.status = 'expired';
            }
        });
    }

    aiSetDepthChart(team);

    return {
        success: true,
        message: `${player.name} has accepted a walk-on spot.`,
        commitment,
        rosterSize: invitation.currentRosterSize,
        targetRosterSize: invitation.targetRosterSize || 16,
        maximumRosterSize
    };
}
export function autoFillTeamWalkOns(team, targetSize = 14) {
    if (
        !team ||
        !game ||
        !Array.isArray(game.players) ||
        !Array.isArray(team.roster)
    ) {
        return 0;
    }

    targetSize = Number.isFinite(Number(targetSize))
        ? Math.max(0, Math.floor(Number(targetSize)))
        : 14;

    const isPlayerControlledTeam =
        team.isPlayerControlled === true ||
        (
            game.playerTeam?.id != null &&
            String(team.id) === String(game.playerTeam.id)
        );

    // Player-controlled walk-ons must go through the invitation process.
    if (isPlayerControlledTeam) return 0;

    let added = 0;
    const limit = getCurrentRosterLimit(game);

    // Walk-on evaluations use the team's own scouting reports.
    // Unscouted ability remains unknown rather than being reconstructed
    // from the player's actual attributes.
    const assessmentCache = new Map();

    const evaluateWalkOn = player => {
        const cacheKey = String(player.id ?? player.name ?? '');

        if (assessmentCache.has(cacheKey)) {
            return assessmentCache.get(cacheKey);
        }

        const { report, confidence } =
            getTrainingReportConfidence(team, player);

        const position = getTrainingPlayerPosition(player, team);

        const overall = report && confidence >= 0.50
            ? getTrainingOverallScore(player, position, team)
            : 50;

        const result = {
            position,
            overall: Number.isFinite(Number(overall))
                ? Number(overall)
                : 50,
            confidence
        };

        assessmentCache.set(cacheKey, result);
        return result;
    };

    const recruitingProgress =
        game.offseasonState?.recruitingProgress;

    const recruitingRecords =
        recruitingProgress?.recruits || {};

    const recruitingYear = Number(recruitingProgress?.seasonYear);
    const currentYear = Number(game.year);

    const hasActiveRecruitingCampaign =
        recruitingProgress?.initialized === true &&
        Number.isInteger(recruitingYear) &&
        recruitingYear === currentYear;

    const teamKey = String(team.id);

    const teamRosterIds = new Set(
        (Array.isArray(team.roster) ? team.roster : [])
            .map(entry => {
                const id =
                    entry && typeof entry === 'object'
                        ? entry.id
                        : entry;

                return id == null ? null : String(id);
            })
            .filter(id => id !== null)
    );

    const protectedDraftIds = new Set(
        (Array.isArray(game.draftClass) ? game.draftClass : [])
            .map(prospect =>
                prospect && typeof prospect === 'object'
                    ? prospect.id
                    : prospect
            )
            .filter(id => id != null)
            .map(String)
    );

    // Exclude players still listed on another team's roster, even if
    // their player.teamId field is missing or stale.
    const playersOnOtherRosters = new Set();

    for (const otherTeam of game.teams || []) {
        if (
            !otherTeam ||
            String(otherTeam.id) === String(team.id) ||
            !Array.isArray(otherTeam.roster)
        ) {
            continue;
        }

        for (const entry of otherTeam.roster) {
            const id =
                entry && typeof entry === 'object'
                    ? entry.id
                    : entry;

            if (id != null) {
                playersOnOtherRosters.add(String(id));
            }
        }
    }

    // Remember failed assignments so one rejected prospect cannot
    // prevent the AI team from considering other available candidates.
    const rejectedCandidateIds = new Set();

    while (team.roster.length < targetSize && team.roster.length < limit) {
        const unassigned = game.players.filter(player => {
            if (
                !player ||
                player.id == null ||
                player.teamId != null ||
                teamRosterIds.has(String(player.id)) ||
                playersOnOtherRosters.has(String(player.id)) ||
                rejectedCandidateIds.has(String(player.id))
            ) {
                return false;
            }

            const age = Number(player.age);

            const statusType = String(
                player.status?.type || ''
            ).toLowerCase();

            const lifecycle = String(
                player.lifecycle || ''
            ).toLowerCase();

            const lifecycleStatus = String(
                player.lifecycleStatus ||
                player.lifecycle?.status ||
                ''
            ).toLowerCase();

            const interestRaw =
                recruitingRecords[String(player.id)]
                    ?.interestByTeam?.[teamKey];

            const interest = Number(interestRaw);

            const showedTeamInterest =
                !hasActiveRecruitingCampaign ||
                (
                    recruitingRecords[String(player.id)]?.status ===
                        'available' &&
                    recruitingRecords[String(player.id)]
                        ?.committedTeamId == null &&
                    interestRaw != null &&
                    String(interestRaw).trim() !== '' &&
                    Number.isFinite(interest) &&
                    interest > 0
                );

            const refusedThisTeam =
                Array.isArray(player.refusedTeamIds) &&
                player.refusedTeamIds.some(
                    refusedId => String(refusedId) === teamKey
                );

            return (
                Number.isFinite(age) &&
                age >= 12 &&
                age <= 18 &&
                !protectedDraftIds.has(String(player.id)) &&
                ![
                    'retired',
                    'departed',
                    'temporary',
                    'injured'
                ].includes(statusType) &&
                ![
                    'retired',
                    'departed',
                    'temporary',
                    'injured',
                    'draft_eligible'
                ].includes(lifecycleStatus) &&
                ![
                    'retired',
                    'departed',
                    'temporary',
                    'injured',
                    'draft_eligible'
                ].includes(lifecycle) &&
                !(Number(player.status?.duration) > 0) &&
                !(
                    Number(
                        player.injury?.duration ||
                        player.injuryDuration ||
                        0
                    ) > 0
                ) &&
                !refusedThisTeam &&
                showedTeamInterest
            );
        });
        if (unassigned.length === 0) break;

        // Prefer candidates with stronger reported ability.
        // When ability estimates are equal, prefer the more thoroughly
        // scouted candidate before using a stable tie-breaker.
        unassigned.sort((a, b) => {
            const assessmentA = evaluateWalkOn(a);
            const assessmentB = evaluateWalkOn(b);

            return (
                assessmentB.overall - assessmentA.overall ||
                assessmentB.confidence - assessmentA.confidence ||
                String(a.id ?? a.name ?? '').localeCompare(
                    String(b.id ?? b.name ?? '')
                )
            );
        });

        const recruit = unassigned[0];
        if (addPlayerToTeam(recruit, team)) {
            recruit.lifecycle = 'active';

            recruit.status = {
                type: 'healthy',
                description: '',
                duration: 0
            };

            // AI walk-ons become ordinary recruiting commitments.
            if (hasActiveRecruitingCampaign) {
                const recruitKey = String(recruit.id);
                const record = recruitingRecords[recruitKey];

                if (
                    record &&
                    record.status === 'available' &&
                    record.committedTeamId == null
                ) {
                    const recruitingDay =
                        Number(game.offseasonState?.recruitingDay) ||
                        Number(game.offseasonState?.recruitingDays) ||
                        7;

                    const interest = Math.max(
                        0,
                        Math.min(
                            100,
                            Number(
                                record.interestByTeam?.[teamKey]
                            ) || 0
                        )
                    );

                    const commitment = {
                        playerId: recruit.id,
                        playerName: recruit.name,
                        teamId: team.id,
                        teamName: team.name,
                        day: recruitingDay,
                        interestAtCommit: interest,
                        decisionType: 'walk_on'
                    };

                    record.status = 'committed';
                    record.committedTeamId = team.id;
                    record.committedDay = recruitingDay;

                    record.history = Array.isArray(record.history)
                        ? record.history
                        : [];

                    const recordEvent = {
                        type: 'commitment',
                        ...commitment
                    };

                    record.history.push(recordEvent);

                    recruitingProgress.commitments =
                        Array.isArray(recruitingProgress.commitments)
                            ? recruitingProgress.commitments
                            : [];

                    recruitingProgress.commitments.push(commitment);

                    recruitingProgress.dailyActivity =
                        Array.isArray(recruitingProgress.dailyActivity)
                            ? recruitingProgress.dailyActivity
                            : [];

                    recruitingProgress.dailyActivity.push(recordEvent);
                }
            }

            added++;
        } else {
            rejectedCandidateIds.add(String(recruit.id));
        }
    }
    if (added > 0) aiSetDepthChart(team);
    return added;
}

export function aiManageRoster(team) {
    if (!team || !team.roster || !game || !team.coach) return;

    const roster = getRosterObjects(team);

    const isAvailablePermanentPlayer = player =>
        player &&
        !['departed', 'retired', 'temporary'].includes(player.status?.type) &&
        (!player.status || Number(player.status.duration || 0) <= 0);

    const availablePermanentCount = roster.filter(
        isAvailablePermanentPlayer
    ).length;

    if (!Array.isArray(team.temporaryPlayers)) {
        team.temporaryPlayers = [];
    }

    const countedTemporaryIds = new Set();

    const availableTemporaryCount = team.temporaryPlayers
        .map(id => getPlayer(id))
        .filter(player => {
            if (
                !player ||
                player.id == null ||
                player.teamId != null ||
                player.status?.type !== 'temporary' ||
                Number(player.status.duration || 0) > 0 ||
                team.roster.some(
                    id => String(id) === String(player.id)
                )
            ) {
                return false;
            }

            const playerId = String(player.id);

            if (countedTemporaryIds.has(playerId)) {
                return false;
            }

            const assignedElsewhere = (game.teams || []).some(other =>
                other &&
                String(other.id) !== String(team.id) &&
                Array.isArray(other.temporaryPlayers) &&
                other.temporaryPlayers.some(
                    id => String(id) === playerId
                )
            );

            if (assignedElsewhere) return false;

            countedTemporaryIds.add(playerId);
            return true;
        }).length;

    let playableCount =
        availablePermanentCount + availableTemporaryCount;

    const aiAvailableNetwork = getTeamNetworkRecruits(team);

    // Network relationships are observable, but actual player ability
    // must come from this team's own scouting reports.
    const getNetworkRecruitEvaluation = candidate => {
        const { report, confidence } =
            getTrainingReportConfidence(team, candidate);

        const position = getTrainingPlayerPosition(
            candidate,
            team
        );

        const ability = report && confidence >= 0.50
            ? getTrainingOverallScore(
                candidate,
                position,
                team
            )
            : 50;

        const rawNetworkStrength = Number(
            candidate?.networkStrength
        );

        const networkStrength = Number.isFinite(rawNetworkStrength)
            ? Math.max(0, Math.min(100, rawNetworkStrength))
            : 0;

        return {
            ability: Number.isFinite(Number(ability))
                ? Number(ability)
                : 50,
            confidence,
            networkStrength
        };
    };

    while (
        playableCount < 8 &&
        aiAvailableNetwork.length > 0
    ) {
        const bestFA = aiAvailableNetwork.reduce((best, current) => {
            if (!best) return current;

            const currentEvaluation =
                getNetworkRecruitEvaluation(current);

            const bestEvaluation =
                getNetworkRecruitEvaluation(best);

            const currentScore =
                currentEvaluation.ability +
                currentEvaluation.networkStrength * 15 +
                currentEvaluation.confidence * 5;

            const bestScore =
                bestEvaluation.ability +
                bestEvaluation.networkStrength * 15 +
                bestEvaluation.confidence * 5;

            return currentScore > bestScore ? current : best;
        }, null);

        if (!bestFA) break;

        const idx = aiAvailableNetwork.findIndex(
            p => String(p.id) === String(bestFA.id)
        );

        if (idx > -1) {
            aiAvailableNetwork.splice(idx, 1);
        }

        const masterFA = getPlayer(bestFA.id);
        if (!masterFA) continue;

        const playerId = String(masterFA.id);

        const alreadyHelpingAnotherTeam = (game.teams || []).some(other =>
            other &&
            String(other.id) !== String(team.id) &&
            Array.isArray(other.temporaryPlayers) &&
            other.temporaryPlayers.some(
                id => String(id) === playerId
            )
        );

        const alreadyOnThisTeam =
            team.roster.some(id => String(id) === playerId) ||
            team.temporaryPlayers.some(id => String(id) === playerId);

        const isUnavailable =
            masterFA.teamId != null ||
            alreadyHelpingAnotherTeam ||
            alreadyOnThisTeam ||
            ['departed', 'retired', 'temporary'].includes(
                masterFA.status?.type
            ) ||
            (
                masterFA.status &&
                Number(masterFA.status.duration || 0) > 0
            );

        if (isUnavailable) continue;

        // AI emergency help is temporary and does not change ownership.
        masterFA.status = {
            type: 'temporary',
            description: 'Helping Out',
            duration: 0
        };

        masterFA.teamId = null;
        masterFA.number = null;

        team.temporaryPlayers.push(masterFA.id);
        playableCount++;
    }

    aiSetDepthChart(team);
}

function getAssignedCoachForTask(team, task) {
    const coaches = Array.isArray(team?.coaches)
        ? team.coaches.filter(coach => coach?.id != null)
        : [];

    const taskSkills = {
        training: [
            'teaching',
            'practiceDiscipline',
            'conditioning'
        ],
        scouting: [
            'evalPhysicals',
            'evalTechnique',
            'evalCharacter'
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

    const skills = taskSkills[task] || [];

    const getSkillScore = coach => {
        if (skills.length === 0) return 50;

        const ratings = coach.ratings || {};

        return skills.reduce((sum, key) => {
            const value = Number(ratings[key]);
            return sum + (
                Number.isFinite(value)
                    ? Math.max(0, Math.min(100, value))
                    : 50
            );
        }, 0) / skills.length;
    };

    const hoursByCoach = new Map();

    for (const assignment of team?.staffWorkPlan?.assignments || []) {
        if (
            assignment?.task !== task ||
            assignment.coachId == null
        ) {
            continue;
        }

        const hours = getEffectiveStaffWorkHours(
            team,
            assignment
        );

        if (!Number.isFinite(hours) || hours <= 0) continue;

        const id = String(assignment.coachId);

        hoursByCoach.set(
            id,
            (hoursByCoach.get(id) || 0) + hours
        );
    }

    const assignedCoach = coaches
        .filter(coach => (hoursByCoach.get(String(coach.id)) || 0) > 0)
        .sort((a, b) => {
            const hoursDifference =
                (hoursByCoach.get(String(b.id)) || 0) -
                (hoursByCoach.get(String(a.id)) || 0);

            return hoursDifference ||
                getSkillScore(b) - getSkillScore(a);
        })[0];

    return assignedCoach ||
        getTeamCoachingSpecialist(team, task) ||
        null;
}

function getEffectiveTaskHours(team, task) {
    return (team?.staffWorkPlan?.assignments || []).reduce(
        (total, assignment) => {
            if (assignment?.task !== task) return total;

            return total + getEffectiveStaffWorkHours(
                team,
                assignment
            );
        },
        0
    );
}

const TRAINING_OFFENSE_POSITIONS = new Set([
    'QB', 'RB', 'WR', 'TE', 'OL'
]);

const TRAINING_DEFENSE_POSITIONS = new Set([
    'DL', 'LB', 'DB'
]);

const TRAINING_VALID_POSITIONS = new Set([
    ...TRAINING_OFFENSE_POSITIONS,
    ...TRAINING_DEFENSE_POSITIONS
]);

function getTrainingReportConfidence(team, player) {
    const report = player?.id != null
        ? getTeamScoutingReport(team, player.id)
        : null;

    const rawConfidence = Number(report?.confidence);

    const confidence = Number.isFinite(rawConfidence)
        ? Math.max(
            0,
            Math.min(
                1,
                rawConfidence > 1
                    ? rawConfidence / 100
                    : rawConfidence
            )
        )
        : 0;

    return { report, confidence };
}

function normalizeTrainingPosition(rawPosition) {
    const value = String(rawPosition || '')
        .trim()
        .toUpperCase();

    const positionAliases = {
        OT: 'OL',
        OG: 'OL',
        C: 'OL',
        G: 'OL',
        T: 'OL',
        DE: 'DL',
        DT: 'DL',
        NT: 'DL',
        CB: 'DB',
        S: 'DB',
        FS: 'DB',
        SS: 'DB'
    };

    const position = positionAliases[value] || value;

    return TRAINING_VALID_POSITIONS.has(position)
        ? position
        : null;
}

function getTrainingPlayerPosition(player, team = null) {
    // A player's listed roster position is public information.
    const listedPosition = normalizeTrainingPosition(
        player?.pos ||
        player?.position ||
        player?.Pos
    );

    if (listedPosition) return listedPosition;

    // Preserve full evaluation for the player-controlled organization.
    if (team?.isPlayerControlled) {
        return normalizeTrainingPosition(
            player?.favoriteOffensivePosition ||
            player?.favoriteDefensivePosition ||
            estimateBestPosition(player)
        );
    }

    // AI coaches must use their own scouting evidence for an alternative role.
    const { report, confidence } = getTrainingReportConfidence(
        team,
        player
    );

    if (!report || confidence < 0.50) return null;

    const reportedFits = [
        report.evaluation?.offenseFit,
        report.evaluation?.defenseFit
    ]
        .map(fit => {
            const position = normalizeTrainingPosition(fit?.position);
            const low = Number(fit?.low);
            const high = Number(fit?.high);

            if (
                !position ||
                fit?.low == null ||
                fit?.high == null ||
                !Number.isFinite(low) ||
                !Number.isFinite(high) ||
                high < low
            ) {
                return null;
            }

            return {
                position,
                score: low + ((high - low) / 2) * confidence
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score);

    return reportedFits[0]?.position || null;
}

function getTrainingAttributeScore(player, skill, team = null) {
    // The player-controlled organization can use its full roster information.
    if (team?.isPlayerControlled) {
        const values = Object.values(player?.attributes || {})
            .map(category => category?.[skill])
            .filter(value =>
                typeof value === 'number' &&
                Number.isFinite(value)
            );

        return values.length > 0
            ? values.reduce((sum, value) => sum + value, 0) / values.length
            : 101;
    }

    const { report, confidence } = getTrainingReportConfidence(
        team,
        player
    );

    // No reliable scouting evidence means the AI uses a neutral estimate.
    if (!report || confidence < 0.50) return 50;

    const estimates = Object.values(
        report.attributeRanges || {}
    )
        .map(category => category?.[skill])
        .filter(range =>
            range &&
            Number.isFinite(Number(range.low)) &&
            Number.isFinite(Number(range.high)) &&
            Number(range.high) >= Number(range.low)
        )
        .map(range => {
            const low = Number(range.low);
            const high = Number(range.high);

            return low + ((high - low) / 2) * confidence;
        });

    return estimates.length > 0
        ? estimates.reduce((sum, value) => sum + value, 0) /
            estimates.length
        : 50;
}

function getTrainingOverallScore(player, position, team) {
    if (team?.isPlayerControlled) {
        return calculateOverall(player, position || 'WR');
    }

    const { report, confidence } = getTrainingReportConfidence(
        team,
        player
    );

    if (!report || confidence < 0.50) return 50;

    const fits = [
        report.evaluation?.offenseFit,
        report.evaluation?.defenseFit
    ].filter(fit =>
        fit &&
        (!position ||
            normalizeTrainingPosition(fit.position) === position) &&
        Number.isFinite(Number(fit.low)) &&
        Number.isFinite(Number(fit.high)) &&
        Number(fit.high) >= Number(fit.low)
    );

    if (fits.length === 0) return 50;

    const fit = fits[0];
    const low = Number(fit.low);
    const high = Number(fit.high);

    return low + ((high - low) / 2) * confidence;
}

const DEVELOPMENT_PRIORITY_RANKS = {
    must: 5,
    high: 4,
    normal: 3,
    monitor: 2,
    ignore: 0
};

function getTeamDevelopmentPriority(team, player) {
    const development =
        team?.teamInstructions?.departments?.development || {};

    const playerPriorities = development.playerPriorities || {};
    const positionPriorities = development.positionPriorities || {};

    const playerKey = String(player?.id ?? '');
    const position = getTrainingPlayerPosition(player);

    const hasPlayerPriority =
        Object.prototype.hasOwnProperty.call(
            playerPriorities,
            playerKey
        );

    // Individual player instructions take precedence over
    // the broader position-group instructions.
    const rawPriority = hasPlayerPriority
        ? playerPriorities[playerKey]
        : position
            ? positionPriorities[position]
            : null;

    const level = String(rawPriority || 'normal')
        .toLowerCase()
        .trim();

    const rank =
        DEVELOPMENT_PRIORITY_RANKS[level] ??
        DEVELOPMENT_PRIORITY_RANKS.normal;

    return {
        level: DEVELOPMENT_PRIORITY_RANKS[level] === undefined
            ? 'normal'
            : level,
        rank,
        ignored: rank === 0
    };
}

function getTrainingAssignmentTargetIds(team, assignment) {
    if (
        !team ||
        assignment?.task !== 'training'
    ) {
        return new Set();
    }

    const roster = getRosterObjects(team).filter(player =>
        player?.id != null &&
        player.attributes
    );

    const focus = String(assignment.focus || 'all');

    const candidates = roster
        .filter(player => {
            const position = getTrainingPlayerPosition(player);

            if (focus === 'all') return true;

            if (focus === 'offense') {
                return TRAINING_OFFENSE_POSITIONS.has(position);
            }

            if (focus === 'defense') {
                return TRAINING_DEFENSE_POSITIONS.has(position);
            }

            return position === focus;
        })
        .map(player => ({
            player,
            instructionPriority:
                getTeamDevelopmentPriority(team, player)
        }))
        .filter(candidate =>
            !candidate.instructionPriority.ignored
        );

    const rawMaxTargets = Number(assignment.maxTargets);

    const maxTargets =
        Number.isFinite(rawMaxTargets) && rawMaxTargets > 0
            ? Math.floor(rawMaxTargets)
            : 1;

    const skill = String(assignment.skill || '').trim();

    candidates.sort((a, b) => {
        if (
            a.instructionPriority.rank !==
            b.instructionPriority.rank
        ) {
            return (
                b.instructionPriority.rank -
                a.instructionPriority.rank
            );
        }

        const positionA =
            getTrainingPlayerPosition(a.player) || 'WR';

        const positionB =
            getTrainingPlayerPosition(b.player) || 'WR';

        const scoreA = skill
            ? getTrainingAttributeScore(a.player, skill)
            : calculateOverall(a.player, positionA);

        const scoreB = skill
            ? getTrainingAttributeScore(b.player, skill)
            : calculateOverall(b.player, skill);

        return scoreA - scoreB ||
            String(a.player.id).localeCompare(String(b.player.id));
    });

    return new Set(
        candidates
            .slice(0, maxTargets)
            .map(candidate => String(candidate.player.id))
    );
}

function getStaffWorkOutputFactor(
    effectiveHours,
    minimumFactor = 0.25,
    targetHours = 8
) {
    const hours = Number(effectiveHours);

    const safeHours = Number.isFinite(hours)
        ? Math.max(0, hours)
        : 0;

    return Math.max(
        minimumFactor,
        Math.min(
            1,
            minimumFactor +
                (safeHours / targetHours) * (1 - minimumFactor)
        )
    );
}

const PRACTICE_FIELD_SESSION_LIMITS = {
    community: 2,
    school: 3,
    dedicated: 3
};

const PRACTICE_FIELD_WEEKLY_COSTS = {
    community: 0,
    school: 3,
    dedicated: 8
};

function resolvePracticeFieldAccessForWeek(team, gameLog = null) {
    const gameplan = team?.gameplan;

    if (!gameplan) return 'community';

    const requestedAccess = Object.prototype.hasOwnProperty.call(
        PRACTICE_FIELD_SESSION_LIMITS,
        gameplan.practiceFieldAccess
    )
        ? gameplan.practiceFieldAccess
        : 'community';

    const year = Number(game?.year);
    const weekIndex = Number(game?.currentWeek);

    // currentWeek is zero-based: regular-season weeks are indices 0–8.
    // No field booking fee applies outside those nine game weeks.
    if (
        !Number.isInteger(year) ||
        !Number.isInteger(weekIndex) ||
        weekIndex < 0 ||
        weekIndex >= 9
    ) {
        gameplan.practiceFieldEffectiveAccess = requestedAccess;
        return requestedAccess;
    }

    const seasonWeek = weekIndex + 1;
    const resolutionKey = `${year}:${seasonWeek}`;

    // A repeated weekly resolution must not charge the same booking twice.
    if (gameplan.practiceFieldResolutionKey === resolutionKey) {
        return gameplan.practiceFieldEffectiveAccess || 'community';
    }

    const cost = PRACTICE_FIELD_WEEKLY_COSTS[requestedAccess] ?? 0;
    const balance = Number(team.finances?.balance);

    let effectiveAccess = requestedAccess;

    if (cost > 0) {
        if (
            Number.isFinite(balance) &&
            balance >= cost
        ) {
            team.finances.balance = balance - cost;

            if (
                team.id === game?.playerTeam?.id &&
                Array.isArray(gameLog)
            ) {
                gameLog.push(
                    `🏟️ Field booking: ${requestedAccess} access reserved for $${cost.toFixed(2)} this week.`
                );
            }
        } else {
            effectiveAccess = 'community';

            if (
                team.id === game?.playerTeam?.id &&
                Array.isArray(gameLog)
            ) {
                gameLog.push(
                    `⚠️ Field booking unavailable: insufficient funds for ${requestedAccess} access ($${cost.toFixed(2)}). Using community-field access this week.`
                );
            }
        }
    }

    gameplan.practiceFieldResolutionKey = resolutionKey;
    gameplan.practiceFieldEffectiveAccess = effectiveAccess;

    return effectiveAccess;
}

function getPracticeScheduleSettings(team) {
    const schedule = team?.gameplan?.practiceSchedule || {};

    const requestedAccess =
        team?.gameplan?.practiceFieldEffectiveAccess ??
        team?.gameplan?.practiceFieldAccess;

    const fieldAccess = Object.prototype.hasOwnProperty.call(
        PRACTICE_FIELD_SESSION_LIMITS,
        requestedAccess
    )
        ? requestedAccess
        : 'community';

    const maxSessions =
        PRACTICE_FIELD_SESSION_LIMITS[fieldAccess];

    const requestedSessions = Number(schedule.sessionsPerWeek);
    const sessionsPerWeek = Number.isFinite(requestedSessions)
        ? Math.max(
            1,
            Math.min(maxSessions, Math.round(requestedSessions))
        )
        : 2;

    const requestedMinutes = Number(schedule.minutesPerSession);
    const minutesPerSession = [60, 90, 120].includes(requestedMinutes)
        ? requestedMinutes
        : 90;

    return {
        fieldAccess,
        sessionsPerWeek,
        minutesPerSession,
        weeklyPracticeMinutes: sessionsPerWeek * minutesPerSession
    };
}

function getPracticeScheduleMinutes(team) {
    return getPracticeScheduleSettings(team).weeklyPracticeMinutes;
}

function getPracticeScheduleOutputFactor(team) {
    const weeklyPracticeMinutes = getPracticeScheduleMinutes(team);

    // Two 90-minute sessions are the standard workload.
    // Additional practice has diminishing returns.
    return Math.min(
        1.15,
        0.25 + (weeklyPracticeMinutes / 180) * 0.75
    );
}

function getPracticeScheduleFatigueCost(team) {
    const weeklyPracticeMinutes = getPracticeScheduleMinutes(team);

    // A standard two-session week adds 6 fatigue points during
    // physical practice. Additional volume increases the workload,
    // capped at 12 points for the largest supported schedule.
    return Math.min(
        12,
        Math.max(
            0,
            Math.round((weeklyPracticeMinutes / 180) * 6)
        )
    );
}

export function developPlayer(
    player,
    team = null,
    options = {}
) {
    if (!player || !player.attributes) return { player, improvements: [] };

    const ageAlreadyAdvanced =
        options?.ageAlreadyAdvanced === true;

    const developmentReport = { player, improvements: [] };

    // Keep coach lookups scoped to the team whose player is developing.
    const coaches = Array.isArray(team?.coaches)
        ? team.coaches.filter(coach => coach?.id != null)
        : [];

    const attributesBefore = Object.fromEntries(
        Object.entries(player.attributes).map(([category, attributes]) => [
            category,
            Object.fromEntries(
                Object.entries(attributes || {}).filter(
                    ([, value]) => typeof value === 'number'
                )
            )
        ])
    );
    
    const potentialMultipliers = { 'A': 1.60, 'B': 1.30, 'C': 1.05, 'D': 0.85, 'F': 0.65 };
    const potMod = potentialMultipliers[player.potential] || 1.0;
    const ethic = player.personality?.workEthic || 50;
    const ego = player.personality?.ego || 50;
    const ethicMod = 0.65 + (ethic / 110);

    // Playing time helps skill development, but should not compound
    // the age and depth-chart advantage into runaway attribute growth.
    const snaps = player.careerStats?.snapsThisSeason || 0;
    let experienceMod = 1.0;

    if (snaps >= 250) {
        experienceMod = 1.10; // Full-time starter: modest development bonus
    } else if (snaps >= 100) {
        experienceMod = 1.05; // Rotational contributor: small bonus
    } else if (snaps < 25) {
        experienceMod = 0.90; // Bench player: reduced, not crippled
    }

    const playerTrainingAssignments = [];

    if (team && player.id != null) {
        for (const assignment of team.staffWorkPlan?.assignments || []) {
            if (
                assignment?.task !== 'training' ||
                assignment.coachId == null
            ) {
                continue;
            }

            const hours = getEffectiveStaffWorkHours(
                team,
                assignment
            );

            if (!Number.isFinite(hours) || hours <= 0) {
                continue;
            }

            const targetedPlayerIds = getTrainingAssignmentTargetIds(
                team,
                assignment
            );

            if (!targetedPlayerIds.has(String(player.id))) {
                continue;
            }

            playerTrainingAssignments.push({
                assignment,
                hours
            });
        }
    }

    const effectiveTrainingHours = playerTrainingAssignments.reduce(
        (total, item) => total + item.hours,
        0
    );

    const assignedTrainingCoach = playerTrainingAssignments
        .map(item => ({
            coach: coaches.find(coach =>
                String(coach.id) === String(item.assignment.coachId)
            ),
            hours: item.hours
        }))
        .filter(item => item.coach)
        .sort((a, b) => b.hours - a.hours)[0]?.coach;

    const developmentCoach = assignedTrainingCoach ||
        getTeamCoachingSpecialist(team, 'training');

    // Assigned training hours affect coached attribute development,
    // not natural maturation.
    const trainingOutputFactor = getStaffWorkOutputFactor(
        effectiveTrainingHours,
        0.35
    );

    const coachTeaching =
        developmentCoach?.ratings?.teaching ?? 50;

    const coachDiscipline =
        developmentCoach?.ratings?.practiceDiscipline ?? 50;

    const teachingMod =
        0.85 +
        ((coachTeaching / 100) * 0.25) +
        ((coachDiscipline / 100) * 0.15);

    // =========================================================================
    // 1. IMPACTFUL BIOLOGICAL MATURATION (Closing the Gap to Adult Ceiling)
    // =========================================================================
    // =========================================================================
    // 1. PROFILE-DRIVEN BIOLOGICAL MATURATION
    // Physical, mental, and technical development follow independent,
    // persistent player trajectories instead of one universal growth rate.
    // =========================================================================
    const maturationDomains = [
        'physical',
        'mental',
        'technical'
    ];

    const maturationProfile = player.developmentProfile;

    const hasMaturationProfile = maturationDomains.every(domain => {
        const trajectory = maturationProfile?.[domain];

        return (
            trajectory &&
            Number.isFinite(Number(trajectory.startAge)) &&
            Number.isFinite(Number(trajectory.maturityAge)) &&
            Number(trajectory.maturityAge) > Number(trajectory.startAge) &&
            Number.isFinite(Number(trajectory.startScale)) &&
            Number.isFinite(Number(trajectory.peakScale))
        );
    });

    if (
        player.talentAttributes &&
        player.age >= 8 &&
        player.age <= 18 &&
        hasMaturationProfile
    ) {
        // Youth players are developed before their age increment.
        // Main-league players are developed after their age increment.
        // Both paths must advance the maturation curve by exactly one year.
        const targetAge = ageAlreadyAdvanced
            ? player.age
            : player.age + 1;

        const getPhysicalScaleCap = age => {
            if (age <= 8) return 0.60;
            if (age <= 9) return 0.65;
            if (age <= 10) return 0.72;
            if (age <= 11) return 0.79;
            if (age <= 12) return 0.86;

            return 1.00;
        };

        const getTrajectoryScale = trajectory => {
            const startAge = Number(trajectory.startAge);
            const maturityAge = Number(trajectory.maturityAge);
            const startScale = Number(trajectory.startScale);
            const peakScale = Number(trajectory.peakScale);

            const progress = Math.max(
                0,
                Math.min(
                    1,
                    (targetAge - startAge) /
                        (maturityAge - startAge)
                )
            );

            // Smoothstep gives gradual maturation rather than abrupt jumps.
            const easedProgress =
                progress * progress * (3 - (2 * progress));

            return startScale +
                ((peakScale - startScale) * easedProgress);
        };

        for (const domain of maturationDomains) {
            const currentAttributes = player.attributes?.[domain];
            const talentAttributes = player.talentAttributes?.[domain];
            const trajectory = maturationProfile[domain];

            if (
                !currentAttributes ||
                !talentAttributes ||
                !trajectory
            ) {
                continue;
            }

            let targetScale = getTrajectoryScale(trajectory);

            // Retain the age-based physical maturity limits.
            // In particular, a player entering age 12 cannot have
            // generated physical ratings at 100% of their ceiling.
            if (domain === 'physical') {
                targetScale = Math.min(
                    targetScale,
                    getPhysicalScaleCap(targetAge)
                );
            }

            for (const [attr, currentRaw] of Object.entries(
                currentAttributes
            )) {
                if (attr === 'height' || attr === 'weight') {
                    continue;
                }

                const currentValue = Number(currentRaw);
                const ceilingValue = Number(talentAttributes[attr]);

                if (
                    !Number.isFinite(currentValue) ||
                    !Number.isFinite(ceilingValue)
                ) {
                    continue;
                }

                const targetValue = Math.max(
                    0,
                    Math.min(
                        99,
                        ceilingValue,
                        Math.round(ceilingValue * targetScale)
                    )
                );

                // Maturation never forcibly lowers a trained or
                // naturally exceptional attribute to fit the curve.
                if (targetValue > currentValue) {
                    player.attributes[domain][attr] = targetValue;
                }
            }
        }
    } else if (
        // Backward compatibility for players generated before
        // individual maturation profiles were added.
        player.talentAttributes &&
        player.age >= 12 &&
        player.age <= 18
    ) {
        const youthAgeMultiplier = player.age <= 15 ? 1.35 : 1.0;
        const growthStep =
            0.16 *
            potMod *
            ethicMod *
            teachingMod *
            experienceMod *
            youthAgeMultiplier;

        Object.keys(player.attributes).forEach(cat => {
            if (!player.talentAttributes[cat]) return;

            Object.keys(player.attributes[cat]).forEach(attr => {
                if (attr === 'height' || attr === 'weight') return;

                const currentVal = player.attributes[cat][attr] || 40;
                const ceilingVal =
                    player.talentAttributes[cat][attr] || 70;

                if (ceilingVal > currentVal) {
                    const naturalGain = Math.max(
                        1,
                        Math.round(
                            (ceilingVal - currentVal) * growthStep
                        )
                    );

                    player.attributes[cat][attr] = Math.min(
                        ceilingVal,
                        currentVal + naturalGain
                    );
                }
            });
        });
    }

    // =========================================================================
    // 2. SUMMER BREAKTHROUGH LEAP (Phenom Leap)
    // =========================================================================
    const canBreakthrough = (player.potential === 'A' || player.potential === 'B') && ethic >= 65 && snaps >= 80;
    const hitBreakthrough = canBreakthrough && Math.random() < 0.22;

    if (hitBreakthrough) {
        const sigStat = player.pos === 'QB' ? 'throwingAccuracy' :
            player.pos === 'RB' ? 'speed' :
                player.pos === 'WR' ? 'catchingHands' :
                    player.pos === 'OL' ? 'blocking' :
                        player.pos === 'DL' ? 'blockShedding' :
                            player.pos === 'LB' ? 'tackling' : 'coverage';

        for (const cat of ['technical', 'physical', 'mental']) {
            if (player.attributes[cat]?.[sigStat] !== undefined) {
                player.attributes[cat][sigStat] = Math.min(99, player.attributes[cat][sigStat] + 4);
                developmentReport.improvements.push({ attr: `⭐ SUMMER BREAKTHROUGH (${sigStat})`, increase: 4 });
                break;
            }
        }
    }

    // =========================================================================
    // 3. REALISTIC POSITION TRANSITION DYNAMICS & PHYSICAL ADAPTATION
    // =========================================================================
    let transitionBoost = 0;
    if (player.positionChangedYear && (game.year - player.positionChangedYear) === 1) {
        const currWgt = player.attributes.physical?.weight || 150;
        const ceilingWgt = player.talentAttributes?.physical?.weight || currWgt + 15;
        const currSpd = player.attributes.physical?.speed || 50;
        const currAgi = player.attributes.physical?.agility || 50;
        // Transition Success Score (Ethic + Frame Compatibility + Discipline)
        const frameHeadroom = ceilingWgt - currWgt;
        const dedicationScore =
            (ethic * 0.45) +
            (coachDiscipline * 0.35) +
            (Math.random() * 20);

        const currStr = player.attributes.physical?.strength || 50;
        const isNaturallyBig = currWgt >= 168 && currStr >= 54;
        const isTwitchyAthlete = currSpd >= 68 && currAgi >= 65;

        // A. TRANSITIONING INTO THE TRENCHES (OL / DL)
        if (['OL', 'DL'].includes(player.pos)) {
            // CASE 1: The Naturally Big "Tweener" (e.g. 170 lb WR/TE moving to OL)
            if (isNaturallyBig && frameHeadroom >= 12 && dedicationScore >= 45) {
                const bulkGain = getRandomInt(10, 18);
                player.attributes.physical.weight = currWgt + bulkGain;
                player.attributes.physical.strength = Math.min(99, currStr + 4);
                // Retains rare mobility for an 8v8 pulling lineman!
                player.attributes.technical.blocking = Math.min(99, (player.attributes.technical?.blocking || 40) + 5);
                transitionBoost = 3;
                developmentReport.improvements.push({
                    attr: `🛡️ Athletic Trench Bloom (+${bulkGain} lbs, +4 STR, +5 BLK: Retained Mobility)`,
                    increase: bulkGain
                });
            }
            // CASE 2: Standard Functional Bulk
            else if (frameHeadroom >= 15 && dedicationScore >= 52) {
                const weightGain = getRandomInt(8, 14);
                player.attributes.physical.weight = currWgt + weightGain;
                player.attributes.physical.strength = Math.min(99, currStr + 3);
                transitionBoost = 2;
                developmentReport.improvements.push({ attr: `💪 Functional Trench Bulk (+${weightGain} lbs, +3 STR)`, increase: weightGain });
            }
            // CASE 3: Frame Rejection (True skinny hard-gainer)
            else if (frameHeadroom < 10 || currWgt < 145) {
                developmentReport.improvements.push({ attr: '⚠️ Frame Rejection: Body cannot support interior line mass', increase: 0 });
                if (player.expectations) player.expectations.happiness = Math.max(20, player.expectations.happiness - 10);
            }
            // CASE 4: The Sloppy Bulk
            else {
                const sloppyGain = getRandomInt(6, 12);
                player.attributes.physical.weight = currWgt + sloppyGain;
                player.attributes.physical.speed = Math.max(25, currSpd - 3);
                player.attributes.physical.agility = Math.max(25, currAgi - 3);
                developmentReport.improvements.push({ attr: `🍔 Sloppy Bulk: Gained ${sloppyGain} lbs of unconditioned weight (-3 SPD, -3 AGI)`, increase: -3 });
            }
        }

        // B. THE EDELMAN/TWITCH TRANSITION (QB/RB ➔ WR/DB)
        else if (['WR', 'DB'].includes(player.pos) && isTwitchyAthlete) {
            player.attributes.technical.catchingHands = Math.min(99, (player.attributes.technical?.catchingHands || 40) + 5);
            player.attributes.physical.agility = Math.min(99, currAgi + 3);
            transitionBoost = 3;
            developmentReport.improvements.push({
                attr: '⚡ Twitch Playmaker Transition (+5 HND, +3 AGI: Converted quarterback/runner twitch)',
                increase: 5
            });
        }

        // C. THE BOX ENFORCER (DB ➔ LB)
        else if (player.pos === 'LB' && currWgt >= 165 && (player.attributes.technical?.tackling || 50) >= 50) {
            player.attributes.physical.strength = Math.min(99, currStr + 3);
            player.attributes.technical.tackling = Math.min(99, (player.attributes.technical?.tackling || 50) + 4);
            transitionBoost = 2;
            developmentReport.improvements.push({
                attr: '💥 Hybrid Enforcer Bloom (+4 TKL, +3 STR: Sideline-to-sideline pursuit range)',
                increase: 4
            });
        }

        // B. TRANSITIONING TO BOUNDARY SPEED (WR / DB)
        else if (['WR', 'DB'].includes(player.pos)) {
            if (currWgt <= 185 && dedicationScore >= 45) {
                // SUCCESSFUL LEAN & AGILITY CUT
                player.attributes.physical.agility = Math.min(99, currAgi + 3);
                if (currWgt > 165) player.attributes.physical.weight = currWgt - getRandomInt(4, 8);
                transitionBoost = 2;
                developmentReport.improvements.push({ attr: '⚡ Boundary Footwork Polish (+3 AGI, Leaned Out)', increase: 3 });
            } else if (currWgt > 195) {
                // HEAVY FRAME STRUGGLE: Stiff hips on the boundary
                player.attributes.physical.agility = Math.max(25, currAgi - 2);
                developmentReport.improvements.push({ attr: '⚠️ Heavy Hips: Frame too thick to stick with fast receivers (-2 AGI)', increase: -2 });
                if (player.expectations) player.expectations.happiness = Math.max(20, player.expectations.happiness - 12);
            }
        }

        // C. TEMPORARY INSTALL LEARNING CURVE
        // First year at a new position incurs a minor tactical learning tax (-2 Playbook IQ temporary adjustment)
        if (dedicationScore < 55 && (player.attributes.mental?.playbookIQ || 50) > 40) {
            player.attributes.mental.playbookIQ -= 2;
            developmentReport.improvements.push({ attr: '🧠 Assignment Growing Pains (-2 Playbook IQ)', increase: -2 });
        }
    }

    let mentorBoost = 0;
    if (team && player.age <= 14) {
        const roster = getRosterObjects(team);
        const hasOlderMentor = roster.some(teammate =>
            teammate.age >= 16 &&
            getRelationshipLevel(player.id, teammate.id) >= relationshipLevels.GOOD_FRIEND.level
        );
        if (hasOlderMentor) mentorBoost = 2;
    }

    // Upgraded base points: Kids now gain 5-9 points (age 12-14) or 4-7 points (age 15-18)
    let basePoints = player.age <= 14 ? getRandomInt(5, 8) : getRandomInt(4, 7);

    const pos = player.pos || estimateBestPosition(player);
    let focusGroup = [];
    if (pos === 'QB') focusGroup = ['throwingAccuracy', 'playbookIQ', 'decisionMaking', 'speed', 'consistency'];
    else if (pos === 'RB') focusGroup = ['speed', 'carrying', 'agility', 'playbookIQ', 'strength', 'catchingHands'];
    else if (pos === 'WR') focusGroup = ['speed', 'catchingHands', 'agility', 'playbookIQ'];
    else if (pos === 'TE') focusGroup = ['catchingHands', 'blocking', 'strength', 'toughness'];
    else if (pos === 'OL') focusGroup = ['strength', 'blocking', 'toughness', 'playbookIQ'];
    else if (pos === 'DL') focusGroup = ['strength', 'blockShedding', 'tackling', 'toughness'];
    else if (pos === 'LB') focusGroup = ['tackling', 'playbookIQ', 'speed', 'blockShedding'];
    else if (pos === 'DB') focusGroup = ['speed', 'coverage', 'agility', 'catchingHands', 'playbookIQ'];

        const assignedTrainingSkills = [
        ...new Set(
            playerTrainingAssignments
                .map(item => String(item.assignment.skill || '').trim())
                .filter(skill =>
                    skill &&
                    Object.values(player.attributes || {}).some(
                        category =>
                            typeof category?.[skill] === 'number' &&
                            Number.isFinite(category[skill])
                    )
                )
        )
    ];

    const trainingFocusGroup = assignedTrainingSkills.length > 0
        ? assignedTrainingSkills
        : focusGroup;

    let totalUpgradePoints = Math.round(
        basePoints * experienceMod * trainingOutputFactor
    ) + mentorBoost + transitionBoost;

    // Slacker Stagnation / Regression: Low work-ethic teens (16-18) with high ego can regress
    if (ethic < 35 && ego > 70 && player.age >= 16 && Math.random() < 0.40) {
        const regressedAttr = getRandom(['speed', 'stamina', 'agility']);
        for (const cat in player.attributes) {
            if (player.attributes[cat]?.[regressedAttr] && player.attributes[cat][regressedAttr] > 40) {
                player.attributes[cat][regressedAttr] -= 2;
                developmentReport.improvements.push({ attr: `${regressedAttr} (Slacked Off)`, increase: -2 });
                break;
            }
        }
        totalUpgradePoints = Math.max(0, totalUpgradePoints - 3);
    }

    for (let i = 0; i < totalUpgradePoints; i++) {
        const pool = trainingFocusGroup.length > 0
            ? trainingFocusGroup
            : ['speed', 'strength', 'agility'];
        const attrToBoost = getRandom(pool);

        for (const category in player.attributes) {
            if (player.attributes[category]?.[attrToBoost] !== undefined && player.attributes[category][attrToBoost] < 99) {
                player.attributes[category][attrToBoost] = Math.min(99, player.attributes[category][attrToBoost] + 1);
                const existing = developmentReport.improvements.find(imp => imp.attr === attrToBoost);
                if (existing) existing.increase += 1;
                else developmentReport.improvements.push({ attr: attrToBoost, increase: 1 });
                break;
            }
        }
    }

    // =========================================================================
    // 3. FRAME MATURATION & GROWTH SPURTS (Height & Weight)
    // =========================================================================
    if (!player.attributes.physical) player.attributes.physical = {};
    const currHgt = player.attributes.physical.height || 66;
    const currWgt = player.attributes.physical.weight || 140;
    const ceilingHgt = player.talentAttributes?.physical?.height || currHgt + 4;
    const ceilingWgt = player.talentAttributes?.physical?.weight || currWgt + 30;

    let heightGain = 0;
    let weightGain = 0;

    // 6% chance for a massive Growth Spurt between ages 13 and 16
    const hitGrowthSpurt = player.age >= 13 && player.age <= 16 && Math.random() < 0.06;

    if (hitGrowthSpurt) {
        heightGain = getRandomInt(3, 5);
        weightGain = getRandomInt(18, 32);

        // Growth spurt benefits Strength, but causes temporary growing pains on agility
        if (player.attributes.physical.strength) player.attributes.physical.strength = Math.min(99, player.attributes.physical.strength + 3);
        if (player.attributes.physical.agility && player.attributes.physical.agility > 30) player.attributes.physical.agility -= 1;

        developmentReport.improvements.push({ attr: '🚀 GROWTH SPURT!', increase: heightGain });
        if (team && team.id === game?.playerTeam?.id) {
            addMessage("Growth Spurt!", `📈 <b>${player.name}</b> hit a massive growth spurt over the summer! Gained +${heightGain}" and +${weightGain} lbs!`);
        }
    } else if (player.age <= 17) {
        // Natural annual frame closure toward adult ceiling
        if (ceilingHgt > currHgt) heightGain = Math.min(ceilingHgt - currHgt, getRandomInt(1, 2));
        if (ceilingWgt > currWgt) weightGain = Math.min(ceilingWgt - currWgt, getRandomInt(6, 14));
    }

    if (heightGain > 0) {
        player.attributes.physical.height = currHgt + heightGain;
        if (!hitGrowthSpurt) developmentReport.improvements.push({ attr: 'height', increase: heightGain });
    }
    if (weightGain > 0) {
        player.attributes.physical.weight = currWgt + weightGain;
        if (!hitGrowthSpurt) developmentReport.improvements.push({ attr: 'weight', increase: weightGain });
    }

    if (!player.careerStats) player.careerStats = {};
    player.careerStats.snapsThisSeason = 0;

    developmentReport.actualAttributeChanges = [];

    Object.entries(player.attributes).forEach(([category, attributes]) => {
        Object.entries(attributes || {}).forEach(([attr, after]) => {
            const before = attributesBefore[category]?.[attr];

            if (
                typeof before !== 'number' ||
                typeof after !== 'number' ||
                before === after
            ) {
                return;
            }

            developmentReport.actualAttributeChanges.push({
                category,
                attr,
                before,
                after,
                increase: after - before
            });
        });
    });

    return developmentReport;
}

export function processWeeklyPractice(team, gameLog = null) {
    if (!team || !team.gameplan) return;

    // Resolve field access before calculating the week's practice volume.
    // This also prevents duplicate field charges for the same week.
    resolvePracticeFieldAccessForWeek(team, gameLog);

    const coaches = Array.isArray(team.coaches)
        ? team.coaches.filter(coach => coach?.id != null)
        : [];

    const trainingHours = new Map();

    for (const assignment of team.staffWorkPlan?.assignments || []) {
        if (
            assignment?.task !== 'training' ||
            assignment.coachId == null
        ) {
            continue;
        }

        const hours = getEffectiveStaffWorkHours(
            team,
            assignment
        );

        if (!Number.isFinite(hours) || hours <= 0) continue;

        const coachId = String(assignment.coachId);

        trainingHours.set(
            coachId,
            (trainingHours.get(coachId) || 0) + hours
        );
    }

    const getTrainingSkill = coach => {
        const ratings = coach?.ratings || {};

        const values = [
            ratings.teaching,
            ratings.practiceDiscipline,
            ratings.conditioning
        ].map(value => {
            const number = Number(value);
            return Number.isFinite(number) ? number : 50;
        });

        return values.reduce((sum, value) => sum + value, 0) /
            values.length;
    };

    const assignedTrainingCoach = coaches
        .filter(coach => (trainingHours.get(String(coach.id)) || 0) > 0)
        .sort((a, b) => {
            const hoursDifference =
                (trainingHours.get(String(b.id)) || 0) -
                (trainingHours.get(String(a.id)) || 0);

            return hoursDifference ||
                getTrainingSkill(b) - getTrainingSkill(a);
        })[0];

    const coach = assignedTrainingCoach ||
        getTeamCoachingSpecialist(team, 'training');

    // Team practice output comes from scheduled practice time.
    // Staff assignment hours still determine which coach leads this focus
    // and continue to govern individual training in the staff resolver.
    const trainingOutputFactor = getPracticeScheduleOutputFactor(team);

    const discipline = coach?.ratings?.practiceDiscipline ?? 50;
    const teaching = coach?.ratings?.teaching ?? 50;
    const mastery = team.gameplan.mastery = team.gameplan.mastery || {};
    const plan = team.gameplan.weeklyPractice || 'chalk_talk';
    const roster = getRosterObjects(team);

    // Players already marked unavailable this week cannot take part
    // in player-specific practice drills.
    const availablePracticeRoster = roster.filter(
        player => !(Number(player.status?.duration) > 0)
    );

    // Calculate physical workload once so conditioning and scrimmage
    // use the same schedule assumptions.
    const practiceFatigueCost = getPracticeScheduleFatigueCost(team);

    // Chalk talks and opponent scouting are less physically demanding
    // than conditioning. They still carry a small workload cost as
    // sessions get longer, so extra scheduled time is never entirely free.
    if (plan === 'chalk_talk' || plan === 'scouting') {
        const focusFatigueMultiplier = plan === 'chalk_talk'
            ? 0.25
            : 0.15;

        const lightPracticeFatigueCost = Math.max(
            1,
            Math.round(
                practiceFatigueCost * focusFatigueMultiplier
            )
        );

        availablePracticeRoster.forEach(player => {
            player.fatigue = Math.min(
                100,
                Math.max(0, Number(player.fatigue) || 0) +
                    lightPracticeFatigueCost
            );
        });
    }

    // 1. FAMILIARITY DECAY: Uninstalled plays fade from memory (-4% per week down to 25% floor)
    const activeInstalled = new Set([
        'Uni_InsideZone', 'Uni_QuickSlants', 'Uni_FourVerts',
        'Cover_2_Zone_Base', 'Cover_1_Robber', 'GoalLine_RunStuff',
        ...(team.gameplan.installedOffense || []),
        ...(team.gameplan.installedDefense || [])
    ]);

    // Discipline cuts decay in half
    const decayRate = discipline > 65 ? 2 : 4;
    Object.keys(mastery).forEach(key => {
        if (!activeInstalled.has(key) && mastery[key] > 25) {
            mastery[key] = Math.max(25, mastery[key] - decayRate);
        }
    });

    // 1B. STAFF GAMEPLAN PREPARATION
    // Effective offensive/defensive prep hours build familiarity with
    // the specific plays assigned to each staff member.
    let totalPreparationMasteryGain = 0;

    const preparationAssignments = (
        team.staffWorkPlan?.assignments || []
    ).filter(assignment =>
        ['offensePrep', 'defensePrep'].includes(assignment?.task)
    );

    for (const assignment of preparationAssignments) {
        const effectiveHours = getEffectiveStaffWorkHours(
            team,
            assignment
        );

        if (!Number.isFinite(effectiveHours) || effectiveHours <= 0) {
            continue;
        }

        const isOffense = assignment.task === 'offensePrep';

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
            ? (team.gameplan.installedOffense || [])
            : (team.gameplan.installedDefense || []);

        const allowedKeys = new Set([
            ...foundationKeys,
            ...installedKeys
        ]);

        // An explicit empty selection means the assignment has no target
        // plays. If no selection has been saved, use its available plays.
        const requestedKeys = Array.isArray(assignment.playKeys)
            ? assignment.playKeys
            : [...allowedKeys];

        const targetedKeys = [
            ...new Set(requestedKeys.filter(key => allowedKeys.has(key)))
        ];

        if (targetedKeys.length === 0) continue;

        const assignedCoach = coaches.find(
            coach =>
                String(coach.id) === String(assignment.coachId)
        );

        const skillKeys = isOffense
            ? [
                'offSchemeMastery',
                'gameplanInstinct',
                'inGameAdjustments'
            ]
            : [
                'defSchemeMastery',
                'gameplanInstinct',
                'inGameAdjustments'
            ];

        const ratings = assignedCoach?.ratings || {};

        const skillScore = skillKeys.reduce((sum, key) => {
            const value = Number(ratings[key]);

            return sum + (
                Number.isFinite(value)
                    ? Math.max(0, Math.min(100, value))
                    : 50
            );
        }, 0) / skillKeys.length;

        // Stronger preparation coaches get more value from the same hours.
        const skillFactor = 0.70 + (skillScore / 250);
        const effectiveHoursPerPlay =
            effectiveHours / targetedKeys.length;

        // Four effective hours per play is the full weekly prep target.
        const hoursFactor = Math.min(
            1,
            effectiveHoursPerPlay / 4
        );

        const masteryGain = Math.round(
            5 * hoursFactor * skillFactor
        );

        if (masteryGain <= 0) continue;

        for (const playKey of targetedKeys) {
            const previousMastery = Number(mastery[playKey]);

            mastery[playKey] = Math.min(
                100,
                (Number.isFinite(previousMastery)
                    ? previousMastery
                    : 35) + masteryGain
            );

            totalPreparationMasteryGain += masteryGain;
        }
    }

    if (
        totalPreparationMasteryGain > 0 &&
        team.id === game?.playerTeam?.id &&
        gameLog
    ) {
        gameLog.push(
            `📚 Staff Prep: Offensive and defensive preparation added ` +
            `${totalPreparationMasteryGain} total playbook mastery points.`
        );
    }

    // 2. DRILL EXECUTION
    const disciplineBonus = Math.round((discipline - 50) / 10); // -2 to +4 bonus

    if (plan === 'chalk_talk') {
        const rawInstallGains = Math.max(
            10,
            Math.round(12 + (teaching / 10) + disciplineBonus)
        );

        const installGains = Math.max(
            3,
            Math.round(rawInstallGains * trainingOutputFactor)
        );
        activeInstalled.forEach(key => {
            mastery[key] = Math.min(100, (mastery[key] || 35) + installGains);
        });

        // Youth IQ mentorship
        availablePracticeRoster.forEach(p => {
            if (
                p.age <= 15 &&
                Math.random() < 0.25 * trainingOutputFactor &&
                (p.attributes?.mental?.playbookIQ || 50) < 95
            ) {
                p.attributes.mental.playbookIQ += 1;
            }
        });
        if (team.id === game?.playerTeam?.id && gameLog) {
            gameLog.push(`📋 Chalk Talk: Kids studied napkin schemes (+${installGains}% mastery). IQ reps gained!`);
        }
    } else if (plan === 'conditioning') {
        const condGainChance = (
            0.15 + (coach?.ratings?.conditioning || 50) / 300
        ) * trainingOutputFactor;
        availablePracticeRoster.forEach(p => {
            // Conditioning improves fitness, but it also tires players.
            p.fatigue = Math.min(
                100,
                Math.max(0, Number(p.fatigue) || 0) +
                    practiceFatigueCost
            );

            if (Math.random() < condGainChance && (p.attributes?.physical?.stamina || 50) < 95) {
                p.attributes.physical.stamina += 1;
            }
            if (
                Math.random() < 0.12 * trainingOutputFactor &&
                (p.attributes?.mental?.toughness || 50) < 95
            ) {
                p.attributes.mental.toughness += 1;
            }
        });
        if (team.id === game?.playerTeam?.id && gameLog) {
            gameLog.push("🏃 Tire Drills: Sprints in full sun toughened up fourth-quarter stamina!");
        }
    } else if (plan === 'scrimmage') {
        availablePracticeRoster.forEach(p => {
            // A standard scrimmage includes breaks and cooldown.
            // Longer schedules consume more energy and can erase
            // that recovery benefit.
            p.fatigue = Math.min(
                100,
                Math.max(
                    0,
                    (Number(p.fatigue) || 0) +
                        practiceFatigueCost -
                        Math.round(8 * trainingOutputFactor)
                )
            );

            if (
                Math.random() < 0.18 * trainingOutputFactor &&
                (p.attributes?.technical?.catchingHands || 50) < 95
            ) {
                p.attributes.technical.catchingHands += 1;
            }
            if (
                Math.random() < 0.18 * trainingOutputFactor &&
                (p.attributes?.technical?.tackling || 50) < 95
            ) {
                p.attributes.technical.tackling += 1;
            }
        });
        if (team.id === game?.playerTeam?.id && gameLog) {
            gameLog.push("🧃 Sandlot Scrimmage: Two-hand touch & freeze pops healed fatigue and built hands!");
        }
    } else if (plan === 'scouting') {
        team.scoutingBoostActive = true;
        if (team.id === game?.playerTeam?.id && gameLog) {
            gameLog.push("🕵️ Recess Recon: Spied on next opponent's favorite plays. Defensive boost active!");
        }
    } else if (plan === 'hustle') {
        // === THE HUSTLE: MOWING LAWNS & WASHING CARS ===
        let workersCount = 0;
        let skippedWorkers = [];
        const coachAuth = coach?.ratings?.authority || 50;

        roster.forEach(p => {
            const ego = p.personality?.ego || 50;
            const ethic = p.personality?.workEthic || 50;
            const age = p.age || 14;

            // Compliance Check: Divas & older teens with cars resist manual labor
            // Coach authority reduces the chance of skipping
            const divaResistance = (ego > 70 ? (ego - 60) * 0.012 : 0) + (age >= 17 ? 0.20 : 0);
            const coachFear = (coachAuth / 200);
            const skipChance = Math.max(0, Math.min(0.75, divaResistance - (ethic * 0.005) - coachFear));

            if (Math.random() < skipChance) {
                skippedWorkers.push(p.name.split(' ')[0]);
                // Resentment: skipping chore day harms reputation with teammates
                if (p.expectations) p.expectations.happiness = Math.max(10, (p.expectations.happiness || 100) - 12);
            } else {
                workersCount++;
                // Grinders build grit through labor
                if (ethic >= 70 && Math.random() < 0.15 && (p.attributes?.mental?.toughness || 50) < 95) {
                    p.attributes.mental.toughness += 1;
                }
                // Modest happiness drop for regular kids who'd rather play ball
                if (ethic < 60 && p.expectations) {
                    p.expectations.happiness = Math.max(20, (p.expectations.happiness || 100) - 4);
                }
            }
        });

        // Dynamic cash yield: Each working player earns $0.85 to $1.15
        const cashEarned = Number((workersCount * (0.85 + Math.random() * 0.30)).toFixed(2));
        if (!team.finances) team.finances = { balance: 0, waivedDues: [] };
        team.finances.balance += cashEarned;


        recordFinanceLedgerEntry(
            team,
            game,
            'hustle',
            'Neighborhood Hustle Income',
            cashEarned
        );

        // Scheme rust penalty: No football was practiced this week (-4% familiarity)
        Object.keys(mastery).forEach(key => {
            if (mastery[key] > 30) mastery[key] = Math.max(30, mastery[key] - 4);
        });

        if (team.id === game?.playerTeam?.id && gameLog) {
            const skipMsg = skippedWorkers.length > 0 ? ` (Boycotted by: ${skippedWorkers.slice(0, 3).join(', ')})` : '';
            gameLog.push(`🧹 Neighborhood Hustle: ${workersCount}/${roster.length} kids washed cars and mowed lawns, raising $${cashEarned.toFixed(2)}${skipMsg}. Schemes suffered slight rust (-4% mastery).`);
        }
    }
}


/**
 * Ages coaching staff once per completed season and archives retirees.
 *
 * The archive preserves career history without retaining the full coach
 * profile, ratings, development records, or negotiation data.
 */
function processCoachCareerRetirement(
    gameState,
    completedSeasonYear,
    random = Math.random
) {
    if (
        !gameState ||
        !Array.isArray(gameState.teams) ||
        !Number.isInteger(Number(completedSeasonYear))
    ) {
        return [];
    }

    const seasonYear = Number(completedSeasonYear);

    const teams = [...gameState.teams];

    if (
        gameState.playerTeam &&
        !teams.some(team =>
            String(team.id) === String(gameState.playerTeam.id)
        )
    ) {
        teams.push(gameState.playerTeam);
    }

    // Prefer active team objects over potentially stale market copies.
    const candidatesById = new Map();

    const registerCoach = (coach, team = null) => {
        if (
            !coach ||
            coach.id == null ||
            coach.isUserCoach
        ) {
            return;
        }

        const id = String(coach.id);
        const existing = candidatesById.get(id);

        if (!existing || (!existing.team && team)) {
            candidatesById.set(id, { coach, team });
        }
    };

    for (const team of teams) {
        if (!team) continue;

        (Array.isArray(team.coaches) ? team.coaches : [])
            .forEach(coach => registerCoach(coach, team));

        registerCoach(team.coach, team);
        registerCoach(team.staff?.coach, team);
        registerCoach(team.staff?.scout, team);
        registerCoach(team.staff?.trainer, team);
    }

    (Array.isArray(gameState.availableStaff)
        ? gameState.availableStaff
        : []
    ).forEach(coach => registerCoach(coach));

    if (!Array.isArray(gameState.coachCareerArchive)) {
        gameState.coachCareerArchive = [];
    }

    const retiredIds = new Set();
    const retirements = [];

    for (const [id, record] of candidatesById) {
        const { coach, team } = record;

        // Each coach ages once per completed season, even if this
        // lifecycle function is accidentally invoked again.
        if (Number(coach.lastCareerAgedYear) !== seasonYear) {
            const rawAge = Number(coach.age);

            const currentAge =
                Number.isFinite(rawAge) && rawAge >= 18
                    ? Math.floor(rawAge)
                    : 45;

            coach.age = currentAge + 1;
            coach.lastCareerAgedYear = seasonYear;
        }

        const age = Math.max(18, Math.floor(Number(coach.age) || 45));

        if (age < 60) continue;

        const weeksUnemployed = Math.max(
            0,
            Number(coach.weeksUnemployed) || 0
        );

        // Retirement becomes increasingly likely with age.
        // Long-term unemployment contributes a modest additional risk.
        const unemploymentPressure = Math.min(
            0.06,
            (weeksUnemployed / 52) * 0.015
        );

        const retirementChance = age >= 75
            ? 1
            : Math.min(
                0.45,
                0.01 + (age - 60) * 0.03 + unemploymentPressure
            );

        if (random() >= retirementChance) continue;

        const careerHistory = Array.isArray(coach.careerHistory)
            ? coach.careerHistory
                .filter(entry =>
                    entry && typeof entry === 'object'
                )
                .map(entry => ({
                    ...entry,
                    milestones: Array.isArray(entry.milestones)
                        ? [...entry.milestones]
                        : []
                }))
            : [];

        const archiveEntry = {
            id: coach.id,
            name: coach.name || 'Unnamed Coach',
            retiredYear: seasonYear,
            retiredAge: age,
            retirementReason: age >= 75
                ? 'maximum_age'
                : weeksUnemployed >= 104
                    ? 'age_and_long_unemployment'
                    : 'age',
            lastTeamName:
                team?.name ||
                careerHistory[careerHistory.length - 1]?.teamName ||
                null,
            careerHistory
        };

        // Replace an existing archive entry rather than creating duplicates.
        const existingArchiveIndex =
            gameState.coachCareerArchive.findIndex(entry =>
                String(entry?.id) === id
            );

        if (existingArchiveIndex >= 0) {
            gameState.coachCareerArchive[existingArchiveIndex] =
                archiveEntry;
        } else {
            gameState.coachCareerArchive.push(archiveEntry);
        }

        coach.teamId = null;
        retiredIds.add(id);

        retirements.push({
            coachId: coach.id,
            coachName: archiveEntry.name,
            teamId: team?.id ?? null,
            teamName: archiveEntry.lastTeamName,
            age,
            retiredYear: seasonYear
        });
    }

    if (retiredIds.size === 0) {
        return retirements;
    }

    // Permanently remove retirees from the active staff market.
    gameState.availableStaff = (
        Array.isArray(gameState.availableStaff)
            ? gameState.availableStaff
            : []
    ).filter(coach =>
        coach?.id == null ||
        !retiredIds.has(String(coach.id))
    );

    // Remove retired coaches from active teams and legacy references.
    for (const team of teams) {
        if (!team) continue;

        const teamHasRetiree = [
            ...(Array.isArray(team.coaches) ? team.coaches : []),
            team.coach,
            team.staff?.coach,
            team.staff?.scout,
            team.staff?.trainer
        ].some(coach =>
            coach?.id != null &&
            retiredIds.has(String(coach.id))
        );

        if (!teamHasRetiree) continue;

        team.coaches = (
            Array.isArray(team.coaches) ? team.coaches : []
        ).filter(coach =>
            coach?.id == null ||
            !retiredIds.has(String(coach.id))
        );

        if (!team.staff || typeof team.staff !== 'object') {
            team.staff = {};
        }

        for (const role of ['coach', 'scout', 'trainer']) {
            if (
                team.staff[role]?.id != null &&
                retiredIds.has(String(team.staff[role].id))
            ) {
                team.staff[role] = null;
            }
        }

        if (
            team.coach?.id != null &&
            retiredIds.has(String(team.coach.id))
        ) {
            team.coach = null;
        }

        const assignments = team.staffWorkPlan?.assignments;

        if (Array.isArray(assignments)) {
            team.staffWorkPlan.assignments = assignments.filter(
                assignment =>
                    !retiredIds.has(String(assignment?.coachId ?? ''))
            );
        }

        const activeNpcCount = team.coaches.filter(coach =>
            coach?.id != null && !coach.isUserCoach
        ).length;

        team.coachingVacancies = Math.max(
            0,
            Math.min(3, 3 - activeNpcCount)
        );

    }

    return retirements;
}


export function advanceToOffseason() {
    if (!game || !game.teams || !game.players) {
        return {
            retiredPlayers: [],
            hofInductees: [],
            developmentResults: [],
            leavingPlayers: [],
            pendingRetentions: [],
            staffDepartures: [],
            staffHappinessChanges: []
        };
    }

    // The season rollover is only valid after all nine weeks have completed.
    // This protects aging, development, departures, and other lifecycle work
    // from being triggered by an accidental early call.
    const completedWeekCount = Number(game.currentWeek);

    if (
        !Number.isFinite(completedWeekCount) ||
        completedWeekCount < 9
    ) {
        console.warn(
            '[Offseason] Rollover blocked: the regular season is not complete.',
            {
                year: game.year,
                currentWeek: game.currentWeek
            }
        );

        return {
            retiredPlayers: [],
            hofInductees: [],
            developmentResults: [],
            leavingPlayers: [],
            pendingRetentions: [],
            staffDepartures: [],
            staffHappinessChanges: []
        };
    }

    // Prevent an immediately repeated call from processing the same completed
    // offseason again. A new season must show activity before this can run again.
    const lastCompletedOffseasonYear = Number(game._offseasonCompletedYear);

    const seasonHasActivity =
        (Array.isArray(game.gameResults) && game.gameResults.length > 0) ||
        game.teams.some(team =>
            (Number(team.wins) || 0) > 0 ||
            (Number(team.losses) || 0) > 0 ||
            (Number(team.ties) || 0) > 0
        );

    if (
        Number.isFinite(lastCompletedOffseasonYear) &&
        lastCompletedOffseasonYear === Number(game.year) - 1 &&
        !seasonHasActivity
    ) {
        console.warn(
            `[Offseason] Ignored duplicate processing for completed Year ${lastCompletedOffseasonYear}.`
        );

        return {
            retiredPlayers: [],
            hofInductees: [],
            developmentResults: [],
            leavingPlayers: [],
            pendingRetentions: [],
            staffDepartures: [],
            staffHappinessChanges: []
        };
    }

    // Prevent an interrupted rollover from running again against partially
    // modified player, team, staff, and draft data.
    const rolloverYear = Number(game.year);

    const inProgressYear = Number(game._offseasonInProgressYear);

    if (
        Number.isFinite(inProgressYear) &&
        (
            inProgressYear === rolloverYear ||
            inProgressYear === rolloverYear - 1
        )
    ) {
        console.error(
            `[Offseason] Year ${rolloverYear} has an unfinished rollover. ` +
            'Reload the last saved game before attempting the rollover again.'
        );

        return {
            retiredPlayers: [],
            hofInductees: [],
            developmentResults: [],
            leavingPlayers: [],
            pendingRetentions: [],
            staffDepartures: [],
            staffHappinessChanges: [],
            interrupted: true
        };
    }
    game._offseasonInProgressYear = Number(game.year);

    // Initialize tracking arrays at the top so any offseason phase can safely push to them
    const retiredPlayers = [];
    const hofInductees = [];
    const developmentResults = [];
    const leavingPlayers = [];
    const pendingRetentions = [];
    const pendingRetentionIds = new Set();
    const staffDepartures = [];
    const staffHappinessChanges = [];

    // Mark this season as actively processing before any lifecycle mutations.
    // If an exception interrupts the function, a second call cannot repeat
    // the same season's aging, development, departures, or draft preparation.
    game.pendingRetentions = pendingRetentions;

    let totalVacancies = 0;

    // CAPTURE STANDINGS & HISTORY BEFORE RESETTING STATS
    const tier1 = game.teams.filter(t => t.tier === 1).sort((a, b) => (b.wins || 0) - (a.wins || 0) || (a.losses || 0) - (b.losses || 0));
    const tier2 = game.teams.filter(t => t.tier === 2).sort((a, b) => (b.wins || 0) - (a.wins || 0) || (a.losses || 0) - (b.losses || 0));
    const youthT = game.teams.filter(t => t.leagueType === 'youth').sort((a, b) => (b.wins || 0) - (a.wins || 0) || (a.losses || 0) - (b.losses || 0));

    // Preserve last season's youth standings before team records are reset.
    // Pee Wee draft order runs from worst-performing team to best-performing team.
    const youthDraftOrder = [...youthT].reverse();

    const relegated = tier1.slice(-2);
    const promoted = tier2.slice(0, 2);

    const promotionRelegationApplied =
        tier1.length > 2 &&
        tier2.length > 2;

    // Capture reverse standings for next draft before wins/losses reset
    const mainTeams = game.teams.filter(t => t.leagueType === 'main');
    game.nextDraftOrder = [...mainTeams].sort((a, b) =>
        (a.wins || 0) - (b.wins || 0) || (b.losses || 0) - (a.losses || 0)
    ).map(t => t.id);

    let proRelMsg = "League Tiers hold steady this year.";
    if (promotionRelegationApplied) {
        relegated.forEach(t => { t.tier = 2; t.socialProfile.streetCred -= 20; });
        promoted.forEach(t => { t.tier = 1; t.socialProfile.streetCred += 20; });
        proRelMsg = `**PROMOTED:** ${promoted[0].name}, ${promoted[1].name}\n**RELEGATED:** ${relegated[0].name}, ${relegated[1].name}`;

        if (relegated.some(t => t.id === game.playerTeam?.id)) {
            addMessage("Relegated!", "We finished at the bottom of the league and have been relegated to the Sandlot Circuit (Tier 2). We must fight our way back up!", false, game);
        } else if (promoted.some(t => t.id === game.playerTeam?.id)) {
            addMessage("Promoted!", "We won the Sandlot Circuit! Next year we play with the big dogs in Tier 1.", false, game);
        }

        // Relegation Walkouts: Divas with low loyalty refuse to play in Tier 2.
        // User-controlled teams get an exit interview rather than an immediate departure.
        relegated.forEach(relTeam => {
            const teamRoster = getRosterObjects(relTeam);

            teamRoster.forEach(p => {
                if (
                    (p.personality?.streetCred || 50) <= 65 ||
                    (p.personality?.loyalty || 50) >= 45
                ) {
                    return;
                }

                // Age-18 seniors are retiring in the lifecycle pass below.
                // Leave them attached so retirement and player history are processed normally.
                if (p.age >= 18) return;

                const isUserTeam =
                    relTeam.id === game.playerTeam?.id;

                const reason = 'Refused to play in Sandlot Circuit (Tier 2)';

                // Resolve due promises before allowing an exit interview.
                const retentionCheck = evaluatePlayerRetention(
                    p,
                    relTeam,
                    p.careerStats?.snapsThisSeason || 0
                );

                if (retentionCheck.permanentDeparture) {
                    // Do not queue an interview. Keep the player attached so
                    // the normal lifecycle records the permanent departure.
                    return;
                }

                if (isUserTeam && game.year >= 5) {
                    if (!pendingRetentionIds.has(p.id)) {
                        pendingRetentions.push({
                            player: p,
                            playerId: p.id,
                            reason,
                            snapsThisSeason: p.careerStats?.snapsThisSeason || 0,
                            teamWins: relTeam.wins || 0,
                            teamLosses: relTeam.losses || 0
                        });

                        pendingRetentionIds.add(p.id);
                    }

                    // Keep player.teamId intact until the exit interview resolves.
                    return;
                }

                leavingPlayers.push({
                    player: p,
                    reason,
                    teamName: relTeam.name
                });

                p.teamId = null;

                if (isUserTeam) {
                    addMessage(
                        "Relegation Walkout",
                        `🏃 ${p.name} refused to play in Tier 2 and walked away to Free Agency!`
                    );
                }
            });
        });
    }

    if (!game.history) game.history = { seasons: [] };
    // Only push if this year hasn't already been pushed by historical simulation
    if (!game.history.seasons.some(s => s.year === game.year)) {
        const allPlayers = game.players || [];
        const topPasser = [...allPlayers].sort((a, b) => (b.seasonStats?.passYards || 0) - (a.seasonStats?.passYards || 0))[0];
        const topRusher = [...allPlayers].sort((a, b) => (b.seasonStats?.rushYards || 0) - (a.seasonStats?.rushYards || 0))[0];
        const topTackler = [...allPlayers].sort((a, b) => (b.seasonStats?.tackles || 0) - (a.seasonStats?.tackles || 0))[0];

        game.history.seasons.push({
            year: game.year,
            champion: tier1[0]?.name || "Unknown",
            runnerUp: tier1[1]?.name || "Unknown",
            tier2Champion: tier2[0]?.name || "Unknown",
            youthChampion: youthT[0]?.name || "Unknown",
            leaders: {
                passer: topPasser && (topPasser.seasonStats?.passYards || 0) > 0 ? `${topPasser.name} (${topPasser.seasonStats.passYards} yds)` : 'None',
                rusher: topRusher && (topRusher.seasonStats?.rushYards || 0) > 0 ? `${topRusher.name} (${topRusher.seasonStats.rushYards} yds)` : 'None',
                tackler: topTackler && (topTackler.seasonStats?.tackles || 0) > 0 ? `${topTackler.name} (${topTackler.seasonStats.tackles} tkls)` : 'None'
            },
            promoted: promoted.map(t => t.name),
            relegated: relegated.map(t => t.name),
            standings: [
                ...tier1.map(t => ({
                    id: t.id,
                    name: t.name,
                    wins: t.wins,
                    losses: t.losses,
                    ties: t.ties || 0,
                    tier: 1
                })),
                ...tier2.map(t => ({
                    id: t.id,
                    name: t.name,
                    wins: t.wins,
                    losses: t.losses,
                    ties: t.ties || 0,
                    tier: 2
                }))
            ],
            draftResults: []
        });
    }

    // Historical simulation may already have created the season row.
    // Attach a snapshot when one is missing, but never replace an archive
    // that has already been captured for this season.
    const completedSeasonEntry = game.history.seasons.find(
        season => Number(season?.year) === Number(game.year)
    );

    if (
        completedSeasonEntry &&
        !completedSeasonEntry.reportSnapshot
    ) {
        completedSeasonEntry.reportSnapshot = buildSeasonReportSnapshot(
            game,
            game.year,
            tier1,
            tier2,
            youthT
        );
    }

    // Preserve the season being completed before advancing to the next year.
    const completedSeasonYear = game.year;

    // Resolve coach retention and record career achievements before
    // win/loss records are reset.
    game.teams.forEach(team => {
        if (!team) return;

        const teamId = String(team.id);
        const careerMilestones = [];

        if (
            tier1[0] &&
            String(tier1[0].id) === teamId
        ) {
            careerMilestones.push('Premier Champion');
        }

        if (
            tier2[0] &&
            String(tier2[0].id) === teamId
        ) {
            careerMilestones.push('Sandlot Champion');
        }

        if (
            youthT[0] &&
            String(youthT[0].id) === teamId
        ) {
            careerMilestones.push('Youth Champion');
        }

        if (
            promotionRelegationApplied &&
            promoted.some(
                candidate => String(candidate.id) === teamId
            )
        ) {
            careerMilestones.push('Promoted to Premier');
        }

        if (
            promotionRelegationApplied &&
            relegated.some(
                candidate => String(candidate.id) === teamId
            )
        ) {
            careerMilestones.push('Relegated to Sandlot');
        }

        const retentionResult = processCoachOffseasonRetention(
            team,
            game,
            completedSeasonYear,
            Math.random,
            { careerMilestones }
        );

        if (!retentionResult?.processed) return;

        staffHappinessChanges.push(
            ...retentionResult.happinessChanges.map(change => ({
                ...change,
                teamId: team.id,
                teamName: team.name
            }))
        );

        staffDepartures.push(
            ...retentionResult.departures.map(departure => ({
                ...departure,
                teamId: team.id,
                teamName: team.name
            }))
        );
    });

    // 💡 Execute the End of Season Financial Audit
    processEndSeasonFinances(game);

    // Age all existing coaches after completed-season career records
    // have been captured, including coaches who entered the market
    // through this year's retention decisions.
    const staffRetirements = processCoachCareerRetirement(
        game,
        completedSeasonYear
    );

    // Notify the user when a member of their staff retires.
    staffRetirements
        .filter(retirement =>
            String(retirement.teamId) ===
            String(game.playerTeam?.id)
        )
        .forEach(retirement => {
            addMessage(
                'Coach Retirement',
                `${retirement.coachName} has retired at age ${retirement.age}. Their coaching career history has been preserved.`,
                false,
                game
            );
        });

    game.year++;

    const teammateImproveChance = 0.15;
    game.teams.forEach(team => {
        if (!team || !team.roster || team.roster.length < 2) return;

        const fullRoster = getRosterObjects(team);
        if (fullRoster.length < 2) return;

        const gmRelationshipBonus = team.id === game.playerTeam?.id
            ? (team.gmProfile?.bonuses?.relationshipGrowth || 0)
            : 0;

        const relationshipImproveChance = Math.min(
            0.5,
            teammateImproveChance + gmRelationshipBonus
        );

        for (let i = 0; i < fullRoster.length; i++) {
            for (let j = i + 1; j < fullRoster.length; j++) {
                const p1 = fullRoster[i]; const p2 = fullRoster[j];
                if (!p1 || !p2) continue;

                if (Math.random() < relationshipImproveChance) {
                    improveRelationship(p1.id, p2.id);
                }
            }
        }
    });

    const departureEvents = [
        { reason: 'Moved Away', chance: 0.03 },
        { reason: 'Focusing on another sport', chance: 0.02 },
        { reason: 'Decided to quit', chance: 0.01 }
    ];

    // Process ALL players in the universe (ZenGM style) to fix Free Agent aging/leaks
    game.players.forEach(player => {
        if (!player.careerStats || !player.attributes) return;

        const team = player.teamId ? game.teams.find(t => t.id === player.teamId) : null;
        const teamName = team ? team.name : 'Free Agent';

        // Youth players are handled separately below.
        // Do not age/develop them again in the universal player lifecycle pass.
        if (team?.leagueType === 'youth' || player.lifecycle === 'youth') {
            if (
                ['busy', 'injured'].includes(player.status?.type) ||
                Number(player.status?.duration) > 0
            ) {
                player.status = { type: 'healthy', description: '', duration: 0 };
            }
            return;
        }

        // Check Season and Career Records
        if (!game.records) game.records = { game: {}, season: {}, career: {} };

        const checkSeasonRec = (statKey, val) => {
            if (!game.records.season[statKey]) {
                game.records.season[statKey] = {
                    val: 0,
                    holder: 'None',
                    year: 0
                };
            }

            if (val > game.records.season[statKey].val) {
                game.records.season[statKey] = {
                    val,
                    holder: player.name,
                    year: completedSeasonYear
                };
            }
        };

        const checkCareerRec = (statKey, val) => {
            if (!game.records.career[statKey]) game.records.career[statKey] = { val: 0, holder: 'None' };
            if (val > game.records.career[statKey].val) {
                game.records.career[statKey] = { val, holder: player.name };
            }
        };

        const sStats = player.seasonStats || {};
        checkSeasonRec('passYards', sStats.passYards || 0);
        checkSeasonRec('rushYards', sStats.rushYards || 0);
        checkSeasonRec('recYards', sStats.recYards || 0);
        checkSeasonRec('touchdowns', sStats.touchdowns || 0);
        checkSeasonRec('tackles', sStats.tackles || 0);
        checkSeasonRec('sacks', sStats.sacks || 0);
        checkSeasonRec('interceptions', sStats.interceptions || 0);

        const cStats = player.careerStats || {};
        checkCareerRec('passYards', cStats.passYards || 0);
        checkCareerRec('rushYards', cStats.rushYards || 0);
        checkCareerRec('recYards', cStats.recYards || 0);
        checkCareerRec('touchdowns', cStats.touchdowns || 0);
        checkCareerRec('tackles', cStats.tackles || 0);
        checkCareerRec('sacks', cStats.sacks || 0);
        checkCareerRec('interceptions', cStats.interceptions || 0);

        const completedSeasonAge = player.age;

        player.age++;
        player.careerStats.seasonsPlayed = (player.careerStats.seasonsPlayed || 0) + 1;
        const snapsThisSeason = player.careerStats.snapsThisSeason || 0;

        // --- THE AGING PROCESS: PERSONALITY-DRIVEN MATURATION ---
        if (player.age >= 15) {
            const ethic = player.personality?.workEthic || 50;
            const currentEgo = player.personality?.ego || 50;
            const cred = player.personality?.streetCred || 50;

            if (player.personality) {
                // 1. Ego Inflation: Only affects kids with high street cred / low humility
                const egoVulnerable = (currentEgo > 55 || cred > 60) && ethic < 75;
                if (egoVulnerable && Math.random() < 0.65) {
                    player.personality.ego = Math.min(100, currentEgo + getRandomInt(2, 5));
                } else if (ethic >= 80 && Math.random() < 0.35) {
                    // Dedicated team leaders stay humble
                    player.personality.ego = Math.max(10, currentEgo - 1);
                }

                // 2. Loyalty Decay: Only kids with low work ethic or existing wanderlust lose loyalty
                const loyaltyDecayChance = (100 - (player.personality.loyalty || 50)) / 120;
                if (ethic < 45 && Math.random() < loyaltyDecayChance) {
                    player.personality.loyalty = Math.max(0, (player.personality.loyalty || 50) - getRandomInt(1, 4));
                }
            }

            // 3. Stamina Decay / Laziness: Only slackers lose conditioning!
            if (player.attributes?.physical?.stamina) {
                if (ethic < 40 && Math.random() < 0.60) {
                    // Lazy teenagers lose stamina
                    player.attributes.physical.stamina = Math.max(20, player.attributes.physical.stamina - getRandomInt(2, 4));
                } else if (ethic >= 75 && player.attributes.physical.stamina < 90 && Math.random() < 0.30) {
                    // Hardworking gym rats gain conditioning through summer training
                    player.attributes.physical.stamina = Math.min(99, player.attributes.physical.stamina + 1);
                }
            }

            // 4. Role & Touch Expectations: Only stars and divas demand focal touches
            if (player.expectations) {
                if (currentEgo > 60 || cred > 65) {
                    player.expectations.desiredRole = 'STARTER';
                    if (['QB', 'RB', 'WR', 'TE'].includes(player.favoriteOffensivePosition)) {
                        player.expectations.minTouchesPerGame = Math.floor((player.age - 14) * 1.5);
                    }
                } else if (ethic >= 70) {
                    // Unselfish kids are content being rotational contributors
                    player.expectations.desiredRole = 'ROTATION';
                }
            }
        }

        // Run full player development (biological maturation + drill points)
        const devReport = developPlayer(
            player,
            team,
            { ageAlreadyAdvanced: true }
        );
        developmentResults.push(devReport);

        // Record End-of-Year Progression Snapshot WITH DETAILED ATTRIBUTE GAINS
        if (!player.progression) player.progression = [];
        player.progression.push({
            year: completedSeasonYear,
            age: completedSeasonAge,
            teamName: teamName,
            ovr: calculateOverall(player, estimateBestPosition(player)),
            improvements: devReport.improvements || [],
            stats: {
                passYards: player.seasonStats?.passYards || 0,
                rushYards: player.seasonStats?.rushYards || 0,
                recYards: player.seasonStats?.recYards || 0,
                touchdowns: player.seasonStats?.touchdowns || 0,
                tackles: player.seasonStats?.tackles || 0,
                sacks: player.seasonStats?.sacks || 0,
                interceptions: player.seasonStats?.interceptions || 0
            }
        });

        let playerIsLeaving = false;
        let permanentWalkout = false;
        let finalDepartureReason = '';
        
        // Everyone retires at age 19 (After their 18yo Senior season), even Free Agents
        if (player.age >= 19) {
            retiredPlayers.push(player);
            playerIsLeaving = true;
            if (team && team.id === game.playerTeam?.id && game.year >= 5) {
                addMessage("Player Retires", `${player.name} graduated and hung up his cleats.`);
            }

            // Former Legend to Coach Pipeline.
            // Keep the local coaching market limited rather than generating
            // an unlimited supply of candidates as players graduate.
            const availableCoachIds = new Set(
                (
                    Array.isArray(game.availableStaff)
                        ? game.availableStaff
                        : []
                )
                    .filter(candidate =>
                        candidate?.id != null &&
                        candidate.role === 'coach' &&
                        candidate.teamId == null
                    )
                    .map(candidate => String(candidate.id))
            );

            const hasMarketRoom = availableCoachIds.size < 18;

            const newCoach = hasMarketRoom
                ? checkRetiredPlayerToCoach(player)
                : null;

            if (newCoach) {
                if (!game.availableStaff) game.availableStaff = [];
                game.availableStaff.unshift(newCoach);

                // Only alert user for their own players or true league legends after Year 4
                const isMyPlayer = team && team.id === game.playerTeam?.id;
                const isLegend = (player.careerStats?.touchdowns || 0) >= 20;
                if (game.year >= 5 && (isMyPlayer || isLegend)) {
                    addMessage("Sideline Legend", `🎓 <b>${player.name}</b> (${teamName}) graduated and joined the coaching market!`);
                }
            }

            if ((player.careerStats.touchdowns || 0) > 25) {
                if (!game.hallOfFame) game.hallOfFame = [];
                game.hallOfFame.push(player); hofInductees.push(player);
                if (team && team.id === game.playerTeam?.id) addMessage("Hall of Fame!", `${player.name} inducted!`);
            }
        }
        else if (team) {
            // A relegation walkout may already be waiting for an exit interview.
            // Don't roll another departure event or queue the same player twice.
            if (pendingRetentionIds.has(player.id)) {
                // Keep the player attached until the interview resolves.
            } else {
                // Realistic Contract Retention & Broken Promise Evaluation
                const retentionCheck = evaluatePlayerRetention(
                    player,
                    team,
                    snapsThisSeason
                );

                let wantsToLeave = !retentionCheck.willStay;
                let leaveReason = retentionCheck.reason;

                if (!wantsToLeave) {
                    // Occasional life events (moved away, skateboard accident)
                    for (const event of departureEvents) {
                        if (Math.random() < event.chance) {
                            wantsToLeave = true;
                            leaveReason = event.reason;
                            break;
                        }
                    }
                }

                const isUserTeam = team.id === game.playerTeam?.id;

                // AI coaches get one retention attempt for genuine flight risks.
                // Broken-promise departures are permanent and cannot be negotiated away.
                if (
                    wantsToLeave &&
                    !isUserTeam &&
                    game.year >= 5 &&
                    !retentionCheck.willStay &&
                    !retentionCheck.permanentDeparture
                ) {
                    const aiRetention = evaluateAiRetentionPitch(
                        player,
                        team,
                        {
                            completedWins: team.wins || 0,
                            completedLosses: team.losses || 0,
                            snapsThisSeason
                        }
                    );

                    if (aiRetention.accepted && aiRetention.pitch) {
                        const aiOffer = aiRetention.pitch;

                        // Spend tokens only after the player accepts the offer.
                        if (aiOffer.tokensOffered > 0 && team.socialProfile) {
                            team.socialProfile.favorTokens = Math.max(
                                0,
                                team.socialProfile.favorTokens - aiOffer.tokensOffered
                            );
                        }

                        player.activePromise = createPlayerPromise(
                            player,
                            team,
                            {
                                role: aiOffer.rolePromised,
                                promiseType: aiOffer.promiseType,
                                tokensOffered: aiOffer.tokensOffered
                            },
                            {
                                promiseSeason: game.year,
                                source: 'aiRetention'
                            }
                        );

                        // A successful conversation repairs some of the relationship,
                        // but doesn't guarantee the player will stay forever.
                        if (player.personality) {
                            player.personality.loyalty = Math.min(
                                99,
                                (player.personality.loyalty ?? 50) + 3
                            );
                        }

                        if (!player.expectations) {
                            player.expectations = { happiness: 50 };
                        }

                        player.expectations.happiness = Math.min(
                            100,
                            (player.expectations.happiness ?? 50) + 8
                        );

                        player.retentionHistory = player.retentionHistory || [];
                        player.retentionHistory.push({
                            year: game.year - 1,
                            outcome: 'AI_RETAINED',
                            teamId: team.id,
                            role: aiOffer.rolePromised,
                            promiseType: aiOffer.promiseType,
                            tokensOffered: aiOffer.tokensOffered
                        });

                        // The normal departure branch below must not release this player.
                        wantsToLeave = false;
                    }
                }

                // Queue persuadable user-team flight risks.
                // Permanent broken-promise departures will bypass negotiations.
                if (
                    wantsToLeave &&
                    isUserTeam &&
                    game.year >= 5 &&
                    !retentionCheck.permanentDeparture
                ) {
                    pendingRetentions.push({
                        player,
                        playerId: player.id,
                        reason: leaveReason,
                        snapsThisSeason,
                        teamWins: team.wins || 0,
                        teamLosses: team.losses || 0
                    });

                    pendingRetentionIds.add(player.id);

                    // Do not set playerIsLeaving or clear player.teamId.
                } else if (wantsToLeave) {
                    permanentWalkout = !!retentionCheck.permanentDeparture;
                    finalDepartureReason = leaveReason;

                    leavingPlayers.push({
                        player,
                        reason: leaveReason,
                        teamName: team.name
                    });

                    playerIsLeaving = true;

                    if (isUserTeam) {
                        addMessage(
                            "Contract Departure",
                            `🚶 <b>${player.name}</b> walked away to Free Agency: ${leaveReason}`
                        );
                    }
                }
            }
        }

        player.seasonStats = createEmptySeasonStats();
        if (!playerIsLeaving) {
            if (!player.status) player.status = {};
            player.status = { type: 'healthy', description: '', duration: 0 };
        } else {
            if (team) {
                if (!player.playerHistory) {
                    player.playerHistory = { teamsPlayedFor: [] };
                }

                player.playerHistory.teamsPlayedFor.push({
                    teamId: team.id,
                    teamName: team.name,
                    year: game.year - 1
                });
            }

            player.teamId = null;

            if (player.age >= 19) {
                player.status = {
                    type: 'retired',
                    description: 'Graduated High School',
                    duration: 0
                };
            } else if (permanentWalkout) {
                // Permanent separation from this team, but still available
                // to other teams in Free Agency.
                player.status = {
                    type: 'healthy',
                    description: finalDepartureReason || 'Left after a broken promise',
                    duration: 0
                };

                player.permanentWalkoutYear = game.year - 1;
            } else {
                player.status = {
                    type: 'departed',
                    description: 'Left the league',
                    duration: 0
                };
            }

            totalVacancies++;
        }
    });

    // Re-compile valid rosters based on the updated universal player pool
    game.teams.forEach(team => {
        team.roster = game.players
            .filter(p => {
                if (!p || p.teamId !== team.id) return false;
                if (['retired', 'departed', 'temporary'].includes(p.status?.type)) return false;
                if (team.leagueType === 'youth') return true; // no availability filter for youth
                return !p.status || p.status.duration === 0 || p.status.type === 'healthy';
            })
            .map(p => p.id);

        // Remove special-team and package assignments that reference players
        // who no longer belong to this team's active roster.
        const activeRosterIds = new Set(team.roster);

        const isActiveTeamPlayer = playerId => {
            const player = playerId ? getPlayer(playerId) : null;

            return Boolean(
                player &&
                activeRosterIds.has(player.id) &&
                player.teamId === team.id &&
                !['retired', 'departed', 'temporary'].includes(player.status?.type)
            );
        };

        const previousSpecialTeams =
            team.specialTeams ?? team.depthChart?.specialTeams ?? {};

        team.specialTeams = Object.fromEntries(
            Object.entries(previousSpecialTeams)
                .filter(([, playerId]) => isActiveTeamPlayer(playerId))
        );

        team.specialists = Object.fromEntries(
            Object.entries(team.specialists ?? {})
                .filter(([, playerId]) => isActiveTeamPlayer(playerId))
        );

        // Safeguard: Never let CPU teams drop below the threshold needed to field an 8v8 unit
        if (!team.isPlayerControlled && team.leagueType === 'main' && team.roster.length < 11) {
            autoFillTeamWalkOns(team, 11);
        }

        if (team.depthChart && team.formations) {
            const offSlots = offenseFormations[team.formations.offense]?.slots || [];
            team.depthChart.offense = Object.fromEntries(offSlots.map(slot => [slot, null]));
            const defSlots = defenseFormations[team.formations.defense]?.slots || [];
            team.depthChart.defense = Object.fromEntries(defSlots.map(slot => [slot, null]));
            team.depthChart.special = { P: null };
        }

        if (team.depthChart) {
            team.depthChart.specialTeams = team.specialTeams;
        }

        team.wins = 0; team.losses = 0; team.ties = 0;

        if (team.socialProfile) {
            team.socialProfile.favorTokens = 3 + (team.socialProfile.streetCred >= 75 ? 1 : 0);
            team.socialProfile.streetCred = Math.round((team.socialProfile.streetCred + 50) / 2);
        }

        aiSetDepthChart(team);
    });

    const undraftedYoungPlayers = game.players.filter(p => p && !p.teamId && p.age < 17);
    if (game.playerTeam && game.playerTeam.roster && game.playerTeam.roster.length < ROSTER_LIMIT && Math.random() < 0.03 && undraftedYoungPlayers.length > 0) {
        const joiningPlayer = getRandom(undraftedYoungPlayers);
        if (joiningPlayer) {
            if (addPlayerToTeam(joiningPlayer, game.playerTeam)) {
                addMessage("New Player Joined!", `${joiningPlayer.name} heard about your team and asked to join!`);
                aiSetDepthChart(game.playerTeam);
            }
        }
    }

    // 💡 FREE AGENT ATTRITION (Cull unassigned kids so the pool never bloats)
    game.players.forEach(p => {
        if (
            !p.teamId &&
            p.status?.type !== 'retired' &&
            p.status?.type !== 'departed' &&
            p.permanentWalkoutYear !== game.year - 1
        ) {
            let quitChance = 0.10;
            if (p.age >= 14 && p.age <= 16) quitChance = 0.25;
            if (p.age >= 17) quitChance = 0.40;
            if (Math.random() < quitChance) {
                p.status = {
                    type: 'departed',
                    description: p.age >= 16 ? 'Got a job and bought a car / focused on varsity sports' : 'Quit football to skateboard and play video games',
                    duration: 0
                };
            }
        }
    });

    // 💡 PEE-WEE GRADUATION → LOGICAL DRAFT DECLARATION
    // Start with a clean class. Undrafted prospects from the previous board
    // remain in game.players and must not carry over into the next draft.
    game.draftClass = [];
    const youthTeams = game.teams.filter(t => t.leagueType === 'youth');

    youthTeams.forEach(yt => {
        yt.roster = yt.roster.filter(id => {
            const kid = getPlayer(id);
            if (!kid) return false;

            // Preserve the original entry age; never derive it from later ages.
            if (!Number.isFinite(Number(kid.youthEntryAge))) {
                kid.youthEntryAge = Math.max(
                    8,
                    Math.min(11, Number(kid.age) || 8)
                );
            }

            if (!Array.isArray(kid.youthSeasonHistory)) {
                kid.youthSeasonHistory = [];
            }

            if (!Number.isFinite(Number(kid.youthSeasonsPlayed))) {
                kid.youthSeasonsPlayed = kid.youthSeasonHistory.length;
            }

            // Preserve the completed Pee Wee season before resetting its stats.
            const completedYouthStats = {
                ...createEmptySeasonStats(),
                ...(kid.seasonStats || {})
            };

            // Check against the season just completed, not the newly advanced year.
            const alreadyRecorded = kid.youthSeasonHistory.some(
                season => Number(season.year) === Number(completedSeasonYear)
            );

            if (!alreadyRecorded) {
                kid.youthSeasonHistory.push({
                    year: completedSeasonYear,
                    age: kid.age,
                    teamId: yt.id,
                    teamName: yt.name || 'Pee Wee',
                    stats: completedYouthStats
                });

                if (
                    !kid.youthCareerStats ||
                    typeof kid.youthCareerStats !== 'object'
                ) {
                    kid.youthCareerStats = createEmptySeasonStats();
                }

                for (const [stat, value] of Object.entries(completedYouthStats)) {
                    kid.youthCareerStats[stat] =
                        (Number(kid.youthCareerStats[stat]) || 0) +
                        (Number(value) || 0);
                }

                // Count only seasons that were newly recorded.
                kid.youthSeasonsPlayed =
                    (Number(kid.youthSeasonsPlayed) || 0) + 1;
            }

            developPlayer(kid, yt);
            kid.age++;
            kid.careerStats.seasonsPlayed =
                (kid.careerStats.seasonsPlayed || 0) + 1;

            // Reset season stats for all returning youth players
            kid.seasonStats = createEmptySeasonStats();

            // Players leave Pee Wee at age 12.
            // Draft eligibility depends on their age when they first joined
            // and the number of Pee Wee seasons they actually completed.
                        // Pee Wee players graduate at age 12, but only players
            // with enough completed seasons may enter the rookie draft.
            if (kid.age >= 12) {
                kid.teamId = null;
                kid.careerStats.snapsThisSeason = 0;

                const entryAge = Math.max(
                    8,
                    Math.min(11, Number(kid.youthEntryAge) || 8)
                );
                const requiredYouthSeasons = Math.max(1, 12 - entryAge);
                const completedYouthSeasons =
                    Math.max(0, Number(kid.youthSeasonsPlayed) || 0);

                const meetsYouthRequirement =
                    completedYouthSeasons >= requiredYouthSeasons;

                if (!meetsYouthRequirement) {
                    // Graduates who missed the requirement enter free agency.
                    kid.lifecycle = 'active';
                    if (!kid.personality) kid.personality = {};
                    kid.personality.entersDraft = false;
                    return false;
                }

                // Eligible graduates may still choose free agency
                // because of their relationships or personality.
                const ego = kid.personality?.ego || 50;
                const loyalty = kid.personality?.loyalty || 60;
                const bestFriend = kid.social?.bestFriendId
                    ? getPlayer(kid.social.bestFriendId)
                    : null;
                const bestFriendTeam = bestFriend?.teamId != null
                    ? game.teams.find(t => String(t.id) === String(bestFriend.teamId))
                    : null;
                const friendOnMainTeam = bestFriendTeam?.leagueType === 'main';

                let entersDraft = true;

                if (friendOnMainTeam && Math.random() < 0.50) {
                    entersDraft = false;
                } else if (
                    ego >= 80 &&
                    loyalty < 40 &&
                    Math.random() < 0.40
                ) {
                    entersDraft = false;
                }

                if (entersDraft) {
                    kid.lifecycle = 'draft_eligible';
                    if (!kid.personality) kid.personality = {};
                    kid.personality.entersDraft = true;
                    game.draftClass.push(kid);
                } else {
                    kid.lifecycle = 'active';
                    if (!kid.personality) kid.personality = {};
                    kid.personality.entersDraft = false;
                }

                return false;
            }
            return true;
        });
        yt.wins = 0; yt.losses = 0; yt.ties = 0;
    });

    // Generate a modifier set for the small free-agent arrival pool
    // and new Pee Wee entrants. Rookie draft prospects must come from
    // the actual Pee Wee graduation process above.
    const thisYearsClassModifiers = generateDraftClassModifiers();

    // 💡 GENERATE OLDER MOVE-INS (Ages 13-17) DIRECTLY INTO STREET FREE AGENCY
    const newOlderWalkons = [];
    for (let i = 0; i < 5; i++) {
        const olderKid = generatePlayer(13, 17, thisYearsClassModifiers);
        olderKid.lifecycle = 'active';
        if (!olderKid.personality) olderKid.personality = {};
        olderKid.personality.entersDraft = false;
        game.players.push(olderKid);
        playerMap.set(olderKid.id, olderKid);
        newOlderWalkons.push(olderKid);
    }

    // Initialize inherited scouting knowledge for the completed incoming class.
    // Apply banked weekly scouting afterward so that work builds on that baseline.
    mainTeams.forEach(team => {
        initializeInheritedScoutingReports(
            team,
            game.draftClass,
            game.year,
            0
        );
    });

    // Apply the previous regular season's banked scouting hours.
    let userDraftScoutingResult = null;

    mainTeams.forEach(team => {
        const result = applyBankedDraftScoutingReports(
            team,
            game,
            game.year,
            0
        );

        if (team.id === game.playerTeam?.id) {
            userDraftScoutingResult = result;
        }
    });

    // Give the user a confirmation when banked scouting work was applied.
    if (
        userDraftScoutingResult &&
        userDraftScoutingResult.workItemsApplied > 0
    ) {
        addMessage(
            'Draft Scouting Completed',
            `Your staff's banked scouting effort was applied to the Year ${game.year} draft class. ${userDraftScoutingResult.playersUpdated} report updates were processed using ${userDraftScoutingResult.hoursUsed} hours across ${userDraftScoutingResult.workItemsApplied} weekly assignments.`,
            false,
            game
        );
    }

    // Connect new free-agent arrivals into the social network
    const livingActivePlayers = game.players.filter(p => p.status?.type !== 'retired' && p.status?.type !== 'departed');
    buildSocialNetworks(newOlderWalkons, livingActivePlayers);

    addMessage("Offseason Summary", `Offseason complete. ${totalVacancies} roster spots opened.\n\n${proRelMsg}\n\nPreparing for the draft.`, false, game);

    // PEE WEE BACKGROUND DRAFT
    // Returning players stay. Departures create vacancies, and the weakest
    // youth teams get first choice of the best available new prospects.
    const youthRosterLimit = 14;

    // 1. Apply small annual turnover before calculating roster vacancies.
    youthTeams.forEach(yt => {
        yt.roster = (yt.roster || []).filter(id => {
            const kid = getPlayer(id);
            if (!kid) return false;

            // Only returning youth players can leave through this turnover roll.
            if (
                kid.age >= 9 &&
                kid.age <= 11 &&
                Math.random() < 0.02
            ) {
                kid.teamId = null;
                kid.lifecycle = 'active';
                kid.status = {
                    type: 'departed',
                    description: 'Left Pee Wee football',
                    duration: 0
                };

                return false;
            }

            return true;
        });
    });

    // 2. Count vacant spots after graduation and youth turnover.
    const vacanciesByTeam = new Map(
        youthTeams.map(yt => [
            yt.id,
            Math.max(
                0,
                youthRosterLimit - (yt.roster?.length || 0)
            )
        ])
    );

    const totalYouthVacancies = [...vacanciesByTeam.values()]
        .reduce((sum, vacancies) => sum + vacancies, 0);

    const newYouthEntrants = [];

    if (totalYouthVacancies > 0) {
        // Generate two candidates for every open roster spot.
        // Unselected candidates never enter the persistent player pool.
        const prospectPoolSize = totalYouthVacancies * 2;

        const rankedYouthProspects = Array.from(
            { length: prospectPoolSize },
            () => generatePlayer(8, 8, thisYearsClassModifiers)
        )
            .map(player => {
                const bestPosition = estimateBestPosition(player);

                // Current ability measures what the prospect can do today.
                const currentOverall = Number(
                    calculateOverall(player, bestPosition)
                ) || 0;

                // Talent attributes represent the prospect's underlying
                // ceiling, before age-related development scaling.
                const ceilingPlayer = player.talentAttributes
                    ? {
                        ...player,
                        attributes: player.talentAttributes
                    }
                    : player;

                const rawCeilingOverall = Number(
                    calculateOverall(ceilingPlayer, bestPosition)
                );

                const ceilingOverall =
                    Number.isFinite(rawCeilingOverall) &&
                    rawCeilingOverall > 0
                        ? rawCeilingOverall
                        : currentOverall;

                // Balance immediate ability against long-term upside.
                const blendedScore =
                    currentOverall * 0.65 +
                    ceilingOverall * 0.35;

                return {
                    player,
                    score: blendedScore + Math.random() * 0.001
                };
            })
            .sort((a, b) => b.score - a.score)
            .map(entry => entry.player);

        let remainingVacancies = totalYouthVacancies;

        // 3. Run the draft in repeated rounds, worst team first.
        while (
            remainingVacancies > 0 &&
            rankedYouthProspects.length > 0
        ) {
            let picksThisRound = 0;

            for (const yt of youthDraftOrder) {
                const teamVacancies = vacanciesByTeam.get(yt.id) || 0;

                if (teamVacancies <= 0) continue;

                const prospect = rankedYouthProspects.shift();
                if (!prospect) break;

                // Initialize the selected prospect as a new Pee Wee player.
                prospect.teamId = yt.id;
                prospect.lifecycle = 'youth';
                prospect.youthEntryAge = 8;
                prospect.youthSeasonsPlayed = 0;
                prospect.youthSeasonHistory = [];
                prospect.youthCareerStats = createEmptySeasonStats();

                yt.roster.push(prospect.id);

                game.players.push(prospect);
                playerMap.set(prospect.id, prospect);
                newYouthEntrants.push(prospect);

                vacanciesByTeam.set(yt.id, teamVacancies - 1);
                remainingVacancies--;
                picksThisRound++;
            }

            // Defensive guard in case no team can accept another prospect.
            if (picksThisRound === 0) break;
        }
    }

    // 4. Give selected newcomers social relationships and rebuild youth depth charts.
    if (newYouthEntrants.length > 0) {
        const livingActivePlayers = game.players.filter(
            player =>
                player &&
                player.status?.type !== 'retired' &&
                player.status?.type !== 'departed'
        );

        buildSocialNetworks(newYouthEntrants, livingActivePlayers);
    }

    youthTeams.forEach(yt => {
        aiSetDepthChart(yt);
    });

    // 🚀 PERFORMANCE & MEMORY LEAK FIX
    // 1. Purge players who are retired/departed and NOT in the Hall of Fame
    const hofIds = new Set(
        (game.hallOfFame || [])
            .map(p => (typeof p === 'object' && p !== null ? p.id : p))
            .filter(Boolean)
    );
    game.players = game.players.filter(p => {
        if (p.status?.type === 'retired' || p.status?.type === 'departed') {
            return hofIds.has(p.id) || hofIds.has(String(p.id));
        }
        return true;
    });

    // 2. Cap progression history size to prevent infinite array growth
    game.players.forEach(p => {
        if (p.progression && p.progression.length > 5) {
            p.progression = p.progression.slice(-5);
        }
    });

    // 3. Re-sync playerMap to drop dead references
    playerMap.clear();
    game.players.forEach(p => playerMap.set(p.id, p));

    // Initialize inherited scouting for unsigned players entering
    // the upcoming recruiting period. Draft-class scouting was already
    // initialized separately above.
    const draftClassIds = new Set(
        (Array.isArray(game.draftClass) ? game.draftClass : [])
            .map(player => String(player?.id))
    );

    const inheritedFreeAgentProspects = game.players.filter(player => {
        if (
            !player ||
            player.id == null ||
            player.teamId != null
        ) {
            return false;
        }

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
            Number.isFinite(age) &&
            age >= 12 &&
            age <= 18 &&
            !draftClassIds.has(String(player.id)) &&
            lifecycle !== 'draft_eligible' &&
            lifecycleStatus !== 'draft_eligible' &&
            !['retired', 'departed', 'temporary'].includes(statusType) &&
            !['retired', 'departed', 'temporary'].includes(lifecycleStatus) &&
            !(Number(player.status?.duration) > 0) &&
            !(Number(player.injury?.duration || player.injuryDuration || 0) > 0)
        );
    });

    // Every main-league team receives its own imperfect inherited reports.
    mainTeams.forEach(team => {
        initializeInheritedScoutingReports(
            team,
            inheritedFreeAgentProspects,
            game.year,
            0
        );
    });

    game.gameResults = [];
    game.breakthroughs = [];
    game.offseasonFACompleted = false;
    game._faDay = 1;
    game._activeFaMarket = new Map();
    game.currentWeek = 0;

    game.teams.forEach(team => {
        assignTeamCaptain(team);
    });

    // Start the new offseason with the staff carousel.
    game.offseasonState = {
        seasonYear: Number(game.year) || null,
        completedSeasonYear,
        phase: OFFSEASON_PHASES.STAFF_REVIEW,
        staffReviewDay: 1,
        staffReviewDays: COACH_CAROUSEL_DAYS,
        recruitingDay: 0,
        recruitingDays: FREE_AGENCY_RECRUITING_DAYS,
        completed: false,
        staffDepartures,
        staffHappinessChanges
    };

    // Clear the in-progress marker only after every rollover operation
    // has completed successfully.
    game._offseasonCompletedYear = completedSeasonYear;

    // Mark rollover complete; staff review, draft, and recruiting are
    // separate phases and must not rerun the season lifecycle.
    delete game._offseasonInProgressYear;

    return {
        retiredPlayers,
        hofInductees,
        developmentResults,
        leavingPlayers,
        pendingRetentions,
        staffDepartures,
        staffHappinessChanges
    };
}

export function playerCut(playerId) {
    if (!game || !game.playerTeam || !game.playerTeam.roster) return { success: false, message: "Game state error." };
    const team = game.playerTeam;
    const playerIndex = team.roster.findIndex(pId => pId === playerId);

    if (playerIndex > -1) {
        const [removedId] = team.roster.splice(playerIndex, 1);
        const player = game.players.find(p => p && p.id === removedId);

        if (player.status?.type === 'temporary') {
            team.roster.splice(playerIndex, 0, removedId);
            return { success: false, message: "Cannot cut temporary friends." };
        }
        player.teamId = null;
        player.number = null;

        for (const side in team.depthChart) {
            if (team.depthChart[side]) {
                for (const slot in team.depthChart[side]) {
                    if (team.depthChart[side][slot] === playerId) { team.depthChart[side][slot] = null; }
                }
            }
        }

        // Clean up captaincy if captain was cut
        if (team.captainId === playerId) {
            team.captainId = null;
            assignTeamCaptain(team);
        }

        aiSetDepthChart(team);
        addMessage("Roster Move", `${player.name} has been cut from the team.`);
        team.roster.forEach(rosterPlayerId => {
            if (rosterPlayerId) decreaseRelationship(rosterPlayerId, player.id);
        });
        return { success: true };
    }
    return { success: false, message: "Player not found on roster." };
}

export function playerSignFreeAgent(playerId, offer = {}) {
    if (!game || !game.playerTeam || !game.playerTeam.roster || !game.players) {
        return { success: false, message: "Game state error." };
    }
    const team = game.playerTeam;
    const roster = getRosterObjects(team);
    const limit = getCurrentRosterLimit(game);
    if (roster.length >= limit) {
        return { success: false, message: `Summer Roster is full (${limit} players max).` };
    }

    const player = game.players.find(p => p && p.id === playerId && !p.teamId);
    if (!player) return { success: false, message: "Player not found." };
    if (player.status?.duration > 0) return { success: false, message: `${player.name} is unavailable.` };

    const negotiation = evaluatePlayerNegotiation(player, team, offer);

    if (!negotiation.accepted) {
        return {
            success: false,
            message: `✋ ${player.name} rejected your pitch: ${negotiation.reasons.join(' • ')}`
        };
    }

    if (addPlayerToTeam(player, team)) {
        if (offer.tokensOffered > 0) {
            team.socialProfile.favorTokens = Math.max(
                0,
                (team.socialProfile.favorTokens || 0) - offer.tokensOffered
            );
        }

        player.activePromise = createPlayerPromise(
            player,
            team,
            offer,
            { promiseSeason: game.year, source: 'directFA' }
        );

        aiSetDepthChart(team);

        addMessage(
            "Free Agent Signed",
            `🤝 <b>${player.name}</b> accepted your contract pitch! (${negotiation.reasons.join(', ')})`
        );

        return { success: true, message: `Signed ${player.name}!` };
    }

    return { success: false, message: "Failed to add player." };
}
