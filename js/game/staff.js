// js/game/staff.js - Coaching, Scouting & Front Office System

import { getRandom, getRandomInt } from '../utils.js';
import {
    firstNames,
    lastNames,
    offensivePlaybook,
    defensivePlaybook,
    gmArchetypes
} from '../data.js';
import {
    getRosterObjects,
    getTeamScoutingReport
} from './state.js';
import { calculateOverall } from './player.js';
import { evaluateStaffNegotiation } from './negotiations.js';
import { isPlayerViableForPosition, rebuildDepthChartFromOrder } from './depth_chart.js';

const LEGACY_STAFF_PROFILE_IDS = {
    tactical: {
        'Smashmouth Zealot': 'power_run_specialist',
        'Air Raid Purist': 'spread_passing_specialist',
        'Blitz Addict': 'pressure_oriented_defender',
        'Conservative Turtler': 'conservative_game_manager',
        'Balanced Tactician': 'adaptive_strategist'
    },
    scouting: {
        'Speed Chaser': 'athletic_bias_evaluator',
        'Technique Purist': 'technique_first_evaluator',
        'Character First': 'character_focused_evaluator',
        'Objective Scout': 'balanced_evaluator'
    },
    personality: {
        "Players' Coach": 'player_centered',
        'Old-School Disciplinarian': 'traditionalist',
        "Peaked in '94": 'hard_nosed_competitor',
        'Analytical Savant': 'analytical_planner'
    }
};

function getStaffProfileId(staff, category) {
    const profileId =
        staff?.profileIds?.[category] ||
        staff?.biases?.[category]?.id;

    if (typeof profileId === 'string' && profileId.length > 0) {
        return profileId;
    }

    const legacyName = staff?.biases?.[category]?.name;

    return LEGACY_STAFF_PROFILE_IDS[category]?.[legacyName] || null;
}

export const tacticalBiases = [
    {
        id: 'power_run_specialist',
        name: 'Smashmouth Zealot',
        displayName: 'Power-Run Specialist',
        desc: 'Favors a physical running game and run-oriented personnel; may underuse the passing game.',
        runModifier: 0.20,
        passModifier: -0.20
    },
    {
        id: 'spread_passing_specialist',
        name: 'Air Raid Purist',
        displayName: 'Spread-Passing Specialist',
        desc: 'Favors spread formations and passing concepts; may become too pass-heavy.',
        runModifier: -0.20,
        passModifier: 0.25
    },
    {
        id: 'pressure_oriented_defender',
        name: 'Blitz Addict',
        displayName: 'Pressure-Oriented Defender',
        desc: 'Favors aggressive pressure packages, accepting greater risk in coverage.',
        blitzModifier: 0.30
    },
    {
        id: 'conservative_game_manager',
        name: 'Conservative Turtler',
        displayName: 'Conservative Game Manager',
        desc: 'Prioritizes possession and lower-variance decisions, sometimes passing up worthwhile risks.',
        riskModifier: -0.30
    },
    {
        id: 'adaptive_strategist',
        name: 'Balanced Tactician',
        displayName: 'Adaptive Strategist',
        desc: 'Favors balanced preparation and adapting the plan to the situation.',
        runModifier: 0,
        passModifier: 0
    }
];

export const scoutingBiases = [
    {
        id: 'athletic_bias_evaluator',
        name: 'Speed Chaser',
        displayName: 'Athletic-Bias Evaluator',
        desc: 'Emphasizes athletic traits and may undervalue technique or decision-making.'
    },
    {
        id: 'technique_first_evaluator',
        name: 'Technique Purist',
        displayName: 'Technique-First Evaluator',
        desc: 'Emphasizes technical execution and may overlook exceptional athletic upside.'
    },
    {
        id: 'character_focused_evaluator',
        name: 'Character First',
        displayName: 'Character-Focused Evaluator',
        desc: 'Places extra weight on leadership, work habits, and interpersonal fit.'
    },
    {
        id: 'balanced_evaluator',
        name: 'Objective Scout',
        displayName: 'Balanced Evaluator',
        desc: 'Attempts to weigh available evidence evenly, while remaining vulnerable to uncertainty.'
    }
];

export const personalityTraits = [
    {
        id: 'player_centered',
        name: "Players' Coach",
        displayName: 'Player-Centered',
        desc: 'Prioritizes player relationships, communication, and maintaining morale.',
        tendencies: {
            riskTolerance: 48,
            adaptability: 62,
            relationshipOrientation: 90,
            discipline: 48,
            patience: 72,
            developmentFocus: 78
        }
    },
    {
        id: 'traditionalist',
        name: 'Old-School Disciplinarian',
        displayName: 'Traditionalist',
        desc: 'Values structure, discipline, and established methods; may resist unfamiliar approaches.',
        tendencies: {
            riskTolerance: 38,
            adaptability: 35,
            relationshipOrientation: 45,
            discipline: 86,
            patience: 52,
            developmentFocus: 55
        }
    },
    {
        id: 'hard_nosed_competitor',
        name: "Peaked in '94",
        displayName: 'Hard-Nosed Competitor',
        desc: 'Values toughness and persistence; may become stubborn when a plan is failing.',
        tendencies: {
            riskTolerance: 72,
            adaptability: 42,
            relationshipOrientation: 40,
            discipline: 82,
            patience: 38,
            developmentFocus: 45
        }
    },
    {
        id: 'analytical_planner',
        name: 'Analytical Savant',
        displayName: 'Analytical Planner',
        desc: 'Prefers evidence-driven decisions and structured preparation, but may communicate less intuitively.',
        tendencies: {
            riskTolerance: 50,
            adaptability: 86,
            relationshipOrientation: 42,
            discipline: 68,
            patience: 72,
            developmentFocus: 68
        }
    }
];

function buildStaffBehaviorProfile(personality) {
    const tendencyKeys = [
        'riskTolerance',
        'adaptability',
        'relationshipOrientation',
        'discipline',
        'patience',
        'developmentFocus'
    ];

    const tendencies = {};

    for (const key of tendencyKeys) {
        const baseline = Number(personality?.tendencies?.[key]);
        const target = Number.isFinite(baseline)
            ? baseline
            : 50;

        // Personality establishes the general disposition, while
        // individual variation prevents every coach of one type
        // from behaving identically.
        const variation = getRandomInt(-8, 8);

        tendencies[key] = Math.max(
            0,
            Math.min(100, target + variation)
        );
    }

    return {
        version: 1,
        personalityId: personality?.id || null,
        tendencies
    };
}

const STAFF_SCHEDULES = [
    {
        type: 'weeknight_evenings',
        label: 'Weeknight evenings',
        availableDays: ['Tuesday', 'Thursday'],
        timeWindow: 'evening'
    },
    {
        type: 'weeknight_evenings',
        label: 'Monday and Wednesday evenings',
        availableDays: ['Monday', 'Wednesday'],
        timeWindow: 'evening'
    },
    {
        type: 'weekends',
        label: 'Weekend availability',
        availableDays: ['Saturday', 'Sunday'],
        timeWindow: 'daytime'
    },
    {
        type: 'mixed',
        label: 'One weeknight and Saturday',
        availableDays: ['Wednesday', 'Saturday'],
        timeWindow: 'mixed'
    },
    {
        type: 'flexible',
        label: 'Flexible schedule',
        availableDays: ['Flexible'],
        timeWindow: 'flexible'
    },
    {
        type: 'limited_weekends',
        label: 'Occasional weekends',
        availableDays: ['Saturday'],
        timeWindow: 'daytime'
    }
];

function createStaffAvailability(role = 'coach') {
    const weeklyHourRanges = {
        coach: [3, 12],
        scout: [2, 8],
        trainer: [2, 7],
        gm: [1, 5]
    };

    const [minHours, maxHours] =
        weeklyHourRanges[role] || weeklyHourRanges.coach;

    const schedule = getRandom(STAFF_SCHEDULES);

    return {
        weeklyHours: getRandomInt(minHours, maxHours),
        scheduleType: schedule.type,
        scheduleLabel: schedule.label,
        availableDays: [...schedule.availableDays],
        timeWindow: schedule.timeWindow,
        reliability: getRandomInt(55, 95)
    };
}

const STAFF_BEHAVIOR_TENDENCY_KEYS = [
    'riskTolerance',
    'adaptability',
    'relationshipOrientation',
    'discipline',
    'patience',
    'developmentFocus'
];

/**
 * Ensures a staff member has a complete, persistent behavioral profile.
 *
 * Existing valid tendencies are preserved. Missing profiles are initialized
 * from the staff member's personality, with bounded individual variation.
 */
export function ensureStaffBehaviorProfile(staff) {
    if (!staff || typeof staff !== 'object') {
        return null;
    }

    const personalityId = getStaffProfileId(staff, 'personality');
    const personality = personalityTraits.find(
        trait => trait.id === personalityId
    ) || null;

    const expectedPersonalityId = personality?.id || null;
    const existingProfile = staff.behaviorProfile;

    const profileMatchesPersonality =
        existingProfile &&
        typeof existingProfile === 'object' &&
        existingProfile.personalityId === expectedPersonalityId &&
        existingProfile.tendencies &&
        typeof existingProfile.tendencies === 'object';

    if (!profileMatchesPersonality) {
        staff.behaviorProfile = buildStaffBehaviorProfile(personality);
    } else {
        // Preserve valid saved values and initialize only missing fields.
        for (const key of STAFF_BEHAVIOR_TENDENCY_KEYS) {
            const value = Number(existingProfile.tendencies[key]);

            if (Number.isFinite(value)) {
                existingProfile.tendencies[key] = Math.max(
                    0,
                    Math.min(100, value)
                );
                continue;
            }

            const baseline = Number(personality?.tendencies?.[key]);
            const target = Number.isFinite(baseline)
                ? baseline
                : 50;

            existingProfile.tendencies[key] = Math.max(
                0,
                Math.min(100, target + getRandomInt(-8, 8))
            );
        }

        existingProfile.version = 1;
        staff.behaviorProfile = existingProfile;
    }

    return staff.behaviorProfile;
}

/**
 * Returns a validated behavioral tendency on a 0–100 scale.
 * Unrecognized tendency keys safely return the neutral value of 50.
 */
export function getStaffBehaviorTendency(staff, tendencyKey) {
    if (!STAFF_BEHAVIOR_TENDENCY_KEYS.includes(tendencyKey)) {
        return 50;
    }

    const profile = ensureStaffBehaviorProfile(staff);
    const value = Number(profile?.tendencies?.[tendencyKey]);

    if (!Number.isFinite(value)) {
        return 50;
    }

    return Math.max(0, Math.min(100, value));
}

/**
 * Adds persistent personality values used by offseason staff negotiations.
 * Older staff records receive these once; existing values are preserved.
 */
export function ensureStaffNegotiationProfile(staff) {
    if (!staff || typeof staff !== 'object') return null;

    if (
        staff.happiness == null ||
        !Number.isFinite(Number(staff.happiness))
    ) {
        staff.happiness = getRandomInt(45, 85);
    } else {
        staff.happiness = Math.max(
            0,
            Math.min(100, Number(staff.happiness))
        );
    }

    if (
        staff.ego == null ||
        !Number.isFinite(Number(staff.ego))
    ) {
        let ego = getRandomInt(25, 80);
        const personalityId = getStaffProfileId(staff, 'personality');

        if (personalityId === 'hard_nosed_competitor') {
            ego += 12;
        } else if (personalityId === 'traditionalist') {
            ego += 5;
        } else if (personalityId === 'player_centered') {
            ego -= 8;
        }

        staff.ego = Math.max(15, Math.min(95, ego));
    } else {
        staff.ego = Math.max(
            15,
            Math.min(95, Number(staff.ego))
        );
    }

    return staff;
}

/**
 * Adds availability to older staff records without overwriting profiles
 * already stored in a save.
 */
export function ensureStaffAvailability(staff) {
    if (!staff) return null;

    ensureStaffNegotiationProfile(staff);

    if (
        !staff.availability ||
        typeof staff.availability !== 'object' ||
        Array.isArray(staff.availability)
    ) {
        staff.availability = createStaffAvailability(staff.role);
        return staff.availability;
    }

    const availability = staff.availability;
    const existingHours = Number(availability.weeklyHours);

    if (
        !Number.isFinite(existingHours) ||
        existingHours < 0
    ) {
        availability.weeklyHours =
            createStaffAvailability(staff.role).weeklyHours;
    } else {
        availability.weeklyHours = Math.min(
            40,
            Math.floor(existingHours)
        );
    }

    const validScheduleType = STAFF_SCHEDULES.some(
        schedule => schedule.type === availability.scheduleType
    );

    const validAvailableDays =
        Array.isArray(availability.availableDays) &&
        availability.availableDays.some(
            day =>
                typeof day === 'string' &&
                day.trim().length > 0
        );

    const validTimeWindow = [
        'evening',
        'daytime',
        'mixed',
        'flexible'
    ].includes(availability.timeWindow);

    if (
        !validScheduleType ||
        !validAvailableDays ||
        !validTimeWindow
    ) {
        // Older records without a complete schedule receive a flexible
        // schedule rather than an arbitrary restriction.
        availability.scheduleType = 'flexible';
        availability.scheduleLabel = 'Flexible schedule';
        availability.availableDays = ['Flexible'];
        availability.timeWindow = 'flexible';
    } else {
        availability.availableDays =
            availability.availableDays.filter(
                day =>
                    typeof day === 'string' &&
                    day.trim().length > 0
            );
    }

    if (
        availability.reliability == null ||
        !Number.isFinite(Number(availability.reliability))
    ) {
        availability.reliability = 80;
    } else {
        availability.reliability = Math.max(
            0,
            Math.min(100, Number(availability.reliability))
        );
    }

    return availability;
}

/**
 * Calculates the effective hours contributed by one staff assignment.
 *
 * Accounts for:
 * - The staff member's weekly availability.
 * - Preferred schedule constraints.
 * - The combined workload across all their assignments.
 * - The staff member's reliability.
 *
 * This is a deterministic expected-output calculation. It does not
 * mutate the requested assignment hours or perform random attendance rolls.
 */
export function getEffectiveStaffWorkHours(team, assignment) {
    if (!team || !assignment || assignment.coachId == null) {
        return 0;
    }

    const plan = team.staffWorkPlan;

    if (!plan || !Array.isArray(plan.assignments)) {
        return 0;
    }

    const coaches = [
        ...(Array.isArray(team.coaches) ? team.coaches : []),
        ...Object.values(team.staff || {})
    ];

    const uniqueCoaches = new Map();

    coaches.forEach(coach => {
        if (!coach || coach.id == null) return;
        uniqueCoaches.set(String(coach.id), coach);
    });

    const coach = uniqueCoaches.get(String(assignment.coachId));

    if (!coach) return 0;

    const availability = ensureStaffAvailability(coach);

    if (!availability) return 0;

    const requestedHours = Number(assignment.hours);

    if (
        !Number.isFinite(requestedHours) ||
        requestedHours <= 0
    ) {
        return 0;
    }

    // Aggregate all assignments for this coach so splitting work into
    // multiple assignments cannot bypass the personal weekly time limit.
    const coachAssignments = plan.assignments.filter(item =>
        item &&
        String(item.coachId) === String(coach.id) &&
        Number.isFinite(Number(item.hours)) &&
        Number(item.hours) > 0
    );

    if (!coachAssignments.includes(assignment)) {
        coachAssignments.push(assignment);
    }

    const totalRequestedHours = coachAssignments.reduce(
        (sum, item) => sum + Math.max(0, Number(item.hours) || 0),
        0
    );

    if (totalRequestedHours <= 0) return 0;

    const rawAvailability = Number(availability.weeklyHours);

    const availableHours = Math.max(
        0,
        Math.min(
            40,
            Number.isFinite(rawAvailability) ? rawAvailability : 8
        )
    );

    // A flexible schedule does not impose a day-by-day restriction.
    // For fixed schedules, cap hours per available day. The availability
    // profile remains the primary weekly limit.
    const availableDays = Array.isArray(availability.availableDays)
        ? availability.availableDays.filter(
            day => typeof day === 'string' && day.trim()
        )
        : [];

    const isFlexibleSchedule =
        availability.scheduleType === 'flexible' ||
        availableDays.includes('Flexible');

    const hoursPerDay =
        availability.timeWindow === 'mixed' ? 6 : 4;

    const scheduleCapacity =
        !isFlexibleSchedule && availableDays.length > 0
            ? availableDays.length * hoursPerDay
            : availableHours;

    const configuredPlanCap = Number(plan.weeklyHoursPerCoach);

    const planCap =
        Number.isFinite(configuredPlanCap) && configuredPlanCap >= 0
            ? Math.min(40, configuredPlanCap)
            : 40;

    const weeklyCapacity = Math.min(
        availableHours,
        scheduleCapacity,
        planCap
    );

    // Scale assignments proportionally if their combined hours exceed
    // the coach's available capacity. Preserve requested hours in the plan.
    const capacityFactor = Math.min(
        1,
        weeklyCapacity / totalRequestedHours
    );

    const rawReliability = Number(availability.reliability);

    const reliability = Math.max(
        0,
        Math.min(
            100,
            Number.isFinite(rawReliability) ? rawReliability : 80
        )
    );

    const effectiveHours =
        requestedHours *
        capacityFactor *
        (reliability / 100);

    return Math.max(0, effectiveHours);
}

export function generateStaffMember(role = 'coach', minAge = 25, maxAge = 55, formerPlayer = null) {
    const firstName = formerPlayer ? formerPlayer.name.split(' ')[0] : getRandom(firstNames);
    const lastName = formerPlayer ? formerPlayer.name.split(' ').slice(1).join(' ') : getRandom(lastNames);
    const age = formerPlayer ? 19 : getRandomInt(minAge, maxAge);

    const baseVal = () => getRandomInt(45, 75);

    // Initial trait rolls to calculate market demands
    const personality = getRandom(personalityTraits);
    const availability = createStaffAvailability(role);
    const tactical = getRandom(tacticalBiases);
    const scouting = getRandom(scoutingBiases);

    // Generate persistent individual tendencies from the personality.
    const behaviorProfile = buildStaffBehaviorProfile(personality);

    // Personality influences market stubbornness through a stable profile ID.
    let stubbornness = 0.75;

    if (
        personality.id === 'hard_nosed_competitor' ||
        personality.id === 'traditionalist'
    ) {
        stubbornness = 0.92;
    } else if (personality.id === 'player_centered') {
        stubbornness = 0.58;
    } else if (personality.id === 'analytical_planner') {
        stubbornness = 0.70;
    }

    // Persistent traits used by staff recruitment negotiations.
    const happiness = getRandomInt(45, 85);

    let ego = getRandomInt(25, 80);

    if (personality.id === 'hard_nosed_competitor') {
        ego += 12;
    } else if (personality.id === 'traditionalist') {
        ego += 5;
    } else if (personality.id === 'player_centered') {
        ego -= 8;
    }

    ego = Math.max(15, Math.min(95, ego));

    return {
        id: crypto.randomUUID(),
        name: formerPlayer ? formerPlayer.name : `${firstName} ${lastName}`,
        age,
        role, // 'gm', 'coach', 'scout', 'trainer'
        teamId: null,
        formerPlayerId: formerPlayer?.id || null,
        formerPlayerBio: formerPlayer ? `Former ${formerPlayer.pos} legend (${formerPlayer.careerStats?.touchdowns || 0} TDs, ${formerPlayer.careerStats?.seasonsPlayed || 0} yrs played)` : null,
        // Financial & Market Demands
        stipendDemand: 0, // Calculated dynamically by reputation
        weeksUnemployed: 0,
        stubbornness,

        // Personal outlook affecting recruitment negotiations
        happiness,
        ego,

        // Personal commitment outside the community league
        availability,
        ratings: {
            // Tactical Acumen & Gameplanning
            offSchemeMastery: formerPlayer?.pos === 'QB' ? getRandomInt(65, 85) : baseVal(),
            defSchemeMastery: ['DL', 'LB', 'DB'].includes(formerPlayer?.pos) ? getRandomInt(65, 85) : baseVal(),
            gameplanInstinct: baseVal(), // How smartly coach designs gameplans against opponent schemes
            inGameAdjustments: baseVal(),
            clockIQ: baseVal(),

            // Evaluation (Scouting)
            evalPhysicals: baseVal(),
            evalTechnique: formerPlayer ? getRandomInt(60, 80) : baseVal(),
            evalCharacter: baseVal(),

            // Leadership & Drill Execution
            teaching: formerPlayer?.attributes?.mental?.playbookIQ ? Math.min(95, formerPlayer.attributes.mental.playbookIQ + 5) : baseVal(),
            practiceDiscipline: baseVal(), // Drill efficiency, accelerates play mastery and retention
            conditioning: baseVal(),
            authority: formerPlayer ? 45 : getRandomInt(50, 80)
        },
        profileIds: {
            tactical: tactical.id,
            scouting: scouting.id,
            personality: personality.id
        },
        biases: {
            tactical,
            scouting,
            personality
        },
        behaviorProfile,
        experience: 0
    };
}

