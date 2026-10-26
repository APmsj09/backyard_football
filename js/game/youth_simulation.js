// js/game/youth_simulation.js
// Lightweight, ordered youth-game resolver. It uses the same player attributes,
// depth-chart roles, IQ concepts, and result/stat model as the full game engine,
// but resolves matchup phases probabilistically instead of simulating every frame.

import {
    getRosterObjects,
    resetGameStats,
    finalizeGameResults
} from './state.js';
import { calculateOverall } from './player.js';
import { aiSetDepthChart } from './depth_chart.js';
import { getDecisionProfile } from './decision_model.js';
import {
    MOVEMENT_MODEL,
    getPlayerBaseSpeedYPS,
    getPlayerAccelerationYPS2
} from './movement_profile.js';

// Safety cap only. Normal games end through the game clock.
const YOUTH_GAME_PLAYS = 120;
const YOUTH_QUARTER_SECONDS = 420;
const YOUTH_OVERTIME_SECONDS = 300;
const STAT_FIELDS = [
    'passYards', 'passAttempts', 'passCompletions', 'interceptionsThrown',
    'rushYards', 'rushAttempts', 'recYards', 'receptions', 'targets', 'drops',
    'tackles', 'sacks', 'interceptions', 'fumbles', 'fumblesLost',
    'fumblesRecovered', 'touchdowns', 'returnYards', 'safeties'
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const roll = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const noise = amount => (Math.random() * 2 - 1) * amount;

function getMovementSpeedRating(player) {
    const speedYPS = getPlayerBaseSpeedYPS(player);

    return clamp(
        (
            (speedYPS - MOVEMENT_MODEL.baseSpeedYPS) /
            MOVEMENT_MODEL.speedRatingBonusYPS
        ) * 100,
        0,
        100
    );
}

function getMovementAccelerationRating(player) {
    const accelerationYPS2 = getPlayerAccelerationYPS2(player);

    return clamp(
        (
            (accelerationYPS2 - MOVEMENT_MODEL.baseAccelerationYPS2) /
            MOVEMENT_MODEL.explosivenessAccelerationBonusYPS2
        ) * 100,
        0,
        100
    );
}

function getSkill(player, attribute) {
    if (attribute === 'speed') return getMovementSpeedRating(player);
    if (!player?.attributes) return 50;

    for (const category of Object.values(player.attributes)) {
        if (!category || typeof category !== 'object') continue;
        if (typeof category[attribute] === 'number') return category[attribute];
        if (attribute === 'coverage' && typeof category.passCoverage === 'number') {
            return category.passCoverage;
        }
    }

    return 50;
}

function getYouthDecisionProfile(player, role = '') {
    if (!player) return null;

    const mental = player.attributes?.mental || {};

    const profileState = {
        role,
        slot: role ? `${role}1` : '',
        playbookIQ: getSkill(player, 'playbookIQ'),
        consistency: getSkill(player, 'consistency'),
        personality: player.personality || {}
    };

    // Match the main engine's fallback when decisionMaking is unavailable.
    if (
        mental.decisionMaking !== null &&
        mental.decisionMaking !== undefined &&
        Number.isFinite(Number(mental.decisionMaking))
    ) {
        profileState.decisionMaking = Number(mental.decisionMaking);
    }

    // Preserve the shared model's raw-IQ fallback when career data is absent.
    const careerStats = player.careerStats;

    if (careerStats && typeof careerStats === 'object') {
        if (
            careerStats.seasonsPlayed !== null &&
            careerStats.seasonsPlayed !== undefined &&
            Number.isFinite(Number(careerStats.seasonsPlayed))
        ) {
            profileState.experienceSeasons = Number(careerStats.seasonsPlayed);
        }

        if (
            careerStats.snapsThisSeason !== null &&
            careerStats.snapsThisSeason !== undefined &&
            Number.isFinite(Number(careerStats.snapsThisSeason))
        ) {
            profileState.experienceSnaps = Number(careerStats.snapsThisSeason);
        }
    }

    return getDecisionProfile(profileState);
}

function getDecisionQuality(player, role = '') {
    return getYouthDecisionProfile(player, role)?.decisionQuality
        ?? getSkill(player, 'playbookIQ');
}

function getAssignmentDiscipline(player, role = '') {
    return getYouthDecisionProfile(player, role)?.assignmentDiscipline ?? 50;
}

function averageDecisionQuality(players) {
    const usable = (players || []).filter(Boolean);

    if (usable.length === 0) return 50;

    return usable.reduce(
        (sum, player) => sum + getDecisionQuality(player),
        0
    ) / usable.length;
}

function weightedSkill(player, weights) {
    let total = 0;
    let weightTotal = 0;

    for (const [attribute, weight] of Object.entries(weights)) {
        total += getSkill(player, attribute) * weight;
        weightTotal += weight;
    }

    return weightTotal > 0 ? total / weightTotal : 50;
}

function addStat(player, key, amount = 1) {
    if (!player) return;
    if (!player.gameStats || typeof player.gameStats !== 'object') player.gameStats = {};
    player.gameStats[key] = (Number(player.gameStats[key]) || 0) + amount;
}

function prepareStats(team) {
    getRosterObjects(team).forEach(player => {
        if (!player) return;
        if (!player.gameStats || typeof player.gameStats !== 'object') player.gameStats = {};
        STAT_FIELDS.forEach(key => {
            if (!Number.isFinite(player.gameStats[key])) player.gameStats[key] = 0;
        });
    });
}

function choosePlayer(team, side, slot, position, roster, used) {
    const assignedId = team.depthChart?.[side]?.[slot];
    let player = roster.find(candidate => candidate?.id === assignedId && !used.has(candidate.id));

    if (!player) {
        const candidates = roster.filter(candidate => candidate && !used.has(candidate.id));
        candidates.sort((a, b) => calculateOverall(b, position) - calculateOverall(a, position));
        player = candidates[0] || null;
    }

    if (player) used.add(player.id);
    return player;
}

function buildLineup(team) {
    aiSetDepthChart(team);
    const roster = getRosterObjects(team).filter(Boolean);
    const offenseUsed = new Set();
    const defenseUsed = new Set();
    const takeOffense = (slot, position) => choosePlayer(team, 'offense', slot, position, roster, offenseUsed);
    const takeDefense = (slot, position) => choosePlayer(team, 'defense', slot, position, roster, defenseUsed);

    const offense = {
        qb: takeOffense('QB1', 'QB'),
        rb: takeOffense('RB1', 'RB'),
        wr1: takeOffense('WR1', 'WR'),
        wr2: takeOffense('WR2', 'WR'),
        te: takeOffense('TE1', 'TE'),
        ol: [
            takeOffense('OL1', 'OL'),
            takeOffense('OL2', 'OL'),
            takeOffense('OL3', 'OL')
        ].filter(Boolean)
    };

    const defense = {
        dls: [
            takeDefense('DL1', 'DL'),
            takeDefense('DL2', 'DL'),
            takeDefense('DL3', 'DL')
        ].filter(Boolean),
        lbs: [
            takeDefense('LB1', 'LB'),
            takeDefense('LB2', 'LB')
        ].filter(Boolean),
        dbs: [
            takeDefense('DB1', 'DB'),
            takeDefense('DB2', 'DB'),
            takeDefense('DB3', 'DB')
        ].filter(Boolean)
    };

    offense.receivers = [offense.wr1, offense.wr2, offense.te, offense.rb].filter(Boolean);
    defense.all = [...defense.dls, ...defense.lbs, ...defense.dbs];

    // Older or incomplete rosters still get a usable fallback lineup.
    if (!offense.qb) offense.qb = roster[0] || null;
    if (!offense.rb) offense.rb = roster.find(p => p.id !== offense.qb?.id) || offense.qb;
    if (offense.receivers.length === 0 && offense.rb) offense.receivers = [offense.rb];

    return { offense, defense, roster };
}

function recordSnaps(lineup) {
    const players = [
        lineup.offense.qb,
        lineup.offense.rb,
        lineup.offense.wr1,
        lineup.offense.wr2,
        lineup.offense.te,
        ...lineup.offense.ol,
        ...lineup.defense.all
    ];

    const counted = new Set();
    players.forEach(player => {
        if (!player || counted.has(player.id)) return;
        counted.add(player.id);
        if (!player.careerStats || typeof player.careerStats !== 'object') {
            player.careerStats = { seasonsPlayed: 0 };
        }
        player.careerStats.snapsThisSeason = (player.careerStats.snapsThisSeason || 0) + 1;
    });
}

function averageSkill(players, weights) {
    const usable = (players || []).filter(Boolean);
    if (usable.length === 0) return 50;
    return usable.reduce((sum, player) => sum + weightedSkill(player, weights), 0) / usable.length;
}

const BLOCK_SKILLS = { blocking: 0.50, strength: 0.25, playbookIQ: 0.15, consistency: 0.10 };
const RUSH_SKILLS = { blockShedding: 0.40, strength: 0.25, speed: 0.15, playbookIQ: 0.10, tackling: 0.10 };
const RUN_DEFENSE_SKILLS = { tackling: 0.30, blockShedding: 0.25, strength: 0.20, playbookIQ: 0.15, speed: 0.10 };
const COVER_SKILLS = { coverage: 0.40, speed: 0.25, agility: 0.20, playbookIQ: 0.15 };
const ROUTE_SKILLS = { speed: 0.25, agility: 0.25, playbookIQ: 0.25, catchingHands: 0.25 };
const BALL_CARRIER_SKILLS = { speed: 0.25, agility: 0.20, strength: 0.20, toughness: 0.20, playbookIQ: 0.15 };
const TACKLE_SKILLS = { tackling: 0.40, speed: 0.20, strength: 0.20, playbookIQ: 0.20 };

function chooseTackler(defense, exclude = new Set(), playType = 'run') {
    const dls = Array.isArray(defense?.dls) ? defense.dls : [];
    const lbs = Array.isArray(defense?.lbs) ? defense.lbs : [];
    const dbs = Array.isArray(defense?.dbs) ? defense.dbs : [];

    const candidates = (defense?.all || [])
        .filter(player => player && !exclude.has(player.id));

    if (candidates.length === 0) return null;

    const weightedCandidates = candidates.map(player => {
        const tackleSkill = clamp(weightedSkill(player, TACKLE_SKILLS), 1, 99);
        const isDL = dls.some(candidate => candidate?.id === player.id);
        const isLB = lbs.some(candidate => candidate?.id === player.id);
        const isDB = dbs.some(candidate => candidate?.id === player.id);

        let roleWeight = 1;

        if (playType === 'pass') {
            roleWeight = isDB ? 1.30 : isLB ? 1.0 : isDL ? 0.55 : 0.8;
        } else {
            roleWeight = isLB ? 1.25 : isDL ? 1.10 : isDB ? 0.80 : 1.0;
        }

        // Elite tacklers are favored without automatically receiving every tackle.
        const skillWeight = Math.exp((tackleSkill - 50) / 25);

        return {
            player,
            weight: skillWeight * roleWeight
        };
    });

    const totalWeight = weightedCandidates.reduce(
        (sum, candidate) => sum + candidate.weight,
        0
    );

    let ticket = Math.random() * totalWeight;

    for (const candidate of weightedCandidates) {
        ticket -= candidate.weight;
        if (ticket <= 0) return candidate.player;
    }

    return weightedCandidates[weightedCandidates.length - 1].player;
}

function finishBallCarrier(carrier, defense, startingYards, maxGain = 100, playType = 'run') {
    let yards = clamp(Math.round(startingYards), -8, Math.max(0, maxGain));
    let tackler = chooseTackler(defense, new Set(), playType);
    let contacted = false;

    if (tackler) {
        const carrierSkill = weightedSkill(carrier, BALL_CARRIER_SKILLS);
        const tacklerSkill = weightedSkill(tackler, TACKLE_SKILLS);

        if (yards < 0) {
            // A negative gain represents a tackle for loss or defensive penetration.
            addStat(tackler, 'tackles');
            contacted = true;
        } else {
            const tackleChance = clamp(
                0.62 + (tacklerSkill - carrierSkill) * 0.0045,
                0.32,
                0.88
            );

            if (Math.random() < tackleChance) {
                addStat(tackler, 'tackles');
                contacted = true;
            } else {
                // A missed first tackle creates a second pursuit decision.
                yards += roll(2, 5);
                const secondTackler = chooseTackler(
                    defense,
                    new Set([tackler.id]),
                    playType
                );

                if (secondTackler) {
                    const secondChance = clamp(
                        0.50 +
                        (weightedSkill(secondTackler, TACKLE_SKILLS) - carrierSkill) * 0.0045,
                        0.25,
                        0.80
                    );

                    if (Math.random() < secondChance) {
                        addStat(secondTackler, 'tackles');
                        tackler = secondTackler;
                        contacted = true;
                    }
                }
            }
        }
    }

    yards = clamp(yards, -8, Math.max(0, maxGain));
    if (contacted && carrier && yards < maxGain && Math.random() < clamp(
        0.012 + (50 - getSkill(carrier, 'toughness')) * 0.00035 +
        (weightedSkill(tackler, TACKLE_SKILLS) - 50) * 0.00020,
        0.004,
        0.035
    )) {
        addStat(carrier, 'fumbles');
        addStat(carrier, 'fumblesLost');

        const recoverer = chooseTackler(defense, new Set(), playType) || tackler;
        addStat(recoverer, 'fumblesRecovered');

        // The recovered ball still needs a return and pursuit resolution.
        return {
            yards,
            turnover: true,
            returnYards: 0,
            returner: recoverer,
            tackler: recoverer
        };
    }

    return { yards, turnover: false, returnYards: 0, tackler };
}

function resolveTurnoverReturn(returner, opposingOffense, maxReturnYards = 30) {
    if (!returner) {
        return { returner: null, yards: 0, tackler: null };
    }

    const pursuers = [
        opposingOffense.qb,
        opposingOffense.rb,
        opposingOffense.wr1,
        opposingOffense.wr2,
        opposingOffense.te,
        ...(opposingOffense.ol || [])
    ].filter(Boolean);

    const returnSkill = weightedSkill(returner, BALL_CARRIER_SKILLS);

    // Speed, agility, and IQ influence how effectively the returner
    // identifies and exploits space.
    const returnLimit = clamp(Math.floor(maxReturnYards), 0, 30);

    let yards = clamp(
        Math.round(
            roll(0, 7) +
            (getSkill(returner, 'speed') - 50) * 0.09 +
            (getSkill(returner, 'agility') - 50) * 0.04 +
            (getSkill(returner, 'playbookIQ') - 50) * 0.04 +
            (getMovementAccelerationRating(returner) - 50) * 0.02 +
            noise(3)
        ),
        0,
        Math.min(24, returnLimit)
    );

    const pursuit = { all: pursuers };
    let tackler = chooseTackler(pursuit);

    if (tackler) {
        const pursuitSkill = weightedSkill(tackler, TACKLE_SKILLS);
        const tackleChance = clamp(
            0.58 + (pursuitSkill - returnSkill) * 0.004,
            0.25,
            0.88
        );

        if (Math.random() < tackleChance) {
            addStat(tackler, 'tackles');
        } else {
            // The first pursuer misses; the return creates another contest.
            yards += roll(2, 6);

            const secondTackler = chooseTackler(
                pursuit,
                new Set([tackler.id])
            );

            if (secondTackler) {
                const secondChance = clamp(
                    0.50 +
                    (weightedSkill(secondTackler, TACKLE_SKILLS) - returnSkill) * 0.004,
                    0.25,
                    0.80
                );

                if (Math.random() < secondChance) {
                    addStat(secondTackler, 'tackles');
                    tackler = secondTackler;
                }
            }
        }
    }

    yards = clamp(Math.round(yards), 0, returnLimit);
    addStat(returner, 'returnYards', yards);

    return { returner, yards, tackler };
}

function choosePrimaryReceiver(receivers, offense) {
    const weighted = [
        { player: offense.wr1, weight: 0.40 },
        { player: offense.wr2, weight: 0.26 },
        { player: offense.te, weight: 0.20 },
        { player: offense.rb, weight: 0.14 }
    ].filter(entry => entry.player && receivers.some(p => p.id === entry.player.id));

    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    let ticket = Math.random() * total;
    for (const entry of weighted) {
        ticket -= entry.weight;
        if (ticket <= 0) return entry.player;
    }
    return receivers[0] || null;
}

function matchupForReceiver(receiver, offense, defense, blitzing) {
    let defender = null;
    if (receiver?.id === offense.wr1?.id) defender = defense.dbs[0];
    else if (receiver?.id === offense.wr2?.id) defender = defense.dbs[1] || defense.dbs[0];
    else if (receiver?.id === offense.te?.id) defender = defense.lbs[1] || defense.dbs[2] || defense.lbs[0];
    else defender = defense.lbs[0] || defense.dbs[2] || defense.dls[0];

    defender = defender || chooseTackler(defense, new Set(), 'pass');
    const routeSkill = weightedSkill(receiver, ROUTE_SKILLS);
    const coverSkill = weightedSkill(defender, COVER_SKILLS);
    const freeSafety = defense.dbs.find(player => player && player.id !== defense.dbs[0]?.id && player.id !== defense.dbs[1]?.id);
    const safetySkill = weightedSkill(freeSafety, COVER_SKILLS);
    const safetyHelp = blitzing ? 0 : Math.max(0, (safetySkill - 50) * 0.14);

    // Route skill and coverage/IQ establish the initial window; safety recognition can close it.
    const separation = clamp(
        50 + (routeSkill - coverSkill) * 0.48 + noise(14) - safetyHelp,
        8,
        92
    );
    const targetValue = separation * 0.70 + getSkill(receiver, 'catchingHands') * 0.20 +
        getSkill(receiver, 'speed') * 0.10;

    return { receiver, defender, separation, targetValue };
}

function resolveScramble(qb, defense, maxGain) {
    addStat(qb, 'rushAttempts');
    const scrambleSkill = weightedSkill(qb, {
        speed: 0.35, agility: 0.25, playbookIQ: 0.20, toughness: 0.10, strength: 0.10
    });
    const yards = Math.round(
        1 +
        (scrambleSkill - 50) * 0.07 +
        (getMovementAccelerationRating(qb) - 50) * 0.025 +
        noise(4)
    );
    const contact = finishBallCarrier(qb, defense, yards, maxGain);
    addStat(qb, 'rushYards', contact.yards);
    return { type: 'run', runner: qb, scorer: qb, ...contact };
}

function resolveRunPlay(offenseTeam, offense, defense, ballOn, down, yardsToGo) {
    const runner = offense.rb || offense.qb;
    if (!runner) return { type: 'incomplete', yards: 0, turnover: false };

    // PHASE 1: Resolve individual OL-vs-DL matchups.
    const blockers = (offense.ol || []).filter(Boolean);
    const frontDefenders = (defense.dls || []).filter(Boolean);
    const linebackerSkill = averageSkill(defense.lbs, RUN_DEFENSE_SKILLS);
    const runnerSkill = weightedSkill(runner, BALL_CARRIER_SKILLS);
    const runnerRole =
        offense.rb && runner.id === offense.rb.id ? 'RB' : 'QB';
    const runnerIQ = getDecisionQuality(runner, runnerRole);

    let winsAtPointOfAttack = false;

    if (blockers.length > 0 && frontDefenders.length > 0) {
        const matchupResults = blockers.map((blocker, index) => {
            const defender = frontDefenders[index];

            // Extra blockers can help, but each defensive lineman gets
            // an individual contest before the runner chooses a path.
            if (!defender) {
                return { blocker, defender: null, wins: true };
            }

            const blockingSkill = weightedSkill(blocker, BLOCK_SKILLS);
            const assignmentDiscipline = getAssignmentDiscipline(blocker, 'OL');
            const effectiveBlockingSkill =
                (blockingSkill * 0.85) + (assignmentDiscipline * 0.15);
            const runDefenseSkill = weightedSkill(defender, RUN_DEFENSE_SKILLS);

            const winChance = clamp(
                0.52 + (effectiveBlockingSkill - runDefenseSkill) * 0.005,
                0.24,
                0.80
            );

            return {
                blocker,
                defender,
                wins: Math.random() < winChance
            };
        });

        const blockWins = matchupResults.filter(matchup => matchup.wins).length;
        const blockLosses = matchupResults.length - blockWins;
        const unblockedRushers = Math.max(
            0,
            frontDefenders.length - blockers.length
        );

        // A clear majority opens the initial lane. A tie is a contested
        // result rather than an automatic win for either side.
        const blockingMargin = blockWins - blockLosses - unblockedRushers;

        winsAtPointOfAttack = blockingMargin > 0 ||
            (blockingMargin === 0 && Math.random() < 0.30);
    } else {
        // Preserve a usable fallback for incomplete or unusual lineups.
        const lineSkill = averageSkill(blockers, BLOCK_SKILLS);
        const frontSkill = averageSkill(frontDefenders, RUN_DEFENSE_SKILLS);
        const blockWinChance = clamp(
            0.52 + (lineSkill - frontSkill) * 0.004,
            0.34,
            0.72
        );

        winsAtPointOfAttack = Math.random() < blockWinChance;
    }

    // PHASE 2: Linebackers read the run and may close the initial lane.
    const linebackerIQ = averageDecisionQuality(defense.lbs);
    const linebackerFillChance = clamp(
        0.20 +
        (linebackerSkill - runnerSkill) * 0.003 +
        (linebackerIQ - runnerIQ) * 0.0015,
        0.05,
        0.50
    );

    if (
        winsAtPointOfAttack &&
        defense.lbs.length > 0 &&
        Math.random() < linebackerFillChance
    ) {
        winsAtPointOfAttack = false;
    }

    const seesCutback = !winsAtPointOfAttack && Math.random() < clamp(
        0.30 + (runnerIQ - 50) * 0.006 + (getSkill(runner, 'agility') - 50) * 0.003,
        0.08,
        0.72
    );

    let baseYards = winsAtPointOfAttack ? roll(2, 7) : roll(-1, 3);
    if (seesCutback) baseYards += roll(2, 4);
    baseYards += Math.round(
        (weightedSkill(runner, BALL_CARRIER_SKILLS) - 55) * 0.07 +
        (getMovementAccelerationRating(runner) - 50) * 0.025 +
        noise(2)
    );

    if (down >= 3 && yardsToGo >= 6 && !winsAtPointOfAttack && runnerIQ < 45) {
        baseYards -= 1; // Low recognition makes a late cutback less likely to succeed.
    }

    const maxGain = Math.max(0, 100 - ballOn);
    const contact = finishBallCarrier(runner, defense, baseYards, maxGain);
    addStat(runner, 'rushAttempts');
    addStat(runner, 'rushYards', contact.yards);

    return { type: 'run', runner, scorer: runner, ...contact };
}

function resolvePassPlay(offenseTeam, offense, defense, ballOn, down, yardsToGo) {
    const qb = offense.qb;
    if (!qb) return resolveRunPlay(offenseTeam, offense, defense, ballOn, down, yardsToGo);

    const defenseIQ = averageDecisionQuality([
        ...defense.dbs,
        ...defense.lbs
    ]);
    const qbIQ = getSkill(qb, 'playbookIQ');
    const qbDecisionQuality = getDecisionQuality(qb, 'QB');
    const blitzChance = down >= 3 && yardsToGo >= 6 ? 0.25 : 0.10;
    const blitzing = Math.random() < blitzChance;

    // PHASE 1: Resolve individual pass-protection matchups.
    const blockers = (offense.ol || []).filter(Boolean);
    const passRushers = (defense.dls || [])
        .filter(Boolean)
        .map(player => ({ player, isBlitzer: false }));

    // A blitz adds a linebacker as another potential source of pressure.
    if (blitzing) {
        const blitzer = (defense.lbs || [])
            .filter(Boolean)
            .sort((a, b) =>
                weightedSkill(b, RUSH_SKILLS) -
                weightedSkill(a, RUSH_SKILLS)
            )[0];

        if (blitzer) {
            passRushers.push({ player: blitzer, isBlitzer: true });
        }
    }

    // A QB who recognizes pressure helps the offense anticipate the rush,
    // without simply overriding the individual blocker-vs-rusher contests.
    const recognitionAdjustment = clamp(
        (qbIQ - 50) * 0.0005,
        -0.02,
        0.02
    );

    let noPressureChance = 1;

    passRushers.forEach(({ player: rusher, isBlitzer }, index) => {
        const blocker = blockers[index];
        let matchupPressureChance;

        if (!blocker) {
            // An unblocked rusher is dangerous, but pressure is not automatic.
            matchupPressureChance = isBlitzer ? 0.18 : 0.12;
        } else {
            const blockingSkill = weightedSkill(blocker, BLOCK_SKILLS);
            const assignmentDiscipline = getAssignmentDiscipline(blocker, 'OL');
            const effectiveBlockingSkill =
                (blockingSkill * 0.85) + (assignmentDiscipline * 0.15);
            const rushSkill = weightedSkill(rusher, RUSH_SKILLS);

            matchupPressureChance = clamp(
                0.08 +
                (rushSkill - effectiveBlockingSkill) * 0.0035 +
                (isBlitzer ? 0.015 : 0) -
                recognitionAdjustment,
                0.02,
                0.32
            );
        }

        // Every matchup changes the overall chance that the QB is pressured.
        noPressureChance *= 1 - matchupPressureChance;
    });

    const pressureChance = clamp(1 - noPressureChance, 0, 0.95);
    const pressured = Math.random() < pressureChance;

    // Keep the existing aggregate rush estimate for sack-severity calculations.
    const rushThreat = averageSkill(defense.dls, RUSH_SKILLS) +
        (blitzing ? 7 : 0);

    // PHASE 1: protection determines whether the QB can finish his reads.
    if (pressured) {
        const escapeChance = clamp(
            0.10 + (getSkill(qb, 'speed') - 50) * 0.003 + (qbIQ - 50) * 0.002,
            0.03,
            0.40
        );
        if (Math.random() < escapeChance) return resolveScramble(qb, defense, Math.max(0, 100 - ballOn));

        const sackChance = clamp(0.16 + (rushThreat - getSkill(qb, 'agility')) * 0.002, 0.08, 0.30);
        if (Math.random() < sackChance) {
            const rusher = [...defense.dls, ...defense.lbs]
                .filter(Boolean)
                .sort((a, b) => weightedSkill(b, RUSH_SKILLS) - weightedSkill(a, RUSH_SKILLS))[0];
            if (rusher) {
                addStat(rusher, 'sacks');
                addStat(rusher, 'tackles');
            }
            return { type: 'sack', yards: -roll(2, 7), turnover: false, tackler: rusher };
        }
    }

    // Reaching this phase means the QB kept the ball and is attempting a pass.
    addStat(qb, 'passAttempts');

    // PHASE 2: receivers and coverage are matched to establish each throwing window.
    const receivers = offense.receivers.filter(Boolean);
    if (receivers.length === 0) return { type: 'incomplete', yards: 0, turnover: false };

    const primary = choosePrimaryReceiver(receivers, offense);
    const evaluations = new Map();
    const evaluate = receiver => {
        if (!evaluations.has(receiver.id)) {
            const matchup = matchupForReceiver(receiver, offense, defense, blitzing);
            if (pressured) matchup.separation = Math.max(5, matchup.separation - 8);
            evaluations.set(receiver.id, matchup);
        }
        return evaluations.get(receiver.id);
    };

    // PHASE 3: IQ controls progression. Low-IQ QBs are more likely to lock on;
    // high-IQ QBs more often recognize a better window or avoid a covered target.
    let chosen = evaluate(primary);
    const readOrder = receivers.filter(player => player.id !== primary.id);
    for (const receiver of readOrder) {
        const recognitionChance = clamp(
            0.35 + (qbDecisionQuality - 50) * 0.007,
            0.08,
            0.75
        );
        if (Math.random() > recognitionChance) continue;
        const candidate = evaluate(receiver);
        const switchMargin = 8 - (qbDecisionQuality - 50) * 0.08;
        if (candidate.targetValue > chosen.targetValue + switchMargin) chosen = candidate;
    }

    const target = chosen.receiver;
    addStat(target, 'targets');
    const coverageIQPenalty = Math.max(0, (defenseIQ - 50) * 0.0008);
    const accuracy = getSkill(qb, 'throwingAccuracy');
    const maxGain = Math.max(0, 100 - ballOn);

    // Establish the intended target depth before resolving the throw.
    // Interceptions use this location; completions add yards after the catch.
    const intendedAirYards = clamp(
        Math.round(4 + Math.random() * 9 + (chosen.separation - 50) * 0.10),
        2,
        18
    );
    const interceptionSpotYards = Math.min(maxGain, intendedAirYards);

    // PHASE 4: the QB executes the throw; pressure and a tight window reduce accuracy.
    const onTargetChance = clamp(
        0.74 + (accuracy - 50) * 0.0035 + (chosen.separation - 50) * 0.0025 -
        (pressured ? 0.09 : 0) - coverageIQPenalty,
        0.40,
        0.92
    );

    // PHASE 4A: Establish whether the throw is on target.
    const passOnTarget = Math.random() <= onTargetChance;

    // PHASE 4B: The defender contests every throw, not just inaccurate ones.
    const defenderCoverageSkill = weightedSkill(chosen.defender, COVER_SKILLS);
    const defenderHands = getSkill(chosen.defender, 'catchingHands');

    const interceptionChance = clamp(
        0.004 +
        Math.max(0, 48 - chosen.separation) * 0.0018 +
        Math.max(0, defenderCoverageSkill - 50) * 0.0009 +
        Math.max(0, defenderHands - 50) * 0.00045 +
        Math.max(0, 50 - accuracy) * 0.00035 +
        (pressured ? 0.008 : 0) +
        (!passOnTarget ? 0.025 : 0),
        0.002,
        0.12
    );

    if (chosen.defender && Math.random() < interceptionChance) {
        addStat(qb, 'interceptionsThrown');
        addStat(chosen.defender, 'interceptions');

        // Return yards are credited later, after resolving pursuit.
        return {
            type: 'interception',
            yards: interceptionSpotYards,
            turnover: true,
            returnYards: 0,
            returner: chosen.defender,
            tackler: chosen.defender
        };
    }

    // An inaccurate pass that isn't intercepted falls incomplete.
    if (!passOnTarget) {
        return { type: 'incomplete', yards: 0, turnover: false, target };
    }

    // PHASE 5: catching is a separate matchup; a good throw can still be dropped or contested.
    const hands = getSkill(target, 'catchingHands');
    const defenderCoverage = weightedSkill(chosen.defender, COVER_SKILLS);
    const catchChance = clamp(
        0.73 + (hands - 50) * 0.0035 + (chosen.separation - 50) * 0.002 -
        (defenderCoverage - 50) * 0.0015,
        0.45,
        0.93
    );

    if (Math.random() > catchChance) {
        if (Math.random() < clamp(0.25 + (55 - hands) * 0.012, 0.05, 0.75)) addStat(target, 'drops');
        return { type: 'incomplete', yards: 0, turnover: false, target };
    }

    addStat(qb, 'passCompletions');
    addStat(target, 'receptions');
    const initialYac = clamp(
        Math.round(
            1 +
            (getSkill(target, 'speed') - 50) * 0.04 +
            (getSkill(target, 'agility') - 50) * 0.025 +
            (getMovementAccelerationRating(target) - 50) * 0.02 +
            noise(3)
        ),
        0,
        10
    );
    const contact = finishBallCarrier(
        target,
        defense,
        Math.min(maxGain, intendedAirYards + initialYac),
        maxGain,
        'pass'
    );
    addStat(qb, 'passYards', contact.yards);
    addStat(target, 'recYards', contact.yards);

    return { type: 'pass', passer: qb, scorer: target, target, ...contact };
}

function scoreTouchdown(team, outcome, homeTeam, awayTeam, scores) {
    if (team.id === homeTeam.id) scores.home += 6;
    else scores.away += 6;

    // A youth extra point is highly likely but not automatic.
    if (Math.random() < 0.94) {
        if (team.id === homeTeam.id) scores.home += 1;
        else scores.away += 1;
    }

    addStat(outcome.scorer, 'touchdowns');
    if (outcome.passer) addStat(outcome.passer, 'touchdowns');
}

function scoreSafety(team, outcome, homeTeam, scores) {
    if (team.id === homeTeam.id) scores.home += 2;
    else scores.away += 2;

    const safetyLeader = team.depthChart?.defense?.DL1;
    const fallbackDefender = getRosterObjects(team).find(
        player => player?.id === safetyLeader
    );

    addStat(outcome?.tackler || fallbackDefender, 'safeties');
}

/**
 * Simulate one youth-vs-youth game. Every outcome comes from ordered matchups;
 * player box scores are credited as those outcomes occur, before finalizing the game.
 */
export function simulateYouthMatch(homeTeam, awayTeam) {
    if (!homeTeam || !awayTeam || !Array.isArray(homeTeam.roster) || !Array.isArray(awayTeam.roster)) {
        return null;
    }

    resetGameStats(homeTeam, awayTeam);
    const home = buildLineup(homeTeam);
    const away = buildLineup(awayTeam);
    prepareStats(homeTeam);
    prepareStats(awayTeam);

    const scores = { home: 0, away: 0 };
    let offenseTeam = Math.random() < 0.5 ? homeTeam : awayTeam;
    let ballOn = 25;
    let down = 1;
    let yardsToGo = 10;
    let plays = 0;

    let quarter = 1;
    let clockRemaining = YOUTH_QUARTER_SECONDS;
    let isGameOver = false;

    function advanceYouthClock(outcome, nextBallOn) {
        const isScoringPlay = !outcome.turnover &&
            (nextBallOn >= 100 || nextBallOn <= 0);

        let clockBurn;

        if (outcome.type === 'incomplete') {
            clockBurn = roll(18, 25);
        } else if (outcome.turnover || isScoringPlay) {
            clockBurn = 40;
        } else {
            clockBurn = roll(30, 39);
        }

        clockRemaining = Math.max(0, clockRemaining - clockBurn);

        if (clockRemaining > 0) return;

        if (quarter < 4) {
            quarter++;
            clockRemaining = YOUTH_QUARTER_SECONDS;
            return;
        }

        if (quarter === 4 && scores.home === scores.away) {
            // One simplified overtime period; no frame-by-frame kickoff.
            quarter = 5;
            clockRemaining = YOUTH_OVERTIME_SECONDS;
            offenseTeam = Math.random() < 0.5 ? homeTeam : awayTeam;
            ballOn = 75;
            down = 1;
            yardsToGo = 10;
            return;
        }

        // End regulation if not tied, or end the one overtime period.
        isGameOver = true;
    }

    while (plays < YOUTH_GAME_PLAYS && !isGameOver) {
        const defenseTeam = offenseTeam.id === homeTeam.id ? awayTeam : homeTeam;
        const offenseLineup = offenseTeam.id === homeTeam.id ? home : away;
        const defenseLineup = defenseTeam.id === homeTeam.id ? home : away;
        recordSnaps({ offense: offenseLineup.offense, defense: defenseLineup.defense });

        // PHASE 0: situation and play call. IQ affects recognition/execution inside the play,
        // while down, distance, and field position influence whether the call is a run or pass.
        let passChance = 0.46;
        if (down >= 3 && yardsToGo >= 6) passChance += 0.20;
        if (down === 1) passChance -= 0.03;
        if (ballOn >= 80) passChance += 0.05;
                passChance += (
            getDecisionQuality(offenseLineup.offense.qb, 'QB') - 50
        ) * 0.001;
        passChance = clamp(passChance, 0.25, 0.78);

        const isPass = Math.random() < passChance;
        const outcome = isPass
            ? resolvePassPlay(offenseTeam, offenseLineup.offense, defenseLineup.defense, ballOn, down, yardsToGo)
            : resolveRunPlay(offenseTeam, offenseLineup.offense, defenseLineup.defense, ballOn, down, yardsToGo);

        const nextBallOn = ballOn + (Number(outcome.yards) || 0);
        plays++;

        // PHASE 6: resolve the result, change possession if needed, and update down/distance.
        if (!outcome.turnover && nextBallOn >= 100) {
            scoreTouchdown(offenseTeam, outcome, homeTeam, awayTeam, scores);
            offenseTeam = defenseTeam;
            ballOn = 25;
            down = 1;
            yardsToGo = 10;
            advanceYouthClock(outcome, nextBallOn);
            continue;
        }

        if (!outcome.turnover && nextBallOn <= 0) {
            scoreSafety(defenseTeam, outcome, homeTeam, scores);

            // The team that conceded the safety receives the ensuing
            // free kick. The youth engine simplifies this to possession
            // at its own 25-yard line.
            ballOn = 25;
            down = 1;
            yardsToGo = 10;
            advanceYouthClock(outcome, nextBallOn);
            continue;
        }

        if (outcome.turnover) {
            const returner = outcome.returner || outcome.tackler;
            const returnResult = resolveTurnoverReturn(
                returner,
                offenseLineup.offense,
                Math.max(0, nextBallOn)
            );

            const returnedBallOn =
                100 - nextBallOn + returnResult.yards;

            if (returnedBallOn >= 100) {
                scoreTouchdown(defenseTeam, {
                    scorer: outcome.returner || outcome.tackler,
                    passer: null
                }, homeTeam, awayTeam, scores);
                offenseTeam = defenseTeam;
                ballOn = 25;
            } else {
                offenseTeam = defenseTeam;
                ballOn = clamp(returnedBallOn, 5, 95);
            }

            down = 1;
            yardsToGo = 10;
            advanceYouthClock(outcome, nextBallOn);
            continue;
        }

        ballOn = clamp(nextBallOn, 1, 99);
        yardsToGo -= Number(outcome.yards) || 0;

        if (yardsToGo <= 0) {
            down = 1;
            yardsToGo = Math.min(10, 100 - ballOn);
        } else if (down >= 4) {
            offenseTeam = defenseTeam;
            ballOn = clamp(100 - ballOn, 5, 95);
            down = 1;
            yardsToGo = 10;
        } else {
            down++;
        }

        advanceYouthClock(outcome, nextBallOn);
    }

    finalizeGameResults(homeTeam, awayTeam, scores.home, scores.away);

    return {
        homeTeam,
        awayTeam,
        homeScore: scores.home,
        awayScore: scores.away,
        gameLog: [],
        plays,
        breakthroughs: []
    };
}