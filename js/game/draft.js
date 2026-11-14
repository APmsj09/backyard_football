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
import {
    addPlayerToTeam,
    getCurrentRosterLimit,
    OFFSEASON_PHASES,
    transitionOffseasonPhase
} from './season.js';
import { isDebugMode } from './debug_mode.js';

export const DRAFT_ROUNDS_ROOKIE = 3;

const INELIGIBLE_DRAFT_STATUSES = new Set([
    'retired',
    'departed',
    'temporary'
]);

/**
 * Authoritative draft eligibility check.
 *
 * Year 1 is the inaugural draft and retains its separate eligibility rule.
 * Year 2 onward requires a documented, completed Pee Wee career.
 */
export function getDraftIneligibilityReason(prospect, year = game?.year) {
    if (!prospect) return 'missing_prospect';
    if (prospect.teamId) return 'already_on_team';

    if (Number(year) === 1) {
        if (Number(prospect.age) < 11) return 'inaugural_too_young';
        if (prospect.personality?.entersDraft === false) return 'opted_out';
        return null;
    }

    const age = Number(prospect.age);
    if (prospect.lifecycle !== 'draft_eligible') return 'lifecycle_not_draft_eligible';
    if (!Number.isInteger(age) || age < 12) return 'under_12';
    if (prospect.personality?.entersDraft === false) return 'opted_out';
    if (INELIGIBLE_DRAFT_STATUSES.has(prospect.status?.type)) {
        return `status_${prospect.status.type}`;
    }

    const entryAge = Number(prospect.youthEntryAge);
    const seasonsPlayed = Number(prospect.youthSeasonsPlayed);
    if (!Number.isInteger(entryAge) || entryAge < 8 || entryAge > 11) return 'bad_youth_entry_age';
    if (!Number.isInteger(seasonsPlayed) || seasonsPlayed < 0) return 'bad_youth_seasons_played';

    const requiredSeasons = 12 - entryAge;
    const history = Array.isArray(prospect.youthSeasonHistory) ? prospect.youthSeasonHistory : [];
    const documentedSeasonYears = new Set(
        history
            .filter(s => s?.year != null && Number.isInteger(Number(s.year)))
            .map(s => Number(s.year))
    ).size;

    if (seasonsPlayed < requiredSeasons) return 'too_few_seasons_counter';
    if (documentedSeasonYears < requiredSeasons) return 'too_few_seasons_documented';
    return null;
}

export function isEligibleDraftProspect(prospect, year = game?.year) {
    return getDraftIneligibilityReason(prospect, year) === null;
}

