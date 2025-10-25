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
                if (attr === 'weight') value = value / 2.5;
                if (attr === 'height') value = (value - 60);
                score += value * relevantWeights[attr];
            }
        }
    }

    return Math.min(99, Math.max(1, Math.round(score)));
}

/**
 * NEW: Calculate a player's suitability for a *specific* formation slot based on priorities in data.js.
 */
function calculateSlotSuitability(player, slot, side, team) {
    const formationName = team.formations[side];
    const formationData = side === 'offense' ? offenseFormations[formationName] : defenseFormations[formationName];
    // Fallback if slot-specific priorities aren't defined
    if (!formationData || !formationData.slotPriorities || !formationData.slotPriorities[slot]) {
        return calculateOverall(player, slot.replace(/\d/g, ''));
    }

    const priorities = formationData.slotPriorities[slot];
    let score = 0;
    let totalWeight = 0;

    // Calculate score based on weighted priorities for this slot
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
                break;
            }
        }
    }
    
    // Add a fraction of the general overall score to ensure well-rounded players are still valued
    const baseOverall = calculateOverall(player, slot.replace(/\d/g, ''));
    const finalScore = (score / (totalWeight || 1)) * 0.7 + (baseOverall * 0.3); // 70% slot, 30% general

    return Math.min(99, Math.max(1, Math.round(finalScore)));
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
        mental: { playbookIQ: getRandomInt(30, 70), clutch: getRandomInt(20, 90), consistency: getRandomInt(40, 80), toughness: getRandomInt(50, 95) },
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

    const initialStats = { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0, sacks: 0, interceptions: 0 };

    return { id: crypto.randomUUID(), name: `${firstName} ${lastName}`, age, favoriteOffensivePosition, favoriteDefensivePosition, attributes, teamId: null, status: { type: 'healthy', description: '', duration: 0 }, fatigue: 0, gameStats: { ...initialStats }, seasonStats: { ...initialStats }, careerStats: { ...initialStats, seasonsPlayed: 0 } };
}

export function yieldToMain() { return new Promise(resolve => setTimeout(resolve, 0)); }

function addMessage(subject, body, isRead = false) {
    if (!game.messages) game.messages = [];
    game.messages.unshift({ id: crypto.randomUUID(), subject, body, isRead });
}


export async function initializeLeague(onProgress) {
    console.log("Initializing league...");
    game = { year: 1, teams: [], players: [], freeAgents: [], playerTeam: null, schedule: [], currentWeek: 0, divisions: {}, draftOrder: [], currentPick: 0, hallOfFame: [], gameResults: [], messages: [] };
    addMessage("Welcome to the League!", "Your new season is about to begin. Get ready to draft your team!");

    game.divisions[divisionNames[0]] = []; game.divisions[divisionNames[1]] = [];
    const totalPlayers = 300;
    for (let i = 0; i < totalPlayers; i++) {
        game.players.push(generatePlayer());
        if (i % 10 === 0 && onProgress) { onProgress(i / totalPlayers); await yieldToMain(); }
    }
    const availableTeamNames = [...teamNames];
    
    for (let i = 0; i < 19; i++) {
        const teamName = `The ${availableTeamNames.splice(getRandomInt(0, availableTeamNames.length - 1), 1)[0]}`;
        const division = divisionNames[i % divisionNames.length];
        const coach = getRandom(coachPersonalities);

        const offenseSlots = offenseFormations[coach.preferredOffense].slots;
        const defenseSlots = defenseFormations[coach.preferredDefense].slots;

        const team = {
            id: crypto.randomUUID(), name: teamName, roster: [], coach, division, wins: 0, losses: 0,
            formations: { offense: coach.preferredOffense, defense: coach.preferredDefense },
            depthChart: {
                offense: Object.fromEntries(offenseSlots.map(slot => [slot, null])),
                defense: Object.fromEntries(defenseSlots.map(slot => [slot, null]))
            },
            draftNeeds: 0 
        };
        game.teams.push(team); game.divisions[division].push(team.id);
    }
}

export function createPlayerTeam(teamName) {
    const finalTeamName = teamName.toLowerCase().startsWith("the ") ? teamName : `The ${teamName}`;
    const division = game.teams.length % 2 === 0 ? divisionNames[0] : divisionNames[1];
    
    const defaultOffense = 'Balanced';
    const defaultDefense = '3-3-1';
    const defaultOffenseSlots = offenseFormations[defaultOffense].slots;
    const defaultDefenseSlots = defenseFormations[defaultDefense].slots;

    const playerTeam = {
        id: crypto.randomUUID(), name: finalTeamName, roster: [], coach: getRandom(coachPersonalities), division, wins: 0, losses: 0,
        formations: { offense: defaultOffense, defense: defaultDefense },
        depthChart: {
            offense: Object.fromEntries(defaultOffenseSlots.map(slot => [slot, null])),
            defense: Object.fromEntries(defaultDefenseSlots.map(slot => [slot, null]))
        },
        draftNeeds: 0
    };
    game.teams.push(playerTeam);
    game.divisions[division].push(playerTeam.id);
    game.playerTeam = playerTeam;
    addMessage("Team Created!", `Welcome to the league, ${finalTeamName}! It's time to build your team in the draft.`);
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
    
    const sortedTeams = [...game.teams].sort((a, b) => a.wins - b.wins || b.losses - a.losses); 
    
    if (game.year === 1) {
        console.log("First season: Setting draft needs to 10 for all teams.");
        game.teams.forEach(team => team.draftNeeds = 10);
    }
    
    const maxNeeds = Math.max(0, ...game.teams.map(t => t.draftNeeds)); 
    
    for (let i = 0; i < maxNeeds; i++) {
        game.draftOrder.push(...(i % 2 === 0 ? sortedTeams : [...sortedTeams].reverse()));
    }
    console.log(`Draft setup with ${maxNeeds} rounds, total picks: ${game.draftOrder.length}`);
}


/**
 * UPDATED: AI sets depth chart prioritizing slot-specific attributes.
 */
export function aiSetDepthChart(team) {
    const { roster, depthChart } = team;
    if (!roster || roster.length === 0) return; 

    // Reset depth chart to ensure no lingering players
     for (const side in depthChart) {
         for (const slot in depthChart[side]) {
             depthChart[side][slot] = null;
         }
     }
    
    // This allows players to play on both offense and defense
    for (const side in depthChart) {
        const slots = Object.keys(depthChart[side]);
        let availablePlayers = [...roster]; 
        
        // Sort slots to prioritize key positions (QB, RB, WR1) first
        slots.sort((a, b) => {
            if(a.startsWith('QB')) return -1; if(b.startsWith('QB')) return 1;
            if(a.startsWith('RB')) return -1; if(b.startsWith('RB')) return 1;
            if(a.startsWith('WR1')) return -1; if(b.startsWith('WR1')) return 1;
            return 0;
        });

        slots.forEach(slot => {
            if (availablePlayers.length > 0) {
                // Find the player with the highest suitability for *this specific slot*
                const bestPlayerForSlot = availablePlayers.reduce((best, current) => {
                    // Use new slot-specific suitability calculator
                    const bestSuitability = calculateSlotSuitability(best, slot, side, team);
                    const currentSuitability = calculateSlotSuitability(current, slot, side, team);

                    // Check if they are *already* starting on the *other* side in a *critical* role (QB/RB)
                    const otherSide = side === 'offense' ? 'defense' : 'offense';
                    // Check if slots exist before accessing
                    const isStartingCriticalOtherSideBest = (team.depthChart[otherSide]['QB1'] && team.depthChart[otherSide]['QB1'] === best.id) || 
                                                              (team.depthChart[otherSide]['RB1'] && team.depthChart[otherSide]['RB1'] === best.id);
                    const isStartingCriticalOtherSideCurrent = (team.depthChart[otherSide]['QB1'] && team.depthChart[otherSide]['QB1'] === current.id) || 
                                                                 (team.depthChart[otherSide]['RB1'] && team.depthChart[otherSide]['RB1'] === current.id);
                    
                    if (isStartingCriticalOtherSideBest && !isStartingCriticalOtherSideCurrent) return current; // Prefer player not starting in critical role
                    if (!isStartingCriticalOtherSideBest && isStartingCriticalOtherSideCurrent) return best;
                    
                    // If both or neither start in a critical role, pick the most suitable
                    return currentSuitability > bestSuitability ? current : best;
                });

                team.depthChart[side][slot] = bestPlayerForSlot.id;
                 availablePlayers = availablePlayers.filter(p => p.id !== bestPlayerForSlot.id); 
            }
        });
    }
}


