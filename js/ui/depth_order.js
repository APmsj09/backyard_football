import * as Game from '../game.js';
import { getGameState, saveGameState, getPlayer } from '../game/state.js';
import { positionOverallWeights, estimateBestPosition, calculateOverall } from '../game/player.js';
import { formatHeight } from '../utils.js';
import { isPlayerViableForPosition } from '../game/depth_chart.js';

let depthOrderSortCol = 'overall';
let depthOrderSortDir = 'desc';
let activeDepthOrderTab = 'QB';

const OFFENSIVE_POSITION_FITS = ['QB', 'RB', 'WR', 'TE', 'OL'];
const DEFENSIVE_POSITION_FITS = ['DL', 'LB', 'DB'];

function getBestPositionFit(player, positions) {
    if (!player) return { position: '—', ovr: 0 };

    const eligiblePositions = positions.filter(position =>
        positionOverallWeights[position] &&
        isPlayerViableForPosition(player, position)
    );

    // Preserve a usable recommendation if no position passes the viability check.
    const positionsToEvaluate = eligiblePositions.length > 0
        ? eligiblePositions
        : positions.filter(position => positionOverallWeights[position]);

    const ratings = positionsToEvaluate.map(position => ({
        position,
        ovr: calculateOverall(player, position)
    }));

    ratings.sort((a, b) => b.ovr - a.ovr);

    return ratings[0] || { position: '—', ovr: 0 };
}

function getStat(player, attrKey) {
    if (!player || !player.attributes) return '-';
    if (attrKey === 'height') return formatHeight(player.attributes.physical?.height);
    if (attrKey === 'weight') return player.attributes.physical?.weight || '-';
    // Clean fallback to strength if throwPower is not yet set
    if (attrKey === 'throwPower') return player.attributes.technical?.throwPower ?? player.attributes.physical?.strength ?? '-';
    if (player.attributes.physical?.[attrKey] !== undefined) return player.attributes.physical[attrKey];
    if (player.attributes.mental?.[attrKey] !== undefined) return player.attributes.mental[attrKey];
    if (player.attributes.technical?.[attrKey] !== undefined) return player.attributes.technical[attrKey];
    return '-';
}

