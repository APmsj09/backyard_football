// js/game/simulation_config.js

// Change this one value to change the simulation update rate.
export const SIMULATION_HZ = 25;

export const TICK_DURATION_SECONDS = 1 / SIMULATION_HZ;
export const TICK_DURATION_MS = 1000 / SIMULATION_HZ;

// Reference rate for preserving behavior of systems originally
// tuned at 20 Hz.
export const PHYSICS_REFERENCE_HZ = 20;
export const PHYSICS_REFERENCE_TICK_SECONDS =
    1 / PHYSICS_REFERENCE_HZ;

// Playback rate is a multiplier: 1 = normal, 2 = double speed.
export function getPlaybackIntervalMs(rate = 1) {
    const multiplier = Number(rate);

    if (!Number.isFinite(multiplier) || multiplier <= 0) {
        return Math.max(1, Math.round(TICK_DURATION_MS));
    }

    return Math.max(1, Math.round(TICK_DURATION_MS / multiplier));
}

export const DEFAULT_PLAYBACK_INTERVAL_MS =
    getPlaybackIntervalMs(1);

// Preserve exponential decay and per-tick damping over elapsed time.
export function scalePerTickFactor(
    factor,
    elapsedSeconds = TICK_DURATION_SECONDS
) {
    if (
        !Number.isFinite(factor) ||
        factor < 0 ||
        !Number.isFinite(elapsedSeconds) ||
        elapsedSeconds <= 0
    ) {
        return 1;
    }

    return Math.pow(
        factor,
        elapsedSeconds / PHYSICS_REFERENCE_TICK_SECONDS
    );
}

// Preserve interpolation strength when the tick frequency changes.
export function scalePerTickAlpha(
    alpha,
    elapsedSeconds = TICK_DURATION_SECONDS
) {
    if (
        !Number.isFinite(alpha) ||
        !Number.isFinite(elapsedSeconds) ||
        elapsedSeconds <= 0
    ) {
        return 0;
    }

    const boundedAlpha = Math.max(0, Math.min(1, alpha));

    return 1 - Math.pow(
        1 - boundedAlpha,
        elapsedSeconds / PHYSICS_REFERENCE_TICK_SECONDS
    );
}

// Preserve a quantity accumulated per tick, such as fatigue drain.
export function scalePerTickRate(
    ratePerTick,
    elapsedSeconds = TICK_DURATION_SECONDS
) {
    if (
        !Number.isFinite(ratePerTick) ||
        !Number.isFinite(elapsedSeconds) ||
        elapsedSeconds <= 0
    ) {
        return 0;
    }

    return ratePerTick *
        (elapsedSeconds / PHYSICS_REFERENCE_TICK_SECONDS);
}

// Preserve the accumulated probability of a repeated independent
// event checked once per tick. Use only for per-tick probability checks.
export function scalePerTickProbability(
    probability,
    elapsedSeconds = TICK_DURATION_SECONDS
) {
    if (!Number.isFinite(probability)) return 0;

    const p = Math.max(0, Math.min(1, probability));

    if (p === 0 || p === 1) return p;

    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
        return 0;
    }

    return 1 - Math.pow(
        1 - p,
        elapsedSeconds / PHYSICS_REFERENCE_TICK_SECONDS
    );
}

// Convert durations in seconds to countdown ticks. Rounding up ensures
// a countdown does not expire earlier than the requested duration.
export function secondsToTicks(seconds) {
    const duration = Number(seconds);

    if (!Number.isFinite(duration) || duration <= 0) {
        return 0;
    }

    return Math.ceil(duration * SIMULATION_HZ);
}

export function ticksToSeconds(ticks) {
    const count = Number(ticks);

    if (!Number.isFinite(count) || count <= 0) {
        return 0;
    }

    return count * TICK_DURATION_SECONDS;
}
