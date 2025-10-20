import { getRandom, getRandomInt } from './utils.js';
import { firstNames, lastNames, nicknames, teamNames, positions, divisionNames, coachPersonalities } from './data.js';

let game = null;

// Define specific offensive and defensive positions for preference
const offensivePositions = ['QB', 'WR', 'RB', 'OL'];
const defensivePositions = ['DL', 'DB', 'LB'];

// Define possible random events
const weeklyEvents = [
    { type: 'injured', description: 'Sprained Ankle', minDuration: 1, maxDuration: 2, chance: 0.01 },
    { type: 'injured', description: 'Jammed Finger', minDuration: 1, maxDuration: 1, chance: 0.015 },
    { type: 'busy', description: 'Grounded by Parents', minDuration: 1, maxDuration: 1, chance: 0.02 },
    { type: 'busy', description: 'Big School Project', minDuration: 1, maxDuration: 1, chance: 0.02 },
    { type: 'busy', description: 'Family Vacation', minDuration: 1, maxDuration: 1, chance: 0.005 }
];

/**
 * Calculates a player's overall rating (1-99) for a specific position slot.
 * @param {object} player - The player object.
 * @param {string} positionSlot - The position slot (e.g., 'QB', 'ATH1', 'LINE2').
 * @returns {number} The player's overall rating for that position.
 */
export function calculateOverall(player, positionSlot) {
    const attrs = player.attributes;
    const weights = {
        QB: { throwingAccuracy: 0.4, playbookIQ: 0.3, consistency: 0.1, clutch: 0.1, speed: 0.05, agility: 0.05 },
        ATH: { speed: 0.25, agility: 0.25, catchingHands: 0.2, stamina: 0.1, tackling: 0.1, clutch: 0.1 },
        LINE: { strength: 0.3, blocking: 0.25, tackling: 0.25, weight: 0.1, playbookIQ: 0.1 }
    };

    let positionType = positionSlot.replace(/\d/g, ''); // 'ATH1' -> 'ATH'
    if (!weights[positionType]) positionType = 'ATH'; // Default for safety

    const relevantWeights = weights[positionType];
    let score = 0;

    for (const category in attrs) {
        for (const attr in attrs[category]) {
            if (relevantWeights[attr]) {
                let value = attrs[category][attr];
                // Normalize weight to be on a similar scale to other attributes
                if (attr === 'weight') value = value / 2.5; 
                score += value * relevantWeights[attr];
            }
        }
    }
    
    return Math.min(99, Math.max(1, Math.round(score)));
}


/**
 * Generates a single player with detailed, position-specific attributes.
 * @param {number} [minAge=8] - The minimum age for the player.
 * @param {number} [maxAge=17] - The maximum age for the player.
 * @returns {object} The complete player object.
 */
function generatePlayer(minAge = 8, maxAge = 17) {
    const firstName = getRandom(firstNames);
    const lastName = Math.random() < 0.4 ? getRandom(nicknames) : getRandom(lastNames);
    const age = getRandomInt(minAge, maxAge);
    const favoriteOffensivePosition = getRandom(offensivePositions);
    const favoriteDefensivePosition = getRandom(defensivePositions);

    const ageProgress = (age - 8) / (17 - 8);
    let baseHeight = 53 + (ageProgress * 16);
    let baseWeight = 60 + (ageProgress * 90);

    baseHeight += getRandomInt(-2, 2);
    baseWeight += getRandomInt(-10, 10);

    // Positional adjustments for height and weight based on offensive preference
    switch (favoriteOffensivePosition) {
        case 'QB': 
            baseHeight += getRandomInt(1, 3); 
            break;
        case 'WR': 
            baseHeight += getRandomInt(1, 4); 
            baseWeight += getRandomInt(-10, 0);
            break;
        case 'RB': 
            baseHeight += getRandomInt(-2, 1); 
            baseWeight += getRandomInt(5, 15); 
            break;
        case 'OL': 
            baseHeight += getRandomInt(0, 2); 
            baseWeight += getRandomInt(20, 40); 
            break;
    }

    let attributes = {
        physical: { speed: getRandomInt(40, 70), strength: getRandomInt(40, 70), agility: getRandomInt(40, 70), stamina: getRandomInt(50, 80), height: Math.round(baseHeight), weight: Math.round(baseWeight) },
        mental: { playbookIQ: getRandomInt(30, 70), clutch: getRandomInt(20, 90), consistency: getRandomInt(40, 80) },
        technical: { throwingAccuracy: getRandomInt(20, 50), catchingHands: getRandomInt(30, 60), tackling: getRandomInt(30, 60), blocking: getRandomInt(30, 60) }
    };

    const weightModifier = (attributes.physical.weight - 125) / 50; 
    attributes.physical.strength += Math.round(weightModifier * 10);
    attributes.physical.speed -= Math.round(weightModifier * 8);
    attributes.physical.agility -= Math.round(weightModifier * 5);

    const bestPosition = getRandom(positions); 
     switch (bestPosition) {
        case 'QB': 
            attributes.technical.throwingAccuracy = getRandomInt(65, 95); 
            attributes.mental.playbookIQ = getRandomInt(60, 95); 
            attributes.physical.speed = getRandomInt(40, 65); 
            break;
        case 'ATH': 
            attributes.physical.speed = getRandomInt(65, 95); 
            attributes.physical.agility = getRandomInt(70, 95);
            attributes.technical.catchingHands = getRandomInt(60, 90); 
            attributes.technical.tackling = getRandomInt(40, 70);
            break;
        case 'LINE': 
            attributes.physical.strength = getRandomInt(70, 95); 
            attributes.technical.blocking = getRandomInt(65, 95);
            attributes.technical.tackling = getRandomInt(60, 90);
            attributes.physical.speed = getRandomInt(30, 55); 
            break;
    }

    for (const category in attributes) {
        for (const attr in attributes[category]) {
            if (typeof attributes[category][attr] === 'number' && !['height', 'weight'].includes(attr)) {
                attributes[category][attr] = Math.max(1, Math.min(99, attributes[category][attr]));
            }
        }
    }

    return {
        id: crypto.randomUUID(), name: `${firstName} ${lastName}`, age, favoriteOffensivePosition, favoriteDefensivePosition, attributes, teamId: null,
        status: { type: 'healthy', description: '', duration: 0 },
        gameStats: { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0 },
        seasonStats: { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0 },
        careerStats: { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0, seasonsPlayed: 0 }
    };
}

