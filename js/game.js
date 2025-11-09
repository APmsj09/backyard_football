// game.js - COMPLETE FILE

// --- Imports ---
import { getRandom, getRandomInt } from './utils.js'; // Removed estimateBestPosition
import {
    calculateOverall,
    calculateSlotSuitability,
    generatePlayer,
    positionOverallWeights,
    estimateBestPosition  // <<< ADD IT HERE
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
        const defenseFormationData = defenseFormations[coach.preferredDefense] || defenseFormations['3-1-3'];
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
        console.error(`aiSetDepthChart: Invalid team data for ${team?.name || 'unknown team'}.`); return;
    }
    const { roster, depthChart, formations } = team;
    if (roster.length === 0) return;

    // Initialize all slots to null
    for (const side in depthChart) {
        if (!depthChart[side]) depthChart[side] = {};
        const formationSlots = (side === 'offense' ? offenseFormations[formations.offense]?.slots : defenseFormations[formations.defense]?.slots) || [];
        const newChartSide = {};
        formationSlots.forEach(slot => newChartSide[slot] = null);
        depthChart[side] = newChartSide;
    }

    // --- 🛠️ FIX: Re-ordered the sides. Fill DEFENSE first. ---
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
function getPlayersForSlots(team, side, slotPrefix, usedPlayerIdsThisPlay, gameLog) {
    if (!team || !team.depthChart || !team.depthChart[side] || !team.roster || !Array.isArray(team.roster)) {
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
    if (!team || !team.depthChart || !team.depthChart[side] || !team.roster) {
        console.error(`getPlayerBySlot: Invalid team data for ${slot} on ${side}.`);
        return null;
    }

    // Defensive: ensure usedPlayerIdsThisPlay is a Set
    usedPlayerIdsThisPlay = ensureSet(usedPlayerIdsThisPlay);

    const sideDepthChart = team.depthChart[side];
    const starterId = sideDepthChart[slot];

    // --- STEP 1: Try to get the designated starter ---
    let player = team.roster.find(p => p && p.id === starterId);

    // Check if the starter is ineligible (injured or already used this play)
    if (player && (player.status?.duration > 0 || usedPlayerIdsThisPlay.has(player.id))) {
        player = null; // Mark the starter as unusable
    }

    // --- STEP 2: If starter is ineligible, find the BEST possible substitute ---
    if (!player) {
        const availableSubs = team.roster.filter(p =>
            p && p.status?.duration === 0 && !usedPlayerIdsThisPlay.has(p.id)
        );

        if (availableSubs.length > 0) {
            // --- 🛠️ FIX: Use smart logic, not getBestSub ---
            // Find the sub with the highest "suitability" for THIS slot
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

    // --- STEP 4: Absolute fallback (find an emergency player) ---
    // If no subs were found (e.g., everyone is used), try to grab ANYONE.
    // This calls the "dumb" getBestSub as a last resort.
    const position = slot.replace(/\d/g, '');
    const emergencySub = getBestSub(team, position, usedPlayerIdsThisPlay);
    if (emergencySub) {
        usedPlayerIdsThisPlay.add(emergencySub.id);
        return emergencySub;
    }

    return null; // No one is available
}

/** Finds *any* healthy, unused player on the roster as a last resort. */
function findEmergencyPlayer(position, team, side, usedPlayerIdsThisPlay) {
    if (!team || !team.roster || !Array.isArray(team.roster)) {
        console.warn(`findEmergencyPlayer: Invalid team data for ${position}.`); return null;
    }
    // Defensive: ensure usedPlayerIdsThisPlay is a Set
    usedPlayerIdsThisPlay = ensureSet(usedPlayerIdsThisPlay);
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
// Replace the entire setupInitialPlayerStates function in game.js with this:

function setupInitialPlayerStates(playState, offense, defense, play, assignments, ballOnYardLine, defensivePlayKey, ballHash = 'M', offensivePlayKey = '') {
    playState.activePlayers = []; // Reset active players for the new play
    const usedPlayerIds_O = new Set(); // Track used offense players for this play
    const usedPlayerIds_D = new Set(); // Track used defense players for this play
    const isPlayAction = offensivePlayKey.includes('PA_');

    // Get the selected defensive play call and its assignments
    const defPlay = defensivePlaybook[defensivePlayKey] || defensivePlaybook['Cover_2_Zone']; // Fallback if key invalid
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
function updatePlayerTargets(playState, offenseStates, defenseStates, ballCarrierState, playType, offensivePlayKey, offensiveAssignments, defensivePlayKey, gameLog) {
    const qbState = offenseStates.find(p => p.slot?.startsWith('QB'));
    const isBallInAir = playState.ballState.inAir;
    const ballPos = playState.ballState;

    const LOS = playState.lineOfScrimmage;
    const POCKET_DEPTH_PASS = -1.5; // 1.5 yards *behind* the LoS
    const POCKET_DEPTH_RUN = 0.5;   // 0.5 yards *in front* of the LoS

    // Helper: Determine if a target is the QB/Carrier and not null
    const isPlayerState = (t) => t && t.speed !== undefined;

    const olAssignedDefenders = new Set();

    // 1. Get all potential threats (DL/LBs who aren't dropping)
    const allThreats = defenseStates.filter(d => {
        if (d.isBlocked || d.isEngaged) return false;
        const isBoxPlayer = d.slot.startsWith('DL') || d.slot.startsWith('LB');
        if (!isBoxPlayer) return false;
        const isDropping = (typeof d.assignment === 'string') &&
            (d.assignment.startsWith('man_cover_') || d.assignment.includes('deep_'));
        return !isDropping;
    });

    // 2. Find all OL who need an assignment
    const allBlockers = offenseStates.filter(p =>
        !p.isEngaged &&
        (p.action === 'pass_block' || p.action === 'run_block')
    );

    // --- ⭐️ Separate Linemen from Other Blockers ⭐️ ---
    const linemen = allBlockers.filter(p => p.slot.startsWith('OL'));
    const otherBlockers = allBlockers.filter(p => !p.slot.startsWith('OL'));

    // 3. Helper function for LINEMEN ONLY (assignTarget)
    const assignLinemanTarget = (blocker, availableThreats, logPrefix) => {
        // Check if it's a live run play (run or completed pass)
        const isLiveRunPlay = (ballCarrierState && !playState.ballState.inAir);

        if (availableThreats.length === 0) {
            // --- "CLIMB" LOGIC ---
            if (isLiveRunPlay) {
                // --- 💡 NEW: Smart Climb (Ball Carrier Aware) ---
                const nextLevelThreats = defenseStates.filter(d =>
                    !d.isBlocked && !d.isEngaged && d.stunnedTicks === 0 &&
                    d.y > blocker.y && // Must be "in front" of the blocker
                    getDistance(blocker, d) < 15 // Must be within 15 yards
                );
                if (nextLevelThreats.length > 0) {
                    // Sort by who is closest *to the ball carrier*
                    nextLevelThreats.sort((a, b) => getDistance(a, ballCarrierState) - getDistance(b, ballCarrierState));
                    const newTarget = nextLevelThreats[0];
                    blocker.dynamicTargetId = newTarget.id;
                    olAssignedDefenders.add(newTarget.id);
                    if (blocker.slot === 'OL2') console.log(`%c[OL2-BRAIN] ${logPrefix}: No primary. Smart Climb to ${newTarget.name} (near carrier)`, 'color: #FFBF00');
                } else {
                    blocker.dynamicTargetId = null; // No one to block
                    if (blocker.slot === 'OL2') console.log(`%c[OL2-BRAIN] ${logPrefix}: No primary or climb targets.`, 'color: #FFBF00');
                }
            } else {
                // --- PASS BLOCK (Ball in air or pre-throw) ---
                blocker.dynamicTargetId = null;
                blocker.targetX = blocker.initialX;
                blocker.targetY = LOS + POCKET_DEPTH_PASS; // Hold pocket
                if (blocker.slot === 'OL2') console.log(`%c[OL2-BRAIN] ${logPrefix}: No target chosen. Holding Pocket.`, 'color: #FFBF00');
            }
            return; // Finished assigning
        }

        // --- "LANE-BASED" LOGIC ---
        const BLOCKING_LANE_WIDTH = 2.0;
        const primaryThreats = availableThreats.filter(d =>
            Math.abs(d.x - blocker.initialX) < BLOCKING_LANE_WIDTH
        );

        let targetDefender = null;
        if (primaryThreats.length > 0) {
            primaryThreats.sort((a, b) => getDistance(blocker, a) - getDistance(blocker, b));
            targetDefender = primaryThreats[0];
            if (blocker.slot === 'OL2') console.log(`%c[OL2-BRAIN] ${logPrefix}: Primary Target (in lane): ${targetDefender.name} (${targetDefender.slot})`, 'color: #FFBF00');
        } else {
            // 2b. No one in our lane. "Help Out" logic.
            availableThreats.sort((a, b) => getDistance(blocker, a) - getDistance(blocker, b));
            targetDefender = availableThreats[0];
            if (blocker.slot === 'OL2' && targetDefender) console.log(`%c[OL2-BRAIN] ${logPrefix}: No threat in lane. Helping on closest: ${targetDefender.name} (${targetDefender.slot})`, 'color: #FFBF00');
        }

        if (targetDefender) {
            blocker.dynamicTargetId = targetDefender.id;
            olAssignedDefenders.add(targetDefender.id);
            if (blocker.slot === 'OL2') console.log(`%c[OL2-BRAIN] ${logPrefix}: Chosen Target: ${targetDefender.name} (${targetDefender.slot})`, 'color: #FFBF00');
        } else {
            // Fallback: No one found, trigger climb/hold logic
            blocker.dynamicTargetId = null;
            if (isLiveRunPlay) {
                // No one in lane, but it's a run play. Do a "dumb climb" for now.
                // The next tick will run the "Smart Climb" logic above.
                blocker.targetX = blocker.initialX;
                blocker.targetY = blocker.y + 7;
            } else {
                // Pass block
                blocker.targetX = blocker.initialX;
                blocker.targetY = LOS + POCKET_DEPTH_PASS;
            }
            if (blocker.slot === 'OL2') console.log(`%c[OL2-BRAIN] ${logPrefix}: No primary or help targets found. ${isLiveRunPlay ? 'Climbing' : 'Holding'}.`, 'color: #FFBF00');
        }
    };

    // 4. Process Blockers (LINEMEN FIRST)
    if (linemen.length > 0) {
        linemen.sort((a, b) => {
            if (a.slot === 'OL2') return -1; // Center first
            if (b.slot === 'OL2') return 1;
            return a.initialX - b.initialX; // Then left-to-right
        });

        // --- OL2 LOG (Threat Header) ---
        const ol2Logger = linemen.find(p => p.slot === 'OL2');
        if (ol2Logger) {
            const logPrefix = `TICK ${playState.tick} | ${ol2Logger.name} (OL2)`;
            console.log(`--- %c[OL2-BRAIN] ${logPrefix} (${ol2Logger.action.toUpperCase()}) ---`, 'color: #FFBF00; font-weight: bold;');
            const threatNames = allThreats.map(d => `${d.slot} (Assign: ${d.assignment})`);
            console.log(`%c[OL2-BRAIN] Threats Seen: [${threatNames.join(', ') || 'NONE'}]`, 'color: #FFBF00');
        }

        // Assign targets to all linemen
        for (const ol of linemen) {
            const availableThreats = allThreats.filter(d => !olAssignedDefenders.has(d.id));
            const prefix = `TICK ${playState.tick} | ${ol.name} (${ol.slot})`;
            assignLinemanTarget(ol, availableThreats, prefix);
        }
    }

    // 5. Process OTHER BLOCKERS (RBs, WRs)
    if (otherBlockers.length > 0) {
        for (const blocker of otherBlockers) {
            // RBs/WRs get simpler logic: "Block the closest unassigned threat"
            const availableThreats = allThreats.filter(d => !olAssignedDefenders.has(d.id));

            if (availableThreats.length > 0) {
                availableThreats.sort((a, b) => getDistance(blocker, a) - getDistance(blocker, b));
                const targetDefender = availableThreats[0];

                blocker.dynamicTargetId = targetDefender.id;
                olAssignedDefenders.add(targetDefender.id);
            } else {
                // No one left for the RB/WR to block.
                blocker.dynamicTargetId = null;
                // Let their 'run_block' or 'pass_block' action handle them
                // (e.g., pass_block will make them hold pocket, run_block will make them climb)
            }
        }
    }

    playState.activePlayers.forEach(pState => {
        let target = null; // Target: PlayerState (dynamic) or {x, y} (static point)

        // --- 1. HANDLE STUNNED STATE (Highest Priority) ---
        if (pState.stunnedTicks > 0) {
            pState.stunnedTicks--;
            pState.targetX = pState.x; // Player stands still while stunned
            pState.targetY = pState.y;
            return; // Skip all other AI logic for this tick
        }

        // --- 2. HANDLE JUKE COOLDOWN & VISUALIZATION ---
        if (pState.action === 'juke' || pState.jukeTicks > 0) {
            pState.jukeTicks--;

            // If juke is still active, player maintains current (reduced speed) course
            if (pState.jukeTicks > 0) {
                // Crucial to return here to prevent AI from recalculating the run_path target
                // If they are mid-juke, they should maintain their direction.
                return;
            } else {
                // Reset the action once the visual effect is over
                pState.action = 'run_path';
                pState.jukeTicks = 0;
            }
        }

        // --- 3. PROCEED TO AI LOGIC ---
        if (pState.isBlocked) {
            pState.targetX = pState.x; pState.targetY = pState.y;
            return;
        }

        if (pState.isOffense && pState.isEngaged) {
            const engagedDefender = defenseStates.find(d => d.id === pState.engagedWith);

            if (engagedDefender) {
                // Target the defender's current position to "stick" to them
                pState.targetX = engagedDefender.x;
                pState.targetY = engagedDefender.y;
            } else {
                // Defender is gone? (Shouldn't happen, but good fallback)
                pState.isEngaged = false; // Break the engagement
                pState.engagedWith = null;
            }

            // We MUST return here to skip the 'switch (pState.action)' logic,
            // which would override our target (e.g., 'pass_block' case).
            return;
        }
        // --- 💡 BLOCKER STATE-CHANGE LOGIC 💡 ---
        // Check if the ball has just been caught by a *different* offensive player
        if (pState.isOffense &&
            pState.id !== ballCarrierState?.id && // I am not the carrier
            (pState.action === 'pass_block' || pState.action === 'run_route' || pState.action === 'route_complete') &&
            ballCarrierState && // A carrier exists
            ballCarrierState.isOffense && // The carrier is on my team
            !playState.ballState.inAir) // Ball is not in the air (i.e., it was caught)
        {
            pState.action = 'run_block';
            pState.dynamicTargetId = null; // Clear any old target
        }
        // --- 💡 END NEW BLOCKER LOGIC 💡 ---

        // --- NEW: Receiver Ball-in-Air Logic ---
        if (pState.isOffense && !pState.hasBall && !pState.isBallCarrier) {

            // --- Check if player *should* be attacking the ball ---
            if ((pState.action === 'run_route' || pState.action === 'route_complete') && playState.ballState.inAir) {
                const isIntendedTarget = playState.ballState.targetPlayerId === pState.id;
                const distToLandingSpot = getDistance(pState, { x: playState.ballState.targetX, y: playState.ballState.targetY });

                if (isIntendedTarget || distToLandingSpot < 8.0) {
                    if (getDistance(pState, ballPos) < 15.0) {
                        pState.action = 'attack_ball';
                    }
                }
            } else if (pState.action === 'attack_ball' && !playState.ballState.inAir) {
                // If the player was attacking the ball, but the ball is no longer
                // in the air (i.e., it was caught or dropped), reset their action.
                pState.action = 'route_complete'; // Go back to a "neutral" state
                pState.targetX = pState.x; // Stop moving
                pState.targetY = pState.y;
            }
        }

        // --- Offensive Logic ---
        if (pState.isOffense) {
            // Check if this is an OL who was faking a run block on a PA pass
            if (pState.slot.startsWith('OL') &&
                pState.action === 'run_block' &&
                playType === 'pass' &&
                playState.tick > 20) {
                // The fake is over! Switch to pass blocking.
                pState.action = 'pass_block';
                // The "Brain" (which now runs every tick) will see this new action
                // and give a correct pass_block assignment.
            }
            switch (pState.action) {
                case 'attack_ball':
                    // Player's action is to move to the ball's *INTENDED LANDING SPOT*
                    pState.targetX = playState.ballState.targetX;
                    pState.targetY = playState.ballState.targetY;

                    // Manually clamp targets within field boundaries, then return
                    pState.targetX = Math.max(0.5, Math.min(FIELD_WIDTH - 0.5, pState.targetX));
                    pState.targetY = Math.max(0.5, Math.min(FIELD_LENGTH - 0.5, pState.targetY));

                    target = null;

                    break; // Skip all other targeting logic for this player

                case 'run_route': { // Use brackets for new variable scope
                    if (!pState.routePath || pState.routePath.length === 0) {
                        // No path, just stop and find space
                        pState.action = 'route_complete';
                        pState.targetX = pState.x;
                        pState.targetY = pState.y;
                        break;
                    }

                    // Get the current target point from the path
                    const currentTargetPoint = pState.routePath[pState.currentPathIndex];

                    // Check if we've arrived at the current point
                    const ARRIVAL_RADIUS = 0.3; // Small radius for waypoints
                    const dx = currentTargetPoint.x - pState.x;
                    const dy = currentTargetPoint.y - pState.y;
                    const distToTarget = Math.sqrt(dx * dx + dy * dy);

                    if (distToTarget < ARRIVAL_RADIUS) {
                        // --- Arrived, move to the next point ---
                        pState.currentPathIndex++;

                        if (pState.currentPathIndex < pState.routePath.length) {
                            // --- More points in the route ---
                            const nextTargetPoint = pState.routePath[pState.currentPathIndex];
                            pState.targetX = nextTargetPoint.x;
                            pState.targetY = nextTargetPoint.y;
                        } else {
                            // --- End of route ---
                            pState.action = 'route_complete';
                            pState.targetX = pState.x; // Stop for now
                            pState.targetY = pState.y;
                        }
                    }
                    // If not at target, just keep moving.
                    // The targetX/targetY are already set, so we don't need an 'else'.
                    break; // Exit the switch
                }

                case 'pass_block':
                    if (pState.dynamicTargetId) {
                        const target = defenseStates.find(d => d.id === pState.dynamicTargetId);
                        if (target && (target.blockedBy === null || target.blockedBy === pState.id)) {
                            pState.targetX = target.x;
                            pState.targetY = target.y;
                        } else {
                            // Target gone, brain will assign new one
                            pState.dynamicTargetId = null;
                            pState.targetX = pState.initialX;
                            pState.targetY = LOS + POCKET_DEPTH_PASS;
                        }
                    } else {
                        // No target assigned by brain (holding pocket)
                        pState.targetX = pState.initialX;
                        pState.targetY = LOS + POCKET_DEPTH_PASS;
                    }
                    target = null;
                    break;

                case 'run_block':
                    if (pState.dynamicTargetId) {
                        const target = defenseStates.find(d => d.id === pState.dynamicTargetId);

                        // Check if target is still valid
                        if (target && (target.blockedBy === null || target.blockedBy === pState.id)) {

                            // --- Target is valid: Engage ---
                            pState.targetX = target.x;
                            pState.targetY = target.y; // Target the defender's current Y

                        } else {
                            // --- Target is GONE (e.g., blocked by someone else) ---
                            // Brain will assign a new one next tick.
                            pState.dynamicTargetId = null;

                            // 💡 NEW "SEEK" LOGIC (see else block)
                            if (ballCarrierState) {
                                // IQ-based lane selection: high IQ = better anticipation of defenders
                                const visionIQ = ballCarrierState.playbookIQ || 50;
                                let bestLaneX = ballCarrierState.x;
                                let bestLaneY = ballCarrierState.y + 2;
                                // Scan for open lanes (avoid defenders within 4 yards)
                                for (let dx = -4; dx <= 4; dx += 2) {
                                    const laneX = ballCarrierState.x + dx;
                                    const laneY = ballCarrierState.y + 2 + Math.round(visionIQ / 40); // High IQ = more yards forward
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
                        // --- 💡 NEW "SEEK" LOGIC ---
                        // No target assigned (either won block or no one was near).
                        // Seek out the ball carrier to find a new block.
                        if (ballCarrierState) {
                            // Target a spot slightly in front of the ball carrier
                            pState.targetX = ballCarrierState.x;
                            pState.targetY = ballCarrierState.y + 2; // Aim 2 yards in front
                        } else {
                            // Fallback (e.g., pre-handoff)
                            pState.targetX = pState.initialX; // Stay in lane
                            pState.targetY = pState.y + 5;   // Climb 5 yards
                        }
                    }
                    target = null; // Prevent falling into defensive pursuit logic
                    break;

                case 'pursuit':
                    // This is for offense after a turnover.
                    if (ballCarrierState && !ballCarrierState.isOffense) {
                        // Target the (defensive) ball carrier
                        target = ballCarrierState;
                    } else {
                        // No carrier, or carrier is on offense (play is broken), just stop
                        pState.targetX = pState.x;
                        pState.targetY = pState.y;
                        target = null;
                    }
                    break;

                case 'route_complete':
                    const FIND_SPACE_RADIUS = 12; // How far the receiver looks for space
                    const nearbyDefenders = defenseStates.filter(d =>
                        !d.isBlocked && !d.isEngaged && getDistance(pState, d) < FIND_SPACE_RADIUS
                    ).sort((a, b) => getDistance(pState, a) - getDistance(pState, b));

                    if (qbState?.action === 'qb_scramble') {
                        // --- Scramble Drill ---
                        // Move towards sideline QB is rolling to, maintaining depth
                        pState.targetX = qbState.targetX > CENTER_X ? FIELD_WIDTH - 5 : 5; // Target sideline area
                        pState.targetY = Math.max(playState.lineOfScrimmage + 3, qbState.y + 2); // Stay slightly ahead of QB
                    } else if (nearbyDefenders.length === 0) {
                        // --- Wide Open ---
                        // Stand mostly still, maybe slight drift towards center/sideline
                        pState.targetX = pState.x + (pState.x < CENTER_X ? -0.1 : 0.1);
                        pState.targetY = pState.y;
                    } else {
                        // --- Find Open Space among defenders ---
                        let bestX = pState.x;
                        let bestY = pState.y;
                        let maxMinDist = 0; // Find spot with largest distance to *closest* defender

                        // Check a few potential spots around the receiver
                        const potentialSpots = [
                            { x: pState.x + 3, y: pState.y }, { x: pState.x - 3, y: pState.y }, // Horizontal
                            { x: pState.x, y: pState.y + 2 }, { x: pState.x, y: pState.y - 2 }, // Vertical
                            { x: pState.x + 2, y: pState.y + 2 }, { x: pState.x - 2, y: pState.y + 2 }, // Diagonals
                            { x: pState.x + 2, y: pState.y - 2 }, { x: pState.x - 2, y: pState.y - 2 },
                        ];

                        potentialSpots.forEach(spot => {
                            // Ensure spot is in reasonable bounds (e.g., past LoS)
                            if (spot.y < playState.lineOfScrimmage + 1) return;

                            // Find distance to the closest defender from this potential spot
                            let minDistToDefender = FIND_SPACE_RADIUS;
                            nearbyDefenders.forEach(def => {
                                const dist = getDistance(spot, def);
                                if (dist < minDistToDefender) {
                                    minDistToDefender = dist;
                                }
                            });

                            // If this spot offers more separation than the current best, choose it
                            if (minDistToDefender > maxMinDist) {
                                maxMinDist = minDistToDefender;
                                bestX = spot.x;
                                bestY = spot.y;
                            }
                        });

                        // Target the best found spot
                        pState.targetX = bestX;
                        pState.targetY = bestY;
                    }
                    break; // End case 'route_complete'


                case 'run_path': { // --- Logic for ballcarriers ---
                    const threatDistance = 3.5; // How far to look for immediate threats
                    const visionDistance = 10.0; // How far to look downfield for lanes
                    const nearestThreat = defenseStates
                        .filter(d => !d.isBlocked && !d.isEngaged && getDistance(pState, d) < threatDistance)
                        .sort((a, b) => getDistance(pState, a) - getDistance(pState, b))[0];

                    let targetXOffset = 0;

                    if (nearestThreat) {
                        // --- A. Immediate Avoidance (Threat is very close) ---
                        const distanceToThreat = getDistance(pState, nearestThreat);
                        const avoidStrength = 1.2 + (threatDistance - distanceToThreat) * 0.5;
                        targetXOffset = (pState.x >= nearestThreat.x) ? avoidStrength : -avoidStrength;
                    } else {
                        // --- B. No Immediate Threat: Find Best Lane (with downhill bias) ---
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
                        targetXOffset = bestLane.xOffset; // Target the best open lane
                    }

                    pState.targetY = Math.min(FIELD_LENGTH - 1.0, pState.y + visionDistance);
                    pState.targetX = pState.x + targetXOffset;
                    break;
                }

                case 'qb_scramble': { // --- Logic for QBs ---
                    const visionDistance = 8.0; // QB looks for shorter-term open space
                    let targetXOffset = 0;

                    if (pState.scrambleDirection) {
                        // QB decision function already told us which way to run
                        targetXOffset = pState.scrambleDirection * 8; // e.g., (1 * 8) or (-1 * 8)
                        pState.scrambleDirection = null; // Clear the flag after we've used it
                    } else {
                        // --- Fallback: No specific direction, just find open grass (your original logic) ---
                        const lanes = [-8, 0, 8]; // Wider lanes, QB is desperate
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
                        targetXOffset = bestLane.xOffset; // Target the widest open lane
                    }

                    pState.targetY = Math.min(FIELD_LENGTH - 1.0, pState.y + visionDistance);
                    pState.targetX = pState.x + targetXOffset;
                    break;
                }

                case 'qb_setup': {
                    const POCKET_RADIUS = 6.0; // How far QB looks for immediate threats
                    const STEP_DISTANCE = 0.75; // How far QB steps/slides per adjustment

                    // Find closest non-engaged defender moving towards the QB within radius
                    const closestThreat = defenseStates
                        .filter(d =>
                            !d.isBlocked &&
                            !d.isEngaged &&
                            getDistance(pState, d) < POCKET_RADIUS &&
                            d.targetY < pState.y + 2
                        )
                        .sort((a, b) => getDistance(pState, a) - getDistance(pState, b))[0];

                    if (closestThreat) {
                        // --- React to Threat ---
                        const dxThreat = closestThreat.x - pState.x;
                        const dyThreat = closestThreat.y - pState.y;
                        const distThreat = getDistance(pState, closestThreat);
                        let escapeX = pState.x - (dxThreat / distThreat) * STEP_DISTANCE;
                        let escapeY = pState.y - (dyThreat / distThreat) * STEP_DISTANCE;

                        // --- Pocket Awareness ---
                        if (Math.abs(dxThreat) > dyThreat && escapeY > pState.initialY - 3) {
                            escapeY = pState.y + STEP_DISTANCE * 0.5; // Step up
                            escapeX = pState.x - Math.sign(dxThreat) * STEP_DISTANCE * 0.75;
                        }
                        escapeY = Math.max(pState.initialY - 4, escapeY); // Don't drift too far

                        pState.targetX = escapeX;
                        pState.targetY = escapeY;
                    } else {
                        // --- No Immediate Threat ---
                        // If QB has reached initial target, stay there.
                        if (getDistance(pState, { x: pState.targetX, y: pState.targetY }) < 0.5) {
                            pState.targetX = pState.x;
                            pState.targetY = pState.y; // Hold position
                        }
                        // If still moving to initial drop spot, the target remains valid.
                    }
                    break; // <-- CRITICAL: Exit the switch
                }

                case 'idle': default:
                    pState.targetX = pState.x;
                    pState.targetY = pState.y;
                    break;
            }
        }
        // --- Defensive Logic ---
        else {
            // --- Check if DEFENDER is the ball carrier ---
            if (pState.isBallCarrier) {
                // This player has the ball (after an INT).
                // Use the same "run_path" logic as the RB, but run towards Y=0 (the other end zone).
                const visionDistance = 10.0;
                const lanes = [-5, 0, 5];
                const DOWNHILL_BONUS = 1.5; // Bonus for running straight
                let bestLane = { xOffset: 0, minDist: -Infinity };

                lanes.forEach(xOffset => {
                    const lookAheadPoint = { x: pState.x + xOffset, y: pState.y - visionDistance }; // Run towards Y=0

                    // Look for *offensive* players (who are now blockers)
                    const closestBlockerToLane = offenseStates
                        .filter(o => !o.isBlocked && !o.isEngaged)
                        .sort((a, b) => getDistance(lookAheadPoint, a) - getDistance(lookAheadPoint, b))[0];

                    let dist = closestBlockerToLane ? getDistance(lookAheadPoint, closestBlockerToLane) : 100;
                    if (xOffset === 0) dist += DOWNHILL_BONUS; // Add bonus for running straight

                    if (dist > bestLane.minDist) {
                        bestLane.minDist = dist;
                        bestLane.xOffset = xOffset;
                    }
                });

                pState.targetY = Math.max(0.5, pState.y - visionDistance); // Set target Y towards Y=0
                pState.targetX = pState.x + bestLane.xOffset;

            } else {
                const assignment = pState.assignment;
                // Each defender diagnoses the play individually based on IQ
                const diagnosedPlayType = diagnosePlay(pState, playType, offensivePlayKey, playState.tick);
                // diagnosedPlayType will now be 'run', 'pass', or 'read'

                // --- 💡 SAFETY FIX #1 (QB SCRAMBLE) ---
                // This check is now needed by *both* Man and Zone logic.
                const isQBScramble = qbState && (qbState.action === 'qb_scramble' || qbState.y > playState.lineOfScrimmage + 1);
                // --- END FIX ---

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
                            // --- Ball is in the Air ---
                            if (playState.ballState.targetPlayerId === assignedReceiver.id || getDistance(pState, { x: playState.ballState.targetX, y: playState.ballState.targetY }) < 15) {
                                // Target the ball's landing spot
                                target = { x: playState.ballState.targetX, y: playState.ballState.targetY };
                            } else {
                                // Ball thrown elsewhere, stick to receiver
                                target = assignedReceiver;
                            }
                        } else if ((isRunPlay || isQBScramble) && ballCarrierState) {
                            // --- ✳️ It's a Run Play or QB Scramble! ---
                            if (isSafety && ballCarrierState.y < playState.lineOfScrimmage + 5) {
                                // Runner is still bottled up, hold position
                                target = pState;
                            } else {
                                // Cornerbacks and LBs in man-coverage must attack the run.
                                target = ballCarrierState;
                            }
                        } else {
                            // --- Ball is NOT in the Air (Pass Play) ---
                            target = assignedReceiver;
                        }
                        break; // Go to the main pursuit logic
                    }

                    case assignment?.startsWith('zone_'): {
                        const zoneCenter = getZoneCenter(assignment, playState.lineOfScrimmage);
                        let targetThreat = null; // The player we will target
                        let targetPoint = zoneCenter; // The {x, y} point we will target
                        const landingSpot = { x: playState.ballState.targetX, y: playState.ballState.targetY };

                        const isDeepZone = assignment.includes('deep');

                        // --- (This 'threatsInZone' logic is fine) ---
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

                        // --- 💡 NEW: Define a "Ground Threat" ---
                        // This is true for a run, a scramble, OR a completed pass.
                        const isGroundThreat = (ballCarrierState && !isBallInAir);


                        // --- 1. React to Ball in Air (Highest Priority) ---
                        if (isBallInAir && isPlayerInZone(landingSpot, assignment, playState.lineOfScrimmage)) {
                            targetPoint = landingSpot;
                            targetThreat = null; // Override any player target
                            break; // Exit the switch, go to pursuit logic
                        }

                        // --- 2. React to ANY Ground Threat (Second Priority) ---
                        // 💡 This is the critical logic fix.
                        else if (isGroundThreat) {
                            if (!isDeepZone) {
                                // --- Underneath Zone Run Support ---
                                if (isPlayerInZone(ballCarrierState, assignment, playState.lineOfScrimmage) || getDistance(pState, ballCarrierState) < 8.0) {
                                    targetThreat = ballCarrierState; // Target the runner
                                }
                            } else {
                                // --- DEEP ZONE RUN SUPPORT (Safety) ---
                                // If carrier is 5+ yards downfield OR in our zone, ATTACK.
                                if (ballCarrierState.y > (playState.lineOfScrimmage + 5) || isPlayerInZone(ballCarrierState, assignment, playState.lineOfScrimmage)) {
                                    targetThreat = ballCarrierState; // ATTACK!
                                } else {
                                    // Carrier is bottled up. "Creep" to a run-support position.
                                    targetPoint = { x: ballCarrierState.x, y: playState.lineOfScrimmage + 10 }; // Creep to 10 yards
                                    targetThreat = null;
                                }
                            }
                        }

                        // --- 3. React to Passing Threats (Third Priority) ---
                        // (Only runs if ball is not in air AND there is no ground threat)
                        else if (threatsInZone.length > 0) {
                            if (isDeepZone) {
                                // --- DEEP ZONE LOGIC ---
                                threatsInZone.sort((a, b) => b.y - a.y);
                                targetThreat = threatsInZone[0];
                            } else {
                                // --- UNDERNEATH ZONE LOGIC ---
                                threatsInZone.sort((a, b) => getDistance(pState, a) - getDistance(pState, b));
                                targetThreat = threatsInZone[0];
                            }
                        }

                        // --- 4. No threats in zone. "Read" intermediate routes. ---
                        else if (threatsInZone.length === 0) {
                            // "ROBBER" LOGIC for DEEP SAFETIES
                            if (isDeepZone && diagnosedPlayType === 'pass') {
                                // ... (Your existing, correct Robber logic) ...
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
                            // "Sink" logic for flat defenders
                            if (assignment.startsWith('zone_flat_')) {
                                // ... (Your existing Sink logic) ...
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

                        // --- 5. Set Final Target ---
                        if (targetThreat) {
                            target = targetThreat; // Set the target as the player object
                        } else {
                            target = targetPoint; // Target the calculated point
                        }

                        break; // Go to the main pursuit logic at the end of the function
                    }

                    case assignment === 'pass_rush':
                    case assignment === 'blitz_gap':
                    case assignment === 'blitz_edge':
                        // 1. Highest Priority: Ball is in the air.
                        if (isBallInAir) {
                            target = { x: ballPos.targetX, y: ballPos.targetY };

                            // 2. Second Priority: Ball is on the ground (completed pass or handoff).
                        } else if (ballCarrierState && ballCarrierState.id !== qbState?.id) {
                            target = ballCarrierState;

                            // 3. Third Priority: It's a diagnosed run (and the carrier might be the QB)
                        } else if (diagnosedPlayType === 'run' && ballCarrierState) {
                            target = ballCarrierState;

                            // 4. Fourth Priority: It's a pass play, ball hasn't been thrown.
                        } else if (qbState) {
                            // Diagnosed PASS or STILL READING: Rush the QB.
                            target = qbState;

                            // Blocker-avoidance logic
                            const blockerInPath = offenseStates.find(o => !o.engagedWith && getDistance(pState, o) < 2.0 && Math.abs(o.x - pState.x) < 1.0 && ((pState.y < o.y && o.y < (target?.y || pState.y + 5)) || (pState.y > o.y && o.y > (target?.y || pState.y - 5))));
                            if (blockerInPath) {
                                const avoidOffset = (pState.x > blockerInPath.x) ? 1.0 : -1.0;
                                target = { x: pState.x + avoidOffset * 2, y: qbState.y };
                            }

                            // 5. Fallback
                        } else {
                            target = null;
                        }
                        break;

                    case assignment?.startsWith('run_gap_'):
                    case assignment?.startsWith('run_edge_'):
                        // 1. Ball in air?
                        if (isBallInAir) {
                            target = { x: ballPos.targetX, y: ballPos.targetY };

                            // 2. Ball on ground? (Handoff or Completed Pass)
                        } else if (ballCarrierState && ballCarrierState.id !== qbState?.id) {
                            target = ballCarrierState;

                            // 3. Diagnosed pass, ball still in QB's hands?
                        } else if (diagnosedPlayType === 'pass') {
                            pState.action = 'pass_rush';
                            target = qbState; // Target QB

                            // 4. Diagnosed run (or still reading)?
                        } else {
                            // It's a run OR STILL READING: Attack gap, then carrier.
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

                        } else if (qbState) { // Continue with original logic if it's a pass/read
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

                    case 'run_support': // e.g., Safety coming downhill
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

                    case 'fill_run': // e.g., LB reading the play
                        if (diagnosedPlayType === 'run' && ballCarrierState) {
                            target = { x: ballCarrierState.x, y: ballCarrierState.y };
                        } else if (diagnosedPlayType === 'pass') {
                            pState.assignment = 'zone_hook_curl_middle';
                            target = getZoneCenter('zone_hook_curl_middle', playState.lineOfScrimmage);
                        } else {
                            target = { x: pState.x, y: pState.y + 0.1 };
                        }
                        break;

                    case 'def_read': // Default "read and react"
                        if (diagnosedPlayType === 'run' && ballCarrierState) {
                            target = { x: ballCarrierState.x, y: ballCarrierState.y };
                        } else if (diagnosedPlayType === 'pass') {
                            pState.assignment = 'zone_hook_curl_middle';
                            target = getZoneCenter('zone_hook_curl_middle', playState.lineOfScrimmage);
                        } else {
                            target = { x: pState.x, y: pState.y + 0.5 };
                        }
                        break;

                    default: // Fallback
                        if (isBallInAir) {
                            target = ballPos; // Play the ball
                        } else if (ballCarrierState) {
                            target = ballCarrierState; // Chase the carrier
                        } else {
                            target = { x: pState.x, y: pState.y };
                        }
                        break;
                }

                // --- Set Target Coordinates (Pursuit Logic) ---
                if (isPlayerState(target)) { // Target is a dynamic player state
                    const isManCoverage = pState.assignment.startsWith('man_cover_') && !target.isBallCarrier;

                    if (isManCoverage) {
                        // --- MAN COVERAGE LOGIC ---
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
                            // Offense is running towards HIGH Y (end zone at 110-120)
                            isDefenderInFront = pState.y > target.y;
                        } else {
                            // Defense is running towards LOW Y (end zone at 0-10) after an INT
                            isDefenderInFront = pState.y < target.y;
                        }

                        if (isDefenderInFront) {
                            // --- A. I AM IN FRONT of the target (e.g., Safety) ---
                            pState.targetX = target.x;
                            pState.targetY = target.y;
                        } else {
                            // --- B. I AM BEHIND the target ---
                            const distToTarget = getDistance(pState, target);
                            const carrierSpeedYPS = target.currentSpeedYPS || (target.speed / 10);
                            const ownSpeedYPS = pState.currentSpeedYPS || ((pState.speed / 10) * pState.fatigueModifier);
                            const timeToIntercept = distToTarget > 0.1 ? distToTarget / ownSpeedYPS : 0;
                            const leadDist = carrierSpeedYPS * timeToIntercept;
                            const iqLeadFactor = 0.8 + ((pState.playbookIQ || 50) / 250);
                            const finalLeadDist = leadDist * iqLeadFactor;
                            const targetDX = target.targetX - target.x;
                            const targetDY = target.targetY - target.y;
                            const targetDistToTarget = Math.max(0.1, Math.sqrt(targetDX * targetDX + targetDY * targetDY));

                            let futureTargetX = target.x + (targetDX / targetDistToTarget) * finalLeadDist;
                            let futureTargetY = target.y + (targetDY / targetDistToTarget) * finalLeadDist;

                            const SIDELINE_BUFFER = 2.0;
                            const nearLeftSideline = target.x < SIDELINE_BUFFER;
                            const nearRightSideline = target.x > (FIELD_WIDTH - SIDELINE_BUFFER);

                            if (nearLeftSideline || nearRightSideline) {
                                // Carrier is hugging the sideline.
                                // Don't lead them OOB. Just target their *current* X,
                                // but lead their Y. This creates a good "cutoff" angle.
                                futureTargetX = target.x;
                            }

                            pState.targetX = futureTargetX;
                            pState.targetY = futureTargetY;
                        }
                    }

                } else if (target) { // Target is a fixed point {x, y}
                    pState.targetX = target.x; pState.targetY = target.y;
                } else { // Fallback hold (target = null)
                    pState.targetX = pState.x; pState.targetY = pState.y;
                }
            } // End if(!isBlocked && !isEngaged)
        }

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
                    console.log(`%c*** BLOCK ENGAGED (Tick: ${playState.tick}) ***: ${blocker.name} (${blocker.slot}) has engaged ${targetDefender.name} (${targetDefender.slot})`, 'color: #00dd00; font-weight: bold;');
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
function checkTackleCollisions(playState, gameLog) {
    const ballCarrierState = playState.activePlayers.find(p => p.isBallCarrier);
    if (!ballCarrierState) return false;

    // Filter defenders who are active and not engaged
    const activeDefenders = playState.activePlayers.filter(p =>
        p.teamId !== ballCarrierState.teamId && // Not on the carrier's team
        !p.isBlocked &&
        !p.isEngaged &&
        p.stunnedTicks === 0
    );

    // Define initial tackle attempts taken by the carrier this play
    if (ballCarrierState.tacklesBrokenThisPlay === undefined) ballCarrierState.tacklesBrokenThisPlay = 0;

    const MOMENTUM_SCALING_FACTOR = 0.1; // Base scaling for carrier
    const TACKLE_RANGE_CHECK = TACKLE_RANGE;

    for (const defender of activeDefenders) {
        if (getDistance(ballCarrierState, defender) < TACKLE_RANGE_CHECK) {

            const carrierPlayer = game.players.find(p => p && p.id === ballCarrierState.id);
            const tacklerPlayer = game.players.find(p => p && p.id === defender.id);
            if (!carrierPlayer || !tacklerPlayer) continue;

            if (checkFumble(carrierPlayer, tacklerPlayer, playState, gameLog)) return true;

            // --- 1. Carrier's Break Power (Modified for Successive Tackles) ---
            const carrierWeight = carrierPlayer.attributes?.physical?.weight || 180;
            const carrierSpeed = ballCarrierState.currentSpeedYPS || 0;

            // Apply heavy penalty for each broken tackle (e.g., 20% penalty per broken tackle)
            const successiveTacklePenalty = ballCarrierState.tacklesBrokenThisPlay * 0.20;
            const skillModifier = Math.max(0.1, 1.0 - successiveTacklePenalty); // Minimum 10% skill retained

            // Base "Break" skill = 100% Agility + 50% Strength
            const carrierSkill = (
                (carrierPlayer.attributes?.physical?.agility || 50) * 1.0 +
                (carrierPlayer.attributes?.physical?.strength || 50) * 0.5
            ) * skillModifier; // Apply penalty here

            // Momentum Bonus (less affected by penalty, as momentum is physical)
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
            const roll = getRandomInt(-10, 10); // Reduced randomness to favor stats
            const diff = (breakPower + roll) - tacklePower; // Roll now helps the carrier (simplified from previous logic)

            if (diff <= 0) { // Tackle success
                playState.yards = ballCarrierState.y - playState.lineOfScrimmage;
                playState.playIsLive = false;

                // ... (Sack/Tackle logging logic) ...
                if (ballCarrierState.slot === 'QB1' && (ballCarrierState.action === 'qb_setup' || ballCarrierState.action === 'qb_scramble') && ballCarrierState.y < playState.lineOfScrimmage) {
                    playState.sack = true;
                    gameLog.push(`💥 SACK! ${tacklerPlayer.name} (TklPwr: ${tacklePower.toFixed(0)}) gets to ${ballCarrierState.name}!`);
                } else {
                    gameLog.push(`✋ ${ballCarrierState.name} tackled by ${defender.name} (TklPwr: ${tacklePower.toFixed(0)}) for a gain of ${playState.yards.toFixed(1)} yards.`);
                }

                return true; // Play ended
            } else { // Broken tackle (Juke)
                // Increment the counter for the penalty to apply next time
                ballCarrierState.tacklesBrokenThisPlay++;

                // --- 🛠️ NEW: SET JUKE ACTION & COOLDOWN ---
                ballCarrierState.action = 'juke'; // Set temporary action state
                ballCarrierState.jukeTicks = 12; // New timer to run the visualization effect

                // Momentum Loss: Halve the current speed
                ballCarrierState.currentSpeedYPS *= 0.5;

                gameLog.push(`💥 ${ballCarrierState.name} (BrkPwr: ${breakPower.toFixed(0)}) breaks tackle from ${defender.name} (TklPwr: ${tacklePower.toFixed(0)})!`);

                // Stun the immediate tackler for failing
                defender.stunnedTicks = 40;

                // Check for nearby defenders to stun (group juke)
                const JUKE_STUN_RADIUS = 3.0; // 3 yards (9 feet)
                playState.activePlayers.forEach(p => {
                    if (!p.isOffense && p.id !== defender.id && p.stunnedTicks === 0 && getDistance(ballCarrierState, p) < JUKE_STUN_RADIUS) {
                        p.stunnedTicks = 15; // Shorter stun for being close
                        gameLog.push(`[Juke]: ${p.name} was juked out of the play!`);
                    }
                });
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
function updateQBDecision(playState, offenseStates, defenseStates, gameLog) {
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
    const READ_PROGRESSION_DELAY = Math.max(12, Math.round((100 - qbIQ) / 8)); // ~0.3s - 0.7s
    const initialReadTicks = 20; // ~0.9s to start first read

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
    const baseDecisionTicks = 60; // 3.0s for 99 IQ
    const iqPenaltyTicks = Math.round((100 - qbIQ) * 0.5); // 0.5 ticks per IQ point below 99
    const calmnessBonus = Math.round(qbIQ * 0.2); // Higher IQ = more calm under pressure

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
            gameLog.push(`[QB Read]: 🎯 ${qbState.name} (IQ: ${qbIQ}) hits his read ${targetPlayerState.name} in rhythm!`);

        } else if (qbIQ > 55 && openPrimaryReads.length > 0 && Math.random() < 0.7) {
            // --- 2. (IQ CHECK) Find another open primary read ---
            targetPlayerState = openPrimaryReads[0];
            actionTaken = "Throw Fallback Read";
            gameLog.push(`[QB Read]: 🧠 ${qbState.name} (IQ: ${qbIQ})'s progression was covered, finds a late open read in ${targetPlayerState.name}!`);

        } else if (checkdownIsOpen) {
            // --- 3. Throw to Checkdown (Safe Play) ---
            targetPlayerState = read_checkdown;
            actionTaken = "Throw Checkdown";
            if (isPressured) {
                gameLog.push(`[QB Read]: 🔒 ${qbState.name} feels pressure, dumps to checkdown ${targetPlayerState.name}.`);
            } else {
                gameLog.push(`[QB Read]: 🔒 ${qbState.name} (IQ: ${qbIQ})'s read was covered. Checking down to ${targetPlayerState.name}.`);
            }

        } else if (canScramble) {
            // --- 4. Scramble ---
            qbState.action = 'qb_scramble';
            qbState.scrambleDirection = 0; // Forward
            qbState.hasBall = false;
            qbState.isBallCarrier = true;
            playState.ballState.x = qbState.x; playState.ballState.y = qbState.y;
            gameLog.push(`🏃 ${qbState.name} ${imminentSackDefender ? 'escapes the sack' : 'finds open lane'} and scrambles forward!`);
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
                gameLog.push(`[QB Read]: ⚠️ ${qbState.name} is pressured and forces a bad throw to ${targetPlayerState.name}!`);
            } else {
                // Wait for play to develop
                return;
            }
        }

        // --- Perform Throw or Handle Sack/Throw Away ---
        if (targetPlayerState && (actionTaken.includes("Throw"))) {
            // --- Initiate Throw ---
            gameLog.push(`🏈 ${qbState.name} [${reason}] ${actionTaken.includes("Checkdown") ? 'checks down to' : 'throws to'} ${targetPlayerState.name}...`);
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

            gameLog.push(`[DEBUG] QB aiming at: (${clampedAimX.toFixed(1)}, ${clampedAimY.toFixed(1)})`);
            // --- End Ball Physics ---

        } else if (imminentSackDefender && actionTaken !== "Scramble") {
            // QB held it too long waiting for sack
            gameLog.push(`⏳ ${qbState.name} holds it too long...`);
            // Sack will be handled by checkTackleCollisions on next tick
        } else {
            // No target found or decided to throw away
            gameLog.push(`⤴️ ${qbState.name} ${isPressured ? 'feels the pressure and' : ''} throws it away!`);
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
/**
 * Handles ball arrival at target coordinates. (MODIFIED)
 */
function handleBallArrival(playState, gameLog) {
    // 1. Ball Height Check
    if (!playState.ballState.inAir) return; // Ball not in air

    if (playState.ballState.z > 2.5) { // Check if ball is too high
        gameLog.push(`‹‹ Pass is thrown **too high**. Incomplete.`);
        playState.incomplete = true; playState.playIsLive = false; playState.ballState.inAir = false;
        return; // Play is over
    }
    if (playState.ballState.z < 0.1) { // Check if ball is too low
        gameLog.push(`‹‹ Pass is thrown **too low** and hits the ground. Incomplete.`);
        playState.incomplete = true; playState.playIsLive = false; playState.ballState.inAir = false;
        return; // Play is over
    }
    // If we are here, ball is at a catchable height (0.1 - 2.5)

    // 2. Check if Target Receiver is Valid
    const targetPlayerState = playState.activePlayers.find(p => p.id === playState.ballState.targetPlayerId);
    if (!targetPlayerState) {
        gameLog.push("‹‹ Pass intended target not found. Incomplete.");
        playState.incomplete = true; playState.playIsLive = false; playState.ballState.inAir = false;
        return;
    }

    // 3. Find Key Players and Distances
    // *** MODIFICATION 1: Increased catch radius ***
    const CATCH_CHECK_RADIUS = 2.5; // Our 2.5 yard radius (was 1.8)
    const receiverPlayer = game.players.find(p => p && p.id === targetPlayerState.id); // Get full receiver object

    // Find *closest* defender to the ball, regardless of radius
    const closestDefenderState = playState.activePlayers
        .filter(p => !p.isOffense && !p.isBlocked && !p.isEngaged)
        .sort((a, b) => getDistance(a, playState.ballState) - getDistance(b, playState.ballState))[0];

    const defenderPlayer = closestDefenderState ? game.players.find(p => p && p.id === closestDefenderState.id) : null;

    // Check if the key players are *actually in range*
    const receiverInRange = getDistance(targetPlayerState, playState.ballState) < CATCH_CHECK_RADIUS;
    const defenderInRange = closestDefenderState && getDistance(closestDefenderState, playState.ballState) < CATCH_CHECK_RADIUS;

    let eventResolved = false;

    // 4. Interception Attempt (Only if defender is in range)
    if (defenderInRange && defenderPlayer?.attributes) {
        const defCatchSkill = defenderPlayer.attributes.technical?.catchingHands || 30;
        const defAgility = defenderPlayer.attributes.physical?.agility || 50;
        let defenderPower = (defCatchSkill * 0.6 + defAgility * 0.4) * closestDefenderState.fatigueModifier;

        let receiverPresencePenalty = 0;
        if (receiverInRange && receiverPlayer?.attributes) { // Receiver must also be in range to fight for it
            const recCatchSkill = receiverPlayer.attributes.technical?.catchingHands || 50;
            const recStrength = receiverPlayer.attributes.physical?.strength || 50;
            receiverPresencePenalty = ((recCatchSkill * 0.5 + recStrength * 0.2) * targetPlayerState.fatigueModifier) / 3;
        }

        const distToBallDef = getDistance(closestDefenderState, playState.ballState);
        const proximityBonus = Math.max(0, (CATCH_CHECK_RADIUS - distToBallDef) * 20); // Bonus for being closer
        defenderPower += proximityBonus - receiverPresencePenalty;

        if (defenderPower + getRandomInt(0, 35) > 85) { // Threshold for INT
            eventResolved = true;
            gameLog.push(`❗ INTERCEPTION! ${closestDefenderState.name} (Catch: ${defCatchSkill}) jumps the route!`);
            playState.turnover = true;
            // ... (rest of interception state update logic) ...
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
            const throwerPlayer = game.players.find(p => p && p.id === playState.ballState.throwerId);
            if (throwerPlayer) {
                ensureStats(throwerPlayer);
                throwerPlayer.gameStats.interceptionsThrown = (throwerPlayer.gameStats.interceptionsThrown || 0) + 1;
            }
        }
    }
    // --- END 4. INT ATTEMPT ---


    // --- ⭐️ START NEW LOGIC BLOCK (4b) ⭐️ ---
    // 4b. Contested Pass Breakup (PBU)
    // This runs if:
    // 1. No interception happened (eventResolved is false)
    // 2. BOTH players are in range
    // 3. The Defender is CLOSER (or equal distance) to the ball than the Receiver

    // We must re-calculate distances here to be safe
    const distToBallDef = defenderInRange ? getDistance(closestDefenderState, playState.ballState) : Infinity;
    const distToBallRec = receiverInRange ? getDistance(targetPlayerState, playState.ballState) : Infinity;

    if (!eventResolved && defenderInRange && receiverInRange && (distToBallDef <= distToBallRec)) {
        // Defender is in position to swat the ball.
        const defAgility = defenderPlayer.attributes.physical?.agility || 50;
        const defStrength = defenderPlayer.attributes.physical?.strength || 50;

        // Calculate PBU power (more based on agility/strength than hands)
        let pbuPower = (defAgility * 0.7 + defStrength * 0.3) * closestDefenderState.fatigueModifier;

        // Bonus for being *much* closer
        if (distToBallDef < distToBallRec - 1.0) { // 1+ yard advantage
            pbuPower += 15;
        }

        if (pbuPower + getRandomInt(0, 30) > 50) { // Threshold for a contested PBU
            eventResolved = true;
            gameLog.push(`🚫 **SWATTED!** ${closestDefenderState.name} breaks up the pass to ${targetPlayerState.name}!`);
            playState.incomplete = true;
            playState.playIsLive = false;
        }
    }
    // --- ⭐️ END NEW LOGIC BLOCK (4b) ⭐️ ---


    // 4c. "Solo" Pass Breakup (PBU)
    // This is your original PBU block, now as a fallback.
    // This runs if:
    // 1. No INT (eventResolved is false)
    // 2. No Contested PBU (eventResolved is false)
    // 3. Defender is in range, but Receiver is NOT
    else if (!eventResolved && defenderInRange && !receiverInRange) {
        eventResolved = true; // The defender resolved this play
        gameLog.push(`🚫 **SWATTED!** Pass to ${targetPlayerState.name} is broken up by ${closestDefenderState.name}!`);
        playState.incomplete = true;
        playState.playIsLive = false;
    }

    // 5. Catch / Drop Attempt
    // This now only runs if:
    // 1. No INT
    // 2. No PBU (Contested or Solo)
    // 3. And Receiver is in range
    if (!eventResolved && receiverInRange && receiverPlayer?.attributes) {
        eventResolved = true; // Mark that we are resolving the play here
        const recCatchSkill = receiverPlayer.attributes.technical?.catchingHands || 50;
        const recConsistency = receiverPlayer.attributes.mental?.consistency || 50;
        let receiverPower = (recCatchSkill * 0.8 + recConsistency * 0.2) * targetPlayerState.fatigueModifier;

        // *** MODIFICATION 2: Broader, scaling interference logic ***
        let interferencePenalty = 0;
        const interferenceRadius = 2.0; // How close a defender needs to be to interfere (was 1.0)

        // NOTE: We check 'defenderInRange' again here. This is correct.
        // It's possible for the receiver to be in range (dist 2.4) and the
        // defender to be out of range (dist 2.6).
        if (defenderInRange && closestDefenderState) {
            const distToReceiver = getDistance(targetPlayerState, closestDefenderState);

            if (distToReceiver < interferenceRadius) { // Defender is in the receiver's space
                const defAgility = closestDefenderState.agility || 50;
                const defStrength = closestDefenderState.strength || 50;
                // Scale penalty: 100% at 0 yards, 0% at 2.0 yards
                const penaltyFactor = (1.0 - (distToReceiver / interferenceRadius));
                interferencePenalty = ((defAgility * 0.6 + defStrength * 0.2) / 3) * penaltyFactor;
            }
        }

        // We use distToBallRec from our new block, but re-calc just in case
        const receiverProximity = getDistance(targetPlayerState, playState.ballState);
        const proximityBonusRec = Math.max(0, (CATCH_CHECK_RADIUS - receiverProximity) * 15);
        receiverPower += proximityBonusRec;

        // --- Positional Interference ---
        let positionalPenalty = 0;
        if (interferencePenalty > 0 && closestDefenderState) {
            // Check if defender is "in front" (closer to offense's goal line: lower Y)
            if (closestDefenderState.y < targetPlayerState.y) {
                // Defender has inside position!
                positionalPenalty = 20; // 20-point penalty (makes catch harder)
            } else {
                // Defender is trailing
                positionalPenalty = -10; // 10-point *bonus* to the receiver
            }
        }

        // *** MODIFICATION 3: Stabilized difficulty check ***
        const catchRoll = receiverPower + getRandomInt(0, 20);
        // Apply *all* penalties to the difficulty
        const difficulty = interferencePenalty + positionalPenalty + 25 + getRandomInt(0, 10); // Base difficulty 25-35

        if (catchRoll > difficulty) { // Catch successful!
            targetPlayerState.isBallCarrier = true; targetPlayerState.hasBall = true;
            targetPlayerState.action = 'run_path';
            playState.yards = targetPlayerState.y - playState.lineOfScrimmage;
            if (interferencePenalty > 10) { // If there was significant interference
                gameLog.push(`👍 CATCH! ${targetPlayerState.name} (Catch: ${recCatchSkill}) makes a tough contested reception!`);
            } else {
                gameLog.push(`👍 CATCH! ${targetPlayerState.name} (Catch: ${recCatchSkill}) makes the reception!`);
            }

            // Tell all other offensive players to start blocking
            playState.activePlayers.forEach(p => {
                if (p.isOffense && p.id !== targetPlayerState.id) {
                    p.action = 'run_block'; // Set their action to 'run_block'
                }
            });

            ensureStats(receiverPlayer);
            receiverPlayer.gameStats.receptions = (receiverPlayer.gameStats.receptions || 0) + 1;
            const throwerPlayer = game.players.find(p => p && p.id === playState.ballState.throwerId);
            if (throwerPlayer) {
                ensureStats(throwerPlayer);
                throwerPlayer.gameStats.passCompletions = (throwerPlayer.gameStats.passCompletions || 0) + 1;
            }
        } else { // Drop / Incomplete
            // --- ⭐️ LOGIC FIX: We no longer check for PBU here ---
            // The PBU logic already ran. If we are here, it's just a drop.
            if (interferencePenalty > 10 || positionalPenalty > 0) {
                gameLog.push(`❌ **CONTESTED DROP!** Pass was on target to ${targetPlayerState.name} (Catch: ${recCatchSkill})!`);
            } else {
                gameLog.push(`❌ **DROPPED!** Pass was on target to ${targetPlayerState.name} (Catch: ${recCatchSkill})!`);
            }
            playState.incomplete = true; playState.playIsLive = false;
        }
    }

    // 6. Inaccurate Pass (Only if no INT and receiver was NOT in range)
    if (!eventResolved) {
        eventResolved = true;
        const distToReceiver = getDistance(playState.ballState, targetPlayerState);
        let accuracyMsg = "**off target**";
        // This logic is now less likely to be hit, but still good to have
        if (distToReceiver > 3.0) accuracyMsg = "**wildly off target**";
        else if (playState.ballState.x > targetPlayerState.x + 1.5) accuracyMsg = "**too far outside**";
        else if (playState.ballState.x < targetPlayerState.x - 1.5) accuracyMsg = "**too far inside**";
        else if (playState.ballState.y > targetPlayerState.y + 1.5) accuracyMsg = "**overthrown**";
        else if (playState.ballState.y < targetPlayerState.y - 1.5) accuracyMsg = "**underthrown**";

        gameLog.push(`‹‹ Pass to ${targetPlayerState?.name || 'receiver'} is ${accuracyMsg}. Incomplete.`);
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

// [in game.js]

/**
 * Simulates a single play using a coordinate-based tick system.
 */
/**
 * Simulates a single play using a coordinate-based tick system.
 */
function resolvePlay(offense, defense, offensivePlayKey, defensivePlayKey, gameState) {
    const { gameLog = [], weather, ballOn, ballHash = 'M', down, yardsToGo } = gameState;

    const play = deepClone(offensivePlaybook[offensivePlayKey]);

    if (!play) {
        console.error(`Play key "${offensivePlayKey}" not found...`);
        gameLog.push("CRITICAL ERROR: Play definition missing!");
        return { yards: 0, turnover: true, incomplete: false, touchdown: false, safety: false, log: gameLog, visualizationFrames: [] };
    }

    const { type } = play;
    let { assignments } = play;

    const playState = {
        playIsLive: true, tick: 0, maxTicks: 1000,
        yards: 0, touchdown: false, turnover: false, incomplete: false, sack: false, safety: false,
        ballState: { x: 0, y: 0, z: 1.0, vx: 0, vy: 0, vz: 0, targetPlayerId: null, inAir: false, throwerId: null, throwInitiated: false, targetX: 0, targetY: 0 },
        lineOfScrimmage: 0, activePlayers: [], blockBattles: [], visualizationFrames: []
    };
    let firstDownY = 0;

    try {
        // 💡 FIX: Calculate firstDownY correctly, clamping it to the goal line (110)
        const absoluteLoS_Y = ballOn + 10;
        const goalLineY = FIELD_LENGTH - 10; // This is 110
        firstDownY = Math.min(absoluteLoS_Y + (yardsToGo || 10), goalLineY);

        // We pass the raw 'ballOn' (e.g., 20) to setup
        setupInitialPlayerStates(playState, offense, defense, play, assignments, ballOn, defensivePlayKey, ballHash, offensivePlayKey);

        // 💡 FIX: setupInitialPlayerStates now sets the correct LoS (e.g., 30)
        // firstDownY is already correct (e.g., 40)

        if (playState.playIsLive) {
            const initialFrameData = {
                players: deepClone(playState.activePlayers),
                ball: deepClone(playState.ballState),
                logIndex: gameLog.length,
                lineOfScrimmage: playState.lineOfScrimmage,
                firstDownY: firstDownY,
                // Mark this first frame as the snap frame so the UI can render the ball
                isSnap: true
            };
            playState.visualizationFrames.push(initialFrameData);
        }
    } catch (setupError) {
        console.error("CRITICAL ERROR during setupInitialPlayerStates:", setupError);
        gameLog.push(`💥 CRITICAL ERROR: Play setup failed! ${setupError.message}`);
        return { yards: 0, turnover: true, incomplete: false, touchdown: false, safety: false, log: gameLog, visualizationFrames: [] };
    }

    if (!playState.activePlayers.some(p => p.slot === 'QB1' && p.isOffense)) {
        gameLog.push("No QB found for play. Turnover.");
        return { yards: 0, turnover: true, incomplete: false, touchdown: false, safety: false, log: gameLog, visualizationFrames: [] };
    }

    // --- RB "HOT ROUTE" AUDIBLE CHECK ---
    const defensePlay = defensivePlaybook[defensivePlayKey];
    const qbState = playState.activePlayers.find(p => p.slot === 'QB1' && p.isOffense);
    const qbPlayer = qbState ? game.players.find(p => p && p.id === qbState.id) : null;
    const qbIQ = qbPlayer?.attributes.mental.playbookIQ || 50;

    if (play.type === 'pass' &&
        defensePlay?.blitz === true &&
        play.assignments['RB1'] &&
        play.assignments['RB1'] !== 'pass_block' &&
        Math.random() < (qbIQ / 125)) {
        play.assignments['RB1'] = 'pass_block';
        assignments = play.assignments;

        const rbPlayer = playState.activePlayers.find(p => p.slot === 'RB1' && p.isOffense);
        gameLog.push(`[Pre-Snap]: 🧠 ${qbPlayer?.name || 'QB'} sees the blitz and keeps ${rbPlayer?.name || 'RB'} in to block!`);

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
        while (playState.playIsLive && playState.tick < playState.maxTicks) {
            playState.tick++;
            const timeDelta = TICK_DURATION_SECONDS;

            const offenseStates = playState.activePlayers.filter(p => p.isOffense);
            const defenseStates = playState.activePlayers.filter(p => !p.isOffense);
            ballCarrierState = playState.activePlayers.find(p => p.isBallCarrier);
            const ballPos = playState.ballState;

            // --- 💡 RE-ORDERED TICK LOOP 💡 ---

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
            // 💡 This now runs BEFORE tackles are checked.
            if (playState.playIsLive) {
                ballCarrierState = playState.activePlayers.find(p => p.isBallCarrier);
                if (ballCarrierState) {
                    // Check for Touchdown (in either endzone)
                    if (ballCarrierState.y >= FIELD_LENGTH - 10 && ballCarrierState.isOffense) { // Offensive TD
                        playState.yards = ballCarrierState.y - playState.lineOfScrimmage;
                        playState.touchdown = true; playState.playIsLive = false;
                        const scorer = game.players.find(p => p && p.id === ballCarrierState.id);
                        gameLog.push(`🎉 TOUCHDOWN ${scorer?.name || 'player'}!`);
                        break; // <-- This break is critical
                    } else if (ballCarrierState.y < 10 && !ballCarrierState.isOffense) { // Defensive TD
                        playState.yards = 0;
                        playState.touchdown = true; playState.playIsLive = false;
                        const scorer = game.players.find(p => p && p.id === ballCarrierState.id);
                        gameLog.push(`🎉 DEFENSIVE TOUCHDOWN ${scorer?.name || 'player'}!`);
                        break; // <-- This break is critical
                    } else if (ballCarrierState.y < 10 && ballCarrierState.isOffense) { // SAFETY
                        playState.yards = 0;
                        playState.safety = true;
                        playState.playIsLive = false;
                        gameLog.push(`SAFETY! ${ballCarrierState.name} was tackled in the endzone!`);
                        break; // <-- This break is critical
                    }
                    // Check for Out of Bounds (Sidelines)
                    if (ballCarrierState.x <= 0.1 || ballCarrierState.x >= FIELD_WIDTH - 0.1) {
                        playState.yards = ballCarrierState.y - playState.lineOfScrimmage;
                        playState.playIsLive = false;
                        gameLog.push(` sidelines... ${ballCarrierState.name} ran out of bounds after a gain of ${playState.yards.toFixed(1)} yards.`);
                        break; // <-- This break is critical
                    }
                }
            }

            // --- STEP 7: Check Collisions & Resolve Catches/Incompletions ---
            // These checks will NOT run if a TD/OOB/Safety just happened.
            if (playState.playIsLive) {
                // A. Check for new block engagements
                checkBlockCollisions(playState);

                // B. Check for tackles
                ballCarrierState = playState.activePlayers.find(p => p.isBallCarrier);
                if (ballCarrierState) {
                    if (checkTackleCollisions(playState, gameLog)) break; // Play ended from tackle/fumble
                }

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

                    // D. Check for Ground / Out of Bounds (if not caught)
                    if (playState.playIsLive) {
                        if (ballPos.z <= 0.1 && playState.tick > 6) {
                            gameLog.push(`‹‹ Pass hits the ground. Incomplete.`);
                            playState.incomplete = true; playState.playIsLive = false; ballPos.inAir = false;
                            break;
                        }
                        if (ballPos.x <= 0.1 || ballPos.x >= FIELD_WIDTH - 0.1 || ballPos.y >= FIELD_LENGTH - 0.1 || ballPos.y <= 0.1) {
                            gameLog.push(`‹‹ Pass sails out of bounds. Incomplete.`);
                            playState.incomplete = true; playState.playIsLive = false; ballPos.inAir = false;
                            break;
                        }
                    }
                }
            }
            if (!playState.playIsLive) break; // Final check before next loop iteration

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
                    const stamina = player.attributes?.physical?.stamina || 50;
                    const fatigueRatio = Math.min(1.0, (player.fatigue || 0) / stamina);
                    pState.fatigueModifier = Math.max(0.3, 1.0 - fatigueRatio);
                }
            });

            // --- BENCH RECOVERY: players not active this play slowly recover fatigue ---
            try {
                const activeIds = new Set(playState.activePlayers.filter(p => p).map(p => p.id));
                const BENCH_RECOVERY_PER_TICK = 0.003; // very slow recovery per simulation tick/play
                game.players.forEach(p => {
                    if (!p) return;
                    if (p.status && p.status.duration > 0) return; // injured/busy don't recover normally
                    if (activeIds.has(p.id)) return; // skip active players
                    if ((p.fatigue || 0) <= 0) return; // nothing to recover
                    p.fatigue = Math.max(0, (p.fatigue || 0) - BENCH_RECOVERY_PER_TICK);
                });
            } catch (err) {
                console.error('Bench recovery error:', err);
            }

            // --- AI SUBSTITUTIONS: allow AI teams involved in the play to occasionally auto-sub ---
            try {
                const involvedTeamIds = new Set(playState.activePlayers.filter(p => p && p.teamId).map(p => p.teamId));
                involvedTeamIds.forEach(tid => {
                    const team = game.teams.find(tt => tt && tt.id === tid);
                    if (!team) return;
                    // Do not auto-sub the player's team (human-controlled)
                    if (game.playerTeam && team.id === game.playerTeam.id) return;
                    // Allow AI to make substitutions occasionally when fatigued
                    autoMakeSubstitutions(team, { thresholdFatigue: 60, maxSubs: 2, chance: 0.2 });
                });
            } catch (err) {
                console.error('AI substitution error:', err);
            }

            // --- STEP 10: Record Visualization Frame ---
            const frameData = {
                players: deepClone(playState.activePlayers),
                ball: deepClone(ballPos),
                logIndex: gameLog.length,
                lineOfScrimmage: playState.lineOfScrimmage,
                firstDownY: firstDownY
            };
            playState.visualizationFrames.push(frameData);

        } // --- End TICK LOOP ---
    } catch (tickError) {
        console.error("CRITICAL ERROR during simulation tick loop:", tickError);
        gameLog.push(`CRITICAL ERROR: Simulation failed mid-play. ${tickError.message}`);
        playState.playIsLive = false;
        playState.incomplete = true;
    }

    // --- 4. Finalize Results ---
    // (This logic is now run *after* the loop, ensuring TD/Tackle priority)
    if (playState.playIsLive && !playState.touchdown && !playState.safety) {
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
    if (playState.sack) { playState.yards = Math.min(0, playState.yards); }
    if (playState.incomplete || (playState.turnover && !playState.touchdown) || playState.safety) {
        playState.yards = 0;
    }

    // 💡 This check is now redundant but safe. The TD check in the loop sets the yards.
    if (playState.touchdown && !playState.turnover) { // Offensive TD
        // Ensure yards are set to at least the yards to the goal line
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


// =============================================================
// --- GAME SIMULATION ---
// =============================================================

/**
 * Determines the offensive play call based on game situation, personnel, and matchups.
 */
function determinePlayCall(offense, defense, down, yardsToGo, ballOn, scoreDiff, gameLog, drivesRemaining) {
    // --- 1. Validate Inputs ---
    if (!offense?.roster || !defense?.roster || !offense?.formations?.offense || !defense?.formations?.defense || !offense?.coach) {
        console.error("determinePlayCall: Invalid team data provided.");
        return 'Balanced_InsideRun'; // Safe fallback
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

    // --- 2. Calculate Average Positional Strengths ---
    // Helper to get average overall for a position group (using active players if possible, else roster)
    const getAvgOverall = (team, positions) => {
        // Ideally, use players currently on field, but roster average is a good proxy
        const players = team.roster.filter(p => p && (positions.includes(p.favoriteOffensivePosition) || positions.includes(p.favoriteDefensivePosition)));
        if (players.length === 0) return 40; // Default low score if no players found
        const totalOvr = players.reduce((sum, p) => sum + calculateOverall(p, positions[0]), 0); // Use first pos in list for calc
        return totalOvr / players.length;
    };

    const avgQbOvr = getAvgOverall(offense, ['QB']);
    const avgRbOvr = getAvgOverall(offense, ['RB']);
    const avgWrOvr = getAvgOverall(offense, ['WR']);
    const avgOlOvr = getAvgOverall(offense, ['OL']);
    const avgDlOvr = getAvgOverall(defense, ['DL']);
    const avgLbOvr = getAvgOverall(defense, ['LB']);
    const avgDbOvr = getAvgOverall(defense, ['DB']);

    // --- 3. Determine Base Pass Chance (Situational Factors) ---
    let passChance = 0.45; // Base inclination

    // Down & Distance
    if (down === 3 && yardsToGo >= 7) passChance += 0.35;
    else if (down === 3 && yardsToGo >= 4) passChance += 0.20;
    else if (down === 4 && yardsToGo >= 4) passChance = 0.90; // Must pass if long
    else if (down === 4 && yardsToGo >= 2) passChance = 0.60; // Likely pass if medium
    else if (yardsToGo <= 2) passChance -= 0.35; // Short yardage favors run

    // Field Position (Red Zone)
    if (ballOn > 85) passChance -= 0.15; // Closer to endzone, slightly favors run/quick pass
    if (ballOn > 95) passChance -= 0.25; // Goal line heavily favors run

    // Game Situation (Score & Time)
    const totalDrivesPerHalf = 8; // Approx
    const isLateGame = drivesRemaining <= 3; // Adjusted threshold
    const isEndOfHalf = (drivesRemaining % totalDrivesPerHalf <= 1) && drivesRemaining <= totalDrivesPerHalf;
    const urgencyFactor = isLateGame || isEndOfHalf;

    if (scoreDiff < -14) passChance += (urgencyFactor ? 0.4 : 0.25); // Trailing big
    else if (scoreDiff < -7) passChance += (urgencyFactor ? 0.25 : 0.15); // Trailing
    if (scoreDiff > 10 && urgencyFactor) passChance -= 0.4; // Leading big, late -> run clock
    else if (scoreDiff > 4 && urgencyFactor) passChance -= 0.2; // Leading moderately, late -> lean run

    // --- 4. Adjust Pass Chance based on Matchups & Personnel ---

    // Personnel Mismatch (Offense Formation vs Defense Formation)
    const offWRs = offenseFormation.personnel.WR || 0;
    const defDBs = defenseFormation.personnel.DB || 0;
    const offHeavy = (offenseFormation.personnel.RB || 0) + (offenseFormation.personnel.OL || 0);
    const defBox = (defenseFormation.personnel.DL || 0) + (defenseFormation.personnel.LB || 0);

    if (offWRs > defDBs + 1) passChance += 0.15; // Significant WR advantage vs DBs
    if (offHeavy > defBox + 1) passChance -= 0.15; // Significant blocking advantage vs Box

    // Player Quality Matchup
    if (avgWrOvr > avgDbOvr + 15) passChance += 0.20; // Big WR advantage
    else if (avgWrOvr > avgDbOvr + 7) passChance += 0.10;
    if (avgDbOvr > avgWrOvr + 10) passChance -= 0.15; // Big DB advantage

    if (avgOlOvr > (avgDlOvr + avgLbOvr) / 2 + 10) passChance -= 0.10; // OL dominates front -> easier runs
    if ((avgDlOvr + avgLbOvr) / 2 > avgOlOvr + 15) passChance += 0.15; // Front dominates OL -> harder runs

    // QB vs RB Strength
    if (avgQbOvr < 55 && avgRbOvr > 60) passChance -= 0.15; // Weak QB, rely on RB
    if (avgRbOvr < 55 && avgQbOvr > 60) passChance += 0.10; // Weak RB, rely on QB
    if (avgQbOvr > avgRbOvr + 15) passChance += 0.05;
    if (avgRbOvr > avgQbOvr + 15) passChance -= 0.05;

    // Coach Tendency
    // --- Run-Heavy Coaches ---
    if (coach.type === 'Ground and Pound') passChance -= 0.20;
    if (coach.type === 'Trench Warfare') passChance -= 0.25; // Even more run-focused

    // --- Pass-Happy Coaches ---
    if (coach.type === 'West Coast Offense') passChance += 0.10; // WCO often short passes
    if (coach.type === 'Youth Scout') passChance += 0.10; // Prefers Spread
    if (coach.type === 'Skills Coach') passChance += 0.20; // Wants to use his playmakers
    if (coach.type === 'Air Raid') passChance += 0.35; // Very pass-heavy

    // Clamp final chance
    passChance = Math.max(0.05, Math.min(0.95, passChance));

    // --- 5. Determine Play Type (Pass or Run) ---
    let desiredPlayType = (Math.random() < passChance) ? 'pass' : 'run';

    // --- 6. Select Specific Play ---
    const formationPlays = Object.keys(offensivePlaybook).filter(key => key.startsWith(offenseFormationName));
    if (formationPlays.length === 0) {
        console.error(`CRITICAL: No plays found for formation ${offenseFormationName}!`);
        return 'Balanced_InsideRun'; // Fallback
    }

    // Short Yardage Special Case (QB Sneak / Power Run)
    if (yardsToGo <= 1 && Math.random() < 0.7) { // High chance for sneak/power in short yardage
        if (avgQbOvr > 60 && Math.random() < 0.5) { // If decent QB, consider sneak
            const sneakPlay = formationPlays.find(p => offensivePlaybook[p]?.tags?.includes('sneak')); // Need a sneak play tag
            if (sneakPlay) return sneakPlay;
        }
        // Prioritize Power runs if available
        const powerPlays = formationPlays.filter(p => offensivePlaybook[p]?.tags?.includes('power') && offensivePlaybook[p]?.type === 'run');
        if (powerPlays.length > 0) return getRandom(powerPlays);
        // Fallback to any inside run
        const insideRuns = formationPlays.filter(p => offensivePlaybook[p]?.tags?.includes('inside') && offensivePlaybook[p]?.type === 'run');
        if (insideRuns.length > 0) return getRandom(insideRuns);
        // If absolutely nothing else, default back to desired type
    }


    // Filter plays matching the desired type (pass/run)
    let possiblePlays = formationPlays.filter(key => offensivePlaybook[key]?.type === desiredPlayType);

    // If no plays of desired type exist (shouldn't happen with good playbook), switch type
    if (possiblePlays.length === 0) {
        desiredPlayType = (desiredPlayType === 'pass' ? 'run' : 'pass');
        possiblePlays = formationPlays.filter(key => offensivePlaybook[key]?.type === desiredPlayType);
        if (possiblePlays.length === 0) return formationPlays[0]; // Absolute fallback
    }

    let chosenPlay = null;

    // --- Basic Read of Defensive Personnel ---
    const isHeavyBox = defBox >= 5; // e.g., 4-2-1 or 3-1-3 (3DL+3LB=6) qualifies
    const isLightBox = defBox <= 3; // e.g., 2-3-2 (2DL+3LB=5, but LBs might be spread) - Needs refinement
    const hasManyDBs = defDBs >= 2;

    // --- Refined Play Selection (with Smart Variety) ---

    if (desiredPlayType === 'pass') {
        const deepPlays = possiblePlays.filter(p => offensivePlaybook[p]?.tags?.includes('deep'));
        const shortPlays = possiblePlays.filter(p => offensivePlaybook[p]?.tags?.includes('short') || offensivePlaybook[p]?.tags?.includes('screen'));
        const mediumPlays = possiblePlays.filter(p => !deepPlays.includes(p) && !shortPlays.includes(p));

        let weightedOptions = [];

        // --- 1. Define the Situation ---
        const isLongPass = yardsToGo >= 8;
        const isShortPass = yardsToGo <= 4;

        // --- 2. Build Weighted List based on Situation ---
        if (isLongPass) {
            // Obvious "Long" down: NO short plays.
            weightedOptions.push(...(deepPlays || []), ...(deepPlays || [])); // Heavily weight deep
            weightedOptions.push(...(mediumPlays || []));                     // Also allow medium
        } else if (isShortPass) {
            // Obvious "Short" down: NO deep plays.
            weightedOptions.push(...(shortPlays || []), ...(shortPlays || [])); // Heavily weight short
            weightedOptions.push(...(mediumPlays || []));                       // Also allow medium
        } else {
            // "Normal" down (e.g., 1st & 10, 2nd & 7): Add ALL options for variety.
            weightedOptions.push(...(deepPlays || []));
            weightedOptions.push(...(mediumPlays || []));
            weightedOptions.push(...(shortPlays || []));
        }

        // --- 3. Adjust based on defense (this logic is still good) ---
        if (isHeavyBox && shortPlays.length > 0) weightedOptions.push(...shortPlays); // Add more short vs heavy box
        if (hasManyDBs && mediumPlays.length > 0) weightedOptions.push(...mediumPlays); // Add more medium vs many DBs

        // --- 4. Select Play ---
        if (weightedOptions.length === 0) {
            // Fallback: If no situation met (e.g., only have 'short' plays on 3rd & 10)
            // just pick from any available pass play.
            weightedOptions.push(...possiblePlays);
        }
        chosenPlay = getRandom(weightedOptions);

    } else { // Run
        const insidePlays = possiblePlays.filter(p => offensivePlaybook[p]?.tags?.includes('inside'));
        const outsidePlays = possiblePlays.filter(p => offensivePlaybook[p]?.tags?.includes('outside'));
        const powerPlays = possiblePlays.filter(p => offensivePlaybook[p]?.tags?.includes('power'));

        let weightedOptions = [];

        // --- 1. Define the Situation ---
        const isShortYardage = yardsToGo <= 2;

        // --- 2. Adjust based on defense FIRST ---
        if (isLightBox) weightedOptions.push(...(insidePlays || []), ...(insidePlays || [])); // Attack light box
        if (isHeavyBox) weightedOptions.push(...(outsidePlays || [])); // Bounce outside

        // --- 3. Build Weighted List based on Situation ---
        if (isShortYardage) {
            // Obvious "Short" down: NO outside plays (dumb call).
            weightedOptions.push(...(powerPlays || []), ...(powerPlays || [])); // Heavily weight power
            weightedOptions.push(...(insidePlays || []));                       // Also allow inside
        } else {
            // "Normal" run down: Add ALL options for variety.
            weightedOptions.push(...(insidePlays || []));
            weightedOptions.push(...(outsidePlays || []));
            weightedOptions.push(...(powerPlays || []));
        }

        // --- 4. Add player strength factor ---
        if (avgRbOvr > 65 && outsidePlays.length > 0 && Math.random() < 0.4) weightedOptions.push(...outsidePlays);

        // --- 5. Select Play ---
        if (weightedOptions.length === 0) {
            // Fallback: just pick from any available run play.
            weightedOptions.push(...possiblePlays);
        }
        chosenPlay = getRandom(weightedOptions);
    }

    // Final fallback
    chosenPlay = chosenPlay || getRandom(possiblePlays) || formationPlays[0];
    // gameLog.push(`Off Play Call: ${chosenPlay} (Pass Chance: ${passChance.toFixed(2)})`); // Optional: Log decision
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
        return 'Cover_2_Zone_331'; // Need a safe, common fallback (adjust if needed)
    }
    const defenseFormationName = defense.formations.defense;
    const defenseFormation = defenseFormations[defenseFormationName];
    if (!defenseFormation) {
        console.error(`CRITICAL ERROR: Defensive formation data missing for ${defense.name} (${defenseFormationName}).`);
        return 'Cover_2_Zone_331'; // Fallback
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
        return allPlays.length > 0 ? getRandom(allPlays) : 'Cover_2_Zone_331'; // Absolute fallback
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
        chosenPlay = availablePlays[0] || 'Cover_2_Zone_331';
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

/**
 * AI logic for the QB to check the defensive play and audible.
 * @returns {{playKey: string, didAudible: boolean}}
 */
function aiCheckAudible(offense, offensivePlayKey, defense, defensivePlayKey, gameLog) {
    const offensePlay = offensivePlaybook[offensivePlayKey];
    const defensePlay = defensivePlaybook[defensivePlayKey];
    const qb = offense.roster.find(p => p.id === offense.depthChart.offense.QB1);
    // Defensive: use optional chaining for nested attributes to avoid runtime errors
    const qbIQ = qb?.attributes?.mental?.playbookIQ ?? 50;

    if (!offensePlay || !defensePlay || !qb) {
        return { playKey: offensivePlayKey, didAudible: false };
    }

    const iqChance = qbIQ / 150; // 75 IQ = 50% chance to recognize
    let newPlayKey = offensivePlayKey;
    let didAudible = false;

    // 1. Check: Run play vs. a stacked box (Run Stop or All-Out Blitz)
    if (offensePlay.type === 'run' && (defensePlay.concept === 'Run' || (defensePlay.blitz && defensePlay.concept === 'Man'))) {
        if (Math.random() < iqChance) {
            const audibleTo = findAudiblePlay(offense, 'pass', 'short'); // Audible to a quick pass
            if (audibleTo) {
                newPlayKey = audibleTo;
                didAudible = true;
                gameLog.push(`[Audible]: 🧠 ${qb.name} sees the stacked box and audibles to a pass!`);
            }
        }
    }
    // 2. Check: Pass play vs. a safe zone (no blitz, 'Zone' concept)
    else if (offensePlay.type === 'pass' && (defensePlay.blitz === false && defensePlay.concept === 'Zone')) {
        // Good matchup, but maybe we can do better?
        // Check if it's a "deep" pass vs. a soft "safeZone"
        if (offensePlay.tags?.includes('deep') && Math.random() < iqChance) {
            // Smart QB checks down to a run play
            const audibleTo = findAudiblePlay(offense, 'run', 'inside');
            if (audibleTo) {
                newPlayKey = audibleTo;
                didAudible = true;
                gameLog.push(`[Audible]: 🧠 ${qb.name} sees the soft zone and audibles to a run!`);
            }
        }
    }

    return { playKey: newPlayKey, didAudible };
}



/**
 * Simulates a full game between two teams.
 */
export function simulateGame(homeTeam, awayTeam, options = {}) {
    // options: { fastSim: boolean } -- if true, minimize logging and skip visualization frames
    const fastSim = options.fastSim === true;
    // Patch: If fastSim, override TICK_DURATION_SECONDS for this simulation
    let originalTickDuration = TICK_DURATION_SECONDS;
    // Declare result variable outside the try block
    let gameResult;

    try {
        if (fastSim) {
            // Directly modify the module-level 'let'
            TICK_DURATION_SECONDS = 0.005;
        }
        if (!homeTeam || !awayTeam || !homeTeam.roster || !awayTeam.roster) {
            if (!fastSim) console.error("simulateGame: Invalid team data provided.");
            return { homeTeam, awayTeam, homeScore: 0, awayScore: 0, gameLog: ["Error: Invalid team data"], breakthroughs: [] };
        }
        resetGameStats();
        aiSetDepthChart(homeTeam);
        aiSetDepthChart(awayTeam);

        const gameLog = []; // ALWAYS create a log array
        const allVisualizationFrames = fastSim ? null : [];
        let homeScore = 0, awayScore = 0;
        const weather = getRandom(['Sunny', 'Windy', 'Rain']);
        if (!fastSim) gameLog.push(`Weather: ${weather}`);

        const breakthroughs = [];

        // 💡 THE FIX (from last time): Use fewer drives
        const totalDrivesPerHalf = getRandomInt(4, 5);

        let currentHalf = 1, drivesThisGame = 0;
        let nextDriveStartBallOn = 20; // Track starting field position

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
                [...homeTeam.roster, ...awayTeam.roster].forEach(p => { if (p) p.fatigue = Math.max(0, (p.fatigue || 0) - 40); });
                if (!fastSim) gameLog.push(`-- Second Half Kickoff: ${possessionTeam.name} receives --`);
                nextDriveStartBallOn = 20; // Reset for kickoff
            }

            if (!possessionTeam) {
                console.error("Possession team is null! Ending game loop."); break;
            }
            const offense = possessionTeam;
            const defense = (possessionTeam.id === homeTeam.id) ? awayTeam : homeTeam;

            // ... (Forfeit check logic is unchanged) ...
            const checkRoster = (team) => (team?.roster || []).filter(p => p && p.status?.duration === 0).length < MIN_HEALTHY_PLAYERS;
            if (checkRoster(offense) || checkRoster(defense)) {
                const forfeitingTeam = checkRoster(offense) ? offense : defense;
                const winningTeam = forfeitingTeam === offense ? defense : offense;
                gameLog.push(`❗ ${forfeitingTeam.name} cannot field enough healthy players (${MIN_HEALTHY_PLAYERS}) and forfeits.`);
                if (winningTeam === homeTeam) { homeScore = 21; awayScore = 0; } else { homeScore = 0; awayScore = 21; }
                gameForfeited = true;
                break;
            }

            let ballOn = nextDriveStartBallOn, down = 1, yardsToGo = 10, driveActive = true;
            let ballHash = 'M';
            gameLog.push(`-- Drive ${drivesThisGame + 1} (H${currentHalf}): ${offense.name} ball on own ${ballOn} --`);

            while (driveActive && down <= 4) {
                // ... (Forfeit check logic is unchanged) ...
                if (offense.roster.filter(p => p && p.status?.duration === 0).length < MIN_HEALTHY_PLAYERS ||
                    defense.roster.filter(p => p && p.status?.duration === 0).length < MIN_HEALTHY_PLAYERS) {
                    gameLog.push("Forfeit condition met mid-drive."); gameForfeited = true; driveActive = false; break;
                }

                if (!fastSim) {
                    const yardLineText = ballOn <= 50 ? `own ${ballOn}` : `opponent ${100 - ballOn}`;
                    gameLog.push(`--- ${down}${down === 1 ? 'st' : down === 2 ? 'nd' : down === 3 ? 'rd' : 'th'} & ${yardsToGo <= 0 ? 'Goal' : yardsToGo} from the ${yardLineText} ---`);
                }

                // ... (Pre-snap AI and play-call logic is unchanged) ...
                const scoreDiff = offense.id === homeTeam.id ? homeScore - awayScore : awayScore - homeScore;
                const drivesCompletedInHalf = drivesThisGame % totalDrivesPerHalf;
                const drivesRemainingInHalf = totalDrivesPerHalf - drivesCompletedInHalf;
                const drivesRemainingInGame = (currentHalf === 1 ? totalDrivesPerHalf : 0) + drivesRemainingInHalf;
                const offensivePlayKey_initial = determinePlayCall(offense, defense, down, yardsToGo, ballOn, scoreDiff, fastSim ? null : gameLog, drivesRemainingInGame);
                const offenseFormationName = offense.formations.offense;
                const defensiveFormationName = determineDefensiveFormation(defense, offenseFormationName, down, yardsToGo);
                defense.formations.defense = defensiveFormationName;
                const defensivePlayKey = determineDefensivePlayCall(defense, offense, down, yardsToGo, ballOn, scoreDiff, fastSim ? null : gameLog, drivesRemainingInGame);
                const audibleResult = aiCheckAudible(offense, offensivePlayKey_initial, defense, defensivePlayKey, fastSim ? null : gameLog);
                const offensivePlayKey = audibleResult.playKey;
                if (!fastSim) {
                    const offPlayName = offensivePlayKey.split('_').slice(1).join(' ');
                    const defPlayName = defensivePlaybook[defensivePlayKey]?.name || defensivePlayKey;
                    gameLog.push(`🏈 **Offense:** ${offPlayName} ${audibleResult.didAudible ? '(Audible)' : ''}`);
                    gameLog.push(`🛡️ **Defense:** ${defPlayName}`);
                }

                // --- 5. "Snap" ---
                const result = resolvePlay(offense, defense, offensivePlayKey, defensivePlayKey, { gameLog: gameLog, weather, ballOn, ballHash, down, yardsToGo });
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

                // --- (Post-play logic from your previous version) ---
                if (result.turnover) {
                    driveActive = false;
                    nextDriveStartBallOn = 100 - ballOn; // Flipped field
                } else if (result.safety) {
                    if (!fastSim) gameLog.push(`SAFETY! 2 points for ${defense.name}!`);
                    if (defense.id === homeTeam.id) homeScore += 2; else awayScore += 2;
                    driveActive = false;
                    nextDriveStartBallOn = 20;
                } else if (result.touchdown) {
                    const wasOffensiveTD = !result.turnover;

                    if (wasOffensiveTD) {
                        // --- OFFENSIVE TD: Run the conversion attempt ---
                        ballOn = 100; // Mark the touchdown

                        // --- 1. Decide Conversion Type ---
                        const goesForTwo = Math.random() > 0.85; // 15% chance to go for 2
                        const points = goesForTwo ? 2 : 1;
                        const conversionBallOn = goesForTwo ? 95 : 98; // 2pt from 5-yd line, 1pt from 2-yd line
                        const conversionYardsToGo = 100 - conversionBallOn; // Yards needed (5 or 2)

                        if (!fastSim) gameLog.push(`--- ${points}-Point Conversion Attempt (from the ${conversionYardsToGo}-yd line) ---`);

                        // --- 2. Call the Play ---
                        const conversionOffensePlayKey = determinePlayCall(offense, defense, 1, conversionYardsToGo, conversionBallOn, scoreDiff, gameLog, drivesRemainingInGame);
                        const conversionDefenseFormation = determineDefensiveFormation(defense, offense.formations.offense, 1, conversionYardsToGo);
                        defense.formations.defense = conversionDefenseFormation;
                        const conversionDefensePlayKey = determineDefensivePlayCall(defense, offense, 1, conversionYardsToGo, conversionBallOn, scoreDiff, gameLog, drivesRemainingInGame);

                        // Log the conversion play calls
                        if (!fastSim) {
                            const offPlayName = conversionOffensePlayKey.split('_').slice(1).join(' ');
                            const defPlayName = defensivePlaybook[conversionDefensePlayKey]?.name || defensivePlayKey;
                            gameLog.push(`🏈 **Offense:** ${offPlayName}`);
                            gameLog.push(`🛡️ **Defense:** ${defPlayName}`);
                        }

                        // --- 3. Resolve the Play ---
                        const conversionResult = resolvePlay(offense, defense, conversionOffensePlayKey, conversionDefensePlayKey, {
                            gameLog: fastSim ? null : gameLog,
                            weather,
                            ballOn: conversionBallOn,
                            ballHash: 'M',
                            down: 1,
                            yardsToGo: conversionYardsToGo
                        });

                        // --- 4. Add Visualization Frames ---
                        if (!fastSim && conversionResult.visualizationFrames) {
                            allVisualizationFrames.push(...conversionResult.visualizationFrames);
                        }

                        // --- 5. Tally Score ---
                        // First, award 6 points for the initial touchdown
                        if (offense.id === homeTeam.id) homeScore += 6; else awayScore += 6;

                        // Now, handle *only* the conversion points
                        if (conversionResult.touchdown) {
                            if (!conversionResult.turnover) {
                                // --- 1. OFFENSE scored the conversion ---
                                if (!fastSim) gameLog.push(`✅ ${points}-point conversion GOOD!`);
                                if (offense.id === homeTeam.id) homeScore += points; else awayScore += points;
                            } else {
                                // --- 2. DEFENSE scored on a turnover (Defensive 2-pt) ---
                                if (!fastSim) gameLog.push(`❌ ${points}-point conversion FAILED... AND RETURNED!`);
                                if (defense.id === homeTeam.id) homeScore += 2; else awayScore += 2;
                            }
                        } else {
                            // --- 3. No TD on conversion (Failed attempt) ---
                            if (!fastSim) gameLog.push(`❌ ${points}-point conversion FAILED!`);
                        }

                    } else {
                        // --- DEFENSIVE TD: No conversion, just add 6 ---
                        if (!fastSim) gameLog.push(`DEFENSIVE TOUCHDOWN! 6 points for ${defense.name}!`); // 💡 Added log
                        if (defense.id === homeTeam.id) homeScore += 6; else awayScore += 6;
                    }

                    // 💡 FIX: These lines now run for BOTH offensive and defensive TDs,
                    // ensuring the drive always ends after any touchdown.
                    driveActive = false;
                    nextDriveStartBallOn = 20; // After any TD, the next drive is a "kickoff"
                } else if (result.incomplete) {
                    down++;
                } else { // Completed play

                    // 💡 FIX: Check if we are ALREADY in a goal-to-go situation
                    const wasGoalToGo = (yardsToGo < 10);

                    yardsToGo -= result.yards;

                    if (yardsToGo <= 0) { // First down
                        down = 1;

                        const yardsToGoalLine = 100 - ballOn;

                        if (yardsToGoalLine <= 10) {
                            // We are now 1st & Goal
                            yardsToGo = yardsToGoalLine;
                        } else {
                            // Normal 1st & 10
                            yardsToGo = 10;
                        }

                        // Failsafe for being on the goal line.
                        // This prevents "yards to go" from being 0.
                        if (yardsToGo <= 0) yardsToGo = 1;

                        if (!fastSim) {
                            const newYardLineText = ballOn <= 50 ? `own ${ballOn}` : `opponent ${100 - ballOn}`;
                            gameLog.push(`➡️ First down ${offense.name}! ${yardsToGoalLine <= 10 ? `1st & Goal at the ${yardsToGoalLine}` : `1st & 10 at the ${newYardLineText}`}.`);
                        }

                    } else { // Not a first down
                        down++;
                        // 💡 FIX: If it was Goal-to-go, it's *still* Goal-to-go
                        // This ensures the log text is correct.
                        if (wasGoalToGo) {
                            yardsToGo = 100 - ballOn; // e.g., 3rd & Goal at the 2
                        }
                    }
                }

                if (down > 4 && driveActive) {
                    if (!fastSim) {
                        const finalYardLineText = ballOn <= 50 ? `own ${ballOn}` : `opponent ${100 - ballOn}`;
                        gameLog.push(`✋ Turnover on downs! ${defense.name} takes over at the ${finalYardLineText}.`);
                    }
                    driveActive = false;
                    nextDriveStartBallOn = 100 - ballOn; // Flipped field
                }
            } // --- End Play Loop ---

            drivesThisGame++;
            if (drivesThisGame < totalDrivesPerHalf * 2 && !gameForfeited) {
                possessionTeam = (possessionTeam?.id === homeTeam.id) ? awayTeam : homeTeam;
            }
        } // --- End Game Loop ---


        // --- 💡 NEW: OVERTIME TIEBREAKER LOGIC 💡 ---
        if (homeScore === awayScore && !gameForfeited) {
            if (!fastSim) {
                gameLog.push(`==== GAME TIED: ${homeScore}-${awayScore} ====`);
                gameLog.push(`Heading to Sudden Death Overtime!`);
            }

            let overtimeRound = 0;
            let isStillTied = true;

            // Possession order: "Receiving team of the second half" goes first.
            let otPossessionOrder = [receivingTeamSecondHalf, (receivingTeamSecondHalf.id === homeTeam.id) ? awayTeam : homeTeam];

            while (isStillTied && overtimeRound < 10) { // Safety break after 10 rounds
                overtimeRound++;

                // Round 1: 5yd line (ballOn = 95)
                // Round 2: 10yd line (ballOn = 90), etc.
                const yardsFromGoal = 5 * overtimeRound;
                const startBallOn = 100 - yardsFromGoal;

                if (!fastSim) gameLog.push(`--- OT Round ${overtimeRound}: Ball at the ${yardsFromGoal}-yard line ---`);

                for (const offense of otPossessionOrder) {
                    const defense = (offense.id === homeTeam.id) ? awayTeam : homeTeam;

                    // If a defensive score on the first possession won the game, break
                    if (homeScore !== awayScore) {
                        isStillTied = false;
                        break;
                    }

                    // --- Start OT Drive ---
                    let ballOn = startBallOn;
                    let down = 1;
                    let yardsToGo = 100 - ballOn; // Always Goal-to-go
                    let driveActive = true;
                    let ballHash = 'M';
                    gameLog.push(`OT Possession: ${offense.name}`);

                    while (driveActive && down <= 4) {
                        const yardLineText = `opponent ${100 - ballOn}`;
                        gameLog.push(`--- ${down} & ${yardsToGo <= 0 ? 'Goal' : yardsToGo} from the ${yardLineText} ---`);

                        const scoreDiff = offense.id === homeTeam.id ? homeScore - awayScore : awayScore - homeScore;
                        const drivesRemainingInGame = 0; // No time left

                        // (Run the same pre-snap AI logic)
                        const offensivePlayKey_initial = determinePlayCall(offense, defense, down, yardsToGo, ballOn, scoreDiff, gameLog, drivesRemainingInGame);
                        const offenseFormationName = offense.formations.offense;
                        const defensiveFormationName = determineDefensiveFormation(defense, offenseFormationName, down, yardsToGo);
                        defense.formations.defense = defensiveFormationName;
                        const defensivePlayKey = determineDefensivePlayCall(defense, offense, down, yardsToGo, ballOn, scoreDiff, gameLog, drivesRemainingInGame);
                        const audibleResult = aiCheckAudible(offense, offensivePlayKey_initial, defense, defensivePlayKey, gameLog);
                        const offensivePlayKey = audibleResult.playKey;
                        const offPlayName = offensivePlayKey.split('_').slice(1).join(' ');
                        const defPlayName = defensivePlaybook[defensivePlayKey]?.name || defensivePlayKey;
                        gameLog.push(`🏈 **Offense:** ${offPlayName} ${audibleResult.didAudible ? '(Audible)' : ''}`);
                        gameLog.push(`🛡️ **Defense:** ${defPlayName}`);

                        // --- 5. "Snap" ---
                        const result = resolvePlay(offense, defense, offensivePlayKey, defensivePlayKey, { gameLog, weather, ballOn, ballHash, down, yardsToGo });
                        if (result.visualizationFrames) allVisualizationFrames.push(...result.visualizationFrames);
                        if (!result.incomplete && result.visualizationFrames?.length > 0) {
                            const finalBallX = result.visualizationFrames[result.visualizationFrames.length - 1].ball.x;
                            if (finalBallX < HASH_LEFT_X) ballHash = 'L';
                            else if (finalBallX > HASH_RIGHT_X) ballHash = 'R';
                            else ballHash = 'M';
                        }

                        ballOn += result.yards;
                        ballOn = Math.max(0, Math.min(100, ballOn));

                        // --- Check OT Drive End Conditions ---
                        if (result.turnover) {
                            driveActive = false;
                            gameLog.push(`Turnover! Drive ends.`);
                            if (result.touchdown) { // Defensive TD
                                gameLog.push(`DEFENSIVE TOUCHDOWN! Game Over!`);
                                if (defense.id === homeTeam.id) homeScore += 6; else awayScore += 6;
                                isStillTied = false; // Game ends
                            }
                        } else if (result.safety) {
                            gameLog.push(`SAFETY! Game Over!`);
                            if (defense.id === homeTeam.id) homeScore += 2; else awayScore += 2;
                            driveActive = false;
                            isStillTied = false; // Game ends
                        } else if (result.touchdown) {
                            // OFFENSIVE TD. Run conversion logic.
                            ballOn = 100;
                            const wasOffensiveTD = !result.turnover; // Will be true

                            if (wasOffensiveTD) {
                                const goesForTwo = Math.random() > 0.85;
                                const points = goesForTwo ? 2 : 1;
                                const conversionBallOn = goesForTwo ? 95 : 98;
                                const conversionYardsToGo = 100 - conversionBallOn;
                                gameLog.push(`--- ${points}-Point Conversion Attempt ---`);
                                // ... (call conversion plays) ...
                                const conversionOffensePlayKey = determinePlayCall(offense, defense, 1, conversionYardsToGo, conversionBallOn, scoreDiff, gameLog, drivesRemainingInGame);
                                const conversionDefenseFormation = determineDefensiveFormation(defense, offense.formations.offense, 1, conversionYardsToGo);
                                defense.formations.defense = conversionDefenseFormation;
                                const conversionDefensePlayKey = determineDefensivePlayCall(defense, offense, 1, conversionYardsToGo, conversionBallOn, scoreDiff, gameLog, drivesRemainingInGame);
                                const convOffPlayName = conversionOffensePlayKey.split('_').slice(1).join(' ');
                                const convDefPlayName = defensivePlaybook[conversionDefensePlayKey]?.name || defensivePlayKey;
                                gameLog.push(`🏈 **Offense:** ${convOffPlayName}`);
                                gameLog.push(`🛡️ **Defense:** ${convDefPlayName}`);
                                const conversionResult = resolvePlay(offense, defense, conversionOffensePlayKey, conversionDefensePlayKey, { gameLog, weather, ballOn: conversionBallOn, ballHash: 'M', down: 1, yardsToGo: conversionYardsToGo });
                                if (conversionResult.visualizationFrames) allVisualizationFrames.push(...conversionResult.visualizationFrames);

                                // Tally Score
                                if (offense.id === homeTeam.id) homeScore += 6; else awayScore += 6;
                                if (conversionResult.touchdown) {
                                    if (!conversionResult.turnover) {
                                        gameLog.push(`✅ ${points}-point conversion GOOD!`);
                                        if (offense.id === homeTeam.id) homeScore += points; else awayScore += points;
                                    } else {
                                        gameLog.push(`❌ Conversion FAILED... AND RETURNED! Game Over!`);
                                        if (defense.id === homeTeam.id) homeScore += 2; else awayScore += 2;
                                        isStillTied = false; // Game ends
                                    }
                                } else {
                                    gameLog.push(`❌ ${points}-point conversion FAILED!`);
                                }
                            }
                            driveActive = false; // Drive over
                        } else if (result.incomplete) {
                            down++;
                        } else { // Completed play
                            yardsToGo -= result.yards;

                            if (yardsToGo <= 0) { // First down
                                down = 1;

                                // 💡 GOAL-LINE FIX:
                                // Check if the new ball position is inside the 10-yard line
                                if (ballOn >= 90) {
                                    yardsToGo = 100 - ballOn; // Set to "Goal-to-go"
                                } else {
                                    yardsToGo = 10; // Normal first down
                                }

                                // 💡 FAILSAME: If yardsToGo is 0 (or less), it means we are on the goal line.
                                // Set it to 1, because the offense must gain *at least* 1 yard (or 0.1) to score.
                                // This prevents the `yardsToGo <= 0` check from immediately firing again.
                                if (yardsToGo <= 0) {
                                    yardsToGo = 1;
                                }

                                const newYardLineText = ballOn <= 50 ? `own ${ballOn}` : `opponent ${100 - ballOn}`;
                                gameLog.push(`➡️ First down ${offense.name}! ${ballOn >= 90 ? `1st & Goal at the ${100 - ballOn}` : `1st & 10 at the ${newYardLineText}`}.`);

                            } else {
                                down++;
                            }
                        }

                        if (down > 4 && driveActive) {
                            gameLog.push(`✋ Turnover on downs! Drive ends.`);
                            driveActive = false;
                        }
                    } // --- End OT Play Loop ---
                } // --- End OT `for` loop (both teams have gone) ---

                // Check if still tied *after* the round
                if (isStillTied) { // Only check if a defensive TD didn't already end it
                    isStillTied = (homeScore === awayScore);
                    if (isStillTied) {
                        gameLog.push(`Round ${overtimeRound} ends. Still tied ${homeScore}-${awayScore}.`);
                        // Flip possession order for next round
                        otPossessionOrder.reverse();
                    }
                }
            } // --- End OT `while(isStillTied)` loop ---

            if (isStillTied) {
                gameLog.push(`After ${overtimeRound} rounds, the game is still tied. Declaring a TIE.`);
            } else {
                gameLog.push(`Overtime complete. Final score: ${awayTeam.name} ${awayScore} - ${homeTeam.name} ${homeScore}`);
            }
        }
        // --- 💡 END NEW OVERTIME BLOCK ---


        // --- Post-Game ---
        gameLog.push(`==== FINAL SCORE ==== ${awayTeam.name} ${awayScore} - ${homeTeam.name} ${homeScore}`);

        if (!gameForfeited) {
            if (homeScore > awayScore) { homeTeam.wins = (homeTeam.wins || 0) + 1; awayTeam.losses = (awayTeam.losses || 0) + 1; }
            else if (awayScore > homeScore) { awayTeam.wins = (awayTeam.wins || 0) + 1; homeTeam.losses = (homeTeam.losses || 0) + 1; }
            // 💡 NEW: Handle Ties
            else if (homeScore === awayScore) {
                homeTeam.ties = (homeTeam.ties || 0) + 1;
                awayTeam.ties = (awayTeam.ties || 0) + 1;
            }
        } else {
            if (homeScore > awayScore) { homeTeam.wins = (homeTeam.wins || 0) + 1; awayTeam.losses = (awayTeam.losses || 0) + 1; }
            else if (awayScore > homeScore) { awayTeam.wins = (awayTeam.wins || 0) + 1; homeTeam.losses = (homeTeam.losses || 0) + 1; }
        }

        // --- (Post-Game Player Progression & Stat Aggregation) ---
        [...(homeTeam.roster || []), ...(awayTeam.roster || [])].forEach(p => {
            if (!p || !p.gameStats || !p.attributes) return;

            // 1. Check for Breakthroughs
            const perfThreshold = p.gameStats.touchdowns >= 1 || p.gameStats.passYards > 100 || p.gameStats.recYards > 50 || p.gameStats.rushYards > 50 || p.gameStats.tackles > 4 || p.gameStats.sacks >= 1 || p.gameStats.interceptions >= 1;

            if (p.age < 14 && perfThreshold && Math.random() < 0.15) {
                const attributesToImprove = ['speed', 'strength', 'agility', 'throwingAccuracy', 'catchingHands', 'tackling', 'blocking', 'playbookIQ', 'blockShedding', 'toughness', 'consistency'];
                const attr = getRandom(attributesToImprove);
                for (const cat in p.attributes) {
                    if (p.attributes[cat]?.[attr] !== undefined && p.attributes[cat][attr] < 99) {
                        p.attributes[cat][attr]++;
                        p.breakthroughAttr = attr; // Mark for UI
                        breakthroughs.push({ player: p, attr, teamName: p.teamId === homeTeam.id ? homeTeam.name : awayTeam.name });
                        break;
                    }
                }
            }

            // 2. Aggregate Stats
            if (!p.seasonStats) p.seasonStats = {};
            if (!p.careerStats) p.careerStats = { seasonsPlayed: p.careerStats?.seasonsPlayed || 0 };

            for (const stat in p.gameStats) {
                if (typeof p.gameStats[stat] === 'number') {
                    p.seasonStats[stat] = (p.seasonStats[stat] || 0) + p.gameStats[stat];
                    p.careerStats[stat] = (p.careerStats[stat] || 0) + p.gameStats[stat];
                }
            }
        });

        // At the VERY end of all logic, assign the return value
        gameResult = {
            homeTeam, awayTeam, homeScore, awayScore,
            gameLog, breakthroughs, visualizationFrames: allVisualizationFrames
        };

    } finally {
        // This block ALWAYS executes, resetting the speed
        TICK_DURATION_SECONDS = originalTickDuration;
    }

    // Return the result *after* the 'finally' block has run
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

/** Simulates all games for the current week and advances state. */
export function simulateWeek(options = {}) {
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
                // Recompute healthy count from roster (temporary players have duration>0 and are not healthy)
                healthyCount = team.roster.filter(p => p && p.status?.duration === 0).length;
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

    const roster = team.roster || [];
    const outPlayer = roster.find(p => p && p.id === outPlayerId);
    const inPlayer = roster.find(p => p && p.id === inPlayerId);
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

    const roster = team.roster;
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
            const starter = roster.find(p => p && p.id === starterId);
            if (!starter) continue;
            const starterFat = starter.fatigue || 0;
            if (starter.status && starter.status.duration > 0) continue; // injured or busy handled elsewhere

            // If starter is fatigued beyond threshold, try to find a bench replacement
            if (starterFat >= thresholdFatigue) {
                // bench candidates not starters, not injured, and with meaningfully lower fatigue
                const candidates = roster.filter(p => p && !starterIds.has(p.id) && (!p.status || p.status.duration === 0) && ((p.fatigue || 0) + 8 < starterFat));
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

// --- Game State Persistence ---
export function saveGameState() {
    try {
        localStorage.setItem('backyardFootballGameState', JSON.stringify(game));
    } catch (e) {
        console.error('Error saving game state:', e);
    }
}

export function loadGameState() {
    try {
        const saved = localStorage.getItem('backyardFootballGameState');
        if (saved) {
            const loaded = JSON.parse(saved);
            Object.assign(game, loaded); // Shallow merge into existing game object
            return game;
        }
    } catch (e) {
        console.error('Error loading game state:', e);
    }
    return game;
}
