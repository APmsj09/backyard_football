// game/depth_chart.js

import {
    getPlayer,
    getRosterObjects,
    getGameDayRosterObjects,
    game
} from './state.js';
import { offenseFormations, defenseFormations } from '../data.js';
import { calculateOverall, calculateSlotSuitability, estimateBestPosition } from './player.js';
import { pushGameLog } from './collisions.js';
import { getRandom } from '../utils.js';

export const slotPriority = {
    'QB1': 100, 'OL2': 90, 'OL1': 85, 'OL3': 80, 'RB1': 75, 'WR1': 70, 'TE1': 65, 'WR2': 60, 'WR3': 55, 'RB2': 50, 'WR4': 45, 'TE2': 40, 'WR5': 35,
    'LB2': 100, 'LB1': 95, 'DB1': 85, 'DB3': 80, 'DB2': 75, 'DL1': 65, 'DL3': 60, 'DL2': 55, 'DL4': 50, 'DB5': 45
};

export const getPriority = (slot) => slotPriority[slot] || 0;

export function normalizeFormationKey(formations, formationKey, defaultKey) {
    if (!formations || typeof formations !== 'object') {
        return defaultKey;
    }
    if (formationKey && formations[formationKey]) {
        return formationKey;
    }
    const match = Object.entries(formations).find(
        ([key, f]) => f.name === formationKey || key === formationKey
    );
    if (match) {
        return match[0];
    }
    if (defaultKey && formations[defaultKey]) {
        return defaultKey;
    }
    const keys = Object.keys(formations);
    return keys.length > 0 ? keys[0] : null;
}

export function isPlayerNaturalForPosition(p, pos) {
    if (!p) return false;
    const normalize = (raw) => {
        if (!raw) return null;
        if (['FB'].includes(raw)) return 'RB';
        if (['OT', 'OG', 'C'].includes(raw)) return 'OL';
        if (['DE', 'DT', 'NT'].includes(raw)) return 'DL';
        if (['CB', 'S', 'FS', 'SS'].includes(raw)) return 'DB';
        return raw;
    };
    const primary = normalize(p.pos);
    const off = normalize(p.favoriteOffensivePosition);
    const def = normalize(p.favoriteDefensivePosition);
    return primary === pos || off === pos || def === pos;
}

export function isPlayerViableForPosition(p, pos) {
    if (!p) return false;
    
    const normalize = (raw) => {
        if (!raw) return null;
        if (['FB'].includes(raw)) return 'RB';
        if (['OT', 'OG', 'C'].includes(raw)) return 'OL';
        if (['DE', 'DT', 'NT'].includes(raw)) return 'DL';
        if (['CB', 'S', 'FS', 'SS'].includes(raw)) return 'DB';
        return raw;
    };

    const primary = normalize(p.pos);
    const off = normalize(p.favoriteOffensivePosition);
    const def = normalize(p.favoriteDefensivePosition);

    if (off === pos || def === pos || primary === pos) return true;

    // True Athletes can play any skill position
    if (primary === 'ATH') {
        return ['QB', 'RB', 'WR', 'TE', 'DB', 'LB'].includes(pos);
    }

    // Permissive 8-Man sandbox crossover rules:
    // Skill players (QB/RB/WR/TE/DB) can interchange across skill positions.
    // Bigs/Linemen (OL/DL/TE/LB) can interchange across the trenches.
    if (['QB', 'RB', 'WR'].includes(pos)) {
        return ['QB', 'RB', 'WR', 'TE', 'DB', 'ATH'].includes(primary) || ['QB', 'RB', 'WR'].includes(off);
    }
    if (pos === 'TE') {
        return ['TE', 'WR', 'OL', 'LB', 'DL', 'ATH'].includes(primary) || off === 'TE' || def === 'LB';
    }
    if (pos === 'OL') {
        return ['OL', 'DL', 'TE'].includes(primary) || off === 'OL' || def === 'DL';
    }
    if (pos === 'DL') {
        return ['DL', 'OL', 'LB', 'TE'].includes(primary) || def === 'DL' || off === 'OL';
    }
    if (pos === 'LB') {
        return ['LB', 'DL', 'TE', 'RB', 'DB', 'ATH'].includes(primary) || def === 'LB' || off === 'TE';
    }
    if (pos === 'DB') {
        return ['DB', 'WR', 'RB', 'QB', 'LB', 'ATH'].includes(primary) || def === 'DB' || off === 'WR';
    }

    return true; // Never hard-lock the coach out; position overall rating handles suitability
}

