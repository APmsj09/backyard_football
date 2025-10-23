import { calculateOverall, positionOverallWeights } from './game.js';
import { offenseFormations, defenseFormations } from './data.js';

let elements = {};
let selectedPlayerId = null;
let dragPlayerId = null;
let dragSide = null; // 'offense' or 'defense'

export function setupElements() {
    elements = {
        screens: {
            startScreen: document.getElementById('start-screen'),
            loadingScreen: document.getElementById('loading-screen'),
            teamCreationScreen: document.getElementById('team-creation-screen'),
            draftScreen: document.getElementById('draft-screen'),
            dashboardScreen: document.getElementById('dashboard-screen'),
            offseasonScreen: document.getElementById('offseason-screen'),
        },
        modal: document.getElementById('modal'),
        modalTitle: document.getElementById('modal-title'),
        modalBody: document.getElementById('modal-body'),
        // modalCloseBtn is now dynamically added
        loadingProgress: document.getElementById('loading-progress'),
        teamNameSuggestions: document.getElementById('team-name-suggestions'),
        customTeamName: document.getElementById('custom-team-name'),
        confirmTeamBtn: document.getElementById('confirm-team-btn'),
        draftHeader: document.getElementById('draft-header'),
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
        messagesList: document.getElementById('messages-list'),
        messagesNotificationDot: document.getElementById('messages-notification-dot'),
        scheduleList: document.getElementById('schedule-list'),
        standingsContainer: document.getElementById('standings-container'),
        playerStatsContainer: document.getElementById('player-stats-container'),
        statsFilterTeam: document.getElementById('stats-filter-team'),
        statsSort: document.getElementById('stats-sort'),
        hallOfFameList: document.getElementById('hall-of-fame-list'),
        depthChartSubTabs: document.getElementById('depth-chart-sub-tabs'),
        offenseFormationSelect: document.getElementById('offense-formation-select'),
        defenseFormationSelect: document.getElementById('defense-formation-select'),
        offenseDepthChartPane: document.getElementById('depth-chart-offense-pane'),
        defenseDepthChartPane: document.getElementById('depth-chart-defense-pane'),
        offenseDepthChartSlots: document.getElementById('offense-depth-chart-slots'),
        offenseDepthChartRoster: document.getElementById('offense-depth-chart-roster'),
        defenseDepthChartSlots: document.getElementById('defense-depth-chart-slots'),
        defenseDepthChartRoster: document.getElementById('defense-depth-chart-roster'),
        positionalOverallsContainer: document.getElementById('positional-overalls-container'),
        offseasonYear: document.getElementById('offseason-year'),
        playerDevelopmentContainer: document.getElementById('player-development-container'),
        retirementsList: document.getElementById('retirements-list'),
        hofInducteesList: document.getElementById('hof-inductees-list'),
        leavingPlayersList: document.getElementById('leaving-players-list'), // Added for offseason events
        goToNextDraftBtn: document.getElementById('go-to-next-draft-btn'),
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

export function showModal(title, bodyHtml, onConfirm = null) {
    elements.modalTitle.textContent = title;
    elements.modalBody.innerHTML = bodyHtml;
    
    let actionsDiv = elements.modal.querySelector('#modal-actions');
    if (actionsDiv) actionsDiv.remove(); 

    actionsDiv = document.createElement('div');
    actionsDiv.id = 'modal-actions';
    actionsDiv.className = 'mt-6 text-right space-x-2';

    if (onConfirm) {
        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = 'Confirm';
        confirmBtn.className = 'bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-6 rounded-lg';
        confirmBtn.onclick = () => {
            onConfirm();
            hideModal();
        };
        actionsDiv.appendChild(confirmBtn);
    }
    
    const closeBtn = document.createElement('button');
    closeBtn.id = 'modal-close-btn-dynamic'; 
    closeBtn.textContent = 'Close';
    closeBtn.className = 'bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-6 rounded-lg';
    closeBtn.onclick = hideModal; 
    actionsDiv.appendChild(closeBtn);

    elements.modal.querySelector('#modal-content').appendChild(actionsDiv);
    
    elements.modal.classList.remove('hidden');
}

export function hideModal() {
    if (elements.modal) {
        elements.modal.classList.add('hidden');
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
    const { year, draftOrder, currentPick, playerTeam } = gameState;
    const maxPicks = gameState.teams.reduce((max, t) => Math.max(max, t.draftNeeds), 0) * gameState.teams.length;


    if (currentPick >= maxPicks || gameState.players.filter(p => !p.teamId).length === 0) {
         elements.draftHeader.innerHTML = `<h2 class="text-3xl font-bold">Season ${year} Draft Complete</h2><p>All teams have filled their rosters or the player pool is empty.</p>`;
        elements.draftPlayerBtn.disabled = true;
        elements.draftPlayerBtn.textContent = 'Draft Complete';
        // Add a button to proceed to the season maybe?
        return;
    }

    // Ensure currentPick is valid before accessing draftOrder
    if (currentPick >= draftOrder.length) {
         console.error("Draft Error: currentPick is out of bounds for draftOrder array.");
         elements.draftHeader.innerHTML = `<h2 class="text-3xl font-bold text-red-500">Draft Error Occurred</h2>`;
         return;
    }

    const pickingTeam = draftOrder[currentPick];
    const playerNeedsPick = pickingTeam.id === playerTeam.id && playerTeam.roster.length < 10;

    elements.draftYear.textContent = year;
    elements.draftPickNumber.textContent = currentPick + 1;
    elements.draftPickingTeam.textContent = pickingTeam.name;
    renderDraftPool(gameState, onPlayerSelect);
    renderPlayerRoster(gameState.playerTeam);
    elements.draftPlayerBtn.disabled = !playerNeedsPick || selectedPlayerId === null;
    elements.draftPlayerBtn.textContent = playerNeedsPick ? 'Draft Player' : `Waiting for ${pickingTeam.name}...`;
}

export function renderDraftPool(gameState, onPlayerSelect) {
    const undraftedPlayers = gameState.players.filter(p => !p.teamId);
    const searchTerm = elements.draftSearch.value.toLowerCase();
    const posFilter = elements.draftFilterPos.value;
    let filteredPlayers = undraftedPlayers.filter(p => p.name.toLowerCase().includes(searchTerm) && (!posFilter || p.favoriteOffensivePosition === posFilter || p.favoriteDefensivePosition === posFilter));
    const sortMethod = elements.draftSort.value;
    if (sortMethod === 'age-asc') filteredPlayers.sort((a, b) => a.age - b.age);
    else if (sortMethod === 'age-desc') filteredPlayers.sort((a, b) => b.age - a.age);
    // Add sorting by overall?
    
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
    // Button state is handled in renderDraftScreen based on whose pick it is
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
    const { roster } = playerTeam;
    const positions = Object.keys(positionOverallWeights);

    if (roster.length === 0) {
        elements.rosterSummary.innerHTML = '<p class="text-xs text-gray-500">Your roster is empty.</p>';
        return;
    }

    let summaryHtml = '<h5 class="font-bold text-sm mb-1">Team Average Overalls</h5><div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">';

    positions.forEach(pos => {
        const totalOvr = roster.reduce((sum, player) => {
            return sum + calculateOverall(player, pos);
        }, 0);

        const avgOvr = Math.round(totalOvr / roster.length);

        summaryHtml += `
            <div class="flex justify-between">
                <span class="font-semibold">${pos}:</span>
                <span class="font-bold">${avgOvr}</span>
            </div>
        `;
    });

    summaryHtml += '</div>';
    elements.rosterSummary.innerHTML = summaryHtml;
}


export function renderDashboard(gameState) {
    const { playerTeam, year, currentWeek, messages } = gameState;
    elements.dashboardTeamName.textContent = playerTeam.name;
    elements.dashboardRecord.textContent = `Record: ${playerTeam.wins} - ${playerTeam.losses}`;
    elements.dashboardYear.textContent = year;
    elements.dashboardWeek.textContent = currentWeek < 9 ? `Week ${currentWeek + 1}` : 'Offseason';
    elements.advanceWeekBtn.textContent = currentWeek < 9 ? 'Advance Week' : 'Go to Offseason';
    
    let teamOptions = '<option value="">All Teams</option>';
    gameState.teams.sort((a,b) => a.name.localeCompare(b.name)).forEach(t => teamOptions += `<option value="${t.id}">${t.name}</option>`);
    elements.statsFilterTeam.innerHTML = teamOptions;
    
    updateMessagesNotification(messages);

    renderMyTeamTab(gameState); // Render the default tab
}

export function switchTab(tabId, gameState) {
    elements.dashboardContent.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
    elements.dashboardTabs.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-content-${tabId}`)?.classList.remove('hidden');
    document.querySelector(`[data-tab="${tabId}"]`)?.classList.add('active');
    switch (tabId) {
        case 'my-team': renderMyTeamTab(gameState); break;
        case 'depth-chart': renderDepthChartTab(gameState); break;
        case 'messages': renderMessagesTab(gameState); break; // Pass gameState
        case 'schedule': renderScheduleTab(gameState); break;
        case 'standings': renderStandingsTab(gameState); break;
        case 'player-stats': renderPlayerStatsTab(gameState); break;
        case 'hall-of-fame': renderHallOfFameTab(gameState); break;
    }
     // Mark messages as read if switching to the messages tab
    if (tabId === 'messages') {
        gameState.messages.forEach(msg => msg.isRead = true);
        updateMessagesNotification(gameState.messages);
    }
}

function renderMyTeamTab(gameState) {
    const { roster } = gameState.playerTeam;
    const physicalAttrs = ['Hgt', 'Wgt', 'Spd', 'Str', 'Agi', 'Stm'];
    const mentalAttrs = ['IQ', 'Clu', 'Cns', 'Tgh'];
    const technicalAttrs = ['Thr', 'Cat', 'Blk', 'Tck', 'BlS'];
    const headers = ['Name', 'Type', 'Age', 'Status', ...physicalAttrs, ...mentalAttrs, ...technicalAttrs];

    let tableHtml = `<div class="overflow-x-auto"><table class="min-w-full bg-white text-sm"><thead class="bg-gray-800 text-white sticky top-0 z-10"><tr>${headers.map(h => `<th class="py-2 px-1 text-xs">${h}</th>`).join('')}</tr></thead><tbody class="divide-y">`;
    
    roster.forEach(p => {
        const statusClass = p.status.duration > 0 ? 'text-red-500 font-semibold' : 'text-green-600';
        const typeTag = p.status.type === 'temporary' ? '<span class="status-tag temporary">[TEMP]</span>' : '<span class="status-tag permanent">[PERM]</span>';
        
        tableHtml += `<tr>
            <td class="py-2 px-2 font-semibold whitespace-nowrap">${p.name}</td>
            <td class="text-center py-2 px-1">${typeTag}</td>
            <td class="text-center py-2 px-1">${p.age}</td>
            <td class="text-center py-2 px-1 ${statusClass}">${p.status.description || 'Healthy'}</td>`;
        
        const attrs = p.attributes;
        const breakthrough = p.breakthroughAttr; 
        const renderAttr = (val, attrName, cat) => {
            let displayVal = val;
            if(attrName === 'height') displayVal = `${val}"`;
            if(attrName === 'weight') displayVal = `${val}lbs`;
             // Simplified mapping for display
            const shortMap = { playbookIQ: 'IQ', clutch: 'Clu', consistency: 'Cns', toughness: 'Tgh', throwingAccuracy: 'Thr', catchingHands: 'Cat', blocking: 'Blk', tackling: 'Tck', blockShedding: 'BlS', height: 'Hgt', weight: 'Wgt', speed: 'Spd', strength: 'Str', agility: 'Agi', stamina: 'Stm'};
            return `<td class="text-center py-2 px-1">${displayVal}${breakthrough === attrName ? ' <span class="text-green-500 font-bold">(+)</span>' : ''}</td>`;
        }
        
        tableHtml += renderAttr(attrs.physical.height, 'height', 'physical');
        tableHtml += renderAttr(attrs.physical.weight, 'weight', 'physical');
        tableHtml += renderAttr(attrs.physical.speed, 'speed', 'physical');
        tableHtml += renderAttr(attrs.physical.strength, 'strength', 'physical');
        tableHtml += renderAttr(attrs.physical.agility, 'agility', 'physical');
        tableHtml += renderAttr(attrs.physical.stamina, 'stamina', 'physical');

        tableHtml += renderAttr(attrs.mental.playbookIQ, 'playbookIQ', 'mental');
        tableHtml += renderAttr(attrs.mental.clutch, 'clutch', 'mental');
        tableHtml += renderAttr(attrs.mental.consistency, 'consistency', 'mental');
        tableHtml += renderAttr(attrs.mental.toughness, 'toughness', 'mental');
        
        tableHtml += renderAttr(attrs.technical.throwingAccuracy, 'throwingAccuracy', 'technical');
        tableHtml += renderAttr(attrs.technical.catchingHands, 'catchingHands', 'technical');
        tableHtml += renderAttr(attrs.technical.blocking, 'blocking', 'technical');
        tableHtml += renderAttr(attrs.technical.tackling, 'tackling', 'technical');
        tableHtml += renderAttr(attrs.technical.blockShedding, 'blockShedding', 'technical');

        tableHtml += `</tr>`;
    });
    elements.myTeamRoster.innerHTML = tableHtml + `</tbody></table></div>`;
}