export function initializeTeamStaff(team) {
    if (!team) return;

    const coaches = [
        generateStaffMember('coach', 30, 55),
        generateStaffMember('coach', 30, 55),
        generateStaffMember('coach', 30, 55)
    ];

    coaches.forEach(coach => {
        coach.teamId = team.id;
    });

    team.coaches = coaches;

    const aiGmProfile =
        team.aiGmProfile || generateStaffMember('gm', 35, 60);

    const gmArchetype = gmArchetypes.find(
        archetype =>
            archetype.id === aiGmProfile.managementArchetypeId
    ) || getRandom(gmArchetypes);

    const gmStrategyByArchetype = {
        film_room_rat: 'DEVELOP_YOUTH',
        neighborhood_builder: 'DEVELOP_YOUTH',
        deal_maker: 'WIN_NOW',
        culture_keeper: 'DEVELOP_YOUTH',
        tactical_innovator: 'COACH_AUTONOMY',
        win_now_gambler: 'WIN_NOW'
    };

    aiGmProfile.managementArchetypeId = gmArchetype.id;
    aiGmProfile.managementArchetypeName = gmArchetype.name;
    aiGmProfile.strategicDirective =
        aiGmProfile.strategicDirective ||
        gmStrategyByArchetype[gmArchetype.id] ||
        'COACH_AUTONOMY';

    aiGmProfile.teamId = team.id;
    team.aiGmProfile = aiGmProfile;

    // Temporary compatibility references during the migration.
    team.staff = {
        gm: aiGmProfile,
        coach: coaches[0],
        scout: coaches[1],
        trainer: coaches[2]
    };

    Object.values(team.staff).forEach(member => {
        if (member) member.teamId = team.id;
    });

    team.coach = coaches[0];

    ensureTeamCoachingStaff(team);
    ensureTeamStaffWorkPlan(team);
}

export const WEEKLY_COACH_HOURS = 40;

export const STAFF_WORK_TASKS = Object.freeze({
    SCOUTING: 'scouting',
    TRAINING: 'training',
    OFFENSE_PREP: 'offensePrep',
    DEFENSE_PREP: 'defensePrep'
});

const COACH_DEVELOPMENT_SKILLS = [
    'offSchemeMastery',
    'defSchemeMastery',
    'evalPhysicals',
    'evalTechnique',
    'evalCharacter',
    'teaching',
    'gameplanInstinct',
    'inGameAdjustments',
    'practiceDiscipline',
    'conditioning'
];

const COACH_SKILL_HARD_CAP = 95;

export function ensureCoachDevelopmentProfile(coach) {
    if (!coach || typeof coach !== 'object') return null;

    if (!coach.ratings || typeof coach.ratings !== 'object') {
        coach.ratings = {};
    }

    const development =
        coach.development && typeof coach.development === 'object'
            ? coach.development
            : {};

    const skillCeilings =
        development.skillCeilings &&
        typeof development.skillCeilings === 'object'
            ? { ...development.skillCeilings }
            : {};

    for (const skill of COACH_DEVELOPMENT_SKILLS) {
        const rating = Number(coach.ratings[skill]);
        const current = Number.isFinite(rating)
            ? Math.max(0, Math.min(COACH_SKILL_HARD_CAP, rating))
            : 50;

        // Normalize existing ratings as well as initializing missing ones.
        coach.ratings[skill] = current;

        const existingCeiling = Number(skillCeilings[skill]);

        if (!Number.isFinite(existingCeiling)) {
            // Potential is established once, not rerolled on each call.
            skillCeilings[skill] = Math.min(
                COACH_SKILL_HARD_CAP,
                current + getRandomInt(4, 15)
            );
        } else {
            // A selected starting rating must never exceed its own ceiling.
            skillCeilings[skill] = Math.max(
                current,
                Math.min(COACH_SKILL_HARD_CAP, existingCeiling)
            );
        }
    }

    const age = Number(coach.age);
    const learningRate = Number(development.learningRate);
    const motivation = Number(development.motivation);

    development.version = 1;
    development.skillCeilings = skillCeilings;
    development.progressBySkill =
        development.progressBySkill &&
        typeof development.progressBySkill === 'object'
            ? development.progressBySkill
            : {};

    // Preserve valid accumulated progress, including fractional progress.
    // Reset only invalid or negative values so corrupted state cannot
    // produce unexpected development results.
    for (const skill of COACH_DEVELOPMENT_SKILLS) {
        const progress = Number(development.progressBySkill[skill]);

        development.progressBySkill[skill] =
            Number.isFinite(progress) && progress >= 0
                ? progress
                : 0;
    }

    // Younger coaches generally learn faster; experience will be handled
    // separately by the weekly development resolver.
    if (!Number.isFinite(learningRate)) {
        const ageFactor = !Number.isFinite(age) || age <= 30
            ? 1.15
            : age <= 40
                ? 1.0
                : age <= 50
                    ? 0.85
                    : 0.7;

        development.learningRate = Math.round(
            (ageFactor + getRandomInt(-10, 10) / 100) * 100
        ) / 100;
    }

    if (!Number.isFinite(motivation)) {
        development.motivation = getRandomInt(85, 115) / 100;
    }

    if (!Number.isFinite(Number(development.careerGrowthBudget))) {
        development.careerGrowthBudget = getRandomInt(12, 24);
    }

    development.careerGrowthBudget = Math.max(
        0,
        Math.min(24, Math.floor(development.careerGrowthBudget))
    );

    const growthUsed = Number(development.growthPointsUsed);

    development.growthPointsUsed = Number.isFinite(growthUsed)
        ? Math.max(
            0,
            Math.min(development.careerGrowthBudget, growthUsed)
        )
        : 0;

    development.remainingGrowthPoints =
        development.careerGrowthBudget -
        development.growthPointsUsed;

    development.experienceWeeks = Math.max(
        0,
        Math.floor(Number(development.experienceWeeks) || 0)
    );

    development.lastResolvedWeekKey =
        development.lastResolvedWeekKey || null;

    coach.development = development;

    return development;
}

