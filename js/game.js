import { getRandom, getRandomInt } from './utils.js';
import { firstNames, lastNames, nicknames, teamNames, positions, divisionNames, coachPersonalities } from './data.js';

let game = null;

const offensivePositions = ['QB', 'RB', 'WR', 'OL'];
const defensivePositions = ['DL', 'LB', 'DB'];

const weeklyEvents = [
    { type: 'injured', description: 'Sprained Ankle', minDuration: 1, maxDuration: 2, chance: 0.01 },
    { type: 'injured', description: 'Jammed Finger', minDuration: 1, maxDuration: 1, chance: 0.015 },
    { type: 'busy', description: 'Grounded by Parents', minDuration: 1, maxDuration: 3, chance: 0.02 },
    { type: 'busy', description: 'Big School Project', minDuration: 1, maxDuration: 1, chance: 0.02 },
    { type: 'busy', description: 'Family Vacation', minDuration: 1, maxDuration: 2, chance: 0.005 }
];

export const positionOverallWeights = {
    QB: { throwingAccuracy: 0.4, playbookIQ: 0.3, consistency: 0.1, clutch: 0.1, speed: 0.05, agility: 0.05 },
    RB: { speed: 0.3, strength: 0.2, agility: 0.2, catchingHands: 0.1, blocking: 0.1, stamina: 0.1 },
    WR: { speed: 0.3, catchingHands: 0.3, agility: 0.2, height: 0.1, clutch: 0.1 },
    OL: { strength: 0.4, blocking: 0.4, weight: 0.1, playbookIQ: 0.1 },
    DL: { strength: 0.4, tackling: 0.25, blockShedding: 0.2, weight: 0.1, agility: 0.05 },
    LB: { tackling: 0.3, speed: 0.2, strength: 0.2, blockShedding: 0.1, playbookIQ: 0.2 },
    DB: { speed: 0.35, agility: 0.25, catchingHands: 0.15, tackling: 0.1, playbookIQ: 0.15 }
};


export function calculateOverall(player, position) {
    const attrs = player.attributes;
    const relevantWeights = positionOverallWeights[position];
    if (!relevantWeights) return 0;

    let score = 0;
    for (const category in attrs) {
        for (const attr in attrs[category]) {
            if (relevantWeights[attr]) {
                let value = attrs[category][attr];
                if (attr === 'weight') value = value / 2.5; 
                if (attr === 'height') value = (value - 60);
                score += value * relevantWeights[attr];
            }
        }
    }
    
    return Math.min(99, Math.max(1, Math.round(score)));
}

function generatePlayer(minAge = 8, maxAge = 17) {
    const firstName = getRandom(firstNames);
    const lastName = Math.random() < 0.4 ? getRandom(nicknames) : getRandom(lastNames);
    const age = getRandomInt(minAge, maxAge);
    const favoriteOffensivePosition = getRandom(offensivePositions);
    const favoriteDefensivePosition = getRandom(defensivePositions);

    const ageProgress = (age - 8) / (17 - 8);
    let baseHeight = 53 + (ageProgress * 16) + getRandomInt(-2, 2);
    let baseWeight = 60 + (ageProgress * 90) + getRandomInt(-10, 10);
    
    const bestPosition = getRandom(positions);

    switch (bestPosition) {
        case 'QB': case 'WR': baseHeight += getRandomInt(1, 4); baseWeight -= getRandomInt(0, 10); break;
        case 'OL': case 'DL': baseHeight -= getRandomInt(0, 2); baseWeight += getRandomInt(20, 40); break;
        case 'RB': baseWeight += getRandomInt(5, 15); break;
    }

    let attributes = {
        physical: { speed: getRandomInt(40, 70), strength: getRandomInt(40, 70), agility: getRandomInt(40, 70), stamina: getRandomInt(50, 80), height: Math.round(baseHeight), weight: Math.round(baseWeight) },
        mental: { playbookIQ: getRandomInt(30, 70), clutch: getRandomInt(20, 90), consistency: getRandomInt(40, 80) },
        technical: { throwingAccuracy: getRandomInt(20, 50), catchingHands: getRandomInt(30, 60), tackling: getRandomInt(30, 60), blocking: getRandomInt(30, 60), blockShedding: getRandomInt(30, 60) }
    };
    
    const weightModifier = (attributes.physical.weight - 125) / 50; 
    attributes.physical.strength = Math.round(attributes.physical.strength + weightModifier * 10);
    attributes.physical.speed = Math.round(attributes.physical.speed - weightModifier * 8);
    attributes.physical.agility = Math.round(attributes.physical.agility - weightModifier * 5);

     switch (bestPosition) {
        case 'QB': attributes.technical.throwingAccuracy = getRandomInt(65, 95); attributes.mental.playbookIQ = getRandomInt(60, 95); break;
        case 'RB': attributes.physical.speed = getRandomInt(60, 90); attributes.physical.strength = getRandomInt(55, 85); attributes.physical.agility = getRandomInt(60, 90); break;
        case 'WR': attributes.physical.speed = getRandomInt(65, 95); attributes.technical.catchingHands = getRandomInt(60, 95); attributes.physical.agility = getRandomInt(70, 95); break;
        case 'OL': attributes.physical.strength = getRandomInt(70, 95); attributes.technical.blocking = getRandomInt(65, 95); break;
        case 'DL': attributes.physical.strength = getRandomInt(70, 95); attributes.technical.tackling = getRandomInt(65, 95); attributes.technical.blockShedding = getRandomInt(60, 90); break;
        case 'LB': attributes.technical.tackling = getRandomInt(65, 95); attributes.physical.speed = getRandomInt(60, 85); attributes.mental.playbookIQ = getRandomInt(50, 85); break;
        case 'DB': attributes.physical.speed = getRandomInt(70, 95); attributes.physical.agility = getRandomInt(70, 95); attributes.technical.catchingHands = getRandomInt(50, 80); break;
    }

    Object.keys(attributes).forEach(cat => Object.keys(attributes[cat]).forEach(attr => {
        if (typeof attributes[cat][attr] === 'number' && !['height', 'weight'].includes(attr)) {
            attributes[cat][attr] = Math.max(1, Math.min(99, attributes[cat][attr]));
        }
    }));

    return { id: crypto.randomUUID(), name: `${firstName} ${lastName}`, age, favoriteOffensivePosition, favoriteDefensivePosition, attributes, teamId: null, status: { type: 'healthy', description: '', duration: 0 }, gameStats: {}, seasonStats: {}, careerStats: { seasonsPlayed: 0 } };
}