export function yieldToMain() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

export async function initializeLeague(onProgress) {
    console.log("Initializing league...");
    const availableTeamNames = [...teamNames];
    const availableDivisions = [...divisionNames];
    
    game = {
        year: 1, teams: [], players: [], freeAgents: [], playerTeam: null,
        schedule: [], currentWeek: 0, divisions: {}, draftOrder: [], currentPick: 0,
        hallOfFame: []
    };

    availableDivisions.forEach(divName => { game.divisions[divName] = []; });

    const totalPlayers = 300;
    for (let i = 0; i < totalPlayers; i++) {
        game.players.push(generatePlayer());
        if (i % 10 === 0) {
            onProgress(i / totalPlayers);
            await yieldToMain();
        }
    }

    for (let i = 0; i < 19; i++) {
        const teamNameIndex = getRandomInt(0, availableTeamNames.length - 1);
        const teamName = `The ${availableTeamNames.splice(teamNameIndex, 1)[0]}`;
        const division = availableDivisions[i % availableDivisions.length];
        const team = {
            id: crypto.randomUUID(), name: teamName, roster: [],
            coach: getRandom(coachPersonalities), division: division, wins: 0, losses: 0,
            depthChart: {}
        };
        game.teams.push(team);
        game.divisions[division].push(team.id);
    }
}

export function createPlayerTeam(teamName) {
    const finalTeamName = teamName.toLowerCase().startsWith("the ") ? teamName : `The ${teamName}`;
    const division = game.teams.length % 2 === 0 ? divisionNames[0] : divisionNames[1];
    const playerTeam = {
        id: crypto.randomUUID(), name: finalTeamName, roster: [],
        coach: getRandom(coachPersonalities), division: division, wins: 0, losses: 0,
        depthChart: { QB: null, ATH1: null, ATH2: null, ATH3: null, LINE1: null, LINE2: null, LINE3: null, LINE4: null }
    };
    game.teams.push(playerTeam);
    game.divisions[division].push(playerTeam.id);
    game.playerTeam = playerTeam;
}

function getPlayerScore(player, coach) {
    let score = 0;
    for (const category in player.attributes) {
        for (const attr in player.attributes[category]) {
            const preference = coach.attributePreferences[category]?.[attr] || 1.0;
            score += player.attributes[category][attr] * preference;
        }
    }
    if (coach.type === 'Youth Scout') score += (18 - player.age) * 10;
    return score;
}

export function setupDraft() {
    game.draftOrder = [];
    game.currentPick = 0;
    const teams = [...game.teams].sort(() => Math.random() - 0.5);

    for (let i = 0; i < 8; i++) {
        if (i % 2 === 0) game.draftOrder.push(...teams);
        else game.draftOrder.push(...[...teams].reverse());
    }
}

