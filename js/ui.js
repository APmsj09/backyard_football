import { calculateOverall, positionOverallWeights } from './game.js';

let elements = {};
let selectedPlayerId = null;
let dragPlayerId = null;

export function setupElements() {
    elements = {
        screens: {
            startScreen: document.getElementById('start-screen'),
            loadingScreen: document.getElementById('loading-screen'),
            teamCreationScreen: document.getElementById('team-creation-screen'),
            draftScreen: document.getElementById('draft-screen'),
            dashboardScreen: document.getElementById('dashboard-screen'),
        },
        loadingProgress: document.getElementById('loading-progress'),
        teamNameSuggestions: document.getElementById('team-name-suggestions'),
        customTeamName: document.getElementById('custom-team-name'),
        confirmTeamBtn: document.getElementById('confirm-team-btn'),
        draftYear: document.getElementById('draft-year'),
        draftPickNumber: document.getElementById('draft-pick-number'),
        draftPickingTeam: document.getElementById('draft-picking-team'),
        draftPoolTbody: document.getElementById('draft-pool-tbody'),
        selectedPlayerCard: document.getElementById('selected-player-card'),
        draftPlayerBtn: document.getElementById('draft-player-btn'),
        rosterCount: document.getElementById('roster-count'),
        draftRosterList: document.getElementById('draft-roster-list'),
        rosterSummary: document.getElementById('roster-summary'),
        draftSearch: document.getElementById('draft-search'),
        draftFilterPos: document.getElementById('draft-filter-pos'),
        draftSort: document.getElementById('draft-sort'),
        dashboardTeamName: document.getElementById('dashboard-team-name'),
        dashboardRecord: document.getElementById('dashboard-record'),
        dashboardYear: document.getElementById('dashboard-year'),
        dashboardWeek: document.getElementById('dashboard-week'),
        dashboardTabs: document.getElementById('dashboard-tabs'),
        dashboardContent: document.getElementById('dashboard-content'),
        advanceWeekBtn: document.getElementById('advance-week-btn'),
        myTeamRoster: document.getElementById('my-team-roster'),
        scheduleList: document.getElementById('schedule-list'),
        standingsContainer: document.getElementById('standings-container'),
        playerStatsContainer: document.getElementById('player-stats-container'),
        hallOfFameList: document.getElementById('hall-of-fame-list'),
        depthChartSubTabs: document.getElementById('depth-chart-sub-tabs'),
        offenseDepthChartPane: document.getElementById('depth-chart-offense-pane'),
        defenseDepthChartPane: document.getElementById('depth-chart-defense-pane'),
        offenseDepthChartSlots: document.getElementById('offense-depth-chart-slots'),
        offenseDepthChartRoster: document.getElementById('offense-depth-chart-roster'),
        defenseDepthChartSlots: document.getElementById('defense-depth-chart-slots'),
        defenseDepthChartRoster: document.getElementById('defense-depth-chart-roster'),
        positionalOverallsContainer: document.getElementById('positional-overalls-container'),
    };
    console.log("UI Elements have been successfully set up.");
}

export function showScreen(screenId) {
    if (elements.screens) {
        Object.values(elements.screens).forEach(screen => {
            if (screen) screen.classList.add('hidden');
        });
        if (elements.screens[screenId]) {
            elements.screens[screenId].classList.remove('hidden');
        }
    }
}

export function updateLoadingProgress(progress) {
    elements.loadingProgress.style.width = `${progress * 100}%`;
}

export function renderTeamNameSuggestions(names, onSelect) {
    elements.teamNameSuggestions.innerHTML = '';
    names.forEach(name => {
        const button = document.createElement('button');
        button.className = 'bg-gray-200 hover:bg-amber-500 hover:text-white text-gray-700 font-semibold py-2 px-4 rounded-lg transition';
        button.textContent = name;
        button.onclick = () => onSelect(name);
        elements.teamNameSuggestions.appendChild(button);
    });
}