export function populateNaturalDepthOrder(team) {
    const rosterObjs = getGameDayRosterObjects(team);
    team.depthOrder = {
        'QB': [], 'RB': [], 'WR': [], 'TE': [], 'OL': [],
        'DL': [], 'LB': [], 'DB': []
    };

    const coach = team.staff?.coach || team.coach;
    const personality = coach?.biases?.personality?.name;
    const gmDirective = team.gameplan?.gmDirective || 'COACH_AUTONOMY';

    // Coach evaluates player culture & fits based on archetype
    const getCoachEvaluationScore = (p, pos) => {
        let score = calculateOverall(p, pos);
        const ethic = p.personality?.workEthic || 50;
        const ego = p.personality?.ego || 50;
        const toughness = p.attributes?.mental?.toughness || 50;

        if (personality === 'Old-School Disciplinarian') {
            if (ethic < 40) score -= 8; // Disciplinarian refuses to start lazy kids
            if (ego > 75) score -= 6;   // Clashes with divas
            if (toughness > 65) score += 5; // Loves hard-nosed grinders
        } else if (personality === "Peaked in '94") {
            const str = p.attributes?.physical?.strength || 50;
            const wgt = p.attributes?.physical?.weight || 150;
            if (str > 60 || wgt > 180) score += 6; // Values raw size and brute power
        } else if (personality === "Players' Coach") {
            const loyalty = p.personality?.loyalty || 50;
            if (loyalty > 65) score += 4; // Rewards loyal team players
        }

        // GM Directives override
        if (gmDirective === 'DEVELOP_YOUTH' && p.age <= 14) {
            score += 7; // Pushes young prospects into starting depth
        }

        return score;
    };

    const positions = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'];
    positions.forEach(pos => {
        const viable = rosterObjs.filter(p => isPlayerViableForPosition(p, pos));
        viable.sort((a, b) => getCoachEvaluationScore(b, pos) - getCoachEvaluationScore(a, pos));
        team.depthOrder[pos] = viable.map(p => p.id);
    });
}

export function pruneUnnaturalDepthOrder(team) {
    if (!team || !team.depthOrder || typeof team.depthOrder !== 'object') return;

    Object.keys(team.depthOrder).forEach(pos => {
        if (!Array.isArray(team.depthOrder[pos])) return;
        team.depthOrder[pos] = team.depthOrder[pos].filter(pid => {
            const p = getPlayer(pid);
            return isPlayerViableForPosition(p, pos);
        });
    });
}

