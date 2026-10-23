import { relationshipLevels } from '../data.js';

export let game = null;
export const playerMap = new Map();

export function setGame(g) {
    game = g;
    playerMap.clear();

    if (Array.isArray(g?.players)) {
        g.players.forEach(p => {
            if (p && p.id) {
                playerMap.set(p.id, p);
            }
        });
    }
}

export function getPlayer(id) {
    if (typeof playerMap !== 'undefined' && playerMap.has(id)) return playerMap.get(id);
    return game?.players?.find(p => p.id === id);
}

export function getGameState() { return game; }
export function getBreakthroughs() { return game?.breakthroughs || []; }

// --- Competition & Eligibility Helpers ---
export const getMainTeams = () => (game?.teams || []).filter(t => t.leagueType === 'main');
export const getPremierTeams = () => (game?.teams || []).filter(t => t.tier === 1);
export const getSandlotTeams = () => (game?.teams || []).filter(t => t.tier === 2);
export const getYouthTeams = () => (game?.teams || []).filter(t => t.leagueType === 'youth');

export const isYouthEligible = (player) => player.age >= 8 && player.age <= 11;
export const isDraftEligible = (player) => player.age === 12;

export function markMessageAsRead(messageId) {
    const message = game?.messages?.find(m => m && m.id === messageId);
    if (message) { message.isRead = true; }
}

export function addMessage(subject, body, isRead = false, gameObj = null) {
    const g = gameObj || game;
    if (!g || !g.messages) {
        console.error("Cannot add message: Game object or messages array not initialized.");
        return;
    }
    g.messages.unshift({ id: crypto.randomUUID(), subject, body, isRead });
}

export function getRelationshipLevel(p1Id, p2Id) {
    if (!p1Id || !p2Id || p1Id === p2Id) return relationshipLevels.STRANGER.level;
    const p1 = getPlayer(p1Id);
    if (!p1 || !p1.social) return relationshipLevels.STRANGER.level;
    
    if (p1.social.bestFriendId === p2Id) return relationshipLevels.BEST_FRIEND.level;
    if (p1.social.goodFriendIds.includes(p2Id)) return relationshipLevels.GOOD_FRIEND.level;
    if (p1.social.rivalIds.includes(p2Id)) return relationshipLevels.RIVAL.level;
    
    return relationshipLevels.STRANGER.level;
}

export function improveRelationship(p1Id, p2Id) {
    const p1 = getPlayer(p1Id); const p2 = getPlayer(p2Id);
    if (!p1 || !p2 || p1Id === p2Id) return;
    if (!p1.social) p1.social = { bestFriendId: null, goodFriendIds: [], rivalIds: [] };
    if (!p2.social) p2.social = { bestFriendId: null, goodFriendIds: [], rivalIds: [] };

    // If they are rivals, they squash the beef (become strangers)
    if (p1.social.rivalIds.includes(p2Id)) {
        p1.social.rivalIds = p1.social.rivalIds.filter(id => id !== p2Id);
        p2.social.rivalIds = p2.social.rivalIds.filter(id => id !== p1Id);
        return;
    }

    // If already best friends, do nothing
    if (p1.social.bestFriendId === p2Id) return;

    // Move to Best Friend if already Good Friends
    if (p1.social.goodFriendIds.includes(p2Id)) {
        if (!p1.social.bestFriendId && !p2.social.bestFriendId) {
            p1.social.bestFriendId = p2Id; p2.social.bestFriendId = p1Id;
            p1.social.goodFriendIds = p1.social.goodFriendIds.filter(id => id !== p2Id);
            p2.social.goodFriendIds = p2.social.goodFriendIds.filter(id => id !== p1Id);
        }
        return;
    }

    // Otherwise, become Good Friends
    if (!p1.social.goodFriendIds.includes(p2Id)) p1.social.goodFriendIds.push(p2Id);
    if (!p2.social.goodFriendIds.includes(p1Id)) p2.social.goodFriendIds.push(p1Id);
}

export function decreaseRelationship(p1Id, p2Id) {
    const p1 = getPlayer(p1Id); const p2 = getPlayer(p2Id);
    if (!p1 || !p2 || p1Id === p2Id) return;
    
    // Break Best Friendship
    if (p1.social.bestFriendId === p2Id) {
        p1.social.bestFriendId = null; p2.social.bestFriendId = null;
        p1.social.goodFriendIds.push(p2Id); p2.social.goodFriendIds.push(p1Id);
        return;
    }

    // Break Good Friendship
    if (p1.social.goodFriendIds.includes(p2Id)) {
        p1.social.goodFriendIds = p1.social.goodFriendIds.filter(id => id !== p2Id);
        p2.social.goodFriendIds = p2.social.goodFriendIds.filter(id => id !== p1Id);
        return;
    }

    // Become Rivals
    if (!p1.social.rivalIds.includes(p2Id)) p1.social.rivalIds.push(p2Id);
    if (!p2.social.rivalIds.includes(p1Id)) p2.social.rivalIds.push(p1Id);
}

