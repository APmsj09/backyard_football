import { getDistance, applyImpactDisruption } from './physics.js';
import { getRandomInt, formatHeight } from '../utils.js';
import { getPlayer } from './state.js';
import { logPlayDebug } from './telemetry.js';

const FIELD_WIDTH = 53.3;
const FIELD_LENGTH = 120;
const TACKLE_RANGE = 2.2;
const TACKLE_CONTACT_RANGE = 1.4;
const FUMBLE_CHANCE_BASE = 0.015;
const DEBUG_MODE = false;
const BLOCK_WIN_SCORE = 10;

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

    const ballSecurity = Number(ballCarrierState.carrying) || Number(ballCarrierState.toughness) || 50;
    const strength = Number(tacklerState.strength) || 50;
    const tackling = Number(tacklerState.tackling) || 50;

    // In backyard football, an older/stronger kid hitting a much younger/smaller kid jars the ball loose easily
    const carrierWeight = ballCarrierState.weight || ballCarrierState.wgt || 140;
    const tacklerWeight = tacklerState.weight || tacklerState.wgt || 140;
    const sizeDisparity = Math.max(-0.5, Math.min(0.8, (tacklerWeight - carrierWeight) / 100));

    const carrierMod = (ballSecurity / 100) * (ballCarrierState.fatigueModifier || 1);
    const tacklerMod = ((strength + tackling) / 200) * (tacklerState.fatigueModifier || 1);

    let fumbleChance = FUMBLE_CHANCE_BASE * (tacklerMod / (carrierMod + 0.2)) * (1.0 + sizeDisparity * 0.6);

    if (ballCarrierState.role === 'QB' && ballCarrierState.action === 'qb_setup') {
        fumbleChance *= 2.5;
    }

    if (Math.random() < fumbleChance) {
        playState.ballState.lastDroppedById = ballCarrierState.id;
        playState.ballState.droppedTick = playState.tick;

        if (gameLog) {
            const tacklerFatigue = tacklerState.fatigueModifier || 1;
            const carrierFatigue = ballCarrierState.fatigueModifier || 1;

            const hitPower = Math.round(
                ((strength + tackling) / 2) * tacklerFatigue
            );

            const security = Math.round(
                ballSecurity * carrierFatigue
            );

            const actionX = ballCarrierState.x.toFixed(1);
            const actionY = ballCarrierState.y.toFixed(1);
            const yardage = (
                ballCarrierState.y - playState.lineOfScrimmage
            ).toFixed(1);

            gameLog.push(
                `[Tick ${playState.tick}] ❗ FUMBLE! ${tacklerState.name} jars it loose at (${actionX}, ${actionY}) | Gain: ${yardage}y | (Hit: ${hitPower} vs Sec: ${security})`
            );
        }

        playState.fumbleOccurred = true;
        playState.fumbleYards = ballCarrierState.y - playState.lineOfScrimmage; // ADD THIS LINE
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
        const impactDistance = Math.max(0.1, Math.hypot(dx, dy));
        const impactDirX = dx / impactDistance;
        const impactDirY = dy / impactDistance;

        applyImpactDisruption(
            ballCarrierState,
            66,
            impactDirX * 2.2,
            impactDirY * 2.2
        );
        applyImpactDisruption(
            tacklerState,
            20,
            -impactDirX * 0.6,
            -impactDirY * 0.6
        );

        playState.statEvents.push({
            type: 'fumble',
            playerId: ballCarrierState.id
        });

        return true;
    }
    return false;
}

