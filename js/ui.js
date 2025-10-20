import { calculateOverall } from './game.js';

let elements = {};
let selectedPlayerId = null;
let dragPlayerId = null;

/**
 * Finds and stores references to all necessary DOM elements.
 */
export function setupElements() {
    elements = {
        // Screens
        startScreen: document.getElementById('start-screen'),
        loadingScreen: document.getElementById('loading-screen'),
        teamCreationScreen: document.getElementById('team-creation-screen'),
        draftScreen: document.getElementById('draft-screen'),
        dashboardScreen: document.getElementById('dashboard-screen'),

        // Loading
        loadingProgress: document.getElementById('loading-progress'),

        // Team Creation
        teamNameSuggestions: document.getElementById('team-name-suggestions'),
        customTeamName: document.getElementById('custom-team-name'),
        confirmTeamBtn: document.getElementById('confirm-team-btn'),

        // Draft
        draftHeader: document.getElementById('draft-header'),
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


        // Dashboard
        dashboardTeamName: document.getElementById('dashboard-team-name'),
        dashboardRecord: document.getElementById('dashboard-record'),
        dashboardYear: document.getElementById('dashboard-year'),
        dashboardWeek: document.getElementById('dashboard-week'),
        dashboardTabs: document.getElementById('dashboard-tabs'),
        dashboardContent: document.getElementById('dashboard-content'),
        advanceWeekBtn: document.getElementById('advance-week-btn'),

        // Tab Panes
        myTeamContent: document.getElementById('tab-content-my-team'),
        depthChartContent: document.getElementById('tab-content-depth-chart'),
        freeAgencyContent: document.getElementById('tab-content-free-agency'),
        scheduleContent: document.getElementById('tab-content-schedule'),
        standingsContent: document.getElementById('tab-content-standings'),
        playerStatsContent: document.getElementById('tab-content-player-stats'),
        hallOfFameContent: document.getElementById('tab-content-hall-of-fame'),

        // Specific Content Areas
        myTeamRoster: document.getElementById('my-team-roster'),
        depthChartSlots: document.getElementById('depth-chart-slots'),
        depthChartRoster: document.getElementById('depth-chart-roster'),
        freeAgencyList: document.getElementById('free-agency-list'),
        scheduleList: document.getElementById('schedule-list'),
        standingsContainer: document.getElementById('standings-container'),
        playerStatsContainer: document.getElementById('player-stats-container'),
        hallOfFameList: document.getElementById('hall-of-fame-list'),
    };
    console.log("UI Elements have been successfully set up.");
}

/**
 * Hides all screens and shows the one with the specified ID.
 * @param {string} screenId - The ID of the screen to show.
 */
export function showScreen(screenId) {
    Object.values(elements.screens).forEach(screen => screen.classList.add('hidden'));
    if (elements.screens[screenId]) {
        elements.screens[screenId].classList.remove('hidden');
    }
}

/**
 * Updates the loading progress bar.
 * @param {number} progress - A value from 0 to 1 representing the progress.
 */
export function updateLoadingProgress(progress) {
    elements.loadingProgress.style.width = `${progress * 100}%`;
}


/**
 * Populates the team name suggestion buttons.
 * @param {string[]} names - An array of team names.
 * @param {function} onSelect - The callback function to run when a name is selected.
 */
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

/**
 * Updates the draft UI with the current state.
 * @param {object} gameState - The current state of the game.
 * @param {function} onPlayerSelect - Callback for when a player row is clicked.
 */
