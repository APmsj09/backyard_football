import * as Game from '../game.js';
import { getGameState, saveGameState, getGameDayRosterObjects } from '../game/state.js';
import { isPlayerViableForPosition } from '../game/depth_chart.js';
import {
    calculateOverall,
    calculateSlotSuitability,
    estimateBestPosition
} from '../game/player.js';

import { offenseFormations, defenseFormations } from '../data.js';
import { showModal, hideModal } from '../ui.js';
import { formatHeight } from '../utils.js';

let activeDepthChartTab = 'offense';

const getFormationSlotInfo = (team, side, slot, fallbackPosition) => {
    if (side !== 'offense' && side !== 'defense') {
        return {
            displayLabel: slot,
            ratingPosition: fallbackPosition,
            hasRoleRating: false
        };
    }

    const formationKey = team.formations?.[side] ||
        (side === 'offense' ? 'Balanced' : '3-2-3');

    const formationMap = side === 'offense'
        ? offenseFormations
        : defenseFormations;

    const displayLabel = formationMap[formationKey]
        ?.slotLabels?.[slot] || slot;

    const hasRoleRating = displayLabel !== slot;

    return {
        displayLabel,
        ratingPosition: hasRoleRating
            ? displayLabel
            : fallbackPosition,
        hasRoleRating
    };
};

