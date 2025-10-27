// game.js - PART 1/5

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
const TICK_DURATION_SECONDS = 0.15; // How much time passes per simulation tick (~6-7 ticks/sec)
const BLOCK_ENGAGE_RANGE = 1.0;    // Yards distance to initiate a block
const TACKLE_RANGE = 1.5;         // Yards distance to initiate a tackle attempt
const CATCH_RADIUS = 0.8;         // Yards around player for catch check
const SEPARATION_THRESHOLD = 2.0; // Yards needed for a receiver to be considered 'open'

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
const FUMBLE_CHANCE_BASE = 0.03; // Base chance before modifiers

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
 * @param {object} player - The player object.
 * @param {string} position - The position abbreviation (e.g., 'QB').
 * @returns {number} The calculated overall rating (1-99).
 */
export function calculateOverall(player, position) {
    if (!player || !player.attributes) return 0; // Safety check
    const attrs = player.attributes;
    const relevantWeights = positionOverallWeights[position];
    if (!relevantWeights) return 0;

    let score = 0;
    for (const category in attrs) {
        for (const attr in attrs[category]) {
            if (relevantWeights[attr]) {
                let value = attrs[category][attr];
                // Basic normalization for height/weight
                if (attr === 'weight') value = (value || 100) / 2.5; // Add default if missing
                if (attr === 'height') value = ((value || 60) - 60); // Add default if missing
                if (typeof value === 'number') { // Ensure value is a number before adding
                     score += value * relevantWeights[attr];
                }
            }
        }
    }
    // Clamp score between 1 and 99
    return Math.min(99, Math.max(1, Math.round(score)));
}

/**
 * Calculates a player's suitability for a specific formation slot.
 * @param {object} player - The player object.
 * @param {string} slot - The slot name (e.g., 'WR1').
 * @param {string} side - 'offense' or 'defense'.
 * @param {object} team - The team object containing formations.
 * @returns {number} The calculated suitability score (1-99).
 */
function calculateSlotSuitability(player, slot, side, team) {
    if (!player || !player.attributes || !team || !team.formations || !team.formations[side]) return 0; // Safety checks
    const formationName = team.formations[side];
    const formationData = side === 'offense' ? offenseFormations[formationName] : defenseFormations[formationName];
    const basePosition = slot.replace(/\d/g, '');

    // Fallback to general overall if slot-specific priorities aren't defined or formation invalid
    if (!formationData?.slotPriorities?.[slot]) {
        return calculateOverall(player, basePosition);
    }

    const priorities = formationData.slotPriorities[slot];
    let score = 0;
    let totalWeight = 0;

    // Calculate score based on weighted priorities
    for (const attr in priorities) {
        let found = false;
        for (const category in player.attributes) {
            if (player.attributes[category]?.[attr] !== undefined) { // Safe access
                let value = player.attributes[category][attr];
                if (typeof value !== 'number') continue; // Skip non-numeric values (like scouted ranges)
                // Basic normalization
                if (attr === 'weight') value = value / 2.5;
                if (attr === 'height') value = (value - 60);
                score += value * priorities[attr];
                totalWeight += priorities[attr];
                found = true;
                break;
            }
        }
    }

    // Weighted average: 70% slot suitability, 30% general overall
    const baseOverall = calculateOverall(player, basePosition);
    const finalScore = (totalWeight > 0 ? (score / totalWeight) : baseOverall) * 0.7 + (baseOverall * 0.3);

    return Math.min(99, Math.max(1, Math.round(finalScore)));
}

/**
 * Generates a new player object with randomized attributes, age (10-16), and potential.
 * @param {number} [minAge=10] - Minimum age.
 * @param {number} [maxAge=16] - Maximum age.
 * @returns {object} The generated player object.
 */
function generatePlayer(minAge = 10, maxAge = 16) {
    const firstName = getRandom(firstNames);
    const lastName = Math.random() < 0.4 ? getRandom(nicknames) : getRandom(lastNames);
    const age = getRandomInt(minAge, maxAge);
    const favoriteOffensivePosition = getRandom(offensivePositions);
    const favoriteDefensivePosition = getRandom(defensivePositions);

    // Baseline physicals (10-16 range)
    const ageProgress = (age - 10) / (16 - 10);
    let baseHeight = 55 + (ageProgress * 15) + getRandomInt(-2, 2);
    let baseWeight = 70 + (ageProgress * 90) + getRandomInt(-10, 10);
    const bestPosition = getRandom(positions);

    // Positional height/weight adjustments
    switch (bestPosition) {
        case 'QB': case 'WR': baseHeight += getRandomInt(1, 4); baseWeight -= getRandomInt(0, 10); break;
        case 'OL': case 'DL': baseHeight -= getRandomInt(0, 2); baseWeight += getRandomInt(20, 40); break;
        case 'RB': baseWeight += getRandomInt(5, 15); break;
    }

    // Initial attributes scaled by age
    const ageScalingFactor = 0.85 + ageProgress * 0.15; // Scale from 0.85 (age 10) to 1.0 (age 16)
    let attributes = {
        physical: {
            speed: Math.round(getRandomInt(40, 70) * ageScalingFactor),
            strength: Math.round(getRandomInt(40, 70) * ageScalingFactor),
            agility: Math.round(getRandomInt(40, 70) * ageScalingFactor),
            stamina: Math.round(getRandomInt(50, 80) * ageScalingFactor),
            height: Math.round(baseHeight), weight: Math.round(baseWeight)
        },
        mental: { // --- Scaled mental attributes ---
            playbookIQ: Math.round(getRandomInt(30, 70) * ageScalingFactor),
            clutch: getRandomInt(20, 90), // Clutch might be less age-dependent initially
            consistency: Math.round(getRandomInt(40, 80) * ageScalingFactor),
            toughness: Math.round(getRandomInt(50, 95) * ageScalingFactor)
        },
        technical: { // --- Scaled technical attributes ---
            throwingAccuracy: Math.round(getRandomInt(20, 50) * ageScalingFactor),
            catchingHands: Math.round(getRandomInt(30, 60) * ageScalingFactor),
            tackling: Math.round(getRandomInt(30, 60) * ageScalingFactor),
            blocking: Math.round(getRandomInt(30, 60) * ageScalingFactor),
            blockShedding: Math.round(getRandomInt(30, 60) * ageScalingFactor)
        }
    };

    // --- Weight modifier (influences strength, speed, agility) ---
    const weightModifier = (attributes.physical.weight - 125) / 50; // Normalize around 125 lbs
    attributes.physical.strength = Math.round(attributes.physical.strength + weightModifier * 10);
    attributes.physical.speed = Math.round(attributes.physical.speed - weightModifier * 8);
    attributes.physical.agility = Math.round(attributes.physical.agility - weightModifier * 5);
    // --- End Weight modifier ---

    // --- Best position boost (apply after scaling and weight mod) ---
    switch (bestPosition) {
        case 'QB':
            attributes.technical.throwingAccuracy = Math.round(attributes.technical.throwingAccuracy * 0.5 + getRandomInt(65, 95) * 0.5); // Blend base with boosted value
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
            attributes.technical.catchingHands = Math.round(attributes.technical.catchingHands * 0.5 + getRandomInt(50, 80) * 0.5); // Lower boost for DB hands
            break;
    }
    // --- End Best position boost ---

    // Clamp attributes (1-99) after all calculations
    Object.keys(attributes).forEach(cat => {
        if (!attributes[cat]) attributes[cat] = {}; // Ensure category exists
        Object.keys(attributes[cat]).forEach(attr => {
            if (typeof attributes[cat][attr] === 'number' && !['height', 'weight'].includes(attr)) {
                attributes[cat][attr] = Math.max(1, Math.min(99, Math.round(attributes[cat][attr])));
            }
        });
    });

    // --- Assign Potential based on Age ---
    let potential = 'F'; // Default
    const potentialRoll = Math.random();
    if (age <= 11) { // 10-11: Highest chance for A/B
        if (potentialRoll < 0.20) potential = 'A';      // 20% A
        else if (potentialRoll < 0.55) potential = 'B'; // 35% B (20+35=55)
        else if (potentialRoll < 0.85) potential = 'C'; // 30% C (55+30=85)
        else potential = 'D';                           // 15% D (85+15=100)
    } else if (age <= 13) { // 12-13: Good chance
        if (potentialRoll < 0.10) potential = 'A';      // 10% A
        else if (potentialRoll < 0.40) potential = 'B'; // 30% B (10+30=40)
        else if (potentialRoll < 0.75) potential = 'C'; // 35% C (40+35=75)
        else if (potentialRoll < 0.95) potential = 'D'; // 20% D (75+20=95)
        else potential = 'F';                           // 5% F (95+5=100)
    } else { // 14-16: Lower chance for A/B
        if (potentialRoll < 0.05) potential = 'A';      // 5% A
        else if (potentialRoll < 0.25) potential = 'B'; // 20% B (5+20=25)
        else if (potentialRoll < 0.60) potential = 'C'; // 35% C (25+35=60)
        else if (potentialRoll < 0.90) potential = 'D'; // 30% D (60+30=90)
        else potential = 'F';                           // 10% F (90+10=100)
    }
    // --- End Potential ---

    // --- Initial Stats Object ---
    const initialStats = {
        receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0,
        tackles: 0, sacks: 0, interceptions: 0,
        passAttempts: 0, passCompletions: 0, interceptionsThrown: 0 // Added QB stats
    };
    // --- End Initial Stats ---

    // --- Return Player Object ---
    return {
        id: crypto.randomUUID(),
        name: `${firstName} ${lastName}`,
        age,
        favoriteOffensivePosition,
        favoriteDefensivePosition,
        potential, // Added potential attribute
        attributes,
        teamId: null, // Initially undrafted
        status: { type: 'healthy', description: '', duration: 0 }, // Player status
        fatigue: 0, // In-game fatigue
        gameStats: { ...initialStats }, // Current game stats
        seasonStats: { ...initialStats }, // Current season stats
        careerStats: { ...initialStats, seasonsPlayed: 0 } // Career stats
    };
    // --- End Return ---
}


/** Yields control to the main thread briefly. */
export function yieldToMain() { return new Promise(resolve => setTimeout(resolve, 0)); }

