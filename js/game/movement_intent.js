// js/game/movement_intent.js

export function initMovementIntent(pState) {
    pState._intent = {
        mode: 'HOLD',          // 'HOLD', 'POINT', 'TRACK', 'LANE'
        anchorX: pState.x,
        anchorY: pState.y,
        targetX: pState.x,
        targetY: pState.y,
        targetEntityId: null,
        lockTicks: 0,
        arrivalRadius: 0.30,
        settled: false,
        isExplicit: false
    };
    pState.movementMode = 'HOLD';
    pState.arrivalRadius = 0.30;
}

export function setPointIntent(pState, x, y, arrivalRadius = 0.30) {
    if (!pState._intent) initMovementIntent(pState);
    const intent = pState._intent;
    intent.mode = 'POINT';
    intent.targetX = x;
    intent.targetY = y;
    intent.arrivalRadius = arrivalRadius;
    intent.settled = false;
    intent.isExplicit = true;
}

export function setHoldIntent(pState, anchorX = null, anchorY = null, arrivalRadius = 0.25) {
    if (!pState._intent) initMovementIntent(pState);
    const intent = pState._intent;
    if (intent.mode === 'HOLD' && intent.settled && anchorX === null) return;

    intent.mode = 'HOLD';
    intent.anchorX = anchorX !== null ? anchorX : pState.x;
    intent.anchorY = anchorY !== null ? anchorY : pState.y;
    intent.targetX = intent.anchorX;
    intent.targetY = intent.anchorY;
    intent.arrivalRadius = arrivalRadius;
    intent.isExplicit = true;
}

export function setTrackIntent(pState, entity, leadTime = 0, deadband = 0.60) {
    if (!pState._intent) initMovementIntent(pState);
    const intent = pState._intent;
    intent.mode = 'TRACK';
    intent.targetEntityId = entity.id;

    const rawX = entity.x + ((entity.vx || 0) * leadTime);
    const rawY = entity.y + ((entity.vy || 0) * leadTime);

    if (intent.targetX === undefined || Math.hypot(rawX - intent.targetX, rawY - intent.targetY) > deadband) {
        intent.targetX = rawX;
        intent.targetY = rawY;
    }
    intent.arrivalRadius = 0.40;
    intent.isExplicit = true;
}

export function setLaneIntent(pState, targetX, targetY, lockDuration = 10) {
    if (!pState._intent) initMovementIntent(pState);
    const intent = pState._intent;
    if (intent.lockTicks > 0) {
        intent.lockTicks--;
        intent.targetY = targetY;
        intent.isExplicit = true;
        return;
    }
    intent.mode = 'LANE';
    intent.targetX = targetX;
    intent.targetY = targetY;
    intent.lockTicks = lockDuration;
    intent.arrivalRadius = 0.50;
    intent.isExplicit = true;
}

export function resolveMovementIntent(pState) {
    if (!pState._intent) initMovementIntent(pState);
    const intent = pState._intent;

    if (intent.isExplicit) {
        pState.targetX = intent.targetX;
        pState.targetY = intent.targetY;
        pState.movementMode = intent.mode;
        pState.arrivalRadius = intent.arrivalRadius;
        intent.isExplicit = false; // Reset for next tick
    } else {
        // Safe legacy fallback: adopt raw coordinates, set mode to POINT
        intent.targetX = pState.targetX ?? pState.x;
        intent.targetY = pState.targetY ?? pState.y;
        pState.movementMode = 'POINT';
        pState.arrivalRadius = 0.35;
    }
}

/**
 * Dynamic waypoint navigation for route runners (does not brake at intermediate cuts)
 */
export function setRouteIntent(pState, x, y, arrivalRadius = 0.60) {
    if (!pState._intent) initMovementIntent(pState);
    const intent = pState._intent;
    intent.mode = 'ROUTE';
    intent.targetX = x;
    intent.targetY = y;
    intent.arrivalRadius = arrivalRadius;
    intent.settled = false;
    intent.isExplicit = true;
}