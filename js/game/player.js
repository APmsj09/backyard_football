// player.js - player generation and rating helpers

import { getRandom, getRandomInt } from '../utils.js';
import { firstNames, lastNames, nicknames, offenseFormations, defenseFormations } from '../data.js';

const offensivePositions = ['QB', 'RB', 'WR', 'TE', 'OL'];
const defensivePositions =['DL', 'LB', 'DB'];

// Adjusted weights: Removed speed from OL/DL so their archetype nerfs don't tank their OVR
export const positionOverallWeights = {
    QB: { throwingAccuracy: 0.45, playbookIQ: 0.30, consistency: 0.10, clutch: 0.05, agility: 0.05, strength: 0.05 },
    RB: { speed: 0.35, agility: 0.25, strength: 0.15, catchingHands: 0.10, toughness: 0.10, stamina: 0.05 },
    WR: { speed: 0.40, catchingHands: 0.30, agility: 0.15, height: 0.10, playbookIQ: 0.05 },
    TE: { catchingHands: 0.30, blocking: 0.25, strength: 0.20, height: 0.15, toughness: 0.10 }, 
    OL: { strength: 0.45, blocking: 0.40, weight: 0.10, toughness: 0.05 },
    DL: { strength: 0.40, blockShedding: 0.30, tackling: 0.20, weight: 0.10 },
    LB: { tackling: 0.35, playbookIQ: 0.20, strength: 0.20, speed: 0.15, blockShedding: 0.10 },
    DB: { speed: 0.35, coverage: 0.30, agility: 0.20, catchingHands: 0.10, playbookIQ: 0.05 }
};

