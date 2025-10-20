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
        draftPlayerDetail: document.getElementById('draft-player-detail'),
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
 * Creates an HTML element for a single player card with detailed attributes.
 * @param {object} player - The player object.
 * @param {Function} clickHandler - The function to call when the card is clicked.
 * @returns {HTMLElement} The created player card element.
 */
function createPlayerCard(player, clickHandler) {
    const card = document.createElement('div');
    card.className = 'player-card bg-white rounded-lg p-3 shadow-md border border-gray-200 cursor-pointer';
    card.dataset.playerId = player.id;
    
    const feet = Math.floor(player.attributes.physical.height / 12);
    const inches = player.attributes.physical.height % 12;

    const keyTechStat = {
        'QB': `ACC: ${player.attributes.technical.throwingAccuracy}`, 'WR': `HND: ${player.attributes.technical.catchingHands}`,
        'RB': `AGI: ${player.attributes.physical.agility}`, 'TE': `BLK: ${player.attributes.technical.blocking}`,
        'DL': `TKL: ${player.attributes.technical.tackling}`, 'LB': `TKL: ${player.attributes.technical.tackling}`,
        'DB': `SPD: ${player.attributes.physical.speed}`,
    }[player.position] || '';

    card.innerHTML = `
        <div class="flex justify-between items-start">
            <div>
                <h3 class="font-bold text-base leading-tight text-gray-800">${player.name}</h3>
                <p class="text-xs text-gray-500">Age: ${player.age} | ${feet}'${inches}" | ${player.attributes.physical.weight}lbs</p>
            </div>
            <span class="text-sm font-semibold bg-gray-200 text-gray-700 px-2 py-1 rounded-full">${player.position}</span>
        </div>
        <div class="mt-2 grid grid-cols-3 gap-1 text-center text-xs border-t pt-2">
            <div><span class="font-bold text-gray-500">SPD</span> ${player.attributes.physical.speed}</div>
            <div><span class="font-bold text-gray-500">STR</span> ${player.attributes.physical.strength}</div>
            <div><span class="font-bold text-gray-500">IQ</span> ${player.attributes.mental.playbookIQ}</div>
            <div class="col-span-3 mt-1 text-amber-600 font-semibold">${keyTechStat}</div>
        </div>
    `;

    card.addEventListener('click', () => clickHandler(player));
    return card;
}

/**
 * Renders the detailed player card view in the draft screen.
 * @param {object} player - The player to display.
 */
export function renderPlayerDetailCard(player) {
    if (!elements.draftPlayerDetail || !player) return;
    
    const feet = Math.floor(player.attributes.physical.height / 12);
    const inches = player.attributes.physical.height % 12;

    let detailHTML = `
        <div class="p-2">
            <h3 class="font-bold text-lg text-center">${player.name}</h3>
            <p class="text-sm text-gray-500 text-center">${player.position} | Age: ${player.age} | ${feet}'${inches}" | ${player.attributes.physical.weight}lbs</p>
            
            <div class="mt-4">
                <h4 class="font-bold text-sm mb-1 text-gray-600">Physical</h4>
                <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <span>Speed:</span><span class="font-semibold text-right">${player.attributes.physical.speed}</span>
                    <span>Strength:</span><span class="font-semibold text-right">${player.attributes.physical.strength}</span>
                    <span>Agility:</span><span class="font-semibold text-right">${player.attributes.physical.agility}</span>
                    <span>Stamina:</span><span class="font-semibold text-right">${player.attributes.physical.stamina}</span>
                </div>
            </div>
            <div class="mt-3">
                <h4 class="font-bold text-sm mb-1 text-gray-600">Mental</h4>
                <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <span>Playbook IQ:</span><span class="font-semibold text-right">${player.attributes.mental.playbookIQ}</span>
                    <span>Clutch:</span><span class="font-semibold text-right">${player.attributes.mental.clutch}</span>
                    <span>Consistency:</span><span class="font-semibold text-right">${player.attributes.mental.consistency}</span>
                </div>
            </div>
            <div class="mt-3">
                <h4 class="font-bold text-sm mb-1 text-gray-600">Technical</h4>
                <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <span>Throwing Acc:</span><span class="font-semibold text-right">${player.attributes.technical.throwingAccuracy}</span>
                    <span>Catching:</span><span class="font-semibold text-right">${player.attributes.technical.catchingHands}</span>
                    <span>Tackling:</span><span class="font-semibold text-right">${player.attributes.technical.tackling}</span>
                    <span>Blocking:</span><span class="font-semibold text-right">${player.attributes.technical.blocking}</span>
                </div>
            </div>
        </div>
    `;
    elements.draftPlayerDetail.innerHTML = detailHTML;
}

/**
 * Highlights a player card in the pool.
 * @param {string} playerId - The ID of the player to highlight.
 */
export function selectPlayerCard(playerId) {
    const currentlySelected = elements.playerPool.querySelector('.player-card.selected');
    if (currentlySelected) {
        currentlySelected.classList.remove('selected');
    }
    const cardToSelect = elements.playerPool.querySelector(`[data-player-id="${playerId}"]`);
    if (cardToSelect) {
        cardToSelect.classList.add('selected');
    }
}


/**
 * Renders the list of available players for the draft.
 * @param {Array<object>} players - The array of undrafted players.
 * @param {Function} cardClickHandler - Function to handle a click on a player card.
 */
export function renderDraftPool(players, cardClickHandler) {
    if (!elements.playerPool) return;
    elements.playerPool.innerHTML = '';
    players.forEach(player => {
        elements.playerPool.appendChild(createPlayerCard(player, cardClickHandler));
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
    // Add to the top of the list
    elements.draftLog.prepend(li);
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
        const card = createPlayerCard(fa, () => {}); // Empty handler for now on FA cards
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