export function rebuildDepthChartFromOrder(team) {
    if (!team || !team.formations) return;

    if (Array.isArray(team.roster)) {
        team.roster = team.roster.filter(id => !!getPlayer(id));
    }

    if (!team.depthOrder || Array.isArray(team.depthOrder) || Object.keys(team.depthOrder).length === 0) {
        populateNaturalDepthOrder(team);
    }

    if (!team.depthChart) team.depthChart = { offense: {}, defense: {}, special: {} };
    if (!team.slotOverrides) team.slotOverrides = { offense: {}, defense: {} };
    if (!team.slotOverrides.offense) team.slotOverrides.offense = {};
    if (!team.slotOverrides.defense) team.slotOverrides.defense = {};

    pruneUnnaturalDepthOrder(team);

    const rosterIds = new Set(
        getGameDayRosterObjects(team).map(player => player.id)
    );

    // Remove players who are no longer eligible for this game-day roster.
    Object.keys(team.depthOrder).forEach(pos => {
        if (!Array.isArray(team.depthOrder[pos])) return;

        team.depthOrder[pos] = team.depthOrder[pos].filter(
            playerId => rosterIds.has(playerId)
        );
    });

    const offFormKey = normalizeFormationKey(offenseFormations, team.formations.offense, 'Balanced');
    team.formations.offense = offFormKey;
    const offSlots = offenseFormations[offFormKey]?.slots || [];

    const defFormKey = normalizeFormationKey(defenseFormations, team.formations?.defense || '3-2-3 Base', '3-2-3 Base');
    team.formations.defense = defFormKey;
    const defSlots = defenseFormations[defFormKey]?.slots || [];

    // CRITICAL FIX: Build brand-new depth charts so stale formation slots are wiped out completely
    const newOffChart = {};
    const newDefChart = {};
    const usedOffense = new Set();
    const usedDefense = new Set();

    // 1. Process slot overrides, strictly enforcing: at most 1 slot per player per side
    offSlots.forEach(slot => {
        const pId = team.slotOverrides.offense[slot];
        if (pId === null) {
            newOffChart[slot] = null;
        } else if (pId && rosterIds.has(pId) && !usedOffense.has(pId)) {
            newOffChart[slot] = pId;
            usedOffense.add(pId);
        } else if (pId && usedOffense.has(pId)) {
            delete team.slotOverrides.offense[slot]; // Strip duplicate override
        }
    });

    defSlots.forEach(slot => {
        const pId = team.slotOverrides.defense[slot];
        if (pId === null) {
            newDefChart[slot] = null;
        } else if (pId && rosterIds.has(pId) && !usedDefense.has(pId)) {
            newDefChart[slot] = pId;
            usedDefense.add(pId);
        } else if (pId && usedDefense.has(pId)) {
            delete team.slotOverrides.defense[slot]; // Strip duplicate override
        }
    });

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
        // Fallback: search remaining roster if position bucket is exhausted
        for (const pid of rosterIds) {
            if (!usedSet.has(pid)) {
                usedSet.add(pid);
                return pid;
            }
        }
        return null;
    };

    // 2. Auto-fill remaining unlocked slots in priority order
    const sortedOffSlots = [...offSlots].sort((a, b) => getPriority(b) - getPriority(a));
    sortedOffSlots.forEach(slot => {
        if (newOffChart[slot] !== undefined) return;

        let posKey = slot.replace(/\d+/g, '');
        if (['OT', 'OG', 'C'].includes(posKey)) posKey = 'OL';
        if (posKey === 'FB') posKey = 'RB';

        let searchBuckets = [posKey];
        if (posKey === 'WR') searchBuckets.push('TE', 'RB', 'QB');
        if (posKey === 'RB') searchBuckets.push('WR', 'QB', 'TE');
        if (posKey === 'TE') searchBuckets.push('WR', 'OL', 'RB');
        if (posKey === 'OL') searchBuckets.push('DL', 'TE');
        if (posKey === 'QB') searchBuckets.push('WR', 'RB');

        newOffChart[slot] = getBestAvailable(searchBuckets, usedOffense);
    });

    const sortedDefSlots = [...defSlots].sort((a, b) => getPriority(b) - getPriority(a));
    sortedDefSlots.forEach(slot => {
        if (newDefChart[slot] !== undefined) return;

        let posKey = slot.replace(/\d+/g, '');
        if (['CB', 'S'].includes(posKey)) posKey = 'DB';
        if (['DE', 'DT'].includes(posKey)) posKey = 'DL';

        let searchBuckets = [posKey];
        if (posKey === 'DB') searchBuckets.push('WR', 'LB');
        if (posKey === 'LB') searchBuckets.push('DL', 'DB', 'TE');
        if (posKey === 'DL') searchBuckets.push('LB', 'OL');

        newDefChart[slot] = getBestAvailable(searchBuckets, usedDefense);
    });

    // Replace the team depth chart with clean, deduplicated slot objects
    team.depthChart.offense = newOffChart;
    team.depthChart.defense = newDefChart;

    const qbBucket = team.depthOrder['QB'] || [];
    const bestPunter = qbBucket.length > 1 ? qbBucket[1] : qbBucket[0];
    if (!team.depthChart.special) team.depthChart.special = {};
    team.depthChart.special['P'] = bestPunter || team.roster[0] || null;
}


