import { getRandom, getRandomInt } from '../utils.js';
import {
    game, setGame, playerMap, getPlayer, getRosterObjects, addMessage,
    getRelationshipLevel, improveRelationship, decreaseRelationship, getScoutedPlayerInfo
} from './state.js';
import {
    generatePlayer, generateDraftClassModifiers, calculateOverall, estimateBestPosition
} from './player.js';
import {
    coachPersonalities, offenseFormations, defenseFormations, teamNames, divisionNames, relationshipLevels
} from '../data.js';
import {
    resetGameStats, finalizeGameResults
} from './state.js';
import {
    rebuildDepthChartFromOrder, aiSetDepthChart, assignTeamCaptain
} from './depth_chart.js';

export const ROSTER_LIMIT = 18;
export const MIN_HEALTHY_PLAYERS = 8;

const teamColors = [
    { primary: '#DC2626', secondary: '#FFFFFF' },
    { primary: '#2563EB', secondary: '#FFFFFF' },
    { primary: '#FBBF24', secondary: '#000000' },
    { primary: '#D1D5DB', secondary: '#000000' },
    { primary: '#10B981', secondary: '#000000' },
    { primary: '#F97316', secondary: '#FFFFFF' },
    { primary: '#6366F1', secondary: '#FFFFFF' },
    { primary: '#EC4899', secondary: '#FFFFFF' },
    { primary: '#000000', secondary: '#FFFFFF' },
    { primary: '#84CC16', secondary: '#000000' },
    { primary: '#A855F7', secondary: '#FFFFFF' },
    { primary: '#14B8A6', secondary: '#FFFFFF' }
];

let availableColors = [...teamColors];

function yieldToMain() { return new Promise(resolve => setTimeout(resolve, 0)); }

export function buildSocialNetworks(targetPlayers, allPlayers) {
    targetPlayers.forEach(p => {
        if (!p.social) p.social = { bestFriendId: null, goodFriendIds: [], rivalIds: [] };
        
        let maxGoodFriends = 3; let maxRivals = 2;
        if (p.personality.likeability > 70) { maxGoodFriends = getRandomInt(4, 7); maxRivals = getRandomInt(0, 1); }
        else if (p.personality.likeability < 35) { maxGoodFriends = getRandomInt(1, 2); maxRivals = getRandomInt(2, 3); }

        const sameClique = allPlayers.filter(o => o.id !== p.id && o.personality?.clique === p.personality?.clique);
        const others = allPlayers.filter(o => o.id !== p.id);

        if (!p.social.bestFriendId && Math.random() < 0.8 && sameClique.length > 0) {
            const bf = getRandom(sameClique);
            if (!bf.social.bestFriendId) {
                p.social.bestFriendId = bf.id;
                bf.social.bestFriendId = p.id;
            }
        }

        let attempts = 0;
        while (p.social.goodFriendIds.length < maxGoodFriends && attempts < 10) {
            const gf = getRandom(Math.random() < 0.6 ? sameClique : others);
            if (gf && gf.id !== p.id && gf.id !== p.social.bestFriendId && !p.social.goodFriendIds.includes(gf.id)) {
                p.social.goodFriendIds.push(gf.id);
                if (!gf.social.goodFriendIds.includes(p.id)) gf.social.goodFriendIds.push(p.id);
            }
            attempts++;
        }

        attempts = 0;
        while (p.social.rivalIds.length < maxRivals && attempts < 10) {
            const rv = getRandom(others);
            if (rv && rv.id !== p.id && rv.personality?.clique !== p.personality?.clique && !p.social.goodFriendIds.includes(rv.id) && rv.id !== p.social.bestFriendId) {
                if (!p.social.rivalIds.includes(rv.id)) p.social.rivalIds.push(rv.id);
                if (!rv.social.rivalIds.includes(p.id)) rv.social.rivalIds.push(p.id);
            }
            attempts++;
        }
    });
}

export function getPlayerScore(player, coach) {
    if (!player || !player.attributes || !coach || !coach.attributePreferences) return 0;
    let score = 0;
    for (const category in player.attributes) {
        for (const attr in player.attributes[category]) {
            score += (player.attributes[category][attr] || 0) * (coach.attributePreferences[category]?.[attr] || 1.0);
        }
    }
    if (coach.type === 'Youth Scout' && player.age) score += (18 - player.age) * 10;
    return score;
}

export async function initializeLeague(onProgress) {
    const newGame = {
        year: 1, teams: [], players: [], freeAgents: [], draftClass: [], playerTeam: null, schedule: [],
        currentWeek: 0, draftOrder: [], currentPick: 0, hallOfFame: [],
        gameResults: [], messages: [], relationships: new Map(),
        pickHistory: [], history: { seasons: [] },
        records: {
            game: {},
            season: {},
            career: {}
        }
    };
    setGame(newGame);

    addMessage("Welcome!", "Generating the league and players...");

    const totalPlayers = 480; // Increased to ensure deep initial rosters
    const initialClassModifiers = generateDraftClassModifiers();

    for (let i = 0; i < totalPlayers; i++) {
        game.players.push(generatePlayer(11, 18, initialClassModifiers)); // Age 11-18 for main league
        if (i % 10 === 0 && onProgress) {
            onProgress((i / totalPlayers) * 0.7);
            await yieldToMain();
        }
    }
    if (onProgress) onProgress(0.7);
    await yieldToMain();

    playerMap.clear();
    game.players.forEach(p => {
        if (p && p.id) playerMap.set(p.id, p);
    });

    buildSocialNetworks(game.players, game.players);
    if (onProgress) onProgress(0.9);
    await yieldToMain();

    if (onProgress) onProgress(0.9);
    await yieldToMain();

    availableColors = [...teamColors];
    const availableTeamNames = [...teamNames];

    for (let i = 0; i < 20; i++) {
        const nameIndex = getRandomInt(0, availableTeamNames.length - 1);
        const teamName = `The ${availableTeamNames.splice(nameIndex, 1)[0]}`;
        const tier = i < 10 ? 1 : 2;
        const coach = getRandom(coachPersonalities);

        const prefOff = offenseFormations[coach.preferredOffense] ? coach.preferredOffense : 'Balanced';
        const prefDef = defenseFormations[coach.preferredDefense] ? coach.preferredDefense : '3-2-3';

        const offenseFormationData = offenseFormations[prefOff] || offenseFormations['Balanced'];
        const defenseFormationData = defenseFormations[prefDef] || defenseFormations['3-2-3'];

        if (availableColors.length === 0) availableColors = [...teamColors];
        const colorSet = availableColors.splice(getRandomInt(0, availableColors.length - 1), 1)[0];

        const team = {
            id: crypto.randomUUID(), name: teamName, roster: [], coach, wins: 0, losses: 0,
            leagueType: 'main',
            tier: tier,
            ageMin: 11,
            ageMax: 18,
            primaryColor: colorSet?.primary || teamColors[0].primary,
            secondaryColor: colorSet?.secondary || teamColors[0].secondary,
            formations: { offense: offenseFormationData?.name || 'Balanced', defense: defenseFormationData?.name || '3-2-3' },
            depthChart: {
                offense: Object.fromEntries((offenseFormationData?.slots || []).map(slot => [slot, null])),
                defense: Object.fromEntries((defenseFormationData?.slots || []).map(slot => [slot, null]))
            },
            draftNeeds: 0,
            socialProfile: {
                streetCred: tier === 1 ? 60 : 35,
                favorTokens: 3
            }
        };
        game.teams.push(team);

        if (i % 4 === 0) await yieldToMain();
    }

    const youthMascots = ["Lil' Tykes", "Mini Monsters", "Sandlot Pups", "Junior Jets", "Tots", "Wildcats"];
    for (let i = 0; i < 6; i++) {
        const yTeam = {
            id: crypto.randomUUID(), name: `The ${youthMascots[i]}`, roster: [],
            coach: getRandom(coachPersonalities), wins: 0, losses: 0, ties: 0,
            leagueType: 'youth',
            tier: null,
            ageMin: 8,
            ageMax: 10,
            formations: { offense: 'Balanced', defense: '3-2-3' },
            depthChart: { offense: {}, defense: {} },
            isYouth: true
        };

        for (let j = 0; j < 14; j++) {
            const kid = generatePlayer(8, 10, initialClassModifiers);
            kid.teamId = yTeam.id;
            kid.lifecycle = 'youth';
            yTeam.roster.push(kid.id);
            game.players.push(kid);
            playerMap.set(kid.id, kid);
        }
        aiSetDepthChart(yTeam);
        game.teams.push(yTeam); // ✅ Now unified in game.teams
    }

    // Populate Initial Main Team Rosters
    const mainTeams = game.teams.filter(t => t.leagueType === 'main');
    const unassigned = game.players.filter(p => !p.teamId && p.age >= 11 && p.age <= 18);

    mainTeams.forEach(team => {
        const targetRosterSize = 14; // Give every team 14 initial players
        for (let i = 0; i < targetRosterSize; i++) {
            if (unassigned.length > 0) {
                const idx = getRandomInt(0, unassigned.length - 1);
                const p = unassigned.splice(idx, 1)[0];
                addPlayerToTeam(p, team);
            }
        }
        aiSetDepthChart(team);
    });

    if (onProgress) onProgress(1.0);
    addMessage("Ready!", "League generated. Time to create your team.");

    game.teams.forEach(team => {
        if (team) assignTeamCaptain(team);
    });
}

