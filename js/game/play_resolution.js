import {
    game, getPlayer, getRosterObjects, finalizeGameResults, resetGameStats,
    applyStatEvents // <-- Added
} from './state.js';
import {
    pushGameLog, checkBlockCollisions, resolveOngoingBlocks,
    checkTackleCollisions, checkFumbleRecovery, resolvePlayerCollisions,
    handleBallArrival // <-- Added
} from './collisions.js';
import {
    generateSchedule // <-- Added
} from './season.js';
import {
    updateQBDecision, updateThrowoffDecision
} from './ai.js';
import {
    initPlayTelemetry, finalizePlayTelemetry,logPlayDebug
} from './telemetry.js';
import {
    captureFrame
} from './engine_helpers.js';
import {
    setupInitialPlayerStates, updatePlayerTargets
} from './play_execution.js';
import {
    autoMakeSubstitutions, aiSetDepthChart
} from './depth_chart.js';
import {
    offenseFormations, defenseFormations, offensivePlaybook, defensivePlaybook
} from '../data.js';
import { getRandom, getRandomInt } from '../utils.js';
import { updatePlayerPosition, getDistance } from './physics.js';
import { simulateYouthMatch } from './youth_simulation.js';
import { TICK_DURATION_SECONDS } from './simulation_config.js';
import { calculateOverall, estimateBestPosition } from './player.js';
import {
    recordCoachDevelopmentOutcome,
    getEffectiveStaffWorkHours
} from './staff.js';
import {
    getOffensivePlayKnowledge,
    getDefensivePlayKnowledge,
    getTendencyAdjustment
} from './playcalling_knowledge.js';

const FIELD_WIDTH = 53.3;
const FIELD_LENGTH = 120;
const WEEKS_IN_SEASON = 9;

// Lightweight playcalling knowledge + aggregate tendency tracking.
const PLAYCALL_POSITION_SLOTS = {
    QB: ['QB1'], RB: ['RB1'], WR: ['WR1', 'WR2'], TE: ['TE1'],
    OL: ['OL1', 'OL2', 'OL3'], DL: ['DL1', 'DL2', 'DL3', 'DL4'],
    LB: ['LB1', 'LB2', 'LB3'], DB: ['DB1', 'DB2', 'DB3', 'DB4', 'DB5']
};

function getPlaycallSituationKey(down, yardsToGo, ballOn, scoreDiff, drivesRemaining) {
    if (ballOn >= 95 && yardsToGo <= 3) return 'goalLine';
    if (drivesRemaining <= 2 && scoreDiff <= -8) return 'trailingLate';
    if (drivesRemaining <= 2 && scoreDiff >= 8) return 'protectLead';
    if (ballOn >= 80) return 'redZone';
    if (ballOn <= 10) return 'backedUp';
    if (yardsToGo <= 2) return 'shortYardage';
    if ((down === 3 && yardsToGo >= 8) || (down === 4 && yardsToGo >= 5) ||
        (down === 2 && yardsToGo >= 10)) return 'passingDown';
    return 'earlyDown';
}

function getPersonnelGroupKey(formationName, side) {
    const form = side === 'offense'
        ? offenseFormations[formationName]
        : defenseFormations[formationName];
    const p = form?.personnel || {};

    if (side === 'offense') {
        const wr = Number(p.WR) || 0;
        const rb = Number(p.RB) || 0;
        const te = Number(p.TE) || 0;

        if (wr >= 3) return 'spread';
        if (rb >= 2 || te >= 2 || rb + te >= 3 ||
            (wr <= 1 && rb + te >= 2)) return 'heavy';
        if (te >= 1 && wr >= 2) return 'balancedTE';
        return 'balanced';
    }

    const db = Number(p.DB) || 0;
    const front = (Number(p.DL) || 0) + (Number(p.LB) || 0);

    if (db >= 4) return 'passHeavy';
    if (front >= 5) return 'runHeavy';
    if (db <= 2) return 'frontHeavy';
    return 'balanced';
}

function getPlaycallKnowledgeAdjustment(knowledge, team, side, situationKey) {
    const fit = knowledge?.situations?.[situationKey];

    // Catalog values: 1 = less suitable, 2 = neutral, 3 = favorable.
    let adjustment = Number.isFinite(fit)
        ? Math.max(-2, Math.min(2, (fit - 2) * 2))
        : 0;

    const chart = team?.depthChart?.[side] || {};
    const roster = getRosterObjects(team) || [];
    const positionAverages = [];

    for (const position of knowledge?.keyPositions || []) {
        const ratings = [];

        for (const slot of PLAYCALL_POSITION_SLOTS[position] || []) {
            const id = chart[slot];
            if (!id) continue;

            const player = getPlayer(id) ||
                roster.find(p => p?.id === id);
            if (!player) continue;

            let value = 0;
            try {
                value = calculateOverall(player, position);
            } catch {
                value = 0;
            }

            if (Number.isFinite(value) && value > 0) {
                ratings.push(value);
            }
        }

        if (ratings.length) {
            positionAverages.push(
                ratings.reduce((a, b) => a + b, 0) / ratings.length
            );
        }
    }

    if (positionAverages.length) {
        const average = positionAverages.reduce((a, b) => a + b, 0) /
            positionAverages.length;

        // Personnel matters, but cannot overpower situation or coaching style.
        adjustment += Math.max(-3, Math.min(3, (average - 60) * 0.10));
    }

    return adjustment;
}

function getPlaycallCounter(team, source, opponentId, side) {
    if (!team) return null;

    team.playcallTendencies ||= {
        version: 1,
        own: {},
        opponents: {}
    };

    const root = team.playcallTendencies;
    root.own ||= {};
    root.opponents ||= {};

    let owner = root.own;

    if (source === 'opponents') {
        if (opponentId == null) return null;
        owner = root.opponents[String(opponentId)] ||= {};
    }

    return owner[side] ||= {
        total: 0,
        byPlay: {},
        bySituation: {},
        bySituationAndPersonnel: {}
    };
}

function incrementCallCount(team, source, opponentId, side, playKey, situationKey, personnelGroup) {
    if (!playKey) return;

    const c = getPlaycallCounter(team, source, opponentId, side);
    if (!c) return;

    const increment = (obj, key) => {
        obj[key] = Math.min(1000000, (Number(obj[key]) || 0) + 1);
    };

    c.total = Math.min(1000000, (Number(c.total) || 0) + 1);
    increment(c.byPlay, playKey);

    c.bySituation[situationKey] ||= {};
    increment(c.bySituation[situationKey], playKey);

    c.bySituationAndPersonnel[situationKey] ||= {};
    c.bySituationAndPersonnel[situationKey][personnelGroup] ||= {};
    increment(c.bySituationAndPersonnel[situationKey][personnelGroup], playKey);
}

function sumCallCounts(counts) {
    return Object.values(counts || {}).reduce(
        (sum, value) => sum + Math.max(0, Number(value) || 0),
        0
    );
}

function getRelevantOpponentCounts(counter, situationKey, personnelGroup) {
    const exact =
        counter?.bySituationAndPersonnel?.[situationKey]?.[personnelGroup];

    if (sumCallCounts(exact) > 0) return exact;

    const situational = counter?.bySituation?.[situationKey];
    if (sumCallCounts(situational) > 0) return situational;

    return counter?.byPlay || {};
}

function getOffenseVsDefenseEdge(offenseKnowledge, defenseKnowledge) {
    const type = offenseKnowledge?.archetype;
    if (!type || !defenseKnowledge) return 0;

    let edge =
        (defenseKnowledge.vulnerableTo?.includes(type) ? 1 : 0) -
        (defenseKnowledge.protectsAgainst?.includes(type) ? 1 : 0);

    // Some catalog strengths describe broad defensive styles.
    const attacks = offenseKnowledge.attacks || [];
    const defType = defenseKnowledge.archetype;

    if (attacks.includes('aggressiveBlitz') &&
        ['manBlitz', 'zoneBlitz'].includes(defType)) edge += 0.5;

    if (attacks.includes('softZone') &&
        ['zoneCover2', 'zoneCover3', 'balancedZone', 'splitFieldZone'].includes(defType)) {
        edge += 0.5;
    }

    if (attacks.includes('singleHigh') &&
        ['zoneCover3', 'manCoverage'].includes(defType)) edge += 0.5;

    return Math.max(-1, Math.min(1, edge));
}

function getOpponentMatchupAdjustment({
    team,
    opponentId,
    observedSide,
    situationKey,
    personnelGroup,
    candidateKnowledge,
    candidateSide,
    prepPoints,
    coachSkill
} = {}) {
    if (
        !team ||
        opponentId == null ||
        !candidateKnowledge ||
        !['offense', 'defense'].includes(observedSide) ||
        !['offense', 'defense'].includes(candidateSide)
    ) {
        return 0;
    }

    const report = getUnlockedOpponentTendencyBucket(
        team,
        opponentId,
        observedSide,
        situationKey,
        personnelGroup,
        Number(prepPoints) || 0
    );

    if (!report) return 0;

    const observedPlaybook = observedSide === 'offense'
        ? offensivePlaybook
        : defensivePlaybook;

    const getObservedKnowledge = observedSide === 'offense'
        ? getOffensivePlayKnowledge
        : getDefensivePlayKnowledge;

    // Aggregate calls by tactical archetype instead of retaining
    // individual snap records.
    const summarizeBucket = bucket => {
        const summary = {
            totalCalls: 0,
            runCalls: 0,
            passCalls: 0,
            blitzCalls: 0,
            profiles: Object.create(null)
        };

        for (const [key, rawCount] of Object.entries(
            bucket?.byPlay || {}
        )) {
            const count = Number(rawCount);
            const play = observedPlaybook[key];

            if (
                !play ||
                !Number.isFinite(count) ||
                count <= 0
            ) {
                continue;
            }

            const knowledge = getObservedKnowledge(key, play);
            if (!knowledge?.archetype) continue;

            summary.totalCalls += count;

            if (observedSide === 'offense') {
                if (play.type === 'run') {
                    summary.runCalls += count;
                } else if (play.type === 'pass') {
                    summary.passCalls += count;
                }
            } else if (
                knowledge.isBlitz ||
                play.blitz ||
                play.tags?.includes('blitz')
            ) {
                summary.blitzCalls += count;
            }

            const archetype = knowledge.archetype;

            if (!summary.profiles[archetype]) {
                summary.profiles[archetype] = {
                    calls: 0,
                    attacks: new Set(),
                    protectsAgainst: new Set(),
                    vulnerableTo: new Set(),
                    isBlitz: false
                };
            }

            const profile = summary.profiles[archetype];

            profile.calls += count;
            profile.isBlitz ||= Boolean(knowledge.isBlitz);

            for (const concept of knowledge.attacks || []) {
                profile.attacks.add(concept);
            }

            for (const concept of knowledge.protectsAgainst || []) {
                profile.protectsAgainst.add(concept);
            }

            for (const concept of knowledge.vulnerableTo || []) {
                profile.vulnerableTo.add(concept);
            }
        }

        return summary;
    };

    const overall = summarizeBucket(report.overall);
    const sample = summarizeBucket(report.bucket);

    if (overall.totalCalls <= 0 || sample.totalCalls <= 0) {
        return 0;
    }

    const boundedPrep = Math.max(
        0,
        Math.min(12, Number(prepPoints) || 0)
    );

    const boundedCoachSkill = Math.max(
        0,
        Math.min(100, Number(coachSkill) || 50)
    );

    const minimumSample = report.level === 'situationPersonnel'
        ? 6
        : report.level === 'broad'
            ? 8
            : 4;

    const confidence = Math.max(
        0,
        Math.min(
            1,
            Math.sqrt(boundedPrep / 12) *
            Math.sqrt(
                Math.min(1, sample.totalCalls / (minimumSample * 2))
            )
        )
    );

    const styleWeight = Math.max(
        0.2,
        Math.min(1, boundedCoachSkill / 100)
    );

    // Broad reports use simple tendencies only. Detailed reports
    // compare a situation/personnel sample with the opponent's
    // overall call distribution.
    if (report.level === 'broad') {
        if (observedSide === 'offense' && candidateSide === 'defense') {
            const knownRunPassCalls = sample.runCalls + sample.passCalls;

            if (knownRunPassCalls <= 0) return 0;

            const runRate = sample.runCalls / knownRunPassCalls;

            const runBias = getTendencyAdjustment({
                observedRate: runRate,
                expectedRate: 0.5,
                confidence,
                coachStyleWeight: styleWeight,
                maxAdjustment: 3
            });

            const defArchetype = candidateKnowledge.archetype;
            const protectsAgainstRun = [
                'runFit',
                'insideRun',
                'outsideRun',
                'powerRun'
            ].includes(defArchetype) ||
                (candidateKnowledge.protectsAgainst || []).some(concept =>
                    ['insideRun', 'outsideRun', 'powerRun'].includes(concept)
                );

            const protectsAgainstPass =
                (candidateKnowledge.protectsAgainst || []).some(concept =>
                    [
                        'verticalPass',
                        'quickPass',
                        'crossingPass',
                        'balancedPass',
                        'screenPass',
                        'floodPass'
                    ].includes(concept)
                );

            if (runBias > 0 && protectsAgainstRun) {
                return Math.min(3, runBias);
            }

            if (runBias < 0 && protectsAgainstPass) {
                return Math.min(3, Math.abs(runBias));
            }

            return 0;
        }

        if (observedSide === 'defense' && candidateSide === 'offense') {
            const blitzRate = sample.blitzCalls / sample.totalCalls;

            const blitzBias = getTendencyAdjustment({
                observedRate: blitzRate,
                expectedRate: 0.35,
                confidence,
                coachStyleWeight: styleWeight,
                maxAdjustment: 3
            });

            // A high blitz rate makes quick answers and screens more
            // attractive, but doesn't force the offense to call them.
            const attacksPressure =
                candidateKnowledge.archetype === 'quickPass' ||
                candidateKnowledge.archetype === 'screenPass' ||
                (candidateKnowledge.attacks || []).some(concept =>
                    ['aggressiveBlitz', 'upfieldRush', 'limitedProtection'].includes(concept)
                );

            return blitzBias > 0 && attacksPressure
                ? Math.min(3, blitzBias)
                : 0;
        }

        return 0;
    }

    let matchupAdjustment = 0;

    for (const [archetype, sampledProfile] of Object.entries(
        sample.profiles
    )) {
        const overallProfile = overall.profiles[archetype];

        if (!overallProfile || sampledProfile.calls <= 0) continue;

        const observedRate =
            sampledProfile.calls / sample.totalCalls;

        const expectedRate =
            overallProfile.calls / overall.totalCalls;

        // Only counter tendencies that are stronger in this sample
        // than in the opponent's overall behavior.
        const signal = getTendencyAdjustment({
            observedRate,
            expectedRate,
            confidence,
            coachStyleWeight: styleWeight,
            maxAdjustment: 3
        });

        if (signal <= 0) continue;

        let countersTendency = false;
        let vulnerableToTendency = false;

        if (candidateSide === 'offense' && observedSide === 'defense') {
            countersTendency =
                sampledProfile.vulnerableTo.has(candidateKnowledge.archetype) ||
                (candidateKnowledge.attacks || []).some(concept =>
                    sampledProfile.vulnerableTo.has(concept)
                );

            vulnerableToTendency =
                sampledProfile.protectsAgainst.has(candidateKnowledge.archetype) ||
                (candidateKnowledge.vulnerableTo || []).some(concept =>
                    sampledProfile.attacks.has(concept)
                );
        } else if (
            candidateSide === 'defense' &&
            observedSide === 'offense'
        ) {
            countersTendency =
                (candidateKnowledge.protectsAgainst || []).includes(archetype) ||
                (candidateKnowledge.protectsAgainst || []).some(concept =>
                    sampledProfile.attacks.has(concept)
                );

            vulnerableToTendency =
                (candidateKnowledge.vulnerableTo || []).includes(archetype) ||
                (candidateKnowledge.vulnerableTo || []).some(concept =>
                    sampledProfile.attacks.has(concept)
                );
        }

        if (countersTendency && !vulnerableToTendency) {
            matchupAdjustment += signal;
        } else if (vulnerableToTendency && !countersTendency) {
            matchupAdjustment -= signal;
        }
    }

    // Prevent multiple observed patterns from overpowering the base call.
    return Math.max(
        -5,
        Math.min(5, matchupAdjustment)
    );
}


