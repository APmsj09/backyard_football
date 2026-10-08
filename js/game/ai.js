import { getDistance } from './physics.js';
import { getPlayer } from './state.js';
import { pushGameLog } from './collisions.js';
import { logPlayDebug } from './telemetry.js';

const FIELD_WIDTH = 53.3;
const FIELD_LENGTH = 120;
const CENTER_X = FIELD_WIDTH / 2;
const HASH_LEFT_X = 18.0;
const HASH_RIGHT_X = 35.3;

export function diagnosePlay(pState, tick, offenseStates, truePlayType, offensivePlayKey) {
    const iq = pState.playbookIQ || 50;

    let runScore = 0; let passScore = 0;
    let leftScore = 10; let rightScore = 10; let centerScore = 15;

    const qb = offenseStates.find(p => p.slot.startsWith('QB'));
    const rbs = offenseStates.filter(p => p.slot.startsWith('RB'));
    const ol = offenseStates.filter(p => p.slot.startsWith('OL'));

    if (qb) {
        if (qb.action === 'qb_setup' && qb.hasCompletedDropback) passScore += 45;
        else if (qb.action === 'qb_setup' && !qb.hasCompletedDropback) passScore += 15;
        else if (qb.action === 'handoff_setup') runScore += 40;

        if (qb.vx > 1.5) rightScore += 30;
        else if (qb.vx < -1.5) leftScore += 30;
    }

    let passBlocks = 0; let runBlocks = 0;
    ol.forEach(lineman => {
        if (lineman.action === 'pass_block') passBlocks++;
        else if (lineman.action === 'run_block') runBlocks++;

        if (lineman.assignment && lineman.assignment.includes('pull_right')) {
            runScore += 40; rightScore += 70;
        }
        if (lineman.assignment && lineman.assignment.includes('pull_left')) {
            runScore += 40; leftScore += 70;
        }
    });

    if (passBlocks > runBlocks) passScore += (passBlocks * 12);
    if (runBlocks > passBlocks) runScore += (runBlocks * 10);

    rbs.forEach(rb => {
        if (rb.isBallCarrier) runScore += 60;
        else if (rb.action === 'run_path' && rb.y > (qb?.y || 0)) runScore += 20;
        else if (rb.action === 'pass_block') passScore += 15;

        if (rb.vx > 2.0) rightScore += 40;
        else if (rb.vx < -2.0) leftScore += 40;
        else if (rb.vy > 1.5) centerScore += 30;
    });

    const isPlayAction = offensivePlayKey.includes('PA_');
    if (isPlayAction && tick < 25) {
        runScore += 50;
        if (offensivePlayKey.includes('Bootleg_Right')) leftScore += 40;
        if (offensivePlayKey.includes('Bootleg_Left')) rightScore += 40;
    }

    const timeFactor = Math.min(1.0, tick / 35);
    const iqFactor = iq / 100;
    const noiseMax = 30 * (1.0 - iqFactor);
    const applyNoise = (score) => score * timeFactor * (0.5 + (iqFactor / 2)) + ((Math.random() * noiseMax) - (noiseMax / 2));

    const finalRunScore = applyNoise(runScore) + (pState.role === 'LB' ? 15 : 0);
    const finalPassScore = applyNoise(passScore) + (pState.role === 'DB' ? 15 : 0);
    const finalLeft = applyNoise(leftScore);
    const finalRight = applyNoise(rightScore);
    const finalCenter = applyNoise(centerScore);

    let guess = 'read';
    let confidence = Math.max(0, Math.min(1.0, Math.abs(finalRunScore - finalPassScore) / 60));
    const commitThreshold = 0.60 - (iqFactor * 0.3);

    if (confidence > commitThreshold || tick > 40) {
        guess = finalRunScore > finalPassScore ? 'run' : 'pass';
        if (tick > 50 && truePlayType === 'pass') { guess = 'pass'; confidence = 1.0; }
    }

    let direction = 'center';
    let dirConfidence = 0;
    const totalDirScore = Math.max(1, finalLeft + finalRight + finalCenter);

    if (finalRight > finalLeft && finalRight > finalCenter) {
        direction = 'right';
        dirConfidence = finalRight / totalDirScore;
    } else if (finalLeft > finalRight && finalLeft > finalCenter) {
        direction = 'left';
        dirConfidence = finalLeft / totalDirScore;
    } else {
        direction = 'center';
        dirConfidence = finalCenter / totalDirScore;
    }

    // Only log telemetry when the defender's diagnosis changes to prevent flooding
    if (pState._lastLoggedGuess !== guess && guess !== 'read') {
        logPlayDebug('DEF_READ', `${pState.name} (${pState.role}) committed to [${guess.toUpperCase()}]`, {
            confidence: Number(confidence.toFixed(2)),
            direction,
            dirConfidence: Number(dirConfidence.toFixed(2))
        });
        pState._lastLoggedGuess = guess;
    }

    return { guess, confidence, direction, dirConfidence };
}