function renderDepthChartTab(gameState) {
    renderPositionalOveralls(gameState.playerTeam.roster.filter(p => p.status.type !== 'temporary'));
    
    renderFormationDropdown('offense', Object.values(offenseFormations), gameState.playerTeam.formations.offense);
    renderDepthChartSide('offense', gameState, elements.offenseDepthChartSlots, elements.offenseDepthChartRoster);

    renderFormationDropdown('defense', Object.values(defenseFormations), gameState.playerTeam.formations.defense);
    renderDepthChartSide('defense', gameState, elements.defenseDepthChartSlots, elements.defenseDepthChartRoster);
}

function renderFormationDropdown(side, formations, currentFormationName) {
    const selectEl = elements[`${side}FormationSelect`];
    selectEl.innerHTML = formations.map(f => `<option value="${f.name}" ${f.name === currentFormationName ? 'selected' : ''}>${f.name}</option>`).join('');
}


function renderPositionalOveralls(roster) {
    const positions = Object.keys(positionOverallWeights);
    let table = `<table class="min-w-full text-sm text-left"><thead class="bg-gray-100"><tr><th class="p-2 font-semibold">Player</th>${positions.map(p => `<th class="p-2 font-semibold text-center">${p}</th>`).join('')}</tr></thead><tbody>`;
    roster.forEach(player => {
        table += `<tr class="border-b"><td class="p-2 font-bold">${player.name}</td>${positions.map(p => `<td class="p-2 text-center">${calculateOverall(player, p)}</td>`).join('')}</tr>`;
    });
    elements.positionalOverallsContainer.innerHTML = table + '</tbody></table>';
}