const COACH_DEVELOPMENT_TASK_SKILLS = {
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

/**
 * Records learning from a real work outcome.
 *
 * quality: -1 to 1
 *   Positive = successful outcome
 *   Negative = setback that may still teach the coach something
 *
 * eventKey must uniquely identify the outcome, e.g. a completed
 * scouting evaluation or a resolved game-planning result.
 *
 * This adds bounded progress only. It never directly raises a rating.
 */
export function recordCoachDevelopmentOutcome(
    coach,
    task,
    quality,
    eventKey,
    year,
    week,
    skillOverrides = null
) {
    if (
        !coach ||
        !eventKey ||
        !Number.isInteger(year) ||
        !Number.isInteger(week) ||
        !Number.isFinite(Number(quality))
    ) {
        return { applied: false, pointsAdded: 0 };
    }

    const taskSkills = COACH_DEVELOPMENT_TASK_SKILLS[task];

    if (!taskSkills) {
        return { applied: false, pointsAdded: 0 };
    }

    const skills = Array.isArray(skillOverrides)
        ? [...new Set(skillOverrides)]
            .filter(skill =>
                taskSkills.includes(skill) &&
                COACH_DEVELOPMENT_SKILLS.includes(skill)
            )
        : taskSkills;

    if (skills.length === 0) {
        return { applied: false, pointsAdded: 0 };
    }

    const development = ensureCoachDevelopmentProfile(coach);

    if (!development) {
        return { applied: false, pointsAdded: 0 };
    }

    // Prevent the same event from rewarding a coach more than once.
    const uniqueEventKey = `${year}:${week}:${task}:${eventKey}`;

    if (!Array.isArray(development.processedOutcomeKeys)) {
        development.processedOutcomeKeys = [];
    }

    if (development.processedOutcomeKeys.includes(uniqueEventKey)) {
        return { applied: false, pointsAdded: 0 };
    }

    development.processedOutcomeKeys.push(uniqueEventKey);

    // Bound persisted de-duplication history.
    if (development.processedOutcomeKeys.length > 128) {
        development.processedOutcomeKeys =
            development.processedOutcomeKeys.slice(-128);
    }

    const score = Math.max(-1, Math.min(1, Number(quality)));

    // Strong results teach more; setbacks still provide a smaller lesson.
    const requestedPoints = score >= 0
        ? score * 8
        : Math.abs(score) * 3;

    if (requestedPoints <= 0) {
        return { applied: true, pointsAdded: 0 };
    }

    const weekKey = `${year}:${week}`;

    if (development.outcomeWeekKey !== weekKey) {
        development.outcomeWeekKey = weekKey;
        development.outcomePointsBySkill = {};
    }

    if (
        !development.outcomePointsBySkill ||
        typeof development.outcomePointsBySkill !== 'object'
    ) {
        development.outcomePointsBySkill = {};
    }

    if (
        !development.progressBySkill ||
        typeof development.progressBySkill !== 'object'
    ) {
        development.progressBySkill = {};
    }

    const growthRemaining =
        development.careerGrowthBudget -
        development.growthPointsUsed;

    if (growthRemaining <= 0) {
        return { applied: true, pointsAdded: 0 };
    }

    let pointsAdded = 0;

    for (const skill of skills) {
        const ratingValue = Number(coach.ratings?.[skill]);
        const currentRating = Number.isFinite(ratingValue)
            ? ratingValue
            : 50;

        const ceiling = Number(
            development.skillCeilings?.[skill]
        );

        if (
            !Number.isFinite(ceiling) ||
            currentRating >= Math.min(COACH_SKILL_HARD_CAP, ceiling)
        ) {
            continue;
        }

        // Outcome feedback is capped per skill each week.
        const alreadyEarned = Math.max(
            0,
            Number(development.outcomePointsBySkill[skill]) || 0
        );

        const availableFeedbackPoints = Math.max(
            0,
            10 - alreadyEarned
        );

        const awarded = Math.min(
            requestedPoints,
            availableFeedbackPoints
        );

        if (awarded <= 0) continue;

        const existingProgress = Math.max(
            0,
            Number(development.progressBySkill[skill]) || 0
        );

        development.progressBySkill[skill] = Math.min(
            199,
            existingProgress + awarded
        );

        development.outcomePointsBySkill[skill] =
            alreadyEarned + awarded;

        pointsAdded += awarded;
    }

    return {
        applied: true,
        pointsAdded
    };
}

function getCoachLearningStyleMultiplier(coach, skill) {
    // Each coach's behavioral tendencies influence how readily they
    // develop particular skills. Personality provides a baseline, while
    // individual variation keeps coaches with the same personality distinct.
    const centeredTendency = tendencyKey => (
        getStaffBehaviorTendency(coach, tendencyKey) - 50
    ) / 50;

    let adjustment = 0;

    if (
        [
            'evalPhysicals',
            'evalTechnique',
            'evalCharacter'
        ].includes(skill)
    ) {
        // Evaluation improves through adaptability and patient analysis.
        adjustment =
            centeredTendency('adaptability') * 0.035 +
            centeredTendency('patience') * 0.025;
    } else if (
        [
            'offSchemeMastery',
            'defSchemeMastery',
            'gameplanInstinct',
            'inGameAdjustments'
        ].includes(skill)
    ) {
        // Tactical learning rewards adaptability, discipline, and reflection.
        adjustment =
            centeredTendency('adaptability') * 0.035 +
            centeredTendency('discipline') * 0.015 +
            centeredTendency('patience') * 0.010;
    } else if (skill === 'teaching') {
        // Teaching benefits from investment in development and relationships.
        adjustment =
            centeredTendency('developmentFocus') * 0.030 +
            centeredTendency('relationshipOrientation') * 0.020 +
            centeredTendency('patience') * 0.010;
    } else if (
        [
            'practiceDiscipline',
            'conditioning'
        ].includes(skill)
    ) {
        // Structured practice rewards discipline and sustained development.
        adjustment =
            centeredTendency('discipline') * 0.030 +
            centeredTendency('developmentFocus') * 0.015 +
            centeredTendency('patience') * 0.015;
    }

    // Keep personality effects meaningful but subordinate to actual
    // coaching ratings, available work hours, motivation, and growth limits.
    return Math.max(
        0.94,
        Math.min(1.06, 1 + adjustment)
    );
}

function getCoachMentorMultiplier(coach, skill, coaches, hoursByCoach) {
    const currentRatingValue = Number(coach.ratings?.[skill]);
    const currentRating = Number.isFinite(currentRatingValue)
        ? currentRatingValue
        : 50;

    const mentors = coaches.filter(mentor => {
        if (
            !mentor ||
            String(mentor.id) === String(coach.id)
        ) {
            return false;
        }

        const teachingValue = Number(mentor.ratings?.teaching);
        const mentorTeaching = Number.isFinite(teachingValue)
            ? teachingValue
            : 50;

        const mentorSkillValue = Number(mentor.ratings?.[skill]);
        const mentorSkill = Number.isFinite(mentorSkillValue)
            ? mentorSkillValue
            : 50;

        const mentorWork =
            hoursByCoach.get(String(mentor.id));

        return (
            mentorTeaching >= 65 &&
            mentorSkill >= currentRating + 10 &&
            (mentorWork?.training || 0) >= 4
        );
    });

    if (mentors.length === 0) return 1;

    // A strong teacher with relevant experience can accelerate learning,
    // but mentorship is a modest bonus rather than a free rating increase.
    return 1.15;
}

/**
 * Advances coach development once per team, year, and week.
 *
 * Assigned hours determine the learning opportunities.
 * Learning rate, motivation, personality, experience, mentorship,
 * potential ceilings, and remaining career budget determine progression.
 */
export function processWeeklyCoachDevelopment(team, year, week) {
    if (
        !team ||
        !Number.isInteger(year) ||
        !Number.isInteger(week) ||
        !Array.isArray(team.coaches)
    ) {
        return [];
    }

    const weekKey = `${year}:${week}`;

    const coaches = team.coaches.filter(coach =>
        coach?.id != null
    );

    if (coaches.length === 0) return [];

    const profiles = new Map();

    for (const coach of coaches) {
        profiles.set(
            String(coach.id),
            ensureCoachDevelopmentProfile(coach)
        );
    }

    // Count assigned hours without allowing an invalid plan to exceed
    // the 40-hour weekly limit per coach.
    const hoursByCoach = new Map();

    for (const coach of coaches) {
        hoursByCoach.set(String(coach.id), {
            total: 0,
            scouting: 0,
            training: 0,
            offensePrep: 0,
            defensePrep: 0
        });
    }

    for (const assignment of team.staffWorkPlan?.assignments || []) {
        const coachId = String(assignment?.coachId ?? '');
        const workload = hoursByCoach.get(coachId);

        if (!workload) continue;

        const task = assignment.task;
        if (!COACH_DEVELOPMENT_TASK_SKILLS[task]) continue;

        const requestedHours = Number(assignment.hours);
        if (!Number.isFinite(requestedHours) || requestedHours <= 0) {
            continue;
        }

        // Development reflects work the coach could realistically deliver,
        // not merely the hours assigned on paper.
        const effectiveHours = getEffectiveStaffWorkHours(
            team,
            assignment
        );

        if (
            !Number.isFinite(effectiveHours) ||
            effectiveHours <= 0
        ) {
            continue;
        }

        const availableHours = Math.max(
            0,
            WEEKLY_COACH_HOURS - workload.total
        );

        const allocatedHours = Math.min(
            effectiveHours,
            availableHours
        );

        workload[task] += allocatedHours;
        workload.total += allocatedHours;
    }

    const improvements = [];

    for (const coach of coaches) {
        const coachId = String(coach.id);
        const development = profiles.get(coachId);

        if (
            !development ||
            development.lastResolvedWeekKey === weekKey
        ) {
            continue;
        }

        const workload = hoursByCoach.get(coachId);

        const learningRate = Math.max(
            0.5,
            Math.min(
                1.3,
                Number(development.learningRate) || 1
            )
        );

        const motivation = Math.max(
            0.5,
            Math.min(
                1.5,
                Number(development.motivation) || 1
            )
        );

        const experienceMultiplier =
            1 + Math.min(
                0.15,
                development.experienceWeeks / (52 * 15) * 0.15
            );

        for (const [task, skillKeys] of Object.entries(
            COACH_DEVELOPMENT_TASK_SKILLS
        )) {
            const taskHours = workload?.[task] || 0;
            if (taskHours <= 0) continue;

            // Hours are shared across the discipline's related skills.
            const hoursPerSkill = taskHours / skillKeys.length;

            for (const skill of skillKeys) {
                const ratingValue = Number(coach.ratings?.[skill]);
                const currentRating = Number.isFinite(ratingValue)
                    ? ratingValue
                    : 50;

                const ceiling = Number(
                    development.skillCeilings?.[skill]
                );

                const skillCeiling = Number.isFinite(ceiling)
                    ? Math.min(COACH_SKILL_HARD_CAP, ceiling)
                    : Math.min(COACH_SKILL_HARD_CAP, currentRating);

                const growthRemaining =
                    development.careerGrowthBudget -
                    development.growthPointsUsed;

                // Reaching either limit stops further learning in this skill.
                if (
                    currentRating >= skillCeiling ||
                    growthRemaining <= 0
                ) {
                    development.progressBySkill[skill] = 0;
                    continue;
                }

                const headroom = skillCeiling - currentRating;

                // Learning slows as a coach approaches their personal ceiling.
                const potentialMultiplier = Math.max(
                    0.35,
                    Math.min(1, headroom / 5)
                );

                const personalityMultiplier =
                    getCoachLearningStyleMultiplier(coach, skill);

                const mentorMultiplier = getCoachMentorMultiplier(
                    coach,
                    skill,
                    coaches,
                    hoursByCoach
                );

                const progressEarned =
                    hoursPerSkill *
                    1.8 *
                    learningRate *
                    motivation *
                    experienceMultiplier *
                    personalityMultiplier *
                    mentorMultiplier *
                    potentialMultiplier;

                const priorProgress = Math.max(
                    0,
                    Number(development.progressBySkill[skill]) || 0
                );

                development.progressBySkill[skill] =
                    priorProgress + progressEarned;
            }
        }

        // A skill can improve at most once per week.
        // Each rating point also consumes one lifetime growth point.
        for (const skill of COACH_DEVELOPMENT_SKILLS) {
            const progress = Number(
                development.progressBySkill[skill]
            ) || 0;

            const ratingValue = Number(coach.ratings?.[skill]);
            const currentRating = Number.isFinite(ratingValue)
                ? ratingValue
                : 50;

            const ceiling = Math.min(
                COACH_SKILL_HARD_CAP,
                Number(development.skillCeilings?.[skill]) ||
                    currentRating
            );

            const growthRemaining =
                development.careerGrowthBudget -
                development.growthPointsUsed;

            if (
                progress < 100 ||
                currentRating >= ceiling ||
                growthRemaining <= 0
            ) {
                if (currentRating >= ceiling || growthRemaining <= 0) {
                    development.progressBySkill[skill] = 0;
                }

                continue;
            }

                        coach.ratings[skill] = Math.min(
                ceiling,
                currentRating + 1
            );

            development.progressBySkill[skill] = progress - 100;
            development.growthPointsUsed += 1;

            // Record which assignments were relevant to this improvement.
            const contributingTasks = Object.entries(
                COACH_DEVELOPMENT_TASK_SKILLS
            )
                .filter(([task, skillKeys]) =>
                    skillKeys.includes(skill) &&
                    (workload?.[task] || 0) > 0
                )
                .map(([task]) => ({
                    task,
                    hours: workload[task]
                }));

            const historyEntry = {
                year,
                week,
                skill,
                previousRating: currentRating,
                newRating: coach.ratings[skill],
                remainingGrowthPoints: Math.max(
                    0,
                    development.careerGrowthBudget -
                    development.growthPointsUsed
                ),
                contributingTasks
            };

            if (!Array.isArray(development.history)) {
                development.history = [];
            }

            development.history.push(historyEntry);

            // Keep the most recent 50 improvements per coach.
            if (development.history.length > 50) {
                development.history.splice(
                    0,
                    development.history.length - 50
                );
            }

            improvements.push({
                coachId: coach.id,
                coachName: coach.name,
                ...historyEntry
            });
        }

        development.experienceWeeks += 1;
        development.remainingGrowthPoints = Math.max(
            0,
            development.careerGrowthBudget -
                development.growthPointsUsed
        );

        development.lastResolvedWeekKey = weekKey;
    }

    return improvements;
}

/**
 * Creates the flexible coaching group while preserving legacy staff references.
 *
 * Main teams receive three staff coaches. The player-controlled team also
 * receives a user-coach profile, representing the player's coaching time.
 */
export function ensureTeamCoachingStaff(team) {
    if (!team) return [];

    const candidates = Array.isArray(team.coaches)
        ? team.coaches
        : [];

    const npcCoaches = [];
    const seenIds = new Set();

    for (const candidate of candidates) {
        if (
            !candidate?.id ||
            candidate.isUserCoach ||
            seenIds.has(String(candidate.id))
        ) {
            continue;
        }

        seenIds.add(String(candidate.id));
        npcCoaches.push(candidate);

        if (npcCoaches.length >= 3) break;
    }

    // Preserve intentional vacancies created by the offseason carousel.
    // Legacy saves without this field continue to fill missing coach slots.
    const recordedVacancies = Math.max(
        0,
        Math.min(
            3,
            Math.floor(Number(team.coachingVacancies) || 0)
        )
    );

    team.coachingVacancies = Math.min(
        recordedVacancies,
        Math.max(0, 3 - npcCoaches.length)
    );

    const targetNpcCoachCount = 3 - team.coachingVacancies;

    while (npcCoaches.length < targetNpcCoachCount) {
        const coach = generateStaffMember('coach', 30, 55);
        coach.teamId = team.id;
        npcCoaches.push(coach);
    }

    npcCoaches.forEach(coach => {
        coach.teamId = team.id;
    });

    if (!team.isPlayerControlled) {
        team.coaches = npcCoaches;

        team.coaches.forEach(ensureCoachDevelopmentProfile);

        return team.coaches;
    }

    const gmProfile = team.gmProfile || {};
    const existingUserCoach =
        (Array.isArray(team.coaches)
            ? team.coaches.find(coach => coach?.isUserCoach)
            : null) ||
        team.userCoachProfile ||
        {};

    const expertisePositions = Array.isArray(gmProfile.expertisePositions)
        ? [...gmProfile.expertisePositions]
        : [];

    const scoutingAccuracyBonus = Math.max(
        -0.25,
        Math.min(
            0.35,
            (Number(gmProfile.bonuses?.scoutingAccuracy) || 0) +
            (Number(gmProfile.expertiseScoutingBonus) || 0)
        )
    );

    const userCoach = {
        ...existingUserCoach,
        id: existingUserCoach.id || `user-coach-${team.id}`,
        name: gmProfile.name || existingUserCoach.name || 'You',
        role: 'user-coach',
        isUserCoach: true,
        teamId: team.id,
        gmBackgroundId: gmProfile.backgroundId || null,
        gmArchetypeId: gmProfile.archetypeId || null,
        gmExpertiseId: gmProfile.expertiseId || null,
        expertisePositions,
        scoutingAccuracyBonus,
        preferredOffense: gmProfile.offensiveIdentity ||
            existingUserCoach.preferredOffense ||
            null,
        preferredDefense: gmProfile.defensiveIdentity ||
            existingUserCoach.preferredDefense ||
            null,
        ratings: {
            evalPhysicals: 50,
            evalTechnique: 50,
            evalCharacter: 50,
            offSchemeMastery: 50,
            defSchemeMastery: 50,
            gameplanInstinct: 50,
            inGameAdjustments: 50,
            teaching: 50,
            practiceDiscipline: 50,
            conditioning: 50,
            ...(existingUserCoach.ratings || {})
        },
        biases: {
            ...(existingUserCoach.biases || {}),

            scouting: existingUserCoach.biases?.scouting || {
                ...scoutingBiases.find(
                    profile => profile.id === 'balanced_evaluator'
                )
            },

            tactical: existingUserCoach.biases?.tactical || {
                ...tacticalBiases.find(
                    profile => profile.id === 'adaptive_strategist'
                )
            },

            personality: existingUserCoach.biases?.personality || {
                ...personalityTraits.find(
                    profile => profile.id === 'analytical_planner'
                ),
                tendencies: {
                    ...personalityTraits.find(
                        profile => profile.id === 'analytical_planner'
                    ).tendencies
                }
            }
        },

        profileIds: {
            ...(existingUserCoach.profileIds || {}),

            scouting:
                getStaffProfileId(existingUserCoach, 'scouting') ||
                'balanced_evaluator',

            tactical:
                getStaffProfileId(existingUserCoach, 'tactical') ||
                'adaptive_strategist',

            personality:
                getStaffProfileId(existingUserCoach, 'personality') ||
                'analytical_planner'
        }
    };

    team.userCoachProfile = userCoach;
    team.coaches = [...npcCoaches, userCoach];

    team.coaches.forEach(ensureCoachDevelopmentProfile);

    return team.coaches;
}

export function processCoachOffseasonRetention(
    team,
    gameState,
    year = gameState?.year,
    random = Math.random
) {
    if (!team) {
        return {
            processed: false,
            happinessChanges: [],
            departures: []
        };
    }

    const seasonYear = Number(year);

    if (!Number.isInteger(seasonYear)) {
        return {
            processed: false,
            happinessChanges: [],
            departures: []
        };
    }

    // Prevent duplicate offseason processing.
    if (Number(team.coachRetentionResolvedYear) === seasonYear) {
        return {
            processed: false,
            alreadyProcessed: true,
            happinessChanges: [],
            departures: []
        };
    }

    const coaches = ensureTeamCoachingStaff(team)
        .filter(coach => coach?.id != null && !coach.isUserCoach);

    const wins = Math.max(0, Number(team.wins) || 0);
    const losses = Math.max(0, Number(team.losses) || 0);
    const gamesPlayed = wins + losses;

    const winPct = gamesPlayed > 0
        ? wins / gamesPlayed
        : null;

    // Use explicit expectation data when available. Older saves without
    // expectation fields continue using the established win-percentage model.
    const expectedWinsCandidates = [
        team.preseasonExpectedWins,
        team.expectedWins,
        team.seasonExpectations?.expectedWins,
        team.expectations?.expectedWins
    ];

    const expectedWinsValue = expectedWinsCandidates.find(value =>
        value !== null &&
        value !== undefined &&
        Number.isFinite(Number(value))
    );

    const expectedWins = expectedWinsValue !== undefined
        ? Number(expectedWinsValue)
        : null;

    const expectedWinPctCandidates = [
        team.preseasonExpectedWinPct,
        team.expectedWinPct,
        team.seasonExpectations?.expectedWinPct,
        team.expectations?.winPct
    ];

    const expectedWinPctValue = expectedWinPctCandidates.find(value =>
        value !== null &&
        value !== undefined &&
        Number.isFinite(Number(value))
    );

    const expectedWinPct = expectedWinPctValue !== undefined
        ? Math.max(0, Math.min(1, Number(expectedWinPctValue)))
        : null;

    const happinessChanges = [];
    const departures = [];

    team.coachRetentionResolvedYear = seasonYear;

    for (const coach of coaches) {
        ensureStaffNegotiationProfile(coach);

        const previousHappiness = Number(coach.happiness) || 0;
        const ego = Number(coach.ego) || 50;

        let happinessChange = 0;

        // Base adjustment for the team's actual season performance.
        if (gamesPlayed >= 4 && winPct !== null) {
            if (winPct >= 0.67) {
                happinessChange = 5;
            } else if (winPct >= 0.50) {
                happinessChange = 3;
            } else if (winPct >= 0.34) {
                happinessChange = 1;
            } else if (winPct >= 0.20) {
                happinessChange = -4;
            } else {
                happinessChange = -7;
            }
        }

        // Reward exceeding expectations and penalize falling short.
        // Keep this adjustment modest so actual performance still matters.
        let expectationAdjustment = 0;

        if (gamesPlayed >= 4) {
            if (expectedWins !== null) {
                const winDifference = wins - expectedWins;

                if (winDifference >= 2) {
                    expectationAdjustment = 2;
                } else if (winDifference <= -2) {
                    expectationAdjustment = -3;
                } else if (winDifference >= 1) {
                    expectationAdjustment = 1;
                } else if (winDifference <= -1) {
                    expectationAdjustment = -1;
                }
            } else if (expectedWinPct !== null && winPct !== null) {
                const pctDifference = winPct - expectedWinPct;

                if (pctDifference >= 0.15) {
                    expectationAdjustment = 2;
                } else if (pctDifference <= -0.15) {
                    expectationAdjustment = -3;
                } else if (pctDifference >= 0.05) {
                    expectationAdjustment = 1;
                } else if (pctDifference <= -0.05) {
                    expectationAdjustment = -1;
                }
            }
        }

        // Determine the coach's primary responsibility from actual workload.
        // If no assignments exist, fall back to the coach's strongest specialty.
        const roleHours = new Map();

        for (const assignment of team.staffWorkPlan?.assignments || []) {
            if (
                String(assignment?.coachId) !== String(coach.id) ||
                !['scouting', 'training', 'offensePrep', 'defensePrep'].includes(assignment?.task)
            ) {
                continue;
            }

            const hours = Number(assignment.hours);

            roleHours.set(
                assignment.task,
                (roleHours.get(assignment.task) || 0) +
                    (Number.isFinite(hours) ? Math.max(0, hours) : 0)
            );
        }

        const roles = [
            'scouting',
            'training',
            'offensePrep',
            'defensePrep'
        ];

        let coachRole = null;

        if (roleHours.size > 0) {
            coachRole = [...roleHours.entries()]
                .sort((a, b) => b[1] - a[1])[0][0];
        } else {
            coachRole = roles
                .map(role => ({
                    role,
                    fit: calculateCoachRoleFit(coach, role)
                }))
                .sort((a, b) => b.fit - a.fit)[0].role;
        }

        const roleFit = calculateCoachRoleFit(coach, coachRole);

        // Role fit should matter, but remain secondary to season results.
        let roleFitAdjustment = 0;

        if (roleFit >= 80) {
            roleFitAdjustment = 2;
        } else if (roleFit < 40) {
            roleFitAdjustment = -2;
        }

        happinessChange += expectationAdjustment + roleFitAdjustment;

        coach.happiness = Math.max(
            0,
            Math.min(100, previousHappiness + happinessChange)
        );

        if (coach.happiness !== previousHappiness) {
            happinessChanges.push({
                coachId: coach.id,
                coachName: coach.name,
                previousHappiness,
                happiness: coach.happiness,
                change: coach.happiness - previousHappiness,
                expectationAdjustment,
                roleFitAdjustment
            });
        }

        // Life events remain rare and independent of team performance.
        const lifeEvent = random() < 0.005;

        // Dissatisfaction is the primary driver of voluntary departures.
        const unhappinessRisk = coach.happiness < 55
            ? (55 - coach.happiness) * 0.006
            : 0;

        // Poor results are more concerning when the team also falls short
        // of its stated expectations.
        let poorSeasonRisk = 0;

        if (gamesPlayed >= 4 && winPct !== null) {
            const clearlyBelowExpectations =
                expectedWins !== null
                    ? wins <= expectedWins - 2
                    : expectedWinPct !== null
                        ? winPct <= expectedWinPct - 0.15
                        : false;

            if (winPct < 0.30) {
                poorSeasonRisk = clearlyBelowExpectations
                    ? 0.05
                    : 0.025;
            } else if (clearlyBelowExpectations) {
                poorSeasonRisk = 0.02;
            }
        }

        // A high-ego coach is more likely to seek a change when dissatisfied.
        const ambitionRisk =
            coach.happiness < 65 && ego >= 80
                ? 0.02
                : 0;

        // Poor role fit can contribute to a departure, but only when the
        // coach is also unhappy or has a strong reason to seek a change.
        const roleFitDepartureRisk =
            roleFit < 40 && coach.happiness < 70
                ? 0.02
                : 0;

        const voluntaryDepartureRisk = Math.min(
            0.25,
            unhappinessRisk +
            poorSeasonRisk +
            ambitionRisk +
            roleFitDepartureRisk
        );

        const voluntaryDeparture = !lifeEvent &&
            random() < voluntaryDepartureRisk;

        if (!lifeEvent && !voluntaryDeparture) continue;

        let reason;

        if (lifeEvent) {
            const lifeEventReasons = [
                'a family relocation',
                'family responsibilities',
                'another volunteer commitment'
            ];

            const eventIndex = Math.min(
                lifeEventReasons.length - 1,
                Math.floor(random() * lifeEventReasons.length)
            );

            reason = lifeEventReasons[eventIndex];
        } else if (roleFit < 40) {
            reason = 'poor fit with the current role';
        } else if (
            expectedWins !== null &&
            gamesPlayed >= 4 &&
            wins <= expectedWins - 2
        ) {
            reason = 'disappointment with the team falling short of expectations';
        } else {
            reason = 'dissatisfaction with the current role';
        }

        const coachId = String(coach.id);

        team.coaches = (Array.isArray(team.coaches)
            ? team.coaches
            : []
        ).filter(member =>
            String(member?.id) !== coachId
        );

        team.coachingVacancies = Math.min(
            3,
            Math.max(
                0,
                Math.floor(Number(team.coachingVacancies) || 0)
            ) + 1
        );

        coach.teamId = null;
        coach.weeksUnemployed = 0;
        coach.lastOffseasonDeparture = {
            year: seasonYear,
            reason
        };

        if (gameState) {
            if (!Array.isArray(gameState.availableStaff)) {
                gameState.availableStaff = [];
            }

            const alreadyAvailable = gameState.availableStaff.some(
                candidate =>
                    String(candidate?.id) === coachId
            );

            if (!alreadyAvailable) {
                gameState.availableStaff.push(coach);
            }
        }

        // Remove work assignments for the departing coach.
        if (Array.isArray(team.staffWorkPlan?.assignments)) {
            team.staffWorkPlan.assignments =
                team.staffWorkPlan.assignments.filter(assignment =>
                    String(assignment?.coachId) !== coachId
                );
        }

        departures.push({
            coachId: coach.id,
            coachName: coach.name,
            reason,
            lifeEvent
        });
    }

    if (departures.length > 0) {
        // Do not automatically fill vacancies; staff review handles hiring.
        const remainingCoaches = team.coaches.filter(
            coach => coach?.id != null && !coach.isUserCoach
        );

        if (!team.staff) team.staff = {};

        team.staff.coach = remainingCoaches[0] || null;
        team.staff.scout = remainingCoaches[1] || null;
        team.staff.trainer = remainingCoaches[2] || null;
        team.coach = remainingCoaches[0] || null;
    }

    return {
        processed: true,
        seasonYear,
        winPct,
        expectedWins,
        expectedWinPct,
        happinessChanges,
        departures
    };
}


function buildDefaultAutomatedStaffAssignments(coaches) {
    const tasks = [
        'scouting',
        'training',
        'offensePrep',
        'defensePrep'
    ];

    const taskScore = (coach, task) => {
        const skills = COACH_DEVELOPMENT_TASK_SKILLS[task] || [];

        if (skills.length === 0) return 50;

        return skills.reduce((total, skill) => {
            const value = Number(coach.ratings?.[skill]);

            return total + (
                Number.isFinite(value)
                    ? Math.max(0, Math.min(100, value))
                    : 50
            );
        }, 0) / skills.length;
    };

    const eligibleCoaches = coaches
        .filter(coach => coach?.id != null)
        .map(coach => {
            const availability = ensureStaffAvailability(coach);
            const rawHours = Number(availability?.weeklyHours);

            return {
                coach,
                capacity: Math.max(
                    0,
                    Math.min(
                        WEEKLY_COACH_HOURS,
                        Math.floor(
                            Number.isFinite(rawHours) ? rawHours : 8
                        )
                    )
                )
            };
        })
        .filter(item => item.capacity > 0);

    const remainingCoaches = [...eligibleCoaches];
    const assignments = [];

    // Give each task a primary specialist, using the staff skills to
    // choose the best available coach for that responsibility.
    for (const task of tasks) {
        if (remainingCoaches.length === 0) break;

        remainingCoaches.sort(
            (a, b) =>
                taskScore(b.coach, task) -
                taskScore(a.coach, task)
        );

        const { coach, capacity } = remainingCoaches.shift();

        // Most hours go toward the coach's assigned specialty.
        // The remainder supports player development.
        const specialtyHours = task === 'training'
            ? capacity
            : Math.max(1, Math.round(capacity * 0.7));

        const trainingHours = capacity - specialtyHours;

        assignments.push({
            coachId: String(coach.id),
            task,
            hours: specialtyHours,
            focus: 'all',
            ...(task === 'scouting' ? { maxTargets: 2 } : {})
        });

        if (trainingHours > 0) {
            assignments.push({
                coachId: String(coach.id),
                task: 'training',
                hours: trainingHours,
                focus: 'all',
                maxTargets: 4
            });
        }
    }

    return assignments;
}

/**
 * Creates a persisted default work plan for existing and new teams.
 * Existing player-configured assignments are preserved.
 */
export function ensureTeamStaffWorkPlan(team) {
    if (!team) return null;
    // Migrate older saves and cover both legacy roles and the flexible
    // coaching group. De-duplicate staff who appear in both structures.
    const staffRecords = [
        ...(Array.isArray(team.coaches) ? team.coaches : []),
        ...Object.values(team.staff || {})
    ];

    const uniqueStaff = new Map();

    staffRecords.forEach(staff => {
        if (!staff) return;

        const key = staff.id != null
            ? String(staff.id)
            : staff;

        uniqueStaff.set(key, staff);
    });

    uniqueStaff.forEach(staff => {
        ensureStaffAvailability(staff);
    });

    const coaches = ensureTeamCoachingStaff(team);
    let plan = team.staffWorkPlan;

    if (!plan || !Array.isArray(plan.assignments)) {
        plan = {
            version: 1,
            weeklyHoursPerCoach: WEEKLY_COACH_HOURS,
            assignments: buildDefaultAutomatedStaffAssignments(
                ensureTeamCoachingStaff(team)
            ),
            defaultWorkloadSeeded: true
        };

        team.staffWorkPlan = plan;
    }

    // Migrate the untouched legacy default assignment once.
    // Do not replace plans that have already been auto-assigned or customized.
    const legacyDefaultAssignment =
        plan.assignments.length === 1 &&
        plan.assignments[0]?.task === STAFF_WORK_TASKS.SCOUTING &&
        Number(plan.assignments[0]?.hours) === 4 &&
        (plan.assignments[0]?.focus || 'all') === 'all' &&
        Number(plan.assignments[0]?.maxTargets || 1) === 1;

    if (
        legacyDefaultAssignment &&
        !plan.defaultWorkloadSeeded &&
        !plan.autoAssignedFor
    ) {
        plan.assignments = buildDefaultAutomatedStaffAssignments(
        ensureTeamCoachingStaff(team)
    );
        plan.defaultWorkloadSeeded = true;
    }

    const configuredHours = Number(plan.weeklyHoursPerCoach);

    plan.weeklyHoursPerCoach = Number.isFinite(configuredHours) &&
        configuredHours > 0
        ? Math.min(
            WEEKLY_COACH_HOURS,
            Math.floor(configuredHours)
        )
        : WEEKLY_COACH_HOURS;

    plan.version = 1;

    return plan;
}

/**
 * Returns each active coach's available hours for the offseason
 * recruiting week, using the established staff availability rules.
 *
 * The returned budget is informational; hours are not consumed here.
 */
export function getRecruitingStaffHourBudget(team) {
    if (!team) return [];

    const seenCoachIds = new Set();

    return ensureTeamCoachingStaff(team)
        .filter(coach => {
            if (coach?.id == null) return false;

            const coachId = String(coach.id);

            if (seenCoachIds.has(coachId)) return false;

            seenCoachIds.add(coachId);
            return true;
        })
        .map(coach => {
            const availability = ensureStaffAvailability(coach);
            const rawHours = Number(availability?.weeklyHours);

            const weeklyHours = Math.max(
                0,
                Math.min(
                    WEEKLY_COACH_HOURS,
                    Math.floor(
                        Number.isFinite(rawHours) ? rawHours : 8
                    )
                )
            );

            return {
                coachId: String(coach.id),
                coachName: coach.name || 'Coach',
                weeklyHours
            };
        });
}

/**
 * Records a recruiting assignment against a coach's finite weekly hours.
 *
 * Assignments persist across recruiting days. This function validates and
 * records staff effort; recruiting-interest changes are handled separately.
 */
export function recordRecruitingStaffAssignment(
    gameState,
    teamId,
    coachId,
    playerId,
    hours,
    actionType = 'outreach'
) {
    if (!gameState?.teams || !gameState?.players) {
        return {
            success: false,
            message: 'Game state is unavailable.'
        };
    }

    const offseason = gameState.offseasonState || {};
    const normalizedPhase = String(offseason.phase || '')
        .toLowerCase()
        .replace(/[^a-z]/g, '');

    if (normalizedPhase !== 'recruiting') {
        return {
            success: false,
            message: 'The recruiting week is not active.'
        };
    }

    const recruitingDay = Number(offseason.recruitingDay);
    const recruitingDays = Number(offseason.recruitingDays);

    if (
        !Number.isInteger(recruitingDay) ||
        !Number.isInteger(recruitingDays) ||
        recruitingDay < 1 ||
        recruitingDay > recruitingDays
    ) {
        return {
            success: false,
            message: 'The current recruiting day is invalid.'
        };
    }

    const progress = offseason.recruitingProgress;

    if (
        !progress ||
        progress.initialized !== true ||
        progress.completed === true ||
        Number(progress.seasonYear) !== Number(gameState.year)
    ) {
        return {
            success: false,
            message: 'Recruiting progress is not initialized for this season.'
        };
    }

    const day = Number(offseason.recruitingDay);
    const totalDays = Number(offseason.recruitingDays);

    if (
        !Number.isInteger(day) ||
        !Number.isInteger(totalDays) ||
        day < 1 ||
        day > totalDays
    ) {
        return {
            success: false,
            message: 'The current recruiting day is invalid.'
        };
    }

    const team = gameState.teams.find(
        candidate => String(candidate?.id) === String(teamId)
    );

    if (!team || team.leagueType !== 'main') {
        return {
            success: false,
            message: 'The recruiting team is invalid.'
        };
    }

    const recruitKey = String(playerId);
    const teamKey = String(teamId);
    const coachKey = String(coachId);

    const player = gameState.players.find(
        candidate => String(candidate?.id) === recruitKey
    );

    const record = progress.recruits?.[recruitKey];

    const protectedDraftIds = new Set(
        (Array.isArray(gameState.draftClass) ? gameState.draftClass : [])
            .filter(prospect => prospect?.id != null)
            .map(prospect => String(prospect.id))
    );

    const age = Number(player?.age);

    const statusType = String(
        player?.status?.type || ''
    ).toLowerCase();

    const lifecycle = String(
        player?.lifecycle || ''
    ).toLowerCase();

    const lifecycleStatus = String(
        player?.lifecycleStatus || player?.lifecycle?.status || ''
    ).toLowerCase();

    if (
        !team ||
        team.leagueType !== 'main' ||
        !player ||
        player.teamId != null ||
        (
            Array.isArray(player.refusedTeamIds) &&
            player.refusedTeamIds.some(
                refusedTeamId => String(refusedTeamId) === teamKey
            )
        ) ||
        !record ||
        record.status !== 'available' ||
        record.committedTeamId != null ||
        !Number.isFinite(age) ||
        age < 12 ||
        age > 18 ||
        protectedDraftIds.has(String(player.id)) ||
        lifecycle === 'draft_eligible' ||
        lifecycleStatus === 'draft_eligible' ||
        ['retired', 'departed', 'temporary', 'injured'].includes(statusType) ||
        ['retired', 'departed', 'temporary', 'injured'].includes(lifecycleStatus) ||
        Number(player.status?.duration) > 0 ||
        Number(player.injury?.duration || player.injuryDuration || 0) > 0
    ) {
        return {
            success: false,
            message: 'This recruit is no longer available.'
        };
    }

    const validActions = new Set([
        'outreach',
        'teammateConnection',
        'roleDiscussion',
        'practiceInvitation'
    ]);

    if (!validActions.has(actionType)) {
        return {
            success: false,
            message: 'Invalid recruiting action.'
        };
    }

    const requestedHours = Number(hours);

    if (
        !Number.isInteger(requestedHours) ||
        requestedHours <= 0
    ) {
        return {
            success: false,
            message: 'Assigned hours must be a positive whole number.'
        };
    }

    const currentStaff = ensureTeamCoachingStaff(team);

    const assignedCoach = currentStaff.find(
        coach => String(coach?.id) === coachKey
    );

    const coachBudget = getRecruitingStaffHourBudget(team).find(
        coach => String(coach.coachId) === coachKey
    );

    if (!assignedCoach || !coachBudget) {
        return {
            success: false,
            message: 'That coach is not currently on this staff.'
        };
    }

    if (coachBudget.weeklyHours <= 0) {
        return {
            success: false,
            message: 'This coach has no available recruiting hours.'
        };
    }

    if (!progress.teamDailyWork || typeof progress.teamDailyWork !== 'object') {
        progress.teamDailyWork = {};
    }

    // Reuse teamKey declared earlier in executeRecruitingAction().
    if (!progress.teamDailyWork[teamKey]) {
        progress.teamDailyWork[teamKey] = {};
    }

    const teamWork = progress.teamDailyWork[teamKey];

    const previousAssignments = Object.values(teamWork).flatMap(
        assignments => Array.isArray(assignments) ? assignments : []
    );

    const hoursAlreadyUsed = previousAssignments
        .filter(assignment =>
            String(assignment.coachId) === coachKey
        )
        .reduce(
            (total, assignment) =>
                total + Math.max(0, Number(assignment.hours) || 0),
            0
        );

    const remainingHours = Math.max(
        0,
        coachBudget.weeklyHours - hoursAlreadyUsed
    );

    if (requestedHours > remainingHours) {
        return {
            success: false,
            message:
                `${coachBudget.coachName} has ${remainingHours} recruiting ` +
                `hour(s) remaining this week, but ${requestedHours} were requested.`,
            remainingHours
        };
    }

    const assignment = {
        year: Number(gameState.year),
        day,
        teamId: team.id,
        coachId: coachKey,
        coachName: coachBudget.coachName,
        playerId: player.id,
        action: actionType,
        hours: requestedHours
    };

    const dayKey = String(day);

    if (!Array.isArray(teamWork[dayKey])) {
        teamWork[dayKey] = [];
    }

    teamWork[dayKey].push(assignment);

    record.history = Array.isArray(record.history)
        ? record.history
        : [];

    record.history.push({
        type: 'staff_assignment',
        year: assignment.year,
        day,
        teamId: team.id,
        coachId: coachKey,
        action: actionType,
        hours: requestedHours
    });

    if (!Array.isArray(progress.dailyActivity)) {
        progress.dailyActivity = [];
    }

    progress.dailyActivity.push({
        type: 'staff_assignment',
        year: assignment.year,
        day,
        teamId: team.id,
        coachId: coachKey,
        playerId: player.id,
        action: actionType,
        hours: requestedHours
    });

    return {
        success: true,
        assignment,
        remainingHours: remainingHours - requestedHours
    };
}

/**
 * Performs a staff-led recruiting action and increases the recruit's
 * interest in the team. Staff hours are validated and persisted first.
 */
export function executeRecruitingAction(
    gameState,
    teamId,
    coachId,
    playerId,
    actionType,
    hours
) {
    const profiles = {
        outreach: {
            label: 'Personal outreach',
            pointsPerHour: 2.2,
            skills: ['teaching', 'evalCharacter']
        },
        teammateConnection: {
            label: 'Teammate connection',
            pointsPerHour: 1.9,
            skills: ['evalCharacter', 'teaching']
        },
        roleDiscussion: {
            label: 'Role discussion',
            pointsPerHour: 2.1,
            skills: ['gameplanInstinct', 'teaching']
        },
        practiceInvitation: {
            label: 'Pickup practice invitation',
            pointsPerHour: 2.3,
            skills: ['teaching', 'conditioning']
        }
    };

    const profile = profiles[actionType];

    if (!profile) {
        return {
            success: false,
            message: 'Invalid recruiting action.'
        };
    }

    const state = gameState?.offseasonState;
    const progress = state?.recruitingProgress;

    const normalizedPhase = String(state?.phase || '')
        .toLowerCase()
        .replace(/[^a-z]/g, '');

    const recruitingDay = Number(state?.recruitingDay);
    const recruitingDays = Number(state?.recruitingDays);

    if (
        !Array.isArray(gameState?.teams) ||
        !Array.isArray(gameState?.players) ||
        normalizedPhase !== 'recruiting' ||
        !progress ||
        progress.initialized !== true ||
        progress.completed === true ||
        Number(progress.seasonYear) !== Number(gameState.year) ||
        !Number.isInteger(recruitingDay) ||
        !Number.isInteger(recruitingDays) ||
        recruitingDay < 1 ||
        recruitingDay > recruitingDays
    ) {
        return {
            success: false,
            message: 'The recruiting board is not active for this season.'
        };
    }

    const team = gameState.teams?.find(
        candidate => String(candidate?.id) === String(teamId)
    );

    if (!team || team.leagueType !== 'main') {
        return {
            success: false,
            message: 'The recruiting team is unavailable.'
        };
    }

    const coach = ensureTeamCoachingStaff(team).find(
        candidate => String(candidate?.id) === String(coachId)
    );

    if (!coach) {
        return {
            success: false,
            message: 'That coach is no longer on this staff.'
        };
    }

    const recruitKey = String(playerId);
    const teamKey = String(team.id);
    const recruitRecord = progress.recruits?.[recruitKey];
    const player = gameState.players?.find(
        candidate => String(candidate?.id) === recruitKey
    );

    if (
        !player ||
        player.teamId != null ||
        !recruitRecord ||
        recruitRecord.status !== 'available' ||
        recruitRecord.committedTeamId != null
    ) {
        return {
            success: false,
            message: 'This recruit is no longer available.'
        };
    }

    const hasRefusedThisTeam =
        Array.isArray(player.refusedTeamIds) &&
        player.refusedTeamIds.some(
            refusedTeamId => String(refusedTeamId) === teamKey
        );

    if (hasRefusedThisTeam) {
        return {
            success: false,
            message: 'This recruit has refused to return to your team.'
        };
    }

    const recruitAge = Number(player.age);

    if (
        !Number.isFinite(recruitAge) ||
        recruitAge < 12 ||
        recruitAge > 18
    ) {
        return {
            success: false,
            message: 'This player is not eligible for recruiting.'
        };
    }

    const currentInterest = Math.max(
        0,
        Math.min(
            100,
            Number(recruitRecord.interestByTeam?.[teamKey]) || 0
        )
    );

    if (currentInterest >= 100) {
        return {
            success: false,
            message: 'Your team has already maximized this recruit’s interest.'
        };
    }

    const assignmentResult = recordRecruitingStaffAssignment(
        gameState,
        team.id,
        coach.id,
        player.id,
        hours,
        actionType
    );

    if (!assignmentResult.success) {
        return assignmentResult;
    }

    const rating = key => {
        const value = Number(coach.ratings?.[key]);

        return Number.isFinite(value)
            ? Math.max(0, Math.min(100, value))
            : 50;
    };

    const averageSkill = profile.skills.reduce(
        (total, key) => total + rating(key),
        0
    ) / profile.skills.length;

    // Better-suited coaches get more interest from the same time investment.
    const skillMultiplier = 0.65 + (averageSkill / 100) * 0.7;
    const assignedHours = Number(hours);

    // Repeating the same tactic has diminishing returns. Teams benefit
    // from varying their approach instead of spamming one action.
    const history = Array.isArray(recruitRecord.history)
        ? recruitRecord.history
        : [];

    const repeatedActions = history.filter(entry =>
        entry?.type === 'recruiting_action' &&
        String(entry.teamId) === teamKey &&
        entry.action === actionType
    ).length;

    const repetitionMultiplier = Math.pow(0.75, repeatedActions);

    let contextBonus = 0;
    const roster = getRosterObjects(team);
    const recruitId = String(player.id);

    if (actionType === 'teammateConnection') {
        // Relationship bonuses require evidence recorded in this team's
        // scouting report. Do not inspect private player social profiles.
        const relationshipReport = getTeamScoutingReport(
            team,
            player.id
        );

        const networkEvidence = relationshipReport?.networkEvidence;

        const knownFriendIds = Array.isArray(
            networkEvidence?.knownTeammateFriendIds
        )
            ? networkEvidence.knownTeammateFriendIds.map(String)
            : [];

        const knownRivalIds = Array.isArray(
            networkEvidence?.knownTeammateRivalIds
        )
            ? networkEvidence.knownTeammateRivalIds.map(String)
            : [];

        const rosterIds = new Set(
            roster
                .filter(member => member?.id != null)
                .map(member => String(member.id))
        );

        const knownFriendCount = new Set(
            knownFriendIds.filter(id => rosterIds.has(id))
        ).size;

        const hasKnownRival = knownRivalIds.some(
            id => rosterIds.has(id)
        );

        if (knownFriendCount > 0) {
            contextBonus += 5;

            contextBonus += Math.min(
                5,
                Math.max(0, knownFriendCount - 1) * 2
            );
        }

        if (hasKnownRival) {
            contextBonus -= 5;
        }
    }

    if (actionType === 'roleDiscussion') {
        // Public listed position is safe to use.
        // Alternative positions require sufficient team-specific scouting.
        const validPositions = [
            'QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'
        ];

        const listedPosition = String(
            player.pos || ''
        ).toUpperCase();

        let position = validPositions.includes(listedPosition)
            ? listedPosition
            : null;

        if (!position) {
            const scoutingReport = getTeamScoutingReport(
                team,
                player.id
            );

            const rawConfidence = Number(
                scoutingReport?.confidence
            );

            const reportConfidence = Number.isFinite(rawConfidence)
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

            if (reportConfidence >= 0.50) {
                const reportedFits = [
                    scoutingReport?.evaluation?.offenseFit,
                    scoutingReport?.evaluation?.defenseFit
                ]
                    .filter(fit => {
                        const fitPosition = String(
                            fit?.position || ''
                        ).toUpperCase();

                        return (
                            validPositions.includes(fitPosition) &&
                            fit.low != null &&
                            fit.high != null &&
                            Number.isFinite(Number(fit.low)) &&
                            Number.isFinite(Number(fit.high))
                        );
                    })
                    .map(fit => {
                        const low = Number(fit.low);
                        const high = Number(fit.high);
                        const midpoint = (low + high) / 2;

                        return {
                            position: String(
                                fit.position
                            ).toUpperCase(),

                            selectionScore:
                                low + (midpoint - low) * reportConfidence
                        };
                    })
                    .sort(
                        (a, b) =>
                            b.selectionScore - a.selectionScore
                    );

                position = reportedFits[0]?.position || null;
            }
        }

        // Do not promise a specific positional role when the team
        // lacks sufficient information to identify that position.
        if (position) {
            const positionalPeers = roster.filter(member => {
                const memberPositions = [
                    member?.pos,
                    member?.favoriteOffensivePosition,
                    member?.favoriteDefensivePosition
                ].map(value =>
                    String(value || '').toUpperCase()
                );

                return memberPositions.includes(position);
            });

            if (positionalPeers.length === 0) {
                contextBonus += 4;
            } else if (positionalPeers.length >= 4) {
                contextBonus -= 3;
            }
        }
    }

    let interestGain =
        assignedHours *
            profile.pointsPerHour *
            skillMultiplier *
            repetitionMultiplier +
        contextBonus;

    // Interest is harder to move once a player is already strongly engaged.
    if (currentInterest >= 90) {
        interestGain *= 0.35;
    } else if (currentInterest >= 75) {
        interestGain *= 0.65;
    }

    interestGain = Math.max(1, Math.round(interestGain));

    const newInterest = Math.max(
        0,
        Math.min(100, currentInterest + interestGain)
    );

    if (!recruitRecord.interestByTeam) {
        recruitRecord.interestByTeam = {};
    }

    recruitRecord.interestByTeam[teamKey] = newInterest;

    const activity = {
        type: 'recruiting_action',
        year: Number(gameState.year),
        day: recruitingDay,
        teamId: team.id,
        teamName: team.name,
        coachId: String(coach.id),
        coachName: coach.name || 'Coach',
        playerId: player.id,
        playerName: player.name,
        action: actionType,
        label: profile.label,
        hours: assignedHours,
        interestBefore: currentInterest,
        interestGain: newInterest - currentInterest,
        interestAfter: newInterest
    };

    recruitRecord.history = Array.isArray(recruitRecord.history)
        ? recruitRecord.history
        : [];

    recruitRecord.history.push(activity);

    progress.dailyActivity = Array.isArray(progress.dailyActivity)
        ? progress.dailyActivity
        : [];

    progress.dailyActivity.push(activity);

    return {
        success: true,
        message:
            `${profile.label} increased ${player.name}'s interest ` +
            `by ${newInterest - currentInterest} points.`,
        interestBefore: currentInterest,
        interestGain: newInterest - currentInterest,
        interestAfter: newInterest,
        remainingHours: assignmentResult.remainingHours,
        activity
    };
}

/**
 * Uses a Favor Token or a cash-funded gift to improve a recruit's interest.
 *
 * Sweeteners do not consume staff hours. Each team can use one favor and
 * purchase up to three gifts for a recruit during a recruiting week.
 */
export function applyRecruitingSweetener(
    gameState,
    teamId,
    playerId,
    sweetenerType
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
        !Number.isInteger(recruitingDay) ||
        !Number.isInteger(recruitingDays) ||
        recruitingDay < 1 ||
        recruitingDay > recruitingDays ||
        Number(progress.seasonYear) !== Number(gameState.year) ||
        String(state.phase || '').toLowerCase().replace(/[^a-z]/g, '') !== 'recruiting'
    ) {
        return {
            success: false,
            message: 'The recruiting week is not active.'
        };
    }

    const team = gameState.teams.find(
        candidate => String(candidate?.id) === String(teamId)
    );

    const player = gameState.players.find(
        candidate => String(candidate?.id) === String(playerId)
    );

    const recruitKey = String(playerId);
    const teamKey = String(teamId);
    const record = progress.recruits?.[recruitKey];

    const age = Number(player?.age);

    const statusType = String(
        player?.status?.type || ''
    ).toLowerCase();

    const lifecycle = String(
        player?.lifecycle || ''
    ).toLowerCase();

    const lifecycleStatus = String(
        player?.lifecycleStatus || player?.lifecycle?.status || ''
    ).toLowerCase();

    const protectedDraftIds = new Set(
        (Array.isArray(gameState.draftClass) ? gameState.draftClass : [])
            .filter(prospect => prospect?.id != null)
            .map(prospect => String(prospect.id))
    );

    const hasRefusedTeam = (
        Array.isArray(player?.refusedTeamIds) &&
        player.refusedTeamIds.some(id => String(id) === teamKey)
    );

    if (
        !team ||
        team.leagueType !== 'main' ||
        !player ||
        player.teamId != null ||
        !record ||
        record.status !== 'available' ||
        record.committedTeamId != null ||
        hasRefusedTeam ||
        !Number.isFinite(age) ||
        age < 12 ||
        age > 18 ||
        protectedDraftIds.has(String(player.id)) ||
        lifecycle === 'draft_eligible' ||
        lifecycleStatus === 'draft_eligible' ||
        ['retired', 'departed', 'temporary', 'injured'].includes(statusType) ||
        ['retired', 'departed', 'temporary', 'injured'].includes(lifecycleStatus) ||
        Number(player.status?.duration) > 0 ||
        Number(player.injury?.duration || player.injuryDuration || 0) > 0
    ) {
        return {
            success: false,
            message: 'This recruit is no longer available.'
        };
    }

    const currentInterest = Math.max(
        0,
        Math.min(
            100,
            Number(record.interestByTeam?.[teamKey]) || 0
        )
    );

    if (currentInterest >= 100) {
        return {
            success: false,
            message: 'Your team has already maximized this recruit’s interest.'
        };
    }

    const history = Array.isArray(record.history)
        ? record.history
        : [];

    const teamSweeteners = history.filter(entry =>
        entry?.type === 'recruiting_sweetener' &&
        String(entry.teamId) === teamKey
    );

    let cost = 0;
    let baseGain = 0;
    let label = '';
    let category = '';
    let tokensSpent = 0;

    const gifts = {
        gift_small: {
            cost: 5,
            interest: 6,
            label: 'Small recruiting gift',
            category: 'recruitingGiftSmall'
        },
        gift_medium: {
            cost: 10,
            interest: 10,
            label: 'Generous recruiting gift',
            category: 'recruitingGiftMedium'
        },
        gift_large: {
            cost: 20,
            interest: 14,
            label: 'Premium recruiting gift',
            category: 'recruitingGiftLarge'
        }
    };

    if (sweetenerType === 'favor') {
        const alreadyUsedFavor = teamSweeteners.some(
            entry => entry.sweetenerType === 'favor'
        );

        const tokensAvailable = Math.max(
            0,
            Math.floor(
                Number(team.socialProfile?.favorTokens) || 0
            )
        );

        if (alreadyUsedFavor) {
            return {
                success: false,
                message: 'Your team has already called in a favor for this recruit.'
            };
        }

        if (tokensAvailable < 1) {
            return {
                success: false,
                message: 'Your team has no Favor Tokens available.'
            };
        }

        tokensSpent = 1;
        baseGain = 12;
        label = 'Called in a recruiting favor';
        category = 'recruitingFavor';

    } else {
        const gift = gifts[sweetenerType];

        if (!gift) {
            return {
                success: false,
                message: 'Invalid recruiting sweetener.'
            };
        }

        const giftsAlreadyPurchased = teamSweeteners.filter(
            entry => String(entry.sweetenerType).startsWith('gift_')
        ).length;

        if (giftsAlreadyPurchased >= 3) {
            return {
                success: false,
                message: 'You have reached the three-gift limit for this recruit.'
            };
        }

        cost = gift.cost;
        baseGain = gift.interest;
        label = gift.label;
        category = gift.category;
    }

    const finances = team.finances || {
        balance: 10,
        waivedDues: [],
        autoSnack: 'none'
    };

    const balance = Number(finances.balance);

    if (cost > 0 && (
        !Number.isFinite(balance) ||
        balance < cost
    )) {
        return {
            success: false,
            message:
                `Insufficient team funds. This gift costs $${cost.toFixed(2)}.`
        };
    }

    // Repeated gifts of the same size have diminishing returns.
    const sameGiftCount = teamSweeteners.filter(
        entry => entry.sweetenerType === sweetenerType
    ).length;

    let interestGain = baseGain *
        Math.pow(0.65, sameGiftCount);

    if (currentInterest >= 90) {
        interestGain *= 0.35;
    } else if (currentInterest >= 75) {
        interestGain *= 0.65;
    }

    interestGain = Math.max(1, Math.round(interestGain));

    const newInterest = Math.min(
        100,
        currentInterest + interestGain
    );

    // Validate everything before making any resource changes.
    if (cost > 0) {
        team.finances = finances;
        team.finances.balance = Math.round(
            (balance - cost) * 100
        ) / 100;
    }

    if (tokensSpent > 0) {
        team.socialProfile.favorTokens =
            Math.max(0, (
                Number(team.socialProfile.favorTokens) || 0
            ) - tokensSpent);
    }

    record.interestByTeam = record.interestByTeam || {};
    record.interestByTeam[teamKey] = newInterest;
    record.history = history;

    const activity = {
        type: 'recruiting_sweetener',
        year: Number(gameState.year),
        day: Number(state.recruitingDay),
        teamId: team.id,
        teamName: team.name,
        playerId: player.id,
        playerName: player.name,
        sweetenerType,
        label,
        cashSpent: cost,
        tokensSpent,
        interestBefore: currentInterest,
        interestGain: newInterest - currentInterest,
        interestAfter: newInterest
    };

    record.history.push(activity);

    progress.dailyActivity = Array.isArray(progress.dailyActivity)
        ? progress.dailyActivity
        : [];

    progress.dailyActivity.push(activity);

    if (cost > 0) {
        if (!Array.isArray(team.finances.ledger)) {
            team.finances.ledger = [];
        }

        const transactionKey =
            `${gameState.year}:recruiting:${recruitingDay}:` +
            `${teamKey}:${recruitKey}:${category}:` +
            `${progress.dailyActivity.length}`;

        team.finances.ledger.push({
            key: transactionKey,
            year: Number(gameState.year),
            week: Number(gameState.currentWeek) || 0,
            recruitingDay,
            category,
            label: `${label}: ${player.name}`,
            amount: -cost,
            balanceAfter: team.finances.balance
        });

        if (team.finances.ledger.length > 80) {
            team.finances.ledger.splice(
                0,
                team.finances.ledger.length - 80
            );
        }
    }

    return {
        success: true,
        message:
            `${label} increased ${player.name}'s interest by ` +
            `${newInterest - currentInterest} points.`,
        interestBefore: currentInterest,
        interestGain: newInterest - currentInterest,
        interestAfter: newInterest,
        cashSpent: cost,
        tokensSpent,
        activity
    };
}