export function createPlayerTeam(teamName, options = {}) {
    if (!game || !game.teams) return;

    const { coachName, coachStyle, prefOff, prefDef, primaryColor, secondaryColor } = options;
    const finalTeamName = teamName.toLowerCase().startsWith("the ") ? teamName : `The ${teamName}`;

    let baseCoach = coachPersonalities.find(c => c.type === coachStyle) || coachPersonalities[0];
    const customCoach = JSON.parse(JSON.stringify(baseCoach));
    customCoach.name = coachName || 'Coach';
    if (prefOff) customCoach.preferredOffense = prefOff;
    if (prefDef) customCoach.preferredDefense = prefDef;

    let defaultOffense = prefOff || 'Balanced';
    let defaultDefense = prefDef || '3-2-3';
    if (!offenseFormations[defaultOffense]) defaultOffense = Object.keys(offenseFormations)[0];
    if (!defenseFormations[defaultDefense]) defaultDefense = Object.keys(defenseFormations)[0];

    const defaultOffenseSlots = offenseFormations[defaultOffense]?.slots || [];
    const defaultDefenseSlots = defenseFormations[defaultDefense]?.slots || [];

    const playerTeam = {
        id: crypto.randomUUID(),
        name: finalTeamName,
        roster: [],
        coach: customCoach,
        leagueType: 'main',
        tier: 1,
        ageMin: 11,
        ageMax: 18,
        wins: 0,
        losses: 0,
        primaryColor: primaryColor || '#2563EB',
        secondaryColor: secondaryColor || '#FFFFFF',
        formations: { offense: defaultOffense, defense: defaultDefense },
        depthChart: {
            offense: Object.fromEntries(defaultOffenseSlots.map(slot => [slot, null])),
            defense: Object.fromEntries(defaultDefenseSlots.map(slot => [slot, null])),
        },
        draftNeeds: 0,
        isPlayerControlled: true,
        socialProfile: {
            streetCred: 50,
            favorTokens: 3
        }
    };

    game.teams.push(playerTeam);
    game.playerTeam = playerTeam;
    return playerTeam;
}

/*export function setupDraft() {
    if (!game || !game.teams) return;
    game.draftOrder = [];
    game.currentPick = 0;
    game.pickHistory = [];

    let sortedTeams;
    if (game.year === 1) {
        sortedTeams = [...game.teams].filter(t => t).sort(() => 0.5 - Math.random());
    } else {
        sortedTeams = [...game.teams].filter(t => t).sort((a, b) => (a.wins || 0) - (b.wins || 0) || (b.losses || 0) - (a.losses || 0));
    }

    game.teams.forEach(team => {
        if (team) team.draftNeeds = Math.max(0, ROSTER_LIMIT - (team.roster?.length || 0));
    });

    const maxNeeds = Math.max(0, ...game.teams.map(t => t?.draftNeeds || 0));
    if (maxNeeds === 0) return;

    for (let i = 0; i < maxNeeds; i++) {
        game.draftOrder.push(...(i % 2 === 0 ? sortedTeams : [...sortedTeams].reverse()));
    }
}
*/
export function addPlayerToTeam(player, team) {
    if (!player || !team || !team.roster || typeof player.id === 'undefined') return false;
    if (team.roster.length >= ROSTER_LIMIT) return false;
    if (team.roster.includes(player.id)) return false;

    if (player.number == null) {
        const offOvr = calculateOverall(player, player.favoriteOffensivePosition);
        const defOvr = calculateOverall(player, player.favoriteDefensivePosition);
        const primaryPos = (offOvr >= defOvr) ? player.favoriteOffensivePosition : player.favoriteDefensivePosition;

        let preferredRanges = [];
        switch (primaryPos) {
            case 'QB': preferredRanges.push([1, 19]); break;
            case 'WR': preferredRanges.push([10, 19], [80, 89]); break;
            case 'RB': preferredRanges.push([20, 39]); break;
            case 'DB': preferredRanges.push([20, 49]); break;
            case 'LB': preferredRanges.push([40, 59], [90, 99]); break;
            case 'OL': preferredRanges.push([60, 79]); break;
            case 'DL': preferredRanges.push([60, 79], [90, 99]); break;
            default: preferredRanges.push([1, 99]);
        }

        const fullRoster = getRosterObjects(team);
        const existingNumbers = new Set(fullRoster.map(p => p.number).filter(n => n !== null));

        let preferredNumbers = [];
        for (const range of preferredRanges) {
            for (let i = range[0]; i <= range[1]; i++) {
                if (!existingNumbers.has(i)) preferredNumbers.push(i);
            }
        }
        preferredNumbers.sort(() => 0.5 - Math.random());

        if (preferredNumbers.length > 0) {
            player.number = preferredNumbers[0];
        } else {
            let fallbackNumber;
            let attempts = 0;
            do {
                fallbackNumber = getRandomInt(1, 99);
                attempts++;
            } while (existingNumbers.has(fallbackNumber) && attempts < 200);

            if (existingNumbers.has(fallbackNumber)) {
                for (let i = 1; i <= 99; i++) {
                    if (!existingNumbers.has(i)) { fallbackNumber = i; break; }
                }
            }
            player.number = fallbackNumber;
        }
    }

    player.teamId = team.id;
    team.roster.push(player.id);

    if (!team.depthOrder || Array.isArray(team.depthOrder)) {
        team.depthOrder = { 'QB': [], 'RB': [], 'WR': [], 'TE': [], 'OL': [], 'DL': [], 'LB': [], 'DB': [] };
    }

    let offPos = player.favoriteOffensivePosition || 'WR';
    if (['FB'].includes(offPos)) offPos = 'RB';
    if (['ATH', 'K', 'P'].includes(offPos)) offPos = 'WR';
    if (['OT', 'OG', 'C'].includes(offPos)) offPos = 'OL';
    if (!team.depthOrder[offPos]) offPos = 'WR';

    let defPos = player.favoriteDefensivePosition || 'DB';
    if (['CB', 'S', 'FS', 'SS'].includes(defPos)) defPos = 'DB';
    if (['DE', 'DT', 'NT'].includes(defPos)) defPos = 'DL';
    if (!team.depthOrder[defPos]) defPos = 'DB';

    team.depthOrder[offPos].push(player.id);
    if (team.depthOrder[defPos] && !team.depthOrder[defPos].includes(player.id)) {
        team.depthOrder[defPos].push(player.id);
    }

    return true;
}

/*export function simulateAIPick(team) {
    if (!team || !team.roster || !game || !game.players || !team.coach) return null;
    if (team.roster.length >= ROSTER_LIMIT) return null;

    const undraftedPlayers = game.players.filter(p =>
        p && !p.teamId && (!p.status || p.status.duration === 0) &&
        p.status?.type !== 'retired' && p.status?.type !== 'departed'
    );
    if (undraftedPlayers.length === 0) return null;

    const rosterObjs = getRosterObjects(team);
    let qbCount = 0, trenchCount = 0, skillCount = 0;

    rosterObjs.forEach(p => {
        const pos = estimateBestPosition(p);
        if (pos === 'QB') qbCount++;
        else if (['OL', 'DL', 'C', 'DT', 'DE', 'OT', 'OG'].includes(pos)) trenchCount++;
        else skillCount++;
    });

    let bestPick = { player: null, score: -Infinity };

    undraftedPlayers.forEach(player => {
        const pos = estimateBestPosition(player);
        let baseScore = getPlayerScore(player, team.coach);
        let needMultiplier = 1.0;

        if (pos === 'QB') {
            if (qbCount === 0) needMultiplier = 3.0;
            else if (qbCount === 1) needMultiplier = 1.2;
            else needMultiplier = 0.1;
        } else if (['OL', 'DL', 'C', 'DT', 'DE', 'OT', 'OG'].includes(pos)) {
            if (trenchCount < 4) needMultiplier = 2.2;
            else if (trenchCount < 7) needMultiplier = 1.4;
            else needMultiplier = 0.5;
        } else {
            if (skillCount < 6) needMultiplier = 1.6;
            else if (skillCount < 10) needMultiplier = 1.1;
            else needMultiplier = 0.7;
        }

        const finalScore = baseScore * needMultiplier;
        if (finalScore > bestPick.score) {
            bestPick = { player, score: finalScore };
        }
    });

    if (bestPick.player) {
        addPlayerToTeam(bestPick.player, team);
    }
    return bestPick.player;
}*/