export function autoResetLineup(team) {
    if (!team) return;
    team.slotOverrides = { offense: {}, defense: {} };
    populateNaturalDepthOrder(team);
    rebuildDepthChartFromOrder(team);
}

export function aiSetDepthChart(team) {
    if (!team) return;
    autoResetLineup(team);
}

export function assignPlayerToSlot(team, playerId, slot, side) {
    if (!team) return false;
    if (!['offense', 'defense'].includes(side)) return false;

    // Only allow assignments to slots in the active formation.
    const formationMap = side === 'offense'
        ? offenseFormations
        : defenseFormations;

    const defaultFormation = side === 'offense'
        ? 'Balanced'
        : '3-2-3 Base';

    const formationKey = normalizeFormationKey(
        formationMap,
        team.formations?.[side],
        defaultFormation
    );

    const activeSlots = formationMap[formationKey]?.slots || [];

    if (!activeSlots.includes(slot)) return false;

    if (!team.depthChart) {
        team.depthChart = {
            offense: {},
            defense: {},
            special: {}
        };
    }

    if (!team.depthChart[side]) {
        team.depthChart[side] = {};
    }

    if (!team.slotOverrides) {
        team.slotOverrides = {
            offense: {},
            defense: {}
        };
    }

    if (!team.slotOverrides[side]) {
        team.slotOverrides[side] = {};
    }

    // Explicitly vacate and lock the selected formation slot.
    if (!playerId || playerId === 'null' || playerId === '') {
        team.slotOverrides[side][slot] = null;
        team.depthChart[side][slot] = null;

        rebuildDepthChartFromOrder(team);
        return true;
    }

    // Only game-day eligible players can be assigned.
    const gameDayRoster = getGameDayRosterObjects(team);

    if (!gameDayRoster.some(
        player => player.id === playerId
    )) {
        return false;
    }

    let posKey = slot.replace(/\d+/g, '');

    if (['OT', 'OG', 'C'].includes(posKey)) posKey = 'OL';
    if (posKey === 'FB') posKey = 'RB';
    if (['CB', 'S', 'FS', 'SS'].includes(posKey)) posKey = 'DB';
    if (['DE', 'DT', 'NT'].includes(posKey)) posKey = 'DL';

    const player = getPlayer(playerId);

    if (!isPlayerViableForPosition(player, posKey)) {
        return false;
    }

    // Remove this player from any other manual slot assignment
    // on this side to prevent duplicate assignments.
    Object.keys(team.slotOverrides[side]).forEach(otherSlot => {
        if (
            otherSlot !== slot &&
            team.slotOverrides[side][otherSlot] === playerId
        ) {
            delete team.slotOverrides[side][otherSlot];

            if (team.depthChart[side][otherSlot] === playerId) {
                team.depthChart[side][otherSlot] = null;
            }
        }
    });

    // Lock the formation-specific assignment without changing
    // the player's universal position ranking.
    team.slotOverrides[side][slot] = playerId;
    team.depthChart[side][slot] = playerId;

    rebuildDepthChartFromOrder(team);
    return true;
}

export function updateDepthChart(playerId, slotName, side) {
    const team = game?.playerTeam;
    if (!team) return false;

    // Keep all assignment paths subject to the same validation
    // and preserve universal position rankings.
    return assignPlayerToSlot(
        team,
        playerId,
        slotName,
        side
    );
}

export function changeFormation(side, formationName) {
    const team = game?.playerTeam;
    if (!team) return;

    team.formations[side] = formationName;
    rebuildDepthChartFromOrder(team);

    const syncCheck = validateFormationDepthChartSync(team);
    if (!syncCheck.valid) {
        rebuildDepthChartFromOrder(team);
    }
}

