import { getRandom, getRandomInt } from './utils.js';
import { firstNames, lastNames, nicknames, teamNames, positions, divisionNames, coachPersonalities, offenseFormations, defenseFormations } from './data.js';

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

    const initialStats = { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0 };

    return { id: crypto.randomUUID(), name: `${firstName} ${lastName}`, age, favoriteOffensivePosition, favoriteDefensivePosition, attributes, teamId: null, status: { type: 'healthy', description: '', duration: 0 }, gameStats: { ...initialStats }, seasonStats: { ...initialStats }, careerStats: { ...initialStats, seasonsPlayed: 0 } };
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
        const coach = getRandom(coachPersonalities);

        const offenseSlots = offenseFormations[coach.preferredOffense].slots;
        const defenseSlots = defenseFormations[coach.preferredDefense].slots;

        const team = {
            id: crypto.randomUUID(), name: teamName, roster: [], coach, division, wins: 0, losses: 0,
            formations: { offense: coach.preferredOffense, defense: coach.preferredDefense },
            depthChart: {
                offense: Object.fromEntries(offenseSlots.map(slot => [slot, null])),
                defense: Object.fromEntries(defenseSlots.map(slot => [slot, null]))
            }
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
        }
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
    // 10 rounds for 10-player rosters
    for (let i = 0; i < 10; i++) { 
        game.draftOrder.push(...(i % 2 === 0 ? teams : [...teams].reverse()));
    }
}

export function aiSetDepthChart(team) {
    const { roster, depthChart } = team;
    for (const side in depthChart) {
        const slots = Object.keys(depthChart[side]);
        let availablePlayers = [...roster];

        slots.forEach(slot => {
            const position = slot.replace(/\d/g, '');
            if (availablePlayers.length > 0) {
                const bestPlayerForSlot = availablePlayers.reduce((best, current) => {
                    return calculateOverall(current, position) > calculateOverall(best, position) ? current : best;
                });

                team.depthChart[side][slot] = bestPlayerForSlot.id;
                // A player can only be in one slot per side
                availablePlayers = availablePlayers.filter(p => p.id !== bestPlayerForSlot.id);
            }
        });
    }
}

