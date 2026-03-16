// player.js - player generation and rating helpers

// player.js - player generation and rating helpers

import { getRandom, getRandomInt} from '../utils.js';
import {
    firstNames, lastNames, nicknames,
    offenseFormations, defenseFormations
} from '../data.js';

// FIX #1: Added TE to the generator list
const offensivePositions =['QB', 'RB', 'WR', 'TE', 'OL'];
const defensivePositions = ['DL', 'LB', 'DB'];

// FIX #1: Added TE weights to prevent 0 OVR returns
export const positionOverallWeights = {
    QB: { throwingAccuracy: 0.4, playbookIQ: 0.3, consistency: 0.1, clutch: 0.1, speed: 0.05, agility: 0.05 },
    RB: { speed: 0.3, strength: 0.2, agility: 0.2, catchingHands: 0.1, blocking: 0.1, stamina: 0.1 },
    WR: { speed: 0.3, catchingHands: 0.3, agility: 0.2, height: 0.1, clutch: 0.1 },
    TE: { catchingHands: 0.3, blocking: 0.3, strength: 0.2, speed: 0.1, playbookIQ: 0.1 }, 
    OL: { strength: 0.4, blocking: 0.4, weight: 0.1, playbookIQ: 0.1 },
    DL: { strength: 0.4, tackling: 0.25, blockShedding: 0.2, weight: 0.1, agility: 0.05 },
    LB: { tackling: 0.3, speed: 0.2, strength: 0.2, blockShedding: 0.1, playbookIQ: 0.2 },
    DB: { speed: 0.35, agility: 0.25, catchingHands: 0.15, tackling: 0.1, playbookIQ: 0.15 }
};

