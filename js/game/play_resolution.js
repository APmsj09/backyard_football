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
    updateQBDecision, updatePunterDecision
} from './ai.js';
import {
    initPlayTelemetry, finalizePlayTelemetry
} from './telemetry.js';
import {
    captureFrame
} from './engine_helpers.js';
import {
    setupInitialPlayerStates, updatePlayerTargets
} from './play_execution.js';
import {
    autoMakeSubstitutions, checkCaptainDiscipline, aiSetDepthChart
} from './depth_chart.js';
import {
    offenseFormations, defenseFormations, offensivePlaybook, defensivePlaybook
} from '../data.js';
import { getRandom, getRandomInt } from '../utils.js';
import { updatePlayerPosition, getDistance } from './physics.js';
import { calculateOverall, estimateBestPosition } from './player.js';

const TICK_DURATION_SECONDS = 0.05;
const FIELD_WIDTH = 53.3;
const FIELD_LENGTH = 120;
const WEEKS_IN_SEASON = 9;

export function determinePuntDecision(down, yardsToGo, ballOn, offenseTeam = null, scoreDiff = 0, timeRemaining = 420) {
    if (down !== 4) return false;
    if (ballOn >= 60) return false; // In field goal / red zone territory

    // Trailing late in 4th quarter: always go for it
    if (timeRemaining < 180 && scoreDiff < 0) return false;

    const coach = offenseTeam?.staff?.coach || offenseTeam?.coach;
    const tactical = coach?.biases?.tactical?.name;
    const personality = coach?.biases?.personality?.name;
    const clockIQ = coach?.ratings?.clockIQ || 50;
    const gmDirective = offenseTeam?.gameplan?.gmDirective;

    // 1. Conservative Turtler / Has-Been Dad
    if (tactical === 'Conservative Turtler' || coach?.type === 'The Has-Been Dad') {
        if (yardsToGo > 1 || ballOn < 50) return true; // Punts conservatively
    }

    // 2. Aggressive Playground Alpha / Blitz Addict / Win-Now Directive
    if (tactical === 'Blitz Addict' || personality === "Peaked in '94" || gmDirective === 'WIN_NOW') {
        if (yardsToGo <= 3 && ballOn >= 38) return false; // Backyard gamble!
    }

    // Baseline rule
    if (yardsToGo <= 2 && ballOn > 42 && clockIQ > 45) return false;
    return true;
}

