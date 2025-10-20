// js/game.js - Handles the core game state and logic.

import { firstNames, lastNames, nicknames, teamNames, positions, coachPersonalities, divisionNames } from './data.js';
import { getRandom, getRandomInt } from './utils.js';

let game = null;

// --- Player & Team Generation ---

/**
 * Generates a single player with random attributes categorized into physical, mental, and technical.
 * @param {number} minAge - The minimum age for the player.
 * @param {number} maxAge - The maximum age for the player.
 * @returns {object} A player object.
 */
function generatePlayer(minAge = 8, maxAge = 17) {
    const firstName = getRandom(firstNames);
    const lastName = Math.random() < 0.4 ? getRandom(nicknames) : getRandom(lastNames);
    const age = getRandomInt(minAge, maxAge);
    const position = getRandom(positions);

    // --- Generate Height & Weight based on Age ---
    const ageProgress = (age - 8) / (17 - 8); // Progress from 0.0 to 1.0
    let baseHeight = 53 + (ageProgress * 16); // 4'5" at 8 -> 5'9" at 17
    let baseWeight = 60 + (ageProgress * 90); // 60lbs at 8 -> 150lbs at 17

    baseHeight += getRandomInt(-2, 2); // Add natural variance
    baseWeight += getRandomInt(-10, 10);

    // Positional modifiers for height and weight
    switch (position) {
        case 'QB':
        case 'WR':
            baseHeight += getRandomInt(1, 3);
            break;
        case 'TE':
            baseHeight += getRandomInt(1, 3);
            baseWeight += getRandomInt(10, 25);
            break;
        case 'DL':
        case 'LB':
            baseHeight -= getRandomInt(0, 2);
            baseWeight += getRandomInt(20, 40);
            break;
        case 'RB':
            baseHeight -= getRandomInt(1, 3);
            baseWeight += getRandomInt(5, 15);
            break;
    }


    // Base attributes for all players
    let attributes = {
        physical: {
            speed: getRandomInt(40, 70),
            strength: getRandomInt(40, 70),
            agility: getRandomInt(40, 70),
            stamina: getRandomInt(50, 80),
            height: Math.round(baseHeight), // in inches
            weight: Math.round(baseWeight)  // in lbs
        },
        mental: {
            playbookIQ: getRandomInt(30, 70),
            clutch: getRandomInt(20, 90),
            consistency: getRandomInt(40, 80)
        },
        technical: {
            throwingAccuracy: getRandomInt(30, 60),
            catchingHands: getRandomInt(30, 60),
            tackling: getRandomInt(30, 60),
            blocking: getRandomInt(30, 60),
        }
    };

    // Positional adjustments
    switch (position) {
        case 'QB':
            attributes.technical.throwingAccuracy = getRandomInt(60, 95);
            attributes.mental.playbookIQ = getRandomInt(60, 95);
            attributes.physical.speed = getRandomInt(40, 65);
            break;
        case 'RB':
            attributes.physical.speed = getRandomInt(60, 90);
            attributes.physical.strength = getRandomInt(55, 85);
            attributes.physical.agility = getRandomInt(60, 90);
            break;
        case 'WR':
            attributes.physical.speed = getRandomInt(65, 95);
            attributes.technical.catchingHands = getRandomInt(60, 95);
            attributes.physical.agility = getRandomInt(70, 95);
            break;
        case 'TE':
            attributes.technical.catchingHands = getRandomInt(50, 85);
            attributes.physical.strength = getRandomInt(60, 90);
            attributes.technical.blocking = getRandomInt(50, 80);
            break;
        case 'DL':
        case 'LB':
            attributes.physical.strength = getRandomInt(70, 95);
            attributes.technical.tackling = getRandomInt(65, 95);
            attributes.mental.playbookIQ = getRandomInt(50, 80);
            break;
        case 'DB':
            attributes.physical.speed = getRandomInt(70, 95);
            attributes.technical.catchingHands = getRandomInt(50, 80); // For interceptions
            attributes.technical.tackling = getRandomInt(50, 80);
            break;
    }

    return {
        id: crypto.randomUUID(),
        name: `${firstName} ${lastName}`,
        age,
        position,
        attributes, // <-- Replaced 'stats' with new structure
        teamId: null,
        gameStats: {
            receptions: 0,
            recYards: 0,
            passYards: 0,
            rushYards: 0,
            touchdowns: 0,
            tackles: 0,
        },
        seasonStats: {
             receptions: 0,
            recYards: 0,
            passYards: 0,
            rushYards: 0,
            touchdowns: 0,
            tackles: 0,
        }
    };
}