export function estimateBestPosition(scoutedPlayer) {
    if (!scoutedPlayer || !scoutedPlayer.attributes) return 'UTIL';

    // Same resolution logic as before
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
        return 0; 
    };

    const cleanAttributes = {};
    for (const [category, attrs] of Object.entries(scoutedPlayer.attributes)) {
        cleanAttributes[category] = {};
        for (const [key, value] of Object.entries(attrs)) {
            cleanAttributes[category][key] = resolveAttr(value);
        }
    }

    const tempPlayer = { ...scoutedPlayer, attributes: cleanAttributes };

    let bestPos = 'UTIL';
    let maxScore = -Infinity;
    
    Object.keys(positionOverallWeights).forEach(pos => {
        const score = calculateOverall(tempPlayer, pos);
        if (score > maxScore) {
            maxScore = score;
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
            if (relevantWeights[attr]) {
                let value = attrs[category][attr];
                
                // Normalization mappings
                if (attr === 'weight') {
                    // 100 lbs = 40 rating, 250 lbs = 100 rating
                    value = Math.max(0, Math.min(100, (value - 100) * 0.66 + 40));
                }
                if (attr === 'height') {
                    // 50 inches = 0 rating, 75 inches (6'3") = 100 rating
                    value = Math.max(0, Math.min(100, (value - 50) * 4)); 
                }

                if (typeof value === 'number') {
                    score += value * relevantWeights[attr];
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
            if (player.attributes[category]?.[attr] !== undefined) {
                let value = player.attributes[category][attr];
                if (typeof value !== 'number') continue;
                
                if (attr === 'weight') value = Math.max(0, Math.min(100, (value - 100) * 0.66 + 40));
                if (attr === 'height') value = Math.max(0, Math.min(100, (value - 50) * 4)); 
                
                score += value * priorities[attr];
                totalWeight += priorities[attr];
                break;
            }
        }
    }

    const baseOverall = calculateOverall(player, basePosition);
    const finalScore = (totalWeight > 0 ? (score / totalWeight) : baseOverall) * 0.7 + (baseOverall * 0.3);

    return Math.min(99, Math.max(1, Math.round(finalScore)));
}

const archetypes = [
    // --- 1. THE SIGNAL CALLERS (QB Primary) ---
    { name: 'Field General', off: 'QB', def: 'LB', weightMod: 1.1, heightMod: 2, keyAttrs: ['playbookIQ', 'throwingAccuracy', 'consistency', 'tackling'], speedMod: 0.85, strMod: 1.0 },
    { name: 'Scrambler', off: 'QB', def: 'DB', weightMod: 0.95, heightMod: -1, keyAttrs: ['speed', 'agility', 'throwingAccuracy', 'stamina'], speedMod: 1.2, strMod: 0.85 },
    { name: 'Gunslinger', off: 'QB', def: 'DB', weightMod: 1.05, heightMod: 3, keyAttrs: ['throwingAccuracy', 'strength', 'clutch', 'playbookIQ'], speedMod: 0.9, strMod: 1.25 },
    { name: 'Heavy Crusher QB', off: 'QB', def: 'DL', weightMod: 1.4, heightMod: 4, keyAttrs: ['strength', 'throwingAccuracy', 'toughness', 'blockShedding'], speedMod: 0.65, strMod: 1.3 },

    // --- 2. THE BALL CARRIERS (RB Primary) ---
    { name: 'Power Back', off: 'RB', def: 'LB', weightMod: 1.25, heightMod: -1, keyAttrs: ['strength', 'toughness', 'tackling', 'stamina'], speedMod: 0.9, strMod: 1.2 },
    { name: 'Speed Back', off: 'RB', def: 'DB', weightMod: 0.85, heightMod: -2, keyAttrs: ['speed', 'agility', 'clutch', 'catchingHands'], speedMod: 1.25, strMod: 0.75 },
    { name: 'Workhorse', off: 'RB', def: 'LB', weightMod: 1.1, heightMod: 0, keyAttrs: ['stamina', 'consistency', 'tackling', 'toughness'], speedMod: 1.0, strMod: 1.0 },
    { name: 'Receiving Back', off: 'RB', def: 'DB', weightMod: 0.9, heightMod: -1, keyAttrs: ['catchingHands', 'agility', 'speed', 'coverage'], speedMod: 1.1, strMod: 0.8 },

    // --- 3. THE PASS CATCHERS (WR Primary) ---
    { name: 'Deep Threat', off: 'WR', def: 'DB', weightMod: 0.85, heightMod: 1, keyAttrs: ['speed', 'agility', 'clutch', 'coverage'], speedMod: 1.3, strMod: 0.7 },
    { name: 'Route Technician', off: 'WR', def: 'DB', weightMod: 1.0, heightMod: 0, keyAttrs: ['agility', 'playbookIQ', 'catchingHands', 'consistency'], speedMod: 1.0, strMod: 1.0 },
    { name: 'Red Zone Specialist', off: 'WR', def: 'LB', weightMod: 1.15, heightMod: 7, keyAttrs: ['height', 'catchingHands', 'strength', 'clutch'], speedMod: 0.8, strMod: 1.15 },
    { name: 'Slot Brawler', off: 'WR', def: 'LB', weightMod: 1.1, heightMod: 0, keyAttrs: ['toughness', 'catchingHands', 'tackling', 'strength'], speedMod: 0.95, strMod: 1.1 },

    // --- 4. THE TIGHT ENDS (TE Primary) ---
    { name: 'Vertical TE', off: 'TE', def: 'LB', weightMod: 1.3, heightMod: 5, keyAttrs: ['speed', 'catchingHands', 'height', 'playbookIQ'], speedMod: 0.9, strMod: 1.1 },
    { name: 'Jumbo Athlete', off: 'TE', def: 'DL', weightMod: 1.5, heightMod: 4, keyAttrs: ['strength', 'blocking', 'catchingHands', 'blockShedding'], speedMod: 0.75, strMod: 1.3 },
    { name: 'Lead Blocker TE', off: 'TE', def: 'LB', weightMod: 1.4, heightMod: 1, keyAttrs: ['blocking', 'strength', 'tackling', 'toughness'], speedMod: 0.8, strMod: 1.25 },
    { name: 'Hybrid Wing', off: 'TE', def: 'DB', weightMod: 1.15, heightMod: 3, keyAttrs: ['agility', 'catchingHands', 'coverage', 'speed'], speedMod: 1.0, strMod: 0.95 },

    // --- 5. THE OFFENSIVE WALL (OL Primary) ---
    { name: 'Road Grader', off: 'OL', def: 'DL', weightMod: 1.9, heightMod: 2, keyAttrs: ['strength', 'blocking', 'weight', 'toughness'], speedMod: 0.45, strMod: 1.5 },
    { name: 'Mobile Guard', off: 'OL', def: 'LB', weightMod: 1.4, heightMod: 1, keyAttrs: ['agility', 'blocking', 'playbookIQ', 'tackling'], speedMod: 0.8, strMod: 1.1 },
    { name: 'Wall Protector', off: 'OL', def: 'DL', weightMod: 1.6, heightMod: 6, keyAttrs: ['blocking', 'height', 'strength', 'consistency'], speedMod: 0.6, strMod: 1.2 },
    { name: 'Technician OL', off: 'OL', def: 'DL', weightMod: 1.5, heightMod: 3, keyAttrs: ['playbookIQ', 'blocking', 'consistency', 'blockShedding'], speedMod: 0.7, strMod: 1.1 },

    // --- 6. THE PASS RUSHERS (DL Primary) ---
    { name: 'Speed Rusher', off: 'OL', def: 'DL', weightMod: 1.25, heightMod: 4, keyAttrs: ['speed', 'blockShedding', 'agility', 'clutch'], speedMod: 1.05, strMod: 1.05 },
    { name: 'Run Stuffer', off: 'TE', def: 'DL', weightMod: 1.7, heightMod: 1, keyAttrs: ['strength', 'tackling', 'weight', 'toughness'], speedMod: 0.55, strMod: 1.4 },
    { name: 'Bull Rusher', off: 'OL', def: 'DL', weightMod: 1.6, heightMod: 2, keyAttrs: ['strength', 'blockShedding', 'toughness', 'blocking'], speedMod: 0.7, strMod: 1.35 },
    { name: 'Versatile End', off: 'TE', def: 'DL', weightMod: 1.4, heightMod: 4, keyAttrs: ['blockShedding', 'tackling', 'playbookIQ', 'strength'], speedMod: 0.85, strMod: 1.2 },

    // --- 7. THE DEFENSIVE CORE (LB Primary) ---
    { name: 'Middle Hawk', off: 'RB', def: 'LB', weightMod: 1.15, heightMod: 1, keyAttrs: ['playbookIQ', 'tackling', 'coverage', 'speed'], speedMod: 1.0, strMod: 1.0 },
    { name: 'Hard Hitter', off: 'RB', def: 'LB', weightMod: 1.3, heightMod: 0, keyAttrs: ['tackling', 'strength', 'toughness', 'clutch'], speedMod: 0.9, strMod: 1.25 },
    { name: 'Blitz Specialist', off: 'WR', def: 'LB', weightMod: 1.1, heightMod: 2, keyAttrs: ['speed', 'blockShedding', 'tackling', 'agility'], speedMod: 1.15, strMod: 1.05 },
    { name: 'Coverage LB', off: 'TE', def: 'LB', weightMod: 1.05, heightMod: 3, keyAttrs: ['coverage', 'agility', 'playbookIQ', 'catchingHands'], speedMod: 1.05, strMod: 0.95 },

    // --- 8. THE SECONDARY (DB Primary) ---
    { name: 'Island Corner', off: 'WR', def: 'DB', weightMod: 0.85, heightMod: 0, keyAttrs: ['coverage', 'speed', 'agility', 'consistency'], speedMod: 1.3, strMod: 0.8 },
    { name: 'Ballhawk Safety', off: 'WR', def: 'DB', weightMod: 0.95, heightMod: 2, keyAttrs: ['catchingHands', 'playbookIQ', 'coverage', 'clutch'], speedMod: 1.1, strMod: 0.9 },
    { name: 'Nickel Stopper', off: 'RB', def: 'DB', weightMod: 1.05, heightMod: -1, keyAttrs: ['tackling', 'agility', 'speed', 'toughness'], speedMod: 1.1, strMod: 1.1 },
    { name: 'Zone Specialist', off: 'WR', def: 'DB', weightMod: 1.0, heightMod: 3, keyAttrs: ['playbookIQ', 'coverage', 'height', 'catchingHands'], speedMod: 0.95, strMod: 1.0 }
];

export function generatePlayer(minAge = 10, maxAge = 16) {
    const firstName = getRandom(firstNames);
    const lastName = Math.random() < 0.4 ? getRandom(nicknames) : getRandom(lastNames);
    const age = getRandomInt(minAge, maxAge);

    // 1. Select Archetype
    const archetype = getRandom(archetypes);
    const favoriteOffensivePosition = archetype.off;
    const favoriteDefensivePosition = archetype.def;
    
    // Determine which side they are "naturally" better at for potential calculation
    const bestPosition = Math.random() > 0.5 ? favoriteOffensivePosition : favoriteDefensivePosition;

    const tiers = {
        'Elite': { min: 90, max: 99 },
        'Great': { min: 80, max: 89 },
        'Good': { min: 70, max: 79 },
        'Average': { min: 55, max: 69 },
        'Poor': { min: 40, max: 54 },
        'Terrible': { min: 20, max: 39 }
    };

    const keyAttrs = new Set(archetype.keyAttrs);

    // 2. Base Attribute Roll
    let generatedKeySum = 0;
    const generateAttributeValue = (name) => {
        const isKey = keyAttrs.has(name);
        const roll = Math.random();
        let tier;

        if (isKey) {
            if (roll < 0.20) tier = 'Elite';      // 20% Elite if key
            else if (roll < 0.50) tier = 'Great';
            else if (roll < 0.85) tier = 'Good';
            else tier = 'Average';
        } else {
            if (roll < 0.02) tier = 'Elite';      // 2% Freak
            else if (roll < 0.12) tier = 'Great';
            else if (roll < 0.35) tier = 'Good';
            else if (roll < 0.75) tier = 'Average';
            else tier = 'Poor';
        }

        const val = getRandomInt(tiers[tier].min, tiers[tier].max);
        if (isKey) generatedKeySum += val;
        return val;
    };

    // 3. Generate the Attributes
    let attributes = {
        physical: {
            speed: generateAttributeValue('speed'),
            strength: generateAttributeValue('strength'),
            agility: generateAttributeValue('agility'),
            stamina: generateAttributeValue('stamina'),
            height: 0, weight: 0
        },
        mental: {
            playbookIQ: generateAttributeValue('playbookIQ'),
            clutch: getRandomInt(20, 99),
            consistency: generateAttributeValue('consistency'),
            toughness: generateAttributeValue('toughness')
        },
        technical: {
            throwingAccuracy: generateAttributeValue('throwingAccuracy'),
            catchingHands: generateAttributeValue('catchingHands'),
            tackling: generateAttributeValue('tackling'),
            blocking: generateAttributeValue('blocking'),
            blockShedding: generateAttributeValue('blockShedding'),
            passCoverage: generateAttributeValue('coverage')
        }
    };

    // 4. Apply Archetype Modifiers
    // These apply to the 0-99 rolls before age scaling
    attributes.physical.speed = Math.min(99, attributes.physical.speed * archetype.speedMod);
    attributes.physical.strength = Math.min(99, attributes.physical.strength * archetype.strMod);
    
    // Penalize things the archetype shouldn't be doing
    if (archetype.off !== 'QB') attributes.technical.throwingAccuracy *= 0.5;
    if (['WR', 'DB', 'QB'].includes(archetype.off)) {
        attributes.technical.blocking *= 0.4;
        attributes.technical.blockShedding *= 0.4;
    }

    // 5. Potential (Logic: How good are they relative to their archetype's keys?)
    const avgKeyTalent = generatedKeySum / archetype.keyAttrs.length;
    const potentialRoll = avgKeyTalent + getRandomInt(-5, 10);
    let potential = 'F';
    if (potentialRoll >= 88) potential = 'A';
    else if (potentialRoll >= 78) potential = 'B';
    else if (potentialRoll >= 68) potential = 'C';
    else if (potentialRoll >= 55) potential = 'D';

    // 6. Body Type
    const ageProgress = (age - 10) / (16 - 10);
    let height = 55 + (ageProgress * 15) + archetype.heightMod + getRandomInt(-2, 3);
    let weight = (80 + (ageProgress * 90)) * archetype.weightMod + getRandomInt(-10, 15);
    attributes.physical.height = Math.round(height);
    attributes.physical.weight = Math.round(weight);

    // 7. Age Scaling
    const physScale = 0.65 + (ageProgress * 0.35);
    const mentScale = 0.50 + (ageProgress * 0.50);

    Object.keys(attributes).forEach(cat => {
        Object.keys(attributes[cat]).forEach(attr => {
            if (['height', 'weight', 'clutch'].includes(attr)) return;
            let factor = (cat === 'physical') ? physScale : mentScale;
            if (attr === 'speed' || attr === 'agility') factor = Math.min(1.0, factor + 0.15);
            attributes[cat][attr] = Math.max(15, Math.min(99, Math.round(attributes[cat][attr] * factor)));
        });
    });

    return {
        id: crypto.randomUUID(),
        name: `${firstName} ${lastName}`,
        archetypeName: archetype.name, // 💡 Added for UI visibility
        age,
        favoriteOffensivePosition,
        favoriteDefensivePosition,
        number: getRandomInt(1, 99),
        potential,
        attributes,
        teamId: null,
        status: { type: 'healthy', description: '', duration: 0 },
        fatigue: 0,
        gameStats: { /* initial empty stats */ },
        seasonStats: { /* initial empty stats */ },
        careerStats: { seasonsPlayed: 0 /* etc */ }
    };
}