export function yieldToMain() { return new Promise(resolve => setTimeout(resolve, 0)); }

export async function initializeLeague(onProgress) {
    console.log("Initializing league...");
    game = { year: 1, teams: [], players: [], freeAgents: [], playerTeam: null, schedule: [], currentWeek: 0, divisions: {}, draftOrder: [], currentPick: 0, hallOfFame: [] };
    game.divisions[divisionNames[0]] = []; game.divisions[divisionNames[1]] = [];
    const totalPlayers = 300;
    for (let i = 0; i < totalPlayers; i++) {
        game.players.push(generatePlayer());
        if (i % 10 === 0) { onProgress(i / totalPlayers); await yieldToMain(); }
    }
    const availableTeamNames = [...teamNames];
    for (let i = 0; i < 19; i++) {
        const teamName = `The ${availableTeamNames.splice(getRandomInt(0, availableTeamNames.length - 1), 1)[0]}`;
        const division = divisionNames[i % divisionNames.length];
        const team = { id: crypto.randomUUID(), name: teamName, roster: [], coach: getRandom(coachPersonalities), division, wins: 0, losses: 0, depthChart: {} };
        game.teams.push(team); game.divisions[division].push(team.id);
    }
}

export function createPlayerTeam(teamName) {
    const finalTeamName = teamName.toLowerCase().startsWith("the ") ? teamName : `The ${teamName}`;
    const division = game.teams.length % 2 === 0 ? divisionNames[0] : divisionNames[1];
    const playerTeam = {
        id: crypto.randomUUID(), name: finalTeamName, roster: [], coach: getRandom(coachPersonalities), division, wins: 0, losses: 0,
        depthChart: { QB: null, RB: null, WR1: null, WR2: null, DL: null, LB: null, DB: null }
    };
    game.teams.push(playerTeam);
    game.divisions[division].push(playerTeam.id);
    game.playerTeam = playerTeam;
}

function getPlayerScore(player, coach) {
    let score = 0;
    for (const category in player.attributes) {
        for (const attr in player.attributes[category]) {
            score += player.attributes[category][attr] * (coach.attributePreferences[category]?.[attr] || 1.0);
        }
    }
    if (coach.type === 'Youth Scout') score += (18 - player.age) * 10;
    return score;
}

export function setupDraft() {
    game.draftOrder = [];
    game.currentPick = 0;
    const teams = [...game.teams].sort(() => Math.random() - 0.5);
    for (let i = 0; i < 10; i++) { // 10 rounds for 10 players
        game.draftOrder.push(...(i % 2 === 0 ? teams : [...teams].reverse()));
    }
}

