// player.js - player generation and rating helpers

import { getRandom, getRandomInt} from '../utils.js';
import {
    firstNames, lastNames, nicknames,
    offenseFormations, defenseFormations
} from '../data.js';

// Local position lists for generation
const offensivePositions = ['QB', 'RB', 'WR', 'OL'];
const defensivePositions = ['DL', 'LB', 'DB'];

// Attribute Weights (exported)
export const positionOverallWeights = {
    QB: { throwingAccuracy: 0.4, playbookIQ: 0.3, consistency: 0.1, clutch: 0.1, speed: 0.05, agility: 0.05 },
    RB: { speed: 0.3, strength: 0.2, agility: 0.2, catchingHands: 0.1, blocking: 0.1, stamina: 0.1 },
    WR: { speed: 0.3, catchingHands: 0.3, agility: 0.2, height: 0.1, clutch: 0.1 },
    OL: { strength: 0.4, blocking: 0.4, weight: 0.1, playbookIQ: 0.1 },
    DL: { strength: 0.4, tackling: 0.25, blockShedding: 0.2, weight: 0.1, agility: 0.05 },
    LB: { tackling: 0.3, speed: 0.2, strength: 0.2, blockShedding: 0.1, playbookIQ: 0.2 },
    DB: { speed: 0.35, agility: 0.25, catchingHands: 0.15, tackling: 0.1, playbookIQ: 0.15 }
};

/**
 * Estimates the best position for a player by running their
 * scouted attributes through the game's actual calculateOverall logic.
 *
 * @param {object} scoutedPlayer - The player object, potentially with ranged attributes.
 * @returns {string} The abbreviation of the estimated best position (e.g., "WR", "LB").
 */
export function estimateBestPosition(scoutedPlayer) {
    // 1. Fast fail if data is missing
    if (!scoutedPlayer || !scoutedPlayer.attributes) {
        return 'UTIL';
    }

    // --- Helper: Normalize Attribute Values ---
    // Converts numbers, strings ("70-80"), or "?" to a usable number
    const resolveAttr = (val) => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
            if (val.includes('-')) {
                const [min, max] = val.split('-').map(Number);
                return (min + max) / 2;
            }
            // Handle "?" or other non-numeric strings by returning a safe average
            return 50; 
        }
        return 0; // Fallback for null/undefined
    };

    // --- 2. Create "Clean" Player Object ---
    // We use spread (...) to keep ID/Name/etc, then overwrite attributes
    // with the normalized numeric versions.
    const cleanAttributes = {};
    
    for (const [category, attrs] of Object.entries(scoutedPlayer.attributes)) {
        cleanAttributes[category] = {};
        for (const [key, value] of Object.entries(attrs)) {
            cleanAttributes[category][key] = resolveAttr(value);
        }
    }

    const tempPlayer = {
        ...scoutedPlayer,
        attributes: cleanAttributes
    };

    // --- 3. Evaluate Positions ---
    let bestPos = 'UTIL';
    let maxScore = -Infinity;

    // Optional: Define valuable positions to break ties. 
    // If a player is 80 WR and 80 CB, we usually prefer the offensive skill position.
    // We iterate keys of weights, so this order is implicit, but strictly > means
    // the first one found keeps the title in a tie.
    const positions = Object.keys(positionOverallWeights);

    for (const pos of positions) {
        // Calculate score using the normalized data
        const score = calculateOverall(tempPlayer, pos);

        if (score > maxScore) {
            maxScore = score;
            bestPos = pos;
        }
    }

    return bestPos;
}
/**
 * Calculates a player's overall rating for a given position.
 */
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
                if (attr === 'weight') value = (value || 100) / 2.5;
                if (attr === 'height') value = ((value || 60) - 60);
                if (typeof value === 'number') {
                    score += value * relevantWeights[attr];
                }
            }
        }
    }
    return Math.min(99, Math.max(1, Math.round(score)));
}

/**
 * Calculates a player's suitability for a specific formation slot.
 */
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
                if (attr === 'weight') value = value / 2.5;
                if (attr === 'height') value = (value - 60);
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

