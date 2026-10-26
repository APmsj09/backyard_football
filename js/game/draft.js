// js/game/draft.js - Draft Manager

import {
    game,
    getPlayer,
    getRosterObjects,
    addMessage,
    getTeamScoutingReport
} from './state.js';
import {
    calculateOverall,
    estimateBestPosition,
    positionOverallWeights
} from './player.js';

import { isPlayerViableForPosition } from './depth_chart.js';
import { offenseFormations, defenseFormations } from '../data.js';
import { addPlayerToTeam, getCurrentRosterLimit } from './season.js';

export const DRAFT_ROUNDS_ROOKIE = 3;

const OFFENSIVE_POSITION_FITS = ['QB', 'RB', 'WR', 'TE', 'OL'];
const DEFENSIVE_POSITION_FITS = ['DL', 'LB', 'DB'];

function getBestPositionFit(player, positions) {
    if (!player) return { position: '—', ovr: 0 };

    const supportedPositions = positions.filter(position =>
        positionOverallWeights[position]
    );

    const viablePositions = supportedPositions.filter(position =>
        isPlayerViableForPosition(player, position)
    );

    // Match the UI fallback: evaluate supported positions if none pass viability.
    const positionsToEvaluate = viablePositions.length > 0
        ? viablePositions
        : supportedPositions;

    const ratings = positionsToEvaluate.map(position => ({
        position,
        ovr: calculateOverall(player, position)
    }));

    ratings.sort((a, b) => b.ovr - a.ovr);

    return ratings[0] || { position: '—', ovr: 0 };
}

function getBestTwoWayFits(player) {
    return {
        offense: getBestPositionFit(player, OFFENSIVE_POSITION_FITS),
        defense: getBestPositionFit(player, DEFENSIVE_POSITION_FITS)
    };
}

const DRAFT_POTENTIAL_SCORE = Object.freeze({
    A: 95,
    B: 82,
    C: 68,
    D: 52,
    F: 35
});

const draftEvaluationCache = new WeakMap();

function getEstimatedProspectForTeam(player, report) {
    const attributes = {};

    for (const [category, values] of Object.entries(player.attributes || {})) {
        if (!values || typeof values !== 'object' || Array.isArray(values)) {
            continue;
        }

        const estimatedCategory = {};

        for (const [attribute, actualValue] of Object.entries(values)) {
            if (typeof actualValue !== 'number') continue;

            // Registered measurements remain public.
            if (
                category === 'physical' &&
                (attribute === 'height' || attribute === 'weight')
            ) {
                estimatedCategory[attribute] = actualValue;
                continue;
            }

            const range = report?.attributeRanges?.[category]?.[attribute];

            estimatedCategory[attribute] =
                range &&
                Number.isFinite(range.low) &&
                Number.isFinite(range.high)
                    ? Math.round((range.low + range.high) / 2)
                    : 50;
        }

        attributes[category] = estimatedCategory;
    }

    // Do not copy hidden favorite positions, potential, or personality.
    return {
        id: player.id,
        age: player.age,
        pos: player.pos,
        attributes
    };
}

function getReportedPositionFit(reportFit, fallbackFit, positions) {
    if (
        !reportFit ||
        !positions.includes(reportFit.position) ||
        !Number.isFinite(reportFit.low) ||
        !Number.isFinite(reportFit.high)
    ) {
        return fallbackFit;
    }

    return {
        position: reportFit.position,
        ovr: Math.round((reportFit.low + reportFit.high) / 2)
    };
}

