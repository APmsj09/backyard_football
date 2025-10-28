// game.js - COMPLETE FILE

// --- Imports ---
import { getRandom, getRandomInt } from './utils.js';
import {
    // Data lists
    firstNames, lastNames, nicknames, teamNames, positions, divisionNames,
    // Game Rules/AI
    coachPersonalities,
    // Playbook & Formations (Now including coordinates)
    offenseFormations, defenseFormations, ZONES, routeTree, offensivePlaybook, defensivePlaybook,
    // Relationship System
    relationshipLevels
} from './data.js';

// --- Global Game State ---
let game = null;

// --- Team Color Definitions ---
const teamColors = [
    { primary: '#DC2626', secondary: '#FFFFFF' }, // Red
    { primary: '#2563EB', secondary: '#FFFFFF' }, // Blue
    { primary: '#FBBF24', secondary: '#000000' }, // Yellow
    { primary: '#D1D5DB', secondary: '#000000' }, // Gray
    { primary: '#10B981', secondary: '#000000' }, // Emerald
    { primary: '#F97316', secondary: '#FFFFFF' }, // Orange
    { primary: '#6366F1', secondary: '#FFFFFF' }, // Indigo
    { primary: '#EC4899', secondary: '#FFFFFF' }, // Pink
    { primary: '#000000', secondary: '#FFFFFF' }, // Black
    { primary: '#84CC16', secondary: '#000000' }, // Lime
    { primary: '#A855F7', secondary: '#FFFFFF' }, // Purple
    { primary: '#14B8A6', secondary: '#FFFFFF' }, // Teal
];
let availableColors = [...teamColors];

// --- Constants ---
const offensivePositions = ['QB', 'RB', 'WR', 'OL'];
const defensivePositions = ['DL', 'LB', 'DB'];
const MIN_HEALTHY_PLAYERS = 7; // Minimum players needed to avoid forfeit

// --- Field Constants ---
const FIELD_LENGTH = 120; // Yards (including 10yd endzones at 0-10 and 110-120)
const FIELD_WIDTH = 53.3; // Yards
const HASH_LEFT_X = 18.0; // Approx college hash mark X-coordinate
const HASH_RIGHT_X = 35.3; // Approx college hash mark X-coordinate
const CENTER_X = FIELD_WIDTH / 2; // Approx 26.65

// --- Physics/Interaction Constants ---
const TICK_DURATION_SECONDS = 0.15;
const BLOCK_ENGAGE_RANGE = 1.0;
const TACKLE_RANGE = 1.5;
const CATCH_RADIUS = 0.8;
const SEPARATION_THRESHOLD = 2.0;

// --- Event/Balance Constants ---
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
const FUMBLE_CHANCE_BASE = 0.03;

// --- Attribute Weights ---
export const positionOverallWeights = {
    QB: { throwingAccuracy: 0.4, playbookIQ: 0.3, consistency: 0.1, clutch: 0.1, speed: 0.05, agility: 0.05 },
    RB: { speed: 0.3, strength: 0.2, agility: 0.2, catchingHands: 0.1, blocking: 0.1, stamina: 0.1 },
    WR: { speed: 0.3, catchingHands: 0.3, agility: 0.2, height: 0.1, clutch: 0.1 },
    OL: { strength: 0.4, blocking: 0.4, weight: 0.1, playbookIQ: 0.1 },
    DL: { strength: 0.4, tackling: 0.25, blockShedding: 0.2, weight: 0.1, agility: 0.05 },
    LB: { tackling: 0.3, speed: 0.2, strength: 0.2, blockShedding: 0.1, playbookIQ: 0.2 },
    DB: { speed: 0.35, agility: 0.25, catchingHands: 0.15, tackling: 0.1, playbookIQ: 0.15 }
};

// =============================================================
// --- CORE HELPER FUNCTIONS ---
// =============================================================

/**
 * Calculates a player's overall rating for a given position.
 */
export function calculateOverall(player, position) {
    if (!player || !player.attributes) return 0;
    const attrs = player.attributes;
    const relevantWeights = positionOverallWeights[position];
    if (!relevantWeights) return 0;

    let score = 0;
    for (const category in attrs) {
        for (const attr in attrs[category]) {
            if (relevantWeights[attr]) {
                let value = attrs[category][attr];
                if (attr === 'weight') value = (value || 100) / 2.5;
                if (attr === 'height') value = ((value || 60) - 60);
                if (typeof value === 'number') {
                     score += value * relevantWeights[attr];
                }
            }
        }
    }
    return Math.min(99, Math.max(1, Math.round(score)));
}

/**
 * Calculates a player's suitability for a specific formation slot.
 */
function calculateSlotSuitability(player, slot, side, team) {
    if (!player || !player.attributes || !team || !team.formations || !team.formations[side]) return 0;
    const formationName = team.formations[side];
    const formationData = side === 'offense' ? offenseFormations[formationName] : defenseFormations[formationName];
    const basePosition = slot.replace(/\d/g, '');

    if (!formationData?.slotPriorities?.[slot]) {
        return calculateOverall(player, basePosition);
    }

    const priorities = formationData.slotPriorities[slot];
    let score = 0;
    let totalWeight = 0;

    for (const attr in priorities) {
        for (const category in player.attributes) {
            if (player.attributes[category]?.[attr] !== undefined) {
                let value = player.attributes[category][attr];
                if (typeof value !== 'number') continue;
                if (attr === 'weight') value = value / 2.5;
                if (attr === 'height') value = (value - 60);
                score += value * priorities[attr];
                totalWeight += priorities[attr];
                break;
            }
        }
    }

    const baseOverall = calculateOverall(player, basePosition);
    const finalScore = (totalWeight > 0 ? (score / totalWeight) : baseOverall) * 0.7 + (baseOverall * 0.3);

    return Math.min(99, Math.max(1, Math.round(finalScore)));
}

/**
 * Generates a new player object.
 */
function generatePlayer(minAge = 10, maxAge = 16) {
    const firstName = getRandom(firstNames);
    const lastName = Math.random() < 0.4 ? getRandom(nicknames) : getRandom(lastNames);
    const age = getRandomInt(minAge, maxAge);
    const favoriteOffensivePosition = getRandom(offensivePositions);
    const favoriteDefensivePosition = getRandom(defensivePositions);

    const ageProgress = (age - 10) / (16 - 10);
    let baseHeight = 55 + (ageProgress * 15) + getRandomInt(-2, 2);
    let baseWeight = 70 + (ageProgress * 90) + getRandomInt(-10, 10);
    const bestPosition = getRandom(positions);

    switch (bestPosition) {
        case 'QB': case 'WR': baseHeight += getRandomInt(1, 4); baseWeight -= getRandomInt(0, 10); break;
        case 'OL': case 'DL': baseHeight -= getRandomInt(0, 2); baseWeight += getRandomInt(20, 40); break;
        case 'RB': baseWeight += getRandomInt(5, 15); break;
    }

    const ageScalingFactor = 0.85 + ageProgress * 0.15;
    let attributes = {
        physical: {
            speed: Math.round(getRandomInt(40, 70) * ageScalingFactor),
            strength: Math.round(getRandomInt(40, 70) * ageScalingFactor),
            agility: Math.round(getRandomInt(40, 70) * ageScalingFactor),
            stamina: Math.round(getRandomInt(50, 80) * ageScalingFactor),
            height: Math.round(baseHeight), weight: Math.round(baseWeight)
        },
        mental: {
            playbookIQ: Math.round(getRandomInt(30, 70) * ageScalingFactor),
            clutch: getRandomInt(20, 90),
            consistency: Math.round(getRandomInt(40, 80) * ageScalingFactor),
            toughness: Math.round(getRandomInt(50, 95) * ageScalingFactor)
        },
        technical: {
            throwingAccuracy: Math.round(getRandomInt(20, 50) * ageScalingFactor),
            catchingHands: Math.round(getRandomInt(30, 60) * ageScalingFactor),
            tackling: Math.round(getRandomInt(30, 60) * ageScalingFactor),
            blocking: Math.round(getRandomInt(30, 60) * ageScalingFactor),
            blockShedding: Math.round(getRandomInt(30, 60) * ageScalingFactor)
        }
    };

    const weightModifier = (attributes.physical.weight - 125) / 50;
    attributes.physical.strength = Math.round(attributes.physical.strength + weightModifier * 10);
    attributes.physical.speed = Math.round(attributes.physical.speed - weightModifier * 8);
    attributes.physical.agility = Math.round(attributes.physical.agility - weightModifier * 5);

    switch (bestPosition) {
        case 'QB':
            attributes.technical.throwingAccuracy = Math.round(attributes.technical.throwingAccuracy * 0.5 + getRandomInt(65, 95) * 0.5);
            attributes.mental.playbookIQ = Math.round(attributes.mental.playbookIQ * 0.5 + getRandomInt(60, 95) * 0.5);
            break;
        case 'RB':
            attributes.physical.speed = Math.round(attributes.physical.speed * 0.5 + getRandomInt(60, 90) * 0.5);
            attributes.physical.strength = Math.round(attributes.physical.strength * 0.5 + getRandomInt(55, 85) * 0.5);
            attributes.physical.agility = Math.round(attributes.physical.agility * 0.5 + getRandomInt(60, 90) * 0.5);
            break;
        case 'WR':
            attributes.physical.speed = Math.round(attributes.physical.speed * 0.5 + getRandomInt(65, 95) * 0.5);
            attributes.technical.catchingHands = Math.round(attributes.technical.catchingHands * 0.5 + getRandomInt(60, 95) * 0.5);
            attributes.physical.agility = Math.round(attributes.physical.agility * 0.5 + getRandomInt(70, 95) * 0.5);
            break;
        case 'OL':
            attributes.physical.strength = Math.round(attributes.physical.strength * 0.5 + getRandomInt(70, 95) * 0.5);
            attributes.technical.blocking = Math.round(attributes.technical.blocking * 0.5 + getRandomInt(65, 95) * 0.5);
            break;
        case 'DL':
            attributes.physical.strength = Math.round(attributes.physical.strength * 0.5 + getRandomInt(70, 95) * 0.5);
            attributes.technical.tackling = Math.round(attributes.technical.tackling * 0.5 + getRandomInt(65, 95) * 0.5);
            attributes.technical.blockShedding = Math.round(attributes.technical.blockShedding * 0.5 + getRandomInt(60, 90) * 0.5);
            break;
        case 'LB':
            attributes.technical.tackling = Math.round(attributes.technical.tackling * 0.5 + getRandomInt(65, 95) * 0.5);
            attributes.physical.speed = Math.round(attributes.physical.speed * 0.5 + getRandomInt(60, 85) * 0.5);
            attributes.mental.playbookIQ = Math.round(attributes.mental.playbookIQ * 0.5 + getRandomInt(50, 85) * 0.5);
            break;
        case 'DB':
            attributes.physical.speed = Math.round(attributes.physical.speed * 0.5 + getRandomInt(70, 95) * 0.5);
            attributes.physical.agility = Math.round(attributes.physical.agility * 0.5 + getRandomInt(70, 95) * 0.5);
            attributes.technical.catchingHands = Math.round(attributes.technical.catchingHands * 0.5 + getRandomInt(50, 80) * 0.5);
            break;
    }

    Object.keys(attributes).forEach(cat => {
        if (!attributes[cat]) attributes[cat] = {};
        Object.keys(attributes[cat]).forEach(attr => {
            if (typeof attributes[cat][attr] === 'number' && !['height', 'weight'].includes(attr)) {
                attributes[cat][attr] = Math.max(1, Math.min(99, Math.round(attributes[cat][attr])));
            }
        });
    });

    let potential = 'F'; const potentialRoll = Math.random();
    if (age <= 11) {
        if (potentialRoll < 0.20) potential = 'A';
        else if (potentialRoll < 0.55) potential = 'B';
        else if (potentialRoll < 0.85) potential = 'C';
        else potential = 'D';
    } else if (age <= 13) {
        if (potentialRoll < 0.10) potential = 'A';
        else if (potentialRoll < 0.40) potential = 'B';
        else if (potentialRoll < 0.75) potential = 'C';
        else if (potentialRoll < 0.95) potential = 'D';
        else potential = 'F';
    } else {
        if (potentialRoll < 0.05) potential = 'A';
        else if (potentialRoll < 0.25) potential = 'B';
        else if (potentialRoll < 0.60) potential = 'C';
        else if (potentialRoll < 0.90) potential = 'D';
        else potential = 'F';
    }

    const initialStats = {
        receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0,
        tackles: 0, sacks: 0, interceptions: 0,
        passAttempts: 0, passCompletions: 0, interceptionsThrown: 0
    };

    return {
        id: crypto.randomUUID(), name: `${firstName} ${lastName}`, age,
        favoriteOffensivePosition, favoriteDefensivePosition,
        number: null, // Set to null, assigned when joining team
        potential, attributes, teamId: null,
        status: { type: 'healthy', description: '', duration: 0 }, fatigue: 0,
        gameStats: { ...initialStats }, seasonStats: { ...initialStats },
        careerStats: { ...initialStats, seasonsPlayed: 0 }
    };
}

/** Yields control to the main thread briefly. */
export function yieldToMain() { return new Promise(resolve => setTimeout(resolve, 0)); }

/** Adds a message to the player's inbox. */
function addMessage(subject, body, isRead = false) {
    if (!game || !game.messages) {
        console.error("Cannot add message: Game object or messages array not initialized.");
        return;
    }
    game.messages.unshift({ id: crypto.randomUUID(), subject, body, isRead });
}

// --- Relationship Helpers ---
/** Gets relationship level between two players. */
function getRelationshipLevel(p1Id, p2Id) {
    if (!p1Id || !p2Id || p1Id === p2Id || !game || !game.relationships) return relationshipLevels.STRANGER.level;
    const key = [p1Id, p2Id].sort().join('_');
    return game.relationships.get(key) ?? relationshipLevels.STRANGER.level;
}
/** Increases relationship level. */
function improveRelationship(p1Id, p2Id) {
    if (!p1Id || !p2Id || p1Id === p2Id || !game || !game.relationships) return;
    const key = [p1Id, p2Id].sort().join('_');
    const currentLevel = game.relationships.get(key) ?? relationshipLevels.STRANGER.level;
    const newLevel = Math.min(relationshipLevels.BEST_FRIEND.level, currentLevel + 1);
    if (newLevel > currentLevel) game.relationships.set(key, newLevel);
}
/** Decreases relationship level. */
function decreaseRelationship(p1Id, p2Id) {
    if (!p1Id || !p2Id || p1Id === p2Id || !game || !game.relationships) return;
    const key = [p1Id, p2Id].sort().join('_');
    const currentLevel = game.relationships.get(key) ?? relationshipLevels.STRANGER.level;
    const newLevel = Math.max(relationshipLevels.STRANGER.level, currentLevel - 1);
    if (newLevel < currentLevel) game.relationships.set(key, newLevel);
}

// --- Scouting Helper ---
/**
 * Gets potentially obscured player information based on relationship level.
 */
function getScoutedPlayerInfo(player, relationshipLevelNum) {
    if (!player) return null;

    const levelInfo = Object.values(relationshipLevels).find(rl => rl.level === relationshipLevelNum) || relationshipLevels.STRANGER;
    const accuracy = levelInfo.scoutAccuracy;
    const scoutedPlayer = JSON.parse(JSON.stringify(player));
    scoutedPlayer.relationshipName = levelInfo.name;
    scoutedPlayer.relationshipColor = levelInfo.color;

    if (accuracy < 1.0 && player.potential) {
        const potentialGrades = ['A', 'B', 'C', 'D', 'F'];
        const actualIndex = potentialGrades.indexOf(player.potential);
        if (actualIndex !== -1) {
            const range = Math.floor((1.0 - accuracy) * (potentialGrades.length / 2));
            const minIndex = Math.max(0, actualIndex - range);
            const maxIndex = Math.min(potentialGrades.length - 1, actualIndex + range);
            if (minIndex !== maxIndex) {
                scoutedPlayer.potential = `${potentialGrades[minIndex]}-${potentialGrades[maxIndex]}`;
            }
        } else { scoutedPlayer.potential = '?'; }
    }

    if (accuracy < 0.95 && scoutedPlayer.attributes) {
        const range = Math.round(15 * (1.0 - accuracy));
        for (const category in scoutedPlayer.attributes) {
            if (!scoutedPlayer.attributes[category]) continue;
            for (const attr in scoutedPlayer.attributes[category]) {
                if (['height', 'weight'].includes(attr)) continue;
                const actualValue = player.attributes[category]?.[attr];
                if (typeof actualValue === 'number') {
                    const lowBound = Math.max(1, actualValue - range);
                    const highBound = Math.min(99, actualValue + range);
                    if (highBound - lowBound > 1) {
                        scoutedPlayer.attributes[category][attr] = `${lowBound}-${highBound}`;
                    } else {
                        scoutedPlayer.attributes[category][attr] = actualValue;
                    }
                } else {
                     scoutedPlayer.attributes[category][attr] = "?";
                }
            }
        }
    }
    return scoutedPlayer;
}
// --- End Scouting Helper ---


