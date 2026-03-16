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
export function updatePlayerPosition(pState, timeDelta, allPlayers = []) {
    // --- 0. Pre-Flight Checks ---
    if (!pState || typeof pState.x !== 'number') return;
    if (!pState.vx) pState.vx = 0;
    if (!pState.vy) pState.vy = 0;

    // --- 1. Gap Awareness & Squeezing ---
    // This reduces speed and agility when "skinnying" through a hole
    const gapFriction = allPlayers.length > 0 ? calculateGapFriction(pState, allPlayers) : 1.0;
    pState.isSqueezing = gapFriction < 0.9;

    // --- 2. Handle Stuns / Blocks (Friction State) ---
    if (pState.stunnedTicks > 0 || pState.isBlocked || pState.isEngaged) {
        const friction = 0.85; 
        pState.vx *= friction; pState.vy *= friction;
        pState.x += pState.vx * timeDelta; pState.y += pState.vy * timeDelta;
        pState.currentSpeedYPS = Math.sqrt(pState.vx * pState.vx + pState.vy * pState.vy);
        return;
    }

    // --- 3. Target Vector Math ---
    const targetX = pState.targetX || pState.x;
    const targetY = pState.targetY || pState.y;
    const dx = targetX - pState.x;
    const dy = targetY - pState.y;
    const distToTarget = Math.sqrt(dx * dx + dy * dy);

    // If arrived, bleed off velocity rapidly
    if (distToTarget < 0.05) {
        pState.vx *= 0.5; pState.vy *= 0.5;
        return;
    }

    // --- 4. Attributes & Base Limits ---
    const speedStat = pState.speed || 50;
    const agilityStat = pState.agility || 50;
    const fatigueMod = pState.fatigueModifier || 1.0;
    
    // Top Speed Range: 5.0 to 9.5 yards/sec
    const baseMaxSpeed = (5.0 + (speedStat / 100) * 4.5) * fatigueMod;
    
    let speedMult = pState.speedMultiplier || 1.0;
    if (pState.isBallCarrier) speedMult *= 0.90;
    if (pState.action === 'backpedal') speedMult *= 0.60;
    
    // Final speed limit is capped by gap friction (squeezing through a hole slows you down)
    const maxPossibleSpeed = baseMaxSpeed * speedMult * gapFriction * (pState.contactReduction || 1.0);

    // --- 5. Turning & Inertia (Dot Product Logic) ---
    const currentSpeed = Math.sqrt(pState.vx * pState.vx + pState.vy * pState.vy);
    let dotProduct = 1.0; 

    if (currentSpeed > 0.1) {
        // Alignment between current velocity and direction to target
        const nx = pState.vx / currentSpeed;
        const ny = pState.vy / currentSpeed;
        const tx = dx / distToTarget;
        const ty = dy / distToTarget;
        dotProduct = (nx * tx) + (ny * ty); // 1.0 = Straight, 0.0 = 90 deg cut, -1.0 = U-turn
    }

    // High Agility reduces the penalty of turning. Squeezing increases it.
    const turnAbility = (agilityStat / 100) * (pState.isSqueezing ? 0.4 : 1.0);
    const turnPenalty = Math.max(0.3 + turnAbility, dotProduct);
    const effectiveMaxSpeed = maxPossibleSpeed * turnPenalty;

    // --- 6. Acceleration & Deceleration (Braking) ---
    // Accelerate harder when moving straight, stall when cutting
    let accelRate = (6.0 + (agilityStat * 0.10)) * fatigueMod * gapFriction;
    
    if (dotProduct > 0.85) accelRate *= 1.5; // Straight line "burst"
    if (dotProduct < 0.25) accelRate *= 0.5; // "Stumble" penalty during hard cuts

    // Arrival Braking
    const SLOW_RADIUS = 3.0;
    let arrivalFactor = 1.0;
    if (distToTarget < SLOW_RADIUS) {
        arrivalFactor = distToTarget / SLOW_RADIUS;
        accelRate *= 2.0; // Extra effort to plant feet at the destination
    }

    // --- 7. Momentum Calculation ---
    const targetVx = (dx / distToTarget) * effectiveMaxSpeed * arrivalFactor;
    const targetVy = (dy / distToTarget) * effectiveMaxSpeed * arrivalFactor;

    // Apply change in velocity (Inertia)
    pState.vx += (targetVx - pState.vx) * accelRate * timeDelta;
    pState.vy += (targetVy - pState.vy) * accelRate * timeDelta;

    // Absolute Speed Cap
    const speedAfterAccel = Math.sqrt(pState.vx * pState.vx + pState.vy * pState.vy);
    if (speedAfterAccel > maxPossibleSpeed) {
        const ratio = maxPossibleSpeed / speedAfterAccel;
        pState.vx *= ratio; pState.vy *= ratio;
    }

    // --- 8. Collision Deflection (Physical Nudges) ---
    // If icon is too close to another player while squeezing, nudge laterally
    if (pState.isSqueezing) {
        allPlayers.forEach(other => {
            if (other.id === pState.id) return;
            const dist = getDistance(pState, other);
            if (dist < 0.65) {
                const pushX = (pState.x - other.x) / dist;
                const pushY = (pState.y - other.y) / dist;
                pState.vx += pushX * 1.5;
                pState.vy += pushY * 1.5;
            }
        });
    }

    // --- 9. Apply Final Movement ---
    pState.x += pState.vx * timeDelta;
    pState.y += pState.vy * timeDelta;

    // Update Meta Stats
    pState.currentSpeedYPS = Math.sqrt(pState.vx * pState.vx + pState.vy * pState.vy);
    pState.velocity = { x: pState.vx, y: pState.vy };
}

/**
 * Detects if a player is trying to move through a narrow gap between other players.
 * Returns a "Friction Factor" (0.0 to 1.0) where 1.0 is wide open.
 */
function calculateGapFriction(pState, allPlayers) {
    const SQUEEZE_THRESHOLD = 1.4; // Yards between two players to be considered "tight"
    const IMPASSABLE_THRESHOLD = 0.7; // Too narrow to pass without significant struggle
    let minFriction = 1.0;

    // We only care about players within 2 yards of the mover
    const nearby = allPlayers.filter(other => 
        other.id !== pState.id && 
        getDistance(pState, other) < 2.0
    );

    // Check pairs of nearby players to see if pState is between them
    for (let i = 0; i < nearby.length; i++) {
        for (let j = i + 1; j < nearby.length; j++) {
            const p1 = nearby[i];
            const p2 = nearby[j];

            // Gap Width: distance between the two stationary/engaged players
            const gapWidth = getDistance(p1, p2);

            if (gapWidth < SQUEEZE_THRESHOLD) {
                // Determine if mover is actually positioned "in" the gap
                // (Using a simple midpoint proximity check)
                const midX = (p1.x + p2.x) / 2;
                const midY = (p1.y + p2.y) / 2;
                const distToGapCenter = Math.hypot(pState.x - midX, pState.y - midY);

                if (distToGapCenter < 0.8) {
                    // Calculate how much we need to slow down based on gap tightness
                    // If gap is 0.7 or less, friction is heavy (0.4)
                    let friction = (gapWidth - IMPASSABLE_THRESHOLD) / (SQUEEZE_THRESHOLD - IMPASSABLE_THRESHOLD);
                    friction = Math.max(0.4, Math.min(1.0, friction));
                    
                    if (friction < minFriction) minFriction = friction;
                }
            }
        }
    }
    return minFriction;
}