export function renderDraftScreen(gameState, onPlayerSelect) {
    const { year, draftOrder, currentPick } = gameState;
    const pickingTeam = draftOrder[currentPick];
    elements.draftYear.textContent = year;
    elements.draftPickNumber.textContent = currentPick + 1;
    elements.draftPickingTeam.textContent = pickingTeam.name;
    renderDraftPool(gameState, onPlayerSelect);
    renderPlayerRoster(gameState.playerTeam);
    elements.draftPlayerBtn.disabled = pickingTeam.id !== gameState.playerTeam.id || selectedPlayerId === null;
    elements.draftPlayerBtn.textContent = pickingTeam.id === gameState.playerTeam.id ? 'Draft Player' : `Waiting for ${pickingTeam.name}...`;
}

export function renderDraftPool(gameState, onPlayerSelect) {
    const undraftedPlayers = gameState.players.filter(p => !p.teamId);
    const searchTerm = elements.draftSearch.value.toLowerCase();
    const posFilter = elements.draftFilterPos.value;
    let filteredPlayers = undraftedPlayers.filter(p => p.name.toLowerCase().includes(searchTerm) && (!posFilter || p.favoriteOffensivePosition === posFilter || p.favoriteDefensivePosition === posFilter));
    const sortMethod = elements.draftSort.value;
    if (sortMethod === 'age-asc') filteredPlayers.sort((a, b) => a.age - b.age);
    else if (sortMethod === 'age-desc') filteredPlayers.sort((a, b) => b.age - a.age);
    elements.draftPoolTbody.innerHTML = '';
    filteredPlayers.forEach(player => {
        const row = document.createElement('tr');
        row.className = `cursor-pointer hover:bg-amber-100 draft-player-row`;
        row.dataset.playerId = player.id;
        row.innerHTML = `<td class="py-2 px-3 font-semibold">${player.name}</td><td class="text-center py-2 px-3">${player.age}</td><td class="text-center py-2 px-3">${player.favoriteOffensivePosition}/${player.favoriteDefensivePosition}</td><td class="text-center py-2 px-3">${player.attributes.physical.height}"</td><td class="text-center py-2 px-3">${player.attributes.physical.weight}lbs</td><td class="text-center py-2 px-3">${player.attributes.physical.speed}</td><td class="text-center py-2 px-3">${player.attributes.physical.strength}</td><td class="text-center py-2 px-3">${player.attributes.physical.agility}</td><td class="text-center py-2 px-3">${player.attributes.technical.throwingAccuracy}</td><td class="text-center py-2 px-3">${player.attributes.technical.catchingHands}</td><td class="text-center py-2 px-3">${player.attributes.technical.blocking}</td><td class="text-center py-2 px-3">${player.attributes.technical.tackling}</td><td class="text-center py-2 px-3">${player.attributes.technical.blockShedding}</td>`;
        row.onclick = () => onPlayerSelect(player.id);
        elements.draftPoolTbody.appendChild(row);
    });
}

export function updateSelectedPlayerRow(newSelectedId) {
    selectedPlayerId = newSelectedId;
    document.querySelectorAll('.draft-player-row').forEach(row => {
        row.classList.toggle('bg-amber-200', row.dataset.playerId === selectedPlayerId);
    });
}


export function renderSelectedPlayerCard(player) {
    if (!player) {
        elements.selectedPlayerCard.innerHTML = `<p class="text-gray-500">Select a player to see their details</p>`;
    } else {
        const positions = Object.keys(positionOverallWeights);
        let overallsHtml = '<div class="mt-2 grid grid-cols-4 gap-2 text-center">';
        positions.forEach(pos => {
            overallsHtml += `
                <div class="bg-gray-200 p-2 rounded">
                    <p class="font-semibold text-xs">${pos} OVR</p>
                    <p class="font-bold text-xl">${calculateOverall(player, pos)}</p>
                </div>
            `;
        });
        overallsHtml += '</div>';

        elements.selectedPlayerCard.innerHTML = `
            <h4 class="font-bold text-lg">${player.name}</h4>
            <p class="text-sm text-gray-600">Age: ${player.age} | ${player.attributes.physical.height}" | ${player.attributes.physical.weight} lbs</p>
            ${overallsHtml}
        `;
    }
    elements.draftPlayerBtn.disabled = !player;
}

