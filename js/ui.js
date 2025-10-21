import { calculateOverall } from './game.js';

let elements = {};
let selectedPlayerId = null;
let dragPlayerId = null;

/**
 * Finds and stores references to all necessary DOM elements.
 */
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
        
        // Depth Chart Specific
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
    Object.values(elements.screens).forEach(screen => {
        if (screen) screen.classList.add('hidden');
    });
    if (elements.screens[screenId]) {
        elements.screens[screenId].classList.remove('hidden');
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
    let filteredPlayers = undraftedPlayers.filter(p => {
        const nameMatch = p.name.toLowerCase().includes(searchTerm);
        const posMatch = !posFilter || p.favoriteOffensivePosition === posFilter || p.favoriteDefensivePosition === posFilter;
        return nameMatch && posMatch;
    });
    const sortMethod = elements.draftSort.value;
    if (sortMethod === 'age-asc') filteredPlayers.sort((a, b) => a.age - b.age);
    else if (sortMethod === 'age-desc') filteredPlayers.sort((a, b) => b.age - a.age);
    elements.draftPoolTbody.innerHTML = '';
    filteredPlayers.forEach(player => {
        const row = document.createElement('tr');
        row.className = `cursor-pointer hover:bg-amber-100 ${player.id === selectedPlayerId ? 'bg-amber-200' : ''}`;
        row.dataset.playerId = player.id;
        row.innerHTML = `<td class="py-2 px-3 font-semibold">${player.name}</td><td class="text-center py-2 px-3">${player.age}</td><td class="text-center py-2 px-3">${player.favoriteOffensivePosition}/${player.favoriteDefensivePosition}</td><td class="text-center py-2 px-3">${player.attributes.physical.height}"</td><td class="text-center py-2 px-3">${player.attributes.physical.weight}lbs</td><td class="text-center py-2 px-3">${player.attributes.physical.speed}</td><td class="text-center py-2 px-3">${player.attributes.physical.strength}</td><td class="text-center py-2 px-3">${player.attributes.physical.agility}</td><td class="text-center py-2 px-3">${player.attributes.technical.throwingAccuracy}</td><td class="text-center py-2 px-3">${player.attributes.technical.catchingHands}</td><td class="text-center py-2 px-3">${player.attributes.technical.blocking}</td><td class="text-center py-2 px-3">${player.attributes.technical.tackling}</td>`;
        row.onclick = () => onPlayerSelect(player.id);
        elements.draftPoolTbody.appendChild(row);
    });
}

export function renderSelectedPlayerCard(player) {
    if (!player) {
        elements.selectedPlayerCard.innerHTML = `<p class="text-gray-500">Select a player to see their details</p>`;
        selectedPlayerId = null;
    } else {
        selectedPlayerId = player.id;
        elements.selectedPlayerCard.innerHTML = `<h4 class="font-bold text-lg">${player.name}</h4><p class="text-sm text-gray-600">Age: ${player.age} | ${player.attributes.physical.height}" | ${player.attributes.physical.weight} lbs</p><div class="mt-2 grid grid-cols-3 gap-2 text-center"><div class="bg-gray-200 p-2 rounded"><p class="font-semibold text-xs">QB OVR</p><p class="font-bold text-xl">${calculateOverall(player, 'QB')}</p></div><div class="bg-gray-200 p-2 rounded"><p class="font-semibold text-xs">ATH OVR</p><p class="font-bold text-xl">${calculateOverall(player, 'ATH')}</p></div><div class="bg-gray-200 p-2 rounded"><p class="font-semibold text-xs">LINE OVR</p><p class="font-bold text-xl">${calculateOverall(player, 'LINE')}</p></div></div>`;
    }
    elements.draftPlayerBtn.disabled = !player;
}

export function renderPlayerRoster(playerTeam) {
    elements.rosterCount.textContent = playerTeam.roster.length;
    elements.draftRosterList.innerHTML = '';
    playerTeam.roster.forEach(player => {
        const li = document.createElement('li');
        li.className = 'p-2';
        li.textContent = `${player.name} (${player.favoriteOffensivePosition}/${player.favoriteDefensivePosition})`;
        elements.draftRosterList.appendChild(li);
    });
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
    const activePane = document.getElementById(`tab-content-${tabId}`);
    const activeButton = document.querySelector(`[data-tab="${tabId}"]`);
    if (activePane && activeButton) {
        activePane.classList.remove('hidden');
        activeButton.classList.add('active');
    }
    switch (tabId) {
        case 'my-team': renderMyTeamTab(gameState); break;
        case 'depth-chart': renderDepthChartTab(gameState); break;
        case 'schedule': renderScheduleTab(gameState); break;
        case 'standings': renderStandingsTab(gameState); break;
    }
}

function renderMyTeamTab(gameState) {
    const { roster } = gameState.playerTeam;
    let tableHtml = `<table class="min-w-full bg-white text-sm"><thead class="bg-gray-800 text-white"><tr><th class="text-left py-2 px-3">Name</th><th class="py-2 px-3">Age</th><th class="py-2 px-3">Status</th><th class="py-2 px-3">QB Ovr</th><th class="py-2 px-3">ATH Ovr</th><th class="py-2 px-3">LINE Ovr</th></tr></thead><tbody class="divide-y">`;
    roster.forEach(p => {
        tableHtml += `<tr><td class="py-2 px-3 font-semibold">${p.name}</td><td class="text-center py-2 px-3">${p.age}</td><td class="text-center py-2 px-3 ${p.status.type !== 'healthy' ? 'text-red-500 font-semibold' : ''}">${p.status.description || 'Healthy'}</td><td class="text-center py-2 px-3">${calculateOverall(p, 'QB')}</td><td class="text-center py-2 px-3">${calculateOverall(p, 'ATH')}</td><td class="text-center py-2 px-3">${calculateOverall(p, 'LINE')}</td></tr>`;
    });
    elements.myTeamRoster.innerHTML = tableHtml + `</tbody></table>`;
}

