import { getRandom, getRandomInt } from './utils.js';
import { firstNames, lastNames, nicknames, teamNames, positions, divisionNames, coachPersonalities, offenseFormations, defenseFormations, ZONES, routeTree, offensivePlaybook } from './data.js'; // Import ZONES and new playbook data

let game = null;

const offensivePositions = ['QB', 'RB', 'WR', 'OL'];
const defensivePositions = ['DL', 'LB', 'DB'];

const weeklyEvents = [
    { type: 'injured', description: 'Sprained Ankle', minDuration: 1, maxDuration: 2, chance: 0.005 },
    { type: 'injured', description: 'Jammed Finger', minDuration: 1, maxDuration: 1, chance: 0.008 },
    { type: 'busy', description: 'Grounded', minDuration: 1, maxDuration: 2, chance: 0.01 },
    { type: 'busy', description: 'School Project', minDuration: 1, maxDuration: 1, chance: 0.015 },
    { type: 'busy', description: 'Family Vacation', minDuration: 1, maxDuration: 1, chance: 0.003 }
];

const offseasonDepartureEvents = [
    { reason: 'Moved Away', chance: 0.03 },
    { reason: 'Focusing on another sport', chance: 0.02 },
    { reason: 'Decided to quit', chance: 0.01 }
];
const transferEventChance = 0.02;
const joinRequestChance = 0.03;

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
                // Basic normalization for height/weight
                if (attr === 'weight') value = value / 2.5;
                if (attr === 'height') value = (value - 60); // Assuming 60 inches (5 ft) is a baseline
                score += value * relevantWeights[attr];
            }
        }
    }

    // Clamp score between 1 and 99
    return Math.min(99, Math.max(1, Math.round(score)));
}

/**
 * Calculates a player's suitability for a *specific* formation slot based on priorities.
 * Prioritizes slot-specific attributes but includes general overall score.
 */
function calculateSlotSuitability(player, slot, side, team) {
    const formationName = team.formations[side];
    const formationData = side === 'offense' ? offenseFormations[formationName] : defenseFormations[formationName];
    const basePosition = slot.replace(/\d/g, ''); // e.g., 'WR1' -> 'WR'

    // Fallback to general overall if slot-specific priorities aren't defined
    if (!formationData?.slotPriorities?.[slot]) {
        return calculateOverall(player, basePosition);
    }

    const priorities = formationData.slotPriorities[slot];
    let score = 0;
    let totalWeight = 0;

    // Calculate score based on weighted priorities for this specific slot
    for (const attr in priorities) {
        let found = false;
        for (const category in player.attributes) {
            if (player.attributes[category][attr] !== undefined) {
                let value = player.attributes[category][attr];
                // Basic normalization like in calculateOverall
                if (attr === 'weight') value = value / 2.5;
                if (attr === 'height') value = (value - 60);
                score += value * priorities[attr];
                totalWeight += priorities[attr];
                found = true;
                break; // Found attribute, move to next priority
            }
        }
    }

    // Add a fraction of the general overall score to ensure well-rounded players are still valued
    const baseOverall = calculateOverall(player, basePosition);
    // Weighted average: 70% slot suitability, 30% general overall
    const finalScore = (totalWeight > 0 ? (score / totalWeight) : baseOverall) * 0.7 + (baseOverall * 0.3);

    return Math.min(99, Math.max(1, Math.round(finalScore)));
}


/**
 * Generates a new player object with randomized attributes based on age and a 'best position'.
 */
function generatePlayer(minAge = 8, maxAge = 17) {
    const firstName = getRandom(firstNames);
    const lastName = Math.random() < 0.4 ? getRandom(nicknames) : getRandom(lastNames); // 40% chance of nickname
    const age = getRandomInt(minAge, maxAge);
    const favoriteOffensivePosition = getRandom(offensivePositions);
    const favoriteDefensivePosition = getRandom(defensivePositions);

    // Baseline physical attributes based on age progression
    const ageProgress = (age - 8) / (17 - 8); // Normalize age (0 to 1)
    let baseHeight = 53 + (ageProgress * 16) + getRandomInt(-2, 2); // Start ~4'5", grow ~16" total
    let baseWeight = 60 + (ageProgress * 90) + getRandomInt(-10, 10); // Start ~60lbs, gain ~90lbs total

    const bestPosition = getRandom(positions); // Assign a 'natural' best position

    // Adjust height/weight slightly based on best position archetype
    switch (bestPosition) {
        case 'QB': case 'WR': baseHeight += getRandomInt(1, 4); baseWeight -= getRandomInt(0, 10); break; // Taller, lighter
        case 'OL': case 'DL': baseHeight -= getRandomInt(0, 2); baseWeight += getRandomInt(20, 40); break; // Shorter, heavier
        case 'RB': baseWeight += getRandomInt(5, 15); break; // Slightly heavier
    }

    // Initial random attributes within a baseline range
    let attributes = {
        physical: { speed: getRandomInt(40, 70), strength: getRandomInt(40, 70), agility: getRandomInt(40, 70), stamina: getRandomInt(50, 80), height: Math.round(baseHeight), weight: Math.round(baseWeight) },
        mental: { playbookIQ: getRandomInt(30, 70), clutch: getRandomInt(20, 90), consistency: getRandomInt(40, 80), toughness: getRandomInt(50, 95) },
        technical: { throwingAccuracy: getRandomInt(20, 50), catchingHands: getRandomInt(30, 60), tackling: getRandomInt(30, 60), blocking: getRandomInt(30, 60), blockShedding: getRandomInt(30, 60) }
    };

    // Weight modifier: heavier players get strength boost, speed/agility penalty
    const weightModifier = (attributes.physical.weight - 125) / 50; // Normalize weight around 125 lbs
    attributes.physical.strength = Math.round(attributes.physical.strength + weightModifier * 10);
    attributes.physical.speed = Math.round(attributes.physical.speed - weightModifier * 8);
    attributes.physical.agility = Math.round(attributes.physical.agility - weightModifier * 5);

    // Boost key attributes based on the player's 'best position'
    switch (bestPosition) {
        case 'QB': attributes.technical.throwingAccuracy = getRandomInt(65, 95); attributes.mental.playbookIQ = getRandomInt(60, 95); break;
        case 'RB': attributes.physical.speed = getRandomInt(60, 90); attributes.physical.strength = getRandomInt(55, 85); attributes.physical.agility = getRandomInt(60, 90); break;
        case 'WR': attributes.physical.speed = getRandomInt(65, 95); attributes.technical.catchingHands = getRandomInt(60, 95); attributes.physical.agility = getRandomInt(70, 95); break;
        case 'OL': attributes.physical.strength = getRandomInt(70, 95); attributes.technical.blocking = getRandomInt(65, 95); break;
        case 'DL': attributes.physical.strength = getRandomInt(70, 95); attributes.technical.tackling = getRandomInt(65, 95); attributes.technical.blockShedding = getRandomInt(60, 90); break;
        case 'LB': attributes.technical.tackling = getRandomInt(65, 95); attributes.physical.speed = getRandomInt(60, 85); attributes.mental.playbookIQ = getRandomInt(50, 85); break;
        case 'DB': attributes.physical.speed = getRandomInt(70, 95); attributes.physical.agility = getRandomInt(70, 95); attributes.technical.catchingHands = getRandomInt(50, 80); break;
    }

    // Clamp all non-physical attributes between 1 and 99
    Object.keys(attributes).forEach(cat => Object.keys(attributes[cat]).forEach(attr => {
        if (typeof attributes[cat][attr] === 'number' && !['height', 'weight'].includes(attr)) {
            attributes[cat][attr] = Math.max(1, Math.min(99, attributes[cat][attr]));
        }
    }));

    // Initialize stats objects
    const initialStats = { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0, sacks: 0, interceptions: 0 };

    return {
        id: crypto.randomUUID(),
        name: `${firstName} ${lastName}`,
        age,
        favoriteOffensivePosition,
        favoriteDefensivePosition,
        attributes,
        teamId: null, // Initially undrafted
        status: { type: 'healthy', description: '', duration: 0 }, // Player status (injury, etc.)
        fatigue: 0, // In-game fatigue
        gameStats: { ...initialStats },
        seasonStats: { ...initialStats },
        careerStats: { ...initialStats, seasonsPlayed: 0 }
    };
}

/** Yields control to the main thread briefly to prevent freezing during long operations. */
export function yieldToMain() { return new Promise(resolve => setTimeout(resolve, 0)); }

/** Adds a message to the player's inbox. */
function addMessage(subject, body, isRead = false) {
    if (!game.messages) game.messages = [];
    game.messages.unshift({ id: crypto.randomUUID(), subject, body, isRead });
}

/** Initializes the league state (teams, players). */
export async function initializeLeague(onProgress) {
    console.log("Initializing league...");
    game = { year: 1, teams: [], players: [], freeAgents: [], playerTeam: null, schedule: [], currentWeek: 0, divisions: {}, draftOrder: [], currentPick: 0, hallOfFame: [], gameResults: [], messages: [] };
    addMessage("Welcome to the League!", "Your new season is about to begin. Get ready to draft your team!");

    // Setup divisions
    game.divisions[divisionNames[0]] = []; game.divisions[divisionNames[1]] = [];

    // Generate initial player pool
    const totalPlayers = 300;
    for (let i = 0; i < totalPlayers; i++) {
        game.players.push(generatePlayer());
        // Report progress and yield every 10 players
        if (i % 10 === 0 && onProgress) { onProgress(i / totalPlayers); await yieldToMain(); }
    }

    // Generate AI teams
    const availableTeamNames = [...teamNames];
    for (let i = 0; i < 19; i++) { // Create 19 AI teams
        const teamName = `The ${availableTeamNames.splice(getRandomInt(0, availableTeamNames.length - 1), 1)[0]}`;
        const division = divisionNames[i % divisionNames.length];
        const coach = getRandom(coachPersonalities);

        // Get slots based on coach's preferred formations
        const offenseSlots = offenseFormations[coach.preferredOffense].slots;
        const defenseSlots = defenseFormations[coach.preferredDefense].slots;

        const team = {
            id: crypto.randomUUID(), name: teamName, roster: [], coach, division, wins: 0, losses: 0,
            formations: { offense: coach.preferredOffense, defense: coach.preferredDefense },
            // Initialize empty depth chart based on formation slots
            depthChart: {
                offense: Object.fromEntries(offenseSlots.map(slot => [slot, null])),
                defense: Object.fromEntries(defenseSlots.map(slot => [slot, null]))
            },
            draftNeeds: 0 // Initialize draft needs
        };
        game.teams.push(team);
        game.divisions[division].push(team.id);
    }
}

/** Creates the player-controlled team. */
export function createPlayerTeam(teamName) {
    const finalTeamName = teamName.toLowerCase().startsWith("the ") ? teamName : `The ${teamName}`;
    const division = game.teams.length % 2 === 0 ? divisionNames[0] : divisionNames[1]; // Alternate divisions

    // Default formations for the player
    const defaultOffense = 'Balanced';
    const defaultDefense = '3-3-1';
    const defaultOffenseSlots = offenseFormations[defaultOffense].slots;
    const defaultDefenseSlots = defenseFormations[defaultDefense].slots;

    const playerTeam = {
        id: crypto.randomUUID(), name: finalTeamName, roster: [], coach: getRandom(coachPersonalities), // Assign random coach for now
        division, wins: 0, losses: 0,
        formations: { offense: defaultOffense, defense: defaultDefense },
        depthChart: {
            offense: Object.fromEntries(defaultOffenseSlots.map(slot => [slot, null])),
            defense: Object.fromEntries(defaultDefenseSlots.map(slot => [slot, null]))
        },
        draftNeeds: 0
    };
    game.teams.push(playerTeam);
    game.divisions[division].push(playerTeam.id);
    game.playerTeam = playerTeam; // Set reference to player's team
    addMessage("Team Created!", `Welcome to the league, ${finalTeamName}! It's time to build your team in the draft.`);
}

