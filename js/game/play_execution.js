//play_execution.js

import { getDistance } from './physics.js';
import { getPlayer, game } from './state.js';
import {
    routeTree, offenseFormations, defenseFormations, defensivePlaybook
} from '../data.js';
import {
    getZoneCenter, calculateRoutePath, resolveDepthForPlay, getAssignment, zoneBoundaries
} from './engine_helpers.js';
import { calculateSafetyHelp, diagnosePlay, getSmartCarrierTarget } from './ai.js';
import { getPerceptionContext, getPerceptionWeight } from './perception.js';
import { getDecisionProfile } from './decision_model.js';
import { pushGameLog } from './collisions.js';
import { initPlayTelemetry, finalizePlayTelemetry, logPlayDebug } from './telemetry.js';
import { initMovementIntent, setPointIntent, setHoldIntent, setTrackIntent, setLaneIntent, setRouteIntent, resolveMovementIntent } from './movement_intent.js';
import { calculateSchemeClash } from './staff.js';
import {
    getPlayerBaseSpeedYPS,
    getPlayerAccelerationYPS2
} from './movement_profile.js';

const FIELD_WIDTH = 53.3;
const FIELD_LENGTH = 120;
const CENTER_X = FIELD_WIDTH / 2;

const PASS_INTERCEPT_STEPS = 12;
const PASS_INTERCEPT_SPEED_FACTOR = 0.82;
const PASS_INTERCEPT_MARGIN = 0.85;

function getReachablePassInterceptionPoint(pState, ballState) {
    if (
        !pState ||
        !ballState ||
        !Number.isFinite(pState.x) ||
        !Number.isFinite(pState.y) ||
        !Number.isFinite(ballState.x) ||
        !Number.isFinite(ballState.y) ||
        !Number.isFinite(ballState.targetX) ||
        !Number.isFinite(ballState.targetY)
    ) {
        return null;
    }

    const pathDX = ballState.targetX - ballState.x;
    const pathDY = ballState.targetY - ballState.y;
    const remainingDistance = Math.hypot(pathDX, pathDY);

    const ballVX = Number.isFinite(ballState.vx) ? ballState.vx : 0;
    const ballVY = Number.isFinite(ballState.vy) ? ballState.vy : 0;
    const ballSpeedYPS = Math.hypot(ballVX, ballVY);

    if (remainingDistance <= 0.25 || ballSpeedYPS <= 1.0) {
        return null;
    }

    const remainingFlightSeconds = remainingDistance / ballSpeedYPS;

    const fatigueMod = pState.fatigueModifier || 1.0;

    const maxSpeedYPS =
        getPlayerBaseSpeedYPS(pState) * fatigueMod;

    let accelerationYPS2 =
        getPlayerAccelerationYPS2(pState) * fatigueMod;

    // Match the movement engine's balance-recovery penalty.
    if (pState.moveCooldown > 0) {
        accelerationYPS2 *= 0.85;
    }

    if (
        !Number.isFinite(maxSpeedYPS) ||
        maxSpeedYPS <= 0 ||
        !Number.isFinite(accelerationYPS2) ||
        accelerationYPS2 <= 0
    ) {
        return null;
    }

    const playerVX = Number.isFinite(pState.vx) ? pState.vx : 0;
    const playerVY = Number.isFinite(pState.vy) ? pState.vy : 0;

    // Test points in chronological order along the remaining pass trajectory.
    // The defender can break only if they can plausibly arrive before the ball.
    for (let step = 0; step <= PASS_INTERCEPT_STEPS; step++) {
        const fraction = step / PASS_INTERCEPT_STEPS;

        const pointX = ballState.x + (pathDX * fraction);
        const pointY = ballState.y + (pathDY * fraction);
        const timeToPoint = remainingFlightSeconds * fraction;

        const toPointDX = pointX - pState.x;
        const toPointDY = pointY - pState.y;
        const distanceToPoint = Math.hypot(toPointDX, toPointDY);

        const directionX = distanceToPoint > 0.001
            ? toPointDX / distanceToPoint
            : 0;

        const directionY = distanceToPoint > 0.001
            ? toPointDY / distanceToPoint
            : 0;

        // Existing momentum helps if the defender is already moving toward
        // the interception point, but movement away from it is not rewarded.
        const velocityTowardPoint = Math.max(
            0,
            (playerVX * directionX) + (playerVY * directionY)
        );

        const accelerationReach =
            (velocityTowardPoint * timeToPoint) +
            (0.5 * accelerationYPS2 * timeToPoint * timeToPoint);

        // Reduce the theoretical top-speed distance to account for turning,
        // acceleration, and the fact that the defender is reacting mid-play.
        const topSpeedReach =
            maxSpeedYPS *
            timeToPoint *
            PASS_INTERCEPT_SPEED_FACTOR;

        const reachableDistance =
            Math.min(accelerationReach, topSpeedReach) +
            PASS_INTERCEPT_MARGIN;

        if (distanceToPoint <= reachableDistance) {
            return {
                x: pointX,
                y: pointY
            };
        }
    }

    return null;
}

function getPursuitTargetY(pState, carrier, predictedY) {
    if (
        !pState ||
        !carrier ||
        !Number.isFinite(pState.y) ||
        !Number.isFinite(carrier.y) ||
        !Number.isFinite(predictedY)
    ) {
        return predictedY;
    }

    const isQBPassRush =
        carrier.role === 'QB' &&
        (
            pState.role === 'DL' ||
            pState.assignment?.includes('rush') ||
            pState.assignment?.includes('blitz')
        );

    // Pass rushers must be able to close on a QB behind them.
    // Do not apply the depth-preservation rule to pocket pressure.
    if (isQBPassRush) {
        return predictedY;
    }

    const separation = pState.y - carrier.y;
    const distanceToCarrier = getDistance(pState, carrier);

    // Once the runner is close, stop holding the downfield landmark.
    // Close the gap and pursue the carrier's predicted position instead.
    const PURSUIT_CLOSE_GAP_DISTANCE = 8.0;

    if (
        separation <= 1.0 ||
        distanceToCarrier <= PURSUIT_CLOSE_GAP_DISTANCE
    ) {
        return predictedY;
    }

    // At greater distances, preserve downfield leverage.
    return Math.max(pState.y, predictedY);
}

function validateFormationCoordinate(x, y) {
    const minX = 0;
    const maxX = FIELD_WIDTH;
    const minY = -10;
    const maxY = FIELD_LENGTH;
    return {
        x: Math.max(minX, Math.min(maxX, x)),
        y: Math.max(minY, Math.min(maxY, y))
    };
}