export function renderPlayerRoster(playerTeam) {
    elements.rosterCount.textContent = `${playerTeam.roster.length}/10`;
    elements.draftRosterList.innerHTML = '';
    playerTeam.roster.forEach(player => {
        const li = document.createElement('li');
        li.className = 'p-2';
        li.textContent = `${player.name} (${player.favoriteOffensivePosition}/${player.favoriteDefensivePosition})`;
        elements.draftRosterList.appendChild(li);
    });
    renderRosterSummary(playerTeam);
}

function renderRosterSummary(playerTeam) {
    const summary = {};
    const positions = Object.keys(positionOverallWeights);
    positions.forEach(pos => summary[pos] = { count: 0, totalOvr: 0 });

    playerTeam.roster.forEach(player => {
        const bestPosition = positions.reduce((best, current) => {
            return calculateOverall(player, current) > calculateOverall(player, best) ? current : best;
        });
        summary[bestPosition].count++;
        summary[bestPosition].totalOvr += calculateOverall(player, bestPosition);
    });

    let summaryHtml = '<h5 class="font-bold text-sm mb-1">Positional Summary</h5><div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">';
    for (const pos in summary) {
        const avgOvr = summary[pos].count > 0 ? Math.round(summary[pos].totalOvr / summary[pos].count) : '---';
        summaryHtml += `
            <div class="flex justify-between">
                <span class="font-semibold">${pos}:</span>
                <span>${summary[pos].count} (Avg ${avgOvr})</span>
            </div>
        `;
    }
    summaryHtml += '</div>';
    elements.rosterSummary.innerHTML = summaryHtml;
}


export function renderDashboard(gameState) {
    const { playerTeam, year, currentWeek } = gameState;
    elements.dashboardTeamName.textContent = playerTeam.name;
    elements.dashboardRecord.textContent = `Record: ${playerTeam.wins} - ${playerTeam.losses}`;
    elements.dashboardYear.textContent = year;
    elements.dashboardWeek.textContent = currentWeek < 9 ? `Week ${currentWeek + 1}` : 'Offseason';
    renderMyTeamTab(gameState);
}

