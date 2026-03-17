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

    // 💡 NEW: Enforce Snap Reaction Time
    if (pState.snapReactionTimer > 0) {
        pState.snapReactionTimer--;
        // Kill any AI-applied momentum. They are frozen in their stance.
        pState.vx = 0;
        pState.vy = 0;
        pState.targetX = pState.x;
        pState.targetY = pState.y;
        return; // Exit early! No movement allowed yet.
    }

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

    // --- 4. Attributes & Base Limits (REAL WORLD MATH) ---
    const speedStat = pState.speed || 50;
    const agilityStat = pState.agility || 50;
    const fatigueMod = pState.fatigueModifier || 1.0;

    // Top Speed Range: 7.2 yds/sec (0 rating) to 10.8 yds/sec (99 rating = ~22mph peak)
    const baseMaxSpeed = (7.2 + (speedStat / 100) * 3.6) * fatigueMod;

    let speedMult = pState.speedMultiplier || 1.0;
    if (pState.isBallCarrier) speedMult *= 0.90; // Padding/ball carrying slows you down ~10%
    if (pState.action === 'backpedal') speedMult *= 0.55;

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

    const turnAbility = (agilityStat / 100) * (pState.isSqueezing ? 0.4 : 1.0);
    const turnPenalty = Math.max(0.3 + turnAbility, dotProduct);

    // 💡 FIX: Apply gap friction directly to speed and turning
    const effectiveMaxSpeed = maxPossibleSpeed * turnPenalty * (1.0 - (1.0 - gapFriction) * 0.7); // Reduce speed by 70% of friction

    // --- 6. Acceleration & Deceleration (REAL WORLD PHYSICS) ---
    // REALITY CHECK: It takes ~2.5 seconds to reach top speed. 
    // An accelRate of 1.2 to 2.8 means players gain roughly 6% to 14% of their top speed per tick.
    let accelRate = (1.2 + (agilityStat / 100) * 1.6) * fatigueMod * (1.0 - (1.0 - gapFriction) * 0.5);

    if (dotProduct > 0.85) accelRate *= 1.3; // Straight line burst
    if (dotProduct < 0.25) accelRate *= 0.6; // Heavy cuts ruin your acceleration curve

    // Arrival Braking
    const SLOW_RADIUS = 2.5;
    let arrivalFactor = 1.0;

    // 💡 FIX: Players bursting to the handoff ('run_path') and WRs tracking a deep pass ('tracking_ball') 
    // should NEVER hit the brakes! They need to run through the catch point at full speed.
    if (distToTarget < SLOW_RADIUS && pState.action !== 'run_path' && pState.action !== 'tracking_ball') {
        arrivalFactor = distToTarget / SLOW_RADIUS;
        // Braking is much faster than accelerating (planting your foot)
        accelRate *= 2.5;
    }

    // --- 7. Momentum Calculation ---
    const targetVx = (dx / distToTarget) * effectiveMaxSpeed * arrivalFactor;
    const targetVy = (dy / distToTarget) * effectiveMaxSpeed * arrivalFactor;

    // Calculate how much we want to change velocity
    const deltaVx = targetVx - pState.vx;
    const deltaVy = targetVy - pState.vy;

    // Apply acceleration gradually over time
    pState.vx += deltaVx * accelRate * timeDelta;
    pState.vy += deltaVy * accelRate * timeDelta;

    const speedAfterAccel = Math.sqrt(pState.vx * pState.vx + pState.vy * pState.vy);
    if (speedAfterAccel > maxPossibleSpeed) {
        // Soft cap max speed instead of hard clamping so momentum feels heavier
        const overage = speedAfterAccel - maxPossibleSpeed;
        const ratio = (maxPossibleSpeed + (overage * 0.5)) / speedAfterAccel;
        pState.vx *= ratio; pState.vy *= ratio;
    }

    // --- 8. Collision Deflection (Physical Nudges) ---
    const BASE_RADIUS = 0.45;

    // Calculate THIS player's dynamic radius based on weight
    const myRadius = BASE_RADIUS + ((pState.weight || 200) / 1000);

    allPlayers.forEach(other => {
        if (other.id === pState.id || other.isEngaged || pState.isEngaged) return;

        if ((pState.action === 'handoff_setup' && other.action === 'run_path') ||
            (pState.action === 'run_path' && other.action === 'handoff_setup')) {
            return;
        }

        const dist = getDistance(pState, other);

        // Calculate the OTHER player's dynamic radius
        const theirRadius = BASE_RADIUS + ((other.weight || 200) / 1000);
        const combinedRadius = myRadius + theirRadius;

        if (dist < combinedRadius && dist > 0.01) {
            const overlap = combinedRadius - dist;
            const pushMagnitude = overlap * 0.6;

            const dx_norm = (pState.x - other.x) / dist;
            const dy_norm = (pState.y - other.y) / dist;

            // Heavier players are harder to deflect
            const totalWeight = (pState.weight || 200) + (other.weight || 200);
            const myDeflection = (other.weight || 200) / totalWeight;
            const theirDeflection = (pState.weight || 200) / totalWeight;

            pState.x += dx_norm * pushMagnitude * myDeflection;
            pState.y += dy_norm * pushMagnitude * myDeflection;
            other.x -= dx_norm * pushMagnitude * theirDeflection;
            other.y -= dy_norm * pushMagnitude * theirDeflection;

            pState.vx += dx_norm * pushMagnitude * (myDeflection * 4.0);
            pState.vy += dy_norm * pushMagnitude * (myDeflection * 4.0);
            other.vx -= dx_norm * pushMagnitude * (theirDeflection * 4.0);
            other.vy -= dy_norm * pushMagnitude * (theirDeflection * 4.0);
        }
    });

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
                    friction = Math.max(0.35, Math.min(1.0, friction)); // 💡 FIX: Slightly heavier minimum friction

                    if (friction < minFriction) minFriction = friction;
                }
            }
        }
    }
    return minFriction;
}