export function renderDraftScreen(gameState, onPlayerSelect) {
    const { year, draftOrder, currentPick, teams } = gameState;
    const pickingTeam = draftOrder[currentPick];

    elements.draftYear.textContent = year;
    elements.draftPickNumber.textContent = currentPick + 1;
    elements.draftPickingTeam.textContent = pickingTeam.name;

    renderDraftPool(gameState, onPlayerSelect);
    renderPlayerRoster(gameState.playerTeam);

    if (pickingTeam.id !== gameState.playerTeam.id) {
        elements.draftPlayerBtn.disabled = true;
        elements.draftPlayerBtn.textContent = `Waiting for ${pickingTeam.name}...`;
    } else {
        elements.draftPlayerBtn.disabled = selectedPlayerId === null;
        elements.draftPlayerBtn.textContent = 'Draft Player';
    }
}

/**
 * Renders the table of undrafted players.
 * @param {object} gameState - The current state of the game.
 * @param {function} onPlayerSelect - Callback for when a player row is clicked.
 */
export function renderDraftPool(gameState, onPlayerSelect) {
    const undraftedPlayers = gameState.players.filter(p => !p.teamId);
    
    // Filtering
    const searchTerm = elements.draftSearch.value.toLowerCase();
    const posFilter = elements.draftFilterPos.value;
    let filteredPlayers = undraftedPlayers.filter(p => {
        const nameMatch = p.name.toLowerCase().includes(searchTerm);
        const posMatch = !posFilter || p.favoriteOffensivePosition === posFilter || p.favoriteDefensivePosition === posFilter;
        return nameMatch && posMatch;
    });

    // Sorting
    const sortMethod = elements.draftSort.value;
    if (sortMethod === 'age-asc') filteredPlayers.sort((a, b) => a.age - b.age);
    else if (sortMethod === 'age-desc') filteredPlayers.sort((a, b) => b.age - a.age);
    // Add more sorting if needed

    elements.draftPoolTbody.innerHTML = '';
    filteredPlayers.forEach(player => {
        const row = document.createElement('tr');
        row.className = `cursor-pointer hover:bg-amber-100 ${player.id === selectedPlayerId ? 'bg-amber-200' : ''}`;
        row.dataset.playerId = player.id;
        row.innerHTML = `
            <td class="py-2 px-3 font-semibold">${player.name}</td>
            <td class="text-center py-2 px-3">${player.age}</td>
            <td class="text-center py-2 px-3">${player.favoriteOffensivePosition}/${player.favoriteDefensivePosition}</td>
            <td class="text-center py-2 px-3">${player.attributes.physical.height}"</td>
            <td class="text-center py-2 px-3">${player.attributes.physical.weight}lbs</td>
            <td class="text-center py-2 px-3">${player.attributes.physical.speed}</td>
            <td class="text-center py-2 px-3">${player.attributes.physical.strength}</td>
            <td class="text-center py-2 px-3">${player.attributes.physical.agility}</td>
            <td class="text-center py-2 px-3">${player.attributes.technical.throwingAccuracy}</td>
            <td class="text-center py-2 px-3">${player.attributes.technical.catchingHands}</td>
            <td class="text-center py-2 px-3">${player.attributes.technical.blocking}</td>
            <td class="text-center py-2 px-3">${player.attributes.technical.tackling}</td>
        `;
        row.onclick = () => onPlayerSelect(player.id);
        elements.draftPoolTbody.appendChild(row);
    });
}

/**
 * Renders the detailed card for the currently selected player.
 * @param {object|null} player - The selected player object, or null.
 */