export function setupInitialPlayerStates(playState, offense, defense, play, assignments, ballOnYardLine, defensivePlayKey, ballHash = 'M', offensivePlayKey = '') {
    playState.activePlayers = [];
    const isPlayAction = offensivePlayKey.includes('PA_');

    playState.type = play.type;
    playState.readProgression = play.readProgression || [];
    playState.playKey = offensivePlayKey || null;
    playState.offenseTeam = offense;
    playState.defenseTeam = defense;

    playState.defensivePlayKey = defensivePlayKey;
    let defPlay = defensivePlaybook[defensivePlayKey] || defensivePlaybook['Cover_2_Zone_Base'] || { name: 'Emergency Default', assignments: {} };
    const defAssignments = defPlay.assignments || {};

    playState.lineOfScrimmage = ballOnYardLine + 10;
    let ballX = CENTER_X;
    if (ballHash === 'L') ballX = 18.0;
    else if (ballHash === 'R') ballX = 35.3;

    let offFormKey = offense.formations.offense;
    if (!offenseFormations[offFormKey]) offFormKey = 'Balanced';

    const offenseFormationData = offenseFormations[offFormKey];
    const initialOffenseStates = [];

    if (offenseFormationData?.slots) {
        offenseFormationData.slots.forEach(slot => {
            const relCoords = offenseFormationData.coordinates[slot] || [0, 0];
            let startX = ballX + relCoords[0];
            let startY = playState.lineOfScrimmage + relCoords[1];

            // Compress wide receivers near boundary when ball is on hashes (18.0 or 35.3)
            if (slot.startsWith('WR') || slot.startsWith('TE')) {
                const MIN_SIDELINE_BUFFER = 4.2;
                if (startX > FIELD_WIDTH - MIN_SIDELINE_BUFFER) startX = FIELD_WIDTH - MIN_SIDELINE_BUFFER;
                else if (startX < MIN_SIDELINE_BUFFER) startX = MIN_SIDELINE_BUFFER;
            }

            const validated = validateFormationCoordinate(startX, startY);
            initialOffenseStates.push({ slot, x: validated.x, y: validated.y });
        });
    }

    const setupSide = (team, side, formationData, isOffense) => {
        if (!team || !formationData) return;

        const sortedSlots = [...formationData.slots].sort((a, b) => {
            if (a.startsWith('C') || a.startsWith('OL')) return -1;
            if (a.startsWith('QB')) return -1;
            return 0;
        });

        const coveredOffensiveSlots = new Set();

        sortedSlots.forEach(slot => {
            if (!playState.resolvedDepth) playState.resolvedDepth = resolveDepthForPlay(offense, defense);
            const playerId = playState.resolvedDepth[side]?.[slot];
            const player = getPlayer(playerId);
            if (!player) return;

            let assignedPlayerSlot = null;
            let routePath = null;
            let readProgression = [];
            let dropbackPhase = null;
            let hasCompletedDropback = true;

            const relCoords = formationData.coordinates[slot] || [0, 0];
            let startX = ballX + relCoords[0];
            let startY = playState.lineOfScrimmage + relCoords[1];

            // Compress wide receivers near boundary when ball is on hashes
            if (isOffense && (slot.startsWith('WR') || slot.startsWith('TE'))) {
                const MIN_SIDELINE_BUFFER = 4.2;
                if (startX > FIELD_WIDTH - MIN_SIDELINE_BUFFER) startX = FIELD_WIDTH - MIN_SIDELINE_BUFFER;
                else if (startX < MIN_SIDELINE_BUFFER) startX = MIN_SIDELINE_BUFFER;
            }

            const validated = validateFormationCoordinate(startX, startY);
            startX = validated.x;
            startY = validated.y;

            let targetX = startX;
            let targetY = startY;
            let dropbackTargetY = startY;
            let action = 'idle';

            const formationMapping = formationData.mapping || {};
            let assignment = isOffense
                ? getAssignment(slot, assignments, formationMapping, true)
                : defAssignments[slot];

            if (isOffense) {
                for (const [role, mappedSlot] of Object.entries(formationMapping)) {
                    if (mappedSlot === slot || (Array.isArray(mappedSlot) && mappedSlot.includes(slot))) {
                        assignedPlayerSlot = role;
                        break;
                    }
                }
                if (slot.startsWith('QB')) {
                    if (play.type === 'punt') {
                        assignment = 'punt'; action = 'punt_kick'; targetY = startY - 5;
                    } else {
                        assignment = assignment || 'qb_setup';
                        action = assignment;

                        if (play.readProgression && play.readProgression.length > 0) {
                            const mapping = formationData.mapping || {};
                            readProgression = play.readProgression
                                .map(role => {
                                    const mapped = mapping[role];

                                    if (Array.isArray(mapped)) {
                                        return mapped[0] || null;
                                    }

                                    return mapped || null;
                                })
                                .filter(Boolean);
                        }

                        dropbackPhase = 'dropping'; hasCompletedDropback = false;
                        const initialDepth = playState.lineOfScrimmage - startY;
                        const isShotgun = initialDepth >= 4.0;
                        const isScreen = play.tags && play.tags.includes('screen');

                        if (play.type === 'run') {
                            dropbackTargetY = isShotgun ? startY - 0.5 : playState.lineOfScrimmage - 3.5;
                        } else {
                            const isQuick = play.tags && (play.tags.includes('short') || play.tags.includes('quick'));
                            const isDeep = play.tags && (play.tags.includes('deep') || play.tags.includes('hailmary'));

                            let targetDepth = 0;
                            if (isScreen) targetDepth = 12.0;
                            else if (isShotgun) {
                                if (isQuick) targetDepth = initialDepth;
                                else if (isDeep) targetDepth = 10.0;
                                else targetDepth = 7.5;
                            } else {
                                if (isQuick) targetDepth = 3.5;
                                else if (isDeep) targetDepth = 9.5;
                                else targetDepth = 6.5;
                            }
                            dropbackTargetY = playState.lineOfScrimmage - targetDepth;
                        }
                    }
                } else if (slot.startsWith('OL')) {
                    if (!assignment) {
                        assignment = (play.type === 'pass' && !isPlayAction) ? 'pass_block' : 'run_block';
                    }
                    action = assignment;

                    if (action === 'pass_block' || action === 'run_block') {
                        targetY = startY + (action === 'pass_block' ? -0.5 : 0.5);
                    } else if (routeTree[assignment]) {
                        action = 'run_path';
                        routePath = calculateRoutePath(assignment, startX, startY);
                        if (routePath && routePath.length) {
                            targetX = routePath[0].x; targetY = routePath[0].y;
                        }
                    }
                } else if (assignment) {
                    if (assignment.includes('block')) {
                        action = assignment; targetY = startY + 0.5;
                    } else if (assignment.includes('run_')) {
                        action = 'run_path';
                        routePath = calculateRoutePath(assignment, startX, startY);

                        // Interior runs should target a gap between offensive linemen,
                        // rather than the center of a lineman's body.
                        if (
                            slot.startsWith('RB') &&
                            play.type === 'run' &&
                            routePath?.length &&
                            ['run_dive', 'run_iso_l', 'run_iso_r'].includes(assignment)
                        ) {
                            const olXs = initialOffenseStates
                                .filter(s => s.slot.startsWith('OL'))
                                .map(s => s.x)
                                .sort((a, b) => a - b);

                            const gapXs = [];
                            for (let i = 0; i < olXs.length - 1; i++) {
                                gapXs.push((olXs[i] + olXs[i + 1]) / 2);
                            }

                            const lastIndex = routePath.length - 1;
                            const desiredX = routePath[lastIndex].x;
                            const direction = assignment.endsWith('_r')
                                ? 1
                                : assignment.endsWith('_l')
                                    ? -1
                                    : 0;

                            const eligibleGaps = gapXs.filter(gapX => {
                                if (direction === 0) return true;
                                return direction > 0
                                    ? gapX >= desiredX
                                    : gapX <= desiredX;
                            });

                            if (eligibleGaps.length > 0) {
                                const targetGapX = eligibleGaps.reduce((best, gapX) =>
                                    Math.abs(gapX - desiredX) < Math.abs(best - desiredX)
                                        ? gapX
                                        : best
                                );

                                const shiftX = targetGapX - desiredX;

                                routePath = routePath.map(pt => ({
                                    ...pt,
                                    x: pt.x + shiftX
                                }));
                            }
                        }

                        if (routePath && routePath.length > 0) {
                            targetX = routePath[0].x;
                            targetY = routePath[0].y;
                        } else {
                            targetY = startY + 5;
                        }
                    } else if (routeTree[assignment]) {
                        action = 'run_route';
                        routePath = calculateRoutePath(assignment, startX, startY);

                        // DEEPER FIX: Red Zone Route Capping
                        // Truncate waypoints so receivers never run through the back of the end zone (y > 118.0)
                        if (routePath && routePath.length) {
                            routePath = routePath.map(pt => ({
                                x: Math.max(1.5, Math.min(51.8, pt.x)),
                                y: Math.min(118.0, pt.y)
                            }));
                            targetX = routePath[0].x; 
                            targetY = routePath[0].y;
                        }
                    }
                }
            } else {
                if (!assignment) {
                    if (slot.startsWith('DL')) assignment = 'run_gap_A';
                    else if (slot.startsWith('LB')) assignment = 'def_read';
                    else if (slot.startsWith('DB')) assignment = 'zone_deep_middle';
                }

                if (assignment.startsWith('man_cover_') || assignment === 'def_read') {
                    let targetSlot = assignment.replace('man_cover_', '');
                    const offMapping = offenseFormationData.mapping || {};

                    if (offMapping[targetSlot]) {
                        const mappedSlot = offMapping[targetSlot];
                        targetSlot = Array.isArray(mappedSlot) ? mappedSlot[0] : mappedSlot;
                        if (assignment !== 'def_read') assignment = `man_cover_${targetSlot}`;
                    }

                    const targetExists = initialOffenseStates.some(o => o.slot === targetSlot);
                    if (!targetExists || assignment === 'def_read') {
                        let priorities = [];
                        if (slot.startsWith('DB')) priorities = ['WR1', 'WR2', 'WR3', 'TE1', 'RB1'];
                        else if (slot.startsWith('LB')) priorities = ['RB1', 'TE1', 'RB2', 'WR3'];
                        else priorities = ['RB1'];

                        const bestTarget = priorities.find(t =>
                            initialOffenseStates.some(o => o.slot === t) && !coveredOffensiveSlots.has(t)
                        );

                        if (bestTarget) {
                            assignment = `man_cover_${bestTarget}`;
                            targetSlot = bestTarget;
                        } else {
                            assignment = slot.startsWith('DB') ? 'zone_deep_halves' : 'zone_hook_curl_middle';
                        }
                    }

                    if (assignment.startsWith('man_cover_')) {
                        assignedPlayerSlot = targetSlot;
                        coveredOffensiveSlots.add(targetSlot);
                    }
                }

                action = assignment;

                if (assignment.startsWith('man_cover_')) {
                    const tSlot = assignment.split('_')[2];
                    const tState = initialOffenseStates.find(o => o.slot === tSlot);

                    if (tState) {
                        const isSlot = tSlot.includes('TE') || tSlot === 'WR3';
                        let xOffset = (tState.x < CENTER_X) ? (isSlot ? 1.0 : -0.5) : (isSlot ? -1.0 : 0.5);
                        let yOffset = 2.0;

                        const existingCoverers = playState.activePlayers.filter(p => p.assignment === assignment).length;
                        if (existingCoverers === 1) {
                            xOffset *= -2.5; yOffset += 2.0;
                        } else if (existingCoverers >= 2) {
                            xOffset = 0; yOffset += 5.0;
                        }

                        startX = tState.x + xOffset;
                        startY = tState.y + yOffset;
                        targetX = tState.x;
                        targetY = tState.y;
                    }
                } else if (assignment.startsWith('zone_')) {
                    if (assignment.includes('deep')) startY = Math.max(startY, playState.lineOfScrimmage + 8);
                }

                if (assignment === 'punt_return') {
                    startY = Math.min(108, startY);
                }
            }

            startX = Math.max(0.5, Math.min(53.3 - 0.5, startX));
            // Allow players to line up inside the endzones (0.5 to 119.5) for Goal Line / Conversion plays
            startY = Math.max(0.5, Math.min(119.5, startY));

            if (isOffense) {
                if (startY > playState.lineOfScrimmage - 0.2) {
                    startY = playState.lineOfScrimmage - 0.2;
                }
            } else {
                // Minimum 1.25 yds across LOS gives 1.45 yds gap from OL (-0.2), preventing pre-snap overlap
                if (startY < playState.lineOfScrimmage + 1.25) {
                    startY = playState.lineOfScrimmage + 1.25;
                }
            }

            if (player.fatigue === undefined || isNaN(player.fatigue)) player.fatigue = 0;
            const fatigueMod = Math.max(0.70, 1.0 - ((player.fatigue || 0) / 100) * 0.30);

            const isPreferredOffense = offense.formations.offense === offense.coach?.preferredOffense;
            const isPreferredDefense = defense.formations.defense === defense.coach?.preferredDefense;
            
            // Scheme Clash Penalty (GM vs Coach)
            const teamRef = isOffense ? offense : defense;
            const clashPenalty = calculateSchemeClash(teamRef);

            let schemeBoost = 0;
            if (isOffense && isPreferredOffense) schemeBoost = 5;
            else if (!isOffense && isPreferredDefense) schemeBoost = 5;

            const playerIQ = Math.max(10, Math.min(99, (player.attributes?.mental?.playbookIQ || 50) + schemeBoost - clashPenalty));
            const consistency = Math.max(10, Math.min(99, (player.attributes?.mental?.consistency || 50) + schemeBoost - clashPenalty));

            let reactionTicks = 0;
            if (slot !== 'QB1' && slot !== 'OL2') {
                reactionTicks = Math.max(1, 10 - Math.floor(playerIQ / 10)) + Math.floor(Math.random() * 3);
                if (!isOffense) reactionTicks += 2;
            }

            const speed = player.attributes?.physical?.speed || 50;
            const agility = player.attributes?.physical?.agility || 50;
            const strength = player.attributes?.physical?.strength || 50;
            const jumping = player.attributes?.physical?.jumping || 50;
            const weight = player.attributes?.physical?.weight || 150;
            const height = player.attributes?.physical?.height || 68;
            const toughness = player.attributes?.mental?.toughness || 50;
            const catching = player.attributes?.technical?.catchingHands || 50;
            const tackling = player.attributes?.technical?.tackling || player.attributes?.defense?.tackling || 50;
            const coverage = player.attributes?.technical?.coverage || player.attributes?.technical?.passCoverage || 50;
            const blocking = player.attributes?.technical?.blocking || 50;
            const blockShedding = player.attributes?.technical?.blockShedding || 50;
            const accuracy = player.attributes?.technical?.throwingAccuracy || 50;
            const throwPower = player.attributes?.technical?.throwPower ?? strength;

            const pState = {
                id: player.id,
                name: player.name,
                number: player.number,
                role: slot.replace(/\d+/g, ''),
                teamId: team.id,
                age: player.age ?? 12,
                explosiveness: player.attributes?.physical?.explosiveness ?? 50,
                snapReactionTimer: reactionTicks,
                primaryColor: team.primaryColor,
                secondaryColor: team.secondaryColor,
                isOffense, slot,
                personality: player.personality || null,
                decisionMaking: player.attributes?.mental?.decisionMaking ??
                    player.attributes?.mental?.playbookIQ ?? 50,
                experienceSeasons: player.careerStats?.seasonsPlayed || 0,
                experienceSnaps: player.careerStats?.snapsThisSeason || 0,
                x: startX, y: startY, initialX: startX, initialY: startY,
                targetX, targetY,
                fatigueModifier: fatigueMod,
                spd: speed, agi: agility, str: strength, jump: jumping,
                wgt: weight, hgt: height, iq: playerIQ,
                speed, agility, strength, jumping, weight, height, playbookIQ: playerIQ,
                cons: consistency, tgh: toughness, ctch: catching,
                tkl: tackling, blk: blocking, shed: blockShedding,
                acc: accuracy, thp: throwPower, cov: coverage,
                speed, agility, strength, weight, height, playbookIQ: playerIQ,
                consistency, toughness, catchingHands: catching,
                tackling, blocking, blockShedding, throwingAccuracy: accuracy,
                throwPower, coverage,
                action, assignment, assignedPlayerSlot, routePath,
                currentPathIndex: 0,
                readProgression, currentReadTargetSlot: readProgression[0] || null,
                ticksOnCurrentRead: 0, dropbackPhase, hasCompletedDropback, dropbackTargetY,
                vx: 0, vy: 0, vz: 0,
                isEngaged: false, engagedWith: null,
                isBlocked: false, blockedBy: null,
                hasBall: false, isBallCarrier: false,
                stunnedTicks: 0
            };

            initMovementIntent(pState);
            playState.activePlayers.push(pState);
        });
    };

    const defenseFormationData = defenseFormations[defense.formations.defense] || defenseFormations['3-2-3'];
    setupSide(offense, 'offense', offenseFormationData, true);
    setupSide(defense, 'defense', defenseFormationData, false);

    const snapTaker = playState.activePlayers.find(p => p.isOffense && (p.assignment?.includes('qb_') || p.assignment === 'punt'));
    if (snapTaker) {
        snapTaker.hasBall = true;
        playState.ballState.x = snapTaker.x;
        playState.ballState.y = snapTaker.y;
        playState.ballState.z = 1.0;

        const isFleaFlicker = offensivePlayKey === 'Trick_Flea_Flicker';

        if (play.type === 'run' || isFleaFlicker) {
            const runner = playState.activePlayers.find(p =>
                p.isOffense &&
                p.assignment?.startsWith('run_') &&
                p.id !== snapTaker.id
            );

            if (runner) {
                playState.handoffRequired = true;
                playState.handoffTargetSlot = runner.slot;

                if (isFleaFlicker) {
                    playState.fleaFlickerPhase = 'qb_mesh';
                }
            } else {
                snapTaker.isBallCarrier = true;
            }
        }
    }
}