export function generateDraftSummary() {
    if (!game || !game.pickHistory || game.pickHistory.length === 0) return;
    const history = game.pickHistory;
    const topPick = history[0];

    let steal = topPick;
    if (history.length > 5) {
        steal = [...history].sort((a, b) => (b.ovr - (b.pick * 0.5)) - (a.ovr - (a.pick * 0.5)))[0];
    }

    const teamGrades = {};
    history.forEach(p => {
        if (!teamGrades[p.teamName]) teamGrades[p.teamName] = { total: 0, count: 0 };
        teamGrades[p.teamName].total += p.ovr;
        teamGrades[p.teamName].count++;
    });

    const bestDraft = Object.entries(teamGrades)
        .map(([name, data]) => ({ name, avg: data.total / data.count }))
        .sort((a, b) => b.avg - a.avg)[0];

    let body = `The draft has officially concluded! Here is the league-wide wrap-up:\n\n` +
        `**No. 1 Overall Pick:** ${topPick.teamName} selected **${topPick.playerName}** (${topPick.pos}). Scouts expect him to be a day-one starter.\n\n`;

    if (steal && steal.pick > 5) {
        body += `**Steal of the Draft:** Everyone is talking about **${steal.playerName}**, who fell to pick #${steal.pick}. ${steal.teamName} got incredible value for a player of his caliber.\n\n`;
    }

    if (bestDraft) {
        body += `**Best Draft Class:** **${bestDraft.name}** is receiving high marks from analysts, drafting a class with an average OVR of ${Math.round(bestDraft.avg)}.\n\n`;
    }

    body += `The preseason is now underway. Check your roster and set your depth charts!`;
    addMessage("Draft Recap: Winners and Losers", body, false, game);
}

export function getTeamOverall(team) {
    const roster = getRosterObjects(team);
    if (!roster || !roster.length) return 50;
    
    // ZenGM Style: A team's OVR is dictated by its top 8 starters, not dragged down by bench scrubs
    const sortedOvr = roster
        .map(p => calculateOverall(p, estimateBestPosition(p)))
        .sort((a, b) => b - a);
        
    const top8 = sortedOvr.slice(0, 8);
    if (top8.length === 0) return 50;
    
    const sum = top8.reduce((s, val) => s + val, 0);
    return Math.round(sum / top8.length);
}

export function generateHistoricalStats(team, score) {
    const roster = getRosterObjects(team);
    roster.forEach(p => {
        if (p && !p.gameStats) {
            p.gameStats = { passAttempts: 0, passCompletions: 0, passYards: 0, interceptionsThrown: 0, rushAttempts: 0, rushYards: 0, receptions: 0, recYards: 0, targets: 0, drops: 0, tackles: 0, sacks: 0, interceptions: 0, fumbles: 0, fumblesLost: 0, fumblesRecovered: 0, returnYards: 0, touchdowns: 0, safeties: 0 };
        }
    });

    const qb = roster.find(p => team.depthChart?.offense && p.id === team.depthChart.offense['QB1']) || roster.find(p => p.pos === 'QB') || roster[0];
    const rb = roster.find(p => team.depthChart?.offense && p.id === team.depthChart.offense['RB1']) || roster.find(p => p.pos === 'RB') || roster[1];
    const wr1 = roster.find(p => team.depthChart?.offense && p.id === team.depthChart.offense['WR1']) || roster.find(p => p.pos === 'WR') || roster[2];
    const wr2 = roster.find(p => team.depthChart?.offense && p.id === team.depthChart.offense['WR2']) || roster.find(p => p.pos === 'WR' && p.id !== wr1?.id) || roster[3];
    const def1 = roster.find(p => team.depthChart?.defense && p.id === team.depthChart.defense['LB1']) || roster.find(p => p.pos === 'LB') || roster[4];
    const def2 = roster.find(p => team.depthChart?.defense && p.id === team.depthChart.defense['DB1']) || roster.find(p => p.pos === 'DB') || roster[5];

    const tds = Math.floor(score / 7);
    const passTds = Math.floor(tds * 0.6);
    const rushTds = tds - passTds;

    if (qb && qb.gameStats) {
        qb.gameStats.passAttempts = getRandomInt(15, 25);
        qb.gameStats.passCompletions = Math.floor(qb.gameStats.passAttempts * (0.5 + Math.random() * 0.2));
        qb.gameStats.passYards = qb.gameStats.passCompletions * getRandomInt(8, 12);
        qb.gameStats.touchdowns += passTds;
        qb.gameStats.interceptionsThrown = getRandomInt(0, 2);
    }
    if (rb && rb.gameStats) {
        rb.gameStats.rushAttempts = getRandomInt(10, 20);
        rb.gameStats.rushYards = rb.gameStats.rushAttempts * getRandomInt(3, 6);
        rb.gameStats.touchdowns += rushTds;
    }
    if (wr1 && wr1.gameStats) {
        wr1.gameStats.receptions = Math.floor((qb?.gameStats.passCompletions || 10) * 0.4);
        wr1.gameStats.recYards = wr1.gameStats.receptions * getRandomInt(10, 15);
        wr1.gameStats.touchdowns += Math.floor(passTds * 0.6);
    }
    if (wr2 && wr2.gameStats) {
        wr2.gameStats.receptions = Math.floor((qb?.gameStats.passCompletions || 10) * 0.3);
        wr2.gameStats.recYards = wr2.gameStats.receptions * getRandomInt(9, 13);
        wr2.gameStats.touchdowns += (passTds - Math.floor(passTds * 0.6));
    }
    if (def1 && def1.gameStats) def1.gameStats.tackles = getRandomInt(4, 8);
    if (def2 && def2.gameStats) def2.gameStats.interceptions = (qb?.gameStats.interceptionsThrown || 0) > 0 ? 1 : 0;
}

export function simulateHistoricalMatch(homeTeam, awayTeam) {
    const homeOvr = getTeamOverall(homeTeam);
    const awayOvr = getTeamOverall(awayTeam);

    const homeAdvantage = 3;
    let homeScore = Math.max(0, Math.floor(homeOvr / 5 + homeAdvantage + getRandomInt(-14, 14)));
    let awayScore = Math.max(0, Math.floor(awayOvr / 5 + getRandomInt(-14, 14)));

    if (homeScore === awayScore) homeScore += Math.random() > 0.5 ? 3 : -3;
    homeScore = Math.max(0, homeScore);
    awayScore = Math.max(0, awayScore);

    resetGameStats(homeTeam, awayTeam);
    generateHistoricalStats(homeTeam, homeScore);
    generateHistoricalStats(awayTeam, awayScore);

    finalizeGameResults(homeTeam, awayTeam, homeScore, awayScore);
}