export function estimateBestPosition(scoutedPlayer) {
    if (!scoutedPlayer || !scoutedPlayer.attributes) {
        return 'UTIL';
    }

    const resolveAttr = (val) => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
            if (val.includes('-')) {
                const [min, max] = val.split('-').map(Number);
                return (min + max) / 2;
            }
            // FIX #4: Handle exact string numbers correctly
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

    const tempPlayer = {
        ...scoutedPlayer,
        attributes: cleanAttributes
    };

    let bestPos = 'UTIL';
    let maxScore = -Infinity;
    const positions = Object.keys(positionOverallWeights);

    for (const pos of positions) {
        const score = calculateOverall(tempPlayer, pos);
        if (score > maxScore) {
            maxScore = score;
            bestPos = pos;
        }
    }

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
                if (attr === 'weight') value = (value || 100) / 2.5;
                // FIX #2: Map height to a 0-100 scale so it matches standard math
                if (attr === 'height') value = ((value || 60) - 50) * 4; 
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
                if (attr === 'weight') value = value / 2.5;
                // FIX #2: Apply same height scaling fix here
                if (attr === 'height') value = (value - 50) * 4; 
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
/**
 * Generates a new player object with balanced stats.
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

    // 2. Define Attribute Tiers (0-99 Scale)
    const tiers = {
        'Elite': { min: 90, max: 99 },
        'Great': { min: 80, max: 89 },
        'Good': { min: 70, max: 79 },
        'Average': { min: 55, max: 69 },
        'Poor': { min: 40, max: 54 },
        'Terrible': { min: 20, max: 39 }
    };

    // 3. Define Key Attributes (Higher chance of good rolls)
    const getKeyAttributes = (pos) => {
        switch (pos) {
            case 'QB': return ['throwingAccuracy', 'playbookIQ', 'consistency'];
            case 'RB': return['speed', 'agility', 'strength', 'toughness'];
            case 'WR': return['speed', 'catchingHands', 'agility'];
            case 'TE': return['catchingHands', 'blocking', 'strength', 'toughness']; // 💡 FIX: Added TE
            case 'OL': return['strength', 'blocking', 'toughness'];
            case 'DL': return ['strength', 'blockShedding', 'tackling'];
            case 'LB': return['tackling', 'playbookIQ', 'strength', 'speed'];
            case 'DB': return['speed', 'agility', 'catchingHands'];
            default: return[];
        }
    };
    const keyAttrs = new Set(getKeyAttributes(bestPosition));

    // 4. Base Generator
    const generateAttributeValue = (attributeName) => {
        const isKey = keyAttrs.has(attributeName);
        const roll = Math.random();
        let tier;

        if (isKey) {
            if (roll < 0.15) tier = 'Elite';       // 15%
            else if (roll < 0.40) tier = 'Great';  // 25%
            else if (roll < 0.75) tier = 'Good';   // 35%
            else if (roll < 0.95) tier = 'Average';// 20%
            else tier = 'Poor';                    // 5%
        } else {
            if (roll < 0.02) tier = 'Elite';       // 2% (Freak)
            else if (roll < 0.10) tier = 'Great';  // 8%
            else if (roll < 0.30) tier = 'Good';   // 20%
            else if (roll < 0.70) tier = 'Average';// 40%
            else if (roll < 0.90) tier = 'Poor';   // 20%
            else tier = 'Terrible';                // 10%
        }
        return getRandomInt(tiers[tier].min, tiers[tier].max);
    };

    // 5. Generate Raw Attributes
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
            blockShedding: generateAttributeValue('blockShedding')
        }
    };

    // 5.5 FIX: Calculate Potential BEFORE applying Archetype nerfs and Age scaling!
    // Otherwise, Linemen always get 'F' potential because their speed is naturally slashed.
    let baseRawSum = 0; let baseCount = 0;
    keyAttrs.forEach(attr => {
        for (const cat in attributes) {
            if (attributes[cat][attr] !== undefined) {
                baseRawSum += attributes[cat][attr];
                baseCount++;
            }
        }
    });
    
    const avgTalent = baseCount > 0 ? (baseRawSum / baseCount) : 50; 
    let potential = 'F';
    const potentialRoll = avgTalent + getRandomInt(-5, 12); // Add a little variance

    if (potentialRoll >= 90) potential = 'A';
    else if (potentialRoll >= 80) potential = 'B';
    else if (potentialRoll >= 70) potential = 'C';
    else if (potentialRoll >= 60) potential = 'D';

    // 6. BALANCE FIX: Apply Position Archetype Multipliers
    // This ensures a 99 Speed Lineman is still slower than a 99 Speed WR.
    const applyArchetypeModifiers = () => {
        if (['OL', 'DL'].includes(bestPosition)) {
            attributes.physical.speed *= 0.65; 
            attributes.physical.agility *= 0.60;
            attributes.physical.strength *= 1.2; 
        } else if (['LB', 'QB', 'TE'].includes(bestPosition)) { 
            attributes.physical.speed *= 0.85;
            attributes.physical.agility *= 0.80;
        } else {
            attributes.physical.speed *= 1.05; 
            attributes.physical.agility *= 1.05;
        }

        if (['WR', 'DB', 'RB'].includes(bestPosition)) {
            attributes.technical.blocking *= 0.5; 
        }
    };
    applyArchetypeModifiers();

    // 7. Calculate Body Type
    const ageProgress = (age - 10) / (16 - 10); // 0.0 to 1.0
    
    let height = 55 + (ageProgress * 15) + getRandomInt(-3, 5); 
    let weight = 70 + (ageProgress * 90) + getRandomInt(-15, 20); 

    if (['OL', 'DL'].includes(bestPosition)) {
        weight *= 1.4; // 40% heavier
        attributes.physical.strength += 10; // 💡 FIX: Applied BEFORE the 99 clamp!
    } else if (['WR', 'DB'].includes(bestPosition)) {
        weight *= 0.9; // 10% lighter
    }

    attributes.physical.height = Math.round(height);
    attributes.physical.weight = Math.round(weight);

    // 8. Age Scaling (Tweaked for Balance)
    const physicalScale = 0.70 + (ageProgress * 0.30); // Kids are 70% of adult speed
    const mentalScale = 0.50 + (ageProgress * 0.50);   // Kids are 50% of adult IQ
    
    Object.keys(attributes).forEach(cat => {
        Object.keys(attributes[cat]).forEach(attr => {
            if (['height', 'weight', 'clutch'].includes(attr)) return;
            
            let factor = (cat === 'physical') ? physicalScale : mentalScale;
            if (attr === 'speed' || attr === 'agility') factor += 0.1; 

            let val = attributes[cat][attr] * factor;
            // 💡 FIX: Ensure no stat goes above 99 here
            attributes[cat][attr] = Math.max(20, Math.min(99, Math.round(val)));
        });
    });

    // 9. Determine Potential (Same as before)
    let rawSum = 0; let count = 0;
        Object.keys(attributes).forEach(cat => {
            Object.keys(attributes[cat]).forEach(attr => {
                if (['height', 'weight', 'clutch'].includes(attr)) return;
                
                const scaler = (cat === 'physical') ? physicalScale : mentalScale;
                let factor = scaler;
                if (attr === 'speed' || attr === 'agility') factor += 0.1; // Re-apply the speed exception
                
                rawSum += attributes[cat][attr] / factor; // Divide by the TRUE factor, not just the scaler
                count++;
            });
        });

    if (potentialRoll >= 90) potential = 'A';
    else if (potentialRoll >= 80) potential = 'B';
    else if (potentialRoll >= 70) potential = 'C';
    else if (potentialRoll >= 60) potential = 'D';
    
    const initialStats = {
        receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0,
        tackles: 0, sacks: 0, interceptions: 0, passAttempts: 0, passCompletions: 0, interceptionsThrown: 0
    };

    return {
        id: crypto.randomUUID(),
        name: `${firstName} ${lastName}`,
        age,
        favoriteOffensivePosition,
        favoriteDefensivePosition,
        number: getRandomInt(1, 99),
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
