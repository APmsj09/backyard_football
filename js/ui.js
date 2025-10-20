// This file contains all functions related to updating the User Interface.

// An object to hold references to all the DOM elements we'll need.
let elements = {};

/**
 * Grabs all necessary DOM elements and stores them for easy access.
 */
export function setupElements() {
    elements = {
        screens: {
            start: document.getElementById('start-screen'),
            loading: document.getElementById('loading-screen'),
            teamCreation: document.getElementById('team-creation-screen'),
            draft: document.getElementById('draft-screen'),
            season: document.getElementById('season-screen'),
            endSeason: document.getElementById('end-season-screen')
        },
        tabButtons: document.querySelectorAll('.tab-btn'),
        tabContents: document.querySelectorAll('.tab-content'),
        loadingBar: document.getElementById('loading-bar'),
        loadingMessage: document.getElementById('loading-message'),
        premadeTeamsGrid: document.getElementById('premade-teams-grid'),
        teamNameInput: document.getElementById('team-name-input'),
        playerPool: document.getElementById('player-pool'),
        teamRoster: document.getElementById('team-roster'),
        draftClockPick: document.getElementById('draft-clock-pick'),
        draftClockTeam: document.getElementById('draft-clock-team'),
        draftLog: document.getElementById('draft-log'),
        draftPlayerBtn: document.getElementById('draft-player-btn'),
        seasonHeader: document.getElementById('season-header'),
        
        // Tab Content Containers
        myTeamContent: document.getElementById('tab-content-my-team'),
        rosterContent: document.getElementById('tab-content-roster'),
        depthChartContent: document.getElementById('tab-content-depth-chart'),
        freeAgencyContent: document.getElementById('tab-content-free-agency'),
        scheduleContent: document.getElementById('tab-content-schedule'),
        standingsContent: document.getElementById('tab-content-standings'),
        playerStatsContent: document.getElementById('tab-content-player-stats'),
        hallOfFameContent: document.getElementById('tab-content-hall-of-fame'),
        
        endSeasonHeader: document.getElementById('end-season-header'),
    };
    console.log("UI Elements have been successfully set up.");
}

/**
 * Shows a specific screen and hides all others.
 * @param {string} screenName - The name of the screen to show.
 */
export function showScreen(screenName) {
    for (const key in elements.screens) {
        if (elements.screens[key]) {
            elements.screens[key].classList.toggle('hidden', key !== screenName);
        }
    }
}

/**
 * Handles tab switching functionality.
 * @param {string} tabId - The data-tab attribute of the clicked button.
 */
export function setActiveTab(tabId) {
    elements.tabButtons.forEach(button => {
        const isActive = button.dataset.tab === tabId;
        button.classList.toggle('bg-amber-500', isActive);
        button.classList.toggle('text-white', isActive);
        button.classList.toggle('hover:bg-gray-200', !isActive);
    });
    elements.tabContents.forEach(content => {
        content.classList.toggle('hidden', content.id !== `tab-content-${tabId}`);
    });
}

/**
 * Updates the loading progress bar and message.
 * @param {number} progress - A value from 0 to 1.
 * @param {string} [message] - An optional message to display.
 */
export function updateLoadingProgress(progress, message = 'Generating players...') {
    if (elements.loadingBar) elements.loadingBar.style.width = `${progress * 100}%`;
    if (elements.loadingMessage) elements.loadingMessage.textContent = message;
}

/**
 * Populates the team creation screen with premade team names.
 * @param {string[]} teamNames - An array of team names.
 * @param {Function} clickHandler - The function to call when a premade name is clicked.
 */
export function renderTeamCreation(teamNames, clickHandler) {
    if (!elements.premadeTeamsGrid) return;
    elements.premadeTeamsGrid.innerHTML = '';
    teamNames.forEach(name => {
        const button = document.createElement('button');
        button.className = 'p-3 bg-gray-200 text-gray-700 rounded-md hover:bg-amber-500 hover:text-white transition';
        button.textContent = name;
        button.addEventListener('click', () => clickHandler(name));
        elements.premadeTeamsGrid.appendChild(button);
    });
}

/**
 * Renders the list of available players for the draft in a spreadsheet format.
 * @param {Array<object>} players - The array of undrafted players.
 * @param {Function} rowClickHandler - Function to handle a click on a player row.
 */
