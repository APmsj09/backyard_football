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
const FUMBLE_CHANCE_BASE = 0.015;

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
/**
 * Normalizes formation keys to ensure they exist in the provided formations object.
 * @param {object} formations - The dictionary of formations (e.g. offenseFormations)
 * @param {string} formationKey - The key currently stored in the team data
 * @param {string} defaultKey - A safe fallback key (e.g. 'Balanced')
 */
function normalizeFormationKey(formations, formationKey, defaultKey) {
    // 1. Safety check: if formations object is missing, return default
    if (!formations || typeof formations !== 'object') {
        return defaultKey;
    }

    // 2. Exact Match: If the key exists in the object, it's valid. Use it.
    if (formationKey && formations[formationKey]) {
        return formationKey;
    }

    // 3. Legacy/Name Match: Check if we have the "Name" instead of the "Key"
    // (Useful if you changed keys in data.js but loaded an old save)
    const match = Object.entries(formations).find(
        ([key, f]) => f.name === formationKey || key === formationKey
    );

    if (match) {
        console.warn(`⚠️ Legacy formation detected: "${formationKey}" → "${match[0]}"`);
        return match[0];
    }

    // 4. Default Fallback: Check if the default key exists
    if (defaultKey && formations[defaultKey]) {
        return defaultKey;
    }

    // 5. Nuclear Fallback: Return the very first key in the object
    const keys = Object.keys(formations);
    return keys.length > 0 ? keys[0] : null;
}

/**
 * REBUILDS the Depth Chart slots (QB1, WR1, etc.) strictly based on the
 * team's 'depthOrder' lists.
 * This is the "Source of Truth" logic.
 */
// --- In game.js ---