/** Calculates a player's score based on a coach's preferences. */
function getPlayerScore(player, coach) {
    let score = 0;
    // Sum weighted attribute scores
    for (const category in player.attributes) {
        for (const attr in player.attributes[category]) {
            score += player.attributes[category][attr] * (coach.attributePreferences[category]?.[attr] || 1.0);
        }
    }
    // Youth Scout bonus for younger players
    if (coach.type === 'Youth Scout') score += (18 - player.age) * 10;
    return score;
}

/** Sets up the draft order based on previous season's standings (or random for year 1). */
export function setupDraft() {
    game.draftOrder = [];
    game.currentPick = 0;

    // Sort teams by wins (ascending), then losses (descending)
    const sortedTeams = [...game.teams].sort((a, b) => a.wins - b.wins || b.losses - a.losses);

    // First season: all teams need 10 players
    if (game.year === 1) {
        console.log("First season: Setting draft needs to 10 for all teams.");
        game.teams.forEach(team => team.draftNeeds = 10);
    }

    // Determine number of rounds based on max needs
    const maxNeeds = Math.max(0, ...game.teams.map(t => t.draftNeeds || 0)); // Ensure needs is a number
    if (maxNeeds === 0 && game.year > 1) {
         console.log("No draft needs found for any team. Skipping draft setup for rounds.");
         // Still might need a single round if rosters aren't full?
         // For now, if needs are 0, assume draft is effectively skipped.
         return;
    }


    // Create serpentine draft order for the required number of rounds
    for (let i = 0; i < maxNeeds; i++) {
        // Even rounds: standard order, Odd rounds: reversed order
        game.draftOrder.push(...(i % 2 === 0 ? sortedTeams : [...sortedTeams].reverse()));
    }
    console.log(`Draft setup with ${maxNeeds} rounds, total picks: ${game.draftOrder.length}`);
}


/**
 * Automatically sets the depth chart for an AI team based on slot suitability.
 * Prioritizes key positions and avoids starting critical offensive players on defense if possible.
 */
export function aiSetDepthChart(team) {
    const { roster, depthChart } = team;
    if (!roster || roster.length === 0) return; // Skip if no roster

    // Reset depth chart to ensure no lingering players from formation changes etc.
    for (const side in depthChart) {
        for (const slot in depthChart[side]) {
            depthChart[side][slot] = null;
        }
    }

    // Assign players to slots, allowing players on both sides
    for (const side in depthChart) {
        const slots = Object.keys(depthChart[side]);
        let availablePlayers = [...roster]; // Players available for this side

        // Prioritize filling key positions first (QB, RB, WR1)
        slots.sort((a, b) => {
            if (a.startsWith('QB')) return -1; if (b.startsWith('QB')) return 1;
            if (a.startsWith('RB')) return -1; if (b.startsWith('RB')) return 1;
            if (a.startsWith('WR1')) return -1; if (b.startsWith('WR1')) return 1;
            return 0; // Default sort for other positions
        });

        slots.forEach(slot => {
            if (availablePlayers.length > 0) {
                // Find the best available player for *this specific slot*
                const bestPlayerForSlot = availablePlayers.reduce((best, current) => {
                    // Use new slot-specific suitability calculator
                    const bestSuitability = calculateSlotSuitability(best, slot, side, team);
                    const currentSuitability = calculateSlotSuitability(current, slot, side, team);

                    // --- Avoid Two-Way Starters in Key Roles ---
                    const otherSide = side === 'offense' ? 'defense' : 'offense';
                    // Check if player is already starting QB or RB on the *other* side
                    const isStartingCriticalOtherSideBest = (team.depthChart[otherSide]?.['QB1'] === best.id) ||
                                                             (team.depthChart[otherSide]?.['RB1'] === best.id);
                    const isStartingCriticalOtherSideCurrent = (team.depthChart[otherSide]?.['QB1'] === current.id) ||
                                                                (team.depthChart[otherSide]?.['RB1'] === current.id);

                    // Prefer the player NOT starting in a critical role elsewhere
                    if (isStartingCriticalOtherSideBest && !isStartingCriticalOtherSideCurrent) return current;
                    if (!isStartingCriticalOtherSideBest && isStartingCriticalOtherSideCurrent) return best;
                    // --- End Two-Way Check ---

                    // If roles don't conflict, or both conflict, pick the most suitable for *this* slot
                    return currentSuitability > bestSuitability ? current : best;
                });

                // Assign the best player and remove them from available list for this side
                team.depthChart[side][slot] = bestPlayerForSlot.id;
                availablePlayers = availablePlayers.filter(p => p.id !== bestPlayerForSlot.id);
            }
        });
    }
}

/** Simulates an AI draft pick based on coach preferences. */
export function simulateAIPick(team) {
    // Skip pick if roster is full (10 players)
    if (team.roster.length >= 10) {
        return null;
    }

    const undraftedPlayers = game.players.filter(p => !p.teamId);
    if (undraftedPlayers.length === 0) return null; // No players left

    // Find the best available player based on the team's coach score
    const bestPlayer = undraftedPlayers.reduce((best, current) => {
        const score = getPlayerScore(current, team.coach);
        return score > best.score ? { player: current, score } : best;
    }, { player: null, score: -1 }).player;

    if (bestPlayer) {
        addPlayerToTeam(bestPlayer, team);
    }
    return bestPlayer; // Return the drafted player or null
}

/** Adds a player to a team's roster. */
export function addPlayerToTeam(player, team) {
    player.teamId = team.id;
    team.roster.push(player);
    return true; // Indicate success
}


/** Generates the league schedule using a round-robin algorithm within divisions. */
export function generateSchedule() {
    game.schedule = [];
    game.currentWeek = 0;
    const numWeeks = 9;
    const allWeeklyGames = Array(numWeeks).fill(null).map(() => []); // Array of arrays for each week

    for (const divisionName in game.divisions) {
        // Filter teams for the current division
        let teamsInDivision = game.teams.filter(t => t.division === divisionName);

        // Schedule requires an even number of teams (10 in this case)
        if (teamsInDivision.length !== 10) {
            console.error(`Scheduling Error: Division ${divisionName} requires 10 teams but has ${teamsInDivision.length}. Skipping division.`);
            continue;
        }

        const numTeams = teamsInDivision.length; // Should be 10

        // Round-robin scheduling algorithm
        for (let round = 0; round < numWeeks; round++) {
            for (let match = 0; match < numTeams / 2; match++) {
                const home = teamsInDivision[match];
                const away = teamsInDivision[numTeams - 1 - match];

                if (home && away) {
                    // Alternate home/away each round for fairness (approximately)
                    const matchup = round % 2 === 1 ? { home, away } : { home: away, away: home };
                    // Add matchup to the correct week's game list
                    allWeeklyGames[round].push(matchup);
                } else {
                     console.warn(`Scheduling warning: Missing home or away team in round ${round}, match ${match} for division ${divisionName}`);
                }
            }
            // Rotate teams (except the first one) for the next round
            teamsInDivision.splice(1, 0, teamsInDivision.pop());
        }
    }

    // Flatten the weekly game arrays into a single schedule array
    game.schedule = allWeeklyGames.flat();
    console.log(`Schedule generated: ${game.schedule.length} total games over ${numWeeks} weeks.`);
}

/** Resets player fatigue and game stats before a new game simulation. */
function resetGameStats() {
    game.players.forEach(player => {
        player.fatigue = 0; // Reset fatigue
        // Reset game-specific stats
        player.gameStats = { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0, sacks: 0, interceptions: 0 };
    });
}

/** Checks for a chance of in-game injury based on toughness. */
function checkInGameInjury(player, gameLog) {
    if (!player || player.status.duration > 0) return; // Skip if already unavailable
    const injuryChance = 0.008; // Base chance per play involvement
    const toughnessModifier = (100 - player.attributes.mental.toughness) / 100; // Higher toughness = lower chance

    if (Math.random() < injuryChance * toughnessModifier) {
        const duration = getRandomInt(1, 3); // Minor injury duration
        player.status.type = 'injured';
        player.status.description = 'Minor Injury';
        player.status.duration = duration;
        player.status.isNew = true; // Flag for UI notification
        if (gameLog) gameLog.push(`INJURY: ${player.name} has suffered a minor injury and will be out for ${duration} week(s).`);
    }
}

/** Finds the best available substitute player for a given position. */
function getBestSub(team, position, usedPlayerIds) {
    // Filter roster for healthy players not already used in the current play/assignment
    const availableSubs = team.roster.filter(p => p.status.duration === 0 && !usedPlayerIds.has(p.id));
    if (availableSubs.length === 0) return null; // No subs available

    // Find the sub with the highest overall rating for the needed position
    return availableSubs.reduce((best, current) =>
        (calculateOverall(current, position) > calculateOverall(best, position)) ? current : best,
        availableSubs[0] // Start comparison with the first available sub
    );
}

/** Gets active players for specific slots (e.g., all 'WR' slots), handling subs. */
function getPlayersForSlots(team, side, slotPrefix, usedPlayerIdsThisPlay) {
    const slots = Object.keys(team.depthChart[side]).filter(s => s.startsWith(slotPrefix));
    const position = slotPrefix.replace(/\d/g, ''); // Base position (e.g., 'WR')
    const activePlayers = [];

    slots.forEach(slot => {
        // Find the designated starter for the slot
        let player = team.roster.find(p => p.id === team.depthChart[side][slot]);
        // If starter is unavailable or already used, find the best sub
        if (!player || player.status.duration > 0 || usedPlayerIdsThisPlay.has(player.id)) {
            player = getBestSub(team, position, usedPlayerIdsThisPlay);
        }
        // If a valid player (starter or sub) is found and not already used this play
        if (player && !usedPlayerIdsThisPlay.has(player.id)) {
            activePlayers.push({ player: player, slot: slot }); // Return player *and* their assigned slot
            usedPlayerIdsThisPlay.add(player.id); // Mark player as used for this specific play
        }
    });
    return activePlayers;
}


/**
 * Determines the offensive play call based on game situation, personnel, and coach tendencies.
 * Returns a valid play key from the offensivePlaybook.
 */