/**
 * Generates a new player object.
 */
export function generatePlayer(minAge = 10, maxAge = 16) {
    const firstName = getRandom(firstNames);
    const lastName = Math.random() < 0.4 ? getRandom(nicknames) : getRandom(lastNames);
    const age = getRandomInt(minAge, maxAge);

    // 1. Determine Position
    const favoriteOffensivePosition = getRandom(offensivePositions);
    const favoriteDefensivePosition = getRandom(defensivePositions);
    const isOffenseStar = Math.random() < 0.5;
    const bestPosition = isOffenseStar ? favoriteOffensivePosition : favoriteDefensivePosition;

    // 2. Define Attribute Tiers
    const tiers = {
        'Elite': { min: 90, max: 99 },
        'Great': { min: 80, max: 89 },
        'Good': { min: 70, max: 79 },
        'Average': { min: 55, max: 69 },
        'Poor': { min: 40, max: 54 },
        'Terrible': { min: 20, max: 39 }
    };

    // 3. Define "Key Attributes" per position
    // These attributes get a statistical advantage during generation
    const getKeyAttributes = (pos) => {
        switch (pos) {
            case 'QB': return ['throwingAccuracy', 'playbookIQ', 'consistency'];
            case 'RB': return ['speed', 'agility', 'strength', 'toughness'];
            case 'WR': return ['speed', 'catchingHands', 'agility'];
            case 'OL': return ['strength', 'blocking', 'toughness'];
            case 'DL': return ['strength', 'blockShedding', 'tackling'];
            case 'LB': return ['tackling', 'playbookIQ', 'strength'];
            case 'DB': return ['speed', 'agility', 'catchingHands'];
            default: return [];
        }
    };
    const keyAttrs = new Set(getKeyAttributes(bestPosition));

    // 4. The Core Generator Function
    // Generates a specific value based on whether it is a "Key" stat for this player
    const generateAttributeValue = (attributeName) => {
        const isKey = keyAttrs.has(attributeName);
        const roll = Math.random();

        let tier;

        if (isKey) {
            // Weighted towards greatness for key position stats
            if (roll < 0.15) tier = 'Elite';       // 15%
            else if (roll < 0.40) tier = 'Great';  // 25%
            else if (roll < 0.75) tier = 'Good';   // 35%
            else if (roll < 0.95) tier = 'Average';// 20%
            else tier = 'Poor';                    // 5% (Bust factor)
        } else {
            // Bell curve-ish for non-key stats
            if (roll < 0.02) tier = 'Elite';       // 2% (Random freak athlete)
            else if (roll < 0.10) tier = 'Great';  // 8%
            else if (roll < 0.30) tier = 'Good';   // 20%
            else if (roll < 0.70) tier = 'Average';// 40%
            else if (roll < 0.90) tier = 'Poor';   // 20%
            else tier = 'Terrible';                // 10%
        }

        return getRandomInt(tiers[tier].min, tiers[tier].max);
    };

    // 5. Generate Raw Attributes (Before Age/Weight scaling)
    let attributes = {
        physical: {
            speed: generateAttributeValue('speed'),
            strength: generateAttributeValue('strength'),
            agility: generateAttributeValue('agility'),
            stamina: generateAttributeValue('stamina'),
            // Height/Weight calc comes later
            height: 0, weight: 0 
        },
        mental: {
            playbookIQ: generateAttributeValue('playbookIQ'),
            clutch: getRandomInt(20, 99), // Clutch is purely random regardless of position
            consistency: generateAttributeValue('consistency'),
            toughness: generateAttributeValue('toughness')
        },
        technical: {
            throwingAccuracy: generateAttributeValue('throwingAccuracy'),
            catchingHands: generateAttributeValue('catchingHands'),
            tackling: generateAttributeValue('tackling'),
            blocking: generateAttributeValue('blocking'),
            blockShedding: generateAttributeValue('blockShedding')
        }
    };

    // 6. Calculate Height/Weight
    // Physics logic: We want weight to roughly correlate with strength, 
    // but we also want variance (fat/slow vs lean/strong)
    const ageProgress = (age - 10) / (16 - 10);
    
    // Base size based on age
    let height = 55 + (ageProgress * 15) + getRandomInt(-3, 5); // Inches
    let weight = 70 + (ageProgress * 90) + getRandomInt(-15, 20); // Lbs

    // Position adjustments
    if (['OL', 'DL'].includes(bestPosition)) {
        weight += getRandomInt(20, 50);
        attributes.physical.strength += 10; // Bonus for pure mass
    } else if (['WR', 'DB'].includes(bestPosition)) {
        weight -= getRandomInt(5, 15);
    }

    attributes.physical.height = Math.round(height);
    attributes.physical.weight = Math.round(weight);

    // 7. Physics Constraints
    // If player is heavy, penalize speed/agility. If light, penalize strength.
    // We check relative to "expected" weight for their age.
    const expectedWeight = 70 + (ageProgress * 90);
    const weightDiff = attributes.physical.weight - expectedWeight;

    if (weightDiff > 20) {
        // Heavy player
        attributes.physical.speed -= Math.round(weightDiff * 0.4);
        attributes.physical.agility -= Math.round(weightDiff * 0.3);
        attributes.physical.strength += Math.round(weightDiff * 0.2);
    } else if (weightDiff < -10) {
        // Skinny player
        attributes.physical.strength -= Math.round(Math.abs(weightDiff) * 0.5);
        attributes.physical.speed += Math.round(Math.abs(weightDiff) * 0.2);
    }

    // 8. Age Scaling
    // A 10-year-old with "99 speed" isn't actually running a 4.2 40yd dash.
    // They are 99 *relative to their age group*. 
    // We scale stats down so they grow into them over seasons.
    const ageScalingFactor = 0.60 + (ageProgress * 0.40); // 10yo = 60%, 16yo = 100%
    
    Object.keys(attributes).forEach(cat => {
        Object.keys(attributes[cat]).forEach(attr => {
            // Don't scale height/weight/clutch
            if (['height', 'weight', 'clutch'].includes(attr)) return;
            
            // Scale it
            let val = attributes[cat][attr] * ageScalingFactor;
            
            // Clamp between 1 and 99
            attributes[cat][attr] = Math.max(1, Math.min(99, Math.round(val)));
        });
    });

    // 9. Determine Potential
    // Potential is based on how high their "natural rolls" were before age scaling
    // We look at the average of their key attributes vs global average
    let rawSum = 0;
    let count = 0;
    Object.keys(attributes).forEach(cat => {
        Object.keys(attributes[cat]).forEach(attr => {
            if (['height', 'weight', 'clutch'].includes(attr)) return;
            // Reverse the age scaling to peek at their "true talent"
            const trueTalent = attributes[cat][attr] / ageScalingFactor;
            rawSum += trueTalent;
            count++;
        });
    });

    const avgTalent = rawSum / count; // 0-99
    let potential = 'F';

    // Add variance so a low current-skill player might still have high potential
    const potentialRoll = avgTalent + getRandomInt(-10, 15); 

    if (potentialRoll >= 85) potential = 'A';
    else if (potentialRoll >= 75) potential = 'B';
    else if (potentialRoll >= 65) potential = 'C';
    else if (potentialRoll >= 50) potential = 'D';
    
    const initialStats = {
        receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0,
        tackles: 0, sacks: 0, interceptions: 0,
        passAttempts: 0, passCompletions: 0, interceptionsThrown: 0
    };

    return {
        id: crypto.randomUUID(),
        name: `${firstName} ${lastName}`,
        age,
        favoriteOffensivePosition,
        favoriteDefensivePosition,
        number: null,
        potential,
        attributes,
        teamId: null,
        status: { type: 'healthy', description: '', duration: 0 },
        fatigue: 0,
        gameStats: { ...initialStats },
        seasonStats: { ...initialStats },
        careerStats: { ...initialStats, seasonsPlayed: 0 }
    };
}