function createDepthCardHTML(player, index, groupKey, baseGroupKey = null) {
    if (!player || !player.attributes) {
        return { className: 'hidden', innerHTML: '' };
    }

    const calcPos = baseGroupKey || groupKey.replace(/\d/g, '');
    const ovr = calculateOverall(player, calcPos);
    let isStarterZone = false;

    if (/\d/.test(groupKey)) {
        if (index === 0) isStarterZone = true;
    } else {
        if (groupKey === 'QB' && index === 0) isStarterZone = true;
        else if (groupKey === 'RB' && index === 0) isStarterZone = true;
        else if (groupKey === 'WR' && index <= 2) isStarterZone = true;
        else if (groupKey === 'OL' && index <= 2) isStarterZone = true;
        else if (groupKey === 'TE' && index === 0) isStarterZone = true;
        else if (groupKey === 'DL' && index <= 2) isStarterZone = true; // 8-man base front starts 3 DLs
        else if (groupKey === 'LB' && index <= 1) isStarterZone = true; // Base starts 2 LBs
        else if (groupKey === 'DB' && index <= 2) isStarterZone = true; // Base starts 3 DBs (up to 5 in dime)
    }

    const rankStyle = isStarterZone ? 'border-l-4 border-green-500' : 'border-l-4 border-gray-300';
    const badge = isStarterZone ? '<span class="ml-2 text-[10px] bg-green-100 text-green-800 px-1 rounded font-bold shadow-sm border border-green-200">START</span>' : '';

    let keyAttrs = [];
    if (positionOverallWeights[calcPos]) {
        keyAttrs = Object.entries(positionOverallWeights[calcPos])
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(entry => entry[0]);
    }

    const attrMap = {
        throwingAccuracy: 'ACC', throwPower: 'POW', playbookIQ: 'IQ', strength: 'STR',
        speed: 'SPD', agility: 'AGI', catchingHands: 'HND',
        blocking: 'BLK', tackling: 'TKL', blockShedding: 'BSH',
        stamina: 'STA', toughness: 'TGH'
    };

    const attrString = keyAttrs.map(k => {
        const val = getStat(player, k);
        return `<span class="mr-2"><span class="text-gray-400 font-semibold">${attrMap[k] || k.substring(0, 3).toUpperCase()}:</span> <span class="text-gray-700 font-medium">${val}</span></span>`;
    }).join('');

    return {
        className: `depth-order-item bg-white hover:bg-amber-50 p-2 rounded border border-gray-200 shadow-sm cursor-move flex items-center justify-between relative group ${rankStyle}`,
        innerHTML: `
            <div class="flex items-center gap-3 flex-grow overflow-hidden">
                <span class="text-lg font-bold text-gray-400 w-6 text-center rank-number">${index + 1}</span>
                <div class="flex flex-col truncate">
                    <div class="flex items-center">
                        <span class="font-bold text-gray-800 text-sm truncate">${player.name}</span>
                        ${badge}
                    </div>
                    <div class="text-[10px] flex mt-0.5">${attrString}</div>
                </div>
            </div>
            <div class="flex flex-col items-end pl-2">
                <button class="remove-depth-item text-gray-300 hover:text-red-500 font-bold text-lg leading-none mb-1 opacity-0 group-hover:opacity-100 transition-opacity" 
                        title="Remove from depth chart"
                        data-player-id="${player.id}" 
                        data-group="${groupKey}">
                    &times;
                </button>
                <div class="text-right">
                    <span class="text-lg font-bold ${ovr >= 80 ? 'text-green-600' : 'text-gray-600'}">${ovr}</span>
                    <div class="text-[9px] text-gray-400 uppercase font-bold">OVR</div>
                </div>
            </div>`
    };
}