export function getScoutedPlayerInfo(player, relationshipLevelNum) {
    if (!player) return null;

    const levelInfo = Object.values(relationshipLevels).find(rl => rl.level === relationshipLevelNum) || relationshipLevels.STRANGER;
    let accuracy = levelInfo.scoutAccuracy;

    // Park Scout Rating adjusts scouting clarity (+/- 15%).
    const userScout = game?.playerTeam?.staff?.scout;
    if (userScout) {
        const evalScore = (
            (userScout.ratings?.evalTechnique ?? 50) +
            (userScout.ratings?.evalPhysicals ?? 50)
        ) / 200;

        accuracy = accuracy + (evalScore - 0.5) * 0.3;
    }

    // The GM contributes general scouting ability and specialist knowledge.
    const gmProfile = game?.playerTeam?.gmProfile;

    accuracy += gmProfile?.bonuses?.scoutingAccuracy || 0;

    const actualPosition = player.pos || estimateBestPosition(player);

    if (gmProfile?.expertisePositions?.includes(actualPosition)) {
        accuracy += gmProfile.expertiseScoutingBonus || 0;
    }

    // Combine all scouting influences before concealing the player's attributes.
    accuracy = Math.min(1.0, Math.max(0.2, accuracy));

    const scoutedPlayer = JSON.parse(JSON.stringify(player));
    scoutedPlayer.relationshipName = levelInfo.name;
    scoutedPlayer.relationshipColor = levelInfo.color;

    if (accuracy < 1.0 && player.potential) {
        const potentialGrades = ['A', 'B', 'C', 'D', 'F'];
        const actualIndex = potentialGrades.indexOf(player.potential);
        if (actualIndex !== -1) {
            const range = Math.floor((1.0 - accuracy) * (potentialGrades.length / 2));
            const minIndex = Math.max(0, actualIndex - range);
            const maxIndex = Math.min(potentialGrades.length - 1, actualIndex + range);
            if (minIndex !== maxIndex) {
                scoutedPlayer.potential = `${potentialGrades[minIndex]}-${potentialGrades[maxIndex]}`;
            }
        } else { scoutedPlayer.potential = '?'; }
    }

    if (accuracy < 0.95 && scoutedPlayer.attributes) {
        const range = Math.round(15 * (1.0 - accuracy));
        for (const category in scoutedPlayer.attributes) {
            if (!scoutedPlayer.attributes[category]) continue;
            for (const attr in scoutedPlayer.attributes[category]) {
                if (['height', 'weight'].includes(attr)) continue;
                const actualValue = player.attributes[category]?.[attr];
                if (typeof actualValue === 'number') {
                    const lowBound = Math.max(1, actualValue - range);
                    const highBound = Math.min(99, actualValue + range);
                    if (highBound - lowBound > 1) {
                        scoutedPlayer.attributes[category][attr] = `${lowBound}-${highBound}`;
                    } else {
                        scoutedPlayer.attributes[category][attr] = actualValue;
                    }
                } else {
                    scoutedPlayer.attributes[category][attr] = "?";
                }
            }
        }
    }
        return scoutedPlayer;
}

const SCOUTING_REPORT_SCHEMA_VERSION = 1;

export const SCOUTING_REPORT_LEVELS = Object.freeze({
    UNSCOUTED: 0,
    INITIAL: 1,
    EVALUATED: 2,
    DETAILED: 3,
    FULL: 4
});

const EMPTY_SCOUTING_REPORTS = Object.freeze({});
const SCOUTING_OFFENSE_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'OL']);
const SCOUTING_DEFENSE_POSITIONS = new Set(['DL', 'LB', 'DB']);
const SCOUTING_POTENTIAL_GRADES = new Set(['A', 'B', 'C', 'D', 'F']);

function normalizeScoutingRange(range) {
    let low;
    let high;

    if (typeof range === 'number') {
        low = range;
        high = range;
    } else {
        if (range?.low == null || range?.high == null) return null;
        low = Number(range.low);
        high = Number(range.high);
    }

    if (!Number.isFinite(low) || !Number.isFinite(high)) return null;

    low = Math.max(1, Math.min(99, Math.round(low)));
    high = Math.max(1, Math.min(99, Math.round(high)));

    return {
        low: Math.min(low, high),
        high: Math.max(low, high)
    };
}

function normalizeScoutingAttributeRanges(attributeRanges) {
    if (!attributeRanges ||
        typeof attributeRanges !== 'object' ||
        Array.isArray(attributeRanges)) {
        return {};
    }

    const normalized = {};

    for (const [category, values] of Object.entries(attributeRanges)) {
        if (!values || typeof values !== 'object' || Array.isArray(values)) continue;

        const normalizedValues = {};

        for (const [attribute, range] of Object.entries(values)) {
            const normalizedRange = normalizeScoutingRange(range);
            if (normalizedRange) normalizedValues[attribute] = normalizedRange;
        }

        if (Object.keys(normalizedValues).length > 0) {
            normalized[category] = normalizedValues;
        }
    }

    return normalized;
}

function normalizeScoutingFit(fit, allowedPositions) {
    if (!fit ||
        typeof fit !== 'object' ||
        !allowedPositions.has(fit.position)) {
        return null;
    }

    const range = normalizeScoutingRange(fit);
    if (!range) return null;

    return {
        position: fit.position,
        low: range.low,
        high: range.high
    };
}

function normalizeScoutingNotes(notes) {
    if (!Array.isArray(notes)) return [];

    return notes
        .filter(note => typeof note === 'string' && note.trim())
        .slice(0, 5)
        .map(note => note.trim().slice(0, 160));
}

function normalizePotentialRange(range) {
    if (!range || typeof range !== 'object') return null;

    const bestPossible = range.bestPossible;
    const worstPossible = range.worstPossible;

    if (!SCOUTING_POTENTIAL_GRADES.has(bestPossible) ||
        !SCOUTING_POTENTIAL_GRADES.has(worstPossible)) {
        return null;
    }

    return { bestPossible, worstPossible };
}

/** Returns a team's scouting map without allocating or mutating state. */
export function getTeamScoutingReports(team) {
    const reports = team?.scoutingReports;

    return reports &&
        typeof reports === 'object' &&
        !Array.isArray(reports)
        ? reports
        : EMPTY_SCOUTING_REPORTS;
}

