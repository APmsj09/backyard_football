// js/game/staff.js - Coaching, Scouting & Front Office System

import { getRandom, getRandomInt } from '../utils.js';
import { firstNames, lastNames, offensivePlaybook, defensivePlaybook } from '../data.js';
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

    team.staff = {
        gm: generateStaffMember('gm', 35, 60),
        coach: generateStaffMember('coach', 30, 55),
        scout: generateStaffMember('scout', 20, 50),
        trainer: generateStaffMember('trainer', 28, 55)
    };

    Object.values(team.staff).forEach(s => {
        if (s) s.teamId = team.id;
    });

    team.coach = team.staff.coach;

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

/**
 * Creates the flexible coaching group while preserving legacy staff references.
 *
 * Main teams receive three staff coaches. The player-controlled team also
 * receives a user-coach profile, representing the player's coaching time.
 */
export function ensureTeamCoachingStaff(team) {
    if (!team) return [];

    const candidates = [
        ...(Array.isArray(team.coaches) ? team.coaches : []),
        team.staff?.coach,
        team.staff?.scout,
        team.staff?.trainer,
        team.coach
    ];

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
        const defaultScout = team.staff?.scout ||
            coaches.find(coach => !coach.isUserCoach);

        plan = {
            version: 1,
            weeklyHoursPerCoach: WEEKLY_COACH_HOURS,
            assignments: defaultScout?.id
                ? [{
                    coachId: defaultScout.id,
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

    if (task === 'scouting') {
        return (
            rating('evalPhysicals') +
            rating('evalTechnique') +
            rating('evalCharacter')
        ) / 3;
    }

    if (task === 'offensePrep') {
        return (
            rating('offSchemeMastery') +
            rating('gameplanInstinct') +
            rating('inGameAdjustments')
        ) / 3;
    }

    return (
        rating('defSchemeMastery') +
        rating('gameplanInstinct') +
        rating('inGameAdjustments')
    ) / 3;
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

    const specialties = [
        {
            task: 'scouting',
            trainingFocus: getAiTrainingFocus(team)
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

        assignments.push({
            coachId: coach.id,
            task: specialty.task,
            hours: 16,
            ...(specialty.task === 'scouting'
                ? { focus: 'all', maxTargets: 4 }
                : {})
        });

        assignments.push({
            coachId: coach.id,
            task: 'training',
            hours: 24,
            focus: specialty.trainingFocus,
            maxTargets: 6
        });
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
    const roles = ['coach', 'scout', 'trainer', 'gm'];
    const pool = [];
    for (let i = 0; i < count; i++) {
        pool.push(generateStaffMember(getRandom(roles)));
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
    if (!team || team.isPlayerControlled || !team.staff) return;

    const coach = team.staff.coach;
    if (!coach) return;

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
        if (gameState?.availableStaff) gameState.availableStaff.push(coach);
        team.staff.coach = null;

        // HIRE REPLACEMENT: CONSTRAINED BY BUDGET, SCHEME FIT, TIER, & DIRECTIVES
        if (gameState?.availableStaff && gameState.availableStaff.length > 0) {
            const teamBalance = team.finances?.balance || 5.00;
            const teamTokens = team.socialProfile?.favorTokens || 0;
            const teamOffForm = team.formations?.offense || 'Balanced';

            // Comprehensive, nuanced candidate evaluation
            const affordableCandidates = gameState.availableStaff
                .filter(s => s.role === 'coach' || s.formerPlayerBio)
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
                team.staff.coach = newHire;
                team.coach = newHire;
            }
        }
    }

    // Fill vacant Scout or Trainer slots from pool
    ['scout', 'trainer'].forEach(role => {
        if (!team.staff[role] && gameState?.availableStaff?.length > 0) {
            const idx = gameState.availableStaff.findIndex(s => s.role === role);
            if (idx > -1) {
                const hire = gameState.availableStaff.splice(idx, 1)[0];
                hire.teamId = team.id;
                hire.role = role;
                team.staff[role] = hire;
            }
        }
    });
}

export function calculateSchemeClash(team) {
    if (!team || !team.gameplan || !team.gameplan.situational) return 0;
    if (team.gameplan.situational.playcaller !== 'GM') return 0;

    const coach = team.staff?.coach || team.coach;
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

    const coach = team.staff?.coach;
    const tactical = coach?.biases?.tactical?.name || 'Balanced Tactician';
    const instinct = coach?.ratings?.gameplanInstinct || 50;
    const currentOffForm = team.formations?.offense || 'Balanced';

    const allOffKeys = Object.keys(offensivePlaybook).filter(k => k !== 'Punt_Punt' && !['Uni_InsideZone', 'Uni_QuickSlants', 'Uni_FourVerts'].includes(k));
    const allDefKeys = Object.keys(defensivePlaybook).filter(k => k !== 'PuntReturn_Classic' && !['Cover_2_Zone_Base', 'Cover_1_Robber', 'GoalLine_RunStuff'].includes(k));

    // Score offensive plays based on Coach Bias + Roster Fit + GM Directive
    const scoredOff = allOffKeys.map(key => {
        const play = offensivePlaybook[key];
        let score = 50;

        if (tactical === 'Air Raid Purist' && play.type === 'pass') score += 25;
        if (tactical === 'Smashmouth Zealot' && play.type === 'run') score += 25;
        if (play.tags?.includes('pa') || play.tags?.includes('trick')) score += (instinct > 65 ? 15 : 5);

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

        if (tactical === 'Blitz Addict' && play.blitz) score += 30;
        if (tactical === 'Conservative Turtler' && !play.blitz) score += 20;

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

    const coach = team.staff?.coach;
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

    const coach = team.staff?.coach || team.coach;
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
