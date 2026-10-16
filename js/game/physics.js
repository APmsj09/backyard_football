import { logPlayDebug } from './telemetry.js';
import { TICK_DURATION_SECONDS, scalePerTickFactor } from './simulation_config.js';
import { getPlayerBaseSpeedYPS } from './movement_profile.js';

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

    const telemetryActive =
        typeof window !== 'undefined' &&
        Boolean(window.__ACTIVE_PLAY_TELEMETRY__);

    const telemetryTick =
        telemetryActive && Number.isFinite(window.__CURRENT_TICK__)
            ? window.__CURRENT_TICK__
            : 0;
    
     // --- 1. SNAP REACTION TIMER ---
    if (pState.snapReactionTimer > 0) {
        if (telemetryActive && pState._telemetryMotionPause !== 'snap_reaction') {
            logPlayDebug(
                'MOVEMENT_PAUSED',
                `${pState.name} paused by snap reaction`,
                {
                    reason: 'snap_reaction',
                    action: pState.action ?? null,
                    movementMode: pState.movementMode ?? null,
                    position: {
                        x: pState.x,
                        y: pState.y
                    },
                    target: {
                        x: pState.targetX ?? null,
                        y: pState.targetY ?? null
                    },
                    snapReactionTimer: pState.snapReactionTimer
                },
                telemetryTick
            );

            pState._telemetryMotionPause = 'snap_reaction';
        }

        pState.snapReactionTimer--;
        pState.vx = 0;
        pState.vy = 0;
        pState.targetX = pState.x;
        pState.targetY = pState.y;
        return;
    }

    // --- 2. PASSIVE STATES (Stunned/Blocked) ---
    if (pState.stunnedTicks > 0 || pState.isBlocked || pState.isEngaged) {
        const passiveReason = pState.stunnedTicks > 0
            ? 'stunned'
            : pState.isBlocked
                ? 'blocked'
                : 'engaged';

        if (telemetryActive && pState._telemetryMotionPause !== passiveReason) {
            logPlayDebug(
                'MOVEMENT_PAUSED',
                `${pState.name} movement restricted: ${passiveReason}`,
                {
                    reason: passiveReason,
                    action: pState.action ?? null,
                    movementMode: pState.movementMode ?? null,
                    position: {
                        x: pState.x,
                        y: pState.y
                    },
                    velocity: {
                        vx: pState.vx,
                        vy: pState.vy
                    },
                    stunnedTicks: pState.stunnedTicks ?? 0,
                    isBlocked: Boolean(pState.isBlocked),
                    isEngaged: Boolean(pState.isEngaged)
                },
                telemetryTick
            );

            pState._telemetryMotionPause = passiveReason;
        }

        const passiveFriction = scalePerTickFactor(0.85, timeDelta);
        pState.vx *= passiveFriction;
        pState.vy *= passiveFriction;
        
        pState.x += pState.vx * timeDelta;
        pState.y += pState.vy * timeDelta;

        pState.currentSpeedYPS = Math.hypot(pState.vx, pState.vy);
        pState.velocity = { x: pState.vx, y: pState.vy };

        clampToField(pState);
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

    // --- 4. TARGETING MATH & CLEAN ARRIVAL RESOLUTION ---
    let targetX = pState.targetX ?? pState.x;
    let targetY = pState.targetY ?? pState.y;

    const dx = targetX - pState.x;
    const dy = targetY - pState.y;
    const distToTarget = Math.sqrt(dx * dx + dy * dy);
    const arrivalRadius = pState.arrivalRadius || 0.30;

    // Record the initial target and significant changes, not every tick.
    if (telemetryActive) {
        const action = pState.action ?? 'idle';
        const movementMode = pState.movementMode ?? null;

        const previousState = pState._telemetryLastMovementState;
        const previousTarget = pState._telemetryLastLoggedTarget;

        const targetShift = previousTarget
            ? Math.hypot(
                targetX - previousTarget.x,
                targetY - previousTarget.y
            )
            : Infinity;

        const stateChanged =
            !previousState ||
            previousState.action !== action ||
            previousState.movementMode !== movementMode;

        const lastLogTick = pState._telemetryLastTargetLogTick ?? -Infinity;
        const ticksSinceLastLog = telemetryTick - lastLogTick;

        const shouldLogTarget =
            !previousTarget ||
            targetShift >= 4.0 ||
            (
                (targetShift >= 1.5 || stateChanged) &&
                ticksSinceLastLog >= 5
            );

        if (shouldLogTarget) {
            logPlayDebug(
                'MOVEMENT_TARGET_SET',
                `${pState.name} has a new movement target`,
                {
                    action,
                    movementMode,

                    position: {
                        x: Number(pState.x.toFixed(2)),
                        y: Number(pState.y.toFixed(2))
                    },

                    target: {
                        x: Number(targetX.toFixed(2)),
                        y: Number(targetY.toFixed(2))
                    },

                    previousTarget: previousTarget
                        ? {
                            x: Number(previousTarget.x.toFixed(2)),
                            y: Number(previousTarget.y.toFixed(2))
                        }
                        : null,

                    targetShift: Number(
                        (Number.isFinite(targetShift) ? targetShift : 0).toFixed(2)
                    ),

                    distanceToTarget: Number(distToTarget.toFixed(2)),
                    speed: Number(Math.hypot(pState.vx, pState.vy).toFixed(2))
                },
                telemetryTick
            );

            pState._telemetryLastLoggedTarget = {
                x: targetX,
                y: targetY
            };

            pState._telemetryLastTargetLogTick = telemetryTick;
        }

        pState._telemetryLastMovementState = {
            action,
            movementMode
        };
    }
    
     // A settled player should remain stopped until their target changes.
    if (
        (pState.movementMode === 'HOLD' || pState.movementMode === 'POINT') &&
        pState._intent?.settled
    ) {
        const intent = pState._intent;

        const targetChanged = Math.hypot(
            targetX - intent.targetX,
            targetY - intent.targetY
        ) > 0.05;

        if (!targetChanged && distToTarget <= arrivalRadius) {
            pState.x = targetX;
            pState.y = targetY;
            pState.vx = 0;
            pState.vy = 0;
            pState.currentSpeedYPS = 0;
            pState.velocity = { x: 0, y: 0 };

            clampToField(pState);
            return;
        }

        // A changed or distant target invalidates the old settled state.
        intent.settled = false;
    }

    // DECISIVE BRAKING FOR FIXED TARGETS (HOLD & POINT)
    if (pState.movementMode === 'HOLD' || pState.movementMode === 'POINT') {
        if (distToTarget <= arrivalRadius) {
            // Apply heavy braking friction
            const targetBrakeFactor = scalePerTickFactor(0.40, timeDelta);

                pState.vx *= targetBrakeFactor;
                pState.vy *= targetBrakeFactor;

            // Direct snap to stop when speed has bled off
            if (Math.hypot(pState.vx, pState.vy) < 0.35) {
                pState.x = targetX;
                pState.y = targetY;
                pState.vx = 0;
                pState.vy = 0;
                pState.currentSpeedYPS = 0;
                pState.velocity = { x: 0, y: 0 };
                if (pState._intent) pState._intent.settled = true;
                clampToField(pState);
                return;
            }

            // Advance deceleration step and return immediately (prevents Section 9 re-acceleration)
            pState.x += pState.vx * timeDelta;
            pState.y += pState.vy * timeDelta;
            pState.currentSpeedYPS = Math.hypot(pState.vx, pState.vy);
            pState.velocity = { x: pState.vx, y: pState.vy };
            clampToField(pState);
            return;
        }
    }

    // --- 5. TOP SPEED CALCULATION ---
    const gapFriction = calculateGapFriction(pState, allPlayers);
    pState.isSqueezing = gapFriction < 0.9;

    const baseMaxSpeed = getPlayerBaseSpeedYPS(pState) * fatigueMod;

    let actionMult = pState.speedMultiplier || 1.0;
    if (pState.isBallCarrier) actionMult *= 0.92;
    if (pState.action === 'backpedal') actionMult *= 0.55;
    if (pState.action === 'trucking') actionMult *= 0.75;

    if (pState.jammedTicks > 0) {
        pState.jammedTicks--;
        actionMult *= 0.60; // 40% speed reduction when physically jammed
    }

    //const maxPossibleSpeed = baseMaxSpeed * weightSpeedPenalty * actionMult * gapFriction * (pState.contactReduction || 1.0);
    const maxPossibleSpeed = baseMaxSpeed * actionMult * gapFriction;

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
    const isStopping = distToTarget < 2.5 && !['run_path', 'run_route', 'tracking_ball', 'pursuit'].includes(pState.action);
    let arrivalFactor = 1.0;

    if (isStopping) {
        arrivalFactor = distToTarget / 2.5; // Throttle down smoothly

        // WEIGHT IMPACT ON BRAKING (Inertia):
        // Heavy players require much more time/distance to slow down.
        // Agility helps plant the feet.
        const brakePower = (2.0 + (agiFactor * 4.0)) / Math.sqrt(weightRatio);
        accelRate *= brakePower;
    }

    // --- 9. APPLY NEWTONIAN ACCELERATION WITH DISTANCE GATING ---
    // Safely gate timeDelta to prevent division-by-zero or NaN
    const safeTimeDelta = Math.max( timeDelta, TICK_DURATION_SECONDS );

    // Mathematically restrict speed so a player can NEVER jump past their target in a single tick
    const maxSafeSpeed = (distToTarget / safeTimeDelta) * 0.8;
    const clampedTargetSpeed = Math.min(effectiveMaxSpeed * arrivalFactor, maxSafeSpeed);

    const safeDist = Math.max(0.001, distToTarget);
    const targetVx = (dx / safeDist) * clampedTargetSpeed;
    const targetVy = (dy / safeDist) * clampedTargetSpeed;

    const steeringAlpha = 1 - Math.exp(-Math.max(0, accelRate) * Math.max(0, timeDelta));

    pState.vx += (targetVx - pState.vx) * steeringAlpha;
    pState.vy += (targetVy - pState.vy) * steeringAlpha;

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

    // Detect sustained failure to approach a movement target.
    // This runs only during plays that have active telemetry.
    if (telemetryActive) {
        const remainingDistance = Math.hypot(
            targetX - pState.x,
            targetY - pState.y
        );

        const progressTowardTarget = distToTarget - remainingDistance;

        const previousStallTarget = pState._telemetryStallTarget;

        const stallTargetChanged =
            !previousStallTarget ||
            Math.hypot(
                targetX - previousStallTarget.x,
                targetY - previousStallTarget.y
            ) > 0.5;

        if (stallTargetChanged) {
            pState._telemetryStallTicks = 0;
            pState._telemetryStallLogged = false;
        }

        pState._telemetryStallTarget = {
            x: targetX,
            y: targetY
        };

        const isMakingProgress =
            progressTowardTarget >= 0.03;

        const isStalled =
            distToTarget > 2.0 &&
            !isMakingProgress &&
            !pState._intent?.settled;

        if (isStalled) {
            pState._telemetryStallTicks =
                (pState._telemetryStallTicks || 0) + 1;

            if (
                pState._telemetryStallTicks >= 8 &&
                !pState._telemetryStallLogged
            ) {
                const nearbyPlayers = allPlayers
                    .filter(other =>
                        other.id !== pState.id &&
                        getDistance(pState, other) < 1.5
                    )
                    .slice(0, 4)
                    .map(other => ({
                        id: other.id,
                        name: other.name,
                        action: other.action ?? null,
                        distance: Number(
                            getDistance(pState, other).toFixed(2)
                        ),
                        isBlocked: Boolean(other.isBlocked),
                        isEngaged: Boolean(other.isEngaged),
                        stunnedTicks: other.stunnedTicks ?? 0
                    }));

                logPlayDebug(
                    'MOVEMENT_STALL',
                    `${pState.name} is failing to approach the target`,
                    {
                        action: pState.action ?? null,
                        movementMode: pState.movementMode ?? null,

                        position: {
                            x: Number(pState.x.toFixed(2)),
                            y: Number(pState.y.toFixed(2))
                        },

                        target: {
                            x: Number(targetX.toFixed(2)),
                            y: Number(targetY.toFixed(2))
                        },

                        distanceAtStart: Number(distToTarget.toFixed(2)),
                        distanceAfter: Number(remainingDistance.toFixed(2)),
                        progressThisTick: Number(
                            progressTowardTarget.toFixed(3)
                        ),

                        stallTicks: pState._telemetryStallTicks,

                        velocity: {
                            vx: Number(pState.vx.toFixed(2)),
                            vy: Number(pState.vy.toFixed(2)),
                            speed: Number(
                                Math.hypot(pState.vx, pState.vy).toFixed(2)
                            )
                        },

                        maxPossibleSpeed: Number(maxPossibleSpeed.toFixed(2)),
                        gapFriction: Number(gapFriction.toFixed(2)),
                        isSqueezing: Boolean(pState.isSqueezing),

                        nearbyPlayers
                    },
                    telemetryTick
                );

                pState._telemetryStallLogged = true;
            }
        } else {
            pState._telemetryStallTicks = 0;
            pState._telemetryStallLogged = false;
        }
    }

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
        if (other.id === pState.id) continue;
        // Do not collide an engaged player with their own blocking partner
        if (pState.engagedWith === other || other.engagedWith === pState) continue;

        // Respect ghostTicks to prevent QB/RB collision snags after handoffs
        if (pState.ghostTicks > 0 || other.ghostTicks > 0) continue;

        const isHandoffPair = (pState.role === 'QB' && other.role === 'RB') || (pState.role === 'RB' && other.role === 'QB');
        // Exempt QB/RB from body bumping in the backfield during dropbacks, handoffs, and route releases
        if (isHandoffPair && (pState.action === 'handoff_setup' || other.action === 'handoff_setup')) {
            continue;
        }

        const dist = getDistance(pState, other);
        const theirWeight = other.weight || other.wgt || 200;
        const theirRadius = BASE_RADIUS + (theirWeight / 1000);
        const combinedRadius = myRadius + theirRadius;

        if (dist < combinedRadius && dist > 0.01) {
            const overlap = combinedRadius - dist;
            const dx_norm = (pState.x - other.x) / dist;
            const dy_norm = (pState.y - other.y) / dist;

            const totalW = myWeight + theirWeight;
            const myMoveRatio = theirWeight / totalW;

            pState.x += dx_norm * overlap * myMoveRatio * 0.25;
            pState.y += dy_norm * overlap * myMoveRatio * 0.25;

            const relVx = pState.vx - (other.vx || 0);
            const relVy = pState.vy - (other.vy || 0);
            const normalVelocity = (relVx * dx_norm) + (relVy * dy_norm);

            if (normalVelocity < 0) {
                pState.vx -= dx_norm * normalVelocity * myMoveRatio * 0.5;
                pState.vy -= dy_norm * normalVelocity * myMoveRatio * 0.5;
            }
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
