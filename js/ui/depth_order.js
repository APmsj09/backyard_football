import * as Game from '../game.js';
import { getGameState, saveGameState, getPlayer } from '../game/state.js';
import { positionOverallWeights, estimateBestPosition, calculateOverall } from '../game/player.js';
import { formatHeight } from '../utils.js';

let depthOrderSortCol = 'overall';
let depthOrderSortDir = 'desc';
let activeDepthOrderTab = 'QB';

function getStat(player, attrKey) {
    if (!player || !player.attributes) return '-';
    if (attrKey === 'height') return formatHeight(player.attributes.physical?.height);
    if (attrKey === 'weight') return player.attributes.physical?.weight || '-';
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
        else if (['DL', 'LB', 'DB'].includes(groupKey) && index <= 1) isStarterZone = true;
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
        throwingAccuracy: 'THR', playbookIQ: 'IQ', strength: 'STR',
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

    Game.rebuildDepthChartFromOrder(gameState.playerTeam);
    const team = gameState.playerTeam;
    let roster = Game.getUIRosterObjects(team);
    const depthOrder = team.depthOrder || {};
    const displayOrder = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'];

    let tabsHtml = `<div class="flex flex-wrap gap-1 mb-3 pb-2 border-b border-gray-200 shrink-0">`;
    displayOrder.forEach((pos) => {
        const isActive = pos === activeDepthOrderTab;
        const colorClass = isActive
            ? 'bg-amber-500 text-white shadow-md transform scale-105 z-10'
            : 'bg-gray-200 text-gray-700 hover:bg-gray-300';

        tabsHtml += `<button class="px-3 py-1.5 rounded font-bold text-xs transition-all ${colorClass}" 
                             onclick="window.app_switchDepthTab('${pos}')">
                             ${pos}
                     </button>`;
    });
    tabsHtml += `</div>`;

    const slotMappings = {
        'QB': [{ id: 'QB1', name: 'Quarterback' }],
        'RB': [{ id: 'RB1', name: 'Halfback 1' }, { id: 'RB2', name: 'Fullback / RB2' }],
        'WR': [{ id: 'WR1', name: 'WR1 (X)' }, { id: 'WR2', name: 'WR2 (Z)' }, { id: 'WR3', name: 'WR3 (Slot)' }, { id: 'WR4', name: 'WR4' }],
        'TE': [{ id: 'TE1', name: 'Tight End 1' }, { id: 'TE2', name: 'Tight End 2' }],
        'OL': [{ id: 'OL1', name: 'Left OL' }, { id: 'OL2', name: 'Center' }, { id: 'OL3', name: 'Right OL' }],
        'DL': [{ id: 'DL1', name: 'Left Edge/DT' }, { id: 'DL2', name: 'Interior DL' }, { id: 'DL3', name: 'Right Edge/DT' }],
        'LB': [{ id: 'LB1', name: 'Outside LB' }, { id: 'LB2', name: 'Middle LB' }, { id: 'LB3', name: 'LB3' }],
        'DB': [{ id: 'DB1', name: 'Cornerback 1' }, { id: 'DB2', name: 'Cornerback 2' }, { id: 'DB3', name: 'Safety / Nickel' }]
    };

    let listsHtml = ``;
    displayOrder.forEach((groupKey) => {
        const isHidden = groupKey !== activeDepthOrderTab ? 'hidden' : '';
        listsHtml += `<div id="group-${groupKey}" class="depth-group-container ${isHidden} grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 pb-8">`;

        const slots = slotMappings[groupKey] || [];
        slots.forEach(slotInfo => {
            const sId = slotInfo.id;
            const sName = slotInfo.name;
            const idList = depthOrder[sId] || [];
            let players = idList.map(id => roster.find(p => p.id === id)).filter(Boolean);

            listsHtml += `
            <div class="bg-gray-50 border border-gray-300 rounded-lg flex flex-col shadow-sm">
                <div class="bg-gray-200 px-2 py-1.5 border-b border-gray-300 rounded-t-lg flex justify-between items-center shrink-0">
                    <h5 class="font-bold text-gray-800 text-xs uppercase tracking-wider">${sName}</h5>
                    <span class="text-[9px] font-bold text-gray-500 bg-white px-1.5 py-0.5 rounded shadow-sm">${players.length}</span>
                </div>
                <div class="depth-sortable-list flex-grow p-1.5 space-y-1.5 min-h-[100px] overflow-y-auto max-h-[300px]" data-group="${sId}">
                    ${players.map((p, i) => {
                        const cardData = createDepthCardHTML(p, i, sId, groupKey);
                        return `<div class="${cardData.className}" draggable="true" data-player-id="${p.id}">${cardData.innerHTML}</div>`;
                    }).join('')}
                    ${players.length === 0 ? `<div class="text-gray-400 text-xs italic p-2 text-center border-2 border-dashed border-gray-300 rounded h-full flex items-center justify-center opacity-70">Drag here</div>` : ''}
                </div>
            </div>`;
        });
        listsHtml += `</div>`;
    });

    const availableRoster = roster.slice().sort((a, b) => {
        const valA = depthOrderSortCol === 'overall' ? calculateOverall(a, a.pos || 'ATH') : (a[depthOrderSortCol] || 0);
        const valB = depthOrderSortCol === 'overall' ? calculateOverall(b, b.pos || 'ATH') : (b[depthOrderSortCol] || 0);
        return depthOrderSortDir === 'asc' ? (valA < valB ? -1 : 1) : (valB < valA ? -1 : 1);
    });

    pane.innerHTML = `
        <div class="mb-3 bg-blue-50 border border-blue-200 rounded-lg p-2.5 flex flex-col sm:flex-row justify-between items-center gap-2 shrink-0">
            <div>
                <h4 class="font-bold text-sm text-blue-900 leading-tight">Positional Hierarchy</h4>
                <p class="text-[11px] text-blue-700">Drag players into slots. Number 1 is your starter.</p>
            </div>
            <button id="auto-reorder-btn" class="btn bg-white border border-gray-300 text-gray-700 hover:bg-gray-100 font-bold py-1 px-3 rounded shadow-sm text-xs">Auto-Sort All</button>
        </div>
        <div class="flex flex-col lg:flex-row gap-4 h-full min-h-0 overflow-hidden pb-4">
            <div class="w-full lg:w-7/12 xl:w-3/5 flex flex-col min-h-0 h-full">
                ${tabsHtml}
                <div id="depth-lists-container" class="flex-grow overflow-y-auto pr-1 hide-scrollbar">
                    ${listsHtml}
                </div>
            </div>
            <div class="w-full lg:w-5/12 xl:w-2/5 flex flex-col border-l border-gray-200 pl-0 lg:pl-3 min-h-0 h-full">
                <h4 class="font-bold text-gray-800 text-sm mb-1 shrink-0">Available Roster</h4>
                <div class="flex-grow overflow-auto border border-gray-300 rounded shadow-inner bg-white hide-scrollbar">
                    <table class="min-w-full text-xs">
                        <thead class="bg-gray-800 text-white sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th class="py-1.5 px-2 text-left">Name</th>
                                <th class="py-1.5 px-1 text-center">Pos</th>
                                <th class="py-1.5 px-1 text-center">OVR</th>
                                <th class="py-1.5 px-1 text-center">SPD</th>
                                <th class="py-1.5 px-1 text-center">STR</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-100">
                            ${availableRoster.map(p => {
                                const pos = p.pos || estimateBestPosition(p);
                                const ovr = calculateOverall(p, pos);
                                return `
                                <tr class="roster-row-item cursor-move hover:bg-amber-100 bg-white" draggable="true" data-player-id="${p.id}">
                                    <td class="py-1.5 px-2 font-semibold truncate max-w-[100px]">${p.name}</td>
                                    <td class="py-1.5 px-1 text-center text-gray-500">${pos}</td>
                                    <td class="py-1.5 px-1 text-center font-bold ${ovr >= 80 ? 'text-green-600' : 'text-gray-800'}">${ovr}</td>
                                    <td class="py-1.5 px-1 text-center text-blue-600">${p.attributes?.physical?.speed || 0}</td>
                                    <td class="py-1.5 px-1 text-center text-gray-600">${p.attributes?.physical?.strength || 0}</td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    const autoBtn = pane.querySelector('#auto-reorder-btn');
    if (autoBtn) {
        autoBtn.onclick = () => {
            if (confirm("Auto-set lineup by overall rating?")) {
                Game.aiSetDepthChart(gameState.playerTeam);
                saveGameState();
                document.dispatchEvent(new CustomEvent('refresh-ui'));
            }
        };
    }
    setupDepthOrderDragEvents();
}

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
                    gs.playerTeam.depthOrder[group] = gs.playerTeam.depthOrder[group].filter(id => id !== pid);
                    applyDepthOrderToChart();
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
            if (!gs.playerTeam.depthOrder[groupKey]) gs.playerTeam.depthOrder[groupKey] = [];

            gs.playerTeam.depthOrder[groupKey] = gs.playerTeam.depthOrder[groupKey].filter(id => id !== playerId);
            gs.playerTeam.depthOrder[groupKey].unshift(playerId);

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