/** Adds a message to the player's inbox. */
function addMessage(subject, body, isRead = false) {
    if (!game || !game.messages) {
        console.error("Cannot add message: Game object or messages array not initialized.");
        return; // Safety check
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
 * @param {object} player - The full player object.
 * @param {number} relationshipLevelNum - The numerical relationship level (0-4).
 * @returns {object} A player-like object with potentially modified attributes/potential.
 */
function getScoutedPlayerInfo(player, relationshipLevelNum) {
    if (!player) return null; // Handle null player

    // Find relationship level details, default to Stranger
    const levelInfo = Object.values(relationshipLevels).find(rl => rl.level === relationshipLevelNum) || relationshipLevels.STRANGER;
    const accuracy = levelInfo.scoutAccuracy; // Accuracy multiplier (0.2 to 1.0)

    // Deep clone the player object to avoid modifying the original
    const scoutedPlayer = JSON.parse(JSON.stringify(player));
    scoutedPlayer.relationshipName = levelInfo.name; // Add relationship name for UI
    scoutedPlayer.relationshipColor = levelInfo.color; // Add color class for UI

    // --- Obscure Potential based on accuracy ---
    if (accuracy < 1.0 && player.potential) { // Check if potential exists
        const potentialGrades = ['A', 'B', 'C', 'D', 'F'];
        const actualIndex = potentialGrades.indexOf(player.potential);

        if (actualIndex !== -1) {
            // Determine range based on accuracy (e.g., 0.2 accuracy -> range ~2 grades)
            const range = Math.floor((1.0 - accuracy) * (potentialGrades.length / 2)); // Max uncertainty range
            const minIndex = Math.max(0, actualIndex - range); // Clamp min index to 0
            const maxIndex = Math.min(potentialGrades.length - 1, actualIndex + range); // Clamp max index

            if (minIndex !== maxIndex) {
                // Show potential as a range if uncertainty exists
                scoutedPlayer.potential = `${potentialGrades[minIndex]}-${potentialGrades[maxIndex]}`;
            } // If minIndex === maxIndex, accuracy is high enough, potential remains unchanged.
        } else {
             scoutedPlayer.potential = '?'; // Mark as unknown if original potential was invalid
        }
    } // If accuracy is 1.0, potential is shown accurately (remains unchanged).

    // --- Obscure Attributes based on accuracy ---
    // Only apply if accuracy is not perfect and attributes exist
    if (accuracy < 0.95 && scoutedPlayer.attributes) {
        // Calculate max +/- range for attributes based on inaccuracy (e.g., Stranger (0.2 acc) -> +/- 12)
        const range = Math.round(15 * (1.0 - accuracy));

        // Iterate through all attribute categories and attributes
        for (const category in scoutedPlayer.attributes) {
            if (!scoutedPlayer.attributes[category]) continue; // Skip if category is missing

            for (const attr in scoutedPlayer.attributes[category]) {
                // Don't obscure height and weight
                if (['height', 'weight'].includes(attr)) continue;

                // Get the actual value from the *original* player object for calculation
                const actualValue = player.attributes[category]?.[attr];

                if (typeof actualValue === 'number') { // Ensure the original value is numeric
                    // Calculate lower and upper bounds, clamping between 1 and 99
                    const lowBound = Math.max(1, actualValue - range);
                    const highBound = Math.min(99, actualValue + range);

                    // Show attribute as a range string (e.g., "65-80") if the range is significant
                    if (highBound - lowBound > 1) {
                        scoutedPlayer.attributes[category][attr] = `${lowBound}-${highBound}`;
                    } else {
                        // If range is 0 or 1, accuracy is high enough to show the exact value
                        scoutedPlayer.attributes[category][attr] = actualValue;
                    }
                } else {
                     // If the original attribute wasn't a number, represent as unknown in scouted view
                     scoutedPlayer.attributes[category][attr] = "?";
                }
            }
        }
    } // If accuracy >= 0.95, attributes remain unchanged (shown accurately).

    return scoutedPlayer; // Return the modified clone
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
         // console.warn("updatePlayerPosition: Invalid playerState received for ID:", playerState?.id);
         return; // Skip if state is invalid
     }
    if (playerState.x === playerState.targetX && playerState.y === playerState.targetY) {
        return; // Already at target
    }

    const dx = playerState.targetX - playerState.x;
    const dy = playerState.targetY - playerState.y;
    const distanceToTarget = Math.sqrt(dx * dx + dy * dy);

    // Scaled speed calculation
    const baseSpeedYPS = 3.0; // Yards per second for 50 speed
    const scaleFactor = (8.0 - baseSpeedYPS) / (99 - 50); // Speed increase per point above 50
    const playerSpeedYPS = baseSpeedYPS + Math.max(0, (playerState.speed || 50) - 50) * scaleFactor;
    const maxMoveDistance = playerSpeedYPS * (playerState.fatigueModifier || 1.0) * timeDelta;

    if (distanceToTarget <= maxMoveDistance || distanceToTarget < 0.1) { // Added small tolerance
        // Can reach target this tick or very close
        playerState.x = playerState.targetX;
        playerState.y = playerState.targetY;
    } else {
        // Move towards target
        const moveRatio = maxMoveDistance / distanceToTarget;
        playerState.x += dx * moveRatio;
        playerState.y += dy * moveRatio;
        // Boundary checks
        playerState.x = Math.max(0.1, Math.min(FIELD_WIDTH - 0.1, playerState.x));
        playerState.y = Math.max(0.1, Math.min(FIELD_LENGTH - 0.1, playerState.y));
    }
}
// --- End Coordinate/Physics Helpers ---


// --- Fumble Check Helper ---
/** Checks for a fumble during a tackle attempt. */
function checkFumble(ballCarrier, tackler, playState, gameLog) {
    if (!ballCarrier || !tackler || !ballCarrier.attributes || !tackler.attributes) return false;
    const carrierModifier = (ballCarrier.attributes.mental?.toughness || 50) / 100; // Scale 0.5 to 1.0
    const tacklerModifier = ((tackler.attributes.physical?.strength || 50) + (tackler.attributes.technical?.tackling || 50)) / 100; // Scale ~1.0 to 2.0
    const fumbleChance = FUMBLE_CHANCE_BASE * (tacklerModifier / (carrierModifier + 0.5)); // Ensure carrierModifier isn't too low

    if (Math.random() < fumbleChance) {
        gameLog.push(`❗ FUMBLE! Ball knocked loose by ${tackler.name}! Recovered by Defense!`); // Assume def recovery
        playState.turnover = true;
        playState.playIsLive = false;
        // TODO: Could track forced/recovered fumble stats
        return true;
    }
    return false;
}
// --- End Fumble Check Helper ---
// game.js - PART 2/5

// ... (Imports, Constants, Core Helpers from Part 1) ...

// =============================================================
// --- GAME STATE & TEAM MANAGEMENT ---
// =============================================================

/**
 * Initializes the league state (teams, players, relationships).
 * @param {function} onProgress - Callback function to update loading progress UI.
 */
export async function initializeLeague(onProgress) {
    console.log("Initializing league...");
    // Initialize game state object with global relationships map
    game = {
        year: 1,
        teams: [],
        players: [],
        freeAgents: [],
        playerTeam: null,
        schedule: [],
        currentWeek: 0,
        divisions: {},
        draftOrder: [],
        currentPick: 0,
        hallOfFame: [],
        gameResults: [],
        messages: [],
        relationships: new Map() // Global relationship map
    };
    addMessage("Welcome!", "Generating the league and players...");

    // Setup divisions
    game.divisions[divisionNames[0]] = [];
    game.divisions[divisionNames[1]] = [];

    // --- Generate initial player pool ---
    const totalPlayers = 300; // Adjust as needed
    console.log(`Generating ${totalPlayers} players...`);
    for (let i = 0; i < totalPlayers; i++) {
        game.players.push(generatePlayer()); // Uses updated generatePlayer with potential
        // Report progress and yield occasionally
        if (i % 10 === 0 && onProgress) {
            onProgress((i / totalPlayers) * 0.7); // Player gen up to 70%
            await yieldToMain();
        }
    }
    console.log("Player generation complete.");
    onProgress(0.7); await yieldToMain();

    // --- Generate initial relationships between all players ---
    console.log("Assigning initial relationships...");
    const totalPairs = (game.players.length * (game.players.length - 1)) / 2;
    let pairsProcessed = 0;
    for (let i = 0; i < game.players.length; i++) {
        for (let j = i + 1; j < game.players.length; j++) {
            const p1 = game.players[i];
            const p2 = game.players[j];
            if (!p1 || !p2) continue; // Safety check

            // Weighted random level (biased towards lower levels)
            let level = relationshipLevels.STRANGER.level; // Default
            const roll = Math.random();
            if (roll < 0.01) level = relationshipLevels.BEST_FRIEND.level;  // ~1%
            else if (roll < 0.05) level = relationshipLevels.GOOD_FRIEND.level; // ~4%
            else if (roll < 0.15) level = relationshipLevels.FRIEND.level;       // ~10%
            else if (roll < 0.40) level = relationshipLevels.ACQUAINTANCE.level; // ~25%
            // else level remains Stranger (~60%)

            // Store relationship using sorted IDs as key
            const key = [p1.id, p2.id].sort().join('_');
            game.relationships.set(key, level);
            pairsProcessed++;
        }
        // Report progress and yield occasionally during relationship gen
        if (i % 20 === 0 && onProgress) { // Update less frequently than player gen
             onProgress(0.7 + (pairsProcessed / totalPairs) * 0.2); // Relationships up to 90%
             await yieldToMain();
        }
    }
    console.log(`Assigned ${game.relationships.size} initial relationships.`);
    onProgress(0.9); await yieldToMain();

    // --- Generate AI teams ---
    console.log("Generating AI teams...");
    const availableTeamNames = [...teamNames];
    const numAiTeams = 19; // Target number of AI teams
    for (let i = 0; i < numAiTeams; i++) {
        // Select random unique name
        const nameIndex = getRandomInt(0, availableTeamNames.length - 1);
        const teamName = `The ${availableTeamNames.splice(nameIndex, 1)[0]}`;
        const division = divisionNames[i % divisionNames.length]; // Alternate divisions
        const coach = getRandom(coachPersonalities);

        // Get slots based on coach's preferred formations, with fallbacks
        const offenseFormationData = offenseFormations[coach.preferredOffense] || offenseFormations['Balanced'];
        const defenseFormationData = defenseFormations[coach.preferredDefense] || defenseFormations['3-3-1'];
        const offenseSlots = offenseFormationData.slots;
        const defenseSlots = defenseFormationData.slots;

        const team = {
            id: crypto.randomUUID(), name: teamName, roster: [], coach, division, wins: 0, losses: 0,
            formations: { // Store the names
                offense: offenseFormationData.name,
                defense: defenseFormationData.name
            },
            depthChart: { // Initialize based on actual slots
                offense: Object.fromEntries(offenseSlots.map(slot => [slot, null])),
                defense: Object.fromEntries(defenseSlots.map(slot => [slot, null]))
            },
            draftNeeds: 0 // Will be set before first draft
        };
        game.teams.push(team);
        game.divisions[division].push(team.id);

        if (onProgress) onProgress(0.9 + ((i + 1) / numAiTeams) * 0.1); // Teams up to 100%
        if (i % 4 === 0) await yieldToMain(); // Yield occasionally
    }
    console.log("AI team generation complete.");
    onProgress(1.0); // Final progress update
    addMessage("Ready!", "League generated. Time to create your team.");
}

/**
 * Creates the player-controlled team and adds it to the game state.
 * @param {string} teamName - The name chosen by the player.
 */
export function createPlayerTeam(teamName) {
    if (!game || !game.teams || !game.divisions) {
        console.error("Cannot create player team: Game not initialized properly.");
        return; // Safety check
    }
    const finalTeamName = teamName.toLowerCase().startsWith("the ") ? teamName : `The ${teamName}`;
    // Assign to the division with fewer teams, or alternate
    const div0Count = game.divisions[divisionNames[0]]?.length || 0;
    const div1Count = game.divisions[divisionNames[1]]?.length || 0;
    const division = div0Count <= div1Count ? divisionNames[0] : divisionNames[1];

    // Default formations for the player
    const defaultOffense = 'Balanced';
    const defaultDefense = '3-3-1';
    const defaultOffenseSlots = offenseFormations[defaultOffense].slots;
    const defaultDefenseSlots = defenseFormations[defaultDefense].slots;

    const playerTeam = {
        id: crypto.randomUUID(),
        name: finalTeamName,
        roster: [],
        coach: getRandom(coachPersonalities), // Assign random coach for now
        division,
        wins: 0, losses: 0,
        formations: { offense: defaultOffense, defense: defaultDefense },
        depthChart: {
            offense: Object.fromEntries(defaultOffenseSlots.map(slot => [slot, null])),
            defense: Object.fromEntries(defaultDefenseSlots.map(slot => [slot, null]))
        },
        draftNeeds: 0
        // No team-specific 'relationships' object needed anymore
    };
    game.teams.push(playerTeam);
    game.divisions[division].push(playerTeam.id);
    game.playerTeam = playerTeam; // Set reference to player's team
    addMessage("Team Created!", `Welcome to the league, ${finalTeamName}! It's time to build your team in the draft.`);
}

// =============================================================
// --- DRAFT LOGIC ---
// =============================================================

/**
 * Calculates a player's score based on a coach's preferences.
 * @param {object} player - The player object.
 * @param {object} coach - The coach object with attributePreferences.
 * @returns {number} The calculated score.
 */
function getPlayerScore(player, coach) {
    if (!player || !player.attributes || !coach || !coach.attributePreferences) return 0; // Safety checks
    let score = 0;
    // Sum weighted attribute scores
    for (const category in player.attributes) {
        for (const attr in player.attributes[category]) {
            score += (player.attributes[category][attr] || 0) * (coach.attributePreferences[category]?.[attr] || 1.0); // Safe access
        }
    }
    // Youth Scout bonus for younger players
    if (coach.type === 'Youth Scout' && player.age) score += (18 - player.age) * 10;
    return score;
}

/** Sets up draft order based on standings or randomness for year 1. */
export function setupDraft() {
    if (!game || !game.teams) { console.error("setupDraft: Game/teams not initialized."); return; }
    game.draftOrder = [];
    game.currentPick = 0;

    // Sort teams safely
    const sortedTeams = [...game.teams]
        .filter(t => t) // Filter out nulls
        .sort((a, b) => (a.wins || 0) - (b.wins || 0) || (b.losses || 0) - (a.losses || 0)); // Safe access W/L

    const ROSTER_LIMIT = 10; // Use constant

    // Set draft needs based on current roster size vs limit
    console.log("Setting draft needs based on current rosters...");
    game.teams.forEach(team => {
        if (team) { // Safety check
            team.draftNeeds = Math.max(0, ROSTER_LIMIT - (team.roster?.length || 0)); // Safe access roster length
            // console.log(`${team.name} needs ${team.draftNeeds} players.`);
        }
    });

    // Determine number of rounds needed (max needs across all teams)
    const maxNeeds = Math.max(0, ...game.teams.map(t => t?.draftNeeds || 0));
    if (maxNeeds === 0) {
        console.log("All teams have full rosters. No draft needed this offseason.");
        // We still need a schedule, but the draft itself is skipped.
        // The draftOrder array will remain empty.
        return;
    }

    // Create serpentine draft order for the required number of rounds
    for (let i = 0; i < maxNeeds; i++) {
        game.draftOrder.push(...(i % 2 === 0 ? sortedTeams : [...sortedTeams].reverse()));
    }
    console.log(`Draft setup with ${maxNeeds} rounds, total picks: ${game.draftOrder.length}`);
}

/**
 * Automatically sets the depth chart for an AI team based on slot suitability.
 * @param {object} team - The team object to set the depth chart for.
 */
export function aiSetDepthChart(team) {
    // Safety checks for essential team data
    if (!team || !team.roster || !team.depthChart || !team.formations) {
        console.error(`aiSetDepthChart: Invalid team data provided for ${team?.name || 'unknown team'}.`);
        return;
    }
    const { roster, depthChart, formations } = team;
    if (roster.length === 0) return; // Skip if roster is empty

    // Reset depth chart slots to null based on *current* formation
    for (const side in depthChart) {
        if (!depthChart[side]) depthChart[side] = {}; // Ensure side object exists
        // Get slots based on current formation, default if missing
        const formationSlots = (side === 'offense'
            ? offenseFormations[formations.offense]?.slots
            : defenseFormations[formations.defense]?.slots) || [];
        // Ensure all current formation slots exist and are null
        const newChartSide = {};
        formationSlots.forEach(slot => newChartSide[slot] = null);
        depthChart[side] = newChartSide; // Replace with correctly structured empty chart
    }

    // Assign players side by side
    for (const side in depthChart) {
        const slots = Object.keys(depthChart[side]);
        // Filter roster for valid players only for this assignment pass
        let availablePlayers = roster.filter(p => p && p.attributes && p.status); // Basic validity check

        // Prioritize key positions (e.g., QB, RB1 on offense)
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
                // Find the best available player for *this specific slot*
                const bestPlayerForSlot = availablePlayers.reduce((best, current) => {
                    const bestSuitability = calculateSlotSuitability(best, slot, side, team);
                    const currentSuitability = calculateSlotSuitability(current, slot, side, team);
                    // --- Avoid Two-Way Starters in Key Roles ---
                    const otherSide = side === 'offense' ? 'defense' : 'offense';
                    const isStartingCriticalOtherSide = (player) =>
                        (team.depthChart[otherSide]?.['QB1'] === player.id) ||
                        (team.depthChart[otherSide]?.['RB1'] === player.id);
                    const bestIsCritical = isStartingCriticalOtherSide(best);
                    const currentIsCritical = isStartingCriticalOtherSide(current);
                    if (bestIsCritical && !currentIsCritical) return current;
                    if (!bestIsCritical && currentIsCritical) return best;
                    // --- End Two-Way Check ---
                    return currentSuitability > bestSuitability ? current : best;
                }, availablePlayers[0]); // Start comparison with the first available player

                // Assign the best player
                if (bestPlayerForSlot) {
                     depthChart[side][slot] = bestPlayerForSlot.id;
                     availablePlayers = availablePlayers.filter(p => p.id !== bestPlayerForSlot.id);
                }
            }
        }); // End slot loop
    } // End side loop
}

/**
 * Simulates an AI team's draft pick based on coach preferences.
 * @param {object} team - The AI team making the pick.
 * @returns {object|null} The player object that was drafted, or null if no pick was made.
 */
export function simulateAIPick(team) {
    if (!team || !team.roster || !game || !game.players || !team.coach) {
        console.error(`simulateAIPick: Invalid team data or game state.`);
        return null;
    }
    const ROSTER_LIMIT = 10;
    if (team.roster.length >= ROSTER_LIMIT) return null; // Roster Full

    const undraftedPlayers = game.players.filter(p => p && !p.teamId);
    if (undraftedPlayers.length === 0) return null; // No players left

    // Find the best available player based on coach score
    let bestPick = { player: null, score: -Infinity };
    if(undraftedPlayers.length > 0) {
        bestPick = undraftedPlayers.reduce((best, current) => {
            const currentScore = getPlayerScore(current, team.coach);
            return currentScore > best.score ? { player: current, score: currentScore } : best;
        }, { player: undraftedPlayers[0], score: getPlayerScore(undraftedPlayers[0], team.coach) });
    }
    const bestPlayer = bestPick.player;

    if (bestPlayer) {
        addPlayerToTeam(bestPlayer, team);
    } else { console.warn(`${team.name} failed to find a suitable player.`); }
    return bestPlayer;
}

/**
 * Adds a player object to a team's roster array and updates the player's teamId.
 * @param {object} player - The player object to add.
 * @param {object} team - The team object to add the player to.
 * @returns {boolean} True if the player was successfully added, false otherwise.
 */
export function addPlayerToTeam(player, team) {
     if (!player || !team || !team.roster || typeof player.id === 'undefined') {
         console.error("addPlayerToTeam: Invalid player or team object provided.");
         return false;
     }
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
        console.error("generateSchedule: Game state invalid.");
        game.schedule = []; return;
    }
    game.schedule = [];
    game.currentWeek = 0;
    const numWeeks = 9; // 10 teams per division -> 9 rounds
    const allWeeklyGames = Array(numWeeks).fill(null).map(() => []);

    console.log("Generating schedule...");

    for (const divisionName of divisionNames) {
        let teamsInDivision = game.teams.filter(t => t && t.division === divisionName);
        if (teamsInDivision.length !== 10) {
            console.error(`Scheduling Error: Division ${divisionName} requires 10 teams but has ${teamsInDivision.length}. Skipping.`);
            continue;
        }
        const numTeams = teamsInDivision.length;

        // Round-robin algorithm
        for (let round = 0; round < numWeeks; round++) {
            for (let match = 0; match < numTeams / 2; match++) {
                const homeIdx = match;
                const awayIdx = numTeams - 1 - match;
                if (homeIdx < teamsInDivision.length && awayIdx < teamsInDivision.length) {
                    const home = teamsInDivision[homeIdx];
                    const away = teamsInDivision[awayIdx];
                    if (home && away) {
                        const matchup = round % 2 === 1 ? { home, away } : { home: away, away: home };
                        allWeeklyGames[round].push(matchup);
                    } else { console.warn(`Scheduling warning: Invalid team object in round ${round}, match ${match}, div ${divisionName}`); }
                } else { console.warn(`Scheduling warning: Invalid team index in round ${round}, match ${match}, div ${divisionName}`); }
            }
            // Rotate teams (except the first one)
            const lastTeam = teamsInDivision.pop();
            if (lastTeam) teamsInDivision.splice(1, 0, lastTeam);
        }
    }
    game.schedule = allWeeklyGames.flat();
    console.log(`Schedule generated: ${game.schedule.length} total games over ${numWeeks} weeks.`);
}

/** Resets player fatigue and game stats (typically before a game). */
function resetGameStats() {
    if (!game || !game.players) {
        console.warn("resetGameStats: Game or players list not available."); return;
    }
    game.players.forEach(player => {
        if (!player) return;
        player.fatigue = 0;
        // Ensure gameStats object exists and includes all potential new stats
        player.gameStats = {
            receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0,
            tackles: 0, sacks: 0, interceptions: 0,
            passAttempts: 0, passCompletions: 0, interceptionsThrown: 0
        };
    });
}

