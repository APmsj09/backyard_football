// js/game/perception.js
//
// Shared player perception system.
//
// Determines how strongly a player perceives another player based on:
// - Distance
// - Direction of attention
// - Primary and peripheral vision
// - Immediate-threat awareness
// - Player awareness (IQ and consistency)
//
// This module does not make gameplay decisions. It only returns a
// perception weight for the calling AI system to use.
//
// We reuse cached context objects to reduce allocations during simulation.
// The cache is weakly keyed by player state, so removed players can be
// garbage-collected normally.

const DEG_TO_RAD = Math.PI / 180;
const contextCache = new WeakMap();

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function readStat(value, fallback = 50) {
    if (value === null || value === undefined) {
        return fallback;
    }

    const parsed = Number(value);

    return Number.isFinite(parsed)
        ? clamp(parsed, 15, 99)
        : fallback;
}

export function getPerceptionContext(
    observer,
    tick = null,
    primaryRange = 16,
    peripheralRange = 22,
    emergencyRange = 3.25
) {
    if (
        !observer ||
        !Number.isFinite(observer.x) ||
        !Number.isFinite(observer.y)
    ) {
        return null;
    }

    const tickKey = Number.isFinite(tick) ? tick : null;

    const vx = Number.isFinite(observer.vx) ? observer.vx : 0;
    const vy = Number.isFinite(observer.vy) ? observer.vy : 0;

    const targetX = Number.isFinite(observer.targetX)
        ? observer.targetX
        : observer.x;

    const targetY = Number.isFinite(observer.targetY)
        ? observer.targetY
        : observer.y;

    const iq = readStat(observer.playbookIQ ?? observer.iq);
    const consistency = readStat(observer.consistency ?? observer.cons);

    // Awareness affects how effectively a player processes what they see.
    const awareness = clamp(
        (iq * 0.75) + (consistency * 0.25),
        15,
        99
    );

    let context = contextCache.get(observer);

    if (
        context &&
        context.tickKey === tickKey &&
        context.x === observer.x &&
        context.y === observer.y &&
        context.vx === vx &&
        context.vy === vy &&
        context.targetX === targetX &&
        context.targetY === targetY &&
        context.iq === iq &&
        context.consistency === consistency &&
        context.primaryRange === primaryRange &&
        context.peripheralRange === peripheralRange &&
        context.emergencyRange === emergencyRange &&
        context.isOffense === observer.isOffense
    ) {
        return context;
    }

    if (!context) {
        context = {};
    }

    // Estimate the direction the player is attending.
    // Prefer the current movement target, then actual momentum,
    // then a default direction based on which side they play for.
    const targetDX = targetX - observer.x;
    const targetDY = targetY - observer.y;
    const targetDistSq =
        (targetDX * targetDX) + (targetDY * targetDY);

    const speedSq = (vx * vx) + (vy * vy);

    let dirX = 0;
    let dirY = 1;

    if (targetDistSq > 0.5625) {
        const inverseTargetDist = 1 / Math.sqrt(targetDistSq);

        dirX = targetDX * inverseTargetDist;
        dirY = targetDY * inverseTargetDist;
    } else if (speedSq > 1.44) {
        const inverseSpeed = 1 / Math.sqrt(speedSq);

        dirX = vx * inverseSpeed;
        dirY = vy * inverseSpeed;
    } else {
        dirY = observer.isOffense === false ? -1 : 1;
    }

    // Better awareness modestly widens the primary attention cone.
    const primaryHalfAngle = 58 + (awareness * 0.22);

    // Peripheral vision covers the forward half-plane.
    // We keep it at 90 degrees so peripheral vision does not
    // automatically extend behind the player's attention direction.
    const peripheralHalfAngle = 90;

    context.tickKey = tickKey;

    context.x = observer.x;
    context.y = observer.y;
    context.vx = vx;
    context.vy = vy;

    context.targetX = targetX;
    context.targetY = targetY;

    context.iq = iq;
    context.consistency = consistency;
    context.awareness = awareness;
    context.isOffense = observer.isOffense;

    context.dirX = dirX;
    context.dirY = dirY;

    context.primaryRange = primaryRange;
    context.peripheralRange = peripheralRange;
    context.emergencyRange = emergencyRange;

    context.primaryRangeSq = primaryRange * primaryRange;
    context.peripheralRangeSq = peripheralRange * peripheralRange;
    context.emergencyRangeSq = emergencyRange * emergencyRange;

    context.primaryConeCos =
        Math.cos(primaryHalfAngle * DEG_TO_RAD);

    context.peripheralConeCos =
        Math.cos(peripheralHalfAngle * DEG_TO_RAD);

    // Primary vision has a strong influence on decisions.
    context.primaryWeight =
        0.65 + ((awareness / 100) * 0.35);

    // Peripheral observations are weaker, particularly for less-aware players.
    context.peripheralWeight =
        0.10 + ((awareness / 100) * 0.35);

    contextCache.set(observer, context);

    return context;
}

export function getPerceptionWeight(context, target) {
    if (
        !context ||
        !target ||
        !Number.isFinite(target.x) ||
        !Number.isFinite(target.y)
    ) {
        return 0;
    }

    const dx = target.x - context.x;
    const dy = target.y - context.y;

    const distanceSq = (dx * dx) + (dy * dy);

    // Immediate threats can trigger a reaction from any direction.
    if (distanceSq <= context.emergencyRangeSq) {
        return 1.0;
    }

    // Nothing beyond the player's maximum perception range.
    if (distanceSq > context.peripheralRangeSq) {
        return 0;
    }

    const distance = Math.sqrt(distanceSq);

    if (distance <= 0) {
        return 1.0;
    }

    // Compare the target direction with the player's attention direction.
    const facingCos =
        ((dx * context.dirX) + (dy * context.dirY)) / distance;

    // Stronger primary vision.
    if (
        distanceSq <= context.primaryRangeSq &&
        facingCos >= context.primaryConeCos
    ) {
        return context.primaryWeight;
    }

    // Weaker peripheral vision in the forward half-plane.
    if (facingCos >= context.peripheralConeCos) {
        return context.peripheralWeight;
    }

    // Outside the visible area and not an immediate threat.
    return 0;
}