export function renderDepthOrderPane(gameState) {
    const pane = document.getElementById("depth-order-container");
    if (!pane || !gameState?.playerTeam) return;

    const team = gameState.playerTeam;
    Game.rebuildDepthChartFromOrder(team);
    const roster = Game.getRosterObjects(team);

    const offFormKey = team.formations?.offense || 'Balanced';
    const defFormKey = team.formations?.defense || '3-2-3 Base';
    const offChart = team.depthChart?.offense || {};
    const defChart = team.depthChart?.defense || {};

    const renderSlotCard = (slot, side) => {
        const playerId = side === 'offense' ? offChart[slot] : defChart[slot];
        const player = roster.find(p => p.id === playerId);
        const posKey = slot.replace(/\d/g, '');
        const isLocked = team.slotOverrides?.[side]?.[slot] !== undefined;

        if (!player) {
            return `
                <div class="border-2 border-dashed border-rose-300 bg-rose-50/50 p-2.5 rounded flex justify-between items-center cursor-pointer hover:bg-rose-100 transition"
                     onclick="window.openSlotPicker('${slot}', '${side}')">
                    <div>
                        <span class="font-black text-xs text-rose-800 uppercase">${slot}</span>
                        <p class="text-[10px] text-rose-600 font-bold">⚠️ Unassigned — Click to Assign</p>
                    </div>
                    <span class="text-xs bg-rose-200 text-rose-800 px-2 py-1 rounded font-bold">+ Pick</span>
                </div>`;
        }

        const ovr = calculateOverall(player, posKey);
        const isIronman = Object.values(offChart).includes(player.id) && Object.values(defChart).includes(player.id);
        const energy = Math.max(0, Math.round(100 - (player.fatigue || 0)));

        return `
            <div class="bg-white border ${isLocked ? 'border-amber-400 shadow-sm' : 'border-slate-200'} p-2.5 rounded flex justify-between items-center hover:border-slate-400 transition cursor-pointer"
                 onclick="window.openSlotPicker('${slot}', '${side}')">
                <div class="flex items-center gap-2.5 min-w-0">
                    <div class="w-8 h-8 rounded font-black text-xs flex items-center justify-center shrink-0 ${side === 'offense' ? 'bg-blue-900 text-blue-200' : 'bg-rose-900 text-rose-200'}">
                        ${slot}
                    </div>
                    <div class="min-w-0">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <span class="font-bold text-slate-900 text-xs truncate">${player.name}</span>
                            ${isLocked ? '<span class="text-[9px] bg-amber-100 text-amber-800 px-1 rounded font-bold">🔒 Locked</span>' : ''}
                            ${isIronman ? '<span class="text-[9px] bg-indigo-100 text-indigo-800 px-1 rounded font-bold">⚡ Two-Way</span>' : ''}
                        </div>
                        <div class="text-[10px] text-slate-500 font-mono flex gap-2">
                            <span>Age ${player.age}</span>
                            <span>•</span>
                            <span class="${energy < 60 ? 'text-rose-600 font-bold' : ''}">Energy: ${energy}%</span>
                        </div>
                    </div>
                </div>
                <div class="text-right shrink-0 pl-2">
                    <span class="text-base font-black ${ovr >= 70 ? 'text-emerald-700' : 'text-slate-800'}">${ovr}</span>
                    <span class="text-[9px] text-slate-400 uppercase font-bold block -mt-1">OVR</span>
                </div>
            </div>`;
    };

    pane.innerHTML = `
        <!-- Scheme Header & Quick Actions -->
        <div class="mb-4 bg-slate-900 text-white rounded p-3 flex flex-wrap justify-between items-center gap-3">
            <div class="flex items-center gap-4">
                <div>
                    <span class="text-slate-400 text-[10px] font-bold uppercase block tracking-wider">Offensive Scheme</span>
                    <span class="font-black text-blue-400 text-sm">${offFormKey} (8 Starters)</span>
                </div>
                <div class="border-l border-slate-700 pl-4">
                    <span class="text-slate-400 text-[10px] font-bold uppercase block tracking-wider">Defensive Scheme</span>
                    <span class="font-black text-rose-400 text-sm">${defFormKey} (8 Starters)</span>
                </div>
            </div>
            <div class="flex gap-2">
                <button class="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 font-bold px-3 py-1.5 rounded text-xs uppercase tracking-wider"
                        onclick="window.resetDepthChartOverrides()">
                    Reset Locks
                </button>
                <button class="bg-amber-500 hover:bg-amber-600 text-slate-950 font-black px-3 py-1.5 rounded text-xs uppercase tracking-wider shadow"
                        onclick="window.autoOptimizeLineup()">
                    ⚡ Auto-Optimize Best Lineup
                </button>
            </div>
        </div>

        <!-- Unified Lineup Grid -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <!-- Offensive Starters -->
            <div class="bg-slate-50 border border-slate-200 rounded p-3 space-y-2">
                <div class="flex justify-between items-center border-b border-slate-200 pb-2">
                    <h4 class="font-black text-xs text-blue-900 uppercase tracking-wider">Starting Offense</h4>
                    <span class="text-[10px] text-slate-500">Click a card to replace starter</span>
                </div>
                <div class="space-y-1.5">
                    ${Object.keys(offChart).map(slot => renderSlotCard(slot, 'offense')).join('')}
                </div>
            </div>

            <!-- Defensive Starters -->
            <div class="bg-slate-50 border border-slate-200 rounded p-3 space-y-2">
                <div class="flex justify-between items-center border-b border-slate-200 pb-2">
                    <h4 class="font-black text-xs text-rose-900 uppercase tracking-wider">Starting Defense</h4>
                    <span class="text-[10px] text-slate-500">Click a card to replace starter</span>
                </div>
                <div class="space-y-1.5">
                    ${Object.keys(defChart).map(slot => renderSlotCard(slot, 'defense')).join('')}
                </div>
            </div>
        </div>
    `;
}