function initiateLateralToss(playState, thrower, receiver, purpose) {
    if (
        !playState?.ballState ||
        !thrower ||
        !receiver ||
        thrower.id === receiver.id
    ) {
        return false;
    }

    const ball = playState.ballState;
    const initialDistance = getDistance(thrower, receiver);

    // Bound the flight duration to avoid excessively long exchanges.
    const flightTicks = Math.max(
        10, // Increased minimum hangtime to 0.4s for a realistic soft toss
        Math.min(30, Math.ceil(initialDistance / 0.32)) // Slower pitch velocity (~8 yds/sec)
    );

    const flightTime = flightTicks * TICK_DURATION_SECONDS;

    // Lead the receiver slightly based on their current movement.
    const targetX = Math.max(
        0.5,
        Math.min(
            FIELD_WIDTH - 0.5,
            receiver.x + (receiver.vx || 0) * flightTime
        )
    );

    const targetY = Math.max(
        0.5,
        Math.min(
            FIELD_LENGTH - 0.5,
            receiver.y + (receiver.vy || 0) * flightTime
        )
    );

    const dx = targetX - thrower.x;
    const dy = targetY - thrower.y;

    // Start a short airborne pitch using the existing ball physics.
    ball.x = thrower.x;
    ball.y = thrower.y;
    ball.z = 1.0;

    ball.prevX = ball.x;
    ball.prevY = ball.y;
    ball.prevZ = ball.z;

    ball.vx = dx / flightTime;
    ball.vy = dy / flightTime;
    ball.vz =
        9.8 * (flightTime - TICK_DURATION_SECONDS) / 2;

    ball.targetX = targetX;
    ball.targetY = targetY;
    ball.targetPlayerId = receiver.id;

    ball.throwerId = thrower.id;
    ball.throwTick = playState.tick;

    ball.inAir = true;
    ball.isLoose = false;
    ball.isLateral = true;
    ball.lateralPurpose = purpose;
    ball.isThrowAway = false;
    ball.isSwatted = false;

    ball.tipCount = 0;
    ball._attemptedCatchPlayerIds = new Set();
    ball.lastInteraction = null;
    ball.lastDroppedById = null;
    ball.droppedById = null;

    // A lateral has no owner while it is traveling.
    thrower.hasBall = false;
    thrower.isBallCarrier = false;
    thrower.action = 'idle';

    receiver.hasBall = false;
    receiver.isBallCarrier = false;
    receiver.action = 'tracking_ball';

    if (receiver.slot?.startsWith('RB')) {
        receiver._handoffTick = playState.tick;
    }

    playState.handoffRequired = false;
    playState.handoffOccurred = true;

    if (purpose === 'flea_return') {
        playState.fleaFlickerPhase = 'return_pitch';
    }

    logPlayDebug(
        'LATERAL_RELEASE',
        `${thrower.name} pitches the ball to ${receiver.name}`,
        {
            purpose,
            distance: Number(initialDistance.toFixed(2)),
            flightTicks,
            targetPlayerId: receiver.id
        },
        playState.tick
    );

    return true;
}

export function determinePuntDecision(down, yardsToGo, ballOn, offenseTeam = null, scoreDiff = 0, timeRemaining = 420) {
    if (down !== 4) return false;
    if (ballOn >= 60) return false; // In field goal / red zone territory

    // Trailing late in 4th quarter: always go for it
    if (timeRemaining < 180 && scoreDiff < 0) return false;

    const sit = offenseTeam?.gameplan?.situational || { fourthDownBravery: 50 };
    const bravery = sit.fourthDownBravery; // 0 to 100

    // Bravery mapping:
    // 0-30: Very conservative. Punts if >1 yard or own territory.
    // 31-60: Standard. Punts if >2 yards or own territory.
    // 61-85: Aggressive. Goes for it on 4th & 3 or anywhere past own 40.
    // 86-100: Gambler. Goes for it on 4th & 5 or anywhere past own 30.

    if (bravery < 30) {
        if (yardsToGo > 1 || ballOn < 55) return true;
    } else if (bravery < 60) {
        if (yardsToGo > 2 || ballOn < 45) return true;
    } else if (bravery < 85) {
        if (yardsToGo > 3 && ballOn < 40) return true;
    } else {
        if (yardsToGo > 5 && ballOn < 30) return true;
    }

    return false;
}

function getOffensiveFormationForPlay(offense, playKey) {
    const play = offensivePlaybook[playKey];

    if (!play || play.type === 'punt') return null;

    const currentFormation = offense?.formations?.offense;
    const preferredFormation = offense?.coach?.preferredOffense;

    // An explicit formation in the play data takes priority.
    if (
        play.formation &&
        play.formation !== 'Punt' &&
        offenseFormations[play.formation]
    ) {
        return play.formation;
    }

    // Respect explicit formation compatibility.
    if (
        Array.isArray(play.compatibleFormations) &&
        play.compatibleFormations.length > 0
    ) {
        const compatible = play.compatibleFormations.filter(key =>
            key !== 'Punt' && Boolean(offenseFormations[key])
        );

        if (compatible.length === 0) return null;

        if (compatible.includes(currentFormation)) {
            return currentFormation;
        }

        if (compatible.includes(preferredFormation)) {
            return preferredFormation;
        }

        return compatible[0];
    }

    // Legacy formation-specific play keys, such as Trips_QuickSlants.
    const namedFormation = Object.keys(offenseFormations)
        .filter(key =>
            key !== 'Punt' &&
            (playKey === key || playKey.startsWith(`${key}_`))
        )
        .sort((a, b) => b.length - a.length)[0];

    if (namedFormation) return namedFormation;

    // Universal plays use the team's preferred/current formation.
    if (currentFormation !== 'Punt' && offenseFormations[currentFormation]) {
        return currentFormation;
    }

    if (
        preferredFormation !== 'Punt' &&
        offenseFormations[preferredFormation]
    ) {
        return preferredFormation;
    }

    return offenseFormations.Balanced
        ? 'Balanced'
        : Object.keys(offenseFormations).find(key => key !== 'Punt') || null;
}

export function findAudiblePlay(offense, desiredType, desiredTag = null) {
    const offenseFormationName = offense.formations?.offense || 'Balanced';

    const basics = [
        'Uni_InsideZone',
        'Uni_StretchRight',
        'Uni_QuickSlants',
        'Uni_FourVerts'
    ];

    const installed = offense.gameplan?.installedOffense || [];
    const pool = Array.from(new Set([...basics, ...installed]));

    const possiblePlays = pool.filter(key => {
        const play = offensivePlaybook[key];
        if (!play || play.type === 'punt') return false;

        const matchesType = !desiredType || play.type === desiredType;
        const matchesFormation =
            getOffensiveFormationForPlay(offense, key) === offenseFormationName;

        return matchesType && matchesFormation;
    });

    if (desiredTag && possiblePlays.length > 0) {
        const tagged = possiblePlays.filter(key =>
            offensivePlaybook[key]?.tags?.includes(desiredTag)
        );

        if (tagged.length > 0) return getRandom(tagged);
    }

    if (possiblePlays.length > 0) return getRandom(possiblePlays);

    const fallbackKey =
        desiredType === 'pass' ? 'Uni_QuickSlants' : 'Uni_InsideZone';

    if (
        offensivePlaybook[fallbackKey] &&
        getOffensiveFormationForPlay(offense, fallbackKey) === offenseFormationName
    ) {
        return fallbackKey;
    }

    return null;
}

export function aiCheckAudible(offense, offensivePlayKey, defense, defensivePlayKey, gameLog) {
    const offensePlay = offensivePlaybook[offensivePlayKey];
    const defensePlay = defensivePlaybook[defensivePlayKey];
    const roster = getRosterObjects(offense);
    const qb = roster.find(p => p && p.id === offense.depthChart?.offense?.QB1);

    const qbIQ = qb?.attributes?.mental?.playbookIQ ?? 50;
    const qbDecision = qb?.attributes?.mental?.decisionMaking ?? 50;

    if (!offensePlay || !defensePlay || !qb) {
        return { playKey: offensivePlayKey, didAudible: false };
    }

    const iqChance = (qbIQ + qbDecision) / 200;
    let newPlayKey = offensivePlayKey;
    let didAudible = false;

    const getBoxThreatLevel = () => {
        let threatLevel = 0;
        if (defensePlay.concept === 'Run') threatLevel += 2;
        if (defensePlay.blitz && defensePlay.concept !== 'Zone') threatLevel += 3;
        if (defensePlay.concept === 'Man' && defensePlay.blitz) threatLevel += 2;
        return threatLevel;
    };

    const boxThreatLevel = getBoxThreatLevel();

    if (offensePlay.type === 'run' && boxThreatLevel >= 2) {
        const audibleProbability = Math.min(0.8, iqChance + (boxThreatLevel * 0.15));
        if (Math.random() < audibleProbability) {
            const audibleTo = findAudiblePlay(offense, 'pass', 'short');
            if (audibleTo) {
                newPlayKey = audibleTo;
                didAudible = true;
                if (gameLog) {
                    const threatDesc = boxThreatLevel >= 4 ? 'aggressive blitz' : 'stacked box';
                    gameLog.push(`[Audible]: 🧠 ${qb.name} (IQ:${qbIQ}) diagnoses ${threatDesc} and audibles to pass!`);
                }
            }
        }
    } else if (offensePlay.type === 'pass' && defensePlay.concept === 'Zone' && !defensePlay.blitz) {
        if (offensePlay.tags?.includes('deep') && Math.random() < (iqChance * 0.7)) {
            const audibleTo = findAudiblePlay(offense, 'run', 'inside');
            if (audibleTo) {
                newPlayKey = audibleTo;
                didAudible = true;
                if (gameLog) {
                    gameLog.push(`[Audible]: 🧠 ${qb.name} sees soft zone and audibles!`);
                }
            }
        }
    }

    return { playKey: newPlayKey, didAudible };
}

