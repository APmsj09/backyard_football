// js/game/player.js - Player Generation & Rating System

import { getRandom, getRandomInt } from '../utils.js';
import { firstNames, lastNames, nicknames, offenseFormations, defenseFormations, cliques } from '../data.js';

const offensivePositions = ['QB', 'RB', 'WR', 'TE', 'OL'];
const defensivePositions = ['DL', 'LB', 'DB'];

export const positionOverallWeights = {
    // Give QBs more weight to pure throwing accuracy and mobility
    QB: {
        throwingAccuracy: 0.42,
        playbookIQ: 0.20,
        decisionMaking: 0.13,
        speed: 0.10,
        consistency: 0.10,
        strength: 0.05
    },

    // Skill positions
    RB: { speed: 0.35, agility: 0.25, strength: 0.15, catchingHands: 0.15, toughness: 0.10 },
    WR: { speed: 0.40, catchingHands: 0.35, agility: 0.20, playbookIQ: 0.05 },
    TE: { catchingHands: 0.30, blocking: 0.30, strength: 0.25, speed: 0.15 },

    // Spread OL across technique and pass/run blocking instincts so pure weight/strength doesn't break it
    OL: { strength: 0.35, blocking: 0.40, playbookIQ: 0.15, weight: 0.05, toughness: 0.05 },
    DL: { strength: 0.35, blockShedding: 0.35, tackling: 0.20, speed: 0.10 },
    LB: { tackling: 0.30, playbookIQ: 0.25, speed: 0.25, blockShedding: 0.20 },
    DB: { speed: 0.35, coverage: 0.35, agility: 0.20, catchingHands: 0.10 }
};

export function estimateBestPosition(scoutedPlayer) {
    if (!scoutedPlayer || !scoutedPlayer.attributes) return 'UTIL';

    const resolveAttr = (val) => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
            if (val.includes('-')) {
                const [min, max] = val.split('-').map(Number);
                return (min + max) / 2;
            }
            const parsed = Number(val);
            return isNaN(parsed) ? 50 : parsed;
        }
        return 50;
    };

    const attrs = scoutedPlayer.attributes;
    const speed = resolveAttr(attrs.physical?.speed);
    const weight = resolveAttr(attrs.physical?.weight);
    const throwing = resolveAttr(attrs.technical?.throwingAccuracy);

    let bestPos = 'UTIL';
    let highestScore = -Infinity;

    const allPositions = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'];

    // Start with the player's actual offensive/defensive identity.
    // Then allow only natural backyard-football conversions.
    const candidatePositions = new Set([
        scoutedPlayer.pos,
        scoutedPlayer.favoriteOffensivePosition,
        scoutedPlayer.favoriteDefensivePosition
    ].filter(pos => allPositions.includes(pos)));

    // If an explicit position has been chosen/assigned, honor it as the top candidate
    if (scoutedPlayer.pos && allPositions.includes(scoutedPlayer.pos)) {
        candidatePositions.add(scoutedPlayer.pos);
    }

    // Natural cross-training / two-way conversions.
    // These are possibilities, not automatic position changes.
    if (
        scoutedPlayer.favoriteOffensivePosition === 'TE' ||
        scoutedPlayer.favoriteDefensivePosition === 'DL'
    ) {
        candidatePositions.add('OL');
    }

    if (
        scoutedPlayer.favoriteOffensivePosition === 'OL' ||
        scoutedPlayer.favoriteDefensivePosition === 'LB'
    ) {
        candidatePositions.add('DL');
    }

    if (scoutedPlayer.favoriteOffensivePosition === 'WR') {
        candidatePositions.add('TE');
    }

    if (scoutedPlayer.favoriteOffensivePosition === 'RB') {
        candidatePositions.add('WR');
    }

    if (scoutedPlayer.favoriteDefensivePosition === 'DB') {
        candidatePositions.add('WR');
    }

    if (scoutedPlayer.favoriteDefensivePosition === 'LB') {
        candidatePositions.add('DB');
    }

    // Safety fallback for legacy/malformed players.
    if (candidatePositions.size === 0) {
        allPositions.forEach(pos => candidatePositions.add(pos));
    }

    candidatePositions.forEach(pos => {
        let score = calculateOverall(scoutedPlayer, pos);

        const isAssignedPos = pos === scoutedPlayer.pos;
        const isIdentityPosition =
            isAssignedPos ||
            pos === scoutedPlayer.favoriteOffensivePosition ||
            pos === scoutedPlayer.favoriteDefensivePosition;

        // Assigned position has highest priority; identity gets second priority
        if (isAssignedPos) {
            score += 15; // Strongly locks in manual switch
        } else if (isIdentityPosition) {
            score += 3;
        } else {
            score -= 8;
        }

        // --- GATEKEEPER SANITY RULES ---

        // 1. Cannot be a QB without legitimate throwing skill.
        if (pos === 'QB') {
            if (throwing < 45) score -= 40;
            if (throwing < 35) score = 0;
        }

        // 2. Heavy players (>220 lbs) are poor WR/DB fits,
        //    but can still become useful trench players.
        if (weight > 220) {
            if (pos === 'WR' || pos === 'DB') score -= 25;
            if (pos === 'OL' || pos === 'DL') score += 5;
        }

        // 3. Very light players cannot realistically become OL.
        if (weight < 155 && pos === 'OL') {
            score -= 30;
        }

        // 4. Slow players are poor WR/DB candidates.
        if (speed < 45 && (pos === 'WR' || pos === 'DB')) {
            score -= 20;
        }

        if (score > highestScore) {
            highestScore = score;
            bestPos = pos;
        }
    });

    return bestPos;
}