function renderDepthChartSide(side, gameState, slotsContainer, rosterContainer) {
    const { roster, depthChart } = gameState.playerTeam;
    const slots = Object.keys(depthChart[side]);

    slotsContainer.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'depth-chart-slot flex items-center justify-between font-bold text-xs text-gray-500 px-2';
    header.innerHTML = `<span class="w-1/4">POS</span><div class="player-details-grid w-3/4"><span>NAME</span><span>OVR</span><span>SPD</span><span>STR</span><span>AGI</span><span>THR</span><span>CAT</span></div>`;
    slotsContainer.appendChild(header);
    slots.forEach(slot => renderSlot(slot, roster, depthChart[side], slotsContainer, side));
    
    const offenseStarters = Object.values(depthChart.offense).filter(Boolean);
    const defenseStarters = Object.values(depthChart.defense).filter(Boolean);
    const allStarters = new Set([...offenseStarters, ...defenseStarters]);
    const availablePlayers = roster.filter(p => !allStarters.has(p.id) && p.status.type !== 'temporary');
    
    renderAvailablePlayerList(availablePlayers, rosterContainer, side);
}

function renderSlot(positionSlot, roster, chart, container, side) {
    const playerId = chart[positionSlot];
    const player = roster.find(p => p.id === playerId);
    const overall = player ? calculateOverall(player, positionSlot.replace(/\d/g, '')) : '---';
    const typeTag = player && player.status.type === 'temporary' ? '<span class="status-tag temporary">[T]</span>' : '';
    const slotEl = document.createElement('div');
    slotEl.className = 'depth-chart-slot bg-gray-200 p-2 rounded flex items-center justify-between';
    slotEl.dataset.positionSlot = positionSlot;
    slotEl.dataset.side = side;
    if (player) { slotEl.draggable = true; slotEl.dataset.playerId = player.id; }
    slotEl.innerHTML = `<span class="font-bold w-1/4">${positionSlot}</span><div class="player-details-grid w-3/4"><span>${typeTag} ${player ? player.name : 'Empty'}</span><span class="font-bold text-amber-600">${overall}</span><span>${player ? player.attributes.physical.speed : '-'}</span><span>${player ? player.attributes.physical.strength : '-'}</span><span>${player ? player.attributes.physical.agility : '-'}</span><span>${player ? player.attributes.technical.throwingAccuracy : '-'}</span><span>${player ? player.attributes.technical.catchingHands : '-'}</span></div>`;
    container.appendChild(slotEl);
}