function determinePlayCall(offense, defense, down, yardsToGo, ballOn, scoreDiff, gameLog, drivesRemaining) {
    const { coach } = offense;
    const offenseFormationName = offense.formations.offense;
    const defenseFormationName = defense.formations.defense;

    const offenseFormation = offenseFormations[offenseFormationName];
    const defenseFormation = defenseFormations[defenseFormationName];

    // Failsafe if formation data is missing
    if (!offenseFormation?.personnel || !defenseFormation?.personnel) {
        console.error(`CRITICAL ERROR: Formation data missing for ${offense.name} (${offenseFormationName}) or ${defense.name} (${defenseFormationName}).`);
        return 'Balanced_InsideRun'; // Absolute failsafe play
    }

    // Get key offensive players for decision making
    const usedIds = new Set(); // Track used players for QB/RB check
    const qb = getPlayersForSlots(offense, 'offense', 'QB', usedIds)[0]?.player;
    const rb = getPlayersForSlots(offense, 'offense', 'RB', usedIds)[0]?.player;

    const qbStrength = qb ? calculateOverall(qb, 'QB') : 0;
    const rbStrength = rb ? calculateOverall(rb, 'RB') : 0;

    // --- Base Pass Chance & Adjustments ---
    let passChance = 0.45; // Default baseline

    // Personnel Mismatches
    if (offenseFormation.personnel.WR > defenseFormation.personnel.DB + 1) passChance += 0.2; // More WRs than DBs
    if (offenseFormation.personnel.RB + offenseFormation.personnel.OL > defenseFormation.personnel.DL + defenseFormation.personnel.LB + 1) passChance -= 0.2; // Run blocking advantage

    // Player Strengths
    if (qbStrength < 50 && rbStrength > 50) passChance -= 0.25; // Bad QB, good RB -> run more
    if (rbStrength < 50 && qbStrength > 50) passChance += 0.15; // Bad RB, good QB -> pass more
    if (qbStrength > rbStrength + 15) passChance += 0.1; // Significantly better QB
    if (rbStrength > qbStrength + 15) passChance -= 0.1; // Significantly better RB

    // Game Situation
    if (down === 3 && yardsToGo > 6) passChance += 0.4; // Obvious passing down
    if (down === 4 && yardsToGo > 3) passChance = 0.95; // Must pass on 4th and long
    if (yardsToGo <= 2) passChance -= 0.4; // Short yardage -> run more
    if (ballOn > 80) passChance += 0.1; // Closer to endzone -> slightly more passing
    if (scoreDiff < -10) passChance += 0.2; // Trailing significantly -> pass more
    if (scoreDiff > 14 && drivesRemaining < 3) passChance -= 0.3; // Leading late -> run clock

    // Coach Tendencies
    if (coach.type === 'Ground and Pound') passChance -= 0.3;
    if (coach.type === 'West Coast Offense') passChance += 0.2;
    if (coach.type === 'Spread') passChance += 0.25;

    // --- Play Selection ---
    // Get all valid plays for the team's current offensive formation
    const formationPlays = Object.keys(offensivePlaybook).filter(key => key.startsWith(offenseFormationName));
    if (formationPlays.length === 0) {
        console.error(`CRITICAL: No plays found in playbook for formation ${offenseFormationName}!`);
        return 'Balanced_InsideRun'; // Failsafe
    }

    // Special Case: QB Sneak on very short yardage
    if (yardsToGo <= 1 && qbStrength > 60 && Math.random() < 0.6) {
        const sneakPlay = formationPlays.find(p => offensivePlaybook[p].zone === ZONES.SNEAK);
        if (sneakPlay) return sneakPlay;
        // Fallback to inside run if sneak isn't defined for formation
        return getRandom(formationPlays.filter(p => p.includes('InsideRun') || p.includes('Dive'))) || formationPlays[0];
    }

    // Determine desired play type (pass/run) based on calculated chance
    let desiredPlayType = (Math.random() < passChance) ? 'pass' : 'run';
    let possiblePlays = formationPlays.filter(key => offensivePlaybook[key].type === desiredPlayType);

    // If no plays of desired type exist (e.g., formation has no runs), switch type
    if (possiblePlays.length === 0) {
        // gameLog.push(`Warning: No ${desiredPlayType} plays found for ${offenseFormationName}. Switching type.`); // Optional log
        desiredPlayType = desiredPlayType === 'pass' ? 'run' : 'pass';
        possiblePlays = formationPlays.filter(key => offensivePlaybook[key].type === desiredPlayType);
        // If still no plays, log error and return first available play for formation
        if (possiblePlays.length === 0) {
            console.error(`CRITICAL: No plays found for ${offenseFormationName} of type ${desiredPlayType} either!`);
            return formationPlays[0]; // Absolute failsafe
        }
    }

    // --- Select Specific Play Based on Situation (Sub-selection) ---
    if (desiredPlayType === 'pass') {
        const deep = (yardsToGo > 15 || (ballOn < 50 && scoreDiff < -7 && drivesRemaining < 5)); // Need big yards or trailing
        const screen = (down <= 2 && yardsToGo < 7 && qbStrength < 70); // Early down, short yards, weaker QB

        // Prioritize screen passes if conditions met and available
        const screenPlays = possiblePlays.filter(p => p.includes('Screen'));
        if (screen && screenPlays.length > 0 && Math.random() < 0.7) { // High chance if conditions met
            return getRandom(screenPlays);
        }
        // Prioritize deep passes if conditions met and available
        const deepPlays = possiblePlays.filter(p => p.includes('Deep') || p.includes('Verts'));
        if (deep && deepPlays.length > 0 && Math.random() < 0.6) { // Good chance if conditions met
            return getRandom(deepPlays);
        }
        // Default to short/medium passes otherwise
        const shortMediumPlays = possiblePlays.filter(p => p.includes('Short') || p.includes('Slant') || p.includes('Curl') || p.includes('Flat') || p.includes('Out'));
        return getRandom(shortMediumPlays) || getRandom(possiblePlays); // Fallback to any available pass play
    } else { // Run play sub-selection
        const outside = (rb && rb.attributes.physical.speed > 75); // Fast RB -> higher chance of outside run

        const outsidePlays = possiblePlays.filter(p => p.includes('Outside') || p.includes('Sweep'));
        if (outside && Math.random() < 0.4 && outsidePlays.length > 0) { // Moderate chance for fast RB
            return getRandom(outsidePlays);
        }
        // Default to inside runs otherwise
        const insidePlays = possiblePlays.filter(p => p.includes('Inside') || p.includes('Dive'));
        return getRandom(insidePlays) || getRandom(possiblePlays); // Fallback to any available run play
    }
}

/**
 * Resolves a single 1-on-1 battle for one tick using a simplified win/loss/streak mechanic.
 * Modifies the battleState object directly.
 * @param {number} powerA - Offensive player's relevant power score.
 * @param {number} powerB - Defensive player's relevant power score.
 * @param {object} battleState - State object { status, streakA, streakB }.
 * @param {string[]} log - Optional game log array.
 * @param {string} logPrefix - Optional prefix for log messages.
 * @returns {object} The updated battleState object.
 */
function resolveBattle(powerA, powerB, battleState, log = null, logPrefix = '') {
    const DOMINANT_WIN_THRESHOLD = 20; // Significant difference needed for instant win
    const SLIGHT_WIN_THRESHOLD = 5; // Smaller difference for streak building
    const WIN_STREAK_NEEDED = 2; // Ticks needed to win via slight advantages

    // Add randomness to each power score for variability
    const diff = (powerA + getRandomInt(-5, 5)) - (powerB + getRandomInt(-5, 5));

    if (diff > DOMINANT_WIN_THRESHOLD) { // Dominant Win for A
        battleState.status = 'win_A';
        if (log && Math.random() < 0.3) log.push(`${logPrefix} DOMINANT WIN A`); // Less frequent logging
    } else if (diff > SLIGHT_WIN_THRESHOLD) { // Slight Win for A
        battleState.streakA = (battleState.streakA || 0) + 1;
        battleState.streakB = 0; // Reset opponent's streak
        if (log && Math.random() < 0.1) log.push(`${logPrefix} slight win A (streak ${battleState.streakA})`);
        if (battleState.streakA >= WIN_STREAK_NEEDED) battleState.status = 'win_A';
    } else if (diff < -DOMINANT_WIN_THRESHOLD) { // Dominant Win for B
        battleState.status = 'win_B';
        if (log && Math.random() < 0.3) log.push(`${logPrefix} DOMINANT WIN B`);
    } else if (diff < -SLIGHT_WIN_THRESHOLD) { // Slight Win for B
        battleState.streakB = (battleState.streakB || 0) + 1;
        battleState.streakA = 0; // Reset opponent's streak
        if (log && Math.random() < 0.1) log.push(`${logPrefix} slight win B (streak ${battleState.streakB})`);
        if (battleState.streakB >= WIN_STREAK_NEEDED) battleState.status = 'win_B';
    } else { // Draw or negligible difference
        battleState.streakA = 0; // Reset both streaks on a draw
        battleState.streakB = 0;
        if (log && Math.random() < 0.05) log.push(`${logPrefix} draw`);
    }
    return battleState; // Return modified state
}


/**
 * Simulates a single play using a tick-based resolution system.
 * @param {object} offense - The offensive team object.
 * @param {object} defense - The defensive team object.
 * @param {string} playKey - The key of the play from the offensivePlaybook.
 * @param {object} gameState - Contains contextual info like gameLog, weather, ballOn.
 * @returns {object} Result object { yards, touchdown, turnover, incomplete, log }.
 */
