// js/ui.js - All functions that interact with the HTML (the DOM).

// --- DOM Element References ---
export const startScreen = document.getElementById('start-screen');
export const draftScreen = document.getElementById('draft-screen');
export const teamScreen = document.getElementById('team-screen');
export const seasonScreen = document.getElementById('season-screen');
export const loadingScreen = document.getElementById('loading-screen');
export const notificationEl = document.getElementById('notification');
export const notificationMessageEl = document.getElementById('notification-message');


const draftPoolEl = document.getElementById('draft-pool');
const rosterEl = document.getElementById('roster');
const finalRosterEl = document.getElementById('final-roster');
const currentPickEl = document.getElementById('current-pick');
const totalPicksDisplayEl = document.getElementById('total-picks-display');
const playerTeamNameEl = document.getElementById('player-team-name');
const finalTeamNameEl = document.getElementById('final-team-name');
const draftPlayerBtn = document.getElementById('draft-player-btn');
const totalPicksHeaderEl = document.getElementById('total-picks');
const seasonHeaderEl = document.getElementById('season-header');
const seasonEndMessageEl = document.getElementById('season-end-message');
const championAnnouncementEl = document.getElementById('champion-announcement');
const simulateWeekBtnEl = document.getElementById('simulate-week-btn');
const standingsTableEl = document.getElementById('standings-table');
const scheduleViewEl = document.getElementById('schedule-view');
const progressBarEl = document.getElementById('progress-bar');
const loadingStatusEl = document.getElementById('loading-status');
const rosterStatsViewEl = document.getElementById('roster-stats-view');


/**
 * Hides all screens and shows the specified one.
 * @param {HTMLElement} screen The screen element to show.
 */
export function showScreen(screen) {
    console.log(`[UI] Switching to screen: #${screen.id}`);
    startScreen.classList.add('hidden');
    draftScreen.classList.add('hidden');
    teamScreen.classList.add('hidden');
    seasonScreen.classList.add('hidden');
    loadingScreen.classList.add('hidden');
    screen.classList.remove('hidden');
}

/**
 * Shows a notification message for a few seconds.
 * @param {string} message - The message to display.
 * @param {boolean} isSuccess - Determines the color (green for success, red for failure).
 */
export function showNotification(message, isSuccess = true) {
    notificationMessageEl.textContent = message;
    notificationEl.classList.remove('hidden', 'bg-green-500', 'bg-red-500', 'translate-x-full');
    notificationEl.classList.add(isSuccess ? 'bg-green-500' : 'bg-red-500');

    setTimeout(() => {
        notificationEl.classList.remove('translate-x-full');
    }, 10);

    setTimeout(() => {
        notificationEl.classList.add('translate-x-full');
    }, 3000);
}

/**
 * Updates the loading progress bar and status text.
 * @param {number} percentage - The progress percentage (0-100).
 */
export function updateLoadingProgress(percentage) {
    progressBarEl.style.width = `${percentage}%`;
    if (percentage >= 100) {
        loadingStatusEl.textContent = "Finalizing league setup...";
    }
}

/**
 * Sets the text of the loading status message.
 * @param {string} text - The message to display.
 */
export function setLoadingStatus(text) {
    loadingStatusEl.textContent = text;
}


/**
 * Creates a standard player card element.
 * @param {object} player - The player object.
 * @returns {HTMLElement} A new card element.
 */
function createPlayerCard(player) {
    const card = document.createElement('div');
    card.className = 'player-card bg-white p-3 rounded-lg shadow cursor-pointer transition transform hover:scale-105 hover:shadow-lg';
    card.dataset.playerId = player.id;

    const overall = Math.round(Object.values(player.stats).reduce((a, b) => a + b) / Object.values(player.stats).length);

    card.innerHTML = `
        <div class="flex justify-between items-start">
            <div>
                <p class="font-bold text-lg">${player.name}</p>
                <p class="text-sm text-gray-600">${player.position} | Age: ${player.age}</p>
            </div>
            <div class="text-2xl font-bold bg-gray-200 rounded-full w-12 h-12 flex items-center justify-center">
                ${overall}
            </div>
        </div>
        <div class="mt-2 grid grid-cols-5 gap-1 text-center text-xs">
            <div><p class="font-semibold">SPD</p><p>${player.stats.speed}</p></div>
            <div><p class="font-semibold">STR</p><p>${player.stats.strength}</p></div>
            <div><p class="font-semibold">AGI</p><p>${player.stats.agility}</p></div>
            <div><p class="font-semibold">CAT</p><p>${player.stats.catching}</p></div>
            <div><p class="font-semibold">THR</p><p>${player.stats.throwing}</p></div>
        </div>
    `;
    return card;
}