export function determinePlayCall(offense, defense, down, yardsToGo, ballOn, scoreDiff, gameLog, drivesRemaining) {
    if (!offense || !offense.formations) return 'Uni_InsideZone';

    const formationName = offense.formations.offense;
    const staffCoaches = Array.isArray(offense.coaches)
        ? offense.coaches.filter(coach => coach?.id != null)
        : [];

    const assignedHours = new Map();

    for (const assignment of offense.staffWorkPlan?.assignments || []) {
        if (
            assignment?.task !== 'offensePrep' ||
            !assignment.coachId
        ) {
            continue;
        }

        const hours = getEffectiveStaffWorkHours(
            offense,
            assignment
        );

        if (!Number.isFinite(hours) || hours <= 0) continue;

        const id = String(assignment.coachId);
        assignedHours.set(id, (assignedHours.get(id) || 0) + hours);
    }

    const offenseSkill = coach => {
        const ratings = coach?.ratings || {};
        return (
            (Number(ratings.offSchemeMastery) || 50) +
            (Number(ratings.gameplanInstinct) || 50) +
            (Number(ratings.inGameAdjustments) || 50)
        ) / 3;
    };

    const assignedOffenseCoach = staffCoaches
        .filter(coach => (assignedHours.get(String(coach.id)) || 0) > 0)
        .sort((a, b) => {
            const hoursDifference =
                (assignedHours.get(String(b.id)) || 0) -
                (assignedHours.get(String(a.id)) || 0);

            return hoursDifference || offenseSkill(b) - offenseSkill(a);
        })[0];

    const coach = assignedOffenseCoach ||
        [...staffCoaches].sort(
            (a, b) => offenseSkill(b) - offenseSkill(a)
        )[0] ||
        null;

    const recentPlays = offense.recentPlayHistory || [];

    const formationPlays = Object.keys(offensivePlaybook).filter(key => {
        const play = offensivePlaybook[key];
        const isCompatible = play.compatibleFormations && play.compatibleFormations.includes(formationName);
        const isLegacyMatch = key.startsWith(formationName);
        const isUniversal = key.startsWith('Uni_') || key.startsWith('PA_') || key.startsWith('Trick_') || key.startsWith('RPO_');
        if (play.compatibleFormations) return isCompatible;
        return isLegacyMatch || isUniversal;
    });

    if (formationPlays.length === 0) return 'Uni_InsideZone';

    const isGoalLine = ballOn >= 90;
    const isBackedUp = ballOn <= 10;
    const isShort = yardsToGo <= 2;
    const isLong =
        (down === 3 && yardsToGo >= 8) ||
        (down === 4 && yardsToGo >= 5) ||
        (down === 2 && yardsToGo >= 10);
    const isDesperation = drivesRemaining <= 2 && scoreDiff <= -8;
    const isChewClock = drivesRemaining <= 2 && scoreDiff >= 8;

    const playcallSituation = getPlaycallSituationKey(
        down, yardsToGo, ballOn, scoreDiff, drivesRemaining
    );

    // Base run probability influenced by Situational Clipboard
    const sit = offense.gameplan?.situational || { earlyDownTendency: 55, thirdAndLongAggressiveness: 50 };
    let runProbability = sit.earlyDownTendency / 100; // 0.0 to 1.0

    // Normal downs/distances
    if (isShort) runProbability += 0.30;
    if (isLong) runProbability -= 0.25; // Less punishing reduction for long downs so teams still run draws
    if (isGoalLine) runProbability += 0.25; // Run it in when close!
    if (isChewClock) runProbability += 0.40;
    if (isDesperation) runProbability = 0.05;

    // First Down Tendency: Teams should try to establish the run on 1st down
    if (down === 1 && !isDesperation && !isChewClock) runProbability += 0.15;

    // ==========================================================
    // OFFENSIVE DECISION MODEL
    // ==========================================================
    // Run/pass tendency is a PRIOR, not a hard decision.
    // The AI will score every compatible play and let situation,
    // QB processing, play design, personnel fit, and recent usage
    // determine the final choice.

    const offChart = offense.depthChart?.offense || {};

    const getSlotOvr = (slot) => {
        const pid = offChart[slot];
        const p = pid ? getPlayer(pid) : null;
        return p ? calculateOverall(p, p.pos || estimateBestPosition(p)) : 0;
    };

    const offenseRoster = getRosterObjects(offense);
    const qb = offenseRoster.find(
        p => p && p.id === offense.depthChart?.offense?.QB1
    );

    const qbIQ = qb?.attributes?.mental?.playbookIQ ?? 50;
    const qbDecision = qb?.attributes?.mental?.decisionMaking ?? 50;

    // High-IQ QBs are better at recognizing which plays fit the situation.
    // Low-IQ QBs stay closer to the team's normal tendencies.
    const qbProcessing = (qbIQ + qbDecision) / 200;
    const situationalWeight = 0.75 + (qbProcessing * 0.50);

    runProbability = Math.max(0.15, Math.min(0.85, runProbability));

    // IMPORTANT:
    // Do not split into run/pass candidates first.
    // A strong pass should be able to beat a mediocre run, and vice versa.
    // 4 Standard Backyard Fundamentals (Always locked: 1 inside run, 1 outside run, 1 quick pass, 1 deep pass)
    const BACKYARD_BASICS_OFF = ['Uni_InsideZone', 'Uni_StretchRight', 'Uni_QuickSlants', 'Uni_FourVerts'];
    const installed = (offense.gameplan?.installedOffense || []).slice(0, 8); // Max 8 custom napkin plays
    const activePlaybookKeys = Array.from(new Set([...BACKYARD_BASICS_OFF, ...installed]));

        // Select only installed plays and standard fundamentals.
    // The selected play's formation is resolved separately from the
    // team's preferred formation.
    let candidateKeys = activePlaybookKeys.filter(key => {
        const play = offensivePlaybook[key];
        if (!play || play.type === 'punt') return false;

        const formationForPlay = getOffensiveFormationForPlay(offense, key);

        return Boolean(
            formationForPlay &&
            offenseFormations[formationForPlay]
        );
    });

    if (candidateKeys.length === 0) {
        candidateKeys = BACKYARD_BASICS_OFF.filter(key => {
            const play = offensivePlaybook[key];
            const formationForPlay = getOffensiveFormationForPlay(offense, key);

            return Boolean(
                play &&
                formationForPlay &&
                offenseFormations[formationForPlay]
            );
        });
    }

    if (candidateKeys.length === 0) return 'Uni_InsideZone';
    // Ensure target history array exists
    if (!offense.recentTargets) offense.recentTargets = [];

    const staffPreparation = offense.gameplan?.staffPreparation;
    const preparationIsCurrent =
        staffPreparation?.preparedForYear === game?.year &&
        staffPreparation?.preparedForWeek === game?.currentWeek;

    const offensivePrepPoints = Math.max(
        0,
        Math.min(
            12,
            preparationIsCurrent &&
                Number.isFinite(staffPreparation?.offensePoints)
                ? staffPreparation.offensePoints
                : 0
        )
    );

    const offensivePrepByPlay = preparationIsCurrent &&
        staffPreparation?.offenseByPlay &&
        typeof staffPreparation.offenseByPlay === 'object'
        ? staffPreparation.offenseByPlay
        : {};

    let scoredPlays = candidateKeys.map(key => {
        const play = offensivePlaybook[key];
        const tags = play.tags || [];
        let score = 50;


        // ======================================================
        // 1. RUN/PASS TENDENCY = SOFT PRIOR
        // ======================================================
        // Example:
        // 70% run tendency => run gets a modest bonus,
        // but an excellent pass can still win the comparison.
        const typePrior = play.type === 'run'
            ? runProbability
            : (1 - runProbability);

        score += (typePrior - 0.5) * 30;

        // PLAY MASTERY INFLUENCE: Kids prefer plays they've actually practiced!
        const playMastery = offense.gameplan?.mastery?.[key] || 40;
        score += (playMastery - 50) * 0.35; // Mastered plays (+15 score) beat unfamiliar plays (-10 score)

        // STAFF PREPARATION: Reward plays suited to the current situation.
        const preparedForRun =
            play.type === 'run' && runProbability >= 0.5;

        const preparedForPass =
            play.type === 'pass' && runProbability < 0.5;

        const preparedForSituation =
            (isGoalLine && play.type === 'run') ||
            (isShort &&
                (
                    tags.includes('inside') ||
                    tags.includes('power') ||
                    tags.includes('short')
                )) ||
            (isLong &&
                (
                    tags.includes('deep') ||
                    tags.includes('medium')
                )) ||
            (isBackedUp && tags.includes('inside'));

        if (
            offensivePrepPoints > 0 &&
            (
                preparedForRun ||
                preparedForPass ||
                preparedForSituation
            )
        ) {
            score += offensivePrepPoints * 0.35;
        }

        // TARGETED STAFF PREPARATION:
        // Give individually prepared plays a modest selection bonus.
        // This bonus applies only to preparation from the current week.
        const targetedPrepPoints = Number(
            offensivePrepByPlay[key]
        );

        if (
            Number.isFinite(targetedPrepPoints) &&
            targetedPrepPoints > 0
        ) {
            score += Math.min(4, targetedPrepPoints) * 0.85;
        }

        // ======================================================
        // 2. SITUATIONAL FOOTBALL (TIERED BY COACH INSTINCT & BIAS)
        // ======================================================
        const coachInstinct = coach?.ratings?.gameplanInstinct || 50;
        const coachIQFactor = coachInstinct / 100; // 0.0 to 1.0 scale
        
        // --- LEVEL 1: BASIC FOOTBALL LOGIC (Universal) ---
        if (isShort) {
            if (play.type === 'run') score += 15 * situationalWeight;
            if (tags.includes('inside') || tags.includes('power')) score += 20 * situationalWeight;
            if (play.type === 'pass' && tags.includes('short')) score += 15 * situationalWeight;
            if (tags.includes('deep')) score -= 25; // Stop throwing bombs on 3rd & 1
        }
        
        if (isLong) {
            if (play.type === 'run') score -= 20 * situationalWeight;
            if (tags.includes('deep')) score += 25 * situationalWeight;
            if (tags.includes('medium')) score += 15 * situationalWeight;
            if (play.type === 'pass' && tags.includes('short')) score -= 10 * situationalWeight;
        }
        
        if (isGoalLine) {
            if (play.type === 'run') score += 25 * situationalWeight;
            if (tags.includes('short')) score += 15 * situationalWeight;
            if (tags.includes('deep') || tags.includes('vertical')) score -= 60; // Field gets compressed!
        }
        
        if (isBackedUp) {
            if (tags.includes('inside')) score += 15 * situationalWeight;
            if (tags.includes('deep')) score -= 20; // Too risky near own endzone
        }

        if (down === 1 && !isDesperation && !isChewClock) {
            if (play.type === 'run') score += 10 * situationalWeight;
            if (tags.includes('pa')) score += 15 * situationalWeight;
        }

        // --- LEVEL 2: SITUATIONAL CLIPBOARD SETTINGS ---
        
        // Aggressiveness on 3rd & Long
        if (isLong) {
            const aggro = (sit.thirdAndLongAggressiveness || 50) / 100; // 0.0 to 1.0
            if (tags.includes('deep')) score += (aggro - 0.5) * 40; // Aggressive loves deep, conservative hates it
            if (tags.includes('screen') || tags.includes('short')) score -= (aggro - 0.5) * 30;
        }

        // --- LEVEL 3: ELITE COACH INSTINCTS (Adjusting to Game State & Opponent) ---
        if (coachInstinct >= 60) {
            // Smart coaches actively avoid calling the exact same play twice in a row
            const lastPlay = recentPlays[recentPlays.length - 1];
            if (lastPlay === key) score -= (30 * coachIQFactor);

            // 2nd and Short is a prime passing down for aggressive/smart play-callers
            if (down === 2 && isShort && !isChewClock) {
                if (tags.includes('deep') || tags.includes('pa')) score += (25 * coachIQFactor);
            }
            
            // Adjust based on defense if known (Advanced Scheme Countering)
            const defFormation = defense?.formations?.defense || '';
            if (defFormation.includes('4-2-2') || defFormation.includes('GoalLine')) {
                // Heavy run stop defense: Smart coach calls play-action or spread passing
                if (tags.includes('pa') || tags.includes('screen')) score += (22 * coachIQFactor);
                if (play.type === 'run' && tags.includes('inside')) score -= (18 * coachIQFactor);
            } else if (defFormation.includes('Dime') || defFormation.includes('3-0-5')) {
                // Light pass defense: Smart coach runs the ball down their throat
                if (play.type === 'run') score += (28 * coachIQFactor);
                if (tags.includes('deep')) score -= (15 * coachIQFactor);
            }
        }

        // ======================================================
        // 3. PLAYER / READ FIT
        // ======================================================
        // Player talent matters, but only because the specific
        // play asks that player to execute it.
        //
        // This is intentionally a SMALL adjustment.
        // A 90 OVR WR should not automatically cause more targets.
        // It simply makes a play using that WR somewhat more attractive.
        const readSlots = play.type === 'run'
            ? ['RB1']
            : (play.readProgression || []).slice(0, 3);

        const readOvrs = readSlots
            .map(slot => getSlotOvr(slot))
            .filter(ovr => ovr > 0);

        if (readOvrs.length > 0) {
            const firstReadOvr = readOvrs[0];
            const supportingReads = readOvrs.slice(1);

            const supportingAvg = supportingReads.length > 0
                ? supportingReads.reduce((sum, ovr) => sum + ovr, 0) / supportingReads.length
                : firstReadOvr;

            // First read matters more, but secondary reads still count.
            const readQuality = (firstReadOvr * 0.65) + (supportingAvg * 0.35);

            // Keep player talent from dominating play selection.
            const readFit = Math.max(
                -8,
                Math.min(8, (readQuality - 50) * 0.18)
            );

            // Better QBs can make more use of quality reads.
            score += readFit * (0.65 + qbProcessing * 0.70);
        }

        // ======================================================
        // 4. PLAY REPETITION
        // ======================================================
        // Encourage variety, but don't make the AI allergic to a
        // successful play that remains the best option.
        const recentPlayCount = recentPlays.filter(k => k === key).length;

        if (recentPlayCount > 0) {
            score -= Math.min(18, recentPlayCount * 7);
        }

        // ======================================================
        // 5. RECENT TARGET USAGE
        // ======================================================
        // This is a mild workload/variety consideration.
        // It should NEVER crater a good matchup.
        const primaryTarget = play.type === 'run'
            ? 'RB1'
            : play.readProgression?.[0];

        if (primaryTarget) {
            const recentTargetCount =
                offense.recentTargets.filter(t => t === primaryTarget).length;

            if (recentTargetCount > 0) {
                score -= Math.min(10, recentTargetCount * 3);
            }
        }

        // Late-down short-yardage discipline:
        // Favor a run when the offense needs only a few feet.
        // Keep desperation situations flexible.
        if (
            !isDesperation &&
            yardsToGo <= 1.5 &&
            (down === 3 || down === 4)
        ) {
            if (play.type === 'run') {
                score += down === 4 ? 40 : 28;
            } else {
                score -= down === 4 ? 10 : 6;
            }
        }

        // Tactical knowledge: situation and key personnel.
        // Apply this adjustment once and keep it bounded.
        const tacticalKnowledge = getOffensivePlayKnowledge(key, play);

        const boundedKnowledgeAdjustment =
            getPlaycallKnowledgeAdjustment(
                tacticalKnowledge,
                offense,
                'offense',
                playcallSituation
            );

        score += Math.max(
            -8,
            Math.min(8, Number(boundedKnowledgeAdjustment) || 0)
        );

        const candidateFormationName =
            getOffensiveFormationForPlay(offense, key) || formationName;

        score += getOpponentMatchupAdjustment({
            team: offense,
            opponentId: defense?.id,
            observedSide: 'defense',
            situationKey: playcallSituation,

            // These counts describe the opponent's defensive personnel,
            // not the offensive formation being considered.
            personnelGroup: getPersonnelGroupKey(
                defense?.formations?.defense || '3-2-3',
                'defense'
            ),

            candidateKnowledge: tacticalKnowledge,
            candidateSide: 'offense',
            prepPoints: offensivePrepPoints,
            coachSkill: offenseSkill(coach)
        });

        return {
            key,
            score: Math.max(1, score)
        };
    });

    scoredPlays.sort((a, b) => b.score - a.score);
    const topOptions = scoredPlays.slice(0, 5);
    const totalScore = topOptions.reduce((sum, p) => sum + p.score, 0);

    let roll = Math.random() * totalScore;
    let selectedKey = topOptions[0].key;
    for (const option of topOptions) {
        if (roll < option.score) {
            selectedKey = option.key;
            break;
        }
        roll -= option.score;
    }

    if (!offense.recentPlayHistory) offense.recentPlayHistory = [];
    offense.recentPlayHistory.push(selectedKey);
    if (offense.recentPlayHistory.length > 6) offense.recentPlayHistory.shift();

    if (!offense.recentTargets) offense.recentTargets = [];
    const selectedPlayDef = offensivePlaybook[selectedKey];
    const targetSlot = selectedPlayDef?.type === 'run' ? 'RB1' : selectedPlayDef?.readProgression?.[0];
    if (targetSlot) {
        offense.recentTargets.push(targetSlot);
        if (offense.recentTargets.length > 4) offense.recentTargets.shift(); // Only track last 4 plays
    }

    return selectedKey;
}

export function formationMatchesCriteria(form, criteria) {
    if (!form || !criteria) return false;
    const p = form.personnel || {};
    const front = (p.DL || 0) + (p.LB || 0);
    if (criteria.minDL && (p.DL || 0) < criteria.minDL) return false;
    if (criteria.minLB && (p.LB || 0) < criteria.minLB) return false;
    if (criteria.minDB && (p.DB || 0) < criteria.minDB) return false;
    if (criteria.minWR && (p.WR || 0) < criteria.minWR) return false;
    if (criteria.minFront && front < criteria.minFront) return false;
    return true;
}

export function isPlayCompatibleWithDefense(play, formationName) {
    if (!play) return false;
    if (Array.isArray(play.compatibleFormations) && play.compatibleFormations.includes(formationName)) return true;
    if (play.compatibleCriteria) {
        const form = defenseFormations[formationName];
        if (formationMatchesCriteria(form, play.compatibleCriteria)) return true;
    }
    if (!play.hasOwnProperty('compatibleFormations') && !play.hasOwnProperty('compatibleCriteria')) return true;
    return false;
}

export function determineDefensiveFormation(defense, offenseFormationName, down, yardsToGo, gameLog, ballOn = 50) {
    if (offenseFormationName === 'Punt') return 'Punt_Return';

    //const captainIsSharp = checkCaptainDiscipline(defense, gameLog);
    const offData = offenseFormations[offenseFormationName];
    const personnel = offData ? offData.personnel : { WR: 2, RB: 1 };
    const wrCount = personnel.WR || 2;
    const heavyCount = (personnel.RB || 1) + (personnel.TE || 0);
    let coachPref = defense.coach?.preferredDefense || null;
    if (!coachPref || !defenseFormations[coachPref]) coachPref = null;

    const isGoalLineSituation = ballOn >= 95 && yardsToGo <= 3;

    const defEntries = Object.entries(defenseFormations).filter(([key]) =>
        key !== 'Punt_Return' &&
        (isGoalLineSituation || !/goal.?line/i.test(key))
    );

    // Don't preserve a coach preference that is illegal for this situation.
    if (coachPref && !defEntries.some(([key]) => key === coachPref)) {
        coachPref = null;
    }
    const pickMax = (scoreFn) => {
        let best = null; let bestScore = -Infinity;
        for (const [key, val] of defEntries) {
            const score = scoreFn(val);
            if (score > bestScore) { bestScore = score; best = key; }
        }
        return best;
    };

    if (yardsToGo <= 2 && isGoalLineSituation) {
        return pickMax(v =>
            (v.personnel?.DL || 0) + (v.personnel?.LB || 0)
        ) || coachPref || defEntries[0]?.[0];
    }

    // Away from the goal line, occasionally use a heavier front
    // on short yardage without making it the automatic choice.
    if (yardsToGo <= 2 && Math.random() < 0.40) {
        return pickMax(v =>
            (v.personnel?.DL || 0) + (v.personnel?.LB || 0)
        ) || coachPref || defEntries[0]?.[0];
    }

    if ((down === 3 && yardsToGo > 8) || (down === 4 && yardsToGo > 5)) {
        const candidate = pickMax(v => (v.personnel?.DB || 0));
        return candidate || coachPref || defEntries[0]?.[0];
    }

    if (wrCount >= 4) {
        const d4 = defEntries.find(([k, v]) => (v.personnel?.DB || 0) >= 4);
        return (d4 && d4[0]) ||
            pickMax(v => (v.personnel?.DB || 0)) ||
            coachPref ||
            defEntries[0]?.[0];
    }

    if (heavyCount >= 3 || (personnel.RB || 0) >= 2) {
        const heavy = pickMax(v =>
            (v.personnel?.DL || 0) + (v.personnel?.LB || 0)
        );
        return heavy || coachPref || defEntries[0]?.[0];
    }

    if (coachPref) return coachPref;

        return pickMax(v =>
        -Math.abs((v.personnel?.DB || 0) - wrCount)
    ) || defEntries[0]?.[0];
}

function getUnlockedOpponentTendencyBucket(
    team,
    opponentId,
    calledSide,
    situationKey,
    personnelGroupKey,
    prepPoints
) {
    if (!team || opponentId == null || prepPoints < 3) {
        return null;
    }

    const overall =
        team.playcallTendencies?.snapCounts?.opponents?.[
            String(opponentId)
        ]?.[calledSide];

    if (!overall?.byPlay || !(overall.totalCalls > 0)) {
        return null;
    }

    // Try the most detailed report first, then fall back to
    // the best lower-detail report with enough observations.
    if (prepPoints >= 12) {
        const combined =
            overall.bySituationPersonnel?.[
                `${situationKey}::${personnelGroupKey}`
            ];

        if (combined && combined.totalCalls >= 6) {
            return {
                overall,
                bucket: combined,
                level: 'situationPersonnel'
            };
        }
    }

    if (prepPoints >= 9) {
        const personnel = overall.byPersonnel?.[personnelGroupKey];

        if (personnel && personnel.totalCalls >= 4) {
            return {
                overall,
                bucket: personnel,
                level: 'personnel'
            };
        }
    }

    if (prepPoints >= 6) {
        const situation = overall.bySituation?.[situationKey];

        if (situation && situation.totalCalls >= 4) {
            return {
                overall,
                bucket: situation,
                level: 'situation'
            };
        }
    }

    if (prepPoints >= 3 && overall.totalCalls >= 8) {
        return {
            overall,
            bucket: overall,
            level: 'broad'
        };
    }

    return null;
}

function getOffensiveArchetypeTendencyProfiles(bucket) {
    const profiles = Object.create(null);

    for (const [playKey, rawCount] of Object.entries(
        bucket?.byPlay || {}
    )) {
        const play = offensivePlaybook[playKey];
        const count = Number(rawCount);

        if (!play || !Number.isFinite(count) || count <= 0) {
            continue;
        }

        const knowledge = getOffensivePlayKnowledge(playKey, play);
        const archetype = knowledge?.archetype;

        if (!archetype) continue;

        if (!profiles[archetype]) {
            profiles[archetype] = {
                calls: 0,
                attacks: new Set(),
                vulnerableTo: new Set()
            };
        }

        const profile = profiles[archetype];

        profile.calls += count;

        for (const concept of knowledge.attacks || []) {
            profile.attacks.add(concept);
        }

        for (const concept of knowledge.vulnerableTo || []) {
            profile.vulnerableTo.add(concept);
        }
    }

    return profiles;
}