export function simulateAIPick(team) {
    if (team.roster.length >= 10) { 
        return null; 
    }

    const undraftedPlayers = game.players.filter(p => !p.teamId);
    if (undraftedPlayers.length === 0) return null; 

    const bestPlayer = undraftedPlayers.reduce((best, current) => {
        const score = getPlayerScore(current, team.coach);
        return score > best.score ? { player: current, score } : best;
    }, { player: null, score: -1 }).player;
    
    if (bestPlayer) {
        addPlayerToTeam(bestPlayer, team);
    }
    return bestPlayer;
}

export function addPlayerToTeam(player, team) {
    player.teamId = team.id; 
    team.roster.push(player);
    return true;
}


export function generateSchedule() {
    game.schedule = [];
    game.currentWeek = 0;
    const allWeeklyGames = Array(9).fill(null).map(() => []);

    for (const divisionName in game.divisions) {
        let teams = [...game.teams.filter(t => t.division === divisionName)];
        if (teams.length !== 10) { 
            console.error(`Scheduling Error: Division ${divisionName} requires 10 teams but has ${teams.length}.`);
            continue; 
        }

        const numWeeks = 9;
        const numTeams = 10;
        
        for (let round = 0; round < numWeeks; round++) {
            for (let match = 0; match < numTeams / 2; match++) {
                const home = teams[match];
                const away = teams[numTeams - 1 - match];
                 if (home && away) {
                    const matchup = round % 2 === 1 ? { home, away } : { home: away, away: home };
                    allWeeklyGames[round].push(matchup);
                }
            }
            teams.splice(1, 0, teams.pop());
        }
    }
    
    game.schedule = allWeeklyGames.flat();
    console.log(`Schedule generated: ${game.schedule.length} total games over 9 weeks.`);
}


function resetGameStats() {
    game.players.forEach(player => {
        player.fatigue = 0;
        player.gameStats = { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0, sacks: 0, interceptions: 0 };
    });
}

function checkInGameInjury(player, gameLog) {
    if (!player || player.status.duration > 0) return;
    const injuryChance = 0.008;
    const toughnessModifier = (100 - player.attributes.mental.toughness) / 100;
    
    if (Math.random() < injuryChance * toughnessModifier) {
        const duration = getRandomInt(1, 3);
        player.status.type = 'injured';
        player.status.description = 'Minor Injury';
        player.status.duration = duration;
        player.status.isNew = true;
        if(gameLog) gameLog.push(`INJURY: ${player.name} has suffered a minor injury and will be out for ${duration} week(s).`);
    }
}

function getBestSub(team, position, usedPlayerIds) {
    const availableSubs = team.roster.filter(p => p.status.duration === 0 && !usedPlayerIds.has(p.id));
    if (availableSubs.length === 0) return null;
    return availableSubs.reduce((best, current) => 
        (calculateOverall(current, position) > calculateOverall(best, position)) ? current : best,
        availableSubs[0] 
    );
}

function getPlayersForSlots(team, side, slotPrefix, usedPlayerIdsThisPlay) {
    const slots = Object.keys(team.depthChart[side]).filter(s => s.startsWith(slotPrefix));
    const position = slotPrefix.replace(/\d/g, '');
    const activePlayers = [];
    slots.forEach(slot => {
        let player = team.roster.find(p => p.id === team.depthChart[side][slot]);
        if (!player || player.status.duration > 0 || usedPlayerIdsThisPlay.has(player.id)) {
             player = getBestSub(team, position, usedPlayerIdsThisPlay);
        }
        if (player && !usedPlayerIdsThisPlay.has(player.id)) {
            activePlayers.push({player: player, slot: slot}); // Return player *and* their slot
            usedPlayerIdsThisPlay.add(player.id); // Mark used for this play
        }
    });
    return activePlayers;
}


/**
 * REWRITTEN: determinePlayCall
 * This function now selects a valid play key from the offensivePlaybook.
 */
function determinePlayCall(offense, defense, down, yardsToGo, ballOn, scoreDiff, gameLog, drivesRemaining) {
    const { coach } = offense;
    const offenseFormationName = offense.formations.offense;
    const defenseFormationName = defense.formations.defense;
    
    const offenseFormation = offenseFormations[offenseFormationName];
    const defenseFormation = defenseFormations[defenseFormationName];
    
    if (!offenseFormation || !offenseFormation.personnel || !defenseFormation || !defenseFormation.personnel) {
        console.error(`CRITICAL ERROR: Formation data is missing for ${offense.name} or ${defense.name}.`);
        return 'Balanced_InsideRun'; // Failsafe play
    }

    const usedIds = new Set();
    const qb = getPlayersForSlots(offense, 'offense', 'QB', usedIds)[0]?.player;
    const rb = getPlayersForSlots(offense, 'offense', 'RB', usedIds)[0]?.player;

    const qbStrength = qb ? calculateOverall(qb, 'QB') : 0;
    const rbStrength = rb ? calculateOverall(rb, 'RB') : 0;

    let passChance = 0.45;
    if (offenseFormation.personnel.WR > defenseFormation.personnel.DB + 1) passChance += 0.2; 
    if (offenseFormation.personnel.RB + offenseFormation.personnel.OL > defenseFormation.personnel.DL + defenseFormation.personnel.LB + 1) passChance -= 0.2;
    if (qbStrength < 50 && rbStrength > 50) passChance -= 0.25;
    if (rbStrength < 50 && qbStrength > 50) passChance += 0.15;
    if(qbStrength > rbStrength + 15) passChance += 0.1;
    if(rbStrength > qbStrength + 15) passChance -= 0.1;
    
    if (down === 3 && yardsToGo > 6) passChance += 0.4;
    if (down === 4 && yardsToGo > 3) passChance = 0.95; 
    if (yardsToGo <= 2) passChance -= 0.4; 
    if (ballOn > 80) passChance += 0.1; 
    if (scoreDiff < -10) passChance += 0.2; 
    if (scoreDiff > 14 && drivesRemaining < 3) passChance -= 0.3; 

    if(coach.type === 'Ground and Pound') passChance -= 0.3;
    if(coach.type === 'West Coast Offense') passChance += 0.2;
    if (coach.type === 'Spread') passChance += 0.25;

    // Get all valid plays for the team's formation
    const formationPlays = Object.keys(offensivePlaybook).filter(key => key.startsWith(offenseFormationName));
    
    if (yardsToGo <= 1 && qbStrength > 60 && Math.random() < 0.6) {
        // FIX: QB Sneak is a 'run' type
        const sneakPlay = formationPlays.find(p => offensivePlaybook[p].zone === ZONES.SNEAK);
        if (sneakPlay) return sneakPlay;
        return getRandom(formationPlays.filter(p => p.includes('InsideRun') || p.includes('Dive'))) || formationPlays[0];
    }
    
    let desiredPlayType = (Math.random() < passChance) ? 'pass' : 'run';
    let possiblePlays = formationPlays.filter(key => offensivePlaybook[key].type === desiredPlayType);

    if (possiblePlays.length === 0) {
        desiredPlayType = desiredPlayType === 'pass' ? 'run' : 'pass';
        possiblePlays = formationPlays.filter(key => offensivePlaybook[key].type === desiredPlayType);
        if (possiblePlays.length === 0) {
            console.error(`No plays found for ${offenseFormationName} of type ${desiredPlayType}`);
            return formationPlays[0]; // Absolute failsafe
        }
    }
    
    if (desiredPlayType === 'pass') {
        const deep = (yardsToGo > 15 || (ballOn < 50 && scoreDiff < -7 && drivesRemaining < 5));
        const screen = (down <= 2 && yardsToGo < 7 && qbStrength < 70);
        
        if (screen && possiblePlays.some(p => p.includes('Screen'))) {
            return getRandom(possiblePlays.filter(p => p.includes('Screen')));
        }
        if (deep && possiblePlays.some(p => p.includes('Deep') || p.includes('Verts'))) {
            return getRandom(possiblePlays.filter(p => p.includes('Deep') || p.includes('Verts')));
        }
        return getRandom(possiblePlays.filter(p => p.includes('Short') || p.includes('Slant') || p.includes('Curl'))) || getRandom(possiblePlays);
    } else {
        const outside = (rb && rb.attributes.physical.speed > 75);
        if (outside && Math.random() < 0.4 && possiblePlays.some(p => p.includes('Outside') || p.includes('Sweep'))) {
            return getRandom(possiblePlays.filter(p => p.includes('Outside') || p.includes('Sweep')));
        }
        return getRandom(possiblePlays.filter(p => p.includes('Inside') || p.includes('Dive'))) || getRandom(possiblePlays);
    }
}

