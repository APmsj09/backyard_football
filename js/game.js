import { getRandom, getRandomInt } from './utils.js';
import { firstNames, lastNames, nicknames, teamNames, positions, divisionNames, coachPersonalities, offenseFormations, defenseFormations, ZONES, routeTree, offensivePlaybook } from './data.js'; // Import ZONES and new playbook data

let game = null;

const offensivePositions = ['QB', 'RB', 'WR', 'OL'];
const defensivePositions = ['DL', 'LB', 'DB'];

// ... (weeklyEvents, offseasonDepartureEvents, etc. remain the same) ...
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

function calculateSlotSuitability(player, slot, side, team) {
    const formationName = team.formations[side];
    const formationData = side === 'offense' ? offenseFormations[formationName] : defenseFormations[formationName];
    if (!formationData || !formationData.slotPriorities || !formationData.slotPriorities[slot]) {
        return calculateOverall(player, slot.replace(/\d/g, ''));
    }

    const priorities = formationData.slotPriorities[slot];
    let score = 0;
    let totalWeight = 0;

    for (const attr in priorities) {
        let found = false;
        for (const category in player.attributes) {
            if (player.attributes[category][attr] !== undefined) {
                let value = player.attributes[category][attr];
                if (attr === 'weight') value = value / 2.5;
                if (attr === 'height') value = (value - 60);
                score += value * priorities[attr];
                totalWeight += priorities[attr];
                found = true;
                break;
            }
        }
    }
    
    const baseOverall = calculateOverall(player, slot.replace(/\d/g, ''));
    const finalScore = (score / (totalWeight || 1)) * 0.7 + (baseOverall * 0.3); 

    return Math.min(99, Math.max(1, Math.round(finalScore)));
}


function generatePlayer(minAge = 8, maxAge = 17) {
    // ... (This function is unchanged from your provided version)
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
    // ... (This function is unchanged from your provided version)
    console.log("Initializing league...");
    game = { year: 1, teams: [], players: [], freeAgents: [], playerTeam: null, schedule: [], currentWeek: 0, divisions: {}, draftOrder: [], currentPick: 0, hallOfFame: [], gameResults: [], messages: [] };
    addMessage("Welcome to the League!", "Your new season is about to begin. Get ready to draft your team!");
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
    // ... (This function is unchanged from your provided version)
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
    // ... (This function is unchanged from your provided version)
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
    // ... (This function is unchanged from your provided version)
    game.draftOrder = [];
    game.currentPick = 0;
    const sortedTeams = [...game.teams].sort((a, b) => a.wins - b.wins || b.losses - a.losses);
    const maxNeeds = Math.max(0, ...game.teams.map(t => t.draftNeeds));
    for (let i = 0; i < maxNeeds; i++) {
        game.draftOrder.push(...(i % 2 === 0 ? sortedTeams : [...sortedTeams].reverse()));
    }
    console.log(`Draft setup with ${maxNeeds} rounds, total picks: ${game.draftOrder.length}`);
}


export function aiSetDepthChart(team) {
    // ... (This function is unchanged from your provided version)
    const { roster, depthChart } = team;
    if (!roster || roster.length === 0) return;
    for (const side in depthChart) {
         for (const slot in depthChart[side]) {
             depthChart[side][slot] = null;
         }
     }
    for (const side in depthChart) {
        const slots = Object.keys(depthChart[side]);
        let availablePlayers = [...roster];
        slots.sort((a, b) => {
            if(a.startsWith('QB')) return -1; if(b.startsWith('QB')) return 1;
            if(a.startsWith('RB')) return -1; if(b.startsWith('RB')) return 1;
            if(a.startsWith('WR1')) return -1; if(b.startsWith('WR1')) return 1;
            return 0;
        });
        slots.forEach(slot => {
            if (availablePlayers.length > 0) {
                const bestPlayerForSlot = availablePlayers.reduce((best, current) => {
                    const bestSuitability = calculateSlotSuitability(best, slot, side, team);
                    const currentSuitability = calculateSlotSuitability(current, slot, side, team);
                    const otherSide = side === 'offense' ? 'defense' : 'offense';
                    const isStartingCriticalOtherSideBest = (team.depthChart[otherSide]['QB1'] && team.depthChart[otherSide]['QB1'] === best.id) || 
                                                              (team.depthChart[otherSide]['RB1'] && team.depthChart[otherSide]['RB1'] === best.id);
                    const isStartingCriticalOtherSideCurrent = (team.depthChart[otherSide]['QB1'] && team.depthChart[otherSide]['QB1'] === current.id) || 
                                                                 (team.depthChart[otherSide]['RB1'] && team.depthChart[otherSide]['RB1'] === current.id);
                    if (isStartingCriticalOtherSideBest && !isStartingCriticalOtherSideCurrent) return current;
                    if (!isStartingCriticalOtherSideBest && isStartingCriticalOtherSideCurrent) return best;
                    return currentSuitability > bestSuitability ? current : best;
                });
                team.depthChart[side][slot] = bestPlayerForSlot.id;
                 availablePlayers = availablePlayers.filter(p => p.id !== bestPlayerForSlot.id); 
            }
        });
    }
}