function scorePublicSeasonStats(stats, position) {
    if (!stats || typeof stats !== 'object') return null;

    const value = key => Number.isFinite(stats[key])
        ? Math.max(0, stats[key])
        : 0;

    let observed = false;
    let score = 50;

    switch (position) {
        case 'QB':
            observed = [
                'passAttempts', 'passCompletions', 'passYards',
                'interceptionsThrown', 'touchdowns', 'rushYards'
            ].some(key => value(key) > 0);

            if (!observed) return null;

            score =
                value('passYards') / 35 +
                value('passCompletions') / 2 +
                value('touchdowns') * 2 -
                value('interceptionsThrown') * 3 +
                value('rushYards') / 80;
            break;

        case 'RB':
            observed = [
                'rushAttempts', 'rushYards', 'receptions',
                'recYards', 'touchdowns'
            ].some(key => value(key) > 0);

            if (!observed) return null;

            score =
                value('rushYards') / 20 +
                value('rushAttempts') * 0.2 +
                value('recYards') / 40 +
                value('receptions') * 0.8 +
                value('touchdowns') * 2 -
                value('fumblesLost') * 2;
            break;

        case 'WR':
        case 'TE':
            observed = [
                'targets', 'receptions', 'recYards', 'touchdowns'
            ].some(key => value(key) > 0);

            if (!observed) return null;

            score =
                value('recYards') / 18 +
                value('receptions') * 1.2 +
                value('touchdowns') * 2 -
                value('drops') * 2;
            break;

        case 'DL':
            observed = [
                'tackles', 'sacks', 'interceptions', 'fumblesRecovered'
            ].some(key => value(key) > 0);

            if (!observed) return null;

            score =
                value('tackles') / 2 +
                value('sacks') * 5 +
                value('interceptions') * 4 +
                value('fumblesRecovered') * 3 +
                value('touchdowns') * 2;
            break;

        case 'LB':
            observed = [
                'tackles', 'sacks', 'interceptions', 'fumblesRecovered'
            ].some(key => value(key) > 0);

            if (!observed) return null;

            score =
                value('tackles') / 2.5 +
                value('sacks') * 4 +
                value('interceptions') * 4 +
                value('fumblesRecovered') * 3 +
                value('touchdowns') * 2;
            break;

        case 'DB':
            observed = [
                'tackles', 'interceptions', 'returnYards', 'touchdowns'
            ].some(key => value(key) > 0);

            if (!observed) return null;

            score =
                value('tackles') / 4 +
                value('interceptions') * 6 +
                value('returnYards') / 35 +
                value('touchdowns') * 2;
            break;

        default:
            // The available individual statistics aren't sufficient
            // to estimate offensive-line performance reliably.
            return null;
    }

    return Math.max(0, Math.min(100, score));
}

function scorePublicTwoWaySeasonStats(stats, position) {
    if (!stats || typeof stats !== 'object') return null;

    const hasProduction = keys =>
        keys.some(key =>
            Number.isFinite(Number(stats[key])) &&
            Number(stats[key]) > 0
        );

    // Touchdowns alone don't establish meaningful production on a side.
    const hasOffense = hasProduction([
        'passYards',
        'passAttempts',
        'passCompletions',
        'rushYards',
        'rushAttempts',
        'recYards',
        'receptions',
        'targets',
        'drops'
    ]);

    const hasDefense = hasProduction([
        'tackles',
        'sacks',
        'interceptions',
        'fumblesRecovered',
        'safeties'
    ]);

    const bestScoreFor = positions => {
        const scores = positions
            .map(pos => scorePublicSeasonStats(stats, pos))
            .filter(Number.isFinite);

        return scores.length ? Math.max(...scores) : null;
    };

    const offenseScore = hasOffense
        ? bestScoreFor(['QB', 'RB', 'WR', 'TE'])
        : null;

    const defenseScore = hasDefense
        ? bestScoreFor(['DL', 'LB', 'DB'])
        : null;

    const isOffensivePosition =
        OFFENSIVE_POSITION_FITS.includes(position);

    const primarySideScore = isOffensivePosition
        ? offenseScore
        : defenseScore;

    const otherSideScore = isOffensivePosition
        ? defenseScore
        : offenseScore;

    // If only one side has meaningful production, use that evidence.
    if (!Number.isFinite(primarySideScore)) {
        return Number.isFinite(otherSideScore)
            ? otherSideScore
            : null;
    }

    // Keep ordinary one-way players' scores unchanged.
    // Meaningful production on the opposite side adds a smaller contribution.
    if (
        Number.isFinite(otherSideScore) &&
        otherSideScore >= 55
    ) {
        return primarySideScore * 0.70 + otherSideScore * 0.30;
    }

    return primarySideScore;
}

