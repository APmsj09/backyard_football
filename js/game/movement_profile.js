// js/game/movement_profile.js

// Initial youth-football movement model.
// Speeds are measured in yards per second.
export const MOVEMENT_MODEL = Object.freeze({
    minAge: 8,
    maxAge: 18,
    fallbackAge: 12,

    youngestBaseSpeedYPS: 5.4,
    maturityBaseSpeedBonusYPS: 1.5,

    youngestSpeedRatingBonusYPS: 1.5,
    maturitySpeedRatingBonusYPS: 1.5,

    weightAtMinAgeLbs: 75,
    weightPerYearLbs: 10,
    weightPenaltyPerExcessLb: 0.0012,
    minimumWeightSpeedFactor: 0.82
});

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export function getPlayerBaseSpeedYPS(player) {
    const rawAge =
        player.age ??
        player.playerAge ??
        player.yearsOld ??
        player.attributes?.age;

    const parsedAge = Number(rawAge);

    const age = clamp(
        Number.isFinite(parsedAge)
            ? parsedAge
            : MOVEMENT_MODEL.fallbackAge,
        MOVEMENT_MODEL.minAge,
        MOVEMENT_MODEL.maxAge
    );

    const maturity =
        (age - MOVEMENT_MODEL.minAge) /
        (MOVEMENT_MODEL.maxAge - MOVEMENT_MODEL.minAge);

    const rawSpeed =
        player.speed ??
        player.spd ??
        player.speedStat ??
        player.attributes?.physical?.speed;

    const parsedSpeed = Number(rawSpeed);
    const speedRating = clamp(
        Number.isFinite(parsedSpeed) ? parsedSpeed : 50,
        0,
        100
    ) / 100;

    const expectedWeight =
        MOVEMENT_MODEL.weightAtMinAgeLbs +
        ((age - MOVEMENT_MODEL.minAge) *
            MOVEMENT_MODEL.weightPerYearLbs);

    const rawWeight =
        player.weight ??
        player.wgt ??
        player.attributes?.physical?.weight;

    const parsedWeight = Number(rawWeight);
    const weight = Number.isFinite(parsedWeight) && parsedWeight > 0
        ? parsedWeight
        : expectedWeight;

    const ageAdjustedBase =
        MOVEMENT_MODEL.youngestBaseSpeedYPS +
        (maturity * MOVEMENT_MODEL.maturityBaseSpeedBonusYPS);

    const speedRatingBonus =
        speedRating *
        (
            MOVEMENT_MODEL.youngestSpeedRatingBonusYPS +
            (maturity * MOVEMENT_MODEL.maturitySpeedRatingBonusYPS)
        );

    // Extra weight can reduce top speed; lower weight never grants
    // an automatic speed bonus.
    const excessWeight = Math.max(0, weight - expectedWeight);

    const weightFactor = Math.max(
        MOVEMENT_MODEL.minimumWeightSpeedFactor,
        1 - (
            excessWeight *
            MOVEMENT_MODEL.weightPenaltyPerExcessLb
        )
    );

    return (ageAdjustedBase + speedRatingBonus) * weightFactor;
}