export function simulateAIPick(team) {
    // ... (This function is unchanged from your provided version)
    if (team.roster.length >= 10) { return null; }
    const undraftedPlayers = game.players.filter(p => !p.teamId);
    if (undraftedPlayers.length === 0) return null;
    const bestPlayer = undraftedPlayers.reduce((best, current) => {
        const score = getPlayerScore(current, team.coach);
        return score > best.score ? { player: current, score } : best;
    }, { player: null, score: -1 }).player;
    if (bestPlayer) { addPlayerToTeam(bestPlayer, team); }
    return bestPlayer;
}

export function addPlayerToTeam(player, team) {
    // ... (This function is unchanged from your provided version)
    player.teamId = team.id; team.roster.push(player); return true;
}


export function generateSchedule() {
    // ... (This function is unchanged from your provided version)
    game.schedule = []; game.currentWeek = 0; const allWeeklyGames = Array(9).fill(null).map(() => []);
    for (const divisionName in game.divisions) {
        let teams = [...game.teams.filter(t => t.division === divisionName)];
        if (teams.length !== 10) { console.error(`Scheduling Error: Division ${divisionName} requires 10 teams.`); continue; }
        const numWeeks = 9; const numTeams = 10;
        for (let round = 0; round < numWeeks; round++) {
            for (let match = 0; match < numTeams / 2; match++) {
                const home = teams[match]; const away = teams[numTeams - 1 - match];
                 if (home && away) { const matchup = round % 2 === 1 ? { home, away } : { home: away, away: home }; allWeeklyGames[round].push(matchup); }
            }
            teams.splice(1, 0, teams.pop());
        }
    }
    game.schedule = allWeeklyGames.flat(); console.log(`Schedule generated: ${game.schedule.length} total games.`);
}


function resetGameStats() {
    // ... (This function is unchanged from your provided version)
    game.players.forEach(player => {
        player.fatigue = 0;
        player.gameStats = { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0, sacks: 0, interceptions: 0 };
    });
}

function checkInGameInjury(player, gameLog) {
    // ... (This function is unchanged from your provided version)
    if (!player || player.status.duration > 0) return; const injuryChance = 0.008; const toughnessModifier = (100 - player.attributes.mental.toughness) / 100;
    if (Math.random() < injuryChance * toughnessModifier) {
        const duration = getRandomInt(1, 3); player.status.type = 'injured'; player.status.description = 'Minor Injury'; player.status.duration = duration; player.status.isNew = true;
        if(gameLog) gameLog.push(`INJURY: ${player.name} out for ${duration} week(s).`);
    }
}

function getBestSub(team, position, usedPlayerIds) {
    // ... (This function is unchanged from your provided version)
    const availableSubs = team.roster.filter(p => p.status.duration === 0 && !usedPlayerIds.has(p.id));
    if (availableSubs.length === 0) return null;
    return availableSubs.reduce((best, current) => (calculateOverall(current, position) > calculateOverall(best, position)) ? current : best, availableSubs[0]);
}