/** Returns a stored report or null when the player is unscouted. */
export function getTeamScoutingReport(team, playerId) {
    if (!team || playerId == null) return null;

    const reports = team.scoutingReports;

    if (!reports ||
        typeof reports !== 'object' ||
        Array.isArray(reports)) {
        return null;
    }

    const key = String(playerId);

    return Object.prototype.hasOwnProperty.call(reports, key)
        ? reports[key]
        : null;
}

const PUBLIC_PERFORMANCE_STAT_FIELDS = [
    'passAttempts',
    'passCompletions',
    'passYards',
    'interceptionsThrown',
    'rushAttempts',
    'rushYards',
    'receptions',
    'recYards',
    'targets',
    'drops',
    'tackles',
    'sacks',
    'interceptions',
    'fumbles',
    'fumblesLost',
    'fumblesRecovered',
    'returnYards',
    'touchdowns',
    'safeties'
];

function getPublicPerformanceStats(stats) {
    if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
        return null;
    }

    const result = {};

    for (const field of PUBLIC_PERFORMANCE_STAT_FIELDS) {
        const value = stats[field];

        if (Number.isFinite(value)) {
            result[field] = Math.max(0, Math.round(value));
        }
    }

    return Object.keys(result).length > 0 ? result : null;
}

/**
 * Returns public-facing player information without exposing hidden ratings,
 * potential, personality, or private development details.
 *
 * Intended for player dossiers and selected-player views, not bulk rendering
 * of every player in the draft pool.
 */
export function getPublicPlayerInfo(player) {
    if (!player) return null;

    const physical = player.attributes?.physical || {};
    const team = player.teamId != null
        ? (game?.teams || []).find(
            candidate => String(candidate.id) === String(player.teamId)
        )
        : null;

    const progression = Array.isArray(player.progression)
        ? player.progression
        : [];

    const recentSeasons = progression.slice(-5).map(season => {
        const stats = getPublicPerformanceStats(season?.stats);

        return {
            year: Number.isInteger(season?.year) ? season.year : null,
            age: Number.isInteger(season?.age) ? season.age : null,
            teamName: typeof season?.teamName === 'string'
                ? season.teamName
                : null,
            stats,
            hasRecordedStats: stats !== null
        };
    });

    const teamHistory = Array.isArray(player.playerHistory?.teamsPlayedFor)
        ? player.playerHistory.teamsPlayedFor
            .slice(-5)
            .map(entry => ({
                teamName: typeof entry?.teamName === 'string'
                    ? entry.teamName
                    : null,
                year: Number.isInteger(entry?.year) ? entry.year : null
            }))
        : [];

    const duration = Number(player.status?.duration) || 0;
    const statusType = player.status?.type || 'unknown';

    let availability = 'available';

    if (duration > 0) {
        availability = statusType === 'injured'
            ? 'injured'
            : 'unavailable';
    } else if (statusType === 'retired' || statusType === 'departed') {
        availability = statusType;
    } else if (statusType === 'temporary') {
        availability = 'temporary';
    }

    return {
        id: player.id,
        name: player.name,
        age: Number.isFinite(player.age) ? player.age : null,
        listedPosition: typeof player.pos === 'string'
            ? player.pos
            : null,
        currentTeamName: team?.name ||
            (player.teamId != null ? 'Unknown Team' : 'Free Agent / Draft Pool'),
        lastTeamName: recentSeasons[recentSeasons.length - 1]?.teamName ||
            teamHistory[teamHistory.length - 1]?.teamName ||
            null,
        height: Number.isFinite(physical.height) ? physical.height : null,
        weight: Number.isFinite(physical.weight) ? physical.weight : null,
        availability,
        weeksUnavailable: Math.max(0, Math.floor(duration)),
        seasonStats: getPublicPerformanceStats(player.seasonStats),
        careerStats: getPublicPerformanceStats(player.careerStats),
        seasonsPlayed: Number.isFinite(player.careerStats?.seasonsPlayed)
            ? Math.max(0, player.careerStats.seasonsPlayed)
            : 0,
        recentSeasons,
        teamHistory
    };
}

/** Stores a compact, team-owned scouting report. */
export function setTeamScoutingReport(team, playerId, report) {
    if (!team ||
        playerId == null ||
        !report ||
        typeof report !== 'object') {
        return false;
    }

    const level = Number(report.level);
    const confidence = Number(report.confidence);

    const existingReports = team.scoutingReports &&
        typeof team.scoutingReports === 'object' &&
        !Array.isArray(team.scoutingReports)
        ? team.scoutingReports
        : null;

    const reportKey = String(playerId);
    const existingReport = existingReports?.[reportKey] || null;
    const existingLevel = Number(existingReport?.level);
    const existingProgress = Number(existingReport?.progressPoints);

    const incomingProgress = Number(report.progressPoints);
    const progressPoints = report.progressPoints != null &&
        report.progressPoints !== '' &&
        Number.isFinite(incomingProgress)
        ? Math.max(0, incomingProgress)
        : Number.isFinite(existingProgress)
            ? Math.max(0, existingProgress)
            : 0;

    if (!Number.isInteger(level) || level < 0 || level > 4) return false;

    if (level === 0 && progressPoints <= 0) return false;

    if (existingReport &&
        Number.isInteger(existingLevel) &&
        level < existingLevel) {
        return false;
    }

    if (report.confidence == null || report.confidence === '') return false;

    if (!Number.isFinite(confidence) ||
        confidence < 0 ||
        confidence > 1) {
        return false;
    }

    if (!team.scoutingReports ||
        typeof team.scoutingReports !== 'object' ||
        Array.isArray(team.scoutingReports)) {
        team.scoutingReports = {};
    }

    const evaluation = report.evaluation &&
        typeof report.evaluation === 'object'
        ? report.evaluation
        : {};

    team.scoutingReports[reportKey] = {
        schemaVersion: SCOUTING_REPORT_SCHEMA_VERSION,
        level,
        progressPoints,
        confidence,
        attributeRanges: normalizeScoutingAttributeRanges(
            report.attributeRanges
        ),
        potentialRange: normalizePotentialRange(report.potentialRange),
        evaluation: {
            offenseFit: normalizeScoutingFit(
                evaluation.offenseFit,
                SCOUTING_OFFENSE_POSITIONS
            ),
            defenseFit: normalizeScoutingFit(
                evaluation.defenseFit,
                SCOUTING_DEFENSE_POSITIONS
            ),
            strengths: normalizeScoutingNotes(evaluation.strengths),
            concerns: normalizeScoutingNotes(evaluation.concerns),
            projectedRole: typeof evaluation.projectedRole === 'string'
                ? evaluation.projectedRole.slice(0, 80)
                : null,
            summary: typeof evaluation.summary === 'string'
                ? evaluation.summary.slice(0, 500)
                : null
        },
        evaluatorId: typeof report.evaluatorId === 'string'
            ? report.evaluatorId
            : null,
        evaluatedYear: Number.isInteger(report.evaluatedYear)
            ? report.evaluatedYear
            : null,
        evaluatedWeek: Number.isInteger(report.evaluatedWeek)
            ? report.evaluatedWeek
            : null
    };

    return true;
}

