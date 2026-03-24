// js/main.js
import * as Game from './game.js';
import * as UI from './ui.js';
import { positionOverallWeights, estimateBestPosition } from './game/player.js';
import { relationshipLevels, coachPersonalities, offenseFormations, defenseFormations } from './data.js';
import { formatHeight } from './utils.js';

// --- Global State ---
let gameState = null;
let selectedPlayerId = null;
let currentLiveSimResult = null;
let currentSortColumn = 'potential';
let currentSortDirection = 'desc';
let activeSaveKey = 'backyardFootballGameState';

// --- Constants ---
const ROSTER_LIMIT = 12;
const MIN_HEALTHY_PLAYERS = 8;
const WEEKS_IN_SEASON = 9;

function yieldToMain() { return new Promise(resolve => setTimeout(resolve, 0)); }

// =============================================================
// --- CORE HANDLERS ---
// =============================================================


// =============================================================
// --- CORE HANDLERS (FRANCHISE SETUP) ---
// =============================================================

async function startNewGame() {
    // 1. Generate Form HTML dynamically from data.js
    const styleOptions = coachPersonalities.map(c => `<option value="${c.type}">${c.type}</option>`).join('');
    const offOptions = Object.keys(offenseFormations)
        .filter(k => k !== 'Punt' && k !== 'Punt_Return')
        .map(k => `<option value="${k}">${offenseFormations[k].name}</option>`).join('');
    const defOptions = Object.keys(defenseFormations)
        .filter(k => k !== 'Punt_Return' && k !== 'Punt')
        .map(k => `<option value="${k}">${defenseFormations[k].name}</option>`).join('');

    // 2. Inject Form into the existing Team Creation Screen
    const container = document.querySelector('#team-creation-screen > div');
    container.innerHTML = `
        <h2 class="text-4xl font-bold mb-2 text-center text-gray-800">Create Your Franchise</h2>
        <p class="text-sm text-gray-500 mb-6 text-center">Establish your identity. Running your preferred formations gives players a +5 IQ and Consistency boost on the field.</p>
        
        <div class="space-y-4 text-sm text-gray-700 text-left">
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label class="block font-bold mb-1">Coach Name:</label>
                    <input id="setup-coach-name" type="text" placeholder="e.g. Coach Taylor" class="w-full border border-gray-300 rounded p-2 focus:ring-amber-500 focus:border-amber-500">
                </div>
                <div>
                    <label class="block font-bold mb-1">Coaching Style:</label>
                    <select id="setup-coach-style" class="w-full border border-gray-300 rounded p-2 focus:ring-amber-500 focus:border-amber-500">
                        ${styleOptions}
                    </select>
                </div>
            </div>

            <div class="grid grid-cols-2 gap-4 border-t border-gray-100 pt-4 mt-2">
                <div>
                    <label class="block font-bold mb-1">Preferred Offense:</label>
                    <select id="setup-pref-off" class="w-full border border-gray-300 rounded p-2 focus:ring-amber-500 focus:border-amber-500">
                        ${offOptions}
                    </select>
                </div>
                <div>
                    <label class="block font-bold mb-1">Preferred Defense:</label>
                    <select id="setup-pref-def" class="w-full border border-gray-300 rounded p-2 focus:ring-amber-500 focus:border-amber-500">
                        ${defOptions}
                    </select>
                </div>
            </div>

            <div class="border-t border-gray-100 pt-4 mt-2">
                <label class="block font-bold mb-1">Team Name:</label>
                <div class="flex gap-2">
                    <input id="setup-team-name" type="text" placeholder="e.g. The Bulldogs" class="w-full border border-gray-300 rounded p-2 focus:ring-amber-500 focus:border-amber-500">
                </div>
            </div>

            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label class="block font-bold mb-1">Primary Color:</label>
                    <input type="color" id="setup-primary-color" value="#2563EB" class="w-full h-10 rounded cursor-pointer border border-gray-300 p-0.5">
                </div>
                <div>
                    <label class="block font-bold mb-1">Secondary Color:</label>
                    <input type="color" id="setup-secondary-color" value="#FFFFFF" class="w-full h-10 rounded cursor-pointer border border-gray-300 p-0.5">
                </div>
            </div>
        </div>

        <button id="confirm-team-btn" class="mt-8 btn bg-amber-600 hover:bg-amber-700 text-white font-bold py-4 px-8 rounded-xl w-full text-xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-0.5">
            Start Franchise →
        </button>
    `;

    document.getElementById('confirm-team-btn').addEventListener('click', handleConfirmTeam);
    UI.showScreen('team-creation-screen');
}
function handleTeamNameSelection(name) {
    const customNameInput = document.getElementById('custom-team-name');
    if (customNameInput) customNameInput.value = name;
}

async function handleConfirmTeam() {
    const teamName = document.getElementById('setup-team-name').value.trim();
    const coachName = document.getElementById('setup-coach-name').value.trim();
    const coachStyle = document.getElementById('setup-coach-style').value;
    const prefOff = document.getElementById('setup-pref-off').value;
    const prefDef = document.getElementById('setup-pref-def').value;
    const primaryColor = document.getElementById('setup-primary-color').value;
    const secondaryColor = document.getElementById('setup-secondary-color').value;

    if (!teamName || !coachName) {
        UI.showModal("Missing Info", "<p>Please provide both a Team Name and a Coach Name.</p>");
        return;
    }

    try {
        UI.showScreen("loading-screen");
        UI.startLoadingMessages();
        await new Promise(resolve => setTimeout(resolve, 50));

        // 1. Generate League (AI Teams and Player Pool)
        await Game.initializeLeague((progress) => {
            UI.updateLoadingProgress(Math.round(progress * 100));
        });

        // 2. Create Player Team with new details
        Game.createPlayerTeam(teamName, {
            coachName, coachStyle, prefOff, prefDef, primaryColor, secondaryColor
        });

        gameState = Game.getGameState();
        gameState.draftCompleted = false; // Flag to catch advance week

        // 3. Generate Draft Preview Messages
        generateDraftPreviewMessage();

        UI.stopLoadingMessages();

        // 4. Change Advance Week button text to "Go to Draft"
        const advBtn = document.getElementById('advance-week-btn');
        if (advBtn) {
            advBtn.innerHTML = `<span>Start Draft</span><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 ml-2" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>`;
            advBtn.classList.remove('bg-amber-500', 'hover:bg-amber-600');
            advBtn.classList.add('bg-green-600', 'hover:bg-green-700', 'animate-pulse');
        }

        // 5. Go directly to Dashboard (Messages Tab)
        UI.renderDashboard(gameState);
        UI.switchTab('messages', gameState); 
        UI.showScreen('dashboard-screen');
        
        // 💡 ADD THIS: Run the first set of picks immediately
        // This ensures if you are pick #5, picks 1-4 happen before you open the draft.
        runAIDraftPicks();

    } catch (error) {
        console.error("Error starting game:", error);
        UI.stopLoadingMessages();
        UI.showModal("Error", `Could not start game: ${error.message}`);
    }
}