function getPlayersForSlots(team, side, slotPrefix, usedPlayerIdsThisPlay) {
    // ... (This function is unchanged from your provided version)
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


function determinePlayCall(offense, defense, down, yardsToGo, ballOn, scoreDiff, gameLog, drivesRemaining) {
    // ... (This function is unchanged from your provided version)
    const { coach } = offense;
    const offenseFormation = offenseFormations[offense.formations.offense];
    const defenseFormation = defenseFormations[defense.formations.defense];
    if (!offenseFormation || !offenseFormation.personnel || !defenseFormation || !defenseFormation.personnel) {
        console.error(`CRITICAL ERROR: Formation data is missing for ${offense.name} or ${defense.name}.`);
        return { type: 'run', zone: ZONES.RUN_C, route: 'run_inside', targetSlot: 'RB1' }; 
    }
    const usedIds = new Set(); const qb = getPlayersForSlots(offense, 'offense', 'QB', usedIds)[0]?.player;
    const rb = getPlayersForSlots(offense, 'offense', 'RB', usedIds)[0]?.player;
    const qbStrength = qb ? calculateOverall(qb, 'QB') : 0; const rbStrength = rb ? calculateOverall(rb, 'RB') : 0;
    let passChance = 0.45;
    if (offenseFormation.personnel.WR > defenseFormation.personnel.DB + 1) passChance += 0.2; if (offenseFormation.personnel.RB + offenseFormation.personnel.OL > defenseFormation.personnel.DL + defenseFormation.personnel.LB + 1) passChance -= 0.2;
    if (qbStrength < 50 && rbStrength > 50) { passChance -= 0.25; } if (rbStrength < 50 && qbStrength > 50) passChance += 0.15; if(qbStrength > rbStrength + 15) passChance += 0.1; if(rbStrength > qbStrength + 15) passChance -= 0.1;
    if (down === 3 && yardsToGo > 6) passChance += 0.4; if (down === 4 && yardsToGo > 3) passChance = 0.95; if (yardsToGo <= 2) passChance -= 0.4; if (ballOn > 80) passChance += 0.1; if (scoreDiff < -10) passChance += 0.2; if (scoreDiff > 14 && drivesRemaining < 3) passChance -= 0.3;
    if(coach.type === 'Ground and Pound') passChance -= 0.3; if(coach.type === 'West Coast Offense') passChance += 0.2; if (coach.type === 'Spread') passChance += 0.25;
    if (yardsToGo <= 1 && qbStrength > 60 && Math.random() < 0.6) { return { type: 'run', zone: ZONES.SNEAK, route: 'QB_Sneak', targetSlot: 'QB1' }; }
    if (Math.random() < passChance) {
        const deep = (yardsToGo > 15 || (ballOn < 50 && scoreDiff < -7 && drivesRemaining < 5)); const screen = (down <= 2 && yardsToGo < 7 && qbStrength < 70); const pa = (down <= 2 && yardsToGo > 5 && rbStrength > 60);
        const availablePassCatchers = Object.keys(offenseFormation.routes).filter(s => s.startsWith('WR') || s.startsWith('RB'));
        if (availablePassCatchers.length === 0) return { type: 'run', zone: ZONES.RUN_C, route: 'run_inside', targetSlot: 'RB1' };
        const targetSlot = getRandom(availablePassCatchers);
        let possibleRoutes = offenseFormation.routes[targetSlot].filter(r => r !== 'block_pass' && r !== 'block_run');
        if (possibleRoutes.length === 0) possibleRoutes = ['Slant'];
        let routeName;
        if (screen && possibleRoutes.includes('Screen')) routeName = 'Screen';
        else if (deep && possibleRoutes.some(r => routeTree[r] && routeTree[r].zones.some(z => z.includes('Deep')))) { routeName = getRandom(possibleRoutes.filter(r => routeTree[r] && routeTree[r].zones.some(z => z.includes('Deep')))) || getRandom(possibleRoutes); }
        else if (yardsToGo <= 7 && possibleRoutes.some(r => routeTree[r] && routeTree[r].zones.some(z => z.includes('Short')))) { routeName = getRandom(possibleRoutes.filter(r => routeTree[r] && routeTree[r].zones.some(z => z.includes('Short')))) || getRandom(possibleRoutes); }
        else { routeName = getRandom(possibleRoutes); }
        if (!routeTree[routeName]) { console.error(`Invalid routeName selected: ${routeName}`); routeName = 'Slant'; }
        return { type: 'pass', zone: routeTree[routeName].zones[0], route: routeName, targetSlot, playAction: (pa && Math.random() < 0.3) };
    } else {
        const outside = (rb && rb.attributes.physical.speed > 75); let zone = ZONES.RUN_C; if(outside && Math.random() < 0.4) { zone = Math.random() < 0.5 ? ZONES.RUN_L : ZONES.RUN_R; }
        return { type: 'run', zone: zone, route: zone, targetSlot: 'RB1' };
    }
}

/**
 * NEW: resolveBattle helper function
 * This function resolves a single 1-on-1 battle for one tick.
 * @returns {object} The updated battleState.
 */
function resolveBattle(powerA, powerB, battleState, log, logPrefix) {
    const DOMINANT_WIN = 20;
    const SLIGHT_WIN = 5;
    const diff = (powerA + getRandomInt(-5, 5)) - (powerB + getRandomInt(-5, 5));

    if (diff > DOMINANT_WIN) { // Dominant Win for A
        battleState.status = 'win_A';
        if(log && Math.random() < 0.5) log.push(`${logPrefix} DOMINANT WIN`);
    } else if (diff > SLIGHT_WIN) { // Slight Win for A
        battleState.streakA++;
        battleState.streakB = 0;
        if(log && Math.random() < 0.2) log.push(`${logPrefix} slight win A (streak ${battleState.streakA})`);
        if (battleState.streakA >= 2) battleState.status = 'win_A';
    } else if (diff < -DOMINANT_WIN) { // Dominant Win for B
        battleState.status = 'win_B';
        if(log && Math.random() < 0.5) log.push(`${logPrefix} DOMINANT WIN B`);
    } else if (diff < -SLIGHT_WIN) { // Slight Win for B
        battleState.streakB++;
        battleState.streakA = 0;
        if(log && Math.random() < 0.2) log.push(`${logPrefix} slight win B (streak ${battleState.streakB})`);
        if (battleState.streakB >= 2) battleState.status = 'win_B';
    } else { // Draw
        battleState.streakA = 0;
        battleState.streakB = 0;
        if(log && Math.random() < 0.1) log.push(`${logPrefix} draw`);
    }
    return battleState;
}


/**
 * NEW: Tick-based play simulation
 */
function resolvePlay(offense, defense, playCall, gameState) {
    const { gameLog, weather, ballOn } = gameState;
    const { type, zone, route, targetSlot, playAction } = playCall;
    const usedPlayerIds_O = new Set();
    const usedPlayerIds_D = new Set();
    const getFatigueModifier = (p) => (p ? (1 - (p.fatigue / (p.attributes.physical.stamina * 3))) : 1);
    
    const findEmergencyPlayer = (position, team, side = 'offense', usedPlayerIds) => { 
        const available = team.roster.filter(p => p.status.duration === 0 && !usedPlayerIds.has(p.id));
        if (available.length === 0) return null;
        const bestPlayer = available.reduce((best, current) =>
            calculateOverall(current, position) > calculateOverall(best, position) ? current : best,
            available[0]
        );
        if (gameLog) gameLog.push(`EMERGENCY (${team.name}): ${bestPlayer.name} has to fill in at ${position}!`);
        usedPlayerIds.add(bestPlayer.id);
        return { player: bestPlayer, slot: `SUB_${position}` };
    };

    const getPlayerBySlot = (team, side, slot) => {
        let player = team.roster.find(p => p.id === team.depthChart[side][slot]);
        const usedPlayerIds = side === 'offense' ? usedPlayerIds_O : usedPlayerIds_D;
        if (!player || player.status.duration > 0 || usedPlayerIds.has(player.id)) {
             player = getBestSub(team, slot.replace(/\d/g,''), usedPlayerIds);
        }
        if (player && !usedPlayerIds.has(player.id)) {
            usedPlayerIds.add(player.id);
            return player;
        }
        return null;
    };
    
    // --- Apply Fatigue ---
    [...offense.roster, ...defense.roster].forEach(p => { if(p) p.fatigue = Math.min(100, p.fatigue + 5); });

    // --- QB SNEAK (Instant resolve, not tick-based) ---
    if (zone === ZONES.SNEAK) { 
        let qb = getPlayerBySlot(offense, 'offense', 'QB1') || findEmergencyPlayer('QB', offense, 'offense', usedPlayerIds_O)?.player;
        if (!qb) return { yards: 0, turnover: true };
        checkInGameInjury(qb, gameLog);
        const qbPower = (qb.attributes.physical.strength + qb.attributes.physical.weight / 5) * getFatigueModifier(qb);
        const dlStopper = getPlayerBySlot(defense, 'defense', 'DL2') || getPlayerBySlot(defense, 'defense', 'DL1') || findEmergencyPlayer('DL', defense, 'defense', usedPlayerIds_D)?.player;
        if (!dlStopper) return { yards: 1, touchdown: ballOn + 1 >= 100 };
        checkInGameInjury(dlStopper, gameLog);
        const dlPower = (dlStopper.attributes.physical.strength + dlStopper.attributes.technical.blockShedding) * getFatigueModifier(dlStopper);
        const diff = qbPower - (dlPower + getRandomInt(-10, 10));
        let yards = 0;
        if (diff > 5) yards = getRandomInt(1, 3);
        else if (diff < -5) yards = 0;
        else yards = getRandomInt(0, 1);
        if (yards > 0) gameLog.push(`QB Sneak by ${qb.name} for ${yards} yards!`);
        else { gameLog.push(`QB Sneak stuffed by ${dlStopper.name}!`); dlStopper.gameStats.tackles++; }
        const touchdown = ballOn + yards >= 100;
        if (touchdown) qb.gameStats.touchdowns++;
        return { yards, touchdown };
    }

    // --- Initialize Play ---
    let qb = getPlayerBySlot(offense, 'offense', 'QB1') || findEmergencyPlayer('QB', offense, 'offense', usedPlayerIds_O)?.player;
    if (!qb) { gameLog.push('No healthy QB!'); return { yards: 0, turnover: true }; }
    
    const play = offensivePlaybook[route];
    if (!play) { console.error(`Play ${route} not in playbook!`); return {yards: 0}; }

    const offenseFormationData = offenseFormations[offense.formations.offense];
    const defenseFormationData = defenseFormations[defense.formations.defense];

    // --- Initialize Battles ---
    const battleStates = {
        passRush: [], // { blocker, rusher, status: 'ongoing', streakA: 0, streakB: 0 }
        coverage: [], // { receiver, defender, status: 'covered', separation: 0, streakA: 0, streakB: 0, route: '...' }
        runBlock: [] // { blocker, defender, status: 'ongoing', streakA: 0, streakB: 0 }
    };
    
    // 1. Setup Pass Rush Battles
    const passRushers = dls.concat(lbs.filter(p => {
        const slot = Object.keys(defense.depthChart.defense).find(s => defense.depthChart.defense[s] === p.id);
        return slot && defenseFormationData.routes[slot] && !defenseFormationData.routes[slot].some(r => r.includes('cover'));
    })).filter(Boolean);
    const blockers = ols.concat(rbs.filter(r => {
         const slot = Object.keys(offense.depthChart.offense).find(s => offense.depthChart.offense[s] === r.id);
         return slot && offenseFormationData.routes[slot] && offenseFormationData.routes[slot].includes('block_pass');
    })).filter(Boolean);
    
    let availableBlockers = [...blockers];
    let unblockedRusher = null;
    const bestRusher = passRushers.length > 0 ? passRushers.reduce((best, p) => calculateOverall(p, 'DL') > calculateOverall(best, 'DL') ? p : best, passRushers[0]) : null;

    passRushers.forEach(rusher => {
        if (availableBlockers.length === 0) {
            unblockedRusher = rusher; // BLITZ!
            return;
        }
        let blocker = availableBlockers.pop();
        let isDoubleTeam = false;
        if (availableBlockers.length > passRushers.length - battleStates.passRush.length && bestRusher && rusher.id === bestRusher.id) {
             const helper = availableBlockers.pop();
             if(helper) {
                 blocker = [blocker, helper]; // Double team!
                 isDoubleTeam = true;
             }
        }
        battleStates.passRush.push({ blockers: Array.isArray(blocker) ? blocker : [blocker], rusher, status: 'ongoing', streakA: 0, streakB: 0, isDoubleTeam });
    });

    // 2. Setup Coverage Battles
    Object.keys(play.assignments).filter(slot => slot.startsWith('WR') || slot.startsWith('RB')).forEach(slot => {
        const receiver = (getPlayersForSlots(offense, 'offense', slot.substring(0,2), usedPlayerIds_O).find(p => p.slot === slot) || {}).player;
        if (!receiver) return;
        
        const routeName = play.assignments[slot];
        const routeInfo = routeTree[routeName];
        if (!routeInfo || routeName.includes('block')) return;
        
        const targetZone = routeInfo.zones[0];
        const coverageSlots = Object.keys(defenseFormationData.zoneAssignments).filter(s => routeInfo.zones.includes(defenseFormationData.zoneAssignments[s]));
        const defendersInZone = coverageSlots.map(s => getPlayerBySlot(defense, 'defense', s)).filter(Boolean);

        let primaryDefender = defendersInZone[0] || getRandom(dbs.concat(lbs).filter(p => p && !defenseUsedIds.has(p.id))) || findEmergencyPlayer('DB', defense, 'defense', defenseUsedIds);
        if (!primaryDefender) {
            battleStates.coverage.push({ receiver, defender: null, status: 'open', separation: 5, streakA: 2, streakB: 0, route: routeInfo });
            return;
        }
        
        defenseUsedIds.add(primaryDefender.id);
        battleStates.coverage.push({ receiver, defender: primaryDefender, status: 'covered', separation: 0, streakA: 0, streakB: 0, route: routeInfo });
    });

    // 3. Setup Run Block Battles
    if(type === 'run') {
        const olsAtPOA = ols.filter(ol => offenseFormationData.zoneAssignments[ol.slot]?.includes(zone.split(' ')[1])); // L, C, R
        const dlsAtPOA = dls.filter(dl => defenseFormationData.zoneAssignments[dl.slot]?.includes(zone.split(' ')[1]));
        const blockers = olsAtPOA.length > 0 ? olsAtPOA : ols;
        const defenders = dlsAtPOA.length > 0 ? dlsAtPOA : dls;
        
        blockers.forEach(blocker => {
            const defender = getRandom(defenders);
            if(defender) {
                battleStates.runBlock.push({ blocker, defender, status: 'ongoing', streakA: 0, streakB: 0 });
                defenders.splice(defenders.indexOf(defender), 1); // Remove defender from pool
            }
        });
    }

    // --- Tick Loop ---
    const maxTicks = getRandomInt(3, 5); // 3-5 ticks per play
    let pressure = false;
    let sack = false;
    let yards = 0;
    let touchdown = false;
    let turnover = false;

    for (let tick = 1; tick <= maxTicks; tick++) {
        if (playCall.type === 'pass') {
            // -- 1. Update Pass Rush --
            if (unblockedRusher) {
                pressure = true;
                if(tick > 1) { sack = true; gameLog.push(`SACK! Unblocked rusher ${unblockedRusher.name} gets the QB!`); rusherWhoWon.gameStats.sacks++; rusherWhoWon.gameStats.tackles++; yards = -getRandomInt(5,10); }
                else gameLog.push(`Blitz! ${unblockedRusher.name} is coming free!`);
            } else {
                battleStates.passRush.forEach(battle => {
                    if (battle.status === 'ongoing') {
                        let blockPower = battle.blockers.reduce((sum, p) => sum + (p.attributes.physical.strength + p.attributes.technical.blocking) * getFatigueModifier(p), 0);
                        if (battle.isDoubleTeam) blockPower *= 1.5; // Double team bonus
                        let rushPower = (battle.rusher.attributes.physical.strength + battle.rusher.attributes.technical.blockShedding) * getFatigueModifier(battle.rusher);
                        
                        battle = resolveBattle(blockPower, rushPower, battle, gameLog, `Block (${battle.blockers[0].name}) vs Rush (${battle.rusher.name})`);
                        
                        if (battle.status === 'win_B') {
                            pressure = true;
                            rusherWhoWon = battle.rusher;
                            gameLog.push(`${rusherWhoWon.name} beats ${battle.blockers[0].name}!`);
                        }
                    }
                });
            }

            // -- 2. Update Coverage --
            battleStates.coverage.forEach(battle => {
                if (battle.status !== 'open' && battle.defender) {
                    let recPower = (battle.receiver.attributes.physical.speed + battle.receiver.attributes.physical.agility) * getFatigueModifier(battle.receiver);
                    let defPower = (battle.defender.attributes.physical.speed + battle.defender.attributes.physical.agility) * getFatigueModifier(battle.defender);
                    if(battle.route.zones[0].includes('Short')) recPower += 10; // Advantage on short routes
                    
                    battle = resolveBattle(recPower, defPower, battle, null, '');
                    
                    if (battle.status === 'win_A') {
                         battle.separation = (battle.streakA * 2) + getRandomInt(1, 3); // 2 slight wins = 5 separation
                         gameLog.push(`${battle.receiver.name} starts to get open!`);
                    } else if (battle.status === 'win_B') {
                        battle.separation = -3;
                        gameLog.push(`${battle.defender.name} is blanketing ${battle.receiver.name}!`);
                    }
                }
            });

            // -- 3. QB Action --
            if (pressure && !sack) {
                const evadeCheck = (qb.attributes.physical.agility + qb.attributes.physical.speed) * getFatigueModifier(qb);
                const containCheck = (rusherWhoWon.attributes.physical.agility + rusherWhoWon.attributes.physical.speed) * getFatigueModifier(rusherWhoWon);
                if (evadeCheck > containCheck + getRandomInt(-10, 20)) {
                    gameLog.push(`${qb.name} evades the rush!`);
                    pressure = 'stalemate'; // Escaped, but still hurried
                } else {
                    const breakSackCheck = qb.attributes.physical.strength * getFatigueModifier(qb);
                    const sackCheck = (rusherWhoWon.attributes.physical.strength + rusherWhoWon.attributes.technical.tackling) * getFatigueModifier(rusherWhoWon);
                    if (breakSackCheck < sackCheck + getRandomInt(-10, 25)) {
                        if (qb.attributes.mental.playbookIQ > 70 && Math.random() < 0.4) {
                            gameLog.push(`${qb.name} throws it away under pressure!`);
                            return { yards: 0, incomplete: true };
                        }
                        sack = true;
                        yards = -getRandomInt(4, 8);
                        gameLog.push(`SACK! ${rusherWhoWon.name} gets ${qb.name} for a loss of ${yards}.`);
                        rusherWhoWon.gameStats.sacks++; rusherWhoWon.gameStats.tackles++;
                    } else {
                         gameLog.push(`${qb.name} shrugs off ${rusherWhoWon.name}!`);
                         pressure = 'stalemate'; // Broke tackle, but hurried
                    }
                }
            }

            if(sack) return { yards };

            // Check if QB throws
            const openReceivers = battleStates.coverage.filter(b => b.status === 'open' || b.separation > 3);
            const throwTime = (qb.attributes.mental.playbookIQ / 30); // 90 IQ = 3 ticks to read
            
            if (pressure || tick > throwTime || (openReceivers.length > 0 && Math.random() < 0.5) || tick === maxTicks) {
                 // --- THROW THE BALL ---
                 let targetBattle = openReceivers.length > 0 ? openReceivers.reduce((best, c) => c.separation > best.separation ? c : best, openReceivers[0]) : 
                                    battleStates.coverage.reduce((best, c) => c.separation > best.separation ? c : best, battleStates.coverage[0]);
                
                 if (!targetBattle) return { yards: 0, incomplete: true }; // No one to throw to

                 let target = targetBattle.player;
                 let defender = targetBattle.defender;
                 let separation = targetBattle.separation;
                 
                 let qbAccuracy = qb.attributes.technical.throwingAccuracy * getFatigueModifier(qb);
                 if(pressure === 'stalemate') qbAccuracy -= 10;
                 if(pressure === true) qbAccuracy -= 20;

                 if (getRandomInt(1, 100) > qbAccuracy) { gameLog.push(`INCOMPLETE. Bad throw by ${qb.name}.`); return { yards: 0 }; }

                 let catchContest = target.attributes.technical.catchingHands + (separation * 2) - (weather === 'Rain' ? 10 : 0);
                 let defendContest = defender ? (defender.attributes.technical.catchingHands + defender.attributes.physical.agility) * getFatigueModifier(defender) : 0;
                 
                 if (catchContest > defendContest + getRandomInt(-20, 20)) { // CATCH
                     const routeInfo = routeTree[targetBattle.route];
                     let base_yards = getRandomInt(routeInfo.baseYards[0], routeInfo.baseYards[1]);
                     target.gameStats.receptions++;
                     gameLog.push(`${targetBattle.route} pass from ${qb.name} to ${target.name} for ${base_yards} yards.`);

                     // YAC Battle
                     const jukePower = target.attributes.physical.agility * getFatigueModifier(target) * (separation > 5 ? 1.2 : 0.8); 
                     const grapplePower = defender.attributes.technical.tackling + defender.attributes.physical.agility;
                     let extraYards = 0;
                     let tackled = false;

                     if (jukePower <= grapplePower + getRandomInt(-25, 25)) { // Grapple
                         const bringDownPower = (defender.attributes.technical.tackling + defender.attributes.physical.strength) * getFatigueModifier(defender);
                         const breakPower = target.attributes.physical.strength * getFatigueModifier(target);
                         const tackleDiff = bringDownPower - (breakPower + getRandomInt(-25, 35)); 

                         if (tackleDiff > DRAW_THRESHOLD) { 
                             gameLog.push(`${defender.name} makes the tackle!`);
                             defender.gameStats.tackles++;
                             tackled = true;
                         } else if (tackleDiff < -DRAW_THRESHOLD) { 
                             extraYards = getRandomInt(5, 20);
                             gameLog.push(`${target.name} breaks the tackle!`);
                         } else { 
                             extraYards = getRandomInt(1, 4);
                             gameLog.push(`${target.name} drags ${defender.name}!`);
                             defender.gameStats.tackles++;
                             tackled = true;
                         }
                     } else { 
                          extraYards = getRandomInt(5, 20);
                          if (gameLog) gameLog.push(`${target.name} makes ${defender.name} miss!`);
                     }
                     
                     // Safety Help
                     if (!tackled && (extraYards > 0 || routeInfo.zones[0].includes('Deep'))) {
                         const safety = getRandom(dbs.filter(p => p && p.id !== defender.id)) || getRandom(lbs.filter(p => p && p.id !== defender.id));
                         if(safety) {
                             if(gameLog) gameLog.push(`Brought down by ${safety.name}.`);
                             safety.gameStats.tackles++;
                         }
                     }

                     const totalYards = base_yards + extraYards;
                     touchdown = ballOn + totalYards >= 100;
                     if (touchdown) target.gameStats.touchdowns++;
                     target.gameStats.recYards += totalYards; qb.gameStats.passYards += totalYards;
                     return { yards: totalYards, touchdown };
                 } else { // Incomplete/INT
                    if ((defender.attributes.technical.catchingHands / 100) > Math.random() * 2.8) { 
                        gameLog.push(`INTERCEPTION! ${defender.name} jumps the route!`);
                        defender.gameStats.interceptions++;
                        return { yards: 0, turnover: true };
                    }
                    gameLog.push(`INCOMPLETE to ${target.name}, defended by ${defender.name}.`);
                    return { yards: 0 };
                 }
            }
            // QB holds ball, loop continues
        
        } else {
            // --- Run Play Tick ---
            if (tick === 1) { // Line battle
                let lineWins = 0;
                let lineDraws = 0;
                battleStates.runBlock.forEach(battle => {
                    const blockPower = (battle.blocker.attributes.technical.blocking + battle.blocker.attributes.physical.strength) * getFatigueModifier(battle.blocker);
                    const shedPower = (battle.defender.attributes.technical.blockShedding + battle.defender.attributes.physical.strength) * getFatigueModifier(battle.defender);
                    battle = resolveBattle(blockPower, shedPower, battle, gameLog, `Block (${battle.blocker.name}) vs Shed (${battle.defender.name})`);
                    if(battle.status === 'win_A') lineWins++;
                    if(battle.status === 'ongoing') lineDraws++;
                });
                
                const blockWinPercent = (lineWins + lineDraws * 0.5) / (battleStates.runBlock.length || 1);
                if (blockWinPercent > 0.7) {
                    yards = getRandomInt(4, 8); gameLog.push("A huge hole opens up!");
                } else if (blockWinPercent > 0.4) {
                    yards = getRandomInt(1, 3); gameLog.push("RB finds a small crease.");
                } else {
                    yards = getRandomInt(-2, 1); gameLog.push("Run is stuffed at the line!");
                    return { yards }; // Play ends
                }
            }
            
            if(tick === 2 && yards > 0) { // Second level battle
                let rb = rbs[0] || findEmergencyPlayer('RB', offense);
                const tackler = getRandom(lbs.filter(Boolean)) || findEmergencyPlayer('LB', defense);
                if (!tackler) { yards += getRandomInt(5, 10); return { yards }; } // No LB, auto gain
                
                const grapplePower = (tackler.attributes.technical.tackling + tackler.attributes.physical.agility) * getFatigueModifier(tackler);
                const jukePower = rb.attributes.physical.agility * getFatigueModifier(rb);
                const grappleDiff = grapplePower - (jukePower + getRandomInt(-25, 25));

                if (grappleDiff > DRAW_THRESHOLD) { // Grappled
                    const bringDownPower = (tackler.attributes.physical.strength + tackler.attributes.technical.tackling) * getFatigueModifier(tackler);
                    const breakPower = rb.attributes.physical.strength * getFatigueModifier(rb);
                    const tackleDiff = bringDownPower - (breakPower + getRandomInt(-30, 25));

                    if (tackleDiff > DRAW_THRESHOLD) { gameLog.push(`Met and tackled by ${tackler.name}.`); tackler.gameStats.tackles++; return { yards }; }
                    else if (tackleDiff < -DRAW_THRESHOLD) { const y = getRandomInt(5, 10); yards += y; gameLog.push(`${rb.name} breaks the tackle of ${tackler.name}! Gains ${y} more.`); }
                    else { const y = getRandomInt(1, 3); yards += y; gameLog.push(`${rb.name} drags ${tackler.name} for ${y} yards.`); tackler.gameStats.tackles++; return { yards }; }
                } else { // Juked
                    const y = getRandomInt(5, 10); yards += y; gameLog.push(`${rb.name} jukes past ${tackler.name}!`);
                }
            }

            if(tick === 3 && yards > 5) { // Third level battle
                 let rb = rbs[0] || findEmergencyPlayer('RB', offense);
                 const safety = getRandom(dbs.filter(Boolean)) || findEmergencyPlayer('DB', defense);
                 if (!safety) { yards += getRandomInt(10, 20); return { yards }; } // No safety, big gain
                 
                 const chasePower = (safety.attributes.physical.speed + safety.attributes.physical.agility) * getFatigueModifier(safety);
                 const runSpeed = rb.attributes.physical.speed * getFatigueModifier(rb);
                 
                 if(chasePower > runSpeed + getRandomInt(-10, 10)) {
                     gameLog.push(`Caught from behind by ${safety.name}!`);
                     safety.gameStats.tackles++;
                     return { yards };
                 } else {
                     const y = getRandomInt(10, 30);
                     yards += y;
                     gameLog.push(`${rb.name} outruns the safety!`);
                     // Final check for TD
                     touchdown = ballOn + yards >= 100;
                     if(touchdown) { rb.gameStats.touchdowns++; gameLog.push("...and he's gone!"); }
                     rb.gameStats.rushYards += yards;
                     return { yards, touchdown, turnover: false };
                 }
            }
        }
    }
    
    // Default end of play if loop finishes (e.g. QB held ball too long)
    if(type === 'pass') {
        gameLog.push(`QB ${qb.name} held the ball too long!`);
        return { yards: 0, incomplete: true };
    }
    
    // Fallback for run plays
    let rb = rbs[0] || findEmergencyPlayer('RB', offense);
    if (!rb) return { yards: 0, turnover: true };
    touchdown = ballOn + yards >= 100;
    if (touchdown) rb.gameStats.touchdowns++;
    rb.gameStats.rushYards += yards;
    return { yards, touchdown, turnover: false };
}


function simulateGame(homeTeam, awayTeam) {
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
            const playCall = determinePlayCall(possession, defense, down, yardsToGo, ballOn, scoreDiff, gameLog, drivesRemainingInGame);
            const result = resolvePlay(possession, defense, playCall, { gameLog, weather, down, yardsToGo, ballOn });

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

