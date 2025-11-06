// physics.js - coordinate and movement helpers

/** Calculates distance between two player states. */
export function getDistance(p1State, p2State) {
    if (!p1State || !p2State || p1State.x === undefined || p2State.x === undefined) return Infinity;
    const dx = p1State.x - p2State.x;
    const dy = p1State.y - p2State.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/** Updates a player's position based on speed and target. */
export function updatePlayerPosition(pState, timeDelta) {
    if (pState.stunnedTicks > 0) {
        pState.currentSpeedYPS = 0; // Player is stunned
        return;
    }
    if (pState.isBlocked || pState.isEngaged) {
        pState.currentSpeedYPS = 0; // Player is in a block, don't move based on target
        return;
    }

    const dx = pState.targetX - pState.x;
    const dy = pState.targetY - pState.y;
    const distToTarget = Math.sqrt(dx * dx + dy * dy);

    // --- 1. Increased "arrival" radius ---
    // Stop if player is very close to the target.
    // This prevents "vibrating" when trying to reach an exact 0.0 point.
    const ARRIVAL_RADIUS = 0.2;
    if (distToTarget < ARRIVAL_RADIUS) {
        pState.x = pState.targetX;
        pState.y = pState.targetY;
        pState.currentSpeedYPS = 0; // Player has arrived
        return;
    }

    // --- 2. Speed Formula ---
    // This formula creates a faster, tighter speed range (4.5 to 9.0 YPS)
    const MIN_SPEED_YPS = 4.5; // Speed for a 1-stat player
    const MAX_SPEED_YPS = 9.0; // Speed for a 99-stat player

    // This maps the 1-99 stat range to the [4.5, 9.0] speed range
    const speedYPS = MIN_SPEED_YPS + ((pState.speed || 50) - 1) * (MAX_SPEED_YPS - MIN_SPEED_YPS) / (99 - 1);

    // --- 3. Store Speed for Momentum ---
    // This is the line we added for the momentum calculation
    pState.currentSpeedYPS = speedYPS * pState.fatigueModifier;

    // --- 4. Calculate Movement ---
    const moveDist = pState.currentSpeedYPS * timeDelta;

    if (moveDist >= distToTarget) {
        // We can reach the target this frame
        pState.x = pState.targetX;
        pState.y = pState.targetY;
        // Keep pState.currentSpeedYPS as is, don't set to 0 (tackle logic needs it)
    } else {
        // Move towards the target
        pState.x += (dx / distToTarget) * moveDist;
        pState.y += (dy / distToTarget) * moveDist;
    }
}