/** Checks for a chance of in-game injury based on toughness. */
function checkInGameInjury(player, gameLog) {
    if (!player || !player.attributes || !player.attributes.mental || !player.status || player.status.duration > 0) {
        return; // Skip if invalid or already unavailable
    }
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

/** Finds the best available substitute player for a given position on a team. */
function getBestSub(team, position, usedPlayerIds) {
    if (!team || !team.roster || !Array.isArray(team.roster)) {
        console.warn("getBestSub: Invalid team or roster provided.");
        return null;
    }
    const availableSubs = team.roster
        .filter(p => p && p.status?.duration === 0 && !usedPlayerIds.has(p.id));

    if (availableSubs.length === 0) return null;

    return availableSubs.reduce((best, current) =>
        (calculateOverall(current, position) > calculateOverall(best, position)) ? current : best,
        availableSubs[0]
    );
}

/** Gets active players for specific slots (e.g., all 'WR' slots), handling subs. */
function getPlayersForSlots(team, side, slotPrefix, usedPlayerIdsThisPlay) {
    if (!team || !team.depthChart || !team.depthChart[side] || !team.roster || !Array.isArray(team.roster)) {
        console.error(`getPlayersForSlots: Invalid team data for ${team?.id}, side ${side}.`);
        return [];
    }
     const sideDepthChart = team.depthChart[side];
     if (typeof sideDepthChart !== 'object' || sideDepthChart === null) {
         console.error(`getPlayersForSlots: Invalid depth chart for side "${side}" on ${team?.id}.`);
         return [];
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

/**
 * Gets a single, healthy player for a specific slot, finding a sub if needed.
 * Marks the player as used for the current play.
 */
function getPlayerBySlot(team, side, slot, usedPlayerIdsThisPlay) {
    if (!team || !team.depthChart || !team.depthChart[side] || !team.roster || !Array.isArray(team.roster)) {
        console.error(`getPlayerBySlot: Invalid team data for ${slot} on ${side}.`);
        return null;
    }
    const sideDepthChart = team.depthChart[side];
     if (typeof sideDepthChart !== 'object' || sideDepthChart === null) {
         console.error(`getPlayerBySlot: Invalid depth chart object for side ${side}.`);
         return null;
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

/**
 * Finds *any* healthy, unused player on the roster for a given position as a last resort.
 * Marks the player as used.
 */
function findEmergencyPlayer(position, team, side, usedPlayerIdsThisPlay) {
   if (!team || !team.roster || !Array.isArray(team.roster)) {
       console.warn(`findEmergencyPlayer: Invalid team data for ${position}.`);
       return null;
    }
    const availablePlayers = team.roster.filter(p => p && p.status?.duration === 0 && !usedPlayerIdsThisPlay.has(p.id));
    if (availablePlayers.length === 0) {
        console.warn(`findEmergencyPlayer: No healthy, unused players found on roster for ${position}.`);
        return null;
    }
    const bestEmergencyPlayer = availablePlayers.reduce((best, current) =>
        (calculateOverall(current, position) > calculateOverall(best, position)) ? current : best,
        availablePlayers[0]
    );
    if (bestEmergencyPlayer) {
        usedPlayerIdsThisPlay.add(bestEmergencyPlayer.id);
        return { player: bestEmergencyPlayer, slot: 'EMERGENCY' };
    }
    return null;
}
// game.js - PART 3/5

// ... (Imports, Constants, Core Helpers, Initialization, Draft, Scheduling from Parts 1 & 2) ...

// =============================================================
// --- TICK LOOP HELPER FUNCTIONS ---
// =============================================================

/**
 * Updates player targets based on their current action and game state. (Simplified AI)
 * Modifies playerState objects within playState.activePlayers directly.
 */
// game.js

// --- Add near constants or helpers ---
// Define basic zone boundaries relative to LoS and field center/width
// Example zones (adjust coordinates as needed)
const zoneBoundaries = {
    // Deep Zones (Y >= LoS + 15)
    'zone_deep_half_left':  { minX: 0, maxX: CENTER_X, minY: 15, maxY: 60 },
    'zone_deep_half_right': { minX: CENTER_X, maxX: FIELD_WIDTH, minY: 15, maxY: 60 },
    'zone_deep_middle':     { minX: HASH_LEFT_X, maxX: HASH_RIGHT_X, minY: 15, maxY: 60 }, // Cover 3 middle safety
    // Underneath Zones (Y < LoS + 15)
    'zone_flat_left':   { minX: 0, maxX: HASH_LEFT_X - 5, minY: -2, maxY: 8 }, // Curl/Flat area
    'zone_flat_right':  { minX: HASH_RIGHT_X + 5, maxX: FIELD_WIDTH, minY: -2, maxY: 8 },
    'zone_hook_left':   { minX: HASH_LEFT_X - 5, maxX: CENTER_X - 2, minY: 5, maxY: 14 }, // Hook/Curl zone
    'zone_hook_right':  { minX: CENTER_X + 2, maxX: HASH_RIGHT_X + 5, minY: 5, maxY: 14 },
    'zone_short_middle':{ minX: CENTER_X - 5, maxX: CENTER_X + 5, minY: 0, maxY: 12 }, // Middle linebacker area
    // Simplified Run Fits
    'run_gap_A_left':   { targetX: CENTER_X - 2, targetY: 0.5 }, // A-Gap
    'run_gap_A_right':  { targetX: CENTER_X + 2, targetY: 0.5 },
    'run_gap_B_left':   { targetX: CENTER_X - 5, targetY: 0.5 }, // B-Gap
    'run_gap_B_right':  { targetX: CENTER_X + 5, targetY: 0.5 },
    'run_edge_left':    { targetX: CENTER_X - 10, targetY: 0.5}, // Contain Edge
    'run_edge_right':   { targetX: CENTER_X + 10, targetY: 0.5},
};

// Helper to check if a player is roughly within a zone's Y-bounds relative to LoS
function isPlayerInZoneY(playerState, zoneAssignment, lineOfScrimmage) {
    const zone = zoneBoundaries[zoneAssignment];
    if (!zone || playerState.y === undefined) return false;
    const playerYRel = playerState.y - lineOfScrimmage; // Player Y relative to LoS
    return playerYRel >= (zone.minY || -Infinity) && playerYRel <= (zone.maxY || Infinity);
}
// Helper to get zone center (absolute coords)
function getZoneCenter(zoneAssignment, lineOfScrimmage) {
     const zone = zoneBoundaries[zoneAssignment];
     if (!zone) return { x: CENTER_X, y: lineOfScrimmage + 7 }; // Default fallback
     const centerX = (zone.minX + zone.maxX) / 2;
     const centerYRel = (zone.minY + zone.maxY) / 2;
     return { x: centerX, y: lineOfScrimmage + centerYRel };
}
// --- End Zone Helpers ---


/**
 * Updates player targets based on their current action, assignment, and game state. (Improved AI)
 * Modifies playerState objects within playState.activePlayers directly.
 */
function updatePlayerTargets(playState, offenseStates, defenseStates, ballCarrierState, playType, offensiveAssignments, defensivePlayCallKey) {
    const timeDelta = TICK_DURATION_SECONDS;
    const qbState = offenseStates.find(p => p.slot?.startsWith('QB'));
    const isBallInAir = playState.ballState.inAir;
    const ballPos = playState.ballState;

    playState.activePlayers.forEach(pState => {
        // --- Offensive Logic ---
        if (pState.isOffense) {
            switch (pState.action) {
                case 'run_route':
                    // --- Route Path Following ---
                    if (pState.routePath && pState.routePath.length > 0) {
                        // Check if current segment target is reached
                        const currentTargetIndex = Math.min(pState.currentPathIndex, pState.routePath.length - 1);
                        const targetPoint = pState.routePath[currentTargetIndex];

                        if (getDistance(pState, targetPoint) < 0.75) { // Threshold for reaching a point
                            // If not the last point, advance index
                            if (pState.currentPathIndex < pState.routePath.length - 1) {
                                pState.currentPathIndex++;
                                const nextPoint = pState.routePath[pState.currentPathIndex];
                                pState.targetX = nextPoint.x;
                                pState.targetY = nextPoint.y;
                            } else {
                                // Reached end of defined path, continue straight or improvise?
                                // Simple: Continue in the last direction for a bit
                                if (pState.routePath.length > 1) {
                                    const lastPoint = pState.routePath[pState.routePath.length - 1];
                                    const secondLastPoint = pState.routePath[pState.routePath.length - 2];
                                    const lastDx = lastPoint.x - secondLastPoint.x;
                                    const lastDy = lastPoint.y - secondLastPoint.y;
                                    pState.targetX = pState.x + lastDx * 0.5; // Continue half step
                                    pState.targetY = pState.y + lastDy * 0.5;
                                } else { // Path had only one point, just stop
                                    pState.targetX = pState.x; pState.targetY = pState.y;
                                }
                                pState.action = 'route_complete'; // Mark route as finished
                            }
                        } else {
                             // Still moving towards current path point
                             pState.targetX = targetPoint.x;
                             pState.targetY = targetPoint.y;
                        }
                    } else { // No path defined, use simple initial target logic
                        if (getDistance(pState, {x: pState.targetX, y: pState.targetY}) < 0.5) {
                            pState.targetX = pState.x; pState.targetY = pState.y; // Stop
                            pState.action = 'route_complete'; // Mark route as finished even if no path
                        }
                        // else keep moving towards initial target
                    }
                    // --- End Path Following ---
                    break;

                case 'route_complete':
                    // --- Improvisation after route ---
                    // Simple: If QB is scrambling, try to move towards QB's scramble direction
                    // If QB is in pocket, find open space away from nearest defender
                    const nearestDefender = defenseStates
                        .filter(d => !d.isBlocked && !d.isEngaged)
                        .sort((a, b) => getDistance(pState, a) - getDistance(pState, b))[0];

                    if (qbState?.action === 'qb_scramble') {
                        // Move towards sideline QB is rolling towards, staying downfield
                        pState.targetX = qbState.targetX > CENTER_X ? FIELD_WIDTH - 5 : 5; // Move to sideline area
                        pState.targetY = Math.max(playState.lineOfScrimmage + 5, pState.y); // Stay past LoS
                    } else if (nearestDefender && getDistance(pState, nearestDefender) < 4.0) {
                        // Move away from nearest defender horizontally
                        const moveXDir = pState.x > nearestDefender.x ? 1 : -1;
                        pState.targetX = pState.x + moveXDir * 2;
                        pState.targetY = pState.y; // Stay roughly at same depth
                    } else {
                        // Stay put if relatively open
                        pState.targetX = pState.x; pState.targetY = pState.y;
                    }
                    // --- End Improvisation ---
                    break;

                case 'pass_block': // Separate pass/run block targeting
                     if (pState.engagedWith) {
                         // Stay engaged, mirror the defender
                         const engagedDefender = defenseStates.find(d => d.id === pState.engagedWith);
                         if(engagedDefender){
                             // Try to mirror defender slightly to maintain block
                             pState.targetX = engagedDefender.x;
                             pState.targetY = engagedDefender.y;
                         } else { // Defender disengaged (e.g., shed block), clear state
                              pState.engagedWith = null;
                              pState.isEngaged = false; 
                              // Fall through to find new target logic below
                         }
                     }
                     // If not engaged (or defender disengaged), find a new target
                     if (!pState.engagedWith) {
                         // Prioritize inside-out, closest rushers to QB
                         const potentialTargets = defenseStates
                             .filter(d => !d.isBlocked && !d.isEngaged && (d.assignment === 'pass_rush' || d.assignment?.includes('blitz'))) // Target active rushers
                             .sort((a, b) => {
                                 // Prioritize closer X distance (inside), then closer Y distance to QB
                                 const distA = getDistance(qbState || pState, a); // Dist to QB (or self if no QB)
                                 const distB = getDistance(qbState || pState, b);
                                 const xDiffA = Math.abs(a.x - (qbState?.x || pState.x)); // X diff from QB
                                 const xDiffB = Math.abs(b.x - (qbState?.x || pState.x));
                                 return xDiffA - xDiffB || distA - distB; // Inside first, then closest overall
                             });
                         const targetDefender = potentialTargets[0]; // Target the highest priority one

                         if (targetDefender) {
                             // Target slightly ahead of the defender to intercept
                             const interceptFactor = 0.6; // Lead a bit more aggressively
                             pState.targetX = pState.x + (targetDefender.x - pState.x) * interceptFactor;
                             pState.targetY = pState.y + (targetDefender.y - pState.y) * interceptFactor;
                         } else { 
                             // No immediate threat, hold position (pass set)
                             pState.targetX = pState.x;
                             pState.targetY = pState.y - 0.05; // Tiny step back in pass pro
                         }
                     }
                     break;
                 case 'run_block':
                    // If engaged, maintain position relative to defender
                    if (pState.engagedWith) {
                         const engagedDefender = defenseStates.find(d => d.id === pState.engagedWith);
                         if(engagedDefender){
                             // Try to mirror defender and push slightly forward (relative to offense)
                             pState.targetX = engagedDefender.x;
                             pState.targetY = engagedDefender.y + 0.1; // Tiny push towards defender's side
                         } else { // Defender disengaged (e.g., shed block), clear state
                              pState.engagedWith = null;
                              pState.isEngaged = false;
                              // Fall through to find new target logic below
                         }
                    }
                    // If not engaged (or defender disengaged), find a new target
                    if (!pState.engagedWith) {
                        // Target defenders at the line of scrimmage first, then LBs
                        const primaryTargets = defenseStates
                             .filter(d => !d.isBlocked && !d.isEngaged && d.y < playState.lineOfScrimmage + 3 && Math.abs(d.x - pState.initialX) < 4) // Near LoS and original gap
                             .sort((a, b) => getDistance(pState, a) - getDistance(pState, b));
                        const secondaryTargets = defenseStates
                             .filter(d => !d.isBlocked && !d.isEngaged && d.y >= playState.lineOfScrimmage + 3 && d.y < playState.lineOfScrimmage + 8 && Math.abs(d.x - pState.initialX) < 6) // LBs further back
                             .sort((a, b) => getDistance(pState, a) - getDistance(pState, b));

                        const targetDefender = primaryTargets[0] || secondaryTargets[0]; // Prioritize DL then LB

                        if (targetDefender) {
                            // Target slightly ahead to intercept
                            const interceptFactor = 0.6; // Lead a bit more aggressively
                            pState.targetX = pState.x + (targetDefender.x - pState.x) * interceptFactor;
                            pState.targetY = pState.y + (targetDefender.y - pState.y) * interceptFactor;
                        } else { 
                            // No immediate threat, move upfield slightly to find next block?
                            pState.targetX = pState.x; // Move straight ahead slowly from initial X?
                            pState.targetY = pState.y + 1.0; // Move slightly downfield to find next level
                        }
                    }
                    break;

                case 'run_path':
                case 'qb_scramble':
                    // --- Ball Carrier Logic with Avoidance ---
                    const threatDistance = 3.0; // Shorter lookahead
                    const threatWidth = 2.0;  // Narrower cone
                    // Find nearest unblocked defender within a short forward cone
                    const nearestThreat = defenseStates
                        .filter(d => !d.isBlocked && !d.isEngaged &&
                                     d.y > pState.y && d.y < pState.y + threatDistance && // In front
                                     Math.abs(d.x - pState.x) < threatWidth) // Nearby horizontally
                        .sort((a, b) => getDistance(pState, a) - getDistance(pState, b))[0]; // Closest one

                    let targetXOffset = 0;
                    if (nearestThreat) {
                        // Adjust target X away from the threat, more strongly if closer
                        const distanceToThreat = getDistance(pState, nearestThreat);
                        // Stronger avoidance effect, scales from 1.0 (at max dist) up to ~2.0 (very close)
                        const avoidStrength = 1.0 + (threatDistance - distanceToThreat) * 0.5;
                        targetXOffset = (pState.x >= nearestThreat.x) ? avoidStrength : -avoidStrength; // Move away horizontally
                    }
                    
                    // --- Find Open Lane (Simple Placeholder - needs blocker info) ---
                    // Example: Check if space is clearer slightly left or right based on defender density
                    // This needs more complex logic checking blocker positions vs defender positions ahead.
                    // Placeholder: Just use avoidance for now
                    let bestLaneX = pState.x + targetXOffset; // Start with avoidance X
                    // --- End Find Lane ---

                    // Primary target Y is downfield
                    pState.targetY = Math.min(FIELD_LENGTH - 10.1, pState.y + 7); // Target further ahead
                    pState.targetX = bestLaneX; // Use calculated lane or avoidance X

                    break;

                case 'qb_setup':
                    // Maintain position if target reached, wait for QB decision logic
                    if (getDistance(pState, {x: pState.targetX, y: pState.targetY}) < 0.5) {
                        pState.targetX = pState.x; pState.targetY = pState.y; // Hold position
                    } // else keep moving to dropback spot (targetX/Y remain unchanged)
                    break;

                case 'idle': default:
                    pState.targetX = pState.x; pState.targetY = pState.y; // Stay put
                    break;
            } // End Offensive Switch
        } // --- End Offensive Logic ---
        // --- Defensive Logic ---
        else { // Defender
            if (pState.isBlocked || pState.isEngaged) {
                 // Hold position or fight block (could add counter-move logic here)
                 pState.targetX = pState.x; pState.targetY = pState.y;
            } else {
                 let target = null; // Target playerState or {x, y}
                 const assignment = pState.assignment;
                 const readPlayType = playState.tick > 5 ? playType : null; // Basic read

                 // --- Assignment-Based Targeting ---
                 if (assignment?.startsWith('man_cover_')) {
                     const targetSlot = assignment.split('man_cover_')[1];
                     const assignedReceiver = offenseStates.find(o => o.slot === targetSlot);
                     if (assignedReceiver) {
                         // Basic Man: Target slightly behind receiver to prevent getting beat deep?
                         // Or mirror receiver's target if known? Simple target for now.
                         target = assignedReceiver;
                         // Add leverage: stay slightly inside if receiver is outside hashes?
                         if (target.x < HASH_LEFT_X || target.x > HASH_RIGHT_X) { // Outside
                            // pState.targetX = target.x + (target.x < CENTER_X ? 0.5 : -0.5); // Shade inside
                         }
                     } else { target = {x: pState.x, y: pState.y + 1};} // Receiver not found?

                 } else if (assignment?.startsWith('zone_')) {
                     const zoneCenter = getZoneCenter(assignment, playState.lineOfScrimmage);
                     target = zoneCenter; // Default: Move towards zone center

                     // Find threats (receivers in route) within or entering the zone boundaries
                     // This requires defining zone X boundaries too in zoneBoundaries
                     // const threatsInZone = offenseStates.filter(o => o.action === 'run_route' && isPlayerInZone(o, assignment, playState.lineOfScrimmage));
                     const threatsInZone = offenseStates.filter(o => o.action === 'run_route' && isPlayerInZoneY(o, assignment, playState.lineOfScrimmage)); // Use Y-check for now

                     const carrierInZone = ballCarrierState && isPlayerInZoneY(ballCarrierState, assignment, playState.lineOfScrimmage);

                     if (isBallInAir && isPlayerInZoneY({y: ballPos.y}, assignment, playState.lineOfScrimmage) ) {
                           // Ball thrown towards zone, target ball/receiver
                           const targetReceiverState = playState.activePlayers.find(p => p.id === playState.ballState.targetPlayerId);
                           target = targetReceiverState || ballPos; // Target receiver or ball coords
                     } else if (carrierInZone && assignment.includes('flat') || assignment.includes('short') || assignment.includes('hook') ) {
                           target = ballCarrierState; // Underneath zones react to run/scramble
                     } else if (threatsInZone.length > 0) {
                          // Target closest threat within the zone
                          target = threatsInZone.sort((a,b)=> getDistance(pState, a) - getDistance(pState, b))[0];
                     } // Else: continue moving towards zoneCenter

                 } else if (assignment === 'pass_rush' || assignment === 'blitz_gap' || assignment === 'blitz_edge') {
                      target = qbState; // Target QB
                      // Advanced: Calculate path around blockers based on agility/blockShedding vs blocker strength/agility
                      // Simple: Basic pursuit towards QB, rely on block resolution

                 } else if (assignment?.startsWith('run_gap_') || assignment?.startsWith('run_edge_')) {
                     const runTargetPoint = zoneBoundaries[assignment]; // Get the target point for the gap/edge
                     target = runTargetPoint ? { x: runTargetPoint.targetX, y: playState.lineOfScrimmage + runTargetPoint.targetY } : {x: pState.x, y: pState.y}; // Initial target

                     // React to ball carrier
                     if (ballCarrierState && getDistance(pState, ballCarrierState) < 6) {
                         target = ballCarrierState; // Aggressively pursue nearby carrier
                     } else if (readPlayType === 'run') {
                          // If run read but carrier far, maybe slant towards expected run path?
                     } // Else hold gap target

                 } else { // Default / Read / Spy? assignment
                      if (isBallInAir) { target = {x: ballPos.x, y: ballPos.y}; } // Head towards ball
                      else if (ballCarrierState) { target = ballCarrierState; } // Pursue carrier
                      else if (qbState?.action === 'qb_scramble') { target = qbState;} // Spy/contain QB scramble
                      else { target = {x: pState.x, y: pState.y + 0.1}; } // Slow read step
                 }

                 // --- Set Target Coordinates ---
                 if (target) {
                      if (target.speed !== undefined) { // Targeting a player
                           // --- Enhanced Pursuit Angle ---
                           const targetSpeed = target.speed || 50;
                           const ownSpeedYPS = Math.max(1, (pState.speed/10 * pState.fatigueModifier));
                           const distToTarget = getDistance(pState, target);
                           const timeToIntercept = distToTarget / ownSpeedYPS; // Estimated time

                           // Project target's movement vector
                           const targetDX = target.targetX - target.x;
                           const targetDY = target.targetY - target.y;
                           const targetDistToTarget = Math.sqrt(targetDX*targetDX + targetDY*targetDY);
                           const targetSpeedYPS = targetSpeed/10 * (target.fatigueModifier || 1.0);
                           // Anticipation: scale based on distance and target speed vs own speed?
                           const anticipationFactor = Math.min(1.0, 0.4 + distToTarget / 15); // Lead more for further targets
                           const targetMoveDist = targetSpeedYPS * timeToIntercept * anticipationFactor;

                           let futureTargetX = target.x;
                           let futureTargetY = target.y;
                           if (targetDistToTarget > 0.1) {
                                futureTargetX += (targetDX / targetDistToTarget) * targetMoveDist;
                                futureTargetY += (targetDY / targetDistToTarget) * targetMoveDist;
                           }
                           pState.targetX = futureTargetX;
                           pState.targetY = futureTargetY;
                           // --- End Pursuit Angle ---
                      } else { // Target is a fixed point {x, y}
                           pState.targetX = target.x;
                           pState.targetY = target.y;
                      }
                 } else { // No target assigned
                      pState.targetX = pState.x;
                      pState.targetY = pState.y; // Hold position
                 }
            }
        }
        // Clamp targets within field boundaries
        pState.targetX = Math.max(0.1, Math.min(FIELD_WIDTH - 0.1, pState.targetX));
        pState.targetY = Math.max(0.1, Math.min(FIELD_LENGTH - 0.1, pState.targetY));
    });
}
// game.js

// --- Add near constants or helpers ---
// Define basic zone boundaries relative to LoS and field center/width
// Example zones (adjust coordinates as needed)

// Helper to check if a player is roughly within a zone's boundaries (absolute coords)
function isPlayerInZone(playerState, zoneAssignment, lineOfScrimmage) {
    const zone = zoneBoundaries[zoneAssignment];
    if (!zone || playerState.x === undefined || playerState.y === undefined) return false;
    const playerYRel = playerState.y - lineOfScrimmage; // Player Y relative to LoS

    // Check X boundaries first if they exist
    if ((zone.minX !== undefined && playerState.x < zone.minX) || (zone.maxX !== undefined && playerState.x > zone.maxX)) {
        return false;
    }
    // Check Y boundaries
    return playerYRel >= (zone.minY || -Infinity) && playerYRel <= (zone.maxY || Infinity);
}
// --- End Zone Helpers ---


/**
 * Updates player targets based on their current action, assignment, and game state. (Improved AI)
 * Modifies playerState objects within playState.activePlayers directly.
 * Assumes playerState includes an 'assignment' field populated during setup (e.g., 'man_cover_WR1', 'zone_deep_half', 'blitz_gap', route name).
 * @param {object} playState - The mutable play state object, including lineOfScrimmage.
 * @param {Array<object>} offenseStates - Array of playerState objects for offense.
 * @param {Array<object>} defenseStates - Array of playerState objects for defense.
 * @param {object|null} ballCarrierState - Current ball carrier's playerState, or null.
 * @param {string} playType - 'pass' or 'run'.
 * @param {object} offensiveAssignments - Original offensive play assignments {slot: routeName}.
 * @param {string} defensivePlayCallKey - Key for the called defensive play (e.g., 'Cover_2_Zone').
 */

/**
 * Checks for block engagements based on proximity.
 * Modifies playerState (engagedWith, isBlocked) and adds to playState.blockBattles.
 */
function checkBlockCollisions(playState) {
    const offenseStates = playState.activePlayers.filter(p => p.isOffense);
    const defenseStates = playState.activePlayers.filter(p => !p.isOffense);

    offenseStates.forEach(blocker => {
        // Only check eligible blockers who aren't already engaged
        if ((blocker.action === 'pass_block' || blocker.action === 'run_block') && !blocker.engagedWith) {
            // Find eligible defenders within range
            const defendersInRange = defenseStates.filter(defender =>
                !defender.isBlocked && !defender.isEngaged && // Defender is available
                getDistance(blocker, defender) < BLOCK_ENGAGE_RANGE
            );

            if (defendersInRange.length > 0) {
                // Engage the closest defender in range
                const targetDefender = defendersInRange.sort((a, b) => getDistance(blocker, a) - getDistance(blocker, b))[0];

                blocker.engagedWith = targetDefender.id;
                blocker.isEngaged = true; // Mark blocker as engaged too
                targetDefender.isBlocked = true;
                targetDefender.blockedBy = blocker.id;
                targetDefender.isEngaged = true; // Mark defender as engaged

                // Add to active battles list for resolution in resolveOngoingBlocks
                playState.blockBattles.push({
                    blockerId: blocker.id,
                    defenderId: targetDefender.id,
                    status: 'ongoing',
                    streakA: 0, streakB: 0
                });
                // Optional log: gameLog.push(`${blocker.name} engages ${targetDefender.name}`);
            }
        }
    });
}

/**
 * Checks for tackle attempts based on proximity to ball carrier.
 * Initiates tackle resolution and handles fumbles.
 * Returns true if the play ended due to tackle/fumble, false otherwise.
 */
function checkTackleCollisions(playState, gameLog) {
     const ballCarrierState = playState.activePlayers.find(p => p.isBallCarrier);
     if (!ballCarrierState) return false; // No carrier, no tackle

     const defenseStates = playState.activePlayers.filter(p => !p.isOffense);

     for (const defender of defenseStates) {
         // Check if defender is eligible (not blocked/engaged) and in range
         if (!defender.isBlocked && !defender.isEngaged && getDistance(ballCarrierState, defender) < TACKLE_RANGE) {
             // Initiate tackle attempt
             defender.isEngaged = true; // Mark defender as busy

             // Find original player objects for stats/attributes
             const carrierPlayer = game.players.find(p=>p && p.id === ballCarrierState.id);
             const tacklerPlayer = game.players.find(p=>p && p.id === defender.id);
             if (!carrierPlayer || !tacklerPlayer) { // Safety check
                 console.warn("Tackle check: Could not find original player objects.");
                 defender.isEngaged = false; // Release defender if data missing
                 continue; // Try next defender
             }

             // --- FUMBLE CHECK ---
             if (checkFumble(carrierPlayer, tacklerPlayer, playState, gameLog)) {
                 return true; // Fumble ends play
             }
             // --- END FUMBLE CHECK ---

             // Resolve tackle immediately using stats
             const breakPower = ((carrierPlayer.attributes?.physical?.agility || 50) + (carrierPlayer.attributes?.physical?.strength || 50)/2) * ballCarrierState.fatigueModifier;
             const tacklePower = ((tacklerPlayer.attributes?.technical?.tackling || 50) + (tacklerPlayer.attributes?.physical?.strength || 50)/2) * defender.fatigueModifier;
             const diff = breakPower - (tacklePower + getRandomInt(-15, 25)); // Add randomness

             const TACKLE_THRESHOLD = 5; // Define threshold for breaking vs success

             if (diff <= TACKLE_THRESHOLD) { // Tackle success (or close enough)
                 playState.yards = ballCarrierState.y - playState.lineOfScrimmage; // Calculate yards gained based on tackle spot
                 gameLog.push(`✋ ${ballCarrierState.name} tackled by ${defender.name} for a gain of ${playState.yards.toFixed(1)} yards.`);
                 playState.playIsLive = false;
                 // Add tackle stat
                 if (!tacklerPlayer.gameStats) tacklerPlayer.gameStats = { tackles: 0 };
                 tacklerPlayer.gameStats.tackles = (tacklerPlayer.gameStats.tackles || 0) + 1;
                 return true; // Play ended
             } else { // Broken tackle
                 gameLog.push(`💥 ${ballCarrierState.name} breaks tackle from ${defender.name}!`);
                 defender.isEngaged = false; // Defender failed, reset engagement
                 // Optionally make defender briefly unable to re-engage (e.g., add a 'stunned' timer)
             }
         }
     }
     return false; // Play continues if no successful tackle
}


/**
 * Resolves ongoing block battles based on stats using resolveBattle helper.
 * Modifies playerState (engagedWith, isBlocked) and battle states.
 */
function resolveOngoingBlocks(playState, gameLog) {
    const battlesToRemove = []; // Keep track of indices to remove later
    playState.blockBattles.forEach((battle, index) => {
        if (battle.status !== 'ongoing') return; // Skip completed battles

        const blockerState = playState.activePlayers.find(p => p.id === battle.blockerId);
        const defenderState = playState.activePlayers.find(p => p.id === battle.defenderId);

        // Check if players still exist and are engaged with each other
        if (!blockerState || !defenderState || blockerState.engagedWith !== defenderState.id || defenderState.blockedBy !== blockerState.id) {
            battle.status = 'disengaged';
            battlesToRemove.push(index);
            if (blockerState) blockerState.engagedWith = null;
            if (defenderState) { defenderState.isBlocked = false; defenderState.blockedBy = null; defenderState.isEngaged = false;}
            return;
        }

        // Resolve using stats
        const blockPower = ((blockerState.blocking || 50) + (blockerState.strength || 50)) * blockerState.fatigueModifier;
        const shedPower = ((defenderState.blockShedding || 50) + (defenderState.strength || 50)) * defenderState.fatigueModifier;

        resolveBattle(blockPower, shedPower, battle); // Use the abstract helper for win/loss/streak

        if (battle.status === 'win_B') { // Defender wins (sheds block)
            // gameLog.push(`🛡️ ${defenderState.name} sheds block from ${blockerState.name}!`); // Optional log
            blockerState.engagedWith = null;
            defenderState.isBlocked = false;
            defenderState.blockedBy = null;
            defenderState.isEngaged = false; // No longer engaged in block
            // Defender can now pursue based on updatePlayerTargets logic next tick
            battlesToRemove.push(index);
        } else if (battle.status === 'win_A') { // Blocker sustains
            // Maintain block, reset streaks for next tick's contest
            battle.streakA = 0; battle.streakB = 0;
            // Ensure players stay close - optional: force blocker target to defender pos?
            blockerState.targetX = defenderState.x; blockerState.targetY = defenderState.y;
        } // Draw: Maintain block, streaks already reset

        // Check for disengagement by distance (e.g., if one player moved significantly)
        if (getDistance(blockerState, defenderState) > BLOCK_ENGAGE_RANGE + 0.5) {
             battle.status = 'disengaged';
             blockerState.engagedWith = null;
             defenderState.isBlocked = false; defenderState.blockedBy = null; defenderState.isEngaged = false;
             battlesToRemove.push(index);
             // gameLog.push(`${blockerState.name} and ${defenderState.name} disengaged.`); // Optional log
        }
    });

    // Remove completed/disengaged battles (iterate backwards)
    for (let i = battlesToRemove.length - 1; i >= 0; i--) {
        playState.blockBattles.splice(battlesToRemove[i], 1);
    }
}


/**
 * Handles QB decision-making (throw, scramble, checkdown). (Simplified)
 * Modifies playState (ballState, activePlayers actions).
 */
function updateQBDecision(playState, offenseStates, defenseStates, gameLog) {
    const qbState = offenseStates.find(p => p.slot === 'QB1' && p.hasBall);
    if (!qbState || playState.ballState.inAir) return; // Only QB with ball decides

    const qbPlayer = game.players.find(p => p && p.id === qbState.id);
    if (!qbPlayer) return; // Need original player for stats

    // 1. Check Pressure (using block status and proximity)
    const pressureDefender = defenseStates.find(d => !d.isBlocked && getDistance(qbState, d) < 4.0); // Simple proximity check
    const isPressured = !!pressureDefender;
    // Check for imminent sack (defender very close)
    const imminentSackDefender = isPressured && getDistance(qbState, pressureDefender) < TACKLE_RANGE;

    // 2. Scan Receivers for Openness
    const receivers = offenseStates.filter(p => p.action === 'run_route');
    let openReceivers = [];
    receivers.forEach(recState => {
         const closestDefender = defenseStates
             .filter(d => !d.isBlocked && !d.isEngaged) // Available defenders
             .sort((a, b) => getDistance(recState, a) - getDistance(recState, b))[0];
         const separation = closestDefender ? getDistance(recState, closestDefender) : 100; // Effectively infinite if no one near

         if (separation > SEPARATION_THRESHOLD) {
             openReceivers.push({ ...recState, separation });
         }
    });
    openReceivers.sort((a, b) => b.y - a.y); // Prioritize deeper open receivers

    // 3. Decision Time / Logic
    // QB holds ball longer based on IQ, shorter if pressured
    const qbDecisionTimeTicks = Math.max(8, Math.round( (100 - (qbState.playbookIQ || 50)) / 5 ) ); // ~1.2s to ~10s
    const pressureModifier = isPressured ? 0.5 : 1.0; // Decide faster under pressure
    let decisionMade = false;

    if (imminentSackDefender) { // Must act NOW
         decisionMade = true;
    } else if (playState.tick * pressureModifier >= qbDecisionTimeTicks) { // Held ball long enough
         decisionMade = true;
    } else if (openReceivers.length > 0 && Math.random() < 0.3 + (playState.tick / 30)) { // Increasing chance to throw if open
         decisionMade = true;
    }

    if (decisionMade) {
        let targetPlayerState = null;
        // Prioritize throwing if open, less likely under pressure
        if (openReceivers.length > 0 && (!isPressured || Math.random() < 0.7)) {
            targetPlayerState = openReceivers[0]; // Throw to primary open target
        }
        // Scramble if pressured, no open target, and reasonably agile
        else if (isPressured && (qbState.agility || 50) > 60 && Math.random() < 0.6) {
            qbState.action = 'qb_scramble';
            // Simple scramble logic: move away from pressure, slightly upfield
            const pressureXDir = Math.sign(qbState.x - pressureDefender.x);
            qbState.targetX = Math.max(0.1, Math.min(FIELD_WIDTH - 0.1, qbState.x + pressureXDir * 8));
            qbState.targetY = qbState.y + 5;
            qbState.hasBall = false; // No longer holding to throw
            qbState.isBallCarrier = true; // Becomes ball carrier
            playState.ballState.x = qbState.x; playState.ballState.y = qbState.y; // Ball moves with QB
            gameLog.push(`🏃 ${qbState.name} is flushed out and scrambles!`);
            return; // End decision this tick
        }
        // Checkdown / Force throw if no other option
        else if (receivers.length > 0) {
             targetPlayerState = receivers
                .filter(r => r.y > qbState.y) // Only receivers downfield
                .sort((a,b) => getDistance(qbState, a) - getDistance(qbState, b))[0]; // Closest downfield receiver
        }

        if (targetPlayerState) {
            // --- Initiate Throw ---
            gameLog.push(`🏈 ${qbState.name} throws ${isPressured ? 'under pressure ' : ''}to ${targetPlayerState.name}...`);
            playState.ballState.inAir = true;
            playState.ballState.targetPlayerId = targetPlayerState.id;
            qbState.hasBall = false;

            // --- Basic Ball Physics (Needs Tuning) ---
            // Aim slightly ahead of receiver's current target to lead them
            const leadFactor = 0.5; // How much to lead (adjust based on speed/distance)
            const targetX = targetPlayerState.targetX;
            const targetY = targetPlayerState.targetY; // Could adjust based on receiver speed/vector
            const dx = targetX - qbState.x;
            const dy = targetY - qbState.y;
            const distance = Math.sqrt(dx*dx + dy*dy);

            // Accuracy modifier - affects initial velocity slightly
            const accuracy = qbPlayer.attributes.technical?.throwingAccuracy || 50;
            const accuracyRoll = (100 - accuracy) / 100; // 0.01 to 0.5
            const xError = getRandomInt(-5, 5) * accuracyRoll;
            const yError = getRandomInt(-5, 5) * accuracyRoll;

            // Simple air time based on distance (e.g., 25-30 yd/sec effective speed)
            const throwSpeedYPS = 25 + (qbPlayer.attributes.physical?.strength || 50) / 10; // Add strength influence
            const airTime = Math.max(0.3, distance / throwSpeedYPS);

            playState.ballState.vx = (dx / airTime) + xError;
            playState.ballState.vy = (dy / airTime) + yError;
            playState.ballState.vz = Math.min(15, 5 + distance / 3) / airTime; // Higher arc for longer throws
            // --- End Ball Physics ---

        } else if (imminentSackDefender) {
             // If sack is imminent and no throw target found, it becomes a sack
             // Sack logic handled by checkTackleCollisions covering the QB
             gameLog.push(`⏳ ${qbState.name} holds it too long...`);
        } else {
             // No target, but not immediately sacked -> Throw away
             gameLog.push(`⤴️ ${qbState.name} feels the pressure and throws it away!`);
             playState.incomplete = true;
             playState.playIsLive = false;
             playState.ballState.inAir = false; // Ensure ball isn't tracked
             qbState.hasBall = false;
        }

    } else if (isPressured && qbState.action === 'qb_setup') {
        // If pressured but hasn't decided yet, try evasive movement
        const pressureDirX = Math.sign(qbState.x - pressureDefender.x);
        qbState.targetX = qbState.x + pressureDirX * 1.5; // Step away more decisively
        qbState.targetY = qbState.y - 0.3; // Small step back/sideways
    }
}


/**
 * Handles ball arrival at target coordinates. Checks for catch, INT, or incomplete.
 * Modifies playState.
 */
/**
 * Handles ball arrival at target coordinates. Checks for catch, INT, or incomplete.
 * Modifies playState.
 */
/**
 * Handles ball arrival at target coordinates. Checks for catch, INT, or incomplete.
 * Modifies playState. Allows for INT returns.
 */
function handleBallArrival(playState, gameLog) {
    // Ball arrival check adjusted for Z coordinate (height)
    if (!playState.ballState.inAir || playState.ballState.z > 2.5 || playState.ballState.z < 0.2) return; // Ball must be catchable height

    const targetPlayerState = playState.activePlayers.find(p => p.id === playState.ballState.targetPlayerId);
    // Safety check: If target disappeared, mark incomplete
    if (!targetPlayerState) {
         gameLog.push("Ball arrives, but target receiver not found! Incomplete.");
         playState.incomplete = true; playState.playIsLive = false; playState.ballState.inAir = false; return;
    }

    // Find players (offense and defense) near the ball's arrival point
    const playersNearBall = playState.activePlayers.filter(p =>
        getDistance(p, playState.ballState) < CATCH_RADIUS + (p.isOffense ? 0 : 0.75) // Slightly larger radius for defenders
    ).sort((a,b) => getDistance(a, playState.ballState) - getDistance(b, playState.ballState)); // Closest first

    const intendedReceiver = playersNearBall.find(p => p.id === targetPlayerState.id);
    const closestDefender = playersNearBall.find(p => !p.isOffense);

    let interception = false;
    let interceptorState = null;
    let catchMade = false;

    // Check for Interception first
    if (closestDefender) {
        const defenderPlayer = game.players.find(p=>p && p.id === closestDefender.id); // Get original player for stats
        if (defenderPlayer) {
            const defenderCatchPower = (defenderPlayer.attributes.technical?.catchingHands || 30) * closestDefender.fatigueModifier;
            const proximityAdvantage = intendedReceiver ? getDistance(closestDefender, playState.ballState) < getDistance(intendedReceiver, playState.ballState) : true;
            if ((defenderCatchPower / 100) > (Math.random() * (proximityAdvantage ? 0.7 : 1.5))) { // Adjusted chances slightly
                 interception = true;
                 interceptorState = closestDefender;
            }
        }
    }

    // --- Process Outcome ---
    if (interception && interceptorState) {
        const interceptorPlayer = game.players.find(p=>p && p.id === interceptorState.id);
        gameLog.push(`❗ INTERCEPTION by ${interceptorState.name}! He's looking to return it!`);
        playState.turnover = true;
        // **REMOVE: playState.playIsLive = false;** // Keep play live for return

        // --- Set up Interception Return ---
        // Make interceptor the ball carrier
        interceptorState.isBallCarrier = true;
        interceptorState.hasBall = true;
        interceptorState.action = 'run_path'; // Switch action to running
        // Set target towards the opponent's endzone (low Y values)
        interceptorState.targetY = 5; // Aim for the 5-yard line of the offense's side
        // Keep current X or aim slightly towards middle/sideline based on field position? Simple: keep current X path initially.
        interceptorState.targetX = interceptorState.x;

        // Update former offensive players to pursue
        playState.activePlayers.forEach(p => {
            if (p.isOffense) {
                p.action = 'pursuit'; // Change action for AI targeting
                p.hasBall = false; // Ensure QB/receiver no longer marked hasBall
                p.isBallCarrier = false;
            } else {
                 p.isBallCarrier = (p.id === interceptorState.id); // Ensure only interceptor is carrier
                 p.hasBall = (p.id === interceptorState.id);
                 // Other defenders could switch to 'block_return' action here if desired
            }
        });
        // --- End INT Return Setup ---

         if (interceptorPlayer) { // Safely update stats
             if (!interceptorPlayer.gameStats) interceptorPlayer.gameStats = {};
             interceptorPlayer.gameStats.interceptions = (interceptorPlayer.gameStats.interceptions || 0) + 1;
        }
        // Play continues in the tick loop, tackle checks will apply to the interceptor

    } else if (intendedReceiver && getDistance(intendedReceiver, playState.ballState) < CATCH_RADIUS) {
        // Catch attempt by receiver (only if not intercepted)
        const receiverPlayer = game.players.find(p=>p && p.id === intendedReceiver.id);
        if (receiverPlayer) {
            const receiverCatchPower = (receiverPlayer.attributes.technical?.catchingHands || 50) * intendedReceiver.fatigueModifier;
            const defenderInterference = closestDefender ? ( (closestDefender.agility || 50) + (closestDefender.playbookIQ || 50) ) / 2 * closestDefender.fatigueModifier : 0;
            const catchDiff = receiverCatchPower - (defenderInterference + getRandomInt(-15, 25));

            if (catchDiff > 5) { // Catch!
                 catchMade = true;
                 intendedReceiver.isBallCarrier = true; intendedReceiver.hasBall = true;
                 playState.yards = intendedReceiver.y - playState.lineOfScrimmage; // Air yards (updated by YAC)
                 gameLog.push(`👍 Caught by ${intendedReceiver.name} at y=${intendedReceiver.y.toFixed(1)}! (Air Yards: ${playState.yards.toFixed(1)})`);
                 // Stat update in finalizeStats
            } else { // Dropped / Defended
                 gameLog.push(`❌ INCOMPLETE pass to ${intendedReceiver.name}. ${closestDefender ? `Defended by ${closestDefender.name}.` : 'Dropped.'}`);
                 playState.incomplete = true; playState.playIsLive = false;
            }
        } else { // Error case
            gameLog.push("Error finding receiver for catch check. Incomplete.");
            playState.incomplete = true; playState.playIsLive = false;
        }
    } else { // Ball arrived, no one caught it
         gameLog.push(`‹‹ Pass falls incomplete near ${targetPlayerState?.name || 'target area'}.`);
         playState.incomplete = true; playState.playIsLive = false;
    }

    playState.ballState.inAir = false; // Ball event resolved
} // --- End handleBallArrival ---
/**
 * Updates player stats based on the final play outcome. (Simplified)
 */
/**
 * Updates player game stats based on the final play outcome.
 * @param {object} playState - The final state of the play.
 * @param {object} offense - The offensive team object (for finding players).
 * @param {object} defense - The defensive team object (for finding players).
 */
function finalizeStats(playState, offense, defense) {
     // Find players involved using their IDs stored in playState if possible, or fallback
     const qbState = playState.activePlayers.find(p => p.isOffense && p.slot?.startsWith('QB'));
     const carrierState = playState.activePlayers.find(p => p.isBallCarrier); // Who ended with the ball (or was tackled)
     const throwerState = playState.activePlayers.find(p => p.id === playState.ballState.throwerId); // ID of QB who threw (set in updateQBDecision)
     const receiverState = playState.activePlayers.find(p => p.id === playState.ballState.targetPlayerId && p.isOffense); // Intended receiver
     const interceptorState = playState.turnover && !playState.sack ? playState.activePlayers.find(p => p.isBallCarrier && !p.isOffense) : null; // Defender who ended with ball
     // Sacker/Tackler stats are generally updated during checkTackleCollisions

     // Get original player objects to update stats
     const qbPlayer = throwerState ? game.players.find(p => p && p.id === throwerState.id) : null;
     const carrierPlayer = carrierState ? game.players.find(p => p && p.id === carrierState.id) : null;
     const receiverPlayer = receiverState ? game.players.find(p => p && p.id === receiverState.id) : null;
     const interceptorPlayer = interceptorState ? game.players.find(p => p && p.id === interceptorState.id) : null;

     // Ensure gameStats objects exist
     const ensureStats = (player) => { if (player && !player.gameStats) player.gameStats = { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0, sacks: 0, interceptions: 0, passAttempts: 0, passCompletions: 0, interceptionsThrown: 0 }; };
     ensureStats(qbPlayer);
     ensureStats(carrierPlayer);
     ensureStats(receiverPlayer);
     ensureStats(interceptorPlayer);

     // --- Update stats based on outcome ---

     // QB Pass Attempt stats (regardless of outcome, if a throw was initiated)
     if (qbPlayer && playState.ballState.throwInitiated) { // Need to set 'throwInitiated' in updateQBDecision
         qbPlayer.gameStats.passAttempts = (qbPlayer.gameStats.passAttempts || 0) + 1;
     }

     if (playState.sack) {
         // Sack stats (tackles/sacks) are usually assigned in checkTackleCollisions when QB is tackled
         // Could potentially add QB stat for 'times sacked' here if needed
     } else if (playState.turnover) {
         // Interception Thrown stat for QB
         if (interceptorPlayer && qbPlayer) { // Check it was likely an INT thrown
             qbPlayer.gameStats.interceptionsThrown = (qbPlayer.gameStats.interceptionsThrown || 0) + 1;
         }
         // Fumble stats (forced/recovered) would need more tracking during checkFumble/collisions
     } else if (playState.incomplete) {
         // Pass attempt already counted above
     } else if (carrierPlayer) { // Positive play (Run or completed pass)
         const finalYards = Math.round(playState.yards);
         const isTouchdown = playState.touchdown;

         // Check if it was a completed pass (carrier was the intended receiver and throw happened)
         const wasPassCaught = carrierState.id === receiverState?.id && playState.ballState.throwInitiated;

         if (wasPassCaught && receiverPlayer) { // Passing Play stats
             // Receiver stats
             receiverPlayer.gameStats.receptions = (receiverPlayer.gameStats.receptions || 0) + 1;
             receiverPlayer.gameStats.recYards = (receiverPlayer.gameStats.recYards || 0) + finalYards;
             if (isTouchdown) receiverPlayer.gameStats.touchdowns = (receiverPlayer.gameStats.touchdowns || 0) + 1;

             // QB stats for completion
             if (qbPlayer) {
                 qbPlayer.gameStats.passCompletions = (qbPlayer.gameStats.passCompletions || 0) + 1;
                 qbPlayer.gameStats.passYards = (qbPlayer.gameStats.passYards || 0) + finalYards; // Air + YAC
                 if (isTouchdown) qbPlayer.gameStats.touchdowns = (qbPlayer.gameStats.touchdowns || 0) + 1;
             }
         } else { // Running Play stats (includes QB scrambles, designed runs, INT returns if carrier is defender)
             // Only add rush yards if the carrier is offensive, otherwise it's return yards (not tracked yet)
             if (carrierState.isOffense) {
                  carrierPlayer.gameStats.rushYards = (carrierPlayer.gameStats.rushYards || 0) + finalYards;
                  if (isTouchdown) carrierPlayer.gameStats.touchdowns = (carrierPlayer.gameStats.touchdowns || 0) + 1;
             } else {
                 // Could track INT return yards here if desired
                 // e.g., interceptorPlayer.gameStats.intReturnYards = ...
             }
         }
     }
     // Tackle stats are assigned during checkTackleCollisions
     // INT stats (for defender) assigned during handleBallArrival
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
    if (!play) { /* ... failsafe ... */ }
    const { type, assignments } = play;

    // 1. Initialize Play State
    const playState = {
        playIsLive: true, tick: 0, maxTicks: 100, // ~15 seconds max play time
        yards: 0, touchdown: false, turnover: false, incomplete: false, sack: false,
        ballState: { x: 0, y: 0, z: 1.0, vx: 0, vy: 0, vz: 0, targetPlayerId: null, inAir: false },
        lineOfScrimmage: 0, activePlayers: [], blockBattles: [],
    };

    // 2. Setup Initial Player States & Positions
    try {
        playState.lineOfScrimmage = ballOn + 10;
        setupInitialPlayerStates(playState, offense, defense, play, assignments, ballOn);
        // gameLog.push(`Snap! Ball at y=${playState.lineOfScrimmage.toFixed(1)}. Play: ${playKey}`);
    } catch (setupError) { /* ... error handling ... */ }

    if (playState.activePlayers.length < offense.roster.length + defense.roster.length) { // Basic check for enough players
         // Refine check based on required personnel? 7 players minimum?
         if(playState.activePlayers.length < MIN_HEALTHY_PLAYERS * 2 - 4 ) { // Heuristic check
              gameLog.push("Not enough players found during setup. Turnover.");
              return { yards: 0, turnover: true, incomplete: false, touchdown: false, log: gameLog };
         }
    }


    // --- 3. TICK LOOP ---
    while (playState.playIsLive && playState.tick < playState.maxTicks) {
        playState.tick++;
        const timeDelta = TICK_DURATION_SECONDS;

        // Separate lists for easier processing
        const offenseStates = playState.activePlayers.filter(p => p.isOffense);
        const defenseStates = playState.activePlayers.filter(p => !p.isOffense);
        let ballCarrierState = playState.activePlayers.find(p => p.isBallCarrier); // May change mid-play

        // A. Update Player Intentions/Targets (AI)
        updatePlayerTargets(playState, offenseStates, defenseStates, ballCarrierState, type, assignments);

        // B. Update Player Positions (Movement)
        playState.activePlayers.forEach(p => updatePlayerPosition(p, timeDelta));

        // C. Update Ball Position (if in air)
        if (playState.ballState.inAir) {
            playState.ballState.x += playState.ballState.vx * timeDelta;
            playState.ballState.y += playState.ballState.vy * timeDelta;
            playState.ballState.z += playState.ballState.vz * timeDelta;
            playState.ballState.vz -= 9.8 * timeDelta * timeDelta; // Simple gravity (adjust multiplier if needed)
             // Check if ball hit ground
             if (playState.ballState.z <= 0.1 && playState.tick > 2) { // Allow tiny time for catch
                 // gameLog.push("Ball hits the ground."); // Can be noisy
                 playState.incomplete = true; playState.playIsLive = false; playState.ballState.inAir = false;
                 break; // End play
             }
        } else if (ballCarrierState) {
            // Ball moves with carrier
            playState.ballState.x = ballCarrierState.x;
            playState.ballState.y = ballCarrierState.y;
            playState.ballState.z = 0.5;
        }


        // D. Check Collisions & Initiate Battles/Actions
        if (playState.playIsLive) {
            checkBlockCollisions(playState); // Check block engagements
            ballCarrierState = playState.activePlayers.find(p => p.isBallCarrier); // Update carrier ref
            if (ballCarrierState) {
                if (checkTackleCollisions(playState, gameLog)) break; // Play ended (tackle/fumble)
            }
            if (playState.ballState.inAir && playState.ballState.z <= 2.5 && playState.ballState.z > 0.1) { // Check ball arrival height
                handleBallArrival(playState, gameLog);
                if (!playState.playIsLive) break; // Play ended
            }
        }

        // E. Resolve Ongoing Battles (Blocks)
        if (playState.playIsLive) {
            resolveOngoingBlocks(playState, gameLog);
        }

        // F. QB Logic (Decide Throw/Scramble)
        if (playState.playIsLive && type === 'pass' && !playState.ballState.inAir && !playState.turnover && !playState.sack) {
             updateQBDecision(playState, offenseStates, defenseStates, gameLog);
             if (!playState.playIsLive) break; // Play ended
        }

        // G. Check End Conditions (TD, OOB, Sack check via tackle)
        if (playState.playIsLive) {
            ballCarrierState = playState.activePlayers.find(p => p.isBallCarrier); // Update carrier ref
            if (ballCarrierState) {
                // TD Check (crossing goal line plane at y=110)
                if (ballCarrierState.y >= FIELD_LENGTH - 10) {
                    playState.yards = FIELD_LENGTH - 10 - playState.lineOfScrimmage; // Yards needed for TD
                    playState.touchdown = true; playState.playIsLive = false;
                    // Find player who scored for log
                    const scorer = game.players.find(p=>p && p.id === ballCarrierState.id);
                    gameLog.push(`🎉 TOUCHDOWN ${scorer?.name || 'player'}!`);
                    break;
                }
                // Out of Bounds Check
                if (ballCarrierState.x <= 0.1 || ballCarrierState.x >= FIELD_WIDTH - 0.1) {
                    playState.yards = ballCarrierState.y - playState.lineOfScrimmage;
                    playState.playIsLive = false;
                    gameLog.push(` sideline... ${ballCarrierState.name} ran out of bounds after a gain of ${playState.yards.toFixed(1)} yards.`);
                    break;
                }
            }
            // Sack Check (QB tackled behind LOS while having ball - handled by tackle check)
            const qbState = offenseStates.find(p => p.slot === 'QB1');
            // If QB was tackled (playIsLive is false) AND ball didn't get thrown AND QB was behind LoS
             if (!playState.playIsLive && !playState.ballState.inAir && qbState && qbState.id === playState.activePlayers.find(p => p.isEngaged)?.id /* Needs better sacker tracking */ && qbState.y < playState.lineOfScrimmage) {
                  playState.sack = true;
                  playState.yards = qbState.y - playState.lineOfScrimmage; // Calculate loss
                  // Sack message/stat already handled in checkTackleCollisions if QB is carrier
             }
        }

// H. Update Fatigue
        playState.activePlayers.forEach(pState => {
            if (!pState) return; // Safety check

            let fatigueGain = 0.1; // Base fatigue gain per tick for just being on the field

            // Increase fatigue for strenuous actions
            const action = pState.action;
            if (action === 'run_path' || action === 'qb_scramble' || action === 'run_route' ||
                action === 'pass_rush' || action === 'blitz_gap' || action === 'blitz_edge' ||
                action === 'def_pursuit' || assignment?.startsWith('man_cover_')) { // Added pursuit/man coverage
                fatigueGain += 0.3; // Extra fatigue for sustained running/rushing/coverage
            } else if (action === 'pass_block' || action === 'run_block' || pState.engagedWith) {
                fatigueGain += 0.2; // Extra fatigue for blocking/fighting blocks
            }

            // Find the original player object in the main 'game.players' list to update permanent fatigue
            const player = game.players.find(p => p && p.id === pState.id);
            if (player) {
                // Add fatigue, cap at 100
                player.fatigue = Math.min(100, (player.fatigue || 0) + fatigueGain);
                
                // Re-calculate and update the fatigueModifier in the *temporary* play state
                // This ensures fatigue from this tick affects calculations in the *next* tick
                const stamina = player.attributes?.physical?.stamina || 50; // Default stamina if missing
                // Use the existing formula: fatigue effect scales with stamina
                // (e.g., 90 stamina takes 270 fatigue points to hit 0.3 modifier, 30 stamina takes 90)
                pState.fatigueModifier = Math.max(0.3, (1 - (player.fatigue / (stamina * 3))));
            }
        });


    } // --- End TICK LOOP ---

    // --- 4. Finalize Results ---
    if (playState.playIsLive && !playState.touchdown) { // If loop finished by time limit
        ballCarrierState = playState.activePlayers.find(p => p.isBallCarrier);
        if (ballCarrierState) {
             playState.yards = ballCarrierState.y - playState.lineOfScrimmage;
             gameLog.push(`⏱️ Play ends. Gain of ${playState.yards.toFixed(1)} yards.`);
        } else if (!playState.sack && !playState.turnover) { // Assume incomplete if no other outcome
             playState.incomplete = true; playState.yards = 0;
             gameLog.push("⏱️ Play ends, incomplete.");
        } else { // Sack/Turnover already ended play and set yards/flags
             gameLog.push("⏱️ Play ends.");
        }
    }

    // Adjust yards, ensure correct values for outcomes
    playState.yards = Math.round(playState.yards);
    if(playState.sack) { playState.yards = Math.min(0, playState.yards); } // Ensure sack yards are <= 0
    if(playState.incomplete || playState.turnover) playState.yards = 0;
    if(playState.touchdown) playState.yards = Math.max(0, FIELD_LENGTH - 10 - playState.lineOfScrimmage); // Correct TD yardage

    // Update player game stats
    finalizeStats(playState, offense, defense);

    return {
        yards: playState.yards,
        touchdown: playState.touchdown,
        turnover: playState.turnover,
        incomplete: playState.incomplete,
        log: gameLog // Pass back the potentially modified log
    };
}

// game.js

// ... (All code from Parts 1-3: imports, constants, helpers, resolvePlay, etc.) ...


// =============================================================
// --- GAME SIMULATION ---
// =============================================================

/**
 * Determines the defensive play call. (NEEDS FULL IMPLEMENTATION)
 * @param {object} defense - The defensive team object.
 * @param {object} offense - The offensive team object.
 * @param {number} down - Current down.
 * @param {number} yardsToGo - Yards to first down.
 * @param {number} ballOn - Current yard line (0-100 territory).
 * @param {Array} gameLog - The game log array.
 * @returns {string} The key of the chosen defensive play (e.g., 'Cover_2_Zone').
 */
/**
 * Determines the defensive play call based on situation, personnel, and coach tendencies.
 * @param {object} defense - The defensive team object.
 * @param {object} offense - The offensive team object.
 * @param {number} down - Current down (1-4).
 * @param {number} yardsToGo - Yards needed for a first down.
 * @param {number} ballOn - Current yard line (0-100 territory, 100 = opponent goal line).
 * @param {Array} gameLog - The game log array.
 * @returns {string} The key of the chosen defensive play (e.g., 'Cover_2_Zone').
 */
/**
 * Determines the offensive play call based on situation, personnel, and coach tendencies.
 * @param {object} offense - The offensive team object.
 * @param {object} defense - The defensive team object.
 * @param {number} down - Current down (1-4).
 * @param {number} yardsToGo - Yards needed for a first down.
 * @param {number} ballOn - Current yard line (0-100 territory).
 * @param {number} scoreDiff - Offense score minus defense score.
 * @param {Array} gameLog - The game log array.
 * @param {number} drivesRemaining - Approx drives left in game.
 * @returns {string} The key of the chosen offensive play (e.g., 'Balanced_InsideRun').
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

    // Failsafe if formation data is missing
    if (!offenseFormation?.personnel || !defenseFormation?.personnel) {
        console.error(`CRITICAL ERROR: Formation data missing for ${offense.name} (${offenseFormationName}) or ${defense.name} (${defenseFormationName}).`);
        return 'Balanced_InsideRun'; // Absolute failsafe play
    }

    // Get key offensive players
    const usedIds = new Set();
    const qb = getPlayerBySlot(offense, 'offense', 'QB1', usedIds) || findEmergencyPlayer('QB', offense, 'offense', usedIds)?.player;
    const rb = getPlayerBySlot(offense, 'offense', 'RB1', usedIds) || findEmergencyPlayer('RB', offense, 'offense', usedIds)?.player;
    const qbStrength = qb ? calculateOverall(qb, 'QB') : 0;
    const rbStrength = rb ? calculateOverall(rb, 'RB') : 0;

    // --- Base Pass Chance & Adjustments ---
    let passChance = 0.45; // Default baseline

    // Opponent Formation Awareness
    if (defenseFormation) {
        const defPersonnel = defenseFormation.personnel;
        if (defPersonnel.DL >= 4 || (defPersonnel.DL === 3 && defPersonnel.LB >= 3)) { // Heavy box
            passChance += 0.15; // More likely to pass vs run stop
        }
        if (defPersonnel.DB >= 2 || (defPersonnel.DB === 1 && defPersonnel.LB >= 3)) { // More DBs/LBs in coverage
            passChance -= 0.10; // Slightly more likely to run
        }
    }
    // Personnel Mismatches
    if (offenseFormation.personnel.WR > defenseFormation.personnel.DB + 1) passChance += 0.2;
    if (offenseFormation.personnel.RB + offenseFormation.personnel.OL > defenseFormation.personnel.DL + defenseFormation.personnel.LB + 1) passChance -= 0.2;
    // Player Strengths
    if (qbStrength < 50 && rbStrength > 50) passChance -= 0.25;
    if (rbStrength < 50 && qbStrength > 50) passChance += 0.15;
    if (qbStrength > rbStrength + 15) passChance += 0.1;
    if (rbStrength > qbStrength + 15) passChance -= 0.1;

    // Game Situation (Refined)
    const totalDrivesPerHalf = 8; // Approx (needs to match simulateGame)
    const isLateGame = drivesRemaining <= 2;
    const isEndOfHalf = (drivesRemaining % totalDrivesPerHalf === 1 || drivesRemaining % totalDrivesPerHalf === 0) && drivesRemaining <= totalDrivesPerHalf;

    if (down === 3 && yardsToGo > 6) passChance += 0.4;
    else if (down === 4 && yardsToGo > 3) passChance = 0.95;
    else if (yardsToGo <= 2) passChance -= 0.4;

    if (ballOn > 80 && ballOn < 98) passChance += 0.1; // Red zone (not goal line)
    else if (ballOn >= 98) passChance -= 0.2; // Goal line run bias

    if (scoreDiff < -10) passChance += (isLateGame ? 0.3 : 0.2); // Trailing
    if (scoreDiff > 14 && (isLateGame || isEndOfHalf)) passChance -= 0.4; // Leading late
    else if (scoreDiff > 7 && (isLateGame || isEndOfHalf)) passChance -= 0.2;

    // Coach Tendencies
    if (coach.type === 'Ground and Pound') passChance -= 0.3;
    if (coach.type === 'West Coast Offense') passChance += 0.2;
    if (coach.type === 'Spread') passChance += 0.25;

    // Clamp passChance
    passChance = Math.max(0.05, Math.min(0.95, passChance));

    // --- Play Selection ---
    const formationPlays = Object.keys(offensivePlaybook).filter(key => key.startsWith(offenseFormationName));
    if (formationPlays.length === 0) {
        console.error(`CRITICAL: No plays found for formation ${offenseFormationName}!`);
        return 'Balanced_InsideRun';
    }

    // QB Sneak (if defined in playbook for formation)
    if (yardsToGo <= 1 && qbStrength > 60 && Math.random() < 0.6) {
        const sneakPlay = formationPlays.find(p => offensivePlaybook[p]?.zone === ZONES.SNEAK);
        if (sneakPlay) return sneakPlay;
        // Fallback to inside run
    }

    let desiredPlayType = (Math.random() < passChance) ? 'pass' : 'run';
    let possiblePlays = formationPlays.filter(key => offensivePlaybook[key]?.type === desiredPlayType);

    // If no plays of desired type, switch type
    if (possiblePlays.length === 0) {
        desiredPlayType = desiredPlayType === 'pass' ? 'run' : 'pass';
        possiblePlays = formationPlays.filter(key => offensivePlaybook[key]?.type === desiredPlayType);
        if (possiblePlays.length === 0) return formationPlays[0]; // Absolute failsafe
    }

    // --- Sub-selection based on tags ---
    let chosenPlay = null;
    if (desiredPlayType === 'pass') {
        const deepPlays = possiblePlays.filter(p => offensivePlaybook[p]?.tags?.includes('deep'));
        const shortPlays = possiblePlays.filter(p => offensivePlaybook[p]?.tags?.includes('short') || offensivePlaybook[p]?.tags?.includes('screen'));
        const mediumPlays = possiblePlays.filter(p => !offensivePlaybook[p]?.tags?.includes('deep') && !offensivePlaybook[p]?.tags?.includes('short'));

        if (down >= 3 && yardsToGo >= 8 && deepPlays.length > 0) chosenPlay = getRandom(deepPlays);
        else if (down <= 2 && yardsToGo <= 5 && shortPlays.length > 0) chosenPlay = getRandom(shortPlays);
        else if (mediumPlays.length > 0) chosenPlay = getRandom(mediumPlays);
        else chosenPlay = getRandom([...shortPlays, ...deepPlays]); // Fallback

    } else { // Run
        const insidePlays = possiblePlays.filter(p => offensivePlaybook[p]?.tags?.includes('inside'));
        const outsidePlays = possiblePlays.filter(p => offensivePlaybook[p]?.tags?.includes('outside'));
        const powerPlays = possiblePlays.filter(p => offensivePlaybook[p]?.tags?.includes('power'));

        if (yardsToGo <= 2 && powerPlays.length > 0) chosenPlay = getRandom(powerPlays);
        else if (yardsToGo <= 3 && insidePlays.length > 0) chosenPlay = getRandom(insidePlays);
        else if (rbStrength > qbStrength + 10 && Math.random() < 0.6 && outsidePlays.length > 0) chosenPlay = getRandom(outsidePlays);
        else if (insidePlays.length > 0) chosenPlay = getRandom(insidePlays);
        else chosenPlay = getRandom([...outsidePlays, ...powerPlays]); // Fallback
    }

    chosenPlay = chosenPlay || getRandom(possiblePlays) || formationPlays[0]; // Final failsafe
    // gameLog.push(`AI Play Call: ${chosenPlay}`); // Optional log
    return chosenPlay;
}
function determineDefensivePlayCall(defense, offense, down, yardsToGo, ballOn, gameLog) {
    // --- 1. Get Available Plays ---
    const defenseFormationName = defense.formations?.defense || '3-3-1'; // Failsafe
    // Get all play keys available for this formation
    const formationPlays = Object.keys(defensivePlaybook);

    if (formationPlays.length === 0) {
        console.error(`No defensive plays found for formation ${defenseFormationName}!`);
        return 'Cover_2_Zone'; // Absolute failsafe
    }

    // --- 2. Categorize Plays ---
    const categorizedPlays = {
        blitz: [],
        runStop: [],
        zone: [],
        man: []
    };

    formationPlays.forEach(key => {
        const play = defensivePlaybook[key];
        if (!play) return;
        
        if (key.includes('Run_Stop') || play.name.includes('Run Stop')) {
            categorizedPlays.runStop.push(key);
        } else if (play.blitz === true) {
            categorizedPlays.blitz.push(key);
        } else if (play.concept === 'Zone') {
            categorizedPlays.zone.push(key);
        } else if (play.concept === 'Man') {
            categorizedPlays.man.push(key);
        }
    });

    // --- 3. Analyze Situation ---
    // Down & Distance
    const isObviousPass = (down === 3 && yardsToGo >= 7) || (down === 4 && yardsToGo >= 3) || (down === 2 && yardsToGo >= 10);
    const isObviousRun = (yardsToGo <= 2 && down >= 3) || (yardsToGo <= 1);
    const isBalancedSituation = !isObviousPass && !isObviousRun;

    // Field Position
    const isRedZone = ballOn >= 80;

    // Offensive Personnel
    const offFormation = offenseFormations[offense.formations.offense];
    const offPersonnel = offFormation?.personnel || { WR: 2, RB: 1 }; // Default if missing
    const isSpreadOffense = offPersonnel.WR >= 3;
    const isHeavyOffense = offPersonnel.RB >= 2;

    // Coach Tendency
    const coachType = defense.coach?.type || 'Balanced';

    // --- 4. Decision Logic ---
    let preferredPlayTypes = [];

    // Step 1: Handle extreme situations
    if (isObviousRun || (isHeavyOffense && !isObviousPass)) {
        // High chance of run
        preferredPlayTypes.push(...categorizedPlays.runStop, ...categorizedPlays.blitz, ...categorizedPlays.man); // Man can cover PA
    } else if (isObviousPass || isSpreadOffense) {
        // High chance of pass
        preferredPlayTypes.push(...categorizedPlays.zone, ...categorizedPlays.man, ...categorizedPlays.blitz); // Blitz on obvious pass
    } else {
        // Balanced situation
        preferredPlayTypes.push(...categorizedPlays.zone, ...categorizedPlays.man, ...categorizedPlays.runStop);
    }

    // Step 2: Apply Coach Tendency Weights
    if (coachType === 'Blitz-Happy Defense' && categorizedPlays.blitz.length > 0) {
        // Add blitz plays 3 extra times to increase their chance of being picked
        preferredPlayTypes.push(...categorizedPlays.blitz, ...categorizedPlays.blitz, ...categorizedPlays.blitz);
    }
    if (coachType === 'Ground and Pound' && categorizedPlays.runStop.length > 0) { // Defensive focus on run
        preferredPlayTypes.push(...categorizedPlays.runStop, ...categorizedPlays.runStop);
    }
    if (coachType === 'West Coast Offense' && categorizedPlays.zone.length > 0) { // Assume defensive equivalent is zone coverage
        preferredPlayTypes.push(...categorizedPlays.zone, ...categorizedPlays.zone);
    }

    // Step 3: Apply Red Zone Logic
    if (isRedZone) {
        // Red zone often favors tighter Man coverage or compressed Zones, less deep coverage
        // Add extra Man and Zone (underneath) plays
        preferredPlayTypes.push(...categorizedPlays.man, ...categorizedPlays.zone.filter(k => !k.includes('Deep')));
    }

    // --- 5. Select Play ---
    let chosenPlay = null;

    if (preferredPlayTypes.length > 0) {
        // Remove duplicates if any
        const uniquePreferredPlays = [...new Set(preferredPlayTypes)];
        chosenPlay = getRandom(uniquePreferredPlays);
    }

    // Failsafe: If no preferred plays were found (e.g., formation has only one type), pick from all available.
    if (!chosenPlay) {
        chosenPlay = getRandom(formationPlays);
    }

    // gameLog.push(`AI Defense Call: ${chosenPlay} (Situation: ${isObviousPass ? 'Pass' : isObviousRun ? 'Run' : 'Balanced'})`);
    return chosenPlay;
}


/**
 * Simulates a full game between two teams using the coordinate-based engine.
 * @param {object} homeTeam - The home team object.
 * @param {object} awayTeam - The away team object.
 * @returns {object} Result object { homeTeam, awayTeam, homeScore, awayScore, gameLog, breakthroughs }.
 */
export function simulateGame(homeTeam, awayTeam) {
    // --- Initial Game Setup ---
    if (!homeTeam || !awayTeam || !homeTeam.roster || !awayTeam.roster) { // Added roster checks
        console.error("simulateGame: Invalid team data provided.");
        return { homeTeam, awayTeam, homeScore: 0, awayScore: 0, gameLog: ["Error: Invalid team data"], breakthroughs: [] };
    }
    resetGameStats(); // Clear stats from previous game/week
    aiSetDepthChart(homeTeam); // Ensure depth charts are set
    aiSetDepthChart(awayTeam);

    const gameLog = [];
    let homeScore = 0;
    let awayScore = 0;
    const weather = getRandom(['Sunny', 'Windy', 'Rain']);
    gameLog.push(`Weather: ${weather}`);

    const breakthroughs = []; // Track player improvements
    const totalDrivesPerHalf = getRandomInt(7, 9); // Drives per half
    let currentHalf = 1;
    let drivesThisGame = 0;

    // --- Coin Flip for First Possession ---
    gameLog.push("Coin toss to determine first possession...");
    const coinFlipWinner = Math.random() < 0.5 ? homeTeam : awayTeam;
    // Simplified: Winner of toss receives. Team that lost toss receives in 2nd half.
    let possessionTeam = coinFlipWinner;
    let receivingTeamSecondHalf = (possessionTeam.id === homeTeam.id) ? awayTeam : homeTeam;
    gameLog.push(`🪙 ${coinFlipWinner.name} won the toss and will receive the ball first!`);
    // --- End Coin Flip ---

    let gameForfeited = false;
    
    // --- Game Loop (Drives) ---
    while (drivesThisGame < totalDrivesPerHalf * 2 && !gameForfeited) {
        // --- Halftime Logic ---
        if (drivesThisGame === totalDrivesPerHalf) {
            currentHalf = 2;
            gameLog.push(`==== HALFTIME ==== Score: ${awayTeam.name} ${awayScore} - ${homeTeam.name} ${homeScore}`);
            // Team that lost toss (or deferred) receives second half kickoff
            possessionTeam = receivingTeamSecondHalf;
            // Recover some fatigue at halftime
            [...homeTeam.roster, ...awayTeam.roster].forEach(p => { if (p) p.fatigue = Math.max(0, (p.fatigue || 0) - 40); }); // Recover less than full
            gameLog.push(`-- Second Half Kickoff: ${possessionTeam.name} receives --`);
        }

        // Safety check for possession object
        if (!possessionTeam) {
            console.error("Possession team is null or undefined! Ending game loop.");
            gameLog.push("Error: Possession lost. Game ending.");
            break;
        }

        const offense = possessionTeam;
        const defense = (possessionTeam.id === homeTeam.id) ? awayTeam : homeTeam;

        // --- Forfeit Check ---
        const checkRoster = (team) => (team?.roster || []).filter(p => p && p.status?.duration === 0).length < MIN_HEALTHY_PLAYERS;
        if (checkRoster(offense) || checkRoster(defense)) {
            const forfeitingTeam = checkRoster(offense) ? offense : defense;
            const winningTeam = forfeitingTeam === offense ? defense : offense;
            gameLog.push(`❗ ${forfeitingTeam.name} cannot field enough healthy players (${MIN_HEALTHY_PLAYERS}) and forfeits.`);
            if (winningTeam === homeTeam) { homeScore = 21; awayScore = 0; }
            else { homeScore = 0; awayScore = 21; }
            gameForfeited = true;
            break; // End game immediately
        }
        // --- End Forfeit Check ---

        // --- Drive Setup ---
        let ballOn = 20; // Start drive at own 20 yard line (0-100 territory)
        let down = 1;
        let yardsToGo = 10;
        let driveActive = true;
        gameLog.push(`-- Drive ${drivesThisGame + 1} (H${currentHalf}): ${offense.name} ball on own ${ballOn} --`);
        // --- End Drive Setup ---

        // --- Play Loop (Downs) ---
        while (driveActive && down <= 4) {
            // Check for players before calling play
             if (offense.roster.filter(p => p && p.status?.duration === 0).length < MIN_HEALTHY_PLAYERS ||
                 defense.roster.filter(p => p && p.status?.duration === 0).length < MIN_HEALTHY_PLAYERS) {
                  gameLog.push("Forfeit condition met mid-drive."); gameForfeited = true; driveActive = false; break;
             }

            // Log current situation
            const yardLineText = ballOn <= 50 ? `own ${ballOn}` : `opponent ${100 - ballOn}`;
            gameLog.push(`--- ${down}${down === 1 ? 'st' : down === 2 ? 'nd' : down === 3 ? 'rd' : 'th'} & ${yardsToGo <= 0 ? 'Goal' : yardsToGo} from the ${yardLineText} ---`);

            // --- Determine Play Calls ---
            const scoreDiff = offense.id === homeTeam.id ? homeScore - awayScore : awayScore - homeScore;
            const drivesCompletedInHalf = drivesThisGame % totalDrivesPerHalf;
            const drivesRemainingInHalf = totalDrivesPerHalf - drivesCompletedInHalf;
            const drivesRemainingInGame = (currentHalf === 1 ? totalDrivesPerHalf : 0) + drivesRemainingInHalf;
            
            const offensivePlayKey = determinePlayCall(offense, defense, down, yardsToGo, ballOn, scoreDiff, gameLog, drivesRemainingInGame);
            const defensivePlayKey = determineDefensivePlayCall(defense, offense, down, yardsToGo, ballOn, gameLog); // Added defensive call
            // --- End Play Calls ---

            // --- Resolve play using NEW coordinate-based engine ---
            const result = resolvePlay(offense, defense, offensivePlayKey, defensivePlayKey, { gameLog, weather, ballOn });
            // ---

            // Update game state based on play result
            ballOn += result.yards; // BallOn updated based on calculated yards
            ballOn = Math.max(0, Math.min(100, ballOn)); // Clamp ball position (0-100 territory)

            if (result.turnover) {
                // gameLog message already handled in resolvePlay/helpers
                driveActive = false;
            } else if (result.touchdown) {
                // gameLog message already handled in resolvePlay/helpers
                ballOn = 100; // Ensure ball marked correctly
                // Simplified Conversion Attempt
                const goesForTwo = Math.random() > 0.85; // Less likely
                const conversionSuccess = Math.random() > (goesForTwo ? 0.6 : 0.05); // High success for 1pt, ~40% for 2pt
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
                down++; // Advance down on incomplete pass
            } else { // Completed play (run, pass, or sack)
                yardsToGo -= result.yards; // Subtract actual yards gained/lost
                if (yardsToGo <= 0) { // First down achieved
                    down = 1;
                    yardsToGo = Math.min(10, 100 - ballOn); // 1st & 10, or 1st & Goal if inside the 10
                    const newYardLineText = ballOn <= 50 ? `own ${ballOn}` : `opponent ${100 - ballOn}`;
                    gameLog.push(`➡️ First down ${offense.name}! ${yardsToGo < 10 ? `1st & Goal at the ${100 - ballOn}` : `1st & 10 at the ${newYardLineText}`}.`);
                } else { // No first down, advance down
                    down++;
                }
            }

            // Check for turnover on downs
            if (down > 4 && driveActive) {
                const finalYardLineText = ballOn <= 50 ? `own ${ballOn}` : `opponent ${100 - ballOn}`;
                gameLog.push(`✋ Turnover on downs! ${defense.name} takes over at the ${finalYardLineText}.`);
                driveActive = false;
            }
        } // --- End Play Loop (Downs) ---

        drivesThisGame++; // Increment drive count
        // Switch possession for next drive (unless game ended)
        if (drivesThisGame < totalDrivesPerHalf * 2 && !gameForfeited) {
             if (possessionTeam?.id === homeTeam.id) { // Safe access id
                 possessionTeam = awayTeam;
             } else {
                 possessionTeam = homeTeam;
             }
        }

    } // --- End Game Loop (Drives) ---

    // --- Post-Game ---
    gameLog.push(`==== FINAL SCORE ==== ${awayTeam.name} ${awayScore} - ${homeTeam.name} ${homeScore}`);

    // Assign Wins/Losses (handle forfeits correctly)
    if (!gameForfeited) {
        if (homeScore > awayScore) { homeTeam.wins = (homeTeam.wins || 0) + 1; awayTeam.losses = (awayTeam.losses || 0) + 1; }
        else if (awayScore > homeScore) { awayTeam.wins = (awayTeam.wins || 0) + 1; homeTeam.losses = (homeTeam.losses || 0) + 1; }
    } else {
         if (homeScore > awayScore) { homeTeam.wins = (homeTeam.wins || 0) + 1; awayTeam.losses = (awayTeam.losses || 0) + 1; }
         else if (awayScore > homeScore) { awayTeam.wins = (awayTeam.wins || 0) + 1; homeTeam.losses = (homeTeam.losses || 0) + 1; }
    }


    // Post-Game Player Progression & Stat Aggregation
    [...(homeTeam.roster || []), ...(awayTeam.roster || [])].forEach(p => {
        if (!p || !p.gameStats || !p.attributes) return; // Safety checks

        // Simple breakthrough chance
        const perfThreshold = p.gameStats.touchdowns >= 1 || p.gameStats.passYards > 100 || p.gameStats.recYards > 50 || p.gameStats.rushYards > 50 || p.gameStats.tackles > 4 || p.gameStats.sacks >= 1 || p.gameStats.interceptions >= 1;
        if (p.age < 14 && perfThreshold && Math.random() < 0.15) {
            const attributesToImprove = ['speed', 'strength', 'agility', 'throwingAccuracy', 'catchingHands', 'tackling', 'blocking', 'playbookIQ', 'blockShedding', 'toughness', 'consistency'];
            const attr = getRandom(attributesToImprove);
            for (const cat in p.attributes) {
                if (p.attributes[cat]?.[attr] !== undefined && p.attributes[cat][attr] < 99) {
                    p.attributes[cat][attr]++;
                    p.breakthroughAttr = attr; // Flag for UI
                    breakthroughs.push({ player: p, attr, teamName: p.teamId === homeTeam.id ? homeTeam.name : awayTeam.name });
                    break; // Only one breakthrough per game
                }
            }
        }

        // Aggregate game stats into season/career totals
        if(!p.seasonStats) p.seasonStats = {};
        if(!p.careerStats) p.careerStats = { seasonsPlayed: p.careerStats?.seasonsPlayed || 0};
        for (const stat in p.gameStats) {
            if (typeof p.gameStats[stat] === 'number') {
                 p.seasonStats[stat] = (p.seasonStats[stat] || 0) + p.gameStats[stat];
                 p.careerStats[stat] = (p.careerStats[stat] || 0) + p.gameStats[stat];
            }
        }
    });

    return { homeTeam, awayTeam, homeScore, awayScore, gameLog, breakthroughs };
}


// =============================================================
// --- WEEKLY/OFFSEASON PROCESSING ---
// =============================================================

/** Decrements duration of player statuses (injuries, busy). */
function updatePlayerStatuses() {
    if (!game || !game.players) return;
    for (const player of game.players) {
        if (!player || !player.status) continue;
        // Decrement status duration
        if (player.status.duration > 0) {
            player.status.duration--;
            if (player.status.duration === 0) {
                player.status.type = 'healthy';
                player.status.description = '';
                // Optional: Notify player's team if they are now healthy
                 if (player.teamId === game.playerTeam?.id) {
                     addMessage('Player Recovered', `${player.name} is now available.`);
                 }
            }
        }
        // Clear flags
        if (player.breakthroughAttr) delete player.breakthroughAttr;
        if (player.status.isNew) player.status.isNew = false;
    }
}

/** Removes temporary players (friends) at the end of the week. */
function endOfWeekCleanup() {
    if (!game || !game.teams) return;
    game.teams.forEach(team => {
        if (team && team.roster) {
            team.roster = team.roster.filter(p => p && p.status?.type !== 'temporary'); // Safe access status
        }
    });
}

/** Generates random weekly non-game events (injuries, unavailability). */
function generateWeeklyEvents() {
    if (!game || !game.players) return;
    for (const player of game.players) {
        if (!player || !player.status || player.status.type !== 'healthy') continue; // Only affect healthy players

        for (const event of weeklyEvents) {
            if (Math.random() < event.chance) {
                player.status.type = event.type;
                player.status.description = event.description;
                player.status.duration = getRandomInt(event.minDuration, event.maxDuration);
                player.status.isNew = true; // Flag for UI notification
                // Notify player if it's their team member
                if (player.teamId === game.playerTeam?.id) {
                    addMessage('Player Status Update', `${player.name} will be unavailable for ${player.status.duration} week(s): ${player.status.description}`);
                }
                break; // Only one event per player per week
            }
        }
    }
}

/** Processes random relationship changes between players. */
function processRelationshipEvents() {
    if (!game || !game.players || game.players.length < 2) return;
    const numEvents = getRandomInt(1, 3); // 1-3 events per week
    const eventChanceImprove = 0.6; // 60% positive

    for (let i = 0; i < numEvents; i++) {
        // Pick two distinct random players safely
        let p1Index = getRandomInt(0, game.players.length - 1);
        let p2Index = getRandomInt(0, game.players.length - 1);
        let attempts = 0; // Prevent infinite loop if only 1 player somehow exists
        while (p1Index === p2Index && attempts < 10) {
             p2Index = getRandomInt(0, game.players.length - 1); attempts++;
        }
        if (p1Index === p2Index) continue; // Skip if couldn't find distinct players

        const p1 = game.players[p1Index];
        const p2 = game.players[p2Index];
        if (!p1 || !p2) continue; // Safety check

        if (Math.random() < eventChanceImprove) {
            improveRelationship(p1.id, p2.id);
            // Optional: Message if both on player team
            // if (p1.teamId === game.playerTeam?.id && p2.teamId === game.playerTeam?.id) addMessage(...);
        } else {
            decreaseRelationship(p1.id, p2.id);
             // Optional: Message if both on player team
        }
    }
}

/** Simulates all games for the current week and advances state. */
export function simulateWeek() {
    if (!game || !game.teams || !game.schedule) { /* ... error handling ... */ return []; }
    const WEEKS_IN_SEASON = 9; // Use constant
    if (game.currentWeek >= WEEKS_IN_SEASON) { /* ... handle end of season ... */ return null; }

    // Week Start Processing
    endOfWeekCleanup();
    updatePlayerStatuses();
    generateWeeklyEvents();
    game.breakthroughs = []; // Reset weekly breakthroughs

    // Get games for the week
    const gamesPerWeek = game.teams.length / 2;
    const startIndex = game.currentWeek * gamesPerWeek;
    const endIndex = startIndex + gamesPerWeek;
    const weeklyGames = game.schedule.slice(startIndex, endIndex);

    if (!weeklyGames || weeklyGames.length === 0) { /* ... error handling ... */ }

    // Simulate games
    const results = weeklyGames.map(match => {
        try {
            if (!match?.home || !match?.away) { /* ... skip invalid match ... */ return null; }
            const result = simulateGame(match.home, match.away); // Calls new sim engine
             if (result?.breakthroughs) { // Process breakthroughs safely
                 result.breakthroughs.forEach(b => {
                     if (b?.player?.teamId === game.playerTeam?.id) {
                         addMessage("Player Breakthrough!", `${b.player.name} improved ${b.attr}!`);
                     }
                 });
                 if (!game.breakthroughs) game.breakthroughs = [];
                 game.breakthroughs.push(...result.breakthroughs);
             }
            return result;
        } catch (error) { /* ... error handling ... */ return null; }
    }).filter(Boolean); // Filter out nulls

    // Add results and process relationship events
    if (!game.gameResults) game.gameResults = [];
    game.gameResults.push(...results);
    processRelationshipEvents(); // Process relationship changes after the week's games

    game.currentWeek++; // Advance week counter
    console.log(`Week ${game.currentWeek} simulation complete. Advanced to week ${game.currentWeek + 1}.`);
    return results;
}

// game.js - PART 5/5

// ... (Imports, Constants, Core Helpers, Initialization, Draft, Scheduling, Play Simulation Core from Parts 1-4) ...

// =============================================================
// --- FREE AGENCY & ROSTER MANAGEMENT ---
// =============================================================

/** Generates a list of available free agents for the week (no longer assigns random relationship). */
export function generateWeeklyFreeAgents() {
    if (!game || !game.players) { console.error("generateWeeklyFreeAgents: Game not initialized."); return; }
    // Find players without a team safely
    const undraftedPlayers = game.players.filter(p => p && !p.teamId);
    game.freeAgents = []; // Clear previous week's FAs
    const numFreeAgents = 5; // Offer 5 FAs per week

    for (let i = 0; i < numFreeAgents; i++) {
        if (undraftedPlayers.length > 0) {
            // Select a random undrafted player
            const faIndex = getRandomInt(0, undraftedPlayers.length - 1);
            const fa = undraftedPlayers.splice(faIndex, 1)[0]; // Remove from pool
            if (!fa) continue; // Skip if splice failed unexpectedly
            // Relationship is now determined globally, no need to assign here
            game.freeAgents.push(fa);
        } else {
            break; // Stop if no more undrafted players
        }
    }
    // console.log(`Generated ${game.freeAgents.length} free agents for the week.`); // Optional log
}

/**
 * Handles the player attempting to call a free agent friend.
 * Success chance depends on highest relationship level with player's roster.
 */
export function callFriend(playerId) {
    if (!game || !game.playerTeam || !game.playerTeam.roster || !game.freeAgents) {
        console.error("Cannot call friend: Invalid game state.");
        return { success: false, message: "Game state error prevented calling friend." };
    }
    const team = game.playerTeam;
    // Condition: Can only call if someone is injured/busy
    if (!team.roster.some(p => p && p.status?.duration > 0)) {
        return { success: false, message: "You can only call a friend if a player on your team is currently injured or busy." };
    }

    const player = game.freeAgents.find(p => p && p.id === playerId); // Added p check
    if (!player) return { success: false, message: "That player is no longer available this week." };

    // Determine success chance based on highest relationship with player's roster
    const maxLevel = team.roster.reduce(
        (max, rosterPlayer) => Math.max(max, getRelationshipLevel(rosterPlayer?.id, playerId)), // Safe access rosterPlayer.id
        relationshipLevels.STRANGER.level
    );
    const relationshipInfo = Object.values(relationshipLevels).find(rl => rl.level === maxLevel) || relationshipLevels.STRANGER;
    const successChance = relationshipInfo.callChance;
    const relationshipName = relationshipInfo.name;

    // Remove player from free agents regardless of success
    game.freeAgents = game.freeAgents.filter(p => p && p.id !== playerId); // Added p check

    if (Math.random() < successChance) {
        // Success: Add player temporarily
        player.status = { type: 'temporary', description: 'Helping Out', duration: 1 };
        if (addPlayerToTeam(player, team)) { // Use helper to add
            // Improve relationship between called player and *all* current roster members slightly
            team.roster.forEach(rosterPlayer => {
                if (rosterPlayer && rosterPlayer.id !== player.id) { // Don't improve self relationship
                     improveRelationship(rosterPlayer.id, player.id);
                }
            });
            const message = `${player.name} (${relationshipName}) agreed to help out for the next game!`;
            addMessage("Roster Update: Friend Called", message);
            return { success: true, message };
        } else {
            // Should not happen if addPlayerToTeam is robust
            return { success: false, message: `Failed to add ${player.name} to roster even after successful call.` };
        }
    } else {
        // Failure
        const message = `${player.name} (${relationshipName}) couldn't make it this week.`;
        addMessage("Roster Update: Friend Called", message);
        return { success: false, message };
    }
}


/**
 * AI logic for signing temporary free agents if roster is short.
 * Will sign players until minimum is met or FAs run out.
 */
export function aiManageRoster(team) {
    if (!team || !team.roster || !game || !game.freeAgents || !team.coach) return; // Safety checks
    // Use constant for minimum players
    let healthyCount = team.roster.filter(p => p && p.status?.duration === 0).length;

    // Loop while below minimum and FAs are available
    while (healthyCount < MIN_HEALTHY_PLAYERS && game.freeAgents.length > 0) {
        // Find the best available FA based on coach preference (safe access player data)
        const bestFA = game.freeAgents
          .filter(p => p) // Filter out invalid FAs first
          .reduce((best, current) => {
              if (!best) return current; // Handle initial case
              return getPlayerScore(current, team.coach) > getPlayerScore(best, team.coach) ? current : best;
          }, null); // Start with null

        if (!bestFA) break; // No valid FAs left

        // AI uses relationship for success chance (using team's average relationship?)
        // Simplified: Use coach preference score as a proxy for willingness? Or fixed chance?
        // Let's use a fixed moderate chance for AI signing temps for now.
        const aiSuccessChance = 0.5;

        // Remove FA from pool regardless of success
        game.freeAgents = game.freeAgents.filter(p => p && p.id !== bestFA.id);

        if (Math.random() < aiSuccessChance) {
            bestFA.status = { type: 'temporary', description: 'Helping Out', duration: 1 };
            if (addPlayerToTeam(bestFA, team)) { // Use helper
                 healthyCount++; // Increment count
                 console.log(`${team.name} signed temporary player ${bestFA.name}`);
            } // else failed to add (log?)
        } else {
             console.log(`${team.name} failed to sign temporary player ${bestFA.name}.`);
        }
    }
    // After signing temps (if any), reset depth chart
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

    // Base points decrease with age
    let basePoints = 0;
    if (player.age <= 12) basePoints = getRandomInt(3, 5);
    else if (player.age <= 14) basePoints = getRandomInt(2, 4);
    else if (player.age <= 16) basePoints = getRandomInt(1, 2);
    else basePoints = getRandomInt(0, 1); // 17+

    let potentialPoints = Math.max(0, Math.round(basePoints * potentialMultiplier));
    const attributesToImprove = ['speed', 'strength', 'agility', 'throwingAccuracy', 'catchingHands', 'tackling', 'blocking', 'playbookIQ', 'blockShedding', 'toughness', 'consistency'];

    // Distribute points
    for (let i = 0; i < potentialPoints; i++) {
        const attrToBoost = getRandom(attributesToImprove);
        let boosted = false;
        for (const category in player.attributes) {
            if (player.attributes[category]?.[attrToBoost] !== undefined && player.attributes[category][attrToBoost] < 99) {
                const increase = 1; // Simple +1
                if (increase > 0) {
                     player.attributes[category][attrToBoost] = Math.min(99, player.attributes[category][attrToBoost] + increase);
                    const existing = developmentReport.improvements.find(imp => imp.attr === attrToBoost);
                    if (existing) existing.increase += increase;
                    else developmentReport.improvements.push({ attr: attrToBoost, increase });
                    boosted = true; break;
                }
            }
        }
    }

    // Physical growth
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
    if (!game || !game.teams || !game.players) { /* ... error handling ... */ return { /* empty report */ }; }
    game.year++;
    console.log(`Advancing to Offseason for Year ${game.year}`);
    const retiredPlayers = []; const hofInductees = []; const developmentResults = []; const leavingPlayers = [];
    let totalVacancies = 0;
    const ROSTER_LIMIT = 10; // Use constant

    // Process Teammate Relationship Progression first
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

    // Process Aging, Development, Departures per team
    game.teams.forEach(team => {
        if (!team || !team.roster) return; // Skip invalid teams
        const currentRoster = [...team.roster.filter(p => p)]; // Copy valid players
        team.roster = []; // Clear roster to rebuild

        currentRoster.forEach(player => {
            if (!player.careerStats || !player.attributes) return; // Skip invalid players

            player.age++;
            player.careerStats.seasonsPlayed = (player.careerStats.seasonsPlayed || 0) + 1;

            // Develop player
            const devReport = developPlayer(player);
            if (team.id === game.playerTeam?.id) developmentResults.push(devReport);

            let playerIsLeaving = false;
            // Retirement/Graduation Check (Age 17+) - Adjusted age
            if (player.age >= 17) {
                 retiredPlayers.push(player); playerIsLeaving = true;
                 if (team.id === game.playerTeam?.id) addMessage("Player Retires", `${player.name} is moving on from the league.`);
                 // Hall of Fame Check
                 if ((player.careerStats.touchdowns || 0) > 25 /* ... other HOF criteria ... */ ) {
                     if(!game.hallOfFame) game.hallOfFame = [];
                     game.hallOfFame.push(player); hofInductees.push(player);
                     if (team.id === game.playerTeam?.id) addMessage("Hall of Fame!", `${player.name} inducted!`);
                 }
            } else { // Check random departures
                for (const event of offseasonDepartureEvents) {
                    if (Math.random() < event.chance) {
                        leavingPlayers.push({ player, reason: event.reason, teamName: team.name });
                        playerIsLeaving = true;
                        if (team.id === game.playerTeam?.id) addMessage("Player Leaving", `${player.name}: ${event.reason}.`);
                        break;
                    }
                }
                // Check transfer request (only player team)
                if (!playerIsLeaving && team.id === game.playerTeam?.id && Math.random() < transferEventChance) {
                    leavingPlayers.push({ player, reason: 'Asked to leave', teamName: team.name });
                    playerIsLeaving = true;
                    addMessage("Transfer Request", `${player.name} asked to leave and has departed.`);
                }
            }

            // Keep player or process departure
            if (!playerIsLeaving) {
                // Reset season stats and status
                player.seasonStats = { /* ... zeroed stats ... */ };
                if (!player.status) player.status = {};
                player.status = { type: 'healthy', description: '', duration: 0 };
                team.roster.push(player); // Add back to roster
            } else {
                player.teamId = null; // Mark as free agent/retired
                totalVacancies++;
                // Don't modify team.draftNeeds here, calculate it later in setupDraft
            }
        }); // End player loop

        // Reset team stats and depth chart
        if (team.depthChart && team.formations) { /* ... reset depth chart slots ... */ }
        team.wins = 0; team.losses = 0;
        // Re-run AI depth chart after roster changes
         aiSetDepthChart(team);

    }); // End team loop

    // Chance for new player join request (player team only)
    const undraftedYoungPlayers = game.players.filter(p => p && !p.teamId && p.age < 17);
    if (game.playerTeam && game.playerTeam.roster && game.playerTeam.roster.length < ROSTER_LIMIT && Math.random() < joinRequestChance && undraftedYoungPlayers.length > 0) {
        const joiningPlayer = getRandom(undraftedYoungPlayers);
        if (joiningPlayer) {
            if (addPlayerToTeam(joiningPlayer, game.playerTeam)) {
                 totalVacancies = Math.max(0, totalVacancies - 1);
                 addMessage("New Player Joined!", `${joiningPlayer.name} heard about your team and asked to join!`);
                 aiSetDepthChart(game.playerTeam); // Update depth chart
            }
        }
    }

    addMessage("Offseason Summary", `Offseason complete. ${totalVacancies} roster spots opened. Preparing for the draft.`);

    // Generate new rookie players (adjust count based on vacancies)
    const rookieCount = Math.max(totalVacancies, game.teams.length); // Ensure enough rookies
    console.log(`Generating ${rookieCount} new rookie players (age 10-12).`);
    for (let i = 0; i < rookieCount; i++) game.players.push(generatePlayer(10, 12)); // Generate younger rookies

    // Clear previous season results
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
    // Prevent moving temporary players
    if (player && player.status?.type === 'temporary') {
         console.warn("Cannot move temporary players in depth chart.");
         // Optionally show a message to the user via UI.showModal
         return;
    }


    const oldSlot = Object.keys(chart).find(key => chart[key] === playerId);
    const displacedPlayerId = chart[newPositionSlot];
    const displacedPlayer = team.roster.find(p=>p && p.id === displacedPlayerId);

    // Prevent displacing a temporary player if the dragged player is permanent (temps can only swap with other temps or empty slots?)
    // Simplified: Allow override for now, but temps cannot be dragged.

    // Place the dropped player
    chart[newPositionSlot] = playerId;

    // Handle the old slot and the displaced player
    if (oldSlot) {
        // Player came from another slot, put displaced player there (or null)
        chart[oldSlot] = displacedPlayerId || null;
    } else if (displacedPlayerId) {
        // Player came from bench, displaced player goes to bench (implicitly removed from chart)
        console.log(`Player ${displacedPlayerId} moved to bench from ${newPositionSlot}`);
    }
    // Note: UI re-render is handled by caller (main.js -> UI.switchTab)
}

/** Changes the player team's formation for offense or defense. */
export function changeFormation(side, formationName) {
    const team = game?.playerTeam;
    const formations = side === 'offense' ? offenseFormations : defenseFormations;
    const formation = formations[formationName];
    if (!formation || !team || !team.formations || !team.depthChart) { console.error("changeFormation: Invalid state."); return; }

    team.formations[side] = formationName; // Update selected formation name

    // Create new empty depth chart based on new slots
    const newChart = Object.fromEntries((formation.slots || []).map(slot => [slot, null])); // Safe access slots
    team.depthChart[side] = newChart; // Replace old chart structure

    aiSetDepthChart(team); // Re-run AI logic to fill slots based on suitability
    console.log(`${side} formation changed to ${formationName}, depth chart reset and refilled.`);
    // Note: UI re-render handled by caller
}

/** Cuts a player from the player's team roster. */
export function playerCut(playerId) {
    if (!game || !game.playerTeam || !game.playerTeam.roster) { /* ... error handling ... */ return { success: false, message: "Game state error." }; }
    const team = game.playerTeam;
    const playerIndex = team.roster.findIndex(p => p && p.id === playerId); // Added p check

    if (playerIndex > -1) {
        const player = team.roster[playerIndex];
        if (player.status?.type === 'temporary') { return { success: false, message: "Cannot cut temporary friends." }; }

        team.roster.splice(playerIndex, 1); // Remove from roster
        player.teamId = null; // Mark as free agent

        // Remove from depth chart
        for (const side in team.depthChart) {
             if (team.depthChart[side]) { // Check side exists
                  for (const slot in team.depthChart[side]) {
                      if (team.depthChart[side][slot] === playerId) { team.depthChart[side][slot] = null; }
                  }
             }
        }
        aiSetDepthChart(team); // Refill depth chart slots
        addMessage("Roster Move", `${player.name} has been cut from the team.`);
        // Optionally decrease relationships between cut player and remaining roster?
        team.roster.forEach(rp => { if (rp) decreaseRelationship(rp.id, player.id); });
        return { success: true };
    } else { return { success: false, message: "Player not found on roster." }; }
}

/** Signs an available free agent player to the player's team roster. */
export function playerSignFreeAgent(playerId) {
    if (!game || !game.playerTeam || !game.playerTeam.roster || !game.players) { /* ... error handling ... */ return { success: false, message: "Game state error." }; }
    const team = game.playerTeam;
    const ROSTER_LIMIT = 10;
    if (team.roster.length >= ROSTER_LIMIT) { return { success: false, message: `Roster is full (${ROSTER_LIMIT} players max).` }; }

    // Find player in main list, ensure they are FA
    const player = game.players.find(p => p && p.id === playerId && !p.teamId);

    if (player) {
        player.status = { type: 'healthy', description: '', duration: 0 }; // Ensure healthy status
        // Relationship remains based on global map

        if (addPlayerToTeam(player, team)) {
            aiSetDepthChart(team);
            addMessage("Roster Move", `${player.name} has been signed to the team!`);
             // Optionally improve relationship between new player and roster?
            team.roster.forEach(rp => { if (rp && rp.id !== player.id) improveRelationship(rp.id, player.id); });
            return { success: true };
        } else { return { success: false, message: "Failed to add player to roster." }; }
    } else {
        // Check if player exists but isn't FA
        const existingPlayer = game.players.find(p => p && p.id === playerId);
        if(existingPlayer && existingPlayer.teamId) { return { success: false, message: "Player is already on another team." }; }
        else { return { success: false, message: "Player not found or not available." }; }
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
