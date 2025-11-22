// physics.js - coordinate and movement helpers

/** Calculates distance between two player states. */
export function getDistance(p1State, p2State) {
    if (
        !p1State || !p2State ||
        typeof p1State.x !== 'number' || typeof p1State.y !== 'number' ||
        typeof p2State.x !== 'number' || typeof p2State.y !== 'number'
    ) return Infinity;

    const dx = p1State.x - p2State.x;
    const dy = p1State.y - p2State.y;
    return Math.sqrt(dx * dx + dy * dy);
}


// physics.js - safe coordinate/movement helper
export function updatePlayerPosition(pState, timeDelta) {
    // --- 0. Early exit for invalid state ---
    if (!pState || typeof pState.x !== 'number' || typeof pState.y !== 'number') return;

    // Initialize velocity if missing (prevents UI errors)
    if (!pState.velocity) pState.velocity = { x: 0, y: 0 };

    // --- 1. Handle stunned or blocked players ---
    if (pState.stunnedTicks > 0 || pState.isBlocked || pState.isEngaged) {
        pState.currentSpeedYPS = 0;
        pState.velocity = { x: 0, y: 0 }; // Stop trails
        return;
    }

    // --- 2. Ensure target coordinates are valid ---
    if (typeof pState.targetX !== 'number' || typeof pState.targetY !== 'number') {
        pState.currentSpeedYPS = 0;
        pState.velocity = { x: 0, y: 0 };
        return;
    }

    // --- 3. Calculate vector to target ---
    const dx = pState.targetX - pState.x;
    const dy = pState.targetY - pState.y;
    const distToTarget = Math.sqrt(dx * dx + dy * dy);

    // --- 4. Arrival radius (avoid vibration) ---
    const ARRIVAL_RADIUS = 0.2;
    if (distToTarget < ARRIVAL_RADIUS) {
        pState.x = pState.targetX;
        pState.y = pState.targetY;
        pState.currentSpeedYPS = 0;
        pState.velocity = { x: 0, y: 0 }; // Arrived, stop trails
        return;
    }

    // --- 5. Speed calculation based on stat ---
    // Scale: 1-99 stat maps to 4.5 - 8.0 Yards/Sec
    const MIN_SPEED_YPS = 4.5;
    const MAX_SPEED_YPS = 8.0;
    const stat = typeof pState.speed === 'number' ? pState.speed : 50;
    const speedYPS = MIN_SPEED_YPS + ((stat - 1) * (MAX_SPEED_YPS - MIN_SPEED_YPS)) / (99 - 1);

    // --- 6. Apply fatigue/momentum ---
    pState.currentSpeedYPS = speedYPS * (typeof pState.fatigueModifier === 'number' ? pState.fatigueModifier : 1);

    // --- 7. Move towards target ---
    const moveDist = pState.currentSpeedYPS * timeDelta;

    // Calculate unit vector components
    const vx = (dx / distToTarget);
    const vy = (dy / distToTarget);

    if (moveDist >= distToTarget) {
        // Can reach target this tick
        pState.x = pState.targetX;
        pState.y = pState.targetY;
    } else {
        // Move proportionally towards target
        pState.x += vx * moveDist;
        pState.y += vy * moveDist;
    }

    // --- 8. 💡 FIX: Update Velocity for UI Trails ---
    // UI uses this to draw the lines behind running players
    pState.velocity.x = vx * pState.currentSpeedYPS;
    pState.velocity.y = vy * pState.currentSpeedYPS;
}