function getPublicProductionScore(player) {
    const position = player?.pos;

    if (!position) return null;

    const seasons = Array.isArray(player.progression)
        ? player.progression
            .filter(season => season?.stats)
            .slice(-3)
        : [];

    let scores = seasons
        .map(season => scorePublicTwoWaySeasonStats(season.stats, position))
        .filter(Number.isFinite);

    // Rookie prospects store their public production in Pee Wee history,
    // not necessarily in the standard progression/career stat fields.
    if (scores.length === 0) {
        const youthSeasons = Array.isArray(player.youthSeasonHistory)
            ? player.youthSeasonHistory
                .filter(season => season?.stats)
                .slice(-3)
            : [];

        scores = youthSeasons
            .map(season => scorePublicTwoWaySeasonStats(season.stats, position))
            .filter(Number.isFinite);
    }

    // Older or partially migrated saves may have only Pee Wee career totals.
    if (
        scores.length === 0 &&
        player.youthCareerStats &&
        Number(player.youthSeasonsPlayed) > 0
    ) {
        const seasonsPlayed = Number(player.youthSeasonsPlayed);
        const averageSeasonStats = {};

        for (const [key, rawValue] of Object.entries(player.youthCareerStats)) {
            if (Number.isFinite(Number(rawValue))) {
                averageSeasonStats[key] = Number(rawValue) / seasonsPlayed;
            }
        }

        const youthCareerScore = scorePublicTwoWaySeasonStats(
            averageSeasonStats,
            position
        );

        if (Number.isFinite(youthCareerScore)) {
            scores = [youthCareerScore];
        }
    }

    // Older saves may have career totals without season-by-season records.
    if (
        scores.length === 0 &&
        player.careerStats &&
        Number(player.careerStats.seasonsPlayed) > 0
    ) {
        const seasonsPlayed = Number(player.careerStats.seasonsPlayed);
        const averageSeasonStats = {};

        for (const [key, rawValue] of Object.entries(player.careerStats)) {
            if (Number.isFinite(rawValue)) {
                averageSeasonStats[key] = rawValue / seasonsPlayed;
            }
        }

        const careerScore = scorePublicTwoWaySeasonStats(
            averageSeasonStats,
            position
        );

        if (Number.isFinite(careerScore)) scores = [careerScore];
    }

    if (scores.length === 0) return null;

    const average = scores.reduce((sum, score) => sum + score, 0) /
        scores.length;

    // One recorded season is weak evidence; repeated production is stronger.
    const evidenceWeight = Math.min(1, scores.length / 3);

    return 50 + (average - 50) * evidenceWeight;
}

function getDraftEvaluationContext(player, team) {
    let teamCache = draftEvaluationCache.get(player);

    if (!teamCache) {
        teamCache = new WeakMap();
        draftEvaluationCache.set(player, teamCache);
    }

    const report = getTeamScoutingReport(team, player.id);
    const cached = teamCache.get(team);

    // A newly generated report replaces the report object and invalidates
    // the cached projection. Progress-only changes do not alter the estimates.
    if (cached && cached.report === report) {
        return cached;
    }

    const estimatedPlayer = getEstimatedProspectForTeam(player, report);
    const estimatedFits = getBestTwoWayFits(estimatedPlayer);

    const fits = {
        offense: getReportedPositionFit(
            report?.evaluation?.offenseFit,
            estimatedFits.offense,
            OFFENSIVE_POSITION_FITS
        ),
        defense: getReportedPositionFit(
            report?.evaluation?.defenseFit,
            estimatedFits.defense,
            DEFENSIVE_POSITION_FITS
        )
    };

    const context = {
        report,
        estimatedPlayer,
        fits,
        publicProductionScore: getPublicProductionScore(player)
    };

    teamCache.set(team, context);
    return context;
}

