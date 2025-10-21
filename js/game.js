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

/**
 * Generates a balanced 9-week, round-robin schedule for the entire league.
 * Each team within a division plays every other team in that division exactly once.
 */
export function generateSchedule() {
    game.schedule = [];
    game.currentWeek = 0;
    const allWeeklyGames = Array(9).fill(null).map(() => []);

    for (const divisionName in game.divisions) {
        let teams = [...game.teams.filter(t => t.division === divisionName)];
        if (teams.length % 2 !== 0 || teams.length < 2) {
            console.error(`Cannot generate schedule for division ${divisionName} with ${teams.length} teams.`);
            continue;
        }

        const numRounds = teams.length - 1;
        const numTeams = teams.length;
        
        // Use a placeholder for bye weeks if needed, though 10 teams is perfect.
        const schedule = [];
        for (let i = 0; i < numRounds; i++) {
            schedule.push([]);
        }

        for (let round = 0; round < numRounds; round++) {
            for (let match = 0; match < numTeams / 2; match++) {
                const home = teams[match];
                const away = teams[numTeams - 1 - match];
                 if (home && away) {
                    // Alternate home/away based on match index to spread it out
                    const matchup = match % 2 === 1 ? { home, away } : { home: away, away: home };
                    schedule[round].push(matchup);
                }
            }
            // Rotate teams for the next round, keeping the first team fixed.
            teams.splice(1, 0, teams.pop());
        }
        
        // Add division games to the main league schedule weeks
        for(let week = 0; week < schedule.length; week++) {
            allWeeklyGames[week].push(...schedule[week]);
        }
    }
    game.schedule = allWeeklyGames.flat();
}


function resetGameStats() {
    game.players.forEach(player => {
        player.gameStats = { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0 };
    });
}

function resolvePlay(offense, defense, playType, gameState) {
    const { ballOn, gameLog } = gameState;
    const getStarters = (team, side) => Object.values(team.depthChart[side])
        .map(id => team.roster.find(p => p.id === id && p.status.duration === 0))
        .filter(Boolean);

    const offStarters = getStarters(offense, 'offense');
    const defStarters = getStarters(defense, 'defense');

    if (offStarters.length < 7 || defStarters.length < 7) {
        gameLog.push('Not enough players to continue.');
        return { yards: 0, turnover: true, scoringPlay: false };
    }

    if (playType === 'pass') {
        const qb = offStarters.find(p => calculateOverall(p, 'QB') > 40) || offStarters[0];
        const wrs = offStarters.filter(p => ['WR', 'RB'].includes(p.favoriteOffensivePosition));
        const dbs = defStarters.filter(p => ['DB', 'LB'].includes(p.favoriteDefensivePosition));

        const passRush = defStarters.reduce((s, p) => s + calculateOverall(p, 'DL'), 0);
        const passBlock = offStarters.reduce((s, p) => s + calculateOverall(p, 'OL'), 0);
        
        if ((passRush / passBlock) * 100 > getRandomInt(50, 150)) {
            const sackYards = getRandomInt(5, 12);
            gameLog.push(`SACK! ${qb.name} is brought down for a loss of ${sackYards} yards.`);
            return { yards: -sackYards, turnover: false, scoringPlay: false };
        }

        const target = getRandom(wrs.length > 0 ? wrs : offStarters);
        const coverage = getRandom(dbs.length > 0 ? dbs : defStarters);
        const throwPower = qb.attributes.technical.throwingAccuracy + (qb.attributes.mental.clutch / 10);
        const coveragePower = (coverage.attributes.physical.speed + coverage.attributes.physical.agility) / 2 + (coverage.attributes.mental.playbookIQ / 10);
        
        if (throwPower > coveragePower + getRandomInt(-20, 20)) {
            const yards = Math.round(target.attributes.physical.speed / 5) + getRandomInt(1, 15);
            target.gameStats.receptions++;
            target.gameStats.recYards += yards;
            qb.gameStats.passYards += yards;
            gameLog.push(`PASS to ${target.name} for ${yards} yards.`);
            return { yards, turnover: false, scoringPlay: yards + ballOn >= 100 };
        } else {
            if ((coverage.attributes.technical.catchingHands / 100) > Math.random() * 0.8) {
                gameLog.push(`INTERCEPTION! Picked off by ${coverage.name}!`);
                return { yards: 0, turnover: true, scoringPlay: false };
            }
            gameLog.push(`INCOMPLETE pass intended for ${target.name}.`);
            return { yards: 0, turnover: false, scoringPlay: false };
        }
    }

    if (playType === 'run') {
        const rb = offStarters.find(p => calculateOverall(p, 'RB') > 40) || offStarters[1];
        const ol = offStarters.filter(p => calculateOverall(p, 'OL') > 40);
        const frontSeven = defStarters.filter(p => ['DL', 'LB'].includes(p.favoriteDefensivePosition));

        const runBlock = ol.reduce((s, p) => s + calculateOverall(p, 'OL'), 0);
        const runDefense = frontSeven.reduce((s, p) => s + calculateOverall(p, 'DL') + calculateOverall(p, 'LB'), 0) / 2;

        const contest = (runBlock / runDefense) * (rb.attributes.physical.speed + rb.attributes.physical.strength);
        const yards = Math.round(contest / 20) + getRandomInt(-2, 8);
        rb.gameStats.rushYards += yards;
        gameLog.push(`RUN by ${rb.name} for ${yards} yards.`);
        return { yards, turnover: false, scoringPlay: yards + ballOn >= 100 };
    }
    return { yards: 0, turnover: false, scoringPlay: false };
}

