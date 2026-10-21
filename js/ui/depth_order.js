import * as Game from '../game.js';
import { getGameState, saveGameState } from '../game/state.js';
import { calculateOverall, estimateBestPosition } from '../game/player.js';
import { showModal, hideModal } from '../ui.js';

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

// Position-specific key skills to display in the swap modal
const POSITION_KEY_SKILLS = {
    QB: [
        { label: 'ACC', get: p => p.attributes?.technical?.throwingAccuracy ?? 50 },
        { label: 'POW', get: p => p.attributes?.technical?.throwPower ?? p.attributes?.physical?.strength ?? 50 },
        { label: 'IQ',  get: p => p.attributes?.mental?.playbookIQ ?? 50 },
        { label: 'SPD', get: p => p.attributes?.physical?.speed ?? 50 }
    ],
    RB: [
        { label: 'SPD', get: p => p.attributes?.physical?.speed ?? 50 },
        { label: 'AGI', get: p => p.attributes?.physical?.agility ?? 50 },
        { label: 'STR', get: p => p.attributes?.physical?.strength ?? 50 },
        { label: 'HND', get: p => p.attributes?.technical?.catchingHands ?? 50 }
    ],
    WR: [
        { label: 'SPD', get: p => p.attributes?.physical?.speed ?? 50 },
        { label: 'HND', get: p => p.attributes?.technical?.catchingHands ?? 50 },
        { label: 'AGI', get: p => p.attributes?.physical?.agility ?? 50 },
        { label: 'IQ',  get: p => p.attributes?.mental?.playbookIQ ?? 50 }
    ],
    TE: [
        { label: 'HND', get: p => p.attributes?.technical?.catchingHands ?? 50 },
        { label: 'BLK', get: p => p.attributes?.technical?.blocking ?? 50 },
        { label: 'STR', get: p => p.attributes?.physical?.strength ?? 50 },
        { label: 'SPD', get: p => p.attributes?.physical?.speed ?? 50 }
    ],
    OL: [
        { label: 'STR', get: p => p.attributes?.physical?.strength ?? 50 },
        { label: 'BLK', get: p => p.attributes?.technical?.blocking ?? 50 },
        { label: 'WGT', get: p => `${p.attributes?.physical?.weight ?? 180}#` },
        { label: 'IQ',  get: p => p.attributes?.mental?.playbookIQ ?? 50 }
    ],
    DL: [
        { label: 'STR', get: p => p.attributes?.physical?.strength ?? 50 },
        { label: 'BSH', get: p => p.attributes?.technical?.blockShedding ?? 50 },
        { label: 'TKL', get: p => p.attributes?.technical?.tackling ?? 50 },
        { label: 'SPD', get: p => p.attributes?.physical?.speed ?? 50 }
    ],
    LB: [
        { label: 'TKL', get: p => p.attributes?.technical?.tackling ?? 50 },
        { label: 'SPD', get: p => p.attributes?.physical?.speed ?? 50 },
        { label: 'IQ',  get: p => p.attributes?.mental?.playbookIQ ?? 50 },
        { label: 'STR', get: p => p.attributes?.physical?.strength ?? 50 }
    ],
    DB: [
        { label: 'SPD', get: p => p.attributes?.physical?.speed ?? 50 },
        { label: 'COV', get: p => (p.attributes?.technical?.coverage || p.attributes?.technical?.passCoverage) ?? 50 },
        { label: 'TKL', get: p => p.attributes?.technical?.tackling ?? 50 },
        { label: 'HND', get: p => p.attributes?.technical?.catchingHands ?? 50 }
    ]
};