function generateDraftPreviewMessage() {
    const players = gameState.players.filter(p => !p.teamId);

    // 1. Group all players by their estimated position
    const grouped = { QB: [], RB: [], WR: [], TE: [], OL: [], DL: [], LB: [], DB: [] };

    players.forEach(p => {
        let pos = estimateBestPosition(p);
        if (['OT', 'OG', 'C'].includes(pos)) pos = 'OL';
        if (['DE', 'DT', 'NT'].includes(pos)) pos = 'DL';
        if (['CB', 'S', 'FS', 'SS'].includes(pos)) pos = 'DB';
        if (pos === 'FB') pos = 'RB';
        if (['ATH', 'K', 'P'].includes(pos)) pos = 'WR';

        if (grouped[pos]) grouped[pos].push(p);
    });

    // 2. Sort each group from Highest OVR to Lowest OVR
    Object.keys(grouped).forEach(pos => {
        grouped[pos].sort((a, b) => Game.calculateOverall(b, pos) - Game.calculateOverall(a, pos));
    });

    const qbs = grouped['QB'];
    const rbs = grouped['RB'];
    const wrs = grouped['WR'];
    const tes = grouped['TE'];
    const trenches = [...grouped['OL'], ...grouped['DL']];
    const lbs = grouped['LB'];
    const dbs = grouped['DB'];

    // 3. Analyze overall class strength
    const topPotentials = players.filter(p => ['A', 'B'].includes(p.potential)).length;
    let strength = "Average";
    if (topPotentials > 30) strength = "Generational";
    else if (topPotentials > 20) strength = "Deep and Talented";
    else if (topPotentials < 10) strength = "Top-Heavy";

    // Extract Top Players for Flavor
    const topQB = qbs[0];
    const topRB = rbs[0];
    const topWR = wrs[0];
    const topDefender = [...lbs, ...dbs, ...grouped['DL']].sort((a, b) => Game.calculateOverall(b, estimateBestPosition(b)) - Game.calculateOverall(a, estimateBestPosition(a)))[0];

    // 5. Generate Dynamic Text
    const msgBody = `Welcome to the league, Coach ${gameState.playerTeam.coach.name}!\n\n` +
        `The scouting department has finalized their evaluations for the inaugural draft. Overall, our scouts are calling this class **${strength}**, with ${topPotentials} players grading out with A or B potential.\n\n` +
        `Here is the breakdown by position:\n\n` +
        `**Quarterbacks:**\n` +
        `${topQB ? `The prize of the class is **${topQB.name}**. Scouts are enamored with his arm talent (${Game.calculateOverall(topQB, 'QB')} OVR). Beyond him, there are ${qbs.length - 1} other passers in the pool.` : 'A completely barren class for signal callers. You might have to run the Wildcat!'}\n\n` +
        `**Running Backs:**\n` +
        `${rbs.length > 0 ? `Led by the explosive **${topRB.name}**, this group features ${rbs.length} pure runners capable of carrying the load.` : 'A very thin class for tailbacks.'}\n\n` +
        `**Receivers & Tight Ends:**\n` +
        `${wrs.length + tes.length > 20 ? `A incredibly deep class for pass catchers. **${topWR?.name || 'Several elite athletes'}** leads a group where you can absolutely afford to wait and still find value in the middle rounds.` : 'Thin class. If you want a perimeter weapon, grab one early.'}\n\n` +
        `**The Trenches (OL/DL):**\n` +
        `Games are won in the trenches, and there are ${trenches.length} big bodies available. ${trenches.length > 30 ? 'Plenty of beef to go around to protect your QB.' : 'Premium linemen are scarce; you might have to reach early.'}\n\n` +
        `**Linebackers & Secondary:**\n` +
        `${topDefender ? `Defensively, everyone is talking about **${topDefender.name}**, an absolute game-wrecker. ` : ''}` +
        `There are ${dbs.length} defensive backs and ${lbs.length} linebackers in the pool. ${dbs.length > 15 ? 'Pass defense shouldn\'t be an issue with this many ballhawks available.' : 'Lockdown corners are rare this year.'}\n\n` +
        `Get your draft board ready. When you are set, click "Start Draft" at the top right of your screen to hit the war room!`;

    // Clear generic messages
    gameState.messages = [];

    // Welcome Message
    Game.addMessage("League Office", `Welcome to Backyard GM!`, false, gameState);
    gameState.messages[0].body = `Coach, we've set up your office. Remember, running your preferred schemes (${gameState.playerTeam.formations.offense} & ${gameState.playerTeam.formations.defense}) will give your players a confidence boost on the field (+5 Playbook IQ and Consistency). Good luck!`;

    // Draft Preview Message
    Game.addMessage("Scouting Dept", `Inaugural Draft Preview: A ${strength} Class`, false, gameState);
    gameState.messages[0].body = msgBody;
}


function handlePlayerSelectInDraft(playerId) {
    if (!gameState) return;
    selectedPlayerId = playerId;
    const player = gameState.players.find(p => p.id === playerId);
    UI.updateSelectedPlayerRow(playerId);
    UI.renderSelectedPlayerCard(player, gameState);
}

function handleDraftPlayer() {
    if (!gameState || isDraftingLocked) return;
    if (selectedPlayerId) {
        const player = gameState.players.find(p => p.id === selectedPlayerId);
        const team = gameState.playerTeam;
        if (team.roster.length >= ROSTER_LIMIT) {
            UI.showModal("Roster Full", `<p>Roster full (${ROSTER_LIMIT} players).</p>`);
            return;
        }

        if (player && Game.addPlayerToTeam(player, team)) {
            const gs = Game.getGameState(); // 💡 FIX: Get fresh reference
            if (!gs.pickHistory) gs.pickHistory = [];
            
            gs.pickHistory.push({
                pick: gs.currentPick + 1,
                teamName: team.name,
                teamId: team.id,
                playerName: player.name,
                pos: estimateBestPosition(player),
                ovr: Game.calculateOverall(player, estimateBestPosition(player)),
                potential: player.potential
            });

            selectedPlayerId = null;
            gs.currentPick++; // Use fresh reference
            UI.renderSelectedPlayerCard(null, gs);
            UI.renderDraftScreen(gs, handlePlayerSelectInDraft, null, currentSortColumn, currentSortDirection);
            runAIDraftPicks();
        }
    }
}


let isDraftingLocked = false;