export function updatePlayerTargets(playState, offenseStates, defenseStates, ballCarrierState, playType, offensivePlayKey, offensiveAssignments, defensivePlayKey, gameLog) {
    // Reset per-tick speed modifiers so temporary contact effects do not persist.
    // The logic below reapplies any modifier required for this tick.
    playState.activePlayers.forEach(pState => {
        pState.contactReduction = 1.0;
    });

    const qbState = offenseStates.find(p => p.slot?.startsWith('QB'));
    const isBallInAir = playState.ballState.inAir;
    const ballPos = playState.ballState;
    const LOS = playState.lineOfScrimmage;

    // FIX: Detect if a pass was caught and the play has transitioned to Run-After-Catch
    const isPassCompleted = playState.type === 'pass' && 
        (playState.statEvents.some(e => e.type === 'completion') || 
        (ballCarrierState && ballCarrierState.isOffense && ballCarrierState.role !== 'QB'));

    const primaryRunTarget =
        offenseStates.find(p =>
            p.slot === playState.handoffTargetSlot &&
            p.assignment?.startsWith('run_') &&
            p.routePath?.length > 0
        ) ||
        offenseStates.find(p =>
            p.role === 'RB' &&
            p.assignment?.startsWith('run_') &&
            p.routePath?.length > 0
        ) ||
        null;
    
    if (playState.ballState.isLoose) {
        const getClosest = (isOff) => playState.activePlayers
            .filter(p => p.isOffense === isOff && p.stunnedTicks <= 0 && !p.isEngaged)
            .sort((a, b) => getDistance(a, playState.ballState) - getDistance(b, playState.ballState))
            .slice(0, 3);

        const pursuers = [...getClosest(true), ...getClosest(false)];
        playState.activePlayers.forEach(pState => {
            if (pState.stunnedTicks > 0 || pState.isEngaged) return;
            if (pursuers.includes(pState)) {
                setTrackIntent(pState, playState.ballState, 0, 0.4);
                pState.action = 'pursuit';
            } else {
                setHoldIntent(pState, pState.x, pState.y);
                pState.action = 'idle';
            }
            pState.targetX = Math.max(1, Math.min(52.3, pState.targetX));
            pState.targetY = Math.max(1, Math.min(119.0, pState.targetY));
            resolveMovementIntent(pState);
        });
        return;
    }

    if (ballCarrierState && !ballCarrierState.isOffense) {
        playState.activePlayers.forEach(pState => {
            if (pState.stunnedTicks > 0) return;
            if (pState.isBlocked || pState.isEngaged) return;

            if (pState.id === ballCarrierState.id) {
                let targetX = pState.x;
                const nearestOff = offenseStates.find(o => getDistance(pState, o) < 8);
                if (nearestOff) {
                    const dx = pState.x - nearestOff.x;
                    targetX += (dx > 0 ? 3 : -3);
                    targetX = Math.max(1, Math.min(52, targetX));
                } else {
                    if (pState.x < 20) targetX += 0.5;
                    else if (pState.x > 33) targetX -= 0.5;
                }
                pState.targetX = targetX;
                pState.targetY = 10;
                pState.action = 'run_path';
                pState.contactReduction = nearestOff ? 0.9 : 1.0;
            } else if (!pState.isOffense) {
                const nearestOff = offenseStates
                    .filter(o => !o.isEngaged && o.y < pState.y + 5 && o.y > pState.y - 15)
                    .sort((a, b) => getDistance(pState, a) - getDistance(pState, b))[0];

                if (nearestOff) {
                    pState.targetX = nearestOff.x;
                    pState.targetY = nearestOff.y;
                    pState.action = 'run_block';
                } else {
                    pState.targetX = ballCarrierState.x + (pState.x < ballCarrierState.x ? -3 : 3);
                    pState.targetY = ballCarrierState.y - 3;
                    pState.action = 'run_path';
                }
            } else if (pState.isOffense) {
                const dist = getDistance(pState, ballCarrierState);
                const leadTime = dist / 15;
                const carrierVx = ballCarrierState.vx || 0;
                const carrierVy = ballCarrierState.vy || 0;
                pState.targetX = ballCarrierState.x + (carrierVx * leadTime);
                pState.targetY = ballCarrierState.y + (carrierVy * leadTime);
                pState.action = 'run_path';
            }
            pState.targetX = Math.max(1, Math.min(52.3, pState.targetX));
            pState.targetY = Math.max(1, Math.min(119.0, pState.targetY));
            resolveMovementIntent(pState);
        });
        return;
    }

    const allThreats = defenseStates.filter(d => {
        if (d.isBlocked || d.isEngaged || d.stunnedTicks > 0) return false;
        if (d.assignment?.includes('rush') || d.assignment?.includes('blitz')) return true;
        if (d.role === 'DL') return true;
        if (d.y < LOS + 3.0 && Math.abs(d.x - CENTER_X) < 10) return true;
        return false;
    });

    const linemen = offenseStates.filter(
        p => !p.isEngaged && p.slot.startsWith('OL')
    );
    // FIX: Only pass designated blockers into assignBlockerTarget.
    // Do NOT include wide receivers who transitioned to run_block to escort a live ball carrier downfield!
    const otherBlockers = offenseStates.filter(
        p => !p.isEngaged &&
             !p.slot.startsWith('OL') &&
             p.assignment?.includes('block') &&
             (p.action === 'pass_block' || p.action === 'run_block')
    );
    const assignedThreats = new Set();

    const runCarrierForBlocking =
    // Prefer the designed RB path during a normal handoff run.
    offenseStates.find(p =>
        p.slot === 'RB1' &&
        p.routePath?.length
    ) ||
    // Otherwise use another ball carrier with a defined path,
    // which also supports designed QB runs.
    offenseStates.find(p =>
        p.isBallCarrier &&
        p.routePath?.length &&
        p.action !== 'handoff_setup'
    ) ||
    offenseStates.find(p => p.slot === 'RB1') ||
    offenseStates.find(p => p.isBallCarrier);

    const runLanePoint =
        runCarrierForBlocking?.routePath?.[
            (runCarrierForBlocking.routePath?.length || 1) - 1
        ];

    const runLaneX =
        runLanePoint?.x ??
        runCarrierForBlocking?.x ??
        CENTER_X;

    const assignBlockerTarget = (blocker, threats) => {
        if (blocker.isEngaged) return;
        if (playType === 'run' && Number.isFinite(runLaneX)) {
            blocker.blockLaneX = runLaneX;
        }
        const isScreenPlay = playState.playKey?.includes('Screen');

        if (isScreenPlay && blocker.assignment?.includes('Wall')) {
            if (playState.tick < 25) {
                blocker.targetX = blocker.initialX;
                blocker.targetY = blocker.y - 1.5;
                blocker.contactReduction = 0.5;
                return;
            } else {
                const targetRec = playState.activePlayers.find(p => p.assignment === 'Screen_Wait');
                if (targetRec) {
                    blocker.targetX = targetRec.x + (blocker.initialX > CENTER_X ? -3 : 3);
                    blocker.targetY = targetRec.y + 3.0;
                    blocker.action = 'run_path';
                    blocker.contactReduction = 1.4;
                    return;
                }
            }
        }

        const isPulling = Boolean(
            blocker.routePath &&
            blocker.currentPathIndex < blocker.routePath.length
        );

        // A pulling lineman must complete the designed path before
        // choosing a defender to block.
        if (playType === 'run' && isPulling) {
            const pullPoint = blocker.routePath[blocker.currentPathIndex];

            if (pullPoint) {
                blocker.action = 'run_path';
                blocker.targetX = pullPoint.x;
                blocker.targetY = pullPoint.y;

                setRouteIntent(
                    blocker,
                    pullPoint.x,
                    pullPoint.y,
                    0.6
                );
                return;
            }
        }

        const VISION_RANGE = isPulling ? 2.0 : 10.0;
        const validThreats = threats.filter(t =>
            !assignedThreats.has(t.id) &&
            getDistance(blocker, t) < VISION_RANGE &&
            t.y > blocker.y - 1.5
        );

        let target = null;
        const isPassPlay = playType === 'pass';

        const blockerProfile = getDecisionProfile(blocker, playState.tick);
        const blockerIQ = blockerProfile?.awareness ?? (blocker.playbookIQ || blocker.iq || 50);
        const qb = offenseStates.find(p => p.slot.startsWith('QB'));

        let sortedThreats = validThreats.sort((a, b) => {
            const laneDiffA = Math.abs(a.x - blocker.initialX);
            const laneDiffB = Math.abs(b.x - blocker.initialX);

            // IQ Layer: Smart linemen (IQ > 60) identify interior A/B gap blitzes threatening the QB
            let dangerPriorityA = 0;
            let dangerPriorityB = 0;

            if (blockerIQ > 55 && qb) {
                const distToQBA = Math.hypot(a.x - qb.x, a.y - qb.y);
                const distToQBB = Math.hypot(b.x - qb.x, b.y - qb.y);
                const iqWeight = (blockerIQ - 50) * 0.35;

                if (distToQBA < 4.5) dangerPriorityA -= (5.0 - distToQBA) * iqWeight;
                if (distToQBB < 4.5) dangerPriorityB -= (5.0 - distToQBB) * iqWeight;

                // High IQ centers/guards prioritize A-gap rushers over outside stunts
                if (Math.abs(a.x - CENTER_X) < 2.5 && (a.assignment?.includes('blitz') || a.assignment?.includes('rush'))) dangerPriorityA -= 8;
                if (Math.abs(b.x - CENTER_X) < 2.5 && (b.assignment?.includes('blitz') || b.assignment?.includes('rush'))) dangerPriorityB -= 8;
            }

            // TEAM PRIORITY:
            // On pass plays, protect the QB first. Rushers closest to the QB,
            // especially through the interior, receive higher blocking priority.
            let pocketPriorityA = 0;
            let pocketPriorityB = 0;

            if (isPassPlay && qb) {
                const qbDistA = getDistance(a, qb);
                const qbDistB = getDistance(b, qb);

                if (qbDistA < 7.0) {
                    pocketPriorityA -= (7.0 - qbDistA) * 3.0;
                }

                if (qbDistB < 7.0) {
                    pocketPriorityB -= (7.0 - qbDistB) * 3.0;
                }

                const interiorThreatA =
                    a.y >= qb.y &&
                    Math.abs(a.x - qb.x) < 3.0;

                const interiorThreatB =
                    b.y >= qb.y &&
                    Math.abs(b.x - qb.x) < 3.0;

                if (interiorThreatA) pocketPriorityA -= 3.0;
                if (interiorThreatB) pocketPriorityB -= 3.0;
            }

            // On runs, favor defenders who can threaten the designed lane,
            // while still accounting for each lineman's starting alignment.
            let lanePriorityA = 0;
            let lanePriorityB = 0;
            const priorityLaneX = blocker.blockLaneX ?? runLaneX;

            if (!isPassPlay && Number.isFinite(priorityLaneX)) {
                lanePriorityA = Math.abs(a.x - priorityLaneX) * 0.75;
                lanePriorityB = Math.abs(b.x - priorityLaneX) * 0.75;
            }

            const avoidsUnneededDoubleTeam =
                blockerProfile &&
                blockerProfile.decisionQuality > 65 &&
                blockerProfile.assignmentDiscipline > 55;

            const doubleTeamPenaltyA = assignedThreats.has(a.id)
                ? (avoidsUnneededDoubleTeam ? 25 : 12)
                : 0;

            const doubleTeamPenaltyB = assignedThreats.has(b.id)
                ? (avoidsUnneededDoubleTeam ? 25 : 12)
                : 0;

            return (
                laneDiffA +
                dangerPriorityA +
                pocketPriorityA +
                lanePriorityA +
                doubleTeamPenaltyA
            ) - (
                laneDiffB +
                dangerPriorityB +
                pocketPriorityB +
                lanePriorityB +
                doubleTeamPenaltyB
            );
        });

        // FIX: Allow a locked target to remain valid up to 14 yards so blockers don't drop targets on small movements
        if (blocker.dynamicTargetId) {
            const currentThreat = threats.find(t =>
                t.id === blocker.dynamicTargetId &&
                !assignedThreats.has(t.id) &&
                !t.isEngaged &&
                !t.isBlocked &&
                getDistance(blocker, t) < 14.0 &&
                t.y > blocker.y - 2.0
            );
            if (currentThreat) {
                target = currentThreat;
                assignedThreats.add(target.id);
            }
        }
        if (!target && sortedThreats.length > 0) {
            target = sortedThreats[0];
            blocker.dynamicTargetId = target.id;
            assignedThreats.add(target.id);
        }

        // FIX 1: If an offensive lineman is UNCOVERED on a run play (or pancaked his man),
        // actively CLIMB to the second level to block a linebacker or safety ahead of the run!
        if (!target && (playType === 'run' || isPassCompleted)) {
            const laneX = blocker.blockLaneX ?? runLaneX;
            const secondLevelThreat = defenseStates
                .filter(d =>
                    !d.isBlocked &&
                    !d.isEngaged &&
                    !assignedThreats.has(d.id) &&
                    d.stunnedTicks === 0 &&
                    d.y > blocker.y - 0.5 &&
                    d.y < blocker.y + 8.0 &&
                    Math.abs(d.x - laneX) < 8.0
                )
                .sort((a, b) => getDistance(blocker, a) - getDistance(blocker, b))[0];

            if (secondLevelThreat) {
                target = secondLevelThreat;
                blocker.dynamicTargetId = target.id;
                assignedThreats.add(target.id);
            }
        }

        // FIX 2: If an offensive lineman is UNCOVERED in pass protection, LOOK FOR WORK!
        // Slide to double-team or help an adjacent teammate who is getting walked back in a bull rush.
        if (!target && isPassPlay && !isPassCompleted) {
            const strugglingBattle = playState.blockBattles?.find(b => 
                b.status === 'ongoing' && 
                b.blocker?.id !== blocker.id && 
                Math.abs((b.blocker?.x ?? 0) - blocker.x) < 2.5 &&
                (b.battleScore < 0 || b.loggedBullRush)
            );

            if (strugglingBattle && strugglingBattle.defender) {
                target = strugglingBattle.defender; // Assist teammate!
            }
        }

        if (target) {
            if (target.isEngaged && target.blockedBy?.id !== blocker.id) {
                // Assisting on a double team: push into the engaged defender
                blocker.targetX = target.x;
                blocker.targetY = target.y - 0.4;
                blocker.action = isPassPlay ? 'pass_block' : 'run_block';
                setPointIntent(blocker, blocker.targetX, blocker.targetY, 0.4);
                return;
            }

            if (isPassPlay && !isPassCompleted) {
                const qb = offenseStates.find(p => p.slot.startsWith('QB'));
                if (qb) {
                    const dx = qb.x - target.x;
                    const dy = qb.y - target.y;
                    const distToQB = Math.max(0.1, Math.hypot(dx, dy));
                    blocker.targetX = target.x + (dx / distToQB) * 0.8;
                    blocker.targetY = target.y + (dy / distToQB) * 0.8;
                    if (blocker.targetY < qb.y + 1.5) blocker.targetY = qb.y + 1.5;
                    blocker.contactReduction = 1.3;
                }
            } else {
                // Run blockers approach the defender from the side away from the designed running lane.
                const laneX = blocker.blockLaneX ?? runLaneX;

                if (Number.isFinite(laneX)) {
                    const defenderX = target.x;
                    let sealDirection = defenderX < laneX ? -1 : 1;

                    if (Math.abs(defenderX - laneX) < 0.6) {
                        sealDirection = blocker.initialX < laneX ? -1 : 1;
                    }

                    blocker.targetX = defenderX + (sealDirection * 0.65);
                    blocker.targetY = target.y + 0.2;
                } else {
                    blocker.targetX = target.x;
                    blocker.targetY = target.y;
                }

                blocker.contactReduction = 1.2;
            }

            if (getDistance(blocker, target) < 1.8 && !target.isEngaged) {
                const strDiff = (blocker.str || 50) - (target.str || 50);
                blocker.isEngaged = true;
                blocker.engagedWith = target;
                target.isEngaged = true;
                target.isBlocked = true;
                target.blockedBy = blocker;

                playState.blockBattles.push({
                    blocker, defender: target,
                    status: 'ongoing',
                    battleScore: strDiff / 10,
                    startTick: playState.tick
                });
            }
        } else {
            // FIX 3: If no threat exists, advance with the play instead of freezing at pre-snap initialX!
            if (playType === 'run' || isPassCompleted) {
                // DEEPER FIX: Set the target far downfield so the blocker sprints instead of stutter-stepping
                blocker.targetX = blocker.x;
                blocker.targetY = Math.min(115, blocker.y + 15.0); // 15 yards ahead
                blocker.action = 'run_block';
                setPointIntent(blocker, blocker.targetX, blocker.targetY, 0.4);
            } else {
                // In pass pro with no rusher, anchor the pocket front
                const qb = offenseStates.find(p => p.slot.startsWith('QB'));
                blocker.targetX = blocker.initialX;
                blocker.targetY = qb ? Math.max(LOS - 2.5, qb.y + 2.0) : (LOS - 1.5);
                setPointIntent(blocker, blocker.targetX, blocker.targetY, 0.35);
            }
        }
    };

    linemen.forEach(ol => assignBlockerTarget(ol, allThreats));
    otherBlockers.forEach(b => assignBlockerTarget(b, allThreats));

    playState.activePlayers.forEach(pState => {
        if (pState.stunnedTicks > 0) return;
        if (pState.isBlocked || pState.isEngaged) return;

        if (playType === 'punt') {
            const isKickingTeam = pState.isOffense;
            const isReturnTeam = !pState.isOffense;
            const ballInAir = playState.ballState.inAir;
            const returnerHasBall = ballCarrierState && !ballCarrierState.isOffense;

            if (isKickingTeam) {
                if (!ballInAir && !returnerHasBall && playState.tick < 26) {
                    if (pState.slot === 'QB1') return;
                    const nearestRusher = defenseStates.find(d => getDistance(pState, d) < 5);
                    if (nearestRusher) {
                        pState.targetX = nearestRusher.x;
                        pState.targetY = Math.min(LOS, nearestRusher.y - 1);
                    } else {
                        pState.targetX = pState.initialX;
                        pState.targetY = LOS - 1;
                    }
                    return;
                }
                pState.action = 'pursuit';
                if (returnerHasBall) {
                    const dist = getDistance(pState, ballCarrierState);
                    const lead = dist / 15;
                    pState.targetX = ballCarrierState.x + (ballCarrierState.velocity?.x || 0) * lead;
                    pState.targetY = ballCarrierState.y + (ballCarrierState.velocity?.y || 0) * lead;
                } else {
                    // Maintain punt coverage lanes instead of clustering on the exact landing spot
                    const ballTargetX = ballPos.targetX || ballPos.x;
                    const laneDrift = ballTargetX > pState.initialX ? 1.5 : -1.5;
                    
                    pState.targetX = pState.initialX + laneDrift;
                    pState.targetY = ballPos.targetY || ballPos.y;
                }
                return;
            }

                if (isReturnTeam) {
                // The actual returner fields the punt. Everyone else prepares
                // the blocking wall, then looks for a kick-coverage defender.
                if (pState.isBallCarrier) return;

                // FIX: Before the ball is kicked, hold positions near the line of scrimmage
                if (!ballInAir && !returnerHasBall) {
                    const isDeepReturner = pState.slot === 'DB3' || pState.slot === 'DB4';
                    if (!isDeepReturner) {
                        pState.targetX = pState.initialX;
                        pState.targetY = Math.max(LOS + 2.0, pState.initialY);
                        pState.action = 'run_block';
                        setHoldIntent(pState, pState.targetX, pState.targetY);
                        return;
                    }
                }

                const primaryReturner =
                    playState.activePlayers.find(
                        p => !p.isOffense && p.slot === 'DB3'
                    ) ||
                    playState.activePlayers.find(
                        p => !p.isOffense && p.slot === 'DB4'
                    );

                if (ballInAir) {
                    const landX = Number.isFinite(ballPos.targetX)
                        ? ballPos.targetX
                        : ballPos.x;
                    const landY = Number.isFinite(ballPos.targetY)
                        ? ballPos.targetY
                        : ballPos.y;

                    if (pState.id === primaryReturner?.id) {
                        // FIX: Returner tracks directly to the landing spot and settles directly under the ball
                        pState.targetX = landX;
                        pState.targetY = landY;
                        pState.action = 'tracking_ball'; // Enables catch radius boost in collisions.js
                        setPointIntent(pState, landX, landY, 0.25); // Smoothly glides to the exact spot without freezing 2 yards away
                    } else {
                        // Establish a staggered wall instead of crowding the catch.
                        const xOffset =
                            (pState.initialX - CENTER_X) * 0.55;
                        const isUpReturner = pState.slot === 'DB4';
                        const depthAhead = isUpReturner ? 6 : 12;

                        pState.targetX = Math.max(
                            1,
                            Math.min(52.3, landX + xOffset)
                        );
                        pState.targetY = Math.max(10, landY - depthAhead);
                        pState.action = 'run_block';
                    }

                    return;
                }

                if (returnerHasBall) {
                    const returnerY = ballCarrierState.y;

                    // The return runs toward decreasing Y. Find kick coverage
                    // in the lane ahead of the returner, not only within 5 yards.
                    const threat = offenseStates
                        .filter(e =>
                            !e.isBlocked &&
                            !e.isEngaged &&
                            e.y < returnerY + 2 &&
                            e.y > returnerY - 22
                        )
                        .sort(
                            (a, b) =>
                                getDistance(pState, a) -
                                getDistance(pState, b)
                        )[0];

                    if (threat) {
                        pState.targetX = threat.x;
                        pState.targetY = threat.y;
                        pState.action = 'run_block';

                        if (getDistance(pState, threat) < 2.0) {
                            pState.isEngaged = true;
                            pState.engagedWith = threat;
                            threat.isEngaged = true;
                            threat.isBlocked = true;
                            threat.blockedBy = pState;

                            playState.blockBattles.push({
                                blocker: pState,
                                defender: threat,
                                status: 'ongoing',
                                battleScore: 0,
                                startTick: playState.tick
                            });
                        }
                    } else {
                        // No immediate threat: escort the carrier on the
                        // scoring side, rather than running into the carrier.
                        pState.targetX = ballCarrierState.x +
                            (pState.x < ballCarrierState.x ? -3 : 3);
                        pState.targetY = ballCarrierState.y - 3;
                        pState.action = 'run_block';
                    }

                    return;
                }

                // Safe fallback if there is no active carrier yet.
                const landX = Number.isFinite(ballPos.targetX)
                    ? ballPos.targetX
                    : ballPos.x;
                const landY = Number.isFinite(ballPos.targetY)
                    ? ballPos.targetY
                    : 20;
                const xOffset = (pState.initialX - CENTER_X) * 0.55;

                pState.targetX = Math.max(
                    1,
                    Math.min(52.3, landX + xOffset)
                );
                pState.targetY = Math.max(10, landY - 8);
                pState.action = 'run_block';
                return;
            }
        }

        if (pState.isOffense) {
            const isRunner = pState.isBallCarrier || (pState.slot === 'QB1' && pState.action === 'qb_scramble');

            if (isRunner) {
                pState.isBallCarrier = true;

                // During the flea-flicker's fake run, follow the designed
                // RB route instead of switching immediately to open-field AI.
                if (
                    playState.playKey === 'Trick_Flea_Flicker' &&
                    playState.fleaFlickerPhase === 'rb_fake_run' &&
                    pState.slot === 'RB1'
                ) {
                    const routePath = pState.routePath || [];

                    if (pState.currentPathIndex < routePath.length) {
                        const routePoint = routePath[pState.currentPathIndex];

                        if (getDistance(pState, routePoint) < 0.65) {
                            pState.currentPathIndex++;
                        }
                    }

                    const nextPoint = routePath[pState.currentPathIndex];

                    if (nextPoint) {
                        pState.action = 'run_path';
                        pState.targetX = nextPoint.x;
                        pState.targetY = nextPoint.y;

                        setRouteIntent(
                            pState,
                            nextPoint.x,
                            nextPoint.y,
                            0.6
                        );
                    } else {
                        setHoldIntent(pState, pState.x, pState.y);
                    }

                    return;
                }       
                
                
                let targetX = pState.x;
                let targetY = pState.y;

                const nearbyDefenders = defenseStates.filter(d => !d.isBlocked && d.stunnedTicks === 0);
                const immediateThreat = nearbyDefenders.sort((a, b) => getDistance(pState, a) - getDistance(pState, b))[0];

                if (pState.action === 'trucking') {
                    if (!immediateThreat || getDistance(pState, immediateThreat) > 3.0) {
                        pState.action = 'run_path';
                    }
                }

                const pt = (pState.routePath && pState.currentPathIndex < pState.routePath.length) 
                    ? pState.routePath[pState.currentPathIndex] 
                    : null;

                // Check if an engaged blocker or penetrating defender is standing directly in the designed hole
                const holeClogged = pt && (
                    offenseStates.some(o =>
                        o.id !== pState.id &&
                        !o.action?.includes('block') &&
                        !/pull|lead/i.test(o.assignment || '') &&
                        o.action !== 'run_path' &&
                        Math.abs(o.x - pt.x) < 0.55 &&
                        Math.abs(o.y - pt.y) < 0.85
                    ) ||
                    defenseStates.some(d =>
                        !d.isBlocked &&
                        !d.isEngaged &&
                        d.stunnedTicks <= 0 &&
                        d.y > pState.y - 0.5 &&
                        d.y <= pt.y + 2.0 &&
                        getDistance(d, pt) < 2.25
                    )
                );

                const isRunHolePhase = playType === 'run' &&
                    pState.role === 'RB' &&
                    pt !== null &&
                    pState.y < LOS + 1.0 &&
                    !holeClogged &&
                    playState.tick < (pState._handoffTick || 18) + 12;

                if (isRunHolePhase) {
                    // 1. Designed run through the open hole
                    targetX = pt.x;
                    targetY = pt.y;
                    if (getDistance(pState, pt) < 1.5) {
                        pState.currentPathIndex++;
                    }
                    pState.action = 'run_path';
                    pState.contactReduction = 1.15;
                    setRouteIntent(pState, targetX, targetY, 0.6);
                } else if (pState.role === 'QB' && pState.action === 'qb_scramble' && pState.y < LOS) {
                    // 2. QB Scramble behind LOS: Angle wide to escape the pocket.
                    // The designed bootleg rolls right to a fixed launch point.
                    if (playState.playKey === 'PA_Bootleg_Right') {
                        const rolloutTargetX = Math.max(
                            3,
                            Math.min(FIELD_WIDTH - 3, pState.initialX + 5.5)
                        );

                        const rolloutTargetY = Math.min(
                            LOS - 1.2,
                            pState.initialY + 2.0
                        );

                        const rolloutDistance = Math.hypot(
                            pState.x - rolloutTargetX,
                            pState.y - rolloutTargetY
                        );

                        pState.action = 'qb_scramble';

                        if (rolloutDistance <= 0.85) {
                            pState._bootlegRolloutReady = true;
                            targetX = pState.x;
                            targetY = pState.y;
                            setHoldIntent(pState, targetX, targetY);
                        } else {
                            targetX = rolloutTargetX;
                            targetY = rolloutTargetY;
                            setPointIntent(pState, targetX, targetY, 0.5);
                        }
                    } else {
                        // Preserve the existing behavior for ordinary scrambles.
                        const rollDir = pState.rolloutDir || (pState.x > CENTER_X ? 1 : -1);
                        targetX = Math.max(3, Math.min(FIELD_WIDTH - 3, pState.x + (rollDir * 8)));
                        targetY = pState.y + 1.0;
                        pState.action = 'qb_scramble';
                        setPointIntent(pState, targetX, targetY, 0.5);
                    }
                } else {
                    // 3. Open-field running with lane locking
                    if (pState.role === 'QB' && pState.action === 'qb_scramble') {
                        pState.action = 'run_path'; // DEEPER FIX: Transition to pure runner once past the LOS
                    }
                    const smartTarget = getSmartCarrierTarget(
                        pState,
                        defenseStates,
                        offenseStates,
                        FIELD_WIDTH,
                        playState
                    );

                    targetX = smartTarget.x;
                    targetY = smartTarget.y;

                    pState.action =
                        smartTarget.action === 'trucking'
                            ? 'trucking'
                            : 'run_path';

                    setLaneIntent(
                        pState,
                        targetX,
                        targetY,
                        pState._laneLockTicks || 10
                    );

                    // Restored: Crowd slowdown when fighting through traffic
                    const defendersNear = defenseStates.filter(d => getDistance(pState, d) < 2.5).length;
                    if (pState.action !== 'trucking') {
                        pState.contactReduction = defendersNear > 1 ? 0.85 : 1.0;
                    }
                }

                pState.targetX = targetX;
                pState.targetY = targetY;
                return;
            }

            if (isBallInAir && !playState.ballState.isThrowAway) {
                const isIntendedTarget = (playState.ballState.targetPlayerId === pState.id);
                const iq = pState.playbookIQ || 50;
                const flightTime = playState.tick - (playState.ballState.throwTick || 0);
                const reactionDelay = isIntendedTarget ? 2 : Math.max(5, 20 - Math.floor(iq / 5));

                if (flightTime > reactionDelay) {
                    const distToLanding = Math.hypot(pState.x - playState.ballState.targetX, pState.y - playState.ballState.targetY);
                    if (isIntendedTarget || distToLanding < 8.0) {
                        setPointIntent(pState, playState.ballState.targetX, playState.ballState.targetY, 0.4);
                        pState.action = 'tracking_ball';
                        pState.contactReduction = 1.1 + ((pState.agility || 50) / 250);
                        return;
                    }
                }
            }

            if (
                pState.role === 'QB' &&
                playState.handoffOccurred &&
                !pState.hasBall &&
                playState.fleaFlickerPhase !== 'return_pitch'
            ) {
                const driftSide = pState.initialX > CENTER_X ? 1 : -1;
                setPointIntent(pState, pState.initialX + (driftSide * 2), playState.lineOfScrimmage - 5.0, 0.4);
                pState.action = 'idle';
                pState.ghostTicks = 20;
                return;
            }

            if (!pState.action) {
                pState.action = 'idle';
                setHoldIntent(pState, pState.initialX, pState.initialY);
            }

            switch (pState.action) {
                case 'handoff_setup':
                case 'handoff_receive':
                    setPointIntent(pState, pState.targetX, pState.targetY, 0.35);
                    break;

                case 'pass_block':
                case 'run_block':
                    setPointIntent(pState, pState.targetX, pState.targetY, 0.35);
                    break;

                case 'run_path':
                case 'run_fake': {
                    const hasNextPoint =
                        pState.routePath &&
                        pState.currentPathIndex < pState.routePath.length;

                    if (hasNextPoint) {
                        const pt = pState.routePath[pState.currentPathIndex];

                        if (getDistance(pState, pt) < 0.65) {
                            pState.currentPathIndex++;
                        }

                        const nextPt = pState.routePath[pState.currentPathIndex];

                        if (nextPt) {
                            setRouteIntent(pState, nextPt.x, nextPt.y, 0.6);
                        } else if (pState.slot?.startsWith('OL')) {
                            // Puller has reached his designed path and can engage
                            // the blocker target assigned earlier this tick.
                            setPointIntent(
                                pState,
                                pState.targetX ?? pState.x,
                                pState.targetY ?? pState.y,
                                0.5
                            );
                        } else {
                            setHoldIntent(pState, pState.x, pState.y);
                        }
                    } else {
                        setPointIntent(
                            pState,
                            pState.targetX ?? pState.x,
                            pState.targetY ?? pState.y,
                            0.5
                        );
                    }

                    break;
                }

                case 'qb_setup': {
                    const qbIQ = pState.playbookIQ || 50;

                    // DROPBACK PHASE
                    if (!pState.hasCompletedDropback) {
                        setPointIntent(pState, pState.initialX, pState.dropbackTargetY, 0.35);
                        pState.contactReduction = 1.4;

                        const distToDrop = Math.abs(pState.y - pState.dropbackTargetY);
                        if (distToDrop < 0.35 || pState.y <= (pState.dropbackTargetY + 0.1)) {
                            pState.hasCompletedDropback = true;
                            pState.dropbackPhase = 'set';
                            pState._pocketAnchorX = pState.initialX;
                            pState._pocketAnchorY = pState.dropbackTargetY;
                            setHoldIntent(pState, pState.initialX, pState.dropbackTargetY);
                        }
                        break;
                    }

                    pState.contactReduction = 1.0;
                    let idealX = pState._pocketAnchorX !== undefined ? pState._pocketAnchorX : pState.initialX;
                    let idealY = pState._pocketAnchorY !== undefined ? pState._pocketAnchorY : pState.dropbackTargetY;

                    const unblockedRushers = defenseStates.filter(d =>
                        !d.isBlocked &&
                        !d.isEngaged &&
                        d.stunnedTicks === 0 &&
                        getDistance(pState, d) < 5.5
                    );

                    const collapsingDefenders = defenseStates.filter(d =>
                        d.isEngaged && getDistance(pState, d) < 3.0
                    );

                    // Evaluate the closest immediate threat, not whichever
                    // defender happens to appear first in the array.
                    const nearestImmediateThreat = unblockedRushers
                        .map(defender => ({
                            defender,
                            distance: getDistance(pState, defender)
                        }))
                        .filter(entry => entry.distance < 3.2)
                        .sort((a, b) => a.distance - b.distance)[0];

                    const immediateThreat = nearestImmediateThreat?.defender ?? null;
                    const immediateThreatDistance =
                        nearestImmediateThreat?.distance ?? Infinity;

                    // Scrambling should depend on athletic mobility, not IQ alone.
                    const qbMobility =
                        ((pState.agility || pState.agi || 50) * 0.55) +
                        ((pState.speed || pState.spd || 50) * 0.45);

                    const shouldEmergencyScramble = Boolean(
                        immediateThreat &&
                        (
                            (qbMobility >= 68 && immediateThreatDistance <= 3.2) ||
                            (qbMobility >= 55 && immediateThreatDistance <= 2.0)
                        )
                    );

                    if (shouldEmergencyScramble) {
                        if (!pState.rolloutDir) {
                            pState.rolloutDir =
                                immediateThreat.x > pState.x ? -1 : 1;
                        }

                        pState.action = 'qb_scramble';
                        pState.isBallCarrier = true;
                        playState.qbIntent = 'scramble';

                        setPointIntent(
                            pState,
                            pState.x + (pState.rolloutDir * 7),
                            pState.y + 1.5,
                            0.5
                        );

                        pState.loggedRollout = true;

                        if (gameLog) {
                            pushGameLog(
                                gameLog,
                                `[Tick ${playState.tick}] 🏃 ${pState.name} senses immediate pressure and scrambles!`,
                                playState
                            );
                        }

                        break;
                    }

                    const edgePressureLeft = defenseStates.some(d => d.x < pState.x - 2.5 && getDistance(pState, d) < 4.5);
                    const edgePressureRight = defenseStates.some(d => d.x > pState.x + 2.5 && getDistance(pState, d) < 4.5);
                    const interiorClean = !defenseStates.some(d => Math.abs(d.x - pState.x) <= 2.0 && d.y > pState.y && d.y < LOS);

                    if ((edgePressureLeft || edgePressureRight || collapsingDefenders.length > 0) && interiorClean && qbIQ > 45) {
                        idealY = Math.min(LOS - 1.2, pState.dropbackTargetY + 2.0);
                        if (pState._lastPocketAction !== 'climb') {
                            logPlayDebug('QB_POCKET_MOVE', `${pState.name} steps up into the clean pocket`, { targetY: Number(idealY.toFixed(1)) });
                            pState._lastPocketAction = 'climb';
                        }
                    }

                    if (pState._pocketSlideLock > 0) {
                        pState._pocketSlideLock--;
                        break;
                    }

                    if (unblockedRushers.length > 0 && qbIQ > 40) {
                        let desiredX = idealX;
                        let desiredY = idealY;
                        let leftPressure = 0;
                        let rightPressure = 0;
                        let upTheMiddle = 0;

                        unblockedRushers.forEach(r => {
                            const dx = r.x - pState.x;
                            const dy = r.y - pState.y;
                            const dist = Math.max(0.1, Math.hypot(dx, dy));
                            const threatLevel = 10 / dist;
                            if (dx < -1.5) leftPressure += threatLevel;
                            if (dx > 1.5) rightPressure += threatLevel;
                            if (Math.abs(dx) <= 1.5 && dy > 0) upTheMiddle += threatLevel;
                        });

                        const pressureDiff = rightPressure - leftPressure;

                        if (Math.abs(pressureDiff) > 2.0) {
                            desiredX -= Math.sign(pressureDiff) * Math.min(2.5, Math.abs(pressureDiff));
                        }

                        if ((leftPressure > 2.0 || rightPressure > 2.0) && upTheMiddle < 1.5 && qbIQ > 65) {
                            desiredY += 3.0;
                        } else if (upTheMiddle > 2.0) {
                            desiredY -= 2.0;
                        }

                        const targetX = Math.max(pState.initialX - 6, Math.min(pState.initialX + 6, desiredX));
                        const targetY = Math.max(LOS - 12.0, Math.min(LOS - 1, desiredY));

                        setPointIntent(pState, targetX, targetY, 0.35);
                        pState._pocketSlideLock = 10;
                    } else {
                        setHoldIntent(pState, idealX, idealY);
                    }
                    break;
                }

                case 'run_route': {
                    if (!pState.routePath || pState.currentPathIndex >= pState.routePath.length) {
                        pState.action = 'route_complete';
                        break;
                    }

                    const playKey = playState.playKey || '';
                    const offTeam = playState.offenseTeam || game?.teams?.find(t => t && t.id === pState.teamId);
                    const mastery = offTeam?.gameplan?.mastery?.[playKey] ?? 70;

                    if (mastery < 45 && playState.tick === 12 && pState.currentPathIndex === 0) {
                        if (Math.random() < 0.22) {
                            pState.stunnedTicks = 4;
                            if (gameLog && Math.random() < 0.15) {
                                pushGameLog(gameLog, `⚠️ [Tick ${playState.tick}] ${pState.name} hesitates on unfamiliar route assignment!`, playState);
                            }
                        }
                    }

                    const pt = pState.routePath[pState.currentPathIndex];
                    const distToNode = getDistance(pState, pt);
                    const isFinalNode = pState.currentPathIndex === pState.routePath.length - 1;
                    const isSettleRoute = ['Hitch', 'Curl', 'Dig', 'In', 'Drag', 'Slant'].some(r => pState.assignment?.includes(r));
                    const receiverProfile = getDecisionProfile(pState, playState.tick);
                    const recIQ = receiverProfile?.awareness ?? (pState.playbookIQ || pState.iq || 50);
                    
                    // IQ Layer: High IQ receivers (IQ >= 60) read zone voids and throttle down in windows
                    // Low IQ receivers run blindly into zone defenders
                    if (
                        isSettleRoute &&
                        distToNode < 2.0 &&
                        recIQ >= 60 &&
                        receiverProfile.decisionQuality >= 55 &&
                        receiverProfile.assignmentDiscipline >= 35
                    ) {
                        const nearbyZoneDefenders = defenseStates.filter(d =>
                            !d.isBlocked && d.y >= LOS + 2.0 && getDistance(pState, d) < 3.2
                        );

                        if (nearbyZoneDefenders.length > 0) {
                            if (pState._hookDriftX === undefined) {
                                const nearest = nearbyZoneDefenders.sort((a, b) => getDistance(pState, a) - getDistance(pState, b))[0];
                                const driftDirX = pState.x > nearest.x ? 1.0 : -1.0;
                                const iqSettlingSpace = 0.8 + ((recIQ - 60) / 40) * 0.8;
                                pState._hookDriftX = pState.x + (driftDirX * iqSettlingSpace);
                                pState._hookDriftY = Math.max(LOS + 1.0, pState.y - 0.4);
                            }
                            setPointIntent(pState, pState._hookDriftX, pState._hookDriftY, 0.3);
                            pState.contactReduction = 0.6;
                            break;
                        }
                    }

                    pState.contactReduction = distToNode < 1.0 ? 0.8 : 1.0;

                    // Only count passing the waypoint vertically when the player
                    // is also physically close to it. Crossing its Y-coordinate
                    // from far away horizontally must not skip the route segment.
                    const hasPassedNodeY =
                        (pState.vy > 0 && pState.y >= pt.y) ||
                        (pState.vy < 0 && pState.y <= pt.y);

                    const passedNodeY =
                        hasPassedNodeY &&
                        Math.abs(pState.y - pt.y) <= 1.5 &&
                        Math.abs(pState.x - pt.x) <= 1.5;

                    // A stalled receiver may advance only when already near the
                    // waypoint. Never skip a distant waypoint just because
                    // movement has made little progress for several ticks.
                    const stalledNearNode =
                        pState._routeWaypointStallTicks > 12 &&
                        distToNode < 2.5;

                    if (
                        distToNode < 0.65 ||
                        passedNodeY ||
                        stalledNearNode
                    ) {
                        pState.currentPathIndex++;
                        pState._routeWaypointStallTicks = 0;

                        // Case A: Still running route -> immediately target next node without 1-tick lag
                        if (pState.currentPathIndex < pState.routePath.length) {
                            const nextPt = pState.routePath[pState.currentPathIndex];
                            setRouteIntent(pState, nextPt.x, nextPt.y, 0.6);
                        } else {
                            // Case B: Final node reached -> immediately transition to route_complete and hold station
                            pState.action = 'route_complete';
                            setHoldIntent(pState, pt.x, pt.y);
                        }

                        // --- ROUTE BREAK & CUT REACTIONS ---
                        const isDoubleMoveRoute = [
                            'Sluggo',
                            'Out_And_Up',
                            'Hitch_And_Go',
                            'PostCorner'
                        ].some(r => pState.assignment?.includes(r));

                        // Evaluate double-move reactions only when transitioning
                        // into the final route segment, not at every waypoint.
                        const isDesignatedDoubleMoveBreak =
                            isDoubleMoveRoute &&
                            pState.routePath?.length > 1 &&
                            pState.currentPathIndex === pState.routePath.length - 1;

                        const coverageDefender = defenseStates.find(d =>
                            (d.assignment?.includes(pState.slot) || d.assignedPlayerSlot === pState.slot) &&
                            getDistance(pState, d) < 5.0
                        );

                        if (coverageDefender && (!isDoubleMoveRoute || isDesignatedDoubleMoveBreak)) {
                            const wrAgility = pState.agility || 50;
                            const dbAgility = coverageDefender.agility || 50;
                            const dbIQ = coverageDefender.playbookIQ || 50;
                            const wrStrength = pState.strength || 50;
                            const dbStrength = coverageDefender.strength || 50;

                            const isDoubleMove = isDoubleMoveRoute;
                            let separated = false;

                            // 1. Playground Double-Move Trap
                            if (isDoubleMove && dbIQ < 60 && Math.random() < 0.65) {
                                coverageDefender.stunnedTicks = Math.max(14, 30 - Math.floor(dbIQ / 3));
                                coverageDefender.vx = 0;
                                coverageDefender.vy = 0;
                                separated = true;

                                logPlayDebug('ROUTE_DOUBLE_MOVE', `${pState.name} froze ${coverageDefender.name} on double move`, {
                                    dbIQ,
                                    routeType: pState.assignment,
                                    stunDurationTicks: coverageDefender.stunnedTicks
                                });

                                if (gameLog && Math.random() < 0.35) {
                                    pushGameLog(gameLog, `[Tick ${playState.tick}] 🎣 ${coverageDefender.name} completely bites on ${pState.name}'s double move!`, playState);
                                }
                            }

                            // 2. Uncalled Playground Shove
                            if (!separated && wrStrength > dbStrength + 8 && Math.random() < 0.35) {
                                const pushDx = (coverageDefender.x - pState.x) || 1;
                                const pushDy = (coverageDefender.y - pState.y) || 1;
                                const pushDist = Math.max(0.1, Math.hypot(pushDx, pushDy));
                                coverageDefender.x += (pushDx / pushDist) * 1.6;
                                coverageDefender.y += (pushDy / pushDist) * 1.6;
                                coverageDefender.stunnedTicks = 12;
                                separated = true;
                                if (gameLog && Math.random() < 0.3) {
                                    pushGameLog(gameLog, `[Tick ${playState.tick}] 💪 ${pState.name} gives ${coverageDefender.name} an uncalled playground shove at the break!`, playState);
                                }
                            }

                            // 3. Momentum Overshoot on the Cut
                            if (!separated) {
                                const shakeChance = (wrAgility / (dbAgility + 10)) * (1.2 - (dbIQ / 150));
                                if (Math.random() < shakeChance * 0.45) {
                                    coverageDefender.stunnedTicks = Math.max(8, 22 - Math.floor(dbIQ / 5));
                                    coverageDefender.x += (coverageDefender.vx || 0) * 0.7;
                                    coverageDefender.y += (coverageDefender.vy || 0) * 0.7;
                                    if (gameLog && Math.random() < 0.25) {
                                        pushGameLog(gameLog, `[Tick ${playState.tick}] 💨 ${pState.name} shakes ${coverageDefender.name} on the cut!`, playState);
                                    }
                                }
                            }
                        }

                        const masteryBurst = mastery >= 80 ? 1.08 : 1.04;
                        pState.vx *= masteryBurst;
                        pState.vy *= masteryBurst;
                    } else {
                        // Still tracking toward current waypoint
                        setRouteIntent(pState, pt.x, pt.y, 0.6);
                    }
                    break;
                }

                case 'route_complete': {
                    // FIX: If a pass is caught by another teammate, turn into a downfield escort blocker
                    if (isPassCompleted && ballCarrierState && ballCarrierState.id !== pState.id) {
                        pState.action = 'run_block';
                        pState.targetX = ballCarrierState.x + (pState.x < ballCarrierState.x ? -2.5 : 2.5);
                        // If the receiver is already ahead of the carrier, keep pushing downfield to clear the way
                        const escortDepth = ballCarrierState.y + 4.0;
                        pState.targetY = Math.max(pState.y + 2.0, escortDepth);
                        setPointIntent(pState, pState.targetX, pState.targetY, 0.5);
                        break;
                    }

                    if (qbState && (qbState.action === 'qb_scramble' || playState.qbIntent === 'scramble')) {
                        const rolloutDir = qbState.rolloutDir || (qbState.x > CENTER_X ? 1 : -1);
                        const iq = pState.playbookIQ || 50;
                        const decision = pState.decisionMaking || 50;

                        if (!pState._scrambleReactionTick) {
                            const delayTicks = Math.max(2, Math.round(25 - ((iq + decision) / 5)));
                            pState._scrambleReactionTick = playState.tick + delayTicks;
                        }
                        if (playState.tick < pState._scrambleReactionTick) {
                            setHoldIntent(pState, pState.x, pState.y);
                            break;
                        }

                        const scanInterval = Math.max(10, Math.round(40 - (iq * 0.3)));
                        if (pState._scrambleTargetX === undefined || playState.tick % scanInterval === 0) {
                            const visionWidth = 4.0 + (iq * 0.05);
                            const candidates = [
                                { x: pState.x + (rolloutDir * visionWidth), y: pState.y + 2.0 },
                                { x: pState.x - (rolloutDir * 2.0), y: pState.y + 3.0 },
                                { x: qbState.x + (rolloutDir * 4.0), y: Math.max(LOS + 3, qbState.y + 2.0) },
                                { x: pState.x, y: pState.y + 5.0 }
                            ];

                            let bestX = pState.x;
                            let bestY = pState.y;
                            let maxOpenScore = -Infinity;

                            candidates.forEach(pt => {
                                if (pt.x < 2 || pt.x > FIELD_WIDTH - 2 || pt.y < LOS || pt.y > 115) return;

                                let minDefDist = Infinity;
                                defenseStates.forEach(def => {
                                    const d = Math.hypot(pt.x - def.x, pt.y - def.y);
                                    if (d < minDefDist) minDefDist = d;
                                });

                                const decisionFlaw = decision < 50 ? (Math.random() - 0.5) * (60 - decision) * 0.15 : 0;
                                const qbDistancePenalty = Math.abs(pt.y - (qbState.y + 3)) * 0.4;
                                const score = (minDefDist + decisionFlaw) - qbDistancePenalty;

                                if (score > maxOpenScore) {
                                    maxOpenScore = score;
                                    bestX = pt.x;
                                    bestY = pt.y;
                                }
                            });

                            pState._scrambleTargetX = bestX;
                            pState._scrambleTargetY = bestY;
                        }

                        // FIX: Corrected typo "etPointIntent" -> "setPointIntent"
                        setPointIntent(pState, pState._scrambleTargetX, pState._scrambleTargetY, 0.45);
                        pState.contactReduction = 1.1;
                        break;
                    }

                    pState._scrambleReactionTick = undefined;

                    if (qbState) {
                        // FIX: Settle at current coordinates so forward momentum doesn't pull receiver backward
                        if (pState._settleTargetX === undefined) {
                            pState._settleTargetX = pState.x;
                            pState._settleTargetY = pState.y;
                        }
                        setHoldIntent(pState, pState._settleTargetX, pState._settleTargetY);
                    }
                    break;
                }

                default:
                    if (pState.isOffense) {
                        setHoldIntent(pState, pState.x, pState.y);
                    } else {
                        executeAssignment(pState, pState.assignment, offenseStates, LOS, playState, ballCarrierState);
                    }
                    break;
            }
            return;
        }

        if (!pState.isOffense) {
            // FIX: If a pass has been completed, all defenders alert to the ball carrier immediately
            if (isPassCompleted && ballCarrierState) {
                const dist = getDistance(pState, ballCarrierState);
                const leadTime = Math.min(1.2, Math.max(0.3, dist / 16));
                let predX = ballCarrierState.x + ((ballCarrierState.vx || 0) * leadTime);
                let predY = ballCarrierState.y + Math.max(1.5, (ballCarrierState.vy || 0) * leadTime);

                const pursuitTargetY = getPursuitTargetY(
                    pState,
                    ballCarrierState,
                    predY
                );

                pState.targetX = predX;
                pState.targetY = pursuitTargetY;
                setPointIntent(pState, predX, pursuitTargetY, 0.5);
                pState.action = 'pursuit';
                return;
            }

            const defenderVision = getPerceptionContext(
                pState,
                playState.tick,
                14,
                21,
                3.2
            );

            const carrierPerception =
                ballCarrierState && !isBallInAir
                    ? getPerceptionWeight(defenderVision, ballCarrierState)
                    : 0;

            const runTargetPerception =
                primaryRunTarget && !isBallInAir
                    ? getPerceptionWeight(defenderVision, primaryRunTarget)
                    : 0;

            const isDL = pState.role === 'DL';

            const defenderProfile = getDecisionProfile(pState, playState.tick);

            const diag = diagnosePlay(
                pState,
                playState.tick,
                offenseStates,
                playState
            );
            
            let playDiagnosis = diag.guess;
            let diagConfidence = diag.confidence;
            let diagDirection = diag.direction;
            let dirConfidence = diag.dirConfidence;

            const isRunRead = playDiagnosis === 'run';

            const carrierIsPasser = Boolean(
                ballCarrierState &&
                ballCarrierState.role === 'QB' &&
                !playState.fumbleOccurred &&
                !isBallInAir &&
                carrierPerception > 0
            );

            const isBallPastLOS = Boolean(
                carrierPerception > 0 &&
                ballCarrierState &&
                ballCarrierState.y > LOS + 0.5
            );

            const qbScrambling =
                carrierIsPasser &&
                (isBallPastLOS || ballCarrierState.action === 'qb_scramble');

            // FIX: Only consider the play "at the mesh" if the ball is still behind or right at the line of scrimmage!
            // Once the runner has crossed the line of scrimmage, defenders pursue the runner directly.
            const isNearMeshPoint = ballCarrierState && ballCarrierState.y <= (LOS + 1.2);

            const isRunReadAtMesh =
                isRunRead &&
                isNearMeshPoint &&
                runTargetPerception > 0 &&
                !(carrierIsPasser && qbScrambling);
            
            const assignment = pState.assignment;

            if (playDiagnosis === 'read') {
                executeAssignment(pState, assignment, offenseStates, LOS, playState, ballCarrierState);
                return;
            }

            let shouldPursue = false;

            // FIX: Once a defender begins pursuing a live runner, remember it for at least 15 ticks (0.6s)
            // so they do not abandon pursuit just because the runner momentarily cut behind them.
            const isPersistingPursuit = pState._pursuitLockTicks && pState._pursuitLockTicks > 0;
            if (isPersistingPursuit) {
                pState._pursuitLockTicks--;
            }

            if (ballCarrierState && !isBallInAir) {
                if (isRunReadAtMesh) {
                    shouldPursue = true;
                } else if (carrierPerception > 0 || isPersistingPursuit) {
                    if (isRunRead || ballCarrierState.role !== 'QB' || qbScrambling) {
                        shouldPursue = true;
                        pState._pursuitLockTicks = 25; // Lock pursuit memory for 1 second
                    } else if (
                        assignment?.includes('blitz') ||
                        assignment?.includes('rush') ||
                        isDL
                    ) {
                        shouldPursue = true;
                        pState._pursuitLockTicks = 25;
                    }
                }
            }

            if (assignment?.startsWith('man_cover_') && shouldPursue && !isRunReadAtMesh && !isDL) {
                const targetSlot = assignment.replace('man_cover_', '');
                const carrierSlot = ballCarrierState?.slot;

                // FIX: If the ball carrier has crossed the line of scrimmage OR is an immediate tackle threat (< 4.5y),
                // break man coverage and rally to the ball carrier regardless of original assignment!
                const carrierPastLOS = ballCarrierState && ballCarrierState.y > LOS + 0.5;
                const carrierIsClose = ballCarrierState && getDistance(pState, ballCarrierState) < 4.5;

                // DEEPER FIX: Do not abandon man coverage on low-confidence run reads (diagConfidence < 0.65)
                const isConfidentRun = isRunRead && diagConfidence >= 0.65;

                if (carrierSlot !== targetSlot && !isConfidentRun && !qbScrambling && !carrierPastLOS && !carrierIsClose) {
                    shouldPursue = false;
                }
            }
            
            if (assignment?.startsWith('zone_') && shouldPursue && !isDL) {
                const carrierPastLOS = ballCarrierState && ballCarrierState.y > LOS + 0.5;
                const isConfidentRun = isRunRead && diagConfidence >= 0.65;
                
                // DEEPER FIX: Zone defenders (DBs/LBs) hold their zone unless there's a highly confident run read
                // or the runner has clearly crossed the line of scrimmage.
                if (!isConfidentRun && !qbScrambling && !carrierPastLOS && !isRunReadAtMesh) {
                    shouldPursue = false;
                }
            }

            // Early run fit: linebackers protect their alignment and fill a lane
            // before abandoning everything to chase the carrier.
            // During a mesh read, the QB may still hold the ball.
            // Use the RB's position/path as a provisional run-lane cue,
            // without assuming that the eventual carrier must be the RB.
            const runFitCarrier =
                ballCarrierState?.isOffense &&
                ballCarrierState.role === 'RB'
                    ? ballCarrierState
                    : (isRunReadAtMesh ? primaryRunTarget : null);

            const runFitPerception = runFitCarrier
                ? getPerceptionWeight(defenderVision, runFitCarrier)
                : 0;
            
            const isEarlyLinebackerRunFit =
                Boolean(
                    !isBallInAir &&
                    pState.role === 'LB' &&
                    isRunRead &&
                    runFitCarrier &&
                    runFitCarrier.y < LOS + 1.5 &&
                    !assignment?.includes('blitz')
                );

            if (isEarlyLinebackerRunFit && runFitPerception > 0) {
                // Infer the developing lane from visible position and movement,
                // not the hidden endpoint of the offensive play design.
                const laneX =
                    runFitCarrier.x + ((runFitCarrier.vx || 0) * 0.35);

                // Fit toward the likely lane without abandoning the LB's alignment.
                const lateralCorrection = Math.max(
                    -1.25,
                    Math.min(1.25, laneX - pState.initialX)
                );

                const fitX = Math.max(
                    1,
                    Math.min(
                        FIELD_WIDTH - 1,
                        pState.initialX + lateralCorrection
                    )
                );

                setPointIntent(pState, fitX, LOS + 1.2, 0.6);
                pState.action = 'pursuit';
                return;
            }
    
            if (shouldPursue && ballCarrierState) {
                const chaseTarget =
                    (isRunReadAtMesh ? primaryRunTarget : null) ||
                    ballCarrierState;

                if (chaseTarget) {
                    const dist = getDistance(pState, chaseTarget);
                    const iq = defenderProfile?.awareness ?? (pState.playbookIQ || 50);

                    if (isRunReadAtMesh && iq < 60) {
                        setPointIntent(
                            pState,
                            chaseTarget.x,
                            Math.min(chaseTarget.y, LOS + 0.5),
                            0.5
                        );
                        pState.action = 'pursuit';
                        pState.contactReduction = 1.2;
                        if (!pState.loggedRunRead && gameLog && Math.random() < 0.2) {
                            pushGameLog(
                                gameLog,
                                `[Tick ${playState.tick}] ${pState.name} commits downhill on the run read while the QB still has the ball.`,
                                playState
                            );
                            pState.loggedRunRead = true;
                        }
                        return;
                    }

                    const chasePerception = isRunReadAtMesh
                        ? runTargetPerception
                        : carrierPerception;

                    const blendFactor =
                        Math.min(1.0, Math.max(0.0, (dist - 1.5) / 3.0)) *
                        chasePerception;
                    const maxLeadTime = 1.0;
                    const leadTime = Math.min(maxLeadTime, dist / (16 + (iq / 4))) * blendFactor;
                    let predX = chaseTarget.x + ((chaseTarget.vx || 0) * leadTime);
                    let predY = chaseTarget.y + ((chaseTarget.vy || 0) * leadTime);

                    const isOutsideRun = Math.abs(chaseTarget.x - CENTER_X) > 12.0;
                    const isWidestDefender = (chaseTarget.x > CENTER_X && pState.x >= chaseTarget.x) ||
                        (chaseTarget.x < CENTER_X && pState.x <= chaseTarget.x);

                    if (isOutsideRun && isWidestDefender && pState.role === 'DB' && iq > 55) {
                        const boundaryBias = (chaseTarget.x > CENTER_X ? 2.5 : -2.5) * blendFactor;
                        predX = Math.max(2.0, Math.min(FIELD_WIDTH - 2.0, chaseTarget.x + boundaryBias));
                        predY = Math.max(chaseTarget.y + 0.5, predY);
                    }

                    if (dirConfidence > 0.45 && !isRunReadAtMesh) {
                        const cheatAmount =
                            3.0 *
                            dirConfidence *
                            (iq / 100) *
                            blendFactor *
                            (defenderProfile?.riskTolerance ?? 1.0);
                        if (diagDirection === 'right' && predX < FIELD_WIDTH - 5) predX += cheatAmount;
                        else if (diagDirection === 'left' && predX > 5) predX -= cheatAmount;
                    }

                    // DEEPER FIX: Boids-like Obstacle Avoidance for blocked tackle paths
                    const isObstructed = pState._lastTackleBlockedLogTick && 
                                        (playState.tick - pState._lastTackleBlockedLogTick) < 5;

                    if (isObstructed) {
                        // Steer left or right of the carrier based on current leverage to navigate around the blocker
                        const leverageDir = pState.x > chaseTarget.x ? 1.8 : -1.8;
                        predX += leverageDir;
                    }

                    const pursuitTargetY = getPursuitTargetY(
                        pState,
                        chaseTarget,
                        predY
                    );

                    setPointIntent(pState, predX, pursuitTargetY, 0.5);

                    pState.contactReduction = 0.7 + (diagConfidence * 0.3);
                    pState.action = 'pursuit';
                }
            } else if (isBallInAir) {
                const iq = pState.playbookIQ || 50;
                const flightTime = playState.tick - (playState.ballState.throwTick || 0);
                const reactionDelay = Math.max(2, 12 - Math.floor(iq / 10));

                // Let deep safeties process coverage assignments in executeAssignment.
                const isDeepZoneDB =
                    pState.role === 'DB' &&
                    pState.assignment?.includes('zone_deep');

                if (flightTime > reactionDelay && !isDeepZoneDB) {
                    if (ballPos.isThrowAway) {
                        setHoldIntent(pState, pState.x, pState.y);
                        pState.action = 'idle';
                    } else {
                        const interceptionPoint =
                            getReachablePassInterceptionPoint(pState, ballPos);

                        if (interceptionPoint) {
                            setPointIntent(
                                pState,
                                interceptionPoint.x,
                                interceptionPoint.y,
                                0.5
                            );

                            pState.action = 'tracking_ball';
                        } else {
                            // The pass is not realistically reachable.
                            // Preserve the player's existing assignment.
                            executeAssignment(
                                pState,
                                assignment,
                                offenseStates,
                                LOS,
                                playState,
                                ballCarrierState
                            );
                        }
                    }
                } else {
                    executeAssignment(
                        pState,
                        assignment,
                        offenseStates,
                        LOS,
                        playState,
                        ballCarrierState
                    );
                }
            } else {
                executeAssignment(
                    pState,
                    assignment,
                    offenseStates,
                    LOS,
                    playState,
                    ballCarrierState
                );
            }
        }
    });

    // --- SINGLE AUTHORITATIVE PASS FOR ALL PLAYERS (Offense & Defense) ---
    playState.activePlayers.forEach(pState => {
        if (pState.stunnedTicks <= 0 && !pState.isBlocked && !pState.isEngaged) {
            // Safely fallback to current coordinates if target is undefined to prevent NaN poisoning
            const safeTargetX = pState.targetX ?? pState.x;
            const safeTargetY = pState.targetY ?? pState.y;

            pState.targetX = Math.max(1, Math.min(52.3, safeTargetX));
            pState.targetY = Math.max(1, Math.min(119.0, safeTargetY));
            resolveMovementIntent(pState);
        }
    });
}