export function determineDefensivePlayCall(
    defense, offense, down, yardsToGo, ballOn, scoreDiff,
    gameLog, drivesRemaining, currentOffensivePlayKey = null
) {
    const defenseFormationName = defense.formations.defense;
    // 4 Standard Defensive Fundamentals (Always locked: Cover 2, Cover 1 Man, Man Blitz, Goal Line)
    const BACKYARD_BASICS_DEF = [
        'Cover_2_Zone_Base',
        'Cover_1_Robber',
        'Man_Blitz_Base',
        'GoalLine_RunStuff'
    ];

    const installedDef = (defense.gameplan?.installedDefense || []).slice(0, 8); // Max 8 custom schemes
    const activeDefKeys = Array.from(
        new Set([...BACKYARD_BASICS_DEF, ...installedDef])
    );

    const isGoalLine = ballOn >= 90;

    const isGoalLineSituation = ballOn >= 95 && yardsToGo <= 3;

    // Reserve goal-line calls for short-yardage situations near the end zone.
    const isEligibleOutsideGoalLine = key =>
        isGoalLineSituation || !/goal.?line/i.test(key);
    
        const validDefensiveFormationKeys = Object.keys(defenseFormations)
        .filter(key => key !== 'Punt_Return' && key !== 'Punt');

    const isEligibleDefensivePlay = key => {
        const play = defensivePlaybook[key];

        return Boolean(
            play &&
            !play.tags?.includes('specialTeams') &&
            isEligibleOutsideGoalLine(key)
        );
    };

    const canAlignInSomeFormation = key => {
        const play = defensivePlaybook[key];

        return Boolean(
            play &&
            validDefensiveFormationKeys.some(formationKey =>
                isPlayCompatibleWithDefense(play, formationKey)
            )
        );
    };

    // Prefer plays compatible with the defense's currently selected formation.
    let availablePlays = activeDefKeys.filter(key =>
        isEligibleDefensivePlay(key) &&
        isPlayCompatibleWithDefense(
            defensivePlaybook[key],
            defenseFormationName
        )
    );

    // If the current formation cannot run any active play, select only
    // an active-playbook call that can be aligned in another valid formation.
    if (availablePlays.length === 0) {
        availablePlays = activeDefKeys.filter(key =>
            isEligibleDefensivePlay(key) &&
            canAlignInSomeFormation(key)
        );
    }

    // Last-resort safety fallback: use a standard defensive fundamental.
    // Goal-line calls remain prohibited outside legal goal-line situations.
    if (availablePlays.length === 0) {
        const emergencyKey = BACKYARD_BASICS_DEF.find(key =>
            isEligibleDefensivePlay(key) &&
            canAlignInSomeFormation(key)
        );

        if (emergencyKey) {
            availablePlays = [emergencyKey];
        } else {
            const existingBasic = BACKYARD_BASICS_DEF.find(key =>
                isEligibleDefensivePlay(key)
            );

            if (existingBasic) return existingBasic;

            return Object.keys(defensivePlaybook).find(key =>
                isEligibleDefensivePlay(key) &&
                canAlignInSomeFormation(key)
            ) || 'Cover_2_Zone_Base';
        }
    }
    const isShort = yardsToGo <= 2;
    const isLong =
        (down === 3 && yardsToGo >= 8) ||
        (down === 4 && yardsToGo >= 5) ||
        (down === 2 && yardsToGo >= 10);

    const playcallSituation = getPlaycallSituationKey(
        down, yardsToGo, ballOn, scoreDiff, drivesRemaining
    );

    //const captainIsSharp = checkCaptainDiscipline(defense, gameLog);

    const staffPreparation = defense.gameplan?.staffPreparation;
    const preparationIsCurrent =
        staffPreparation?.preparedForYear === game?.year &&
        staffPreparation?.preparedForWeek === game?.currentWeek;

    const opponentPreparation = preparationIsCurrent
        ? staffPreparation.defenseByOpponent?.[String(offense.id)] ||
            staffPreparation.defenseByOpponent?.['*']
        : null;

    const defensivePrepPoints = Math.max(
        0,
        Math.min(
            12,
            Number.isFinite(opponentPreparation?.points)
                ? opponentPreparation.points
                : 0
        )
    );

    const defensivePrepByPlay = opponentPreparation?.byPlay &&
        typeof opponentPreparation.byPlay === 'object'
        ? opponentPreparation.byPlay
        : {};

    // ==========================================================
    // DEFENSIVE GAME-PLANNING (SCOUTING THE OPPONENT)
    // ==========================================================
    const offChart = offense.depthChart?.offense || {};
    const getOffWeaponOvr = (slot) => {
        const pid = offChart[slot];
        const p = pid ? getPlayer(pid) : null;
        return p ? calculateOverall(p, p.pos || estimateBestPosition(p)) : 0;
    };

    const oppQB = getOffWeaponOvr('QB1');
    const oppRB = getOffWeaponOvr('RB1');
    const oppWR1 = getOffWeaponOvr('WR1');

    // Determine the opponent's identity
    const isRunHeavyThreat = oppRB > 65 && (oppRB - oppQB > 10);
    const isPassHeavyThreat = oppQB > 65 && oppWR1 > 65 && (oppWR1 - oppRB > 10);

    const sit = defense.gameplan?.situational || { defenseAggressiveness: 50 };
    const aggro = (sit.defenseAggressiveness || 50) / 100; // 0.0 to 1.0

    const defensiveCoaches = Array.isArray(defense.coaches)
        ? defense.coaches.filter(coach => coach?.id != null)
        : [];

    const getDefensiveCoachSkill = coach => {
        const ratings = coach?.ratings || {};

        const values = [
            ratings.defSchemeMastery,
            ratings.gameplanInstinct,
            ratings.inGameAdjustments
        ].map(value => {
            const number = Number(value);
            return Number.isFinite(number)
                ? Math.max(0, Math.min(100, number))
                : 50;
        });

        return values.reduce((sum, value) => sum + value, 0) /
            values.length;
    };

    const defensivePrepHours = new Map();

    for (const assignment of defense.staffWorkPlan?.assignments || []) {
        if (
            assignment?.task !== 'defensePrep' ||
            assignment.coachId == null
        ) {
            continue;
        }

        const hours = getEffectiveStaffWorkHours(
            defense,
            assignment
        );

        if (!Number.isFinite(hours) || hours <= 0) continue;

        const coachId = String(assignment.coachId);

        defensivePrepHours.set(
            coachId,
            (defensivePrepHours.get(coachId) || 0) + hours
        );
    }

    const assignedDefensiveCoach = [...defensiveCoaches]
        .filter(coach =>
            (defensivePrepHours.get(String(coach.id)) || 0) > 0
        )
        .sort((a, b) => {
            const hourDifference =
                (defensivePrepHours.get(String(b.id)) || 0) -
                (defensivePrepHours.get(String(a.id)) || 0);

            return hourDifference ||
                getDefensiveCoachSkill(b) - getDefensiveCoachSkill(a);
        })[0];

    const defensiveCoach = assignedDefensiveCoach ||
        [...defensiveCoaches].sort(
            (a, b) =>
                getDefensiveCoachSkill(b) -
                getDefensiveCoachSkill(a)
        )[0] ||
        null;

    const defensiveCoachSkill = defensiveCoach
        ? getDefensiveCoachSkill(defensiveCoach)
        : 50;

    // A 50-rated coach has a neutral factor. The effect is bounded
    // so coaching quality influences decisions without dominating them.
    const defensiveDecisionFactor =
        0.75 + defensiveCoachSkill / 200;

    let scoredPlays = availablePlays.map(key => {
        const play = defensivePlaybook[key];
        const tags = play.tags || [];
        let score = 50;

        // Tactical knowledge: favor defensive calls suited to
        // the current situation and the available personnel.
        const playKnowledge = getDefensivePlayKnowledge(key, play);

        const knowledgeAdjustment = getPlaycallKnowledgeAdjustment(
            playKnowledge,
            defense,
            'defense',
            playcallSituation
        );

        // Keep knowledge useful without allowing it to dominate
        // coaching, preparation, or situational decisions.
        score += Math.max(
            -8,
            Math.min(8, Number(knowledgeAdjustment) || 0)
        );

                // Aggressiveness should favor pressure without making every blitz
        // outrank sound coverage. All-out calls incur a separate risk cost below.
        if (play.blitz) {
            score += (aggro - 0.5) * 28;
        }
        if (play.concept === 'Man') {
            score += (aggro - 0.5) * 12;
        }
        if (tags.includes('prevent') || tags.includes('safeZone')) {
            score -= (aggro - 0.5) * 30;
        }

        // Estimate how many defenders are committed to rushing.
        // Run-gap assignments count because those defenders can also
        // leave coverage responsibilities behind when the offense passes.
        const assignmentValues = Object.values(play.assignments || {})
            .map(assignment => String(assignment || '').toLowerCase());

        const rushCount = assignmentValues.filter(assignment =>
            /pass_rush|blitz|rush|run_gap/.test(assignment)
        ).length;

        const hasUnderneathMiddleHelp = assignmentValues.some(assignment =>
            /zone_short_middle|zone_hook_curl_middle|man_cover_y|man_cover_te\d*/.test(assignment)
        );

        const isLikelyPass = isPassHeavyThreat || isLong || yardsToGo >= 6;
        const extraRushers = Math.max(0, rushCount - 4);

        // Five or more rushers increase the risk of leaving receivers open.
        // Passing situations receive the strongest penalty; short-yardage
        // and goal-line situations retain some freedom to attack.
        if (play.blitz && extraRushers > 0) {
            const riskPenaltyPerRusher = isLikelyPass ? 24 : 18;
            const situationRelief = isGoalLineSituation
                ? 0.35
                : (isShort ? 0.65 : 1.0);

            score -= extraRushers * riskPenaltyPerRusher * situationRelief;
        }

        // A heavy rush without underneath help is especially vulnerable
        // to quick throws over the middle, including TE routes.
        if (play.blitz && rushCount >= 5 && !hasUnderneathMiddleHelp) {
            score -= isGoalLineSituation
                ? 5
                : (isLikelyPass ? 18 : 12);
        }

        // Opponent-specific adjustments scale with defensive coaching quality.
        if (isRunHeavyThreat && tags.includes('runStop')) {
            score += 15 * defensiveDecisionFactor;
        }

        if (
            isPassHeavyThreat &&
            (
                tags.includes('cover2') ||
                tags.includes('double-team') ||
                tags.includes('cover4')
            )
        ) {
            score += 15 * defensiveDecisionFactor;
        }

        // Staff preparation improves the chance of selecting a suitable call.
        // It does not directly alter player ratings or play physics.
        if (defensivePrepPoints > 0) {
            const preparedForRun =
                isRunHeavyThreat && tags.includes('runStop');

            const preparedForPass =
                isPassHeavyThreat &&
                (tags.includes('cover2') ||
                 tags.includes('double-team') ||
                 tags.includes('cover4'));

            const preparedForSituation =
                isGoalLineSituation && tags.includes('runStop') ||
                isShort && tags.includes('runStop') ||
                isLong &&
                    (tags.includes('cover3') ||
                     tags.includes('safeZone'));

            if (
                preparedForRun ||
                preparedForPass ||
                preparedForSituation
            ) {
                score += defensivePrepPoints * 0.6 * defensiveDecisionFactor;
            }
        }

        // TARGETED STAFF PREPARATION:
        // Reward defensive calls specifically prepared for this opponent.
        const targetedPrepPoints = Number(
            defensivePrepByPlay[key]
        );

        if (
            Number.isFinite(targetedPrepPoints) &&
            targetedPrepPoints > 0
        ) {
            score +=
                Math.min(4, targetedPrepPoints) *
                0.85 *
                defensiveDecisionFactor;
        }

        // FIELD POSITION SANITY CHECKS:
        // Do not call Goal Line defense at midfield, and do not call Prevent in the red zone
        if (!isGoalLine && tags.includes('runStop') && key.includes('GoalLine')) {
            score -= 80; // Heavy penalty outside the red zone
        }
        if (ballOn >= 80 && tags.includes('prevent')) {
            score -= 100; // Never call Prevent inside the 20-yard line
        }

        if (isGoalLineSituation) {
            if (tags.includes('runStop')) score += 35;
            if (tags.includes('blitz')) score += 12;
        } else if (isShort) {
            // Anticipate the run without treating it as a certainty.
            if (tags.includes('runStop')) score += 14;
            if (tags.includes('blitz')) score += 6;
        } else if (isLong) {
            if (tags.includes('prevent') && ballOn < 80) score += 25;
            if (tags.includes('cover3')) score += 15;
        }

        const tacticalKnowledge = getDefensivePlayKnowledge(key, play);

        score += getPlaycallKnowledgeAdjustment(
            tacticalKnowledge, defense, 'defense', playcallSituation
        );

        score += getOpponentMatchupAdjustment({
            team: defense,
            opponentId: offense?.id,
            observedSide: 'offense',
            situationKey: playcallSituation,
            personnelGroup: getPersonnelGroupKey(
                defenseFormationName, 'defense'
            ),
            candidateKnowledge: tacticalKnowledge,
            candidateSide: 'defense',
            prepPoints: defensivePrepPoints,
            coachSkill: defensiveCoachSkill
        });

        return { key, score: Math.max(1, score) };
    });

    scoredPlays.sort((a, b) => b.score - a.score);
    const topOptions = scoredPlays.slice(0, 5);
    const totalScore = topOptions.reduce((sum, p) => sum + p.score, 0);

    let roll = Math.random() * totalScore;
    let selectedKey = topOptions[0].key;

    for (const option of topOptions) {
        if (roll < option.score) {
            selectedKey = option.key;
            break;
        }
        roll -= option.score;
    }

    const observedOffenseKey = currentOffensivePlayKey ||
        offense.recentPlayHistory?.[
            offense.recentPlayHistory.length - 1
        ] || null;

    const observedOffenseFormation = observedOffenseKey
        ? getOffensiveFormationForPlay(offense, observedOffenseKey) ||
            offense.formations?.offense
        : offense.formations?.offense;

    /*// Update aggregate counters only after the calls are chosen.
    // The current offensive call never affects this defensive decision.
    recordPlaycallSnapshot(
        offense,
        defense,
        observedOffenseKey,
        selectedKey,
        playcallSituation,
        observedOffenseFormation,
        defenseFormationName
    );*/

    return selectedKey;
}

function shouldReleaseFleaFlickerPitch(rb, playState, tick) {
    if (!rb || !Number.isFinite(rb._handoffTick)) return false;

    const ticksSinceHandoff = tick - rb._handoffTick;

    // Give the RB a brief fake-run window before pitching back.
    if (ticksSinceHandoff < 15) return false; // Increased to 0.6 seconds so the RB actually hits the hole

    // Never let the fake run drag on until the RB is tackled.
    if (ticksSinceHandoff >= 22) return true;

    // If a free defender is closing, release the pitch early.
    return playState.activePlayers.some(defender => {
        if (
            defender.isOffense === rb.isOffense ||
            defender.stunnedTicks > 0 ||
            defender.isBlocked ||
            defender.isEngaged
        ) {
            return false;
        }

        return getDistance(defender, rb) <= 3.5;
    });
}

function incrementPlaycallAggregateCount(
    bucket,
    playKey,
    situationKey,
    personnelGroupKey
) {
    if (!bucket || !playKey) return;

    const incrementCount = (counts, key) => {
        if (!key) return;

        counts[key] = (Number(counts[key]) || 0) + 1;
    };

    const incrementGroupedCount = (groups, groupKey) => {
        if (!groupKey) return;

        if (!groups[groupKey]) {
            groups[groupKey] = {
                totalCalls: 0,
                byPlay: {}
            };
        }

        const group = groups[groupKey];

        group.totalCalls = (Number(group.totalCalls) || 0) + 1;
        incrementCount(group.byPlay, playKey);
    };

    bucket.totalCalls = (Number(bucket.totalCalls) || 0) + 1;

    bucket.byPlay ||= {};
    bucket.bySituation ||= {};
    bucket.byPersonnel ||= {};
    bucket.bySituationPersonnel ||= {};

    incrementCount(bucket.byPlay, playKey);

    incrementGroupedCount(
        bucket.bySituation,
        situationKey
    );

    incrementGroupedCount(
        bucket.byPersonnel,
        personnelGroupKey
    );

    incrementGroupedCount(
        bucket.bySituationPersonnel,
        `${situationKey}::${personnelGroupKey}`
    );
}

function recordPlaycallAggregateSnapshot(
    team,
    perspective,
    calledSide,
    playKey,
    situationKey,
    personnelGroupKey,
    opponentId = null
) {
    if (
        !team ||
        !playKey ||
        !situationKey ||
        !personnelGroupKey
    ) {
        return;
    }

    if (
        !team.playcallTendencies ||
        typeof team.playcallTendencies !== 'object'
    ) {
        team.playcallTendencies = {
            version: 1,
            own: {},
            opponents: {}
        };
    }

    const tendencies = team.playcallTendencies;

    // Tendencies are season-specific. Do not let outdated scouting
    // data carry forward after teams and personnel have changed.
    const currentSeason =
        game?.year != null && Number.isFinite(Number(game.year))
            ? Number(game.year)
            : null;

    if (
        !tendencies.snapCounts ||
        (
            currentSeason !== null &&
            tendencies.snapCounts.season !== currentSeason
        )
    ) {
        tendencies.snapCounts = {
            version: 1,
            season: currentSeason,
            own: {},
            opponents: {}
        };
    }

    let bucket;

    if (perspective === 'opponent') {
        if (opponentId == null) return;

        const opponentKey = String(opponentId);

        tendencies.snapCounts.opponents[opponentKey] ||= {};

        const opponentCounts =
            tendencies.snapCounts.opponents[opponentKey];

        opponentCounts[calledSide] ||= {};
        bucket = opponentCounts[calledSide];
    } else {
        tendencies.snapCounts.own[calledSide] ||= {};
        bucket = tendencies.snapCounts.own[calledSide];
    }

    incrementPlaycallAggregateCount(
        bucket,
        playKey,
        situationKey,
        personnelGroupKey
    );
}