function resolvePlay(offense, defense, playKey, gameState) {
    const { gameLog = [], weather, ballOn } = gameState; // Destructure context, provide default log array

    // --- Battle resolution constants (consistent names) ---
    const TACKLE_THRESHOLD = 5; // Used for grapple/tackle comparisons

    // --- Play Lookup & Failsafe ---
    let play = offensivePlaybook[playKey];
    if (!play) {
        console.error(`Play key "${playKey}" not found in playbook! Defaulting to Balanced_InsideRun.`);
        playKey = 'Balanced_InsideRun';
        play = offensivePlaybook[playKey];
        if (!play) { // If even the default is missing
            gameLog.push("CRITICAL ERROR: Default play 'Balanced_InsideRun' not found in playbook!");
            return { yards: 0, turnover: true, incomplete: false, touchdown: false, log: gameLog }; // Critical failure
        }
    }
    const { type, zone, playAction, assignments } = play; // Destructure play details

    // --- Player Fatigue Modifier ---
    const getFatigueModifier = (p) => (p ? Math.max(0.3, (1 - (p.fatigue / (p.attributes.physical.stamina * 3)))) : 1); // Ensure modifier doesn't go below 0.3

    // --- Player Gathering & Substitution Logic ---
    const usedPlayerIds_O = new Set();
    const usedPlayerIds_D = new Set();

    // Helper to get player by slot, handling subs if needed
    const getPlayerBySlot = (team, side, slot, usedSet) => {
        let p = team.roster.find(pl => pl.id === team.depthChart[side]?.[slot]); // Safely access depth chart
        // If starter missing, injured, or already used this play, find sub
        if (!p || p.status.duration > 0 || usedSet.has(p.id)) {
            p = getBestSub(team, slot.replace(/\d/g, ''), usedSet);
        }
        // If a valid player found, mark as used and return
        if (p && !usedSet.has(p.id)) {
            usedSet.add(p.id);
            return p;
        }
        return null; // No suitable player found
    };

    // Helper to find an emergency player if standard slots/subs fail
    const findEmergencyPlayer = (position, team, side, usedSet) => {
        const available = team.roster.filter(p => p.status.duration === 0 && !usedSet.has(p.id));
        if (!available.length) return null; // No one available at all
        // Find best overall player for the position among remaining players
        const best = available.reduce((bestSoFar, cur) => calculateOverall(cur, position) > calculateOverall(bestSoFar, position) ? cur : bestSoFar, available[0]);
        // gameLog.push(`EMERGENCY (${team.name}): ${best.name} fills ${position}`); // Optional log
        usedSet.add(best.id);
        return { player: best, slot: `SUB_${position}` }; // Return player and generic slot name
    };


    // --- Gather Players for the Play & Apply Fatigue ---
    // Defense
    const dls = getPlayersForSlots(defense, 'defense', 'DL', usedPlayerIds_D).map(x => x.player).filter(Boolean);
    const lbs = getPlayersForSlots(defense, 'defense', 'LB', usedPlayerIds_D).map(x => x.player).filter(Boolean);
    const dbs = getPlayersForSlots(defense, 'defense', 'DB', usedPlayerIds_D).map(x => x.player).filter(Boolean);
    [...dls, ...lbs, ...dbs].forEach(p => { if (p) p.fatigue = Math.min(100, p.fatigue + 5); }); // Increase fatigue

    // Offense
    let qb = getPlayerBySlot(offense, 'offense', 'QB1', usedPlayerIds_O) || findEmergencyPlayer('QB', offense, 'offense', usedPlayerIds_O)?.player;
    const rbs = getPlayersForSlots(offense, 'offense', 'RB', usedPlayerIds_O).map(x => x.player).filter(Boolean);
    const wrs = getPlayersForSlots(offense, 'offense', 'WR', usedPlayerIds_O).map(x => x.player).filter(Boolean);
    const ols = getPlayersForSlots(offense, 'offense', 'OL', usedPlayerIds_O).map(x => x.player).filter(Boolean);
    [qb, ...rbs, ...wrs, ...ols].forEach(p => { if (p) p.fatigue = Math.min(100, p.fatigue + 5); }); // Increase fatigue

    // --- QB Sneak Shortcut ---
    if (zone === ZONES.SNEAK) {
        if (!qb) return { yards: 0, turnover: true }; // Turnover if no QB available
        checkInGameInjury(qb, gameLog); // Injury check
        // Simple power contest: QB strength/weight vs best available DL
        const qbPower = (qb.attributes.physical.strength + qb.attributes.physical.weight / 5) * getFatigueModifier(qb);
        const dlStopper = getPlayerBySlot(defense, 'defense', 'DL2', usedPlayerIds_D) || getPlayerBySlot(defense, 'defense', 'DL1', usedPlayerIds_D) || findEmergencyPlayer('DL', defense, 'defense', usedPlayerIds_D)?.player;
        if (!dlStopper) return { yards: 1, touchdown: ballOn + 1 >= 100 }; // Gain yard if no DL
        checkInGameInjury(dlStopper, gameLog); // Injury check
        const dlPower = (dlStopper.attributes.physical.strength + dlStopper.attributes.technical.blockShedding) * getFatigueModifier(dlStopper);

        const diff = qbPower - (dlPower + getRandomInt(-10, 10)); // QB power vs DL power + randomness
        let yards = 0;
        if (diff > TACKLE_THRESHOLD) yards = getRandomInt(1, 2); // QB wins -> gain 1-2 yards
        else if (diff < -TACKLE_THRESHOLD) yards = 0; // DL wins -> no gain
        else yards = getRandomInt(0, 1); // Draw -> 0-1 yard gain

        if (yards > 0) gameLog.push(`QB Sneak by ${qb.name} for ${yards} yard(s)!`);
        else { gameLog.push(`QB Sneak stuffed by ${dlStopper.name}!`); dlStopper.gameStats.tackles++; }

        const touchdown = ballOn + yards >= 100;
        if (touchdown && yards > 0) { // Only score TD if yards gained
             qb.gameStats.touchdowns++;
             qb.gameStats.rushYards += yards; // Add yards for TD run
         } else if (yards > 0) {
              qb.gameStats.rushYards += yards;
         }

        return { yards, touchdown, turnover: false, incomplete: false, log: gameLog };
    }

    // --- Setup State for Tick Loop ---
    let playIsLive = true;
    let tick = 0;
    const MAX_PLAY_TICKS = 25; // Max duration of a play in ticks
    let yards = 0, touchdown = false, turnover = false, incomplete = false, sack = false;
    let ballThrown = false, ballCarrier = null, tackler = null;
    let pressure = false; // QB feeling pressure
    let rusherWhoWon = null; // DL/LB who broke through
    let unblockedRusher = null; // Rusher not picked up by blockers

    const offenseFormationData = offenseFormations[offense.formations.offense];
    const defenseFormationData = defenseFormations[defense.formations.defense];

    // --- Battle State Containers ---
    const battleStates = {
        passRush: [], // { blockers: Player[], rusher: Player, status: 'ongoing'|'win_A'|'win_B', streakA: number, streakB: number, isDoubleTeam: boolean }
        coverage: [], // { receiver: Player, defenders: Player[], status: 'covered'|'open', separation: number, streakA: number, streakB: number, route: string, routeInfo: object }
        runBlock: []  // { blocker: Player, defender: Player, status: 'ongoing'|'win_A'|'win_B', streakA: number, streakB: number }
    };

    // --- (A) PASS PLAY: Setup Pass Rush Battles ---
    if (type === 'pass') {
        // Identify potential pass rushers (DLs + LBs not in coverage based on formation)
        const potentialRushers = dls.concat(lbs.filter(p => {
            const slot = Object.keys(defense.depthChart.defense).find(s => defense.depthChart.defense[s] === p.id);
            // Rush if LB's default assignment isn't explicitly coverage
            return slot && defenseFormationData?.routes?.[slot] && !defenseFormationData.routes[slot].some(r => r.includes('cover'));
        })).filter(Boolean); // Filter out nulls if subs failed

        // Identify blockers (OLs + RBs assigned to pass block)
        const potentialBlockers = ols.concat(rbs.filter(r => {
            const slot = Object.keys(offense.depthChart.offense).find(s => offense.depthChart.offense[s] === r.id);
            return slot && offenseFormationData?.routes?.[slot]?.includes('block_pass');
        })).filter(Boolean);

        let availableBlockers = [...potentialBlockers];
        // Identify best rusher for potential double team
        const bestRusher = potentialRushers.length ? potentialRushers.reduce((b, c) => calculateOverall(c, 'DL') > calculateOverall(b, 'DL') ? c : b, potentialRushers[0]) : null;

        potentialRushers.forEach(rusher => {
            if (!availableBlockers.length) {
                // Rusher is unblocked if no more blockers available
                unblockedRusher = rusher;
                return;
            }
            // Assign blocker(s) to rusher
            let assignedBlockers = [availableBlockers.pop()]; // Start with one blocker
            let isDoubleTeam = false;
            // Conservative double team logic: if more blockers than rushers remain, and this is the best rusher
            if (availableBlockers.length >= potentialRushers.length - battleStates.passRush.length && bestRusher && rusher.id === bestRusher.id && availableBlockers.length > 0) {
                 const helper = availableBlockers.pop();
                 if(helper) {
                     assignedBlockers.push(helper);
                     isDoubleTeam = true;
                 } else {
                     availableBlockers.push(assignedBlockers.pop()); // Put blocker back if helper failsafe triggered
                     assignedBlockers = [availableBlockers.pop()]; // Re-assign single blocker
                 }
            }
            // Add battle state for this rush matchup
            battleStates.passRush.push({ blockers: assignedBlockers, rusher, status: 'ongoing', streakA: 0, streakB: 0, isDoubleTeam });
        });

        if (unblockedRusher) gameLog.push(`Blitz! ${unblockedRusher.name} has a free run at the QB!`);
    }

    // --- (B) PASS PLAY: Setup Coverage Battles ---
    if (type === 'pass' && assignments) {
        Object.keys(assignments)
            .filter(slot => slot.startsWith('WR') || slot.startsWith('RB')) // Only for eligible receivers
            .forEach(slot => {
                const routeName = assignments[slot];
                if (!routeName || routeName.toLowerCase().includes('block')) return; // Skip if blocking assignment

                const routeInfo = routeTree[routeName];
                if (!routeInfo) {
                    console.warn(`Route "${routeName}" for slot ${slot} not found in routeTree.`);
                    return; // Skip if route doesn't exist
                }

                // Find the receiver assigned to this slot
                const receiver = (slot.startsWith('WR') ? wrs : rbs).find(p => {
                    // Find the slot name assigned to this player in the depth chart
                    const playerSlot = Object.keys(offense.depthChart.offense).find(s => offense.depthChart.offense[s] === p?.id);
                    return playerSlot === slot;
                });
                if (!receiver) return; // Skip if receiver not found (e.g., sub failed)

                // --- Assign Defenders based on Zone Coverage ---
                let assignedDefenders = [];
                if (defenseFormationData?.zoneAssignments) {
                     // Find defenders whose zone assignment overlaps with the route's zones
                     const coverageSlots = Object.keys(defenseFormationData.zoneAssignments).filter(defSlot =>
                         routeInfo.zones.some(routeZone => routeZone === defenseFormationData.zoneAssignments[defSlot])
                     );
                     assignedDefenders = coverageSlots
                         .map(s => getPlayerBySlot(defense, 'defense', s, usedPlayerIds_D)) // Get players for those slots
                         .filter(Boolean); // Remove nulls if subs failed
                 }

                // If no zone defender, assign nearest available DB/LB (simple man fallback)
                 if (assignedDefenders.length === 0) {
                     const fallbackDefender = [...dbs, ...lbs].find(p => p && !usedPlayerIds_D.has(p.id)); // Find first available
                     if (fallbackDefender) {
                         assignedDefenders.push(fallbackDefender);
                         usedPlayerIds_D.add(fallbackDefender.id); // Mark as used
                     }
                 }

                // Simple Safety Help Logic for Deep Routes
                 if (routeInfo.zones.some(z => z.includes('DEEP')) && assignedDefenders.length < 2) {
                     const deepSafety = [...dbs, ...lbs].find(p => {
                        if (!p || usedPlayerIds_D.has(p.id)) return false;
                        const pSlot = Object.keys(defense.depthChart.defense).find(s => defense.depthChart.defense[s] === p.id);
                        // Check if player is assigned to a deep zone and isn't already covering this receiver
                        return pSlot && defenseFormationData?.zoneAssignments?.[pSlot]?.includes('DEEP') && !assignedDefenders.some(ad => ad.id === p.id);
                     });
                     if (deepSafety) {
                        assignedDefenders.push(deepSafety);
                        usedPlayerIds_D.add(deepSafety.id);
                     }
                 }
                // --- End Defender Assignment ---

                // Add coverage battle state
                battleStates.coverage.push({
                    receiver: receiver, // Renamed from 'player'
                    defenders: assignedDefenders,
                    status: assignedDefenders.length ? 'covered' : 'open',
                    separation: assignedDefenders.length ? 0 : 5, // Initial separation if open
                    streakA: 0, streakB: 0,
                    route: routeName, routeInfo
                });
            });
    }

    // --- (C) RUN PLAY: Setup Run Block Battles & Identify Ball Carrier ---
    if (type === 'run') {
        ballCarrier = rbs[0] || findEmergencyPlayer('RB', offense, 'offense', usedPlayerIds_O)?.player;
        if (!ballCarrier) { gameLog.push('No healthy RB available for run play!'); return { yards: 0, turnover: true }; } // Turnover if no RB

        // Simple run block assignment: each OL tries to block one DL/LB near the play zone
        const runBlockers = ols.length > 0 ? ols : []; // Use OLs if available
        let runDefenders = [...dls, ...lbs].filter(Boolean); // Defenders at the line

        runBlockers.forEach(blocker => {
            // Very basic assignment: try to block a random remaining defender
            if (runDefenders.length > 0) {
                const defenderIndex = getRandomInt(0, runDefenders.length - 1);
                const defender = runDefenders.splice(defenderIndex, 1)[0]; // Assign and remove defender
                if (defender) {
                    battleStates.runBlock.push({ blocker, defender, status: 'ongoing', streakA: 0, streakB: 0 });
                }
            }
        });
    }

    // --- ====== TICK LOOP ====== ---
    while (playIsLive && tick < MAX_PLAY_TICKS) {
        tick++;

        // --- (A) PASS PLAY TICKS ---
        if (type === 'pass') {
            // --- Resolve Pass Rush ---
            if (!pressure && !sack) { // Only resolve if QB isn't already pressured or sacked
                // Unblocked rusher gets instant pressure after tick 1
                if (unblockedRusher && tick > 1) {
                    pressure = true;
                    rusherWhoWon = unblockedRusher;
                    // gameLog.push(`${rusherWhoWon.name} gets instant pressure!`); // Optional log
                } else {
                    // Resolve each ongoing blocking battle
                    for (const battle of battleStates.passRush) {
                        if (battle.status === 'ongoing') {
                            // Calculate block power (sum of blockers) vs rush power
                            const blockPower = battle.blockers.reduce((sum, b) => sum + ((b.attributes.technical.blocking || 0) + (b.attributes.physical.strength || 0)) * getFatigueModifier(b), 0) * (battle.isDoubleTeam ? 1.3 : 1); // Double team bonus
                            const rushPower = ((battle.rusher.attributes.physical.strength || 0) + (battle.rusher.attributes.technical.blockShedding || 0) + (battle.rusher.attributes.physical.agility || 0)/2) * getFatigueModifier(battle.rusher); // Include agility slightly

                            resolveBattle(blockPower, rushPower, battle, gameLog, `${battle.rusher.name} vs ${battle.blockers.map(b=>b.name).join('+')}`); // Use helper

                            if (battle.status === 'win_B') { // Rusher wins
                                pressure = true;
                                rusherWhoWon = battle.rusher;
                                break; // Stop checking rush battles once pressure occurs
                            }
                        }
                    }
                }
            } // End pass rush resolution for tick

            // --- Resolve Coverage ---
            for (const cov of battleStates.coverage) {
                // Skip if receiver already clearly open
                if (cov.status === 'open' && cov.separation > 3) continue;
                 if (!cov.defenders.length) { // No defender assigned
                     cov.status = 'open';
                     cov.separation = Math.max(cov.separation || 5, 5); // Ensure decent separation
                     continue;
                 }

                // Primary defender contest (simplification: vs first defender)
                const defender = cov.defenders[0];
                // Receiver power: speed, agility, adjusted by time into route
                const recPower = ((cov.receiver.attributes.physical.speed || 0) + (cov.receiver.attributes.physical.agility || 0) + (cov.routeInfo.time / 2 * Math.min(tick, 4))) * getFatigueModifier(cov.receiver); // Route time bonus capped
                // Defender power: speed, agility, playbook IQ (awareness)
                const defPower = ((defender.attributes.physical.speed || 0) + (defender.attributes.physical.agility || 0) + (defender.attributes.mental.playbookIQ || 0)/2) * getFatigueModifier(defender);

                resolveBattle(recPower, defPower, cov, gameLog, `${cov.receiver.name} vs ${defender.name}`); // Use helper

                // Update separation based on battle outcome
                if (cov.status === 'win_A') cov.separation = Math.max(cov.separation || 0, 0) + cov.streakA + 1; // Increase separation on win streak
                else if (cov.status === 'win_B') cov.separation = Math.min(cov.separation || 0, 0) - cov.streakB - 1; // Decrease separation (negative means covered tightly)
                else cov.separation = cov.separation || 0; // Maintain current separation on draw

                // Update status based on separation
                cov.status = cov.separation > 1 ? 'open' : 'covered'; // Simple threshold for being 'open'
            } // End coverage resolution for tick

             // --- QB Decision Logic ---
             if (!ballThrown && !sack) {
                 const openReceivers = battleStates.coverage.filter(c => c.status === 'open' && c.separation > 2); // Find receivers with some space
                 const qbDecisionTime = Math.max(1, Math.ceil(99 / (qb?.attributes?.mental?.playbookIQ || 50) * 2)); // Faster decision for smarter QBs, min 1 tick

                 // Conditions to throw: pressure, decision time reached, good target open, or end of play clock
                 if ((pressure && tick > 1) || tick >= qbDecisionTime || (openReceivers.length > 0 && Math.random() < 0.5) || tick >= MAX_PLAY_TICKS - 2) {
                     ballThrown = true;
                     playIsLive = false; // Ball is in the air, simulation part ends

                     // --- Target Selection ---
                     let targetBattle = null;
                     if (openReceivers.length > 0) {
                         // Prioritize receiver with most separation, slightly preferring deeper routes if open
                         targetBattle = openReceivers.reduce((best, current) => {
                              const bestScore = (best.separation || 0) + (best.routeInfo.baseYards[1] / 10);
                              const currentScore = (current.separation || 0) + (current.routeInfo.baseYards[1] / 10);
                              return currentScore > bestScore ? current : best;
                          }, openReceivers[0]);
                     } else if (battleStates.coverage.length > 0) {
                         // Throw contested ball if no one is open (pick best available receiver based on hands)
                         targetBattle = battleStates.coverage.reduce((best, current) => (current.receiver.attributes.technical.catchingHands || 0) > (best.receiver.attributes.technical.catchingHands || 0) ? current : best, battleStates.coverage[0]);
                     } else {
                         // No eligible receivers ran routes? Throw away.
                         gameLog.push(`No eligible targets found, ${qb?.name || 'QB'} throws it away.`);
                         incomplete = true;
                         break; // End play resolution
                     }

                     const target = targetBattle.receiver;
                     const primaryDefender = targetBattle.defenders?.[0] || null;
                     const separation = targetBattle.separation || 0;
                     gameLog.push(`${qb.name} passes to ${target.name} (${targetBattle.route})...`);

                     // --- Accuracy Check ---
                     let qbAccuracyRating = (qb?.attributes?.technical?.throwingAccuracy || 50) * getFatigueModifier(qb);
                     if (pressure) qbAccuracyRating -= 15; // Penalty for pressure
                     if (weather === 'Windy' && targetBattle.routeInfo.zones.some(z => z.includes('DEEP'))) qbAccuracyRating -= 10; // Wind effect on deep balls
                     if (weather === 'Rain') qbAccuracyRating -= 5; // Rain effect

                     if (getRandomInt(1, 100) > qbAccuracyRating) {
                         gameLog.push(`INCOMPLETE pass to ${target.name}. Off target throw.`);
                         incomplete = true;
                         break; // End play
                     }

                     // --- Catch Contest ---
                     let catchPower = (target.attributes.technical.catchingHands || 0) + (separation * 2) - (weather === 'Rain' ? 10 : 0);
                     let defendPower = primaryDefender ? ((primaryDefender.attributes.technical.catchingHands || 0) + (primaryDefender.attributes.physical.agility || 0) + (primaryDefender.attributes.mental.playbookIQ || 0)/2) * getFatigueModifier(primaryDefender) : 0;
                      // Penalty for double coverage
                     if (targetBattle.defenders.length > 1) { catchPower -= 15; defendPower *= 1.2; }

                     const catchDiff = catchPower - (defendPower + getRandomInt(-20, 20));

                     if (catchDiff > 0) { // --- Catch Success ---
                         const baseYards = getRandomInt(targetBattle.routeInfo.baseYards[0], targetBattle.routeInfo.baseYards[1]);
                         yards = baseYards;
                         target.gameStats.receptions = (target.gameStats.receptions || 0) + 1;
                         gameLog.push(`Caught by ${target.name} for ${baseYards} yards.`);
                         checkInGameInjury(target, gameLog); // Injury check on catch

                         // --- Yards After Catch (YAC) ---
                         ballCarrier = target;
                         tackler = primaryDefender || // Primary defender if exists
                                   targetBattle.defenders?.[1] || // Secondary defender (safety help)
                                   [...dbs, ...lbs].find(p => p && !usedPlayerIds_D.has(p.id)); // Closest available non-rusher

                         if (tackler) {
                              checkInGameInjury(tackler, gameLog); // Injury check on tackle attempt
                             const breakTacklePower = ((ballCarrier.attributes.physical.agility || 0) + (ballCarrier.attributes.physical.strength || 0)/2) * getFatigueModifier(ballCarrier);
                             const tacklePower = ((tackler.attributes.technical.tackling || 0) + (tackler.attributes.physical.strength || 0)/2) * getFatigueModifier(tackler);
                             const tackleAttemptDiff = breakTacklePower - (tacklePower + getRandomInt(-15, 15));

                             if (tackleAttemptDiff > TACKLE_THRESHOLD) { // Broken tackle
                                 const extraYards = getRandomInt(5, 15 + Math.round(breakTacklePower / 10)); // More YAC for better players
                                 yards += extraYards;
                                 gameLog.push(`${ballCarrier.name} breaks the tackle from ${tackler.name} for +${extraYards} YAC!`);
                                 // Check for second tackler (simplified)
                                  const secondTackler = [...dbs, ...lbs].find(p => p && !usedPlayerIds_D.has(p.id) && p.id !== tackler.id);
                                  if (secondTackler) {
                                       gameLog.push(`Brought down by ${secondTackler.name}.`);
                                       secondTackler.gameStats.tackles = (secondTackler.gameStats.tackles || 0) + 1;
                                  } else {
                                       gameLog.push(`And he's loose!`); // No one left
                                  }
                             } else { // Tackled
                                 gameLog.push(`${ballCarrier.name} tackled by ${tackler.name}.`);
                                 tackler.gameStats.tackles = (tackler.gameStats.tackles || 0) + 1;
                             }
                         } else { // No immediate tackler
                             const extraYards = getRandomInt(10, 25 + Math.round((ballCarrier.attributes.physical.speed || 50) / 5)); // More YAC for faster players
                             yards += extraYards;
                             gameLog.push(`${target.name} finds open space for +${extraYards} yards.`);
                         }
                     } else { // --- Catch Failure (Incomplete or Interception) ---
                         // Interception check (higher chance if defender has good hands and catchDiff was close)
                         if (primaryDefender && ((primaryDefender.attributes.technical.catchingHands || 0) / 100) > (Math.random() * (2.5 + catchDiff / 10 ))) { // Higher chance if catchDiff negative
                             gameLog.push(`INTERCEPTION! Picked off by ${primaryDefender.name}!`);
                             primaryDefender.gameStats.interceptions = (primaryDefender.gameStats.interceptions || 0) + 1;
                             turnover = true;
                         } else {
                             // Dropped pass or defended
                              gameLog.push(`INCOMPLETE pass to ${target.name}. ${primaryDefender ? `Defended by ${primaryDefender.name}.` : 'Dropped.'}`);
                             incomplete = true;
                         }
                     }
                 } // End QB Decision Block
             }

            // --- Sack Check (if pressure occurred and ball not thrown) ---
            if (!ballThrown && pressure && !sack && rusherWhoWon) {
                 checkInGameInjury(qb, gameLog); // Injury check on sack attempt
                 checkInGameInjury(rusherWhoWon, gameLog);
                // QB Evade vs Rusher Contain
                const evadePower = ((qb.attributes.physical.agility || 0) + (qb.attributes.physical.speed || 0)/2) * getFatigueModifier(qb);
                const containPower = ((rusherWhoWon.attributes.physical.agility || 0) + (rusherWhoWon.attributes.physical.speed || 0)/2) * getFatigueModifier(rusherWhoWon);
                const evadeDiff = evadePower - (containPower + getRandomInt(-10, 10));

                if (evadeDiff <= 0) { // Rusher contains QB
                    // QB Strength vs Rusher Tackle/Strength
                    const breakSackPower = (qb.attributes.physical.strength || 0) * getFatigueModifier(qb);
                    const sackPower = ((rusherWhoWon.attributes.physical.strength || 0) + (rusherWhoWon.attributes.technical.tackling || 0)) * getFatigueModifier(rusherWhoWon);
                    const sackDiff = breakSackPower - (sackPower + getRandomInt(-15, 15));

                    if (sackDiff <= 0) { // Sack successful
                        sack = true;
                        yards = -getRandomInt(4, 9); // Yard loss
                        gameLog.push(`SACK! ${rusherWhoWon.name} brings down ${qb.name} for a loss of ${Math.abs(yards)} yards.`);
                        rusherWhoWon.gameStats.sacks = (rusherWhoWon.gameStats.sacks || 0) + 1;
                        rusherWhoWon.gameStats.tackles = (rusherWhoWon.gameStats.tackles || 0) + 1;
                        playIsLive = false; // Play ends on sack
                    } else { // QB breaks initial tackle attempt
                        // gameLog.push(`${qb.name} shrugs off ${rusherWhoWon.name}!`); // Optional log
                        pressure = false; // Pressure relieved momentarily
                        rusherWhoWon = null; // Rusher failed
                    }
                } else { // QB evades initial pressure
                    // gameLog.push(`${qb.name} scrambles away from ${rusherWhoWon.name}.`); // Optional log
                    pressure = false; // Pressure relieved momentarily
                    rusherWhoWon = null;
                }
            } // End Sack Check

        } // --- End PASS PLAY TICKS ---

        // --- (B) RUN PLAY TICKS ---
        else if (type === 'run') {
            if (!ballCarrier) { playIsLive = false; turnover = true; break; } // Should have been caught earlier, but safety check

            // Tick 1: Line Battle & Initial Yards
            if (tick === 1) {
                checkInGameInjury(ballCarrier, gameLog); // Injury check
                let lineWins = 0, lineContests = 0;
                // Resolve all blocking battles at the line
                battleStates.runBlock.forEach(b => {
                    checkInGameInjury(b.blocker, gameLog);
                    checkInGameInjury(b.defender, gameLog);
                    const blockPower = ((b.blocker.attributes.technical.blocking || 0) + (b.blocker.attributes.physical.strength || 0)) * getFatigueModifier(b.blocker);
                    const shedPower = ((b.defender.attributes.technical.blockShedding || 0) + (b.defender.attributes.physical.strength || 0)) * getFatigueModifier(b.defender);
                    resolveBattle(blockPower, shedPower, b, gameLog, `Run Block: ${b.blocker.name} vs ${b.defender.name}`);
                    if (b.status === 'win_A') lineWins++; // Blocker wins
                    lineContests++;
                });

                // Determine initial gain based on blocking success rate
                const blockWinPercent = lineContests > 0 ? (lineWins / lineContests) : 0.5; // Assume 50% if no blocks occurred
                if (blockWinPercent > 0.65) { yards = getRandomInt(4, 8); gameLog.push(`Big hole opens up! ${ballCarrier.name} bursts through.`); }
                else if (blockWinPercent > 0.35) { yards = getRandomInt(1, 4); gameLog.push(`${ballCarrier.name} finds a small crease.`); }
                else { yards = getRandomInt(-2, 1); gameLog.push(`Run stuffed near the line of scrimmage!`); playIsLive = false; } // Stop play if stuffed

                 // Apply run zone adjustment (outside runs potentially gain/lose more)
                 if (zone === ZONES.RUN_L || zone === ZONES.RUN_R) {
                     yards += getRandomInt(-1, 2); // Slightly more variance for outside runs
                 }

            } // End Tick 1 (Line Battle)

            // Tick 2: Second Level (Linebackers)
            if (tick === 2 && playIsLive) {
                // Find potential tackler from LBs not involved in resolved blocks or already used
                const secondLevelDefenders = lbs.filter(p => p && !usedPlayerIds_D.has(p.id) && !battleStates.runBlock.some(b => b.defender.id === p.id && b.status !== 'win_B'));
                const tacklerLB = getRandom(secondLevelDefenders);

                if (!tacklerLB) { // No LB meets the runner
                    const extraYards = getRandomInt(5, 10 + Math.round((ballCarrier.attributes.physical.speed || 0)/10));
                    yards += extraYards;
                    gameLog.push(`${ballCarrier.name} breaks into the secondary! +${extraYards} yards.`);
                } else { // LB attempts tackle
                    checkInGameInjury(tacklerLB, gameLog);
                    usedPlayerIds_D.add(tacklerLB.id); // Mark LB as used
                    // Contest: RB Agility/Strength vs LB Tackle/Strength
                    const breakTacklePower = ((ballCarrier.attributes.physical.agility || 0) + (ballCarrier.attributes.physical.strength || 0)/2) * getFatigueModifier(ballCarrier);
                    const tacklePower = ((tacklerLB.attributes.technical.tackling || 0) + (tacklerLB.attributes.physical.strength || 0)/2) * getFatigueModifier(tacklerLB);
                    const tackleDiff = breakTacklePower - (tacklePower + getRandomInt(-20, 20));

                    if (tackleDiff > TACKLE_THRESHOLD) { // Broken tackle
                        const extraYards = getRandomInt(3, 8 + Math.round(breakTacklePower / 15));
                        yards += extraYards;
                        gameLog.push(`${ballCarrier.name} shakes off ${tacklerLB.name} for +${extraYards} yards!`);
                    } else if (tackleDiff < -TACKLE_THRESHOLD) { // Solid tackle
                        gameLog.push(`Stopped by ${tacklerLB.name}.`);
                        tacklerLB.gameStats.tackles = (tacklerLB.gameStats.tackles || 0) + 1;
                        playIsLive = false; // Play ends
                    } else { // Dragged down after short gain
                        const dragYards = getRandomInt(1, 3);
                        yards += dragYards;
                        gameLog.push(`${ballCarrier.name} drags ${tacklerLB.name} for ${dragYards} more yards.`);
                        tacklerLB.gameStats.tackles = (tacklerLB.gameStats.tackles || 0) + 1;
                        playIsLive = false; // Play ends
                    }
                }
            } // End Tick 2 (Linebackers)

            // Tick 3: Third Level (Defensive Backs / Safety)
            if (tick === 3 && playIsLive) {
                // Find potential tackler from DBs
                const thirdLevelDefenders = dbs.filter(p => p && !usedPlayerIds_D.has(p.id));
                const tacklerDB = getRandom(thirdLevelDefenders);

                if (!tacklerDB) { // No DB in position -> potential long gain/TD
                    const extraYards = getRandomInt(10, 30 + Math.round((ballCarrier.attributes.physical.speed || 0)/5));
                    yards += extraYards;
                    gameLog.push(`${ballCarrier.name} is loose! Room to run for +${extraYards} yards.`);
                    playIsLive = false; // End play after big gain (assume caught eventually or TD)
                } else { // DB attempts tackle
                     checkInGameInjury(tacklerDB, gameLog);
                     usedPlayerIds_D.add(tacklerDB.id);
                    // Contest: RB Speed vs DB Speed/Tackle
                    const runSpeedPower = (ballCarrier.attributes.physical.speed || 0) * getFatigueModifier(ballCarrier);
                    const chasePower = ((tacklerDB.attributes.physical.speed || 0) + (tacklerDB.attributes.technical.tackling || 0)/2) * getFatigueModifier(tacklerDB);
                    const chaseDiff = runSpeedPower - (chasePower + getRandomInt(-15, 15));

                    if (chaseDiff > 0) { // RB outruns DB
                        const extraYards = getRandomInt(8, 20 + Math.round(chaseDiff));
                        yards += extraYards;
                        gameLog.push(`${ballCarrier.name} outruns ${tacklerDB.name} for +${extraYards} yards!`);
                    } else { // DB makes the tackle
                         gameLog.push(`Caught from behind by ${tacklerDB.name}.`);
                         tacklerDB.gameStats.tackles = (tacklerDB.gameStats.tackles || 0) + 1;
                    }
                    playIsLive = false; // Play ends after third level encounter
                }
            } // End Tick 3 (Defensive Backs)

            // Safety break: end run play after max 3-4 ticks
            if (tick >= 4 && playIsLive) {
                 // gameLog.push(`Run play concludes.`); // Optional log
                 playIsLive = false;
            }

        } // --- End RUN PLAY TICKS ---

        // Safety break from loop if play ended
        if (!playIsLive) break;

    } // --- ====== END TICK LOOP ====== ---


    // --- Post-Play Resolution & Stat Assignment ---
    const finalYards = yards;
    // Touchdown if not a turnover and final position is >= 100
    const scoredTD = !turnover && !sack && (ballOn + finalYards) >= 100;

    if (scoredTD) {
        touchdown = true;
        // Assign TD stat based on play type
        if (type === 'run' && ballCarrier) {
            ballCarrier.gameStats.touchdowns = (ballCarrier.gameStats.touchdowns || 0) + 1;
            // Ensure TD run yards are capped at the endzone
             const yardsToTD = 100 - ballOn;
             ballCarrier.gameStats.rushYards = (ballCarrier.gameStats.rushYards || 0) + yardsToTD;
        } else if (type === 'pass' && ballThrown && !incomplete && ballCarrier) { // ballCarrier here is the receiver after YAC
             ballCarrier.gameStats.touchdowns = (ballCarrier.gameStats.touchdowns || 0) + 1;
              const yardsToTD = 100 - ballOn;
              const yacYards = Math.max(0, finalYards - (yardsToTD > 0 ? yardsToTD : 0)); // Calculate YAC more accurately
              const passAirYards = yardsToTD - yacYards; // Yards gained before TD minus YAC
              ballCarrier.gameStats.recYards = (ballCarrier.gameStats.recYards || 0) + yardsToTD;
              if (qb) qb.gameStats.passYards = (qb.gameStats.passYards || 0) + passAirYards; // Only air yards for QB
        }
         // Note: QB Sneak TD handled earlier
    } else if (!turnover && !sack) {
        // Assign regular yardage stats if no TD
        if (type === 'run' && ballCarrier) {
            ballCarrier.gameStats.rushYards = (ballCarrier.gameStats.rushYards || 0) + finalYards;
        } else if (type === 'pass' && ballThrown && !incomplete && ballCarrier) { // ballCarrier is receiver
            ballCarrier.gameStats.recYards = (ballCarrier.gameStats.recYards || 0) + finalYards;
            if (qb) qb.gameStats.passYards = (qb.gameStats.passYards || 0) + finalYards; // QB gets full pass yards if not TD
        }
         // Note: QB Sneak non-TD yards handled earlier
    }
     // Sack yardage is negative, handled implicitly by adding `finalYards` (which is negative) if needed,
     // but sack stats (tackles, sacks) were assigned during the tick loop.

    return { yards: finalYards, touchdown, turnover, incomplete, log: gameLog };
}