export function checkBlockCollisions(playState, gameLog = null) {
    const blockers = playState.activePlayers.filter(p =>
        p.isOffense &&
        !p.isEngaged &&
        p.stunnedTicks === 0 &&
        p.balanceState !== 'downed'
    );
    const defenders = playState.activePlayers.filter(p =>
        !p.isOffense &&
        p.stunnedTicks <= 0 &&
        p.balanceState !== 'downed' &&
        !p.isEngaged
    );

    blockers.forEach(blocker => {
        if (blocker.reengageCooldown > 0) {
            blocker.reengageCooldown--;
            return;
        }

        const isBlockingDuty = blocker.action.includes('block') ||
            (blocker.assignment && (blocker.assignment.includes('pull') || blocker.assignment.includes('lead') || blocker.assignment.includes('screen_block')));

        if (!isBlockingDuty) return;

        // FIX: In pass pro, linemen only block rushers/blitzers. 
        // Do NOT let OL block defenders who are running in man/zone coverage!
        const isPassBlock = blocker.action === 'pass_block';
        const eligibleDefenders = isPassBlock
            ? defenders.filter(d => d.role === 'DL' || d.assignment?.includes('rush') || d.assignment?.includes('blitz'))
            : defenders;

        let target = null;
        const imminentThreat = eligibleDefenders
            .filter(d => getDistance(blocker, d) < 1.8 && d.y > blocker.y - 1.5)
            .sort((a, b) => getDistance(blocker, a) - getDistance(blocker, b))[0];

        if (imminentThreat && !imminentThreat.isEngaged && !imminentThreat.isBlocked) {
            target = imminentThreat;
        } else if (blocker.dynamicTargetId) {
            target = eligibleDefenders.find(d => d.id === blocker.dynamicTargetId);
            if (!target || target.isEngaged || getDistance(blocker, target) > 3.0) {
                target = null;
            }
        }

        if (target) {
            const blockerStr = blocker.str || blocker.strength || 50;
            const targetStr = target.str || target.strength || 50;
            const targetSpd = target.spd || target.speed || 50;
            const blockerAgi = blocker.agi || blocker.agility || 50;

            // FIX: Pass-rush edge burns ONLY apply in the pocket before the ball is thrown
            const isPassRush = (target.assignment?.includes('rush') || target.assignment?.includes('blitz')) &&
                playState.type === 'pass' &&
                !playState.ballState?.throwTick &&
                target.y < playState.lineOfScrimmage + 3.0;

            // 1. Speed Edge Dip: Fast rusher blows by the tackle on the outside arc
            const isEdgeAlignment = Math.abs(target.initialX - blocker.initialX) > 1.4;
            if (isPassRush && isEdgeAlignment && targetSpd > blockerAgi + 14 && Math.random() < 0.28) {
                const awayX = blocker.x - target.x;
                const awayY = blocker.y - target.y;
                const awayDist = Math.max(0.1, Math.hypot(awayX, awayY));

                // The blocker loses his base while reacting to the speed rush;
                // momentum and reduced steering carry him off his ideal path.
                applyImpactDisruption(
                    blocker,
                    32,
                    (awayX / awayDist) * 1.2,
                    (awayY / awayDist) * 1.2
                );

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
    const carrier = playState.activePlayers.find(p => (p.hasBall || p.isBallCarrier) && !playState.ballState.isLoose);
    if (!carrier) return false;

    const tacklingTeam = playState.activePlayers.filter(p => p.isOffense !== carrier.isOffense);

    const defenders = tacklingTeam.filter(p => {
        if (p.stunnedTicks > 0 || p.balanceState === 'downed') return false;

        // Refresh distance after movement; the cached value may be stale.
        const dist = getDistance(p, carrier);
        p._distToCarrier = dist;

        if (!Number.isFinite(dist) || dist > TACKLE_RANGE) return false;

        // A defender who just whiffed or got shed by this carrier cannot immediately re-tackle them
        if (p._carrierTackleCooldownTicks && p._carrierTackleCooldownTicks > 0) {
            p._carrierTackleCooldownTicks--;
            return false;
        }

        // DEEPER FIX: Process engaged defenders BEFORE running environmental raycasts!
        // If a defender is locked in a block, they are not pathfinding. We only check
        // if they can reach out for a weak arm tackle.
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
            return dist < 0.8;
        }

        // Reject a tackle attempt when another player's body obstructs
        // the direct path between the FREE defender and the ball carrier.
        const dxToCarrier = carrier.x - p.x;
        const dyToCarrier = carrier.y - p.y;
        const segmentLengthSq =
            dxToCarrier * dxToCarrier + dyToCarrier * dyToCarrier;

        const obstruction = segmentLengthSq > 0.01
            ? playState.activePlayers.find(other => {
                // Teammates don't obstruct tackles, nor do players who are pancaked or downed on the grass
                if (other === p || other === carrier || other.isOffense === p.isOffense) return false;
                if (other.balanceState === 'downed' || other.stunnedTicks > 15) return false;

                const along = (
                    (other.x - p.x) * dxToCarrier +
                    (other.y - p.y) * dyToCarrier
                ) / segmentLengthSq;

                if (along <= 0.08 || along >= 0.92) return false;

                const nearestX = p.x + along * dxToCarrier;
                const nearestY = p.y + along * dyToCarrier;

                return Math.hypot(
                    other.x - nearestX,
                    other.y - nearestY
                ) < 0.65;
            })
            : null;

        if (obstruction) {
            const lastLogTick = p._lastTackleBlockedLogTick ?? -Infinity;

            // Avoid flooding telemetry with the same blocked attempt.
            if (playState.tick - lastLogTick >= 5) {
                p._lastTackleBlockedLogTick = playState.tick;

                logPlayDebug(
                    'TACKLE_PATH_BLOCKED',
                    `${p.name} cannot reach ${carrier.name}; ${obstruction.name} obstructs the path`,
                    {
                        defender: p.name,
                        carrier: carrier.name,
                        obstruction: obstruction.name,
                        obstructionSlot: obstruction.slot,
                        obstructionIsOffense: obstruction.isOffense,
                        distance: Number(
                            getDistance(p, carrier).toFixed(2)
                        )
                    },
                    playState.tick
                );
            }

            return false;
        }

        return true;
    });

    for (const defender of defenders) {
        const distance = getDistance(carrier, defender);
        const isEngagedTackler = defender.isBlocked || defender.isEngaged;

        if (isEngagedTackler) {
            // Arm-tackle attempts are limited to avoid applying contact
            // slowdown on every single simulation tick.
            const lastArmTackleTick =
                defender._lastArmTackleTick ?? -Infinity;

            if (
                distance < 0.8 &&
                playState.tick - lastArmTackleTick >= 6
            ) {
                defender._lastArmTackleTick = playState.tick;

                const armTackleSkill =
                    ((defender.tkl || 50) * 0.6) +
                    ((defender.str || 50) * 0.4);

                // Stronger tacklers can slow the runner a little more,
                // but engaged contact cannot directly end the play.
                const slowFactor = Math.max(
                    0.84,
                    Math.min(
                        0.94,
                        0.91 - ((armTackleSkill - 50) * 0.001)
                    )
                );

                carrier.vx *= slowFactor;
                carrier.vy *= slowFactor;
                carrier.moveCooldown = Math.max(
                    carrier.moveCooldown || 0,
                    4
                );

                logPlayDebug(
                    'ARM_TACKLE_CONTACT',
                    `${defender.name} reached ${carrier.name} while engaged`,
                    {
                        distance: Number(distance.toFixed(2)),
                        armTackleSkill,
                        speedReductionPercent: Math.round(
                            (1 - slowFactor) * 100
                        )
                    },
                    playState.tick
                );
            }

            // Don't let the engaged defender proceed into the ordinary
            // full tackle or fumble-resolution code.
            continue;
        }

        const isTruckAttempt = carrier.action === 'trucking';

        const carrierAge = carrier.age || 15;
        const defenderAge = defender.age || 15;

        // Use the exact age-progress weight curve from player.js
        const getBackyardWeight = (p) => {
            if (p.weight || p.wgt) return p.weight || p.wgt;
            const a = Math.max(8, Math.min(18, p.age || 14));
            const progress = (a - 8) / 10.0;
            return Math.round(70 + (progress * 130)); // 70 lbs at 8yo -> 200 lbs at 18yo
        };

        const carrierWeight = getBackyardWeight(carrier);
        const defenderWeight = getBackyardWeight(defender);

        const carrierDrivePower =
            ((carrier.str || carrier.strength || 50) * 0.65) +
            ((carrier.tgh || carrier.toughness || 50) * 0.35);

        const defenderStopPower =
            ((defender.tkl || defender.tackling || 50) * 0.65) +
            ((defender.str || defender.strength || 50) * 0.35);

        const carrierSpeed = Math.hypot(carrier.vx || 0, carrier.vy || 0);
        const defenderSpeed = Math.hypot(defender.vx || 0, defender.vy || 0);

        // Mass Ratio: A 185 lb teenager hitting a 105 lb middle schooler has massive sandlot leverage
        const weightDelta = carrierWeight - defenderWeight; // -80 to +80 lbs
        const massAdvantage = (weightDelta / 150) * 0.25;

        const truckAdvantage = isTruckAttempt
            ? Math.max(
                -0.25,
                Math.min(
                    0.35,
                    ((carrierDrivePower - defenderStopPower) * 0.004) +
                    massAdvantage +
                    ((carrierSpeed - defenderSpeed) * 0.008)
                )
            )
            : massAdvantage * 0.5; // Passive size advantage even on standard contact

        // A truck has its own contact resolution below. Do not replace it
        // with a random juke or stiff arm.
        if (distance < TACKLE_CONTACT_RANGE && !isTruckAttempt) {
            const canPerformMove = (!carrier.moveCooldown || carrier.moveCooldown <= 0) && carrier.action !== 'handoff_setup';

            if (canPerformMove) {
                const carrierIQ = carrier.playbookIQ || carrier.iq || 50;
                const defenderIQ = defender.playbookIQ || defender.iq || 50;

                const agiDiff = (carrier.agi || 50) - (defender.tkl || 50);
                const strDiff = (carrier.str || 50) - (defender.str || 50);
                const iqDiff = carrierIQ - defenderIQ;

                // IQ Layer: High IQ carriers set up defenders; High IQ defenders take sound tackling angles
                const iqModifier = (iqDiff / 300);
                const evadeChance = Math.max(0.05, Math.min(0.40, 0.16 + (Math.max(agiDiff, strDiff) / 250) + iqModifier));

                if (Math.random() < evadeChance) {
                    carrier.moveCooldown = 25; // Prevents spamming evasions
                    carrier.tacklesBrokenThisPlay = (carrier.tacklesBrokenThisPlay || 0) + 1;

                    const defWeight = defender.wgt || defender.weight || 200;
                    const carWeight = carrier.wgt || carrier.weight || 200;

                    if (strDiff > agiDiff && strDiff > 10) {
                        carrier.action = 'stiff_arm';
                        
                        // A stiff arm redirects the defender; impact severity and
                        // balance attributes decide whether he stumbles or falls.
                        const impactDx = defender.x - carrier.x;
                        const impactDy = defender.y - carrier.y;
                        const impactDistance = Math.max(
                            0.1,
                            Math.hypot(impactDx, impactDy)
                        );
                        const knockedDown = applyImpactDisruption(
                            defender,
                            68,
                            (impactDx / impactDistance) * 2.5,
                            (impactDy / impactDistance) * 2.5
                        );
                        
                        // PHYSICS: Stiff arm absorbs momentum relative to the mass of the defender shoved away
                        // Stronger carriers lose less momentum during the stiff arm
                        const strengthMitigation = Math.max(0.5, 1.0 - ((carrier.str || 50) / 200));
                        const speedPenalty = Math.min(0.4, (defWeight / (carWeight * 1.5)) * 0.25) * strengthMitigation;
                        carrier.vx *= (1 - speedPenalty);
                        carrier.vy *= (1 - speedPenalty);

                        if (gameLog) {
                            pushGameLog(
                                gameLog,
                                knockedDown
                                    ? `💪 ${carrier.name} stiff-arms ${defender.name} to the ground!`
                                    : `💪 ${carrier.name} stiff-arms ${defender.name} off balance!`,
                                playState
                            );
                        }
                    } else {
                        const dir = Math.random() > 0.5 ? 1 : -1;
                        carrier.action = dir === 1 ? 'juke_right' : 'juke_left';
                        
                        const agiFactor = (carrier.agi || 50) / 100;
                        const jukePower = 1.8 + (agiFactor * 2.0); // 2.0 to 3.8 lateral impulse
                        
                        // PHYSICS: A hard lateral cut bleeds forward velocity and redirects it laterally
                        carrier.vy *= (0.4 + (agiFactor * 0.4)); // High agility retains more forward speed through the cut
                        carrier.vx = dir * jukePower; // Hard set the velocity instead of adding to avoid insane compounding speeds
                        
                        // The defender's momentum carries him past the cut;
                        // agility determines how quickly he regains steering.
                        const knockedDown = applyImpactDisruption(
                            defender,
                            42,
                            -dir * 2.5,
                            1.0
                        );

                        if (gameLog) {
                            pushGameLog(
                                gameLog,
                                knockedDown
                                    ? `⚡ ${carrier.name}'s cut sends ${defender.name} to the ground!`
                                    : `⚡ ${carrier.name}'s cut leaves ${defender.name} off balance!`,
                                playState
                            );
                        }
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

        // BACKYARD GANG-TACKLE / SWARM RULE:
        // When the neighborhood big kid is carrying the ball, younger/smaller kids MUST swarm together to pull him down!
        const defendersInRange = defenders.filter(d =>
            d.stunnedTicks === 0 &&
            !d.isBlocked &&
            !d.isEngaged &&
            getDistance(d, carrier) < TACKLE_CONTACT_RANGE
        );

        if (defendersInRange.length > 1) {
            // High-school big runner vs middle-school swarm: each additional kid adds +12% tackle odds
            const swarmStrength = (defendersInRange.length - 1) * 0.12;
            successChance += Math.min(0.32, swarmStrength);
        }

        successChance += (tPower - rPower) * 0.005;

        // A truck makes the runner harder to stop when the power contest
        // favors them, but a strong tackler can still win the contact.
        if (isTruckAttempt) {
            successChance -= truckAdvantage;
        }

        // Broken tackles give defenders a modest advantage on later attempts.
        const brokenCount = carrier.tacklesBrokenThisPlay || 0;
        successChance += Math.min(0.18, brokenCount * 0.08);

        // Solid floor for open-field tackles (prevents 20% auto-breakaways)
        successChance = Math.max(0.32, Math.min(0.95, successChance));
        if (!Number.isFinite(successChance)) successChance = 0.65;

        logPlayDebug('TACKLE_CALC', `${defender.name} vs ${carrier.name}`, {
            distance: Number(distance.toFixed(2)),
            successChance: `${Math.round(successChance * 100)}%`,
            carrierBrokenTackles: carrier.tacklesBrokenThisPlay || 0,
            move: isTruckAttempt ? 'trucking' : 'standard',
            truckAdvantage: Number(truckAdvantage.toFixed(3))
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
            } else if (carrier.role === 'QB' && (playState.qbIntent === 'scramble' || playState.type === 'run')) {
                playState.statEvents.push({ 
                    type: 'rush_attempt', 
                    carrierId: carrier.id, 
                    yards: carrier.y - playState.lineOfScrimmage 
                });
                if (playState.type === 'run') {
                    playState.isRush = true;
                } else {
                    playState.isScrambleRun = true;
                }
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

            // Prevent this specific defender from attempting another tackle on the same runner
            // for at least 0.8 seconds (20 ticks). Other defenders can still make the tackle.
            defender._carrierTackleCooldownTicks = 20;

            // A failed tackle redirects the defender and disrupts his balance.
            const bounceX = defender.x - carrier.x;
            const bounceY = defender.y - carrier.y;
            const bounceDistance = Math.max(
                0.1,
                Math.hypot(bounceX, bounceY)
            );
            applyImpactDisruption(
                defender,
                isTruckAttempt ? 55 : 42,
                (bounceX / bounceDistance) * (isTruckAttempt ? 2.4 : 1.8),
                (bounceY / bounceDistance) * (isTruckAttempt ? 2.4 : 1.8)
            );
            
            // Stumble cooldown: the whiffed defender needs time to recover their footing
            defender.stunnedTicks = Math.max(defender.stunnedTicks || 0, 10);
            
            // Breaking a tackle shouldn't turn the runner into a statue.
            // Power runners and agile evaders maintain forward momentum.
            const baseSpeedDrain = Math.max(
                0.06,
                Math.min(
                    0.28,
                    (defenderWeight / carrierWeight) * 0.20
                )
            );

            const speedDrain = isTruckAttempt
                ? Math.max(
                    0.04,
                    Math.min(0.22, baseSpeedDrain - (truckAdvantage * 0.5))
                )
                : baseSpeedDrain;

            carrier.vx *= (1 - speedDrain);
            carrier.vy *= (1 - speedDrain);
            carrier.moveCooldown = 12; // Modest cooldown to prevent instant spamming without paralyzing the runner

            if (carrier.role === 'QB' && carrier.action === 'qb_setup' && carrier.y < playState.lineOfScrimmage) {
                carrier.action = 'qb_scramble';
                carrier.rolloutDir = carrier.x > (FIELD_WIDTH / 2) ? -1 : 1;
            }

            if (gameLog) {
                const weightDelta = carrierWeight - defenderWeight;

                let message;
                if (weightDelta > 45) {
                    message = `[Tick ${playState.tick}] 🚜 ${carrier.name} (${carrierWeight} lbs) completely steamrolls the much smaller ${defender.name} (${defenderWeight} lbs)!`;
                } else if (weightDelta < -45) {
                    message = `[Tick ${playState.tick}] ⚡ David vs Goliath! ${carrier.name} (${carrierWeight} lbs) slips right underneath the heavy-footed ${defender.name}!`;
                } else if (isTruckAttempt) {
                    message = `[Tick ${playState.tick}] 💥 ${carrier.name} lowers his shoulder and powers right through ${defender.name}!`;
                } else {
                    message = `[Tick ${playState.tick}] 💪 ${carrier.name} breaks free from ${defender.name}'s tackle!`;
                }

                pushGameLog(gameLog, message, playState);
            }
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
        p.balanceState !== 'downed' &&
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

    // Track where the defense takes possession so touchbacks evaluate correctly
    if (possessionChange) {
        playState.returnStartY = bestPlayer.y;
    }

    return {
        playerState: bestPlayer,
        possessionChange,
        recoveryTeamId: bestPlayer.teamId
    };
}

export function resolveBattle(powerA, powerB, battle) {
    const BASE_DIFF = powerA - powerB;
    const roll = getRandomInt(-10, 10);

    // Convert the matchup advantage into a meaningful per-tick battle change.
    const finalDiff = (BASE_DIFF + roll) / 40;

    // Initialize once; do not reset the score on every tick.
    if (!Number.isFinite(battle.battleScore)) {
        battle.battleScore = 0;
    }

    battle.battleScore += finalDiff;

    if (battle.battleScore >= BLOCK_WIN_SCORE) {
        battle.status = 'win_A';
    } else if (battle.battleScore <= -BLOCK_WIN_SCORE) {
        battle.status = 'win_B';
    } else {
        battle.status = 'ongoing';
    }

    return finalDiff;
}

export function resolveOngoingBlocks(playState, gameLog, offenseStates = [], defenseStates = []) {
    const battlesToRemove = [];
    const ballCarrier = playState.activePlayers.find(
        p => p.hasBall || p.isBallCarrier
    );
    const MAX_BLOCK_SEPARATION = 2.5;

    playState.blockBattles.forEach((battle, index) => {
        if (battle.startTick === playState.tick) return;

        if (battle.status !== 'ongoing') {
            battlesToRemove.push(index);
            return;
        }

        const blocker = battle.blocker;
        const defender = battle.defender;

        if (
            !blocker ||
            !defender ||
            blocker.engagedWith !== defender ||
            defender.blockedBy !== blocker ||
            blocker.stunnedTicks > 0 ||
            defender.stunnedTicks > 0 ||
            blocker.balanceState === 'downed' ||
            defender.balanceState === 'downed' ||
            getDistance(blocker, defender) > MAX_BLOCK_SEPARATION
        ) {

            if (blocker) { blocker.engagedWith = null; blocker.isEngaged = false; }
            if (defender) { defender.isBlocked = false; defender.blockedBy = null; defender.isEngaged = false; }

            battle.status = 'disengaged';
            battlesToRemove.push(index);
            return;
        }

        if (ballCarrier) {
            const distToCarrier = getDistance(defender, ballCarrier);
            const carrierPastLOS = ballCarrier.y > playState.lineOfScrimmage + 1.0;
            const carrierIsPastDefender = ballCarrier.y > defender.y + 2.0;

            // Shed block if carrier is close (<=5.0y) OR if carrier has broken past LOS on an open run
            // Also shed immediately if the carrier has blown past the defender downfield.
            const shouldAttemptShed = distToCarrier < 5.0 || (carrierPastLOS && distToCarrier < 20.0) || carrierIsPastDefender;

            if (shouldAttemptShed) {
                const reactionScore = (defender.playbookIQ || 50) + (defender.blockShedding || 50);
                const shedBonus = Math.max(0, (5.0 - distToCarrier) * 12);
                const openFieldUrgency = carrierPastLOS || carrierIsPastDefender ? 35 : 0;

                if (reactionScore + shedBonus + openFieldUrgency + getRandomInt(0, 50) > 110) {
                    blocker.engagedWith = null; 
                    blocker.isEngaged = false;
                    blocker.reengageCooldown = 14;
                    applyImpactDisruption(blocker, 28, 0, 0);
                    defender.isBlocked = false; 
                    defender.blockedBy = null; 
                    defender.isEngaged = false;
                    defender.action = 'pursuit';
                    battle.status = 'disengaged';
                    battlesToRemove.push(index);
                    return;
                }
            }
        }

        const blockerIQ = blocker.iq || blocker.playbookIQ || 50;
        const defenderIQ = defender.iq || defender.playbookIQ || 50;
        
        let blockPower = (((blocker.blocking || 50) * 1.15) + (blocker.strength || 50) + (blockerIQ * 0.3)) * blocker.fatigueModifier;
        let shedPower = (((defender.blockShedding || 50) * 1.15) + (defender.strength || 50) + (defenderIQ * 0.3)) * defender.fatigueModifier;

        if (playState.playKey?.includes('Screen') && playState.tick < 20) {
            blockPower *= 0.1;
        }

        const ticksInBlock = playState.tick - battle.startTick;
        const isPassBlock = blocker.action === 'pass_block';
        const isRunBlock =
            playState.type === 'run' &&
            (
                blocker.action === 'run_block' ||
                /pull|lead/i.test(blocker.assignment || '')
            );

        if (isPassBlock && ticksInBlock < 20) {
            blockPower *= 1.08;
        } else if (isRunBlock && ticksInBlock < 12) {
            blockPower *= 1.10;
        }

        // STALEMATE RESOLUTION:
        // Downfield blocks (WR blocking DB or DB blocking WR) must break down quickly.
        // A cornerback cannot be held at the line of scrimmage for 200 ticks.
        const isPerimeterBlock = blocker.role !== 'OL' && defender.role !== 'DL';
        const maxCleanHoldTicks = isPerimeterBlock ? 25 : (blocker.role === 'OL' ? 45 : 30);

        if (ticksInBlock > maxCleanHoldTicks) {
            const fatiguePenalty = 1.0 - ((ticksInBlock - maxCleanHoldTicks) * 0.04);
            blockPower *= Math.max(0.15, fatiguePenalty);
            // Defenders aggressively shed as time expires
            shedPower *= (1.0 + ((ticksInBlock - maxCleanHoldTicks) * 0.035));

            // Force a natural disengagement if a perimeter block exceeds 45 ticks (~1.8 seconds)
            if (isPerimeterBlock && ticksInBlock > 45) {
                blocker.engagedWith = null;
                blocker.isEngaged = false;
                blocker.reengageCooldown = 20;
                defender.isBlocked = false;
                defender.blockedBy = null;
                defender.isEngaged = false;
                defender.action = 'pursuit';
                battle.status = 'disengaged';
                battlesToRemove.push(index);
                return;
            }
        }

        // Pass-rush physics (bull-rushes and edge burns) only apply while the QB actually has the ball in the pocket!
        const ballStillInPocket = !playState.ballState?.throwTick && !playState.ballState?.inAir && !playState.handoffOccurred;
        const isPassRush = (defender.assignment?.includes('rush') || defender.assignment?.includes('blitz')) && 
            isPassBlock && 
            playState.type !== 'run' && 
            ballStillInPocket;

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

                    // Block sheds must engage for at least 8 ticks (0.32s) before a technique move can succeed
                    const minEngagementTicks = 8;
                    if (ticksInBlock >= minEngagementTicks && escapeScore > 120 && Math.random() < 0.005) {
                        defender.x += dirX * 0.6;
                        defender.y += dirY * 0.6;
                        blocker.stunnedTicks = 6;
                        defender.moveCooldown = 20;
                        battle.status = 'win_B';
                    } else if (ticksInBlock >= minEngagementTicks && escapeScore > 130 && Math.random() < 0.003) {
                        const bx = blocker.x - defender.x;
                        const by = blocker.y - defender.y;
                        defender.x += -by * 0.15;
                        defender.y += bx * 0.15;
                        blocker.stunnedTicks = 4;
                        defender.moveCooldown = 20;
                        battle.status = 'win_B';
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
                let bullRushTowardQB = false;

                if (isPassRush && defStr > blkStr + 20) {
                    const qb = offenseStates?.find(p => p.slot?.startsWith('QB'));
                    if (qb) {
                        dx = qb.x - defender.x;
                        dy = qb.y - defender.y;
                        bullRushTowardQB = true;
                    }
                    pushAmount = Math.max(0.2, pushAmount + 0.15);

                    if (!battle.loggedBullRush) {
                        logPlayDebug('TRENCH_BULL_RUSH', `${defender.name} is walking ${blocker.name} back to the QB!`, { defStr, blkStr });
                        battle.loggedBullRush = true;
                    }
                }

                const dist = Math.max(0.1, Math.sqrt(dx * dx + dy * dy));
                const pushMagnitude = Math.min(0.09, Math.abs(pushAmount) * 0.16);
                const uX = dx / dist;
                const uY = dy / dist;

                if (pushAmount > 0) {
                    if (isRunBlock && Number.isFinite(blocker.blockLaneX)) {
                        // Push the defender away from the intended running lane.
                        const outsideDirection =
                            defender.x < blocker.blockLaneX ? -1 : 1;

                        defender.x = Math.max(
                            0.5,
                            Math.min(
                                FIELD_WIDTH - 0.5,
                                defender.x + outsideDirection * pushMagnitude * 1.25
                            )
                        );

                        defender.y = Math.min(
                            FIELD_LENGTH - 0.5,
                            defender.y + pushMagnitude * 0.45
                        );

                        // Keep the blocker laterally stable so adjacent OL
                        // do not all slide toward the same gap.
                        blocker.y = Math.min(
                            FIELD_LENGTH - 0.5,
                            blocker.y + pushMagnitude * 0.15
                        );
                    } else if (isPassBlock) {
                        const qb = offenseStates?.find(
                            p => p.slot?.startsWith?.('QB')
                        );

                        if (bullRushTowardQB) {
                            // A dominant bull rush drives toward the QB.
                            // The blocker retreats, but more slowly.
                            const blockerRetreatFactor = 0.55;

                            defender.x = Math.max(
                                0.5,
                                Math.min(
                                    FIELD_WIDTH - 0.5,
                                    defender.x + uX * pushMagnitude
                                )
                            );
                            defender.y = Math.max(
                                0.5,
                                Math.min(
                                    FIELD_LENGTH - 0.5,
                                    defender.y + uY * pushMagnitude
                                )
                            );

                            blocker.x = Math.max(
                                0.5,
                                Math.min(
                                    FIELD_WIDTH - 0.5,
                                    blocker.x + uX * pushMagnitude * blockerRetreatFactor
                                )
                            );
                            blocker.y = Math.max(
                                0.5,
                                Math.min(
                                    FIELD_LENGTH - 0.5,
                                    blocker.y + uY * pushMagnitude * blockerRetreatFactor
                                )
                            );
                        } else {
                            // OL wins: shove the rusher away from the QB.
                            // The blocker holds his position to protect the pocket.
                            let awayX = uX;
                            let awayY = uY;

                            if (qb) {
                                const dxFromQB = defender.x - qb.x;
                                const dyFromQB = defender.y - qb.y;
                                const distanceFromQB = Math.max(
                                    0.1,
                                    Math.hypot(dxFromQB, dyFromQB)
                                );

                                awayX = dxFromQB / distanceFromQB;
                                awayY = dyFromQB / distanceFromQB;
                            }

                            defender.x = Math.max(
                                0.5,
                                Math.min(
                                    FIELD_WIDTH - 0.5,
                                    defender.x + awayX * pushMagnitude
                                )
                            );
                            defender.y = Math.max(
                                0.5,
                                Math.min(
                                    FIELD_LENGTH - 0.5,
                                    defender.y + awayY * pushMagnitude
                                )
                            );

                            // Intentionally leave the blocker stationary.
                        }
                    } else {
                        // Other blocking assignments use direct displacement.
                        defender.x += uX * pushMagnitude;
                        defender.y += uY * pushMagnitude;
                        blocker.x += uX * pushMagnitude * 0.8;
                        blocker.y += uY * pushMagnitude * 0.8;
                    }
                } else if (pushAmount < 0) {
                    if (isPassBlock) {
                        // DL wins: advance toward the QB while the blocker
                        // gives ground more slowly.
                        const qb = offenseStates?.find(
                            p => p.slot?.startsWith?.('QB')
                        );

                        let towardQBX = -uX;
                        let towardQBY = -uY;

                        if (qb) {
                            const dxToQB = qb.x - defender.x;
                            const dyToQB = qb.y - defender.y;
                            const distanceToQB = Math.max(
                                0.1,
                                Math.hypot(dxToQB, dyToQB)
                            );

                            towardQBX = dxToQB / distanceToQB;
                            towardQBY = dyToQB / distanceToQB;
                        }

                        const blockerRetreatFactor = 0.55;

                        defender.x = Math.max(
                            0.5,
                            Math.min(
                                FIELD_WIDTH - 0.5,
                                defender.x + towardQBX * pushMagnitude
                            )
                        );
                        defender.y = Math.max(
                            0.5,
                            Math.min(
                                FIELD_LENGTH - 0.5,
                                defender.y + towardQBY * pushMagnitude
                            )
                        );

                        blocker.x = Math.max(
                            0.5,
                            Math.min(
                                FIELD_WIDTH - 0.5,
                                blocker.x + towardQBX * pushMagnitude * blockerRetreatFactor
                            )
                        );
                        blocker.y = Math.max(
                            0.5,
                            Math.min(
                                FIELD_LENGTH - 0.5,
                                blocker.y + towardQBY * pushMagnitude * blockerRetreatFactor
                            )
                        );
                    } else {
                        // Preserve existing behavior for run blocks and
                        // other non-pass-block engagements.
                        blocker.x -= uX * pushMagnitude;
                        blocker.y -= uY * pushMagnitude;
                        defender.x -= uX * pushMagnitude * 0.8;
                        defender.y -= uY * pushMagnitude * 0.8;
                    }
                }
            }
        }

        if (battle.status === 'win_B') {
            const dur = playState.tick - battle.startTick;
            if (!battle._bypassedDurationCheck && dur < 15 && (defender.blockShedding || 0) < 90) {
                battle.status = 'ongoing';
                return;
            }
            if (isPassRush) logPlayDebug('BLOCK_SHED', `${defender.name} defeated ${blocker.name}'s block`, { durationTicks: dur });

            const blockerAwayX = blocker.x - defender.x;
            const blockerAwayY = blocker.y - defender.y;
            const blockerAwayDistance = Math.max(
                0.1,
                Math.hypot(blockerAwayX, blockerAwayY)
            );

            applyImpactDisruption(
                blocker,
                isPassRush ? 40 : 30,
                (blockerAwayX / blockerAwayDistance) * (isPassRush ? 1.5 : 1.0),
                (blockerAwayY / blockerAwayDistance) * (isPassRush ? 1.5 : 1.0)
            );

            blocker.engagedWith = null; 
            blocker.isEngaged = false;
            blocker.reengageCooldown = 12; // 0.48s recovery window so rusher can actually penetrate

            defender.stunnedTicks = 0;
            defender.isBlocked = false; 
            defender.blockedBy = null; 
            defender.isEngaged = false;
            defender.action = 'pursuit';
            battlesToRemove.push(index);
            } else if (battle.status === 'win_A') {
                const dur = playState.tick - battle.startTick;
                const blkStr = blocker.strength || blocker.str || 50;
                const defStr = defender.strength || defender.str || 50;

                // A pancake requires at least 20 ticks (0.8s) of sustained drive
                const hasSustainedDrive = dur >= 20;
                const strAdvantage = Math.max(0, blkStr - defStr);
                const techniqueEdge = (blocker.blocking || 50) - (defender.blockShedding || 50);

                // Base chance scales with strength gap and technique; never automatic 100%
                const pancakeChance = Math.max(
                    0.02,
                    Math.min(0.25, 0.04 + (strAdvantage * 0.006) + (techniqueEdge * 0.002))
                );

                const isPancake =
                    hasSustainedDrive &&
                    Math.random() < pancakeChance &&
                    !defender._pancakedThisPlay;

                if (isPancake) {
                    const pancakeDx = defender.x - blocker.x;
                    const pancakeDy = defender.y - blocker.y;
                    const pancakeDistance = Math.max(
                        0.1,
                        Math.hypot(pancakeDx, pancakeDy)
                    );

                    applyImpactDisruption(
                        defender,
                        90,
                        (pancakeDx / pancakeDistance) * 2.4,
                        (pancakeDy / pancakeDistance) * 2.4,
                        true
                    );

                    logPlayDebug('PANCAKE_BLOCK', `${blocker.name} flattened ${defender.name}`, {
                        engagementDurationTicks: dur,
                        downedTicks: defender.downedTicks
                    });

                    defender._pancakedThisPlay = true;
                    defender.action = 'pursuit';

                    // A pancake finishes this engagement. The OL is now free
                    // to choose a new assignment on the next target update.
                    blocker.engagedWith = null;
                    blocker.isEngaged = false;
                    blocker.dynamicTargetId = null;

                    defender.isBlocked = false;
                    defender.blockedBy = null;
                    defender.isEngaged = false;

                    battlesToRemove.push(index);
                } else {
                    // Winning a block is not the end of the engagement.
                    // Keep the block active, but retain a meaningful lead that
                    // the defender can still overcome by shedding the block.
                    battle.status = 'ongoing';
                    battle.battleScore = BLOCK_WIN_SCORE * 0.5;
                    defender.vx *= 0.2;
                    defender.vy *= 0.2;
                }
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

            // Exempt Under-Center QB and Center from pre-snap and dropback repelling
            const isQBCenterPreSnap = ((p1.role === 'QB' && p2.slot === 'OL2') || (p2.role === 'QB' && p1.slot === 'OL2')) &&
                (playState.tick < 8 || (p1.role === 'QB' ? p1.action === 'qb_setup' && !p1.hasCompletedDropback : p2.action === 'qb_setup' && !p2.hasCompletedDropback));
            if (isQBCenterPreSnap) {
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

    // A player gets one catch attempt per ball-contact phase.
     // A tip, bobble, or muff creates a new phase.
     if (!(ball._attemptedCatchPlayerIds instanceof Set)) {
         ball._attemptedCatchPlayerIds = new Set();
    }

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
        // Engaged/blocked defenders or stunned players cannot catch or swat passes mid-flight
        if (p.isBlocked || p.isEngaged || p.stunnedTicks > 0) return false;

        // Do not roll another catch attempt for a player who already attempted this phase
        if (ball._attemptedCatchPlayerIds.has(p.id)) return false;

        if (ball.isLoose && p.id === ball.lastDroppedById) {
            const ticksSinceDrop = playState.tick - (ball.droppedTick || 0);
            if (ticksSinceDrop < 25) return false;
        }

        const ticksSinceKick = playState.tick - (ball.throwTick || 0);
        const throwerCatchLock = ball.isLateral ? 40 : 20;

        if (p.id === ball.throwerId && ticksSinceKick < throwerCatchLock) {
            return false;
        }
        
        if (playState.type === 'punt' && p.isOffense && ball.z > 0.5) return false;
        //if ((ball.droppedById === p.id) || (ball.lastDroppedById === p.id)) return false; // FIX: Mislabeled property

        // Ineligible receivers: Offensive linemen cannot catch forward passes unless tipped or loose
        if (p.isOffense && p.slot.startsWith('OL') && playState.type === 'pass' && !ball.isLoose && !ball.tipCount && !ball.isLateral) {
            return false;
        }

        // On forward passes, any eligible receiver running a route or tracking the ball can attempt a catch,
        // but non-intended receivers must be actively looking/tracking and close to the landing point.
        if (p.isOffense && playState.type === 'pass' && !ball.isLoose && !ball.tipCount && !ball.isLateral) {
            const isIntendedTarget = p.id === ball.targetPlayerId;
            const isTracking = p.action === 'tracking_ball' || p.action.includes('route');
            if (!isIntendedTarget && !isTracking) {
                return false;
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

        const verticalLeap = (p.jumping || p.agi || p.agility || 50) / 100;
        const standingReach = (playerHeight / 36) + 0.6; // ~2.5 yards

        // Only active ball-trackers can leap for high passes; others are limited to standing reach
        const isTracking = p.action === 'tracking_ball';
        const maxCatchHeight = isTracking 
            ? (playerHeight / 36) + 1.1 + (verticalLeap * 0.7)
            : standingReach;

        // Ball must be in the air and above the turf; never allow catches below ground level
        if (ball.inAir && (ball.z > maxCatchHeight || ball.z <= 0.05)) return false;

        // Pass rushers (DL/blitzers) can only bat down balls right at the line within 2.5y of release
        const isPassRusher = !p.isOffense && (p.role === 'DL' || p.assignment?.includes('rush') || p.assignment?.includes('blitz'));
        if (isPassRusher && playState.type === 'pass' && !ball.isLoose && !ball.tipCount) {
            const distFromRelease = Math.hypot(p.x - (ball.prevX || ball.x), p.y - (ball.prevY || ball.y));
            if (ticksSinceKick > 8 || distFromRelease > 2.5 || ball.z > standingReach) {
                return false;
            }
        }

        const heightBonus = Math.max(0, (playerHeight - 65) * 0.04);
        let dynamicCatchRadius = BASE_CATCH_RADIUS + heightBonus + (verticalLeap * 0.10);
        const CATCH_TOLERANCE = 0.25;

        if (isTracking) dynamicCatchRadius *= 1.8;

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
                posScore += 22; // Balanced target priority so defenders in position can contest
            } else if (!p.isOffense) {
                posScore += ((p.cov || p.coverage || 50) * 0.45) + ((p.iq || p.playbookIQ || 50) * 0.25);
            }

            posScore += ((p.hgt || 70) > 74 ? 12 : 0);

            const roll = posScore + (Math.random() * 80);
            if (roll > highestRoll) {
                highestRoll = roll;
                bestCandidate = p;
            }
        });

        if (!bestCandidate) return;

        // Mark before resolving the catch so this player cannot roll again
        // on the next tick while still inside the catch radius.
        ball._attemptedCatchPlayerIds.add(bestCandidate.id);

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

        let catchScore = (catching * 0.50) + (agility * 0.20) + 35;

        // Physical proximity check (within 2.2 yards of catch spot)
        // Evaluates ALL live players regardless of whether they already rolled an attempt
        const defendersNear = playState.activePlayers.filter(p =>
            !p.isOffense &&
            p.stunnedTicks <= 0 &&
            !p.isEngaged &&
            getDistance(p, ball) <= 2.2
        ).length;

        let attackersNear = playState.activePlayers.filter(p =>
            p.isOffense &&
            p.stunnedTicks <= 0 &&
            !p.isEngaged &&
            getDistance(p, ball) <= 2.2
        ).length;

        const intendedTarget = playState.activePlayers.find(p => p.id === ball.targetPlayerId);
        if (intendedTarget && getDistance(intendedTarget, ball) <= 2.2 && attackersNear === 0) {
            attackersNear = 1;
        }

        if (isDefense && ball.isLateral) {
            // A backward pitch is recoverable by either team.
            // Do not treat a defensive recovery as a forward-pass INT.
            catchScore = Math.min(85.0, catchScore);

            if (attackersNear > 0) {
                catchScore *= 0.75;
            }
        } else if (isDefense) {
            const isPunt = playState.type === 'punt';
            const handsFactor = Math.min(1.0, catching / 80);

            if (isPunt) {
                catchScore = (catchScore * 0.85) + 20;
                logPlayDebug('PUNT_CATCH_ATTEMPT', `${bestCandidate.name} fielding punt`, {
                    catchProbability: `${Math.round(catchScore)}%`,
                    hands: hndEff
                });
            } else {
                // Realistic INT rate: Interceptions require exceptional hands and positioning.
                // Normal defensive plays result in incomplete passes (swats/PBUs), not turnovers.
                catchScore = catchScore * (0.12 * handsFactor);
                
                // If receiver is fighting for the ball, INT chance is halved
                if (attackersNear > 0) catchScore *= 0.45;

                // Cap defensive INT chance on standard passes to 18% max (elite ballhawks)
                catchScore = Math.min(18.0, catchScore);

                logPlayDebug('DEF_BALL_ATTEMPT', `${bestCandidate.name} attempted INT/Swat`, {
                    rawIntProbability: `${Math.round(catchScore)}%`,
                    hands: hndEff,
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
                rawCatchOdds: `${Math.round(catchScore)}%`,
                baseHands: hndEff,
                defendersClosingIn: defendersNear,
                isWideOpen: defendersNear === 0
            });
        }

        if (playState.type === 'punt') catchScore += 15;

        const ticksInAir = playState.tick - (ball.throwTick || 0);
        if (ticksInAir < 15 && isDefense && playState.type === 'pass' && !ball.isLateral) {
            if (bestCandidate.role === 'DL') catchScore *= 0.10;
            else catchScore *= 0.60;
        }

        catchScore = Math.max(1.0, Math.min(100.0, catchScore));

            // This is the probability actually used by the catch roll.
            logPlayDebug('CATCH_RESOLUTION', `${bestCandidate.name} catch roll`, {
                effectiveCatchOdds: `${Math.round(catchScore)}%`,
                tick: playState.tick,
                ballType: playState.type,
                candidateIsDefense: !bestCandidate.isOffense,
                ballHeight: Number((ball.z || 0).toFixed(2))
            });

                    if (Math.random() * 100 < catchScore) {
            const wasLateral = Boolean(ball.isLateral);
            const lateralPurpose = ball.lateralPurpose;
            const lateralThrowerId = ball.throwerId;

            const isOutOfBounds = bestCandidate.y >= 120 || bestCandidate.y <= 0 ||
                bestCandidate.x >= FIELD_WIDTH || bestCandidate.x <= 0;

            if (isOutOfBounds) {
                if (wasLateral) {
                    // An out-of-bounds lateral ends the play at the spot.
                    playState.playIsLive = false;
                    playState.yards =
                        ball.y - playState.lineOfScrimmage;
                    playState.finalBallY = ball.y;

                    playState.activePlayers.forEach(p => {
                        p.hasBall = false;
                        p.isBallCarrier = false;
                    });

                    ball.inAir = false;
                    ball.isLoose = false;
                    ball.vx = 0;
                    ball.vy = 0;
                    ball.vz = 0;
                    ball.isLateral = false;
                    ball.lateralPurpose = null;
                    ball.targetPlayerId = null;
                    ball.targetX = null;
                    ball.targetY = null;
                    ball.throwerId = null;
                    ball.throwTick = null;

                    if (gameLog) {
                        pushGameLog(
                            gameLog,
                            `[Tick ${playState.tick}] 💨 Lateral goes out of bounds.`,
                            playState
                        );
                    }
                } else {
                    ball.isSwatted = true;
                    ball.vz = 0;
                    ball.vx = 0;
                    ball.vy = 0;
                    ball.z = 0;

                    if (gameLog) {
                        pushGameLog(
                            gameLog,
                            `[Tick ${playState.tick}] 🚩 OUT OF BOUNDS! ${bestCandidate.name} caught it out of bounds.`,
                            playState
                        );
                    }
                    if (playState.playIsLive) {
                        playState.playIsLive = false;
                        playState.incomplete = true;
                        playState.finalBallY = playState.lineOfScrimmage;
                    }
                }

                return;
            }

            if (wasLateral) {
                // A lateral can change possession, so clear stale flags first.
                playState.activePlayers.forEach(p => {
                    p.hasBall = false;
                    p.isBallCarrier = false;
                });
            }

            // Preserve the incoming punt position before snapping the ball
            // to the player's coordinates.
            const puntBallAtContact =
                playState.type === 'punt' && !bestCandidate.isOffense
                    ? {
                        x: ball.x,
                        y: ball.y,
                        z: ball.z,
                        prevX: ball.prevX ?? null,
                        prevY: ball.prevY ?? null,
                        targetX: ball.targetX ?? null,
                        targetY: ball.targetY ?? null,
                        vx: ball.vx ?? null,
                        vy: ball.vy ?? null,
                        vz: ball.vz ?? null
                    }
                    : null;

            ball.inAir = false;
            ball.isLoose = false;
            ball.x = bestCandidate.x;
            ball.y = bestCandidate.y;
            ball.z = 1.0;
            ball.vx = 0;
            ball.vy = 0;
            ball.vz = 0;

            bestCandidate.hasBall = true;
            bestCandidate.isBallCarrier = true;
            bestCandidate.action = 'run_path';

            if (isDefense) {
                // FIX: Interceptors need to immediately redirect downhill towards the opponent's endzone (y <= 10)
                bestCandidate.vx *= 0.2;
                bestCandidate.vy = -Math.abs(bestCandidate.vy * 0.1) - (1.5 + (agility / 100));
                bestCandidate.contactReduction = 0.6;
            } else if (bestCandidate.vy < 0) {
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

            if (wasLateral) {
                // Do not leave lateral state behind to contaminate later throws.
                ball.isLateral = false;
                ball.lateralPurpose = null;
                ball.targetPlayerId = null;
                ball.targetX = null;
                ball.targetY = null;
                ball.throwerId = null;
                ball.throwTick = null;

                if (isDefense) {
                    playState.fumbleOccurred = true;
                    playState.possessionChanged = true;
                    playState.turnover = true;
                    // Track where the defense takes possession so touchbacks evaluate correctly
                    playState.returnStartY = bestCandidate.y;

                    if (lateralThrowerId) {
                        playState.statEvents.push({
                            type: 'fumble',
                            playerId: lateralThrowerId
                        });
                    }

                    playState.statEvents.push({
                        type: 'fumble_recovery',
                        playerId: bestCandidate.id
                    });

                    logPlayDebug(
                        'LATERAL_TURNOVER',
                        `${bestCandidate.name} recovers the opponent's lateral`,
                        {
                            recoveredBy: bestCandidate.id,
                            throwerId: lateralThrowerId
                        },
                        playState.tick
                    );

                    if (gameLog) {
                        pushGameLog(
                            gameLog,
                            `[Tick ${playState.tick}] 🏈 ${bestCandidate.name} recovers the loose lateral!`,
                            playState
                        );
                    }

                    return;
                }

                if (
                    playState.playKey === 'Trick_Flea_Flicker' &&
                    lateralPurpose === 'flea_return' &&
                    bestCandidate.role === 'QB'
                ) {
                    // The QB has recovered the ball and can resume the pass play.
                    playState.fleaFlickerPhase = 'qb_pass';

                    bestCandidate.hasBall = true;
                    bestCandidate.isBallCarrier = false;
                    bestCandidate.action = 'qb_setup';
                    bestCandidate.hasCompletedDropback = false;
                    bestCandidate.dropbackPhase = 'dropping';
                    bestCandidate.ticksOnCurrentRead = 0;
                    bestCandidate.currentReadTargetSlot =
                        bestCandidate.readProgression?.[0] || null;
                    bestCandidate._pocketSlideLock = 0;

                    delete bestCandidate._pocketAnchorX;
                    delete bestCandidate._pocketAnchorY;

                    logPlayDebug(
                        'FLEA_FLICKER_RETURN',
                        `${bestCandidate.name} catches the return pitch and resets to pass`,
                        {
                            quarterbackId: bestCandidate.id,
                            tick: playState.tick
                        },
                        playState.tick
                    );

                    if (gameLog) {
                        pushGameLog(
                            gameLog,
                            `[Tick ${playState.tick}] 🎯 ${bestCandidate.name} catches the return pitch!`,
                            playState
                        );
                    }
                } else if (
                    playState.playKey === 'Trick_Flea_Flicker' &&
                    lateralPurpose === 'flea_return'
                ) {
                    // If another offensive player catches it, this is now
                    // a live run after the lateral, not a normal QB pass.
                    playState.fleaFlickerPhase = 'live_after_lateral';
                } else if (gameLog) {
                    pushGameLog(
                        gameLog,
                        `[Tick ${playState.tick}] 🏈 ${bestCandidate.name} catches the toss!`,
                        playState
                    );
                }

                // Never record a lateral as an ordinary pass completion.
                return;
            }

            if (playState.type === 'punt' && !bestCandidate.isOffense) {
                playState.possessionChanged = true;
                playState.returnStartY = bestCandidate.y;

                const qbState = playState.activePlayers.find(
                    p => p.slot === 'QB1' && p.isOffense
                );

                // Centralized punt-catch diagnostics.
                logPlayDebug(
                    'PUNT_CATCH_STATE',
                    'Defensive punt catch resolved',
                    {
                        returner: {
                            id: bestCandidate.id,
                            name: bestCandidate.name,
                            slot: bestCandidate.slot,
                            x: bestCandidate.x,
                            y: bestCandidate.y,
                            isOffense: bestCandidate.isOffense,
                            hasBall: bestCandidate.hasBall,
                            isBallCarrier: bestCandidate.isBallCarrier
                        },

                        ballAtContact: puntBallAtContact,

                        ballAfterCatch: {
                            x: ball.x,
                            y: ball.y,
                            z: ball.z,
                            inAir: ball.inAir,
                            isLoose: ball.isLoose,
                            targetY: ball.targetY ?? null
                        },

                        returnStartY: playState.returnStartY,
                        lineOfScrimmage: playState.lineOfScrimmage,

                        qb: qbState ? {
                            id: qbState.id,
                            name: qbState.name,
                            x: qbState.x,
                            y: qbState.y,
                            action: qbState.action,
                            hasBall: qbState.hasBall,
                            isBallCarrier: qbState.isBallCarrier,
                            ghostTicks: qbState.ghostTicks ?? 0
                        } : null,

                        flaggedCarriers: playState.activePlayers
                            .filter(p => p.hasBall || p.isBallCarrier)
                            .map(p => ({
                                id: p.id,
                                name: p.name,
                                slot: p.slot,
                                isOffense: p.isOffense,
                                x: p.x,
                                y: p.y,
                                hasBall: p.hasBall,
                                isBallCarrier: p.isBallCarrier
                            }))
                    },
                    playState.tick
                );

                // In this simulation, y >= 110 is the receiving team's
                // own end zone. A catch there ends the play as a touchback.
                if (bestCandidate.y >= 110.0) {
                    playState.touchback = true;
                    playState.playIsLive = false;

                    // resolvePlay converts this field coordinate with:
                    // gameInstance.ballOn = 110 - finalBallY
                    // Therefore, 90 places the receiving team at its 20.
                    playState.finalBallY = 90.0;

                    logPlayDebug(
                        'PUNT_TOUCHBACK',
                        'Punt caught in receiving team end zone',
                        {
                            returner: bestCandidate.name,
                            catchY: bestCandidate.y,
                            finalBallY: playState.finalBallY
                        },
                        playState.tick
                    );

                    if (gameLog) {
                        pushGameLog(
                            gameLog,
                            `[Tick ${playState.tick}] 🏈 Touchback! Punt caught in the end zone.`,
                            playState
                        );
                    }

                    return;
                }

                if (gameLog) {
                    pushGameLog(
                        gameLog,
                        `[Tick ${playState.tick}] 🏈 ${bestCandidate.name} catches the punt! Return started.`,
                        playState
                    );
                }

                return;
            }

            const actionX = ball.x.toFixed(1);
            const actionY = ball.y.toFixed(1);
            const actionZ = ball.z.toFixed(1);

            if (isDefense) {
                if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] ❗ INTERCEPTION! ${bestCandidate.role} ${bestCandidate.name} at (${actionX}, ${actionY})`, playState);
                logPlayDebug('INTERCEPTION', `${bestCandidate.name} intercepted pass`, {
                    interceptor: bestCandidate.name,
                    returnStartY: Number(bestCandidate.y.toFixed(1)),
                    tick: playState.tick
                });
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

        } else if (ball.isLateral) {
            // Keep a failed lateral attempt in flight.
        } else {
            const last = ball.lastInteraction;
            if (!(last && last.playerId === bestCandidate.id && (playState.tick - last.tick) <= 5)) {
                if (isDefense) {
                    if (playState.type === 'punt') return;
                    
                    let touchChance = 0;
                    const isLineSwat = bestCandidate.role === 'DL' || (bestCandidate.role === 'LB' && bestCandidate.y < playState.lineOfScrimmage + 5);
                    
                    if (isLineSwat) {
                        const playerHeight = bestCandidate.hgt || bestCandidate.height || 70;
                        const heightAdv = Math.max(0, playerHeight - 72);
                        touchChance = 4 + (heightAdv * 1.5);
                    } else {
                        const coverageSkill = bestCandidate.cov || bestCandidate.coverage || 50;
                        touchChance = 20 + (coverageSkill * 0.4);
                        if (attackersNear > 0) touchChance += 20;
                    }
                    
                    const playerHeight = bestCandidate.hgt || bestCandidate.height || 70;
                    const standingReach = (playerHeight / 36) + 0.6;
                    if (ball.z > standingReach) {
                        touchChance *= 0.15;
                    }
                    
                    // ONLY update ball physics if the defender ACTUALLY manages to touch/deflect the ball!
                    if (Math.random() * 100 < touchChance) {
                        ball.tipCount = (ball.tipCount || 0) + 1;
                        
                        const coverageSkill = bestCandidate.cov || bestCandidate.coverage || 50;
                        const defIQ = bestCandidate.iq || bestCandidate.playbookIQ || 50;
                        const swatChance = 0.35 + ((coverageSkill + defIQ) / 400);
                        
                        const isTip = (Math.random() > swatChance) && ball.tipCount < 3;

                        if (isTip) {
                            ball._attemptedCatchPlayerIds.clear();
                            if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] 🖐️ ${bestCandidate.name} tips pass!`, playState);
                            ball.vz = 2.5 + (Math.random() * 2);
                            ball.vx = (ball.vx * 0.5) + (Math.random() - 0.5) * 3;
                            ball.vy = (ball.vy * 0.5) + (Math.random() - 0.5) * 3;
                            ball.lastInteraction = { tick: playState.tick, playerId: bestCandidate.id, type: 'tip' };

                            // Solve realistic landing spot for tipped ball
                            const tLand = (ball.vz + Math.sqrt(Math.max(0.1, ball.vz * ball.vz + 2 * 9.8 * Math.max(0.1, ball.z)))) / 9.8;
                            ball.targetX = ball.x + (ball.vx * tLand);
                            ball.targetY = ball.y + (ball.vy * tLand);
                            ball.targetPlayerId = null;
                        } else {
                            if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] 🚫 ${bestCandidate.name} swats the pass away!`, playState);
                            ball.vz = -8.0;
                            ball.vx *= 0.2;
                            ball.vy *= 0.2;
                            ball.isSwatted = true;
                            ball.lastInteraction = { tick: playState.tick, playerId: bestCandidate.id, type: 'swat' };
                            ball.targetX = ball.x + (ball.vx * 0.2);
                            ball.targetY = ball.y + (ball.vy * 0.2);
                        }
                    }
                    // CRITICAL: If defender failed to touch the ball, DO NOT corrupt ball.targetX/Y!
                } else {
                    ball.tipCount = (ball.tipCount || 0) + 1;
                    const isBobble = (Math.random() < 0.20) && ball.tipCount < 3;

                    if (isBobble) {
                        ball._attemptedCatchPlayerIds.clear();
                        if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] 🖐️ ${bestCandidate.name} bobbles the ball! (Hands: ${hndEff}, Energy: ${fatPct}%)`, playState);
                        ball.vz = 2.5 + Math.random();
                        ball.vx += (Math.random() - 0.5) * 2;
                        ball.vy += (Math.random() - 0.5) * 2;
                        ball.lastInteraction = { tick: playState.tick, playerId: bestCandidate.id, type: 'bobble' };
                        
                        const tLand = (ball.vz + Math.sqrt(Math.max(0.1, ball.vz * ball.vz + 2 * 9.8 * Math.max(0.1, ball.z)))) / 9.8;
                        ball.targetX = ball.x + (ball.vx * tLand);
                        ball.targetY = ball.y + (ball.vy * tLand);
                    } else {
                        if (playState.type === 'punt') {
                            ball._attemptedCatchPlayerIds.clear();
                            if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] ❌ ${bestCandidate.name} muffs the punt!`, playState);
                            playState.statEvents.push({ type: 'fumble', playerId: bestCandidate.id });
                            playState.fumbleOccurred = true;
                            ball.vz = -2.0;
                            ball.vx += (Math.random() - 0.5) * 3;
                            ball.vy += (Math.random() - 0.5) * 3;
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
            }
        }
    }

    if (ball.z <= 0) {
        ball.z = 0;

        if (ball.isLateral) {
            const lateralThrowerId = ball.throwerId;
            const thrower = playState.activePlayers.find(
                p => p.id === lateralThrowerId
            );

            // The backward pitch hit the turf: the ball is now recoverable.
            ball.vx = 0;
            ball.vy = 0;
            ball.vz = 0;
            ball.inAir = false;
            ball.isLoose = true;
            ball.isLateral = false;
            ball.lateralPurpose = null;

            ball.lastDroppedById = lateralThrowerId;
            ball.droppedTick = playState.tick;
            ball.droppedById = lateralThrowerId;

            ball.targetPlayerId = null;
            ball.targetX = null;
            ball.targetY = null;
            ball.throwerId = null;
            ball.throwTick = null;

            if (!playState.fumbleOccurred) {
                playState.fumbleOccurred = true;

                if (lateralThrowerId) {
                    playState.statEvents.push({
                        type: 'fumble',
                        playerId: lateralThrowerId
                    });
                }
            }

            logPlayDebug(
                'LATERAL_DROPPED',
                `${thrower?.name || 'Player'}'s lateral hits the turf`,
                {
                    throwerId: lateralThrowerId,
                    ballX: Number(ball.x.toFixed(2)),
                    ballY: Number(ball.y.toFixed(2))
                },
                playState.tick
            );

            if (gameLog) {
                pushGameLog(
                    gameLog,
                    `[Tick ${playState.tick}] 💥 ${thrower?.name || 'Player'}'s lateral hits the turf! Loose ball.`,
                    playState
                );
            }

            return;
        }

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
            ball.vz = -ball.vz * 0.4;
            ball.vx *= 0.8;
            ball.vy *= 0.8;

            if (Math.abs(ball.vx) < 0.5 && Math.abs(ball.vy) < 0.5) {
                if (gameLog && playState.playIsLive) {
                    pushGameLog(
                        gameLog,
                        `[Tick ${playState.tick}] ⏱️ Punt downed.`,
                        playState
                    );
                }

                playState.playIsLive = false;
                playState.possessionChanged = true;
                playState.finalBallY = ball.y;
            }

            const downingPlayer = playState.activePlayers.find(
                p => p.isOffense && getDistance(p, ball) < 1.0
            );

            if (downingPlayer && playState.playIsLive) {
                if (gameLog) {
                    pushGameLog(
                        gameLog,
                        `🛑 ${downingPlayer.name} downs the punt.`,
                        playState
                    );
                }

                playState.playIsLive = false;
                playState.possessionChanged = true;
                playState.finalBallY = ball.y;
            }

            // A dead punt must not retain airborne or moving physics.
            if (!playState.playIsLive && playState.possessionChanged) {
                ball.z = 0;
                ball.vx = 0;
                ball.vy = 0;
                ball.vz = 0;
                ball.inAir = false;
                ball.isLoose = false;
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