export function rebuildDepthChartFromOrder(team) {
    if (!team || !team.formations) return;

    // 1. Ensure Depth Order Object Exists with correct keys
    if (!team.depthOrder || Array.isArray(team.depthOrder)) {
        team.depthOrder = {
            'QB': [], 'RB': [], 'WR': [], 'OL': [],
            'DL': [], 'LB': [], 'DB': []
        };
    }

    // 2. SYNC ROSTER: Ensure every player is in the order, and no ghosts exist
    // Get all current valid player IDs on the roster
    const rosterIds = new Set(team.roster);
    const assignedIds = new Set();

    // Clean up existing lists (Remove deleted players)
    Object.keys(team.depthOrder).forEach(posKey => {
        // FIX: Safety check if array exists before filtering
        if (!Array.isArray(team.depthOrder[posKey])) {
            team.depthOrder[posKey] = [];
            return;
        }

        team.depthOrder[posKey] = team.depthOrder[posKey].filter(id => {
            if (rosterIds.has(id)) {
                assignedIds.add(id);
                return true;
            }
            return false;
        });
    });

    // Add missing players (Drafted/Signed) to the END of their bucket
    team.roster.forEach(pid => {
        if (!assignedIds.has(pid)) {
            const p = getPlayer(pid);
            if (p) {
                // Determine bucket
                let pos = p.pos || p.favoriteOffensivePosition || 'WR';

                // Normalize positions
                if (['FB'].includes(pos)) pos = 'RB';
                if (['TE', 'ATH', 'K', 'P'].includes(pos)) pos = 'WR';
                if (['OT', 'OG', 'C'].includes(pos)) pos = 'OL';
                if (['DE', 'DT', 'NT'].includes(pos)) pos = 'DL';
                if (['CB', 'S', 'FS', 'SS'].includes(pos)) pos = 'DB';

                // Safety fallback
                if (!team.depthOrder[pos]) pos = 'WR';

                // Append to end of list (Bench)
                team.depthOrder[pos].push(pid);
            }
        }
    });

    // 3. Reset Visual Depth Chart Slots
    team.depthChart = { offense: {}, defense: {}, special: {} };

    // 4. Create a working copy to "deal cards" into slots
    const workingOrder = {};
    Object.keys(team.depthOrder).forEach(key => {
        workingOrder[key] = [...team.depthOrder[key]]; // Copy list
    });

    const getNext = (posKey) => {
        if (workingOrder[posKey] && workingOrder[posKey].length > 0) {
            return workingOrder[posKey].shift();
        }
        return null;
    };

    // 5. Fill Offense Slots
    const offFormKey = normalizeFormationKey(
        offenseFormations,
        team.formations.offense,
        'Balanced'
    );
    team.formations.offense = offFormKey; // 🔒 Fix state

    const offSlots = offenseFormations[offFormKey].slots;

    offSlots.forEach(slot => {
        let posKey = slot.replace(/\d+/g, '');
        // Normalize Slot Names
        if (['OT', 'OG', 'C'].includes(posKey)) posKey = 'OL';
        if (posKey === 'FB') posKey = 'RB';
        if (posKey === 'TE') posKey = 'WR';

        let pid = getNext(posKey);

        // Fallbacks if position bucket is empty
        if (!pid) {
            if (posKey === 'WR') pid = getNext('RB');
            else if (posKey === 'RB') pid = getNext('WR');
        }
        team.depthChart.offense[slot] = pid || null;
    });

    // 6. Fill Defense Slots
    const defFormKey = normalizeFormationKey(
        defenseFormations,
        team.formations.defense,
        '3-1-3'
    );
    team.formations.defense = defFormKey; // 🔒 Fix state

    const defSlots = defenseFormations[defFormKey].slots;
    defSlots.forEach(slot => {
        let posKey = slot.replace(/\d+/g, '');
        // Normalize Slot Names
        if (['CB', 'S'].includes(posKey)) posKey = 'DB';
        if (['DE', 'DT'].includes(posKey)) posKey = 'DL';

        let pid = getNext(posKey);

        // Fallbacks
        if (!pid) {
            if (posKey === 'DB') pid = getNext('LB') || getNext('WR'); // DB can be LB or WR (Athlete)
            else if (posKey === 'DL') pid = getNext('LB') || getNext('OL'); // DL can be LB or OL (Big man)
            else if (posKey === 'LB') pid = getNext('DL') || getNext('DB'); // LB can be DL or DB
        }
        team.depthChart.defense[slot] = pid || null;
    });

    // 7. Special Teams (Punter = Backup QB or Best Athlete)
    const qbBucket = team.depthOrder['QB'] || [];
    const bestPunter = qbBucket.length > 1 ? qbBucket[1] : qbBucket[0]; // QB2 or QB1
    team.depthChart.special['P'] = bestPunter || null;
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
    if (!ballCarrierState.hasBall) return false;

    // Attribute Lookups (Safety check if attributes missing)
    const toughness = ballCarrierState.toughness || 50;
    const strength = tacklerState.strength || 50;
    const tackling = tacklerState.tackling || 50;

    // Modifiers: Fatigue makes fumbles more likely
    const carrierMod = (toughness / 100) * (ballCarrierState.fatigueModifier || 1);
    const tacklerMod = ((strength + tackling) / 200) * (tacklerState.fatigueModifier || 1);

    // Formula: Harder hit (tacklerMod) vs Tougher carrier (carrierMod)
    let fumbleChance = FUMBLE_CHANCE_BASE * (tacklerMod / (carrierMod + 0.2));

    // QB Sacks have higher fumble chance (blindside logic)
    if (ballCarrierState.role === 'QB' && ballCarrierState.action === 'qb_setup') {
        fumbleChance *= 2.5;
    }

    if (Math.random() < fumbleChance) {
        if (gameLog) {
            gameLog.push(`❗ FUMBLE! Ball knocked loose by ${tacklerState.name}!`);
        }

        // Logic: Drop ball at current spot
        playState.fumbleOccurred = true;
        playState.ballState.isLoose = true;
        playState.ballState.inAir = false; // It's on the ground

        // Physics: Small bounce vector based on tackler direction
        const dx = ballCarrierState.x - tacklerState.x;
        const dy = ballCarrierState.y - tacklerState.y;
        playState.ballState.vx = dx * 2;
        playState.ballState.vy = dy * 2;
        playState.ballState.x = ballCarrierState.x;
        playState.ballState.y = ballCarrierState.y;
        playState.ballState.z = 0.5; // Bounce height

        // State Updates
        ballCarrierState.isBallCarrier = false;
        ballCarrierState.hasBall = false;
        ballCarrierState.stunnedTicks = 40; // Stunned
        tacklerState.stunnedTicks = 10;     // Brief recovery

        // Stats
        playState.statEvents.push({
            type: 'fumble',
            playerId: ballCarrierState.id
        });

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

    // 1. Calculate Read Time (How long until they "know"?)
    // 99 IQ reads at tick 5. 50 IQ reads at tick 25.
    const ticksToDiagnose = Math.max(5, 45 - Math.floor(iq * 0.4));

    if (tick < ticksToDiagnose) {
        return 'read'; // Still diagnosing, standing still or backpedaling
    }

    // 2. Play Action Logic (The "Bite" Factor)
    const isPlayAction = (truePlayType === 'pass' && offensivePlayKey.includes('PA_'));

    if (isPlayAction) {
        // Chance to be fooled is inversely proportional to IQ
        // 90 IQ = 10% chance to bite. 
        // 40 IQ = 60% chance to bite.
        const fooledChance = (100 - iq) / 100;

        if (Math.random() < fooledChance) {
            // Check if they recover (2nd chance for mid-IQ players)
            const recoveryChance = iq / 200; // Small chance to fix mistake late
            if (Math.random() > recoveryChance) {
                return 'run'; // FOOLED! They will attack the run gap.
            }
        }
    }

    return truePlayType; // Correct read
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
    if (!team || !team.formations || !Array.isArray(rosterObjs)) return;
    if (rosterObjs.length === 0) return;

    // 1. Initialize Depth Order Buckets (The Source of Truth)
    team.depthOrder = {
        'QB': [], 'RB': [], 'WR': [], 'OL': [],
        'DL': [], 'LB': [], 'DB': []
    };

    // 2. Sort Roster by Overall (Best players first)
    // We use a generic 'ATH' position to just get raw talent
    const sortedRoster = [...rosterObjs].sort((a, b) =>
        calculateOverall(b, estimateBestPosition(b)) - calculateOverall(a, estimateBestPosition(a))
    );

    // 3. Distribute into Buckets
    sortedRoster.forEach(p => {
        let pos = p.pos || p.favoriteOffensivePosition || 'WR';
        // Normalize
        if (['FB'].includes(pos)) pos = 'RB';
        if (['TE', 'ATH', 'K', 'P'].includes(pos)) pos = 'WR';
        if (['OT', 'OG', 'C'].includes(pos)) pos = 'OL';
        if (['DE', 'DT', 'NT'].includes(pos)) pos = 'DL';
        if (['CB', 'S', 'FS', 'SS'].includes(pos)) pos = 'DB';

        // Safety Fallback
        if (!team.depthOrder[pos]) pos = 'WR';

        team.depthOrder[pos].push(p.id);
    });

    // 4. Now that depthOrder is correct, let the rebuilder handle the slot assignments
    rebuildDepthChartFromOrder(team);
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
    if (!player || !team || !team.roster || typeof player.id === 'undefined') return false;

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
    team.roster.push(player.id); // Add to ID list

    // 💡 FIX: Add to Depth Order Bucket
    if (!team.depthOrder || Array.isArray(team.depthOrder)) {
        // Fix bad state if it exists
        team.depthOrder = { 'QB': [], 'RB': [], 'WR': [], 'OL': [], 'DL': [], 'LB': [], 'DB': [] };
    }

    let pos = player.favoriteOffensivePosition || 'WR';
    // Normalize
    if (['FB'].includes(pos)) pos = 'RB';
    if (['TE', 'ATH', 'K', 'P'].includes(pos)) pos = 'WR';
    if (['OT', 'OG', 'C'].includes(pos)) pos = 'OL';
    if (['DE', 'DT', 'NT'].includes(pos)) pos = 'DL';
    if (['CB', 'S', 'FS', 'SS'].includes(pos)) pos = 'DB';

    if (team.depthOrder[pos]) {
        team.depthOrder[pos].push(player.id);
    } else {
        team.depthOrder['WR'].push(player.id); // Fallback
    }

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

/**
 * Calculates how many 'ticks' a player is delayed in reacting to a new event.
 * Higher IQ = Lower Delay.
 * @param {number} iq - The player's playbookIQ attribute (0-99).
 * @returns {number} - Ticks to wait before updating target (0 to 20).
 */
function calculateReactionDelay(iq) {
    // 99 IQ = 0 delay (Instant)
    // 50 IQ = 10 ticks (0.5s delay)
    // 0 IQ  = 20 ticks (1.0s delay)
    const baseDelay = 20 - Math.floor(iq / 5);
    return Math.max(0, baseDelay);
}

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
 * Resolves the specific player IDs for every slot in the current formations.
 * Used to ensure we know exactly who is "QB1", "WR1", "DL1", etc. for this specific snap.
 */
function resolveDepthForPlay(offense, defense) {
    const resolved = { offense: {}, defense: {} };

    const resolveSide = (team, side) => {
        const formationName = team.formations[side];
        const formationData = side === 'offense' ? offenseFormations[formationName] : defenseFormations[formationName];

        if (!formationData || !formationData.slots) return;

        formationData.slots.forEach(slot => {
            // 1. Check Depth Chart
            let playerId = team.depthChart[side]?.[slot];

            // 2. Fallback: If slot is empty, find best available from Roster
            if (!playerId) {
                // Try to find a player who fits this position who isn't already assigned
                const basePos = slot.replace(/\d/g, ''); // WR1 -> WR
                // Get all roster objects
                const rosterObjs = getRosterObjects(team);

                // Find someone compatible
                const candidate = rosterObjs.find(p =>
                    p &&
                    (!p.status || p.status.duration === 0) &&
                    (p.favoriteOffensivePosition === basePos || p.favoriteDefensivePosition === basePos || p.pos === basePos) &&
                    !Object.values(resolved[side]).includes(p.id) // Not already used
                );

                if (candidate) playerId = candidate.id;

                // 3. Emergency Fallback: Any healthy player not used
                if (!playerId) {
                    const emergency = rosterObjs.find(p =>
                        p &&
                        (!p.status || p.status.duration === 0) &&
                        !Object.values(resolved[side]).includes(p.id)
                    );
                    if (emergency) playerId = emergency.id;
                }
            }
            resolved[side][slot] = playerId;
        });
    };

    if (offense) resolveSide(offense, 'offense');
    if (defense) resolveSide(defense, 'defense');

    return resolved;
}


/**
 * Sets up the initial state for all players involved in a play.
 */
function setupInitialPlayerStates(playState, offense, defense, play, assignments, ballOnYardLine, defensivePlayKey, ballHash = 'M', offensivePlayKey = '') {
    playState.activePlayers = [];
    const usedPlayerIds_O = new Set();
    const usedPlayerIds_D = new Set();
    const isPlayAction = offensivePlayKey.includes('PA_');

    // --- Normalize play intent onto playState (snap boundary) ---
    playState.type = play.type;
    playState.readProgression = play.readProgression || [];
    playState.playKey = play.key || null;

    // --- FIX: Robust Defensive Play Lookup ---
    let defPlay = defensivePlaybook[defensivePlayKey];

    // Fallback 1: Try a default safe zone
    if (!defPlay) defPlay = defensivePlaybook['Cover_2_Zone_3-1-3'];

    // Fallback 2: Hardcoded safety object if playbook is broken
    if (!defPlay) {
        console.warn(`Defensive play key '${defensivePlayKey}' invalid and default missing. Using empty shell.`);
        defPlay = { name: 'Emergency Default', assignments: {} };
    }

    const defAssignments = defPlay.assignments || {};

    // --- Ensure Depth is Resolved ---
    if (!playState.resolvedDepth) {
        playState.resolvedDepth = resolveDepthForPlay(offense, defense);
    }

    // Tracking Logic
    playState.defensiveCall = {
        key: defensivePlayKey,
        name: defPlay.name || 'Unknown',
        concept: defPlay.concept || 'Zone',
        isCover1: defensivePlayKey?.includes('Cover_1') || false,
        isCover2: defensivePlayKey?.includes('Cover_2') || false,
        isCover3: defensivePlayKey?.includes('Cover_3') || false,
        isCover4: defensivePlayKey?.includes('Cover_4') || false,
        hasBlitz: defPlay.blitz === true,
        assignments: defAssignments
    };

    // Set the line of scrimmage
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

            // We need to temporarily resolve ID here to help Defense setup logic
            const pid = playState.resolvedDepth.offense[slot];
            initialOffenseStates.push({ slot, x: startX, y: startY, id: pid });
        });
    }

    // --- Helper function to set up players for one side ---
    const setupSide = (team, side, formationData, isOffense, initialOffenseStates) => {
        if (!team || !team.roster || !formationData || !formationData.slots || !formationData.coordinates) {
            console.error(`setupInitialPlayerStates: Invalid data for ${side} team ${team?.name}`);
            return;
        }

        const sortedSlots = [...formationData.slots].sort((a, b) => {
            if (a.startsWith('QB')) return -1;
            if (b.startsWith('QB')) return 1;
            if (a.startsWith('C') || a.startsWith('OL')) return -1;
            if (b.startsWith('C') || b.startsWith('OL')) return 1;
            return 0;
        });

        const coveredManTargets = new Set();

        // 💡 DEFINE STAR STOPPER VARIABLES HERE TO PREVENT REFERENCE ERRORS
        let doubleTeamTargetSlot = null;
        let doubleTeamDefenderSlot = null;

        // Loop through slots and create player states
        sortedSlots.forEach(slot => {
            let action = 'idle';
            let assignment = isOffense ? (assignments?.[slot]) : (defAssignments[slot] || 'def_read');
            let targetX = 0;
            let targetY = 0;
            let routePath = null;
            let assignedPlayerId = null;

            // 💡 FIX: Define these outside the QB check so they are available for pState
            let readProgression = [];
            let currentReadTargetSlot = null;
            let ticksOnCurrentRead = 0;

            // --- A. Find Player ID from Resolved Depth ---
            const playerId = playState.resolvedDepth[side]?.[slot];
            const player = getRosterObjects(team).find(p => p.id === playerId);

            if (!player) return; // Skip empty slots

            // Initial Coords
            const relCoords = formationData.coordinates[slot] || [0, 0];
            let startX = ballX + relCoords[0];
            let startY = playState.lineOfScrimmage + relCoords[1];

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
                    assignment = playState.type === 'pass' ? 'pass_block' : 'run_block';

                    if (isPlayAction && assignment === 'pass_block') {
                        action = 'run_block';
                    } else {
                        action = assignment;
                    }
                    targetY = startY + (action === 'pass_block' ? -0.5 : 0.5);
                } else if (slot.startsWith('QB')) {
                    if (play.type === 'punt') {
                        assignment = 'punt';
                        action = 'punt_kick';
                        targetY = startY - 5;
                        targetX = startX;
                    }
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

                if (assignment && assignment.startsWith('man_cover_')) {
                    const targetSlot = assignment.replace('man_cover_', '');
                    const targetPlayer = initialOffenseStates.find(o => o.slot === targetSlot);
                    if (targetPlayer) {
                        assignedPlayerId = targetPlayer.id;
                    } else {
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

                // --- 🛡️ APPLY DOUBLE TEAM OVERRIDE ---
                if (!isOffense && slot === doubleTeamDefenderSlot && doubleTeamTargetSlot) {
                    assignment = `man_cover_${doubleTeamTargetSlot}`;
                }

                // 1. Man Coverage
                if (assignment.startsWith('man_cover_')) {
                    const targetSlot = assignment.split('man_cover_')[1];
                    const targetOffPlayer = initialOffenseStates.find(o => o.slot === targetSlot);

                    if (targetOffPlayer) {
                        let xOffset, yOffset;

                        if (targetSlot.includes('SLOT') || targetSlot === 'RB') {
                            xOffset = targetOffPlayer.x < CENTER_X ? 0.3 : -0.3;
                            yOffset = 0.2;
                        } else if (targetSlot.includes('WR') || targetSlot === 'WR1' || targetSlot === 'WR2' || targetSlot === 'WR3') {
                            xOffset = targetOffPlayer.x < CENTER_X ? 0.8 : -0.8;
                            yOffset = 0.5;
                        } else if (targetSlot.includes('TE') || targetSlot === 'TE') {
                            xOffset = targetOffPlayer.x < CENTER_X ? 1.0 : -1.0;
                            yOffset = 0.7;
                        } else {
                            xOffset = targetOffPlayer.x < CENTER_X ? 0.8 : -0.8;
                            yOffset = 0.5;
                        }

                        startX = targetOffPlayer.x + xOffset;
                        startY = targetOffPlayer.y + yOffset;
                        targetX = startX; targetY = startY;
                        assignedPlayerId = targetOffPlayer.id;
                    } else {
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
                role: slot.replace(/\d+/g, ''),
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
    const defenseFormationData = defenseFormations[defense.formations.defense] || defenseFormations['3-1-3'];
    setupSide(offense, 'offense', offenseFormationData, true, initialOffenseStates);
    setupSide(defense, 'defense', defenseFormationData, false, initialOffenseStates);

    // --- Set Initial Ball Position & Carrier ---
    const qbState = playState.activePlayers.find(
        p => p.isOffense && p.slot.startsWith('QB')
    );
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
    const gainedYards = result.yards || 0;
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
/**
 * Updates player targets based on their current action, assignment, and game state.
 * FEATURES: IQ Scaling, Elastic Man Coverage, Safety Help, Zone Logic, Smart Pursuit.
 */
/**
 * Updates player targets based on their current action, assignment, and game state.
 * FEATURES: IQ Scaling, Elastic Man Coverage, Safety Help, Zone Logic, Smart Pursuit.
 */
function updatePlayerTargets(playState, offenseStates, defenseStates, ballCarrierState, playType, offensivePlayKey, offensiveAssignments, defensivePlayKey, gameLog) {
    const qbState = offenseStates.find(p => p.slot?.startsWith('QB'));
    const isBallInAir = playState.ballState.inAir;
    const ballPos = playState.ballState;
    const LOS = playState.lineOfScrimmage;
    const POCKET_DEPTH_PASS = -1.5;
    const olAssignedDefenders = new Set();

    // --- 1. LOOSE BALL LOGIC (Emergency) ---
    if (playState.ballState.isLoose) {
        playState.activePlayers.forEach(pState => {
            if (pState.stunnedTicks === 0 && !pState.isEngaged) {
                pState.targetX = playState.ballState.x;
                pState.targetY = playState.ballState.y;
                pState.action = 'pursuit';
            }
        });
        return;
    }

    // --- 2. BLOCKING LOGIC (O-Line) ---
    // Identify threats for blockers
    const allThreats = defenseStates.filter(d => !d.isBlocked && !d.isEngaged && !d.assignment?.startsWith('man_cover_'));
    const linemen = offenseStates.filter(p => !p.isEngaged && p.slot.startsWith('OL'));
    const otherBlockers = offenseStates.filter(p => !p.isEngaged && !p.slot.startsWith('OL') && (p.action === 'pass_block' || p.action === 'run_block'));

    const assignBlockerTarget = (blocker, threats) => {
        if (blocker.isEngaged) return;

        // Find nearest unengaged threat within visual range
        const target = threats.sort((a, b) => getDistance(blocker, a) - getDistance(blocker, b))[0];

        if (target && getDistance(blocker, target) < 5.0) {
            blocker.dynamicTargetId = target.id;
            blocker.targetX = target.x;
            blocker.targetY = target.y;

            // Auto-Engage if close enough
            if (getDistance(blocker, target) < 1.5) {
                blocker.isEngaged = true;
                blocker.engagedWith = target.id;
                target.isEngaged = true;
                target.isBlocked = true;
                target.blockedBy = blocker.id;
                playState.blockBattles.push({
                    blockerId: blocker.id, defenderId: target.id, status: 'ongoing', battleScore: 0, startTick: playState.tick
                });
            }
        } else {
            // No immediate threat: drop to depth or push run lane
            blocker.dynamicTargetId = null;
            if (playType === 'pass') {
                blocker.targetX = blocker.initialX;
                blocker.targetY = LOS + POCKET_DEPTH_PASS;
            } else {
                blocker.targetX = blocker.initialX;
                blocker.targetY = blocker.y + 2.0; // Push forward
            }
        }
    };

    linemen.forEach(ol => assignBlockerTarget(ol, allThreats.filter(d => !olAssignedDefenders.has(d.id))));
    otherBlockers.forEach(b => assignBlockerTarget(b, allThreats));


    // ===========================================================
    // MAIN PLAYER LOOP
    // ===========================================================
    playState.activePlayers.forEach(pState => {
        // Global Status Checks
        if (pState.stunnedTicks > 0) {
            pState.stunnedTicks--;
            return;
        }
        if (pState.isBlocked || pState.isEngaged) return;

        // --- 💡 NEW: SPECIAL TEAMS OVERRIDE (Punt Logic) ---
        // This forces players to ignore normal routes/zones during a punt
        if (playType === 'punt') {
            const isKickingTeam = pState.isOffense; // Team that kicked
            const isReturnTeam = !pState.isOffense; // Team receiving
            const ballInAir = playState.ballState.inAir;
            const returnerHasBall = ballCarrierState && !ballCarrierState.isOffense;

            // A. KICKING TEAM AI (The Gunners)
            if (isKickingTeam) {
                // 1. Before Kick: Protect the Punter
                if (!ballInAir && !returnerHasBall && ballPos.y < LOS + 5) {
                    if (pState.slot === 'QB1') return; // Punter handles themselves
                    // Blockers hold the line
                    if (!pState.dynamicTargetId) {
                        pState.targetX = pState.initialX;
                        pState.targetY = LOS;
                    }
                    return;
                }

                // 2. After Kick: HUNT THE BALL
                // Ignore "positions" - everyone is a tackler now.
                pState.action = 'pursuit';

                if (returnerHasBall) {
                    // Chase the returner
                    const dist = getDistance(pState, ballCarrierState);
                    const lead = dist / 15;
                    pState.targetX = ballCarrierState.x + (ballCarrierState.velocity?.x || 0) * lead;
                    pState.targetY = ballCarrierState.y + (ballCarrierState.velocity?.y || 0) * lead;
                } else {
                    // Chase the ball in the air (run to landing spot)
                    pState.targetX = ballPos.targetX || ballPos.x;
                    pState.targetY = ballPos.targetY || ballPos.y;
                }
                return; // Stop processing normal offense logic
            }

            // B. RETURN TEAM AI
            if (isReturnTeam) {
                // 1. THE RETURNER (The guy supposed to catch it)
                // We identify them by their assignment OR if they already have the ball
                if (pState.assignment === 'punt_return' || pState.isBallCarrier) {

                    if (pState.isBallCarrier) {
                        // Phase 2: RUN! (Handled by the "0. TURNOVER RETURN" block at the start of the function)
                        // We return here to let that specific logic take over.
                        return;
                    }
                    else if (ballInAir) {
                        // Phase 1: Go to Landing Spot
                        // 💡 FIX: Don't block! Run to where the ball is going!
                        const landX = ballPos.targetX || ballPos.x;
                        const landY = ballPos.targetY || ballPos.y;

                        pState.targetX = landX;
                        pState.targetY = landY;
                        pState.action = 'pursuit'; // Use pursuit speed/animation

                        // "Camping" logic: If close, stop and wait
                        if (getDistance(pState, { x: landX, y: landY }) < 1.0) {
                            pState.targetX = pState.x;
                            pState.targetY = pState.y;
                        }
                        return;
                    }
                }
                // 2. The Blockers
                else {
                    if (returnerHasBall) {
                        // LEAD BLOCK logic...
                        const returnerY = ballCarrierState.y;
                        const threat = offenseStates
                            .filter(e => !e.isBlocked && !e.isEngaged && e.y < returnerY + 15 && e.y > returnerY - 5)
                            .sort((a, b) => getDistance(pState, a) - getDistance(pState, b))[0];

                        if (threat) {
                            pState.targetX = threat.x;
                            pState.targetY = threat.y;
                            if (getDistance(pState, threat) < 2.0) {
                                pState.isEngaged = true;
                                pState.engagedWith = threat.id;
                                threat.isEngaged = true;
                                threat.isBlocked = true;
                                threat.blockedBy = pState.id;
                            }
                        } else {
                            // Escort
                            pState.targetX = ballCarrierState.x + (pState.x < ballCarrierState.x ? -3 : 3);
                            pState.targetY = ballCarrierState.y - 2;
                        }
                    } else {
                        // WALL BUILDING (Ball in air)
                        const landY = ballPos.targetY || 20;
                        const landX = ballPos.targetX || CENTER_X;
                        const xOffset = (pState.initialX - CENTER_X) * 0.8;
                        pState.targetX = landX + xOffset;
                        pState.targetY = Math.max(landY - 15, 10); // Set wall 15 yards in front of returner
                    }
                    pState.action = 'run_block';
                    return;
                }
            }
        }
        // --- END SPECIAL TEAMS OVERRIDE ---

        // ------------------------------------------
        // A. OFFENSE AI
        // ------------------------------------------
        if (pState.isOffense) {
            if (pState.hasBall) return; // Carrier moved by physics engine

            switch (pState.action) {
                case 'run_route':
                    // FIX: Safe Route Indexing
                    if (!pState.routePath || pState.currentPathIndex >= pState.routePath.length) {
                        pState.action = 'route_complete';
                        break;
                    }
                    const pt = pState.routePath[pState.currentPathIndex];

                    // Intelligent Route Running: Avoid defenders in path
                    let targetX = pt.x;
                    let targetY = pt.y;

                    const obstacle = defenseStates.find(d => !d.isEngaged && getDistance(pState, d) < 1.5 && d.y > pState.y);
                    if (obstacle) {
                        // Side step obstacle based on initial leverage
                        const sideStep = (pState.initialX > obstacle.initialX) ? 1.0 : -1.0;
                        targetX = obstacle.x + sideStep;
                    }

                    pState.targetX = targetX;
                    pState.targetY = targetY;

                    if (getDistance(pState, { x: targetX, y: targetY }) < 0.5) pState.currentPathIndex++;
                    break;

                case 'route_complete':
                    // Freestyle: Find open grass
                    // (Simple logic: stay put or drift slightly away from nearest defender)
                    break;

                case 'pass_block':
                case 'run_block':
                    if (!pState.dynamicTargetId) {
                        pState.targetX = pState.initialX;
                        pState.targetY = (pState.action === 'pass_block') ? LOS - 1.5 : pState.y + 1;
                    }
                    break;
            }
            return; // End Offense Loop
        }

        // ------------------------------------------
        // B. DEFENSE AI
        // ------------------------------------------

        // 1. DIAGNOSIS (IQ-Based Read)
        // Returns 'run', 'pass', or 'read'
        const playDiagnosis = diagnosePlay(pState, playType, offensivePlayKey, playState.tick);
        const isRunRead = playDiagnosis === 'run';

        // 2. CONTEXT ANALYSIS
        const carrierIsQB = ballCarrierState && ballCarrierState.slot.startsWith('QB');
        const isBallPastLOS = ballCarrierState && ballCarrierState.y > LOS + 0.5;
        const qbScrambling = carrierIsQB && (isBallPastLOS || ballCarrierState.action === 'qb_scramble');
        const assignment = pState.assignment;

        // 3. PURSUIT DECISION MATRIX
        let shouldPursue = false;

        if (ballCarrierState) {
            if (isBallInAir) {
                // Ball in air -> logic handled in Reaction Phase below
                shouldPursue = false;
            } else if (!carrierIsQB) {
                // RB/WR has ball -> CHASE (unless disciplined)
                shouldPursue = true;
            } else if (qbScrambling) {
                // QB running -> CHASE
                shouldPursue = true;
            } else {
                // QB in pocket -> Only Blitzers chase
                if (assignment?.includes('blitz') || assignment?.includes('rush')) {
                    shouldPursue = true;
                }
            }
        }

        // 4. DISCIPLINE CHECK (The "Stay Home" Fix)
        // If assigned Man Coverage, do NOT pursue unless target has ball or QB is definitely running
        if (assignment?.startsWith('man_cover_') && shouldPursue) {
            const targetSlot = assignment.replace('man_cover_', '');
            const carrierSlot = ballCarrierState?.slot;

            // If the carrier is NOT my guy, and it's not a confirmed run play yet...
            if (carrierSlot !== targetSlot && !isRunRead && !qbScrambling) {
                shouldPursue = false; // Stay with man!
            }
        }

        // Zone LBs shouldn't chase a QB in the pocket (Spy logic covers this)
        if (assignment?.startsWith('zone_') && pState.slot.startsWith('LB') && carrierIsQB && !qbScrambling) {
            shouldPursue = false;
        }

        // --- EXECUTE MOVEMENT BASED ON DECISION ---

        if (shouldPursue && ballCarrierState) {
            // PURSUIT: Lead the target
            const dist = getDistance(pState, ballCarrierState);
            const leadTime = dist / 15; // Prediction factor
            pState.targetX = ballCarrierState.x + (ballCarrierState.velocity?.x || 0) * leadTime;
            pState.targetY = ballCarrierState.y + (ballCarrierState.velocity?.y || 0) * leadTime;
            pState.action = 'pursuit';
        }
        else if (isBallInAir) {
            // BALL REACTION:
            // High IQ players react to the ball destination immediately.
            // Low IQ players wait.
            const iq = pState.playbookIQ || 50;
            const flightTime = playState.tick - (playState.ballState.throwTick || 0);
            const reactionDelay = Math.max(0, 15 - Math.floor(iq / 7));

            if (flightTime > reactionDelay) {
                // Ball is live to them
                if (assignment?.startsWith('man_cover_')) {
                    // Man Cover: Only break if ball is close OR thrown to my man
                    const targetRecId = playState.ballState.targetPlayerId;
                    const myManId = pState.assignedPlayerId;

                    if (targetRecId === myManId || getDistance(pState, playState.ballState) < 5.0) {
                        pState.targetX = playState.ballState.targetX;
                        pState.targetY = playState.ballState.targetY;
                    }
                    // Else: Stay with man (Logic falls through to Assignment block below)
                } else {
                    // Zone: Break on ball
                    pState.targetX = playState.ballState.targetX;
                    pState.targetY = playState.ballState.targetY;
                }
            } else {
                // Too dumb to react yet -> Stick to Assignment
                executeAssignment(pState, assignment, offenseStates, LOS, playState);
            }
        }
        else {
            // PRE-PLAY / READ PHASE -> Execute Assignment
            executeAssignment(pState, assignment, offenseStates, LOS, playState);
        }

        // Final Clamp
        pState.targetX = Math.max(1, Math.min(52, pState.targetX));
        pState.targetY = Math.max(1, Math.min(119, pState.targetY));
    });
}

/**
 * HELPER: Executes specific defensive assignments (Man, Zone, Spy, Rush).
 * Separated for clarity and reuse.
 */
function executeAssignment(pState, assignment, offenseStates, LOS, playState) {

    // 1. SAFETY HELP (High Level Logic)
    if (pState.slot.startsWith('S') && !assignment.includes('blitz')) {
        const safetyHelp = calculateSafetyHelp(pState, playState.activePlayers.filter(p => !p.isOffense), offenseStates, null, playState, false);
        if (safetyHelp && safetyHelp.type === 'help') {
            pState.targetX = safetyHelp.helpX;
            pState.targetY = safetyHelp.helpY;
            return;
        }
    }

    // 2. MAN COVERAGE (Elastic Band + IQ Prediction)
    if (assignment?.startsWith('man_cover_')) {
        const targetSlot = assignment.replace('man_cover_', '');
        // Find target (prefer ID, fallback to slot)
        let targetRec = pState.assignedPlayerId ? offenseStates.find(o => o.id === pState.assignedPlayerId) : null;
        if (!targetRec) targetRec = offenseStates.find(o => o.slot === targetSlot);

        if (targetRec) {
            // -- Attributes --
            const defSpeed = pState.speed || 50;
            const recSpeed = targetRec.speed || 50;
            const defIQ = pState.playbookIQ || 50;

            // -- Leverage Logic --
            // If I am slower, give cushion. If faster, press.
            const speedDiff = recSpeed - defSpeed;
            let cushionY = (targetRec.y > LOS + 15) ? 2.5 : 1.5;
            if (speedDiff > 10) cushionY += 2.0; // Respect speed

            // Inside Shade (Force outside)
            const cushionX = (targetRec.x < CENTER_X) ? 0.5 : -0.5;

            let perfectX = targetRec.x + cushionX;
            let perfectY = targetRec.y + cushionY;

            // -- IQ Prediction --
            // Smart players aim where the receiver is GOING
            if (defIQ > 70 && targetRec.action === 'run_route') {
                // Simple velocity prediction
                // If receiver moved, project that movement forward
                // (This is simulated as we don't store prevX in this scope, but we can assume 'routePath' intent)
                // For safety, we just stick tight to the perfect spot.
            }

            pState.targetX = perfectX;
            pState.targetY = perfectY;
        } else {
            // Lost target -> Zone default
            const z = getZoneCenter('zone_short_middle', LOS);
            pState.targetX = z.x;
            pState.targetY = z.y;
        }
    }

    // 3. ZONE COVERAGE (Smart Zones)
    else if (assignment?.startsWith('zone_')) {
        const zoneCenter = getZoneCenter(assignment, LOS);

        // "Safety Vision" - Scan for deep threats in my zone
        const isDeep = assignment.includes('deep') || pState.slot.startsWith('S');
        let threatFound = false;

        if (isDeep) {
            const deepThreat = offenseStates.find(o =>
                o.y > LOS + 12 && // Deep
                Math.abs(o.x - zoneCenter.x) < 8.0 && // In my lane
                o.action.includes('route')
            );
            if (deepThreat) {
                // Cap the route! Stay on top.
                pState.targetX = deepThreat.x;
                pState.targetY = Math.max(zoneCenter.y, deepThreat.y + 3.0);
                threatFound = true;
            }
        }

        // "Hard Flat" - Jump short routes
        if (!threatFound && assignment.includes('flat')) {
            const shortThreat = offenseStates.find(o =>
                o.y < LOS + 8 &&
                Math.abs(o.x - zoneCenter.x) < 6.0 &&
                o.action.includes('route')
            );
            if (shortThreat) {
                pState.targetX = shortThreat.x;
                pState.targetY = shortThreat.y + 1.0; // Play tight
                threatFound = true;
            }
        }

        if (!threatFound) {
            pState.targetX = zoneCenter.x;
            pState.targetY = zoneCenter.y;
        }
    }

    // 4. QB SPY (Mirroring)
    else if (assignment === 'spy_QB') {
        const qb = offenseStates.find(p => p.slot.startsWith('QB'));
        if (qb) {
            // Mirror X, Hold Y Depth
            pState.targetX = qb.x;
            pState.targetY = Math.max(LOS + 3.0, pState.y); // Don't drift too deep, don't rush yet
        } else {
            pState.targetX = pState.initialX;
            pState.targetY = LOS + 4.0;
        }
    }

    // 5. BLITZ / RUSH
    else if (assignment?.includes('rush') || assignment?.includes('blitz')) {
        const qb = offenseStates.find(p => p.slot.startsWith('QB'));
        if (qb) {
            pState.targetX = qb.x;
            pState.targetY = qb.y;
        } else {
            // Rush straight ahead
            pState.targetX = pState.x;
            pState.targetY = LOS - 5;
        }
    }
}

/**
 * Checks for block engagements based on proximity.
 * 💡 IMPROVED: More realistic blocking interactions with strength calculations
 */
function checkBlockCollisions(playState) {
    const blockers = playState.activePlayers.filter(p => p.isOffense && !p.isEngaged && p.stunnedTicks === 0);
    const defenders = playState.activePlayers.filter(p => !p.isOffense && !p.isEngaged && p.stunnedTicks === 0);

    blockers.forEach(blocker => {
        // 1. Valid Actions Only
        if (blocker.action !== 'pass_block' && blocker.action !== 'run_block') return;

        let target = null;

        // 2. Priority: Assigned Target (from AI targeting)
        if (blocker.dynamicTargetId) {
            target = defenders.find(d => d.id === blocker.dynamicTargetId);
            // Verify target is still valid/close
            if (!target || target.isEngaged || getDistance(blocker, target) > BLOCK_ENGAGE_RANGE) {
                target = null; // Lost him
            }
        }

        // 3. Fallback: Any Defender in Range (Gap help)
        if (!target) {
            // Sort by proximity
            target = defenders
                .filter(d => getDistance(blocker, d) < BLOCK_ENGAGE_RANGE)
                .sort((a, b) => getDistance(blocker, a) - getDistance(blocker, b))[0];
        }

        // 4. Engage
        if (target) {
            // Calculate Strength Win/Loss immediately to set initial momentum
            const strDiff = (blocker.strength || 50) - (target.strength || 50);

            // Link them
            blocker.isEngaged = true;
            blocker.engagedWith = target.id;
            target.isEngaged = true;
            target.isBlocked = true;
            target.blockedBy = blocker.id;

            // Add to Battle Queue
            playState.blockBattles.push({
                blockerId: blocker.id,
                defenderId: target.id,
                status: 'ongoing',
                battleScore: strDiff / 10, // Initial advantage
                startTick: playState.tick
            });
        }
    });
}
function checkTackleCollisions(playState, gameLog) {
    // 1. Find Ball Carrier
    const carrier = playState.activePlayers.find(p => p.hasBall && !playState.ballState.isLoose);
    if (!carrier) return false;

    // 2. Find Active Defenders in Range
    // Note: We filter out stunned/blocked defenders
    const defenders = playState.activePlayers.filter(p =>
        p.teamId !== carrier.teamId &&
        !p.isBlocked &&
        p.stunnedTicks === 0 &&
        getDistance(p, carrier) < TACKLE_RANGE
    );

    for (const defender of defenders) {
        // A. Check Fumble First
        if (checkFumble(carrier, defender, playState, gameLog)) {
            return false; // Play continues as loose ball
        }

        // B. Calculate Tackle Probability (The "Truck Stick" Check)
        const tacklerSkill = ((defender.tackling || 50) + (defender.strength || 50)) / 2;
        const runnerSkill = ((carrier.agility || 50) + (carrier.strength || 50)) / 2;

        // Momentum: Heavier runner harder to tackle
        const weightDiff = (carrier.weight || 200) - (defender.weight || 200);
        const momentumBonus = Math.max(0, weightDiff / 1000);

        // Diminishing returns on broken tackles in same play
        const fatigueFactor = 1.0 - ((carrier.tacklesBrokenThisPlay || 0) * 0.2);

        let successChance = 0.70 + ((tacklerSkill - runnerSkill) * 0.01) - momentumBonus;
        successChance = Math.max(0.30, Math.min(0.98, successChance)); // Clamp 30%-98%

        if (Math.random() < successChance) {
            // --- TACKLE SUCCESS ---
            playState.yards = carrier.y - playState.lineOfScrimmage;
            playState.playIsLive = false; // Stop Game Loop

            // Defer Stat
            playState.statEvents.push({ type: 'tackle', playerId: defender.id });

            // Logic: Scoring / Outcomes
            const isSack = carrier.role === 'QB' && carrier.y < playState.lineOfScrimmage && playState.type === 'pass';
            const isSafety = (carrier.isOffense && carrier.y <= 10.0) || (!carrier.isOffense && carrier.y >= 110.0);

            if (isSafety) {
                playState.safety = true;
                if (gameLog) gameLog.push(`🚨 SAFETY! ${carrier.name} tackled in endzone by ${defender.name}!`);
            } else if (isSack) {
                playState.sack = true;
                playState.yards = Math.floor(playState.yards); // Round down sacks
                playState.statEvents.push({ type: 'sack', playerId: defender.id, qbId: carrier.id });
                if (gameLog) gameLog.push(`💥 SACK! ${defender.name} drops ${carrier.name} for loss of ${Math.abs(playState.yards)}!`);
            } else {
                if (gameLog) gameLog.push(`✋ ${carrier.name} tackled by ${defender.name}.`);
            }
            return true; // End Play

        } else {
            // --- BROKEN TACKLE ---
            if (!carrier.tacklesBrokenThisPlay) carrier.tacklesBrokenThisPlay = 0;
            carrier.tacklesBrokenThisPlay++;

            // Visuals
            carrier.action = 'juke';
            carrier.jukeTicks = 10; // Visual flair duration
            defender.stunnedTicks = 30; // Defender falls down

            if (gameLog) gameLog.push(`💪 ${carrier.name} breaks the tackle from ${defender.name}!`);
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

    const playersInRange = playState.activePlayers.filter(p =>
        p.stunnedTicks === 0 &&
        !p.isEngaged &&
        getDistance(p, ballPos) < TACKLE_RANGE
    );

    if (playersInRange.length === 0) {
        return null;
    }

    let bestPlayer = null;
    let maxScore = -Infinity;

    playersInRange.forEach(p => {
        const skill =
            (p.agility * 0.4) +
            (p.catchingHands * 0.4) +
            (p.toughness * 0.2);

        const distance = getDistance(p, ballPos);
        const proximityBonus = (TACKLE_RANGE - distance) * 50;
        const roll = getRandomInt(-10, 10);

        const finalScore = skill + proximityBonus + roll;

        if (finalScore > maxScore) {
            maxScore = finalScore;
            bestPlayer = p;
        }
    });

    if (!bestPlayer) return null;

    const offenseTeamId = playState.activePlayers.find(p => p.isOffense)?.teamId;
    const possessionChange = bestPlayer.teamId !== offenseTeamId;

    return {
        playerState: bestPlayer,
        possessionChange,
        recoveryTeamId: bestPlayer.teamId
    };
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
/**
 * ADVANCED QB AI
 * Features: Geometric Lane Logic, IQ-Based Read Times, Physics-Based Lead Passing, Pressure Panic
 */
function updateQBDecision(qbState, offenseStates, defenseStates, playState, offensiveAssignments, gameLog) {

    // --- 0. VALIDATION CHECKS ---
    // Exit if ball is already in air, QB doesn't have it, or QB is running/tackled
    if (!qbState || !qbState.hasBall || playState.ballState.inAir) return;
    if (qbState.isBallCarrier && qbState.action !== 'qb_setup' && qbState.action !== 'qb_scramble') return;

    // Get Full Player Object for Attributes
    // (Assuming you have a helper getPlayer(id) available globally or imported)
    // If not, we fallback to defaults
    const qbAttrs = qbState.attributes || { mental: { playbookIQ: 50 }, physical: { agility: 50, strength: 50 }, technical: { throwingAccuracy: 50 } };

    const qbIQ = Math.max(20, Math.min(99, qbAttrs.mental?.playbookIQ ?? 50));
    const qbAgility = qbAttrs.physical?.agility || 50;
    const qbStrength = qbAttrs.physical?.strength || 50;
    const qbAcc = qbAttrs.technical?.throwingAccuracy || 50;

    // Ensure Progression Exists
    const progression = Array.isArray(qbState.readProgression) && qbState.readProgression.length > 0
        ? qbState.readProgression
        : offenseStates.filter(p => p.slot.startsWith('WR') || p.slot.startsWith('RB')).map(p => p.slot); // Fallback

    // Initialize state trackers if missing
    if (typeof qbState.ticksOnCurrentRead === 'undefined') qbState.ticksOnCurrentRead = 0;
    if (typeof qbState.currentReadTargetSlot === 'undefined') qbState.currentReadTargetSlot = progression[0];

    // --- 0.5 SCRAMBLE DRILL LOGIC (New) ---
    // If scrambling, abandon structured reads. Scan EVERYONE continuously.
    if (qbState.action === 'qb_scramble') {
        // 1. Scan all eligible receivers
        const allReceivers = offenseStates.filter(p => p.slot !== 'QB1' && p.action.includes('route'));

        let bestTarget = null;
        let bestScore = -1;

        allReceivers.forEach(rec => {
            const info = getTargetInfo(rec.slot);
            if (info && info.separation > 1.5) {
                // Score based on Depth (Deep is better in scramble drill) and Openness
                // Bonus if they are on the same side of the field as the scrambling QB
                const onSameSide = Math.sign(rec.x - CENTER_X) === Math.sign(qbState.x - CENTER_X);
                const score = (info.distFromQB * 0.5) + (info.separation * 2.0) + (onSameSide ? 5 : 0);

                if (score > bestScore) {
                    bestScore = score;
                    bestTarget = rec;
                }
            }
        });

        // 2. Decision: Throw or Keep Running?
        if (bestTarget && bestScore > 15) { // Threshold to throw
            // APPLY THROW ON RUN PENALTY
            // 50 Agility = 0.5x Accuracy, 99 Agility = 0.9x Accuracy
            const onTheRunMod = (qbAgility / 100) * 0.9;
            const adjustedAcc = qbAcc * onTheRunMod;

            // Force the throw logic to use this penalized accuracy
            // (You would pass 'adjustedAcc' to the throw execution block below)
            targetPlayerState = bestTarget;
            actionTaken = "Throw on Run";
            decisionMade = true;
        } else {
            // Keep running
            return;
        }
    }

    // --- 1. HELPER: GEOMETRIC TARGET ANALYSIS ---
    const getTargetInfo = (slot) => {
        if (!slot) return null;
        const recState = offenseStates.find(r => r.slot === slot);

        // Skip if receiver is blocked, fallen, or not running a route
        if (!recState || (!recState.action.includes('route') && recState.action !== 'idle')) return null;

        const distFromQB = getDistance(qbState, recState);
        let minSeparation = 100;
        const isRunning = recState.action === 'run_route';

        // Check against ALL defenders
        defenseStates.forEach(d => {
            if (!d.isBlocked && !d.isEngaged && d.stunnedTicks === 0) {
                let dist = getDistance(recState, d);

                // 📐 GEOMETRIC UNDERCUT CHECK
                // Is the defender standing ON the line between QB and Receiver?
                const distDefenderToQB = getDistance(qbState, d);

                // Only check if defender is closer to QB than the receiver is (between them)
                if (distDefenderToQB < distFromQB - 1.0) {
                    // Calculate Perpendicular Distance from Defender to the Pass Vector
                    // Area of triangle = 0.5 * base * height => height = (2 * Area) / base
                    const area = Math.abs((d.x - qbState.x) * (recState.y - qbState.y) - (d.y - qbState.y) * (recState.x - qbState.x));
                    const distToLane = area / distFromQB; // This is the "height" (distance to line)

                    // If defender is within 1.5 yards of the passing lane, it's BLOCKED
                    if (distToLane < 1.5) {
                        dist = 0.0; // Effective separation is ZERO (Interception risk)
                    }
                }

                // Trailing Bonus: If defender is strictly BEHIND the receiver, they are "Open" even if close
                // We verify this by checking if Defender Y is 'deeper' than Receiver Y (assuming downfield is +Y)
                // Adjust logic if your field coordinates are different (e.g. Y decreases downfield)
                // Assuming Y increases downfield:
                if (isRunning && d.y < recState.y - 1.0 && dist > 0.1) {
                    dist += 2.0; // Bonus separation because defender has to turn around
                }

                if (dist < minSeparation) minSeparation = dist;
            }
        });

        return { state: recState, separation: minSeparation, distFromQB };
    };

    // --- 2. ASSESS PRESSURE ---
    // Find unblocked defenders close to QB
    const pressureDefender = defenseStates.find(d => !d.isBlocked && !d.isEngaged && getDistance(qbState, d) < 4.5);
    const isPressured = !!pressureDefender;
    const imminentSackDefender = isPressured && getDistance(qbState, pressureDefender) < 1.8;

    // --- 3. READ PROGRESSION LOGIC (IQ SCALED) ---
    const isPrimaryRead = qbState.currentReadTargetSlot === progression[0];

    // Ticks required to "process" the current read
    // Base: 60 ticks (3s) for primary, 30 ticks (1.5s) for checks
    const baseTime = isPrimaryRead ? 60 : 30;

    // IQ Modifier: 99 IQ processes 2x faster than 50 IQ
    const iqModifier = 1.5 - (qbIQ / 100);

    let requiredTimeOnRead = Math.round(baseTime * iqModifier);

    // Pressure Modifier
    if (isPressured) {
        if (qbIQ > 80) requiredTimeOnRead *= 0.7; // Clutch: speeds up
        else requiredTimeOnRead *= 1.2; // Panic: slows down/freezes
    }

    qbState.ticksOnCurrentRead++;

    // Advance to next read if time expired (and not about to die)
    if (!imminentSackDefender && qbState.ticksOnCurrentRead > requiredTimeOnRead) {
        const currIdx = progression.indexOf(qbState.currentReadTargetSlot);
        if (currIdx < progression.length - 1) {
            const nextIdx = currIdx + 1;
            qbState.currentReadTargetSlot = progression[nextIdx];
            qbState.ticksOnCurrentRead = 0;
        }
    }

    // --- 4. DECISION MATRIX ---
    // Constraints
    const MIN_DROPBACK_TICKS = 35; // Don't throw instantly (unless pressured)
    const canThrowStandard = playState.tick > MIN_DROPBACK_TICKS;
    const maxDecisionTimeTicks = 160; // 8 seconds -> Sack logic takes over

    let decisionMade = false;
    let reason = "";

    // A. Forced Decisions (Sacks/Time)
    if (imminentSackDefender) {
        decisionMade = true; reason = "Imminent Sack";
    } else if (playState.tick >= maxDecisionTimeTicks) {
        decisionMade = true; reason = "Time Expired";
    } else if (isPressured && playState.tick >= 50) {
        // Panic Check
        const panicChance = Math.max(0.05, 0.4 - qbIQ / 200);
        if (Math.random() < panicChance) {
            decisionMade = true; reason = "Pressure Panic";
        }
    }

    // B. Analyze Current Read
    const currentReadInfo = getTargetInfo(qbState.currentReadTargetSlot);

    // C. Analyze Checkdown (Last option in progression)
    const checkdownSlot = progression[progression.length - 1];
    const checkdownInfo = (checkdownSlot !== qbState.currentReadTargetSlot) ? getTargetInfo(checkdownSlot) : null;

    // Thresholds
    const OPEN_SEP = isPressured ? 0.8 : 1.2; // Lower standards when scared
    const CHECKDOWN_SEP = 1.0;

    // Scramble Path Check
    const openLane = !defenseStates.some(d =>
        !d.isBlocked && !d.isEngaged &&
        Math.abs(d.x - qbState.x) < 3.5 && (d.y < qbState.y + 1)
    );
    const canScramble = openLane && (isPressured || playState.tick > 80) && (Math.random() < (qbAgility / 100));


    // --- 5. SELECT ACTION ---
    let targetPlayerState = null;
    let actionTaken = "None";

    // DECISION 1: THROW TO READ (If Open & Ready)
    if (!decisionMade && currentReadInfo && currentReadInfo.separation > OPEN_SEP && currentReadInfo.separation > 0.1 && (canThrowStandard || isPressured)) {
        targetPlayerState = currentReadInfo.state;
        actionTaken = "Throw Read";
        decisionMade = true;
    }
    // DECISION 2: CHECKDOWN (If Read Covered & Late in play)
    else if (!decisionMade && checkdownInfo && checkdownInfo.separation > CHECKDOWN_SEP && (playState.tick > 60 || isPressured) && canThrowStandard) {
        targetPlayerState = checkdownInfo.state;
        actionTaken = "Throw Checkdown";
        decisionMade = true;
    }
    // DECISION 3: SCRAMBLE
    else if (!decisionMade && canScramble) {
        actionTaken = "Scramble";
        decisionMade = true;
    }
    // DECISION 4: FORCED (Panic/Sack)
    else if (decisionMade) { // Logic from Block A above
        if (reason === "Imminent Sack") {
            // Hero Throw?
            if (Math.random() > 0.7 && qbAttrs.mental?.clutch > 60) {
                // Find ANYONE
                targetPlayerState = offenseStates.find(o => o.slot !== 'QB1' && o.action.includes('route'));
                if (targetPlayerState) actionTaken = "Forced Throw";
                else actionTaken = "Throw Away";
            } else {
                actionTaken = "Throw Away";
            }
        } else {
            actionTaken = "Throw Away";
        }
    }


    // --- 6. EXECUTE ACTION ---

    if (actionTaken === "Scramble") {
        qbState.action = 'qb_scramble';
        playState.qbIntent = 'scramble';
        if (gameLog) gameLog.push(`🏃 ${qbState.name} tucks it and runs!`);
        return;
    }

    if (actionTaken === "Throw Away") {
        if (gameLog) gameLog.push(`👋 ${qbState.name} throws it away.`);
        playState.ballState.inAir = true;
        playState.ballState.throwInitiated = true;
        playState.ballState.throwerId = qbState.id;
        // Throw to sideline
        const targetX = (qbState.x > CENTER_X) ? 55 : -2;
        const targetY = qbState.y + 10;

        // Simple Physics
        playState.ballState.targetX = targetX;
        playState.ballState.targetY = targetY;
        playState.ballState.vx = (targetX - qbState.x) / 1.5;
        playState.ballState.vy = (targetY - qbState.y) / 1.5;
        playState.ballState.vz = 5;

        qbState.hasBall = false;
        return;
    }

    if (targetPlayerState && actionTaken.includes("Throw")) {
        if (gameLog) gameLog.push(`🏈 ${qbState.name} passes to ${targetPlayerState.name} (${actionTaken})`);

        // PHYSICS-BASED THROWING ENGINE
        const startX = qbState.x;
        const startY = qbState.y;

        // 1. Ball Speed (based on Strength)
        const ballSpeed = 20 + (qbStrength * 0.20); // 20 - 40 yds/sec

        // 2. Predictive Lead Passing
        let aimX = targetPlayerState.x;
        let aimY = targetPlayerState.y;

        if (targetPlayerState.action.includes('route')) {
            const rawDist = Math.sqrt(Math.pow(aimX - startX, 2) + Math.pow(aimY - startY, 2));
            const estTime = rawDist / ballSpeed;

            // Receiver Velocity (Approximate from stats or calculate if available)
            // We use speed stat to estimate how far they travel in `estTime`
            const recSpeedYPS = (targetPlayerState.speed / 100) * 8.0;

            // We need a direction vector for the receiver. 
            // Since we don't track prevX/Y in this scope, we look at their TargetX/Y
            const rDx = targetPlayerState.targetX - targetPlayerState.x;
            const rDy = targetPlayerState.targetY - targetPlayerState.y;
            const rLen = Math.sqrt(rDx * rDx + rDy * rDy);

            if (rLen > 0.1) {
                const leadX = (rDx / rLen) * recSpeedYPS * estTime;
                const leadY = (rDy / rLen) * recSpeedYPS * estTime;
                aimX += leadX;
                aimY += leadY;
            }
        }

        // 3. Accuracy Variance
        const errorMargin = (100 - qbAcc) / 30; // 0 - 3 yards variance
        const angle = Math.random() * Math.PI * 2;
        const distError = Math.random() * errorMargin;
        aimX += Math.cos(angle) * distError;
        aimY += Math.sin(angle) * distError;

        // 4. Calculate Vector
        const dx = aimX - startX;
        const dy = aimY - startY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const t = dist / ballSpeed;

        playState.ballState.inAir = true;
        playState.ballState.throwInitiated = true;
        playState.ballState.throwerId = qbState.id;
        playState.ballState.targetPlayerId = targetPlayerState.id;
        playState.ballState.x = startX;
        playState.ballState.y = startY;
        playState.ballState.z = 1.8;

        playState.ballState.vx = dx / t;
        playState.ballState.vy = dy / t;
        // Arc Math: z = z0 + vz*t - 0.5*g*t^2. We want z(t) = 1.5.
        // vz = (1.5 - 1.8 + 4.9*t^2) / t
        playState.ballState.vz = (-0.3 + (4.9 * t * t)) / t;

        playState.ballState.targetX = aimX; // For debugging/AI reaction
        playState.ballState.targetY = aimY;

        qbState.hasBall = false;
        qbState.isBallCarrier = false;

        // Reset read for next time
        qbState.currentReadTargetSlot = progression[0];
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
/**
 * Handles ball arrival at target coordinates.
 * Handles Catches, Drops, Interceptions, Swats, and Muffed Punts.
 */
function handleBallArrival(playState, ballCarrierState, playResult, gameLog) {
    // ===========================================================
    // --- 1. PUNT CATCH LOGIC ---
    // ===========================================================
    if (playState.type === 'punt' && playState.ballState.inAir && playState.ballState.targetPlayerId === null) {

        const ball = playState.ballState;

        // A. GROUND CHECK (Ball hit the floor)
        // 💡 FIX: Use a larger threshold or check velocity direction to catch "through-the-floor" frames
        if (ball.z <= 0.5) {
            // Ball is low enough to be downed or muffed

            // Check if anyone is close enough to touch it (Catch/Muff)
            const CATCH_CHECK_RADIUS = 3.0; // Generous radius for punt catching
            const returnersInRange = playState.activePlayers.filter(p => !p.isOffense && !p.isEngaged && p.stunnedTicks === 0 && getDistance(p, ball) < CATCH_CHECK_RADIUS);

            if (returnersInRange.length > 0) {
                // Someone is there! Try to catch.
                const returnerState = returnersInRange.sort((a, b) => getDistance(a, ball) - getDistance(b, ball))[0];
                const returnerPlayer = getPlayer(returnerState.id);

                // Muff calculation
                const catchingHands = returnerPlayer?.attributes?.technical?.catchingHands || 50;
                const muffChance = 0.05 + (1 - (catchingHands / 100)) * 0.15;

                if (Math.random() < muffChance) {
                    if (gameLog) gameLog.push(`❗ MUFFED PUNT! ${returnerState.name} drops it!`);
                    ball.isLoose = true;
                    ball.inAir = false;
                    ball.z = 0.1;
                    ball.vx *= 0.5; // Slow down bounce
                    ball.vy *= 0.5;
                    returnerState.stunnedTicks = 20;
                    playState.statEvents.push({ type: 'fumble', playerId: returnerState.id });
                    return;
                } else {
                    if (gameLog) gameLog.push(`🏈 Punt caught by ${returnerState.name}.`);
                    playState.turnover = true;
                    ball.inAir = false;
                    ball.isLoose = false;

                    returnerState.isBallCarrier = true;
                    returnerState.hasBall = true;
                    returnerState.action = 'run_path';

                    playState.returnStartY = returnerState.y;

                    // Snap ball to player
                    ball.x = returnerState.x;
                    ball.y = returnerState.y;
                    ball.z = 1.0;

                    // Switch AI Roles
                    playState.activePlayers.forEach(p => {
                        p.hasBall = (p.id === returnerState.id);
                        p.isBallCarrier = (p.id === returnerState.id);
                        if (p.isOffense) p.action = 'pursuit'; // Gunners hunt
                        else if (p.id !== returnerState.id) p.action = 'run_block'; // Blockers block
                    });
                    return;
                }
            }

            // No one caught it? It hit the ground.
            // Slow it down (friction)
            ball.vx *= 0.8;
            ball.vy *= 0.8;
            ball.vz *= -0.5; // Small bounce

            // If it stops moving, blow the whistle
            const speed = Math.sqrt(ball.vx ** 2 + ball.vy ** 2);
            if (speed < 0.5) {
                if (gameLog) gameLog.push(`🛑 Punt downed by gravity.`);
                playState.playIsLive = false;
                playState.finalBallY = ball.y;
                playState.touchback = false;

                // Touchback check
                if (ball.y <= 0) {
                    playState.touchback = true;
                    playState.finalBallY = 20;
                    if (gameLog) gameLog.push("Touchback!");
                }
            }
            return;
        }
    }

    // ===========================================================
    // --- 2. PASS ARRIVAL LOGIC  ---
    // ===========================================================
    if (!playState.ballState.inAir) return;

    const ball = playState.ballState;

    // --- A. GROUND CHECK ---
    // If the ball hits the ground (z <= 0), it's dead.
    if (ball.z <= 0) {
        if (gameLog) gameLog.push(`👋 Pass hits the turf. Incomplete.`);
        playState.incomplete = true;
        playState.playIsLive = false;
        ball.inAir = false;
        return;
    }

    // --- B. CATCHABLE ZONE CHECK ---
    // A ball is only catchable if it is reachable vertically (0 to ~2.8 yards)
    // We REMOVED the check that auto-fails high balls mid-flight. 
    // Now we just ignore them until they come down to a reachable height.
    const MAX_JUMP_HEIGHT = 2.8;
    if (ball.z > MAX_JUMP_HEIGHT) {
        return; // Ball is soaring overhead, wait for it to drop
    }

    // --- C. FIND PLAYERS IN 3D RANGE ---
    const CATCH_RADIUS = 1.2; // Tight radius for actual catch (must be close to body)

    // Find all players close enough to the ball (XY distance)
    const playersInRange = playState.activePlayers.filter(p => {
        const dist = getDistance(p, ball);
        return dist <= CATCH_RADIUS;
    });

    if (playersInRange.length === 0) return; // No one close enough yet

    // Sort by closeness to ball
    playersInRange.sort((a, b) => getDistance(a, ball) - getDistance(b, ball));

    const bestCandidate = playersInRange[0];
    const playerObj = getPlayer(bestCandidate.id);
    if (!playerObj) return;

    // --- D. RESOLVE CATCH ---
    const isDefense = !bestCandidate.isOffense;
    const catching = playerObj.attributes?.technical?.catchingHands || 50;
    const agility = playerObj.attributes?.physical?.agility || 50;

    // Base Chance Calculation
    let catchScore = (catching * 0.7) + (agility * 0.3);

    // Modifiers
    if (isDefense) catchScore -= 25; // Defenders naturally have worse hands
    if (playersInRange.length > 1) catchScore -= 30; // Contested catch penalty

    // Random Roll
    const roll = getRandomInt(0, 100);

    if (roll < catchScore) {
        // --- SUCCESSFUL CATCH / INT ---
        ball.inAir = false;
        ball.caught = true;
        bestCandidate.hasBall = true;
        bestCandidate.isBallCarrier = true;
        bestCandidate.action = 'run_path'; // Switch to running

        if (isDefense) {
            if (gameLog) gameLog.push(`❗ INTERCEPTION! ${bestCandidate.name} picks it off!`);
            playState.interceptionOccurred = true;
            playState.possessionChanged = true;
            playState.turnover = true;
            playResult.outcome = 'turnover';
            playResult.turnoverType = 'interception';

            playState.statEvents.push({ type: 'interception', interceptorId: bestCandidate.id, throwerId: ball.throwerId });
        } else {
            if (gameLog) gameLog.push(`👍 CATCH! ${bestCandidate.name} grabs it!`);
            playResult.outcome = 'complete';

            playState.statEvents.push({ type: 'completion', receiverId: bestCandidate.id, qbId: ball.throwerId, yards: 0 });
        }
    } else {
        // --- DROP / SWAT ---
        if (isDefense) {
            if (gameLog) gameLog.push(`🚫 ${bestCandidate.name} swats the pass away!`);
        } else {
            if (gameLog) gameLog.push(`❌ ${bestCandidate.name} drops the pass!`);
            playState.statEvents.push({ type: 'drop', playerId: bestCandidate.id });
        }

        playState.incomplete = true;
        playState.playIsLive = false;
        ball.inAir = false;
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
    const RADIUS = 0.5; // Yards

    for (let i = 0; i < players.length; i++) {
        const p1 = players[i];
        for (let j = i + 1; j < players.length; j++) {
            const p2 = players[j];

            // Ignore if they are engaged in a block (block logic handles their position)
            if (p1.engagedWith === p2.id) continue;

            const dx = p1.x - p2.x;
            const dy = p1.y - p2.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < RADIUS * 2 && dist > 0.01) {
                const overlap = (RADIUS * 2) - dist;
                const pushX = (dx / dist) * overlap * 0.5;
                const pushY = (dy / dist) * overlap * 0.5;

                // Push p1
                p1.x += pushX;
                p1.y += pushY;

                // Push p2 opposite
                p2.x -= pushX;
                p2.y -= pushY;
            }
        }
    }
}

/**
 * Updates player game stats based on the final play outcome.
 */
function finalizeStats(playState) {
    applyStatEvents(playState.statEvents);
}


function resetPlayerRuntimeState(playerState) {
    playerState.isBallCarrier = false;
    playerState.hasBall = false;
    playerState.isEngaged = false;
    playerState.engagedWith = null;
    playerState.blockedBy = null;
    playerState.action = 'idle';
    playerState.stunnedTicks = 0;
    playerState.jukeTicks = 0;
    playerState.fatigueModifier = 1.0;
}

// =============================================================
// --- resolvePlay FUNCTION ---
// =============================================================

/**
 * Simulates a single play tick-by-tick.
 * The "Main Loop" of the physics engine.
 */
function resolvePlay(offense, defense, offensivePlayKey, defensivePlayKey, context, options, isLive = false) {

    // 1. Extract values from context
    const { gameLog = [], weather, ballOn, ballHash = 'M', down, yardsToGo } = context;
    const fastSim = (options.fastSim === true) && !isLive;

    // --- Define playResult ---
    const playResult = {
        yards: 0,
        outcome: 'live',
        possessionChange: false,
        score: null,
        safety: false,
        touchback: false,
        turnoverType: null
    };

    // --- 2. VALIDATION ---
    if (!offensivePlaybook || !offensivePlaybook[offensivePlayKey]) {
        console.error(`CRITICAL: Play key "${offensivePlayKey}" not found.`);
        playResult.outcome = 'turnover';
        playResult.possessionChange = true;
        return { playResult, finalBallY: ballOn, log: gameLog, visualizationFrames: [] };
    }

    // ===========================================================
    // --- 3. PHASE 1: MACRO AUDIBLE (Whole Play Change) ---
    // ===========================================================
    // The QB looks at the defense *before* setting up the final play.
    
    // We pass the ORIGINAL keys to the AI. If they audible, we update the key.
    const audibleCheck = aiCheckAudible(offense, offensivePlayKey, defense, defensivePlayKey, gameLog);
    
    // Update the key if the QB changed the play
    const finalOffensivePlayKey = audibleCheck.didAudible ? audibleCheck.playKey : offensivePlayKey;
    
    // Load the actual play object (Deep clone to prevent mutating the playbook)
    const play = deepClone(offensivePlaybook[finalOffensivePlayKey]);

    // --- 4. INITIALIZE STATE ---
    let playState = {
        playIsLive: true,
        tick: 0,
        visualizationFrames: isLive ? [] : null,
        maxTicks: 1000,
        type: play.type,
        assignments: deepClone(play.assignments || {}),
        yards: 0, touchdown: false, turnover: false, incomplete: false,
        sack: false, safety: false, touchback: false,
        finalBallY: 0, returnStartY: null,
        possessionChanged: false, fumbleOccurred: false, interceptionOccurred: false,
        statEvents: [],
        ballState: { x: 0, y: 0, z: 1.0, vx: 0, vy: 0, vz: 0, inAir: false, isLoose: false, targetPlayerId: null },
        lineOfScrimmage: ballOn + 10,
        activePlayers: [],
        blockBattles: [],
        resolvedDepth: null
    };

    let firstDownY = 0;
    const goalLineY = 110.0;
    const effectiveYardsToGo = (yardsToGo <= 0 || ballOn >= 90) ? (goalLineY - playState.lineOfScrimmage) : yardsToGo;

    // --- 5. SETUP PLAYERS (Physics Initialization) ---
    try {
        firstDownY = Math.min(playState.lineOfScrimmage + effectiveYardsToGo, goalLineY);

        setupInitialPlayerStates(playState, offense, defense, play, playState.assignments, ballOn, defensivePlayKey, ballHash, finalOffensivePlayKey);

        // Initial Frame (Pre-Snap Huddle View)
        if (isLive && gameLog) {
            playState.visualizationFrames.push({
                players: deepClone(playState.activePlayers),
                ball: deepClone(playState.ballState),
                logIndex: gameLog.length,
                lineOfScrimmage: playState.lineOfScrimmage,
                firstDownY: firstDownY,
                isSnap: true
            });
        }
    } catch (setupError) {
        console.error("CRITICAL ERROR during setup:", setupError);
        playResult.outcome = 'turnover';
        playResult.possessionChange = true;
        return { playResult, finalBallY: ballOn, log: gameLog, visualizationFrames: [] };
    }

    // ===========================================================
    // --- 6. PHASE 2: MICRO AUDIBLE (Route Adjustments) ---
    // ===========================================================
    // Players are set. QB reads specific defender alignments (Blitz/Press).
    
    const qbState = playState.activePlayers.find(p => p.slot === 'QB1' && p.isOffense);
    const qbPlayer = qbState ? getPlayer(qbState.id) : null; // Helper to get RPG stats
    const qbIQ = qbPlayer?.attributes?.mental?.playbookIQ || 50;
    
    const offenseStates = playState.activePlayers.filter(p => p.isOffense);
    const defenseStates = playState.activePlayers.filter(p => !p.isOffense);

    // A. BLITZ PICKUP (IQ 80+)
    // If defenders in box > blockers, keep RB in to block
    const defendersInBox = defenseStates.filter(d => 
        Math.abs(d.y - playState.lineOfScrimmage) < 5.0 && 
        Math.abs(d.x - 26.6) < 10 // Tackle Box
    ).length;
    
    const blockers = offenseStates.filter(p => p.action === 'pass_block' || p.action === 'run_block').length;

    if (defendersInBox > blockers && qbIQ >= 80) {
        const rb = offenseStates.find(p => p.slot.startsWith('RB') && p.action.includes('route'));
        if (rb) {
            if (gameLog && isLive) gameLog.push(`🧠 ${qbState.name} identifies blitz! Keeps RB in to block.`);
            rb.action = 'pass_block';
            rb.assignment = 'pass_block';
            rb.targetX = rb.x + 0.5; // Visual shift
        }
    }

    // B. PRESS COVERAGE BEATER (IQ 90+)
    // If Corner is pressing (< 2 yds) on a short route, convert to Fly
    if (qbIQ >= 90) {
        offenseStates.forEach(wr => {
            if (wr.slot.startsWith('WR') && wr.action === 'run_route') {
                const pressDefender = defenseStates.find(d => getDistance(wr, d) < 2.0 && d.y > wr.y);
                // Check if route is short (less than 10 yards depth in path)
                const isShortRoute = wr.routePath && wr.routePath.every(pt => pt.y < wr.initialY + 10);

                if (pressDefender && isShortRoute) {
                    if (gameLog && isLive) gameLog.push(`🧠 ${qbState.name} checks ${wr.name} to a Go route vs Press!`);
                    // Overwrite with Fly Route
                    wr.routePath = [{ x: wr.x, y: wr.y + 40 }]; 
                    wr.assignment = 'Fly';
                }
            }
        });
    }

    // ===========================================================
    // --- 7. THE PHYSICS LOOP (Tick by Tick) ---
    // ===========================================================
    let ballCarrierState = null;

    try {
        const timeDelta = fastSim ? TICK_DURATION_SECONDS * 10 : TICK_DURATION_SECONDS;
        const loopType = playState.type || 'pass';

        const playerCache = new Map();
        playState.activePlayers.forEach(pState => {
            // Assuming 'game.players' is your global roster array
            const pObj = game.players.find(p => p.id === pState.id);
            if (pObj) playerCache.set(pState.id, pObj);
        });

        while (playState.playIsLive && playState.tick < playState.maxTicks) {
            playState.tick++;

            // --- A. REFERENCES ---
            const ballPos = playState.ballState;
            // Refresh references in case array order changed (unlikely but safe)
            const activeOffense = playState.activePlayers.filter(p => p?.isOffense);
            const activeDefense = playState.activePlayers.filter(p => !p?.isOffense);

            // Find Carrier
            ballCarrierState = playState.activePlayers.find(p => p?.hasBall || p?.isBallCarrier) || null;

            // --- B. DECISION MAKING ---
            if (playState.playIsLive && !ballPos.inAir && !ballPos.isLoose && !playState.turnover && !playState.sack) {
                if (loopType === 'pass' && typeof updateQBDecision === 'function') {
                    // This calls the ADVANCED logic we added earlier
                    updateQBDecision(qbState, activeOffense, activeDefense, playState, playState.assignments, gameLog);
                } else if (loopType === 'punt' && typeof updatePunterDecision === 'function') {
                    updatePunterDecision(playState, activeOffense, gameLog);
                }
            }
            if (!playState.playIsLive) break; 

            // --- C. AI TARGETING ---
            if (typeof updatePlayerTargets === 'function') {
                updatePlayerTargets(
                    playState,
                    activeOffense,
                    activeDefense,
                    ballCarrierState,
                    loopType,
                    finalOffensivePlayKey, // Use the FINAL key (after audible)
                    playState.assignments,
                    defensivePlayKey,
                    gameLog
                );
            }

            // --- D. PLAYER MOVEMENT ---
            playState.activePlayers.forEach(p => {
                try { updatePlayerPosition(p, timeDelta); } catch (e) { /* ignore */ }
            });

            // --- E. BALL PHYSICS & CATCHING ---
            if (ballPos.inAir) {
                // Velocity & Gravity
                ballPos.x += (ballPos.vx || 0) * timeDelta;
                ballPos.y += (ballPos.vy || 0) * timeDelta;
                ballPos.z += (ballPos.vz || 0) * timeDelta;
                ballPos.vz = (ballPos.vz || 0) - 9.8 * timeDelta;

                // Handle Catch/Ground arrival
                if (typeof handleBallArrival === 'function') {
                    handleBallArrival(playState, ballCarrierState, playResult, gameLog);
                }

                // Safety Floor
                if (ballPos.z < 0) {
                    ballPos.z = 0;
                    ballPos.vz = 0;
                    if (ballPos.inAir) ballPos.inAir = false; // Dead ball
                }
            } else if (ballCarrierState) {
                // Ball stuck to player
                ballPos.x = ballCarrierState.x;
                ballPos.y = ballCarrierState.y;
                ballPos.z = 0.5; 
            }

            // --- F. COLLISIONS ---
            if (typeof resolvePlayerCollisions === 'function') resolvePlayerCollisions(playState);

            // --- G. SCORING & BOUNDARIES ---
            if (playState.playIsLive) {
                // Find carrier again to be safe
                ballCarrierState = playState.activePlayers.find(p => p.isBallCarrier);

                if (ballCarrierState) {
                    // 1. OFFENSIVE TOUCHDOWN (Crosses 110 yard line)
                    if (ballCarrierState.isOffense && ballCarrierState.y >= 110.0) {
                        playState.touchdown = true;
                        playState.playIsLive = false;
                        
                        // Clamp visuals to the goal line
                        playState.finalBallY = 110.0;
                        playState.ballState.y = 110.0;
                        
                        // Calculate final yards
                        playState.yards = 110.0 - playState.lineOfScrimmage;
                        
                        if (gameLog) gameLog.push(`🎉 TOUCHDOWN ${ballCarrierState.name}!`);
                        break; // Stop the loop immediately
                    }

                    // 2. DEFENSIVE TOUCHDOWN (Crosses 10 yard line going the other way)
                    // Defense runs "Down" towards Y=10 (The Goal Line they defend is behind them at 110, they score at 10)
                    if (!ballCarrierState.isOffense && ballCarrierState.y <= 10.0) {
                        playState.touchdown = true;
                        playState.playIsLive = false;
                        playState.possessionChanged = true; // Mark as turnover score
                        
                        playState.finalBallY = 10.0;
                        playState.ballState.y = 10.0;
                        
                        if (gameLog) gameLog.push(`🎉 DEFENSIVE TOUCHDOWN!`);
                        break;
                    }

                    // 3. SAFETY (Offense runs out the back of their OWN endzone)
                    // Endzone is 0-10. If they go below 0, it's a safety.
                    if (ballCarrierState.isOffense && ballCarrierState.y <= 0) {
                        playState.safety = true;
                        playState.playIsLive = false;
                        playState.finalBallY = 0;
                        if (gameLog) gameLog.push(`🚨 SAFETY! ${ballCarrierState.name} ran out of the endzone!`);
                        break;
                    }

                    // 4. OUT OF BOUNDS (Sidelines)
                    // Field width is 53.3. 
                    // Buffer of 0.5 yards allows stepping on the line.
                    if (ballCarrierState.x <= 0.5 || ballCarrierState.x >= 52.8) {
                        playState.playIsLive = false;
                        
                        // Calculate yards at the spot they went out
                        playState.yards = ballCarrierState.y - playState.lineOfScrimmage;
                        playState.finalBallY = ballCarrierState.y;
                        
                        if (gameLog) gameLog.push(`💨 ${ballCarrierState.name} steps out of bounds.`);
                        
                        // Check if it was a sack (QB behind line)
                        if (ballCarrierState.role === 'QB' && playState.yards < 0 && playState.type === 'pass') {
                            playState.sack = true;
                            if (gameLog) gameLog.push(`(Sack recorded)`);
                        }
                        break;
                    }
                }
            }

            // --- H. INTERACTIONS (Blocks/Tackles/Fumbles) ---
            if (playState.playIsLive) {
                if (typeof checkBlockCollisions === 'function') checkBlockCollisions(playState);
                if (typeof resolveOngoingBlocks === 'function') resolveOngoingBlocks(playState, gameLog);

                // Tackles
                if (ballCarrierState) {
                    if (typeof checkTackleCollisions === 'function' && checkTackleCollisions(playState, gameLog)) {
                        playState.finalBallY = ballCarrierState.y;
                        playState.yards = ballCarrierState.y - playState.lineOfScrimmage;
                        playState.playIsLive = false;
                        break;
                    }
                }

                // Fumbles
                if (playState.ballState?.isLoose) {
                    if (typeof checkFumbleRecovery === 'function') {
                        const recovery = checkFumbleRecovery(playState, gameLog, 2.0);
                        if (recovery) {
                            const recPlayer = recovery.playerState;
                            playState.ballState.isLoose = false;
                            playState.ballState.inAir = false;
                            recPlayer.hasBall = true;
                            recPlayer.isBallCarrier = true;
                            recPlayer.action = 'run_path';
                            playState.possessionChanged = recovery.possessionChange;
                            playState.returnStartY = recPlayer.y;
                            if (gameLog) gameLog.push(`🏈 ${recPlayer.name} recovers!`);
                        }
                    }
                }
            }

            playState.activePlayers.forEach(p => {
                // 1. Calculate Drain based on intensity
                // Running/Rushing drains 3x faster than standing/blocking
                let drain = (p.action.includes('run') || p.action.includes('rush') || p.action === 'pursuit') ? 0.03 : 0.01;
                
                // 2. Retrieve Cached RPG Object (O(1) lookup)
                const player = playerCache.get(p.id); 
                
                if (player) {
                    // Update persistent fatigue
                    player.fatigue = Math.min(100, (player.fatigue || 0) + drain);
                    
                    // 3. Recalculate Speed Modifier
                    // If Fatigue > Stamina, you slow down. Max penalty is 25% speed loss.
                    const stamina = player.attributes?.physical?.stamina || 50;
                    
                    // Calculate ratio: How tired are you relative to your tank?
                    // Example: 50 Fatigue / 50 Stamina = 1.0 (Full penalty)
                    // Example: 50 Fatigue / 100 Stamina = 0.5 (Half penalty)
                    const fatigueRatio = player.fatigue / Math.max(1, stamina);
                    
                    p.fatigueModifier = Math.max(0.75, 1.0 - (fatigueRatio * 0.25));
                }
            });

            // --- I. VISUALIZER ---
            if (isLive && gameLog) {
                playState.visualizationFrames.push({
                    players: deepClone(playState.activePlayers),
                    ball: deepClone(playState.ballState || {}),
                    logIndex: gameLog.length,
                    lineOfScrimmage: playState.lineOfScrimmage,
                    firstDownY: firstDownY
                });
            }

        } // END TICK LOOP

    } catch (e) {
        console.error("Simulation Loop Crash:", e);
    }

    // ===========================================================
    // --- 8. POST-PLAY CALCULATION (Results) ---
    // ===========================================================

    // Return Yards
    if (playState.returnStartY !== null && ballCarrierState) {
        const returnYards = Math.abs(ballCarrierState.y - playState.returnStartY);
        if (returnYards > 0) {
            playState.statEvents.push({ type: 'return', playerId: ballCarrierState.id, yards: returnYards });
        }
    }

    // End of Play Cleanup
    if (playState.playIsLive && !playState.touchdown && !playState.safety) {
        ballCarrierState = playState.activePlayers.find(p => p.isBallCarrier);
        if (ballCarrierState) {
            playState.yards = ballCarrierState.y - playState.lineOfScrimmage;
            playState.finalBallY = ballCarrierState.y;
            if (gameLog) gameLog.push(`⏱️ Play ends. Gain of ${playState.yards.toFixed(1)}.`);
        } else if (!playState.sack && !playState.turnover) {
            playState.incomplete = true;
            playState.yards = 0;
            playState.finalBallY = playState.ballState.y;
            if (gameLog) gameLog.push("⏱️ Play ends, incomplete.");
        }
    }

    // Result Object Construction
    playResult.yards = Math.round(playState.yards);
    if (playState.sack) playResult.yards = Math.min(0, playResult.yards);
    
    if (playState.incomplete) {
        playResult.outcome = 'incomplete';
        playResult.yards = 0;
    }
    else if (playState.touchdown) {
        playResult.outcome = 'complete';
        playResult.score = 'TD';
    }
    else if (playState.safety) {
        playResult.safety = true;
        playResult.score = 'SAFETY';
    }
    else if (playState.possessionChanged) {
        playResult.outcome = 'turnover';
        playResult.possessionChange = true;
        playResult.turnoverType = playState.interceptionOccurred ? 'interception' : 'fumble';
    }

    // Apply Stats
    applyStatEvents(playState.statEvents);
    playState.activePlayers.forEach(p => resetPlayerRuntimeState(p));

    return {
        playResult,
        finalBallY: playState.finalBallY,
        log: gameLog,
        visualizationFrames: isLive ? playState.visualizationFrames : []
    };
}

function applyStatEvents(statEvents) {
    statEvents.forEach(evt => {
        switch (evt.type) {

            // --- PASSING ---
            case 'pass_attempt': {
                const qb = getPlayer(evt.qbId);
                if (qb) {
                    ensureStats(qb);
                    qb.gameStats.passAttempts++;
                }
                break;
            }

            case 'completion': {
                const qb = getPlayer(evt.qbId);
                const rec = getPlayer(evt.receiverId);
                const yards = Math.round(evt.yards || 0);

                if (qb) {
                    ensureStats(qb);
                    qb.gameStats.passCompletions++;
                    qb.gameStats.passYards += yards;
                }

                if (rec) {
                    ensureStats(rec);
                    rec.gameStats.receptions++;
                    rec.gameStats.recYards += yards;
                }
                break;
            }

            case 'drop': {
                const p = getPlayer(evt.playerId);
                if (p) {
                    ensureStats(p);
                    p.gameStats.drops = (p.gameStats.drops || 0) + 1;
                }
                break;
            }

            case 'interception': {
                const def = getPlayer(evt.interceptorId);
                const qb = getPlayer(evt.throwerId);

                if (def) {
                    ensureStats(def);
                    def.gameStats.interceptions++;
                }

                if (qb) {
                    ensureStats(qb);
                    qb.gameStats.interceptionsThrown++;
                }
                break;
            }

            // --- RUSHING ---
            case 'rush': {
                const runner = getPlayer(evt.runnerId);
                const yards = Math.round(evt.yards || 0);

                if (runner) {
                    ensureStats(runner);
                    runner.gameStats.rushAttempts++;
                    runner.gameStats.rushYards += yards;
                }
                break;
            }

            // --- RETURNS ---
            case 'return': {
                const p = getPlayer(evt.playerId);
                const yards = Math.round(evt.yards || 0);

                if (p) {
                    ensureStats(p);
                    p.gameStats.returnYards += yards;
                }
                break;
            }

            // --- SCORING ---
            case 'touchdown': {
                const p = getPlayer(evt.playerId);
                if (p) {
                    ensureStats(p);
                    p.gameStats.touchdowns++;
                }
                break;
            }

            case 'safety': {
                const p = getPlayer(evt.playerId);
                if (p) {
                    ensureStats(p);
                    p.gameStats.safeties = (p.gameStats.safeties || 0) + 1;
                }
                break;
            }

            // --- TURNOVERS ---
            case 'fumble': {
                const p = getPlayer(evt.playerId);
                if (p) {
                    ensureStats(p);
                    p.gameStats.fumbles++;
                }
                break;
            }

            case 'tackle': {
                const p = getPlayer(evt.playerId);
                if (p) {
                    ensureStats(p);
                    p.gameStats.tackles = (p.gameStats.tackles || 0) + 1;
                }
                break;
            }

            case 'sack': {
                const p = getPlayer(evt.playerId);
                if (p) {
                    ensureStats(p);
                    p.gameStats.sacks = (p.gameStats.sacks || 0) + 1;
                }
                break;
            }

        }
    });
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
    passBias = Math.max(0.05, Math.min(0.95, passBias));
    let desiredType = Math.random() < passBias ? 'pass' : 'run';

    const formationPlays = Object.keys(offensivePlaybook).filter(key => key.startsWith(offenseFormationName));

    // 💡 NEW: Filter out the specific play used previously to force variety
    // (previousPlayAnalysis comes from analyzePlaySuccess)
    let pool = formationPlays.filter(key => {
        const p = offensivePlaybook[key];
        return p.type === desiredType && key !== previousPlayAnalysis?.playKey;
    });

    // Fallback if pool is empty (e.g. only 1 play exists)
    if (pool.length === 0) {
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
    const availablePlays = Object.keys(defensivePlaybook).filter(key =>
        defensivePlaybook[key]?.compatibleFormations?.includes(defenseFormationName)
    );

    if (availablePlays.length === 0) return 'Cover_2_Zone_3-1-3';

    // --- 1. CAPTAIN & IQ CHECK ---
    const captainIsSharp = checkCaptainDiscipline(defense, gameLog);

    // --- 2. ANALYZE OPPONENT TENDENCIES (NEW) ---
    // Calculate Average Depth of Target (aDOT) from recent plays
    // (This assumes you track 'playHistory' or similar, otherwise we infer from 'yardsToGo')
    // For now, we simulate this "Scouting Report" logic:
    const offRoster = getRosterObjects(offense);
    const qb = offRoster.find(p => p.slot === 'QB1') || offRoster.find(p => p.favoriteOffensivePosition === 'QB');
    const qbIQ = qb?.attributes?.mental?.playbookIQ || 50;

    // Default Strategy
    let blitzChance = 0.20;
    let manCoverageChance = 0.40; // Base 40% Man
    let pressBias = 0.0; // Bonus chance to pick "Press" or "Hard" plays

    if (captainIsSharp) {
        // A. Down & Distance Logic
        if (yardsToGo < 5) {
            // Short yardage: They will throw quick or run.
            manCoverageChance = 0.70; // Tight Man
            pressBias = 0.30;         // Press coverage
            blitzChance = 0.30;
        } else if (down === 3 && yardsToGo > 10) {
            // Long yardage: NOW we play deep zones.
            manCoverageChance = 0.20;
            pressBias = -0.50; // Play off
        }

        // B. Game Flow Adjustment (The "Dink & Dunk" Killer)
        // If the offense hasn't thrown deep successfully, tighten up!
        // We look at the opponent's 'longPass' stat or just infer.
        // Logic: If they are in a compressed formation (Balanced/Power), play tight.
        if (offense.formations.offense === 'Balanced' || offense.formations.offense === 'Power') {
            manCoverageChance += 0.15;
            pressBias += 0.20;
        }
    } else {
        // Confused Captain: Random guessing
        blitzChance = Math.random();
        manCoverageChance = Math.random();
    }

    // --- 3. FILTER & SELECT ---
    let pool = [];

    // Helper to check if a play is "Press" or "Hard" (Short yardage focus)
    const isShortDefense = (play) => play.tags.includes('press') || play.tags.includes('hardFlat') || play.tags.includes('cover2');
    const isDeepDefense = (play) => play.tags.includes('cover4') || play.tags.includes('prevent');

    // Decision Tree
    if (Math.random() < blitzChance) {
        pool = availablePlays.filter(k => defensivePlaybook[k].tags.includes('blitz'));
    } else {
        // Coverage Selection
        const useMan = Math.random() < manCoverageChance;
        pool = availablePlays.filter(k => defensivePlaybook[k].concept === (useMan ? 'Man' : 'Zone'));

        // Refine Pool based on Press Bias
        if (pressBias > 0 && Math.random() < pressBias) {
            // Force "Short" defenses (Cover 2, Man Press)
            const shortPool = pool.filter(k => isShortDefense(defensivePlaybook[k]));
            if (shortPool.length > 0) pool = shortPool;
        } else if (pressBias < 0) {
            // Force "Deep" defenses (Cover 3/4)
            const deepPool = pool.filter(k => isDeepDefense(defensivePlaybook[k]));
            if (deepPool.length > 0) pool = deepPool;
        }
    }

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
    // 1. Simple Extraction
    const isLive = options.isLive === true;
    const fastSim = isLive ? false : (options.fastSim === true);

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

        // Track play calls for diversity checking
        const homeTeamPlayHistory = [];
        const awayTeamPlayHistory = [];
        const maxHistoryLength = 5;

        if (!fastSim) gameLog.push("Coin toss to determine first possession...");
        const coinFlipWinner = Math.random() < 0.5 ? homeTeam : awayTeam;
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

                const allGamePlayers = [...getRosterObjects(homeTeam), ...getRosterObjects(awayTeam)];
                allGamePlayers.forEach(p => { if (p) p.fatigue = Math.max(0, (p.fatigue || 0) - 40); });

                currentOffense = receivingTeamSecondHalf;
                nextDriveStartBallOn = 20;
                if (!fastSim) gameLog.push(`-- Second Half Kickoff: ${currentOffense.name} receives --`);
            }

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

                // 🛑 VARIABLES DECLARED HERE (Outer Scope of the Play Loop)
                const shouldPunt = determinePuntDecision(down, yardsToGo, ballOn);
                let result;
                let scoreDiff;
                let drivesRemainingInGame;
                let offensivePlayKey = ''; // Default to empty string to fix diagnosePlay crash
                let defensivePlayKey = ''; // Default to empty string
                let playResult;

                if (shouldPunt) {
                    offense.formations.offense = 'Punt';
                    offensivePlayKey = 'Punt_Punt';
                    defense.formations.defense = 'Punt_Return';
                    defensivePlayKey = 'Punt_Return_Return';

                    if (!fastSim) {
                        const offPlayName = offensivePlaybook[offensivePlayKey]?.name || "Punt";
                        const defPlayName = defensivePlaybook[defensivePlayKey]?.name || "Punt Return";
                        gameLog.push(`🏈 **Offense:** ${offPlayName}`);
                        gameLog.push(`🛡️ **Defense:** ${defPlayName}`);
                    }

                    result = resolvePlay(
                        offense,
                        defense,
                        offensivePlayKey,
                        defensivePlayKey,
                        // THE CONTEXT OBJECT
                        {
                            gameLog: fastSim ? null : gameLog,
                            weather,
                            ballOn,
                            ballHash,
                            down,
                            yardsToGo
                        },
                        // OPTIONS
                        options,
                        // ISLIVE FLAG
                        isLive
                    );

                    playResult = result.playResult;

                    if (!fastSim && result.visualizationFrames) {
                        allVisualizationFrames.push(...result.visualizationFrames);
                    }

                    driveActive = false;

                    const isTD = playResult.score === 'TD';
                    const isDefensiveTD = isTD && playResult.possessionChange;

                    if (isTD && !playResult.possessionChange) {
                        if (offense.id === homeTeam.id) homeScore += 6;
                        else awayScore += 6;
                        currentOffense = defense;
                        nextDriveStartBallOn = 20;
                    } else if (isDefensiveTD) {
                        if (defense.id === homeTeam.id) homeScore += 6;
                        else awayScore += 6;
                        currentOffense = offense;
                        nextDriveStartBallOn = 20;
                    } else if (playResult.outcome === 'touchback') {
                        currentOffense = defense;
                        nextDriveStartBallOn = 20;
                    } else {
                        const finalY = result.finalBallY ?? (ballOn + 50);
                        const absoluteBallOn = finalY - 10;
                        currentOffense = defense;
                        nextDriveStartBallOn = Math.round(Math.max(1, Math.min(99, 100 - absoluteBallOn)));
                    }

                } else {
                    // --- NORMAL PLAY ---
                    if (!fastSim) {
                        const yardLineText = ballOn <= 50 ? `own ${ballOn}` : `opponent ${100 - ballOn}`;
                        const isGoalToGo = (ballOn + 10) + yardsToGo >= (FIELD_LENGTH - 10);
                        const downText = `${down}${down === 1 ? 'st' : down === 2 ? 'nd' : down === 3 ? 'rd' : 'th'}`;
                        const yardsText = isGoalToGo ? 'Goal' : yardsToGo;
                        gameLog.push(`--- ${downText} & ${yardsText} from the ${yardLineText} ---`);
                    }

                    offense.formations.offense = offense.coach.preferredOffense || 'Balanced';
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

                    const offensePlayHistory = offense.id === homeTeam.id ? homeTeamPlayHistory : awayTeamPlayHistory;
                    if (!fastSim && offensivePlayKey) {
                        offensePlayHistory.push(offensivePlayKey);
                        if (offensePlayHistory.length > maxHistoryLength) {
                            offensePlayHistory.shift();
                        }
                    }

                    if (!fastSim) {
                        const offPlayName = offensivePlaybook[offensivePlayKey]?.name || offensivePlayKey.split('_').slice(1).join(' ');
                        const defPlayName = defensivePlaybook[defensivePlayKey]?.name || defensivePlayKey;
                        if (gameLog) gameLog.push(`🏈 **Offense:** ${offPlayName} ${audibleResult.didAudible ? '(Audible)' : ''}`);
                        if (gameLog) gameLog.push(`🛡️ **Defense:** ${defPlayName}`);
                    }

                    // 💡 FIXED: Added isLive as the last argument
                    result = resolvePlay(offense, defense, offensivePlayKey, defensivePlayKey,
                        { gameLog: fastSim ? null : gameLog, weather, ballOn, ballHash, down, yardsToGo },
                        options,
                        isLive // <--- THIS WAS MISSING
                    );

                    playResult = result.playResult;

                    if (!fastSim && result.visualizationFrames) {
                        allVisualizationFrames.push(...result.visualizationFrames);
                    }
                    if (!fastSim && !playResult.outcome === 'incomplete' && result.visualizationFrames?.length > 0) {
                        const finalBallX = result.visualizationFrames[result.visualizationFrames.length - 1].ball.x;
                        if (finalBallX < HASH_LEFT_X) ballHash = 'L';
                        else if (finalBallX > HASH_RIGHT_X) ballHash = 'R';
                        else ballHash = 'M';
                    }
                    ballOn += playResult.yards;
                    ballOn = Math.max(0, Math.min(100, ballOn));
                }

                if (!fastSim) {
                    autoMakeSubstitutions(offense, { thresholdFatigue: 40, maxSubs: 1, chance: 0.8 }, gameLog);
                    autoMakeSubstitutions(defense, { thresholdFatigue: 40, maxSubs: 1, chance: 0.8 }, gameLog);
                }

                // --- 5. PROCESS PLAY RESULT ---

                // --- 1. TOUCHDOWN ---
                if (playResult.score === 'TD' && !shouldPunt) {
                    const wasOffensiveTD = !playResult.possessionChange;

                    if (wasOffensiveTD) {
                        ballOn = 100;
                        const goesForTwo = Math.random() > 0.85;
                        const points = goesForTwo ? 2 : 1;
                        const conversionBallOn = goesForTwo ? 95 : 98;
                        const conversionYardsToGo = 100 - conversionBallOn;
                        if (!fastSim) gameLog.push(`🏈 --- ${points}-Point Conversion Attempt ---`);

                        offense.formations.offense = offense.coach.preferredOffense || 'Balanced';

                        // Variables reused for conversion
                        const conversionOffensePlayKey = determinePlayCall(offense, defense, 1, conversionYardsToGo, conversionBallOn, scoreDiff, fastSim ? null : gameLog, drivesRemainingInGame);

                        const conversionDefenseFormation = determineDefensiveFormation(defense, offense.formations.offense, 1, conversionYardsToGo);
                        defense.formations.defense = conversionDefenseFormation;

                        const conversionDefensePlayKey = determineDefensivePlayCall(defense, offense, 1, conversionYardsToGo, conversionBallOn, scoreDiff, fastSim ? null : gameLog, drivesRemainingInGame);

                        const conversionResult = resolvePlay(offense, defense, conversionOffensePlayKey, conversionDefensePlayKey,
                            { gameLog: fastSim ? null : gameLog, weather, ballOn: conversionBallOn, ballHash: 'M', down: 1, yardsToGo: conversionYardsToGo },
                            options
                        );

                        if (!fastSim && conversionResult.visualizationFrames) {
                            allVisualizationFrames.push(...conversionResult.visualizationFrames);
                        }

                        const convIsTD = conversionResult.playResult.score === 'TD';
                        const convIsDefensiveScore = convIsTD && conversionResult.playResult.possessionChange;

                        if (convIsTD && !convIsDefensiveScore) {
                            if (!fastSim) gameLog.push(`✅ ${points}-point conversion GOOD!`);
                            if (offense.id === homeTeam.id) homeScore += (6 + points); else awayScore += (6 + points);
                        } else if (convIsDefensiveScore) {
                            if (!fastSim) gameLog.push(`❌ Conversion FAILED... AND RETURNED!`);
                            if (offense.id === homeTeam.id) homeScore += 6; else awayScore += 6;
                            if (defense.id === homeTeam.id) homeScore += 2; else awayScore += 2;
                        } else {
                            if (!fastSim) gameLog.push(`❌ ${points}-point conversion FAILED!`);
                            if (offense.id === homeTeam.id) homeScore += 6; else awayScore += 6;
                        }
                        scoreDiff = offense.id === homeTeam.id ? homeScore - awayScore : awayScore - homeScore;

                    } else {
                        if (!fastSim) gameLog.push(`🎉 DEFENSIVE TOUCHDOWN! 6 points for ${defense.name}!`);
                        if (defense.id === homeTeam.id) homeScore += 6; else awayScore += 6;
                        scoreDiff = offense.id === homeTeam.id ? homeScore - awayScore : awayScore - homeScore;
                    }

                    if (wasOffensiveTD) currentOffense = defense; else currentOffense = offense;
                    driveActive = false;
                    nextDriveStartBallOn = 20;

                    // --- 2. SAFETY ---
                } else if (playResult.safety && !shouldPunt) {
                    if (!fastSim) gameLog.push(`SAFETY! 2 points for ${defense.name}!`);
                    if (defense.id === homeTeam.id) homeScore += 2; else awayScore += 2;
                    driveActive = false;
                    nextDriveStartBallOn = 20;

                    // --- 3. TURNOVER ---
                } else if (playResult.possessionChange && !shouldPunt) {
                    driveActive = false;
                    currentOffense = defense;
                    const finalY = result.finalBallY !== undefined ? result.finalBallY : (ballOn + 10);
                    const absoluteBallOn = finalY - 10;
                    let turnoverSpot = 100 - absoluteBallOn;
                    turnoverSpot = Math.round(Math.max(1, Math.min(99, turnoverSpot)));
                    nextDriveStartBallOn = turnoverSpot;

                    if (!fastSim) {
                        const spotText = nextDriveStartBallOn <= 50 ? `own ${nextDriveStartBallOn}` : `opponent ${100 - nextDriveStartBallOn}`;
                        if (playResult.outcome === 'incomplete' && down > 4) {
                            if (playResult.outcome === 'incomplete') nextDriveStartBallOn = 100 - ballOn;
                            gameLog.push(`✋ Turnover on downs! ${defense.name} takes over.`);
                        } else {
                            gameLog.push(`🔄 Possession changes! Ball spotted at ${spotText}.`);
                        }
                    }

                    // --- 4. INCOMPLETE ---
                } else if (playResult.outcome === 'incomplete' && !shouldPunt) {
                    down++;

                    // --- 5. REGULAR GAIN ---
                } else if (!shouldPunt) {
                    const wasGoalToGo = ((ballOn + 10) + yardsToGo) >= (FIELD_LENGTH - 10);
                    yardsToGo -= playResult.yards;

                    if (yardsToGo <= 0) {
                        down = 1;
                        const newYardsToGoalLine = 100 - ballOn;
                        yardsToGo = newYardsToGoalLine <= 10 ? newYardsToGoalLine : 10;
                        if (yardsToGo <= 0) yardsToGo = 1;
                        if (!fastSim) {
                            const newYardLineText = ballOn <= 50 ? `own ${ballOn}` : `opponent ${100 - ballOn}`;
                            gameLog.push(`➡️ First down ${offense.name}! ${newYardsToGoalLine <= 10 ? `1st & Goal at the ${newYardsToGoalLine}` : `1st & 10 at the ${newYardLineText}`}.`);
                        }
                    } else {
                        down++;
                        if (wasGoalToGo) yardsToGo = 100 - ballOn;
                    }
                }

                // --- 6. TURNOVER ON DOWNS ---
                if (down > 4 && driveActive) {
                    if (!fastSim) {
                        const finalYardLineText = ballOn <= 50 ? `own ${ballOn}` : `opponent ${100 - ballOn}`;
                        gameLog.push(`✋ Turnover on downs! ${defense.name} takes over at the ${finalYardLineText}.`);
                    }
                    driveActive = false;
                    nextDriveStartBallOn = 100 - ballOn;
                }
            }

            drivesThisGame++;
            if (drivesThisGame < totalDrivesPerHalf * 2 && !gameForfeited) {
                possessionTeam = (possessionTeam?.id === homeTeam.id) ? awayTeam : homeTeam;
            }
        }

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

                        // ✅ Assign scoreDiff (OT)
                        scoreDiff = offense.id === homeTeam.id
                            ? homeScore - awayScore
                            : awayScore - homeScore;

                        const drivesRemainingInGame = 0;

                        // --- Play selection ---
                        const offensivePlayKey_initial = determinePlayCall(
                            offense, defense, down, yardsToGo, ballOn,
                            scoreDiff, fastSim ? null : gameLog, drivesRemainingInGame
                        );

                        const offenseFormationName = offense.formations.offense;
                        defense.formations.defense = determineDefensiveFormation(
                            defense, offenseFormationName, down, yardsToGo
                        );

                        const defensivePlayKey = determineDefensivePlayCall(
                            defense, offense, down, yardsToGo, ballOn,
                            scoreDiff, fastSim ? null : gameLog, drivesRemainingInGame
                        );

                        const audibleResult = aiCheckAudible(
                            offense, offensivePlayKey_initial,
                            defense, defensivePlayKey,
                            fastSim ? null : gameLog
                        );

                        const offensivePlayKey = audibleResult.playKey; // Local scoping fine here inside separate loop

                        if (!fastSim) {
                            gameLog.push(`🏈 **Offense:** ${offensivePlaybook[offensivePlayKey]?.name || offensivePlayKey}`);
                            gameLog.push(`🛡️ **Defense:** ${defensivePlaybook[defensivePlayKey]?.name || defensivePlayKey}`);
                        }

                        // --- RESOLVE PLAY ---
                        const result = resolvePlay(
                            offense,
                            defense,
                            offensivePlayKey,
                            defensivePlayKey,
                            { gameLog: fastSim ? null : gameLog, weather, ballOn, ballHash, down, yardsToGo },
                            options,
                            isLive // <--- ADD THIS!
                        );

                        const playResult = result.playResult;

                        // Frames
                        if (!fastSim && result.visualizationFrames) {
                            allVisualizationFrames.push(...result.visualizationFrames);
                        }

                        // Ball movement (ONCE)
                        ballOn += playResult.yards;
                        ballOn = Math.max(0, Math.min(100, ballOn));

                        // --- TERMINAL OUTCOMES ---

                        // 1️⃣ Defensive TD (INT / fumble return)
                        if (playResult.score === 'TD' && playResult.possessionChange) {
                            if (!fastSim) gameLog.push(`🎉 DEFENSIVE TOUCHDOWN! Game Over!`);
                            if (defense.id === homeTeam.id) homeScore += 6;
                            else awayScore += 6;
                            isStillTied = false;
                            driveActive = false;
                            break;
                        }

                        // 2️⃣ Safety
                        if (playResult.safety) {
                            if (!fastSim) gameLog.push(`SAFETY! Game Over!`);
                            if (defense.id === homeTeam.id) homeScore += 2;
                            else awayScore += 2;
                            isStillTied = false;
                            driveActive = false;
                            break;
                        }

                        // 3️⃣ Offensive TD → Conversion
                        if (playResult.score === 'TD') {
                            ballOn = 100;
                            driveActive = false;

                            const goesForTwo = Math.random() > 0.85;
                            const points = goesForTwo ? 2 : 1;
                            const conversionBallOn = goesForTwo ? 95 : 98;
                            const conversionYardsToGo = 100 - conversionBallOn;

                            if (!fastSim) gameLog.push(`🏈 --- ${points}-Point Conversion Attempt ---`);

                            // Conversion play calls
                            const conversionOffensePlayKey = determinePlayCall(
                                offense, defense, 1, conversionYardsToGo, conversionBallOn,
                                scoreDiff, fastSim ? null : gameLog, drivesRemainingInGame
                            );

                            defense.formations.defense = determineDefensiveFormation(
                                defense, offense.formations.offense, 1, conversionYardsToGo
                            );

                            const conversionDefensePlayKey = determineDefensivePlayCall(
                                defense, offense, 1, conversionYardsToGo, conversionBallOn,
                                scoreDiff, fastSim ? null : gameLog, drivesRemainingInGame
                            );

                            if (!fastSim) {
                                gameLog.push(`🏈 **Offense:** ${offensivePlaybook[conversionOffensePlayKey]?.name || conversionOffensePlayKey}`);
                                gameLog.push(`🛡️ **Defense:** ${defensivePlaybook[conversionDefensePlayKey]?.name || conversionDefensePlayKey}`);
                            }

                            const conversionResult = resolvePlay(
                                offense,
                                defense,
                                conversionOffensePlayKey,
                                conversionDefensePlayKey,
                                {
                                    gameLog: fastSim ? null : gameLog,
                                    weather,
                                    ballOn: conversionBallOn,
                                    ballHash: 'M',
                                    down: 1,
                                    yardsToGo: conversionYardsToGo
                                },
                                options,
                                isLive // <--- ADD THIS!
                            );

                            if (!fastSim && conversionResult.visualizationFrames) {
                                allVisualizationFrames.push(...conversionResult.visualizationFrames);
                            }

                            const convPlayResult = conversionResult.playResult;
                            const isTD = convPlayResult.score === 'TD';
                            const isDefensiveScore = isTD && convPlayResult.possessionChange;

                            if (isTD && !isDefensiveScore) {
                                if (!fastSim) gameLog.push(`✅ ${points}-point conversion GOOD!`);
                                if (offense.id === homeTeam.id) homeScore += (6 + points);
                                else awayScore += (6 + points);

                                isStillTied = false;
                            } else if (isDefensiveScore) {
                                if (!fastSim) gameLog.push(`❌ Conversion FAILED... AND RETURNED! Game Over!`);
                                if (offense.id === homeTeam.id) homeScore += 6;
                                else awayScore += 6;
                                if (defense.id === homeTeam.id) homeScore += 2;
                                else awayScore += 2;
                                isStillTied = false;

                            } else {
                                if (!fastSim) gameLog.push(`❌ ${points}-point conversion FAILED!`);
                                if (offense.id === homeTeam.id) homeScore += 6;
                                else awayScore += 6;
                            }

                            scoreDiff = offense.id === homeTeam.id
                                ? homeScore - awayScore
                                : awayScore - homeScore;

                            break;
                        }

                        // --- NON-TERMINAL ---
                        if (playResult.outcome === 'incomplete') {
                            down++;
                        } else {
                            yardsToGo -= playResult.yards;
                            if (yardsToGo <= 0) {
                                down = 1;
                                yardsToGo = ballOn >= 90 ? 100 - ballOn : 10;
                                if (yardsToGo <= 0) yardsToGo = 1;
                            } else {
                                down++;
                            }
                        }

                        if (down > 4) {
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

        if (gameLog) gameLog.push(`==== FINAL SCORE ==== ${awayTeam.name} ${awayScore} - ${homeTeam.name} ${homeScore}`);

        if (!gameForfeited) {
            if (homeScore > awayScore) { homeTeam.wins = (homeTeam.wins || 0) + 1; awayTeam.losses = (awayTeam.losses || 0) + 1; }
            else if (awayScore > homeScore) { awayTeam.wins = (awayTeam.wins || 0) + 1; homeTeam.losses = (homeTeam.losses || 0) + 1; }
            else if (homeScore === awayScore) { homeTeam.ties = (homeTeam.ties || 0) + 1; awayTeam.ties = (awayTeam.ties || 0) + 1; }
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

        gameResult = { homeTeam, awayTeam, homeScore, awayScore, gameLog, breakthroughs, visualizationFrames: allVisualizationFrames };

    } catch (error) {
        console.error(`simulateGame ERROR: ${error.message}`, error);
        gameResult = {
            homeTeam, awayTeam, homeScore: 0, awayScore: 0,
            gameLog: [`⚠️ Simulation error: ${error.message}`], breakthroughs: [], visualizationFrames: null
        };
    } finally {
        TICK_DURATION_SECONDS = originalTickDuration;
    }

    if (gameResult) {
        if (!game.gameResults) game.gameResults = [];
        game.gameResults.push({
            homeTeam: { id: gameResult.homeTeam.id, name: gameResult.homeTeam.name },
            awayTeam: { id: gameResult.awayTeam.id, name: gameResult.awayTeam.name },
            homeScore: gameResult.homeScore, awayScore: gameResult.awayScore
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



// -----------------------------
// Depth Order API / Helpers
// -----------------------------

/**
 * Update roster depth order based on newOrder[] (array of player IDs).
 * Persists to the player's team object and dispatches a UI refresh.
 */
function updateDepthChart(playerId, slotName, side) {
    const team = game?.playerTeam;
    if (!team || !team.depthOrder) return;

    // 1. Identify the Position Group (e.g., "QB" from "QB1")
    let posKey = slotName.replace(/\d+/g, '');

    // Normalize to your 7 buckets
    if (['OT', 'OG', 'C'].includes(posKey)) posKey = 'OL';
    if (posKey === 'FB') posKey = 'RB';
    if (posKey === 'TE') posKey = 'WR';
    if (['CB', 'S'].includes(posKey)) posKey = 'DB';
    if (['DE', 'DT'].includes(posKey)) posKey = 'DL';

    // 2. Update the Master List (depthOrder)
    // We move the dragged player to the #1 spot in their group list
    const groupList = team.depthOrder[posKey] || [];

    // Remove if existing
    const existingIndex = groupList.indexOf(playerId);
    if (existingIndex > -1) {
        groupList.splice(existingIndex, 1);
    }

    // Add to front (Priority 1)
    groupList.unshift(playerId);
    team.depthOrder[posKey] = groupList;

    // 3. Trigger Rebuild to sync everything
    rebuildDepthChartFromOrder(team);

    console.log(`Moved ${playerId} to top of ${posKey} depth via visual drag.`);
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
    if (!team) return;

    team.formations[side] = formationName;

    // Instead of resetting to null, we REBUILD from the definitive order
    rebuildDepthChartFromOrder(team);
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
            game = loaded;

            // Restore Relationships Map
            if (game.relationships && !(game.relationships instanceof Map)) {
                game.relationships = new Map(Object.entries(game.relationships));
            }

            // 💡 FIX: Repopulate the Global Player Map
            playerMap.clear();
            if (Array.isArray(game.players)) {
                game.players.forEach(p => playerMap.set(p.id, p));
            }

            return game;
        }
    } catch (e) {
        console.error('Error loading game state:', e);
    }
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
    substitutePlayers, autoMakeSubstitutions, aiCheckAudible, setTeamCaptain, normalizeFormationKey
};