window.openSlotPicker = function(arg1, arg2) {
    // 1. Normalize arguments so order doesn't matter: (side, slot) or (slot, side)
    const isFirstSide = (arg1 === 'offense' || arg1 === 'defense');
    const side = isFirstSide ? arg1 : arg2;
    const slot = isFirstSide ? arg2 : arg1;

    const gs = getGameState();
    const team = gs?.playerTeam;
    if (!team || !side || !slot) return;

    const roster = Game.getRosterObjects(team);
    const posKey = slot.replace(/\d/g, '');
    const activeChart = side === 'offense' ? team.depthChart.offense : team.depthChart.defense;
    const otherSide = side === 'offense' ? 'defense' : 'offense';
    const otherChart = team.depthChart[otherSide] || {};
    
    const currentStarterId = activeChart[slot];
    const currentStarter = roster.find(p => p.id === currentStarterId);
    const currentStarterOvr = currentStarter ? calculateOverall(currentStarter, posKey) : null;

    const skillConfigs = POSITION_KEY_SKILLS[posKey] || POSITION_KEY_SKILLS['WR'];

    // Rank all players by suitability for this position
    const candidates = roster.map(p => {
        const ovr = calculateOverall(p, posKey);
        const isCurrentStarter = p.id === currentStarterId;
        const existingSlotThisSide = Object.entries(activeChart).find(([s, id]) => id === p.id && s !== slot)?.[0] || null;
        const startsOnOtherSide = Object.entries(otherChart).find(([_, id]) => id === p.id)?.[0] || null;

        return {
            player: p,
            ovr,
            isCurrentStarter,
            existingSlotThisSide,
            startsOnOtherSide,
            delta: currentStarterOvr !== null && !isCurrentStarter ? (ovr - currentStarterOvr) : 0
        };
    }).sort((a, b) => b.ovr - a.ovr);

    const modalHtml = `
        <div class="space-y-3 text-xs text-left font-sans">
            <!-- Modal Subheader with Position Context -->
            <div class="bg-slate-900 text-white p-3 rounded flex justify-between items-center shadow-sm">
                <div>
                    <div class="flex items-center gap-2">
                        <span class="font-black text-sm uppercase text-amber-400">${side.toUpperCase()} ${slot}</span>
                        <span class="text-slate-400 font-mono text-[11px]">(${posKey} Position)</span>
                    </div>
                    <p class="text-[10px] text-slate-300 font-mono mt-0.5">
                        Key Skills: <b class="text-white">${skillConfigs.map(s => s.label).join(' • ')}</b>
                    </p>
                </div>
                <div class="flex items-center gap-2">
                    ${currentStarter ? `
                    <div class="text-right border-r border-slate-700 pr-3 mr-1">
                        <span class="text-[9px] uppercase tracking-wider text-slate-400 block">Current Starter</span>
                        <span class="font-bold text-slate-200 text-xs">${currentStarter.name} (${currentStarterOvr})</span>
                    </div>` : ''}
                    <button class="bg-rose-900/60 hover:bg-rose-800 text-rose-200 border border-rose-700 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider"
                            onclick="window.commitSlotAssignment('', '${slot}', '${side}')">
                        Vacate Slot
                    </button>
                </div>
            </div>

            <!-- Candidate Roster List -->
            <div class="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                ${candidates.map(({ player, ovr, isCurrentStarter, existingSlotThisSide, startsOnOtherSide, delta }) => {
                    const natPos = player.pos || estimateBestPosition(player);
                    const energy = Math.max(0, Math.round(100 - (player.fatigue || 0)));
                    const energyColor = energy >= 75 ? 'bg-emerald-500' : (energy >= 50 ? 'bg-amber-500' : 'bg-rose-500');
                    const isInjured = player.status?.duration > 0;

                    // Build skill stat pills with color highlights for high ratings (>= 70)
                    const skillPillsHtml = skillConfigs.map(cfg => {
                        const val = cfg.get(player);
                        const isHigh = typeof val === 'number' && val >= 70;
                        const isMid = typeof val === 'number' && val >= 55;
                        const valColor = isHigh ? 'text-emerald-700 font-black' : (isMid ? 'text-slate-900 font-bold' : 'text-slate-500');
                        return `
                            <span class="bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded text-[10px]">
                                <span class="text-slate-400 font-normal">${cfg.label}:</span>
                                <b class="${valColor}">${val}</b>
                            </span>`;
                    }).join('');

                    // Delta badge (+4 / -3 OVR vs current starter)
                    let deltaBadge = '';
                    if (!isCurrentStarter && currentStarterOvr !== null) {
                        if (delta > 0) deltaBadge = `<span class="text-[10px] font-mono font-bold text-emerald-600 bg-emerald-50 px-1 rounded border border-emerald-200">+${delta}</span>`;
                        else if (delta < 0) deltaBadge = `<span class="text-[10px] font-mono text-slate-400">${delta}</span>`;
                        else deltaBadge = `<span class="text-[10px] font-mono text-slate-400">EVEN</span>`;
                    }

                    const cardBg = isCurrentStarter
                        ? 'bg-amber-50/70 border-amber-300'
                        : (existingSlotThisSide ? 'bg-blue-50/30 border-blue-200 hover:border-blue-400' : 'bg-white border-slate-200 hover:border-slate-400');

                    return `
                    <div class="p-2.5 rounded border ${cardBg} shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 transition">
                        <!-- Left: Identity & Status Badges -->
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="font-bold text-slate-900 text-xs">${player.name}</span>
                                <span class="text-[9px] bg-slate-100 text-slate-700 font-mono font-bold px-1.5 py-0.2 rounded border">#${player.number || '--'} • Nat: ${natPos}</span>
                                ${isCurrentStarter ? '<span class="text-[8.5px] bg-amber-200 text-amber-900 font-black px-1.5 py-0.2 rounded uppercase">Current Starter</span>' : ''}
                                ${existingSlotThisSide ? `<span class="text-[8.5px] bg-blue-100 text-blue-900 border border-blue-300 font-black px-1.5 py-0.2 rounded uppercase">⇄ Starts at ${existingSlotThisSide} (Swap)</span>` : ''}
                                ${startsOnOtherSide ? `<span class="text-[8.5px] bg-indigo-100 text-indigo-900 border border-indigo-200 font-bold px-1.5 py-0.2 rounded">⚡ ${startsOnOtherSide} (${otherSide.substring(0,3).toUpperCase()})</span>` : ''}
                                ${isInjured ? `<span class="text-[8.5px] bg-rose-100 text-rose-800 font-bold px-1 rounded">🩹 Out ${player.status.duration}w</span>` : ''}
                            </div>

                            <!-- Middle: Position-Specific Key Skills & Stamina -->
                            <div class="flex flex-wrap items-center gap-1.5 mt-2 font-mono text-[10px]">
                                <div class="flex items-center gap-1 mr-2">
                                    <span class="text-slate-400 text-[9px] uppercase">Energy:</span>
                                    <div class="w-10 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                                        <div class="${energyColor} h-full" style="width: ${energy}%"></div>
                                    </div>
                                    <span class="${energy < 60 ? 'text-rose-600 font-bold' : 'text-slate-600'} text-[10px]">${energy}%</span>
                                </div>
                                ${skillPillsHtml}
                            </div>
                        </div>

                        <!-- Right: Overall Rating & Action Button -->
                        <div class="flex items-center gap-3 shrink-0 self-end sm:self-center pl-2">
                            <div class="text-right">
                                <div class="flex items-baseline justify-end gap-1">
                                    <span class="text-base font-black ${ovr >= 70 ? 'text-emerald-700' : 'text-slate-800'}">${ovr}</span>
                                    ${deltaBadge}
                                </div>
                                <span class="text-[8px] text-slate-400 font-bold uppercase block -mt-1">${posKey} OVR</span>
                            </div>

                            <button class="bg-slate-900 hover:bg-slate-800 text-white font-black px-3.5 py-1.5 rounded text-xs uppercase tracking-wider shadow-sm transition"
                                    onclick="window.commitSlotAssignment('${player.id}', '${slot}', '${side}')">
                                ${isCurrentStarter ? 'Keep' : (existingSlotThisSide ? 'Swap' : 'Assign')}
                            </button>
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>
    `;

    // FIX: Using showModal from ui.js instead of undefined Game.showModal
    showModal(`Assign Starter for ${side.toUpperCase()} ${slot}`, modalHtml);
};

// Safe alias for ui.js visual field circles
window.app_openSlotModal = window.openSlotPicker;

window.commitSlotAssignment = function(playerId, slot, side) {
    const gs = getGameState();
    const team = gs?.playerTeam;
    if (!team) return;

    Game.assignPlayerToSlot(team, playerId, slot, side);
    Game.rebuildDepthChartFromOrder(team);
    saveGameState();
    
    // FIX: Using hideModal from ui.js instead of undefined Game.hideModal
    hideModal();
    
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