export function calculateOverall(player, position) {
    if (!player || !player.attributes) return 0;
    const attrs = player.attributes;
    const relevantWeights = positionOverallWeights[position];
    if (!relevantWeights) return 0;

    let score = 0;
    for (const category in attrs) {
        for (const attr in attrs[category]) {
            const weightKey = attr === 'passCoverage' ? 'coverage' : attr;

            if (relevantWeights[weightKey]) {
                let value = attrs[category][attr];

                if (weightKey === 'weight') {
                    // Old: Math.max(0, Math.min(100, (value - 120) * 0.5 + 30));
                    // New: Normalize weight on a gentler curve
                    value = Math.max(20, Math.min(85, (value - 120) * 0.35 + 35));
                }
                if (weightKey === 'height') {
                    value = Math.max(0, Math.min(100, (value - 50) * 4));
                }

                if (typeof value === 'number') {
                    score += value * relevantWeights[weightKey];
                }
            }
        }
    }
    return Math.min(99, Math.max(1, Math.round(score)));
}

export function calculateSlotSuitability(player, slot, side, team) {
    if (!player || !player.attributes || !team || !team.formations || !team.formations[side]) return 0;
    const formationName = team.formations[side];
    const formationData = side === 'offense' ? offenseFormations[formationName] : defenseFormations[formationName];
    const basePosition = slot.replace(/\d/g, '');

    if (!formationData?.slotPriorities?.[slot]) {
        return calculateOverall(player, basePosition);
    }

    const priorities = formationData.slotPriorities[slot];
    let score = 0;
    let totalWeight = 0;

    for (const attr in priorities) {
        for (const category in player.attributes) {
            const actualAttr = (attr === 'coverage' && player.attributes[category]?.passCoverage !== undefined) ? 'passCoverage' : attr;

            if (player.attributes[category]?.[actualAttr] !== undefined) {
                let value = player.attributes[category][actualAttr];
                if (typeof value !== 'number') continue;

                if (attr === 'weight') value = Math.max(0, Math.min(100, (value - 100) * 0.66 + 40));
                if (attr === 'height') value = Math.max(0, Math.min(100, (value - 50) * 4));

                score += value * priorities[attr];
                totalWeight += priorities[attr];
                break;
            }
        }
    }

    return totalWeight > 0
        ? Math.min(99, Math.max(1, Math.round(score / totalWeight)))
        : calculateOverall(player, basePosition);
}

