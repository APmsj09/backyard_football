import { getDistance } from './physics.js';
import { getPlayer } from './state.js';
import { pushGameLog } from './collisions.js';
import { logPlayDebug } from './telemetry.js';
import { getDecisionProfile } from './decision_model.js';
import { getPerceptionContext, getPerceptionWeight } from './perception.js';
import { isDebugMode } from './debug_mode.js';
import { getPlayerBaseSpeedYPS } from './movement_profile.js';

const FIELD_WIDTH = 53.3;
const FIELD_LENGTH = 120;
const CENTER_X = FIELD_WIDTH / 2;
const HASH_LEFT_X = 18.0;
const HASH_RIGHT_X = 35.3;

export function diagnosePlay(pState, tick, offenseStates, playState = null) {
    const decisionProfile = getDecisionProfile(pState, tick);
    const visionContext = getPerceptionContext(
        pState,
        tick,
        18,
        25,
        3.25
    );

    const debugEnabled = isDebugMode();
    const iq = pState.playbookIQ || 50;

    // Players use only the opponents currently within their perceptual range.
    const qb = offenseStates.find(p =>
        p.slot?.startsWith('QB') &&
        getPerceptionWeight(visionContext, p) > 0
    );

    const rbs = offenseStates.filter(p =>
        p.slot?.startsWith('RB') &&
        getPerceptionWeight(visionContext, p) > 0
    );

    const ol = offenseStates.filter(p =>
        p.slot?.startsWith('OL') &&
        getPerceptionWeight(visionContext, p) > 0
    );

    // Read only observable game state, not the offensive play call.
    const observedCarrier = offenseStates.find(p =>
        (p.hasBall || p.isBallCarrier) &&
        getPerceptionWeight(visionContext, p) > 0
    );
    const isBallInAir = Boolean(
        playState?.ballState?.inAir ||
        playState?.ballState?.throwInitiated
    );

    const observedRunCarrier =
        Boolean(observedCarrier && observedCarrier.role !== 'QB');

    // A QB rollout behind the line of scrimmage is a passing threat, not a confirmed run!
    const qbScramble =
        (qb?.action === 'qb_scramble' && qb.y > (playState?.lineOfScrimmage || 0)) ||
        Boolean(
            qb &&
            observedCarrier?.id === qb.id &&
            Number.isFinite(playState?.lineOfScrimmage) &&
            qb.y > playState.lineOfScrimmage + 0.5
        );

    if (isBallInAir) {
        pState._diagnosedGuess = 'pass';
        pState._diagnosedConfidence = 1.0;
        if (debugEnabled && pState._lastLoggedGuess !== 'pass') {
            logPlayDebug('DEF_READ', `${pState.name} (${pState.role}) committed to [PASS] (Ball In Air)`, {
                confidence: 1.0, direction: pState._diagnosedDirection || 'center', dirConfidence: 1.0
            });
            pState._lastLoggedGuess = 'pass';
        }
        return { guess: 'pass', confidence: 1.0, direction: pState._diagnosedDirection || 'center', dirConfidence: 1.0 };
    }

    if (observedRunCarrier || qbScramble) {
        pState._diagnosedGuess = 'run';
        pState._diagnosedConfidence = 1.0;
        pState._sawLiveRunnerTick = tick; // FIX: Remember that we saw a live runner

        if (debugEnabled && pState._lastLoggedGuess !== 'run') {
            logPlayDebug('DEF_READ', `${pState.name} (${pState.role}) committed to [RUN] (${observedRunCarrier ? 'Observed ball carrier' : 'QB scramble'})`, {
                confidence: 1.0, direction: pState._diagnosedDirection || 'center', dirConfidence: 1.0
            });
            pState._lastLoggedGuess = 'run';
        }
        return { guess: 'run', confidence: 1.0, direction: pState._diagnosedDirection || 'center', dirConfidence: 1.0 };
    }

    // FIX: Once a defender confirms a live runner, do not let them flip back to [PASS] for at least 15 ticks (0.6s)
    // even if the runner briefly leaves their narrow forward gaze cone while turning.
    if (pState._diagnosedGuess === 'run' && pState._sawLiveRunnerTick && (tick - pState._sawLiveRunnerTick < 15)) {
        return { guess: 'run', confidence: pState._diagnosedConfidence || 1.0, direction: pState._diagnosedDirection || 'center', dirConfidence: 1.0 };
    }

    /*// A defender who already committed to 'pass' on a pass play NEVER reverts to 'run'
    if (pState._diagnosedGuess === 'pass' && truePlayType === 'pass') {
        return {
            guess: 'pass',
            confidence: pState._diagnosedConfidence || 0.85,
            direction: pState._diagnosedDirection || 'center',
            dirConfidence: pState._diagnosedDirConfidence || 0.75
        };
    }*/

    // 2. ACCUMULATE FOOTBALL KEYS
    let runScore = 0; let passScore = 0;
    let leftScore = 10; let rightScore = 10; let centerScore = 15;

    if (qb) {
        if (qb.action === 'qb_setup' && qb.hasCompletedDropback) passScore += 45;
        else if (qb.action === 'qb_setup' && !qb.hasCompletedDropback) passScore += 20;
        else if (qb.action === 'handoff_setup') runScore += 45;

        if (qb.vx > 1.5) rightScore += 30;
        else if (qb.vx < -1.5) leftScore += 30;
    }

    let passBlocks = 0;
    let runBlocks = 0;

    ol.forEach(lineman => {
        // Give defenders a few ticks to observe the first step.
        if (tick < 5) return;

        const initialX = lineman.initialX ?? lineman.x;
        const initialY = lineman.initialY ?? lineman.y;

        const lateralStep = lineman.x - initialX;
        const forwardStep = lineman.y - initialY;

        // An OL holding pass pro might get shoved downfield; don't count that as a run block!
        const isPassAssignment = lineman.action === 'pass_block' || lineman.assignment === 'pass_block';

        if (forwardStep < -0.12 || (lineman.vy || 0) < -0.75 || (isPassAssignment && tick < 35)) {
            passBlocks++;
        } else if (forwardStep > 0.25 && !isPassAssignment) {
            runBlocks++;
        }

        // A pulling lineman reveals direction by moving laterally
        // while advancing toward the defensive side.
        if (forwardStep > 0.15 && lateralStep > 0.65) {
            runScore += 18;
            rightScore += 35;
        } else if (forwardStep > 0.15 && lateralStep < -0.65) {
            runScore += 18;
            leftScore += 35;
        }
    });

    if (passBlocks > runBlocks) {
        passScore += Math.min(30, passBlocks * 8);
    }

    if (runBlocks > passBlocks) {
        runScore += Math.min(30, runBlocks * 8);
    }

    rbs.forEach(rb => {
        if (rb.isBallCarrier) runScore += 60;
        else if (rb.action === 'run_path' && rb.y > (qb?.y || 0)) runScore += 20;
        else if (rb.action === 'pass_block') passScore += 20;

        if (rb.vx > 2.0) rightScore += 40;
        else if (rb.vx < -2.0) leftScore += 40;
        else if (rb.vy > 1.5) centerScore += 30;
    });

    /*const isPlayAction = offensivePlayKey && offensivePlayKey.includes('PA_');
    if (isPlayAction) {
        if (tick < 25) {
            runScore += Math.max(25, 60 - (iq * 0.35));
            if (offensivePlayKey.includes('Bootleg_Right')) leftScore += 40;
            if (offensivePlayKey.includes('Bootleg_Left')) rightScore += 40;
        } else {
            const realizeTick = 25 + Math.max(0, Math.floor((100 - iq) / 10));
            if (tick >= realizeTick) {
                passScore += 70; // IQ-based play-action recovery
            }
        }
    }*/

    // 3. LOW-PASS FILTERED PERCEPTION BIAS (No 20Hz noise spikes)
    const timeFactor = Math.min(1.0, tick / 30);
    const iqFactor = iq / 100;

    const readReliability = (
        (decisionProfile.decisionQuality * 0.85) +
        (decisionProfile.assignmentDiscipline * 0.15)
    ) / 100;

    const noiseMax = 20 * (1.0 - readReliability);

    if (pState._diagNoise === undefined) {
        pState._diagNoise = (Math.random() - 0.5) * noiseMax;
    } else {
        pState._diagNoise = (pState._diagNoise * 0.94) + (((Math.random() - 0.5) * noiseMax) * 0.06);
    }

    const rawRunScore = (runScore * timeFactor * (0.6 + iqFactor * 0.4)) + pState._diagNoise + (pState.role === 'LB' ? 12 : 0);
    const rawPassScore = (passScore * timeFactor * (0.6 + iqFactor * 0.4)) - pState._diagNoise + (pState.role === 'DB' ? 12 : 0);

    // Smooth the raw scores to prevent flickering when players enter/exit vision
    pState._smoothedRunScore = ((pState._smoothedRunScore || rawRunScore) * 0.8) + (rawRunScore * 0.2);
    pState._smoothedPassScore = ((pState._smoothedPassScore || rawPassScore) * 0.8) + (rawPassScore * 0.2);

    const finalRunScore = pState._smoothedRunScore;
    const finalPassScore = pState._smoothedPassScore;

    // 4. HYSTERESIS COMMITMENT (Requires a 20-point margin to flip an existing read)
    let currentGuess = pState._diagnosedGuess || 'read';
    let guess = currentGuess;
    const confidence = Math.max(0, Math.min(1.0, Math.abs(finalRunScore - finalPassScore) / 50));
    const commitThreshold = 0.55 - (iqFactor * 0.25);

    if (currentGuess === 'read') {
        if (confidence > commitThreshold || tick > 35) {
            guess = finalRunScore >= finalPassScore ? 'run' : 'pass';
        }
    } else if (currentGuess === 'run') {
        // FIX: If the defender saw a confirmed live ball carrier, offensive line step cues cannot revert them to PASS
        if (pState._sawLiveRunnerTick && (tick - pState._sawLiveRunnerTick < 40)) {
            guess = 'run';
        } else if (finalPassScore > finalRunScore + 20) {
            guess = 'pass';
        }
    } else if (currentGuess === 'pass') {
        if (finalRunScore > finalPassScore + 20) {
            guess = 'run';
        }
    }

    // 5. STABLE DIRECTION WITH DEADZONE
    const totalDirScore = Math.max(1, leftScore + rightScore + centerScore);
    const rightMargin = rightScore - Math.max(leftScore, centerScore);
    const leftMargin = leftScore - Math.max(rightScore, centerScore);

    let direction = 'center';
    let dirConfidence = centerScore / totalDirScore;

    if (rightMargin > 15) {
        direction = 'right';
        dirConfidence = rightScore / totalDirScore;
    } else if (leftMargin > 15) {
        direction = 'left';
        dirConfidence = leftScore / totalDirScore;
    } else {
        direction = 'center';
        dirConfidence = centerScore / totalDirScore;
    }

    // Committed reads maintain a minimum confidence floor of 0.30
    const finalConfidence = (guess === 'read') ? confidence : Math.max(0.30, confidence);

    pState._diagnosedDirection = direction;
    pState._diagnosedDirConfidence = dirConfidence;
    pState._diagnosedGuess = guess;
    pState._diagnosedConfidence = finalConfidence;

    if (debugEnabled && pState._lastLoggedGuess !== guess && guess !== 'read') {
        logPlayDebug('DEF_READ', `${pState.name} (${pState.role}) committed to [${guess.toUpperCase()}]`, {
            confidence: Number(finalConfidence.toFixed(2)),
            direction,
            dirConfidence: Number(dirConfidence.toFixed(2)),
            runScore: Number(finalRunScore.toFixed(1)),
            passScore: Number(finalPassScore.toFixed(1)),
            scoreMargin: Number(Math.abs(finalRunScore - finalPassScore).toFixed(1)),
            commitThreshold: Number(commitThreshold.toFixed(2)),
            iq,
            passBlocks,
            runBlocks,
            timeFactor: Number(timeFactor.toFixed(2)),
            qbAction: qb?.action ?? null,
            observedCarrier: observedCarrier ? {
                id: observedCarrier.id,
                name: observedCarrier.name,
                role: observedCarrier.role,
                x: observedCarrier.x,
                y: observedCarrier.y
            } : null
        }, tick);

        pState._lastLoggedGuess = guess;
    }

    return { guess, confidence: finalConfidence, direction, dirConfidence };
}