/**
 * NEW: resolveBattle helper function
 * This function resolves a single 1-on-1 battle for one tick.
 * @returns {object} The updated battleState.
 */
// helper already provided by you
function resolveBattle(powerA, powerB, battleState, log, logPrefix) {
    const DOMINANT_WIN = 20;
    const SLIGHT_WIN = 5;
    const diff = (powerA + getRandomInt(-5, 5)) - (powerB + getRandomInt(-5, 5));

    if (diff > DOMINANT_WIN) { // Dominant Win for A
        battleState.status = 'win_A';
        if (log && Math.random() < 0.5) log.push(`${logPrefix} DOMINANT WIN`);
    } else if (diff > SLIGHT_WIN) { // Slight Win for A
        battleState.streakA = (battleState.streakA || 0) + 1;
        battleState.streakB = 0;
        if (log && Math.random() < 0.2) log.push(`${logPrefix} slight win A (streak ${battleState.streakA})`);
        if (battleState.streakA >= 2) battleState.status = 'win_A';
    } else if (diff < -DOMINANT_WIN) { // Dominant Win for B
        battleState.status = 'win_B';
        if (log && Math.random() < 0.5) log.push(`${logPrefix} DOMINANT WIN B`);
    } else if (diff < -SLIGHT_WIN) { // Slight Win for B
        battleState.streakB = (battleState.streakB || 0) + 1;
        battleState.streakA = 0;
        if (log && Math.random() < 0.2) log.push(`${logPrefix} slight win B (streak ${battleState.streakB})`);
        if (battleState.streakB >= 2) battleState.status = 'win_B';
    } else { // Draw
        battleState.streakA = 0;
        battleState.streakB = 0;
        if (log && Math.random() < 0.1) log.push(`${logPrefix} draw`);
    }
    return battleState;
}

/**
 * Tick-based play resolution (fixed and consistent)
 */