/**
 * Renders the list of available players for the draft.
 * @param {Array<object>} players - The list of all players.
 * @param {Function} clickHandler - The function to call when a card is clicked.
 */
export function renderDraftPool(players, clickHandler) {
    draftPoolEl.innerHTML = '';
    players
        .filter(p => !p.drafted)
        .forEach(player => {
            const card = createPlayerCard(player);
            card.addEventListener('click', () => clickHandler(player.id, card));
            draftPoolEl.appendChild(card);
        });
}

/**
 * Renders the players on the user's team roster during the draft.
 * @param {Array<object>} rosterPlayers - Array of player objects on the roster.
 */
export function renderRoster(rosterPlayers) {
    rosterEl.innerHTML = '';
    if (rosterPlayers.length === 0) {
        rosterEl.innerHTML = '<p class="text-gray-500 text-center">Your roster is empty.</p>';
        return;
    }
    rosterPlayers.forEach(player => {
        const playerEl = document.createElement('div');
        playerEl.className = 'bg-gray-100 p-2 rounded flex justify-between items-center';
        playerEl.innerHTML = `
            <span>${player.name} (${player.position})</span>
            <span class="font-bold">${Math.round(Object.values(player.stats).reduce((a, b) => a + b) / 5)}</span>
        `;
        rosterEl.appendChild(playerEl);
    });
}


/**
 * Renders the final team roster after the draft.
 * @param {object} team - The player's team object.
 */
export function renderFinalTeam(team) {
    finalTeamNameEl.textContent = team.name;
    finalRosterEl.innerHTML = '';
    team.roster.forEach(player => {
        const card = createPlayerCard(player);
        card.classList.remove('cursor-pointer', 'hover:scale-105', 'hover:shadow-lg');
        finalRosterEl.appendChild(card);
    });
    showScreen(teamScreen);
}

/**
 * Highlights the selected player card and enables the draft button.
 * @param {HTMLElement} cardElement - The card element that was clicked.
 */
export function selectPlayerCard(cardElement) {
    document.querySelectorAll('#draft-pool .player-card').forEach(card => {
        card.classList.remove('ring-2', 'ring-green-500');
    });
    cardElement.classList.add('ring-2', 'ring-green-500');
    draftPlayerBtn.disabled = false;
}

/**
 * Updates the draft status text (e.g., "Pick 1/10").
 * @param {object} draft - The game's draft object.
 */
export function updateDraftStatus(draft) {
    currentPickEl.textContent = draft.pick;
    totalPicksDisplayEl.textContent = draft.totalPicks;
    totalPicksHeaderEl.textContent = draft.totalPicks;
    draftPlayerBtn.disabled = true;
}

/**
 * Sets the player's team name in the UI.
 * @param {string} name - The team name.
 */
export function setPlayerTeamName(name) {
    playerTeamNameEl.textContent = name;
}

/**
 * Resets the season UI elements for a new season.
 */
export function resetSeasonUI() {
    seasonEndMessageEl.classList.add('hidden');
    simulateWeekBtnEl.classList.remove('hidden');
}

/**
 * Updates the season header with the current year.
 * @param {number} year - The current league year.
 */
export function updateSeasonHeader(year) {
    seasonHeaderEl.innerHTML = `
        <div class="text-center mb-8">
            <h1 class="text-5xl font-bold" style="font-family: 'Bangers', cursive;">Season ${year} Underway!</h1>
            <p class="text-xl">Follow the action week by week.</p>
        </div>
    `;
}

/**
 * Renders the league standings table, grouped by division.
 * @param {Array<object>} teams - The list of teams.
 * @param {Array<string>} divisions - The list of division names.
 */
