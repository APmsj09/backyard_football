import { getRandom, getRandomInt } from './utils.js';
import { firstNames, lastNames, nicknames, teamNames, positions, divisionNames, coachPersonalities, offenseFormations, defenseFormations, ZONES } from './data.js';

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

// NEW: Offseason events causing players to leave
const offseasonDepartureEvents = [
    { reason: 'Moved Away', chance: 0.03 },
    { reason: 'Focusing on another sport', chance: 0.02 },
    { reason: 'Decided to quit', chance: 0.01 }
];
const transferEventChance = 0.02; // Chance a player asks to leave player team
const joinRequestChance = 0.03; // Chance an undrafted player asks to join player team

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

// NEW: Calculate a player's suitability for a *specific* formation slot
function calculateSlotSuitability(player, slot, side, team) {
    const formationName = team.formations[side];
    const formationData = side === 'offense' ? offenseFormations[formationName] : defenseFormations[formationName];
    if (!formationData || !formationData.slotPriorities || !formationData.slotPriorities[slot]) {
        // Fallback to general position overall if slot priorities aren't defined
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
            if(a.startsWith('QB')) return -1;
            if(b.startsWith('QB')) return 1;
            if(a.startsWith('RB')) return -1;
            if(b.startsWith('RB')) return 1;
            if(a.startsWith('WR1')) return -1;
            if(b.startsWith('WR1')) return 1;
            return 0;
        });

        slots.forEach(slot => {
            if (availablePlayers.length > 0) {
                // Find the player with the highest suitability for *this specific slot*
                const bestPlayerForSlot = availablePlayers.reduce((best, current) => {
                    const bestSuitability = calculateSlotSuitability(best, slot, side, team);
                    const currentSuitability = calculateSlotSuitability(current, slot, side, team);

                    // Check if they are *already* starting on the *other* side in a *critical* role (QB/RB)
                    const otherSide = side === 'offense' ? 'defense' : 'offense';
                    const isStartingCriticalOtherSideBest = team.depthChart[otherSide]['QB1'] === best.id || (team.depthChart[otherSide]['RB1'] && team.depthChart[otherSide]['RB1'] === best.id);
                    const isStartingCriticalOtherSideCurrent = team.depthChart[otherSide]['QB1'] === current.id || (team.depthChart[otherSide]['RB1'] && team.depthChart[otherSide]['RB1'] === current.id);
                    
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
        // console.log(`${team.name} roster full, skipping pick.`); 
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
        // console.log(`${team.name} drafts ${bestPlayer.name}`); 
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
            activePlayers.push(player);
            usedPlayerIdsThisPlay.add(player.id); // Mark used for this play
        }
    });
    return activePlayers;
}


function determinePlayCall(offense, defense, down, yardsToGo, ballOn, scoreDiff, gameLog, drivesRemaining) {
    const { coach } = offense;
    
    const offenseFormation = offenseFormations[offense.formations.offense];
    const defenseFormation = defenseFormations[defense.formations.defense];
    
    if (!offenseFormation || !offenseFormation.personnel || !defenseFormation || !defenseFormation.personnel) {
        console.error(`CRITICAL ERROR: Formation data is missing for ${offense.name} or ${defense.name}.`);
        return { type: 'run', zone: ZONES.RUN_C }; 
    }

    const usedIds = new Set();
    const qb = getPlayersForSlots(offense, 'offense', 'QB', usedIds)[0];
    const rb = getPlayersForSlots(offense, 'offense', 'RB', usedIds)[0];

    const qbStrength = qb ? calculateOverall(qb, 'QB') : 0;
    const rbStrength = rb ? calculateOverall(rb, 'RB') : 0;

    let passChance = 0.45;

    if (offenseFormation.personnel.WR > defenseFormation.personnel.DB + 1) passChance += 0.2; 
    if (offenseFormation.personnel.RB + offenseFormation.personnel.OL > defenseFormation.personnel.DL + defenseFormation.personnel.LB + 1) passChance -= 0.2;
    if (qbStrength < 50 && rbStrength > 50) { 
        passChance -= 0.25;
        if(gameLog) gameLog.push(`${offense.name} may rely on the run.`);
    }
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

    if (yardsToGo <= 1 && qbStrength > 60 && Math.random() < 0.6) return { type: 'pass', zone: ZONES.SNEAK }; 
    
    if (Math.random() < passChance) {
        const deep = (yardsToGo > 15 || (ballOn < 50 && scoreDiff < -7 && drivesRemaining < 5));
        const screen = (down <= 2 && yardsToGo < 7 && qbStrength < 70);
        const pa = (down <= 2 && yardsToGo > 5 && rbStrength > 60);

        if(screen && Math.random() < 0.3) return { type: 'pass', zone: Math.random() < 0.5 ? ZONES.SCREEN_L : ZONES.SCREEN_R };
        if(pa && Math.random() < 0.2) return { type: 'pass', zone: getRandom([ZONES.DEEP_L, ZONES.DEEP_C, ZONES.DEEP_R]), playAction: true };
        if(deep && Math.random() < 0.4) return { type: 'pass', zone: getRandom([ZONES.DEEP_L, ZONES.DEEP_C, ZONES.DEEP_R]) };
        return { type: 'pass', zone: getRandom([ZONES.SHORT_L, ZONES.SHORT_C, ZONES.SHORT_R, ZONES.MED_L, ZONES.MED_C, ZONES.MED_R]) };
    } else {
        const outside = (rb && rb.attributes.physical.speed > 75);
        if(outside && Math.random() < 0.4) return { type: 'run', zone: Math.random() < 0.5 ? ZONES.RUN_L : ZONES.RUN_R };
        return { type: 'run', zone: ZONES.RUN_C };
    }
}

/**
 * NEW: Overhauled resolvePlay with 1-on-1 matchups, double teams, and QB pressure drill.
 */
function resolvePlay(offense, defense, playCall, gameState) {
    const { gameLog, weather, ballOn } = gameState;
    const { type, zone, playAction } = playCall;
    const usedPlayerIds = new Set();
    const getFatigueModifier = (p) => (p ? (1 - (p.fatigue / (p.attributes.physical.stamina * 2.5))) : 1);
    const DRAW_THRESHOLD = 5;

    const findEmergencyPlayer = (position, team, side = 'offense') => { 
        const available = team.roster.filter(p => p.status.duration === 0 && !usedPlayerIds.has(p.id));
        if (available.length === 0) return null;
        const bestPlayer = available.reduce((best, current) =>
            calculateOverall(current, position) > calculateOverall(best, position) ? current : best,
            available[0]
        );
        if (gameLog) gameLog.push(`EMERGENCY (${team.name}): ${bestPlayer.name} has to fill in at ${position}!`);
        usedPlayerIds.add(bestPlayer.id);
        return bestPlayer;
    };
    
    // --- Get Defensive Players ---
    const defenseUsedIds = new Set();
    const dls = getPlayersForSlots(defense, 'defense', 'DL', defenseUsedIds);
    const lbs = getPlayersForSlots(defense, 'defense', 'LB', defenseUsedIds);
    const dbs = getPlayersForSlots(defense, 'defense', 'DB', defenseUsedIds);
    [...dls, ...lbs, ...dbs].forEach(p => { if (p) p.fatigue = Math.min(100, p.fatigue + 5); });
    
    // --- Get Offensive Players ---
    let qb = getPlayersForSlots(offense, 'offense', 'QB', usedPlayerIds)[0] || findEmergencyPlayer('QB', offense);
    const rbs = getPlayersForSlots(offense, 'offense', 'RB', usedPlayerIds);
    const wrs = getPlayersForSlots(offense, 'offense', 'WR', usedPlayerIds);
    const ols = getPlayersForSlots(offense, 'offense', 'OL', usedPlayerIds);
    [qb, ...rbs, ...wrs, ...ols].forEach(p => { if (p) p.fatigue = Math.min(100, p.fatigue + 5); });


    // --- QB Sneak ---
    if (zone === ZONES.SNEAK) { 
         if (!qb) return { yards: 0, turnover: true };
         checkInGameInjury(qb, gameLog);
         const qbPower = (qb.attributes.physical.strength + qb.attributes.physical.weight / 5) * getFatigueModifier(qb);
         const dlStopper = getPlayersForSlots(defense, 'defense', 'DL', defenseUsedIds)[0] || findEmergencyPlayer('DL', defense); 
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

    // --- Run Plays ---
    if (type === 'run') {
        let rb = rbs[0] || findEmergencyPlayer('RB', offense);
        if (!rb) { if(gameLog) gameLog.push('No healthy RB available! Broken play.'); return { yards: 0, turnover: true }; }
        
        let blockers = [...ols];
        let defenders = [...dls, ...lbs];
        let yards = 0;
        let blockWinBonus = (zone === ZONES.RUN_C) ? 10 : -10; // Bonus for inside, penalty for outside

        // --- Line Battle (Team-based) ---
        let totalBlockPower = blockers.reduce((sum, p) => sum + (p.attributes.technical.blocking + p.attributes.physical.strength) * getFatigueModifier(p), 0);
        let totalShedPower = defenders.reduce((sum, p) => sum + (p.attributes.technical.blockShedding + p.attributes.physical.strength) * getFatigueModifier(p), 0);

        // Check for double team
        if (blockers.length > defenders.length) {
            totalBlockPower *= 1.25; // 25% bonus for numerical advantage
            if (gameLog && Math.random() < 0.3) gameLog.push("Offense gets a good push with the double team!");
        }

        const blockDiff = totalBlockPower - (totalShedPower + getRandomInt(-20, 30) - blockWinBonus); // Tuned for offense

        if(blockDiff > DRAW_THRESHOLD + 10) { // Clear win for offense
            yards = (zone === ZONES.RUN_C) ? getRandomInt(3, 7) : getRandomInt(4, 9); // Increased base yards
            if (gameLog && Math.random() < 0.5) gameLog.push(`A huge hole opens up!`);
        } else if (blockDiff < -DRAW_THRESHOLD - 10) { // Clear win for defense
             yards = getRandomInt(-2, 1);
             const tackler = getRandom(defenders);
             if(gameLog) gameLog.push(`${tackler.name} blows up the play in the backfield!`);
             if (tackler) tackler.gameStats.tackles++; 
        } else { // Draw/Stalemate
             yards = getRandomInt(0, 2);
             if(gameLog) gameLog.push(`Stalemate at the line.`);
        }
        
        // --- Second Level Tackle ---
        const tackler = getRandom(dbs.concat(lbs).filter(p => !defenseUsedIds.has(p?.id))) || findEmergencyPlayer('LB', defense);
        if (tackler && yards > -1) { // Only check second level if not tackled for loss
            checkInGameInjury(rb, gameLog); checkInGameInjury(tackler, gameLog);
            const grapplePower = (tackler.attributes.technical.tackling + tackler.attributes.physical.agility) * getFatigueModifier(tackler);
            const jukePower = rb.attributes.physical.agility * getFatigueModifier(rb) * (zone !== ZONES.RUN_C ? 1.1 : 0.9);
            const grappleDiff = grapplePower - (jukePower + getRandomInt(-25, 25));

            if(grappleDiff > DRAW_THRESHOLD) { // Grapple succeeds
                const bringDownPower = (tackler.attributes.physical.strength + tackler.attributes.technical.tackling) * getFatigueModifier(tackler);
                const breakPower = rb.attributes.physical.strength * getFatigueModifier(rb);
                // BALANCING: Made tackle breaking slightly easier for RB
                const tackleDiff = bringDownPower - (breakPower + getRandomInt(-30, 25)); 

                if(tackleDiff > DRAW_THRESHOLD) { // Tackler wins
                    if(gameLog) gameLog.push(`Met by ${tackler.name} and brought down.`);
                    tackler.gameStats.tackles++;
                } else if (tackleDiff < -DRAW_THRESHOLD) { // Runner breaks tackle
                    const extraYards = getRandomInt(5, 15);
                    if(gameLog) gameLog.push(`${rb.name} runs through ${tackler.name} for an extra ${extraYards} yards!`);
                    yards += extraYards;
                } else { // Draw = drag tackler
                    const dragYards = getRandomInt(1, 4);
                    yards += dragYards;
                    if(gameLog) gameLog.push(`${rb.name} drags ${tackler.name} for ${dragYards} extra yards!`);
                    tackler.gameStats.tackles++;
                }
            } else { // Grapple fails (juke)
                const extraYards = (zone === ZONES.RUN_C) ? getRandomInt(5, 10) : getRandomInt(7, 20);
                if(gameLog) gameLog.push(`${rb.name} jukes past ${tackler.name} into open space! Gains ${extraYards} yards.`);
                yards += extraYards;
            }

            let fumbleChance = (weather === 'Rain' ? 0.06 : 0.03);
            if (Math.random() < fumbleChance && (rb.attributes.technical.catchingHands * getFatigueModifier(rb)) < tackler.attributes.physical.strength) {
                if(gameLog) gameLog.push(`FUMBLE! ${tackler.name} forces it out!`);
                return { yards, turnover: true };
            }
        }
        
        const touchdown = ballOn + yards >= 100;
        if (touchdown) rb.gameStats.touchdowns++;
        rb.gameStats.rushYards += yards;
        if (gameLog) gameLog.push(`${playCall.zone} by ${rb.name} for a total of ${yards} yards.`);
        return { yards, touchdown, turnover: false };
    }

    // --- Pass Plays ---
    if (type === 'pass') {
        if (!qb) { if(gameLog) gameLog.push('No one could step in at QB! Broken play.'); return { yards: 0, turnover: true }; }
        
        let playActionSuccess = playAction; 
        if (playAction) {
             const defenseIQ = lbs.reduce((s, p) => p ? s + p.attributes.mental.playbookIQ : s, 0) / (lbs.length || 1);
             if (qb.attributes.mental.consistency < defenseIQ + getRandomInt(-20, 20)) {
                 if(gameLog) gameLog.push(`Defense reads the play action!`);
                 playActionSuccess = false; 
             } else {
                  if(gameLog) gameLog.push(`Play action fake fools the defense!`);
             }
        }

        const passRushers = dls.concat(lbs).filter(Boolean);
        const blockers = ols.filter(Boolean);
        if (blockers.length === 0) { return { yards: 0, turnover: true, incomplete: true }; } // Auto-pressure if no blockers

        // *** NEW TEAM-BASED RUSH/BLOCK BATTLE ***
        const blockerCount = blockers.length;
        const rusherCount = passRushers.length;
        let pressure = false;
        let rusherWhoWon = null;
        let qbAccuracy = qb.attributes.technical.throwingAccuracy * getFatigueModifier(qb) * (playActionSuccess ? 1.1 : 1);
        
        if (rusherCount > blockerCount) {
            // --- BLITZ / UNBLOCKED RUSHER ---
            pressure = true;
            rusherWhoWon = getRandom(passRushers); // Simulates a free runner
            if(gameLog) gameLog.push(`Blitz! ${rusherWhoWon.name} comes in unblocked!`);
            qbAccuracy -= 20; // Heavy accuracy penalty
        } else {
            // --- 1-on-1 & DOUBLE TEAM LOGIC ---
            let availableBlockers = [...blockers];
            const canDoubleTeam = blockerCount > rusherCount;
            const bestRusher = passRushers.reduce((best, p) => calculateOverall(p, 'DL') > calculateOverall(best, 'DL') ? p : best, passRushers[0]);

            for (const rusher of passRushers) {
                const blocker = availableBlockers.pop();
                if (!blocker) { // Should not happen if rusherCount <= blockerCount, but as failsafe
                     pressure = true; rusherWhoWon = rusher; break; 
                }
                
                let blockPower = (blocker.attributes.physical.strength + blocker.attributes.technical.blocking) * getFatigueModifier(blocker);
                
                // DOUBLE TEAM check
                if (canDoubleTeam && rusher.id === bestRusher.id && availableBlockers.length > 0) {
                    const helper = availableBlockers.pop();
                    if(helper) {
                        blockPower += (helper.attributes.technical.blocking + helper.attributes.physical.strength) * getFatigueModifier(helper) * 0.5; // Helper adds 50%
                        if(gameLog && Math.random() < 0.4) gameLog.push(`${blocker.name} & ${helper.name} double team ${rusher.name}!`);
                    }
                }
                
                checkInGameInjury(rusher, gameLog); checkInGameInjury(blocker, gameLog);
                const rushPower = (rusher.attributes.physical.strength + rusher.attributes.technical.blockShedding) * getFatigueModifier(rusher) * (playActionSuccess ? 0.8 : 1);
                // BALANCING: Adjusted pass block check
                const blockDiff = blockPower - (rushPower + getRandomInt(-15, 45)); // Tuned for offense

                if (blockDiff < -DRAW_THRESHOLD) { // Rusher wins
                    pressure = true; rusherWhoWon = rusher; break; // One rusher won, stop loop
                } else if (blockDiff < DRAW_THRESHOLD) { // Draw
                    pressure = "stalemate"; // Mark as stalemate, but continue loop
                }
                // Blocker wins, loop continues
            }
        }

        // --- QB PRESSURE DRILL ---
        if (pressure === true) {
            if(gameLog) gameLog.push(`${rusherWhoWon.name} gets pressure!`);
            const evadeCheck = (qb.attributes.physical.agility + qb.attributes.physical.speed) * getFatigueModifier(qb);
            const containCheck = (rusherWhoWon.attributes.physical.agility + rusherWhoWon.attributes.physical.speed) * getFatigueModifier(rusherWhoWon);

            if (evadeCheck > containCheck + getRandomInt(-10, 20)) {
                if(gameLog) gameLog.push(`${qb.name} evades the rush!`);
                qbAccuracy -= 8; // Minor accuracy penalty
            } else {
                const breakSackCheck = qb.attributes.physical.strength * getFatigueModifier(qb);
                const sackCheck = (rusherWhoWon.attributes.physical.strength + rusherWhoWon.attributes.technical.tackling) * getFatigueModifier(rusherWhoWon);
                
                if (breakSackCheck > sackCheck + getRandomInt(-10, 25)) {
                    if(gameLog) gameLog.push(`${qb.name} shrugs off ${rusherWhoWon.name}!`);
                    qbAccuracy -= 18; // Major accuracy penalty
                } else {
                    if (qb.attributes.mental.playbookIQ > 70 && Math.random() < 0.4) {
                        if(gameLog) gameLog.push(`${qb.name} is swarmed and throws the ball away!`);
                        return { yards: 0, incomplete: true };
                    } else {
                        const sackYards = getRandomInt(4, 8);
                        if(gameLog) gameLog.push(`SACK! ${rusherWhoWon.name} gets ${qb.name} for a loss of ${sackYards}.`);
                        rusherWhoWon.gameStats.sacks++; rusherWhoWon.gameStats.tackles++;
                        return { yards: -sackYards };
                    }
                }
            }
        } else if (pressure === "stalemate") {
            qbAccuracy -= zone.includes('DEEP') ? 5 : 2;
            if(gameLog && Math.random() < 0.3) gameLog.push(`Pocket collapsing slightly.`);
        }
        // --- END QB PRESSURE DRILL ---

        checkInGameInjury(qb, gameLog);
        // BALANCING: New accuracy check
        if (getRandomInt(1, 100) > qbAccuracy) { 
             if(gameLog) gameLog.push(`INCOMPLETE. Bad throw by ${qb.name}.`); 
             return { yards: 0 }; 
        }

        if(zone.includes('SHORT') || zone.includes('SCREEN')) {
            const tipper = getRandom(dls.filter(Boolean));
            if(tipper && tipper.attributes.physical.height > 70 && Math.random() < 0.1) {
                gameLog.push(`Ball is TIPPED at the line by ${tipper.name}!`);
                return { yards: 0 };
            }
        }

        const targets = [...wrs, ...rbs].filter(Boolean);
        if (targets.length === 0) return { yards: 0 };
        const coveragePlayers = [...dbs, ...lbs].filter(Boolean);
        if(coveragePlayers.length === 0) return { yards: 10 };
        
        let target, coverage = [], safetyHelp = null;
        const reads = targets.sort((a,b) => calculateOverall(b, 'WR') - calculateOverall(a, 'WR'));
        const availableDBs = [...dbs];
        const availableLBs = [...lbs];
        
        // BALANCING: Increased chance QB looks past primary read
        for(let i = 0; i < reads.length; i++) {
            target = reads[i];
            let primaryDefender = availableDBs.length > 0 ? getRandom(availableDBs) : getRandom(availableLBs);
            if (!primaryDefender) primaryDefender = findEmergencyPlayer('DB', defense);
            if (!primaryDefender) continue;

            coverage = [primaryDefender];
            availableDBs.splice(availableDBs.indexOf(primaryDefender), 1);
            
            let doubleCovered = false;
            if ((zone.includes('DEEP') || (i === 0 && Math.random() < 0.4)) && (availableDBs.length > 0 || availableLBs.length > 0)) {
                 safetyHelp = availableDBs.length > 0 ? getRandom(availableDBs) : getRandom(availableLBs);
                 if(safetyHelp) {
                     coverage.push(safetyHelp);
                     doubleCovered = true;
                     if(gameLog && i === 0) gameLog.push(`Defense is keying on ${target.name}!`);
                 }
            }
            
            const openFactor = (target.attributes.physical.speed * getFatigueModifier(target)) - (coverage[0].attributes.physical.agility * getFatigueModifier(coverage[0]));
            const effectiveOpenFactor = doubleCovered ? openFactor - 20 : openFactor;
            
            if(effectiveOpenFactor + (qb.attributes.mental.playbookIQ / 5) > getRandomInt(10, 45) || i === reads.length -1) { break; } 
            if (i < reads.length -1 && gameLog) gameLog.push(`${qb.name} looks off his #${i+1} read.`);
        }
        
        if (!target || coverage.length === 0) return {yards: 0}; 

        checkInGameInjury(target, gameLog); coverage.forEach(p => checkInGameInjury(p, gameLog));
        
        const primaryDefender = coverage[0];
        const separation = (target.attributes.physical.speed * getFatigueModifier(target)) - (primaryDefender.attributes.physical.speed * getFatigueModifier(primaryDefender));
        let catchContest = target.attributes.technical.catchingHands + (separation / 2);
        if (weather === 'Rain') catchContest -= 10;
        if (coverage.length > 1) catchContest -= 15;

        // BALANCING: Adjusted catch contest range
        if (catchContest > getRandomInt(15, 60)) { 
            if (weather === 'Rain' && target.attributes.technical.catchingHands < getRandomInt(30, 80)) {
                if(gameLog) gameLog.push(`DROP! ${target.name} drops the wet ball!`);
                return { yards: 0 };
            }

            const base_yards = zone.includes('DEEP') ? getRandomInt(15, 40) : (zone.includes('SCREEN') ? getRandomInt(-2, 5) : getRandomInt(3, 12));
            target.gameStats.receptions++;
            if (gameLog) gameLog.push(`${zone} pass from ${qb.name} to ${target.name} for ${base_yards} yards.`);

            const jukePower = target.attributes.physical.agility * getFatigueModifier(target) * (separation > 10 ? 1.2 : 0.8); 
            const grapplePower = primaryDefender.attributes.technical.tackling + primaryDefender.attributes.physical.agility;
            let extraYards = 0;
            let tackled = false;
            const grappleDiff = grapplePower - (jukePower + getRandomInt(-25, 25));

            if (grappleDiff > DRAW_THRESHOLD) { 
                const bringDownPower = (primaryDefender.attributes.technical.tackling + primaryDefender.attributes.physical.strength) * getFatigueModifier(primaryDefender);
                const breakPower = target.attributes.physical.strength * getFatigueModifier(target);
                // BALANCING: Made YAC tackle break slightly easier
                const tackleDiff = bringDownPower - (breakPower + getRandomInt(-25, 35)); 

                if (tackleDiff > DRAW_THRESHOLD) { 
                    if (gameLog) gameLog.push(`${primaryDefender.name} makes the tackle!`);
                    primaryDefender.gameStats.tackles++;
                    tackled = true;
                } else if (tackleDiff < -DRAW_THRESHOLD) { 
                    extraYards = getRandomInt(5, 20);
                    if (gameLog) gameLog.push(`${target.name} breaks the tackle attempt by ${primaryDefender.name} for an extra ${extraYards} yards!`);
                } else { 
                    extraYards = getRandomInt(1, 4);
                    if (gameLog) gameLog.push(`${target.name} drags ${primaryDefender.name} for ${extraYards} extra yards before going down!`);
                    primaryDefender.gameStats.tackles++;
                    tackled = true;
                }
            } else { 
                 extraYards = getRandomInt(5, 20);
                 if (gameLog) gameLog.push(`${target.name} makes ${primaryDefender.name} miss! Gains ${extraYards} yards after catch.`);
            }

            if (!tackled && (extraYards > 0 || zone.includes('DEEP'))) {
                 const secondTackler = coverage[1] || getRandom([...lbs, ...dbs].filter(p => p && p.id !== primaryDefender.id));
                 if (secondTackler) {
                      checkInGameInjury(secondTackler, gameLog);
                      const secondGrapple = (secondTackler.attributes.technical.tackling + secondTackler.attributes.physical.agility) > (target.attributes.physical.agility * getFatigueModifier(target) * 0.8);
                      if (secondGrapple) {
                          if(gameLog) gameLog.push(`Brought down by ${secondTackler.name}.`);
                          secondTackler.gameStats.tackles++;
                      } else {
                          extraYards += getRandomInt(5, 15);
                          if(gameLog) gameLog.push(`${target.name} avoids the second tackler!`);
                      }
                 }
            }
            
            const totalYards = base_yards + extraYards;
            const touchdown = ballOn + totalYards >= 100;
            if (touchdown) target.gameStats.touchdowns++;
            target.gameStats.recYards += totalYards; qb.gameStats.passYards += totalYards;
            return { yards: totalYards, touchdown };
        } else { 
            // BALANCING: Adjusted interception chance
            if ((primaryDefender.attributes.technical.catchingHands / 100) > Math.random() * 2.8) { 
                if (gameLog) gameLog.push(`INTERCEPTION! ${primaryDefender.name} jumps the route!`);
                primaryDefender.gameStats.interceptions++;
                return { yards: 0, turnover: true };
            }
            if (gameLog) gameLog.push(`INCOMPLETE to ${target.name}, defended by ${primaryDefender.name}.`);
            return { yards: 0 };
        }
    }

    return { yards: 0 };
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
                
                // TD stat is now recorded in resolvePlay
                
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