function resolvePlay(offense, defense, playKey, gameState) {
    const { gameLog = [], weather, ballOn } = gameState;

    // --- Battle constants (consistent names) ---
    const DOMINANT_WIN = 20;
    const SLIGHT_WIN = 5;
    const DRAW_WIN_THRESHOLD = DOMINANT_WIN;
    const DRAW_SLIGHT_WIN_THRESHOLD = SLIGHT_WIN;
    const DRAW_THRESHOLD = 5; // used for grapple/tackle comparisons

    // play lookup / failsafe
    let play = offensivePlaybook[playKey];
    if (!play) {
        console.error(`Play key "${playKey}" not in playbook! Defaulting to Balanced_InsideRun.`);
        playKey = 'Balanced_InsideRun';
        play = offensivePlaybook[playKey];
        if (!play) { gameLog.push("CRITICAL: no default play"); return { yards: 0 }; }
    }

    const { type, zone, playAction, assignments } = play;

    const usedPlayerIds_O = new Set();
    const usedPlayerIds_D = new Set();
    const getFatigueModifier = (p) => (p ? (1 - (p.fatigue / (p.attributes.physical.stamina * 3))) : 1);

    // Emergency/sub helpers (you already have getBestSub/getPlayersForSlots somewhere else).
    const findEmergencyPlayer = (position, team, side = 'offense', usedPlayerIds) => {
        const available = team.roster.filter(p => p.status.duration === 0 && !usedPlayerIds.has(p.id));
        if (!available.length) return null;
        const best = available.reduce((best, cur) => calculateOverall(cur, position) > calculateOverall(best, position) ? cur : best, available[0]);
        if (gameLog) gameLog.push(`EMERGENCY (${team.name}): ${best.name} fills ${position}`);
        usedPlayerIds.add(best.id);
        return { player: best, slot: `SUB_${position}` };
    };

    const getPlayerBySlot = (team, side, slot) => {
        let p = team.roster.find(pl => pl.id === team.depthChart[side][slot]);
        const usedSet = side === 'offense' ? usedPlayerIds_O : usedPlayerIds_D;
        if (!p || p.status.duration > 0 || usedSet.has(p.id)) p = getBestSub(team, slot.replace(/\d/g, ''), usedSet);
        if (p && !usedSet.has(p.id)) { usedSet.add(p.id); return p; }
        return null;
    };

    // --- Gather players, bump fatigue for participants ---
    const dls = getPlayersForSlots(defense, 'defense', 'DL', usedPlayerIds_D).map(x => x.player).filter(Boolean);
    const lbs = getPlayersForSlots(defense, 'defense', 'LB', usedPlayerIds_D).map(x => x.player).filter(Boolean);
    const dbs = getPlayersForSlots(defense, 'defense', 'DB', usedPlayerIds_D).map(x => x.player).filter(Boolean);
    [...dls, ...lbs, ...dbs].forEach(p => { if (p) p.fatigue = Math.min(100, p.fatigue + 5); });

    let qb = getPlayerBySlot(offense, 'offense', 'QB1') || findEmergencyPlayer('QB', offense, 'offense', usedPlayerIds_O)?.player;
    const rbs = getPlayersForSlots(offense, 'offense', 'RB', usedPlayerIds_O).map(x => x.player).filter(Boolean);
    const wrs = getPlayersForSlots(offense, 'offense', 'WR', usedPlayerIds_O).map(x => x.player).filter(Boolean);
    const ols = getPlayersForSlots(offense, 'offense', 'OL', usedPlayerIds_O).map(x => x.player).filter(Boolean);
    [qb, ...rbs, ...wrs, ...ols].forEach(p => { if (p) p.fatigue = Math.min(100, p.fatigue + 5); });

    // QB sneak shortcut
    if (zone === ZONES.SNEAK) {
        if (!qb) return { yards: 0, turnover: true };
        checkInGameInjury(qb, gameLog);
        const qbPower = (qb.attributes.physical.strength + qb.attributes.physical.weight / 5) * getFatigueModifier(qb);
        const dlStopper = getPlayerBySlot(defense, 'defense', 'DL2') || getPlayerBySlot(defense, 'defense', 'DL1') || findEmergencyPlayer('DL', defense, 'defense', usedPlayerIds_D)?.player;
        if (!dlStopper) return { yards: 1, touchdown: ballOn + 1 >= 100 };
        checkInGameInjury(dlStopper, gameLog);
        const dlPower = (dlStopper.attributes.physical.strength + dlStopper.attributes.technical.blockShedding) * getFatigueModifier(dlStopper);
        const diff = qbPower - (dlPower + getRandomInt(-10, 10));
        let yards = 0;
        if (diff > DRAW_THRESHOLD) yards = getRandomInt(1, 3);
        else if (diff < -DRAW_THRESHOLD) yards = 0;
        else yards = getRandomInt(0, 1);
        if (yards > 0) gameLog.push(`QB Sneak by ${qb.name} for ${yards} yards!`);
        else { gameLog.push(`QB Sneak stuffed by ${dlStopper.name}!`); dlStopper.gameStats.tackles++; }
        const touchdown = ballOn + yards >= 100;
        if (touchdown) qb.gameStats.touchdowns++;
        return { yards, touchdown };
    }

    // --- Setup state for ticks ---
    let playIsLive = true;
    let tick = 0;
    const MAX_PLAY_TICKS = 30; // safety: shouldn't normally reach this
    let yards = 0, touchdown = false, turnover = false, incomplete = false;
    let ballThrown = false, ballCarrier = null, tackler = null;
    let currentZone = ZONES.BACKFIELD_C;
    let pressure = false;
    let rusherWhoWon = null;
    let sack = false;
    let unblockedRusher = null;

    const offenseFormationData = offenseFormations[offense.formations.offense];
    const defenseFormationData = defenseFormations[defense.formations.defense];

    // --- battle states containers ---
    const battleStates = {
        passRush: [], // { blockers: [...], rusher, status, streakA, streakB, isDoubleTeam }
        coverage: [], // { player, defenders:[...], status, separation, streakA, streakB, route }
        runBlock: []  // { blocker, defender, status, streakA, streakB }
    };

    // --- (A) PASS: Setup pass rush & blockers ---
    if (type === 'pass') {
        const passRushers = dls.concat(lbs.filter(p => {
            const slot = Object.keys(defense.depthChart.defense).find(s => defense.depthChart.defense[s] === p.id);
            return slot && defenseFormationData.routes && defenseFormationData.routes[slot] && !defenseFormationData.routes[slot].some(r => r.includes('cover'));
        })).filter(Boolean);

        const blockers = ols.concat(rbs.filter(r => {
            const slot = Object.keys(offense.depthChart.offense).find(s => offense.depthChart.offense[s] === r.id);
            return slot && offenseFormationData.routes && offenseFormationData.routes[slot] && offenseFormationData.routes[slot].includes('block_pass');
        })).filter(Boolean);

        let availableBlockers = [...blockers];
        const bestRusher = passRushers.length ? passRushers.reduce((b, c) => calculateOverall(c, 'DL') > calculateOverall(b, 'DL') ? c : b, passRushers[0]) : null;

        passRushers.forEach(rusher => {
            if (!availableBlockers.length) {
                unblockedRusher = rusher;
                return;
            }
            let blocker = availableBlockers.pop();
            let isDoubleTeam = false;
            // double team logic: fairly conservative
            if (availableBlockers.length > 0 && bestRusher && rusher.id === bestRusher.id && availableBlockers.length >= 1) {
                const helper = availableBlockers.pop();
                if (helper) {
                    blocker = [blocker, helper];
                    isDoubleTeam = true;
                }
            }
            battleStates.passRush.push({ blockers: Array.isArray(blocker) ? blocker : [blocker], rusher, status: 'ongoing', streakA: 0, streakB: 0, isDoubleTeam });
        });

        if (unblockedRusher && gameLog) gameLog.push(`Blitz! ${unblockedRusher.name} hits the pocket unblocked!`);
    }

    // --- (B) PASS: Setup coverage battles (normalize fields) ---
    if (type === 'pass') {
        Object.keys(play.assignments).filter(slot => slot.startsWith('WR') || slot.startsWith('RB')).forEach(slot => {
            const candidateList = slot.startsWith('WR') ? wrs : rbs;
            const receiver = candidateList.find(p => {
                const pSlot = Object.keys(offense.depthChart.offense).find(s => offense.depthChart.offense[s] === p.id);
                return pSlot === slot;
            });
            if (!receiver) return;

            const routeName = play.assignments[slot];
            if (!routeName || routeName.toLowerCase().includes('block')) return;
            const routeInfo = routeTree[routeName];
            if (!routeInfo) return;

            // find defenders in zone; fallback to best available DB/LB
            const coverageSlots = Object.keys(defenseFormationData.zoneAssignments || {}).filter(s => routeInfo.zones.includes(defenseFormationData.zoneAssignments[s]));
            const defendersInZone = coverageSlots.map(s => getPlayerBySlot(defense, 'defense', s)).filter(Boolean);
            let primaryDefender = defendersInZone[0] || getRandom([...dbs, ...lbs].filter(p => p && !usedPlayerIds_D.has(p.id))) || findEmergencyPlayer('DB', defense, 'defense', usedPlayerIds_D)?.player;
            if (primaryDefender) usedPlayerIds_D.add(primaryDefender.id);

            // safety help for deep routes
            const defenders = [];
            if (primaryDefender) defenders.push(primaryDefender);
            if (routeInfo.zones.some(z => z.includes('DEEP'))) {
                const safety = (getPlayersForSlots(defense, 'defense', 'DB', usedPlayerIds_D).find(d => {
                    const dSlot = Object.keys(defense.depthChart.defense).find(s => defense.depthChart.defense[s] === d.player.id);
                    return dSlot && defenseFormationData.zoneAssignments && defenseFormationData.zoneAssignments[dSlot] && defenseFormationData.zoneAssignments[dSlot].includes('DEEP_C');
                }) || {}).player;
                if (safety && !defenders.find(d => d && d.id === safety.id)) {
                    defenders.push(safety);
                    usedPlayerIds_D.add(safety.id);
                }
            }

            // push normalized coverage entry
            battleStates.coverage.push({
                player: receiver,
                defenders,
                status: defenders.length ? 'covered' : 'open',
                separation: defenders.length ? 0 : 6,
                streakA: 0,
                streakB: 0,
                route: routeName,
                routeInfo
            });
        });
    }

    // --- (C) RUN: Setup run block battles ---
    if (type === 'run') {
        ballCarrier = rbs[0] || findEmergencyPlayer('RB', offense, 'offense', usedPlayerIds_O)?.player;
        if (!ballCarrier) { if (gameLog) gameLog.push('No healthy RB'); return { yards: 0, turnover: true }; }

        // choose line-of-attack blockers & defenders simply
        const runBlockers = ols.length ? ols : [];
        const runDefenders = [...dls, ...lbs];
        runBlockers.forEach(blocker => {
            const defender = getRandom(runDefenders.filter(Boolean));
            if (defender) {
                battleStates.runBlock.push({ blocker, defender, status: 'ongoing', streakA: 0, streakB: 0 });
                runDefenders.splice(runDefenders.indexOf(defender), 1);
            }
        });
    }

    // --- TICK LOOP: evolve battles over ticks until resolved ---
    while (playIsLive && tick < MAX_PLAY_TICKS) {
        tick++;

        // ---- PASS: resolve pass rush battles ----
        if (type === 'pass') {
            // Unblocked rusher: instant pressure after tick 1
            if (unblockedRusher && tick > 1) {
                pressure = true;
                rusherWhoWon = unblockedRusher;
                if (gameLog) gameLog.push(`${rusherWhoWon.name} bursts into the pocket unblocked!`);
            } else {
                for (const battle of battleStates.passRush) {
                    if (battle.status === 'ongoing') {
                        // compute block vs rush power
                        const blockPower = battle.blockers.reduce((sum, b) => sum + ((b.attributes.technical.blocking || 0) + (b.attributes.physical.strength || 0)) * getFatigueModifier(b), 0) * (battle.isDoubleTeam ? 1.4 : 1);
                        const rushPower = ((battle.rusher.attributes.physical.strength || 0) + (battle.rusher.attributes.technical.blockShedding || 0)) * getFatigueModifier(battle.rusher);

                        const diff = blockPower - (rushPower + getRandomInt(-20, 40));
                        if (diff < -DRAW_WIN_THRESHOLD) {
                            battle.status = 'win_B'; pressure = true; rusherWhoWon = battle.rusher;
                            if (gameLog) gameLog.push(`${battle.rusher.name} DOMINATES ${battle.blockers[0].name}!`);
                        } else if (diff < -DRAW_SLIGHT_WIN_THRESHOLD) {
                            battle.streakB = (battle.streakB || 0) + 1; battle.streakA = 0;
                            if (battle.streakB >= 2) { battle.status = 'win_B'; pressure = true; rusherWhoWon = battle.rusher; if (gameLog) gameLog.push(`${battle.rusher.name} beats ${battle.blockers[0].name}!`); }
                        } else if (diff > DRAW_WIN_THRESHOLD) {
                            battle.status = 'win_A';
                        } else if (diff > DRAW_SLIGHT_WIN_THRESHOLD) {
                            battle.streakA = (battle.streakA || 0) + 1; battle.streakB = 0;
                            if (battle.streakA >= 2) battle.status = 'win_A';
                        } else {
                            battle.streakA = 0; battle.streakB = 0;
                        }
                    }
                }
            }

            // ---- PASS: coverage updates ----
            for (const cov of battleStates.coverage) {
                // defenders array may be empty => open
                if (!cov.defenders.length) { cov.status = 'open'; cov.separation = Math.max(cov.separation || 6, 6); continue; }

                const defender = cov.defenders[0];
                const recPower = ((cov.player.attributes.physical.speed || 0) + (cov.player.attributes.physical.agility || 0) + (cov.routeInfo ? cov.routeInfo.time * tick : 0)) * getFatigueModifier(cov.player);
                const defPower = ((defender.attributes.physical.speed || 0) + (defender.attributes.physical.agility || 0)) * getFatigueModifier(defender);

                const diff = recPower - (defPower + getRandomInt(-10, 10));
                if (diff > DRAW_WIN_THRESHOLD) {
                    cov.status = 'open'; cov.separation = Math.max(cov.separation || 1, 5);
                    if (gameLog && Math.random() < 0.25) gameLog.push(`${cov.player.name} creates separation from ${defender.name}.`);
                } else if (diff > DRAW_SLIGHT_WIN_THRESHOLD) {
                    cov.streakA = (cov.streakA || 0) + 1; cov.streakB = 0;
                    if (cov.streakA >= 2) { cov.status = 'open'; cov.separation = cov.streakA; if (gameLog) gameLog.push(`${cov.player.name} slowly gains separation.`); }
                } else if (diff < -DRAW_WIN_THRESHOLD) {
                    cov.status = 'covered'; cov.separation = -5;
                } else if (diff < -DRAW_SLIGHT_WIN_THRESHOLD) {
                    cov.streakB = (cov.streakB || 0) + 1; cov.streakA = 0;
                    if (cov.streakB >= 2) { cov.status = 'covered'; cov.separation = -cov.streakB; }
                } else {
                    cov.streakA = 0; cov.streakB = 0; cov.separation = cov.separation || 0;
                }
            }

            // ---- PASS: QB decision under pressure or when a receiver opens ----
            const openReceivers = battleStates.coverage.filter(c => c.status === 'open' || (c.separation || 0) > 0);
            const throwTime = Math.max(1, Math.ceil((qb ? qb.attributes.mental.playbookIQ : 50) / 30)); // ticks until QB likely to throw

            if ((pressure && !sack) || tick >= throwTime || (openReceivers.length > 0 && Math.random() < 0.45) || tick === MAX_PLAY_TICKS) {
                // QB throws
                ballThrown = true;
                playIsLive = false;

                // choose best open receiver
                let targetBattle = null;
                if (openReceivers.length) targetBattle = openReceivers.reduce((best, c) => (c.separation || 0) > (best.separation || 0) ? c : best, openReceivers[0]);
                else targetBattle = battleStates.coverage.length ? battleStates.coverage[0] : null;

                if (!targetBattle) { if (gameLog) gameLog.push('No eligible target, QB throws it away'); incomplete = true; break; }

                const target = targetBattle.player;
                const defender = (targetBattle.defenders && targetBattle.defenders[0]) || null;
                const separation = targetBattle.separation || 0;

                // accuracy adjustments
                let qbAccuracy = (qb ? qb.attributes.technical.throwingAccuracy : 50) * getFatigueModifier(qb);
                if (pressure === 'stalemate') qbAccuracy -= 10;
                if (pressure === true) qbAccuracy -= 20;
                if (weather === 'Windy' && (routeTree[targetBattle.route] && routeTree[targetBattle.route].zones.some(z => z.includes('DEEP')))) qbAccuracy -= 12;

                if (getRandomInt(1, 100) > qbAccuracy) {
                    if (gameLog) gameLog.push(`INCOMPLETE. Bad throw by ${qb ? qb.name : 'QB'}.`);
                    incomplete = true;
                    break;
                }

                // catch contest
                let catchContest = (target.attributes.technical.catchingHands || 0) + (separation * 2) - (weather === 'Rain' ? 10 : 0);
                let defendContest = defender ? ((defender.attributes.technical.catchingHands || 0) + (defender.attributes.physical.agility || 0)) * getFatigueModifier(defender) : 0;
                if (targetBattle.defenders.length > 1) { catchContest -= 15; defendContest *= 1.2; }

                if (catchContest > defendContest + getRandomInt(-20, 20)) {
                    // catch success
                    const routeInfo = routeTree[targetBattle.route] || { baseYards: [5, 10] };
                    const baseY = getRandomInt(routeInfo.baseYards[0], routeInfo.baseYards[1]);
                    yards = baseY;
                    target.gameStats.receptions = (target.gameStats.receptions || 0) + 1;
                    if (gameLog) gameLog.push(`${targetBattle.route} pass from ${qb.name} to ${target.name} for ${baseY} yards.`);

                    // simple YAC: contest vs defender
                    ballCarrier = target;
                    tackler = defender;
                    if (tackler) {
                        const juke = (ballCarrier.attributes.physical.agility || 0) * getFatigueModifier(ballCarrier);
                        const tackle = (tackler.attributes.technical.tackling || 0) * getFatigueModifier(tackler);
                        if (juke > tackle + getRandomInt(-10, 20)) {
                            const extra = getRandomInt(5, 15);
                            yards += extra;
                            if (gameLog) gameLog.push(`${ballCarrier.name} avoids ${tackler.name} for +${extra} YAC.`);
                        } else {
                            if (gameLog) gameLog.push(`${ballCarrier.name} tackled by ${tackler.name}.`);
                            tackler.gameStats.tackles = (tackler.gameStats.tackles || 0) + 1;
                        }
                    } else {
                        const extra = getRandomInt(10, 20);
                        yards += extra;
                        if (gameLog) gameLog.push(`${target.name} has room to run for +${extra} yards.`);
                    }
                } else {
                    // incomplete or interception
                    if (defender && ((defender.attributes.technical.catchingHands || 0) / 100) > Math.random() * 2.8) {
                        if (gameLog) gameLog.push(`INTERCEPTION! ${defender.name} picks it off!`);
                        defender.gameStats.interceptions = (defender.gameStats.interceptions || 0) + 1;
                        turnover = true;
                    } else {
                        if (gameLog) gameLog.push(`INCOMPLETE to ${target.name}, defended by ${defender ? defender.name : 'coverage'}.`);
                        incomplete = true;
                    }
                }
            }

            // ---- handle pressure -> sacks if rusher succeeded this tick ----
            if (!ballThrown && pressure && !sack && rusherWhoWon) {
                // chance to sack: compare rusher containment vs QB
                const evade = (qb.attributes.physical.agility + qb.attributes.physical.speed) * getFatigueModifier(qb);
                const contain = ((rusherWhoWon.attributes.physical.agility || 0) + (rusherWhoWon.attributes.physical.speed || 0)) * getFatigueModifier(rusherWhoWon);
                if (evade > contain + getRandomInt(-10, 20)) {
                    // QB escapes for now
                    if (gameLog && Math.random() < 0.5) gameLog.push(`${qb.name} slips away from ${rusherWhoWon.name}.`);
                } else {
                    const breakSack = (qb.attributes.physical.strength || 0) * getFatigueModifier(qb);
                    const sackPower = (((rusherWhoWon.attributes.physical.strength || 0) + (rusherWhoWon.attributes.technical.tackling || 0)) * getFatigueModifier(rusherWhoWon));
                    if (breakSack < sackPower + getRandomInt(-10, 25)) {
                        // sack
                        sack = true;
                        yards = -getRandomInt(4, 8);
                        if (gameLog) gameLog.push(`SACK! ${rusherWhoWon.name} brings down ${qb.name} for ${Math.abs(yards)} yards lost.`);
                        rusherWhoWon.gameStats.sacks = (rusherWhoWon.gameStats.sacks || 0) + 1;
                        rusherWhoWon.gameStats.tackles = (rusherWhoWon.gameStats.tackles || 0) + 1;
                        playIsLive = false;
                    } else {
                        // QB breaks free
                        if (gameLog) gameLog.push(`${qb.name} shrugs off ${rusherWhoWon.name}!`);
                    }
                }
            }
        } // end pass tick

        // ---- RUN play tick logic ----
        else if (type === 'run') {
            if (!ballCarrier) ballCarrier = rbs[0] || findEmergencyPlayer('RB', offense, 'offense', usedPlayerIds_O)?.player;
            if (!ballCarrier) { playIsLive = false; turnover = true; break; }

            if (tick === 1) {
                // resolve line battles using resolveBattle
                let lineWins = 0, lineContests = 0;
                for (const b of battleStates.runBlock) {
                    const blockPower = ((b.blocker.attributes.technical.blocking || 0) + (b.blocker.attributes.physical.strength || 0)) * getFatigueModifier(b.blocker);
                    const shedPower = ((b.defender.attributes.technical.blockShedding || 0) + (b.defender.attributes.physical.strength || 0)) * getFatigueModifier(b.defender);
                    resolveBattle(blockPower, shedPower, b, gameLog, `Block ${b.blocker.name} vs ${b.defender.name}`);
                    if (b.status === 'win_A' || (b.streakA && b.streakA > 0)) lineWins++;
                    lineContests++;
                }
                const blockWinPercent = lineContests ? (lineWins / lineContests) : 0;
                if (blockWinPercent > 0.6) { yards = getRandomInt(4, 8); currentZone = ZONES.MED_C; if (gameLog) gameLog.push("Huge hole opens up for the RB!"); }
                else if (blockWinPercent > 0.3) { yards = getRandomInt(1, 3); currentZone = ZONES.SHORT_C; if (gameLog) gameLog.push("RB finds a small crease."); }
                else { yards = getRandomInt(-2, 1); if (gameLog) gameLog.push("Run stuffed at the line."); playIsLive = false; }
            }

            if (tick === 2 && playIsLive) {
                // second level tackler
                const candidateTackler = getRandom(lbs.filter(p => !usedPlayerIds_D.has(p?.id))) || findEmergencyPlayer('LB', defense, 'defense', usedPlayerIds_D)?.player;
                if (!candidateTackler) { yards += getRandomInt(5, 10); currentZone = ZONES.DEEP_C; }
                else {
                    const grapplePower = ((candidateTackler.attributes.technical.tackling || 0) + (candidateTackler.attributes.physical.agility || 0)) * getFatigueModifier(candidateTackler);
                    const jukePower = (ballCarrier.attributes.physical.agility || 0) * getFatigueModifier(ballCarrier);
                    const grappleDiff = grapplePower - (jukePower + getRandomInt(-25, 25));
                    if (grappleDiff > DRAW_THRESHOLD) {
                        const bringDown = ((candidateTackler.attributes.physical.strength || 0) + (candidateTackler.attributes.technical.tackling || 0)) * getFatigueModifier(candidateTackler);
                        const breakPower = (ballCarrier.attributes.physical.strength || 0) * getFatigueModifier(ballCarrier);
                        const tackleDiff = bringDown - (breakPower + getRandomInt(-30, 25));
                        if (tackleDiff > DRAW_THRESHOLD) { if (gameLog) gameLog.push(`Met by ${candidateTackler.name} and tackled.`); candidateTackler.gameStats.tackles = (candidateTackler.gameStats.tackles || 0) + 1; playIsLive = false; }
                        else if (tackleDiff < -DRAW_THRESHOLD) { const add = getRandomInt(5, 10); yards += add; currentZone = ZONES.DEEP_C; if (gameLog) gameLog.push(`${ballCarrier.name} breaks ${candidateTackler.name} for +${add} yds!`); }
                        else { const add = getRandomInt(1, 3); yards += add; if (gameLog) gameLog.push(`${ballCarrier.name} drags ${candidateTackler.name} for ${add} yds.`); candidateTackler.gameStats.tackles = (candidateTackler.gameStats.tackles || 0) + 1; playIsLive = false; }
                    } else {
                        const add = getRandomInt(5, 10); yards += add; currentZone = ZONES.DEEP_C; if (gameLog) gameLog.push(`${ballCarrier.name} jukes ${candidateTackler.name} for +${add} yds.`); 
                    }
                }
            }

            if (tick === 3 && playIsLive) {
                const safety = getRandom(dbs.filter(p => !usedPlayerIds_D.has(p?.id))) || findEmergencyPlayer('DB', defense, 'defense', usedPlayerIds_D)?.player;
                if (!safety) { const add = getRandomInt(10, 20); yards += add; if (gameLog) gameLog.push(`${ballCarrier.name} breaks to the secondary for +${add} yds.`); playIsLive = false; }
                else {
                    const chase = ((safety.attributes.physical.speed || 0) + (safety.attributes.physical.agility || 0)) * getFatigueModifier(safety);
                    const runSpeed = (ballCarrier.attributes.physical.speed || 0) * getFatigueModifier(ballCarrier);
                    if (chase > runSpeed + getRandomInt(-10, 10)) { if (gameLog) gameLog.push(`Caught from behind by ${safety.name}.`); safety.gameStats.tackles = (safety.gameStats.tackles || 0) + 1; }
                    else { const add = getRandomInt(10, 30); yards += add; if (gameLog) gameLog.push(`${ballCarrier.name} outruns ${safety.name} for +${add} yds.`); }
                    playIsLive = false;
                }
            }

            if (tick > 3 && playIsLive) playIsLive = false;
        }

        // safety exit
        if (!playIsLive) break;
    } // end tick loop

    // --- Post-play: apply stats/resolve outcomes ---
    const finalYards = yards;
    const scoredTD = (ballOn + finalYards) >= 100 && !turnover;
    if (scoredTD) {
        touchdown = true;
        if (ballCarrier && type === 'run') ballCarrier.gameStats.touchdowns = (ballCarrier.gameStats.touchdowns || 0) + 1;
        else if (type === 'pass' && ballThrown && !turnover && !incomplete) {
            const rec = (battleStates.coverage.find(b => b.status === 'open' || (b.separation || 0) > 0) || battleStates.coverage[0]);
            if (rec && rec.player) rec.player.gameStats.touchdowns = (rec.player.gameStats.touchdowns || 0) + 1;
        }
    }

    // assign yard/stat totals
    if (type === 'run' && ballCarrier) { ballCarrier.gameStats.rushYards = (ballCarrier.gameStats.rushYards || 0) + finalYards; }
    if (type === 'pass' && ballThrown && !turnover && !incomplete) {
        const rec = (battleStates.coverage.find(b => b.status === 'open' || (b.separation || 0) > 0) || battleStates.coverage[0]);
        if (rec && rec.player) { rec.player.gameStats.recYards = (rec.player.gameStats.recYards || 0) + finalYards; if (qb) qb.gameStats.passYards = (qb.gameStats.passYards || 0) + finalYards; }
    }

    return { yards: finalYards, touchdown, turnover, incomplete, log: gameLog };
}


