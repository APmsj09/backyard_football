
import { getTeamScoutingReport, setTeamScoutingReport } from './state.js';
import { calculateOverall, positionOverallWeights } from './player.js';
import { isPlayerViableForPosition } from './depth_chart.js';

const OFFENSE = ['QB', 'RB', 'WR', 'TE', 'OL'];
const DEFENSE = ['DL', 'LB', 'DB'];
const LEVEL_AT = [0, 4, 12, 24, 40];
const RADIUS = { 1: 14, 2: 10, 3: 6, 4: 3 };
const CONFIDENCE = { 1: 0.34, 2: 0.52, 3: 0.72, 4: 0.86 };
const GRADES = ['A', 'B', 'C', 'D', 'F'];
const PUBLIC_MEASUREMENTS = new Set(['height', 'weight']);
const TECHNIQUE_SKILLS = new Set([
    'blocking', 'catchingHands', 'tackling', 'coverage',
    'passCoverage', 'blockShedding'
]);

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function stableNoise(seed) {
    let hash = 2166136261;

    for (let i = 0; i < seed.length; i++) {
        hash ^= seed.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }

    return ((hash >>> 0) / 4294967295) * 2 - 1;
}

function getEvaluatorProfile(evaluator) {
    const r = evaluator?.ratings || {};
    const physical = clamp(Number(r.evalPhysicals ?? 50), 1, 99);
    const technique = clamp(Number(r.evalTechnique ?? 50), 1, 99);
    const character = clamp(Number(r.evalCharacter ?? 50), 1, 99);

    return {
        physical,
        technique,
        character,
        overall: (physical + technique + character) / 3,
        bias: evaluator?.biases?.scouting?.name ||
            evaluator?.scoutingBias ||
            'Objective Scout'
    };
}

function buildAttributeRanges(team, player, evaluator, level, profile) {
    const result = {};

    for (const [category, attrs] of Object.entries(player.attributes || {})) {
        if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) continue;

        const bucket = {};

        for (const [attr, actual] of Object.entries(attrs)) {
            if (PUBLIC_MEASUREMENTS.has(attr) || typeof actual !== 'number') continue;

            const skill = category === 'physical'
                ? profile.physical
                : category === 'technical'
                    ? profile.technique
                    : (profile.technique + profile.character) / 2;

            let radius = RADIUS[level] * (1.25 - skill / 200);

            if (profile.bias === 'Speed Chaser' && category === 'technical') {
                radius *= 1.2;
            }

            if (profile.bias === 'Technique Purist') {
                radius *= category === 'technical' ? 0.85 : 1.1;
            }

            radius = Math.max(2, Math.round(radius));

            let bias = 0;

            if (profile.bias === 'Speed Chaser' && attr === 'speed') bias = 4;
            if (profile.bias === 'Speed Chaser' && attr === 'explosiveness') bias = 2;

            if (profile.bias === 'Technique Purist' && TECHNIQUE_SKILLS.has(attr)) {
                bias = 2;
            }

            const seed = [
                team.id,
                player.id,
                evaluator?.id || evaluator?.name || 'staff',
                level,
                category,
                attr
            ].join('|');

            const estimate = clamp(
                Math.round(actual + stableNoise(seed) * radius * 0.65 + bias),
                1,
                99
            );

            bucket[attr] = {
                low: Math.max(1, estimate - radius),
                high: Math.min(99, estimate + radius)
            };
        }

        if (Object.keys(bucket).length) result[category] = bucket;
    }

    return result;
}

function buildEstimatedPlayer(player, ranges, edge = 'mid') {
    const attributes = {};

    for (const [category, attrs] of Object.entries(player.attributes || {})) {
        attributes[category] = {};

        for (const [attr, actual] of Object.entries(attrs || {})) {
            if (PUBLIC_MEASUREMENTS.has(attr) && typeof actual === 'number') {
                attributes[category][attr] = actual;
                continue;
            }

            const range = ranges[category]?.[attr];
            if (!range) continue;

            attributes[category][attr] = edge === 'low'
                ? range.low
                : edge === 'high'
                    ? range.high
                    : Math.round((range.low + range.high) / 2);
        }
    }

    // Use only the listed position as public identity.
    // Never use hidden favorite positions to determine external-player fits.
    return {
        id: player.id,
        age: player.age,
        pos: player.pos,
        favoriteOffensivePosition: OFFENSE.includes(player.pos) ? player.pos : null,
        favoriteDefensivePosition: DEFENSE.includes(player.pos) ? player.pos : null,
        attributes
    };
}

