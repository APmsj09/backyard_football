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
        standingsContainer: document.getElementById('standings-container'),
        scheduleContainer: document.getElementById('schedule-container'),
        yourRosterContainer: document.getElementById('your-roster'),
        freeAgentsContainer: document.getElementById('free-agents-container'),
        resultsContainer: document.getElementById('weekly-results-container'),
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
    
    // Create Table Header
    table.innerHTML = `
        <thead class="bg-gray-200 sticky top-0">
            <tr>
                <th class="p-2">Name</th>
                <th class="p-2">Pos</th>
                <th class="p-2">Age</th>
                <th class="p-2 hidden md:table-cell">Ht</th>
                <th class="p-2 hidden md:table-cell">Wt</th>
                <th class="p-2 text-center">Spd</th>
                <th class="p-2 text-center">Str</th>
                <th class="p-2 text-center">Agil</th>
                <th class="p-2 text-center hidden lg:table-cell">IQ</th>
                <th class="p-2 text-center hidden lg:table-cell">Thr</th>
                <th class="p-2 text-center hidden lg:table-cell">Hnd</th>
                <th class="p-2 text-center hidden lg:table-cell">Tkl</th>
                <th class="p-2 text-center hidden lg:table-cell">Blk</th>
            </tr>
        </thead>
        <tbody>
        </tbody>
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


/**
 * Highlights a player row in the draft pool spreadsheet.
 * @param {string} playerId - The ID of the player to highlight.
 */
export function selectPlayerRow(playerId) {
    const currentlySelected = elements.playerPool.querySelector('tr.selected');
    if (currentlySelected) {
        currentlySelected.classList.remove('selected');
    }
    const rowToSelect = elements.playerPool.querySelector(`tr[data-player-id="${playerId}"]`);
    if (rowToSelect) {
        rowToSelect.classList.add('selected');
    }
}

/**
 * Updates the player's team roster display in the draft screen.
 * @param {object} team - The player's team object.
 */
export function updateRoster(team) {
     if (!elements.teamRoster) return;
    elements.teamRoster.innerHTML = '';
    team.roster.forEach(player => {
        const li = document.createElement('li');
        li.className = 'flex justify-between items-center p-2 border-b text-sm';
        li.innerHTML = `
            <span>${player.name}</span>
            <span class="font-bold text-gray-600">${player.position}</span>
        `;
        elements.teamRoster.appendChild(li);
    });
}

/**
 * Updates the draft clock UI.
 * @param {object} team - The team currently on the clock.
 * @param {number} pickNumber - The overall pick number (1-based).
 */
export function updateDraftClock(team, pickNumber) {
    if (elements.draftClockTeam) {
        elements.draftClockTeam.textContent = `${team.name} are on the clock!`;
    }
    if (elements.draftClockPick) {
        const round = Math.floor((pickNumber - 1) / 20) + 1;
        const pickInRound = ((pickNumber - 1) % 20) + 1;
        elements.draftClockPick.textContent = `Round ${round}, Pick ${pickInRound}`;
    }
}

/**
 * Adds a new entry to the draft log.
 * @param {object} team - The team that made the pick.
 * @param {object} player - The player who was picked.
 * @param {number} pickNumber - The overall pick number (1-based).
 */
export function addPickToLog(team, player, pickNumber) {
    if (!elements.draftLog) return;
    const li = document.createElement('li');
    li.className = 'p-2 bg-gray-50 rounded-md';
    li.innerHTML = `
        <span class="font-bold">${pickNumber}. ${team.name}</span> select <span class="font-semibold">${player.name} (${player.position})</span>
    `;
    elements.draftLog.prepend(li);
}

/**
 * Removes a player row from the draft pool after they've been drafted.
 * @param {string} playerId - The ID of the player to remove.
 */
export function removePlayerRow(playerId) {
    const row = elements.playerPool.querySelector(`tr[data-player-id="${playerId}"]`);
    if (row) row.remove();
}

/**
 * Enables or disables the player's draft button.
 * @param {boolean} enabled - True to enable, false to disable.
 */
export function setDraftButtonState(enabled) {
    if (elements.draftPlayerBtn) {
        elements.draftPlayerBtn.disabled = !enabled;
    }
}

/**
 * Renders the standings tables for each division.
 * @param {Array<object>} teams - All teams in the league.
 * @param {object} divisions - The division structure.
 */
export function renderStandings(teams, divisions) {
    if (!elements.standingsContainer) return;
    elements.standingsContainer.innerHTML = '';
    
    for (const divName in divisions) {
        const header = document.createElement('h3');
        header.className = 'text-xl font-bold mt-4 mb-2';
        header.textContent = `${divName} Division`;
        elements.standingsContainer.appendChild(header);

        const table = document.createElement('table');
        table.className = 'w-full text-left bg-white rounded-lg shadow-md';
        table.innerHTML = `
            <thead class="bg-gray-100">
                <tr class="border-b"><th class="p-2">Team</th><th class="p-2 text-center">W</th><th class="p-2 text-center">L</th></tr>
            </thead>
            <tbody></tbody>
        `;
        const tbody = table.querySelector('tbody');
        
        const divisionTeams = teams.filter(t => t.division === divName).sort((a, b) => b.wins - a.wins);

        divisionTeams.forEach(team => {
            const row = document.createElement('tr');
            row.className = 'border-b last:border-b-0';
            row.innerHTML = `<td class="p-2">${team.name}</td><td class="p-2 text-center">${team.wins}</td><td class="p-2 text-center">${team.losses}</td>`;
            tbody.appendChild(row);
        });
        elements.standingsContainer.appendChild(table);
    }
}

/**
 * Renders the weekly schedule.
 * @param {Array<object>} schedule - The full season schedule.
 * @param {number} currentWeek - The current week index.
 */
export function renderSchedule(schedule, currentWeek) {
     if (!elements.scheduleContainer) return;
     elements.scheduleContainer.innerHTML = '';
     const weeklyGames = schedule.slice(currentWeek * 10, (currentWeek + 1) * 10);
     weeklyGames.forEach(match => {
        const p = document.createElement('p');
        p.className = 'text-sm';
        p.textContent = `${match.away.name} @ ${match.home.name}`;
        elements.scheduleContainer.appendChild(p);
     });
}

/**
 * Updates the detailed roster view on the season screen.
 * @param {object} team - The player's team object.
 */
export function updateYourRoster(team) {
    if (!elements.yourRosterContainer) return;
    elements.yourRosterContainer.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'w-full text-left text-sm';
    table.innerHTML = `
        <thead class="bg-gray-100"><tr class="border-b"><th class="p-2">Player</th><th class="p-2">POS</th><th class="p-2">YDS</th><th class="p-2">TD</th><th class="p-2">TKL</th></tr></thead>
        <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');
    team.roster.sort((a,b) => a.name.localeCompare(b.name)).forEach(player => {
        const totalYards = player.seasonStats.passYards + player.seasonStats.rushYards + player.seasonStats.recYards;
        const row = document.createElement('tr');
        row.className = 'border-b last:border-b-0';
        row.innerHTML = `<td class="p-2">${player.name}</td><td class="p-2">${player.position}</td><td class="p-2">${totalYards}</td><td class="p-2">${player.seasonStats.touchdowns}</td><td class="p-2">${player.seasonStats.tackles}</td>`;
        tbody.appendChild(row);
    });
    elements.yourRosterContainer.appendChild(table);
}

