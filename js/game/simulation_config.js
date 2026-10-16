// js/game/simulation_config.js

export const SIMULATION_HZ = 25;
export const TICK_DURATION_SECONDS = 1 / SIMULATION_HZ;
export const TICK_DURATION_MS = 1000 / SIMULATION_HZ;

export const PHYSICS_REFERENCE_HZ = 20;
export const PHYSICS_REFERENCE_TICK_SECONDS = 1 / PHYSICS_REFERENCE_HZ;

export function getPlaybackIntervalMs(rate = 1) {
    const multiplier = Number(rate);
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
        return Math.max(1, Math.round(TICK_DURATION_MS));
    }
    return Math.max(1, Math.round(TICK_DURATION_MS / multiplier));
}

export const DEFAULT_PLAYBACK_INTERVAL_MS = getPlaybackIntervalMs();

// Exponential decay scaling (multipliers applied per tick, e.g. friction)
export function scalePerTickFactor(factor, elapsedSeconds = TICK_DURATION_SECONDS) {
    if (!Number.isFinite(factor) || factor < 0) return 1;
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return 1;
    return Math.pow(factor, elapsedSeconds / PHYSICS_REFERENCE_TICK_SECONDS);
}

// Alpha interpolation scaling (LERP smoothing applied per tick)
export function scalePerTickAlpha(alpha, elapsedSeconds = TICK_DURATION_SECONDS) {
    if (!Number.isFinite(alpha)) return 0;
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return 0;
    const boundedAlpha = Math.max(0, Math.min(1, alpha));
    return 1 - Math.pow(1 - boundedAlpha, elapsedSeconds / PHYSICS_REFERENCE_TICK_SECONDS);
}

// Linear rate scaling (accumulators added per tick, e.g. fatigue drain)
export function scalePerTickRate(ratePerTick, elapsedSeconds = TICK_DURATION_SECONDS) {
    if (!Number.isFinite(ratePerTick)) return 0;
    return ratePerTick * (elapsedSeconds / PHYSICS_REFERENCE_TICK_SECONDS);
}

export function secondsToTicks(seconds) {
    const duration = Number(seconds);
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    return Math.ceil(duration * SIMULATION_HZ);
}

export function ticksToSeconds(ticks) {
    const count = Number(ticks);
    if (!Number.isFinite(count) || count <= 0) return 0;
    return count * TICK_DURATION_SECONDS;
}
