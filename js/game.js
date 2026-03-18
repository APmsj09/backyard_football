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
const offensivePositions = ['QB', 'RB', 'WR', 'TE', 'OL'];
const defensivePositions = ['DL', 'LB', 'DB'];
const MIN_HEALTHY_PLAYERS = 8; // Minimum players needed to avoid forfeit (8v8)

// --- Field Constants ---
const FIELD_LENGTH = 120; // Yards (including 10yd endzones at 0-10 and 110-120)
const FIELD_WIDTH = 53.3; // Yards
const HASH_LEFT_X = 18.0; // Approx college hash mark X-coordinate
const HASH_RIGHT_X = 35.3; // Approx college hash mark X-coordinate
const CENTER_X = FIELD_WIDTH / 2; // Approx 26.65

// --- Physics/Interaction Constants ---
let TICK_DURATION_SECONDS = 0.05;
const BLOCK_ENGAGE_RANGE = 2;
const TACKLE_RANGE = 2.2;
const CATCH_RADIUS = 0.8;
const SEPARATION_THRESHOLD = 2.0;
const PLAYER_SEPARATION_RADIUS = 0.6;
const FUMBLE_CHANCE_BASE = 0.015;
const MIN_DROPBACK_TICKS = 45; // QB must wait this long for receivers to run routes

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

/**
 * Validates and clamps formation coordinates to be within field bounds.
 * Prevents players from spawning outside the playable field.
 * 
 * @param {number} x - Field width coordinate (0-53.3 yards)
 * @param {number} y - Field length coordinate (0-120 yards)
 * @param {string} slot - Slot name for logging (e.g., "WR1")
 * @returns {object} {x, y} - Clamped coordinates
 */
function validateFormationCoordinate(x, y, slot = '') {
    // Pre-snap players can be slightly behind the line (y can go negative by up to 10 yards)
    // But they can't be beyond the far endzone
    const minX = 0;
    const maxX = FIELD_WIDTH;
    const minY = -10;  // Pre-snap positions
    const maxY = FIELD_LENGTH;

    const clampedX = Math.max(minX, Math.min(maxX, x));
    const clampedY = Math.max(minY, Math.min(maxY, y));

    // Log if coordinates were out of bounds
    if (clampedX !== x || clampedY !== y) {
        console.warn(`⚠️ Formation coordinate out of bounds for ${slot}: (${x.toFixed(1)}, ${y.toFixed(1)}) → (${clampedX.toFixed(1)}, ${clampedY.toFixed(1)})`);
    }

    return { x: clampedX, y: clampedY };
}

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

