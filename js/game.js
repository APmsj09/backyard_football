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
let playerMap = new Map();

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

    // Safety check: if map is empty (e.g. after load), rebuild it
    if (playerMap.size === 0 && game && game.players) {
        game.players.forEach(p => playerMap.set(p.id, p));
    }

    // Map roster IDs directly to player objects
    return team.roster
        .map(id => playerMap.get(id))
        .filter(p => p); // Filter out any undefineds (deleted players)
}
/**
 * Sets the captain for a specific team.
 * @param {object} team - The team object.
 * @param {string} playerId - The ID of the player to make captain.
 */
function setTeamCaptain(team, playerId) {
    if (!team || !playerId) return false;

    // Validate player is on the roster
    if (team.roster.includes(playerId)) {
        team.captainId = playerId;
        return true;
    }
    console.warn(`Player ${playerId} not found on team ${team.name}`);
    return false;
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
function yieldToMain() { return new Promise(resolve => setTimeout(resolve, 0)); }

/** Adds a message to the player's inbox.
 * Accepts an optional gameObj for easier testing; falls back to the module-level `game`.
 */
function addMessage(subject, body, isRead = false, gameObj = null) {
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
// game.js

/** Checks for a fumble during a tackle attempt. */
function checkFumble(ballCarrierState, tacklerState, playState, gameLog) {
    // 💡 Update: Use flattened properties from pState directly
    // Note: ballCarrierState and tacklerState are now the pState objects from activePlayers

    const toughness = ballCarrierState.toughness || 50;
    const strength = tacklerState.strength || 50;
    const tackling = tacklerState.tackling || 50;

    const carrierModifier = toughness / 100;
    const tacklerModifier = (strength + tackling) / 100;

    const fumbleChance = FUMBLE_CHANCE_BASE * (tacklerModifier / (carrierModifier + 0.5));

    if (Math.random() < fumbleChance) {
        if (gameLog) gameLog.push(`❗ FUMBLE! Ball knocked loose by ${tacklerState.name}!`);
        playState.turnover = true;

        playState.ballState.isLoose = true;
        playState.ballState.inAir = false;
        playState.ballState.z = 0.1;
        playState.ballState.vx = 0;
        playState.ballState.vy = 0;

        // Drop ball at carrier's location
        playState.ballState.x = ballCarrierState.x;
        playState.ballState.y = ballCarrierState.y;

        ballCarrierState.isBallCarrier = false;
        ballCarrierState.hasBall = false;
        ballCarrierState.stunnedTicks = 40;

        tacklerState.stunnedTicks = 20;

        // Track fumble stats
        ensureStats(ballCarrierState);
        ballCarrierState.gameStats.fumbles = (ballCarrierState.gameStats.fumbles || 0) + 1;

        return true;
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
    const minTicksToRead = Math.max(30, Math.round((100 - iq) / 20) * 5 + 10);

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
async function initializeLeague(onProgress) {
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

    playerMap.clear();
    game.players.forEach(p => playerMap.set(p.id, p));

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

    console.log("Assigning Team Captains...");
    game.teams.forEach(team => {
        assignTeamCaptain(team);
    });
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
function createPlayerTeam(teamName) {
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
function setupDraft() {
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

/**
 * Automatically sets depth chart for an AI-controlled team.
 * Produces both a valid depthChart and a complete depthOrder (starter → bench list).
 */
function aiSetDepthChart(team) {
    const rosterObjs = getRosterObjects(team);
    if (!team || !team.depthChart || !team.formations || !Array.isArray(rosterObjs)) {
        console.error("aiSetDepthChart: Invalid team object:", team?.name);
        return;
    }

    if (rosterObjs.length === 0) return;

    const { depthChart, formations } = team;

    // ----------------------------------------------------
    // 1. Initialize depthChart structure for offense/defense
    // ----------------------------------------------------
    for (const side of ["offense", "defense"]) {
        const formKey = side === "offense" ? formations.offense : formations.defense;
        const formDef = side === "offense"
            ? offenseFormations[formKey]
            : defenseFormations[formKey];

        const slots = Array.isArray(formDef?.slots) ? formDef.slots : [];

        const newSideChart = {};
        slots.forEach(slot => (newSideChart[slot] = null));
        depthChart[side] = newSideChart;
    }

    // ----------------------------------------------------
    // 2. Assign starters using suitability + best-position logic
    // ----------------------------------------------------
    const sides = ["offense", "defense"];
    const alreadyAssigned = new Set();

    for (const side of sides) {
        const slots = Object.keys(depthChart[side]);

        // PRIORITIZE KEY POSITIONS
        slots.sort((a, b) => {
            if (side === "offense") {
                if (a.startsWith("QB1")) return -1;
                if (b.startsWith("QB1")) return 1;
                if (a.startsWith("RB1")) return -1;
                if (b.startsWith("RB1")) return 1;
                if (a.startsWith("WR1")) return -1;
                if (b.startsWith("WR1")) return 1;
            } else {
                if (a.startsWith("DB1")) return -1;
                if (b.startsWith("DB1")) return 1;
                if (a.startsWith("LB2")) return -1;
                if (b.startsWith("LB2")) return 1;
                if (a.startsWith("DL2")) return -1;
                if (b.startsWith("DL2")) return 1;
            }
            return 0;
        });

        // Available players: healthy + not already used
        let available = rosterObjs.filter(p => p && (!p.status || p.status.duration === 0));

        // Assign best player for each slot
        for (const slot of slots) {
            if (available.length === 0) break;

            const basePosition = slot.replace(/\d/g, ""); // WR1 → "WR"

            // Pick best match
            const best = available.reduce((bestSoFar, cur) => {
                if (!bestSoFar) return cur;

                let bestScore = calculateSlotSuitability(bestSoFar, slot, side, team);
                let curScore = calculateSlotSuitability(cur, slot, side, team);

                try {
                    const bestEst = estimateBestPosition(bestSoFar);
                    const curEst = estimateBestPosition(cur);

                    // bonus if estimated best matches slot
                    if (bestEst === basePosition) bestScore += 12;
                    if (curEst === basePosition) curScore += 12;

                    // bonus if favorite O/D position matches
                    if (bestSoFar.favoriteOffensivePosition === basePosition ||
                        bestSoFar.favoriteDefensivePosition === basePosition)
                        bestScore += 8;

                    if (cur.favoriteOffensivePosition === basePosition ||
                        cur.favoriteDefensivePosition === basePosition)
                        curScore += 8;

                    // side mismatch penalty
                    const off = ["QB", "RB", "WR", "OL"];
                    const def = ["DL", "LB", "DB"];
                    if ((side === "offense" && def.includes(bestEst)) ||
                        (side === "defense" && off.includes(bestEst)))
                        bestScore -= 20;
                    if ((side === "offense" && def.includes(curEst)) ||
                        (side === "defense" && off.includes(curEst)))
                        curScore -= 20;
                } catch (e) {
                    // ignore if estimateBestPosition fails
                }

                // penalty if already used somewhere else
                if (alreadyAssigned.has(bestSoFar.id)) bestScore -= 50;
                if (alreadyAssigned.has(cur.id)) curScore -= 50;

                return curScore > bestScore ? cur : bestSoFar;
            }, available[0]);

            if (best) {
                depthChart[side][slot] = best.id;
                alreadyAssigned.add(best.id);
                available = available.filter(p => p.id !== best.id);
            }
        }
    }

    // ----------------------------------------------------
    // 3. Build AI depthOrder
    // ----------------------------------------------------
    try {
        const roster = rosterObjs;
        const starterSet = new Set();

        // Collect all starters (offense + defense)
        for (const side of ["offense", "defense"]) {
            Object.values(depthChart[side]).forEach(pid => pid && starterSet.add(pid));
        }

        // Starter list in slot order (consistent!)
        const startersList = [];
        for (const side of ["offense", "defense"]) {
            const sideChart = depthChart[side];
            for (const slot of Object.keys(sideChart)) {
                const pid = sideChart[slot];
                if (pid && !startersList.includes(pid)) startersList.push(pid);
            }
        }

        // Remaining players sorted by overall
        const benchList = roster
            .filter(p => !starterSet.has(p.id))
            .sort((a, b) => calculateOverall(b) - calculateOverall(a))
            .map(p => p.id);

        team.depthOrder = [...startersList, ...benchList];
    } catch (err) {
        console.error("Error building AI depthOrder:", err);
        team.depthOrder = team.roster ? [...team.roster] : [];
    }

}


/** Simulates an AI team's draft pick. */
function simulateAIPick(team) {
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
function addPlayerToTeam(player, team) {
    if (!player || !team || !team.roster || typeof player.id === 'undefined') {
        console.error("addPlayerToTeam: Invalid player or team object provided.");
        return false;
    }

    // --- Position-Based Number Assignment ---
    if (player.number == null) {
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
    if (!Array.isArray(team.depthOrder)) team.depthOrder = [];
    if (!team.depthOrder.includes(player.id)) team.depthOrder.push(player.id);
    return true;
}

// =============================================================
// --- SCHEDULING & BASIC WEEK SIM HELPERS ---
// =============================================================

/**
 * Generates the league schedule using a round-robin algorithm within divisions.
 */
function generateSchedule() {
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
            tackles: 0, sacks: 0, interceptions: 0, fumbles: 0, fumblesLost: 0, fumblesRecovered: 0,
            passAttempts: 0, passCompletions: 0, interceptionsThrown: 0,
            rushAttempts: 0, targets: 0, returnYards: 0, drops: 0 // <--- ADDED MISSING ONES
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
    // Defensive guards
    const roster = getRosterObjects(team);
    if (!team || !team.depthChart || !team.depthChart[side] || !roster) {
        console.error(`getPlayerBySlot: Invalid team/roster/depthChart for slot=${slot}, side=${side}`);
        return null;
    }

    usedPlayerIdsThisPlay = ensureSet(usedPlayerIdsThisPlay);

    const sideDepthChart = team.depthChart[side] || {};
    const starterId = sideDepthChart[slot];

    // 1) If a starter is explicitly assigned in depthChart, try to use them (if healthy & not used)
    if (starterId) {
        const starter = roster.find(p => p && p.id === starterId);
        if (starter && (!starter.status || starter.status.duration === 0) && !usedPlayerIdsThisPlay.has(starter.id)) {
            usedPlayerIdsThisPlay.add(starter.id);
            return starter;
        }
    }

    // 2) If no explicit starter or starter unavailable, consult team's depthOrder (if present)
    const basePosition = slot.replace(/\d/g, '');
    const depthOrder = Array.isArray(team.depthOrder) ? team.depthOrder : (team.roster || []);
    if (Array.isArray(depthOrder) && depthOrder.length > 0) {
        for (const id of depthOrder) {
            if (usedPlayerIdsThisPlay.has(id)) continue;
            const candidate = roster.find(p => p && p.id === id);
            if (!candidate) continue;
            // match position heuristics (favorite position, pos property, or estimated)
            if (candidate.favoriteOffensivePosition === basePosition || candidate.favoriteDefensivePosition === basePosition || candidate.pos === basePosition) {
                if (!candidate.status || candidate.status.duration === 0) {
                    usedPlayerIdsThisPlay.add(candidate.id);
                    return candidate;
                }
            }
        }
    }

    // 3) Fallback: original behavior — find best suitable available player from roster
    // Filter available players (healthy & not used)
    const availableSubs = roster.filter(p => p && (!p.status || p.status.duration === 0) && !usedPlayerIdsThisPlay.has(p.id));
    if (availableSubs.length > 0) {
        // Use existing suitability-based selection (calculateSlotSuitability)
        const best = availableSubs.reduce((bestSoFar, current) => {
            const bestScore = calculateSlotSuitability(bestSoFar, slot, side, team);
            const curScore = calculateSlotSuitability(current, slot, side, team);
            return curScore > bestScore ? current : bestSoFar;
        }, availableSubs[0]);
        if (best) {
            usedPlayerIdsThisPlay.add(best.id);
            return best;
        }
    }

    // 4) Final emergency fallback (previous emergency function)
    const positionOnly = basePosition;
    const emergencySub = getBestSub(team, positionOnly, usedPlayerIdsThisPlay);
    if (emergencySub) {
        usedPlayerIdsThisPlay.add(emergencySub.id);
        return emergencySub;
    }

    return null;
}


// game.js

function findEmergencyPlayer(position, team, side, usedPlayerIdsThisPlay) {
    // ---  Get roster objects ---
    const roster = getRosterObjects(team);
    if (!team || !roster || !Array.isArray(roster)) {
        // --- END FIX ---
        console.warn(`findEmergencyPlayer: Invalid team data for ${position}.`); return null;
    }

    usedPlayerIdsThisPlay = ensureSet(usedPlayerIdsThisPlay);
    // ---  Filter from our full roster object list ---
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
    'zone_short_middle': { minX: CENTER_X - 6, maxX: CENTER_X + 6, minY: 4, maxY: 10 },

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

    // ---  Red Zone Compression Logic ---

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
    // ---  END  LOGIC ---

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

    // ---  Red Zone Compression Logic ---

    // 1. Calculate the zone's "ideal" absolute Y boundaries
    const idealMinY_abs = lineOfScrimmage + (zone.minY || 0);
    const idealMaxY_abs = lineOfScrimmage + (zone.maxY || 20);

    // 2. Clamp the boundaries to the field of play
    const finalMaxY_abs = Math.min(idealMaxY_abs, BACK_WALL_Y);
    const finalMinY_abs = Math.min(idealMinY_abs, finalMaxY_abs - 1.0);

    // 3. Check if player's absolute Y is within the *actual* (clamped) zone
    const withinY = playerState.y >= finalMinY_abs && playerState.y <= finalMaxY_abs;
    // ---  END  LOGIC ---

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
function setupInitialPlayerStates(playState, offense, defense, play, assignments, ballOnYardLine, defensivePlayKey, ballHash = 'M', offensivePlayKey = '') {
    playState.activePlayers = []; // Reset active players for the new play
    const usedPlayerIds_O = new Set(); // Track used offense players for this play
    const usedPlayerIds_D = new Set(); // Track used defense players for this play
    const isPlayAction = offensivePlayKey.includes('PA_');

    // Get the selected defensive play call and its assignments
    const defPlay = defensivePlaybook[defensivePlayKey] || defensivePlaybook['Cover_2_Zone_3-1-3'];
    const defAssignments = defPlay.assignments || {};

    // 💡 TRACKING: Store defensive call for runtime logic (coverage type, blitz identification, etc.)
    playState.defensiveCall = {
        key: defensivePlayKey,
        name: defPlay.name || 'Cover 2 Zone (3-1-3)',
        concept: defPlay.concept || 'Zone',  // 'Man' or 'Zone'
        isCover1: defensivePlayKey.includes('Cover_1'),
        isCover2: defensivePlayKey.includes('Cover_2'),
        isCover3: defensivePlayKey.includes('Cover_3'),
        isCover4: defensivePlayKey.includes('Cover_4'),
        hasBlitz: defPlay.blitz === true,
        assignments: defAssignments
    };

    // Set the line of scrimmage (adding 10 for the endzone offset)
    playState.lineOfScrimmage = ballOnYardLine + 10;
    let ballX = CENTER_X;
    if (ballHash === 'L') ballX = HASH_LEFT_X;
    else if (ballHash === 'R') ballX = HASH_RIGHT_X;

    // --- STEP 1: Calculate initial OFFENSIVE positions FIRST ---
    const offenseFormationData = offenseFormations[offense.formations.offense];
    const initialOffenseStates = [];

    if (offenseFormationData?.slots && offenseFormationData?.coordinates) {
        offenseFormationData.slots.forEach(slot => {
            const relCoords = offenseFormationData.coordinates[slot] || [0, 0];
            let startX = ballX + relCoords[0];
            let startY = playState.lineOfScrimmage + relCoords[1];
            startX = Math.max(0.5, Math.min(FIELD_WIDTH - 0.5, startX));
            startY = Math.max(10.5, Math.min(FIELD_LENGTH - 10.5, startY));
            initialOffenseStates.push({ slot, x: startX, y: startY });
        });
    } else {
        console.error(`setupInitialPlayerStates: Invalid offense formation data for ${offense.name}`);
    }

    // --- Helper function to set up players for one side ---
    const setupSide = (team, side, formationData, isOffense, initialOffenseStates) => {
        if (!team || !team.roster || !formationData || !formationData.slots || !formationData.coordinates) {
            console.error(`setupInitialPlayerStates: Invalid data for ${side} team ${team?.name}`);
            return;
        }
        const usedSet = isOffense ? usedPlayerIds_O : usedPlayerIds_D;

        // Priority Sorting: QB/OL first
        const sortedSlots = [...formationData.slots].sort((a, b) => {
            if (a.startsWith('QB')) return -1;
            if (b.startsWith('QB')) return 1;
            if (a.startsWith('C') || a.startsWith('OL')) return -1;
            if (b.startsWith('C') || b.startsWith('OL')) return 1;
            return 0;
        });

        const coveredManTargets = new Set();
        if (!isOffense) {
            Object.values(defAssignments).forEach(assign => {
                if (assign && assign.startsWith('man_cover_')) {
                    coveredManTargets.add(assign.replace('man_cover_', ''));
                }
            });
        }

        // Loop through sorted slots
        sortedSlots.forEach(slot => {
            let action = 'idle';
            let assignment = defAssignments[slot] || 'def_read';
            let targetX = 0;
            let targetY = 0;
            let routePath = null;
            let assignedPlayerId = null;

            // QB specific variables
            let readProgression = [];
            let currentReadTargetSlot = null;
            let ticksOnCurrentRead = 0;

            // --- A. Find Player and Initial Position ---
            const player = getPlayerBySlot(team, side, slot, usedSet) || findEmergencyPlayer(slot.replace(/\d/g, ''), team, side, usedSet)?.player;

            if (!player || !player.attributes) {
                if (slot.startsWith('QB')) {
                    console.error(`CRITICAL: Could not find QB for ${team.name}. Roster might be empty.`);
                }
                return;
            }

            const relCoords = formationData.coordinates[slot] || [0, 0];
            targetX = ballX + relCoords[0];
            targetY = playState.lineOfScrimmage + relCoords[1];

            let startX = targetX;
            let startY = targetY;

            // --- B. Determine Alignment and Action ---
            if (isOffense) {
                assignment = assignments?.[slot];
                if (assignment) {
                    if (assignment.toLowerCase() === 'punt') {
                        action = 'punt_kick';
                        targetY = startY - 2;
                    }
                    else if (assignment.toLowerCase().includes('pass_block')) { action = 'pass_block'; targetY = startY - 0.5; }
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
                    if (isPlayAction && assignment === 'pass_block') {
                        action = 'run_block';
                    } else {
                        action = assignment;
                    }
                    targetY = startY + (action === 'pass_block' ? -0.5 : 0.5);
                } else if (slot.startsWith('QB')) {
                    // 💡 FIX: Check for Punt Type explicitly
                    if (play.type === 'punt') {
                        assignment = 'punt';
                        action = 'punt_kick';
                        // Set him deep for the punt
                        targetY = startY - 5;
                        // Ensure he is looking at the snap
                        targetX = startX;
                    }
                    // Standard QB Logic
                    else {
                        assignment = 'qb_setup';
                        action = assignment;
                        if (play.type === 'pass') {
                            targetY = startY - 2;
                            const rawReads = play.readProgression || [];
                            readProgression = rawReads.length > 0 ? [...rawReads] : ['WR1', 'WR2', 'RB1', 'WR3'];
                            currentReadTargetSlot = readProgression[0];
                        }
                    }
                }
                else {
                    if (play.type === 'run') {
                        assignment = 'run_block';
                        action = 'run_block';
                        targetY = startY + 0.5;
                    } else {
                        assignment = 'idle';
                        action = 'idle';
                    }
                }

            } else { // Defense
                assignment = defAssignments[slot];

                // 💡 CRITICAL FIX: Validate man_cover assignments exist in formation
                if (assignment && assignment.startsWith('man_cover_')) {
                    const targetName = assignment.replace('man_cover_', '');
                    // Check if this receiver actually exists in the offense formation
                    const receiverExists = initialOffenseStates.some(o => o.slot === targetName);
                    if (!receiverExists) {
                        // Receiver doesn't exist in this formation - find next available target
                        const availableThreats = ['WR1', 'WR2', 'WR3', 'RB1', 'RB2'].filter(t =>
                            initialOffenseStates.some(o => o.slot === t) && !coveredManTargets.has(t)
                        );
                        if (availableThreats.length > 0) {
                            assignment = `man_cover_${availableThreats[0]}`;
                        } else {
                            assignment = 'zone_hook_curl_middle';
                        }
                    }
                    coveredManTargets.add(assignment.replace('man_cover_', ''));
                }

                // 💡 NEW: Persist the intended target player ID for man_cover assignments early,
                // before position setup, so it's always available even if assignment changes.
                if (assignment && assignment.startsWith('man_cover_')) {
                    const targetSlot = assignment.replace('man_cover_', '');
                    const targetPlayer = initialOffenseStates.find(o => o.slot === targetSlot);
                    if (targetPlayer) {
                        assignedPlayerId = targetPlayer.id;
                    } else {
                        // No player in that slot — will be handled by position setup fallback
                        assignedPlayerId = null;
                    }
                }

                if (!assignment) {
                    if (slot.startsWith('DL')) {
                        assignment = 'run_gap_A';
                    }
                    else if (slot.startsWith('DB')) {
                        const availableThreats = ['WR1', 'WR2', 'WR3', 'RB1', 'RB2'].filter(t =>
                            initialOffenseStates.some(o => o.slot === t) && !coveredManTargets.has(t)
                        );
                        const bestTarget = availableThreats[0];
                        if (bestTarget) {
                            assignment = `man_cover_${bestTarget}`;
                            coveredManTargets.add(bestTarget);
                        } else {
                            assignment = 'zone_deep_middle';
                        }
                    }
                    else if (slot.startsWith('LB')) {
                        const lbThreats = ['RB1', 'WR3', 'RB2'].filter(t =>
                            initialOffenseStates.some(o => o.slot === t) && !coveredManTargets.has(t)
                        );
                        const lbTarget = lbThreats[0];
                        if (lbTarget) {
                            assignment = `man_cover_${lbTarget}`;
                            coveredManTargets.add(lbTarget);
                        } else {
                            assignment = 'spy_QB';
                        }
                    }
                    else {
                        assignment = 'def_read';
                    }
                }

                action = assignment;

                if (assignment.toLowerCase() === 'punt_return') {
                    action = 'punt_return';
                    targetY = startY;
                    targetX = startX;
                }

                //startY = Math.min(playState.lineOfScrimmage + 0.1, startY);
                //targetY = Math.min(playState.lineOfScrimmage + 0.1, targetY);

                // 1. Man Coverage
                if (assignment.startsWith('man_cover_')) {
                    const targetSlot = assignment.split('man_cover_')[1];

                    // 💡💡💡 FIX: Use initialOffenseStates, NOT offenseStates 💡💡💡
                    const targetOffPlayer = initialOffenseStates.find(o => o.slot === targetSlot);

                    if (targetOffPlayer) {
                        // 💡💡 ENHANCED Priority 3.3: Vary pre-snap positioning by receiver slot type
                        // Different receiver types need different defensive positioning approaches
                        // Slot receivers move in traffic - need tighter coverage
                        // WRs on the perimeter - normal cushion
                        // TEs - need more space due to size and route diversity

                        let xOffset, yOffset;

                        if (targetSlot.includes('SLOT') || targetSlot === 'RB') {
                            // Slot receivers and RBs in passing routes - very tight pre-snap
                            // These players work in congested areas, need to stay close
                            xOffset = targetOffPlayer.x < CENTER_X ? 0.3 : -0.3;
                            yOffset = 0.2;
                        } else if (targetSlot.includes('WR') || targetSlot === 'WR1' || targetSlot === 'WR2' || targetSlot === 'WR3') {
                            // Outside WRs - standard distance (tighter than pre-enhancement)
                            xOffset = targetOffPlayer.x < CENTER_X ? 0.8 : -0.8;
                            yOffset = 0.5;
                        } else if (targetSlot.includes('TE') || targetSlot === 'TE') {
                            // Tight ends - slightly looser due to size and unpredictable routes
                            xOffset = targetOffPlayer.x < CENTER_X ? 1.0 : -1.0;
                            yOffset = 0.7;
                        } else {
                            // Default positioning for unknown slots
                            xOffset = targetOffPlayer.x < CENTER_X ? 0.8 : -0.8;
                            yOffset = 0.5;
                        }

                        startX = targetOffPlayer.x + xOffset;
                        startY = targetOffPlayer.y + yOffset;
                        targetX = startX; targetY = startY;
                        // Persist the assigned receiver's id on the defender so
                        // later decision logic can reliably determine whether
                        // the pass is targeted at "my man" regardless of route movement.
                        assignedPlayerId = targetOffPlayer.id;
                    } else {
                        // Fallback logic for man coverage target not found
                        const zoneCenter = getZoneCenter('zone_hook_curl_middle', playState.lineOfScrimmage);
                        targetX = zoneCenter.x; targetY = zoneCenter.y;
                    }
                }
                // 2. Zone Coverage
                else if (assignment.startsWith('zone_')) {
                    const zoneTarget = getZoneCenter(assignment, playState.lineOfScrimmage);
                    targetX = zoneTarget.x;
                    targetY = zoneTarget.y;
                    if (assignment.includes('deep') && startY < zoneTarget.y - 5) {
                        startY = zoneTarget.y;
                        startX = zoneTarget.x;
                    } else {
                        if (slot.startsWith('DB')) {
                            const wideOffset = startX < CENTER_X ? -2 : 2;
                            startX += wideOffset;
                            startY = Math.min(playState.lineOfScrimmage + 1.0, startY);
                        }
                    }
                }
                // 3. Run/Blitz
                else if (assignment.includes('run_gap_') || assignment.includes('blitz_gap') || assignment.includes('blitz_edge')) {
                    const gapTarget = zoneBoundaries[assignment];
                    if (gapTarget) {
                        targetX = ballX + (gapTarget.xOffset || 0);
                        targetY = playState.lineOfScrimmage + (gapTarget.yOffset || 1.0);
                    } else {
                        targetX = ballX;
                        targetY = playState.lineOfScrimmage + 1.0;
                    }
                    if (slot.startsWith('DL')) {
                        startY = Math.min(startY, playState.lineOfScrimmage + 2.5);
                    }
                }
            }

            // --- Clamp final starting position ---
            startX = Math.max(0.5, Math.min(FIELD_WIDTH - 0.5, startX));
            startY = Math.max(10.5, Math.min(FIELD_LENGTH - 10.5, startY));

            // --- NEUTRAL ZONE CLAMP ---
            const LOS = playState.lineOfScrimmage;
            const NEUTRAL_ZONE_WIDTH = 1.0;

            if (!isOffense) {
                let attempts = 0;
                let isStacked = playState.activePlayers.some(p => !p.isOffense && p.x === startX && p.y === startY);

                while (isStacked && attempts < 10) {
                    startX += (Math.random() < 0.5 ? -0.5 : 0.5);
                    isStacked = playState.activePlayers.some(p => !p.isOffense && p.x === startX && p.y === startY);
                    attempts++;
                }
                if (slot.startsWith('DL')) {
                    startY = LOS + NEUTRAL_ZONE_WIDTH;
                } else {
                    startY = Math.max(LOS + NEUTRAL_ZONE_WIDTH, startY);
                }
            } else {
                if (slot.startsWith('OL')) {
                    startY = LOS;
                } else {
                    startY = Math.min(LOS, startY);
                }
            }

            const fatigueRatio = player ? (player.fatigue / (player.attributes?.physical?.stamina || 50)) : 0;
            const fatigueModifier = Math.max(0.3, 1.0 - fatigueRatio);

            let zoneCenter = null;
            if (!isOffense && assignment && assignment.startsWith('zone_')) {
                zoneCenter = getZoneCenter(assignment, playState.lineOfScrimmage);
            }

            const pState = {
                id: player.id, name: player.name, number: player.number,
                teamId: team.id, primaryColor: team.primaryColor, secondaryColor: team.secondaryColor,
                isOffense: isOffense, slot: slot,
                x: startX, y: startY, initialX: startX, initialY: startY,
                targetX: targetX, targetY: targetY,
                speed: player.attributes.physical?.speed || 50,
                strength: player.attributes.physical?.strength || 50,
                agility: player.attributes.physical?.agility || 50,
                weight: player.attributes.physical?.weight || 200,
                height: player.attributes.physical?.height || 70,
                clutch: player.attributes.mental?.clutch || 50,
                blocking: player.attributes.technical?.blocking || 50,
                blockShedding: player.attributes.technical?.blockShedding || 50,
                tackling: player.attributes.technical?.tackling || 50,
                catchingHands: player.attributes.technical?.catchingHands || 50,
                throwingAccuracy: player.attributes.technical?.throwingAccuracy || 50,
                playbookIQ: player.attributes.mental?.playbookIQ || 50,
                toughness: player.attributes.mental?.toughness || 50,
                consistency: player.attributes.mental?.consistency || 50,
                fatigueModifier: fatigueModifier,
                action: action,
                assignment: assignment,
                cachedZoneCenter: zoneCenter,
                routePath: routePath,
                currentPathIndex: 0,
                readProgression: readProgression,
                currentReadTargetSlot: currentReadTargetSlot,
                ticksOnCurrentRead: ticksOnCurrentRead,
                engagedWith: null,
                isBlocked: false,
                blockedBy: null,
                isEngaged: false,
                isBallCarrier: false,
                hasBall: false,
                stunnedTicks: 0,
                assignedPlayerId: assignedPlayerId
            };

            playState.activePlayers.push(pState);
        });
    };

    // --- Execute Setup ---
    const defenseFormationData = defenseFormations[defense.formations.defense];
    setupSide(offense, 'offense', offenseFormationData, true, initialOffenseStates); // OFFENSE FIRST
    setupSide(defense, 'defense', defenseFormationData, false, initialOffenseStates); // then DEFENSE

    // --- Set Initial Ball Position & Carrier ---
    const qbState = playState.activePlayers.find(p => p.slot === 'QB1' && p.isOffense);
    const rbState = playState.activePlayers.find(p => p.slot === 'RB1' && p.isOffense);

    const isQBRun = qbState && assignments[qbState.slot]?.includes('run_');
    const isRBRun = rbState && assignments[rbState.slot]?.includes('run_');

    if (play.type === 'run' && isRBRun && !isQBRun) {
        if (rbState) {
            rbState.hasBall = true;
            rbState.isBallCarrier = true;
            playState.ballState.x = rbState.x;
            playState.ballState.y = rbState.y;
            playState.ballState.z = 1.0;
        }
        if (qbState) { qbState.action = 'run_fake'; }
    } else if (qbState) {
        qbState.hasBall = true;
        playState.ballState.x = qbState.x;
        playState.ballState.y = qbState.y;
        playState.ballState.z = 1.0;

        // 💡 MAKE SURE THIS IS HERE:
        // Only mark as a "runner" if it is explicitly a run play (e.g. QB Sneak)
        qbState.isBallCarrier = !!isQBRun;

        if (play.type === 'punt') {
            qbState.isBallCarrier = false;
            const playReads = play.readProgression || [];
            let finalProgression = playReads.length > 0 ? [...playReads] : ['WR1', 'WR2', 'RB1'];
            qbState.readProgression = finalProgression;
            qbState.currentReadTargetSlot = finalProgression[0];
            qbState.ticksOnCurrentRead = 0;
        }
    } else {
        console.error("CRITICAL: QB not found during setup! Ending play.");
        playState.playIsLive = false;
        playState.turnover = true;
    }
}
/**
 * Detect gaps and provide intelligent gap assignment recommendations for defense
 * 💡 ENHANCED: Sophisticated gap read logic for realistic run defense
 */
function getGapAssignmentForDefender(defenderSlot, defenderInitialX, runnerX, isBoxDefender) {
    const CENTER_X = FIELD_WIDTH / 2;

    // A-gap = between center and guards (±4 yards from center)
    // B-gap = between guard and tackle (±8 yards from center) 
    // C-gap = edge assignments (±12+ yards from center)

    const distFromCenter = Math.abs(defenderInitialX - CENTER_X);

    if (distFromCenter < 4) return 'A'; // Inside gaps
    if (distFromCenter < 8) return 'B'; // Shoulder gaps
    return 'C'; // Edge
}

/**
 * Calculate run play direction tendency based on offensive formation
 */
function detectRunDirection(offensiveAssignments, offenseStates) {
    // Count pulling linemen and formation bias
    const rbAssignment = offensiveAssignments['RB1'] || '';

    // Simple heuristic: assignment keywords indicate direction
    if (rbAssignment.includes('toss_right') || rbAssignment.includes('sweep_right')) return 'right';
    if (rbAssignment.includes('toss_left') || rbAssignment.includes('sweep_left')) return 'left';
    if (rbAssignment.includes('dive')) return 'center';

    // Default based on run play type
    return null;
}

/**
 * Calculate defender pursuit angle efficiency
 * Returns 0.0-1.0 (1.0 = perfect pursuit angle, 0.0 = terrible angle)
 */
function calculatePursuitEfficiency(defenderPos, ballCarrierPos, ballCarrierVelocity) {
    const dist = getDistance(defenderPos, ballCarrierPos);
    if (dist < 0.5) return 1.0; // Already on ball carrier

    // Calculate if defender is moving to intercept or chase from behind
    const toBallCarrier = {
        x: ballCarrierPos.x - defenderPos.x,
        y: ballCarrierPos.y - defenderPos.y
    };

    // Good angle = closing head-on or from side; Bad angle = behind ball carrier
    if (ballCarrierVelocity.y > 0) {
        // Ball carrier moving forward
        if (toBallCarrier.y <= 0) return 0.3; // Defender is behind (bad pursuit)
        if (Math.abs(toBallCarrier.x) < toBallCarrier.y) return 0.9; // Head-on (great)
        return 0.6; // Angled pursuit (okay)
    }

    return 0.5; // Neutral if ball carrier velocity unclear
}



/**
 * Calculate intelligent safety help coordination
 * 💡 ENHANCED: Safety assistance logic for pass coverage
 * Returns positioning guidance for coverage coordination
 */
function calculateSafetyHelp(safetyState, defenseStates, offenseStates, ballCarrierState, playState, isBallInAir) {
    if (!safetyState || !safetyState.slot.startsWith('S')) return null;

    const LOS = playState.lineOfScrimmage;
    const defensiveCall = playState.defensiveCall || {};

    // 💡 ENHANCED: Coverage-type aware safety rotation
    // In Cover 2: Safeties split halves - limited help
    // In Cover 3: Middle safety can help weak side
    // In Cover 1: Free safety roams and helps everywhere

    const isCover2 = defensiveCall.isCover2 || false;
    const isCover3 = defensiveCall.isCover3 || false;
    const isCover1 = defensiveCall.isCover1 || false;

    // Find cornersbacks and man coverage players this safety should help
    const corners = defenseStates.filter(d => d.slot.startsWith('DB') && !d.slot.startsWith('S'));
    const inManCoverage = corners.filter(d => d.assignment && d.assignment.startsWith('man_cover_'));

    // Decision 1: Identify high-pressure corners (being beaten badly)
    let helpTarget = null;
    let maxPressure = 0;

    inManCoverage.forEach(corner => {
        const targetSlot = corner.assignment.replace('man_cover_', '');
        const receiver = offenseStates.find(r => r.slot === targetSlot);

        if (receiver) {
            const separationDist = getDistance(corner, receiver);
            const isBallTargeted = isBallInAir && playState.ballState.targetPlayerId === receiver.id;

            // Calculate pressure score: closer receiver + ball in air = higher priority
            let pressureScore = 10 - separationDist; // Closer = worse
            if (isBallTargeted) pressureScore += 5; // Ball coming = high priority

            if (pressureScore > maxPressure) {
                maxPressure = pressureScore;
                helpTarget = { corner, receiver };
            }
        }
    });

    // Decision 2: Coverage-type determines help eligibility
    let shouldHelp = maxPressure > 4.0; // Base pressure threshold

    // Adjust help eligibility based on coverage type
    if (isCover2) {
        // In Cover 2, safeties split halves - minimal help
        // Only help if corner is on their half and pressure is extreme
        const helperHalf = safetyState.x < CENTER_X ? 'left' : 'right';
        const cornerHalf = helpTarget?.corner.x < CENTER_X ? 'left' : 'right';
        shouldHelp = shouldHelp && (helperHalf === cornerHalf) && (maxPressure > 6.0); // Higher threshold
    } else if (isCover3) {
        // In Cover 3, middle safety can help, outside corner depends on receiver
        if (safetyState.x < CENTER_X || safetyState.x > FIELD_WIDTH - CENTER_X) {
            // Outside safety - only help own half
            shouldHelp = maxPressure > 5.0;
        } else {
            // Middle safety - can rotate
            shouldHelp = maxPressure > 4.0;
        }
    } else if (isCover1) {
        // In Cover 1, free safety roams and helps everywhere
        shouldHelp = maxPressure > 3.0; // Aggressive, lower threshold
    }

    if (!shouldHelp) {
        // No help needed - return null to use regular assignment
        return null;
    }

    // 💡 NEW: Safety help timing delay - don't help immediately
    // Only provide help if ball is in air AND has been for enough ticks
    // This prevents early commitment and allows coverage to work itself out
    const ballFlightTime = isBallInAir ? playState.tick - playState.ballState.releaseeTick : 0;
    const MIN_FLIGHT_TICKS = 5; // ~150ms delay before help is provided

    if (isBallInAir && ballFlightTime < MIN_FLIGHT_TICKS) {
        // Ball in air but not long enough yet - let man coverage work
        return null;
    }

    // Additional timing check: if pressure is marginal, delay help even longer
    if (isBallInAir && maxPressure < 6.0 && ballFlightTime < MIN_FLIGHT_TICKS + 3) {
        // For borderline pressure situations, require longer flight time before helping
        return null;
    }

    // Decision 3: Calculate help position (top-down safety support)
    if (helpTarget && helpTarget.receiver) {
        // Position between corner and receiver, higher than receiver
        const helpX = (helpTarget.corner.x * 0.3) + (helpTarget.receiver.x * 0.7); // Closer to receiver
        const helpY = Math.max(helpTarget.receiver.y + 1.5, LOS + 10); // Stay on top

        return {
            type: 'help',
            helpX: helpX,
            helpY: helpY,
            targetReceiver: helpTarget.receiver,
            targetCorner: helpTarget.corner,
            pressureScore: maxPressure,
            delayedHelp: true // Flag indicating this help was delayed
        };
    }

    return null;
}

/**
 * Evaluate defensive alignment for zone coverage placement
 * Returns insight into coverage scheme depth and width
 */
function evaluateCoverageAlignment(defenseStates, playState) {
    const LOS = playState.lineOfScrimmage;

    // Categorize defense by zone depth
    const shallow = defenseStates.filter(d => d.y < LOS + 8); // Underneath
    const intermediate = defenseStates.filter(d => d.y >= LOS + 8 && d.y < LOS + 16); // Intermediate
    const deep = defenseStates.filter(d => d.y >= LOS + 16); // Deep

    // Single vs. two-high safety look
    const safeties = defenseStates.filter(d => d.slot.startsWith('S'));
    const safetyDepths = safeties.map(s => s.y - LOS);
    const avgSafetyDepth = safetyDepths.length > 0 ?
        safetyDepths.reduce((a, b) => a + b) / safetyDepths.length : 15;

    const isTwoHigh = safeties.length >= 2 && Math.max(...safetyDepths) - Math.min(...safetyDepths) < 5;
    const isSingleHigh = safeties.length === 1 || (safeties.length >= 2 && avgSafetyDepth > 12);

    return {
        shallowCount: shallow.length,
        intermediateCount: intermediate.length,
        deepCount: deep.length,
        safetyCount: safeties.length,
        avgSafetyDepth: avgSafetyDepth,
        isTwoHigh: isTwoHigh,
        isSingleHigh: isSingleHigh,
        defenseCoverage: isTwoHigh ? 'TWO_HIGH' : 'SINGLE_HIGH'
    };
}

/**
 * 💡 ADAPTIVE: Track offensive play success against defensive matchups
 * Returns matchup performance data for play selection bias
 */
function analyzePlaySuccess(lastPlayState, offensiveTeam, defensiveTeam) {
    if (!lastPlayState || !lastPlayState.result) {
        return null;
    }

    const result = lastPlayState.result;

    // Calculate success metrics
    const gainedYards = result.yardsGained || 0;
    const completionStatus = result.passComplete ? 1 : 0; // 0-1 scale
    const wasTouchdown = result.isTouchdown ? 1 : 0;
    const wasIntercepted = result.interception ? 1 : 0;
    const wasFumbled = result.fumble ? 1 : 0;

    // Composite success score (0-100)
    let successScore = 50; // Neutral baseline

    if (result.playType === 'pass') {
        // Pass success: completion + yardage + no turnover
        successScore = completionStatus * 60;
        successScore += Math.min(20, gainedYards / 2); // Up to 20 points for yardage
        successScore -= wasIntercepted * 25; // -25 for INT
    } else if (result.playType === 'run') {
        // Run success: positive yardage + no turnover
        successScore = Math.min(40, gainedYards / 1.5); // 0-40 for yardage
        successScore += 20 + (gainedYards > 4 ? 20 : 10); // Base + bonus
        successScore -= wasFumbled * 20; // -20 for fumble
    }

    // Bonus for touchdowns
    successScore += wasTouchdown * 30;

    // Clamp to 0-100
    successScore = Math.max(0, Math.min(100, successScore));

    return {
        playKey: result.playKey || 'unknown',
        playerSlot: result.ballCarrierSlot || 'unknown',
        defenseMatchupKey: result.defenseCall || 'unknown',
        successScore: successScore,
        yardsGained: gainedYards,
        playType: result.playType,
        isSuccess: successScore > 50,
        wasTouchdown: wasTouchdown,
        turnover: wasIntercepted || wasFumbled
    };
}

/**
 * Updates player targets based on their current action, assignment, and game state. (Improved AI)
 * Modifies playerState objects within playState.activePlayers directly.
 */
function updatePlayerTargets(playState, offenseStates, defenseStates, ballCarrierState, playType, offensivePlayKey, offensiveAssignments, defensivePlayKey, gameLog) {
    const qbState = offenseStates.find(p => p.slot?.startsWith('QB'));
    const isBallInAir = playState.ballState.inAir;
    const ballPos = playState.ballState;

    const LOS = playState.lineOfScrimmage;
    const POCKET_DEPTH_PASS = -1.5; // 1.5 yards *behind* the LoS
    const POCKET_DEPTH_RUN = 0.5;   // 0.5 yards *in front* of the LoS

    const isPlayerState = (t) => t && t.speed !== undefined;
    const olAssignedDefenders = new Set();

    // 1. Loose Ball Logic (Everyone attacks the ball)
    if (playState.ballState.isLoose) {
        playState.activePlayers.forEach(pState => {
            if (pState.stunnedTicks === 0 && !pState.isEngaged) {
                pState.targetX = playState.ballState.x;
                pState.targetY = playState.ballState.y;
            }
        });
        return;
    }

    // 2. Identify Threats & Blockers
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

    // 3. Define Blocking AI Helper
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
                } else {
                    blocker.dynamicTargetId = null;
                }
            } else {
                blocker.dynamicTargetId = null;
                blocker.targetX = blocker.initialX;
                blocker.targetY = LOS + POCKET_DEPTH_PASS;
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
            const ENGAGE_DISTANCE = BLOCK_ENGAGE_RANGE; // Ensure this constant is imported/available

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
                    blockerId: blocker.id,
                    defenderId: targetDefender.id,
                    status: 'ongoing',
                    battleScore: 0,
                    startTick: playState.tick
                });
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
        }
    };

    // 4. Process Blockers
    if (linemen.length > 0) {
        linemen.sort((a, b) => {
            if (a.slot === 'OL2') return -1;
            if (b.slot === 'OL2') return 1;
            return a.initialX - b.initialX;
        });

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

    // 5. Main Player Loop (Offense Movement & Defense AI)
    playState.activePlayers.forEach(pState => {
        let target = null;

        // --- 💡 FIX 1: TURNOVER / INT PURSUIT OVERRIDE ---
        // If there is a turnover (INT or Fumble Recovery by defense), 
        // AND this player is on the original Offense, they must switch to tackling.
        if (playState.turnover && pState.isOffense) {
            pState.action = 'pursuit';

            // Find the new ball carrier (the defender who stole it)
            const interceptor = playState.activePlayers.find(p => p.isBallCarrier);

            if (interceptor) {
                // Simple pursuit logic
                pState.targetX = interceptor.x;
                pState.targetY = interceptor.y;
            } else {
                // Ball is loose or in transition, run to ball
                pState.targetX = playState.ballState.x;
                pState.targetY = playState.ballState.y;
            }
            return; // Stop processing routes/blocks
        }

        // -- Common Status Checks --
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
            pState.targetX = pState.x;
            pState.targetY = pState.y;
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

        // -- Offensive Logic Updates --

        const isQuarterbackInPocket = ballCarrierState &&
            ballCarrierState.slot.startsWith('QB') &&
            ballCarrierState.action === 'qb_setup';
        if (pState.isOffense &&
            pState.id !== ballCarrierState?.id &&
            (pState.action === 'pass_block' || pState.action === 'run_route' || pState.action === 'route_complete') &&
            ballCarrierState &&
            ballCarrierState.isOffense &&
            !playState.ballState.inAir &&
            !isQuarterbackInPocket) { // <--- 💡 THIS LINE PREVENTS THE BUG

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

        // ===========================================================
        // OFFENSIVE PLAYERS (Movement Logic)
        // ===========================================================
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

                case 'run_route':
                    {
                        // 1. Fallback: If no route exists, create a default "Go" route logic
                        // This prevents them from stopping if the playbook is missing data
                        if (!pState.routePath || pState.routePath.length === 0) {
                            // Default behavior: Run straight downfield
                            pState.targetX = pState.initialX;
                            pState.targetY = Math.min(FIELD_LENGTH - 10, pState.y + 10);

                            // Check arrival at "end of field"
                            if (pState.y > FIELD_LENGTH - 15) {
                                pState.action = 'route_complete';
                            }
                            break;
                        }

                        const currentTargetPoint = pState.routePath[pState.currentPathIndex];
                        const ARRIVAL_RADIUS = 0.5;

                        // 2. Base Target
                        let targetX = currentTargetPoint.x;
                        let targetY = currentTargetPoint.y;

                        // 3. 🧠 SMART COVERAGE ADJUSTMENT
                        // If defender is pressing (within 2 yards), adjust route slightly
                        const nearbyDefender = defenseStates.find(d =>
                            !d.isBlocked && !d.isEngaged && getDistance(pState, d) < 2.0
                        );

                        if (nearbyDefender) {
                            // Stable Avoidance: Use INITIAL lineup position to decide direction
                            // If I lined up outside the defender, stay outside.
                            const leverageX = (pState.initialX > nearbyDefender.initialX) ? 0.5 : -0.5;
                            targetX += leverageX;
                        }

                        // 4. 🚧 STABLE OBSTACLE AVOIDANCE
                        // Only avoid defenders who are physically blocking the path forward
                        const obstacle = defenseStates.find(d =>
                            !d.isBlocked && !d.isEngaged &&
                            d.y >= pState.y - 0.5 &&
                            d.y <= pState.y + 3.0 &&       // Immediate threat only
                            d.y < targetY &&
                            Math.abs(d.x - pState.x) < 0.8 // Strictly in lane
                        );

                        if (obstacle) {
                            // 💡 STABILITY FIX: Determine avoidance side based on INITIAL position
                            // This prevents the "vibration" where they flip left/right every frame.
                            // If I started to the right of this guy, I go right. Always.
                            const avoidanceDir = (pState.initialX >= obstacle.initialX) ? 1.0 : -1.0;

                            // Side step
                            targetX = obstacle.x + (avoidanceDir * 1.2);

                            // 💡 MOMENTUM FIX: Ensure we aim PAST the defender
                            // Never aim directly at them. Aim at least 2 yards deeper.
                            targetY = Math.max(pState.y + 2.0, obstacle.y + 2.0);
                        }

                        // 5. Apply & Clamp
                        pState.targetX = targetX;
                        pState.targetY = targetY;

                        // 6. Arrival Check
                        const distToTarget = getDistance(pState, { x: targetX, y: targetY });

                        if (distToTarget < ARRIVAL_RADIUS) {
                            pState.currentPathIndex++;
                            // Immediate update for next point
                            if (pState.currentPathIndex < pState.routePath.length) {
                                const next = pState.routePath[pState.currentPathIndex];
                                pState.targetX = next.x;
                                pState.targetY = next.y;
                            } else {
                                pState.action = 'route_complete';
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
                        // 💡 ENHANCED 1.4: OL adjusts to visible blitz assignments
                        // Check if any nearby defender has blitz/rush assignment and adjust target
                        const nearbyBlitzers = defenseStates.filter(d =>
                            (d.assignment?.includes('blitz') || d.assignment?.includes('rush')) &&
                            getDistance(pState, d) < 6.0
                        ).sort((a, b) => getDistance(pState, a) - getDistance(pState, b));

                        if (nearbyBlitzers.length > 0) {
                            // Assign to nearest blitzer
                            pState.dynamicTargetId = nearbyBlitzers[0].id;
                            pState.targetX = nearbyBlitzers[0].x;
                            pState.targetY = nearbyBlitzers[0].y;
                        } else {
                            pState.targetX = pState.initialX;
                            pState.targetY = LOS + POCKET_DEPTH_PASS;
                        }
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

                case 'run_path':
                    {
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

                        // Sideline Awareness
                        const distToLeftLine = pState.x;
                        const distToRightLine = FIELD_WIDTH - pState.x;
                        const DANGER_ZONE = 4.0;

                        if (distToLeftLine < DANGER_ZONE) {
                            targetXOffset = Math.max(2.0, targetXOffset + 2.0);
                        } else if (distToRightLine < DANGER_ZONE) {
                            targetXOffset = Math.min(-2.0, targetXOffset - 2.0);
                        }

                        pState.targetY = Math.min(FIELD_LENGTH - 1.0, pState.y + visionDistance);
                        pState.targetX = pState.x + targetXOffset;
                        break;
                    }

                case 'qb_scramble':
                    {
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

                case 'qb_setup':
                    // 💡 ENHANCED: Realistic QB pocket management with pressure awareness
                    const POCKET_RADIUS = 6.0;
                    const STEP_DISTANCE = 0.75;

                    // 💡 NEW: Count unblocked rushers (defenders closing on QB)
                    const rushersClosing = defenseStates.filter(d =>
                        !d.isBlocked && !d.isEngaged && d.stunnedTicks === 0 &&
                        getDistance(pState, d) < POCKET_RADIUS && d.y < pState.y + 3.0
                    );

                    // 💡 NEW: QB decision-making based on pressure and experience
                    const qbExperience = pState.playbookIQ || 50;
                    const qbComposure = pState.attributes?.mental?.composure || 50;
                    const pocketCollapsing = rushersClosing.length >= 2;

                    // Find closest threat
                    const closestThreat = rushersClosing.length > 0
                        ? rushersClosing.sort((a, b) => getDistance(pState, a) - getDistance(pState, b))[0]
                        : null;

                    if (closestThreat) {
                        const dxThreat = closestThreat.x - pState.x;
                        const dyThreat = closestThreat.y - pState.y;
                        const distThreat = getDistance(pState, closestThreat);

                        // 💡 IMPROVED: QB movement based on threat direction and experience
                        let escapeX = pState.x - (dxThreat / distThreat) * STEP_DISTANCE;
                        let escapeY = pState.y - (dyThreat / distThreat) * STEP_DISTANCE;

                        // 💡 NEW: Experienced QBs step up into pressure (college/NFL style)
                        // Inexperienced QBs retreat too far and take unnecessary sacks
                        if (Math.abs(dxThreat) > Math.abs(dyThreat) && escapeY > pState.initialY - 3) {
                            // Edge threat - step up in pocket if experienced
                            const stepUpChance = qbExperience / 100; // Better QBs hold their ground
                            if (Math.random() < stepUpChance) {
                                escapeY = pState.y + STEP_DISTANCE * 0.3; // Subtle step up
                                escapeX = pState.x - Math.sign(dxThreat) * STEP_DISTANCE * 0.5;
                            } else {
                                // Retreat - inexperienced QBs bail too early
                                escapeY = pState.y - STEP_DISTANCE * 0.5;
                            }
                        }

                        // 💡 NEW: Panic threshold - if 2+ rushers and poor composure, scramble more drastically
                        if (pocketCollapsing && qbComposure < 60) {
                            escapeY = Math.min(pState.initialY + 2, escapeY - STEP_DISTANCE * 0.5);
                            escapeX += (Math.random() < 0.5 ? -1 : 1); // More erratic movement
                        }

                        escapeY = Math.max(pState.initialY - 5, escapeY); // Cap dropback depth

                        pState.targetX = escapeX;
                        pState.targetY = escapeY;
                    } else {
                        // 💡 IMPROVED: QB stands naturally when clean, not just drifting randomly
                        if (getDistance(pState, { x: pState.targetX, y: pState.targetY }) < 0.5) {
                            pState.targetX = pState.initialX; // Return to base position
                            pState.targetY = pState.initialY - 0.5; // Slight depth for vision
                        }
                    }
                    break;

                case 'idle':
                default:
                    pState.targetX = pState.x;
                    pState.targetY = pState.y;
                    break;
            }

            // Ensure Clamping (Applies to all offensive actions)
            pState.targetX = Math.max(1, Math.min(FIELD_WIDTH - 1, pState.targetX));
            pState.targetY = Math.max(1, Math.min(FIELD_LENGTH - 1, pState.targetY));
            return;
        }

        // ===========================================================
        // DEFENSE AI (FIXED)
        // ===========================================================
        if (pState.isOffense) return;

        // -- Status Checks --
        if (pState.stunnedTicks > 0) {
            pState.stunnedTicks--;
            pState.targetX = pState.x; pState.targetY = pState.y;
            return;
        }
        if (pState.isBlocked || pState.isEngaged) return;

        // -- 0. TURNOVER RETURN (Intercepted/Fumble Rec) --
        if (pState.isBallCarrier) {
            const visionDistance = 10.0;
            const lanes = [-5, 0, 5]; // Check Left, Center, Right lanes
            const DOWNHILL_BONUS = 1.5; // Preference for running straight
            let bestLane = { xOffset: 0, minDist: -Infinity };

            lanes.forEach(xOffset => {
                const lookAheadPoint = { x: pState.x + xOffset, y: pState.y - visionDistance };
                // Find closest offensive player (tackler)
                const closestTackler = offenseStates
                    .filter(o => !o.isBlocked && !o.isEngaged && o.stunnedTicks === 0)
                    .sort((a, b) => getDistance(lookAheadPoint, a) - getDistance(lookAheadPoint, b))[0];

                let dist = closestTackler ? getDistance(lookAheadPoint, closestTackler) : 100;
                if (xOffset === 0) dist += DOWNHILL_BONUS;

                if (dist > bestLane.minDist) {
                    bestLane.minDist = dist;
                    bestLane.xOffset = xOffset;
                }
            });

            pState.targetY = Math.max(0.5, pState.y - visionDistance);
            pState.targetX = Math.max(1.0, Math.min(52.3, pState.x + bestLane.xOffset));
            return;
        }

        // -- 1. DIAGNOSE PLAY --
        const diagnosis = diagnosePlay(pState, playType, offensivePlayKey, playState.tick);
        const isRunRead = (diagnosis === 'run');
        const isDB = pState.slot.includes('DB') || pState.slot.includes('S');

        // -- 2. CONTEXTUAL AWARENESS (FIXED) --
        const isBallCaughtOrRun = ballCarrierState && !playState.ballState.inAir;
        const isBallPastLOS = ballCarrierState && ballCarrierState.y > (LOS + 0.5);
        const carrierIsQB = ballCarrierState && ballCarrierState.slot.startsWith('QB');

        // --- 💡 FIX START: Better Pocket Detection ---
        // 1. If action is 'qb_setup', they are dropping back. They are IN the pocket.
        // 2. If velocity Y is negative, they are moving backward. They are IN the pocket.
        // 3. Only if they are moving fast (speed > 2) AND not dropping back do we worry.
        const isSetupAction = ballCarrierState?.action === 'qb_setup';
        const isMovingBack = ballCarrierState?.velocity?.y < -0.1;
        const qbSpeed = ballCarrierState?.velocity ? Math.sqrt(ballCarrierState.velocity.x ** 2 + ballCarrierState.velocity.y ** 2) : 0;

        // QB is in pocket if: They are the QB, haven't crossed LOS, AND (are setting up OR moving back OR moving very slowly)
        const qbInPocket = carrierIsQB && !isBallPastLOS && (isSetupAction || isMovingBack || qbSpeed < 3.0);
        // --- 💡 FIX END ---

        // 💡 DEBUG: Log DBs with man coverage on early ticks to diagnose instant pursuit
        if (isDB && pState.assignment && pState.assignment.startsWith('man_cover_') && playState.tick < 5) {
            console.debug(`DB tick=${playState.tick} id=${pState.id} assign=${pState.assignment} ballInAir=${isBallInAir} isBallCaughtOrRun=${isBallCaughtOrRun} qbInPocket=${qbInPocket} action=${pState.action}`);
        }

        // -- 3. BALL IN AIR (Reaction) --
        if (isBallInAir) {
            const timeSinceThrow = playState.tick - (playState.ballState.throwTick || playState.tick);
            const iq = pState.playbookIQ || 50;
            const reactionDelay = Math.max(0, 15 - Math.floor(iq / 7));

            if (timeSinceThrow > reactionDelay) {
                const landingSpot = { x: playState.ballState.targetX, y: playState.ballState.targetY };
                const distToLanding = getDistance(pState, landingSpot);

                // Base reaction ranges
                // 💡 TIGHTENED: DBs react from 20 yards (was 25) for better coverage
                let reactionRange = isDB ? 20 : 12; // DBs break on ball from further away but more conservative

                // If I'm in direct man coverage, be conservative unless the pass is to my man.
                // Use the persisted `assignedPlayerId` (stable) rather than searching
                // offenseStates each tick, which can be unreliable if slot mapping
                // or timing causes temporary misses.
                if (pState.assignment && pState.assignment.startsWith('man_cover_')) {
                    const assignedId = pState.assignedPlayerId || null;
                    // If we know who we're covering and the pass isn't to them,
                    // reduce the reaction range sharply so defenders stay with their man.
                    if (!assignedId || playState.ballState.targetPlayerId !== assignedId) {
                        reactionRange = 4; // Stay very tight with receiver unless ball is extremely close
                    } else {
                        // If the pass is to my man, be ready to react but not as loose as zone defenders
                        reactionRange = Math.max(8, reactionRange - 5); // Tighter than default DB range
                    }
                }

                if (distToLanding < reactionRange) {
                    // If I'm in man coverage and the reactionRange is small,
                    // only break if the ball is explicitly to my assigned receiver
                    // or the ball is extremely close.
                    if (pState.assignment && pState.assignment.startsWith('man_cover_')) {
                        const assignedId = pState.assignedPlayerId || null;
                        const isToMyMan = assignedId && playState.ballState.targetPlayerId === assignedId;
                        const veryClose = distToLanding < 3.0;
                        if (!isToMyMan && !veryClose) {
                            // Stay with receiver — do not start pursuit.
                            // Debug: log when a man-coverage defender decides NOT to break.
                            // (Can be enabled for deeper tracing.)
                            // console.debug(`ManCoverageHold: def=${pState.id} assign=${pState.assignment} assignedId=${assignedId} target=${playState.ballState.targetPlayerId} dist=${distToLanding.toFixed(1)} react=${reactionRange}`);
                        } else {
                            // Break to the ball — log for debugging so we can tune thresholds.
                            console.debug(`ManCoverBreak -> pursuit: def=${pState.id} assign=${pState.assignment} assignedId=${assignedId} target=${playState.ballState.targetPlayerId} dist=${distToLanding.toFixed(1)} react=${reactionRange}`);
                            pState.targetX = landingSpot.x;
                            pState.targetY = landingSpot.y;
                            pState.action = 'pursuit';
                            return;
                        }
                    } else {
                        // Non man-coverage defenders break normally.
                        pState.targetX = landingSpot.x;
                        pState.targetY = landingSpot.y;
                        pState.action = 'pursuit';
                        return;
                    }
                }
            }
        }

        // -- 4. PURSUIT LOGIC (SMART LB CONTAINMENT) --
        let shouldPursue = false;

        // 1. Blitzers ALWAYS pursue (DL or LB assigned to blitz)
        if (pState.assignment?.includes('blitz') || pState.assignment?.includes('rush')) {
            shouldPursue = true;
        }
        // 2. Ball Carrier Logic
        else if (isBallCaughtOrRun) {
            if (!carrierIsQB) {
                // RB/WR has the ball -> Everyone chases
                shouldPursue = true;
            } else if (isBallPastLOS) {
                // QB has crossed the line -> Everyone chases immediately
                shouldPursue = true;
            } else if (!qbInPocket) {
                // QB is scrambling BEHIND the line

                // A. DEFENSIVE BACKS (Safeties/Corners)
                // Stay deep unless the QB is very close or running specifically at them
                if (pState.slot.includes('DB') || pState.slot.includes('S')) {
                    const distToQB = getDistance(pState, ballCarrierState);

                    if (pState.assignment.startsWith('man_cover_')) {
                        shouldPursue = false; // Stick to man
                    } else if (distToQB < 10.0 || ballCarrierState.action === 'qb_scramble') {
                        // Safety "Shadow" Logic (from previous fix)
                        shouldPursue = false;
                        pState.targetX = (pState.x * 0.4) + (ballCarrierState.x * 0.6);
                        pState.targetY = Math.max(LOS + 2.0, ballCarrierState.y + 4.0);
                        pState.action = 'zone_coverage';
                        return; // Force update
                    } else {
                        shouldPursue = false;
                    }
                }
                // B. LINEBACKERS IN COVERAGE (The Fix)
                // Don't rush blindly! "Shadow" the QB to cut off lanes.
                else if (pState.slot.startsWith('LB')) {
                    if (pState.assignment.startsWith('man_cover_')) {
                        // Man Coverage LB: Stick to the RB/TE until QB crosses LOS
                        shouldPursue = false;
                    } else {
                        // Zone Coverage LB: BECOME A SPY
                        // Do not rush the QB yet (leaves zone open). 
                        // Instead, mirror the QB's X position to contain the edge.
                        shouldPursue = false;

                        // Move laterally with QB
                        pState.targetX = ballCarrierState.x;

                        // Hold depth! Don't let the ball go over your head.
                        // Stay at least 2 yards deep or your current zone depth.
                        const holdDepth = Math.max(LOS + 2.0, pState.y);

                        // But if QB gets too close (3 yards), attack!
                        const distToQB = getDistance(pState, ballCarrierState);
                        if (distToQB < 3.0) {
                            shouldPursue = true; // Commit to tackle
                        } else {
                            pState.targetY = holdDepth;
                            pState.action = 'spy_QB'; // Updates animation state
                            return; // Force update
                        }
                    }
                }
                // C. DEFENSIVE LINEMEN
                else {
                    // DLs always chase a scrambling QB
                    shouldPursue = true;
                }
            } else {
                // QB in pocket -> Everyone stays home
                shouldPursue = false;
            }
        }

        // --- 💡 FIX START: Man Coverage Discipline ---
        if (shouldPursue && ballCarrierState) {
            const isManCovered = pState.assignment && pState.assignment.startsWith('man_cover_');
            const isManCoverEligible = isManCovered && (isDB || pState.slot.startsWith('LB'));

            if (isManCoverEligible) {
                // Only break man coverage if:
                // 1. Not the QB carrying it (RB run/catch)
                // 2. QB crossed LOS
                // 3. QB is clearly scrambling (action='qb_scramble') NOT just moving in pocket
                const isScrambleAction = ballCarrierState.action === 'qb_scramble';

                const allowBreak = (!carrierIsQB) || (carrierIsQB && (isBallPastLOS || isScrambleAction));

                if (!allowBreak) {
                    // FORCE HOLD: Do not pursue yet.
                    shouldPursue = false;
                    // Debug log to confirm fix
                    if (playState.tick % 20 === 0 && playState.tick < 60) {
                        // console.debug(`Fixed Hold: ${pState.name} holding man coverage. QB Action: ${ballCarrierState.action}`);
                    }
                } else {
                    pState.action = 'pursuit';
                }
            } else {
                // Zones/Others pursue freely if eligible
                pState.action = 'pursuit';
            }

            if (shouldPursue) {
                // Pursuit Logic
                const dist = getDistance(pState, ballCarrierState);
                let predictionTime = Math.min(1.0, dist / 12.0);
                pState.targetX = ballCarrierState.x + ((ballCarrierState.velocity?.x || 0) * predictionTime);
                pState.targetY = ballCarrierState.y + ((ballCarrierState.velocity?.y || 0) * predictionTime);
                return;
            }
        }

        // -- 5. ASSIGNMENT LOGIC --
        const assignment = pState.assignment;

        // --- A. RUN SUPPORT (SMART CONTAIN & GAP) ---
        if (isRunRead && !isBallInAir) {
            const isDL = pState.slot.startsWith('DL');
            const isLB = pState.slot.startsWith('LB');
            const isDB = pState.slot.includes('DB') || pState.slot.startsWith('S');

            if (ballCarrierState) {
                const runnerX = ballCarrierState.x;
                const runnerY = ballCarrierState.y;
                const distToBall = getDistance(pState, ballCarrierState);

                // 1. IDENTIFY FORCE PLAYERS (Edge Defenders)
                // Wide DLs or Outside LBs must "Set the Edge"
                const isEdgeDefender = Math.abs(pState.initialX - CENTER_X) > 6.0 && (isDL || isLB);
                const assignmentIsEdge = assignment?.includes('edge') || assignment?.includes('contain');

                if (isEdgeDefender || assignmentIsEdge) {
                    // CONTAIN LOGIC:
                    // Goal: Stay "Outside" the runner to force them back inside.
                    
                    const isLeftEdge = pState.initialX < CENTER_X;
                    
                    // Target a point 2 yards OUTSIDE the runner (Leverage)
                    const leveragePoint = isLeftEdge ? runnerX - 2.0 : runnerX + 2.0;
                    
                    // Panic Check: Did the runner get outside me?
                    // If I'm on the left, and runner is further left -> Sprint wide!
                    let targetX = leveragePoint;
                    if (isLeftEdge && runnerX < pState.x) targetX = runnerX - 3.0;
                    if (!isLeftEdge && runnerX > pState.x) targetX = runnerX + 3.0;

                    pState.targetX = targetX;
                    // Stay slightly deeper to prevent cutback
                    pState.targetY = Math.max(LOS - 0.5, runnerY); 
                }

                // 2. GAP FILL LOGIC (Interior Linemen & LBs)
                else if (isDL) {
                    // Interior DL: Fight pressure.
                    // If runner is right in front (2 yds), attack.
                    const flow = runnerX - pState.x;
                    if (Math.abs(flow) < 2.0) {
                        pState.targetX = runnerX;
                    } else {
                        // If runner moves laterally, slide but don't over-pursue (Gap Integrity)
                        pState.targetX = pState.x + (flow * 0.6); 
                    }
                    pState.targetY = ballCarrierState.y; 
                }

                // 3. PURSUIT LOGIC (Linebackers/DBs)
                else if (isLB || isDB) {
                    // LBs/DBs calculate interception angles (lead the target)
                    const leadFactor = 0.5; // seconds
                    const anticipatedX = runnerX + ((ballCarrierState.velocity?.x || 0) * leadFactor);
                    const anticipatedY = runnerY + ((ballCarrierState.velocity?.y || 0) * leadFactor);

                    // Safety Valve: Don't bite too hard on Play Action deep
                    if (isDB && runnerY < LOS + 3.0) {
                        pState.targetX = anticipatedX;
                        pState.targetY = Math.max(LOS + 4.0, anticipatedY);
                    } else {
                        pState.targetX = anticipatedX;
                        pState.targetY = anticipatedY;
                    }
                }
            }
            return; 
        }

        // --- B. PUNT RETURN (Move to catch) ---
        if (assignment === 'punt_return') {
            // If punt is in the air, move toward the predicted landing spot
            const ball = playState.ballState || {};
            if (ball.inAir && typeof ball.targetX !== 'undefined' && typeof ball.targetY !== 'undefined') {
                // Move to the landing/target coordinates so returner can field the punt
                // Apply a small offset so the returner approaches from an angle
                const approachOffsetX = (pState.x < ball.targetX) ? 0.5 : -0.5;
                const approachOffsetY = 0; // No vertical offset; let arrival check determine catch
                pState.targetX = Math.max(0.5, Math.min(FIELD_WIDTH - 0.5, ball.targetX + approachOffsetX));
                pState.targetY = Math.max(10.5, Math.min(FIELD_LENGTH - 10.5, ball.targetY + approachOffsetY));
                pState.action = 'punt_return';
            } else if (ball.inAir && (typeof ball.targetX === 'undefined' || typeof ball.targetY === 'undefined')) {
                // If the punt doesn't have a precise target, move toward the current ball position
                pState.targetX = Math.max(0.5, Math.min(FIELD_WIDTH - 0.5, playState.ballState.x || pState.initialX));
                pState.targetY = Math.max(10.5, Math.min(FIELD_LENGTH - 10.5, playState.ballState.y || pState.initialY));
                pState.action = 'punt_return';
            } else {
                // Ball is not in flight (or already on ground) - hold at initial position until arrival handler resolves
                pState.targetX = pState.initialX;
                pState.targetY = pState.initialY;
                pState.action = 'punt_return';
            }
        }

        // --- 💡 ENHANCED: Safety Help Coordination (applies before specific assignments) ---
        // Check if this is a safety that should provide help instead of normal assignment
        if (!isBallInAir && pState.slot.startsWith('S')) {
            const safetyHelp = calculateSafetyHelp(pState, defenseStates, offenseStates, ballCarrierState, playState, isBallInAir);

            if (safetyHelp && safetyHelp.type === 'help') {
                // Override normal assignment to provide help
                pState.targetX = safetyHelp.helpX;
                pState.targetY = safetyHelp.helpY;
                pState.assignment = 'safety_help'; // Track that we're helping

                // Final clamp
                pState.targetX = Math.max(1, Math.min(52, pState.targetX));
                pState.targetY = Math.max(1, Math.min(119, pState.targetY));

                return; // Skip normal assignment logic
            }
        }

        // --- C. MAN COVERAGE (ENHANCED) ---
        else if (assignment?.startsWith('man_cover_')) {
            const targetSlot = assignment.replace('man_cover_', '');
            // 💡 CRITICAL: Use the persisted assignedPlayerId instead of searching offenseStates,
            // which can fail if receiver position or timing is out of sync.
            let targetRec = null;
            if (pState.assignedPlayerId) {
                targetRec = offenseStates.find(o => o.id === pState.assignedPlayerId);
            }
            // Fallback: search by slot if id lookup fails
            if (!targetRec) {
                targetRec = offenseStates.find(o => o.slot === targetSlot);
            }

            if (targetRec) {
                // 💡 ENHANCED: Intelligent man coverage positioning based on game state
                const distToRec = getDistance(pState, targetRec);
                const defenderSpeed = pState.speed || 50;
                const defenderCoverage = pState.catchingHands || 50; // Use coverage awareness
                const recSpeed = targetRec.speed || 50;
                const isSafety = pState.slot.startsWith('S');
                const isCornerback = pState.slot.startsWith('DB') && !pState.slot.startsWith('S');
                const isLB = pState.slot.startsWith('LB');

                // 💡 NEW: LB Speed Mismatch Handling
                // If LB is too slow for receiver, get safety help
                let requestSafetyHelp = false;
                let helpType = null;

                if (isLB && targetRec.action === 'run_route') {
                    const speedDifference = recSpeed - defenderSpeed;
                    const isDeepRoute = targetRec.y > LOS + 15;
                    const isVerticalRoute = targetRec.routePath &&
                        targetRec.routePath.some(p => p.y > targetRec.initialY + 10);

                    // If receiver is faster AND running deep or vertical route, LB needs help
                    if (speedDifference > 8 && (isDeepRoute || isVerticalRoute)) {
                        requestSafetyHelp = true;
                        helpType = isVerticalRoute ? 'vertical' : 'deep';
                    }
                }

                // Decision 1: Cushion based on receiver depth and route type
                // 💡 ENHANCED: More nuanced cushion based on exact depth, not just ranges
                let cushion = 1.5; // Default cushion

                const receiverDepthFromLOS = targetRec.y - LOS;
                const speedDifference = recSpeed - defenderSpeed;

                // Determine route type from assignment or action
                const isQuickRoute = targetRec.action === 'run_route' &&
                    targetRec.routePath &&
                    targetRec.routePath.length > 0 &&
                    targetRec.routePath[Math.min(1, targetRec.routePath.length - 1)].y < LOS + 5;

                if (isBallInAir && playState.ballState.targetPlayerId === targetRec.id) {
                    // Ball is in air and targeting this receiver - tighten up!
                    cushion = 0.3;
                } else if (isQuickRoute) {
                    // Quick slant/bubble - play TIGHT (0.5 yards)
                    cushion = 0.5;
                    // Corner can be especially tight on quick routes
                    if (isCornerback) cushion = 0.4;
                } else if (receiverDepthFromLOS < 5) {
                    // Short route (checkdown) - tight coverage
                    cushion = 0.7;
                    if (isCornerback) cushion = 0.6;
                    if (isLB) cushion = 0.9; // LBs slightly deeper on short routes
                } else if (receiverDepthFromLOS >= 5 && receiverDepthFromLOS < 10) {
                    // Intermediate route - normal cushion with speed adjustment
                    cushion = 1.2;
                    if (speedDifference > 8) cushion = 1.5; // Faster receiver needs more space
                    if (isLB && speedDifference > 8) cushion = 1.8; // LBs extra space
                } else if (receiverDepthFromLOS >= 10 && receiverDepthFromLOS < 15) {
                    // Mid-depth route (12-15 yards) - moderate cushion
                    cushion = 1.5;
                    if (speedDifference > 8) cushion = 2.0;
                    if (isLB) cushion = 1.8;
                    if (isLB && speedDifference > 8) cushion = 2.3;
                } else if (receiverDepthFromLOS >= 15 && receiverDepthFromLOS < 25) {
                    // Deep route (15-25 yards) - deeper cushion
                    cushion = 2.2;
                    if (speedDifference > 8) cushion = 2.5; // Significantly faster receiver
                    if (speedDifference > 10) cushion = 2.8; // Very fast receiver
                    if (isLB) cushion = 2.5; // LBs need more space
                    if (isLB && speedDifference > 8) cushion = 3.0;
                } else {
                    // Very deep route (25+ yards) - maximum cushion
                    cushion = 2.8;
                    if (speedDifference > 5) cushion = 3.0;
                    if (isLB) cushion = 3.2; // LBs very deep
                }

                // Receiver coming back or stationary overrides depth logic
                if (targetRec.action === 'run_block' || targetRec.action === 'route_complete') {
                    // Receiver coming back or stationary - tighter coverage
                    cushion = 0.8;
                } else if (isBallInAir && distToRec < 5.0) {
                    // Ball in air and nearby - immediate tight coverage
                    cushion = 0.2;
                }

                // Decision 2: Shading based on receiver position and ball location
                let shadeX = 0;
                let shadeY = cushion;

                if (isBallInAir && qbState) {
                    // Shade towards the ball if it's in flight
                    const ballDist = getDistance(pState, playState.ballState);
                    if (ballDist < 15.0) {
                        // QB is throwing - shade ball-side for interception
                        shadeX = (playState.ballState.x > targetRec.x) ? 1.0 : -1.0;
                        shadeY = Math.max(0.3, cushion - 1.0); // Get tighter when ball is in air
                    }
                } else if (!isBallInAir && distToRec < 3.0) {
                    // Receiver is close and no pass in air - press coverage
                    shadeX = (targetRec.x < CENTER_X) ? 0.3 : -0.3; // Inside shade for leverage
                    shadeY = 0.5; // Very tight
                } else {
                    // Normal coverage - inside shade (better leverage)
                    shadeX = (targetRec.x < CENTER_X) ? 0.5 : -0.5;
                }

                // Decision 3: Safety help consideration (safeties play more conservative)
                if (isSafety) {
                    // Safeties in man coverage help over the top
                    cushion = Math.max(1.5, cushion + 1.0); // Keep deeper
                    shadeY = Math.max(0.5, cushion); // Deeper positioning
                }

                // Decision 4: LB get safety help for vertical routes
                if (isLB && requestSafetyHelp) {
                    // Shade back and play off receiver, waiting for safety help
                    shadeY = Math.max(1.0, cushion + 0.5); // Deeper
                    if (helpType === 'vertical') {
                        shadeX = 0; // Play centered on receiver for help over top
                    }
                }

                // Decision 4: Anticipation based on receiver depth and route type
                let anticipatedX = targetRec.x;
                let anticipatedY = targetRec.y;

                if (targetRec.routePath && targetRec.routePath.length > 0 && targetRec.currentPathIndex < targetRec.routePath.length) {
                    // Read the route direction and anticipate next point
                    const nextPathPoint = targetRec.routePath[Math.min(targetRec.currentPathIndex + 1, targetRec.routePath.length - 1)];
                    if (nextPathPoint) {
                        // Estimate where receiver will be in next 1-2 ticks
                        const recVelX = (nextPathPoint.x - targetRec.x) * 0.3;
                        const recVelY = (nextPathPoint.y - targetRec.y) * 0.3;
                        anticipatedX = targetRec.x + recVelX;
                        anticipatedY = targetRec.y + recVelY;
                    }
                }

                pState.targetX = anticipatedX + shadeX;
                pState.targetY = anticipatedY + shadeY;
            } else {
                // Target missing or moved, default to zone spot
                const z = getZoneCenter('zone_short_middle', LOS);
                pState.targetX = z.x;
                pState.targetY = z.y;
            }
        }

        // --- D. ZONE COVERAGE (ENHANCED WITH SAFETY VISION) ---
        else if (assignment?.startsWith('zone_')) {
            const originalZoneCenter = pState.cachedZoneCenter || getZoneCenter(assignment, LOS);
            const zone = zoneBoundaries[assignment];
            
            // Is this player a Deep Safety/Corner?
            const isDeepDefender = pState.slot.includes('S') || assignment.includes('deep');
            
            let targetX = originalZoneCenter.x;
            let targetY = originalZoneCenter.y;
            let foundUrgentThreat = false;

            // 1. SAFETY VISION: Scan for "Busted Coverages"
            // If I am a deep defender, look for ANY deep, open receiver in my half of the field.
            if (isDeepDefender && !playState.ballState.inAir) {
                const deepOpenReceivers = offenseStates.filter(o => 
                    o.action.includes('route') && 
                    o.y > LOS + 10 && // Deep
                    Math.abs(o.x - pState.x) < 25 && // On my side of the field
                    !o.isBlocked
                );

                let mostDangerousRec = null;
                let maxDangerScore = -1;

                deepOpenReceivers.forEach(rec => {
                    // Check how "Open" this receiver is (distance to nearest OTHER defender)
                    const distToNearestDefender = defenseStates
                        .filter(d => d.id !== pState.id) // Don't count myself
                        .reduce((min, d) => Math.min(min, getDistance(rec, d)), 100);

                    // If nobody is within 5 yards of this deep receiver, that's an EMERGENCY.
                    if (distToNearestDefender > 5.0) {
                        // Danger = Depth + Openness
                        const score = rec.y + distToNearestDefender;
                        if (score > maxDangerScore) {
                            maxDangerScore = score;
                            mostDangerousRec = rec;
                        }
                    }
                });

                // If we found a guy running free...
                if (mostDangerousRec) {
                    foundUrgentThreat = true;
                    // ABANDON ZONE -> HELP OVER THE TOP
                    // Target: Match his X, but stay 4 yards deeper (Goalie logic)
                    const helpX = mostDangerousRec.x;
                    const helpY = Math.max(originalZoneCenter.y, mostDangerousRec.y + 4.0);
                    
                    // Blend: 70% towards the threat, 30% stay near zone center (to not get completely baited)
                    targetX = (helpX * 0.7) + (originalZoneCenter.x * 0.3);
                    targetY = helpY;
                }
            }
            // 2. STANDARD ZONE LOGIC (If no emergency)
            if (!foundUrgentThreat) {
                // Look for threats inside my normal zone radius
                const searchRadius = isDeepDefender ? 12.0 : 6.0;
                const localThreats = offenseStates.filter(o => {
                    if (!o.action.includes('route') && o.action !== 'route_complete') return false;
                    return Math.abs(o.x - originalZoneCenter.x) < searchRadius &&
                           Math.abs(o.y - originalZoneCenter.y) < searchRadius + 2;
                });

                if (localThreats.length > 0) {
                    // Sort by threat level (closest + deepest)
                    localThreats.sort((a, b) => {
                        const distA = getDistance(originalZoneCenter, a);
                        const distB = getDistance(originalZoneCenter, b);
                        return distA - distB;
                    });

                    const primaryThreat = localThreats[0];
                    const distToThreat = getDistance(pState, primaryThreat);
                    
                    // Blend towards threat
                    const blendFactor = Math.max(0.3, Math.min(0.8, distToThreat / 8.0));
                    targetX = (primaryThreat.x * blendFactor) + (originalZoneCenter.x * (1 - blendFactor));
                    targetY = (primaryThreat.y * blendFactor) + (originalZoneCenter.y * (1 - blendFactor));

                    // Deep defenders always stay on top
                    if (isDeepDefender) {
                        targetY = Math.max(targetY, primaryThreat.y + 2.0);
                    }
                } else {
                    // Empty Zone: Read QB Eyes
                    if (qbState) {
                        const shiftX = (qbState.x - originalZoneCenter.x) * 0.2;
                        targetX += shiftX;
                    }
                }
            }
            // 3. CLAMP BOUNDARIES
            // Ensure they don't run out of their assigned zone boundaries too far
            if (zone && !foundUrgentThreat) { // Allow breaking zone for urgent threats
                if (zone.minX !== undefined) targetX = Math.max(zone.minX - 2, Math.min(zone.maxX + 2, targetX));
                if (zone.minY !== undefined) {
                    const absMinY = LOS + zone.minY;
                    const absMaxY = Math.min(119, LOS + zone.maxY);
                    targetY = Math.max(absMinY - 2, Math.min(absMaxY + 5, targetY));
                }
            }
        }

        // --- E. QB SPY (ENHANCED) ---
        else if (assignment === 'spy_QB') {
            if (qbState) {
                // 💡 ENHANCED: Intelligent QB spy positioning
                const isSafety = pState.slot.startsWith('S');
                const distToQB = getDistance(pState, qbState);
                const qbSpeed = qbState.speed || 50;
                const spySpeed = pState.speed || 50;

                // Decision 1: Aggressive vs Conservative spy
                let spyDepth = LOS + 4; // Default depth

                if (qbState.action === 'qb_scramble' || qbState.y > LOS + 1.0) {
                    // QB is already scrambling - attack vertically
                    pState.targetX = qbState.x;
                    pState.targetY = qbState.y;
                    pState.action = 'pursuit';
                    return;
                } else if (qbSpeed > spySpeed + 5 && !isSafety) {
                    // QB is faster - take wider angle
                    pState.targetX = qbState.x + (qbState.x > CENTER_X ? -2 : 2); // Cut off edge
                    pState.targetY = LOS - 0.5; // Play just off LOS
                } else if (isSafety) {
                    // Safety spies keep deeper (help over top while monitoring)
                    spyDepth = LOS + 3.5;
                    pState.targetX = (pState.x * 0.6) + (qbState.x * 0.4); // Slight contribution
                    pState.targetY = spyDepth;
                } else {
                    // DB spy - stay tighter, ready to pounce
                    pState.targetX = qbState.x + 0.5; // Slight offset
                    pState.targetY = LOS + 0.5; // Very close to line
                }
            }
        }
        // --- F. BLITZ / PASS RUSH (ENHANCED) ---
        else if (assignment?.includes('rush') || assignment?.includes('blitz')) {
            // 💡 ENHANCED: Sophisticated gap assignment for pass rushers
            if (qbState && !playState.ballState.inAir) {
                // 💡 IMPROVED: Better edge rusher classification using slot position
                // Edge positions: DE (Defensive End) typically have higher slot numbers on edges
                // Interior positions: DT (Defensive Tackle) are in middle
                const slotStr = pState.slot.toUpperCase();
                const isDesignatedEdge = slotStr.includes('E') || slotStr.includes('END');
                const isDesignatedInterior = slotStr.includes('T') || slotStr.includes('TACKLE') || slotStr.includes('NOSE');

                // Fallback to position-based detection if slot doesn't specify
                let isEdgeRusher = false;
                if (isDesignatedEdge) {
                    isEdgeRusher = true;
                } else if (!isDesignatedInterior && pState.slot.startsWith('DL')) {
                    // Use position approximation: far from center = edge
                    const distFromCenter = Math.abs(pState.initialX - CENTER_X);
                    isEdgeRusher = distFromCenter > 10;
                }

                const isInteriorRusher = pState.slot.startsWith('DL') && !isEdgeRusher;

                // Determine target based on gap assignment
                let rushTarget = { x: qbState.x, y: qbState.y };

                if (isEdgeRusher) {
                    // Edge rushers work around tackles, not straight line
                    const tackleX = pState.initialX < CENTER_X ? 5 : 48; // Tackle position approximation
                    rushTarget.x = qbState.x + (tackleX > CENTER_X ? 3 : -3); // Rush around edge
                    rushTarget.y = qbState.y - 2; // Approach at angle
                } else if (isInteriorRusher) {
                    // Interior linemen attack upfield more directly
                    rushTarget.y = qbState.initialY - 3; // Target QB's initial depth
                }

                // 💡 NEW: Contain responsibility - DBs on blitz should take contain, not gap
                if (pState.slot.includes('DB')) {
                    rushTarget.x = pState.initialX < CENTER_X ? 2 : 51; // Wide contain
                    rushTarget.y = qbState.y + 1; // Shallow to catch scrambles
                }

                pState.targetX = rushTarget.x;
                pState.targetY = rushTarget.y;
            } else {
                // Fallback if no QB state
                let rushTarget = { x: pState.initialX, y: pState.initialY - 5 };
                pState.targetX = rushTarget.x;
                pState.targetY = rushTarget.y;
            }
        }

        // Final Clamp
        pState.targetX = Math.max(1, Math.min(52, pState.targetX));
        pState.targetY = Math.max(1, Math.min(119, pState.targetY));
    }); // END DEFENSE FOREACH
} // END UPDATEPLAYERTARGETS FUNCTION

/**
 * Checks for block engagements based on proximity.
 * 💡 IMPROVED: More realistic blocking interactions with strength calculations
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
                    // 💡 IMPROVED: Sort by threat level, including blitz assignments
                    defendersInRange.sort((a, b) => {
                        // Priority 1: Blitzers should be picked up first
                        const aIsBlitzer = a.assignment && (a.assignment.includes('blitz') || a.assignment.includes('rush'));
                        const bIsBlitzer = b.assignment && (b.assignment.includes('blitz') || b.assignment.includes('rush'));

                        if (aIsBlitzer && !bIsBlitzer) return -1; // a is blitzer, prioritize
                        if (!aIsBlitzer && bIsBlitzer) return 1;  // b is blitzer, prioritize

                        // Priority 2: Defenders closer to QB or RB (threat to ball carrier)
                        const ballCarrier = playState.activePlayers.find(p => p.isBallCarrier || p.hasBall);
                        if (ballCarrier && ballCarrier.isOffense) {
                            const aQBDist = getDistance(a, ballCarrier);
                            const bQBDist = getDistance(b, ballCarrier);
                            const distDiff = aQBDist - bQBDist;
                            if (Math.abs(distDiff) > 0.5) return distDiff; // Significant difference
                        }

                        // Priority 3: Closer defenders (secondary tiebreaker)
                        return getDistance(blocker, a) - getDistance(blocker, b);
                    });
                    targetDefender = defendersInRange[0];
                }
            }

            // 3. If we found a target, check for realistic engagement conditions
            if (targetDefender) {
                // 💡 IMPROVED: "Whiff" logic - defender must not be far past blocker
                if (isPassBlock) {
                    const WHIFF_BUFFER = 0.5; // 0.5 yard buffer
                    if (targetDefender.y < (blocker.y - WHIFF_BUFFER)) {
                        // Defender has beaten the blocker - can't hold
                        if (blocker.dynamicTargetId === targetDefender.id) {
                            blocker.dynamicTargetId = null;
                        }
                        targetDefender = null; // Do not engage
                    }
                }

                // 💡 NEW: Strength-based win probability for engagement
                if (targetDefender) {
                    const blockerStrength = blocker.attributes?.physical?.strength || 50;
                    const defenderStrength = targetDefender.attributes?.physical?.strength || 50;
                    const strengthDiff = blockerStrength - defenderStrength;

                    // Stronger defender has better chance to shed block
                    const engagementSuccessChance = 0.5 + (strengthDiff / 200); // 0-1 range
                    if (Math.random() > engagementSuccessChance && defenderStrength > blockerStrength + 10) {
                        // Weak blocker can't engage strong defender
                        targetDefender = null;
                    }
                }
            }

            // 4. If we *still* have a valid target, initiate the block
            if (targetDefender) {
                blocker.engagedWith = targetDefender.id;
                blocker.isEngaged = true;
                blocker.dynamicTargetId = targetDefender.id; // Confirm the target
                blocker.engagementStartTick = playState.tick; // 💡 NEW: Track when engagement started

                targetDefender.isBlocked = true;
                targetDefender.blockedBy = blocker.id;
                targetDefender.isEngaged = true;
                targetDefender.engagementStartTick = playState.tick; // 💡 NEW: Track engagement timing

                playState.blockBattles.push({
                    blockerId: blocker.id,
                    defenderId: targetDefender.id,
                    status: 'ongoing',
                    battleScore: 0,
                    startTick: playState.tick,
                    blockerStrength: blocker.attributes?.physical?.strength || 50,
                    defenderStrength: targetDefender.attributes?.physical?.strength || 50
                });
            }
        }
    });
}
function checkTackleCollisions(playState, gameLog) {
    // Target anyone who HAS the ball (Runner, QB, WR after catch)
    const ballCarrierState = playState.activePlayers.find(p =>
        (p.isBallCarrier || p.hasBall) &&
        !playState.ballState.inAir &&
        !playState.ballState.isLoose
    );

    if (!ballCarrierState) return false;

    const TACKLE_RANGE_CHECK = TACKLE_RANGE; // 1.8
    const activeDefenders = playState.activePlayers.filter(p =>
        p.teamId !== ballCarrierState.teamId &&
        !p.isBlocked && !p.isEngaged && p.stunnedTicks === 0 &&
        Math.abs(p.x - ballCarrierState.x) < TACKLE_RANGE_CHECK &&
        Math.abs(p.y - ballCarrierState.y) < TACKLE_RANGE_CHECK
    );

    if (ballCarrierState.tacklesBrokenThisPlay === undefined) {
        ballCarrierState.tacklesBrokenThisPlay = 0;
    }

    const MOMENTUM_SCALING_FACTOR = 0.1;

    for (const defender of activeDefenders) {
        if (getDistance(ballCarrierState, defender) < TACKLE_RANGE_CHECK) {

            if (checkFumble(ballCarrierState, defender, playState, gameLog)) {
                ballCarrierState.stunnedTicks = 40;
                return false;
            }

            // Break Tackle Math
            const carrierWeight = ballCarrierState.weight || 180;
            const carrierSpeed = ballCarrierState.currentSpeedYPS || 0;
            const successiveTacklePenalty = ballCarrierState.tacklesBrokenThisPlay * 0.25; // Increased penalty for multiple breaks
            const skillModifier = Math.max(0.1, 1.0 - successiveTacklePenalty);

            const carrierSkill = ((ballCarrierState.agility || 50) * 1.0 + (ballCarrierState.strength || 50) * 0.5) * skillModifier;
            const carrierMomentum = (carrierWeight * carrierSpeed) * MOMENTUM_SCALING_FACTOR;
            const breakPower = (carrierSkill + carrierMomentum) * ballCarrierState.fatigueModifier;

            const tacklerWeight = defender.weight || 200;
            const tacklerSpeed = defender.currentSpeedYPS || 0;
            const tacklerSkill = ((defender.tackling || 50) * 1.0 + (defender.strength || 50) * 0.5);
            const tacklerMomentum = (tacklerWeight * tacklerSpeed) * (MOMENTUM_SCALING_FACTOR * 1.5);

            // 💡 TUNING: Added +15.0 TACKLE_BIAS to make wrapping up easier
            const TACKLE_BIAS = 15.0;
            const tacklePower = ((tacklerSkill + tacklerMomentum) * defender.fatigueModifier) + TACKLE_BIAS;

            const roll = getRandomInt(-10, 10);
            const diff = (breakPower + roll) - tacklePower;

            if (diff <= 0) { // Tackle success (Runner failed to break it)
                playState.yards = ballCarrierState.y - playState.lineOfScrimmage;
                playState.playIsLive = false;

                const tacklerPlayer = getPlayer(defender.id);
                if (tacklerPlayer) {
                    ensureStats(tacklerPlayer);
                    tacklerPlayer.gameStats.tackles = (tacklerPlayer.gameStats.tackles || 0) + 1;

                    // Sack Logic
                    const isBehindLOS = ballCarrierState.y < playState.lineOfScrimmage;
                    const isSackAction = (ballCarrierState.action === 'qb_setup' || ballCarrierState.action === 'qb_scramble');

                    // --- 💡 FIX: SAFETY DETECTION START ---
                    // Defensive Endzone is Y=0 to Y=10.
                    // If Offense is tackled here, it is a Safety.
                    const isSafety = ballCarrierState.isOffense && ballCarrierState.y <= 10.0;

                    if (isSafety) {
                        playState.safety = true;
                        if (gameLog) gameLog.push(`🚨 SAFETY! ${ballCarrierState.name} tackled in the endzone by ${defender.name}!`);
                        // Safety overrides Sack recording for yards, but we still credit the tackle
                    }
                    else if (ballCarrierState.slot.startsWith('QB') && isBehindLOS && (playState.type === 'pass' || isSackAction)) {
                        playState.sack = true;
                        if (gameLog) gameLog.push(`💥 SACK! ${defender.name} drops ${ballCarrierState.name}!`);
                        tacklerPlayer.gameStats.sacks = (tacklerPlayer.gameStats.sacks || 0) + 1;
                    } else {
                        // Normal Tackle
                        const yards = playState.yards.toFixed(1);
                        if (gameLog) gameLog.push(`✋ ${ballCarrierState.name} tackled by ${defender.name} for ${yards < 0 ? 'a loss of ' + Math.abs(yards) : 'a gain of ' + yards}.`);
                    }
                    // --- 💡 FIX: SAFETY DETECTION END ---
                }
                return true; // Play ended
            } else { // Broken Tackle (Juke)
                ballCarrierState.tacklesBrokenThisPlay++;
                ballCarrierState.action = 'juke';

                // 💡 TUNING: Stronger slowdown penalty for the runner
                ballCarrierState.jukeTicks = 10; // Duration of "juke" animation
                ballCarrierState.currentSpeedYPS *= 0.4; // Lose 60% of speed (was 50%)

                if (gameLog) gameLog.push(`💥 ${ballCarrierState.name} breaks tackle from ${defender.name}!`);

                // 💡 TUNING: Reduced defender stun duration (Was 40 ticks / 2.0s)
                // Now 20 ticks (1.0s), allowing them to recover and pursue again.
                defender.stunnedTicks = 20;
            }
        }
    }
    return false;
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
    const ballCarrier = playState.activePlayers.find(p => p.isBallCarrier);

    playState.blockBattles.forEach((battle, index) => {
        // Skip first tick
        if (battle.startTick === playState.tick) return;

        if (battle.status !== 'ongoing') {
            battlesToRemove.push(index);
            return;
        }

        const blocker = playState.activePlayers.find(p => p.id === battle.blockerId);
        const defender = playState.activePlayers.find(p => p.id === battle.defenderId);

        // 1. Validation Checks
        if (!blocker || !defender || 
            blocker.engagedWith !== defender.id || 
            defender.blockedBy !== blocker.id ||
            blocker.stunnedTicks > 0 || defender.stunnedTicks > 0) {
            
            // Force disengage
            if (blocker) { blocker.engagedWith = null; blocker.isEngaged = false; }
            if (defender) { defender.isBlocked = false; defender.blockedBy = null; defender.isEngaged = false; }
            
            battle.status = 'disengaged';
            battlesToRemove.push(index);
            return;
        }

        // 2. --- 💡 NEW: SHED-TO-TACKLE LOGIC ---
        // If the ball carrier runs past the defender within "Arm's Reach" (1.5 yds),
        // the defender abandons the block to make the tackle.
        if (ballCarrier) {
            const distToCarrier = getDistance(defender, ballCarrier);
            
            // If carrier is close AND defender has eyes on them (carrier is not behind defender)
            if (distToCarrier < 1.5) {
                // "Reach" Attempt: Defender tries to grab the runner
                // Bonus if defender has high Play Recognition (IQ) or Shedding
                const reactionScore = (defender.playbookIQ || 50) + (defender.blockShedding || 50);
                
                // 80% chance for a decent defender to disengage
                if (reactionScore + getRandomInt(0, 50) > 100) {
                    // SUCCESS: Shed immediately!
                    battle.status = 'win_B'; // Defender wins
                    defender.action = 'pursuit'; // Switch AI to tackle mode
                    
                    // Log it sometimes
                    // if (gameLog && Math.random() < 0.1) gameLog.push(`${defender.name} sheds block to grab runner!`);
                    
                    // Apply small slow-down to blocker (he got swim-moved)
                    blocker.stunnedTicks = 10;
                    
                    // We process the "win_B" logic below
                }
            }
        }

        // 3. Stats Calculation (Standard Block Battle)
        const blockPower = ((blocker.blocking || 50) + (blocker.strength || 50)) * blocker.fatigueModifier;
        const shedPower = ((defender.blockShedding || 50) + (defender.strength || 50)) * defender.fatigueModifier;

        // 4. Physics Push (The "Trenches")
        const pushAmount = resolveBattle(blockPower, shedPower, battle);

        if (battle.status === 'ongoing') {
            const dx = defender.x - blocker.x;
            const dy = defender.y - blocker.y;
            const dist = Math.max(0.1, Math.sqrt(dx * dx + dy * dy));
            
            // Standardize push vector
            const pushX = (dx / dist) * pushAmount * 0.5;
            const pushY = (dy / dist) * pushAmount * 0.5;

            blocker.x += pushX; blocker.y += pushY;
            defender.x += pushX; defender.y += pushY;
        }

        // 5. Resolution
        if (battle.status === 'win_B') { // Defender Sheds
            blocker.engagedWith = null; blocker.isEngaged = false;
            blocker.stunnedTicks = 15; // Blocker loses balance

            defender.stunnedTicks = 0; // Ready immediately
            defender.isBlocked = false; defender.blockedBy = null; defender.isEngaged = false;
            defender.action = 'pursuit'; 

            battlesToRemove.push(index);
        } else if (battle.status === 'win_A') { // Pancake
            defender.stunnedTicks = 40; // Knocked down
            blocker.engagedWith = null; blocker.isEngaged = false;
            defender.isBlocked = false; defender.blockedBy = null; defender.isEngaged = false;
            battlesToRemove.push(index);
        }
    });

    for (let i = battlesToRemove.length - 1; i >= 0; i--) {
        playState.blockBattles.splice(battlesToRemove[i], 1);
    }
}

/**
 * Handles QB decision-making.
 * TUNED: Slower "Internal Clock" to allow deep routes to develop.
 */
function updateQBDecision(playState, offenseStates, defenseStates, gameLog, aiTickMultiplier = 1) {
    const qbState = offenseStates.find(p => p.slot === 'QB1');
    if (!qbState || !qbState.hasBall || playState.ballState.inAir) return;
    if (qbState.isBallCarrier) return;

    const qbPlayer = getPlayer(qbState.id);
    if (!qbPlayer || !qbPlayer.attributes) return;

    const qbAttrs = qbPlayer.attributes;
    const qbIQ = Math.max(20, Math.min(99, qbAttrs.mental?.playbookIQ ?? 50));
    const qbAgility = qbAttrs.physical?.agility || 50;
    const qbStrength = qbAttrs.physical?.strength || 50;
    const qbAcc = qbAttrs.technical?.throwingAccuracy || 50;

    const progression = Array.isArray(qbState.readProgression) && qbState.readProgression.length > 0
        ? qbState.readProgression
        : ['WR1', 'WR2', 'RB1', 'WR3'];

    // --- 1. Helper: Get Target Info (Lane Logic Included) ---
    const getTargetInfo = (slot) => {
        if (!slot) return null;
        const recState = offenseStates.find(r => r.slot === slot && (r.action.includes('route') || r.action === 'idle'));
        if (!recState) return null;

        const distFromQB = getDistance(qbState, recState);
        let minSeparation = 100;
        const isRunning = recState.action === 'run_route';

        defenseStates.forEach(d => {
            if (!d.isBlocked && !d.isEngaged && d.stunnedTicks === 0) {
                let dist = getDistance(recState, d);

                // Undercut Check
                const distDefenderToQB = getDistance(qbState, d);
                if (distDefenderToQB < distFromQB - 1.0) {
                    const area = Math.abs((d.x - qbState.x) * (recState.y - qbState.y) - (d.y - qbState.y) * (recState.x - qbState.x));
                    const distToLane = area / distFromQB;
                    if (distToLane < 1.5) dist = 0.0; // BLOCKED
                }

                // Trailing Bonus (Defender is behind receiver)
                if (isRunning && d.y < recState.y - 1.0 && dist > 0.1) {
                    dist += 1.5; // Increased bonus so QB trusts deep speed more
                }

                if (dist < minSeparation) minSeparation = dist;
            }
        });

        return { state: recState, separation: minSeparation, distFromQB };
    };

    // --- 2. Assess Pressure ---
    const pressureDefender = defenseStates.find(d => !d.isBlocked && !d.isEngaged && getDistance(qbState, d) < 4.5);
    const isPressured = !!pressureDefender;
    const imminentSackDefender = isPressured && getDistance(qbState, pressureDefender) < 1.8;

    // --- 3. Update Read Progression (SLOWED DOWN) ---
    const isPrimaryRead = qbState.currentReadTargetSlot === progression[0];
    let requiredTimeOnRead;

    if (isPrimaryRead) {
        // Primary Read: 60 Ticks = 3.0 Seconds. 
        // Allows deep posts/corners to actually break.
        requiredTimeOnRead = 60;
    } else {
        // Secondary Read: 25-35 Ticks (~1.5 Seconds)
        // High IQ scans slightly faster, but not instant.
        requiredTimeOnRead = Math.max(25, 45 - Math.round(qbIQ / 5));
    }

    // 💡 ENHANCED 1.2: Remove hesitation on marginal reads
    // "Almost open" receivers should be thrown to or progression advanced, not stared at

    // Pressure speeds up processing, but not drastically
    if (isPressured) requiredTimeOnRead = Math.round(requiredTimeOnRead * 0.7);

    qbState.ticksOnCurrentRead = (qbState.ticksOnCurrentRead || 0) + 1;

    if (!imminentSackDefender && qbState.ticksOnCurrentRead > requiredTimeOnRead) {
        const currIdx = progression.indexOf(qbState.currentReadTargetSlot);
        if (currIdx < progression.length - 1) {
            const nextIdx = currIdx + 1;
            qbState.currentReadTargetSlot = progression[nextIdx];
            qbState.ticksOnCurrentRead = 0;
        }
    }

    // --- 4. Decision Logic ---
    const maxDecisionTimeTicks = 160;

    // 💡 FIX: Enforce Minimum Dropback Time
    // Don't throw scheduled reads until tick 35 (~1.75s) unless pressured.
    const MIN_DROPBACK_TICKS = 35;
    const canThrowStandard = playState.tick > MIN_DROPBACK_TICKS;

    let decisionMade = false;
    let reason = "";

    if (imminentSackDefender) {
        decisionMade = true;
        reason = "Imminent Sack";
    } else if (playState.tick >= maxDecisionTimeTicks) {
        decisionMade = true;
        reason = "Time Expired";
    } else if (isPressured && playState.tick >= 50) {
        const panicChance = Math.max(0.05, 0.4 - qbIQ / 200);
        if (Math.random() < panicChance) {
            decisionMade = true;
            reason = "Pressure Panic";
        }
    }

    // --- 5. Execute Decision ---
    let targetPlayerState = null;
    let actionTaken = "None";

    const currentReadInfoResults = getTargetInfo(qbState.currentReadTargetSlot);

    // 💡 ENHANCED 1.1: Validate checkdown receiver is actually running a route
    // Don't throw to RB if they're pass-blocking instead of running checkdown
    const rawCheckdownSlot = progression[progression.length - 1];
    const checkdownRecState = offenseStates.find(r => r.slot === rawCheckdownSlot);
    const checkdownInfo = (checkdownRecState && (checkdownRecState.action.includes('route') || checkdownRecState.action === 'idle'))
        ? getTargetInfo(rawCheckdownSlot)
        : null; // Checkdown not available if blocking

    const OPEN_SEP = isPressured ? 0.8 : 1.2;
    const CHECKDOWN_SEP = 1.0;

    const openLane = !defenseStates.some(d =>
        !d.isBlocked && !d.isEngaged &&
        Math.abs(d.x - qbState.x) < 3.5 && (d.y < qbState.y + 1)
    );

    const canScramble = openLane && (isPressured || playState.tick > 80) && (Math.random() < (qbAgility / 100));

    // 1. Is Current Read Open? (AND have we finished dropping back?)
    // 💡 ENHANCED 2.3: Skip blocked/undercut reads (separation == 0)
    if (currentReadInfoResults && currentReadInfoResults.separation > OPEN_SEP && currentReadInfoResults.separation > 0 && (canThrowStandard || isPressured)) {
        targetPlayerState = currentReadInfoResults.state;
        actionTaken = "Throw Read";
        decisionMade = true;
    }
    // 2. Checkdown
    // 💡 ENHANCED 3.2: Natural checkdown timing - always available after 50 ticks
    else if (checkdownInfo && checkdownInfo.separation > CHECKDOWN_SEP && (playState.tick > 50 || isPressured) && canThrowStandard) {
        targetPlayerState = checkdownInfo.state;
        actionTaken = "Throw Checkdown";
        decisionMade = true;
    }
    // 3. Scramble?
    // 💡 ENHANCED 1.3: Allow QB to check receivers while scrambling
    else if (canScramble && !targetPlayerState && decisionMade) {
        actionTaken = "Scramble";
    }
    // 4. Forced Actions
    else if (decisionMade) {
        if (reason === "Imminent Sack") {
            const desperationTarget = offenseStates
                .filter(o => o.action.includes('route'))
                .sort((a, b) => {
                    const sA = getTargetInfo(a.slot)?.separation || 0;
                    const sB = getTargetInfo(b.slot)?.separation || 0;
                    return sB - sA;
                })[0];

            // Low chance to make a hero throw, mostly throw away
            if (desperationTarget && Math.random() > 0.2 && qbAttrs.mental?.clutch > 60) {
                targetPlayerState = desperationTarget;
                actionTaken = "Forced Throw";
            } else {
                actionTaken = "Throw Away";
            }
        } else {
            actionTaken = "Throw Away";
        }
    }

    // --- EXECUTE ---
    if (actionTaken === "Scramble") {
        qbState.action = 'qb_scramble';
        qbState.scrambleDirection = 0;
        qbState.hasBall = false;
        qbState.isBallCarrier = true;
        playState.ballState.x = qbState.x;
        playState.ballState.y = qbState.y;
        if (gameLog) gameLog.push(`🏃 ${qbState.name} takes off running!`);
        return;
    }
    else if (actionTaken === "Throw Away") {
        if (gameLog) gameLog.push(`👋 ${qbState.name} throws it away.`);
        playState.incomplete = true;
        playState.playIsLive = false;
        playState.ballState.inAir = false;
        playState.ballState.throwInitiated = true;
        playState.ballState.throwerId = qbState.id;
        return;
    }
    else if (targetPlayerState && actionTaken.includes("Throw")) {
        if (gameLog) gameLog.push(`🏈 ${qbState.name} throws to ${targetPlayerState.name} (${actionTaken})...`);

        const velocity = 20 + (qbStrength / 4);
        const rawDist = getDistance(qbState, targetPlayerState);
        const airTime = Math.max(0.4, rawDist / velocity);

        let aimX = targetPlayerState.x;
        let aimY = targetPlayerState.y;

        if (targetPlayerState.action.includes('route')) {
            const recSpeedYPS = (targetPlayerState.speed / 100) * 8.0;
            const destDx = targetPlayerState.targetX - targetPlayerState.x;
            const destDy = targetPlayerState.targetY - targetPlayerState.y;
            const destDist = Math.sqrt(destDx * destDx + destDy * destDy);

            if (destDist > 0.1) {
                const leadFactor = 0.85;
                const normX = destDx / destDist;
                const normY = destDy / destDist;
                aimX += (normX * recSpeedYPS * airTime * leadFactor);
                aimY += (normY * recSpeedYPS * airTime * leadFactor);
            }
        }

        const accPenalty = (100 - qbAcc) / 20;
        const pressurePenalty = isPressured ? 2.0 : 1.0;
        const forcedPenalty = actionTaken === "Forced Throw" ? 3.0 : 1.0;
        const maxError = (rawDist / 18) * accPenalty * pressurePenalty * forcedPenalty;

        const angle = Math.random() * Math.PI * 2;
        const errDist = Math.random() * maxError;
        aimX += Math.cos(angle) * errDist;
        aimY += Math.sin(angle) * errDist;

        aimX = Math.max(1, Math.min(FIELD_WIDTH - 1, aimX));
        aimY = Math.max(1, Math.min(FIELD_LENGTH - 1, aimY));

        playState.ballState.inAir = true;
        playState.ballState.throwInitiated = true;
        playState.ballState.throwTick = playState.tick;
        playState.ballState.throwerId = qbState.id;
        playState.ballState.targetPlayerId = targetPlayerState.id;
        playState.ballState.targetX = aimX;
        playState.ballState.targetY = aimY;

        const finalDx = aimX - qbState.x;
        const finalDy = aimY - qbState.y;
        const finalDist = Math.sqrt(finalDx * finalDx + finalDy * finalDy);
        const finalAirTime = finalDist / velocity;

        playState.ballState.vx = finalDx / finalAirTime;
        playState.ballState.vy = finalDy / finalAirTime;
        playState.ballState.vz = (9.8 * finalAirTime) / 2;
        playState.ballState.x = qbState.x;
        playState.ballState.y = qbState.y;

        qbState.hasBall = false;
        qbState.isBallCarrier = false;
    }

    // --- 6. Setup Movement (Drift) ---
    if (qbState.action === 'qb_setup' && !decisionMade) {
        if (isPressured) {
            const pressureDirX = Math.sign(qbState.x - pressureDefender.x);
            qbState.targetX = qbState.x + pressureDirX * 1.5;
            qbState.targetY = qbState.y - 0.5;
        } else {
            // Slow drift back
            if (playState.tick < 60) {
                qbState.targetY = qbState.initialY - 3;
            } else {
                qbState.targetY = qbState.initialY - 1.5;
            }
        }
    }
}

/**
 * Handles Punter decision-making (timing the kick).
 * This runs INSTEAD of updateQBDecision on punt plays.
 */
function updatePunterDecision(playState, offenseStates, gameLog) {
    // 💡 FIX: Relaxed find condition. If action is punt_kick, he's the punter.
    // We rely on action, not just hasBall, to ensure we find him.
    const punterState = offenseStates.find(p => p.action === 'punt_kick');

    if (!punterState) return;
    if (!punterState.hasBall) return; // If he lost the ball (fumble), stop.

    const KICK_TICK = 50; // 2.5 seconds

    if (playState.tick < KICK_TICK) {
        // Freeze him in place (charging up)
        punterState.targetX = punterState.x;
        punterState.targetY = punterState.y;
        return;
    }

    if (playState.tick >= KICK_TICK) { // Execute once
        if (gameLog) gameLog.push(`🏈 ${punterState.name} punts the ball!`);

        const pPlayer = getPlayer(punterState.id);
        const strength = pPlayer?.attributes?.physical?.strength || 50;

        // Calculate Kick
        const baseDist = 35 + (strength * 0.4); // 35 to 75 yards
        const distance = baseDist + getRandomInt(-5, 5);
        const hangTime = 3.0 + (strength / 50); // Seconds

        const aimX = CENTER_X + getRandomInt(-5, 5);
        const aimY = punterState.y + distance; // Punting UP field

        const clampedAimY = Math.min(FIELD_LENGTH - 5, aimY); // Don't kick out of stadium

        const dx = aimX - punterState.x;
        const dy = clampedAimY - punterState.y;

        // 💡 FIX: Use hangTime (Seconds) for velocity, NOT airTicks.
        // This calculates Yards Per Second.
        playState.ballState.vx = dx / hangTime;
        playState.ballState.vy = dy / hangTime;

        // Vertical velocity (Z)
        playState.ballState.vz = (9.8 * hangTime) / 2;

        playState.ballState.inAir = true;
        playState.ballState.throwerId = punterState.id;
        playState.ballState.targetX = aimX;
        playState.ballState.targetY = clampedAimY;

        // Release Ball
        punterState.hasBall = false;
        punterState.isBallCarrier = false;
        punterState.action = 'idle'; // Done
    }
}
/**
 * Handles ball arrival at target coordinates. (MODIFIED)
 */
function handleBallArrival(playState, gameLog, play) {
    // --- 💡 FIX: UPDATED PUNT CATCH LOGIC ---
    if (play.type === 'punt' && playState.ballState.inAir && playState.ballState.targetPlayerId === null) {
        // If ball is too high, they can't catch it yet (wait for it to come down)
        if (playState.ballState.z > 3.0) return;

        // If it already hit the ground (z <= 0), the tick loop handles the "Downed" logic.
        if (playState.ballState.z <= 0.1) return;

        const CATCH_CHECK_RADIUS = 4.0; // Slightly generous radius to ensure pickup
        const ballPos = playState.ballState;

        // Find all *defenders* (returners) in range
        // 💡 FIX: Removed "p.action === 'punt_return'" check. 
        // Any unblocked defender near the landing spot should try to catch it.
        const returnersInRange = playState.activePlayers.filter(p =>
            !p.isOffense &&
            !p.isEngaged &&
            p.stunnedTicks === 0 &&
            getDistance(p, ballPos) < CATCH_CHECK_RADIUS
        );

        if (returnersInRange.length === 0) {
            // No returner is close enough yet. Let it keep flying/falling.
            if (gameLog) gameLog.push(`🔍 DEBUG: returnersInRange=0 at z=${(playState.ballState.z || 0).toFixed(1)} targetY=${(playState.ballState.targetY || 0).toFixed(1)}`);
            return;
        }

        // Find the closest returner to the ball
        const returnerState = returnersInRange.sort((a, b) => getDistance(a, ballPos) - getDistance(b, ballPos))[0];
        const returnerPlayer = getPlayer(returnerState.id); // Helper to get full object

        if (!returnerPlayer) {
            if (gameLog) gameLog.push(`🔍 DEBUG: returnerState found but player object missing (id=${returnerState && returnerState.id})`);
            return;
        }

        // Check for a muff
        const catchingHands = returnerPlayer.attributes?.technical?.catchingHands || 50;
        // 5% base muff chance + up to 15% more if hands are bad
        const muffChance = 0.05 + (1 - (catchingHands / 100)) * 0.15;

        if (Math.random() < muffChance) {
            // --- MUFFED PUNT! ---
            if (gameLog) gameLog.push(`❗ MUFFED PUNT! ${returnerState.name} drops it!`);

            playState.ballState.isLoose = true;
            playState.ballState.inAir = false;
            playState.ballState.z = 0.1; // Drops to ground

            // Bounce the ball slightly
            playState.ballState.vx = (Math.random() - 0.5) * 5;
            playState.ballState.vy = (Math.random() - 0.5) * 5;

            returnerState.stunnedTicks = 30; // Fumble recovery delay for the dropper
        } else {
            // --- CATCH SUCCESSFUL ---
            if (gameLog) gameLog.push(`🏈 Punt caught by ${returnerState.name}.`);
            if (gameLog) gameLog.push(`🔍 DEBUG: returner chosen id=${returnerState.id} dist=${getDistance(returnerState, ballPos).toFixed(2)}`);

            // 💡 FIX: Explicitly set play state to live/turnover
            playState.turnover = true;
            playState.ballState.inAir = false;
            playState.ballState.isLoose = false;


            // Assign ball carrier
            returnerState.isBallCarrier = true;
            returnerState.hasBall = true;
            returnerState.action = 'run_path'; // Start running!
            playState.returnStartY = returnerState.y;

            // Snap ball to player
            playState.ballState.x = returnerState.x;
            playState.ballState.y = returnerState.y;
            playState.ballState.z = 1.0;

            // Update everyone else's AI
            playState.activePlayers.forEach(p => {
                p.hasBall = (p.id === returnerState.id);
                p.isBallCarrier = (p.id === returnerState.id);

                if (p.isOffense) {
                    p.action = 'pursuit'; // Gunners now tackle
                } else if (p.id !== returnerState.id) {
                    p.action = 'run_block'; // Teammates now block
                    // Assign blocks for return team
                    // Find nearest gunner to block
                    const nearestEnemy = playState.activePlayers
                        .filter(e => e.isOffense && getDistance(p, e) < 15)
                        .sort((a, b) => getDistance(p, a) - getDistance(p, b))[0];

                    if (nearestEnemy) p.dynamicTargetId = nearestEnemy.id;
                }
            });
        }
        return; // Punt event resolved
    }
    // --- END PUNT LOGIC ---
    // --- 💡 END: NEW PUNT CATCH LOGIC ---
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
            // 💡 FIX: Significantly increase penalty if receiver is there (Contested catch != Free INT)
            receiverPresencePenalty = ((recCatchSkill * 0.5 + recStrength * 0.2) * targetPlayerState.fatigueModifier) * 1.5;
        }

        const distToBallDef = getDistance(closestDefenderState, playState.ballState);
        const proximityBonus = Math.max(0, (CATCH_CHECK_RADIUS - distToBallDef) * 20);
        defenderPower += proximityBonus - receiverPresencePenalty;

        const precisionBonus = Math.max(0, (1.5 - distToBallDef) * 15);

        // 💡 FIX: Raised Threshold from 75 -> 92. 
        // It now requires great positioning + great hands to INT a contested ball.
        if ((defenderPower + precisionBonus + getRandomInt(0, 35)) > 92) {
            eventResolved = true;
            if (gameLog) gameLog.push(`❗ INTERCEPTION! ${closestDefenderState.name} jumps the route!`);
            playState.turnover = true;
            playState.returnStartY = closestDefenderState.y;

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
                // Track drop stat for receiver
                if (receiverPlayer) {
                    ensureStats(receiverPlayer);
                    receiverPlayer.gameStats.drops = (receiverPlayer.gameStats.drops || 0) + 1;
                }
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
            // Passing
            passAttempts: 0, passCompletions: 0, passYards: 0, interceptionsThrown: 0,
            // Rushing
            rushAttempts: 0, rushYards: 0,
            // Receiving
            receptions: 0, recYards: 0, targets: 0, drops: 0,
            // Defense / Special Teams
            tackles: 0, sacks: 0, interceptions: 0, fumbles: 0, fumblesLost: 0, fumblesRecovered: 0, returnYards: 0,
            // Scoring
            touchdowns: 0
        };
    }
};
/**
 * Checks for and resolves "soft" collisions between all active players.
 * This prevents players from running on top of each other.
 */
function resolvePlayerCollisions(playState) {
    const players = playState.activePlayers;
    // 💡 TUNING: Slightly smaller radius for physics than visuals prevents "velcro" effect
    const playerRadius = PLAYER_SEPARATION_RADIUS * 0.85;

    for (let i = 0; i < players.length; i++) {
        const p1 = players[i];

        for (let j = i + 1; j < players.length; j++) {
            const p2 = players[j];

            // Skip players who are effectively "locked" together in gameplay events
            if (p1.engagedWith === p2.id || p2.engagedWith === p1.id ||
                p1.stunnedTicks > 0 || p2.stunnedTicks > 0) {
                continue;
            }

            let dx = p1.x - p2.x;
            let dy = p1.y - p2.y;
            let dist = Math.sqrt(dx * dx + dy * dy);

            // Prevent division by zero
            if (dist < 0.05) { dx = 0.1; dist = 0.1; }

            if (dist < playerRadius) {
                // Calculate push force (softer = less stutter)
                const overlap = playerRadius - dist;
                const pushFactor = 0.4; // Only resolve 40% of overlap per tick (Smooths movement)

                const pushX = (dx / dist) * overlap * pushFactor;
                const pushY = (dy / dist) * overlap * pushFactor;

                // 💡 MASS WEIGHTING: Linemen are harder to push than WRs
                const p1Weight = p1.weight || 200;
                const p2Weight = p2.weight || 200;
                const totalWeight = p1Weight + p2Weight;

                const p1Ratio = p2Weight / totalWeight; // Heavier p2 pushes p1 more
                const p2Ratio = p1Weight / totalWeight;

                // Apply soft push
                p1.x += pushX * p1Ratio;
                p1.y += pushY * p1Ratio;
                p2.x -= pushX * p2Ratio;
                p2.y -= pushY * p2Ratio;
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

    const qbPlayer = throwerState ? game.players.find(p => p && p.id === throwerState.id) : null;
    const carrierPlayer = carrierState ? game.players.find(p => p && p.id === carrierState.id) : null;
    const receiverPlayer = receiverState ? game.players.find(p => p && p.id === receiverState.id) : null;

    // --- 2. Ensure stats objects exist ---
    ensureStats(qbPlayer);
    ensureStats(carrierPlayer);
    ensureStats(receiverPlayer);

    // --- 3. Handle Pass Attempt Stats ---
    if (qbPlayer && playState.ballState.throwInitiated) {
        qbPlayer.gameStats.passAttempts++;

        // Track Target
        if (receiverPlayer) {
            receiverPlayer.gameStats.targets = (receiverPlayer.gameStats.targets || 0) + 1;
        }
    }

    // --- 4. Handle Sack (Negative Rush Yards for QB) ---
    if (playState.sack && carrierPlayer) {
        // In this game engine, Sacks count as negative QB Rushing yards (NCAA style rules)
        // We do NOT increment rushAttempts here to avoid skewing "Carries" with sacks,
        // unless you strictly follow NCAA rules where a sack is a rush attempt. 
        // For gameplay clarity, we usually keep them separate.
        carrierPlayer.gameStats.rushYards += Math.round(playState.yards);
        return; // Sack ends the stat processing for this play
    }

    // --- 5. Handle Play Result ---
    const isTouchdown = playState.touchdown;
    const finalYards = Math.round(playState.yards);

    if (playState.incomplete) {
        // Track Drop? (Optional)
        // if (playState.wasDrop && receiverPlayer) receiverPlayer.gameStats.drops++;
    } else if (carrierPlayer) {

        // --- A. Offensive Passing Play ---
        const wasPassCaught = carrierState.id === receiverState?.id && playState.ballState.throwInitiated;

        if (wasPassCaught && receiverPlayer) {
            receiverPlayer.gameStats.receptions++;
            receiverPlayer.gameStats.recYards += finalYards;
            if (isTouchdown) receiverPlayer.gameStats.touchdowns++;

            if (qbPlayer) {
                qbPlayer.gameStats.passCompletions++;
                qbPlayer.gameStats.passYards += finalYards;
                if (isTouchdown) qbPlayer.gameStats.touchdowns++;
            }
        }
        // --- B. Offensive Rushing Play ---
        else if (carrierState.isOffense) {
            carrierPlayer.gameStats.rushAttempts++; // <--- 💡 FIX: Track Carries
            carrierPlayer.gameStats.rushYards += finalYards;
            if (isTouchdown) carrierPlayer.gameStats.touchdowns++;
        }
        // --- C. Defensive/Special Teams Return (INT, Punt, Fumble) ---
        else if (!carrierState.isOffense) {
            if (isTouchdown) {
                carrierPlayer.gameStats.touchdowns++;
            }

            // Calculate Return Yards
            // Return Yards = |End Y - Start Y|
            if (playState.returnStartY !== null) {
                const returnYards = Math.round(Math.abs(carrierState.y - playState.returnStartY));
                carrierPlayer.gameStats.returnYards += returnYards;
            }

            // If it was an INT, credit the thrower with an INT thrown
            if (playState.turnover && qbPlayer && playState.ballState.throwInitiated) {
                qbPlayer.gameStats.interceptionsThrown++;
            }

            // --- 💡 FIX: Credit the Defender with the INT ---
            // If it was a pass play, and it was a turnover, the carrier (defender) gets an INT.
            if (playState.turnover && playState.ballState.throwInitiated) {
                carrierPlayer.gameStats.interceptions++;
            }
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
        playIsLive: true, tick: 0, maxTicks: 1000,
        type: type,                // <--- ADD THIS LINE
        assignments: assignments,  // <--- ADD THIS LINE
        yards: 0, touchdown: false, turnover: false, incomplete: false, sack: false, safety: false,
        finalBallY: 0,
        touchback: false,
        returnStartY: null,
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

        // 💡 ENHANCED 2.2: Check if RB would be open hot route before assigning block
        const rbState = playState.activePlayers.find(p => p.slot === 'RB1' && p.isOffense);
        const rbWouldBeOpen = rbState && qbState && getDistance(rbState, qbState) < 5.0;

        if (!rbWouldBeOpen || Math.random() < 0.4) {
            // RB not open, or small chance to block anyway - keep in to block
            play.assignments['RB1'] = 'pass_block';
            assignments = play.assignments;

            // Find the player state object to update
            // We use 'let' or 'const' inside this block, and USE it inside this block.
            const rbPlayer = playState.activePlayers.find(p => p.slot === 'RB1' && p.isOffense);

            if (gameLog) {
                gameLog.push(`[Pre-Snap]: 🧠 ${qbPlayer?.name || 'QB'} sees the blitz and keeps ${rbPlayer?.name || 'RB'} in to block!`);
            }

            // 💡 FIX: Apply changes HERE, inside the scope where rbPlayer exists
            if (rbPlayer) {
                rbPlayer.assignment = 'pass_block';
                rbPlayer.action = 'pass_block';
                rbPlayer.targetX = rbPlayer.initialX;
                rbPlayer.targetY = rbPlayer.initialY - 0.5;
            }

        } else if (gameLog) {
            gameLog.push(`[Pre-Snap]: 🧠 ${qbPlayer?.name || 'QB'} sees the blitz but RB would be open as hot route!`);
        }
    }


    // Patched TICK LOOP snippet
    // Replaces the original tick loop. This patch adds defensive guards, fixes undefined
    // references (ballPos, type, assignments, firstDownY), corrects TD/safety logic,
    // clamps ball z, and makes some function calls safe (existence checks).

    // --- 3. TICK LOOP (PATCHED) ---
    let ballCarrierState = null;
    try {
        const timeDelta = fastSim ? TICK_DURATION_SECONDS * 10 : TICK_DURATION_SECONDS;

        // Local fallbacks to avoid ReferenceErrors if outer-scope vars are missing
        const loopType = playState.type || playState.playType || 'pass';
        const assignmentsLocal = playState.assignments ?? (typeof assignments !== 'undefined' ? assignments : {});

        while (playState.playIsLive && playState.tick < playState.maxTicks) {
            playState.tick++;

            // --- local convenience references ---
            const ballPos = playState.ballState || { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, inAir: false, targetX: 0, targetY: 0, isLoose: false };

            const offenseStates = playState.activePlayers.filter(p => p?.isOffense);
            const defenseStates = playState.activePlayers.filter(p => !p?.isOffense);

            // --- START FIX: Robustly identify the current ball carrier ---
            let currentBallCarrier = playState.activePlayers.find(p => p?.hasBall && p.isOffense);
            if (!currentBallCarrier) {
                currentBallCarrier = playState.activePlayers.find(p => p?.isBallCarrier && p.isOffense);
            }
            // Update the main variable to the most reliable state
            ballCarrierState = currentBallCarrier || null;

            // --- STEP 1: QB / Punter Logic (Decide Throw/Scramble) ---
            if (playState.playIsLive && !ballPos.inAir && !playState.turnover && !playState.sack) {
                if (loopType === 'pass') {
                    if (typeof updateQBDecision === 'function') updateQBDecision(playState, offenseStates, defenseStates, gameLog);
                } else if (loopType === 'punt' && !ballPos.isLoose) {
                    if (typeof updatePunterDecision === 'function') updatePunterDecision(playState, offenseStates, gameLog);
                }
            }
            if (!playState.playIsLive) break; // Play ended (e.g., QB threw away)

            // --- STEP 2: Update Player Intentions/Targets (AI) ---
            if (typeof updatePlayerTargets === 'function') {
                updatePlayerTargets(playState, offenseStates, defenseStates, ballCarrierState, loopType, offensivePlayKey, assignmentsLocal, defensivePlayKey, gameLog);
            }

            // --- STEP 3: Update Player Positions (Movement) ---
            playState.activePlayers.forEach(p => { try { updatePlayerPosition(p, timeDelta); } catch (e) { /* ignore per-player movement error */ } });

            // --- STEP 4: Update Ball Position ---
            ballCarrierState = playState.activePlayers.find(p => p?.isBallCarrier) || null;
            if (ballPos.inAir) {
                ballPos.x += (ballPos.vx || 0) * timeDelta;
                ballPos.y += (ballPos.vy || 0) * timeDelta;
                ballPos.z += (ballPos.vz || 0) * timeDelta;
                ballPos.vz = (ballPos.vz || 0) - 9.8 * timeDelta; // Apply gravity
                if (ballPos.z < 0) {
                    ballPos.z = 0; // clamp ground
                    ballPos.vz = 0;
                }
            } else if (ballCarrierState) {
                // If a player carries it, snap to player's feet
                ballPos.x = ballCarrierState.x;
                ballPos.y = ballCarrierState.y;
                ballPos.z = 0.5;
            }

            // --- STEP 5: Resolve "Nudge" Collisions ---
            if (typeof resolvePlayerCollisions === 'function') resolvePlayerCollisions(playState);

            // --- STEP 6: Check Ball Carrier End Conditions (TD, OOB, Safety) ---
            if (playState.playIsLive) {
                // Re-find the ball carrier to ensure we have the absolute latest state
                ballCarrierState = playState.activePlayers.find(p => p?.isBallCarrier) || null;

                // Defensive/Offensive endzone thresholds
                const offenseEndzoneY = FIELD_LENGTH - 10; // offense's scoring line (e.g., 100)
                const defenseEndzoneY = 10; // defensive (own) endzone threshold

                if (ballCarrierState) {
                    // OFFENSIVE TOUCHDOWN: an offensive player crosses offense endzone line
                    if (ballCarrierState.isOffense && ballCarrierState.y >= offenseEndzoneY - 0.1) {
                        playState.yards = ballCarrierState.y - playState.lineOfScrimmage;
                        playState.finalBallY = ballCarrierState.y;
                        playState.touchdown = true;
                        playState.playIsLive = false;
                        const scorer = (game && game.players) ? game.players.find(p => p && p.id === ballCarrierState.id) : null;
                        if (gameLog) gameLog.push(`🎉 TOUCHDOWN ${scorer?.name || ballCarrierState.name || 'player'}!`);
                        break;
                    }

                    // DEFENSIVE TOUCHDOWN: a defensive player returns ball into the OPPONENT endzone (offenseEndzoneY)
                    if (!ballCarrierState.isOffense && ballCarrierState.y <= defenseEndzoneY + 0.1) {
                        playState.yards = 0; // Yards are calculated differently for returns
                        playState.finalBallY = ballCarrierState.y;
                        playState.touchdown = true;
                        playState.playIsLive = false;

                        const scorer = (game && game.players) ? game.players.find(p => p && p.id === ballCarrierState.id) : null;
                        if (gameLog) gameLog.push(`🎉 DEFENSIVE TOUCHDOWN! ${scorer?.name || ballCarrierState.name || 'player'} returns it for a score!`);
                        break;
                    }

                    // SAFETY: offensive player tackled in their own endzone (y <= defenseEndzoneY)
                    if (ballCarrierState.isOffense && ballCarrierState.y <= defenseEndzoneY + 0.1) {
                        playState.yards = 0;
                        playState.finalBallY = ballCarrierState.y;
                        playState.safety = true;
                        playState.playIsLive = false;
                        if (gameLog) gameLog.push(`SAFETY! ${ballCarrierState.name || 'player'} was tackled in the endzone!`);
                        break;
                    }

                    // Out of Bounds (Side or End Zone)
                    if (ballCarrierState.x <= 0.1 || ballCarrierState.x >= FIELD_WIDTH - 0.1) {
                        playState.yards = ballCarrierState.y - playState.lineOfScrimmage;
                        playState.finalBallY = ballCarrierState.y;
                        playState.playIsLive = false;
                        if (gameLog) gameLog.push(`${ballCarrierState.name || 'player'} ran out of bounds after a gain of ${playState.yards.toFixed(1)} yards.`);
                        break;
                    }
                }
            }

            // --- STEP 7: Check Collisions & Resolve Catches/Incompletions ---
            if (playState.playIsLive) {
                // A. Check for new block engagements (guard with function existence)
                if (typeof checkBlockCollisions === 'function') checkBlockCollisions(playState);

                // B. Check for tackles
                ballCarrierState = playState.activePlayers.find(p => p?.isBallCarrier) || null;
                if (ballCarrierState) {
                    if (typeof checkTackleCollisions === 'function' && checkTackleCollisions(playState, gameLog)) {
                        // Ensure final ball Y is captured from the carrier's latest position
                        playState.finalBallY = ballCarrierState.y;
                        break;
                    }
                }

                // --- FUMBLE RECOVERY LOGIC ---
                if (playState.ballState?.isLoose) {
                    if (typeof checkFumbleRecovery === 'function') {
                        const recoverer = checkFumbleRecovery(playState, gameLog, TACKLE_RANGE);
                        if (recoverer) {
                            // Clear old ball flags
                            playState.activePlayers.forEach(p => { if (p) { p.isBallCarrier = false; p.hasBall = false; } });

                            // Someone recovered the ball!
                            playState.ballState.isLoose = false;
                            recoverer.isBallCarrier = true;
                            recoverer.hasBall = true;
                            recoverer.action = 'run_path';

                            if (recoverer.isOffense) {
                                // --- OFFENSE RECOVERED ---
                                playState.turnover = false;
                                if (gameLog) gameLog.push(`👍 ${recoverer.name || 'player'} recovers the fumble!`);
                                ensureStats(recoverer);
                                recoverer.gameStats.fumblesRecovered = (recoverer.gameStats.fumblesRecovered || 0) + 1;
                                playState.activePlayers.forEach(p => {
                                    if (p.isOffense && p.id !== recoverer.id) p.action = 'run_block';
                                    else if (!p.isOffense) p.action = 'pursuit';
                                });
                            } else {
                                // --- DEFENSE RECOVERED ---
                                playState.turnover = true;
                                if (gameLog) gameLog.push(`❗ ${recoverer.name || 'player'} recovers the fumble for the Defense!`);
                                ensureStats(recoverer);
                                recoverer.gameStats.fumblesRecovered = (recoverer.gameStats.fumblesRecovered || 0) + 1;
                                // Track fumbleLost for any offensive player with the ball
                                for (const p of playState.activePlayers) {
                                    if (p.isOffense && (p.isBallCarrier || p.hasBall)) {
                                        ensureStats(p);
                                        p.gameStats.fumblesLost = (p.gameStats.fumblesLost || 0) + 1;
                                    }
                                }
                                playState.activePlayers.forEach(p => {
                                    if (p.isOffense) p.action = 'pursuit';
                                    else if (p.id !== recoverer.id) p.action = 'run_block';
                                });
                            }
                        }
                    }
                }

                // C. Check for Ball Arrival (Catch/INT/Drop)
                if (ballPos.inAir) {
                    const distToTargetXY = Math.sqrt(
                        Math.pow((ballPos.x || 0) - (ballPos.targetX || 0), 2) +
                        Math.pow((ballPos.y || 0) - (ballPos.targetY || 0), 2)
                    );
                    const CATCH_ARRIVAL_RADIUS = 2.0;

                    if (distToTargetXY < CATCH_ARRIVAL_RADIUS) {
                        if (typeof handleBallArrival === 'function') handleBallArrival(playState, gameLog, play);
                        if (!playState.playIsLive) {
                            if (playState.incomplete) {
                                playState.finalBallY = ballPos.y;
                            }
                            break;
                        }
                    }

                    // E. Check for Ground / Out of Bounds (if not caught)
                    if (playState.playIsLive) {
                        if ((ballPos.z || 0) <= 0.1 && playState.tick > 6) {
                            if (loopType === 'punt') {
                                // 💡 FIX: Calculate Punt Distance and Spot
                                const distTraveled = Math.abs(ballPos.y - playState.lineOfScrimmage);
                                const distFormatted = distTraveled.toFixed(0);

                                // Calculate Yard Line (0-100 scale)
                                // Note: Punter kicks from ~20 towards 100. 
                                const finalYardLine = 100 - ballPos.y;
                                const side = finalYardLine <= 50 ? "own" : "opponent";
                                const yardNum = finalYardLine <= 50 ? Math.round(finalYardLine) : Math.round(100 - finalYardLine);

                                if (gameLog) {
                                    gameLog.push(`🏈 Punt is downed at the ${side} ${yardNum} (${distFormatted} yard punt).`);
                                }
                                playState.turnover = true;
                            } else {
                                if (gameLog) gameLog.push(`‹‹ Pass hits the ground. Incomplete.`);
                            }
                            playState.incomplete = true;
                            playState.playIsLive = false;
                            ballPos.inAir = false;
                            playState.finalBallY = ballPos.y;
                            break;
                        }

                        if ((ballPos.x || 0) <= 0.1 || (ballPos.x || 0) >= (FIELD_WIDTH - 0.1) || (ballPos.y || 0) >= (FIELD_LENGTH - 0.1) || (ballPos.y || 0) <= 0.1) {
                            if (loopType === 'punt') {
                                if ((ballPos.y || 0) >= FIELD_LENGTH - 10) { // Endzone
                                    if (gameLog) gameLog.push(`🏈 Punt sails out of the endzone. TOUCHBACK.`);
                                    playState.touchback = true;
                                } else {
                                    if (gameLog) gameLog.push(`🏈 Punt goes out of bounds.`);
                                }
                                playState.turnover = true;
                            } else {
                                if (gameLog) gameLog.push(`‹‹ Pass sails out of bounds. Incomplete.`);
                            }
                            playState.incomplete = true;
                            playState.playIsLive = false;
                            ballPos.inAir = false;
                            playState.finalBallY = ballPos.y;
                            break;
                        }
                    }
                } // --- End of if(ballPos.inAir) ---
            }
            if (!playState.playIsLive) break;

            // --- STEP 8: Resolve Ongoing Battles (Blocks) ---
            if (typeof resolveOngoingBlocks === 'function') resolveOngoingBlocks(playState, gameLog);

            // --- STEP 9: Update Fatigue ---
            playState.activePlayers.forEach(pState => {
                try {
                    if (!pState) return;
                    let fatigueGain = 0.01;
                    const action = pState.action;
                    const assignment = pState.assignment;
                    if (action === 'run_path' || action === 'qb_scramble' || action === 'run_route' ||
                        action === 'pass_rush' || action === 'blitz_gap' || action === 'blitz_edge' ||
                        action === 'pursuit' || (assignment && assignment.startsWith && assignment.startsWith('man_cover_'))) {
                        fatigueGain += 0.03;
                    } else if (action === 'pass_block' || action === 'run_block' || pState.engagedWith) {
                        fatigueGain += 0.02;
                    }
                    const player = (game && typeof game.players !== 'undefined') ? game.players.find(p => p && p.id === pState.id) : null;
                    if (player) {
                        player.fatigue = Math.min(100, (player.fatigue || 0) + fatigueGain);
                        pState.fatigue = player.fatigue;
                        const stamina = player.attributes?.physical?.stamina || 50;
                        const fatigueRatio = Math.min(1.0, (player.fatigue || 0) / stamina);
                        pState.fatigueModifier = Math.max(0.75, 1.0 - (fatigueRatio * 0.25));
                    }
                } catch (e) {
                    console.error('Per-player fatigue update error:', e);
                }
            });

            try {
                const activeIds = new Set(playState.activePlayers.map(p => p && p.id));
                const BENCH_RECOVERY_PER_TICK = 0.003;
                // Helper to recover a specific roster (only run if helper exists)
                const recoverTeam = (team) => {
                    if (!team) return;
                    if (typeof getRosterObjects === 'function') {
                        const roster = getRosterObjects(team) || [];
                        roster.forEach(p => {
                            if (!p || (p.status && p.status.duration > 0)) return;
                            if (activeIds.has(p.id)) return; // Don't recover active players here
                            if ((p.fatigue || 0) <= 0) return;
                            p.fatigue = Math.max(0, (p.fatigue || 0) - BENCH_RECOVERY_PER_TICK);
                        });
                    }
                };

                // Only process the two teams actually in the game
                recoverTeam(offense);
                recoverTeam(defense);

            } catch (err) {
                console.error('Bench recovery error:', err);
            }

            try {
                const involvedTeamIds = new Set(playState.activePlayers.filter(p => p && p.teamId).map(p => p.teamId));
                involvedTeamIds.forEach(tid => {
                    const team = (game && game.teams) ? game.teams.find(tt => tt && tt.id === tid) : null;
                    if (!team) return;

                    // ✅ IMPROVED: Now all teams (including player team) can auto-sub
                    // Run with high chance (1.0) every ~2 seconds (tick % 40)
                    // This prevents checking 20 times a second, but guarantees checks happen.
                    if (playState.tick % 40 === 0) {
                        autoMakeSubstitutions(team, { thresholdFatigue: 50, maxSubs: 2, chance: 1.0 }, gameLog);
                    }
                });
            } catch (err) {
                console.error('AI substitution error:', err);
            }

            // --- STEP 10: Record Visualization Frame ---
            if (gameLog) {
                const frameData = {
                    players: deepClone(playState.activePlayers),
                    ball: deepClone(playState.ballState || {}),
                    logIndex: gameLog.length,
                    lineOfScrimmage: playState.lineOfScrimmage,
                    firstDownY: (typeof playState.firstDownY !== 'undefined') ? playState.firstDownY : null
                };
                playState.visualizationFrames.push(frameData);
            }
        } // --- End TICK LOOP ---
    } catch (tickError) {
        console.error("CRITICAL ERROR during simulation tick loop:", tickError);
    }


    // --- 4. Finalize Results ---
    if (playState.playIsLive && !playState.touchdown && !playState.safety) {
        ballCarrierState = playState.activePlayers.find(p => p.isBallCarrier);
        if (ballCarrierState) {
            playState.yards = ballCarrierState.y - playState.lineOfScrimmage;
            playState.finalBallY = ballCarrierState.y;
            if (gameLog) gameLog.push(`⏱️ Play ends. Gain of ${playState.yards.toFixed(1)} yards.`);
        } else if (!playState.sack && !playState.turnover) {
            playState.incomplete = true;
            playState.yards = 0;
            // 💡 FIX: Reference the Ball's position at the end of the play
            playState.finalBallY = playState.ballState?.y;
            if (gameLog) gameLog.push("⏱️ Play ends, incomplete."); // Log the clean end
        } else { // Handles remaining sacks, turnovers, or unknown ends
            playState.finalBallY = ballCarrierState ? ballCarrierState.y : playState.ballState?.y;
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

    if (gameLog) {
        playState.visualizationFrames.push({
            players: deepClone(playState.activePlayers),
            ball: deepClone(playState.ballState),
            logIndex: gameLog.length, // Captures all final logs
            lineOfScrimmage: playState.lineOfScrimmage,
            firstDownY: (typeof firstDownY !== 'undefined') ? firstDownY : null
        });
    }

    return {
        yards: playState.yards,
        touchdown: playState.touchdown,
        turnover: playState.turnover,
        incomplete: playState.incomplete,
        safety: playState.safety,
        touchback: playState.touchback, // 💡 **ADD THIS**
        finalBallY: playState.finalBallY, // 💡 **ADD THIS**
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

function determinePlayCall(offense, defense, down, yardsToGo, ballOn, scoreDiff, gameLog, drivesRemaining, previousPlayAnalysis) {
    const offenseRoster = getRosterObjects(offense);
    const defenseRoster = getRosterObjects(defense);

    if (!offenseRoster || !defenseRoster || !offense?.formations?.offense || !defense?.formations?.defense) {
        console.error("determinePlayCall: Invalid team data.");
        return 'Balanced_InsideRun';
    }

    const { coach } = offense;
    const offenseFormationName = offense.formations.offense;

    // --- 1. CAPTAIN CHECK ---
    // Does the captain make the smart read, or do they panic?
    const captainIsSharp = checkCaptainDiscipline(offense, gameLog);

    // --- 2. ANALYZE MATCHUPS (Base Strategy) ---
    const getAvg = (roster, pos, attrCategory, attrKey) => {
        const players = roster.filter(p => p && (p.favoriteOffensivePosition === pos || p.favoriteDefensivePosition === pos));
        if (players.length === 0) return 50;
        const sum = players.reduce((acc, p) => acc + (p.attributes?.[attrCategory]?.[attrKey] || 50), 0);
        return sum / players.length;
    };

    const avgOLStrength = getAvg(offenseRoster, 'OL', 'physical', 'strength');
    const avgDLStrength = getAvg(defenseRoster, 'DL', 'physical', 'strength');
    const avgWRSpeed = getAvg(offenseRoster, 'WR', 'physical', 'speed');
    const avgDBSpeed = getAvg(defenseRoster, 'DB', 'physical', 'speed');

    // Advantage Calculation (> 5 is significant)
    const trenchAdvantage = avgOLStrength - avgDLStrength;
    const speedAdvantage = avgWRSpeed - avgDBSpeed;

    // --- 3. SITUATIONAL FACTORS ---
    // 0.0 = 100% Run, 1.0 = 100% Pass
    let passBias = 0.50;
    let preferredTag = null; // Forces a specific type of play (e.g., 'pa', 'screen')

    // If Captain is sharp, apply all smart logic.
    // If not, skip most of this and add random noise.
    if (captainIsSharp) {

        // A. Down & Distance
        if (down === 1) passBias = 0.45; // 1st Down: Slight run lean
        if (down === 2) {
            if (yardsToGo > 7) passBias = 0.65; // 2nd & Long: Pass
            else if (yardsToGo < 4) passBias = 0.30; // 2nd & Short: Run
        }
        if (down === 3) {
            if (yardsToGo > 6) passBias = 0.85; // 3rd & Long: Heavy Pass
            else if (yardsToGo <= 2) passBias = 0.20; // 3rd & Short: Heavy Run
            else passBias = 0.60; // 3rd & Medium
        }
        if (down === 4) {
            passBias = yardsToGo > 3 ? 0.90 : 0.40;
        }

        // B. Field Position
        if (ballOn > 90) passBias -= 0.15; // Red zone (cramped): Run more
        if (ballOn < 10) passBias -= 0.10; // Backed up: Conservative run

        // C. POSSESSION MANAGEMENT
        const isLateGame = drivesRemaining <= 2;
        const isTrailing = scoreDiff < 0;
        const isLeading = scoreDiff > 0;

        if (isLateGame) {
            if (isTrailing) {
                passBias += 0.25; // Desperation
                if (scoreDiff < -8) passBias += 0.25; // Hail Mary mode
            } else if (isLeading) {
                passBias -= 0.20; // Protect Lead
                if (scoreDiff > 8) passBias -= 0.15;
            }
        }

        // D. Matchup Adjustments
        if (trenchAdvantage > 5) passBias -= 0.10;
        if (trenchAdvantage < -5) passBias += 0.10;
        if (speedAdvantage > 5) passBias += 0.15;

        // E. ADAPTIVE REACTION (React to previous play)
        if (previousPlayAnalysis) {
            const { isSuccess, score, type } = previousPlayAnalysis;

            if (isSuccess && type === 'run') {
                if (score >= 4 && Math.random() < 0.30) {
                    passBias = 0.9;
                    preferredTag = 'pa'; // Play Action!
                    if (gameLog) gameLog.push(`🧠 Captain leverages the run game for Play Action!`);
                } else {
                    passBias -= 0.15; // Keep running
                }
            }
            else if (!isSuccess && type === 'run' && score <= -2) {
                passBias += 0.15; // TFL -> Try screen
                if (Math.random() < 0.4) preferredTag = 'screen';
            }
            else if (!isSuccess && type === 'pass' && score <= -3) {
                if (Math.random() < 0.5) {
                    passBias = 1.0;
                    preferredTag = 'quick'; // Sack -> Quick pass
                } else {
                    passBias -= 0.20; // Sack -> Draw
                }
            }
        }

        // F. Coach Personality
        if (coach.type === 'Air Raid') passBias += 0.20;
        if (coach.type === 'Ground and Pound') passBias -= 0.20;

    } else {
        // --- CAPTAIN CONFUSED ---
        // Ignore situation, pick randomly or erroneously
        passBias = 0.50 + ((Math.random() - 0.5) * 0.6); // Wild swings (+/- 30%)

        // Sometimes they do the exact opposite of what they should
        if (yardsToGo > 10 && Math.random() < 0.3) {
            passBias = 0.1; // Run on 3rd & Long?
        }
    }

    // --- 4. SELECT PLAY ---
    // Clamp bias
    passBias = Math.max(0.05, Math.min(0.95, passBias));

    // Determine Type
    let desiredType = Math.random() < passBias ? 'pass' : 'run';

    // Get Plays in Formation
    const formationPlays = Object.keys(offensivePlaybook).filter(key => key.startsWith(offenseFormationName));
    if (formationPlays.length === 0) return 'Balanced_InsideRun';

    // Filter by Type
    let pool = formationPlays.filter(key => offensivePlaybook[key].type === desiredType);
    if (pool.length === 0) {
        desiredType = desiredType === 'pass' ? 'run' : 'pass';
        pool = formationPlays.filter(key => offensivePlaybook[key].type === desiredType);
    }

    // --- 5. TAG REFINEMENT ---
    // Only apply smart tag filtering if Captain is sharp
    let refinedPool = [];

    if (captainIsSharp) {
        if (preferredTag) {
            const taggedPool = pool.filter(k => offensivePlaybook[k].tags.includes(preferredTag));
            if (taggedPool.length > 0) pool = taggedPool;
        }

        if (!preferredTag) {
            if (desiredType === 'pass') {
                if (yardsToGo > 12 || (drivesRemaining <= 2 && scoreDiff < 0)) {
                    refinedPool = pool.filter(k => offensivePlaybook[k].tags.includes('deep'));
                } else if (yardsToGo < 4) {
                    refinedPool = pool.filter(k => offensivePlaybook[k].tags.includes('short') || offensivePlaybook[k].tags.includes('quick'));
                } else {
                    refinedPool = pool.filter(k => offensivePlaybook[k].tags.includes('medium') || offensivePlaybook[k].tags.includes('screen'));
                }
            } else { // Run
                if (yardsToGo <= 2) {
                    refinedPool = pool.filter(k => offensivePlaybook[k].tags.includes('inside') || offensivePlaybook[k].tags.includes('power'));
                } else if (speedAdvantage > 5) {
                    refinedPool = pool.filter(k => offensivePlaybook[k].tags.includes('outside'));
                } else {
                    refinedPool = pool.filter(k => offensivePlaybook[k].tags.includes(trenchAdvantage > 0 ? 'inside' : 'outside'));
                }
            }
        }
    }

    // If refinement found nothing (or captain wasn't sharp), revert to base pool
    if (refinedPool.length === 0) refinedPool = pool;

    return getRandom(refinedPool) || formationPlays[0];
}

/**
 * AI (PRE-SNAP) Logic: Chooses the best defensive formation to counter
 * the offense's personnel and the current down/distance.
 * @param {object} defense - The defensive team object.
 * @param {string} offenseFormationName - The *name* of the offense's formation (e.g., "Spread").
 * @param {number} down - The current down.
 * @param {number} yardsToGo - The current yards to go.
 * @returns {string} The name of the chosen defensive formation (e.g., "2-3-2").
 */
function determineDefensiveFormation(defense, offenseFormationName, down, yardsToGo, gameLog) {
    // 1. Special Teams (Always Obvious)
    if (offenseFormationName === 'Punt') return 'Punt_Return';

    // 2. CAPTAIN CHECK
    // Does the captain recognize the offensive personnel grouping?
    const captainIsSharp = checkCaptainDiscipline(defense, gameLog);

    const offData = offenseFormations[offenseFormationName];
    const personnel = offData ? offData.personnel : { WR: 2, RB: 1 };
    const wrCount = personnel.WR || 2;
    const heavyCount = (personnel.RB || 1) + (personnel.TE || 0);
    const coachPref = defense.coach?.preferredDefense || '3-1-3';

    // --- SCENARIO A: CAPTAIN IS SHARP (Smart Counters) ---
    if (captainIsSharp) {
        
        // 1. Situational Overrides
        if (yardsToGo <= 2) return '4-2-1'; // Goal Line -> Run Stop
        if ((down === 3 && yardsToGo > 8) || (down === 4 && yardsToGo > 5)) {
            return wrCount >= 3 ? '2-3-2' : '4-1-2'; // Passing Down -> Coverage
        }

        // 4. Personnel Matching
        if (wrCount >= 4) {
            // EMPTY SET (4+ WRs) -> MUST use Dime (3-0-4)
            // Anything else is a mismatch.
            return '3-0-4';
        }

        if (wrCount === 3) {
            // SPREAD (3 WRs) -> Nickel (4-1-2) or Dime (3-0-4)
            if (coachPref === '3-0-4' || coachPref === '4-1-2') return coachPref;
            return '4-1-2'; // Default to Nickel
        } 
        
        if (heavyCount >= 2) {
            // POWER (2 RBs) -> Heavy Front
            if (coachPref === '4-2-1') return coachPref;
            return '4-2-1';
        }
        // Standard -> Coach's Base
        return coachPref;
    }

    // --- SCENARIO B: CAPTAIN IS CONFUSED (Mistakes) ---
    else {
        // Flavor text is handled inside checkCaptainDiscipline, 
        // but the consequence happens here.
        
        // 50% chance they just stick to the "Base Defense" regardless of situation
        if (Math.random() < 0.5) {
            return '3-1-3';
        }

        // 50% chance they guess randomly (Bad!)
        // This might result in a 2-3-2 Dime defense against a Goal Line run.
        const allFormations = ['3-1-3', '4-2-1', '2-3-2', '4-1-2', '4-0-3'];
        return getRandom(allFormations);
    }
}

/**
 * Determines the defensive play call based on formation, situation, and basic tendencies.
 */
function determineDefensivePlayCall(defense, offense, down, yardsToGo, ballOn, scoreDiff, gameLog, drivesRemaining) {
    const defenseFormationName = defense.formations.defense;

    // Filter playbook for plays that fit the current formation
    const availablePlays = Object.keys(defensivePlaybook).filter(key =>
        defensivePlaybook[key]?.compatibleFormations?.includes(defenseFormationName)
    );

    if (availablePlays.length === 0) {
        console.error(`No plays for ${defenseFormationName}`);
        return 'Cover_2_Zone_3-1-3'; // Emergency Fallback
    }

    // --- 1. ANALYZE OPPONENT QB ---
    const offRoster = getRosterObjects(offense);
    // Find whoever is playing QB (slot QB1 or best available)
    const qb = offRoster.find(p => p.slot === 'QB1') || offRoster.find(p => p.favoriteOffensivePosition === 'QB');

    const qbIQ = qb?.attributes?.mental?.playbookIQ || 50;
    const qbPressure = qb?.attributes?.mental?.clutch || 50;

    // --- 2. CAPTAIN CHECK ---
    const captainIsSharp = checkCaptainDiscipline(defense, gameLog);

    // --- 3. DETERMINE STRATEGY ---
    let blitzChance = 0.20; // Base 20%
    let manCoverageChance = 0.40; // Base 40% (vs Zone)

    // If Captain is sharp, apply smart logic. If not, randomize.
    if (captainIsSharp) {

        // A. The "Rookie QB" Factor
        if (qbIQ < 65 || qbPressure < 60) {
            // Bad QB? Confuse them with heavy blitzes.
            blitzChance += 0.25;
        } else if (qbIQ > 85) {
            // Elite QB? Blitzing is dangerous; they find the open man. Play coverage.
            blitzChance -= 0.15;
        }

        // B. Down & Distance Logic
        if (down === 3) {
            if (yardsToGo > 8) {
                // 3rd & Long: Zone Blitz or Safe Zone
                blitzChance += 0.10;
                manCoverageChance -= 0.20; // Prefer Zone to keep play in front
            } else if (yardsToGo < 4) {
                // 3rd & Short: Sell out for run/quick pass
                blitzChance += 0.20;
                manCoverageChance += 0.30; // Press Man
            }
        }

        // C. Game Situation (Bend Don't Break)
        const isLeadingBig = scoreDiff > 14;

        // If winning big late, stop blitzing entirely to avoid giving up a TD
        if (isLeadingBig && drivesRemaining < 4) {
            blitzChance = 0.05;
            manCoverageChance = 0.10; // Heavy Zone (Prevent)
        }

    } else {
        // --- CAPTAIN CONFUSED ---
        // Randomly guess strategy
        blitzChance = Math.random();
        manCoverageChance = Math.random();
    }

    // --- 4. FILTER & SELECT PLAY ---
    const blitzPlays = availablePlays.filter(k => defensivePlaybook[k].tags.includes('blitz'));
    const safePlays = availablePlays.filter(k => defensivePlaybook[k].tags.includes('safeZone') || defensivePlaybook[k].tags.includes('prevent'));
    const manPlays = availablePlays.filter(k => defensivePlaybook[k].concept === 'Man');
    const zonePlays = availablePlays.filter(k => defensivePlaybook[k].concept === 'Zone');

    let pool = [];

    // Decision Tree
    const isLeadingBig = scoreDiff > 14;

    if (captainIsSharp && isLeadingBig && drivesRemaining < 2) {
        // PREVENT MODE: Only safe zones
        pool = safePlays.length > 0 ? safePlays : zonePlays;
    } else if (Math.random() < blitzChance) {
        // BLITZ MODE
        pool = blitzPlays;
    } else {
        // COVERAGE MODE: Man vs Zone
        pool = Math.random() < manCoverageChance ? manPlays : zonePlays;
    }

    // Fallback if filter empties pool (e.g. formation has no blitzes)
    if (pool.length === 0) pool = availablePlays;

    return getRandom(pool);
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

    const roster = getRosterObjects(offense);
    const qb = roster.find(p => p && p.id === offense.depthChart.offense.QB1);

    const qbIQ = qb?.attributes?.mental?.playbookIQ ?? 50;
    const qbToughness = qb?.attributes?.mental?.toughness ?? 50;
    const qbDecision = qb?.attributes?.mental?.decisionMaking ?? 50;

    if (!offensePlay || !defensePlay || !qb) {
        return { playKey: offensivePlayKey, didAudible: false };
    }

    const iqChance = (qbIQ + qbDecision) / 200; // 💡 ENHANCED: Include decision-making
    let newPlayKey = offensivePlayKey;
    let didAudible = false;

    // 💡 THREAT ASSESSMENT: Categorize defensive aggression level
    const getBoxThreatLevel = () => {
        let threatLevel = 0;
        if (defensePlay.concept === 'Run') threatLevel += 2;
        if (defensePlay.blitz && defensePlay.concept !== 'Zone') threatLevel += 3;
        if (defensePlay.concept === 'Man' && defensePlay.blitz) threatLevel += 2;
        return threatLevel;
    };

    const boxThreatLevel = getBoxThreatLevel();

    // 1. Check: Run play vs. a stacked box (Run Stop or All-Out Blitz)
    if (offensePlay.type === 'run' && boxThreatLevel >= 2) {
        const audibleProbability = Math.min(0.8, iqChance + (boxThreatLevel * 0.15) + (qbToughness / 500));
        if (Math.random() < audibleProbability) {
            const audibleTo = findAudiblePlay(offense, 'pass', 'short');
            if (audibleTo) {
                newPlayKey = audibleTo;
                didAudible = true;
                if (gameLog) {
                    const threatDesc = boxThreatLevel >= 4 ? 'aggressive blitz' : 'stacked box';
                    gameLog.push(`[Audible]: 🧠 ${qb.name} (IQ:${qbIQ}) diagnoses ${threatDesc} and audibles to pass!`);
                }
            }
        }
    }
    // 2. Check: Pass play vs. a safe zone (no blitz, 'Zone' concept)
    else if (offensePlay.type === 'pass' && defensePlay.concept === 'Zone' && !defensePlay.blitz) {
        if (offensePlay.tags?.includes('deep') && Math.random() < (iqChance * 0.7)) {
            const audibleTo = findAudiblePlay(offense, 'run', 'inside');
            if (audibleTo) {
                newPlayKey = audibleTo;
                didAudible = true;
                if (gameLog) {
                    gameLog.push(`[Audible]: 🧠 ${qb.name} (Tough:${qbToughness}) sees soft zone and audibles to run!`);
                }
            }
        }
    }
    // 3. NEW: Man coverage with aggressive pass rush - might dump to checkdown
    else if (offensePlay.type === 'pass' && defensePlay.concept === 'Man' && boxThreatLevel >= 3) {
        if (offensePlay.tags?.includes('deep') && Math.random() < (iqChance * 0.5)) {
            const shortAudible = findAudiblePlay(offense, 'pass', 'short');
            if (shortAudible) {
                newPlayKey = shortAudible;
                didAudible = true;
                if (gameLog) {
                    gameLog.push(`[Audible]: 🧠 ${qb.name} sees aggressive man coverage, changes to checkdown!`);
                }
            }
        }
    }

    return { playKey: newPlayKey, didAudible };
}

/**
 * 💡 NEW: Checks play diversity and penalizes repetition to encourage variety.
 * Tracks last N plays and suggests alternatives if too repetitive.
 * @param {string} desiredPlayType - The play type to check ('pass', 'run', or 'deep', 'short', 'power', etc.)
 * @param {array} recentPlaysHistory - Array of recent play types called (max 5 plays)
 * @param {object} formationPlays - Available plays in formation keyed by their tags
 * @returns {string} - Suggested play key or original if diversity is adequate
 */
function checkPlayDiversity(desiredPlayType, recentPlaysHistory, candidatePlayKeys) {
    if (!Array.isArray(recentPlaysHistory) || recentPlaysHistory.length === 0) {
        return candidatePlayKeys && candidatePlayKeys.length > 0 ? candidatePlayKeys[0] : null;
    }

    // Count frequency of recent calls
    const frequency = {};
    recentPlaysHistory.forEach(play => {
        frequency[play] = (frequency[play] || 0) + 1;
    });

    // If the most common play appears too often, filter it out
    const mostCommon = Object.entries(frequency).sort((a, b) => b[1] - a[1])[0];
    const MAX_REPETITION = 3; // Same play max 3 times in last 5 plays

    if (mostCommon && mostCommon[1] >= MAX_REPETITION && candidatePlayKeys) {
        // Filter out the most repeated play to encourage diversity
        const diverseOptions = candidatePlayKeys.filter(p => p !== mostCommon[0]);
        if (diverseOptions.length > 0) {
            return diverseOptions[Math.floor(Math.random() * diverseOptions.length)];
        }
    }

    return candidatePlayKeys && candidatePlayKeys.length > 0 ? candidatePlayKeys[0] : null;
}

/**
 * Simulates a full game between two teams.
 */
function simulateGame(homeTeam, awayTeam, options = {}) {
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

        // 💡 NEW: Track play calls for diversity checking (max 5 recent plays per team)
        const homeTeamPlayHistory = [];
        const awayTeamPlayHistory = [];
        const maxHistoryLength = 5;

        if (!fastSim) gameLog.push("Coin toss to determine first possession...");
        const coinFlipWinner = Math.random() < 0.5 ? homeTeam : awayTeam;
        // Initial kickoff logic
        let possessionTeam = coinFlipWinner;
        let receivingTeamSecondHalf = (possessionTeam.id === homeTeam.id) ? awayTeam : homeTeam;

        // Track the current offense explicitly
        let currentOffense = coinFlipWinner;
        let gameForfeited = false;

        while (drivesThisGame < totalDrivesPerHalf * 2 && !gameForfeited) {

            // --- HALFTIME LOGIC ---
            if (drivesThisGame === totalDrivesPerHalf) {
                currentHalf = 2;
                if (!fastSim) gameLog.push(`==== HALFTIME ==== Score: ${awayTeam.name} ${awayScore} - ${homeTeam.name} ${homeScore}`);

                // Reset Fatigue
                const allGamePlayers = [...getRosterObjects(homeTeam), ...getRosterObjects(awayTeam)];
                allGamePlayers.forEach(p => { if (p) p.fatigue = Math.max(0, (p.fatigue || 0) - 40); });

                // 💡 FIX 2: Set offense for 2nd half
                currentOffense = receivingTeamSecondHalf;
                nextDriveStartBallOn = 20;
                if (!fastSim) gameLog.push(`-- Second Half Kickoff: ${currentOffense.name} receives --`);
            }

            // 💡 FIX 3: Use currentOffense
            const offense = currentOffense;
            const defense = (offense.id === homeTeam.id) ? awayTeam : homeTeam;

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

                // 💡 DEBUG: Track plays
                const playCountBeforeResolve = gameLog ? gameLog.length : 0;

                const shouldPunt = determinePuntDecision(down, yardsToGo, ballOn);
                let result;
                let scoreDiff;
                let drivesRemainingInGame;
                let offensivePlayKey; // 💡 **MOVED DECLARATION UP**
                let defensivePlayKey; // 💡 **MOVED DECLARATION UP**

                if (shouldPunt) {

                    // Set the offensive formation and play
                    offense.formations.offense = 'Punt';
                    offensivePlayKey = 'Punt_Punt';

                    // Set the defensive formation and play
                    defense.formations.defense = 'Punt_Return';
                    defensivePlayKey = 'Punt_Return_Return';

                    if (!fastSim) {
                        const offPlayName = offensivePlaybook[offensivePlayKey]?.name || "Punt";
                        const defPlayName = defensivePlaybook[defensivePlayKey]?.name || "Punt Return";
                        gameLog.push(`🏈 **Offense:** ${offPlayName}`);
                        gameLog.push(`🛡️ **Defense:** ${defPlayName}`);
                    }

                    result = resolvePlay(offense, defense, offensivePlayKey, defensivePlayKey,
                        { gameLog: fastSim ? null : gameLog, weather, ballOn, ballHash, down, yardsToGo },
                        options
                    );

                    if (!fastSim && result.visualizationFrames) {
                        allVisualizationFrames.push(...result.visualizationFrames);
                    }

                    // --- It was a punt, handle the result ---
                    driveActive = false; // A punt always ends the offensive possession (unless muffed)

                    if (result.touchdown && !result.turnover) {
                        // Blocked punt TD by Offense
                        if (offense.id === homeTeam.id) homeScore += 6; else awayScore += 6;
                        currentOffense = defense; // Kickoff to other team
                        nextDriveStartBallOn = 20;
                    } else if (result.touchdown && result.turnover) {
                        // Punt Return TD
                        if (defense.id === homeTeam.id) homeScore += 6; else awayScore += 6;
                        currentOffense = offense; // Kickoff to original offense
                        nextDriveStartBallOn = 20;
                    } else if (result.touchback) {
                        currentOffense = defense;
                        nextDriveStartBallOn = 20;
                    } else {
                        // Normal punt
                        const finalY = result.finalBallY || (ballOn + 40 + 10);
                        const absoluteBallOn = finalY - 10;
                        currentOffense = defense; // Possession flips
                        nextDriveStartBallOn = Math.round(Math.max(1, Math.min(99, 100 - absoluteBallOn)));
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

                    // Assign the scoreDiff (it was declared above)
                    scoreDiff = offense.id === homeTeam.id ? homeScore - awayScore : awayScore - homeScore;
                    const drivesCompletedInHalf = drivesThisGame % totalDrivesPerHalf;
                    const drivesRemainingInHalf = totalDrivesPerHalf - drivesCompletedInHalf;
                    drivesRemainingInGame = (currentHalf === 1 ? totalDrivesPerHalf : 0) + drivesRemainingInHalf;

                    const offensivePlayKey_initial = determinePlayCall(offense, defense, down, yardsToGo, ballOn, scoreDiff, fastSim ? null : gameLog, drivesRemainingInGame);
                    const offenseFormationName = offense.formations.offense;
                    const defensiveFormationName = determineDefensiveFormation(defense, offenseFormationName, down, yardsToGo);
                    defense.formations.defense = defensiveFormationName;
                    defensivePlayKey = determineDefensivePlayCall(defense, offense, down, yardsToGo, ballOn, scoreDiff, fastSim ? null : gameLog, drivesRemainingInGame);
                    const audibleResult = aiCheckAudible(offense, offensivePlayKey_initial, defense, defensivePlayKey, fastSim ? null : gameLog);
                    offensivePlayKey = audibleResult.playKey;

                    // 💡 NEW: Track play history for diversity checking
                    const offensePlayHistory = offense.id === homeTeam.id ? homeTeamPlayHistory : awayTeamPlayHistory;
                    if (!fastSim && offensivePlayKey) {
                        offensePlayHistory.push(offensivePlayKey);
                        if (offensePlayHistory.length > maxHistoryLength) {
                            offensePlayHistory.shift(); // Keep max 5 recent plays
                        }
                    }

                    if (!fastSim) {
                        const offPlayName = offensivePlaybook[offensivePlayKey]?.name || offensivePlayKey.split('_').slice(1).join(' ');
                        const defPlayName = defensivePlaybook[defensivePlayKey]?.name || defensivePlayKey;
                        if (gameLog) gameLog.push(`🏈 **Offense:** ${offPlayName} ${audibleResult.didAudible ? '(Audible)' : ''}`);
                        if (gameLog) gameLog.push(`🛡️ **Defense:** ${defPlayName}`);
                    }

                    result = resolvePlay(offense, defense, offensivePlayKey, defensivePlayKey,
                        { gameLog: fastSim ? null : gameLog, weather, ballOn, ballHash, down, yardsToGo },
                        options
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

                // --- 5. PROCESS PLAY RESULT (Corrected Logic) ---

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
                        if (!fastSim) gameLog.push(`🏈 --- ${points}-Point Conversion Attempt ---`);

                        // Setup Conversion Play
                        offense.formations.offense = offense.coach.preferredOffense || 'Balanced';

                        // Determine Plays
                        const conversionOffensePlayKey = determinePlayCall(offense, defense, 1, conversionYardsToGo, conversionBallOn, scoreDiff, fastSim ? null : gameLog, drivesRemainingInGame);
                        const conversionDefenseFormation = determineDefensiveFormation(defense, offense.formations.offense, 1, conversionYardsToGo);
                        defense.formations.defense = conversionDefenseFormation;
                        const conversionDefensePlayKey = determineDefensivePlayCall(defense, offense, 1, conversionYardsToGo, conversionBallOn, scoreDiff, fastSim ? null : gameLog, drivesRemainingInGame);

                        if (!fastSim) {
                            // Optional: Log play names
                        }

                        // Run Conversion
                        const conversionResult = resolvePlay(offense, defense, conversionOffensePlayKey, conversionDefensePlayKey,
                            { gameLog: fastSim ? null : gameLog, weather, ballOn: conversionBallOn, ballHash: 'M', down: 1, yardsToGo: conversionYardsToGo },
                            options
                        );

                        if (!fastSim && conversionResult.visualizationFrames) {
                            allVisualizationFrames.push(...conversionResult.visualizationFrames);
                        }

                        // Score Conversion
                        if (conversionResult.touchdown && !conversionResult.turnover) {
                            if (!fastSim) gameLog.push(`✅ ${points}-point conversion GOOD! Points are good!`);
                            if (offense.id === homeTeam.id) homeScore += (6 + points); else awayScore += (6 + points);
                        } else if (conversionResult.touchdown && conversionResult.turnover) {
                            // Returned conversion (very rare 2 points for defense)
                            if (!fastSim) gameLog.push(`❌ Conversion FAILED... AND RETURNED!`);
                            if (offense.id === homeTeam.id) homeScore += 6; else awayScore += 6;
                            if (defense.id === homeTeam.id) homeScore += 2; else awayScore += 2;
                        } else {
                            if (!fastSim) gameLog.push(`❌ ${points}-point conversion FAILED!`);
                            if (offense.id === homeTeam.id) homeScore += 6; else awayScore += 6;
                        }

                        scoreDiff = offense.id === homeTeam.id ? homeScore - awayScore : awayScore - homeScore;

                    } else {
                        // --- Defensive TD (Interception/Fumble Return) ---
                        if (!fastSim) gameLog.push(`🎉 DEFENSIVE TOUCHDOWN! 6 points for ${defense.name}!`);
                        if (defense.id === homeTeam.id) homeScore += 6; else awayScore += 6;
                        scoreDiff = offense.id === homeTeam.id ? homeScore - awayScore : awayScore - homeScore;
                    }

                    // --- SWAP POSSESSION ---
                    if (wasOffensiveTD) {
                        currentOffense = defense;
                    } else {
                        currentOffense = offense;
                    }

                    driveActive = false;
                    nextDriveStartBallOn = 20;

                    // --- 2. CHECK FOR SAFETY ---
                } else if (result.safety && !shouldPunt) {
                    if (!fastSim) gameLog.push(`SAFETY! 2 points for ${defense.name}!`);
                    if (defense.id === homeTeam.id) homeScore += 2; else awayScore += 2;
                    scoreDiff = offense.id === homeTeam.id ? homeScore - awayScore : awayScore - homeScore;

                    // End the drive and set up for a safety punt
                    driveActive = false;
                    nextDriveStartBallOn = 20;

                    // --- 3. CHECK FOR NON-TD TURNOVER ---
                } else if (result.turnover && !shouldPunt) {
                    driveActive = false;

                    currentOffense = defense;

                    // Calculate spot based on where the play ENDED
                    const finalY = result.finalBallY !== undefined ? result.finalBallY : (ballOn + 10);
                    const absoluteBallOn = finalY - 10;

                    // Flip the field for the new offense
                    let turnoverSpot = 100 - absoluteBallOn;

                    // Clamp
                    turnoverSpot = Math.round(Math.max(1, Math.min(99, turnoverSpot)));
                    nextDriveStartBallOn = turnoverSpot;

                    if (!fastSim) {
                        const spotText = nextDriveStartBallOn <= 50 ? `own ${nextDriveStartBallOn}` : `opponent ${100 - nextDriveStartBallOn}`;
                        if (result.incomplete && down > 4) {
                            if (result.incomplete) nextDriveStartBallOn = 100 - ballOn; // Reset to LOS
                            gameLog.push(`✋ Turnover on downs! ${defense.name} takes over.`);
                        } else {
                            gameLog.push(`🔄 Possession changes! Ball spotted at ${spotText}.`);
                        }
                    }

                    // --- 4. CHECK FOR INCOMPLETE PASS ---
                } else if (result.incomplete && !shouldPunt) {
                    down++;

                    // --- 5. REGULAR PLAY (GAIN/LOSS) ---
                } else if (!shouldPunt) { // Completed play, not a punt
                    const goalLineY = FIELD_LENGTH - 10;
                    const absoluteLoS_Y = (ballOn - result.yards) + 10; // ballOn is yardline relative to offense direction
                    const yardsToGoalLine = goalLineY - absoluteLoS_Y; // Recalculate relative to field coords if needed, but simplified logic uses yardsToGo
                    // Actually, simplified logic:
                    const wasGoalToGo = ((ballOn + 10) + yardsToGo) >= (FIELD_LENGTH - 10);

                    yardsToGo -= result.yards;

                    if (yardsToGo <= 0) { // First down
                        down = 1;
                        const newYardsToGoalLine = 100 - ballOn;

                        if (newYardsToGoalLine <= 10) {
                            yardsToGo = newYardsToGoalLine;
                        } else {
                            yardsToGo = 10;
                        }
                        if (yardsToGo <= 0) yardsToGo = 1;

                        if (!fastSim) {
                            const newYardLineText = ballOn <= 50 ? `own ${ballOn}` : `opponent ${100 - ballOn}`;
                            gameLog.push(`➡️ First down ${offense.name}! ${newYardsToGoalLine <= 10 ? `1st & Goal at the ${newYardsToGoalLine}` : `1st & 10 at the ${newYardLineText}`}.`);
                        }

                    } else { // Not a first down
                        down++;
                        if (wasGoalToGo) {
                            yardsToGo = 100 - ballOn;
                        }
                    }
                }
            }

            // --- 6. CHECK FOR TURNOVER ON DOWNS ---
            if (down > 4 && driveActive) {
                if (!fastSim) {
                    const finalYardLineText = ballOn <= 50 ? `own ${ballOn}` : `opponent ${100 - ballOn}`;
                    gameLog.push(`✋ Turnover on downs! ${defense.name} takes over at the ${finalYardLineText}.`);
                }
                driveActive = false;
                nextDriveStartBallOn = 100 - ballOn;
            }

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
function simulateWeek(options = {}) {
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
function generateWeeklyFreeAgents() {
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
function callFriend(playerId) {
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

function aiManageRoster(team) {
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

/**
 * Selects a Team Captain based on IQ and Experience (Age).
 * Stores the captain's ID in team.captainId.
 */
function assignTeamCaptain(team) {
    const roster = getRosterObjects(team);
    if (roster.length === 0) return;

    // Scoring: IQ (50%) + Age/Exp (30%) + Consistency (20%)
    const getLeadershipScore = (p) => {
        const iq = p.attributes?.mental?.playbookIQ || 50;
        const consistency = p.attributes?.mental?.consistency || 50;
        const ageBonus = (p.age - 10) * 5; // Older players get a big bonus
        return (iq * 0.5) + (ageBonus * 0.3) + (consistency * 0.2);
    };

    // Sort by score
    roster.sort((a, b) => getLeadershipScore(b) - getLeadershipScore(a));

    if (roster[0]) {
        team.captainId = roster[0].id;
        // console.log(`${team.name} Captain: ${roster[0].name} (Score: ${getLeadershipScore(roster[0]).toFixed(0)})`);
    }
}

/**
 * Determines if the Captain makes the "Smart" call or a "Rookie" mistake.
 * Returns TRUE if the smart logic should be used.
 * Returns FALSE if the logic should degrade to random/basic.
 */
function checkCaptainDiscipline(team, gameLog) {
    const roster = getRosterObjects(team);
    const captain = roster.find(p => p.id === team.captainId) || roster[0]; // Fallback to first player

    if (!captain) return true; // Fail safe

    const iq = captain.attributes?.mental?.playbookIQ || 50;
    const consistency = captain.attributes?.mental?.consistency || 50;

    // Base mistake chance: 
    // 99 IQ = ~1% mistake chance
    // 50 IQ = ~15% mistake chance
    // 20 IQ = ~40% mistake chance
    // Modified by Consistency

    const mentalErrorChance = Math.max(0.01, (100 - iq) / 300) * (1 + (100 - consistency) / 100);

    const isSmart = Math.random() > mentalErrorChance;

    if (!isSmart && gameLog && Math.random() < 0.2) {
        // Flavor text for bad calls (20% of the time they fail)
        gameLog.push(`⚠️ ${captain.name} looks confused and rushes the play call...`);
    }

    return isSmart;
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
function advanceToOffseason() {
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

    // Re-elect captains for the new season
    game.teams.forEach(t => assignTeamCaptain(t));

    return { retiredPlayers, hofInductees, developmentResults, leavingPlayers };
}


// =============================================================
// --- DEPTH CHART & PLAYER MANAGEMENT ---
// =============================================================

/** Updates the player's depth chart based on drag-and-drop. */
function updateDepthChart(playerId, newPositionSlot, side) {
    const team = game?.playerTeam;
    if (!team || !team.depthChart || !team.depthChart[side]) {
        console.error("updateDepthChart: Invalid state.");
        return;
    }

    const chart = team.depthChart[side];
    const player = game.players.find(p => p && p.id === playerId);

    if (player && player.status?.type === 'temporary') {
        console.warn("Cannot move temporary players in depth chart.");
        return;
    }

    // --- NEW LOGIC: Allow Multi-Assignment ---
    // We simply assign the player to the new slot.
    // We do NOT clear their previous slot.
    chart[newPositionSlot] = playerId;

    console.log(`Player ${playerId} assigned to ${newPositionSlot}`);
}

// -----------------------------
// Depth Order API / Helpers
// -----------------------------

/**
 * Update roster depth order based on newOrder[] (array of player IDs).
 * Persists to the player's team object and dispatches a UI refresh.
 */
export function updateDepthOrder(newOrder) {
    if (!game || !game.playerTeam) {
        console.warn("updateDepthOrder: game or playerTeam missing.");
        return;
    }
    const team = game.playerTeam;
    if (!Array.isArray(team.roster)) {
        console.warn("updateDepthOrder: roster missing.");
        return;
    }

    // Build lookup: id -> player object
    const rosterObjects = getRosterObjects(team);
    const map = {};
    rosterObjects.forEach(p => { if (p && p.id) map[p.id] = p; });

    // Rebuild roster in the requested order (preserve objects)
    const reordered = [];
    for (const id of (Array.isArray(newOrder) ? newOrder : [])) {
        if (map[id]) reordered.push(map[id].id);
    }

    // Append any missing players (safety)
    rosterObjects.forEach(p => {
        if (!reordered.includes(p.id)) reordered.push(p.id);
    });

    // Apply the new roster order (IDs)
    team.roster = reordered.slice();

    // Persist `depthOrder` as the authoritative order for starter selection
    team.depthOrder = reordered.slice();

    // Notify UI/consumers
    try { document.dispatchEvent(new CustomEvent("refresh-ui")); } catch (e) { /* ignore */ }

    console.log("updateDepthOrder applied:", reordered);
}

/**
 * Returns the highest-priority player object for a given position based on depthOrder.
 * If no explicit depthOrder exists, falls back to roster order or suitability.
 */
export function getStarterForPosition(team, position) {
    if (!team || !Array.isArray(team.roster)) return null;

    const rosterObjects = getRosterObjects(team);

    // Use explicit depthOrder if present
    const order = Array.isArray(team.depthOrder) ? team.depthOrder : (team.roster || []);

    for (const id of order) {
        const p = rosterObjects.find(r => r && r.id === id);
        if (!p) continue;
        // match by primary positions or estimated best fit
        // assume p.favoriteOffensivePosition / favoriteDefensivePosition or pos field exists
        const basePos = position.replace(/\d/g, '');
        if (p.favoriteOffensivePosition === basePos || p.favoriteDefensivePosition === basePos || p.pos === basePos) {
            // Only return healthy players by default
            if (!p.status || p.status.duration === 0) return p;
        }
    }

    // Fallback: find best available by suitability
    const candidates = rosterObjects.filter(p => p && (!p.status || p.status.duration === 0));
    if (candidates.length === 0) return null;

    const best = candidates.reduce((bestSoFar, cur) => {
        try {
            const bestScore = calculateSlotSuitability(bestSoFar, position, position.startsWith('DL') ? 'defense' : 'offense', team);
            const curScore = calculateSlotSuitability(cur, position, position.startsWith('DL') ? 'defense' : 'offense', team);
            return curScore > bestScore ? cur : bestSoFar;
        } catch (e) {
            return bestSoFar;
        }
    }, candidates[0]);

    return best || null;
}

/**
 * Returns the next available player (backup) for a given position based on depthOrder.
 * `excludeId` is typically the starter's id so we return the next one.
 */
export function getBackupForPosition(team, position, excludeId = null) {
    if (!team || !Array.isArray(team.roster)) return null;
    const rosterObjects = getRosterObjects(team);
    const order = Array.isArray(team.depthOrder) ? team.depthOrder : (team.roster || []);

    let foundStarter = excludeId ? false : true;

    for (const id of order) {
        const p = rosterObjects.find(r => r && r.id === id);
        if (!p) continue;
        const basePos = position.replace(/\d/g, '');
        if (!(p.favoriteOffensivePosition === basePos || p.favoriteDefensivePosition === basePos || p.pos === basePos)) continue;
        if (!p.status || p.status.duration === 0) {
            if (!excludeId) return p;
            if (!foundStarter) {
                if (p.id === excludeId) {
                    foundStarter = true;
                }
                continue;
            } else {
                if (p.id !== excludeId) return p;
            }
        }
    }

    // Fallback: simple search through roster objects
    const candidates = rosterObjects.filter(p => p && p.id !== excludeId && (!p.status || p.status.duration === 0) &&
        (p.favoriteOffensivePosition === position.replace(/\d/g, '') || p.favoriteDefensivePosition === position.replace(/\d/g, '') || p.pos === position.replace(/\d/g, ''))
    );
    return candidates.length > 0 ? candidates[0] : null;
}


/**
 * Validates the integrity of a team's depth chart and roster.
 * Returns { valid: boolean, errors: string[] }
 */
function validateDepthChart(team) {
    const errors = [];
    if (!team || !team.depthChart || !team.roster) {
        return { valid: false, errors: ['Team or depth chart invalid'] };
    }

    const allRosterIds = new Set(team.roster.filter(id => id));
    const assignedPlayerIds = new Set();

    Object.values(team.depthChart).forEach(sideChart => {
        Object.values(sideChart).forEach(playerId => {
            if (playerId) {
                if (!allRosterIds.has(playerId)) {
                    errors.push(`Player ${playerId} in depth chart but not on roster`);
                }
                if (assignedPlayerIds.has(playerId)) {
                    errors.push(`Player ${playerId} assigned to multiple slots`);
                }
                assignedPlayerIds.add(playerId);
            }
        });
    });

    return { valid: errors.length === 0, errors };
}

/**
 * Substitute two players on a team: put inPlayer into the starter slot occupied by outPlayer.
 * If inPlayer is currently assigned to another slot, the assignemnts will be swapped.
 * Returns an object { success: boolean, message: string }
 */
function substitutePlayers(teamId, outPlayerId, inPlayerId, gameLog = null) {
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
    let outSlot = null; // The ONLY slot outPlayer occupies
    let inSlot = null;  // The ONLY slot inPlayer occupies (if any)

    sides.forEach(side => {
        const chart = team.depthChart[side] || {};
        Object.keys(chart).forEach(slot => {
            if (chart[slot] === outPlayerId) {
                outSlot = { side, slot };
            }
            if (chart[slot] === inPlayerId) {
                inSlot = { side, slot };
            }
        });
    });

    if (!outSlot) {
        return { success: false, message: 'Outgoing player is not currently a starter.' };
    }

    // CASE 1: Both players are starters → swap them
    if (inSlot) {
        team.depthChart[outSlot.side][outSlot.slot] = inPlayerId;
        team.depthChart[inSlot.side][inSlot.slot] = outPlayerId;
        const logMsg = `🔄 SUBSTITUTION: ${inPlayer.name} and ${outPlayer.name} swap positions.`;
        console.log(logMsg);
        if (gameLog && Array.isArray(gameLog)) gameLog.push(logMsg);
        return { success: true, message: 'Players swapped positions.' };
    }

    // CASE 2: inPlayer is a bench player → move them to outSlot, remove outPlayer from any other slots
    team.depthChart[outSlot.side][outSlot.slot] = inPlayerId;

    // Remove outPlayer from ALL depth chart slots (he should go to bench)
    sides.forEach(side => {
        const chart = team.depthChart[side] || {};
        Object.keys(chart).forEach(slot => {
            if (chart[slot] === outPlayerId) {
                chart[slot] = null;
            }
        });
    });

    const logMsg = `🔄 SUBSTITUTION: ${inPlayer.name} enters for ${outPlayer.name}.`;
    console.log(logMsg);
    if (gameLog && Array.isArray(gameLog)) gameLog.push(logMsg);
    return { success: true, message: 'Substitution completed.' };
}

/**
 * AI: make intelligent substitutions for a team based on fatigue.
 * Will attempt up to `maxSubs` swaps.
 */
function autoMakeSubstitutions(team, options = {}, gameLog = null) {
    if (!team || !team.depthChart || !team.roster) return 0;

    const thresholdFatigue = options.thresholdFatigue || 50;
    const reEntryFatigue = 20; // Player must recover to this fatigue level to re-enter
    const maxSubs = options.maxSubs || 3;
    const chance = typeof options.chance === 'number' ? options.chance : 0.8;

    if (Math.random() > chance) return 0;

    const fullRoster = getRosterObjects(team);
    if (!fullRoster || fullRoster.length === 0) return 0;

    let subsDone = 0;
    const sides = Object.keys(team.depthChart || {});

    for (const side of sides) {
        if (subsDone >= maxSubs) break;

        const chart = team.depthChart[side] || {};
        const formationSlots = Object.keys(chart).filter(slot => chart[slot]); // Only active starters

        for (const slot of formationSlots) {
            if (subsDone >= maxSubs) break;

            const currentPlayerId = chart[slot];
            if (!currentPlayerId) continue;

            const currentPlayer = fullRoster.find(p => p && p.id === currentPlayerId);
            if (!currentPlayer) continue;

            const currentFatigue = currentPlayer.fatigue || 0;

            // Get all players currently on the depth chart (starters)
            const allStarters = new Set();
            Object.values(team.depthChart).forEach(sideChart => {
                Object.values(sideChart).forEach(playerId => {
                    if (playerId) allStarters.add(playerId);
                });
            });

            // Get all bench players (on roster but not in depth chart)
            const benchPlayers = fullRoster.filter(p =>
                p &&
                !allStarters.has(p.id) &&
                (!p.status || p.status.duration === 0) // Healthy
            );

            // --- SCENARIO A: Current player is TIRED -> Sub Out ---
            if (currentFatigue >= thresholdFatigue && benchPlayers.length > 0) {
                // Find freshest, most suitable bench player for this slot
                const bestSub = benchPlayers.reduce((best, curr) => {
                    const currFatigue = curr.fatigue || 0;
                    const bestFatigue = best.fatigue || 0;
                    const currSuitability = calculateSlotSuitability(curr, slot, side, team);
                    const bestSuitability = calculateSlotSuitability(best, slot, side, team);

                    // Prioritize: 1) Lower fatigue, 2) Better suitability
                    if (currFatigue < bestFatigue - 10) return curr;
                    if (bestFatigue < currFatigue - 10) return best;
                    return currSuitability > bestSuitability ? curr : best;
                }, benchPlayers[0]);

                if (bestSub) {
                    const res = substitutePlayers(team.id, currentPlayerId, bestSub.id, gameLog);
                    if (res && res.success) {
                        subsDone++;
                    }
                }
            }

            // --- SCENARIO B: Check if a well-rested bench player should start ---
            else if (benchPlayers.length > 0) {
                const currentSuitability = calculateSlotSuitability(currentPlayer, slot, side, team);

                // Find the best-rested, most-suitable bench player
                const restedStarters = benchPlayers.filter(p => (p.fatigue || 0) < reEntryFatigue);

                if (restedStarters.length > 0) {
                    const bestRested = restedStarters.reduce((best, curr) => {
                        const currSuitability = calculateSlotSuitability(curr, slot, side, team);
                        const bestSuitability = calculateSlotSuitability(best, slot, side, team);
                        return currSuitability > bestSuitability ? curr : best;
                    }, restedStarters[0]);

                    const bestRestedScore = calculateSlotSuitability(bestRested, slot, side, team);

                    // If bench player is significantly more suitable, swap them in
                    if (bestRestedScore > currentSuitability + 8) {
                        const res = substitutePlayers(team.id, currentPlayerId, bestRested.id, gameLog);
                        if (res && res.success) {
                            subsDone++;
                        }
                    }
                }
            }
        }
    }
    return subsDone;
}
/** Changes the player team's formation for offense or defense. */
function changeFormation(side, formationName) {
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
function playerCut(playerId) {
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
function playerSignFreeAgent(playerId) {
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
function getGameState() { return game; }

/** Returns the breakthroughs from the most recent week/game. */
function getBreakthroughs() { return game?.breakthroughs || []; } // Safe access

/** Marks a specific message as read. */
function markMessageAsRead(messageId) {
    const message = game?.messages?.find(m => m && m.id === messageId); // Safe access
    if (message) { message.isRead = true; }
}

const DEFAULT_SAVE_KEY = 'backyardFootballGameState';

/**
 * Saves the current game state to localStorage under a specific key.
 * @param {string} [saveKey=DEFAULT_SAVE_KEY] - The key to save the game under.
 */
function saveGameState(saveKey = DEFAULT_SAVE_KEY) {
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
function loadGameState(saveKey = DEFAULT_SAVE_KEY) {
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
function getPlayer(id) {
    if (typeof playerMap !== 'undefined') return playerMap.get(id);
    return game?.players?.find(p => p.id === id);
}
// =============================================================
// --- EXPORTS ---
// =============================================================

export {
    initializeLeague, createPlayerTeam, setupDraft, getGameState, saveGameState, loadGameState, getBreakthroughs,
    addPlayerToTeam, playerCut, playerSignFreeAgent, callFriend, aiManageRoster, aiSetDepthChart, updateDepthChart, changeFormation,
    getRosterObjects, getPlayer, simulateAIPick, simulateGame, simulateWeek, advanceToOffseason, generateWeeklyFreeAgents, generateSchedule,
    addMessage, markMessageAsRead, getScoutedPlayerInfo, getRelationshipLevel, calculateOverall, calculateSlotSuitability,
    substitutePlayers, autoMakeSubstitutions, aiCheckAudible, setTeamCaptain // <--- CRITICAL EXPORTS
};