/**
 * Updates the main header on the season screen.
 * @param {number} currentWeek - The current week index.
 * @param {number} year - The current season year.
 */
export function updateSeasonHeader(currentWeek, year) {
    if (elements.seasonHeader) {
        elements.seasonHeader.textContent = `Year ${year} - Week ${currentWeek + 1}`;
    }
}

/**
 * Renders the available free agents for the week.
 * @param {Array<object>} freeAgents - The array of available friends.
 * @param {Function} clickHandler - The function to call when a card is clicked.
 */
export function renderFreeAgents(freeAgents, clickHandler) {
    if (!elements.freeAgentsContainer) return;
    elements.freeAgentsContainer.innerHTML = '';
    if (freeAgents.length === 0) {
        elements.freeAgentsContainer.textContent = "No friends available this week.";
        return;
    }
    // Note: This still uses player cards, could be converted to a spreadsheet as well
    freeAgents.forEach(fa => {
        const card = document.createElement('div');
        card.className = 'player-card bg-white rounded-lg p-3 shadow-md border border-gray-200 cursor-pointer';
        card.dataset.playerId = fa.id;
        card.innerHTML = `<h3 class="font-bold">${fa.name}</h3><p class="text-xs">${fa.position} | ${fa.friendship}</p>`;
        card.addEventListener('click', () => clickHandler(fa.id));
        elements.freeAgentsContainer.appendChild(card);
    });
}

/**
 * Displays the results of the simulated week.
 * @param {Array<object>} results - The game results for the week.
 * @param {number} week - The week number.
 */
export function renderWeeklyResults(results, week) {
     if (!elements.resultsContainer) return;
    elements.resultsContainer.innerHTML = '';
    const header = document.createElement('h3');
    header.className = 'text-lg font-bold mb-2';
    header.textContent = `Week ${week} Results`;
    elements.resultsContainer.appendChild(header);
    
    results.forEach(result => {
        const p = document.createElement('p');
        p.className = 'text-sm mb-1';
        p.textContent = `${result.awayTeam.name} ${result.awayScore} @ ${result.homeTeam.name} ${result.homeScore}`;
        elements.resultsContainer.appendChild(p);
    });
}

/**
 * Updates the header on the end-of-season screen.
 * @param {number} year - The year that just ended.
 */
export function updateEndSeasonUI(year) {
    if (elements.endSeasonHeader) {
        elements.endSeasonHeader.textContent = `End of Year ${year}`;
    }
}