function renderAvailablePlayerList(players, container, side) {
    container.innerHTML = '';
    players.forEach(player => {
        const typeTag = player.status.type === 'temporary' ? '<span class="status-tag temporary">[T]</span> ' : '';
        const playerEl = document.createElement('div');
        playerEl.className = 'draggable-player';
        playerEl.draggable = true;
        playerEl.dataset.playerId = player.id;
        playerEl.dataset.side = side; 
        playerEl.innerHTML = `${typeTag}${player.name}`;
        container.appendChild(playerEl);
    });
}

function renderMessagesTab(gameState, onMessageClick) {
    const { messages } = gameState;
    if (!messages || messages.length === 0) {
        elements.messagesList.innerHTML = `<p class="text-gray-500">No messages yet.</p>`;
        return;
    }
    let messagesHtml = '';
    messages.forEach(msg => {
        messagesHtml += `
            <div data-message-id="${msg.id}" class="message-item p-3 rounded-lg cursor-pointer border ${msg.isRead ? 'bg-gray-100 text-gray-600' : 'bg-amber-100 font-semibold border-amber-300'} hover:bg-amber-200 transition">
                <p>${msg.subject}</p>
            </div>
        `;
    });
    elements.messagesList.innerHTML = messagesHtml;
    elements.messagesList.querySelectorAll('.message-item').forEach(item => {
        item.onclick = () => {
             const message = gameState.messages.find(m => m.id === item.dataset.messageId);
             if (message) {
                 showModal(message.subject, `<p>${message.body}</p>`);
                 message.isRead = true; // Mark as read when clicked
                 item.classList.remove('bg-amber-100', 'font-semibold', 'border-amber-300');
                 item.classList.add('bg-gray-100', 'text-gray-600');
                 updateMessagesNotification(messages);
             }
        };
    });
    updateMessagesNotification(messages);
}

