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

    // Read active scheme formations
    const offFormKey = team.formations?.offense || 'Balanced';
    const defFormKey = team.formations?.defense || '3-2-3 Base';
    const offChart = team.depthChart?.offense || {};
    const defChart = team.depthChart?.defense || {};

    // Header displaying scheme requirements
    const schemeContextHtml = `
        <div class="mb-3 bg-slate-900 text-white rounded p-3 border border-slate-700 flex flex-wrap justify-between items-center gap-2 text-xs shrink-0">
            <div class="flex items-center gap-4">
                <div>
                    <span class="text-slate-400 text-[10px] font-bold uppercase tracking-wider block">Active Offense</span>
                    <span class="font-black text-blue-400 text-sm">${offFormKey}</span>
                </div>
                <div class="border-l border-slate-700 pl-4">
                    <span class="text-slate-400 text-[10px] font-bold uppercase tracking-wider block">Active Defense</span>
                    <span class="font-black text-rose-400 text-sm">${defFormKey}</span>
                </div>
            </div>
            <div class="text-[11px] text-slate-300 bg-slate-800 px-2.5 py-1 rounded border border-slate-700">
                Rankings below auto-deploy into your active schemes. Drag cards or click ✕ to demote.
            </div>
        </div>
    `;

    let tabsHtml = `<div class="flex flex-wrap gap-1 mb-3 pb-2 border-b border-gray-200 shrink-0">`;
    displayOrder.forEach((pos) => {
        const isActive = pos === activeDepthOrderTab;
        const count = (depthOrder[pos] || []).length;
        const colorClass = isActive
            ? 'bg-slate-900 text-white shadow-sm'
            : 'bg-slate-200 text-slate-700 hover:bg-slate-300';

        tabsHtml += `<button class="px-3 py-1.5 rounded font-bold text-xs transition-all ${colorClass}" 
                             onclick="window.app_switchDepthTab('${pos}')">
                             ${pos} (${count})
                     </button>`;
    });
    tabsHtml += `</div>`;

    let listsHtml = ``;
    displayOrder.forEach((groupKey) => {
        const isHidden = groupKey !== activeDepthOrderTab ? 'hidden' : '';
        const idList = depthOrder[groupKey] || [];
        const players = idList.map(id => roster.find(p => p.id === id)).filter(Boolean);

        listsHtml += `
        <div id="group-${groupKey}" class="depth-group-container ${isHidden} flex flex-col pb-6">
            <div class="bg-white border border-slate-300 rounded-sm shadow-sm overflow-hidden flex flex-col">
                <div class="bg-slate-800 px-3 py-2 flex justify-between items-center text-white">
                    <span class="font-black text-xs uppercase tracking-wider">${groupKey} PRIORITY HIERARCHY</span>
                    <span class="text-[10px] text-slate-300 font-mono">Rank 1 gets first priority for open ${groupKey} slots</span>
                </div>
                <div class="depth-sortable-list p-2 space-y-2 min-h-[140px] max-h-[500px] overflow-y-auto" data-group="${groupKey}">
                    ${players.map((p, i) => {
                        const ovr = calculateOverall(p, groupKey);
                        const offSlot = Object.entries(offChart).find(([_, id]) => id === p.id)?.[0];
                        const defSlot = Object.entries(defChart).find(([_, id]) => id === p.id)?.[0];
                        const isIronman = offSlot && defSlot;
                        const energy = Math.max(0, Math.round(100 - (p.fatigue || 0)));

                        let deploymentBadge = '<span class="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded text-[9px] font-bold">🪑 Reserve</span>';
                        if (isIronman) {
                            deploymentBadge = `<span class="bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.5 rounded text-[9px] font-black">⚡ STARTS: ${offSlot} & ${defSlot}</span>`;
                        } else if (offSlot) {
                            deploymentBadge = `<span class="bg-blue-100 text-blue-900 border border-blue-200 px-1.5 py-0.5 rounded text-[9px] font-bold">🏈 Starts ${offSlot}</span>`;
                        } else if (defSlot) {
                            deploymentBadge = `<span class="bg-red-100 text-red-900 border border-red-200 px-1.5 py-0.5 rounded text-[9px] font-bold">🛡️ Starts ${defSlot}</span>`;
                        }

                        return `
                        <div class="depth-order-item bg-white hover:bg-slate-50 p-2.5 rounded border border-slate-200 shadow-sm cursor-move flex items-center justify-between group transition-all" draggable="true" data-player-id="${p.id}">
                            <div class="flex items-center gap-3 truncate pr-2">
                                <span class="font-mono text-sm font-black text-slate-400 w-5 text-center">${i + 1}</span>
                                <div class="flex flex-col truncate">
                                    <div class="flex items-center gap-2">
                                        <span class="font-bold text-slate-900 text-xs truncate">${p.name}</span>
                                        ${deploymentBadge}
                                    </div>
                                    <div class="text-[10px] text-slate-500 font-mono mt-0.5 flex gap-2">
                                        <span>Age: ${p.age}</span>
                                        <span>•</span>
                                        <span>Energy: ${energy}%</span>
                                        <span>•</span>
                                        <span class="text-indigo-600 font-sans font-bold">${p.personality?.clique || 'Regular'}</span>
                                    </div>
                                </div>
                            </div>
                            <div class="flex items-center gap-3 shrink-0">
                                <div class="text-right">
                                    <span class="text-base font-black text-slate-900">${ovr}</span>
                                    <span class="text-[9px] text-slate-400 font-bold block uppercase -mt-1">${groupKey}</span>
                                </div>
                                <button class="remove-depth-item text-slate-300 hover:text-rose-600 font-bold text-base p-1" title="Demote to bottom" data-player-id="${p.id}" data-group="${groupKey}">✕</button>
                            </div>
                        </div>`;
                    }).join('')}
                    ${players.length === 0 ? `<div class="p-6 text-center text-xs text-slate-400 italic">Drag players here from the available roster on the right.</div>` : ''}
                </div>
            </div>
        </div>`;
    });

    const availableRoster = roster.slice().sort((a, b) => {
        const valA = depthOrderSortCol === 'overall' ? calculateOverall(a, a.pos || 'ATH') : (a[depthOrderSortCol] || 0);
        const valB = depthOrderSortCol === 'overall' ? calculateOverall(b, b.pos || 'ATH') : (b[depthOrderSortCol] || 0);
        return depthOrderSortDir === 'asc' ? (valA < valB ? -1 : 1) : (valB < valA ? -1 : 1);
    });

    pane.innerHTML = `
        ${schemeContextHtml}
        <div class="mb-3 bg-slate-100 border border-slate-300 rounded p-2.5 flex flex-col sm:flex-row justify-between items-center gap-2 shrink-0">
            <div>
                <h4 class="font-bold text-xs text-slate-900 uppercase tracking-wider">Depth Hierarchy</h4>
                <p class="text-[11px] text-slate-600">Reorder to set priority. The engine automatically deploys your highest ranked available players into active formation slots.</p>
            </div>
            <button id="auto-reorder-btn" class="btn bg-slate-900 text-white hover:bg-slate-800 font-bold py-1 px-3 rounded shadow-sm text-xs uppercase tracking-wider">Auto-Sort By Rating</button>
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