/**
 * Calculates a prospect's value to a specific team based on ability,
 * ceiling (potential), positional need, and coach preference.
 */
export function calculateDraftValue(player, team) {
    if (!player || !team) return 0;

    const scout = team.staff?.scout;
    const coach = team.staff?.coach || team.coach;

    const {
        report,
        estimatedPlayer,
        fits,
        publicProductionScore
    } = getDraftEvaluationContext(player, team);

    // Use persistent team-specific estimates instead of fresh random noise.
    const offOvr = fits.offense.ovr;
    const defOvr = fits.defense.ovr;

    // Both sides contribute to perceived player value.
    const ovr = Math.round((offOvr + defOvr) / 2);
    const gmDirective = team.gameplan?.gmDirective || 'COACH_AUTONOMY';
    const coachPersonality = coach?.biases?.personality?.name;

    // Dynamic Weights by GM Directive:
    // WIN_NOW values day-one ability (45%) over raw ceiling (15%)
    // DEVELOP_YOUTH values ceiling/potential (45%) over current polish (20%)
    let abilityWeight = 0.35;
    let potentialWeight = 0.30;

    if (gmDirective === 'WIN_NOW') {
        abilityWeight = 0.45;
        potentialWeight = 0.15;
    } else if (gmDirective === 'DEVELOP_YOUTH') {
        abilityWeight = 0.20;
        potentialWeight = 0.45;
    }

    // 1. Perceived Ability
    let abilityScore = ovr * abilityWeight;

    if (Number.isFinite(publicProductionScore)) {
        abilityScore += ((publicProductionScore - 50) / 50) * 3;
    }

    // Scout & Coach Personality Bias
    const scoutBias = scout?.biases?.scouting?.name;
    if (scoutBias === 'Speed Chaser') {
        const spd = estimatedPlayer.attributes?.physical?.speed || 50;
        if (spd > 68) abilityScore += (spd - 68) * 0.45;
    } else if (
        scoutBias === 'Character First' ||
        coachPersonality === 'Old-School Disciplinarian'
    ) {
        // Character-based adjustments wait for explicit scouting estimates.
        // Never inspect hidden ego or work-ethic values for an external prospect.
    }

    // 2. Potential / Ceiling
    const potentialRange = report?.potentialRange;
    const bestPotential = DRAFT_POTENTIAL_SCORE[potentialRange?.bestPossible];
    const worstPotential = DRAFT_POTENTIAL_SCORE[potentialRange?.worstPossible];

    const estimatedPotential = Number.isFinite(bestPotential) &&
        Number.isFinite(worstPotential)
        ? (bestPotential + worstPotential) / 2
        : 65;

    let potScore = estimatedPotential * potentialWeight;

    if (
        gmDirective === 'DEVELOP_YOUTH' &&
        player.age <= 12 &&
        ['A', 'B'].includes(potentialRange?.bestPossible)
    ) {
        potScore += 12;
    }

    // 3. Positional Need (25%)
    // Evaluate offensive and defensive roster needs independently.
    const roster = getRosterObjects(team);

    // Count every roster player who is viable at each position.
    // A two-way player may contribute to both an offensive and
    // a defensive position group.
    const positionCounts = {};

    Object.keys(positionOverallWeights).forEach(position => {
        positionCounts[position] = roster.filter(p =>
            isPlayerViableForPosition(p, position)
        ).length;
    });

    const offensePersonnel =
        offenseFormations[team.formations?.offense]?.personnel || {};

    const defensePersonnel =
        defenseFormations[team.formations?.defense]?.personnel || {};

    function getPositionNeedMultiplier(position, personnel) {
        const formationTarget = Number(personnel[position]) || 0;
        const countAtPos = positionCounts[position] || 0;

        if (formationTarget <= 0) {
            // The active formation does not use this position.
            return 0.75;
        }

        const positionGap = formationTarget - countAtPos;

        if (positionGap > 0) {
            // A bigger shortage increases draft priority.
            return 1.0 + Math.min(0.55, positionGap * 0.18);
        }

        // Reduce urgency as the position becomes adequately staffed.
        return Math.max(
            0.70,
            1.0 - Math.min(0.30, Math.abs(positionGap) * 0.10)
        );
    }

    const offNeedMultiplier = getPositionNeedMultiplier(
        fits.offense.position,
        offensePersonnel
    );

    const defNeedMultiplier = getPositionNeedMultiplier(
        fits.defense.position,
        defensePersonnel
    );

    // Give each side half of the positional-need contribution.
    const needScore = 0.25 * (
        offOvr * offNeedMultiplier +
        defOvr * defNeedMultiplier
    ) / 2;

    // 4. Coach Scheme & Attribute Bias (10%)
    let coachFit = 0;
    if (coach?.attributePreferences) {
        for (const cat in estimatedPlayer.attributes) {
            for (const attr in estimatedPlayer.attributes[cat]) {
                const weight = coach.attributePreferences[cat]?.[attr] || 1.0;
                coachFit += (estimatedPlayer.attributes[cat][attr] || 0) * (weight - 1.0);
            }
        }
    }
    const fitScore = Math.max(-10, Math.min(15, coachFit)) * 0.10;

    return abilityScore + potScore + needScore + fitScore;
}