/**
 * Helper to pause execution briefly, allowing the UI to update.
 */
function yieldToMain() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

// --- League Initialization ---

/**
 * Initializes the entire league, players, and teams.
 * @param {function} onProgress - Callback to update the loading bar.
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
    };

    // Generate Divisions
    availableDivisions.forEach(divName => {
        game.divisions[divName] = [];
    });
    console.log(`Created divisions: ${Object.keys(game.divisions).join(', ')}`);


    // Generate Players
    const totalPlayers = 300;
    for (let i = 0; i < totalPlayers; i++) {
        game.players.push(generatePlayer());
        if (i % 10 === 0) { // Update progress every 10 players
            onProgress(i / totalPlayers);
            await yieldToMain(); // Allow UI to render the update
        }
    }
    console.log(`Generated ${game.players.length} players.`);

    // Generate Teams
    for (let i = 0; i < 20; i++) {
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
            losses: 0,
        };
        game.teams.push(team);
        game.divisions[division].push(team.id);
    }
    console.log(`Generated ${game.teams.length} teams.`);

    // Assign Player Team
    game.playerTeam = getRandom(game.teams);
    console.log(`Player team set to: ${game.playerTeam.name}`);

    // Simulate AI Draft
    simulateAIDraft();
}

// --- Draft Logic ---

/**
 * Calculates a player's score based on a coach's preferences using the new attribute structure.
 * @param {object} player - The player to evaluate.
 * @param {object} coach - The coach with attribute preferences.
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
    
    // Add a bonus for age if the coach is a 'Youth Scout'
    if (coach.type === 'Youth Scout') {
        const ageBonus = (18 - player.age) * 10; // Higher bonus for younger players
        score += ageBonus;
    }

    return score;
}

/**
 * Simulates the draft for all AI teams.
 */
function simulateAIDraft() {
    console.log("Simulating AI draft...");
    const undraftedPlayers = game.players.filter(p => !p.teamId);
    const aiTeams = game.teams.filter(t => t.id !== game.playerTeam.id);

    for (let i = 0; i < 10; i++) { // 10 rounds of drafting
        for (const team of aiTeams) {
            if (undraftedPlayers.length === 0) break;

            // Find the best player for the team based on coach personality
            let bestPlayer = null;
            let bestScore = -1;

            for (const player of undraftedPlayers) {
                const score = getPlayerScore(player, team.coach);
                if (score > bestScore) {
                    bestScore = score;
                    bestPlayer = player;
                }
            }

            // Draft the player
            if (bestPlayer) {
                addPlayerToTeam(bestPlayer, team);
                const index = undraftedPlayers.findIndex(p => p.id === bestPlayer.id);
                undraftedPlayers.splice(index, 1);
            }
        }
    }
    console.log("AI draft complete.");
}

/**
 * Adds a player to a team's roster.
 * @param {object} player - The player to add.
 * @param {object} team - The team to add the player to.
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

// --- Season Simulation ---

/**
 * Generates a schedule for the season.
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
    // Simple shuffle
    game.schedule.sort(() => Math.random() - 0.5);
    game.currentWeek = 0;
    console.log(`Schedule generated with ${game.schedule.length} total matchups.`);
}

/**
 * Resets individual player game stats.
 */
function resetGameStats() {
    game.players.forEach(player => {
        player.gameStats = {
            receptions: 0,
            recYards: 0,
            passYards: 0,
            rushYards: 0,
            touchdowns: 0,
            tackles: 0,
        };
    });
}

/**
 * Calculates team ratings based on the new attribute system, including height and weight.
 * @param {object} team - The team object.
 * @returns {object} An object with offense and defense ratings.
 */