async function runAIDraftPicks() {
    if (!gameState || isDraftingLocked) return;
    isDraftingLocked = true;

    try {
        // Use a loop instead of recursion to prevent locking issues
        while (true) {
            // 1. Check End Conditions
            const pickLimitReached = gameState.currentPick >= gameState.draftOrder.length;
            const noPlayersLeft = gameState.players.filter(p => p && !p.teamId).length === 0;
            const allTeamsFull = gameState.teams.every(t => !t || !t.roster || t.roster.length >= ROSTER_LIMIT);

            if (pickLimitReached || noPlayersLeft || allTeamsFull) {
                await handleDraftEnd();
                break;
            }

            // 2. Get Current Team
            let currentPickingTeam = gameState.draftOrder[gameState.currentPick];

            // 3. If it's the PLAYER'S turn, stop the loop and let them click UI
            if (currentPickingTeam && currentPickingTeam.id === gameState.playerTeam.id) {
                // If player is full, skip them automatically
                if (gameState.playerTeam.roster.length >= ROSTER_LIMIT) {
                    gameState.currentPick++;
                    UI.renderSelectedPlayerCard(null, gameState);
                    // Continue loop to let AI pick
                    continue;
                } else {
                    // Unlock and wait for user input
                    UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId, currentSortColumn, currentSortDirection);
                    break;
                }
            }

            // 4. AI Turn
            if (!currentPickingTeam || !currentPickingTeam.roster || currentPickingTeam.roster.length >= ROSTER_LIMIT) {
                // Skip if invalid or full
                gameState.currentPick++;
            } else {
                // Visualize the draft board updating
                UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId, currentSortColumn, currentSortDirection);
                await new Promise(resolve => setTimeout(resolve, 50)); // Visual delay

                Game.simulateAIPick(currentPickingTeam);
                gameState.currentPick++;
            }
        }
    } catch (e) {
        console.error("Draft loop error:", e);
    } finally {
        isDraftingLocked = false;
    }
}

async function handleDraftEnd() {
    if (!gameState) return;

    // 💡 NEW: Call the summary generator before switching screens
    Game.generateDraftSummary();

    let _draftFinalized = false;
    const finalizeDraft = async () => {
        if (_draftFinalized) return;
        _draftFinalized = true;
        try {
            Game.generateSchedule();
            gameState = Game.getGameState();
            gameState.draftCompleted = true; // Mark draft as done

            // 💡 NEW: Generate Week 1 Matchup Preview
            generateWeeklyMatchupPreview();

            // Reset the Advance button UI back to normal
            const advBtn = document.getElementById('advance-week-btn');
            if (advBtn) {
                advBtn.innerHTML = `<span>Play Week</span><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>`;
                advBtn.classList.add('bg-amber-500', 'hover:bg-amber-600');
                advBtn.classList.remove('bg-green-600', 'hover:bg-green-700', 'animate-pulse');
            }

            UI.renderDashboard(gameState);
            UI.switchTab('my-team', gameState);
            UI.showScreen('dashboard-screen');
            try { UI.hideModal(); } catch (e) { }
        } catch (error) {
            UI.showModal("Error", `Could not proceed: ${error.message}`, null, '', null, 'Close');
        }
    };

    UI.showModal("Draft Complete!", "<p>Finalizing rosters and building schedule... Please wait.</p>", finalizeDraft, "Start Season");

    const modalConfirmBtn = document.querySelector('#modal-actions button.bg-amber-500');
    if (modalConfirmBtn) {
        modalConfirmBtn.disabled = true;
        modalConfirmBtn.textContent = "Loading...";
    }

    await yieldToMain();

    for (const team of gameState.teams) {
        if (!team) continue;
        try { Game.aiSetDepthChart(team); } catch (error) { console.error(error); }
    }

    const modalBody = document.getElementById('modal-body');
    if (modalBody) modalBody.innerHTML = "<p>Draft complete. Get ready for the season!</p>";
    if (modalConfirmBtn) {
        modalConfirmBtn.disabled = false;
        modalConfirmBtn.textContent = "Start Season";
    }

    try { await yieldToMain(); finalizeDraft(); } catch (e) { }
}

/**
 * Generates a scouting report message for the upcoming opponent
 * and adds it to the player's inbox.
 */
function generateWeeklyMatchupPreview() {
    const gs = Game.getGameState();
    if (!gs || !gs.schedule || gs.currentWeek >= 9) return; // Hardcode to 9 weeks safety

    const gamesPerWeek = gs.teams.length / 2;
    const weekGames = gs.schedule.slice(gs.currentWeek * gamesPerWeek, (gs.currentWeek + 1) * gamesPerWeek);
    const myGame = weekGames.find(g => g.home.id === gs.playerTeam.id || g.away.id === gs.playerTeam.id);

    if (!myGame) return; // Bye week

    const isHome = myGame.home.id === gs.playerTeam.id;
    const opponent = isHome ? myGame.away : myGame.home;

    const oppRoster = Game.getRosterObjects(opponent);
    const oppQB = oppRoster.find(p => p && p.id === opponent.depthChart?.offense?.QB1);

    // Safely find their best player without relying on out-of-scope imports
    const bestPlayer = oppRoster
        .filter(p => p && p.id !== oppQB?.id)
        .sort((a, b) => {
            const posA = a.pos || a.favoriteOffensivePosition || 'WR';
            const posB = b.pos || b.favoriteOffensivePosition || 'WR';
            return Game.calculateOverall(b, posB) - Game.calculateOverall(a, posA);
        })[0];

    const locationText = isHome ? `We are defending home turf` : `We are on the road`;
    const coachType = opponent.coach?.type || 'Balanced';
    const offForm = opponent.formations?.offense || 'Balanced';
    const defForm = opponent.formations?.defense || '3-1-3';

    let body = `Coach,\n\nHere is the advance scouting report for our upcoming Week ${gs.currentWeek + 1} matchup against ${opponent.name}.\n\n` +
        `**Game Info:** ${locationText}. They currently hold a record of ${opponent.wins || 0}-${opponent.losses || 0}.\n\n` +
        `**Opponent Tendencies:**\n` +
        `Head Coach ${opponent.coach?.name || 'Smith'} runs a **${coachType}** system. ` +
        `Expect to see them line up primarily in a **${offForm}** formation on offense, and run a **${defForm}** defense to counter us.\n\n`;

    if (oppQB) {
        body += `**Key Matchup:** Their offense runs through QB ${oppQB.name} (${Game.calculateOverall(oppQB, 'QB')} OVR). We need to disrupt his timing in the pocket.\n\n`;
    }

    if (bestPlayer) {
        const bPos = bestPlayer.pos || bestPlayer.favoriteOffensivePosition || 'ATH';
        body += `**Player to Watch:** Keep an eye on ${bestPlayer.name}, their star ${bPos} (${Game.calculateOverall(bestPlayer, bPos)} OVR). He is a true game-changer.\n\n`;
    }

    body += `Set your depth chart and gameplan accordingly. Let's get this win.`;

    Game.addMessage(`Scouting Report: Week ${gs.currentWeek + 1} vs ${opponent.name}`, body, false, gs);

    // 💡 FIXED: Use the UI prefix so the function is found
    UI.updateMessagesNotification(gs.messages);
}

