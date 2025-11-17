// game.js - COMPLETE FILE

// --- Imports ---
import { getRandom, getRandomInt } from './utils.js';
import {
    calculateOverall,
    calculateSlotSuitability,
    generatePlayer,
    positionOverallWeights,
    estimateBestPosition
} from './game/player.js';
import { getDistance, updatePlayerPosition } from './game/physics.js';

// Re-export player helpers (moved to ./game/player.js) to preserve public API
export { calculateOverall, calculateSlotSuitability, generatePlayer, positionOverallWeights };
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
let TICK_DURATION_SECONDS = 0.05;
const BLOCK_ENGAGE_RANGE = 2;
const TACKLE_RANGE = 1.8;
const CATCH_RADIUS = 0.8;
const SEPARATION_THRESHOLD = 2.0;
const PLAYER_SEPARATION_RADIUS = 0.6;

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
// Player rating/generation helpers moved to ./game/player.js
// (calculateOverall, calculateSlotSuitability, generatePlayer, positionOverallWeights)

// Deep clone helper with structuredClone fallback
function deepClone(obj) {
    try {
        if (typeof structuredClone === 'function') return structuredClone(obj);
    } catch (e) {
        // Fallthrough to JSON
    }
    return JSON.parse(JSON.stringify(obj));
}

// Ensure a value is a Set (if an array is passed, convert it)
function ensureSet(val) {
    if (val instanceof Set) return val;
    if (Array.isArray(val)) return new Set(val);
    return new Set();
}

/** Helper: Gets full player objects from a team's roster of IDs. */
function getRosterObjects(team) {
    if (!team || !Array.isArray(team.roster)) return [];
    if (!game || !Array.isArray(game.players)) return [];

    // Handle old save files or non-ID rosters
    if (team.roster.length > 0 && typeof team.roster[0] === 'object' && team.roster[0] !== null) {
        console.warn("Detected old save file format. Please start a new game.");
        return team.roster.filter(p => p);
    }

    // New way: Look up IDs from the master list
    const rosterIds = new Set(team.roster);
    return game.players.filter(p => p && rosterIds.has(p.id));
}

/**
 * Calculates a player's suitability for a specific formation slot.
 */
/**
 * Generates a new player object.
 */
// Player generation & slot-suitability helpers moved to ./game/player.js
// (generatePlayer, calculateSlotSuitability)

/** Yields control to the main thread briefly. */
export function yieldToMain() { return new Promise(resolve => setTimeout(resolve, 0)); }

/** Adds a message to the player's inbox.
 * Accepts an optional gameObj for easier testing; falls back to the module-level `game`.
 */
export function addMessage(subject, body, isRead = false, gameObj = null) {
    const g = gameObj || game;
    if (!g || !g.messages) {
        console.error("Cannot add message: Game object or messages array not initialized.");
        return;
    }
    g.messages.unshift({ id: crypto.randomUUID(), subject, body, isRead });
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
    const scoutedPlayer = deepClone(player);
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
    scoutedPlayer.estimatedPosition = estimateBestPosition(scoutedPlayer);

    return scoutedPlayer;
}
// --- End Scouting Helper ---


// Coordinate/Physics Helpers were moved to ./game/physics.js
// Re-exported via import at the top of this file so callers remain unchanged.


// --- Fumble Check Helper ---
/** Checks for a fumble during a tackle attempt. */
/** Checks for a fumble during a tackle attempt. */
// game.js

/** Checks for a fumble during a tackle attempt. */
function checkFumble(ballCarrier, tackler, playState, gameLog) {
    // --- 💡 FIX: Check the full player attribute objects ---
    if (!ballCarrier?.attributes?.physical || !tackler?.attributes?.technical) {
        return false;
    }

    // Find the live pState objects to get their current stun status
    const ballCarrierState = playState.activePlayers.find(p => p.id === ballCarrier.id);
    const tacklerState = playState.activePlayers.find(p => p.id === tackler.id);

    // If states can't be found (shouldn't happen), exit
    if (!ballCarrierState || !tacklerState) {
        return false;
    }

    // --- 💡 FIX: Get attributes from the correct player objects ---
    const toughness = ballCarrier.attributes.mental?.toughness || 50;
    const strength = tackler.attributes.physical?.strength || 50;
    const tackling = tackler.attributes.technical?.tackling || 50;

    const carrierModifier = toughness / 100;
    const tacklerModifier = (strength + tackling) / 100;
    // --- 💡 END FIX ---

    const fumbleChance = FUMBLE_CHANCE_BASE * (tacklerModifier / (carrierModifier + 0.5));

    if (Math.random() < fumbleChance) {
        if (gameLog) gameLog.push(`❗ FUMBLE! Ball knocked loose by ${tackler.name}!`);
        playState.turnover = true; // It's a turnover *for now*

        // --- THIS IS THE CORRECTED LOGIC ---
        // 1. Put the ball on the ground
        playState.ballState.isLoose = true; // The ball is now live
        playState.ballState.inAir = false;   // It's on the ground, not in the air
        playState.ballState.z = 0.1;
        playState.ballState.vx = 0;
        playState.ballState.vy = 0;

        // 2. Modify the ballCarrier's pState
        ballCarrierState.isBallCarrier = false;
        ballCarrierState.hasBall = false;
        ballCarrierState.stunnedTicks = 40; // Stun the fumbler (pState)

        // 3. Stun the tackler's pState
        tacklerState.stunnedTicks = 20;
        // --- END CORRECTED LOGIC ---

        return true; // Return true to signal a fumble happened
    }
    return false;
}

/**
 * Simulates a defender's ability to "read" the play.
 * Returns 'run', 'pass', or 'read' (if still diagnosing).
 * @param {object} pState - The defender's state.
 * @param {string} truePlayType - The actual play type ('run' or 'pass').
 * @param {string} offensivePlayKey - The name of the offensive play (e.g., "PA_Cross").
 * @param {number} tick - The current play tick.
 * @returns {string} - The *diagnosed* play type ('run', 'pass', or 'read').
 */