export function simulateAIPick(team) {
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
    if (team.roster.length < 10) {
        player.teamId = team.id; team.roster.push(player);
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

// --- NEW PLAY-BY-PLAY SIMULATION ENGINE ---

/**
 * Simulates a full game play-by-play.
 * @param {object} homeTeam - The home team object.
 * @param {object} awayTeam - The away team object.
 * @returns {object} The game result, including scores and a play-by-play log.
 */
function simulateGame(homeTeam, awayTeam) {
    resetGameStats();
    aiSetDepthChart(homeTeam);
    aiSetDepthChart(awayTeam);

    let homeScore = 0;
    let awayScore = 0;
    let playLog = [`<strong>Game Start: ${awayTeam.name} @ ${homeTeam.name}</strong>`];
    let possession = Math.random() > 0.5 ? homeTeam : awayTeam;
    let possessionsPerTeam = 4;
    let homePossessions = 0;
    let awayPossessions = 0;

    const getInitialYardLine = (kickingTeam) => {
        const qb = kickingTeam.roster.find(p => p.id === kickingTeam.depthChart.offense[Object.keys(kickingTeam.depthChart.offense).find(s => s.startsWith('QB'))]);
        if (!qb) return 10; // Default if no QB
        const kickPower = (qb.attributes.technical.throwingAccuracy + qb.attributes.physical.strength) / 2;
        return Math.max(5, 25 - Math.round(kickPower / 5)); // Start between the 5 and 25 yard line
    };
    
    let currentDrive = {
        team: possession,
        yardLine: getInitialYardLine(possession === homeTeam ? awayTeam : homeTeam),
        down: 1,
        distance: 10
    };

    while (homePossessions < possessionsPerTeam || awayPossessions < possessionsPerTeam) {
        if(currentDrive.team.id === homeTeam.id) homePossessions++;
        else awayPossessions++;
        
        playLog.push(`<hr><strong>${currentDrive.team.name} take over at their ${currentDrive.yardLine} yard line.</strong>`);
        
        let driveActive = true;
        while(driveActive) {
            const playResult = simulatePlay(currentDrive);
            playLog.push(playResult.log);
            
            // Update stats
            if(playResult.playerStats) {
                 for(const pId in playResult.playerStats) {
                     const player = game.players.find(p => p.id === pId);
                     if(player) {
                        for(const stat in playResult.playerStats[pId]) {
                            player.gameStats[stat] = (player.gameStats[stat] || 0) + playResult.playerStats[pId][stat];
                        }
                     }
                 }
            }

            if (playResult.type === 'touchdown') {
                if (currentDrive.team.id === homeTeam.id) homeScore += 6;
                else awayScore += 6;
                
                // Conversion Attempt
                const goForTwo = (homeScore < awayScore); // Simple AI
                const conversionYardLine = goForTwo ? 5 : 2;
                const conversionPlay = simulatePlay({...currentDrive, yardLine: 50 - conversionYardLine, distance: conversionYardLine, down: 1});
                if(conversionPlay.type === 'touchdown') {
                     if (currentDrive.team.id === homeTeam.id) homeScore += goForTwo ? 2 : 1;
                     else awayScore += goForTwo ? 2 : 1;
                     playLog.push(`Conversion good! (${goForTwo ? 2 : 1}pt)`);
                } else {
                    playLog.push('Conversion failed.');
                }
                
                driveActive = false;
            } else if (playResult.type === 'turnover') {
                driveActive = false;
            } else {
                currentDrive.yardLine += playResult.yards;
                currentDrive.distance -= playResult.yards;

                if (currentDrive.distance <= 0) {
                    currentDrive.down = 1;
                    currentDrive.distance = 10;
                } else {
                    currentDrive.down++;
                }

                if (currentDrive.down > 4) {
                    playLog.push(`Turnover on downs!`);
                    driveActive = false;
                }
            }
        }
        
        // Switch possession
        possession = possession.id === homeTeam.id ? awayTeam : homeTeam;
        currentDrive = {
            team: possession,
            yardLine: getInitialYardLine(possession === homeTeam ? awayTeam : homeTeam),
            down: 1,
            distance: 10
        };
    }

    if (homeScore > awayScore) { homeTeam.wins++; awayTeam.losses++; }
    else if (awayScore > homeScore) { awayTeam.wins++; homeTeam.losses++; }
    
    // Aggregate game stats into season/career stats
    [...homeTeam.roster, ...awayTeam.roster].forEach(p => {
        for (const stat in p.gameStats) {
            p.seasonStats[stat] = (p.seasonStats[stat] || 0) + p.gameStats[stat];
            p.careerStats[stat] = (p.careerStats[stat] || 0) + p.gameStats[stat];
        }
    });

    playLog.push(`<hr><strong>Final Score: ${awayTeam.name} ${awayScore} - ${homeTeam.name} ${homeScore}</strong>`);
    return { homeTeam, awayTeam, homeScore, awayScore, playLog };
}


function simulatePlay(driveState) {
    const offense = driveState.team;
    const defense = game.teams.find(t => t.id !== offense.id); 
    
    const oStarters = Object.values(offense.depthChart.offense).map(id => offense.roster.find(p => p.id === id && p.status.type === 'healthy')).filter(Boolean);
    const dStarters = Object.values(defense.depthChart.defense).map(id => defense.roster.find(p => p.id === id && p.status.type === 'healthy')).filter(Boolean);
    
    if (oStarters.length < 7 || dStarters.length < 7) {
        return { type: 'turnover', yards: 0, log: `${offense.name} forfeits the down due to lack of players.` };
    }

    const qb = oStarters.find(p => calculateOverall(p, 'QB') > 40);
    const rb = oStarters.find(p => calculateOverall(p, 'RB') > 40);
    const wrs = oStarters.filter(p => calculateOverall(p, 'WR') > 40);
    const ol = oStarters.filter(p => calculateOverall(p, 'OL') > 40);
    const dl = dStarters.filter(p => calculateOverall(p, 'DL') > 40);
    const lbs = dStarters.filter(p => calculateOverall(p, 'LB') > 40);
    const dbs = dStarters.filter(p => calculateOverall(p, 'DB') > 40);

    const playCall = Math.random() > 0.5 ? 'pass' : 'run'; // Simple 50/50 playcall
    let log = `${driveState.down}${['st','nd','rd','th'][driveState.down-1]} & ${driveState.distance} from the ${driveState.yardLine}.`;
    let playerStats = {};

    if (playCall === 'pass' && qb && wrs.length > 0) {
        const passPower = calculateOverall(qb, 'QB') + qb.attributes.mental.clutch;
        const passCoverage = dbs.reduce((sum, p) => sum + calculateOverall(p, 'DB'), 0) + lbs.reduce((sum, p) => sum + calculateOverall(p, 'LB'), 0);
        
        if (passPower * Math.random() > passCoverage * Math.random() * 0.7) {
            const receiver = getRandom(wrs);
            const yards = getRandomInt(3, 15) + Math.round(receiver.attributes.physical.speed / 10);
            log += ` Pass to ${receiver.name} for ${yards} yards.`;
            playerStats[qb.id] = { passYards: yards };
            playerStats[receiver.id] = { receptions: 1, recYards: yards };
            
            if (driveState.yardLine + yards >= 50) {
                 log += ' <strong>TOUCHDOWN!</strong>';
                 playerStats[receiver.id].touchdowns = (playerStats[receiver.id].touchdowns || 0) + 1;
                 return { type: 'touchdown', yards, log, playerStats };
            }
            return { type: 'success', yards, log, playerStats };
        } else {
            log += ` Incomplete pass.`;
            return { type: 'incomplete', yards: 0, log };
        }
    } else if (rb && ol.length > 0 && dl.length > 0 && lbs.length > 0) { // Run play
        const runPower = calculateOverall(rb, 'RB') + ol.reduce((s,p) => s + calculateOverall(p, 'OL'), 0) / ol.length;
        const runDefense = dl.reduce((s,p) => s + calculateOverall(p, 'DL'), 0) + lbs.reduce((s,p) => s + calculateOverall(p, 'LB'), 0);

        const yards = Math.max(-2, Math.round((runPower / runDefense) * getRandomInt(3, 10) - 3));
        log += ` Run by ${rb.name} for ${yards} yards.`;
        playerStats[rb.id] = { rushYards: yards };
        
        if (driveState.yardLine + yards >= 50) {
            log += ' <strong>TOUCHDOWN!</strong>';
            playerStats[rb.id].touchdowns = (playerStats[rb.id].touchdowns || 0) + 1;
            return { type: 'touchdown', yards, log, playerStats };
        }
        return { type: 'success', yards, log, playerStats };
    }
    
    log += ' Scramble for no gain.';
    return { type: 'incomplete', yards: 0, log }; // Default fail-safe
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
    if (healthyRoster.length >= 10 || game.freeAgents.length === 0) return;

    let worstPlayer = team.roster.length > 0 ? team.roster.reduce((worst, p) => getPlayerScore(p, team.coach) < getPlayerScore(worst, team.coach) ? p : worst) : null;
    let bestFA = game.freeAgents.reduce((best, p) => getPlayerScore(p, team.coach) > getPlayerScore(best, team.coach) ? p : best);

    if (team.roster.length < 10) {
        addPlayerToTeam(bestFA, team);
        game.freeAgents = game.freeAgents.filter(p => p.id !== bestFA.id);
    } else if (worstPlayer && getPlayerScore(bestFA, team.coach) > getPlayerScore(worstPlayer, team.coach) * 1.1) {
        playerCut(worstPlayer.id, team);
        addPlayerToTeam(bestFA, team);
        game.freeAgents = game.freeAgents.filter(p => p.id !== bestFA.id);
    }
    aiSetDepthChart(team);
}

export function playerSignFreeAgent(playerId, team = game.playerTeam) {
    if (team.roster.length >= 10) {
        return { success: false, message: "Roster is full. You must cut a player first." };
    }
    const player = game.freeAgents.find(p => p.id === playerId);
    if (player) {
        game.freeAgents = game.freeAgents.filter(p => p.id !== playerId);
        addPlayerToTeam(player, team);
        return { success: true };
    }
    return { success: false, message: "Player not found." };
}

export function playerCut(playerId, team = game.playerTeam) {
    const playerIndex = team.roster.findIndex(p => p.id === playerId);
    if (playerIndex > -1) {
        const [player] = team.roster.splice(playerIndex, 1);
        player.teamId = null;
        for (const side in team.depthChart) {
            for (const pos in team.depthChart[side]) {
                if (team.depthChart[side][pos] === playerId) {
                    team.depthChart[side][pos] = null;
                }
            }
        }
        return { success: true };
    }
    return { success: false, message: "Player not found on your team." };
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
            p.seasonStats = { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0 };
            p.status = { type: 'healthy', description: '', duration: 0 };
            remainingPlayers.push(p);
        } else {
            if (p.careerStats.touchdowns > 20 || p.careerStats.passYards > 5000 || p.careerStats.tackles > 200) {
                game.hallOfFame.push(p);
            }
            retiredCount++;
        }
    });
    game.players = remainingPlayers;
    game.teams.forEach(t => {
        t.roster = []; t.wins = 0; t.losses = 0; if (t.depthChart) {
            const offenseSlots = offenseFormations[t.formations.offense].slots;
            const defenseSlots = defenseFormations[t.formations.defense].slots;
            t.depthChart.offense = Object.fromEntries(offenseSlots.map(slot => [slot, null]));
            t.depthChart.defense = Object.fromEntries(defenseSlots.map(slot => [slot, null]));
        }
    });
    game.players.forEach(p => p.teamId = null);
    for (let i = 0; i < retiredCount; i++) game.players.push(generatePlayer(8, 10));
}

export function updateDepthChart(playerId, newPositionSlot, side) {
    const team = game.playerTeam;
    const chart = team.depthChart[side];

    const oldSlot = Object.keys(chart).find(key => chart[key] === playerId);
    const displacedPlayerId = chart[newPositionSlot];

    chart[newPositionSlot] = playerId;

    if (oldSlot) {
        chart[oldSlot] = displacedPlayerId;
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
            // A player can only be in one slot on each side of the ball.
            // This logic allows a player to start on both Offense and Defense.
        }
    }

    team.depthChart[side] = newChart;
}


export function getGameState() { return game; }

