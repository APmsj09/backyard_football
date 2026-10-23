import * as Game from '../game.js';
import { getGameState, saveGameState } from '../game/state.js';
import { calculateOverall, estimateBestPosition } from '../game/player.js';
import { showModal, hideModal } from '../ui.js';
import { formatHeight } from '../utils.js';

export function renderDepthOrderPane(gameState) {
    const pane = document.getElementById("depth-order-container");
    if (!pane || !gameState?.playerTeam) return;

    const team = gameState.playerTeam;

    // Isolate specialTeams & specialists directly on team object
    if (!team.specialTeams) team.specialTeams = team.depthChart?.specialTeams || {};
    if (!team.specialists) team.specialists = {};

    Game.rebuildDepthChartFromOrder(team);

    if (!team.depthChart) team.depthChart = {};
    team.depthChart.specialTeams = team.specialTeams;

    const roster = Game.getRosterObjects(team);

    const offFormKey = team.formations?.offense || 'Balanced';
    const defFormKey = team.formations?.defense || '3-2-3';
    const offChart = team.depthChart?.offense || {};
    const defChart = team.depthChart?.defense || {};
    const stChart = team.specialTeams;
    const specChart = team.specialists;

    const renderSlotCard = (slot, side) => {
        let playerId;
        if (side === 'offense') playerId = offChart[slot];
        else if (side === 'defense') playerId = defChart[slot];
        else if (side === 'specialTeams') playerId = stChart[slot];
        else playerId = specChart[slot];

        const player = roster.find(p => p && p.id === playerId);
        const posKey = slot.replace(/\d/g, '');
        let evalPosKey = posKey;
        if (posKey === 'PR' || posKey === 'SLOT') evalPosKey = 'WR';
        else if (posKey === 'P') evalPosKey = 'QB';
        else if (posKey === 'FB') evalPosKey = 'TE';
        else if (posKey === 'NCB') evalPosKey = 'DB';

        const isLocked = (side === 'specialTeams' || side === 'specialists')
            ? Boolean(playerId)
            : team.slotOverrides?.[side]?.[slot] !== undefined;

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

        const ovr = calculateOverall(player, evalPosKey);
        const isIronman = Object.values(offChart).includes(player.id) && Object.values(defChart).includes(player.id);
        const energy = Math.max(0, Math.round(100 - (player.fatigue || 0)));
        const badgeColor = side === 'offense' ? 'bg-blue-900 text-blue-200' : (side === 'defense' ? 'bg-rose-900 text-rose-200' : (side === 'specialTeams' ? 'bg-amber-900 text-amber-200' : 'bg-indigo-900 text-indigo-200'));

        return `
            <div class="bg-white border ${isLocked ? 'border-amber-400 shadow-sm' : 'border-slate-200'} p-2.5 rounded flex justify-between items-center hover:border-slate-400 transition cursor-pointer"
                 onclick="window.openSlotPicker('${slot}', '${side}')">
                <div class="flex items-center gap-2.5 min-w-0">
                    <div class="w-8 h-8 rounded font-black text-xs flex items-center justify-center shrink-0 ${badgeColor}">
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
                    <span class="text-[9px] text-slate-400 uppercase font-bold block -mt-1">${posKey} OVR</span>
                </div>
            </div>`;
    };

    pane.innerHTML = `
        <!-- Scheme Header & Quick Actions -->
        <div class="mb-4 bg-slate-900 text-white rounded p-3 flex flex-wrap justify-between items-center gap-3 shrink-0">
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

        <!-- 3-Column Unified Lineup Grid -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 pb-6">
            <!-- Offensive Starters -->
            <div class="bg-slate-50 border border-slate-200 rounded p-3 space-y-2">
                <div class="flex justify-between items-center border-b border-slate-200 pb-2">
                    <h4 class="font-black text-xs text-blue-900 uppercase tracking-wider">Starting Offense</h4>
                </div>
                <div class="space-y-1.5">
                    ${Object.keys(offChart).map(slot => renderSlotCard(slot, 'offense')).join('')}
                </div>
            </div>

            <!-- Defensive Starters -->
            <div class="bg-slate-50 border border-slate-200 rounded p-3 space-y-2">
                <div class="flex justify-between items-center border-b border-slate-200 pb-2">
                    <h4 class="font-black text-xs text-rose-900 uppercase tracking-wider">Starting Defense</h4>
                </div>
                <div class="space-y-1.5">
                    ${Object.keys(defChart).map(slot => renderSlotCard(slot, 'defense')).join('')}
                </div>
            </div>

            <!-- Special Teams & Situational Specialists (Col 3) -->
            <div class="space-y-4">
                <!-- Special Teams -->
                <div class="bg-slate-50 border border-slate-200 rounded p-3 space-y-2">
                    <div class="flex justify-between items-center border-b border-slate-200 pb-2">
                        <h4 class="font-black text-xs text-amber-900 uppercase tracking-wider">Special Teams</h4>
                        <span class="text-[10px] text-slate-500 font-mono">Specialists</span>
                    </div>
                    <div class="space-y-1.5">
                        ${renderSlotCard('PR', 'specialTeams')}
                        ${renderSlotCard('P', 'specialTeams')}
                    </div>
                    <div class="mt-2 text-[10px] text-slate-500 italic p-1 border-t border-slate-200 space-y-0.5">
                        <div><b>PR:</b> Punt returner (Speed & Hands).</div>
                        <div><b>P:</b> Punter (Throw Power & Accuracy).</div>
                    </div>
                </div>

                <!-- Package Specialists -->
                <div class="bg-slate-50 border border-slate-200 rounded p-3 space-y-2">
                    <div class="flex justify-between items-center border-b border-slate-200 pb-2">
                        <h4 class="font-black text-xs text-indigo-900 uppercase tracking-wider">Package Specialists</h4>
                        <span class="text-[10px] text-slate-500 font-mono">Sub-Packages</span>
                    </div>
                    <div class="space-y-1.5">
                        ${renderSlotCard('FB', 'specialists')}
                        ${renderSlotCard('SLOT', 'specialists')}
                        ${renderSlotCard('NCB', 'specialists')}
                    </div>
                    <div class="mt-2 text-[10px] text-slate-500 italic p-1 border-t border-slate-200 space-y-0.5">
                        <div><b>FB:</b> Lead blocker in Power/Jumbo sets.</div>
                        <div><b>SLOT:</b> Slot WR in Spread/Trips sets.</div>
                        <div><b>NCB:</b> Extra DB in Nickel/Dime packages.</div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Position-specific key skills to display in the swap modal
const POSITION_KEY_SKILLS = {
    PR: [
        { label: 'SPD', get: p => p.attributes?.physical?.speed ?? 50 },
        { label: 'AGI', get: p => p.attributes?.physical?.agility ?? 50 },
        { label: 'HND', get: p => p.attributes?.technical?.catchingHands ?? 50 },
        { label: 'IQ',  get: p => p.attributes?.mental?.playbookIQ ?? 50 }
    ],
    P: [
        { label: 'POW', get: p => p.attributes?.technical?.throwPower ?? p.attributes?.physical?.strength ?? 50 },
        { label: 'ACC', get: p => p.attributes?.technical?.throwingAccuracy ?? 50 },
        { label: 'STR', get: p => p.attributes?.physical?.strength ?? 50 },
        { label: 'IQ',  get: p => p.attributes?.mental?.playbookIQ ?? 50 }
    ],
    FB: [
        { label: 'STR', get: p => p.attributes?.physical?.strength ?? 50 },
        { label: 'BLK', get: p => p.attributes?.technical?.blocking ?? 50 },
        { label: 'WGT', get: p => `${p.attributes?.physical?.weight ?? 180}#` },
        { label: 'IQ',  get: p => p.attributes?.mental?.playbookIQ ?? 50 }
    ],
    SLOT: [
        { label: 'AGI', get: p => p.attributes?.physical?.agility ?? 50 },
        { label: 'HND', get: p => p.attributes?.technical?.catchingHands ?? 50 },
        { label: 'SPD', get: p => p.attributes?.physical?.speed ?? 50 },
        { label: 'IQ',  get: p => p.attributes?.mental?.playbookIQ ?? 50 }
    ],
    NCB: [
        { label: 'COV', get: p => (p.attributes?.technical?.coverage || p.attributes?.technical?.passCoverage) ?? 50 },
        { label: 'AGI', get: p => p.attributes?.physical?.agility ?? 50 },
        { label: 'SPD', get: p => p.attributes?.physical?.speed ?? 50 },
        { label: 'TKL', get: p => p.attributes?.technical?.tackling ?? 50 }
    ],
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
    // Normalize arguments so order doesn't matter: (side, slot) or (slot, side)
    const isSide = (arg) => ['offense', 'defense', 'specialTeams', 'specialists'].includes(arg);
    const side = isSide(arg1) ? arg1 : (isSide(arg2) ? arg2 : 'specialists');
    const slot = !isSide(arg1) ? arg1 : arg2;

    const gs = getGameState();
    const team = gs?.playerTeam;
    if (!team || !side || !slot) return;

    const roster = Game.getRosterObjects(team);
    const posKey = slot.replace(/\d/g, '');
    let evalPosKey = posKey;
    if (posKey === 'PR' || posKey === 'SLOT') evalPosKey = 'WR';
    else if (posKey === 'P') evalPosKey = 'QB';
    else if (posKey === 'FB') evalPosKey = 'TE';
    else if (posKey === 'NCB') evalPosKey = 'DB';

    let activeChart;
    if (side === 'offense') activeChart = team.depthChart?.offense || {};
    else if (side === 'defense') activeChart = team.depthChart?.defense || {};
    else if (side === 'specialTeams') activeChart = team.specialTeams || team.depthChart?.specialTeams || {};
    else activeChart = team.specialists || {};

    const otherSide = side === 'offense' ? 'defense' : 'offense';
    const otherChart = team.depthChart?.[otherSide] || {};

    const currentStarterId = activeChart[slot];
    const currentStarter = roster.find(p => p && p.id === currentStarterId);
    const currentStarterOvr = currentStarter ? calculateOverall(currentStarter, evalPosKey) : null;

    const skillConfigs = POSITION_KEY_SKILLS[posKey] || POSITION_KEY_SKILLS[evalPosKey] || POSITION_KEY_SKILLS['WR'];

    // Rank all players by suitability for this position
    const candidates = roster.map(p => {
        const ovr = calculateOverall(p, evalPosKey);
        const isCurrentStarter = p.id === currentStarterId;
        const existingSlotThisSide = Object.entries(activeChart).find(([s, id]) => id === p.id && s !== slot)?.[0] || null;
        const startsOnOtherSide = Object.entries(otherChart).find(([_, id]) => id === p.id)?.[0] || null;
        const otherOvr = startsOnOtherSide ? calculateOverall(p, startsOnOtherSide.replace(/\d/g, '')) : null;

        return {
            player: p,
            ovr,
            isCurrentStarter,
            existingSlotThisSide,
            startsOnOtherSide,
            otherOvr,
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
            <div class="space-y-2 max-h-[60vh] overflow-y-auto pr-1 pb-4">
                ${candidates.map(({ player, ovr, isCurrentStarter, existingSlotThisSide, startsOnOtherSide, otherOvr, delta }) => {
                    const natPos = player.pos || estimateBestPosition(player);
                    const energy = Math.max(0, Math.round(100 - (player.fatigue || 0)));
                    const energyColor = energy >= 75 ? 'bg-emerald-500' : (energy >= 50 ? 'bg-amber-500' : 'bg-rose-500');
                    const stamina = player.attributes?.physical?.stamina || 50;
                    const isInjured = player.status?.duration > 0;
                    const height = player.attributes?.physical?.height || 70;
                    const weight = player.attributes?.physical?.weight || 200;
                    const pot = player.potential || '?';

                    // Build skill stat pills with color highlights for high ratings (>= 70)
                    const skillPillsHtml = skillConfigs.map(cfg => {
                        const val = cfg.get(player);
                        const isHigh = typeof val === 'number' && val >= 70;
                        const isMid = typeof val === 'number' && val >= 55;
                        const valColor = isHigh ? 'text-emerald-700 font-black' : (isMid ? 'text-slate-900 font-bold' : 'text-slate-500');
                        return `
                            <span class="bg-white border border-slate-200 px-1.5 py-0.5 rounded text-[10px] shadow-sm">
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
                    <div class="p-3 rounded border ${cardBg} shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 transition cursor-pointer" onclick="window.commitSlotAssignment('${player.id}', '${slot}', '${side}')">
                        <!-- Left Info -->
                        <div class="flex-1 min-w-0 w-full">
                            <!-- Top row: Name, physicals -->
                            <div class="flex items-center justify-between gap-2 flex-wrap mb-1.5">
                                <div class="flex items-center gap-2">
                                    <span class="font-black text-slate-900 text-sm">${player.name}</span>
                                    <span class="text-[10px] text-slate-500 font-mono border-l border-slate-300 pl-2">#${player.number || '--'} • Nat: ${natPos}</span>
                                </div>
                                <div class="text-[10px] text-slate-500 font-mono font-semibold">
                                    ${player.age}yo • <b class="text-amber-700">${pot} Pot</b> • ${formatHeight(height)} • ${weight}lbs
                                </div>
                            </div>

                            <!-- Badges Row -->
                            <div class="flex items-center gap-1.5 flex-wrap mb-2">
                                ${isCurrentStarter ? '<span class="text-[9px] bg-amber-200 text-amber-900 font-black px-1.5 py-0.5 rounded uppercase">Current Starter</span>' : ''}
                                ${existingSlotThisSide ? `<span class="text-[9px] bg-blue-100 text-blue-900 border border-blue-300 font-black px-1.5 py-0.5 rounded uppercase">⇄ Starts at ${existingSlotThisSide}</span>` : ''}
                                ${startsOnOtherSide ? `<span class="text-[9px] bg-indigo-100 text-indigo-900 border border-indigo-200 font-bold px-1.5 py-0.5 rounded">⚡ 2-Way: ${startsOnOtherSide} (${otherOvr})</span>` : ''}
                                ${isInjured ? `<span class="text-[9px] bg-rose-100 text-rose-800 font-bold px-1.5 py-0.5 rounded">🩹 Out ${player.status.duration}w</span>` : ''}
                            </div>

                            <!-- Bottom row: Stamina/Energy + Skills -->
                            <div class="flex flex-wrap xl:flex-nowrap items-center justify-between gap-2 bg-slate-50 p-1.5 rounded border border-slate-200/60">
                                <div class="flex items-center gap-3 font-mono text-[10px]">
                                    <div class="flex items-center gap-1.5" title="In-game fatigue. Recovers between plays or via snacks.">
                                        <span class="text-slate-400 uppercase text-[9px]">NRG</span>
                                        <div class="w-10 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                                            <div class="${energyColor} h-full" style="width: ${energy}%"></div>
                                        </div>
                                        <span class="${energy < 60 ? 'text-rose-600 font-bold' : 'text-slate-600'} w-5 text-right">${energy}%</span>
                                    </div>
                                    <div class="flex items-center gap-1.5" title="Stamina attribute. How slowly they lose energy.">
                                        <span class="text-slate-400 uppercase text-[9px]">STM</span>
                                        <div class="w-10 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                                            <div class="${stamina >= 70 ? 'bg-emerald-400' : (stamina >= 50 ? 'bg-blue-400' : 'bg-amber-400')} h-full" style="width: ${stamina}%"></div>
                                        </div>
                                        <span class="text-slate-600 font-bold w-4 text-right">${stamina}</span>
                                    </div>
                                </div>
                                <div class="flex items-center gap-1 font-mono text-[10px]">
                                    ${skillPillsHtml}
                                </div>
                            </div>
                        </div>

                        <!-- Right: Action & OVR -->
                        <div class="flex flex-row sm:flex-col items-center justify-between sm:justify-center gap-3 shrink-0 self-stretch sm:self-center pl-0 sm:pl-3 border-t sm:border-t-0 sm:border-l border-slate-200 pt-3 sm:pt-0 mt-2 sm:mt-0 w-full sm:w-auto">
                            <div class="text-center flex flex-row sm:flex-col items-center sm:items-end gap-2 sm:gap-0 w-full sm:w-auto justify-between">
                                <div class="flex items-baseline justify-end gap-1">
                                    <span class="text-xl font-black ${ovr >= 70 ? 'text-emerald-700' : (ovr >= 50 ? 'text-slate-800' : 'text-slate-400')}">${ovr}</span>
                                    ${deltaBadge}
                                </div>
                                <span class="text-[9px] text-slate-400 font-bold uppercase block sm:-mt-1">${posKey} OVR</span>
                            </div>

                            <button class="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-white font-black px-4 py-2 rounded text-xs uppercase tracking-wider shadow-sm transition whitespace-nowrap"
                                    onclick="event.stopPropagation(); window.commitSlotAssignment('${player.id}', '${slot}', '${side}')">
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
    try {
        const gs = getGameState();
        const team = gs?.playerTeam;
        if (!team) return;

        if (side === 'specialTeams') {
            if (!team.specialTeams) team.specialTeams = {};
            if (!playerId) delete team.specialTeams[slot];
            else team.specialTeams[slot] = playerId;
        } else if (side === 'specialists') {
            if (!team.specialists) team.specialists = {};
            if (!playerId) delete team.specialists[slot];
            else team.specialists[slot] = playerId;
        } else {
            Game.assignPlayerToSlot(team, playerId, slot, side);
        }

        const stBackup = { ...(team.specialTeams || {}) };
        const specBackup = { ...(team.specialists || {}) };

        Game.rebuildDepthChartFromOrder(team);

        if (!team.depthChart) team.depthChart = {};
        team.specialTeams = stBackup;
        team.specialists = specBackup;
        team.depthChart.specialTeams = stBackup;

        saveGameState();
        hideModal();
        renderDepthOrderPane(gs);
        document.dispatchEvent(new CustomEvent('refresh-ui'));
    } catch (err) {
        console.error('Error committing slot assignment:', err);
        hideModal();
    }
};

window.autoOptimizeLineup = function() {
    const gs = getGameState();
    const team = gs?.playerTeam;
    if (!team) return;

    team.slotOverrides = { offense: {}, defense: {}, specialTeams: {} };
    Game.populateNaturalDepthOrder(team);
    Game.rebuildDepthChartFromOrder(team);

    const roster = Game.getRosterObjects(team);
    if (roster.length > 0) {
        // Special Teams
        const bestReturner = [...roster].sort((a, b) => {
            const scoreA = (a.attributes?.physical?.speed || 50) + (a.attributes?.physical?.agility || 50) + (a.attributes?.technical?.catchingHands || 50);
            const scoreB = (b.attributes?.physical?.speed || 50) + (b.attributes?.physical?.agility || 50) + (b.attributes?.technical?.catchingHands || 50);
            return scoreB - scoreA;
        })[0];

        const bestPunter = [...roster].sort((a, b) => {
            const powA = a.attributes?.technical?.throwPower ?? a.attributes?.physical?.strength ?? 50;
            const powB = b.attributes?.technical?.throwPower ?? b.attributes?.physical?.strength ?? 50;
            return powB - powA;
        })[0];

        // Situational Specialists
        const bestFB = [...roster].sort((a, b) => {
            const scoreA = (a.attributes?.physical?.strength || 50) + (a.attributes?.technical?.blocking || 50);
            const scoreB = (b.attributes?.physical?.strength || 50) + (b.attributes?.technical?.blocking || 50);
            return scoreB - scoreA;
        })[0];

        const bestSlot = [...roster].sort((a, b) => {
            const scoreA = (a.attributes?.physical?.agility || 50) + (a.attributes?.technical?.catchingHands || 50);
            const scoreB = (b.attributes?.physical?.agility || 50) + (b.attributes?.technical?.catchingHands || 50);
            return scoreB - scoreA;
        })[0];

        const bestNCB = [...roster].sort((a, b) => {
            const scoreA = ((a.attributes?.technical?.coverage || a.attributes?.technical?.passCoverage) || 50) + (a.attributes?.physical?.agility || 50);
            const scoreB = ((b.attributes?.technical?.coverage || b.attributes?.technical?.passCoverage) || 50) + (b.attributes?.physical?.agility || 50);
            return scoreB - scoreA;
        })[0];

        team.specialTeams = {
            PR: bestReturner?.id || null,
            P: bestPunter?.id || null
        };
        team.specialists = {
            FB: bestFB?.id || null,
            SLOT: bestSlot?.id || null,
            NCB: bestNCB?.id || null
        };

        if (!team.depthChart) team.depthChart = {};
        team.depthChart.specialTeams = team.specialTeams;
    }

    saveGameState();
    renderDepthOrderPane(gs);
    document.dispatchEvent(new CustomEvent('refresh-ui'));
};

window.resetDepthChartOverrides = function() {
    const gs = getGameState();
    const team = gs?.playerTeam;
    if (!team) return;

    team.slotOverrides = { offense: {}, defense: {}, specialTeams: {} };
    team.specialTeams = {};
    team.specialists = {};
    if (team.depthChart) team.depthChart.specialTeams = {};
    Game.rebuildDepthChartFromOrder(team);
    saveGameState();
    renderDepthOrderPane(gs);
    document.dispatchEvent(new CustomEvent('refresh-ui'));
};