const archetypes = [
    // --- SIGNAL CALLERS ---
    { name: 'Field General', off: 'QB', def: 'LB', weightMod: 1.1, heightMod: 2, keyAttrs: ['playbookIQ', 'decisionMaking', 'throwingAccuracy', 'consistency', 'tackling'], speedMod: 0.85, strMod: 1.0 },
    { name: 'Scrambler', off: 'QB', def: 'DB', weightMod: 0.95, heightMod: -1, keyAttrs: ['speed', 'agility', 'throwingAccuracy', 'stamina'], speedMod: 1.2, strMod: 0.85 },
    { name: 'Gunslinger', off: 'QB', def: 'DB', weightMod: 1.05, heightMod: 3, keyAttrs: ['throwingAccuracy', 'strength', 'clutch', 'playbookIQ'], speedMod: 0.9, strMod: 1.25 },
    { name: 'Heavy Crusher QB', off: 'QB', def: 'DL', weightMod: 1.4, heightMod: 4, keyAttrs: ['strength', 'throwingAccuracy', 'toughness', 'blockShedding'], speedMod: 0.65, strMod: 1.3 },
    { name: 'Game Manager', off: 'QB', def: 'DB', weightMod: 1.0, heightMod: 0, keyAttrs: ['playbookIQ', 'decisionMaking', 'consistency', 'throwingAccuracy', 'coverage'], speedMod: 0.9, strMod: 0.9 },
    { name: 'Dual-Threat', off: 'QB', def: 'DB', weightMod: 1.0, heightMod: 1, keyAttrs: ['speed', 'throwingAccuracy', 'agility', 'stamina'], speedMod: 1.15, strMod: 1.0 },
    { name: 'Backyard Magician', off: 'QB', def: 'DB', weightMod: 0.9, heightMod: -1, keyAttrs: ['agility', 'clutch', 'throwingAccuracy', 'speed'], speedMod: 1.1, strMod: 0.95 },
    { name: 'Cannon Arm', off: 'QB', def: 'DL', weightMod: 1.1, heightMod: 2, keyAttrs: ['strength', 'throwingAccuracy', 'tackling'], speedMod: 0.8, strMod: 1.3 },

    // --- BALL CARRIERS ---
    { name: 'Power Back', off: 'RB', def: 'LB', weightMod: 1.25, heightMod: -1, keyAttrs: ['strength', 'toughness', 'tackling', 'stamina'], speedMod: 0.9, strMod: 1.2 },
    { name: 'Speed Back', off: 'RB', def: 'DB', weightMod: 0.85, heightMod: -2, keyAttrs: ['speed', 'agility', 'clutch', 'catchingHands'], speedMod: 1.25, strMod: 0.75 },
    { name: 'Workhorse', off: 'RB', def: 'LB', weightMod: 1.1, heightMod: 0, keyAttrs: ['stamina', 'consistency', 'tackling', 'toughness'], speedMod: 1.0, strMod: 1.0 },
    { name: 'Receiving Back', off: 'RB', def: 'DB', weightMod: 0.9, heightMod: -1, keyAttrs: ['catchingHands', 'agility', 'speed', 'coverage'], speedMod: 1.1, strMod: 0.8 },
    { name: 'Bruiser', off: 'RB', def: 'DL', weightMod: 1.4, heightMod: 0, keyAttrs: ['strength', 'toughness', 'stamina', 'blocking'], speedMod: 0.75, strMod: 1.3 },
    { name: 'Third-Down Back', off: 'RB', def: 'DB', weightMod: 0.95, heightMod: 0, keyAttrs: ['blocking', 'catchingHands', 'playbookIQ', 'agility'], speedMod: 1.0, strMod: 0.9 },
    { name: 'Change-of-Pace', off: 'RB', def: 'DB', weightMod: 0.8, heightMod: -3, keyAttrs: ['speed', 'agility', 'clutch'], speedMod: 1.3, strMod: 0.6 },
    { name: 'Slashing Back', off: 'RB', def: 'LB', weightMod: 1.0, heightMod: 0, keyAttrs: ['agility', 'speed', 'playbookIQ', 'consistency'], speedMod: 1.1, strMod: 1.0 },

    // --- PASS CATCHERS ---
    { name: 'Deep Threat', off: 'WR', def: 'DB', weightMod: 0.85, heightMod: 1, keyAttrs: ['speed', 'agility', 'clutch', 'coverage'], speedMod: 1.3, strMod: 0.7 },
    { name: 'Route Technician', off: 'WR', def: 'DB', weightMod: 1.0, heightMod: 0, keyAttrs: ['agility', 'playbookIQ', 'catchingHands', 'consistency'], speedMod: 1.0, strMod: 1.0 },
    { name: 'Red Zone Specialist', off: 'WR', def: 'LB', weightMod: 1.15, heightMod: 7, keyAttrs: ['height', 'catchingHands', 'strength', 'clutch'], speedMod: 0.8, strMod: 1.15 },
    { name: 'Slot Brawler', off: 'WR', def: 'LB', weightMod: 1.1, heightMod: 0, keyAttrs: ['toughness', 'catchingHands', 'tackling', 'strength'], speedMod: 0.95, strMod: 1.1 },
    { name: 'Possession Receiver', off: 'WR', def: 'LB', weightMod: 1.1, heightMod: 2, keyAttrs: ['catchingHands', 'toughness', 'clutch', 'strength'], speedMod: 0.85, strMod: 1.1 },
    { name: 'Gadget Player', off: 'WR', def: 'DB', weightMod: 0.8, heightMod: -2, keyAttrs: ['agility', 'speed', 'catchingHands', 'playbookIQ'], speedMod: 1.25, strMod: 0.7 },
    { name: 'Jump Ball Specialist', off: 'WR', def: 'DB', weightMod: 1.05, heightMod: 6, keyAttrs: ['height', 'catchingHands', 'clutch', 'strength'], speedMod: 0.95, strMod: 1.0 },

    // --- TIGHT ENDS ---
    { name: 'Vertical TE', off: 'TE', def: 'LB', weightMod: 1.3, heightMod: 5, keyAttrs: ['speed', 'catchingHands', 'height', 'playbookIQ'], speedMod: 0.9, strMod: 1.1 },
    { name: 'Jumbo Athlete', off: 'TE', def: 'DL', weightMod: 1.5, heightMod: 4, keyAttrs: ['strength', 'blocking', 'catchingHands', 'blockShedding'], speedMod: 0.75, strMod: 1.3 },
    { name: 'Lead Blocker TE', off: 'TE', def: 'LB', weightMod: 1.4, heightMod: 1, keyAttrs: ['blocking', 'strength', 'tackling', 'toughness'], speedMod: 0.8, strMod: 1.25 },
    { name: 'Hybrid Wing', off: 'TE', def: 'DB', weightMod: 1.15, heightMod: 3, keyAttrs: ['agility', 'catchingHands', 'coverage', 'speed'], speedMod: 1.0, strMod: 0.95 },
    { name: 'Move TE', off: 'TE', def: 'DB', weightMod: 1.1, heightMod: 2, keyAttrs: ['speed', 'agility', 'catchingHands', 'playbookIQ'], speedMod: 1.1, strMod: 0.9 },
    { name: 'Extra Lineman', off: 'TE', def: 'DL', weightMod: 1.5, heightMod: 2, keyAttrs: ['blocking', 'strength', 'toughness', 'tackling'], speedMod: 0.6, strMod: 1.3 },
    { name: 'H-Back', off: 'TE', def: 'LB', weightMod: 1.2, heightMod: -1, keyAttrs: ['blocking', 'strength', 'speed', 'agility'], speedMod: 0.95, strMod: 1.1 },

    // --- OFFENSIVE LINE ---
    { name: 'Road Grader', off: 'OL', def: 'DL', weightMod: 1.9, heightMod: 2, keyAttrs: ['strength', 'blocking', 'weight', 'toughness'], speedMod: 0.45, strMod: 1.5 },
    { name: 'Mobile Guard', off: 'OL', def: 'LB', weightMod: 1.4, heightMod: 1, keyAttrs: ['agility', 'blocking', 'playbookIQ', 'tackling'], speedMod: 0.8, strMod: 1.1 },
    { name: 'Wall Protector', off: 'OL', def: 'DL', weightMod: 1.6, heightMod: 6, keyAttrs: ['blocking', 'height', 'strength', 'consistency'], speedMod: 0.6, strMod: 1.2 },
    { name: 'Technician OL', off: 'OL', def: 'DL', weightMod: 1.5, heightMod: 3, keyAttrs: ['playbookIQ', 'blocking', 'consistency', 'blockShedding'], speedMod: 0.7, strMod: 1.1 },
    { name: 'Mauler', off: 'OL', def: 'DL', weightMod: 2.0, heightMod: 1, keyAttrs: ['strength', 'blocking', 'toughness', 'weight'], speedMod: 0.4, strMod: 1.5 },
    { name: 'Athletic Tackle', off: 'OL', def: 'DL', weightMod: 1.3, heightMod: 4, keyAttrs: ['agility', 'blocking', 'speed', 'stamina'], speedMod: 0.9, strMod: 1.1 },
    { name: 'Center/General', off: 'OL', def: 'LB', weightMod: 1.4, heightMod: 0, keyAttrs: ['playbookIQ', 'blocking', 'consistency', 'toughness'], speedMod: 0.7, strMod: 1.1 },

    // --- DEFENSIVE LINE ---
    { name: 'Speed Rusher', off: 'OL', def: 'DL', weightMod: 1.25, heightMod: 4, keyAttrs: ['speed', 'blockShedding', 'agility', 'clutch'], speedMod: 1.05, strMod: 1.05 },
    { name: 'Run Stuffer', off: 'TE', def: 'DL', weightMod: 1.7, heightMod: 1, keyAttrs: ['strength', 'tackling', 'weight', 'toughness'], speedMod: 0.55, strMod: 1.4 },
    { name: 'Bull Rusher', off: 'OL', def: 'DL', weightMod: 1.6, heightMod: 2, keyAttrs: ['strength', 'blockShedding', 'toughness', 'blocking'], speedMod: 0.7, strMod: 1.35 },
    { name: 'Versatile End', off: 'TE', def: 'DL', weightMod: 1.4, heightMod: 4, keyAttrs: ['blockShedding', 'tackling', 'playbookIQ', 'strength'], speedMod: 0.85, strMod: 1.2 },
    { name: 'Nose Tackle', off: 'OL', def: 'DL', weightMod: 2.2, heightMod: 0, keyAttrs: ['weight', 'strength', 'tackling', 'toughness'], speedMod: 0.3, strMod: 1.6 },
    { name: 'Edge Setter', off: 'TE', def: 'DL', weightMod: 1.3, heightMod: 2, keyAttrs: ['strength', 'tackling', 'playbookIQ', 'blocking'], speedMod: 0.8, strMod: 1.2 },
    { name: 'Pass Rush Specialist', off: 'WR', def: 'DL', weightMod: 1.0, heightMod: 1, keyAttrs: ['speed', 'blockShedding', 'agility', 'stamina'], speedMod: 1.2, strMod: 0.9 },

    // --- LINEBACKERS ---
    { name: 'Middle Hawk', off: 'RB', def: 'LB', weightMod: 1.15, heightMod: 1, keyAttrs: ['playbookIQ', 'tackling', 'coverage', 'speed'], speedMod: 1.0, strMod: 1.0 },
    { name: 'Hard Hitter', off: 'RB', def: 'LB', weightMod: 1.3, heightMod: 0, keyAttrs: ['tackling', 'strength', 'toughness', 'clutch'], speedMod: 0.9, strMod: 1.25 },
    { name: 'Blitz Specialist', off: 'WR', def: 'LB', weightMod: 1.1, heightMod: 2, keyAttrs: ['speed', 'blockShedding', 'tackling', 'agility'], speedMod: 1.15, strMod: 1.05 },
    { name: 'Coverage LB', off: 'TE', def: 'LB', weightMod: 1.05, heightMod: 3, keyAttrs: ['coverage', 'agility', 'playbookIQ', 'catchingHands'], speedMod: 1.05, strMod: 0.95 },
    { name: 'Sideline-to-Sideline', off: 'RB', def: 'LB', weightMod: 0.95, heightMod: 0, keyAttrs: ['speed', 'agility', 'tackling', 'stamina'], speedMod: 1.2, strMod: 0.9 },
    { name: 'Thumper', off: 'OL', def: 'LB', weightMod: 1.4, heightMod: -1, keyAttrs: ['tackling', 'strength', 'toughness', 'blocking'], speedMod: 0.7, strMod: 1.3 },
    { name: 'Hybrid Safety', off: 'WR', def: 'LB', weightMod: 0.9, heightMod: 1, keyAttrs: ['coverage', 'speed', 'tackling', 'agility'], speedMod: 1.15, strMod: 0.85 },

    // --- SECONDARY ---
    { name: 'Island Corner', off: 'WR', def: 'DB', weightMod: 0.85, heightMod: 0, keyAttrs: ['coverage', 'speed', 'agility', 'consistency'], speedMod: 1.3, strMod: 0.8 },
    { name: 'Ballhawk Safety', off: 'WR', def: 'DB', weightMod: 0.95, heightMod: 2, keyAttrs: ['catchingHands', 'playbookIQ', 'coverage', 'clutch'], speedMod: 1.1, strMod: 0.9 },
    { name: 'Nickel Stopper', off: 'RB', def: 'DB', weightMod: 1.05, heightMod: -1, keyAttrs: ['tackling', 'agility', 'speed', 'toughness'], speedMod: 1.1, strMod: 1.1 },
    { name: 'Zone Specialist', off: 'WR', def: 'DB', weightMod: 1.0, heightMod: 3, keyAttrs: ['playbookIQ', 'coverage', 'height', 'catchingHands'], speedMod: 0.95, strMod: 1.0 },
    { name: 'Press Corner', off: 'WR', def: 'DB', weightMod: 1.1, heightMod: 2, keyAttrs: ['strength', 'coverage', 'toughness', 'speed'], speedMod: 1.0, strMod: 1.2 },
    { name: 'Box Safety', off: 'RB', def: 'DB', weightMod: 1.15, heightMod: 0, keyAttrs: ['tackling', 'strength', 'playbookIQ', 'toughness'], speedMod: 0.9, strMod: 1.1 },
    { name: 'Free Safety', off: 'WR', def: 'DB', weightMod: 0.9, heightMod: 1, keyAttrs: ['speed', 'coverage', 'playbookIQ', 'agility'], speedMod: 1.15, strMod: 0.85 }
];

