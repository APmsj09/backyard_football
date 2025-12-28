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
    if (!pState.vx) pState.vx = 0; 
    if (!pState.vy) pState.vy = 0; 

    // --- 1. Handle Stuns/Blocks (Instant Stop) ---
    if (pState.stunnedTicks > 0 || pState.isBlocked || pState.isEngaged) {
        // Apply heavy friction instead of instant stop for impact feel
        pState.vx *= 0.5;
        pState.vy *= 0.5;
        pState.velocity = { x: pState.vx, y: pState.vy };
        return;
    }

    // --- 2. Calculate Desired Vector ---
    const dx = (pState.targetX || pState.x) - pState.x;
    const dy = (pState.targetY || pState.y) - pState.y;
    const distToTarget = Math.sqrt(dx * dx + dy * dy);

    // --- 3. Determine Max Speed ---
    // Stat 0-99 maps to approx 5.0 - 9.5 yards/sec
    const baseSpeed = 5.0 + ((pState.speed || 50) / 100) * 4.5;
    
    // Apply modifiers
    let speedMult = pState.speedMultiplier || 1.0;
    if (pState.isBallCarrier) speedMult *= 0.9; // Carrying ball slows you down
    if (pState.action === 'backpedal') speedMult *= 0.7;

    const fatigueMod = pState.fatigueModifier || 1.0;
    const maxSpeed = baseSpeed * fatigueMod * speedMult;

    // Dynamic Acceleration based on Agility
    // 99 Agility = 14.0 force (Cuts on a dime)
    // 50 Agility = 9.0 force (Standard)
    // 20 Agility = 6.0 force (Drifts like a truck)
    const agilityStat = pState.agility || 50;
    let acceleration = 4.0 + (agilityStat * 0.1); 

    // Bonus: If carrying ball, slightly reduce acceleration (carrying weight)
    if (pState.hasBall) acceleration *= 0.9;

    
    // B. Arrival Deceleration (The "Braking" Logic)
    // Start slowing down when within 3 yards of target
    const SLOW_RADIUS = 3.0;
    let arrivalFactor = 1.0;
    
    if (distToTarget < SLOW_RADIUS) {
        arrivalFactor = distToTarget / SLOW_RADIUS;
    }

    // C. Calculate Target Velocity
    let targetVx = 0;
    let targetVy = 0;

    if (distToTarget > 0.1) {
        // Normalize direction
        const dirX = dx / distToTarget;
        const dirY = dy / distToTarget;
        
        // Scale by maxSpeed AND the arrival factor (braking)
        targetVx = dirX * maxSpeed * arrivalFactor;
        targetVy = dirY * maxSpeed * arrivalFactor;
    } else {
        // Snap if incredibly close to prevent jitter
        if (distToTarget < 0.05) {
            pState.x = pState.targetX;
            pState.y = pState.targetY;
            pState.vx = 0;
            pState.vy = 0;
            return;
        }
    }

    // --- 5. Apply Inertia (LERP) ---
    // This blends the current velocity towards the target velocity.
    // Low acceleration means the player will "drift" or "arc" before turning.
    pState.vx += (targetVx - pState.vx) * acceleration * timeDelta;
    pState.vy += (targetVy - pState.vy) * acceleration * timeDelta;

    // --- 6. Apply Movement ---
    pState.x += pState.vx * timeDelta;
    pState.y += pState.vy * timeDelta;

    // Update UI velocity helper
    pState.currentSpeedYPS = Math.sqrt(pState.vx * pState.vx + pState.vy * pState.vy);
    pState.velocity.x = pState.vx;
    pState.velocity.y = pState.vy;
}