/**
 * Runs one day of autonomous AI recruiting.
 *
 * AI teams use their available coaching hours to pursue free agents.
 * Target selection uses roster needs, relationships, current recruiting
 * interest, age, and scheme preferences—not hidden player ratings.
 */
export function processAiRecruitingDay(gameState) {
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
            actions: []
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
            actions: []
        };
    }

    const positionTargets = {
        QB: 2,
        RB: 2,
        WR: 3,
        TE: 1,
        OL: 3,
        DL: 2,
        LB: 2,
        DB: 3
    };

    const getPlayerPosition = (player, team) => {
        // Listed position is public information.
        const listedPosition = String(player?.pos || '').toUpperCase();

        if (positionTargets[listedPosition]) {
            return listedPosition;
        }

        // If the listed position is unavailable, use only this team's
        // scouting report—not the prospect's hidden position preferences.
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

        // A preliminary report is not sufficient to assign an alternative
        // position when the player's public listing is unavailable.
        // Require at least moderate scouting confidence.
        if (confidence < 0.50) return null;

        const fits = [
            report?.evaluation?.offenseFit,
            report?.evaluation?.defenseFit
        ]
            .filter(fit => {
                const fitPosition = String(
                    fit?.position || ''
                ).toUpperCase();

                return (
                    positionTargets[fitPosition] &&
                    fit.low != null &&
                    fit.high != null &&
                    Number.isFinite(Number(fit.low)) &&
                    Number.isFinite(Number(fit.high))
                );
            })
            .map(fit => {
                const lowEstimate = Number(fit.low);
                const highEstimate = Number(fit.high);

                const estimatedOvr = (
                    lowEstimate + highEstimate
                ) / 2;

                // Lower-confidence reports lean toward the lower end
                // of each positional estimate range.
                const selectionScore =
                    lowEstimate +
                    (estimatedOvr - lowEstimate) * confidence;

                return {
                    position: String(fit.position).toUpperCase(),
                    selectionScore
                };
            })
            .sort(
                (a, b) => b.selectionScore - a.selectionScore
            );

        return fits[0]?.position || null;
    };

    const draftClassIds = new Set(
        (Array.isArray(gameState.draftClass) ? gameState.draftClass : [])
            .filter(prospect => prospect?.id != null)
            .map(prospect => String(prospect.id))
    );

    const getRecruitEligibility = (player, record) => {
        if (
            !player ||
            player.id == null ||
            player.teamId != null ||
            record?.status !== 'available' ||
            record.committedTeamId != null
        ) {
            return false;
        }

        const statusType = String(
            player.status?.type || ''
        ).toLowerCase();

        const lifecycleStatus = String(
            player.lifecycleStatus || player.lifecycle?.status || ''
        ).toLowerCase();

        const lifecycle = String(
            player.lifecycle || ''
        ).toLowerCase();

        const age = Number(player.age);

        if (
            ['retired', 'departed', 'temporary', 'injured'].includes(statusType) ||
            ['retired', 'departed', 'temporary', 'injured'].includes(lifecycleStatus) ||
            lifecycle === 'draft_eligible' ||
            lifecycleStatus === 'draft_eligible' ||
            draftClassIds.has(String(player.id)) ||
            (Number(player.status?.duration) > 0) ||
            (Number(player.injury?.duration || player.injuryDuration || 0) > 0) ||
            !Number.isFinite(age) ||
            age < 12 ||
            age > 18
        ) {
            return false;
        }

        return true;
    };

    if (!progress.aiProcessedDays) {
        progress.aiProcessedDays = {};
    }

    const dayKey = String(day);

    // Do not let repeated calls generate additional AI recruiting actions
    // for a day that has already been processed.
    if (progress.aiProcessedDays[dayKey] === true) {
        return {
            success: true,
            day,
            totalDays,
            actions: [],
            alreadyProcessed: true
        };
    }

    const actions = [];
    const teams = gameState.teams.filter(team =>
        team &&
        team.leagueType === 'main' &&
        !team.isPlayerControlled
    );

    for (const team of teams) {
        const teamKey = String(team.id);
        const roster = getRosterObjects(team);

        if (!progress.teamDailyWork) {
            progress.teamDailyWork = {};
        }

        if (!progress.teamDailyWork[teamKey]) {
            progress.teamDailyWork[teamKey] = {};
        }

        const teamWork = progress.teamDailyWork[teamKey];
        const assignmentsForWeek = () =>
            Object.values(teamWork).flatMap(assignments =>
                Array.isArray(assignments) ? assignments : []
            );

        const staffBudgets = getRecruitingStaffHourBudget(team);
        const targetedToday = new Set();

        for (const staffBudget of staffBudgets) {
            const coach = ensureTeamCoachingStaff(team).find(
                candidate =>
                    String(candidate?.id) === String(staffBudget.coachId)
            );

            if (!coach || staffBudget.weeklyHours <= 0) continue;

            const assignments = assignmentsForWeek();

            const usedHours = assignments
                .filter(assignment =>
                    String(assignment.coachId) ===
                    String(staffBudget.coachId)
                )
                .reduce(
                    (total, assignment) =>
                        total + Math.max(
                            0,
                            Number(assignment.hours) || 0
                        ),
                    0
                );

            const remainingHours = Math.max(
                0,
                staffBudget.weeklyHours - usedHours
            );

            if (remainingHours <= 0) continue;

            // Spread each coach's weekly capacity across the recruiting
            // calendar. Unused earlier hours can be caught up later.
            const plannedHoursThroughToday = Math.round(
                staffBudget.weeklyHours * day / totalDays
            );

            const hoursToday = Math.min(
                remainingHours,
                Math.max(0, plannedHoursThroughToday - usedHours)
            );

            if (hoursToday <= 0) continue;

            const coachSkills = coach.ratings || {};
            const skillValue = key => {
                const value = Number(coachSkills[key]);

                return Number.isFinite(value)
                    ? Math.max(0, Math.min(100, value))
                    : 50;
            };

            const actionOptions = [
                {
                    type: 'outreach',
                    skills: ['teaching', 'evalCharacter']
                },
                {
                    type: 'teammateConnection',
                    skills: ['evalCharacter', 'teaching']
                },
                {
                    type: 'roleDiscussion',
                    skills: ['gameplanInstinct', 'teaching']
                },
                {
                    type: 'practiceInvitation',
                    skills: ['teaching', 'conditioning']
                }
            ];

            // Behavioral tendencies create preferences without making
            // any recruiting action exclusive to a particular personality.
            // Neutral values (50) produce no adjustment.
            const centeredTendency = key =>
                (getStaffBehaviorTendency(coach, key) - 50) / 10;

            const getRecruitingActionPreferenceBonus = actionType => {
                const relationship =
                    centeredTendency('relationshipOrientation');
                const discipline = centeredTendency('discipline');
                const adaptability = centeredTendency('adaptability');
                const patience = centeredTendency('patience');
                const development =
                    centeredTendency('developmentFocus');
                const riskTolerance =
                    centeredTendency('riskTolerance');

                switch (actionType) {
                    case 'outreach':
                        return (
                            relationship * 0.45 +
                            patience * 0.30 +
                            riskTolerance * 0.25
                        );

                    case 'teammateConnection':
                        return (
                            relationship * 0.75 +
                            patience * 0.25
                        );

                    case 'roleDiscussion':
                        return (
                            adaptability * 0.45 +
                            discipline * 0.30 +
                            patience * 0.25
                        );

                    case 'practiceInvitation':
                        return (
                            development * 0.65 +
                            relationship * 0.20 +
                            discipline * 0.15
                        );

                    default:
                        return 0;
                }
            };

            // Instinct, evaluation ability, and authority influence the
            // consistency of decisions—not access to hidden prospect data.
            const decisionQuality = (
                skillValue('gameplanInstinct') +
                skillValue('evalCharacter') +
                skillValue('authority')
            ) / 3;

            // Less decisive coaches are more susceptible to bad tactical
            // choices. Even excellent coaches retain some uncertainty.
            const decisionNoiseRange =
                2 + ((100 - decisionQuality) / 100) * 8;

            const rankedActions = actionOptions
                .map(option => {
                    const skillScore = option.skills.reduce(
                        (sum, skill) => sum + skillValue(skill),
                        0
                    ) / option.skills.length;

                    const preferenceBonus =
                        getRecruitingActionPreferenceBonus(option.type);

                    // Noise can cause a coach to choose a less-suited
                    // action, especially when decision quality is poor.
                    const judgmentNoise =
                        (Math.random() * 2 - 1) *
                        decisionNoiseRange;

                    return {
                        ...option,
                        score:
                            skillScore +
                            preferenceBonus +
                            judgmentNoise
                    };
                })
                .sort((a, b) => b.score - a.score);

            const selectedAction = rankedActions[0] || null;

            if (!selectedAction) continue;

            const evaluatedTargets = Object.entries(
                progress.recruits || {}
            ).map(([recruitKey, record]) => {
                const player = gameState.players.find(
                    candidate =>
                        String(candidate?.id) === String(recruitKey)
                );

                const hasRefusedThisTeam =
                    Array.isArray(player?.refusedTeamIds) &&
                    player.refusedTeamIds.some(
                        refusedTeamId =>
                            String(refusedTeamId) === teamKey
                    );

                if (
                    !getRecruitEligibility(player, record) ||
                    hasRefusedThisTeam ||
                    targetedToday.has(String(player.id))
                ) {
                    return null;
                }

                const position = getPlayerPosition(player, team);
                const peers = roster.filter(member => {
                    const positions = [
                        member?.pos,
                        member?.bestPosition,
                        member?.favoriteOffensivePosition,
                        member?.favoriteDefensivePosition
                    ];

                    return position && positions.includes(position);
                });

                const targetCount = positionTargets[position];

                // Unknown position means unknown roster need; don't
                // invent a positional shortage for an unscouted recruit.
                const rosterNeed = Number.isInteger(targetCount)
                    ? Math.max(0, targetCount - peers.length)
                    : 0;

                // Scheme fit uses this team's recruiting coach's profile.
                const tacticalId = getStaffProfileId(coach, 'tactical');
                let schemeBonus = 0;

                if (
                    tacticalId === 'spread_passing_specialist' &&
                    ['QB', 'WR', 'TE'].includes(position)
                ) {
                    schemeBonus = 5;
                } else if (
                    tacticalId === 'power_run_specialist' &&
                    ['RB', 'OL', 'TE'].includes(position)
                ) {
                    schemeBonus = 5;
                } else if (
                    tacticalId === 'pressure_oriented_defender' &&
                    ['DL', 'LB', 'DB'].includes(position)
                ) {
                    schemeBonus = 5;
                }

                const age = Number(player.age);

                const developmentFocus = getStaffBehaviorTendency(
                    coach,
                    'developmentFocus'
                );

                const recruitingPatience = getStaffBehaviorTendency(
                    coach,
                    'patience'
                );

                const agePreferenceWeight = Number.isFinite(age)
                    ? age <= 15
                        ? 1
                        : age >= 18
                            ? -1
                            : 0.25
                    : 0;

                const baselineAgeBonus = Number.isFinite(age)
                    ? age <= 15
                        ? 3
                        : age >= 18
                            ? -2
                            : 1
                    : 0;

                const ageBonus = Number.isFinite(age)
                    ? baselineAgeBonus +
                        (
                            ((developmentFocus - 50) / 50) * 3 +
                            ((recruitingPatience - 50) / 50) * 2
                        ) * agePreferenceWeight
                    : 0;

                const recruitId = String(player.id);

                // Social connections may only influence AI recruiting when
                // explicitly documented in this team's scouting report.
                const scoutingReport = getTeamScoutingReport(
                    team,
                    player.id
                );

                const networkEvidence = scoutingReport?.networkEvidence;

                const knownFriendIds = Array.isArray(
                    networkEvidence?.knownTeammateFriendIds
                )
                    ? networkEvidence.knownTeammateFriendIds.map(String)
                    : [];

                const knownRivalIds = Array.isArray(
                    networkEvidence?.knownTeammateRivalIds
                )
                    ? networkEvidence.knownTeammateRivalIds.map(String)
                    : [];

                const rosterIds = new Set(
                    roster
                        .filter(member => member?.id != null)
                        .map(member => String(member.id))
                );

                const knownFriendCount = knownFriendIds.filter(
                    id => rosterIds.has(id)
                ).length;

                const hasKnownFriend = knownFriendCount > 0;

                const hasKnownRival = knownRivalIds.some(
                    id => rosterIds.has(id)
                );

                const ownInterest = Math.max(
                    0,
                    Math.min(
                        100,
                        Number(record.interestByTeam?.[teamKey]) || 0
                    )
                );

                // Don't waste an attempt on a recruit whose interest is
                // already maxed out for this team.
                if (ownInterest >= 100) {
                    return null;
                }

                // Rival interest values are hidden information. Estimate
                // competition from recruiting activity observed on previous
                // days instead of reading other teams' exact interest scores.
                const observedRivalActivity = (
                    Array.isArray(progress.dailyActivity)
                        ? progress.dailyActivity
                        : []
                ).filter(activity =>
                    String(activity?.playerId) === recruitId &&
                    activity?.teamId != null &&
                    String(activity.teamId) !== teamKey &&
                    Number(activity.day) < day &&
                    [
                        'recruiting_action',
                        'recruiting_sweetener'
                    ].includes(activity.type)
                );

                const observedRivalTeams = new Set(
                    observedRivalActivity.map(activity =>
                        String(activity.teamId)
                    )
                );

                const rivalTeamCount = observedRivalTeams.size;

                const rivalEffort = observedRivalActivity.reduce(
                    (total, activity) => {
                        if (activity.type === 'recruiting_sweetener') {
                            return total + 1.5;
                        }

                        const hours = Math.max(
                            1,
                            Number(activity.hours) || 1
                        );

                        return total + Math.min(2.5, hours / 2);
                    },
                    0
                );

                const observedCompetitionPressure = Math.min(
                    8,
                    rivalTeamCount * 2 +
                        Math.max(0, rivalEffort - rivalTeamCount) * 0.75
                );

                // Coaches interpret visible recruiting competition through
                // their individual behavioral tendencies, not rigid personality
                // labels. Rival effort is inferred only from observed activity.
                const riskTolerance = getStaffBehaviorTendency(
                    coach,
                    'riskTolerance'
                );

                const patience = getStaffBehaviorTendency(
                    coach,
                    'patience'
                );

                const discipline = getStaffBehaviorTendency(
                    coach,
                    'discipline'
                );

                let competitionAdjustment = 0;

                if (rivalTeamCount > 0) {
                    const riskResponse =
                        ((riskTolerance - 50) / 50) * 6;

                    const impatienceResponse =
                        ((50 - patience) / 50) * 2;

                    const disciplineResponse =
                        ((50 - discipline) / 50) * 1;

                    const pressureFactor = Math.min(
                        1,
                        observedCompetitionPressure / 6
                    );

                    competitionAdjustment = Math.max(
                        -7,
                        Math.min(
                            7,
                            riskResponse +
                            impatienceResponse +
                            disciplineResponse
                        )
                    ) * pressureFactor;
                }

                // Use this team's estimated prospect fits, if available.
                // No report means the AI does not know the player's true OVR.
                const reportedFits = [
                    scoutingReport?.evaluation?.offenseFit,
                    scoutingReport?.evaluation?.defenseFit
                ].filter(fit => {
                    const fitPosition = String(
                        fit?.position || ''
                    ).toUpperCase();

                    return (
                        positionTargets[fitPosition] &&
                        fit.low != null &&
                        fit.high != null &&
                        String(fit.low).trim() !== '' &&
                        String(fit.high).trim() !== '' &&
                        Number.isFinite(Number(fit.low)) &&
                        Number.isFinite(Number(fit.high))
                    );
                });

                // Only evaluate the prospect using the fit corresponding
                // to the position this team is considering recruiting.
                const relevantFit = reportedFits.find(
                    fit =>
                        String(fit.position).toUpperCase() === position
                );

                const perceivedFit = relevantFit
                    ? (
                        Number(relevantFit.low) +
                        Number(relevantFit.high)
                    ) / 2
                    : null;

                const rawConfidence = Number(
                    scoutingReport?.confidence
                );

                // Support older reports that may store confidence as 0–100.
                const reportConfidence = Number.isFinite(rawConfidence)
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

                const scoutingAdjustment = perceivedFit === null
                    ? 0
                    : Math.max(
                        -5,
                        Math.min(5, (perceivedFit - 60) * 0.25)
                    ) * reportConfidence;

                // Individual scouting philosophies influence which
                // prospects the recruiting staff finds attractive.
                // These preferences only use the team's recorded estimates.
                const scoutingId = getStaffProfileId(
                    coach,
                    'scouting'
                );

                let scoutingPreferenceAdjustment = 0;

                if (reportConfidence > 0) {
                    if (
                        scoutingId === 'athletic_bias_evaluator'
                    ) {
                        const speedRange =
                            scoutingReport?.attributeRanges
                                ?.physical?.speed;

                        if (
                            speedRange?.low != null &&
                            speedRange?.high != null &&
                            Number.isFinite(Number(speedRange.low)) &&
                            Number.isFinite(Number(speedRange.high))
                        ) {
                            const estimatedSpeed = (
                                Number(speedRange.low) +
                                Number(speedRange.high)
                            ) / 2;

                            scoutingPreferenceAdjustment = Math.max(
                                -4,
                                Math.min(
                                    4,
                                    (estimatedSpeed - 60) * 0.15
                                )
                            ) * reportConfidence;
                        }
                    } else if (
                        scoutingId === 'technique_first_evaluator'
                    ) {
                        const technicalRanges = Object.values(
                            scoutingReport?.attributeRanges?.technical || {}
                        );

                        const technicalEstimates = technicalRanges
                            .filter(range =>
                                range?.low != null &&
                                range?.high != null &&
                                Number.isFinite(Number(range.low)) &&
                                Number.isFinite(Number(range.high))
                            )
                            .map(range =>
                                (
                                    Number(range.low) +
                                    Number(range.high)
                                ) / 2
                            );

                        if (technicalEstimates.length > 0) {
                            const estimatedTechnique =
                                technicalEstimates.reduce(
                                    (total, value) => total + value,
                                    0
                                ) / technicalEstimates.length;

                            scoutingPreferenceAdjustment = Math.max(
                                -3,
                                Math.min(
                                    3,
                                    (estimatedTechnique - 60) * 0.10
                                )
                            ) * reportConfidence;
                        }
                    } else if (
                        scoutingId === 'character_focused_evaluator'
                    ) {
                        const characterSummary = String(
                            scoutingReport?.evaluation?.characterSummary || ''
                        ).toLowerCase();

                        if (
                            characterSummary.includes(
                                'strong effort/reliability signals'
                            )
                        ) {
                            scoutingPreferenceAdjustment =
                                3 * reportConfidence;
                        } else if (
                            characterSummary.includes(
                                'effort/reliability need closer review'
                            )
                        ) {
                            scoutingPreferenceAdjustment =
                                -3 * reportConfidence;
                        }
                    }
                }

                // Prospect evaluation depends on actual scouting ability,
                // not tactical instinct or organizational authority.
                const targetEvaluationQuality = (
                    skillValue('evalPhysicals') +
                    skillValue('evalTechnique') +
                    skillValue('evalCharacter')
                ) / 3;

                // Strong evaluators are more consistent, but never infallible.
                const targetJudgmentNoiseRange =
                    0.5 +
                    ((100 - targetEvaluationQuality) / 100) * 3;

                const targetJudgmentNoise =
                    (Math.random() * 2 - 1) *
                    targetJudgmentNoiseRange;

                const score =
                    rosterNeed * 7 +
                    (hasKnownFriend ? 16 : 0) +
                    Math.min(
                        8,
                        Math.max(0, knownFriendCount - 1) * 3
                    ) +
                    (hasKnownRival ? -25 : 0) +
                    schemeBonus +
                    ageBonus +
                    ownInterest * 0.20 +
                    scoutingAdjustment +
                    scoutingPreferenceAdjustment +
                    competitionAdjustment +
                    targetJudgmentNoise;

                return {
                    player,
                    score,
                    ownInterest,
                    rosterNeed
                };
            })
                .filter(Boolean)
                .sort((a, b) => b.score - a.score);

            if (evaluatedTargets.length === 0) continue;

            const target = evaluatedTargets[0];

            const result = executeRecruitingAction(
                gameState,
                team.id,
                coach.id,
                target.player.id,
                selectedAction.type,
                hoursToday
            );

            if (!result.success) continue;

            targetedToday.add(String(target.player.id));

            actions.push({
                teamId: team.id,
                teamName: team.name,
                coachId: coach.id,
                coachName: coach.name || 'Coach',
                playerId: target.player.id,
                playerName: target.player.name,
                action: selectedAction.type,
                hours: hoursToday,
                interestGain: result.interestGain,
                interestAfter: result.interestAfter
            });
        }
    }

    progress.aiProcessedDays[dayKey] = true;

    return {
        success: true,
        day,
        totalDays,
        actions
    };
}