// Targeted signature boosts for specific archetypes
const archetypeBoosts = {
    // 🔥 BOOSTED QB & RB STATS SO THEY CAN ACTUALLY THROW/RUN EFFECTIVELY
    'Field General': { playbookIQ: 15, throwingAccuracy: 18 },
    'Scrambler': { speed: 12, agility: 12, throwingAccuracy: 10 },
    'Gunslinger': { throwingAccuracy: 15, strength: 12 },
    'Heavy Crusher QB': { strength: 12, toughness: 10, throwingAccuracy: 8 },
    'Game Manager': { playbookIQ: 12, consistency: 15, throwingAccuracy: 8 },
    'Dual-Threat': { speed: 8, agility: 8, throwingAccuracy: 10 },
    'Backyard Magician': { agility: 15, clutch: 12, throwingAccuracy: 10 },
    'Cannon Arm': { strength: 18, throwingAccuracy: 8 },

    'Power Back': { strength: 12, toughness: 10, speed: 6 },
    'Speed Back': { speed: 15, agility: 12 },
    'Workhorse': { stamina: 15, consistency: 12, speed: 5 },
    'Receiving Back': { catchingHands: 12, agility: 10, speed: 8 },
    'Bruiser': { strength: 12, toughness: 12, stamina: 5 },
    'Third-Down Back': { blocking: 10, catchingHands: 10, playbookIQ: 5 },
    'Change-of-Pace': { speed: 10, agility: 12 },
    'Slashing Back': { agility: 10, speed: 8, playbookIQ: 5 },

    'Deep Threat': { speed: 8, agility: 5 },
    'Route Technician': { agility: 7, playbookIQ: 5 },
    'Red Zone Specialist': { catchingHands: 7, strength: 5 },
    'Slot Brawler': { toughness: 6, catchingHands: 5 },
    'Possession Receiver': { catchingHands: 12, clutch: 10, toughness: 5 },
    'Gadget Player': { agility: 12, speed: 8 },
    'Jump Ball Specialist': { catchingHands: 12, clutch: 8 },

    'Vertical TE': { speed: 6, catchingHands: 6 },
    'Jumbo Athlete': { strength: 7, blocking: 6 },
    'Lead Blocker TE': { blocking: 8, strength: 6 },
    'Hybrid Wing': { agility: 6, catchingHands: 6 },
    'Move TE': { speed: 8, catchingHands: 8 },
    'Extra Lineman': { blocking: 15, strength: 10 },
    'H-Back': { blocking: 10, speed: 6, strength: 5 },

    'Road Grader': { strength: 8, blocking: 7 },
    'Mobile Guard': { agility: 7, blocking: 5 },
    'Wall Protector': { blocking: 8, consistency: 5 },
    'Technician OL': { playbookIQ: 7, blocking: 6 },
    'Mauler': { strength: 15, blocking: 10 },
    'Athletic Tackle': { agility: 12, blocking: 8 },
    'Center/General': { playbookIQ: 15, blocking: 8 },

    'Speed Rusher': { speed: 7, blockShedding: 6 },
    'Run Stuffer': { strength: 8, tackling: 6 },
    'Bull Rusher': { strength: 8, blockShedding: 6 },
    'Versatile End': { blockShedding: 6, tackling: 6 },
    'Nose Tackle': { strength: 15, tackling: 10 },
    'Edge Setter': { tackling: 12, strength: 8 },
    'Pass Rush Specialist': { blockShedding: 12, speed: 10 },

    'Middle Hawk': { playbookIQ: 7, tackling: 6 },
    'Hard Hitter': { tackling: 7, toughness: 6 },
    'Blitz Specialist': { speed: 6, blockShedding: 6 },
    'Coverage LB': { coverage: 7, playbookIQ: 5 },
    'Sideline-to-Sideline': { speed: 12, tackling: 8 },
    'Thumper': { tackling: 15, strength: 10 },
    'Hybrid Safety': { coverage: 10, speed: 8 },

    'Island Corner': { coverage: 8, speed: 6 },
    'Ballhawk Safety': { catchingHands: 6, playbookIQ: 6 },
    'Nickel Stopper': { tackling: 6, agility: 6 },
    'Zone Specialist': { playbookIQ: 7, coverage: 6 },
    'Press Corner': { strength: 10, coverage: 10 },
    'Box Safety': { tackling: 12, strength: 8 },
    'Free Safety': { coverage: 12, playbookIQ: 8 }
};