export function resolvePlay(offense, defense, offensivePlayKey, defensivePlayKey, context, options, isLive = false) {
    const { gameLog = [], ballOn, ballHash = 'M', down, yardsToGo, offenseScore = 0, defenseScore = 0, timeRemaining = 420, quarter = 1, isConversionAttempt = false } = context;
    const scoreDiff = offenseScore - defenseScore;

    const playResult = {
        yards: 0, outcome: 'live', possessionChange: false,
        score: null, safety: false, touchback: false, turnoverType: null
    };

    if (!offensivePlaybook || !offensivePlaybook[offensivePlayKey]) {
        playResult.outcome = 'turnover';
        playResult.possessionChange = true;
        return { playResult, finalBallY: ballOn, log: gameLog, visualizationFrames: [] };
    }

        const audibleCheck = aiCheckAudible(
        offense,
        offensivePlayKey,
        defense,
        defensivePlayKey,
        gameLog
    );

    let finalOffensivePlayKey = audibleCheck.didAudible
        ? audibleCheck.playKey
        : offensivePlayKey;

    // An audible may change the play, but it must not silently change
    // the formation after the offense has lined up.
    if (audibleCheck.didAudible) {
        const currentOffenseFormation =
            offense.formations?.offense || 'Balanced';

        const audibleFormation = getOffensiveFormationForPlay(
            offense,
            finalOffensivePlayKey
        );

        if (audibleFormation !== currentOffenseFormation) {
            if (gameLog) {
                gameLog.push(
                    `[Audible]: Formation mismatch prevented ` +
                    `${offensivePlayKey} -> ${finalOffensivePlayKey}; ` +
                    `keeping the original call.`
                );
            }

            finalOffensivePlayKey = offensivePlayKey;
        }
    }

    const play = JSON.parse(
        JSON.stringify(offensivePlaybook[finalOffensivePlayKey])
    );

    // Snapshot the actual calls at the snap, including any completed audible.
    const tendencySituation = getPlaycallSituationKey(
        down,
        yardsToGo,
        ballOn,
        scoreDiff,
        context.drivesRemaining
    );

    const offensePersonnelGroup = getPersonnelGroupKey(
        offense.formations?.offense || 'Balanced',
        'offense'
    );

    const defensePersonnelGroup = getPersonnelGroupKey(
        defense.formations?.defense || '3-2-3',
        'defense'
    );

    // Offense records its own call.
    recordPlaycallAggregateSnapshot(
        offense,
        'own',
        'offense',
        finalOffensivePlayKey,
        tendencySituation,
        offensePersonnelGroup
    );

    // Defense records what it observed the offense call.
    recordPlaycallAggregateSnapshot(
        defense,
        'opponent',
        'offense',
        finalOffensivePlayKey,
        tendencySituation,
        offensePersonnelGroup,
        offense.id
    );

    // Defense records its own call.
    recordPlaycallAggregateSnapshot(
        defense,
        'own',
        'defense',
        defensivePlayKey,
        tendencySituation,
        defensePersonnelGroup
    );

    // Offense records what it observed the defense call.
    recordPlaycallAggregateSnapshot(
        offense,
        'opponent',
        'defense',
        defensivePlayKey,
        tendencySituation,
        defensePersonnelGroup,
        defense.id
    );

    let playState = {
        playIsLive: true, tick: 0,
        visualizationFrames: isLive ? [] : null,
        maxTicks: 1000,
        type: play.type,
        isRPO: play.tags?.includes('rpo') || false,
        rpoPhase: play.tags?.includes('rpo') ? 'mesh' : null,
        assignments: JSON.parse(JSON.stringify(play.assignments || {})),
        yards: 0, touchdown: false, turnover: false, incomplete: false,
        sack: false, safety: false, touchback: false,
        finalBallY: 0, returnStartY: null,
        possessionChanged: false, fumbleOccurred: false, interceptionOccurred: false,
        statEvents: [],
        ballState: { x: 0, y: 0, z: 1.0, vx: 0, vy: 0, vz: 0, inAir: false, isLoose: false, targetPlayerId: null },
        offenseScore, defenseScore, quarter,
        down,
        yardsToGo,
        lineOfScrimmage: ballOn + 10,
        timeRemaining,
        activePlayers: [],
        blockBattles: [],
        resolvedDepth: null
    };

    //initPlayTelemetry(context, playState, finalOffensivePlayKey, defensivePlayKey);

    try {
        setupInitialPlayerStates(
            playState,
            offense,
            defense,
            play,
            playState.assignments,
            ballOn,
            defensivePlayKey,
            ballHash,
            finalOffensivePlayKey
        );

        // Don't learn from plays that never reach player setup,
        // or from special-teams snaps.
        const defensivePlay = defensivePlaybook[defensivePlayKey];

        const isSpecialTeamsSnap =
            play.type === 'punt' ||
            play.tags?.includes('specialTeams') ||
            defensivePlayKey === 'Punt_Return' ||
            defensivePlay?.tags?.includes('specialTeams');

        if (
            !isSpecialTeamsSnap &&
            defensivePlay &&
            typeof recordPlaycallAggregateSnapshot === 'function'
        ) {
            const offenseSituation = getPlaycallSituationKey(
                down,
                yardsToGo,
                ballOn,
                scoreDiff,
                context.drivesRemaining
            );

            // Reverse the score differential for the defense's perspective.
            const defenseSituation = getPlaycallSituationKey(
                down,
                yardsToGo,
                ballOn,
                -scoreDiff,
                context.drivesRemaining
            );

            const offensePersonnelGroup = getPersonnelGroupKey(
                offense.formations?.offense || 'Balanced',
                'offense'
            );

            const defensePersonnelGroup = getPersonnelGroupKey(
                defense.formations?.defense || '3-2-3',
                'defense'
            );

            // Offense's own call.
            recordPlaycallAggregateSnapshot(
                offense,
                'own',
                'offense',
                finalOffensivePlayKey,
                offenseSituation,
                offensePersonnelGroup
            );

            // Defense observes the offense's call.
            recordPlaycallAggregateSnapshot(
                defense,
                'opponent',
                'offense',
                finalOffensivePlayKey,
                offenseSituation,
                offensePersonnelGroup,
                offense.id
            );

            // Defense's own call.
            recordPlaycallAggregateSnapshot(
                defense,
                'own',
                'defense',
                defensivePlayKey,
                defenseSituation,
                defensePersonnelGroup
            );

            // Offense observes the defense's call.
            recordPlaycallAggregateSnapshot(
                offense,
                'opponent',
                'defense',
                defensivePlayKey,
                defenseSituation,
                defensePersonnelGroup,
                defense.id
            );
        }

        initPlayTelemetry(context, playState, finalOffensivePlayKey, defensivePlayKey);
        // Record the actual starting state AFTER player setup.
        logPlayDebug(
            'PLAY_START',
            'Play setup complete; simulation ready',
            {
                type: playState.type,
                lineOfScrimmage: playState.lineOfScrimmage,

                ball: {
                    x: playState.ballState?.x ?? null,
                    y: playState.ballState?.y ?? null,
                    z: playState.ballState?.z ?? null,
                    inAir: playState.ballState?.inAir ?? null
                },

                flaggedCarriers: playState.activePlayers
                    .filter(p => p.hasBall || p.isBallCarrier)
                    .map(p => ({
                        id: p.id,
                        name: p.name,
                        slot: p.slot,
                        x: p.x,
                        y: p.y,
                        isOffense: p.isOffense,
                        hasBall: p.hasBall,
                        isBallCarrier: p.isBallCarrier
                    }))
            },
            playState.tick
        );

        if (isLive && gameLog) {
            playState.visualizationFrames.push(
                captureFrame(playState, gameLog)
            );
        }
    } catch (setupError) {
        playResult.outcome = 'turnover';
        playResult.possessionChange = true;

        logPlayDebug(
            'PLAY_SETUP_ERROR',
            'Player setup failed; simulation did not start',
            {
                message: setupError?.message ?? String(setupError)
            },
            playState.tick
        );

        finalizePlayTelemetry(playResult, ballOn, playState);

        return {
            playResult,
            finalBallY: ballOn,
            log: gameLog,
            visualizationFrames: []
        };
    }

    let ballCarrierState = null;

    try {
        const timeDelta = TICK_DURATION_SECONDS;
        const loopType = playState.type || 'pass';

        const activeOffense = playState.activePlayers.filter(p => p.isOffense);
        const activeDefense = playState.activePlayers.filter(p => !p.isOffense);
        const qb1 = playState.activePlayers.find(p => p.slot === 'QB1');
        const defaultRb = playState.activePlayers.find(p => p.slot === 'RB1');

        while (playState.playIsLive && playState.tick < playState.maxTicks) {
            playState.tick++;
            window.__CURRENT_TICK__ = playState.tick;

            playState.activePlayers.forEach(p => {
                if (p.stunnedTicks > 0) p.stunnedTicks--;
                if (p.ghostTicks > 0) p.ghostTicks--;
                if (p.jamTicks > 0) p.jamTicks--;
                if (p.moveCooldown > 0) p.moveCooldown--;
            });

            const ballPos = playState.ballState;
            ballCarrierState = playState.activePlayers.find(p => p.hasBall || p.isBallCarrier) || null;

            if (ballCarrierState) {
                for (let i = 0; i < playState.activePlayers.length; i++) {
                    const p = playState.activePlayers[i];
                    if (p.isOffense !== ballCarrierState.isOffense) {
                        const dx = p.x - ballCarrierState.x;
                        const dy = p.y - ballCarrierState.y;
                        p._distToCarrier = Math.sqrt(dx * dx + dy * dy);
                    }
                }
            }

            if (playState.playIsLive && !ballPos.inAir && !ballPos.isLoose && !playState.turnover && !playState.sack) {
                if (playState.type === 'pass') {
                    const isFleaFlicker =
                        playState.playKey === 'Trick_Flea_Flicker';

                    // Play-action keys can begin with a formation prefix,
                    // such as Power_PA_PowerPass_Slide.
                    const isPlayAction =
                        playState.playKey?.startsWith('PA_') ||
                        playState.playKey?.includes('_PA_');

                    const isBootleg = /boot|rollout/i.test(playState.playKey || '');

                    const playActionReady = !isPlayAction
                        ? true
                        : isBootleg
                            ? (qb1?._bootlegRolloutReady === true || playState.tick >= 25)
                            : qb1?.hasCompletedDropback === true;

                    const mayProcessQBDecision =
                        (!isFleaFlicker ||
                            playState.fleaFlickerPhase === 'qb_pass') &&
                        playActionReady;

                    if (mayProcessQBDecision) {
                        updateQBDecision(
                            qb1,
                            activeOffense,
                            activeDefense,
                            playState,
                            playState.assignments,
                            gameLog
                        );
                    }
                } else if (
                    loopType === 'punt' &&
                    playState.returnStartY === null &&
                    !playState.possessionChanged
                ) {
                    updateThrowoffDecision(playState, activeOffense, gameLog);
                }
            }

            if (!playState.playIsLive) break;

            // CRITICAL FIX: Refresh ballPos reference in case the QB just threw the ball and created a new object
            const currentBall = playState.ballState;

            if (playState.handoffRequired && !playState.handoffOccurred) {
                const handoffTarget = playState.activePlayers.find(p => p.slot === playState.handoffTargetSlot) || rb1;
                if (qb1 && handoffTarget) {
                    const qbDepth = playState.lineOfScrimmage - qb1.initialY;
                    const dist = getDistance(qb1, handoffTarget);
                    const isTossPlay = handoffTarget.assignment?.includes('toss');
                    const isJetSweep = playState.playKey?.includes('Jet') || handoffTarget.slot?.startsWith('WR');

                    const handoffDistThreshold = isTossPlay ? 4.5 : (isJetSweep ? 3.0 : 1.8);
                    const handoffTickThreshold = isTossPlay
                        ? 24
                        : (isJetSweep ? 18 : (qbDepth < 4.0 ? 16 : 22));

                    const minExchangeTick = isTossPlay ? 14 : (isJetSweep ? 10 : 8);

                    if ((dist < handoffDistThreshold && playState.tick >= minExchangeTick) || (playState.tick >= handoffTickThreshold)) {
                        if (isTossPlay) {
                            // Ordinary toss plays use the airborne lateral.
                            if (initiateLateralToss(
                                playState,
                                qb1,
                                handoffTarget,
                                'run_toss'
                            )) {
                                qb1.ghostTicks = 10;
                            }
                        } else {
                            qb1.hasBall = false;
                            qb1.isBallCarrier = false;

                            handoffTarget.hasBall = true;
                            handoffTarget.isBallCarrier = true;

                            playState.handoffOccurred = true;
                            playState.handoffRequired = false;
                            handoffTarget._handoffTick = playState.tick;

                            qb1.ghostTicks = 30;
                            handoffTarget.ghostTicks = 30;
                            handoffTarget.action = 'run_path';
                            qb1.action = 'idle';

                            if (playState.playKey === 'Trick_Flea_Flicker') {
                                playState.fleaFlickerPhase = 'rb_fake_run';
                            }
                        }
                    } else {
                        // QB steps to mesh point
                        if (isJetSweep) {
                            // On Jet Sweeps, QB steps up toward LOS to hand off/pop as the receiver crosses
                            qb1.targetX = qb1.initialX;
                            qb1.targetY = playState.lineOfScrimmage - 3.2;

                            // Runner maintains their full-speed sweep trajectory across the formation
                            const pt = handoffTarget.routePath?.[handoffTarget.currentPathIndex];
                            
                            if (pt) {
                                handoffTarget.targetX = pt.x;
                                handoffTarget.targetY = pt.y;
                            } else {
                                // Dynamically sweep away from their starting side
                                const sweepDir = handoffTarget.initialX > qb1.initialX ? -1 : 1;
                                handoffTarget.targetX = handoffTarget.x + (sweepDir * 5);
                                handoffTarget.targetY = handoffTarget.y;
                            }
                            
                        handoffTarget.action = 'run_path';
                        } else if (isTossPlay) {
                            qb1.targetX = qb1.initialX + (handoffTarget.initialX > qb1.initialX ? 0.8 : -0.8);
                            qb1.targetY = qbDepth < 4.0 ? (playState.lineOfScrimmage - 4.2) : (qb1.initialY + 0.8);

                            const pt = handoffTarget.routePath?.[handoffTarget.currentPathIndex] || { x: handoffTarget.x + (handoffTarget.assignment.includes('r') ? 5 : -5), y: handoffTarget.y + 0.5 };
                            handoffTarget.targetX = pt.x;
                            handoffTarget.targetY = pt.y;
                            handoffTarget.action = 'run_path';
                        } else {
                            qb1.targetX = qb1.initialX + (handoffTarget.initialX > qb1.initialX ? 0.8 : -0.8);
                            qb1.targetY = qbDepth < 4.0 ? (playState.lineOfScrimmage - 4.2) : (qb1.initialY + 0.8);

                            // On inside handoffs, RB approaches mesh point smoothly without snapping
                            handoffTarget.action = 'handoff_receive';
                            handoffTarget.targetX = qb1.targetX + (handoffTarget.initialX > qb1.initialX ? 0.6 : -0.6);
                            handoffTarget.targetY = qb1.targetY;
                        }
                    }
                }
            } else if (playState.isRPO && playState.rpoPhase === 'mesh' && qb1 && rb1) {
                const qbDepth = playState.lineOfScrimmage - qb1.initialY;
                qb1.targetX = qb1.initialX + (rb1.initialX > qb1.initialX ? 0.8 : -0.8);
                qb1.targetY = qbDepth < 4.0 ? (playState.lineOfScrimmage - 4.2) : (qb1.initialY + 0.8);

                rb1.action = 'handoff_receive';
                rb1.targetX = qb1.targetX + (rb1.initialX > qb1.initialX ? 0.6 : -0.6);
                rb1.targetY = qb1.targetY;

                // Mesh read window: read conflict defender between ticks 12 and 16
                if (playState.tick >= 14) {
                    const readSlot = playState.readProgression?.[0] || 'X';
                    const readReceiver = activeOffense.find(o => o.slot === readSlot || o.role === readSlot);
                    const conflictSideX = readReceiver ? readReceiver.initialX : qb1.x;

                    const conflictDefender = activeDefense
                        .filter(d => !d.isBlocked && d.role !== 'DL' && d.y > playState.lineOfScrimmage)
                        .sort((a, b) => Math.abs(a.x - conflictSideX) - Math.abs(b.x - conflictSideX))[0];

                    const defenderActuallyBites = conflictDefender && (
                        conflictDefender._diagnosedGuess === 'run' ||
                        (conflictDefender.vy || 0) < -0.2 ||
                        conflictDefender.y < playState.lineOfScrimmage + 2.5
                    );

                    // QB IQ & Instinct: High-IQ QBs read the defender true; low-IQ QBs can misread the crash
                    const qbIQ = qb1.playbookIQ || qb1.iq || 50;
                    const misreadChance = Math.max(0.04, 0.45 - (qbIQ * 0.005)); // 40 IQ = 25% misread; 85+ IQ = 4% misread
                    const qbPerceivesBite = Math.random() < misreadChance 
                        ? !defenderActuallyBites 
                        : defenderActuallyBites;

                    if (qbPerceivesBite) {
                        playState.rpoPhase = 'pass';
                        qb1.action = 'qb_setup';
                        qb1.hasCompletedDropback = true;
                        rb1.action = 'run_fake';
                        playState.handoffOccurred = true;

                        const readLog = !defenderActuallyBites ? " (misread!)" : "";
                        if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] ⚡ RPO: ${qb1.name} reads the defender${readLog}, pulls the ball, and looks to throw!`, playState);
                        logPlayDebug('RPO_DECISION', `${qb1.name} pulled the ball on RPO`, { read: 'pull_pass', defender: conflictDefender?.name, wasCorrect: defenderActuallyBites });
                    } else {
                        playState.rpoPhase = 'give';
                        playState.type = 'run';
                        qb1.hasBall = false;
                        qb1.isBallCarrier = false;
                        qb1.action = 'idle';
                        qb1.ghostTicks = 20;

                        rb1.hasBall = true;
                        rb1.isBallCarrier = true;
                        rb1.action = 'run_path';
                        rb1._handoffTick = playState.tick;
                        playState.handoffOccurred = true;

                        const readLog = defenderActuallyBites ? " (misread!)" : "";
                        if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] 🏈 RPO: ${qb1.name} hands off inside to ${rb1.name}${readLog}!`, playState);
                        logPlayDebug('RPO_DECISION', `${qb1.name} gave to RB on RPO`, { read: 'give_run', defender: conflictDefender?.name, wasCorrect: !defenderActuallyBites });
                    }
                }
            }

            // The RB has finished the flea-flicker fake run.
            // Pitch the ball backward to the quarterback.
            if (
                playState.playKey === 'Trick_Flea_Flicker' &&
                playState.fleaFlickerPhase === 'rb_fake_run' &&
                rb1?.hasBall &&
                (
                    (
                        rb1.routePath?.length &&
                        rb1.currentPathIndex >= rb1.routePath.length
                    ) ||
                    shouldReleaseFleaFlickerPitch(
                        rb1,
                        playState,
                        playState.tick
                    )
                )
            ) {
                initiateLateralToss(
                    playState,
                    rb1,
                    qb1,
                    'flea_return'
                );
            }

            // Refresh possession after any throw, handoff, or lateral this tick.
            ballCarrierState = playState.activePlayers.find(
                p => p.hasBall || p.isBallCarrier
            ) || null;

            updatePlayerTargets(
                playState, activeOffense, activeDefense, ballCarrierState,
                loopType, finalOffensivePlayKey, playState.assignments, defensivePlayKey, gameLog
            );

            playState.activePlayers.forEach(p => {
                try {
                    updatePlayerPosition(p, timeDelta, playState.activePlayers);
                } catch (e) {
                    if (!p._physicsErrorLogged) {
                        p._physicsErrorLogged = true;

                        console.error(
                            `[Physics Error] Tick ${playState.tick}: ${p.name} (${p.slot})`,
                            e
                        );
                    }
                }
            });
            if (currentBall.inAir || currentBall.isLoose) {
                currentBall.prevX = currentBall.x;
                currentBall.prevY = currentBall.y;
                currentBall.prevZ = currentBall.z;

                currentBall.x += (currentBall.vx || 0) * timeDelta;
                currentBall.y += (currentBall.vy || 0) * timeDelta;
                currentBall.z += (currentBall.vz || 0) * timeDelta;
                currentBall.vz = (currentBall.vz || 0) - 9.8 * timeDelta;

                currentBall.x = Math.max(-10.0, Math.min(FIELD_WIDTH + 10.0, currentBall.x));
                currentBall.y = Math.max(-10.0, Math.min(FIELD_LENGTH + 10.0, currentBall.y));

                handleBallArrival(playState, ballCarrierState, playResult, gameLog);

                if (currentBall.z < 0) {
                    currentBall.z = 0;
                    if (currentBall.vz <= 0) {
                        currentBall.vz = 0;
                        if (currentBall.inAir) {
                            currentBall.inAir = false;
                            if (playState.type === 'punt') currentBall.isLoose = true;
                        }
                    }
                }
            } else if (ballCarrierState) {
                currentBall.x = ballCarrierState.x;
                currentBall.y = ballCarrierState.y;
                currentBall.z = 0.5;
                currentBall.x = Math.max(0.5, Math.min(FIELD_WIDTH - 0.5, currentBall.x));
                currentBall.y = Math.max(0.0, Math.min(FIELD_LENGTH, currentBall.y));
            }

            resolvePlayerCollisions(playState);

            if (playState.playIsLive) {
                ballCarrierState = playState.activePlayers.find(p => p.hasBall || p.isBallCarrier);

                if (ballCarrierState) {
                    if (ballCarrierState.isOffense && ballCarrierState.y >= 110.0) {
                        playState.touchdown = true;
                        playState.playIsLive = false;
                        ballCarrierState.y = 110.0;

                        // Sync the ball to the scoring carrier at the goal line.
                        playState.ballState.x = ballCarrierState.x;
                        playState.ballState.y = 110.0;
                        playState.ballState.z = 0.5;
                        playState.ballState.vx = 0;
                        playState.ballState.vy = 0;
                        playState.ballState.vz = 0;
                        playState.ballState.inAir = false;
                        playState.ballState.isLoose = false;

                        playState.finalBallY = 110.0;
                        playState.yards = 110.0 - playState.lineOfScrimmage;
                        if (!isConversionAttempt) {
                            if (gameLog) gameLog.push(`🎉 TOUCHDOWN ${ballCarrierState.name}!`);
                            playState.statEvents.push({ type: 'touchdown', playerId: ballCarrierState.id });

                            if (playState.type === 'pass' && !playState.fumbleOccurred) {
                                playState.statEvents.push({ type: 'pass_td', qbId: playState.ballState.throwerId });
                            }
                        }
                        break;
                    }
                    if (
                        ballCarrierState &&
                        (ballCarrierState.hasBall || ballCarrierState.isBallCarrier) &&
                        !ballCarrierState.isOffense &&
                        ballCarrierState.y <= 10.0
                    ) {
                        if (playState.type === 'punt') {
                            logPlayDebug(
                                'PUNT_TD_DIAGNOSTIC',
                                'Defensive player reached the scoring check',
                                {
                                    detectedCarrier: {
                                        id: ballCarrierState.id,
                                        name: ballCarrierState.name,
                                        slot: ballCarrierState.slot,
                                        role: ballCarrierState.role,
                                        isOffense: ballCarrierState.isOffense,
                                        x: ballCarrierState.x,
                                        y: ballCarrierState.y,
                                        hasBall: ballCarrierState.hasBall,
                                        isBallCarrier: ballCarrierState.isBallCarrier
                                    },

                                    returnStartY: playState.returnStartY ?? null,
                                    lineOfScrimmage: playState.lineOfScrimmage,

                                    ball: {
                                        x: playState.ballState.x,
                                        y: playState.ballState.y,
                                        z: playState.ballState.z,
                                        inAir: playState.ballState.inAir,
                                        isLoose: playState.ballState.isLoose,
                                        targetY: playState.ballState.targetY ?? null
                                    },

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
                        }
                        // Reaching y <= 10 is reaching the returner's
                        // scoring end zone. Punt touchbacks are handled
                        // at catch resolution in collisions.js.

                        playState.touchdown = true;
                        playState.defensiveTD = true;
                        playState.playIsLive = false;
                        playState.possessionChanged = true;
                        playState.finalBallY = 10.0;

                        if (gameLog) gameLog.push(`🎉 DEFENSIVE TOUCHDOWN!`);
                        break;
                    }
                    if ((ballCarrierState.isOffense && ballCarrierState.y <= 0) || (!ballCarrierState.isOffense && ballCarrierState.y >= 120.0)) {
                        playState.safety = true;
                        playState.playIsLive = false;
                        playState.finalBallY = ballCarrierState.isOffense ? 0 : 120;
                        if (gameLog) gameLog.push(`🚨 SAFETY! ${ballCarrierState.name} ran out of the endzone!`);
                        break;
                    }
                    if (ballCarrierState.x <= 0.8 || ballCarrierState.x >= 52.5) {
                        playState.playIsLive = false;
                        playState.yards = ballCarrierState.y - playState.lineOfScrimmage;
                        playState.finalBallY = ballCarrierState.y;
                        playState.outOfBounds = true;
                        if (gameLog) gameLog.push(`💨 ${ballCarrierState.name} steps out of bounds.`);
                        if (ballCarrierState.role === 'QB' && playState.yards < 0 && playState.type === 'pass') {
                            playState.sack = true;
                        }
                        break;
                    }
                }

                const ball = playState.ballState;
                const isBallOutOfBounds = ball.x <= 0 || ball.x >= FIELD_WIDTH || ball.y <= 0 || ball.y >= FIELD_LENGTH;
                if (isBallOutOfBounds && (ball.isLoose || (playState.type === 'punt' && !ballCarrierState))) {
                    playState.playIsLive = false;
                    playState.outOfBounds = true;

                    const wentOutSideline = ball.x <= 0 || ball.x >= FIELD_WIDTH;

                    if (wentOutSideline) {
                        playState.finalBallY = ball.y;
                    } else {
                        if (ball.y >= FIELD_LENGTH) {
                            if (playState.type === 'punt') {
                                // Match the existing punt-catch touchback spot:
                                // 110 - 90 = receiving team's 20-yard line.
                                playState.finalBallY = 90;
                            } else {
                                playState.finalBallY = 110;
                            }

                            playState.touchback = true;

                            if (ball.isLoose && !playState.possessionChanged && playState.type !== 'punt') {
                                playState.possessionChanged = true;
                                playState.turnover = true;
                            }
                        } else if (ball.y <= 10) {
                            playState.safety = true;
                            playState.finalBallY = 0;
                        }
                    }

                    // The play is dead. Keep the final physical ball state
                    // consistent with the terminal result and telemetry.
                    ball.z = 0;
                    ball.vx = 0;
                    ball.vy = 0;
                    ball.vz = 0;
                    ball.inAir = false;
                    ball.isLoose = false;

                    break;
                }
            }

            if (playState.playIsLive) {
                checkBlockCollisions(playState, gameLog);
                resolveOngoingBlocks(playState, gameLog, activeOffense, activeDefense);

                if (ballCarrierState && checkTackleCollisions(playState, gameLog)) {
                    if (!playState.touchback && !playState.safety) {
                        playState.finalBallY = ballCarrierState.y;
                        playState.yards = ballCarrierState.y - playState.lineOfScrimmage;
                    }
                    playState.playIsLive = false;
                    break;
                }

                if (playState.ballState?.isLoose) {
                    const recovery = checkFumbleRecovery(playState, gameLog, 3.0);
                    if (recovery) {
                        const recPlayer = recovery.playerState;
                        const ball = playState.ballState;

                        // End loose-ball physics and synchronize the ball
                        // with the player who recovered it.
                        ball.isLoose = false;
                        ball.inAir = false;
                        ball.isLateral = false;
                        ball.lateralPurpose = null;
                        ball.vx = 0;
                        ball.vy = 0;
                        ball.vz = 0;
                        ball.x = recPlayer.x;
                        ball.y = recPlayer.y;
                        ball.z = 0.5;
                        ball.targetPlayerId = null;
                        ball.targetX = null;
                        ball.targetY = null;

                        recPlayer.hasBall = true;
                        recPlayer.isBallCarrier = true;
                        recPlayer.action = 'run_path';

                        ballCarrierState = recPlayer;
                        playState.possessionChanged = recovery.possessionChange;
                        playState.returnStartY = recPlayer.y;

                        logPlayDebug(
                            'FUMBLE_RECOVERY',
                            `${recPlayer.name} recovered the loose ball`,
                            {
                                playerId: recPlayer.id,
                                playerName: recPlayer.name,
                                isOffense: recPlayer.isOffense,
                                possessionChanged: recovery.possessionChange,
                                recoverySpot: {
                                    x: recPlayer.x,
                                    y: recPlayer.y
                                },
                                ballVelocity: {
                                    vx: ball.vx,
                                    vy: ball.vy,
                                    vz: ball.vz
                                }
                            },
                            playState.tick
                        );

                        if (gameLog) gameLog.push(`🏈 ${recPlayer.name} recovers!`);
                        playState.statEvents.push({
                            type: 'fumble_recovery',
                            playerId: recPlayer.id
                        });
                    }
                }
            }

            playState.activePlayers.forEach(p => {
                const player = getPlayer(p.id);
                if (player) {
                    const team = game?.teams?.find(t => t.id === player.teamId);
                    const trainerConditioning = team?.staff?.trainer?.ratings?.conditioning || 50;
                    const conditioningMod = Math.max(0.75, 1.25 - (trainerConditioning / 100)); // Good trainer cuts fatigue accumulation

                    const stamina = player.attributes?.physical?.stamina || 50;
                    const effortMultiplier = (p.action.includes('run') || p.action.includes('rush') || p.action === 'pursuit' || p.action.includes('route')) ? 1.0 : 0.4;
                    const staminaFactor = (150 - stamina) / 100;
                    const drain = 0.03 * effortMultiplier * staminaFactor * conditioningMod;
                    player.fatigue = Math.min(100, (player.fatigue || 0) + drain);
                    p.fatigueModifier = Math.max(0.70, 1.0 - (player.fatigue / 100) * 0.30);
                }
            });

            if (isLive && gameLog) {
                playState.visualizationFrames.push(captureFrame(playState, gameLog));
            }
        }
     } catch (e) {
        logPlayDebug(
            'PLAY_SIMULATION_ERROR',
            'Simulation loop crashed',
            {
                message: e?.message ?? String(e),
                name: e?.name ?? 'Error',
                tick: playState.tick,
                playType: playState.type,
                playIsLive: playState.playIsLive
            },
            playState.tick
        );

        console.error("Simulation Loop Crash:", e);
    }

    

    // Reconcile the final spot from the actual carrier after the loop ends.
    if (!playState.playIsLive) {
        const terminalCarrier = playState.activePlayers.find(
            p => p.hasBall || p.isBallCarrier
        ) || null;

        if (
            terminalCarrier &&
            !playState.touchdown &&
            !playState.safety &&
            !playState.touchback
        ) {
            ballCarrierState = terminalCarrier;
            playState.finalBallY = terminalCarrier.y;

            if (
                !playState.possessionChanged &&
                !playState.turnover &&
                !playState.fumbleOccurred &&
                !playState.interceptionOccurred
            ) {
                playState.yards =
                    terminalCarrier.y - playState.lineOfScrimmage;
            }

            // Synchronize the physical ball with its terminal carrier.
            const terminalBall = playState.ballState;

            if (terminalBall) {
                terminalBall.x = terminalCarrier.x;
                terminalBall.y = terminalCarrier.y;
                terminalBall.z = 0.5;

                terminalBall.vx = 0;
                terminalBall.vy = 0;
                terminalBall.vz = 0;

                terminalBall.inAir = false;
                terminalBall.isLoose = false;
            }
        } else if (playState.type === 'punt' && playState.ballState) {
            // Dead punts must not retain airborne or moving physics.
            const terminalBall = playState.ballState;

            terminalBall.y = playState.finalBallY;
            terminalBall.z = 0;

            terminalBall.vx = 0;
            terminalBall.vy = 0;
            terminalBall.vz = 0;

            terminalBall.inAir = false;
            terminalBall.isLoose = false;
        }
    }

    if (playState.returnStartY !== null && ballCarrierState) {
        const returnYards = Math.abs(ballCarrierState.y - playState.returnStartY);
        if (returnYards > 0) {
            playState.statEvents.push({ type: 'return', playerId: ballCarrierState.id, yards: returnYards });
        }
    }

    if (ballCarrierState && ballCarrierState.isOffense && !playState.returnStartY) {
        const caughtPassThisPlay = playState.statEvents.some(e => e.type === 'completion' && e.receiverId === ballCarrierState.id);
        const yardageLine = playState.fumbleOccurred ? playState.finalBallY : ballCarrierState.y;
        const rushYards = yardageLine - playState.lineOfScrimmage;

        // Correctly classify Sacks vs QB Scrambles
        if (playState.type === 'pass' && ballCarrierState.role === 'QB' && !caughtPassThisPlay) {
            if (rushYards < 0) {
                playState.sack = true; // He didn't make it back to the line, it's a sack!

                // A successful tackle may already have recorded this sack.
                // Only add a fallback event if this QB has no sack event yet.
                const alreadyCredited = playState.statEvents.some(
                    e => e.type === 'sack' && e.qbId === ballCarrierState.id
                );

                const tacklerEvent = playState.statEvents.find(e => e.type === 'tackle');

                if (tacklerEvent && !alreadyCredited) {
                    playState.statEvents.push({
                        type: 'sack',
                        playerId: tacklerEvent.playerId,
                        qbId: ballCarrierState.id
                    });
                }
            } else {
                // Positive yards on a scramble is a rush
                playState.statEvents.push({ type: 'rush', runnerId: ballCarrierState.id, yards: rushYards });
            }
        } else if (playState.type === 'run' && !caughtPassThisPlay && !playState.sack) {
            playState.statEvents.push({ type: 'rush', runnerId: ballCarrierState.id, yards: rushYards });
        }
    }

    if (playState.playIsLive && !playState.touchdown && !playState.safety) {
        ballCarrierState = playState.activePlayers.find(p => p.hasBall || p.isBallCarrier);
        if (ballCarrierState) {
            playState.yards = ballCarrierState.y - playState.lineOfScrimmage;
            playState.finalBallY = ballCarrierState.y;
        } else if (!playState.sack && !playState.turnover && !playState.fumbleOccurred) {
            playState.incomplete = true;
            playState.yards = 0;
            playState.finalBallY = playState.lineOfScrimmage;
        }
    }

    if (down === 4 && !playState.touchdown && !playState.possessionChanged && !playState.safety && playState.type !== 'punt') {
        if (playState.yards < yardsToGo) {
            playState.possessionChanged = true;
            playResult.turnoverType = 'downs';
            if (gameLog) gameLog.push("🛑 Turnover on Downs!");
        }
    }

    playState.finalBallY = Math.max(0, Math.min(110, playState.finalBallY));

    const completionEvent = playState.statEvents.find(e => e.type === 'completion');
    if (completionEvent) {
        // FIX: If a fumble occurred after the catch, don't use the defensive return spot for the receiver's yards!
        completionEvent.yards = (playState.fumbleOccurred && playState.fumbleYards !== undefined) 
            ? playState.fumbleYards 
            : playState.yards;
    }

    playResult.yards = Math.round(playState.yards);
    if (playState.sack) playResult.yards = Math.min(0, playResult.yards);

    if (playState.incomplete) {
        playResult.outcome = 'incomplete';
        playResult.yards = 0;
        playState.finalBallY = playState.lineOfScrimmage;

        // The pass is dead. Keep the physical ball state consistent.
        const deadBall = playState.ballState;

        if (deadBall) {
            // Keep the dead ball inside the field boundaries.
            deadBall.x = Math.max(
                0.5,
                Math.min(FIELD_WIDTH - 0.5, deadBall.x)
            );

            // Synchronize the physical ball with the official dead-ball spot.
            deadBall.y = playState.finalBallY;
            deadBall.z = 0;

            deadBall.vx = 0;
            deadBall.vy = 0;
            deadBall.vz = 0;

            deadBall.inAir = false;
            deadBall.isLoose = false;
        }
    } else if (playState.touchdown) {
        playResult.outcome = playState.type === 'run' ? 'rush_td' : 'complete';
        playResult.score = 'TD';
        playResult.defensiveTD = playState.defensiveTD || false;
    } else if (playState.safety) {
        playResult.outcome = 'safety';
        playResult.safety = true;
        playResult.score = 'SAFETY';
    } else if (playState.sack) {
        playResult.outcome = 'sack';
    } else if (!playState.playIsLive) {
        // Correctly classify runs vs passes on tackles
        if (playState.type === 'run' || playState.isScrambleRun) {
            playResult.outcome = 'rush';
        } else {
            playResult.outcome = 'complete';
        }
    }

    if (playState.possessionChanged || playState.turnover || playState.type === 'punt') {
        playResult.possessionChange = true;

        if (playState.interceptionOccurred) playResult.turnoverType = 'interception';
        else if (playState.fumbleOccurred) playResult.turnoverType = 'fumble';
        else if (playState.type === 'punt') playResult.turnoverType = 'punt';
        else if (!playResult.turnoverType && down === 4) playResult.turnoverType = 'downs';

        // Preserve scoring outcomes instead of relabeling them as turnovers.
        if (!playState.touchdown && !playState.safety) {
            playResult.outcome = 'turnover';
        }
    }

    applyStatEvents(playState.statEvents);

    playState.activePlayers.forEach(p => {
        const player = getPlayer(p.id);
        if (player) {
            if (!player.careerStats) player.careerStats = { seasonsPlayed: 0 };
            player.careerStats.snapsThisSeason = (player.careerStats.snapsThisSeason || 0) + 1;
            player.snapsThisWeek = (player.snapsThisWeek || 0) + 1;

            // PASSIVE HUDDLE RECOVERY: Players catch their breath between plays based on their stamina rating
            const staminaRating = player.attributes?.physical?.stamina || 50;
            const recoveryAmt = 1.5 + (staminaRating / 25); // Recovers roughly 3.5% to 5.5% fatigue per play
            player.fatigue = Math.max(0, (player.fatigue || 0) - recoveryAmt);
        }
    });

    // BACKYARD CLOCK BURN: Plays take time to set up, kids have to retrieve incomplete passes from the bushes
    let clockBurn = Math.floor(Math.random() * 10) + 30; // 30 to 39 seconds for a normal play + huddle
    if (playState.incomplete || playState.outOfBounds) clockBurn = Math.floor(Math.random() * 8) + 18; // Fetching ball stops clock temporarily
    else if (playResult.possessionChange || playState.touchdown || playState.safety) clockBurn = 40; // Turnovers take a while to reset

    // Late 4th-Quarter Hurry-Up: Scaled strictly by Coach Clock IQ
    const isLateTrailing = quarter >= 4 && timeRemaining < 120 && scoreDiff < 0;
    if (isLateTrailing) {
        const coach = offense?.staff?.coach || offense?.coach;
        const clockIQ = coach?.ratings?.clockIQ || 50;

        // Elite Clock IQ (75-99): Crisp 2-minute drill burns only 12-18 seconds
        // Low Clock IQ (20-45): Flustered kids dawdle in the huddle, burning 26-34 seconds
        const iqHurryMultiplier = 0.85 - ((clockIQ / 100) * 0.45); // 0.40 to 0.75
        clockBurn = Math.max(12, Math.floor(clockBurn * iqHurryMultiplier));
    }

    playResult.clockBurn = clockBurn;
    playResult.touchback = Boolean(playState.touchback);

    // Ensure the last visual frame reflects the actual terminal play state.
    if (
        isLive &&
        gameLog &&
        Array.isArray(playState.visualizationFrames)
    ) {
        const frames = playState.visualizationFrames;
        const terminalFrame = captureFrame(playState, gameLog);
        const lastIndex = frames.length - 1;

        if (
            lastIndex >= 0 &&
            frames[lastIndex]?.tick === playState.tick
        ) {
            // Replace a same-tick frame so cleanup and scoring changes are visible.
            frames[lastIndex] = terminalFrame;
        } else {
            // The loop may have broken before recording its final tick.
            frames.push(terminalFrame);
        }
    }

    finalizePlayTelemetry(
        playResult,
        playState.finalBallY,
        playState
    );
    
    return {
        playResult,
        finalBallY: playState.finalBallY,
        log: gameLog,
        visualizationFrames: isLive ? playState.visualizationFrames : []
    };
}