// --- LOADING & SAVING ---

async function handleLoadGame(saveKey) {
    try {
        const keyToLoad = saveKey || 'backyardFootballGameState';
        const loadedState = Game.loadGameState(keyToLoad);

        if (!loadedState || !loadedState.teams) {
            UI.showModal("Load Failed", "<p>No saved game data found.</p>");
            return;
        }

        gameState = loadedState;
        selectedPlayerId = null;
        activeSaveKey = keyToLoad;

        // Force Depth Chart rebuild to fix any save data mismatches
        if (gameState.playerTeam) {
            Game.rebuildDepthChartFromOrder(gameState.playerTeam);
        }

        if (gameState.currentWeek >= 0) {
            UI.renderDashboard(gameState);
            UI.switchTab('my-team', gameState);
            UI.showScreen('dashboard-screen');
        } else {
            UI.renderSelectedPlayerCard(null, gameState);
            UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId, currentSortColumn, currentSortDirection);
            UI.showScreen('draft-screen');
        }
    } catch (error) {
        console.error("Load Error:", error);
        UI.showModal("Error", `Could not load game: ${error.message}`, null, '', null, 'Close');
    }
}

async function handleLoadTestRoster() { await handleLoadGame('my_test_roster'); }

function handleSaveTestRoster() {
    if (!gameState) return;
    Game.saveGameState('my_test_roster');
    activeSaveKey = 'my_test_roster';
    UI.showModal("Saved", "<p>Game saved as 'Test Roster'.</p>");
}

// --- DASHBOARD INTERACTION ---

function handleTabSwitch(e) {
    const button = e.target.closest('.tab-button');

    if (button) {
        const tabId = button.dataset.tab;

        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.classList.remove('active');
            btn.setAttribute('aria-selected', 'false');
        });
        button.classList.add('active');
        button.setAttribute('aria-selected', 'true');

        gameState = Game.getGameState();
        if (gameState) {
            UI.switchTab(tabId, gameState);
        }
    }
}

function handleFormationChange(e) {
    if (!gameState) return;
    const side = e.target.id.includes('offense') ? 'offense' : 'defense';
    const formationName = e.target.value;

    // 1. Update Game Logic
    Game.changeFormation(side, formationName);

    // 2. Save
    Game.saveGameState(activeSaveKey);

    // 3. Refresh UI
    document.dispatchEvent(new CustomEvent('refresh-ui'));
}

function handleDepthChartDrop(playerId, newPositionSlot, side) {
    if (!gameState) return;

    // 1. Explicitly assign player to the exact slot
    Game.assignPlayerToSlot(gameState.playerTeam, playerId, newPositionSlot, side);

    // 2. Refresh local state
    gameState = Game.getGameState();

    // 3. Save
    Game.saveGameState(activeSaveKey);

    // 4. Force UI Refresh
    document.dispatchEvent(new CustomEvent('refresh-ui'));
}

function handleDepthChartSelect(e) {
    if (!e.target.matches('.slot-select')) return;
    const selectEl = e.target;

    const val = selectEl.value;
    const playerId = (val === 'null' || val === '') ? null : val;
    const slot = selectEl.dataset.slotId || selectEl.dataset.slot;
    const side = selectEl.dataset.side;

    if (slot && side && gameState) {
        // 💡 THE FIX: Call the UI helper we just updated
        // This ensures the priority list is updated when you use the dropdown
        handleDepthChartChange(side, slot, playerId);
    }
}

// --- SIMULATION & WEEK ADVANCE ---

function proceedWithAdvanceWeek() {
    if (!gameState) return;
    try { UI.hideModal(); } catch (e) { }

    const playerTeamId = gameState.playerTeam.id;
    const gamesPerWeek = gameState.teams.length / 2;
    const weekGames = gameState.schedule.slice(gameState.currentWeek * gamesPerWeek, (gameState.currentWeek + 1) * gamesPerWeek);
    const playerGameMatch = weekGames.find(g => g.home.id === playerTeamId || g.away.id === playerTeamId);

    if (playerGameMatch) {
        const isHome = playerGameMatch.home.id === playerTeamId;
        const opponentName = isHome ? playerGameMatch.away.name : playerGameMatch.home.name;
        const location = isHome ? "at Home" : "Away";

        // Prompt the user: Watch Live or Quick Sim?
        UI.showModal(
            `Game Day: Week ${gameState.currentWeek + 1}`,
            `<p class="mb-4">Your team is playing <strong>${opponentName}</strong> (${location}).</p><p>How do you want to play this week?</p>`,
            () => startLiveGame(playerGameMatch), // Primary Action
            "Watch Game",
            () => simulateRestOfWeek(), // Secondary Action
            "Quick Sim"
        );
    } else {
        // Bye week or no game, just sim it instantly
        simulateRestOfWeek();
    }
}

async function handleAdvanceWeek() {
    if (!gameState) return;

    // --- CHECK IF INAUGURAL DRAFT IS NEEDED FIRST ---
    if (gameState.currentWeek === 0 && !gameState.draftCompleted) {
        Game.setupDraft();
        gameState = Game.getGameState();
        selectedPlayerId = null;
        UI.renderSelectedPlayerCard(null, gameState);
        UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId, currentSortColumn, currentSortDirection);
        UI.showScreen('draft-screen');
        runAIDraftPicks();
        return;
    }

    const rosterObjects = Game.getRosterObjects(gameState.playerTeam);
    const healthyCount = rosterObjects.filter(p => p && p.status?.duration === 0).length;

    if (healthyCount < MIN_HEALTHY_PLAYERS) {
        const hasFreeAgents = gameState.freeAgents && gameState.freeAgents.length > 0;
        if (hasFreeAgents) {
            promptCallFriend(proceedWithAdvanceWeek);
            return;
        } else {
            UI.showModal("Warning: Short Roster",
                `<p>You only have ${healthyCount} healthy players. You need ${MIN_HEALTHY_PLAYERS} to avoid forfeiting.</p><p>No friends are available to call.</p>`,
                () => proceedWithAdvanceWeek(), "Proceed Anyway"
            );
            return;
        }
    }

    const emptySlots = Game.getDepthChartEmptySlots(gameState.playerTeam);
    if (emptySlots.length > 0) {
        UI.showModal("Incomplete Depth Chart",
            `<p class="mb-2">Your depth chart has missing starters!</p>
             <div class="max-h-32 overflow-y-auto bg-red-50 p-3 rounded mb-4 text-sm text-red-700 border border-red-200">
                <ul class="list-disc pl-5">${emptySlots.map(s => `<li>${s}</li>`).join('')}</ul>
             </div>
             <p>Do you want to proceed anyway? (The AI will auto-fill the gaps with backups if possible)</p>`,
            () => proceedWithAdvanceWeek(), "Proceed Anyway",
            () => { try { UI.hideModal(); } catch (e) { } }, "Fix Lineup"
        );
        return;
    }

    proceedWithAdvanceWeek();
}

