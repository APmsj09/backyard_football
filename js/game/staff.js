// js/game/staff.js - Coaching, Scouting & Front Office System

import { getRandom, getRandomInt } from '../utils.js';
import {
    firstNames,
    lastNames,
    offensivePlaybook,
    defensivePlaybook,
    gmArchetypes
} from '../data.js';
import { getRosterObjects } from './state.js';
import { calculateOverall, estimateBestPosition } from './player.js';
import { isPlayerViableForPosition, rebuildDepthChartFromOrder } from './depth_chart.js';

export const tacticalBiases = [
    { name: 'Smashmouth Zealot', desc: 'Runs the ball heavily; boosts OL/DL development.', runModifier: 0.20, passModifier: -0.20 },
    { name: 'Air Raid Purist', desc: 'Loves passing and spread formations; boosts WR development.', runModifier: -0.20, passModifier: 0.25 },
    { name: 'Blitz Addict', desc: 'Calls extra pressure on defense; high sack and turnover rate.', blitzModifier: 0.30 },
    { name: 'Conservative Turtler', desc: 'Punts on 4th & short past midfield; protects possession.', riskModifier: -0.30 },
    { name: 'Balanced Tactician', desc: 'Adjusts gameplan smoothly based on game flow.', runModifier: 0, passModifier: 0 }
];

export const scoutingBiases = [
    { name: 'Speed Chaser', desc: 'Overrates raw 40-times; prone to missing technique flaws.' },
    { name: 'Technique Purist', desc: 'Prioritizes hands and blocking over raw athleticism.' },
    { name: 'Character First', desc: 'Uncovers Ego, Work Ethic, and Cliques with ease.' },
    { name: 'Objective Scout', desc: 'Gives balanced, steady prospect evaluations.' }
];

export const personalityTraits = [
    { name: "Players' Coach", desc: 'Boosts team happiness; prevents transfer walkouts.' },
    { name: 'Old-School Disciplinarian', desc: 'Rigorous conditioning; increases stamina, but clashes with high-ego stars.' },
    { name: "Peaked in '94", desc: 'Extremely stubborn; boosts player toughness.' },
    { name: 'Analytical Savant', desc: 'Sharp in-game adjustments, but quiet on the sideline.' }
];