export function switchTab(tabId, gameState) {
    elements.dashboardContent.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
    elements.dashboardTabs.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-content-${tabId}`)?.classList.remove('hidden');
    document.querySelector(`[data-tab="${tabId}"]`)?.classList.add('active');
    switch (tabId) {
        case 'my-team': renderMyTeamTab(gameState); break;
        case 'depth-chart': renderDepthChartTab(gameState); break;
        case 'schedule': renderScheduleTab(gameState); break;
        case 'standings': renderStandingsTab(gameState); break;
    }
}

function renderMyTeamTab(gameState) {
    const { roster } = gameState.playerTeam;
    let tableHtml = `<table class="min-w-full bg-white text-sm"><thead class="bg-gray-800 text-white"><tr><th class="text-left py-2 px-3">Name</th><th class="py-2 px-3">Age</th><th class="py-2 px-3">Status</th><th class="py-2 px-3">Best Pos Ovr</th></tr></thead><tbody class="divide-y">`;
    roster.forEach(p => {
        const overalls = Object.keys(positionOverallWeights).map(pos => calculateOverall(p, pos));
        tableHtml += `<tr><td class="py-2 px-3 font-semibold">${p.name}</td><td class="text-center py-2 px-3">${p.age}</td><td class="text-center py-2 px-3 ${p.status.type !== 'healthy' ? 'text-red-500 font-semibold' : ''}">${p.status.description || 'Healthy'}</td><td class="text-center py-2 px-3 font-bold">${Math.max(...overalls)}</td></tr>`;
    });
    elements.myTeamRoster.innerHTML = tableHtml + `</tbody></table>`;
}

function renderDepthChartTab(gameState) {
    renderPositionalOveralls(gameState.playerTeam.roster);
    const offenseSlots = ['QB', 'RB', 'WR1', 'WR2'];
    const defenseSlots = ['DL', 'LB', 'DB'];
    renderDepthChartSide('offense', offenseSlots, gameState, elements.offenseDepthChartSlots, elements.offenseDepthChartRoster);
    renderDepthChartSide('defense', defenseSlots, gameState, elements.defenseDepthChartSlots, elements.defenseDepthChartRoster);
}

function renderPositionalOveralls(roster) {
    const positions = Object.keys(positionOverallWeights);
    let table = `<table class="min-w-full text-sm text-left"><thead class="bg-gray-100"><tr><th class="p-2 font-semibold">Player</th>${positions.map(p => `<th class="p-2 font-semibold text-center">${p}</th>`).join('')}</tr></thead><tbody>`;
    roster.forEach(player => {
        table += `<tr class="border-b"><td class="p-2 font-bold">${player.name}</td>${positions.map(p => `<td class="p-2 text-center">${calculateOverall(player, p)}</td>`).join('')}</tr>`;
    });
    elements.positionalOverallsContainer.innerHTML = table + '</tbody></table>';
}

function renderDepthChartSide(side, slots, gameState, slotsContainer, rosterContainer) {
    const { roster, depthChart } = gameState.playerTeam;
    slotsContainer.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'depth-chart-slot flex items-center justify-between font-bold text-xs text-gray-500 px-2';
    header.innerHTML = `<span class="w-1/4">POS</span><div class="player-details-grid w-3/4"><span>NAME</span><span>OVR</span><span>SPD</span><span>STR</span><span>AGI</span><span>THR</span><span>CAT</span></div>`;
    slotsContainer.appendChild(header);
    slots.forEach(slot => renderSlot(slot, roster, depthChart, slotsContainer));
    const positionedIds = Object.values(depthChart).filter(id => id !== null);
    const availablePlayers = roster.filter(p => !positionedIds.includes(p.id));
    renderAvailablePlayerList(availablePlayers, rosterContainer);
}

function renderSlot(positionSlot, roster, depthChart, container) {
    const playerId = depthChart[positionSlot];
    const player = roster.find(p => p.id === playerId);
    const overall = player ? calculateOverall(player, positionSlot.replace(/\d/g, '')) : '---';
    const slotEl = document.createElement('div');
    slotEl.className = 'depth-chart-slot bg-gray-200 p-2 rounded flex items-center justify-between';
    slotEl.dataset.positionSlot = positionSlot;
    if (player) { slotEl.draggable = true; slotEl.dataset.playerId = player.id; }
    slotEl.innerHTML = `<span class="font-bold w-1/4">${positionSlot}</span><div class="player-details-grid w-3/4"><span>${player ? player.name : 'Empty'}</span><span class="font-bold text-amber-600">${overall}</span><span>${player ? player.attributes.physical.speed : '-'}</span><span>${player ? player.attributes.physical.strength : '-'}</span><span>${player ? player.attributes.physical.agility : '-'}</span><span>${player ? player.attributes.technical.throwingAccuracy : '-'}</span><span>${player ? player.attributes.technical.catchingHands : '-'}</span></div>`;
    container.appendChild(slotEl);
}

function renderAvailablePlayerList(players, container) {
    container.innerHTML = '';
    players.forEach(player => {
        const playerEl = document.createElement('div');
        playerEl.className = 'draggable-player';
        playerEl.draggable = true;
        playerEl.dataset.playerId = player.id;
        playerEl.textContent = player.name;
        container.appendChild(playerEl);
    });
}

function renderScheduleTab(gameState) {
    let html = '';
    for (let i = 0; i < 9; i++) {
        const weekGames = gameState.schedule.slice(i * 10, (i + 1) * 10);
        html += `<div class="p-4 rounded ${i === gameState.currentWeek ? 'bg-amber-100 border-2 border-amber-500' : 'bg-gray-100'}"><h4 class="font-bold text-lg mb-2">Week ${i + 1}</h4><div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">`;
        weekGames.forEach(g => { html += `<div class="bg-white p-2 rounded shadow-sm flex justify-center items-center"><span>${g.away.name}</span><span class="mx-2 font-bold text-gray-400">@</span><span>${g.home.name}</span></div>`; });
        html += `</div></div>`;
    }
    elements.scheduleList.innerHTML = html;
}

