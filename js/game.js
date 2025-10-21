import { getRandom, getRandomInt } from './utils.js';
import { firstNames, lastNames, nicknames, teamNames, positions, divisionNames, coachPersonalities, offenseFormations, defenseFormations } from './data.js';

let game = null;

const offensivePositions = ['QB', 'RB', 'WR', 'OL'];
const defensivePositions = ['DL', 'LB', 'DB'];

// Lowered base chance of random off-field events
const weeklyEvents = [
    { type: 'injured', description: 'Sprained Ankle', minDuration: 1, maxDuration: 2, chance: 0.005 },
    { type: 'injured', description: 'Jammed Finger', minDuration: 1, maxDuration: 1, chance: 0.008 },
    { type: 'busy', description: 'Grounded', minDuration: 1, maxDuration: 2, chance: 0.01 },
    { type: 'busy', description: 'School Project', minDuration: 1, maxDuration: 1, chance: 0.015 },
    { type: 'busy', description: 'Family Vacation', minDuration: 1, maxDuration: 1, chance: 0.003 }
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
        
        const schedule = [];
        for (let i = 0; i < numRounds; i++) {
            schedule.push([]);
        }

        for (let round = 0; round < numRounds; round++) {
            for (let match = 0; match < numTeams / 2; match++) {
                const home = teams[match];
                const away = teams[numTeams - 1 - match];
                 if (home && away) {
                    const matchup = match % 2 === 1 ? { home, away } : { home: away, away: home };
                    schedule[round].push(matchup);
                }
            }
            teams.splice(1, 0, teams.pop());
        }
        
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

function checkInGameInjury(player, gameLog) {
    if (!player || player.status.duration > 0) return;
    const injuryChance = 0.008;
    const toughnessModifier = (100 - player.attributes.mental.toughness) / 100;
    
    if (Math.random() < injuryChance * toughnessModifier) {
        const duration = getRandomInt(1, 3);
        player.status.type = 'injured';
        player.status.description = 'Minor Injury';
        player.status.duration = duration;
        gameLog.push(`INJURY: ${player.name} has suffered a minor injury and will be out for ${duration} week(s).`);
    }
}

/**
 * NEW: A more detailed play-by-play simulation engine focusing on individual matchups.
 */
function resolvePlay(offense, defense, playType, gameState) {
    const { gameLog } = gameState;

    const getPlayersForSlots = (team, side, slotPrefix) => 
        Object.keys(team.depthChart[side])
            .filter(s => s.startsWith(slotPrefix))
            .map(s => team.roster.find(p => p.id === team.depthChart[side][s] && p.status.duration === 0))
            .filter(Boolean);

    const qb = getPlayersForSlots(offense, 'offense', 'QB')[0];
    const rbs = getPlayersForSlots(offense, 'offense', 'RB');
    const wrs = getPlayersForSlots(offense, 'offense', 'WR');
    const ols = getPlayersForSlots(offense, 'offense', 'OL');
    const dls = getPlayersForSlots(defense, 'defense', 'DL');
    const lbs = getPlayersForSlots(defense, 'defense', 'LB');
    const dbs = getPlayersForSlots(defense, 'defense', 'DB');

    if ([qb, ...rbs, ...wrs, ...ols].filter(Boolean).length < 7 || [...dls, ...lbs, ...dbs].filter(Boolean).length < 7) {
        gameLog.push('Not enough players to continue.');
        return { yards: 0, turnover: true };
    }

    if (playType === 'pass') {
        if (!qb) { gameLog.push('No healthy QB!'); return { yards: 0, turnover: true }; }
        
        const passRusher = getRandom(dls.concat(lbs));
        const blocker = getRandom(ols);
        if (!passRusher || !blocker) { gameLog.push("Formation mismatch, broken play."); return { yards: 0 }; }
        
        checkInGameInjury(passRusher, gameLog); checkInGameInjury(blocker, gameLog);

        const rushPower = passRusher.attributes.physical.strength + passRusher.attributes.technical.blockShedding;
        const blockPower = blocker.attributes.physical.strength + blocker.attributes.technical.blocking;

        let qbAccuracy = qb.attributes.technical.throwingAccuracy;
        if (rushPower > blockPower + getRandomInt(-25, 25)) {
            qbAccuracy -= 10;
            gameLog.push(`${passRusher.name} gets pressure on the QB!`);
            if (Math.random() > 0.6) {
                const sackYards = getRandomInt(5, 12);
                gameLog.push(`SACK! ${passRusher.name} brings down ${qb.name} for a loss of ${sackYards} yards.`);
                passRusher.gameStats.tackles = (passRusher.gameStats.tackles || 0) + 1;
                return { yards: -sackYards };
            }
        }

        checkInGameInjury(qb, gameLog);
        if (qbAccuracy < getRandomInt(10, 100)) {
            gameLog.push(`INCOMPLETE pass from ${qb.name}. Bad throw.`);
            return { yards: 0 };
        }

        const targets = [...wrs, ...rbs].filter(Boolean);
        if (targets.length === 0) return { yards: 0 };
        
        const bestWR = targets.reduce((a, b) => calculateOverall(b, 'WR') > calculateOverall(a, 'WR') ? b : a);
        const target = Math.random() < 0.6 ? bestWR : getRandom(targets);

        const coveragePlayers = [...dbs, ...lbs].filter(Boolean);
        if(coveragePlayers.length === 0) return { yards: 10 };
        const coverage = getRandom(coveragePlayers);

        checkInGameInjury(target, gameLog); checkInGameInjury(coverage, gameLog);

        const catchContest = (target.attributes.technical.catchingHands + target.attributes.physical.speed) - (coverage.attributes.physical.agility + coverage.attributes.physical.speed);
        if (catchContest > getRandomInt(-20, 20)) {
            const yards = Math.round(target.attributes.physical.speed / 5) + getRandomInt(1, 15);
            target.gameStats.receptions = (target.gameStats.receptions || 0) + 1;
            target.gameStats.recYards = (target.gameStats.recYards || 0) + yards;
            qb.gameStats.passYards = (qb.gameStats.passYards || 0) + yards;
            gameLog.push(`PASS from ${qb.name} to ${target.name} for ${yards} yards.`);
            
            if (target.attributes.physical.agility > coverage.attributes.physical.agility + getRandomInt(0, 30)) {
                const extraYards = getRandomInt(5, 20);
                gameLog.push(`${target.name} breaks the tackle for an extra ${extraYards} yards!`);
                target.gameStats.recYards += extraYards;
                qb.gameStats.passYards += extraYards;
                return { yards: yards + extraYards };
            }
            coverage.gameStats.tackles = (coverage.gameStats.tackles || 0) + 1;
            return { yards };
        } else {
            if ((coverage.attributes.technical.catchingHands / 100) > Math.random() * 0.9) {
                gameLog.push(`INTERCEPTION! ${coverage.name} picks off the pass!`);
                return { yards: 0, turnover: true };
            }
            gameLog.push(`INCOMPLETE pass to ${target.name}, broken up by ${coverage.name}.`);
            return { yards: 0 };
        }
    }

    if (playType === 'run') {
        const rb = rbs[0];
        if (!rb) { gameLog.push('No healthy RB to run the ball!'); return { yards: 0, turnover: true }; }

        const runBlockPower = ols.reduce((s, p) => s + p.attributes.technical.blocking + p.attributes.physical.strength, 0);
        const runDefensePower = dls.concat(lbs).reduce((s, p) => s + p.attributes.technical.tackling + p.attributes.technical.blockShedding, 0);

        checkInGameInjury(rb, gameLog); ols.forEach(p => checkInGameInjury(p, gameLog)); dls.concat(lbs).forEach(p => checkInGameInjury(p, gameLog));

        let yards = 0;
        if (runBlockPower > runDefensePower + getRandomInt(-50, 50)) {
             yards = getRandomInt(2, 6);
             gameLog.push(`Good blocking opens a hole!`);
        } else {
            yards = getRandomInt(-2, 1);
            gameLog.push(`The defense plugs the running lane!`);
        }

        const tackler = getRandom([...lbs, ...dbs].filter(Boolean));
        if (tackler) {
            checkInGameInjury(tackler, gameLog);
            const breakTacklePower = (rb.attributes.physical.agility + rb.attributes.physical.strength) - (tackler.attributes.technical.tackling + tackler.attributes.physical.agility);
            if (breakTacklePower > getRandomInt(-20, 20)) {
                const extraYards = getRandomInt(5, 15);
                gameLog.push(`${rb.name} breaks a tackle and picks up an extra ${extraYards} yards!`);
                yards += extraYards;
            } else {
                gameLog.push(`Tackled by ${tackler.name}.`);
                tackler.gameStats.tackles = (tackler.gameStats.tackles || 0) + 1;
            }
        }
        
        rb.gameStats.rushYards = (rb.gameStats.rushYards || 0) + yards;
        gameLog.push(`RUN by ${rb.name} for ${yards} yards.`);
        return { yards };
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
    
    const homeHealthy = homeTeam.roster.filter(p => p.status.duration === 0).length;
    const awayHealthy = awayTeam.roster.filter(p => p.status.duration === 0).length;

    if (homeHealthy < 7) {
        awayScore = 21; homeScore = 0; awayTeam.wins++; homeTeam.losses++;
        gameLog.push(`${homeTeam.name} does not have enough healthy players and forfeits.`);
        return { homeTeam, awayTeam, homeScore, awayScore, gameLog };
    }
    if (awayHealthy < 7) {
        homeScore = 21; awayScore = 0; homeTeam.wins++; awayTeam.losses++;
        gameLog.push(`${awayTeam.name} does not have enough healthy players and forfeits.`);
        return { homeTeam, awayTeam, homeScore, awayScore, gameLog };
    }

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

                if (ballOn >= 100) {
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
        game.freeAgents = game.freeAgents.filter(p => p.id !== playerId);
        return { success: false, message: `${player.name} couldn't make it this week.` };
    }
}


export function aiManageRoster(team) {
    const healthyCount = team.roster.filter(p => p.status.duration === 0).length;
    
    if (healthyCount < 7 && game.freeAgents.length > 0) {
        const bestFA = game.freeAgents.reduce((best, p) => getPlayerScore(p, team.coach) > getPlayerScore(best, team.coach) ? p : best);
        
        const result = callFriend(bestFA.id, team);
        if(result.success) {
            console.log(`${team.name} successfully called in friend ${bestFA.name} to avoid a forfeit.`);
            game.freeAgents = game.freeAgents.filter(p => p.id !== bestFA.id);
        }
    }
}

function developPlayer(player) {
    let potential = player.age < 12 ? getRandomInt(4, 8) : player.age < 16 ? getRandomInt(1, 5) : getRandomInt(0, 2);
    const attributesToImprove = ['speed', 'strength', 'agility', 'throwingAccuracy', 'catchingHands', 'tackling', 'blocking', 'playbookIQ', 'blockShedding', 'toughness'];
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
    
    // Auto-fill the new formation with the best available players
    let playerPool = [...team.roster];
    
    for (const newSlot of formation.slots) {
        const position = newSlot.replace(/\d/g, '');
        if (playerPool.length > 0) {
            const bestPlayerForSlot = playerPool.reduce((best, current) => {
                return calculateOverall(current, position) > calculateOverall(best, position) ? current : best;
            });
            
            newChart[newSlot] = bestPlayerForSlot.id;
            // A player can only fill one slot per side, so remove them from the pool for this side
            playerPool = playerPool.filter(p => p.id !== bestPlayerForSlot.id);
        }
    }
    team.depthChart[side] = newChart;
}


export function getGameState() { return game; }