function getAiStaffTaskScore(coach, task) {
    const ratings = coach?.ratings || {};
    const rating = key => {
        const value = Number(ratings[key]);
        return Number.isFinite(value) ? value : 50;
    };

    let score;

    if (task === 'scouting') {
        score = (
            rating('evalPhysicals') +
            rating('evalTechnique') +
            rating('evalCharacter')
        ) / 3;
    } else if (task === 'offensePrep') {
        score = (
            rating('offSchemeMastery') +
            rating('gameplanInstinct') +
            rating('inGameAdjustments')
        ) / 3;
    } else if (task === 'defensePrep') {
        score = (
            rating('defSchemeMastery') +
            rating('gameplanInstinct') +
            rating('inGameAdjustments')
        ) / 3;
    } else {
        score = (
            rating('teaching') +
            rating('practiceDiscipline') +
            rating('conditioning')
        ) / 3;
    }

    // Individual tendencies shape task preferences without replacing
    // the competence represented by the skill ratings above.
    const centeredTendency = key =>
        (getStaffBehaviorTendency(coach, key) - 50) / 10;

    const adaptability = centeredTendency('adaptability');
    const riskTolerance = centeredTendency('riskTolerance');
    const relationshipOrientation =
        centeredTendency('relationshipOrientation');
    const discipline = centeredTendency('discipline');
    const patience = centeredTendency('patience');
    const developmentFocus = centeredTendency('developmentFocus');

    let behavioralAdjustment = 0;

    if (task === 'scouting') {
        behavioralAdjustment =
            adaptability * 0.40 +
            patience * 0.35 +
            developmentFocus * 0.20 -
            relationshipOrientation * 0.20;
    } else if (task === 'offensePrep' || task === 'defensePrep') {
        behavioralAdjustment =
            adaptability * 0.45 +
            discipline * 0.30 +
            riskTolerance * 0.15;
    } else if (task === 'training') {
        behavioralAdjustment =
            developmentFocus * 0.45 +
            discipline * 0.35 +
            relationshipOrientation * 0.25 +
            patience * 0.15;
    }

    // Personality should influence allocation, not overwhelm competence.
    score += Math.max(
        -5,
        Math.min(5, behavioralAdjustment)
    );

    return score;
}