function updateMessagesNotification(messages) {
     const hasUnread = messages.some(m => !m.isRead);
    elements.messagesNotificationDot.classList.toggle('hidden', !hasUnread);
}


function renderScheduleTab(gameState) {
    let html = '';
    const gamesPerWeek = gameState.teams.length / 2;
    for (let i = 0; i < 9; i++) {
        const weekGames = gameState.schedule.slice(i * gamesPerWeek, (i + 1) * gamesPerWeek);
        const isPastWeek = i < gameState.currentWeek;
        
        let weekHtml = `<div class="p-4 rounded ${i === gameState.currentWeek ? 'bg-amber-100 border-2 border-amber-500' : 'bg-gray-100'}"><h4 class="font-bold text-lg mb-2">Week ${i + 1}</h4><div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">`;
        
        if (weekGames) {
            weekGames.forEach(g => {
                let content;
                const result = isPastWeek ? gameState.gameResults.find(r => r.homeTeam.id === g.home.id && r.awayTeam.id === g.away.id) : null;
                
                let resultClass = '';
                if (result) {
                    content = `<span>${g.away.name} <strong>${result.awayScore}</strong></span><span class="mx-2 font-bold text-gray-400">@</span><span>${g.home.name} <strong>${result.homeScore}</strong></span>`;
                    if (result.homeTeam.id === gameState.playerTeam.id) resultClass = result.homeScore > result.awayScore ? 'player-win' : (result.homeScore < result.awayScore ? 'player-loss' : '');
                    else if (result.awayTeam.id === gameState.playerTeam.id) resultClass = result.awayScore > result.homeScore ? 'player-win' : (result.awayScore < result.homeScore ? 'player-loss' : '');
                } else {
                    content = `<span>${g.away.name}</span><span class="mx-2 font-bold text-gray-400">@</span><span>${g.home.name}</span>`;
                }

                weekHtml += `<div class="bg-white p-2 rounded shadow-sm flex justify-center items-center gap-2 ${resultClass}">${content}</div>`;
            });
        }
        weekHtml += `</div></div>`;
        html += weekHtml;
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

function renderPlayerStatsTab(gameState) {
    const teamIdFilter = elements.statsFilterTeam.value;
    const sortStat = elements.statsSort.value;

    let playersToShow = teamIdFilter ? gameState.players.filter(p => p.teamId === teamIdFilter) : [...gameState.players];
    
    playersToShow.sort((a,b) => (b.seasonStats[sortStat] || 0) - (a.seasonStats[sortStat] || 0));

    const stats = ['passYards', 'rushYards', 'recYards', 'receptions', 'touchdowns', 'tackles', 'sacks', 'interceptions'];
    let tableHtml = `<div class="overflow-x-auto"><table class="min-w-full bg-white text-sm"><thead class="bg-gray-800 text-white sticky top-0 z-10"><tr><th class="text-left py-2 px-3">Name</th>${stats.map(s => `<th class="py-2 px-3">${s.replace(/([A-Z])/g, ' $1').toUpperCase()}</th>`).join('')}</tr></thead><tbody class="divide-y">`;
    
    playersToShow.forEach(p => {
        tableHtml += `<tr class="${p.teamId === gameState.playerTeam.id ? 'bg-amber-50' : ''}"><td class="py-2 px-3 font-semibold">${p.name}</td>${stats.map(s => `<td class="text-center py-2 px-3">${p.seasonStats[s] || 0}</td>`).join('')}</tr>`;
    });

    elements.playerStatsContainer.innerHTML = tableHtml + `</tbody></table></div>`;
}

function renderHallOfFameTab(gameState) {
    const inductees = gameState.hallOfFame;
    if (inductees.length === 0) {
        elements.hallOfFameList.innerHTML = '<p class="text-gray-500">The Hall of Fame is currently empty. Legends will be made!</p>';
        return;
    }

    let listHtml = '<div class="space-y-4">';
    inductees.forEach(p => {
        listHtml += `
            <div class="bg-gray-100 p-4 rounded-lg">
                <h4 class="font-bold text-lg text-amber-600">${p.name}</h4>
                <p class="text-sm text-gray-600">Seasons Played: ${p.careerStats.seasonsPlayed}</p>
                <div class="grid grid-cols-3 gap-2 mt-2 text-sm">
                    <span>TDs: <strong>${p.careerStats.touchdowns || 0}</strong></span>
                    <span>Pass Yds: <strong>${p.careerStats.passYards || 0}</strong></span>
                    <span>Rush Yds: <strong>${p.careerStats.rushYards || 0}</strong></span>
                    <span>Rec Yds: <strong>${p.careerStats.recYards || 0}</strong></span>
                    <span>Tackles: <strong>${p.careerStats.tackles || 0}</strong></span>
                </div>
            </div>
        `;
    });
    elements.hallOfFameList.innerHTML = listHtml + '</div>';
}

export function renderOffseasonScreen(offseasonReport, year) {
    const { retiredPlayers, hofInductees, developmentResults, leavingPlayers } = offseasonReport;
    elements.offseasonYear.textContent = year;

    let devHtml = '';
    developmentResults.forEach(res => {
        devHtml += `<div class="p-2 bg-gray-100 rounded text-sm mb-2"><p class="font-bold">${res.player.name} (${res.player.age})</p><div class="flex flex-wrap gap-x-2">`;
        res.improvements.forEach(imp => {
            devHtml += `<span class="text-green-600">${imp.attr} +${imp.increase}</span>`;
        });
        devHtml += '</div></div>';
    });
    elements.playerDevelopmentContainer.innerHTML = devHtml;

    elements.retirementsList.innerHTML = retiredPlayers.length > 0 ? retiredPlayers.map(p => `<li>${p.name} (Graduated)</li>`).join('') : '<li>None</li>';
    
    // Display other leaving players
    elements.leavingPlayersList.innerHTML = leavingPlayers.length > 0 ? leavingPlayers.map(l => `<li>${l.player.name} (${l.reason})</li>`).join('') : '<li>None</li>';

    elements.hofInducteesList.innerHTML = hofInductees.length > 0 ? hofInductees.map(p => `<li>${p.name}</li>`).join('') : '<li>None</li>';
}


export function setupDragAndDrop(onDrop) {
    const container = document.getElementById('dashboard-content');
    let draggedEl = null;

    container.addEventListener('dragstart', e => {
        if (e.target.matches('.draggable-player, .depth-chart-slot[draggable="true"]')) {
            draggedEl = e.target;
            dragPlayerId = e.target.dataset.playerId;
            dragSide = e.target.closest('.depth-chart-sub-pane')?.id.includes('offense') ? 'offense' : 'defense';
            if (!dragSide && e.target.matches('.draggable-player')) {
                dragSide = e.target.closest('.roster-list')?.id.includes('offense') ? 'offense' : 'defense';
            }
            setTimeout(() => e.target.classList.add('dragging'), 0);
        }
    });

    container.addEventListener('dragend', e => {
        if (draggedEl) {
            draggedEl.classList.remove('dragging');
            draggedEl = null;
            dragPlayerId = null;
            dragSide = null;
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
        const dropSide = slot?.dataset.side;

        if (slot && slot.dataset.positionSlot && dragPlayerId && dropSide === dragSide) {
            onDrop(dragPlayerId, slot.dataset.positionSlot, dropSide);
        }
    });
}

export function setupDepthChartTabs() {
    elements.depthChartSubTabs.addEventListener('click', e => {
        if (e.target.matches('.depth-chart-tab')) {
            const subTab = e.target.dataset.subTab;
            elements.depthChartSubTabs.querySelectorAll('.depth-chart-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            elements.offenseDepthChartPane.classList.toggle('hidden', subTab !== 'offense');
            elements.defenseDepthChartPane.classList.toggle('hidden', subTab === 'offense');
        }
    });
}