/**
 * ADDED EXPORT
 */
export function simulateGame(homeTeam, awayTeam) {
    resetGameStats();
    aiSetDepthChart(homeTeam);
    aiSetDepthChart(awayTeam);

    const gameLog = [];
    let homeScore = 0;
    let awayScore = 0;
    const weather = getRandom(['Sunny', 'Windy', 'Rain']);
    gameLog.push(`Weather: ${weather}`);

    const breakthroughs = [];
    const totalDrivesPerHalf = getRandomInt(8, 10);
    let currentHalf = 1;
    let drivesThisGame = 0;
    let possession = Math.random() < 0.5 ? homeTeam : awayTeam;
    let gameForfeited = false;
    
    while(drivesThisGame < totalDrivesPerHalf * 2) {
        if (drivesThisGame === totalDrivesPerHalf) {
            currentHalf = 2;
            gameLog.push(`==== HALFTIME ====`);
            possession = (possession.id === homeTeam.id) ? awayTeam : homeTeam; 
            [...homeTeam.roster, ...awayTeam.roster].forEach(p => { if (p) p.fatigue = 0; });
        }
        
        const defense = (possession.id === homeTeam.id) ? awayTeam : homeTeam;

        if (possession.roster.filter(p => p.status.duration === 0).length < 7) {
            if (possession.id === homeTeam.id) { homeScore = 0; awayScore = 21; } 
            else { homeScore = 21; awayScore = 0; }
            gameLog.push(`${possession.name} forfeits due to injuries.`);
             gameForfeited = true; break; 
        }
        if (defense.roster.filter(p => p.status.duration === 0).length < 7) {
            if (defense.id === homeTeam.id) { homeScore = 0; awayScore = 21; } 
            else { homeScore = 21; awayScore = 0; }
            gameLog.push(`${defense.name} forfeits due to injuries.`);
             gameForfeited = true; break;
        }
            
        let ballOn = 20;
        let down = 1;
        let yardsToGo = 10;
        let driveActive = true;
            
        gameLog.push(`-- Drive ${drivesThisGame + 1} (H${currentHalf}): ${possession.name} starts at their 20 --`);

        while(driveActive && down <= 4) {
            const penaltyChance = 0.05;
            if (Math.random() < penaltyChance) {
                const penaltyYards = getRandom([5, 10]);
                gameLog.push(`PENALTY! False Start on ${possession.name}. ${penaltyYards} yard penalty.`);
                ballOn -= penaltyYards; ballOn = Math.max(1, ballOn); 
            }

            const scoreDiff = possession.id === homeTeam.id ? homeScore - awayScore : awayScore - homeScore;
            const drivesRemainingInGame = (totalDrivesPerHalf * 2) - drivesThisGame;
            const playKey = determinePlayCall(possession, defense, down, yardsToGo, ballOn, scoreDiff, gameLog, drivesRemainingInGame);
            const result = resolvePlay(possession, defense, playKey, { gameLog, weather, down, yardsToGo, ballOn });

            ballOn += result.yards;
                
            if (result.turnover) { driveActive = false; }
            else if (result.touchdown || ballOn >= 100) { 
                gameLog.push(`TOUCHDOWN ${possession.name}!`);
                
                const goesForTwo = Math.random() > 0.5;
                const conversionSuccess = Math.random() > (goesForTwo ? 0.5 : 0.1);
                if (conversionSuccess) {
                    gameLog.push(`${goesForTwo ? 2 : 1}-point conversion GOOD!`);
                    if (possession.id === homeTeam.id) homeScore += goesForTwo ? 8 : 7; else awayScore += goesForTwo ? 8 : 7;
                } else {
                    gameLog.push(`Conversion FAILED!`);
                    if (possession.id === homeTeam.id) homeScore += 6; else awayScore += 6;
                }
                driveActive = false;
            } else {
                yardsToGo -= result.yards;
                if(yardsToGo <= 0) { down = 1; yardsToGo = 10; gameLog.push(`First down!`); } 
                else { down++; }
                if(down > 4) { gameLog.push(`Turnover on downs!`); driveActive = false; }
            }
        }
        drivesThisGame++;
        possession = (possession.id === homeTeam.id) ? awayTeam : homeTeam; 
    }
    gameLog.push(`==== FINAL ====`);

    if (!gameForfeited) {
        if (homeScore > awayScore) { homeTeam.wins++; awayTeam.losses++; }
        else if (awayScore > homeScore) { awayTeam.wins++; homeTeam.losses++; }
    } else {
         if (homeScore > awayScore) { homeTeam.wins++; awayTeam.losses++; }
         else if (awayScore > homeScore) { awayTeam.wins++; homeTeam.losses++; }
    }
    
    [...homeTeam.roster, ...awayTeam.roster].forEach(p => {
        if (!p) return; 
        if (p.age < 14 && (p.gameStats.touchdowns >= 2 || p.gameStats.passYards > 150 || p.gameStats.tackles > 5 || p.gameStats.sacks > 1)) {
            const attributesToImprove = ['speed', 'strength', 'agility', 'throwingAccuracy', 'catchingHands', 'tackling', 'blocking', 'playbookIQ', 'blockShedding', 'toughness'];
            const attr = getRandom(attributesToImprove);
            for(const cat in p.attributes) {
                if(p.attributes[cat][attr] && p.attributes[cat][attr] < 99) {
                    p.attributes[cat][attr]++;
                    p.breakthroughAttr = attr; 
                    breakthroughs.push({ player: p, attr });
                    break;
                }
            }
        }

        for (const stat in p.gameStats) {
            p.seasonStats[stat] = (p.seasonStats[stat] || 0) + p.gameStats[stat];
            p.careerStats[stat] = (p.careerStats[stat] || 0) + p.gameStats[stat];
        }
    });

    return { homeTeam, awayTeam, homeScore, awayScore, gameLog, breakthroughs };
}


