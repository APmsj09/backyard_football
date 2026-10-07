//play_execution.js

import { getDistance } from './physics.js';
import { getPlayer } from './state.js';
import {
    routeTree, offenseFormations, defenseFormations, defensivePlaybook
} from '../data.js';
import {
    getZoneCenter, calculateRoutePath, resolveDepthForPlay, getAssignment
} from './engine_helpers.js';
import {
    calculateSafetyHelp, diagnosePlay, getSmartCarrierTarget
} from './ai.js';
import { pushGameLog } from './collisions.js';

const FIELD_WIDTH = 53.3;
const FIELD_LENGTH = 120;
const CENTER_X = FIELD_WIDTH / 2;

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
    playState.playKey = play.key || null;

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
                            readProgression = play.readProgression.map(role => {
                                const mapped = mapping[role];
                                return Array.isArray(mapped) ? mapped[0] : (mapped || role);
                            }).filter(Boolean);
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
                        if (routePath && routePath.length > 0) {
                            targetX = routePath[0].x; targetY = routePath[0].y;
                        } else {
                            targetY = startY + 5;
                        }
                    } else if (routeTree[assignment]) {
                        action = 'run_route';
                        routePath = calculateRoutePath(assignment, startX, startY);
                        if (routePath && routePath.length) {
                            targetX = routePath[0].x; targetY = routePath[0].y;
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
            startY = Math.max(10.5, Math.min(110.0 - 10.5, startY));

            if (isOffense && slot.startsWith('OL')) {
                startY = playState.lineOfScrimmage - 0.2;
            } else if (!isOffense && slot.startsWith('DL')) {
                startY = playState.lineOfScrimmage + 0.8;
            } else {
                if (!isOffense && startY < playState.lineOfScrimmage + 1.5) startY = playState.lineOfScrimmage + 1.5;
                if (isOffense && startY > playState.lineOfScrimmage - 1.5) startY = playState.lineOfScrimmage - 1.5;
            }

            if (player.fatigue === undefined || isNaN(player.fatigue)) player.fatigue = 0;
            const fatigueMod = Math.max(0.70, 1.0 - ((player.fatigue || 0) / 100) * 0.30);

            const isPreferredOffense = offense.formations.offense === offense.coach?.preferredOffense;
            const isPreferredDefense = defense.formations.defense === defense.coach?.preferredDefense;
            let schemeBoost = 0;
            if (isOffense && isPreferredOffense) schemeBoost = 5;
            else if (!isOffense && isPreferredDefense) schemeBoost = 5;

            const playerIQ = Math.min(99, (player.attributes?.mental?.playbookIQ || 50) + schemeBoost);
            const consistency = Math.min(99, (player.attributes?.mental?.consistency || 50) + schemeBoost);

            let reactionTicks = 0;
            if (slot !== 'QB1' && slot !== 'OL2') {
                reactionTicks = Math.max(1, 10 - Math.floor(playerIQ / 10)) + Math.floor(Math.random() * 3);
                if (!isOffense) reactionTicks += 2;
            }

            const speed = player.attributes?.physical?.speed || 50;
            const agility = player.attributes?.physical?.agility || 50;
            const strength = player.attributes?.physical?.strength || 50;
            const weight = player.attributes?.physical?.weight || 150;
            const height = player.attributes?.physical?.height || 68;
            const toughness = player.attributes?.mental?.toughness || 50;
            const catching = player.attributes?.technical?.catchingHands || 50;
            const tackling = player.attributes?.technical?.tackling || player.attributes?.defense?.tackling || 50;
            const coverage = player.attributes?.technical?.coverage || player.attributes?.technical?.passCoverage || 50;
            const blocking = player.attributes?.technical?.blocking || 50;
            const blockShedding = player.attributes?.technical?.blockShedding || 50;
            const accuracy = player.attributes?.technical?.throwingAccuracy || 50;

            const pState = {
                id: player.id,
                name: player.name,
                number: player.number,
                role: slot.replace(/\d+/g, ''),
                teamId: team.id,
                snapReactionTimer: reactionTicks,
                primaryColor: team.primaryColor,
                secondaryColor: team.secondaryColor,
                isOffense, slot,
                x: startX, y: startY, initialX: startX, initialY: startY,
                targetX, targetY,
                fatigueModifier: fatigueMod,
                spd: speed, agi: agility, str: strength,
                wgt: weight, hgt: height, iq: playerIQ,
                cons: consistency, tgh: toughness, ctch: catching,
                tkl: tackling, blk: blocking, shed: blockShedding,
                acc: accuracy, cov: coverage,
                speed, agility, strength, weight, height, playbookIQ: playerIQ,
                consistency, toughness, catchingHands: catching,
                tackling, blocking, blockShedding, throwingAccuracy: accuracy, coverage,
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

        if (play.type === 'run') {
            const runner = playState.activePlayers.find(p => p.isOffense && p.assignment?.startsWith('run_') && p.id !== snapTaker.id);
            if (runner) {
                playState.handoffRequired = true;
                playState.handoffTargetSlot = runner.slot;
            } else {
                snapTaker.isBallCarrier = true;
            }
        }
    }
}

export function updatePlayerTargets(playState, offenseStates, defenseStates, ballCarrierState, playType, offensivePlayKey, offensiveAssignments, defensivePlayKey, gameLog) {
    const qbState = offenseStates.find(p => p.slot?.startsWith('QB'));
    const isBallInAir = playState.ballState.inAir;
    const ballPos = playState.ballState;
    const LOS = playState.lineOfScrimmage;

    if (playState.ballState.isLoose) {
        const getClosest = (isOff) => playState.activePlayers
            .filter(p => p.isOffense === isOff && p.stunnedTicks <= 0 && !p.isEngaged)
            .sort((a, b) => getDistance(a, playState.ballState) - getDistance(b, playState.ballState))
            .slice(0, 3);

        const pursuers = [...getClosest(true), ...getClosest(false)];
        playState.activePlayers.forEach(pState => {
            if (pState.stunnedTicks > 0 || pState.isEngaged) return;
            if (pursuers.includes(pState)) {
                pState.targetX = playState.ballState.x;
                pState.targetY = playState.ballState.y;
                pState.action = 'pursuit';
            } else {
                pState.targetX = pState.x;
                pState.targetY = pState.y;
                pState.action = 'idle';
            }
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

    const linemen = offenseStates.filter(p => !p.isEngaged && p.slot.startsWith('OL'));
    const otherBlockers = offenseStates.filter(p => !p.isEngaged && !p.slot.startsWith('OL') && (p.action === 'pass_block' || p.action === 'run_block'));
    const assignedThreats = new Set();

    const assignBlockerTarget = (blocker, threats) => {
        if (blocker.isEngaged) return;
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

        const isPulling = blocker.routePath && blocker.currentPathIndex < blocker.routePath.length;
        const VISION_RANGE = isPulling ? 2.0 : 10.0;
        const validThreats = threats.filter(t => getDistance(blocker, t) < VISION_RANGE && t.y > blocker.y - 1.5);

        let target = null;
        const isPassPlay = playType === 'pass';

        let sortedThreats = validThreats.sort((a, b) => {
            const laneDiffA = Math.abs(a.x - blocker.initialX);
            const laneDiffB = Math.abs(b.x - blocker.initialX);
            const doubleTeamPenaltyA = assignedThreats.has(a.id) ? 15 : 0;
            const doubleTeamPenaltyB = assignedThreats.has(b.id) ? 15 : 0;
            return (laneDiffA + doubleTeamPenaltyA) - (laneDiffB + doubleTeamPenaltyB);
        });

        if (sortedThreats.length > 0) {
            target = sortedThreats[0];
            blocker.dynamicTargetId = target.id;
            assignedThreats.add(target.id);
        }

        if (target) {
            if (target.isEngaged) return;
            if (isPassPlay) {
                const qb = offenseStates.find(p => p.slot.startsWith('QB'));
                if (qb) {
                    const dx = qb.x - target.x;
                    const dy = qb.y - target.y;
                    const distToQB = Math.max(0.1, Math.sqrt(dx * dx + dy * dy));
                    blocker.targetX = target.x + (dx / distToQB) * 0.8;
                    blocker.targetY = target.y + (dy / distToQB) * 0.8;
                    if (blocker.targetY < qb.y + 1.5) blocker.targetY = qb.y + 1.5;
                    blocker.contactReduction = 1.3;
                }
            } else {
                const blockerIQ = blocker.playbookIQ || 50;
                const canClimb = playType === 'run' && playState.tick > 16 && blockerIQ > 60;
                let climbTarget = null;
                if (canClimb) {
                    climbTarget = defenseStates.find(d =>
                        d.role === 'LB' && !d.isBlocked && !d.isEngaged &&
                        d.y > blocker.y && d.y < blocker.y + 6.0 && Math.abs(d.x - blocker.x) < 4.5
                    );
                }

                if (climbTarget) {
                    blocker.targetX = climbTarget.x;
                    blocker.targetY = climbTarget.y;
                    blocker.dynamicTargetId = climbTarget.id;
                    target = climbTarget;
                } else {
                    blocker.targetX = target.x;
                    blocker.targetY = target.y;
                }
                blocker.contactReduction = 1.2;
            }

            if (getDistance(blocker, target) < 1.2) {
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
            blocker.targetX = blocker.initialX;
            blocker.targetY = isPassPlay ? LOS - 1.5 : LOS + 1.0;
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
                    pState.targetX = ballPos.targetX || ballPos.x;
                    pState.targetY = ballPos.targetY || ballPos.y;
                }
                return;
            }

            if (isReturnTeam) {
                if (pState.assignment === 'punt_return' || pState.isBallCarrier) {
                    if (pState.isBallCarrier) return;
                    else if (ballInAir) {
                        const landX = ballPos.targetX || ballPos.x;
                        const landY = ballPos.targetY || ballPos.y;
                        pState.targetX = landX;
                        pState.targetY = landY;
                        pState.action = 'pursuit';
                        if (getDistance(pState, { x: landX, y: landY }) < 2.0) {
                            pState.vx = 0; pState.vy = 0;
                        }
                        return;
                    }
                } else {
                    if (returnerHasBall) {
                        const returnerY = ballCarrierState.y;
                        const threat = offenseStates
                            .filter(e => !e.isBlocked && !e.isEngaged && e.y < returnerY + 15 && e.y > returnerY - 5)
                            .sort((a, b) => getDistance(pState, a) - getDistance(pState, b))[0];

                        if (threat) {
                            pState.targetX = threat.x; pState.targetY = threat.y;
                            if (getDistance(pState, threat) < 2.0) {
                                pState.isEngaged = true; pState.engagedWith = threat;
                                threat.isEngaged = true; threat.isBlocked = true; threat.blockedBy = pState;

                                playState.blockBattles.push({
                                    blocker: pState,
                                    defender: threat,
                                    status: 'ongoing',
                                    battleScore: 0,
                                    startTick: playState.tick
                                });
                            }
                        } else {
                            pState.targetX = ballCarrierState.x + (pState.x < ballCarrierState.x ? -3 : 3);
                            pState.targetY = ballCarrierState.y - 2;
                        }
                    } else {
                        const landY = ballPos.targetY || 20;
                        const landX = ballPos.targetX || CENTER_X;
                        const xOffset = (pState.initialX - CENTER_X) * 0.8;
                        pState.targetX = landX + xOffset;
                        pState.targetY = Math.max(landY - 15, 10);
                    }
                    pState.action = 'run_block';
                    return;
                }
            }
        }

        if (pState.isOffense) {
            const isRunner = pState.isBallCarrier || (pState.slot === 'QB1' && pState.action === 'qb_scramble');

            if (isRunner) {
                pState.isBallCarrier = true;
                let targetX = pState.x;
                let targetY = pState.y;

                const nearbyDefenders = defenseStates.filter(d => !d.isBlocked && d.stunnedTicks === 0);
                const immediateThreat = nearbyDefenders.sort((a, b) => getDistance(pState, a) - getDistance(pState, b))[0];

                if (pState.action === 'trucking') {
                    if (!immediateThreat || getDistance(pState, immediateThreat) > 3.0) {
                        pState.action = 'run_path';
                    }
                }

                if (pState.routePath && pState.currentPathIndex < pState.routePath.length) {
                    const pt = pState.routePath[pState.currentPathIndex];
                    targetX = pt.x;
                    targetY = pt.y;

                    const distToNode = getDistance(pState, pt);
                    const isZoneRun = playState.playKey?.includes('Zone') || playState.playKey?.includes('Stretch');
                    const rbIQ = pState.playbookIQ || 50;

                    if (isZoneRun && pState.y < LOS && playState.tick < 22 && rbIQ > 60) {
                        pState.contactReduction = 0.72;
                    } else {
                        pState.contactReduction = 1.05;
                    }

                    if (distToNode < 1.8) {
                        pState.currentPathIndex++;
                        if (pState.currentPathIndex < pState.routePath.length) {
                            pState.vx *= 0.4;
                            pState.vy *= 0.4;
                        }
                    }
                    pState.action = 'run_path';
                } else if (pState.role === 'QB' && pState.action === 'qb_scramble' && pState.y < LOS) {
                    const rollDir = pState.rolloutDir || (pState.x > CENTER_X ? 1 : -1);
                    targetX = pState.x + (rollDir * 8);
                    targetY = pState.y + 1.0;
                    targetX = Math.max(3, Math.min(FIELD_WIDTH - 3, targetX));
                } else {
                    const oldAction = pState.action;
                    const smartTarget = getSmartCarrierTarget(pState, defenseStates, offenseStates, FIELD_WIDTH, playState);
                    targetX = smartTarget.x;
                    targetY = smartTarget.y;

                    if (pState.action === oldAction || pState.action === 'run_path') {
                        pState.action = 'run_path';
                    }

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
                        pState.targetX = playState.ballState.targetX;
                        pState.targetY = playState.ballState.targetY;
                        pState.action = 'tracking_ball';
                        pState.contactReduction = 1.1 + ((pState.agility || 50) / 250);
                        return;
                    }
                }
            }

            if (pState.role === 'QB' && playState.handoffOccurred) {
                const driftSide = pState.initialX > CENTER_X ? 1 : -1;
                pState.targetX = pState.initialX + (driftSide * 2);
                pState.targetY = playState.lineOfScrimmage - 5.0;
                pState.action = 'idle';
                pState.ghostTicks = 20;
                return;
            }

            if (!pState.action) {
                pState.action = 'idle';
                pState.targetX = pState.initialX;
                pState.targetY = pState.initialY;
            }

            switch (pState.action) {
                case 'handoff_setup':
                case 'handoff_receive':
                case 'run_path':
                case 'run_fake':
                    break;

                case 'qb_setup': {
                    const qbIQ = pState.playbookIQ || 50;
                    if (!pState.hasCompletedDropback) {
                        pState.targetX = pState.initialX;
                        pState.targetY = pState.dropbackTargetY;
                        pState.contactReduction = 1.4;
                        if (Math.abs(pState.y - pState.dropbackTargetY) < 0.5) {
                            pState.hasCompletedDropback = true;
                            pState.dropbackPhase = 'set';
                        }
                        break;
                    }

                    pState.contactReduction = 1.0;
                    let idealX = pState.initialX;
                    let idealY = pState.dropbackTargetY;
                    const rushers = defenseStates.filter(d => !d.isBlocked && !d.isEngaged && getDistance(pState, d) < 6);
                    const immediateThreat = rushers.find(r => getDistance(pState, r) < 3.5);

                    if (immediateThreat && (qbIQ > 45 || pState.agility > 50)) {
                        if (!pState.rolloutDir) {
                            const threatSide = immediateThreat.x > pState.x ? 1 : -1;
                            pState.rolloutDir = -threatSide;
                        }
                        pState.action = 'qb_scramble';
                        pState.targetX = pState.x + (pState.rolloutDir * 8);
                        pState.targetY = pState.y + 1.0;
                        pState.loggedRollout = true;
                        if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] 🏃 ${pState.name} escapes the collapsing pocket!`, playState);
                        break;
                    }

                    if (rushers.length > 0 && qbIQ > 40) {
                        let desiredX = idealX;
                        let desiredY = idealY;
                        let leftPressure = 0;
                        let rightPressure = 0;
                        let upTheMiddle = 0;

                        rushers.forEach(r => {
                            const dx = r.x - pState.x;
                            const dy = r.y - pState.y;
                            const dist = Math.max(0.1, Math.hypot(dx, dy));
                            const threatLevel = 10 / dist;
                            if (dx < -1.5) leftPressure += threatLevel;
                            if (dx > 1.5) rightPressure += threatLevel;
                            if (Math.abs(dx) <= 1.5 && dy > 0) upTheMiddle += threatLevel;
                        });

                        if (leftPressure > rightPressure + 1.0) desiredX += 5.0;
                        else if (rightPressure > leftPressure + 1.0) desiredX -= 5.0;

                        if ((leftPressure > 2.0 || rightPressure > 2.0) && upTheMiddle < 1.5 && qbIQ > 65) {
                            desiredY += 3.5;
                        } else if (upTheMiddle > 2.0) {
                            desiredY -= 2.0;
                        }

                        const iqMod = 0.5 + (qbIQ / 200);
                        pState.targetX = Math.max(pState.initialX - 6, Math.min(pState.initialX + 6, pState.initialX + ((desiredX - pState.initialX) * iqMod)));
                        pState.targetY = Math.max(LOS - 12.0, Math.min(LOS - 1, idealY + ((desiredY - idealY) * iqMod)));
                    } else {
                        pState.targetX = idealX;
                        pState.targetY = idealY;
                    }
                    break;
                }

                case 'run_route': {
                    if (!pState.routePath || pState.currentPathIndex >= pState.routePath.length) {
                        pState.action = 'route_complete';
                        break;
                    }

                    const pt = pState.routePath[pState.currentPathIndex];
                    const distToNode = getDistance(pState, pt);
                    const isFinalNode = pState.currentPathIndex === pState.routePath.length - 1;
                    const isHookRoute = ['Hitch', 'Curl', 'Dig', 'In'].some(r => pState.assignment?.includes(r));
                    const recIQ = pState.playbookIQ || 50;

                    if (isHookRoute && isFinalNode && distToNode < 1.5 && recIQ > 65) {
                        const nearbyZoneDefenders = defenseStates.filter(d =>
                            !d.isBlocked && d.y >= LOS + 4.0 && getDistance(pState, d) < 4.0
                        );

                        if (nearbyZoneDefenders.length > 0) {
                            const nearest = nearbyZoneDefenders.sort((a, b) => getDistance(pState, a) - getDistance(pState, b))[0];
                            const driftDirX = pState.x > nearest.x ? 1.0 : -1.0;
                            pState.targetX = pState.x + (driftDirX * 1.2);
                            pState.targetY = pState.y - 0.5;
                            pState.contactReduction = 0.5;
                            break;
                        }
                    }

                    pState.contactReduction = distToNode < 1.0 ? 0.8 : 1.0;
                    pState.targetX = pt.x;
                    pState.targetY = pt.y;

                    if (distToNode < 0.6) {
                        pState.currentPathIndex++;
                        const coverageDefender = defenseStates.find(d =>
                            (d.assignment?.includes(pState.slot) || d.assignedPlayerSlot === pState.slot) &&
                            getDistance(pState, d) < 5.0
                        );

                        if (coverageDefender) {
                            const wrAgility = pState.agility || 50;
                            const dbAgility = coverageDefender.agility || 50;
                            const dbIQ = coverageDefender.playbookIQ || 50;
                            const shakeChance = (wrAgility / (dbAgility + 10)) * (1.2 - (dbIQ / 150));

                            if (Math.random() < shakeChance * 0.4) {
                                coverageDefender.stunnedTicks = Math.max(10, 25 - (dbIQ / 4));
                                coverageDefender.x += pState.vx * 0.5;
                                if (gameLog && Math.random() < 0.2) {
                                    pushGameLog(gameLog, `[Tick ${playState.tick}] 💨 ${pState.name} shakes ${coverageDefender.name} on the cut!`, playState);
                                }
                            }
                        }
                        pState.vx *= 1.2;
                        pState.vy *= 1.2;
                    }
                    break;
                }

                case 'route_complete': {
                    if (qbState && qbState.action === 'qb_scramble') {
                        const recIQ = pState.playbookIQ || 50;
                        const reactionTicks = Math.max(4, 24 - Math.floor(recIQ / 5));

                        if (playState.tick % reactionTicks === 0) {
                            const rolloutDir = qbState.rolloutDir || (qbState.x > CENTER_X ? 1 : -1);
                            const distFromLOS = pState.y - LOS;

                            if (distFromLOS > 14) {
                                pState.targetX = qbState.x + (rolloutDir * 6);
                                pState.targetY = Math.max(LOS + 5, pState.y - 6);
                            } else {
                                const sidelineX = rolloutDir === 1 ? FIELD_WIDTH - 4 : 4;
                                pState.targetX = sidelineX;
                                pState.targetY = pState.y + 8;
                            }
                            pState.contactReduction = 1.1;
                            break;
                        }
                    }

                    if (playState.tick % 20 === 0) {
                        let bestX = pState.x;
                        let bestY = pState.y + 2;
                        let maxDistToDef = 0;
                        const searchPoints = [
                            { x: pState.x + 4, y: pState.y + 2 }, { x: pState.x - 4, y: pState.y + 2 },
                            { x: pState.x + 3, y: pState.y - 2 }, { x: pState.x - 3, y: pState.y - 2 }
                        ];

                        searchPoints.forEach(p => {
                            if (p.x < 2 || p.x > FIELD_WIDTH - 2) return;
                            const closestDef = defenseStates.reduce((min, d) => Math.min(min, getDistance(p, d)), 100);
                            if (closestDef > maxDistToDef) {
                                maxDistToDef = closestDef;
                                bestX = p.x;
                                bestY = p.y;
                            }
                        });

                        pState.targetX = bestX;
                        pState.targetY = bestY;
                    }
                    break;
                }

                default:
                    pState.targetX = pState.x; pState.targetY = pState.y;
                    break;
            }
            return;
        }

        if (!pState.isOffense) {
            const isDL = pState.role === 'DL';
            let playDiagnosis = playType;
            let diagConfidence = 1.0;
            let diagDirection = 'center';
            let dirConfidence = 1.0;

            if (!isDL) {
                const diag = diagnosePlay(pState, playState.tick, offenseStates, playType, offensivePlayKey);
                playDiagnosis = diag.guess;
                diagConfidence = diag.confidence;
                diagDirection = diag.direction;
                dirConfidence = diag.dirConfidence;
            }

            const isRunRead = playDiagnosis === 'run';
            const isFooledByPA = (playDiagnosis === 'run' && playType === 'pass' && !isDL);
            const carrierIsPasser = ballCarrierState && !playState.handoffOccurred && !playState.fumbleOccurred;
            const isBallPastLOS = ballCarrierState && ballCarrierState.y > LOS + 0.5;
            const qbScrambling = carrierIsPasser && (isBallPastLOS || ballCarrierState.action === 'qb_scramble');
            const assignment = pState.assignment;

            if (playDiagnosis === 'read') {
                pState.action = 'idle';
                pState.targetX = pState.x;
                pState.targetY = pState.y;
                return;
            }

            let shouldPursue = false;
            if (ballCarrierState) {
                if (isBallInAir) shouldPursue = false;
                else if (isFooledByPA) shouldPursue = true;
                else if (isRunRead) shouldPursue = true;
                else if (ballCarrierState.role !== 'QB' || qbScrambling) shouldPursue = true;
                else if (assignment?.includes('blitz') || assignment?.includes('rush') || isDL) shouldPursue = true;
            }

            if (assignment?.startsWith('man_cover_') && shouldPursue && !isFooledByPA && !isDL) {
                const targetSlot = assignment.replace('man_cover_', '');
                const carrierSlot = ballCarrierState?.slot;
                if (carrierSlot !== targetSlot && !isRunRead && !qbScrambling) shouldPursue = false;
            }
            if (assignment?.startsWith('zone_') && pState.slot.startsWith('LB') && carrierIsPasser && !qbScrambling && !isFooledByPA) {
                shouldPursue = false;
            }

            if (shouldPursue && ballCarrierState) {
                const chaseTarget = (isFooledByPA ? offenseStates.find(o => o.slot.startsWith('RB')) : null) || ballCarrierState;

                if (chaseTarget) {
                    const dist = getDistance(pState, chaseTarget);
                    const iq = pState.playbookIQ || 50;

                    if (dist < 2.5) {
                        pState.targetX = chaseTarget.x;
                        pState.targetY = chaseTarget.y;
                        pState.contactReduction = 1.0;
                    } else {
                        const maxLeadTime = 1.2;
                        const leadTime = Math.min(maxLeadTime, dist / (16 + (iq / 4)));
                        let predX = chaseTarget.x + ((chaseTarget.vx || 0) * leadTime);
                        let predY = chaseTarget.y + ((chaseTarget.vy || 0) * leadTime);

                        const isOutsideRun = Math.abs(chaseTarget.x - CENTER_X) > 12.0;
                        const isWidestDefender = (chaseTarget.x > CENTER_X && pState.x >= chaseTarget.x) ||
                            (chaseTarget.x < CENTER_X && pState.x <= chaseTarget.x);

                        if (isOutsideRun && isWidestDefender && pState.role === 'DB' && iq > 55) {
                            const boundaryBias = chaseTarget.x > CENTER_X ? 2.5 : -2.5;
                            predX = Math.max(2.0, Math.min(FIELD_WIDTH - 2.0, chaseTarget.x + boundaryBias));
                            predY = Math.max(chaseTarget.y + 1.0, predY);
                        }

                        if (dirConfidence > 0.45 && !isFooledByPA) {
                            const cheatAmount = 4.0 * dirConfidence * (iq / 100);
                            if (diagDirection === 'right' && predX < FIELD_WIDTH - 5) predX += cheatAmount;
                            else if (diagDirection === 'left' && predX > 5) predX -= cheatAmount;
                        }

                        if (iq > 65 && dist > 5.0) {
                            if (predX > CENTER_X && pState.x < predX) predX -= 1.5;
                            else if (predX <= CENTER_X && pState.x > predX) predX += 1.5;
                        }

                        pState.targetX = predX;
                        pState.targetY = predY;
                        pState.contactReduction = 0.6 + (diagConfidence * 0.4);
                    }

                    pState.action = 'pursuit';
                    if (isFooledByPA && !pState.loggedPA && gameLog && Math.random() < 0.05) {
                        pushGameLog(gameLog, `[Tick ${playState.tick}] 🎣 ${pState.name} bites on the play action!`, playState);
                        pState.loggedPA = true;
                    }
                }
            } else if (isBallInAir) {
                const iq = pState.playbookIQ || 50;
                const flightTime = playState.tick - (playState.ballState.throwTick || 0);
                const reactionDelay = Math.max(2, 12 - Math.floor(iq / 10));

                if (flightTime > reactionDelay) {
                    if (ballPos.isThrowAway) {
                        pState.action = 'idle';
                        pState.targetX = pState.x; pState.targetY = pState.y;
                    } else {
                        const targetRec = offenseStates.find(o => o.id === ballPos.targetPlayerId);
                        if (targetRec && iq > 60) {
                            pState.targetX = (ballPos.targetX * 0.7) + (targetRec.x * 0.3);
                            pState.targetY = (ballPos.targetY * 0.7) + (targetRec.y * 0.3);
                            if (pState.slot === 'DB3' || pState.role === 'S') pState.targetY += 1.5;
                        } else {
                            pState.targetX = ballPos.targetX;
                            pState.targetY = ballPos.targetY;
                        }
                        pState.action = 'tracking_ball';
                    }
                } else {
                    executeAssignment(pState, assignment, offenseStates, LOS, playState, ballCarrierState);
                }
            } else {
                executeAssignment(pState, assignment, offenseStates, LOS, playState, ballCarrierState);
            }

            pState.targetX = Math.max(1, Math.min(52.3, pState.targetX));
            pState.targetY = Math.max(1, Math.min(119.0, pState.targetY));
        }
    });
}

export function executeAssignment(pState, assignment, offenseStates, LOS, playState, ballCarrierState) {
    const isBallInAir = playState.ballState.inAir;

    if (pState.role === 'DB' && assignment.includes('zone_deep') && !assignment.includes('blitz')) {
        const safetyHelp = calculateSafetyHelp(pState, playState.activePlayers.filter(p => !p.isOffense), offenseStates, null, playState, isBallInAir);
        if (safetyHelp && safetyHelp.type === 'help') {
            pState.targetX = safetyHelp.helpX;
            pState.targetY = safetyHelp.helpY;
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
            const defIQ = pState.playbookIQ || 50;
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
                targetRec.jammedTicks = 15;
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
    } else if (assignment?.startsWith('zone_')) {
        const zone = zoneBoundaries[assignment];
        const zoneCenter = getZoneCenter(assignment, LOS);
        const isDeep = assignment.includes('deep') || pState.slot.startsWith('S');

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
                pState.targetX = primaryThreat.x + insideLeverageX;
                pState.targetY = Math.max(zoneCenter.y, primaryThreat.y + 3.5);
            } else {
                pState.targetX = primaryThreat.x;
                pState.targetY = primaryThreat.y - 1.5;
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
                if (qb) driftX += (qb.x < CENTER_X ? -1.5 : 1.5);

                pState.dynamicTargetX = driftX + (Math.random() - 0.5) * 2;
                pState.dynamicTargetY = zoneCenter.y + (Math.random() - 0.5) * 1.5;
            }
            pState.targetX = pState.dynamicTargetX || zoneCenter.x;
            pState.targetY = pState.dynamicTargetY || zoneCenter.y;
        }
    } else if (assignment === 'spy_QB') {
        const target = ballCarrierState && ballCarrierState.y < LOS + 1
            ? ballCarrierState
            : offenseStates.find(p => p.slot === 'QB1');

        if (target) {
            pState.targetX = target.x;
            pState.targetY = Math.max(LOS + 3.0, pState.y);
        }
    } else if (assignment?.includes('rush') || assignment?.includes('blitz') || assignment?.includes('run_gap')) {
        if (playState.handoffOccurred && ballCarrierState) {
            pState.targetX = ballCarrierState.x;
            pState.targetY = ballCarrierState.y;
        } else {
            const qb = offenseStates.find(p => p.slot.startsWith('QB'));
            if (qb) {
                const isEdgeRusher = Math.abs(pState.initialX - qb.initialX) >= 3.5;
                if (isEdgeRusher) {
                    const escapeAngle = pState.initialX < qb.initialX ? -1 : 1;
                    const rusherIQ = pState.playbookIQ || 50;
                    const isDisciplined = rusherIQ > 55 || Math.random() < (rusherIQ / 100);

                    if (isDisciplined) {
                        pState.targetX = qb.x + (escapeAngle * 4.0);
                        pState.targetY = Math.max(qb.y - 1.5, pState.y - 0.5);
                    } else {
                        pState.targetX = qb.x + (escapeAngle * 0.8);
                        pState.targetY = qb.y - 2.0;
                    }
                } else {
                    const dx = qb.x - pState.x;
                    pState.targetX = qb.x + (dx * 0.5);
                    pState.targetY = qb.y - 2.0;
                }
            } else {
                pState.targetX = pState.x;
                pState.targetY = LOS - 5;
            }
        }
    }
}
