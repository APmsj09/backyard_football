// js/game/movement_profile.js

// Initial youth-football movement model.
// Speeds are measured in yards per second.
export const MOVEMENT_MODEL = Object.freeze({
    // Supported player ages
    minAge: 8,
    maxAge: 18,
    fallbackAge: 12,

    // Top speed, in yards per second (Tuned down for realistic youth/HS speed)
    // 4.8 + 3.8 = 8.6 YPS max (approx 4.6 40-yard dash for an elite 99-speed 18yo)
    baseSpeedYPS: 4.8,
    speedRatingBonusYPS: 3.8,
    
    // Expected body weight by age (75 at 8yo, ~195 at 18yo)
    weightAtMinAgeLbs: 75,
    weightPerYearLbs: 12, // Increased from 10 to match physics.js curve

    // Top-speed penalty for weight above the age-based expectation
    // Increased penalty so heavy linemen lumber more realistically
    speedWeightPenaltyPerLb: 0.0015,
    minimumSpeedWeightFactor: 0.75,

    // Acceleration, in yards per second squared (Tuned down to add weight/inertia)
    baseAccelerationYPS2: 2.2,
    explosivenessAccelerationBonusYPS2: 2.6,
    agilityAccelerationBonusYPS2: 0.45,

    // Acceleration penalty for weight above the age-based expectation
    weightAccelerationPenaltyPerLb: 0.0015,
    minimumAccelerationWeightFactor: 0.70
});

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function clampRating(value, fallback = 50) {
    const parsed = Number(value);

    return clamp(
        Number.isFinite(parsed) ? parsed : fallback,
        0,
        100
    );
}

function getPlayerAge(player = {}) {
    const rawAge =
        player.age ??
        player.playerAge ??
        player.yearsOld;

    const parsedAge = Number(rawAge);

    return clamp(
        Number.isFinite(parsedAge)
            ? parsedAge
            : MOVEMENT_MODEL.fallbackAge,
        MOVEMENT_MODEL.minAge,
        MOVEMENT_MODEL.maxAge
    );
}

function getPhysicalRating(
    player,
    directKeys,
    physicalKey,
    fallback = 50
) {
    for (const key of directKeys) {
        if (player?.[key] != null) {
            return clampRating(player[key], fallback);
        }
    }

    return clampRating(
        player?.attributes?.physical?.[physicalKey],
        fallback
    );
}

function getExpectedWeight(age) {
    return (
        MOVEMENT_MODEL.weightAtMinAgeLbs +
        (
            (age - MOVEMENT_MODEL.minAge) *
            MOVEMENT_MODEL.weightPerYearLbs
        )
    );
}

function getPlayerWeight(player, expectedWeight) {
    const rawWeight =
        player?.weight ??
        player?.wgt ??
        player?.attributes?.physical?.weight;

    const parsedWeight = Number(rawWeight);

    return Number.isFinite(parsedWeight) && parsedWeight > 0
        ? parsedWeight
        : expectedWeight;
}

function getWeightFactor(
    weight,
    expectedWeight,
    penaltyPerLb,
    minimumFactor
) {
    const excessWeight = Math.max(0, weight - expectedWeight);

    return Math.max(
        minimumFactor,
        1 - (excessWeight * penaltyPerLb)
    );
}

/**
 * Estimates a player's top running speed in yards per second.
 *
 * The current speed rating already reflects age-based development.
 * Age additionally determines the expected-weight baseline.
 */
export function getPlayerBaseSpeedYPS(player = {}) {
    const age = getPlayerAge(player);

    const speed = getPhysicalRating(
        player,
        ['speed', 'spd'],
        'speed'
    );

    const expectedWeight = getExpectedWeight(age);
    const weight = getPlayerWeight(player, expectedWeight);

    const weightFactor = getWeightFactor(
        weight,
        expectedWeight,
        MOVEMENT_MODEL.speedWeightPenaltyPerLb,
        MOVEMENT_MODEL.minimumSpeedWeightFactor
    );

    const baseSpeed =
        MOVEMENT_MODEL.baseSpeedYPS +
        (
            (speed / 100) *
            MOVEMENT_MODEL.speedRatingBonusYPS
        );

    return baseSpeed * weightFactor;
}

/**
 * Estimates acceleration in yards per second squared.
 *
 * Explosiveness controls how quickly a player accelerates.
 * Agility has a smaller influence. Weight reduces acceleration
 * when it substantially exceeds the age-based expectation.
 *
 * Age is not given a second direct acceleration bonus because
 * the player's current Explosiveness rating already reflects
 * age-based development in player generation.
 */
export function getPlayerAccelerationYPS2(player = {}) {
    const age = getPlayerAge(player);

    const explosiveness = getPhysicalRating(
        player,
        ['explosiveness', 'exp'],
        'explosiveness'
    );

    const agility = getPhysicalRating(
        player,
        ['agility', 'agi'],
        'agility'
    );

    const expectedWeight = getExpectedWeight(age);
    const weight = getPlayerWeight(player, expectedWeight);

    const weightFactor = getWeightFactor(
        weight,
        expectedWeight,
        MOVEMENT_MODEL.weightAccelerationPenaltyPerLb,
        MOVEMENT_MODEL.minimumAccelerationWeightFactor
    );

    const acceleration =
        MOVEMENT_MODEL.baseAccelerationYPS2 +
        (
            (explosiveness / 100) *
            MOVEMENT_MODEL.explosivenessAccelerationBonusYPS2
        ) +
        (
            ((agility / 100) - 0.5) *
            MOVEMENT_MODEL.agilityAccelerationBonusYPS2
        );

    // Lowered floor to allow heavy linemen to be slower off the snap
    return Math.max(1.8, acceleration * weightFactor);
}
