import { getRandom, getRandomInt } from './utils.js';
import { firstNames, lastNames, nicknames, teamNames, positions, divisionNames, coachPersonalities } from './data.js';

let game = null;

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
    const position = getRandom(positions);

    const ageProgress = (age - 8) / (17 - 8);
    let baseHeight = 53 + (ageProgress * 16);
    let baseWeight = 60 + (ageProgress * 90);

    baseHeight += getRandomInt(-2, 2);
    baseWeight += getRandomInt(-10, 10);

    // Positional adjustments for height and weight
    switch (position) {
        case 'QB': baseHeight += getRandomInt(1, 3); break;
        case 'LINE': baseHeight -= getRandomInt(0, 2); baseWeight += getRandomInt(20, 40); break;
        case 'ATH': baseHeight += getRandomInt(-1, 2); baseWeight += getRandomInt(-5, 10); break;
    }

    // Base attributes for "play-both-ways" players
    let attributes = {
        physical: { speed: getRandomInt(40, 70), strength: getRandomInt(40, 70), agility: getRandomInt(40, 70), stamina: getRandomInt(50, 80), height: Math.round(baseHeight), weight: Math.round(baseWeight) },
        mental: { playbookIQ: getRandomInt(30, 70), clutch: getRandomInt(20, 90), consistency: getRandomInt(40, 80) },
        technical: { throwingAccuracy: getRandomInt(20, 50), catchingHands: getRandomInt(30, 60), tackling: getRandomInt(30, 60), blocking: getRandomInt(30, 60) }
    };

    // Positional specialization boosts
    switch (position) {
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

    return {
        id: crypto.randomUUID(), name: `${firstName} ${lastName}`, age, position, attributes, teamId: null,
        gameStats: { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0 },
        seasonStats: { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0 }
    };
}


/**
 * Pauses execution for a brief moment to allow the browser's main thread to update the UI.
 * @returns {Promise} A promise that resolves after a short delay.
 */
export function yieldToMain() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Initializes the entire league structure, including players and AI teams.
 * @param {function} onProgress - A callback function to report loading progress.
 */