function updatePlayerStatuses() {
     for (const player of game.players) { if (player.status.duration > 0) { player.status.duration--; if (player.status.duration === 0) { player.status.type = 'healthy'; player.status.description = ''; } } if (player.breakthroughAttr) { delete player.breakthroughAttr; } if (player.status.isNew) { player.status.isNew = false; } }
}

function endOfWeekCleanup() {
    game.teams.forEach(team => { team.roster = team.roster.filter(p => p.status.type !== 'temporary'); });
}


function generateWeeklyEvents() {
    for (const player of game.players) { if (player.status.type === 'healthy') { for (const event of weeklyEvents) { if (Math.random() < event.chance) { player.status.type = event.type; player.status.description = event.description; player.status.duration = getRandomInt(event.minDuration, event.maxDuration); player.status.isNew = true; if (player.teamId === game.playerTeam.id) { addMessage('Player Status Update', `${player.name} will be unavailable for ${player.status.duration} week(s): ${player.status.description}`); } break; } } } }
}

export function simulateWeek() {
    if (game.currentWeek >= 9) {
        console.log("Simulate Week: End of season. Returning null.");
        return null;
    }
    
    endOfWeekCleanup();
    updatePlayerStatuses();
    generateWeeklyEvents();
    game.breakthroughs = [];

    const gamesPerWeek = game.teams.length / 2;
    const startIndex = game.currentWeek * gamesPerWeek;
    const endIndex = startIndex + gamesPerWeek;
    
    console.log(`Simulating Week ${game.currentWeek + 1}: Slicing schedule from index ${startIndex} to ${endIndex}. Total schedule length: ${game.schedule.length}`);

    const weeklyGames = game.schedule.slice(startIndex, endIndex);
    
    if (!weeklyGames || weeklyGames.length === 0) {
        console.error("CRITICAL ERROR: No games found for the current week.");
        return [];
    }
    
    console.log(`Found ${weeklyGames.length} games to simulate.`);

    const results = weeklyGames.map(match => {
        const result = simulateGame(match.home, match.away);
        if(result.breakthroughs) {
            result.breakthroughs.forEach(b => {
                if (b.player.teamId === game.playerTeam.id) {
                    addMessage("Player Breakthrough!", `${b.player.name} improved ${b.attr}!`);
                }
            });
            game.breakthroughs.push(...result.breakthroughs);
        }
        return result;
    });
    
    game.gameResults.push(...results);
    game.currentWeek++;
    console.log(`Simulation complete. Advancing to week ${game.currentWeek + 1}.`);
    return results;
}