export function getRosterObjects(team) {
    if (!team || !Array.isArray(team.roster)) return [];

    if (playerMap.size === 0 && game && game.players) {
        game.players.forEach(p => {
            if (p && p.id) playerMap.set(p.id, p);
        });
    }

    const validIds = [];
    team.roster.forEach(id => {
        const p = playerMap.get(id);
        if (p) {
            validIds.push(id);
        }
    });

    team.roster = validIds;
    return team.roster.map(id => playerMap.get(id)).filter(Boolean);
}

export function ensureStats(player) {
    if (player && !player.gameStats) {
        player.gameStats = {
            passAttempts: 0, passCompletions: 0, passYards: 0, interceptionsThrown: 0,
            rushAttempts: 0, rushYards: 0,
            receptions: 0, recYards: 0, targets: 0, drops: 0,
            tackles: 0, sacks: 0, interceptions: 0, fumbles: 0, fumblesLost: 0, fumblesRecovered: 0, returnYards: 0,
            touchdowns: 0
        };
    }
}

export function checkInGameInjury(player, gameLog) {
    if (!player || !player.attributes || !player.attributes.mental || !player.status || player.status.duration > 0) return;
    const injuryChance = 0.008;
    const toughnessModifier = (100 - (player.attributes.mental.toughness || 50)) / 100;
    if (Math.random() < injuryChance * toughnessModifier) {
        const duration = Math.floor(Math.random() * 3) + 1;
        player.status.type = 'injured';
        player.status.description = 'Minor Injury';
        player.status.duration = duration;
        player.status.isNew = true;
        if (gameLog && Array.isArray(gameLog)) {
            gameLog.push(`🚑 INJURY: ${player.name} has suffered a minor injury and is out for the game (will miss ${duration} week(s)).`);
        }
    }
}

import { clearPlayTelemetry } from './telemetry.js';

export function resetGameStats(teamA, teamB) {
    clearPlayTelemetry();

    [teamA, teamB].filter(Boolean).forEach(team => {
        team.recentPlayHistory = [];
        team.playCallHistory = [];
    });

    const playersInGame = [...getRosterObjects(teamA), ...getRosterObjects(teamB)];
    playersInGame.forEach(player => {
        if (!player) return;
        player.fatigue = 0;
        player.isResting = false;
        player.gameStats = {
            receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0,
            tackles: 0, sacks: 0, interceptions: 0, fumbles: 0, fumblesLost: 0, fumblesRecovered: 0,
            passAttempts: 0, passCompletions: 0, interceptionsThrown: 0,
            rushAttempts: 0, targets: 0, returnYards: 0, drops: 0
        };
    });
}