function logDraftClassAudit(incoming, year) {
    if (!isDebugMode()) return;
    const reasons = {};
    incoming.forEach(p => {
        const r = getDraftIneligibilityReason(p, year) || 'ELIGIBLE';
        reasons[r] = (reasons[r] || 0) + 1;
    });
    const youthRosterIds = new Set(
        game.teams.filter(t => t.leagueType === 'youth')
            .flatMap(t => (t.roster || []).map(String))
    );
    const orphanedYouth = game.players.filter(
        p => p?.lifecycle === 'youth' && !youthRosterIds.has(String(p.id))
    ).length;
    console.info('[Draft Audit]', { year, incoming: incoming.length, reasons, orphanedYouth });
}

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

    const scout = team.staff?.scout || team.coaches?.[1] || team.coach;
    const coach = team.staff?.coach || team.coach || team.coaches?.[0];

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
    const gmDirective =
        team.aiGmProfile?.strategicDirective ||
        team.gameplan?.gmDirective ||
        'COACH_AUTONOMY';
    const coachPersonalityId =
        coach?.profileIds?.personality ||
        coach?.biases?.personality?.id ||
        coach?.biases?.personality?.name;

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

    // Scout & Coach Personality Bias (using only this team's scouting report)
    const scoutBiasId =
        scout?.profileIds?.scouting ||
        scout?.biases?.scouting?.id ||
        scout?.biases?.scouting?.name;

    if (scoutBiasId === 'athletic_bias_evaluator' || scoutBiasId === 'Speed Chaser') {
        const spd = estimatedPlayer.attributes?.physical?.speed || 50;
        if (spd > 68) abilityScore += (spd - 68) * 0.45;
    } else if (scoutBiasId === 'technique_first_evaluator' || scoutBiasId === 'Technique Purist') {
        const techValues = Object.values(estimatedPlayer.attributes?.technical || {}).filter(Number.isFinite);
        const avgTech = techValues.length > 0
            ? techValues.reduce((s, v) => s + v, 0) / techValues.length
            : 50;
        if (avgTech > 62) abilityScore += (avgTech - 62) * 0.35;
    } else if (
        scoutBiasId === 'character_focused_evaluator' ||
        scoutBiasId === 'Character First' ||
        coachPersonalityId === 'traditionalist' ||
        coachPersonalityId === 'Old-School Disciplinarian'
    ) {
        const charSummary = String(report?.evaluation?.characterSummary || '').toLowerCase();
        if (charSummary.includes('strong effort/reliability signals')) abilityScore += 3.5;
        else if (charSummary.includes('effort/reliability need closer review')) abilityScore -= 3.5;
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
    // Evaluate offensive and defensive roster needs independently, including starter quality and graduating seniors.
    const roster = getRosterObjects(team);
    const positionCounts = {};
    const returningCounts = {};
    const topStarterOvrByPos = {};

    Object.keys(positionOverallWeights).forEach(position => {
        const viable = roster.filter(p => isPlayerViableForPosition(p, position));
        positionCounts[position] = viable.length;
        returningCounts[position] = viable.filter(p => (Number(p.age) || 14) < 18).length;
        topStarterOvrByPos[position] = viable.length > 0
            ? Math.max(...viable.map(p => calculateOverall(p, position)))
            : 0;
    });

    const offensePersonnel =
        offenseFormations[team.formations?.offense]?.personnel || {};

    const defensePersonnel =
        defenseFormations[team.formations?.defense]?.personnel || {};

    function getPositionNeedMultiplier(position, personnel) {
        const formationTarget = Number(personnel[position]) || 0;
        const countAtPos = positionCounts[position] || 0;
        const returningAtPos = returningCounts[position] || 0;
        const topStarterOvr = topStarterOvrByPos[position] || 0;

        if (formationTarget <= 0) {
            return 0.75;
        }

        const effectiveDepth = (countAtPos * 0.65) + (returningAtPos * 0.35);
        const positionGap = formationTarget - effectiveDepth;
        let mult = positionGap > 0
            ? 1.0 + Math.min(0.60, positionGap * 0.20)
            : Math.max(0.70, 1.0 - Math.min(0.30, Math.abs(positionGap) * 0.10));

        // Boost urgency when the current best starter at that spot is weak (< 52 OVR).
        if (topStarterOvr < 52) {
            mult += position === 'QB' ? 0.22 : 0.10;
        }

        return Math.min(1.75, mult);
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

    // 4. Coach Tactical Philosophy & Attribute Fit (10%)
    const tacticalId =
        coach?.profileIds?.tactical ||
        coach?.biases?.tactical?.id ||
        coach?.biases?.tactical?.name ||
        'adaptive_strategist';

    const estPhys = estimatedPlayer.attributes?.physical || {};
    const estMent = estimatedPlayer.attributes?.mental || {};
    const estTech = estimatedPlayer.attributes?.technical || {};
    let coachFit = 0;

    if (tacticalId === 'power_run_specialist' || tacticalId === 'Smashmouth Zealot') {
        if (['OL', 'RB', 'TE'].includes(fits.offense.position)) coachFit += 4;
        if (fits.defense.position === 'DL') coachFit += 3;
        coachFit += (((estPhys.strength || 50) + (estTech.blocking || 50)) / 2 - 50) * 0.15;
    } else if (tacticalId === 'spread_passing_specialist' || tacticalId === 'Air Raid Purist') {
        if (['QB', 'WR'].includes(fits.offense.position)) coachFit += 4;
        coachFit += (((estPhys.speed || 50) + (estTech.throwingAccuracy || 50) + (estTech.catchingHands || 50)) / 3 - 50) * 0.15;
    } else if (tacticalId === 'pressure_oriented_defender' || tacticalId === 'Blitz Addict') {
        if (['DL', 'LB', 'DB'].includes(fits.defense.position)) coachFit += 3.5;
        coachFit += (((estTech.blockShedding || 50) + (estPhys.speed || 50) + (estTech.coverage || 50)) / 3 - 50) * 0.15;
    } else if (tacticalId === 'conservative_game_manager' || tacticalId === 'Conservative Turtler') {
        coachFit += (((estMent.playbookIQ || 50) + (estMent.consistency || 50) + (estTech.carrying || 50)) / 3 - 50) * 0.15;
    } else {
        coachFit += (((estMent.playbookIQ || 50) + (estPhys.agility || 50)) / 2 - 50) * 0.08;
    }

    const fitScore = Math.max(-10, Math.min(15, coachFit)) * 0.15;

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
        game.draftClass = game.players.filter(
            prospect => isEligibleDraftProspect(prospect, game.year)
        );

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
        const incomingDraftClass = Array.isArray(game.draftClass) ? game.draftClass : [];
        logDraftClassAudit(incomingDraftClass, game.year);

        game.draftClass = incomingDraftClass.filter(
            prospect => isEligibleDraftProspect(prospect, game.year)
        );

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
        prospect => isEligibleDraftProspect(prospect, game.year)
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
    completeDraft({ transitionToRecruiting: false });

    if (game.history && game.history.seasons) {
        const season = game.history.seasons.find(s => s.year === yearNum);
        if (season) season.draftResults = draftResults;
    }

    return draftResults;
}
/**
 * Concludes the draft: undrafted rookies become active street Free Agents.
 */
export function completeDraft({
    transitionToRecruiting = true
} = {}) {
    if (!game || !game.draftClass) return;

    // Remaining undrafted prospects hit neighborhood free agency
    game.draftClass.forEach(prospect => {
        if (!prospect.teamId) {
            prospect.lifecycle = 'active';
        }
    });

    game.draftClass = [];

    // Historical drafts must not advance the live offseason.
    // A live draft proceeds to the seven-day recruiting event.
    if (
        transitionToRecruiting &&
        game.offseasonState?.phase === OFFSEASON_PHASES.DRAFT
    ) {
        const transitionResult = transitionOffseasonPhase(
            OFFSEASON_PHASES.RECRUITING,
            game
        );

        if (!transitionResult.success) {
            addMessage(
                'Offseason Transition Error',
                transitionResult.message,
                false,
                game
            );
        }
    }
}
