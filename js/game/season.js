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
    rebuildDepthChartFromOrder, aiSetDepthChart, assignTeamCaptain, isPlayerViableForPosition
} from './depth_chart.js';
import {
    initializeTeamStaff, generateStaffPool, checkRetiredPlayerToCoach,
    aiManageTeamStaff, aiBuildGameplan, aiChooseWeeklyPractice,
    ensureAiStaffWorkPlan, getTeamCoachingSpecialist,
    processWeeklyCoachDevelopment, ensureTeamStaffWorkPlan,
    getEffectiveStaffWorkHours, processWeeklyStaffPreparation
} from './staff.js';
import {
    evaluatePlayerRetention,
    evaluatePlayerNegotiation,
    resolvePlayerBiddingWar,
    calculateAiTeamNeedAndDesire,
    createPlayerPromise,
    evaluateAiRetentionPitch
} from './negotiations.js';
import {
    processWeeklyScoutingAssignments,
    applyBankedDraftScoutingReports,
    initializeInheritedScoutingReports
} from './scouting.js';

export const ROSTER_LIMIT = 18;
export const REGULAR_SEASON_ROSTER_LIMIT = 18;
export const SUMMER_ROSTER_LIMIT = 24;
export const MIN_HEALTHY_PLAYERS = 8;
export const TEMPORARY_HELP_THRESHOLD = 12;
export const SEASON_DUES_PER_PLAYER = 9;

const createEmptySeasonStats = () => ({
    passYards: 0,
    passAttempts: 0,
    passCompletions: 0,
    interceptionsThrown: 0,
    rushYards: 0,
    rushAttempts: 0,
    recYards: 0,
    receptions: 0,
    targets: 0,
    drops: 0,
    tackles: 0,
    sacks: 0,
    interceptions: 0,
    fumbles: 0,
    fumblesLost: 0,
    fumblesRecovered: 0,
    touchdowns: 0,
    returnYards: 0,
    safeties: 0
});