function getAiGmDelegationAdjustment(gm, task) {
    const getBehaviorDelegationAdjustment = (staff, task) => {
        const centeredTendency = key =>
            (getStaffBehaviorTendency(staff, key) - 50) / 10;

        const adaptability = centeredTendency('adaptability');
        const riskTolerance = centeredTendency('riskTolerance');
        const relationshipOrientation =
            centeredTendency('relationshipOrientation');
        const discipline = centeredTendency('discipline');
        const patience = centeredTendency('patience');
        const developmentFocus = centeredTendency('developmentFocus');

        if (task === 'scouting') {
            return (
                adaptability * 0.45 +
                patience * 0.35 +
                developmentFocus * 0.15 -
                relationshipOrientation * 0.55
            );
        }

        if (task === 'offensePrep') {
            return (
                adaptability * 0.45 +
                discipline * 0.25 +
                riskTolerance * 0.20 -
                relationshipOrientation * 0.35
            );
        }

        if (task === 'defensePrep') {
            return (
                adaptability * 0.40 +
                discipline * 0.35 +
                riskTolerance * 0.15 -
                relationshipOrientation * 0.35
            );
        }

        return 0;
    };

    const archetypePreferences = {
        film_room_rat: {
            scouting: 6,
            offensePrep: 0,
            defensePrep: 0
        },
        neighborhood_builder: {
            scouting: -2,
            offensePrep: -4,
            defensePrep: -4
        },
        deal_maker: {
            scouting: 4,
            offensePrep: 0,
            defensePrep: 0
        },
        culture_keeper: {
            scouting: -4,
            offensePrep: -2,
            defensePrep: -2
        },
        tactical_innovator: {
            scouting: -2,
            offensePrep: 4,
            defensePrep: 4
        },
        win_now_gambler: {
            scouting: -4,
            offensePrep: 6,
            defensePrep: 6
        }
    };

    const archetypeId = gm?.managementArchetypeId;

    const personalityAdjustment =
        getBehaviorDelegationAdjustment(gm, task);

    const archetypeAdjustment =
        archetypePreferences[archetypeId]?.[task] || 0;

    // Personality and archetype both influence delegation, but their
    // combined effect remains bounded.
    const combinedAdjustment = Math.max(
        -8,
        Math.min(
            8,
            personalityAdjustment + archetypeAdjustment
        )
    );

    const authority = Number(gm?.ratings?.authority);

    const normalizedAuthority = Number.isFinite(authority)
        ? Math.max(0, Math.min(1, (authority - 40) / 40))
        : 0.5;

    const influence = 0.5 + normalizedAuthority * 0.5;

    return Math.round(combinedAdjustment * influence);
}

function getAiTrainingFocus(team) {
    const roster = getRosterObjects(team);

    const offensePositions = new Set(['QB', 'RB', 'WR', 'TE', 'OL']);
    const defensePositions = new Set(['DL', 'LB', 'DB']);

    let offenseTotal = 0;
    let offenseCount = 0;
    let defenseTotal = 0;
    let defenseCount = 0;

    for (const player of roster) {
        if (player?.id == null) continue;

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

        // Coaches need at least moderate scouting evidence to use
        // positional estimates when setting development priorities.
        if (confidence < 0.50) continue;

        const fits = [
            report?.evaluation?.offenseFit,
            report?.evaluation?.defenseFit
        ];

        for (const fit of fits) {
            const position = String(
                fit?.position || ''
            ).toUpperCase();

            const low = Number(fit?.low);
            const high = Number(fit?.high);

            if (
                fit?.low == null ||
                fit?.high == null ||
                !Number.isFinite(low) ||
                !Number.isFinite(high) ||
                high < low
            ) {
                continue;
            }

            // Use a conservative estimate within the reported range.
            // Lower scouting confidence keeps the estimate closer to
            // the bottom of that range.
            const estimate =
                low + ((high - low) / 2) * confidence;

            if (offensePositions.has(position)) {
                offenseTotal += estimate;
                offenseCount++;
            } else if (defensePositions.has(position)) {
                defenseTotal += estimate;
                defenseCount++;
            }
        }
    }

    // When scouting evidence is incomplete, fall back to public roster
    // composition rather than inspecting actual player ratings.
    if (offenseCount === 0 || defenseCount === 0) {
        const offenseRosterCount = roster.filter(player =>
            offensePositions.has(
                String(player?.pos || '').toUpperCase()
            )
        ).length;

        const defenseRosterCount = roster.filter(player =>
            defensePositions.has(
                String(player?.pos || '').toUpperCase()
            )
        ).length;

        if (offenseCount === 0 && defenseCount === 0) {
            if (offenseRosterCount === 0) return 'defense';
            if (defenseRosterCount === 0) return 'offense';

            return offenseRosterCount <= defenseRosterCount
                ? 'offense'
                : 'defense';
        }

        if (offenseCount === 0) return 'offense';
        if (defenseCount === 0) return 'defense';
    }

    const offenseScore =
        offenseTotal / offenseCount;

    const defenseScore =
        defenseTotal / defenseCount;

    return offenseScore <= defenseScore
        ? 'offense'
        : 'defense';
}

/**
 * Builds the AI team's weekly workload.
 *
 * Each NPC coach receives 40 hours:
 * - 16 hours in their strongest specialty
 * - 24 hours in player development
 *
 * The plan is generated once per team, year, and week.
 * Player-controlled teams retain their own configured assignments.
 */
export function ensureAiStaffWorkPlan(
    team,
    gameState,
    year = gameState?.year,
    week = gameState?.currentWeek
) {
    if (
        !team ||
        team.isPlayerControlled ||
        !Number.isInteger(year) ||
        !Number.isInteger(week)
    ) {
        return null;
    }

    const weekKey = `${year}:${week}`;

    if (
        team.aiStaffWorkPlanKey === weekKey &&
        Array.isArray(team.staffWorkPlan?.assignments)
    ) {
        return team.staffWorkPlan;
    }

    const coaches = ensureTeamCoachingStaff(team)
        .filter(coach => coach?.id && !coach.isUserCoach)
        .slice(0, 3);

    if (coaches.length === 0) return null;

    const gm = team.aiGmProfile || team.staff?.gm || null;

    const gmDirective =
        gm?.strategicDirective ||
        team.gameplan?.gmDirective ||
        'COACH_AUTONOMY';
    const isOffseason = week === 0;
    const hasDraftClass =
        Array.isArray(gameState?.draftClass) &&
        gameState.draftClass.length > 0;

    // During the regular season, AI scouts track Pee Wee prospects.
    // Offseason scouting continues to focus on the incoming draft class,
    // or free agents when there is no eligible draft class.
    const scoutingFocus = isOffseason
        ? (hasDraftClass ? 'draft' : 'freeAgents')
        : 'youth';

    const specialties = [
        {
            task: 'scouting',
            trainingFocus: getAiTrainingFocus(team),
            scoutingFocus
        },
        {
            task: 'offensePrep',
            trainingFocus: 'offense'
        },
        {
            task: 'defensePrep',
            trainingFocus: 'defense'
        }
    ];

    const availableCoaches = [...coaches];
    const assignments = [];

    for (const specialty of specialties) {
        if (availableCoaches.length === 0) break;

        availableCoaches.sort(
            (a, b) =>
                getAiStaffTaskScore(b, specialty.task) -
                getAiStaffTaskScore(a, specialty.task)
        );

        const coach = availableCoaches.shift();

        let specialtyHours = 16;

        if (isOffseason) {
            // Use the offseason for prospect evaluation and development,
            // rather than preparing for a game that may not be scheduled.
            specialtyHours = specialty.task === 'scouting'
                ? (gmDirective === 'DEVELOP_YOUTH' ? 28 : 24)
                : 0;
        } else if (gmDirective === 'WIN_NOW') {
            // Prioritize immediate performance and weekly preparation.
            specialtyHours = specialty.task === 'scouting'
                ? 8
                : 24;
        } else if (gmDirective === 'DEVELOP_YOUTH') {
            // Invest more time in evaluating and developing players.
            specialtyHours = specialty.task === 'scouting'
                ? 24
                : 8;
        } else if (gmDirective === 'HARD_CONDITIONING') {
            // Reduce game-preparation time in favor of broad player work.
            specialtyHours = 8;
        }

        // The GM sets the strategic emphasis for delegated work.
        // Do not revive game-preparation assignments in the offseason.
        if (specialtyHours > 0) {
            specialtyHours += getAiGmDelegationAdjustment(
                gm,
                specialty.task
            );

            specialtyHours = Math.max(
                0,
                Math.min(WEEKLY_COACH_HOURS, specialtyHours)
            );
        }

        // Individual behavioral tendencies influence the balance between
        // specialist work and player development. Offseason allocations
        // remain governed by the offseason workload rules above.
        if (!isOffseason && specialtyHours > 0) {
            const centeredTendency = tendencyKey => (
                getStaffBehaviorTendency(coach, tendencyKey) - 50
            ) / 50;

            let specialistPreference = 0;

            if (specialty.task === 'scouting') {
                specialistPreference =
                    centeredTendency('adaptability') * 0.40 +
                    centeredTendency('patience') * 0.30 -
                    centeredTendency('relationshipOrientation') * 0.15 -
                    centeredTendency('developmentFocus') * 0.25;
            } else {
                specialistPreference =
                    centeredTendency('adaptability') * 0.35 +
                    centeredTendency('discipline') * 0.25 +
                    centeredTendency('riskTolerance') * 0.20 -
                    centeredTendency('relationshipOrientation') * 0.15 -
                    centeredTendency('developmentFocus') * 0.25;
            }

            // Keep the personality-driven allocation adjustment modest.
            const boundedPreference = Math.max(
                -1,
                Math.min(1, specialistPreference)
            );

            specialtyHours += Math.round(
                boundedPreference * 4
            );

            specialtyHours = Math.max(
                0,
                Math.min(WEEKLY_COACH_HOURS, specialtyHours)
            );
        }

        const trainingHours =
            WEEKLY_COACH_HOURS - specialtyHours;

        if (specialtyHours > 0) {
            assignments.push({
                coachId: coach.id,
                task: specialty.task,
                hours: specialtyHours,
                ...(specialty.task === 'scouting'
                    ? {
                        focus: specialty.scoutingFocus,
                        maxTargets: isOffseason
                            ? 4
                            : gmDirective === 'DEVELOP_YOUTH'
                                ? 6
                                : 3
                    }
                    : {})
            });
        }

        if (trainingHours > 0) {
            assignments.push({
                coachId: coach.id,
                task: 'training',
                hours: trainingHours,
                focus: gmDirective === 'HARD_CONDITIONING'
                    ? 'all'
                    : specialty.trainingFocus,
                maxTargets: 6
            });
        }
    }

    team.staffWorkPlan = {
        version: 1,
        weeklyHoursPerCoach: WEEKLY_COACH_HOURS,
        assignments
    };

    team.aiStaffWorkPlanKey = weekKey;

    return team.staffWorkPlan;
}

export function generateStaffPool(count = 8) {
    const pool = [];

    for (let i = 0; i < count; i++) {
        pool.push(generateStaffMember('coach'));
    }

    return pool;
}

export function checkRetiredPlayerToCoach(player) {
    if (!player || player.age < 19) return null;
    const iq = player.attributes?.mental?.playbookIQ || 50;
    const isCandidate = iq >= 70 || player.potential === 'A' || Math.random() < 0.12;

    if (isCandidate) {
        return generateStaffMember('coach', 19, 19, player);
    }
    return null;
}

/**
 * Autonomous AI Front Office management: fires underperforming coaches,
 * poaches winning assistants, and hires available candidates/retired players.
 */
/**
 * Legacy compatibility hook.
 *
 * AI staff decisions now belong to the offseason Coach Carousel rather
 * than automatic firing and replacement during season rollover.
 *
 * Voluntary departures remain the responsibility of
 * processCoachOffseasonRetention(). AI retention, hiring, and poaching
 * decisions will be resolved during the staff-review phase.
 */
export function aiManageTeamStaff(team, gameState) {
    if (!team || team.isPlayerControlled) return;

    // Intentionally do not automatically fire or hire coaches here.
    // The Coach Carousel will own AI staffing decisions.
}


/**
 * Rates a coach's suitability for a specific responsibility.
 * Returns a normalized 0-100 score based on the existing ratings schema.
 */
export function calculateCoachRoleFit(coach, role) {
    if (!coach) return 50;

    const ratings = coach.ratings || {};

    const rating = key => {
        const value = Number(ratings[key]);

        return Number.isFinite(value)
            ? Math.max(0, Math.min(100, value))
            : 50;
    };

    const roleSkills = {
        scouting: [
            ['evalPhysicals', 1],
            ['evalTechnique', 1],
            ['evalCharacter', 1]
        ],
        training: [
            ['teaching', 2],
            ['practiceDiscipline', 1],
            ['conditioning', 1]
        ],
        offensePrep: [
            ['offSchemeMastery', 2],
            ['gameplanInstinct', 1],
            ['inGameAdjustments', 1]
        ],
        defensePrep: [
            ['defSchemeMastery', 2],
            ['gameplanInstinct', 1],
            ['inGameAdjustments', 1]
        ],
        general: [
            ['gameplanInstinct', 1],
            ['inGameAdjustments', 1],
            ['teaching', 1]
        ]
    };

    const skills = roleSkills[role] || roleSkills.general;

    let weightedTotal = 0;
    let totalWeight = 0;

    for (const [skill, weight] of skills) {
        weightedTotal += rating(skill) * weight;
        totalWeight += weight;
    }

    return totalWeight > 0
        ? Math.round(weightedTotal / totalWeight)
        : 50;
}

/**
 * Resolves AI coaching vacancies through a shared offseason market.
 *
 * Each candidate can be signed by only one team. Teams evaluate candidates
 * using staff skills, scheme fit, GM priorities, league tier, and affordability.
 * Player-controlled teams retain their vacancies for user-directed hiring.
 */