export function simulateAIPick(team) {
    const undraftedPlayers = game.players.filter(p => !p.teamId);
    if (undraftedPlayers.length === 0) return null;

    let bestPlayer = null;
    let bestScore = -1;

    for (const player of undraftedPlayers) {
        const score = getPlayerScore(player, team.coach);
        if (score > bestScore) {
            bestScore = score;
            bestPlayer = player;
        }
    }

    if (bestPlayer) addPlayerToTeam(bestPlayer, team);
    return bestPlayer;
}

export function addPlayerToTeam(player, team) {
    if (team.roster.length < 8) {
        player.teamId = team.id;
        team.roster.push(player);
        if (team.id === game.playerTeam.id) {
            for (const pos in team.depthChart) {
                if (team.depthChart[pos] === null) {
                    team.depthChart[pos] = player.id;
                    break;
                }
            }
        }
        return true;
    }
    return false;
}

export function generateSchedule() {
    game.schedule = [];
    for(const divisionName in game.divisions) {
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
    const roster = team.roster.filter(p => p.status.type === 'healthy'); // Only use healthy players
    if (roster.length < 8) return { offense: 0, defense: 0, passOff: 0, rushOff: 0, passDef: 0, rushDef: 0 };
    
    const byThrowing = [...roster].sort((a,b) => b.attributes.technical.throwingAccuracy - a.attributes.technical.throwingAccuracy);
    const byCatching = [...roster].sort((a,b) => b.attributes.technical.catchingHands - a.attributes.technical.catchingHands);
    const byRushing = [...roster].sort((a,b) => (b.attributes.physical.speed + b.attributes.physical.strength) - (a.attributes.physical.speed + a.attributes.physical.strength));
    const byBlocking = [...roster].sort((a,b) => b.attributes.technical.blocking - a.attributes.technical.blocking);
    const byTackling = [...roster].sort((a,b) => b.attributes.technical.tackling - a.attributes.technical.tackling);
    const byCoverage = [...roster].sort((a,b) => (b.attributes.physical.speed + b.attributes.physical.agility) - (a.attributes.physical.speed + a.attributes.physical.agility));

    const passOff = (byThrowing[0].attributes.technical.throwingAccuracy * 1.5) + byCatching.slice(0, 2).reduce((s, p) => s + p.attributes.technical.catchingHands, 0);
    const rushOff = byRushing[0].attributes.physical.speed + byRushing[0].attributes.physical.strength + byBlocking.slice(0, 4).reduce((s, p) => s + p.attributes.technical.blocking, 0) / 2;
    const passDef = byCoverage.slice(0, 4).reduce((s,p) => s + p.attributes.physical.speed + p.attributes.physical.agility, 0) / 2;
    const rushDef = byTackling.slice(0, 4).reduce((s,p) => s + p.attributes.technical.tackling + p.attributes.physical.strength, 0) / 2;

    return { passOff, rushOff, passDef, rushDef, offense: passOff + rushOff, defense: passDef + rushDef };
}

function simulateGame(homeTeam, awayTeam) {
    resetGameStats();
    const homeRatings = getTeamRatings(homeTeam);
    const awayRatings = getTeamRatings(awayTeam);
    
    let homeScorePotential = ((homeRatings.passOff / awayRatings.passDef) + (homeRatings.rushOff / awayRatings.rushDef)) * 5 * 1.05;
    let awayScorePotential = ((awayRatings.passOff / homeRatings.passDef) + (awayRatings.rushOff / homeRatings.rushDef)) * 5;
    
    let homeScore = Math.max(0, Math.round(Math.random() * homeScorePotential));
    let awayScore = Math.max(0, Math.round(Math.random() * awayScorePotential));

    [homeTeam, awayTeam].forEach((team, isHome) => {
        const score = isHome ? homeScore : awayScore;
        const players = team.roster.filter(p => p.status.type === 'healthy');
        if (score === 0 || players.length === 0) return;
        
        const qb = players.sort((a,b) => b.attributes.technical.throwingAccuracy - a.attributes.technical.throwingAccuracy)[0];
        if(qb) qb.gameStats.passYards = getRandomInt(score * 4, score * 8);
        for(let i = 0; i < Math.floor(score / 7); i++) {
            const scorer = getRandom(players);
            scorer.gameStats.touchdowns++;
            if (Math.random() > 0.5) scorer.gameStats.recYards += getRandomInt(10, 30);
            else scorer.gameStats.rushYards += getRandomInt(5, 25);
        }
        players.forEach(p => p.gameStats.tackles = getRandomInt(0, 5));
    });
    
    [...homeTeam.roster, ...awayTeam.roster].forEach(p => {
        for(const stat in p.gameStats) {
            p.seasonStats[stat] += p.gameStats[stat];
            p.careerStats[stat] += p.gameStats[stat];
        }
    });

    if (homeScore > awayScore) { homeTeam.wins++; awayTeam.losses++; } 
    else { awayTeam.wins++; homeTeam.losses++; }

    return { homeTeam, awayTeam, homeScore, awayScore };
}

/**
 * Updates all player statuses, decrementing event durations.
 */
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

/**
 * Generates random weekly events like injuries or other unavailability.
 */
function generateWeeklyEvents() {
    for (const player of game.players) {
        if (player.status.type === 'healthy') {
            for (const event of weeklyEvents) {
                if (Math.random() < event.chance) {
                    player.status.type = event.type;
                    player.status.description = event.description;
                    player.status.duration = getRandomInt(event.minDuration, event.maxDuration);
                    break; // Player can only have one new event per week
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
            fa.friendship = getRandom(['Close Friend', 'Friend', 'Acquaintance']);
            game.freeAgents.push(fa);
        }
    }
}

export function aiManageRoster(team) {
    if (game.freeAgents.length === 0 || team.roster.length === 0) return;
    const healthyRoster = team.roster.filter(p => p.status.type === 'healthy');
    if(healthyRoster.length >= 8) return; // Don't sign FAs if roster is full and healthy

    let worstPlayer = team.roster[0], worstScore = getPlayerScore(worstPlayer, team.coach);
    team.roster.forEach(p => { const s = getPlayerScore(p, team.coach); if (s < worstScore) { worstScore = s; worstPlayer = p; } });
    
    let bestFA = game.freeAgents[0], bestFAScore = getPlayerScore(bestFA, team.coach);
    game.freeAgents.forEach(fa => { const s = getPlayerScore(fa, team.coach); if (s > bestFAScore) { bestFAScore = s; bestFA = fa; } });
    
    if (bestFAScore > worstScore * 1.2 && team.roster.length >= 8) {
        worstPlayer.teamId = null;
        team.roster.splice(team.roster.findIndex(p => p.id === worstPlayer.id), 1);
        addPlayerToTeam(bestFA, team);
        game.freeAgents.splice(game.freeAgents.findIndex(fa => fa.id === bestFA.id), 1);
    }
}

function developPlayer(player) {
    let potential;
    if (player.age < 12) potential = getRandomInt(4, 8); 
    else if (player.age < 16) potential = getRandomInt(1, 5);
    else potential = getRandomInt(0, 2);

    const attributesToImprove = ['speed', 'strength', 'agility', 'throwingAccuracy', 'catchingHands', 'tackling', 'blocking', 'playbookIQ'];
    for (let i = 0; i < potential; i++) {
        const attrToBoost = getRandom(attributesToImprove);
        for (const category in player.attributes) {
            if (player.attributes[category][attrToBoost] && player.attributes[category][attrToBoost] < 99) {
                player.attributes[category][attrToBoost]++;
                break;
            }
        }
    }

    let heightGain = 0;
    let weightGain = 0;

    if (player.age <= 12) {
        heightGain = getRandomInt(1, 3);
        weightGain = getRandomInt(5, 15);
    } else if (player.age <= 15) {
        heightGain = getRandomInt(0, 2);
        weightGain = getRandomInt(3, 10);
    } else {
        heightGain = getRandomInt(0, 1);
        weightGain = getRandomInt(1, 5);
    }

    player.attributes.physical.height += heightGain;
    player.attributes.physical.weight += weightGain;
}


export function advanceToOffseason() {
    game.year++;
    let retiredCount = 0;
    const remainingPlayers = [];
    game.players.forEach(p => {
        p.age++;
        p.careerStats.seasonsPlayed++;
        
        developPlayer(p);

        if (p.age < 18) {
            p.seasonStats = { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0 };
            p.status = { type: 'healthy', description: '', duration: 0 }; // Reset status for new season
            remainingPlayers.push(p);
        } else {
            if (p.careerStats.touchdowns > 20 || p.careerStats.passYards > 5000 || p.careerStats.tackles > 200) {
                game.hallOfFame.push(p);
            }
            retiredCount++;
        }
    });

    game.players = remainingPlayers;
    game.teams.forEach(team => { 
        team.roster = []; 
        team.wins = 0; 
        team.losses = 0;
        if (team.depthChart) {
             Object.keys(team.depthChart).forEach(pos => team.depthChart[pos] = null);
        }
    });
    game.players.forEach(p => p.teamId = null);
    for (let i = 0; i < retiredCount; i++) game.players.push(generatePlayer(8, 10));
}

export function updateDepthChart(playerId, newPositionSlot) {
    const team = game.playerTeam;
    const oldSlot = Object.keys(team.depthChart).find(key => team.depthChart[key] === playerId);
    const displacedPlayerId = team.depthChart[newPositionSlot];

    team.depthChart[newPositionSlot] = playerId;
    if(oldSlot) {
        team.depthChart[oldSlot] = displacedPlayerId;
    }
}

export function getGameState() {
    return game;
}