function normalizeFormationLookupKey(formationMap, value, fallbackKey) {
    if (value && formationMap?.[value]) {
        return value;
    }

    if (typeof value === 'string' && value) {
        const displayMatch = Object.entries(formationMap || {}).find(
            ([, definition]) => definition?.name === value
        );

        if (displayMatch) {
            return displayMatch[0];
        }
    }

    if (formationMap?.[fallbackKey]) {
        return fallbackKey;
    }

    return Object.keys(formationMap || {}).find(
        key => key !== 'Punt' && key !== 'Punt_Return'
    ) || fallbackKey;
}

export function simulateLivePlayStep(gameInstance, mode = 'live') {
    const isLive = mode === 'live';
    if (!gameInstance || !gameInstance.possession || !gameInstance.homeTeam || !gameInstance.awayTeam) {
        return { playResult: { outcome: 'error' }, finalBallY: 35, log: [], visualizationFrames: [] };
    }

    const offense = gameInstance.possession;
    const defense = (offense.id === gameInstance.homeTeam.id) ? gameInstance.awayTeam : gameInstance.homeTeam;

        if (!offense.formations) offense.formations = { offense: 'Balanced', defense: '3-2-3' };
    if (!defense.formations) defense.formations = { offense: 'Balanced', defense: '3-2-3' };

    offense.formations.offense = normalizeFormationLookupKey(
        offenseFormations,
        offense.formations.offense,
        'Balanced'
    );
    offense.formations.defense = normalizeFormationLookupKey(
        defenseFormations,
        offense.formations.defense,
        '3-2-3'
    );

    defense.formations.offense = normalizeFormationLookupKey(
        offenseFormations,
        defense.formations.offense,
        'Balanced'
    );
    defense.formations.defense = normalizeFormationLookupKey(
        defenseFormations,
        defense.formations.defense,
        '3-2-3'
    );

    if (offense._savedOffForm && offense._savedOffForm !== 'Punt') {
        offense._savedOffForm = normalizeFormationLookupKey(
            offenseFormations,
            offense._savedOffForm,
            'Balanced'
        );
    }

    let offPlayKey = '';
    let defPlayKey = '';
    let snapOffenseFormation = null;
    let snapDefenseFormation = null;

    // Remember custom user schemes before special-teams overrides
    if (!offense._savedOffForm && offense.formations.offense !== 'Punt') {
        offense._savedOffForm = offense.formations.offense;
    }

    if (gameInstance.isConversionAttempt) {
        gameInstance.down = 1; gameInstance.yardsToGo = 3; gameInstance.ballOn = 97;
        offPlayKey = 'Uni_QuickSlants'; defPlayKey = 'GoalLine_RunStuff';

        snapOffenseFormation =
            getOffensiveFormationForPlay(offense, offPlayKey) ||
            offense.formations.offense ||
            'Balanced';

        snapDefenseFormation =
            defensivePlaybook[defPlayKey]?.compatibleFormations?.find(
                key => defenseFormations[key]
            ) ||
            defense.formations.defense;
    } else if (determinePuntDecision(gameInstance.down, gameInstance.yardsToGo, gameInstance.ballOn, offense, (offense.id === gameInstance.homeTeam.id ? (gameInstance.homeScore - gameInstance.awayScore) : (gameInstance.awayScore - gameInstance.homeScore)), gameInstance.clock)) {
        offense.formations.offense = 'Punt';
        defense.formations.defense = 'Punt_Return';
        offPlayKey = 'Punt_Punt';
        defPlayKey = 'PuntReturn_Classic';

        snapOffenseFormation = 'Punt';
        snapDefenseFormation = 'Punt_Return';
    } else {
        const scoreDiff = (offense.id === gameInstance.homeTeam.id)
            ? (gameInstance.homeScore - gameInstance.awayScore)
            : (gameInstance.awayScore - gameInstance.homeScore);

        if (gameInstance.clock === undefined) gameInstance.clock = 420;
        if (gameInstance.quarter === undefined) gameInstance.quarter = 1;

        const timeRemaining = gameInstance.quarter < 5 ? gameInstance.clock + ((4 - gameInstance.quarter) * 420) : gameInstance.clock;
        const drivesRemaining = Math.max(1, Math.ceil(timeRemaining / 120));

        // Restore user scheme cleanly after punt
        if (offense.formations.offense === 'Punt') {
            offense.formations.offense = normalizeFormationLookupKey(
                offenseFormations,
                offense._savedOffForm || offense.coach?.preferredOffense,
                'Balanced'
            );
        }
        if (!offense.isPlayerControlled) {
            offense.formations.offense = normalizeFormationLookupKey(
                offenseFormations,
                offense.coach?.preferredOffense,
                'Balanced'
            );
        }

        offPlayKey = determinePlayCall(offense, defense, gameInstance.down, gameInstance.yardsToGo, gameInstance.ballOn, scoreDiff, gameInstance.gameLog, drivesRemaining);
        if (!offPlayKey || !offensivePlaybook[offPlayKey]) offPlayKey = 'Uni_InsideZone';

        snapOffenseFormation =
            getOffensiveFormationForPlay(offense, offPlayKey) ||
            offense.formations.offense ||
            'Balanced';

        if (defense.formations.defense === 'Punt_Return') {
            defense.formations.defense = normalizeFormationLookupKey(
                defenseFormations,
                defense.coach?.preferredDefense,
                '3-2-3'
            );
        }
        if (!defense.isPlayerControlled) {
            defense.formations.defense = determineDefensiveFormation(
                defense,
                snapOffenseFormation,
                gameInstance.down,
                gameInstance.yardsToGo,
                gameInstance.gameLog,
                gameInstance.ballOn
            );
        }
        defPlayKey = determineDefensivePlayCall(
            defense,
            offense,
            gameInstance.down,
            gameInstance.yardsToGo,
            gameInstance.ballOn,
            scoreDiff,
            gameInstance.gameLog,
            drivesRemaining,
            offPlayKey
        );

        const legalGoalLineCall =
            gameInstance.ballOn >= 95 &&
            gameInstance.yardsToGo <= 3;

        if (/goal.?line/i.test(defPlayKey) && !legalGoalLineCall) {
            gameInstance.gameLog?.push(
                `[AI GUARD] Rejected ${defPlayKey}: ` +
                `ballOn=${gameInstance.ballOn}, ` +
                `down=${gameInstance.down}&${gameInstance.yardsToGo}`
            );

            defPlayKey = defensivePlaybook['Cover_2_Zone_Base']
                ? 'Cover_2_Zone_Base'
                : Object.keys(defensivePlaybook).find(
                    key => !/goal.?line/i.test(key)
                );
        }
        const calledDefPlay = defensivePlaybook[defPlayKey];
        const currentDefFormation = defense.formations.defense;

        if (isPlayCompatibleWithDefense(calledDefPlay, currentDefFormation)) {
            snapDefenseFormation = currentDefFormation;
        } else {
            snapDefenseFormation =
                Object.keys(defenseFormations).find(key =>
                    isPlayCompatibleWithDefense(calledDefPlay, key)
                ) ||
                Object.keys(defenseFormations).find(
                    key => key !== 'Punt_Return'
                ) ||
                currentDefFormation;
        }
    }

    if (!snapOffenseFormation) {
        snapOffenseFormation = offense.formations.offense || 'Balanced';
    }

    if (!snapDefenseFormation) {
        snapDefenseFormation = defense.formations.defense;
    }

    const context = {
        gameLog: gameInstance.gameLog,
        weather: gameInstance.weather || 'Sunny',
        isConversionAttempt: Boolean(gameInstance.isConversionAttempt),
        ballOn: gameInstance.ballOn,
        ballHash: gameInstance.ballHash || 'M',
        down: gameInstance.down,
        yardsToGo: gameInstance.yardsToGo,
        offenseScore: (offense.id === gameInstance.homeTeam.id) ? (gameInstance.homeScore || 0) : (gameInstance.awayScore || 0),
        defenseScore: (offense.id === gameInstance.homeTeam.id) ? (gameInstance.awayScore || 0) : (gameInstance.homeScore || 0),
        timeRemaining: gameInstance.clock,
        quarter: gameInstance.quarter
    };

    const offThreshold = offense.isPlayerControlled ? (offense.autoSubThreshold || gameInstance.autoSubThreshold || 65) : 65;
    const defThreshold = defense.isPlayerControlled ? (defense.autoSubThreshold || gameInstance.autoSubThreshold || 65) : 65;

    autoMakeSubstitutions(offense, { thresholdFatigue: offThreshold, chance: 1.0 }, gameInstance.gameLog);
    autoMakeSubstitutions(defense, { thresholdFatigue: defThreshold, chance: 1.0 }, gameInstance.gameLog);

        const configuredOffenseFormation = offense.formations.offense;
    const configuredDefenseFormation = defense.formations.defense;

    offense.formations.offense = snapOffenseFormation;
    defense.formations.defense = snapDefenseFormation;

    let result;

    try {
        result = resolvePlay(
            offense,
            defense,
            offPlayKey,
            defPlayKey,
            context,
            { fastSim: !isLive },
            isLive
        );
    } finally {
        // Restore each team's stored/preferred formation after setup and execution.
        offense.formations.offense = configuredOffenseFormation;
        defense.formations.defense = configuredDefenseFormation;
    }

    const { playResult, finalBallY } = result;

    // Record normal offensive and defensive play outcomes for postgame
    // coaching feedback. Exclude conversions and punts from this sample.
    if (
        !isLive &&
        !gameInstance.isConversionAttempt &&
        offPlayKey !== 'Punt_Punt' &&
        defPlayKey !== 'PuntReturn_Classic'
    ) {
        const requiredYards = Math.max(
            0,
            Number(gameInstance.yardsToGo) || 0
        );

        const successThreshold = gameInstance.down === 1
            ? requiredYards * 0.4
            : gameInstance.down === 2
                ? requiredYards * 0.6
                : requiredYards;

        const yards = Number(playResult.yards);
        const safeYards = Number.isFinite(yards) ? yards : 0;

        const offensiveTouchdown =
            playResult.score === 'TD' && !playResult.defensiveTD;

        const defensiveTouchdown =
            playResult.score === 'TD' && Boolean(playResult.defensiveTD);

        const offensiveTurnover = Boolean(
            playResult.possessionChange ||
            playResult.turnoverType ||
            playResult.defensiveTD ||
            playResult.safety
        );

        const offenseSucceeded = offensiveTouchdown || (
            !offensiveTurnover &&
            safeYards >= successThreshold
        );

        const defenseSucceeded = (
            defensiveTouchdown ||
            playResult.safety ||
            playResult.possessionChange ||
            Boolean(playResult.turnoverType) ||
            safeYards < successThreshold
        );

        const recordPlayOutcome = (
            team,
            unit,
            playKey,
            succeeded,
            touchdown,
            turnover
        ) => {
            if (!team?.id || !playKey) return;

            if (!gameInstance.playCallStats) {
                gameInstance.playCallStats = {};
            }

            const teamKey = String(team.id);

            if (!gameInstance.playCallStats[teamKey]) {
                gameInstance.playCallStats[teamKey] = {
                    offense: {},
                    defense: {}
                };
            }

            const teamStats = gameInstance.playCallStats[teamKey];

            if (!teamStats[unit][playKey]) {
                teamStats[unit][playKey] = {
                    calls: 0,
                    successes: 0,
                    touchdowns: 0,
                    turnovers: 0,
                    yards: 0
                };
            }

            const stat = teamStats[unit][playKey];

            stat.calls++;
            stat.successes += succeeded ? 1 : 0;
            stat.touchdowns += touchdown ? 1 : 0;
            stat.turnovers += turnover ? 1 : 0;
            stat.yards += safeYards;
        };

        recordPlayOutcome(
            offense,
            'offense',
            offPlayKey,
            offenseSucceeded,
            offensiveTouchdown,
            offensiveTurnover
        );

        recordPlayOutcome(
            defense,
            'defense',
            defPlayKey,
            defenseSucceeded,
            defensiveTouchdown,
            offensiveTurnover
        );
    }

    if (gameInstance.isConversionAttempt) {
        if (playResult.score === 'TD') {
            let scoringTeam = offense;
            if (playResult.defensiveTD) scoringTeam = defense;
            if (scoringTeam.id === gameInstance.homeTeam.id) gameInstance.homeScore += 2;
            else gameInstance.awayScore += 2;
            gameInstance.gameLog.push("✅ Conversion GOOD!");
        } else {
            gameInstance.gameLog.push("❌ Conversion FAILED!");
        }
        gameInstance.isConversionAttempt = false;
        gameInstance.possession = defense;
        if (!gameInstance.possession.isPlayerControlled) {
            gameInstance.possession.formations.offense = gameInstance.possession.coach?.preferredOffense || 'Balanced';
        }
        gameInstance.ballOn = 20;
        gameInstance.down = 1;
        gameInstance.yardsToGo = 10;
        gameInstance.possession.recentPlayHistory = [];
    } else if (playResult.score === 'TD') {
        let scoringTeam = offense;
        if (playResult.defensiveTD) {
            scoringTeam = defense;
            gameInstance.possession = defense;
        }
        if (scoringTeam.id === gameInstance.homeTeam.id) gameInstance.homeScore += 6;
        else gameInstance.awayScore += 6;
        
        // Immediately set up the conversion field state so the UI scoreboard and next tick are synced
        gameInstance.isConversionAttempt = true;
        gameInstance.ballOn = 97;
        gameInstance.down = 1;
        gameInstance.yardsToGo = 3;
    } else if (playResult.safety) {
        if (defense.id === gameInstance.homeTeam.id) gameInstance.homeScore += 2;
        else gameInstance.awayScore += 2;
        gameInstance.possession = defense;
        gameInstance.ballOn = 35;
        gameInstance.down = 1;
        gameInstance.yardsToGo = 10;
    } else if (playResult.possessionChange) {
        gameInstance.possession = defense;
        if (!gameInstance.possession.isPlayerControlled) {
            gameInstance.possession.formations.offense = gameInstance.possession.coach?.preferredOffense || 'Balanced';
        }
        gameInstance.possession.recentPlayHistory = [];
        gameInstance.ballOn = Number((110 - finalBallY).toFixed(1));
        if (gameInstance.ballOn <= 0 || gameInstance.ballOn >= 100) {
            gameInstance.ballOn = 20;
        }
        gameInstance.ballOn = Math.max(1, Math.min(99, gameInstance.ballOn));
        gameInstance.down = 1;
        gameInstance.yardsToGo = 10;
    } else {
        gameInstance.ballOn = Number((gameInstance.ballOn + playResult.yards).toFixed(1));
        gameInstance.ballOn = Math.max(1, Math.min(99, gameInstance.ballOn));
        gameInstance.yardsToGo = Number((gameInstance.yardsToGo - playResult.yards).toFixed(1));

        if (gameInstance.yardsToGo <= 0) {
            gameInstance.down = 1;
            const distToGoal = Number((100 - gameInstance.ballOn).toFixed(1));
            gameInstance.yardsToGo = (distToGoal < 10) ? distToGoal : 10;
        } else {
            if (gameInstance.down >= 4) {
                gameInstance.possession = defense;
                gameInstance.ballOn = 110 - gameInstance.ballOn;
                if (!gameInstance.possession.isPlayerControlled) {
                    gameInstance.possession.formations.offense = gameInstance.possession.coach?.preferredOffense || 'Balanced';
                }
                gameInstance.down = 1;
                gameInstance.yardsToGo = 10;
                gameInstance.possession.recentPlayHistory = [];
            } else {
                gameInstance.down++;
            }
        }
    }

    gameInstance.playsTotal = (gameInstance.playsTotal || 0) + 1;
    if (!gameInstance.isConversionAttempt) {
        gameInstance.clock -= playResult.clockBurn || 15;
    }

    if (gameInstance.clock <= 0) {
        gameInstance.quarter++;
        gameInstance.clock = 420;
        if (gameInstance.quarter === 3 && !gameInstance.halftimeProcessed) {
            gameInstance.halftimeProcessed = true;
            [...getRosterObjects(offense), ...getRosterObjects(defense)].forEach(p => {
                if (p) {
                    p.fatigue = Math.max(0, (p.fatigue || 0) - 40);
                    if (p.fatigue < 40) p.isResting = false;
                }
            });
            gameInstance.possession = defense;
            gameInstance.ballOn = 35;
            gameInstance.down = 1;
            gameInstance.yardsToGo = 10;
        } else if (gameInstance.quarter === 5) {
            if (gameInstance.homeScore !== gameInstance.awayScore) {
                // Regulation ended with a winner. Do not leave the final
                // game state labeled as overtime.
                gameInstance.quarter = 4;
                gameInstance.clock = 0;
                gameInstance.isGameOver = true;
            } else {
                gameInstance.clock = 300;
                gameInstance.ballOn = 75;
                gameInstance.down = 1;
                gameInstance.yardsToGo = 10;
            }
        } else if (gameInstance.quarter > 5) {
            gameInstance.isGameOver = true;
        }
    }

    return result;
}