export function resolveCoachCarousel(
    gameState,
    resolvedYear = gameState?.year
) {
    if (
        !gameState ||
        !Array.isArray(gameState.teams) ||
        !Number.isInteger(Number(resolvedYear))
    ) {
        return {
            resolved: false,
            hires: [],
            vacanciesRemaining: 0
        };
    }

    const year = Number(resolvedYear);

    // Prevent the same offseason carousel from resolving twice.
    if (Number(gameState.coachCarouselResolvedYear) === year) {
        return {
            resolved: false,
            alreadyResolved: true,
            hires: [],
            vacanciesRemaining: 0
        };
    }

    if (!Array.isArray(gameState.availableStaff)) {
        gameState.availableStaff = [];
    }

    const getNpcCoaches = team =>
        (Array.isArray(team?.coaches) ? team.coaches : [])
            .filter(coach => coach?.id != null && !coach.isUserCoach);

    const getVacancies = team => {
        const activeNpcCoaches = getNpcCoaches(team);

        return Math.max(
            0,
            Math.min(3, 3 - activeNpcCoaches.length)
        );
    };

    const teams = gameState.teams
        .filter(team =>
            team &&
            team.leagueType === 'main' &&
            !team.isPlayerControlled &&
            getVacancies(team) > 0
        )
        // Prioritize teams with the greatest need, then Tier 1 teams.
        .sort((a, b) =>
            getVacancies(b) - getVacancies(a) ||
            (Number(a.tier) || 2) - (Number(b.tier) || 2)
        );

    const hires = [];

    // Treat team rosters as the source of truth for current employment.
    // This prevents stale teamId values from making an employed coach
    // appear available in the shared market.
    const employedCoachIds = new Set(
        gameState.teams.flatMap(team =>
            (Array.isArray(team?.coaches) ? team.coaches : [])
                .filter(coach =>
                    coach?.id != null &&
                    !coach.isUserCoach
                )
                .map(coach => String(coach.id))
        )
    );

    const rating = (coach, key) => {
        const value = Number(coach?.ratings?.[key]);

        return Number.isFinite(value)
            ? Math.max(0, Math.min(100, value))
            : 50;
    };

    const getCandidateEvaluation = (team, candidate) => {
        const rep = Math.round(
            (
                rating(candidate, 'offSchemeMastery') +
                rating(candidate, 'defSchemeMastery') +
                rating(candidate, 'teaching')
            ) / 3
        );

        const weeksUnemployed = Math.max(
            0,
            Number(candidate.weeksUnemployed) || 0
        );

        const stubbornness = Math.max(
            0.1,
            Math.min(1, Number(candidate.stubbornness) || 0.75)
        );

        const demandDecay = Math.pow(
            stubbornness,
            weeksUnemployed
        );

        const requiredStipend = Math.max(
            0,
            Math.round(Math.max(0, (rep - 52) * 0.50) * demandDecay)
        );

        const requiredTokens =
            rep >= 75 && weeksUnemployed < 3 ? 1 : 0;

        const teamBalanceValue = Number(team.finances?.balance);
        const teamBalance = Number.isFinite(teamBalanceValue)
            ? Math.max(0, teamBalanceValue)
            : 5;

        const teamTokensValue = Number(team.socialProfile?.favorTokens);
        const teamTokens = Number.isFinite(teamTokensValue)
            ? Math.max(0, teamTokensValue)
            : 0;

        const canAfford =
            teamBalance >= requiredStipend &&
            teamTokens >= requiredTokens;

        const roleFit = [
            calculateCoachRoleFit(candidate, 'scouting'),
            calculateCoachRoleFit(candidate, 'training'),
            calculateCoachRoleFit(candidate, 'offensePrep'),
            calculateCoachRoleFit(candidate, 'defensePrep')
        ].reduce((sum, value) => sum + value, 0) / 4;

        let fitScore = rep * 0.45 + roleFit * 0.55;

        const tacticalId = getStaffProfileId(candidate, 'tactical');
        const disciplineTendency = getStaffBehaviorTendency(
            candidate,
            'discipline'
        );
        const offense = team.formations?.offense || '';

        if (
            ['Spread', 'Empty', 'Trips', 'TripsLeft'].includes(offense) &&
            tacticalId === 'spread_passing_specialist'
        ) {
            fitScore += 8;
        }

        if (
            ['Power', 'Jumbo', 'Pistol'].includes(offense) &&
            tacticalId === 'power_run_specialist'
        ) {
            fitScore += 8;
        }

        const directive =
            team.aiGmProfile?.strategicDirective ||
            team.gameplan?.gmDirective ||
            'COACH_AUTONOMY';

        if (
            directive === 'WIN_NOW' &&
            rating(candidate, 'inGameAdjustments') >= 65
        ) {
            fitScore += 8;
        }

        if (
            directive === 'DEVELOP_YOUTH' &&
            rating(candidate, 'teaching') >= 65
        ) {
            fitScore += 10;
        }

        if (
            directive === 'HARD_CONDITIONING' &&
            disciplineTendency >= 70
        ) {
            fitScore += 8;
        }

        if (Number(team.tier) === 1 && rep >= 68) {
            fitScore += 5;
        }

        if (
            Number(team.tier) === 2 &&
            rating(candidate, 'teaching') >= 60
        ) {
            fitScore += 5;
        }

        // Unemployed coaches with declining demands can become bargains.
        if (demandDecay < 0.70 && rep > 68) {
            fitScore += 6;
        }

        const practiceStyle = String(
            team.gameplan?.weeklyPractice || ''
        ).toLowerCase();

        const practiceFocus =
            practiceStyle === 'conditioning'
                ? 'CONDITIONING'
                : ['chalk_talk', 'scouting'].includes(practiceStyle)
                    ? 'CHALK_TALK'
                    : practiceStyle === 'scrimmage'
                        ? 'FUN_SCRIMMAGE'
                        : 'BALANCED';

        const pitch = {
            cashOffered: requiredStipend,
            tokensOffered: requiredTokens,
            schemePromise: directive === 'COACH_AUTONOMY'
                ? 'COACH_CHOICE'
                : 'GM_CHOICE',
            practiceFocus
        };

        const negotiation = evaluateStaffNegotiation(
            candidate,
            team,
            'coach',
            pitch
        );

        // Preserve skill and role fit as the primary ranking criteria,
        // while allowing acceptance likelihood to influence close calls.
        const negotiationScore = Number(negotiation.interestScore);

        const combinedFitScore =
            fitScore * 0.80 +
            (
                Number.isFinite(negotiationScore)
                    ? negotiationScore
                    : 0
            ) * 0.20;

        return {
            candidate,
            canAfford,
            negotiationAccepted: negotiation.accepted,
            negotiation,
            pitch,
            requiredStipend,
            requiredTokens,
            fitScore: combinedFitScore
        };
    };

    for (const team of teams) {
        let vacancies = getVacancies(team);

        if (!Array.isArray(team.coaches)) {
            team.coaches = [];
        }

        if (!team.staff || typeof team.staff !== 'object') {
            team.staff = {};
        }

        while (vacancies > 0) {
            // Consider each available coach once, and never poach a coach
            // who is still assigned to another team.
            const seenCandidateIds = new Set();

            const candidates = gameState.availableStaff
                .filter(candidate =>
                    candidate?.id != null &&
                    candidate.teamId == null &&
                    !employedCoachIds.has(String(candidate.id)) &&
                    (
                        candidate.role === 'coach' ||
                        candidate.formerPlayerBio
                    ) &&
                    !seenCandidateIds.has(String(candidate.id)) &&
                    seenCandidateIds.add(String(candidate.id))
                )
                .map(candidate =>
                    getCandidateEvaluation(team, candidate)
                )
                .filter(result =>
                    result.canAfford &&
                    result.negotiationAccepted
                )
                .sort((a, b) => b.fitScore - a.fitScore);

            // Do not manufacture a replacement when the shared market
            // has no affordable candidate. Preserve the vacancy instead.
            if (candidates.length === 0) {
                break;
            }

            const chosen = candidates[0];
            const newHire = chosen.candidate;

            // Remove by ID to prevent duplicate market records from
            // allowing the same coach to be signed more than once.
            gameState.availableStaff =
                gameState.availableStaff.filter(candidate =>
                    String(candidate?.id) !== String(newHire.id)
                );

            if (team.finances) {
                team.finances.balance = Math.max(
                    0,
                    (Number(team.finances.balance) || 0) -
                    chosen.requiredStipend
                );
            }

            if (chosen.requiredTokens > 0 && team.socialProfile) {
                team.socialProfile.favorTokens = Math.max(
                    0,
                    (Number(team.socialProfile.favorTokens) || 0) -
                    chosen.requiredTokens
                );
            }

            newHire.teamId = team.id;
            newHire.role = 'coach';
            newHire.weeksUnemployed = 0;

            ensureCoachDevelopmentProfile(newHire);

            if (
                !team.coaches.some(coach =>
                    String(coach?.id) === String(newHire.id)
                )
            ) {
                team.coaches.push(newHire);
            }

            employedCoachIds.add(String(newHire.id));

            vacancies -= 1;
            team.coachingVacancies = vacancies;

            hires.push({
                teamId: team.id,
                teamName: team.name,
                coachId: newHire.id,
                coachName: newHire.name,
                overallFit: Math.round(
                    [
                        calculateCoachRoleFit(newHire, 'scouting'),
                        calculateCoachRoleFit(newHire, 'training'),
                        calculateCoachRoleFit(newHire, 'offensePrep'),
                        calculateCoachRoleFit(newHire, 'defensePrep')
                    ].reduce((sum, value) => sum + value, 0) / 4
                )
            });
        }

        const activeCoaches = getNpcCoaches(team);

        team.coachingVacancies = Math.max(
            0,
            3 - activeCoaches.length
        );

        if (!team.staff || typeof team.staff !== 'object') {
            team.staff = {};
        }

        const isCurrentCoach = member =>
            member?.id != null &&
            activeCoaches.some(
                coach => String(coach?.id) === String(member.id)
            );

        // Keep a valid head coach in place. If the previous reference
        // is no longer employed, use another active coach.
        const headCoach =
            (isCurrentCoach(team.staff.coach) && team.staff.coach) ||
            (isCurrentCoach(team.coach) && team.coach) ||
            activeCoaches[0] ||
            null;

        team.staff.coach = headCoach;
        team.coach = headCoach;

        // Preserve valid assignments where possible, while preventing
        // different staff roles from pointing to the same coach when
        // enough active coaches are available.
        const assignedCoachIds = new Set(
            headCoach?.id != null
                ? [String(headCoach.id)]
                : []
        );

        const assignStaffRole = currentCoach => {
            if (
                isCurrentCoach(currentCoach) &&
                !assignedCoachIds.has(String(currentCoach.id))
            ) {
                assignedCoachIds.add(String(currentCoach.id));
                return currentCoach;
            }

            const replacement = activeCoaches.find(
                coach =>
                    coach?.id != null &&
                    !assignedCoachIds.has(String(coach.id))
            );

            if (replacement) {
                assignedCoachIds.add(String(replacement.id));
                return replacement;
            }

            // Matching legacy behavior: temporarily reuse an active
            // coach if the team has fewer than three NPC coaches.
            return headCoach;
        };

        team.staff.scout = assignStaffRole(team.staff.scout);
        team.staff.trainer = assignStaffRole(team.staff.trainer);
    }

    gameState.coachCarouselResolvedYear = year;

    const vacanciesRemaining = gameState.teams.reduce(
        (total, team) =>
            total + (
                team?.leagueType === 'main'
                    ? getVacancies(team)
                    : 0
            ),
        0
    );

    return {
        resolved: true,
        year,
        hires,
        vacanciesRemaining
    };
}

export function getTeamCoachingSpecialist(team, task = 'general') {
    if (!team) return null;

    const coaches = Array.isArray(team.coaches)
        ? team.coaches.filter(coach => coach?.id)
        : [];

    // Compatibility fallback for teams and saved games not yet migrated.
    if (coaches.length === 0) {
        if (task === 'scouting') {
            return team.staff?.scout || team.staff?.coach || team.coach || null;
        }

        if (task === 'training') {
            return team.staff?.trainer || team.staff?.coach || team.coach || null;
        }

        return team.staff?.coach || team.coach || null;
    }

    const rating = (coach, key) => {
        const value = Number(coach.ratings?.[key]);
        return Number.isFinite(value) ? value : 50;
    };

    const score = coach => {
        switch (task) {
            case 'scouting':
                return (
                    rating(coach, 'evalPhysicals') +
                    rating(coach, 'evalTechnique') +
                    rating(coach, 'evalCharacter')
                ) / 3;

            case 'training':
                return (
                    rating(coach, 'teaching') +
                    rating(coach, 'practiceDiscipline') +
                    rating(coach, 'conditioning')
                ) / 3;

            case 'offensePrep':
                return (
                    rating(coach, 'offSchemeMastery') +
                    rating(coach, 'gameplanInstinct') +
                    rating(coach, 'inGameAdjustments')
                ) / 3;

            case 'defensePrep':
                return (
                    rating(coach, 'defSchemeMastery') +
                    rating(coach, 'gameplanInstinct') +
                    rating(coach, 'inGameAdjustments')
                ) / 3;

            default:
                return (
                    rating(coach, 'gameplanInstinct') +
                    rating(coach, 'inGameAdjustments') +
                    rating(coach, 'teaching')
                ) / 3;
        }
    };

    let bestCoach = coaches[0];
    let bestScore = score(bestCoach);

    for (let i = 1; i < coaches.length; i++) {
        const candidateScore = score(coaches[i]);

        if (candidateScore > bestScore) {
            bestCoach = coaches[i];
            bestScore = candidateScore;
        }
    }

    return bestCoach;
}

export function calculateSchemeClash(team) {
    if (!team || !team.gameplan || !team.gameplan.situational) return 0;
    if (team.gameplan.situational.playcaller !== 'GM') return 0;

    const coach = getTeamCoachingSpecialist(team, 'general');
    const tacticalId =
        getStaffProfileId(coach, 'tactical') || 'adaptive_strategist';

    const sit = team.gameplan.situational;

    let expectedRun = 50;
    let expectedDefAggro = 50;

    if (tacticalId === 'power_run_specialist') {
        expectedRun += 30;
    }

    if (tacticalId === 'spread_passing_specialist') {
        expectedRun -= 30;
    }

    if (tacticalId === 'pressure_oriented_defender') {
        expectedDefAggro += 35;
    }

    if (tacticalId === 'conservative_game_manager') {
        expectedDefAggro -= 25;
    }

    const runDiff = Math.abs(sit.earlyDownTendency - expectedRun);
    const aggroDiff = Math.abs(
        sit.defenseAggressiveness - expectedDefAggro
    );

    // Minor deviations are ignored. Major philosophical clashes cause confusion.
    const totalClash = (runDiff + aggroDiff) / 2;
    if (totalClash <= 15) return 0;

    // Max penalty is around -18 IQ for total philosophical opposites.
    return Math.floor((totalClash - 15) * 0.35);
}

export function previewCoachTendencies(coach, team) {
    const tacticalId =
        getStaffProfileId(coach, 'tactical') || 'adaptive_strategist';

    const iqValue = Number(coach?.ratings?.gameplanInstinct);
    const iq = Number.isFinite(iqValue)
        ? Math.max(0, Math.min(100, iqValue))
        : 50;

    const riskTolerance = getStaffBehaviorTendency(
        coach,
        'riskTolerance'
    );

    const discipline = getStaffBehaviorTendency(
        coach,
        'discipline'
    );

    const behavioralAdaptability = getStaffBehaviorTendency(
        coach,
        'adaptability'
    );

    const roster = getRosterObjects(team);

    // Coaches evaluate roster strengths using their own scouting reports.
    // Missing or insufficient reports produce a neutral estimate rather
    // than exposing a player's actual positional ratings.
    const getBestReportedPositionEstimate = position => {
        const estimates = roster
            .filter(player => player?.id != null)
            .map(player => {
                const report = getTeamScoutingReport(
                    team,
                    player.id
                );

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

                if (confidence < 0.50) return null;

                const fit = [
                    report?.evaluation?.offenseFit,
                    report?.evaluation?.defenseFit
                ].find(candidate =>
                    String(candidate?.position || '').toUpperCase() ===
                        position &&
                    candidate.low != null &&
                    candidate.high != null &&
                    Number.isFinite(Number(candidate.low)) &&
                    Number.isFinite(Number(candidate.high)) &&
                    Number(candidate.high) >= Number(candidate.low)
                );

                if (!fit) return null;

                const low = Number(fit.low);
                const midpoint = (
                    low + Number(fit.high)
                ) / 2;

                return low + (midpoint - low) * confidence;
            })
            .filter(Number.isFinite);

        return estimates.length > 0
            ? Math.max(...estimates)
            : 50;
    };

    const qbOvr = getBestReportedPositionEstimate('QB');
    const rbOvr = getBestReportedPositionEstimate('RB');
    const wrOvr = getBestReportedPositionEstimate('WR');

    const passStrength = (qbOvr + wrOvr) / 2;
    const runStrength = rbOvr;
    const rosterRunPreference = runStrength - passStrength;

    // Defensive personnel are evaluated through the same scouting limits.
    const dbOvr = getBestReportedPositionEstimate('DB');
    const rosterBlitzPreference = dbOvr - 50;

    let earlyDownTendency = 50;
    let thirdLongAggro = 50;
    let fourthBravery = 50;
    let defAggro = 50;

    // 1. Tactical philosophy.
    if (tacticalId === 'power_run_specialist') {
        earlyDownTendency += 25;
    }

    if (tacticalId === 'spread_passing_specialist') {
        earlyDownTendency -= 25;
    }

    if (tacticalId === 'conservative_game_manager') {
        thirdLongAggro -= 30;
        fourthBravery -= 30;
        defAggro -= 20;
    }

    if (tacticalId === 'pressure_oriented_defender') {
        defAggro += 35;
        thirdLongAggro += 15;
    }

    // 2. Individual behavioral tendencies.
    // Risk tolerance affects willingness to take aggressive chances.
    thirdLongAggro += (riskTolerance - 50) * 0.15;
    fourthBravery += (riskTolerance - 50) * 0.40;
    defAggro += (riskTolerance - 50) * 0.10;

    // Discipline has a modest influence on the coach's run preference.
    earlyDownTendency += (discipline - 50) * 0.20;

    // 3. Adapt the game plan to roster strengths.
    // Coaching judgment matters more than behavioral inclination alone.
    const adaptability = Math.max(
        0,
        Math.min(
            1,
            (iq * 0.75 + behavioralAdaptability * 0.25) / 100
        )
    );

    const stubbornnessValue = Number(coach?.stubbornness);
    const stubbornness = Number.isFinite(stubbornnessValue)
        ? Math.max(0, Math.min(1, stubbornnessValue))
        : 0.75;

    const targetRunTendency = 50 + (rosterRunPreference * 1.5);

    earlyDownTendency =
        (earlyDownTendency * stubbornness) +
        (targetRunTendency * adaptability);

    const targetDefAggro = 50 + rosterBlitzPreference;

    defAggro =
        (defAggro * stubbornness) +
        (targetDefAggro * adaptability);

    return {
        earlyDownTendency: Math.max(
            0,
            Math.min(100, Math.round(earlyDownTendency))
        ),

        thirdAndLongAggressiveness: Math.max(
            0,
            Math.min(100, Math.round(thirdLongAggro))
        ),

        fourthDownBravery: Math.max(
            0,
            Math.min(100, Math.round(fourthBravery))
        ),

        defenseAggressiveness: Math.max(
            0,
            Math.min(100, Math.round(defAggro))
        )
    };
}

export function aiSetSituationalGameplan(team) {
    if (!team || !team.gameplan) return;
    
    // If GM is calling plays manually, do not overwrite their sliders
    if (team.gameplan.situational?.playcaller === 'GM') return;

    const coach = team.staff?.coach || team.coach;
    team.gameplan.situational = {
        playcaller: 'COACH',
        ...previewCoachTendencies(coach, team)
    };
}

export function aiBuildGameplan(team, opponent = null, gmDirective = 'COACH_AUTONOMY') {
    if (!team || !team.gameplan) return;

    aiSetSituationalGameplan(team);

    const offenseCoach = getTeamCoachingSpecialist(team, 'offensePrep');
    const defenseCoach = getTeamCoachingSpecialist(team, 'defensePrep');

    const offenseTacticalId =
        getStaffProfileId(offenseCoach, 'tactical') ||
        'adaptive_strategist';
    const defenseTacticalId =
        getStaffProfileId(defenseCoach, 'tactical') ||
        'adaptive_strategist';

    const offenseInstinct =
        offenseCoach?.ratings?.gameplanInstinct || 50;
    const defenseInstinct =
        defenseCoach?.ratings?.gameplanInstinct || 50;
    const currentOffForm = team.formations?.offense || 'Balanced';

    const allOffKeys = Object.keys(offensivePlaybook).filter(k => k !== 'Punt_Punt' && !['Uni_InsideZone', 'Uni_QuickSlants', 'Uni_FourVerts'].includes(k));
    const allDefKeys = Object.keys(defensivePlaybook).filter(k => k !== 'PuntReturn_Classic' && !['Cover_2_Zone_Base', 'Cover_1_Robber', 'GoalLine_RunStuff'].includes(k));

    // Staff preparation improves the odds that targeted plays make the
    // gameplan. Actual hours are reduced by staff availability/reliability.
    const prepCoaches = Array.isArray(team.coaches)
        ? team.coaches.filter(coach => coach?.id != null)
        : [];

    const getPreparationScoreBonus = (task, playKey) => {
        const skillKeys = task === 'offensePrep'
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

        let totalBonus = 0;

        for (const assignment of team.staffWorkPlan?.assignments || []) {
            if (
                assignment?.task !== task ||
                assignment.coachId == null
            ) {
                continue;
            }

            const targetKeys = Array.isArray(assignment.playKeys)
                ? assignment.playKeys
                : (
                    task === 'offensePrep'
                        ? team.gameplan.installedOffense
                        : team.gameplan.installedDefense
                );

            if (!Array.isArray(targetKeys) || !targetKeys.includes(playKey)) {
                continue;
            }

            const effectiveHours = getEffectiveStaffWorkHours(
                team,
                assignment
            );

            if (!Number.isFinite(effectiveHours) || effectiveHours <= 0) {
                continue;
            }

            const assignedCoach = prepCoaches.find(
                coach =>
                    String(coach.id) === String(assignment.coachId)
            );

            const ratings = assignedCoach?.ratings || {};

            const skillScore = skillKeys.reduce((sum, key) => {
                const value = Number(ratings[key]);

                return sum + (
                    Number.isFinite(value)
                        ? Math.max(0, Math.min(100, value))
                        : 50
                );
            }, 0) / skillKeys.length;

            const hoursFactor = Math.min(1, effectiveHours / 8);
            const skillFactor = 0.65 + (skillScore / 200);

            totalBonus += 12 * hoursFactor * skillFactor;
        }

        return Math.min(18, totalBonus);
    };

    // Score offensive plays based on Coach Bias + Roster Fit + GM Directive
    const scoredOff = allOffKeys.map(key => {
        const play = offensivePlaybook[key];
        let score = 50;

        if (
            offenseTacticalId === 'spread_passing_specialist' &&
            play.type === 'pass'
        ) {
            score += 25;
        }

        if (
            offenseTacticalId === 'power_run_specialist' &&
            play.type === 'run'
        ) {
            score += 25;
        }
        if (play.tags?.includes('pa') || play.tags?.includes('trick')) {
            score += offenseInstinct > 65 ? 15 : 5;
        }
        if (gmDirective === 'WIN_NOW' && opponent) {
            // Exploit opponent defensive style if coach has high gameplan instinct
            const oppDef = opponent.formations?.defense || '';
            if (oppDef.includes('4-2-2') && play.type === 'pass') score += 20; // Pass against run-heavy fronts
            if (oppDef.includes('3-0-5') && play.type === 'run') score += 20;  // Run against dime looks
        }

        score += getPreparationScoreBonus('offensePrep', key);

        return { key, score: score + Math.random() * 10 };
    }).sort((a, b) => b.score - a.score);

    // Score defensive schemes
    const scoredDef = allDefKeys.map(key => {
        const play = defensivePlaybook[key];
        let score = 50;

        if (
            defenseTacticalId === 'pressure_oriented_defender' &&
            play.blitz
        ) {
            score += 30;
        }

        if (
            defenseTacticalId === 'conservative_game_manager' &&
            !play.blitz
        ) {
            score += 20;
        }

        if (gmDirective === 'WIN_NOW' && opponent) {
            const oppOff = opponent.formations?.offense || '';
            if (oppOff.includes('Spread') && play.concept === 'Zone') score += 20;
            if (oppOff.includes('Power') && play.concept === 'Run') score += 25;
        }

        score += getPreparationScoreBonus('defensePrep', key);

        return { key, score: score + Math.random() * 10 };
    }).sort((a, b) => b.score - a.score);

    team.gameplan.installedOffense = scoredOff.slice(0, 6).map(s => s.key);
    team.gameplan.installedDefense = scoredDef.slice(0, 4).map(s => s.key);
}