const getFormationSlotDisplayLabel = (team, side, slot) => {
    const formationKey = side === 'offense'
        ? team.formations?.offense || 'Balanced'
        : team.formations?.defense || '3-2-3';

    const formation = side === 'offense'
        ? offenseFormations[formationKey]
        : defenseFormations[formationKey];

    return formation?.slotLabels?.[slot] || slot;
};

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

    const depthOrder = team.depthOrder || {};

        const starterSlotsByPosition = {
        QB: new Map(),
        RB: new Map(),
        WR: new Map(),
        TE: new Map(),
        OL: new Map(),
        DL: new Map(),
        LB: new Map(),
        DB: new Map()
    };

    const getCorePositionForSlot = slot => {
        let posKey = String(slot).replace(/\d+/g, '');

        if (['OT', 'OG', 'C'].includes(posKey)) posKey = 'OL';
        if (posKey === 'FB') posKey = 'RB';
        if (['CB', 'S', 'FS', 'SS'].includes(posKey)) posKey = 'DB';
        if (['DE', 'DT', 'NT'].includes(posKey)) posKey = 'DL';

        return posKey;
    };

    const recordFormationStarters = (chart, validPositions) => {
        Object.entries(chart || {}).forEach(([slot, playerId]) => {
            const pos = getCorePositionForSlot(slot);

            if (
                playerId != null &&
                validPositions.includes(pos)
            ) {
                starterSlotsByPosition[pos].set(
                    String(playerId),
                    slot
                );
            }
        });
    };

    recordFormationStarters(
        offChart,
        ['QB', 'RB', 'WR', 'TE', 'OL']
    );

    recordFormationStarters(
        defChart,
        ['DL', 'LB', 'DB']
    );

    const rosterById = new Map(
        roster.map(player => [String(player.id), player])
    );

    const renderPositionDepthCard = pos => {
        const playerIds = Array.isArray(depthOrder[pos])
            ? depthOrder[pos]
            : [];

        const players = playerIds
            .map(playerId => rosterById.get(String(playerId)))
            .filter(Boolean);

        const isOffensePosition = ['QB', 'RB', 'WR', 'TE', 'OL'].includes(pos);

        const headerColor = isOffensePosition
            ? 'bg-blue-950 text-blue-200'
            : 'bg-rose-950 text-rose-200';

        return `
            <section class="min-w-0 bg-white border border-slate-200 rounded shadow-sm overflow-hidden flex flex-col">
                <div class="flex items-center justify-between px-3 py-2 ${headerColor}">
                    <div>
                        <span class="font-black text-sm uppercase tracking-wider">${pos}</span>
                        <span class="text-[9px] uppercase tracking-wide opacity-70 ml-1">Depth Ranking</span>
                    </div>
                    <span class="text-[10px] font-mono">${players.length} Players</span>
                </div>

                <div class="max-h-[360px] overflow-y-auto divide-y divide-slate-100">
                    ${players.length ? players.map((player, index) => {
                        const starterSlot = starterSlotsByPosition[pos]?.get(
                            String(player.id)
                        );

                        const formationSide = isOffensePosition ? 'offense' : 'defense';

                        const starterSlotInfo = starterSlot
                            ? getFormationSlotInfo(team, formationSide, starterSlot, pos)
                            : null;

                        const starterDisplaySlot = starterSlotInfo?.displayLabel || null;
                        const ovrPosition = starterSlotInfo?.ratingPosition || pos;
                        const ovrLabel = starterSlotInfo?.hasRoleRating
                            ? `${starterDisplaySlot} OVR`
                            : `${pos} OVR`;

                        const ovr = calculateOverall(player, ovrPosition);
                        const sameSidePositions = isOffensePosition
                            ? ['QB', 'RB', 'WR', 'TE', 'OL']
                            : ['DL', 'LB', 'DB'];
                        const otherStarterSlots = Object.entries(
                            starterSlotsByPosition
                        )
                            .filter(([otherPosition, playerSlots]) =>
                                otherPosition !== pos &&
                                sameSidePositions.includes(otherPosition) &&
                                playerSlots.has(String(player.id))
                            )
                            .map(([otherPosition, playerSlots]) =>
                                getFormationSlotInfo(
                                    team,
                                    formationSide,
                                    playerSlots.get(String(player.id)),
                                    otherPosition
                                ).displayLabel
                            );
                        const multiStartBadge = otherStarterSlots.length > 0
                            ? `
                                <span class="text-[9px] bg-amber-100 text-amber-900 rounded px-1 py-0.5 font-black shrink-0" title="Starts at multiple ${isOffensePosition ? 'offensive' : 'defensive'} positions: ${otherStarterSlots.join(', ')}">
                                    MULTI-${isOffensePosition ? 'OFF' : 'DEF'} · ${otherStarterSlots.join(', ')}
                                </span>
                            `
                            : '';

                        const starterBadgeClass = isOffensePosition
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-rose-100 text-rose-800';
                        const energy = Math.max(
                            0,
                            Math.min(100, Math.round(100 - (player.fatigue || 0)))
                        );

                        const playerIdArg = String(player.id)
                            .replace(/\\/g, '\\\\')
                            .replace(/'/g, "\\'");

                        return `
                            <div class="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-2 hover:bg-slate-50">
                                <span class="text-xs font-black text-slate-400 text-center">
                                    ${index + 1}
                                </span>

                                <div class="min-w-0">
                                    <div class="flex items-center gap-1.5 flex-wrap min-w-0">
                                        <span class="font-bold text-xs text-slate-900 truncate">
                                            ${player.name}
                                        </span>

                                        ${starterSlot ? `
                                            <span class="text-[9px] ${starterBadgeClass} rounded px-1 py-0.5 font-black shrink-0">
                                                STARTER · ${starterDisplaySlot}
                                            </span>
                                        ` : ''}

                                        ${multiStartBadge}

                                        <span class="text-[9px] text-slate-400 font-mono shrink-0">
                                            #${player.number || '--'}
                                        </span>
                                        <span class="text-[9px] bg-slate-100 text-slate-500 rounded px-1 shrink-0">
                                            ${player.pos || 'ATH'}
                                        </span>
                                    </div>

                                    <div class="text-[10px] text-slate-500 font-mono mt-0.5">
                                        Age ${player.age} ·
                                        <span class="${energy < 60 ? 'text-rose-600 font-bold' : ''}">
                                            Energy ${energy}%
                                        </span>
                                    </div>
                                </div>

                                <div class="flex items-center gap-1.5 shrink-0">
                                    <div class="text-right">
                                        <span class="text-base font-black ${ovr >= 70 ? 'text-emerald-700' : 'text-slate-800'}">
                                            ${ovr}
                                        </span>
                                        <span class="block text-[8px] text-slate-400 font-bold uppercase">
                                            ${ovrLabel}
                                        </span>
                                    </div>

                                    <div class="flex flex-col gap-0.5">
                                        <button
                                            type="button"
                                            class="w-6 h-5 rounded border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-200 disabled:opacity-25 disabled:cursor-not-allowed text-[10px] font-black"
                                            ${index === 0 ? 'disabled' : ''}
                                            onclick="event.stopPropagation(); window.movePositionDepthOrder('${pos}', '${playerIdArg}', -1)"
                                            title="Move up">
                                            ▲
                                        </button>

                                        <button
                                            type="button"
                                            class="w-6 h-5 rounded border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-200 disabled:opacity-25 disabled:cursor-not-allowed text-[10px] font-black"
                                            ${index === players.length - 1 ? 'disabled' : ''}
                                            onclick="event.stopPropagation(); window.movePositionDepthOrder('${pos}', '${playerIdArg}', 1)"
                                            title="Move down">
                                            ▼
                                        </button>
                                    </div>
                                </div>
                            </div>`;
                    }).join('') : `
                        <div class="px-3 py-6 text-center text-[10px] text-slate-400 italic">
                            No eligible players currently listed.
                        </div>
                    `}
                </div>
            </section>`;
    };

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

        const slotInfo = getFormationSlotInfo(team, side, slot, evalPosKey);
        const displayLabel = slotInfo.displayLabel;
        const ratingPosition = slotInfo.ratingPosition;
        const ovrLabel = slotInfo.hasRoleRating
            ? displayLabel
            : evalPosKey;

        const isLocked = (side === 'specialTeams' || side === 'specialists')
            ? Object.prototype.hasOwnProperty.call(
                team.specialistOverrides || {},
                slot
            )
            : team.slotOverrides?.[side]?.[slot] !== undefined;

        if (!player) {
            return `
                <div class="border-2 border-dashed ${isLocked ? 'border-amber-400 bg-amber-50' : 'border-rose-300 bg-rose-50/50'} p-2.5 rounded flex justify-between items-center cursor-pointer hover:bg-rose-100 transition"
                     onclick="window.openSlotPicker('${slot}', '${side}')">
                    <div>
                    <span
                        class="font-black text-xs text-rose-800 uppercase"
                        title="Backend slot: ${slot}">
                        ${displayLabel}
                    </span>
                        <p class="text-[10px] ${isLocked ? 'text-amber-700' : 'text-rose-600'} font-bold">
                            ${isLocked ? '🔒 Locked Vacant' : '⚠️ Unassigned — Click to Assign'}
                        </p>
                    </div>
                    <span class="text-xs ${isLocked ? 'bg-amber-200 text-amber-900' : 'bg-rose-200 text-rose-800'} px-2 py-1 rounded font-bold">
                        + Pick
                    </span>
                </div>`;
        }

        const ovr = calculateOverall(player, ratingPosition);
        const isIronman = Object.values(offChart).includes(player.id) && Object.values(defChart).includes(player.id);
        const energy = Math.max(0, Math.round(100 - (player.fatigue || 0)));
        const badgeColor = side === 'offense' ? 'bg-blue-900 text-blue-200' : (side === 'defense' ? 'bg-rose-900 text-rose-200' : (side === 'specialTeams' ? 'bg-amber-900 text-amber-200' : 'bg-indigo-900 text-indigo-200'));

        return `
            <div
                title="Backend slot: ${slot}"
                class="bg-white border ${isLocked ? 'border-amber-400 shadow-sm' : 'border-slate-200'} p-2.5 rounded flex justify-between items-center hover:border-slate-400 transition cursor-pointer"
                onclick="window.openSlotPicker('${slot}', '${side}')">
                <div class="flex items-center gap-2.5 min-w-0">
                    <div class="w-8 h-8 rounded font-black text-xs flex items-center justify-center shrink-0 ${badgeColor}">
                        ${displayLabel}
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
                    <span class="text-[9px] text-slate-400 uppercase font-bold block -mt-1">${ovrLabel} OVR</span>
                </div>
            </div>`;
    };

    const renderActiveFormationSlots = (slots, side) => {
        if (!slots.length) {
            return `
                <div class="p-5 text-center text-xs text-slate-400 italic">
                    No formation slots available.
                </div>
            `;
        }

        return `
            <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                ${slots.map(slot => renderSlotCard(slot, side)).join('')}
            </div>
        `;
    };

    const offenseSlots = offenseFormations[offFormKey]?.slots || [];
    const defenseSlots = defenseFormations[defFormKey]?.slots || [];

    const tabClass = tab => activeDepthChartTab === tab
        ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50';

    pane.innerHTML = `
        <!-- Depth Chart Header -->
        <div class="mb-4 bg-slate-900 text-white rounded p-3 flex flex-wrap justify-between items-center gap-3">
            <div class="min-w-0">
                <span class="font-black text-sm uppercase tracking-wider">
                    Depth Chart
                </span>

                <p class="text-[10px] text-slate-400 mt-1">
                    Set your starters, manage positional depth, and configure specialists.
                </p>

                <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
                    <span class="text-[10px] text-blue-300 font-bold">
                        OFFENSE: ${offFormKey}
                    </span>
                    <span class="text-[10px] text-rose-300 font-bold">
                        DEFENSE: ${defFormKey}
                    </span>
                </div>
            </div>

            <div class="flex gap-2 shrink-0">
                <button
                    class="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 font-bold px-3 py-1.5 rounded text-xs uppercase tracking-wider"
                    onclick="window.resetDepthChartOverrides()">
                    Reset Locks
                </button>

                <button
                    class="bg-amber-500 hover:bg-amber-600 text-slate-950 font-black px-3 py-1.5 rounded text-xs uppercase tracking-wider shadow"
                    onclick="window.autoOptimizeLineup()">
                    ⚡ Auto-Optimize Best Lineup
                </button>
            </div>
        </div>

        <!-- Main Depth Chart Subtabs -->
        <div class="flex gap-2 border-b border-slate-200 pb-2 mb-4 overflow-x-auto">
            <button
                class="px-4 py-2 rounded border text-xs font-black uppercase tracking-wider whitespace-nowrap ${tabClass('offense')}"
                onclick="window.setDepthChartTab('offense')">
                🏈 Offense
            </button>

            <button
                class="px-4 py-2 rounded border text-xs font-black uppercase tracking-wider whitespace-nowrap ${tabClass('defense')}"
                onclick="window.setDepthChartTab('defense')">
                🛡 Defense
            </button>

            <button
                class="px-4 py-2 rounded border text-xs font-black uppercase tracking-wider whitespace-nowrap ${tabClass('specialTeams')}"
                onclick="window.setDepthChartTab('specialTeams')">
                🦶 Special Teams
            </button>
        </div>

        <!-- OFFENSE TAB -->
        ${activeDepthChartTab === 'offense' ? `
            <div class="space-y-5 pb-6">

                <section class="space-y-2">
                    <div class="flex flex-wrap justify-between items-center border-b border-blue-200 pb-2">
                        <div>
                            <h4 class="font-black text-sm text-blue-950 uppercase tracking-wider">
                                Active Offensive Lineup
                            </h4>
                            <p class="text-[10px] text-slate-500 mt-1">
                                Click a position to assign its starter. Position labels reflect the active formation.
                            </p>
                        </div>
                        <span class="text-[10px] font-bold text-blue-800 bg-blue-50 px-2 py-1 rounded">
                            ${offenseSlots.length} Slots
                        </span>
                    </div>

                    ${renderActiveFormationSlots(offenseSlots, 'offense')}
                </section>

                <section class="space-y-2">
                    <div class="flex justify-between items-center border-b border-blue-200 pb-2">
                        <h4 class="font-black text-sm text-blue-950 uppercase tracking-wider">
                            Offensive Depth Rankings
                        </h4>
                        <span class="text-[9px] text-slate-400 uppercase font-bold">
                            Automatic fallback order
                        </span>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-3">
                        ${['QB', 'RB', 'WR', 'TE', 'OL'].map(renderPositionDepthCard).join('')}
                    </div>
                </section>
            </div>
        ` : ''}

        <!-- DEFENSE TAB -->
        ${activeDepthChartTab === 'defense' ? `
            <div class="space-y-5 pb-6">

                <section class="space-y-2">
                    <div class="flex flex-wrap justify-between items-center border-b border-rose-200 pb-2">
                        <div>
                            <h4 class="font-black text-sm text-rose-950 uppercase tracking-wider">
                                Active Defensive Lineup
                            </h4>
                            <p class="text-[10px] text-slate-500 mt-1">
                                Assign individual defensive ends, tackles, corners, and safeties.
                            </p>
                        </div>
                        <span class="text-[10px] font-bold text-rose-800 bg-rose-50 px-2 py-1 rounded">
                            ${defenseSlots.length} Slots
                        </span>
                    </div>

                    ${renderActiveFormationSlots(defenseSlots, 'defense')}
                </section>

                <section class="space-y-2">
                    <div class="flex justify-between items-center border-b border-rose-200 pb-2">
                        <h4 class="font-black text-sm text-rose-950 uppercase tracking-wider">
                            Defensive Depth Rankings
                        </h4>
                        <span class="text-[9px] text-slate-400 uppercase font-bold">
                            Automatic fallback order
                        </span>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-3">
                        ${['DL', 'LB', 'DB'].map(renderPositionDepthCard).join('')}
                    </div>
                </section>
            </div>
        ` : ''}

        <!-- SPECIAL TEAMS TAB -->
        ${activeDepthChartTab === 'specialTeams' ? `
            <div class="space-y-5 pb-6">

                <section class="bg-amber-50/50 border border-amber-200 rounded p-3 space-y-3">
                    <div class="border-b border-amber-200 pb-2">
                        <h4 class="font-black text-sm text-amber-950 uppercase tracking-wider">
                            Special Teams Specialists
                        </h4>
                        <p class="text-[10px] text-slate-500 mt-1">
                            Players assigned to dedicated kicking and return duties.
                        </p>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        ${renderSlotCard('PR', 'specialTeams')}
                        ${renderSlotCard('P', 'specialTeams')}
                    </div>

                    <div class="text-[10px] text-slate-500 italic">
                        <b>PR:</b> Punt returner — speed, agility, and hands.
                        <br>
                        <b>P:</b> Punter — throwing power and accuracy.
                    </div>
                </section>

                <section class="bg-indigo-50/50 border border-indigo-200 rounded p-3 space-y-3">
                    <div class="border-b border-indigo-200 pb-2">
                        <h4 class="font-black text-sm text-indigo-950 uppercase tracking-wider">
                            Package Specialists
                        </h4>
                        <p class="text-[10px] text-slate-500 mt-1">
                            Situational assignments used in specific offensive and defensive packages.
                        </p>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        ${renderSlotCard('FB', 'specialists')}
                        ${renderSlotCard('SLOT', 'specialists')}
                        ${renderSlotCard('NCB', 'specialists')}
                    </div>

                    <div class="text-[10px] text-slate-500 italic">
                        <b>FB:</b> Lead blocker in Power/Jumbo sets.
                        <br>
                        <b>SLOT:</b> Slot receiver in Spread/Trips sets.
                        <br>
                        <b>NCB:</b> Extra defensive back in Nickel/Dime packages.
                    </div>
                ` : ''}
                `;

                pane.dataset.activeTab = activeDepthChartTab;

                document.dispatchEvent(new CustomEvent('depth-chart-inner-tab-rendered', {
                    detail: {
                        tab: activeDepthChartTab
                 }
        }));
}