// Slot Selection Modal
window.openSlotPicker = function(slot, side) {
    const gs = getGameState();
    const team = gs?.playerTeam;
    if (!team) return;

    const roster = Game.getRosterObjects(team);
    const posKey = slot.replace(/\d/g, '');
    const activeChart = side === 'offense' ? team.depthChart.offense : team.depthChart.defense;
    const currentStarterId = activeChart[slot];

    // Rank candidates by their suitability for this specific position
    const candidates = roster.map(p => ({
        player: p,
        ovr: calculateOverall(p, posKey),
        isCurrentStarter: p.id === currentStarterId,
        alreadyActiveOnThisSide: Object.values(activeChart).includes(p.id) && p.id !== currentStarterId
    })).sort((a, b) => b.ovr - a.ovr);

    const modalHtml = `
        <div class="space-y-2 max-h-[60vh] overflow-y-auto text-xs">
            <p class="text-slate-600 mb-2">Select a player to start at <b>${slot}</b> (${posKey}). Players already starting elsewhere on ${side} are flagged.</p>
            ${candidates.map(({ player, ovr, isCurrentStarter, alreadyActiveOnThisSide }) => `
                <div class="flex justify-between items-center p-2 rounded border ${isCurrentStarter ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200 hover:bg-slate-50'} transition">
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="font-bold text-slate-900">${player.name}</span>
                            ${isCurrentStarter ? '<span class="text-[9px] bg-amber-200 text-amber-900 px-1 rounded font-bold">Current Starter</span>' : ''}
                            ${alreadyActiveOnThisSide ? '<span class="text-[9px] bg-rose-100 text-rose-800 px-1 rounded font-bold">⚠️ Already Starting on ' + (side === 'offense' ? 'OFF' : 'DEF') + '</span>' : ''}
                        </div>
                        <span class="text-[10px] text-slate-500">Age: ${player.age} • SPD: ${player.attributes?.physical?.speed || 0} • STR: ${player.attributes?.physical?.strength || 0}</span>
                    </div>
                    <div class="flex items-center gap-3">
                        <span class="text-base font-black text-slate-800">${ovr} <span class="text-[9px] text-slate-400 font-normal">OVR</span></span>
                        <button class="bg-slate-900 hover:bg-slate-800 text-white font-bold px-3 py-1 rounded text-xs uppercase"
                                onclick="window.commitSlotAssignment('${player.id}', '${slot}', '${side}')">
                            ${isCurrentStarter ? 'Keep' : (alreadyActiveOnThisSide ? 'Swap' : 'Assign')}
                        </button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    Game.showModal(`Assign Starter for ${slot}`, modalHtml);
};

window.commitSlotAssignment = function(playerId, slot, side) {
    const gs = getGameState();
    const team = gs?.playerTeam;
    if (!team) return;

    Game.assignPlayerToSlot(team, playerId, slot, side);
    Game.rebuildDepthChartFromOrder(team);
    saveGameState();
    Game.hideModal();
    renderDepthOrderPane(gs);
    document.dispatchEvent(new CustomEvent('refresh-ui'));
};

window.autoOptimizeLineup = function() {
    const gs = getGameState();
    const team = gs?.playerTeam;
    if (!team) return;

    team.slotOverrides = { offense: {}, defense: {} };
    Game.populateNaturalDepthOrder(team);
    Game.rebuildDepthChartFromOrder(team);
    saveGameState();
    renderDepthOrderPane(gs);
    document.dispatchEvent(new CustomEvent('refresh-ui'));
};

window.resetDepthChartOverrides = function() {
    const gs = getGameState();
    const team = gs?.playerTeam;
    if (!team) return;

    team.slotOverrides = { offense: {}, defense: {} };
    Game.rebuildDepthChartFromOrder(team);
    saveGameState();
    renderDepthOrderPane(gs);
    document.dispatchEvent(new CustomEvent('refresh-ui'));
};