export function simulateAIPick(team) {
    const undraftedPlayers = game.players.filter(p => !p.teamId);
    if (undraftedPlayers.length === 0) return null;
    const bestPlayer = undraftedPlayers.reduce((best, current) => {
        const score = getPlayerScore(current, team.coach);
        return score > best.score ? { player: current, score } : best;
    }, { player: null, score: -1 }).player;
    if (bestPlayer) addPlayerToTeam(bestPlayer, team);
    return bestPlayer;
}

export function addPlayerToTeam(player, team) {
    if (team.roster.length < 10) { // Roster size is now 10
        player.teamId = team.id; team.roster.push(player);
        if (team.id === game.playerTeam.id) {
            for (const pos in team.depthChart) {
                if (team.depthChart[pos] === null) { team.depthChart[pos] = player.id; break; }
            }
        }
        return true;
    }
    return false;
}

export function generateSchedule() {
    game.schedule = [];
    for (const divisionName in game.divisions) {
        const divisionTeams = game.teams.filter(t => t.division === divisionName);
        for (let i = 0; i < divisionTeams.length; i++) {
            for (let j = i + 1; j < divisionTeams.length; j++) {
                game.schedule.push({ home: divisionTeams[i], away: divisionTeams[j] });
            }
        }
    }
    game.schedule.sort(() => Math.random() - 0.5);
    game.currentWeek = 0;
}

function resetGameStats() {
    game.players.forEach(player => {
        player.gameStats = { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0 };
    });
}

function getTeamRatings(team) {
    const roster = team.roster.filter(p => p.status.type === 'healthy');
    if (roster.length < 7) return { offense: 0, defense: 0 }; // 7 players needed

    const qb = roster.sort((a,b) => calculateOverall(b, 'QB') - calculateOverall(a, 'QB'))[0];
    const rb = roster.sort((a,b) => calculateOverall(b, 'RB') - calculateOverall(a, 'RB'))[0];
    const wrs = roster.sort((a,b) => calculateOverall(b, 'WR') - calculateOverall(a, 'WR')).slice(0, 2);
    // OL is implicit in 7v7 backyard
    const dl = roster.sort((a,b) => calculateOverall(b, 'DL') - calculateOverall(a, 'DL'))[0];
    const lb = roster.sort((a,b) => calculateOverall(b, 'LB') - calculateOverall(a, 'LB'))[0];
    const db = roster.sort((a,b) => calculateOverall(b, 'DB') - calculateOverall(a, 'DB'))[0];

    const passOffense = calculateOverall(qb, 'QB') + wrs.reduce((sum, p) => sum + calculateOverall(p, 'WR'), 0);
    const rushOffense = calculateOverall(rb, 'RB');
    const passDefense = calculateOverall(db, 'DB') + calculateOverall(lb, 'LB');
    const rushDefense = calculateOverall(dl, 'DL') + calculateOverall(lb, 'LB');

    return { 
        offense: (passOffense + rushOffense), 
        defense: (passDefense + rushDefense) 
    };
}

function simulateGame(homeTeam, awayTeam) {
    resetGameStats();
    const homeRatings = getTeamRatings(homeTeam);
    const awayRatings = getTeamRatings(awayTeam);

    const homeScorePotential = (homeRatings.offense / awayRatings.defense) * 21 * 1.05;
    const awayScorePotential = (awayRatings.offense / homeRatings.defense) * 21;

    let homeScore = Math.max(0, Math.round(Math.random() * homeScorePotential));
    let awayScore = Math.max(0, Math.round(Math.random() * awayScorePotential));

    [homeTeam, awayTeam].forEach((team, isHome) => {
        const score = isHome ? homeScore : awayScore;
        const players = team.roster.filter(p => p.status.type === 'healthy');
        if (score === 0 || players.length === 0) return;

        for (let i = 0; i < Math.floor(score / 7); i++) {
            const scorer = getRandom(players);
            scorer.gameStats.touchdowns = (scorer.gameStats.touchdowns || 0) + 1;
        }
    });

    if (homeScore > awayScore) { homeTeam.wins++; awayTeam.losses++; } 
    else { awayTeam.wins++; homeTeam.losses++; }

    return { homeTeam, awayTeam, homeScore, awayScore };
}

function updatePlayerStatuses() {
    for (const player of game.players) {
        if (player.status.duration > 0) {
            player.status.duration--;
            if (player.status.duration === 0) {
                player.status.type = 'healthy';
                player.status.description = '';
            }
        }
    }
}

function generateWeeklyEvents() {
    for (const player of game.players) {
        if (player.status.type === 'healthy') {
            for (const event of weeklyEvents) {
                if (Math.random() < event.chance) {
                    player.status.type = event.type;
                    player.status.description = event.description;
                    player.status.duration = getRandomInt(event.minDuration, event.maxDuration);
                    break;
                }
            }
        }
    }
}

