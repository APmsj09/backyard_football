import { logPlayDebug } from './telemetry.js';
import { TICK_DURATION_SECONDS, scalePerTickFactor } from './simulation_config.js';
import { getPlayerBaseSpeedYPS, getPlayerAccelerationYPS2 } from './movement_profile.js';

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
 * Applies a physical disruption without freezing the player in place.
 * impactSeverity is an authored 0-100 gameplay scale, not raw force units.
 * Returns true when the player is downed, false when they remain upright.
 */
export function applyImpactDisruption(
    pState,
    impactSeverity,
    impulseX = 0,
    impulseY = 0,
    forceKnockdown = false
) {
    if (!pState) return false;

    const severity = Math.max(0, Math.min(100, Number(impactSeverity) || 0));
    if (severity <= 0) return false;

    const agility = Math.max(20, Math.min(99, Number(pState.agility ?? pState.agi) || 50));
    const strength = Math.max(20, Math.min(99, Number(pState.strength ?? pState.str) || 50));
    const age = Math.max(12, Math.min(18, Number(pState.age) || 15));
    // Backyard weight curve: 12yo ~90 lbs, 15yo ~140 lbs, 18yo ~195 lbs
    const defaultBackyardWeight = Math.round(90 + ((age - 12) * 17.5));
    const weightValue = Number(pState.weight ?? pState.wgt);
    const weight = Number.isFinite(weightValue) ? weightValue : defaultBackyardWeight;
    const fatigueModifier = Number.isFinite(pState.fatigueModifier)
        ? Math.max(0.5, Math.min(1.0, pState.fatigueModifier))
        : 1.0;
    const fatiguePenalty = 1.0 - fatigueModifier;

    const vx = Number.isFinite(pState.vx) ? pState.vx : 0;
    const vy = Number.isFinite(pState.vy) ? pState.vy : 0;
    const speedBeforeImpact = Math.hypot(vx, vy);
    const safeImpulseX = Number.isFinite(impulseX) ? impulseX : 0;
    const safeImpulseY = Number.isFinite(impulseY) ? impulseY : 0;
    const impulseSpeed = Math.hypot(safeImpulseX, safeImpulseY);
    const wasOffBalance =
        pState.balanceState === 'off_balance' ||
        (pState.offBalanceTicks || 0) > 0;

    // Preserve and redirect momentum rather than teleporting or freezing.
    pState.vx = vx + safeImpulseX;
    pState.vy = vy + safeImpulseY;

    // Backyard weight baseline: 150 lbs median across ages 12-18
    const knockdownChance = Math.max(
        0,
        Math.min(
            0.88,
            ((severity - 50) * 0.012) +
            Math.min(0.20, (speedBeforeImpact + impulseSpeed * 0.5) * 0.022) +
            (wasOffBalance ? 0.16 : 0) +
            (fatiguePenalty * 0.15) -
            ((agility - 50) * 0.0022) -
            ((strength - 50) * 0.0016) -
            ((weight - 150) * 0.0015) // Lighter 12yos get knocked down easier; big 18yos stay on their feet
        )
    );

    const knockedDown =
        forceKnockdown ||
        (knockdownChance > 0 && Math.random() < knockdownChance);

    if (knockedDown) {
        const recoveryTicks = Math.max(
            10,
            Math.min(
                48,
                Math.round(
                    10 +
                    (severity * 0.16) +
                    Math.min(6, (speedBeforeImpact + impulseSpeed * 0.5) * 0.65) +
                    (fatiguePenalty * 8) +
                    ((weight - 220) * 0.03) -
                    ((agility - 50) * 0.08) -
                    ((strength - 50) * 0.035)
                )
            )
        );

        pState.balanceState = 'downed';
        pState.downedTicks = Math.max(pState.downedTicks || 0, recoveryTicks);
        pState.offBalanceTicks = 0;
        pState.balanceSeverity = severity;
        pState.stunnedTicks = 0;
        return true;
    }

    const stumbleTicks = Math.max(
        3,
        Math.min(
            18,
            Math.round(
                4 +
                (severity * 0.09) +
                Math.min(4, (speedBeforeImpact + impulseSpeed * 0.25) * 0.30) +
                (fatiguePenalty * 4) -
                ((agility - 50) * 0.04)
            )
        )
    );

    pState.balanceState = 'off_balance';
    pState.offBalanceTicks = Math.max(pState.offBalanceTicks || 0, stumbleTicks);
    pState.balanceSeverity = Math.max(pState.balanceSeverity || 0, severity);

    return false;
}

