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
    
    if (!isFinite(pState.x) || !isFinite(pState.y)) {
        pState.x = 26.65; 
        pState.y = 60;
    }
    
    if (!pState.velocity) pState.velocity = { x: 0, y: 0 };
    if (!pState.vx) pState.vx = 0; 
    if (!pState.vy) pState.vy = 0; 

    // --- 1. Handle Stuns/Blocks (Enhanced Friction) ---
    if (pState.stunnedTicks > 0 || pState.isBlocked || pState.isEngaged) {
        // High friction: 0.95 vs 0.5 makes them feel "stuck" but still movable by block pushes
        const friction = 0.85; 
        pState.vx *= friction;
        pState.vy *= friction;
        pState.velocity = { x: pState.vx, y: pState.vy };
        return;
    }

    // --- 2. Calculate Desired Vector ---
    let targetX = pState.targetX || pState.x;
    let targetY = pState.targetY || pState.y;
    
    if (!isFinite(targetX) || !isFinite(targetY)) {
        targetX = pState.x;
        targetY = pState.y;
    }
    
    const dx = targetX - pState.x;
    const dy = targetY - pState.y;
    const distToTarget = Math.sqrt(dx * dx + dy * dy);

    if (!isFinite(distToTarget)) {
        pState.vx = 0; pState.vy = 0;
        return;
    }

    // --- 3. Determine Max Speed (Audit Fix: Combined Fatigue) ---
    // 0-99 Stat maps to 5.0 - 9.5 yards/sec
    const baseSpeed = 5.0 + ((pState.speed || 50) / 100) * 4.5;
    const fatigueMod = pState.fatigueModifier || 1.0;
    
    let speedMult = pState.speedMultiplier || 1.0;
    if (pState.isBallCarrier) speedMult *= 0.92; // Slightly tuned for balance
    if (pState.action === 'backpedal') speedMult *= 0.65;
    
    const contactReduction = pState.contactReduction || 1.0;
    const maxSpeed = baseSpeed * fatigueMod * speedMult * contactReduction;

    // --- 4. Acceleration & Agility Logic (Audit Fix: The "Burst" Feel) ---
    const agilityStat = pState.agility || 50;
    
    // Tired players have lower "burst" (acceleration)
    // Range: ~4.0 (Tired Lineman) to ~16.0 (Fresh Elite WR)
    let acceleration = (4.0 + (agilityStat * 0.12)) * fatigueMod; 

    if (pState.hasBall) acceleration *= 0.85;

    // --- 5. Braking Logic (Audit Fix: Snappier Stops) ---
    const SLOW_RADIUS = 2.5;
    let arrivalFactor = 1.0;
    
    if (distToTarget < SLOW_RADIUS) {
        arrivalFactor = distToTarget / SLOW_RADIUS;
        // Boost acceleration when slowing down to prevent "overshooting" the target
        acceleration *= 1.5; 
    }

    // Calculate Target Velocity
    let targetVx = 0;
    let targetVy = 0;

    if (distToTarget > 0.1) {
        const dirX = dx / distToTarget;
        const dirY = dy / distToTarget;
        targetVx = dirX * maxSpeed * arrivalFactor;
        targetVy = dirY * maxSpeed * arrivalFactor;
    } else {
        // Prevent micro-jitter when overlapping target
        if (distToTarget < 0.05) {
            pState.x = targetX; pState.y = targetY;
            pState.vx = 0; pState.vy = 0;
            return;
        }
    }

    // --- 6. Apply Momentum Change (Inertia) ---
    // The "Turn" logic: If the new target velocity is opposite to current movement, 
    // we use Agility to determine how fast they can flip their momentum.
    pState.vx += (targetVx - pState.vx) * acceleration * timeDelta;
    pState.vy += (targetVy - pState.vy) * acceleration * timeDelta;

    if (!isFinite(pState.vx) || !isFinite(pState.vy)) {
        pState.vx = 0; pState.vy = 0;
    }

    // --- 7. Apply Final Movement ---
    pState.x += pState.vx * timeDelta;
    pState.y += pState.vy * timeDelta;

    // Final sanity check
    if (!isFinite(pState.x) || !isFinite(pState.y)) {
        pState.x = targetX; pState.y = targetY;
        pState.vx = 0; pState.vy = 0;
    }

    // Update Helpers
    pState.currentSpeedYPS = Math.sqrt(pState.vx * pState.vx + pState.vy * pState.vy);
    pState.velocity.x = pState.vx;
    pState.velocity.y = pState.vy;
}