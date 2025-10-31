/**
 * Gets a random element from an array.
 * @param {Array} arr - The array to pick from.
 * @returns {*} A random element from the array.
 */
export function getRandom(arr) {
    if (!arr || arr.length === 0) return undefined;
    return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Gets a random integer between two values, inclusive.
 * @param {number} min - The minimum value.
 * @param {number} max - The maximum value.
 * @returns {number} A random integer.
 */
export function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    // Ensure min is not greater than max after flooring/ceiling
    if (min > max) {
        [min, max] = [max, min]; // Swap if necessary
    }
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

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
 * Converts total inches to a feet'inches" string format.
 * @param {number} totalInches - The height in inches.
 * @returns {string} The height formatted as X' Y". Returns '?' if input is invalid.
 */
export function formatHeight(totalInches) {
    if (typeof totalInches !== 'number' || totalInches <= 0) {
        return '?';
    }
    const feet = Math.floor(totalInches / 12);
    const inches = totalInches % 12;
    return `${feet}' ${inches}"`;
}