window.setDepthChartTab = function(tab) {
    const validTabs = ['offense', 'defense', 'specialTeams'];

    if (!validTabs.includes(tab)) return;

    activeDepthChartTab = tab;
    renderDepthOrderPane(getGameState());
};

window.movePositionDepthOrder = function(position, playerId, direction) {
    const gs = getGameState();
    const team = gs?.playerTeam;
    if (!team) return;

    const validPositions = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'];

    if (!validPositions.includes(position)) return;

    const order = team.depthOrder?.[position];
    if (!Array.isArray(order)) return;

    const currentIndex = order.findIndex(
        id => String(id) === String(playerId)
    );

    const nextIndex = currentIndex + Number(direction);

    if (
        currentIndex < 0 ||
        nextIndex < 0 ||
        nextIndex >= order.length
    ) {
        return;
    }

    [order[currentIndex], order[nextIndex]] =
        [order[nextIndex], order[currentIndex]];

    Game.rebuildDepthChartFromOrder(team);

    saveGameState();
    renderDepthOrderPane(gs);
    document.dispatchEvent(new CustomEvent('refresh-ui'));
};

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

    const isCoreFormationSlot = ['offense', 'defense'].includes(side);

    const roster = getGameDayRosterObjects(team);

    const posKey = slot.replace(/\d+/g, '');
    let evalPosKey = posKey;

    if (['OT', 'OG', 'C'].includes(evalPosKey)) evalPosKey = 'OL';
    else if (['DE', 'DT', 'NT'].includes(evalPosKey)) evalPosKey = 'DL';
    else if (['CB', 'S', 'FS', 'SS'].includes(evalPosKey)) evalPosKey = 'DB';
    else if (evalPosKey === 'FB') {
        evalPosKey = isCoreFormationSlot ? 'RB' : 'TE';
    } else if (posKey === 'PR' || posKey === 'SLOT') evalPosKey = 'WR';
    else if (posKey === 'P') evalPosKey = 'QB';
    else if (posKey === 'NCB') evalPosKey = 'DB';

    let activeChart;
    if (side === 'offense') activeChart = team.depthChart?.offense || {};
    else if (side === 'defense') activeChart = team.depthChart?.defense || {};
    else if (side === 'specialTeams') activeChart = team.specialTeams || team.depthChart?.specialTeams || {};
    else activeChart = team.specialists || {};

    const otherSide = side === 'offense' ? 'defense' : 'offense';
    const otherChart = team.depthChart?.[otherSide] || {};

    const displaySlotLabel = isCoreFormationSlot
        ? getFormationSlotDisplayLabel(team, side, slot)
        : slot;

    const hasRoleRating = isCoreFormationSlot && displaySlotLabel !== slot;
    const ratingPosition = hasRoleRating ? displaySlotLabel : evalPosKey;

    const currentStarterId = activeChart[slot];
    const currentStarter = roster.find(p => p && p.id === currentStarterId);
    const currentStarterOvr = currentStarter ? calculateOverall(currentStarter, ratingPosition) : null;

    const skillConfigs = POSITION_KEY_SKILLS[posKey] || POSITION_KEY_SKILLS[evalPosKey] || POSITION_KEY_SKILLS['WR'];

        const getRating = (player, group, attribute, fallback = 50) => {
        const value = Number(player.attributes?.[group]?.[attribute]);
        return Number.isFinite(value) ? value : fallback;
    };

    const getSpecialistFitScore = (player, specialistSlot) => {
        switch (specialistSlot) {
            case 'PR':
                return (
                    getRating(player, 'physical', 'speed') * 0.35 +
                    getRating(player, 'physical', 'agility') * 0.25 +
                    getRating(player, 'technical', 'catchingHands') * 0.30 +
                    getRating(player, 'mental', 'playbookIQ') * 0.10
                );

            case 'P':
                return (
                    getRating(
                        player,
                        'technical',
                        'throwPower',
                        getRating(player, 'physical', 'strength')
                    ) * 0.45 +
                    getRating(player, 'technical', 'throwingAccuracy') * 0.35 +
                    getRating(player, 'physical', 'strength') * 0.10 +
                    getRating(player, 'mental', 'playbookIQ') * 0.10
                );

            case 'FB':
                return (
                    getRating(player, 'technical', 'blocking') * 0.45 +
                    getRating(player, 'physical', 'strength') * 0.45 +
                    getRating(player, 'mental', 'playbookIQ') * 0.10
                );

            case 'SLOT':
                return (
                    getRating(player, 'physical', 'agility') * 0.30 +
                    getRating(player, 'technical', 'catchingHands') * 0.35 +
                    getRating(player, 'physical', 'speed') * 0.25 +
                    getRating(player, 'mental', 'playbookIQ') * 0.10
                );

            case 'NCB':
                return (
                    getRating(
                        player,
                        'technical',
                        'coverage',
                        getRating(player, 'technical', 'passCoverage')
                    ) * 0.40 +
                    getRating(player, 'physical', 'agility') * 0.25 +
                    getRating(player, 'physical', 'speed') * 0.20 +
                    getRating(player, 'technical', 'tackling') * 0.15
                );

            default:
                return calculateOverall(player, evalPosKey);
        }
    };

    // Rank all players by suitability for this position
    const candidates = roster
        .filter(p =>
            p &&
            isPlayerViableForPosition(p, evalPosKey)
        )
        .map(p => {
            const ovr = calculateOverall(p, ratingPosition);

            const fitScore = isCoreFormationSlot
                ? calculateSlotSuitability(p, slot, side, team)
                : getSpecialistFitScore(p, posKey);

            const isCurrentStarter = p.id === currentStarterId;
            const existingSlotThisSide = Object.entries(activeChart).find(([s, id]) => id === p.id && s !== slot)?.[0] || null;
            const existingSlotThisSideLabel = existingSlotThisSide
                ? getFormationSlotDisplayLabel(team, side, existingSlotThisSide)
                : null;

            const startsOnOtherSide = Object.entries(otherChart).find(([_, id]) => id === p.id)?.[0] || null;
            const startsOnOtherSideLabel = startsOnOtherSide
                ? getFormationSlotDisplayLabel(team, otherSide, startsOnOtherSide)
                : null;

            const otherRatingPosition = startsOnOtherSide
                ? (startsOnOtherSideLabel !== startsOnOtherSide
                    ? startsOnOtherSideLabel
                    : startsOnOtherSide.replace(/\d/g, ''))
                : null;

            const otherOvr = startsOnOtherSide
                ? calculateOverall(p, otherRatingPosition)
                : null;

            return {
                player: p,
                ovr,
                fitScore,
                isCurrentStarter,
                existingSlotThisSide,
                existingSlotThisSideLabel,
                startsOnOtherSide,
                startsOnOtherSideLabel,
                otherOvr,
                delta: currentStarterOvr !== null && !isCurrentStarter
                    ? (ovr - currentStarterOvr)
                    : 0
            };
        })
        .sort((a, b) =>
            b.fitScore - a.fitScore || b.ovr - a.ovr
        );

    const modalHtml = `
        <div class="space-y-3 text-xs text-left font-sans">
            <!-- Modal Subheader with Position Context -->
            <div class="bg-slate-900 text-white p-3 rounded flex justify-between items-center shadow-sm">
                <div>
                    <div class="flex items-center gap-2">
                    <span class="font-black text-sm uppercase text-amber-400">
                        ${side.toUpperCase()} ${displaySlotLabel}
                    </span>
                    <span class="text-slate-400 font-mono text-[11px]">
                        (${evalPosKey} eligibility)
                    </span>
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
                ${candidates.map(({ player, ovr, fitScore, isCurrentStarter, existingSlotThisSide, existingSlotThisSideLabel, startsOnOtherSide, startsOnOtherSideLabel, otherOvr, delta }) => {
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
                                ${existingSlotThisSide ? `<span class="text-[9px] bg-blue-100 text-blue-900 border border-blue-300 font-black px-1.5 py-0.5 rounded uppercase">⇄ Starts at ${existingSlotThisSideLabel}</span>` : ''}
                                ${startsOnOtherSide ? `<span class="text-[9px] bg-indigo-100 text-indigo-900 border border-indigo-200 font-bold px-1.5 py-0.5 rounded">⚡ 2-Way: ${startsOnOtherSideLabel} (${otherOvr})</span>` : ''}
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
                                <span class="text-[9px] text-slate-400 font-bold uppercase block sm:-mt-1">${hasRoleRating ? displaySlotLabel : evalPosKey} OVR</span>
                            <span class="text-[9px] text-indigo-700 font-black uppercase block">
                                ${isCoreFormationSlot ? 'Slot Fit' : 'Role Fit'}
                                ${Math.round(fitScore)}
                            </span>
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
    showModal(`Assign Starter for ${side.toUpperCase()} ${displaySlotLabel}`, modalHtml);
};

// Safe alias for ui.js visual field circles
window.app_openSlotModal = window.openSlotPicker;

window.commitSlotAssignment = function(playerId, slot, side) {
    try {
        const gs = getGameState();
        const team = gs?.playerTeam;
        if (!team) return;

        if (side === 'specialTeams' || side === 'specialists') {
            if (!team.specialistOverrides) {
                team.specialistOverrides = {};
            }

            if (!team.specialTeams) team.specialTeams = {};
            if (!team.specialists) team.specialists = {};

            // A manual assignment or explicit vacancy becomes a lock.
            team.specialistOverrides[slot] = playerId || null;

            const target = side === 'specialTeams'
                ? team.specialTeams
                : team.specialists;

            if (!playerId) {
                delete target[slot];
            } else {
                target[slot] = playerId;
            }
        } else {
            const assigned = Game.assignPlayerToSlot(
                team,
                playerId,
                slot,
                side
            );

            if (!assigned) {
                window.alert(
                    'That player is no longer eligible for this position. Please choose another player.'
                );
                return;
            }
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

    // Rebuild the eight core position rankings using coach evaluations.
    Game.populateNaturalDepthOrder(team);
    Game.rebuildDepthChartFromOrder(team);

    // Specialist selections use the same game-day availability rules.
    const roster = getGameDayRosterObjects(team);

    const getRating = (player, group, attribute, fallback = 50) => {
        const value = Number(player.attributes?.[group]?.[attribute]);
        return Number.isFinite(value) ? value : fallback;
    };

    const pickSpecialist = (position, scorePlayer, minimumScore = 45) => {
        return roster
            .filter(player =>
                player &&
                isPlayerViableForPosition(player, position)
            )
            .map(player => ({
                player,
                score: scorePlayer(player)
            }))
            .filter(candidate =>
                Number.isFinite(candidate.score) &&
                candidate.score >= minimumScore
            )
            .sort((a, b) => b.score - a.score)[0]?.player || null;
    };

    // Punt returner: speed, agility, hands, and awareness.
    const bestReturner = pickSpecialist('WR', player =>
        getRating(player, 'physical', 'speed') * 0.35 +
        getRating(player, 'physical', 'agility') * 0.25 +
        getRating(player, 'technical', 'catchingHands') * 0.30 +
        getRating(player, 'mental', 'playbookIQ') * 0.10
    );

    // Punter: power and accuracy matter more than general QB ability.
    const bestPunter = pickSpecialist('QB', player =>
        getRating(
            player,
            'technical',
            'throwPower',
            getRating(player, 'physical', 'strength')
        ) * 0.45 +
        getRating(player, 'technical', 'throwingAccuracy') * 0.35 +
        getRating(player, 'physical', 'strength') * 0.10 +
        getRating(player, 'mental', 'playbookIQ') * 0.10
    );

    // Fullback: prioritize blocking and strength.
    const bestFB = pickSpecialist('TE', player =>
        getRating(player, 'technical', 'blocking') * 0.45 +
        getRating(player, 'physical', 'strength') * 0.45 +
        getRating(player, 'mental', 'playbookIQ') * 0.10
    );

    // Slot receiver: agility and catching ability are central.
    const bestSlot = pickSpecialist('WR', player =>
        getRating(player, 'physical', 'agility') * 0.30 +
        getRating(player, 'technical', 'catchingHands') * 0.35 +
        getRating(player, 'physical', 'speed') * 0.25 +
        getRating(player, 'mental', 'playbookIQ') * 0.10
    );

    // Nickel corner: coverage, agility, and speed.
    const bestNCB = pickSpecialist('DB', player => {
        const coverage = getRating(
            player,
            'technical',
            'coverage',
            getRating(player, 'technical', 'passCoverage')
        );

        return (
            coverage * 0.40 +
            getRating(player, 'physical', 'agility') * 0.25 +
            getRating(player, 'physical', 'speed') * 0.20 +
            getRating(player, 'technical', 'tackling') * 0.15
        );
    });

    const specialistOverrides = team.specialistOverrides || {};

    const currentRosterIds = new Set(
        Game.getRosterObjects(team)
            .filter(Boolean)
            .map(player => String(player.id))
    );

    const hasManualOverride = slot =>
        Object.prototype.hasOwnProperty.call(
            specialistOverrides,
            slot
        );

    const resolveSpecialist = (slot, automaticPlayer) => {
        if (!hasManualOverride(slot)) {
            return automaticPlayer?.id || null;
        }

        const lockedPlayerId = specialistOverrides[slot];

        // Preserve an intentionally vacant specialist role.
        if (lockedPlayerId == null) return null;

        // Keep manual assignments while the player remains on the roster.
        if (currentRosterIds.has(String(lockedPlayerId))) {
            return lockedPlayerId;
        }

        // Clear stale locks when a player leaves the team.
        delete specialistOverrides[slot];

        return automaticPlayer?.id || null;
    };

    team.specialistOverrides = specialistOverrides;

    team.specialTeams = {
        PR: resolveSpecialist('PR', bestReturner),
        P: resolveSpecialist('P', bestPunter)
    };

    team.specialists = {
        FB: resolveSpecialist('FB', bestFB),
        SLOT: resolveSpecialist('SLOT', bestSlot),
        NCB: resolveSpecialist('NCB', bestNCB)
    };

    if (!team.depthChart) team.depthChart = {};
    team.depthChart.specialTeams = team.specialTeams;

    saveGameState();
    renderDepthOrderPane(gs);
    document.dispatchEvent(new CustomEvent('refresh-ui'));
};

window.resetDepthChartOverrides = function() {
    const gs = getGameState();
    const team = gs?.playerTeam;
    if (!team) return;

    team.slotOverrides = { offense: {}, defense: {}, specialTeams: {} };
    team.specialistOverrides = {};
    team.specialTeams = {};
    team.specialists = {};
    if (team.depthChart) team.depthChart.specialTeams = {};
    Game.rebuildDepthChartFromOrder(team);
    saveGameState();
    renderDepthOrderPane(gs);
    document.dispatchEvent(new CustomEvent('refresh-ui'));
};