export function applyStatEvents(statEvents) {
    statEvents.forEach(evt => {
        switch (evt.type) {
            case 'pass_attempt': {
                const qb = getPlayer(evt.qbId);
                if (qb) { ensureStats(qb); qb.gameStats.passAttempts++; }
                break;
            }
            case 'completion': {
                const qb = getPlayer(evt.qbId);
                const rec = getPlayer(evt.receiverId);
                const yards = Math.round(evt.yards || 0);
                if (qb) { ensureStats(qb); qb.gameStats.passCompletions++; qb.gameStats.passYards += yards; }
                if (rec) { ensureStats(rec); rec.gameStats.receptions++; rec.gameStats.recYards += yards; }
                break;
            }
            case 'drop': {
                const p = getPlayer(evt.playerId);
                if (p) { ensureStats(p); p.gameStats.drops = (p.gameStats.drops || 0) + 1; }
                break;
            }
            case 'target': {
                const p = getPlayer(evt.receiverId);
                if (p) { ensureStats(p); p.gameStats.targets = (p.gameStats.targets || 0) + 1; }
                break;
            }
            case 'interception': {
                const def = getPlayer(evt.interceptorId);
                const qb = getPlayer(evt.throwerId);
                if (def) { ensureStats(def); def.gameStats.interceptions++; }
                if (qb) { ensureStats(qb); qb.gameStats.interceptionsThrown++; }
                break;
            }
            case 'rush': {
                const runner = getPlayer(evt.runnerId);
                const yards = Math.round(evt.yards || 0);
                if (runner) { ensureStats(runner); runner.gameStats.rushAttempts++; runner.gameStats.rushYards += yards; }
                break;
            }
            case 'return': {
                const p = getPlayer(evt.playerId);
                const yards = Math.round(evt.yards || 0);
                if (p) { ensureStats(p); p.gameStats.returnYards += yards; }
                break;
            }
            case 'touchdown': {
                const p = getPlayer(evt.playerId);
                if (p) { ensureStats(p); p.gameStats.touchdowns++; }
                break;
            }
            case 'pass_td': {
                const qb = getPlayer(evt.qbId);
                if (qb) { ensureStats(qb); qb.gameStats.touchdowns++; }
                break;
            }
            case 'safety': {
                const p = getPlayer(evt.playerId);
                if (p) { ensureStats(p); p.gameStats.safeties = (p.gameStats.safeties || 0) + 1; }
                break;
            }
            case 'fumble': {
                const p = getPlayer(evt.playerId);
                if (p) { ensureStats(p); p.gameStats.fumbles++; }
                break;
            }
            case 'fumble_recovery': {
                const p = getPlayer(evt.playerId);
                if (p) { ensureStats(p); p.gameStats.fumblesRecovered++; }
                break;
            }
            case 'fumble_lost': {
                const p = getPlayer(evt.playerId);
                if (p) { ensureStats(p); p.gameStats.fumblesLost++; }
                break;
            }
            case 'tackle': {
                const p = getPlayer(evt.playerId);
                if (p) { ensureStats(p); p.gameStats.tackles = (p.gameStats.tackles || 0) + 1; }
                break;
            }
            case 'sack': {
                const p = getPlayer(evt.playerId);
                if (p) { ensureStats(p); p.gameStats.sacks = (p.gameStats.sacks || 0) + 1; }
                break;
            }
        }
    });
}

export function finalizeGameResults(homeTeam, awayTeam, homeScore, awayScore) {
    const masterHome = game.teams.find(t => t.id === homeTeam.id);
    const masterAway = game.teams.find(t => t.id === awayTeam.id);

    if (!masterHome || !masterAway) return;

    if (homeScore > awayScore) {
        masterHome.wins = (masterHome.wins || 0) + 1;
        masterAway.losses = (masterAway.losses || 0) + 1;
    } else if (awayScore > homeScore) {
        masterAway.wins = (masterAway.wins || 0) + 1;
        masterHome.losses = (masterHome.losses || 0) + 1;
    } else {
        masterHome.ties = (masterHome.ties || 0) + 1;
        masterAway.ties = (masterAway.ties || 0) + 1;
    }

    const allPlayerIds = [...(homeTeam.roster || []), ...(awayTeam.roster || [])];
    allPlayerIds.forEach(id => {
        const p = getPlayer(id);
        if (!p || !p.gameStats) return;

        if (!p.seasonStats) p.seasonStats = {};
        if (!p.careerStats) p.careerStats = { seasonsPlayed: p.careerStats?.seasonsPlayed || 0 };

        const statFields = [
            'passYards', 'passAttempts', 'passCompletions', 'interceptionsThrown',
            'rushYards', 'rushAttempts',
            'recYards', 'receptions', 'targets', 'drops',
            'tackles', 'sacks', 'interceptions', 'fumbles', 'fumblesLost', 'fumblesRecovered',
            'touchdowns', 'returnYards', 'safeties'
        ];

        statFields.forEach(field => {
            const value = p.gameStats[field] || 0;
            if (value !== 0) {
                p.seasonStats[field] = (p.seasonStats[field] || 0) + value;
                p.careerStats[field] = (p.careerStats[field] || 0) + value;
            }
        });

        // Check Single Game Records
        if (!game.records) game.records = { game: {}, season: {}, career: {} };
        const checkGameRec = (statKey, val) => {
            if (!game.records.game[statKey]) game.records.game[statKey] = { val: 0, holder: 'None', year: 0 };
            if (val > game.records.game[statKey].val) {
                game.records.game[statKey] = { val, holder: p.name, year: game.year };
            }
        };

        checkGameRec('passYards', p.gameStats.passYards || 0);
        checkGameRec('rushYards', p.gameStats.rushYards || 0);
        checkGameRec('recYards', p.gameStats.recYards || 0);
        checkGameRec('touchdowns', p.gameStats.touchdowns || 0);
        checkGameRec('tackles', p.gameStats.tackles || 0);
        checkGameRec('sacks', p.gameStats.sacks || 0);
        checkGameRec('interceptions', p.gameStats.interceptions || 0);

        p.gameStats = null;
    });
}

function serializeActiveFaMarket(market) {
    if (market instanceof Map) {
        return Array.from(market.entries());
    }

    if (Array.isArray(market)) return market;

    if (market && typeof market === 'object') {
        return Object.entries(market);
    }

    return [];
}

function restoreActiveFaMarket(market) {
    if (market instanceof Map) return market;

    if (Array.isArray(market)) {
        return new Map(
            market.filter(entry => Array.isArray(entry) && entry.length === 2)
        );
    }

    if (market && typeof market === 'object') {
        return new Map(Object.entries(market));
    }

    return new Map();
}

const DEFAULT_SAVE_KEY = 'backyardFootballGameState';

// Measure serialized state and identify its largest sections when saving fails.
function getSerializedByteLength(value) {
    if (typeof TextEncoder !== 'undefined') {
        return new TextEncoder().encode(value).length;
    }

    return value.length * 2;
}