export function recordTeamGamePlanningOutcome(
    team,
    opponent,
    pointsFor,
    pointsAgainst,
    task,
    year,
    week,
    playCallStats = null
) {
    const skillKeys = task === 'offensePrep'
        ? [
            'offSchemeMastery',
            'gameplanInstinct',
            'inGameAdjustments'
        ]
        : [
            'defSchemeMastery',
            'gameplanInstinct',
            'inGameAdjustments'
        ];

    const hoursByCoach = new Map();

    for (const assignment of team.staffWorkPlan?.assignments || []) {
        if (
            assignment?.task !== task ||
            assignment.coachId == null
        ) {
            continue;
        }

        const hours = getEffectiveStaffWorkHours(
            team,
            assignment
        );

        if (!Number.isFinite(hours) || hours <= 0) continue;

        const id = String(assignment.coachId);

        hoursByCoach.set(
            id,
            (hoursByCoach.get(id) || 0) + hours
        );
    }

    const skillScore = coach => {
        const ratings = coach?.ratings || {};

        return skillKeys.reduce((total, key) => {
            const value = Number(ratings[key]);

            return total + (
                Number.isFinite(value)
                    ? Math.max(0, Math.min(100, value))
                    : 50
            );
        }, 0) / skillKeys.length;
    };

    const assignedCoach = (team.coaches || [])
        .filter(coach =>
            coach?.id != null &&
            (hoursByCoach.get(String(coach.id)) || 0) > 0
        )
        .sort((a, b) => {
            const hoursDifference =
                (hoursByCoach.get(String(b.id)) || 0) -
                (hoursByCoach.get(String(a.id)) || 0);

            return hoursDifference ||
                skillScore(b) - skillScore(a);
        })[0];

    if (!assignedCoach) return;

        const clamp = value => Math.max(-1, Math.min(1, value));
    const clampExpectedPoints = value =>
        Math.max(4, Math.min(26, value));

    const offensePositions = new Set([
        'QB', 'RB', 'WR', 'TE', 'OL'
    ]);

    const defensePositions = new Set([
        'DL', 'LB', 'DB'
    ]);

    const getUnitRating = (targetTeam, unit) => {
        const roster = getRosterObjects(targetTeam).filter(
            player => player?.attributes
        );

        const validPositions = unit === 'offense'
            ? offensePositions
            : defensePositions;

        const preferredPosition = unit === 'offense'
            ? 'favoriteOffensivePosition'
            : 'favoriteDefensivePosition';

        const ratings = [];

        for (const player of roster) {
            const positions = [
                ...new Set([
                    player.pos,
                    player[preferredPosition]
                ].filter(position => validPositions.has(position)))
            ];

            if (positions.length === 0) continue;

            const playerRatings = positions
                .map(position => calculateOverall(player, position))
                .filter(Number.isFinite);

            if (playerRatings.length > 0) {
                ratings.push(Math.max(...playerRatings));
            }
        }

        // Fallback for incomplete positional data.
        if (ratings.length === 0) {
            for (const player of roster) {
                const position = estimateBestPosition(player);
                const rating = calculateOverall(player, position);

                if (Number.isFinite(rating)) {
                    ratings.push(rating);
                }
            }
        }

        if (ratings.length === 0) return 50;

        return ratings.reduce((sum, rating) => sum + rating, 0) /
            ratings.length;
    };

    const expectedPoints = task === 'offensePrep'
        ? clampExpectedPoints(
            14 + (
                getUnitRating(team, 'offense') -
                getUnitRating(opponent, 'defense')
            ) * 0.18
        )
        : clampExpectedPoints(
            14 + (
                getUnitRating(opponent, 'offense') -
                getUnitRating(team, 'defense')
            ) * 0.18
        );

    // Offensive preparation is graded against expected points scored.
    // Defensive preparation is graded against expected points allowed.
    const performanceDelta = task === 'offensePrep'
        ? pointsFor - expectedPoints
        : expectedPoints - pointsAgainst;

    let outcomeQuality = clamp(performanceDelta / 10);

    // Blend prepared-play results into the team-level performance grade.
    // Ignore stale preparation and require a minimum sample size.
    const preparation = team.gameplan?.staffPreparation;

    const preparationIsCurrent =
        Number(preparation?.preparedForYear) === Number(year) &&
        Number(preparation?.preparedForWeek) === Number(week);

    const targetedPlayMap = !preparationIsCurrent
        ? null
        : task === 'offensePrep'
            ? preparation.offenseByPlay
            : (
                preparation.defenseByOpponent?.[String(opponent?.id)] ||
                preparation.defenseByOpponent?.['*']
            )?.byPlay;

    const teamPlayStats = playCallStats?.[String(team.id)];

    const unitPlayStats = task === 'offensePrep'
        ? teamPlayStats?.offense
        : teamPlayStats?.defense;

    let targetedCalls = 0;
    let targetedSuccesses = 0;

    for (const [playKey, prepPoints] of Object.entries(
        targetedPlayMap || {}
    )) {
        if (!(Number(prepPoints) > 0)) continue;

        const stat = unitPlayStats?.[playKey];
        const calls = Number(stat?.calls) || 0;
        const successes = Number(stat?.successes) || 0;

        if (calls <= 0) continue;

        targetedCalls += calls;
        targetedSuccesses += Math.min(calls, successes);
    }

    if (targetedCalls >= 3) {
        const targetedSuccessRate =
            targetedSuccesses / targetedCalls;

        const expectedSuccessRate = task === 'offensePrep'
            ? 0.45
            : 0.55;

        const targetedQuality = clamp(
            (targetedSuccessRate - expectedSuccessRate) / 0.25
        );

        // Team performance remains the primary signal.
        // Prepared-play performance supplies a smaller secondary signal.
        outcomeQuality = clamp(
            outcomeQuality * 0.75 +
            targetedQuality * 0.25
        );
    }

    // Preparation hours increase confidence in the feedback signal;
    // they do not directly grant a skill increase.
    const preparationConfidence = Math.min(
        1,
        (hoursByCoach.get(String(assignedCoach.id)) || 0) / 12
    );

    const quality = clamp(
        outcomeQuality * preparationConfidence
    );

    recordCoachDevelopmentOutcome(
        assignedCoach,
        task,
        quality,
        `game:${team.id}:${opponent.id}`,
        year,
        week,
        skillKeys
    );
}