export function getCurrentRosterLimit(gameState) {
    // Week 0 Summer expansion (24) only applies while draft and offseason FA are active
    if (gameState && gameState.currentWeek === 0 && !gameState.offseasonFACompleted) {
        return SUMMER_ROSTER_LIMIT;
    }
    return ROSTER_LIMIT;
}

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
        game.players.push(generatePlayer(12, 18, initialClassModifiers)); // Age 12-18 for main league
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
            ageMin: 12,
            ageMax: 18,
            primaryColor: colorSet?.primary || teamColors[0].primary,
            secondaryColor: colorSet?.secondary || teamColors[0].secondary,
            formations: { offense: prefOff, defense: prefDef },
            depthChart: {
                offense: Object.fromEntries((offenseFormationData?.slots || []).map(slot => [slot, null])),
                defense: Object.fromEntries((defenseFormationData?.slots || []).map(slot => [slot, null])),
                special: { P: null }
            },
            draftNeeds: 0,
            socialProfile: {
                streetCred: tier === 1 ? 60 : 35,
                favorTokens: 3
            },
            gameplan: {
                weeklyPractice: 'chalk_talk',
                delegatePractice: false,
                delegateGameplan: false,
                delegateDepthChart: false,
                gmDirective: 'COACH_AUTONOMY', // 'COACH_AUTONOMY', 'WIN_NOW', 'DEVELOP_YOUTH', 'HARD_CONDITIONING'
                installedOffense: ['Uni_StretchRight', 'Uni_Stick', 'Uni_Drive', 'Uni_HB_Screen', 'PA_Crossers', 'Uni_Mesh'],
                installedDefense: ['Cover_3_Sky', 'Man_Blitz_Base', 'Nickel_Tampa_2', 'Fire_Zone_3'],
                mastery: {
                    'Uni_InsideZone': 85,
                    'Uni_QuickSlants': 85,
                    'Uni_FourVerts': 80,
                    'Cover_2_Zone_Base': 85,
                    'Cover_1_Robber': 80,
                    'GoalLine_RunStuff': 85,
                    'Uni_StretchRight': 55,
                    'Uni_Stick': 60,
                    'Uni_Drive': 50,
                    'Uni_HB_Screen': 45,
                    'PA_Crossers': 40,
                    'Uni_Mesh': 50,
                    'Cover_3_Sky': 55,
                    'Man_Blitz_Base': 50,
                    'Nickel_Tampa_2': 45,
                    'Fire_Zone_3': 40
                }
            }
        };
        initializeTeamStaff(team);
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
            ageMax: 11,
            formations: { offense: 'Balanced', defense: '3-2-3' },
            depthChart: { offense: {}, defense: {}, special: { P: null } },
            isYouth: true
        };

        for (let j = 0; j < 14; j++) {
            const kid = generatePlayer(8, 11, initialClassModifiers);
            kid.teamId = yTeam.id;
            kid.lifecycle = 'youth';
            yTeam.roster.push(kid.id);
            game.players.push(kid);
            playerMap.set(kid.id, kid);
        }
        aiSetDepthChart(yTeam);
        game.teams.push(yTeam); // ✅ Now unified in game.teams
    }

    // Populate initial main-team rosters with positional balance and tier variance.
    const tier1Teams = game.teams.filter(t => t.tier === 1);
    const tier2Teams = game.teams.filter(t => t.tier === 2);

    const INITIAL_POSITION_TARGETS = {
        QB: 1,
        RB: 1,
        WR: 2,
        TE: 1,
        OL: 3,
        DL: 2,
        LB: 1,
        DB: 2
    };

    // Keep the overall talent pool sorted. Position-specific selections below
    // preserve that ordering, allowing Tier 1 to draw from stronger candidates.
    const unassigned = game.players
        .filter(p => !p.teamId && p.age >= 12 && p.age <= 18)
        .sort((a, b) =>
            calculateOverall(b, estimateBestPosition(b)) -
            calculateOverall(a, estimateBestPosition(a))
        );

    const pickInitialPlayer = (team, position, tier) => {
        const positionPool = unassigned.filter(
            p => (p.pos || estimateBestPosition(p)) === position
        );

        if (positionPool.length === 0) return false;

        // Tier 1 selects from the top 40% of available players at that position.
        // Tier 2 draws from the remaining pool.
        const candidatePool = tier === 1
            ? positionPool.slice(
                0,
                Math.max(1, Math.ceil(positionPool.length * 0.4))
            )
            : positionPool;

        const player = getRandom(candidatePool);
        if (!player || !addPlayerToTeam(player, team)) return false;

        const poolIndex = unassigned.findIndex(p => p.id === player.id);
        if (poolIndex !== -1) unassigned.splice(poolIndex, 1);

        return true;
    };

    const fillInitialRoster = (team, tier) => {
        const targetRosterSize = 14;

        // Fill the required positional groups first.
        for (const [position, targetCount] of Object.entries(INITIAL_POSITION_TARGETS)) {
            let assignedCount = 0;

            while (assignedCount < targetCount && team.roster.length < targetRosterSize) {
                if (!pickInitialPlayer(team, position, tier)) break;
                assignedCount++;
            }
        }

        // Use the remaining roster spot(s) for best available talent.
        while (team.roster.length < targetRosterSize && unassigned.length > 0) {
            const candidatePool = tier === 1
                ? unassigned.slice(
                    0,
                    Math.max(1, Math.ceil(unassigned.length * 0.4))
                )
                : unassigned;

            const player = getRandom(candidatePool);
            if (!player || !addPlayerToTeam(player, team)) break;

            const poolIndex = unassigned.findIndex(p => p.id === player.id);
            if (poolIndex !== -1) unassigned.splice(poolIndex, 1);
        }

        aiSetDepthChart(team);
    };

    // Tier 1 receives stronger options at each position before Tier 2 is filled.
    tier1Teams.forEach(team => fillInitialRoster(team, 1));
    tier2Teams.forEach(team => fillInitialRoster(team, 2));

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
        ageMin: 12,
        ageMax: 18,
        wins: 0,
        losses: 0,
        primaryColor: primaryColor || '#2563EB',
        secondaryColor: secondaryColor || '#FFFFFF',
        formations: { offense: defaultOffense, defense: defaultDefense },
        depthChart: {
            offense: Object.fromEntries(defaultOffenseSlots.map(slot => [slot, null])),
            defense: Object.fromEntries(defaultDefenseSlots.map(slot => [slot, null])),
            special: { P: null }
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

    // A player who permanently walked away over a broken promise cannot
    // return to that specific team through any recruiting pathway.
    if (player.refusedTeamIds?.includes(team.id)) return false;

    const currentLimit = getCurrentRosterLimit(game);
    if (team.roster.length >= currentLimit) return false;
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

    // Record realistic snap counts so retention logic doesn't penalize starters as "benched"
    [...getRosterObjects(homeTeam), ...getRosterObjects(awayTeam)].forEach(p => {
        if (!p.careerStats) p.careerStats = { seasonsPlayed: 0 };
        p.careerStats.snapsThisSeason = (p.careerStats.snapsThisSeason || 0) + 38;
    });

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
            if (player.status.duration === 0 && player.status.type !== 'temporary') {
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
            if (player.status?.type === 'temporary' || player.status?.duration > 0) return;

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

export function processWeeklyPlayerGrowth() {
    if (!game || !game.teams) return;

    game.teams.forEach(team => {
        const roster = getRosterObjects(team);
        roster.forEach(player => {
            if (!player || !player.attributes) return;

            // Use participation snaps because finalizeGameResults clears gameStats.
            const snapsThisWeek = player.snapsThisWeek || 0;

            const isYoung = player.age <= 15;
            const growthChance = isYoung ? 0.12 : 0.05;

            if (snapsThisWeek > 0 && Math.random() < growthChance) {
                const ethic = player.personality?.workEthic || 50;
                const canLearn = Math.random() < (ethic / 100);

                if (canLearn) {
                    const learnable = ['playbookIQ', 'consistency', 'catchingHands', 'tackling', 'throwingAccuracy'];
                    const chosen = getRandom(learnable);

                    for (const cat in player.attributes) {
                        if (player.attributes[cat]?.[chosen] !== undefined && player.attributes[cat][chosen] < 95) {
                            player.attributes[cat][chosen] += 1;
                            if (team.id === game?.playerTeam?.id && Math.random() < 0.25) {
                                addMessage("Weekly Rep Growth", `💡 <b>${player.name}</b> showed great progress in practice and game reps this week (+1 ${chosen})!`);
                            }
                            break;
                        }
                    }
                }
            }
        });
    });

    // Reset weekly participation only after every team's growth is processed.
    (game.players || []).forEach(player => {
        if (player) player.snapsThisWeek = 0;
    });
}

function getOrInitializeStaffWeeklyWage(staffMember) {
    if (!staffMember || typeof staffMember !== 'object') {
        return 0;
    }

    // Preserve an existing wage, including wages from older saves or contracts.
    const existingWage = Number(staffMember.weeklyWage);

    if (
        staffMember.weeklyWage !== undefined &&
        staffMember.weeklyWage !== null &&
        Number.isFinite(existingWage) &&
        existingWage >= 0
    ) {
        return Math.round(existingWage * 100) / 100;
    }

    const ratings = Object.values(staffMember.ratings || {})
        .map(Number)
        .filter(value =>
            Number.isFinite(value) &&
            value >= 0 &&
            value <= 100
        );

    const averageSkill = ratings.length > 0
        ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length
        : 50;

    const rawExperience = Number(staffMember.experience);
    const experience = Number.isFinite(rawExperience)
        ? Math.max(0, Math.min(10, rawExperience))
        : 0;

    // Base wage + skill premium + capped experience premium.
    const weeklyWage = Math.round(
        (0.75 + averageSkill * 0.018 + experience * 0.03) * 100
    ) / 100;

    // Store the wage so it does not fluctuate with future rating changes.
    staffMember.weeklyWage = weeklyWage;

    return weeklyWage;
}


function recordFinanceLedgerEntry(
    team,
    gameState,
    category,
    label,
    amount
) {
    if (!team?.finances || !gameState) return;
    if (Number(gameState.year) < 5) return;

    const year = Number(gameState.year);
    const week = Number(gameState.currentWeek);
    const value = Number(amount);

    if (
        !Number.isInteger(year) ||
        !Number.isInteger(week) ||
        !Number.isFinite(value) ||
        Math.abs(value) < 0.005
    ) {
        return;
    }

    if (!Array.isArray(team.finances.ledger)) {
        team.finances.ledger = [];
    }

    const key = `${year}:${week}:${category}`;

    const entry = {
        key,
        year,
        week,
        category,
        label,
        amount: Math.round(value * 100) / 100
    };

    const existingIndex = team.finances.ledger.findIndex(
        item => item?.key === key
    );

    if (existingIndex >= 0) {
        team.finances.ledger[existingIndex] = entry;
    } else {
        team.finances.ledger.push(entry);
    }

    team.finances.ledger.sort(
        (a, b) => a.year - b.year || a.week - b.week
    );

    if (team.finances.ledger.length > 80) {
        team.finances.ledger.splice(
            0,
            team.finances.ledger.length - 80
        );
    }
}

function recordFinanceWeeklySummary(
    team,
    gameState,
    openingBalance,
    closingBalance
) {
    if (!team?.finances || !gameState) return;
    if (Number(gameState.year) < 5) return;

    const year = Number(gameState.year);
    const week = Number(gameState.currentWeek);
    const opening = Number(openingBalance);
    const closing = Number(closingBalance);

    if (
        !Number.isInteger(year) ||
        !Number.isInteger(week) ||
        !Number.isFinite(opening) ||
        !Number.isFinite(closing)
    ) {
        return;
    }

    if (!Array.isArray(team.finances.weeklyHistory)) {
        team.finances.weeklyHistory = [];
    }

    const key = `${year}:${week}`;

    const snapshot = {
        key,
        year,
        week,
        openingBalance: Math.round(opening * 100) / 100,
        closingBalance: Math.round(closing * 100) / 100,
        netChange: Math.round((closing - opening) * 100) / 100
    };

    const existingIndex = team.finances.weeklyHistory.findIndex(
        item => item?.key === key
    );

    if (existingIndex >= 0) {
        team.finances.weeklyHistory[existingIndex] = snapshot;
    } else {
        team.finances.weeklyHistory.push(snapshot);
    }

    team.finances.weeklyHistory.sort(
        (a, b) => a.year - b.year || a.week - b.week
    );

    if (team.finances.weeklyHistory.length > 12) {
        team.finances.weeklyHistory.splice(
            0,
            team.finances.weeklyHistory.length - 12
        );
    }
}


export function processEndOfWeek() {
    if (!game) return;

    // === PROCESS FINANCES & SNACK FUND (UNIVERSAL AI & PLAYER) ===
    const mainTeams = game.teams.filter(t => t.leagueType === 'main');

    mainTeams.forEach(team => {
        if (!team.finances) {
            team.finances = { balance: 10.00, waivedDues: [] };
        }

        if (!Array.isArray(team.finances.waivedDues)) {
            team.finances.waivedDues = [];
        }

        const openingBalance = Number(team.finances.balance);

        const coach = team.staff?.coach || team.coach;
        const personality = coach?.biases?.personality?.name || 'Balanced Tactician';
        const rawDiscipline = Number(coach?.ratings?.practiceDiscipline);
        const discipline = Number.isFinite(rawDiscipline)
            ? rawDiscipline
            : 50;
        const gmDirective = team.gameplan?.gmDirective || 'COACH_AUTONOMY';
                const isUser = team.isPlayerControlled;
        const roster = getRosterObjects(team);

        // Staff payroll begins when the user takes over in Year 5.
        // Keep only the latest payroll marker; do not build an unbounded ledger.
        const payrollKey = `${Number(game.year)}:${Number(game.currentWeek)}`;

        if (
            Number(game.year) >= 5 &&
            team.finances.staffPayrollKey !== payrollKey
        ) {
            // The work-plan system uses team.coaches as the active staff roster.
            // Deduplicate by ID to avoid charging the same person twice.
            const activeStaff = new Map();

            for (const staffMember of (
                Array.isArray(team.coaches) ? team.coaches : []
            )) {
                if (staffMember?.id == null) continue;

                activeStaff.set(String(staffMember.id), staffMember);
            }

            const weeklyPayroll = [...activeStaff.values()].reduce(
                (total, staffMember) =>
                    total + getOrInitializeStaffWeeklyWage(staffMember),
                0
            );

            const balance = Number(team.finances.balance);
            team.finances.balance = Math.round(
                ((Number.isFinite(balance) ? balance : 0) - weeklyPayroll) * 100
            ) / 100;

            team.finances.staffPayrollKey = payrollKey;
            team.finances.lastStaffPayroll = Math.round(weeklyPayroll * 100) / 100;

            if (isUser && game.gameLog && weeklyPayroll > 0) {
                game.gameLog.push(
                    `👥 Staff Payroll: -$${weeklyPayroll.toFixed(2)} for ${activeStaff.size} staff members.`
                );
            }
        }

        // Weekly community allowance only.


        /*// Weekly community allowance only.
        // Season dues are collected once by processSeasonStartDues().
        const weeklyIncome = 5.00;
        team.finances.balance += weeklyIncome;*/

        // --- 1. AI WAIVE DUES PHASE (Players' Coach is soft on unhappy kids) ---
        if (!isUser) {
            roster.forEach(p => {
                const happiness = p.expectations?.happiness || 100;
                if (personality === "Players' Coach" && happiness < 60) {
                    team.finances.waivedDues.push(p.id);
                }
            });
        }

        // --- 2. INCOME & DUES COLLECTION ---
        let weeklyIncome = 5.00; // Base Coach Allowance
        let duesCollected = 0;

        // Note: Hustle chore income is dynamically processed in processWeeklyPractice

        roster.forEach(p => {
            const isWaived = team.finances.waivedDues.includes(p.id);
            const ego = p.personality?.ego || 50;

            if (isWaived) {
                // Waiving fees builds morale but looks soft
                if (p.expectations) p.expectations.happiness = Math.min(100, (p.expectations.happiness || 50) + 10);
            } else {
                // High-ego divas try to "forget their wallet", but Strict Coaches enforce the rules
                const fearFactor = discipline / 150; // High discipline limits shenanigans
                const forgetChance = ego > 75 ? (0.50 - fearFactor) : 0; 

                if (Math.random() < forgetChance) {
                    if (isUser && game.gameLog) game.gameLog.push(`💸 ${p.name} claimed he forgot his wallet and skipped paying team dues this week.`);
                } else {
                    duesCollected += 1.00;
                }
            }
        });

        team.finances.balance += (weeklyIncome + duesCollected);

        recordFinanceLedgerEntry(
            team,
            game,
            'allowance',
            'Weekly community allowance',
            weeklyIncome
        );

        recordFinanceLedgerEntry(
            team,
            game,
            'playerDues',
            'Weekly player dues',
            duesCollected
        );

        if (isUser && game.gameLog) {
            game.gameLog.push(`💰 Weekly Community Allowance: +$${weeklyIncome.toFixed(2)}.`);
            
            // --- USER AUTO-SNACK SUBSCRIPTION ---
            const autoSnack = team.finances.autoSnack || 'none';
            const snackCosts = { none: 0, orange: 2.00, caprisun: 6.00, pizza: 25.00 };
            const cost = snackCosts[autoSnack];

            if (autoSnack !== 'none') {
                if (team.finances.balance >= cost) {
                    team.finances.balance -= cost;

                    recordFinanceLedgerEntry(
                        team,
                        game,
                        'autoSnack',
                        `Auto-snack plan: ${autoSnack}`,
                        -cost
                    );
                    if (autoSnack === 'orange') {
                        roster.forEach(p => p.fatigue = Math.max(0, (p.fatigue || 0) - 10));
                        game.gameLog.push(`🍊 Weekly Snacks: Auto-purchased Orange Slices (-$2.00). Team recovered +10 Energy.`);
                    } else if (autoSnack === 'caprisun') {
                        roster.forEach(p => p.fatigue = Math.max(0, (p.fatigue || 0) - 30));
                        game.gameLog.push(`🧃 Weekly Snacks: Auto-purchased Capri Suns (-$6.00). Team recovered +30 Energy.`);
                    } else if (autoSnack === 'pizza') {
                        roster.forEach(p => {
                            if (p.expectations) p.expectations.happiness = 100;
                            if (p.social) p.social.rivalIds = []; // Squash the beefs!
                        });
                        game.gameLog.push(`🍕 Weekly Snacks: Auto-purchased Pizza Party (-$25.00). Morale maxed, locker room beefs squashed.`);
                    }
                } else {
                    game.gameLog.push(`❌ Snack Fund Alert: Insufficient funds for planned ${autoSnack.toUpperCase()} snacks (Needed $${cost.toFixed(2)}).`);
                }
            }
            
            // Re-log the final balance so user knows exactly what they have entering next week
            game.gameLog.push(`💵 Final Snack Fund Balance: $${team.finances.balance.toFixed(2)}`);
        }

        // --- 3. AI INTELLIGENT SPENDING PHASE ---
        if (!isUser) {
            const avgFatigue = roster.reduce((sum, p) => sum + (p.fatigue || 0), 0) / Math.max(1, roster.length);
            const avgHappiness = roster.reduce((sum, p) => sum + (p.expectations?.happiness || 100), 0) / Math.max(1, roster.length);
            const hasLockerRoomBeef = roster.some(p => p.social?.rivalIds?.some(rId => team.roster.includes(rId)));

            // A. PIZZA PARTY ($25) - Morale
            // Players' Coach buys it instantly if morale dips; Disciplinarians refuse to coddle kids.
            if (team.finances.balance >= 25.00 && (avgHappiness < 65 || hasLockerRoomBeef) && personality !== 'Old-School Disciplinarian') {
                team.finances.balance -= 25.00;

                recordFinanceLedgerEntry(
                    team,
                    game,
                    'aiMorale',
                    'AI pizza party',
                    -25.00
                );

                roster.forEach(p => {
                    if (p.expectations) p.expectations.happiness = 100;
                    if (p.social) p.social.rivalIds = []; // Pizza squashes all beefs
                });
            }
            // B. CAPRI SUNS ($6) & ORANGES ($2) - Energy
            // Disciplinarians buy these so they can run harder practices.
            else if (avgFatigue > 45 && team.finances.balance >= 6.00) {
                team.finances.balance -= 6.00;
                roster.forEach(p => p.fatigue = Math.max(0, (p.fatigue || 0) - 30));
            } else if (avgFatigue > 25 && team.finances.balance >= 2.00) {
                team.finances.balance -= 2.00;
                roster.forEach(p => p.fatigue = Math.max(0, (p.fatigue || 0) - 10));
            }

            // C. BUYING FAVOR TOKENS ($3) - Recruiting
            // Analytical/Win-Now coaches hoard money to buy tokens for Free Agency bidding wars
            const isAggressiveFA = gmDirective === 'WIN_NOW' || personality === 'Analytical Savant';
            const tokenHoardTarget = isAggressiveFA ? 4 : 2; // Aggressive GMs stock up on tokens

            // If team has leftover cash and needs tokens, buy them!
            if (team.finances.balance >= 3.00 && (team.socialProfile?.favorTokens || 0) < tokenHoardTarget) {
                team.finances.balance -= 3.00;

                recordFinanceLedgerEntry(
                    team,
                    game,
                    'aiToken',
                    'AI favor-token purchase',
                    -3.00
                );

                if (!team.socialProfile) team.socialProfile = { favorTokens: 0, streetCred: 50 };
                team.socialProfile.favorTokens += 1;
            }
        }

        // Record payroll if Patch 20 processed it for this exact week.
        const payrollKey =
            `${Number(game.year)}:${Number(game.currentWeek)}`;

        if (team.finances.staffPayrollKey === payrollKey) {
            const payroll = Number(team.finances.lastStaffPayroll);

            if (Number.isFinite(payroll) && payroll > 0) {
                recordFinanceLedgerEntry(
                    team,
                    game,
                    'staffPayroll',
                    'Staff payroll',
                    -payroll
                );
            }
        }

        // Save a weekly balance snapshot for budget forecasting.
        recordFinanceWeeklySummary(
            team,
            game,
            openingBalance,
            team.finances.balance
        );

        // Cleanup waivers for the next week
        team.finances.waivedDues = [];
    });

    // Resolve In-Season Weekly Bids
    if (game.weeklyBids && game.weeklyBids.length > 0) {
        const processedPlayers = new Set();
        game.weeklyBids.forEach(bid => {
            if (processedPlayers.has(bid.playerId)) return;
            processedPlayers.add(bid.playerId);

            const player = getPlayer(bid.playerId);
            if (!player || player.teamId) return;

            const allPlayerBids = game.weeklyBids.filter(b => b.playerId === bid.playerId);
            const resolution = resolvePlayerBiddingWar(player, allPlayerBids);

            if (resolution?.winner) {
                const win = resolution.winner;
                const team = win.team;

                if (addPlayerToTeam(player, team)) {
                    if (win.offer.tokensOffered > 0 && team.socialProfile) {
                        team.socialProfile.favorTokens = Math.max(0, team.socialProfile.favorTokens - win.offer.tokensOffered);
                    }

                    player.activePromise = createPlayerPromise(
                        player,
                        team,
                        win.offer,
                        { promiseSeason: game.year, source: 'weeklyFA' }
                    );

                    player.status = { type: 'healthy', description: '', duration: 0 };
                    aiSetDepthChart(team);
                    if (team.id === game.playerTeam?.id) {
                        addMessage("Contract Finalized", `🤝 <b>${player.name}</b> chose your offer over competing bids and joined the team!`);
                    }
                }
            }
        });
        game.weeklyBids = [];
    }

    updatePlayerStatuses();
    generateWeeklyEvents();
    processRelationshipEvents();

    // Decay demands for unemployed coaches on the market
    import('./staff.js').then(s => {
        if (s.processStaffMarketDecay) s.processStaffMarketDecay(game);
    }).catch(() => {});

    // Process Coach-Player Culture & Morale across all teams
    game.teams.forEach(t => {
        processLockerRoomCulture(t, game.gameLog);
    });

    // Process gameplans & practices before applying this week's practice.
    // These staff functions are statically imported, so their results are
    // available immediately rather than arriving after practice has run.
    game.teams.forEach(t => {
        // Youth teams do not use the main league's weekly gameplan system.
        if (!t || t.leagueType !== 'main') return;

        // Safeguard older saves or teams missing their gameplan.
        if (!t.gameplan) {
            t.gameplan = {
                weeklyPractice: 'chalk_talk',
                delegatePractice: false,
                delegateGameplan: false,
                delegateDepthChart: false,
                gmDirective: 'COACH_AUTONOMY',
                installedOffense: [],
                installedDefense: [],
                mastery: {}
            };
        }

        // Establish each team's workload before the gameplan is rebuilt.
        if (t.id === game.playerTeam?.id) {
            ensureTeamStaffWorkPlan(t);
        } else {
            ensureAiStaffWorkPlan(
                t,
                game,
                game.year,
                game.currentWeek
            );
        }

        const isDelegated = t.isPlayerControlled &&
            (t.gameplan.delegatePractice || t.gameplan.delegateGameplan);

        if (!t.isPlayerControlled || isDelegated) {
            const directive = t.gameplan?.gmDirective || 'COACH_AUTONOMY';

            if (!t.isPlayerControlled || t.gameplan?.delegateGameplan) {
                aiBuildGameplan(t, null, directive);
            }

            if (!t.isPlayerControlled || t.gameplan?.delegatePractice) {
                t.gameplan.weeklyPractice = aiChooseWeeklyPractice(t, null, directive);
            }
        }

        // New staff-preparation mechanics begin when the user takes over.
        if (Number(game.year) >= 5) {
            processWeeklyStaffPreparation(
                t,
                game.year,
                game.currentWeek
            );
        }

        processWeeklyPractice(t, game.gameLog);
        // Apply effective staff capacity to scouting for this resolution
        // without permanently changing the player's requested assignments.
        const scoutingAssignments = (
            t.staffWorkPlan?.assignments || []
        ).filter(assignment =>
            assignment &&
            assignment.task === 'scouting' &&
            assignment.coachId != null
        );

        // Calculate every assignment before modifying any requested hours.
        const effectiveScoutingHours = scoutingAssignments.map(assignment => ({
            assignment,
            hours: getEffectiveStaffWorkHours(t, assignment)
        }));

        const originalScoutingHours = scoutingAssignments.map(assignment => ({
            assignment,
            hadHours: Object.prototype.hasOwnProperty.call(
                assignment,
                'hours'
            ),
            hours: assignment.hours
        }));

        try {
            effectiveScoutingHours.forEach(({ assignment, hours }) => {
                assignment.hours = hours;
            });

            processWeeklyScoutingAssignments(
                t,
                game,
                game.year,
                game.currentWeek
            );
        } finally {
            // Restore the saved workload even if scouting throws an error.
            originalScoutingHours.forEach(({
                assignment,
                hadHours,
                hours
            }) => {
                if (hadHours) {
                    assignment.hours = hours;
                } else {
                    delete assignment.hours;
                }
            });
        }

        // Coaching development begins when the user takes over in Year 5.
        if (Number(game.year) >= 5) {
            processWeeklyCoachDevelopment(
                t,
                game.year,
                game.currentWeek
            );
        }
    });

    processWeeklyPlayerGrowth();

    endOfWeekCleanup();
}

export function processSeasonStartDues(gameState = game) {
    if (!gameState?.teams) {
        return {
            teamsCharged: 0,
            totalCollected: 0,
            playersCharged: 0,
            playersWaived: 0,
            playersMissed: 0
        };
    }

    const year = Number(gameState.year);

    if (!Number.isInteger(year)) {
        return {
            teamsCharged: 0,
            totalCollected: 0,
            playersCharged: 0,
            playersWaived: 0,
            playersMissed: 0
        };
    }

    const summary = {
        teamsCharged: 0,
        totalCollected: 0,
        playersCharged: 0,
        playersWaived: 0,
        playersMissed: 0
    };

    const mainTeams = gameState.teams.filter(
        team => team?.leagueType === 'main'
    );

    mainTeams.forEach(team => {
        if (!team.finances) {
            team.finances = {
                balance: 10.00,
                waivedDues: [],
                autoSnack: 'none'
            };
        }

        if (!Array.isArray(team.finances.waivedDues)) {
            team.finances.waivedDues = [];
        }

        // Prevent duplicate charges if the season-start flow runs twice.
        if (team.finances.seasonDuesYear === year) return;

        const roster = getRosterObjects(team).filter(player =>
            player &&
            !['temporary', 'retired', 'departed'].includes(
                player.status?.type
            )
        );

        const waivedIds = new Set(
            team.finances.waivedDues.map(String)
        );

        const coach = team.staff?.coach || team.coach;
        const personality =
            coach?.biases?.personality?.name || 'Balanced Tactician';
        const discipline = coach?.ratings?.practiceDiscipline ?? 50;
        const isUserTeam =
            team.isPlayerControlled ||
            team.id === gameState.playerTeam?.id;

        let collected = 0;
        let paidPlayers = 0;
        let waivedPlayers = 0;
        let missedPayments = 0;

        roster.forEach(player => {
            const isAiWaiver =
                !isUserTeam &&
                personality === "Players' Coach" &&
                (player.expectations?.happiness ?? 100) < 60;

            if (waivedIds.has(String(player.id)) || isAiWaiver) {
                if (player.expectations) {
                    player.expectations.happiness = Math.min(
                        100,
                        (player.expectations.happiness ?? 50) + 10
                    );
                }

                waivedPlayers++;
                return;
            }

            // Preserve the existing "forgot his wallet" behavior,
            // but resolve it once for the entire season's contribution.
            const ego = player.personality?.ego ?? 50;
            const forgetChance = ego > 75
                ? Math.max(0, 0.50 - (discipline / 150))
                : 0;

            if (Math.random() < forgetChance) {
                missedPayments++;
                return;
            }

            collected += SEASON_DUES_PER_PLAYER;
            paidPlayers++;
        });

        const currentBalance = Number(team.finances.balance);
        team.finances.balance =
            (Number.isFinite(currentBalance) ? currentBalance : 10.00) +
            collected;

        recordFinanceLedgerEntry(
            team,
            gameState,
            'seasonDues',
            'Season-start player dues',
            collected
        );

        // Record the year even if no one paid, so the team is not
        // charged repeatedly in the same season.
        team.finances.seasonDuesYear = year;

        // Waivers apply to this collection only.
        team.finances.waivedDues = [];

        summary.teamsCharged++;
        summary.totalCollected += collected;
        summary.playersCharged += paidPlayers;
        summary.playersWaived += waivedPlayers;
        summary.playersMissed += missedPayments;

        if (isUserTeam) {
            addMessage(
                'Season Dues Collected',
                `Season ${year} dues are settled. Your team collected $${collected.toFixed(2)} from ${paidPlayers} players at $${SEASON_DUES_PER_PLAYER.toFixed(2)} each. ${waivedPlayers} player(s) had dues waived, and ${missedPayments} player(s) missed payment.`,
                false,
                gameState
            );

            if (Array.isArray(gameState.gameLog)) {
                gameState.gameLog.push(
                    `💵 Season dues: +$${collected.toFixed(2)}. ` +
                    `${paidPlayers} paid, ${waivedPlayers} waived, ` +
                    `${missedPayments} missed.`
                );
            }
        }
    });

    return summary;
}

export function getTeamNetworkRecruits(team) {
    if (!team || !team.roster || !game || !game.players) return [];

    const rosterIds = new Set(team.roster);
    const unassignedPlayers = game.players.filter(p =>
        p &&
        !p.teamId &&
        p.status?.type !== 'retired' &&
        p.status?.type !== 'departed' &&
        !p.refusedTeamIds?.includes(team.id)
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

    const activeCount = roster.filter(p =>
        p && (
            p.status?.type === 'temporary' ||
            !p.status ||
            p.status.duration === 0
        )
    ).length;

    if (activeCount >= TEMPORARY_HELP_THRESHOLD) {
        return {
            success: false,
            message: `Your roster has ${activeCount} active players. You can only call a friend when fewer than ${TEMPORARY_HELP_THRESHOLD} are available.`
        };
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

    // 3. Caliber, Ego & Positional Reality Check
    const bestPos = player.pos || estimateBestPosition(player);
    const myOvr = calculateOverall(player, bestPos);
    const ego = player.personality?.ego || 50;

    // Check competitor caliber at position
    const posCompetitors = roster.filter(p => isPlayerViableForPosition(p, bestPos));
    const topStarterOvr = posCompetitors.map(p => calculateOverall(p, bestPos)).sort((a, b) => b - a)[0] || 0;

    if (topStarterOvr >= myOvr + 4 && ego > 60) {
        interestScore -= 24;
        decisionReasons.push(`won't ride the pine behind established starter at ${bestPos}`);
    } else if (myOvr >= 45 || healthyCount < 9) {
        interestScore += 14;
    } else if (ego > 65) {
        interestScore -= 20;
        decisionReasons.push(`demands real playing time before lending a hand`);
    }

    // Pass catchers check the QB before burning their Saturday
    if (['WR', 'TE'].includes(bestPos)) {
        const qb1 = roster.find(p => isPlayerViableForPosition(p, 'QB'));
        if ((qb1?.attributes?.technical?.throwingAccuracy || 35) < 40) {
            interestScore -= 16;
            decisionReasons.push(`doesn't want to run wind sprints for an inaccurate QB`);
        }
    }

    // Dynamic threshold: Stars won't show up for a simple favor without massive friendship ties
    let callThreshold = 50;
    if (myOvr >= 58) callThreshold = 66;
    else if (myOvr >= 48) callThreshold = 56;

    // Remove from the weekly free agent screen
    game.freeAgents = game.freeAgents.filter(p => p && p.id !== playerId);

    if (interestScore >= callThreshold) {
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

export function processLockerRoomCulture(team, gameLog = null) {
    if (!team || !team.roster) return;

    const coach = getTeamCoachingSpecialist(team, 'training');
    if (!coach) return;

    const personality =
        coach.biases?.personality?.name || coach.type;
    const roster = getRosterObjects(team);

    roster.forEach(player => {
        if (!player.personality) return;
        const ethic = player.personality.workEthic || 50;
        const ego = player.personality.ego || 50;

        if (!player.expectations) player.expectations = { happiness: 100 };

        // 1. Disciplinarian Culture Clash / Growth
        if (personality === 'Old-School Disciplinarian' || personality === 'The Strict Parent') {
            if (ego > 75) {
                // Divas hate strict authority
                player.expectations.happiness = Math.max(10, player.expectations.happiness - 4);
                if (team.id === game?.playerTeam?.id && Math.random() < 0.08) {
                    gameLog?.push(`⚡ Locker Room Drama: ${player.name} complained to his parents about Coach ${coach.name}'s strict drills.`);
                }
            } else if (ethic > 70) {
                // Hard-working gym rats thrive
                player.personality.loyalty = Math.min(99, (player.personality.loyalty || 50) + 1);
            }
        }

        // 2. Players' Coach High Morale
        else if (personality === "Players' Coach" || personality === 'The Rec Center Director') {
            player.expectations.happiness = Math.min(100, player.expectations.happiness + 3);
        }

        // 3. Peaked in '94 Toughness
        else if (personality === "Peaked in '94" || personality === 'The Has-Been Dad') {
            if (player.attributes?.mental?.toughness && player.attributes.mental.toughness < 90) {
                if (Math.random() < 0.10) player.attributes.mental.toughness += 1;
            }
        }
    });
}

export function processOffseasonFADay(gameState, userBids = []) {
    if (!gameState || !gameState.players) return { daySignings: [], rejectedBids: [], userBidResults: [], activeNegotiations: [] };

    const activeTeams = gameState.teams.filter(t => t.leagueType === 'main');
    const daySignings = [];
    const rejectedBids = [];
    const userBidResults = [];
    const activeNegotiations = [];
    const playerBidsMap = new Map();

    const currentDay = gameState._faDay || 1;
    gameState._activeFaMarket = gameState._activeFaMarket || new Map();

    // 1. REGISTER USER BIDS
    const seenUserPlayerIds = new Set();
    userBids.forEach(ub => {
        if (seenUserPlayerIds.has(ub.playerId)) return;
        seenUserPlayerIds.add(ub.playerId);

        const pList = playerBidsMap.get(ub.playerId) || [];
        pList.push({ team: gameState.playerTeam, teamId: gameState.playerTeam.id, offer: ub.offer });
        playerBidsMap.set(ub.playerId, pList);
    });

    // 2. SMART AI BIDDING & COUNTER-BIDDING
    // AI coaches recruit up to the current phase's roster limit.
    const rosterLimit = getCurrentRosterLimit(gameState);
    const aiBidAudit = {
        currentWeek: gameState.currentWeek ?? null,
        rosterLimit,
        teamsEvaluated: 0,
        teamsAtRosterCap: 0,
        prospectsEvaluated: 0,
        candidatesPassingFilters: 0,
        teamsWithCandidates: 0,
        offersGenerated: 0,
        teamDetails: []
    };

    activeTeams.forEach(aiTeam => {
        if (aiTeam.isPlayerControlled) return;

        const rosterSize = aiTeam.roster?.length || 0;
        const rosterSpots = Math.max(0, rosterLimit - rosterSize);

        aiBidAudit.teamsEvaluated++;

        if (rosterSpots === 0) {
            aiBidAudit.teamsAtRosterCap++;
            aiBidAudit.teamDetails.push({
                team: aiTeam.name,
                rosterSize,
                rosterSpots,
                availableProspects: 0,
                candidatesPassingFilters: 0,
                offersGenerated: 0
            });
            return;
        }

        const availableProspects = gameState.players.filter(p =>
            !p.teamId && p.status?.type !== 'retired' && p.status?.type !== 'departed' && p.age >= 12 && p.age <= 18
        );

        // Sort potential targets by upgrade value for this specific AI team
        const evaluatedTargets = availableProspects.map(prospect => {
            const activeLead = gameState._activeFaMarket.get(prospect.id);
            const currentTopScore = activeLead ? activeLead.topScore : 0;
            const evalResult = calculateAiTeamNeedAndDesire(aiTeam, prospect, gameState, currentTopScore, rosterLimit);
            return { prospect, ...evalResult };
        }).filter(t => t.shouldBid).sort((a, b) => b.desireScore - a.desireScore);

        // Limit targets to two, or the team's remaining roster vacancies.
        const teamBids = evaluatedTargets.slice(
            0,
            Math.min(2, rosterSpots)
        );

        aiBidAudit.prospectsEvaluated += availableProspects.length;
        aiBidAudit.candidatesPassingFilters += evaluatedTargets.length;

        if (evaluatedTargets.length > 0) {
            aiBidAudit.teamsWithCandidates++;
        }

        aiBidAudit.offersGenerated += teamBids.length;
        aiBidAudit.teamDetails.push({
            team: aiTeam.name,
            rosterSize,
            rosterSpots,
            availableProspects: availableProspects.length,
            candidatesPassingFilters: evaluatedTargets.length,
            offersGenerated: teamBids.length
        });

        teamBids.forEach(bidTarget => {
            const pList = playerBidsMap.get(bidTarget.prospect.id) || [];
            pList.push({ team: aiTeam, teamId: aiTeam.id, offer: bidTarget.offer });
            playerBidsMap.set(bidTarget.prospect.id, pList);
        });
    });

    // 3. MULTI-DAY BID RESOLUTION
    // Day 1 & Day 2: Contested high-OVR players remain in active negotiation allowing counter-offers.
    // Day 3 (Final Day): All remaining negotiations finalize.
    playerBidsMap.forEach((bids, playerId) => {
        const player = getPlayer(playerId);
        if (!player || player.teamId) return;

        const resolution = resolvePlayerBiddingWar(player, bids);
        const userBidOnThisPlayer = bids.find(b => b.teamId === gameState.playerTeam.id);

        if (!resolution?.winner) {
            const reason = resolution?.rejectedReason || "Offers failed to satisfy player caliber.";
            rejectedBids.push({ player, reason });
            if (userBidOnThisPlayer) {
                userBidResults.push({ player, won: false, rejected: true, message: `✋ REJECTED: ${player.name} rejected your pitch: ${reason}` });
            }
            gameState._activeFaMarket.delete(playerId);
            return;
        }

        const win = resolution.winner;
        const leaderTeam = win.team;
        const leaderScore = win.score;
        const pos = player.pos || estimateBestPosition(player);
        const playerOvr = calculateOverall(player, pos);

        // Determine if player finalizes today or remains in negotiation for counter-offers
        const isBlowaway = win.offer.tokensOffered >= 2 && win.offer.role === 'STARTER' && win.evaluation.interestScore >= 82;
        const isLowTierUncontested = bids.length === 1 && playerOvr < 48;
        const shouldFinalizeNow = currentDay >= 3 || isBlowaway || isLowTierUncontested;

        if (shouldFinalizeNow) {
            // FINALIZE CONTRACT
            if (addPlayerToTeam(player, leaderTeam)) {
                if (win.offer.tokensOffered > 0 && leaderTeam.socialProfile) {
                    leaderTeam.socialProfile.favorTokens = Math.max(0, leaderTeam.socialProfile.favorTokens - win.offer.tokensOffered);
                }

                player.activePromise = createPlayerPromise(
                    player,
                    leaderTeam,
                    win.offer,
                    { promiseSeason: gameState.year, source: 'offseasonFA' }
                );

                player.status = { type: 'healthy', description: '', duration: 0 };
                aiSetDepthChart(leaderTeam);

                daySignings.push({
                    player,
                    team: leaderTeam,
                    runnerUp: resolution.competingBids[1]?.team || null,
                    tokens: win.offer.tokensOffered,
                    userWon: leaderTeam.id === gameState.playerTeam.id,
                    wasUserBid: !!userBidOnThisPlayer
                });

                if (userBidOnThisPlayer) {
                    if (leaderTeam.id === gameState.playerTeam.id) {
                        const runnerUpName = resolution.competingBids[1]?.team?.name;
                        userBidResults.push({
                            player, won: true, tokensSpent: win.offer.tokensOffered,
                            message: `🎉 SIGNED! ${player.name} accepted your offer!${runnerUpName ? ` (Beat out ${runnerUpName})` : ''}`
                        });
                    } else {
                        userBidResults.push({
                            player, won: false, winnerTeam: leaderTeam.name,
                            message: `❌ OUTBID! ${player.name} signed with ${leaderTeam.name} over your pitch.`
                        });
                    }
                }
            }
            gameState._activeFaMarket.delete(playerId);
        } else {
            // REMAINS IN ACTIVE NEGOTIATION FOR NEXT DAY'S COUNTER-BIDS
            gameState._activeFaMarket.set(playerId, {
                playerId,
                leaderTeamId: leaderTeam.id,
                leaderTeamName: leaderTeam.name,
                topScore: leaderScore,
                leaderOffer: win.offer,
                bidsCount: bids.length
            });

            activeNegotiations.push({
                player,
                leaderTeam,
                leaderOffer: win.offer,
                bidsCount: bids.length,
                isUserLeading: leaderTeam.id === gameState.playerTeam.id
            });

            if (userBidOnThisPlayer) {
                if (leaderTeam.id === gameState.playerTeam.id) {
                    userBidResults.push({
                        player, won: false, inProgress: true,
                        message: `⏳ LEADING! You currently lead negotiations for ${player.name}. Rival coaches may counter tomorrow!`
                    });
                } else {
                    userBidResults.push({
                        player, won: false, outbid: true,
                        message: `⚠️ OUTBID! ${leaderTeam.name} leads for ${player.name} (${win.offer.role}, ${win.offer.tokensOffered}🪙). You can counter-bid tomorrow!`
                    });
                }
            }
        }
    });

    gameState._faDay = currentDay + 1;

    // Clear rumors cache so the next day generates fresh market chatter
    import('./negotiations.js').then(n => {
        if (n.clearPlayerMarketCache) n.clearPlayerMarketCache(gameState);
    }).catch(() => { });

    return {
        daySignings,
        rejectedBids,
        userBidResults,
        activeNegotiations,
        aiBidAudit
    };
}

export function executeAICutDowns() {
    if (!game || !game.teams) return;
    const limit = REGULAR_SEASON_ROSTER_LIMIT;

    game.teams.forEach(team => {
        if (team.isPlayerControlled || !team.roster || team.roster.length <= limit) return;

        const rosterObjs = getRosterObjects(team);

        // Use the flexible coaching group for roster evaluation.
        const coach = getAssignedCoachForTask(team, 'general') ||
            getTeamCoachingSpecialist(team, 'general');

        const scout = getAssignedCoachForTask(team, 'scouting') ||
            getTeamCoachingSpecialist(team, 'scouting');

        const personality = coach?.biases?.personality?.name;
        const gmDirective = team.gameplan?.gmDirective || 'COACH_AUTONOMY';

        // Scouting hours improve the accuracy of roster evaluations.
        const scoutingHours = (
            team.staffWorkPlan?.assignments || []
        ).reduce((total, assignment) => {
            if (assignment?.task !== 'scouting') return total;

            const hours = Number(assignment.hours);

            return total + (
                Number.isFinite(hours)
                    ? Math.max(0, hours)
                    : 0
            );
        }, 0);

        const baseScoutAccuracy = scout
            ? (
                (scout.ratings?.evalTechnique ?? 50) +
                (scout.ratings?.evalPhysicals ?? 50)
            ) / 200
            : 0.5;

        // Full scouting effort is reached at 12 assigned hours.
        // Accuracy remains bounded to preserve uncertainty.
        const scoutingEffortMultiplier =
            0.7 + 0.3 * Math.min(1, scoutingHours / 12);

        const scoutAcc = Math.max(
            0.25,
            Math.min(
                0.85,
                baseScoutAccuracy * scoutingEffortMultiplier
            )
        );

        // Personality-driven roster valuation
        const getCutEvaluationScore = (p) => {
            const pos = p.pos || estimateBestPosition(p);
            // Subjective perceived rating (Noise depends on scout quality)
            const noise = Math.round((Math.sin(p.id.charCodeAt(0) + game.year) * (1.0 - scoutAcc) * 10));
            let val = calculateOverall(p, pos) + noise;

            // Potential value
            if (p.potential === 'A') val += (gmDirective === 'DEVELOP_YOUTH' ? 15 : 8);
            else if (p.potential === 'B') val += (gmDirective === 'DEVELOP_YOUTH' ? 8 : 4);

            const ethic = p.personality?.workEthic || 50;
            const ego = p.personality?.ego || 50;
            const toughness = p.attributes?.mental?.toughness || 50;

            // Coach bias adjustments on cut-day
            if (personality === 'Old-School Disciplinarian') {
                if (ethic < 40) val -= 12; // Disciplinarians cut slackers first
                if (ego > 75) val -= 10;   // Cuts toxic divas
                if (toughness > 65) val += 6;
            } else if (personality === "Peaked in '94") {
                const str = p.attributes?.physical?.strength || 50;
                if (str > 60) val += 6;    // Loves raw power
            } else if (personality === "Players' Coach") {
                const loyalty = p.personality?.loyalty || 50;
                if (loyalty > 65) val += 8; // Protects loyal kids
            }

            if (gmDirective === 'WIN_NOW' && p.age >= 16) val += 5; // Prefers experienced players
            return val;
        };

        // Sort by perceived value (highest value kept, lowest cut)
        rosterObjs.sort((a, b) => getCutEvaluationScore(b) - getCutEvaluationScore(a));

        // Identify who is getting cut
        const playersToKeep = rosterObjs.slice(0, limit);
        const playersToCut = rosterObjs.slice(limit);

        playersToCut.forEach(p => {
            p.teamId = null;
            p.number = null;
            p.status = { type: 'healthy', description: 'Cut during summer tryouts', duration: 0 };
            team.roster = team.roster.filter(id => id !== p.id);
        });

        aiSetDepthChart(team);
    });
}

export function autoFillTeamWalkOns(team, targetSize = 14) {
    if (!team || !game || !game.players) return 0;
    let added = 0;
    const limit = getCurrentRosterLimit(game);
    while (team.roster.length < targetSize && team.roster.length < limit) {
        const unassigned = game.players.filter(p =>
            p &&
            !p.teamId &&
            p.status?.type !== 'retired' &&
            p.status?.type !== 'departed' &&
            p.age >= 12 &&
            p.age <= 18 &&
            !p.refusedTeamIds?.includes(team.id)
        );
        if (unassigned.length === 0) break;

        // Score players based on team need and overall ability
        unassigned.sort((a, b) => {
            const ovrA = calculateOverall(a, estimateBestPosition(a));
            const ovrB = calculateOverall(b, estimateBestPosition(b));
            return ovrB - ovrA;
        });

        const recruit = unassigned[0];
        if (addPlayerToTeam(recruit, team)) {
            recruit.status = { type: 'healthy', description: '', duration: 0 };
            //recruit.activePromise = { role: 'ROTATION', promiseTouches: 'NORMAL' };
            added++;
        } else {
            break;
        }
    }
    if (added > 0) aiSetDepthChart(team);
    return added;
}

export function aiManageRoster(team) {
    if (!team || !team.roster || !game || !team.coach) return;

    const roster = getRosterObjects(team);
    let playableCount = roster.filter(p =>
        p && (!p.status || p.status.duration === 0 || p.status.type === 'temporary')
    ).length;

    const aiAvailableNetwork = getTeamNetworkRecruits(team);

    while (
        playableCount < TEMPORARY_HELP_THRESHOLD &&
        team.roster.length < getCurrentRosterLimit(game) &&
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

    if (team.roster.length < getCurrentRosterLimit(game) && team.socialProfile?.favorTokens > 0) {
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

function getAssignedCoachForTask(team, task) {
    const coaches = Array.isArray(team?.coaches)
        ? team.coaches.filter(coach => coach?.id != null)
        : [];

    const taskSkills = {
        training: [
            'teaching',
            'practiceDiscipline',
            'conditioning'
        ],
        scouting: [
            'evalPhysicals',
            'evalTechnique',
            'evalCharacter'
        ],
        offensePrep: [
            'offSchemeMastery',
            'gameplanInstinct',
            'inGameAdjustments'
        ],
        defensePrep: [
            'defSchemeMastery',
            'gameplanInstinct',
            'inGameAdjustments'
        ]
    };

    const skills = taskSkills[task] || [];

    const getSkillScore = coach => {
        if (skills.length === 0) return 50;

        const ratings = coach.ratings || {};

        return skills.reduce((sum, key) => {
            const value = Number(ratings[key]);
            return sum + (
                Number.isFinite(value)
                    ? Math.max(0, Math.min(100, value))
                    : 50
            );
        }, 0) / skills.length;
    };

    const hoursByCoach = new Map();

    for (const assignment of team?.staffWorkPlan?.assignments || []) {
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

    const assignedCoach = coaches
        .filter(coach => (hoursByCoach.get(String(coach.id)) || 0) > 0)
        .sort((a, b) => {
            const hoursDifference =
                (hoursByCoach.get(String(b.id)) || 0) -
                (hoursByCoach.get(String(a.id)) || 0);

            return hoursDifference ||
                getSkillScore(b) - getSkillScore(a);
        })[0];

    return assignedCoach ||
        getTeamCoachingSpecialist(team, task) ||
        null;
}

function getEffectiveTaskHours(team, task) {
    return (team?.staffWorkPlan?.assignments || []).reduce(
        (total, assignment) => {
            if (assignment?.task !== task) return total;

            return total + getEffectiveStaffWorkHours(
                team,
                assignment
            );
        },
        0
    );
}

function getStaffWorkOutputFactor(
    effectiveHours,
    minimumFactor = 0.25,
    targetHours = 8
) {
    const hours = Number(effectiveHours);

    const safeHours = Number.isFinite(hours)
        ? Math.max(0, hours)
        : 0;

    return Math.max(
        minimumFactor,
        Math.min(
            1,
            minimumFactor +
                (safeHours / targetHours) * (1 - minimumFactor)
        )
    );
}

export function developPlayer(player, team = null) {
    if (!player || !player.attributes) return { player, improvements: [] };
    const developmentReport = { player, improvements: [] };

    const attributesBefore = Object.fromEntries(
        Object.entries(player.attributes).map(([category, attributes]) => [
            category,
            Object.fromEntries(
                Object.entries(attributes || {}).filter(
                    ([, value]) => typeof value === 'number'
                )
            )
        ])
    );
    
    const potentialMultipliers = { 'A': 1.60, 'B': 1.30, 'C': 1.05, 'D': 0.85, 'F': 0.65 };
    const potMod = potentialMultipliers[player.potential] || 1.0;
    const ethic = player.personality?.workEthic || 50;
    const ego = player.personality?.ego || 50;
    const ethicMod = 0.65 + (ethic / 110);

    // Live snaps create massive development leverage
    const snaps = player.careerStats?.snapsThisSeason || 0;
    let experienceMod = 1.0;
    if (snaps >= 250) experienceMod = 1.45;     // Full-time starter leap
    else if (snaps >= 100) experienceMod = 1.20; // Active rotational contributor
    else if (snaps < 25) experienceMod = 0.65;   // Bench rot penalty

    const developmentCoach = getAssignedCoachForTask(
        team,
        'training'
    );

    const effectiveTrainingHours = getEffectiveTaskHours(
        team,
        'training'
    );

    // Natural maturation remains intact; dedicated training hours
    // influence the coached attribute-development component below.
    const trainingOutputFactor = getStaffWorkOutputFactor(
        effectiveTrainingHours,
        0.35
    );

    const coachTeaching =
        developmentCoach?.ratings?.teaching ?? 50;

    const coachDiscipline =
        developmentCoach?.ratings?.practiceDiscipline ?? 50;

    const teachingMod =
        0.85 +
        ((coachTeaching / 100) * 0.25) +
        ((coachDiscipline / 100) * 0.15);

    // =========================================================================
    // 1. IMPACTFUL BIOLOGICAL MATURATION (Closing the Gap to Adult Ceiling)
    // =========================================================================
    if (player.talentAttributes && player.age >= 12 && player.age <= 18) {
        // Boosted growth step: youth naturally close 15-28% of the ceiling gap per year
        const youthAgeMultiplier = player.age <= 15 ? 1.35 : 1.0;
        const growthStep = 0.16 * potMod * ethicMod * teachingMod * experienceMod * youthAgeMultiplier;

        Object.keys(player.attributes).forEach(cat => {
            if (!player.talentAttributes[cat]) return;
            Object.keys(player.attributes[cat]).forEach(attr => {
                if (attr === 'height' || attr === 'weight') return;

                const currentVal = player.attributes[cat][attr] || 40;
                const ceilingVal = player.talentAttributes[cat][attr] || 70;

                if (ceilingVal > currentVal) {
                    const naturalGain = Math.max(1, Math.round((ceilingVal - currentVal) * growthStep));
                    player.attributes[cat][attr] = Math.min(ceilingVal, currentVal + naturalGain);
                }
            });
        });
    }

    // =========================================================================
    // 2. SUMMER BREAKTHROUGH LEAP (Phenom Leap)
    // =========================================================================
    const canBreakthrough = (player.potential === 'A' || player.potential === 'B') && ethic >= 65 && snaps >= 80;
    const hitBreakthrough = canBreakthrough && Math.random() < 0.22;

    if (hitBreakthrough) {
        const sigStat = player.pos === 'QB' ? 'throwingAccuracy' :
            player.pos === 'RB' ? 'speed' :
                player.pos === 'WR' ? 'catchingHands' :
                    player.pos === 'OL' ? 'blocking' :
                        player.pos === 'DL' ? 'blockShedding' :
                            player.pos === 'LB' ? 'tackling' : 'coverage';

        for (const cat of ['technical', 'physical', 'mental']) {
            if (player.attributes[cat]?.[sigStat] !== undefined) {
                player.attributes[cat][sigStat] = Math.min(99, player.attributes[cat][sigStat] + 4);
                developmentReport.improvements.push({ attr: `⭐ SUMMER BREAKTHROUGH (${sigStat})`, increase: 4 });
                break;
            }
        }
    }

    // =========================================================================
    // 3. REALISTIC POSITION TRANSITION DYNAMICS & PHYSICAL ADAPTATION
    // =========================================================================
    let transitionBoost = 0;
    if (player.positionChangedYear && (game.year - player.positionChangedYear) === 1) {
        const currWgt = player.attributes.physical?.weight || 150;
        const ceilingWgt = player.talentAttributes?.physical?.weight || currWgt + 15;
        const currSpd = player.attributes.physical?.speed || 50;
        const currAgi = player.attributes.physical?.agility || 50;
        // Transition Success Score (Ethic + Frame Compatibility + Discipline)
        const frameHeadroom = ceilingWgt - currWgt;
        const dedicationScore =
            (ethic * 0.45) +
            (coachDiscipline * 0.35) +
            (Math.random() * 20);

        const currStr = player.attributes.physical?.strength || 50;
        const isNaturallyBig = currWgt >= 168 && currStr >= 54;
        const isTwitchyAthlete = currSpd >= 68 && currAgi >= 65;

        // A. TRANSITIONING INTO THE TRENCHES (OL / DL)
        if (['OL', 'DL'].includes(player.pos)) {
            // CASE 1: The Naturally Big "Tweener" (e.g. 170 lb WR/TE moving to OL)
            if (isNaturallyBig && frameHeadroom >= 12 && dedicationScore >= 45) {
                const bulkGain = getRandomInt(10, 18);
                player.attributes.physical.weight = currWgt + bulkGain;
                player.attributes.physical.strength = Math.min(99, currStr + 4);
                // Retains rare mobility for an 8v8 pulling lineman!
                player.attributes.technical.blocking = Math.min(99, (player.attributes.technical?.blocking || 40) + 5);
                transitionBoost = 3;
                developmentReport.improvements.push({
                    attr: `🛡️ Athletic Trench Bloom (+${bulkGain} lbs, +4 STR, +5 BLK: Retained Mobility)`,
                    increase: bulkGain
                });
            }
            // CASE 2: Standard Functional Bulk
            else if (frameHeadroom >= 15 && dedicationScore >= 52) {
                const weightGain = getRandomInt(8, 14);
                player.attributes.physical.weight = currWgt + weightGain;
                player.attributes.physical.strength = Math.min(99, currStr + 3);
                transitionBoost = 2;
                developmentReport.improvements.push({ attr: `💪 Functional Trench Bulk (+${weightGain} lbs, +3 STR)`, increase: weightGain });
            }
            // CASE 3: Frame Rejection (True skinny hard-gainer)
            else if (frameHeadroom < 10 || currWgt < 145) {
                developmentReport.improvements.push({ attr: '⚠️ Frame Rejection: Body cannot support interior line mass', increase: 0 });
                if (player.expectations) player.expectations.happiness = Math.max(20, player.expectations.happiness - 10);
            }
            // CASE 4: The Sloppy Bulk
            else {
                const sloppyGain = getRandomInt(6, 12);
                player.attributes.physical.weight = currWgt + sloppyGain;
                player.attributes.physical.speed = Math.max(25, currSpd - 3);
                player.attributes.physical.agility = Math.max(25, currAgi - 3);
                developmentReport.improvements.push({ attr: `🍔 Sloppy Bulk: Gained ${sloppyGain} lbs of unconditioned weight (-3 SPD, -3 AGI)`, increase: -3 });
            }
        }

        // B. THE EDELMAN/TWITCH TRANSITION (QB/RB ➔ WR/DB)
        else if (['WR', 'DB'].includes(player.pos) && isTwitchyAthlete) {
            player.attributes.technical.catchingHands = Math.min(99, (player.attributes.technical?.catchingHands || 40) + 5);
            player.attributes.physical.agility = Math.min(99, currAgi + 3);
            transitionBoost = 3;
            developmentReport.improvements.push({
                attr: '⚡ Twitch Playmaker Transition (+5 HND, +3 AGI: Converted quarterback/runner twitch)',
                increase: 5
            });
        }

        // C. THE BOX ENFORCER (DB ➔ LB)
        else if (player.pos === 'LB' && currWgt >= 165 && (player.attributes.technical?.tackling || 50) >= 50) {
            player.attributes.physical.strength = Math.min(99, currStr + 3);
            player.attributes.technical.tackling = Math.min(99, (player.attributes.technical?.tackling || 50) + 4);
            transitionBoost = 2;
            developmentReport.improvements.push({
                attr: '💥 Hybrid Enforcer Bloom (+4 TKL, +3 STR: Sideline-to-sideline pursuit range)',
                increase: 4
            });
        }

        // B. TRANSITIONING TO BOUNDARY SPEED (WR / DB)
        else if (['WR', 'DB'].includes(player.pos)) {
            if (currWgt <= 185 && dedicationScore >= 45) {
                // SUCCESSFUL LEAN & AGILITY CUT
                player.attributes.physical.agility = Math.min(99, currAgi + 3);
                if (currWgt > 165) player.attributes.physical.weight = currWgt - getRandomInt(4, 8);
                transitionBoost = 2;
                developmentReport.improvements.push({ attr: '⚡ Boundary Footwork Polish (+3 AGI, Leaned Out)', increase: 3 });
            } else if (currWgt > 195) {
                // HEAVY FRAME STRUGGLE: Stiff hips on the boundary
                player.attributes.physical.agility = Math.max(25, currAgi - 2);
                developmentReport.improvements.push({ attr: '⚠️ Heavy Hips: Frame too thick to stick with fast receivers (-2 AGI)', increase: -2 });
                if (player.expectations) player.expectations.happiness = Math.max(20, player.expectations.happiness - 12);
            }
        }

        // C. TEMPORARY INSTALL LEARNING CURVE
        // First year at a new position incurs a minor tactical learning tax (-2 Playbook IQ temporary adjustment)
        if (dedicationScore < 55 && (player.attributes.mental?.playbookIQ || 50) > 40) {
            player.attributes.mental.playbookIQ -= 2;
            developmentReport.improvements.push({ attr: '🧠 Assignment Growing Pains (-2 Playbook IQ)', increase: -2 });
        }
    }

    let mentorBoost = 0;
    if (team && player.age <= 14) {
        const roster = getRosterObjects(team);
        const hasOlderMentor = roster.some(teammate =>
            teammate.age >= 16 &&
            getRelationshipLevel(player.id, teammate.id) >= relationshipLevels.GOOD_FRIEND.level
        );
        if (hasOlderMentor) mentorBoost = 2;
    }

    // Upgraded base points: Kids now gain 5-9 points (age 12-14) or 4-7 points (age 15-18)
    let basePoints = player.age <= 14 ? getRandomInt(5, 8) : getRandomInt(4, 7);

    const pos = player.pos || estimateBestPosition(player);
    let focusGroup = [];
    if (pos === 'QB') focusGroup = ['throwingAccuracy', 'playbookIQ', 'decisionMaking', 'speed', 'consistency'];
    else if (pos === 'RB') focusGroup = ['speed', 'agility', 'strength', 'catchingHands', 'toughness'];
    else if (pos === 'WR') focusGroup = ['speed', 'catchingHands', 'agility', 'playbookIQ'];
    else if (pos === 'TE') focusGroup = ['catchingHands', 'blocking', 'strength', 'toughness'];
    else if (pos === 'OL') focusGroup = ['strength', 'blocking', 'toughness', 'playbookIQ'];
    else if (pos === 'DL') focusGroup = ['strength', 'blockShedding', 'tackling', 'toughness'];
    else if (pos === 'LB') focusGroup = ['tackling', 'playbookIQ', 'speed', 'blockShedding'];
    else if (pos === 'DB') focusGroup = ['speed', 'coverage', 'agility', 'catchingHands', 'playbookIQ'];

    let totalUpgradePoints = Math.round(
        basePoints * experienceMod * trainingOutputFactor
    ) + mentorBoost + transitionBoost;

    // Slacker Stagnation / Regression: Low work-ethic teens (16-18) with high ego can regress
    if (ethic < 35 && ego > 70 && player.age >= 16 && Math.random() < 0.40) {
        const regressedAttr = getRandom(['speed', 'stamina', 'agility']);
        for (const cat in player.attributes) {
            if (player.attributes[cat]?.[regressedAttr] && player.attributes[cat][regressedAttr] > 40) {
                player.attributes[cat][regressedAttr] -= 2;
                developmentReport.improvements.push({ attr: `${regressedAttr} (Slacked Off)`, increase: -2 });
                break;
            }
        }
        totalUpgradePoints = Math.max(0, totalUpgradePoints - 3);
    }

    for (let i = 0; i < totalUpgradePoints; i++) {
        const pool = focusGroup.length > 0 ? focusGroup : ['speed', 'strength', 'agility'];
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

    // =========================================================================
    // 3. FRAME MATURATION & GROWTH SPURTS (Height & Weight)
    // =========================================================================
    if (!player.attributes.physical) player.attributes.physical = {};
    const currHgt = player.attributes.physical.height || 66;
    const currWgt = player.attributes.physical.weight || 140;
    const ceilingHgt = player.talentAttributes?.physical?.height || currHgt + 4;
    const ceilingWgt = player.talentAttributes?.physical?.weight || currWgt + 30;

    let heightGain = 0;
    let weightGain = 0;

    // 6% chance for a massive Growth Spurt between ages 13 and 16
    const hitGrowthSpurt = player.age >= 13 && player.age <= 16 && Math.random() < 0.06;

    if (hitGrowthSpurt) {
        heightGain = getRandomInt(3, 5);
        weightGain = getRandomInt(18, 32);

        // Growth spurt benefits Strength, but causes temporary growing pains on agility
        if (player.attributes.physical.strength) player.attributes.physical.strength = Math.min(99, player.attributes.physical.strength + 3);
        if (player.attributes.physical.agility && player.attributes.physical.agility > 30) player.attributes.physical.agility -= 1;

        developmentReport.improvements.push({ attr: '🚀 GROWTH SPURT!', increase: heightGain });
        if (team && team.id === game?.playerTeam?.id) {
            addMessage("Growth Spurt!", `📈 <b>${player.name}</b> hit a massive growth spurt over the summer! Gained +${heightGain}" and +${weightGain} lbs!`);
        }
    } else if (player.age <= 17) {
        // Natural annual frame closure toward adult ceiling
        if (ceilingHgt > currHgt) heightGain = Math.min(ceilingHgt - currHgt, getRandomInt(1, 2));
        if (ceilingWgt > currWgt) weightGain = Math.min(ceilingWgt - currWgt, getRandomInt(6, 14));
    }

    if (heightGain > 0) {
        player.attributes.physical.height = currHgt + heightGain;
        if (!hitGrowthSpurt) developmentReport.improvements.push({ attr: 'height', increase: heightGain });
    }
    if (weightGain > 0) {
        player.attributes.physical.weight = currWgt + weightGain;
        if (!hitGrowthSpurt) developmentReport.improvements.push({ attr: 'weight', increase: weightGain });
    }

    if (!player.careerStats) player.careerStats = {};
    player.careerStats.snapsThisSeason = 0;

    developmentReport.actualAttributeChanges = [];

    Object.entries(player.attributes).forEach(([category, attributes]) => {
        Object.entries(attributes || {}).forEach(([attr, after]) => {
            const before = attributesBefore[category]?.[attr];

            if (
                typeof before !== 'number' ||
                typeof after !== 'number' ||
                before === after
            ) {
                return;
            }

            developmentReport.actualAttributeChanges.push({
                category,
                attr,
                before,
                after,
                increase: after - before
            });
        });
    });

    return developmentReport;
}

export function processWeeklyPractice(team, gameLog = null) {
    if (!team || !team.gameplan) return;

    const coaches = Array.isArray(team.coaches)
        ? team.coaches.filter(coach => coach?.id != null)
        : [];

    const trainingHours = new Map();

    for (const assignment of team.staffWorkPlan?.assignments || []) {
        if (
            assignment?.task !== 'training' ||
            assignment.coachId == null
        ) {
            continue;
        }

        const hours = getEffectiveStaffWorkHours(
            team,
            assignment
        );

        if (!Number.isFinite(hours) || hours <= 0) continue;

        const coachId = String(assignment.coachId);

        trainingHours.set(
            coachId,
            (trainingHours.get(coachId) || 0) + hours
        );
    }

    const getTrainingSkill = coach => {
        const ratings = coach?.ratings || {};

        const values = [
            ratings.teaching,
            ratings.practiceDiscipline,
            ratings.conditioning
        ].map(value => {
            const number = Number(value);
            return Number.isFinite(number) ? number : 50;
        });

        return values.reduce((sum, value) => sum + value, 0) /
            values.length;
    };

    const assignedTrainingCoach = coaches
        .filter(coach => (trainingHours.get(String(coach.id)) || 0) > 0)
        .sort((a, b) => {
            const hoursDifference =
                (trainingHours.get(String(b.id)) || 0) -
                (trainingHours.get(String(a.id)) || 0);

            return hoursDifference ||
                getTrainingSkill(b) - getTrainingSkill(a);
        })[0];

    const coach = assignedTrainingCoach ||
        getTeamCoachingSpecialist(team, 'training');

    const totalEffectiveTrainingHours = Array.from(
        trainingHours.values()
    ).reduce((sum, hours) => sum + hours, 0);

    const trainingOutputFactor = getStaffWorkOutputFactor(
        totalEffectiveTrainingHours,
        0.25
    );

    const discipline = coach?.ratings?.practiceDiscipline ?? 50;
    const teaching = coach?.ratings?.teaching ?? 50;
    const mastery = team.gameplan.mastery = team.gameplan.mastery || {};
    const plan = team.gameplan.weeklyPractice || 'chalk_talk';
    const roster = getRosterObjects(team);

    // 1. FAMILIARITY DECAY: Uninstalled plays fade from memory (-4% per week down to 25% floor)
    const activeInstalled = new Set([
        'Uni_InsideZone', 'Uni_QuickSlants', 'Uni_FourVerts',
        'Cover_2_Zone_Base', 'Cover_1_Robber', 'GoalLine_RunStuff',
        ...(team.gameplan.installedOffense || []),
        ...(team.gameplan.installedDefense || [])
    ]);

    // Discipline cuts decay in half
    const decayRate = discipline > 65 ? 2 : 4;
    Object.keys(mastery).forEach(key => {
        if (!activeInstalled.has(key) && mastery[key] > 25) {
            mastery[key] = Math.max(25, mastery[key] - decayRate);
        }
    });

    // 1B. STAFF GAMEPLAN PREPARATION
    // Effective offensive/defensive prep hours build familiarity with
    // the specific plays assigned to each staff member.
    let totalPreparationMasteryGain = 0;

    const preparationAssignments = (
        team.staffWorkPlan?.assignments || []
    ).filter(assignment =>
        ['offensePrep', 'defensePrep'].includes(assignment?.task)
    );

    for (const assignment of preparationAssignments) {
        const effectiveHours = getEffectiveStaffWorkHours(
            team,
            assignment
        );

        if (!Number.isFinite(effectiveHours) || effectiveHours <= 0) {
            continue;
        }

        const isOffense = assignment.task === 'offensePrep';

        const foundationKeys = isOffense
            ? [
                'Uni_InsideZone',
                'Uni_StretchRight',
                'Uni_QuickSlants',
                'Uni_FourVerts'
            ]
            : [
                'Cover_2_Zone_Base',
                'Cover_1_Robber',
                'Man_Blitz_Base',
                'GoalLine_RunStuff'
            ];

        const installedKeys = isOffense
            ? (team.gameplan.installedOffense || [])
            : (team.gameplan.installedDefense || []);

        const allowedKeys = new Set([
            ...foundationKeys,
            ...installedKeys
        ]);

        // An explicit empty selection means the assignment has no target
        // plays. If no selection has been saved, use its available plays.
        const requestedKeys = Array.isArray(assignment.playKeys)
            ? assignment.playKeys
            : [...allowedKeys];

        const targetedKeys = [
            ...new Set(requestedKeys.filter(key => allowedKeys.has(key)))
        ];

        if (targetedKeys.length === 0) continue;

        const assignedCoach = coaches.find(
            coach =>
                String(coach.id) === String(assignment.coachId)
        );

        const skillKeys = isOffense
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

        const ratings = assignedCoach?.ratings || {};

        const skillScore = skillKeys.reduce((sum, key) => {
            const value = Number(ratings[key]);

            return sum + (
                Number.isFinite(value)
                    ? Math.max(0, Math.min(100, value))
                    : 50
            );
        }, 0) / skillKeys.length;

        // Stronger preparation coaches get more value from the same hours.
        const skillFactor = 0.70 + (skillScore / 250);
        const effectiveHoursPerPlay =
            effectiveHours / targetedKeys.length;

        // Four effective hours per play is the full weekly prep target.
        const hoursFactor = Math.min(
            1,
            effectiveHoursPerPlay / 4
        );

        const masteryGain = Math.round(
            5 * hoursFactor * skillFactor
        );

        if (masteryGain <= 0) continue;

        for (const playKey of targetedKeys) {
            const previousMastery = Number(mastery[playKey]);

            mastery[playKey] = Math.min(
                100,
                (Number.isFinite(previousMastery)
                    ? previousMastery
                    : 35) + masteryGain
            );

            totalPreparationMasteryGain += masteryGain;
        }
    }

    if (
        totalPreparationMasteryGain > 0 &&
        team.id === game?.playerTeam?.id &&
        gameLog
    ) {
        gameLog.push(
            `📚 Staff Prep: Offensive and defensive preparation added ` +
            `${totalPreparationMasteryGain} total playbook mastery points.`
        );
    }

    // 2. DRILL EXECUTION
    const disciplineBonus = Math.round((discipline - 50) / 10); // -2 to +4 bonus

    if (plan === 'chalk_talk') {
        const rawInstallGains = Math.max(
            10,
            Math.round(12 + (teaching / 10) + disciplineBonus)
        );

        const installGains = Math.max(
            3,
            Math.round(rawInstallGains * trainingOutputFactor)
        );
        activeInstalled.forEach(key => {
            mastery[key] = Math.min(100, (mastery[key] || 35) + installGains);
        });

        // Youth IQ mentorship
        roster.forEach(p => {
            if (
                p.age <= 15 &&
                Math.random() < 0.25 * trainingOutputFactor &&
                (p.attributes?.mental?.playbookIQ || 50) < 95
            ) {
                p.attributes.mental.playbookIQ += 1;
            }
        });
        if (team.id === game?.playerTeam?.id && gameLog) {
            gameLog.push(`📋 Chalk Talk: Kids studied napkin schemes (+${installGains}% mastery). IQ reps gained!`);
        }
    } else if (plan === 'conditioning') {
        const condGainChance = (
            0.15 + (coach?.ratings?.conditioning || 50) / 300
        ) * trainingOutputFactor;
        roster.forEach(p => {
            if (Math.random() < condGainChance && (p.attributes?.physical?.stamina || 50) < 95) {
                p.attributes.physical.stamina += 1;
            }
            if (
                Math.random() < 0.12 * trainingOutputFactor &&
                (p.attributes?.mental?.toughness || 50) < 95
            ) {
                p.attributes.mental.toughness += 1;
            }
        });
        if (team.id === game?.playerTeam?.id && gameLog) {
            gameLog.push("🏃 Tire Drills: Sprints in full sun toughened up fourth-quarter stamina!");
        }
    } else if (plan === 'scrimmage') {
        roster.forEach(p => {
            p.fatigue = Math.max(
                0,
                (p.fatigue || 0) -
                    Math.round(25 * trainingOutputFactor)
            );

            if (
                Math.random() < 0.18 * trainingOutputFactor &&
                (p.attributes?.technical?.catchingHands || 50) < 95
            ) {
                p.attributes.technical.catchingHands += 1;
            }
            if (
                Math.random() < 0.18 * trainingOutputFactor &&
                (p.attributes?.technical?.tackling || 50) < 95
            ) {
                p.attributes.technical.tackling += 1;
            }
        });
        if (team.id === game?.playerTeam?.id && gameLog) {
            gameLog.push("🧃 Sandlot Scrimmage: Two-hand touch & freeze pops healed fatigue and built hands!");
        }
    } else if (plan === 'scouting') {
        team.scoutingBoostActive = true;
        if (team.id === game?.playerTeam?.id && gameLog) {
            gameLog.push("🕵️ Recess Recon: Spied on next opponent's favorite plays. Defensive boost active!");
        }
    } else if (plan === 'hustle') {
        // === THE HUSTLE: MOWING LAWNS & WASHING CARS ===
        let workersCount = 0;
        let skippedWorkers = [];
        const coachAuth = coach?.ratings?.authority || 50;

        roster.forEach(p => {
            const ego = p.personality?.ego || 50;
            const ethic = p.personality?.workEthic || 50;
            const age = p.age || 14;

            // Compliance Check: Divas & older teens with cars resist manual labor
            // Coach authority reduces the chance of skipping
            const divaResistance = (ego > 70 ? (ego - 60) * 0.012 : 0) + (age >= 17 ? 0.20 : 0);
            const coachFear = (coachAuth / 200);
            const skipChance = Math.max(0, Math.min(0.75, divaResistance - (ethic * 0.005) - coachFear));

            if (Math.random() < skipChance) {
                skippedWorkers.push(p.name.split(' ')[0]);
                // Resentment: skipping chore day harms reputation with teammates
                if (p.expectations) p.expectations.happiness = Math.max(10, (p.expectations.happiness || 100) - 12);
            } else {
                workersCount++;
                // Grinders build grit through labor
                if (ethic >= 70 && Math.random() < 0.15 && (p.attributes?.mental?.toughness || 50) < 95) {
                    p.attributes.mental.toughness += 1;
                }
                // Modest happiness drop for regular kids who'd rather play ball
                if (ethic < 60 && p.expectations) {
                    p.expectations.happiness = Math.max(20, (p.expectations.happiness || 100) - 4);
                }
            }
        });

        // Dynamic cash yield: Each working player earns $0.85 to $1.15
        const cashEarned = Number((workersCount * (0.85 + Math.random() * 0.30)).toFixed(2));
        if (!team.finances) team.finances = { balance: 0, waivedDues: [] };
        team.finances.balance += cashEarned;

        recordFinanceLedgerEntry(
            team,
            game,
            'hustle',
            'Hustle practice earnings',
            cashEarned
        );

        // Scheme rust penalty: No football was practiced this week (-4% familiarity)
        Object.keys(mastery).forEach(key => {
            if (mastery[key] > 30) mastery[key] = Math.max(30, mastery[key] - 4);
        });

        if (team.id === game?.playerTeam?.id && gameLog) {
            const skipMsg = skippedWorkers.length > 0 ? ` (Boycotted by: ${skippedWorkers.slice(0, 3).join(', ')})` : '';
            gameLog.push(`🧹 Neighborhood Hustle: ${workersCount}/${roster.length} kids washed cars and mowed lawns, raising $${cashEarned.toFixed(2)}${skipMsg}. Schemes suffered slight rust (-4% mastery).`);
        }
    }
}

export function advanceToOffseason() {
    if (!game || !game.teams || !game.players) {
        return {
            retiredPlayers: [],
            hofInductees: [],
            developmentResults: [],
            leavingPlayers: [],
            pendingRetentions: []
        };
    }

    // Initialize tracking arrays at the top so any offseason phase can safely push to them
    const retiredPlayers = [];
    const hofInductees = [];
    const developmentResults = [];
    const leavingPlayers = [];
    const pendingRetentions = [];
    const pendingRetentionIds = new Set();

    // Persist the queue with the game state so the interview flow can access it.
    game.pendingRetentions = pendingRetentions;

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

        // Relegation Walkouts: Divas with low loyalty refuse to play in Tier 2.
        // User-controlled teams get an exit interview rather than an immediate departure.
        relegated.forEach(relTeam => {
            const teamRoster = getRosterObjects(relTeam);

            teamRoster.forEach(p => {
                if (
                    (p.personality?.streetCred || 50) <= 65 ||
                    (p.personality?.loyalty || 50) >= 45
                ) {
                    return;
                }

                // Age-18 seniors are retiring in the lifecycle pass below.
                // Leave them attached so retirement and player history are processed normally.
                if (p.age >= 18) return;

                const isUserTeam =
                    relTeam.id === game.playerTeam?.id;

                const reason = 'Refused to play in Sandlot Circuit (Tier 2)';

                // Resolve due promises before allowing an exit interview.
                const retentionCheck = evaluatePlayerRetention(
                    p,
                    relTeam,
                    p.careerStats?.snapsThisSeason || 0
                );

                if (retentionCheck.permanentDeparture) {
                    // Do not queue an interview. Keep the player attached so
                    // the normal lifecycle records the permanent departure.
                    return;
                }

                if (isUserTeam && game.year >= 5) {
                    if (!pendingRetentionIds.has(p.id)) {
                        pendingRetentions.push({
                            player: p,
                            playerId: p.id,
                            reason,
                            snapsThisSeason: p.careerStats?.snapsThisSeason || 0,
                            teamWins: relTeam.wins || 0,
                            teamLosses: relTeam.losses || 0
                        });

                        pendingRetentionIds.add(p.id);
                    }

                    // Keep player.teamId intact until the exit interview resolves.
                    return;
                }

                leavingPlayers.push({
                    player: p,
                    reason,
                    teamName: relTeam.name
                });

                p.teamId = null;

                if (isUserTeam) {
                    addMessage(
                        "Relegation Walkout",
                        `🏃 ${p.name} refused to play in Tier 2 and walked away to Free Agency!`
                    );
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

        const gmRelationshipBonus = team.id === game.playerTeam?.id
            ? (team.gmProfile?.bonuses?.relationshipGrowth || 0)
            : 0;

        const relationshipImproveChance = Math.min(
            0.5,
            teammateImproveChance + gmRelationshipBonus
        );

        for (let i = 0; i < fullRoster.length; i++) {
            for (let j = i + 1; j < fullRoster.length; j++) {
                const p1 = fullRoster[i]; const p2 = fullRoster[j];
                if (!p1 || !p2) continue;

                if (Math.random() < relationshipImproveChance) {
                    improveRelationship(p1.id, p2.id);
                }
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

        // Youth players are handled separately below.
        // Do not age/develop them again in the universal player lifecycle pass.
        if (team?.leagueType === 'youth' || player.lifecycle === 'youth') {
            return;
        }

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

        player.age++;
        player.careerStats.seasonsPlayed = (player.careerStats.seasonsPlayed || 0) + 1;
        const snapsThisSeason = player.careerStats.snapsThisSeason || 0;

        // --- THE AGING PROCESS: PERSONALITY-DRIVEN MATURATION ---
        if (player.age >= 15) {
            const ethic = player.personality?.workEthic || 50;
            const currentEgo = player.personality?.ego || 50;
            const cred = player.personality?.streetCred || 50;

            if (player.personality) {
                // 1. Ego Inflation: Only affects kids with high street cred / low humility
                const egoVulnerable = (currentEgo > 55 || cred > 60) && ethic < 75;
                if (egoVulnerable && Math.random() < 0.65) {
                    player.personality.ego = Math.min(100, currentEgo + getRandomInt(2, 5));
                } else if (ethic >= 80 && Math.random() < 0.35) {
                    // Dedicated team leaders stay humble
                    player.personality.ego = Math.max(10, currentEgo - 1);
                }

                // 2. Loyalty Decay: Only kids with low work ethic or existing wanderlust lose loyalty
                const loyaltyDecayChance = (100 - (player.personality.loyalty || 50)) / 120;
                if (ethic < 45 && Math.random() < loyaltyDecayChance) {
                    player.personality.loyalty = Math.max(0, (player.personality.loyalty || 50) - getRandomInt(1, 4));
                }
            }

            // 3. Stamina Decay / Laziness: Only slackers lose conditioning!
            if (player.attributes?.physical?.stamina) {
                if (ethic < 40 && Math.random() < 0.60) {
                    // Lazy teenagers lose stamina
                    player.attributes.physical.stamina = Math.max(20, player.attributes.physical.stamina - getRandomInt(2, 4));
                } else if (ethic >= 75 && player.attributes.physical.stamina < 90 && Math.random() < 0.30) {
                    // Hardworking gym rats gain conditioning through summer training
                    player.attributes.physical.stamina = Math.min(99, player.attributes.physical.stamina + 1);
                }
            }

            // 4. Role & Touch Expectations: Only stars and divas demand focal touches
            if (player.expectations) {
                if (currentEgo > 60 || cred > 65) {
                    player.expectations.desiredRole = 'STARTER';
                    if (['QB', 'RB', 'WR', 'TE'].includes(player.favoriteOffensivePosition)) {
                        player.expectations.minTouchesPerGame = Math.floor((player.age - 14) * 1.5);
                    }
                } else if (ethic >= 70) {
                    // Unselfish kids are content being rotational contributors
                    player.expectations.desiredRole = 'ROTATION';
                }
            }
        }

        // Run full player development (biological maturation + drill points)
        const devReport = developPlayer(player, team);
        developmentResults.push(devReport);

        // Record End-of-Year Progression Snapshot WITH DETAILED ATTRIBUTE GAINS
        if (!player.progression) player.progression = [];
        player.progression.push({
            year: game.year - 1,
            age: player.age,
            teamName: teamName,
            ovr: calculateOverall(player, estimateBestPosition(player)),
            improvements: devReport.improvements || [],
            stats: {
                passYards: player.seasonStats?.passYards || 0,
                rushYards: player.seasonStats?.rushYards || 0,
                recYards: player.seasonStats?.recYards || 0,
                touchdowns: player.seasonStats?.touchdowns || 0,
                tackles: player.seasonStats?.tackles || 0,
                sacks: player.seasonStats?.sacks || 0,
                interceptions: player.seasonStats?.interceptions || 0
            }
        });

        let playerIsLeaving = false;
        let permanentWalkout = false;
        let finalDepartureReason = '';
        
        // Everyone retires at age 19 (After their 18yo Senior season), even Free Agents
        if (player.age >= 19) {
            retiredPlayers.push(player);
            playerIsLeaving = true;
            if (team && team.id === game.playerTeam?.id && game.year >= 5) {
                addMessage("Player Retires", `${player.name} graduated and hung up his cleats.`);
            }

            // Former Legend to Coach Pipeline (SPAM SUPPRESSED DURING HISTORICAL PRE-SIM)
            const newCoach = checkRetiredPlayerToCoach(player);
            if (newCoach) {
                if (!game.availableStaff) game.availableStaff = [];
                game.availableStaff.unshift(newCoach);

                // Only alert user for their own players or true league legends after Year 4
                const isMyPlayer = team && team.id === game.playerTeam?.id;
                const isLegend = (player.careerStats?.touchdowns || 0) >= 20;
                if (game.year >= 5 && (isMyPlayer || isLegend)) {
                    addMessage("Sideline Legend", `🎓 <b>${player.name}</b> (${teamName}) graduated and joined the coaching market!`);
                }
            }

            if ((player.careerStats.touchdowns || 0) > 25) {
                if (!game.hallOfFame) game.hallOfFame = [];
                game.hallOfFame.push(player); hofInductees.push(player);
                if (team && team.id === game.playerTeam?.id) addMessage("Hall of Fame!", `${player.name} inducted!`);
            }
        }
        else if (team) {
            // A relegation walkout may already be waiting for an exit interview.
            // Don't roll another departure event or queue the same player twice.
            if (pendingRetentionIds.has(player.id)) {
                // Keep the player attached until the interview resolves.
            } else {
                // Realistic Contract Retention & Broken Promise Evaluation
                const retentionCheck = evaluatePlayerRetention(
                    player,
                    team,
                    snapsThisSeason
                );

                let wantsToLeave = !retentionCheck.willStay;
                let leaveReason = retentionCheck.reason;

                if (!wantsToLeave) {
                    // Occasional life events (moved away, skateboard accident)
                    for (const event of departureEvents) {
                        if (Math.random() < event.chance) {
                            wantsToLeave = true;
                            leaveReason = event.reason;
                            break;
                        }
                    }
                }

                const isUserTeam = team.id === game.playerTeam?.id;

                // AI coaches get one retention attempt for genuine flight risks.
                // Broken-promise departures are permanent and cannot be negotiated away.
                if (
                    wantsToLeave &&
                    !isUserTeam &&
                    game.year >= 5 &&
                    !retentionCheck.willStay &&
                    !retentionCheck.permanentDeparture
                ) {
                    const aiRetention = evaluateAiRetentionPitch(
                        player,
                        team,
                        {
                            completedWins: team.wins || 0,
                            completedLosses: team.losses || 0,
                            snapsThisSeason
                        }
                    );

                    if (aiRetention.accepted && aiRetention.pitch) {
                        const aiOffer = aiRetention.pitch;

                        // Spend tokens only after the player accepts the offer.
                        if (aiOffer.tokensOffered > 0 && team.socialProfile) {
                            team.socialProfile.favorTokens = Math.max(
                                0,
                                team.socialProfile.favorTokens - aiOffer.tokensOffered
                            );
                        }

                        player.activePromise = createPlayerPromise(
                            player,
                            team,
                            {
                                role: aiOffer.rolePromised,
                                promiseType: aiOffer.promiseType,
                                tokensOffered: aiOffer.tokensOffered
                            },
                            {
                                promiseSeason: game.year,
                                source: 'aiRetention'
                            }
                        );

                        // A successful conversation repairs some of the relationship,
                        // but doesn't guarantee the player will stay forever.
                        if (player.personality) {
                            player.personality.loyalty = Math.min(
                                99,
                                (player.personality.loyalty ?? 50) + 3
                            );
                        }

                        if (!player.expectations) {
                            player.expectations = { happiness: 50 };
                        }

                        player.expectations.happiness = Math.min(
                            100,
                            (player.expectations.happiness ?? 50) + 8
                        );

                        player.retentionHistory = player.retentionHistory || [];
                        player.retentionHistory.push({
                            year: game.year - 1,
                            outcome: 'AI_RETAINED',
                            teamId: team.id,
                            role: aiOffer.rolePromised,
                            promiseType: aiOffer.promiseType,
                            tokensOffered: aiOffer.tokensOffered
                        });

                        // The normal departure branch below must not release this player.
                        wantsToLeave = false;
                    }
                }

                // Queue persuadable user-team flight risks.
                // Permanent broken-promise departures will bypass negotiations.
                if (
                    wantsToLeave &&
                    isUserTeam &&
                    game.year >= 5 &&
                    !retentionCheck.permanentDeparture
                ) {
                    pendingRetentions.push({
                        player,
                        playerId: player.id,
                        reason: leaveReason,
                        snapsThisSeason,
                        teamWins: team.wins || 0,
                        teamLosses: team.losses || 0
                    });

                    pendingRetentionIds.add(player.id);

                    // Do not set playerIsLeaving or clear player.teamId.
                } else if (wantsToLeave) {
                    permanentWalkout = !!retentionCheck.permanentDeparture;
                    finalDepartureReason = leaveReason;

                    leavingPlayers.push({
                        player,
                        reason: leaveReason,
                        teamName: team.name
                    });

                    playerIsLeaving = true;

                    if (isUserTeam) {
                        addMessage(
                            "Contract Departure",
                            `🚶 <b>${player.name}</b> walked away to Free Agency: ${leaveReason}`
                        );
                    }
                }
            }
        }

        player.seasonStats = createEmptySeasonStats();
        if (!playerIsLeaving) {
            if (!player.status) player.status = {};
            player.status = { type: 'healthy', description: '', duration: 0 };
        } else {
            if (team) {
                if (!player.playerHistory) {
                    player.playerHistory = { teamsPlayedFor: [] };
                }

                player.playerHistory.teamsPlayedFor.push({
                    teamId: team.id,
                    teamName: team.name,
                    year: game.year - 1
                });
            }

            player.teamId = null;

            if (player.age >= 19) {
                player.status = {
                    type: 'retired',
                    description: 'Graduated High School',
                    duration: 0
                };
            } else if (permanentWalkout) {
                // Permanent separation from this team, but still available
                // to other teams in Free Agency.
                player.status = {
                    type: 'healthy',
                    description: finalDepartureReason || 'Left after a broken promise',
                    duration: 0
                };

                player.permanentWalkoutYear = game.year - 1;
            } else {
                player.status = {
                    type: 'departed',
                    description: 'Left the league',
                    duration: 0
                };
            }

            totalVacancies++;
        }
    });

    // Re-compile valid rosters based on the updated universal player pool
    game.teams.forEach(team => {
                team.roster = game.players
            .filter(p =>
                p &&
                p.teamId === team.id &&
                !['retired', 'departed', 'temporary'].includes(p.status?.type) &&
                (!p.status || p.status.duration === 0 || p.status.type === 'healthy')
            )
            .map(p => p.id);

        // Remove special-team and package assignments that reference players
        // who no longer belong to this team's active roster.
        const activeRosterIds = new Set(team.roster);

        const isActiveTeamPlayer = playerId => {
            const player = playerId ? getPlayer(playerId) : null;

            return Boolean(
                player &&
                activeRosterIds.has(player.id) &&
                player.teamId === team.id &&
                !['retired', 'departed', 'temporary'].includes(player.status?.type)
            );
        };

        const previousSpecialTeams =
            team.specialTeams ?? team.depthChart?.specialTeams ?? {};

        team.specialTeams = Object.fromEntries(
            Object.entries(previousSpecialTeams)
                .filter(([, playerId]) => isActiveTeamPlayer(playerId))
        );

        team.specialists = Object.fromEntries(
            Object.entries(team.specialists ?? {})
                .filter(([, playerId]) => isActiveTeamPlayer(playerId))
        );

        // Safeguard: Never let CPU teams drop below the threshold needed to field an 8v8 unit
        if (!team.isPlayerControlled && team.leagueType === 'main' && team.roster.length < 11) {
            autoFillTeamWalkOns(team, 11);
        }

        if (team.depthChart && team.formations) {
            const offSlots = offenseFormations[team.formations.offense]?.slots || [];
            team.depthChart.offense = Object.fromEntries(offSlots.map(slot => [slot, null]));
            const defSlots = defenseFormations[team.formations.defense]?.slots || [];
            team.depthChart.defense = Object.fromEntries(defSlots.map(slot => [slot, null]));
            team.depthChart.special = { P: null };
        }

        if (team.depthChart) {
            team.depthChart.specialTeams = team.specialTeams;
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
        if (
            !p.teamId &&
            p.status?.type !== 'retired' &&
            p.status?.type !== 'departed' &&
            p.permanentWalkoutYear !== game.year - 1
        ) {
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
    // Start with a clean class. Undrafted prospects from the previous board
    // remain in game.players and must not carry over into the next draft.
    game.draftClass = [];
    const youthTeams = game.teams.filter(t => t.leagueType === 'youth');

    youthTeams.forEach(yt => {
        yt.roster = yt.roster.filter(id => {
            const kid = getPlayer(id);
            if (!kid) return false;

            developPlayer(kid, yt);
            kid.age++;
            kid.careerStats.seasonsPlayed = (kid.careerStats.seasonsPlayed || 0) + 1;

            // Reset season stats for all returning youth players
            kid.seasonStats = createEmptySeasonStats();

            // Pee-Wee graduates at age 12 into the Rookie Draft
            if (kid.age >= 12) {
                kid.teamId = null;
                kid.careerStats.snapsThisSeason = 0;

                // LOGIC: Does the 12-year-old declare for the draft or wait as a street walk-on?
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

    // 💡 TOP OFF DRAFT CLASS WITH STRICTLY AGE 12 ROOKIES (Guarantee 65 prospects for 60 picks)
    const thisYearsClassModifiers = generateDraftClassModifiers();
    const neededDraftRookies = Math.max(0, 65 - game.draftClass.length);
    const newAge12Rookies = [];

    for (let i = 0; i < neededDraftRookies; i++) {
        const rookie = generatePlayer(12, 12, thisYearsClassModifiers); // STRICTLY AGE 12
        rookie.lifecycle = 'draft_eligible';
        if (!rookie.personality) rookie.personality = {};
        rookie.personality.entersDraft = true;
        game.players.push(rookie);
        playerMap.set(rookie.id, rookie);
        game.draftClass.push(rookie);
        newAge12Rookies.push(rookie);
    }

    // 💡 GENERATE OLDER MOVE-INS (Ages 13-17) DIRECTLY INTO STREET FREE AGENCY
    const newOlderWalkons = [];
    for (let i = 0; i < 5; i++) {
        const olderKid = generatePlayer(13, 17, thisYearsClassModifiers);
        olderKid.lifecycle = 'active';
        if (!olderKid.personality) olderKid.personality = {};
        olderKid.personality.entersDraft = false;
        game.players.push(olderKid);
        playerMap.set(olderKid.id, olderKid);
        newOlderWalkons.push(olderKid);
    }

    // Initialize inherited scouting knowledge for the completed incoming class.
    // Apply banked weekly scouting afterward so that work builds on that baseline.
    mainTeams.forEach(team => {
        initializeInheritedScoutingReports(
            team,
            game.draftClass,
            game.year,
            0
        );
    });

    // Apply the previous regular season's banked scouting hours.
    let userDraftScoutingResult = null;

    mainTeams.forEach(team => {
        const result = applyBankedDraftScoutingReports(
            team,
            game,
            game.year,
            0
        );

        if (team.id === game.playerTeam?.id) {
            userDraftScoutingResult = result;
        }
    });

    // Give the user a confirmation when banked scouting work was applied.
    if (
        userDraftScoutingResult &&
        userDraftScoutingResult.workItemsApplied > 0
    ) {
        addMessage(
            'Draft Scouting Completed',
            `Your staff's banked scouting effort was applied to the Year ${game.year} draft class. ${userDraftScoutingResult.playersUpdated} report updates were processed using ${userDraftScoutingResult.hoursUsed} hours across ${userDraftScoutingResult.workItemsApplied} weekly assignments.`,
            false,
            game
        );
    }

    // Connect new recruits into the social network
    const livingActivePlayers = game.players.filter(p => p.status?.type !== 'retired' && p.status?.type !== 'departed');
    buildSocialNetworks([...newAge12Rookies, ...newOlderWalkons], livingActivePlayers);

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
    const hofIds = new Set(
        (game.hallOfFame || [])
            .map(p => (typeof p === 'object' && p !== null ? p.id : p))
            .filter(Boolean)
    );
    game.players = game.players.filter(p => {
        if (p.status?.type === 'retired' || p.status?.type === 'departed') {
            return hofIds.has(p.id) || hofIds.has(String(p.id));
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
    game.offseasonFACompleted = false;
    game._faDay = 1;
    game._activeFaMarket = new Map();
    game.currentWeek = 0;
    // AUTONOMOUS AI CAROUSEL: AI GMs manage staff, fire bad coaches, hire legends
    game.teams.forEach(t => {
        assignTeamCaptain(t);
        if (!t.isPlayerControlled) {
            aiManageTeamStaff(t, game);
        }
    });

    return { retiredPlayers, hofInductees, developmentResults, leavingPlayers, pendingRetentions };
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

        // Clean up captaincy if captain was cut
        if (team.captainId === playerId) {
            team.captainId = null;
            assignTeamCaptain(team);
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

export function playerSignFreeAgent(playerId, offer = {}) {
    if (!game || !game.playerTeam || !game.playerTeam.roster || !game.players) {
        return { success: false, message: "Game state error." };
    }
    const team = game.playerTeam;
    const roster = getRosterObjects(team);
    const limit = getCurrentRosterLimit(game);
    if (roster.length >= limit) {
        return { success: false, message: `Summer Roster is full (${limit} players max).` };
    }

    const player = game.players.find(p => p && p.id === playerId && !p.teamId);
    if (!player) return { success: false, message: "Player not found." };
    if (player.status?.duration > 0) return { success: false, message: `${player.name} is unavailable.` };

    const negotiation = evaluatePlayerNegotiation(player, team, offer);

    if (!negotiation.accepted) {
        return {
            success: false,
            message: `✋ ${player.name} rejected your pitch: ${negotiation.reasons.join(' • ')}`
        };
    }

    if (addPlayerToTeam(player, team)) {
        if (offer.tokensOffered > 0) {
            team.socialProfile.favorTokens = Math.max(
                0,
                (team.socialProfile.favorTokens || 0) - offer.tokensOffered
            );
        }

        player.activePromise = createPlayerPromise(
            player,
            team,
            offer,
            { promiseSeason: game.year, source: 'directFA' }
        );

        aiSetDepthChart(team);

        addMessage(
            "Free Agent Signed",
            `🤝 <b>${player.name}</b> accepted your contract pitch! (${negotiation.reasons.join(', ')})`
        );

        return { success: true, message: `Signed ${player.name}!` };
    }

    return { success: false, message: "Failed to add player." };
}
