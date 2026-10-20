
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