export function simulateMatchFast(homeTeam, awayTeam) {
    if (!homeTeam || !awayTeam) return null;

    // Youth games use ordered probabilistic matchups; main-league games stay on the full engine.
    if (homeTeam.leagueType === 'youth' && awayTeam.leagueType === 'youth') {
        return simulateYouthMatch(homeTeam, awayTeam);
    }

    resetGameStats(homeTeam, awayTeam);
    aiSetDepthChart(homeTeam);
    aiSetDepthChart(awayTeam);

    const matchGame = {
        homeTeam, awayTeam,
        homeScore: 0, awayScore: 0,
        possession: Math.random() < 0.5 ? homeTeam : awayTeam,
        ballOn: 35, down: 1, yardsToGo: 10,
        gameLog: [],
        playCallStats: {},
        quarter: 1,
        clock: 420,
        playsTotal: 0,
        isConversionAttempt: false,
        isGameOver: false,
        weather: getRandom(['Sunny', 'Windy', 'Rain'])
    };

    while (!matchGame.isGameOver) {
        simulateLivePlayStep(matchGame, 'fast');
    }

        finalizeGameResults(
        homeTeam,
        awayTeam,
        matchGame.homeScore,
        matchGame.awayScore
    );

    // Only begin career development feedback after the user takes over.
    // Historical seasons shouldn't accumulate unprocessed coaching progress.
    if (
        game?.playerTeam &&
        Number.isInteger(game.year) &&
        Number.isInteger(game.currentWeek)
    ) {
        const year = game.year;
        const week = game.currentWeek;

        recordTeamGamePlanningOutcome(
            homeTeam,
            awayTeam,
            matchGame.homeScore,
            matchGame.awayScore,
            'offensePrep',
            year,
            week,
            matchGame.playCallStats
        );

        recordTeamGamePlanningOutcome(
            homeTeam,
            awayTeam,
            matchGame.homeScore,
            matchGame.awayScore,
            'defensePrep',
            year,
            week,
            matchGame.playCallStats
        );

        recordTeamGamePlanningOutcome(
            awayTeam,
            homeTeam,
            matchGame.awayScore,
            matchGame.homeScore,
            'offensePrep',
            year,
            week,
            matchGame.playCallStats
        );

        recordTeamGamePlanningOutcome(
            awayTeam,
            homeTeam,
            matchGame.awayScore,
            matchGame.homeScore,
            'defensePrep',
            year,
            week,
            matchGame.playCallStats
        );
    }

    return {
        homeTeam: matchGame.homeTeam,
        awayTeam: matchGame.awayTeam,
        homeScore: matchGame.homeScore,
        awayScore: matchGame.awayScore,
        gameLog: matchGame.gameLog,
        breakthroughs: []
    };
}

export function simulateWeek(options = {}) {
    if (!game || !game.teams) return [];
    if (game.currentWeek >= WEEKS_IN_SEASON) return null;

    game.breakthroughs = [];
    if (!game.schedule || game.schedule.length === 0) {
        if (game.currentWeek === 0) {
            generateSchedule();
        } else {
            return [];
        }
    }

    const gamesPerWeek = game.teams.length / 2;
    const startIndex = game.currentWeek * gamesPerWeek;
    const endIndex = startIndex + gamesPerWeek;
    const weeklyGames = game.schedule.slice(startIndex, endIndex);

    if (!weeklyGames || weeklyGames.length === 0) {
        game.currentWeek++;
        return [];
    }

    return weeklyGames.map(match => {
        try {
            if (!match?.home || !match?.away) return null;
            return simulateMatchFast(match.home, match.away);
        } catch (error) {
            return null;
        }
    }).filter(Boolean);
}
