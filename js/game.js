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

    // Physical frame generation
    const ageProgress = (age - 8) / (17 - 8); // Progress from youngest to oldest (0.0 to 1.0)
    let baseHeight = 53 + (ageProgress * 16); // Height range: ~53" to ~69"
    let baseWeight = 60 + (ageProgress * 90); // Weight range: ~60lbs to ~150lbs

    baseHeight += getRandomInt(-2, 2);
    baseWeight += getRandomInt(-10, 10);

    // Positional adjustments for height and weight
    switch (position) {
        case 'QB': case 'WR': baseHeight += getRandomInt(1, 3); break;
        case 'TE': baseHeight += getRandomInt(1, 3); baseWeight += getRandomInt(10, 25); break;
        case 'DL': case 'LB': baseHeight -= getRandomInt(0, 2); baseWeight += getRandomInt(20, 40); break;
        case 'RB': baseHeight -= getRandomInt(1, 3); baseWeight += getRandomInt(5, 15); break;
    }

    // Base attributes
    let attributes = {
        physical: { speed: getRandomInt(40, 70), strength: getRandomInt(40, 70), agility: getRandomInt(40, 70), stamina: getRandomInt(50, 80), height: Math.round(baseHeight), weight: Math.round(baseWeight) },
        mental: { playbookIQ: getRandomInt(30, 70), clutch: getRandomInt(20, 90), consistency: getRandomInt(40, 80) },
        technical: { throwingAccuracy: getRandomInt(30, 60), catchingHands: getRandomInt(30, 60), tackling: getRandomInt(30, 60), blocking: getRandomInt(30, 60) }
    };

    // Positional attribute adjustments
    switch (position) {
        case 'QB': attributes.technical.throwingAccuracy = getRandomInt(60, 95); attributes.mental.playbookIQ = getRandomInt(60, 95); attributes.physical.speed = getRandomInt(40, 65); break;
        case 'RB': attributes.physical.speed = getRandomInt(60, 90); attributes.physical.strength = getRandomInt(55, 85); attributes.physical.agility = getRandomInt(60, 90); break;
        case 'WR': attributes.physical.speed = getRandomInt(65, 95); attributes.technical.catchingHands = getRandomInt(60, 95); attributes.physical.agility = getRandomInt(70, 95); break;
        case 'TE': attributes.technical.catchingHands = getRandomInt(50, 85); attributes.physical.strength = getRandomInt(60, 90); attributes.technical.blocking = getRandomInt(50, 80); break;
        case 'DL': case 'LB': attributes.physical.strength = getRandomInt(70, 95); attributes.technical.tackling = getRandomInt(65, 95); attributes.mental.playbookIQ = getRandomInt(50, 80); break;
        case 'DB': attributes.physical.speed = getRandomInt(70, 95); attributes.technical.catchingHands = getRandomInt(50, 80); attributes.technical.tackling = getRandomInt(50, 80); break;
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
        year: 1,
        teams: [],
        players: [],
        freeAgents: [],
        playerTeam: null,
        schedule: [],
        currentWeek: 0,
        divisions: {},
        draftOrder: [],
        currentPick: 0,
    };

    availableDivisions.forEach(divName => {
        game.divisions[divName] = [];
    });
    console.log(`Created divisions: ${Object.keys(game.divisions).join(', ')}`);

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
        const teamName = availableTeamNames.splice(teamNameIndex, 1)[0];
        const division = availableDivisions[i % availableDivisions.length];
        const team = {
            id: crypto.randomUUID(),
            name: teamName,
            roster: [],
            coach: getRandom(coachPersonalities),
            division: division,
            wins: 0,
            losses: 0
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
    const division = game.teams.length % 2 === 0 ? divisionNames[0] : divisionNames[1];
    const playerTeam = {
        id: crypto.randomUUID(),
        name: teamName,
        roster: [],
        coach: getRandom(coachPersonalities), // Or a default 'player' coach
        division: division,
        wins: 0,
        losses: 0
    };
    game.teams.push(playerTeam);
    game.divisions[division].push(playerTeam.id);
    game.playerTeam = playerTeam;
    console.log(`Player team "${teamName}" created and added to the league.`);
}


/**
 * Calculates a score for a player based on a coach's preferences.
 * @param {object} player - The player to score.
 * @param {object} coach - The coach object with attribute preferences.
 * @returns {number} The calculated score.
 */
function getPlayerScore(player, coach) {
    let score = 0;
    // Score based on attributes
    for (const category in player.attributes) {
        for (const attr in player.attributes[category]) {
            const preference = coach.attributePreferences[category]?.[attr] || 1.0;
            score += player.attributes[category][attr] * preference;
        }
    }
    // Bonus for youth scout
    if (coach.type === 'Youth Scout') {
        score += (18 - player.age) * 10;
    }
    return score;
}

/**
 * Sets up the draft order for all 10 rounds using a snake format.
 */