async function startLiveGame(playerGameMatch) {
    if (!gameState) return;
    currentLiveSimResult = null;

    // 💡 FIX: Show Loading Modal
    UI.showModal("Simulating League", "<div id='cpu-sim-results' class='text-sm space-y-1 h-48 overflow-y-auto'>Simulating games...</div>", null, '', null, 'Please Wait');
    const modalContent = document.getElementById('cpu-sim-results');

    // 1. Simulate the OTHER games (Fast Sim)
    const gamesPerWeek = gameState.teams.length / 2;
    const allGames = gameState.schedule.slice(gameState.currentWeek * gamesPerWeek, (gameState.currentWeek + 1) * gamesPerWeek);
    const otherResults = [];

    for (const match of allGames) {
        // Skip the player's game for now
        if (match.home.id === playerGameMatch.home.id && match.away.id === playerGameMatch.away.id) continue;

        try {
            // Fast sim the CPU games
            if (typeof Game.simulateMatchFast === 'function') {
                // Small delay to allow UI to update between chunks
                await new Promise(resolve => setTimeout(resolve, 50));

                const result = Game.simulateMatchFast(match.home, match.away);
                otherResults.push(result);

                if (modalContent) {
                    modalContent.innerHTML += `<p>${match.away.name} <span class="font-bold">${result.awayScore}</span> @ ${match.home.name} <span class="font-bold">${result.homeScore}</span></p>`;
                    modalContent.scrollTop = modalContent.scrollHeight;
                }
            }
        } catch (error) {
            console.error(`Sim error for CPU game:`, error);
        }
    }

    // Give the player a second to see the results before jumping into their game
    if (otherResults.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 1500));
    }
    UI.hideModal();

    // 💡 FIX: Reset Stats and Fatigue BEFORE starting the live game
    if (typeof Game.resetGameStats === 'function') {
        Game.resetGameStats(playerGameMatch.home, playerGameMatch.away);
    }

    // 2. Initialize Player's Live Game Object
    // We do NOT call simulateGame here. We create the state container.

    // 2. Initialize Player's Live Game Object
    // We do NOT call simulateGame here. We create the state container.
    const liveGameParams = {
        homeTeam: playerGameMatch.home,
        awayTeam: playerGameMatch.away,
        homeScore: 0,
        awayScore: 0,
        possession: Math.random() < 0.5 ? playerGameMatch.home : playerGameMatch.away, // Coin toss
        ballOn: 35, // Kickoff
        down: 1,
        yardsToGo: 10,
        gameLog: [`Coin Toss! ${playerGameMatch.home.name} vs ${playerGameMatch.away.name}`],
        isConversionAttempt: false,
        isGameOver: false,
        weather: 'Sunny',
        quarter: 1,
        // 💡 FIX: Added missing counters to prevent NaN errors in game loop
        drivesThisHalf: 0,
        homeTeamPlayHistory: [],
        awayTeamPlayHistory: []
    };

    // 3. Hand over control to UI
    UI.showScreen('game-sim-screen');

    // UI.startLiveGameLoop will handle the "Step -> Animate -> Step" cycle
    UI.startLiveGameLoop(liveGameParams, (finalResult) => {

        // 1. Finalize the Player's Game Records & Stats
        Game.finalizeGameResults(
            finalResult.homeTeam,
            finalResult.awayTeam,
            finalResult.homeScore,
            finalResult.awayScore
        );

        const combinedResults = [...otherResults, finalResult];

        // 2. Add results to history
        if (!gameState.gameResults) gameState.gameResults = [];

        // Store minimal results for the Schedule tab
        gameState.gameResults.push(...combinedResults.filter(Boolean).map(r => ({
            homeTeam: { id: r.homeTeam.id, name: r.homeTeam.name },
            awayTeam: { id: r.awayTeam.id, name: r.awayTeam.name },
            homeScore: r.homeScore,
            awayScore: r.awayScore
        })));

        gameState.currentWeek++;

        // 💡 FIX: Force a save to LocalStorage here so seasonStats persist!
        Game.saveGameState();

        finishWeekSimulation(combinedResults);
    });
}