export function simulateHistoricalSeason(yearNum, gameInstance) {
    gameInstance.currentWeek = 0;
    generateSchedule();

    const numWeeks = 9;
    const gamesPerWeek = gameInstance.teams.length / 2;

    for (let w = 0; w < numWeeks; w++) {
        const startIndex = w * gamesPerWeek;
        const endIndex = startIndex + gamesPerWeek;
        const weeklyGames = gameInstance.schedule.slice(startIndex, endIndex);

        weeklyGames.forEach(match => {
            if (match && match.home && match.away) {
                simulateHistoricalMatch(match.home, match.away);
            }
        });
        gameInstance.currentWeek++;
    }

    const mainTeams = gameInstance.teams.filter(t => t.leagueType === 'main');
    const tier1Teams = mainTeams.filter(t => t.tier === 1).sort((a, b) => (b.wins || 0) - (a.wins || 0) || (a.losses || 0) - (b.losses || 0));
    const tier2Teams = mainTeams.filter(t => t.tier === 2).sort((a, b) => (b.wins || 0) - (a.wins || 0) || (a.losses || 0) - (b.losses || 0));
    const youthTeams = gameInstance.teams.filter(t => t.leagueType === 'youth').sort((a, b) => (b.wins || 0) - (a.wins || 0) || (a.losses || 0) - (b.losses || 0));

    const champion = tier1Teams[0];
    const runnerUp = tier1Teams[1];
    const relegated = tier1Teams.slice(-2);
    const promoted = tier2Teams.slice(0, 2);

    // Capture historical season league leaders before stats reset
    const allPlayers = gameInstance.players || [];
    const topPasser = [...allPlayers].sort((a, b) => (b.seasonStats?.passYards || 0) - (a.seasonStats?.passYards || 0))[0];
    const topRusher = [...allPlayers].sort((a, b) => (b.seasonStats?.rushYards || 0) - (a.seasonStats?.rushYards || 0))[0];
    const topTackler = [...allPlayers].sort((a, b) => (b.seasonStats?.tackles || 0) - (a.seasonStats?.tackles || 0))[0];

    gameInstance.history = gameInstance.history || { seasons: [] };
    gameInstance.history.seasons.push({
        year: yearNum,
        champion: champion ? champion.name : "Unknown",
        runnerUp: runnerUp ? runnerUp.name : "Unknown",
        tier2Champion: tier2Teams[0] ? tier2Teams[0].name : "Unknown",
        youthChampion: youthTeams[0] ? youthTeams[0].name : "Unknown",
        leaders: {
            passer: topPasser && (topPasser.seasonStats?.passYards || 0) > 0 ? `${topPasser.name} (${topPasser.seasonStats.passYards} yds)` : 'None',
            rusher: topRusher && (topRusher.seasonStats?.rushYards || 0) > 0 ? `${topRusher.name} (${topRusher.seasonStats.rushYards} yds)` : 'None',
            tackler: topTackler && (topTackler.seasonStats?.tackles || 0) > 0 ? `${topTackler.name} (${topTackler.seasonStats.tackles} tkls)` : 'None'
        },
        standings: [...tier1Teams, ...tier2Teams].map(t => ({ name: t.name, wins: t.wins, losses: t.losses, tier: t.tier })),
        promoted: promoted.map(t => t.name),
        relegated: relegated.map(t => t.name),
        draftResults: []
    });
}

export function generateSchedule() {
    if (!game || !game.teams) return;
    game.schedule = [];
    game.currentWeek = 0;
    const numWeeks = 9;
    const allWeeklyGames = Array(numWeeks).fill(null).map(() => []);

    const schedulePool = (poolTeams) => {
        if (poolTeams.length < 2) return;
        const t0 = poolTeams[0];
        const others = poolTeams.slice(1);

        for (let round = 0; round < numWeeks; round++) {
            if (others.length > 0) {
                allWeeklyGames[round].push({ home: t0, away: others[0] });
                for (let i = 1; i < others.length / 2; i++) {
                    const home = others[i];
                    const away = others[others.length - i];
                    if (home && away) {
                        allWeeklyGames[round].push(round % 2 === 0 ? { home, away } : { home: away, away: home });
                    }
                }
                others.push(others.shift());
            }
        }
    };

    schedulePool(game.teams.filter(t => t.tier === 1));
    schedulePool(game.teams.filter(t => t.tier === 2));
    schedulePool(game.teams.filter(t => t.leagueType === 'youth'));

    game.schedule = allWeeklyGames.flat();
}

export function updatePlayerStatuses() {
    if (!game || !game.players) return;
    for (const player of game.players) {
        if (!player || !player.status) continue;
        if (player.status.duration > 0) {
            player.status.duration--;
            if (player.status.duration === 0) {
                player.status.type = 'healthy';
                player.status.description = '';
                if (player.teamId === game.playerTeam?.id) {
                    addMessage('Player Recovered', `${player.name} is now available.`);
                }
            }
        }
        if (player.breakthroughAttr) delete player.breakthroughAttr;
        if (player.status.isNew) player.status.isNew = false;
    }
}

export function endOfWeekCleanup() {
    if (!game || !game.teams) return;
    game.teams.forEach(team => {
        if (!team || !Array.isArray(team.roster)) return;
        team.roster = team.roster.filter(id => {
            const player = getPlayer(id);
            if (!player) return false;
            if (player.status?.type === 'temporary') {
                player.teamId = null;
                player.number = null;
                return false;
            }
            return true;
        });
        rebuildDepthChartFromOrder(team);
    });
}

export function generateWeeklyEvents() {
    if (!game || !game.teams) return;

    game.teams.forEach(team => {
        const roster = getRosterObjects(team);
        if (roster.length === 0) return;

        roster.forEach(player => {
            if (player.status?.duration > 0) return;

            const dependability = player.personality?.dependability || 60;
            const flakeChance = (100 - dependability) / 1800;

            if (Math.random() < flakeChance) {
                const reasons = [
                    'Grounded for bad report card',
                    'Family road trip to visit grandma',
                    'Has to babysit younger sibling',
                    'Got detention after school'
                ];
                const reason = getRandom(reasons);
                player.status = { type: 'busy', description: reason, duration: getRandomInt(1, 2), isNew: true };
                if (team.id === game.playerTeam?.id) {
                    addMessage('Unavailable this week', `⚠️ ${player.name} cannot play: ${reason}.`);
                }
                return;
            }

            if (Math.random() < 0.004) {
                const buddy = roster.find(other =>
                    other.id !== player.id &&
                    getRelationshipLevel(player.id, other.id) >= relationshipLevels.GOOD_FRIEND.level
                );

                if (buddy && buddy.status?.duration === 0) {
                    player.status = { type: 'busy', description: 'Flat bike tire / missed ride', duration: 1, isNew: true };
                    buddy.status = { type: 'busy', description: 'Flat bike tire / missed ride', duration: 1, isNew: true };
                    if (team.id === game.playerTeam?.id) {
                        addMessage('Bike Disaster!', `🚲 ${player.name} and ${buddy.name} ride together to games, but their bike chain snapped on the way! Both miss this week.`);
                    }
                    return;
                }
            }

            if (dependability < 40 && Math.random() < 0.01) {
                const smartTeammate = roster.find(other => (other.attributes?.mental?.playbookIQ || 50) > 75);
                if (smartTeammate) {
                    player.personality.dependability = Math.min(99, dependability + 5);
                    improveRelationship(player.id, smartTeammate.id);
                    if (team.id === game.playerTeam?.id) {
                        addMessage('Study Session', `📚 ${smartTeammate.name} helped ${player.name} pass his algebra test. His dependability improved (+5)!`);
                    }
                    return;
                }
            }

            if (Math.random() < 0.005) {
                const injuries = ['Sprained wrist climbing tree', 'Skateboard scrape', 'Jammed pinky in gym class'];
                const injury = getRandom(injuries);
                player.status = { type: 'injured', description: injury, duration: 1, isNew: true };
                if (team.id === game.playerTeam?.id) {
                    addMessage('Minor Injury', `🩹 ${player.name} is resting: ${injury}.`);
                }
            }
        });
    });
}

export function processRelationshipEvents() {
    if (!game || !game.players || game.players.length < 2) return;
    const numEvents = getRandomInt(1, 3);
    const eventChanceImprove = 0.6;
    for (let i = 0; i < numEvents; i++) {
        let p1Index = getRandomInt(0, game.players.length - 1);
        let p2Index = getRandomInt(0, game.players.length - 1);
        let attempts = 0;
        while (p1Index === p2Index && attempts < 10) {
            p2Index = getRandomInt(0, game.players.length - 1); attempts++;
        }
        if (p1Index === p2Index) continue;
        const p1 = game.players[p1Index];
        const p2 = game.players[p2Index];
        if (!p1 || !p2) continue;
        if (Math.random() < eventChanceImprove) {
            improveRelationship(p1.id, p2.id);
        } else {
            decreaseRelationship(p1.id, p2.id);
        }
    }
}

export function processEndOfWeek() {
    if (!game) return;
    updatePlayerStatuses();
    generateWeeklyEvents();
    processRelationshipEvents();
    endOfWeekCleanup();
}

export function getTeamNetworkRecruits(team) {
    if (!team || !team.roster || !game || !game.players) return [];

    const rosterIds = new Set(team.roster);
    const unassignedPlayers = game.players.filter(p =>
        p && !p.teamId && p.status?.type !== 'retired' && p.status?.type !== 'departed'
    );

    const connectedRecruits = [];
    unassignedPlayers.forEach(freeAgent => {
        let highestRelationship = relationshipLevels.STRANGER.level;
        let connectedTeammate = null;

        for (const rosterPlayerId of rosterIds) {
            const rel = getRelationshipLevel(rosterPlayerId, freeAgent.id);
            if (rel > highestRelationship) {
                highestRelationship = rel;
                connectedTeammate = getPlayer(rosterPlayerId);
            }
        }

        if (highestRelationship >= relationshipLevels.ACQUAINTANCE.level) {
            const scouted = getScoutedPlayerInfo(freeAgent, highestRelationship);
            scouted.connectedBuddyName = connectedTeammate?.name || 'A teammate';
            scouted.networkStrength = highestRelationship;
            connectedRecruits.push(scouted);
        }
    });

    return connectedRecruits.sort((a, b) => b.networkStrength - a.networkStrength);
}

