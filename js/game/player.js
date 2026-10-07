// js/game/player.js - Player Generation & Rating System

import { getRandom, getRandomInt } from '../utils.js';
import { firstNames, lastNames, nicknames, offenseFormations, defenseFormations, cliques } from '../data.js';

const offensivePositions = ['QB', 'RB', 'WR', 'TE', 'OL'];
const defensivePositions = ['DL', 'LB', 'DB'];

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

    // Respect explicit identity if already assigned
    if (scoutedPlayer.bestPosition) return scoutedPlayer.bestPosition;
    if (scoutedPlayer.pos) return scoutedPlayer.pos;

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
    const offPos = tempPlayer.favoriteOffensivePosition;
    const defPos = tempPlayer.favoriteDefensivePosition;

    if (offPos && defPos) {
        const offScore = calculateOverall(tempPlayer, offPos);
        const defScore = calculateOverall(tempPlayer, defPos);
        return offScore >= defScore ? offPos : defPos;
    }

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
            const weightKey = attr === 'passCoverage' ? 'coverage' : attr;

            if (relevantWeights[weightKey]) {
                let value = attrs[category][attr];

                if (weightKey === 'weight') {
                    // OLD: value = Math.max(0, Math.min(100, (value - 100) * 0.66 + 40));
                    // NEW: Weight gives a smaller raw OVR boost, keeping OL balanced with WR/QB
                    value = Math.max(0, Math.min(100, (value - 120) * 0.5 + 30));
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
    { name: 'Field General', off: 'QB', def: 'LB', weightMod: 1.1, heightMod: 2, keyAttrs: ['playbookIQ', 'throwingAccuracy', 'consistency', 'tackling'], speedMod: 0.85, strMod: 1.0 },
    { name: 'Scrambler', off: 'QB', def: 'DB', weightMod: 0.95, heightMod: -1, keyAttrs: ['speed', 'agility', 'throwingAccuracy', 'stamina'], speedMod: 1.2, strMod: 0.85 },
    { name: 'Gunslinger', off: 'QB', def: 'DB', weightMod: 1.05, heightMod: 3, keyAttrs: ['throwingAccuracy', 'strength', 'clutch', 'playbookIQ'], speedMod: 0.9, strMod: 1.25 },
    { name: 'Heavy Crusher QB', off: 'QB', def: 'DL', weightMod: 1.4, heightMod: 4, keyAttrs: ['strength', 'throwingAccuracy', 'toughness', 'blockShedding'], speedMod: 0.65, strMod: 1.3 },

    // --- BALL CARRIERS ---
    { name: 'Power Back', off: 'RB', def: 'LB', weightMod: 1.25, heightMod: -1, keyAttrs: ['strength', 'toughness', 'tackling', 'stamina'], speedMod: 0.9, strMod: 1.2 },
    { name: 'Speed Back', off: 'RB', def: 'DB', weightMod: 0.85, heightMod: -2, keyAttrs: ['speed', 'agility', 'clutch', 'catchingHands'], speedMod: 1.25, strMod: 0.75 },
    { name: 'Workhorse', off: 'RB', def: 'LB', weightMod: 1.1, heightMod: 0, keyAttrs: ['stamina', 'consistency', 'tackling', 'toughness'], speedMod: 1.0, strMod: 1.0 },
    { name: 'Receiving Back', off: 'RB', def: 'DB', weightMod: 0.9, heightMod: -1, keyAttrs: ['catchingHands', 'agility', 'speed', 'coverage'], speedMod: 1.1, strMod: 0.8 },

    // --- PASS CATCHERS ---
    { name: 'Deep Threat', off: 'WR', def: 'DB', weightMod: 0.85, heightMod: 1, keyAttrs: ['speed', 'agility', 'clutch', 'coverage'], speedMod: 1.3, strMod: 0.7 },
    { name: 'Route Technician', off: 'WR', def: 'DB', weightMod: 1.0, heightMod: 0, keyAttrs: ['agility', 'playbookIQ', 'catchingHands', 'consistency'], speedMod: 1.0, strMod: 1.0 },
    { name: 'Red Zone Specialist', off: 'WR', def: 'LB', weightMod: 1.15, heightMod: 7, keyAttrs: ['height', 'catchingHands', 'strength', 'clutch'], speedMod: 0.8, strMod: 1.15 },
    { name: 'Slot Brawler', off: 'WR', def: 'LB', weightMod: 1.1, heightMod: 0, keyAttrs: ['toughness', 'catchingHands', 'tackling', 'strength'], speedMod: 0.95, strMod: 1.1 },

    // --- TIGHT ENDS ---
    { name: 'Vertical TE', off: 'TE', def: 'LB', weightMod: 1.3, heightMod: 5, keyAttrs: ['speed', 'catchingHands', 'height', 'playbookIQ'], speedMod: 0.9, strMod: 1.1 },
    { name: 'Jumbo Athlete', off: 'TE', def: 'DL', weightMod: 1.5, heightMod: 4, keyAttrs: ['strength', 'blocking', 'catchingHands', 'blockShedding'], speedMod: 0.75, strMod: 1.3 },
    { name: 'Lead Blocker TE', off: 'TE', def: 'LB', weightMod: 1.4, heightMod: 1, keyAttrs: ['blocking', 'strength', 'tackling', 'toughness'], speedMod: 0.8, strMod: 1.25 },
    { name: 'Hybrid Wing', off: 'TE', def: 'DB', weightMod: 1.15, heightMod: 3, keyAttrs: ['agility', 'catchingHands', 'coverage', 'speed'], speedMod: 1.0, strMod: 0.95 },

    // --- OFFENSIVE LINE ---
    { name: 'Road Grader', off: 'OL', def: 'DL', weightMod: 1.9, heightMod: 2, keyAttrs: ['strength', 'blocking', 'weight', 'toughness'], speedMod: 0.45, strMod: 1.5 },
    { name: 'Mobile Guard', off: 'OL', def: 'LB', weightMod: 1.4, heightMod: 1, keyAttrs: ['agility', 'blocking', 'playbookIQ', 'tackling'], speedMod: 0.8, strMod: 1.1 },
    { name: 'Wall Protector', off: 'OL', def: 'DL', weightMod: 1.6, heightMod: 6, keyAttrs: ['blocking', 'height', 'strength', 'consistency'], speedMod: 0.6, strMod: 1.2 },
    { name: 'Technician OL', off: 'OL', def: 'DL', weightMod: 1.5, heightMod: 3, keyAttrs: ['playbookIQ', 'blocking', 'consistency', 'blockShedding'], speedMod: 0.7, strMod: 1.1 },

    // --- DEFENSIVE LINE ---
    { name: 'Speed Rusher', off: 'OL', def: 'DL', weightMod: 1.25, heightMod: 4, keyAttrs: ['speed', 'blockShedding', 'agility', 'clutch'], speedMod: 1.05, strMod: 1.05 },
    { name: 'Run Stuffer', off: 'TE', def: 'DL', weightMod: 1.7, heightMod: 1, keyAttrs: ['strength', 'tackling', 'weight', 'toughness'], speedMod: 0.55, strMod: 1.4 },
    { name: 'Bull Rusher', off: 'OL', def: 'DL', weightMod: 1.6, heightMod: 2, keyAttrs: ['strength', 'blockShedding', 'toughness', 'blocking'], speedMod: 0.7, strMod: 1.35 },
    { name: 'Versatile End', off: 'TE', def: 'DL', weightMod: 1.4, heightMod: 4, keyAttrs: ['blockShedding', 'tackling', 'playbookIQ', 'strength'], speedMod: 0.85, strMod: 1.2 },

    // --- LINEBACKERS ---
    { name: 'Middle Hawk', off: 'RB', def: 'LB', weightMod: 1.15, heightMod: 1, keyAttrs: ['playbookIQ', 'tackling', 'coverage', 'speed'], speedMod: 1.0, strMod: 1.0 },
    { name: 'Hard Hitter', off: 'RB', def: 'LB', weightMod: 1.3, heightMod: 0, keyAttrs: ['tackling', 'strength', 'toughness', 'clutch'], speedMod: 0.9, strMod: 1.25 },
    { name: 'Blitz Specialist', off: 'WR', def: 'LB', weightMod: 1.1, heightMod: 2, keyAttrs: ['speed', 'blockShedding', 'tackling', 'agility'], speedMod: 1.15, strMod: 1.05 },
    { name: 'Coverage LB', off: 'TE', def: 'LB', weightMod: 1.05, heightMod: 3, keyAttrs: ['coverage', 'agility', 'playbookIQ', 'catchingHands'], speedMod: 1.05, strMod: 0.95 },

    // --- SECONDARY ---
    { name: 'Island Corner', off: 'WR', def: 'DB', weightMod: 0.85, heightMod: 0, keyAttrs: ['coverage', 'speed', 'agility', 'consistency'], speedMod: 1.3, strMod: 0.8 },
    { name: 'Ballhawk Safety', off: 'WR', def: 'DB', weightMod: 0.95, heightMod: 2, keyAttrs: ['catchingHands', 'playbookIQ', 'coverage', 'clutch'], speedMod: 1.1, strMod: 0.9 },
    { name: 'Nickel Stopper', off: 'RB', def: 'DB', weightMod: 1.05, heightMod: -1, keyAttrs: ['tackling', 'agility', 'speed', 'toughness'], speedMod: 1.1, strMod: 1.1 },
    { name: 'Zone Specialist', off: 'WR', def: 'DB', weightMod: 1.0, heightMod: 3, keyAttrs: ['playbookIQ', 'coverage', 'height', 'catchingHands'], speedMod: 0.95, strMod: 1.0 }
];

// Targeted signature boosts for specific archetypes
const archetypeBoosts = {
    // 🔥 BOOSTED QB & RB STATS SO THEY CAN ACTUALLY THROW/RUN EFFECTIVELY
    'Field General': { playbookIQ: 15, throwingAccuracy: 18 },
    'Scrambler': { speed: 12, agility: 12, throwingAccuracy: 10 },
    'Gunslinger': { throwingAccuracy: 15, strength: 12 },
    'Heavy Crusher QB': { strength: 12, toughness: 10, throwingAccuracy: 8 },

    'Power Back': { strength: 12, toughness: 10, speed: 6 },
    'Speed Back': { speed: 15, agility: 12 },
    'Workhorse': { stamina: 15, consistency: 12, speed: 5 },
    'Receiving Back': { catchingHands: 12, agility: 10, speed: 8 },

    'Deep Threat': { speed: 8, agility: 5 },
    'Route Technician': { agility: 7, playbookIQ: 5 },
    'Red Zone Specialist': { catchingHands: 7, strength: 5 },
    'Slot Brawler': { toughness: 6, catchingHands: 5 },

    'Vertical TE': { speed: 6, catchingHands: 6 },
    'Jumbo Athlete': { strength: 7, blocking: 6 },
    'Lead Blocker TE': { blocking: 8, strength: 6 },
    'Hybrid Wing': { agility: 6, catchingHands: 6 },

    'Road Grader': { strength: 8, blocking: 7 },
    'Mobile Guard': { agility: 7, blocking: 5 },
    'Wall Protector': { blocking: 8, consistency: 5 },
    'Technician OL': { playbookIQ: 7, blocking: 6 },

    'Speed Rusher': { speed: 7, blockShedding: 6 },
    'Run Stuffer': { strength: 8, tackling: 6 },
    'Bull Rusher': { strength: 8, blockShedding: 6 },
    'Versatile End': { blockShedding: 6, tackling: 6 },

    'Middle Hawk': { playbookIQ: 7, tackling: 6 },
    'Hard Hitter': { tackling: 7, toughness: 6 },
    'Blitz Specialist': { speed: 6, blockShedding: 6 },
    'Coverage LB': { coverage: 7, playbookIQ: 5 },

    'Island Corner': { coverage: 8, speed: 6 },
    'Ballhawk Safety': { catchingHands: 6, playbookIQ: 6 },
    'Nickel Stopper': { tackling: 6, agility: 6 },
    'Zone Specialist': { playbookIQ: 7, coverage: 6 }
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

export function generatePlayer(minAge = 10, maxAge = 18, classModifiers = null) {
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
    const primarySide = Math.random() < 0.70 ? 'offense' : 'defense';
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

    if (talentRoll < 0.05) { baseKeyMean = 84; baseNonKeyMean = 50; }       // Elite (5%)
    else if (talentRoll < 0.25) { baseKeyMean = 75; baseNonKeyMean = 42; }  // Good (20%)
    else if (talentRoll < 0.70) { baseKeyMean = 63; baseNonKeyMean = 34; }  // Average (45%)
    else { baseKeyMean = 50; baseNonKeyMean = 24; }                         // Scrub (30%)

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
            toughness: generateTalentValue('toughness')
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

    if (archetype.off !== 'QB') talentAttributes.technical.throwingAccuracy = Math.round(talentAttributes.technical.throwingAccuracy * 0.5);
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

    // 6. PHYSICAL MEASUREMENTS (Height & Weight based on Age & Archetype)
    const absoluteAgeProgress = Math.max(0, Math.min(1.0, (age - 8) / 8.0));
    const baseHeightMean = 52 + (absoluteAgeProgress * 20) + archetype.heightMod;
    let height = Math.round(gaussianRandom(baseHeightMean, 2.5));

    const baseWeightMean = (70 + (absoluteAgeProgress * 120)) * archetype.weightMod;
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

    // 8. AGE SCALING & DEVELOPMENT VARIANCE (Deriving Current Ability)
    // Scale baseline: Age 10 is scaling up to 100% by Age 18
    const ageProgress = (age - 10) / 8;
    
    // Kids hit their stride faster, and older teenagers become absolute superstars
    const basePhysicalScale = Math.max(0.55, Math.min(1.0, 0.70 + (ageProgress * 0.30)));
    const baseMentalScale = Math.max(0.45, Math.min(1.0, 0.60 + (ageProgress * 0.40)));
    const baseTechnicalScale = Math.max(0.40, Math.min(1.0, 0.55 + (ageProgress * 0.45)));

    // Player growth curve variance (some kids hit earlier growth spurts)
    const playerGrowthTempo = 1 + gaussianRandom(0, 0.05);

    let attributes = {
        physical: { height, weight },
        mental: {},
        technical: {}
    };

    Object.keys(talentAttributes).forEach(cat => {
        let baseScale = basePhysicalScale;
        if (cat === 'mental') baseScale = baseMentalScale;
        else if (cat === 'technical') baseScale = baseTechnicalScale;

        Object.keys(talentAttributes[cat]).forEach(attr => {
            if (attr === 'height' || attr === 'weight') return;

            // Attribute-specific developmental variance
            const attrVariance = 1 + gaussianRandom(0, 0.05);
            const devFactor = Math.min(1.0, baseScale * playerGrowthTempo * attrVariance);

            const rawVal = Math.round(talentAttributes[cat][attr] * devFactor);
            // Raised floor from 15 to 28 so kids have basic functional ability
            attributes[cat][attr] = Math.max(28, Math.min(99, rawVal));
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

        return `${getRandom(athleticClues)} ${getRandom(mentalClues)} ${getRandom(quirks)} ${ageLore}`;
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