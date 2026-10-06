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

export function rebuildDepthChartFromOrder(team) {
    if (!team || !team.formations) return;

    if (Array.isArray(team.roster)) {
        team.roster = team.roster.filter(id => {
            const p = getPlayer(id);
            return !!p;
        });
    }

    if (!team.depthOrder || Array.isArray(team.depthOrder)) {
        team.depthOrder = {
            'QB': [], 'RB': [], 'WR': [], 'TE': [], 'OL': [],
            'DL': [], 'LB': [], 'DB': []
        };
    }

    const rosterIds = new Set(team.roster);
    const assignedIds = new Set();

    Object.keys(team.depthOrder).forEach(posKey => {
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

    team.depthChart = { offense: {}, defense: {}, special: {} };
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

    const offFormKey = normalizeFormationKey(offenseFormations, team.formations.offense, 'Balanced');
    team.formations.offense = offFormKey;
    const offSlots = offenseFormations[offFormKey].slots;
    const sortedOffSlots = [...offSlots].sort((a, b) => getPriority(b) - getPriority(a));

    sortedOffSlots.forEach(slot => {
        let posKey = slot.replace(/\d+/g, '');
        if (['OT', 'OG', 'C'].includes(posKey)) posKey = 'OL';
        if (posKey === 'FB') posKey = 'RB';

        let searchBuckets = [slot, posKey];
        if (posKey === 'WR') searchBuckets.push('TE', 'RB', 'DB', 'QB');
        if (posKey === 'RB') searchBuckets.push('WR', 'DB', 'LB');
        if (posKey === 'TE') searchBuckets.push('WR', 'OL', 'LB');
        if (posKey === 'OL') searchBuckets.push('DL', 'TE', 'LB');
        if (posKey === 'QB') searchBuckets.push('WR', 'RB', 'DB');
        searchBuckets.push('WR', 'RB', 'TE', 'DB', 'LB', 'DL', 'OL', 'QB');

        team.depthChart.offense[slot] = getBestAvailable(searchBuckets, usedOffense);
    });

    const defFormKey = normalizeFormationKey(defenseFormations, team.formations?.defense || '3-2-3 Base', '3-2-3 Base');
    team.formations.defense = defFormKey;
    const defSlots = defenseFormations[defFormKey].slots;
    const sortedDefSlots = [...defSlots].sort((a, b) => getPriority(b) - getPriority(a));

    sortedDefSlots.forEach(slot => {
        let posKey = slot.replace(/\d+/g, '');
        if (['CB', 'S'].includes(posKey)) posKey = 'DB';
        if (['DE', 'DT'].includes(posKey)) posKey = 'DL';

        let searchBuckets = [slot, posKey];
        if (posKey === 'DB') searchBuckets.push('WR', 'RB', 'QB');
        if (posKey === 'LB') searchBuckets.push('DL', 'DB', 'TE', 'RB');
        if (posKey === 'DL') searchBuckets.push('LB', 'OL', 'TE');
        searchBuckets.push('DB', 'LB', 'DL', 'WR', 'RB', 'TE', 'OL', 'QB');

        team.depthChart.defense[slot] = getBestAvailable(searchBuckets, usedDefense);
    });

    const qbBucket = team.depthOrder['QB'] || [];
    const bestPunter = qbBucket.length > 1 ? qbBucket[1] : qbBucket[0];
    team.depthChart.special['P'] = bestPunter || null;

    if (offFormKey === 'Punt') {
        team.depthChart.offense['QB1'] = team.depthChart.special['P'] || bestPunter || null;
    }
}

export function aiSetDepthChart(team) {
    if (!team) return;

    if (team.isPlayerControlled) {
        rebuildDepthChartFromOrder(team);
        return;
    }

    const rosterObjs = getRosterObjects(team);
    if (!team || !team.formations || !Array.isArray(rosterObjs) || rosterObjs.length === 0) return;

    team.depthOrder = {
        'QB': [], 'RB': [], 'WR': [], 'TE': [], 'OL': [],
        'DL': [], 'LB': [], 'DB': []
    };

    const healthyPlayers = rosterObjs.filter(p => !p.status || p.status.duration === 0);
    const sortRoster = healthyPlayers.length > 0 ? healthyPlayers : rosterObjs;

    const offFormKey = normalizeFormationKey(offenseFormations, team.formations.offense, 'Balanced');
    const defFormKey = normalizeFormationKey(defenseFormations, team.formations.defense, '3-2-3 Base');

    const offSlots = offenseFormations[offFormKey]?.slots || [];
    const defSlots = defenseFormations[defFormKey]?.slots || [];

    const assignedOffense = new Set();
    const assignedDefense = new Set();

    const assignSmartStarter = (slot, side, assignedSet) => {
        let bestPlayer = null;
        let bestScore = -Infinity;

        let posKey = slot.replace(/\d+/g, '');
        if (['OT', 'OG', 'C'].includes(posKey)) posKey = 'OL';
        if (posKey === 'FB') posKey = 'RB';
        if (['CB', 'S'].includes(posKey)) posKey = 'DB';
        if (['DE', 'DT'].includes(posKey)) posKey = 'DL';

        sortRoster.forEach(p => {
            if (assignedSet.has(p.id)) return;

            let score = calculateSlotSuitability(p, slot, side, team);
            const isNatural = (p.favoriteOffensivePosition === posKey || p.favoriteDefensivePosition === posKey || p.pos === posKey);
            if (!isNatural) {
                score -= 30;
            }

            if (score > bestScore) {
                bestScore = score;
                bestPlayer = p;
            }
        });

        if (bestPlayer) {
            assignedSet.add(bestPlayer.id);
            team.depthOrder[slot] = [bestPlayer.id];
        }
    };

    const sortedOff = [...offSlots].sort((a, b) => getPriority(b) - getPriority(a));
    const sortedDef = [...defSlots].sort((a, b) => getPriority(b) - getPriority(a));

    sortedOff.forEach(slot => assignSmartStarter(slot, 'offense', assignedOffense));
    sortedDef.forEach(slot => assignSmartStarter(slot, 'defense', assignedDefense));

    const positions = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'];
    positions.forEach(pos => {
        const candidates = [...rosterObjs].sort((a, b) => {
            const ovrA = calculateOverall(a, pos);
            const ovrB = calculateOverall(b, pos);
            const isNaturalA = (a.favoriteOffensivePosition === pos || a.pos === pos) ? 10 : 0;
            const isNaturalB = (b.favoriteOffensivePosition === pos || b.pos === pos) ? 10 : 0;
            return (ovrB + isNaturalB) - (ovrA + isNaturalA);
        });

        team.depthOrder[pos] = candidates.map(p => p.id);
    });

    rebuildDepthChartFromOrder(team);
}

export function assignPlayerToSlot(team, playerId, slot, side) {
    if (!team) return false;

    let posKey = slot.replace(/\d+/g, '');
    if (['OT', 'OG', 'C'].includes(posKey)) posKey = 'OL';
    if (posKey === 'FB') posKey = 'RB';
    if (['CB', 'S', 'FS', 'SS'].includes(posKey)) posKey = 'DB';
    if (['DE', 'DT', 'NT'].includes(posKey)) posKey = 'DL';

    if (!team.depthOrder) team.depthOrder = {};
    if (!team.depthOrder[posKey]) team.depthOrder[posKey] = [];

    const groupList = team.depthOrder[posKey];
    const slotNumberMatch = slot.match(/\d+/);
    const targetIndex = slotNumberMatch ? Math.max(0, parseInt(slotNumberMatch[0], 10) - 1) : 0;

    if (!playerId || playerId === 'null' || playerId === '') {
        const currentPlayerId = team.depthChart?.[side]?.[slot];
        if (currentPlayerId) {
            const currentIndex = groupList.indexOf(currentPlayerId);
            if (currentIndex > -1) groupList.splice(currentIndex, 1);
            groupList.push(currentPlayerId);
            team.depthOrder[posKey] = groupList;
            rebuildDepthChartFromOrder(team);
        }
        return true;
    }

    const existingIndex = groupList.indexOf(playerId);
    if (existingIndex > -1) groupList.splice(existingIndex, 1);

    while (groupList.length < targetIndex) groupList.push(null);
    groupList.splice(targetIndex, 0, playerId);

    team.depthOrder[posKey] = groupList.filter(id => id !== null);
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