export function calculateSafetyHelp(safetyState, defenseStates, offenseStates, ballCarrierState, playState, isBallInAir) {
    if (!safetyState || safetyState.role !== 'DB') return null;

    // FIX: Abort safety help if the ball has been completed or is in a live runner's hands
    const passCompleted = playState.statEvents?.some(e => e.type === 'completion');
    const runnerHasBall = ballCarrierState && (ballCarrierState.hasBall || ballCarrierState.isBallCarrier) && ballCarrierState.role !== 'QB';
    if (passCompleted || runnerHasBall || (!isBallInAir && playState.ballState?.throwTick)) {
        return null;
    }

    const LOS = playState.lineOfScrimmage;
    const defensiveCall = playState.defensiveCall || {};
    const defPlayKey = playState.defensivePlayKey || '';

    const isCover2 = defPlayKey.includes('Cover_2') || defensiveCall.isCover2 || false;
    const isCover3 = defPlayKey.includes('Cover_3') || defensiveCall.isCover3 || false;
    const isCover1 = defPlayKey.includes('Cover_1') || defPlayKey.includes('Man_Free') || defensiveCall.isCover1 || false;

    const corners = defenseStates.filter(d => d.role === 'DB' && d.id !== safetyState.id);
    const inManCoverage = corners.filter(d => d.assignment && d.assignment.startsWith('man_cover_'));

    let helpTarget = null;
    let maxPressure = 0;

    inManCoverage.forEach(corner => {
        const targetSlot = corner.assignment.replace('man_cover_', '');
        const receiver = offenseStates.find(r => r.slot === targetSlot);

        if (receiver) {
            const separationDist = getDistance(corner, receiver);
            const isBallTargeted = isBallInAir && playState.ballState.targetPlayerId === receiver.id;
            const distFromSafety = getDistance(safetyState, receiver);

            // Greater separation means greater need for safety help.
            // Safeties prioritize helping receivers closer to their side of the field.
            let pressureScore = separationDist - (distFromSafety * 0.15);
            if (isBallTargeted) pressureScore += 5;

            if (pressureScore > maxPressure) {
                maxPressure = pressureScore;
                helpTarget = { corner, receiver };
            }
        }
    });

    let shouldHelp = maxPressure > 4.0;

    if (isCover2) {
        const helperHalf = safetyState.x < CENTER_X ? 'left' : 'right';
        const cornerHalf = helpTarget?.corner.x < CENTER_X ? 'left' : 'right';
        shouldHelp = shouldHelp && (helperHalf === cornerHalf) && (maxPressure > 6.0);
    } else if (isCover3) {
        if (safetyState.x < HASH_LEFT_X || safetyState.x > HASH_RIGHT_X) {
            shouldHelp = maxPressure > 5.0;
        } else {
            shouldHelp = maxPressure > 4.0;
        }
    } else if (isCover1) {
        shouldHelp = maxPressure > 3.0;
    }

    if (!shouldHelp) return null;

    const ballFlightTime = isBallInAir ? playState.tick - (playState.ballState.releaseTick || playState.ballState.throwTick || 0) : 0;
    const MIN_FLIGHT_TICKS = 5;

    if (isBallInAir && ballFlightTime < MIN_FLIGHT_TICKS) return null;
    if (isBallInAir && maxPressure < 6.0 && ballFlightTime < MIN_FLIGHT_TICKS + 3) return null;

    if (helpTarget && helpTarget.receiver) {
        const helpTargetId = helpTarget.receiver.id;

        if (isDebugMode() && safetyState._lastLoggedHelpTargetId !== helpTargetId) {
            logPlayDebug(
                'SAFETY_HELP_DECISION',
                `${safetyState.name} commits to help on ${helpTarget.receiver.name}`,
                {
                    coverage: isCover2 ? 'Cover_2' : isCover3 ? 'Cover_3' : isCover1 ? 'Cover_1' : 'Other',
                    targetReceiver: helpTarget.receiver.name,
                    targetCorner: helpTarget.corner.name,
                    pressureScore: Number(maxPressure.toFixed(2)),
                    separation: Number(getDistance(helpTarget.corner, helpTarget.receiver).toFixed(2)),
                    ballInAir: isBallInAir,
                    ballFlightTime: Number(ballFlightTime.toFixed(1))
                },
                playState.tick
            );

            safetyState._lastLoggedHelpTargetId = helpTargetId;
        }

        const helpX = (helpTarget.corner.x * 0.3) + (helpTarget.receiver.x * 0.7);
        const helpY = Math.max(helpTarget.receiver.y + 1.5, LOS + 10);

        return {
            type: 'help',
            helpX: helpX,
            helpY: helpY,
            targetReceiver: helpTarget.receiver,
            targetCorner: helpTarget.corner,
            pressureScore: maxPressure,
            delayedHelp: true
        };
    }

    return null;
}

export function evaluateCoverageAlignment(defenseStates, playState) {
    const LOS = playState.lineOfScrimmage;

    const shallow = defenseStates.filter(d => d.y < LOS + 8);
    const intermediate = defenseStates.filter(d => d.y >= LOS + 8 && d.y < LOS + 16);
    const deep = defenseStates.filter(d => d.y >= LOS + 16);

    const safeties = defenseStates.filter(d => d.role === 'DB' && d.assignment && d.assignment.includes('zone_deep'));
    const safetyDepths = safeties.map(s => s.y - LOS);
    const avgSafetyDepth = safetyDepths.length > 0 ?
        safetyDepths.reduce((a, b) => a + b) / safetyDepths.length : 15;

    const isTwoHigh = safeties.length >= 2 && Math.max(...safetyDepths) - Math.min(...safetyDepths) < 5;
    const isSingleHigh = safeties.length === 1 || (safeties.length >= 2 && avgSafetyDepth > 12);

    return {
        shallowCount: shallow.length,
        intermediateCount: intermediate.length,
        deepCount: deep.length,
        safetyCount: safeties.length,
        avgSafetyDepth: avgSafetyDepth,
        isTwoHigh: isTwoHigh,
        isSingleHigh: isSingleHigh,
        defenseCoverage: isTwoHigh ? 'TWO_HIGH' : 'SINGLE_HIGH'
    };
}

export function analyzePlaySuccess(lastPlayState, offensiveTeam, defensiveTeam) {
    if (!lastPlayState || !lastPlayState.result) return null;

    const result = lastPlayState.result;
    const gainedYards = result.yards || 0;
    const completionStatus = result.passComplete ? 1 : 0;
    const wasTouchdown = result.isTouchdown ? 1 : 0;
    const wasIntercepted = result.interception ? 1 : 0;
    const wasFumbled = result.fumble ? 1 : 0;

    let successScore = 50;

    if (result.playType === 'pass') {
        successScore = completionStatus * 60;
        successScore += Math.min(20, gainedYards / 2);
        successScore -= wasIntercepted * 25;
    } else if (result.playType === 'run') {
        successScore = Math.min(40, gainedYards / 1.5);
        successScore += 20 + (gainedYards > 4 ? 20 : 10);
        successScore -= wasFumbled * 20;
    }

    successScore += wasTouchdown * 30;
    successScore = Math.max(0, Math.min(100, successScore));

    return {
        playKey: result.playKey || 'unknown',
        playerSlot: result.ballCarrierSlot || 'unknown',
        defenseMatchupKey: result.defenseCall || 'unknown',
        successScore: successScore,
        yardsGained: gainedYards,
        playType: result.playType,
        isSuccess: successScore > 50,
        wasTouchdown: wasTouchdown,
        turnover: wasIntercepted || wasFumbled
    };
}