function logSaveSizeBreakdown(data, serialized, label) {
    const fields = Object.entries(data || {}).map(([key, value]) => {
        try {
            const json = JSON.stringify(value);

            return {
                key,
                bytes: getSerializedByteLength(json ?? 'undefined')
            };
        } catch (error) {
            return {
                key,
                bytes: 0,
                error: true
            };
        }
    });

    fields.sort((a, b) => b.bytes - a.bytes);

    const totalBytes = getSerializedByteLength(serialized);
    const largestFields = fields.slice(0, 8).map(field =>
        field.error
            ? `${field.key}: not serializable`
            : `${field.key}: ${(field.bytes / 1024 / 1024).toFixed(2)} MiB`
    );

    console.warn(
        `[SAVE] ${label}: ${(totalBytes / 1024 / 1024).toFixed(2)} MiB. ` +
        `Largest sections: ${largestFields.join(' | ')}`
    );
}

// Save team.coaches as the canonical coach records.
// Repeated team.coach and team.staff.coach aliases are restored on load.
function compactTeamCoachAliasesForSave(team) {
    const cleanTeam = { ...team };
    const coaches = Array.isArray(team?.coaches)
        ? team.coaches
        : [];

    const getCoachIndex = candidate => {
        if (!candidate) return -1;

        return coaches.findIndex(coach =>
            coach &&
            (
                coach === candidate ||
                (
                    coach.id != null &&
                    candidate.id != null &&
                    String(coach.id) === String(candidate.id)
                )
            )
        );
    };

    const coachAliasIndex = getCoachIndex(team?.coach);

    if (coachAliasIndex >= 0) {
        cleanTeam._savedCoachAliasIndex = coachAliasIndex;
        delete cleanTeam.coach;
    }

    if (
        team?.staff &&
        typeof team.staff === 'object' &&
        !Array.isArray(team.staff)
    ) {
        const staffCoachIndex = getCoachIndex(team.staff.coach);

        if (staffCoachIndex >= 0) {
            cleanTeam.staff = { ...team.staff };
            delete cleanTeam.staff.coach;

            cleanTeam._savedStaffCoachAliasIndex = staffCoachIndex;
        }
    }

    return cleanTeam;
}

// Restore the normal runtime references after loading a compact save.
function restoreTeamCoachAliases(team) {
    if (!team || typeof team !== 'object') return;

    const coaches = Array.isArray(team.coaches)
        ? team.coaches
        : [];

    const getCoachIndex = candidate => {
        if (!candidate) return -1;

        return coaches.findIndex(coach =>
            coach &&
            (
                coach === candidate ||
                (
                    coach.id != null &&
                    candidate.id != null &&
                    String(coach.id) === String(candidate.id)
                )
            )
        );
    };

    if (Number.isInteger(team._savedCoachAliasIndex)) {
        team.coach = coaches[team._savedCoachAliasIndex] || null;
    } else {
        const coachIndex = getCoachIndex(team.coach);

        if (coachIndex >= 0) {
            team.coach = coaches[coachIndex];
        }
    }

    if (Number.isInteger(team._savedStaffCoachAliasIndex)) {
        if (
            !team.staff ||
            typeof team.staff !== 'object' ||
            Array.isArray(team.staff)
        ) {
            team.staff = {};
        }

        team.staff.coach =
            coaches[team._savedStaffCoachAliasIndex] || null;
    } else if (team.staff?.coach) {
        const staffCoachIndex = getCoachIndex(team.staff.coach);

        if (staffCoachIndex >= 0) {
            team.staff.coach = coaches[staffCoachIndex];
        }
    }

    delete team._savedCoachAliasIndex;
    delete team._savedStaffCoachAliasIndex;
}

// A failed write must never delete the last valid save or unrelated data.
function autoWriteStorage(
    key,
    value,
    dataForDiagnostics = null,
    label = 'Save'
) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (error) {
        console.error(
            `[SAVE] ${label} failed. Existing "${key}" data and other ` +
            `localStorage entries were left untouched.`,
            error
        );

        if (dataForDiagnostics) {
            logSaveSizeBreakdown(dataForDiagnostics, value, label);
        }

        return false;
    }
}