async function simulateRestOfWeek() {
    let results = null;
    try {
        if (!gameState || gameState.currentWeek >= WEEKS_IN_SEASON) {
            if (gameState) handleSeasonEnd();
            return;
        }

        // 💡 FIX: Show Loading Modal
        UI.showModal("Simulating League", "<div id='cpu-sim-results' class='text-sm space-y-1 h-48 overflow-y-auto'>Simulating rest of week...</div>", null, '', null, 'Please Wait');
        const modalContent = document.getElementById('cpu-sim-results');
        await new Promise(resolve => setTimeout(resolve, 50)); // allow render to catch up

        if (typeof Game.simulateWeek === 'function') {
            results = Game.simulateWeek({ fastSim: true });

            // Print the final batch to the modal
            if (modalContent && results) {
                modalContent.innerHTML = '';
                results.forEach(r => {
                    modalContent.innerHTML += `<p>${r.awayTeam.name} <span class="font-bold">${r.awayScore}</span> @ ${r.homeTeam.name} <span class="font-bold">${r.homeScore}</span></p>`;
                });
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        }
        UI.hideModal();

    } catch (error) {
        console.error("Sim week error:", error);
        if (gameState) gameState.currentWeek++;
        results = [];
    }

    if (results !== null) {
        finishWeekSimulation(results);
    } else if (gameState && gameState.currentWeek >= WEEKS_IN_SEASON) {
        handleSeasonEnd();
    } else {
        gameState = Game.getGameState();
        if (gameState) {
            UI.renderDashboard(gameState);
            UI.showScreen('dashboard-screen');
        }
    }
}

function finishWeekSimulation(results) {
    if (!gameState) {
        gameState = Game.getGameState();
        if (gameState) { UI.renderDashboard(gameState); UI.showScreen('dashboard-screen'); }
        return;
    }

    const buildResultsModalHtml = (results) => {
        if (!gameState?.playerTeam || !Array.isArray(results)) return "<p>Error.</p>";
        const playerGame = results.find(r => r && (r.homeTeam?.id === gameState.playerTeam.id || r.awayTeam?.id === gameState.playerTeam.id));

        let resultText = 'BYE';
        if (playerGame) {
            const myScore = playerGame.homeTeam.id === gameState.playerTeam.id ? playerGame.homeScore : playerGame.awayScore;
            const oppScore = playerGame.homeTeam.id === gameState.playerTeam.id ? playerGame.awayScore : playerGame.homeScore;
            if (myScore > oppScore) resultText = "WON";
            else if (myScore < oppScore) resultText = "LOST";
            else resultText = "TIED";
        }

        let html = `<h4>Your Result: ${resultText}</h4>`;
        if (playerGame) {
            html += `<p>${playerGame.awayTeam.name} ${playerGame.awayScore} @ ${playerGame.homeTeam.name} ${playerGame.homeScore}</p>`;
        }
        html += '<h4 class="mt-4">All Results</h4><div class="space-y-1 text-sm mt-2">';
        results.forEach(r => {
            if (!r) return;
            const isPlayerGame = r.homeTeam.id === gameState.playerTeam.id || r.awayTeam.id === gameState.playerTeam.id;
            html += `<p class="${isPlayerGame ? 'font-bold text-amber-600' : ''}">${r.awayTeam.name} ${r.awayScore} @ ${r.homeTeam.name} ${r.homeScore}</p>`;
        });
        html += '</div>';
        return html;
    };

    if (results && results.length > 0) {
        UI.showModal(`Week ${gameState.currentWeek} Results`, buildResultsModalHtml(results));
    }

    gameState.teams.filter(t => t && t.id !== gameState.playerTeam.id).forEach(team => {
        try { Game.aiManageRoster(team); } catch (e) { }
    });
    Game.generateWeeklyFreeAgents();

    gameState = Game.getGameState();
    if (!gameState) return;

    UI.renderDashboard(gameState);
    const activeTabEl = document.querySelector('#dashboard-tabs .tab-button.active');
    const activeTab = activeTabEl ? activeTabEl.dataset.tab : 'my-team';
    UI.switchTab(activeTab, gameState);
    UI.showScreen('dashboard-screen');

    if (gameState.currentWeek >= WEEKS_IN_SEASON) { handleSeasonEnd(); return; }

    // 💡 NEW: Generate preview for the upcoming week
    generateWeeklyMatchupPreview();

    const roster = Game.getRosterObjects(gameState.playerTeam);
    const healthyCount = roster.filter(p => p && p.status?.duration === 0).length;
    if (healthyCount < MIN_HEALTHY_PLAYERS) {
        promptCallFriend();
    }
}

function handleSeasonEnd() {
    try {
        const report = Game.advanceToOffseason();
        gameState = Game.getGameState();
        UI.renderOffseasonScreen(report, gameState.year);
        UI.showScreen('offseason-screen');
    } catch (error) {
        console.error(error);
    }
}

function handleGoToNextDraft() {
    try {
        Game.setupDraft();
        gameState = Game.getGameState();
        selectedPlayerId = null;
        UI.renderSelectedPlayerCard(null, gameState);
        UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId, currentSortColumn, currentSortDirection);
        UI.showScreen('draft-screen');
        runAIDraftPicks();
    } catch (error) {
        console.error(error);
    }
}

function handleDashboardClicks(e) {
    const target = e.target;
    // Prevent triggering if a button (like set captain) was clicked
    if (target.tagName === 'BUTTON' || target.closest('button')) return;

    // Trigger on ANY player row inside the dashboard
    const playerRow = target.closest('tr[data-player-id]');
    if (playerRow && playerRow.dataset.playerId) {
        openPlayerCard(playerRow.dataset.playerId);
    }
}

// 💡 NEW: Rich, Tabbed Player Card
function openPlayerCard(playerId) {
    if (!gameState) return;

    let player = (typeof Game.getPlayer === 'function') ? Game.getPlayer(playerId) : gameState.players.find(p => p.id === playerId);
    if (!player) return;

    const team = gameState.teams.find(t => t.id === player.teamId);
    const teamName = team ? team.name : 'Free Agent';
    const isMyTeam = player.teamId === gameState.playerTeam.id;

    // Tab 1: Attributes & Overalls
    const positions = Object.keys(positionOverallWeights);
    let overallsHtml = '<div class="mt-2 grid grid-cols-2 gap-2 text-center">'; 
    positions.forEach(pos => {
        overallsHtml += `<div class="bg-gray-100 border border-gray-200 p-2 rounded"><p class="font-semibold text-[10px] text-gray-500 uppercase">${pos}</p><p class="font-bold text-lg text-gray-800">${Game.calculateOverall(player, pos)}</p></div>`;
    });
    overallsHtml += '</div>';

    // Tab 2: Season & Career Stats
    const s = player.seasonStats || {};
    const c = player.careerStats || {};
    const statsHtml = `
        <div class="grid grid-cols-2 gap-4 text-sm mt-2">
            <div class="bg-blue-50 p-3 rounded border border-blue-100">
                <h5 class="font-bold text-blue-800 border-b border-blue-200 mb-2 pb-1">Current Season</h5>
                <p>Pass: ${s.passYards || 0} yds, ${s.passCompletions || 0}/${s.passAttempts || 0}, ${s.interceptionsThrown || 0} INT</p>
                <p>Rush: ${s.rushYards || 0} yds, ${s.rushAttempts || 0} att</p>
                <p>Rec: ${s.recYards || 0} yds, ${s.receptions || 0} rec, ${s.drops || 0} drp</p>
                <p>Defense: ${s.tackles || 0} tkl, ${s.sacks || 0} sck, ${s.interceptions || 0} int</p>
                <p class="mt-1 font-bold text-amber-600">Total TDs: ${s.touchdowns || 0}</p>
            </div>
            <div class="bg-gray-50 p-3 rounded border border-gray-200">
                <h5 class="font-bold text-gray-800 border-b border-gray-300 mb-2 pb-1">Career</h5>
                <p>Seasons: ${c.seasonsPlayed || 0}</p>
                <p>Pass Yds: ${c.passYards || 0}</p>
                <p>Rush Yds: ${c.rushYards || 0}</p>
                <p>Rec Yds: ${c.recYards || 0}</p>
                <p>Tackles: ${c.tackles || 0}</p>
                <p class="mt-1 font-bold text-amber-600">Total TDs: ${c.touchdowns || 0}</p>
            </div>
        </div>
    `;

    // Build the Modal HTML
    const playerInfoHtml = `
        <div class="mb-4 pb-2 border-b border-gray-200">
            <p class="text-sm text-gray-500 font-bold uppercase tracking-wider">${teamName} • Age ${player.age} • ${player.potential} Potential</p>
            <p class="text-sm text-gray-700">H: ${formatHeight(player.attributes?.physical?.height)} | W: ${player.attributes?.physical?.weight} lbs</p>
        </div>
        
        <!-- CSS Tabs -->
        <div class="flex border-b border-gray-300 mb-4">
            <button class="player-tab-btn active px-4 py-2 font-bold text-amber-600 border-b-2 border-amber-600" data-target="tab-skills">Skills</button>
            <button class="player-tab-btn px-4 py-2 font-bold text-gray-500 hover:text-gray-700 border-b-2 border-transparent" data-target="tab-stats">Stats</button>
        </div>

        <div id="tab-skills" class="player-tab-content block animate-fadeIn">
            ${overallsHtml}
        </div>
        
        <div id="tab-stats" class="player-tab-content hidden animate-fadeIn">
            ${statsHtml}
        </div>

        ${isMyTeam ? `<button class="mt-6 w-full bg-red-500 text-white py-2 rounded hover:bg-red-600 font-bold transition shadow" onclick="app.cutPlayer('${player.id}')">Cut Player from Team</button>` : ''}
    `;

    UI.showModal(`${player.name} <span class="text-gray-400 text-lg">#${player.number || '--'}</span>`, playerInfoHtml, null, '', null, 'Close');

    // Attach Tab Event Listeners inside Modal
    setTimeout(() => {
        const modalBody = document.getElementById('modal-body');
        if (!modalBody) return;
        const tabs = modalBody.querySelectorAll('.player-tab-btn');
        const contents = modalBody.querySelectorAll('.player-tab-content');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.className = "player-tab-btn px-4 py-2 font-bold text-gray-500 hover:text-gray-700 border-b-2 border-transparent");
                tab.className = "player-tab-btn active px-4 py-2 font-bold text-amber-600 border-b-2 border-amber-600";

                contents.forEach(c => c.classList.add('hidden'));
                modalBody.querySelector(`#${tab.dataset.target}`).classList.remove('hidden');
            });
        });
    }, 10);
}