export function generateWeeklyFreeAgents() {
    if (!game || !game.playerTeam) return;
    game.freeAgents = getTeamNetworkRecruits(game.playerTeam).slice(0, 6);
}

export function callFriend(playerId) {
    if (!game || !game.playerTeam || !game.playerTeam.roster || !game.freeAgents) {
        return { success: false, message: "Game state error prevented calling friend." };
    }
    const team = game.playerTeam;
    if (!team.socialProfile) team.socialProfile = { favorTokens: 3, streetCred: 50 };
    if (team.socialProfile.favorTokens <= 0) {
        return { success: false, message: "You are out of Favor Tokens for this season! No one owes you a ride." };
    }

    const roster = getRosterObjects(team);
    const healthyCount = roster.filter(p => p && (!p.status || p.status.duration === 0)).length;

    if (healthyCount >= 16) {
        return { success: false, message: "Your roster is full enough (16+ active). Save your favors for when you're desperate." };
    }
    const player = game.freeAgents.find(p => p && p.id === playerId);
    if (!player) return { success: false, message: "That player is no longer hanging around the park this week." };

    // --- LOGIC-BASED ACCEPTANCE CALCULATION ---
    let interestScore = Math.round((team.socialProfile.streetCred || 50) * 0.3);
    if (team.tier === 1) interestScore += 8; // Prestige of playing under the lights

    let decisionReasons = [];

    // 1. Friend & Clique Anchors
    const hasBestFriend = player.social?.bestFriendId && roster.some(r => r.id === player.social.bestFriendId);
    if (hasBestFriend) {
        interestScore += 35;
        const bfName = roster.find(r => r.id === player.social.bestFriendId)?.name || 'his best friend';
        decisionReasons.push(`wanted to play with ${bfName}`);
    }

    const friendsOnTeam = roster.filter(r => player.social?.goodFriendIds?.includes(r.id)).length;
    if (friendsOnTeam > 0) {
        const boost = Math.min(24, friendsOnTeam * 12);
        interestScore += boost;
        decisionReasons.push(`has ${friendsOnTeam} friend(s) on the squad`);
    }

    const captain = roster.find(r => r.id === team.captainId);
    if (captain && captain.personality?.clique === player.personality?.clique) {
        interestScore += 10;
        decisionReasons.push(`vibes with team captain ${captain.name.split(' ')[0]} (${player.personality.clique})`);
    }

    // 2. Sworn Rival Penalty
    const rivalOnTeam = roster.find(r => player.social?.rivalIds?.includes(r.id));
    if (rivalOnTeam) {
        interestScore -= 50;
        decisionReasons.push(`refuses to wear the same jersey as his rival ${rivalOnTeam.name}`);
    }

    // 3. Ego vs. Role Evaluation
    const bestPos = player.pos || estimateBestPosition(player);
    const myOvr = calculateOverall(player, bestPos);
    const isStarterWorthy = myOvr >= 45 || healthyCount < 9;

    if (isStarterWorthy) {
        interestScore += 15;
    } else {
        const ego = player.personality?.ego || 50;
        if (ego > 70) {
            const egoPenalty = Math.round((ego - 50) * 0.9);
            interestScore -= egoPenalty;
            decisionReasons.push(`refuses to ride the bench with his high ego`);
        }
    }

    // Remove from the weekly free agent screen
    game.freeAgents = game.freeAgents.filter(p => p && p.id !== playerId);

    if (interestScore >= 50) {
        // Player accepts offer!
        player.status = { type: 'temporary', description: 'Helping Out', duration: 1 };
        if (addPlayerToTeam(player, team)) {
            team.socialProfile.favorTokens -= 1;
            const fullRoster = getRosterObjects(team);
            fullRoster.forEach(rosterPlayer => {
                if (rosterPlayer && rosterPlayer.id !== player.id) {
                    improveRelationship(rosterPlayer.id, player.id);
                }
            });
            const reasonBlurb = decisionReasons.length > 0 ? ` (${decisionReasons.join(', ')})` : '';
            const message = `🤝 ${player.name} agreed to help out!${reasonBlurb} [Favors Left: ${team.socialProfile.favorTokens}]`;
            addMessage("Roster Update: Friend Joined", message);
            return { success: true, message };
        } else {
            return { success: false, message: `Failed to add ${player.name} to roster.` };
        }
    } else {
        // Player declines offer!
        const declineReason = decisionReasons.slice(-1)[0] || 'was not interested in joining right now';
        const message = `✋ ${player.name} declined the invite: ${declineReason}. (Favor Token preserved).`;
        addMessage("Roster Update: Invite Declined", message);
        return { success: false, message };
    }
}

export function aiManageRoster(team) {
    if (!team || !team.roster || !game || !team.coach) return;

    const roster = getRosterObjects(team);
    let playableCount = roster.filter(p =>
        p && (!p.status || p.status.duration === 0 || p.status.type === 'temporary')
    ).length;

    const aiAvailableNetwork = getTeamNetworkRecruits(team);

    while (
        playableCount < MIN_HEALTHY_PLAYERS &&
        team.roster.length < ROSTER_LIMIT &&
        aiAvailableNetwork.length > 0
    ) {
        const bestFA = aiAvailableNetwork.reduce((best, current) => {
            if (!best) return current;
            const currentScore = getPlayerScore(current, team.coach) + (current.networkStrength * 15);
            const bestScore = getPlayerScore(best, team.coach) + (best.networkStrength * 15);
            return currentScore > bestScore ? current : best;
        }, null);

        if (!bestFA) break;

        const idx = aiAvailableNetwork.findIndex(p => p.id === bestFA.id);
        if (idx > -1) aiAvailableNetwork.splice(idx, 1);

        const masterFA = getPlayer(bestFA.id);
        if (!masterFA) continue;

        const originalStatus = masterFA.status;
        masterFA.status = { type: 'temporary', description: 'Helping Out', duration: 1 };

        if (addPlayerToTeam(masterFA, team)) {
            playableCount++;
        } else {
            masterFA.status = originalStatus;
        }
    }

    if (team.roster.length < ROSTER_LIMIT && team.socialProfile?.favorTokens > 0) {
        const topFriend = aiAvailableNetwork.reduce((best, p) => {
            if (p.networkStrength < relationshipLevels.GOOD_FRIEND.level) return best;
            const score = getPlayerScore(p, team.coach) + (p.networkStrength * 20) + (p.personality?.streetCred || 50);
            return score > (best ? best._score : 150) ? { ...p, _score: score } : best;
        }, null);

        if (topFriend && Math.random() < 0.3) {
            const masterFriend = getPlayer(topFriend.id);
            if (masterFriend) {
                masterFriend.status = { type: 'healthy', description: '', duration: 0 };
                if (addPlayerToTeam(masterFriend, team)) {
                    team.socialProfile.favorTokens -= 1;
                }
            }
        }
    }

    aiSetDepthChart(team);
}