export function getSmartCarrierTarget(runner, defenseStates, offenseStates, fieldWidth = 53.3, playState = {}) {
    const decisionProfile = getDecisionProfile(runner, playState.tick);
    const iq = decisionProfile?.awareness ?? (runner.playbookIQ || 50);
    const agility = runner.agility || 50;
    const strength = runner.strength || 50;

    const currentVx = runner.vx || 0;
    const currentVy = runner.vy || 0;
    const currentSpeed = Math.hypot(currentVx, currentVy);
    const debugEnabled = isDebugMode();
    let carrierDecisionAction = null;

    const visionContext = getPerceptionContext(
        runner,
        playState.tick,
        14,
        21,
        3.2
    );

    let maxLateral = 8.0 + (agility / 50);
    if (currentSpeed > 4.5) maxLateral = 5.0;
    if (currentSpeed > 7.0) maxLateral = 4.0;

    const LOS = playState.lineOfScrimmage || 60;
    const isBehindLine = runner.y < LOS + 1.2;

    // Backfield vision should include a usable bounce lane for ordinary runners.
    // IQ expands that search, while speed still limits how sharply a runner
    // can redirect without losing momentum.
    if (isBehindLine) {
        const visionExpansion = Math.max(0, (iq - 50) / 12.5);
        maxLateral = Math.min(maxLateral, 3.0 + visionExpansion);
    }

    const DEFENDER_REACTION_RANGE = 6.5;
    const DEFENDER_REACTION_RANGE_SQ =
        DEFENDER_REACTION_RANGE * DEFENDER_REACTION_RANGE;

    let nearbyDefenderCount = 0;
    let nearestVisibleDefender = null;
    let nearestVisibleDefenderDistSq = Infinity;

    // Single pass: count visible nearby defenders and track the closest one.
    // No filtered array and no sorting on the normal gameplay path.
    for (let i = 0; i < defenseStates.length; i++) {
        const defender = defenseStates[i];

        if (
            defender.isBlocked ||
            defender.stunnedTicks > 0 ||
            defender.y <= runner.y - 1
        ) {
            continue;
        }

        const dx = runner.x - defender.x;
        const dy = runner.y - defender.y;
        const distanceSq = (dx * dx) + (dy * dy);

        if (distanceSq > DEFENDER_REACTION_RANGE_SQ) continue;

        const perceptionWeight = getPerceptionWeight(
            visionContext,
            defender
        );

        if (perceptionWeight <= 0) continue;

        // Keep traffic density local; a defender farther away does not
        // automatically count as immediate congestion.
        if (distanceSq < 16.0) {
            nearbyDefenderCount++;
        }

        // Track a defender who is ahead and close enough to affect the
        // current running lane. Ignore wide defenders for this response.
        if (Math.abs(dx) > 4.5) continue;

        if (distanceSq < nearestVisibleDefenderDistSq) {
            nearestVisibleDefenderDistSq = distanceSq;
            nearestVisibleDefender = defender;
        }
    }

    const inTraffic = nearbyDefenderCount >= 2;

    const laneOffsets = [0];
    [1.5, 3.0, 5.0, 8.0, 10.0].forEach(off => {
        if (off <= maxLateral) {
            laneOffsets.push(off);
            laneOffsets.push(-off);
        }
    });

    const visionDepth = 3.5 + (iq / 25);
    let bestScore = -Infinity;
    let bestTargetX = runner.x;
    let bestTargetY = runner.y + visionDepth;
    let bestOffset = 0;

    const prevOffset = runner._chosenLaneOffset !== undefined ? runner._chosenLaneOffset : 0;

    // Preserve lane commitment unless a visible defender enters the
    // reaction window. A safety should not need to be within tackle
    // range before the RB can reconsider his path.
    const defenderInReactionWindow =
        nearestVisibleDefenderDistSq <= DEFENDER_REACTION_RANGE_SQ;

    if (
        !defenderInReactionWindow &&
        runner._laneLockTicks > 0 &&
        runner._lockedLaneX !== undefined
    ) {
        runner._laneLockTicks--;
        bestTargetX = runner._lockedLaneX;
        bestTargetY = runner.y + visionDepth;
        runner._smoothTargetX = bestTargetX;

        return {
            x: bestTargetX,
            y: bestTargetY
        };
    }

    const evaluatedLanesTracker = debugEnabled ? [] : null;

    // Pre-calculate the threat straight up the middle so we know if we NEED to bounce outside
    let centerThreat = 0;
    defenseStates.forEach(def => {
        if (def.stunnedTicks > 0 || def.y < runner.y - 1.0) return;
        // Focus center threat specifically on the immediate 3-yard tunnel ahead
        const dist = Math.hypot(runner.x - def.x, (runner.y + Math.min(visionDepth, 3.0)) - def.y);
        
        if (dist < 4.5) {
            // Both unblocked AND engaged defenders physically clog the middle!
            const weight = (def.isBlocked || def.isEngaged) ? 6 : 10;
            centerThreat += (weight / (dist + 0.1));
        }
    });

    laneOffsets.forEach((offset) => {
        const testX = runner.x + offset;
        const testY = runner.y + visionDepth;

        if (testX < 1 || testX > fieldWidth - 1) return;

        let score = 100;
        const lateralShift = Math.abs(offset);
        
        // DEEPER FIX: Remove the crippling "inTraffic" penalty that forced RBs into the pile.
        // Instead, we only apply a small physical penalty for changing momentum.
        const agilityMitigation = Math.max(0.3, (120 - agility) / 80);
        const momentumConflict = Math.abs(offset - (currentVx * 0.6));
        score -= (momentumConflict * 4.0 * agilityMitigation);

        // When the middle is congested, make a wider lane a genuine option.
        // IQ increases the preference but does not determine whether the runner
        // can recognize an obvious outside opening at all.
        const centerThreatDetected = isBehindLine && centerThreat > 6.0;

        if (centerThreatDetected && lateralShift >= 3.0) {
            const bounceIQ = Math.max(0, (iq - 50) / 50);
            score += 24 + (lateralShift * 4.0 * bounceIQ);
        }

        // Discipline encourages commitment, while less reliable runners
        // are more likely to change lanes unnecessarily.
        const offsetDiffFromPrev = Math.abs(offset - prevOffset);
        const laneStickiness =
            20 + ((decisionProfile?.assignmentDiscipline ?? 50) * 0.2); // Buffed stickiness

        if (offsetDiffFromPrev < 0.5) {
            score += laneStickiness;
        } else if (!(centerThreatDetected && lateralShift >= 3.0)) {
            // Normally discourage unnecessary lane changes.
            // Do not let that penalty trap the runner behind a congested middle.
            score -= offsetDiffFromPrev * (
                4.0 + ((decisionProfile?.assignmentDiscipline ?? 50) * 0.02)
            );

            // Severe penalty for unnecessary zig-zags.
            if (offsetDiffFromPrev >= 3.0) {
                score -= 40;
            }
        }
        
        // LATE GAME CLOCK MANAGEMENT: Run out of bounds if trailing in the 4th quarter
        const isLateTrailing = (playState.quarter >= 4 || playState.quarter === 'OT') &&
            (playState.timeRemaining <= 150) &&
            ((playState.offenseScore || 0) < (playState.defenseScore || 0));

        if (isLateTrailing) {
            const distToLeftSideline = testX;
            const distToRightSideline = FIELD_WIDTH - testX;
            const distToNearestSideline = Math.min(distToLeftSideline, distToRightSideline);

            if (distToNearestSideline < 4.0) {
                score += (4.0 - distToNearestSideline) * 15;
            }
        }

        let laneThreat = 0;
        let nearestDefDist = Infinity; // Track absolute closest defender for open-space scoring
        let overPursuitDetected = false;

        offenseStates.forEach(blocker => {
            if (blocker.id !== runner.id && (blocker.action?.includes('block') || blocker.action === 'run_path')) {
                const lateralDist = Math.abs(testX - blocker.x);
                // Expand vision ahead so RBs detect the pile before running into it
                const isAhead = blocker.y >= runner.y && blocker.y <= runner.y + 4.0;

                if (isAhead) {
                    if (lateralDist < 0.7) {
                        // Heavy collision penalty for running straight into the back of your own lineman
                        score -= 100;
                    } else if (lateralDist >= 1.0 && lateralDist <= 2.5) {
                        // Reward daylight off the hip / in the gap
                        score += 50;
                    }
                }
            }
        });

        defenseStates.forEach(def => {
            if (def.stunnedTicks > 0 || def.y < runner.y - 1.0) return;

            const perceptionWeight = getPerceptionWeight(
                visionContext,
                def
            );

            if (perceptionWeight <= 0) return;

            const defPredX = def.x + ((def.vx || 0) * 0.3);
            const defPredY = def.y + ((def.vy || 0) * 0.3);
            const distToPredicted = Math.hypot(testX - defPredX, testY - defPredY);

            // Open-Space tracking: Update nearest defender (even if they are blocked, they are still a physical body in the way)
            if (distToPredicted < nearestDefDist) {
                nearestDefDist = distToPredicted;
            }

            if (!def.isBlocked && !def.isEngaged) {
                if (distToPredicted < 5.5) {
                    const threatFalloff = Math.max(0, 1.0 - (distToPredicted / 5.5));
                    laneThreat += (280 / (distToPredicted + 0.6)) * threatFalloff * perceptionWeight;

                    // Detect Overpursuit for Cutback lanes
                    const defLateralSpeed = def.vx || 0;
                    if (
                        perceptionWeight >= 0.5 &&
                        Math.abs(defLateralSpeed) > 2.5
                    ) {
                        const defGoingRight = defLateralSpeed > 0;
                        if ((defGoingRight && offset < -1.0) || (!defGoingRight && offset > 1.0)) {
                            overPursuitDetected = true;
                        }
                    }
                }
            } else {
                // Engaged defenders are STILL a physical obstacle!
                if (distToPredicted < 2.5) {
                    score -= (2.5 - distToPredicted) * 40; 
                }
                if (distToPredicted < 1.2) {
                    score -= 100; // Do not run straight into an engaged defender's back!
                }

                // Defender is engaged with a blocker: reward running to the open side of the block
                const blocker = (typeof def.blockedBy === 'object' && def.blockedBy !== null) ? def.blockedBy :
                    (typeof def.engagedWith === 'object' && def.engagedWith !== null) ? def.engagedWith :
                        offenseStates.find(o => o.id === def.blockedBy || o.id === def.engagedWith);
                
                if (blocker) {
                    const distToBlock = Math.hypot(testX - blocker.x, testY - blocker.y);
                    if (distToBlock >= 1.0 && distToBlock <= 3.0 && blocker.y > runner.y) {
                        const defIsRight = def.x > blocker.x;
                        const laneIsLeft = testX < blocker.x;
                        if (defIsRight === laneIsLeft) score += 60;
                        else score -= 50;
                    }
                }
            }
        });

        const riskTolerance = decisionProfile?.riskTolerance ?? 1.0;
        score -= laneThreat * (2.0 - riskTolerance);

        // OPEN-SPACE & IQ-SCALED VISION:
        // Smart runners evaluate green grass and open space much better than low-IQ runners.
        const iqFactor = iq / 100; // 0.2 to 1.0 scale
        const openSpaceReward = Math.min(75, nearestDefDist * 10) * (0.4 + (iqFactor * 0.6));
        score += openSpaceReward;

        // CUTBACK VISION (IQ-Scaled):
        // If defenders overpursue, high-IQ runners spot backside cutback lanes against the grain
        if (iq >= 60 && overPursuitDetected) {
            const cutbackMultiplier = (iq - 50) / 50; // 0.2 to 1.0
            score += 70 * cutbackMultiplier;
        }

        if (debugEnabled) {
            evaluatedLanesTracker.push({
                offset,
                score: Math.round(score),
                threat: Math.round(laneThreat)
            });
        }

        if (score > bestScore) {
            bestScore = score;
            bestTargetX = testX;
            bestTargetY = testY;
            bestOffset = offset;
        }
    });

    // Latch absolute field corridor when committing to a cut
    if (bestOffset !== prevOffset) {
        runner._laneLockTicks = 18; // Increased from 10 to allow cuts to physically develop
        runner._lockedLaneX = bestTargetX;

        if (debugEnabled) {
            evaluatedLanesTracker.sort((a, b) => b.score - a.score);

            logPlayDebug('RB_LANE_FLIP', `${runner.name} switched running lanes`, {
                fromOffset: prevOffset,
                toOffset: bestOffset,
                position: {
                    x: Number(runner.x.toFixed(2)),
                    y: Number(runner.y.toFixed(2))
                },
                chosenTarget: {
                    x: Number(bestTargetX.toFixed(2)),
                    y: Number(bestTargetY.toFixed(2))
                },
                maxLateral,
                isBehindLine,
                inTraffic,
                nearestVisibleThreat: nearestVisibleDefender?.name || null,
                topChoices: evaluatedLanesTracker.slice(0, 3)
            }, playState.tick);
        }
    } else if (runner._lockedLaneX === undefined) {
        runner._lockedLaneX = bestTargetX;
    }

    runner._chosenLaneOffset = bestOffset;

    // BACKFIELD PATIENCE (High-IQ Feature):
    // If behind or right at the line of scrimmage and traffic is clogged,
    // a smart, high-IQ runner will throttle down their forward momentum to let blocks develop,
    // rather than blindly crashing into the back of their own linemen at full speed.

    if (isBehindLine && inTraffic && iq >= 70) {
        // Poise scales with IQ: 90 IQ runners exhibit superior patience compared to 70 IQ runners
        const poiseFactor = Math.max(0.35, 1.0 - ((iq - 65) / 45)); 
        bestTargetY = runner.y + (visionDepth * poiseFactor); // Shorten target depth to stall forward rush
        runner.vx *= 0.80; // Gentle velocity check to simulate setting feet behind the block
        runner.vy *= 0.80;
    }

    // Smooth lateral target interpolation to prevent instant hash-to-hash snapping
    if (runner._smoothTargetX === undefined) runner._smoothTargetX = runner.x;
    const smoothAlpha = 0.35 + (agility / 200);
    bestTargetX = (runner._smoothTargetX * (1 - smoothAlpha)) + (bestTargetX * smoothAlpha);
    runner._smoothTargetX = bestTargetX;


    const immediateThreat = nearestVisibleDefender;

    if (
        immediateThreat &&
        nearestVisibleDefenderDistSq <= DEFENDER_REACTION_RANGE_SQ
    ) {
        const threatDistance = Math.sqrt(nearestVisibleDefenderDistSq);
        const strengthAdvantage =
            strength - (immediateThreat.strength || 50);

        // A powerful back can choose to challenge a lone defender once
        // close; strength alone should not force every back to truck.
        const shouldTruckOneOnOne =
            !inTraffic &&
            threatDistance <= 3.75 &&
            strengthAdvantage > 10 &&
            strength >= agility;

        if (
            strengthAdvantage > 10 &&
            (
                (inTraffic && bestScore < 50) ||
                shouldTruckOneOnOne
            )
        ) {
            carrierDecisionAction = 'trucking';

            bestTargetX =
                immediateThreat.x +
                (immediateThreat.x > runner.x ? -0.4 : 0.4);

            bestTargetY = immediateThreat.y + 1.5;
            runner.contactReduction = 0.9;

            if (debugEnabled && runner._lastLoggedAction !== 'trucking') {
                logPlayDebug(
                    'CARRIER_DECISION',
                    `${runner.name} lowers shoulder to TRUCK`,
                    { threat: immediateThreat.name }
                );

                runner._lastLoggedAction = 'trucking';
            }
        } else {
            // Dodge persistence cooldown to prevent 20Hz vibration
            let dodgeDir =
                runner._dodgeDir ||
                (runner.x <= immediateThreat.x ? -1 : 1);

            if (!runner._dodgeCooldown || runner._dodgeCooldown <= 0) {
                const preferredLaneDirection =
                    Math.abs(bestTargetX - runner.x) > 0.75
                        ? Math.sign(bestTargetX - runner.x)
                        : 0;

                if (preferredLaneDirection !== 0) {
                    dodgeDir = preferredLaneDirection;
                } else if ((immediateThreat.vx || 0) < -2.0) {
                    dodgeDir = 1;
                } else if ((immediateThreat.vx || 0) > 2.0) {
                    dodgeDir = -1;
                } else {
                    dodgeDir = runner.x <= immediateThreat.x ? -1 : 1;
                }
                /*if ((immediateThreat.vx || 0) < -2.0) dodgeDir = 1;
                else if ((immediateThreat.vx || 0) > 2.0) dodgeDir = -1;
                else dodgeDir = runner.x < immediateThreat.x ? -1 : 1;*/

                if (runner.x < 4) dodgeDir = 1;
                if (runner.x > fieldWidth - 4) dodgeDir = -1;

                runner._dodgeDir = dodgeDir;
                runner._dodgeCooldown = 8;

                if (debugEnabled) {
                    logPlayDebug('CARRIER_DECISION', `${runner.name} EVADES ${dodgeDir === 1 ? 'right' : 'left'}`, { threat: immediateThreat.name });
                    runner._lastLoggedAction = 'dodge';
                }
            } else {
                runner._dodgeCooldown--;
            }

            const dodgeWidth = 1.0 + (agility / 50);
            bestTargetX = (bestTargetX * 0.4) + ((runner.x + (dodgeDir * dodgeWidth)) * 0.6);
            bestTargetY = Math.min(bestTargetY, runner.y + 3.0); // Allow more forward progress during dodge
        }
    }

    bestTargetX = Math.max(1.0, Math.min(fieldWidth - 1.0, bestTargetX));
    // Keep smoothing anchor synchronized with final post-dodge position
    runner._smoothTargetX = bestTargetX;

    // Only perform diagnostic work when Debug Mode is enabled.
    // Log only meaningful lane shifts to prevent flooding while running straight.
    if (debugEnabled) {
        const cutDistance = Math.abs(
            bestTargetX - (runner._lastLoggedTargetX ?? runner.x)
        );

        if (cutDistance > 2.0) {
            logPlayDebug('CARRIER_VISION', `${runner.name} evaluated lanes`, {
                offset: Number((bestTargetX - runner.x).toFixed(1)),
                bestScore: Math.round(bestScore),

                position: {
                    x: Number(runner.x.toFixed(2)),
                    y: Number(runner.y.toFixed(2))
                },

                target: {
                    x: Number(bestTargetX.toFixed(2)),
                    y: Number(bestTargetY.toFixed(2))
                },

                velocity: {
                    vx: Number((runner.vx || 0).toFixed(2)),
                    vy: Number((runner.vy || 0).toFixed(2)),
                    speed: Number(currentSpeed.toFixed(2))
                },

                chosenOffset: bestOffset,
                inTraffic,
                action: runner.action,

                topChoices: evaluatedLanesTracker
                    .slice()
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 3)
            }, playState.tick);

            runner._lastLoggedTargetX = bestTargetX;
        }
    }

    return {
        x: bestTargetX,
        y: bestTargetY,
        action: carrierDecisionAction
    };
}
export function updateQBDecision(qbState, offenseStates, defenseStates, playState, offensiveAssignments, gameLog) {
    if (!qbState || !qbState.hasBall || playState.ballState.inAir || playState.ballState.throwInitiated) return;
    if (qbState.isEngaged || qbState.stunnedTicks > 0) return;
    if (qbState.action === 'sacked') return;

    // Once the QB commits to a scramble, don't resume passing decisions.
    if (qbState.action === 'run_path' && playState.qbIntent === 'scramble') return;

    const debugEnabled = isDebugMode();

    if (typeof qbState.ticksInPocket === 'undefined') qbState.ticksInPocket = 0;
    qbState.ticksInPocket++;

    const qbProfile = getDecisionProfile(qbState, playState.tick);
    const scoreDiff = (playState.offenseScore || 0) - (playState.defenseScore || 0);
    const currentQuarter = playState.quarter || 1;
    const timeRemaining = playState.timeRemaining || 720;
    const down = Number(playState.down) || 1;
    const yardsToGo = Number(playState.yardsToGo) || 10;

    const isDesperationTime = (currentQuarter >= 4) &&
        ((scoreDiff < 0 && timeRemaining <= 120) || (scoreDiff <= -9 && timeRemaining <= 300));

    const hasQBCrossedLine = qbState.y > (playState.lineOfScrimmage + 0.5);
    if (hasQBCrossedLine) {
        if (!qbState.hasProcessedLineCrossing) {
            const pressureDefender = defenseStates.find(d => !d.isBlocked && !d.isEngaged && getDistance(qbState, d) < 4.5);
            if (pressureDefender && getDistance(qbState, pressureDefender) < 2.0) {
                if (gameLog) gameLog.push(`💥 ${qbState.name} tackled after crossing the line of scrimmage!`);
                qbState.action = 'sacked';
                qbState.hasProcessedLineCrossing = true;
                return;
            } else {
                qbState.action = 'run_path';
                playState.qbIntent = 'scramble';
                if (gameLog) gameLog.push(`🏃 ${qbState.name} scrambles after crossing the line!`);
                qbState.hasProcessedLineCrossing = true;
                return;
            }
        }
        return;
    } else {
        qbState.hasProcessedLineCrossing = false;
    }

    const qbPlayer = getPlayer(qbState.id);
    const qbAttrs = qbPlayer?.attributes || {
        mental: { playbookIQ: 50, decisionMaking: 50 },
        physical: { agility: 50, strength: 50 },
        technical: { throwingAccuracy: 50, throwPower: 50 }
    };

    const qbIQ = Math.max(
        20,
        Math.min(99, qbProfile?.awareness ?? qbAttrs.mental?.playbookIQ ?? 50)
    );

    const qbDecision = Math.max(
        20,
        Math.min(99, qbProfile?.decisionMaking ?? qbAttrs.mental?.decisionMaking ?? qbIQ)
    );
    const qbAgility = qbAttrs.physical?.agility || 50;
    const qbStrength = qbAttrs.physical?.strength || 50;
    // Uses throwPower with safe fallback to strength/pState
    const qbPower = qbAttrs.technical?.throwPower ?? qbState.throwPower ?? qbState.thp ?? qbStrength;
    const qbAcc = qbAttrs.technical?.throwingAccuracy || 50;

    // Post-snap processing ability.
    // IQ = understanding the offense/play.
    // Decision Making = choosing correctly under pressure.
    const qbProcessing = (qbIQ * 0.40) + (qbDecision * 0.60);

    if (!qbState.readProgression || qbState.readProgression.length === 0) {
        qbState.readProgression = offenseStates
            .filter(p =>
                p.slot !== 'QB1' &&
                !p.slot.startsWith('OL') &&
                (p.action.includes('route') || p.action === 'idle')
            )
            .sort((a, b) => {
                // When the play doesn't provide an explicit progression,
                // start with the players who are currently giving the QB
                // the best immediate opportunity.
                //
                // This is deliberately based on football context,
                // not overall rating or positional prestige.

                const getImmediateValue = (p) => {
                    let value = 0;

                    if (p.action.includes('route')) value += 10;

                    const routeDepth =
                        p.y - (playState.lineOfScrimmage || 0);

                    // Favor viable early reads without automatically
                    // forcing short or deep targets.
                    if (routeDepth >= 3 && routeDepth <= 14) value += 4;

                    if (p.assignment?.includes('Screen')) value += 2;

                    return value;
                };

                return getImmediateValue(b) - getImmediateValue(a);
            })
            .map(p => p.slot);
    }

    const progression = qbState.readProgression;

    if (typeof qbState.ticksOnCurrentRead === 'undefined') qbState.ticksOnCurrentRead = 0;
    if (typeof qbState.currentReadTargetSlot === 'undefined') qbState.currentReadTargetSlot = progression[0];

    // --- ELITE QB EYE MANIPULATION (Looking off Safeties) ---
    if (qbIQ > 75 && playState.tick < 30 && progression.length > 1) {
        const trueTarget = offenseStates.find(o => o.slot === progression[0]);
        if (trueTarget && trueTarget.initialX !== undefined) {
            const decoy = offenseStates.find(o =>
                o.slot !== 'QB1' &&
                !o.slot.startsWith('OL') &&
                o.slot !== trueTarget.slot &&
                (o.action?.includes('route') || o.action === 'run_path') &&
                o.initialX !== undefined &&
                Math.sign(o.initialX - 26.6) !== Math.sign(trueTarget.initialX - 26.6)
            );
            if (decoy) {
                qbState.currentReadTargetSlot = decoy.slot;
                if (debugEnabled && qbState._lastLoggedDecoy !== decoy.slot) {
                    logPlayDebug('QB_EYE_MANIPULATION', `${qbState.name} uses eyes to look safety off primary read (${progression[0]}) using decoy ${decoy.slot}`, {
                        trueRead: progression[0],
                        decoySlot: decoy.slot
                    });
                    qbState._lastLoggedDecoy = decoy.slot;
                }
                if (gameLog && playState.tick === 25 && Math.random() < 0.1) {
                    pushGameLog(gameLog, `[Tick ${playState.tick}] 👀 ${qbState.name} uses his eyes to look the safety off his primary read!`, playState);
                }
            } else {
                qbState.currentReadTargetSlot = progression[0];
            }
        } else {
            qbState.currentReadTargetSlot = progression[0];
        }
    } else {
        // Normal progression tracking with telemetry on read transitions
        const readIndex = Math.min(progression.length - 1, Math.floor(qbState.ticksInPocket / (Math.max(8, (110 - qbIQ) / 3))));

        if (debugEnabled && qbState._lastReadIndex !== readIndex) {
            logPlayDebug('QB_READ_PROGRESSION', `${qbState.name} advances to read #${readIndex + 1} (${progression[readIndex]})`, {
                tick: playState.tick,
                targetSlot: progression[readIndex],
                readIndex: readIndex + 1
            });
            qbState._lastReadIndex = readIndex;
        }

        qbState.currentReadTargetSlot = progression[readIndex];
    }

    if (!progression || progression.length === 0) {
        const emergencyProgression = offenseStates
            .filter(p => p.slot !== 'QB1' && !p.slot.startsWith('OL'))
            .map(p => p.slot);

        if (emergencyProgression.length === 0) {
            if (gameLog) gameLog.push(`${qbState.name} has no targets and takes the sack.`);
            qbState.action = 'sacked';
            return;
        }
        qbState.readProgression = emergencyProgression;
        qbState.currentReadTargetSlot = emergencyProgression[0];
    }

    const unblocked = defenseStates
        .filter(d =>
            !d.isBlocked &&
            !d.isEngaged &&
            d.stunnedTicks === 0 &&
            getDistance(qbState, d) < 4.5
        )
        .sort((a, b) =>
            getDistance(qbState, a) - getDistance(qbState, b)
        );

    const pressureDefender = unblocked[0] ?? null;
    const pressureCount = unblocked.length;
    const isPressured = !!pressureDefender;
    const imminentSackDefender = isPressured && getDistance(qbState, pressureDefender) < 1.2;
    const isHotReadSituation = isPressured && getDistance(qbState, pressureDefender) < 4.5;

    const getTargetValue = (slotOrRole) => {
        const rec = offenseStates.find(r =>
            r.slot === slotOrRole ||
            r.role === slotOrRole ||
            r.assignedPlayerSlot === slotOrRole
        );

        if (!rec || !rec.action.includes('route')) return null;

        const routeAssignment = String(rec.assignment || '').toLowerCase();
        const playKey = String(playState?.playKey || '').toLowerCase();

        const distFromQB = getDistance(qbState, rec);
        let estimatedBallSpeed = 22;

        // Arm power drives flight speed
        if (distFromQB > 25) estimatedBallSpeed = 16 + (qbPower / 100) * 14.0;
        else if (distFromQB < 12) estimatedBallSpeed = 16 + (qbPower / 100) * 14.0;

        const estimatedFlightTime = distFromQB / estimatedBallSpeed;
        
        // Route projection logic
        const recYPS = getPlayerBaseSpeedYPS(rec) * (rec.fatigueModifier || 1.0);
        let distanceToTravel = recYPS * estimatedFlightTime;

        let currX = rec.x;
        let currY = rec.y;
        let lastValidDirX = 0;
        let lastValidDirY = 1;

        if (rec.routePath && rec.currentPathIndex < rec.routePath.length) {
            for (let i = rec.currentPathIndex; i < rec.routePath.length; i++) {
                const nextNode = rec.routePath[i];
                const dx = nextNode.x - currX;
                const dy = nextNode.y - currY;
                const distToNext = Math.hypot(dx, dy);

                if (distToNext > 0.1) {
                    lastValidDirX = dx / distToNext;
                    lastValidDirY = dy / distToNext;
                }

                if (distanceToTravel > distToNext) {
                    distanceToTravel -= distToNext;
                    currX = nextNode.x;
                    currY = nextNode.y;
                } else {
                    const ratio = distanceToTravel / distToNext;
                    currX = currX + dx * ratio;
                    currY = currY + dy * ratio;
                    distanceToTravel = 0;
                    break;
                }
            }
            const isContinuousRoute = ['Fly', 'Go', 'Streak', 'Vert', 'Fade'].some(r => rec.assignment?.includes(r));
            if (distanceToTravel > 0 && isContinuousRoute) {
                currX += lastValidDirX * distanceToTravel;
                currY += lastValidDirY * distanceToTravel;
            }
        } else {
            currX += (rec.vx || 0) * estimatedFlightTime;
            currY += (rec.vy || 0) * estimatedFlightTime;
        }

        const projRecX = currX;
        const projRecY = currY;

        const depth = rec.y - (playState.lineOfScrimmage || 0);
        let minProjectedSeparation = 20;
        let defendersClosingIn = 0;
        let undercutThreat = 0;

        defenseStates.forEach(d => {
            if (d.stunnedTicks > 0 || d.isEngaged || d.isBlocked) return;

            const projDefX = d.x + (d.vx || 0) * estimatedFlightTime;
            const projDefY = d.y + (d.vy || 0) * estimatedFlightTime;
            const projDist = Math.hypot(projRecX - projDefX, projRecY - projDefY);

            if (projDist < minProjectedSeparation) {
                minProjectedSeparation = projDist;
            }

            if (projDist < 2.5) defendersClosingIn++; // Fixed: Reduced from 4.0 to 2.5

            // Dynamic IQ-Weighted Deep Safety & Over-The-Top Capping
            const isSafetyOrDeepDB = d.role === 'DB' && (d.y > playState.lineOfScrimmage + 9);
            const rawDistToRec = Math.hypot(rec.x - d.x, rec.y - d.y);
            const isOverTheTop = d.y > (rec.y - 1.2) && Math.abs(projDefX - projRecX) < 6.0;
            const isBaitingShallow = isSafetyOrDeepDB && (d.y >= rec.y - 3.5 && d.y <= rec.y) && Math.abs(d.x - rec.x) < 4.5;

            // IQ Layer: High IQ QBs detect safety closing speed and trap baiting.
            // Low IQ QBs have tunnel vision and miss closing safeties.
            const qbSafetyVision = Math.max(0.2, (qbIQ - 20) / 75);

            if (depth > 10 && (isOverTheTop || (isBaitingShallow && qbIQ > 68))) {
                const effectiveCappingDist = Math.min(projDist, rawDistToRec);
                minProjectedSeparation = Math.min(minProjectedSeparation, effectiveCappingDist * (1.2 - (qbSafetyVision * 0.4)));
                defendersClosingIn += Math.round(2 * qbSafetyVision);
            }

            const distDefToQB = Math.hypot(projDefX - qbState.x, projDefY - qbState.y);
            if (distDefToQB < distFromQB - 1.5) {
                const dx = projRecX - qbState.x;
                const dy = projRecY - qbState.y;
                const defDx = projDefX - qbState.x;
                const defDy = projDefY - qbState.y;

                // IQ Layer: Undercut recognition expands for smart QBs
                const undercutSensitivity = 0.84 + ((100 - qbIQ) / 100) * 0.08;
                const dot = (dx * defDx + dy * defDy) / (distFromQB * distDefToQB);
                if (dot > undercutSensitivity) {
                    undercutThreat += (4.5 - (distDefToQB / distFromQB) * 4.0) * qbSafetyVision;
                }
            }
        });

        let score = Math.min(minProjectedSeparation, 6) * 10;

        // FIX 1: Recognize Defensive Cushion vs Real Separation.
        // If a defender is sitting directly downfield (over the top), that distance is cushion, not separation!
        const defenderOverTheTop = defenseStates.find(d => 
            !d.isBlocked && !d.isEngaged && 
            d.y > rec.y && d.y < rec.y + 7.0 && 
            Math.abs(d.x - rec.x) < 2.5
        );
        if (defenderOverTheTop && !isPressured) {
            score -= 30; // Defender is capping the route from above; don't throw into his chest
        }

        // FIX: Only make the QB wait for the cut on sharp-breaking routes, so we don't break Drags and Flats!
        const needsToWait = ['Dig', 'Corner', 'Post', 'Out', 'In', 'Comeback', 'PostCorner', 'Sluggo', 'Out_And_Up', 'Hitch_And_Go', 'Texas'].some(r => routeAssignment.includes(r.toLowerCase()));
        const hasRouteCut = rec.routePath && rec.routePath.length > 1;
        const isBeforeCut = needsToWait && hasRouteCut && rec.currentPathIndex < (rec.routePath.length - 1);
        if (isBeforeCut) {
            if (!isPressured) {
                score -= 25; // Let the receiver make his break, but don't go completely blind
            } else {
                score -= 15; // When pressured, the QB is more willing to throw early anticipation passes
            }
        }

        // FIX 3: Deep Vertical Route Depth Gating.
        // On Fly/Go/Streak/FourVerts routes, require the receiver to get at least 9.0 yards downfield before throwing a bomb.
        const isDeepVertical = ['Fly', 'Go', 'Streak', 'Vert', 'Fade'].some(r => rec.assignment?.includes(r));
        if (isDeepVertical && depth < 9.0 && !isPressured) {
            score -= 40; // Let the receiver push downfield and stack the defender before launching
        }

        // Pre-snap / Post-snap Shell Recognition
        const coverageShell = evaluateCoverageAlignment(defenseStates, playState);
        const isMiddleOfFieldRoute = Math.abs(rec.x - CENTER_X) < 8.0;

        if (depth > 14 && qbIQ >= 55) {
            const shellAwareness = (qbIQ - 50) / 50;

            if (coverageShell.isTwoHigh) {
                if (isMiddleOfFieldRoute) {
                    score += 18 * shellAwareness;
                } else if (Math.abs(rec.x - CENTER_X) > 16.0) {
                    score -= 10 * shellAwareness;
                }
            } else if (coverageShell.isSingleHigh) {
                if (isMiddleOfFieldRoute) {
            score -= 16 * shellAwareness;
                } else {
            score += 12 * shellAwareness;
                }
            }
        }

        const isScreenRoute = rec.assignment === 'Screen_Wait' || rec.assignment === 'Slip_Screen' || rec.assignment === 'Screen';
        if (isScreenRoute) {
            if (playState.tick < 22 && rec.assignment === 'Screen_Wait') {
                return { score: -100, separation: minProjectedSeparation, info: { state: rec, separation: minProjectedSeparation } };
            }
            score += 65;

            if (minProjectedSeparation < 1.0) {
                score -= 80;
            }
        }

        const yardsToGo = playState.yardsToGo ?? 10;
        const down = playState.down ?? 1;
        const targetDepth = depth;
        const distanceBeyondLOS = targetDepth;

        const isDesignedBehindLOSRoute =
            playKey.includes('screen') ||
            routeAssignment === 'flat' ||
            routeAssignment === 'bubble' ||
            routeAssignment === 'screen' ||
            routeAssignment === 'slip_screen' ||
            routeAssignment === 'screen_wait' ||
            routeAssignment === 'wr_screen_catch' ||
            routeAssignment === 'tunnel_screen_catch';

        // Penalize negative-depth throws, but preserve the value of
        // designed screens, bubbles, and shallow checkdown routes.
        if (distanceBeyondLOS < 0) {
            const behindLOSYards = Math.abs(distanceBeyondLOS);
            const penaltyPerYard = isDesignedBehindLOSRoute ? 2 : 5;
            const maxPenalty = isDesignedBehindLOSRoute ? 10 : 28;

            score -= Math.min(
                maxPenalty,
                behindLOSYards * penaltyPerYard
            );
        }

        const targetAtOrBeyondFirstDown = distanceBeyondLOS >= yardsToGo;
        if (targetAtOrBeyondFirstDown) score += (down >= 3) ? 22 : 10;
        else {
            // Negative depth increases the yards still needed after the catch.
            const yardsShort = yardsToGo - distanceBeyondLOS;
            if (down >= 3 && yardsShort > 3) score -= Math.min(24, yardsShort * 3);
            else if (down <= 2) score += (distanceBeyondLOS >= 3) ? 8 : -4;
        }

        // Short throws are naturally more attractive when pressure is coming.
        if (isPressured && targetDepth >= 0 && targetDepth <= 8) {
            score += 30;
        }

        // Under heavy pressure, don't wait for a perfect deep window.
        if (isPressured && targetDepth > 14) {
            score -= 18;
        }

        if (targetDepth > 14) {
            const deepPenalty =
                down <= 2
                    ? 10
                    : yardsToGo >= 8
                        ? 3
                        : 7;
            // Longer throws have more time for safeties and corners to recover.
            score -= deepPenalty + Math.min(8, (targetDepth - 14) * 0.25);
        }

        // ======================================================
        // COVERAGE / SEPARATION QUALITY
        // ======================================================

        // Separation matters, but returns diminish quickly.
        // Being 8 yards open isn't four times better than being 2 yards open.
        if (minProjectedSeparation >= 2.0) {
            // Separation is already represented in the base score.
            // Reward a clean window, but don't count it twice at full strength.
            score += Math.min(8, (minProjectedSeparation - 2.0) * 2.5);
        }

        // Tight-window throws should be possible for good QBs,
        // but become increasingly unattractive for poor decision makers.
        if (minProjectedSeparation < 1.5) {
            const tightWindowPenalty = (1.5 - minProjectedSeparation) *
                (2.0 + ((100 - qbDecision) / 18));

            score -= tightWindowPenalty * 4;
        }

        // Multiple defenders closing on the target is a major warning.
        if (defendersClosingIn >= 2) {
            score -= 25 + ((100 - qbDecision) * 0.18);
        }

        if (defendersClosingIn >= 3) {
            score -= 35 + ((100 - qbDecision) * 0.25);
        }

        // ======================================================
        // THROW DIFFICULTY / ARM STRENGTH
        // ======================================================

        if (depth >= 2 && depth <= 14) {
            // Intermediate throws are the normal bread-and-butter option.
            if (minProjectedSeparation > 1.2) {
                score += 20;
            }
        }

        if (depth > 14) {
            // Noodle-arm QBs are penalized for chucking deep balls they can't reach
            if (qbPower < 60) {
                score -= (60 - qbPower) * 2.0;
            }

            // Heavy coverage penalty for chucking deep into multiple defenders or safeties
            if (defendersClosingIn >= 1) {
                // Penalize heavily based on how long the ball is in the air
                const hangTimePenalty = Math.max(1.0, estimatedFlightTime / 1.5);
                score -= (25 + ((100 - qbDecision) * 0.45)) * hangTimePenalty * defendersClosingIn;
            }

            if (minProjectedSeparation >= 3.5 && defendersClosingIn === 0) {
                score += 5 + (qbIQ * 0.03);
            } else if (defendersClosingIn > 0) {
                score -= Math.max(20, (85 - qbDecision) * 1.2);
            }
        }

        // ======================================================
        // UNDERCUT / DEFENDER leverage
        // ======================================================

        if (undercutThreat > 0) {
            const leveragePenalty = 22 + ((100 - qbDecision) * 0.20);
            score -= undercutThreat * leveragePenalty;
        }

        // ======================================================
        // GAME SITUATION
        // ======================================================

        const isLateTrailing =
            (playState.quarter >= 4 || playState.quarter === 'OT') &&
            (playState.timeRemaining <= 150) &&
            ((playState.offenseScore || 0) < (playState.defenseScore || 0));

        if (isLateTrailing && qbDecision > 65) {
            const distToBoundary = Math.min(rec.x, FIELD_WIDTH - rec.x);

            if (distToBoundary < 4.0) {
                score += 20;
            }

            if (targetDepth >= yardsToGo) {
                score += 15;
            }
        }

        // Leading late: avoid needless low-percentage hero throws.
        const isLateLeading =
            (playState.quarter >= 4 || playState.quarter === 'OT') &&
            (playState.timeRemaining <= 150) &&
            ((playState.offenseScore || 0) > (playState.defenseScore || 0));

        if (isLateLeading && qbDecision > 60) {
            if (depth > 15 && minProjectedSeparation < 3.0) {
                score -= 20;
            }
        }

        // ======================================================
        // QB DECISION-MAKING SHOULD AFFECT RISK TOLERANCE,
        // NOT WHICH PLAYER HE "LIKES"
        // ======================================================

        const decisionRiskTolerance = 0.65 + (qbDecision / 100) * 0.35;
        const personalityRiskTolerance = qbProfile?.riskTolerance ?? 1.0;

        // Decision-making controls evaluation quality; personality modestly
        // influences willingness to accept risk.
        score *= decisionRiskTolerance * personalityRiskTolerance;

        return {
            score: score,
            separation: minProjectedSeparation,
            info: { state: rec, separation: minProjectedSeparation }
        };
    };

    if (qbState.action === 'qb_scramble') {
        const qbSpeed = qbAttrs.physical?.speed || 50;
        const LOS = playState.lineOfScrimmage;
        const distToFirstDown = (LOS + (playState.yardsToGo || 10)) - qbState.y;

        let closestDefenderDistanceAhead = 30;
        defenseStates.forEach(d => {
            if (d.stunnedTicks > 0 || d.isBlocked) return;
            const lateralOffset = Math.abs(d.x - qbState.x);
            const downfieldDist = d.y - qbState.y;

            if (lateralOffset < 3.5 && downfieldDist > 0 && downfieldDist < closestDefenderDistanceAhead) {
                closestDefenderDistanceAhead = downfieldDist;
            }
        });

        const openRunningYards = Math.max(0, closestDefenderDistanceAhead - 1.5);
        const wouldGainFirstDown = openRunningYards >= distToFirstDown;

        let rushScore = openRunningYards * 4.0;
        if (wouldGainFirstDown) rushScore += (qbIQ > 65 ? 35 : 20);
        rushScore += (qbSpeed - 50) * 0.5;

        const allReceivers = offenseStates.filter(p => p.slot !== 'QB1' && (p.action.includes('route') || p.action === 'route_complete'));
        let bestTarget = null;
        let bestPassScore = -1;

        allReceivers.forEach(rec => {
            const info = getTargetValue(rec.slot);
            if (info && info.separation > 1.2) {
                const onSameSide = Math.sign(rec.x - CENTER_X) === Math.sign(qbState.x - CENTER_X);
                const recDepth = rec.y - LOS;

                let passValue = (info.separation * 4.0) + (onSameSide ? 10 : -5);
                if (recDepth >= distToFirstDown) passValue += 20;
                if (!onSameSide) passValue -= (qbIQ / 5);

                if (passValue > bestPassScore) {
                    bestPassScore = passValue;
                    bestTarget = rec;
                }
            }
        });

        if (rushScore > 25 && rushScore > bestPassScore) {
            qbState.action = 'run_path'; // BREAK OUT OF QB_SCRAMBLE LOCK
            qbState.isBallCarrier = true;
            playState.qbIntent = 'scramble';

            if (gameLog) {
                const reason = wouldGainFirstDown ? "sees a lane for the first down" : "takes off into open green grass";
                pushGameLog(gameLog, `[Tick ${playState.tick}] 🏃 ${qbState.name} (IQ:${qbIQ}) ${reason} and tucks it!`, playState);
            }
            if (debugEnabled) {
                logPlayDebug('QB_SCRAMBLE', `${qbState.name} commits to run`, {
                    openRunningYards: Number(openRunningYards.toFixed(1)),
                    wouldGainFirstDown
                });
            }
            return;
        }

        if (bestTarget && bestPassScore > 15) {
            const onTheRunMod = (qbAgility / 100) * 0.85;
            if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] 🏃‍♂️🎯 ${qbState.name} keeps his eyes downfield and throws on the run!`, playState);
            executeThrow(qbState, bestTarget, qbPower, qbAcc * onTheRunMod, playState, gameLog, "Throw on Run");
            return;
        }

        const immediateThreat = defenseStates.find(d => !d.isBlocked && !d.isEngaged && getDistance(qbState, d) < 2.5);
        if (immediateThreat && qbIQ > 60) {
            if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] 👋 ${qbState.name} throws it away under pressure.`, playState);
            if (debugEnabled) {
                logPlayDebug('QB_THROW_AWAY', `${qbState.name} threw ball away to avoid sack`, {
                    threatDist: Number(getDistance(qbState, immediateThreat).toFixed(2))
                });
            }
            playState.ballState.inAir = true;
            playState.ballState.throwInitiated = true;
            playState.ballState.throwerId = qbState.id;
            playState.ballState.isThrowAway = true;

            const throwToLeft = qbState.x < CENTER_X;
            const targetX = throwToLeft ? -5 : FIELD_WIDTH + 5;
            const targetY = qbState.y + 10;

            playState.ballState.targetX = targetX;
            playState.ballState.targetY = targetY;

            const dx = targetX - qbState.x;
            const dy = targetY - qbState.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const ballSpeed = 25;
            const t = Math.max(0.1, dist / ballSpeed);

            playState.ballState.vx = dx / t;
            playState.ballState.vy = dy / t;
            playState.ballState.vz = (-0.3 + (4.9 * t * t)) / t;
            playState.ballState.throwTick = playState.tick;
            qbState.hasBall = false;
            
            playState.statEvents.push({ type: 'pass_attempt', qbId: qbState.id });
            return;
        }
        return;
    }

    let scanSpeedBase = Math.max(7, (115 - qbProcessing) / 3.0);

    if (isPressured) {
        const pressureProcessingMod = 1.05 - (qbDecision / 220);
        scanSpeedBase *= Math.max(0.60, pressureProcessingMod);
    }

    // FIX: Progression scanning only starts once the QB plants their back foot.
    // During the dropback, the QB stays locked on Read #1.
    if (qbState.hasCompletedDropback) {
        qbState.ticksSetInPocket = (qbState.ticksSetInPocket || 0) + 1;
    } else {
        qbState.ticksSetInPocket = 0;
    }

    const numReadsVisible = isHotReadSituation 
        ? progression.length 
        : Math.min(progression.length, 1 + Math.floor(qbState.ticksSetInPocket / scanSpeedBase));

    // DEEPER FIX: Scale dropback duration by play type. 
    // Quick passes can fire at ~1.3s (32 ticks), but deep drops need at least 1.7s (42 ticks) to develop.
    const isQuickPlay = playState.playKey?.includes('Quick') || playState.playKey?.includes('Screen');
    const MIN_DROPBACK_TICKS = isQuickPlay ? 34 : 47;
    // canThrowStandard is calculated below, after the pocket deadline is known.
    
    // NATURAL POCKET CLOCK:
    // Respects QB Awareness (internal rhythm), Decision Making, and Personality (Risk Tolerance).
    const clockAwareness = (qbProfile?.awareness ?? qbIQ) / 100; // 0.2 to 1.0
    const disciplineFactor = (qbProfile?.assignmentDiscipline ?? 50) / 100;
    const riskFactor = qbProfile?.riskTolerance ?? 1.0;

    // Experienced/aware QBs sense pocket expiration earlier; gunslingers hold longer seeking hero plays
    let maxDecisionTimeTicks = Math.round((85 + (qbAgility / 3) - (clockAwareness * 15)) * riskFactor);
    if (qbState.loggedRollout) maxDecisionTimeTicks += 35;

    // A clean pocket gives deeper concepts more time to develop.
    // 30 ticks = 0.72 seconds at 25 Hz.
    if (!isPressured) maxDecisionTimeTicks += 30;

    const pocketTimeExpired = playState.tick >= maxDecisionTimeTicks;
    const canThrowStandard =
        (
            playState.tick >= MIN_DROPBACK_TICKS ||
            isHotReadSituation ||
            pocketTimeExpired
        ) &&
        (
            qbState.hasCompletedDropback ||
            isPressured ||
            pocketTimeExpired
        );

    let decisionMade = false;
    let reason = "";

    if (imminentSackDefender) {
        decisionMade = true;
        reason = "Imminent Sack";
    } else if (isPressured && playState.tick >= 75) {
        // Poised QBs stay calm; flustered/low-decision QBs panic under sustained pressure.
        const panicOdds = Math.max(0.02, (1.1 - (qbDecision / 100)) * 0.15);
        if (Math.random() < panicOdds) {
            decisionMade = true;
            reason = "Pressure Panic";
        }
    }
    let targetPlayerState = null;
    let actionTaken = "None";
    let readDebugLog = [];

    if (!decisionMade && canThrowStandard) {
        let bestTargetEval = null;
        let highestScore = -Infinity;

        for (let i = 0; i < numReadsVisible; i++) {
            const slot = progression[i];
            const evalResult = getTargetValue(slot);

            if (evalResult) {
                readDebugLog.push(`${slot}:${evalResult.score.toFixed(0)}`);
                if (evalResult.score > highestScore) {
                    highestScore = evalResult.score;
                    bestTargetEval = evalResult;
                }
            } else {
                readDebugLog.push(`${slot}:X`);
            }
        }

        let THROW_THRESHOLD = 32;

        // Early downs: stay patient.
        if (down <= 2) {
            THROW_THRESHOLD += 5;
        }

        // Third/fourth down: accept more risk when the sticks demand it.
        if (down >= 3 && yardsToGo >= 6) {
            THROW_THRESHOLD -= 10;
        }

        // Trailing late: accept lower-probability opportunities.
        if (isDesperationTime) {
            THROW_THRESHOLD -= 8;
        }

        // Pressure forces quicker decisions.
        if (isPressured) {
            THROW_THRESHOLD -= 12;
        }

        // Hot read: get the ball out, but don't completely remove
        // the concept of a bad throw.
        if (isHotReadSituation) {
            THROW_THRESHOLD -= 8;
        }

        // Smarter QBs can recognize good opportunities slightly earlier.
        THROW_THRESHOLD -= ((qbDecision - 50) * 0.12);

        THROW_THRESHOLD = Math.max(2, Math.min(45, THROW_THRESHOLD));

        if (bestTargetEval && bestTargetEval.score > THROW_THRESHOLD) {
            targetPlayerState = bestTargetEval.info.state;
            actionTaken = isHotReadSituation ? "Hot Read Throw" : "Throw Value Target";
            decisionMade = true;

            if (debugEnabled) {
                logPlayDebug('QB_READ', `${qbState.name} selected target ${targetPlayerState.slot}`, {
                    action: actionTaken,
                    readProgress: `${numReadsVisible}/${progression.length}`,
                    evaluatedScores: readDebugLog,
                    selectedScore: Number(bestTargetEval.score.toFixed(1)),
                    throwThreshold: Number(THROW_THRESHOLD.toFixed(1)),
                    scoreMargin: Number((bestTargetEval.score - THROW_THRESHOLD).toFixed(1)),
                    isPressured,
                    pressureCount,
                    pressureDefender: pressureDefender ? {
                        name: pressureDefender.name,
                        distance: Number(getDistance(qbState, pressureDefender).toFixed(2))
                    } : null
                }, playState.tick);
            }

            if (gameLog) {
                const readProgress = `${numReadsVisible}/${progression.length}`;
                gameLog.push(`[Tick ${playState.tick}] 🧠 QB Reads (${readProgress}): [${readDebugLog.join(', ')}] -> Selected: ${targetPlayerState.slot}`);
            }
        } else if (debugEnabled && bestTargetEval) {
            // Log rejected targets when the visible reads change, then
            // at most once every 10 ticks while the QB continues holding.
            const previousHoldTick = qbState._lastLoggedHoldTick ?? -Infinity;
            
            const shouldLogHold =
                qbState._lastLoggedHoldReadCount !== numReadsVisible ||
                playState.tick - previousHoldTick >= 10;

            if (shouldLogHold) {
                logPlayDebug('QB_HOLD', `${qbState.name} continues scanning instead of throwing`, {
                    visibleReads: numReadsVisible,
                    totalReads: progression.length,
                    evaluatedScores: readDebugLog,
                    bestTarget: bestTargetEval.info.state.slot,
                    bestScore: Number(bestTargetEval.score.toFixed(1)),
                    throwThreshold: Number(THROW_THRESHOLD.toFixed(1)),
                    scoreMargin: Number((bestTargetEval.score - THROW_THRESHOLD).toFixed(1)),
                    isPressured,
                    pressureCount,
                    pressureDefender: pressureDefender ? {
                        name: pressureDefender.name,
                        distance: Number(getDistance(qbState, pressureDefender).toFixed(2))
                    } : null,
                    hasCompletedDropback: Boolean(qbState.hasCompletedDropback)
                }, playState.tick);

                qbState._lastLoggedHoldReadCount = numReadsVisible;
                qbState._lastLoggedHoldTick = playState.tick;
            }
        }

        // Give the QB one final target evaluation at the pocket deadline.
        // Only force an emergency resolution if no throw was selected.
        if (!decisionMade && pocketTimeExpired) {
            decisionMade = true;
            reason = "Time Expired";
        }

        // NATURAL SCRAMBLE EVALUATION:
        // Driven by athleticism (Agility/Speed), personality (Risk Tolerance/Ego), and progression state.
        const openLane = !defenseStates.some(d => !d.isBlocked && !d.isEngaged && Math.abs(d.x - qbState.x) < 3.5 && d.y < qbState.y + 1);
        const allReadsExhausted = numReadsVisible >= progression.length && (!bestTargetEval || bestTargetEval.score < THROW_THRESHOLD);

        // A mobile QB doesn't wait for arbitrary Tick 80 if all receivers are blanketed or pressure is closing
        if (!decisionMade && openLane && (isPressured || allReadsExhausted || playState.tick > 70)) {
            const qbSpeed = qbAttrs.physical?.speed || 50;
            const mobilityDesire = ((qbAgility * 0.5) + (qbSpeed * 0.5)) / 100; // 0.2 to 0.95
            const personalityUrgency = qbProfile?.riskTolerance ?? 1.0;

            // Math Fix: Drastically reduce base chance so it scales correctly across 25 simulation ticks per second
            let scrambleChance = mobilityDesire * 0.006 * personalityUrgency;
            if (allReadsExhausted) scrambleChance *= 2.5;
            if (isPressured) scrambleChance *= 2.0;

            if (Math.random() < scrambleChance) {
                qbState.action = 'run_path';
                qbState.isBallCarrier = true;
                playState.qbIntent = 'scramble';
                if (gameLog && !qbState.hasLoggedScramble) {
                    gameLog.push(`🏃 ${qbState.name} tucks it and runs upfield!`);
                    qbState.hasLoggedScramble = true;
                }
                return;
            }
        }

        if (!decisionMade && playState.tick > 115) {
            const desperation = progression
                .map(s => getTargetValue(s))
                .filter(v => v !== null)
                .sort((a, b) => b.score - a.score)[0];

            if (desperation && desperation.score > -20) {
                targetPlayerState = desperation.info.state;
                actionTaken = "Desperation Throw";
                decisionMade = true;
            } else {
                qbState.action = 'run_path'; // BREAK OUT OF QB_SCRAMBLE LOCK
                playState.qbIntent = 'scramble';
                qbState.isBallCarrier = true;
                if (gameLog && !qbState.hasLoggedPanic) {
                    gameLog.push(`🏃 ${qbState.name} can't find anyone and takes off!`);
                    qbState.hasLoggedPanic = true;
                }
                return;
            }
        }
    }

    if (decisionMade && !targetPlayerState) {
        if (gameLog && readDebugLog.length > 0 && actionTaken !== "Hot Read Throw") {
            gameLog.push(`[Tick ${playState.tick}] 🧠 QB Reads: [${readDebugLog.join(', ')}] -> Result: NO OPEN TARGETS`);
        }

        // EMERGENT QB RESOLUTION:
        // The QB's skills and personality determine whether they throw away, force a throw, scramble, or take a sack.
        const decisionQuality = qbProfile?.decisionQuality ?? qbDecision;
        const riskTolerance = qbProfile?.riskTolerance ?? 1.0;

        // 1. High-IQ / High-Discipline QBs throw it away to live for the next down
        const throwAwaySkill = (decisionQuality * 0.7) + (qbIQ * 0.3);
        const willThrowAway = (throwAwaySkill > 55) && (Math.random() < (throwAwaySkill / 100) / riskTolerance);

        // 2. High-Risk / High-Ego QBs try to force a contested pass into coverage instead of throwing it away
        const bestAvailableOption = progression
            .map(s => getTargetValue(s))
            .filter(v => v !== null)
            .sort((a, b) => b.score - a.score)[0];

        if (bestAvailableOption && riskTolerance > 1.04 && Math.random() < 0.40) {
            targetPlayerState = bestAvailableOption.info.state;
            actionTaken = "Forced Throw";
            decisionMade = true;
        } else if (willThrowAway) {
            actionTaken = "Throw Away";
        } else if (qbAgility > 65 && Math.random() < 0.50) {
            // Athletic QBs try a last-ditch scramble out of the pocket
            qbState.action = 'qb_scramble';
            qbState.isBallCarrier = true;
            return;
        } else {
            // Low-IQ, indecisive, or trapped QBs hesitate and take the sack
            if (reason === "Imminent Sack" || isPressured) {
                return; // Takes the sack naturally
            } else {
                actionTaken = "Throw Away";
            }
        }
    }

    if (actionTaken === "Throw Away") {
        if (gameLog) gameLog.push(`👋 ${qbState.name} throws it away.`);
        playState.ballState.inAir = true;
        playState.ballState.throwInitiated = true;
        playState.ballState.throwerId = qbState.id;
        playState.ballState.isThrowAway = true;

        const distToLeftSideline = qbState.x;
        const distToRightSideline = FIELD_WIDTH - qbState.x;
        const throwToLeft = distToLeftSideline < distToRightSideline;

        const targetX = throwToLeft ? -5 : FIELD_WIDTH + 5;
        const targetY = qbState.y + 10;

        playState.ballState.targetX = targetX;
        playState.ballState.targetY = targetY;

        const dx = targetX - qbState.x;
        const dy = targetY - qbState.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ballSpeed = 25;
        const t = Math.max(0.1, dist / ballSpeed);

        playState.ballState.vx = dx / t;
        playState.ballState.vy = dy / t;
        playState.ballState.vz = (-0.3 + (4.9 * t * t)) / t;

        playState.ballState.throwTick = playState.tick;
        qbState.hasBall = false;
        
        playState.statEvents.push({ type: 'pass_attempt', qbId: qbState.id });
        return;
    }

    if (targetPlayerState && actionTaken.includes("Throw")) {
        let adjustedAccuracy = Number(qbAcc) || 50;
        let pPenalty = 0;

        // Hook up Clutch: Boosts or hurts late-game / 4th-quarter crunch time
        const qbClutch = qbAttrs.mental?.clutch ?? 50;
        if (isDesperationTime || (playState.down >= 3 && playState.yardsToGo >= 6)) {
            const clutchDelta = (qbClutch - 50) * 0.25; // -7.5 to +12.5% accuracy under crunch
            adjustedAccuracy += clutchDelta;
        }

        if (isPressured) {
            const pCount = Number(pressureCount) || 0;
            const qbIQNum = Number(qbState.playbookIQ || qbState.iq || 50);

            const basePenalty = 15;
            const IQ_MITIGATION = (qbIQNum / 100) * 0.5;
            pPenalty = basePenalty + (pCount * 5) - (basePenalty * IQ_MITIGATION);

            // High clutch QBs stay cooler under heavy rush
            if (qbClutch > 70) pPenalty *= 0.75;

            adjustedAccuracy = Math.max(30, adjustedAccuracy - pPenalty);
        }

        executeThrow(qbState, targetPlayerState, qbPower, adjustedAccuracy, playState, gameLog, actionTaken);
    }

    if (isDesperationTime && !decisionMade && !targetPlayerState && playState.tick >= 35) {
        const deepReceiver = offenseStates
            .filter(o => o.slot !== 'QB1' && !o.slot.startsWith('OL') && (o.action.includes('route') || o.action === 'route_complete'))
            .sort((a, b) => b.y - a.y)[0];

        if (deepReceiver && deepReceiver.y > playState.lineOfScrimmage + 10 && Math.random() > 0.4) {
            if (gameLog) gameLog.push(`🚨 ${qbState.name} heaves it downfield in desperation!`);
            executeThrow(qbState, deepReceiver, qbPower, qbAcc * 0.4, playState, gameLog, "Desperation Throw");
            return;
        }
    }
}