function handleStatsChange() {
    if (!gameState) return;
    UI.switchTab('player-stats', gameState);
}

function handleMessageClick(messageId) {
    if (!gameState || !gameState.messages) return;
    const message = gameState.messages.find(m => m && m.id === messageId);
    if (message) {
        UI.showModal(message.subject, `<p class="whitespace-pre-wrap">${message.body}</p>`);
        Game.markMessageAsRead(messageId);
        UI.renderMessagesTab(gameState);
        UI.updateMessagesNotification(gameState.messages);
    }
}

function buildCallFriendModalHtml(freeAgents) {
    let html = '<div class="mt-4 space-y-2">';
    if (!Array.isArray(freeAgents)) return '<p>Error.</p>';
    if (freeAgents.length === 0) return '<p>No friends available.</p>';

    freeAgents.forEach(p => {
        if (!p) return;
        const bestPos = Object.keys(positionOverallWeights).reduce((best, pos) => {
            const currentOvr = Game.calculateOverall(p, pos);
            return currentOvr > best.ovr ? { pos, ovr: currentOvr } : best;
        }, { pos: 'N/A', ovr: 0 });

        html += `
            <div class="flex items-center justify-between p-2 bg-gray-100 rounded">
                <div>
                    <p class="font-bold">${p.name}</p>
                    <p class="text-sm text-gray-600">${p.relationshipName} (Best: ${bestPos.pos} - ${bestPos.ovr})</p>
                </div>
                <button data-player-id="${p.id}" class="call-friend-btn bg-green-500 hover:bg-green-600 text-white px-3 py-1 text-xs rounded font-semibold transition">CALL</button>
            </div>
        `;
    });
    html += `</div>`;
    return html;
}

function promptCallFriend(onIgnore = null) {
    gameState = Game.getGameState();
    if (!gameState) return;

    const { freeAgents, playerTeam } = gameState;
    const rosterObjects = Game.getRosterObjects(playerTeam);
    const healthyCount = rosterObjects.filter(p => p && p.status?.duration === 0).length;

    if (!onIgnore && (healthyCount >= MIN_HEALTHY_PLAYERS || !Array.isArray(freeAgents) || freeAgents.length === 0)) return;

    const modalBodyIntro = `<p>Only ${healthyCount} healthy players! Call a friend?</p>`;

    const freeAgentsWithRel = (freeAgents || []).map(p => {
        if (!p) return null;
        const maxLevel = rosterObjects.reduce(
            (max, rp) => Math.max(max, Game.getRelationshipLevel(rp?.id, p.id)),
            relationshipLevels.STRANGER.level
        );
        const relInfo = Object.values(relationshipLevels).find(rl => rl.level === maxLevel) || relationshipLevels.STRANGER;
        return { ...p, relationshipName: relInfo.name };
    }).filter(Boolean);

    const friendListHtml = buildCallFriendModalHtml(freeAgentsWithRel);
    const cancelText = onIgnore ? "Proceed Shorthanded" : "Later";
    const onCancel = onIgnore || null;

    UI.showModal("Call a Friend?", modalBodyIntro + friendListHtml, null, '', onCancel, cancelText);

    const modalBodyElement = document.getElementById('modal-body');
    if (!modalBodyElement) return;

    const callButtonDelegationHandler = (e) => {
        if (e.target.matches('.call-friend-btn')) {
            const playerId = e.target.dataset.playerId;
            if (!playerId) return;

            const result = Game.callFriend(playerId);
            UI.hideModal();

            setTimeout(() => {
                UI.showModal("Call Result", `<p>${result.message}</p>`);
                gameState = Game.getGameState();
                if (gameState) UI.switchTab('my-team', gameState);
            }, 100);
        }
    };
    modalBodyElement.addEventListener('click', callButtonDelegationHandler, { once: true });
}

function handleSetCaptain(playerId) {
    if (!gameState) return;

    if (Game.setTeamCaptain(gameState.playerTeam, playerId)) {
        UI.switchTab('my-team', gameState);
        Game.saveGameState(activeSaveKey);
    }
}

// --- Public API ---
window.app = {
    startNewGame,
    handleLoadGame,
    openPlayerCard,
    handleLoadTestRoster,
    handleSaveTestRoster,
    handleConfirmTeam,
    handleDraftPlayer,
    onDraftSelect: handlePlayerSelectInDraft,
    setCaptain: handleSetCaptain,
    handleAdvanceWeek,
    // Note: Use getters for UI functions if they aren't defined yet at top level
    skipSim: () => UI.skipLiveGameSim(),
    setSpeed: (s) => UI.setSimSpeed(s),
    cutPlayer: (id) => {
        if (confirm("Cut this player?")) {
            Game.playerCut(id);
            // Safety check for UI
            if (typeof UI.hideModal === 'function') UI.hideModal();
            gameState = Game.getGameState();
            if (typeof UI.switchTab === 'function') UI.switchTab('my-team', gameState);
        }
    }
};