export function renderDraftPool(players, rowClickHandler) {
    if (!elements.playerPool) return;
    elements.playerPool.innerHTML = '';

    const table = document.createElement('table');
    table.className = 'w-full text-left text-sm';
    
    table.innerHTML = `
        <thead class="bg-gray-200 sticky top-0">
            <tr>
                <th class="p-2">Name</th><th class="p-2">Pos</th><th class="p-2">Age</th>
                <th class="p-2 hidden md:table-cell">Ht</th><th class="p-2 hidden md:table-cell">Wt</th>
                <th class="p-2 text-center">Spd</th><th class="p-2 text-center">Str</th><th class="p-2 text-center">Agil</th>
                <th class="p-2 text-center hidden lg:table-cell">IQ</th><th class="p-2 text-center hidden lg:table-cell">Thr</th>
                <th class="p-2 text-center hidden lg:table-cell">Hnd</th><th class="p-2 text-center hidden lg:table-cell">Tkl</th>
                <th class="p-2 text-center hidden lg:table-cell">Blk</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');
    players.forEach(player => {
        const row = document.createElement('tr');
        row.className = 'border-b cursor-pointer hover:bg-amber-100';
        row.dataset.playerId = player.id;
        
        const feet = Math.floor(player.attributes.physical.height / 12);
        const inches = player.attributes.physical.height % 12;

        row.innerHTML = `
            <td class="p-2 font-semibold">${player.name}</td>
            <td class="p-2 font-bold">${player.position}</td>
            <td class="p-2">${player.age}</td>
            <td class="p-2 hidden md:table-cell">${feet}'${inches}"</td>
            <td class="p-2 hidden md:table-cell">${player.attributes.physical.weight}</td>
            <td class="p-2 text-center">${player.attributes.physical.speed}</td>
            <td class="p-2 text-center">${player.attributes.physical.strength}</td>
            <td class="p-2 text-center">${player.attributes.physical.agility}</td>
            <td class="p-2 text-center hidden lg:table-cell">${player.attributes.mental.playbookIQ}</td>
            <td class="p-2 text-center hidden lg:table-cell">${player.attributes.technical.throwingAccuracy}</td>
            <td class="p-2 text-center hidden lg:table-cell">${player.attributes.technical.catchingHands}</td>
            <td class="p-2 text-center hidden lg:table-cell">${player.attributes.technical.tackling}</td>
            <td class="p-2 text-center hidden lg:table-cell">${player.attributes.technical.blocking}</td>
        `;
        row.addEventListener('click', () => rowClickHandler(player.id));
        tbody.appendChild(row);
    });

    elements.playerPool.appendChild(table);
}

export function selectPlayerRow(playerId) {
    const currentlySelected = elements.playerPool.querySelector('tr.selected');
    if (currentlySelected) currentlySelected.classList.remove('selected');
    const rowToSelect = elements.playerPool.querySelector(`tr[data-player-id="${playerId}"]`);
    if (rowToSelect) rowToSelect.classList.add('selected');
}

export function updateDraftRoster(team) {
     if (!elements.teamRoster) return;
    elements.teamRoster.innerHTML = '';
    team.roster.forEach(player => {
        const li = document.createElement('li');
        li.className = 'flex justify-between items-center p-2 border-b text-sm';
        li.innerHTML = `<span>${player.name}</span><span class="font-bold text-gray-600">${player.position}</span>`;
        elements.teamRoster.appendChild(li);
    });
}

export function updateDraftClock(team, pickNumber) {
    if (elements.draftClockTeam) elements.draftClockTeam.textContent = `${team.name} are on the clock!`;
    if (elements.draftClockPick) {
        const round = Math.floor((pickNumber - 1) / 20) + 1;
        const pickInRound = ((pickNumber - 1) % 20) + 1;
        elements.draftClockPick.textContent = `Round ${round}, Pick ${pickInRound}`;
    }
}

export function addPickToLog(team, player, pickNumber) {
    if (!elements.draftLog) return;
    const li = document.createElement('li');
    li.className = 'p-2 bg-gray-50 rounded-md';
    li.innerHTML = `<span class="font-bold">${pickNumber}. ${team.name}</span> select <span class="font-semibold">${player.name} (${player.position})</span>`;
    elements.draftLog.prepend(li);
}

export function removePlayerRow(playerId) {
    const row = elements.playerPool.querySelector(`tr[data-player-id="${playerId}"]`);
    if (row) row.remove();
}

export function setDraftButtonState(enabled) {
    if (elements.draftPlayerBtn) elements.draftPlayerBtn.disabled = !enabled;
}

// --- NEW & UPDATED SEASON SCREEN RENDERERS ---

export function renderMyTeam(team, schedule, currentWeek) {
    if (!elements.myTeamContent) return;
    const weeklyGames = schedule.slice(currentWeek * 10, (currentWeek + 1) * 10);
    const nextOpponent = weeklyGames.find(g => g.home.id === team.id || g.away.id === team.id);
    const opponent = nextOpponent ? (nextOpponent.home.id === team.id ? nextOpponent.away : nextOpponent.home) : { name: 'BYE WEEK' };
    
    elements.myTeamContent.innerHTML = `
        <h2 class="text-2xl font-bold mb-4">${team.name}</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
            <div class="bg-gray-100 p-4 rounded-lg">
                <p class="text-sm text-gray-500">Record</p>
                <p class="text-3xl font-bold">${team.wins} - ${team.losses}</p>
            </div>
            <div class="bg-gray-100 p-4 rounded-lg">
                <p class="text-sm text-gray-500">Next Opponent</p>
                <p class="text-3xl font-bold">${opponent.name}</p>
            </div>
            <div class="bg-gray-100 p-4 rounded-lg">
                <p class="text-sm text-gray-500">Year</p>
                <p class="text-3xl font-bold">${game.year}</p>
            </div>
        </div>
    `;
}

export function renderRoster(team) {
    if (!elements.rosterContent) return;
    const tableHTML = `
        <h2 class="text-2xl font-bold mb-4">Team Roster</h2>
        <div class="overflow-x-auto">
            <table class="w-full text-left text-sm">
                <thead class="bg-gray-100">
                    <tr>
                        <th class="p-2">Name</th><th class="p-2">Pos</th><th class="p-2">Age</th><th class="p-2">Yds</th><th class="p-2">TD</th><th class="p-2">Tkl</th>
                    </tr>
                </thead>
                <tbody>
                ${team.roster.map(p => {
                    const totalYards = p.seasonStats.passYards + p.seasonStats.rushYards + p.seasonStats.recYards;
                    return `<tr class="border-b"><td class="p-2 font-semibold">${p.name}</td><td class="p-2">${p.position}</td><td class="p-2">${p.age}</td><td class="p-2">${totalYards}</td><td class="p-2">${p.seasonStats.touchdowns}</td><td class="p-2">${p.seasonStats.tackles}</td></tr>`;
                }).join('')}
                </tbody>
            </table>
        </div>
    `;
    elements.rosterContent.innerHTML = tableHTML;
}

export function renderDepthChart(team, players, dragHandlers) {
    if (!elements.depthChartContent) return;
    const { dragStart, dragOver, drop } = dragHandlers;

    let benchPlayers = team.roster.filter(p => !Object.values(team.depthChart).includes(p.id));
    
    const benchHTML = benchPlayers.map(p => `<div class="depth-chart-player bg-white p-2 rounded shadow-sm border" draggable="true" data-player-id="${p.id}">${p.name} (${p.position})</div>`).join('');

    const slotsHTML = Object.keys(team.depthChart).map(slot => {
        const playerId = team.depthChart[slot];
        const player = playerId ? players.find(p => p.id === playerId) : null;
        const playerHTML = player ? `<div class="depth-chart-player bg-white p-2 rounded shadow-sm border" draggable="true" data-player-id="${player.id}">${player.name} (${player.position})</div>` : '';
        return `
            <div>
                <h4 class="font-semibold mb-2">${slot}</h4>
                <div class="depth-chart-slot p-2 rounded-lg" data-slot-id="${slot}">${playerHTML}</div>
            </div>
        `;
    }).join('');

    elements.depthChartContent.innerHTML = `
        <h2 class="text-2xl font-bold mb-4">Depth Chart</h2>
        <p class="text-sm text-gray-500 mb-4">Drag and drop players to set your lineup.</p>
        <div class="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div class="md:col-span-4 grid grid-cols-4 gap-4">
                ${slotsHTML}
            </div>
            <div class="md:col-span-1">
                <h4 class="font-semibold mb-2">Bench</h4>
                <div class="depth-chart-slot p-2 rounded-lg space-y-2" data-slot-id="BENCH">${benchHTML}</div>
            </div>
        </div>
    `;
    
    // Add event listeners after rendering
    elements.depthChartContent.querySelectorAll('[draggable="true"]').forEach(el => el.addEventListener('dragstart', dragStart));
    elements.depthChartContent.querySelectorAll('.depth-chart-slot').forEach(el => {
        el.addEventListener('dragover', dragOver);
        el.addEventListener('drop', drop);
    });
}


export function renderFreeAgency(freeAgents, clickHandler) {
    if (!elements.freeAgencyContent) return;
    let content = `<h2 class="text-2xl font-bold mb-4">Weekly Free Agents</h2>`;
    if (freeAgents.length === 0) {
        content += "<p>No friends available this week.</p>";
    } else {
        content += freeAgents.map(fa => `
            <div class="flex justify-between items-center p-3 border-b">
                <div>
                    <p class="font-semibold">${fa.name} (${fa.position})</p>
                    <p class="text-sm text-gray-500">${fa.friendship}</p>
                </div>
                <button data-player-id="${fa.id}" class="sign-fa-btn bg-green-500 text-white px-3 py-1 rounded-md text-sm hover:bg-green-600">Sign</button>
            </div>
        `).join('');
    }
    elements.freeAgencyContent.innerHTML = content;
    elements.freeAgencyContent.querySelectorAll('.sign-fa-btn').forEach(btn => btn.addEventListener('click', () => clickHandler(btn.dataset.playerId)));
}

export function renderSchedule(schedule, currentWeek) {
    if (!elements.scheduleContent) return;
    let content = `<h2 class="text-2xl font-bold mb-4">Season Schedule</h2>`;
    const weeklyGames = schedule.slice(currentWeek * 10, (currentWeek + 1) * 10);
    content += `
        <h3 class="text-lg font-bold mb-2">Week ${currentWeek + 1}</h3>
        <div class="space-y-2">
            ${weeklyGames.map(g => `<p>${g.away.name} @ ${g.home.name}</p>`).join('')}
        </div>
    `;
    elements.scheduleContent.innerHTML = content;
}

export function renderStandings(teams, divisions) {
    if (!elements.standingsContent) return;
    let content = `<h2 class="text-2xl font-bold mb-4">League Standings</h2>`;
    for (const divName in divisions) {
        content += `<h3 class="text-xl font-bold mt-4 mb-2">${divName} Division</h3>`;
        const divisionTeams = teams.filter(t => t.division === divName).sort((a, b) => b.wins - a.wins);
        content += `
            <table class="w-full text-left bg-white rounded-lg shadow-md">
                <thead class="bg-gray-100"><tr><th class="p-2">Team</th><th class="p-2 text-center">W</th><th class="p-2 text-center">L</th></tr></thead>
                <tbody>
                ${divisionTeams.map(t => `<tr class="border-b"><td class="p-2">${t.name}</td><td class="p-2 text-center">${t.wins}</td><td class="p-2 text-center">${t.losses}</td></tr>`).join('')}
                </tbody>
            </table>
        `;
    }
    elements.standingsContent.innerHTML = content;
}

export function renderPlayerStats(players) {
    if (!elements.playerStatsContent) return;
     const sortedPlayers = [...players].sort((a,b) => (b.seasonStats.passYards + b.seasonStats.rushYards + b.seasonStats.recYards) - (a.seasonStats.passYards + a.seasonStats.rushYards + a.seasonStats.recYards));
    elements.playerStatsContent.innerHTML = `
        <h2 class="text-2xl font-bold mb-4">League Player Stats</h2>
        <div class="max-h-[60vh] overflow-y-auto">
            <table class="w-full text-left text-sm">
                <thead class="bg-gray-100 sticky top-0"><tr><th class="p-2">Name</th><th class="p-2">Team</th><th class="p-2">Pass Yds</th><th class="p-2">Rush Yds</th><th class="p-2">Rec Yds</th><th class="p-2">TDs</th><th class="p-2">Tkls</th></tr></thead>
                <tbody>
                ${sortedPlayers.map(p => {
                    const team = game.teams.find(t => t.id === p.teamId);
                    return `<tr class="border-b">
                        <td class="p-2 font-semibold">${p.name}</td><td class="p-2">${team ? team.name : 'FA'}</td>
                        <td class="p-2">${p.seasonStats.passYards}</td><td class="p-2">${p.seasonStats.rushYards}</td>
                        <td class="p-2">${p.seasonStats.recYards}</td><td class="p-2">${p.seasonStats.touchdowns}</td><td class="p-2">${p.seasonStats.tackles}</td>
                    </tr>`
                }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

export function renderHallOfFame(hallOfFamers) {
    if (!elements.hallOfFameContent) return;
    let content = `<h2 class="text-2xl font-bold mb-4">Hall of Fame</h2>`;
    if (hallOfFamers.length === 0) {
        content += `<p>No players have been inducted yet.</p>`;
    } else {
         content += hallOfFamers.map(p => `
            <div class="p-3 border-b">
                <p class="font-bold text-lg">${p.name} <span class="text-sm font-normal text-gray-500">(${p.position})</span></p>
                <p class="text-xs">Seasons: ${p.careerStats.seasonsPlayed} | TDs: ${p.careerStats.touchdowns} | Total Yards: ${p.careerStats.passYards + p.careerStats.rushYards + p.careerStats.recYards} | Tackles: ${p.careerStats.tackles}</p>
            </div>
        `).join('');
    }
    elements.hallOfFameContent.innerHTML = content;
}

export function updateEndSeasonUI(year) {
    if (elements.endSeasonHeader) {
        elements.endSeasonHeader.textContent = `End of Year ${year}`;
    }
}