export function executeAssignment(pState, assignment, offenseStates, LOS, playState, ballCarrierState) {
    const isBallInAir = playState.ballState.inAir;

    // Pass the real ballCarrierState so safeties don't provide double-team help while an RB is running with the ball!
    if (pState.role === 'DB' && assignment.includes('zone_deep') && !assignment.includes('blitz')) {
        const safetyHelp = calculateSafetyHelp(pState, playState.activePlayers.filter(p => !p.isOffense), offenseStates, ballCarrierState, playState, isBallInAir);
        if (safetyHelp && safetyHelp.type === 'help') {
            setPointIntent(pState, safetyHelp.helpX, safetyHelp.helpY, 0.5);
            return;
        }
    }

    if (assignment?.startsWith('man_cover_')) {
        const targetSlot = assignment.replace('man_cover_', '');
        let targetRec = offenseStates.find(o =>
            o.slot === targetSlot || o.role === targetSlot || o.assignedPlayerSlot === targetSlot
        );
        if (!targetRec) targetRec = offenseStates.find(o => o.slot === targetSlot);

        if (targetRec) {
            const defSpeed = pState.speed || 50;
            const recSpeed = targetRec.speed || 50;
            const defProfile = getDecisionProfile(pState, playState.tick);
            const defIQ = defProfile?.awareness ?? (pState.playbookIQ || 50);
            const defCoverSkill = pState.coverage || 50;

            const speedDiff = recSpeed - defSpeed;
            let cushionY = (targetRec.y > LOS + 15) ? 2.5 : 1.5;
            if (speedDiff > 10) cushionY += 2.0;
            if (speedDiff < -15) cushionY = Math.max(1.0, cushionY - 1.0);

            let cushionX = (targetRec.x < CENTER_X) ? 0.5 : -0.5;

            if (targetRec.y < LOS + 3 && getDistance(pState, targetRec) < 3.0) {
                if (typeof pState.jamDecisionMade === 'undefined') {
                    pState.jamDecisionMade = true;
                    const jamChance = (defCoverSkill + defIQ) / 200;
                    if (Math.random() < jamChance) {
                        pState.isJamming = true;
                        pState.jamTicks = 15;
                    }
                }
            }

            if (pState.jamTicks > 0) {
                pState.jamTicks--;
                const dx = targetRec.x - pState.x;
                const dy = targetRec.y - pState.y;
                const dist = Math.max(0.1, Math.hypot(dx, dy));

                targetRec.x += (dx / dist) * 0.08;
                targetRec.y += (dy / dist) * 0.08;

                pState.targetX = targetRec.x - (dx / dist) * 0.5;
                pState.targetY = targetRec.y + (dy / dist) * 0.5;

                // Keep movement intent synchronized before the early return.
                setPointIntent(
                    pState,
                    pState.targetX,
                    pState.targetY,
                    0.5
                );

                // Preserve the current jam's remaining duration, including
                // this tick, without restarting a full 15-tick penalty.
                targetRec.jammedTicks = Math.max(
                    targetRec.jammedTicks || 0,
                    pState.jamTicks + 1
                );
                return;
            } else {
                targetRec.contactReduction = 1.0;
            }

            let perfectX = targetRec.x + cushionX;
            let perfectY = targetRec.y + cushionY;

            const wrAgility = targetRec.agility || 50;
            const dbAgility = pState.agility || 50;

            if (targetRec.action === 'run_route') {
                const latMovement = ((targetRec.targetX || targetRec.x) - targetRec.x);
                const longMovement = ((targetRec.targetY || targetRec.y) - targetRec.y);
                const readMultiplier = Math.max(0, (defIQ - 50) / 50);

                perfectX += latMovement * readMultiplier * 0.60;
                perfectY += longMovement * readMultiplier * 0.25;

                const agiDiff = wrAgility - dbAgility;
                if (agiDiff > 0) {
                    perfectX -= (targetRec.vx || 0) * (agiDiff * 0.002);
                    perfectY -= (targetRec.vy || 0) * (agiDiff * 0.002);
                }
            }

            pState.targetX = perfectX;
            pState.targetY = perfectY;
        } else {
            const z = getZoneCenter('zone_short_middle', LOS);
            pState.targetX = z.x;
            pState.targetY = z.y;
        }

        // Sync the final man-coverage target with the movement intent.
        setPointIntent(
            pState,
            pState.targetX,
            pState.targetY,
            0.5
        );

    } else if (assignment?.startsWith('zone_')) {
        const zone = zoneBoundaries[assignment];
        const zoneCenter = getZoneCenter(assignment, LOS);
        const isDeep = assignment.includes('deep') || pState.slot.startsWith('S');
        const defenderProfile = getDecisionProfile(pState, playState.tick);
        const iq = defenderProfile?.awareness ?? (pState.playbookIQ || 50);
        
        // 1. "Hero Ball" Safety Creep: Impatient low-IQ deep safeties creep downhill toward LOS
        if (isDeep && iq < 58) {
            zoneCenter.y = Math.max(LOS + 7.0, zoneCenter.y - 3.5);
        }

        // 2. QB Stare-Down Tracking: If QB has low IQ, zone defenders cheat toward his target
        const qb = offenseStates.find(o => o.slot?.startsWith('QB'));
        if (qb && (qb.playbookIQ || 50) < 65 && qb.currentReadTargetSlot) {
            const primaryRec = offenseStates.find(o => o.slot === qb.currentReadTargetSlot);
            if (primaryRec && Math.abs(primaryRec.x - zoneCenter.x) < 14) {
                zoneCenter.x += (primaryRec.x > zoneCenter.x ? 2.0 : -2.0);
            }
        }

        const minX = (zone?.minX || 0) - 3.0;
        const maxX = (zone?.maxX || FIELD_WIDTH) + 3.0;
        const minY = LOS + (zone?.minY || 0) - 2.0;
        const maxY = LOS + (zone?.maxY || 25.0) + 3.0;

        let zoneThreats = offenseStates.filter(o => {
            if (!o.action.includes('route')) return false;
            return o.x >= minX && o.x <= maxX && o.y >= minY && o.y <= maxY;
        });

        let primaryThreat = null;
        if (zoneThreats.length > 0) {
            if (isDeep) {
                primaryThreat = zoneThreats.reduce((deepest, current) => current.y > deepest.y ? current : deepest);
            } else {
                primaryThreat = zoneThreats.reduce((closest, current) =>
                    getDistance(pState, current) < getDistance(pState, closest) ? current : closest
                );
            }
        }

        if (primaryThreat) {
            if (isDeep) {
                const insideLeverageX = primaryThreat.x < CENTER_X ? 1.0 : -1.0;

                // --- ELITE DB BAITING (Trap Coverage) ---
                const flightTime =
                    playState.tick - (playState.ballState.throwTick || 0);

                const reactionDelay =
                    Math.max(2, 12 - Math.floor(iq / 10));

                const interceptionPoint =
                    isBallInAir &&
                    playState.ballState.targetPlayerId === primaryThreat.id &&
                    flightTime > reactionDelay
                        ? getReachablePassInterceptionPoint(
                            pState,
                            playState.ballState
                        )
                        : null;

                if (
                    iq > 75 &&
                    defenderProfile.decisionQuality > 72 &&
                    defenderProfile.assignmentDiscipline > 50 &&
                    !isBallInAir &&
                    playState.tick > 25
                ) {
                    // Elite safety intentionally sags to bait the throw.
                    pState.targetX = primaryThreat.x + (insideLeverageX * 2.5);
                    pState.targetY = Math.max(zoneCenter.y, primaryThreat.y + 1.0);
                } else if (interceptionPoint) {
                    // Break on the ball only when a physical contest is plausible.
                    pState.targetX = interceptionPoint.x;
                    pState.targetY = interceptionPoint.y;
                    pState.action = 'tracking_ball';
                    pState.contactReduction = 1.3;
                } else {
                    // No reachable interception: maintain deep coverage leverage.
                    pState.targetX = primaryThreat.x + insideLeverageX;
                    pState.targetY = Math.max(zoneCenter.y, primaryThreat.y + 3.5);
                }
            } else {
                // Short Zone
                if (iq > 75 && !isBallInAir) {
                    // Bait shallow crossers by drifting slightly away
                    pState.targetX = primaryThreat.x + (primaryThreat.vx > 0 ? -2.0 : 2.0);
                    pState.targetY = primaryThreat.y - 2.5;
                } else {
                    pState.targetX = primaryThreat.x;
                    pState.targetY = primaryThreat.y - 1.5;
                }
            }

            const TETHER_LIMIT_X = isDeep ? 10.0 : 6.0;
            pState.targetX = Math.max(zoneCenter.x - TETHER_LIMIT_X, Math.min(zoneCenter.x + TETHER_LIMIT_X, pState.targetX));

            if (!isDeep) {
                const maxSinkDepth = LOS + (zone?.maxY || 15.0);
                pState.targetY = Math.min(maxSinkDepth, pState.targetY);
            }
            pState.zoneDriftTick = playState.tick;
        } else {
            if (!pState.zoneDriftTick || playState.tick > pState.zoneDriftTick + 25) {
                pState.zoneDriftTick = playState.tick;
                let driftX = zoneCenter.x;
                const qb = offenseStates.find(p => p.slot.startsWith('QB'));
                
                // Zone defenders cleanly track the side of the field the QB is standing on
                if (qb) {
                    driftX += (qb.x < CENTER_X ? -2.5 : 2.5);
                }

                pState.dynamicTargetX = driftX;
                pState.dynamicTargetY = zoneCenter.y;
            }
            pState.targetX = pState.dynamicTargetX || zoneCenter.x;
            pState.targetY = pState.dynamicTargetY || zoneCenter.y;
        }

        // Sync whichever zone-coverage target was selected.
        setPointIntent(
            pState,
            pState.targetX,
            pState.targetY,
            0.5
        );

    } else if (assignment === 'spy_QB') {
        const target = ballCarrierState && ballCarrierState.y < LOS + 1
            ? ballCarrierState
            : offenseStates.find(p => p.slot === 'QB1');

        if (target) {
            pState.targetX = target.x;
            pState.targetY = Math.max(LOS + 3.0, pState.y);

            setPointIntent(
                pState,
                pState.targetX,
                pState.targetY,
                0.5
            );
        }
    } else if (assignment?.includes('rush') || assignment?.includes('blitz') || assignment?.includes('run_gap')) {
        if (playState.handoffOccurred && ballCarrierState) {
            pState.targetX = ballCarrierState.x;
            pState.targetY = ballCarrierState.y;

            setPointIntent(
                pState,
                pState.targetX,
                pState.targetY,
                0.5
            );
        } else {
            const qb = offenseStates.find(p => p.slot.startsWith('QB'));
            if (qb) {
                const isEdgeRusher = Math.abs(pState.initialX - qb.initialX) >= 3.5;
                if (isEdgeRusher) {
                    const escapeAngle = pState.initialX < qb.initialX ? -1 : 1;
                    const rusherIQ = pState.playbookIQ || 50;

                    if (pState._isDisciplinedRusher === undefined) {
                        pState._isDisciplinedRusher = rusherIQ > 55 || (Math.random() < (rusherIQ / 100));
                    }

                    const rushWidth = pState._isDisciplinedRusher ? 4.0 : 0.8;
                    const rushDepth = pState._isDisciplinedRusher ? Math.max(qb.y - 1.5, pState.y - 0.5) : (qb.y - 2.0);

                    setTrackIntent(pState, { id: qb.id, x: qb.x + (escapeAngle * rushWidth), y: rushDepth }, 0, 0.5);
                } else {
                    setPointIntent(pState, qb.x, qb.y + 0.5, 0.5);
                }
            } else {
                setPointIntent(pState, pState.x, LOS - 5, 0.5);
            }
        }
    }
}