export function setupDepthOrderDragEvents() {
    const pane = document.getElementById('depth-order-container');
    if (!pane) return;

    if (pane.dataset.depthOrderEventsAttached !== '1') {
        pane.addEventListener('click', (e) => {
            const removeBtn = e.target.closest('.remove-depth-item');
            if (removeBtn) {
                const pid = removeBtn.dataset.playerId;
                const group = removeBtn.dataset.group;
                const gs = getGameState();
                if (gs?.playerTeam?.depthOrder?.[group]) {
                    const order = gs.playerTeam.depthOrder[group];
                    const index = order.indexOf(pid);

                    if (index !== -1) {
                        order.splice(index, 1);
                        order.push(pid);

                        applyDepthOrderToChart();
                    }
                }
            }
        });
        pane.dataset.depthOrderEventsAttached = '1';
    }

    const draggables = pane.querySelectorAll('.depth-order-item, .roster-row-item');
    const containers = pane.querySelectorAll('.depth-sortable-list');

    draggables.forEach(draggable => {
        draggable.ondragstart = (e) => {
            e.dataTransfer.effectAllowed = 'copyMove';
            e.dataTransfer.setData('text/plain', draggable.dataset.playerId);
            draggable.classList.add('opacity-50');
        };
        draggable.ondragend = () => {
            draggable.classList.remove('opacity-50');
        };
    });

    containers.forEach(container => {
        container.ondragover = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        };

        container.ondrop = (e) => {
            e.preventDefault();

            const playerId = e.dataTransfer.getData('text/plain');
            const groupKey = container.dataset.group;

            if (!playerId || !groupKey) return;

            const gs = getGameState();
            if (!gs?.playerTeam?.depthOrder) return;

            const player = getPlayer(playerId);

            if (!player || !isPlayerViableForPosition(player, groupKey)) {
                alert(
                    `${player?.name || 'That player'} is not eligible for the ${groupKey} depth group.`
                );
                return;
            }

            const targetOrder = gs.playerTeam.depthOrder[groupKey] || [];
            const targetItem = e.target.closest('.depth-order-item');

            // Dropping a player onto itself should not change their rank.
            if (targetItem && targetItem.dataset.playerId === playerId) {
                return;
            }

            // Default to the bottom if dropped into empty space.
            let insertAt = targetOrder.length;

            if (targetItem && container.contains(targetItem)) {
                const targetId = targetItem.dataset.playerId;
                const targetIndex = targetOrder.indexOf(targetId);

                if (targetIndex >= 0) {
                    const rect = targetItem.getBoundingClientRect();
                    const dropBelowMidpoint =
                        e.clientY > rect.top + rect.height / 2;

                    insertAt = targetIndex + (dropBelowMidpoint ? 1 : 0);
                }
            }

            // Remove any existing entry in this group before reinserting.
            const existingIndex = targetOrder.indexOf(playerId);

            if (existingIndex >= 0) {
                targetOrder.splice(existingIndex, 1);

                if (existingIndex < insertAt) {
                    insertAt--;
                }
            }

            insertAt = Math.max(0, Math.min(insertAt, targetOrder.length));
            targetOrder.splice(insertAt, 0, playerId);

            gs.playerTeam.depthOrder[groupKey] = targetOrder;

            applyDepthOrderToChart();
        };
    });
}

function applyDepthOrderToChart() {
    const gs = getGameState();
    if (!gs?.playerTeam) return;
    Game.rebuildDepthChartFromOrder(gs.playerTeam);
    saveGameState();
    renderDepthOrderPane(gs);
    document.dispatchEvent(new CustomEvent('refresh-ui'));
}

window.app_switchDepthTab = function (pos) {
    activeDepthOrderTab = pos;
    const gs = getGameState();
    if (gs) renderDepthOrderPane(gs);
};