export function gaussianRandom(mean = 0, stdev = 1) {
    const u = 1 - Math.random();
    const v = Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return z * stdev + mean;
}

export function generateDraftClassModifiers() {
    return {
        overallShift: Math.round(gaussianRandom(0, 3)),
        positionShifts: {
            QB: Math.round(gaussianRandom(0, 4)),
            RB: Math.round(gaussianRandom(0, 4)),
            WR: Math.round(gaussianRandom(0, 4)),
            TE: Math.round(gaussianRandom(0, 4)),
            OL: Math.round(gaussianRandom(0, 4)),
            DL: Math.round(gaussianRandom(0, 4)),
            LB: Math.round(gaussianRandom(0, 4)),
            DB: Math.round(gaussianRandom(0, 4))
        }
    };
}

export function getProspectSignatureSkills(player, pos) {
    const tech = player.attributes?.technical || {};
    const phys = player.attributes?.physical || {};
    const ment = player.attributes?.mental || {};

    switch (pos) {
        case 'QB':
            return [
                { label: 'THR', val: tech.throwingAccuracy ?? '?' },
                { label: 'IQ', val: ment.playbookIQ ?? '?' }
            ];
        case 'RB':
            return [
                { label: 'SPD', val: phys.speed ?? '?' },
                { label: 'AGI', val: phys.agility ?? '?' }
            ];
        case 'WR':
            return [
                { label: 'HND', val: tech.catchingHands ?? '?' },
                { label: 'SPD', val: phys.speed ?? '?' }
            ];
        case 'TE':
            return [
                { label: 'HND', val: tech.catchingHands ?? '?' },
                { label: 'BLK', val: tech.blocking ?? '?' }
            ];
        case 'OL':
            return [
                { label: 'BLK', val: tech.blocking ?? '?' },
                { label: 'STR', val: phys.strength ?? '?' }
            ];
        case 'DL':
            return [
                { label: 'BSH', val: tech.blockShedding ?? '?' },
                { label: 'STR', val: phys.strength ?? '?' }
            ];
        case 'LB':
            return [
                { label: 'TKL', val: tech.tackling ?? '?' },
                { label: 'IQ', val: ment.playbookIQ ?? '?' }
            ];
        case 'DB':
            return [
                { label: 'COV', val: (tech.coverage ?? tech.passCoverage) ?? '?' },
                { label: 'SPD', val: phys.speed ?? '?' }
            ];
        default:
            return [
                { label: 'SPD', val: phys.speed ?? '?' },
                { label: 'STR', val: phys.strength ?? '?' }
            ];
    }
}

