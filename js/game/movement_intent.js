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

    const modeChanged = intent.mode !== 'POINT';
    const targetChanged = Math.hypot(
        x - intent.targetX,
        y - intent.targetY
    ) > 0.05;

    intent.mode = 'POINT';
    intent.targetX = x;
    intent.targetY = y;
    intent.arrivalRadius = arrivalRadius;

    // Preserve arrival state when the same target is reissued.
    if (modeChanged || targetChanged) {
        intent.settled = false;
    }

    intent.isExplicit = true;
}

export function setHoldIntent(
    pState,
    anchorX = null,
    anchorY = null,
    arrivalRadius = 0.25
) {
    if (!pState._intent) initMovementIntent(pState);

    const intent = pState._intent;

    if (
        intent.mode === 'HOLD' &&
        intent.settled &&
        anchorX === null &&
        anchorY === null
    ) {
        return;
    }

    const nextAnchorX = anchorX !== null ? anchorX : pState.x;
    const nextAnchorY = anchorY !== null ? anchorY : pState.y;

    const anchorChanged =
        intent.mode !== 'HOLD' ||
        Math.hypot(
            nextAnchorX - intent.anchorX,
            nextAnchorY - intent.anchorY
        ) > 0.05;

    intent.mode = 'HOLD';
    intent.anchorX = nextAnchorX;
    intent.anchorY = nextAnchorY;
    intent.targetX = nextAnchorX;
    intent.targetY = nextAnchorY;
    intent.arrivalRadius = arrivalRadius;

    if (anchorChanged) {
        intent.settled = false;
    }

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

    // Preserve the locked lateral lane only while LANE is still the
    // active intent. Another movement intent must be allowed to interrupt it.
    if (intent.mode === 'LANE' && intent.lockTicks > 0) {
        intent.mode = 'LANE';
        intent.lockTicks--;
        intent.targetY = targetY;
        intent.targetEntityId = null;
        intent.arrivalRadius = 0.50;
        intent.isExplicit = true;
        return;
    }

    // Start a fresh lane commitment after an interruption or expired lock.
    intent.mode = 'LANE';
    intent.targetX = targetX;
    intent.targetY = targetY;
    intent.targetEntityId = null;
    intent.lockTicks = Math.max(0, lockDuration);
    intent.arrivalRadius = 0.50;
    intent.settled = false;
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

    const modeChanged = intent.mode !== 'ROUTE';
    const targetChanged = Math.hypot(
        x - intent.targetX,
        y - intent.targetY
    ) > 0.05;

    intent.mode = 'ROUTE';
    intent.targetX = x;
    intent.targetY = y;
    intent.arrivalRadius = arrivalRadius;

    if (modeChanged || targetChanged) {
        intent.settled = false;
    }

    intent.isExplicit = true;
}