// --- Logging helper: Avoid consecutive duplicate messages and per-play duplicates ---
function pushGameLog(gameLog, message, playState = null) {
    if (!gameLog) return;
    const last = gameLog[gameLog.length - 1];
    if (last === message) return; // Prevent immediate duplicate

    if (playState) {
        // Use a Set to remember messages logged during this play
        playState._logged = playState._logged || new Set();
        if (playState._logged.has(message)) return;
        playState._logged.add(message);
    }

    gameLog.push(message);
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

    // 🔧 CRITICAL FIX: Clean up roster of non-existent players FIRST
    if (Array.isArray(team.roster)) {
        const validRosterBefore = team.roster.length;
        team.roster = team.roster.filter(id => {
            const p = getPlayer(id);
            if (!p) {
                const teamName = team?.name || 'Unknown Team';
                console.warn(`⚠️ Removing non-existent player ${id} from ${teamName} roster`);
                return false;
            }
            return true;
        });
        if (team.roster.length < validRosterBefore) {
            const teamName = team?.name || 'Unknown Team';
            console.log(`Roster cleanup: Removed ${validRosterBefore - team.roster.length} deleted players from ${teamName}`);
        }
    }

    // 1. Ensure Depth Order Object Exists with correct keys
    if (!team.depthOrder || Array.isArray(team.depthOrder)) {
        team.depthOrder = {
            'QB': [], 'RB': [], 'WR': [], 'TE': [], 'OL': [],
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
    if (!team.isPlayerControlled) {
        team.roster.forEach(pid => {
            if (!assignedIds.has(pid)) {
                const p = getPlayer(pid);
                if (p) {
                    let pos = p.pos || p.favoriteOffensivePosition || 'WR';
                    if (['FB'].includes(pos)) pos = 'RB';
                    if (['ATH', 'K', 'P'].includes(pos)) pos = 'WR';
                    if (['OT', 'OG', 'C'].includes(pos)) pos = 'OL';
                    if (['DE', 'DT', 'NT'].includes(pos)) pos = 'DL';
                    if (['CB', 'S', 'FS', 'SS'].includes(pos)) pos = 'DB';

                    if (!team.depthOrder[pos]) pos = 'WR';
                    team.depthOrder[pos].push(pid);
                }
            }
        });
    }

    // 3. Reset Visual Depth Chart Slots
    team.depthChart = { offense: {}, defense: {}, special: {} };

    // 4. Create tracking sets to allow Two-Way Players (Ironman Football)
    // 💡 FIX: Instead of shifting/destroying arrays, we just track who is used PER SIDE.
    const usedOffense = new Set();
    const usedDefense = new Set();

    const getBestAvailable = (preferredBuckets, usedSet) => {
        for (const bucket of preferredBuckets) {
            const pool = team.depthOrder[bucket] || [];
            for (const pid of pool) {
                if (!usedSet.has(pid)) {
                    usedSet.add(pid);
                    return pid;
                }
            }
        }
        return null;
    };

    // 5. Fill Offense Slots
    const offFormKey = normalizeFormationKey(offenseFormations, team.formations.offense, 'Balanced');
    team.formations.offense = offFormKey;
    const offSlots = offenseFormations[offFormKey].slots;

    offSlots.forEach(slot => {
        let posKey = slot.replace(/\d+/g, '');
        if (['OT', 'OG', 'C'].includes(posKey)) posKey = 'OL';
        if (posKey === 'FB') posKey = 'RB';

        // 💡 FIX: Intelligent positional cascades
        let searchBuckets = [posKey];
        if (posKey === 'WR') searchBuckets.push('TE', 'RB', 'DB', 'QB'); // DBs make great WRs
        if (posKey === 'RB') searchBuckets.push('WR', 'DB', 'LB');
        if (posKey === 'TE') searchBuckets.push('WR', 'OL', 'LB');
        if (posKey === 'OL') searchBuckets.push('DL', 'TE', 'LB'); // DLs make great OLs
        if (posKey === 'QB') searchBuckets.push('WR', 'RB', 'DB');

        // Catch-all emergency fallback
        searchBuckets.push('WR', 'RB', 'TE', 'DB', 'LB', 'DL', 'OL', 'QB');

        team.depthChart.offense[slot] = getBestAvailable(searchBuckets, usedOffense);
    });

    // 6. Fill Defense Slots
    const defFormKey = normalizeFormationKey(defenseFormations, team.formations.defense, '3-1-3');
    team.formations.defense = defFormKey;
    const defSlots = defenseFormations[defFormKey].slots;

    defSlots.forEach(slot => {
        let posKey = slot.replace(/\d+/g, '');
        if (['CB', 'S'].includes(posKey)) posKey = 'DB';
        if (['DE', 'DT'].includes(posKey)) posKey = 'DL';

        // 💡 FIX: Intelligent positional cascades
        let searchBuckets = [posKey];
        if (posKey === 'DB') searchBuckets.push('WR', 'RB', 'QB'); // WRs make great DBs
        if (posKey === 'LB') searchBuckets.push('DL', 'DB', 'TE', 'RB');
        if (posKey === 'DL') searchBuckets.push('LB', 'OL', 'TE'); // OLs make great DLs

        // Catch-all emergency fallback
        searchBuckets.push('DB', 'LB', 'DL', 'WR', 'RB', 'TE', 'OL', 'QB');

        team.depthChart.defense[slot] = getBestAvailable(searchBuckets, usedDefense);
    });

    // 7. Special Teams (Punter = Backup QB or Best Athlete)
    const qbBucket = team.depthOrder['QB'] || [];
    const bestPunter = qbBucket.length > 1 ? qbBucket[1] : qbBucket[0];
    team.depthChart.special['P'] = bestPunter || null;
}
/** Helper: Gets full player objects from a team's roster of IDs. */
function getRosterObjects(team) {
    if (!team || !Array.isArray(team.roster)) return [];

    // Safety check: if map is empty (e.g. after load), rebuild it
    if (playerMap.size === 0 && game && game.players) {
        game.players.forEach(p => {
            if (p && p.id) playerMap.set(p.id, p);
        });
    }

    // 🔧 CRITICAL FIX: Remove any non-existent players from roster
    const validIds = [];
    const invalidIds = [];

    team.roster.forEach(id => {
        const p = playerMap.get(id);
        if (p) {
            validIds.push(id);
        } else {
            invalidIds.push(id);
        }
    });

    if (invalidIds.length > 0) {
        const teamName = team?.name || 'Unknown Team';
        console.warn(`⚠️ Removing ${invalidIds.length} non-existent player IDs from ${teamName}: ${invalidIds.join(', ')}`);
        team.roster = validIds;  // Update roster to only valid players
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
    console.warn(`Player ${playerId} not found on team ${team?.name || 'Unknown Team'}`);
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
function checkFumble(ballCarrierState, tacklerState, playState, gameLog) {
    if (!ballCarrierState.hasBall) return false;

    // FORCE CASTING
    const toughness = Number(ballCarrierState.toughness) || 50;
    const strength = Number(tacklerState.strength) || 50;
    const tackling = Number(tacklerState.tackling) || 50;

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
        // 2. TRACK THE DROP (Prevents infinite fumble loop)
        playState.ballState.lastDroppedById = ballCarrierState.id;
        playState.ballState.droppedTick = playState.tick;

        if (gameLog) {
            const hitPower = Math.round(((strength + tackling) / 2) * tacklerState.fatigueModifier);
            const security = Math.round(toughness * ballCarrierState.fatigueModifier);
            const actionX = ballCarrierState.x.toFixed(1);
            const actionY = ballCarrierState.y.toFixed(1);
            const yardage = (ballCarrierState.y - playState.lineOfScrimmage).toFixed(1);

            gameLog.push(`[Tick ${playState.tick}] ❗ FUMBLE! ${tacklerState.name} jars it loose at (${actionX}, ${actionY}) | Gain: ${yardage}y | (Hit: ${hitPower} vs Sec: ${security})`);
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
    const tackling = pState.tackling || 50; // Defensive linemen are better at reading run
    const coverage = pState.coverage || 50; // DBs natural at reading pass

    // 1. Calculate Read Time (How long until they "know"?)
    // 💡 IMPROVED: Position-specific recognition
    // DL/LB read runs faster. DBs read passes faster.
    let baseTicks = 45 - Math.floor(iq * 0.4); // 5-45 ticks base

    if (pState.role === 'DL' || pState.role === 'LB') {
        baseTicks *= (50 / (tackling + 1)); // DL/LBs faster at run reads
    } else if (pState.role === 'DB') {
        baseTicks *= (50 / (coverage + 1)); // DBs faster at coverage reads
    }

    const ticksToDiagnose = Math.max(3, Math.min(40, baseTicks));

    // 2. Key Reads (Observable clues)
    // 💡 NEW: Geometric & personnel-based reads
    let keyReadBonus = 0;

    // Formation clues (need to be passed from play state context)
    // For now, we use position as proxy - can be expanded later
    if (pState.role === 'DL') {
        // DL reads blocking schemes: If guards are pulling left, run is going that way
        // If OL is pass-setting (backpedaling), it's a pass
        // This would require tracking actual offensive intent
    }

    if (tick < ticksToDiagnose - keyReadBonus) {
        return 'read'; // Still diagnosing
    }

    // 3. Play Action Logic (The "Bite" Factor)
    // 💡 IMPROVED: IQ-based fooling with position consideration
    const isPlayAction = (truePlayType === 'pass' && offensivePlayKey.includes('PA_'));

    if (isPlayAction) {
        // DL/LBs more susceptible to play action (watching backfield action)
        // DBs less susceptible (reading receivers)
        let foolChance = (100 - iq) / 100;

        if (pState.role === 'DL' || pState.role === 'LB') {
            foolChance *= 1.3; // 30% more likely to bite
        } else if (pState.role === 'DB') {
            foolChance *= 0.6; // 40% less likely to bite
        }

        if (Math.random() < foolChance) {
            // Two-part decision: Initial bite, then recovery
            const recoveryChance = (iq * 0.7) / 200; // Higher IQ = better recovery
            const recoveryTick = tick + Math.round(15 - (iq / 6)); // High IQ recovers faster

            if (tick < recoveryTick && Math.random() > recoveryChance) {
                return 'run'; // FOOLED! Attack the run
            }
        }
    }

    // 4. Late Read Adjustment
    // 💡 NEW: If you get fooled early, you can still correct later
    if (tick > ticksToDiagnose + 20 && truePlayType === 'pass') {
        // After 20+ ticks, even fooled defenders should read pass
        return 'pass';
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
    game.players.forEach(p => {
        if (p && p.id) playerMap.set(p.id, p);
    });

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

        const prefOff = offenseFormations[coach.preferredOffense] ? coach.preferredOffense : 'Balanced';
        const prefDef = defenseFormations[coach.preferredDefense] ? coach.preferredDefense : '3-1-3';

        // Safely resolve formation objects with sane defaults if the coach preference isn't present
        const offenseFormationData = offenseFormations[prefOff] || offenseFormations['Balanced'];
        const defenseFormationData = defenseFormations[prefDef] || defenseFormations['3-1-3'];

        if (availableColors.length === 0) availableColors = [...teamColors];
        const colorSet = availableColors.splice(getRandomInt(0, availableColors.length - 1), 1)[0];

        const team = {
            id: crypto.randomUUID(), name: teamName, roster: [], coach, division, wins: 0, losses: 0,
            primaryColor: colorSet?.primary || teamColors[0].primary,
            secondaryColor: colorSet?.secondary || teamColors[0].secondary,
            formations: { offense: offenseFormationData?.name || 'Balanced', defense: defenseFormationData?.name || '3-1-3' },
            depthChart: {
                offense: Object.fromEntries((offenseFormationData?.slots || []).map(slot => [slot, null])),
                defense: Object.fromEntries((defenseFormationData?.slots || []).map(slot => [slot, null]))
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
        if (team) {
            assignTeamCaptain(team);
        }
    });

    // --- QUICK ROSTER FILL (Testing/Startup convenience) ---
    // Ensure AI teams have players so fast simulations and tests work
    try {
        const ROSTER_LIMIT = 12;
        let undraftedPlayers = game.players.filter(p => p && !p.teamId);
        if (undraftedPlayers.length > 0) {
            // Fill each team in order until rosters reach the limit or players exhausted
            game.teams.forEach(team => {
                if (!team || !Array.isArray(team.roster)) return;
                while ((team.roster.length || 0) < ROSTER_LIMIT && undraftedPlayers.length > 0) {
                    const nextPlayer = undraftedPlayers.shift();
                    try { addPlayerToTeam(nextPlayer, team); } catch (e) { /* best-effort */ }
                }
            });
        }
    } catch (e) {
        console.warn('Quick roster fill failed:', e);
    }
}

function refillAvailableColors() {
    const usedColorHexes = new Set(game.teams.filter(t => t).map(t => t.primaryColor));
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

    // 💡 FIX: Updated to match data.js keys
    let defaultOffense = 'Balanced';
    let defaultDefense = '3-1-3';

    // Safety / fallback in case data.js formations are missing or keys changed
    if (!offenseFormations[defaultOffense]) {
        console.warn(`Warning: Formation ${defaultOffense} not found in data.js; falling back to first available offense formation.`);
        defaultOffense = Object.keys(offenseFormations)[0] || defaultOffense;
    }
    if (!defenseFormations[defaultDefense]) {
        console.warn(`Warning: Formation ${defaultDefense} not found in data.js; falling back to first available defense formation.`);
        defaultDefense = Object.keys(defenseFormations)[0] || defaultDefense;
    }

    const defaultOffenseSlots = offenseFormations[defaultOffense]?.slots || [];
    const defaultDefenseSlots = defenseFormations[defaultDefense]?.slots || [];

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

    const ROSTER_LIMIT = 12;
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
        'QB': [], 'RB': [], 'WR': [], 'TE': [], 'OL': [],
        'DL': [], 'LB': [], 'DB': []
    };

    // Filter out injured/busy players before sorting
    const healthyPlayers = rosterObjs.filter(p => !p.status || p.status.duration === 0);
    const sortRoster = healthyPlayers.length > 0 ? healthyPlayers : rosterObjs;

    // 2. Distribute into Buckets First
    const bucketMap = {
        'QB': [], 'RB': [], 'WR': [], 'TE': [], 'OL': [],
        'DL': [], 'LB': [], 'DB': []
    };

    sortRoster.forEach(p => {
        if (!p || !p.id) return;

        // Determine Offensive Bucket
        let offPos = p.favoriteOffensivePosition || 'WR';
        if (['FB'].includes(offPos)) offPos = 'RB';
        if (['ATH', 'K', 'P'].includes(offPos)) offPos = 'WR';
        if (['OT', 'OG', 'C'].includes(offPos)) offPos = 'OL';
        if (!bucketMap[offPos]) offPos = 'WR';

        // Determine Defensive Bucket
        let defPos = p.favoriteDefensivePosition || 'DB';
        if (['CB', 'S', 'FS', 'SS'].includes(defPos)) defPos = 'DB';
        if (['DE', 'DT', 'NT'].includes(defPos)) defPos = 'DL';
        if (!bucketMap[defPos]) defPos = 'DB';

        bucketMap[offPos].push(p);

        // Push player to defensive bucket if different so ironman logic works
        if (offPos !== defPos && bucketMap[defPos]) {
            bucketMap[defPos].push(p);
        }
    });

    // 3. Sort Each Position Bucket Realistically
    for (const pos of Object.keys(bucketMap)) {
        const players = bucketMap[pos];

        // Remove duplicates just in case
        const uniquePlayers = Array.from(new Set(players));

        uniquePlayers.sort((a, b) => {
            const ovrA = calculateOverall(a, pos);
            const ovrB = calculateOverall(b, pos);

            // 💡 REALISM FIX: Coaches value smart, reliable players. Give them a subjective bump.
            const iqA = a.attributes?.mental?.playbookIQ || 50;
            const iqB = b.attributes?.mental?.playbookIQ || 50;
            const consA = a.attributes?.mental?.consistency || 50;
            const consB = b.attributes?.mental?.consistency || 50;

            // "Coach's Eye" Noise: Small seeded bias so evaluations aren't perfectly mathematical
            const biasA = (a.id.charCodeAt(0) % 5) - 2;
            const biasB = (b.id.charCodeAt(0) % 5) - 2;

            // Smart/consistent players can play up to +3 to +5 OVR better in a coach's eyes
            const perceivedValueA = ovrA + ((iqA - 50) * 0.06) + ((consA - 50) * 0.06) + biasA;
            const perceivedValueB = ovrB + ((iqB - 50) * 0.06) + ((consB - 50) * 0.06) + biasB;

            return perceivedValueB - perceivedValueA; // Sort Descending
        });

        // Map back to IDs
        team.depthOrder[pos] = uniquePlayers.map(p => p.id);
    }

    // 4. Now that depthOrder is correct, let the rebuilder handle the slot assignments
    rebuildDepthChartFromOrder(team);
}


/** Simulates an AI team's draft pick. */
function simulateAIPick(team) {
    if (!team || !team.roster || !game || !game.players || !team.coach) {
        console.error(`simulateAIPick: Invalid team data or game state.`); return null;
    }
    const ROSTER_LIMIT = 12;
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
    else {
        const teamName = team?.name || 'Unknown Team';
        console.warn(`${teamName} failed to find a suitable player.`);
    }
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
            const playerName = player?.name || 'Unknown Player';
            const primaryPosName = primaryPos || 'Unknown';
            console.warn(`Could not find preferred number for ${playerName} (${primaryPosName}). Assigning random fallback.`);
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


    if (!team.depthOrder || Array.isArray(team.depthOrder)) {
        team.depthOrder = { 'QB': [], 'RB': [], 'WR': [], 'TE': [], 'OL': [], 'DL': [], 'LB': [], 'DB': [] };
    }

    // 💡 TWO-WAY PLAYER FIX for newly added players
    let offPos = player.favoriteOffensivePosition || 'WR';
    if (['FB'].includes(offPos)) offPos = 'RB';
    if (['ATH', 'K', 'P'].includes(offPos)) offPos = 'WR';
    if (['OT', 'OG', 'C'].includes(offPos)) offPos = 'OL';
    if (!team.depthOrder[offPos]) offPos = 'WR';

    let defPos = player.favoriteDefensivePosition || 'DB';
    if (['CB', 'S', 'FS', 'SS'].includes(defPos)) defPos = 'DB';
    if (['DE', 'DT', 'NT'].includes(defPos)) defPos = 'DL';
    if (!team.depthOrder[defPos]) defPos = 'DB';

    team.depthOrder[offPos].push(player.id);
    if (team.depthOrder[defPos] && !team.depthOrder[defPos].includes(player.id)) {
        team.depthOrder[defPos].push(player.id);
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
    const isPlayAction = offensivePlayKey.includes('PA_');

    // --- 1. NORMALIZE PLAY INTENT ---
    playState.type = play.type;
    playState.readProgression = play.readProgression || [];
    playState.playKey = play.key || null;

    // --- 2. DEFENSIVE PLAY LOOKUP (Robust Fallback) ---
    let defPlay = defensivePlaybook[defensivePlayKey];
    if (!defPlay) {
        console.warn(`Defensive play key '${defensivePlayKey}' invalid. Defaulting to Cover 2.`);
        defPlay = defensivePlaybook['Cover_2_Zone_3-1-3'] || { name: 'Emergency Default', assignments: {} };
    }
    const defAssignments = defPlay.assignments || {};

    // --- 3. FIELD SETUP ---
    playState.lineOfScrimmage = ballOnYardLine + 10;
    let ballX = CENTER_X;
    if (ballHash === 'L') ballX = HASH_LEFT_X;
    else if (ballHash === 'R') ballX = HASH_RIGHT_X;

    // --- 4. PRE-CALCULATE OFFENSIVE POSITIONS ---
    // We need to know where the Offense IS so the Defense can line up properly.
    const offenseFormationData = offenseFormations[offense.formations.offense];
    const initialOffenseStates = [];

    if (offenseFormationData?.slots) {
        offenseFormationData.slots.forEach(slot => {
            const relCoords = offenseFormationData.coordinates[slot] || [0, 0];
            let startX = ballX + relCoords[0];
            let startY = playState.lineOfScrimmage + relCoords[1];

            // 🔧 FIXED: Use coordinate validation function
            const validated = validateFormationCoordinate(startX, startY, slot);
            startX = validated.x;
            startY = validated.y;

            initialOffenseStates.push({ slot, x: startX, y: startY });
        });
    }

    // --- 5. HELPER: SETUP SIDE ---
    const setupSide = (team, side, formationData, isOffense) => {
        if (!team || !formationData) return;

        // Sort slots (Line first, then QBs, then skill)
        const sortedSlots = [...formationData.slots].sort((a, b) => {
            if (a.startsWith('C') || a.startsWith('OL')) return -1;
            if (a.startsWith('QB')) return -1;
            return 0;
        });

        // Track who is covered to prevent unintentional double teams
        const coveredOffensiveSlots = new Set();

        sortedSlots.forEach(slot => {
            // Get Player ID from Depth Chart
            if (!playState.resolvedDepth) playState.resolvedDepth = resolveDepthForPlay(offense, defense);
            const playerId = playState.resolvedDepth[side]?.[slot];
            const player = getRosterObjects(team).find(p => p.id === playerId);
            if (!player) return;

            // Initial Coordinates
            const relCoords = formationData.coordinates[slot] || [0, 0];
            let startX = ballX + relCoords[0];
            let startY = playState.lineOfScrimmage + relCoords[1];

            // 🔧 FIXED: Validate coordinates are within field bounds
            const validated = validateFormationCoordinate(startX, startY, slot);
            startX = validated.x;
            startY = validated.y;

            let action = 'idle';
            let assignment = isOffense ? assignments?.[slot] : defAssignments[slot];
            let targetX = startX;
            let targetY = startY;
            let routePath = null;
            let readProgression = [];
            let dropbackPhase = null;
            let hasCompletedDropback = true;
            let dropbackTargetY = startY;

            // --- A. OFFENSE SETUP ---
            if (isOffense) {
                if (slot.startsWith('QB')) {
                    if (play.type === 'punt') {
                        assignment = 'punt'; action = 'punt_kick'; targetY = startY - 5;
                    } else if (play.type === 'run') {
                        // 💡 FIX: QB takes a shallow drop for run plays to facilitate handoff
                        assignment = 'qb_setup'; // Use qb_setup action
                        action = 'qb_setup';
                        dropbackPhase = 'dropping';
                        hasCompletedDropback = false;
                        dropbackTargetY = startY - 3.0; // Shallow 3-yard drop
                    } else { // It's a pass play
                        assignment = 'qb_setup';
                        action = 'qb_setup';
                        dropbackPhase = 'dropping';
                        hasCompletedDropback = false;
                        dropbackTargetY = play.type === 'pass' ? startY - 7.0 : startY - 3.0;
                    }
                }
                else if (slot.startsWith('OL')) {
                    assignment = (play.type === 'pass' && !isPlayAction) ? 'pass_block' : 'run_block';
                    action = assignment;
                    targetY = startY + (action === 'pass_block' ? -0.5 : 0.5);
                }
                else if (assignment) {
                    // Skill Position Assignments
                    if (assignment.includes('block')) {
                        action = assignment;
                        targetY = startY + 0.5;
                    }
                    else if (assignment.includes('run_')) {
                        action = 'run_path';
                        targetY = startY + 5; // Default run target
                    }
                    else if (routeTree[assignment]) {
                        action = 'run_route';
                        routePath = calculateRoutePath(assignment, startX, startY);
                        if (routePath.length) { targetX = routePath[0].x; targetY = routePath[0].y; }
                    }
                }
            }

            // --- B. DEFENSE SETUP (The Threat Board Logic) ---
            else {
                // If assignment missing, default based on position
                if (!assignment) {
                    if (slot.startsWith('DL')) assignment = 'run_gap_A';
                    else if (slot.startsWith('LB')) assignment = 'def_read'; // Will turn into zone/man
                    else if (slot.startsWith('DB')) assignment = 'zone_deep_middle';
                }

                // 1. INTELLIGENT MAN MATCHING
                // If assigned 'man_cover_X', verify X exists. If not, find new target.
                // If assigned 'def_read', find an uncovered target.
                if (assignment.startsWith('man_cover_') || assignment === 'def_read') {

                    let targetSlot = assignment.replace('man_cover_', '');

                    // If target doesn't exist or vague assignment, find OPEN threat
                    const targetExists = initialOffenseStates.some(o => o.slot === targetSlot);

                    if (!targetExists || assignment === 'def_read') {
                        // Priority list for this position type
                        let priorities = [];
                        if (slot.startsWith('DB')) priorities = ['WR1', 'WR2', 'WR3', 'TE1', 'RB1'];
                        else if (slot.startsWith('LB')) priorities = ['RB1', 'TE1', 'RB2', 'WR3'];
                        else priorities = ['RB1'];

                        // Find first priority that isn't covered yet
                        const bestTarget = priorities.find(t =>
                            initialOffenseStates.some(o => o.slot === t) && !coveredOffensiveSlots.has(t)
                        );

                        if (bestTarget) {
                            assignment = `man_cover_${bestTarget}`;
                            targetSlot = bestTarget;
                        } else {
                            // No one left to cover? Zone Fallback.
                            assignment = slot.startsWith('DB') ? 'zone_deep_halves' : 'zone_hook_curl_middle';
                        }
                    }

                    // Mark target as covered
                    if (assignment.startsWith('man_cover_')) {
                        coveredOffensiveSlots.add(targetSlot);
                    }
                }

                action = assignment;

                // 2. Set Initial Stance based on Assignment
                if (assignment.startsWith('man_cover_')) {
                    const tSlot = assignment.split('_')[2];
                    const tState = initialOffenseStates.find(o => o.slot === tSlot);
                    if (tState) {
                        // Align 2 yards off the receiver
                        // Inside leverage for slot, Outside for wide
                        const isSlot = tSlot.includes('TE') || tSlot === 'WR3';
                        const xOffset = (tState.x < CENTER_X) ? (isSlot ? 1.0 : -0.5) : (isSlot ? -1.0 : 0.5);

                        startX = tState.x + xOffset;
                        startY = tState.y + 2.0;
                        targetX = tState.x;
                        targetY = tState.y;
                    }
                }
                else if (assignment.startsWith('zone_')) {
                    // Zones are static points on field
                    // We let the AI move them there, but start them generally correct
                    if (assignment.includes('deep')) startY = Math.max(startY, playState.lineOfScrimmage + 8);
                }
                // 💡 FIX: Push Punt Returners much deeper so they aren't out-kicked by the punter
                if (assignment === 'punt_return') {
                    startY = Math.min(108, startY); // Never stand deeper than the 2-yard line in the endzone
                }
            }


            // --- 6. CLAMP & SPAWN ---
            startX = Math.max(0.5, Math.min(53.3 - 0.5, startX));
            startY = Math.max(10.5, Math.min(110.0 - 10.5, startY));

            // DL starts 1.5yds ahead of LOS, OL starts 1.5yds behind LOS.
            // This prevents the "Icon Overlap" at the start of the play.
            if (!isOffense && startY < playState.lineOfScrimmage + 1.5) {
                startY = playState.lineOfScrimmage + 1.5;
            }
            if (isOffense && startY > playState.lineOfScrimmage - 1.5) {
                startY = playState.lineOfScrimmage - 1.5;
            }

            // RPG Attributes
            const fatigueRatio = player.fatigue / (player.attributes?.physical?.stamina || 50);
            const fatigueMod = Math.max(0.3, 1.0 - fatigueRatio);
            const playerIQ = player.attributes?.mental?.playbookIQ || 50;

            // 💡 NEW: Snap Reaction Logic
            let reactionTicks = 0;
            // The Center (OL2) and QB know the snap count. Everyone else has a delay.
            if (slot !== 'QB1' && slot !== 'OL2') {
                // Base delay: 99 IQ = ~1 tick (0.05s), 50 IQ = ~5 ticks (0.25s), 0 IQ = ~10 ticks (0.5s)
                reactionTicks = Math.max(1, 10 - Math.floor(playerIQ / 10));
                // Add minor random variance (0 to 2 ticks)
                reactionTicks += Math.floor(Math.random() * 3);
                // Defense reacts to the offense moving, inherent 2-tick penalty (0.1s)
                if (!isOffense) reactionTicks += 2;
            }
            const speed = player.attributes?.physical?.speed || 50;
            const agility = player.attributes?.physical?.agility || 50;
            const strength = player.attributes?.physical?.strength || 50;
            const weight = player.attributes?.physical?.weight || 150;
            const height = player.attributes?.physical?.height || 68;
            const iq = player.attributes?.mental?.playbookIQ || 50;
            const consistency = player.attributes?.mental?.consistency || 50;
            const toughness = player.attributes?.mental?.toughness || 50;
            const catching = player.attributes?.technical?.catchingHands || 50;
            const tackling = player.attributes?.defense?.tackling || 50;
            const blocking = player.attributes?.technical?.blocking || 50;
            const blockShedding = player.attributes?.technical?.blockShedding || 50;
            const accuracy = player.attributes?.technical?.throwingAccuracy || 50;
            const coverage = player.attributes?.defense?.passCoverage || 50;

            const pState = {
                id: player.id,
                name: player.name,
                number: player.number,
                role: slot.replace(/\d+/g, ''),
                teamId: team.id,
                snapReactionTimer: reactionTicks,

                // 💡 FIX 1: RESTORE COLORS
                primaryColor: team.primaryColor,
                secondaryColor: team.secondaryColor,

                isOffense: isOffense,
                slot: slot,
                x: startX, y: startY, initialX: startX, initialY: startY,
                targetX: targetX, targetY: targetY,

                fatigueModifier: fatigueMod,

                // --- PERFORMANCE ALIASES (For the physics loop) ---
                spd: speed,
                agi: agility,
                str: strength,
                wgt: weight,
                hgt: height,
                iq: iq,
                cons: consistency,
                tgh: toughness,
                ctch: catching,
                tkl: tackling,
                blk: blocking,
                shed: blockShedding,
                acc: accuracy,
                cov: coverage,

                // --- LEGACY COMPATIBILITY (For your existing functions) ---
                speed: speed,
                agility: agility,
                strength: strength,
                weight: weight,
                height: height,
                playbookIQ: iq,
                consistency: consistency,
                toughness: toughness,
                catchingHands: catching,
                tackling: tackling,
                blocking: blocking,
                blockShedding: blockShedding,
                throwingAccuracy: accuracy,
                coverage: coverage,

                // Logic State
                action: action,
                assignment: assignment,
                routePath: routePath,
                currentPathIndex: 0,

                // QB Specific
                readProgression: readProgression,
                currentReadTargetSlot: readProgression[0] || null,
                ticksOnCurrentRead: 0,

                dropbackPhase: dropbackPhase,
                hasCompletedDropback: hasCompletedDropback,
                dropbackTargetY: dropbackTargetY,

                // Physics State
                vx: 0, vy: 0, vz: 0, // Ensure Z exists
                isEngaged: false, engagedWith: null,
                isBlocked: false, blockedBy: null,
                hasBall: false, isBallCarrier: false,
                stunnedTicks: 0
            };

            playState.activePlayers.push(pState);
        });
    };

    // --- 7. RUN SETUP ---
    const defenseFormationData = defenseFormations[defense.formations.defense] || defenseFormations['3-1-3'];
    setupSide(offense, 'offense', offenseFormationData, true);
    setupSide(defense, 'defense', defenseFormationData, false);

    // 8. INITIALIZE BALL (Always starts with QB)
    const qbState = playState.activePlayers.find(p => p.slot === 'QB1' && p.isOffense);

    if (qbState) {
        qbState.hasBall = true;
        playState.ballState.x = qbState.x;
        playState.ballState.y = qbState.y;
        playState.ballState.z = 1.0;

        // If it's a run, flag that we need a handoff
        if (play.type === 'run') {
            const hasRB = playState.activePlayers.some(p => p.slot === 'RB1');

            if (hasRB) {
                playState.handoffRequired = true;
                playState.handoffTargetSlot = 'RB1';
                playState.handoffOccurred = false;
            } else {
                // 💡 FIX: Failsafe for Spread/Empty Runs. 
                // If there is no RB, the QB must run the ball himself!
                qbState.isBallCarrier = true;
                qbState.action = 'run_path';
                qbState.assignment = 'run_inside';
            }
        }
    } else {
        console.error('No QB found in offense formation! Ball cannot be initialized.');
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
 * BALL CARRIER AI: Situational Intelligence & Physics Integration
 * Features: Predictive Tracking, Momentum-Constrained Vision, and Salvage Protocol.
 */
function getSmartCarrierTarget(runner, defenseStates, offenseStates, fieldWidth = 53.3) {
    const iq = runner.playbookIQ || 50;
    const agility = runner.agility || 50;
    const strength = runner.strength || 50;

    // Current physics state
    const currentVx = runner.vx || 0;
    const currentVy = runner.vy || 0;
    const currentSpeed = Math.hypot(currentVx, currentVy);

    // 1. DYNAMIC VISION CONE (Momentum restricts lateral options)
    // Limits "Aggression" based on physics: you can't bounce outside if you're too fast.
    let maxLateral = 8.0 + (agility / 50);
    if (currentSpeed > 4.5) maxLateral = 5.0;
    if (currentSpeed > 7.0) maxLateral = 2.5;

    // TRAFFIC ASSESSMENT (Are we in the trenches?)
    const nearbyDefenders = defenseStates.filter(d =>
        !d.isBlocked && d.stunnedTicks === 0 && getDistance(runner, d) < 4.0 && d.y > runner.y - 1
    );
    const inTraffic = nearbyDefenders.length >= 2;

    // EFFICIENCY/SALVAGE: If in traffic, drastically limit "Bounce" attempts.
    if (inTraffic) maxLateral = Math.min(maxLateral, 2.5);

    // --- FIX: Corrected Lane Initialization ---
    const laneOffsets = [0]; // Always evaluate straight ahead
    [1.5, 3.0, 5.0, 8.0, 10.0].forEach(off => {
        if (off <= maxLateral) {
            laneOffsets.push(off);
            laneOffsets.push(-off);
        }
    });

    // Evaluate current momentum as a lane
    if (Math.abs(currentVx) > 1.0 && Math.abs(currentVx) <= maxLateral) {
        laneOffsets.push(currentVx);
    }

    const visionDepth = 3.5 + (iq / 25);
    let bestScore = -Infinity;
    let bestTargetX = runner.x;
    let bestTargetY = runner.y + visionDepth;

    // 2. EVALUATE LANES (Determining Aggression vs. Efficiency)
    laneOffsets.forEach((offset) => {
        const testX = runner.x + offset;
        const testY = runner.y + visionDepth;

        if (testX < 1 || testX > fieldWidth - 1) return;

        let score = 100;

        // PHYSICS PENALTY
        const lateralShift = Math.abs(offset);
        const agilityMitigation = Math.max(0.3, (120 - agility) / 80);
        const momentumConflict = Math.abs(offset - (currentVx * 0.6));
        score -= (momentumConflict * 4.0 * agilityMitigation);

        // SALVAGE: Heavily penalize lateral movement when surrounded (don't dance!)
        if (inTraffic) score -= (lateralShift * 12.0);

        // PREDICTIVE DEFENDER AVOIDANCE
        let laneThreat = 0;
        let overPursuitDetected = false;

        defenseStates.forEach(def => {
            if (def.stunnedTicks > 0 || def.y < runner.y - 1.5) return;

            // Project where defender will be in 0.4s
            const defPredX = def.x + ((def.vx || 0) * 0.4);
            const defPredY = def.y + ((def.vy || 0) * 0.4);
            const distToPredicted = Math.hypot(testX - defPredX, testY - defPredY);

            if (!def.isBlocked && !def.isEngaged) {
                if (distToPredicted < 5.0) {
                    laneThreat += (500 / (distToPredicted + 0.5));

                    // Cutback Logic (Punishing Aggression)
                    const defLateralSpeed = def.vx || 0;
                    if (Math.abs(defLateralSpeed) > 3.0) {
                        const defGoingRight = defLateralSpeed > 0;
                        const laneGoingLeft = offset < 0;
                        if ((defGoingRight && laneGoingLeft) || (!defGoingRight && !laneGoingLeft)) {
                            overPursuitDetected = true;
                        }
                    }
                }
            } else {
                // BLOCKER LEVERAGE (Reading the hips)
                const blocker = (typeof def.blockedBy === 'object' && def.blockedBy !== null) ? def.blockedBy :
                    (typeof def.engagedWith === 'object' && def.engagedWith !== null) ? def.engagedWith :
                        offenseStates.find(o => o.id === def.blockedBy || o.id === def.engagedWith);
                if (blocker) {
                    const distToBlock = Math.hypot(testX - blocker.x, testY - blocker.y);
                    if (distToBlock >= 1.0 && distToBlock <= 3.0 && blocker.y > runner.y) {
                        const defIsRight = def.x > blocker.x;
                        const laneIsLeft = testX < blocker.x;
                        if (defIsRight === laneIsLeft) score += 60; // Clean side
                        else score -= 50; // Contested side
                    }
                }
            }
        });

        score -= laneThreat;

        // OPPORTUNITY REWARD: Big runs (Cutbacks/Green Grass)
        if (iq > 70 && overPursuitDetected) score += 80;

        if (score > bestScore) {
            bestScore = score;
            bestTargetX = testX;
            bestTargetY = testY;
        }
    });

    // 3. THE SALVAGE PROTOCOL (Trucking vs Juking)
    const immediateThreat = nearbyDefenders.sort((a, b) => getDistance(runner, a) - getDistance(runner, b))[0];

    if (immediateThreat && getDistance(runner, immediateThreat) < 2.5) {

        const strengthAdvantage = strength - (immediateThreat.strength || 50);

        // SALVAGE: If no good escape exists and we are strong, just fall forward.
        if (strengthAdvantage > 10 && inTraffic && bestScore < 50) {
            bestTargetX = immediateThreat.x + (immediateThreat.x > runner.x ? -0.4 : 0.4);
            bestTargetY = immediateThreat.y + 1.5;
            runner.contactReduction = 0.9; // Hunker down for impact
        } else {
            // JUKE: Standard agility-based dodge
            let dodgeDir = runner.x < immediateThreat.x ? -1 : 1;
            if ((immediateThreat.vx || 0) < -2.0) dodgeDir = 1;
            else if ((immediateThreat.vx || 0) > 2.0) dodgeDir = -1;

            if (runner.x < 4) dodgeDir = 1;
            if (runner.x > fieldWidth - 4) dodgeDir = -1;

            const dodgeWidth = 1.2 + (agility / 40);
            bestTargetX = (bestTargetX * 0.3) + ((runner.x + (dodgeDir * dodgeWidth)) * 0.7);
            bestTargetY = Math.min(bestTargetY, runner.y + 1.5);
        }
    }

    bestTargetX = Math.max(1.0, Math.min(fieldWidth - 1.0, bestTargetX));
    return { x: bestTargetX, y: bestTargetY };
}

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
        // 💡 FIX: Only the closest 3 players from each team should pursue the ball. 
        // Sending all 22 players causes a physics singularity and freezes the game.
        const getClosest = (isOff) => playState.activePlayers
            .filter(p => p.isOffense === isOff && p.stunnedTicks <= 0 && !p.isEngaged)
            .sort((a, b) => getDistance(a, playState.ballState) - getDistance(b, playState.ballState))
            .slice(0, 3);

        const pursuers = [...getClosest(true), ...getClosest(false)];

        playState.activePlayers.forEach(pState => {
            if (pState.stunnedTicks > 0 || pState.isEngaged) return;

            if (pursuers.includes(pState)) {
                pState.targetX = playState.ballState.x;
                pState.targetY = playState.ballState.y;
                pState.action = 'pursuit';
            } else {
                // Non-pursuers stop and watch to avoid crashing the physics engine
                pState.targetX = pState.x;
                pState.targetY = pState.y;
                pState.action = 'idle';
            }
        });
        return;
    }

    // --- 1.5 TURNOVER RETURN LOGIC (Interception / Fumble Recovery / Punt Return) ---
    // If a defensive player has the ball, the roles reverse!
    if (ballCarrierState && !ballCarrierState.isOffense) {
        playState.activePlayers.forEach(pState => {
            if (pState.stunnedTicks > 0) { pState.stunnedTicks--; return; }
            if (pState.isBlocked || pState.isEngaged) return;


            if (pState.id === ballCarrierState.id) {
                // 1. The Returner: Run towards y = 10 (Opposite endzone)
                let targetX = pState.x;

                // Simple vision: dodge offensive players
                const nearestOff = offenseStates.find(o => getDistance(pState, o) < 8);
                if (nearestOff) {
                    const dx = pState.x - nearestOff.x;
                    targetX += (dx > 0 ? 3 : -3); // Dodge laterally
                    targetX = Math.max(1, Math.min(52, targetX));
                } else {
                    // Drift to center field
                    if (pState.x < 20) targetX += 0.5;
                    else if (pState.x > 33) targetX -= 0.5;
                }

                pState.targetX = targetX;
                pState.targetY = 10; // Defensive endzone is at 10
                pState.action = 'run_path';
                pState.contactReduction = nearestOff ? 0.9 : 1.0;
            }
            else if (!pState.isOffense) {
                // 2. The Return Team (Originally Defense): Block!
                const nearestOff = offenseStates
                    .filter(o => !o.isEngaged && o.y < pState.y + 5 && o.y > pState.y - 15)
                    .sort((a, b) => getDistance(pState, a) - getDistance(pState, b))[0];

                if (nearestOff) {
                    pState.targetX = nearestOff.x;
                    pState.targetY = nearestOff.y;
                    pState.action = 'run_block';
                } else {
                    // Escort the returner
                    pState.targetX = ballCarrierState.x + (pState.x < ballCarrierState.x ? -3 : 3);
                    pState.targetY = ballCarrierState.y - 3; // Stay in front
                    pState.action = 'run_path';
                }
            }
            else if (pState.isOffense) {
                // 3. The Tackling Team (Originally Offense): Pursue!
                const dist = getDistance(pState, ballCarrierState);
                const leadTime = dist / 15;
                const carrierVx = ballCarrierState.vx || 0;
                const carrierVy = ballCarrierState.vy || 0;

                pState.targetX = ballCarrierState.x + (carrierVx * leadTime);
                pState.targetY = ballCarrierState.y + (carrierVy * leadTime);

                // 💡 FIX: Force the movement engine to process them as runners!
                pState.action = 'run_path';
            }
        });
        return; // EXIT EARLY! Do not run normal offense/defense logic.
    }

    // --- 2. BLOCKING LOGIC (O-Line) ---
    // Identify threats for blockers
    const allThreats = defenseStates.filter(d => {
        if (d.isBlocked || d.isEngaged || d.stunnedTicks > 0) return false;

        // 1. Explicit rushers/blitzers are always threats
        if (d.assignment?.includes('rush') || d.assignment?.includes('blitz')) return true;

        // 2. Defensive Linemen are always threats
        if (d.role === 'DL') return true;

        // 3. Any defender who encroaches into the pocket/box is a threat
        if (d.y < LOS + 3.0 && Math.abs(d.x - CENTER_X) < 10) return true;

        return false; // Ignore DBs and LBs dropping into coverage
    });
    const linemen = offenseStates.filter(p => !p.isEngaged && p.slot.startsWith('OL'));
    const otherBlockers = offenseStates.filter(p => !p.isEngaged && !p.slot.startsWith('OL') && (p.action === 'pass_block' || p.action === 'run_block'));

    const assignedThreats = new Set();

    const assignBlockerTarget = (blocker, threats) => {
        if (blocker.isEngaged) return;

        const VISION_RANGE = 10.0;
        const validThreats = threats.filter(t =>
            getDistance(blocker, t) < VISION_RANGE &&
            t.y > blocker.y - 1.5
        );

        let target = null;
        const isPassPlay = playType === 'pass';

        // 💡 FIX: Sort by "Natural Gap Logic"
        // We want the Left Tackle to stay Left, and the Right Tackle to stay Right.
        let sortedThreats = validThreats.sort((a, b) => {
            // Priority 1: Who is in my vertical lane? (Distance to my initial X)
            const laneDiffA = Math.abs(a.x - blocker.initialX);
            const laneDiffB = Math.abs(b.x - blocker.initialX);

            // Priority 2: Is someone else already handling this guy?
            const doubleTeamPenaltyA = assignedThreats.has(a.id) ? 15 : 0;
            const doubleTeamPenaltyB = assignedThreats.has(b.id) ? 15 : 0;

            return (laneDiffA + doubleTeamPenaltyA) - (laneDiffB + doubleTeamPenaltyB);
        });

        if (sortedThreats.length > 0) {
            target = sortedThreats[0];
            blocker.dynamicTargetId = target.id;
            assignedThreats.add(target.id);
        }

        if (target) {
            if (isPassPlay) {
                // 💡 FIX: DYNAMIC LEVERAGE (The True Pocket)
                const qb = offenseStates.find(p => p.slot.startsWith('QB'));
                if (qb) {
                    // Calculate the direct line between the Rusher and the QB
                    const dx = qb.x - target.x;
                    const dy = qb.y - target.y;
                    const distToQB = Math.max(0.1, Math.sqrt(dx * dx + dy * dy));

                    // The blocker's ideal target is 0.8 yards directly in front of the rusher, 
                    // anchoring exactly on that path to the QB.
                    blocker.targetX = target.x + (dx / distToQB) * 0.8;
                    blocker.targetY = target.y + (dy / distToQB) * 0.8;

                    // Anchor rule: Don't get pushed directly into the QB's lap
                    if (blocker.targetY < qb.y + 1.5) blocker.targetY = qb.y + 1.5;

                    // 💡 NEW: Aggressive Pass Blocking. Push them away from the QB.
                    // This creates a better pocket and stops blitzers from sliding through easily.
                    blocker.contactReduction = 1.3; // Boost speed for initial engagement
                }
            } else {
                // 💡 FIX: THE RUN WALL
                blocker.targetX = target.x; // Attack them directly
                blocker.targetY = target.y;
                blocker.contactReduction = 1.2; // Boost speed for initial engagement
            }

            // Auto-Engage
            if (getDistance(blocker, target) < 1.8) {
                const strDiff = (blocker.str || 50) - (target.str || 50);
                blocker.isEngaged = true;
                blocker.engagedWith = target;
                target.isEngaged = true;
                target.isBlocked = true;
                target.blockedBy = blocker;

                // Add to Battle Queue
                playState.blockBattles.push({
                    blocker: blocker,
                    defender: target,
                    status: 'ongoing',
                    battleScore: strDiff / 10, // Initial advantage
                    startTick: playState.tick
                });
            }
        } else {
            // No rusher? Hold the line.
            blocker.targetX = blocker.initialX;
            blocker.targetY = isPassPlay ? LOS - 1.5 : LOS + 1.0;
        }
    };

    linemen.forEach(ol => assignBlockerTarget(ol, allThreats));
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

        // --- 💡 SPECIAL TEAMS OVERRIDE (Punt Logic) ---
        if (playType === 'punt') {
            const isKickingTeam = pState.isOffense;
            const isReturnTeam = !pState.isOffense;
            const ballInAir = playState.ballState.inAir;
            const returnerHasBall = ballCarrierState && !ballCarrierState.isOffense;

            if (isKickingTeam) {
                if (!ballInAir && !returnerHasBall && playState.tick < 26) {
                    if (pState.slot === 'QB1') return;
                    const nearestRusher = defenseStates.find(d => getDistance(pState, d) < 5);
                    if (nearestRusher) {
                        pState.targetX = nearestRusher.x;
                        pState.targetY = Math.min(LOS, nearestRusher.y - 1);
                    } else {
                        pState.targetX = pState.initialX;
                        pState.targetY = LOS - 1;
                    }
                    return;
                }
                pState.action = 'pursuit';
                if (returnerHasBall) {
                    const dist = getDistance(pState, ballCarrierState);
                    const lead = dist / 15;
                    pState.targetX = ballCarrierState.x + (ballCarrierState.velocity?.x || 0) * lead;
                    pState.targetY = ballCarrierState.y + (ballCarrierState.velocity?.y || 0) * lead;
                } else {
                    pState.targetX = ballPos.targetX || ballPos.x;
                    pState.targetY = ballPos.targetY || ballPos.y;
                }
                return;
            }

            // B. RETURN TEAM AI
            if (isReturnTeam) {
                // 1. THE RETURNER (The guy supposed to catch it)
                // We identify them by their assignment OR if they already have the ball
                if (pState.assignment === 'punt_return' || pState.isBallCarrier) {
                    if (pState.isBallCarrier) return;
                    // Phase 2: RUN! (Handled by the "0. TURNOVER RETURN" block at the start of the function)
                    // We return here to let that specific logic take over.
                    else if (ballInAir) {
                        const landX = ballPos.targetX || ballPos.x;
                        const landY = ballPos.targetY || ballPos.y;
                        pState.targetX = landX;
                        pState.targetY = landY;
                        pState.action = 'pursuit';
                        if (getDistance(pState, { x: landX, y: landY }) < 2.0) {
                            pState.vx = 0; pState.vy = 0;
                        }
                        return;
                    }
                    // 2. The Blockers
                } else {
                    if (returnerHasBall) {
                        // LEAD BLOCK logic...
                        const returnerY = ballCarrierState.y;
                        const threat = offenseStates
                            .filter(e => !e.isBlocked && !e.isEngaged && e.y < returnerY + 15 && e.y > returnerY - 5)
                            .sort((a, b) => getDistance(pState, a) - getDistance(pState, b))[0];

                        if (threat) {
                            pState.targetX = threat.x; pState.targetY = threat.y;
                            if (getDistance(pState, threat) < 2.0) {
                                pState.isEngaged = true; pState.engagedWith = threat;
                                threat.isEngaged = true; threat.isBlocked = true; threat.blockedBy = pState;

                                playState.blockBattles.push({
                                    blocker: pState,
                                    defender: threat,
                                    status: 'ongoing',
                                    battleScore: 0,
                                    startTick: playState.tick
                                });
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
                        pState.targetY = Math.max(landY - 15, 10);
                    }
                    pState.action = 'run_block';
                    return;
                }
            }
        }

        // ------------------------------------------
        // A. OFFENSE AI
        // ------------------------------------------
        if (pState.isOffense) {
            // --- 1. BALL CARRIER LOGIC
            const isRunner = pState.isBallCarrier || (pState.slot === 'QB1' && pState.action === 'qb_scramble');

            if (isRunner) {
                pState.isBallCarrier = true;
                let targetX = pState.x;
                let targetY = 110;

                if (pState.role === 'QB' && pState.action === 'qb_scramble' && pState.y < LOS) {
                    const rollDir = pState.rolloutDir || (pState.x > CENTER_X ? 1 : -1);
                    targetX = pState.x + (rollDir * 8);
                    targetY = pState.y + 1.0;
                    targetX = Math.max(3, Math.min(FIELD_WIDTH - 3, targetX));
                } else {
                    // Standard Runner Pathing
                    const smartTarget = getSmartCarrierTarget(pState, defenseStates, offenseStates);
                    targetX = smartTarget.x;
                    targetY = smartTarget.y;

                    pState.action = 'run_path'; // Convert to standard run

                    const nearestDef = defenseStates.find(d => getDistance(pState, d) < 10);
                    if (nearestDef) {
                        const defendersNear = defenseStates.filter(d => getDistance(pState, d) < 2.0).length;
                        if (defendersNear > 1) pState.contactReduction = 0.85;
                        else if (defendersNear > 0) pState.contactReduction = 0.92;
                        else pState.contactReduction = 1.0;
                    } else {
                        pState.contactReduction = 1.0;
                    }
                }

                pState.targetX = targetX;
                pState.targetY = targetY;
                return;
            }

            // RECEIVER BALL TRACKING
            if (isBallInAir && !playState.ballState.isThrowAway) {
                const iq = pState.playbookIQ || 50;
                const flightTime = playState.tick - (playState.ballState.throwTick || 0);
                const reactionDelay = Math.max(1, 15 - Math.floor(iq / 7));

                if (flightTime > reactionDelay) {
                    pState.targetX = playState.ballState.targetX;
                    pState.targetY = playState.ballState.targetY;
                    pState.action = 'tracking_ball';
                    pState.contactReduction = 1.15; // Speed boost to get to ball
                    return; // Skip normal route logic
                }
            }

            // STANDARD OFFENSIVE ACTIONS
            if (!pState.action) {
                pState.action = 'idle';
                pState.targetX = pState.initialX;
                pState.targetY = pState.initialY;
            }

            switch (pState.action) {
                case 'handoff_setup':
                case 'handoff_receive': // 💡 FIX: Tells the AI to let the physics engine handle the approach
                case 'run_path':
                case 'run_fake':
                    break;

                case 'qb_setup':
                    const qbIQ = pState.playbookIQ || 50;
                    // PHASE 1: THE DROPBACK
                    if (!pState.hasCompletedDropback) {
                        pState.targetX = pState.initialX;
                        pState.targetY = pState.dropbackTargetY;
                        // Give the QB a speed boost during the dropback to simulate backpedaling
                        pState.contactReduction = 1.4;
                        // Once within 0.5 yards of target depth, plant feet and switch to phase 2
                        if (Math.abs(pState.y - pState.dropbackTargetY) < 0.5) {
                            pState.hasCompletedDropback = true;
                            pState.dropbackPhase = 'set';
                        }
                        break;
                    }

                    // PHASE 2: POCKET AWARENESS & ESCAPE
                    pState.contactReduction = 1.0;
                    let idealX = pState.initialX;
                    let idealY = pState.dropbackTargetY;
                    const rushers = defenseStates.filter(d => !d.isBlocked && !d.isEngaged && getDistance(pState, d) < 6);
                    // --- 💡 THE "PANIC" TRIGGER ---
                    const immediateThreat = rushers.find(r => getDistance(pState, r) < 3.5);

                    if (immediateThreat && (qbIQ > 45 || pState.agility > 50)) {
                        if (!pState.rolloutDir) {
                            const threatSide = immediateThreat.x > pState.x ? 1 : -1;
                            pState.rolloutDir = -threatSide; // Roll away from pressure
                        }
                        // Change action to scramble so the QB actually runs laterally
                        pState.action = 'qb_scramble';
                        pState.targetX = pState.x + (pState.rolloutDir * 8);
                        pState.targetY = pState.y + 1.0;
                        pState.loggedRollout = true;
                        if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] 🏃 ${pState.name} escapes the collapsing pocket!`, playState);
                        break;
                    }

                    // --- PHASE 3: STANDARD POCKET DRIFT
                    if (rushers.length > 0 && qbIQ > 40) {
                        let shiftX = 0; let shiftY = 0;
                        let edgePressure = false; let interiorPressure = false;

                        rushers.forEach(r => {
                            const dx = r.x - pState.x; const dy = r.y - pState.y;
                            // Categorize pressure type
                            if (Math.abs(dx) > 3.0) edgePressure = true;
                            if (Math.abs(dx) <= 3.0 && dy > 0) interiorPressure = true;
                            if (Math.abs(dx) > 2) shiftY -= 0.8;
                            if (Math.abs(dx) < 4) shiftX += (dx > 0 ? -1.2 : 1.2);
                        });

                        // "Step Up" Logic!
                        // If the edges are collapsing but the interior (A/B gaps) is clean, a smart QB steps forward.
                        if (edgePressure && !interiorPressure && qbIQ > 65) {
                            shiftY += 2.5;
                            if (gameLog && Math.random() < 0.05) pushGameLog(gameLog, `[Tick ${playState.tick}] 👣 ${pState.name} steps up into the pocket!`, playState);
                        }

                        const iqMod = qbIQ / 100;
                        pState.targetX = Math.max(pState.initialX - 4, Math.min(pState.initialX + 4, idealX + (shiftX * iqMod)));

                        // Hard cap the drift depth. A QB should NEVER drift more than 7.5 yards behind the LOS.
                        pState.targetY = Math.max(LOS - 7.5, Math.min(LOS - 1, idealY + (shiftY * iqMod)));
                    } else {
                        pState.targetX = idealX;
                        pState.targetY = idealY;
                    }
                    break;

                case 'run_route':
                    if (!pState.routePath || pState.currentPathIndex >= pState.routePath.length) {
                        pState.action = 'route_complete';
                        break;
                    }

                    const pt = pState.routePath[pState.currentPathIndex];
                    const distToNode = getDistance(pState, pt);

                    // As the receiver approaches the turn, they "plant" and "cut"
                    if (distToNode < 1.5) pState.contactReduction = 1.2 + ((pState.agility || 50) / 200);
                    // High agility = faster turns. We give a temporary speed burst 
                    // to simulate the "explosion" out of a break.
                    else pState.contactReduction = 1.0;

                    pState.targetX = pt.x; pState.targetY = pt.y;

                    if (distToNode < 0.6) {
                        pState.currentPathIndex++;
                        const coverageDefender = defenseStates.find(d => (d.assignment?.includes(pState.slot) || d.assignedPlayerId === pState.id) && getDistance(pState, d) < 4.0);
                        if (coverageDefender) {
                            const wrSkill = (pState.agility || 50) + (pState.playbookIQ || 50);
                            const dbSkill = (coverageDefender.agility || 50) + (coverageDefender.playbookIQ || 50);
                            // If WR wins the cut, they create separation and "stun" the DB's momentum
                            if (Math.random() * wrSkill > Math.random() * dbSkill * 0.85) {
                                coverageDefender.stunnedTicks = Math.max(coverageDefender.stunnedTicks, 15 + Math.floor((wrSkill - dbSkill) / 5));
                                const dx = coverageDefender.x - pState.x; const dy = coverageDefender.y - pState.y;
                                const dist = Math.max(0.1, Math.hypot(dx, dy));
                                coverageDefender.x += (dx / dist) * 0.8; coverageDefender.y += (dy / dist) * 0.8;
                                if (gameLog && Math.random() < 0.08) pushGameLog(gameLog, `[Tick ${playState.tick}] 💨 ${pState.name} shakes ${coverageDefender.name} for separation!`, playState);
                            } else {
                                // If DB wins, they stick to the receiver, potentially stunting their speed
                                pState.contactReduction = 0.8;
                                if (gameLog && Math.random() < 0.03) pushGameLog(gameLog, `[Tick ${playState.tick}] 🔒 ${coverageDefender.name} blankets ${pState.name}!`, playState);
                            }
                        }
                    }
                    break;

                case 'route_complete':
                    if (!pState.freestyleTick || playState.tick > pState.freestyleTick + 30) {
                        pState.freestyleTick = playState.tick;
                        let bestX = pState.x; let bestY = pState.y; let bestScore = 0;
                        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 6) {
                            for (let dist = 1; dist <= 5; dist += 1) {
                                const testX = pState.x + Math.cos(angle) * dist;
                                const testY = pState.y + Math.sin(angle) * dist;
                                if (testX < 2 || testX > 51.3 || testY < 0 || testY > 120) continue;
                                let score = 100 - (dist * 2);
                                defenseStates.forEach(d => {
                                    const distToDef = getDistance({ x: testX, y: testY }, d);
                                    if (distToDef < 5) score -= (25 / (distToDef + 0.5));
                                });
                                if (score > bestScore) { bestScore = score; bestX = testX; bestY = testY; }
                            }
                        }
                        pState.dynamicTargetX = bestX; pState.dynamicTargetY = bestY;
                    }
                    pState.targetX = pState.dynamicTargetX || pState.x;
                    pState.targetY = pState.dynamicTargetY || pState.y;
                    break;

                case 'pass_block':
                case 'run_block':
                    if (!pState.dynamicTargetId) {
                        pState.targetX = pState.initialX;
                        pState.targetY = (pState.action === 'pass_block') ? Math.max(LOS - 2.5, pState.y - 0.8) : pState.y + 1.0;
                    }
                    break;

                case 'idle':
                default:
                    pState.targetX = pState.x; pState.targetY = pState.y;
                    break;
            }
            return; // End Offense Loop
        }

        // ------------------------------------------
        // B. DEFENSE AI
        // ------------------------------------------
        if (!pState.isOffense) {

            // 1. DIAGNOSIS (IQ-Based Read)
            const isDL = pState.role === 'DL';
            const playDiagnosis = isDL ? playType : diagnosePlay(pState, playType, offensivePlayKey, playState.tick);
            const isRunRead = playDiagnosis === 'run';
            const isFooledByPA = (playDiagnosis === 'run' && playType === 'pass' && !isDL);

            // 2. CONTEXT ANALYSIS
            const carrierIsQB = ballCarrierState && ballCarrierState.role === 'QB';
            const isBallPastLOS = ballCarrierState && ballCarrierState.y > LOS + 0.5;
            const qbScrambling = carrierIsQB && (isBallPastLOS || ballCarrierState.action === 'qb_scramble');
            const assignment = pState.assignment;

            // 3. PURSUIT DECISION MATRIX (The Gatekeeper)
            let shouldPursue = false;
            if (ballCarrierState) {
                if (isBallInAir) shouldPursue = false;
                else if (isFooledByPA) shouldPursue = true;
                else if (ballCarrierState.role !== 'QB' || qbScrambling) shouldPursue = true;
                else if (assignment?.includes('blitz') || assignment?.includes('rush') || isDL) shouldPursue = true;
            }

            // 4. DISCIPLINE CHECK
            if (assignment?.startsWith('man_cover_') && shouldPursue && !isFooledByPA && !isDL) {
                const targetSlot = assignment.replace('man_cover_', '');
                const carrierSlot = ballCarrierState?.slot;
                if (carrierSlot !== targetSlot && !isRunRead && !qbScrambling) shouldPursue = false;
            }
            if (assignment?.startsWith('zone_') && pState.slot.startsWith('LB') && carrierIsQB && !qbScrambling && !isFooledByPA) {
                shouldPursue = false;
            }

            // --- 5. EXECUTE MOVEMENT ---
            if (shouldPursue && ballCarrierState) {
                // WHO ARE WE CHASING?
                const chaseTarget = isFooledByPA ? offenseStates.find(o => o.slot.startsWith('RB')) : ballCarrierState;

                if (chaseTarget) {
                    const dist = getDistance(pState, chaseTarget);
                    const iq = pState.playbookIQ || 50;
                    const leadTime = dist / (12 + (iq / 5));

                    pState.targetX = chaseTarget.x + ((chaseTarget.vx || 0) * leadTime);
                    pState.targetY = chaseTarget.y + ((chaseTarget.vy || 0) * leadTime);
                    pState.action = 'pursuit';

                    if (isFooledByPA && !pState.loggedPA && gameLog && Math.random() < 0.05) {
                        pushGameLog(gameLog, `[Tick ${playState.tick}] 🎣 ${pState.name} bites on the play action!`, playState);
                        pState.loggedPA = true;
                    }
                }
            }
            else if (isBallInAir) {
                const iq = pState.playbookIQ || 50;
                const flightTime = playState.tick - (playState.ballState.throwTick || 0);
                const reactionDelay = Math.max(2, 12 - Math.floor(iq / 10));

                if (flightTime > reactionDelay) {
                    if (ballPos.isThrowAway) {
                        pState.action = 'idle';
                        pState.targetX = pState.x; pState.targetY = pState.y;
                    } else {
                        // 💡 INTERCEPTION / BREAK ON BALL
                        const targetRec = offenseStates.find(o => o.id === ballPos.targetPlayerId);

                        if (targetRec && iq > 60) {
                            pState.targetX = (ballPos.targetX * 0.7) + (targetRec.x * 0.3);
                            pState.targetY = (ballPos.targetY * 0.7) + (targetRec.y * 0.3);
                            if (pState.slot === 'DB3' || pState.role === 'S') pState.targetY += 1.5;
                        } else {
                            pState.targetX = ballPos.targetX;
                            pState.targetY = ballPos.targetY;
                        }
                        pState.action = 'pursuit';
                    }
                } else {
                    executeAssignment(pState, assignment, offenseStates, LOS, playState);
                }
            }
            else {
                executeAssignment(pState, assignment, offenseStates, LOS, playState);
            }

            // Final Clamp to keep defenders on the field
            pState.targetX = Math.max(1, Math.min(52.3, pState.targetX));
            pState.targetY = Math.max(1, Math.min(119.0, pState.targetY));
        }
    }); // <-- This closes the playState.activePlayers.forEach loop
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

    // 2. MAN COVERAGE (Elastic Band + IQ Prediction + Jamming)
    if (assignment?.startsWith('man_cover_')) {
        const targetSlot = assignment.replace('man_cover_', '');
        let targetRec = pState.assignedPlayerId ? offenseStates.find(o => o.id === pState.assignedPlayerId) : null;
        if (!targetRec) targetRec = offenseStates.find(o => o.slot === targetSlot);

        if (targetRec) {
            const defSpeed = pState.speed || 50;
            const recSpeed = targetRec.speed || 50;
            const defIQ = pState.playbookIQ || 50;
            const defCoverSkill = pState.coverage || 50;

            const speedDiff = recSpeed - defSpeed;
            let cushionY = (targetRec.y > LOS + 15) ? 2.5 : 1.5;
            if (speedDiff > 10) cushionY += 2.0;
            if (speedDiff < -15) cushionY = Math.max(1.0, cushionY - 1.0);

            let cushionX = (targetRec.x < CENTER_X) ? 0.5 : -0.5;

            // 💡 FIX: Dedicated Jam State (Prevents stuttering)
            if (targetRec.y < LOS + 3 && getDistance(pState, targetRec) < 3.0) {
                if (typeof pState.jamDecisionMade === 'undefined') {
                    pState.jamDecisionMade = true;
                    const jamChance = (defCoverSkill + defIQ) / 200;
                    if (Math.random() < jamChance) {
                        pState.isJamming = true;
                        pState.jamTicks = 15; // Commit to the jam for ~0.75 seconds
                    }
                }
            }

            if (pState.jamTicks > 0) {
                pState.jamTicks--;
                // 💡 NEW: Force the defender to physically "push" the receiver during the jam.
                // This makes the jam effective, physically altering the receiver's path.
                const dx = targetRec.x - pState.x;
                const dy = targetRec.y - pState.y;
                const dist = Math.max(0.1, Math.hypot(dx, dy));

                // Push the receiver slightly away and delay their advance
                targetRec.x += (dx / dist) * 0.08;
                targetRec.y += (dy / dist) * 0.08;

                pState.targetX = targetRec.x - (dx / dist) * 0.5; // Stay tight on the hip
                pState.targetY = targetRec.y + (dy / dist) * 0.5;

                // Reduce receiver speed during the jam
                targetRec.contactReduction = 0.6;
                return; // Lock movement to the jam
            } else {
                // Reset receiver speed after jam
                targetRec.contactReduction = 1.0;
            }

            // Real-time Movement Following (Restored & Balanced)
            let perfectX = targetRec.x + cushionX;
            let perfectY = targetRec.y + cushionY;

            const wrAgility = targetRec.agility || 50;
            const dbAgility = pState.agility || 50;

            if (targetRec.action === 'run_route') {
                // 1. MENTAL: Route Anticipation (The "Smart DB" factor)
                // High IQ DBs read the hips and anticipate the target coordinate.
                // NOTE: defIQ is already declared earlier in this block!
                const latMovement = ((targetRec.targetX || targetRec.x) - targetRec.x);
                const longMovement = ((targetRec.targetY || targetRec.y) - targetRec.y);

                // IQ 100 = 1.0 (Perfect mirror), IQ 70 = 0.5 (Slight read), IQ < 40 = 0 (Just chases)
                const readMultiplier = Math.max(0, (defIQ - 50) / 50);

                perfectX += latMovement * readMultiplier * 0.60; // Reduced to allow inside leverage separation
                perfectY += longMovement * readMultiplier * 0.25; // Anticipate depth less aggressively

                // 2. PHYSICAL: Agility Trailing
                // Even if the DB reads it perfectly, a more agile WR can physically shake them
                const agiDiff = wrAgility - dbAgility;
                if (agiDiff > 0) {
                    // Receiver pulls away slightly based on momentum
                    perfectX -= (targetRec.vx || 0) * (agiDiff * 0.002);
                    perfectY -= (targetRec.vy || 0) * (agiDiff * 0.002);
                }
            }

            pState.targetX = perfectX;
            pState.targetY = perfectY;

        } else {
            const z = getZoneCenter('zone_short_middle', LOS);
            pState.targetX = z.x;
            pState.targetY = z.y;
        }
    }

    // 3. ZONE COVERAGE (Smart Zones with Leverage and Tethering)
    else if (assignment?.startsWith('zone_')) {
        const zone = zoneBoundaries[assignment];
        const zoneCenter = getZoneCenter(assignment, LOS);
        const isDeep = assignment.includes('deep') || pState.slot.startsWith('S');

        // A. Define the Bounding Box with an anticipation buffer
        const minX = (zone?.minX || 0) - 3.0;
        const maxX = (zone?.maxX || FIELD_WIDTH) + 3.0;
        const minY = LOS + (zone?.minY || 0) - 2.0;
        const maxY = LOS + (zone?.maxY || 25.0) + 3.0;

        // B. Filter valid threats inside the zone
        let zoneThreats = offenseStates.filter(o => {
            if (!o.action.includes('route')) return false;
            return o.x >= minX && o.x <= maxX && o.y >= minY && o.y <= maxY;
        });

        let primaryThreat = null;
        if (zoneThreats.length > 0) {
            if (isDeep) {
                // Safeties prioritize the deepest guy
                primaryThreat = zoneThreats.reduce((deepest, current) => current.y > deepest.y ? current : deepest);
            } else {
                // Linebackers prioritize the closest guy
                primaryThreat = zoneThreats.reduce((closest, current) =>
                    getDistance(pState, current) < getDistance(pState, closest) ? current : closest
                );
            }
        }

        if (primaryThreat) {
            // C. LEVERAGE POSITIONING
            if (isDeep) {
                // Stay deeper (+3.5y) and slightly inside the receiver
                const insideLeverageX = primaryThreat.x < CENTER_X ? 1.0 : -1.0;
                pState.targetX = primaryThreat.x + insideLeverageX;
                pState.targetY = Math.max(zoneCenter.y, primaryThreat.y + 3.5);
            } else {
                // Stay underneath (-1.5y) to jump the route
                pState.targetX = primaryThreat.x;
                pState.targetY = primaryThreat.y - 1.5;
            }

            // D. THE ZONE TETHER
            // If the receiver runs out of the zone, the defender stops at the edge
            const TETHER_LIMIT_X = isDeep ? 10.0 : 6.0;
            pState.targetX = Math.max(zoneCenter.x - TETHER_LIMIT_X, Math.min(zoneCenter.x + TETHER_LIMIT_X, pState.targetX));

            if (!isDeep) {
                const maxSinkDepth = LOS + (zone?.maxY || 15.0);
                pState.targetY = Math.min(maxSinkDepth, pState.targetY);
            }
            pState.zoneDriftTick = playState.tick;
        }
        else {
            // E. NO THREAT: SHUFFLE FEET & WATCH QB
            if (!pState.zoneDriftTick || playState.tick > pState.zoneDriftTick + 25) {
                pState.zoneDriftTick = playState.tick;
                let driftX = zoneCenter.x;
                const qb = offenseStates.find(p => p.slot.startsWith('QB'));
                if (qb) driftX += (qb.x < CENTER_X ? -1.5 : 1.5); // Drift toward QB's eyes

                pState.dynamicTargetX = driftX + (Math.random() - 0.5) * 2;
                pState.dynamicTargetY = zoneCenter.y + (Math.random() - 0.5) * 1.5;
            }
            pState.targetX = pState.dynamicTargetX || zoneCenter.x;
            pState.targetY = pState.dynamicTargetY || zoneCenter.y;
        }
    }

    // 4. QB SPY (Mirroring)
    else if (assignment === 'spy_QB') {
        const qb = offenseStates.find(p => p.slot.startsWith('QB'));
        if (qb) {
            pState.targetX = qb.x;
            pState.targetY = Math.max(LOS + 3.0, pState.y);
        } else {
            pState.targetX = pState.initialX;
            pState.targetY = LOS + 4.0;
        }
    }

    // 5. BLITZ / RUSH
    else if (assignment?.includes('rush') || assignment?.includes('blitz')) {
        const qb = offenseStates.find(p => p.slot.startsWith('QB'));
        if (qb) {
            const dx = qb.x - pState.x;
            const dy = qb.y - pState.y;

            const isEdgeRusher = Math.abs(pState.initialX - qb.initialX) >= 3.5;

            if (isEdgeRusher) {
                const escapeAngle = pState.initialX < qb.initialX ? -1 : 1;

                if (pState.y > qb.y + 1.0) {
                    pState.targetX = qb.x + (escapeAngle * 3.5);
                    pState.targetY = qb.y - 1.0;
                } else {
                    // 💡 FIX: Aim THROUGH the QB so the rusher accelerates into the hit
                    pState.targetX = qb.x + (dx * 0.5);
                    pState.targetY = qb.y - 2.0;
                }
            } else {
                // 💡 FIX: Interior rushers aim THROUGH the QB
                pState.targetX = qb.x + (dx * 0.5);
                pState.targetY = qb.y - 2.0;
            }
        } else {
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
    const defenders = playState.activePlayers.filter(p => !p.isOffense && p.stunnedTicks <= 0);

    blockers.forEach(blocker => {
        if (blocker.action !== 'pass_block' && blocker.action !== 'run_block') return;

        let target = null;

        // 💡 NEW: The "Look Out!" Proximity Override
        // If an unblocked rusher is dangerously close (flying through the gap), grab them!
        // This overrides the lineman's pre-assigned AI target.
        const imminentThreat = defenders
            .filter(d => getDistance(blocker, d) < 2.4 && d.y > blocker.y - 1.5)
            .sort((a, b) => getDistance(blocker, a) - getDistance(blocker, b))[0];

        if (imminentThreat) {
            target = imminentThreat;
        }
        // Priority 2: Assigned AI Target
        else if (blocker.dynamicTargetId) {
            target = defenders.find(d => d.id === blocker.dynamicTargetId);
            if (!target || target.isEngaged || getDistance(blocker, target) > 3.0) {
                target = null; // Lost him
            }
        }

        // Engage
        if (target) {
            const strDiff = (blocker.str || 50) - (target.str || 50);

            blocker.isEngaged = true;
            blocker.engagedWith = target;
            target.isEngaged = true;
            target.isBlocked = true;
            target.blockedBy = blocker;

            playState.blockBattles.push({
                blocker: blocker,
                defender: target,
                status: 'ongoing',
                battleScore: strDiff / 10,
                startTick: playState.tick
            });
        }
    });
}
function checkTackleCollisions(playState, gameLog) {
    // 1. Find Ball Carrier (We use the pre-found state)
    const carrier = playState.activePlayers.find(p => p.hasBall && !playState.ballState.isLoose);
    if (!carrier) return false;

    // 2. Identify Defense 
    // 💡 FIX: Dynamically target whoever is NOT on the carrier's team (fixes punt return friendly-fire)
    const tacklingTeam = playState.activePlayers.filter(p => p.isOffense !== carrier.isOffense);

    const defenders = tacklingTeam.filter(p => {
        if (p.stunnedTicks > 0) return false;

        // --- OPTIMIZATION: Use cached distance from the start of the tick ---
        const dist = p._distToCarrier;

        // 💡 FIX: Safety check for undefined distance, and strict > TACKLE_RANGE check
        if (dist === undefined || dist > TACKLE_RANGE) return false;

        // 💡 FIX: Prevent DL from reaching *through* the OL to sack the QB
        if (p.isBlocked || p.isEngaged) {
            // OPTIMIZATION: Use the direct object reference instead of .find(id)
            const blocker = p.blockedBy || p.engagedWith;

            if (blocker && typeof blocker === 'object') {
                // Calculate distance to blocker (this happens rarely, so getDistance is fine here)
                const distToBlocker = getDistance(p, blocker);

                if (dist > distToBlocker) {
                    const dxC = carrier.x - p.x;
                    const dyC = carrier.y - p.y;
                    const dxB = blocker.x - p.x;
                    const dyB = blocker.y - p.y;

                    // Dot product to see if carrier is "behind" the blocker
                    const dot = (dxC * dxB + dyC * dyB) / (dist * distToBlocker);

                    if (dot > 0.4) return false;
                }
            }
            // 💡 FIX: Significantly reduce the "reach tackle" range through blocks
            // 0.8 yards is ~2.4 feet. They can only make the tackle if the runner brushes right past them.
            return dist < 0.8;
        }

        return true;
    });

    for (const defender of defenders) {
        const distance = getDistance(carrier, defender);

        // 💡 NEW: Contact Avoidance Mechanics (Before Tackle Attempt)
        // Runners can attempt to dodge/hurdle/stiff-arm within 1.5 yards
        if (distance < 1.5) {
            // 💡 FIX: QBs cannot juke/hurdle while actively trying to hand the ball off
            const canPerformMove = (!carrier.moveCooldown || carrier.moveCooldown <= 0) && carrier.action !== 'handoff_setup';

            if (canPerformMove) {
                const roll = Math.random();

                // 1. HURDLE (Agility + Luck)
                const hurdleChance = (carrier.agi / 120) - (defender.spd / 150);
                if (roll < hurdleChance * 0.3) {
                    carrier.action = 'hurdle';
                    carrier.moveCooldown = 30;
                    defender.stunnedTicks = 20;
                    carrier.tacklesBrokenThisPlay = (carrier.tacklesBrokenThisPlay || 0) + 1;
                    if (gameLog) gameLog.push(`🏃 ${carrier.name} hurdled over ${defender.name}!`);
                    continue;
                }

                // 2. JUKE (Pure Agility)
                const jukeChance = (carrier.agi / 100) - (defender.tkl / 150);
                if (roll < jukeChance * 0.4) {
                    const dir = Math.random() > 0.5 ? 1 : -1;
                    carrier.action = dir === 1 ? 'juke_right' : 'juke_left';
                    carrier.x += dir * 1.2;
                    carrier.moveCooldown = 35;
                    defender.stunnedTicks = 30;
                    carrier.tacklesBrokenThisPlay = (carrier.tacklesBrokenThisPlay || 0) + 1;
                    if (gameLog) gameLog.push(`⚡ ${carrier.name} juked ${defender.name}!`);
                    continue;
                }

                // 3. STIFF-ARM (Strength)
                const stiffArmChance = ((carrier.str + (carrier.wgt / 100)) / 300) - (defender.str / 150);
                if (roll < stiffArmChance * 0.4) {
                    carrier.action = 'stiff_arm';
                    carrier.moveCooldown = 30;
                    const dx = defender.x - carrier.x, dy = defender.y - carrier.y;
                    const d = Math.max(0.1, Math.sqrt(dx * dx + dy * dy));
                    defender.x += (dx / d) * 2.5; defender.y += (dy / d) * 2.5;
                    defender.stunnedTicks = 25;
                    carrier.tacklesBrokenThisPlay = (carrier.tacklesBrokenThisPlay || 0) + 1;
                    if (gameLog) gameLog.push(`💪 ${carrier.name} stiff-armed ${defender.name}!`);
                    continue;
                }
            }
        }

        // A. Check Fumble First
        if (checkFumble(carrier, defender, playState, gameLog)) {
            return false; // Play continues as loose ball
        }

        // --- B. PHYSICS-BASED TACKLE CALCULATION ---
        const runnerVel = Math.hypot(carrier.vx, carrier.vy);
        const tacklerVel = Math.hypot(defender.vx, defender.vy);

        // Momentum (Mass * Velocity)
        const rMomentum = (carrier.wgt || 200) * runnerVel;
        const tMomentum = (defender.wgt || 200) * tacklerVel;

        // Skill vs Strength Power
        const tPower = (defender.tkl * 0.6) + (defender.str * 0.4);
        const rPower = (carrier.agi * 0.5) + (carrier.str * 0.5);

        // Calculate Success Chance
        let successChance = 0.68; // Base

        // 1. Momentum Delta: Being faster/heavier than the opponent helps.
        successChance += (tMomentum / Math.max(1, rMomentum) - 1.0) * 0.3;

        // 2. Mass (Weight) Delta: Pure "Big man vs Small man" logic.
        successChance += (defender.wgt / carrier.wgt - 1.0) * 0.5;

        // 3. Skill & Strength Delta
        successChance += (tPower - rPower) * 0.008; // 💡 Increased skill multiplier slightly

        // 4. Angle Adjustment: Tackling from behind is a 30% penalty
        if (defender.y < carrier.y - 0.2) successChance *= 0.7;

        // 5. BEAST MODE LIMITER: Cumulative fatigue
        const brokenCount = carrier.tacklesBrokenThisPlay || 0;
        // 💡 FIX: Massively increase penalty for successive broken tackles to prevent pinball runs
        successChance += (brokenCount * 0.40);

        successChance = Math.max(0.10, Math.min(0.98, successChance));

        if (Math.random() < successChance) {
            // --- TACKLE SUCCESS ---
            playState.playIsLive = false;
            playState.yards = carrier.y - playState.lineOfScrimmage;
            playState.statEvents.push({ type: 'tackle', playerId: defender.id });

            // Safety/Touchback/Sack Logic
            const inOwnEndzone = (carrier.isOffense && carrier.y <= 10.0) || (!carrier.isOffense && carrier.y >= 110.0);
            const caughtInEndzone = playState.returnStartY !== null && ((carrier.isOffense && playState.returnStartY <= 10.0) || (!carrier.isOffense && playState.returnStartY >= 110.0));

            if (inOwnEndzone) {
                if (caughtInEndzone) { playState.touchback = true; playState.finalBallY = carrier.isOffense ? 20 : 100; }
                else { playState.safety = true; }
            } else if (carrier.role === 'QB' && carrier.y < playState.lineOfScrimmage && playState.type === 'pass') {
                playState.sack = true;
                playState.statEvents.push({ type: 'sack', playerId: defender.id, qbId: carrier.id });
            }

            if (gameLog) {
                const hitForce = Math.round(tMomentum / 10);
                const type = playState.sack ? '💥 SACK' : '✋ TACKLE';
                pushGameLog(gameLog, `[Tick ${playState.tick}] ${type} by ${defender.name} (Force: ${hitForce})`, playState);
            }
            return true;

        } else {
            // --- TACKLE BROKEN ---
            carrier.tacklesBrokenThisPlay = brokenCount + 1;
            defender.stunnedTicks = 40;

            // Physics: Runner loses speed based on the weight of the guy they just hit
            const speedDrain = (defender.wgt / carrier.wgt) * 0.3;
            carrier.vx *= (1 - speedDrain);
            carrier.vy *= (1 - speedDrain);

            if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] 💪 ${carrier.name} runs THROUGH ${defender.name}!`, playState);

            break; // Interaction resolved for this tick
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
function resolveOngoingBlocks(playState, gameLog, offenseStates = [], defenseStates = []) {
    const battlesToRemove = [];
    const ballCarrier = playState.activePlayers.find(p => p.isBallCarrier);

    playState.blockBattles.forEach((battle, index) => {
        // Skip first tick
        if (battle.startTick === playState.tick) return;

        if (battle.status !== 'ongoing') {
            battlesToRemove.push(index);
            return;
        }

        const blocker = battle.blocker;
        const defender = battle.defender;


        // 1. Validation Checks
        if (!blocker || !defender ||
            blocker.engagedWith !== defender ||
            defender.blockedBy !== blocker ||
            blocker.stunnedTicks > 0 || defender.stunnedTicks > 0) {

            // Force disengage
            if (blocker) { blocker.engagedWith = null; blocker.isEngaged = false; }
            if (defender) { defender.isBlocked = false; defender.blockedBy = null; defender.isEngaged = false; }

            battle.status = 'disengaged';
            battlesToRemove.push(index);
            return;
        }

        // 2. --- 💡 NEW: SHED-TO-TACKLE LOGIC ---
        if (ballCarrier) {
            const distToCarrier = getDistance(defender, ballCarrier);

            if (distToCarrier < 1.5) {
                const reactionScore = (defender.playbookIQ || 50) + (defender.blockShedding || 50);

                if (reactionScore + getRandomInt(0, 50) > 100) {
                    battle.status = 'win_B'; // Defender wins
                    defender.action = 'pursuit';
                    blocker.stunnedTicks = 10;
                }
            }
        }

        // 3. Stats Calculation (Standard Block Battle)
        const blockPower = (((blocker.blocking || 50) * 1.25) + (blocker.strength || 50)) * blocker.fatigueModifier;
        let shedPower = ((defender.blockShedding || 50) + (defender.strength || 50)) * defender.fatigueModifier;
        // 💡 PASS RUSHER TECHNIQUE MOVES
        const isPassRush = defender.assignment?.includes('rush') || defender.assignment?.includes('blitz');

        // FIX: Replaced early 'returns' with proper nesting so we don't skip Step 4!
        if (isPassRush && defender.isBlocked && blocker) {

            // 💡 FIX: Initialize cooldown to 15 ticks (0.75s) so blocks hold initially off the snap
            if (typeof defender.moveCooldown === 'undefined') defender.moveCooldown = 15;

            if (defender.moveCooldown > 0) {
                defender.moveCooldown--;
            } else {
                const qbState = offenseStates?.find(p => p.slot?.startsWith?.('QB'));
                if (qbState) {
                    const technique = (defender.blockShedding ?? 50) + (defender.playbookIQ ?? 50);
                    const escapeScore = technique + getRandomInt(-30, 30);

                    // Direction toward QB
                    const dx = qbState.x - defender.x;
                    const dy = qbState.y - defender.y;
                    const dist = Math.max(0.1, Math.hypot(dx, dy));
                    const dirX = dx / dist;
                    const dirY = dy / dist;

                    // --- Swim Move ---
                    // 💡 FIX: Probability adjusted from 15% to 1.5% per tick to prevent instant teleporting
                    if (escapeScore > 115 && Math.random() < 0.015) {
                        const speed = 0.6;
                        defender.x += dirX * speed;
                        defender.y += dirY * speed;

                        blocker.stunnedTicks = 10; // 0.2 sec
                        shedPower *= 0.92;
                        defender.moveCooldown = 20; // 0.8 sec
                    }
                    // --- Spin Move ---
                    // 💡 FIX: Probability adjusted from 10% to 1.0% per tick
                    else if (escapeScore > 125 && Math.random() < 0.01) {
                        const bx = blocker.x - defender.x;
                        const by = blocker.y - defender.y;

                        const spinX = -by * 0.15;
                        const spinY = bx * 0.15;

                        defender.x += spinX;
                        defender.y += spinY;

                        blocker.stunnedTicks = 5; // 0.25 sec
                        shedPower *= 0.9;
                        defender.moveCooldown = 20; // 1 sec
                    }
                }
            }
        }

        // 4. Physics Push (The "Trenches")
        let pushAmount = 0;

        // FIX: Ensure we don't accidentally overwrite a Shed-to-Tackle victory from Step 2
        if (battle.status === 'ongoing') {
            pushAmount = resolveBattle(blockPower, shedPower, battle);

            // Apply push movement if still ongoing
            if (battle.status === 'ongoing') {
                const dx = defender.x - blocker.x;
                const dy = defender.y - blocker.y;
                const dist = Math.max(0.1, Math.sqrt(dx * dx + dy * dy));

                const pushX = (dx / dist) * pushAmount * 0.5;
                const pushY = (dy / dist) * pushAmount * 0.5;

                blocker.x += pushX; blocker.y += pushY;
                defender.x += pushX; defender.y += pushY;
            }
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
 * ADVANCED QB AI
 * Corrected: Helper functions defined BEFORE use to prevent crashes.
 */
function updateQBDecision(qbState, offenseStates, defenseStates, playState, offensiveAssignments, gameLog) {

    const offenseTeam = offenseStates;
    const defenseTeam = defenseStates;

    // --- 0. VALIDATION CHECKS ---
    if (!qbState || !qbState.hasBall || playState.ballState.inAir || playState.ballState.throwInitiated) return;
    if (qbState.isEngaged || qbState.stunnedTicks > 0) return;
    // Don't make a new decision if QB is bracing for a hit
    if (qbState.action === 'sacked') return;

    // --- 0C. SITUATIONAL CONTEXT ---
    // Define isDesperationTime here using playState data
    const scoreDiff = (playState.offenseScore || 0) - (playState.defenseScore || 0);
    const currentQuarter = playState.quarter || 1;
    const playsLeft = playState.playsRemaining || 60;

    // Desperation = Down by > 8 in the 4th, OR down by any amount with < 60s left in the game
    const isDesperationTime = (currentQuarter >= 4) &&
        ((scoreDiff < 0 && playsLeft <= 9) || (scoreDiff <= -9 && playsLeft <= 15));

    // --- 0B. LINE OF SCRIMMAGE CHECK (Football Rule) ---
    // QB cannot throw FORWARD if they've crossed the line of scrimmage (only backwards/laterals allowed)
    // If QB has crossed the line, force them to scramble or take a sack
    const hasQBCrossedLine = qbState.y > (playState.lineOfScrimmage + 0.5);
    if (hasQBCrossedLine) {
        // QB is past the line - must scramble or eat sack
        // Only process crossing once per transition (use a flag to avoid repeated messages)
        if (!qbState.hasProcessedLineCrossing) {
            const pressureDefender = defenseStates.find(d => !d.isBlocked && !d.isEngaged && getDistance(qbState, d) < 4.5);
            if (pressureDefender && getDistance(qbState, pressureDefender) < 2.0) {
                // Imminent sack - QB takes it
                if (gameLog) gameLog.push(`💥 ${qbState.name} tackled after crossing the line of scrimmage!`);
                qbState.action = 'sacked';
                qbState.hasProcessedLineCrossing = true;
                return;
            } else {
                // Open lane - scramble
                qbState.action = 'run_path'; // Convert to standard run past LOS
                playState.qbIntent = 'scramble';
                if (gameLog) gameLog.push(`🏃 ${qbState.name} scrambles after crossing the line!`);
                qbState.hasProcessedLineCrossing = true;
                return;
            }
        }
        // Already processed crossing, just return
        return;
    } else {
        // QB is back behind the line - reset the crossing flag
        qbState.hasProcessedLineCrossing = false;
    }

    // Get Attributes
    const qbPlayer = getPlayer(qbState.id);
    const qbAttrs = qbPlayer?.attributes || { mental: { playbookIQ: 50 }, physical: { agility: 50, strength: 50 }, technical: { throwingAccuracy: 50 } };

    const qbIQ = Math.max(20, Math.min(99, qbAttrs.mental?.playbookIQ ?? 50));
    const qbAgility = qbAttrs.physical?.agility || 50;
    const qbStrength = qbAttrs.physical?.strength || 50;
    const qbAcc = qbAttrs.technical?.throwingAccuracy || 50;

    // --- 1. BUILD PROGRESSION (The Fix) ---
    // Ensure we don't look at RBs first. 
    // Sort Order: WRs -> TEs -> RBs
    if (!qbState.readProgression || qbState.readProgression.length === 0) {
        qbState.readProgression = offenseStates
            .filter(p => p.slot !== 'QB1' && (p.action.includes('route') || p.action === 'idle'))
            .sort((a, b) => {
                // Assign priorities
                const getPriority = (slot) => {
                    if (slot.startsWith('WR')) return 1;
                    if (slot.startsWith('TE')) return 2;
                    if (slot.startsWith('RB')) return 3; // Look at RBs last
                    return 4;
                };
                return getPriority(a.slot) - getPriority(b.slot);
            })
            .map(p => p.slot);
    }

    const progression = qbState.readProgression;

    if (typeof qbState.ticksOnCurrentRead === 'undefined') qbState.ticksOnCurrentRead = 0;
    if (typeof qbState.currentReadTargetSlot === 'undefined') qbState.currentReadTargetSlot = progression[0];

    // --- 🔧 CRITICAL FIX: Safety check for empty progression with forced fallback ---
    if (!progression || progression.length === 0) {
        // No receivers running routes - force include ALL non-QB players as emergency fallback
        const emergencyProgression = offenseStates
            // 💡 FIX: Exclude OL from the emergency progression so the QB doesn't target them!
            .filter(p => p.slot !== 'QB1' && !p.slot.startsWith('OL'))
            .map(p => p.slot);

        if (emergencyProgression.length === 0) {
            // Truly no receivers exist - QB takes sack
            if (gameLog) gameLog.push(`${qbState.name} has no targets and takes the sack.`);
            qbState.action = 'sacked';
            return;
        }

        // Use emergency progression (including blockers as last resort)
        qbState.readProgression = emergencyProgression;
        qbState.currentReadTargetSlot = emergencyProgression[0];
        if (gameLog) gameLog.push(`⚠️ ${qbState.name} forced to use emergency read options.`);
    }


    // --- 2. HELPER: GEOMETRIC TARGET ANALYSIS ---
    const getTargetInfo = (slot) => {
        if (!slot) return null;
        const recState = offenseStates.find(r => r.slot === slot);
        if (!recState || (!recState.action.includes('route') && recState.action !== 'idle')) return null;

        const distFromQB = getDistance(qbState, recState);
        let minSeparation = 100;

        defenseStates.forEach(d => {
            if (!d.isBlocked && !d.isEngaged && d.stunnedTicks === 0) {
                let dist = getDistance(recState, d);

                // Undercut Check (Defender between QB and WR)
                const distDefenderToQB = getDistance(qbState, d);

                // 💡 FIX: Only flag as "undercut" if the defender is significantly closer to the QB.
                // Do NOT flag the primary coverage defender as an undercut!
                if (distDefenderToQB < distFromQB - 4.0) {
                    const dx = recState.x - qbState.x;
                    const dy = recState.y - qbState.y;
                    const defDx = d.x - qbState.x;
                    const defDy = d.y - qbState.y;

                    const dotProduct = (dx * defDx + dy * defDy) / (distFromQB * distDefenderToQB);

                    if (dotProduct > 0.9) { // Defender is directly in the passing lane
                        const area = Math.abs((d.x - qbState.x) * (recState.y - qbState.y) - (d.y - qbState.y) * (recState.x - qbState.x));
                        const distToLane = area / distFromQB;
                        if (distToLane < 1.5) dist = 0.0; // Lane is actually blocked
                    }
                }

                // 💡 FIX: Trailing Bonus (Defender is behind the receiver)
                if (recState.action === 'run_route' && d.y < recState.y - 0.5 && dist > 0.1) {
                    dist += 2.5;
                }

                if (dist < minSeparation) minSeparation = dist;
            }
        });

        // 💡 FIX: Throw Anticipation!
        // If a receiver is within 2 yards of the next "cut" in their route tree, an elite QB
        // knows they are about to snap away from the defender. 
        if (recState.action === 'run_route' && recState.routePath && recState.currentPathIndex < recState.routePath.length) {
            const nextNode = recState.routePath[recState.currentPathIndex];
            const distToNode = getDistance(recState, nextNode);

            // Only smart QBs (IQ > 70) can anticipate throws. They get up to a +1.5 separation bonus artificially.
            if (distToNode < 2.0 && qbIQ > 70) {
                const anticipationBonus = ((qbIQ - 60) / 40) * 1.5;
                minSeparation += anticipationBonus;
            }
        }

        return { state: recState, separation: minSeparation, distFromQB };
    };

    // --- 3. ASSESS PRESSURE & POCKET GEOMETRY ---
    const unblocked = defenseStates.filter(d => !d.isBlocked && !d.isEngaged && d.stunnedTicks === 0 && getDistance(qbState, d) < 4.5);
    const pressureDefender = unblocked.length > 0 ? unblocked[0] : null;
    const pressureCount = unblocked.length;
    const isPressured = !!pressureDefender;
    const imminentSackDefender = isPressured && getDistance(qbState, pressureDefender) < 1.2;

    // 💡 NEW: Hot Read Trigger! If an unblocked rusher is within 4.5 yards, panic-mode activates.
    const isHotReadSituation = isPressured && getDistance(qbState, pressureDefender) < 4.5;

    // 💡 NEW: Pocket Collapse Detection
    // Check if defenders are collapsing from one side (left/right of QB)
    let leftPressure = 0, rightPressure = 0;
    unblocked.forEach(d => {
        const sideOfQB = d.x - qbState.x;
        if (Math.abs(sideOfQB) > 3.0) {
            if (sideOfQB < -3.0) leftPressure++;
            if (sideOfQB > 3.0) rightPressure++;
        }
    });
    const pocketComfort = Math.max(leftPressure, rightPressure) > pressureCount * 0.6 ? 'collapsing' : 'intact';

    // Sack Prevention (Stop Teleporting)
    if (isPressured && getDistance(qbState, pressureDefender) < 1.2) return;

    // --- 4. SCRAMBLE DRILL (Throwing on the run) ---
    if (qbState.action === 'qb_scramble') {
        const allReceivers = offenseStates.filter(p => p.slot !== 'QB1' && (p.action.includes('route') || p.action === 'route_complete'));
        let bestTarget = null;
        let bestScore = -1;

        allReceivers.forEach(rec => {
            const info = getTargetInfo(rec.slot);
            // 💡 FIX: Lowered separation requirement so QBs will actually pull the trigger on the run
            if (info && info.separation > 0.8) {
                const onSameSide = Math.sign(rec.x - CENTER_X) === Math.sign(qbState.x - CENTER_X);
                // Heavily weight separation and being on the same side of the field
                const score = (info.separation * 3.0) + (onSameSide ? 8 : 0) - (info.distFromQB * 0.2);
                if (score > bestScore) { bestScore = score; bestTarget = rec; }
            }
        });

        // 💡 FIX: Lowered threshold from 15 to 8 to encourage more off-platform throws
        if (bestTarget && bestScore > 8) {
            const onTheRunMod = (qbAgility / 100) * 0.85; // Agility mitigates accuracy loss on the run
            if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] 🏃‍♂️🎯 ${qbState.name} throws on the run!`, playState);
            executeThrow(qbState, bestTarget, qbStrength, qbAcc * onTheRunMod, playState, gameLog, "Throw on Run");
            return;
        } else {
            // 💡 NEW: If about to be sacked while rolling out, throw it away
            const immediateThreat = defenseStates.find(d => !d.isBlocked && !d.isEngaged && getDistance(qbState, d) < 2.5);
            if (immediateThreat && qbIQ > 60) {
                if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] 👋 ${qbState.name} throws it away under pressure.`, playState);
                playState.ballState.inAir = true;
                playState.ballState.throwInitiated = true;
                playState.ballState.throwerId = qbState.id;
                playState.ballState.isThrowAway = true;

                const throwToLeft = qbState.x < CENTER_X;
                const targetX = throwToLeft ? -5 : FIELD_WIDTH + 5;
                const targetY = qbState.y + 10;

                playState.ballState.targetX = targetX;
                playState.ballState.targetY = targetY;

                const dx = targetX - qbState.x;
                const dy = targetY - qbState.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const ballSpeed = 25;
                const t = Math.max(0.1, dist / ballSpeed);

                playState.ballState.vx = dx / t;
                playState.ballState.vy = dy / t;
                playState.ballState.vz = (-0.3 + (4.9 * t * t)) / t;

                playState.ballState.throwTick = playState.tick;
                qbState.hasBall = false;
                return;
            }

            return; // Keep running if no one is open
        }
    }

    // --- 5. PROGRESSION LOGIC (Value System) ---

    // Scan Speed: High IQ (90) = 10 ticks per read. Low IQ (50) = 20 ticks per read.
    let scanSpeedBase = Math.max(8, (110 - qbIQ) / 3);
    if (isPressured) scanSpeedBase *= (qbIQ > 75 ? 0.6 : 1.5); // Smart QBs scan faster under pressure, dumb QBs panic

    if (typeof qbState.ticksInPocket === 'undefined') qbState.ticksInPocket = 0;
    qbState.ticksInPocket++;

    // Calculate how many reads the QB has processed so far (sees more of the field the longer he holds it)
    const numReadsVisible = Math.min(progression.length, 1 + Math.floor(qbState.ticksInPocket / scanSpeedBase));

    // 💡 FIX: Force the QB to let the play develop! Minimum 2.25 seconds (45 ticks) for standard reads.
    const MIN_DROPBACK_TICKS = 45;
    const canThrowStandard = (playState.tick >= MIN_DROPBACK_TICKS || isHotReadSituation) && qbState.hasCompletedDropback;

    let maxDecisionTimeTicks = 110 + (qbIQ / 3) + (qbAgility / 3);
    if (qbState.loggedRollout) maxDecisionTimeTicks += 35; // Rolling out extends the play

    let decisionMade = false;
    let reason = "";

    if (imminentSackDefender) { decisionMade = true; reason = "Imminent Sack"; }
    else if (playState.tick >= maxDecisionTimeTicks) { decisionMade = true; reason = "Time Expired"; }
    else if (isPressured && playState.tick >= 90 && Math.random() < Math.max(0.01, 0.2 - qbIQ / 200)) {
        decisionMade = true;
        reason = "Pressure Panic";
    }

    // 💡 NEW: Dynamic Separation Requirements
    const OPEN_SEP = isPressured ? 0.3 : Math.max(0.6, 1.3 - (qbIQ / 150));

    // 💡 NEW: Target Value Evaluator (Requires plays to develop!)
    const getTargetValue = (slot) => {
        const rec = offenseTeam.find(r => r.slot === slot);
        if (!rec || !rec.action.includes('route')) return null;

        // 1. ESTIMATE FLIGHT TIME
        const distFromQB = getDistance(qbState, rec);
        // Average ball speed is ~22 yps. Flight time = distance / speed
        const estimatedFlightTime = distFromQB / 22;

        // 2. PROJECT POSITIONS AT ARRIVAL
        // Where will the receiver be?
        const projRecX = rec.x + (rec.vx || 0) * estimatedFlightTime;
        const projRecY = rec.y + (rec.vy || 0) * estimatedFlightTime;

        let minProjectedSeparation = 20;
        let defendersClosingIn = 0;

        defenseTeam.forEach(d => {
            if (d.stunnedTicks > 0) return;

            // Project where the defender will be when the ball arrives
            // We assume they keep running their current direction (pursuit/zone)
            const projDefX = d.x + (d.vx || 0) * estimatedFlightTime;
            const projDefY = d.y + (d.vy || 0) * estimatedFlightTime;

            const projDist = Math.hypot(projRecX - projDefX, projRecY - projDefY);

            if (projDist < minProjectedSeparation) {
                minProjectedSeparation = projDist;
            }

            // Count how many defenders are projected to be within 5 yards of the catch
            if (projDist < 5.0) {
                defendersClosingIn++;
            }
        });

        // 3. SCORING LOGIC (Using Projections)
        const depth = rec.y - playState.lineOfScrimmage;
        const iqFactor = qbIQ / 100;

        // Base score uses PROJECTED separation
        let score = (Math.min(minProjectedSeparation, 6) * 10);

        // DEPTH BONUSES
        if (depth > 5 && depth < 15) score += 20;
        if (depth >= 15) score += 30 * iqFactor;

        // --- THE "TRIPLE COVERAGE" KILLER ---
        // Heavily penalize throwing into "Crowds"
        if (defendersClosingIn >= 2) {
            // Low IQ QBs might still try it, High IQ QBs will see the crowd and look away
            score -= (30 + (20 * iqFactor));
        }

        // --- SAFETY HELP RECOGNITION ---
        // If it's a deep pass and the projected separation is tight, it's a dangerous throw
        if (depth > 20 && minProjectedSeparation < 2.0) {
            score -= 50;
        }

        // Penalty for checkdowns if not pressured
        if (depth < 0 && !playState.isPressured) score -= 40;

        return {
            score: score,
            info: { state: rec }, // The engine needs best.info.state
            separation: minProjectedSeparation
        };
    };

    let targetPlayerState = null;
    let actionTaken = "None";
    let readDebugLog = [];

    if (!decisionMade && canThrowStandard) {
        let bestTargetEval = null;
        let highestScore = -Infinity;

        // Evaluate ALL reads the QB has processed so far
        for (let i = 0; i < numReadsVisible; i++) {
            const slot = progression[i];
            const evalResult = getTargetValue(slot);

            if (evalResult) {
                // Record the score (e.g., "WR1: 42")
                readDebugLog.push(`${slot}:${evalResult.score.toFixed(0)}`);

                if (evalResult.score > highestScore) {
                    highestScore = evalResult.score;
                    bestTargetEval = evalResult;
                }
            } else {
                readDebugLog.push(`${slot}:X`); // X = Not a valid route right now
            }
        }

        // THRESHOLD TO THROW
        let THROW_THRESHOLD = 35;
        if (isPressured) THROW_THRESHOLD = 15;
        if (isHotReadSituation) THROW_THRESHOLD = 0;

        // EXECUTE THROW DECISION
        if (bestTargetEval && bestTargetEval.score > THROW_THRESHOLD) {
            targetPlayerState = bestTargetEval.info.state;
            actionTaken = isHotReadSituation ? "Hot Read Throw" : "Throw Value Target";
            decisionMade = true;

            // 💡 NEW: Push the progression breakdown to the game log!
            if (gameLog) {
                const readProgress = `${numReadsVisible}/${progression.length}`;
                gameLog.push(`[Tick ${playState.tick}] 🧠 QB Reads (${readProgress}): [${readDebugLog.join(', ')}] -> Selected: ${targetPlayerState.slot}`);
            }
        }

        // SCRAMBLE CHECK (If no throw found but lane is open)
        const openLane = !defenseStates.some(d => !d.isBlocked && !d.isEngaged && Math.abs(d.x - qbState.x) < 3.5 && d.y < qbState.y + 1);
        if (!decisionMade && openLane && (isPressured || playState.tick > 80)) {
            const scrambleChance = (playState.tick > 100) ? 0.3 : ((qbAgility / 100) * 0.05);
            if (Math.random() < scrambleChance) {
                qbState.action = 'run_path'; // Tucks and runs upfield
                qbState.isBallCarrier = true;
                playState.qbIntent = 'scramble';
                if (gameLog && !qbState.hasLoggedScramble) {
                    gameLog.push(`🏃 ${qbState.name} tucks it and runs upfield!`);
                    qbState.hasLoggedScramble = true;
                }
                return;
            }
        }

        // EMERGENCY DESPERATION (End of Play, forces a throw to whoever is best)
        if (!decisionMade && playState.tick > 115) {
            const desperation = progression
                .map(s => getTargetValue(s))
                .filter(v => v !== null)
                .sort((a, b) => b.score - a.score)[0];

            if (desperation && desperation.score > -20) {
                targetPlayerState = desperation.info.state;
                actionTaken = "Desperation Throw";
                decisionMade = true;
            } else {
                reason = "Time Expired";
                decisionMade = true;
            }
        }
    }

    // 4. FORCED (Sack/Panic/Time Expired)
    // Only execute this if decisionMade is true AND no target was organically found
    if (decisionMade && !targetPlayerState) {
        // 💡 NEW: Print the reads even if the QB decided no one was open!
        if (gameLog && readDebugLog.length > 0 && actionTaken !== "Hot Read Throw") {
            gameLog.push(`[Tick ${playState.tick}] 🧠 QB Reads: [${readDebugLog.join(', ')}] -> Result: NO OPEN TARGETS`);
        }

        if (reason === "Imminent Sack") {
            const chanceToEatSack = (110 - qbIQ) / 100;
            if (Math.random() < chanceToEatSack) return; // Eat sack

            // 💡 FIX: Before throwing away, do one final "Panic Scan" for any open WRs downfield
            const panicTarget = offenseStates
                .filter(o => o.slot !== 'QB1' && !o.slot.startsWith('OL'))
                .map(o => getTargetValue(o.slot))
                .filter(v => v && v.score > 20) // Only if they are actually decently open
                .sort((a, b) => b.score - a.score)[0];

            if (panicTarget) {
                targetPlayerState = panicTarget.info.state;
                actionTaken = "Panic Throw";
                decisionMade = true;
            } else {
                actionTaken = "Throw Away";
            }
        } else {
            actionTaken = "Throw Away";
        }
    }

    // EXECUTE
    if (actionTaken === "Throw Away") {
        if (gameLog) gameLog.push(`👋 ${qbState.name} throws it away.`);
        playState.ballState.inAir = true;
        playState.ballState.throwInitiated = true;
        playState.ballState.throwerId = qbState.id;

        playState.ballState.isThrowAway = true;

        const distToLeftSideline = qbState.x;
        const distToRightSideline = FIELD_WIDTH - qbState.x;
        const throwToLeft = distToLeftSideline < distToRightSideline;

        const targetX = throwToLeft ? -5 : FIELD_WIDTH + 5; // Throw out of bounds
        const targetY = qbState.y + 10;

        playState.ballState.targetX = targetX;
        playState.ballState.targetY = targetY;

        // 💡 FIX: Throw it on a much faster, sharper trajectory to clear the play quickly
        const dx = targetX - qbState.x;
        const dy = targetY - qbState.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ballSpeed = 25; // Bullet pass speed
        const t = Math.max(0.1, dist / ballSpeed);

        playState.ballState.vx = dx / t;
        playState.ballState.vy = dy / t;
        playState.ballState.vz = (-0.3 + (4.9 * t * t)) / t; // Physics to land in 't' seconds

        playState.ballState.throwTick = playState.tick;
        qbState.hasBall = false;
        return;
    }

    if (targetPlayerState && actionTaken.includes("Throw")) {
        // 💡 NEW: Accuracy degradation under pressure
        let adjustedAccuracy = qbAcc;
        if (isPressured) {
            // 💡 FIX: Less severe pressure penalty for higher IQ QBs
            const basePenalty = 15;
            const IQ_MITIGATION = (qbIQ / 100) * 0.5; // High IQ QBs are less affected
            const pressurePenalty = basePenalty + (pressureCount * 5) - (basePenalty * IQ_MITIGATION);
            adjustedAccuracy = Math.max(30, qbAcc - pressurePenalty);
        }
        if (pocketComfort === 'collapsing') {
            // Collapsing pocket is still bad, but slightly less punitive
            adjustedAccuracy *= 0.95;
        }
        executeThrow(qbState, targetPlayerState, qbStrength, adjustedAccuracy, playState, gameLog, actionTaken);
    }

    // 4. DESPERATION THROW (Late game last resort)
    if (isDesperationTime && !decisionMade && !targetPlayerState) {
        // 💡 FIX: Ensure we explicitly exclude OL from Hail Mary targets
        const deepReceiver = offenseStates
            .filter(o => o.slot !== 'QB1' && !o.slot.startsWith('OL') && (o.action.includes('route') || o.action === 'route_complete'))
            .sort((a, b) => b.y - a.y)[0];

        if (deepReceiver && Math.random() > 0.5) {
            if (gameLog) gameLog.push(`🚨 ${qbState.name} heaves it downfield in desperation!`);
            executeThrow(qbState, deepReceiver, qbStrength, qbAcc * 0.4, playState, gameLog, "Desperation Throw");
            return;
        }
    }
}

/**
 * HELPER: Calculates physics vectors for a throw
 */
function executeThrow(qbState, target, strength, accuracy, playState, gameLog, actionType) {
    // --- FOOTBALL RULE: QB Cannot Throw Forward Past Line of Scrimmage ---
    const hasQBCrossedLine = qbState.y > (playState.lineOfScrimmage + 0.5);
    const isForwardPass = target.y > qbState.y || (Math.abs(target.y - qbState.y) < 0.5 && target.y > qbState.y - 2);

    if (hasQBCrossedLine && isForwardPass) {
        if (gameLog) gameLog.push(`🚫 ILLEGAL FORWARD PASS: ${qbState.name} crossed the line!`);
        playState.ballState.inAir = false;
        playState.ballState.throwInitiated = false;
        qbState.hasBall = true;
        return;
    }

    const startX = qbState.x;
    const startY = qbState.y;
    const throwDistance = Math.hypot(target.x - startX, target.y - startY);

    // --- 1. DETERMINE PASS TYPE ---
    let passType = 'touch'; // Default medium arc
    const assignment = target.assignment || '';

    // Bullet: Short throws or quick breaking routes
    if (throwDistance < 12 || ['Slant', 'Drag', 'Curl', 'Hitch', 'Quick'].some(r => assignment.includes(r))) {
        passType = 'bullet';
    }
    // Lob: Deep bombs or vertical routes
    else if (throwDistance > 25 || ['Fly', 'Go', 'Streak', 'Post'].some(r => assignment.includes(r))) {
        passType = 'lob';
    }

    // --- 2. CALCULATE BALL SPEED ---
    // 99 Str = ~30 yds/sec (61 mph). 50 Str = ~23 yds/sec.
    const maxArmVelocity = 16 + (strength / 100) * 14.0;

    let ballSpeed = maxArmVelocity;
    if (passType === 'lob') ballSpeed *= 0.70; // High arc, travels slower horizontally
    else if (passType === 'touch') ballSpeed *= 0.85; // Medium arc
    // Bullet uses 100% of maxArmVelocity

    let aimX = target.x;
    let aimY = target.y;

    // --- 3. ROUTE-AWARE LEAD CALCULATION (Fixes the Underthrow) ---
    if (target.action === 'run_route' && target.routePath && target.routePath.length > 0) {
        const estTime = throwDistance / ballSpeed;
        const qbIQ = qbState.iq || 50;

        // 💡 FIX: Dial back the lead factor so receivers aren't overthrown.
        // 1.0 = Aiming at the exact spot they will be.
        let leadFactor = 0.75 + (qbIQ / 250);
        if (passType === 'lob') leadFactor += 0.15; // Deep balls get slight lead
        if (passType === 'bullet') leadFactor -= 0.15; // Bullets are thrown at the body

        // Receiver speed in yards per second
        const receiverYPS = 5.0 + ((target.spd || 50) / 25);
        let distanceToTravel = receiverYPS * estTime * leadFactor;

        let currX = target.x;
        let currY = target.y;
        let lastValidDirX = 0;
        let lastValidDirY = 1; // Default to straight downfield

        // Trace the receiver's route path
        for (let i = target.currentPathIndex; i < target.routePath.length; i++) {
            const nextNode = target.routePath[i];
            const dx = nextNode.x - currX;
            const dy = nextNode.y - currY;
            const distToNext = Math.hypot(dx, dy);

            // Save the direction they are running
            if (distToNext > 0.1) {
                lastValidDirX = dx / distToNext;
                lastValidDirY = dy / distToNext;
            }

            if (distanceToTravel > distToNext) {
                distanceToTravel -= distToNext;
                currX = nextNode.x;
                currY = nextNode.y;
            } else {
                const ratio = distanceToTravel / distToNext;
                aimX = currX + dx * ratio;
                aimY = currY + dy * ratio;
                distanceToTravel = 0;
                break;
            }
        }

        // 💡 THE UNDERTHROW FIX: Extrapolate if they run out of drawn route!
        // If the receiver is running deep and the route array runs out, we project 
        // the target point forward along their current trajectory into open space.
        if (distanceToTravel > 0) {
            aimX = currX + (lastValidDirX * distanceToTravel);
            aimY = currY + (lastValidDirY * distanceToTravel);
        }

    } else {
        // Scramble / Freestyle / Checkdown leading
        const estTime = throwDistance / ballSpeed;
        aimX += (target.vx || 0) * estTime;
        aimY += (target.vy || 0) * estTime;
    }

    // --- 4. ACCURACY ERRORS ---
    const distancePower = 1.5 - (accuracy / 100);
    const distanceFactor = Math.pow(throwDistance / 25, distancePower);
    let errorMargin = ((100 - accuracy) / 12) * distanceFactor;

    if (playState.isPressured) errorMargin *= (2.0 - (qbState.iq / 100));

    const dirX = aimX - startX;
    const dirY = aimY - startY;
    const mag = Math.max(0.1, Math.hypot(dirX, dirY));
    const uX = dirX / mag;
    const uY = dirY / mag;

    // Bias towards overthrowing rather than underthrowing deep balls
    const longBias = (Math.random() > 0.3) ? 1.4 : -0.6;
    const longError = (Math.random() * errorMargin) * longBias;
    const latError = (Math.random() - 0.5) * errorMargin * 1.2;

    aimX += (uX * longError) + (-uY * latError);
    aimY += (uY * longError) + (uX * latError);

    // Clamp to field loosely
    aimX = Math.max(-5, Math.min(FIELD_WIDTH + 5, aimX));
    // Clamp aim to 0.5 yards inside the back of the endzone (119.5)
    aimY = Math.max(0.5, Math.min(FIELD_LENGTH - 0.5, aimY));

    // --- 5. FINALIZE PHYSICS ---
    const finalDist = Math.hypot(aimX - startX, aimY - startY);
    const t = Math.max(0.1, finalDist / ballSpeed);

    // Calculate Z Velocity (Arc) based on Pass Type
    let baseZ = 0;
    // 💡 FIX: Give passes a slight upward push so they clear the D-Line helmets
    if (passType === 'bullet') baseZ = 0.5; // Flat rope, but pushes upward initially
    else if (passType === 'touch') baseZ = 1.2; // Moderate arc
    else baseZ = 3.0; // High lob

    const vz = (baseZ + (4.9 * t * t)) / t;

    playState.ballState = {
        // 💡 FIX: QB release height raised to 2.2 yards (~6'6") to represent arm extension
        x: startX, y: startY, z: 2.2, inAir: true, throwTick: playState.tick, releaseeTick: playState.tick,
        vx: (aimX - startX) / t, vy: (aimY - startY) / t, vz: vz,
        targetX: aimX, targetY: aimY, targetPlayerId: target.id, throwerId: qbState.id, isThrowAway: false
    };

    qbState.hasBall = false;
    qbState.isBallCarrier = false;
    qbState.action = 'idle';

    playState.statEvents.push({ type: 'pass_attempt', qbId: qbState.id });

    if (gameLog) {
        const passTypeStr = passType.charAt(0).toUpperCase() + passType.slice(1);
        gameLog.push(`[Tick ${playState.tick}] 🏈 ${qbState.name} throws a ${passTypeStr} to ${target.name} | Air Dist: ${finalDist.toFixed(1)}y`);
    }
}

/**
 * Handles Punter decision-making (timing the kick).
 * This runs INSTEAD of updateQBDecision on punt plays.
 */
function updatePunterDecision(playState, offenseStates, gameLog) {
    const punter = offenseStates.find(p => p.slot === 'QB1');
    if (!punter || !punter.hasBall) return;

    // Ball starts at Center (0, LOS) and travels to Punter (0, LOS-12)
    const snapDuration = 15; // 0.75 seconds to reach punter
    if (playState.tick < snapDuration) {
        const pct = playState.tick / snapDuration;
        const snapStartY = playState.lineOfScrimmage - 0.5;
        // Move ball from LOS to Punter's hands
        playState.ballState.x = 0;
        playState.ballState.y = snapStartY + (punter.y - snapStartY) * pct;
        playState.ballState.z = 0.5 + (pct * 0.5); // Slight arc
        return;
    }

    // Punter catches snap at tick 15, kicks at tick 25
    if (playState.tick < 25) {
        playState.ballState.x = punter.x;
        playState.ballState.y = punter.y;
        playState.ballState.z = 1.2;
        return;
    }

    const punterPower = punter.attributes?.physical?.strength || 50;
    const punterAcc = punter.attributes?.technical?.kickingAccuracy || 50;

    // Target Logic: Aim for the "Coffin Corner" or deep field
    const isLeftHash = punter.x < 26.6;
    const targetX = isLeftHash ? 42.0 : 11.0; // Aim away from center but stay in bounds

    // Punts now target 45 yards base + up to 25 yards from strength
    let puntDistance = 45 + (punterPower * 0.25);

    // 💡 FIX: Coffin Corner logic. If the punt would go into the endzone, shorten it to pin them inside the 10.
    if (playState.lineOfScrimmage + puntDistance > 105) {
        puntDistance = 105 - playState.lineOfScrimmage; // Aim for the 5-yard line
    }

    const targetY = playState.lineOfScrimmage + puntDistance;

    // Reduced variance so punts don't wildly fly out of bounds 10 yards downfield
    const errorX = (Math.random() - 0.5) * (100 - punterAcc) * 0.2;
    // 💡 FIX: Reduce Y-variance when coffin-corner kicking so we don't accidentally get a touchback anyway
    const errorY = (Math.random() - 0.5) * (100 - punterAcc) * (targetY === 105 ? 0.1 : 0.3);

    const finalTargetX = Math.max(2, Math.min(51, targetX + errorX));
    const finalTargetY = Math.min(118, targetY + errorY);

    // 3. Execute Kick Physics
    const distY = finalTargetY - punter.y;
    const distX = finalTargetX - punter.x;

    // Realistic Hangtime: 4.0 to 5.5 seconds
    const hangTime = 4.0 + (punterPower / 65);

    playState.ballState.vx = distX / hangTime;
    playState.ballState.vy = distY / hangTime;
    // Standard projectile physics: v0 = (g * t) / 2
    playState.ballState.vz = (9.8 * hangTime) / 2;

    // Physics Vectors
    playState.ballState.vx = (finalTargetX - punter.x) / hangTime;
    playState.ballState.vy = (finalTargetY - punter.y) / hangTime;
    playState.ballState.vz = 4.9 * hangTime;

    // 4. Update State
    playState.ballState.inAir = true;
    playState.ballState.throwerId = punter.id;
    playState.ballState.x = punter.x;
    playState.ballState.y = punter.y;
    playState.ballState.z = 1.5; // Kick from waist height

    // 💡 FIX: Set these so the return team knows where to run!
    playState.ballState.targetX = finalTargetX;
    playState.ballState.targetY = finalTargetY;
    playState.ballState.throwTick = playState.tick;

    punter.hasBall = false;
    punter.isBallCarrier = false;
    punter.action = 'idle'; // Punter watches the play

    if (gameLog) gameLog.push(`[Tick ${playState.tick}] 👟 ${punter.name} punts the ball! (${Math.round(puntDistance)} yards)`);
}
/**
 * Handles ball arrival at target coordinates.
 * Handles Catches, Drops, Interceptions, Swats, and Muffed Punts.
 */
function handleBallArrival(playState, carrier, playResult, gameLog) {
    const ball = playState.ballState;
    if (!ball.inAir && !ball.isLoose) return;

    // If the ball has already been swatted down or dropped, stop other players from interacting with it mid-air
    if (ball.isSwatted) {
        // 💡 FIX: We still need to kill the play if the swatted ball hits the ground!
        if (ball.z <= 0) {
            ball.z = 0;
            ball.vz = 0; // Stop the ball from falling further

            if (playState.type === 'pass' && !ball.isLoose && playState.playIsLive) {
                playState.playIsLive = false; // Kill the physics loop!
                playState.incomplete = true;
                playState.finalBallY = playState.lineOfScrimmage;
                if (gameLog) gameLog.push(`[Tick ${playState.tick}] ⏱️ Pass hits the turf. Incomplete.`);
            }
        }
        return; // Now we can safely return so players don't try to catch it
    }

    const pointToSegmentDist = (px, py, x1, y1, x2, y2) => {
        const A = px - x1; const B = py - y1; const C = x2 - x1; const D = y2 - y1;
        const dot = A * C + B * D; const lenSq = C * C + D * D;
        let param = lenSq !== 0 ? dot / lenSq : -1;
        if (param < 0) param = 0; else if (param > 1) param = 1;
        const dx = px - (x1 + param * C); const dy = py - (y1 + param * D);
        return Math.sqrt(dx * dx + dy * dy);
    };

    const playersInRange = playState.activePlayers.filter(p => {
        // 1. RECOVERY COOLDOWN (Prevents Magnet Recatch in a loop)
        if (ball.isLoose && p.id === ball.lastDroppedById) {
            const ticksSinceDrop = playState.tick - (ball.droppedTick || 0);
            if (ticksSinceDrop < 25) return false;
        }

        // 💡 FIX: Kicker/Punter cannot touch the ball for at least 1 second after kick
        const ticksSinceKick = playState.tick - (ball.throwTick || 0);
        if (p.id === ball.throwerId && ticksSinceKick < 20) return false;

        // 💡 FIX: Kicking team cannot catch their own punt in the air
        if (playState.type === 'punt' && p.isOffense && ball.z > 0.5) return false;
        if (ball.droppedById === p.id) return false;

        // 💡 FIX: Offensive Linemen know they are ineligible.
        if (p.isOffense && p.slot.startsWith('OL') && playState.type === 'pass' && !ball.isLoose && !ball.tipCount) {
            return false;
        }

        // 💡 FIX: Friendly Fire Prevention!
        if (p.isOffense && playState.type === 'pass' && !ball.isLoose && !ball.tipCount) {
            if (p.id !== ball.targetPlayerId) {
                const targetPlayer = playState.activePlayers.find(t => t.id === ball.targetPlayerId);
                if (targetPlayer) {
                    const distToTarget = Math.sqrt((p.x - targetPlayer.x) ** 2 + (p.y - targetPlayer.y) ** 2);
                    if (distToTarget > 4.0) return false;
                }
            }
        }

        // 💡 NEW: Realistic Dynamic Catch Radius & Vertical Reach based on Physical Height
        // PERFORMANCE MAPPING: Look for the top-level 'hgt' or 'height' first before digging into objects
        let playerHeight = p.hgt || p.height || 70;
        if (!p.hgt && !p.height) {
            if (p.attributes?.physical?.height) {
                playerHeight = p.attributes.physical.height;
            } else {
                const pObj = getPlayer(p.id);
                if (pObj?.attributes?.physical?.height) {
                    playerHeight = pObj.attributes.physical.height;
                }
            }
        }

        // Vertical jump/reach max threshold (approx. 72 inch player reaches 3.2 yards up)
        const maxCatchHeight = (playerHeight / 36) + 1.2;
        if (ball.inAir && ball.z > maxCatchHeight) return false;

        // Catch Radius: A 6'4" (76 inch) player gets a massive 1.04 radius vs a 5'8" (68 in) 0.72 radius
        const heightBonus = Math.max(0, (playerHeight - 65) * 0.04);
        let dynamicCatchRadius = 0.6 + heightBonus; // ✅ FIX: Change const to let
        const CATCH_TOLERANCE = 0.25;

        if (p.action === 'tracking_ball') {
            // 💡 FIX: Receivers tracking deep balls get a much larger bucket to simulate "running under it"
            dynamicCatchRadius *= 1.8;
        }

        const distNow = Math.sqrt((p.x - ball.x) ** 2 + (p.y - ball.y) ** 2);
        if (distNow <= (dynamicCatchRadius + CATCH_TOLERANCE)) return true;

        if (typeof ball.prevX === 'number' && typeof ball.prevY === 'number') {
            const segDist = pointToSegmentDist(p.x, p.y, ball.prevX, ball.prevY, ball.x, ball.y);
            if (segDist <= (dynamicCatchRadius + CATCH_TOLERANCE)) return true;
        }
        return false;
    });

    // 💡 FIX 1: Only run catch calculations if it's NOT a throw away and someone is there
    if (!ball.isThrowAway && playersInRange.length > 0) {
        // 💡 FIX: Give the intended receiver a 0.5 yard "priority" radius in jump balls
        playersInRange.sort((a, b) => {
            const distA = getDistance(a, ball) - (a.id === ball.targetPlayerId ? 0.5 : 0);
            const distB = getDistance(b, ball) - (b.id === ball.targetPlayerId ? 0.5 : 0);
            return distA - distB;
        });
        const bestCandidate = playersInRange[0];

        // 💡 CRITICAL FIX: Define catching and agility BEFORE calculating hndEff
        // PERFORMANCE MAPPING: Use flattened stats if available
        let catching = bestCandidate.ctch || bestCandidate.catchingHands;
        let agility = bestCandidate.agi || bestCandidate.agility;

        if (catching === undefined) {
            if (bestCandidate.attributes) {
                catching = bestCandidate.attributes.technical?.catchingHands || 50;
                agility = bestCandidate.attributes.physical?.agility || 50;
            } else {
                const pObj = getPlayer(bestCandidate.id);
                if (pObj) {
                    catching = pObj.attributes?.technical?.catchingHands || 50;
                    agility = pObj.attributes?.physical?.agility || 50;
                } else {
                    catching = 50; agility = 50; // Final safe fallback
                }
            }
        }

        // 2. NOW calculate the display stats for the game log
        const hndEff = Math.round(catching * (bestCandidate.fatigueModifier || 1));
        const fatPct = Math.round((bestCandidate.fatigueModifier || 1) * 100);

        const isDefense = !bestCandidate.isOffense;
        const pushLog = (m) => {
            if (!gameLog) return;
            if (gameLog[gameLog.length - 1] === m) return;
            gameLog.push(m);
        };

        // 💡 FIX: Re-balanced Catching Odds
        let catchScore = (catching * 0.60) + (agility * 0.20) + 35; // Increased base floor significantly

        // 💡 FIX: Massive penalty for DBs so they don't catch 80% of jump balls. Forces them to Swat instead.
        if (isDefense) catchScore -= 80;
        if (playersInRange.length > 1) catchScore -= 10;
        if (playState.type === 'punt') catchScore += 20;

        // 💡 FIX: Point-Blank Penalty. If the ball was just thrown (< 10 ticks / 0.5s ago), 
        // it's incredibly hard for a DL to react and get their hands up in time.
        const ticksInAir = playState.tick - (ball.throwTick || 0);
        if (ticksInAir < 15 && isDefense && playState.type === 'pass') {
            // 💡 FIX: DLs almost never swat bullets right out of the QB's hand unless very lucky
            if (bestCandidate.role === 'DL') catchScore -= 120;
            else catchScore -= 60;
        }

        if (Math.random() * 100 < catchScore) {

            // --- 💡 NEW: BOUNDARY CHECK ---
            const isOutOfBounds = bestCandidate.y >= 120 || bestCandidate.y <= 0 ||
                bestCandidate.x >= FIELD_WIDTH || bestCandidate.x <= 0;

            if (isOutOfBounds) {
                ball.isSwatted = true;
                ball.vz = -2; // Ball drops
                pushLog(`[Tick ${playState.tick}] 🚩 OUT OF BOUNDS! ${bestCandidate.name} caught it, but was past the line.`);
                return; // Exit catch logic
            }
            // --- SUCCESSFUL CATCH ---
            ball.inAir = false;
            ball.isLoose = false;

            // 💡 FIX: Snap the ball perfectly to the receiver's chest to avoid visual hovering mid-air
            ball.x = bestCandidate.x;
            ball.y = bestCandidate.y;
            ball.z = 1.0;
            ball.vx = 0; ball.vy = 0; ball.vz = 0;

            bestCandidate.hasBall = true;
            bestCandidate.isBallCarrier = true;
            bestCandidate.action = 'run_path';

            // 💡 NEW: Force all defenders to "Locate" the new runner
            playState.activePlayers.forEach(p => {
                if (!p.isOffense) {
                    p.action = 'pursuit';
                    p.snapReactionTimer = 0; // Ensure no lingering delays
                }
            });

            // --- FULL PUNT LOGIC RESTORED ---
            if (playState.type === 'punt' && !bestCandidate.isOffense) {
                pushLog(`[Tick ${playState.tick}] 🏈 ${bestCandidate.name} catches the punt! Return started.`);
                playState.possessionChanged = true;
                playState.returnStartY = bestCandidate.y;
                playState.activePlayers.forEach(p => { if (p.id !== bestCandidate.id) p.action = 'pursuit'; });
                return;
            }

            const actionX = ball.x.toFixed(1);
            const actionY = ball.y.toFixed(1);
            const actionZ = ball.z.toFixed(1);
            const yardage = (ball.y - playState.lineOfScrimmage).toFixed(1);

            if (isDefense) {
                pushLog(`[Tick ${playState.tick}] ❗ INTERCEPTION! ${bestCandidate.role} ${bestCandidate.name} at (${actionX}, ${actionY}) | Gain: ${yardage}y`);
                playState.interceptionOccurred = true;
                playState.possessionChanged = true;
                playState.turnover = true;
                playState.returnStartY = bestCandidate.y;
                playState.statEvents.push({ type: 'interception', interceptorId: bestCandidate.id, throwerId: ball.throwerId });
                return;
            }

            pushLog(`[Tick ${playState.tick}] 👍 CATCH! ${bestCandidate.role} ${bestCandidate.name} at (${actionX}, ${actionY}, z:${actionZ}) | Gain: ${yardage}y`);
            const yardsGain = bestCandidate.y - playState.lineOfScrimmage;
            playState.statEvents.push({ type: 'completion', receiverId: bestCandidate.id, qbId: ball.throwerId, yards: yardsGain });
            return;

        } else {
            // --- DROP / SWAT / TIP ---
            if (isDefense) {
                if (playState.type === 'punt') return;

                const last = ball.lastInteraction;
                if (!(last && last.playerId === bestCandidate.id && (playState.tick - last.tick) <= 5)) {

                    let swatChance = (catching * 0.6) + (agility * 0.4) + 25;

                    // 💡 FIX: Apply the Point-Blank penalty to Swats/Tips too!
                    const ticksInAir = playState.tick - (ball.throwTick || 0);
                    if (ticksInAir < 15 && playState.type === 'pass') {
                        if (bestCandidate.role === 'DL') swatChance -= 80;
                        else swatChance -= 40;
                    }

                    if (Math.random() * 100 > swatChance) return;

                    ball.tipCount = (ball.tipCount || 0) + 1;
                    const isTip = (Math.random() < 0.25) && ball.tipCount < 3;

                    if (isTip) {
                        pushLog(`[Tick ${playState.tick}] 🖐️ ${bestCandidate.name} tips pass! (Hands: ${hndEff}, Energy: ${fatPct}%)`);
                        ball.vz = 3.0 + (Math.random() * 2);
                        ball.vx += (Math.random() - 0.5) * 6;
                        ball.vy += (Math.random() - 0.5) * 6;
                        ball.lastInteraction = { tick: playState.tick, playerId: bestCandidate.id, type: 'tip' };
                    } else {
                        pushLog(`[Tick ${playState.tick}] 🚫 ${bestCandidate.name} swats the pass away! (Hands: ${hndEff}, Energy: ${fatPct}%)`);
                        ball.vz = -8.0;
                        ball.vx *= 0.3;
                        ball.vy *= 0.3;
                        ball.isSwatted = true;
                        ball.lastInteraction = { tick: playState.tick, playerId: bestCandidate.id, type: 'swat' };
                    }

                    ball.targetX = ball.x + ball.vx;
                    ball.targetY = ball.y + ball.vy;
                }
            } else {
                // --- OFFENSE DROP / BOBBLE ---
                const last = ball.lastInteraction;
                if (!(last && last.playerId === bestCandidate.id && (playState.tick - last.tick) <= 5)) {

                    ball.tipCount = (ball.tipCount || 0) + 1;

                    // 💡 FIX: 20% chance an offensive player bobbles the ball into the air instead of dropping it clean
                    const isBobble = (Math.random() < 0.20) && ball.tipCount < 3;

                    if (isBobble) {
                        pushLog(`[Tick ${playState.tick}] 🖐️ ${bestCandidate.name} bobbles the ball! (Hands: ${hndEff}, Energy: ${fatPct}%)`);
                        ball.vz = 2.5 + Math.random(); // Pops up slightly
                        ball.vx += (Math.random() - 0.5) * 3;
                        ball.vy += (Math.random() - 0.5) * 3;
                        ball.lastInteraction = { tick: playState.tick, playerId: bestCandidate.id, type: 'bobble' };
                    } else {
                        pushLog(`[Tick ${playState.tick}] ❌ ${bestCandidate.name} drops the pass! (Hands: ${hndEff}, Energy: ${fatPct}%)`);
                        playState.statEvents.push({ type: 'drop', playerId: bestCandidate.id });
                        ball.vz = -5.0; // Straight down
                        ball.vx *= 0.2;
                        ball.vy *= 0.2;
                        ball.droppedById = bestCandidate.id;
                        ball.isSwatted = true;
                        ball.lastInteraction = { tick: playState.tick, playerId: bestCandidate.id, type: 'drop' };
                    }
                }
            }
        }
    }

    // --- D. GROUND PHYSICS (Ball hit turf) ---
    // (Fully Restored PUNT DOWNING LOGIC)
    if (ball.z <= 0) {
        ball.z = 0;

        // 💡 FIX 2: Instantly kill the play when a throw-away hits the ground
        if (ball.isThrowAway) {
            ball.vz = 0; ball.vx = 0; ball.vy = 0;
            if (playState.playIsLive) {
                playState.playIsLive = false;
                playState.incomplete = true;
                if (gameLog) gameLog.push("⏱️ Pass lands out of bounds.");
            }
            return;
        }

        // PUNT DOWNING RULE (Stops when velocity is low)
        if (playState.type === 'punt') {
            ball.vz = -ball.vz * 0.5; ball.vx *= 0.8; ball.vy *= 0.8;
            if (Math.abs(ball.vx) < 0.5 && Math.abs(ball.vy) < 0.5) {
                if (gameLog && playState.playIsLive) gameLog.push(`[Tick ${playState.tick}] ⏱️ Punt downed.`);
                playState.playIsLive = false; playState.possessionChanged = true;
                playState.finalBallY = ball.y;
            }
            const downingPlayer = playState.activePlayers.find(p => p.isOffense && getDistance(p, ball) < 1.0);
            if (downingPlayer) {
                if (gameLog) gameLog.push(`🛑 ${downingPlayer.name} downs the punt.`);
                playState.playIsLive = false; playState.possessionChanged = true;
                playState.finalBallY = ball.y;
            }
        }
        // PASSING RULE (Statue Killer Fix)
        else if (playState.type === 'pass' && !ball.isLoose) {
            const wasCaught = playState.statEvents.some(e => e.type === 'completion' || e.type === 'interception');
            if (playState.playIsLive && !wasCaught) {
                playState.playIsLive = false;
                playState.incomplete = true;
                ball.vz = 0; ball.vx = 0; ball.vy = 0; // Stop ball
                playState.finalBallY = playState.lineOfScrimmage;
                if (gameLog) gameLog.push(`[Tick ${playState.tick}] ⏱️ Pass hits the turf. Incomplete.`);
            } else if (wasCaught && playState.playIsLive) {
                playState.playIsLive = false;
                if (gameLog && !playState.fumbleOccurred) gameLog.push(`[Tick ${playState.tick}] ⏱️ Ball hits the ground.`);
            }
        }
        // FUMBLE RULE (Bounce)
        else {
            ball.vz = -ball.vz * 0.6; ball.vx *= 0.8; ball.vy *= 0.8;
        }
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
    const BASE_RADIUS = 0.45; // Base radius for a hypothetical 0 lb player

    for (let i = 0; i < players.length; i++) {
        const p1 = players[i];
        for (let j = i + 1; j < players.length; j++) {
            const p2 = players[j];

            if (p1.id === p2.id) continue; // 💡 FIX: Stop colliding with self
            if (p1.engagedWith === p2) continue; // High-performance object check

            const dx = p1.x - p2.x;
            const dy = p1.y - p2.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // 💡 NEW: Radius scales dynamically with weight!
            // 150 lbs = ~0.60 radius | 250 lbs = ~0.70 radius | 350 lbs = ~0.80 radius
            let r1 = BASE_RADIUS + ((p1.weight || 200) / 1000);
            let r2 = BASE_RADIUS + ((p2.weight || 200) / 1000);
            let combinedRadius = r1 + r2;

            if (dist < combinedRadius && dist > 0.01) {
                const overlap = combinedRadius - dist;

                p1.isSqueezing = true;
                p2.isSqueezing = true;

                // Heavier players push lighter players more easily
                const totalWeight = (p1.weight || 200) + (p2.weight || 200);
                const pushFactorP1 = ((p2.weight || 200) / totalWeight) * 0.4;
                const pushFactorP2 = ((p1.weight || 200) / totalWeight) * 0.4;

                const pushX = (dx / dist) * overlap;
                const pushY = (dy / dist) * overlap;

                p1.x += pushX * pushFactorP1;
                p1.y += pushY * pushFactorP1;
                p2.x -= pushX * pushFactorP2;
                p2.y -= pushY * pushFactorP2;
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
    const { gameLog = [], weather, ballOn, ballHash = 'M', down, yardsToGo, offenseScore = 0, defenseScore = 0, playsRemaining = 60, quarter = 1 } = context;
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

    if (gameLog) {
        // Convert down number to ordinal (1st, 2nd, etc.)
        const downNames = ["", "1st", "2nd", "3rd", "4th"];
        const downStr = downNames[down] || down;

        pushGameLog(gameLog, `📋 ${downStr} Down | Play Call | OFF: ${finalOffensivePlayKey} | DEF: ${defensivePlayKey}`);
    }

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
        offenseScore: offenseScore,
        defenseScore: defenseScore,
        quarter: quarter,
        lineOfScrimmage: ballOn + 10,
        playsRemaining: playsRemaining,
        activePlayers: [],
        blockBattles: [],
        resolvedDepth: null
    };

    // Reset per-play captain flavor flags so a single team message only appears once per play
    if (offense) offense._captainFlavorLogged = false;
    if (defense) defense._captainFlavorLogged = false;
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

    // A. BLITZ PICKUP (IQ Scaling)
    // If defenders in box > blockers, keep RB in to block
    const defendersInBox = defenseStates.filter(d =>
        Math.abs(d.y - playState.lineOfScrimmage) < 5.0 &&
        Math.abs(d.x - 26.6) < 10 // Tackle Box
    ).length;

    const blockers = offenseStates.filter(p => p.action === 'pass_block' || p.action === 'run_block').length;

    // 💡 FIX: Make blitz pickup scale naturally. An average QB (IQ 50) has a 70% chance to see it. 
    // An elite QB (IQ 80+) has a 100% chance.
    if (defendersInBox > blockers) {
        const pickupChance = qbIQ + 20;
        if (Math.random() * 100 < pickupChance) {
            const rb = offenseStates.find(p => p.slot.startsWith('RB') && p.action.includes('route'));
            if (rb) {
                if (!rb.keptForBlock) {
                    if (gameLog) pushGameLog(gameLog, `🧠 ${qbState.name} identifies blitz! Keeps RB in to block.`, playState);
                    rb.keptForBlock = true;
                }
                rb.action = 'pass_block';
                rb.assignment = 'pass_block';
                rb.targetX = rb.x + 0.5; // Visual shift
            }
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
                    pushGameLog(gameLog, `🧠 ${qbState.name} checks ${wr.name} to a Go route vs Press!`, playState);
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

        // --- PERFORMANCE MAPPING (Do this once BEFORE the loop) ---
        const activeOffense = playState.activePlayers.filter(p => p.isOffense);
        const activeDefense = playState.activePlayers.filter(p => !p.isOffense);

        const offenseTeam = activeOffense;
        const defenseTeam = activeDefense;
        const offenseStates = activeOffense;
        const defenseStates = activeDefense;

        // Map specific players for quick access
        const qb1 = playState.activePlayers.find(p => p.slot === 'QB1');
        const rb1 = playState.activePlayers.find(p => p.slot === 'RB1');
        const qbState = qb1; // Alias for updateQBDecision compatibility

        while (playState.playIsLive && playState.tick < playState.maxTicks) {
            if (!playState.playIsLive) break;
            playState.tick++;

            const ballPos = playState.ballState;

            // A. FIND CARRIER & CACHE DISTANCES
            // We look for carrier once. If found, we update distances for the whole defense.
            ballCarrierState = playState.activePlayers.find(p => p.hasBall || p.isBallCarrier) || null;

            if (ballCarrierState) {
                // 💡 FIX: Update distance to carrier for ALL players not on the carrier's team.
                // This fixes the bug where the punting team (offense) teleport-tackled punt returners 
                // because their _distToCarrier was left undefined!
                for (let i = 0; i < playState.activePlayers.length; i++) {
                    const p = playState.activePlayers[i];
                    if (p.isOffense !== ballCarrierState.isOffense) {
                        const dx = p.x - ballCarrierState.x;
                        const dy = p.y - ballCarrierState.y;
                        p._distToCarrier = Math.sqrt(dx * dx + dy * dy);
                    }
                }
            }

            // B. DECISION MAKING
            if (playState.playIsLive && !ballPos.inAir && !ballPos.isLoose && !playState.turnover && !playState.sack) {
                if (loopType === 'pass' && typeof updateQBDecision === 'function') {
                    // Use our pre-filtered offenseTeam and defenseTeam
                    updateQBDecision(qbState, offenseTeam, defenseTeam, playState, playState.assignments, gameLog);
                } else if (loopType === 'punt' && typeof updatePunterDecision === 'function') {
                    updatePunterDecision(playState, offenseTeam, gameLog);
                }
            }

            if (!playState.playIsLive) break;

            // C. HANDOFF LOGIC (Optimized with pre-mapped qb1/rb1)

            if (playState.handoffRequired && !playState.handoffOccurred) {
                if (qb1 && rb1) {

                    const qbDepth = playState.lineOfScrimmage - qb1.initialY;

                    // 💡 FIX: Create distinct target points for QB and RB to prevent them crashing head-on
                    const handoffSide = rb1.initialX > qb1.initialX ? 1 : -1;
                    const qbMeshX = qb1.initialX + (handoffSide * 1.0);
                    const rbMeshX = qb1.initialX + (handoffSide * 1.6); // RB runs slightly wider

                    const meshY = qbDepth < 4.0 ? (playState.lineOfScrimmage - 4.5) : (qb1.initialY + 1.0);

                    const handoffTickThreshold = qbDepth < 4.0 ? 18 : 24;

                    if (playState.tick < handoffTickThreshold) {
                        qb1.targetX = qbMeshX;
                        qb1.targetY = meshY;
                        qb1.action = 'handoff_setup';

                        rb1.targetX = rbMeshX;
                        // 💡 FIX: RB targets slightly upfield from the mesh so they have forward momentum, 
                        // but we use 'handoff_receive' so they brake and gather instead of overshooting at 22mph.
                        rb1.targetY = meshY + 1.5;
                        rb1.action = 'handoff_receive';
                        rb1.contactReduction = 0.85;
                    } else {
                        const dist = getDistance(qb1, rb1);

                        // 💡 FIX: Expanded distance threshold to 2.5 yards. Since they are reaching out their arms, 
                        // they don't need to occupy the exact same pixel. Also force handoff if time expires.
                        if (dist < 2.5 || playState.tick >= (handoffTickThreshold + 6)) {
                            qb1.hasBall = false;
                            qb1.isBallCarrier = false;
                            rb1.hasBall = true;
                            rb1.isBallCarrier = true;
                            playState.handoffOccurred = true;

                            const fakeDir = (rb1.initialX > qb1.initialX) ? -1 : 1;
                            qb1.targetX = qb1.initialX + (fakeDir * 5);
                            qb1.targetY = qb1.y - 1;
                            qb1.action = 'run_fake';

                            // 💡 FIX: Immediately transition RB to runner so target AI takes over
                            rb1.action = 'run_path';
                            rb1.contactReduction = 1.0;

                            if (gameLog) pushGameLog(gameLog, `[Tick ${playState.tick}] 🏈 Handoff mesh complete to ${rb1.name}`, playState);
                        } else {
                            // 💡 FIX: If the threshold passed but they aren't close enough yet, force the RB to 
                            // converge directly on the QB to finish the handoff instead of orbiting.
                            rb1.targetX = qb1.x;
                            rb1.targetY = qb1.y;
                            rb1.action = 'handoff_receive';
                        }
                    }
                }
            }

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
            // 💡 FIX: Keep calculating physics if it's a punt on the ground
            if (ballPos.inAir || (ballPos.isLoose && playState.type === 'punt')) {
                ballPos.prevX = ballPos.x;
                ballPos.prevY = ballPos.y;
                ballPos.prevZ = ballPos.z;

                ballPos.x += (ballPos.vx || 0) * timeDelta;
                ballPos.y += (ballPos.vy || 0) * timeDelta;
                ballPos.z += (ballPos.vz || 0) * timeDelta;
                ballPos.vz = (ballPos.vz || 0) - 9.8 * timeDelta;

                ballPos.x = Math.max(-10.0, Math.min(FIELD_WIDTH + 10.0, ballPos.x));
                ballPos.y = Math.max(-10.0, Math.min(FIELD_LENGTH + 10.0, ballPos.y));

                if (typeof handleBallArrival === 'function') {
                    handleBallArrival(playState, ballCarrierState, playResult, gameLog);
                }

                if (ballPos.z < 0) {
                    ballPos.z = 0;
                    // 💡 FIX: Only kill inAir if the bounce physics didn't pop it back up
                    if (ballPos.vz <= 0) {
                        ballPos.vz = 0;
                        if (ballPos.inAir) {
                            ballPos.inAir = false;
                            if (playState.type === 'punt') ballPos.isLoose = true; // Let it roll
                        }
                    }
                }
            } else if (ballCarrierState) {
                // Ball stuck to player
                ballPos.x = ballCarrierState.x;
                ballPos.y = ballCarrierState.y;
                ballPos.z = 0.5;

                // Clamp ball to field bounds (defensive safety to avoid tiny floating drift)
                ballPos.x = Math.max(0.5, Math.min(FIELD_WIDTH - 0.5, ballPos.x));
                ballPos.y = Math.max(0.0, Math.min(FIELD_LENGTH, ballPos.y));
            }

            // --- F. COLLISIONS ---
            if (typeof resolvePlayerCollisions === 'function') resolvePlayerCollisions(playState);

            // --- G. SCORING & BOUNDARIES ---
            if (playState.playIsLive) {
                // 💡 FIX: Ensure the engine respects players who have the ball but aren't actively "running" yet (like the QB in the pocket)
                ballCarrierState = playState.activePlayers.find(p => p.hasBall || p.isBallCarrier);

                if (ballCarrierState) {
                    // 1. OFFENSIVE TOUCHDOWN
                    if (ballCarrierState.isOffense && ballCarrierState.y >= 110.0) {
                        playState.touchdown = true;
                        playState.playIsLive = false;
                        ballCarrierState.y = 110.0;
                        playState.finalBallY = 110.0;
                        if (gameLog) gameLog.push(`🎉 TOUCHDOWN ${ballCarrierState.name}!`);

                        // FIX: Log Touchdown Stats
                        playState.statEvents.push({ type: 'touchdown', playerId: ballCarrierState.id });
                        if (playState.type === 'pass' && !playState.fumbleOccurred) {
                            playState.statEvents.push({ type: 'pass_td', qbId: playState.ballState.throwerId });
                        }
                        break;
                    }
                    // 2. DEFENSIVE TOUCHDOWN
                    if (!ballCarrierState.isOffense && ballCarrierState.y <= 10.0) {
                        playState.touchdown = true;
                        playState.defensiveTD = true;
                        playState.playIsLive = false;
                        playState.possessionChanged = true;
                        playState.finalBallY = 10.0;
                        playState.ballState.y = 10.0;
                        if (gameLog) gameLog.push(`🎉 DEFENSIVE TOUCHDOWN!`);
                        break;
                    }

                    // 3. SAFETY
                    if (ballCarrierState.isOffense && ballCarrierState.y <= 0) {
                        playState.safety = true;
                        playState.playIsLive = false;
                        playState.finalBallY = 0;
                        if (gameLog) gameLog.push(`🚨 SAFETY! ${ballCarrierState.name} ran out of the endzone!`);
                        break;
                    }

                    // 4. OUT OF BOUNDS (CARRIER)
                    if (ballCarrierState.x <= 0.5 || ballCarrierState.x >= 52.8) {
                        playState.playIsLive = false;
                        playState.yards = ballCarrierState.y - playState.lineOfScrimmage;
                        playState.finalBallY = ballCarrierState.y;
                        if (gameLog) gameLog.push(`💨 ${ballCarrierState.name} steps out of bounds.`);

                        if (ballCarrierState.role === 'QB' && playState.yards < 0 && playState.type === 'pass') {
                            playState.sack = true;
                            if (gameLog) gameLog.push(`(Sack recorded)`);
                        }
                        break;
                    }

                    // 5. FORWARD PROGRESS STALLED
                    // 💡 FIX: Ignore QBs setting up in the pocket. Only apply stall checks to active runners.
                    if (ballCarrierState.isBallCarrier && ballCarrierState.action !== 'qb_setup') {
                        if (!playState.stallCheck) playState.stallCheck = { tick: playState.tick, y: ballCarrierState.y };

                        if (playState.tick - playState.stallCheck.tick >= 30) {
                            const dx = ballCarrierState.x - playState.stallCheck.x;
                            const dy = ballCarrierState.y - playState.stallCheck.y;
                            const totalDistMoved = Math.sqrt(dx * dx + dy * dy);

                            // If they haven't moved a total of 1.5 yards in ANY direction in 1.5s, blow the whistle.
                            if (totalDistMoved < 1.5) {
                                playState.playIsLive = false;
                                playState.yards = ballCarrierState.y - playState.lineOfScrimmage;
                                playState.finalBallY = ballCarrierState.y;
                                if (gameLog) gameLog.push(`[Tick ${playState.tick}] ⏱️ Forward progress stopped. Play blown dead.`);
                                break;
                            }
                            playState.stallCheck = { tick: playState.tick, y: ballCarrierState.y };
                        }
                    } else {
                        // Clear the check if the QB is just standing legally in the pocket
                        playState.stallCheck = null;
                    }
                }

                // 💡 FIX: This MUST be outside the "if (ballCarrierState)" block 
                // so it runs while the ball is rolling around with NO carrier.
                const ball = playState.ballState;
                const isBallOutOfBounds = ball.x <= 0 || ball.x >= FIELD_WIDTH || ball.y <= 0 || ball.y >= FIELD_LENGTH;

                // 💡 FIX: Instant Out of Bounds Whistle for fumbles AND punts
                if (isBallOutOfBounds && (ball.isLoose || (playState.type === 'punt' && !ballCarrierState))) {
                    playState.playIsLive = false;

                    const wentOutSideline = ball.x <= 0 || ball.x >= FIELD_WIDTH;

                    // 💡 FIX: A punt is ONLY a touchback if it crosses the BACK of the endzone (y > 120)
                    // or if it lands IN the endzone and is downed. 
                    // If it crosses the SIDELINE, it's spotted where it crossed, even if y > 110.
                    if (wentOutSideline) {
                        playState.finalBallY = ball.y;
                    } else {
                        // Crosses back of endzone
                        playState.finalBallY = 110; // Touchback
                        playState.touchback = true;
                    }

                    if (playState.type === 'punt') {
                        playState.possessionChanged = true;
                        const logMsg = playState.touchback ? "Touchback!" : `Punt out of bounds at the ${Math.round(playState.finalBallY)} yard line.`;
                        if (gameLog) gameLog.push(`[Tick ${playState.tick}] 🟠 ${logMsg}`);
                    } else {
                        if (gameLog) gameLog.push(`[Tick ${playState.tick}] 🟠 Ball fumbled out of bounds at the ${Math.round(playState.finalBallY)} yard line.`);
                    }
                    break;
                }

                if (ball.isLoose) {
                    // 💡 FIX: The Pile-Up Whistle. If ball is loose for > 50 ticks (2.5s), blow it dead.
                    if (!playState.looseBallTimer) playState.looseBallTimer = playState.tick;
                    if (playState.tick - playState.looseBallTimer > 50) {
                        playState.playIsLive = false;
                        playState.finalBallY = Math.max(0, Math.min(110, ball.y));
                        if (gameLog) gameLog.push(`[Tick ${playState.tick}] ⏱️ Whistle blown. Ball recovered in the pile.`);
                        break;
                    }
                }
            }

            if (playState.playIsLive) {

                if (typeof checkBlockCollisions === 'function') checkBlockCollisions(playState);
                if (typeof resolveOngoingBlocks === 'function') resolveOngoingBlocks(playState, gameLog, offenseStates, defenseStates);

                if (ballCarrierState) {
                    if (typeof checkTackleCollisions === 'function' && checkTackleCollisions(playState, gameLog)) {
                        playState.finalBallY = ballCarrierState.y;
                        playState.yards = ballCarrierState.y - playState.lineOfScrimmage;
                        playState.playIsLive = false;
                        break;
                    }
                }

                if (playState.ballState?.isLoose) {
                    if (typeof checkFumbleRecovery === 'function') {
                        // 💡 FIX: Increased recovery range to 3.0 so a player in the pile 
                        // can actually grab it before being pushed away.
                        const recovery = checkFumbleRecovery(playState, gameLog, 3.0);
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

            // --- I. UPDATE FATIGUE (Optimized) ---
            playState.activePlayers.forEach(p => {
                let drain = (p.action.includes('run') || p.action.includes('rush') || p.action === 'pursuit' || p.action.includes('route') || p.action.includes('scramble')) ? 0.05 : 0.02;
                const player = playerCache.get(p.id);
                if (player) {
                    player.fatigue = Math.min(100, (player.fatigue || 0) + drain);
                    const stamina = player.attributes?.physical?.stamina || 50;
                    const fatigueRatio = player.fatigue / Math.max(1, stamina);
                    // 💡 FIX: Make fatigue impact performance more noticeably
                    p.fatigueModifier = Math.max(0.70, 1.0 - (fatigueRatio * 0.30));
                }
            });


            // --- J. VISUALIZER RECORDING ---
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

        // ===========================================================
        // --- 7.5 POST-PLAY "COOL DOWN" (Visuals Only) ---
        // ===========================================================
        // 💡 NEW: Let the ball bounce/roll after the whistle so it doesn't vanish in mid-air.
        if (isLive && gameLog && (playState.incomplete || playState.ballState.isLoose || playState.type === 'punt')) {
            let cooldownTicks = 0;
            const POST_PLAY_TICKS = 30; // 1.5 seconds

            while (cooldownTicks < POST_PLAY_TICKS) {
                cooldownTicks++;
                const ballPos = playState.ballState;
                const timeDelta = 0.05;

                // Stop if ball is still
                if (!ballPos.inAir && ballPos.z <= 0.1 && Math.abs(ballPos.vx) < 0.5 && Math.abs(ballPos.vy) < 0.5) {
                    if (cooldownTicks > 5) break;
                }

                // Move Ball
                ballPos.x += ballPos.vx * timeDelta;
                ballPos.y += ballPos.vy * timeDelta;
                ballPos.z += ballPos.vz * timeDelta;
                if (ballPos.z > 0) ballPos.vz -= 9.8 * timeDelta; // Gravity

                // Bounce
                if (ballPos.z <= 0) {
                    ballPos.z = 0;
                    ballPos.vz *= -0.6;
                    ballPos.vx *= 0.8;
                    ballPos.vy *= 0.8;
                }

                // Record Frame
                playState.visualizationFrames.push({
                    players: deepClone(playState.activePlayers),
                    ball: deepClone(playState.ballState),
                    logIndex: gameLog.length,
                    lineOfScrimmage: playState.lineOfScrimmage,
                    firstDownY: firstDownY
                });
            }
        }
        // --- K. BENCH RECOVERY ---
        // Players on the bench recover energy between plays
        const activeIds = new Set(playState.activePlayers.map(p => p.id));
        const allRoster = [...getRosterObjects(offense), ...getRosterObjects(defense)];
        allRoster.forEach(p => {
            if (p && !activeIds.has(p.id)) {
                const stamina = p.attributes?.physical?.stamina || 50;
                const recovery = 5 + (stamina / 10); // Recovers 10 to 15 fatigue per play
                p.fatigue = Math.max(0, (p.fatigue || 0) - recovery);
            }
        });

    } catch (e) {
        console.error(`Simulation Loop Crash on tick ${playState.tick}:`, e);
        if (gameLog) gameLog.push(`🚨[Tick ${playState.tick}] CRASH: ${e.message}`);
    } 

    // ===========================================================
    // --- 8. POST-PLAY CALCULATION (Final Results) ---
    // ===========================================================

    // Calculate Return Yards 
    // Calculate Return Yards 
    if (playState.returnStartY !== null && ballCarrierState) {
        const returnYards = Math.abs(ballCarrierState.y - playState.returnStartY);
        if (returnYards > 0) {
            playState.statEvents.push({ type: 'return', playerId: ballCarrierState.id, yards: returnYards });
        }
    }

    // FIX: Calculate Rushing Stats
    if (ballCarrierState && ballCarrierState.isOffense && !playState.returnStartY && !playState.fumbleOccurred) {
        const isRun = playState.type === 'run' || (playState.type === 'pass' && ballCarrierState.role === 'QB');
        // Don't count it as a rush if they caught a pass
        const caughtPassThisPlay = playState.statEvents.some(e => e.type === 'completion' && e.receiverId === ballCarrierState.id);

        if (isRun && !caughtPassThisPlay) {
            const rushYards = ballCarrierState.y - playState.lineOfScrimmage;
            playState.statEvents.push({ type: 'rush', runnerId: ballCarrierState.id, yards: rushYards });
        }
    }

    // End of Play Cleanup / Incomplete Logic
    if (playState.playIsLive && !playState.touchdown && !playState.safety) {
        // 💡 FIX: Sync the end-of-play logic to match the live physics
        ballCarrierState = playState.activePlayers.find(p => p.hasBall || p.isBallCarrier);
        if (ballCarrierState) {
            playState.yards = ballCarrierState.y - playState.lineOfScrimmage;
            playState.finalBallY = ballCarrierState.y;

            if (gameLog) {
                const finalX = ballCarrierState.x.toFixed(1);
                const finalY = ballCarrierState.y.toFixed(1);
                gameLog.push(`[Tick ${playState.tick}] ⏱️ WHISTLE: Play ends at (${finalX}, ${finalY}) | Total Play Yardage: ${playState.yards.toFixed(1)}y`);
            }
        }
        // 💡 FIX: Only mark incomplete if a fumble didn't occur
        else if (!playState.sack && !playState.turnover && !playState.fumbleOccurred) {
            playState.incomplete = true;
            playState.yards = 0;
            // 💡 FIX: Incomplete passes MUST return to the line of scrimmage
            playState.finalBallY = playState.lineOfScrimmage;
            if (gameLog) gameLog.push(`[Tick ${playState.tick}] ⏱️ Play ends, incomplete.`);
        }
    }

    // 💡 ROBUST TURNOVER ON DOWNS CHECK
    if (down === 4 && !playState.touchdown && !playState.possessionChanged && !playState.safety && playState.type !== 'punt') {
        if (playState.yards < yardsToGo) {
            playState.possessionChanged = true;
            playResult.turnoverType = 'downs';
            if (gameLog) gameLog.push("🛑 Turnover on Downs!");
        }
    }

    // Normalize Final Ball Position (Clamp to Field)
    playState.finalBallY = Math.max(0, Math.min(110, playState.finalBallY));

    // --- Build Result Object ---
    playResult.yards = Math.round(playState.yards);
    if (playState.sack) playResult.yards = Math.min(0, playResult.yards);

    if (playState.incomplete) {
        playResult.outcome = 'incomplete';
        playResult.yards = 0;
        // 💡 Double guarantee the ball placement for downs turnover math
        playState.finalBallY = playState.lineOfScrimmage;
    }
    else if (playState.touchdown) {
        playResult.outcome = 'complete';
        playResult.score = 'TD';
        playResult.defensiveTD = playState.defensiveTD || false; // 💡 FIX: Attach flag to result
    }
    else if (playState.safety) {
        playResult.safety = true;
        playResult.score = 'SAFETY';
    }

    // Possession Change Handling
    if (playState.possessionChanged || playState.turnover || playState.type === 'punt') {
        playResult.outcome = 'turnover';
        playResult.possessionChange = true;

        const endCarrier = playState.activePlayers.find(p => p.isBallCarrier);
        const offenseTeamId = playState.activePlayers.find(p => p.isOffense)?.teamId;

        // 💡 FIX: Prioritize specific types
        if (playState.interceptionOccurred) playResult.turnoverType = 'interception';
        if (playState.fumbleOccurred) {
            // It's only a possession change if the defense recovered it
            if (endCarrier && endCarrier.teamId !== offenseTeamId) {
                playResult.turnoverType = 'fumble';
            } else {
                // Offense recovered their own fumble
                playResult.possessionChange = false;
                playResult.outcome = 'complete';
            }
        }
        else if (playState.type === 'punt') playResult.turnoverType = 'punt';
        else if (!playResult.turnoverType && down === 4) playResult.turnoverType = 'downs';
    }

    // Apply Stats
    applyStatEvents(playState.statEvents);

    // Ensure no player ended beyond the field bounds (prevents post-play roaming off-field visuals)
    playState.activePlayers.forEach(p => {
        p.x = Math.max(0.5, Math.min(FIELD_WIDTH - 0.5, p.x));
        p.y = Math.max(0.0, Math.min(FIELD_LENGTH, p.y));
    });

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
            case 'pass_td': {
                const qb = getPlayer(evt.qbId);
                if (qb) {
                    ensureStats(qb);
                    qb.gameStats.touchdowns++;
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

    // 2. In opponent's territory? Go for it (or kick a FG if you add them later).
    if (ballOn >= 60) return false;

    // 3. 4th and very short past your own 40? AI might risk it.
    if (yardsToGo <= 2 && ballOn > 40) return false;

    // 4. Backed up in own territory or 4th and long? Punt it.
    return true;
}

/**
 * Determines the offensive play call based on game situation, personnel, and matchups.
 */
// game.js

function determinePlayCall(offense, defense, down, yardsToGo, ballOn, scoreDiff, gameLog, drivesRemaining) {
    if (!offense || !offense.formations) return 'Balanced_InsideZone';

    const formationName = offense.formations.offense;
    const coach = offense.coach;
    const recentPlays = offense.recentPlayHistory || [];

    // 1. Get ALL valid plays for this specific formation
    const formationPlays = Object.keys(offensivePlaybook).filter(key => key.startsWith(formationName));

    if (formationPlays.length === 0) {
        console.warn(`AI Alert: Formation ${formationName} has no plays! Reverting to Balanced.`);
        return 'Balanced_InsideZone';
    }

    // 2. Calculate "Pass Intent" Score (0 to 100)
    let passScore = 50; // Start at 50/50

    // Situation Adjustments
    if (down === 1) passScore = 45;
    if (down === 2 && yardsToGo > 7) passScore = 70;
    if (down === 2 && yardsToGo < 3) passScore = 30;
    if (down === 3 && yardsToGo > 5) passScore = 85;
    if (down === 3 && yardsToGo <= 2) passScore = 20;

    // Coach Personality
    if (coach?.type === 'Air Raid') passScore += 25;
    if (coach?.type === 'Ground and Pound') passScore -= 25;
    if (coach?.type === 'West Coast Offense') passScore += 10;

    // Game Context (Trailing late? Pass more. Winning late? Run more.)
    if (drivesRemaining < 4) {
        if (scoreDiff < 0) passScore += 20;
        if (scoreDiff > 8) passScore -= 30;
    }

    const desiredType = (Math.random() * 100 < passScore) ? 'pass' : 'run';

    // 3. HIERARCHICAL SELECTION (The "Never-Default" System)

    // Attempt A: Correct Type AND Not Recently Played
    let selectionPool = formationPlays.filter(key =>
        offensivePlaybook[key].type === desiredType && !recentPlays.includes(key)
    );

    // Attempt B: Correct Type (Allow repeats if formation is small)
    if (selectionPool.length === 0) {
        selectionPool = formationPlays.filter(key => offensivePlaybook[key].type === desiredType);
    }

    // Attempt C: Opposite Type but Not Recently Played
    if (selectionPool.length === 0) {
        selectionPool = formationPlays.filter(key => !recentPlays.includes(key));
    }

    // Attempt D: Any play in the formation (Absolute last resort before global default)
    if (selectionPool.length === 0) {
        selectionPool = formationPlays;
    }

    const selectedKey = getRandom(selectionPool) || 'Balanced_InsideZone';

    // 4. Update History
    if (!offense.recentPlayHistory) offense.recentPlayHistory = [];
    offense.recentPlayHistory.push(selectedKey);
    if (offense.recentPlayHistory.length > 3) offense.recentPlayHistory.shift();

    return selectedKey;
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
    let coachPref = defense.coach?.preferredDefense || null;
    if (!coachPref || !defenseFormations[coachPref]) coachPref = null; // ensure validity

    const defEntries = Object.entries(defenseFormations);

    const pickMax = (scoreFn) => {
        let best = null; let bestScore = -Infinity;
        for (const [key, val] of defEntries) {
            const score = scoreFn(val);
            if (score > bestScore) { bestScore = score; best = key; }
        }
        return best;
    };

    // --- SCENARIO A: CAPTAIN IS SHARP (Smart Counters) ---
    if (captainIsSharp) {

        // 1. Situational Overrides
        if (yardsToGo <= 2) {
            // Goal line / short yardage -> prefer heavy front (max DL + LB)
            return pickMax(v => (v.personnel?.DL || 0) + (v.personnel?.LB || 0)) || coachPref || Object.keys(defenseFormations)[0];
        }

        if ((down === 3 && yardsToGo > 8) || (down === 4 && yardsToGo > 5)) {
            // Passing down -> prefer more DBs
            const candidate = pickMax(v => (v.personnel?.DB || 0));
            return candidate || coachPref || Object.keys(defenseFormations)[0];
        }

        // 4. Personnel Matching
        if (wrCount >= 4) {
            // Heavy passing -> prefer formation with DB >= 4 if available, else max DB
            const d4 = defEntries.find(([k, v]) => (v.personnel?.DB || 0) >= 4);
            return (d4 && d4[0]) || pickMax(v => (v.personnel?.DB || 0)) || coachPref || Object.keys(defenseFormations)[0];
        }

        if (wrCount === 3) {
            // Spread -> prefer formation with DB >=3 or a high DB count
            const d3 = defEntries.find(([k, v]) => (v.personnel?.DB || 0) >= 3);
            if (d3) return d3[0];
            return pickMax(v => (v.personnel?.DB || 0)) || coachPref || Object.keys(defenseFormations)[0];
        }

        // 💡 FIX: Require 3 "Heavy" players (e.g., 2 TE + 1 RB) OR specifically 2 RBs to trigger a heavy front.
        // 1 RB + 1 TE is standard balanced offense.
        if (heavyCount >= 3 || personnel.RB >= 2) {
            // POWER (2 RBs) -> Heavy Front
            const heavy = pickMax(v => (v.personnel?.DL || 0) + (v.personnel?.LB || 0));
            return heavy || coachPref || Object.keys(defenseFormations)[0];
        }

        // Standard -> Coach's Base (if valid) else pick a balanced default
        if (coachPref) return coachPref;
        return pickMax(v => -Math.abs((v.personnel?.WR || 0) - wrCount)) || Object.keys(defenseFormations)[0];
    }

    // --- SCENARIO B: CAPTAIN IS CONFUSED (Mistakes) ---
    else {
        // Flavor text is handled inside checkCaptainDiscipline, 
        // but the consequence happens here.

        // 50% chance they just stick to the "Base Defense" regardless of situation
        if (Math.random() < 0.5) {
            // Stick to the team's current base defense if valid, else fall back to a reasonable default
            return (defense.formations?.defense && defenseFormations[defense.formations.defense]) ? defense.formations.defense : (coachPref || Object.keys(defenseFormations)[0]);
        }

        // 50% chance they guess randomly (Bad!) - pick a random available formation key
        // FIX: Exclude Punt Return from the random "Confused" pool so it isn't picked on normal downs
        const validFormations = Object.keys(defenseFormations).filter(key => key !== 'Punt_Return');
        return getRandom(validFormations);
    }
}

/**
 * Determines the defensive play call based on formation, situation, and basic tendencies.
 */
function determineDefensivePlayCall(defense, offense, down, yardsToGo, ballOn, scoreDiff, gameLog, drivesRemaining) {
    const defenseFormationName = defense.formations.defense;
    // Helper: Match a formation against a set of minimum personnel criteria
    const formationMatchesCriteria = (form, criteria) => {
        if (!form || !criteria) return false;
        const p = form.personnel || {};
        const front = (p.DL || 0) + (p.LB || 0);
        if (criteria.minDL && (p.DL || 0) < criteria.minDL) return false;
        if (criteria.minLB && (p.LB || 0) < criteria.minLB) return false;
        if (criteria.minDB && (p.DB || 0) < criteria.minDB) return false;
        if (criteria.minWR && (p.WR || 0) < criteria.minWR) return false;
        if (criteria.minFront && front < criteria.minFront) return false;
        return true;
    };

    const isPlayCompatibleWithDefense = (play, formationName) => {
        if (!play) return false;
        // 1) Legacy explicit list
        if (Array.isArray(play.compatibleFormations) && play.compatibleFormations.includes(formationName)) return true;
        // 2) Criteria-based compatibility
        if (play.compatibleCriteria) {
            const form = defenseFormations[formationName];
            if (formationMatchesCriteria(form, play.compatibleCriteria)) return true;
        }
        // 3) If neither field is present, treat as generic (available everywhere)
        if (!play.hasOwnProperty('compatibleFormations') && !play.hasOwnProperty('compatibleCriteria')) return true;
        return false;
    };

    const availablePlays = Object.keys(defensivePlaybook).filter(key => isPlayCompatibleWithDefense(defensivePlaybook[key], defenseFormationName));

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

    let possiblePlays = Object.keys(offensivePlaybook).filter(key =>
        key.startsWith(offenseFormationName) &&
        offensivePlaybook[key]?.type === desiredType
    );

    // --- 🔧 HIGH FIX: Enhanced fallback logic for edge cases ---
    if (possiblePlays.length === 0) {
        // Formation has no plays of desired type - try any play in formation
        possiblePlays = Object.keys(offensivePlaybook).filter(key =>
            key.startsWith(offenseFormationName)
        );

        // If formation has no plays at all, try Balanced formation as emergency
        if (possiblePlays.length === 0) {
            console.warn(`⚠️ Formation "${offenseFormationName}" has no plays defined. Falling back to Balanced formation.`);
            possiblePlays = Object.keys(offensivePlaybook).filter(key =>
                key.startsWith('Balanced')
            );
        }

        // Last resort: return ANY available play
        if (possiblePlays.length === 0) {
            const allPlays = Object.keys(offensivePlaybook);
            if (allPlays.length > 0) {
                console.warn(`⚠️ No plays found for formation "${offenseFormationName}". Using random play from playbook.`);
                return getRandom(allPlays);
            }
            return null; // Truly no valid plays exist (shouldn't happen in a complete game)
        }
    }

    // Try to find plays with desired tag
    if (desiredTag) {
        const taggedPlays = possiblePlays.filter(key =>
            offensivePlaybook[key]?.tags?.includes(desiredTag)
        );
        if (taggedPlays.length > 0) return getRandom(taggedPlays);
    }

    // Fallback to any play from the possible list
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
            } else {
                // 🔧 HIGH FIX: No pass plays available - try any play as fallback
                const fallbackPlay = findAudiblePlay(offense, null);  // Any play
                if (fallbackPlay) {
                    newPlayKey = fallbackPlay;
                    didAudible = true;
                    if (gameLog) gameLog.push(`[Audible]: ${qb.name} can't find pass option, adjusting to available play.`);
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
                    // 💡 FIX: Ensure the play we found is ACTUALLY a run before printing the log
                    // (Empty formations don't have run plays, for example)
                    const isActuallyRun = offensivePlaybook[audibleTo]?.type === 'run';
                    if (isActuallyRun) {
                        gameLog.push(`[Audible]: 🧠 ${qb.name} sees soft zone and audibles to run!`);
                    } else {
                        gameLog.push(`[Audible]: 🧠 ${qb.name} changes the play at the line!`);
                    }
                }
            } else {
                // 🔧 HIGH FIX: No run plays available - stick with pass or find any play
                const fallbackPlay = findAudiblePlay(offense, 'pass') || findAudiblePlay(offense, null);
                if (fallbackPlay && fallbackPlay !== offensivePlayKey) {
                    newPlayKey = fallbackPlay;
                    didAudible = true;
                    if (gameLog) gameLog.push(`[Audible]: ${qb.name} can't find run option, adjusting pass play.`);
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
            } else {
                // 🔧 HIGH FIX: No short pass available - try any pass play
                const anyPassPlay = findAudiblePlay(offense, 'pass');
                if (anyPassPlay && anyPassPlay !== offensivePlayKey) {
                    newPlayKey = anyPassPlay;
                    didAudible = true;
                    if (gameLog) gameLog.push(`[Audible]: ${qb.name} adjusts to available pass option.`);
                }
            }
        }
    }

    return { playKey: newPlayKey, didAudible };
}

/**
 * SIMULATES EXACTLY ONE PLAY STEP (For Live Game View)
 * This replaces 'simulateGame' when watching the game.
 */
function simulateLivePlayStep(game) {
    // --- 1. SAFETY CHECKS ---
    if (!game || !game.possession || !game.homeTeam || !game.awayTeam) {
        console.error("simulateLivePlayStep: Critical Error - Invalid game state.", game);
        return { playResult: { outcome: 'error' }, finalBallY: 35, log: [], visualizationFrames: [] };
    }

    const offense = game.possession;
    const defense = (offense.id === game.homeTeam.id) ? game.awayTeam : game.homeTeam;

    if (!offense.formations) offense.formations = { offense: 'Balanced', defense: '3-1-3' };
    if (!defense.formations) defense.formations = { offense: 'Balanced', defense: '3-1-3' };

    // --- 2. DETERMINE PLAY CALLS ---
    let offPlayKey = '';
    let defPlayKey = '';

    if (game.isConversionAttempt) {
        game.down = 1;
        game.yardsToGo = 3;
        game.ballOn = 97;

        // 💡 FIX: Force the formations to match the special situation
        offense.formations.offense = 'Balanced';
        defense.formations.defense = '4-2-2';

        offPlayKey = 'Balanced_Slants';
        defPlayKey = 'GoalLine_RunStuff';
    }
    else if (determinePuntDecision(game.down, game.yardsToGo, game.ballOn)) {
        // 💡 FIX: Explicitly set the formations so the physics engine 
        // uses the correct coordinates from data.js
        offense.formations.offense = 'Punt';
        defense.formations.defense = 'Punt_Return';

        offPlayKey = 'Punt_Punt';
        defPlayKey = 'PuntReturn_Classic';
    }
    else {
        const scoreDiff = (offense.id === game.homeTeam.id) ? (game.homeScore - game.awayScore) : (game.awayScore - game.homeScore);
        const drivesRemaining = 10;

        // Force formation reset if coming off a Punt or Conversion
        if (offense.formations.offense === 'Punt' || game.isConversionAttempt === false) {
            // Reset to coach preference or default
            offense.formations.offense = offense.coach?.preferredOffense || 'Balanced';
        }

        offPlayKey = determinePlayCall(offense, defense, game.down, game.yardsToGo, game.ballOn, scoreDiff, game.gameLog, drivesRemaining);

        // Final fallback safety
        if (!offPlayKey || !offensivePlaybook[offPlayKey]) offPlayKey = 'Balanced_InsideZone';

        // Update the team's current formation to match the play they just called
        const selectedFormation = offensivePlaybook[offPlayKey].formation || offPlayKey.split('_')[0];
        offense.formations.offense = selectedFormation;

        const defFormation = determineDefensiveFormation(defense, offense.formations.offense, game.down, game.yardsToGo, game.gameLog);
        defense.formations.defense = defFormation;

        defPlayKey = determineDefensivePlayCall(defense, offense, game.down, game.yardsToGo, game.ballOn, scoreDiff, game.gameLog, drivesRemaining);

    }

    const context = {
        gameLog: game.gameLog,
        weather: game.weather || 'Sunny',
        ballOn: game.ballOn,
        ballHash: game.ballHash || 'M',
        down: game.down,
        yardsToGo: game.yardsToGo,
        offenseScore: (offense.id === game.homeTeam.id) ? (game.homeScore || 0) : (game.awayScore || 0),
        defenseScore: (offense.id === game.homeTeam.id) ? (game.awayScore || 0) : (game.homeScore || 0),
        playsRemaining: 60 - (game.playsTotal || 0),
        quarter: game.quarter || 1
    };

    // --- 3. AUTO SUBSTITUTIONS ---
    // The coaching AI handles resting tired players dynamically
    autoMakeSubstitutions(offense, { thresholdFatigue: 65, chance: 1.0 }, game.gameLog);
    autoMakeSubstitutions(defense, { thresholdFatigue: 65, chance: 1.0 }, game.gameLog);

    // --- 4. EXECUTE THE PLAY ---
    const result = resolvePlay(offense, defense, offPlayKey, defPlayKey, context, {}, true);

    // --- 5. UPDATE GAME STATE (FIXED LOGIC) ---
    const { playResult, finalBallY } = result;

    if (game.isConversionAttempt) {
        // WE JUST FINISHED A CONVERSION ATTEMPT
        if (playResult.score === 'TD') {
            let scoringTeam = offense;
            if (playResult.defensiveTD) scoringTeam = defense;
            if (scoringTeam.id === game.homeTeam.id) game.homeScore += 2;
            else game.awayScore += 2;
            game.gameLog.push("✅ Conversion GOOD!");
        } else {
            game.gameLog.push("❌ Conversion FAILED!");
        }

        // Reset state for Kickoff (Flip possession)
        game.isConversionAttempt = false;
        game.possession = defense;
        game.ballOn = 20; // Simulated touchback placement
        game.down = 1;
        game.yardsToGo = 10;
    }
    else if (playResult.score === 'TD') {
        // NORMAL TOUCHDOWN
        let scoringTeam = offense;
        if (playResult.defensiveTD) {
            scoringTeam = defense;
            game.possession = defense; // Defense now possesses ball for PAT
        }
        if (scoringTeam.id === game.homeTeam.id) game.homeScore += 6;
        else game.awayScore += 6;

        game.isConversionAttempt = true; // Trigger PAT next
    }
    else if (playResult.safety) {
        if (defense.id === game.homeTeam.id) game.homeScore += 2;
        else game.awayScore += 2;

        game.possession = defense;
        game.ballOn = 35;
        game.down = 1;
        game.yardsToGo = 10;
    }
    else if (playResult.possessionChange) {
        game.possession = defense;

        // Reset formation
        const coachPref = game.possession.coach?.preferredOffense || 'Balanced';
        game.possession.formations.offense = coachPref;
        game.possession.recentPlayHistory = [];

        // CALCULATE NEW BALL POSITION
        // finalBallY is the absolute coordinate (0-120). 
        // We need to convert it to the perspective of the new offense.
        game.ballOn = 110 - finalBallY;

        // Handle Touchbacks / Out of Bounds
        if (game.ballOn <= 0 || game.ballOn >= 100) {
            game.ballOn = 20;
            if (game.gameLog) game.gameLog.push("Touchback! Ball placed at the 20.");
        }

        game.ballOn = Math.max(1, Math.min(99, game.ballOn));
        game.down = 1;
        game.yardsToGo = 10;
    }
    else {
        game.ballOn += playResult.yards;
        game.ballOn = Math.max(1, Math.min(99, game.ballOn));
        game.yardsToGo -= playResult.yards;

        if (game.yardsToGo <= 0) {
            // First Down!
            game.down = 1;
            const distToGoal = 100 - game.ballOn;
            game.yardsToGo = (distToGoal < 10) ? distToGoal : 10;
            if (game.gameLog) game.gameLog.push("✨ First Down!");
        } else {
            // Not a first down. Was it 4th down?
            if (game.down >= 4) {
                // FORCE TURNOVER ON DOWNS
                if (game.gameLog) game.gameLog.push("🛑 Turnover on Downs!");

                // Flip Possession
                game.possession = defense;
                game.ballOn = 110 - game.ballOn; // Flip field position

                // Reset for new drive
                game.down = 1;
                game.yardsToGo = 10;
                game.possession.recentPlayHistory = [];
            } else {
                // Just move to the next down
                game.down++;
            }
        }
    }

    game.playsTotal = (game.playsTotal || 0) + 1;

    // Check if game should end
    if (game.playsTotal >= 60) {
        game.isGameOver = true;
        if (game.gameLog) game.gameLog.push("🏁 WHISTLE BLOWS! That's the end of the game!");
    }

    return result;
}


/**
 * FAST SIMULATOR (CPU vs CPU)
 * Replaces the old 'simulateGame'.
 * Used for simulating the rest of the league instantly.
 * No visualization frames, no delays. Pure stats.
 */
function simulateMatchFast(homeTeam, awayTeam) {
    // 1. Validation (Strict checks to prevent undefined errors later)
    if (!homeTeam || !awayTeam) {
        console.error("simulateMatchFast: Missing team data", { homeTeam, awayTeam });
        return null;
    }
    // Ensure roster exists
    if (!homeTeam.roster || !awayTeam.roster) {
        console.error("simulateMatchFast: Teams exist but missing rosters.");
        return null;
    }

    // 2. Reset Stats for this game
    resetGameStats(homeTeam, awayTeam);
    aiSetDepthChart(homeTeam);
    aiSetDepthChart(awayTeam);

    // 3. Initialize State
    const game = {
        homeTeam, awayTeam,
        homeScore: 0, awayScore: 0,
        possession: Math.random() < 0.5 ? homeTeam : awayTeam,
        ballOn: 35, down: 1, yardsToGo: 10,
        gameLog: [],
        drivesThisHalf: 0,
        quarter: 1,
        isConversionAttempt: false,
        isGameOver: false,
        weather: getRandom(['Sunny', 'Windy', 'Rain']),
        homeTeamPlayHistory: [],
        awayTeamPlayHistory: []
    };

    // 4. THE FAST LOOP
    const TOTAL_DRIVES_PER_HALF = getRandomInt(5, 6);
    let currentHalf = 1;

    // --- FIRST HALF ---
    while (game.drivesThisHalf < TOTAL_DRIVES_PER_HALF * 2) {
        simulateLivePlayStep(game);
        // Simple counter increment - in a real game this is time based, 
        // but for fast sim we just ensure plays happen.
        game.drivesThisHalf += 0.2;
    }

    // --- HALFTIME ---
    currentHalf = 2;
    game.drivesThisHalf = 0;
    game.quarter = 3;

    // Recovery
    [...getRosterObjects(homeTeam), ...getRosterObjects(awayTeam)].forEach(p => {
        if (p) p.fatigue = Math.max(0, (p.fatigue || 0) - 30);
    });

    // Second Half Kickoff
    game.possession = (game.possession.id === homeTeam.id) ? awayTeam : homeTeam;
    game.ballOn = 35; game.down = 1; game.yardsToGo = 10;

    // --- SECOND HALF ---
    while (game.drivesThisHalf < TOTAL_DRIVES_PER_HALF * 2) {
        simulateLivePlayStep(game);
        game.drivesThisHalf += 0.2;
    }

    // --- OVERTIME (Simple) ---
    if (game.homeScore === game.awayScore) {
        let otPossessions = 0;
        game.ballOn = 75;
        while (game.homeScore === game.awayScore && otPossessions < 6) {
            simulateLivePlayStep(game);
            otPossessions += 0.1;
        }
    }

    // 5. POST-GAME RPG LOGIC (Breakthroughs)
    const breakthroughs = [];
    const allPlayersInMatch = [...getRosterObjects(homeTeam), ...getRosterObjects(awayTeam)];

    allPlayersInMatch.forEach(p => {
        if (!p || !p.gameStats) return;

        // breakthrough check (relying on current gameStats)
        const s = p.gameStats;
        const perfThreshold = s.touchdowns >= 1 || s.passYards > 100 || s.rushYards > 50 || s.tackles > 4 || s.sacks >= 1 || s.interceptions >= 1;

        if (p.age < 14 && perfThreshold && Math.random() < 0.15) {
            const attributesToImprove = ['speed', 'strength', 'agility', 'throwingAccuracy', 'catchingHands', 'tackling', 'blocking', 'playbookIQ', 'blockShedding', 'toughness', 'consistency'];
            const attr = getRandom(attributesToImprove);

            // Check all attribute categories for the selected stat
            let updated = false;
            for (const cat in p.attributes) {
                if (p.attributes[cat] && p.attributes[cat][attr] !== undefined && p.attributes[cat][attr] < 99) {
                    p.attributes[cat][attr]++;
                    updated = true;
                    break;
                }
            }
            if (updated) {
                breakthroughs.push({ player: p, attr, teamName: p.teamId === homeTeam.id ? homeTeam.name : awayTeam.name });
            }
        }
    });

    // 6. 💡 FIX: Update Standings and Season Stats using the helper
    finalizeGameResults(homeTeam, awayTeam, game.homeScore, game.awayScore);

    return {
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        homeScore: game.homeScore,
        awayScore: game.awayScore,
        gameLog: game.gameLog,
        breakthroughs: breakthroughs
    };
} // end of simulateMatchFast


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
            const result = simulateMatchFast(match.home, match.away, options);
            if (result?.breakthroughs) {
                result.breakthroughs.forEach(b => {
                    if (b?.player?.teamId === game.playerTeam?.id && b?.player?.name) {
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
                const bestFAName = bestFA?.name || 'Unknown Player';
                console.log(`${team.name} signed temporary player ${bestFAName}`);
            }
        } else {
            const bestFAName = bestFA?.name || 'Unknown Player';
            console.log(`${team.name} failed to sign temporary player ${bestFAName}.`);
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
 * 
 * Fixed: Uses proper probability weighting where IQ dominates (70%) and Consistency is safety (30%)
 */
function checkCaptainDiscipline(team, gameLog) {
    const roster = getRosterObjects(team);
    const captain = roster.find(p => p.id === team.captainId) || roster[0]; // Fallback to first player

    if (!captain) return true; // Fail safe

    const iq = captain.attributes?.mental?.playbookIQ || 50;
    const consistency = captain.attributes?.mental?.consistency || 50;

    // --- 🔧 FIXED PROBABILITY FORMULA ---
    // IQ dominates decision-making (70% weight), Consistency is safety net (30% weight)
    // 
    // Examples:
    // - QB with IQ 99, Consistency 1: 0.007 * 0.07 = 0.49% error (good decisions, unreliable)
    // - QB with IQ 50, Consistency 50: 0.5 * 0.5 = 25% error (mediocre all around)
    // - QB with IQ 20, Consistency 20: 0.8 * 0.8 = 64% error (poor decisions and inconsistent)
    // - QB with IQ 99, Consistency 99: 0.007 * 0.007 = 0.005% error (elite)

    const iqErrorFactor = (100 - iq) / 100;       // Inverse: 99 IQ = 0.01, 50 IQ = 0.5, 20 IQ = 0.8
    const consistencyErrorFactor = (100 - consistency) / 100;  // Same scale

    // 💡 FIX: Reduced base error chance so bad captains aren't confused EVERY single play
    const mentalErrorChance = ((iqErrorFactor * 0.6) + (consistencyErrorFactor * 0.4)) * 0.5; // Cut in half
    const mentalErrorChanceClamped = Math.max(0.001, Math.min(0.35, mentalErrorChance)); // Max 35% chance to be confused

    const isSmart = Math.random() > mentalErrorChanceClamped;

    if (!isSmart && gameLog && Math.random() < 0.05 && !team._captainFlavorLogged) {
        // Flavor text for bad calls (20% of the time they fail). Only once per play.
        pushGameLog(gameLog, `⚠️ ${captain.name} looks confused and rushes the play call...`);
        team._captainFlavorLogged = true;
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
    const ROSTER_LIMIT = 12;

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
        team.wins = 0; team.losses = 0; team.ties = 0;
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

/**
 * Directly assigns a player to a specific slot on the depth chart,
 * preserving all other overrides and cleanly handling swaps.
 */
function assignPlayerToSlot(team, playerId, slot, side) {
    if (!team || !team.depthChart || !team.depthChart[side]) return false;

    if (!playerId || playerId === 'null' || playerId === '') {
        team.depthChart[side][slot] = null;
        return true;
    }

    // Check if player is already in a slot on this side
    let oldSlot = null;
    for (const s in team.depthChart[side]) {
        if (team.depthChart[side][s] === playerId) {
            oldSlot = s;
            break;
        }
    }

    const existingPlayerInNewSlot = team.depthChart[side][slot];

    if (oldSlot) {
        // Swap them
        team.depthChart[side][oldSlot] = existingPlayerInNewSlot;
    }

    team.depthChart[side][slot] = playerId;

    // Ensure player is in the correct positional depthOrder list fallback so they don't disappear
    let posKey = slot.replace(/\d+/g, '');
    if (['OT', 'OG', 'C'].includes(posKey)) posKey = 'OL';
    if (posKey === 'FB') posKey = 'RB';
    if (posKey === 'TE') posKey = 'TE';
    if (['CB', 'S', 'FS', 'SS'].includes(posKey)) posKey = 'DB';
    if (['DE', 'DT', 'NT'].includes(posKey)) posKey = 'DL';

    if (!team.depthOrder) team.depthOrder = {};
    const groupList = team.depthOrder[posKey] || [];
    if (!groupList.includes(playerId)) {
        groupList.push(playerId);
    }

    return true;
}


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

    // 1. Identify the Position Group (e.g., "WR" from "WR2")
    let posKey = slotName.replace(/\d+/g, '');

    // Normalize to your 8 canonical buckets
    if (['OT', 'OG', 'C'].includes(posKey)) posKey = 'OL';
    if (posKey === 'FB') posKey = 'RB';
    if (posKey === 'TE') posKey = 'TE'; // Keep TE separate as per our previous fix
    if (['CB', 'S', 'FS', 'SS'].includes(posKey)) posKey = 'DB';
    if (['DE', 'DT', 'NT'].includes(posKey)) posKey = 'DL';

    // 2. Update the Master List (depthOrder)
    const groupList = team.depthOrder[posKey] || [];

    // Remove the player from their current position in the priority list
    const existingIndex = groupList.indexOf(playerId);
    if (existingIndex > -1) {
        groupList.splice(existingIndex, 1);
    }

    // 💡 THE FIX: Move them to the VERY FRONT (Position #1)
    // This ensures that 'rebuildDepthChartFromOrder' will keep them as the starter
    groupList.unshift(playerId);
    team.depthOrder[posKey] = groupList;

    // 3. Sync everything
    rebuildDepthChartFromOrder(team);

    console.log(`Manual Override: Moved ${playerId} to #1 in ${posKey} rankings.`);
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
        const inPlayerName = inPlayer?.name || 'Unknown Player';
        const outPlayerName = outPlayer?.name || 'Unknown Player';
        const logMsg = `🔄 SUBSTITUTION: ${inPlayerName} and ${outPlayerName} swap positions.`;
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

    const inPlayerName = inPlayer?.name || 'Unknown Player';
    const outPlayerName = outPlayer?.name || 'Unknown Player';
    const logMsg = `🔄 SUB: ${inPlayerName} enters for ${outPlayerName}.`;
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

    const thresholdFatigue = options.thresholdFatigue || 65;
    const reEntryFatigue = 25; // Player must recover to this fatigue level to re-enter
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

                    // If bench player is more suitable (e.g., original starter recovered), swap them in!
                    if (bestRestedScore > currentSuitability) {
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
/**
 * Validates that formation slots match depth chart structure.
 * Detects and logs any mismatches that could cause gameplay issues.
 * 
 * @param {object} team - Team object to validate
 * @returns {object} {valid: boolean, issues: [string]}
 */
function validateFormationDepthChartSync(team) {
    const issues = [];

    if (!team || !team.formations || !team.depthChart) {
        return { valid: false, issues: ['Team missing formations or depthChart'] };
    }

    // Check offense
    const offFormation = team.formations.offense;
    const offFormationData = offenseFormations[offFormation];
    if (offFormationData && offFormationData.slots) {
        const expectedSlots = new Set(offFormationData.slots);
        const actualSlots = new Set(Object.keys(team.depthChart.offense || {}));

        for (const slot of expectedSlots) {
            if (!actualSlots.has(slot)) {
                issues.push(`Offense slot '${slot}' missing from depthChart`);
            }
        }

        for (const slot of actualSlots) {
            if (!expectedSlots.has(slot)) {
                issues.push(`Offense depthChart has extra slot '${slot}' not in formation`);
            }
        }
    }

    // Check defense
    const defFormation = team.formations.defense;
    const defFormationData = defenseFormations[defFormation];
    if (defFormationData && defFormationData.slots) {
        const expectedSlots = new Set(defFormationData.slots);
        const actualSlots = new Set(Object.keys(team.depthChart.defense || {}));

        for (const slot of expectedSlots) {
            if (!actualSlots.has(slot)) {
                issues.push(`Defense slot '${slot}' missing from depthChart`);
            }
        }

        for (const slot of actualSlots) {
            if (!expectedSlots.has(slot)) {
                issues.push(`Defense depthChart has extra slot '${slot}' not in formation`);
            }
        }
    }

    if (issues.length > 0) {
        console.warn(`❌ Depth Chart Sync Issues for ${team.name}:`, issues);
    }

    return { valid: issues.length === 0, issues };
}

function changeFormation(side, formationName) {
    const team = game?.playerTeam;
    if (!team) return;

    team.formations[side] = formationName;

    // Instead of resetting to null, we REBUILD from the definitive order
    rebuildDepthChartFromOrder(team);

    // 🔧 FIXED: Validate sync after changing formation
    const syncCheck = validateFormationDepthChartSync(team);
    if (!syncCheck.valid) {
        console.warn(`⚠️ Formation/depth chart sync issues detected after changing to ${formationName}`);
        // Attempt recovery: rebuild again
        rebuildDepthChartFromOrder(team);
    }
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
    const ROSTER_LIMIT = 12;

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
                game.players.forEach(p => {
                    if (p && p.id) playerMap.set(p.id, p);
                });
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

// --- Helper exports for testing & playbook checks ---
export function formationMatchesCriteria(form, criteria) {
    if (!form || !criteria) return false;
    const p = form.personnel || {};
    const front = (p.DL || 0) + (p.LB || 0);
    if (criteria.minDL && (p.DL || 0) < criteria.minDL) return false;
    if (criteria.minLB && (p.LB || 0) < criteria.minLB) return false;
    if (criteria.minDB && (p.DB || 0) < criteria.minDB) return false;
    if (criteria.minWR && (p.WR || 0) < criteria.minWR) return false;
    if (criteria.minFront && front < criteria.minFront) return false;
    return true;
}

export function isPlayCompatibleWithDefense(play, formationName) {
    if (!play) return false;
    // 1) Legacy explicit list
    if (Array.isArray(play.compatibleFormations) && play.compatibleFormations.includes(formationName)) return true;
    // 2) Criteria-based compatibility
    if (play.compatibleCriteria) {
        const form = defenseFormations[formationName];
        if (formationMatchesCriteria(form, play.compatibleCriteria)) return true;
    }
    // 3) If neither field is present, treat as generic (available everywhere)
    if (!play.hasOwnProperty('compatibleFormations') && !play.hasOwnProperty('compatibleCriteria')) return true;
    return false;
}

function getDepthChartEmptySlots(team) {
    const emptySlots = [];
    if (!team || !team.depthChart) return emptySlots;

    if (team.formations && team.depthChart.offense) {
        const offForm = offenseFormations[team.formations.offense];
        if (offForm && offForm.slots) {
            offForm.slots.forEach(slot => {
                if (!team.depthChart.offense[slot]) emptySlots.push(`Offense: ${slot}`);
            });
        }
    }

    if (team.formations && team.depthChart.defense) {
        const defForm = defenseFormations[team.formations.defense];
        if (defForm && defForm.slots) {
            defForm.slots.forEach(slot => {
                if (!team.depthChart.defense[slot]) emptySlots.push(`Defense: ${slot}`);
            });
        }
    }

    return emptySlots;
}

/**
 * Finalizes team records and player season stats after a game is completed.
 * This is called by both the Fast Sim and the Live Sim callback.
 */
export function finalizeGameResults(homeTeam, awayTeam, homeScore, awayScore) {

    const masterHome = game.teams.find(t => t.id === homeTeam.id);
    const masterAway = game.teams.find(t => t.id === awayTeam.id);

    if (!masterHome || !masterAway) return;

    // 1. Update Team Records
    if (homeScore > awayScore) {
        masterHome.wins = (masterHome.wins || 0) + 1;
        masterAway.losses = (masterAway.losses || 0) + 1;
    } else if (awayScore > homeScore) {
        masterAway.wins = (masterAway.wins || 0) + 1;
        masterHome.losses = (masterHome.losses || 0) + 1;
    } else {
        masterHome.ties = (masterHome.ties || 0) + 1;
        masterAway.ties = (masterAway.ties || 0) + 1;
    }


    // 2. Aggregate Season Stats
    // 💡 FIX: We fetch IDs and then get the object from the Global Map 
    // to ensure we are editing the Source of Truth used by the Stats Tab.
    const allPlayerIds = [...(homeTeam.roster || []), ...(awayTeam.roster || [])];

    allPlayerIds.forEach(id => {
        const p = getPlayer(id); // Use the helper to get the main reference
        if (!p || !p.gameStats) return;

        if (!p.seasonStats) p.seasonStats = {};
        if (!p.careerStats) p.careerStats = { seasonsPlayed: p.careerStats?.seasonsPlayed || 0 };

        // 💡 FIX: Explicitly migrate every possible stat field
        const statFields = [
            'passYards', 'passAttempts', 'passCompletions', 'interceptionsThrown',
            'rushYards', 'rushAttempts',
            'recYards', 'receptions', 'targets', 'drops',
            'tackles', 'sacks', 'interceptions', 'fumbles', 'fumblesLost', 'fumblesRecovered',
            'touchdowns', 'returnYards'
        ];

        statFields.forEach(field => {
            const value = p.gameStats[field] || 0;
            if (value !== 0) {
                p.seasonStats[field] = (p.seasonStats[field] || 0) + value;
                p.careerStats[field] = (p.careerStats[field] || 0) + value;
            }
        });

        // 💡 Clear per-game stats for next week
        p.gameStats = null;
    });

    console.log(`Stats migrated to season totals for ${awayTeam.name} @ ${homeTeam.name}`);
}

// =============================================================
// --- EXPORTS ---
// =============================================================

export {
    initializeLeague, createPlayerTeam, setupDraft, getGameState, saveGameState, loadGameState, getBreakthroughs,
    addPlayerToTeam, playerCut, playerSignFreeAgent, callFriend, aiManageRoster, aiSetDepthChart, updateDepthChart, changeFormation,

    // Roster Helpers
    getRosterObjects,
    getRosterObjects as getUIRosterObjects, // ALIAS for UI compatibility
    getPlayer,
    assignPlayerToSlot,

    // Simulation Logic
    simulateAIPick,
    simulateWeek,
    simulateMatchFast,    // Replaces simulateGame for CPU matches
    simulateLivePlayStep, // The new engine step function
    resolvePlay,           // Export resolvePlay for testing/play harness
    handleBallArrival,     // Exported for unit tests that target catch/drop/swats
    pushGameLog,           // Export logging helper (tests)

    // Helpers
    advanceToOffseason, generateWeeklyFreeAgents, generateSchedule,
    addMessage, markMessageAsRead, getScoutedPlayerInfo, getRelationshipLevel, calculateOverall, calculateSlotSuitability,
    substitutePlayers, autoMakeSubstitutions, aiCheckAudible, setTeamCaptain, normalizeFormationKey,


    // 🔧 NEW: Validation
    validateFormationDepthChartSync,
    getDepthChartEmptySlots
};