export function developPlayer(player, team = null) {
    if (!player || !player.attributes) return { player, improvements: [] };
    const developmentReport = { player, improvements: [] };

    const potentialMultipliers = { 'A': 1.5, 'B': 1.25, 'C': 1.0, 'D': 0.75, 'F': 0.5 };
    const potMod = potentialMultipliers[player.potential] || 1.0;
    const ethic = player.personality?.workEthic || 50;
    const ethicMod = 0.5 + (ethic / 100);

    const snaps = player.careerStats?.snapsThisSeason || 0;
    const experienceMod = Math.min(1.5, 0.6 + (snaps / 500));

    let mentorBoost = 0;
    if (team && player.age <= 13) {
        const roster = getRosterObjects(team);
        const hasOlderMentor = roster.some(teammate =>
            teammate.age >= 15 &&
            getRelationshipLevel(player.id, teammate.id) >= relationshipLevels.GOOD_FRIEND.level
        );
        if (hasOlderMentor) mentorBoost = 1;
    }

    let basePoints = 0;
    let focusGroup = [];

    if (player.age <= 12) {
        basePoints = getRandomInt(3, 5);
        focusGroup = ['speed', 'agility', 'stamina', 'catchingHands'];
    } else if (player.age <= 14) {
        basePoints = getRandomInt(2, 4);
        focusGroup = ['throwingAccuracy', 'catchingHands', 'blocking', 'tackling', 'speed', 'strength'];
    } else if (player.age <= 16) {
        basePoints = getRandomInt(1, 3);
        focusGroup = ['playbookIQ', 'consistency', 'toughness', 'blockShedding', 'throwingAccuracy'];
    } else {
        basePoints = getRandomInt(0, 1);
        focusGroup = ['playbookIQ', 'consistency'];
    }

    let totalUpgradePoints = Math.round((basePoints * potMod * ethicMod * experienceMod)) + mentorBoost;

    if (ethic < 25 && player.age >= 15 && Math.random() < 0.35) {
        const regressedAttr = getRandom(['speed', 'stamina', 'agility']);
        for (const cat in player.attributes) {
            if (player.attributes[cat]?.[regressedAttr] && player.attributes[cat][regressedAttr] > 30) {
                player.attributes[cat][regressedAttr] -= 1;
                developmentReport.improvements.push({ attr: `${regressedAttr} (Slacked off)`, increase: -1 });
                break;
            }
        }
    }

    for (let i = 0; i < totalUpgradePoints; i++) {
        const pool = (Math.random() < 0.70 && focusGroup.length > 0)
            ? focusGroup
            : ['speed', 'strength', 'agility', 'throwingAccuracy', 'catchingHands', 'tackling', 'blocking', 'playbookIQ', 'blockShedding', 'toughness', 'consistency'];

        const attrToBoost = getRandom(pool);

        for (const category in player.attributes) {
            if (player.attributes[category]?.[attrToBoost] !== undefined && player.attributes[category][attrToBoost] < 99) {
                player.attributes[category][attrToBoost] = Math.min(99, player.attributes[category][attrToBoost] + 1);
                const existing = developmentReport.improvements.find(imp => imp.attr === attrToBoost);
                if (existing) existing.increase += 1;
                else developmentReport.improvements.push({ attr: attrToBoost, increase: 1 });
                break;
            }
        }
    }

    const heightGain = player.age <= 12 ? getRandomInt(1, 3) : (player.age <= 14 ? getRandomInt(0, 2) : 0);
    const weightGain = player.age <= 12 ? getRandomInt(8, 18) : (player.age <= 14 ? getRandomInt(6, 14) : getRandomInt(2, 6));

    if (heightGain > 0) developmentReport.improvements.push({ attr: 'height', increase: heightGain });
    if (weightGain > 0) developmentReport.improvements.push({ attr: 'weight', increase: weightGain });

    if (!player.attributes.physical) player.attributes.physical = {};
    player.attributes.physical.height = (player.attributes.physical.height || 50) + heightGain;
    player.attributes.physical.weight = (player.attributes.physical.weight || 100) + weightGain;

    if (!player.careerStats) player.careerStats = {};
    player.careerStats.snapsThisSeason = 0;

    return developmentReport;
}

