/**
 * Calculates Euclidean distance between two points.
 */
export function getDistance(p1, p2) {
    if (!p1 || !p2) return Infinity;
    const dx = (p1.x ?? 0) - (p2.x ?? 0);
    const dy = (p1.y ?? 0) - (p2.y ?? 0);
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Main Physics and Movement Engine
 * Handles momentum, mass-based inertia, gap friction, and Newtonian collisions.
 */
export function updatePlayerPosition(pState, timeDelta, allPlayers = []) {
    if (!pState || typeof pState.x !== 'number') return;

    pState.vx = pState.vx || 0;
    pState.vy = pState.vy || 0;

    // --- 1. SNAP REACTION TIMER ---
    if (pState.snapReactionTimer > 0) {
        pState.snapReactionTimer--;
        pState.vx = 0;
        pState.vy = 0;
        pState.targetX = pState.x;
        pState.targetY = pState.y;
        return;
    }

    // --- 2. PASSIVE STATES (Stunned/Blocked) ---
    if (pState.stunnedTicks > 0 || pState.isBlocked || pState.isEngaged) {
        const friction = 0.85;
        pState.vx *= friction;
        pState.vy *= friction;
        pState.x += pState.vx * timeDelta;
        pState.y += pState.vy * timeDelta;
        pState.currentSpeedYPS = Math.sqrt(pState.vx ** 2 + pState.vy ** 2);
        return;
    }

    // --- 3. ATTRIBUTE RETRIEVAL & NORMALIZATION ---
    // Safe fallbacks for mapping structures
    const weight = pState.weight || pState.wgt || 200;
    const strength = pState.strength || pState.str || 50;
    const agility = pState.agility || pState.agi || 50;
    const speedStat = pState.speed || pState.spd || 50;
    const fatigueMod = pState.fatigueModifier || 1.0;

    // Ratios for physics math (225 lbs is considered the "baseline" 1.0 ratio)
    const weightRatio = weight / 225;
    const strengthFactor = strength / 100;
    const agiFactor = agility / 100;

    // --- 4. TARGETING MATH ---
    const targetX = pState.targetX ?? pState.x;
    const targetY = pState.targetY ?? pState.y;
    const dx = targetX - pState.x;
    const dy = targetY - pState.y;
    const distToTarget = Math.sqrt(dx * dx + dy * dy);

    // Hard arrival stop
    if (distToTarget < 0.05) {
        pState.vx *= 0.5;
        pState.vy *= 0.5;
        return;
    }

    // --- 5. TOP SPEED CALCULATION ---
    const gapFriction = calculateGapFriction(pState, allPlayers);
    pState.isSqueezing = gapFriction < 0.9;

    // Base Speed: 7.0 yds/sec to 11.0 yds/sec
    const baseMaxSpeed = (7.0 + (speedStat / 100) * 4.0) * fatigueMod;

    // Weight Penalty: 160lbs = +4% speed | 200lbs = 0% | 350lbs = -15% speed
    const weightSpeedPenalty = Math.max(0.80, 1.0 - ((weight - 200) / 1000));

    let actionMult = pState.speedMultiplier || 1.0;
    if (pState.isBallCarrier) actionMult *= 0.92;
    if (pState.action === 'backpedal') actionMult *= 0.55;
    if (pState.action === 'trucking') actionMult *= 0.75;

    const maxPossibleSpeed = baseMaxSpeed * weightSpeedPenalty * actionMult * gapFriction * (pState.contactReduction || 1.0);

    // --- 6. CARRYING MOMENTUM & CUTTING ---
    const currentSpeed = Math.sqrt(pState.vx ** 2 + pState.vy ** 2);
    let turningPenalty = 1.0;

    if (currentSpeed > 0.5 && distToTarget > 0.1) {
        // Dot Product: 1.0 = Straight, 0.0 = 90 degree cut, -1.0 = U-turn
        const dot = ((pState.vx / currentSpeed) * (dx / distToTarget)) + ((pState.vy / currentSpeed) * (dy / distToTarget));

        // WEIGHT IMPACT ON CUTS:
        // Heavier players drift significantly more on sharp cuts. Agility fights this drift.
        const cutStability = 0.4 + (agiFactor * 0.5) - ((weightRatio - 1.0) * 0.3);
        turningPenalty = Math.max(cutStability, dot);
    }
    const effectiveMaxSpeed = maxPossibleSpeed * turningPenalty;

    // --- 7. ACCELERATION (Strength vs. Weight) ---
    const explosiveness = (0.5 + strengthFactor) / weightRatio;
    let accelRate = (1.5 + (agiFactor * 2.0) + (explosiveness * 2.0)) * fatigueMod;

    // Apply Stumble Penalty
    // If the player recently broke a tackle or got bumped, their acceleration is crippled.
    if (pState.moveCooldown > 0) {
        accelRate *= 0.15; // 85% acceleration penalty while stumbling
    }

    // --- 8. DECELERATION (Braking / Planting) ---
    const isStopping = distToTarget < 2.5 && !['run_path', 'tracking_ball', 'pursuit'].includes(pState.action);
    let arrivalFactor = 1.0;

    if (isStopping) {
        arrivalFactor = distToTarget / 2.5; // Throttle down smoothly

        // WEIGHT IMPACT ON BRAKING (Inertia):
        // Heavy players require much more time/distance to slow down.
        // Agility helps plant the feet.
        const brakePower = (2.0 + (agiFactor * 4.0)) / Math.sqrt(weightRatio);
        accelRate *= brakePower;
    }

    // --- 9. APPLY NEWTONIAN ACCELERATION ---
    const targetVx = (dx / distToTarget) * effectiveMaxSpeed * arrivalFactor;
    const targetVy = (dy / distToTarget) * effectiveMaxSpeed * arrivalFactor;

    pState.vx += (targetVx - pState.vx) * accelRate * timeDelta;
    pState.vy += (targetVy - pState.vy) * accelRate * timeDelta;

    // Soft Speed Clamp (Retain slight over-speed from being bumped, but bleed it off)
    const speedAfter = Math.sqrt(pState.vx ** 2 + pState.vy ** 2);
    if (speedAfter > maxPossibleSpeed && speedAfter > 0.1) {
        // Agile players regain control of their over-speed momentum faster
        const drag = 0.8 + (agiFactor * 0.15);
        const ratio = (maxPossibleSpeed + (speedAfter - maxPossibleSpeed) * (1.0 - drag)) / speedAfter;
        pState.vx *= ratio;
        pState.vy *= ratio;
    }

    // --- 10. COLLISION DEFLECTION ---
    resolveNewtonianCollisions(pState, allPlayers);

    // --- 11. FINALIZE MOVEMENT ---
    pState.x += pState.vx * timeDelta;
    pState.y += pState.vy * timeDelta;

    clampToField(pState);

    // Update metadata for AI logic and Visualizer angle rendering
    pState.currentSpeedYPS = Math.sqrt(pState.vx ** 2 + pState.vy ** 2);
    pState.velocity = { x: pState.vx, y: pState.vy };
    if (pState.currentSpeedYPS > 0.2) pState.angle = Math.atan2(pState.vx, pState.vy);
}

/**
 * Calculates friction based on nearby player density.
 */
function calculateGapFriction(pState, allPlayers) {
    let minFriction = 1.0;
    const nearby = allPlayers.filter(o => o.id !== pState.id && getDistance(pState, o) < 2.0);

    for (let i = 0; i < nearby.length; i++) {
        for (let j = i + 1; j < nearby.length; j++) {
            const p1 = nearby[i];
            const p2 = nearby[j];
            const gapWidth = getDistance(p1, p2);

            if (gapWidth < 1.4) {
                const midX = (p1.x + p2.x) / 2;
                const midY = (p1.y + p2.y) / 2;
                const distToGap = Math.hypot(pState.x - midX, pState.y - midY);

                if (distToGap < 0.8) {
                    let friction = (gapWidth - 0.7) / (1.4 - 0.7);
                    friction = Math.max(0.35, Math.min(1.0, friction));
                    if (friction < minFriction) minFriction = friction;
                }
            }
        }
    }
    return minFriction;
}

/**
 * Resolves soft collisions to prevent players from overlapping.
 * Uses Weight (Mass) to determine who gets pushed out of the way.
 */
function resolveNewtonianCollisions(pState, allPlayers) {
    const BASE_RADIUS = 0.45;
    const myWeight = pState.weight || pState.wgt || 200;
    const myRadius = BASE_RADIUS + (myWeight / 1000);

    for (const other of allPlayers) {
        if (other.id === pState.id || other.isEngaged || pState.isEngaged) continue;

        // Ignore collisions during the handoff mesh (QB/RB overlap)
        const isHandoffPair = (pState.role === 'QB' && other.role === 'RB') || (pState.role === 'RB' && other.role === 'QB');
        if (isHandoffPair && ['handoff_setup', 'handoff_receive', 'run_path'].includes(pState.action)) continue;

        const dist = getDistance(pState, other);
        const theirWeight = other.weight || other.wgt || 200;
        const theirRadius = BASE_RADIUS + (theirWeight / 1000);
        const combinedRadius = myRadius + theirRadius;

        if (dist < combinedRadius && dist > 0.01) {
            const overlap = combinedRadius - dist;
            const dx_norm = (pState.x - other.x) / dist;
            const dy_norm = (pState.y - other.y) / dist;

            const totalW = myWeight + theirWeight;

            // Deflection Math: Lighter players absorb more of the push
            const myMoveRatio = theirWeight / totalW;

            // 1. Positional Push (Prevents rendering inside each other)
            pState.x += dx_norm * overlap * myMoveRatio * 0.5;
            pState.y += dy_norm * overlap * myMoveRatio * 0.5;

            // 2. Velocity Deflection (Momentum bump)
            const bounce = 0.4;
            pState.vx += dx_norm * bounce * myMoveRatio;
            pState.vy += dy_norm * bounce * myMoveRatio;
        }
    }
}

/**
 * Validates coordinates and prevents players from leaving the field boundary.
 */
export function clampToField(pState) {
    const FIELD_WIDTH = 53.3;
    const FIELD_LENGTH = 120; // 0-10 & 110-120 are endzones
    const BOUNDARY_PADDING = 0.5;

    pState.x = Math.max(BOUNDARY_PADDING, Math.min(FIELD_WIDTH - BOUNDARY_PADDING, pState.x));
    pState.y = Math.max(0, Math.min(FIELD_LENGTH, pState.y));
}