/**
 * Sets up the draft order and pool.
 * Year 1: Inaugural draft (fill rosters).
 * Year 2+: 3-round fixed Rookie Draft (60 picks).
 */
//import { generatePlayer, generateDraftClassModifiers } from './player.js';

export function setupDraft() {
    if (!game || !game.teams) return;
    game.draftOrder = [];
    game.currentPick = 0;
    game.pickHistory = [];

    const mainTeams = game.teams.filter(t => t.leagueType === 'main');
    const rosterLimit = getCurrentRosterLimit(game);

    if (game.year === 1) {
        const sortedTeams = [...mainTeams].sort(() => 0.5 - Math.random());
        game.draftClass = game.players.filter(p => !p.teamId && p.age >= 11 && p.personality?.entersDraft !== false);

        mainTeams.forEach(t => t.draftNeeds = Math.max(0, rosterLimit - (t.roster?.length || 0)));
        const maxNeeds = Math.max(0, ...mainTeams.map(t => t.draftNeeds || 0));

        for (let i = 0; i < maxNeeds; i++) {
            game.draftOrder.push(...(i % 2 === 0 ? sortedTeams : [...sortedTeams].reverse()));
        }
    } else {
        // 1. Order by reverse standings from the season that just finished
        let sortedTeams;
        if (game.nextDraftOrder && Array.isArray(game.nextDraftOrder)) {
            sortedTeams = game.nextDraftOrder.map(id => mainTeams.find(t => t.id === id)).filter(Boolean);
        }
        if (!sortedTeams || sortedTeams.length === 0) {
            sortedTeams = [...mainTeams].sort((a, b) =>
                (a.wins || 0) - (b.wins || 0) || (b.losses || 0) - (a.losses || 0)
            );
        }

        // 3 Fixed Rounds = 60 total picks
        for (let r = 0; r < DRAFT_ROUNDS_ROOKIE; r++) {
            game.draftOrder.push(...(r % 2 === 0 ? sortedTeams : [...sortedTeams].reverse()));
        }

        // Only admit prospects with a documented, completed Pee Wee history.
        // Do not manufacture extra rookies to fill the draft board.
        const incomingDraftClass = Array.isArray(game.draftClass)
            ? game.draftClass
            : [];

        game.draftClass = incomingDraftClass.filter(prospect => {
            const prospectAge = Number(prospect?.age);

            if (
                !prospect ||
                prospect.teamId ||
                prospect.lifecycle !== 'draft_eligible' ||
                !Number.isInteger(prospectAge) ||
                prospectAge < 12 ||
                prospect.personality?.entersDraft === false ||
                ['retired', 'departed', 'temporary'].includes(
                    prospect.status?.type
                )
            ) {
                return false;
            }

            const entryAge = Number(prospect.youthEntryAge);
            const seasonsPlayed = Number(prospect.youthSeasonsPlayed);
            const youthHistory = Array.isArray(prospect.youthSeasonHistory)
                ? prospect.youthSeasonHistory
                : [];

            if (
                !Number.isInteger(entryAge) ||
                entryAge < 8 ||
                entryAge > 11 ||
                !Number.isInteger(seasonsPlayed) ||
                seasonsPlayed < 0
            ) {
                return false;
            }

            const requiredSeasons = 12 - entryAge;

            const documentedSeasonYears = new Set(
                youthHistory
                    .filter(season =>
                        season?.year != null &&
                        Number.isInteger(Number(season.year))
                    )
                    .map(season => Number(season.year))
            ).size;

            return (
                seasonsPlayed >= requiredSeasons &&
                documentedSeasonYears >= requiredSeasons
            );
        });

        // Unqualified legacy or filler prospects remain in the player pool
        // as free agents rather than being silently admitted to the draft.
        incomingDraftClass.forEach(prospect => {
            if (
                !prospect ||
                prospect.teamId ||
                game.draftClass.includes(prospect) ||
                prospect.lifecycle !== 'draft_eligible'
            ) {
                return;
            }

            prospect.lifecycle = 'active';

            if (!prospect.personality) {
                prospect.personality = {};
            }

            prospect.personality.entersDraft = false;
        });
    }
}