export function advanceToOffseason() {
    if (!game || !game.teams || !game.players) return { retiredPlayers: [], hofInductees: [], developmentResults: [], leavingPlayers: [] };
    
    // Initialize tracking arrays at the top so any offseason phase can safely push to them
    const retiredPlayers = []; 
    const hofInductees = []; 
    const developmentResults = []; 
    const leavingPlayers = [];
    let totalVacancies = 0;

    // CAPTURE STANDINGS & HISTORY BEFORE RESETTING STATS
    const tier1 = game.teams.filter(t => t.tier === 1).sort((a, b) => (b.wins || 0) - (a.wins || 0) || (a.losses || 0) - (b.losses || 0));
    const tier2 = game.teams.filter(t => t.tier === 2).sort((a, b) => (b.wins || 0) - (a.wins || 0) || (a.losses || 0) - (b.losses || 0));
    const youthT = game.teams.filter(t => t.leagueType === 'youth').sort((a, b) => (b.wins || 0) - (a.wins || 0) || (a.losses || 0) - (b.losses || 0));

    const relegated = tier1.slice(-2);
    const promoted = tier2.slice(0, 2);

    // Capture reverse standings for next draft before wins/losses reset
    const mainTeams = game.teams.filter(t => t.leagueType === 'main');
    game.nextDraftOrder = [...mainTeams].sort((a, b) => 
        (a.wins || 0) - (b.wins || 0) || (b.losses || 0) - (a.losses || 0)
    ).map(t => t.id);

    let proRelMsg = "League Tiers hold steady this year.";
    if (tier1.length > 2 && tier2.length > 2) {
        relegated.forEach(t => { t.tier = 2; t.socialProfile.streetCred -= 20; });
        promoted.forEach(t => { t.tier = 1; t.socialProfile.streetCred += 20; });
        proRelMsg = `**PROMOTED:** ${promoted[0].name}, ${promoted[1].name}\n**RELEGATED:** ${relegated[0].name}, ${relegated[1].name}`;

        if (relegated.some(t => t.id === game.playerTeam?.id)) {
            addMessage("Relegated!", "We finished at the bottom of the league and have been relegated to the Sandlot Circuit (Tier 2). We must fight our way back up!", false, game);
        } else if (promoted.some(t => t.id === game.playerTeam?.id)) {
            addMessage("Promoted!", "We won the Sandlot Circuit! Next year we play with the big dogs in Tier 1.", false, game);
        }

        // Relegation Walkouts: Divas with low loyalty refuse to play in Tier 2
        relegated.forEach(relTeam => {
            const teamRoster = getRosterObjects(relTeam);
            teamRoster.forEach(p => {
                if ((p.personality?.streetCred || 50) > 65 && (p.personality?.loyalty || 50) < 45) {
                    leavingPlayers.push({ player: p, reason: 'Refused to play in Sandlot Circuit (Tier 2)', teamName: relTeam.name });
                    p.teamId = null;
                    if (relTeam.id === game.playerTeam?.id) {
                        addMessage("Relegation Walkout", `🏃 ${p.name} refused to play in Tier 2 and walked away to Free Agency!`);
                    }
                }
            });
        });
    }

    if (!game.history) game.history = { seasons: [] };
    // Only push if this year hasn't already been pushed by historical simulation
    if (!game.history.seasons.some(s => s.year === game.year)) {
        const allPlayers = game.players || [];
        const topPasser = [...allPlayers].sort((a, b) => (b.seasonStats?.passYards || 0) - (a.seasonStats?.passYards || 0))[0];
        const topRusher = [...allPlayers].sort((a, b) => (b.seasonStats?.rushYards || 0) - (a.seasonStats?.rushYards || 0))[0];
        const topTackler = [...allPlayers].sort((a, b) => (b.seasonStats?.tackles || 0) - (a.seasonStats?.tackles || 0))[0];

        game.history.seasons.push({
            year: game.year,
            champion: tier1[0]?.name || "Unknown",
            runnerUp: tier1[1]?.name || "Unknown",
            tier2Champion: tier2[0]?.name || "Unknown",
            youthChampion: youthT[0]?.name || "Unknown",
            leaders: {
                passer: topPasser && (topPasser.seasonStats?.passYards || 0) > 0 ? `${topPasser.name} (${topPasser.seasonStats.passYards} yds)` : 'None',
                rusher: topRusher && (topRusher.seasonStats?.rushYards || 0) > 0 ? `${topRusher.name} (${topRusher.seasonStats.rushYards} yds)` : 'None',
                tackler: topTackler && (topTackler.seasonStats?.tackles || 0) > 0 ? `${topTackler.name} (${topTackler.seasonStats.tackles} tkls)` : 'None'
            },
            promoted: promoted.map(t => t.name),
            relegated: relegated.map(t => t.name),
            standings: [...tier1, ...tier2].map(t => ({ name: t.name, wins: t.wins, losses: t.losses, tier: t.tier })),
            draftResults: []
        });
    }

    game.year++;

    const teammateImproveChance = 0.15;
    game.teams.forEach(team => {
        if (!team || !team.roster || team.roster.length < 2) return;
        const fullRoster = getRosterObjects(team);
        if (fullRoster.length < 2) return;

        for (let i = 0; i < fullRoster.length; i++) {
            for (let j = i + 1; j < fullRoster.length; j++) {
                const p1 = fullRoster[i]; const p2 = fullRoster[j];
                if (!p1 || !p2) continue;
                if (Math.random() < teammateImproveChance) improveRelationship(p1.id, p2.id);
            }
        }
    });

    const departureEvents = [
        { reason: 'Moved Away', chance: 0.03 },
        { reason: 'Focusing on another sport', chance: 0.02 },
        { reason: 'Decided to quit', chance: 0.01 }
    ];

    // Process ALL players in the universe (ZenGM style) to fix Free Agent aging/leaks
    game.players.forEach(player => {
        if (!player.careerStats || !player.attributes) return;

        const team = player.teamId ? game.teams.find(t => t.id === player.teamId) : null;
        const teamName = team ? team.name : 'Free Agent';

        // Check Season and Career Records
        if (!game.records) game.records = { game: {}, season: {}, career: {} };
        
        const checkSeasonRec = (statKey, val) => {
            if (!game.records.season[statKey]) game.records.season[statKey] = { val: 0, holder: 'None', year: 0 };
            if (val > game.records.season[statKey].val) {
                game.records.season[statKey] = { val, holder: player.name, year: game.year };
            }
        };
        
        const checkCareerRec = (statKey, val) => {
            if (!game.records.career[statKey]) game.records.career[statKey] = { val: 0, holder: 'None' };
            if (val > game.records.career[statKey].val) {
                game.records.career[statKey] = { val, holder: player.name };
            }
        };

        const sStats = player.seasonStats || {};
        checkSeasonRec('passYards', sStats.passYards || 0);
        checkSeasonRec('rushYards', sStats.rushYards || 0);
        checkSeasonRec('recYards', sStats.recYards || 0);
        checkSeasonRec('touchdowns', sStats.touchdowns || 0);
        checkSeasonRec('tackles', sStats.tackles || 0);
        checkSeasonRec('sacks', sStats.sacks || 0);
        checkSeasonRec('interceptions', sStats.interceptions || 0);

        const cStats = player.careerStats || {};
        checkCareerRec('passYards', cStats.passYards || 0);
        checkCareerRec('rushYards', cStats.rushYards || 0);
        checkCareerRec('recYards', cStats.recYards || 0);
        checkCareerRec('touchdowns', cStats.touchdowns || 0);
        checkCareerRec('tackles', cStats.tackles || 0);
        checkCareerRec('sacks', cStats.sacks || 0);
        checkCareerRec('interceptions', cStats.interceptions || 0);

        // Record End-of-Year Progression Snapshot
        if (!player.progression) player.progression = [];
        player.progression.push({
            year: game.year,
            age: player.age,
            teamName: teamName,
            ovr: calculateOverall(player, estimateBestPosition(player)),
            stats: {
                passYards: player.seasonStats?.passYards || 0,
                rushYards: player.seasonStats?.rushYards || 0,
                recYards: player.seasonStats?.recYards || 0,
                touchdowns: player.seasonStats?.touchdowns || 0,
                tackles: player.seasonStats?.tackles || 0
            }
        });

        player.age++;
        player.careerStats.seasonsPlayed = (player.careerStats.seasonsPlayed || 0) + 1;
        const snapsThisSeason = player.careerStats.snapsThisSeason || 0;

        // --- THE AGING PROCESS: ARROGANCE & LAZINESS ---
        // As kids become older teenagers, their ego inflates, loyalty drops, and stamina decays
        if (player.age >= 15) {
            if (player.personality) {
                player.personality.ego = Math.min(100, (player.personality.ego || 50) + getRandomInt(2, 6));
                player.personality.loyalty = Math.max(0, (player.personality.loyalty || 50) - getRandomInt(1, 4));
            }
            if (player.attributes?.physical?.stamina) {
                player.attributes.physical.stamina = Math.max(15, player.attributes.physical.stamina - getRandomInt(2, 5));
            }
            // Update their expectations dynamically
            if (player.expectations) {
                player.expectations.desiredRole = 'STARTER';
                if (['QB', 'RB', 'WR', 'TE'].includes(player.favoriteOffensivePosition)) {
                    player.expectations.minTouchesPerGame = Math.floor((player.age - 14) * 1.5);
                }
            }
        }

        const devReport = developPlayer(player, team);
        if (team && team.id === game.playerTeam?.id) developmentResults.push(devReport);

        let playerIsLeaving = false;

        // Everyone retires at age 19 (After their 18yo Senior season), even Free Agents
        if (player.age >= 19) {
            retiredPlayers.push(player);
            playerIsLeaving = true;
            if (team && team.id === game.playerTeam?.id) addMessage("Player Retires", `${player.name} is moving on from the league.`);
            if ((player.careerStats.touchdowns || 0) > 25) {
                if (!game.hallOfFame) game.hallOfFame = [];
                game.hallOfFame.push(player); hofInductees.push(player);
                if (team && team.id === game.playerTeam?.id) addMessage("Hall of Fame!", `${player.name} inducted!`);
            }
        } else if (team) {
            // Roster specific morale checks
            if (!player.expectations) player.expectations = { desiredRole: 'DEVELOPMENTAL', minTouchesPerGame: 0, happiness: 100 };

            const gamesPlayed = 9;
            const snapsPerGame = snapsThisSeason / gamesPlayed;
            const touchesPerGame =
                ((player.seasonStats?.rushAttempts || 0) +
                    (player.seasonStats?.targets || 0) +
                    (player.seasonStats?.passAttempts || 0)) / gamesPlayed;

            if (player.expectations.desiredRole === 'STARTER' && snapsPerGame < 35) {
                player.expectations.happiness -= 30;
            } else if (player.expectations.desiredRole === 'ROTATION' && snapsPerGame < 15) {
                player.expectations.happiness -= 20;
            }

            if (touchesPerGame < player.expectations.minTouchesPerGame) {
                player.expectations.happiness -= 25;
            }

            if (team.socialProfile && team.socialProfile.streetCred < 35) {
                player.expectations.happiness -= 15;
            } else if (team.socialProfile && team.socialProfile.streetCred > 65) {
                player.expectations.happiness += 10;
            }

            const egoDrop = (player.personality?.ego || 50) > 70 ? 25 : 0;
            if (player.expectations.happiness - egoDrop < 40) {
                if ((player.personality?.loyalty || 50) < 40) {
                    leavingPlayers.push({ player, reason: `Ego clash / Demanded transfer to a better situation`, teamName: team.name });
                    playerIsLeaving = true;
                    if (team.id === game.playerTeam?.id) {
                        addMessage("Transfer Request", `😠 ${player.name} feels he is a superstar being held back. He has left the team!`);
                    }
                } else {
                    if (team.id === game.playerTeam?.id && Math.random() < 0.3) {
                        addMessage("Locker Room Drama", `⚠️ ${player.name} is extremely frustrated with his role but his loyalty is keeping him here... for now.`);
                    }
                }
            } else {
                for (const event of departureEvents) {
                    if (Math.random() < event.chance) {
                        leavingPlayers.push({ player, reason: event.reason, teamName: team.name });
                        playerIsLeaving = true;
                        if (team.id === game.playerTeam?.id) addMessage("Player Leaving", `${player.name}: ${event.reason}.`);
                        break;
                    }
                }
            }
        }

        if (!playerIsLeaving) {
            player.seasonStats = { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0, sacks: 0, interceptions: 0, passAttempts: 0, passCompletions: 0, interceptionsThrown: 0 };
            if (!player.status) player.status = {};
            player.status = { type: 'healthy', description: '', duration: 0 };
        } else {
            if (team) {
                if (!player.playerHistory) player.playerHistory = { teamsPlayedFor: [] };
                player.playerHistory.teamsPlayedFor.push({ teamId: team.id, teamName: team.name, year: game.year });
            }
            player.teamId = null;
            player.status = {
                type: player.age >= 19 ? 'retired' : 'departed',
                description: player.age >= 19 ? 'Graduated High School' : 'Left the league',
                duration: 0
            };
            totalVacancies++;
        }
    });

    // Re-compile valid rosters based on the updated universal player pool
    game.teams.forEach(team => {
        team.roster = game.players
            .filter(p => p.teamId === team.id && (!p.status || p.status.duration === 0 || p.status.type === 'healthy'))
            .map(p => p.id);

        if (team.depthChart && team.formations) {
            const offSlots = offenseFormations[team.formations.offense]?.slots || [];
            team.depthChart.offense = Object.fromEntries(offSlots.map(slot => [slot, null]));
            const defSlots = defenseFormations[team.formations.defense]?.slots || [];
            team.depthChart.defense = Object.fromEntries(defSlots.map(slot => [slot, null]));
        }
        team.wins = 0; team.losses = 0; team.ties = 0;

        if (team.socialProfile) {
            team.socialProfile.favorTokens = 3 + (team.socialProfile.streetCred >= 75 ? 1 : 0);
            team.socialProfile.streetCred = Math.round((team.socialProfile.streetCred + 50) / 2);
        }

        aiSetDepthChart(team);
    });

    const undraftedYoungPlayers = game.players.filter(p => p && !p.teamId && p.age < 17);
    if (game.playerTeam && game.playerTeam.roster && game.playerTeam.roster.length < ROSTER_LIMIT && Math.random() < 0.03 && undraftedYoungPlayers.length > 0) {
        const joiningPlayer = getRandom(undraftedYoungPlayers);
        if (joiningPlayer) {
            if (addPlayerToTeam(joiningPlayer, game.playerTeam)) {
                addMessage("New Player Joined!", `${joiningPlayer.name} heard about your team and asked to join!`);
                aiSetDepthChart(game.playerTeam);
            }
        }
    }

    // 💡 FREE AGENT ATTRITION (Cull unassigned kids so the pool never bloats)
    game.players.forEach(p => {
        if (!p.teamId && p.status?.type !== 'retired' && p.status?.type !== 'departed') {
            let quitChance = 0.10;
            if (p.age >= 14 && p.age <= 16) quitChance = 0.25;
            if (p.age >= 17) quitChance = 0.40;
            if (Math.random() < quitChance) {
                p.status = {
                    type: 'departed',
                    description: p.age >= 16 ? 'Got a job and bought a car / focused on varsity sports' : 'Quit football to skateboard and play video games',
                    duration: 0
                };
            }
        }
    });

    // 💡 PEE-WEE GRADUATION → LOGICAL DRAFT DECLARATION
    if (!game.draftClass) game.draftClass = [];
    const youthTeams = game.teams.filter(t => t.leagueType === 'youth');

    youthTeams.forEach(yt => {
        yt.roster = yt.roster.filter(id => {
            const kid = getPlayer(id);
            if (!kid) return false;

            developPlayer(kid, yt);
            kid.age++;
            kid.careerStats.seasonsPlayed = (kid.careerStats.seasonsPlayed || 0) + 1;

            if (kid.age >= 11) {
                kid.teamId = null;
                kid.seasonStats = {};
                kid.careerStats.snapsThisSeason = 0;

                // LOGIC: Does the kid declare for the draft or wait as a street walk-on?
                const ego = kid.personality?.ego || 50;
                const loyalty = kid.personality?.loyalty || 60;
                const bestFriend = kid.social?.bestFriendId ? getPlayer(kid.social.bestFriendId) : null;
                const friendOnMainTeam = bestFriend && bestFriend.teamId;

                let entersDraft = true;
                if (friendOnMainTeam && Math.random() < 0.50) {
                    entersDraft = false; // Bypasses draft to be recruited by buddy's team!
                } else if (ego >= 80 && loyalty < 40 && Math.random() < 0.40) {
                    entersDraft = false; // Diva skips draft to pick landing spot later
                }

                if (entersDraft) {
                    kid.lifecycle = 'draft_eligible';
                    if (!kid.personality) kid.personality = {};
                    kid.personality.entersDraft = true;
                    game.draftClass.push(kid);
                } else {
                    kid.lifecycle = 'active';
                    if (!kid.personality) kid.personality = {};
                    kid.personality.entersDraft = false;
                }
                return false;
            }
            return true;
        });
        yt.wins = 0; yt.losses = 0; yt.ties = 0;
    });

    // 💡 TOP OFF DRAFT CLASS WITH STRICTLY AGE 11 ROOKIES (Guarantee 65 prospects for 60 picks)
    const thisYearsClassModifiers = generateDraftClassModifiers();
    const neededDraftRookies = Math.max(0, 65 - game.draftClass.length);
    const newAge11Rookies = [];

    for (let i = 0; i < neededDraftRookies; i++) {
        const rookie = generatePlayer(11, 11, thisYearsClassModifiers); // STRICTLY AGE 11
        rookie.lifecycle = 'draft_eligible';
        if (!rookie.personality) rookie.personality = {};
        rookie.personality.entersDraft = true;
        game.players.push(rookie);
        playerMap.set(rookie.id, rookie);
        game.draftClass.push(rookie);
        newAge11Rookies.push(rookie);
    }

    // 💡 GENERATE OLDER MOVE-INS (Ages 12-17) DIRECTLY INTO STREET FREE AGENCY
    const newOlderWalkons = [];
    for (let i = 0; i < 5; i++) {
        const olderKid = generatePlayer(12, 17, thisYearsClassModifiers);
        olderKid.lifecycle = 'active';
        if (!olderKid.personality) olderKid.personality = {};
        olderKid.personality.entersDraft = false;
        game.players.push(olderKid);
        playerMap.set(olderKid.id, olderKid);
        newOlderWalkons.push(olderKid);
    }

    // Connect new recruits into the social network
    const livingActivePlayers = game.players.filter(p => p.status?.type !== 'retired' && p.status?.type !== 'departed');
    buildSocialNetworks([...newAge11Rookies, ...newOlderWalkons], livingActivePlayers);

    addMessage("Offseason Summary", `Offseason complete. ${totalVacancies} roster spots opened.\n\n${proRelMsg}\n\nPreparing for the draft.`, false, game);

    // 💡 BACKFILL PEE-WEE LEAGUE WITH NEW 8-YEAR-OLDS
    youthTeams.forEach(yt => {
        while (yt.roster.length < 14) {
            const freshKid = generatePlayer(8, 8, thisYearsClassModifiers);
            freshKid.teamId = yt.id;
            freshKid.lifecycle = 'youth';
            yt.roster.push(freshKid.id);
            game.players.push(freshKid);
            playerMap.set(freshKid.id, freshKid);
        }
        aiSetDepthChart(yt);
    });

    // 🚀 PERFORMANCE & MEMORY LEAK FIX
    // 1. Purge players who are retired/departed and NOT in the Hall of Fame
    const hofIds = new Set((game.hallOfFame || []).map(p => p.id));
    game.players = game.players.filter(p => {
        if (p.status?.type === 'retired' || p.status?.type === 'departed') {
            return hofIds.has(p.id);
        }
        return true;
    });

    // 2. Cap progression history size to prevent infinite array growth
    game.players.forEach(p => {
        if (p.progression && p.progression.length > 5) {
            p.progression = p.progression.slice(-5);
        }
    });

    // 3. Re-sync playerMap to drop dead references
    playerMap.clear();
    game.players.forEach(p => playerMap.set(p.id, p));

    game.gameResults = [];
    game.breakthroughs = [];
    game.currentWeek = 0;
    game.teams.forEach(t => assignTeamCaptain(t));

    return { retiredPlayers, hofInductees, developmentResults, leavingPlayers };
}