export function generateStaffMember(role = 'coach', minAge = 25, maxAge = 55, formerPlayer = null) {
    const firstName = formerPlayer ? formerPlayer.name.split(' ')[0] : getRandom(firstNames);
    const lastName = formerPlayer ? formerPlayer.name.split(' ').slice(1).join(' ') : getRandom(lastNames);
    const age = formerPlayer ? 19 : getRandomInt(minAge, maxAge);

    const baseVal = () => getRandomInt(45, 75);

    // Initial trait rolls to calculate market demands
    const personality = getRandom(personalityTraits);
    const tactical = getRandom(tacticalBiases);
    const scouting = getRandom(scoutingBiases);

    // Personality dictates market stubbornness
    let stubbornness = 0.75;
    if (personality.name === "Peaked in '94" || personality.name === "Old-School Disciplinarian") stubbornness = 0.92;
    else if (personality.name === "Players' Coach") stubbornness = 0.58;
    else if (personality.name === "Analytical Savant") stubbornness = 0.70;

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
        biases: {
            tactical: getRandom(tacticalBiases),
            scouting: getRandom(scoutingBiases),
            personality: getRandom(personalityTraits)
        },
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
            ? Math.max(0, Math.min(99, rating))
            : 50;

        if (!Number.isFinite(Number(coach.ratings[skill]))) {
            coach.ratings[skill] = current;
        }

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

function getCoachLearningStyleMultiplier(coach, skill) {
    const personality = coach?.biases?.personality?.name;

    if (
        personality === 'Analytical Savant' &&
        [
            'evalPhysicals',
            'evalTechnique',
            'evalCharacter',
            'offSchemeMastery',
            'defSchemeMastery',
            'gameplanInstinct',
            'inGameAdjustments'
        ].includes(skill)
    ) {
        return 1.15;
    }

    if (
        personality === "Players' Coach" &&
        [
            'teaching',
            'practiceDiscipline',
            'conditioning'
        ].includes(skill)
    ) {
        return 1.15;
    }

    if (
        personality === 'Old-School Disciplinarian' &&
        [
            'practiceDiscipline',
            'conditioning',
            'defSchemeMastery'
        ].includes(skill)
    ) {
        return 1.15;
    }

    if (
        personality === "Peaked in '94" &&
        [
            'practiceDiscipline',
            'conditioning',
            'defSchemeMastery'
        ].includes(skill)
    ) {
        return 1.10;
    }

    if (
        personality === 'Analytical Savant' &&
        [
            'teaching',
            'conditioning'
        ].includes(skill)
    ) {
        return 0.95;
    }

    return 1;
}

function getCoachMentorMultiplier(coach, skill, coaches, hoursByCoach) {
    const currentRating = Number(coach.ratings?.[skill]) || 50;

    const mentors = coaches.filter(mentor => {
        if (
            !mentor ||
            String(mentor.id) === String(coach.id)
        ) {
            return false;
        }

        const mentorTeaching =
            Number(mentor.ratings?.teaching) || 50;

        const mentorSkill =
            Number(mentor.ratings?.[skill]) || 50;

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

        const availableHours = Math.max(
            0,
            WEEKLY_COACH_HOURS - workload.total
        );

        const allocatedHours = Math.min(
            requestedHours,
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
                const currentRating =
                    Number(coach.ratings?.[skill]) || 50;

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

            const currentRating =
                Number(coach.ratings?.[skill]) || 50;

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

            improvements.push({
                coachId: coach.id,
                coachName: coach.name,
                skill,
                previousRating: currentRating,
                newRating: coach.ratings[skill],
                year,
                week
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

export function ensureTeamCoachingStaff(team) {

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

    while (npcCoaches.length < 3) {
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
            scouting: existingUserCoach.biases?.scouting ||
                { name: 'Objective Scout' },
            tactical: existingUserCoach.biases?.tactical ||
                { name: 'Balanced Tactician' },
            personality: existingUserCoach.biases?.personality ||
                { name: 'Analytical Savant' }
        }
    };

    team.userCoachProfile = userCoach;
    team.coaches = [...npcCoaches, userCoach];

    team.coaches.forEach(ensureCoachDevelopmentProfile);

    return team.coaches;
}

/**
 * Creates a persisted default work plan for existing and new teams.
 * Existing player-configured assignments are preserved.
 */
export function ensureTeamStaffWorkPlan(team) {
    if (!team) return null;

    const coaches = ensureTeamCoachingStaff(team);
    let plan = team.staffWorkPlan;

    if (!plan || !Array.isArray(plan.assignments)) {
        const defaultEvaluator = getTeamCoachingSpecialist(
            team,
            'scouting'
        );

        plan = {
            version: 1,
            weeklyHoursPerCoach: WEEKLY_COACH_HOURS,
            assignments: defaultEvaluator?.id
                ? [{
                    coachId: defaultEvaluator.id,
                    task: STAFF_WORK_TASKS.SCOUTING,
                    hours: 4,
                    focus: 'all',
                    maxTargets: 1
                }]
                : []
        };

        team.staffWorkPlan = plan;
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

    const personality = coach?.biases?.personality?.name;

    // Analytical coaches favor preparation and evaluation.
    if (personality === 'Analytical Savant') {
        if (task === 'offensePrep' || task === 'defensePrep') {
            score += 10;
        } else if (task === 'scouting') {
            score += 4;
        }
    }

    // Development-oriented personalities favor training time.
    if (personality === "Players' Coach") {
        if (task !== 'training') score -= 6;
    } else if (personality === 'Old-School Disciplinarian') {
        if (task === 'scouting') score -= 4;
        if (task === 'offensePrep' || task === 'defensePrep') score -= 4;
    } else if (personality === "Peaked in '94") {
        if (task === 'scouting') score -= 2;
        if (task === 'offensePrep' || task === 'defensePrep') score -= 3;
    }

    return score;
}

function getAiGmDelegationAdjustment(gm, task) {
    const personality = gm?.biases?.personality?.name;

    const preferences = {
        'Analytical Savant': {
            scouting: 3,
            offensePrep: 3,
            defensePrep: 3
        },
        "Players' Coach": {
            scouting: -2,
            offensePrep: -3,
            defensePrep: -3
        },
        'Old-School Disciplinarian': {
            scouting: -3,
            offensePrep: -1,
            defensePrep: 2
        },
        "Peaked in '94": {
            scouting: -2,
            offensePrep: 2,
            defensePrep: 2
        }
    };

    const authority = Number(gm?.ratings?.authority);
    const authorityFactor = Number.isFinite(authority)
        ? Math.max(0.25, Math.min(1, (authority - 40) / 40))
        : 0.5;

    const preferredAdjustment =
        preferences[personality]?.[task] || 0;

    return Math.round(preferredAdjustment * authorityFactor);
}

function getAiGmDelegationAdjustment(gm, task) {
    const adjustments = {
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
    const adjustment = adjustments[archetypeId]?.[task] || 0;

    const authority = Number(gm?.ratings?.authority);
    const normalizedAuthority = Number.isFinite(authority)
        ? Math.max(0, Math.min(1, (authority - 40) / 40))
        : 0.5;

    const influence = 0.5 + normalizedAuthority * 0.5;

    return Math.round(adjustment * influence);
}

function getAiTrainingFocus(team) {
    const roster = getRosterObjects(team).filter(
        player => player?.attributes
    );

    const offensePositions = new Set(['QB', 'RB', 'WR', 'TE', 'OL']);
    const defensePositions = new Set(['DL', 'LB', 'DB']);

    let offenseTotal = 0;
    let offenseCount = 0;
    let defenseTotal = 0;
    let defenseCount = 0;

    for (const player of roster) {
        const positions = [...new Set([
            player.pos,
            player.favoriteOffensivePosition,
            player.favoriteDefensivePosition
        ].filter(position =>
            offensePositions.has(position) ||
            defensePositions.has(position)
        ))];

        const offenseFits = positions.filter(
            position => offensePositions.has(position)
        );
        const defenseFits = positions.filter(
            position => defensePositions.has(position)
        );

        if (offenseFits.length > 0) {
            offenseTotal += Math.max(
                ...offenseFits.map(position =>
                    calculateOverall(player, position)
                )
            );
            offenseCount++;
        }

        if (defenseFits.length > 0) {
            defenseTotal += Math.max(
                ...defenseFits.map(position =>
                    calculateOverall(player, position)
                )
            );
            defenseCount++;
        }
    }

    // Do not assign training to a side with no eligible players.
    if (offenseCount === 0) return 'defense';
    if (defenseCount === 0) return 'offense';

    const offenseScore =
        offenseTotal / offenseCount + Math.min(offenseCount, 4) * 4;
    const defenseScore =
        defenseTotal / defenseCount + Math.min(defenseCount, 4) * 4;

    return offenseScore <= defenseScore ? 'offense' : 'defense';
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

    const gm = team.aiGmProfile || null;

    const gm = team.aiGmProfile || team.staff?.gm || null;

    const gmDirective =
        gm?.strategicDirective ||
        team.gameplan?.gmDirective ||
        'COACH_AUTONOMY';
    const isOffseason = week === 0;
    const hasDraftClass =
        Array.isArray(gameState?.draftClass) &&
        gameState.draftClass.length > 0;

    const hasWatchlist =
        Array.isArray(team.scoutingWatchlist) &&
        team.scoutingWatchlist.length > 0;

    const scoutingFocus = isOffseason
        ? (hasDraftClass ? 'draft' : 'freeAgents')
        : (hasWatchlist ? 'watchlist' : 'opponents');

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

        // Personality changes the balance between specialist work
        // and player development. Offseason allocations stay intact.
        if (!isOffseason && specialtyHours > 0) {
            const personality = coach.biases?.personality?.name;

            if (personality === 'Analytical Savant') {
                specialtyHours += 4;
            } else if (
                personality === "Players' Coach" ||
                personality === 'Old-School Disciplinarian' ||
                personality === "Peaked in '94"
            ) {
                specialtyHours -= 4;
            }

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
export function aiManageTeamStaff(team, gameState) {
    if (!team || team.isPlayerControlled) return;

    const currentCoaches = ensureTeamCoachingStaff(team);
    if (currentCoaches.length === 0) return;

    const coach =
        currentCoaches.find(member =>
            member?.id != null &&
            String(member.id) === String(team.staff?.coach?.id)
        ) || currentCoaches[0];

    if (!coach) return;

    if (!team.staff) team.staff = {};

    // Maintain the legacy reference while migration is underway.
    team.staff.coach = coach;

    const coachSlot = currentCoaches.findIndex(
        member => String(member.id) === String(coach.id)
    );

    const wins = team.wins || 0;
    const roster = getRosterObjects(team);
    const teamOvr = roster.length > 0 ? Math.round(roster.reduce((sum, p) => sum + (calculateOverall(p, p.pos || 'ATH')), 0) / roster.length) : 50;
    const avgHappiness = roster.length > 0 ? Math.round(roster.reduce((sum, p) => sum + (p.expectations?.happiness || 100), 0) / roster.length) : 100;
    const gmDirective = team.gameplan?.gmDirective || 'COACH_AUTONOMY';

    let shouldFireCoach = false;

    // 1. PERFORMANCE VS EXPECTATIONS
    // Expected wins scale with roster talent (55 OVR expects ~4.5 wins; 65+ OVR expects 6+ wins)
    const expectedWins = Math.max(2, Math.round((teamOvr - 40) * 0.25));
    const winDeficit = expectedWins - wins;

    if (team.tier === 1 && (wins <= 2 || winDeficit >= 3)) {
        shouldFireCoach = true; // High-expectations failure
    } else if (team.tier === 2 && wins <= 1 && winDeficit >= 2) {
        shouldFireCoach = Math.random() < 0.70;
    }

    // 2. LOCKER ROOM MORALE REVOLT
    if (avgHappiness < 42 && wins < 4) {
        shouldFireCoach = true; // Lost the team
    }

    // WIN_NOW GMs have zero patience
    if (gmDirective === 'WIN_NOW' && wins < 5 && Math.random() < 0.50) {
        shouldFireCoach = true;
    }

    if (shouldFireCoach) {
        coach.teamId = null;
        coach.weeksUnemployed = 0;

        if (!Array.isArray(gameState?.availableStaff)) {
            if (gameState) gameState.availableStaff = [];
        }

        if (
            Array.isArray(gameState?.availableStaff) &&
            !gameState.availableStaff.some(
                candidate => String(candidate.id) === String(coach.id)
            )
        ) {
            gameState.availableStaff.push(coach);
        }

        if (coachSlot >= 0 && Array.isArray(team.coaches)) {
            team.coaches.splice(coachSlot, 1);
        }

        team.staff.coach = null;

        if (String(team.coach?.id) === String(coach.id)) {
            team.coach = null;
        }

        // HIRE REPLACEMENT: CONSTRAINED BY BUDGET, SCHEME FIT, TIER, & DIRECTIVES
        if (gameState?.availableStaff && gameState.availableStaff.length > 0) {
            const teamBalance = team.finances?.balance || 5.00;
            const teamTokens = team.socialProfile?.favorTokens || 0;
            const teamOffForm = team.formations?.offense || 'Balanced';

            // Comprehensive, nuanced candidate evaluation
            const affordableCandidates = gameState.availableStaff
                .filter(s =>
                    String(s.id) !== String(coach.id) &&
                    (s.role === 'coach' || s.formerPlayerBio)
                )
                .map(cand => {
                    // Reputation & Market Demand calculation
                    const rep = Math.round(((cand.ratings?.offSchemeMastery || 50) + (cand.ratings?.defSchemeMastery || 50) + (cand.ratings?.teaching || 50)) / 3);
                    const decay = Math.pow(cand.stubbornness || 0.75, cand.weeksUnemployed || 0);
                    const requiredStipend = Math.max(0, Math.round(Math.max(0, (rep - 52) * 0.45) * decay));
                    const requiredTokens = rep >= 75 && (cand.weeksUnemployed || 0) < 3 ? 1 : 0;

                    const canAfford = teamBalance >= requiredStipend && teamTokens >= requiredTokens;
                    
                    let fitScore = rep;
                    const tactical = cand.biases?.tactical?.name;
                    const personality = cand.biases?.personality?.name;

                    // 1. Scheme Alignment
                    if (['Spread', 'Empty', 'Trips', 'TripsLeft'].includes(teamOffForm) && tactical === 'Air Raid Purist') fitScore += 25;
                    if (['Power', 'Jumbo', 'Pistol'].includes(teamOffForm) && tactical === 'Smashmouth Zealot') fitScore += 25;

                    // 2. GM Directive Alignment
                    if (gmDirective === 'WIN_NOW' && (cand.ratings?.inGameAdjustments || 50) > 65) fitScore += 20;
                    if (gmDirective === 'DEVELOP_YOUTH' && (cand.ratings?.teaching || 50) > 65) fitScore += 22;
                    if (gmDirective === 'HARD_CONDITIONING' && personality === 'Old-School Disciplinarian') fitScore += 24;

                    // 3. League Tier Expectations
                    if (team.tier === 1 && rep >= 68) fitScore += 15; // Premier Parks expect proven tacticians
                    if (team.tier === 2 && (cand.ratings?.teaching || 50) >= 60) fitScore += 12; // Sandlot Circuit values development

                    // 4. Bargain Pouncing: Smart GMs spot elite coaches whose demands have decayed
                    if (decay < 0.70 && rep > 68) fitScore += 18;

                    return { cand, canAfford, requiredStipend, fitScore };
                })
                .filter(c => c.canAfford)
                .sort((a, b) => b.fitScore - a.fitScore);

            let newHire = null;
            if (affordableCandidates.length > 0) {
                const chosen = affordableCandidates[0];
                const idx = gameState.availableStaff.indexOf(chosen.cand);
                newHire = gameState.availableStaff.splice(idx, 1)[0];
                if (team.finances) team.finances.balance = Math.max(0, team.finances.balance - chosen.requiredStipend);
            } else {
                // Emergency volunteer: If the franchise is completely broke and cannot afford
                // anyone on the open market, a parent/rec volunteer steps in at $0 stipend
                newHire = generateStaffMember('coach', 28, 50);
            }

            if (newHire) {
                newHire.teamId = team.id;
                newHire.role = 'coach';

                if (!Array.isArray(team.coaches)) {
                    team.coaches = [];
                }

                const insertionIndex = coachSlot >= 0
                    ? Math.min(coachSlot, team.coaches.length)
                    : team.coaches.length;

                team.coaches.splice(insertionIndex, 0, newHire);

                // Transfer the outgoing coach's workload.
                const assignments = team.staffWorkPlan?.assignments;

                if (Array.isArray(assignments) && coach.id != null) {
                    assignments.forEach(assignment => {
                        if (
                            String(assignment.coachId) ===
                            String(coach.id)
                        ) {
                            assignment.coachId = String(newHire.id);
                        }
                    });
                }

                team.staff.coach = newHire;
                team.coach = newHire;
            }
        }
    }

    // Maintain the flexible coaching group instead of hiring
    // separate legacy Scout and Trainer positions.
    ensureTeamCoachingStaff(team);
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
    const tactical = coach?.biases?.tactical?.name || 'Balanced Tactician';
    const sit = team.gameplan.situational;

    let expectedRun = 50;
    let expectedDefAggro = 50;

    if (tactical === 'Smashmouth Zealot') expectedRun += 30;
    if (tactical === 'Air Raid Purist') expectedRun -= 30;
    if (tactical === 'Blitz Addict') expectedDefAggro += 35;
    if (tactical === 'Conservative Turtler') expectedDefAggro -= 25;

    const runDiff = Math.abs(sit.earlyDownTendency - expectedRun);
    const aggroDiff = Math.abs(sit.defenseAggressiveness - expectedDefAggro);

    // Minor deviations are ignored. Major philosophical clashes cause confusion.
    const totalClash = (runDiff + aggroDiff) / 2;
    if (totalClash <= 15) return 0; 

    // Max penalty is around -18 IQ for total philosophical opposites
    return Math.floor((totalClash - 15) * 0.35); 
}

export function previewCoachTendencies(coach, team) {
    const tactical = coach?.biases?.tactical?.name || 'Balanced Tactician';
    const personality = coach?.biases?.personality?.name || 'Balanced';
    const iq = coach?.ratings?.gameplanInstinct || 50;
    
    const roster = getRosterObjects(team);
    
    // Evaluate Offense (Calculate Best OVRs for QB, RB, WR)
    const qbs = roster.filter(p => isPlayerViableForPosition(p, 'QB')).map(p => calculateOverall(p, 'QB'));
    const rbs = roster.filter(p => isPlayerViableForPosition(p, 'RB')).map(p => calculateOverall(p, 'RB'));
    const wrs = roster.filter(p => isPlayerViableForPosition(p, 'WR')).map(p => calculateOverall(p, 'WR'));
    
    const qbOvr = qbs.sort((a,b) => b-a)[0] || 50;
    const rbOvr = rbs.sort((a,b) => b-a)[0] || 50;
    const wrOvr = wrs.sort((a,b) => b-a)[0] || 50;
    
    const passStrength = (qbOvr + wrOvr) / 2;
    const runStrength = rbOvr;
    const rosterRunPreference = runStrength - passStrength; // Positive = Better at running
    
    // Evaluate Defense
    const dbs = roster.filter(p => isPlayerViableForPosition(p, 'DB')).map(p => calculateOverall(p, 'DB'));
    const dbOvr = dbs.sort((a,b) => b-a)[0] || 50;
    const rosterBlitzPreference = dbOvr - 50; // Better DBs = Safer to blitz
    
    let earlyDownTendency = 50; // 0 = Heavy Pass, 100 = Heavy Run
    let thirdLongAggro = 50;    // 0 = Safe/Draws, 100 = Deep Bombs
    let fourthBravery = 50;     // 0 = Punt Always, 100 = Riverboat Gambler
    let defAggro = 50;          // 0 = Safe Zone/Prevent, 100 = House Fire Blitz
    
    // 1. Tactical Bias
    if (tactical === 'Smashmouth Zealot') earlyDownTendency += 25;
    if (tactical === 'Air Raid Purist') earlyDownTendency -= 25;
    if (tactical === 'Conservative Turtler') {
        thirdLongAggro -= 30;
        fourthBravery -= 30;
        defAggro -= 20;
    }
    if (tactical === 'Blitz Addict') {
        defAggro += 35;
        thirdLongAggro += 15;
    }
    
    // 2. Personality
    if (personality === "Peaked in '94") fourthBravery += 20;
    if (personality === "Old-School Disciplinarian") earlyDownTendency += 10;
    if (personality === "Analytical Savant") fourthBravery += 15; // Analytics say go for it
    
    // 3. Roster Adaptability (Scaled by IQ)
    const adaptability = iq / 100;
    const stubbornness = coach?.stubbornness || 0.75;
    
    // Blend bias with roster reality
    const targetRunTendency = 50 + (rosterRunPreference * 1.5);
    earlyDownTendency = (earlyDownTendency * stubbornness) + (targetRunTendency * adaptability);
    
    const targetDefAggro = 50 + (rosterBlitzPreference * 1.0);
    defAggro = (defAggro * stubbornness) + (targetDefAggro * adaptability);

    return {
        earlyDownTendency: Math.max(0, Math.min(100, Math.round(earlyDownTendency))),
        thirdAndLongAggressiveness: Math.max(0, Math.min(100, Math.round(thirdLongAggro))),
        fourthDownBravery: Math.max(0, Math.min(100, Math.round(fourthBravery))),
        defenseAggressiveness: Math.max(0, Math.min(100, Math.round(defAggro)))
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

    const offenseTactical =
        offenseCoach?.biases?.tactical?.name || 'Balanced Tactician';
    const defenseTactical =
        defenseCoach?.biases?.tactical?.name || 'Balanced Tactician';

    const offenseInstinct =
        offenseCoach?.ratings?.gameplanInstinct || 50;
    const defenseInstinct =
        defenseCoach?.ratings?.gameplanInstinct || 50;
    const currentOffForm = team.formations?.offense || 'Balanced';

    const allOffKeys = Object.keys(offensivePlaybook).filter(k => k !== 'Punt_Punt' && !['Uni_InsideZone', 'Uni_QuickSlants', 'Uni_FourVerts'].includes(k));
    const allDefKeys = Object.keys(defensivePlaybook).filter(k => k !== 'PuntReturn_Classic' && !['Cover_2_Zone_Base', 'Cover_1_Robber', 'GoalLine_RunStuff'].includes(k));

    // Score offensive plays based on Coach Bias + Roster Fit + GM Directive
    const scoredOff = allOffKeys.map(key => {
        const play = offensivePlaybook[key];
        let score = 50;

        if (offenseTactical === 'Air Raid Purist' && play.type === 'pass') score += 25;
        if (offenseTactical === 'Smashmouth Zealot' && play.type === 'run') score += 25;
        if (play.tags?.includes('pa') || play.tags?.includes('trick')) {
            score += offenseInstinct > 65 ? 15 : 5;
        }
        if (gmDirective === 'WIN_NOW' && opponent) {
            // Exploit opponent defensive style if coach has high gameplan instinct
            const oppDef = opponent.formations?.defense || '';
            if (oppDef.includes('4-2-2') && play.type === 'pass') score += 20; // Pass against run-heavy fronts
            if (oppDef.includes('3-0-5') && play.type === 'run') score += 20;  // Run against dime looks
        }

        return { key, score: score + Math.random() * 10 };
    }).sort((a, b) => b.score - a.score);

    // Score defensive schemes
    const scoredDef = allDefKeys.map(key => {
        const play = defensivePlaybook[key];
        let score = 50;

        if (defenseTactical === 'Blitz Addict' && play.blitz) score += 30;
        if (defenseTactical === 'Conservative Turtler' && !play.blitz) score += 20;

        if (gmDirective === 'WIN_NOW' && opponent) {
            const oppOff = opponent.formations?.offense || '';
            if (oppOff.includes('Spread') && play.concept === 'Zone') score += 20;
            if (oppOff.includes('Power') && play.concept === 'Run') score += 25;
        }

        return { key, score: score + Math.random() * 10 };
    }).sort((a, b) => b.score - a.score);

    team.gameplan.installedOffense = scoredOff.slice(0, 6).map(s => s.key);
    team.gameplan.installedDefense = scoredDef.slice(0, 4).map(s => s.key);
}

/**
 * AI Coach chooses weekly practice focus based on staff traits and GM Directives.
 */
export function aiChooseWeeklyPractice(team, opponent = null, gmDirective = 'COACH_AUTONOMY') {
    if (!team || !team.gameplan) return 'chalk_talk';

    const coach = getTeamCoachingSpecialist(team, 'training');
    const personality = coach?.biases?.personality?.name;
    const balance = team.finances?.balance || 0;
    const tokens = team.socialProfile?.favorTokens || 0;

    // Financial Awareness: If team is completely broke (< $3) and out of tokens,
    // pragmatic coaches sacrifice practice to run chores/mow lawns for cash
    if (balance < 3.00 && tokens === 0 && Math.random() < 0.45) {
        return 'hustle';
    }

    if (gmDirective === 'DEVELOP_YOUTH') return 'chalk_talk';
    if (gmDirective === 'HARD_CONDITIONING') return 'conditioning';
    if (gmDirective === 'WIN_NOW') return balance >= 2.00 ? 'scouting' : 'hustle';

    // Coach Autonomy
    if (personality === 'Old-School Disciplinarian') return 'conditioning';
    if (personality === 'Analytical Savant') return balance < 6.00 ? 'hustle' : 'chalk_talk';
    if (personality === "Players' Coach") return 'scrimmage';

    return Math.random() < 0.5 ? 'chalk_talk' : 'scouting';
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

    // Find major surplus positions and deficit positions
    const counts = {};
    positions.forEach(pos => {
        counts[pos] = roster.filter(p => isPlayerViableForPosition(p, pos)).length;
    });

    const deficits = positions.filter(pos => counts[pos] < idealCounts[pos]);
    if (deficits.length === 0) return; // Roster is balanced

    // Candidate pool: only young kids (age <= 15) who haven't changed positions recently
    const eligibleKids = roster.filter(p => 
        p.age <= 15 && 
        (!p.positionChangedYear || (gameState.year - p.positionChangedYear) >= 2) &&
        (p.personality?.ego || 50) < 70 // High ego divas refuse conversions
    );

    for (const targetPos of deficits) {
        // Find candidate from a surplus position who is viable at targetPos
        const bestCandidate = eligibleKids.find(kid => {
            const currentPos = kid.pos || estimateBestPosition(kid);
            const isSurplus = counts[currentPos] > idealCounts[currentPos];
            const isViableAtNew = isPlayerViableForPosition(kid, targetPos);
            const targetOvr = calculateOverall(kid, targetPos);
            const currentOvr = calculateOverall(kid, currentPos);

            // Personality-driven conversion willingness
            let threshold = currentOvr - 2;
            const personality = coach?.biases?.personality?.name;
            const ethic = kid.personality?.workEthic || 50;

            if (personality === 'Old-School Disciplinarian' && ethic >= 65) {
                threshold -= 4; // Disciplinarian demands hard workers fill voids even if raw
            } else if (personality === "Peaked in '94" && ['OL', 'DL'].includes(targetPos)) {
                const str = kid.attributes?.physical?.strength || 50;
                if (str >= 55) threshold -= 5; // Loves converting strong kids into linemen
            }

            return isSurplus && isViableAtNew && (targetOvr >= threshold);
        });

        if (bestCandidate) {
            const oldPos = bestCandidate.pos || estimateBestPosition(bestCandidate);
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
 */
export function processStaffMarketDecay(gameState) {
    if (!gameState?.availableStaff) return;

    gameState.availableStaff.forEach(staff => {
        staff.weeksUnemployed = (staff.weeksUnemployed || 0) + 1;
        const rep = Math.round(((staff.ratings?.offSchemeMastery || 50) + (staff.ratings?.defSchemeMastery || 50) + (staff.ratings?.teaching || 50)) / 3);
        const baseDemand = Math.max(0, Math.round((rep - 52) * 0.50));

        // Exponential stubbornness curve
        const decayMultiplier = Math.pow(staff.stubbornness || 0.75, staff.weeksUnemployed);
        staff.stipendDemand = Math.max(0, Math.round(baseDemand * decayMultiplier));
    });
}