function renderDepthChartTab(gameState) {
    renderPositionalOveralls(gameState.playerTeam.roster);
    renderOffenseDepthChart(gameState);
    renderDefenseDepthChart(gameState);
}

function renderPositionalOveralls(roster) {
    let table = `<table class="min-w-full text-sm text-left"><thead class="bg-gray-100"><tr><th class="p-2 font-semibold">Player</th><th class="p-2 font-semibold text-center">QB</th><th class="p-2 font-semibold text-center">ATH</th><th class="p-2 font-semibold text-center">LINE</th></tr></thead><tbody>`;
    roster.forEach(player => {
        table += `<tr class="border-b"><td class="p-2 font-bold">${player.name}</td><td class="p-2 text-center">${calculateOverall(player, 'QB')}</td><td class="p-2 text-center">${calculateOverall(player, 'ATH')}</td><td class="p-2 text-center">${calculateOverall(player, 'LINE')}</td></tr>`;
    });
    elements.positionalOverallsContainer.innerHTML = table + '</tbody></table>';
}

function renderOffenseDepthChart(gameState) {
    const { roster, depthChart } = gameState.playerTeam;
    elements.offenseDepthChartSlots.innerHTML = '';
    const offenseSlots = Object.keys(depthChart).filter(s => s.includes('QB') || s.includes('ATH'));
    offenseSlots.forEach(slot => renderSlot(slot, roster, depthChart, elements.offenseDepthChartSlots));
    const positionedIds = Object.values(depthChart);
    const availablePlayers = roster.filter(p => !positionedIds.includes(p.id));
    renderAvailablePlayerList(availablePlayers, elements.offenseDepthChartRoster);
}

function renderDefenseDepthChart(gameState) {
    const { roster, depthChart } = gameState.playerTeam;
    elements.defenseDepthChartSlots.innerHTML = '';
    const defenseSlots = Object.keys(depthChart).filter(s => s.includes('LINE'));
    defenseSlots.forEach(slot => renderSlot(slot, roster, depthChart, elements.defenseDepthChartSlots));
    const positionedIds = Object.values(depthChart);
    const availablePlayers = roster.filter(p => !positionedIds.includes(p.id));
    renderAvailablePlayerList(availablePlayers, elements.defenseDepthChartRoster);
}

function renderSlot(positionSlot, roster, depthChart, container) {
    const playerId = depthChart[positionSlot];
    const player = roster.find(p => p.id === playerId);
    const overall = player ? calculateOverall(player, positionSlot) : '---';
    const slotEl = document.createElement('div');
    slotEl.className = 'depth-chart-slot bg-gray-200 p-2 rounded flex items-center justify-between';
    slotEl.dataset.positionSlot = positionSlot;
    if (player) {
        slotEl.draggable = true;
        slotEl.dataset.playerId = player.id;
    }
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
        const divisionEl = document.createElement('div');
        let tableHtml = `<h4 class="text-xl font-bold mb-2">${divName} Division</h4><table class="min-w-full bg-white text-sm"><thead class="bg-gray-800 text-white"><tr><th class="text-left py-2 px-3">Team</th><th class="py-2 px-3">Wins</th><th class="py-2 px-3">Losses</th></tr></thead><tbody class="divide-y">`;
        const divisionTeams = gameState.teams.filter(t => t.division === divName).sort((a, b) => b.wins - a.wins);
        divisionTeams.forEach(t => { tableHtml += `<tr class="${t.id === gameState.playerTeam.id ? 'bg-amber-100' : ''}"><td class="py-2 px-3 font-semibold">${t.name}</td><td class="text-center py-2 px-3">${t.wins}</td><td class="text-center py-2 px-3">${t.losses}</td></tr>`; });
        tableHtml += `</tbody></table>`;
        divisionEl.innerHTML = tableHtml;
        elements.standingsContainer.appendChild(divisionEl);
    }
}

export function setupDragAndDrop(onDrop) {
    const containers = [elements.offenseDepthChartSlots, elements.defenseDepthChartSlots, elements.offenseDepthChartRoster, elements.defenseDepthChartRoster];
    containers.forEach(container => {
        container.addEventListener('dragstart', e => {
            if (e.target.matches('.draggable-player, .depth-chart-slot[draggable="true"]')) {
                dragPlayerId = e.target.dataset.playerId;
                e.target.classList.add('dragging');
            }
        });
        container.addEventListener('dragend', e => {
            if (e.target.matches('.draggable-player, .depth-chart-slot')) {
                dragPlayerId = null;
                e.target.classList.remove('dragging');
            }
        });
        container.addEventListener('dragover', e => {
            e.preventDefault();
            const slot = e.target.closest('.depth-chart-slot');
            if (slot) slot.classList.add('drag-over');
        });
        container.addEventListener('dragleave', e => {
            const slot = e.target.closest('.depth-chart-slot');
            if (slot) slot.classList.remove('drag-over');
        });
        container.addEventListener('drop', e => {
            e.preventDefault();
            const slot = e.target.closest('.depth-chart-slot');
            if (slot) slot.classList.remove('drag-over');
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

            if (subTab === 'offense') {
                elements.offenseDepthChartPane.classList.remove('hidden');
                elements.defenseDepthChartPane.classList.add('hidden');
            } else {
                elements.offenseDepthChartPane.classList.add('hidden');
                elements.defenseDepthChartPane.classList.remove('hidden');
            }
        }
    });
}