export function generatePlayer(minAge = 12, maxAge = 18, classModifiers = null) {
    const firstName = getRandom(firstNames);
    const lastName = Math.random() < 0.4 ? getRandom(nicknames) : getRandom(lastNames);
    const age = getRandomInt(minAge, maxAge);

    // 1. SELECT ARCHETYPE
    const getWeightedArchetype = () => {
        const roll = Math.random();
        let targetPos = 'WR';
        if (roll < 0.18) targetPos = 'OL';
        else if (roll < 0.36) targetPos = 'DL';
        else if (roll < 0.56) targetPos = 'WR';
        else if (roll < 0.76) targetPos = 'DB';
        else if (roll < 0.88) targetPos = 'LB';
        else if (roll < 0.96) targetPos = 'RB';
        else targetPos = 'QB';

        const valid = archetypes.filter(a => a.off === targetPos || a.def === targetPos);
        return getRandom(valid) || getRandom(archetypes);
    };

    const archetype = getWeightedArchetype();
    const favoriteOffensivePosition = archetype.off;
    const favoriteDefensivePosition = archetype.def;

    // 2. PRIMARY IDENTITY
    // If the archetype is a QB, ensure their primary side is always offense
    const primarySide = archetype.off === 'QB' ? 'offense' : (Math.random() < 0.70 ? 'offense' : 'defense');
    const bestPosition = primarySide === 'offense' ? favoriteOffensivePosition : favoriteDefensivePosition;

    // 3. CONTROLLED DRAFT CLASS MODIFIERS
    const rawClassShift = classModifiers ? (classModifiers.overallShift || 0) : 0;
    const rawPosShift = classModifiers && classModifiers.positionShifts ? (classModifiers.positionShifts[bestPosition] || 0) : 0;

    const classEffect = Math.max(-8, Math.min(8, rawClassShift));
    const positionEffect = Math.max(-6, Math.min(6, rawPosShift));

    const keyAttrs = new Set(archetype.keyAttrs);

    // 4. BASE TALENT ROLL (Player's Adult Talent Ceiling)
    const talentRoll = Math.random();
    let baseKeyMean, baseNonKeyMean;

    if (talentRoll < 0.06) { baseKeyMean = 90; baseNonKeyMean = 66; }       // Elite Wonderkid (6%)
    else if (talentRoll < 0.28) { baseKeyMean = 82; baseNonKeyMean = 58; }  // Standout Varsity Talent (22%)
    else if (talentRoll < 0.76) { baseKeyMean = 74; baseNonKeyMean = 50; }  // Solid Playground Competitor (48%)
    else { baseKeyMean = 65; baseNonKeyMean = 42; }                         // Developmental Prospect (24%)

    const generateTalentValue = (name) => {
        const isKey = keyAttrs.has(name);
        const mean = (isKey ? baseKeyMean : baseNonKeyMean) + classEffect + (isKey ? positionEffect : 0);
        const stdDev = isKey ? 6 : 9;

        let val = Math.round(gaussianRandom(mean, stdDev));
        return Math.max(25, Math.min(99, val));
    };

    // 5. HIDDEN TALENT PROFILE (Ceiling Attributes)
    let talentAttributes = {
        physical: {
            speed: generateTalentValue('speed'),
            strength: generateTalentValue('strength'),
            agility: generateTalentValue('agility'),
            // Youth Stamina Buff: Young kids can run forever.
            stamina: Math.max(30, Math.min(99, generateTalentValue('stamina') + (16 - age) * 5)),
            height: 0,
            weight: 0
        },
        mental: {
            playbookIQ: generateTalentValue('playbookIQ'),
            clutch: generateTalentValue('clutch'),
            consistency: generateTalentValue('consistency'),
            toughness: generateTalentValue('toughness'),
            decisionMaking: 50
        },
        technical: {
            throwingAccuracy: generateTalentValue('throwingAccuracy'),
            catchingHands: generateTalentValue('catchingHands'),
            tackling: generateTalentValue('tackling'),
            blocking: generateTalentValue('blocking'),
            blockShedding: generateTalentValue('blockShedding'),
            coverage: generateTalentValue('coverage')
        }
    };

    // Apply Archetype Multipliers & Boosts to Talent Profile
    talentAttributes.physical.speed = Math.min(99, Math.round(talentAttributes.physical.speed * archetype.speedMod));
    talentAttributes.physical.strength = Math.min(99, Math.round(talentAttributes.physical.strength * archetype.strMod));
    // Decision-making is related to football IQ, consistency, and clutch,
    // but has enough variance to be its own meaningful trait.
    talentAttributes.mental.decisionMaking = Math.max(
        25,
        Math.min(
            99,
            Math.round(
                (talentAttributes.mental.playbookIQ * 0.50) +
                (talentAttributes.mental.consistency * 0.30) +
                (talentAttributes.mental.clutch * 0.20) +
                gaussianRandom(0, 4)
            )
        )
    );

    // Strict clamp: Non-QBs should strictly have throwing accuracy between 15 and 35
    if (archetype.off !== 'QB') {
        talentAttributes.technical.throwingAccuracy = Math.min(
            35,
            Math.round(talentAttributes.technical.throwingAccuracy * 0.35)
        );
    }

    // Linemen should never roll decent passing or route-running hands
    if (archetype.off === 'OL') {
        talentAttributes.technical.throwingAccuracy = Math.min(25, talentAttributes.technical.throwingAccuracy);
        talentAttributes.technical.catchingHands = Math.min(35, talentAttributes.technical.catchingHands);
    }

    if (['WR', 'DB', 'QB'].includes(archetype.off)) {
        talentAttributes.technical.blocking = Math.round(talentAttributes.technical.blocking * 0.45);
        talentAttributes.technical.blockShedding = Math.round(talentAttributes.technical.blockShedding * 0.45);
    }



    const boosts = archetypeBoosts[archetype.name] || {};
    for (const [attr, boost] of Object.entries(boosts)) {
        for (const cat of Object.values(talentAttributes)) {
            if (typeof cat[attr] === 'number') {
                cat[attr] = Math.min(99, cat[attr] + boost);
            }
        }
    }

    // 6. PHYSICAL MEASUREMENTS (Height & Weight based on Age & Archetype across ages 8-18)
    const absoluteAgeProgress = Math.max(0, Math.min(1.0, (age - 8) / 10.0));
    const baseHeightMean = 52 + (absoluteAgeProgress * 22) + archetype.heightMod;
    let height = Math.round(gaussianRandom(baseHeightMean, 2.5));

    const baseWeightMean = (70 + (absoluteAgeProgress * 130)) * archetype.weightMod;
    let weight = Math.round(gaussianRandom(baseWeightMean, 14));

    talentAttributes.physical.height = height;
    talentAttributes.physical.weight = weight;

    // 7. POTENTIAL CALCULATION (Independent from current ability)
    const getNormalizedTalent = (name) => {
        if (name === 'height') return Math.max(0, Math.min(100, (height - 50) * 4));
        if (name === 'weight') return Math.max(0, Math.min(100, (weight - 100) * 0.66 + 40));

        for (const category of Object.values(talentAttributes)) {
            if (category && typeof category[name] === 'number') {
                return category[name];
            }
        }
        return 50;
    };

    const avgKeyTalent = archetype.keyAttrs.reduce(
        (sum, attr) => sum + getNormalizedTalent(attr),
        0
    ) / Math.max(1, archetype.keyAttrs.length);

    const potentialScore = (avgKeyTalent * 0.75) + (gaussianRandom(65, 7) * 0.25) + (classEffect * 0.5);

    let potential = 'C';
    if (potentialScore >= 88) potential = 'A';
    else if (potentialScore >= 76) potential = 'B';
    else if (potentialScore >= 58) potential = 'C';
    else if (potentialScore >= 43) potential = 'D';
    else potential = 'F';

    // Rare "Neighborhood Wonderkid / Phenom" roll (1.5% chance)
    const isWonderkid = Math.random() < 0.015;
    if (isWonderkid) {
        potential = 'A';
    }

    // 8. AGE SCALING & DEVELOPMENT VARIANCE (Deriving Current Ability)
    let basePhysicalScale, baseMentalScale, baseTechnicalScale;

    if (isWonderkid) {
        basePhysicalScale = 0.92;
        baseMentalScale = 0.86;
        baseTechnicalScale = 0.88;
    } else if (age < 12) {
        // Ages 8-11: Pee-Wee scale from 52% up to 70% of ceiling
        const youthProgress = Math.max(0, (age - 8) / 3.0);
        basePhysicalScale = 0.52 + (youthProgress * 0.18);
        baseMentalScale = 0.48 + (youthProgress * 0.18);
        baseTechnicalScale = 0.45 + (youthProgress * 0.20);
    } else {
        // Ages 12-18: Realistic sandlot baseline (74% at age 12 up to 100% at age 18)
        const teenProgress = Math.min(1.0, (age - 12) / 6.0);
        basePhysicalScale = 0.74 + (teenProgress * 0.26);
        baseMentalScale = 0.70 + (teenProgress * 0.30);
        baseTechnicalScale = 0.68 + (teenProgress * 0.32);
    }

    const playerGrowthTempo = 1 + gaussianRandom(0, 0.04);

    let attributes = {
        physical: { height, weight },
        mental: {},
        technical: {}
    };

    // Functional rating floor: 12yo rookies won't roll single-digit or teen ratings
    const ratingFloor = age < 12 ? 26 : 38;

    Object.keys(talentAttributes).forEach(cat => {
        let baseScale = basePhysicalScale;
        if (cat === 'mental') baseScale = baseMentalScale;
        else if (cat === 'technical') baseScale = baseTechnicalScale;

        Object.keys(talentAttributes[cat]).forEach(attr => {
            if (attr === 'height' || attr === 'weight') return;

            const attrVariance = 1 + gaussianRandom(0, 0.05);
            const devFactor = Math.min(1.0, baseScale * playerGrowthTempo * attrVariance);

            const rawVal = Math.round(talentAttributes[cat][attr] * devFactor);
            attributes[cat][attr] = Math.max(ratingFloor, Math.min(99, rawVal));
        });
    });

    // 9. SCOUTING PROFILE (Dossier with Top Strengths & Weaknesses)
    const skillList = [];
    for (const [catName, catAttrs] of Object.entries(attributes)) {
        for (const [attrName, val] of Object.entries(catAttrs)) {
            if (attrName === 'height' || attrName === 'weight') continue;
            skillList.push({ name: attrName, value: val });
        }
    }
    skillList.sort((a, b) => b.value - a.value);

    const strengths = skillList.slice(0, 3).map(s => s.name);
    const weaknesses = skillList.slice(-2).reverse().map(s => s.name);

    // 10. CLAMPED PERSONALITY & ASSEMBLE OBJECT
    const workEthicRoll = gaussianRandom(50, 18);
    const dependabilityRoll = gaussianRandom(60, 15);
    const streetCredRoll = gaussianRandom(50, 20);
    const likeabilityRoll = gaussianRandom(55, 20);
    const egoRoll = gaussianRandom(50, 25);
    const loyaltyRoll = gaussianRandom(60, 20);

    // --- GENERATE LORE BACKGROUND BLURB ---
    const generateBio = () => {
        const speedVal = attributes.physical?.speed || 50;
        const strVal = attributes.physical?.strength || 50;
        const iqVal = attributes.mental?.playbookIQ || 50;
        const egoVal = egoRoll;
        const ethVal = workEthicRoll;

        const athleticClues = [
            speedVal > 65 ? "Won the neighborhood 50-yard dash in untied sneakers." :
                speedVal < 35 ? "Not the fastest runner on the blacktop, but holds his ground." :
                    "A balanced athlete who plays every sport at recess.",
            strVal > 60 ? "Built like a cinder block from helping his uncle haul landscape pavers." :
                strVal < 30 ? "Relies on quickness rather than brute power in scuffles." :
                    "Has decent functional strength for his age."
        ];

        const mentalClues = [
            iqVal > 65 ? "Draws up trick plays on cafeteria napkins during lunch." :
                iqVal < 35 ? "Pure natural athlete who still forgets which hash mark to line up on." :
                    "Understands the basics of backyard route trees.",
            egoVal > 75 ? "Once took his ball home from the park because nobody passed to him." :
                ethVal > 75 ? "First one waiting at the park gates on Saturday mornings." :
                    "Always brings extra freeze pops for the team after games."
        ];

        const quirks = [
            "Refuses to wear gloves even in the freezing November wind.",
            "Wears his older brother's oversized championship wristband for good luck.",
            "Always carries a deflated football and a pump in his backpack.",
            "Known around the park for practicing diving catches into lawn leaf piles."
        ];

        // Age-specific lore to ground the reality of the neighborhood
        let ageLore = "";
        if (age <= 12) {
            ageLore = getRandom([
                "Runs on pure sugar and adrenaline; literally never gets tired.",
                "Doesn't care if he starts or sits, just happy his mom let him come to the park.",
                "Small frame, but fearless against the older kids."
            ]);
        } else if (age >= 17) {
            ageLore = getRandom([
                "A playground legend who is starting to get gassed after two hard sprints.",
                "Has his own car now; if he isn't getting the ball, he might just drive home.",
                "A physical mismatch against the middle schoolers, but his knees are already aching."
            ]);
        }

        //const wonderkidNote = isWonderkid ? "⭐ THE NEIGHBORHOOD PHENOM. A once-in-a-generation playground prodigy who already runs circles around high school varsity athletes." : "";
        return `${getRandom(athleticClues)} ${getRandom(mentalClues)} ${getRandom(quirks)} ${ageLore}`.trim();
    };

    const bio = generateBio();

    return {
        id: crypto.randomUUID(),
        bio,
        name: `${firstName} ${lastName}`,
        archetypeName: archetype.name,
        age,
        primarySide,
        bestPosition,
        pos: bestPosition,
        favoriteOffensivePosition,
        favoriteDefensivePosition,
        number: null,
        potential,

        // Active current ability ratings used in-game
        attributes,

        // Underlying full-potential ceiling ratings
        talentAttributes,

        // Concise scouting dossier
        scouting: {
            potential,
            primarySide,
            bestPosition,
            strengths,
            weaknesses
        },

        teamId: null,
        status: { type: 'healthy', description: '', duration: 0 },
        fatigue: 0,
        gameStats: {},
        seasonStats: {},
        careerStats: { seasonsPlayed: 0, snapsThisSeason: 0 },
        progression: [],

        personality: {
            workEthic: Math.max(15, Math.min(99, Math.round(workEthicRoll))),
            dependability: Math.max(20, Math.min(99, Math.round(dependabilityRoll))),
            streetCred: Math.max(0, Math.min(100, Math.round(streetCredRoll))),
            likeability: Math.max(10, Math.min(99, Math.round(likeabilityRoll))),
            ego: Math.max(0, Math.min(100, Math.round(egoRoll))),
            loyalty: Math.max(0, Math.min(100, Math.round(loyaltyRoll))),
            clique: getRandom(cliques),
            entersDraft: Math.random() < 0.60
        },

        social: {
            bestFriendId: null,
            goodFriendIds: [],
            rivalIds: []
        },

        playerHistory: {
            teamsPlayedFor: []
        },

        expectations: {
            desiredRole: age <= 13 ? 'DEVELOPMENTAL' : (age <= 15 ? 'ROTATION' : 'STARTER'),
            // 17 and 18 year old skill players DEMAND the ball, or they quit.
            minTouchesPerGame: (age >= 16 && ['QB', 'RB', 'WR', 'TE'].includes(favoriteOffensivePosition)) ? Math.floor((age - 14) * 1.5) : 0,
            happiness: 100
        }
    };
}