export function saveGameState(targetOrKey = DEFAULT_SAVE_KEY, maybeKey = null) {
    let activeGame = game;
    let saveKey = DEFAULT_SAVE_KEY;

    if (typeof targetOrKey === 'string') {
        saveKey = targetOrKey;
    } else if (targetOrKey && typeof targetOrKey === 'object') {
        activeGame = targetOrKey;
        if (typeof maybeKey === 'string') saveKey = maybeKey;
    }

    if (!activeGame) {
        console.error('Cannot save: game state is null or undefined.');
        return false;
    }

    // Strictly save primitive fields for matches: prevents attached team objects, results, or telemetry leaks
    const cleanMatchStrict = (m) => {
        if (!m || typeof m !== 'object') return null;
        const homeId = m.home?.id ?? m.homeTeam?.id ?? m.homeId ?? m.homeTeamId;
        const awayId = m.away?.id ?? m.awayTeam?.id ?? m.awayId ?? m.awayTeamId;
        if (homeId == null || awayId == null) return null;
        return {
            id: m.id || `${homeId}_vs_${awayId}`,
            week: Number.isInteger(m.week) ? m.week : undefined,
            homeId: String(homeId),
            awayId: String(awayId),
            homeScore: Number.isFinite(m.homeScore) ? m.homeScore : undefined,
            awayScore: Number.isFinite(m.awayScore) ? m.awayScore : undefined,
            played: Boolean(m.played || m.isPlayed || (m.homeScore != null && m.awayScore != null)),
            tier: m.tier ?? m.home?.tier,
            leagueType: m.leagueType ?? m.home?.leagueType
        };
    };

    try {
        const dataToSave = { ...activeGame };
        dataToSave._activeFaMarket = serializeActiveFaMarket(activeGame._activeFaMarket);
        delete dataToSave.relationships;
        delete dataToSave._faMarketCache;

        // 1. SCHEDULE: Strip attached team objects & play logs (cuts ~5MB)
        if (Array.isArray(dataToSave.schedule)) {
            dataToSave.schedule = dataToSave.schedule
                .map(cleanMatchStrict)
                .filter(Boolean);
        }

        // 2. DRAFT ORDER & DRAFT CLASS: Store compact IDs instead of full team/player objects (cuts ~3MB)
        if (Array.isArray(dataToSave.draftOrder)) {
            dataToSave.draftOrder = dataToSave.draftOrder
                .map(t => (typeof t === 'object' && t !== null ? String(t.id) : String(t)))
                .filter(Boolean);
        }

        if (Array.isArray(dataToSave.draftClass)) {
            dataToSave.draftClass = dataToSave.draftClass
                .map(p => (typeof p === 'object' && p !== null ? String(p.id) : String(p)))
                .filter(Boolean);
        }

        // 3. PURGE RETIRED/DEPARTED PLAYERS & COMPACT ACTIVE ONES
        const hofIds = new Set(
            (activeGame.hallOfFame || [])
                .map(p => (typeof p === 'object' && p !== null ? p.id : p))
                .filter(id => id != null)
        );

        dataToSave.players = (dataToSave.players || [])
            .filter(p => {
                if (!p || p.id == null) return false;
                const isRetired =
                    p.status?.type === 'retired' ||
                    p.status?.type === 'departed' ||
                    p.status === 'retired' ||
                    p.retired === true;
                if (isRetired) {
                    return hofIds.has(p.id) || hofIds.has(String(p.id));
                }
                return true;
            })
            .map(p => {
                const cleanP = { ...p };
                delete cleanP.gameStats;
                delete cleanP.fatigue;
                delete cleanP.isResting;
                delete cleanP._distToCarrier;
                delete cleanP.velocity;
                delete cleanP.scouting;
                delete cleanP.gameLog;
                delete cleanP.recentPlays;

                if (cleanP.progression && cleanP.progression.length > 3) {
                    cleanP.progression = cleanP.progression.slice(-3);
                }

                if (cleanP.status && cleanP.status.type === 'healthy' && cleanP.status.duration === 0) {
                    delete cleanP.status;
                }
                return cleanP;
            });

        const activePlayerIds = new Set(dataToSave.players.map(p => String(p.id)));

        // 4. MAP OBJECT ARRAYS TO IDS
        const resolvedPlayerTeamId = activeGame.playerTeam?.id ?? activeGame.playerTeam;
        dataToSave.playerTeam = resolvedPlayerTeamId != null ? String(resolvedPlayerTeamId) : null;

        if (Array.isArray(dataToSave.freeAgents)) {
            dataToSave.freeAgents = dataToSave.freeAgents
                .map(p => (typeof p === 'object' && p !== null ? p.id : p))
                .filter(id => id != null);
        }

        dataToSave.hallOfFame = Array.from(hofIds);

        if (Array.isArray(dataToSave.draftPool)) {
            dataToSave.draftPool = dataToSave.draftPool
                .map(p => (typeof p === 'object' && p !== null ? p.id : p))
                .filter(id => id != null);
        }

        // 5. TEAMS & SCOUTING COMPACT
        dataToSave.teams = (dataToSave.teams || []).map(team => {
            const cleanTeam = compactTeamCoachAliasesForSave(team);
            delete cleanTeam.recentPlayHistory;
            delete cleanTeam.playCallHistory;
            delete cleanTeam._captainFlavorLogged;

            const isUserTeam = String(team.id) === String(resolvedPlayerTeamId);
            if (!isUserTeam) {
                delete cleanTeam.scoutingReports;
            } else if (cleanTeam.scoutingReports && typeof cleanTeam.scoutingReports === 'object') {
                const compactReports = {};
                for (const [pId, rep] of Object.entries(cleanTeam.scoutingReports)) {
                    if (!rep) continue;
                    const hasScoutingProgress = rep.level > 0 || (rep.progressPoints && rep.progressPoints > 0);
                    if (hasScoutingProgress && activePlayerIds.has(String(pId))) {
                        compactReports[pId] = rep;
                    }
                }
                cleanTeam.scoutingReports = compactReports;
            }
            return cleanTeam;
        });

        // 6. HISTORIES & LOGS
        if (dataToSave.messages?.length > 15) {
            dataToSave.messages = dataToSave.messages.slice(0, 15);
        }

        if (Array.isArray(dataToSave.gameResults)) {
            dataToSave.gameResults = dataToSave.gameResults.slice(-4).map(res => ({
                homeTeam: res.homeTeam ? { name: res.homeTeam.name, id: res.homeTeam.id } : null,
                awayTeam: res.awayTeam ? { name: res.awayTeam.name, id: res.awayTeam.id } : null,
                homeScore: res.homeScore,
                awayScore: res.awayScore
            }));
        }

        if (dataToSave.pickHistory?.length > 60) {
            dataToSave.pickHistory = dataToSave.pickHistory.slice(-60);
        }

        if (Array.isArray(dataToSave.history?.seasons)) {
            if (dataToSave.history.seasons.length > 6) {
                dataToSave.history.seasons = dataToSave.history.seasons.slice(-6);
            }
            dataToSave.history.seasons = dataToSave.history.seasons.map(s => {
                if (!s || typeof s !== 'object') return s;
                const cleanSeason = { ...s };
                delete cleanSeason.gameLogs;
                delete cleanSeason.plays;
                delete cleanSeason.playByPlay;
                if (Array.isArray(cleanSeason.schedule)) {
                    cleanSeason.schedule = cleanSeason.schedule.map(cleanMatchStrict).filter(Boolean);
                }
                return cleanSeason;
            });
        }

        const serialized = JSON.stringify(dataToSave);

        if (autoWriteStorage(saveKey, serialized, dataToSave, 'Primary save')) {
            return true;
        }

        throw new Error(
            'Primary save write failed; attempting emergency compression.'
        );
    } catch (e) {
        console.error('Primary save failed, attempting emergency fallback save:', e);
        try {
            const dataToSave = { ...activeGame };
            dataToSave._activeFaMarket = serializeActiveFaMarket(activeGame._activeFaMarket);
            delete dataToSave.relationships;
            delete dataToSave._faMarketCache;
            delete dataToSave.messages;
            delete dataToSave.gameResults;
            delete dataToSave.pickHistory;
            delete dataToSave.history;

            const resolvedPlayerTeamId = activeGame.playerTeam?.id ?? activeGame.playerTeam;
            dataToSave.playerTeam = resolvedPlayerTeamId != null ? String(resolvedPlayerTeamId) : null;

            if (Array.isArray(dataToSave.schedule)) {
                dataToSave.schedule = dataToSave.schedule.map(cleanMatchStrict).filter(Boolean);
            }
            if (Array.isArray(dataToSave.draftOrder)) {
                dataToSave.draftOrder = dataToSave.draftOrder.map(t => (typeof t === 'object' && t !== null ? String(t.id) : String(t))).filter(Boolean);
            }
            if (Array.isArray(dataToSave.draftClass)) {
                dataToSave.draftClass = dataToSave.draftClass.map(p => (typeof p === 'object' && p !== null ? String(p.id) : String(p))).filter(Boolean);
            }
            if (Array.isArray(dataToSave.freeAgents)) {
                dataToSave.freeAgents = dataToSave.freeAgents.map(p => (typeof p === 'object' && p !== null ? p.id : p)).filter(id => id != null);
            }

            dataToSave.teams = (dataToSave.teams || []).map(team => {
                const cleanTeam = compactTeamCoachAliasesForSave(team);
                delete cleanTeam.recentPlayHistory;
                delete cleanTeam.playCallHistory;
                delete cleanTeam._captainFlavorLogged;
                delete cleanTeam.scoutingReports;
                return cleanTeam;
            });

            dataToSave.players = (dataToSave.players || [])
                .filter(p => !p.status || p.status.type !== 'retired')
                .map(p => {
                    const cp = { ...p };
                    delete cp.gameStats;
                    delete cp.bio;
                    delete cp.scouting;
                    delete cp.gameLog;
                    if (cp.progression) cp.progression = cp.progression.slice(-2);
                    return cp;
                });

            const fallbackSerialized = JSON.stringify(dataToSave);

            if (
                autoWriteStorage(
                    saveKey,
                    fallbackSerialized,
                    dataToSave,
                    'Emergency compressed save'
                )
            ) {
                return true;
            }

            console.error(
                '[SAVE] Emergency save also failed. The previous save was preserved, ' +
                'but the latest changes could not be saved.'
            );

            return false;
        } catch (fallbackErr) {
            console.error('Critical save failure:', fallbackErr);
            return false;
        }
    }
}