/**
 * AI executes a pick using calculateDraftValue from the eligible draft pool.
 */
export function simulateAIPick(team) {
    if (!team || !game || (team.roster?.length || 0) >= getCurrentRosterLimit(game)) return null;

    const availableProspects = (game.draftClass || []).filter(
        prospect => prospect && !prospect.teamId
    );

    if (availableProspects.length === 0) return null;

    let bestProspect = null;
    let highestValue = -Infinity;

    availableProspects.forEach(prospect => {
        const val = calculateDraftValue(prospect, team);
        if (val > highestValue) {
            highestValue = val;
            bestProspect = prospect;
        }
    });

    if (bestProspect) {
        // Do not consume a draft prospect unless the roster addition succeeds.
        const added = addPlayerToTeam(bestProspect, team);

        if (!added) {
            return null;
        }

        bestProspect.lifecycle = 'active';
        game.draftClass = (game.draftClass || []).filter(
            p => p.id !== bestProspect.id
        );
    }
    return bestProspect;
}

export function simulateHistoricalDraft(yearNum) {
    if (!game) return;
    setupDraft();
    const draftResults = [];

    while (
        game.currentPick < game.draftOrder.length &&
        (game.draftClass || []).some(
            prospect => prospect && !prospect.teamId
        )
    ) {
        const team = game.draftOrder[game.currentPick];
        const pickedPlayer = simulateAIPick(team);
        if (pickedPlayer) {
            draftResults.push({
                pick: game.currentPick + 1,
                teamName: team.name,
                playerName: pickedPlayer.name,
                pos: estimateBestPosition(pickedPlayer)
            });
        }
        game.currentPick++;
    }
    completeDraft();

    if (game.history && game.history.seasons) {
        const season = game.history.seasons.find(s => s.year === yearNum);
        if (season) season.draftResults = draftResults;
    }

    return draftResults;
}
/**
 * Concludes the draft: undrafted rookies become active street Free Agents.
 */
export function completeDraft() {
    if (!game || !game.draftClass) return;

    // Remaining undrafted prospects hit neighborhood free agency
    game.draftClass.forEach(prospect => {
        if (!prospect.teamId) {
            prospect.lifecycle = 'active';
        }
    });
    game.draftClass = [];
}
