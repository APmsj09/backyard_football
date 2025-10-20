// This file contains all functions related to updating the User Interface.

// An object to hold references to all the DOM elements we'll need.
let elements = {};

/**
 * Grabs all necessary DOM elements and stores them for easy access.
 * This should be called once when the application starts.
 */
export function setupElements() {
    elements = {
        screens: {
            start: document.getElementById('start-screen'),
            loading: document.getElementById('loading-screen'),
            draft: document.getElementById('draft-screen'),
            season: document.getElementById('season-screen'),
            endSeason: document.getElementById('end-season-screen')
        },
        loadingBar: document.getElementById('loading-bar'),
        loadingMessage: document.getElementById('loading-message'),
        playerPool: document.getElementById('player-pool'),
        teamRoster: document.getElementById('team-roster'),
        draftStatus: document.getElementById('draft-status'),
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
 * @param {string} screenName - The name of the screen to show (e.g., 'start', 'draft').
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
    if (elements.loadingBar) {
        elements.loadingBar.style.width = `${progress * 100}%`;
    }
    if (elements.loadingMessage) {
        elements.loadingMessage.textContent = message;
    }
}

/**
 * Creates an HTML element for a single player card.
 * @param {object} player - The player object.
 * @returns {HTMLElement} The created player card element.
 */
function createPlayerCard(player) {
    const card = document.createElement('div');
    card.className = 'player-card bg-white rounded-lg p-3 shadow-md border border-gray-200 cursor-pointer';
    card.dataset.playerId = player.id;

    card.innerHTML = `
        <div class="flex justify-between items-center">
            <h3 class="font-bold text-lg text-gray-800">${player.name}</h3>
            <span class="text-sm font-semibold bg-gray-200 text-gray-700 px-2 py-1 rounded-full">${player.position}</span>
        </div>
        <p class="text-sm text-gray-500">Age: ${player.age}</p>
        <div class="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
            <div title="Speed"><span class="font-bold">SPD</span> ${player.attributes.physical.speed}</div>
            <div title="Strength"><span class="font-bold">STR</span> ${player.attributes.physical.strength}</div>
            <div title="Agility"><span class="font-bold">AGI</span> ${player.attributes.physical.agility}</div>
        </div>
    `;

    card.addEventListener('click', () => {
        document.querySelectorAll('#player-pool .player-card.selected').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
    });

    return card;
}

/**
 * Renders the list of available players for the draft.
 * @param {Array<object>} players - The array of undrafted players.
 */
export function renderDraftPool(players) {
    if (!elements.playerPool) return;
    elements.playerPool.innerHTML = '';
    players.forEach(player => {
        elements.playerPool.appendChild(createPlayerCard(player));
    });
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
        li.className = 'flex justify-between items-center p-2 border-b';
        li.innerHTML = `
            <span>${player.name} (${player.position})</span>
            <span class="text-gray-500">Age: ${player.age}</span>
        `;
        elements.teamRoster.appendChild(li);
    });
}

/**
 * Updates the draft status text (e.g., "Pick 1 of 10").
 * @param {object} game - The main game state object.
 */
export function updateDraftUI(game) {
    if (elements.draftStatus && game && game.playerTeam) {
        elements.draftStatus.textContent = `Pick ${game.playerTeam.roster.length + 1} of 10`;
    }
}

/**
 * Removes a player card from the draft pool after they've been drafted.
 * @param {string} playerId - The ID of the player to remove.
 */
export function removePlayerCard(playerId) {
    const card = elements.playerPool.querySelector(`[data-player-id="${playerId}"]`);
    if (card) card.remove();
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
                <tr class="border-b">
                    <th class="p-2">Team</th><th class="p-2 text-center">W</th><th class="p-2 text-center">L</th>
                </tr>
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
    table.className = 'w-full text-left';
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
    freeAgents.forEach(fa => {
        const card = createPlayerCard(fa);
        const friendship = document.createElement('p');
        friendship.className = 'text-xs text-blue-600 mt-1';
        friendship.textContent = fa.friendship;
        card.appendChild(friendship);
        card.addEventListener('click', clickHandler);
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