function getTeamRatings(team) {
    let passOff = 0, rushOff = 0, passDef = 0, rushDef = 0, playerCount = team.roster.length;
    if (playerCount === 0) return { offense: 0, defense: 0, passOff: 0, rushOff: 0, passDef: 0, rushDef: 0 };

    for(const player of team.roster) {
        const pAttrs = player.attributes;
        // Offensive contributions
        passOff += pAttrs.technical.throwingAccuracy * 0.5 + pAttrs.technical.catchingHands * 0.4 + pAttrs.physical.height * 0.1;
        rushOff += pAttrs.physical.speed * 0.4 + pAttrs.physical.strength * 0.3 + pAttrs.technical.blocking * 0.2 + pAttrs.physical.weight * 0.1;
        // Defensive contributions
        passDef += pAttrs.physical.speed * 0.3 + pAttrs.physical.agility * 0.3 + pAttrs.technical.catchingHands * 0.2 + pAttrs.physical.height * 0.2;
        rushDef += pAttrs.physical.strength * 0.3 + pAttrs.technical.tackling * 0.5 + pAttrs.physical.weight * 0.2;
    }

    const offenseRating = (passOff + rushOff) / playerCount;
    const defenseRating = (passDef + rushDef) / playerCount;
    return { 
        offense: offenseRating, 
        defense: defenseRating,
        passOff: passOff / playerCount,
        rushOff: rushOff / playerCount,
        passDef: passDef / playerCount,
        rushDef: rushDef / playerCount,
    };
}


/**
 * Simulates a single game between two teams using the new attribute system.
 * @param {object} homeTeam - The home team.
 * @param {object} awayTeam - The away team.
 * @returns {object} The result of the game.
 */