// --- Coordinate/Physics Helpers ---
/** Calculates distance between two player states. */
function getDistance(p1State, p2State) {
    if (!p1State || !p2State || p1State.x === undefined || p2State.x === undefined) return Infinity;
    const dx = p1State.x - p2State.x;
    const dy = p1State.y - p2State.y;
    return Math.sqrt(dx * dx + dy * dy);
}
/** Updates a player's position based on speed and target. */
function updatePlayerPosition(playerState, timeDelta) {
    if (!playerState || playerState.x === undefined || playerState.y === undefined || playerState.targetX === undefined || playerState.targetY === undefined) {
         return; // Skip if state is invalid
     }
    if (playerState.x === playerState.targetX && playerState.y === playerState.targetY) return;

    const dx = playerState.targetX - playerState.x;
    const dy = playerState.targetY - playerState.y;
    const distanceToTarget = Math.sqrt(dx * dx + dy * dy);

    const baseSpeedYPS = 3.0;
    const scaleFactor = (8.0 - baseSpeedYPS) / (99 - 50);
    const playerSpeedYPS = baseSpeedYPS + Math.max(0, (playerState.speed || 50) - 50) * scaleFactor;
    const maxMoveDistance = playerSpeedYPS * (playerState.fatigueModifier || 1.0) * timeDelta;

    if (distanceToTarget <= maxMoveDistance || distanceToTarget < 0.1) {
        playerState.x = playerState.targetX;
        playerState.y = playerState.targetY;
    } else {
        const moveRatio = maxMoveDistance / distanceToTarget;
        playerState.x += dx * moveRatio;
        playerState.y += dy * moveRatio;
        playerState.x = Math.max(0.1, Math.min(FIELD_WIDTH - 0.1, playerState.x));
        playerState.y = Math.max(0.1, Math.min(FIELD_LENGTH - 0.1, playerState.y));
    }
}
// --- End Coordinate/Physics Helpers ---


// --- Fumble Check Helper ---
/** Checks for a fumble during a tackle attempt. */
function checkFumble(ballCarrier, tackler, playState, gameLog) {
    if (!ballCarrier || !tackler || !ballCarrier.attributes || !tackler.attributes) return false;
    const carrierModifier = (ballCarrier.attributes.mental?.toughness || 50) / 100;
    const tacklerModifier = ((tackler.attributes.physical?.strength || 50) + (tackler.attributes.technical?.tackling || 50)) / 100;
    const fumbleChance = FUMBLE_CHANCE_BASE * (tacklerModifier / (carrierModifier + 0.5));

    if (Math.random() < fumbleChance) {
        gameLog.push(`❗ FUMBLE! Ball knocked loose by ${tackler.name}! Recovered by Defense!`);
        playState.turnover = true;
        playState.playIsLive = false;
        return true;
    }
    return false;
}
// --- End Fumble Check Helper ---

// =============================================================
// --- GAME STATE & TEAM MANAGEMENT ---
// =============================================================

/**
 * Initializes the league state (teams, players, relationships).
 */
export async function initializeLeague(onProgress) {
    console.log("Initializing league...");
    game = {
        year: 1, teams: [], players: [], freeAgents: [], playerTeam: null, schedule: [],
        currentWeek: 0, divisions: {}, draftOrder: [], currentPick: 0, hallOfFame: [],
        gameResults: [], messages: [], relationships: new Map()
    };
    addMessage("Welcome!", "Generating the league and players...");

    // Setup divisions
    game.divisions[divisionNames[0]] = []; game.divisions[divisionNames[1]] = [];

    // --- Generate initial player pool ---
    const totalPlayers = 300;
    console.log(`Generating ${totalPlayers} players...`);
    for (let i = 0; i < totalPlayers; i++) {
        game.players.push(generatePlayer());
        if (i % 10 === 0 && onProgress) {
            onProgress((i / totalPlayers) * 0.7);
            await yieldToMain();
        }
    }
    console.log("Player generation complete.");
    onProgress(0.7); await yieldToMain();

    // --- Generate initial relationships ---
    console.log("Assigning initial relationships...");
    const totalPairs = (game.players.length * (game.players.length - 1)) / 2;
    let pairsProcessed = 0;
    for (let i = 0; i < game.players.length; i++) {
        for (let j = i + 1; j < game.players.length; j++) {
            const p1 = game.players[i]; const p2 = game.players[j];
            if (!p1 || !p2) continue;
            let level = relationshipLevels.STRANGER.level;
            const roll = Math.random();
            if (roll < 0.01) level = relationshipLevels.BEST_FRIEND.level;
            else if (roll < 0.05) level = relationshipLevels.GOOD_FRIEND.level;
            else if (roll < 0.15) level = relationshipLevels.FRIEND.level;
            else if (roll < 0.40) level = relationshipLevels.ACQUAINTANCE.level;
            const key = [p1.id, p2.id].sort().join('_');
            game.relationships.set(key, level);
            pairsProcessed++;
        }
        if (i % 20 === 0 && onProgress) {
             onProgress(0.7 + (pairsProcessed / totalPairs) * 0.2);
             await yieldToMain();
        }
    }
    console.log(`Assigned ${game.relationships.size} initial relationships.`);
    onProgress(0.9); await yieldToMain();

    // --- Generate AI teams ---
    console.log("Generating AI teams...");
    availableColors = [...teamColors]; // Reset available colors
    const availableTeamNames = [...teamNames];
    const numAiTeams = 19;
    for (let i = 0; i < numAiTeams; i++) {
        const nameIndex = getRandomInt(0, availableTeamNames.length - 1);
        const teamName = `The ${availableTeamNames.splice(nameIndex, 1)[0]}`;
        const division = divisionNames[i % divisionNames.length];
        const coach = getRandom(coachPersonalities);

        const offenseFormationData = offenseFormations[coach.preferredOffense] || offenseFormations['Balanced'];
        const defenseFormationData = defenseFormations[coach.preferredDefense] || defenseFormations['3-3-1'];
        const offenseSlots = offenseFormationData.slots;
        const defenseSlots = defenseFormationData.slots;

        // --- ADD Colors to Team ---
        if (availableColors.length === 0) availableColors = [...teamColors]; // Refill if empty
        const colorSet = availableColors.splice(getRandomInt(0, availableColors.length - 1), 1)[0];
        // --- END ADD ---

        const team = {
            id: crypto.randomUUID(), name: teamName, roster: [], coach, division, wins: 0, losses: 0,
            primaryColor: colorSet.primary, // <-- ADDED
            secondaryColor: colorSet.secondary, // <-- ADDED
            formations: { offense: offenseFormationData.name, defense: defenseFormationData.name },
            depthChart: {
                offense: Object.fromEntries(offenseSlots.map(slot => [slot, null])),
                defense: Object.fromEntries(defenseSlots.map(slot => [slot, null]))
            },
            draftNeeds: 0
        };
        game.teams.push(team);
        game.divisions[division].push(team.id);

        if (onProgress) onProgress(0.9 + ((i + 1) / numAiTeams) * 0.1);
        if (i % 4 === 0) await yieldToMain();
    }
    console.log("AI team generation complete.");
    onProgress(1.0);
    addMessage("Ready!", "League generated. Time to create your team.");
}

/**
 * Creates the player-controlled team and adds it to the game state.
 */
