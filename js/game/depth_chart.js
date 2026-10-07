import { getPlayer, getRosterObjects, game } from './state.js';
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

export function isPlayerViableForPosition(p, pos) {
    if (!p) return false;
    const normalize = (raw) => {
        if (!raw) return null;
        if (['FB'].includes(raw)) return 'RB';
        if (['ATH', 'K', 'P'].includes(raw)) return 'WR';
        if (['OT', 'OG', 'C'].includes(raw)) return 'OL';
        if (['DE', 'DT', 'NT'].includes(raw)) return 'DL';
        if (['CB', 'S', 'FS', 'SS'].includes(raw)) return 'DB';
        return raw;
    };
    const off = normalize(p.favoriteOffensivePosition || p.pos || 'WR');
    const def = normalize(p.favoriteDefensivePosition || 'DB');

    if (off === pos || def === pos) return true;
    if (pos === 'QB') return off === 'QB'; // Strictly actual QBs
    if (pos === 'OL' && (off === 'TE' || def === 'DL')) return true;
    if (pos === 'DL' && (off === 'OL' || def === 'LB')) return true;
    if (pos === 'TE' && off === 'WR') return true;
    if (pos === 'RB' && (off === 'WR' || def === 'LB')) return true;
    if (pos === 'WR' && (off === 'RB' || def === 'DB')) return true;
    if (pos === 'DB' && (off === 'WR' || def === 'LB')) return true;
    if (pos === 'LB' && (def === 'DL' || def === 'DB')) return true;
    return false;
}

export function populateNaturalDepthOrder(team) {
    const rosterObjs = getRosterObjects(team);
    team.depthOrder = {
        'QB': [], 'RB': [], 'WR': [], 'TE': [], 'OL': [],
        'DL': [], 'LB': [], 'DB': []
    };

    const positions = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'];
    positions.forEach(pos => {
        const viable = rosterObjs.filter(p => isPlayerViableForPosition(p, pos));
        viable.sort((a, b) => calculateOverall(b, pos) - calculateOverall(a, pos));
        team.depthOrder[pos] = viable.map(p => p.id);
    });
}