export function validateFormationDepthChartSync(team) {
    const issues = [];
    if (!team || !team.formations || !team.depthChart) {
        return { valid: false, issues: ['Team missing formations or depthChart'] };
    }

    const offFormation = team.formations.offense;
    const offFormationData = offenseFormations[offFormation];
    if (offFormationData && offFormationData.slots) {
        const expectedSlots = new Set(offFormationData.slots);
        const actualSlots = new Set(Object.keys(team.depthChart.offense || {}));

        for (const slot of expectedSlots) {
            if (!actualSlots.has(slot)) issues.push(`Offense slot '${slot}' missing from depthChart`);
        }
        for (const slot of actualSlots) {
            if (!expectedSlots.has(slot)) issues.push(`Offense depthChart has extra slot '${slot}' not in formation`);
        }
    }

    const defFormation = team.formations.defense;
    const defFormationData = defenseFormations[defFormation];
    if (defFormationData && defFormationData.slots) {
        const expectedSlots = new Set(defFormationData.slots);
        const actualSlots = new Set(Object.keys(team.depthChart.defense || {}));

        for (const slot of expectedSlots) {
            if (!actualSlots.has(slot)) issues.push(`Defense slot '${slot}' missing from depthChart`);
        }
        for (const slot of actualSlots) {
            if (!expectedSlots.has(slot)) issues.push(`Defense depthChart has extra slot '${slot}' not in formation`);
        }
    }

    return { valid: issues.length === 0, issues };
}

