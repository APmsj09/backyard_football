// js/game/staff.js - Coaching, Scouting & Front Office System

import { getRandom, getRandomInt } from '../utils.js';
import { firstNames, lastNames } from '../data.js';

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

    return {
        id: crypto.randomUUID(),
        name: formerPlayer ? formerPlayer.name : `${firstName} ${lastName}`,
        age,
        role, // 'gm', 'coach', 'scout', 'trainer'
        teamId: null,
        formerPlayerId: formerPlayer?.id || null,
        formerPlayerBio: formerPlayer ? `Former ${formerPlayer.pos} legend (${formerPlayer.careerStats?.touchdowns || 0} TDs, ${formerPlayer.careerStats?.seasonsPlayed || 0} yrs played)` : null,
        ratings: {
            // Tactical Acumen
            offSchemeMastery: formerPlayer?.pos === 'QB' ? getRandomInt(65, 85) : baseVal(),
            defSchemeMastery: ['DL', 'LB', 'DB'].includes(formerPlayer?.pos) ? getRandomInt(65, 85) : baseVal(),
            inGameAdjustments: baseVal(),
            clockIQ: baseVal(),

            // Evaluation (Scouting)
            evalPhysicals: baseVal(),
            evalTechnique: formerPlayer ? getRandomInt(60, 80) : baseVal(),
            evalCharacter: baseVal(),

            // Leadership & Development
            teaching: formerPlayer?.attributes?.mental?.playbookIQ ? Math.min(95, formerPlayer.attributes.mental.playbookIQ + 5) : baseVal(),
            conditioning: baseVal(),
            authority: formerPlayer ? 45 : getRandomInt(50, 80) // Young ex-players start with raw authority
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
    Object.values(team.staff).forEach(s => { if (s) s.teamId = team.id; });
    team.coach = team.staff.coach;
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
    const losses = team.losses || 0;
    let shouldFireCoach = false;

    // Tier 1 has high standards: Relegated or < 3 wins = Fired
    if (team.tier === 1 && (wins <= 2 || team.relegatedThisYear)) {
        shouldFireCoach = true;
    }
    // Tier 2 losing season check
    else if (team.tier === 2 && wins <= 1) {
        shouldFireCoach = Math.random() < 0.60;
    }

    if (shouldFireCoach) {
        coach.teamId = null;
        if (gameState?.availableStaff) gameState.availableStaff.push(coach);
        team.staff.coach = null;

        // Hire best fitting available replacement
        if (gameState?.availableStaff && gameState.availableStaff.length > 0) {
            // Find coach with highest scheme mastery (safely default to 0 for scouts/trainers)
            gameState.availableStaff.sort((a, b) => {
                const aScore = (a.ratings?.offSchemeMastery || 0) + (a.ratings?.defSchemeMastery || 0);
                const bScore = (b.ratings?.offSchemeMastery || 0) + (b.ratings?.defSchemeMastery || 0);
                return bScore - aScore;
            });
            const candidateIdx = gameState.availableStaff.findIndex(s => s.role === 'coach' || s.formerPlayerBio);
            if (candidateIdx > -1) {
                const newHire = gameState.availableStaff.splice(candidateIdx, 1)[0];
                newHire.teamId = team.id;
                newHire.role = 'coach';
                team.staff.coach = newHire;
                team.coach = newHire; // Sync legacy pointer
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