function simulateGame(homeTeam, awayTeam) {
    resetGameStats();
    let homeScore = 0;
    let awayScore = 0;

    const homeRatings = getTeamRatings(homeTeam);
    const awayRatings = getTeamRatings(awayTeam);
    
    const homeAdvantage = 1.05; // 5% bonus for home team

    // More granular score potential based on pass/rush matchups
    let homeScorePotential = ((homeRatings.passOff / awayRatings.passDef) + (homeRatings.rushOff / awayRatings.rushDef)) * 7 * homeAdvantage;
    let awayScorePotential = ((awayRatings.passOff / homeRatings.passDef) + (awayRatings.rushOff / homeRatings.rushDef)) * 7;

    homeScore = Math.max(0, Math.round(Math.random() * homeScorePotential));
    awayScore = Math.max(0, Math.round(Math.random() * awayScorePotential));
    
    // Simulate player stats for the game (more detailed)
    [homeTeam, awayTeam].forEach((team, isHome) => {
        const score = isHome ? homeScore : awayScore;
        if (score === 0 || team.roster.length === 0) return;

        const qb = team.roster.find(p => p.position === 'QB');
        const rbs = team.roster.filter(p => p.position === 'RB');
        const wrs = team.roster.filter(p => p.position === 'WR' || p.position === 'TE');
        const defense = team.roster.filter(p => ['DL', 'LB', 'DB'].includes(p.position));

        if(qb) {
            const passYardBonus = qb.attributes.technical.throwingAccuracy + qb.attributes.mental.playbookIQ + (qb.attributes.physical.height - 66);
            qb.gameStats.passYards = getRandomInt(score * 3, score * 6) + Math.round(passYardBonus / 4);
        }
        if(rbs.length > 0) {
            const rusher = getRandom(rbs);
            const rushYardBonus = rusher.attributes.physical.speed + rusher.attributes.physical.strength + (rusher.attributes.physical.weight - 120) / 2;
            rusher.gameStats.rushYards = getRandomInt(score * 1, score * 3) + Math.round(rushYardBonus / 5);
        }
        if(wrs.length > 0) {
             for(let i = 0; i < Math.floor(score / 7); i++) {
                const receiver = getRandom(wrs);
                receiver.gameStats.receptions += 1;
                receiver.gameStats.recYards += getRandomInt(5, 20) + Math.round(receiver.attributes.technical.catchingHands / 10) + (receiver.attributes.physical.height - 66);
             }
        }
        // Simplified touchdowns
        if (team.roster.length > 0) {
             for(let i = 0; i < Math.floor(score / 7); i++) {
                 getRandom(team.roster).gameStats.touchdowns += 1;
             }
        }
        if(defense.length > 0) {
            defense.forEach(defPlayer => {
                defPlayer.gameStats.tackles = getRandomInt(1, 5) + Math.round(defPlayer.attributes.technical.tackling / 15) + Math.round((defPlayer.attributes.physical.weight - 140) / 10);
            });
        }
    });

    // Update season stats
    [...homeTeam.roster, ...awayTeam.roster].forEach(player => {
        for(const stat in player.gameStats) {
            player.seasonStats[stat] += player.gameStats[stat];
        }
    });


    // Update team records
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
 * @returns {Array<object>} An array of game results.
 */
export function simulateWeek() {
    if (game.currentWeek >= 9) return null; // Season over

    const weeklyGames = game.schedule.slice(game.currentWeek * 10, (game.currentWeek + 1) * 10);
    const results = weeklyGames.map(match => simulateGame(match.home, match.away));

    game.currentWeek++;
    console.log(`Simulated Week ${game.currentWeek}. Results:`, results);
    return results;
}

// --- Free Agency & Roster Management ---

/**
 * Generates a pool of free agents for the week.
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
 * Logic for an AI team to manage its roster during the season.
 * @param {object} team - The AI team.
 */
export function aiManageRoster(team) {
    if (game.freeAgents.length === 0 || team.roster.length === 0) return;

    // 1. Find the worst player on the current roster
    let worstPlayer = team.roster[0];
    let worstScore = getPlayerScore(worstPlayer, team.coach);
    for (const player of team.roster) {
        const score = getPlayerScore(player, team.coach);
        if (score < worstScore) {
            worstScore = score;
            worstPlayer = player;
        }
    }

    // 2. Find the best available free agent
    let bestFA = game.freeAgents[0];
    let bestFAScore = getPlayerScore(bestFA, team.coach);
    for (const fa of game.freeAgents) {
        const score = getPlayerScore(fa, team.coach);
        if (score > bestFAScore) {
            bestFAScore = score;
            bestFA = fa;
        }
    }

    // 3. If the best FA is a significant upgrade, make the swap
    const upgradeThreshold = 1.2; // FA must be 20% better
    if (bestFAScore > worstScore * upgradeThreshold && team.roster.length >= 10) {
        console.log(`${team.name} is cutting ${worstPlayer.name} and signing ${bestFA.name}.`);
        
        // Cut player
        worstPlayer.teamId = null;
        const playerIndex = team.roster.findIndex(p => p.id === worstPlayer.id);
        team.roster.splice(playerIndex, 1);
        
        // Sign free agent
        addPlayerToTeam(bestFA, team);
        const faIndex = game.freeAgents.findIndex(fa => fa.id === bestFA.id);
        game.freeAgents.splice(faIndex, 1);
    }
}


// --- Off-Season Logic ---

/**
 * Handles aging, retirement, and generating new rookies.
 */
export function advanceToOffseason() {
    console.log(`Advancing to offseason for year ${game.year + 1}...`);
    game.year++;
    let retiredCount = 0;

    // Age up and retire players
    const remainingPlayers = [];
    game.players.forEach(p => {
        p.age++;
        if (p.age < 18) {
            // Reset season stats
            p.seasonStats = { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0 };
            remainingPlayers.push(p);
        } else {
            retiredCount++;
        }
    });
    game.players = remainingPlayers;
    console.log(`${retiredCount} players retired.`);
    
    // Clear rosters but keep players in the league
    game.teams.forEach(team => {
        team.roster = [];
        team.wins = 0;
        team.losses = 0;
    });
    
    game.players.forEach(p => p.teamId = null);

    // Generate rookies to replace retired players
    for (let i = 0; i < retiredCount; i++) {
        game.players.push(generatePlayer(8, 10)); // Rookies are young
    }
    console.log(`Generated ${retiredCount} new rookies.`);

    // Re-run AI draft for the new season
    simulateAIDraft();
}


// --- Game State Access ---

/**
 * Returns the current game state.
 * @returns {object} The game state object.
 */
export function getGameState() {
    return game;
}