function getBestPositionFit(center, lowPlayer, highPlayer, positions) {
    const supported = positions.filter(pos => positionOverallWeights[pos]);

    // Viability is evaluated from estimated attributes and public identity,
    // not the prospect's hidden actual attributes.
    const viable = supported.filter(pos => isPlayerViableForPosition(center, pos));
    const candidates = viable.length ? viable : supported;

    candidates.sort((a, b) =>
        calculateOverall(center, b) - calculateOverall(center, a)
    );

    const position = candidates[0];
    if (!position) return null;

    const low = calculateOverall(lowPlayer, position);
    const high = calculateOverall(highPlayer, position);

    return {
        position,
        low: Math.min(low, high),
        high: Math.max(low, high)
    };
}

function estimatePotential(team, player, evaluator, level) {
    const actualIndex = GRADES.indexOf(player.potential);
    if (actualIndex < 0) return null;

    const seed = [
        team.id,
        player.id,
        evaluator?.id || evaluator?.name || 'staff',
        level,
        'potential'
    ].join('|');

    const estimatedIndex = clamp(
        actualIndex + Math.round(stableNoise(seed) * (level === 1 ? 2 : 1)),
        0,
        GRADES.length - 1
    );

    const radius = level <= 2 ? 2 : 1;

    return {
        bestPossible: GRADES[Math.max(0, estimatedIndex - radius)],
        worstPossible: GRADES[Math.min(GRADES.length - 1, estimatedIndex + radius)]
    };
}

function generateEvaluation(team, player, evaluator, level, ranges) {
    const center = buildEstimatedPlayer(player, ranges);
    const low = buildEstimatedPlayer(player, ranges, 'low');
    const high = buildEstimatedPlayer(player, ranges, 'high');

    const offenseFit = getBestPositionFit(center, low, high, OFFENSE);
    const defenseFit = getBestPositionFit(center, low, high, DEFENSE);

    const estimated = Object.values(ranges).flatMap(group =>
        Object.entries(group).map(([attribute, range]) => ({
            attribute,
            value: Math.round((range.low + range.high) / 2)
        }))
    );

    const strengths = estimated
        .filter(x => x.value >= 75)
        .sort((a, b) => b.value - a.value)
        .slice(0, 3)
        .map(x => `Estimated strength: ${x.attribute} (${x.value})`);

    const concerns = estimated
        .filter(x => x.value <= 45)
        .sort((a, b) => a.value - b.value)
        .slice(0, 3)
        .map(x => `Area to investigate: ${x.attribute} (estimated ${x.value})`);

    const best = Math.max(
        offenseFit?.low || 0,
        offenseFit?.high || 0,
        defenseFit?.low || 0,
        defenseFit?.high || 0
    );

    return {
        potentialRange: estimatePotential(team, player, evaluator, level),
        evaluation: {
            offenseFit,
            defenseFit,
            strengths,
            concerns,
            projectedRole: best >= 82
                ? 'Potential impact starter'
                : best >= 72
                    ? 'Potential starter'
                    : best >= 60
                        ? 'Developmental rotation option'
                        : 'Long-term development project',
            summary: `${offenseFit ? `OFF ${offenseFit.position}` : 'OFF fit unclear'} / ${defenseFit ? `DEF ${defenseFit.position}` : 'DEF fit unclear'}; estimates reflect the evaluator's report.`
        }
    };
}

function getLevelForProgress(points) {
    let level = 0;

    for (let candidate = 1; candidate <= 4; candidate++) {
        if (points >= LEVEL_AT[candidate]) level = candidate;
    }

    return level;
}

/**
 * Adds scouting work, measured in hours.
 * Call from the future weekly staff-work resolver, never from UI rendering
 * or the live simulation loop.
 */