export function generateWeeklyFreeAgents() {
    const undraftedPlayers = game.players.filter(p => !p.teamId);
    game.freeAgents = [];
    for (let i = 0; i < 5; i++) {
        if (undraftedPlayers.length > 0) {
            const faIndex = getRandomInt(0, undraftedPlayers.length - 1);
            const fa = undraftedPlayers.splice(faIndex, 1)[0];
            fa.relationship = getRandom(['Best Friend', 'Good Friend', 'Acquaintance']);
            game.freeAgents.push(fa);
        }
    }
}

export function callFriend(playerId) {
    const team = game.playerTeam;
    if (!team.roster.some(p => p.status.duration > 0)) {
        return { success: false, message: "You can only call a friend if a player on your team is injured or busy." };
    }

    const player = game.freeAgents.find(p => p.id === playerId);
    if (!player) return { success: false, message: "That player is no longer available." };

    const successRates = { 'Best Friend': 0.9, 'Good Friend': 0.6, 'Acquaintance': 0.3 };
    const successChance = successRates[player.relationship] || 0.3;

    if (Math.random() < successChance) {
        player.status = { type: 'temporary', description: 'Helping Out', duration: 1 };
        team.roster.push(player);
        game.freeAgents = game.freeAgents.filter(p => p.id !== playerId);
        const message = `${player.name} agreed to play!`;
        addMessage("Roster Update", message);
        return { success: true, message };
    } else {
        game.freeAgents = game.freeAgents.filter(p => p.id !== playerId);
        const message = `${player.name} couldn't make it.`;
        addMessage("Roster Update", message);
        return { success: false, message };
    }
}


