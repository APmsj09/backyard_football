import { getDistance } from './physics.js';
import { getRandomInt, formatHeight } from '../utils.js';
import { getPlayer } from './state.js';
import { logPlayDebug } from './telemetry.js';

const FIELD_WIDTH = 53.3;
const FIELD_LENGTH = 120;
const TACKLE_RANGE = 2.2;
const FUMBLE_CHANCE_BASE = 0.015;
const DEBUG_MODE = false;

export function pushGameLog(gameLog, message, playState = null) {
    if (!gameLog) return;
    const last = gameLog[gameLog.length - 1];
    if (last === message) return;

    if (playState) {
        playState._logged = playState._logged || new Set();
        if (playState._logged.has(message)) return;
        playState._logged.add(message);
    }

    gameLog.push(message);
}

export function checkFumble(ballCarrierState, tacklerState, playState, gameLog) {
    if (!ballCarrierState.hasBall) return false;

    const toughness = Number(ballCarrierState.toughness) || 50;
    const strength = Number(tacklerState.strength) || 50;
    const tackling = Number(tacklerState.tackling) || 50;

    const carrierMod = (toughness / 100) * (ballCarrierState.fatigueModifier || 1);
    const tacklerMod = ((strength + tackling) / 200) * (tacklerState.fatigueModifier || 1);

    let fumbleChance = FUMBLE_CHANCE_BASE * (tacklerMod / (carrierMod + 0.2));

    if (ballCarrierState.role === 'QB' && ballCarrierState.action === 'qb_setup') {
        fumbleChance *= 2.5;
    }

    if (Math.random() < fumbleChance) {
        playState.ballState.lastDroppedById = ballCarrierState.id;
        playState.ballState.droppedTick = playState.tick;

        if (gameLog) {
            const hitPower = Math.round(((strength + tackling) / 2) * tacklerState.fatigueModifier);
            const security = Math.round(toughness * ballCarrierState.fatigueModifier);
            const actionX = ballCarrierState.x.toFixed(1);
            const actionY = ballCarrierState.y.toFixed(1);
            const yardage = (ballCarrierState.y - playState.lineOfScrimmage).toFixed(1);

            gameLog.push(`[Tick ${playState.tick}] ❗ FUMBLE! ${tacklerState.name} jars it loose at (${actionX}, ${actionY}) | Gain: ${yardage}y | (Hit: ${hitPower} vs Sec: ${security})`);
        }

        playState.fumbleOccurred = true;
        playState.ballState.isLoose = true;
        playState.ballState.inAir = false;

        const dx = ballCarrierState.x - tacklerState.x;
        const dy = ballCarrierState.y - tacklerState.y;
        playState.ballState.vx = dx * 2;
        playState.ballState.vy = dy * 2;
        playState.ballState.x = ballCarrierState.x;
        playState.ballState.y = ballCarrierState.y;
        playState.ballState.z = 0.5;

        ballCarrierState.isBallCarrier = false;
        ballCarrierState.hasBall = false;
        ballCarrierState.stunnedTicks = 40;
        tacklerState.stunnedTicks = 10;

        playState.statEvents.push({
            type: 'fumble',
            playerId: ballCarrierState.id
        });

        return true;
    }
    return false;
}

export function checkBlockCollisions(playState, gameLog = null) {
    const blockers = playState.activePlayers.filter(p => p.isOffense && !p.isEngaged && p.stunnedTicks === 0);
    const defenders = playState.activePlayers.filter(p => !p.isOffense && p.stunnedTicks <= 0 && !p.isEngaged);

    blockers.forEach(blocker => {
        const isBlockingDuty = blocker.action.includes('block') ||
            (blocker.assignment && (blocker.assignment.includes('pull') || blocker.assignment.includes('lead') || blocker.assignment.includes('screen_block')));

        if (!isBlockingDuty) return;

        let target = null;
        const imminentThreat = defenders
            .filter(d => getDistance(blocker, d) < 1.8 && d.y > blocker.y - 1.5)
            .sort((a, b) => getDistance(blocker, a) - getDistance(blocker, b))[0];

        if (imminentThreat && !imminentThreat.isEngaged && !imminentThreat.isBlocked) {
            target = imminentThreat;
        } else if (blocker.dynamicTargetId) {
            target = defenders.find(d => d.id === blocker.dynamicTargetId);
            if (!target || target.isEngaged || getDistance(blocker, target) > 3.0) {
                target = null;
            }
        }

        if (target) {
            const blockerStr = blocker.str || blocker.strength || 50;
            const targetStr = target.str || target.strength || 50;
            const targetSpd = target.spd || target.speed || 50;
            const blockerAgi = blocker.agi || blocker.agility || 50;
            const isPassRush = target.assignment?.includes('rush') || target.assignment?.includes('blitz');

            // 1. Speed Edge Dip: Fast rusher blows by the tackle on the outside arc
            const isEdgeAlignment = Math.abs(target.initialX - blocker.initialX) > 1.4;
            if (isPassRush && isEdgeAlignment && targetSpd > blockerAgi + 14 && Math.random() < 0.28) {
                blocker.stunnedTicks = 12;
                target.action = 'pursuit';

                logPlayDebug('TRENCH_EDGE_BURN', `${target.name} beat ${blocker.name} with pure edge speed`, {
                    rusherSpeed: targetSpd,
                    blockerAgility: blockerAgi,
                    speedDelta: targetSpd - blockerAgi
                });

                if (gameLog && Math.random() < 0.25) {
                    pushGameLog(gameLog, `[Tick ${playState.tick}] ⚡ ${target.name} burns ${blocker.name} around the edge with pure speed!`, playState);
                }
                return;
            }

            const strDiff = blockerStr - targetStr;

            blocker.isEngaged = true;
            blocker.engagedWith = target;
            target.isEngaged = true;
            target.isBlocked = true;
            target.blockedBy = blocker;

            playState.blockBattles.push({
                blocker: blocker,
                defender: target,
                status: 'ongoing',
                battleScore: strDiff / 10,
                startTick: playState.tick
            });
        }
    });
}