export function getDepthChartEmptySlots(team) {
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

export function substitutePlayers(teamId, outPlayerId, inPlayerId, gameLog = null) {
    if (!game || !game.teams) return { success: false, message: 'Game state invalid.' };
    const team = game.teams.find(t => t && t.id === teamId) || game.playerTeam;
    if (!team || !team.depthChart) return { success: false, message: 'Team or depth chart invalid.' };

    const fullRoster = getGameDayRosterObjects(team);
    const outPlayer = fullRoster.find(p => p && p.id === outPlayerId);
    const inPlayer = fullRoster.find(p => p && p.id === inPlayerId);
    if (!outPlayer || !inPlayer) return { success: false, message: 'Player not found.' };

    const sides = ['offense', 'defense'];
    let swappedCount = 0;
    let lastSlot = '';

    sides.forEach(side => {
        const chart = team.depthChart[side] || {};
        Object.keys(chart).forEach(slot => {
            if (chart[slot] === outPlayerId) {
                const isAlreadyOnSide = Object.values(chart).includes(inPlayerId);
                if (!isAlreadyOnSide) {
                    chart[slot] = inPlayerId;
                    swappedCount++;
                    lastSlot = `${side === 'offense' ? 'OFF' : 'DEF'} ${slot}`;
                }
            }
        });
    });

    if (swappedCount > 0) {
        inPlayer.isResting = false;
        // Lock the player into the lineup for ~4 plays to prevent immediate AI reversal
        inPlayer.manualSubLock = 4;
        
        const inEnergy = Math.max(0, Math.round(100 - (inPlayer.fatigue || 0)));
        const outEnergy = Math.max(0, Math.round(100 - (outPlayer.fatigue || 0)));
        const logMsg = `🔄 SUB (${lastSlot}): ${inPlayer.name} (${inEnergy}% E) enters for ${outPlayer.name} (${outEnergy}% E).`;

        if (gameLog && Array.isArray(gameLog)) gameLog.push(logMsg);
        return { success: true, message: 'Substitution completed.' };
    }

    return { success: false, message: 'No valid swap found or player already active.' };
}

export function autoMakeSubstitutions(team, options = {}, gameLog = null) {
    if (!team || !team.depthChart || !team.roster || !team.depthOrder) return 0;

    const coach = team.staff?.coach || team.coach;
    const personality = coach?.biases?.personality?.name;

    // 1. Unified Energy-Based Policy (Converted to internal fatigue scale: fatigue = 100 - energy)
    const tendency = options.autoSubTendency || 'balanced';
    
    // Ironman: Sub below 20% energy (Fatigue Limit: 80)
    // Balanced: Sub below 40% energy (Fatigue Limit: 60)
    // Frequent: Sub below 60% energy (Fatigue Limit: 40)
    let baseFatigueLimit = 60; 
    if (tendency === 'ironman') baseFatigueLimit = 80;
    else if (tendency === 'frequent') baseFatigueLimit = 40;

    // 2. Soft Coach Overrides (Bounded to +/- 5 influence, never breaks GM setting)
    let coachOffset = 0;
    if (personality === 'Old-School Disciplinarian') coachOffset = 5; // Pushes kids slightly harder
    else if (personality === "Players' Coach") coachOffset = -5; // Subs slightly earlier

    const fullRoster = getGameDayRosterObjects(team);
    let subsDone = 0;

    const activeOffense = new Set(Object.values(team.depthChart.offense || {}).filter(Boolean));
    const activeDefense = new Set(Object.values(team.depthChart.defense || {}).filter(Boolean));

    for (const side of ['offense', 'defense']) {
        const chart = team.depthChart[side];
        const activeOnThisSide = side === 'offense' ? activeOffense : activeDefense;

        for (const slot in chart) {
            const currentId = chart[slot];
            const currentPlayer = fullRoster.find(p => p.id === currentId);

            // 3. Position-Group Rotation Philosophy
            let posGroupOffset = 0;
            let basePos = slot.replace(/\d/g, '');
            if (['OT', 'OG', 'C'].includes(basePos)) basePos = 'OL';
            if (['CB', 'S', 'FS', 'SS'].includes(basePos)) basePos = 'DB';
            if (['DE', 'DT', 'NT'].includes(basePos)) basePos = 'DL';
            if (basePos === 'FB') basePos = 'RB';

            if (basePos === 'QB' || basePos === 'OL') {
                // Strong continuity protection (sub 15% later)
                posGroupOffset = 15; 
            } else if (basePos === 'RB' || basePos === 'DL') {
                // High rotation dependency (sub 10% earlier)
                posGroupOffset = -10; 
            }

            // Final dynamically calculated limit for this specific slot
            let fatigueLimit = baseFatigueLimit + coachOffset + posGroupOffset;
            fatigueLimit = Math.max(15, Math.min(95, fatigueLimit)); // Sane bounds

            // Hysteresis: Require a ~25 energy point recovery buffer before returning
            let recoverLimit = Math.max(5, fatigueLimit - 25);

            if (currentPlayer) {
                if ((currentPlayer.fatigue || 0) >= fatigueLimit) currentPlayer.isResting = true;
                if ((currentPlayer.fatigue || 0) <= recoverLimit) currentPlayer.isResting = false;
            }

            const isTwoWayFatigued = side === 'defense' && (currentPlayer?.fatigue || 0) > 55;
            const isManualLocked = (currentPlayer?.manualSubLock || 0) > 0;
            const isInjured = currentPlayer?.status?.duration > 0;
            
            // 4. Manual Substitution Lock Safeguard (Injury bypasses the lock)
            const needsSub = !currentPlayer || isInjured || (!isManualLocked && (
                currentPlayer.isResting ||
                (currentPlayer.fatigue || 0) >= fatigueLimit ||
                isTwoWayFatigued
            ));

            if (!needsSub) continue;

            // basePos is already declared and normalized above
            let searchBuckets = [basePos];
            if (basePos === 'OL') searchBuckets.push('DL', 'TE');
            else if (basePos === 'DL') searchBuckets.push('OL', 'LB', 'TE');
            else if (basePos === 'LB') searchBuckets.push('DL', 'TE', 'RB', 'DB');
            else if (basePos === 'TE') searchBuckets.push('OL', 'LB', 'WR');
            else if (basePos === 'RB') searchBuckets.push('WR', 'DB', 'LB');
            else if (basePos === 'WR') searchBuckets.push('DB', 'RB', 'TE');
            else if (basePos === 'DB') searchBuckets.push('WR', 'RB', 'LB');
            else if (basePos === 'QB') searchBuckets.push('WR', 'RB');

            let bestCandidateId = null;
            let bestSuitability = -Infinity;

            for (const bucket of searchBuckets) {
                const groupList = team.depthOrder[bucket] || [];
                for (const candidateId of groupList) {
                    const candidate = fullRoster.find(p => p.id === candidateId);
                    if (!candidate || candidate.status?.duration > 0) continue;
                    if (activeOnThisSide.has(candidateId) && candidateId !== currentId) continue;

                    if ((candidate.fatigue || 0) >= fatigueLimit) candidate.isResting = true;
                    if ((candidate.fatigue || 0) <= recoverLimit) candidate.isResting = false;

                    if (!candidate.isResting) {
                        const score = calculateSlotSuitability(candidate, slot, side, team);
                        if (score > 35 && score > bestSuitability) {
                            bestSuitability = score;
                            bestCandidateId = candidateId;
                        }
                    }
                }
                if (bestCandidateId) break;
            }

            if (!bestCandidateId && currentPlayer && !currentPlayer.isResting) {
                bestCandidateId = currentId;
            }

            if (bestCandidateId && bestCandidateId !== currentId) {
                const newPlayer = fullRoster.find(p => p.id === bestCandidateId);
                chart[slot] = bestCandidateId;

                activeOnThisSide.delete(currentId);
                activeOnThisSide.add(bestCandidateId);
                subsDone++;

                if (gameLog && currentPlayer) {
                    const inE = Math.max(0, Math.round(100 - (newPlayer.fatigue || 0)));
                    const outE = Math.max(0, Math.round(100 - (currentPlayer.fatigue || 0)));
                    pushGameLog(gameLog, `🔄 SUB (${side === 'offense' ? 'OFF' : 'DEF'} ${slot}): ${newPlayer.name} (${inE}% E) in for ${currentPlayer.name} (${outE}% E).`);
                }
            }
        }
    }
    return subsDone;
}

export function setTeamCaptain(team, playerId) {
    if (!team || !playerId) return false;
    if (team.roster.includes(playerId)) {
        team.captainId = playerId;
        return true;
    }
    return false;
}

export function assignTeamCaptain(team) {
    const roster = getRosterObjects(team);
    if (roster.length === 0) return;

    const getLeadershipScore = (p) => {
        const iq = p.attributes?.mental?.playbookIQ || 50;
        const consistency = p.attributes?.mental?.consistency || 50;
        const ageBonus = (p.age - 10) * 5;
        return (iq * 0.5) + (ageBonus * 0.3) + (consistency * 0.2);
    };

    roster.sort((a, b) => getLeadershipScore(b) - getLeadershipScore(a));
    if (roster[0]) team.captainId = roster[0].id;
}

export function checkCaptainDiscipline(team, gameLog) {
    const roster = getRosterObjects(team);
    const captain = roster.find(p => p.id === team.captainId) || roster[0];
    if (!captain) return true;

    const iq = captain.attributes?.mental?.playbookIQ || 50;
    const consistency = captain.attributes?.mental?.consistency || 50;

    const iqErrorFactor = (100 - iq) / 100;
    const consistencyErrorFactor = (100 - consistency) / 100;
    const mentalErrorChance = ((iqErrorFactor * 0.6) + (consistencyErrorFactor * 0.4)) * 0.5;
    const mentalErrorChanceClamped = Math.max(0.001, Math.min(0.35, mentalErrorChance));

    const isSmart = Math.random() > mentalErrorChanceClamped;

    if (!isSmart && gameLog && Math.random() < 0.05 && !team._captainFlavorLogged) {
        pushGameLog(gameLog, `⚠️ ${captain.name} looks confused and rushes the play call...`);
        team._captainFlavorLogged = true;
    }

    return isSmart;
}