export function processWeeklyStaffPreparation(
    team,
    year,
    week,
    upcomingOpponent = null
) {
    if (!team || !team.gameplan) return null;

    const scheduledOpponentId = upcomingOpponent?.id == null
        ? ''
        : String(upcomingOpponent.id).trim();

    const assignments = Array.isArray(team.staffWorkPlan?.assignments)
        ? team.staffWorkPlan.assignments
        : [];

    const coaches = Array.isArray(team.coaches)
        ? team.coaches.filter(coach => coach?.id != null)
        : [];

    const clampPoints = value =>
        Math.round(Math.max(0, Math.min(12, value)) * 10) / 10;

    const getAssignmentPoints = (assignment, task) => {
        const effectiveHours = getEffectiveStaffWorkHours(
            team,
            assignment
        );

        if (
            !Number.isFinite(effectiveHours) ||
            effectiveHours <= 0
        ) {
            return 0;
        }

        const coach = coaches.find(
            candidate =>
                String(candidate.id) === String(assignment.coachId)
        );

        const ratings = coach?.ratings || {};

        const skillKeys = task === 'offensePrep'
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

        const skillScore = skillKeys.reduce((sum, key) => {
            const value = Number(ratings[key]);

            return sum + (
                Number.isFinite(value)
                    ? Math.max(0, Math.min(100, value))
                    : 50
            );
        }, 0) / skillKeys.length;

        // Delivered hours determine the base output; stronger
        // scheme and game-planning skills improve its value.
        const skillFactor = 0.70 + (skillScore / 250);

        return effectiveHours * skillFactor;
    };

    let offensePoints = 0;
    let generalOffensePoints = 0;
    let generalDefensePoints = 0;

    const offensePointsByPlay = {};
    const generalOffensePointsByPlay = {};
    const generalDefensePointsByPlay = {};

    const specificOffensePoints = new Map();
    const specificOffensePointsByOpponent = new Map();

    const specificDefensePoints = new Map();
    const specificDefensePointsByOpponent = new Map();

    const addPlayPoints = (target, playKey, points) => {
        if (!playKey || !Number.isFinite(points) || points <= 0) {
            return;
        }

        target[playKey] = (target[playKey] || 0) + points;
    };

    for (const assignment of assignments) {
        if (
            !assignment ||
            !['offensePrep', 'defensePrep'].includes(assignment.task) ||
            assignment.coachId == null
        ) {
            continue;
        }

        const points = getAssignmentPoints(
            assignment,
            assignment.task
        );

        if (points <= 0) continue;

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

        const requestedKeys = Array.isArray(assignment.playKeys)
            ? assignment.playKeys
            : [...allowedKeys];

        const targetedKeys = [
            ...new Set(
                requestedKeys.filter(key => allowedKeys.has(key))
            )
        ];

        // Divide preparation effort across the plays actually targeted.
        const pointsPerPlay = targetedKeys.length > 0
            ? points / targetedKeys.length
            : 0;

        if (isOffense) {
            offensePoints += points;

            targetedKeys.forEach(key =>
                addPlayPoints(
                    offensePointsByPlay,
                    key,
                    pointsPerPlay
                )
            );

            const assignedOpponentId =
                assignment.opponentTeamId == null
                    ? ''
                    : String(assignment.opponentTeamId).trim();

            const opponentId =
                assignedOpponentId || scheduledOpponentId;

            if (!opponentId) {
                generalOffensePoints += points;

                targetedKeys.forEach(key =>
                    addPlayPoints(
                        generalOffensePointsByPlay,
                        key,
                        pointsPerPlay
                    )
                );

                continue;
            }

            specificOffensePoints.set(
                opponentId,
                (specificOffensePoints.get(opponentId) || 0) + points
            );

            if (!specificOffensePointsByOpponent.has(opponentId)) {
                specificOffensePointsByOpponent.set(opponentId, {});
            }

            const opponentPlayPoints =
                specificOffensePointsByOpponent.get(opponentId);

            targetedKeys.forEach(key =>
                addPlayPoints(
                    opponentPlayPoints,
                    key,
                    pointsPerPlay
                )
            );

            continue;
        }

        const assignedOpponentId =
            assignment.opponentTeamId == null
                ? ''
                : String(assignment.opponentTeamId).trim();

        const opponentId =
            assignedOpponentId || scheduledOpponentId;

        if (!opponentId) {
            generalDefensePoints += points;

            targetedKeys.forEach(key =>
                addPlayPoints(
                    generalDefensePointsByPlay,
                    key,
                    pointsPerPlay
                )
            );

            continue;
        }

        specificDefensePoints.set(
            opponentId,
            (specificDefensePoints.get(opponentId) || 0) + points
        );

        if (!specificDefensePointsByOpponent.has(opponentId)) {
            specificDefensePointsByOpponent.set(opponentId, {});
        }

        const opponentPlayPoints =
            specificDefensePointsByOpponent.get(opponentId);

        targetedKeys.forEach(key =>
            addPlayPoints(
                opponentPlayPoints,
                key,
                pointsPerPlay
            )
        );
    }

    const clampPlayPoints = playPoints =>
        Object.fromEntries(
            Object.entries(playPoints).map(([key, points]) => [
                key,
                clampPoints(points)
            ])
        );

    const offenseByOpponent = {
        '*': {
            points: clampPoints(generalOffensePoints),
            byPlay: clampPlayPoints(generalOffensePointsByPlay)
        }
    };

    for (const [opponentId, points] of specificOffensePoints) {
        const combinedByPlay = {
            ...generalOffensePointsByPlay
        };

        const opponentPlayPoints =
            specificOffensePointsByOpponent.get(opponentId) || {};

        for (const [playKey, playPoints] of Object.entries(
            opponentPlayPoints
        )) {
            combinedByPlay[playKey] =
                (combinedByPlay[playKey] || 0) + playPoints;
        }

        offenseByOpponent[opponentId] = {
            points: clampPoints(generalOffensePoints + points),
            byPlay: clampPlayPoints(combinedByPlay)
        };
    }

    const defenseByOpponent = {
        '*': {
            points: clampPoints(generalDefensePoints),
            byPlay: clampPlayPoints(generalDefensePointsByPlay)
        }
    };

    // Opponent-specific preparation supplements general preparation
    // and adds its own play-level scores.
    for (const [opponentId, points] of specificDefensePoints) {
        const combinedByPlay = {
            ...generalDefensePointsByPlay
        };

        const opponentPlayPoints =
            specificDefensePointsByOpponent.get(opponentId) || {};

        for (const [playKey, playPoints] of Object.entries(
            opponentPlayPoints
        )) {
            combinedByPlay[playKey] =
                (combinedByPlay[playKey] || 0) + playPoints;
        }

        defenseByOpponent[opponentId] = {
            points: clampPoints(generalDefensePoints + points),
            byPlay: clampPlayPoints(combinedByPlay)
        };
    }

    team.gameplan.staffPreparation = {
        preparedForYear: Number(year),
        preparedForWeek: Number(week),
        offensePoints: clampPoints(offensePoints),
        offenseByPlay: clampPlayPoints(offensePointsByPlay),
        offenseByOpponent,
        defenseByOpponent
    };

    return team.gameplan.staffPreparation;
}

/**
 * AI Coach chooses weekly practice focus based on staff traits,
 * roster fatigue, finances, GM directives, and the upcoming opponent.
 */
export function aiChooseWeeklyPractice(
    team,
    opponent = null,
    gmDirective = 'COACH_AUTONOMY'
) {
    if (!team || !team.gameplan) return 'chalk_talk';

    const coach = getTeamCoachingSpecialist(team, 'training');
    const personalityId = getStaffProfileId(coach, 'personality');
    const balance = Number(team.finances?.balance) || 0;
    const tokens = Number(team.socialProfile?.favorTokens) || 0;

    const hasUpcomingOpponent =
        opponent?.id != null &&
        String(opponent.id) !== String(team.id);

    const availableRoster = getRosterObjects(team).filter(
        player =>
            player &&
            !(Number(player.status?.duration) > 0)
    );

    const averageFatigue = availableRoster.length > 0
        ? availableRoster.reduce((total, player) => {
            const fatigue = Number(player.fatigue) || 0;

            return total + Math.max(0, Math.min(100, fatigue));
        }, 0) / availableRoster.length
        : 0;

    // Estimate whether scrimmage will actually reduce fatigue under the
    // team's configured schedule. A very long schedule can erase its
    // recovery benefit, so do not recommend it blindly.
    const schedule = team.gameplan.practiceSchedule || {};
    const fieldAccess = team.gameplan.practiceFieldAccess;

    const maxSessions = ['school', 'dedicated'].includes(fieldAccess)
        ? 3
        : 2;

    const requestedSessions = Number(schedule.sessionsPerWeek);
    const sessionsPerWeek = Number.isFinite(requestedSessions)
        ? Math.max(1, Math.min(maxSessions, Math.round(requestedSessions)))
        : 2;

    const requestedMinutes = Number(schedule.minutesPerSession);
    const minutesPerSession = [60, 90, 120].includes(requestedMinutes)
        ? requestedMinutes
        : 90;

    const weeklyPracticeMinutes =
        sessionsPerWeek * minutesPerSession;

    const practiceOutputFactor = Math.min(
        1.15,
        0.25 + (weeklyPracticeMinutes / 180) * 0.75
    );

    const practiceFatigueCost = Math.min(
        12,
        Math.max(
            0,
            Math.round((weeklyPracticeMinutes / 180) * 6)
        )
    );

    const expectedScrimmageFatigueChange =
        practiceFatigueCost -
        Math.round(8 * practiceOutputFactor);

    const scrimmageCanRecover =
        expectedScrimmageFatigueChange <= 0;

    const lowerIntensityFocus = () =>
        hasUpcomingOpponent ? 'scouting' : 'chalk_talk';

    // Protect a tired roster from additional physical workload.
    // Only choose scrimmage as the recovery option when its expected
    // net fatigue change is neutral or negative.
    if (averageFatigue >= 45) {
        return scrimmageCanRecover
            ? 'scrimmage'
            : lowerIntensityFocus();
    }

    // Financial Awareness: cash-strapped teams sometimes sacrifice
    // normal practice to raise money through neighborhood chores.
    if (
        balance < 3.00 &&
        tokens === 0 &&
        Math.random() < 0.45
    ) {
        return 'hustle';
    }

    // GM directives define the program's strategic priorities.
    if (gmDirective === 'DEVELOP_YOUTH') {
        return 'chalk_talk';
    }

    if (gmDirective === 'HARD_CONDITIONING') {
        return 'conditioning';
    }

    if (gmDirective === 'WIN_NOW') {
        if (balance < 2.00) return 'hustle';

        return hasUpcomingOpponent
            ? 'scouting'
            : 'chalk_talk';
    }

    // Coach Autonomy: personality influences the preferred approach,
    // but should not cause avoidable physical overload.
    if (personalityId === 'traditionalist') {
        if (averageFatigue >= 35) {
            return scrimmageCanRecover
                ? 'scrimmage'
                : lowerIntensityFocus();
        }

        return 'conditioning';
    }

    if (personalityId === 'analytical_planner') {
        if (balance < 6.00) return 'hustle';

        return hasUpcomingOpponent
            ? 'scouting'
            : 'chalk_talk';
    }

    if (personalityId === 'player_centered') {
        return 'scrimmage';
    }

    if (personalityId === 'hard_nosed_competitor') {
        if (averageFatigue >= 35) {
            return scrimmageCanRecover
                ? 'scrimmage'
                : lowerIntensityFocus();
        }

        return 'conditioning';
    }

    // Balanced coaches favor opponent preparation when a matchup is
    // scheduled. Without an upcoming opponent, use general playbook work.
    if (!hasUpcomingOpponent) {
        return 'chalk_talk';
    }

    return Math.random() < 0.65
        ? 'scouting'
        : 'chalk_talk';
}

/**
 * AI Coach logically evaluates roster surpluses and deficits to transition players without spam.
 */
export function aiEvaluatePositionChanges(team, gameState) {
    if (!team || team.isPlayerControlled) return;

    const coach = getTeamCoachingSpecialist(team, 'training');
    const roster = getRosterObjects(team);
    const positions = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'];
    const idealCounts = { QB: 1, RB: 2, WR: 3, TE: 1, OL: 3, DL: 3, LB: 2, DB: 3 };

    // Estimate positional depth using publicly listed positions.
    // Do not use true player attributes to identify hidden positional
    // versatility when calculating roster surpluses and deficits.
    const counts = {};

    positions.forEach(pos => {
        counts[pos] = roster.filter(player =>
            String(player?.pos || '').toUpperCase() === pos
        ).length;
    });

    const deficits = positions.filter(pos => counts[pos] < idealCounts[pos]);
    if (deficits.length === 0) return; // Roster is balanced

    // Candidate pool: only young kids (age <= 15) who haven't changed positions recently
    const eligibleKids = roster.filter(p =>
        p.age <= 15 &&
        (
            !p.positionChangedYear ||
            (gameState.year - p.positionChangedYear) >= 2
        )
    );

    for (const targetPos of deficits) {
        // Find candidate from a surplus position who is viable at targetPos
        const bestCandidate = eligibleKids.find(kid => {
            const currentPos = String(
                kid.pos || ''
            ).toUpperCase();

            if (!positions.includes(currentPos)) {
                return false;
            }

            const isSurplus = counts[currentPos] > idealCounts[currentPos];

            // Position changes must be evaluated using this team's
            // scouting estimates, never the player's hidden true ratings.
            const positionReport = getTeamScoutingReport(
                team,
                kid.id
            );

            const rawPositionConfidence = Number(
                positionReport?.confidence
            );

            const positionConfidence = Number.isFinite(
                rawPositionConfidence
            )
                ? Math.max(
                    0,
                    Math.min(
                        1,
                        rawPositionConfidence > 1
                            ? rawPositionConfidence / 100
                            : rawPositionConfidence
                    )
                )
                : 0;

            const getReportedPositionOvr = position => {
                if (positionConfidence < 0.50) return null;

                const fit = [
                    positionReport?.evaluation?.offenseFit,
                    positionReport?.evaluation?.defenseFit
                ].find(candidate => {
                    const fitPosition = String(
                        candidate?.position || ''
                    ).toUpperCase();

                    const low = Number(candidate?.low);
                    const high = Number(candidate?.high);

                    return (
                        fitPosition === position &&
                        candidate.low != null &&
                        candidate.high != null &&
                        Number.isFinite(low) &&
                        Number.isFinite(high) &&
                        high >= low
                    );
                });

                if (!fit) return null;

                const low = Number(fit.low);
                const high = Number(fit.high);
                const midpoint = (low + high) / 2;

                // Lower-confidence reports lean toward the lower
                // end of the estimated range.
                return low +
                    (midpoint - low) * positionConfidence;
            };

            const targetOvr = getReportedPositionOvr(targetPos);
            const currentOvr = getReportedPositionOvr(currentPos);

            const isViableAtNew =
                targetOvr !== null &&
                currentOvr !== null;

            // Without estimates for both positions, the AI cannot
            // reliably judge whether the conversion is worthwhile.
            if (!isViableAtNew) return false;

            // Individual coach tendencies influence position-conversion
            // decisions. They affect willingness, not player ability.
            let threshold = currentOvr - 2;

            const discipline = getStaffBehaviorTendency(
                coach,
                'discipline'
            );

            const riskTolerance = getStaffBehaviorTendency(
                coach,
                'riskTolerance'
            );

            const scoutingReport = getTeamScoutingReport(
                team,
                kid.id
            );

            const characterSummary = String(
                scoutingReport?.evaluation?.characterSummary || ''
            ).toLowerCase();

            const hasKnownReliabilityEvidence =
                characterSummary.includes(
                    'strong effort/reliability signals'
                );

            if (discipline >= 70 && hasKnownReliabilityEvidence) {
                // Disciplined coaches are more willing to retrain
                // players whose dependability is supported by scouting.
                threshold -= 4;
            } else if (
                riskTolerance >= 65 &&
                ['OL', 'DL'].includes(targetPos)
            ) {
                // Risk-tolerant coaches are more willing to try a
                // positional conversion when the physical tools fit.
                const strengthRange =
                    scoutingReport?.attributeRanges?.physical?.strength;

                const rawScoutingConfidence = Number(
                    scoutingReport?.confidence
                );

                const scoutingConfidence =
                    Number.isFinite(rawScoutingConfidence)
                        ? Math.max(
                            0,
                            Math.min(
                                1,
                                rawScoutingConfidence > 1
                                    ? rawScoutingConfidence / 100
                                    : rawScoutingConfidence
                            )
                        )
                        : 0;

                if (
                    scoutingConfidence >= 0.50 &&
                    strengthRange?.low != null &&
                    strengthRange?.high != null &&
                    Number.isFinite(Number(strengthRange.low)) &&
                    Number.isFinite(Number(strengthRange.high))
                ) {
                    const lowStrength = Number(strengthRange.low);
                    const estimatedStrength =
                        lowStrength +
                        (
                            (Number(strengthRange.high) - lowStrength) / 2
                        ) * scoutingConfidence;

                    if (estimatedStrength >= 55) {
                        threshold -= 5;
                    }
                }
            }

            return isSurplus && isViableAtNew && (targetOvr >= threshold);
        });

        if (bestCandidate) {
            const oldPos = String(
                bestCandidate.pos || ''
            ).toUpperCase();

            const isOff = ['QB', 'RB', 'WR', 'TE', 'OL'].includes(targetPos);

            bestCandidate.pos = targetPos;
            bestCandidate.bestPosition = targetPos;
            bestCandidate.primarySide = isOff ? 'offense' : 'defense';
            if (bestCandidate.scouting) bestCandidate.scouting.bestPosition = targetPos;

            if (isOff) {
                bestCandidate.favoriteOffensivePosition = targetPos;
                if (['OL', 'TE'].includes(targetPos) && bestCandidate.favoriteDefensivePosition === 'DB') {
                    bestCandidate.favoriteDefensivePosition = 'DL';
                }
            } else {
                bestCandidate.favoriteDefensivePosition = targetPos;
                if (targetPos === 'DL' && ['WR', 'QB'].includes(bestCandidate.favoriteOffensivePosition)) {
                    bestCandidate.favoriteOffensivePosition = 'OL';
                }
            }

            bestCandidate.positionChangedYear = gameState.year;
            counts[oldPos]--;
            counts[targetPos]++;

            rebuildDepthChartFromOrder(team);
            break;
        }
    }
}

/**
 * Processes weekly market decay for unemployed staff on the market.
 * Stubborn coaches hold out longer; humble coaches drop demands quickly.
 *
 * Each coach is processed at most once per call. Coaches who are employed
 * or represented by stale duplicate market entries are excluded.
 */
export function processStaffMarketDecay(gameState) {
    if (
        !gameState ||
        !Array.isArray(gameState.availableStaff)
    ) {
        return;
    }

    // Team rosters and legacy staff references are the source of truth
    // for employment, not just a candidate's teamId field.
    const employedStaffIds = new Set();

    const registerEmployedStaff = staff => {
        if (staff?.id != null) {
            employedStaffIds.add(String(staff.id));
        }
    };

    for (const team of gameState.teams || []) {
        if (!team) continue;

        (Array.isArray(team.coaches) ? team.coaches : [])
            .forEach(registerEmployedStaff);

        registerEmployedStaff(team.coach);

        for (const role of ['coach', 'scout', 'trainer']) {
            registerEmployedStaff(team.staff?.[role]);
        }
    }

    const seenIds = new Set();
    const validMarket = [];

    const getRating = value => {
        const rating = Number(value);

        return Number.isFinite(rating)
            ? Math.max(0, Math.min(100, rating))
            : 50;
    };

    for (const staff of gameState.availableStaff) {
        if (!staff || staff.id == null) continue;

        const id = String(staff.id);

        // Remove stale employment records and duplicate market entries.
        if (
            staff.teamId != null ||
            employedStaffIds.has(id) ||
            seenIds.has(id)
        ) {
            continue;
        }

        seenIds.add(id);
        validMarket.push(staff);

        const previousWeeks = Number(staff.weeksUnemployed);
        const weeksUnemployed = (
            Number.isFinite(previousWeeks)
                ? Math.max(0, Math.floor(previousWeeks))
                : 0
        ) + 1;

        staff.weeksUnemployed = weeksUnemployed;

        const rep = Math.round(
            (
                getRating(staff.ratings?.offSchemeMastery) +
                getRating(staff.ratings?.defSchemeMastery) +
                getRating(staff.ratings?.teaching)
            ) / 3
        );

        const baseDemand = Math.max(
            0,
            Math.round((rep - 52) * 0.50)
        );

        // Keep the stubbornness multiplier within a sensible range.
        const rawStubbornness = Number(staff.stubbornness);

        const stubbornness = Number.isFinite(rawStubbornness)
            ? Math.max(0.1, Math.min(1, rawStubbornness))
            : 0.75;

        staff.stipendDemand = Math.max(
            0,
            Math.round(
                baseDemand *
                Math.pow(stubbornness, weeksUnemployed)
            )
        );
    }

    // Normalize the shared pool so stale and duplicate records cannot
    // re-enter later market calculations during this save session.
    gameState.availableStaff = validMarket;
}
