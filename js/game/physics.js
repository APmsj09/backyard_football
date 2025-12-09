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
    // --- 0. Safety Checks ---
    if (!pState || typeof pState.x !== 'number' || typeof pState.y !== 'number') return;
    
    // Initialize vectors if missing
    if (!pState.velocity) pState.velocity = { x: 0, y: 0 };
    if (!pState.vx) pState.vx = 0; // Internal physics velocity X
    if (!pState.vy) pState.vy = 0; // Internal physics velocity Y

    // --- 1. Handle Stuns/Blocks (Instant Stop) ---
    if (pState.stunnedTicks > 0 || pState.isBlocked || pState.isEngaged) {
        pState.vx = 0;
        pState.vy = 0;
        pState.velocity = { x: 0, y: 0 }; // For UI
        return;
    }

    // --- 2. Calculate Desired Vector ---
    const dx = (pState.targetX || pState.x) - pState.x;
    const dy = (pState.targetY || pState.y) - pState.y;
    const distToTarget = Math.sqrt(dx * dx + dy * dy);

    // --- 3. Determine Max Speed ---
    // Stat 0-99 maps to approx 5.0 - 9.0 yards/sec
    const baseSpeed = 5.0 + ((pState.speed || 50) / 100) * 4.0;
    
    // Apply modifiers (Fatigue & Jukes)
    const fatigueMod = pState.fatigueModifier || 1.0;
    const speedMult = pState.speedMultiplier || 1.0;
    
    const maxSpeed = baseSpeed * fatigueMod * speedMult;

    // --- 4. Acceleration Physics (The Anti-Stutter Fix) ---
    // Instead of setting velocity = maxSpeed immediately, we blend towards it.
    // 'acceleration' controls how "snappy" movement is.
    // 10.0 = Very responsive. 2.0 = Like running on ice.
    const acceleration = 8.0; 
    
    let targetVx = 0;
    let targetVy = 0;

    // Only try to move if we aren't "there" yet
    if (distToTarget > 0.1) {
        // Normalize direction
        const dirX = dx / distToTarget;
        const dirY = dy / distToTarget;
        
        targetVx = dirX * maxSpeed;
        targetVy = dirY * maxSpeed;
    } else {
        // We arrived, slow down
        targetVx = 0;
        targetVy = 0;
        // Snap to exact target to prevent micro-drifting if incredibly close
        if (distToTarget < 0.05) {
            pState.x = pState.targetX;
            pState.y = pState.targetY;
        }
    }

    // Linear Interpolation (LERP) for Velocity
    // NewVelocity = CurrentVelocity + (TargetVelocity - CurrentVelocity) * factor
    pState.vx += (targetVx - pState.vx) * acceleration * timeDelta;
    pState.vy += (targetVy - pState.vy) * acceleration * timeDelta;

    // --- 5. Apply Movement ---
    pState.x += pState.vx * timeDelta;
    pState.y += pState.vy * timeDelta;

    // Update UI velocity helper (used for drawing trails)
    // We calculate the magnitude of the actual physics vector
    pState.currentSpeedYPS = Math.sqrt(pState.vx * pState.vx + pState.vy * pState.vy);
    pState.velocity.x = pState.vx;
    pState.velocity.y = pState.vy;
}