export function executeThrow(qbState, target, throwPower, accuracy, playState, gameLog, actionType) {
    const hasQBCrossedLine = qbState.y > (playState.lineOfScrimmage + 0.5);
    const isForwardPass = target.y > qbState.y + 0.25;

    if (hasQBCrossedLine && isForwardPass) {
        if (gameLog) gameLog.push(`🚫 ILLEGAL FORWARD PASS: ${qbState.name} crossed the line!`);
        playState.ballState.inAir = false;
        playState.ballState.throwInitiated = false;
        qbState.hasBall = true;
        return;
    }

    const startX = qbState.x;
    const startY = qbState.y;
    const throwDistance = Math.hypot(target.x - startX, target.y - startY);

    let passType = 'touch';
    const assignment = target.assignment || '';

    if (throwDistance < 12 || ['Slant', 'Drag', 'Curl', 'Hitch', 'Quick'].some(r => assignment.includes(r))) {
        passType = 'bullet';
    } else if (throwDistance > 25 || ['Fly', 'Go', 'Streak', 'Post'].some(r => assignment.includes(r))) {
        passType = 'lob';
    }

    // Real arm velocity calculation based on throwPower
    const maxArmVelocity = 16 + (throwPower / 100) * 14.0;
    let ballSpeed = maxArmVelocity;
    if (passType === 'lob') ballSpeed *= 0.84; // Faster lobs prevent waiting
    else if (passType === 'touch') ballSpeed *= 0.92;

    let aimX = target.x;
    let aimY = target.y;

    // Only lead receivers who are actively moving; throw directly to stationary/settled targets
    const isMovingTarget = target.action === 'run_route' || 
                           target.isBallCarrier || 
                           (target.action === 'route_complete' && Math.hypot(target.vx || 0, target.vy || 0) > 0.8);

    if (isMovingTarget) {
        const recYPS = getPlayerBaseSpeedYPS(target) * (target.fatigueModifier || 1.0);

        // Corrected Flight Time: Account for downfield receiver velocity relative to ball speed
        const recVy = target.vy || 0;
        const effectiveBallSpeed = Math.max(8.0, ballSpeed - (recVy * 0.65));
        const flightTime = throwDistance / effectiveBallSpeed;

        const qbIQ = qbState.playbookIQ || 50;
        const qbCons = qbState.consistency || 50;

        const maxError = (100 - qbIQ) / 650;
        const errorRoll = (Math.random() - 0.5) * 2;
        const consistencyRoll = (Math.random() * (100 - qbCons)) / 100;
        let qbEstimation = 1.0 + (errorRoll * maxError) + (errorRoll * consistencyRoll * 0.1);

        if (passType === 'bullet') qbEstimation *= 0.96; // Softer modifier
        if (passType === 'lob') qbEstimation *= 1.04;

        let distanceToTravel = recYPS * flightTime * qbEstimation;
        let projectedWithinRoute = false;

        let currX = target.x;
        let currY = target.y;
        let lastValidDirX = 0;
        let lastValidDirY = 1;

        if (target.routePath && target.currentPathIndex < target.routePath.length) {
            for (let i = target.currentPathIndex; i < target.routePath.length; i++) {
                const nextNode = target.routePath[i];
                const dx = nextNode.x - currX;
                const dy = nextNode.y - currY;
                const distToNext = Math.hypot(dx, dy);

                if (distToNext > 0.1) {
                    lastValidDirX = dx / distToNext;
                    lastValidDirY = dy / distToNext;
                }

                if (distanceToTravel > distToNext) {
                    distanceToTravel -= distToNext;
                    currX = nextNode.x;
                    currY = nextNode.y;
                } else {
                    const ratio = distanceToTravel / distToNext;
                    aimX = currX + dx * ratio;
                    aimY = currY + dy * ratio;
                    distanceToTravel = 0;
                    projectedWithinRoute = true;
                    break;
                }
            }
        }

        // DEEPER FIX: If the receiver has completed their route path, DO NOT project them 
        // sprinting into the bleachers! Only vertical streaks continue running;
        // all breaking/settling routes settle at the final waypoint.
        const isContinuousRoute = ['Fly', 'Go', 'Streak', 'Vert', 'Fade'].some(r => target.assignment?.includes(r));
        if (distanceToTravel > 0 && isContinuousRoute) {
            const dirX = (target.vx && Math.abs(target.vx) > 0.5) ? target.vx / recYPS : lastValidDirX;
            const dirY = (target.vy && Math.abs(target.vy) > 0.5) ? target.vy / recYPS : lastValidDirY;

            aimX = currX + (dirX * distanceToTravel);
            aimY = currY + (dirY * distanceToTravel);
        } else if (!projectedWithinRoute) {
            // If projection exhausted the route, settle at its final node.
            // Otherwise, preserve the interpolated point within the segment.
            aimX = currX;
            aimY = currY;
        }
    } else {
        aimX = target.x;
        aimY = target.y;
    }
    // DEEPER FIX: Scale error margin realistically to match receiver catch radii (1.2 - 1.5 yards).
    // Dividing by 12 produced wild 6-yard misses that receivers couldn't even contest.
    const distancePower = 1.2 - (accuracy / 120);
    const distanceFactor = Math.pow(Math.max(0.5, throwDistance / 20), distancePower);
    let errorMargin = ((100 - accuracy) / 30) * distanceFactor;

    if (playState.isPressured) errorMargin *= (1.5 - ((qbState.iq || 50) / 200));

    const dirX = aimX - startX;
    const dirY = aimY - startY;
    const mag = Math.max(0.1, Math.hypot(dirX, dirY));
    const uX = dirX / mag;
    const uY = dirY / mag;

    const longBias = (Math.random() > 0.4) ? 1.1 : -0.7;
    const longError = (Math.random() * errorMargin) * longBias;
    const latError = (Math.random() - 0.5) * errorMargin * 0.9;

    aimX += (uX * longError) + (-uY * latError);
    aimY += (uY * longError) + (uX * latError);

    // Keep standard pass attempts inside the boundary lines (only intentional throw-aways leave the field)
    if (!playState.ballState.isThrowAway) {
        aimX = Math.max(1.0, Math.min(FIELD_WIDTH - 1.0, aimX));
        aimY = Math.max(1.0, Math.min(118.5, aimY));
    } else {
        aimX = Math.max(-5, Math.min(FIELD_WIDTH + 5, aimX));
        aimY = Math.max(0.5, Math.min(FIELD_LENGTH - 0.5, aimY));
    }

    const finalDist = Math.hypot(aimX - startX, aimY - startY);
    const t = Math.max(0.1, finalDist / ballSpeed);

    const targetZ = 1.0;
    const startZ = 2.2;
    const deltaZ = targetZ - startZ;
    const vz = (deltaZ + (4.9 * t * t)) / t;

    playState.ballState = {
        x: startX, y: startY, z: startZ, inAir: true, isLoose: false, throwTick: playState.tick, releaseTick: playState.tick,
        vx: (aimX - startX) / t, vy: (aimY - startY) / t, vz: vz,
        targetX: aimX, targetY: aimY, targetPlayerId: target.id, throwerId: qbState.id, isThrowAway: false
    };

    qbState.hasBall = false;
    qbState.isBallCarrier = false;
    qbState.action = 'idle';

    playState.statEvents.push({ type: 'pass_attempt', qbId: qbState.id });
    playState.statEvents.push({ type: 'target', receiverId: target.id });

    if (isDebugMode()) {
        logPlayDebug('QB_THROW', `${qbState.name} threw to ${target.name} (${target.slot})`, {
            passType,
            airDistance: Number(finalDist.toFixed(1)),
            accuracyApplied: Math.round(accuracy),
            flightTimeSec: Number(t.toFixed(2))
        });
    }

    if (gameLog) {
        const passTypeStr = passType.charAt(0).toUpperCase() + passType.slice(1);
        gameLog.push(`[Tick ${playState.tick}] 🏈 ${qbState.name} throws a ${passTypeStr} to ${target.name} | Air Dist: ${finalDist.toFixed(1)}y`);
    }
}