export function advanceTeamScoutingReport(
    team,
    player,
    evaluator,
    hours,
    year = null,
    week = null
) {
    if (
        !team ||
        !player?.id ||
        !player.attributes ||
        !Number.isFinite(Number(hours)) ||
        Number(hours) <= 0
    ) {
        return false;
    }

    // The team's own roster does not need scouting.
    if (player.teamId === team.id || team.roster?.includes(player.id)) return false;

    const previous = getTeamScoutingReport(team, player.id);
    const profile = getEvaluatorProfile(evaluator);
    const productivity = 0.75 + profile.overall / 200;

    const previousProgress = Number.isFinite(Number(previous?.progressPoints))
        ? Math.max(0, Number(previous.progressPoints))
        : 0;

    const progressPoints = Math.min(
        LEVEL_AT[4],
        previousProgress + Number(hours) * productivity
    );

    const level = Math.max(
        Number(previous?.level) || 0,
        getLevelForProgress(progressPoints)
    );

    const evaluatedYear = Number.isInteger(year)
        ? year
        : previous?.evaluatedYear ?? null;

    const evaluatedWeek = Number.isInteger(week)
        ? week
        : previous?.evaluatedWeek ?? null;

    // Within a level, update progress without recalculating or rerolling estimates.
    if (previous && level === previous.level) {
        const stored = team.scoutingReports?.[String(player.id)];
        if (!stored) return false;

        stored.progressPoints = progressPoints;

        if (Number.isInteger(year)) stored.evaluatedYear = evaluatedYear;
        if (Number.isInteger(week)) stored.evaluatedWeek = evaluatedWeek;

        return true;
    }

    // Preserve partial progress without revealing ratings before the first report.
    if (level === 0) {
        return setTeamScoutingReport(team, player.id, {
            level: 0,
            progressPoints,
            confidence: 0,
            attributeRanges: {},
            potentialRange: null,
            evaluation: {},
            evaluatorId: evaluator?.id || null,
            evaluatedYear,
            evaluatedWeek
        });
    }

    const attributeRanges = buildAttributeRanges(
        team, player, evaluator, level, profile
    );

    const report = generateEvaluation(
        team, player, evaluator, level, attributeRanges
    );

    const confidence = clamp(
        CONFIDENCE[level] + (profile.overall - 50) / 1000,
        0.2,
        0.94
    );

    return setTeamScoutingReport(team, player.id, {
        level,
        progressPoints,
        confidence,
        attributeRanges,
        potentialRange: report.potentialRange,
        evaluation: report.evaluation,
        evaluatorId: evaluator?.id || null,
        evaluatedYear,
        evaluatedWeek
    });
}
const SCOUTING_WORK_FOCI = new Set([
    'watchlist',
    'draft',
    'freeAgents',
    'opponents',
    'all'
]);

const STAFF_WORK_TASKS = new Set([
    'scouting',
    'training',
    'offensePrep',
    'defensePrep'
]);

function getAvailableScoutingStaff(team) {
    const members = [
        ...(Array.isArray(team.coaches) ? team.coaches : []),
        ...Object.values(team.staff || {}),
        team.coach
    ];

    const unique = new Map();

    for (const member of members) {
        if (member?.id) unique.set(String(member.id), member);
    }

    return unique;
}

function getScoutingTargetIds(team, gameState, assignment) {
    if (Array.isArray(assignment.targetPlayerIds)) {
        return new Set(assignment.targetPlayerIds.map(String));
    }

    if (assignment.focus === 'watchlist') {
        return new Set(
            (team.scoutingWatchlist || [])
                .map(item => typeof item === 'object'
                    ? item.playerId ?? item.id
                    : item)
                .filter(id => id != null)
                .map(String)
        );
    }

    if (assignment.focus === 'draft') {
        const draftClass = Array.isArray(gameState.draftClass)
            ? gameState.draftClass
            : [];

        if (draftClass.length > 0) {
            return new Set(
                draftClass
                    .map(item => typeof item === 'object' ? item.id : item)
                    .filter(id => id != null)
                    .map(String)
            );
        }
    }

    return null;
}

function getScoutingCandidates(team, gameState, assignment, year, week) {
    const players = Array.isArray(gameState.players)
        ? gameState.players
        : [];

    const teams = Array.isArray(gameState.teams)
        ? gameState.teams
        : [];

    const teamById = new Map(
        teams.filter(Boolean).map(otherTeam => [
            String(otherTeam.id),
            otherTeam
        ])
    );

    const ownRoster = new Set((team.roster || []).map(String));
    const targetIds = getScoutingTargetIds(team, gameState, assignment);
    const focus = assignment.focus;

    if (!SCOUTING_WORK_FOCI.has(focus)) return [];

    const minAge = Number.isFinite(team.ageMin) ? team.ageMin : 12;
    const maxAge = Number.isFinite(team.ageMax) ? team.ageMax : 18;

    const candidates = [];

    for (const player of players) {
        if (
            !player?.id ||
            !player.attributes ||
            player.teamId === team.id ||
            ownRoster.has(String(player.id)) ||
            player.status?.type === 'retired' ||
            player.status?.type === 'departed' ||
            player.status?.type === 'temporary' ||
            !Number.isFinite(player.age) ||
            player.age < minAge ||
            player.age > maxAge
        ) {
            continue;
        }

        const isFreeAgent = !player.teamId;
        const otherTeam = player.teamId
            ? teamById.get(String(player.teamId))
            : null;

        if (focus === 'draft') {
            const isDraftTarget = targetIds
                ? targetIds.has(String(player.id))
                : isFreeAgent && player.age === 12;

            if (!isDraftTarget) continue;
        } else if (focus === 'freeAgents') {
            if (!isFreeAgent) continue;
        } else if (focus === 'opponents') {
            if (!otherTeam || otherTeam.leagueType !== 'main') continue;
        } else if (focus === 'watchlist') {
            if (!targetIds?.has(String(player.id))) continue;
        }

        if (targetIds && focus !== 'watchlist' && focus !== 'draft') {
            if (!targetIds.has(String(player.id))) continue;
        }

        const previous = getTeamScoutingReport(team, player.id);

        // Fully scouted players no longer consume routine scouting time.
        if ((Number(previous?.level) || 0) >= 4) continue;

        candidates.push({ player, previous });
    }

    // Finish partially completed reports before starting new ones.
    // Rotate the unscouted pool deterministically by week, avoiding repeated
    // preference for the same early entries in gameState.players.
    candidates.sort((a, b) => {
        const aProgress = Number(a.previous?.progressPoints) || 0;
        const bProgress = Number(b.previous?.progressPoints) || 0;

        if ((aProgress > 0) !== (bProgress > 0)) {
            return aProgress > 0 ? -1 : 1;
        }

        if (aProgress > 0 && aProgress !== bProgress) {
            return bProgress - aProgress;
        }

        const aOrder = stableNoise(
            `${team.id}|${a.player.id}|${year}|${week}|${focus}`
        );
        const bOrder = stableNoise(
            `${team.id}|${b.player.id}|${year}|${week}|${focus}`
        );

        return bOrder - aOrder;
    });

    return candidates;
}