function diagnosePlay(pState, truePlayType, offensivePlayKey, tick) {
    const iq = pState.playbookIQ || 50;

    // 1. Minimum Ticks to Read
    // Higher IQ = fewer ticks. 99 IQ = 2 ticks. 50 IQ = 4 ticks.
    // This formula can be tuned, but it creates a 2-4 tick "read" window.
    const minTicksToRead = Math.max(20, Math.round((100 - iq) / 25) * 3 + 3); // Was max(2, ... /25) + 1

    if (tick < minTicksToRead) {
        return 'read'; // Still reading, not committed
    }

    // 2. Play-Action Check (The "Inaccuracy" part)
    const isPlayAction = (truePlayType === 'pass' && offensivePlayKey.includes('PA_'));

    if (isPlayAction) {
        // Higher IQ = lower chance to be fooled
        // 99 IQ: (100 - 99) / 100 = 1% chance
        // 50 IQ: (100 - 50) / 100 = 50% chance
        const fooledChance = (100 - iq) / 100;

        if (Math.random() < fooledChance) {
            return 'run'; // --- FOOLED! --- Thinks it's a run.
        }
    }

    // 3. Not fooled, or not a PA pass.
    // (We could add logic for "Draw" plays fooling them, but this is a great start)
    return truePlayType; // Returns the correct play ('run' or 'pass')
}


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

    // --- 💡 NEW: Generate sparse, non-stranger relationships ---
    console.log("Assigning initial non-stranger relationships...");
    const relationshipChance = 0.05; // 5% chance of any two players having a non-stranger relationship
    let relationshipsAdded = 0;

    for (let i = 0; i < game.players.length; i++) {
        for (let j = i + 1; j < game.players.length; j++) {
            const roll = Math.random();

            // Only create an entry if it's NOT a stranger
            if (roll < relationshipChance) {
                const p1 = game.players[i];
                const p2 = game.players[j];
                if (!p1 || !p2) continue;

                let level = relationshipLevels.ACQUAINTANCE.level; // Default to acquaintance
                const specialRoll = Math.random();

                if (specialRoll < 0.05) level = relationshipLevels.BEST_FRIEND.level; // 0.25% overall
                else if (specialRoll < 0.20) level = relationshipLevels.GOOD_FRIEND.level; // 1% overall
                else if (specialRoll < 0.50) level = relationshipLevels.FRIEND.level; // 2.5% overall
                // else: 2.5% chance of acquaintance

                const key = [p1.id, p2.id].sort().join('_');
                game.relationships.set(key, level);
                relationshipsAdded++;
            }
        }
        if (i % 20 === 0 && onProgress) {
            onProgress(0.7 + (i / totalPlayers) * 0.2); // Update progress based on player loop
            await yieldToMain();
        }
    }
    console.log(`Assigned ${relationshipsAdded} initial non-stranger relationships.`);
    // --- 💡 END FIX ---

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
        const defenseFormationData = defenseFormations[coach.preferredDefense] || defenseFormations['3-1-3'];
        const offenseSlots = offenseFormationData.slots;
        const defenseSlots = defenseFormationData.slots;

        if (availableColors.length === 0) availableColors = [...teamColors];
        const colorSet = availableColors.splice(getRandomInt(0, availableColors.length - 1), 1)[0];

        const team = {
            id: crypto.randomUUID(), name: teamName, roster: [], coach, division, wins: 0, losses: 0,
            primaryColor: colorSet.primary,
            secondaryColor: colorSet.secondary,
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

function refillAvailableColors() {
    const usedColorHexes = new Set(game.teams.map(t => t.primaryColor));
    availableColors = teamColors.filter(c => !usedColorHexes.has(c.primary));
    if (availableColors.length === 0) {
        console.warn("All colors used! Resetting full color pool.");
        availableColors = [...teamColors];
    }
}

function getUniqueColor() {
    if (!Array.isArray(availableColors) || availableColors.length === 0) {
        refillAvailableColors();
    }
    const colorIndex = getRandomInt(0, availableColors.length - 1);
    return availableColors.splice(colorIndex, 1)[0];
}

/**
 * Creates the player-controlled team and adds it to the game state.
 */
export function createPlayerTeam(teamName) {
    if (!game || !game.teams || !game.divisions || !divisionNames) {
        console.error("Cannot create player team: Game not initialized properly.");
        return;
    }

    const finalTeamName = teamName.toLowerCase().startsWith("the ")
        ? teamName
        : `The ${teamName}`;

    const div0Count = game.divisions[divisionNames[0]]?.length || 0;
    const div1Count = game.divisions[divisionNames[1]]?.length || 0;
    const division = div0Count <= div1Count ? divisionNames[0] : divisionNames[1];

    const defaultOffense = 'Balanced';
    const defaultDefense = '3-1-3';
    const defaultOffenseSlots = offenseFormations[defaultOffense].slots;
    const defaultDefenseSlots = defenseFormations[defaultDefense].slots;

    const colorSet = getUniqueColor();

    const playerTeam = {
        id: crypto.randomUUID(),
        name: finalTeamName,
        roster: [],
        coach: getRandom(coachPersonalities),
        division,
        wins: 0,
        losses: 0,
        primaryColor: colorSet.primary,
        secondaryColor: colorSet.secondary,
        formations: { offense: defaultOffense, defense: defaultDefense },
        depthChart: {
            offense: Object.fromEntries(defaultOffenseSlots.map(slot => [slot, null])),
            defense: Object.fromEntries(defaultDefenseSlots.map(slot => [slot, null])),
        },
        draftNeeds: 0,
        isPlayerControlled: true,
    };

    game.teams.push(playerTeam);
    if (!Array.isArray(game.divisions[division])) game.divisions[division] = [];
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

    let sortedTeams;

    if (game.year === 1) {
        // --- YEAR 1 DRAFT LOTTERY ---
        // All teams are 0-0, so we shuffle the order
        console.log("Year 1: Running draft lottery...");
        sortedTeams = [...game.teams]
            .filter(t => t)
            .sort(() => 0.5 - Math.random()); // Simple array shuffle
    } else {
        // --- STANDARD DRAFT ORDER (Worst picks first) ---
        console.log(`Year ${game.year}: Setting draft order by record.`);
        sortedTeams = [...game.teams]
            .filter(t => t)
            .sort((a, b) => (a.wins || 0) - (b.wins || 0) || (b.losses || 0) - (a.losses || 0));
    }

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
    const roster = getRosterObjects(team);

    if (!team || !roster || !team.depthChart || !team.formations) {
        console.error(`aiSetDepthChart: Invalid team data for ${team?.name || 'unknown team'}.`); return;
    }
    const { depthChart, formations } = team; // roster is now defined above
    if (roster.length === 0) return;

    // Initialize all slots to null
    for (const side in depthChart) {
        if (!depthChart[side]) depthChart[side] = {};
        const formationSlots = (side === 'offense' ? offenseFormations[formations.offense]?.slots : defenseFormations[formations.defense]?.slots) || [];
        const newChartSide = {};
        formationSlots.forEach(slot => newChartSide[slot] = null);
        depthChart[side] = newChartSide;
    }


    const sides = ['defense', 'offense'];
    const alreadyAssignedPlayerIds = new Set(); // Tracks players who have a starting job

    for (const side of sides) {
        const slots = Object.keys(depthChart[side]);
        let availablePlayers = roster.filter(p => p && p.attributes && p.status?.duration === 0);

        // Sort slots to prioritize key positions
        slots.sort((a, b) => {
            if (side === 'defense') {
                if (a.startsWith('DB1')) return -1; if (b.startsWith('DB1')) return 1;
                if (a.startsWith('LB2')) return -1; if (b.startsWith('LB2')) return 1;
                if (a.startsWith('DL2')) return -1; if (b.startsWith('DL2')) return 1;
            } else { // offense
                if (a.startsWith('QB1')) return -1; if (b.startsWith('QB1')) return 1;
                if (a.startsWith('RB1')) return -1; if (b.startsWith('RB1')) return 1;
                if (a.startsWith('WR1')) return -1; if (b.startsWith('WR1')) return 1;
            }
            return 0;
        });

        slots.forEach(slot => {
            if (availablePlayers.length > 0) {
                // Find the best player for this slot
                const bestPlayerForSlot = availablePlayers.reduce((best, current) => {
                    if (!best) return current;
                    const basePosition = slot.replace(/\d/g, '');

                    // Base suitability using existing slot/formula
                    let bestSuitability = calculateSlotSuitability(best, slot, side, team);
                    let currentSuitability = calculateSlotSuitability(current, slot, side, team);

                    // Boost players whose estimated best position matches the slot
                    try {
                        const bestEst = estimateBestPosition(best);
                        const currEst = estimateBestPosition(current);
                        if (bestEst === basePosition) bestSuitability += 12;
                        if (currEst === basePosition) currentSuitability += 12;

                        // Boost players who list this as a favorite/primary position
                        if (best.favoriteOffensivePosition === basePosition || best.favoriteDefensivePosition === basePosition) bestSuitability += 8;
                        if (current.favoriteOffensivePosition === basePosition || current.favoriteDefensivePosition === basePosition) currentSuitability += 8;

                        // Penalize if player's estimated position is strongly on the opposite side
                        const offensePositions = ['QB', 'RB', 'WR', 'OL'];
                        const defensePositions = ['DL', 'LB', 'DB'];
                        const bestSideMismatch = (side === 'offense' && defensePositions.includes(bestEst)) || (side === 'defense' && offensePositions.includes(bestEst));
                        const currSideMismatch = (side === 'offense' && defensePositions.includes(currEst)) || (side === 'defense' && offensePositions.includes(currEst));
                        if (bestSideMismatch) bestSuitability -= 20;
                        if (currSideMismatch) currentSuitability -= 20;
                    } catch (e) {
                        // If estimateBestPosition fails for any player, ignore bonuses
                    }

                    // Penalize players who already have a starting job so we spread starters
                    if (alreadyAssignedPlayerIds.has(best.id)) bestSuitability -= 50;
                    if (alreadyAssignedPlayerIds.has(current.id)) currentSuitability -= 50;

                    return currentSuitability > bestSuitability ? current : best;
                }, availablePlayers[0]);

                if (bestPlayerForSlot) {
                    depthChart[side][slot] = bestPlayerForSlot.id;
                    alreadyAssignedPlayerIds.add(bestPlayerForSlot.id);
                    // 
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
    if (undraftedPlayers.length > 0) {
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
        // ... (all your existing number assignment logic stays exactly the same) ...
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

        // 💡 FIX: We must get roster objects to check existing numbers
        const fullRoster = getRosterObjects(team);
        const existingNumbers = new Set(fullRoster.map(p => p.number).filter(n => n !== null));

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
    // --- 💡 FIX: Push the ID, not the full object ---
    team.roster.push(player.id);
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
function resetGameStats(teamA, teamB) {
    // Combine the rosters of just these two teams
    const playersInGame = [...getRosterObjects(teamA), ...getRosterObjects(teamB)];

    if (playersInGame.length === 0) {
        console.warn("resetGameStats: No players found on rosters.");
        return;
    }

    playersInGame.forEach(player => {
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

// game.js

function getBestSub(team, position, usedPlayerIds) {
    // --- 💡 FIX: Get roster objects ---
    const roster = getRosterObjects(team);
    if (!team || !roster || !Array.isArray(roster)) {
        // --- 💡 END FIX ---
        console.warn("getBestSub: Invalid team or roster provided."); return null;
    }
    // --- 💡 FIX: Filter from our full roster object list ---
    const availableSubs = roster.filter(p => p && p.status?.duration === 0 && !usedPlayerIds.has(p.id));
    if (availableSubs.length === 0) return null;
    return availableSubs.reduce((best, current) => (calculateOverall(current, position) > calculateOverall(best, position)) ? current : best, availableSubs[0]);
}

/** Gets active players for specific slots (e.g., all 'WR' slots). */
function getPlayersForSlots(team, side, slotPrefix, usedPlayerIdsThisPlay, gameLog) {
    const roster = getRosterObjects(team);
    if (!team || !team.depthChart || !team.depthChart[side] || !roster) {
        console.error(`getPlayersForSlots: Invalid team data for ${team?.id}, side ${side}.`); return [];
    }
    // Defensive: ensure usedPlayerIdsThisPlay is a Set
    usedPlayerIdsThisPlay = ensureSet(usedPlayerIdsThisPlay);
    const sideDepthChart = team.depthChart[side];
    if (typeof sideDepthChart !== 'object' || sideDepthChart === null) {
        console.error(`getPlayersForSlots: Invalid depth chart for side "${side}" on ${team?.id}.`); return [];
    }
    const slots = Object.keys(sideDepthChart).filter(s => s.startsWith(slotPrefix));
    const position = slotPrefix.replace(/\d/g, '');
    const activePlayers = [];
    slots.forEach(slot => {
        const starterId = sideDepthChart[slot];
        let player = roster.find(p => p && p.id === starterId);
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

// game.js

function getPlayerBySlot(team, side, slot, usedPlayerIdsThisPlay) {
    const roster = getRosterObjects(team);
    if (!team || !team.depthChart || !team.depthChart[side] || !roster) {
        console.error(`getPlayerBySlot: Invalid team data for ${slot} on ${side}.`);
        return null;
    }

    usedPlayerIdsThisPlay = ensureSet(usedPlayerIdsThisPlay);

    const sideDepthChart = team.depthChart[side];
    const starterId = sideDepthChart[slot];

    // --- STEP 1: Try to get the designated starter ---
    // --- 💡 FIX: Find from our full roster object list ---
    let player = roster.find(p => p && p.id === starterId);

    if (player && (player.status?.duration > 0 || usedPlayerIdsThisPlay.has(player.id))) {
        player = null;
    }

    // --- STEP 2: If starter is ineligible, find the BEST possible substitute ---
    if (!player) {
        // --- 💡 FIX: Filter from our full roster object list ---
        const availableSubs = roster.filter(p =>
            p && p.status?.duration === 0 && !usedPlayerIdsThisPlay.has(p.id)
        );

        if (availableSubs.length > 0) {
            player = availableSubs.reduce((best, current) => {
                const bestScore = calculateSlotSuitability(best, slot, side, team);
                const currentScore = calculateSlotSuitability(current, slot, side, team);
                return (currentScore > bestScore) ? current : best;
            }, availableSubs[0]);
        }
    }

    // --- STEP 3: Finalize Player Usage ---
    if (player) {
        usedPlayerIdsThisPlay.add(player.id);
        return player;
    }

    // --- STEP 4: Absolute fallback ---
    const position = slot.replace(/\d/g, '');
    const emergencySub = getBestSub(team, position, usedPlayerIdsThisPlay); // getBestSub also needs fix
    if (emergencySub) {
        usedPlayerIdsThisPlay.add(emergencySub.id);
        return emergencySub;
    }

    return null; // No one is available
}

// game.js

function findEmergencyPlayer(position, team, side, usedPlayerIdsThisPlay) {
    // --- 💡 FIX: Get roster objects ---
    const roster = getRosterObjects(team);
    if (!team || !roster || !Array.isArray(roster)) {
        // --- 💡 END FIX ---
        console.warn(`findEmergencyPlayer: Invalid team data for ${position}.`); return null;
    }

    usedPlayerIdsThisPlay = ensureSet(usedPlayerIdsThisPlay);
    // --- 💡 FIX: Filter from our full roster object list ---
    const availablePlayers = roster.filter(p => p && p.status?.duration === 0 && !usedPlayerIdsThisPlay.has(p.id));
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


// --- Zone Boundary Definitions ---
// Defines spatial areas or specific points for AI targeting and positioning.
// Zone coordinates are relative to the Line of Scrimmage (LoS Y) and Center X.
// Pass zones: { minX, maxX, minY, maxY } relative to LoS Y=0.
// Run/Blitz assignments: { xOffset, yOffset } relative to ball snap X and LoS Y=0.
const zoneBoundaries = {
    // --- Pass Coverage Zones (Relative to LoS = 0) ---
    'zone_flat_left': { minX: 0, maxX: HASH_LEFT_X, minY: -2, maxY: 8 },
    'zone_flat_right': { minX: HASH_RIGHT_X, maxX: FIELD_WIDTH, minY: -2, maxY: 8 },
    'zone_hook_curl_left': { minX: HASH_LEFT_X, maxX: CENTER_X, minY: 7, maxY: 15 },
    'zone_hook_curl_middle': { minX: HASH_LEFT_X, maxX: HASH_RIGHT_X, minY: 8, maxY: 16 }, // Sits *between* hashes
    'zone_hook_curl_right': { minX: CENTER_X, maxX: HASH_RIGHT_X, minY: 7, maxY: 15 },
    'zone_short_middle': { minX: CENTER_X - 7, maxX: CENTER_X + 7, minY: 0, maxY: 12 }, // General short middle coverage

    'zone_deep_half_left': { minX: 0, maxX: CENTER_X, minY: 12, maxY: 40 },        // Deep left half of field
    'zone_deep_half_right': { minX: CENTER_X, maxX: FIELD_WIDTH, minY: 12, maxY: 40 },
    'zone_deep_middle': { minX: HASH_LEFT_X - 2, maxX: HASH_RIGHT_X + 2, minY: 12, maxY: 40 }, // Deep center field coverage (Cover 1/3 Safety)
    'zone_deep_third_left': { minX: 0, maxX: HASH_LEFT_X, minY: 12, maxY: 40 },        // Deep outside left third (Cover 3 Corner/DB)
    'zone_deep_third_right': { minX: HASH_RIGHT_X, maxX: FIELD_WIDTH, minY: 12, maxY: 40 }, // Deep outside right third (Cover 3 Corner/DB)

    // --- Run/Blitz Gap Assignments (Relative to Ball Snap X, LoS Y=0) ---
    // Offsets determine the target point defender initially attacks.
    'run_gap_A': { xOffset: 0, yOffset: 0.5 },    // Directly over center
    'run_gap_A_left': { xOffset: -2, yOffset: 0.5 },   // Between C and LG
    'run_gap_A_right': { xOffset: 2, yOffset: 0.5 },    // Between C and RG
    'run_gap_B_left': { xOffset: -5, yOffset: 0.5 },   // Between LG and LT area
    'run_gap_B_right': { xOffset: 5, yOffset: 0.5 },    // Between RG and RT area
    'run_edge_left': { xOffset: -10, yOffset: 1.0 },  // Outside the tackle/end on left
    'run_edge_right': { xOffset: 10, yOffset: 1.0 },   // Outside the tackle/end on right

    'blitz_gap': { xOffset: 0, yOffset: 1.0 },    // General inside blitz towards QB depth
    'blitz_edge': { xOffset: 9, yOffset: 0.5 },    // Blitz wide towards QB depth 

    // --- Conceptual/AI-Driven Assignments (Need logic in updatePlayerTargets) ---
    'pass_rush': null, // Target QB, handled by AI logic
    'spy_QB': null, // Target QB area, handled by AI logic
    'run_support': null, // Target ball carrier/likely run area, handled by AI logic
    'fill_run': null, // Read run play, fill appropriate gap, handled by AI logic
    'man_cover_WR1': null, // Target assigned WR, handled by AI logic
    'man_cover_WR2': null, // Target assigned WR, handled by AI logic
    'man_cover_WR3': null, // Target assigned WR, handled by AI logic
    'man_cover_RB1': null, // Target assigned RB, handled by AI logic
    'man_cover_SLOT': null, // Target generic Slot WR/TE, handled by AI logic
    'def_read': null, // Default - hold position or react, handled by AI logic
};

// Helper function (already exists or should be added in game.js)
function getZoneCenter(zoneAssignment, lineOfScrimmage) {
    const zone = zoneBoundaries[zoneAssignment];
    const BACK_WALL_Y = FIELD_LENGTH - 0.5; // Max Y-coord (119.5)

    // Handle non-spatial assignments (run gaps, blitzes) or missing zones
    if (!zone || zone.xOffset !== undefined || zone.minY === undefined) {
        // Default fallback point: 7 yards deep, center field
        return { x: CENTER_X, y: Math.min(BACK_WALL_Y, lineOfScrimmage + 7) };
    }

    // --- 💡 NEW: Red Zone Compression Logic ---

    // 1. Calculate the zone's "ideal" absolute Y boundaries
    const idealMinY_abs = lineOfScrimmage + (zone.minY || 0);
    const idealMaxY_abs = lineOfScrimmage + (zone.maxY || 20); // Default 20yd depth if undefined

    // 2. Clamp the boundaries to the field of play
    // The deepest point is the back wall.
    const finalMaxY_abs = Math.min(idealMaxY_abs, BACK_WALL_Y);
    // The shallowest point can't be deeper than the (clamped) deepest point.
    const finalMinY_abs = Math.min(idealMinY_abs, finalMaxY_abs - 1.0); // Ensure 1yd of zone depth

    // 3. Calculate the center of the *actual* (clamped) zone
    const finalCenterY = (finalMinY_abs + finalMaxY_abs) / 2;
    // --- 💡 END NEW LOGIC ---

    // Calculate X-center (no change needed)
    const centerX = zone.minX !== undefined && zone.maxX !== undefined
        ? (zone.minX + zone.maxX) / 2
        : CENTER_X;

    return { x: centerX, y: finalCenterY };
}

/** Helper to check if a player is roughly within a zone's boundaries (absolute coords). */
function isPlayerInZone(playerState, zoneAssignment, lineOfScrimmage) {
    const zone = zoneBoundaries[zoneAssignment];
    const BACK_WALL_Y = FIELD_LENGTH - 0.5; // Max Y-coord (119.5)

    // Check if player state is valid
    if (!playerState || playerState.x === undefined || playerState.y === undefined) {
        return false;
    }

    // Check if the zone definition exists and has spatial boundaries
    if (!zone || zone.minX === undefined || zone.minY === undefined) {
        return false; // Not a spatial zone (e.g., 'pass_rush')
    }

    // --- 💡 NEW: Red Zone Compression Logic ---

    // 1. Calculate the zone's "ideal" absolute Y boundaries
    const idealMinY_abs = lineOfScrimmage + (zone.minY || 0);
    const idealMaxY_abs = lineOfScrimmage + (zone.maxY || 20);

    // 2. Clamp the boundaries to the field of play
    const finalMaxY_abs = Math.min(idealMaxY_abs, BACK_WALL_Y);
    const finalMinY_abs = Math.min(idealMinY_abs, finalMaxY_abs - 1.0);

    // 3. Check if player's absolute Y is within the *actual* (clamped) zone
    const withinY = playerState.y >= finalMinY_abs && playerState.y <= finalMaxY_abs;
    // --- 💡 END NEW LOGIC ---

    // Check X boundaries (no change needed)
    const withinX = playerState.x >= zone.minX && playerState.x <= zone.maxX;

    return withinX && withinY;
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
// game.js

function setupInitialPlayerStates(playState, offense, defense, play, assignments, ballOnYardLine, defensivePlayKey, ballHash = 'M', offensivePlayKey = '') {
    playState.activePlayers = []; // Reset active players for the new play
    const usedPlayerIds_O = new Set(); // Track used offense players for this play
    const usedPlayerIds_D = new Set(); // Track used defense players for this play
    const isPlayAction = offensivePlayKey.includes('PA_');

    // Get the selected defensive play call and its assignments
    // --- 💡 FIX: Changed the invalid fallback 'Cover_2_Zone' to a valid key ---
    const defPlay = defensivePlaybook[defensivePlayKey] || defensivePlaybook['Cover_2_Zone_3-1-3']; // Fallback if key invalid
    // --- 💡 END FIX ---

    const defAssignments = defPlay.assignments || {};

    // Set the line of scrimmage (adding 10 for the endzone offset)
    playState.lineOfScrimmage = ballOnYardLine + 10;
    let ballX = CENTER_X;
    if (ballHash === 'L') ballX = HASH_LEFT_X;
    else if (ballHash === 'R') ballX = HASH_RIGHT_X;

    // --- STEP 1: Calculate initial OFFENSIVE positions FIRST ---
    // Get the offensive formation data
    const offenseFormationData = offenseFormations[offense.formations.offense];
    const initialOffenseStates = []; // Array to store { slot, x, y } for offense players

    if (offenseFormationData?.slots && offenseFormationData?.coordinates) {
        // Loop through each slot defined in the offensive formation
        offenseFormationData.slots.forEach(slot => {
            const relCoords = offenseFormationData.coordinates[slot] || [0, 0]; // Get coordinates relative to ball
            let startX = ballX + relCoords[0];
            let startY = playState.lineOfScrimmage + relCoords[1];
            // Clamp position within field boundaries (excluding deep endzones for start)
            startX = Math.max(0.5, Math.min(FIELD_WIDTH - 0.5, startX));
            startY = Math.max(10.5, Math.min(FIELD_LENGTH - 10.5, startY));
            // Store the calculated initial position for alignment reference
            initialOffenseStates.push({ slot, x: startX, y: startY });
        });
    } else {
        console.error(`setupInitialPlayerStates: Invalid offense formation data for ${offense.name}`);
        // Consider adding fallback logic or stopping if formation data is crucial
    }
    // --- End STEP 1 ---

    // --- Helper function to set up players for one side (Offense or Defense) ---

    const setupSide = (team, side, formationData, isOffense, initialOffenseStates) => {
        // Validate input data
        if (!team || !team.roster || !formationData || !formationData.slots || !formationData.coordinates) {
            console.error(`setupInitialPlayerStates: Invalid data for ${side} team ${team?.name}`);
            return;
        }
        const usedSet = isOffense ? usedPlayerIds_O : usedPlayerIds_D;

        // Loop through each slot defined in the formation
        formationData.slots.forEach(slot => {

            // --- CRITICAL DECLARATIONS (Declared with 'let' at the start of the loop scope) ---
            // Initialize variables that are reassigned (must be 'let')
            let action = 'idle';
            let assignment = defAssignments[slot] || 'def_read'; // Default defense assignment for non-offense
            let targetX = 0;
            let targetY = 0;
            let routePath = null;

            // --- A. Find Player and Initial Position ---
            const player = getPlayerBySlot(team, side, slot, usedSet) || findEmergencyPlayer(slot.replace(/\d/g, ''), team, side, usedSet)?.player;
            if (!player || !player.attributes) {
                console.warn(`Could not find valid player for ${side} slot ${slot} on team ${team.name}`);
                return;
            }

            const relCoords = formationData.coordinates[slot] || [0, 0];
            targetX = ballX + relCoords[0]; // Initial lateral target is based on formation coords
            targetY = playState.lineOfScrimmage + relCoords[1]; // Initial depth target is based on formation coords

            let startX = targetX; // Starting X coordinate (will be adjusted for defense alignment)
            let startY = targetY; // Starting Y coordinate (will be adjusted for defense alignment)

            // --- B. Determine Alignment and Action ---

            if (isOffense) {
                // --- OFFENSE ALIGNMENT / ACTION ---
                assignment = assignments?.[slot]; // Update assignment from offensive playbook

                if (assignment) {
                    if (assignment.toLowerCase().includes('pass_block')) { action = 'pass_block'; targetY = startY - 0.5; }
                    else if (assignment.toLowerCase().includes('run_block')) { action = 'run_block'; targetY = startY + 0.5; }
                    else if (assignment.toLowerCase().includes('run_')) {
                        action = 'run_path'; targetY = startY + 5;
                        if (assignment.includes('outside')) targetX = startX + (startX < CENTER_X ? -2 : 2); else targetX = startX + getRandomInt(-1, 1);
                    } else if (routeTree[assignment]) {
                        action = 'run_route';
                        routePath = calculateRoutePath(assignment, startX, startY);
                        if (routePath && routePath.length > 0) { targetX = routePath[0].x; targetY = routePath[0].y; }
                    }
                } else if (slot.startsWith('OL')) {
                    assignment = play.type === 'pass' ? 'pass_block' : 'run_block';
                    // --- OL "Sell the Fake" Logic ---
                    if (isPlayAction && assignment === 'pass_block') {
                        // On PA passes, *initially* act like it's a run block
                        action = 'run_block';
                    } else {
                        action = assignment;
                    }
                    targetY = startY + (action === 'pass_block' ? -0.5 : 0.5);

                } else if (slot.startsWith('QB')) {
                    assignment = 'qb_setup';
                    action = assignment; if (play.type === 'pass') targetY = startY - 2;
                }
                else {
                    // Default for other players (like WRs) who don't have an assignment
                    if (play.type === 'run') {
                        assignment = 'run_block';
                        action = 'run_block';
                        targetY = startY + 0.5; // Step forward to block
                    } else {
                        // Default for unassigned on pass play (shouldn't happen often)
                        assignment = 'idle';
                        action = 'idle';
                    }
                }

            } else { // Defense
                // --- DEFENSE ALIGNMENT / ACTION ---
                assignment = defAssignments[slot] || 'def_read'; // Assignment is read from playbook
                action = assignment; // Action defaults to assignment

                // The defense must line up behind the line of scrimmage (LoS).
                // LoS = playState.lineOfScrimmage. We allow a tiny buffer (0.1 yards) to be on the line.

                startY = Math.min(playState.lineOfScrimmage + 0.1, startY);
                targetY = Math.min(playState.lineOfScrimmage + 0.1, targetY);

                // 1. Man Coverage Alignment (Fallback)
                if (assignment.startsWith('man_cover_')) {
                    const targetSlot = assignment.split('man_cover_')[1];
                    const targetOffPlayer = initialOffenseStates.find(o => o.slot === targetSlot);

                    if (targetOffPlayer) {
                        // --- Successful Man Alignment ---
                        const xOffset = targetOffPlayer.x < CENTER_X ? 1.5 : -1.5;
                        const yOffset = 1.5; // Line up 1.5 yards away (press)
                        startX = targetOffPlayer.x + xOffset;
                        startY = targetOffPlayer.y + yOffset;
                        targetX = startX; targetY = startY; // Target is starting position
                    } else {
                        // --- 💡 "SMARTER" FIX: Target not found, try to find an uncovered receiver ---
                        console.warn(`Man target ${targetSlot} not found for DEF ${slot}.`);

                        // 1. Check if WR3 exists
                        const wr3Target = initialOffenseStates.find(o => o.slot === 'WR3');
                        // 2. Check if any *other* defender is already assigned to WR3
                        const isWR3Covered = Object.values(defAssignments).includes('man_cover_WR3');

                        if (wr3Target && !isWR3Covered) {
                            // --- Found uncovered WR3! Assign this defender to them ---
                            console.warn(`Re-assigning ${slot} to uncovered receiver WR3.`);
                            assignment = `man_cover_WR3`; // This defender's new job
                            action = assignment;

                            // Align to this new target
                            const xOffset = wr3Target.x < CENTER_X ? 1.5 : -1.5;
                            const yOffset = 1.5;
                            startX = wr3Target.x + xOffset;
                            startY = wr3Target.y + yOffset;
                            targetX = startX; targetY = startY;
                        } else {
                            // --- WR3 not available or already covered, default to zone ---
                            console.warn(`No uncovered receiver found. Defaulting ${slot} to Hook/Curl zone.`);
                            assignment = 'zone_hook_curl_middle';
                            action = assignment;
                            const zoneCenter = getZoneCenter(assignment, playState.lineOfScrimmage);

                            // Align them in their new zone
                            targetX = zoneCenter.x;
                            targetY = zoneCenter.y;
                        }
                    }
                }

                // 2. Zone Coverage Alignment (Drop to Zone Depth)
                else if (assignment.startsWith('zone_')) {
                    const zoneTarget = getZoneCenter(assignment, playState.lineOfScrimmage);

                    // --- 1. Set Target Position (Where player WANTS to go) ---
                    targetX = zoneTarget.x;
                    targetY = zoneTarget.y;

                    // --- 2. Adjust Starting Position (Initial Alignment) ---

                    // 🚨 Only snap deep safeties to their depth if they start shallow
                    if (assignment.includes('deep') && startY < zoneTarget.y - 5) {
                        startY = zoneTarget.y;
                        startX = zoneTarget.x; // Align horizontally with zone center
                    } else {
                        // For LBs/CBs: use their formation coordinates, but align slightly
                        // horizontally to the zone if their starting position is generic.
                        if (slot.startsWith('DB')) {
                            // Small cosmetic/leverage adjustment for outside DBs on the line
                            const wideOffset = startX < CENTER_X ? -2 : 2;
                            startX += wideOffset;
                            startY = Math.min(playState.lineOfScrimmage + 1.0, startY); // Ensure they start shallow
                        }
                        // Otherwise, LBs and DLs stick close to their formation spot
                    }
                }

                // 3. Run/Blitz Gap Assignment (Sets TARGET, not START)
                else if (assignment.includes('run_gap_') || assignment.includes('blitz_gap') || assignment.includes('blitz_edge')) {
                    // startX and startY are already set to the formation spot. Leave them alone.

                    // Just set the TARGET to the gap.
                    const gapTarget = zoneBoundaries[assignment];
                    if (gapTarget) {
                        targetX = ballX + (gapTarget.xOffset || 0);
                        targetY = playState.lineOfScrimmage + (gapTarget.yOffset || 1.0); // Aim 1yd past LoS
                    } else {
                        // Fallback: if assignment has no xOffset, just rush center
                        targetX = ballX;
                        targetY = playState.lineOfScrimmage + 1.0;
                    }

                    // 💡 THE FIX: Only pull DL up to the line. LBs/DBs blitz from their depth.
                    if (slot.startsWith('DL')) {
                        startY = Math.min(startY, playState.lineOfScrimmage + 2.5);
                    }
                }
            }

            // --- Clamp final starting position within field boundaries ---
            startX = Math.max(0.5, Math.min(FIELD_WIDTH - 0.5, startX));
            startY = Math.max(10.5, Math.min(FIELD_LENGTH - 10.5, startY));

            // 🚨 CRITICAL NEUTRAL ZONE CLAMP:
            const LOS = playState.lineOfScrimmage;

            // 🛠️ NEW: Define the neutral zone width (the "length of the ball")
            const NEUTRAL_ZONE_WIDTH = 1.0; // 1 yard

            if (!isOffense) {
                let attempts = 0;
                let isStacked = playState.activePlayers.some(p =>
                    !p.isOffense && p.x === startX && p.y === startY
                );

                while (isStacked && attempts < 10) {
                    // Nudge the player 0.5 yards to a random side
                    startX += (Math.random() < 0.5 ? -0.5 : 0.5);
                    // Re-check if still stacked
                    isStacked = playState.activePlayers.some(p =>
                        !p.isOffense && p.x === startX && p.y === startY
                    );
                    attempts++;
                }
                if (slot.startsWith('DL')) {
                    // 🚨 FIX: Force DL to be exactly on the neutral zone line
                    startY = LOS + NEUTRAL_ZONE_WIDTH;
                    // Target will be set by AI, but start them at their line

                } else {
                    // LBs and DBs can line up deeper based on formation
                    startY = Math.max(LOS + NEUTRAL_ZONE_WIDTH, startY);

                }

            } else {
                // --- OFFENSE ---
                if (slot.startsWith('OL')) {
                    // 🚨 FIX: Force OL to be exactly on the Line of Scrimmage
                    startY = LOS;
                    // Target will be set by AI, but start them on the line

                } else {
                    // QBs, RBs, WRs can line up behind the LoS
                    startY = Math.min(LOS, startY);

                }
            }
            // --- END NEUTRAL ZONE CLAMP ---


            // --- Create Player State Object for Simulation (uses the final values) ---
            const fatigueRatio = player ? (player.fatigue / (player.attributes?.physical?.stamina || 50)) : 0;
            const fatigueModifier = Math.max(0.3, 1.0 - fatigueRatio);
            playState.activePlayers.push({
                id: player.id, name: player.name, number: player.number,
                teamId: team.id, primaryColor: team.primaryColor, secondaryColor: team.secondaryColor,
                isOffense: isOffense, slot: slot,
                x: startX, y: startY, initialX: startX, initialY: startY,
                targetX: targetX, targetY: targetY,
                // Include relevant attributes for simulation
                speed: player.attributes.physical?.speed || 50,
                strength: player.attributes.physical?.strength || 50,
                agility: player.attributes.physical?.agility || 50,
                blocking: player.attributes.technical?.blocking || 50,
                blockShedding: player.attributes.technical?.blockShedding || 50,
                tackling: player.attributes.technical?.tackling || 50,
                catchingHands: player.attributes.technical?.catchingHands || 50,
                throwingAccuracy: player.attributes.technical?.throwingAccuracy || 50,
                playbookIQ: player.attributes.mental?.playbookIQ || 50,
                toughness: player.attributes.mental?.toughness || 50,
                consistency: player.attributes.mental?.consistency || 50,
                fatigueModifier: fatigueModifier,
                // Initial state flags
                action: action,
                assignment: assignment,
                routePath: routePath,
                currentPathIndex: 0,
                engagedWith: null,
                isBlocked: false,
                blockedBy: null,
                isEngaged: false,
                isBallCarrier: false,
                hasBall: false,
                stunnedTicks: 0
            });
        });
    };

    // --- Execute Setup ---
    // STEP 1 already done (initialOffenseStates calculated)
    // Setup Defense (can now use initialOffenseStates for alignment)
    const defenseFormationData = defenseFormations[defense.formations.defense];
    setupSide(offense, 'offense', offenseFormationData, true, initialOffenseStates); // OFFENSE FIRST
    setupSide(defense, 'defense', defenseFormationData, false, initialOffenseStates); // then DEFENSE
    // --- End Execute Setup ---

    // --- Set Initial Ball Position & Carrier ---
    const qbState = playState.activePlayers.find(p => p.slot === 'QB1' && p.isOffense);
    const rbState = playState.activePlayers.find(p => p.slot === 'RB1' && p.isOffense);

    const isQBRun = qbState && assignments[qbState.slot]?.includes('run_');
    const isRBRun = rbState && assignments[rbState.slot]?.includes('run_');

    if (play.type === 'run' && isRBRun && !isQBRun) {
        // --- IT'S A RUN PLAY (to RB) ---
        if (rbState) {
            rbState.hasBall = true;
            rbState.isBallCarrier = true;
            playState.ballState.x = rbState.x;
            playState.ballState.y = rbState.y;
            playState.ballState.z = 1.0;
        }
        if (qbState) { qbState.action = 'run_fake'; /* ... */ }

    } else if (qbState) {
        // --- IT'S A PASS PLAY or QB RUN ---
        qbState.hasBall = true;
        playState.ballState.x = qbState.x;
        playState.ballState.y = qbState.y;
        playState.ballState.z = 1.0;

        // --- Dynamic Read Progression ---
        // 1. Get reads from the play definition
        const playReads = play.readProgression || [];

        // 2. Build the final progression list
        let finalProgression = [];

        if (playReads.length > 0) {
            // Use the progression defined in the play
            finalProgression = [...playReads];
        } else {
            // Fallback for any plays you haven't updated yet
            finalProgression = ['WR1', 'WR2', 'RB1'];
        }

        qbState.readProgression = finalProgression;
        // --- END NEW ---

        qbState.currentReadTargetSlot = qbState.readProgression[0]; // Start with the first read
        qbState.ticksOnCurrentRead = 0;

        if (isQBRun) {
            qbState.isBallCarrier = true; // QB is the carrier
            // qbState.action is already 'run_path' from setup
        } else {
            qbState.isBallCarrier = false; // QB is a passer
            // qbState.action is already 'qb_setup' from setup
        }
    } else {
        // --- CRITICAL ERROR ---
        console.error("CRITICAL: QB not found during setup! Ending play.");
        playState.playIsLive = false;
        playState.turnover = true;
    }
}

/**
 * Updates player targets based on their current action, assignment, and game state. (Improved AI)
 * Modifies playerState objects within playState.activePlayers directly.
 */
// game.js

function updatePlayerTargets(playState, offenseStates, defenseStates, ballCarrierState, playType, offensivePlayKey, offensiveAssignments, defensivePlayKey, gameLog) {
    const qbState = offenseStates.find(p => p.slot?.startsWith('QB'));
    const isBallInAir = playState.ballState.inAir;
    const ballPos = playState.ballState;

    const LOS = playState.lineOfScrimmage;
    const POCKET_DEPTH_PASS = -1.5; // 1.5 yards *behind* the LoS
    const POCKET_DEPTH_RUN = 0.5;   // 0.5 yards *in front* of the LoS

    const isPlayerState = (t) => t && t.speed !== undefined;
    const olAssignedDefenders = new Set();

    if (playState.ballState.isLoose) {
        playState.activePlayers.forEach(pState => {
            if (pState.stunnedTicks === 0 && !pState.isEngaged) {
                pState.targetX = playState.ballState.x;
                pState.targetY = playState.ballState.y;
            }
        });
        return;
    }

    const allThreats = defenseStates.filter(d => {
        if (d.isBlocked || d.isEngaged) return false;
        const isBoxPlayer = d.slot.startsWith('DL') || d.slot.startsWith('LB');
        if (!isBoxPlayer) return false;
        const isDropping = (typeof d.assignment === 'string') &&
            (d.assignment.startsWith('man_cover_') || d.assignment.includes('deep_'));
        return !isDropping;
    });

    const allBlockers = offenseStates.filter(p =>
        !p.isEngaged &&
        (p.action === 'pass_block' || p.action === 'run_block')
    );

    const linemen = allBlockers.filter(p => p.slot.startsWith('OL'));
    const otherBlockers = allBlockers.filter(p => !p.slot.startsWith('OL'));

    const assignLinemanTarget = (blocker, availableThreats, logPrefix) => {

        if (blocker.isEngaged && blocker.engagedWith) {
            const engagedTarget = defenseStates.find(d => d.id === blocker.engagedWith);
            if (engagedTarget) {
                blocker.targetX = engagedTarget.x;
                blocker.targetY = engagedTarget.y;
                return;
            } else {
                blocker.isEngaged = false;
                blocker.engagedWith = null;
            }
        }

        const isLiveRunPlay = (ballCarrierState && !playState.ballState.inAir);
        const unengagedThreats = availableThreats.filter(d => !d.isBlocked && !d.blockedBy);

        if (unengagedThreats.length === 0) {
            if (isLiveRunPlay) {
                const nextLevelThreats = defenseStates.filter(d =>
                    !d.isBlocked && !d.isEngaged && d.stunnedTicks === 0 &&
                    d.y > blocker.y && getDistance(blocker, d) < 15
                );
                if (nextLevelThreats.length > 0) {
                    nextLevelThreats.sort((a, b) => getDistance(a, ballCarrierState) - getDistance(b, ballCarrierState));
                    const newTarget = nextLevelThreats[0];
                    blocker.dynamicTargetId = newTarget.id;
                    olAssignedDefenders.add(newTarget.id);
                    if (blocker.slot === 'OL2' && gameLog) console.log(`%c[OL2-BRAIN] ${logPrefix}: No primary. Smart Climb to ${newTarget.name} (near carrier)`, 'color: #FFBF00');
                } else {
                    blocker.dynamicTargetId = null;
                    if (blocker.slot === 'OL2' && gameLog) console.log(`%c[OL2-BRAIN] ${logPrefix}: No primary or climb targets.`, 'color: #FFBF00');
                }
            } else {
                blocker.dynamicTargetId = null;
                blocker.targetX = blocker.initialX;
                blocker.targetY = LOS + POCKET_DEPTH_PASS;
                if (blocker.slot === 'OL2' && gameLog) console.log(`%c[OL2-BRAIN] ${logPrefix}: No target chosen. Holding Pocket.`, 'color: #FFBF00');
            }
            return;
        }

        const BLOCKING_LANE_WIDTH = 2.0;
        const primaryThreats = unengagedThreats.filter(d =>
            Math.abs(d.x - blocker.initialX) < BLOCKING_LANE_WIDTH
        );

        let targetDefender = null;
        if (primaryThreats.length > 0) {
            primaryThreats.sort((a, b) => getDistance(blocker, a) - getDistance(blocker, b));
            targetDefender = primaryThreats[0];
            if (blocker.slot === 'OL2' && gameLog) console.log(`%c[OL2-BRAIN] ${logPrefix}: Primary Target (in lane): ${targetDefender.name} (${targetDefender.slot})`, 'color: #FFBF00');
        } else {
            if (qbState && playType === 'pass') {
                unengagedThreats.sort((a, b) => {
                    const aQBdist = getDistance(qbState, a);
                    const bQBdist = getDistance(qbState, b);
                    return aQBdist - bQBdist;
                });
            } else {
                unengagedThreats.sort((a, b) => getDistance(blocker, a) - getDistance(blocker, b));
            }

            targetDefender = unengagedThreats[0];
        }

        if (targetDefender) {
            const dist = getDistance(blocker, targetDefender);
            const ENGAGE_DISTANCE = BLOCK_ENGAGE_RANGE;

            blocker.dynamicTargetId = targetDefender.id;
            olAssignedDefenders.add(targetDefender.id);

            blocker.targetX = targetDefender.x;
            blocker.targetY = targetDefender.y;

            if (dist < ENGAGE_DISTANCE) {
                blocker.isEngaged = true;
                blocker.engagedWith = targetDefender.id;
                targetDefender.isEngaged = true;
                targetDefender.isBlocked = true;
                targetDefender.blockedBy = blocker.id;

                playState.blockBattles.push({
                    blockerId: blocker.id, defenderId: targetDefender.id,
                    status: 'ongoing',
                    battleScore: 0,
                    startTick: playState.tick
                });

                if (blocker.slot === 'OL2' && gameLog) console.log(`%c[OL2-BRAIN] ${logPrefix}: ENGAGED ${targetDefender.name} (${targetDefender.slot})`, 'color: #00dd00');
            } else {
                if (blocker.slot === 'OL2' && gameLog) console.log(`%c[OL2-BRAIN] ${logPrefix}: Moving to help on: ${targetDefender.name} (${targetDefender.slot}) [Dist: ${dist.toFixed(1)}]`, 'color: #FFBF00');
            }

        } else {
            blocker.dynamicTargetId = null;
            if (isLiveRunPlay) {
                blocker.targetX = blocker.initialX;
                blocker.targetY = blocker.y + 7;
            } else {
                blocker.targetX = blocker.initialX;
                blocker.targetY = LOS + POCKET_DEPTH_PASS;
            }
            if (blocker.slot === 'OL2' && gameLog) console.log(`%c[OL2-BRAIN] ${logPrefix}: No primary or help targets found. ${isLiveRunPlay ? 'Climbing' : 'Holding'}.`, 'color: #FFBF00');
        }
    };

    if (linemen.length > 0) {
        linemen.sort((a, b) => {
            if (a.slot === 'OL2') return -1;
            if (b.slot === 'OL2') return 1;
            return a.initialX - b.initialX;
        });

        const ol2Logger = linemen.find(p => p.slot === 'OL2');
        if (ol2Logger && gameLog) { // Added gameLog check
            const logPrefix = `TICK ${playState.tick} | ${ol2Logger.name} (OL2)`;
            console.log(`--- %c[OL2-BRAIN] ${logPrefix} (${ol2Logger.action.toUpperCase()}) ---`, 'color: #FFBF00; font-weight: bold;');
            const threatNames = allThreats.map(d => `${d.slot} (Assign: ${d.assignment})`);
            console.log(`%c[OL2-BRAIN] Threats Seen: [${threatNames.join(', ') || 'NONE'}]`, 'color: #FFBF00');
        }

        for (const ol of linemen) {
            const availableThreats = allThreats.filter(d => !olAssignedDefenders.has(d.id));
            const prefix = `TICK ${playState.tick} | ${ol.name} (${ol.slot})`;
            assignLinemanTarget(ol, availableThreats, prefix);
        }
    }

    if (otherBlockers.length > 0) {
        for (const blocker of otherBlockers) {
            const availableThreats = allThreats.filter(d => !olAssignedDefenders.has(d.id));
            if (availableThreats.length > 0) {
                availableThreats.sort((a, b) => getDistance(blocker, a) - getDistance(blocker, b));
                const targetDefender = availableThreats[0];
                blocker.dynamicTargetId = targetDefender.id;
                olAssignedDefenders.add(targetDefender.id);
            } else {
                blocker.dynamicTargetId = null;
            }
        }
    }

    playState.activePlayers.forEach(pState => {
        let target = null;

        if (pState.stunnedTicks > 0) {
            pState.stunnedTicks--;
            pState.targetX = pState.x;
            pState.targetY = pState.y;
            return;
        }

        if (pState.action === 'juke' || pState.jukeTicks > 0) {
            pState.jukeTicks--;
            if (pState.jukeTicks > 0) {
                return;
            } else {
                pState.action = 'run_path';
                pState.jukeTicks = 0;
            }
        }

        if (pState.isBlocked) {
            pState.targetX = pState.x; pState.targetY = pState.y;
            return;
        }

        if (pState.isOffense && pState.isEngaged) {
            const engagedDefender = defenseStates.find(d => d.id === pState.engagedWith);
            if (engagedDefender) {
                pState.targetX = engagedDefender.x;
                pState.targetY = engagedDefender.y;
            } else {
                pState.isEngaged = false;
                pState.engagedWith = null;
            }
            return;
        }

        if (pState.isOffense &&
            pState.id !== ballCarrierState?.id &&
            (pState.action === 'pass_block' || pState.action === 'run_route' || pState.action === 'route_complete') &&
            ballCarrierState &&
            ballCarrierState.isOffense &&
            !playState.ballState.inAir) {
            pState.action = 'run_block';
            pState.dynamicTargetId = null;
        }

        if (pState.isOffense && !pState.hasBall && !pState.isBallCarrier) {
            if ((pState.action === 'run_route' || pState.action === 'route_complete') && playState.ballState.inAir) {
                const isIntendedTarget = playState.ballState.targetPlayerId === pState.id;
                const distToLandingSpot = getDistance(pState, { x: playState.ballState.targetX, y: playState.ballState.targetY });

                if (isIntendedTarget || distToLandingSpot < 8.0) {
                    if (getDistance(pState, ballPos) < 15.0) {
                        pState.action = 'attack_ball';
                    }
                }
            } else if (pState.action === 'attack_ball' && !playState.ballState.inAir) {
                pState.action = 'route_complete';
                pState.targetX = pState.x;
                pState.targetY = pState.y;
            }
        }

        // --- Offensive Logic ---
        if (pState.isOffense) {
            if (pState.slot.startsWith('OL') &&
                pState.action === 'run_block' &&
                playType === 'pass' &&
                playState.tick > 20) {
                pState.action = 'pass_block';
            }
            switch (pState.action) {
                case 'attack_ball':
                    pState.targetX = playState.ballState.targetX;
                    pState.targetY = playState.ballState.targetY;
                    pState.targetX = Math.max(0.5, Math.min(FIELD_WIDTH - 0.5, pState.targetX));
                    pState.targetY = Math.max(0.5, Math.min(FIELD_LENGTH - 0.5, pState.targetY));
                    target = null;
                    break;

                case 'run_route': {
                    if (!pState.routePath || pState.routePath.length === 0) {
                        pState.action = 'route_complete';
                        pState.targetX = pState.x;
                        pState.targetY = pState.y;
                        break;
                    }
                    const currentTargetPoint = pState.routePath[pState.currentPathIndex];
                    const ARRIVAL_RADIUS = 0.3;
                    const dx = currentTargetPoint.x - pState.x;
                    const dy = currentTargetPoint.y - pState.y;
                    const distToTarget = Math.sqrt(dx * dx + dy * dy);

                    if (distToTarget < ARRIVAL_RADIUS) {
                        pState.currentPathIndex++;
                        if (pState.currentPathIndex < pState.routePath.length) {
                            const nextTargetPoint = pState.routePath[pState.currentPathIndex];
                            pState.targetX = nextTargetPoint.x;
                            pState.targetY = nextTargetPoint.y;
                        } else {
                            pState.action = 'route_complete';
                            pState.targetX = pState.x;
                            pState.targetY = pState.y;
                        }
                    }
                    break;
                }

                case 'pass_block':
                    if (pState.dynamicTargetId) {
                        const target = defenseStates.find(d => d.id === pState.dynamicTargetId);
                        if (target && (target.blockedBy === null || target.blockedBy === pState.id)) {
                            pState.targetX = target.x;
                            pState.targetY = target.y;
                        } else {
                            pState.dynamicTargetId = null;
                            pState.targetX = pState.initialX;
                            pState.targetY = LOS + POCKET_DEPTH_PASS;
                        }
                    } else {
                        pState.targetX = pState.initialX;
                        pState.targetY = LOS + POCKET_DEPTH_PASS;
                    }
                    target = null;
                    break;

                case 'run_block':
                    if (pState.dynamicTargetId) {
                        const target = defenseStates.find(d => d.id === pState.dynamicTargetId);
                        if (target && (target.blockedBy === null || target.blockedBy === pState.id)) {
                            pState.targetX = target.x;
                            pState.targetY = target.y;
                        } else {
                            pState.dynamicTargetId = null;
                            if (ballCarrierState) {
                                const visionIQ = ballCarrierState.playbookIQ || 50;
                                let bestLaneX = ballCarrierState.x;
                                let bestLaneY = ballCarrierState.y + 2;
                                for (let dx = -4; dx <= 4; dx += 2) {
                                    const laneX = ballCarrierState.x + dx;
                                    const laneY = ballCarrierState.y + 2 + Math.round(visionIQ / 40);
                                    const defendersNearLane = defenseStates.filter(d => getDistance({ x: laneX, y: laneY }, d) < (4 - visionIQ / 40));
                                    if (defendersNearLane.length === 0) {
                                        bestLaneX = laneX;
                                        bestLaneY = laneY;
                                        break;
                                    }
                                }
                                pState.targetX = bestLaneX;
                                pState.targetY = bestLaneY;
                            } else {
                                pState.targetX = pState.initialX;
                                pState.targetY = pState.y + 5;
                            }
                        }
                    } else {
                        if (ballCarrierState) {
                            pState.targetX = ballCarrierState.x;
                            pState.targetY = ballCarrierState.y + 2;
                        } else {
                            pState.targetX = pState.initialX;
                            pState.targetY = pState.y + 5;
                        }
                    }
                    target = null;
                    break;

                case 'pursuit':
                    if (ballCarrierState && !ballCarrierState.isOffense) {
                        target = ballCarrierState;
                    } else {
                        pState.targetX = pState.x;
                        pState.targetY = pState.y;
                        target = null;
                    }
                    break;

                case 'route_complete':
                    const FIND_SPACE_RADIUS = 12;
                    const nearbyDefenders = defenseStates.filter(d =>
                        !d.isBlocked && !d.isEngaged && getDistance(pState, d) < FIND_SPACE_RADIUS
                    ).sort((a, b) => getDistance(pState, a) - getDistance(pState, b));

                    if (qbState?.action === 'qb_scramble') {
                        pState.targetX = qbState.targetX > CENTER_X ? FIELD_WIDTH - 5 : 5;
                        pState.targetY = Math.max(playState.lineOfScrimmage + 3, qbState.y + 2);
                    } else if (nearbyDefenders.length === 0) {
                        pState.targetX = pState.x + (pState.x < CENTER_X ? -0.1 : 0.1);
                        pState.targetY = pState.y;
                    } else {
                        let bestX = pState.x;
                        let bestY = pState.y;
                        let maxMinDist = 0;
                        const potentialSpots = [
                            { x: pState.x + 3, y: pState.y }, { x: pState.x - 3, y: pState.y },
                            { x: pState.x, y: pState.y + 2 }, { x: pState.x, y: pState.y - 2 },
                            { x: pState.x + 2, y: pState.y + 2 }, { x: pState.x - 2, y: pState.y + 2 },
                            { x: pState.x + 2, y: pState.y - 2 }, { x: pState.x - 2, y: pState.y - 2 },
                        ];
                        potentialSpots.forEach(spot => {
                            if (spot.y < playState.lineOfScrimmage + 1) return;
                            let minDistToDefender = FIND_SPACE_RADIUS;
                            nearbyDefenders.forEach(def => {
                                const dist = getDistance(spot, def);
                                if (dist < minDistToDefender) {
                                    minDistToDefender = dist;
                                }
                            });
                            if (minDistToDefender > maxMinDist) {
                                maxMinDist = minDistToDefender;
                                bestX = spot.x;
                                bestY = spot.y;
                            }
                        });
                        pState.targetX = bestX;
                        pState.targetY = bestY;
                    }
                    break;

                case 'run_path': {
                    const threatDistance = 3.5;
                    const visionDistance = 10.0;
                    const nearestThreat = defenseStates
                        .filter(d => !d.isBlocked && !d.isEngaged && getDistance(pState, d) < threatDistance)
                        .sort((a, b) => getDistance(pState, a) - getDistance(pState, b))[0];

                    let targetXOffset = 0;

                    if (nearestThreat) {
                        const distanceToThreat = getDistance(pState, nearestThreat);
                        const avoidStrength = 1.2 + (threatDistance - distanceToThreat) * 0.5;
                        targetXOffset = (pState.x >= nearestThreat.x) ? avoidStrength : -avoidStrength;
                    } else {
                        const lanes = [-6, 0, 6];
                        const DOWNHILL_BONUS = 1.0;
                        let bestLane = { xOffset: 0, minDist: -Infinity };

                        lanes.forEach(xOffset => {
                            const lookAheadPoint = { x: pState.x + xOffset, y: pState.y + visionDistance };
                            const closestDefenderToLane = defenseStates
                                .filter(d => !d.isBlocked && !d.isEngaged)
                                .sort((a, b) => getDistance(lookAheadPoint, a) - getDistance(lookAheadPoint, b))[0];
                            let dist = closestDefenderToLane ? getDistance(lookAheadPoint, closestDefenderToLane) : 100;
                            if (xOffset === 0) {
                                dist += DOWNHILL_BONUS;
                            }
                            if (dist > bestLane.minDist) {
                                bestLane.minDist = dist;
                                bestLane.xOffset = xOffset;
                            }
                        });
                        targetXOffset = bestLane.xOffset;
                    }
                    pState.targetY = Math.min(FIELD_LENGTH - 1.0, pState.y + visionDistance);
                    pState.targetX = pState.x + targetXOffset;
                    break;
                }

                case 'qb_scramble': {
                    const visionDistance = 8.0;
                    let targetXOffset = 0;

                    if (pState.scrambleDirection) {
                        targetXOffset = pState.scrambleDirection * 8;
                        pState.scrambleDirection = null;
                    } else {
                        const lanes = [-8, 0, 8];
                        let bestLane = { xOffset: 0, minDist: -Infinity };
                        lanes.forEach(xOffset => {
                            const lookAheadPoint = { x: pState.x + xOffset, y: pState.y + visionDistance };
                            const closestDefenderToLane = defenseStates
                                .filter(d => !d.isBlocked && !d.isEngaged)
                                .sort((a, b) => getDistance(lookAheadPoint, a) - getDistance(lookAheadPoint, b))[0];
                            const dist = closestDefenderToLane ? getDistance(lookAheadPoint, closestDefenderToLane) : 100;
                            if (dist > bestLane.minDist) {
                                bestLane.minDist = dist;
                                bestLane.xOffset = xOffset;
                            }
                        });
                        targetXOffset = bestLane.xOffset;
                    }
                    pState.targetY = Math.min(FIELD_LENGTH - 1.0, pState.y + visionDistance);
                    pState.targetX = pState.x + targetXOffset;
                    break;
                }

                case 'qb_setup': {
                    const POCKET_RADIUS = 6.0;
                    const STEP_DISTANCE = 0.75;
                    const closestThreat = defenseStates
                        .filter(d =>
                            !d.isBlocked &&
                            !d.isEngaged &&
                            getDistance(pState, d) < POCKET_RADIUS &&
                            d.targetY < pState.y + 2
                        )
                        .sort((a, b) => getDistance(pState, a) - getDistance(pState, b))[0];

                    if (closestThreat) {
                        const dxThreat = closestThreat.x - pState.x;
                        const dyThreat = closestThreat.y - pState.y;
                        const distThreat = getDistance(pState, closestThreat);
                        let escapeX = pState.x - (dxThreat / distThreat) * STEP_DISTANCE;
                        let escapeY = pState.y - (dyThreat / distThreat) * STEP_DISTANCE;

                        if (Math.abs(dxThreat) > dyThreat && escapeY > pState.initialY - 3) {
                            escapeY = pState.y + STEP_DISTANCE * 0.5; // Step up
                            escapeX = pState.x - Math.sign(dxThreat) * STEP_DISTANCE * 0.75;
                        }
                        escapeY = Math.max(pState.initialY - 4, escapeY);
                        pState.targetX = escapeX;
                        pState.targetY = escapeY;
                    } else {
                        if (getDistance(pState, { x: pState.targetX, y: pState.targetY }) < 0.5) {
                            pState.targetX = pState.x;
                            pState.targetY = pState.y; // Hold position
                        }
                    }
                    break;
                }

                case 'idle': default:
                    pState.targetX = pState.x;
                    pState.targetY = pState.y;
                    break;
            }
        }
        // --- Defensive Logic ---
        else {
            if (pState.isBallCarrier) {
                const visionDistance = 10.0;
                const lanes = [-5, 0, 5];
                const DOWNHILL_BONUS = 1.5;
                let bestLane = { xOffset: 0, minDist: -Infinity };
                lanes.forEach(xOffset => {
                    const lookAheadPoint = { x: pState.x + xOffset, y: pState.y - visionDistance };
                    const closestBlockerToLane = offenseStates
                        .filter(o => !o.isBlocked && !o.isEngaged)
                        .sort((a, b) => getDistance(lookAheadPoint, a) - getDistance(lookAheadPoint, b))[0];
                    let dist = closestBlockerToLane ? getDistance(lookAheadPoint, closestBlockerToLane) : 100;
                    if (xOffset === 0) dist += DOWNHILL_BONUS;
                    if (dist > bestLane.minDist) {
                        bestLane.minDist = dist;
                        bestLane.xOffset = xOffset;
                    }
                });
                pState.targetY = Math.max(0.5, pState.y - visionDistance);
                pState.targetX = pState.x + bestLane.xOffset;

            } else {
                const assignment = pState.assignment;
                const diagnosedPlayType = diagnosePlay(pState, playType, offensivePlayKey, playState.tick);
                const isQBScramble = qbState && (qbState.action === 'qb_scramble' || qbState.y > playState.lineOfScrimmage + 1);

                switch (true) {
                    case assignment?.startsWith('man_cover_'): {
                        const targetSlot = assignment.split('man_cover_')[1];
                        const assignedReceiver = offenseStates.find(o => o.slot === targetSlot);
                        if (!assignedReceiver) {
                            pState.assignment = 'zone_hook_curl_middle';
                            target = getZoneCenter('zone_hook_curl_middle', playState.lineOfScrimmage);
                            break;
                        }
                        const isRunPlay = (diagnosedPlayType === 'run' || (ballCarrierState && ballCarrierState.y > playState.lineOfScrimmage));
                        const isSafety = pState.slot.startsWith('DB') && (pState.initialY > playState.lineOfScrimmage + 7);

                        if (isBallInAir) {
                            if (playState.ballState.targetPlayerId === assignedReceiver.id || getDistance(pState, { x: playState.ballState.targetX, y: playState.ballState.targetY }) < 15) {
                                target = { x: playState.ballState.targetX, y: playState.ballState.targetY };
                            } else {
                                target = assignedReceiver;
                            }
                        } else if ((isRunPlay || isQBScramble) && ballCarrierState) {
                            if (isSafety && ballCarrierState.y < playState.lineOfScrimmage + 5) {
                                target = pState;
                            } else {
                                target = ballCarrierState;
                            }
                        } else {
                            target = assignedReceiver;
                        }
                        break;
                    }

                    case assignment?.startsWith('zone_'): {
                        const zoneCenter = getZoneCenter(assignment, playState.lineOfScrimmage);
                        let targetThreat = null;
                        let targetPoint = zoneCenter;
                        const landingSpot = { x: playState.ballState.targetX, y: playState.ballState.targetY };
                        const isDeepZone = assignment.includes('deep');

                        const threatsInZone = offenseStates.filter(o => {
                            if (o.action !== 'run_route' && o.action !== 'route_complete') {
                                return false;
                            }
                            if (isPlayerInZone(o, assignment, playState.lineOfScrimmage)) {
                                return true;
                            }
                            if (isDeepZone) {
                                const zone = zoneBoundaries[assignment];
                                if (!zone) return false;
                                const onOurSide = (o.x >= (zone.minX || 0) && o.x <= (zone.maxX || FIELD_WIDTH));
                                const isDeepThreat = o.y > (playState.lineOfScrimmage + 7);
                                if (onOurSide && isDeepThreat) {
                                    return true;
                                }
                            } else {
                                if (getDistance(pState, o) < 7.0) {
                                    return true;
                                }
                            }
                            return false;
                        });

                        const isGroundThreat = (ballCarrierState && !isBallInAir);

                        if (isBallInAir && isPlayerInZone(landingSpot, assignment, playState.lineOfScrimmage)) {
                            targetPoint = landingSpot;
                            targetThreat = null;
                            break;
                        }

                        else if (isGroundThreat) {
                            if (!isDeepZone) {
                                if (isPlayerInZone(ballCarrierState, assignment, playState.lineOfScrimmage) || getDistance(pState, ballCarrierState) < 8.0) {
                                    targetThreat = ballCarrierState;
                                }
                            } else {
                                if (ballCarrierState.y > (playState.lineOfScrimmage + 5) || isPlayerInZone(ballCarrierState, assignment, playState.lineOfScrimmage)) {
                                    targetThreat = ballCarrierState;
                                } else {
                                    targetPoint = { x: ballCarrierState.x, y: playState.lineOfScrimmage + 10 };
                                    targetThreat = null;
                                }
                            }
                        }

                        else if (threatsInZone.length > 0) {
                            if (isDeepZone) {
                                threatsInZone.sort((a, b) => b.y - a.y);
                                targetThreat = threatsInZone[0];
                            } else {
                                threatsInZone.sort((a, b) => getDistance(pState, a) - getDistance(pState, b));
                                targetThreat = threatsInZone[0];
                            }
                        }

                        else if (threatsInZone.length === 0) {
                            if (isDeepZone && diagnosedPlayType === 'pass') {
                                const isHalfFieldSafety = pState.x < (HASH_LEFT_X - 2) || pState.x > (HASH_RIGHT_X + 2);
                                const isLeftSafety = pState.x < CENTER_X;
                                const intermediateThreats = offenseStates.filter(o => {
                                    if (o.action !== 'run_route' && o.action !== 'route_complete') return false;
                                    const isCrosser = (o.assignment === 'In' || o.assignment === 'Post' || o.assignment === 'Drag');
                                    if (!isCrosser) return false;
                                    const isInMiddle = isPlayerInZone(o, 'zone_hook_curl_middle', playState.lineOfScrimmage);
                                    if (!isInMiddle) return false;
                                    if (isHalfFieldSafety) {
                                        if (isLeftSafety && o.x > CENTER_X + 2) return false;
                                        if (!isLeftSafety && o.x < CENTER_X - 2) return false;
                                    }
                                    return true;
                                });
                                if (intermediateThreats.length > 0) {
                                    intermediateThreats.sort((a, b) => getDistance(pState, a) - getDistance(pState, b));
                                    targetThreat = intermediateThreats[0];
                                    break;
                                }
                            }
                            if (assignment.startsWith('zone_flat_')) {
                                const verticalThreat = offenseStates.find(o =>
                                    (o.action === 'run_route' || o.action === 'route_complete') &&
                                    o.y > pState.y + 5 &&
                                    getDistance(pState, o) < 15
                                );
                                if (verticalThreat) {
                                    const sinkDepth = Math.min(verticalThreat.y, pState.initialY + 7);
                                    targetPoint = { x: pState.x, y: sinkDepth };
                                }
                            }
                        }

                        if (targetThreat) {
                            target = targetThreat;
                        } else {
                            target = targetPoint;
                        }
                        break;
                    }

                    case assignment === 'pass_rush':
                    case assignment === 'blitz_gap':
                    case assignment === 'blitz_edge':
                        if (isBallInAir) {
                            target = { x: ballPos.targetX, y: ballPos.targetY };
                        } else if (ballCarrierState && ballCarrierState.id !== qbState?.id) {
                            target = ballCarrierState;
                        } else if (diagnosedPlayType === 'run' && ballCarrierState) {
                            target = ballCarrierState;
                        } else if (qbState) {
                            target = qbState;
                            const blockerInPath = offenseStates.find(o => !o.engagedWith && getDistance(pState, o) < 2.0 && Math.abs(o.x - pState.x) < 1.0 && ((pState.y < o.y && o.y < (target?.y || pState.y + 5)) || (pState.y > o.y && o.y > (target?.y || pState.y - 5))));
                            if (blockerInPath) {
                                const avoidOffset = (pState.x > blockerInPath.x) ? 1.0 : -1.0;
                                target = { x: pState.x + avoidOffset * 2, y: qbState.y };
                            }
                        } else {
                            target = null;
                        }
                        break;

                    case assignment?.startsWith('run_gap_'):
                    case assignment?.startsWith('run_edge_'):
                        if (isBallInAir) {
                            target = { x: ballPos.targetX, y: ballPos.targetY };
                        } else if (ballCarrierState && ballCarrierState.id !== qbState?.id) {
                            target = ballCarrierState;
                        } else if (diagnosedPlayType === 'pass') {
                            pState.action = 'pass_rush';
                            target = qbState;
                        } else {
                            const runTargetPoint = zoneBoundaries[assignment];
                            const ballSnapX = offenseStates.find(p => p.slot === 'OL2')?.initialX || CENTER_X;
                            target = runTargetPoint ? { x: ballSnapX + (runTargetPoint.xOffset || 0), y: playState.lineOfScrimmage + (runTargetPoint.yOffset || 0) } : { x: pState.x, y: pState.y };
                            if (ballCarrierState && getDistance(pState, ballCarrierState) < 6) {
                                target = ballCarrierState;
                            }
                        }
                        break;

                    case 'spy_QB':
                        if (diagnosedPlayType === 'run' && ballCarrierState) {
                            target = ballCarrierState;
                        } else if (qbState) {
                            if (qbState.action === 'qb_scramble' || qbState.y > playState.lineOfScrimmage + 1) {
                                target = qbState;
                            } else {
                                const spyDepth = 8;
                                target = { x: qbState.x, y: qbState.y + spyDepth };
                            }
                        } else {
                            target = getZoneCenter('zone_hook_curl_middle', playState.lineOfScrimmage);
                        }
                        break;

                    case 'run_support':
                        if (diagnosedPlayType === 'run' && ballCarrierState) {
                            target = { x: ballCarrierState.x, y: ballCarrierState.y };
                        } else if (isBallInAir) {
                            if (getDistance(pState, ballPos) < 15) {
                                target = { x: playState.ballState.targetX, y: playState.ballState.targetY };
                            } else {
                                target = getZoneCenter('zone_deep_middle', playState.lineOfScrimmage);
                            }
                        } else {
                            target = { x: pState.x, y: pState.y + 0.2 };
                        }
                        break;

                    case 'fill_run':
                        if (diagnosedPlayType === 'run' && ballCarrierState) {
                            target = { x: ballCarrierState.x, y: ballCarrierState.y };
                        } else if (diagnosedPlayType === 'pass') {
                            pState.assignment = 'zone_hook_curl_middle';
                            target = getZoneCenter('zone_hook_curl_middle', playState.lineOfScrimmage);
                        } else {
                            target = { x: pState.x, y: pState.y + 0.1 };
                        }
                        break;

                    case 'def_read':
                        if (diagnosedPlayType === 'run' && ballCarrierState) {
                            target = { x: ballCarrierState.x, y: ballCarrierState.y };
                        } else if (diagnosedPlayType === 'pass') {
                            pState.assignment = 'zone_hook_curl_middle';
                            target = getZoneCenter('zone_hook_curl_middle', playState.lineOfScrimmage);
                        } else {
                            target = { x: pState.x, y: pState.y + 0.5 };
                        }
                        break;

                    default:
                        if (isBallInAir) {
                            target = ballPos;
                        } else if (ballCarrierState) {
                            target = ballCarrierState;
                        } else {
                            target = { x: pState.x, y: pState.y };
                        }
                        break;
                }

                if (isPlayerState(target)) {
                    const isManCoverage = pState.assignment.startsWith('man_cover_') && !target.isBallCarrier;

                    if (isManCoverage) {
                        const assignedReceiver = target;
                        const speedDiff = (pState.speed - assignedReceiver.speed);

                        let yCushion = 1.0;
                        if (speedDiff > 10) yCushion = -1.5;
                        else if (speedDiff > 0) yCushion = -0.5;

                        let xLeverage = 0;
                        if (assignedReceiver.x < HASH_LEFT_X) {
                            xLeverage = -1.0;
                        } else if (assignedReceiver.x > HASH_RIGHT_X) {
                            xLeverage = 1.0;
                        } else {
                            xLeverage = (assignedReceiver.x < CENTER_X) ? 1.0 : -1.0;
                        }
                        pState.targetX = assignedReceiver.targetX + xLeverage;
                        pState.targetY = assignedReceiver.targetY + yCushion;

                    } else if (target.isBallCarrier || !pState.isOffense) {
                        // --- "SMART PURSUIT" LOGIC (FOR BALL CARRIER or any non-Man-Coverage defender) ---
                        let isDefenderInFront;
                        if (target.isOffense) {
                            // Defender is pursuing an offensive player
                            isDefenderInFront = pState.y > target.y;
                        } else {
                            // (This case is for an offensive player pursuing a DEFENSIVE carrier)
                            isDefenderInFront = pState.y < target.y;
                        }

                        if (isDefenderInFront) {
                            // --- A. I AM IN FRONT of the target ---
                            // 💡 NEW "BRACKET" LOGIC TO PREVENT BUNCHING 💡

                            // 1. Determine player's "home" side of the field based on their starting X
                            const isPlayerOnLeftSide = pState.initialX < (CENTER_X - 3.0);
                            const isPlayerOnRightSide = pState.initialX > (CENTER_X + 3.0);
                            // (Players in the middle have no leverage)

                            // 2. Determine target's (ball carrier's) current location
                            const isTargetOnLeftSide = target.x < HASH_LEFT_X;
                            const isTargetOnRightSide = target.x > HASH_RIGHT_X;

                            let leverageXOffset = 0;
                            const LEVERAGE_STRENGTH = 1.0; // How far to offset (in yards)

                            // 3. Apply leverage to "fan out"
                            if (isPlayerOnLeftSide && !isTargetOnRightSide) {
                                // My job is the left side, and the runner is on my side or in the middle.
                                // I will target his *outside* (left) shoulder.
                                leverageXOffset = -LEVERAGE_STRENGTH;
                            } else if (isPlayerOnRightSide && !isTargetOnLeftSide) {
                                // My job is the right side, and the runner is on my side or in the middle.
                                // I will target his *outside* (right) shoulder.
                                leverageXOffset = LEVERAGE_STRENGTH;
                            }
                            // else: I am a middle LB, or the runner is on the opposite hash,
                            // so I will attack "head up" with no offset.

                            // 4. Set the final target
                            pState.targetX = target.x + leverageXOffset;
                            pState.targetY = target.y; // Attack head-on vertically

                            // 💡 END NEW LOGIC 💡

                        } else {
                            // --- B. I AM BEHIND the target ---
                            // (This is your existing, excellent "Contain" logic. It remains unchanged.)
                            const distToTarget = getDistance(pState, target);
                            const dx = target.x - pState.x;
                            const dy = target.y - pState.y;

                            const isContainPlayer = (
                                pState.slot.startsWith('DB') ||
                                pState.slot.startsWith('DL1') ||
                                pState.slot.startsWith('DL3') ||
                                pState.slot.startsWith('DL4')
                            );

                            const containDiscipline = isContainPlayer ? 0.65 : 1.0;
                            const maxContainOffset = isContainPlayer ? 3.0 : 0.0;
                            const lateralFactor = Math.min(1.0, Math.abs(dx) / 5.0);
                            const pursuitSpeedFactor = 0.4 + (0.6 * (distToTarget / 10.0));
                            const leadFactor = Math.min(1.0, lateralFactor * pursuitSpeedFactor);

                            let pursuitX = target.x - (dx * leadFactor * containDiscipline);
                            let pursuitY = target.y - (dy * 0.05);

                            if (isContainPlayer) {
                                const sideSign = (pState.initialX < CENTER_X) ? -1 : 1;
                                pursuitX += sideSign * maxContainOffset;
                            }

                            if (distToTarget < 2.0) {
                                pState.targetX = target.x;
                                pState.targetY = target.y;
                            } else {
                                pState.targetX = pursuitX;
                                pState.targetY = pursuitY;
                            }

                        // --- Debug Log (optional) ---
                        if (gameLog && (pState.slot.startsWith('DL1') || pState.slot.startsWith('DB1') || pState.slot.startsWith('LB1'))) {
                            console.log(
                                `%c[PURSUIT] Tick ${playState.tick}: ${pState.name} (${pState.slot}) ` +
                                `→ Target ${target.name} | Dist=${distToTarget.toFixed(1)} | Contain=${isContainPlayer}`,
                                'color: #9999FF'
                            );
                        }
                    }
                    // --- 💡💡💡 END OF USER-PROVIDED FIX 💡💡💡 ---
                }

            } else if (target) {
                pState.targetX = target.x; pState.targetY = target.y;
            } else {
                pState.targetX = pState.x; pState.targetY = pState.y;
            }
        }
    }

        pState.targetX = Math.max(0.5, Math.min(FIELD_WIDTH - 0.5, pState.targetX));
    pState.targetY = Math.max(0.5, Math.min(FIELD_LENGTH - 0.5, pState.targetY));
});
}


/**
 * Checks for block engagements based on proximity.
 */
function checkBlockCollisions(playState) {
    const offenseStates = playState.activePlayers.filter(p => p.isOffense);
    const defenseStates = playState.activePlayers.filter(p => !p.isOffense);

    offenseStates.forEach(blocker => {
        // Skip if blocker is stunned or already engaged
        if (blocker.stunnedTicks > 0 || blocker.isEngaged) {
            return;
        }

        const isRunBlock = blocker.action === 'run_block';
        const isPassBlock = blocker.action === 'pass_block';

        if (isPassBlock || isRunBlock) {
            let targetDefender = null;

            // 1. Check if the assigned target is valid and in range
            if (blocker.dynamicTargetId) {
                const assignedTarget = defenseStates.find(d =>
                    d.id === blocker.dynamicTargetId &&
                    !d.isBlocked &&
                    !d.isEngaged &&
                    d.stunnedTicks === 0
                );

                if (assignedTarget && getDistance(blocker, assignedTarget) < BLOCK_ENGAGE_RANGE) {
                    targetDefender = assignedTarget;
                }
            }

            // 2. Fallback: Check for "help" or "scrape" blocks
            if (!targetDefender) {
                const engagedDefenderIds = new Set(
                    offenseStates.map(o => o.engagedWith).filter(Boolean)
                );

                const defendersInRange = defenseStates.filter(d =>
                    !engagedDefenderIds.has(d.id) &&
                    !d.isBlocked &&
                    !d.isEngaged &&
                    d.stunnedTicks === 0 &&
                    getDistance(blocker, d) < BLOCK_ENGAGE_RANGE
                );

                if (defendersInRange.length > 0) {
                    defendersInRange.sort((a, b) => getDistance(blocker, a) - getDistance(blocker, b));
                    targetDefender = defendersInRange[0];
                }
            }

            // 3. If we found a target, check for a "whiff" before engaging
            if (targetDefender) {

                // --- 💡 NEW "HOLDING" PREVENTION LOGIC 💡 ---
                if (isPassBlock) {
                    // This is a pass play. Check if the defender is *already past* the blocker.
                    // (i.e., defender's Y is less than the blocker's Y)
                    const WHIFF_BUFFER = 0.5; // 0.5 yard buffer
                    if (targetDefender.y < (blocker.y - WHIFF_BUFFER)) {
                        // The defender has beaten the blocker!
                        // Do NOT engage. This prevents "holding" from behind.

                        // If this was our assigned target, we've lost them.
                        if (blocker.dynamicTargetId === targetDefender.id) {
                            blocker.dynamicTargetId = null;
                        }

                        targetDefender = null; // Do not engage
                    }
                }
                // --- 💡 END "HOLDING" LOGIC 💡 ---
            }

            // 4. If we *still* have a valid target, initiate the block
            if (targetDefender) {
                if (blocker.slot.startsWith('OL')) {
                    //console.log(`%c*** BLOCK ENGAGED (Tick: ${playState.tick}) ***: ${blocker.name} (${blocker.slot}) has engaged ${targetDefender.name} (${targetDefender.slot})`, 'color: #00dd00; font-weight: bold;');
                }
                blocker.engagedWith = targetDefender.id;
                blocker.isEngaged = true;
                blocker.dynamicTargetId = targetDefender.id; // Confirm the target

                targetDefender.isBlocked = true;
                targetDefender.blockedBy = blocker.id;
                targetDefender.isEngaged = true;

                playState.blockBattles.push({
                    blockerId: blocker.id, defenderId: targetDefender.id,
                    status: 'ongoing',
                    battleScore: 0,
                    startTick: playState.tick
                });
            }
        }
    });
}
/**
 * Checks for tackle attempts (MODIFIED with Momentum and Successive Tackle Penalty)
 * Assumes: The caller ensures defender.stunnedTicks is reset after a success/play end.
 */
// game.js

function checkTackleCollisions(playState, gameLog) {
    const ballCarrierState = playState.activePlayers.find(p => p.isBallCarrier);
    if (!ballCarrierState) return false;

    const activeDefenders = playState.activePlayers.filter(p =>
        p.teamId !== ballCarrierState.teamId &&
        !p.isBlocked &&
        !p.isEngaged &&
        p.stunnedTicks === 0
    );

    if (ballCarrierState.tacklesBrokenThisPlay === undefined) {
        ballCarrierState.tacklesBrokenThisPlay = 0;
    }

    const MOMENTUM_SCALING_FACTOR = 0.1;
    const TACKLE_RANGE_CHECK = TACKLE_RANGE;

    for (const defender of activeDefenders) {
        if (getDistance(ballCarrierState, defender) < TACKLE_RANGE_CHECK) {

            const carrierPlayer = game.players.find(p => p && p.id === ballCarrierState.id);
            const tacklerPlayer = game.players.find(p => p && p.id === defender.id);
            if (!carrierPlayer || !tacklerPlayer) continue;

            if (checkFumble(carrierPlayer, tacklerPlayer, playState, gameLog)) {
                ballCarrierState.stunnedTicks = 40;
                return false;
            }

            const carrierWeight = carrierPlayer.attributes?.physical?.weight || 180;
            const carrierSpeed = ballCarrierState.currentSpeedYPS || 0;
            const successiveTacklePenalty = ballCarrierState.tacklesBrokenThisPlay * 0.20;
            const skillModifier = Math.max(0.1, 1.0 - successiveTacklePenalty);
            const carrierSkill = (
                (carrierPlayer.attributes?.physical?.agility || 50) * 1.0 +
                (carrierPlayer.attributes?.physical?.strength || 50) * 0.5
            ) * skillModifier;
            const carrierMomentum = (carrierWeight * carrierSpeed) * MOMENTUM_SCALING_FACTOR;
            const breakPower = (carrierSkill + carrierMomentum) * ballCarrierState.fatigueModifier;

            // --- 2. Tackler's Power (Easier to Tackle) ---
            const tacklerWeight = tacklerPlayer.attributes?.physical?.weight || 200;
            const tacklerSpeed = defender.currentSpeedYPS || 0;
            // Base "Tackle" skill = 100% Tackling + 50% Strength
            const tacklerSkill = (
                (tacklerPlayer.attributes?.technical?.tackling || 50) * 1.0 +
                (tacklerPlayer.attributes?.physical?.strength || 50) * 0.5
            );
            // Momentum Bonus (Tacklers get a 1.5x bonus for hitting hard)
            const tacklerMomentum = (tacklerWeight * tacklerSpeed) * (MOMENTUM_SCALING_FACTOR * 1.5);
            const tacklePower = (tacklerSkill + tacklerMomentum) * defender.fatigueModifier;
            // --- 3. The Resolution (More Predictable) ---
            const roll = getRandomInt(-10, 10);
            const diff = (breakPower + roll) - tacklePower;

            if (diff <= 0) { // Tackle success
                playState.yards = ballCarrierState.y - playState.lineOfScrimmage;
                playState.playIsLive = false;
                ensureStats(tacklerPlayer); 
                tacklerPlayer.gameStats.tackles = (tacklerPlayer.gameStats.tackles || 0) + 1;


                if (ballCarrierState.slot === 'QB1' && (ballCarrierState.action === 'qb_setup' || ballCarrierState.action === 'qb_scramble') && ballCarrierState.y < playState.lineOfScrimmage) {

                    playState.sack = true;
                    if (gameLog) gameLog.push(`💥 SACK! ${tacklerPlayer.name} (TklPwr: ${tacklePower.toFixed(0)}) gets to ${ballCarrierState.name}!`);

                    tacklerPlayer.gameStats.sacks = (tacklerPlayer.gameStats.sacks || 0) + 1;
                } else {
                    if (gameLog) gameLog.push(`✋ ${ballCarrierState.name} tackled by ${defender.name} (TklPwr: ${tacklePower.toFixed(0)}) for a gain of ${playState.yards.toFixed(1)} yards.`);
                }

                return true; // Play ended
            } else { // Broken tackle (Juke)
                ballCarrierState.tacklesBrokenThisPlay++;
                ballCarrierState.action = 'juke';
                ballCarrierState.jukeTicks = 12;
                ballCarrierState.currentSpeedYPS *= 0.5;

                if (gameLog) gameLog.push(`💥 ${ballCarrierState.name} (BrkPwr: ${breakPower.toFixed(0)}) breaks tackle from ${defender.name} (TklPwr: ${tacklePower.toFixed(0)})!`);
                defender.stunnedTicks = 40;

                const JUKE_STUN_RADIUS = 3.0;
                playState.activePlayers.forEach(p => {
                    if (!p.isOffense && p.id !== defender.id && p.stunnedTicks === 0 && getDistance(ballCarrierState, p) < JUKE_STUN_RADIUS) {
                        p.stunnedTicks = 15;
                        if (gameLog) gameLog.push(`[Juke]: ${p.name} was juked out of the play!`);
                    }
                });
            }
        }
    }
    return false; // Play continues
}

/**
 * Checks if any player is close enough to recover a loose ball.
 * This is the "battle" logic.
 * @returns {object|null} The player state (pState) of the recoverer, or null.
 */
function checkFumbleRecovery(playState, gameLog, TACKLE_RANGE) {
    if (!playState.ballState.isLoose) return null;

    const ballPos = playState.ballState;

    // Find all active, non-stunned players within recovery range
    const playersInRange = playState.activePlayers.filter(p =>
        p.stunnedTicks === 0 &&
        !p.isEngaged &&
        getDistance(p, ballPos) < TACKLE_RANGE
    );

    if (playersInRange.length === 0) {
        return null; // No one is close enough, ball is still loose
    }

    // --- A "Battle" happens! ---
    // Every player in range gets a "recovery score"
    let bestPlayer = null;
    let maxScore = -Infinity;

    playersInRange.forEach(p => {
        // Agility, Hands, and Toughness matter
        const skill = (p.agility * 0.4) + (p.catchingHands * 0.4) + (p.toughness * 0.2);

        // Proximity is the most important factor
        const distance = getDistance(p, ballPos);
        const proximityBonus = (TACKLE_RANGE - distance) * 50; // Huge bonus for being on top of it

        const roll = getRandomInt(-10, 10);
        const finalScore = skill + proximityBonus + roll;

        if (finalScore > maxScore) {
            maxScore = finalScore;
            bestPlayer = p;
        }
    });

    // We have a winner
    return bestPlayer;
}

/**
 * Abstract helper to resolve a contested battle.
 * Modifies the 'battle' object directly.
 */
function resolveBattle(powerA, powerB, battle) {
    // 1. Calculate base difference
    const BASE_DIFF = powerA - powerB;

    // 2. Add controlled randomness
    const roll = getRandomInt(-15, 15);

    // 3. Calculate the "push" for this tick
    const finalDiff = (BASE_DIFF + roll) / 100;

    // 4. Apply the "push" to the battle score
    battle.battleScore += finalDiff;

    // 5. Define the "reasonable numbers" (Win Threshold)
    const WIN_SCORE = 6;

    // 6. Check for a winner
    if (battle.battleScore > WIN_SCORE) {
        battle.status = 'win_A';
    } else if (battle.battleScore < -WIN_SCORE) {
        battle.status = 'win_B';
    } else {
        battle.status = 'ongoing';
    }

    // 7. 💡 NEW: Return the push amount
    return finalDiff;
}

/**
 * Resolves ongoing block battles based on stats.
 */
function resolveOngoingBlocks(playState, gameLog) {
    const battlesToRemove = [];
    playState.blockBattles.forEach((battle, index) => {
        if (battle.startTick === playState.tick) {
            return;
        }
        if (battle.status !== 'ongoing') {
            battlesToRemove.push(index);
            return;
        }

        const blockerState = playState.activePlayers.find(p => p.id === battle.blockerId);
        const defenderState = playState.activePlayers.find(p => p.id === battle.defenderId);

        // Check if players are still valid and engaged
        if (!blockerState || !defenderState || blockerState.engagedWith !== defenderState.id || defenderState.blockedBy !== blockerState.id) {
            battle.status = 'disengaged';
            battlesToRemove.push(index);
            if (blockerState) { blockerState.engagedWith = null; blockerState.isEngaged = false; }
            if (defenderState) { defenderState.isBlocked = false; defenderState.blockedBy = null; defenderState.isEngaged = false; }
            return;
        }

        // Check for distance-based disengagement
        if (getDistance(blockerState, defenderState) > BLOCK_ENGAGE_RANGE + 0.5) {
            battle.status = 'disengaged';
            battlesToRemove.push(index);
            blockerState.engagedWith = null; blockerState.isEngaged = false;
            defenderState.isBlocked = false; defenderState.blockedBy = null; defenderState.isEngaged = false;
            return;
        }

        const blockPower = ((blockerState.blocking || 50) + (blockerState.strength || 50)) * blockerState.fatigueModifier;
        const shedPower = ((defenderState.blockShedding || 50) + (defenderState.strength || 50)) * defenderState.fatigueModifier;

        // --- Call the battle helper, which updates battle.status AND returns the push ---
        // 💡 MODIFIED: Capture the return value
        const pushAmount = resolveBattle(blockPower, shedPower, battle);

        // --- 💡 NEW: Apply the "Push" ---
        if (battle.status === 'ongoing') {
            // Calculate push direction (from blocker to defender)
            const dx = defenderState.x - blockerState.x;
            const dy = defenderState.y - blockerState.y;
            const dist = Math.max(0.1, Math.sqrt(dx * dx + dy * dy));
            const pushDirX = dx / dist;
            const pushDirY = dy / dist;

            // 'pushAmount' is the distance. Positive = blocker wins, pushes defender.
            // Negative = defender wins, pushes blocker.
            const PUSH_SCALING_FACTOR = 0.5; // Controls how fast the push is
            const moveDist = pushAmount * PUSH_SCALING_FACTOR;

            // Move both players along the "line" of the battle
            // (updatePlayerPosition will NOT move them, so this is safe)
            blockerState.x += pushDirX * moveDist;
            blockerState.y += pushDirY * moveDist;
            defenderState.x += pushDirX * moveDist;
            defenderState.y += pushDirY * moveDist;

            // Clamp their new positions
            blockerState.x = Math.max(0.5, Math.min(FIELD_WIDTH - 0.5, blockerState.x));
            blockerState.y = Math.max(0.5, Math.min(FIELD_LENGTH - 0.5, blockerState.y));
            defenderState.x = Math.max(0.5, Math.min(FIELD_WIDTH - 0.5, defenderState.x));
            defenderState.y = Math.max(0.5, Math.min(FIELD_LENGTH - 0.5, defenderState.y));
        }
        // --- 💡 END NEW PUSH LOGIC ---

        // --- Handle battle win/loss logic ---
        if (battle.status === 'win_B') {
            // ... (defender wins logic)
            blockerState.stunnedTicks = 80;
            blockerState.engagedWith = null; blockerState.isEngaged = false;
            defenderState.isBlocked = false; defenderState.blockedBy = null; defenderState.isEngaged = false;
            battlesToRemove.push(index);

        } else if (battle.status === 'win_A') {
            // ... (blocker wins logic)
            defenderState.stunnedTicks = 80;
            blockerState.engagedWith = null; blockerState.isEngaged = false;
            defenderState.isBlocked = false; defenderState.blockedBy = null; defenderState.isEngaged = false;
            battlesToRemove.push(index);
        }
    });

    // Clean up all completed battles
    for (let i = battlesToRemove.length - 1; i >= 0; i--) {
        playState.blockBattles.splice(battlesToRemove[i], 1);
    }
}

/**
 * Handles QB decision-making (throw, scramble, checkdown).
 */
function updateQBDecision(playState, offenseStates, defenseStates, gameLog, aiTickMultiplier = 1) { 
    const qbState = offenseStates.find(p => p.slot === 'QB1' && (p.hasBall || p.isBallCarrier));
    if (!qbState || playState.ballState.inAir) return; // Exit if no QB with ball or ball already thrown
    if (qbState.isBallCarrier && qbState.action !== 'qb_scramble') return;

    const qbPlayer = game.players.find(p => p && p.id === qbState.id);
    if (!qbPlayer || !qbPlayer.attributes) return;

    const qbAttrs = qbPlayer.attributes;
    const qbIQ = Math.max(20, Math.min(99, qbAttrs.mental?.playbookIQ ?? 50)); // Clamp IQ for safety

    // --- If QB is scrambling, check for a throw ---
    if (qbState.action === 'qb_scramble') {
        // Chance to even *look* for a throw on the run
        if (Math.random() < (qbIQ / 150)) {
            // Re-scan for *very* open receivers
            const scramblingReceivers = offenseStates.filter(p => p.action === 'run_route' || p.action === 'route_complete');
            const scramblingOpenReceivers = scramblingReceivers.filter(recState => {

                // We must calculate separation *inside* the filter
                const closestDefender = defenseStates.filter(d => !d.isBlocked && !d.isEngaged)
                    .sort((a, b) => getDistance(recState, a) - getDistance(recState, b))[0];
                const separation = closestDefender ? getDistance(recState, closestDefender) : 100;

                // Must be more open for a throw on the run
                return separation > SEPARATION_THRESHOLD + 1.5;

            }).sort((a, b) => getDistance(qbState, a) - getDistance(qbState, b)); // Sort by closest

            if (scramblingOpenReceivers.length > 0) {
                // --- DECIDED TO THROW ON THE RUN ---
                qbState.action = 'qb_setup';
                qbState.hasBall = true;
                qbState.isBallCarrier = false;
                // We now let the function continue to the main decision logic
            } else {
                // --- No one open, continue scrambling ---
                return; // CRITICAL: Exit function and let updatePlayerTargets handle movement
            }
        } else {
            // If they fail the "look for throw" check, force them to keep running
            return;
        }
    }

    const qbConsistency = qbAttrs.mental?.consistency || 50;
    const qbAgility = qbAttrs.physical?.agility || 50;
    const qbToughness = qbAttrs.mental?.toughness || 50;

    // --- 1. Assess Pressure ---
    const pressureDefender = defenseStates.find(d => !d.isBlocked && !d.isEngaged && getDistance(qbState, d) < 4.5);
    const isPressured = !!pressureDefender;
    const imminentSackDefender = isPressured && getDistance(qbState, pressureDefender) < TACKLE_RANGE + 0.2;

    // --- 2. Scan Receivers (Based on Progression) (REVISED) ---

    // Helper to find a receiver's state and separation
    const getTargetInfo = (slot) => {
        if (!slot) return null; // Handle end of progression
        const recState = offenseStates.find(r => r.slot === slot && (r.action === 'run_route' || r.action === 'route_complete'));
        if (!recState) return null; // Receiver not in a route

        const closestDefender = defenseStates.filter(d => !d.isBlocked && !d.isEngaged)
            .sort((a, b) => getDistance(recState, a) - getDistance(recState, b))[0];
        const separation = closestDefender ? getDistance(recState, closestDefender) : 100;
        const distFromQB = getDistance(qbState, recState);

        return { ...recState, separation, distFromQB };
    };

    // 1. Get info for *all* receivers in the progression
    const allReadInfos = qbState.readProgression.map(slot => getTargetInfo(slot));

    // 2. Identify the current read
    const currentReadIndex = qbState.readProgression.indexOf(qbState.currentReadTargetSlot);
    const currentRead = allReadInfos[currentReadIndex] || null;

    // 3. Identify the checkdown (the *last* receiver in the progression)
    const read_checkdown = allReadInfos[allReadInfos.length - 1] || null;

    // 4. Identify all *other* primary reads (not the checkdown)
    const openPrimaryReads = allReadInfos
        .slice(0, allReadInfos.length - 1) // Get all reads *except* the last one
        .filter(r => r && r.separation > SEPARATION_THRESHOLD)
        .sort((a, b) => b.separation - a.separation); // Find the *most* open one
    // --- END REPLACEMENT ---


    // --- 3. Update Read Progression ---
    const READ_PROGRESSION_DELAY = Math.max(12, Math.round((100 - qbIQ) / 8));
    const initialReadTicks = 20;
    
    let decisionMade = false;

    if (playState.tick > initialReadTicks && !isPressured && !decisionMade) {
        qbState.ticksOnCurrentRead++;

        if (qbState.ticksOnCurrentRead > READ_PROGRESSION_DELAY) {
            // Time to switch reads
            const currentReadIndex = qbState.readProgression.indexOf(qbState.currentReadTargetSlot);

            // Use modulo (%) to loop the progression
            // (e.g., if length is 3)
            // (0 + 1) % 3 = 1
            // (1 + 1) % 3 = 2
            // (2 + 1) % 3 = 0  <-- Loops back to the start!
            const nextReadIndex = (currentReadIndex + 1) % qbState.readProgression.length;

            const nextReadSlot = qbState.readProgression[nextReadIndex];
            qbState.currentReadTargetSlot = nextReadSlot;
            qbState.ticksOnCurrentRead = 0;
        }
    }

    // --- 4. Decision Timing Logic (REVISED) ---
    // Decision time scales with IQ: higher IQ = more patience
    const baseDecisionTicks = 60;
    const iqPenaltyTicks = Math.round((100 - qbIQ) * 0.5);
    const calmnessBonus = Math.round(qbIQ * 0.2);
    const maxDecisionTimeTicks = baseDecisionTicks + iqPenaltyTicks + calmnessBonus;
    const pressureTimeReduction = isPressured ? Math.max(20, Math.round((100 - qbIQ) * 0.3)) : 0;
    const currentDecisionTickTarget = maxDecisionTimeTicks - pressureTimeReduction;

    let reason = "";

    if (imminentSackDefender) {
        decisionMade = true;
        reason = "Imminent Sack";
    } else if (playState.tick >= currentDecisionTickTarget) {
        decisionMade = true;
        reason = "Decision Time Expired";
    } else if (isPressured && playState.tick >= initialReadTicks) {
        // Panic chance scales with IQ: higher IQ = less panic
        const panicChance = Math.max(0.15, 0.6 - qbIQ / 200); // 0.6 for 20 IQ, 0.1 for 99 IQ
        if (Math.random() < panicChance + (playState.tick / 200)) {
            decisionMade = true;
            reason = "Pressured Decision";
        }
    }

    // --- 5. Execute Decision ---
    if (decisionMade) {
        let targetPlayerState = null;
        let actionTaken = "None";

        // --- NEW PROGRESSION-BASED DECISION ---

        // 1. How open does the *current read* need to be?
        let rhythmSepThreshold = SEPARATION_THRESHOLD + (isPressured ? 1.0 : 0.0);

        const currentReadIsOpen = currentRead && currentRead.separation > rhythmSepThreshold;

        // 2. Is the *checkdown* open?
        const checkdownIsOpen = read_checkdown && read_checkdown.separation > SEPARATION_THRESHOLD;

        // 3. Are *any* of the main reads open? (This is your fallback)
        // const openPrimaryReads = [read1, read2].filter(...) 

        // --- 4. Scramble/Panic logic (IQ-based) ---
        const baseScrambleChance = (qbAgility / 120) + (qbIQ / 300); // Higher IQ = more likely to scramble correctly
        // Check for open running lane: no defenders within 6 yards in front of QB
        const openLane = !defenseStates.some(d => !d.isBlocked && !d.isEngaged && Math.abs(d.x - qbState.x) < 4 && (d.y < qbState.y) && getDistance(qbState, d) < 6);
        // Common sense baseline: always scramble if lane is wide open and no pass is available
        const canScramble = openLane && ((isPressured && Math.random() < baseScrambleChance) || playState.tick > initialReadTicks + 10);

        // --- QB makes the decision based on this priority: ---

        if (currentReadIsOpen) {
            // --- 1. Throw to Current Read (In Rhythm) ---
            targetPlayerState = currentRead;
            actionTaken = "Throw Current Read";
            if (gameLog) gameLog.push(`[QB Read]: 🎯 ${qbState.name} (IQ: ${qbIQ}) hits his read ${targetPlayerState.name} in rhythm!`);

        } else if (qbIQ > 55 && openPrimaryReads.length > 0 && Math.random() < 0.7) {
            // --- 2. (IQ CHECK) Find another open primary read ---
            targetPlayerState = openPrimaryReads[0];
            actionTaken = "Throw Fallback Read";
            if (gameLog) gameLog.push(`[QB Read]: 🧠 ${qbState.name} (IQ: ${qbIQ})'s progression was covered, finds a late open read in ${targetPlayerState.name}!`);

        } else if (checkdownIsOpen) {
            // --- 3. Throw to Checkdown (Safe Play) ---
            targetPlayerState = read_checkdown;
            actionTaken = "Throw Checkdown";
            if (isPressured) {
                if (gameLog) gameLog.push(`[QB Read]: 🔒 ${qbState.name} feels pressure, dumps to checkdown ${targetPlayerState.name}.`);
            } else {
                if (gameLog) gameLog.push(`[QB Read]: 🔒 ${qbState.name} (IQ: ${qbIQ})'s read was covered. Checking down to ${targetPlayerState.name}.`);
            }

        } else if (canScramble) {
            // --- 4. Scramble ---
            qbState.action = 'qb_scramble';
            qbState.scrambleDirection = 0; // Forward
            qbState.hasBall = false;
            qbState.isBallCarrier = true;
            playState.ballState.x = qbState.x; playState.ballState.y = qbState.y;
            if (gameLog) gameLog.push(`🏃 ${qbState.name} ${imminentSackDefender ? 'escapes the sack' : 'finds open lane'} and scrambles forward!`);
            actionTaken = "Scramble";
            return;

        } else {
            // --- 5. Throw Away / Force It (IQ-based) ---
            const clutch = qbAttrs.mental?.clutch || 50;
            // Only throw away if no open lane and decision timer expired or imminent sack
            if ((!openLane && (isPressured || playState.tick >= currentDecisionTickTarget)) || imminentSackDefender) {
                // High IQ QBs less likely to throw away unless truly forced
                if (qbIQ > 60 && Math.random() < 0.3) {
                    // Try to extend play a bit longer
                    return;
                }
                targetPlayerState = null;
                actionTaken = "Throw Away";
            } else if (isPressured && (qbIQ < 45 || clutch > 80) && currentRead && Math.random() < (0.3 + (60 - qbIQ) / 100)) {
                // --- Force a bad throw: low IQ QBs more likely to force it ---
                targetPlayerState = currentRead;
                actionTaken = "Forced Throw";
                if (gameLog) gameLog.push(`[QB Read]: ⚠️ ${qbState.name} is pressured and forces a bad throw to ${targetPlayerState.name}!`);
            } else {
                // Wait for play to develop
                return;
            }
        }

        // --- Perform Throw or Handle Sack/Throw Away ---
        if (targetPlayerState && (actionTaken.includes("Throw"))) {
            // --- Initiate Throw ---
            if (gameLog) gameLog.push(`🏈 ${qbState.name} [${reason}] ${actionTaken.includes("Checkdown") ? 'checks down to' : 'throws to'} ${targetPlayerState.name}...`);
            playState.ballState.inAir = true;
            playState.ballState.targetPlayerId = targetPlayerState.id;
            playState.ballState.throwerId = qbState.id;
            playState.ballState.throwInitiated = true;
            qbState.hasBall = false;
            qbState.isBallCarrier = false;

            // Sync ball to QB's current position
            playState.ballState.x = qbState.x;
            playState.ballState.y = qbState.y;

            // --- Improved Ball Physics with Leading ---

            // 1. Estimate distance and airTime to the receiver's CURRENT position
            const est_dx = targetPlayerState.x - qbState.x;
            const est_dy = targetPlayerState.y - qbState.y;
            const est_distance = Math.sqrt(est_dx * est_dx + est_dy * est_dy);
            const throwSpeedYPS = 25 + (qbAttrs.physical?.strength || 50) / 10;
            let est_airTime = Math.max(0.3, est_distance / throwSpeedYPS);

            // 2. Predict receiver's future position (the "perfect" aim point)
            const rec_dx = targetPlayerState.targetX - targetPlayerState.x;
            const rec_dy = targetPlayerState.targetY - targetPlayerState.y;
            const rec_distToTarget = Math.sqrt(rec_dx * rec_dx + rec_dy * rec_dy);

            const MIN_SPEED_YPS = 3.5;
            const MAX_SPEED_YPS = 8.0;
            const rec_speedYPS = MIN_SPEED_YPS + ((targetPlayerState.speed || 50) - 1) * (MAX_SPEED_YPS - MIN_SPEED_YPS) / (99 - 1);
            const rec_moveDist = rec_speedYPS * targetPlayerState.fatigueModifier * est_airTime;

            const targetLeadFactor = 0.9;

            let aimX = targetPlayerState.x;
            let aimY = targetPlayerState.y;

            if (rec_distToTarget > 0.1) { // If receiver is still moving
                aimX += (rec_dx / rec_distToTarget) * rec_moveDist * targetLeadFactor;
                aimY += (rec_dy / rec_distToTarget) * rec_moveDist * targetLeadFactor;
            }

            // 3. Calculate distance to the "perfect" aim point
            const dx_perfect = aimX - qbState.x;
            const dy_perfect = aimY - qbState.y;
            const distance_perfect = Math.max(0.1, Math.sqrt(dx_perfect * dx_perfect + dy_perfect * dy_perfect));

            // 4. Apply accuracy penalties as a DISTANCE (in yards)
            const accuracy = qbAttrs.technical?.throwingAccuracy || 50;
            const accuracyPenalty = (100 - accuracy) / 100; // 0.0 (perfect) to 1.0 (bad)
            const pressurePenalty = isPressured ? 2.5 : 1.0;

            const maxErrorDistance = (distance_perfect / 10) * accuracyPenalty * pressurePenalty;

            // --- NEW "CIRCULAR" ERROR LOGIC ---
            const errorDistance = Math.random() * maxErrorDistance;
            const errorAngle = Math.random() * 2 * Math.PI;
            const xError = Math.cos(errorAngle) * errorDistance;
            const yError = Math.sin(errorAngle) * errorDistance;
            // --- END NEW LOGIC ---

            // 5. Calculate the *actual* final landing spot
            const finalAimX = aimX + xError;
            const finalAimY = aimY + yError;

            // 6. CLAMP the final landing spot to be IN-BOUNDS
            const MIN_X = 1.0;
            const MAX_X = FIELD_WIDTH - 1.0;
            const MIN_Y = 1.0;
            const MAX_Y = FIELD_LENGTH - 1.0;

            const clampedAimX = Math.max(MIN_X, Math.min(MAX_X, finalAimX));
            const clampedAimY = Math.max(MIN_Y, Math.min(MAX_Y, finalAimY));

            // 7. Calculate final velocity needed to hit the *clamped, errored* spot
            const dx_final = clampedAimX - qbState.x;
            const dy_final = clampedAimY - qbState.y;
            const distance_final = Math.sqrt(dx_final * dx_final + dy_final * dy_final);

            const airTime = Math.max(0.3, distance_final / throwSpeedYPS);

            playState.ballState.vx = dx_final / airTime;
            playState.ballState.vy = dy_final / airTime;
            const g = 9.8;
            playState.ballState.vz = (g * airTime) / 2;

            // 8. Set the ball's target AND the receiver's target to the SAME spot
            playState.ballState.targetX = clampedAimX;
            playState.ballState.targetY = clampedAimY;

            if (gameLog) gameLog.push(`[DEBUG] QB aiming at: (${clampedAimX.toFixed(1)}, ${clampedAimY.toFixed(1)})`);
            // --- End Ball Physics ---

        } else if (imminentSackDefender && actionTaken !== "Scramble") {
            // QB held it too long waiting for sack
            if (gameLog) gameLog.push(`⏳ ${qbState.name} holds it too long...`);
            // Sack will be handled by checkTackleCollisions on next tick
        } else {
            // No target found or decided to throw away
            if (gameLog) gameLog.push(`⤴️ ${qbState.name} ${isPressured ? 'feels the pressure and' : ''} throws it away!`);
            playState.incomplete = true;
            playState.playIsLive = false;
            playState.ballState.inAir = false;
            playState.ballState.throwInitiated = true;
            playState.ballState.throwerId = qbState.id;
            qbState.hasBall = false;
            qbState.isBallCarrier = false;
        }

    } else if (isPressured && qbState.action === 'qb_setup') {
        // Still in setup phase, but pressured -> Evasive movement
        const pressureDirX = Math.sign(qbState.x - pressureDefender.x);
        qbState.targetX = qbState.x + pressureDirX * 1.5; // Step away from pressure
        qbState.targetY = qbState.y - 0.3; // Slight drift back/shuffle
    }
}
// game.js

/**
 * Handles ball arrival at target coordinates. (MODIFIED)
 */
function handleBallArrival(playState, gameLog) {
    // 1. Ball Height Check
    if (!playState.ballState.inAir) return; // Ball not in air

    if (playState.ballState.z > 2.5) { // Check if ball is too high
        if (gameLog) gameLog.push(`‹‹ Pass is thrown **too high**. Incomplete.`);
        playState.incomplete = true; playState.playIsLive = false; playState.ballState.inAir = false;
        return; // Play is over
    }
    if (playState.ballState.z < 0.1) { // Check if ball is too low
        if (gameLog) gameLog.push(`‹‹ Pass is thrown **too low** and hits the ground. Incomplete.`);
        playState.incomplete = true; playState.playIsLive = false; playState.ballState.inAir = false;
        return; // Play is over
    }
    // If we are here, ball is at a catchable height (0.1 - 2.5)

    // 2. Check if Target Receiver is Valid
    const targetPlayerState = playState.activePlayers.find(p => p.id === playState.ballState.targetPlayerId);
    if (!targetPlayerState) {
        if (gameLog) gameLog.push("‹‹ Pass intended target not found. Incomplete.");
        playState.incomplete = true; playState.playIsLive = false; playState.ballState.inAir = false;
        return;
    }

    // 3. Find Key Players and Distances
    const CATCH_CHECK_RADIUS = 2.5;
    const receiverPlayer = game.players.find(p => p && p.id === targetPlayerState.id); // Get full receiver object

    const closestDefenderState = playState.activePlayers
        .filter(p => !p.isOffense && !p.isBlocked && !p.isEngaged)
        .sort((a, b) => getDistance(a, playState.ballState) - getDistance(b, playState.ballState))[0];

    const defenderPlayer = closestDefenderState ? game.players.find(p => p && p.id === closestDefenderState.id) : null;

    const throwerPlayer = game.players.find(p => p && p.id === playState.ballState.throwerId);
    ensureStats(throwerPlayer); 

    const receiverInRange = getDistance(targetPlayerState, playState.ballState) < CATCH_CHECK_RADIUS;
    const defenderInRange = closestDefenderState && getDistance(closestDefenderState, playState.ballState) < CATCH_CHECK_RADIUS;

    let eventResolved = false;

    // 4. Interception Attempt (Only if defender is in range)
    if (defenderInRange && defenderPlayer?.attributes) {
        const defCatchSkill = defenderPlayer.attributes.technical?.catchingHands || 30;
        const defAgility = defenderPlayer.attributes.physical?.agility || 50;
        let defenderPower = (defCatchSkill * 0.6 + defAgility * 0.4) * closestDefenderState.fatigueModifier;

        let receiverPresencePenalty = 0;
        if (receiverInRange && receiverPlayer?.attributes) {
            const recCatchSkill = receiverPlayer.attributes.technical?.catchingHands || 50;
            const recStrength = receiverPlayer.attributes.physical?.strength || 50;
            receiverPresencePenalty = ((recCatchSkill * 0.5 + recStrength * 0.2) * targetPlayerState.fatigueModifier) / 3;
        }

        const distToBallDef = getDistance(closestDefenderState, playState.ballState);
        const proximityBonus = Math.max(0, (CATCH_CHECK_RADIUS - distToBallDef) * 20); // Bonus for being closer
        defenderPower += proximityBonus - receiverPresencePenalty;

        if (defenderPower + getRandomInt(0, 35) > 85) { // Threshold for INT
            eventResolved = true;
            if (gameLog) gameLog.push(`❗ INTERCEPTION! ${closestDefenderState.name} (Catch: ${defCatchSkill}) jumps the route!`);
            playState.turnover = true;

            closestDefenderState.isBallCarrier = true;
            closestDefenderState.hasBall = true;
            closestDefenderState.action = 'run_path';
            closestDefenderState.targetY = 0;
            closestDefenderState.targetX = closestDefenderState.x;
            playState.activePlayers.forEach(p => {
                p.hasBall = (p.id === closestDefenderState.id);
                p.isBallCarrier = (p.id === closestDefenderState.id);
                if (p.isOffense) { p.action = 'pursuit'; }
                else if (p.id !== closestDefenderState.id) { p.action = 'run_block'; }
            });

            ensureStats(defenderPlayer);
            defenderPlayer.gameStats.interceptions = (defenderPlayer.gameStats.interceptions || 0) + 1;

            if (throwerPlayer) {
                throwerPlayer.gameStats.interceptionsThrown = (throwerPlayer.gameStats.interceptionsThrown || 0) + 1;
            }
        }
    }
    // --- END 4. INT ATTEMPT ---

    const distToBallDef = defenderInRange ? getDistance(closestDefenderState, playState.ballState) : Infinity;
    const distToBallRec = receiverInRange ? getDistance(targetPlayerState, playState.ballState) : Infinity;

    if (!eventResolved && defenderInRange && receiverInRange && (distToBallDef <= distToBallRec)) {
        const defAgility = defenderPlayer.attributes.physical?.agility || 50;
        const defStrength = defenderPlayer.attributes.physical?.strength || 50;
        let pbuPower = (defAgility * 0.7 + defStrength * 0.3) * closestDefenderState.fatigueModifier;

        if (distToBallDef < distToBallRec - 1.0) { // 1+ yard advantage
            pbuPower += 15;
        }

        if (pbuPower + getRandomInt(0, 30) > 50) { // Threshold for a contested PBU
            eventResolved = true;
            if (gameLog) gameLog.push(`🚫 **SWATTED!** ${closestDefenderState.name} breaks up the pass to ${targetPlayerState.name}!`);
            playState.incomplete = true;
            playState.playIsLive = false;
        }
    }

    else if (!eventResolved && defenderInRange && !receiverInRange) {
        eventResolved = true; // The defender resolved this play
        if (gameLog) gameLog.push(`🚫 **SWATTED!** Pass to ${targetPlayerState.name} is broken up by ${closestDefenderState.name}!`);
        playState.incomplete = true;
        playState.playIsLive = false;
    }

    // 5. Catch / Drop Attempt
    if (!eventResolved && receiverInRange && receiverPlayer?.attributes) {
        eventResolved = true; // Mark that we are resolving the play here
        const recCatchSkill = receiverPlayer.attributes.technical?.catchingHands || 50;
        const recConsistency = receiverPlayer.attributes.mental?.consistency || 50;
        let receiverPower = (recCatchSkill * 0.8 + recConsistency * 0.2) * targetPlayerState.fatigueModifier;

        let interferencePenalty = 0;
        const interferenceRadius = 2.0;

        if (defenderInRange && closestDefenderState) {
            const distToReceiver = getDistance(targetPlayerState, closestDefenderState);

            if (distToReceiver < interferenceRadius) { // Defender is in the receiver's space
                const defAgility = closestDefenderState.agility || 50;
                const defStrength = closestDefenderState.strength || 50;
                const penaltyFactor = (1.0 - (distToReceiver / interferenceRadius));
                interferencePenalty = ((defAgility * 0.6 + defStrength * 0.2) / 3) * penaltyFactor;
            }
        }

        const receiverProximity = getDistance(targetPlayerState, playState.ballState);
        const proximityBonusRec = Math.max(0, (CATCH_CHECK_RADIUS - receiverProximity) * 15);
        receiverPower += proximityBonusRec;

        let positionalPenalty = 0;
        if (interferencePenalty > 0 && closestDefenderState) {
            if (closestDefenderState.y < targetPlayerState.y) {
                positionalPenalty = 20;
            } else {
                positionalPenalty = -10;
            }
        }

        const catchRoll = receiverPower + getRandomInt(0, 20);
        const difficulty = interferencePenalty + positionalPenalty + 25 + getRandomInt(0, 10); // Base difficulty 25-35

        if (catchRoll > difficulty) { // Catch successful!
            targetPlayerState.isBallCarrier = true; targetPlayerState.hasBall = true;
            targetPlayerState.action = 'run_path';
            playState.yards = targetPlayerState.y - playState.lineOfScrimmage;
            if (interferencePenalty > 10) {
                if (gameLog) gameLog.push(`👍 CATCH! ${targetPlayerState.name} (Catch: ${recCatchSkill}) makes a tough contested reception!`);
            } else {
                if (gameLog) gameLog.push(`👍 CATCH! ${targetPlayerState.name} (Catch: ${recCatchSkill}) makes the reception!`);
            }

            playState.activePlayers.forEach(p => {
                if (p.isOffense && p.id !== targetPlayerState.id) {
                    p.action = 'run_block';
                }
            });

            // 💡💡💡 --- FIX: REMOVED THE DOUBLE-COUNT --- 💡💡💡
            // ensureStats(receiverPlayer);
            // receiverPlayer.gameStats.receptions = (receiverPlayer.gameStats.receptions || 0) + 1;
            // if (throwerPlayer) {
            //     throwerPlayer.gameStats.passCompletions = (throwerPlayer.gameStats.passCompletions || 0) + 1;
            // }
            // 💡💡💡 --- END OF FIX --- 💡💡💡

        } else { // Drop / Incomplete
            if (interferencePenalty > 10 || positionalPenalty > 0) {
                if (gameLog) gameLog.push(`❌ **CONTESTED DROP!** Pass was on target to ${targetPlayerState.name} (Catch: ${recCatchSkill})!`);
            } else {
                if (gameLog) gameLog.push(`❌ **DROPPED!** Pass was on target to ${targetPlayerState.name} (Catch: ${recCatchSkill})!`);
            }
            playState.incomplete = true; playState.playIsLive = false;
        }
    }

    // 6. Inaccurate Pass (Only if no INT and receiver was NOT in range)
    if (!eventResolved) {
        eventResolved = true;
        const distToReceiver = getDistance(playState.ballState, targetPlayerState);
        let accuracyMsg = "**off target**";
        if (distToReceiver > 3.0) accuracyMsg = "**wildly off target**";
        else if (playState.ballState.x > targetPlayerState.x + 1.5) accuracyMsg = "**too far outside**";
        else if (playState.ballState.x < targetPlayerState.x - 1.5) accuracyMsg = "**too far inside**";
        else if (playState.ballState.y > targetPlayerState.y + 1.5) accuracyMsg = "**overthrown**";
        else if (playState.ballState.y < targetPlayerState.y - 1.5) accuracyMsg = "**underthrown**";

        if (gameLog) gameLog.push(`‹‹ Pass to ${targetPlayerState?.name || 'receiver'} is ${accuracyMsg}. Incomplete.`);
        playState.incomplete = true; playState.playIsLive = false;
    }

    // 7. Finalize Ball State
    if (playState.playIsLive) { // Ball was caught or intercepted
        playState.ballState.inAir = false;
        playState.ballState.z = 0.5;
    } else { // Ball was dropped or incomplete
        playState.ballState.inAir = false;
        playState.ballState.z = 0.1;
    }
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
 * Checks for and resolves "soft" collisions between all active players.
 * This prevents players from running on top of each other.
 */
function resolvePlayerCollisions(playState) {
    const players = playState.activePlayers;
    const playerRadius = PLAYER_SEPARATION_RADIUS;

    // We must check every player against every other player
    for (let i = 0; i < players.length; i++) {
        const p1 = players[i];

        for (let j = i + 1; j < players.length; j++) {
            const p2 = players[j];

            // --- CRITICAL: Skip collisions for interacting players ---
            // We don't want to "nudge" a blocker off their defender,
            // or a tackler away from the ball carrier.
            if (p1.engagedWith === p2.id || p2.engagedWith === p1.id ||
                p1.isBallCarrier || p2.isBallCarrier ||
                p1.stunnedTicks > 0 || p2.stunnedTicks > 0) {
                continue;
            }

            let dx = p1.x - p2.x;
            let dy = p1.y - p2.y;
            let dist = Math.sqrt(dx * dx + dy * dy);

            // Handle rare case where players are on the exact same spot
            if (dist < 0.01) {
                dx = 0.1; // Give a tiny horizontal nudge
                dy = 0;
                dist = 0.1;
            }

            // Check if their "bubbles" are overlapping
            if (dist < playerRadius) {
                const overlap = playerRadius - dist;

                // Calculate how much to push each player (half the overlap)
                const pushAmount = overlap / 2;

                // Normalize the dx/dy vector and apply the push
                const pushX = (dx / dist) * pushAmount;
                const pushY = (dy / dist) * pushAmount;

                // Nudge p1 away from p2
                p1.x += pushX;
                p1.y += pushY;

                // Nudge p2 away from p1
                p2.x -= pushX;
                p2.y -= pushY;

                // --- Re-clamp positions to stay in-bounds ---
                p1.x = Math.max(0.5, Math.min(FIELD_WIDTH - 0.5, p1.x));
                p1.y = Math.max(0.5, Math.min(FIELD_LENGTH - 0.5, p1.y));
                p2.x = Math.max(0.5, Math.min(FIELD_WIDTH - 0.5, p2.x));
                p2.y = Math.max(0.5, Math.min(FIELD_LENGTH - 0.5, p2.y));
            }
        }
    }
}

/**
 * Updates player game stats based on the final play outcome.
 */
function finalizeStats(playState, offense, defense) {
    // --- 1. Find all players involved ---
    const carrierState = playState.activePlayers.find(p => p.isBallCarrier);
    const throwerState = playState.activePlayers.find(p => p.id === playState.ballState.throwerId);
    const receiverState = playState.activePlayers.find(p => p.id === playState.ballState.targetPlayerId && p.isOffense);
    // Find the defensive player who ended up with the ball (if any)
    const interceptorState = playState.turnover && !playState.sack ? playState.activePlayers.find(p => p.isBallCarrier && !p.isOffense) : null;

    const qbPlayer = throwerState ? game.players.find(p => p && p.id === throwerState.id) : null;
    const carrierPlayer = carrierState ? game.players.find(p => p && p.id === carrierState.id) : null;
    const receiverPlayer = receiverState ? game.players.find(p => p && p.id === receiverState.id) : null;
    // Note: interceptorPlayer and carrierPlayer might be the same person
    const interceptorPlayer = interceptorState ? game.players.find(p => p && p.id === interceptorState.id) : null;

    // --- 2. Ensure stats objects exist ---
    ensureStats(qbPlayer);
    ensureStats(carrierPlayer);
    ensureStats(receiverPlayer);
    ensureStats(interceptorPlayer);

    // --- 3. Handle Pass Attempt Stats (always happens on throw) ---
    if (qbPlayer && playState.ballState.throwInitiated) {
        qbPlayer.gameStats.passAttempts = (qbPlayer.gameStats.passAttempts || 0) + 1;
    }

    // --- 4. Handle Turnover-Specific Stats (Interception) ---
    if (playState.turnover && interceptorPlayer) {
        // Note: The 'interceptions' stat is already awarded in handleBallArrival
        if (qbPlayer) {
            qbPlayer.gameStats.interceptionsThrown = (qbPlayer.gameStats.interceptionsThrown || 0) + 1;
        }
    }

    // --- 5. Handle Final Play Result (TDs, Yards) ---
    const isTouchdown = playState.touchdown;
    const finalYards = Math.round(playState.yards);

    if (playState.sack) {
        // Sack stats are handled in checkTackleCollisions
    } else if (playState.incomplete) {
        // No yards, no TD. (Attempt/INT already counted)
    } else if (carrierPlayer) {
        // If the play ended with a carrier (run, catch, or INT return)
        const wasPassCaught = carrierState.id === receiverState?.id && playState.ballState.throwInitiated;

        if (wasPassCaught && receiverPlayer) {
            // --- A. Offensive Receiving Play ---
            receiverPlayer.gameStats.receptions = (receiverPlayer.gameStats.receptions || 0) + 1;
            receiverPlayer.gameStats.recYards = (receiverPlayer.gameStats.recYards || 0) + finalYards;
            if (isTouchdown) receiverPlayer.gameStats.touchdowns = (receiverPlayer.gameStats.touchdowns || 0) + 1;

            if (qbPlayer) {
                qbPlayer.gameStats.passCompletions = (qbPlayer.gameStats.passCompletions || 0) + 1;
                qbPlayer.gameStats.passYards = (qbPlayer.gameStats.passYards || 0) + finalYards;
                if (isTouchdown) qbPlayer.gameStats.touchdowns = (qbPlayer.gameStats.touchdowns || 0) + 1;
            }
        } else if (carrierState.isOffense) {
            // --- B. Offensive Rushing Play ---
            carrierPlayer.gameStats.rushYards = (carrierPlayer.gameStats.rushYards || 0) + finalYards;
            if (isTouchdown) carrierPlayer.gameStats.touchdowns = (carrierPlayer.gameStats.touchdowns || 0) + 1;

        } else if (!carrierState.isOffense) {
            // --- C. Defensive Return (INT or Fumble) ---
            // This is the carrierPlayer (who is the interceptorPlayer or fumble recoverer)

            // <<< --- THIS IS THE FIX --- >>>
            if (isTouchdown) {
                // Award the touchdown to the defensive player
                carrierPlayer.gameStats.touchdowns = (carrierPlayer.gameStats.touchdowns || 0) + 1;
            }
            // (We can add return yards here later if we want)
            // carrierPlayer.gameStats.returnYards = (carrierPlayer.gameStats.returnYards || 0) + yards; 
        }
    }
}

// =============================================================
// --- UPDATED resolvePlay FUNCTION ---
// =============================================================

/**
 * Simulates a single play using a coordinate-based tick system.
 */
// game.js

function resolvePlay(offense, defense, offensivePlayKey, defensivePlayKey, gameState, options = {}) {
    const { gameLog = [], weather, ballOn, ballHash = 'M', down, yardsToGo } = gameState;
    const fastSim = options.fastSim === true; // Get fastSim from options

    const play = deepClone(offensivePlaybook[offensivePlayKey]);

    if (!play) {
        console.error(`Play key "${offensivePlayKey}" not found...`);
        if (gameLog) gameLog.push("CRITICAL ERROR: Play definition missing!");
        return { yards: 0, turnover: true, incomplete: false, touchdown: false, safety: false, log: gameLog, visualizationFrames: [] };
    }

    const { type } = play;
    let { assignments } = play;

    // const aiTickMultiplier = 0.05 / TICK_DURATION_SECONDS;

    const playState = {
        playIsLive: true, tick: 0, maxTicks: 1000 * aiTickMultiplier,
        yards: 0, touchdown: false, turnover: false, incomplete: false, sack: false, safety: false,
        ballState: {
            x: 0, y: 0, z: 1.0,
            vx: 0, vy: 0, vz: 0,
            targetPlayerId: null,
            inAir: false,
            isLoose: false,
            throwerId: null,
            throwInitiated: false,
            targetX: 0, targetY: 0
        },
        lineOfScrimmage: 0, activePlayers: [], blockBattles: [], visualizationFrames: []
    };
    let firstDownY = 0;

    try {
        const absoluteLoS_Y = ballOn + 10;
        const goalLineY = FIELD_LENGTH - 10; // This is 110
        firstDownY = Math.min(absoluteLoS_Y + (yardsToGo || 10), goalLineY);

        setupInitialPlayerStates(playState, offense, defense, play, assignments, ballOn, defensivePlayKey, ballHash, offensivePlayKey);

        if (playState.playIsLive && gameLog) {
            const initialFrameData = {
                players: deepClone(playState.activePlayers),
                ball: deepClone(playState.ballState),
                logIndex: gameLog.length,
                lineOfScrimmage: playState.lineOfScrimmage,
                firstDownY: firstDownY,
                isSnap: true
            };
            playState.visualizationFrames.push(initialFrameData);
        }
    } catch (setupError) {
        console.error("CRITICAL ERROR during setupInitialPlayerStates:", setupError);
        if (gameLog) gameLog.push(`💥 CRITICAL ERROR: Play setup failed! ${setupError.message}`);
        return { yards: 0, turnover: true, incomplete: false, touchdown: false, safety: false, log: gameLog, visualizationFrames: [] };
    }

    if (!playState.activePlayers.some(p => p.slot === 'QB1' && p.isOffense)) {
        if (gameLog) gameLog.push("No QB found for play. Turnover.");
        return { yards: 0, turnover: true, incomplete: false, touchdown: false, safety: false, log: gameLog, visualizationFrames: [] };
    }

    // --- RB "HOT ROUTE" AUDIBLE CHECK ---
    const defensePlay = defensivePlaybook[defensivePlayKey];
    const qbState = playState.activePlayers.find(p => p.slot === 'QB1' && p.isOffense);
    const qbPlayer = qbState ? game.players.find(p => p && p.id === qbState.id) : null;
    const qbIQ = qbPlayer?.attributes?.mental?.playbookIQ || 50;

    if (play.type === 'pass' &&
        defensePlay?.blitz === true &&
        play.assignments['RB1'] &&
        play.assignments['RB1'] !== 'pass_block' &&
        Math.random() < (qbIQ / 125)) {
        play.assignments['RB1'] = 'pass_block';
        assignments = play.assignments;

        const rbPlayer = playState.activePlayers.find(p => p.slot === 'RB1' && p.isOffense);
        if (gameLog) { // Safe push
            gameLog.push(`[Pre-Snap]: 🧠 ${qbPlayer?.name || 'QB'} sees the blitz and keeps ${rbPlayer?.name || 'RB'} in to block!`);
        }

        if (rbPlayer) {
            rbPlayer.assignment = 'pass_block';
            rbPlayer.action = 'pass_block';
            rbPlayer.targetX = rbPlayer.initialX;
            rbPlayer.targetY = rbPlayer.initialY - 0.5;
        }
    }
    // --- END HOT ROUTE CHECK ---


    // --- 3. TICK LOOP ---
    let ballCarrierState = null;
    try {
        const timeDelta = fastSim ? TICK_DURATION_SECONDS * 10 : TICK_DURATION_SECONDS;
        
        while (playState.playIsLive && playState.tick < playState.maxTicks) {
            playState.tick++;
            

            const offenseStates = playState.activePlayers.filter(p => p.isOffense);
            const defenseStates = playState.activePlayers.filter(p => !p.isOffense);
            ballCarrierState = playState.activePlayers.find(p => p.isBallCarrier);
            const ballPos = playState.ballState;

            // --- STEP 1: QB Logic (Decide Throw/Scramble) ---
            if (playState.playIsLive && type === 'pass' && !ballPos.inAir && !playState.turnover && !playState.sack) {
                updateQBDecision(playState, offenseStates, defenseStates, gameLog);
            }
            if (!playState.playIsLive) break; // Play ended (e.g., QB threw away)

            // --- STEP 2: Update Player Intentions/Targets (AI) ---
            updatePlayerTargets(playState, offenseStates, defenseStates, ballCarrierState, type, offensivePlayKey, assignments, defensivePlayKey, gameLog);

            // --- STEP 3: Update Player Positions (Movement) ---
            playState.activePlayers.forEach(p => updatePlayerPosition(p, timeDelta));

            // --- STEP 4: Update Ball Position ---
            ballCarrierState = playState.activePlayers.find(p => p.isBallCarrier);
            if (ballPos.inAir) {
                ballPos.x += ballPos.vx * timeDelta;
                ballPos.y += ballPos.vy * timeDelta;
                ballPos.z += ballPos.vz * timeDelta;
                ballPos.vz -= 9.8 * timeDelta; // Apply gravity
            } else if (ballCarrierState) {
                ballPos.x = ballCarrierState.x;
                ballPos.y = ballCarrierState.y;
                ballPos.z = 0.5;
            }

            // --- STEP 5: Resolve "Nudge" Collisions ---
            resolvePlayerCollisions(playState);

            // --- STEP 6: Check Ball Carrier End Conditions (TD, OOB, Safety) ---
            if (playState.playIsLive) {
                ballCarrierState = playState.activePlayers.find(p => p.isBallCarrier);
                if (ballCarrierState) {
                    if (ballCarrierState.y >= FIELD_LENGTH - 10 && ballCarrierState.isOffense) { // Offensive TD
                        playState.yards = ballCarrierState.y - playState.lineOfScrimmage;
                        playState.touchdown = true; playState.playIsLive = false;
                        const scorer = game.players.find(p => p && p.id === ballCarrierState.id);
                        if (gameLog) gameLog.push(`🎉 TOUCHDOWN ${scorer?.name || 'player'}!`);
                        break;
                    } else if (ballCarrierState.y < 10 && !ballCarrierState.isOffense) { // Defensive TD
                        playState.yards = 0;
                        playState.touchdown = true; playState.playIsLive = false;
                        const scorer = game.players.find(p => p && p.id === ballCarrierState.id);
                        if (gameLog) gameLog.push(`🎉 DEFENSIVE TOUCHDOWN ${scorer?.name || 'player'}!`);
                        break;
                    } else if (ballCarrierState.y < 10 && ballCarrierState.isOffense) { // SAFETY
                        playState.yards = 0;
                        playState.safety = true;
                        playState.playIsLive = false;
                        if (gameLog) gameLog.push(`SAFETY! ${ballCarrierState.name} was tackled in the endzone!`);
                        break;
                    }
                    if (ballCarrierState.x <= 0.1 || ballCarrierState.x >= FIELD_WIDTH - 0.1) {
                        playState.yards = ballCarrierState.y - playState.lineOfScrimmage;
                        playState.playIsLive = false;
                        if (gameLog) gameLog.push(` sidelines... ${ballCarrierState.name} ran out of bounds after a gain of ${playState.yards.toFixed(1)} yards.`);
                        break;
                    }
                }
            }

            // --- STEP 7: Check Collisions & Resolve Catches/Incompletions ---
            if (playState.playIsLive) {
                // A. Check for new block engagements
                checkBlockCollisions(playState);

                // B. Check for tackles
                ballCarrierState = playState.activePlayers.find(p => p.isBallCarrier);
                if (ballCarrierState) {
                    if (checkTackleCollisions(playState, gameLog)) break;
                }

                // --- 💡 FIX: FUMBLE RECOVERY LOGIC MOVED HERE ---
                // D. Check for Fumble Recovery (Now OUTSIDE of the ballPos.inAir check)
                if (playState.ballState.isLoose) {
                    const recoverer = checkFumbleRecovery(playState, gameLog, TACKLE_RANGE);

                    if (recoverer) {
                        // Someone recovered the ball!
                        playState.ballState.isLoose = false;
                        recoverer.isBallCarrier = true;
                        recoverer.hasBall = true;
                        recoverer.action = 'run_path';

                        if (recoverer.isOffense) {
                            // --- OFFENSE RECOVERED ---
                            playState.turnover = false; // It's no longer a turnover
                            if (gameLog) gameLog.push(`👍 ${recoverer.name} recovers the fumble!`);
                            playState.activePlayers.forEach(p => {
                                if (p.isOffense && p.id !== recoverer.id) {
                                    p.action = 'run_block'; // Block for the runner
                                } else if (!p.isOffense) {
                                    p.action = 'pursuit'; // Defense must now pursue
                                }
                            });
                        } else {
                            // --- DEFENSE RECOVERED ---
                            playState.turnover = true; // It is confirmed as a turnover
                            if (gameLog) gameLog.push(`❗ ${recoverer.name} recovers the fumble for the Defense!`);
                            playState.activePlayers.forEach(p => {
                                if (p.isOffense) {
                                    p.action = 'pursuit';
                                } else if (p.id !== recoverer.id) {
                                    p.action = 'run_block';
                                }
                            });
                        }
                    }
                    // If no recoverer, the ball is still loose, play continues
                }
                // --- 💡 END OF MOVED BLOCK ---

                // C. Check for Ball Arrival (Catch/INT/Drop)
                if (ballPos.inAir) {
                    const distToTargetXY = Math.sqrt(
                        Math.pow(ballPos.x - ballPos.targetX, 2) +
                        Math.pow(ballPos.y - ballPos.targetY, 2)
                    );
                    const CATCH_ARRIVAL_RADIUS = 2.0;

                    if (distToTargetXY < CATCH_ARRIVAL_RADIUS) {
                        handleBallArrival(playState, gameLog);
                        if (!playState.playIsLive) break;
                    }

                    // E. Check for Ground / Out of Bounds (if not caught)
                    if (playState.playIsLive) {
                        if (ballPos.z <= 0.1 && playState.tick > 6) {
                            if (gameLog) gameLog.push(`‹‹ Pass hits the ground. Incomplete.`);
                            playState.incomplete = true; playState.playIsLive = false; ballPos.inAir = false;
                            break;
                        }
                        if (ballPos.x <= 0.1 || ballPos.x >= FIELD_WIDTH - 0.1 || ballPos.y >= FIELD_LENGTH - 0.1 || ballPos.y <= 0.1) {
                            if (gameLog) gameLog.push(`‹‹ Pass sails out of bounds. Incomplete.`);
                            playState.incomplete = true; playState.playIsLive = false; ballPos.inAir = false;
                            break;
                        }
                    }
                } // --- End of if(ballPos.inAir) ---
            }
            if (!playState.playIsLive) break;

            // --- STEP 8: Resolve Ongoing Battles (Blocks) ---
            resolveOngoingBlocks(playState, gameLog);

            // --- STEP 9: Update Fatigue ---
            playState.activePlayers.forEach(pState => {
                if (!pState) return;
                let fatigueGain = 0.01;
                const action = pState.action;
                const assignment = pState.assignment;
                if (action === 'run_path' || action === 'qb_scramble' || action === 'run_route' ||
                    action === 'pass_rush' || action === 'blitz_gap' || action === 'blitz_edge' ||
                    action === 'pursuit' || assignment?.startsWith('man_cover_')) {
                    fatigueGain += 0.03;
                } else if (action === 'pass_block' || action === 'run_block' || pState.engagedWith) {
                    fatigueGain += 0.02;
                }
                const player = game.players.find(p => p && p.id === pState.id);
                if (player) {
                    player.fatigue = Math.min(100, (player.fatigue || 0) + fatigueGain);
                    pState.fatigue = player.fatigue;
                    const stamina = player.attributes?.physical?.stamina || 50;
                    const fatigueRatio = Math.min(1.0, (player.fatigue || 0) / stamina);
                    pState.fatigueModifier = Math.max(0.3, 1.0 - fatigueRatio);
                }
            });

            try {
                const activeIds = new Set(playState.activePlayers.filter(p => p).map(p => p.id));
                const BENCH_RECOVERY_PER_TICK = 0.003;
                game.players.forEach(p => {
                    if (!p) return;
                    if (p.status && p.status.duration > 0) return;
                    if (activeIds.has(p.id)) return;
                    if ((p.fatigue || 0) <= 0) return;
                    p.fatigue = Math.max(0, (p.fatigue || 0) - BENCH_RECOVERY_PER_TICK);
                });
            } catch (err) {
                console.error('Bench recovery error:', err);
            }

            try {
                const involvedTeamIds = new Set(playState.activePlayers.filter(p => p && p.teamId).map(p => p.teamId));
                involvedTeamIds.forEach(tid => {
                    const team = game.teams.find(tt => tt && tt.id === tid);
                    if (!team) return;
                    if (game.playerTeam && team.id === game.playerTeam.id) return;
                    autoMakeSubstitutions(team, { thresholdFatigue: 60, maxSubs: 2, chance: 0.2 });
                });
            } catch (err) {
                console.error('AI substitution error:', err);
            }

            // --- STEP 10: Record Visualization Frame ---
            if (gameLog) {
                const frameData = {
                    players: deepClone(playState.activePlayers),
                    ball: deepClone(ballPos),
                    logIndex: gameLog.length,
                    lineOfScrimmage: playState.lineOfScrimmage,
                    firstDownY: firstDownY
                };
                playState.visualizationFrames.push(frameData);
            }
        } // --- End TICK LOOP ---
    } catch (tickError) {
        console.error("CRITICAL ERROR during simulation tick loop:", tickError); // This is line 3758

        // 💡 FIX: Add a null check before pushing to the log
        if (gameLog) {
            gameLog.push(`CRITICAL ERROR: Simulation failed mid-play. ${tickError.message}`);
        }

        playState.playIsLive = false;
        playState.incomplete = true;
    }

    // --- 4. Finalize Results ---
    if (playState.playIsLive && !playState.touchdown && !playState.safety) {
        ballCarrierState = playState.activePlayers.find(p => p.isBallCarrier);
        if (ballCarrierState) {
            playState.yards = ballCarrierState.y - playState.lineOfScrimmage;
            if (gameLog) gameLog.push(`⏱️ Play ends. Gain of ${playState.yards.toFixed(1)} yards.`);
        } else if (!playState.sack && !playState.turnover) {
            playState.incomplete = true; playState.yards = 0;
            if (gameLog) gameLog.push("⏱️ Play ends, incomplete.");
        } else {
            if (gameLog) gameLog.push("⏱️ Play ends.");
        }
    }

    playState.yards = Math.round(playState.yards);
    if (playState.sack) { playState.yards = Math.min(0, playState.yards); }
    if (playState.incomplete || (playState.turnover && !playState.touchdown) || playState.safety) {
        playState.yards = 0;
    }

    if (playState.touchdown && !playState.turnover) { // Offensive TD
        const yardsToGoal = (FIELD_LENGTH - 10) - (ballOn + 10);
        playState.yards = Math.max(yardsToGoal, playState.yards);
    } else if (playState.touchdown && playState.turnover) { // Defensive TD
        playState.yards = 0;
    }

    finalizeStats(playState, offense, defense);

    return {
        yards: playState.yards,
        touchdown: playState.touchdown,
        turnover: playState.turnover,
        incomplete: playState.incomplete,
        safety: playState.safety,
        log: gameLog,
        visualizationFrames: playState.visualizationFrames
    };
}
/**
 * Resolves a punt play. Calculates distance, simulates a potential return,
 * and handles muffs or touchdowns.
 * This does not use the full tick simulation but provides a dynamic result.
 * @returns {object} A result object: { turnover, newBallOn, homeScore, awayScore }
 */
function resolvePunt(offense, defense, gameState, homeScore, awayScore, homeTeamId) {
    const { gameLog, ballOn } = gameState;

    // --- 1. Find Punter (Assumed to be QB1) ---
    const offenseRoster = getRosterObjects(offense);
    const qb = offenseRoster.find(p => p && p.id === offense.depthChart.offense.QB1);

    if (!qb) {
        if (gameLog) gameLog.push("PUNT FAILED! No QB found on roster.");
        return { turnover: true, newBallOn: 100 - ballOn, homeScore, awayScore };
    }

    // --- 2. Calculate Punt Distance ---
    const strength = qb.attributes?.physical?.strength || 50;
    const accuracy = qb.attributes?.technical?.throwingAccuracy || 50; // Using QB accuracy as per original logic
    const consistency = qb.attributes?.mental?.consistency || 50;

    const puntPower = (strength * 0.6) + (accuracy * 0.4);
    const baseDistance = 25 + (puntPower / 3);
    const maxVariability = 10;
    const variabilityRange = maxVariability * (1 - (consistency / 100));
    const finalPuntDistance = baseDistance + getRandom(-variabilityRange, variabilityRange);

    // --- 3. Calculate Landing Spot ---
    const lineOfScrimmage = ballOn + 10;
    const puntLandingY = lineOfScrimmage + finalPuntDistance;

    let newBallOn = 0;
    let turnover = true;
    let newHomeScore = homeScore;
    let newAwayScore = awayScore;

    // --- 4. Handle Touchback ---
    if (puntLandingY >= 110) {
        newBallOn = 20; // Receiving team gets ball at their 20
        if (gameLog) gameLog.push(`🏈 PUNT by ${qb.name}. It's a TOUCHBACK!`);
    } else {
        // --- 5. Handle Live Return ---
        const defenseRoster = getRosterObjects(defense);
        const healthyDefenders = defenseRoster.filter(p => p && p.status?.duration === 0);

        if (healthyDefenders.length === 0) {
            // No healthy defenders, automatic touchback
            newBallOn = 20;
            if (gameLog) gameLog.push(`🏈 PUNT by ${qb.name}. No healthy returner! TOUCHBACK!`);
            return { turnover: true, newBallOn: 20, homeScore, awayScore };
        }

        // 5a. Find Best Returner (Speed + Agility + Hands)
        const returner = healthyDefenders.reduce((best, current) => {
            const bestScore = (best.attributes?.physical?.speed || 40) + (best.attributes?.physical?.agility || 40) + (best.attributes?.technical?.catchingHands || 40);
            const currentScore = (current.attributes?.physical?.speed || 40) + (current.attributes?.physical?.agility || 40) + (current.attributes?.technical?.catchingHands || 40);
            return currentScore > bestScore ? current : best;
        }, healthyDefenders[0]);

        // 5b. Find Coverage Team (Offense minus Punter)
        const coverageTeam = offenseRoster.filter(p => p && p.status?.duration === 0 && p.id !== qb.id);
        let coveragePower = 50;
        if (coverageTeam.length > 0) {
            let avgCoverageTackling = 0;
            let avgCoverageSpeed = 0;
            coverageTeam.forEach(p => {
                avgCoverageTackling += (p.attributes?.technical?.tackling || 40);
                avgCoverageSpeed += (p.attributes?.physical?.speed || 40);
            });
            avgCoverageTackling /= coverageTeam.length;
            avgCoverageSpeed /= coverageTeam.length;
            coveragePower = (avgCoverageTackling * 0.6) + (avgCoverageSpeed * 0.4);
        }

        // 5c. Check for Muff/Fumble
        const catchingHands = returner.attributes?.technical?.catchingHands || 50;
        const muffChance = 0.05 + (1 - (catchingHands / 100)) * 0.15; // 5% (99 hands) to 20% (1 hands)
        let returnYards = 0;

        if (Math.random() < muffChance) {
            if (gameLog) gameLog.push(`❗ MUFFED PUNT! ${returner.name} drops the ball!`);
            // 50/50 recovery
            if (Math.random() < 0.5) {
                if (gameLog) gameLog.push(`👍 ${defense.name} recovers the muff!`);
                returnYards = 0; // Ball is dead where it was muffed
            } else {
                if (gameLog) gameLog.push(`❗ TURNOVER! ${offense.name} recovers the muffed punt!`);
                const newBallOnField = puntLandingY - 10;
                newBallOn = newBallOnField; // Offense's new ballOn
                turnover = false; // It's not a turnover!
                return { turnover: false, newBallOn: Math.round(newBallOn), homeScore, awayScore };
            }
        } else {
            // 5d. Calculate Return Yards (if not muffed)
            const returnerSpeed = returner.attributes?.physical?.speed || 50;
            const returnerAgility = returner.attributes?.physical?.agility || 50;
            const returnerConsistency = returner.attributes?.mental?.consistency || 50;
            const returnerPower = (returnerSpeed * 0.5) + (returnerAgility * 0.5);

            const baseReturn = 5 + (returnerPower - 50) / 5; // Base return yards
            const coverageModifier = (coveragePower - 50) / 10; // Coverage limits return
            const returnVariabilityRange = 10 * (1 - (returnerConsistency / 100));
            const returnVariability = getRandom(-returnVariabilityRange, returnVariabilityRange);

            returnYards = baseReturn - coverageModifier + returnVariability;

            // Big play chance
            if (Math.random() < (returnerAgility / 1000)) {
                returnYards += getRandom(15, 40);
            }
            // Tackle for loss chance
            if (Math.random() < (coveragePower / 1000)) {
                returnYards -= getRandom(5, 10);
            }
        }

        // --- 6. Finalize Return ---
        const catchYardLine = 100 - (puntLandingY - 10); // e.g., 40 yard line

        if (returnYards > 0) {
            if (gameLog) gameLog.push(`🏈 PUNT by ${qb.name}. ${returner.name} catches at the ${catchYardLine.toFixed(0)} and returns for ${returnYards.toFixed(0)} yards!`);
        } else {
            if (gameLog) gameLog.push(`🏈 PUNT by ${qb.name}. ${returner.name} calls for a FAIR CATCH at the ${catchYardLine.toFixed(0)}.`);
            returnYards = 0;
        }

        const newBallOnField = (puntLandingY - 10) - returnYards; // Return yards come *back*
        newBallOn = 100 - newBallOnField; // Flips the field for the receiving team

        // Check for return TD
        if (newBallOnField <= 0) {
            if (gameLog) gameLog.push(`🎉 PUNT RETURN TOUCHDOWN! ${returner.name}!`);
            if (defense.id === homeTeamId) newHomeScore += 6; else newAwayScore += 6;
            // Set up for the kickoff
            newBallOn = 20;
        }

        // Clamp ball position
        if (newBallOn < 1) newBallOn = 1;

        const yardLineText = newBallOn <= 50 ? `own ${newBallOn.toFixed(0)}` : `opponent ${(100 - newBallOn).toFixed(0)}`;
        if (newBallOnField > 0) { // Don't log this if it was a TD
            if (gameLog) gameLog.push(`${defense.name} takes over at their ${yardLineText}.`);
        }
    }

    return { turnover: turnover, newBallOn: Math.round(newBallOn), homeScore: newHomeScore, awayScore: newAwayScore };
}

// =============================================================
// --- GAME SIMULATION ---
// =============================================================

/**
 * AI logic to determine if a team should punt on 4th down.
 * @returns {boolean} - True if the team should punt, false to go for it.
 */
function determinePuntDecision(down, yardsToGo, ballOn) {
    // 1. Not 4th down? Don't punt.
    if (down !== 4) return false;

    // 2. In field goal range or "go for it" territory? (e.g., past opponent's 40-yd line)
    if (ballOn >= 60) return false;

    // 3. 4th and short? Go for it.
    if (yardsToGo <= 2) return false;

    // 4. Backed up in own territory? (e.g., inside own 10-yd line)
    // Even if it's 4th & 1, it's too risky. Punt it.
    if (ballOn <= 10) return true;

    // 5. Otherwise (e.g., 4th & 5 from your own 30), punt.
    return true;
}

/**
 * Determines the offensive play call based on game situation, personnel, and matchups.
 */
// game.js

function determinePlayCall(offense, defense, down, yardsToGo, ballOn, scoreDiff, gameLog, drivesRemaining) {
    // --- 💡 FIX: Get roster objects ---
    const offenseRoster = getRosterObjects(offense);
    const defenseRoster = getRosterObjects(defense);

    if (!offenseRoster || !defenseRoster || !offense?.formations?.offense || !defense?.formations?.defense || !offense?.coach) {
        // --- 💡 END FIX ---
        console.error("determinePlayCall: Invalid team data provided.");
        return 'Balanced_InsideRun';
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

    // --- 💡 FIX: Helper now uses the passed-in roster objects ---
    const getAvgOverall = (roster, positions) => {
        const players = roster.filter(p => p && (positions.includes(p.favoriteOffensivePosition) || positions.includes(p.favoriteDefensivePosition)));
        if (players.length === 0) return 40;
        const totalOvr = players.reduce((sum, p) => sum + calculateOverall(p, positions[0]), 0);
        return totalOvr / players.length;
    };

    const avgQbOvr = getAvgOverall(offenseRoster, ['QB']);
    const avgRbOvr = getAvgOverall(offenseRoster, ['RB']);
    const avgWrOvr = getAvgOverall(offenseRoster, ['WR']);
    const avgOlOvr = getAvgOverall(offenseRoster, ['OL']);
    const avgDlOvr = getAvgOverall(defenseRoster, ['DL']);
    const avgLbOvr = getAvgOverall(defenseRoster, ['LB']);
    const avgDbOvr = getAvgOverall(defenseRoster, ['DB']);
    // --- 💡 END FIX ---

    // ... (rest of the function is identical and fine) ...
    let passChance = 0.45;

    if (down === 3 && yardsToGo >= 7) passChance += 0.35;
    else if (down === 3 && yardsToGo >= 4) passChance += 0.20;
    else if (down === 4 && yardsToGo >= 4) passChance = 0.90;
    else if (down === 4 && yardsToGo >= 2) passChance = 0.60;
    else if (yardsToGo <= 2) passChance -= 0.35;

    if (ballOn > 85) passChance -= 0.15;
    if (ballOn > 95) passChance -= 0.25;

    const totalDrivesPerHalf = 8;
    const isLateGame = drivesRemaining <= 3;
    const isEndOfHalf = (drivesRemaining % totalDrivesPerHalf <= 1) && drivesRemaining <= totalDrivesPerHalf;
    const urgencyFactor = isLateGame || isEndOfHalf;

    if (scoreDiff < -14) passChance += (urgencyFactor ? 0.4 : 0.25);
    else if (scoreDiff < -7) passChance += (urgencyFactor ? 0.25 : 0.15);
    if (scoreDiff > 10 && urgencyFactor) passChance -= 0.4;
    else if (scoreDiff > 4 && urgencyFactor) passChance -= 0.2;
    const offWRs = offenseFormation.personnel.WR || 0;
    const defDBs = defenseFormation.personnel.DB || 0;
    const offHeavy = (offenseFormation.personnel.RB || 0) + (offenseFormation.personnel.OL || 0);
    const defBox = (defenseFormation.personnel.DL || 0) + (defenseFormation.personnel.LB || 0);

    if (offWRs > defDBs + 1) passChance += 0.15;
    if (offHeavy > defBox + 1) passChance -= 0.15;

    if (avgWrOvr > avgDbOvr + 15) passChance += 0.20;
    else if (avgWrOvr > avgDbOvr + 7) passChance += 0.10;
    if (avgDbOvr > avgWrOvr + 10) passChance -= 0.15;

    if (avgOlOvr > (avgDlOvr + avgLbOvr) / 2 + 10) passChance -= 0.10;
    if ((avgDlOvr + avgLbOvr) / 2 > avgOlOvr + 15) passChance += 0.15;

    if (avgQbOvr < 55 && avgRbOvr > 60) passChance -= 0.15;
    if (avgRbOvr < 55 && avgQbOvr > 60) passChance += 0.10;
    if (avgQbOvr > avgRbOvr + 15) passChance += 0.05;
    if (avgRbOvr > avgQbOvr + 15) passChance -= 0.05;

    if (coach.type === 'Ground and Pound') passChance -= 0.20;
    if (coach.type === 'Trench Warfare') passChance -= 0.25;
    if (coach.type === 'West Coast Offense') passChance += 0.10;
    if (coach.type === 'Youth Scout') passChance += 0.10;
    if (coach.type === 'Skills Coach') passChance += 0.20;
    if (coach.type === 'Air Raid') passChance += 0.35;

    passChance = Math.max(0.05, Math.min(0.95, passChance));
    let desiredPlayType = (Math.random() < passChance) ? 'pass' : 'run';
    const formationPlays = Object.keys(offensivePlaybook).filter(key => key.startsWith(offenseFormationName));
    if (formationPlays.length === 0) {
        console.error(`CRITICAL: No plays found for formation ${offenseFormationName}!`);
        return 'Balanced_InsideRun';
    }

    if (yardsToGo <= 1 && Math.random() < 0.7) {
        if (avgQbOvr > 60 && Math.random() < 0.5) {
            const sneakPlay = formationPlays.find(p => offensivePlaybook[p]?.tags?.includes('sneak'));
            if (sneakPlay) return sneakPlay;
        }
        const powerPlays = formationPlays.filter(p => offensivePlaybook[p]?.tags?.includes('power') && offensivePlaybook[p]?.type === 'run');
        if (powerPlays.length > 0) return getRandom(powerPlays);
        const insideRuns = formationPlays.filter(p => offensivePlaybook[p]?.tags?.includes('inside') && offensivePlaybook[p]?.type === 'run');
        if (insideRuns.length > 0) return getRandom(insideRuns);
    }

    let possiblePlays = formationPlays.filter(key =>
        offensivePlaybook[key]?.type === desiredPlayType &&
        offensivePlaybook[key]?.type !== 'punt'
    );

    if (possiblePlays.length === 0) {
        desiredPlayType = (desiredPlayType === 'pass' ? 'run' : 'pass');
        possiblePlays = formationPlays.filter(key => offensivePlaybook[key]?.type === desiredPlayType);
        if (possiblePlays.length === 0) return formationPlays[0];
    }

    let chosenPlay = null;
    const isHeavyBox = defBox >= 5;
    const isLightBox = defBox <= 3;
    const hasManyDBs = defDBs >= 2;

    if (desiredPlayType === 'pass') {
        const deepPlays = possiblePlays.filter(p => offensivePlaybook[p]?.tags?.includes('deep'));
        const shortPlays = possiblePlays.filter(p => offensivePlaybook[p]?.tags?.includes('short') || offensivePlaybook[p]?.tags?.includes('screen'));
        const mediumPlays = possiblePlays.filter(p => !deepPlays.includes(p) && !shortPlays.includes(p));
        let weightedOptions = [];
        const isLongPass = yardsToGo >= 8;
        const isShortPass = yardsToGo <= 4;

        if (isLongPass) {
            weightedOptions.push(...(deepPlays || []), ...(deepPlays || []));
            weightedOptions.push(...(mediumPlays || []));
        } else if (isShortPass) {
            weightedOptions.push(...(shortPlays || []), ...(shortPlays || []));
            weightedOptions.push(...(mediumPlays || []));
        } else {
            weightedOptions.push(...(deepPlays || []));
            weightedOptions.push(...(mediumPlays || []));
            weightedOptions.push(...(shortPlays || []));
        }

        if (isHeavyBox && shortPlays.length > 0) weightedOptions.push(...shortPlays);
        if (hasManyDBs && mediumPlays.length > 0) weightedOptions.push(...mediumPlays);

        if (weightedOptions.length === 0) {
            weightedOptions.push(...possiblePlays);
        }
        chosenPlay = getRandom(weightedOptions);

    } else { // Run
        const insidePlays = possiblePlays.filter(p => offensivePlaybook[p]?.tags?.includes('inside'));
        const outsidePlays = possiblePlays.filter(p => offensivePlaybook[p]?.tags?.includes('outside'));
        const powerPlays = possiblePlays.filter(p => offensivePlaybook[p]?.tags?.includes('power'));
        let weightedOptions = [];
        const isShortYardage = yardsToGo <= 2;

        if (isLightBox) weightedOptions.push(...(insidePlays || []), ...(insidePlays || []));
        if (isHeavyBox) weightedOptions.push(...(outsidePlays || []));

        if (isShortYardage) {
            weightedOptions.push(...(powerPlays || []), ...(powerPlays || []));
            weightedOptions.push(...(insidePlays || []));
        } else {
            weightedOptions.push(...(insidePlays || []));
            weightedOptions.push(...(outsidePlays || []));
            weightedOptions.push(...(powerPlays || []));
        }

        if (avgRbOvr > 65 && outsidePlays.length > 0 && Math.random() < 0.4) weightedOptions.push(...outsidePlays);

        if (weightedOptions.length === 0) {
            weightedOptions.push(...possiblePlays);
        }
        chosenPlay = getRandom(weightedOptions);
    }

    chosenPlay = chosenPlay || getRandom(possiblePlays) || formationPlays[0];
    return chosenPlay;
};

/**
 * AI (PRE-SNAP) Logic: Chooses the best defensive formation to counter
 * the offense's personnel and the current down/distance.
 * @param {object} defense - The defensive team object.
 * @param {string} offenseFormationName - The *name* of the offense's formation (e.g., "Spread").
 * @param {number} down - The current down.
 * @param {number} yardsToGo - The current yards to go.
 * @returns {string} The name of the chosen defensive formation (e.g., "2-3-2").
 */
function determineDefensiveFormation(defense, offenseFormationName, down, yardsToGo) {
    // 1. Special Teams Check (Highest Priority)
    // This is how the teams "signal" a punt.
    if (offenseFormationName === 'Punt') {
        return 'Punt_Return'; // Call the punt return formation
    }
    const coachPreferredFormation = defense.coach?.preferredDefense || '3-1-3';
    const offPersonnel = offenseFormations[offenseFormationName]?.personnel;

    // --- 1. Situational Overrides (Highest Priority) ---
    if (yardsToGo <= 2) {
        // Short yardage: Bring in the big guys, regardless of personnel.
        return '4-2-1'; // Run Stop formation
    }
    if (down >= 3 && yardsToGo >= 8) {
        // Long passing down: Bring in coverage, regardless of personnel.
        return '2-3-2'; // Nickel/Pass defense formation
    }

    // --- 2. Weighted Personnel Matching (Normal Downs) ---
    let weightedChoices = [];

    if (offPersonnel) {
        if (offPersonnel.WR >= 3) {
            // Offense is in "Spread". Heavily favor pass defense.
            weightedChoices = [
                '2-3-2', '2-3-2', '2-3-2', // 75% chance for Spread D
                coachPreferredFormation    // 25% chance for coach's preferred
            ];
        } else if (offPersonnel.RB >= 2) {
            // Offense is in "Power". Heavily favor run defense.
            weightedChoices = [
                '4-2-1', '4-2-1', '4-2-1', // 75% chance for Run Stop D
                coachPreferredFormation    // 25% chance for coach's preferred
            ];
        } else {
            // Offense is "Balanced". Favor coach's preference.
            weightedChoices = [
                coachPreferredFormation, coachPreferredFormation, // 50% chance for coach's
                '3-1-3', // 25% chance for standard balanced
                '2-3-2'  // 25% chance for pass-ready D
            ];
        }
    } else {
        // Fallback if personnel is unknown
        weightedChoices = [coachPreferredFormation, '3-1-3'];
    }

    // --- 3. Select and Return ---
    return getRandom(weightedChoices) || coachPreferredFormation;
}

/**
 * Determines the defensive play call based on formation, situation, and basic tendencies.
 */
function determineDefensivePlayCall(defense, offense, down, yardsToGo, ballOn, scoreDiff, gameLog, drivesRemaining) { // Added scoreDiff, drivesRemaining
    // --- 1. Validate Inputs & Get Current Formation ---
    if (!defense?.roster || !offense?.roster || !defense?.formations?.defense || !offense?.formations?.offense || !defense?.coach) {
        console.error("determineDefensivePlayCall: Invalid team data provided.");
        return 'Cover_2_Zone_3-1-3'; // Need a safe, common fallback (adjust if needed)
    }
    const defenseFormationName = defense.formations.defense;
    const defenseFormation = defenseFormations[defenseFormationName];
    if (!defenseFormation) {
        console.error(`CRITICAL ERROR: Defensive formation data missing for ${defense.name} (${defenseFormationName}).`);
        return 'Cover_2_Zone_3-1-3'; // Fallback
    }

    // --- 2. Filter Playbook for Current Formation ---
    const availablePlays = Object.keys(defensivePlaybook).filter(key => {
        // Basic check: Assumes play keys include formation name (e.g., "Cover_1_Man_331")
        // return key.includes(defenseFormationName); // <<< This is the old way

        // This is the new, "smarter" way
        return defensivePlaybook[key]?.compatibleFormations?.includes(defenseFormationName);
    });

    if (availablePlays.length === 0) {
        console.error(`CRITICAL: No defensive plays found in playbook compatible with ${defenseFormationName}!`);
        // Try finding *any* play as a last resort, though assignments might be wrong
        const allPlays = Object.keys(defensivePlaybook);
        return allPlays.length > 0 ? getRandom(allPlays) : 'Cover_2_Zone_3-1-3'; // Absolute fallback
    }

    // --- 3. Categorize *Available* Plays using TAGS ---
    const categorizedPlays = { blitz: [], runStop: [], zone: [], man: [], safeZone: [], prevent: [] };

    availablePlays.forEach(key => {
        const play = defensivePlaybook[key];
        // We check for the 'tags' array now, not 'concept' or 'blitz'
        if (!play || !play.tags) return;

        if (play.tags.includes('blitz')) categorizedPlays.blitz.push(key);
        if (play.tags.includes('runStop')) categorizedPlays.runStop.push(key);
        if (play.tags.includes('zone')) categorizedPlays.zone.push(key);
        if (play.tags.includes('man')) categorizedPlays.man.push(key);
        if (play.tags.includes('safeZone')) categorizedPlays.safeZone.push(key);
        if (play.tags.includes('prevent')) categorizedPlays.prevent.push(key);
    });

    // --- 4. Analyze Situation ---
    const isObviousPass = (down >= 3 && yardsToGo >= 7) || (down === 4 && yardsToGo >= 2) || (down >= 2 && yardsToGo >= 12);
    const isObviousRun = (yardsToGo <= 1) || (down >= 3 && yardsToGo <= 3);
    const isRedZone = ballOn >= 80; // Offense near goal line
    const isBackedUp = ballOn <= 15; // Offense deep in own territory

    const offFormation = offenseFormations[offense.formations.offense];
    const offPersonnel = offFormation?.personnel || { WR: 2, RB: 1 };
    const isSpreadOffense = offPersonnel.WR >= 3;
    const isHeavyOffense = (offPersonnel.RB || 0) >= 2;

    const coachType = defense.coach?.type || 'Balanced';

    // Game Situation (Time/Score)
    const totalDrivesPerHalf = 8; // Approx
    const isLateGame = drivesRemaining <= 3;
    const isEndOfHalf = (drivesRemaining % totalDrivesPerHalf <= 1) && drivesRemaining <= totalDrivesPerHalf;
    const urgencyFactor = isLateGame || isEndOfHalf;
    const isDefWinningBig = scoreDiff > 10; // Positive scoreDiff means defense is winning
    const isDefLosingBig = scoreDiff < -10; // Negative scoreDiff means defense is losing

    // --- 5. Build Weighted List of Preferred Plays ---
    let preferredPlays = []; // Use array directly for weighting via duplicates

    // Add plays multiple times based on situation appropriateness
    // A) Base Situation (Obvious Pass/Run/Normal)
    if (isObviousRun || (isHeavyOffense && !isObviousPass)) {
        preferredPlays.push(...(categorizedPlays.runStop || []), ...(categorizedPlays.runStop || [])); // Heavily weight run stop
        preferredPlays.push(...(categorizedPlays.blitz || [])); // Blitz is also good vs run
        preferredPlays.push(...(categorizedPlays.man || [])); // Man can work vs heavy
    } else if (isObviousPass || isSpreadOffense) {
        preferredPlays.push(...(categorizedPlays.zone || [])); // Favor zone vs pass
        preferredPlays.push(...(categorizedPlays.man || []));
        preferredPlays.push(...(categorizedPlays.blitz || [])); // Add pressure
    } else { // Normal down/distance
        preferredPlays.push(...(categorizedPlays.zone || [])); // Balanced approach
        preferredPlays.push(...(categorizedPlays.man || []));
        preferredPlays.push(...(categorizedPlays.runStop || []));
    }

    // B) Coach Tendency Adjustments
    if (coachType === 'Blitz-Happy Defense' && categorizedPlays.blitz.length > 0) {
        preferredPlays.push(...categorizedPlays.blitz, ...categorizedPlays.blitz, ...categorizedPlays.blitz); // Add blitz calls 3 extra times
    } else if (coachType === 'Ground and Pound' && categorizedPlays.runStop.length > 0) { // Often implies strong D coach
        preferredPlays.push(...categorizedPlays.runStop, ...categorizedPlays.runStop); // Add run stop 2 extra times
    } else if (coachType === 'West Coast Offense' && categorizedPlays.zone.length > 0) { // Often implies zone D coach
        preferredPlays.push(...categorizedPlays.safeZone, ...categorizedPlays.safeZone); // Add safer zones 2 extra times
    } else { // Balanced or other types - maybe add one of each core type
        preferredPlays.push(...(categorizedPlays.zone || []));
        preferredPlays.push(...(categorizedPlays.man || []));
        preferredPlays.push(...(categorizedPlays.runStop || []));
    }


    // C) Game Situation Adjustments (Score/Time)
    if (urgencyFactor && isDefLosingBig) { // Losing big late -> Aggressive
        preferredPlays.push(...(categorizedPlays.blitz || []), ...(categorizedPlays.blitz || []));
        preferredPlays.push(...(categorizedPlays.man || [])); // Riskier man coverage
    } else if (urgencyFactor && isDefWinningBig) { // Winning big late -> Conservative
        preferredPlays.push(...(categorizedPlays.safeZone || []), ...(categorizedPlays.safeZone || [])); // Play safe zone
        preferredPlays.push(...(categorizedPlays.runStop || [])); // Prevent easy runs
    }

    // D) Field Position Adjustments
    if (isRedZone) { // Offense near goal line
        preferredPlays.push(...(categorizedPlays.man || []), ...(categorizedPlays.man || [])); // Tight man coverage
        preferredPlays.push(...categorizedPlays.zone.filter(k => !k.includes('Deep'))); // Short zones
        preferredPlays.push(...(categorizedPlays.blitz || [])); // Pressure
    }
    if (isBackedUp) { // Offense deep
        preferredPlays.push(...(categorizedPlays.blitz || [])); // Go for safety/bad field pos
        preferredPlays.push(...(categorizedPlays.runStop || []));
    }


    // --- 6. Select Play ---
    let chosenPlay = null;

    // Filter preferred list to ensure plays are actually available in current formation
    const validPreferredPlays = preferredPlays.filter(play => availablePlays.includes(play));

    if (validPreferredPlays.length > 0) {
        chosenPlay = getRandom(validPreferredPlays); // Select randomly from the weighted list
    } else {
        // Fallback if weighting resulted in no valid options (unlikely but possible)
        console.warn(`No valid preferred plays found for ${defenseFormationName} in current situation. Choosing random available play.`);
        chosenPlay = getRandom(availablePlays); // Choose randomly from plays valid for the formation
    }

    // Final safety net - should not be reached if availablePlays has items
    if (!chosenPlay) {
        console.error("CRITICAL FALLBACK: Could not select any defensive play.");
        chosenPlay = availablePlays[0] || 'Cover_2_Zone_3-1-3';
    }

    // gameLog.push(`Def Play Call: ${chosenPlay}`); // Optional: Log decision
    return chosenPlay;
}

// In game.js

/**
 * Finds a suitable play to audible to from the same formation.
 * @param {object} offense - The offense team object.
 * @param {string} desiredType - 'pass' or 'run'.
 * @param {string | null} desiredTag - Optional tag (e.g., 'short', 'inside').
 * @returns {string | null} The key of the new play, or null if none found.
 */
function findAudiblePlay(offense, desiredType, desiredTag = null) {
    const offenseFormationName = offense.formations.offense;

    const possiblePlays = Object.keys(offensivePlaybook).filter(key =>
        key.startsWith(offenseFormationName) &&
        offensivePlaybook[key]?.type === desiredType
    );

    if (possiblePlays.length === 0) return null; // No plays of that type in this formation

    if (desiredTag) {
        const taggedPlays = possiblePlays.filter(key =>
            offensivePlaybook[key]?.tags?.includes(desiredTag)
        );
        if (taggedPlays.length > 0) return getRandom(taggedPlays);
    }

    // Fallback to any play of the desired type
    return getRandom(possiblePlays);
}

// game.js

// game.js

/**
 * AI logic for the QB to check the defensive play and audible.
 * @returns {{playKey: string, didAudible: boolean}}
 */
function aiCheckAudible(offense, offensivePlayKey, defense, defensivePlayKey, gameLog) {
    const offensePlay = offensivePlaybook[offensivePlayKey];
    const defensePlay = defensivePlaybook[defensivePlayKey];

    // This find is now safe from the fix we applied earlier
    const roster = getRosterObjects(offense);
    const qb = roster.find(p => p && p.id === offense.depthChart.offense.QB1);

    const qbIQ = qb?.attributes?.mental?.playbookIQ ?? 50;

    if (!offensePlay || !defensePlay || !qb) {
        return { playKey: offensivePlayKey, didAudible: false };
    }

    const iqChance = qbIQ / 150;
    let newPlayKey = offensivePlayKey;
    let didAudible = false;

    // 1. Check: Run play vs. a stacked box (Run Stop or All-Out Blitz)
    if (offensePlay.type === 'run' && (defensePlay.concept === 'Run' || (defensePlay.blitz && defensePlay.concept === 'Man'))) {
        if (Math.random() < iqChance) {
            const audibleTo = findAudiblePlay(offense, 'pass', 'short');
            if (audibleTo) {
                newPlayKey = audibleTo;
                didAudible = true;
                // --- 💡 FIX: Added a check to make sure gameLog is not null ---
                if (gameLog) {
                    gameLog.push(`[Audible]: 🧠 ${qb.name} sees the stacked box and audibles to a pass!`);
                }
            }
        }
    }
    // 2. Check: Pass play vs. a safe zone (no blitz, 'Zone' concept)
    else if (offensePlay.type === 'pass' && (defensePlay.blitz === false && defensePlay.concept === 'Zone')) {
        if (offensePlay.tags?.includes('deep') && Math.random() < iqChance) {
            const audibleTo = findAudiblePlay(offense, 'run', 'inside');
            if (audibleTo) {
                newPlayKey = audibleTo;
                didAudible = true;
                // --- 💡 FIX: Added a check to make sure gameLog is not null ---
                if (gameLog) {
                    gameLog.push(`[Audible]: 🧠 ${qb.name} sees the soft zone and audibles to a run!`);
                }
            }
        }
    }

    return { playKey: newPlayKey, didAudible };
}



/**
 * Simulates a full game between two teams.
 */
export function simulateGame(homeTeam, awayTeam, options = {}) {
    const fastSim = options.fastSim === true;
    let originalTickDuration = TICK_DURATION_SECONDS;
    let gameResult;

    try {
        if (fastSim) {
            TICK_DURATION_SECONDS = 0.005; 
        }
        if (!homeTeam || !awayTeam || !homeTeam.roster || !awayTeam.roster) {
            if (!fastSim) console.error("simulateGame: Invalid team data provided.");
            return { homeTeam, awayTeam, homeScore: 0, awayScore: 0, gameLog: ["Error: Invalid team data"], breakthroughs: [] };
        }

        resetGameStats(homeTeam, awayTeam);
        aiSetDepthChart(homeTeam);
        aiSetDepthChart(awayTeam);

        const gameLog = [];
        const allVisualizationFrames = fastSim ? null : [];
        let homeScore = 0, awayScore = 0;
        const weather = getRandom(['Sunny', 'Windy', 'Rain']);
        if (!fastSim) gameLog.push(`Weather: ${weather}`);

        const breakthroughs = [];
        const totalDrivesPerHalf = getRandomInt(4, 5);
        let currentHalf = 1, drivesThisGame = 0;
        let nextDriveStartBallOn = 20;

        if (!fastSim) gameLog.push("Coin toss to determine first possession...");
        const coinFlipWinner = Math.random() < 0.5 ? homeTeam : awayTeam;
        let possessionTeam = coinFlipWinner;
        let receivingTeamSecondHalf = (possessionTeam.id === homeTeam.id) ? awayTeam : homeTeam;
        if (!fastSim) gameLog.push(`🪙 ${coinFlipWinner.name} won the toss and will receive the ball first!`);

        let gameForfeited = false;

        while (drivesThisGame < totalDrivesPerHalf * 2 && !gameForfeited) {
            if (drivesThisGame === totalDrivesPerHalf) {
                currentHalf = 2;
                if (!fastSim) gameLog.push(`==== HALFTIME ==== Score: ${awayTeam.name} ${awayScore} - ${homeTeam.name} ${homeScore}`);
                possessionTeam = receivingTeamSecondHalf;

                const allGamePlayers = [...getRosterObjects(homeTeam), ...getRosterObjects(awayTeam)];
                allGamePlayers.forEach(p => {
                    if (p && typeof p.fatigue === "number") {
                        p.fatigue = Math.max(0, p.fatigue - 40);
                    } else if (p) {
                        p.fatigue = 0;
                    }
                });

                if (!fastSim) gameLog.push(`-- Second Half Kickoff: ${possessionTeam.name} receives --`);
                nextDriveStartBallOn = 20;
            }

            if (!possessionTeam) {
                console.error("Possession team is null! Ending game loop."); break;
            }
            const offense = possessionTeam;
            const defense = (possessionTeam.id === homeTeam.id) ? awayTeam : homeTeam;

            const checkRoster = (team) => {
                const roster = getRosterObjects(team);
                return roster.filter(p => p && p.status?.duration === 0).length < MIN_HEALTHY_PLAYERS;
            };

            if (checkRoster(offense) || checkRoster(defense)) {
                const forfeitingTeam = checkRoster(offense) ? offense : defense;
                const winningTeam = forfeitingTeam === offense ? defense : offense;
                if (gameLog) gameLog.push(`❗ ${forfeitingTeam.name} cannot field enough healthy players (${MIN_HEALTHY_PLAYERS}) and forfeits.`);
                if (winningTeam === homeTeam) { homeScore = 21; awayScore = 0; } else { homeScore = 0; awayScore = 21; }
                gameForfeited = true;
                break;
            }

            let ballOn = nextDriveStartBallOn, down = 1, yardsToGo = 10, driveActive = true;
            let ballHash = 'M';
            const yardLineText = ballOn <= 50 ? `own ${ballOn}` : `opponent ${100 - ballOn}`;
            if (!fastSim) gameLog.push(`-- Drive ${drivesThisGame + 1} (H${currentHalf}): ${offense.name} ball on ${yardLineText} --`);

            while (driveActive && down <= 4) {
                const healthyOffense = getRosterObjects(offense).filter(p => p && p.status?.duration === 0).length;
                const healthyDefense = getRosterObjects(defense).filter(p => p && p.status?.duration === 0).length;

                if (healthyOffense < MIN_HEALTHY_PLAYERS || healthyDefense < MIN_HEALTHY_PLAYERS) {
                    if (gameLog) gameLog.push("Forfeit condition met mid-drive.");
                    gameForfeited = true;
                    driveActive = false;
                    break;
                }

                const shouldPunt = determinePuntDecision(down, yardsToGo, ballOn);
                let result;
                let scoreDiff;
                let drivesRemainingInGame;

                if (shouldPunt) {
                    // --- 3A. IT'S A PUNT PLAY ---
                    if (!fastSim) {
                        gameLog.push(`--- 4th & ${yardsToGo <= 0 ? 'Goal' : yardsToGo}. ${offense.name} is punting. ---`);
                    }
                    // Set special team formations
                    offense.formations.offense = 'Punt';
                    defense.formations.defense = 'Punt_Return';

                    // 💡 **MODIFIED CALL:** Pass scores in, get scores back
                    result = resolvePunt(
                        offense, defense,
                        { gameLog: fastSim ? null : gameLog, ballOn },
                        homeScore,
                        awayScore,
                        homeTeam.id
                    );

                    // 💡 **NEW LOGIC:** Update scores based on punt result (e.g., Return TD)
                    homeScore = result.homeScore;
                    awayScore = result.awayScore;

                    if (result.turnover === false) {
                        // This means a muff was recovered by the punting team!
                        driveActive = true; // Keep the drive alive
                        ballOn = result.newBallOn;
                        down = 1;
                        yardsToGo = Math.max(1, Math.min(10, 100 - ballOn));
                        if (!fastSim) gameLog.push(`➡️ First down ${offense.name}!`);
                    } else {
                        // This was a normal punt, a touchback, or a return TD.
                        // In all cases, the drive ends for the offense.
                        driveActive = false;
                        nextDriveStartBallOn = result.newBallOn;
                    }

                    if (!fastSim && allVisualizationFrames) {
                        // Add a simple frame for the punt
                        allVisualizationFrames.push({
                            players: [], ball: null, logIndex: gameLog.length,
                            lineOfScrimmage: ballOn + 10, firstDownY: ballOn + 10 + yardsToGo
                        });
                    }

                } else {
                    // --- 3B. IT'S A NORMAL PLAY ---
                    if (!fastSim) {
                        // ... (existing gameLog push for down & distance) ...
                        const yardLineText = ballOn <= 50 ? `own ${ballOn}` : `opponent ${100 - ballOn}`;
                        const isGoalToGo = (ballOn + 10) + yardsToGo >= (FIELD_LENGTH - 10);
                        const downText = `${down}${down === 1 ? 'st' : down === 2 ? 'nd' : down === 3 ? 'rd' : 'th'}`;
                        const yardsText = isGoalToGo ? 'Goal' : yardsToGo;
                        gameLog.push(`--- ${downText} & ${yardsText} from the ${yardLineText} ---`);
                    }

                    // --- 4. PRE-SNAP & PLAY CALLING ---
                    offense.formations.offense = offense.coach.preferredOffense || 'Balanced';

                    // ✅ **FIX:** Assign the scoreDiff (it was declared above)
                    scoreDiff = offense.id === homeTeam.id ? homeScore - awayScore : awayScore - homeScore;
                    const drivesCompletedInHalf = drivesThisGame % totalDrivesPerHalf;
                    const drivesRemainingInHalf = totalDrivesPerHalf - drivesCompletedInHalf;
                    drivesRemainingInGame = (currentHalf === 1 ? totalDrivesPerHalf : 0) + drivesRemainingInHalf;

                    const offensivePlayKey_initial = determinePlayCall(offense, defense, down, yardsToGo, ballOn, scoreDiff, fastSim ? null : gameLog, drivesRemainingInGame);
                    const offenseFormationName = offense.formations.offense;
                    const defensiveFormationName = determineDefensiveFormation(defense, offenseFormationName, down, yardsToGo);
                    defense.formations.defense = defensiveFormationName;
                    const defensivePlayKey = determineDefensivePlayCall(defense, offense, down, yardsToGo, ballOn, scoreDiff, fastSim ? null : gameLog, drivesRemainingInGame);
                    const audibleResult = aiCheckAudible(offense, offensivePlayKey_initial, defense, defensivePlayKey, fastSim ? null : gameLog);
                    const offensivePlayKey = audibleResult.playKey;

                    if (!fastSim) {
                        const offPlayName = offensivePlaybook[offensivePlayKey]?.name || offensivePlayKey.split('_').slice(1).join(' ');
                        const defPlayName = defensivePlaybook[defensivePlayKey]?.name || defensivePlayKey;
                        if (gameLog) gameLog.push(`🏈 **Offense:** ${offPlayName} ${audibleResult.didAudible ? '(Audible)' : ''}`);
                        if (gameLog) gameLog.push(`🛡️ **Defense:** ${defPlayName}`);
                    }

                    result = resolvePlay(offense, defense, offensivePlayKey, defensivePlayKey, 
                    { gameLog: fastSim ? null : gameLog, weather, ballOn, ballHash, down, yardsToGo },
                    options // <-- ADD THIS
                    );

                    if (!fastSim && result.visualizationFrames) {
                        allVisualizationFrames.push(...result.visualizationFrames);
                    }
                    if (!fastSim && !result.incomplete && result.visualizationFrames?.length > 0) {
                        const finalBallX = result.visualizationFrames[result.visualizationFrames.length - 1].ball.x;
                        if (finalBallX < HASH_LEFT_X) ballHash = 'L';
                        else if (finalBallX > HASH_RIGHT_X) ballHash = 'R';
                        else ballHash = 'M';
                    }
                    ballOn += result.yards;
                    ballOn = Math.max(0, Math.min(100, ballOn));
                }

                // --- 5. PROCESS PLAY RESULT (Corrected Order) ---

                // --- 1. CHECK FOR TOUCHDOWN (OFFENSIVE OR DEFENSIVE) ---
                if (result.touchdown && !shouldPunt) {
                    const wasOffensiveTD = !result.turnover;

                    if (wasOffensiveTD) {
                        // --- Offensive TD ---
                        ballOn = 100;
                        const goesForTwo = Math.random() > 0.85;
                        const points = goesForTwo ? 2 : 1;
                        const conversionBallOn = goesForTwo ? 95 : 98;
                        const conversionYardsToGo = 100 - conversionBallOn;
                        if (!fastSim) gameLog.push(`--- ${points}-Point Conversion Attempt (from the ${conversionYardsToGo}-yd line) ---`);

                        offense.formations.offense = offense.coach.preferredOffense || 'Balanced';

                        const conversionOffensePlayKey = determinePlayCall(offense, defense, 1, conversionYardsToGo, conversionBallOn, scoreDiff, fastSim ? null : gameLog, drivesRemainingInGame);
                        const conversionDefenseFormation = determineDefensiveFormation(defense, offense.formations.offense, 1, conversionYardsToGo);
                        defense.formations.defense = conversionDefenseFormation;
                        const conversionDefensePlayKey = determineDefensivePlayCall(defense, offense, 1, conversionYardsToGo, conversionBallOn, scoreDiff, fastSim ? null : gameLog, drivesRemainingInGame);

                        if (!fastSim) {
                            const offPlayName = offensivePlaybook[conversionOffensePlayKey]?.name || conversionOffensePlayKey.split('_').slice(1).join(' ');
                            const defPlayName = defensivePlaybook[conversionDefensePlayKey]?.name || defensivePlayKey;
                            gameLog.push(`🏈 **Offense:** ${offPlayName}`);
                            gameLog.push(`🛡️ **Defense:** ${defPlayName}`);
                        }

                        const conversionResult = resolvePlay(offense, defense, conversionOffensePlayKey, conversionDefensePlayKey, {
                            gameLog: fastSim ? null : gameLog,
                            weather, ballOn: conversionBallOn, ballHash: 'M', down: 1, yardsToGo: conversionYardsToGo
                        }, options);

                        if (!fastSim && conversionResult.visualizationFrames) {
                            allVisualizationFrames.push(...conversionResult.visualizationFrames);
                        }

                        if (conversionResult.touchdown && !conversionResult.turnover) {
                            if (!fastSim) gameLog.push(`✅ ${points}-point conversion GOOD!`);
                            if (offense.id === homeTeam.id) homeScore += (6 + points); else awayScore += (6 + points);
                            scoreDiff = offense.id === homeTeam.id ? homeScore - awayScore : awayScore - homeScore;
                        } else if (conversionResult.touchdown && conversionResult.turnover) {
                            if (!fastSim) gameLog.push(`❌ ${points}-point conversion FAILED... AND RETURNED!`);
                            if (offense.id === homeTeam.id) homeScore += 6; else awayScore += 6;
                            if (defense.id === homeTeam.id) homeScore += 2; else awayScore += 2;
                            scoreDiff = offense.id === homeTeam.id ? homeScore - awayScore : awayScore - homeScore;
                        } else {
                            if (!fastSim) gameLog.push(`❌ ${points}-point conversion FAILED!`);
                            if (offense.id === homeTeam.id) homeScore += 6; else awayScore += 6;
                            scoreDiff = offense.id === homeTeam.id ? homeScore - awayScore : awayScore - homeScore;
                        }

                    } else {
                        // --- Defensive TD ---
                        if (!fastSim) gameLog.push(`🎉 DEFENSIVE TOUCHDOWN! 6 points for ${defense.name}!`);
                        if (defense.id === homeTeam.id) homeScore += 6; else awayScore += 6;
                        scoreDiff = offense.id === homeTeam.id ? homeScore - awayScore : awayScore - homeScore;
                    }

                    // End the drive and set up for a kickoff
                    driveActive = false;
                    nextDriveStartBallOn = 20;

                    // --- 2. CHECK FOR SAFETY ---
                } else if (result.safety && !shouldPunt) {
                    if (!fastSim) gameLog.push(`SAFETY! 2 points for ${defense.name}!`);
                    if (defense.id === homeTeam.id) homeScore += 2; else awayScore += 2;
                    scoreDiff = offense.id === homeTeam.id ? homeScore - awayScore : awayScore - homeScore;

                    // End the drive and set up for a safety punt
                    driveActive = false;
                    nextDriveStartBallOn = 20; // Defense will receive the "free kick" (simplified)

                    // --- 3. CHECK FOR NON-TD TURNOVER ---
                } else if (result.turnover && !shouldPunt) {
                    driveActive = false;
                    if (!shouldPunt) {
                        // This is a turnover on downs or a non-TD INT/fumble
                        nextDriveStartBallOn = 100 - ballOn;
                    }
                    // (if it was a punt, nextDriveStartBallOn was already set by resolvePunt)

                    // --- 4. CHECK FOR INCOMPLETE PASS ---
                } else if (result.incomplete && !shouldPunt) {
                    down++;

                    // --- 5. REGULAR PLAY (GAIN/LOSS) ---
                } else if (!shouldPunt) { // Completed play, not a punt
                    const goalLineY = FIELD_LENGTH - 10;
                    const absoluteLoS_Y = (ballOn - result.yards) + 10;
                    const yardsToGoalLine = goalLineY - absoluteLoS_Y;
                    const wasGoalToGo = (yardsToGo >= yardsToGoalLine);

                    yardsToGo -= result.yards;

                    if (yardsToGo <= 0) { // First down
                        down = 1;
                        const newYardsToGoalLine = 100 - ballOn;

                        if (newYardsToGoalLine <= 10) {
                            yardsToGo = newYardsToGoalLine; // e.g., 1st & Goal from the 8
                        } else {
                            yardsToGo = 10; // 1st & 10
                        }
                        if (yardsToGo <= 0) yardsToGo = 1; // 1st & Goal from the <1 yard line

                        if (!fastSim) {
                            const newYardLineText = ballOn <= 50 ? `own ${ballOn}` : `opponent ${100 - ballOn}`;
                            gameLog.push(`➡️ First down ${offense.name}! ${newYardsToGoalLine <= 10 ? `1st & Goal at the ${newYardsToGoalLine}` : `1st & 10 at the ${newYardLineText}`}.`);
                        }

                    } else { // Not a first down
                        down++;
                        if (wasGoalToGo) {
                            yardsToGo = 100 - ballOn; // Update yards to go on "Goal to Go"
                        }
                    }
                }

                // --- 6. CHECK FOR TURNOVER ON DOWNS (at the end of all checks) ---
                if (down > 4 && driveActive) {
                    if (!fastSim) {
                        const finalYardLineText = ballOn <= 50 ? `own ${ballOn}` : `opponent ${100 - ballOn}`;
                        gameLog.push(`✋ Turnover on downs! ${defense.name} takes over at the ${finalYardLineText}.`);
                    }
                    driveActive = false;
                    nextDriveStartBallOn = 100 - ballOn;
                }
            } // --- End Play Loop (while driveActive) ---

            drivesThisGame++;
            if (drivesThisGame < totalDrivesPerHalf * 2 && !gameForfeited) {
                possessionTeam = (possessionTeam?.id === homeTeam.id) ? awayTeam : homeTeam;
            }
        } // --- End Game Loop ---

        // --- OVERTIME LOGIC ---
        if (homeScore === awayScore && !gameForfeited) {
            if (!fastSim) {
                gameLog.push(`==== GAME TIED: ${homeScore}-${awayScore} ====`);
                gameLog.push(`Heading to Sudden Death Overtime!`);
            }

            let overtimeRound = 0;
            let isStillTied = true;
            let otPossessionOrder = [receivingTeamSecondHalf, (receivingTeamSecondHalf.id === homeTeam.id) ? awayTeam : homeTeam];

            while (isStillTied && overtimeRound < 10) {
                overtimeRound++;
                const yardsFromGoal = 5 * overtimeRound;
                const startBallOn = 100 - yardsFromGoal;
                if (!fastSim) gameLog.push(`--- OT Round ${overtimeRound}: Ball at the ${yardsFromGoal}-yard line ---`);

                for (const offense of otPossessionOrder) {
                    const defense = (offense.id === homeTeam.id) ? awayTeam : homeTeam;
                    if (homeScore !== awayScore) {
                        isStillTied = false;
                        break;
                    }

                    let ballOn = startBallOn;
                    let down = 1;
                    let yardsToGo = 100 - ballOn;
                    let driveActive = true;
                    let ballHash = 'M';
                    if (!fastSim) gameLog.push(`OT Possession: ${offense.name}`);

                    while (driveActive && down <= 4) {

                        let scoreDiff;
                        if (!fastSim) {
                            const yardLineText = `opponent ${100 - ballOn}`;
                            if (gameLog) gameLog.push(`--- ${down} & ${yardsToGo <= 0 ? 'Goal' : yardsToGo} from the ${yardLineText} ---`);
                        }

                        // ✅ **FIX (OT):** Assign scoreDiff
                        scoreDiff = offense.id === homeTeam.id ? homeScore - awayScore : awayScore - homeScore;
                        const drivesRemainingInGame = 0;

                        const offensivePlayKey_initial = determinePlayCall(offense, defense, down, yardsToGo, ballOn, scoreDiff, fastSim ? null : gameLog, drivesRemainingInGame);
                        const offenseFormationName = offense.formations.offense;
                        const defensiveFormationName = determineDefensiveFormation(defense, offenseFormationName, down, yardsToGo);
                        defense.formations.defense = defensiveFormationName;
                        const defensivePlayKey = determineDefensivePlayCall(defense, offense, down, yardsToGo, ballOn, scoreDiff, fastSim ? null : gameLog, drivesRemainingInGame);
                        const audibleResult = aiCheckAudible(offense, offensivePlayKey_initial, defense, defensivePlayKey, fastSim ? null : gameLog);
                        const offensivePlayKey = audibleResult.playKey;

                        if (!fastSim) {
                            const offPlayName = offensivePlaybook[offensivePlayKey]?.name || offensivePlayKey.split('_').slice(1).join(' ');
                            const defPlayName = defensivePlaybook[defensivePlayKey]?.name || defensivePlayKey;
                            if (gameLog) gameLog.push(`🏈 **Offense:** ${offPlayName} ${audibleResult.didAudible ? '(Audible)' : ''}`);
                            if (gameLog) gameLog.push(`🛡️ **Defense:** ${defPlayName}`);
                        }

                        const result = resolvePlay(offense, defense, offensivePlayKey, defensivePlayKey, 
                            { gameLog: fastSim ? null : gameLog, weather, ballOn, ballHash, down, yardsToGo },
                            options 
                        );

                        if (!fastSim && result.visualizationFrames) allVisualizationFrames.push(...result.visualizationFrames);
                        if (!fastSim && !result.incomplete && result.visualizationFrames?.length > 0) {
                            const finalBallX = result.visualizationFrames[result.visualizationFrames.length - 1].ball.x;
                            if (finalBallX < HASH_LEFT_X) ballHash = 'L';
                            else if (finalBallX > HASH_RIGHT_X) ballHash = 'R';
                            else ballHash = 'M';
                        }
                        ballOn += result.yards;
                        ballOn = Math.max(0, Math.min(100, ballOn));

                        if (result.turnover) {
                            driveActive = false;
                            if (!fastSim) gameLog.push(`Turnover! Drive ends.`);
                            if (result.touchdown) {
                                if (!fastSim) gameLog.push(`DEFENSIVE TOUCHDOWN! Game Over!`);
                                if (defense.id === homeTeam.id) homeScore += 6; else awayScore += 6;
                                // ✅ **FIX (OT):** Update scoreDiff
                                scoreDiff = offense.id === homeTeam.id ? homeScore - awayScore : awayScore - homeScore;
                                isStillTied = false;
                            }
                        } else if (result.safety) {
                            if (!fastSim) gameLog.push(`SAFETY! Game Over!`);
                            if (defense.id === homeTeam.id) homeScore += 2; else awayScore += 2;
                            // ✅ **FIX (OT):** Update scoreDiff
                            scoreDiff = offense.id === homeTeam.id ? homeScore - awayScore : awayScore - homeScore;
                            driveActive = false;
                            isStillTied = false;
                        } else if (result.touchdown) {
                            ballOn = 100;
                            const wasOffensiveTD = !result.turnover;

                            if (wasOffensiveTD) {
                                const goesForTwo = Math.random() > 0.85;
                                const points = goesForTwo ? 2 : 1;
                                const conversionBallOn = goesForTwo ? 95 : 98;
                                const conversionYardsToGo = 100 - conversionBallOn;
                                if (!fastSim) gameLog.push(`--- ${points}-Point Conversion Attempt ---`);

                                // ✅ **FIX (OT):** scoreDiff is in scope
                                const conversionOffensePlayKey = determinePlayCall(offense, defense, 1, conversionYardsToGo, conversionBallOn, scoreDiff, fastSim ? null : gameLog, drivesRemainingInGame);
                                const conversionDefenseFormation = determineDefensiveFormation(defense, offense.formations.offense, 1, conversionYardsToGo);
                                defense.formations.defense = conversionDefenseFormation;
                                const conversionDefensePlayKey = determineDefensivePlayCall(defense, offense, 1, conversionYardsToGo, conversionBallOn, scoreDiff, fastSim ? null : gameLog, drivesRemainingInGame);

                                if (!fastSim) {
                                    const convOffPlayName = offensivePlaybook[conversionOffensePlayKey]?.name || conversionOffensePlayKey.split('_').slice(1).join(' ');
                                    const convDefPlayName = defensivePlaybook[conversionDefensePlayKey]?.name || defensivePlayKey;
                                    if (gameLog) gameLog.push(`🏈 **Offense:** ${convOffPlayName}`);
                                    if (gameLog) gameLog.push(`🛡️ **Defense:** ${convDefPlayName}`);
                                }

                                const conversionResult = resolvePlay(offense, defense, conversionOffensePlayKey, conversionDefensePlayKey, 
                                    { gameLog: fastSim ? null : gameLog, weather, ballOn: conversionBallOn, ballHash: 'M', down: 1, yardsToGo: conversionYardsToGo },
                                    options // <-- ADD THIS
                                );
                                
                                if (!fastSim && conversionResult.visualizationFrames) allVisualizationFrames.push(...conversionResult.visualizationFrames);

                                if (conversionResult.touchdown) {
                                    if (!conversionResult.turnover) {
                                        if (!fastSim) gameLog.push(`✅ ${points}-point conversion GOOD!`);
                                        if (offense.id === homeTeam.id) homeScore += (6 + points); else awayScore += (6 + points);
                                        // ✅ **FIX (OT):** Update scoreDiff
                                        scoreDiff = offense.id === homeTeam.id ? homeScore - awayScore : awayScore - homeScore;
                                    } else {
                                        if (!fastSim) gameLog.push(`❌ Conversion FAILED... AND RETURNED! Game Over!`);
                                        if (offense.id === homeTeam.id) homeScore += 6; else awayScore += 6;
                                        if (defense.id === homeTeam.id) homeScore += 2; else awayScore += 2;
                                        // ✅ **FIX (OT):** Update scoreDiff
                                        scoreDiff = offense.id === homeTeam.id ? homeScore - awayScore : awayScore - homeScore;
                                        isStillTied = false;
                                    }
                                } else {
                                    if (!fastSim) gameLog.push(`❌ ${points}-point conversion FAILED!`);
                                    if (offense.id === homeTeam.id) homeScore += 6; else awayScore += 6;
                                    // ✅ **FIX (OT):** Update scoreDiff
                                    scoreDiff = offense.id === homeTeam.id ? homeScore - awayScore : awayScore - homeScore;
                                }
                            }
                            driveActive = false;
                        } else if (result.incomplete) {
                            down++;
                        } else { // Completed play
                            yardsToGo -= result.yards;
                            if (yardsToGo <= 0) {
                                down = 1;
                                if (ballOn >= 90) {
                                    yardsToGo = 100 - ballOn;
                                } else {
                                    yardsToGo = 10;
                                }
                                if (yardsToGo <= 0) {
                                    yardsToGo = 1;
                                    
                                }
                                if (!fastSim) {
                                    const newYardLineText = ballOn <= 50 ? `own ${ballOn}` : `opponent ${100 - ballOn}`;
                                    if (gameLog) gameLog.push(`➡️ First down ${offense.name}! ${ballOn >= 90 ? `1st & Goal at the ${100 - ballOn}` : `1st & 10 at the ${newYardLineText}`}.`);
                                }
                            } else {
                                down++;
                            }
                        }
                        if (down > 4 && driveActive) {
                            if (!fastSim) gameLog.push(`✋ Turnover on downs! Drive ends.`);
                            driveActive = false;
                        }
                    } // --- End OT Play Loop ---
                } // --- End OT `for` loop ---

                if (isStillTied) {
                    isStillTied = (homeScore === awayScore);
                    if (isStillTied) {
                        if (!fastSim) gameLog.push(`Round ${overtimeRound} ends. Still tied ${homeScore}-${awayScore}.`);
                        otPossessionOrder.reverse();
                    }
                }
            } // --- End OT `while(isStillTied)` loop ---

            if (isStillTied) {
                if (!fastSim) gameLog.push(`After ${overtimeRound} rounds, the game is still tied. Declaring a TIE.`);
            } else {
                if (!fastSim) gameLog.push(`Overtime complete. Final score: ${awayTeam.name} ${awayScore} - ${homeTeam.name} ${homeScore}`);

            }
        }
        // --- END OVERTIME BLOCK ---

        if (gameLog) gameLog.push(`==== FINAL SCORE ==== ${awayTeam.name} ${awayScore} - ${homeTeam.name} ${homeScore}`);

        if (!gameForfeited) {
            if (homeScore > awayScore) { homeTeam.wins = (homeTeam.wins || 0) + 1; awayTeam.losses = (awayTeam.losses || 0) + 1; }
            else if (awayScore > homeScore) { awayTeam.wins = (awayTeam.wins || 0) + 1; homeTeam.losses = (homeTeam.losses || 0) + 1; }
            else if (homeScore === awayScore) {
                homeTeam.ties = (homeTeam.ties || 0) + 1;
                awayTeam.ties = (awayTeam.ties || 0) + 1;
            }
        } else {
            if (homeScore > awayScore) { homeTeam.wins = (homeTeam.wins || 0) + 1; awayTeam.losses = (awayTeam.losses || 0) + 1; }
            else if (awayScore > homeScore) { awayTeam.wins = (awayTeam.wins || 0) + 1; homeTeam.losses = (homeTeam.losses || 0) + 1; }
        }

        const allGamePlayersForStats = [...getRosterObjects(homeTeam), ...getRosterObjects(awayTeam)];
        allGamePlayersForStats.forEach(p => {
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

            if (!p.seasonStats) p.seasonStats = {};
            if (!p.careerStats) p.careerStats = { seasonsPlayed: p.careerStats?.seasonsPlayed || 0 };

            for (const stat in p.gameStats) {
                if (typeof p.gameStats[stat] === 'number') {
                    p.seasonStats[stat] = (p.seasonStats[stat] || 0) + p.gameStats[stat];
                    p.careerStats[stat] = (p.careerStats[stat] || 0) + p.gameStats[stat];
                }
            }
        });
        

        gameResult = {
            homeTeam,
            awayTeam,
            homeScore,
            awayScore,
            gameLog,
            breakthroughs,
            visualizationFrames: allVisualizationFrames
        };


    } catch (error) {
        console.error(`simulateGame ERROR: ${error.message}`, error); // Improved logging
        gameResult = {
            homeTeam,
            awayTeam,
            homeScore: 0,
            awayScore: 0,
            gameLog: [`⚠️ Simulation error: ${error.message}`],
            breakthroughs: [],
            visualizationFrames: null
        };
    } finally {
         TICK_DURATION_SECONDS = originalTickDuration;
    }
    // This runs *after* the try/catch, so it always gets a gameResult (even a 0-0 error one)
    if (gameResult) {
        if (!game.gameResults) {
            game.gameResults = [];
        }
        game.gameResults.push({
            homeTeam: { id: gameResult.homeTeam.id, name: gameResult.homeTeam.name },
            awayTeam: { id: gameResult.awayTeam.id, name: gameResult.awayTeam.name },
            homeScore: gameResult.homeScore,
            awayScore: gameResult.awayScore
        });
    }

    return gameResult;
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

/**
 * Simulates all games for the current week and advances state.
 */
export function simulateWeek(options = {}) {
    // 1. MODIFIED: Removed !game.schedule from this check
    if (!game || !game.teams) {
        console.error("simulateWeek: Invalid game state.");
        return [];
    }
    const WEEKS_IN_SEASON = 9;
    if (game.currentWeek >= WEEKS_IN_SEASON) {
        console.warn("simulateWeek: Season already over.");
        return null;
    }

    endOfWeekCleanup();
    updatePlayerStatuses();
    generateWeeklyEvents();
    game.breakthroughs = [];


    // Check if the schedule exists OR if it's empty when it shouldn't be
    if (!game.schedule || game.schedule.length === 0) {
        // Only generate a new schedule if we are at the *start* of the season
        if (game.currentWeek === 0) {
            console.log("No schedule found for Week 0. Generating new season schedule...");
            generateSchedule(); // This will populate game.schedule
        } else {
            // If we're past week 0 and have no schedule, something is very wrong.
            console.error(`simulateWeek: Schedule is missing mid-season (Week ${game.currentWeek}). Cannot proceed.`);
            return [];
        }
    }


    const gamesPerWeek = game.teams.length / 2;
    const startIndex = game.currentWeek * gamesPerWeek;
    const endIndex = startIndex + gamesPerWeek;
    const weeklyGames = game.schedule.slice(startIndex, endIndex); // This should now work

    if (!weeklyGames || weeklyGames.length === 0) {
        console.warn(`No games found for week ${game.currentWeek}`);
        // Do not proceed if games are still missing after the check
        game.currentWeek++;
        return [];
    }

    const results = weeklyGames.map(match => {
        try {
            if (!match?.home || !match?.away) { return null; }
            const result = simulateGame(match.home, match.away, options);
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
    // --- 💡 FIX: Get roster objects ---
    const roster = getRosterObjects(team);
    if (!roster.some(p => p && p.status?.duration > 0)) {
        // --- 💡 END FIX ---
        return { success: false, message: "You can only call a friend if a player on your team is currently injured or busy." };
    }
    const player = game.freeAgents.find(p => p && p.id === playerId);
    if (!player) return { success: false, message: "That player is no longer available this week." };

    const maxLevel = roster.reduce( // Use the roster objects
        (max, rosterPlayer) => Math.max(max, getRelationshipLevel(rosterPlayer?.id, playerId)),
        relationshipLevels.STRANGER.level
    );
    const relationshipInfo = Object.values(relationshipLevels).find(rl => rl.level === maxLevel) || relationshipLevels.STRANGER;
    const successChance = relationshipInfo.callChance;
    const relationshipName = relationshipInfo.name;

    game.freeAgents = game.freeAgents.filter(p => p && p.id !== playerId);

    if (Math.random() < successChance) {
        player.status = { type: 'temporary', description: 'Helping Out', duration: 1 };
        if (addPlayerToTeam(player, team)) { // This now adds an ID
            // --- 💡 FIX: Get the full roster objects to do relationship improvements ---
            const fullRoster = getRosterObjects(team);
            fullRoster.forEach(rosterPlayer => {
                // --- 💡 END FIX ---
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

// game.js

export function aiManageRoster(team) {
    if (!team || !team.roster || !game || !game.freeAgents || !team.coach) return;

    // --- 💡 FIX: Get roster objects ---
    const roster = getRosterObjects(team);
    let healthyCount = roster.filter(p => p && p.status?.duration === 0).length;
    // --- 💡 END FIX ---

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
                // --- 💡 FIX: Re-get roster objects to check count ---
                const newRoster = getRosterObjects(team);
                healthyCount = newRoster.filter(p => p && p.status?.duration === 0).length;
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
    const potentialMultipliers = { 'A': 1.6, 'B': 1.3, 'C': 1.0, 'D': 0.7, 'F': 0.4 };
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

        // --- 💡 FIX: Get roster objects ---
        const fullRoster = getRosterObjects(team);
        if (fullRoster.length < 2) return;

        for (let i = 0; i < fullRoster.length; i++) {
            for (let j = i + 1; j < fullRoster.length; j++) {
                const p1 = fullRoster[i]; const p2 = fullRoster[j];
                // --- 💡 END FIX ---
                if (!p1 || !p2) continue;
                if (Math.random() < teammateImproveChance) improveRelationship(p1.id, p2.id);
            }
        }
    });

    game.teams.forEach(team => {
        if (!team || !team.roster) return;

        // --- 💡 FIX: Get roster objects ---
        const currentRoster = getRosterObjects(team);
        team.roster = []; // Clear roster to rebuild with IDs

        currentRoster.forEach(player => {
            // --- 💡 END FIX ---
            if (!player.careerStats || !player.attributes) return;

            player.age++;
            player.careerStats.seasonsPlayed = (player.careerStats.seasonsPlayed || 0) + 1;

            const devReport = developPlayer(player);
            if (team.id === game.playerTeam?.id) developmentResults.push(devReport);

            let playerIsLeaving = false;
            if (player.age >= 17) {
                retiredPlayers.push(player); playerIsLeaving = true;
                if (team.id === game.playerTeam?.id) addMessage("Player Retires", `${player.name} is moving on from the league.`);
                if ((player.careerStats.touchdowns || 0) > 25 /* ... other HOF criteria ... */) {
                    if (!game.hallOfFame) game.hallOfFame = [];
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
                // --- 💡 FIX: Add the ID back to the roster ---
                team.roster.push(player.id);
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
    const player = team.roster.find(p => p && p.id === playerId);
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

/**
 * Substitute two players on a team: put inPlayer into the starter slot occupied by outPlayer.
 * If inPlayer is currently assigned to another slot, the assignemnts will be swapped.
 * Returns an object { success: boolean, message: string }
 */
export function substitutePlayers(teamId, outPlayerId, inPlayerId) {
    if (!game || !game.teams) return { success: false, message: 'Game state invalid.' };
    const team = game.teams.find(t => t && t.id === teamId) || game.playerTeam;
    if (!team || !team.depthChart) return { success: false, message: 'Team or depth chart invalid.' };

    const fullRoster = getRosterObjects(team);
    const outPlayer = fullRoster.find(p => p && p.id === outPlayerId);
    const inPlayer = fullRoster.find(p => p && p.id === inPlayerId);
    if (!outPlayer) return { success: false, message: 'Outgoing player not found on roster.' };
    if (!inPlayer) return { success: false, message: 'Incoming player not found on roster.' };

    // depthChart is organized by side (offense/defense). Find slots across both sides.
    const sides = Object.keys(team.depthChart || {});
    const outSlots = [];
    const inSlots = [];
    sides.forEach(side => {
        const chart = team.depthChart[side] || {};
        Object.keys(chart).forEach(slot => {
            if (chart[slot] === outPlayerId) outSlots.push({ side, slot });
            if (chart[slot] === inPlayerId) inSlots.push({ side, slot });
        });
    });

    if (outSlots.length === 0) {
        return { success: false, message: 'Outgoing player is not currently a starter.' };
    }

    // Use first found out slot as target
    const target = outSlots[0];
    team.depthChart[target.side][target.slot] = inPlayerId;

    if (inSlots.length > 0) {
        // If incoming player was a starter, swap them
        const inSlot = inSlots[0];
        team.depthChart[inSlot.side][inSlot.slot] = outPlayerId;
    } else {
        // Incoming player was on bench. Remove any additional references to outPlayer in depth chart
        sides.forEach(side => {
            const chart = team.depthChart[side] || {};
            Object.keys(chart).forEach(slot => {
                if (chart[slot] === outPlayerId && !(side === target.side && slot === target.slot)) chart[slot] = null;
            });
        });
    }

    console.log(`Substitution: ${inPlayer.name} -> ${target.side}/${target.slot} replacing ${outPlayer.name}`);
    return { success: true, message: 'Substitution completed.' };
}

/**
 * AI: make intelligent substitutions for a team based on fatigue and suitability.
 * Will attempt up to `maxSubs` swaps, preferring bench players with lower fatigue
 * and better suitability for the target slot. Returns how many substitutions were made.
 */
export function autoMakeSubstitutions(team, options = {}) {
    if (!team || !team.depthChart || !team.roster) return 0;
    const thresholdFatigue = options.thresholdFatigue || 60; // starter fatigue threshold
    const maxSubs = options.maxSubs || 2;
    const chance = typeof options.chance === 'number' ? options.chance : 0.25; // probability to attempt any subs

    if (Math.random() > chance) return 0; // don't always run

    const fullRoster = getRosterObjects(team);
    const sides = Object.keys(team.depthChart || {});
    const starterIds = new Set();
    sides.forEach(side => {
        const chart = team.depthChart[side] || {};
        Object.values(chart).forEach(id => { if (id) starterIds.add(id); });
    });

    let subsDone = 0;

    // Iterate sides/slots and look for tired starters
    for (const side of sides) {
        const chart = team.depthChart[side] || {};
        for (const slot of Object.keys(chart)) {
            if (subsDone >= maxSubs) break;
            const starterId = chart[slot];
            if (!starterId) continue;
            const starter = fullRoster.find(p => p && p.id === starterId);
            if (!starter) continue;
            const starterFat = starter.fatigue || 0;
            if (starter.status && starter.status.duration > 0) continue; // injured or busy handled elsewhere

            // If starter is fatigued beyond threshold, try to find a bench replacement
            if (starterFat >= thresholdFatigue) {
                // bench candidates not starters, not injured, and with meaningfully lower fatigue
                const candidates = fullRoster.filter(p => p && !starterIds.has(p.id) && (!p.status || p.status.duration === 0) && ((p.fatigue || 0) + 8 < starterFat));
                if (candidates.length === 0) continue;

                // Score candidates by suitability for this slot (higher is better), tiebreaker lower fatigue
                let best = null; let bestScore = -Infinity;
                for (const cand of candidates) {
                    const pos = slot.replace(/\d/g, '');
                    const score = calculateSlotSuitability(cand, slot, side, team) + (-(cand.fatigue || 0) * 0.1);
                    if (score > bestScore) { bestScore = score; best = cand; }
                }

                if (best) {
                    const res = substitutePlayers(team.id, starterId, best.id);
                    if (res && res.success) {
                        subsDone++;
                        // update starterIds set
                        starterIds.delete(starterId);
                        starterIds.add(best.id);
                    }
                }
            }
        }
        if (subsDone >= maxSubs) break;
    }

    if (subsDone > 0) console.log(`autoMakeSubstitutions: ${team.name} made ${subsDone} subs`);
    return subsDone;
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
    const playerIndex = team.roster.findIndex(pId => pId === playerId);

    if (playerIndex > -1) {
        const [removedId] = team.roster.splice(playerIndex, 1);
        const player = game.players.find(p => p && p.id === removedId); // Find the full object

        if (player.status?.type === 'temporary') {
            team.roster.splice(playerIndex, 0, removedId); // Add it back!
            return { success: false, message: "Cannot cut temporary friends." };
        }
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
        team.roster.forEach(rosterPlayerId => {
            if (rosterPlayerId) decreaseRelationship(rosterPlayerId, player.id);
        });
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

    // --- 💡 FIX: Get roster objects ---
    const roster = getRosterObjects(team);
    if (roster.length >= ROSTER_LIMIT) {
        // --- 💡 END FIX ---
        return { success: false, message: `Roster is full (${ROSTER_LIMIT} players max).` };
    }

    const player = game.players.find(p => p && p.id === playerId && !p.teamId);

    if (player) {
        player.status = { type: 'healthy', description: '', duration: 0 };

        if (addPlayerToTeam(player, team)) { // This function now handles number assignment
            aiSetDepthChart(team);
            addMessage("Roster Move", `${player.name} has been signed to the team!`);

            // --- 💡 FIX: Get the full roster objects ---
            const fullRoster = getRosterObjects(team);
            fullRoster.forEach(rp => { if (rp && rp.id !== player.id) improveRelationship(rp.id, player.id); });
            // --- 💡 END FIX ---

            return { success: true };
        } else {
            return { success: false, message: "Failed to add player to roster." };
        }
    } else {
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

const DEFAULT_SAVE_KEY = 'backyardFootballGameState';

/**
 * Saves the current game state to localStorage under a specific key.
 * @param {string} [saveKey=DEFAULT_SAVE_KEY] - The key to save the game under.
 */
export function saveGameState(saveKey = DEFAULT_SAVE_KEY) {
    try {
        // --- FIX: We must convert the Map to an Object for JSON.stringify ---
        const gameStateToSave = { ...game };
        if (game.relationships instanceof Map) {
            gameStateToSave.relationships = Object.fromEntries(game.relationships);
        }
        // --- END FIX ---

        localStorage.setItem(saveKey, JSON.stringify(gameStateToSave));
        if (saveKey === DEFAULT_SAVE_KEY) {
            console.log("Game state saved.");
        } else {
            console.log(`Game state saved to key: ${saveKey}`);
        }
    } catch (e) {
        console.error('Error saving game state:', e);
    }
}

/**
 * Loads a game state from localStorage using a specific key.
 * @param {string} [saveKey=DEFAULT_SAVE_KEY] - The key to load the game from.
 */
export function loadGameState(saveKey = DEFAULT_SAVE_KEY) {
    try {
        const saved = localStorage.getItem(saveKey);
        if (saved) {
            const loaded = JSON.parse(saved);

            // Set 'game' to the loaded object
            game = loaded;

            // Check if relationships is a plain object and convert it back to a Map
            if (game.relationships && !(game.relationships instanceof Map)) {
                game.relationships = new Map(Object.entries(game.relationships));
            }

            return game; // Return the loaded game
        }
    } catch (e) {
        console.error('Error loading game state:', e);
    }
    // If no save was found, return null
    return null;
}