export function aiManageRoster(team) {
    const healthyCount = team.roster.filter(p => p.status.duration === 0).length;
    
    if (healthyCount < 7 && game.freeAgents.length > 0) {
        const bestFA = game.freeAgents.reduce((best, p) => getPlayerScore(p, team.coach) > getPlayerScore(best, team.coach) ? p : best);
        
        const successRates = { 'Best Friend': 0.9, 'Good Friend': 0.6, 'Acquaintance': 0.3 };
        const successChance = successRates[bestFA.relationship] || 0.3;
        if (Math.random() < successChance) {
            bestFA.status = { type: 'temporary', description: 'Helping Out', duration: 1 };
            team.roster.push(bestFA);
            game.freeAgents = game.freeAgents.filter(p => p.id !== bestFA.id);
        }
    }
}

function developPlayer(player) {
    const developmentReport = { player, improvements: [] };
    let potential = player.age < 12 ? getRandomInt(2, 5) : player.age < 16 ? getRandomInt(1, 3) : getRandomInt(0, 1);
    const attributesToImprove = ['speed', 'strength', 'agility', 'throwingAccuracy', 'catchingHands', 'tackling', 'blocking', 'playbookIQ', 'blockShedding', 'toughness'];
    
    for (let i = 0; i < potential; i++) {
        const attrToBoost = getRandom(attributesToImprove);
        for (const category in player.attributes) {
            if (player.attributes[category][attrToBoost] && player.attributes[category][attrToBoost] < 99) {
                const increase = 1;
                player.attributes[category][attrToBoost] += increase;
                const existing = developmentReport.improvements.find(imp => imp.attr === attrToBoost);
                if(existing) existing.increase += increase;
                else developmentReport.improvements.push({ attr: attrToBoost, increase });
                break;
            }
        }
    }

    const heightGain = player.age <= 12 ? getRandomInt(1, 3) : player.age <= 15 ? getRandomInt(0, 2) : getRandomInt(0, 1);
    const weightGain = player.age <= 12 ? getRandomInt(5, 15) : player.age <= 15 ? getRandomInt(3, 10) : getRandomInt(1, 5);
    if(heightGain > 0) developmentReport.improvements.push({ attr: 'height', increase: heightGain });
    if(weightGain > 0) developmentReport.improvements.push({ attr: 'weight', increase: weightGain });

    player.attributes.physical.height += heightGain;
    player.attributes.physical.weight += weightGain;
    
    return developmentReport;
}

export function advanceToOffseason() {
    game.year++; 
    const retiredPlayers = [];
    const hofInductees = [];
    const developmentResults = [];
    const leavingPlayers = []; 
    
    let totalVacancies = 0;
    game.teams.forEach(team => team.draftNeeds = 0); 

    game.teams.forEach(team => {
        const roster = [...team.roster]; 
        team.roster = []; 

        roster.forEach(player => {
            player.age++; 
            player.careerStats.seasonsPlayed++; 
            
            if (team.id === game.playerTeam.id) {
                developmentResults.push(developPlayer(player));
            } else {
                 developPlayer(player); 
            }

            let playerIsLeaving = false;
            
            if (player.age >= 18) {
                retiredPlayers.push(player);
                playerIsLeaving = true;
                if (team.id === game.playerTeam.id) {
                    addMessage("Player Retires", `${player.name} graduated.`);
                }
                if (player.careerStats.touchdowns > 20 || player.careerStats.passYards > 5000 || player.careerStats.tackles > 200) {
                    game.hallOfFame.push(player);
                    hofInductees.push(player);
                    if (team.id === game.playerTeam.id) {
                         addMessage("Hall of Fame", `${player.name} inducted!`);
                    }
                }
            } else {
                 for(const event of offseasonDepartureEvents) {
                     if (Math.random() < event.chance) {
                         leavingPlayers.push({player, reason: event.reason});
                         playerIsLeaving = true;
                         if (team.id === game.playerTeam.id) {
                             addMessage("Player Leaving", `${player.name}: ${event.reason}.`);
                         }
                         break;
                     }
                 }
                 if (!playerIsLeaving && team.id === game.playerTeam.id && Math.random() < transferEventChance) {
                     leavingPlayers.push({player, reason: 'Asked to leave'});
                     playerIsLeaving = true;
                     addMessage("Transfer Request", `${player.name} leaves.`);
                 }
            }

            if (!playerIsLeaving) {
                player.seasonStats = { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0, sacks: 0, interceptions: 0 };
                player.status = { type: 'healthy', description: '', duration: 0 };
                team.roster.push(player); 
            } else {
                 player.teamId = null; 
                 team.draftNeeds++;
                 totalVacancies++;
            }
        });
         if (team.depthChart) {
            const offenseSlots = offenseFormations[team.formations.offense].slots;
            const defenseSlots = defenseFormations[team.formations.defense].slots;
            team.depthChart.offense = Object.fromEntries(offenseSlots.map(s => [s, null]));
            team.depthChart.defense = Object.fromEntries(defSlots.map(s => [s, null]));
            aiSetDepthChart(team); 
         }
         team.wins = 0; 
         team.losses = 0;
    });

    const undrafted = game.players.filter(p => !p.teamId && p.age < 17); 
    if (game.playerTeam.roster.length < 10 && Math.random() < joinRequestChance && undrafted.length > 0) {
        const joining = getRandom(undrafted);
        addPlayerToTeam(joining, game.playerTeam);
        game.playerTeam.draftNeeds = Math.max(0, game.playerTeam.draftNeeds -1); 
        totalVacancies--;
        addMessage("Roster Update", `${joining.name} asked to join!`);
    }
    
    addMessage("Offseason", `${totalVacancies} roster spots opened.`);
    const rookieCount = Math.max(totalVacancies, 10); 
    for (let i = 0; i < rookieCount; i++) game.players.push(generatePlayer(8, 10));

    return { retiredPlayers, hofInductees, developmentResults, leavingPlayers };
}


export function updateDepthChart(playerId, newPositionSlot, side) {
    const team = game.playerTeam;
    const chart = team.depthChart[side];
    
    const oldSlot = Object.keys(chart).find(key => chart[key] === playerId);
    const displacedPlayerId = chart[newPositionSlot];
    
    chart[newPositionSlot] = playerId;

    if (oldSlot) {
        chart[oldSlot] = displacedPlayerId || null;
    }
}


export function changeFormation(side, formationName) {
    const team = game.playerTeam;
    const formation = side === 'offense' ? offenseFormations[formationName] : defenseFormations[formationName];
    if (!formation) return;

    team.formations[side] = formationName;
    
    // Create a new empty chart based on the new formation's slots
    const newChart = Object.fromEntries(formation.slots.map(slot => [slot, null]));
    team.depthChart[side] = newChart;

    // Call aiSetDepthChart to intelligently fill the new, empty chart
    aiSetDepthChart(team); 
}


export function getGameState() { return game; }

export function getBreakthroughs() { return game.breakthroughs || []; }

export function markMessageAsRead(messageId) {
     const message = game.messages.find(m => m.id === messageId); if(message) { message.isRead = true; }
}

export function playerCut(playerId) {
    const team = game.playerTeam; const idx = team.roster.findIndex(p => p.id === playerId); if (idx > -1) { const p = team.roster[idx]; team.roster.splice(idx, 1); p.teamId = null; for(const s in team.depthChart) { for(const sl in team.depthChart[s]) { if(team.depthChart[s][sl] === playerId) { team.depthChart[s][sl] = null; } } } aiSetDepthChart(team); addMessage("Roster Move", `${p.name} cut.`); return { success: true }; } return { success: false };
}

export function playerSignFreeAgent(playerId) {
     const team = game.playerTeam; if (team.roster.length >= 10) { return { success: false, message: "Roster full." }; } const p = game.players.find(pl => pl.id === playerId && !pl.teamId); if (p) { addPlayerToTeam(p, team); addMessage("Roster Move", `${p.name} joined!`); return { success: true }; } return { success: false };
}