function renderStandingsTab(gameState) {
    elements.standingsContainer.innerHTML = '';
    for (const divName in gameState.divisions) {
        const divEl = document.createElement('div');
        let tableHtml = `<h4 class="text-xl font-bold mb-2">${divName} Division</h4><table class="min-w-full bg-white text-sm"><thead class="bg-gray-800 text-white"><tr><th class="text-left py-2 px-3">Team</th><th class="py-2 px-3">Wins</th><th class="py-2 px-3">Losses</th></tr></thead><tbody class="divide-y">`;
        const divTeams = gameState.teams.filter(t => t.division === divName).sort((a, b) => b.wins - a.wins);
        divTeams.forEach(t => { tableHtml += `<tr class="${t.id === gameState.playerTeam.id ? 'bg-amber-100' : ''}"><td class="py-2 px-3 font-semibold">${t.name}</td><td class="text-center py-2 px-3">${t.wins}</td><td class="text-center py-2 px-3">${t.losses}</td></tr>`; });
        divEl.innerHTML = tableHtml + `</tbody></table>`;
        elements.standingsContainer.appendChild(divEl);
    }
}

export function setupDragAndDrop(onDrop) {
    const containers = [document.body]; 
    let draggedEl = null;

    containers.forEach(container => {
        container.addEventListener('dragstart', e => {
            if (e.target.matches('.draggable-player, .depth-chart-slot[draggable="true"]')) {
                draggedEl = e.target;
                dragPlayerId = e.target.dataset.playerId;
                setTimeout(() => e.target.classList.add('dragging'), 0);
            }
        });

        container.addEventListener('dragend', e => {
            if(draggedEl) {
                draggedEl.classList.remove('dragging');
                draggedEl = null;
                dragPlayerId = null;
            }
        });

        container.addEventListener('dragover', e => {
            e.preventDefault();
            const slot = e.target.closest('.depth-chart-slot');
            if (slot) {
                document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
                slot.classList.add('drag-over');
            }
        });
        
        container.addEventListener('dragleave', e => {
            const slot = e.target.closest('.depth-chart-slot');
             if (slot) slot.classList.remove('drag-over');
        });

        container.addEventListener('drop', e => {
            e.preventDefault();
            document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            const slot = e.target.closest('.depth-chart-slot');
            if (slot && slot.dataset.positionSlot && dragPlayerId) {
                onDrop(dragPlayerId, slot.dataset.positionSlot);
            }
        });
    });
}

export function setupDepthChartTabs() {
    elements.depthChartSubTabs.addEventListener('click', e => {
        if(e.target.matches('.depth-chart-tab')) {
            const subTab = e.target.dataset.subTab;
            elements.depthChartSubTabs.querySelectorAll('.depth-chart-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            elements.offenseDepthChartPane.classList.toggle('hidden', subTab !== 'offense');
            elements.defenseDepthChartPane.classList.toggle('hidden', subTab === 'offense');
        }
    });
}

