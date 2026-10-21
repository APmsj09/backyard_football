import { getTeamScoutingReport, setTeamScoutingReport } from './state.js';
import { calculateOverall, positionOverallWeights } from './player.js';
import { isPlayerViableForPosition } from './depth_chart.js';
import { ensureTeamStaffWorkPlan, WEEKLY_COACH_HOURS } from './staff.js';

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
    const profile = getEvaluatorProfile(evaluator, team, player);
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
            candidates.push({
                player,
                skill,
                category: attribute.category
            });
        }
    }

    return candidates;
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

    const earnedPoints = Math.max(
        0,
        hours * coachFactor * ethicFactor * ageFactor
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

function applyWeeklyGamePreparation(
    team,
    coach,
    assignment,
    allocatedHours,
    year,
    week
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
        ? assignment.playKeys.filter(key => availablePlays.has(key))
        : [...availablePlays];

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
        const opponentId = assignment.opponentTeamId ??
            assignment.targetOpponentId;
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

    // Familiarity directly affects offensive play selection and execution.
    // Defensive mastery is stored as well; the next engine patch will consume
    // the opponent-specific preparation score during defensive play-calling.
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

            const requestedTargetCount = Number(assignment.maxTargets);
            const targetCount = Math.min(
                candidates.length,
                18,
                Number.isInteger(requestedTargetCount) &&
                    requestedTargetCount > 0
                    ? requestedTargetCount
                    : candidates.length
            );

            const selected = candidates.slice(0, targetCount);
            const hoursPerPlayer = allocatedHours / selected.length;

            for (const { player, skill, category } of selected) {
                trainedPlayerIds.add(String(player.id));

                if (applyTrainingHours(
                    team,
                    player,
                    coach,
                    skill,
                    category,
                    hoursPerPlayer,
                    trainedThisWeek
                )) {
                    attributesImproved++;
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
                week
            );

            hoursUsed += allocatedHours;
            continue;
        }

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

    team.staffWorkLastResolvedKey = weekKey;
    team.scoutingWorkLastResolvedKey = weekKey;

    return {
        playersUpdated,
        hoursUsed,
        playersTrained: trainedPlayerIds.size,
        attributesImproved
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

    const evaluator = team.staff?.scout ||
        team.staff?.coach ||
        team.coach ||
        (Array.isArray(team.coaches)
            ? team.coaches.find(coach => coach?.id)
            : null);

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