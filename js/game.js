import { getRandom, getRandomInt } from './utils.js';
import { firstNames, lastNames, nicknames, teamNames, positions, divisionNames, coachPersonalities, offenseFormations, defenseFormations } from './data.js';

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

// --- Field Zones (Conceptual) ---
// Deep: L, C, R
// Medium: L, C, R
// Short (LOS): L, C, R
// Backfield: L, C, R (less used directly, more implied by run direction)

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


export function aiSetDepthChart(team) {
    const { roster, depthChart } = team;
    if (!roster || roster.length === 0) return; 

    for (const side in depthChart) {
        const slots = Object.keys(depthChart[side]);
        let availablePlayers = [...roster];
        
        slots.forEach(slot => {
            const position = slot.replace(/\d/g, '');
            if (availablePlayers.length > 0) {
                const bestPlayerForSlot = availablePlayers.reduce((best, current) => {
                     const isStartingOtherSideBest = Object.values(team.depthChart[side === 'offense' ? 'defense' : 'offense']).includes(best.id);
                     const isStartingOtherSideCurrent = Object.values(team.depthChart[side === 'offense' ? 'defense' : 'offense']).includes(current.id);
                     if (isStartingOtherSideBest && !isStartingOtherSideCurrent) return current;
                     if (!isStartingOtherSideBest && isStartingOtherSideCurrent) return best;
                    return calculateOverall(current, position) > calculateOverall(best, position) ? current : best;
                });
                
                team.depthChart[side][slot] = bestPlayerForSlot.id;
                availablePlayers = availablePlayers.filter(p => p.id !== bestPlayerForSlot.id);
            } else {
                 team.depthChart[side][slot] = null; 
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

function getPlayersForSlots(team, side, slotPrefix, usedPlayerIds) {
    const slots = Object.keys(team.depthChart[side]).filter(s => s.startsWith(slotPrefix));
    const position = slotPrefix.replace(/\d/g, '');
    const activePlayers = [];
    slots.forEach(slot => {
        let player = team.roster.find(p => p.id === team.depthChart[side][slot]);
        if (!player || player.status.duration > 0 || usedPlayerIds.has(player.id)) {
             player = getBestSub(team, position, usedPlayerIds);
        }
        if (player && !usedPlayerIds.has(player.id)) {
            activePlayers.push(player);
            usedPlayerIds.add(player.id);
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
        return 'run_inside'; 
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

    if (yardsToGo <= 1 && qbStrength > 60 && Math.random() < 0.6) return 'qb_sneak'; 
    
    if (Math.random() < passChance) {
        const deepPassChance = (yardsToGo > 15 || (ballOn < 50 && scoreDiff < -7 && drivesRemaining < 5)) ? 0.4 : 0.15;
        const screenPassChance = (down <= 2 && yardsToGo < 7 && qbStrength < 70) ? 0.3 : 0.05;
        const playActionChance = (down <= 2 && yardsToGo > 5 && rbStrength > 60) ? 0.2 : 0.05;

        const rand = Math.random();
        if (rand < screenPassChance) return 'screen_pass';
        if (rand < screenPassChance + playActionChance) return 'play_action_pass';
        if (rand < screenPassChance + playActionChance + deepPassChance) return 'deep_pass';
        return 'short_pass';
    } else {
        const outsideRunChance = (rb && rb.attributes.physical.speed > 75) ? 0.4 : 0.1;
        return Math.random() < outsideRunChance ? 'run_outside' : 'run_inside';
    }
}

// *** NEW DETAILED RESOLVE PLAY ***
function resolvePlay(offense, defense, playCall, gameState) {
    const { gameLog, weather, ballOn } = gameState; // Added ballOn
    const usedPlayerIds = new Set();
    const getFatigueModifier = (p) => (p ? (1 - (p.fatigue / (p.attributes.physical.stamina * 2.5))) : 1);
    const DRAW_THRESHOLD = 5; // How close attributes need to be for a draw

    const findEmergencyPlayer = (position, team) => {
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

    // --- Get Players on Field ---
    let qb = getPlayersForSlots(offense, 'offense', 'QB', usedPlayerIds)[0] || findEmergencyPlayer('QB', offense);
    const rbs = getPlayersForSlots(offense, 'offense', 'RB', usedPlayerIds);
    const wrs = getPlayersForSlots(offense, 'offense', 'WR', usedPlayerIds);
    const ols = getPlayersForSlots(offense, 'offense', 'OL', usedPlayerIds);

    const defenseUsedIds = new Set();
    const dls = getPlayersForSlots(defense, 'defense', 'DL', defenseUsedIds);
    const lbs = getPlayersForSlots(defense, 'defense', 'LB', defenseUsedIds);
    const dbs = getPlayersForSlots(defense, 'defense', 'DB', defenseUsedIds);

    // Apply fatigue
    [qb, ...rbs, ...wrs, ...ols, ...dls, ...lbs, ...dbs].forEach(p => { if (p) p.fatigue = Math.min(100, p.fatigue + 5); });

    // --- QB Sneak ---
    if (playCall === 'qb_sneak') {
        if (!qb) return { yards: 0, turnover: true };
        checkInGameInjury(qb, gameLog);
        const qbPower = (qb.attributes.physical.strength + qb.attributes.physical.weight / 5) * getFatigueModifier(qb);
        const dlStopper = getRandom(dls);
        if (!dlStopper) return { yards: 1, touchdown: ballOn + 1 >= 100 };
        checkInGameInjury(dlStopper, gameLog);
        const dlPower = (dlStopper.attributes.physical.strength + dlStopper.attributes.technical.blockShedding) * getFatigueModifier(dlStopper);
        
        const diff = qbPower - (dlPower + getRandomInt(-10, 10));
        let yards = 0;
        if (diff > DRAW_THRESHOLD) yards = getRandomInt(1, 3);
        else if (diff < -DRAW_THRESHOLD) yards = 0;
        else yards = getRandomInt(0, 1); // Draw = minimal gain possible

        if (yards > 0) gameLog.push(`QB Sneak by ${qb.name} for ${yards} yards!`);
        else { gameLog.push(`QB Sneak stuffed by ${dlStopper.name}!`); dlStopper.gameStats.tackles++; }
        const touchdown = ballOn + yards >= 100;
        if (touchdown) qb.gameStats.touchdowns++;
        return { yards, touchdown };
    }

    // --- Pass Plays ---
    if (playCall.includes('pass')) {
        if (!qb) { if (gameLog) gameLog.push('No one could step in at QB! Broken play.'); return { yards: 0, turnover: true }; }

        let playActionSuccess = false;
        if (playCall === 'play_action_pass') {
             const defenseIQ = lbs.reduce((s, p) => p ? s + p.attributes.mental.playbookIQ : s, 0) / (lbs.length || 1);
             if (qb.attributes.mental.consistency > defenseIQ + getRandomInt(-20, 20)) {
                 if(gameLog) gameLog.push(`Play action fake fools the defense!`);
                 playActionSuccess = true;
             } else {
                 if(gameLog) gameLog.push(`Defense reads the play action!`);
             }
        }

        const passRusher = getRandom(dls.concat(lbs).filter(Boolean));
        const blocker = getRandom(ols.filter(Boolean));
        if (!passRusher || !blocker) { return { yards: 0 }; }
        checkInGameInjury(passRusher, gameLog); checkInGameInjury(blocker, gameLog);

        const rushPower = (passRusher.attributes.physical.strength + passRusher.attributes.technical.blockShedding) * getFatigueModifier(passRusher) * (playActionSuccess ? 0.8 : 1);
        const blockPower = (blocker.attributes.physical.strength + blocker.attributes.technical.blocking) * getFatigueModifier(blocker);
        const blockDiff = blockPower - (rushPower + getRandomInt(-10, 35)); // Shifted random slightly for offense

        let qbAccuracy = qb.attributes.technical.throwingAccuracy * getFatigueModifier(qb) * (playActionSuccess ? 1.1 : 1);
        if (weather === 'Windy' && playCall === 'deep_pass') qbAccuracy -= 12;

        if (blockDiff < -DRAW_THRESHOLD) { // Rusher wins decisively
            qbAccuracy -= playCall === 'deep_pass' ? 15 : 8;
            if (gameLog) gameLog.push(`${passRusher.name} gets pressure!`);
            if (blockDiff < -20) { // Big win = Sack
                const sackYards = getRandomInt(4, 8);
                if (gameLog) gameLog.push(`SACK! ${passRusher.name} gets ${qb.name} for a loss of ${sackYards}.`);
                passRusher.gameStats.sacks++; passRusher.gameStats.tackles++;
                return { yards: -sackYards };
            }
        } else if (blockDiff < DRAW_THRESHOLD) { // Draw = Stalemate pressure
             qbAccuracy -= playCall === 'deep_pass' ? 5 : 2; // Minor accuracy penalty
             if(gameLog) gameLog.push(`Pocket collapsing slightly, ${qb.name} feels the heat.`);
        }
        // If blockDiff > DRAW_THRESHOLD, blocker wins, no accuracy penalty.

        checkInGameInjury(qb, gameLog);
        if (qbAccuracy < getRandomInt(10, 75)) { if (gameLog) gameLog.push(`INCOMPLETE. Bad throw by ${qb.name}.`); return { yards: 0 }; }

        const targets = [...wrs, ...rbs].filter(Boolean);
        if (targets.length === 0) return { yards: 0 };
        const coveragePlayers = [...dbs, ...lbs].filter(Boolean);
        if (coveragePlayers.length === 0) return { yards: 10 };

        let target, coverage = [], safetyHelp = null;
        const reads = targets.sort((a, b) => calculateOverall(b, 'WR') - calculateOverall(a, 'WR'));
        const availableDBs = [...dbs];
        const availableLBs = [...lbs];

        for (let i = 0; i < reads.length; i++) {
            target = reads[i];
            
            // Assign primary coverage
            let primaryDefender;
            if (availableDBs.length > 0) {
                 primaryDefender = getRandom(availableDBs);
                 availableDBs.splice(availableDBs.indexOf(primaryDefender), 1);
            } else if (availableLBs.length > 0) {
                 primaryDefender = getRandom(availableLBs);
                 availableLBs.splice(availableLBs.indexOf(primaryDefender), 1);
            } else { continue; } // Should not happen with enough players
            coverage = [primaryDefender];

            // Check for Double Coverage / Safety Help
             let doubleCovered = false;
            if (playCall === 'deep_pass' && availableDBs.length > 0) { // Safety help on deep balls
                 safetyHelp = getRandom(availableDBs);
                 coverage.push(safetyHelp);
                 doubleCovered = true;
                 if(gameLog) gameLog.push(`Safety ${safetyHelp.name} rotating over the top.`);
            } else if (defenseFormations[defense.formations.defense].personnel.DB > offenseFormations[offense.formations.offense].personnel.WR && i === 0 && Math.random() < 0.5 && availableDBs.length > 0) { // Double team #1 WR?
                const doubleTeamDB = getRandom(availableDBs);
                coverage.push(doubleTeamDB);
                doubleCovered = true;
                if(gameLog) gameLog.push(`Defense double-teams ${target.name}!`);
            }
            
            const targetSpeed = target.attributes.physical.speed * getFatigueModifier(target);
            const coverageAgility = coverage.reduce((sum, p) => sum + p.attributes.physical.agility * getFatigueModifier(p), 0) / coverage.length;
            const openFactor = targetSpeed - coverageAgility;
            
            if (openFactor + (qb.attributes.mental.playbookIQ / 5) > getRandomInt(doubleCovered ? 15 : 0, doubleCovered ? 45: 30) || i === reads.length - 1) {
                break; // Found target or last read
            }
            if (i < reads.length - 1 && gameLog) gameLog.push(`${qb.name} looks off read #${i + 1}.`);
        }
        
        if (!target || coverage.length === 0) return {yards: 0}; // Failsafe

        checkInGameInjury(target, gameLog); coverage.forEach(p => checkInGameInjury(p, gameLog));
        
        const primaryDefender = coverage[0];
        const separation = (target.attributes.physical.speed * getFatigueModifier(target)) - (primaryDefender.attributes.physical.speed * getFatigueModifier(primaryDefender));
        let catchContest = target.attributes.technical.catchingHands + (separation / 2);
        if (weather === 'Rain') catchContest -= 10;
        if (coverage.length > 1) catchContest -= 15; // Penalty for double coverage/safety help

        if (catchContest > getRandomInt(15, 55)) { // Catch more likely
            const base_yards = playCall === 'deep_pass' ? getRandomInt(15, 40) : (playCall === 'screen_pass' ? getRandomInt(-2, 5) : getRandomInt(3, 12));
            target.gameStats.receptions++;
            if (gameLog) gameLog.push(`${playCall.toUpperCase().replace('_', ' ')} from ${qb.name} to ${target.name} for ${base_yards} yards.`);

            // YAC Battle - Primary defender attempts tackle
            const jukePower = target.attributes.physical.agility * getFatigueModifier(target) * (separation > 10 ? 1.2 : 0.8);
            const grapplePower = primaryDefender.attributes.technical.tackling + primaryDefender.attributes.physical.agility;
            let extraYards = 0;
            let tackled = false;

            if (jukePower <= grapplePower + getRandomInt(-25, 25)) { // Grapple succeeds
                const bringDownPower = (primaryDefender.attributes.technical.tackling + primaryDefender.attributes.physical.strength) * getFatigueModifier(primaryDefender);
                const breakPower = target.attributes.physical.strength * getFatigueModifier(target);
                const tackleDiff = bringDownPower - (breakPower + getRandomInt(-35, 25));

                if (tackleDiff > DRAW_THRESHOLD) { // Defender wins bring down
                    if (gameLog) gameLog.push(`${primaryDefender.name} makes the tackle!`);
                    primaryDefender.gameStats.tackles++;
                    tackled = true;
                } else if (tackleDiff < -DRAW_THRESHOLD) { // Runner breaks tackle clearly
                    extraYards = getRandomInt(5, 20);
                    if (gameLog) gameLog.push(`${target.name} breaks the tackle attempt by ${primaryDefender.name} for an extra ${extraYards} yards!`);
                } else { // Draw on bring down = drag defender
                    extraYards = getRandomInt(1, 4);
                    if (gameLog) gameLog.push(`${target.name} drags ${primaryDefender.name} for ${extraYards} extra yards before going down!`);
                    primaryDefender.gameStats.tackles++;
                    tackled = true;
                }
            } else { // Grapple fails (juke successful)
                 extraYards = getRandomInt(5, 20);
                 if (gameLog) gameLog.push(`${target.name} makes ${primaryDefender.name} miss! Gains ${extraYards} yards after catch.`);
            }

            // Safety / Second Tackler check if not tackled
            if (!tackled && extraYards > 0) {
                 const secondTackler = coverage[1] || getRandom([...lbs, ...dbs].filter(p => p && p.id !== primaryDefender.id));
                 if (secondTackler) {
                      checkInGameInjury(secondTackler, gameLog);
                      const secondGrapple = (secondTackler.attributes.technical.tackling + secondTackler.attributes.physical.agility) > (target.attributes.physical.agility * getFatigueModifier(target) * 0.8); // Harder to tackle in open field
                      if (secondGrapple) {
                          if(gameLog) gameLog.push(`Brought down by ${secondTackler.name}.`);
                          secondTackler.gameStats.tackles++;
                          tackled = true;
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
        } else { // Catch fails
            if ((primaryDefender.attributes.technical.catchingHands / 100) > Math.random() * 2.5) {
                if (gameLog) gameLog.push(`INTERCEPTION! ${primaryDefender.name} jumps the route!`);
                primaryDefender.gameStats.interceptions++;
                return { yards: 0, turnover: true };
            }
            if (gameLog) gameLog.push(`INCOMPLETE to ${target.name}, defended by ${primaryDefender.name}.`);
            return { yards: 0 };
        }
    }

    if (playCall === 'run_inside' || playCall === 'run_outside') {
        let rb = rbs[0] || findEmergencyPlayer('RB', offense);
        if (!rb) { if(gameLog) gameLog.push('No healthy RB available! Broken play.'); return { yards: 0, turnover: true }; }
        usedPlayerIds.add(rb.id);

        const ols = getPlayersForSlots(offense, 'offense', 'OL', usedPlayerIds);
        const defenseUsedIds = new Set();
        const dls = getPlayersForSlots(defense, 'defense', 'DL', defenseUsedIds);
        const lbs = getPlayersForSlots(defense, 'defense', 'LB', defenseUsedIds);
        const dbs = getPlayersForSlots(defense, 'defense', 'DB', defenseUsedIds);
        
        [rb, ...ols, ...dls, ...lbs, ...dbs].forEach(p => { if(p) p.fatigue = Math.min(100, p.fatigue + 5); });

        const ol = getRandom(ols);
        const dl = getRandom(dls);
        if(!ol || !dl) return { yards: 0 };
        checkInGameInjury(rb, gameLog); checkInGameInjury(ol, gameLog); checkInGameInjury(dl, gameLog);
        
        let yards = 0;
        let blockWinBonus = playCall === 'run_outside' ? -10 : 0; 
        const blockPower = (ol.attributes.technical.blocking + ol.attributes.physical.strength) * getFatigueModifier(ol);
        const shedPower = (dl.attributes.technical.blockShedding + dl.attributes.physical.strength) * getFatigueModifier(dl);
        const blockDiff = blockPower - (shedPower + getRandomInt(-15, 45) - blockWinBonus); // Adjusted random for offense

        if(blockDiff > DRAW_THRESHOLD) { // OL wins
            yards = playCall === 'run_outside' ? getRandomInt(3, 9) : getRandomInt(2, 7); 
            if ((ol.attributes.physical.strength > dl.attributes.physical.strength + 20)) {
                if(gameLog) gameLog.push(`PANCAKE! ${ol.name} flattens ${dl.name}!`);
                yards += getRandomInt(3, 7);
            } else {
                 if(gameLog) gameLog.push(`${ol.name} seals off ${dl.name}.`);
            }
        } else if (blockDiff < -DRAW_THRESHOLD) { // DL Wins
             yards = getRandomInt(-2, 1);
             if(gameLog) gameLog.push(`${dl.name} sheds the block and gets penetration!`);
             dl.gameStats.tackles++;
        } else { // Draw = Stalemate
             yards = getRandomInt(0, 2);
             if(gameLog) gameLog.push(`Stalemate at the line.`);
             // Potentially assign partial tackle credit? For now, no tackle.
        }
        
        // --- Second Level Tackle ---
        const tackler = getRandom([...lbs, ...dbs].filter(Boolean));
        if (tackler && yards > 0) { // Only check second level if positive yards gained
            checkInGameInjury(tackler, gameLog);
            const grappleCheck = (tackler.attributes.technical.tackling + tackler.attributes.physical.agility) > (rb.attributes.physical.agility * getFatigueModifier(rb));
            if(grappleCheck) {
                const bringDownCheck = (tackler.attributes.physical.strength > rb.attributes.physical.strength * getFatigueModifier(rb) + getRandomInt(-40, 20)); 
                const tackleDiff = bringDownCheck - (rb.attributes.physical.strength * getFatigueModifier(rb) + getRandomInt(-40, 20));
                
                if(tackleDiff > DRAW_THRESHOLD) { // Tackler wins
                    if(gameLog) gameLog.push(`Met in the second level and tackled by ${tackler.name}.`);
                    tackler.gameStats.tackles++;
                } else if (tackleDiff < -DRAW_THRESHOLD) { // Runner breaks tackle
                    const extraYards = playCall === 'run_outside' ? getRandomInt(7, 20) : getRandomInt(5, 15);
                    if(gameLog) gameLog.push(`${rb.name} breaks through the second level past ${tackler.name} for an extra ${extraYards} yards!`);
                    yards += extraYards;
                } else { // Draw = drag tackler
                    const dragYards = getRandomInt(1, 4);
                    yards += dragYards;
                    if(gameLog) gameLog.push(`${rb.name} is wrapped up but drags ${tackler.name} for ${dragYards} extra yards!`);
                    tackler.gameStats.tackles++;
                }
            } else { // Grapple fails (juke)
                const extraYards = playCall === 'run_outside' ? getRandomInt(7, 20) : getRandomInt(5, 15);
                if(gameLog) gameLog.push(`${rb.name} ${playCall === 'run_outside' ? 'bounces outside and' : ''} jukes past ${tackler.name} for an extra ${extraYards} yards!`);
                yards += extraYards;
            }

            // Fumble Check after tackle attempt
            let fumbleChance = 0.03;
            if (weather === 'Rain') fumbleChance *= 2;
            if (Math.random() < fumbleChance && (rb.attributes.technical.catchingHands * getFatigueModifier(rb)) < tackler.attributes.physical.strength) {
                if(gameLog) gameLog.push(`FUMBLE! ${tackler.name} forces the ball out!`);
                return { yards, turnover: true };
            }
        }
        
        const touchdown = ballOn + yards >= 100;
        if(touchdown) rb.gameStats.touchdowns++;

        rb.gameStats.rushYards += yards;
        if(gameLog) gameLog.push(`${playCall.toUpperCase().replace('_',' ')} by ${rb.name} for ${yards} yards.`);
        return { yards, touchdown };
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
            else if (result.touchdown || ballOn >= 100) { // Check result.touchdown
                gameLog.push(`TOUCHDOWN ${possession.name}!`);
                
                // TD already recorded in resolvePlay if it occurred
                
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
    for (const player of game.players) {
        if (player.status.duration > 0) {
            player.status.duration--;
            if (player.status.duration === 0) {
                player.status.type = 'healthy';
                player.status.description = '';
            }
        }
        if (player.breakthroughAttr) {
            delete player.breakthroughAttr;
        }
        if (player.status.isNew) {
            player.status.isNew = false;
        }
    }
}

function endOfWeekCleanup() {
    game.teams.forEach(team => {
        team.roster = team.roster.filter(p => p.status.type !== 'temporary');
    });
}


function generateWeeklyEvents() {
    for (const player of game.players) {
        if (player.status.type === 'healthy') {
            for (const event of weeklyEvents) {
                if (Math.random() < event.chance) {
                    player.status.type = event.type;
                    player.status.description = event.description;
                    player.status.duration = getRandomInt(event.minDuration, event.maxDuration);
                    player.status.isNew = true;
                    if (player.teamId === game.playerTeam.id) {
                        addMessage('Player Status Update', `${player.name} will be unavailable for ${player.status.duration} week(s): ${player.status.description}`);
                    }
                    break;
                }
            }
        }
    }
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
                    addMessage("Player Breakthrough!", `${b.player.name} had a great game and improved their ${b.attr}!`);
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
        const message = `${player.name} agreed to play for you this week!`;
        addMessage("Roster Update", message);
        return { success: true, message };
    } else {
        game.freeAgents = game.freeAgents.filter(p => p.id !== playerId);
        const message = `${player.name} couldn't make it this week. They are now unavailable.`;
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
            console.log(`${team.name} successfully called in friend ${bestFA.name} to avoid a forfeit.`);
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
                const existingImprovement = developmentReport.improvements.find(imp => imp.attr === attrToBoost);
                if(existingImprovement) existingImprovement.increase += increase;
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
                    addMessage("Player Retires", `${player.name} has graduated from the league.`);
                }
                if (player.careerStats.touchdowns > 20 || player.careerStats.passYards > 5000 || player.careerStats.tackles > 200) {
                    game.hallOfFame.push(player);
                    hofInductees.push(player);
                    if (team.id === game.playerTeam.id) {
                         addMessage("Hall of Fame", `${player.name} has been inducted into the Hall of Fame!`);
                    }
                }
            } else {
                 for(const event of offseasonDepartureEvents) {
                     if (Math.random() < event.chance) {
                         leavingPlayers.push({player, reason: event.reason});
                         playerIsLeaving = true;
                         if (team.id === game.playerTeam.id) {
                             addMessage("Player Leaving", `${player.name} won't be back next season: ${event.reason}.`);
                         }
                         break;
                     }
                 }
                 if (!playerIsLeaving && team.id === game.playerTeam.id && Math.random() < transferEventChance) {
                     leavingPlayers.push({player, reason: 'Asked to leave'});
                     playerIsLeaving = true;
                     addMessage("Transfer Request", `${player.name} has decided to leave the team.`);
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
            team.depthChart.offense = Object.fromEntries(offenseSlots.map(slot => [slot, null]));
            team.depthChart.defense = Object.fromEntries(defenseSlots.map(slot => [slot, null]));
            aiSetDepthChart(team); 
         }
         team.wins = 0; 
         team.losses = 0;
    });

    const undraftedPool = game.players.filter(p => !p.teamId && p.age < 17); 
    if (game.playerTeam.roster.length < 10 && Math.random() < joinRequestChance && undraftedPool.length > 0) {
        const joiningPlayer = getRandom(undraftedPool);
        addPlayerToTeam(joiningPlayer, game.playerTeam);
        game.playerTeam.draftNeeds = Math.max(0, game.playerTeam.draftNeeds -1); 
        totalVacancies--;
        addMessage("Roster Update", `${joiningPlayer.name} heard about your team and asked to join! They've been added to the roster.`);
    }

    
    addMessage("Offseason", `${totalVacancies} roster spots opened up across the league.`);
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
    const newChart = Object.fromEntries(formation.slots.map(slot => [slot, null]));
    
    let playerPool = [...team.roster];
    
    for (const newSlot of formation.slots) {
        const position = newSlot.replace(/\d/g, '');
        if (playerPool.length > 0) {
            const bestPlayerForSlot = playerPool.reduce((best, current) => {
                return calculateOverall(current, position) > calculateOverall(best, position) ? current : best;
            });
            
            newChart[newSlot] = bestPlayerForSlot.id;
            playerPool = playerPool.filter(p => p.id !== bestPlayerForSlot.id);
        }
    }
    team.depthChart[side] = newChart;
}


export function getGameState() { return game; }

export function getBreakthroughs() { return game.breakthroughs || []; }

export function markMessageAsRead(messageId) {
    const message = game.messages.find(m => m.id === messageId);
    if(message) {
        message.isRead = true;
    }
}

// Function to handle player cut (can be called from offseason potentially)
export function playerCut(playerId) {
    const team = game.playerTeam;
    const playerIndex = team.roster.findIndex(p => p.id === playerId);
    if (playerIndex > -1) {
        const player = team.roster[playerIndex];
        team.roster.splice(playerIndex, 1);
        player.teamId = null;
        // Reset depth chart slots containing this player
        for(const side in team.depthChart) {
            for(const slot in team.depthChart[side]) {
                if(team.depthChart[side][slot] === playerId) {
                    team.depthChart[side][slot] = null;
                }
            }
        }
         // Refill depth chart automatically
        aiSetDepthChart(team);
        addMessage("Roster Move", `${player.name} has been cut from the team.`);
        return { success: true, message: `${player.name} cut.` };
    }
    return { success: false, message: "Player not found on roster." };
}

// Function to handle signing a free agent (e.g., undrafted player asking to join)
export function playerSignFreeAgent(playerId) {
     const team = game.playerTeam;
     if (team.roster.length >= 10) {
         return { success: false, message: "Your roster is full." };
     }
     const player = game.players.find(p => p.id === playerId && !p.teamId);
     if (player) {
         addPlayerToTeam(player, team);
         addMessage("Roster Move", `${player.name} has joined the team!`);
         return { success: true, message: `${player.name} signed.` };
     }
     return { success: false, message: "Player not available to sign." };
}

