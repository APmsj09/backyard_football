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
    // --- QUARTERBACKS ---
    { 
        name: 'Dual-Threat QB', off: 'QB', def: 'DB', 
        weightMod: 1.0, heightMod: 0, 
        keyAttrs: ['speed', 'throwingAccuracy', 'playbookIQ', 'agility'],
        speedMod: 1.1, strMod: 0.9 
    },
    { 
        name: 'Pocket General', off: 'QB', def: 'LB', 
        weightMod: 1.1, heightMod: 3, 
        keyAttrs: ['throwingAccuracy', 'playbookIQ', 'consistency', 'toughness'],
        speedMod: 0.8, strMod: 1.1 
    },

    // --- RUNNING BACKS ---
    { 
        name: 'Power Back', off: 'RB', def: 'LB', 
        weightMod: 1.2, heightMod: -1, 
        keyAttrs: ['strength', 'toughness', 'tackling', 'speed'],
        speedMod: 0.9, strMod: 1.2 
    },
    { 
        name: 'Scatback', off: 'RB', def: 'DB', 
        weightMod: 0.85, heightMod: -2, 
        keyAttrs: ['speed', 'agility', 'catchingHands', 'coverage'],
        speedMod: 1.15, strMod: 0.8 
    },

    // --- RECEIVERS ---
    { 
        name: 'Deep Threat', off: 'WR', def: 'DB', 
        weightMod: 0.9, heightMod: 1, 
        keyAttrs: ['speed', 'agility', 'catchingHands', 'coverage'],
        speedMod: 1.2, strMod: 0.8 
    },
    { 
        name: 'Physical Slot', off: 'WR', def: 'LB', 
        weightMod: 1.1, heightMod: 0, 
        keyAttrs: ['catchingHands', 'toughness', 'tackling', 'consistency'],
        speedMod: 0.95, strMod: 1.1 
    },

    // --- TIGHT ENDS ---
    { 
        name: 'Vertical TE', off: 'TE', def: 'LB', 
        weightMod: 1.25, heightMod: 4, 
        keyAttrs: ['speed', 'catchingHands', 'playbookIQ', 'tackling'],
        speedMod: 0.9, strMod: 1.1 
    },
    { 
        name: 'Blocking Specialist', off: 'TE', def: 'DL', 
        weightMod: 1.4, heightMod: 2, 
        keyAttrs: ['strength', 'blocking', 'blockShedding', 'toughness'],
        speedMod: 0.7, strMod: 1.25 
    },

    // --- LINEMEN ---
    { 
        name: 'Space Eater', off: 'OL', def: 'DL', 
        weightMod: 1.7, heightMod: 1, 
        keyAttrs: ['strength', 'blocking', 'weight', 'toughness'],
        speedMod: 0.5, strMod: 1.4 
    },
    { 
        name: 'Edge Protector', off: 'OL', def: 'DL', 
        weightMod: 1.45, heightMod: 5, 
        keyAttrs: ['strength', 'agility', 'blockShedding', 'playbookIQ'],
        speedMod: 0.75, strMod: 1.15 
    },

    // --- DEFENSIVE SPECIALISTS (Secondary Offensive Roles) ---
    { 
        name: 'Ballhawk', off: 'WR', def: 'DB', 
        weightMod: 0.9, heightMod: 2, 
        keyAttrs: ['coverage', 'catchingHands', 'speed', 'agility'],
        speedMod: 1.1, strMod: 0.85 
    },
    { 
        name: 'Run Stopper', off: 'RB', def: 'LB', 
        weightMod: 1.2, heightMod: 0, 
        keyAttrs: ['tackling', 'strength', 'toughness', 'playbookIQ'],
        speedMod: 0.85, strMod: 1.2 
    }
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