export function renderSelectedPlayerCard(player) {
    if (!player) {
        elements.selectedPlayerCard.innerHTML = `<p class="text-gray-500">Select a player to see their details</p>`;
        selectedPlayerId = null;
    } else {
        selectedPlayerId = player.id;
        const ovrQB = calculateOverall(player, 'QB');
        const ovrATH = calculateOverall(player, 'ATH');
        const ovrLINE = calculateOverall(player, 'LINE');

        elements.selectedPlayerCard.innerHTML = `
            <h4 class="font-bold text-lg">${player.name}</h4>
            <p class="text-sm text-gray-600">Age: ${player.age} | ${player.attributes.physical.height}" | ${player.attributes.physical.weight} lbs</p>
            <div class="mt-2 grid grid-cols-3 gap-2 text-center">
                <div class="bg-gray-200 p-2 rounded">
                    <p class="font-semibold text-xs">QB OVR</p>
                    <p class="font-bold text-xl">${ovrQB}</p>
                </div>
                <div class="bg-gray-200 p-2 rounded">
                    <p class="font-semibold text-xs">ATH OVR</p>
                    <p class="font-bold text-xl">${ovrATH}</p>
                </div>
                 <div class="bg-gray-200 p-2 rounded">
                    <p class="font-semibold text-xs">LINE OVR</p>
                    <p class="font-bold text-xl">${ovrLINE}</p>
                </div>
            </div>
        `;
    }
    // Update button state based on selection
    elements.draftPlayerBtn.disabled = !player;
}

/**
 * Renders the list of players on the player's team roster during the draft.
 * @param {object} playerTeam - The player's team object.
 */
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


/**
 * Sets up the main dashboard with team info and renders the default tab.
 * @param {object} gameState - The current game state.
 */
export function renderDashboard(gameState) {
    const { playerTeam, year, currentWeek } = gameState;
    elements.dashboardTeamName.textContent = playerTeam.name;
    elements.dashboardRecord.textContent = `Record: ${playerTeam.wins} - ${playerTeam.losses}`;
    elements.dashboardYear.textContent = year;
    elements.dashboardWeek.textContent = currentWeek < 9 ? `Week ${currentWeek + 1}` : 'Offseason';
    
    // Initially render the 'My Team' tab
    renderMyTeamTab(gameState);
}

/**
 * Handles switching between dashboard tabs.
 * @param {string} tabId - The ID of the tab to switch to.
 * @param {object} gameState - The current game state.
 */
export function switchTab(tabId, gameState) {
    // Hide all tab panes
    elements.dashboardContent.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.add('hidden');
    });
    // Deactivate all tab buttons
    elements.dashboardTabs.querySelectorAll('.tab-button').forEach(button => {
        button.classList.remove('active');
    });

    // Show the selected tab pane and activate its button
    const activePane = document.getElementById(`tab-content-${tabId}`);
    const activeButton = document.querySelector(`[data-tab="${tabId}"]`);
    if (activePane && activeButton) {
        activePane.classList.remove('hidden');
        activeButton.classList.add('active');
    }

    // Render content for the selected tab
    switch (tabId) {
        case 'my-team': renderMyTeamTab(gameState); break;
        case 'depth-chart': renderDepthChartTab(gameState); break;
        case 'free-agency': renderFreeAgencyTab(gameState); break;
        case 'schedule': renderScheduleTab(gameState); break;
        case 'standings': renderStandingsTab(gameState); break;
        case 'player-stats': renderPlayerStatsTab(gameState); break;
        case 'hall-of-fame': renderHallOfFameTab(gameState); break;
    }
}

// --- TAB RENDERING FUNCTIONS ---

function renderMyTeamTab(gameState) {
    const roster = gameState.playerTeam.roster;
    let tableHtml = `
        <table class="min-w-full bg-white text-sm">
            <thead class="bg-gray-800 text-white">
                <tr>
                    <th class="text-left py-2 px-3">Name</th>
                    <th class="py-2 px-3">Age</th>
                    <th class="py-2 px-3">Status</th>
                    <th class="py-2 px-3">QB Ovr</th>
                    <th class="py-2 px-3">ATH Ovr</th>
                    <th class="py-2 px-3">LINE Ovr</th>
                </tr>
            </thead>
            <tbody class="divide-y">`;
    roster.forEach(player => {
        tableHtml += `
            <tr>
                <td class="py-2 px-3 font-semibold">${player.name}</td>
                <td class="text-center py-2 px-3">${player.age}</td>
                <td class="text-center py-2 px-3 ${player.status.type !== 'healthy' ? 'text-red-500 font-semibold' : ''}">${player.status.description || 'Healthy'}</td>
                <td class="text-center py-2 px-3">${calculateOverall(player, 'QB')}</td>
                <td class="text-center py-2 px-3">${calculateOverall(player, 'ATH')}</td>
                <td class="text-center py-2 px-3">${calculateOverall(player, 'LINE')}</td>
            </tr>
        `;
    });
    tableHtml += `</tbody></table>`;
    elements.myTeamRoster.innerHTML = tableHtml;
}

