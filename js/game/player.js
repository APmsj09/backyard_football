// player.js - player generation and rating helpers

import { getRandom, getRandomInt, estimateBestPosition } from '../utils.js';
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
 * Estimates the best position for a player based on scouted attributes and size.
 * @param {object} scoutedPlayer - The player object, potentially with ranged attributes from scouting.
 * @returns {string} The abbreviation of the estimated best position (e.g., "WR", "LB"). Returns 'UTIL' if uncertain.
 */
export function estimateBestPosition(scoutedPlayer) {
    if (!scoutedPlayer?.attributes?.physical) {
        return 'UTIL'; // Utility / Unknown if no physicals
    }

    const attrs = scoutedPlayer.attributes;
    const { height, weight, speed, strength, agility } = attrs.physical;
    const { throwingAccuracy, catchingHands, tackling, blocking, blockShedding } = attrs.technical || {};
    const { playbookIQ } = attrs.mental || {};

    // Helper to get midpoint or single value
    const getAttrValue = (attr) => {
        if (typeof attr === 'number') {
            return attr;
        }
        if (typeof attr === 'string' && attr.includes('-')) {
            const [low, high] = attr.split('-').map(Number);
            return (low + high) / 2; // Use midpoint
        }
        return 30; // Default low value
    };

    const h = getAttrValue(height);
    const w = getAttrValue(weight);
    const spd = getAttrValue(speed);
    const str = getAttrValue(strength);
    const agi = getAttrValue(agility);
    const thr = getAttrValue(throwingAccuracy);
    const cat = getAttrValue(catchingHands);
    const tkl = getAttrValue(tackling);
    const blk = getAttrValue(blocking);
    const bsh = getAttrValue(blockShedding);
    const pIQ = getAttrValue(playbookIQ);

    // --- 🛠️ NEW: Normalized Height & Weight Values ---
    // We apply the same logic from game.js's calculateOverall
    const h_norm = Math.max(0, (h - 60)); // e.g., 72" = 12 points
    const w_norm = Math.max(0, (w / 2.5)); // e.g., 200lbs = 80 points
    // --- END NEW ---

    const scores = {
        QB: 0, RB: 0, WR: 0, OL: 0, DL: 0, LB: 0, DB: 0,
    };

    // --- Scoring Logic (Weights are approximate, adjust as needed) ---

    // QB Score
    scores.QB = (thr * 0.5) + (pIQ * 0.3) + (spd * 0.1) + (agi * 0.1);
    if (h < 65 || w > 200) scores.QB *= 0.7;

    // RB Score
    scores.RB = (spd * 0.3) + (str * 0.2) + (agi * 0.3) + (cat * 0.1) + (blk * 0.1);
    if (h > 72 || w < 130) scores.RB *= 0.8;

    // WR Score
    // 🛠️ USE NORMALIZED HEIGHT
    scores.WR = (spd * 0.4) + (cat * 0.4) + (agi * 0.2) + (h_norm * 0.1);
    if (w > 210 || str < 40) scores.WR *= 0.8;

    // OL Score
    // 🛠️ USE NORMALIZED WEIGHT
    scores.OL = (str * 0.5) + (blk * 0.4) + (w_norm * 0.2);
    if (spd > 70 || agi > 65 || w < 160) scores.OL *= 0.6;

    // DL Score
    // 🛠️ USE NORMALIZED WEIGHT
    scores.DL = (str * 0.5) + (bsh * 0.3) + (tkl * 0.1) + (w_norm * 0.15);
    if (spd > 65 || agi > 60 || w < 150) scores.DL *= 0.7;

    // LB Score
    scores.LB = (tkl * 0.3) + (spd * 0.2) + (str * 0.2) + (bsh * 0.1) + (pIQ * 0.2);
    if (h < 66 || w < 140) scores.LB *= 0.9;

    // DB Score
    scores.DB = (spd * 0.4) + (agi * 0.3) + (cat * 0.15) + (tkl * 0.05) + (pIQ * 0.1);
    if (w > 190 || str > 70) scores.DB *= 0.8;

    // --- Find Best Score ---
    let bestPos = 'UTIL';
    let maxScore = -1;
    for (const pos in scores) {
        if (scores[pos] > maxScore) {
            maxScore = scores[pos];
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

    const favoriteOffensivePosition = getRandom(offensivePositions);
    const favoriteDefensivePosition = getRandom(defensivePositions);
    const isOffenseStar = Math.random() < 0.5;
    const bestPosition = isOffenseStar ? favoriteOffensivePosition : favoriteDefensivePosition;

    const ageProgress = (age - 10) / (16 - 10);
    let baseHeight = 55 + (ageProgress * 15) + getRandomInt(-2, 2);
    let baseWeight = 70 + (ageProgress * 90) + getRandomInt(-10, 10);

    switch (bestPosition) {
        case 'QB': case 'WR': baseHeight += getRandomInt(1, 4); baseWeight -= getRandomInt(0, 10); break;
        case 'OL': case 'DL': baseHeight -= getRandomInt(0, 2); baseWeight += getRandomInt(20, 40); break;
        case 'RB': baseWeight += getRandomInt(5, 15); break;
    }

    const boostRanges = {
        'Elite': { min: 90, max: 99 },
        'Good': { min: 80, max: 90 },
        'Average': { min: 70, max: 80 },
        'Below Average': { min: 60, max: 70 },
        'Poor': { min: 40, max: 60 }
    };

    const getTalentData = (roll) => {
        if (roll < 0.02) return { tier: 'Elite', bonus: -0.20, range: boostRanges['Elite'] };
        if (roll < 0.12) return { tier: 'Good', bonus: -0.10, range: boostRanges['Good'] };
        if (roll < 0.72) return { tier: 'Average', bonus: 0.0, range: boostRanges['Average'] };
        if (roll < 0.92) return { tier: 'Below Average', bonus: 0.10, range: boostRanges['Below Average'] };
        return { tier: 'Poor', bonus: 0.20, range: boostRanges['Poor'] };
    };

    const physicalData = getTalentData(Math.random());
    const technicalData = getTalentData(Math.random());
    const mentalData = getTalentData(Math.random());

    let attributes = {
        physical: {
            speed: getRandomInt(physicalData.range.min, physicalData.range.max),
            strength: getRandomInt(physicalData.range.min, physicalData.range.max),
            agility: getRandomInt(physicalData.range.min, physicalData.range.max),
            stamina: getRandomInt(physicalData.range.min + 5, physicalData.range.max + 5),
            height: Math.round(baseHeight),
            weight: Math.round(baseWeight)
        },
        mental: {
            playbookIQ: getRandomInt(mentalData.range.min, mentalData.range.max),
            clutch: getRandomInt(20, 90),
            consistency: getRandomInt(mentalData.range.min, mentalData.range.max),
            toughness: getRandomInt(mentalData.range.min, mentalData.range.max)
        },
        technical: {
            throwingAccuracy: getRandomInt(technicalData.range.min, technicalData.range.max),
            catchingHands: getRandomInt(technicalData.range.min, technicalData.range.max),
            tackling: getRandomInt(technicalData.range.min, technicalData.range.max),
            blocking: getRandomInt(technicalData.range.min, technicalData.range.max),
            blockShedding: getRandomInt(technicalData.range.min, technicalData.range.max)
        }
    };

    const posBonus = 10;
    switch (bestPosition) {
        case 'QB':
            attributes.technical.throwingAccuracy += posBonus;
            attributes.mental.playbookIQ += posBonus;
            break;
        case 'RB':
            attributes.physical.agility += posBonus;
            attributes.physical.strength += posBonus;
            break;
        case 'WR':
            attributes.physical.speed += posBonus;
            attributes.technical.catchingHands += posBonus;
            break;
        case 'OL':
            attributes.physical.strength += posBonus;
            attributes.technical.blocking += posBonus;
            break;
        case 'DL':
            attributes.physical.strength += posBonus;
            attributes.technical.blockShedding += posBonus;
            break;
        case 'LB':
            attributes.technical.tackling += posBonus;
            attributes.mental.playbookIQ += posBonus;
            break;
        case 'DB':
            attributes.physical.speed += posBonus;
            attributes.physical.agility += posBonus;
            break;
    }

    const ageScalingFactor = 0.90 + (ageProgress * 0.10);
    Object.keys(attributes).forEach(cat => {
        Object.keys(attributes[cat]).forEach(attr => {
            if (typeof attributes[cat][attr] === 'number' && !['height', 'weight', 'clutch'].includes(attr)) {
                attributes[cat][attr] = attributes[cat][attr] * ageScalingFactor;
            }
        });
    });

    const neutralWeight = 70 + (ageProgress * 90) + (['OL', 'DL'].includes(bestPosition) ? 30 : 0);
    const weightModifier = (attributes.physical.weight - neutralWeight) / 25;
    attributes.physical.strength += (weightModifier * 10);
    attributes.physical.speed -= (weightModifier * 6);
    attributes.physical.agility -= (weightModifier * 4);

    Object.keys(attributes).forEach(cat => {
        Object.keys(attributes[cat]).forEach(attr => {
            if (typeof attributes[cat][attr] === 'number' && !['height', 'weight'].includes(attr)) {
                attributes[cat][attr] = Math.max(1, Math.min(99, Math.round(attributes[cat][attr])));
            }
        });
    });

    let potential = 'F';

    const potentialBonus = (physicalData.bonus + technicalData.bonus + mentalData.bonus) / 3;

    let potentialRoll = Math.random() + potentialBonus;
    potentialRoll = Math.max(0, Math.min(1, potentialRoll));

    if (age <= 11) potentialRoll -= 0.15;
    else if (age <= 13) potentialRoll -= 0.05;

    if (potentialRoll < 0.20) potential = 'A';
    else if (potentialRoll < 0.45) potential = 'B';
    else if (potentialRoll < 0.75) potential = 'C';
    else if (potentialRoll < 0.90) potential = 'D';
    else potential = 'F';

    const initialStats = {
        receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0,
        tackles: 0, sacks: 0, interceptions: 0,
        passAttempts: 0, passCompletions: 0, interceptionsThrown: 0
    };

    return {
        id: crypto.randomUUID(), name: `${firstName} ${lastName}`, age,
        favoriteOffensivePosition, favoriteDefensivePosition,
        number: null,
        potential, attributes, teamId: null,
        status: { type: 'healthy', description: '', duration: 0 }, fatigue: 0,
        gameStats: { ...initialStats }, seasonStats: { ...initialStats },
        careerStats: { ...initialStats, seasonsPlayed: 0 }
    };
}
