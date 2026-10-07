import { relationshipLevels } from '../data.js';

export let game = null;
export function setGame(g) { game = g; }
export const playerMap = new Map();

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

export const isYouthEligible = (player) => player.age >= 8 && player.age <= 10;
export const isDraftEligible = (player) => player.age === 11;

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
    if (!p1Id || !p2Id || p1Id === p2Id || !game || !game.relationships) return relationshipLevels.STRANGER.level;
    const key = [p1Id, p2Id].sort().join('_');
    return game.relationships.get(key) ?? relationshipLevels.STRANGER.level;
}

export function improveRelationship(p1Id, p2Id) {
    if (!p1Id || !p2Id || p1Id === p2Id || !game || !game.relationships) return;
    const key = [p1Id, p2Id].sort().join('_');
    const currentLevel = game.relationships.get(key) ?? relationshipLevels.STRANGER.level;
    const newLevel = Math.min(relationshipLevels.BEST_FRIEND.level, currentLevel + 1);
    if (newLevel > currentLevel) game.relationships.set(key, newLevel);
}

export function decreaseRelationship(p1Id, p2Id) {
    if (!p1Id || !p2Id || p1Id === p2Id || !game || !game.relationships) return;
    const key = [p1Id, p2Id].sort().join('_');
    const currentLevel = game.relationships.get(key) ?? relationshipLevels.STRANGER.level;
    const newLevel = Math.max(relationshipLevels.STRANGER.level, currentLevel - 1);
    if (newLevel < currentLevel) game.relationships.set(key, newLevel);
}

export function getScoutedPlayerInfo(player, relationshipLevelNum) {
    if (!player) return null;

    const levelInfo = Object.values(relationshipLevels).find(rl => rl.level === relationshipLevelNum) || relationshipLevels.STRANGER;
    const accuracy = levelInfo.scoutAccuracy;
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

export function resetGameStats(teamA, teamB) {
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

const DEFAULT_SAVE_KEY = 'backyardFootballGameState';

export function saveGameState(saveKey = DEFAULT_SAVE_KEY) {
    try {
        const dataToSave = {
            ...game,
            relationships: Object.fromEntries(
                game.relationships instanceof Map ? game.relationships : new Map()
            )
        };

        // 🚀 COMPRESSION & EFFICIENCY FIXES
        // Strip out bloated, transient, and unnecessary data before serialization
        dataToSave.players = (dataToSave.players || []).map(p => {
            const cleanP = { ...p };
            delete cleanP.gameStats;     // Transient in-game stats
            delete cleanP.fatigue;       // Transient energy
            delete cleanP.isResting;
            delete cleanP._distToCarrier;
            delete cleanP.velocity;
            
            // If completely healthy, don't store the verbose status object
            if (cleanP.status && cleanP.status.type === 'healthy' && cleanP.status.duration === 0) {
                delete cleanP.status;
            }
            return cleanP;
        });

        dataToSave.teams = (dataToSave.teams || []).map(team => {
            const cleanTeam = { ...team };
            delete cleanTeam.recentPlayHistory;
            delete cleanTeam._captainFlavorLogged;
            return cleanTeam;
        });

        // Aggressive limiting on bloated arrays
        if (dataToSave.messages?.length > 25) {
            dataToSave.messages = dataToSave.messages.slice(0, 25);
        }

        if (dataToSave.gameResults) {
            dataToSave.gameResults = dataToSave.gameResults.slice(-10).map(res => ({
                ...res,
                gameLog: [] // NEVER save full logs
            }));
        }

        if (dataToSave.pickHistory?.length > 100) {
            dataToSave.pickHistory = dataToSave.pickHistory.slice(-100);
        }

        localStorage.setItem(saveKey, JSON.stringify(dataToSave));
    } catch (e) {
        console.error('Save failed. LocalStorage limit likely reached:', e);
        // Fallback: Ultra aggressive wipe
        if (game?.gameResults) game.gameResults = [];
        if (game?.messages) game.messages = [];
        if (game?.pickHistory) game.pickHistory = [];
        try {
            localStorage.setItem(saveKey, JSON.stringify(game));
        } catch(fallbackErr) {
            console.error('Critical save failure.', fallbackErr);
        }
    }
}

export function loadGameState(saveKey = DEFAULT_SAVE_KEY) {
    try {
        const saved = localStorage.getItem(saveKey);
        if (saved) {
            const loaded = JSON.parse(saved);
            game = loaded;

            if (game.relationships && !(game.relationships instanceof Map)) {
                game.relationships = new Map(Object.entries(game.relationships));
            }

            playerMap.clear();
            if (Array.isArray(game.players)) {
                game.players.forEach(p => {
                    if (p && p.id) {
                        // Restore omitted healthy status stripped during compression save
                        if (!p.status) p.status = { type: 'healthy', description: '', duration: 0 };
                        playerMap.set(p.id, p);
                    }
                });
            }

            const teamById = new Map(
                (game.teams || []).filter(t => t && t.id).map(t => [t.id, t])
            );

            game.playerTeam = game.playerTeam?.id ? (teamById.get(game.playerTeam.id) || null) : null;
            game.freeAgents = (game.freeAgents || []).map(p => p?.id ? playerMap.get(p.id) : null).filter(Boolean);

            if (Array.isArray(game.schedule)) {
                game.schedule = game.schedule.map(match => {
                    const home = teamById.get(match?.home?.id ?? match?.homeId);
                    const away = teamById.get(match?.away?.id ?? match?.awayId);
                    if (!home || !away) return null;
                    return { ...match, home, away };
                }).filter(Boolean);
            }

            if (Array.isArray(game.hallOfFame)) {
                game.hallOfFame = game.hallOfFame.map(p => p?.id ? playerMap.get(p.id) : null).filter(Boolean);
            }

            return game;
        }
    } catch (e) {
        console.error('Error loading game state:', e);
    }
    return null;
}