/**
 * Simulates a full game between two teams.
 * @param {object} homeTeam - The home team object.
 * @param {object} awayTeam - The away team object.
 * @returns {object} Result object { homeTeam, awayTeam, homeScore, awayScore, gameLog, breakthroughs }.
 */
export function simulateGame(homeTeam, awayTeam) {
    resetGameStats(); // Clear stats from previous game/week
    aiSetDepthChart(homeTeam); // Ensure depth charts are set before game
    aiSetDepthChart(awayTeam);

    const gameLog = [];
    let homeScore = 0;
    let awayScore = 0;
    const weather = getRandom(['Sunny', 'Windy', 'Rain']); // Random weather
    gameLog.push(`Weather: ${weather}`);

    const breakthroughs = []; // Track player improvements during the game
    const totalDrivesPerHalf = getRandomInt(7, 9); // Fewer drives per half
    let currentHalf = 1;
    let drivesThisGame = 0;
    // Randomize who gets the ball first
    let possession = Math.random() < 0.5 ? homeTeam : awayTeam;
    let gameForfeited = false;

    // --- Game Loop (Drives) ---
    while (drivesThisGame < totalDrivesPerHalf * 2 && !gameForfeited) {
        // --- Halftime Logic ---
        if (drivesThisGame === totalDrivesPerHalf) {
            currentHalf = 2;
            gameLog.push(`==== HALFTIME ====`);
            // Switch possession for second half kickoff
            possession = (possession.id === homeTeam.id) ? awayTeam : homeTeam;
            // Reset fatigue at halftime
            [...homeTeam.roster, ...awayTeam.roster].forEach(p => { if (p) p.fatigue = Math.max(0, p.fatigue - 50); }); // Recover some fatigue
        }

        const defense = (possession.id === homeTeam.id) ? awayTeam : homeTeam;

        // --- Forfeit Check (less than 7 healthy players) ---
        const checkRoster = (team) => team.roster.filter(p => p.status.duration === 0).length < 7;
        if (checkRoster(possession) || checkRoster(defense)) {
            const forfeitingTeam = checkRoster(possession) ? possession : defense;
            const winningTeam = forfeitingTeam === possession ? defense : possession;
            gameLog.push(`${forfeitingTeam.name} cannot field a full team and forfeits.`);
            if (winningTeam === homeTeam) { homeScore = 21; awayScore = 0; }
            else { homeScore = 0; awayScore = 21; }
            gameForfeited = true;
            break; // End game immediately on forfeit
        }
        // --- End Forfeit Check ---

        // --- Drive Setup ---
        let ballOn = 20; // Start drive at 20 yard line
        let down = 1;
        let yardsToGo = 10;
        let driveActive = true;
        gameLog.push(`-- Drive ${drivesThisGame + 1} (H${currentHalf}): ${possession.name} starts at their 20 --`);
        // --- End Drive Setup ---

        // --- Play Loop (Downs) ---
        while (driveActive && down <= 4) {

            // --- REMOVED PENALTY CHECK ---

            // Determine play call
            const scoreDiff = possession.id === homeTeam.id ? homeScore - awayScore : awayScore - homeScore;
            const drivesRemainingInGame = (totalDrivesPerHalf * 2) - drivesThisGame;
            const playKey = determinePlayCall(possession, defense, down, yardsToGo, ballOn, scoreDiff, gameLog, drivesRemainingInGame);
            // Resolve the play using the tick-based engine
            const result = resolvePlay(possession, defense, playKey, { gameLog, weather, down, yardsToGo, ballOn });

            // Update game state based on play result
            ballOn += result.yards;
            ballOn = Math.max(0, Math.min(100, ballOn)); // Keep ball on field

            if (result.turnover) {
                gameLog.push(`Turnover! ${defense.name} takes over.`);
                driveActive = false; // End drive
            } else if (result.touchdown || (ballOn >= 100 && !result.incomplete && !result.turnover)) { // TD condition
                gameLog.push(`TOUCHDOWN ${possession.name}!`);
                ballOn = 100; // Ensure ball is marked at 100 for TD

                // Simple 1 or 2 point conversion attempt
                const goesForTwo = Math.random() > 0.6; // Less likely to go for 2
                const conversionSuccess = Math.random() > (goesForTwo ? 0.55 : 0.15); // Harder conversions

                if (conversionSuccess) {
                    const points = goesForTwo ? 2 : 1;
                    gameLog.push(`${points}-point conversion GOOD!`);
                    if (possession.id === homeTeam.id) homeScore += (6 + points); else awayScore += (6 + points);
                } else {
                    gameLog.push(`Conversion FAILED!`);
                    if (possession.id === homeTeam.id) homeScore += 6; else awayScore += 6; // Only TD points
                }
                driveActive = false; // End drive after TD + conversion attempt
            } else if (result.incomplete) {
                 down++; // Advance down on incomplete pass
            } else { // Completed pass, run, or non-turnover sack
                 yardsToGo -= result.yards;
                 if (yardsToGo <= 0) { // First down achieved
                     down = 1;
                     yardsToGo = 10;
                     // Ensure ball isn't past the 90 for '1st & 10' callout
                     if (ballOn < 90) gameLog.push(`First down! (${possession.name} at the ${100 - ballOn})`);
                     else gameLog.push(`First down! (${possession.name} inside the 10)`);
                 } else { // No first down, advance down
                     down++;
                 }
            }

            // Check for turnover on downs
            if (down > 4 && driveActive) { // Need driveActive check here too
                gameLog.push(`Turnover on downs! ${defense.name} takes over.`);
                driveActive = false;
            }
        } // --- End Play Loop (Downs) ---

        drivesThisGame++; // Increment drive count
        possession = (possession.id === homeTeam.id) ? awayTeam : homeTeam; // Switch possession

    } // --- End Game Loop (Drives) ---

    gameLog.push(`==== FINAL ====`);

    // Assign Wins/Losses (only if not forfeited, scores set during forfeit)
    if (!gameForfeited) {
        if (homeScore > awayScore) { homeTeam.wins++; awayTeam.losses++; }
        else if (awayScore > homeScore) { awayTeam.wins++; homeTeam.losses++; }
        // Ties are possible but not explicitly handled with W/L update
    }

    // --- Post-Game Player Progression & Stat Aggregation ---
    [...homeTeam.roster, ...awayTeam.roster].forEach(p => {
        if (!p) return;

        // Simple breakthrough chance for young players with good games
        if (p.age < 14 && (p.gameStats.touchdowns >= 2 || p.gameStats.passYards > 150 || p.gameStats.recYards > 80 || p.gameStats.tackles > 5 || p.gameStats.sacks > 1)) {
            const attributesToImprove = ['speed', 'strength', 'agility', 'throwingAccuracy', 'catchingHands', 'tackling', 'blocking', 'playbookIQ', 'blockShedding', 'toughness'];
            const attr = getRandom(attributesToImprove);
            let improved = false;
            for (const cat in p.attributes) {
                if (p.attributes[cat][attr] !== undefined && p.attributes[cat][attr] < 99) {
                    p.attributes[cat][attr]++;
                    p.breakthroughAttr = attr; // Flag for UI notification
                    breakthroughs.push({ player: p, attr, teamName: p.teamId === homeTeam.id ? homeTeam.name : awayTeam.name });
                    improved = true;
                    break;
                }
            }
            // if(improved) console.log(`Breakthrough: ${p.name} improved ${attr}`); // Optional log
        }

        // Aggregate game stats into season and career totals
        for (const stat in p.gameStats) {
            p.seasonStats[stat] = (p.seasonStats[stat] || 0) + p.gameStats[stat];
            p.careerStats[stat] = (p.careerStats[stat] || 0) + p.gameStats[stat];
        }
    });

    return { homeTeam, awayTeam, homeScore, awayScore, gameLog, breakthroughs };
}