export function calculateSafetyHelp(safetyState, defenseStates, offenseStates, ballCarrierState, playState, isBallInAir) {
    if (!safetyState || safetyState.role !== 'DB') return null;

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

            let pressureScore = 10 - separationDist;
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

    const ballFlightTime = isBallInAir ? playState.tick - playState.ballState.releaseeTick : 0;
    const MIN_FLIGHT_TICKS = 5;

    if (isBallInAir && ballFlightTime < MIN_FLIGHT_TICKS) return null;
    if (isBallInAir && maxPressure < 6.0 && ballFlightTime < MIN_FLIGHT_TICKS + 3) return null;

    if (helpTarget && helpTarget.receiver) {
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
    const iq = runner.playbookIQ || 50;
    const agility = runner.agility || 50;
    const strength = runner.strength || 50;

    const currentVx = runner.vx || 0;
    const currentVy = runner.vy || 0;
    const currentSpeed = Math.hypot(currentVx, currentVy);

    let maxLateral = 8.0 + (agility / 50);
    if (currentSpeed > 4.5) maxLateral = 5.0;
    if (currentSpeed > 7.0) maxLateral = 2.5;

    const nearbyDefenders = defenseStates.filter(d =>
        !d.isBlocked && d.stunnedTicks === 0 && getDistance(runner, d) < 4.0 && d.y > runner.y - 1
    );
    const inTraffic = nearbyDefenders.length >= 2;

    if (inTraffic) maxLateral = Math.min(maxLateral, 2.5);

    const laneOffsets = [0];
    [1.5, 3.0, 5.0, 8.0, 10.0].forEach(off => {
        if (off <= maxLateral) {
            laneOffsets.push(off);
            laneOffsets.push(-off);
        }
    });

    if (Math.abs(currentVx) > 1.0 && Math.abs(currentVx) <= maxLateral) {
        laneOffsets.push(currentVx);
    }

    const visionDepth = 3.5 + (iq / 25);
    let bestScore = -Infinity;
    let bestTargetX = runner.x;
    let bestTargetY = runner.y + visionDepth;

    laneOffsets.forEach((offset) => {
        const testX = runner.x + offset;
        const testY = runner.y + visionDepth;

        if (testX < 1 || testX > fieldWidth - 1) return;

        let score = 100;
        const lateralShift = Math.abs(offset);
        const agilityMitigation = Math.max(0.3, (120 - agility) / 80);
        const momentumConflict = Math.abs(offset - (currentVx * 0.6));
        score -= (momentumConflict * 4.0 * agilityMitigation);

        if (inTraffic) score -= (lateralShift * 12.0);

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
        let overPursuitDetected = false;

        // Cutback detection: Check for lead blockers sealing defenders
        offenseStates.forEach(blocker => {
            if (blocker.id !== runner.id && (blocker.action?.includes('block') || blocker.action === 'run_path')) {
                const distToBlocker = Math.hypot(testX - blocker.x, testY - blocker.y);
                // Follow behind blocker's hip
                if (distToBlocker < 2.5 && blocker.y > runner.y) {
                    score += 45;
                }
            }
        });

        defenseStates.forEach(def => {
            if (def.stunnedTicks > 0 || def.y < runner.y - 1.0) return;

            const defPredX = def.x + ((def.vx || 0) * 0.3);
            const defPredY = def.y + ((def.vy || 0) * 0.3);
            const distToPredicted = Math.hypot(testX - defPredX, testY - defPredY);

            if (!def.isBlocked && !def.isEngaged) {
                if (distToPredicted < 4.5) {
                    laneThreat += (350 / (distToPredicted + 0.4));

                    const defLateralSpeed = def.vx || 0;
                    if (Math.abs(defLateralSpeed) > 2.5) {
                        const defGoingRight = defLateralSpeed > 0;
                        const laneGoingLeft = offset < 0;
                        if ((defGoingRight && laneGoingLeft) || (!defGoingRight && !laneGoingLeft)) {
                            overPursuitDetected = true; // Cutback lane discovered!
                        }
                    }
                }
            } else {
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

        score -= laneThreat;
        if (iq > 70 && overPursuitDetected) score += 80;

        if (score > bestScore) {
            bestScore = score;
            bestTargetX = testX;
            bestTargetY = testY;
        }
    });

    const immediateThreat = nearbyDefenders.sort((a, b) => getDistance(runner, a) - getDistance(runner, b))[0];

    if (immediateThreat && getDistance(runner, immediateThreat) < 2.5) {
        const strengthAdvantage = strength - (immediateThreat.strength || 50);

        if (strengthAdvantage > 10 && inTraffic && bestScore < 50) {
            runner.action = 'trucking';
            bestTargetX = immediateThreat.x + (immediateThreat.x > runner.x ? -0.4 : 0.4);
            bestTargetY = immediateThreat.y + 1.5;
            runner.contactReduction = 0.9;
        } else {
            let dodgeDir = runner.x < immediateThreat.x ? -1 : 1;
            if ((immediateThreat.vx || 0) < -2.0) dodgeDir = 1;
            else if ((immediateThreat.vx || 0) > 2.0) dodgeDir = -1;

            if (runner.x < 4) dodgeDir = 1;
            if (runner.x > fieldWidth - 4) dodgeDir = -1;

            const dodgeWidth = 1.2 + (agility / 40);
            bestTargetX = (bestTargetX * 0.3) + ((runner.x + (dodgeDir * dodgeWidth)) * 0.7);
            bestTargetY = Math.min(bestTargetY, runner.y + 1.5);
        }
    }

    bestTargetX = Math.max(1.0, Math.min(fieldWidth - 1.0, bestTargetX));

    if (inTraffic || Math.abs(bestTargetX - runner.x) > 1.5) {
        logPlayDebug('CARRIER_VISION', `${runner.name} evaluated lanes`, {
            offset: Number((bestTargetX - runner.x).toFixed(1)),
            bestScore: Math.round(bestScore),
            inTraffic,
            action: runner.action
        });
    }

    return { x: bestTargetX, y: bestTargetY };
}

export function updateQBDecision(qbState, offenseStates, defenseStates, playState, offensiveAssignments, gameLog) {
    if (!qbState || !qbState.hasBall || playState.ballState.inAir || playState.ballState.throwInitiated) return;
    if (qbState.isEngaged || qbState.stunnedTicks > 0) return;
    if (qbState.action === 'sacked') return;

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
        technical: { throwingAccuracy: 50 }
    };

    const qbIQ = Math.max(20, Math.min(99, qbAttrs.mental?.playbookIQ ?? 50));
    const qbDecision = Math.max(20, Math.min(99, qbAttrs.mental?.decisionMaking ?? 50));
    const qbAgility = qbAttrs.physical?.agility || 50;
    const qbStrength = qbAttrs.physical?.strength || 50;
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
    // A high-IQ QB will actively look at the opposite side of the field for the first 1.5 seconds
    if (qbIQ > 75 && playState.tick < 30 && progression.length > 1) {
        const trueTarget = offenseStates.find(o => o.slot === progression[0]);
        if (trueTarget && trueTarget.initialX !== undefined) {
            // Find a decoy receiver on the opposite side of the center hash
            const decoy = offenseStates.find(o =>
                o.slot !== 'QB1' &&
                o.slot !== trueTarget.slot &&
                o.initialX !== undefined &&
                Math.sign(o.initialX - 26.6) !== Math.sign(trueTarget.initialX - 26.6)
            );
            if (decoy) {
                qbState.currentReadTargetSlot = decoy.slot; // Spoof the defense!
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
        // Normal progression tracking
        const readIndex = Math.min(progression.length - 1, Math.floor(qbState.ticksInPocket / (Math.max(8, (110 - qbIQ) / 3))));
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

    const unblocked = defenseStates.filter(d => !d.isBlocked && !d.isEngaged && d.stunnedTicks === 0 && getDistance(qbState, d) < 4.5);
    const pressureDefender = unblocked.length > 0 ? unblocked[0] : null;
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

        const distFromQB = getDistance(qbState, rec);
        let estimatedBallSpeed = 22;

        if (distFromQB > 25) estimatedBallSpeed = 16 + (qbStrength / 100) * 14.0;
        else if (distFromQB < 12) estimatedBallSpeed = 16 + (qbStrength / 100) * 14.0;

        const estimatedFlightTime = distFromQB / estimatedBallSpeed;
        const projRecX = rec.x + (rec.vx || 0) * estimatedFlightTime;
        const projRecY = rec.y + (rec.vy || 0) * estimatedFlightTime;

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

            if (projDist < 4.0) defendersClosingIn++;

            const distDefToQB = Math.hypot(projDefX - qbState.x, projDefY - qbState.y);
            if (distDefToQB < distFromQB - 1.5) {
                const dx = projRecX - qbState.x;
                const dy = projRecY - qbState.y;
                const defDx = projDefX - qbState.x;
                const defDy = projDefY - qbState.y;

                const dot = (dx * defDx + dy * defDy) / (distFromQB * distDefToQB);
                if (dot > 0.95) {
                    undercutThreat += (4.0 - (distDefToQB / distFromQB) * 4.0);
                }
            }
        });

        const depth = rec.y - playState.lineOfScrimmage;

        let score = Math.min(minProjectedSeparation, 6) * 10;

        if (rec.assignment === 'Screen_Wait') {
            if (playState.tick < 45) return { score: -100, info: { state: rec, separation: minProjectedSeparation } };
            score += 80;

            if (minProjectedSeparation < 1.0) {
                score -= 150;
            }
        }

        const yardsToGo = playState.yardsToGo ?? 10;
        const down = playState.down ?? 1;
        const targetDepth = depth;
        const distanceBeyondLOS = targetDepth;
        const targetAtOrBeyondFirstDown = distanceBeyondLOS >= yardsToGo;

        // ======================================================
        // SITUATIONAL VALUE
        // ======================================================

        // Throwing beyond the sticks is valuable, but not mandatory.
        if (targetAtOrBeyondFirstDown) {
            score += 18;
        } else {
            // Short targets are perfectly reasonable on early downs,
            // but become less attractive when a first down is required.
            const yardsShort = yardsToGo - Math.max(0, distanceBeyondLOS);

            if (down >= 3 && yardsShort > 3) {
                score -= Math.min(24, yardsShort * 3);
            } else if (down <= 2) {
                score -= Math.min(8, yardsShort * 1.5);
            }
        }

        // Short throws are naturally more attractive when pressure is coming.
        if (isPressured && targetDepth >= 0 && targetDepth <= 8) {
            score += 30;
        }

        // Under heavy pressure, don't wait for a perfect deep window.
        if (isPressured && targetDepth > 14) {
            score -= 18;
        }

        // ======================================================
        // COVERAGE / SEPARATION QUALITY
        // ======================================================

        // Separation matters, but returns diminish quickly.
        // Being 8 yards open isn't four times better than being 2 yards open.
        if (minProjectedSeparation >= 2.0) {
            score += Math.min(18, (minProjectedSeparation - 2.0) * 6);
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
            // Deep balls require both physical ability and a meaningful window.
            if (qbStrength < 60) {
                score -= (60 - qbStrength) * 2.0;
            }

            if (minProjectedSeparation >= 3.0) {
                score += 12 + (qbIQ * 0.05);
            } else {
                // Good QBs can still attempt difficult throws,
                // but poor QBs should usually move on.
                score -= Math.max(10, (60 - qbDecision) * 0.6);
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

        const riskTolerance = 0.65 + (qbDecision / 100) * 0.35;

        // Good decision makers get more value from genuinely good windows.
        // They do NOT get a bonus simply because a receiver is highly rated.
        score *= riskTolerance;

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
            qbState.action = 'run_path';
            qbState.isBallCarrier = true;
            playState.qbIntent = 'scramble';

            if (gameLog) {
                const reason = wouldGainFirstDown ? "sees a lane for the first down" : "takes off into open green grass";
                pushGameLog(gameLog, `[Tick ${playState.tick}] 🏃 ${qbState.name} (IQ:${qbIQ}) ${reason} and tucks it!`, playState);
            }
            return;
        }

        if (bestTarget && bestPassScore > 15) {
            const onTheRunMod = (qbAgility / 100) * 0.85;
            if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] 🏃‍♂️🎯 ${qbState.name} keeps his eyes downfield and throws on the run!`, playState);
            executeThrow(qbState, bestTarget, qbStrength, qbAcc * onTheRunMod, playState, gameLog, "Throw on Run");
            return;
        }

        const immediateThreat = defenseStates.find(d => !d.isBlocked && !d.isEngaged && getDistance(qbState, d) < 2.5);
        if (immediateThreat && qbIQ > 60) {
            if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] 👋 ${qbState.name} throws it away under pressure.`, playState);
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
            return;
        }
        return;
    }

    let scanSpeedBase = Math.max(6, (110 - qbProcessing) / 3.5);

    // Pressure creates urgency.
    // Good decision makers process that urgency better.
    // Poor decision makers do not magically scan faster.
    if (isPressured) {
        const pressureProcessingMod = 1.05 - (qbDecision / 220);
        scanSpeedBase *= Math.max(0.60, pressureProcessingMod);
    }

    if (typeof qbState.ticksInPocket === 'undefined') qbState.ticksInPocket = 0;
    qbState.ticksInPocket++;

    const numReadsVisible = Math.min(progression.length, 1 + Math.floor(qbState.ticksInPocket / scanSpeedBase));

    // Lowered minimum dropback ticks to 28 so QBs can deliver quick slants/screens before getting sacked
    const MIN_DROPBACK_TICKS = 28;
    const canThrowStandard = (playState.tick >= MIN_DROPBACK_TICKS || isHotReadSituation) && (qbState.hasCompletedDropback || isPressured);

    let maxDecisionTimeTicks = 110 + (qbIQ / 3) + (qbAgility / 3);
    if (qbState.loggedRollout) maxDecisionTimeTicks += 35;

    let decisionMade = false;
    let reason = "";

    if (imminentSackDefender) { decisionMade = true; reason = "Imminent Sack"; }
    else if (playState.tick >= maxDecisionTimeTicks) { decisionMade = true; reason = "Time Expired"; }
    else if (isPressured && playState.tick >= 90 && Math.random() < Math.max(0.01, 0.2 - qbIQ / 200)) {
        decisionMade = true;
        reason = "Pressure Panic";
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

            logPlayDebug('QB_READ', `${qbState.name} selected target ${targetPlayerState.slot}`, {
                action: actionTaken,
                readProgress: `${numReadsVisible}/${progression.length}`,
                evaluatedScores: readDebugLog,
                isPressured
            });

            if (gameLog) {
                const readProgress = `${numReadsVisible}/${progression.length}`;
                gameLog.push(`[Tick ${playState.tick}] 🧠 QB Reads (${readProgress}): [${readDebugLog.join(', ')}] -> Selected: ${targetPlayerState.slot}`);
            }
        }

        const openLane = !defenseStates.some(d => !d.isBlocked && !d.isEngaged && Math.abs(d.x - qbState.x) < 3.5 && d.y < qbState.y + 1);
        if (!decisionMade && openLane && (isPressured || playState.tick > 80)) {
            const scrambleChance = (playState.tick > 100) ? 0.3 : ((qbAgility / 100) * 0.05);
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
                qbState.action = 'qb_scramble';
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

        if (reason === "Imminent Sack") {
            const chanceToEatSack = (110 - qbIQ) / 100;
            if (Math.random() < chanceToEatSack) return;

            const panicTarget = offenseStates
                .filter(o => o.slot !== 'QB1' && !o.slot.startsWith('OL'))
                .map(o => getTargetValue(o.slot))
                .filter(v => v && v.score > 20)
                .sort((a, b) => b.score - a.score)[0];

            if (panicTarget) {
                targetPlayerState = panicTarget.info.state;
                actionTaken = "Panic Throw";
                decisionMade = true;
            } else {
                actionTaken = "Throw Away";
            }
        } else {
            actionTaken = "Throw Away";
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
        return;
    }

    if (targetPlayerState && actionTaken.includes("Throw")) {
        let adjustedAccuracy = Number(qbAcc) || 50;
        let pPenalty = 0;

        if (isPressured) {
            const pCount = Number(pressureCount) || 0;
            const qbIQNum = Number(qbState.playbookIQ || qbState.iq || 50);

            const basePenalty = 15;
            const IQ_MITIGATION = (qbIQNum / 100) * 0.5;
            pPenalty = basePenalty + (pCount * 5) - (basePenalty * IQ_MITIGATION);

            adjustedAccuracy = Math.max(30, adjustedAccuracy - pPenalty);
        }

        executeThrow(qbState, targetPlayerState, qbStrength, adjustedAccuracy, playState, gameLog, actionTaken);
    }

    if (isDesperationTime && !decisionMade && !targetPlayerState && playState.tick >= 35) {
        const deepReceiver = offenseStates
            .filter(o => o.slot !== 'QB1' && !o.slot.startsWith('OL') && (o.action.includes('route') || o.action === 'route_complete'))
            .sort((a, b) => b.y - a.y)[0];

        if (deepReceiver && deepReceiver.y > playState.lineOfScrimmage + 10 && Math.random() > 0.4) {
            if (gameLog) gameLog.push(`🚨 ${qbState.name} heaves it downfield in desperation!`);
            executeThrow(qbState, deepReceiver, qbStrength, qbAcc * 0.4, playState, gameLog, "Desperation Throw");
            return;
        }
    }
}

export function executeThrow(qbState, target, strength, accuracy, playState, gameLog, actionType) {
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

    const maxArmVelocity = 16 + (strength / 100) * 14.0;
    let ballSpeed = maxArmVelocity;
    if (passType === 'lob') ballSpeed *= 0.70;
    else if (passType === 'touch') ballSpeed *= 0.85;

    let aimX = target.x;
    let aimY = target.y;

    if (target.action === 'run_route' || target.action === 'route_complete' || target.isBallCarrier) {
        const flightTime = throwDistance / ballSpeed;
        const targetWgt = target.weight || target.wgt || 200;
        const targetSpd = target.speed || target.spd || 50;
        const targetAgi = target.agility || target.agi || 50;

        const weightSpeedPenalty = Math.max(0.80, 1.0 - ((targetWgt - 200) / 1000));
        const trackingSprintBoost = 1.1 + (targetAgi / 250);
        const recYPS = (7.0 + (targetSpd / 100) * 4.0) * (target.fatigueModifier || 1.0) * weightSpeedPenalty * trackingSprintBoost;

        const qbIQ = qbState.playbookIQ || 50;
        const qbCons = qbState.consistency || 50;

        const maxError = (100 - qbIQ) / 650;
        const errorRoll = (Math.random() - 0.5) * 2;
        const consistencyRoll = (Math.random() * (100 - qbCons)) / 100;
        let qbEstimation = 1.0 + (errorRoll * maxError) + (errorRoll * consistencyRoll * 0.1);

        if (passType === 'bullet') qbEstimation *= 0.92;
        if (passType === 'lob') qbEstimation *= 1.08;

        let distanceToTravel = recYPS * flightTime * qbEstimation;

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
                    break;
                }
            }
        }

        if (distanceToTravel > 0) {
            const dirX = (target.vx && Math.abs(target.vx) > 0.5) ? target.vx / recYPS : lastValidDirX;
            const dirY = (target.vy && Math.abs(target.vy) > 0.5) ? target.vy / recYPS : lastValidDirY;

            aimX = currX + (dirX * distanceToTravel);
            aimY = currY + (dirY * distanceToTravel);
        }
    } else {
        aimX = target.x;
        aimY = target.y;
    }

    const distancePower = 1.5 - (accuracy / 100);
    const distanceFactor = Math.pow(throwDistance / 25, distancePower);
    let errorMargin = ((100 - accuracy) / 12) * distanceFactor;

    if (playState.isPressured) errorMargin *= (2.0 - (qbState.iq / 100));

    const dirX = aimX - startX;
    const dirY = aimY - startY;
    const mag = Math.max(0.1, Math.hypot(dirX, dirY));
    const uX = dirX / mag;
    const uY = dirY / mag;

    const longBias = (Math.random() > 0.3) ? 1.4 : -0.6;
    const longError = (Math.random() * errorMargin) * longBias;
    const latError = (Math.random() - 0.5) * errorMargin * 1.2;

    aimX += (uX * longError) + (-uY * latError);
    aimY += (uY * longError) + (uX * latError);

    aimX = Math.max(-5, Math.min(FIELD_WIDTH + 5, aimX));
    aimY = Math.max(0.5, Math.min(FIELD_LENGTH - 0.5, aimY));

    const finalDist = Math.hypot(aimX - startX, aimY - startY);
    const t = Math.max(0.1, finalDist / ballSpeed);

    const targetZ = 1.0;
    const startZ = 2.2;
    const deltaZ = targetZ - startZ;
    const vz = (deltaZ + (4.9 * t * t)) / t;

    playState.ballState = {
        x: startX, y: startY, z: startZ, inAir: true, throwTick: playState.tick, releaseeTick: playState.tick,
        vx: (aimX - startX) / t, vy: (aimY - startY) / t, vz: vz,
        targetX: aimX, targetY: aimY, targetPlayerId: target.id, throwerId: qbState.id, isThrowAway: false
    };

    qbState.hasBall = false;
    qbState.isBallCarrier = false;
    qbState.action = 'idle';

    playState.statEvents.push({ type: 'pass_attempt', qbId: qbState.id });
    playState.statEvents.push({ type: 'target', receiverId: target.id });

    logPlayDebug('QB_THROW', `${qbState.name} threw to ${target.name} (${target.slot})`, {
        passType,
        airDistance: Number(finalDist.toFixed(1)),
        accuracyApplied: Math.round(accuracy),
        flightTimeSec: Number(t.toFixed(2))
    });

    if (gameLog) {
        const passTypeStr = passType.charAt(0).toUpperCase() + passType.slice(1);
        gameLog.push(`[Tick ${playState.tick}] 🏈 ${qbState.name} throws a ${passTypeStr} to ${target.name} | Air Dist: ${finalDist.toFixed(1)}y`);
    }
}