// =============================================================
// --- INITIALIZATION & EVENT LISTENERS ---
// =============================================================

function main() {
    console.log("Game starting... Document loaded.");
    try {
        UI.setupElements();

        // --- Load game state ---
        Game.loadGameState();
        gameState = Game.getGameState();

        // --- Setup Global Event Listeners ---
        document.getElementById('start-game-btn')?.addEventListener('click', startNewGame);
        document.getElementById('confirm-team-btn')?.addEventListener('click', handleConfirmTeam);
        document.getElementById('load-game-btn')?.addEventListener('click', handleLoadGame);
        document.getElementById('load-test-roster-btn')?.addEventListener('click', handleLoadTestRoster);
        document.getElementById('save-test-roster-btn')?.addEventListener('click', handleSaveTestRoster);
        document.getElementById('draft-player-btn')?.addEventListener('click', handleDraftPlayer);
        document.querySelectorAll('.draft-tab-btn').forEach(btn => {
            btn.onclick = () => {
                const tab = btn.dataset.draftTab;
                // Update button visuals
                document.querySelectorAll('.draft-tab-btn').forEach(b => {
                    b.classList.remove('active', 'bg-amber-600', 'text-white');
                    b.classList.add('text-gray-400');
                });
                btn.classList.add('active', 'bg-amber-600', 'text-white');
                btn.classList.remove('text-gray-400');

                // Switch content visibility
                document.querySelectorAll('.draft-tab-content').forEach(c => c.classList.add('hidden'));
                document.getElementById(`draft-tab-${tab}`).classList.remove('hidden');

                // Trigger specific renders
                if (tab === 'history') UI.renderPickHistory(gameState);
                if (tab === 'teams') UI.renderDraftTeamView(gameState);
            };
        });
        document.getElementById('advance-week-btn')?.addEventListener('click', handleAdvanceWeek);
        document.getElementById('go-to-next-draft-btn')?.addEventListener('click', handleGoToNextDraft);

        // Live Sim Controls
        document.getElementById('sim-speed-pause')?.addEventListener('click', () => UI.togglePause());
        document.getElementById('sim-skip-btn')?.addEventListener('click', () => {
            UI.skipLiveGameSim();
        });
        document.getElementById('sim-speed-play')?.addEventListener('click', () => UI.setSimSpeed(80));   // Normal
        document.getElementById('sim-speed-fast')?.addEventListener('click', () => UI.setSimSpeed(40));   // Fast
        document.getElementById('sim-speed-faster')?.addEventListener('click', () => UI.setSimSpeed(10)); // Max Speed

        // Dashboard Navigation
        document.getElementById('dashboard-tabs')?.addEventListener('click', handleTabSwitch);
        document.getElementById('dashboard-content')?.addEventListener('click', handleDashboardClicks);

        // Messages List
        document.getElementById('messages-list')?.addEventListener('click', (e) => {
            const messageItem = e.target.closest('.message-item');
            if (messageItem?.dataset.messageId) {
                handleMessageClick(messageItem.dataset.messageId);
            }
        });

        // Draft Filters/Sorting
        document.getElementById('draft-search')?.addEventListener('input', () => {
            if (gameState) UI.debouncedRenderDraftPool(gameState, handlePlayerSelectInDraft, currentSortColumn, currentSortDirection);
        });
        document.getElementById('draft-filter-pos')?.addEventListener('change', () => {
            if (gameState) UI.renderDraftPool(gameState, handlePlayerSelectInDraft, currentSortColumn, currentSortDirection);
        });
        document.querySelector('#draft-screen thead tr')?.addEventListener('click', (e) => {
            const headerCell = e.target.closest('th[data-sort]');
            if (!headerCell || !gameState) return;

            const newSortColumn = headerCell.dataset.sort;
            if (currentSortColumn === newSortColumn) {
                currentSortDirection = (currentSortDirection === 'desc') ? 'asc' : 'desc';
            } else {
                currentSortColumn = newSortColumn;
                currentSortDirection = 'desc';
            }

            UI.renderDraftPool(gameState, handlePlayerSelectInDraft, currentSortColumn, currentSortDirection);
            UI.updateDraftSortIndicators(currentSortColumn, currentSortDirection);
        });

        // Depth Chart Formation Changes
        document.getElementById('offense-formation-select')?.addEventListener('change', handleFormationChange);
        document.getElementById('defense-formation-select')?.addEventListener('change', handleFormationChange);

        // Player Stats Filters
        document.getElementById('stats-filter-team')?.addEventListener('change', handleStatsChange);
        document.getElementById('stats-sort')?.addEventListener('change', handleStatsChange);

        // Setup Complex UI Interactions
        UI.setupDragAndDrop(handleDepthChartDrop);
        UI.setupDepthChartTabs();

        // Listener for "Refresh UI" (fired by new Depth Order tab)
        document.addEventListener('refresh-ui', () => {
            gameState = Game.getGameState();
            Game.saveGameState(activeSaveKey);
            const activeTabEl = document.querySelector('.tab-button.active');
            if (activeTabEl) {
                const tabId = activeTabEl.dataset.tab;
                UI.switchTab(tabId, gameState);
            }
            console.log("Game state saved and UI refreshed.");
        });

        // Listener for "Depth Chart Changed" (fired by Formation Revert Fix)
        document.addEventListener('depth-chart-changed', (e) => {
            const { playerId, slot, side } = e.detail;
            handleDepthChartDrop(playerId, slot, side);
        });

        // Show the initial screen
        UI.showScreen('start-screen')

    } catch (error) {
        console.error("Fatal error during initialization:", error);
        const body = document.body;
        if (body) {
            body.innerHTML = `<div style="padding: 20px; color: #b91c1c; background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; font-family: sans-serif;">
                                 <h1 style="font-size: 1.5em; margin-bottom: 10px; color: #991b1b;">Initialization Error</h1>
                                 <p>We're sorry, but the game couldn't start due to an unexpected error.</p>
                                 <p>Please try refreshing the page. If the problem persists, check the browser console.</p>
                                 <pre style="margin-top: 15px; padding: 10px; background-color: #fee2e2; border-radius: 4px; font-size: 0.9em; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word;">${error.stack || error.message}</pre>
                               </div>`;
        }
    }
}

document.addEventListener('DOMContentLoaded', main);