/** Decrements duration of player statuses (injuries, etc.). */
function updatePlayerStatuses() {
    for (const player of game.players) {
        // Decrement status duration if active
        if (player.status.duration > 0) {
            player.status.duration--;
            // If duration reaches 0, reset to healthy
            if (player.status.duration === 0) {
                player.status.type = 'healthy';
                player.status.description = '';
            }
        }
        // Clear flags used for UI notifications
        if (player.breakthroughAttr) { delete player.breakthroughAttr; }
        if (player.status.isNew) { player.status.isNew = false; }
    }
}

/** Removes temporary players (friends) at the end of the week. */
function endOfWeekCleanup() {
    game.teams.forEach(team => {
        team.roster = team.roster.filter(p => p.status.type !== 'temporary');
    });
}

/** Generates random weekly events (injuries, unavailability). */
function generateWeeklyEvents() {
    for (const player of game.players) {
        // Only affect healthy players
        if (player.status.type === 'healthy') {
            for (const event of weeklyEvents) {
                if (Math.random() < event.chance) {
                    player.status.type = event.type;
                    player.status.description = event.description;
                    player.status.duration = getRandomInt(event.minDuration, event.maxDuration);
                    player.status.isNew = true; // Flag for UI notification
                    // Notify player if it's their team member
                    if (player.teamId === game.playerTeam?.id) { // Safety check for playerTeam
                        addMessage('Player Status Update', `${player.name} will be unavailable for ${player.status.duration} week(s): ${player.status.description}`);
                    }
                    break; // Player can only have one event per week
                }
            }
        }
    }
}