export function setupDraft() {
    game.draftOrder = [];
    game.currentPick = 0;
    // Shuffle teams for initial draft order randomness
    const teams = [...game.teams].sort(() => Math.random() - 0.5);

    for (let i = 0; i < 10; i++) { // 10 rounds
        if (i % 2 === 0) { // Even rounds (0, 2, ...) go in normal order
            game.draftOrder.push(...teams);
        } else { // Odd rounds (1, 3, ...) go in reverse order (snake)
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

    if (bestPlayer) {
        addPlayerToTeam(bestPlayer, team);
    }
    return bestPlayer;
}


/**
 * Adds a player to a team's roster if there is space.
 * @param {object} player - The player to add.
 * @param {object} team - The team to add the player to.
 * @returns {boolean} True if the player was added, false otherwise.
 */
export function addPlayerToTeam(player, team) {
    if (team.roster.length < 10) {
        player.teamId = team.id;
        team.roster.push(player);
        console.log(`Added ${player.name} to ${team.name}`);
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
        // Simple round-robin for a 9-week season
        for (let i = 0; i < divisionTeams.length; i++) {
            for (let j = i + 1; j < divisionTeams.length; j++) {
                game.schedule.push({ home: divisionTeams[i], away: divisionTeams[j] });
            }
        }
    }
    // Shuffle the matchups to randomize the weekly schedule
    game.schedule.sort(() => Math.random() - 0.5);
    game.currentWeek = 0;
    console.log(`Schedule generated with ${game.schedule.length} total matchups.`);
}


/**
 * Resets the game-specific stats for all players.
 */
function resetGameStats() {
    game.players.forEach(player => {
        player.gameStats = { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0 };
    });
}

/**
 * Calculates offensive and defensive ratings for a team based on its roster.
 * @param {object} team - The team to evaluate.
 * @returns {object} An object containing various team ratings.
 */
function getTeamRatings(team) {
    let passOff = 0, rushOff = 0, passDef = 0, rushDef = 0;
    const playerCount = team.roster.length;
    if (playerCount === 0) return { offense: 0, defense: 0, passOff: 0, rushOff: 0, passDef: 0, rushDef: 0 };

    for(const player of team.roster) {
        const pAttrs = player.attributes;
        // Offensive ratings
        passOff += pAttrs.technical.throwingAccuracy * 0.5 + pAttrs.technical.catchingHands * 0.4 + pAttrs.physical.height * 0.1;
        rushOff += pAttrs.physical.speed * 0.4 + pAttrs.physical.strength * 0.3 + pAttrs.technical.blocking * 0.2 + pAttrs.physical.weight * 0.1;
        // Defensive ratings
        passDef += pAttrs.physical.speed * 0.3 + pAttrs.physical.agility * 0.3 + pAttrs.technical.catchingHands * 0.2 + pAttrs.physical.height * 0.2;
        rushDef += pAttrs.physical.strength * 0.3 + pAttrs.technical.tackling * 0.5 + pAttrs.physical.weight * 0.2;
    }

    return {
        offense: (passOff + rushOff) / playerCount,
        defense: (passDef + rushDef) / playerCount,
        passOff: passOff / playerCount,
        rushOff: rushOff / playerCount,
        passDef: passDef / playerCount,
        rushDef: rushDef / playerCount
    };
}


/**
 * Simulates a single game between two teams, generating scores and player stats.
 * @param {object} homeTeam - The home team.
 * @param {object} awayTeam - The away team.
 * @returns {object} The results of the game.
 */
function simulateGame(homeTeam, awayTeam) {
    resetGameStats();
    const homeRatings = getTeamRatings(homeTeam);
    const awayRatings = getTeamRatings(awayTeam);

    // Calculate score potential based on offensive vs defensive ratings
    // Home team gets a slight advantage
    let homeScorePotential = ((homeRatings.passOff / awayRatings.passDef) + (homeRatings.rushOff / awayRatings.rushDef)) * 7 * 1.05;
    let awayScorePotential = ((awayRatings.passOff / homeRatings.passDef) + (awayRatings.rushOff / homeRatings.rushDef)) * 7;
    
    let homeScore = Math.max(0, Math.round(Math.random() * homeScorePotential));
    let awayScore = Math.max(0, Math.round(Math.random() * awayScorePotential));

    // Generate individual player stats
    [homeTeam, awayTeam].forEach((team, isHome) => {
        const score = isHome ? homeScore : awayScore;
        if (score === 0 || team.roster.length === 0) return;

        const qb = team.roster.find(p => p.position === 'QB');
        const rbs = team.roster.filter(p => p.position === 'RB');
        const wrs = team.roster.filter(p => ['WR', 'TE'].includes(p.position));
        const defense = team.roster.filter(p => ['DL', 'LB', 'DB'].includes(p.position));

        if(qb) { qb.gameStats.passYards = getRandomInt(score * 3, score * 6) + Math.round((qb.attributes.technical.throwingAccuracy + qb.attributes.mental.playbookIQ + (qb.attributes.physical.height - 66)) / 4); }
        if(rbs.length > 0) { const r = getRandom(rbs); r.gameStats.rushYards = getRandomInt(score * 1, score * 3) + Math.round((r.attributes.physical.speed + r.attributes.physical.strength + (r.attributes.physical.weight - 120) / 2) / 5); }
        if(wrs.length > 0) { for(let i = 0; i < Math.floor(score / 7); i++) { const r = getRandom(wrs); r.gameStats.receptions += 1; r.gameStats.recYards += getRandomInt(5, 20) + Math.round(r.attributes.technical.catchingHands / 10) + (r.attributes.physical.height - 66); } }
        if (team.roster.length > 0) { for(let i = 0; i < Math.floor(score / 7); i++) { getRandom(team.roster).gameStats.touchdowns += 1; } }
        if(defense.length > 0) { defense.forEach(p => { p.gameStats.tackles = getRandomInt(1, 5) + Math.round(p.attributes.technical.tackling / 15) + Math.round((p.attributes.physical.weight - 140) / 10); }); }
    });
    
    // Add game stats to season stats
    [...homeTeam.roster, ...awayTeam.roster].forEach(p => {
        for(const stat in p.gameStats) {
            p.seasonStats[stat] += p.gameStats[stat];
        }
    });

    // Update win/loss records
    if (homeScore > awayScore) {
        homeTeam.wins++;
        awayTeam.losses++;
    } else {
        awayTeam.wins++;
        homeTeam.losses++;
    }

    return { homeTeam, awayTeam, homeScore, awayScore };
}

/**
 * Simulates all games for the current week.
 * @returns {Array<object>|null} An array of game results, or null if the season is over.
 */
export function simulateWeek() {
    if (game.currentWeek >= 9) return null; // 9 weeks in a season
    const weeklyGames = game.schedule.slice(game.currentWeek * 10, (game.currentWeek + 1) * 10);
    const results = weeklyGames.map(match => simulateGame(match.home, match.away));
    game.currentWeek++;
    console.log(`Simulated Week ${game.currentWeek}. Results:`, results);
    return results;
}

/**
 * Generates a small pool of free agents for the week.
 */
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
    console.log(`Generated ${game.freeAgents.length} weekly free agents.`);
}

/**
 * Logic for an AI team to evaluate free agents and potentially manage its roster.
 * @param {object} team - The AI team.
 */
export function aiManageRoster(team) {
    if (game.freeAgents.length === 0 || team.roster.length === 0) return;

    let worstPlayer = team.roster[0];
    let worstScore = getPlayerScore(worstPlayer, team.coach);
    team.roster.forEach(p => {
        const s = getPlayerScore(p, team.coach);
        if (s < worstScore) {
            worstScore = s;
            worstPlayer = p;
        }
    });

    let bestFA = game.freeAgents[0];
    let bestFAScore = getPlayerScore(bestFA, team.coach);
    game.freeAgents.forEach(fa => {
        const s = getPlayerScore(fa, team.coach);
        if (s > bestFAScore) {
            bestFAScore = s;
            bestFA = fa;
        }
    });

    // Only sign if the FA is a significant upgrade (20% better) and roster is full
    if (bestFAScore > worstScore * 1.2 && team.roster.length >= 10) {
        console.log(`${team.name} is cutting ${worstPlayer.name} and signing ${bestFA.name}.`);
        worstPlayer.teamId = null; // Make them undrafted again
        team.roster.splice(team.roster.findIndex(p => p.id === worstPlayer.id), 1);
        addPlayerToTeam(bestFA, team);
        game.freeAgents.splice(game.freeAgents.findIndex(fa => fa.id === bestFA.id), 1);
    }
}


/**
 * Handles all off-season logic: aging, retirement, and generating new rookies.
 */
export function advanceToOffseason() {
    console.log(`Advancing to offseason for year ${game.year + 1}...`);
    game.year++;
    let retiredCount = 0;
    const remainingPlayers = [];

    game.players.forEach(p => {
        p.age++;
        if (p.age < 18) {
            // Reset season stats for the new year
            p.seasonStats = { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0 };
            remainingPlayer.push(p);
        } else {
            retiredCount++;
        }
    });

    game.players = remainingPlayers;
    console.log(`${retiredCount} players retired.`);

    // Reset teams for the new season
    game.teams.forEach(team => {
        team.roster = [];
        team.wins = 0;
        team.losses = 0;
    });

    // All remaining players are now undrafted for the new season's draft
    game.players.forEach(p => p.teamId = null);

    // Generate new rookies to replace the retired players
    for (let i = 0; i < retiredCount; i++) {
        game.players.push(generatePlayer(8, 10));
    }
    console.log(`Generated ${retiredCount} new rookies.`);
}

/**
 * Returns the current state of the game.
 * @returns {object} The game state object.
 */
export function getGameState() {
    return game;
}

