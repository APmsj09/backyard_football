import { getTeamScoutingReport, setTeamScoutingReport } from './state.js';
import { calculateOverall, positionOverallWeights } from './player.js';
import { isPlayerViableForPosition } from './depth_chart.js';
import {
    ensureTeamStaffWorkPlan,
    WEEKLY_COACH_HOURS,
    getTeamCoachingSpecialist,
    recordCoachDevelopmentOutcome
} from './staff.js';

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

function getEvaluatorProfile(evaluator, team, player) {
    const r = evaluator?.ratings || {};
    const physical = clamp(Number(r.evalPhysicals ?? 50), 1, 99);
    const technique = clamp(Number(r.evalTechnique ?? 50), 1, 99);
    const character = clamp(Number(r.evalCharacter ?? 50), 1, 99);

    // GM expertise applies only when the user-coach performs the evaluation.
    const gmProfile = evaluator?.isUserCoach
        ? team?.gmProfile
        : null;

    const rawGeneralBonus = Number(gmProfile?.bonuses?.scoutingAccuracy);
    const generalAccuracyBonus = Number.isFinite(rawGeneralBonus)
        ? rawGeneralBonus
        : 0;

    const expertisePositions = Array.isArray(gmProfile?.expertisePositions)
        ? gmProfile.expertisePositions
        : [];

    const rawExpertiseBonus = Number(gmProfile?.expertiseScoutingBonus);
    const hasRelevantExpertise = Boolean(
        player?.pos &&
        expertisePositions.includes(player.pos)
    );

    const expertiseAccuracyBonus =
        hasRelevantExpertise && Number.isFinite(rawExpertiseBonus)
            ? rawExpertiseBonus
            : 0;

    return {
        physical,
        technique,
        character,
        overall: (physical + technique + character) / 3,
        accuracyBonus: clamp(
            generalAccuracyBonus + expertiseAccuracyBonus,
            -0.25,
            0.35
        ),
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

            const accuracyMultiplier = clamp(
                1 - profile.accuracyBonus,
                0.65,
                1.25
            );

            radius = Math.max(
                2,
                Math.round(radius * accuracyMultiplier)
            );

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

function estimatePotential(team, player, evaluator, level, ranges) {
    const age = Number(player?.age);

    // Pee Wee potential must be inferred from the scout's estimated
    // attributes, not read directly from the player's hidden potential.
    if (Number.isInteger(age) && age >= 8 && age <= 11) {
        const youthProgress = Math.max(0, Math.min(1, (age - 8) / 3));

        const developmentScale = {
            physical: 0.52 + (youthProgress * 0.18),
            mental: 0.48 + (youthProgress * 0.18),
            technical: 0.45 + (youthProgress * 0.20)
        };

        const inferredTalent = [];

        for (const [category, attributes] of Object.entries(ranges || {})) {
            const scale = developmentScale[category];

            if (!Number.isFinite(scale) || scale <= 0) continue;

            for (const range of Object.values(attributes || {})) {
                const low = Number(range?.low);
                const high = Number(range?.high);

                if (!Number.isFinite(low) || !Number.isFinite(high)) continue;

                const estimatedCurrent = (low + high) / 2;

                inferredTalent.push(
                    clamp(estimatedCurrent / scale, 0, 100)
                );
            }
        }

        if (inferredTalent.length === 0) return null;

        const averageEstimatedTalent =
            inferredTalent.reduce((sum, value) => sum + value, 0) /
            inferredTalent.length;

        // Approximate the generator's potential model using estimated talent
        // and a neutral background component. This is an estimate, not a
        // reconstruction of the player's actual hidden potential.
        const profile = getEvaluatorProfile(evaluator, team, player);

        const scoutAccuracyFactor = clamp(
            1.2 - profile.overall / 100,
            0.55,
            1.1
        );

        const uncertaintyPoints = {
            1: 8,
            2: 5,
            3: 3,
            4: 1.5
        }[level] ?? 8;

        const seed = [
            team.id,
            player.id,
            evaluator?.id || evaluator?.name || 'staff',
            level,
            'youth-potential'
        ].join('|');

        const estimatedScore =
            averageEstimatedTalent * 0.75 +
            65 * 0.25 +
            stableNoise(seed) * uncertaintyPoints * scoutAccuracyFactor;

        const estimatedIndex = estimatedScore >= 88
            ? 0
            : estimatedScore >= 76
                ? 1
                : estimatedScore >= 58
                    ? 2
                    : estimatedScore >= 43
                        ? 3
                        : 4;

        const radius = level <= 2 ? 2 : 1;

        return {
            bestPossible: GRADES[Math.max(0, estimatedIndex - radius)],
            worstPossible: GRADES[
                Math.min(GRADES.length - 1, estimatedIndex + radius)
            ]
        };
    }

    // Preserve the existing behavior for non-youth prospects for now.
    const actualIndex = GRADES.indexOf(player?.potential);
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
        worstPossible: GRADES[
            Math.min(GRADES.length - 1, estimatedIndex + radius)
        ]
    };
}

function estimateCharacterSummary(team, player, evaluator, level) {
    if (level < 3) return null;

    const personality = player?.personality;

    if (!personality || typeof personality !== 'object') {
        return null;
    }

    const profile = getEvaluatorProfile(evaluator, team, player);

    // Character specialists produce more precise estimates.
    // Other scouting styles are less reliable on personality evaluation.
    const biasMultiplier = profile.bias === 'Character First'
        ? 0.6
        : profile.bias === 'Objective Scout'
            ? 1
            : 1.2;

    const baseRadius = level >= 4 ? 10 : 18;

    const uncertainty =
        baseRadius *
        (1.25 - profile.character / 200) *
        biasMultiplier;

    const estimate = key => {
        const actual = Number(personality[key]);

        if (!Number.isFinite(actual)) return null;

        const noise = stableNoise(
            `character:${team?.id}:${player.id}:${evaluator?.id}:${level}:${key}`
        );

        return clamp(actual + noise * uncertainty, 0, 100);
    };

    const average = values => {
        const validValues = values.filter(Number.isFinite);

        return validValues.length
            ? validValues.reduce((sum, value) => sum + value, 0) /
                validValues.length
            : null;
    };

    const effort = average([
        estimate('workEthic'),
        estimate('dependability'),
        estimate('loyalty')
    ]);

    const teamFit = average([
        estimate('likeability'),
        estimate('loyalty'),
        (() => {
            const ego = estimate('ego');
            return ego === null ? null : 100 - ego;
        })()
    ]);

    const presence = average([
        estimate('streetCred'),
        estimate('ego')
    ]);

    if (effort === null && teamFit === null && presence === null) {
        return null;
    }

    const effortNote = effort === null
        ? null
        : effort >= 72
            ? 'Strong effort/reliability signals'
            : effort >= 48
                ? 'Generally steady effort'
                : 'Effort/reliability need closer review';

    const teamNote = teamFit === null
        ? null
        : teamFit >= 72
            ? 'team-oriented'
            : teamFit >= 48
                ? 'may fit with clear expectations'
                : 'may need relationship-building';

    const presenceNote = presence === null
        ? null
        : presence >= 72
            ? 'confident, assertive presence'
            : presence >= 48
                ? 'moderately assertive'
                : 'quieter competitive presence';

    const notes = [effortNote, teamNote, presenceNote].filter(Boolean);

    const prefix = profile.bias === 'Character First'
        ? 'Character-focused: '
        : '';

    return `${prefix}${notes.join('; ')}.`;
}

function buildYouthPerformanceSummary(player, level) {
    if (level < 2) return null;

    const history = Array.isArray(player?.youthSeasonHistory)
        ? player.youthSeasonHistory.filter(season =>
            season?.stats &&
            typeof season.stats === 'object' &&
            !Array.isArray(season.stats)
        )
        : [];

    const isActiveYouth = player?.lifecycle === 'youth';

    // Do not interpret ordinary main-league statistics as Pee Wee history.
    if (
        !isActiveYouth &&
        history.length === 0 &&
        !(Number(player?.youthSeasonsPlayed) > 0)
    ) {
        return null;
    }

    const statKeys = [
        'passYards',
        'passAttempts',
        'passCompletions',
        'interceptionsThrown',
        'rushYards',
        'rushAttempts',
        'recYards',
        'receptions',
        'targets',
        'touchdowns',
        'tackles',
        'sacks',
        'interceptions',
        'fumblesRecovered'
    ];

    const readStats = source => Object.fromEntries(
        statKeys.map(key => {
            const value = Number(source?.[key]);

            return [
                key,
                Number.isFinite(value) ? Math.max(0, value) : 0
            ];
        })
    );

    const completedTotals = readStats({});

    history.forEach(season => {
        const stats = readStats(season.stats);

        statKeys.forEach(key => {
            completedTotals[key] += stats[key];
        });
    });

    // Current-season stats have not yet been added to the completed-history
    // rows. Keep them separate so a partial season is not treated as complete.
    const currentStats = isActiveYouth
        ? readStats(player.seasonStats)
        : readStats({});

    const hasCurrentStats = statKeys.some(
        key => currentStats[key] > 0
    );

    const position = String(
        player?.pos || player?.bestPosition || ''
    ).toUpperCase();

    const completedMetrics = [];
    const currentMetrics = [];

    const addMetric = (
        destination,
        stats,
        label,
        key,
        divisor = 1
    ) => {
        if (!(stats[key] > 0)) return;

        destination.push(
            `${label} ${Math.round(stats[key] / divisor).toLocaleString('en-US')}`
        );
    };

    const addPositionMetrics = (destination, stats, divisor = 1) => {
        if (position === 'QB') {
            addMetric(destination, stats, 'Pass yards', 'passYards', divisor);

            if (stats.passAttempts > 0) {
                destination.push(
                    `Completion rate ${Math.round(
                        stats.passCompletions /
                        stats.passAttempts * 100
                    )}%`
                );
            }

            addMetric(
                destination,
                stats,
                'Interceptions thrown',
                'interceptionsThrown',
                divisor
            );
        } else if (position === 'RB') {
            addMetric(destination, stats, 'Rush yards', 'rushYards', divisor);
            addMetric(destination, stats, 'Carries', 'rushAttempts', divisor);
            addMetric(destination, stats, 'Receiving yards', 'recYards', divisor);
        } else if (position === 'WR' || position === 'TE') {
            addMetric(destination, stats, 'Receiving yards', 'recYards', divisor);
            addMetric(destination, stats, 'Receptions', 'receptions', divisor);
            addMetric(destination, stats, 'Targets', 'targets', divisor);
            addMetric(destination, stats, 'Rush yards', 'rushYards', divisor);
        } else if (['DL', 'LB', 'DB'].includes(position)) {
            addMetric(destination, stats, 'Tackles', 'tackles', divisor);
            addMetric(destination, stats, 'Sacks', 'sacks', divisor);
            addMetric(destination, stats, 'Interceptions', 'interceptions', divisor);
            addMetric(
                destination,
                stats,
                'Fumbles recovered',
                'fumblesRecovered',
                divisor
            );
        } else if (position !== 'OL') {
            addMetric(destination, stats, 'Pass yards', 'passYards', divisor);
            addMetric(destination, stats, 'Rush yards', 'rushYards', divisor);
            addMetric(destination, stats, 'Receiving yards', 'recYards', divisor);
            addMetric(destination, stats, 'Tackles', 'tackles', divisor);
        }
    };

    if (history.length > 0) {
        addPositionMetrics(
            completedMetrics,
            completedTotals,
            history.length
        );
    }

    if (hasCurrentStats) {
        addPositionMetrics(currentMetrics, currentStats);
    }

    const sections = [];

    if (history.length > 0) {
        sections.push(
            `Completed-season sample (${history.length} season${history.length === 1 ? '' : 's'}): ` +
            (
                completedMetrics.length > 0
                    ? completedMetrics.join(', ') +
                        (history.length > 1 ? ' per season on average' : '')
                    : 'no role-specific box-score production recorded'
            ) +
            '.'
        );
    }

    if (hasCurrentStats) {
        sections.push(
            `Current season so far: ${
                currentMetrics.length > 0
                    ? currentMetrics.join(', ')
                    : 'no role-specific production recorded'
            }.`
        );
    }

    if (position === 'OL') {
        sections.push(
            'Box-score stats are a weak measure of offensive-line play; ' +
            'attribute estimates and positional fit carry more weight.'
        );
    }

    if (sections.length === 0) {
        return 'Pee Wee performance: no recorded role-specific production yet.';
    }

    return `Pee Wee performance evidence: ${sections.join(' ')}`;
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
        offenseFit ? (offenseFit.low + offenseFit.high) / 2 : 0,
        defenseFit ? (defenseFit.low + defenseFit.high) / 2 : 0
    );

    return {
        potentialRange: estimatePotential(
            team,
            player,
            evaluator,
            level,
            ranges
        ),
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
            characterSummary: estimateCharacterSummary(
                team,
                player,
                evaluator,
                level
            ),
            summary: [
                `${offenseFit ? `OFF ${offenseFit.position}` : 'OFF fit unclear'} / ${defenseFit ? `DEF ${defenseFit.position}` : 'DEF fit unclear'}; estimates reflect the evaluator's report.`,
                buildYouthPerformanceSummary(player, level)
            ].filter(Boolean).join(' ')
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
    const profile = getEvaluatorProfile(evaluator, team, player);

    // Permanent Corner Store investment: Scouting Toolkit.
    // Each level improves scouting progress by 10%, up to 30%.
    // Older saves safely default to level 0.
    const scoutingToolkitLevel = Math.max(
        0,
        Math.min(
            3,
            Math.floor(
                Number(team.storeUpgrades?.scoutingToolkitLevel) || 0
            )
        )
    );

    const scoutingToolkitMultiplier =
        1 + scoutingToolkitLevel * 0.10;

    const productivity =
        (0.75 + profile.overall / 200) *
        scoutingToolkitMultiplier;

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
        CONFIDENCE[level] +
            (profile.overall - 50) / 1000 +
            profile.accuracyBonus * 0.15,
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

/**
 * Evaluates scouting accuracy when a player becomes known to the team.
 * Awards development progress to the original report evaluator.
 *
 * This function must be called at an actual reveal/acquisition event,
 * never during scouting or UI rendering.
 */
export function recordScoutingReportOutcome(
    team,
    player,
    gameState,
    year,
    week
) {
    if (
        !team ||
        !player?.id ||
        !player.attributes ||
        !Number.isInteger(year) ||
        !Number.isInteger(week)
    ) {
        return { evaluatedAttributes: 0, feedbackEvents: 0 };
    }

    const report = getTeamScoutingReport(team, player.id);

    if (
        !report ||
        !Number.isInteger(report.level) ||
        report.level < 1 ||
        !report.attributeRanges
    ) {
        return { evaluatedAttributes: 0, feedbackEvents: 0 };
    }

    const evaluatorId = report.evaluatorId;

    const evaluator =
        team.coaches?.find(
            coach => String(coach?.id) === String(evaluatorId)
        ) ||
        gameState?.availableStaff?.find(
            coach => String(coach?.id) === String(evaluatorId)
        ) ||
        gameState?.teams
            ?.flatMap(otherTeam => otherTeam?.coaches || [])
            .find(
                coach => String(coach?.id) === String(evaluatorId)
            );

    if (!evaluator) {
        return { evaluatedAttributes: 0, feedbackEvents: 0 };
    }

    const skillByCategory = {
        physical: 'evalPhysicals',
        technical: 'evalTechnique',
        mental: 'evalCharacter'
    };

    let evaluatedAttributes = 0;
    let feedbackEvents = 0;

    for (const [category, attributeRanges] of Object.entries(
        report.attributeRanges
    )) {
        const coachSkill = skillByCategory[category];

        if (!coachSkill || !attributeRanges) continue;

        let totalNormalizedError = 0;
        let categoryCount = 0;

        for (const [attribute, range] of Object.entries(attributeRanges)) {
            const actual = player.attributes?.[category]?.[attribute];

            if (
                !Number.isFinite(actual) ||
                !Number.isFinite(range?.low) ||
                !Number.isFinite(range?.high)
            ) {
                continue;
            }

            const estimate = (range.low + range.high) / 2;
            const halfWidth = Math.max(
                1,
                (range.high - range.low) / 2
            );

            // Normalize error to the report's uncertainty range.
            const normalizedError = Math.abs(actual - estimate) / halfWidth;

            totalNormalizedError += normalizedError;
            categoryCount++;
        }

        if (categoryCount === 0) continue;

        const averageError = totalNormalizedError / categoryCount;

        // Accurate reports produce positive feedback; poor reports
        // can still teach the evaluator, but may yield negative quality.
        const quality = Math.max(
            -1,
            Math.min(1, 1.1 - averageError)
        );

        const result = recordCoachDevelopmentOutcome(
            evaluator,
            'scouting',
            quality,
            `report-reveal:${team.id}:${player.id}:${category}`,
            year,
            week,
            [coachSkill]
        );

        evaluatedAttributes += categoryCount;

        if (result?.applied) {
            feedbackEvents++;
        }
    }

    return {
        evaluatedAttributes,
        feedbackEvents
    };
}


const SCOUTING_WORK_FOCI = new Set([
    'watchlist',
    'draft',
    'freeAgents',
    'opponents',
    'youth',
    'all'
]);

const STAFF_WORK_TASKS = new Set([
    'scouting',
    'training',
    'offensePrep',
    'defensePrep'
]);

function getAvailableScoutingStaff(team) {
    const coaches = Array.isArray(team.coaches) ? team.coaches : [];
    const unique = new Map();

    for (const coach of coaches) {
        if (coach?.id) unique.set(String(coach.id), coach);
    }

    return unique;
}

const TRAINING_POSITION_FOCI = new Set([
    'QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB',
    'offense', 'defense', 'all'
]);

const TRAINING_SKILLS_BY_POSITION = Object.freeze({
    QB: ['throwingAccuracy', 'throwPower', 'decisionMaking', 'playbookIQ', 'consistency'],
    RB: ['speed', 'carrying', 'agility', 'strength', 'catchingHands', 'explosiveness'],
    WR: ['speed', 'catchingHands', 'agility', 'jumping', 'explosiveness', 'consistency'],
    TE: ['catchingHands', 'blocking', 'strength', 'jumping', 'speed'],
    OL: ['blocking', 'strength', 'playbookIQ', 'toughness', 'consistency'],
    DL: ['strength', 'blockShedding', 'tackling', 'speed', 'explosiveness'],
    LB: ['tackling', 'playbookIQ', 'speed', 'strength', 'blockShedding', 'coverage'],
    DB: ['speed', 'coverage', 'agility', 'tackling', 'jumping', 'explosiveness']
});

const TRAINABLE_SKILLS = new Set([
    'speed', 'strength', 'agility', 'explosiveness', 'jumping', 'stamina',
    'playbookIQ', 'clutch', 'consistency', 'toughness', 'decisionMaking',
    'throwingAccuracy', 'throwPower', 'catchingHands', 'carrying',
    'tackling', 'blocking', 'blockShedding', 'coverage'
]);

const TRAINING_POINTS_PER_ATTRIBUTE = 24;
const MAX_WEEKLY_TRAINING_HOURS_PER_PLAYER_SKILL = 8;

function getTrainingAttribute(player, skill) {
    for (const [category, attributes] of Object.entries(player?.attributes || {})) {
        if (Number.isFinite(attributes?.[skill])) {
            return {
                category,
                value: attributes[skill]
            };
        }
    }

    return null;
}

function getTrainingPositions(player, focus) {
    if (TRAINING_SKILLS_BY_POSITION[focus]) return [focus];

    const playerPositions = [
        player.pos,
        player.favoriteOffensivePosition,
        player.favoriteDefensivePosition
    ].filter(position => TRAINING_SKILLS_BY_POSITION[position]);

    const uniquePositions = [...new Set(playerPositions)];

    if (focus === 'offense') {
        return uniquePositions.filter(position =>
            OFFENSE.includes(position)
        );
    }

    if (focus === 'defense') {
        return uniquePositions.filter(position =>
            DEFENSE.includes(position)
        );
    }

    return uniquePositions;
}

function playerMatchesTrainingFocus(player, focus) {
    if (focus === 'all' || TRAINABLE_SKILLS.has(focus)) return true;

    const positions = [
        player.pos,
        player.favoriteOffensivePosition,
        player.favoriteDefensivePosition
    ];

    if (focus === 'offense') {
        return positions.some(position => OFFENSE.includes(position));
    }

    if (focus === 'defense') {
        return positions.some(position => DEFENSE.includes(position));
    }

    return positions.includes(focus);
}

function isValidTrainingAssignment(assignment) {
    if (assignment?.task !== 'training') return false;

    const focusIsValid =
        TRAINING_POSITION_FOCI.has(assignment.focus) ||
        TRAINABLE_SKILLS.has(assignment.focus);

    const skillIsValid = assignment.skill == null ||
        TRAINABLE_SKILLS.has(assignment.skill);

    return focusIsValid && skillIsValid;
}

function getTrainingCandidates(team, assignment, playersById, coach, year, week) {
    const rosterIds = Array.isArray(team.roster) ? team.roster : [];
    const targetIds = Array.isArray(assignment.targetPlayerIds)
        ? new Set(assignment.targetPlayerIds.map(String))
        : null;

    const explicitSkill = TRAINABLE_SKILLS.has(assignment.skill)
        ? assignment.skill
        : TRAINABLE_SKILLS.has(assignment.focus)
            ? assignment.focus
            : null;

    const candidates = [];

    for (const id of rosterIds) {
        const player = playersById.get(String(id));

        if (
            !player?.attributes ||
            (player.teamId != null &&
                String(player.teamId) !== String(team.id)) ||
            Number(player.status?.duration) > 0 ||
            (targetIds && !targetIds.has(String(player.id))) ||
            !playerMatchesTrainingFocus(player, assignment.focus)
        ) {
            continue;
        }

        const positions = getTrainingPositions(player, assignment.focus);
        const possibleSkills = explicitSkill
            ? [explicitSkill]
            : [...new Set(
                positions.flatMap(position =>
                    TRAINING_SKILLS_BY_POSITION[position] || []
                )
            )];

        const availableSkills = possibleSkills.filter(skill => {
            const attribute = getTrainingAttribute(player, skill);

            return attribute && attribute.value < 99;
        });

        if (availableSkills.length === 0) continue;

        // Stable for this player, coach, assignment, and week.
        // No extra random rolls are needed when the UI rerenders.
        const seed = [
            team.id,
            player.id,
            coach.id,
            year,
            week,
            assignment.focus,
            assignment.skill || ''
        ].join('|');

        const normalizedNoise = (stableNoise(seed) + 1) / 2;
        const skillIndex = Math.min(
            availableSkills.length - 1,
            Math.floor(normalizedNoise * availableSkills.length)
        );

        const skill = availableSkills[skillIndex];
        const attribute = getTrainingAttribute(player, skill);

        if (attribute) {
            const storedProgress = Number(
                team.staffTrainingProgress?.[String(player.id)]?.[skill]
            );

            const trainingProgress = Number.isFinite(storedProgress)
                ? clamp(
                    storedProgress,
                    0,
                    TRAINING_POINTS_PER_ATTRIBUTE - 0.001
                )
                : 0;

            const rotationScore = stableNoise([
                team.id,
                player.id,
                coach.id,
                year,
                week,
                assignment.focus,
                assignment.skill || '',
                'training-rotation'
            ].join('|'));

            const age = Number.isFinite(player.age)
                ? player.age
                : 16;

            const rawWorkEthic = Number(
                player.personality?.workEthic ?? 50
            );

            const workEthic = Number.isFinite(rawWorkEthic)
                ? clamp(rawWorkEthic, 0, 100)
                : 50;

            const potentialBonus = {
                A: 1.0,
                B: 0.6,
                C: 0.25,
                D: 0,
                F: -0.25
            }[player.potential] ?? 0.25;

            // These are small selection preferences, not guarantees of growth.
            const ageBonus = clamp((18 - age) * 0.18, 0, 1.1);

            const skillGapBonus = clamp(
                (85 - attribute.value) / 15,
                0,
                3
            );

            const workEthicBonus = (workEthic - 50) * 0.01;

            const developmentPriority =
                skillGapBonus * 1.25 +
                ageBonus +
                potentialBonus +
                workEthicBonus +
                rotationScore * 1.25;

            candidates.push({
                player,
                skill,
                category: attribute.category,
                trainingProgress,
                developmentPriority,
                rotationScore
            });
        }
    }

    // First preserve work already invested; then favor players with
    // greater development need, using deterministic rotation to break ties.
    candidates.sort((a, b) =>
        b.trainingProgress - a.trainingProgress ||
        b.developmentPriority - a.developmentPriority ||
        b.rotationScore - a.rotationScore ||
        String(a.player.id).localeCompare(String(b.player.id))
    );

    // Keep internal selection scores out of the returned candidates.
    return candidates.map(({
        trainingProgress,
        developmentPriority,
        rotationScore,
        ...candidate
    }) => candidate);
}

function applyTrainingHours(
    team,
    player,
    coach,
    skill,
    category,
    hours,
    trainedThisWeek
) {
    const currentAttribute = player.attributes?.[category]?.[skill];

    if (!Number.isFinite(currentAttribute) || currentAttribute >= 99) {
        return false;
    }

    const teaching = clamp(
        Number(coach?.ratings?.teaching ?? 50),
        1,
        99
    );

    const discipline = clamp(
        Number(coach?.ratings?.practiceDiscipline ?? 50),
        1,
        99
    );

    const workEthic = clamp(
        Number(player.personality?.workEthic ?? 50),
        1,
        99
    );

    const age = Number.isFinite(player.age) ? player.age : 16;
    const ageFactor = age <= 14 ? 1.2 : age <= 16 ? 1.0 : 0.85;
    const coachFactor = 0.55 + teaching / 150 + discipline / 400;
    const ethicFactor = 0.8 + workEthic / 250;

    // Permanent Corner Store investment: training equipment.
    // Each purchased level improves progress earned from assigned
    // staff training by 10%, up to a maximum of 30%.
    // Older saves safely default to level 0.
    const trainingEquipmentLevel = Math.max(
        0,
        Math.min(
            3,
            Math.floor(
                Number(team.storeUpgrades?.trainingEquipmentLevel) || 0
            )
        )
    );

    const trainingEquipmentMultiplier =
        1 + trainingEquipmentLevel * 0.10;

    const earnedPoints = Math.max(
        0,
        hours *
            coachFactor *
            ethicFactor *
            ageFactor *
            trainingEquipmentMultiplier
    );

    if (!team.staffTrainingProgress ||
        typeof team.staffTrainingProgress !== 'object' ||
        Array.isArray(team.staffTrainingProgress)) {
        team.staffTrainingProgress = {};
    }

    const playerKey = String(player.id);

    if (
        !team.staffTrainingProgress[playerKey] ||
        typeof team.staffTrainingProgress[playerKey] !== 'object'
    ) {
        team.staffTrainingProgress[playerKey] = {};
    }

    const progress = team.staffTrainingProgress[playerKey];
    const previousPoints = Number(progress[skill]);
    let totalPoints = (
        Number.isFinite(previousPoints) ? Math.max(0, previousPoints) : 0
    ) + earnedPoints;

    const trainingKey = `${playerKey}:${skill}`;
    let improved = false;

    if (
        totalPoints >= TRAINING_POINTS_PER_ATTRIBUTE &&
        !trainedThisWeek.has(trainingKey)
    ) {
        const nextValue = Math.min(99, currentAttribute + 1);

        if (nextValue > currentAttribute) {
            player.attributes[category][skill] = nextValue;
            totalPoints -= TRAINING_POINTS_PER_ATTRIBUTE;
            trainedThisWeek.add(trainingKey);
            improved = true;
        }
    }

    // A skill cannot improve more than once per player per week through
    // this system. Preserve partial progress without stockpiling extra levels.
    if (player.attributes[category][skill] >= 99) {
        delete progress[skill];
    } else {
        if (trainedThisWeek.has(trainingKey)) {
            totalPoints = Math.min(
                totalPoints,
                TRAINING_POINTS_PER_ATTRIBUTE - 0.001
            );
        }

        progress[skill] = Math.max(0, totalPoints);
    }

    if (Object.keys(progress).length === 0) {
        delete team.staffTrainingProgress[playerKey];
    }

    return improved;
}

function snapshotScoutingEvaluator(evaluator) {
    const ratings = evaluator?.ratings || {};
    const scoutingBias =
        evaluator?.biases?.scouting?.name ||
        evaluator?.scoutingBias ||
        'Objective Scout';

    return {
        id: evaluator?.id || null,
        name: evaluator?.name || 'Staff Scout',
        isUserCoach: Boolean(evaluator?.isUserCoach),
        ratings: {
            evalPhysicals: Number(ratings.evalPhysicals ?? 50),
            evalTechnique: Number(ratings.evalTechnique ?? 50),
            evalCharacter: Number(ratings.evalCharacter ?? 50)
        },
        biases: {
            scouting: {
                name: scoutingBias
            }
        },
        scoutingBias
    };
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

    // Youth scouting targets Pee Wee players aged 8–11.
    // Other scouting focuses retain the team's normal age range.
    const minAge = focus === 'youth'
        ? 8
        : Number.isFinite(team.ageMin) ? team.ageMin : 12;

    const maxAge = focus === 'youth'
        ? 11
        : Number.isFinite(team.ageMax) ? team.ageMax : 18;

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

        // Youth scouting targets enrolled Pee Wee players only.
        // Do not mix in unrelated free agents or main-league players.
        if (
            focus === 'youth' &&
            (!otherTeam || otherTeam.leagueType !== 'youth')
        ) {
            continue;
        }

        if (focus === 'draft') {
            const isDraftTarget = targetIds
                ? targetIds.has(String(player.id))
                : isFreeAgent && player.age === 12;

            if (!isDraftTarget) continue;
        } else if (focus === 'freeAgents') {
            if (!isFreeAgent) continue;
        } else if (focus === 'opponents') {
            if (!otherTeam || otherTeam.leagueType !== 'main') continue;
        } else if (focus === 'youth') {
            // Scout players who are currently rostered in Pee Wee,
            // not unrelated young free agents.
            if (!otherTeam || otherTeam.leagueType !== 'youth') continue;
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

const OFFENSE_PREP_FOUNDATION_PLAYS = [
    'Uni_InsideZone',
    'Uni_StretchRight',
    'Uni_QuickSlants',
    'Uni_FourVerts'
];

const DEFENSE_PREP_FOUNDATION_PLAYS = [
    'Cover_2_Zone_Base',
    'Cover_1_Robber',
    'Man_Blitz_Base',
    'GoalLine_RunStuff'
];

const MAX_WEEKLY_PREP_POINTS = 12;

function getScheduledOpponentId(team, gameState, week) {
    if (
        !team?.id ||
        !Array.isArray(gameState?.teams) ||
        !Array.isArray(gameState?.schedule) ||
        !Number.isInteger(week) ||
        week < 0
    ) {
        return null;
    }

    // The schedule is flattened in weekly groups.
    // Keep the indexing consistent with simulateHistoricalSeason().
    const gamesPerWeek = Math.max(
        1,
        Math.floor(gameState.teams.length / 2)
    );

    const startIndex = week * gamesPerWeek;
    const endIndex = startIndex + gamesPerWeek;

    const match = gameState.schedule
        .slice(startIndex, endIndex)
        .find(entry =>
            entry?.home?.id != null &&
            entry?.away?.id != null &&
            (
                String(entry.home.id) === String(team.id) ||
                String(entry.away.id) === String(team.id)
            )
        );

    if (!match) return null;

    if (String(match.home.id) === String(team.id)) {
        return match.away.id;
    }

    return match.home.id;
}

function applyWeeklyGamePreparation(
    team,
    coach,
    assignment,
    allocatedHours,
    year,
    week,
    gameState
) {
    if (!team || !coach || !Number.isFinite(allocatedHours) || allocatedHours <= 0) {
        return 0;
    }

    if (!team.gameplan || typeof team.gameplan !== 'object') {
        team.gameplan = {};
    }

    const gameplan = team.gameplan;
    const ratings = coach.ratings || {};
    const isOffense = assignment.task === 'offensePrep';
    const side = isOffense ? 'offense' : 'defense';
    const skillRating = clamp(
        Number(
            isOffense
                ? ratings.offSchemeMastery ?? 50
                : ratings.defSchemeMastery ?? 50
        ),
        1,
        99
    );
    const instinct = clamp(Number(ratings.gameplanInstinct ?? 50), 1, 99);
    const adjustments = clamp(Number(ratings.inGameAdjustments ?? 50), 1, 99);

    const effectiveness = clamp(
        0.65 + skillRating / 250 + instinct / 500 + adjustments / 1000,
        0.75,
        1.25
    );

    const workWeekKey = `${year}:${week}`;
    let preparation = gameplan.staffPreparation;

    if (!preparation || preparation.workWeekKey !== workWeekKey) {
        preparation = {
            workWeekKey,
            preparedForYear: year,
            preparedForWeek: week + 1,
            offensePoints: 0,
            offenseHours: 0,
            defenseByOpponent: {}
        };
    }

    const mastery = gameplan.mastery || (gameplan.mastery = {});
    const installedPlays = isOffense
        ? gameplan.installedOffense || []
        : gameplan.installedDefense || [];
    const foundationPlays = isOffense
        ? OFFENSE_PREP_FOUNDATION_PLAYS
        : DEFENSE_PREP_FOUNDATION_PLAYS;

    const availablePlays = new Set([
        ...foundationPlays,
        ...installedPlays.slice(0, 8)
    ]);

    const assignedPlayKeys = Array.isArray(assignment.playKeys)
        ? [...new Set(
            assignment.playKeys.filter(key => availablePlays.has(key))
        )]
        : (() => {
            // Focus preparation on a small group of priority plays.
            const priorityInstalled = [
                ...new Set(
                    installedPlays
                        .slice(0, 8)
                        .filter(key => availablePlays.has(key))
                )
            ].slice(0, 4);

            // Use foundation plays to fill any remaining slots.
            const foundationFallback = foundationPlays
                .filter(key =>
                    availablePlays.has(key) &&
                    !priorityInstalled.includes(key)
                )
                .slice(0, Math.max(0, 4 - priorityInstalled.length));

            return [
                ...priorityInstalled,
                ...foundationFallback
            ];
        })();

    // Hours produce a modest preparation score, influenced by coaching skill.
    const rawPoints = allocatedHours * 0.4 * effectiveness;
    let pointsAdded = 0;

    if (isOffense) {
        const currentPoints = Math.max(0, Number(preparation.offensePoints) || 0);
        pointsAdded = Math.min(
            Math.max(0, MAX_WEEKLY_PREP_POINTS - currentPoints),
            rawPoints
        );

        preparation.offensePoints = currentPoints + pointsAdded;
        preparation.offenseHours = (preparation.offenseHours || 0) + allocatedHours;
    } else {
        const scheduledOpponentId = getScheduledOpponentId(
            team,
            gameState,
            week
        );

        const opponentId = assignment.opponentTeamId ??
            assignment.targetOpponentId ??
            scheduledOpponentId;

        const opponentKey = opponentId == null ? '*' : String(opponentId);

        const opponentPrep = preparation.defenseByOpponent[opponentKey] || {
            points: 0,
            hours: 0,
            coachIds: []
        };

        pointsAdded = Math.min(
            Math.max(0, MAX_WEEKLY_PREP_POINTS - opponentPrep.points),
            rawPoints
        );

        opponentPrep.points += pointsAdded;
        opponentPrep.hours += allocatedHours;

        if (coach.id && !opponentPrep.coachIds.includes(coach.id)) {
            opponentPrep.coachIds.push(coach.id);
        }

        preparation.defenseByOpponent[opponentKey] = opponentPrep;
    }

    // Preparation improves familiarity with the focused play set.
    // Offensive mastery influences play selection and execution.
    // Defensive preparation is also consumed by defensive play-calling.
    if (pointsAdded > 0 && assignedPlayKeys.length > 0) {
        const masteryGain = Math.min(4, pointsAdded * 0.6);

        for (const key of assignedPlayKeys) {
            const currentMastery = Number.isFinite(mastery[key])
                ? mastery[key]
                : 40;

            mastery[key] = Math.min(100, currentMastery + masteryGain);
        }
    }

    preparation.lastEvaluatorId = coach.id || null;
    gameplan.staffPreparation = preparation;

    return pointsAdded;
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
    if (
        !team ||
        !gameState ||
        !Number.isInteger(year) ||
        !Number.isInteger(week)
    ) {
        return { playersUpdated: 0, hoursUsed: 0 };
    }

    const plan = ensureTeamStaffWorkPlan(team);

    if (!plan || !Array.isArray(plan.assignments)) {
        return { playersUpdated: 0, hoursUsed: 0 };
    }

        const workAssignments = plan.assignments.filter(assignment => {
        if (
            !assignment?.coachId ||
            !STAFF_WORK_TASKS.has(assignment.task) ||
            !Number.isFinite(Number(assignment.hours)) ||
            Number(assignment.hours) <= 0
        ) {
            return false;
        }

        if (assignment.task === 'scouting') {
            return SCOUTING_WORK_FOCI.has(assignment.focus);
        }

        if (assignment.task === 'training') {
            return isValidTrainingAssignment(assignment);
        }

        return true;
    });

    if (!workAssignments.some(assignment =>
        assignment.task === 'scouting' ||
        assignment.task === 'training' ||
        assignment.task === 'offensePrep' ||
        assignment.task === 'defensePrep'
    )) {
        return { playersUpdated: 0, hoursUsed: 0 };
    }

    const weekKey = `${year}:${week}`;

    if (
        team.staffWorkLastResolvedKey === weekKey ||
        team.scoutingWorkLastResolvedKey === weekKey
    ) {
        return { playersUpdated: 0, hoursUsed: 0 };
    }

    const staffById = getAvailableScoutingStaff(team);
    const weeklyHoursPerCoach = Number.isFinite(plan.weeklyHoursPerCoach)
        ? Math.max(0, Math.min(
            WEEKLY_COACH_HOURS,
            Math.floor(plan.weeklyHoursPerCoach)
        ))
        : WEEKLY_COACH_HOURS;

    const usedHoursByCoach = new Map();
    const playersById = new Map(
        (Array.isArray(gameState.players) ? gameState.players : [])
            .filter(player => player?.id != null)
            .map(player => [String(player.id), player])
    );
    const trainedThisWeek = new Set();
    const trainedPlayerIds = new Set();
    const trainingHoursByPlayerSkill = new Map();

    let playersUpdated = 0;
    let attributesImproved = 0;
    let hoursUsed = 0;

    for (const assignment of workAssignments) {
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

        if (assignment.task === 'training') {
            const candidates = getTrainingCandidates(
                team,
                assignment,
                playersById,
                coach,
                year,
                week
            );

            if (candidates.length === 0) continue;

            const eligibleCandidates = candidates.filter(({ player, skill }) => {
                const trainingKey = `${String(player.id)}:${skill}`;
                const previouslyAllocated =
                    trainingHoursByPlayerSkill.get(trainingKey) || 0;

                return previouslyAllocated <
                    MAX_WEEKLY_TRAINING_HOURS_PER_PLAYER_SKILL;
            });

            if (eligibleCandidates.length === 0) continue;

            const requestedTargetCount = Number(assignment.maxTargets);
            const targetCount = Math.min(
                eligibleCandidates.length,
                18,
                Number.isInteger(requestedTargetCount) &&
                    requestedTargetCount > 0
                    ? requestedTargetCount
                    : 4
            );

            const selected = eligibleCandidates.slice(0, targetCount);
            const hoursPerPlayer = allocatedHours / selected.length;

            for (const { player, skill, category } of selected) {
                const trainingKey = `${String(player.id)}:${skill}`;
                const previouslyAllocated =
                    trainingHoursByPlayerSkill.get(trainingKey) || 0;

                const remainingTrainingHours = Math.max(
                    0,
                    MAX_WEEKLY_TRAINING_HOURS_PER_PLAYER_SKILL -
                        previouslyAllocated
                );

                const effectivePlayerHours = Math.min(
                    hoursPerPlayer,
                    remainingTrainingHours
                );

                if (effectivePlayerHours <= 0) continue;

                trainingHoursByPlayerSkill.set(
                    trainingKey,
                    previouslyAllocated + effectivePlayerHours
                );

                trainedPlayerIds.add(String(player.id));

                if (applyTrainingHours(
                    team,
                    player,
                    coach,
                    skill,
                    category,
                    effectivePlayerHours,
                    trainedThisWeek
                )) {
                    attributesImproved++;

                    // Successful player development teaches the coach.
                    const coachLearningSkills = [
                        'teaching',
                        'practiceDiscipline'
                    ];

                    // Physical development also provides feedback about
                    // the coach's conditioning expertise.
                    if (category === 'physical') {
                        coachLearningSkills.push('conditioning');
                    }

                    recordCoachDevelopmentOutcome(
                        coach,
                        'training',
                        1,
                        'player-training:' +
                            String(team.id) + ':' +
                            String(player.id) + ':' +
                            category + ':' +
                            skill,
                        year,
                        week,
                        coachLearningSkills
                    );
                }
            }

            hoursUsed += allocatedHours;
            continue;
        }

        if (
            assignment.task === 'offensePrep' ||
            assignment.task === 'defensePrep'
        ) {
            applyWeeklyGamePreparation(
                team,
                coach,
                assignment,
                allocatedHours,
                year,
                week,
                gameState
            );

            hoursUsed += allocatedHours;
            continue;
        }

        if (assignment.task !== 'scouting') continue;

        // Always bank draft-focused scouting during weekly processing.
        // A few undrafted prospects can remain on the previous draft board,
        // so draftClass.length cannot reliably identify the incoming class.
        if (assignment.focus === 'draft') {
            if (!Array.isArray(team.pendingDraftScoutingWork)) {
                team.pendingDraftScoutingWork = [];
            }

            const requestedTargetCount = Number(assignment.maxTargets);

            const maxTargets =
                Number.isInteger(requestedTargetCount) &&
                requestedTargetCount > 0
                    ? Math.min(12, requestedTargetCount)
                    : Math.max(1, Math.floor(allocatedHours / 4));

            team.pendingDraftScoutingWork.push({
                coachId: coach.id || coachId,
                evaluator: snapshotScoutingEvaluator(coach),
                hours: allocatedHours,
                maxTargets,
                year,
                week
            });

            hoursUsed += allocatedHours;
            continue;
        }

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

    team.staffWorkLastResolvedKey = weekKey;
    team.scoutingWorkLastResolvedKey = weekKey;

    return {
        playersUpdated,
        hoursUsed,
        playersTrained: trainedPlayerIds.size,
        attributesImproved
    };
}

/**
 * Applies draft-scouting hours saved while the incoming draft class
 * was unavailable.
 *
 * Call once after the new draft class has been generated and before
 * the user begins drafting.
 */
export function applyBankedDraftScoutingReports(
    team,
    gameState,
    year = gameState?.year,
    week = gameState?.currentWeek
) {
    if (
        !team ||
        !gameState ||
        !Number.isInteger(year) ||
        !Number.isInteger(week) ||
        !Array.isArray(gameState.draftClass) ||
        gameState.draftClass.length === 0
    ) {
        return {
            playersUpdated: 0,
            hoursUsed: 0,
            workItemsApplied: 0
        };
    }

    const pending = Array.isArray(team.pendingDraftScoutingWork)
        ? team.pendingDraftScoutingWork
        : [];

    if (pending.length === 0) {
        return {
            playersUpdated: 0,
            hoursUsed: 0,
            workItemsApplied: 0
        };
    }

    const staffById = getAvailableScoutingStaff(team);

    let playersUpdated = 0;
    let hoursUsed = 0;
    let workItemsApplied = 0;

    for (const work of pending) {
        const hours = Number(work?.hours);

        if (!Number.isFinite(hours) || hours <= 0) continue;

        const coachId = String(
            work.coachId ?? work.evaluator?.id ?? ''
        );

        // Use the saved profile so the report reflects the evaluator
        // who was assigned the work, not an unrelated replacement.
        const evaluator =
            work.evaluator ||
            staffById.get(coachId);

        if (!evaluator) continue;

        const evaluatedYear = Number.isInteger(work.year)
            ? work.year
            : year;

        const evaluatedWeek = Number.isInteger(work.week)
            ? work.week
            : week;

        const assignment = {
            focus: 'draft',
            maxTargets: work.maxTargets
        };

        // This now resolves against the newly generated draft class.
        // Existing reports and unfinished scouting progress are retained.
        const candidates = getScoutingCandidates(
            team,
            gameState,
            assignment,
            evaluatedYear,
            evaluatedWeek
        );

        if (candidates.length === 0) continue;

        const requestedTargetCount = Number(work.maxTargets);

        const targetCount = Math.min(
            candidates.length,
            12,
            Number.isInteger(requestedTargetCount) &&
                requestedTargetCount > 0
                ? requestedTargetCount
                : Math.max(1, Math.floor(hours / 4))
        );

        const selected = candidates.slice(0, targetCount);

        if (selected.length === 0) continue;

        const hoursPerTarget = hours / selected.length;

        for (const { player } of selected) {
            if (advanceTeamScoutingReport(
                team,
                player,
                evaluator,
                hoursPerTarget,
                evaluatedYear,
                evaluatedWeek
            )) {
                playersUpdated++;
            }
        }

        hoursUsed += hours;
        workItemsApplied++;
    }

    // These assignments have now been processed against the incoming class.
    // Clear the queue so re-entering the draft cannot spend the same hours twice.
    team.pendingDraftScoutingWork = [];

    return {
        playersUpdated,
        hoursUsed,
        workItemsApplied
    };
}

const INHERITED_SCOUTING_THRESHOLDS = [0, 4, 12, 24, 40];

function getInheritedScoutingLevel(team, player, year, priorityIds) {
    const seed = (stableNoise(
        `${team.id}|${player.id}|${year}|inherited-scouting`
    ) + 1) / 2;

    // Players already prioritized by the previous staff have deeper reports.
    if (priorityIds.has(String(player.id))) {
        if (seed < 0.05) return 4;
        if (seed < 0.25) return 3;
        if (seed < 0.70) return 2;
        return 1;
    }

    // Ordinary prospects receive a mix of report levels.
    if (seed < 0.22) return 0;
    if (seed < 0.62) return 1;
    if (seed < 0.86) return 2;
    if (seed < 0.98) return 3;
    return 4;
}

/**
 * Seeds the organization's inherited scouting knowledge for a draft class.
 * Call once when preparing the user's incoming draft, not during rendering.
 *
 * No report is generated for every prospect: unscouted prospects remain
 * unscouted, while prior reports are preserved.
 */
export function initializeInheritedScoutingReports(
    team,
    prospects,
    year,
    week = 0
) {
    if (
        !team ||
        !Array.isArray(prospects) ||
        !Number.isInteger(year) ||
        !Number.isInteger(week)
    ) {
        return { initialized: 0, skipped: 0, byLevel: {} };
    }

    const evaluator = getTeamCoachingSpecialist(
        team,
        'scouting'
    );

    const priorityIds = new Set(
        (Array.isArray(team.scoutingWatchlist)
            ? team.scoutingWatchlist
            : []
        )
            .map(item => typeof item === 'object'
                ? item?.playerId ?? item?.id
                : item)
            .filter(id => id != null)
            .map(String)
    );

    const rosterIds = new Set(
        (team.roster || []).map(String)
    );

    let initialized = 0;
    let skipped = 0;
    const byLevel = {};

    for (const player of prospects) {
        if (
            !player?.id ||
            !player.attributes ||
            player.teamId != null ||
            rosterIds.has(String(player.id))
        ) {
            continue;
        }

        // Preserve existing reports and any accumulated scouting progress.
        if (getTeamScoutingReport(team, player.id)) {
            skipped++;
            continue;
        }

        const level = getInheritedScoutingLevel(
            team,
            player,
            year,
            priorityIds
        );

        // Level 0 means the prior staff has no stored report for this player.
        if (level === 0) continue;

        // Convert the intended level into historical scouting work. The
        // lower-bound productivity factor guarantees the target level.
        const historicalHours =
            INHERITED_SCOUTING_THRESHOLDS[level] / 0.75 + 0.01;

        const saved = advanceTeamScoutingReport(
            team,
            player,
            evaluator,
            historicalHours,
            year,
            week
        );

        if (!saved) continue;

        const stored = getTeamScoutingReport(team, player.id);

        if (stored) {
            initialized++;
            byLevel[stored.level] = (byLevel[stored.level] || 0) + 1;
        }
    }

    return { initialized, skipped, byLevel };
}