/** Simulates all games for the current week and advances the week counter. */
export function simulateWeek() {
    if (game.currentWeek >= 9) { // 9 weeks in the season (0-8)
        console.log("Simulate Week: End of season. Returning null.");
        return null; // Indicate season end
    }

    // --- Week Start ---
    endOfWeekCleanup(); // Remove temporary players
    updatePlayerStatuses(); // Update injury durations
    generateWeeklyEvents(); // Apply new injuries/absences
    game.breakthroughs = []; // Reset breakthroughs for the new week
    // --- End Week Start ---

    // Calculate schedule indices for the current week
    const gamesPerWeek = game.teams.length / 2;
    const startIndex = game.currentWeek * gamesPerWeek;
    const endIndex = startIndex + gamesPerWeek;

    console.log(`Simulating Week ${game.currentWeek + 1}: Games ${startIndex + 1} to ${endIndex}. Total schedule length: ${game.schedule.length}`);

    // Get games for the current week
    const weeklyGames = game.schedule.slice(startIndex, endIndex);

    if (!weeklyGames || weeklyGames.length === 0) {
        console.error(`CRITICAL ERROR: No games found for week ${game.currentWeek + 1} (indices ${startIndex}-${endIndex}).`);
        // Attempt to advance week anyway to prevent getting stuck?
        // game.currentWeek++;
        return []; // Return empty results if no games
    }

    console.log(`Found ${weeklyGames.length} games to simulate for Week ${game.currentWeek + 1}.`);

    // Simulate each game
    const results = weeklyGames.map(match => {
        // Ensure teams exist before simulating
        if (!match.home || !match.away) {
             console.error(`Skipping game due to missing team:`, match);
             return null; // Skip simulation if teams are invalid
        }
        const result = simulateGame(match.home, match.away);
        // Process breakthroughs for player notifications
        if (result.breakthroughs) {
            result.breakthroughs.forEach(b => {
                // Check if playerTeam exists before accessing id
                if (b.player.teamId === game.playerTeam?.id) {
                    addMessage("Player Breakthrough!", `${b.player.name} improved ${b.attr} after the game!`);
                }
            });
            game.breakthroughs.push(...result.breakthroughs); // Store all breakthroughs
        }
        return result;
    }).filter(Boolean); // Filter out any null results from skipped games

    // Add valid results to the season's game results
    game.gameResults.push(...results);
    game.currentWeek++; // Advance to the next week
    console.log(`Week ${game.currentWeek} simulation complete. Advanced to week ${game.currentWeek + 1}.`);

    return results; // Return the results of the simulated week
}

/** Generates a list of available free agents for the week. */
export function generateWeeklyFreeAgents() {
    // Find players without a team
    const undraftedPlayers = game.players.filter(p => !p.teamId);
    game.freeAgents = []; // Clear previous week's FAs
    const numFreeAgents = 5; // Offer 5 FAs per week

    for (let i = 0; i < numFreeAgents; i++) {
        if (undraftedPlayers.length > 0) {
            // Select a random undrafted player
            const faIndex = getRandomInt(0, undraftedPlayers.length - 1);
            const fa = undraftedPlayers.splice(faIndex, 1)[0]; // Remove from pool
            // Assign a random relationship (for 'Call Friend' mechanic)
            fa.relationship = getRandom(['Best Friend', 'Good Friend', 'Acquaintance']);
            game.freeAgents.push(fa);
        } else {
            break; // Stop if no more undrafted players
        }
    }
}