export function checkTackleCollisions(playState, gameLog) {
    const carrier = playState.activePlayers.find(p => p.hasBall === true && !playState.ballState.isLoose);
    if (!carrier) return false;

    const tacklingTeam = playState.activePlayers.filter(p => p.isOffense !== carrier.isOffense);

    const defenders = tacklingTeam.filter(p => {
        if (p.stunnedTicks > 0) return false;
        const dist = p._distToCarrier;
        if (dist === undefined || dist > TACKLE_RANGE) return false;

        if (p.isBlocked || p.isEngaged) {
            const blocker = p.blockedBy || p.engagedWith;
            if (blocker && typeof blocker === 'object') {
                const distToBlocker = getDistance(p, blocker);
                if (dist > distToBlocker) {
                    const dxC = carrier.x - p.x;
                    const dyC = carrier.y - p.y;
                    const dxB = blocker.x - p.x;
                    const dyB = blocker.y - p.y;
                    const dot = (dxC * dxB + dyC * dyB) / (dist * distToBlocker);
                    if (dot > 0.4) return false;
                }
            }
            return dist < 0.5;
        }
        return true;
    });

    for (const defender of defenders) {
        const distance = getDistance(carrier, defender);

        if (distance < 1.4) {
            const canPerformMove = (!carrier.moveCooldown || carrier.moveCooldown <= 0) && carrier.action !== 'handoff_setup';

            if (canPerformMove) {
                const agiDiff = (carrier.agi || 50) - (defender.tkl || 50);
                const strDiff = (carrier.str || 50) - (defender.str || 50);
                const evadeChance = Math.max(0.05, Math.min(0.35, 0.16 + (Math.max(agiDiff, strDiff) / 250)));

                if (Math.random() < evadeChance) {
                    carrier.moveCooldown = 35;
                    carrier.tacklesBrokenThisPlay = (carrier.tacklesBrokenThisPlay || 0) + 1;

                    if (strDiff > agiDiff && strDiff > 10) {
                        carrier.action = 'stiff_arm';
                        defender.stunnedTicks = 20;
                        if (gameLog) pushGameLog(gameLog, `💪 ${carrier.name} stiff-arms ${defender.name}!`, playState);
                    } else {
                        const dir = Math.random() > 0.5 ? 1 : -1;
                        carrier.action = dir === 1 ? 'juke_right' : 'juke_left';
                        carrier.x += dir * 0.9;
                        defender.stunnedTicks = 18;
                        if (gameLog) pushGameLog(gameLog, `⚡ ${carrier.name} shakes free with a quick cut!`, playState);
                    }
                    continue;
                }
            }
        }

        if (checkFumble(carrier, defender, playState, gameLog)) {
            return false;
        }

        const runnerVel = Math.max(1.0, Math.hypot(carrier.vx || 0, carrier.vy || 0));
        const tacklerVel = Math.max(1.0, Math.hypot(defender.vx || 0, defender.vy || 0));

        const rMomentum = (carrier.wgt || 200) * runnerVel;
        const tMomentum = (defender.wgt || 200) * tacklerVel;

        const tPower = ((defender.tkl || 50) * 0.6) + ((defender.str || 50) * 0.4);
        const rPower = ((carrier.agi || 50) * 0.5) + ((carrier.str || 50) * 0.5);

        let successChance = 0.65;
        const momRatio = tMomentum / Math.max(1, rMomentum);
        successChance += (momRatio - 1.0) * 0.2;

        const defendersInRange = tacklingTeam.filter(d => d.stunnedTicks === 0 && !isNaN(d._distToCarrier) && d._distToCarrier < TACKLE_RANGE);
        if (defendersInRange.length > 1) {
            successChance += 0.35;
        }

        successChance += (tPower - rPower) * 0.005;

        const brokenCount = carrier.tacklesBrokenThisPlay || 0;
        successChance += (brokenCount * 0.25);

        successChance = Math.max(0.10, Math.min(0.95, successChance));
        if (isNaN(successChance)) successChance = 0.65;

        logPlayDebug('TACKLE_CALC', `${defender.name} vs ${carrier.name}`, {
            distance: Number(distance.toFixed(2)),
            successChance: `${Math.round(successChance * 100)}%`,
            carrierBrokenTackles: carrier.tacklesBrokenThisPlay || 0
        });

        if (Math.random() < successChance) {
            playState.playIsLive = false;
            playState.yards = carrier.y - playState.lineOfScrimmage;
            playState.finalBallY = carrier.y;
            playState.statEvents.push({ type: 'tackle', playerId: defender.id });

            const inOwnEndzone = (carrier.isOffense && carrier.y <= 10.0) || (!carrier.isOffense && carrier.y >= 110.0);
            const caughtInEndzone = playState.returnStartY !== null && ((carrier.isOffense && playState.returnStartY <= 10.0) || (!carrier.isOffense && playState.returnStartY >= 110.0));

            if (inOwnEndzone) {
                if (caughtInEndzone) { playState.touchback = true; playState.finalBallY = carrier.isOffense ? 20 : 100; }
                else { playState.safety = true; playState.finalBallY = carrier.isOffense ? 0 : 120; }
            } else if (carrier.role === 'QB' && carrier.y < playState.lineOfScrimmage && playState.type === 'pass') {
                playState.sack = true;
                playState.statEvents.push({ type: 'sack', playerId: defender.id, qbId: carrier.id });
                logPlayDebug('QB_SACK', `${defender.name} sacked ${carrier.name} for loss`, {
                    lossYards: Number((playState.lineOfScrimmage - carrier.y).toFixed(1)),
                    tacklerStrength: defender.str || 50
                });
            }

            if (gameLog) {
                const hitForce = Math.round(tMomentum / 10);
                const type = playState.sack ? '💥 SACK' : '✋ TACKLE';
                const gainYards = (carrier.y - playState.lineOfScrimmage).toFixed(1);
                pushGameLog(gameLog, `[Tick ${playState.tick}] ${type} by ${defender.name} on ${carrier.name} | Gain: ${gainYards}y (Force: ${hitForce})`, playState);
            }
            return true;

        } else {
            carrier.tacklesBrokenThisPlay = brokenCount + 1;
            defender.stunnedTicks = 40;

            const speedDrain = Math.max(0.40, (defender.wgt / carrier.wgt) * 0.40);
            carrier.vx *= (1 - speedDrain);
            carrier.vy *= (1 - speedDrain);
            carrier.moveCooldown = 15;

            if (carrier.role === 'QB' && carrier.action === 'qb_setup' && carrier.y < playState.lineOfScrimmage) {
                carrier.action = 'qb_scramble';
                carrier.rolloutDir = carrier.x > (FIELD_WIDTH / 2) ? -1 : 1;
            }

            if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] 💪 ${carrier.name} runs THROUGH ${defender.name}!`, playState);
            break;
        }
    }
    return false;
}

export function checkFumbleRecovery(playState, gameLog, tackleRange) {
    if (!playState.ballState.isLoose) return null;
    const ballPos = playState.ballState;

    const playersInRange = playState.activePlayers.filter(p =>
        p.stunnedTicks === 0 &&
        !p.isEngaged &&
        getDistance(p, ballPos) < tackleRange
    );

    if (playersInRange.length === 0) return null;

    let bestPlayer = null;
    let maxScore = -Infinity;

    playersInRange.forEach(p => {
        const skill = (p.agility * 0.4) + (p.catchingHands * 0.4) + (p.toughness * 0.2);
        const distance = getDistance(p, ballPos);
        const proximityBonus = (tackleRange - distance) * 50;
        const roll = getRandomInt(-10, 10);
        const finalScore = skill + proximityBonus + roll;

        if (finalScore > maxScore) {
            maxScore = finalScore;
            bestPlayer = p;
        }
    });

    if (!bestPlayer) return null;

    const offenseTeamId = playState.activePlayers.find(p => p.isOffense)?.teamId;
    const possessionChange = bestPlayer.teamId !== offenseTeamId;

    return {
        playerState: bestPlayer,
        possessionChange,
        recoveryTeamId: bestPlayer.teamId
    };
}

export function resolveBattle(powerA, powerB, battle) {
    const BASE_DIFF = powerA - powerB;
    const roll = getRandomInt(-10, 10);
    const finalDiff = (BASE_DIFF + roll) / 350;
    battle.battleScore += finalDiff;

    const WIN_SCORE = 15;
    if (battle.battleScore > WIN_SCORE) {
        battle.status = 'win_A';
    } else if (battle.battleScore < -WIN_SCORE) {
        battle.status = 'win_B';
    } else {
        battle.status = 'ongoing';
    }
    return finalDiff;
}

export function resolveOngoingBlocks(playState, gameLog, offenseStates = [], defenseStates = []) {
    const battlesToRemove = [];
    const ballCarrier = playState.activePlayers.find(p => p.isBallCarrier);

    playState.blockBattles.forEach((battle, index) => {
        if (battle.startTick === playState.tick) return;

        if (battle.status !== 'ongoing') {
            battlesToRemove.push(index);
            return;
        }

        const blocker = battle.blocker;
        const defender = battle.defender;

        if (!blocker || !defender ||
            blocker.engagedWith !== defender ||
            defender.blockedBy !== blocker ||
            blocker.stunnedTicks > 0 || defender.stunnedTicks > 0) {

            if (blocker) { blocker.engagedWith = null; blocker.isEngaged = false; }
            if (defender) { defender.isBlocked = false; defender.blockedBy = null; defender.isEngaged = false; }

            battle.status = 'disengaged';
            battlesToRemove.push(index);
            return;
        }

        if (ballCarrier) {
            const distToCarrier = getDistance(defender, ballCarrier);
            if (distToCarrier < 1.5) {
                const reactionScore = (defender.playbookIQ || 50) + (defender.blockShedding || 50);
                if (reactionScore + getRandomInt(0, 50) > 100) {
                    battle.status = 'win_B';
                    defender.action = 'pursuit';
                    blocker.stunnedTicks = 10;
                }
            }
        }

        let blockPower = (((blocker.blocking || 50) * 1.25) + (blocker.strength || 50)) * blocker.fatigueModifier;
        let shedPower = ((defender.blockShedding || 50) + (defender.strength || 50)) * defender.fatigueModifier;

        if (playState.playKey?.includes('Screen') && playState.tick < 20) {
            blockPower *= 0.1;
        }

        const ticksInBlock = playState.tick - battle.startTick;
        if (ticksInBlock < 35) {
            // Give pass blockers solid early-snap anchor so QBs can complete 3-step drops
            blockPower *= 1.60;
        }

        if (ticksInBlock > 60) {
            const fatiguePenalty = 1.0 - ((ticksInBlock - 60) * 0.01);
            blockPower *= Math.max(0.5, fatiguePenalty);
        }

        const isPassRush = defender.assignment?.includes('rush') || defender.assignment?.includes('blitz');

        if (isPassRush && defender.isBlocked && blocker) {
            if (typeof defender.moveCooldown === 'undefined') defender.moveCooldown = 15;

            if (defender.moveCooldown > 0) {
                defender.moveCooldown--;
            } else {
                const qbState = offenseStates?.find(p => p.slot?.startsWith?.('QB'));
                if (qbState) {
                    const technique = (defender.blockShedding ?? 50) + (defender.playbookIQ ?? 50);
                    const escapeScore = technique + getRandomInt(-30, 30);
                    const dx = qbState.x - defender.x;
                    const dy = qbState.y - defender.y;
                    const dist = Math.max(0.1, Math.hypot(dx, dy));
                    const dirX = dx / dist;
                    const dirY = dy / dist;

                    if (escapeScore > 120 && Math.random() < 0.005) {
                        defender.x += dirX * 0.6;
                        defender.y += dirY * 0.6;
                        blocker.stunnedTicks = 10;
                        battle.battleScore -= 4.0;
                        defender.moveCooldown = 20;
                    } else if (escapeScore > 130 && Math.random() < 0.003) {
                        const bx = blocker.x - defender.x;
                        const by = blocker.y - defender.y;
                        defender.x += -by * 0.15;
                        defender.y += bx * 0.15;
                        blocker.stunnedTicks = 5;
                        battle.battleScore -= 4.0;
                        defender.moveCooldown = 20;
                    }
                }
            }
        }

        let pushAmount = 0;
        if (battle.status === 'ongoing') {
            pushAmount = resolveBattle(blockPower, shedPower, battle);

            if (battle.status === 'ongoing') {
                const defStr = defender.strength || defender.str || 50;
                const blkStr = blocker.strength || blocker.str || 50;

                let dx = defender.x - blocker.x;
                let dy = defender.y - blocker.y;

                // 2. Bulldozer Bull Rush: Massive DL pushes blocker straight back toward the QB
                if (isPassRush && defStr > blkStr + 20) {
                    const qb = offenseStates?.find(p => p.slot?.startsWith('QB'));
                    if (qb) {
                        dx = qb.x - defender.x;
                        dy = qb.y - defender.y;
                    }
                    pushAmount = Math.max(0.2, pushAmount + 0.15);

                    if (!battle.loggedBullRush) {
                        logPlayDebug('TRENCH_BULL_RUSH', `${defender.name} is walking ${blocker.name} back to the QB!`, { defStr, blkStr });
                        battle.loggedBullRush = true;
                    }
                }

                const dist = Math.max(0.1, Math.sqrt(dx * dx + dy * dy));

                // Battle score is a gameplay calculation, not a physical distance.
                // Cap the displacement to prevent large per-tick jumps.
                const pushDirection = Math.sign(pushAmount);
                const pushMagnitude =
                    Math.min(0.08, Math.abs(pushAmount) * 0.15) * pushDirection;

                const pushX = (dx / dist) * pushMagnitude;
                const pushY = (dy / dist) * pushMagnitude;

                // The player losing the battle should visibly give ground.
                blocker.x += pushX;
                blocker.y += pushY;

                // The opponent moves too, but much less.
                defender.x += pushX * 0.25;
                defender.y += pushY * 0.25;
            }
        }

        if (battle.status === 'win_B') {
            const dur = playState.tick - battle.startTick;
            if (dur < 15 && (defender.blockShedding || 0) < 90) {
                battle.status = 'ongoing';
                return;
            }
            if (isPassRush) logPlayDebug('BLOCK_SHED', `${defender.name} defeated ${blocker.name}'s block`, { durationTicks: dur });
            blocker.engagedWith = null; blocker.isEngaged = false;
            blocker.stunnedTicks = 15;
            defender.stunnedTicks = 0;
            defender.isBlocked = false; defender.blockedBy = null; defender.isEngaged = false;
            defender.action = 'pursuit';
            battlesToRemove.push(index);
        } else if (battle.status === 'win_A') {
            const dur = playState.tick - battle.startTick;
            logPlayDebug('PANCAKE_BLOCK', `${blocker.name} flattened ${defender.name}`, { durationTicks: dur });
            defender.stunnedTicks = 40;
            blocker.engagedWith = null; blocker.isEngaged = false;
            defender.isBlocked = false; defender.blockedBy = null; defender.isEngaged = false;
            battlesToRemove.push(index);
        }
    });

    for (let i = battlesToRemove.length - 1; i >= 0; i--) {
        playState.blockBattles.splice(battlesToRemove[i], 1);
    }
}