export function createPlayerTeam(teamName) {
    if (!game || !game.teams || !game.divisions) {
        console.error("Cannot create player team: Game not initialized properly."); return;
    }
    const finalTeamName = teamName.toLowerCase().startsWith("the ") ? teamName : `The ${teamName}`;
    const div0Count = game.divisions[divisionNames[0]]?.length || 0;
    const div1Count = game.divisions[divisionNames[1]]?.length || 0;
    const division = div0Count <= div1Count ? divisionNames[0] : divisionNames[1];

    const defaultOffense = 'Balanced';
    const defaultDefense = '3-3-1';
    const defaultOffenseSlots = offenseFormations[defaultOffense].slots;
    const defaultDefenseSlots = defenseFormations[defaultDefense].slots;

    // --- ADD Colors to Player Team ---
    if (availableColors.length === 0) availableColors = [...teamColors]; // Refill if empty
    const colorSet = availableColors.splice(getRandomInt(0, availableColors.length - 1), 1)[0];
    // --- END ADD ---

    const playerTeam = {
        id: crypto.randomUUID(), name: finalTeamName, roster: [],
        coach: getRandom(coachPersonalities), division, wins: 0, losses: 0,
        primaryColor: colorSet.primary, // <-- ADDED
        secondaryColor: colorSet.secondary, // <-- ADDED
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

// =============================================================
// --- DRAFT LOGIC ---
// =============================================================

/** Calculates coach score for a player */
function getPlayerScore(player, coach) {
    if (!player || !player.attributes || !coach || !coach.attributePreferences) return 0;
    let score = 0;
    for (const category in player.attributes) {
        for (const attr in player.attributes[category]) {
            score += (player.attributes[category][attr] || 0) * (coach.attributePreferences[category]?.[attr] || 1.0);
        }
    }
    if (coach.type === 'Youth Scout' && player.age) score += (18 - player.age) * 10;
    return score;
}

/** Sets up draft order based on standings. */
export function setupDraft() {
    if (!game || !game.teams) { console.error("setupDraft: Game/teams not initialized."); return; }
    game.draftOrder = [];
    game.currentPick = 0;

    const sortedTeams = [...game.teams]
        .filter(t => t)
        .sort((a, b) => (a.wins || 0) - (b.wins || 0) || (b.losses || 0) - (a.losses || 0));

    const ROSTER_LIMIT = 10;
    console.log("Setting draft needs based on current rosters...");
    game.teams.forEach(team => {
        if (team) team.draftNeeds = Math.max(0, ROSTER_LIMIT - (team.roster?.length || 0));
    });

    const maxNeeds = Math.max(0, ...game.teams.map(t => t?.draftNeeds || 0));
    if (maxNeeds === 0) {
        console.log("All teams have full rosters. No draft needed this offseason.");
        return;
    }

    for (let i = 0; i < maxNeeds; i++) {
        game.draftOrder.push(...(i % 2 === 0 ? sortedTeams : [...sortedTeams].reverse()));
    }
    console.log(`Draft setup with ${maxNeeds} rounds, total picks: ${game.draftOrder.length}`);
}

/** Automatically sets depth chart for an AI team. */
export function aiSetDepthChart(team) {
    if (!team || !team.roster || !team.depthChart || !team.formations) {
        console.error(`aiSetDepthChart: Invalid team data provided for ${team?.name || 'unknown team'}.`); return;
    }
    const { roster, depthChart, formations } = team;
    if (roster.length === 0) return;

    for (const side in depthChart) {
        if (!depthChart[side]) depthChart[side] = {};
        const formationSlots = (side === 'offense' ? offenseFormations[formations.offense]?.slots : defenseFormations[formations.defense]?.slots) || [];
        const newChartSide = {};
        formationSlots.forEach(slot => newChartSide[slot] = null);
        depthChart[side] = newChartSide;
    }

    for (const side in depthChart) {
        const slots = Object.keys(depthChart[side]);
        let availablePlayers = roster.filter(p => p && p.attributes && p.status);

        slots.sort((a, b) => {
            if (side === 'offense') {
                if (a.startsWith('QB')) return -1; if (b.startsWith('QB')) return 1;
                if (a.startsWith('RB1')) return -1; if (b.startsWith('RB1')) return 1;
                if (a.startsWith('WR1')) return -1; if (b.startsWith('WR1')) return 1;
            }
            return 0;
        });

        slots.forEach(slot => {
            if (availablePlayers.length > 0) {
                const bestPlayerForSlot = availablePlayers.reduce((best, current) => {
                    const bestSuitability = calculateSlotSuitability(best, slot, side, team);
                    const currentSuitability = calculateSlotSuitability(current, slot, side, team);
                    const otherSide = side === 'offense' ? 'defense' : 'offense';
                    const isStartingCriticalOtherSide = (player) => (team.depthChart[otherSide]?.['QB1'] === player.id) || (team.depthChart[otherSide]?.['RB1'] === player.id);
                    const bestIsCritical = isStartingCriticalOtherSide(best);
                    const currentIsCritical = isStartingCriticalOtherSide(current);
                    if (bestIsCritical && !currentIsCritical) return current;
                    if (!bestIsCritical && currentIsCritical) return best;
                    return currentSuitability > bestSuitability ? current : best;
                }, availablePlayers[0]);

                if (bestPlayerForSlot) {
                     depthChart[side][slot] = bestPlayerForSlot.id;
                     availablePlayers = availablePlayers.filter(p => p.id !== bestPlayerForSlot.id);
                }
            }
        });
    }
}

/** Simulates an AI team's draft pick. */
export function simulateAIPick(team) {
    if (!team || !team.roster || !game || !game.players || !team.coach) {
        console.error(`simulateAIPick: Invalid team data or game state.`); return null;
    }
    const ROSTER_LIMIT = 10;
    if (team.roster.length >= ROSTER_LIMIT) return null;

    const undraftedPlayers = game.players.filter(p => p && !p.teamId);
    if (undraftedPlayers.length === 0) return null;

    let bestPick = { player: null, score: -Infinity };
    if(undraftedPlayers.length > 0) {
        bestPick = undraftedPlayers.reduce((best, current) => {
            const currentScore = getPlayerScore(current, team.coach);
            return currentScore > best.score ? { player: current, score: currentScore } : best;
        }, { player: undraftedPlayers[0], score: getPlayerScore(undraftedPlayers[0], team.coach) });
    }
    const bestPlayer = bestPick.player;

    if (bestPlayer) { addPlayerToTeam(bestPlayer, team); }
    else { console.warn(`${team.name} failed to find a suitable player.`); }
    return bestPlayer;
}

/**
 * Adds a player object to a team's roster, assigns a unique position-based number,
 * and updates the player's teamId.
 */
export function addPlayerToTeam(player, team) {
     if (!player || !team || !team.roster || typeof player.id === 'undefined') {
         console.error("addPlayerToTeam: Invalid player or team object provided.");
         return false;
     }

    // --- Position-Based Number Assignment ---
    if (player.number === null) {
        const offOvr = calculateOverall(player, player.favoriteOffensivePosition);
        const defOvr = calculateOverall(player, player.favoriteDefensivePosition);
        const primaryPos = (offOvr >= defOvr) ? player.favoriteOffensivePosition : player.favoriteDefensivePosition;

        let preferredRanges = [];
        switch (primaryPos) {
            case 'QB': preferredRanges.push([1, 19]); break;
            case 'WR': preferredRanges.push([10, 19], [80, 89]); break;
            case 'RB': preferredRanges.push([20, 39]); break;
            case 'DB': preferredRanges.push([20, 49]); break;
            case 'LB': preferredRanges.push([40, 59], [90, 99]); break;
            case 'OL': preferredRanges.push([60, 79]); break;
            case 'DL': preferredRanges.push([60, 79], [90, 99]); break;
            default: preferredRanges.push([1, 99]);
        }

        const existingNumbers = new Set(team.roster.map(p => p.number).filter(n => n !== null));

        let preferredNumbers = [];
        for (const range of preferredRanges) {
            for (let i = range[0]; i <= range[1]; i++) {
                if (!existingNumbers.has(i)) {
                    preferredNumbers.push(i);
                }
            }
        }
        preferredNumbers.sort(() => 0.5 - Math.random());

        let numberAssigned = false;
        if (preferredNumbers.length > 0) {
            player.number = preferredNumbers[0];
            numberAssigned = true;
        }

        if (!numberAssigned) {
            console.warn(`Could not find preferred number for ${player.name} (${primaryPos}). Assigning random fallback.`);
            let fallbackNumber;
            let attempts = 0;
            do {
                fallbackNumber = getRandomInt(1, 99);
                attempts++;
            } while (existingNumbers.has(fallbackNumber) && attempts < 200);
            
            if (existingNumbers.has(fallbackNumber)) {
                for (let i = 1; i <= 99; i++) {
                    if (!existingNumbers.has(i)) {
                        fallbackNumber = i;
                        break;
                    }
                }
            }
            player.number = fallbackNumber;
        }
    }
    // --- END NEW ---

    player.teamId = team.id;
    team.roster.push(player);
    return true;
}

// =============================================================
// --- SCHEDULING & BASIC WEEK SIM HELPERS ---
// =============================================================

/**
 * Generates the league schedule using a round-robin algorithm within divisions.
 */
export function generateSchedule() {
    if (!game || !game.teams || !game.divisions || !divisionNames || divisionNames.length !== 2) {
        console.error("generateSchedule: Game state invalid."); game.schedule = []; return;
    }
    game.schedule = [];
    game.currentWeek = 0;
    const numWeeks = 9;
    const allWeeklyGames = Array(numWeeks).fill(null).map(() => []);
    console.log("Generating schedule...");

    for (const divisionName of divisionNames) {
        let teamsInDivision = game.teams.filter(t => t && t.division === divisionName);
        if (teamsInDivision.length !== 10) {
            console.error(`Scheduling Error: Division ${divisionName} requires 10 teams but has ${teamsInDivision.length}. Skipping.`);
            continue;
        }
        const numTeams = teamsInDivision.length;

        for (let round = 0; round < numWeeks; round++) {
            for (let match = 0; match < numTeams / 2; match++) {
                const home = teamsInDivision[match];
                const away = teamsInDivision[numTeams - 1 - match];
                if (home && away) {
                    const matchup = round % 2 === 1 ? { home, away } : { home: away, away: home };
                    allWeeklyGames[round].push(matchup);
                } else { console.warn(`Scheduling warning: Invalid team object in round ${round}, match ${match}, div ${divisionName}`); }
            }
            const lastTeam = teamsInDivision.pop();
            if (lastTeam) teamsInDivision.splice(1, 0, lastTeam);
        }
    }
    game.schedule = allWeeklyGames.flat();
    console.log(`Schedule generated: ${game.schedule.length} total games over ${numWeeks} weeks.`);
}

/** Resets player fatigue and game stats (typically before a game). */
function resetGameStats() {
    if (!game || !game.players) { console.warn("resetGameStats: Game or players list not available."); return; }
    game.players.forEach(player => {
        if (!player) return;
        player.fatigue = 0;
        player.gameStats = {
            receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0,
            tackles: 0, sacks: 0, interceptions: 0,
            passAttempts: 0, passCompletions: 0, interceptionsThrown: 0
        };
    });
}

/** Checks for in-game injury. */
function checkInGameInjury(player, gameLog) {
    if (!player || !player.attributes || !player.attributes.mental || !player.status || player.status.duration > 0) return;
    const injuryChance = 0.008;
    const toughnessModifier = (100 - (player.attributes.mental.toughness || 50)) / 100;
    if (Math.random() < injuryChance * toughnessModifier) {
        const duration = getRandomInt(1, 3);
        player.status.type = 'injured';
        player.status.description = 'Minor Injury';
        player.status.duration = duration;
        player.status.isNew = true;
        if (gameLog && Array.isArray(gameLog)) {
            gameLog.push(`🚑 INJURY: ${player.name} has suffered a minor injury and is out for the game (will miss ${duration} week(s)).`);
        }
    }
}

/** Finds the best available substitute player. */
function getBestSub(team, position, usedPlayerIds) {
    if (!team || !team.roster || !Array.isArray(team.roster)) {
        console.warn("getBestSub: Invalid team or roster provided."); return null;
    }
    const availableSubs = team.roster.filter(p => p && p.status?.duration === 0 && !usedPlayerIds.has(p.id));
    if (availableSubs.length === 0) return null;
    return availableSubs.reduce((best, current) => (calculateOverall(current, position) > calculateOverall(best, position)) ? current : best, availableSubs[0]);
}

/** Gets active players for specific slots (e.g., all 'WR' slots). */
function getPlayersForSlots(team, side, slotPrefix, usedPlayerIdsThisPlay) {
    if (!team || !team.depthChart || !team.depthChart[side] || !team.roster || !Array.isArray(team.roster)) {
        console.error(`getPlayersForSlots: Invalid team data for ${team?.id}, side ${side}.`); return [];
    }
     const sideDepthChart = team.depthChart[side];
     if (typeof sideDepthChart !== 'object' || sideDepthChart === null) {
         console.error(`getPlayersForSlots: Invalid depth chart for side "${side}" on ${team?.id}.`); return [];
     }
    const slots = Object.keys(sideDepthChart).filter(s => s.startsWith(slotPrefix));
    const position = slotPrefix.replace(/\d/g, '');
    const activePlayers = [];
    slots.forEach(slot => {
        const starterId = sideDepthChart[slot];
        let player = team.roster.find(p => p && p.id === starterId);
        if (!player || player.status?.duration > 0 || usedPlayerIdsThisPlay.has(player.id)) {
            player = getBestSub(team, position, usedPlayerIdsThisPlay);
        }
        if (player && !usedPlayerIdsThisPlay.has(player.id)) {
            activePlayers.push({ player: player, slot: slot });
            usedPlayerIdsThisPlay.add(player.id);
        }
    });
    return activePlayers;
}

/** Gets a single, healthy player for a specific slot. */
function getPlayerBySlot(team, side, slot, usedPlayerIdsThisPlay) {
    if (!team || !team.depthChart || !team.depthChart[side] || !team.roster || !Array.isArray(team.roster)) {
        console.error(`getPlayerBySlot: Invalid team data for ${slot} on ${side}.`); return null;
    }
    const sideDepthChart = team.depthChart[side];
     if (typeof sideDepthChart !== 'object' || sideDepthChart === null) {
         console.error(`getPlayerBySlot: Invalid depth chart object for side ${side}.`); return null;
     }
    const position = slot.replace(/\d/g, '');
    const starterId = sideDepthChart[slot];
    let player = team.roster.find(p => p && p.id === starterId);
    if (!player || player.status?.duration > 0 || usedPlayerIdsThisPlay.has(player.id)) {
        player = getBestSub(team, position, usedPlayerIdsThisPlay);
    }
    if (player && !usedPlayerIdsThisPlay.has(player.id)) {
        usedPlayerIdsThisPlay.add(player.id);
        return player;
    }
    return null;
}

/** Finds *any* healthy, unused player on the roster as a last resort. */
function findEmergencyPlayer(position, team, side, usedPlayerIdsThisPlay) {
   if (!team || !team.roster || !Array.isArray(team.roster)) {
       console.warn(`findEmergencyPlayer: Invalid team data for ${position}.`); return null;
    }
    const availablePlayers = team.roster.filter(p => p && p.status?.duration === 0 && !usedPlayerIdsThisPlay.has(p.id));
    if (availablePlayers.length === 0) {
        console.warn(`findEmergencyPlayer: No healthy, unused players found on roster for ${position}.`); return null;
    }
    const bestEmergencyPlayer = availablePlayers.reduce((best, current) => (calculateOverall(current, position) > calculateOverall(best, position)) ? current : best, availablePlayers[0]);
    if (bestEmergencyPlayer) {
        usedPlayerIdsThisPlay.add(bestEmergencyPlayer.id);
        return { player: bestEmergencyPlayer, slot: 'EMERGENCY' };
    }
    return null;
}

// =============================================================
// --- TICK LOOP HELPER FUNCTIONS ---
// =============================================================

// Define basic zone boundaries relative to LoS
const zoneBoundaries = {
    'zone_deep_half_left':  { minX: 0, maxX: CENTER_X, minY: 15, maxY: 60 },
    'zone_deep_half_right': { minX: CENTER_X, maxX: FIELD_WIDTH, minY: 15, maxY: 60 },
    'zone_deep_middle':     { minX: HASH_LEFT_X - 2, maxX: HASH_RIGHT_X + 2, minY: 15, maxY: 60 },
    'zone_flat_left':   { minX: 0, maxX: HASH_LEFT_X - 3, minY: -2, maxY: 8 },
    'zone_flat_right':  { minX: HASH_RIGHT_X + 3, maxX: FIELD_WIDTH, minY: -2, maxY: 8 },
    'zone_hook_left':   { minX: HASH_LEFT_X - 3, maxX: CENTER_X - 2, minY: 5, maxY: 14 },
    'zone_hook_right':  { minX: CENTER_X + 2, maxX: HASH_RIGHT_X + 3, minY: 5, maxY: 14 },
    'zone_short_middle':{ minX: CENTER_X - 7, maxX: CENTER_X + 7, minY: 0, maxY: 12 },
    // Gap/Edge assignments (target points relative to ball snap X, LoS Y)
    'run_gap_A_left':   { xOffset: -2, yOffset: 0.5 },
    'run_gap_A_right':  { xOffset: 2, yOffset: 0.5 },
    'run_gap_B_left':   { xOffset: -5, yOffset: 0.5 },
    'run_gap_B_right':  { xOffset: 5, yOffset: 0.5 },
    'run_edge_left':    { xOffset: -10, yOffset: 1.0},
    'run_edge_right':   { xOffset: 10, yOffset: 1.0},
};

/** Helper to check if a player is roughly within a zone's boundaries (absolute coords). */
function isPlayerInZone(playerState, zoneAssignment, lineOfScrimmage) {
    const zone = zoneBoundaries[zoneAssignment];
    if (!zone || playerState.x === undefined || playerState.y === undefined) return false;
    const playerYRel = playerState.y - lineOfScrimmage;
    const withinX = (zone.minX === undefined || playerState.x >= zone.minX) && (zone.maxX === undefined || playerState.x <= zone.maxX);
    const withinY = playerYRel >= (zone.minY || -Infinity) && playerYRel <= (zone.maxY || Infinity);
    return withinX && withinY;
}

/** Helper to get zone center (absolute coords). */
function getZoneCenter(zoneAssignment, lineOfScrimmage) {
     const zone = zoneBoundaries[zoneAssignment];
     if (!zone || zone.xOffset !== undefined) return { x: CENTER_X, y: lineOfScrimmage + 7 };
     const centerX = zone.minX !== undefined && zone.maxX !== undefined ? (zone.minX + zone.maxX) / 2 : CENTER_X;
     const centerYRel = zone.minY !== undefined && zone.maxY !== undefined ? (zone.minY + zone.maxY) / 2 : 7;
     return { x: centerX, y: lineOfScrimmage + centerYRel };
}

/** Calculates the absolute coordinate path for a given route. */
function calculateRoutePath(routeName, startX, startY) {
    const route = routeTree[routeName];
    if (!route || !route.path) return null;
    const xMirror = (startX < CENTER_X) ? -1 : 1;
    const absolutePath = route.path.map(point => ({
        x: startX + ((point.x || 0) * xMirror),
        y: startY + (point.y || 0)
    }));
    return absolutePath;
}

/**
 * Sets up the initial state for all players involved in a play.
 */
function setupInitialPlayerStates(playState, offense, defense, play, assignments, ballOnYardLine, defensivePlayKey) {
    playState.activePlayers = [];
    const usedPlayerIds_O = new Set();
    const usedPlayerIds_D = new Set();
    const defPlay = defensivePlaybook[defensivePlayKey] || defensivePlaybook['Cover_2_Zone'];
    const defAssignments = defPlay.assignments || {};

    playState.lineOfScrimmage = ballOnYardLine + 10;
    const ballX = CENTER_X; // Simplified snap location

    // Helper to setup one side
    const setupSide = (team, side, formationData, isOffense, initialOffenseStates = []) => {
        if (!team || !team.roster || !formationData || !formationData.slots || !formationData.coordinates) {
             console.error(`setupInitialPlayerStates: Invalid data for ${side}`); return;
        }
        const usedSet = isOffense ? usedPlayerIds_O : usedPlayerIds_D;

        formationData.slots.forEach(slot => {
            const player = getPlayerBySlot(team, side, slot, usedSet) || findEmergencyPlayer(slot.replace(/\d/g,''), team, side, usedSet)?.player;
            if (!player || !player.attributes) return;

            const relCoords = formationData.coordinates[slot] || [0, 0];
            let startX = ballX + relCoords[0];
            let startY = playState.lineOfScrimmage + relCoords[1];
            startX = Math.max(0.5, Math.min(FIELD_WIDTH - 0.5, startX));
            startY = Math.max(10.5, Math.min(FIELD_LENGTH - 10.5, startY));

            let action = 'idle', assignment = null, targetX = startX, targetY = startY, routePath = null;

            if (isOffense) {
                assignment = assignments?.[slot];
                if (assignment) {
                    if (assignment.toLowerCase().includes('block_pass')) { action = 'pass_block'; targetY = startY - 0.5; }
                    else if (assignment.toLowerCase().includes('block_run')) { action = 'run_block'; targetY = startY + 0.5; }
                    else if (assignment.toLowerCase().includes('run_')) {
                        action = 'run_path'; targetY = startY + 5;
                        if (assignment.includes('outside')) targetX = startX + (startX < CENTER_X ? -7 : 7);
                        else targetX = startX + getRandomInt(-2, 2);
                    } else if (routeTree[assignment]) {
                         action = 'run_route';
                         routePath = calculateRoutePath(assignment, startX, startY);
                         if (routePath && routePath.length > 0) { targetX = routePath[0].x; targetY = routePath[0].y; }
                    }
                } else if (slot.startsWith('OL')) { action = play.type === 'pass' ? 'pass_block' : 'run_block'; targetY = startY + (action === 'pass_block' ? -0.5 : 0.5); }
                else if (slot.startsWith('QB')) { action = 'qb_setup'; if (play.type === 'pass') targetY = startY - 2; }
            } else { // Defense
                 assignment = defAssignments[slot] || 'def_read';
                 action = assignment;
                 if (assignment.startsWith('zone_')) { const zoneCenter = getZoneCenter(assignment, playState.lineOfScrimmage); targetX = zoneCenter.x; targetY = zoneCenter.y; }
                 else if (assignment.startsWith('run_gap_') || assignment.startsWith('run_edge_')) {
                     const gapTarget = zoneBoundaries[assignment];
                     if (gapTarget) { targetX = ballX + (gapTarget.xOffset || 0); targetY = playState.lineOfScrimmage + (gapTarget.yOffset || 0); }
                 } else if (assignment.startsWith('man_cover_')) {
                      const targetSlot = assignment.split('man_cover_')[1];
                      const initialTarget = initialOffenseStates.find(o => o.slot === targetSlot); // Use pre-calculated O_states
                      if(initialTarget) { targetX = initialTarget.x; targetY = initialTarget.y; }
                 } else if (assignment.includes('rush') || assignment.includes('blitz')) {
                     targetX = ballX; targetY = playState.lineOfScrimmage + 1; // Aim at snap
                 }
            }

            const fatigueModifier = player ? Math.max(0.3, (1 - (player.fatigue / (player.attributes?.physical?.stamina || 50) * 3))) : 1.0;

            playState.activePlayers.push({
                id: player.id, name: player.name, number: player.number,
                teamId: team.id, primaryColor: team.primaryColor, secondaryColor: team.secondaryColor,
                isOffense: isOffense, slot: slot,
                x: startX, y: startY, initialX: startX, initialY: startY,
                targetX: targetX, targetY: targetY,
                speed: player.attributes.physical?.speed || 50,
                strength: player.attributes.physical?.strength || 50,
                agility: player.attributes.physical?.agility || 50,
                blocking: player.attributes.technical?.blocking || 50,
                blockShedding: player.attributes.technical?.blockShedding || 50,
                tackling: player.attributes.technical?.tackling || 50,
                catchingHands: player.attributes.technical?.catchingHands || 50,
                throwingAccuracy: player.attributes.technical?.throwingAccuracy || 50,
                playbookIQ: player.attributes.mental?.playbookIQ || 50,
                fatigueModifier: fatigueModifier,
                action: action, assignment: assignment,
                routePath: routePath, currentPathIndex: 0,
                engagedWith: null, isBlocked: false, blockedBy: null, isEngaged: false,
                isBallCarrier: false, hasBall: false, stunnedTicks: 0 // <-- ADD THIS LINE
            });
        });
    };

    // --- Setup Order ---
    // 1. Get Offense formation data
    const offenseFormationData = offenseFormations[offense.formations.offense];
    // 2. Pre-calculate initial offensive positions for defensive targeting
    const initialOffenseStates = (offenseFormationData?.slots || []).map(slot => {
        const relCoords = offenseFormationData.coordinates[slot] || [0, 0];
        return { slot: slot, x: ballX + relCoords[0], y: playState.lineOfScrimmage + relCoords[1] };
    });
    // 3. Setup Defense (passing in offensive coords)
    const defenseFormationData = defenseFormations[defense.formations.defense];
    setupSide(defense, 'defense', defenseFormationData, false, initialOffenseStates);
    // 4. Setup Offense
    setupSide(offense, 'offense', offenseFormationData, true);
    // --- End Setup Order ---

    // Initial ball position (with QB)
    const qbState = playState.activePlayers.find(p => p.slot === 'QB1' && p.isOffense); // Be more specific
    if (qbState) {
        playState.ballState.x = qbState.x;
        playState.ballState.y = qbState.y;
        playState.ballState.z = 1.0;
        qbState.hasBall = true;
        qbState.isBallCarrier = true;
    } else {
        console.error("CRITICAL: QB not found during setup! Ending play.");
        playState.playIsLive = false;
        playState.turnover = true;
    }
}

/**
 * Updates player targets based on their current action, assignment, and game state. (Improved AI)
 * Modifies playerState objects within playState.activePlayers directly.
 */
function updatePlayerTargets(playState, offenseStates, defenseStates, ballCarrierState, playType, offensiveAssignments, defensivePlayCallKey) {
    const qbState = offenseStates.find(p => p.slot?.startsWith('QB'));
    const isBallInAir = playState.ballState.inAir;
    const ballPos = playState.ballState;

    // Helper: Determine if a target is the QB/Carrier and not null
    const isPlayerState = (t) => t && t.speed !== undefined;

    playState.activePlayers.forEach(pState => {
        let target = null; // Target: PlayerState (dynamic) or {x, y} (static point)
        // --- ADD THIS BLOCK AT THE TOP ---
        if (pState.stunnedTicks > 0) {
            pState.stunnedTicks--;
            pState.targetX = pState.x; // Player stands still while stunned
            pState.targetY = pState.y;
            return; // Skip all other AI logic for this tick
        }
        // --- END ADDED BLOCK ---
        // --- Handle Engaged State (Skip target update entirely) ---
        if (pState.isBlocked || pState.isEngaged) {
            pState.targetX = pState.x; pState.targetY = pState.y;
            return; 
        }

        // --- Offensive Logic ---
        if (pState.isOffense) {
            switch (pState.action) {
                case 'run_route':
                    if (pState.routePath && pState.routePath.length > 0) {
                        const currentTargetIndex = Math.min(pState.currentPathIndex, pState.routePath.length - 1);
                        const targetPoint = pState.routePath[currentTargetIndex];
                        if (getDistance(pState, targetPoint) < 0.75) {
                            if (pState.currentPathIndex < pState.routePath.length - 1) {
                                pState.currentPathIndex++;
                                const nextPoint = pState.routePath[pState.currentPathIndex];
                                pState.targetX = nextPoint.x; pState.targetY = nextPoint.y;
                            } else {
                                pState.action = 'route_complete'; // Finished path
                            }
                        } else {
                            pState.targetX = targetPoint.x; pState.targetY = targetPoint.y;
                        }
                    } else if (getDistance(pState, {x: pState.targetX, y: pState.targetY}) < 0.5) {
                         pState.action = 'route_complete';
                    }
                    break;

                case 'route_complete':
                    const nearestDefender = defenseStates.filter(d => !d.isBlocked && !d.isEngaged).sort((a, b) => getDistance(pState, a) - getDistance(pState, b))[0];
                    if (qbState?.action === 'qb_scramble') { pState.targetX = qbState.targetX > CENTER_X ? FIELD_WIDTH - 5 : 5; pState.targetY = Math.max(playState.lineOfScrimmage + 5, pState.y); } 
                    else if (nearestDefender && getDistance(pState, nearestDefender) < 4.0) { const moveXDir = pState.x > nearestDefender.x ? 1 : -1; pState.targetX = pState.x + moveXDir * 2; pState.targetY = pState.y; } 
                    else { pState.targetX = pState.x; pState.targetY = pState.y; }
                    break;

                case 'pass_block': 
                    if (!pState.engagedWith) {
                         const potentialTargets = defenseStates
                             .filter(d => !d.isBlocked && !d.isEngaged && (d.assignment === 'pass_rush' || d.assignment?.includes('blitz')))
                             .sort((a, b) => {
                                 const distA = getDistance(qbState || pState, a); const distB = getDistance(qbState || pState, b);
                                 const xDiffA = Math.abs(a.x - (qbState?.x || pState.x)); const xDiffB = Math.abs(b.x - (qbState?.x || pState.x));
                                 return xDiffA - xDiffB || distA - distB;
                             });
                         const targetDefender = potentialTargets[0];
                         if (targetDefender) {
                             const interceptFactor = 0.6;
                             pState.targetX = pState.x + (targetDefender.x - pState.x) * interceptFactor;
                             pState.targetY = pState.y + (targetDefender.y - pState.y) * interceptFactor;
                         } else {
                             pState.targetX = pState.x;
                             pState.targetY = pState.y - 0.05; // Tiny step back
                         }
                    }
                    break;
                case 'run_block':
                     if (!pState.engagedWith) {
                         const primaryTargets = defenseStates
                             .filter(d => !d.isBlocked && !d.isEngaged && d.y < playState.lineOfScrimmage + 3 && Math.abs(d.x - pState.initialX) < 4)
                             .sort((a, b) => getDistance(pState, a) - getDistance(pState, b));
                         const secondaryTargets = defenseStates
                             .filter(d => !d.isBlocked && !d.isEngaged && d.y >= playState.lineOfScrimmage + 3 && d.y < playState.lineOfScrimmage + 8 && Math.abs(d.x - pState.initialX) < 6)
                             .sort((a, b) => getDistance(pState, a) - getDistance(pState, b));
                         const targetDefender = primaryTargets[0] || secondaryTargets[0];
                         if (targetDefender) {
                             const interceptFactor = 0.6;
                             pState.targetX = pState.x + (targetDefender.x - pState.x) * interceptFactor;
                             pState.targetY = pState.y + (targetDefender.y - pState.y) * interceptFactor;
                         } else {
                             pState.targetX = pState.x;
                             pState.targetY = pState.y + 1.0; // Move slightly downfield
                         }
                    }
                    break;
                case 'run_path': case 'qb_scramble':
                    const threatDistance = 3.0;
                    const nearestThreat = defenseStates.filter(d => !d.isBlocked && !d.isEngaged && d.y > pState.y && d.y < pState.y + threatDistance && Math.abs(d.x - pState.x) < 2.0).sort((a, b) => getDistance(pState, a) - getDistance(pState, b))[0];
                    let targetXOffset = 0;
                    if (nearestThreat) { const distanceToThreat = getDistance(pState, nearestThreat); const avoidStrength = 1.0 + (threatDistance - distanceToThreat) * 0.5; targetXOffset = (pState.x >= nearestThreat.x) ? avoidStrength : -avoidStrength; }
                    pState.targetY = Math.min(FIELD_LENGTH - 10.1, pState.y + 7);
                    pState.targetX = pState.x + targetXOffset;
                    break;
                case 'qb_setup':
                    if (getDistance(pState, {x: pState.targetX, y: pState.targetY}) < 0.5) { pState.targetX = pState.x; pState.targetY = pState.y; }
                    break;
                case 'idle': default: pState.targetX = pState.x; pState.targetY = pState.y; break;
            } 
        } 
        // --- Defensive Logic ---
        else { 
            const assignment = pState.assignment;
            const readPlayType = playState.tick > 7 ? playType : null; 

            switch (true) {
                case assignment?.startsWith('man_cover_'):
                    const targetSlot = assignment.split('man_cover_')[1];
                    const assignedReceiver = offenseStates.find(o => o.slot === targetSlot);
                    if (assignedReceiver) {
                        target = assignedReceiver;
                        const speedDiff = (pState.speed || 50) - (target.speed || 50);
                        const yOffset = speedDiff < -15 ? -0.8 : speedDiff < -5 ? -0.3 : 0.3;
                        let xOffset = 0;
                        if ((target.x < HASH_LEFT_X && pState.x > target.x) || (target.x > HASH_RIGHT_X && pState.x < target.x)) { xOffset = (target.x < CENTER_X) ? 0.75 : -0.75; }
                        
                        if (isBallInAir && playState.ballState.targetPlayerId === target.id) {
                            pState.targetX = ballPos.x; pState.targetY = ballPos.y; 
                            return; // Target set directly
                        } else if (isBallInAir && getDistance(pState, ballPos) < 15) {
                            pState.targetX = ballPos.x; pState.targetY = ballPos.y; 
                            return; // Target set directly
                        }
                        // Modify target state for pursuit calc
                        target = { x: target.targetX + xOffset, y: target.targetY + yOffset, ...target };
                    } else { target = {x: pState.x, y: pState.y + 0.5};}
                    break;

                case assignment?.startsWith('zone_'):
                    const zoneCenter = getZoneCenter(assignment, playState.lineOfScrimmage);
                    target = zoneCenter; 
                    const isUnderneathZone = assignment.includes('flat') || assignment.includes('short') || assignment.includes('hook');
                    const carrierInZone = ballCarrierState && isUnderneathZone && isPlayerInZone(ballCarrierState, assignment, playState.lineOfScrimmage);
                    const threatsInZone = offenseStates.filter(o => (o.action === 'run_route' || o.action === 'route_complete') && isPlayerInZone(o, assignment, playState.lineOfScrimmage));
                    const closestThreat = threatsInZone.sort((a,b)=> getDistance(pState, a) - getDistance(pState, b))[0];

                    if (isBallInAir && isPlayerInZone({x: ballPos.x, y: ballPos.y}, assignment, playState.lineOfScrimmage) ) {
                         target = playState.activePlayers.find(p => p.id === playState.ballState.targetPlayerId) || ballPos;
                         if (target.speed === undefined) { pState.targetX = target.x; pState.targetY = target.y; return; } // Ball/Fixed point target
                    } else if (carrierInZone) {
                         target = ballCarrierState;
                    } else if (closestThreat) {
                         target = closestThreat;
                    } 
                    break;

                case assignment === 'pass_rush': case assignment === 'blitz_gap': case assignment === 'blitz_edge':
                    target = qbState;
                    const blockerInPath = offenseStates.find(o => !o.engagedWith && getDistance(pState, o) < 2.0 && Math.abs(o.x - pState.x) < 1.0 && ((pState.y < o.y && o.y < (target?.y || pState.y+5)) || (pState.y > o.y && o.y > (target?.y || pState.y-5))));
                    if (blockerInPath) {
                        const avoidOffset = (pState.x > blockerInPath.x) ? 1.0 : -1.0;
                        target = { x: pState.x + avoidOffset * 2, y: qbState ? qbState.y : pState.y + 5 };
                    } 
                    break;

                case assignment?.startsWith('run_gap_'): case assignment?.startsWith('run_edge_'):
                    const runTargetPoint = zoneBoundaries[assignment];
                    const ballSnapX = offenseStates.find(p=>p.slot === 'OL2')?.initialX || CENTER_X;
                    target = runTargetPoint ? { x: ballSnapX + (runTargetPoint.xOffset || 0), y: playState.lineOfScrimmage + (runTargetPoint.yOffset || 0) } : {x: pState.x, y: pState.y};

                    if (readPlayType === 'pass') { pState.assignment = 'pass_rush'; target = qbState; }
                    else if (ballCarrierState && getDistance(pState, ballCarrierState) < 6) { target = ballCarrierState; }
                    break;

                case 'spy_QB':
                     if (qbState) { pState.targetX = qbState.x; pState.targetY = qbState.y + 7; return; }
                     else { target = {x: pState.x, y: pState.y}; }
                     break;

                default: // Default / Pursuit of Interceptor/Carrier
                     if (isBallInAir) { target = ballPos; } 
                     else if (ballCarrierState) { target = ballCarrierState; }
                     else { target = {x: pState.x, y: pState.y + 0.05}; }
                     break;
            } 
            
            // --- Set Target Coordinates (Pursuit Logic) ---
            if (isPlayerState(target)) { // Target is a dynamic player state
                const targetSpeed = target.speed || 50;
                const ownSpeedYPS = Math.max(1, (pState.speed / 10 * pState.fatigueModifier));
                const distToTarget = getDistance(pState, target);
                const timeToIntercept = distToTarget > 0.1 ? distToTarget / ownSpeedYPS : 0;
                const anticipationFactor = Math.min(0.9, 0.4 + distToTarget / 15);
                const targetMoveDist = (target.speed / 10) * (target.fatigueModifier || 1.0) * timeToIntercept * anticipationFactor;
                
                const targetDX = target.targetX - target.x; const targetDY = target.targetY - target.y;
                const targetDistToTarget = Math.sqrt(targetDX*targetDX + targetDY*targetDY);
                
                let futureTargetX = target.x; let futureTargetY = target.y;
                if (targetDistToTarget > 0.1) {
                     futureTargetX += (targetDX / targetDistToTarget) * targetMoveDist;
                     futureTargetY += (targetDY / targetDistToTarget) * targetMoveDist;
                }
                pState.targetX = futureTargetX; pState.targetY = futureTargetY;
            } else if (target) { // Target is a fixed point {x, y}
                pState.targetX = target.x; pState.targetY = target.y;
            } else { // Fallback hold
                pState.targetX = pState.x; pState.targetY = pState.y;
            }
        } // End if(!isBlocked && !isEngaged)

        // Clamp targets within field boundaries
        pState.targetX = Math.max(0.5, Math.min(FIELD_WIDTH - 0.5, pState.targetX));
        pState.targetY = Math.max(0.5, Math.min(FIELD_LENGTH - 0.5, pState.targetY));
    }); // End forEach activePlayer
} // End updatePlayerTargets


/**
 * Checks for block engagements based on proximity.
 */
function checkBlockCollisions(playState) {
    const offenseStates = playState.activePlayers.filter(p => p.isOffense);
    const defenseStates = playState.activePlayers.filter(p => !p.isOffense);

    offenseStates.forEach(blocker => {
        if ((blocker.action === 'pass_block' || blocker.action === 'run_block') && !blocker.engagedWith) {
            const defendersInRange = defenseStates.filter(defender =>
                !defender.isBlocked && !defender.isEngaged &&
                getDistance(blocker, defender) < BLOCK_ENGAGE_RANGE
            );

            if (defendersInRange.length > 0) {
                const targetDefender = defendersInRange.sort((a, b) => getDistance(blocker, a) - getDistance(blocker, b))[0];
                blocker.engagedWith = targetDefender.id;
                blocker.isEngaged = true;
                targetDefender.isBlocked = true;
                targetDefender.blockedBy = blocker.id;
                targetDefender.isEngaged = true;
                playState.blockBattles.push({
                    blockerId: blocker.id, defenderId: targetDefender.id,
                    status: 'ongoing', streakA: 0, streakB: 0
                });
            }
        }
    });
}

/**
 * Checks for tackle attempts based on proximity to ball carrier.
 */
function checkTackleCollisions(playState, gameLog) {
     const ballCarrierState = playState.activePlayers.find(p => p.isBallCarrier);
     if (!ballCarrierState) return false;

     const activeDefenders = playState.activePlayers.filter(p => !p.isOffense && !p.isBlocked && !p.isEngaged && p.stunnedTicks === 0);

     for (const defender of activeDefenders) {
         if (getDistance(ballCarrierState, defender) < TACKLE_RANGE) {
             defender.isEngaged = true; // Mark defender as attempting tackle

             const carrierPlayer = game.players.find(p=>p && p.id === ballCarrierState.id);
             const tacklerPlayer = game.players.find(p=>p && p.id === defender.id);
             if (!carrierPlayer || !tacklerPlayer) {
                 console.warn("Tackle check: Could not find original player objects.");
                 defender.isEngaged = false; // Release defender
                 continue;
             }

             if (checkFumble(carrierPlayer, tacklerPlayer, playState, gameLog)) {
                 return true; // Fumble ends play
             }

             const breakPower = ((carrierPlayer.attributes?.physical?.agility || 50) + (carrierPlayer.attributes?.physical?.strength || 50)/2) * ballCarrierState.fatigueModifier;
             const tacklePower = ((tacklerPlayer.attributes?.technical?.tackling || 50) + (tacklerPlayer.attributes?.physical?.strength || 50)/2) * defender.fatigueModifier;
             const diff = breakPower - (tacklePower + getRandomInt(-15, 25));
             const TACKLE_THRESHOLD = 8; // <-- NEW: Carrier must beat roll by 8 to break

             if (diff <= TACKLE_THRESHOLD) { // Tackle success
                playState.yards = ballCarrierState.y - playState.lineOfScrimmage;
                playState.playIsLive = false;
                if (!tacklerPlayer.gameStats) ensureStats(tacklerPlayer); // Use ensureStats
                tacklerPlayer.gameStats.tackles = (tacklerPlayer.gameStats.tackles || 0) + 1;
                
                // --- REVISED SACK Logic ---
                // Check if carrier is QB, was in a passing action, and is behind LoS
                if (ballCarrierState.slot === 'QB1' && 
                    (ballCarrierState.action === 'qb_setup') && // Only 'qb_setup' counts as sack
                    ballCarrierState.y < playState.lineOfScrimmage) 
                {
                    playState.sack = true;
                    tacklerPlayer.gameStats.sacks = (tacklerPlayer.gameStats.sacks || 0) + 1;
                    // Log SACK instead of generic tackle
                    gameLog.push(`💥 SACK! ${tacklerPlayer.name} gets to ${ballCarrierState.name} for a loss of ${Math.abs(playState.yards).toFixed(1)} yards!`);
                } else {
                    // Log generic tackle
                    gameLog.push(`✋ ${ballCarrierState.name} tackled by ${defender.name} for a gain of ${playState.yards.toFixed(1)} yards.`);
                }
                return true; // Play ended
            } else { // Broken tackle
                 gameLog.push(`💥 ${ballCarrierState.name} breaks tackle from ${defender.name}!`);
                 defender.isEngaged = false; // Defender failed
                 defender.stunnedTicks = 10; // <-- ADD THIS LINE (Stun for 10 ticks / 1.5 seconds)
             }
         }
     }
     return false; // Play continues
}

/**
 * Abstract helper to resolve a contested battle.
 * Modifies the 'battle' object directly.
 */
function resolveBattle(powerA, powerB, battle) {
    const rollA = powerA + getRandomInt(0, 30);
    const rollB = powerB + getRandomInt(0, 30);
    const diff = rollA - rollB;

    if (diff > 10) { // A wins decisively
        battle.streakA++; battle.streakB = 0;
        if(battle.streakA >= 2) battle.status = 'win_A'; // A wins after 2 consecutive
    } else if (diff < -10) { // B wins decisively
        battle.streakB++; battle.streakA = 0;
        if(battle.streakB >= 2) battle.status = 'win_B'; // B wins after 2 consecutive
    } else { // Draw / Minor win, reset streaks
        battle.streakA = 0; battle.streakB = 0;
        battle.status = 'draw';
    }
}

/**
 * Resolves ongoing block battles based on stats.
 */
function resolveOngoingBlocks(playState, gameLog) {
    const battlesToRemove = [];
    playState.blockBattles.forEach((battle, index) => {
        if (battle.status !== 'ongoing' && battle.status !== 'draw') return; // Only process active/drawn battles

        const blockerState = playState.activePlayers.find(p => p.id === battle.blockerId);
        const defenderState = playState.activePlayers.find(p => p.id === battle.defenderId);

        if (!blockerState || !defenderState || blockerState.engagedWith !== defenderState.id || defenderState.blockedBy !== blockerState.id) {
            battle.status = 'disengaged';
            battlesToRemove.push(index);
            if (blockerState) { blockerState.engagedWith = null; blockerState.isEngaged = false; }
            if (defenderState) { defenderState.isBlocked = false; defenderState.blockedBy = null; defenderState.isEngaged = false; }
            return;
        }

        const blockPower = ((blockerState.blocking || 50) + (blockerState.strength || 50)) * blockerState.fatigueModifier;
        const shedPower = ((defenderState.blockShedding || 50) + (defenderState.strength || 50)) * defenderState.fatigueModifier;

        resolveBattle(blockPower, shedPower, battle); // Helper updates battle.status

        if (battle.status === 'win_B') { // Defender wins (sheds block)
            // gameLog.push(`🛡️ ${defenderState.name} sheds block from ${blockerState.name}!`);
            blockerState.engagedWith = null; blockerState.isEngaged = false;
            defenderState.isBlocked = false; defenderState.blockedBy = null; defenderState.isEngaged = false;
            battlesToRemove.push(index);
        } else if (battle.status === 'win_A' || battle.status === 'draw') { // Blocker sustains
            battle.status = 'ongoing'; // Reset draw to ongoing for next tick
            battle.streakA = 0; battle.streakB = 0;
            blockerState.targetX = defenderState.x; blockerState.targetY = defenderState.y; // Mirror
        }
        
        if (getDistance(blockerState, defenderState) > BLOCK_ENGAGE_RANGE + 0.5) {
             battle.status = 'disengaged';
             battlesToRemove.push(index);
             blockerState.engagedWith = null; blockerState.isEngaged = false;
             defenderState.isBlocked = false; defenderState.blockedBy = null; defenderState.isEngaged = false;
        }
    });

    for (let i = battlesToRemove.length - 1; i >= 0; i--) {
        playState.blockBattles.splice(battlesToRemove[i], 1);
    }
}


/**
 * Handles QB decision-making (throw, scramble, checkdown).
 */
function updateQBDecision(playState, offenseStates, defenseStates, gameLog) {
    const qbState = offenseStates.find(p => p.slot === 'QB1' && p.hasBall);
    if (!qbState || playState.ballState.inAir) return;

    const qbPlayer = game.players.find(p => p && p.id === qbState.id);
    if (!qbPlayer) return;

    // 1. Check Pressure
    const pressureDefender = defenseStates.find(d => !d.isBlocked && !d.isEngaged && getDistance(qbState, d) < 4.5);
    const isPressured = !!pressureDefender;
    const imminentSackDefender = isPressured && getDistance(qbState, pressureDefender) < TACKLE_RANGE + 0.2;

    // 2. Scan Receivers
    const receivers = offenseStates.filter(p => p.action === 'run_route' || p.action === 'route_complete');
    let openReceivers = [];
    receivers.forEach(recState => {
         const closestDefender = defenseStates.filter(d => !d.isBlocked && !d.isEngaged).sort((a, b) => getDistance(recState, a) - getDistance(recState, b))[0];
         const separation = closestDefender ? getDistance(recState, closestDefender) : 100;
         if (separation > SEPARATION_THRESHOLD) {
             openReceivers.push({ ...recState, separation });
         }
    });
    openReceivers.sort((a, b) => b.y - a.y); // Prioritize deeper open receivers

    // 3. Decision Time
    const qbDecisionTimeTicks = Math.max(8, Math.round( (100 - (qbState.playbookIQ || 50)) / 5 ) ); // ~1.2s to ~10s
    const pressureModifier = isPressured ? 0.4 : 1.0;
    let decisionMade = false;

    if (imminentSackDefender) { decisionMade = true; }
    else if (playState.tick * pressureModifier >= qbDecisionTimeTicks) { decisionMade = true; }
    else if (openReceivers.length > 0 && Math.random() < 0.3 + (playState.tick / 30)) { decisionMade = true; }

    if (decisionMade) {
        let targetPlayerState = null;
        if (openReceivers.length > 0 && (!isPressured || Math.random() < 0.7)) {
            targetPlayerState = openReceivers[0]; // Throw to primary open
        }
        else if (isPressured && (qbState.agility || 50) > 60 && Math.random() < 0.6) {
            qbState.action = 'qb_scramble';
            const pressureXDir = Math.sign(qbState.x - pressureDefender.x);
            qbState.targetX = Math.max(0.1, Math.min(FIELD_WIDTH - 0.1, qbState.x + pressureXDir * 8));
            qbState.targetY = qbState.y + 5;
            qbState.hasBall = false;
            qbState.isBallCarrier = true;
            playState.ballState.x = qbState.x; playState.ballState.y = qbState.y;
            gameLog.push(`🏃 ${qbState.name} is flushed out and scrambles!`);
            return;
        }
        else if (receivers.length > 0) { // Checkdown
             targetPlayerState = receivers.filter(r => r.y > qbState.y).sort((a,b) => getDistance(qbState, a) - getDistance(qbState, b))[0];
        }

        if (targetPlayerState) {
            // --- Initiate Throw ---
            gameLog.push(`🏈 ${qbState.name} throws ${isPressured ? 'under pressure ' : ''}to ${targetPlayerState.name}...`);
            playState.ballState.inAir = true;
            playState.ballState.targetPlayerId = targetPlayerState.id;
            playState.ballState.throwerId = qbState.id; // <-- For stat tracking
            playState.ballState.throwInitiated = true; // <-- For stat tracking
            qbState.hasBall = false;
            qbState.isBallCarrier = false; // No longer carrier once ball is thrown

            // --- Basic Ball Physics ---
            const targetX = targetPlayerState.targetX; const targetY = targetPlayerState.targetY;
            const dx = targetX - qbState.x; const dy = targetY - qbState.y;
            const distance = Math.sqrt(dx*dx + dy*dy);
            const accuracy = qbPlayer.attributes.technical?.throwingAccuracy || 50;
            const accuracyRoll = (100 - accuracy) / 100;
            const xError = (Math.random() - 0.5) * 6 * accuracyRoll; 
            const yError = (Math.random() - 0.5) * 6 * accuracyRoll;
            const throwSpeedYPS = 25 + (qbPlayer.attributes.physical?.strength || 50) / 10;
            const airTime = Math.max(0.3, distance / throwSpeedYPS);

            playState.ballState.vx = (dx / airTime) + xError;
            playState.ballState.vy = (dy / airTime) + yError;
            playState.ballState.vz = Math.min(15, 5 + distance / 3) / airTime;
            // --- End Ball Physics ---

        } else if (imminentSackDefender) {
             gameLog.push(`⏳ ${qbState.name} holds it too long...`); // Sack will be handled by checkTackleCollisions
        } else {
             // No target, throw away
             gameLog.push(`⤴️ ${qbState.name} feels the pressure and throws it away!`);
             playState.incomplete = true;
             playState.playIsLive = false;
             playState.ballState.inAir = false;
             playState.ballState.throwInitiated = true; // Still counts as an attempt
             playState.ballState.throwerId = qbState.id;
             qbState.hasBall = false;
             qbState.isBallCarrier = false;
        }

    } else if (isPressured && qbState.action === 'qb_setup') {
        // Evasive movement if pressured but not decided yet
        const pressureDirX = Math.sign(qbState.x - pressureDefender.x);
        qbState.targetX = qbState.x + pressureDirX * 1.5;
        qbState.targetY = qbState.y - 0.3;
    }
}


/**
 * Handles ball arrival at target coordinates.
 */
function handleBallArrival(playState, gameLog) {
    if (!playState.ballState.inAir || playState.ballState.z > 2.5 || playState.ballState.z < 0.2) return;

    const targetPlayerState = playState.activePlayers.find(p => p.id === playState.ballState.targetPlayerId);
    if (!targetPlayerState) {
         gameLog.push("Ball arrives, but target receiver not found! Incomplete.");
         playState.incomplete = true; playState.playIsLive = false; playState.ballState.inAir = false; return;
    }

    const playersNearBall = playState.activePlayers.filter(p =>
        getDistance(p, playState.ballState) < CATCH_RADIUS + (p.isOffense ? 0 : 0.75)
    ).sort((a,b) => getDistance(a, playState.ballState) - getDistance(b, playState.ballState));

    const intendedReceiver = playersNearBall.find(p => p.id === targetPlayerState.id);
    const closestDefender = playersNearBall.find(p => !p.isOffense);

    let interception = false;
    let interceptorState = null;

    if (closestDefender) {
        const defenderPlayer = game.players.find(p=>p && p.id === closestDefender.id);
        if (defenderPlayer) {
            const defenderCatchPower = (defenderPlayer.attributes.technical?.catchingHands || 30) * closestDefender.fatigueModifier;
            const proximityAdvantage = intendedReceiver ? getDistance(closestDefender, playState.ballState) < getDistance(intendedReceiver, playState.ballState) : true;
            if ((defenderCatchPower / 100) > (Math.random() * (proximityAdvantage ? 0.7 : 1.5))) {
                 interception = true;
                 interceptorState = closestDefender;
            }
        }
    }

    if (interception && interceptorState) {
        const interceptorPlayer = game.players.find(p=>p && p.id === interceptorState.id);
        gameLog.push(`❗ INTERCEPTION by ${interceptorState.name}! He's looking to return it!`);
        playState.turnover = true;
        
        interceptorState.isBallCarrier = true;
        interceptorState.hasBall = true;
        interceptorState.action = 'run_path'; // Switch to running
        interceptorState.targetY = 5; // Target opponent endzone
        interceptorState.targetX = interceptorState.x;

        playState.activePlayers.forEach(p => {
            if (p.isOffense) {
                p.action = 'pursuit'; // Switch offense to pursuit
                p.hasBall = false; p.isBallCarrier = false;
            } else {
                 p.isBallCarrier = (p.id === interceptorState.id);
                 p.hasBall = (p.id === interceptorState.id);
                 if (p.id !== interceptorState.id) p.action = 'run_block'; // Other defenders block
            }
        });
         if (interceptorPlayer) {
             if (!interceptorPlayer.gameStats) ensureStats(interceptorPlayer);
             interceptorPlayer.gameStats.interceptions = (interceptorPlayer.gameStats.interceptions || 0) + 1;
        }
    } else if (intendedReceiver && getDistance(intendedReceiver, playState.ballState) < CATCH_RADIUS) {
        const receiverPlayer = game.players.find(p=>p && p.id === intendedReceiver.id);
        if (receiverPlayer) {
            const receiverCatchPower = (receiverPlayer.attributes.technical?.catchingHands || 50) * intendedReceiver.fatigueModifier;
            const defenderInterference = closestDefender ? ( (closestDefender.agility || 50) + (closestDefender.playbookIQ || 50) ) / 2 * closestDefender.fatigueModifier : 0;
            const catchDiff = receiverCatchPower - (defenderInterference + getRandomInt(-15, 25));

            if (catchDiff > 2) { // Catch
                 intendedReceiver.isBallCarrier = true; intendedReceiver.hasBall = true;
                 playState.yards = intendedReceiver.y - playState.lineOfScrimmage;
                 gameLog.push(`👍 Caught by ${intendedReceiver.name} at y=${intendedReceiver.y.toFixed(1)}! (Air Yards: ${playState.yards.toFixed(1)})`);
            } else { // Drop
                 gameLog.push(`❌ INCOMPLETE pass to ${intendedReceiver.name}. ${closestDefender ? `Defended by ${closestDefender.name}.` : 'Dropped.'}`);
                 playState.incomplete = true; playState.playIsLive = false;
            }
        } else {
            gameLog.push("Error finding receiver for catch check. Incomplete.");
            playState.incomplete = true; playState.playIsLive = false;
        }
    } else { // Inaccurate pass
         gameLog.push(`‹‹ Pass falls incomplete near ${targetPlayerState?.name || 'target area'}.`);
         playState.incomplete = true; playState.playIsLive = false;
    }
    playState.ballState.inAir = false;
}

/** Helper to ensure gameStats object exists before writing. */
const ensureStats = (player) => {
    if (player && !player.gameStats) {
        player.gameStats = {
            receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0,
            tackles: 0, sacks: 0, interceptions: 0,
            passAttempts: 0, passCompletions: 0, interceptionsThrown: 0
        };
    }
};

/**
 * Updates player game stats based on the final play outcome.
 */
function finalizeStats(playState, offense, defense) {
     const carrierState = playState.activePlayers.find(p => p.isBallCarrier);
     const throwerState = playState.activePlayers.find(p => p.id === playState.ballState.throwerId);
     const receiverState = playState.activePlayers.find(p => p.id === playState.ballState.targetPlayerId && p.isOffense);
     const interceptorState = playState.turnover && !playState.sack ? playState.activePlayers.find(p => p.isBallCarrier && !p.isOffense) : null;

     const qbPlayer = throwerState ? game.players.find(p => p && p.id === throwerState.id) : null;
     const carrierPlayer = carrierState ? game.players.find(p => p && p.id === carrierState.id) : null;
     const receiverPlayer = receiverState ? game.players.find(p => p && p.id === receiverState.id) : null;
     const interceptorPlayer = interceptorState ? game.players.find(p => p && p.id === interceptorState.id) : null;

     ensureStats(qbPlayer);
     ensureStats(carrierPlayer);
     ensureStats(receiverPlayer);
     ensureStats(interceptorPlayer);

     if (qbPlayer && playState.ballState.throwInitiated) {
         qbPlayer.gameStats.passAttempts = (qbPlayer.gameStats.passAttempts || 0) + 1;
     }

     if (playState.sack) {
         // Sack stats assigned in checkTackleCollisions
     } else if (playState.turnover) {
         if (interceptorPlayer && qbPlayer) {
             qbPlayer.gameStats.interceptionsThrown = (qbPlayer.gameStats.interceptionsThrown || 0) + 1;
         }
     } else if (playState.incomplete) {
         // Pass attempt already counted
     } else if (carrierPlayer) {
         const finalYards = Math.round(playState.yards);
         const isTouchdown = playState.touchdown;
         const wasPassCaught = carrierState.id === receiverState?.id && playState.ballState.throwInitiated;

         if (wasPassCaught && receiverPlayer) {
             receiverPlayer.gameStats.receptions = (receiverPlayer.gameStats.receptions || 0) + 1;
             receiverPlayer.gameStats.recYards = (receiverPlayer.gameStats.recYards || 0) + finalYards;
             if (isTouchdown) receiverPlayer.gameStats.touchdowns = (receiverPlayer.gameStats.touchdowns || 0) + 1;
             if (qbPlayer) {
                 qbPlayer.gameStats.passCompletions = (qbPlayer.gameStats.passCompletions || 0) + 1;
                 qbPlayer.gameStats.passYards = (qbPlayer.gameStats.passYards || 0) + finalYards;
                 if (isTouchdown) qbPlayer.gameStats.touchdowns = (qbPlayer.gameStats.touchdowns || 0) + 1;
             }
         } else if (carrierState.isOffense) { // Running Play
              carrierPlayer.gameStats.rushYards = (carrierPlayer.gameStats.rushYards || 0) + finalYards;
              if (isTouchdown) carrierPlayer.gameStats.touchdowns = (carrierPlayer.gameStats.touchdowns || 0) + 1;
         } else {
              // INT Return Yards (not currently tracked)
         }
     }
}

// =============================================================
// --- UPDATED resolvePlay FUNCTION ---
// =============================================================

/**
 * Simulates a single play using a coordinate-based tick system.
 */
function resolvePlay(offense, defense, offensivePlayKey, defensivePlayKey, gameState) {
    const { gameLog = [], weather, ballOn } = gameState;

    const play = offensivePlaybook[offensivePlayKey];
    if (!play) {
        console.error(`Play key "${offensivePlayKey}" not found...`);
        gameLog.push("CRITICAL ERROR: Play definition missing!");
        return { yards: 0, turnover: true, incomplete: false, touchdown: false, log: gameLog, visualizationFrames: [] };
    }
    const { type, assignments } = play;

    const playState = {
        playIsLive: true, tick: 0, maxTicks: 100,
        yards: 0, touchdown: false, turnover: false, incomplete: false, sack: false,
        ballState: { x: 0, y: 0, z: 1.0, vx: 0, vy: 0, vz: 0, targetPlayerId: null, inAir: false, throwerId: null, throwInitiated: false },
        lineOfScrimmage: 0, activePlayers: [], blockBattles: [], visualizationFrames: []
    };

    try {
        playState.lineOfScrimmage = ballOn + 10;
        setupInitialPlayerStates(playState, offense, defense, play, assignments, ballOn, defensivePlayKey);
    } catch (setupError) {
        console.error("CRITICAL ERROR during setupInitialPlayerStates:", setupError);
        gameLog.push("CRITICAL ERROR: Play setup failed. Turnover.");
        return { yards: 0, turnover: true, incomplete: false, touchdown: false, log: gameLog, visualizationFrames: [] };
    }

    if (!playState.activePlayers.some(p => p.slot === 'QB1' && p.isOffense)) {
         gameLog.push("No QB found for play. Turnover.");
         return { yards: 0, turnover: true, incomplete: false, touchdown: false, log: gameLog, visualizationFrames: [] };
    }


    // --- 3. TICK LOOP ---
    let ballCarrierState = null; // <-- ADD THIS LINE to declare it here
    try {
        while (playState.playIsLive && playState.tick < playState.maxTicks) {
            playState.tick++;
            const timeDelta = TICK_DURATION_SECONDS;

            const offenseStates = playState.activePlayers.filter(p => p.isOffense);
            const defenseStates = playState.activePlayers.filter(p => !p.isOffense);
            ballCarrierState = playState.activePlayers.find(p => p.isBallCarrier);

            // A. Update Player Intentions/Targets (AI)
            updatePlayerTargets(playState, offenseStates, defenseStates, ballCarrierState, type, assignments, defensivePlayKey);

            // B. Update Player Positions (Movement)
            playState.activePlayers.forEach(p => updatePlayerPosition(p, timeDelta));

            // C. Update Ball Position
            if (playState.ballState.inAir) {
                playState.ballState.x += playState.ballState.vx * timeDelta;
                playState.ballState.y += playState.ballState.vy * timeDelta;
                playState.ballState.z += playState.ballState.vz * timeDelta;
                playState.ballState.vz -= 9.8 * timeDelta * timeDelta; // Gravity
                if (playState.ballState.z <= 0.1 && playState.tick > 2) {
                    playState.incomplete = true; playState.playIsLive = false; playState.ballState.inAir = false;
                    break;
                }
                // --- ADD THIS CHECK FOR OUT OF BOUNDS PASS ---
            if (playState.ballState.x <= 0.1 || playState.ballState.x >= FIELD_WIDTH - 0.1 || playState.ballState.y >= FIELD_LENGTH - 0.1) {
                gameLog.push(`‹‹ Pass sails out of bounds. Incomplete.`);
                playState.incomplete = true; playState.playIsLive = false; playState.ballState.inAir = false;
                break; // End play
            }
            // --- END ADDED BLOCK ---
            } else if (ballCarrierState) {
                playState.ballState.x = ballCarrierState.x;
                playState.ballState.y = ballCarrierState.y;
                playState.ballState.z = 0.5;
            }

            // D. Check Collisions & Initiate Battles/Actions
            if (playState.playIsLive) {
                checkBlockCollisions(playState);
                ballCarrierState = playState.activePlayers.find(p => p.isBallCarrier);
                if (ballCarrierState) {
                    if (checkTackleCollisions(playState, gameLog)) break;
                }
                if (playState.ballState.inAir && playState.ballState.z <= 2.5 && playState.ballState.z > 0.1) {
                    handleBallArrival(playState, gameLog);
                    if (!playState.playIsLive) break;
                }
            }

            // E. Resolve Ongoing Battles (Blocks)
            if (playState.playIsLive) {
                resolveOngoingBlocks(playState, gameLog);
            }

            // F. QB Logic (Decide Throw/Scramble)
            if (playState.playIsLive && type === 'pass' && !playState.ballState.inAir && !playState.turnover && !playState.sack) {
                updateQBDecision(playState, offenseStates, defenseStates, gameLog);
                if (!playState.playIsLive) break;
            }

            // G. Check End Conditions (TD, OOB)
            if (playState.playIsLive) {
                ballCarrierState = playState.activePlayers.find(p => p.isBallCarrier);
                if (ballCarrierState) {
                    if (ballCarrierState.y >= FIELD_LENGTH - 10) { // TD
                        playState.yards = FIELD_LENGTH - 10 - playState.lineOfScrimmage;
                        playState.touchdown = true; playState.playIsLive = false;
                        const scorer = game.players.find(p=>p && p.id === ballCarrierState.id);
                        gameLog.push(`🎉 TOUCHDOWN ${scorer?.name || 'player'}!`);
                        break;
                    }
                    if (ballCarrierState.x <= 0.1 || ballCarrierState.x >= FIELD_WIDTH - 0.1) { // OOB
                        playState.yards = ballCarrierState.y - playState.lineOfScrimmage;
                        playState.playIsLive = false;
                        gameLog.push(` sidelines... ${ballCarrierState.name} ran out of bounds after a gain of ${playState.yards.toFixed(1)} yards.`);
                        break;
                    }
                }
            }

            // H. Update Fatigue
            playState.activePlayers.forEach(pState => {
                if (!pState) return;
                let fatigueGain = 0.1;
                const action = pState.action;
                const assignment = pState.assignment; // Get assignment
                if (action === 'run_path' || action === 'qb_scramble' || action === 'run_route' ||
                    action === 'pass_rush' || action === 'blitz_gap' || action === 'blitz_edge' ||
                    action === 'pursuit' || assignment?.startsWith('man_cover_')) { // Updated action
                    fatigueGain += 0.3;
                } else if (action === 'pass_block' || action === 'run_block' || pState.engagedWith) {
                    fatigueGain += 0.2;
                }
                const player = game.players.find(p => p && p.id === pState.id);
                if (player) {
                    player.fatigue = Math.min(100, (player.fatigue || 0) + fatigueGain);
                    const stamina = player.attributes?.physical?.stamina || 50;
                    pState.fatigueModifier = Math.max(0.3, (1 - (player.fatigue / (stamina * 3))));
                }
            });

            // I. Record Visualization Frame
            const frameData = {
                players: JSON.parse(JSON.stringify(playState.activePlayers)),
                ball: JSON.parse(JSON.stringify(playState.ballState))
            };
            playState.visualizationFrames.push(frameData);

        } // --- End TICK LOOP ---
    } catch (tickError) {
        console.error("CRITICAL ERROR during simulation tick loop:", tickError);
        gameLog.push(`CRITICAL ERROR: Simulation failed mid-play. ${tickError.message}`);
        playState.playIsLive = false;
        playState.incomplete = true; // Default to incomplete on crash
    }

    // --- 4. Finalize Results ---
    if (playState.playIsLive && !playState.touchdown) { // If loop finished by time limit
        ballCarrierState = playState.activePlayers.find(p => p.isBallCarrier);
        if (ballCarrierState) {
             playState.yards = ballCarrierState.y - playState.lineOfScrimmage;
             gameLog.push(`⏱️ Play ends. Gain of ${playState.yards.toFixed(1)} yards.`);
        } else if (!playState.sack && !playState.turnover) {
             playState.incomplete = true; playState.yards = 0;
             gameLog.push("⏱️ Play ends, incomplete.");
        } else {
             gameLog.push("⏱️ Play ends.");
        }
    }

    playState.yards = Math.round(playState.yards);
    if(playState.sack) { playState.yards = Math.min(0, playState.yards); }
    if(playState.incomplete || (playState.turnover && !playState.touchdown)) { // Don't reset yards on pick-six
         playState.yards = 0;
    }
    if(playState.touchdown && !playState.turnover) { // Offensive TD
         playState.yards = Math.max(0, FIELD_LENGTH - 10 - playState.lineOfScrimmage);
    } else if (playState.touchdown && playState.turnover) { // Defensive TD
         playState.yards = 0; // No offensive yards
    }

    finalizeStats(playState, offense, defense);

    return {
        yards: playState.yards,
        touchdown: playState.touchdown,
        turnover: playState.turnover,
        incomplete: playState.incomplete,
        log: gameLog,
        visualizationFrames: playState.visualizationFrames
    };
}


// =============================================================
// --- GAME SIMULATION ---
// =============================================================

/**
 * Determines the offensive play call.
 */
function determinePlayCall(offense, defense, down, yardsToGo, ballOn, scoreDiff, gameLog, drivesRemaining) {
    if (!offense || !defense || !offense.formations || !defense.formations || !offense.coach) {
        console.error("determinePlayCall: Invalid team data."); return 'Balanced_InsideRun';
    }
    const { coach } = offense;
    const offenseFormationName = offense.formations.offense;
    const defenseFormationName = defense.formations.defense;
    const offenseFormation = offenseFormations[offenseFormationName];
    const defenseFormation = defenseFormations[defenseFormationName];

    if (!offenseFormation?.personnel || !defenseFormation?.personnel) {
        console.error(`CRITICAL ERROR: Formation data missing for ${offense.name} (${offenseFormationName}) or ${defense.name} (${defenseFormationName}).`);
        return 'Balanced_InsideRun';
    }

    const usedIds = new Set();
    const qb = getPlayerBySlot(offense, 'offense', 'QB1', usedIds) || findEmergencyPlayer('QB', offense, 'offense', usedIds)?.player;
    const rb = getPlayerBySlot(offense, 'offense', 'RB1', usedIds) || findEmergencyPlayer('RB', offense, 'offense', usedIds)?.player;
    const qbStrength = qb ? calculateOverall(qb, 'QB') : 0;
    const rbStrength = rb ? calculateOverall(rb, 'RB') : 0;

    let passChance = 0.45;
    if (defenseFormation) {
        const defPersonnel = defenseFormation.personnel;
        if (defPersonnel.DL >= 4 || (defPersonnel.DL === 3 && defPersonnel.LB >= 3)) { passChance += 0.15; }
        if (defPersonnel.DB >= 2 || (defPersonnel.DB === 1 && defPersonnel.LB >= 3)) { passChance -= 0.10; }
    }
    if (offenseFormation.personnel.WR > defenseFormation.personnel.DB + 1) passChance += 0.2;
    if (offenseFormation.personnel.RB + offenseFormation.personnel.OL > defenseFormation.personnel.DL + defenseFormation.personnel.LB + 1) passChance -= 0.2;
    if (qbStrength < 50 && rbStrength > 50) passChance -= 0.25;
    if (rbStrength < 50 && qbStrength > 50) passChance += 0.15;
    if (qbStrength > rbStrength + 15) passChance += 0.1;
    if (rbStrength > qbStrength + 15) passChance -= 0.1;

    const totalDrivesPerHalf = 8; // Approx
    const isLateGame = drivesRemaining <= 2;
    const isEndOfHalf = (drivesRemaining % totalDrivesPerHalf <= 1) && drivesRemaining <= totalDrivesPerHalf;

    if (down === 3 && yardsToGo > 6) passChance += 0.4;
    else if (down === 4 && yardsToGo > 3) passChance = 0.95;
    else if (yardsToGo <= 2) passChance -= 0.4;
    if (ballOn > 80 && ballOn < 98) passChance += 0.1;
    else if (ballOn >= 98) passChance -= 0.2;
    if (scoreDiff < -10) passChance += (isLateGame ? 0.3 : 0.2);
    if (scoreDiff > 14 && (isLateGame || isEndOfHalf)) passChance -= 0.4;
    else if (scoreDiff > 7 && (isLateGame || isEndOfHalf)) passChance -= 0.2;

    if (coach.type === 'Ground and Pound') passChance -= 0.3;
    if (coach.type === 'West Coast Offense') passChance += 0.2;
    if (coach.type === 'Spread') passChance += 0.25;

    passChance = Math.max(0.05, Math.min(0.95, passChance));

    const formationPlays = Object.keys(offensivePlaybook).filter(key => key.startsWith(offenseFormationName));
    if (formationPlays.length === 0) {
        console.error(`CRITICAL: No plays found for formation ${offenseFormationName}!`);
        return 'Balanced_InsideRun';
    }

    if (yardsToGo <= 1 && qbStrength > 60 && Math.random() < 0.6) {
        const sneakPlay = formationPlays.find(p => offensivePlaybook[p]?.zone === ZONES.SNEAK);
        if (sneakPlay) return sneakPlay;
    }

    let desiredPlayType = (Math.random() < passChance) ? 'pass' : 'run';
    let possiblePlays = formationPlays.filter(key => offensivePlaybook[key]?.type === desiredPlayType);

    if (possiblePlays.length === 0) {
        desiredPlayType = desiredPlayType === 'pass' ? 'run' : 'pass';
        possiblePlays = formationPlays.filter(key => offensivePlaybook[key]?.type === desiredPlayType);
        if (possiblePlays.length === 0) return formationPlays[0];
    }

    let chosenPlay = null;
    if (desiredPlayType === 'pass') {
        const deepPlays = possiblePlays.filter(p => offensivePlaybook[p]?.tags?.includes('deep'));
        const shortPlays = possiblePlays.filter(p => offensivePlaybook[p]?.tags?.includes('short') || offensivePlaybook[p]?.tags?.includes('screen'));
        const mediumPlays = possiblePlays.filter(p => !offensivePlaybook[p]?.tags?.includes('deep') && !offensivePlaybook[p]?.tags?.includes('short'));

        if (down >= 3 && yardsToGo >= 8 && deepPlays.length > 0) chosenPlay = getRandom(deepPlays);
        else if (down <= 2 && yardsToGo <= 5 && shortPlays.length > 0) chosenPlay = getRandom(shortPlays);
        else if (mediumPlays.length > 0) chosenPlay = getRandom(mediumPlays);
        else chosenPlay = getRandom([...shortPlays, ...deepPlays].filter(Boolean)); // Filter(Boolean) handles empty arrays
    } else { // Run
        const insidePlays = possiblePlays.filter(p => offensivePlaybook[p]?.tags?.includes('inside'));
        const outsidePlays = possiblePlays.filter(p => offensivePlaybook[p]?.tags?.includes('outside'));
        const powerPlays = possiblePlays.filter(p => offensivePlaybook[p]?.tags?.includes('power'));

        if (yardsToGo <= 2 && powerPlays.length > 0) chosenPlay = getRandom(powerPlays);
        else if (yardsToGo <= 3 && insidePlays.length > 0) chosenPlay = getRandom(insidePlays);
        else if (rbStrength > qbStrength + 10 && Math.random() < 0.6 && outsidePlays.length > 0) chosenPlay = getRandom(outsidePlays);
        else if (insidePlays.length > 0) chosenPlay = getRandom(insidePlays);
        else chosenPlay = getRandom([...outsidePlays, ...powerPlays].filter(Boolean));
    }

    chosenPlay = chosenPlay || getRandom(possiblePlays) || formationPlays[0];
    return chosenPlay;
}

/**
 * Determines the defensive play call.
 */
function determineDefensivePlayCall(defense, offense, down, yardsToGo, ballOn, gameLog) {
    const formationPlays = Object.keys(defensivePlaybook);
    if (formationPlays.length === 0) {
        console.error(`No defensive plays found in playbook!`);
        return 'Cover_2_Zone';
    }

    const categorizedPlays = { blitz: [], runStop: [], zone: [], man: [] };
    formationPlays.forEach(key => {
        const play = defensivePlaybook[key];
        if (!play) return;
        if (key.includes('Run_Stop') || play.name.includes('Run Stop')) categorizedPlays.runStop.push(key);
        else if (play.blitz === true) categorizedPlays.blitz.push(key);
        else if (play.concept === 'Zone') categorizedPlays.zone.push(key);
        else if (play.concept === 'Man') categorizedPlays.man.push(key);
    });

    const isObviousPass = (down === 3 && yardsToGo >= 7) || (down === 4 && yardsToGo >= 3) || (down === 2 && yardsToGo >= 10);
    const isObviousRun = (yardsToGo <= 2 && down >= 3) || (yardsToGo <= 1);
    const isRedZone = ballOn >= 80;

    const offFormation = offenseFormations[offense.formations.offense];
    const offPersonnel = offFormation?.personnel || { WR: 2, RB: 1 };
    const isSpreadOffense = offPersonnel.WR >= 3;
    const isHeavyOffense = offPersonnel.RB >= 2;
    const coachType = defense.coach?.type || 'Balanced';

    let preferredPlayTypes = [];
    if (isObviousRun || (isHeavyOffense && !isObviousPass)) {
        preferredPlayTypes.push(...categorizedPlays.runStop, ...categorizedPlays.blitz, ...categorizedPlays.man);
    } else if (isObviousPass || isSpreadOffense) {
        preferredPlayTypes.push(...categorizedPlays.zone, ...categorizedPlays.man, ...categorizedPlays.blitz);
    } else {
        preferredPlayTypes.push(...categorizedPlays.zone, ...categorizedPlays.man, ...categorizedPlays.runStop);
    }

    if (coachType === 'Blitz-Happy Defense' && categorizedPlays.blitz.length > 0) {
        preferredPlayTypes.push(...categorizedPlays.blitz, ...categorizedPlays.blitz, ...categorizedPlays.blitz);
    }
    if (coachType === 'Ground and Pound' && categorizedPlays.runStop.length > 0) {
        preferredPlayTypes.push(...categorizedPlays.runStop, ...categorizedPlays.runStop);
    }
    if (coachType === 'West Coast Offense' && categorizedPlays.zone.length > 0) {
        preferredPlayTypes.push(...categorizedPlays.zone, ...categorizedPlays.zone);
    }
    if (isRedZone) {
        preferredPlayTypes.push(...categorizedPlays.man, ...categorizedPlays.zone.filter(k => !k.includes('Deep')));
    }

    let chosenPlay = null;
    if (preferredPlayTypes.length > 0) {
        const uniquePreferredPlays = [...new Set(preferredPlayTypes)];
        chosenPlay = getRandom(uniquePreferredPlays);
    }
    if (!chosenPlay) {
        chosenPlay = getRandom(formationPlays);
    }
    return chosenPlay;
}


/**
 * Simulates a full game between two teams.
 */
export function simulateGame(homeTeam, awayTeam) {
    if (!homeTeam || !awayTeam || !homeTeam.roster || !awayTeam.roster) {
        console.error("simulateGame: Invalid team data provided.");
        return { homeTeam, awayTeam, homeScore: 0, awayScore: 0, gameLog: ["Error: Invalid team data"], breakthroughs: [] };
    }
    resetGameStats();
    aiSetDepthChart(homeTeam);
    aiSetDepthChart(awayTeam);

    const gameLog = [];
    const allVisualizationFrames = [];
    let homeScore = 0, awayScore = 0;
    const weather = getRandom(['Sunny', 'Windy', 'Rain']);
    gameLog.push(`Weather: ${weather}`);

    const breakthroughs = [];
    const totalDrivesPerHalf = getRandomInt(7, 9);
    let currentHalf = 1, drivesThisGame = 0;

    gameLog.push("Coin toss to determine first possession...");
    const coinFlipWinner = Math.random() < 0.5 ? homeTeam : awayTeam;
    let possessionTeam = coinFlipWinner;
    let receivingTeamSecondHalf = (possessionTeam.id === homeTeam.id) ? awayTeam : homeTeam;
    gameLog.push(`🪙 ${coinFlipWinner.name} won the toss and will receive the ball first!`);

    let gameForfeited = false;
    
    while (drivesThisGame < totalDrivesPerHalf * 2 && !gameForfeited) {
        if (drivesThisGame === totalDrivesPerHalf) {
            currentHalf = 2;
            gameLog.push(`==== HALFTIME ==== Score: ${awayTeam.name} ${awayScore} - ${homeTeam.name} ${homeScore}`);
            possessionTeam = receivingTeamSecondHalf;
            [...homeTeam.roster, ...awayTeam.roster].forEach(p => { if (p) p.fatigue = Math.max(0, (p.fatigue || 0) - 40); });
            gameLog.push(`-- Second Half Kickoff: ${possessionTeam.name} receives --`);
        }

        if (!possessionTeam) {
            console.error("Possession team is null! Ending game loop."); break;
        }
        const offense = possessionTeam;
        const defense = (possessionTeam.id === homeTeam.id) ? awayTeam : homeTeam;

        const checkRoster = (team) => (team?.roster || []).filter(p => p && p.status?.duration === 0).length < MIN_HEALTHY_PLAYERS;
        if (checkRoster(offense) || checkRoster(defense)) {
            const forfeitingTeam = checkRoster(offense) ? offense : defense;
            const winningTeam = forfeitingTeam === offense ? defense : offense;
            gameLog.push(`❗ ${forfeitingTeam.name} cannot field enough healthy players (${MIN_HEALTHY_PLAYERS}) and forfeits.`);
            if (winningTeam === homeTeam) { homeScore = 21; awayScore = 0; } else { homeScore = 0; awayScore = 21; }
            gameForfeited = true;
            break;
        }

        let ballOn = 20, down = 1, yardsToGo = 10, driveActive = true;
        gameLog.push(`-- Drive ${drivesThisGame + 1} (H${currentHalf}): ${offense.name} ball on own ${ballOn} --`);

        while (driveActive && down <= 4) {
             if (offense.roster.filter(p => p && p.status?.duration === 0).length < MIN_HEALTHY_PLAYERS ||
                 defense.roster.filter(p => p && p.status?.duration === 0).length < MIN_HEALTHY_PLAYERS) {
                  gameLog.push("Forfeit condition met mid-drive."); gameForfeited = true; driveActive = false; break;
             }

            const yardLineText = ballOn <= 50 ? `own ${ballOn}` : `opponent ${100 - ballOn}`;
            gameLog.push(`--- ${down}${down === 1 ? 'st' : down === 2 ? 'nd' : down === 3 ? 'rd' : 'th'} & ${yardsToGo <= 0 ? 'Goal' : yardsToGo} from the ${yardLineText} ---`);

            const scoreDiff = offense.id === homeTeam.id ? homeScore - awayScore : awayScore - homeScore;
            const drivesCompletedInHalf = drivesThisGame % totalDrivesPerHalf;
            const drivesRemainingInHalf = totalDrivesPerHalf - drivesCompletedInHalf;
            const drivesRemainingInGame = (currentHalf === 1 ? totalDrivesPerHalf : 0) + drivesRemainingInHalf;
            
            const offensivePlayKey = determinePlayCall(offense, defense, down, yardsToGo, ballOn, scoreDiff, gameLog, drivesRemainingInGame);
            const defensivePlayKey = determineDefensivePlayCall(defense, offense, down, yardsToGo, ballOn, gameLog);

            const result = resolvePlay(offense, defense, offensivePlayKey, defensivePlayKey, { gameLog, weather, ballOn });
            if (result.visualizationFrames) {
                allVisualizationFrames.push(...result.visualizationFrames);
            }

            ballOn += result.yards;
            ballOn = Math.max(0, Math.min(100, ballOn));

            if (result.turnover) {
                driveActive = false;
            } else if (result.touchdown) {
                ballOn = 100;
                const goesForTwo = Math.random() > 0.85;
                const conversionSuccess = Math.random() > (goesForTwo ? 0.6 : 0.05);
                if (conversionSuccess) {
                    const points = goesForTwo ? 2 : 1;
                    gameLog.push(`✅ ${points}-point conversion GOOD!`);
                    if (offense.id === homeTeam.id) homeScore += (6 + points); else awayScore += (6 + points);
                } else {
                    gameLog.push(`❌ ${goesForTwo ? '2-point' : 'Extra point'} conversion FAILED!`);
                    if (offense.id === homeTeam.id) homeScore += 6; else awayScore += 6;
                }
                driveActive = false;
            } else if (result.incomplete) {
                down++;
            } else { // Completed play
                yardsToGo -= result.yards;
                if (yardsToGo <= 0) {
                    down = 1;
                    yardsToGo = Math.min(10, 100 - ballOn);
                    const newYardLineText = ballOn <= 50 ? `own ${ballOn}` : `opponent ${100 - ballOn}`;
                    gameLog.push(`➡️ First down ${offense.name}! ${yardsToGo < 10 ? `1st & Goal at the ${100 - ballOn}` : `1st & 10 at the ${newYardLineText}`}.`);
                } else {
                    down++;
                }
            }

            if (down > 4 && driveActive) {
                const finalYardLineText = ballOn <= 50 ? `own ${ballOn}` : `opponent ${100 - ballOn}`;
                gameLog.push(`✋ Turnover on downs! ${defense.name} takes over at the ${finalYardLineText}.`);
                driveActive = false;
            }
        } // --- End Play Loop ---

        drivesThisGame++;
        if (drivesThisGame < totalDrivesPerHalf * 2 && !gameForfeited) {
             possessionTeam = (possessionTeam?.id === homeTeam.id) ? awayTeam : homeTeam;
        }
    } // --- End Game Loop ---

    // --- Post-Game ---
    gameLog.push(`==== FINAL SCORE ==== ${awayTeam.name} ${awayScore} - ${homeTeam.name} ${homeScore}`);

    if (!gameForfeited) {
        if (homeScore > awayScore) { homeTeam.wins = (homeTeam.wins || 0) + 1; awayTeam.losses = (awayTeam.losses || 0) + 1; }
        else if (awayScore > homeScore) { awayTeam.wins = (awayTeam.wins || 0) + 1; homeTeam.losses = (homeTeam.losses || 0) + 1; }
    } else {
       if (homeScore > awayScore) { homeTeam.wins = (homeTeam.wins || 0) + 1; awayTeam.losses = (awayTeam.losses || 0) + 1; }
       else if (awayScore > homeScore) { awayTeam.wins = (awayTeam.wins || 0) + 1; homeTeam.losses = (homeTeam.losses || 0) + 1; }
    }

    // Post-Game Player Progression & Stat Aggregation
    [...(homeTeam.roster || []), ...(awayTeam.roster || [])].forEach(p => {
        if (!p || !p.gameStats || !p.attributes) return;

        const perfThreshold = p.gameStats.touchdowns >= 1 || p.gameStats.passYards > 100 || p.gameStats.recYards > 50 || p.gameStats.rushYards > 50 || p.gameStats.tackles > 4 || p.gameStats.sacks >= 1 || p.gameStats.interceptions >= 1;
        if (p.age < 14 && perfThreshold && Math.random() < 0.15) {
            const attributesToImprove = ['speed', 'strength', 'agility', 'throwingAccuracy', 'catchingHands', 'tackling', 'blocking', 'playbookIQ', 'blockShedding', 'toughness', 'consistency'];
            const attr = getRandom(attributesToImprove);
            for (const cat in p.attributes) {
                if (p.attributes[cat]?.[attr] !== undefined && p.attributes[cat][attr] < 99) {
                    p.attributes[cat][attr]++;
                    p.breakthroughAttr = attr;
                    breakthroughs.push({ player: p, attr, teamName: p.teamId === homeTeam.id ? homeTeam.name : awayTeam.name });
                    break;
                }
            }
        }

        if(!p.seasonStats) p.seasonStats = {};
        if(!p.careerStats) p.careerStats = { seasonsPlayed: p.careerStats?.seasonsPlayed || 0};
        for (const stat in p.gameStats) {
            if (typeof p.gameStats[stat] === 'number') {
                 p.seasonStats[stat] = (p.seasonStats[stat] || 0) + p.gameStats[stat];
                 p.careerStats[stat] = (p.careerStats[stat] || 0) + p.gameStats[stat];
            }
        }
    });

    return { homeTeam, awayTeam, homeScore, awayScore, gameLog, breakthroughs, visualizationFrames: allVisualizationFrames};
}


// =============================================================
// --- WEEKLY/OFFSEASON PROCESSING ---
// =============================================================

/** Decrements duration of player statuses (injuries, busy). */
function updatePlayerStatuses() {
    if (!game || !game.players) return;
    for (const player of game.players) {
        if (!player || !player.status) continue;
        if (player.status.duration > 0) {
            player.status.duration--;
            if (player.status.duration === 0) {
                player.status.type = 'healthy';
                player.status.description = '';
                 if (player.teamId === game.playerTeam?.id) {
                     addMessage('Player Recovered', `${player.name} is now available.`);
                 }
            }
        }
        if (player.breakthroughAttr) delete player.breakthroughAttr;
        if (player.status.isNew) player.status.isNew = false;
    }
}

/** Removes temporary players (friends) at the end of the week. */
function endOfWeekCleanup() {
    if (!game || !game.teams) return;
    game.teams.forEach(team => {
        if (team && team.roster) {
            team.roster = team.roster.filter(p => p && p.status?.type !== 'temporary');
        }
    });
}

/** Generates random weekly non-game events (injuries, unavailability). */
function generateWeeklyEvents() {
    if (!game || !game.players) return;
    for (const player of game.players) {
        if (!player || !player.status || player.status.type !== 'healthy') continue;
        for (const event of weeklyEvents) {
            if (Math.random() < event.chance) {
                player.status.type = event.type;
                player.status.description = event.description;
                player.status.duration = getRandomInt(event.minDuration, event.maxDuration);
                player.status.isNew = true;
                if (player.teamId === game.playerTeam?.id) {
                    addMessage('Player Status Update', `${player.name} will be unavailable for ${player.status.duration} week(s): ${player.status.description}`);
                }
                break;
            }
        }
    }
}

/** Processes random relationship changes between players. */
function processRelationshipEvents() {
    if (!game || !game.players || game.players.length < 2) return;
    const numEvents = getRandomInt(1, 3);
    const eventChanceImprove = 0.6;
    for (let i = 0; i < numEvents; i++) {
        let p1Index = getRandomInt(0, game.players.length - 1);
        let p2Index = getRandomInt(0, game.players.length - 1);
        let attempts = 0;
        while (p1Index === p2Index && attempts < 10) {
             p2Index = getRandomInt(0, game.players.length - 1); attempts++;
        }
        if (p1Index === p2Index) continue;
        const p1 = game.players[p1Index];
        const p2 = game.players[p2Index];
        if (!p1 || !p2) continue;
        if (Math.random() < eventChanceImprove) {
            improveRelationship(p1.id, p2.id);
        } else {
            decreaseRelationship(p1.id, p2.id);
        }
    }
}

/** Simulates all games for the current week and advances state. */
export function simulateWeek() {
    if (!game || !game.teams || !game.schedule) { console.error("simulateWeek: Invalid game state."); return []; }
    const WEEKS_IN_SEASON = 9;
    if (game.currentWeek >= WEEKS_IN_SEASON) { console.warn("simulateWeek: Season already over."); return null; }

    endOfWeekCleanup();
    updatePlayerStatuses();
    generateWeeklyEvents();
    game.breakthroughs = [];

    const gamesPerWeek = game.teams.length / 2;
    const startIndex = game.currentWeek * gamesPerWeek;
    const endIndex = startIndex + gamesPerWeek;
    const weeklyGames = game.schedule.slice(startIndex, endIndex);

    if (!weeklyGames || weeklyGames.length === 0) { console.warn(`No games found for week ${game.currentWeek}`); }

    const results = weeklyGames.map(match => {
        try {
            if (!match?.home || !match?.away) { return null; }
            const result = simulateGame(match.home, match.away);
             if (result?.breakthroughs) {
                 result.breakthroughs.forEach(b => {
                     if (b?.player?.teamId === game.playerTeam?.id) {
                         addMessage("Player Breakthrough!", `${b.player.name} improved ${b.attr}!`);
                     }
                 });
                 if (!game.breakthroughs) game.breakthroughs = [];
                 game.breakthroughs.push(...result.breakthroughs);
             }
            return result;
        } catch (error) {
             console.error(`Error simulating match ${match?.away?.name} @ ${match?.home?.name}:`, error);
             return null;
        }
    }).filter(Boolean);

    if (!game.gameResults) game.gameResults = [];
    game.gameResults.push(...results);
    processRelationshipEvents();

    game.currentWeek++;
    console.log(`Week ${game.currentWeek - 1} simulation complete. Advanced to week ${game.currentWeek}.`);
    return results;
}

// =============================================================
// --- FREE AGENCY & ROSTER MANAGEMENT ---
// =============================================================

/** Generates a list of available free agents for the week. */
export function generateWeeklyFreeAgents() {
    if (!game || !game.players) { console.error("generateWeeklyFreeAgents: Game not initialized."); return; }
    const undraftedPlayers = game.players.filter(p => p && !p.teamId);
    game.freeAgents = [];
    const numFreeAgents = 5;
    for (let i = 0; i < numFreeAgents; i++) {
        if (undraftedPlayers.length > 0) {
            const faIndex = getRandomInt(0, undraftedPlayers.length - 1);
            const fa = undraftedPlayers.splice(faIndex, 1)[0];
            if (fa) game.freeAgents.push(fa);
        } else { break; }
    }
}

/**
 * Handles the player attempting to call a free agent friend.
 */
export function callFriend(playerId) {
    if (!game || !game.playerTeam || !game.playerTeam.roster || !game.freeAgents) {
        console.error("Cannot call friend: Invalid game state.");
        return { success: false, message: "Game state error prevented calling friend." };
    }
    const team = game.playerTeam;
    if (!team.roster.some(p => p && p.status?.duration > 0)) {
        return { success: false, message: "You can only call a friend if a player on your team is currently injured or busy." };
    }
    const player = game.freeAgents.find(p => p && p.id === playerId);
    if (!player) return { success: false, message: "That player is no longer available this week." };

    const maxLevel = team.roster.reduce(
        (max, rosterPlayer) => Math.max(max, getRelationshipLevel(rosterPlayer?.id, playerId)),
        relationshipLevels.STRANGER.level
    );
    const relationshipInfo = Object.values(relationshipLevels).find(rl => rl.level === maxLevel) || relationshipLevels.STRANGER;
    const successChance = relationshipInfo.callChance;
    const relationshipName = relationshipInfo.name;

    game.freeAgents = game.freeAgents.filter(p => p && p.id !== playerId);

    if (Math.random() < successChance) {
        player.status = { type: 'temporary', description: 'Helping Out', duration: 1 };
        if (addPlayerToTeam(player, team)) {
            team.roster.forEach(rosterPlayer => {
                if (rosterPlayer && rosterPlayer.id !== player.id) {
                     improveRelationship(rosterPlayer.id, player.id);
                }
            });
            const message = `${player.name} (${relationshipName}) agreed to help out for the next game!`;
            addMessage("Roster Update: Friend Called", message);
            return { success: true, message };
        } else {
            return { success: false, message: `Failed to add ${player.name} to roster after successful call.` };
        }
    } else {
        const message = `${player.name} (${relationshipName}) couldn't make it this week.`;
        addMessage("Roster Update: Friend Called", message);
        return { success: false, message };
    }
}


/**
 * AI logic for signing temporary free agents if roster is short.
 */
export function aiManageRoster(team) {
    if (!team || !team.roster || !game || !game.freeAgents || !team.coach) return;
    let healthyCount = team.roster.filter(p => p && p.status?.duration === 0).length;

    while (healthyCount < MIN_HEALTHY_PLAYERS && game.freeAgents.length > 0) {
        const bestFA = game.freeAgents
          .filter(p => p)
          .reduce((best, current) => {
               if (!best) return current;
               return getPlayerScore(current, team.coach) > getPlayerScore(best, team.coach) ? current : best;
          }, null);
        if (!bestFA) break;

        const aiSuccessChance = 0.5;
        game.freeAgents = game.freeAgents.filter(p => p && p.id !== bestFA.id);

        if (Math.random() < aiSuccessChance) {
            bestFA.status = { type: 'temporary', description: 'Helping Out', duration: 1 };
            if (addPlayerToTeam(bestFA, team)) {
                 healthyCount++;
                 console.log(`${team.name} signed temporary player ${bestFA.name}`);
            }
        } else {
             console.log(`${team.name} failed to sign temporary player ${bestFA.name}.`);
        }
    }
     aiSetDepthChart(team);
}


// =============================================================
// --- PLAYER DEVELOPMENT & OFFSEASON ---
// =============================================================

/** Applies attribute improvements based on age and potential. */
function developPlayer(player) {
    if (!player || !player.attributes) return { player, improvements: [] };
    const developmentReport = { player, improvements: [] };
    const potentialMultipliers = {'A': 1.6, 'B': 1.3, 'C': 1.0, 'D': 0.7, 'F': 0.4};
    const potentialMultiplier = potentialMultipliers[player.potential] || 1.0;

    let basePoints = 0;
    if (player.age <= 12) basePoints = getRandomInt(3, 5);
    else if (player.age <= 14) basePoints = getRandomInt(2, 4);
    else if (player.age <= 16) basePoints = getRandomInt(1, 2);
    else basePoints = getRandomInt(0, 1);

    let potentialPoints = Math.max(0, Math.round(basePoints * potentialMultiplier));
    const attributesToImprove = ['speed', 'strength', 'agility', 'throwingAccuracy', 'catchingHands', 'tackling', 'blocking', 'playbookIQ', 'blockShedding', 'toughness', 'consistency'];

    for (let i = 0; i < potentialPoints; i++) {
        const attrToBoost = getRandom(attributesToImprove);
        for (const category in player.attributes) {
            if (player.attributes[category]?.[attrToBoost] !== undefined && player.attributes[category][attrToBoost] < 99) {
                const increase = 1;
                if (increase > 0) {
                     player.attributes[category][attrToBoost] = Math.min(99, player.attributes[category][attrToBoost] + increase);
                    const existing = developmentReport.improvements.find(imp => imp.attr === attrToBoost);
                    if (existing) existing.increase += increase;
                    else developmentReport.improvements.push({ attr: attrToBoost, increase });
                    break;
                }
            }
        }
    }

    const heightGain = player.age <= 12 ? getRandomInt(1, 3) : player.age <= 14 ? getRandomInt(0, 2) : getRandomInt(0, 1);
    const weightGain = player.age <= 12 ? getRandomInt(6, 16) : player.age <= 14 ? getRandomInt(4, 12) : getRandomInt(2, 8);
    if (heightGain > 0) developmentReport.improvements.push({ attr: 'height', increase: heightGain });
    if (weightGain > 0) developmentReport.improvements.push({ attr: 'weight', increase: weightGain });
    if (!player.attributes.physical) player.attributes.physical = {};
    player.attributes.physical.height = (player.attributes.physical.height || 50) + heightGain;
    player.attributes.physical.weight = (player.attributes.physical.weight || 100) + weightGain;

    return developmentReport;
}

/** Handles offseason logic: aging, development, departures, teammates, rookies. */
export function advanceToOffseason() {
    if (!game || !game.teams || !game.players) { return { retiredPlayers: [], hofInductees: [], developmentResults: [], leavingPlayers: [] }; }
    game.year++;
    console.log(`Advancing to Offseason for Year ${game.year}`);
    const retiredPlayers = []; const hofInductees = []; const developmentResults = []; const leavingPlayers = [];
    let totalVacancies = 0;
    const ROSTER_LIMIT = 10;

    console.log("Processing teammate relationship improvements...");
    const teammateImproveChance = 0.15;
    game.teams.forEach(team => {
        if (!team || !team.roster || team.roster.length < 2) return;
        for (let i = 0; i < team.roster.length; i++) {
            for (let j = i + 1; j < team.roster.length; j++) {
                const p1 = team.roster[i]; const p2 = team.roster[j];
                if (!p1 || !p2) continue;
                if (Math.random() < teammateImproveChance) improveRelationship(p1.id, p2.id);
            }
        }
    });

    game.teams.forEach(team => {
        if (!team || !team.roster) return;
        const currentRoster = [...team.roster.filter(p => p)];
        team.roster = [];

        currentRoster.forEach(player => {
            if (!player.careerStats || !player.attributes) return;

            player.age++;
            player.careerStats.seasonsPlayed = (player.careerStats.seasonsPlayed || 0) + 1;

            const devReport = developPlayer(player);
            if (team.id === game.playerTeam?.id) developmentResults.push(devReport);

            let playerIsLeaving = false;
            if (player.age >= 17) {
                 retiredPlayers.push(player); playerIsLeaving = true;
                 if (team.id === game.playerTeam?.id) addMessage("Player Retires", `${player.name} is moving on from the league.`);
                 if ((player.careerStats.touchdowns || 0) > 25 /* ... other HOF criteria ... */ ) {
                     if(!game.hallOfFame) game.hallOfFame = [];
                     game.hallOfFame.push(player); hofInductees.push(player);
                     if (team.id === game.playerTeam?.id) addMessage("Hall of Fame!", `${player.name} inducted!`);
                 }
            } else {
                for (const event of offseasonDepartureEvents) {
                    if (Math.random() < event.chance) {
                        leavingPlayers.push({ player, reason: event.reason, teamName: team.name });
                        playerIsLeaving = true;
                        if (team.id === game.playerTeam?.id) addMessage("Player Leaving", `${player.name}: ${event.reason}.`);
                        break;
                    }
                }
                if (!playerIsLeaving && team.id === game.playerTeam?.id && Math.random() < transferEventChance) {
                    leavingPlayers.push({ player, reason: 'Asked to leave', teamName: team.name });
                    playerIsLeaving = true;
                    addMessage("Transfer Request", `${player.name} asked to leave and has departed.`);
                }
            }

            if (!playerIsLeaving) {
                player.seasonStats = { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0, sacks: 0, interceptions: 0, passAttempts: 0, passCompletions: 0, interceptionsThrown: 0 };
                if (!player.status) player.status = {};
                player.status = { type: 'healthy', description: '', duration: 0 };
                team.roster.push(player);
            } else {
                player.teamId = null;
                totalVacancies++;
            }
        });

        if (team.depthChart && team.formations) {
             const offSlots = offenseFormations[team.formations.offense]?.slots || [];
             team.depthChart.offense = Object.fromEntries(offSlots.map(slot => [slot, null]));
             const defSlots = defenseFormations[team.formations.defense]?.slots || [];
             team.depthChart.defense = Object.fromEntries(defSlots.map(slot => [slot, null]));
        }
        team.wins = 0; team.losses = 0;
         aiSetDepthChart(team);
    });

    const undraftedYoungPlayers = game.players.filter(p => p && !p.teamId && p.age < 17);
    if (game.playerTeam && game.playerTeam.roster && game.playerTeam.roster.length < ROSTER_LIMIT && Math.random() < joinRequestChance && undraftedYoungPlayers.length > 0) {
        const joiningPlayer = getRandom(undraftedYoungPlayers);
        if (joiningPlayer) {
            if (addPlayerToTeam(joiningPlayer, game.playerTeam)) {
                 totalVacancies = Math.max(0, totalVacancies - 1);
                 addMessage("New Player Joined!", `${joiningPlayer.name} heard about your team and asked to join!`);
                 aiSetDepthChart(game.playerTeam);
            }
        }
    }

    addMessage("Offseason Summary", `Offseason complete. ${totalVacancies} roster spots opened. Preparing for the draft.`);

    const rookieCount = Math.max(totalVacancies, game.teams.length);
    console.log(`Generating ${rookieCount} new rookie players (age 10-12).`);
    for (let i = 0; i < rookieCount; i++) game.players.push(generatePlayer(10, 12));

    game.gameResults = [];
    game.breakthroughs = [];

    return { retiredPlayers, hofInductees, developmentResults, leavingPlayers };
}


// =============================================================
// --- DEPTH CHART & PLAYER MANAGEMENT ---
// =============================================================

/** Updates the player's depth chart based on drag-and-drop. */
export function updateDepthChart(playerId, newPositionSlot, side) {
    const team = game?.playerTeam;
    if (!team || !team.depthChart || !team.depthChart[side]) { console.error("updateDepthChart: Invalid state."); return; }
    const chart = team.depthChart[side];
    const player = team.roster.find(p=>p && p.id === playerId);
    if (player && player.status?.type === 'temporary') {
         console.warn("Cannot move temporary players in depth chart.");
         return;
    }
    const oldSlot = Object.keys(chart).find(key => chart[key] === playerId);
    const displacedPlayerId = chart[newPositionSlot];
    chart[newPositionSlot] = playerId;
    if (oldSlot) {
        chart[oldSlot] = displacedPlayerId || null;
    } else if (displacedPlayerId) {
        console.log(`Player ${displacedPlayerId} moved to bench from ${newPositionSlot}`);
    }
}

/** Changes the player team's formation for offense or defense. */
export function changeFormation(side, formationName) {
    const team = game?.playerTeam;
    const formations = side === 'offense' ? offenseFormations : defenseFormations;
    const formation = formations[formationName];
    if (!formation || !team || !team.formations || !team.depthChart) { console.error("changeFormation: Invalid state."); return; }

    team.formations[side] = formationName;
    const newChart = Object.fromEntries((formation.slots || []).map(slot => [slot, null]));
    team.depthChart[side] = newChart;
    aiSetDepthChart(team);
    console.log(`${side} formation changed to ${formationName}, depth chart reset and refilled.`);
}

/** Cuts a player from the player's team roster. */
export function playerCut(playerId) {
    if (!game || !game.playerTeam || !game.playerTeam.roster) { return { success: false, message: "Game state error." }; }
    const team = game.playerTeam;
    const playerIndex = team.roster.findIndex(p => p && p.id === playerId);

    if (playerIndex > -1) {
        const player = team.roster[playerIndex];
        if (player.status?.type === 'temporary') { return { success: false, message: "Cannot cut temporary friends." }; }

        team.roster.splice(playerIndex, 1);
        player.teamId = null;
        player.number = null; // Free up the number

        for (const side in team.depthChart) {
             if (team.depthChart[side]) {
                  for (const slot in team.depthChart[side]) {
                      if (team.depthChart[side][slot] === playerId) { team.depthChart[side][slot] = null; }
                  }
             }
        }
        aiSetDepthChart(team);
        addMessage("Roster Move", `${player.name} has been cut from the team.`);
        team.roster.forEach(rp => { if (rp) decreaseRelationship(rp.id, player.id); });
        return { success: true };
    } else { return { success: false, message: "Player not found on roster." }; }
}

/** Signs an available free agent player to the player's team roster. */
export function playerSignFreeAgent(playerId) {
    if (!game || !game.playerTeam || !game.playerTeam.roster || !game.players) {
        return { success: false, message: "Game state error." };
    }
    const team = game.playerTeam;
    const ROSTER_LIMIT = 10;
    if (team.roster.length >= ROSTER_LIMIT) {
        return { success: false, message: `Roster is full (${ROSTER_LIMIT} players max).` };
    }

    // Find player in main list, ensure they are FA
    const player = game.players.find(p => p && p.id === playerId && !p.teamId);

    if (player) {
        player.status = { type: 'healthy', description: '', duration: 0 }; // Ensure healthy status
        
        if (addPlayerToTeam(player, team)) { // This function now handles number assignment
            aiSetDepthChart(team);
            addMessage("Roster Move", `${player.name} has been signed to the team!`);
            // Optionally improve relationship between new player and roster?
            team.roster.forEach(rp => { if (rp && rp.id !== player.id) improveRelationship(rp.id, player.id); });
            return { success: true };
        } else {
            return { success: false, message: "Failed to add player to roster." };
        }
    } else {
        // Check if player exists but isn't FA
        const existingPlayer = game.players.find(p => p && p.id === playerId);
        if (existingPlayer && existingPlayer.teamId) {
            return { success: false, message: "Player is already on another team." };
        } else {
            return { success: false, message: "Player not found or not available." };
        }
    }
}


// =============================================================
// --- GETTERS & EXPORTS ---
// =============================================================

/** Returns the current game state object. */
export function getGameState() { return game; }

/** Returns the breakthroughs from the most recent week/game. */
export function getBreakthroughs() { return game?.breakthroughs || []; } // Safe access

/** Marks a specific message as read. */
export function markMessageAsRead(messageId) {
    const message = game?.messages?.find(m => m && m.id === messageId); // Safe access
    if (message) { message.isRead = true; }
}

// --- Exports for Scouting/Relationships ---
export { getScoutedPlayerInfo, getRelationshipLevel }; // Export helpers needed by UI/Main