export function updateThrowoffDecision(playState, offenseStates, gameLog) {
    const qb = offenseStates.find(p => p.slot === 'QB1');
    if (!qb || !qb.hasBall) return;

    // Simulate a deep 7-step dropback to heave the ball
    if (playState.tick < 35) {
        qb.targetX = qb.initialX;
        qb.targetY = playState.lineOfScrimmage - 7.0;
        qb.action = 'qb_setup';
        playState.ballState.x = qb.x;
        playState.ballState.y = qb.y;
        playState.ballState.z = 1.8;
        return;
    }

    // Throwoff uses arm power with fallback to physical strength
    const armPower = qb.throwPower || qb.thp || qb.attributes?.technical?.throwPower || qb.strength || 50;
    const throwAcc = qb.throwingAccuracy || qb.attributes?.technical?.throwingAccuracy || 50;

    const isLeftHash = qb.x < 26.6;
    const targetX = isLeftHash ? 42.0 : 11.0;

    // Deep backyard heave scales with throwPower
    const baseDistance = 25 + ((armPower / 100) * 35);
    const varianceY = (Math.random() - 0.5) * 8;
    let puntDistance = Math.max(20, baseDistance + varianceY);

    if (playState.lineOfScrimmage + puntDistance > 115) {
        puntDistance = Math.max(15, 112 - playState.lineOfScrimmage);
    }

    const targetY = playState.lineOfScrimmage + puntDistance;
    const errorX = (Math.random() - 0.5) * ((100 - throwAcc) / 100) * 15;
    const errorY = (Math.random() - 0.5) * 8;

    const finalTargetX = Math.max(2, Math.min(51, targetX + errorX));
    const finalTargetY = Math.min(118, targetY + errorY);

    const hangTime = 3.5 + (armPower / 75);

    playState.ballState.vx = (finalTargetX - qb.x) / hangTime;
    playState.ballState.vy = (finalTargetY - qb.y) / hangTime;
    playState.ballState.vz = 4.9 * hangTime;

    playState.ballState.inAir = true;
    playState.ballState.throwerId = qb.id;
    playState.ballState.x = qb.x;
    playState.ballState.y = qb.y;
    playState.ballState.z = 2.2;

    playState.ballState.targetX = finalTargetX;
    playState.ballState.targetY = finalTargetY;
    playState.ballState.throwTick = playState.tick;

    qb.hasBall = false;
    qb.isBallCarrier = false;
    qb.action = 'idle';

    if (gameLog) gameLog.push(`[Tick ${playState.tick}] 🏈 ${qb.name} heaves a deep throwoff downfield! (${Math.round(puntDistance)} yards)`);
}