export function loadGameState(saveKey = DEFAULT_SAVE_KEY) {
    try {
        const saved = localStorage.getItem(saveKey);
        if (!saved) return null;

        const loaded = JSON.parse(saved);
        game = loaded;
        game._activeFaMarket = restoreActiveFaMarket(game._activeFaMarket);

        // Reconnect compacted coach aliases to the canonical team.coaches records.
        (game.teams || []).forEach(restoreTeamCoachAliases);

        playerMap.clear();
        if (Array.isArray(game.players)) {
            game.players.forEach(p => {
                if (p && p.id != null) {
                    if (!p.status) p.status = { type: 'healthy', description: '', duration: 0 };
                    playerMap.set(String(p.id), p);
                    playerMap.set(p.id, p);
                }
            });
        }

        // Map teams by both String and raw ID to avoid strict equality type-mismatch bugs
        const teamById = new Map();
        (game.teams || []).forEach(t => {
            if (t && t.id != null) {
                teamById.set(String(t.id), t);
                teamById.set(t.id, t);
            }
        });

        const playerTeamId = game.playerTeam?.id ?? game.playerTeam;
        game.playerTeam = playerTeamId != null ? (teamById.get(String(playerTeamId)) || null) : null;

        // Safely rehydrate Free Agents whether stored as IDs or full objects
        game.freeAgents = (game.freeAgents || [])
            .map(p => {
                const id = typeof p === 'object' && p !== null ? p.id : p;
                return id != null ? playerMap.get(String(id)) : null;
            })
            .filter(Boolean);

        // Safely rehydrate Schedule while handling string/number ID mismatches
        if (Array.isArray(game.schedule)) {
            game.schedule = game.schedule.map(match => {
                const homeId = match?.home?.id ?? match?.homeId;
                const awayId = match?.away?.id ?? match?.awayId;
                const home = homeId != null ? teamById.get(String(homeId)) : null;
                const away = awayId != null ? teamById.get(String(awayId)) : null;

                if (!home || !away) return null;
                return { ...match, home, away };
            }).filter(Boolean);
        }

        // Safely rehydrate Hall of Fame
        if (Array.isArray(game.hallOfFame)) {
            game.hallOfFame = game.hallOfFame
                .map(p => {
                    const id = typeof p === 'object' && p !== null ? p.id : p;
                    return id != null ? playerMap.get(String(id)) : null;
                })
                .filter(Boolean);
        }

        return game;
    } catch (e) {
        console.error('Error loading game state:', e);
        throw e;
    }
}