export function renderStandings(teams, divisions) {
    standingsTableEl.innerHTML = '';
    divisions.forEach(division => {
        const divisionEl = document.createElement('div');
        divisionEl.className = 'mb-4';
        let tableHtml = `
            <h3 class="text-xl font-bold mb-2">${division} Division</h3>
            <table class="w-full text-left">
                <thead>
                    <tr>
                        <th class="p-2 bg-gray-200 rounded-l-lg">Team</th>
                        <th class="p-2 bg-gray-200">W</th>
                        <th class="p-2 bg-gray-200 rounded-r-lg">L</th>
                    </tr>
                </thead>
                <tbody>
        `;
        teams
            .filter(t => t.division === division)
            .sort((a, b) => b.wins - a.wins)
            .forEach(team => {
                tableHtml += `
                    <tr>
                        <td class="p-2 font-semibold">${team.name}</td>
                        <td class="p-2">${team.wins}</td>
                        <td class="p-2">${team.losses}</td>
                    </tr>
                `;
            });
        tableHtml += '</tbody></table>';
        divisionEl.innerHTML = tableHtml;
        standingsTableEl.appendChild(divisionEl);
    });
}

/**
 * Renders the weekly schedule and game results.
 * @param {Array<Array<object>>} schedule - The full season schedule.
 * @param {number} currentWeek - The current week number (0-indexed).
 */
export function renderSchedule(schedule, currentWeek) {
    scheduleViewEl.innerHTML = '';
    schedule.forEach((week, index) => {
        const weekEl = document.createElement('div');
        const isPast = index < currentWeek;
        const isCurrent = index === currentWeek;
        
        let weekHtml = `<h3 class="text-2xl font-bold ${isCurrent ? 'text-green-700' : ''} mb-2">Week ${index + 1} ${isCurrent ? '(Current)' : ''}</h3>`;
        weekHtml += '<div class="space-y-2">';

        week.forEach(matchup => {
            weekHtml += `
                <div class="bg-white p-3 rounded-lg shadow-sm flex justify-between items-center">
                    <div>
                        <p>${matchup.away.name}</p>
                        <p>@ ${matchup.home.name}</p>
                    </div>
                    ${isPast && matchup.result ? `
                        <div class="text-right font-bold text-lg">
                            <p>${matchup.result.away}</p>
                            <p>${matchup.result.home}</p>
                        </div>
                    ` : ''}
                </div>
            `;
        });
        weekHtml += '</div>';
        weekEl.innerHTML = weekHtml;
        scheduleViewEl.appendChild(weekEl);
    });
}

/**
 * Shows the season end message and champion.
 * @param {Array<object>} teams - The list of all teams.
 */
export function showSeasonEnd(teams) {
    seasonEndMessageEl.classList.remove('hidden');
    simulateWeekBtnEl.classList.add('hidden');

    const sortedTeams = [...teams].sort((a, b) => b.wins - a.wins);
    const champion = sortedTeams[0];
    championAnnouncementEl.textContent = `The ${champion.name} are the league champions!`;
}

/**
 * Renders the player roster with their season stats.
 * @param {Array<object>} rosterPlayers - An array of player objects.
 */
export function renderRosterWithStats(rosterPlayers) {
    let tableHtml = `
        <table class="w-full text-left">
            <thead>
                <tr>
                    <th class="p-2 bg-gray-200 rounded-l-lg">Name</th>
                    <th class="p-2 bg-gray-200">Pos</th>
                    <th class="p-2 bg-gray-200">Pass Yds</th>
                    <th class="p-2 bg-gray-200">Rush Yds</th>
                    <th class="p-2 bg-gray-200">Rec Yds</th>
                    <th class="p-2 bg-gray-200">TDs</th>
                    <th class="p-2 bg-gray-200 rounded-r-lg">Tackles</th>
                </tr>
            </thead>
            <tbody>
    `;

    rosterPlayers.forEach(player => {
        tableHtml += `
            <tr class="border-b">
                <td class="p-2 font-semibold">${player.name}</td>
                <td class="p-2">${player.position}</td>
                <td class="p-2">${player.seasonStats.passingYards}</td>
                <td class="p-2">${player.seasonStats.rushingYards}</td>
                <td class="p-2">${player.seasonStats.receivingYards}</td>
                <td class="p-2">${player.seasonStats.touchdowns}</td>
                <td class="p-2">${player.seasonStats.tackles}</td>
            </tr>
        `;
    });

    tableHtml += `</tbody></table>`;
    rosterStatsViewEl.innerHTML = tableHtml;
}