export function resolvePlayerCollisions(playState) {
    const players = playState.activePlayers;
    const BASE_RADIUS = 0.45;

    for (let i = 0; i < players.length; i++) {
        const p1 = players[i];
        for (let j = i + 1; j < players.length; j++) {
            const p2 = players[j];

            if (p1.id === p2.id) continue;
            if (p1.ghostTicks > 0 || p2.ghostTicks > 0) continue;
            if (p1.engagedWith === p2) continue;

            const isHandoffPair = (p1.role === 'QB' && p2.role === 'RB') || (p1.role === 'RB' && p2.role === 'QB');
            if (isHandoffPair && playState.handoffRequired && !playState.handoffOccurred) {
                continue;
            }

            const dx = p1.x - p2.x;
            const dy = p1.y - p2.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            let r1 = BASE_RADIUS + ((p1.weight || 200) / 1000);
            let r2 = BASE_RADIUS + ((p2.weight || 200) / 1000);
            let combinedRadius = r1 + r2;

            if (dist < combinedRadius && dist > 0.01) {
                const overlap = combinedRadius - dist;
                p1.isSqueezing = true;
                p2.isSqueezing = true;

                const totalWeight = (p1.weight || 200) + (p2.weight || 200);
                let pushFactorP1 = ((p2.weight || 200) / totalWeight) * 0.20;
                let pushFactorP2 = ((p1.weight || 200) / totalWeight) * 0.20;

                // If one player is settled holding station (QB in pocket / settled WR), 
                // the active moving player absorbs the separation so the settled player doesn't vibrate
                const p1Settled = p1.movementMode === 'HOLD' && p1._intent?.settled;
                const p2Settled = p2.movementMode === 'HOLD' && p2._intent?.settled;

                if (p1Settled && !p2Settled) {
                    pushFactorP1 = 0.0;
                    pushFactorP2 = 0.35;
                } else if (p2Settled && !p1Settled) {
                    pushFactorP1 = 0.35;
                    pushFactorP2 = 0.0;
                }

                const pushX = (dx / dist) * overlap;
                const pushY = (dy / dist) * overlap;

                p1.x += pushX * pushFactorP1;
                p1.y += pushY * pushFactorP1;
                p2.x -= pushX * pushFactorP2;
                p2.y -= pushY * pushFactorP2;
            }
        }
    }
}