function simulateGame(homeTeam, awayTeam) {
    resetGameStats();
    aiSetDepthChart(homeTeam);
    aiSetDepthChart(awayTeam);

    const gameLog = [];
    let homeScore = 0;
    let awayScore = 0;
    
    for (let i = 0; i < 2; i++) {
        let possession = i === 0 ? homeTeam : awayTeam;
        let driveCount = 0;
        
        while (driveCount < 5) {
            let ballOn = 20;
            let down = 1;
            let yardsToGo = 10;
            let driveActive = true;
            
            gameLog.push(`-- ${possession.name} takes over at their own 20 --`);

            while(driveActive && down <= 4) {
                const playType = (down >= 3 && yardsToGo > 5) || (possession.coach.type === 'West Coast Offense') ? 'pass' : 'run';
                const result = resolvePlay(possession, possession.id === homeTeam.id ? awayTeam : homeTeam, playType, { ballOn, gameLog });

                ballOn += result.yards;
                
                if (result.turnover) {
                    driveActive = false;
                    break;
                }

                if (result.scoringPlay) {
                    gameLog.push(`TOUCHDOWN ${possession.name}!`);
                    const goesForTwo = Math.random() > 0.5;
                    if(goesForTwo && Math.random() > 0.5) {
                        gameLog.push(`2-point conversion is GOOD!`);
                        if (possession.id === homeTeam.id) homeScore += 8; else awayScore += 8;
                    } else if (!goesForTwo && Math.random() > 0.2) {
                        gameLog.push(`1-point conversion is GOOD!`);
                        if (possession.id === homeTeam.id) homeScore += 7; else awayScore += 7;
                    } else {
                        gameLog.push(`Conversion FAILED!`);
                         if (possession.id === homeTeam.id) homeScore += 6; else awayScore += 6;
                    }
                    driveActive = false;
                    break;
                }
                
                yardsToGo -= result.yards;
                if(yardsToGo <= 0) {
                    down = 1;
                    yardsToGo = 10;
                    gameLog.push(`First down!`);
                } else {
                    down++;
                }

                if(down > 4) {
                    gameLog.push(`Turnover on downs!`);
                    driveActive = false;
                }
            }
            driveCount++;
            possession = possession.id === homeTeam.id ? awayTeam : homeTeam;
        }
    }

    if (homeScore > awayScore) { homeTeam.wins++; awayTeam.losses++; }
    else if (awayScore > homeScore) { awayTeam.wins++; homeTeam.losses++; }
    
    [...homeTeam.roster, ...awayTeam.roster].forEach(p => {
        for (const stat in p.gameStats) {
            p.seasonStats[stat] = (p.seasonStats[stat] || 0) + p.gameStats[stat];
            p.careerStats[stat] = (p.careerStats[stat] || 0) + p.gameStats[stat];
        }
    });

    return { homeTeam, awayTeam, homeScore, awayScore, gameLog };
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
                    break;
                }
            }
        }
    }
}

export function simulateWeek() {
    if (game.currentWeek >= 9) return null;
    
    endOfWeekCleanup();
    updatePlayerStatuses();
    generateWeeklyEvents();

    const gamesPerWeek = game.teams.length / 2;
    const weeklyGames = game.schedule.slice(game.currentWeek * gamesPerWeek, (game.currentWeek + 1) * gamesPerWeek);
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
            fa.relationship = getRandom(['Best Friend', 'Good Friend', 'Acquaintance']);
            game.freeAgents.push(fa);
        }
    }
}

export function callFriend(playerId, team = game.playerTeam) {
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
        return { success: true, message: `${player.name} agreed to play for you this week!` };
    } else {
        return { success: false, message: `${player.name} couldn't make it this week.` };
    }
}


export function aiManageRoster(team) {
    const hasUnavailablePlayer = team.roster.some(p => p.status.duration > 0);
    if (!hasUnavailablePlayer || game.freeAgents.length === 0) return;
    
    const bestFA = game.freeAgents.reduce((best, p) => getPlayerScore(p, team.coach) > getPlayerScore(best, team.coach) ? p : best);
    
    const result = callFriend(bestFA.id, team);
    if(result.success) {
        console.log(`${team.name} successfully called in friend ${bestFA.name} for the week.`);
        // Remove from the main pool so other AI can't call them
        game.freeAgents = game.freeAgents.filter(p => p.id !== bestFA.id);
    }
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
    game.teams.forEach(t => { t.roster = []; t.wins = 0; t.losses = 0; if (t.depthChart) {
        const offenseSlots = offenseFormations[t.formations.offense].slots;
        const defenseSlots = defenseFormations[t.formations.defense].slots;
        t.depthChart.offense = Object.fromEntries(offenseSlots.map(slot => [slot, null]));
        t.depthChart.defense = Object.fromEntries(defenseSlots.map(slot => [slot, null]));
    }});
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