/**
 * Main Physics and Movement Engine
 * Handles momentum, mass-based inertia, gap friction, and Newtonian collisions.
 */
export function updatePlayerPosition(pState, timeDelta, allPlayers = []) {
    if (!pState || typeof pState.x !== 'number') return;

    const dt =
        Number.isFinite(timeDelta) && timeDelta > 0
            ? timeDelta
            : TICK_DURATION_SECONDS;

    pState.vx = pState.vx || 0;
    pState.vy = pState.vy || 0;

    // Advance jam duration once per simulation tick, including ticks
    // where movement returns early because the player is restricted.
    const isJammedThisTick =
        Number.isFinite(pState.jammedTicks) &&
        pState.jammedTicks > 0;

    if (isJammedThisTick) {
        pState.jammedTicks = Math.max(0, pState.jammedTicks - 1);
    }

    const telemetryActive =
        typeof window !== 'undefined' &&
        Boolean(window.__ACTIVE_PLAY_TELEMETRY__);

    const telemetryTick =
        telemetryActive && Number.isFinite(window.__CURRENT_TICK__)
            ? window.__CURRENT_TICK__
            : 0;
    
    // A downed player slides on remaining momentum but cannot steer or act.
    // Recovery advances once per movement update; no per-tick player scan is needed.
    if (pState.balanceState === 'downed') {
        const remainingDownedTicks = Number.isFinite(pState.downedTicks)
            ? Math.max(0, pState.downedTicks)
            : 0;

        if (remainingDownedTicks > 0) {
            pState.downedTicks = remainingDownedTicks - 1;

            const downedFriction = scalePerTickFactor(0.70, dt);
            pState.vx *= downedFriction;
            pState.vy *= downedFriction;
            pState.x += pState.vx * dt;
            pState.y += pState.vy * dt;

            if (pState.downedTicks === 0) {
                pState.balanceState = 'stable';
                pState.offBalanceTicks = 0;
                pState.balanceSeverity = 0;
                pState.vx = 0;
                pState.vy = 0;
            }

            pState.currentSpeedYPS = Math.hypot(pState.vx, pState.vy);
            pState.velocity = { x: pState.vx, y: pState.vy };
            clampToField(pState);
            return;
        }

        pState.balanceState = 'stable';
        pState.downedTicks = 0;
        pState.offBalanceTicks = 0;
        pState.balanceSeverity = 0;
    }

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

        pState._routeWaypointStallTicks = 0;

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

         // A movement-restricted player is not evidence of a failed
        // route-navigation attempt. Do not carry stale stall ticks forward.
        pState._routeWaypointStallTicks = 0;

        const passiveFriction = scalePerTickFactor(0.85, dt);
        pState.vx *= passiveFriction;
        pState.vy *= passiveFriction;

        pState.x += pState.vx * dt;
        pState.y += pState.vy * dt;

        pState.currentSpeedYPS = Math.hypot(pState.vx, pState.vy);
        pState.velocity = { x: pState.vx, y: pState.vy };

        clampToField(pState);
        return;
    }

    // Off-balance players retain momentum but cannot redirect it as quickly.
    // The timer advances once when normal movement control is available.
    const isOffBalanceThisTick =
        pState.balanceState === 'off_balance' &&
        Number.isFinite(pState.offBalanceTicks) &&
        pState.offBalanceTicks > 0;
    const offBalanceSeverityThisTick = isOffBalanceThisTick
        ? (pState.balanceSeverity || 40)
        : 0;

    if (isOffBalanceThisTick) {
        pState.offBalanceTicks = Math.max(0, pState.offBalanceTicks - 1);
        if (pState.offBalanceTicks === 0) {
            pState.balanceState = 'stable';
            pState.balanceSeverity = 0;
        }
    } else if (pState.balanceState === 'off_balance') {
        pState.balanceState = 'stable';
        pState.offBalanceTicks = 0;
        pState.balanceSeverity = 0;
    }

    // --- 3. ATTRIBUTE RETRIEVAL & NORMALIZATION ---
    const age = Math.max(12, Math.min(18, Number(pState.age) || 15));
    const defaultBackyardWeight = Math.round(90 + ((age - 12) * 17.5));
    const weight = pState.weight || pState.wgt || defaultBackyardWeight;
    const agility = pState.agility || pState.agi || 50;
    const fatigueMod = pState.fatigueModifier || 1.0;

    // Median backyard sandlot weight ratio centered around 150 lbs
    const weightRatio = Math.max(0.60, Math.min(1.50, weight / 150));
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
        !isOffBalanceThisTick &&
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
    // Pursuers and pass rushers must NEVER trigger arrival braking! They run through contact to make the tackle.
    const isDynamicPursuer = pState.action === 'pursuit' || pState.action?.includes('rush') || pState.action?.includes('blitz');

    if (
        !isOffBalanceThisTick &&
        !isDynamicPursuer &&
        (pState.movementMode === 'HOLD' || pState.movementMode === 'POINT')
    ) {
        if (distToTarget <= arrivalRadius) {
            // Apply heavy braking friction
            const targetBrakeFactor = scalePerTickFactor(0.40, dt);

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
            pState.x += pState.vx * dt;
            pState.y += pState.vy * dt;
            pState.currentSpeedYPS = Math.hypot(pState.vx, pState.vy);
            pState.velocity = { x: pState.vx, y: pState.vy };
            clampToField(pState);
            return;
        }
    }

    // --- 5. TOP SPEED CALCULATION ---
    const gapFriction = calculateGapFriction(pState, allPlayers);
    pState.isSqueezing = gapFriction < 0.9;

    // Age-, speed-rating-, and weight-adjusted top speed
    const baseMaxSpeed = getPlayerBaseSpeedYPS(pState) * fatigueMod;
    
    let actionMult = pState.speedMultiplier || 1.0;
    if (pState.isBallCarrier) actionMult *= 0.92;
    if (pState.action === 'backpedal') actionMult *= 0.55;
    if (pState.action === 'trucking') actionMult *= 0.75;

    if (isJammedThisTick) {
        actionMult *= 0.70; // 30% speed reduction while jammed
    }

    // Contact and assignment modifiers are set by the play logic.
    // Ignore invalid values rather than allowing them to poison movement.
    const contactModifier =
        Number.isFinite(pState.contactReduction) &&
        pState.contactReduction > 0
            ? pState.contactReduction
            : 1.0;

    const maxPossibleSpeed =
        baseMaxSpeed * actionMult * gapFriction * contactModifier;

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

    // --- 7. ACCELERATION (Explosiveness, Agility, and Weight) ---
    let maxAccelerationYPS2 =
        getPlayerAccelerationYPS2(pState) * fatigueMod;

    // Athletes planting their cleats to stop or cut can brake significantly faster
    // than they can accelerate forward from a dead stop (prevents ice-skating drift).
    let maxDecelerationYPS2 = maxAccelerationYPS2 * 2.85;

    // Steering response can change independently of the physical limits.
    let accelRate = maxAccelerationYPS2;

    // Balance Recovery Penalty
    // The player recently broke a tackle. The massive momentum loss is now handled
    // accurately via velocity in collisions.js, so we only apply a mild 15% penalty 
    // to simulate the runner regaining their footing/stride.
    if (pState.moveCooldown > 0) {
        accelRate *= 0.85;
        maxAccelerationYPS2 *= 0.85;
        // We do not cap deceleration here; players can still plant and stop normally
    }

    // --- 8. DECELERATION (Braking / Planting) ---
    // SACK & TACKLE DRIVE FIX:
    // Defenders in pursuit must NOT decelerate 4.5 yards before reaching the carrier!
    // They close with full sprint speed until physical tackle range (0.5y) is reached.
    const isAggressiveAttackAction = [
        'run_path', 'run_route', 'tracking_ball', 'pursuit',
        'pass_rush', 'blitz', 'blitz_gap', 'blitz_edge', 'run_gap_A'
    ].includes(pState.action);

    const isStopping =
        distToTarget < 2.5 &&
        !isAggressiveAttackAction &&
        pState.movementMode !== 'ROUTE';

    let arrivalFactor = 1.0;

    if (isStopping) {
        const stoppingDistance = 2.5;

        arrivalFactor = Math.max(
            0,
            Math.min(1, distToTarget / stoppingDistance)
        );

        // WEIGHT IMPACT ON BRAKING (Inertia):
        // Heavy players require much more time/distance to slow down.
        // Agility helps plant the feet.
        const brakePower = (2.0 + (agiFactor * 4.0)) / Math.sqrt(weightRatio);
            accelRate *= brakePower;
    }

    if (isOffBalanceThisTick) {
        // Agile players regain control sooner; severe impacts reduce control more.
        const agilityControl = Math.max(
            0.35,
            Math.min(0.75, 0.30 + (agiFactor * 0.45))
        );
        const impactControl = Math.max(
            0.65,
            1.0 - (offBalanceSeverityThisTick * 0.0035)
        );
        const controlFactor = agilityControl * impactControl;

        accelRate *= controlFactor;
        maxAccelerationYPS2 *= controlFactor;
        maxDecelerationYPS2 *= controlFactor;
    }

    // --- 9. APPLY NEWTONIAN ACCELERATION WITH DISTANCE GATING ---
    // The timestep was validated once at the start of this update.

    // Prevent players from overshooting fixed arrival points, but do NOT throttle route runners
    // at intermediate waypoints or ball carriers bursting through dynamic lanes.
    const isContinuousMotion = pState.movementMode === 'ROUTE' || pState.movementMode === 'LANE';
    const maxSafeSpeed = isContinuousMotion 
        ? effectiveMaxSpeed 
        : (distToTarget / dt) * 0.85;

    const clampedTargetSpeed = Math.min(effectiveMaxSpeed * arrivalFactor, maxSafeSpeed);

    const safeDist = Math.max(0.001, distToTarget);

    let steeringX = dx / safeDist;
    let steeringY = dy / safeDist;

    // UNIVERSAL OBSTACLE AVOIDANCE:
    // Any free player (pursuer, pulling guard, or runner) should scrape around 
    // engaged blocks when the direct route to their target is physically obstructed.
    if (distToTarget > 1.5 && pState.movementMode !== 'ROUTE') {
        const pathLengthSquared = distToTarget * distToTarget;
        let nearestProjection = Infinity;
        let avoidanceSide = 0;

        for (const other of allPlayers) {
            // Only avoid players who are actively locked up in a block
            if (other.id === pState.id || !other.isEngaged) continue;

            const offsetX = other.x - pState.x;
            const offsetY = other.y - pState.y;

            // Find where the engaged player falls along the direct path.
            const along = (offsetX * dx + offsetY * dy) / pathLengthSquared;

            if (along <= 0.05 || along >= 0.95 || along >= nearestProjection) continue;

            // Ignore blocks that are not close enough to obstruct the path laterally.
            // 1.65 yards represents the approximate physical width of two engaged players.
            const lateralDistance = Math.abs(offsetX * dy - offsetY * dx) / safeDist;
            if (lateralDistance >= 1.65) continue; 

            nearestProjection = along;

            // Steer away from the side of the path occupied by the engaged pile.
            const cross = dx * offsetY - dy * offsetX;
            avoidanceSide = Math.abs(cross) > (0.15 * safeDist)
                ? (cross < 0 ? -1 : 1)
                : (pState.x < other.x ? -1 : 1);
        }

        if (avoidanceSide !== 0) {
            const directX = steeringX;
            const directY = steeringY;

            // Blend forward movement with a stronger lateral sidestep to clear the pile.
            steeringX = directX + (directY * avoidanceSide * 1.15);
            steeringY = directY - (directX * avoidanceSide * 1.15);

            const steeringMagnitude = Math.hypot(steeringX, steeringY);
            if (steeringMagnitude > 0.001) {
                steeringX /= steeringMagnitude;
                steeringY /= steeringMagnitude;
            }
        }
    }

    // ROUTE-RUNNER RECOVERY:
    // If a receiver has persistently stalled while approaching a route
    // waypoint, temporarily steer around an opposing player occupying
    // the direct path. Keep the original waypoint intact.
    const isRouteRunner =
        pState.isOffense &&
        pState.action === 'run_route' &&
        pState.movementMode === 'ROUTE';

    const isPassTargetTracker =
        pState.isOffense &&
        pState.action === 'tracking_ball' &&
        pState.movementMode === 'POINT';

    if (
        (isRouteRunner || isPassTargetTracker) &&
        distToTarget > 1.5 &&
        (Number(pState._routeWaypointStallTicks) || 0) >= 4
    ) {
        const pathLengthSquared = distToTarget * distToTarget;

        let nearestAlongPath = Infinity;
        let routeObstacle = null;
        let avoidanceSide = 0;

        for (const other of allPlayers) {
            // Only react to opposing players. Ignore self and ghost
            // players that do not participate in physical collisions.
            if (
                other.id === pState.id ||
                other.isOffense === pState.isOffense ||
                other.ghostTicks > 0
            ) {
                continue;
            }

            const offsetX = other.x - pState.x;
            const offsetY = other.y - pState.y;

            // Project the opponent onto the receiver's direct path
            // toward the current route waypoint.
            const alongPath = (
                (offsetX * dx) + (offsetY * dy)
            ) / pathLengthSquared;

            // Consider obstructions between the receiver and waypoint,
            // including a defender occupying the waypoint itself.
            if (
                alongPath <= 0 ||
                alongPath > 1.05 ||
                alongPath >= nearestAlongPath
            ) {
                continue;
            }

            const lateralDistance = Math.abs(
                (offsetX * dy) - (offsetY * dx)
            ) / safeDist;

            // Only respond to opponents close enough to obstruct the
            // receiver's direct physical path.
            if (lateralDistance >= 1.55) {
                continue;
            }

            nearestAlongPath = alongPath;
            routeObstacle = other;

            // Choose the side opposite the defender's position relative
            // to the intended route. Use a consistent fallback when the
            // defender is almost exactly on the route centerline.
            const cross = (dx * offsetY) - (dy * offsetX);

            avoidanceSide =
                Math.abs(cross) > (0.15 * safeDist)
                    ? (cross < 0 ? -1 : 1)
                    : (pState.x < other.x ? -1 : 1);
        }

        if (routeObstacle && avoidanceSide !== 0) {
            const directX = steeringX;
            const directY = steeringY;

            // Blend forward progress with a lateral sidestep.
            // Steering remains subject to normal agility, acceleration,
            // speed limits, and physical collision resolution.
            const sidestepStrength = 0.95;

            steeringX =
                directX +
                (directY * avoidanceSide * sidestepStrength);

            steeringY =
                directY -
                (directX * avoidanceSide * sidestepStrength);

            const steeringMagnitude = Math.hypot(
                steeringX,
                steeringY
            );

            if (steeringMagnitude > 0.001) {
                steeringX /= steeringMagnitude;
                steeringY /= steeringMagnitude;
            }

            // Log only when the obstructing defender changes.
            if (
                telemetryActive &&
                pState._lastRouteAvoidanceDefenderId !== routeObstacle.id
            ) {
                logPlayDebug(
                    'ROUTE_OBSTACLE_AVOIDANCE',
                    `${pState.name} sidesteps ${routeObstacle.name} while moving toward a target`,
                    {
                        receiver: pState.name,
                        defender: routeObstacle.name,
                        defenderId: routeObstacle.id,
                        routeTarget: {
                            x: Number(targetX.toFixed(2)),
                            y: Number(targetY.toFixed(2))
                        },
                        distanceToTarget: Number(
                            distToTarget.toFixed(2)
                        ),
                        stallTicks: pState._routeWaypointStallTicks,
                        avoidanceSide
                    },
                    telemetryTick
                );
            }

            pState._lastRouteAvoidanceDefenderId = routeObstacle.id;
        } else {
            pState._lastRouteAvoidanceDefenderId = null;
        }
    } else {
        pState._lastRouteAvoidanceDefenderId = null;
    }

    const targetVx = steeringX * clampedTargetSpeed;
    const targetVy = steeringY * clampedTargetSpeed;

    // Smoothly steer toward the desired velocity.
    // The exponential form behaves consistently across different timestep sizes.
     const steeringAlpha = 1 - Math.exp(-Math.max(0, accelRate) * dt);

    const currentVX = pState.vx;
    const currentVY = pState.vy;

    const proposedVX =
        currentVX + (targetVx - currentVX) * steeringAlpha;
    const proposedVY =
        currentVY + (targetVy - currentVY) * steeringAlpha;

    let deltaVX = proposedVX - currentVX;
    let deltaVY = proposedVY - currentVY;

    // Enforce a physical acceleration limit on each velocity change.
    const deltaVelocity = Math.hypot(deltaVX, deltaVY);
    const currentVelocityMagnitude = Math.hypot(currentVX, currentVY);
    const desiredSpeed = Math.hypot(targetVx, targetVy);

    const targetDirectionAlignment =
        currentVelocityMagnitude > 0.05 && desiredSpeed > 0.05
            ? (
                (currentVX / currentVelocityMagnitude) * (targetVx / desiredSpeed) +
                (currentVY / currentVelocityMagnitude) * (targetVy / desiredSpeed)
            )
            : 1.0;

    const isBraking =
        desiredSpeed < currentVelocityMagnitude - 0.05 ||
        targetDirectionAlignment < 0;

    // Apply physical acceleration limits independently of steering response.
    const effectiveAccelerationYPS2 = isBraking
        ? Math.max(0, maxDecelerationYPS2)
        : Math.max(0, maxAccelerationYPS2);

    const maxVelocityChange = effectiveAccelerationYPS2 * dt;
    
    if (
        deltaVelocity > maxVelocityChange &&
        deltaVelocity > 0
    ) {
        const scale = maxVelocityChange / deltaVelocity;
        deltaVX *= scale;
        deltaVY *= scale;
    }

    pState.vx = currentVX + deltaVX;
    pState.vy = currentVY + deltaVY;

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
    // Diagnostic snapshot: separate steering behavior from changes
    // introduced by physical collision resolution.
    const telemetryBeforeCollision = telemetryActive
        ? {
            x: pState.x,
            y: pState.y,
            vx: pState.vx,
            vy: pState.vy
        }
        : null;

    resolveNewtonianCollisions(pState, allPlayers);

    const telemetryCollisionResponse = telemetryBeforeCollision
        ? {
            positionDelta: {
                x: pState.x - telemetryBeforeCollision.x,
                y: pState.y - telemetryBeforeCollision.y
            },
            velocityDelta: {
                x: pState.vx - telemetryBeforeCollision.vx,
                y: pState.vy - telemetryBeforeCollision.vy
            }
        }
        : null;

    // --- 11. FINALIZE MOVEMENT ---
    pState.x += pState.vx * dt;
    pState.y += pState.vy * dt;

    clampToField(pState);

    // Gameplay route recovery is independent of telemetry and Debug Mode.
    // This counter exists to advance a route waypoint when physical
    // obstruction prevents progress; it is not diagnostic event data.
    const routeRemainingDistance = Math.hypot(
        targetX - pState.x,
        targetY - pState.y
    );

    const routeProgressTowardTarget =
        distToTarget - routeRemainingDistance;

    const previousRouteStallTarget = pState._routeStallTarget;

    const routeStallTargetChanged =
        !previousRouteStallTarget ||
        Math.hypot(
            targetX - previousRouteStallTarget.x,
            targetY - previousRouteStallTarget.y
        ) > 0.5;

    if (routeStallTargetChanged) {
        pState._routeWaypointStallTicks = 0;
    }

    pState._routeStallTarget = {
        x: targetX,
        y: targetY
    };

    const isReceiverNavigation =
        pState.isOffense &&
        (
            (
                pState.action === 'run_route' &&
                pState.movementMode === 'ROUTE'
            ) ||
            (
                pState.action === 'tracking_ball' &&
                pState.movementMode === 'POINT'
            )
        );

    const isStalledRouteWaypoint =
        isReceiverNavigation &&
        distToTarget > 2.0 &&
        routeProgressTowardTarget < 0.03 &&
        !isJammedThisTick &&
        !pState._intent?.settled;

    if (isStalledRouteWaypoint) {
        pState._routeWaypointStallTicks =
            (pState._routeWaypointStallTicks || 0) + 1;
    } else {
        pState._routeWaypointStallTicks = 0;
    }

    // Diagnostic stall tracking stays opt-in.
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

        // Chasing a moving ball carrier or turning to track an airborne ball 
        // does not constitute being stuck in geometry or colliding with an obstacle.
        const isDynamicAction = ['pursuit', 'tracking_ball'].includes(pState.action);

        const isStalled =
            distToTarget > 2.0 &&
            !isMakingProgress &&
            !isDynamicAction &&
            !pState._intent?.settled;

        if (isStalled) {
            pState._telemetryStallTicks =
                (pState._telemetryStallTicks || 0) + 1;

            if (
                pState._telemetryStallTicks >= 8 &&
                !pState._telemetryStallLogged
            ) {
                const routeVectorX = targetX - pState.x;
                const routeVectorY = targetY - pState.y;
                const routeVectorLength = Math.hypot(
                    routeVectorX,
                    routeVectorY
                );
                const routeVectorLengthSquared =
                    routeVectorLength * routeVectorLength;

                const routeWaypoint =
                    pState.action === 'run_route'
                        ? pState.routePath?.[pState.currentPathIndex] ?? null
                        : null;

                const routeContext = pState.action === 'run_route'
                    ? {
                        assignment: pState.assignment ?? null,
                        currentPathIndex: pState.currentPathIndex ?? null,
                        routeLength: pState.routePath?.length ?? 0,
                        currentWaypoint: routeWaypoint
                            ? {
                                x: Number(routeWaypoint.x.toFixed(2)),
                                y: Number(routeWaypoint.y.toFixed(2))
                            }
                            : null,
                        waypointDistance: routeWaypoint
                            ? Number(
                                getDistance(pState, routeWaypoint).toFixed(2)
                            )
                            : null,
                        waypointStallTicks:
                            pState._routeWaypointStallTicks || 0,
                        avoidanceDefenderId:
                            pState._lastRouteAvoidanceDefenderId ?? null,
                        intentMode: pState._intent?.mode ?? null,
                        intentTarget: pState._intent
                            ? {
                                x: Number(
                                    pState._intent.targetX.toFixed(2)
                                ),
                                y: Number(
                                    pState._intent.targetY.toFixed(2)
                                )
                            }
                            : null
                    }
                    : null;

                const nearbyPlayers = allPlayers
                    .filter(other =>
                        other.id !== pState.id &&
                        getDistance(pState, other) <
                            (pState.action === 'run_route' ? 4.5 : 1.5)
                    )
                    .sort((a, b) =>
                        getDistance(pState, a) - getDistance(pState, b)
                    )
                    .slice(0, 6)
                    .map(other => {
                        const offsetX = other.x - pState.x;
                        const offsetY = other.y - pState.y;

                        const alongPath =
                            routeVectorLengthSquared > 0.001
                                ? (
                                    (offsetX * routeVectorX) +
                                    (offsetY * routeVectorY)
                                ) / routeVectorLengthSquared
                                : null;

                        const lateralPathDistance =
                            routeVectorLength > 0.001
                                ? Math.abs(
                                    (offsetX * routeVectorY) -
                                    (offsetY * routeVectorX)
                                ) / routeVectorLength
                                : null;

                        return {
                            id: other.id,
                            name: other.name,
                            slot: other.slot ?? null,
                            role: other.role ?? null,
                            action: other.action ?? null,
                            isOffense: Boolean(other.isOffense),
                            x: Number(other.x.toFixed(2)),
                            y: Number(other.y.toFixed(2)),
                            distance: Number(
                                getDistance(pState, other).toFixed(2)
                            ),
                            alongPathFraction:
                                alongPath === null
                                    ? null
                                    : Number(alongPath.toFixed(2)),
                            lateralPathDistance:
                                lateralPathDistance === null
                                    ? null
                                    : Number(
                                        lateralPathDistance.toFixed(2)
                                    ),
                            isBlocked: Boolean(other.isBlocked),
                            isEngaged: Boolean(other.isEngaged),
                            stunnedTicks: other.stunnedTicks ?? 0
                        };
                    });
                logPlayDebug(
                    'MOVEMENT_STALL',
                    `${pState.name} is failing to approach the target`,
                    {
                        action: pState.action ?? null,
                        movementMode: pState.movementMode ?? null,
                        routeContext,

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

                        movementMath: {
                            dt: Number(dt.toFixed(4)),
                            baseMaxSpeed: Number(baseMaxSpeed.toFixed(2)),
                            actionMultiplier: Number(actionMult.toFixed(2)),
                            contactModifier: Number(contactModifier.toFixed(2)),
                            turningPenalty: Number(turningPenalty.toFixed(2)),
                            effectiveMaxSpeed: Number(effectiveMaxSpeed.toFixed(2)),
                            arrivalFactor: Number(arrivalFactor.toFixed(2)),
                            targetSpeed: Number(clampedTargetSpeed.toFixed(2)),

                            targetVelocity: {
                                x: Number(targetVx.toFixed(2)),
                                y: Number(targetVy.toFixed(2))
                            },

                            targetDirectionAlignment: Number(
                                targetDirectionAlignment.toFixed(3)
                            ),
                            isBraking,

                            effectiveAccelerationYPS2: Number(
                                effectiveAccelerationYPS2.toFixed(2)
                            ),
                            maxVelocityChange: Number(
                                maxVelocityChange.toFixed(3)
                            ),

                            velocityBeforeCollision: telemetryBeforeCollision
                                ? {
                                    x: Number(telemetryBeforeCollision.vx.toFixed(2)),
                                    y: Number(telemetryBeforeCollision.vy.toFixed(2))
                                }
                                : null
                        },

                        collisionResponse: telemetryCollisionResponse
                            ? {
                                positionDelta: {
                                    x: Number(telemetryCollisionResponse.positionDelta.x.toFixed(3)),
                                    y: Number(telemetryCollisionResponse.positionDelta.y.toFixed(3))
                                },
                                velocityDelta: {
                                    x: Number(telemetryCollisionResponse.velocityDelta.x.toFixed(3)),
                                    y: Number(telemetryCollisionResponse.velocityDelta.y.toFixed(3))
                                }
                            }
                            : null,

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
 * Avoids garbage-collection array allocations and prevents unrealistic 65% slowdowns in running lanes.
 */
function calculateGapFriction(pState, allPlayers) {
    let minFriction = 1.0;
    const px = pState.x;
    const py = pState.y;

    // Fast indexed iteration without creating temporary filter arrays
    for (let i = 0; i < allPlayers.length; i++) {
        const p1 = allPlayers[i];
        if (p1.id === pState.id) continue;
        const d1 = Math.hypot(px - p1.x, py - p1.y);
        if (d1 >= 2.0) continue;

        for (let j = i + 1; j < allPlayers.length; j++) {
            const p2 = allPlayers[j];
            if (p2.id === pState.id) continue;

            const gapWidth = Math.hypot(p1.x - p2.x, p1.y - p2.y);
            if (gapWidth < 1.6) {
                const midX = (p1.x + p2.x) * 0.5;
                const midY = (p1.y + p2.y) * 0.5;
                const distToGap = Math.hypot(px - midX, py - midY);

                if (distToGap < 0.9) {
                    // Squeezing through a seam provides resistance, not complete paralysis
                    let friction = 0.65 + (Math.max(0, gapWidth - 0.5) / 1.1) * 0.35;
                    
                    // Powerful runners drop their pads and power through tight interior seams
                    const pStr = pState.str || pState.strength || 50;
                    const pWgt = pState.wgt || pState.weight || 200;
                    const powerFactor = ((pStr / 100) * 0.5) + (((pWgt - 180) / 140) * 0.5);
                    friction += (powerFactor * 0.20);
                    
                    friction = Math.max(0.60, Math.min(1.0, friction));
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

        // Exempt QB and Center while under center and during the initial dropback step
        const isQBCenter = (pState.role === 'QB' && other.slot === 'OL2') || (other.role === 'QB' && pState.slot === 'OL2');
        if (isQBCenter && (pState.action === 'qb_setup' || other.action === 'qb_setup') && (!pState.hasCompletedDropback || !other.hasCompletedDropback)) {
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