/**
 * Resolves the scouting portion of a team's weekly staff work.
 *
 * Expected plan:
 * team.staffWorkPlan = {
 *     weeklyHoursPerCoach: 40,
 *     assignments: [
 *         {
 *             coachId: '...',
 *             task: 'scouting',
 *             hours: 8,
 *             focus: 'draft',
 *             maxTargets: 2
 *         }
 *     ]
 * }
 *
 * Other recognized task types reserve the coach's hours for the future
 * training and game-preparation resolvers, but are not executed here yet.
 */
export function processWeeklyScoutingAssignments(
    team,
    gameState,
    year = gameState?.year,
    week = gameState?.currentWeek
) {
    const plan = team?.staffWorkPlan;

    if (
        !team ||
        !gameState ||
        !plan ||
        !Array.isArray(plan.assignments) ||
        !Number.isInteger(year) ||
        !Number.isInteger(week)
    ) {
        return { playersUpdated: 0, hoursUsed: 0 };
    }

    const scoutingAssignments = plan.assignments.filter(
        assignment =>
            assignment?.task === 'scouting' &&
            Number(assignment.hours) > 0 &&
            SCOUTING_WORK_FOCI.has(assignment.focus)
    );

    if (scoutingAssignments.length === 0) {
        return { playersUpdated: 0, hoursUsed: 0 };
    }

    const weekKey = `${year}:${week}`;

    if (team.scoutingWorkLastResolvedKey === weekKey) {
        return { playersUpdated: 0, hoursUsed: 0 };
    }

    const staffById = getAvailableScoutingStaff(team);
    const weeklyHoursPerCoach = Number.isFinite(plan.weeklyHoursPerCoach)
        ? Math.max(0, plan.weeklyHoursPerCoach)
        : 40;

    const usedHoursByCoach = new Map();
    let playersUpdated = 0;
    let hoursUsed = 0;

    for (const assignment of plan.assignments) {
        if (
            !assignment?.coachId ||
            !STAFF_WORK_TASKS.has(assignment.task)
        ) {
            continue;
        }

        const coachId = String(assignment.coachId);
        const coach = staffById.get(coachId);

        if (!coach) continue;

        const requestedHours = Number(assignment.hours);

        if (!Number.isFinite(requestedHours) || requestedHours <= 0) {
            continue;
        }

        const alreadyUsed = usedHoursByCoach.get(coachId) || 0;
        const remaining = Math.max(0, weeklyHoursPerCoach - alreadyUsed);
        const allocatedHours = Math.min(requestedHours, remaining);

        if (allocatedHours <= 0) continue;

        // All recognized tasks count against the same weekly coach budget.
        usedHoursByCoach.set(coachId, alreadyUsed + allocatedHours);

        if (assignment.task !== 'scouting') continue;

        const candidates = getScoutingCandidates(
            team,
            gameState,
            assignment,
            year,
            week
        );

        if (candidates.length === 0) continue;

        const defaultTargetCount = Math.max(
            1,
            Math.floor(allocatedHours / 4)
        );

        const requestedTargetCount = Number(assignment.maxTargets);

        const targetCount = Math.min(
            candidates.length,
            12,
            Number.isInteger(requestedTargetCount) && requestedTargetCount > 0
                ? requestedTargetCount
                : defaultTargetCount
        );

        const selected = candidates.slice(0, targetCount);
        const hoursPerTarget = allocatedHours / selected.length;

        for (const { player } of selected) {
            if (advanceTeamScoutingReport(
                team,
                player,
                coach,
                hoursPerTarget,
                year,
                week
            )) {
                playersUpdated++;
            }
        }

        hoursUsed += allocatedHours;
    }

    team.scoutingWorkLastResolvedKey = weekKey;

    return { playersUpdated, hoursUsed };
}