export function simulateWeek() {
    if (game.currentWeek >= 9) return null;
    updatePlayerStatuses();
    generateWeeklyEvents();
    const weeklyGames = game.schedule.slice(game.currentWeek * 10, (game.currentWeek + 1) * 10);
    const results = weeklyGames.map(match => simulateGame(match.home, match.away));
    game.currentWeek++;
    return results;
}

export function generateWeeklyFreeAgents() {
    const undraftedPlayers = game.players.filter(p => !p.teamId);
    game.freeAgents = [];
    for (let i = 0; i < 5; i++) {
        if (undraftedPlayers.length > 0) {
            const faIndex = getRandomInt(0, undraftedPlayers.length - 1);
            const fa = undraftedPlayers.splice(faIndex, 1)[0];
            game.freeAgents.push(fa);
        }
    }
}

export function aiManageRoster(team) {
    const healthyRoster = team.roster.filter(p => p.status.type === 'healthy');
    if (healthyRoster.length >= 10 || game.freeAgents.length === 0) return; // 10 player roster

    let worstPlayer = team.roster.length > 0 ? team.roster.reduce((worst, p) => getPlayerScore(p, team.coach) < getPlayerScore(worst, team.coach) ? p : worst) : null;
    let bestFA = game.freeAgents.reduce((best, p) => getPlayerScore(p, team.coach) > getPlayerScore(best, team.coach) ? p : best);
    
    if (team.roster.length < 10) {
        addPlayerToTeam(bestFA, team);
        game.freeAgents = game.freeAgents.filter(p => p.id !== bestFA.id);
    } else if (worstPlayer && getPlayerScore(bestFA, team.coach) > getPlayerScore(worstPlayer, team.coach) * 1.1) {
        worstPlayer.teamId = null;
        team.roster = team.roster.filter(p => p.id !== worstPlayer.id);
        addPlayerToTeam(bestFA, team);
        game.freeAgents = game.freeAgents.filter(p => p.id !== bestFA.id);
    }
}

function developPlayer(player) {
    let potential = player.age < 12 ? getRandomInt(4, 8) : player.age < 16 ? getRandomInt(1, 5) : getRandomInt(0, 2);
    const attributesToImprove = ['speed', 'strength', 'agility', 'throwingAccuracy', 'catchingHands', 'tackling', 'blocking', 'playbookIQ', 'blockShedding'];
    for (let i = 0; i < potential; i++) {
        const attrToBoost = getRandom(attributesToImprove);
        for (const category in player.attributes) {
            if (player.attributes[category][attrToBoost] && player.attributes[category][attrToBoost] < 99) {
                player.attributes[category][attrToBoost]++; break;
            }
        }
    }
    player.attributes.physical.height += player.age <= 12 ? getRandomInt(1, 3) : player.age <= 15 ? getRandomInt(0, 2) : getRandomInt(0, 1);
    player.attributes.physical.weight += player.age <= 12 ? getRandomInt(5, 15) : player.age <= 15 ? getRandomInt(3, 10) : getRandomInt(1, 5);
}

export function advanceToOffseason() {
    game.year++; let retiredCount = 0;
    const remainingPlayers = [];
    game.players.forEach(p => {
        p.age++; p.careerStats.seasonsPlayed++; developPlayer(p);
        if (p.age < 18) {
            p.seasonStats = {}; p.status = { type: 'healthy', description: '', duration: 0 };
            remainingPlayers.push(p);
        } else {
            if (p.careerStats.touchdowns > 20 || p.careerStats.passYards > 5000) game.hallOfFame.push(p);
            retiredCount++;
        }
    });
    game.players = remainingPlayers;
    game.teams.forEach(t => { t.roster = []; t.wins = 0; t.losses = 0; if (t.depthChart) Object.keys(t.depthChart).forEach(pos => t.depthChart[pos] = null); });
    game.players.forEach(p => p.teamId = null);
    for (let i = 0; i < retiredCount; i++) game.players.push(generatePlayer(8, 10));
}

export function updateDepthChart(playerId, newPositionSlot) {
    const team = game.playerTeam;
    const oldSlot = Object.keys(team.depthChart).find(key => team.depthChart[key] === playerId);
    const displacedPlayerId = team.depthChart[newPositionSlot];
    team.depthChart[newPositionSlot] = playerId;
    if (oldSlot) {
        team.depthChart[oldSlot] = displacedPlayerId;
    }
}

export function getGameState() { return game; }