export function playerCut(playerId) {
    if (!game || !game.playerTeam || !game.playerTeam.roster) return { success: false, message: "Game state error." };
    const team = game.playerTeam;
    const playerIndex = team.roster.findIndex(pId => pId === playerId);

    if (playerIndex > -1) {
        const [removedId] = team.roster.splice(playerIndex, 1);
        const player = game.players.find(p => p && p.id === removedId);

        if (player.status?.type === 'temporary') {
            team.roster.splice(playerIndex, 0, removedId);
            return { success: false, message: "Cannot cut temporary friends." };
        }
        player.teamId = null;
        player.number = null;

        for (const side in team.depthChart) {
            if (team.depthChart[side]) {
                for (const slot in team.depthChart[side]) {
                    if (team.depthChart[side][slot] === playerId) { team.depthChart[side][slot] = null; }
                }
            }
        }
        aiSetDepthChart(team);
        addMessage("Roster Move", `${player.name} has been cut from the team.`);
        team.roster.forEach(rosterPlayerId => {
            if (rosterPlayerId) decreaseRelationship(rosterPlayerId, player.id);
        });
        return { success: true };
    }
    return { success: false, message: "Player not found on roster." };
}

export function playerSignFreeAgent(playerId) {
    if (!game || !game.playerTeam || !game.playerTeam.roster || !game.players) {
        return { success: false, message: "Game state error." };
    }
    const team = game.playerTeam;
    const roster = getRosterObjects(team);
    if (roster.length >= ROSTER_LIMIT) {
        return { success: false, message: `Roster is full (${ROSTER_LIMIT} players max).` };
    }

    const player = game.players.find(p => p && p.id === playerId && !p.teamId);
    if (player) {
        if (player.status?.duration > 0) {
            return { success: false, message: `${player.name} is currently unavailable.` };
        }
        if (addPlayerToTeam(player, team)) {
            aiSetDepthChart(team);
            addMessage("Roster Move", `${player.name} has been signed to the team!`);
            const fullRoster = getRosterObjects(team);
            fullRoster.forEach(rp => { if (rp && rp.id !== player.id) improveRelationship(rp.id, player.id); });
            return { success: true };
        }
        return { success: false, message: "Failed to add player to roster." };
    }
    return { success: false, message: "Player not found or not available." };
}