export function updatePunterDecision(playState, offenseStates, gameLog) {
    const punter = offenseStates.find(p => p.slot === 'QB1');
    if (!punter || !punter.hasBall) return;

    const snapDuration = 15;
    if (playState.tick < snapDuration) {
        const pct = playState.tick / snapDuration;
        const snapStartY = playState.lineOfScrimmage - 0.5;
        playState.ballState.x = punter.x;
        playState.ballState.y = snapStartY + (punter.y - snapStartY) * pct;
        playState.ballState.z = 0.5 + (pct * 0.5);
        return;
    }

    if (playState.tick < 25) {
        playState.ballState.x = punter.x;
        playState.ballState.y = punter.y;
        playState.ballState.z = 1.2;
        return;
    }

    const punterPower = punter.attributes?.physical?.strength || 50;
    const punterAcc = punter.attributes?.technical?.kickingAccuracy || 50;

    const isLeftHash = punter.x < 26.6;
    const targetX = isLeftHash ? 42.0 : 11.0;

    const baseDistance = 34 + ((punterPower / 100) * 16);
    const varianceY = (Math.random() - 0.5) * 14;
    let puntDistance = Math.max(25, baseDistance + varianceY);

    if (playState.lineOfScrimmage + puntDistance > 106) {
        puntDistance = Math.max(20, 104 - playState.lineOfScrimmage);
    }

    const targetY = playState.lineOfScrimmage + puntDistance;
    const errorX = (Math.random() - 0.5) * ((100 - punterAcc) / 100) * 10;
    const errorY = (Math.random() - 0.5) * 4;

    const finalTargetX = Math.max(2, Math.min(51, targetX + errorX));
    const finalTargetY = Math.min(118, targetY + errorY);

    const hangTime = 4.0 + (punterPower / 65);

    playState.ballState.vx = (finalTargetX - punter.x) / hangTime;
    playState.ballState.vy = (finalTargetY - punter.y) / hangTime;
    playState.ballState.vz = 4.9 * hangTime;

    playState.ballState.inAir = true;
    playState.ballState.throwerId = punter.id;
    playState.ballState.x = punter.x;
    playState.ballState.y = punter.y;
    playState.ballState.z = 1.5;

    playState.ballState.targetX = finalTargetX;
    playState.ballState.targetY = finalTargetY;
    playState.ballState.throwTick = playState.tick;

    punter.hasBall = false;
    punter.isBallCarrier = false;
    punter.action = 'idle';

    if (gameLog) gameLog.push(`[Tick ${playState.tick}] 👟 ${punter.name} punts the ball! (${Math.round(puntDistance)} yards)`);
}