function renderDepthChartTab(gameState) {
    const { roster, depthChart } = gameState.playerTeam;
    elements.depthChartSlots.innerHTML = '';
    elements.depthChartRoster.innerHTML = '';

    // Render positioned players
    for (const positionSlot in depthChart) {
        const playerId = depthChart[positionSlot];
        const player = roster.find(p => p.id === playerId);
        const overall = player ? calculateOverall(player, positionSlot) : '---';

        const slotEl = document.createElement('div');
        slotEl.className = 'depth-chart-slot bg-gray-200 p-2 rounded flex items-center justify-between';
        slotEl.dataset.positionSlot = positionSlot;
        slotEl.innerHTML = `
            <span class="font-bold w-1/4">${positionSlot}</span>
            <div class="player-details-grid w-3/4">
                <span>${player ? player.name : 'Empty'}</span>
                <span class="font-bold text-amber-600">${overall}</span>
                <span>${player ? player.attributes.physical.speed : '-'}</span>
                <span>${player ? player.attributes.physical.strength : '-'}</span>
                <span>${player ? player.attributes.physical.agility : '-'}</span>
                <span>${player ? player.attributes.technical.throwingAccuracy : '-'}</span>
                <span>${player ? player.attributes.technical.catchingHands : '-'}</span>
            </div>
        `;
        elements.depthChartSlots.appendChild(slotEl);
    }
    
    // Create header for the slots
    const headerEl = document.createElement('div');
    headerEl.className = 'depth-chart-slot flex items-center justify-between font-bold text-xs text-gray-500 px-2';
    headerEl.innerHTML = `
        <span class="w-1/4">POS</span>
        <div class="player-details-grid w-3/4">
            <span>NAME</span>
            <span>OVR</span>
            <span>SPD</span>
            <span>STR</span>
            <span>AGI</span>
            <span>THR</span>
            <span>CAT</span>
        </div>
    `;
    elements.depthChartSlots.prepend(headerEl);


    // Render un-positioned players in the roster list
    const positionedPlayerIds = Object.values(depthChart);
    const availablePlayers = roster.filter(p => !positionedPlayerIds.includes(p.id));

    availablePlayers.forEach(player => {
        const playerEl = document.createElement('div');
        playerEl.className = 'draggable-player bg-white p-2 rounded border cursor-grab';
        playerEl.draggable = true;
        playerEl.dataset.playerId = player.id;
        playerEl.textContent = player.name;
        elements.depthChartRoster.appendChild(playerEl);
    });
}


function renderFreeAgencyTab(gameState) {
    const freeAgents = gameState.freeAgents;
    if (freeAgents.length === 0) {
        elements.freeAgencyList.innerHTML = '<p>No free agents available this week.</p>';
        return;
    }
    // Implementation for displaying free agents
    elements.freeAgencyList.innerHTML = 'Free agency list goes here.';
}