export function handleBallArrival(playState, carrier, playResult, gameLog) {
    const ball = playState.ballState;
    if (!ball.inAir && !ball.isLoose) return;

    if (ball.isSwatted) {
        if (ball.z <= 0) {
            ball.z = 0;
            ball.vz = 0;

            if (playState.type === 'pass' && !ball.isLoose && playState.playIsLive) {
                playState.playIsLive = false;
                playState.incomplete = true;
                playState.finalBallY = playState.lineOfScrimmage;
                if (gameLog && !ball.isThrowAway) pushGameLog(gameLog, `[Tick ${playState.tick}] ⏱️ Pass hits the turf. Incomplete.`, playState);
            }
        }
        return;
    }

    const pointToSegmentDist = (px, py, x1, y1, x2, y2) => {
        const A = px - x1; const B = py - y1; const C = x2 - x1; const D = y2 - y1;
        const dot = A * C + B * D; const lenSq = C * C + D * D;
        let param = lenSq !== 0 ? dot / lenSq : -1;
        if (param < 0) param = 0; else if (param > 1) param = 1;
        const dx = px - (x1 + param * C); const dy = py - (y1 + param * D);
        return Math.sqrt(dx * dx + dy * dy);
    };

    const BASE_CATCH_RADIUS = 0.45;

    const playersInRange = playState.activePlayers.filter(p => {
        if (ball.isLoose && p.id === ball.lastDroppedById) {
            const ticksSinceDrop = playState.tick - (ball.droppedTick || 0);
            if (ticksSinceDrop < 25) return false;
        }

        const ticksSinceKick = playState.tick - (ball.throwTick || 0);
        if (p.id === ball.throwerId && ticksSinceKick < 20) return false;

        if (playState.type === 'punt' && p.isOffense && ball.z > 0.5) return false;
        if (ball.droppedById === p.id) return false;

        if (p.isOffense && p.slot.startsWith('OL') && playState.type === 'pass' && !ball.isLoose && !ball.tipCount) {
            return false;
        }

        if (p.isOffense && playState.type === 'pass' && !ball.isLoose && !ball.tipCount) {
            if (p.id !== ball.targetPlayerId) {
                const targetPlayer = playState.activePlayers.find(t => t.id === ball.targetPlayerId);
                if (targetPlayer) {
                    const distToTarget = Math.sqrt((p.x - targetPlayer.x) ** 2 + (p.y - targetPlayer.y) ** 2);
                    if (distToTarget > 4.0) return false;
                }
            }
        }

        let playerHeight = p.hgt || p.height || 70;
        if (!p.hgt && !p.height) {
            if (p.attributes?.physical?.height) {
                playerHeight = p.attributes.physical.height;
            } else {
                const pObj = getPlayer(p.id);
                if (pObj?.attributes?.physical?.height) playerHeight = pObj.attributes.physical.height;
            }
        }

        const maxCatchHeight = (playerHeight / 36) + 1.2;
        if (ball.inAir && ball.z > maxCatchHeight) return false;

        const heightBonus = Math.max(0, (playerHeight - 65) * 0.04);
        let dynamicCatchRadius = BASE_CATCH_RADIUS + heightBonus;
        const CATCH_TOLERANCE = 0.25;

        if (p.action === 'tracking_ball') dynamicCatchRadius *= 1.8;

        const distNow = Math.sqrt((p.x - ball.x) ** 2 + (p.y - ball.y) ** 2);
        if (distNow <= (dynamicCatchRadius + CATCH_TOLERANCE)) return true;

        if (typeof ball.prevX === 'number' && typeof ball.prevY === 'number') {
            const segDist = pointToSegmentDist(p.x, p.y, ball.prevX, ball.prevY, ball.x, ball.y);
            if (segDist <= (dynamicCatchRadius + CATCH_TOLERANCE)) return true;
        }
        return false;
    });

    if (!ball.isThrowAway && playersInRange.length > 0) {
        let bestCandidate = null;
        let highestRoll = -Infinity;

        playersInRange.forEach(p => {
            let posScore = ((p.ctch || p.catchingHands || 50) * 0.4) + ((p.agi || p.agility || 50) * 0.2);

            if (p.id === ball.targetPlayerId) {
                posScore += 50;
            } else if (!p.isOffense) {
                posScore += ((p.cov || p.coverage || 50) * 0.3) + ((p.iq || p.playbookIQ || 50) * 0.3);
            }

            posScore += ((p.hgt || 70) > 74 ? 15 : 0);

            const roll = posScore + (Math.random() * 100);
            if (roll > highestRoll) {
                highestRoll = roll;
                bestCandidate = p;
            }
        });

        let catching = bestCandidate.ctch || bestCandidate.catchingHands;
        let agility = bestCandidate.agi || bestCandidate.agility;

        if (catching === undefined) {
            if (bestCandidate.attributes) {
                catching = bestCandidate.attributes.technical?.catchingHands || 50;
                agility = bestCandidate.attributes.physical?.agility || 50;
            } else {
                const pObj = getPlayer(bestCandidate.id);
                if (pObj) {
                    catching = pObj.attributes?.technical?.catchingHands || 50;
                    agility = pObj.attributes?.physical?.agility || 50;
                } else {
                    catching = 50; agility = 50;
                }
            }
        }

        const hndEff = Math.round(catching * (bestCandidate.fatigueModifier || 1));
        const fatPct = Math.round((bestCandidate.fatigueModifier || 1) * 100);
        const isDefense = !bestCandidate.isOffense;

        // Base catch: Give a higher floor so wide-open players don't drop everything
        let catchScore = (catching * 0.50) + (agility * 0.20) + 40;

        const defendersNear = playersInRange.filter(p => !p.isOffense).length;
        const attackersNear = playersInRange.filter(p => p.isOffense).length;

        if (isDefense) {
            const isPunt = playState.type === 'punt';
            const ticksInAir = playState.tick - (ball.throwTick || 0);
            const floatBonus = ticksInAir > 40 ? 15 : 0;
            const handsFactor = Math.min(1.0, catching / 70);

            if (isPunt) {
                catchScore = (catchScore * 0.85) + 20; // Punt returns are standard catches
                logPlayDebug('PUNT_CATCH_ATTEMPT', `${bestCandidate.name} fielding punt`, {
                    catchProbability: `${Math.round(catchScore)}%`,
                    hands: hndEff
                });
            } else {
                catchScore = (catchScore * (0.25 * handsFactor)) + floatBonus;
                if (attackersNear > 0) catchScore *= 0.50;

                logPlayDebug('DEF_BALL_ATTEMPT', `${bestCandidate.name} attempted INT/Swat`, {
                    intProbability: `${Math.round(catchScore)}%`,
                    hands: hndEff,
                    floatBonusActive: floatBonus > 0,
                    attackersContesting: attackersNear
                });
            }
        } else {
            // Offensive Catch logic
            if (defendersNear === 1) {
                catchScore -= 20; // Contested catch penalty
            } else if (defendersNear >= 2) {
                catchScore -= 45; // Double coverage penalty
            } else {
                catchScore += 15; // "Wide Open" bonus!
            }

            logPlayDebug('REC_CATCH_ATTEMPT', `${bestCandidate.name} attempted catch`, {
                finalCatchOdds: `${Math.round(catchScore)}%`,
                baseHands: hndEff,
                defendersClosingIn: defendersNear,
                isWideOpen: defendersNear === 0
            });
        }

        if (playState.type === 'punt') catchScore += 15;

        const ticksInAir = playState.tick - (ball.throwTick || 0);
        if (ticksInAir < 15 && isDefense && playState.type === 'pass') {
            if (bestCandidate.role === 'DL') catchScore *= 0.10;
            else catchScore *= 0.60;
        }

        catchScore = Math.max(1.0, Math.min(100.0, catchScore));

        if (Math.random() * 100 < catchScore) {
            const isOutOfBounds = bestCandidate.y >= 120 || bestCandidate.y <= 0 ||
                bestCandidate.x >= FIELD_WIDTH || bestCandidate.x <= 0;

            if (isOutOfBounds) {
                ball.isSwatted = true;
                ball.vz = -2;
                if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] 🚩 OUT OF BOUNDS! ${bestCandidate.name} caught it out of bounds.`, playState);
                return;
            }

            ball.inAir = false;
            ball.isLoose = false;
            ball.x = bestCandidate.x;
            ball.y = bestCandidate.y;
            ball.z = 1.0;
            ball.vx = 0; ball.vy = 0; ball.vz = 0;

            bestCandidate.hasBall = true;
            bestCandidate.isBallCarrier = true;
            bestCandidate.action = 'run_path';

            if (bestCandidate.vy < 0) {
                bestCandidate.vy *= 0.1;
                bestCandidate.vx *= 0.3;
                bestCandidate.vy += (1.5 + (agility / 100));
                bestCandidate.contactReduction = 0.5;
            }

            playState.activePlayers.forEach(p => {
                if (p.isOffense !== bestCandidate.isOffense) {
                    p.action = 'pursuit';
                    p.snapReactionTimer = 0;
                }
            });

            if (playState.type === 'punt' && !bestCandidate.isOffense) {
                if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] 🏈 ${bestCandidate.name} catches the punt! Return started.`, playState);
                playState.possessionChanged = true;
                playState.returnStartY = bestCandidate.y;
                return;
            }

            const actionX = ball.x.toFixed(1);
            const actionY = ball.y.toFixed(1);
            const actionZ = ball.z.toFixed(1);

            if (isDefense) {
                if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] ❗ INTERCEPTION! ${bestCandidate.role} ${bestCandidate.name} at (${actionX}, ${actionY})`, playState);
                playState.interceptionOccurred = true;
                playState.possessionChanged = true;
                playState.turnover = true;
                playState.returnStartY = bestCandidate.y;
                playState.statEvents.push({ type: 'interception', interceptorId: bestCandidate.id, throwerId: ball.throwerId });
                return;
            }

            if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] 👍 CATCH! ${bestCandidate.role} ${bestCandidate.name} at (${actionX}, ${actionY}, z:${actionZ})`, playState);
            playState.statEvents.push({ type: 'completion', receiverId: bestCandidate.id, qbId: ball.throwerId, yards: 0 });
            return;

        } else {
            const last = ball.lastInteraction;
            if (!(last && last.playerId === bestCandidate.id && (playState.tick - last.tick) <= 5)) {
                ball.tipCount = (ball.tipCount || 0) + 1;

                if (isDefense) {
                    if (playState.type === 'punt') return;
                    const isTip = (Math.random() < 0.25) && ball.tipCount < 3;

                    if (isTip) {
                        if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] 🖐️ ${bestCandidate.name} tips pass! (Hands: ${hndEff}, Energy: ${fatPct}%)`, playState);
                        ball.vz = 3.0 + (Math.random() * 2);
                        ball.vx += (Math.random() - 0.5) * 6;
                        ball.vy += (Math.random() - 0.5) * 6;
                        ball.lastInteraction = { tick: playState.tick, playerId: bestCandidate.id, type: 'tip' };
                    } else {
                        if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] 🚫 ${bestCandidate.name} swats the pass away! (Hands: ${hndEff}, Energy: ${fatPct}%)`, playState);
                        ball.vz = -8.0;
                        ball.vx *= 0.3;
                        ball.vy *= 0.3;
                        ball.isSwatted = true;
                        ball.lastInteraction = { tick: playState.tick, playerId: bestCandidate.id, type: 'swat' };
                    }
                } else {
                    const isBobble = (Math.random() < 0.20) && ball.tipCount < 3;

                    if (isBobble) {
                        if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] 🖐️ ${bestCandidate.name} bobbles the ball! (Hands: ${hndEff}, Energy: ${fatPct}%)`, playState);
                        ball.vz = 2.5 + Math.random();
                        ball.vx += (Math.random() - 0.5) * 3;
                        ball.vy += (Math.random() - 0.5) * 3;
                        ball.lastInteraction = { tick: playState.tick, playerId: bestCandidate.id, type: 'bobble' };
                    } else {
                        if (playState.type === 'punt') {
                            if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] ❌ ${bestCandidate.name} muffs the punt!`, playState);
                            playState.statEvents.push({ type: 'fumble', playerId: bestCandidate.id });
                            playState.fumbleOccurred = true;
                            ball.vz = -2.0;
                            ball.vx += (Math.random() - 0.5) * 4;
                            ball.vy += (Math.random() - 0.5) * 4;
                            ball.droppedById = bestCandidate.id;
                            ball.isLoose = true;
                            ball.lastInteraction = { tick: playState.tick, playerId: bestCandidate.id, type: 'muff' };
                        } else {
                            if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] ❌ ${bestCandidate.name} drops the pass! (Hands: ${hndEff}, Energy: ${fatPct}%)`, playState);
                            playState.statEvents.push({ type: 'drop', playerId: bestCandidate.id });
                            ball.vz = -5.0;
                            ball.vx *= 0.2;
                            ball.vy *= 0.2;
                            ball.droppedById = bestCandidate.id;
                            ball.isSwatted = true;
                            ball.lastInteraction = { tick: playState.tick, playerId: bestCandidate.id, type: 'drop' };
                        }
                    }
                }
                ball.targetX = ball.x + ball.vx;
                ball.targetY = ball.y + ball.vy;
            }
        }
    }

    if (ball.z <= 0) {
        ball.z = 0;

        if (ball.isThrowAway) {
            ball.vz = 0; ball.vx = 0; ball.vy = 0;
            if (playState.playIsLive) {
                playState.playIsLive = false;
                playState.incomplete = true;
                if (gameLog) pushGameLog(gameLog, "⏱️ Pass lands out of bounds.", playState);
            }
            return;
        }

        if (playState.type === 'punt') {
            ball.vz = -ball.vz * 0.4; ball.vx *= 0.8; ball.vy *= 0.8;
            if (Math.abs(ball.vx) < 0.5 && Math.abs(ball.vy) < 0.5) {
                if (gameLog && playState.playIsLive) pushGameLog(gameLog, `[Tick ${playState.tick}] ⏱️ Punt downed.`, playState);
                playState.playIsLive = false; playState.possessionChanged = true;
                playState.finalBallY = ball.y;
            }
            const downingPlayer = playState.activePlayers.find(p => p.isOffense && getDistance(p, ball) < 1.0);
            if (downingPlayer && playState.playIsLive) {
                if (gameLog) pushGameLog(gameLog, `🛑 ${downingPlayer.name} downs the punt.`, playState);
                playState.playIsLive = false; playState.possessionChanged = true;
                playState.finalBallY = ball.y;
            }
        } else if (playState.type === 'pass' && !ball.isLoose) {
            const wasCaught = playState.statEvents.some(e => e.type === 'completion' || e.type === 'interception');
            if (playState.playIsLive && !wasCaught) {
                playState.playIsLive = false;
                playState.incomplete = true;
                ball.vz = 0; ball.vx = 0; ball.vy = 0;
                playState.finalBallY = playState.lineOfScrimmage;
                if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] ⏱️ Pass hits the turf. Incomplete.`, playState);
            } else if (wasCaught && playState.playIsLive) {
                playState.playIsLive = false;
                if (gameLog && !playState.fumbleOccurred) pushGameLog(gameLog, `[Tick ${playState.tick}] ⏱️ Ball hits the ground.`, playState);
            }
        } else {
            ball.vz = -ball.vz * 0.5; ball.vx *= 0.7; ball.vy *= 0.7;
        }
    }
}