export function findAudiblePlay(offense, desiredType, desiredTag = null) {
    const offenseFormationName = offense.formations?.offense || 'Balanced';
    const basics = ['Uni_InsideZone', 'Uni_QuickSlants', 'Uni_FourVerts'];
    const installed = offense.gameplan?.installedOffense || [];
    const pool = Array.from(new Set([...basics, ...installed]));

    let possiblePlays = pool.filter(key => {
        const play = offensivePlaybook[key];
        if (!play) return false;
        const matchesType = play.type === desiredType;
        const matchesForm = !play.compatibleFormations || play.compatibleFormations.includes(offenseFormationName);
        return matchesType && matchesForm;
    });

    if (desiredTag && possiblePlays.length > 0) {
        const tagged = possiblePlays.filter(key => offensivePlaybook[key]?.tags?.includes(desiredTag));
        if (tagged.length > 0) return getRandom(tagged);
    }

    if (possiblePlays.length > 0) return getRandom(possiblePlays);
    return desiredType === 'pass' ? 'Uni_QuickSlants' : 'Uni_InsideZone';
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
    const coach = offense.coach;
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
    const isLong = yardsToGo >= 8;
    const isDesperation = drivesRemaining <= 2 && scoreDiff <= -8;
    const isChewClock = drivesRemaining <= 2 && scoreDiff >= 8;

    // Base run probability influenced by Head Coach tactical bias
    let runProbability = 0.55;

    const tacticalBias = offense.staff?.coach?.biases?.tactical;
    if (tacticalBias?.runModifier) {
        runProbability += tacticalBias.runModifier;
    } else if (coach?.type === 'Ground and Pound' || coach?.type === 'Trench Warfare') {
        runProbability += 0.20;
    } else if (coach?.type === 'Air Raid') {
        runProbability -= 0.20;
    }

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
    // Lore: Kids only call what's written on Coach's cafeteria napkin + the 3 Backyard Basics
    const BACKYARD_BASICS_OFF = ['Uni_InsideZone', 'Uni_QuickSlants', 'Uni_FourVerts'];
    const installed = offense.gameplan?.installedOffense || [];
    const activePlaybookKeys = Array.from(new Set([...BACKYARD_BASICS_OFF, ...installed]));

    // Match active playbook against current formation
    let candidateKeys = activePlaybookKeys.filter(key => {
        const p = offensivePlaybook[key];
        if (!p) return false;
        if (p.compatibleFormations) return p.compatibleFormations.includes(formationName);
        return key.startsWith(formationName) || key.startsWith('Uni_') || key.startsWith('PA_') || key.startsWith('RPO_') || key.startsWith('Trick_');
    });

    if (candidateKeys.length === 0) candidateKeys = BACKYARD_BASICS_OFF;

    // Ensure target history array exists
    if (!offense.recentTargets) offense.recentTargets = [];

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

        // ======================================================
        // 2. SITUATIONAL FOOTBALL
        // ======================================================
        // QB intelligence affects how strongly the AI responds
        // to situation, rather than directly forcing a player.
        if (isShort) {
            if (play.type === 'run' && tags.includes('inside')) {
                score += 30 * situationalWeight;
            }

            if (play.type === 'run' && tags.includes('power')) {
                score += 35 * situationalWeight;
            }

            if (play.type === 'pass' && tags.includes('short')) {
                score += 10 * situationalWeight;
            }
        }

        if (isLong) {
            if (play.type === 'run') {
                score -= 20 * situationalWeight;
            }

            if (tags.includes('deep')) {
                score += 30 * situationalWeight;
            } else if (tags.includes('medium')) {
                score += 18 * situationalWeight;
            }

            if (play.type === 'pass' && tags.includes('short')) {
                score -= 8 * situationalWeight;
            }
        }

        if (down === 1 && !isDesperation && !isChewClock) {
            if (play.type === 'run') {
                score += 8 * situationalWeight;
            }

            if (tags.includes('pa')) {
                score += 12 * situationalWeight;
            }
        }

        if (isGoalLine) {
            if (play.type === 'run') {
                score += 20 * situationalWeight;
            }

            if (tags.includes('short') || tags.includes('inside')) {
                score += 8 * situationalWeight;
            }
        }

        if (isBackedUp) {
            if (tags.includes('inside')) {
                score += 10 * situationalWeight;
            }

            if (tags.includes('short')) {
                score += 8 * situationalWeight;
            }

            if (tags.includes('deep')) {
                score -= 8 * situationalWeight;
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

export function determineDefensiveFormation(defense, offenseFormationName, down, yardsToGo, gameLog) {
    if (offenseFormationName === 'Punt') return 'Punt_Return';

    const captainIsSharp = checkCaptainDiscipline(defense, gameLog);
    const offData = offenseFormations[offenseFormationName];
    const personnel = offData ? offData.personnel : { WR: 2, RB: 1 };
    const wrCount = personnel.WR || 2;
    const heavyCount = (personnel.RB || 1) + (personnel.TE || 0);
    let coachPref = defense.coach?.preferredDefense || null;
    if (!coachPref || !defenseFormations[coachPref]) coachPref = null;

    const defEntries = Object.entries(defenseFormations);
    const pickMax = (scoreFn) => {
        let best = null; let bestScore = -Infinity;
        for (const [key, val] of defEntries) {
            const score = scoreFn(val);
            if (score > bestScore) { bestScore = score; best = key; }
        }
        return best;
    };

    if (captainIsSharp) {
        if (yardsToGo <= 2) {
            return pickMax(v => (v.personnel?.DL || 0) + (v.personnel?.LB || 0)) || coachPref || Object.keys(defenseFormations)[0];
        }
        if ((down === 3 && yardsToGo > 8) || (down === 4 && yardsToGo > 5)) {
            const candidate = pickMax(v => (v.personnel?.DB || 0));
            return candidate || coachPref || Object.keys(defenseFormations)[0];
        }
        if (wrCount >= 4) {
            const d4 = defEntries.find(([k, v]) => (v.personnel?.DB || 0) >= 4);
            return (d4 && d4[0]) || pickMax(v => (v.personnel?.DB || 0)) || coachPref || Object.keys(defenseFormations)[0];
        }
        if (heavyCount >= 3 || personnel.RB >= 2) {
            const heavy = pickMax(v => (v.personnel?.DL || 0) + (v.personnel?.LB || 0));
            return heavy || coachPref || Object.keys(defenseFormations)[0];
        }
        if (coachPref) return coachPref;
        return pickMax(v => -Math.abs((v.personnel?.DB || 0) - wrCount)) || Object.keys(defenseFormations)[0];
    } else {
        if (Math.random() < 0.5) {
            if (defense.formations?.defense === 'Punt_Return') return coachPref || Object.keys(defenseFormations)[0];
            return (defense.formations?.defense && defenseFormations[defense.formations.defense]) ? defense.formations.defense : (coachPref || Object.keys(defenseFormations)[0]);
        }
        const validFormations = Object.keys(defenseFormations).filter(key => key !== 'Punt_Return');
        return getRandom(validFormations);
    }
}

export function determineDefensivePlayCall(defense, offense, down, yardsToGo, ballOn, scoreDiff, gameLog, drivesRemaining) {
    const defenseFormationName = defense.formations.defense;
    // Lore: Defensive gameplan is restricted to installed schemes + Universal Safety Nets
    const BACKYARD_BASICS_DEF = ['Cover_2_Zone_Base', 'Cover_1_Robber', 'GoalLine_RunStuff'];
    const installedDef = defense.gameplan?.installedDefense || [];
    const activeDefKeys = Array.from(new Set([...BACKYARD_BASICS_DEF, ...installedDef]));

    let availablePlays = activeDefKeys.filter(key =>
        isPlayCompatibleWithDefense(defensivePlaybook[key], defenseFormationName)
    );

    if (availablePlays.length === 0) availablePlays = BACKYARD_BASICS_DEF;

    if (availablePlays.length === 0) return 'Cover_2_Zone_Base';

    const isGoalLine = ballOn >= 90;
    const isShort = yardsToGo <= 2;
    const isLong = yardsToGo >= 8;
    const captainIsSharp = checkCaptainDiscipline(defense, gameLog);

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

    let scoredPlays = availablePlays.map(key => {
        const play = defensivePlaybook[key];
        const tags = play.tags || [];
        let score = 50;

        // Opponent-specific adjustments
        if (isRunHeavyThreat && tags.includes('runStop')) score += 35; // Stack the box against star RBs
        if (isPassHeavyThreat && (tags.includes('cover2') || tags.includes('double-team') || tags.includes('cover4'))) score += 35; // Play shell against elite passing attacks

        // FIELD POSITION SANITY CHECKS:
        // Do not call Goal Line defense at midfield, and do not call Prevent in the red zone
        if (!isGoalLine && tags.includes('runStop') && key.includes('GoalLine')) {
            score -= 80; // Heavy penalty outside the red zone
        }
        if (ballOn >= 80 && tags.includes('prevent')) {
            score -= 100; // Never call Prevent inside the 20-yard line
        }

        if (captainIsSharp) {
            if (isGoalLine || isShort) {
                if (tags.includes('runStop')) score += 60;
                if (tags.includes('blitz')) score += 30;
            } else if (isLong) {
                if (tags.includes('prevent') && ballOn < 80) score += 60;
                if (tags.includes('cover3')) score += 25;
            }
        }
        return { key, score: Math.max(1, score) };
    });

    scoredPlays.sort((a, b) => b.score - a.score);
    const topOptions = scoredPlays.slice(0, 3);
    const totalScore = topOptions.reduce((sum, p) => sum + p.score, 0);

    let roll = Math.random() * totalScore;
    for (const option of topOptions) {
        if (roll < option.score) return option.key;
        roll -= option.score;
    }
    return topOptions[0].key;
}

export function resolvePlay(offense, defense, offensivePlayKey, defensivePlayKey, context, options, isLive = false) {
    const { gameLog = [], ballOn, ballHash = 'M', down, yardsToGo, offenseScore = 0, defenseScore = 0, timeRemaining = 420, quarter = 1 } = context;
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

    const audibleCheck = aiCheckAudible(offense, offensivePlayKey, defense, defensivePlayKey, gameLog);
    const finalOffensivePlayKey = audibleCheck.didAudible ? audibleCheck.playKey : offensivePlayKey;
    const play = JSON.parse(JSON.stringify(offensivePlaybook[finalOffensivePlayKey]));

    let playState = {
        playIsLive: true, tick: 0,
        visualizationFrames: isLive ? [] : null,
        maxTicks: 1000,
        type: play.type,
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

    initPlayTelemetry(context, playState, finalOffensivePlayKey, defensivePlayKey);

    try {
        setupInitialPlayerStates(playState, offense, defense, play, playState.assignments, ballOn, defensivePlayKey, ballHash, finalOffensivePlayKey);
        if (isLive && gameLog) {
            playState.visualizationFrames.push(captureFrame(playState, gameLog));
        }
    } catch (setupError) {
        playResult.outcome = 'turnover';
        playResult.possessionChange = true;
        return { playResult, finalBallY: ballOn, log: gameLog, visualizationFrames: [] };
    }

    let ballCarrierState = null;

    try {
        const timeDelta = TICK_DURATION_SECONDS;
        const loopType = playState.type || 'pass';

        const activeOffense = playState.activePlayers.filter(p => p.isOffense);
        const activeDefense = playState.activePlayers.filter(p => !p.isOffense);
        const qb1 = playState.activePlayers.find(p => p.slot === 'QB1');
        const rb1 = playState.activePlayers.find(p => p.slot === 'RB1');

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
                if (loopType === 'pass') {
                    updateQBDecision(qb1, activeOffense, activeDefense, playState, playState.assignments, gameLog);
                } else if (loopType === 'punt') {
                    updatePunterDecision(playState, activeOffense, gameLog);
                }
            }

            if (!playState.playIsLive) break;

            if (playState.handoffRequired && !playState.handoffOccurred) {
                if (qb1 && rb1) {
                    const qbDepth = playState.lineOfScrimmage - qb1.initialY;
                    const dist = getDistance(qb1, rb1);
                    const handoffTickThreshold = qbDepth < 4.0 ? 18 : 24;

                    if ((dist < 1.8 && playState.tick > 5) || (playState.tick >= handoffTickThreshold)) {
                        qb1.hasBall = false;
                        rb1.hasBall = true;
                        rb1.isBallCarrier = true;
                        playState.handoffOccurred = true;
                        qb1.ghostTicks = 25;
                        rb1.ghostTicks = 25;
                        rb1.contactReduction = 1.2;
                        rb1.action = 'run_path';
                    } else {
                        qb1.targetX = qb1.initialX + (rb1.initialX > qb1.initialX ? 1 : -1);
                        qb1.targetY = qbDepth < 4.0 ? (playState.lineOfScrimmage - 4.5) : (qb1.initialY + 1.0);
                        qb1.action = 'handoff_setup';
                        rb1.targetX = qb1.targetX;
                        rb1.targetY = qb1.targetY;
                    }
                }
            }

            updatePlayerTargets(
                playState, activeOffense, activeDefense, ballCarrierState,
                loopType, finalOffensivePlayKey, playState.assignments, defensivePlayKey, gameLog
            );

            playState.activePlayers.forEach(p => {
                try { updatePlayerPosition(p, timeDelta, playState.activePlayers); } catch (e) { }
            });

            if (ballPos.inAir || (ballPos.isLoose && playState.type === 'punt')) {
                ballPos.prevX = ballPos.x;
                ballPos.prevY = ballPos.y;
                ballPos.prevZ = ballPos.z;

                ballPos.x += (ballPos.vx || 0) * timeDelta;
                ballPos.y += (ballPos.vy || 0) * timeDelta;
                ballPos.z += (ballPos.vz || 0) * timeDelta;
                ballPos.vz = (ballPos.vz || 0) - 9.8 * timeDelta;

                ballPos.x = Math.max(-10.0, Math.min(FIELD_WIDTH + 10.0, ballPos.x));
                ballPos.y = Math.max(-10.0, Math.min(FIELD_LENGTH + 10.0, ballPos.y));

                handleBallArrival(playState, ballCarrierState, playResult, gameLog);

                if (ballPos.z < 0) {
                    ballPos.z = 0;
                    if (ballPos.vz <= 0) {
                        ballPos.vz = 0;
                        if (ballPos.inAir) {
                            ballPos.inAir = false;
                            if (playState.type === 'punt') ballPos.isLoose = true;
                        }
                    }
                }
            } else if (ballCarrierState) {
                ballPos.x = ballCarrierState.x;
                ballPos.y = ballCarrierState.y;
                ballPos.z = 0.5;
                ballPos.x = Math.max(0.5, Math.min(FIELD_WIDTH - 0.5, ballPos.x));
                ballPos.y = Math.max(0.0, Math.min(FIELD_LENGTH, ballPos.y));
            }

            resolvePlayerCollisions(playState);

            if (playState.playIsLive) {
                ballCarrierState = playState.activePlayers.find(p => p.hasBall || p.isBallCarrier);

                if (ballCarrierState) {
                    if (ballCarrierState.isOffense && ballCarrierState.y >= 110.0) {
                        playState.touchdown = true;
                        playState.playIsLive = false;
                        ballCarrierState.y = 110.0;
                        playState.finalBallY = 110.0;
                        playState.yards = 110.0 - playState.lineOfScrimmage;
                        if (gameLog) gameLog.push(`🎉 TOUCHDOWN ${ballCarrierState.name}!`);
                        playState.statEvents.push({ type: 'touchdown', playerId: ballCarrierState.id });
                        if (playState.type === 'pass' && !playState.fumbleOccurred) {
                            playState.statEvents.push({ type: 'pass_td', qbId: playState.ballState.throwerId });
                        }
                        break;
                    }
                    if (!ballCarrierState.isOffense && ballCarrierState.y <= 10.0) {
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
                    const wentOutSideline = ball.x <= 0 || ball.x >= FIELD_WIDTH;
                    if (wentOutSideline) {
                        playState.finalBallY = ball.y;
                    } else {
                        if (ball.y >= 110) {
                            playState.finalBallY = 110;
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
                        playState.ballState.isLoose = false;
                        playState.ballState.inAir = false;
                        recPlayer.hasBall = true;
                        recPlayer.isBallCarrier = true;
                        recPlayer.action = 'run_path';
                        ballCarrierState = recPlayer;
                        playState.possessionChanged = recovery.possessionChange;
                        playState.returnStartY = recPlayer.y;
                        if (gameLog) gameLog.push(`🏈 ${recPlayer.name} recovers!`);
                        playState.statEvents.push({ type: 'fumble_recovery', playerId: recPlayer.id });
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
        console.error("Simulation Loop Crash:", e);
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
                // Assign sack to the nearest unblocked defender
                const tacklerEvent = playState.statEvents.find(e => e.type === 'tackle');
                if (tacklerEvent) {
                    playState.statEvents.push({ type: 'sack', playerId: tacklerEvent.playerId, qbId: ballCarrierState.id });
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
        completionEvent.yards = playState.yards;
    }

    playResult.yards = Math.round(playState.yards);
    if (playState.sack) playResult.yards = Math.min(0, playResult.yards);

    if (playState.incomplete) {
        playResult.outcome = 'incomplete';
        playResult.yards = 0;
        playState.finalBallY = playState.lineOfScrimmage;
    } else if (playState.touchdown) {
        playResult.outcome = 'complete';
        playResult.score = 'TD';
        playResult.defensiveTD = playState.defensiveTD || false;
    } else if (playState.safety) {
        playResult.safety = true;
        playResult.score = 'SAFETY';
    }

    if (playState.possessionChanged || playState.turnover || playState.type === 'punt') {
        playResult.outcome = 'turnover';
        playResult.possessionChange = true;
        if (playState.interceptionOccurred) playResult.turnoverType = 'interception';
        else if (playState.fumbleOccurred) playResult.turnoverType = 'fumble';
        else if (playState.type === 'punt') playResult.turnoverType = 'punt';
        else if (!playResult.turnoverType && down === 4) playResult.turnoverType = 'downs';
    }

    applyStatEvents(playState.statEvents);

    playState.activePlayers.forEach(p => {
        const player = getPlayer(p.id);
        if (player) {
            if (!player.careerStats) player.careerStats = { seasonsPlayed: 0 };
            player.careerStats.snapsThisSeason = (player.careerStats.snapsThisSeason || 0) + 1;

            // PASSIVE HUDDLE RECOVERY: Players catch their breath between plays based on their stamina rating
            const staminaRating = player.attributes?.physical?.stamina || 50;
            const recoveryAmt = 1.5 + (staminaRating / 25); // Recovers roughly 3.5% to 5.5% fatigue per play
            player.fatigue = Math.max(0, (player.fatigue || 0) - recoveryAmt);
        }
    });

    // BACKYARD CLOCK BURN: Plays take time to set up, kids have to retrieve incomplete passes from the bushes
    let clockBurn = Math.floor(Math.random() * 10) + 30; // 30 to 39 seconds for a normal play + huddle
    if (playState.incomplete) clockBurn = Math.floor(Math.random() * 8) + 18; // Even an incompletion burns 18-25 secs fetching the ball
    else if (playResult.possessionChange || playState.touchdown || playState.safety) clockBurn = 40; // Turnovers take a while to reset

    // Late 4th quarter hurry-up offense (if losing)
    const isLateTrailing = quarter >= 4 && timeRemaining < 120 && scoreDiff < 0;
    if (isLateTrailing) clockBurn = Math.floor(clockBurn * 0.6);

    playResult.clockBurn = clockBurn;

    finalizePlayTelemetry(playResult, playState.finalBallY);

    return {
        playResult,
        finalBallY: playState.finalBallY,
        log: gameLog,
        visualizationFrames: isLive ? playState.visualizationFrames : []
    };
}

export function simulateLivePlayStep(gameInstance, mode = 'live') {
    const isLive = mode === 'live';
    if (!gameInstance || !gameInstance.possession || !gameInstance.homeTeam || !gameInstance.awayTeam) {
        return { playResult: { outcome: 'error' }, finalBallY: 35, log: [], visualizationFrames: [] };
    }

    const offense = gameInstance.possession;
    const defense = (offense.id === gameInstance.homeTeam.id) ? gameInstance.awayTeam : gameInstance.homeTeam;

    if (!offense.formations) offense.formations = { offense: 'Balanced', defense: '3-2-3 Base' };
    if (!defense.formations) defense.formations = { offense: 'Balanced', defense: '3-2-3 Base' };

    let offPlayKey = '';
    let defPlayKey = '';

    // Remember custom user schemes before special-teams overrides
    if (!offense._savedOffForm && offense.formations.offense !== 'Punt') {
        offense._savedOffForm = offense.formations.offense;
    }

    if (gameInstance.isConversionAttempt) {
        gameInstance.down = 1; gameInstance.yardsToGo = 3; gameInstance.ballOn = 97;
        offPlayKey = 'Uni_QuickSlants'; defPlayKey = 'GoalLine_RunStuff';
    } else if (determinePuntDecision(gameInstance.down, gameInstance.yardsToGo, gameInstance.ballOn, offense, (offense.id === gameInstance.homeTeam.id ? (gameInstance.homeScore - gameInstance.awayScore) : (gameInstance.awayScore - gameInstance.homeScore)), gameInstance.clock)) {
        offense.formations.offense = 'Punt'; 
        defense.formations.defense = 'Punt_Return';
        offPlayKey = 'Punt_Punt'; 
        defPlayKey = 'PuntReturn_Classic';
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
            offense.formations.offense = offense._savedOffForm || offense.coach?.preferredOffense || 'Balanced';
        }
        if (!offense.isPlayerControlled) {
            offense.formations.offense = offense.coach?.preferredOffense || 'Balanced';
        }

        offPlayKey = determinePlayCall(offense, defense, gameInstance.down, gameInstance.yardsToGo, gameInstance.ballOn, scoreDiff, gameInstance.gameLog, drivesRemaining);
        if (!offPlayKey || !offensivePlaybook[offPlayKey]) offPlayKey = 'Uni_InsideZone';

        if (defense.formations.defense === 'Punt_Return') {
            defense.formations.defense = defense.coach?.preferredDefense || '3-2-3';
        }
        if (!defense.isPlayerControlled) {
            defense.formations.defense = determineDefensiveFormation(defense, offense.formations.offense, gameInstance.down, gameInstance.yardsToGo, gameInstance.gameLog);
        }
        defPlayKey = determineDefensivePlayCall(defense, offense, gameInstance.down, gameInstance.yardsToGo, gameInstance.ballOn, scoreDiff, gameInstance.gameLog, drivesRemaining);
    }

    const context = {
        gameLog: gameInstance.gameLog,
        weather: gameInstance.weather || 'Sunny',
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

    const result = resolvePlay(offense, defense, offPlayKey, defPlayKey, context, { fastSim: !isLive }, isLive);
    const { playResult, finalBallY } = result;

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
    } else if (playResult.score === 'TD') {
        let scoringTeam = offense;
        if (playResult.defensiveTD) {
            scoringTeam = defense;
            gameInstance.possession = defense;
        }
        if (scoringTeam.id === gameInstance.homeTeam.id) gameInstance.homeScore += 6;
        else gameInstance.awayScore += 6;
        gameInstance.isConversionAttempt = true;
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
        gameInstance.ballOn = 110 - finalBallY;
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

export function simulateMatchFast(homeTeam, awayTeam) {
    if (!homeTeam || !awayTeam) return null;
    resetGameStats(homeTeam, awayTeam);
    aiSetDepthChart(homeTeam);
    aiSetDepthChart(awayTeam);

    const matchGame = {
        homeTeam, awayTeam,
        homeScore: 0, awayScore: 0,
        possession: Math.random() < 0.5 ? homeTeam : awayTeam,
        ballOn: 35, down: 1, yardsToGo: 10,
        gameLog: [],
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

    finalizeGameResults(homeTeam, awayTeam, matchGame.homeScore, matchGame.awayScore);

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