export async function initializeLeague(onProgress) {
    console.log("Initializing league...");
    const availableTeamNames = [...teamNames];
    const availableDivisions = [...divisionNames];
    
    game = {
        year: 1, teams: [], players: [], freeAgents: [], playerTeam: null,
        schedule: [], currentWeek: 0, divisions: {}, draftOrder: [], currentPick: 0,
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
    console.log(`Generated ${game.players.length} players.`);

    // Create 19 AI teams
    for (let i = 0; i < 19; i++) {
        const teamNameIndex = getRandomInt(0, availableTeamNames.length - 1);
        const teamName = `The ${availableTeamNames.splice(teamNameIndex, 1)[0]}`;
        const division = availableDivisions[i % availableDivisions.length];
        const team = {
            id: crypto.randomUUID(), name: teamName, roster: [],
            coach: getRandom(coachPersonalities), division: division, wins: 0, losses: 0
        };
        game.teams.push(team);
        game.divisions[division].push(team.id);
    }
    console.log(`Generated ${game.teams.length} AI teams.`);
}

/**
 * Creates the player's team and adds it to the league.
 * @param {string} teamName - The chosen name for the player's team.
 */
export function createPlayerTeam(teamName) {
    const finalTeamName = teamName.toLowerCase().startsWith("the ") ? teamName : `The ${teamName}`;
    const division = game.teams.length % 2 === 0 ? divisionNames[0] : divisionNames[1];
    const playerTeam = {
        id: crypto.randomUUID(), name: finalTeamName, roster: [],
        coach: getRandom(coachPersonalities), division: division, wins: 0, losses: 0
    };
    game.teams.push(playerTeam);
    game.divisions[division].push(playerTeam.id);
    game.playerTeam = playerTeam;
    console.log(`Player team "${finalTeamName}" created.`);
}


/**
 * Calculates a score for a player based on a coach's preferences.
 * @param {object} player - The player to score.
 * @param {object} coach - The coach object with attribute preferences.
 * @returns {number} The calculated score.
 */
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

/**
 * Sets up the draft order for all 8 rounds using a snake format.
 */
export function setupDraft() {
    game.draftOrder = [];
    game.currentPick = 0;
    const teams = [...game.teams].sort(() => Math.random() - 0.5);

    for (let i = 0; i < 8; i++) { // 8 rounds for 8v8
        if (i % 2 === 0) { // Even rounds
            game.draftOrder.push(...teams);
        } else { // Odd rounds (snake)
            game.draftOrder.push(...[...teams].reverse());
        }
    }
    console.log(`Draft order set for ${game.draftOrder.length} picks.`);
}

/**
 * Simulates a single draft pick for an AI team.
 * @param {object} team - The AI team that is picking.
 * @returns {object} The player that was drafted.
 */
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


/**
 * Adds a player to a team's roster if there is space.
 * @param {object} player - The player to add.
 * @param {object} team - The team to add the player to.
 * @returns {boolean} True if the player was added, false otherwise.
 */
export function addPlayerToTeam(player, team) {
    if (team.roster.length < 8) { // 8 players per team
        player.teamId = team.id;
        team.roster.push(player);
        return true;
    }
    return false;
}

/**
 * Generates a round-robin schedule for each division.
 */
export function generateSchedule() {
    console.log("Generating schedule...");
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
    console.log(`Schedule generated with ${game.schedule.length} total matchups.`);
}

function resetGameStats() {
    game.players.forEach(player => {
        player.gameStats = { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0 };
    });
}

/**
 * Calculates team ratings based on the best players for each role (8v8).
 * @param {object} team - The team to evaluate.
 * @returns {object} An object containing team ratings.
 */
function getTeamRatings(team) {
    const roster = team.roster;
    if (roster.length === 0) return { offense: 0, defense: 0, passOff: 0, rushOff: 0, passDef: 0, rushDef: 0 };
    
    // Sort players by skill to find the best for each role
    const byThrowing = [...roster].sort((a,b) => b.attributes.technical.throwingAccuracy - a.attributes.technical.throwingAccuracy);
    const byCatching = [...roster].sort((a,b) => b.attributes.technical.catchingHands - a.attributes.technical.catchingHands);
    const byRushing = [...roster].sort((a,b) => (b.attributes.physical.speed + b.attributes.physical.strength) - (a.attributes.physical.speed + a.attributes.physical.strength));
    const byBlocking = [...roster].sort((a,b) => b.attributes.technical.blocking - a.attributes.technical.blocking);
    const byTackling = [...roster].sort((a,b) => b.attributes.technical.tackling - a.attributes.technical.tackling);
    const byCoverage = [...roster].sort((a,b) => (b.attributes.physical.speed + b.attributes.physical.agility) - (a.attributes.physical.speed + a.attributes.physical.agility));

    // Offensive Ratings (1 QB, 2 Receivers, 1 Rusher, 4 Blockers)
    const passOff = (byThrowing[0].attributes.technical.throwingAccuracy * 1.5) + byCatching.slice(0, 2).reduce((s, p) => s + p.attributes.technical.catchingHands, 0);
    const rushOff = byRushing[0].attributes.physical.speed + byRushing[0].attributes.physical.strength + byBlocking.slice(0, 4).reduce((s, p) => s + p.attributes.technical.blocking, 0) / 2;

    // Defensive Ratings (4 Pass Rush/Coverage, 4 Run Stuffers)
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

    // Simplified stat generation for 8v8
    [homeTeam, awayTeam].forEach((team, isHome) => {
        const score = isHome ? homeScore : awayScore;
        if (score === 0 || team.roster.length === 0) return;

        const players = team.roster;
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
        for(const stat in p.gameStats) p.seasonStats[stat] += p.gameStats[stat];
    });

    if (homeScore > awayScore) { homeTeam.wins++; awayTeam.losses++; } 
    else { awayTeam.wins++; homeTeam.losses++; }

    return { homeTeam, awayTeam, homeScore, awayScore };
}

export function simulateWeek() {
    if (game.currentWeek >= 9) return null;
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

    let worstPlayer = team.roster[0];
    let worstScore = getPlayerScore(worstPlayer, team.coach);
    team.roster.forEach(p => { const s = getPlayerScore(p, team.coach); if (s < worstScore) { worstScore = s; worstPlayer = p; } });

    let bestFA = game.freeAgents[0];
    let bestFAScore = getPlayerScore(bestFA, team.coach);
    game.freeAgents.forEach(fa => { const s = getPlayerScore(fa, team.coach); if (s > bestFAScore) { bestFAScore = s; bestFA = fa; } });

    if (bestFAScore > worstScore * 1.2 && team.roster.length >= 8) {
        worstPlayer.teamId = null;
        team.roster.splice(team.roster.findIndex(p => p.id === worstPlayer.id), 1);
        addPlayerToTeam(bestFA, team);
        game.freeAgents.splice(game.freeAgents.findIndex(fa => fa.id === bestFA.id), 1);
    }
}

export function advanceToOffseason() {
    console.log(`Advancing to offseason for year ${game.year + 1}...`);
    game.year++;
    let retiredCount = 0;
    const remainingPlayers = [];
    game.players.forEach(p => {
        p.age++;
        if (p.age < 18) {
            p.seasonStats = { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0 };
            remainingPlayers.push(p);
        } else {
            retiredCount++;
        }
    });

    game.players = remainingPlayers;
    game.teams.forEach(team => { team.roster = []; team.wins = 0; team.losses = 0; });
    game.players.forEach(p => p.teamId = null);

    for (let i = 0; i < retiredCount; i++) game.players.push(generatePlayer(8, 10));
    console.log(`Generated ${retiredCount} new rookies.`);
}

export function getGameState() {
    return game;
}