/** Handles the player attempting to call a free agent friend. */
export function callFriend(playerId) {
    const team = game.playerTeam;
    // Condition: Can only call if someone is injured/busy
    if (!team.roster.some(p => p.status.duration > 0)) {
        return { success: false, message: "You can only call a friend if a player on your team is currently injured or busy." };
    }

    const player = game.freeAgents.find(p => p.id === playerId);
    if (!player) return { success: false, message: "That player is no longer available this week." };

    // Success chance based on relationship
    const successRates = { 'Best Friend': 0.9, 'Good Friend': 0.6, 'Acquaintance': 0.3 };
    const successChance = successRates[player.relationship] || 0.3; // Default chance

    // Remove player from free agents regardless of success
    game.freeAgents = game.freeAgents.filter(p => p.id !== playerId);

    if (Math.random() < successChance) {
        // Success: Add player temporarily
        player.status = { type: 'temporary', description: 'Helping Out', duration: 1 }; // Status indicates temporary
        team.roster.push(player);
        const message = `${player.name} (${player.relationship}) agreed to help out for the next game!`;
        addMessage("Roster Update: Friend Called", message);
        return { success: true, message };
    } else {
        // Failure
        const message = `${player.name} (${player.relationship}) couldn't make it this week.`;
        addMessage("Roster Update: Friend Called", message);
        return { success: false, message };
    }
}


/** AI logic for potentially signing temporary free agents if roster is short. */
export function aiManageRoster(team) {
    const healthyCount = team.roster.filter(p => p.status.duration === 0).length;

    // Only sign if below minimum players (7) and FAs are available
    if (healthyCount < 7 && game.freeAgents.length > 0) {
        // Find the best available FA based on coach preference
        const bestFA = game.freeAgents.reduce((best, p) => getPlayerScore(p, team.coach) > getPlayerScore(best, team.coach) ? p : best, game.freeAgents[0]);

        // AI uses same success chance as player
        const successRates = { 'Best Friend': 0.9, 'Good Friend': 0.6, 'Acquaintance': 0.3 };
        const successChance = successRates[bestFA.relationship] || 0.3;

        // Remove FA from pool regardless of success
        game.freeAgents = game.freeAgents.filter(p => p.id !== bestFA.id);

        if (Math.random() < successChance) {
            bestFA.status = { type: 'temporary', description: 'Helping Out', duration: 1 };
            team.roster.push(bestFA);
            console.log(`${team.name} signed temporary player ${bestFA.name}`); // Log AI action
        }
    }
}

/** Applies attribute improvements to a player based on age/potential. */
function developPlayer(player) {
    const developmentReport = { player, improvements: [] };
    // Potential points decrease with age
    let potentialPoints = player.age < 12 ? getRandomInt(2, 5) : player.age < 16 ? getRandomInt(1, 3) : getRandomInt(0, 1);
    const attributesToImprove = ['speed', 'strength', 'agility', 'throwingAccuracy', 'catchingHands', 'tackling', 'blocking', 'playbookIQ', 'blockShedding', 'toughness', 'consistency']; // Added consistency

    // Distribute potential points randomly among attributes
    for (let i = 0; i < potentialPoints; i++) {
        const attrToBoost = getRandom(attributesToImprove);
        let boosted = false;
        for (const category in player.attributes) {
            if (player.attributes[category][attrToBoost] !== undefined && player.attributes[category][attrToBoost] < 99) {
                const increase = 1; // Simple +1 increase per point
                player.attributes[category][attrToBoost] += increase;
                // Track improvements for the report
                const existing = developmentReport.improvements.find(imp => imp.attr === attrToBoost);
                if (existing) existing.increase += increase;
                else developmentReport.improvements.push({ attr: attrToBoost, increase });
                boosted = true;
                break; // Boosted one attribute, move to next potential point
            }
        }
    }

    // Physical growth (height/weight) slows down with age
    const heightGain = player.age <= 12 ? getRandomInt(1, 3) : player.age <= 15 ? getRandomInt(0, 2) : getRandomInt(0, 1);
    const weightGain = player.age <= 12 ? getRandomInt(5, 15) : player.age <= 15 ? getRandomInt(3, 10) : getRandomInt(1, 5);
    if (heightGain > 0) developmentReport.improvements.push({ attr: 'height', increase: heightGain });
    if (weightGain > 0) developmentReport.improvements.push({ attr: 'weight', increase: weightGain });

    player.attributes.physical.height += heightGain;
    player.attributes.physical.weight += weightGain;

    return developmentReport; // Return report for player's team
}

/** Handles offseason logic: aging, development, retirement, departures, new rookies. */
export function advanceToOffseason() {
    game.year++;
    const retiredPlayers = [];
    const hofInductees = [];
    const developmentResults = []; // Only for player's team
    const leavingPlayers = []; // Track departures for summary
    let totalVacancies = 0; // Count open roster spots

    // Reset draft needs for all teams
    game.teams.forEach(team => team.draftNeeds = 0);

    game.teams.forEach(team => {
        const currentRoster = [...team.roster]; // Copy roster before modifying
        team.roster = []; // Clear roster to rebuild with returning players

        currentRoster.forEach(player => {
            player.age++;
            player.careerStats.seasonsPlayed++;

            // Apply development (only store report for player's team)
            const devReport = developPlayer(player);
            if (team.id === game.playerTeam?.id) { // Check playerTeam exists
                developmentResults.push(devReport);
            }

            let playerIsLeaving = false;

            // Retirement/Graduation Check
            if (player.age >= 18) {
                retiredPlayers.push(player);
                playerIsLeaving = true;
                if (team.id === game.playerTeam?.id) {
                    addMessage("Player Retires", `${player.name} has graduated and is leaving the team.`);
                }
                // Hall of Fame Check (simple criteria)
                if (player.careerStats.touchdowns > 25 || player.careerStats.passYards > 6000 || player.careerStats.tackles > 250 || player.careerStats.sacks > 30) {
                    game.hallOfFame.push(player);
                    hofInductees.push(player);
                    if (team.id === game.playerTeam?.id) {
                        addMessage("Hall of Fame Induction!", `${player.name} has been inducted into the Backyard Hall of Fame!`);
                    }
                }
            } else { // Check for random departures (moving, quitting, etc.)
                for (const event of offseasonDepartureEvents) {
                    if (Math.random() < event.chance) {
                        leavingPlayers.push({ player, reason: event.reason, teamName: team.name });
                        playerIsLeaving = true;
                        if (team.id === game.playerTeam?.id) {
                            addMessage("Player Leaving", `${player.name} is leaving the team: ${event.reason}.`);
                        }
                        break; // Only one departure event per player
                    }
                }
                // Small chance player asks to leave player's team specifically
                if (!playerIsLeaving && team.id === game.playerTeam?.id && Math.random() < transferEventChance) {
                    leavingPlayers.push({ player, reason: 'Asked to leave', teamName: team.name });
                    playerIsLeaving = true;
                    addMessage("Transfer Request", `${player.name} asked to leave the team and has departed.`);
                }
            }

            // Keep player or process departure
            if (!playerIsLeaving) {
                // Reset season stats and status for returning player
                player.seasonStats = { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0, sacks: 0, interceptions: 0 };
                player.status = { type: 'healthy', description: '', duration: 0 };
                team.roster.push(player); // Add back to roster
            } else {
                player.teamId = null; // Mark as undrafted/retired
                team.draftNeeds++; // Increment team's draft needs
                totalVacancies++;
            }
        }); // End player loop

        // Reset team stats and depth chart after roster changes
        // Important: Reset depth chart AFTER processing all players for the team
         if (team.depthChart) {
             const offenseSlots = offenseFormations[team.formations.offense]?.slots || [];
             const defenseSlots = defenseFormations[team.formations.defense]?.slots || [];
             team.depthChart.offense = Object.fromEntries(offenseSlots.map(s => [s, null]));
             team.depthChart.defense = Object.fromEntries(defenseSlots.map(s => [s, null]));
             // Re-run AI depth chart setting with the updated roster
             aiSetDepthChart(team);
         } else {
              console.warn(`Team ${team.name} missing depthChart object during offseason.`);
         }

        team.wins = 0; // Reset W/L record
        team.losses = 0;

    }); // End team loop

    // Chance for a new player to join the player's team if roster is not full
    const undraftedYoungPlayers = game.players.filter(p => !p.teamId && p.age < 17);
    if (game.playerTeam && game.playerTeam.roster.length < 10 && Math.random() < joinRequestChance && undraftedYoungPlayers.length > 0) {
        const joiningPlayer = getRandom(undraftedYoungPlayers);
        addPlayerToTeam(joiningPlayer, game.playerTeam);
        game.playerTeam.draftNeeds = Math.max(0, game.playerTeam.draftNeeds - 1); // Reduce draft need
        totalVacancies--; // Decrement overall count
        addMessage("New Player Joined!", `${joiningPlayer.name} heard about your team and asked to join!`);
        aiSetDepthChart(game.playerTeam); // Update depth chart after new joiner
    }

    addMessage("Offseason Summary", `Offseason complete. ${totalVacancies} roster spots opened across the league. Preparing for the draft.`);

    // Generate new rookie players to fill the pool based on vacancies
    const rookieCount = Math.max(totalVacancies, game.teams.length); // Ensure at least enough for one per team if vacancies low
    console.log(`Generating ${rookieCount} new rookie players.`);
    for (let i = 0; i < rookieCount; i++) game.players.push(generatePlayer(8, 10)); // Generate young rookies

    // Clear previous season results
    game.gameResults = [];
    game.breakthroughs = [];

    // Return report for UI display
    return { retiredPlayers, hofInductees, developmentResults, leavingPlayers };
}


/** Updates the player's depth chart based on drag-and-drop. */
export function updateDepthChart(playerId, newPositionSlot, side) {
    const team = game.playerTeam;
    if (!team || !team.depthChart || !team.depthChart[side]) return; // Safety checks
    const chart = team.depthChart[side];

    // Find if the dropped player was already starting somewhere else on this side
    const oldSlot = Object.keys(chart).find(key => chart[key] === playerId);
    // Find if the target slot was occupied
    const displacedPlayerId = chart[newPositionSlot];

    // Place the dropped player in the new slot
    chart[newPositionSlot] = playerId;

    // Handle the displaced player and the old slot
    if (oldSlot) {
        // If the dropped player came from another slot, put the displaced player there, or null if target was empty
        chart[oldSlot] = displacedPlayerId || null;
    } else if (displacedPlayerId) {
         // If dropped player came from the bench, and displaced someone, the displaced player goes to bench
         // (implicitly handled as they are no longer in the chart map for this side)
         // No explicit action needed here, re-rendering will handle it.
         console.log(`Player ${displacedPlayerId} moved to bench from ${newPositionSlot}`);
    }
     // If dropped from bench to empty slot, no further action needed.

     // Note: Re-rendering the depth chart UI is handled by the caller (switchTab)
}


/** Changes the player team's formation for offense or defense. */
export function changeFormation(side, formationName) {
    const team = game.playerTeam;
    const formation = side === 'offense' ? offenseFormations[formationName] : defenseFormations[formationName];
    if (!formation || !team) return; // Exit if formation or team not found

    team.formations[side] = formationName; // Update team's selected formation

    // Create a new empty depth chart based on the new formation's slots
    const newChart = Object.fromEntries(formation.slots.map(slot => [slot, null]));
    team.depthChart[side] = newChart; // Replace the old chart structure

    // Re-run AI depth chart logic to intelligently fill the new slots with the current roster
    // NOTE: This uses the AI logic; could potentially preserve *some* existing assignments if desired later.
    aiSetDepthChart(team);
    console.log(`${side} formation changed to ${formationName}, depth chart reset and refilled.`);

    // Note: Re-rendering the depth chart UI is handled by the caller (switchTab)
}


/** Returns the current game state object. */
export function getGameState() { return game; }

/** Returns the breakthroughs from the most recent week/game. */
export function getBreakthroughs() { return game.breakthroughs || []; }

/** Marks a specific message as read. */
export function markMessageAsRead(messageId) {
    const message = game.messages?.find(m => m.id === messageId);
    if (message) { message.isRead = true; }
}

// --- Potentially add Player Cut/Sign actions here if needed from Dashboard ---
// export function playerCut(playerId) { ... }
// export function playerSignFreeAgent(playerId) { ... }