function renderScheduleTab(gameState) {
    let scheduleHtml = '';
    for (let i = 0; i < 9; i++) {
        const weekGames = gameState.schedule.slice(i * 10, (i + 1) * 10);
        const isCurrentWeek = i === gameState.currentWeek;
        scheduleHtml += `
            <div class="p-4 rounded ${isCurrentWeek ? 'bg-amber-100 border-2 border-amber-500' : 'bg-gray-100'}">
                <h4 class="font-bold text-lg mb-2">Week ${i + 1}</h4>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
        `;
        weekGames.forEach(game => {
             scheduleHtml += `
                <div class="bg-white p-2 rounded shadow-sm flex justify-center items-center">
                    <span>${game.away.name}</span>
                    <span class="mx-2 font-bold text-gray-400">@</span>
                    <span>${game.home.name}</span>
                </div>
            `;
        });
        scheduleHtml += `</div></div>`;
    }
    elements.scheduleList.innerHTML = scheduleHtml;
}

function renderStandingsTab(gameState) {
     elements.standingsContainer.innerHTML = '';
    for (const divName in gameState.divisions) {
        const divisionEl = document.createElement('div');
        let tableHtml = `<h4 class="text-xl font-bold mb-2">${divName} Division</h4>
            <table class="min-w-full bg-white text-sm">
                <thead class="bg-gray-800 text-white">
                    <tr>
                        <th class="text-left py-2 px-3">Team</th>
                        <th class="py-2 px-3">Wins</th>
                        <th class="py-2 px-3">Losses</th>
                    </tr>
                </thead>
                <tbody class="divide-y">`;
        
        const divisionTeams = gameState.teams
            .filter(t => t.division === divName)
            .sort((a,b) => b.wins - a.wins);

        divisionTeams.forEach(team => {
            tableHtml += `
                <tr class="${team.id === gameState.playerTeam.id ? 'bg-amber-100' : ''}">
                    <td class="py-2 px-3 font-semibold">${team.name}</td>
                    <td class="text-center py-2 px-3">${team.wins}</td>
                    <td class="text-center py-2 px-3">${team.losses}</td>
                </tr>
            `;
        });
        tableHtml += `</tbody></table>`;
        divisionEl.innerHTML = tableHtml;
        elements.standingsContainer.appendChild(divisionEl);
    }
}

function renderPlayerStatsTab(gameState) {
    // Basic implementation
    elements.playerStatsContainer.innerHTML = 'League player stats table goes here.';
}

function renderHallOfFameTab(gameState) {
    const inductees = gameState.hallOfFame;
    if (inductees.length === 0) {
        elements.hallOfFameList.innerHTML = '<p>The Hall of Fame is currently empty. Legends will be made!</p>';
        return;
    }
    // Basic implementation
    elements.hallOfFameList.innerHTML = 'Hall of Fame list goes here.';
}


// --- DRAG AND DROP LOGIC ---

export function setupDragAndDrop(onDrop) {
    // Set up listeners on the roster container
    elements.depthChartRoster.addEventListener('dragstart', e => {
        if (e.target.classList.contains('draggable-player')) {
            dragPlayerId = e.target.dataset.playerId;
            e.target.classList.add('opacity-50');
        }
    });

    elements.depthChartRoster.addEventListener('dragend', e => {
        if (e.target.classList.contains('draggable-player')) {
            dragPlayerId = null;
            e.target.classList.remove('opacity-50');
        }
    });

    // Set up listeners on the slots container
    elements.depthChartSlots.addEventListener('dragover', e => {
        e.preventDefault(); // Necessary to allow dropping
        const slot = e.target.closest('.depth-chart-slot');
        if (slot && slot.dataset.positionSlot) {
            slot.classList.add('bg-amber-200');
        }
    });

    elements.depthChartSlots.addEventListener('dragleave', e => {
        const slot = e.target.closest('.depth-chart-slot');
        if (slot && slot.dataset.positionSlot) {
            slot.classList.remove('bg-amber-200');
        }
    });
    
    elements.depthChartSlots.addEventListener('drop', e => {
        e.preventDefault();
        const slot = e.target.closest('.depth-chart-slot');
        if (slot && slot.dataset.positionSlot && dragPlayerId) {
            slot.classList.remove('bg-amber-200');
            onDrop(dragPlayerId, slot.dataset.positionSlot);
        }
    });
}

