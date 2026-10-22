
 // js/game/decision_model.js

const clamp = (value, min = 0, max = 100) =>
    Math.max(min, Math.min(max, value));

function readStat(value, fallback = 50) {
    if (value === null || value === undefined) return fallback;

    const number = Number(value);
    return Number.isFinite(number) ? clamp(number) : fallback;
}

/**
 * Shared decision profile for on-field AI.
 *
 * IQ influences interpretation and anticipation.
 * Consistency influences decision reliability.
 * Experience improves recognition.
 * Personality influences assignment discipline and risk tolerance.
 *
 * Reuses one profile object per player state instead of allocating
 * a new object every time a decision system requests it.
 */
export function getDecisionProfile(playerState, tick = null) {
    if (!playerState || typeof playerState !== 'object') {
        return null;
    }

    let profile = playerState._decisionProfile;

    if (
        Number.isFinite(tick) &&
        playerState._decisionProfileTick === tick &&
        profile
    ) {
        return profile;
    }

    if (!profile) {
        profile = {};
        playerState._decisionProfile = profile;
    }

    const personality = playerState.personality || {};

    const iq = readStat(
        playerState.playbookIQ ?? playerState.iq
    );

    const consistency = readStat(
        playerState.consistency ?? playerState.cons
    );

    const decisionMaking = readStat(
        playerState.decisionMaking,
        iq
    );

    const dependability = readStat(personality.dependability);
    const workEthic = readStat(personality.workEthic);
    const ego = readStat(personality.ego);
    const streetCred = readStat(personality.streetCred);

    const seasonsPlayed = Number(playerState.experienceSeasons);
    const snapsThisSeason = Number(playerState.experienceSnaps);
    const hasExplicitCareerData = Number.isFinite(seasonsPlayed) || Number.isFinite(snapsThisSeason);

    // If a player doesn't have career data yet (e.g., brand new walk-on), 
    // base their "experience" (instincts) on their raw Football IQ rather than penalizing them with 0.
    const experience = hasExplicitCareerData
        ? clamp(((seasonsPlayed || 0) * 10) + Math.min(60, Math.sqrt(snapsThisSeason || 0) * 3))
        : clamp(iq * 0.85);

    const awareness = clamp(
        (iq * 0.68) +
        (consistency * 0.17) +
        (experience * 0.15),
        15,
        99
    );

    const decisionQuality = clamp(
        (awareness * 0.55) +
        (decisionMaking * 0.30) +
        (consistency * 0.15),
        15,
        99
    );

    // Discipline is 100% personality-driven. A highly dependable player holds his lane 
    // better than a lazy, undependable player.
    const assignmentDiscipline = clamp(
        (dependability * 0.65) +
        (consistency * 0.20) +
        (workEthic * 0.15),
        15,
        95
    );

    // Ego/street cred make players somewhat more willing to take risks;
    // dependability tempers that tendency. Personality is a bias, not destiny.
    const riskTolerance = clamp(
        1.0 +
        ((ego - 50) * 0.0015) +
        ((streetCred - 50) * 0.0007) +
        ((50 - dependability) * 0.0008),
        0.90,
        1.10
    );

    profile.iq = iq;
    profile.consistency = consistency;
    profile.decisionMaking = decisionMaking;
    profile.experience = experience;
    profile.awareness = awareness;
    profile.decisionQuality = decisionQuality;
    profile.assignmentDiscipline = assignmentDiscipline;
    profile.riskTolerance = riskTolerance;

    if (Number.isFinite(tick)) {
        playerState._decisionProfileTick = tick;
    }

    return profile;
}