export function pruneUnnaturalDepthOrder(team) {
    if (!team || !team.depthOrder || typeof team.depthOrder !== 'object') return;
    const assignedIds = new Set();
    if (team.depthChart) {
        Object.values(team.depthChart.offense || {}).forEach(id => { if (id) assignedIds.add(id); });
        Object.values(team.depthChart.defense || {}).forEach(id => { if (id) assignedIds.add(id); });
    }
    if (team.slotOverrides) {
        Object.values(team.slotOverrides.offense || {}).forEach(id => { if (id) assignedIds.add(id); });
        Object.values(team.slotOverrides.defense || {}).forEach(id => { if (id) assignedIds.add(id); });
    }

    Object.keys(team.depthOrder).forEach(pos => {
        if (!Array.isArray(team.depthOrder[pos])) return;
        team.depthOrder[pos] = team.depthOrder[pos].filter(pid => {
            if (assignedIds.has(pid)) return true;
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

    const rosterIds = new Set(team.roster);
    const offFormKey = normalizeFormationKey(offenseFormations, team.formations.offense, 'Balanced');
    team.formations.offense = offFormKey;
    const offSlots = offenseFormations[offFormKey]?.slots || [];

    const defFormKey = normalizeFormationKey(defenseFormations, team.formations?.defense || '3-2-3 Base', '3-2-3 Base');
    team.formations.defense = defFormKey;
    const defSlots = defenseFormations[defFormKey]?.slots || [];

    const usedOffense = new Set();
    const usedDefense = new Set();

    // 1. RESPECT MANUAL SLOT OVERRIDES (AND CLEARED SLOTS)
    offSlots.forEach(slot => {
        if (team.slotOverrides.offense[slot] !== undefined) {
            const pId = team.slotOverrides.offense[slot];
            if (pId === null) {
                team.depthChart.offense[slot] = null; // Explicitly cleared by user
            } else if (rosterIds.has(pId)) {
                team.depthChart.offense[slot] = pId;
                usedOffense.add(pId);
            } else {
                delete team.slotOverrides.offense[slot];
            }
        }
    });

    defSlots.forEach(slot => {
        if (team.slotOverrides.defense[slot] !== undefined) {
            const pId = team.slotOverrides.defense[slot];
            if (pId === null) {
                team.depthChart.defense[slot] = null; // Explicitly cleared by user
            } else if (rosterIds.has(pId)) {
                team.depthChart.defense[slot] = pId;
                usedDefense.add(pId);
            } else {
                delete team.slotOverrides.defense[slot];
            }
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
        return null;
    };

    // 2. AUTO-FILL REMAINING UNLOCKED SLOTS
    const sortedOffSlots = [...offSlots].sort((a, b) => getPriority(b) - getPriority(a));
    sortedOffSlots.forEach(slot => {
        if (team.slotOverrides.offense[slot] !== undefined) return; // Keep locked or cleared

        let posKey = slot.replace(/\d+/g, '');
        if (['OT', 'OG', 'C'].includes(posKey)) posKey = 'OL';
        if (posKey === 'FB') posKey = 'RB';

        let searchBuckets = [slot, posKey];
        if (posKey === 'WR') searchBuckets.push('TE', 'RB');
        if (posKey === 'RB') searchBuckets.push('WR');
        if (posKey === 'TE') searchBuckets.push('WR', 'OL');
        if (posKey === 'OL') searchBuckets.push('DL', 'TE');
        if (posKey === 'QB') searchBuckets.push('WR', 'RB');

        team.depthChart.offense[slot] = getBestAvailable(searchBuckets, usedOffense);
    });

    const sortedDefSlots = [...defSlots].sort((a, b) => getPriority(b) - getPriority(a));
    sortedDefSlots.forEach(slot => {
        if (team.slotOverrides.defense[slot] !== undefined) return; // Keep locked or cleared

        let posKey = slot.replace(/\d+/g, '');
        if (['CB', 'S'].includes(posKey)) posKey = 'DB';
        if (['DE', 'DT'].includes(posKey)) posKey = 'DL';

        let searchBuckets = [slot, posKey];
        if (posKey === 'DB') searchBuckets.push('WR');
        if (posKey === 'LB') searchBuckets.push('DL', 'DB');
        if (posKey === 'DL') searchBuckets.push('LB', 'OL');

        team.depthChart.defense[slot] = getBestAvailable(searchBuckets, usedDefense);
    });

    const qbBucket = team.depthOrder['QB'] || [];
    const bestPunter = qbBucket.length > 1 ? qbBucket[1] : qbBucket[0];
    team.depthChart.special['P'] = bestPunter || null;

    if (offFormKey === 'Punt') {
        team.depthChart.offense['QB1'] = team.depthChart.special['P'] || bestPunter || null;
    }
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
    if (!team.depthChart) team.depthChart = { offense: {}, defense: {}, special: {} };
    if (!team.slotOverrides) team.slotOverrides = { offense: {}, defense: {} };
    if (!team.slotOverrides[side]) team.slotOverrides[side] = {};

    // 1. CLEAR SLOT: Lock as explicitly empty
    if (!playerId || playerId === 'null' || playerId === '') {
        team.slotOverrides[side][slot] = null;
        team.depthChart[side][slot] = null;
        rebuildDepthChartFromOrder(team);
        return true;
    }

    // 2. ASSIGN SLOT: Lock assignment and promote player in group
    team.slotOverrides[side][slot] = playerId;
    team.depthChart[side][slot] = playerId;

    let posKey = slot.replace(/\d+/g, '');
    if (['OT', 'OG', 'C'].includes(posKey)) posKey = 'OL';
    if (posKey === 'FB') posKey = 'RB';
    if (['CB', 'S', 'FS', 'SS'].includes(posKey)) posKey = 'DB';
    if (['DE', 'DT', 'NT'].includes(posKey)) posKey = 'DL';

    if (!team.depthOrder) team.depthOrder = {};
    if (!team.depthOrder[posKey]) team.depthOrder[posKey] = [];

    const groupList = team.depthOrder[posKey];
    const existingIndex = groupList.indexOf(playerId);
    if (existingIndex > -1) groupList.splice(existingIndex, 1);
    groupList.unshift(playerId);
    team.depthOrder[posKey] = groupList;

    rebuildDepthChartFromOrder(team);
    return true;
}

export function updateDepthChart(playerId, slotName, side) {
    const team = game?.playerTeam;
    if (!team || !team.depthOrder) return;

    let posKey = slotName.replace(/\d+/g, '');
    if (['OT', 'OG', 'C'].includes(posKey)) posKey = 'OL';
    if (posKey === 'FB') posKey = 'RB';
    if (posKey === 'TE') posKey = 'TE';
    if (['CB', 'S', 'FS', 'SS'].includes(posKey)) posKey = 'DB';
    if (['DE', 'DT', 'NT'].includes(posKey)) posKey = 'DL';

    const groupList = team.depthOrder[posKey] || [];
    const existingIndex = groupList.indexOf(playerId);
    if (existingIndex > -1) groupList.splice(existingIndex, 1);

    groupList.unshift(playerId);
    team.depthOrder[posKey] = groupList;
    rebuildDepthChartFromOrder(team);
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

    const fullRoster = getRosterObjects(team);
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

    const fatigueLimit = options.thresholdFatigue || 75;
    const recoverLimit = 40;
    const fullRoster = getRosterObjects(team);
    let subsDone = 0;

    const activeOffense = new Set(Object.values(team.depthChart.offense).filter(Boolean));
    const activeDefense = new Set(Object.values(team.depthChart.defense).filter(Boolean));

    for (const side of ['offense', 'defense']) {
        const chart = team.depthChart[side];
        const activeOnThisSide = side === 'offense' ? activeOffense : activeDefense;

        for (const slot in chart) {
            const currentId = chart[slot];
            const currentPlayer = fullRoster.find(p => p.id === currentId);

            if (currentPlayer) {
                if ((currentPlayer.fatigue || 0) >= fatigueLimit) currentPlayer.isResting = true;
                if ((currentPlayer.fatigue || 0) <= recoverLimit) currentPlayer.isResting = false;
            }

            const isTwoWayFatigued = side === 'defense' && (currentPlayer?.fatigue || 0) > 55;
            const needsSub = !currentPlayer ||
                currentPlayer.isResting ||
                (currentPlayer.fatigue || 0) >= fatigueLimit ||
                isTwoWayFatigued ||
                currentPlayer.status?.duration > 0;

            if (!needsSub) continue;

            let basePos = slot.replace(/\d/g, '');
            if (['OT', 'OG', 'C'].includes(basePos)) basePos = 'OL';
            if (['CB', 'S', 'FS', 'SS'].includes(basePos)) basePos = 'DB';
            if (['DE', 'DT', 'NT'].includes(basePos)) basePos = 'DL';
            if (basePos === 'FB') basePos = 'RB';

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
