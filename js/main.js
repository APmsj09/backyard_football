// js/main.js
import * as Game from './game.js';
import * as UI from './ui.js';
import { positionOverallWeights, estimateBestPosition, calculateOverall } from './game/player.js';
import { coachPersonalities, offenseFormations, defenseFormations } from './data.js';
import { formatHeight } from './utils.js';

let gameState = null;
let selectedPlayerId = null;
let currentSortColumn = 'potential';
let currentSortDirection = 'desc';
let activeSaveKey = 'backyardFootballGameState';
let isDraftingLocked = false;

const ROSTER_LIMIT = 18;
const MIN_HEALTHY_PLAYERS = 8;
const WEEKS_IN_SEASON = 9;

async function startNewGame() {
    activeSaveKey = 'backyardFootballGameState';
    try {
        UI.showScreen("loading-screen");
        UI.startLoadingMessages();
        await new Promise(resolve => setTimeout(resolve, 50));

        // Generate the 20 main teams + 6 youth teams
        await Game.initializeLeague((progress) => {
            UI.updateLoadingProgress(Math.round(progress * 30));
        });

        gameState = Game.getGameState();
        const loadingMsgEl = document.getElementById('loading-message');

        // Simulate 4 Seasons of pure history before player chooses a team (Complete 4-Year Youth Cycle)
        for (let y = 1; y <= 4; y++) {
            if (loadingMsgEl) loadingMsgEl.textContent = `Simulating Season ${y} Matches & Draft...`;
            UI.updateLoadingProgress(30 + (y * 17));
            await new Promise(resolve => setTimeout(resolve, 50));

            Game.simulateHistoricalSeason(y, gameState);
            Game.advanceToOffseason();
            Game.simulateHistoricalDraft(y);
        }

        UI.stopLoadingMessages();
        UI.updateLoadingProgress(100);

        renderTeamChooser(gameState);
    } catch (error) {
        console.error("Error starting game:", error);
        UI.stopLoadingMessages();
        UI.showModal("Error", `Could not start game: ${error.message}`);
    }
}

function renderTeamChooser(gameState) {
    const grid = document.getElementById('team-select-grid');
    if (!grid) return;

    let selectedFilter = 'all';

    const renderCards = () => {
        grid.innerHTML = '';
        const mainTeams = gameState.teams.filter(t => t.leagueType === 'main');
        const filtered = mainTeams.filter(t => {
            if (selectedFilter === '1') return t.tier === 1;
            if (selectedFilter === '2') return t.tier === 2;
            return true;
        });

        filtered.sort((a, b) => a.tier - b.tier);

        filtered.forEach(team => {
            const roster = Game.getRosterObjects(team);
            const topPlayers = [...roster]
                .sort((a, b) => Game.calculateOverall(b, estimateBestPosition(b)) - Game.calculateOverall(a, estimateBestPosition(a)))
                .slice(0, 3);

            // Count historical titles
            const titles = (gameState.history?.seasons || []).filter(s => s.champion === team.name).length;
            const t2Titles = (gameState.history?.seasons || []).filter(s => s.tier2Champion === team.name).length;

            const card = document.createElement('div');
            card.className = "bg-white border border-slate-300 rounded-sm p-4 flex flex-col justify-between shadow-sm hover:border-slate-800 transition";
            card.innerHTML = `
                <div>
                    <div class="flex justify-between items-start mb-2">
                        <div class="flex items-center gap-2">
                            <span class="w-4 h-4 rounded-full border border-slate-400" style="background-color: ${team.primaryColor}"></span>
                            <h3 class="font-black text-base uppercase tracking-wider text-slate-900">${team.name}</h3>
                        </div>
                        <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-sm uppercase tracking-wider ${team.tier === 1 ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}">
                            Tier ${team.tier}
                        </span>
                    </div>

                    <p class="text-xs text-slate-500 mb-2">Coach: <b>${team.coach?.name || 'Coach'}</b> (${team.coach?.type || 'Standard'})</p>
                    
                    <div class="text-[11px] bg-slate-50 p-2 rounded-sm border border-slate-100 mb-3 space-y-1 text-slate-700">
                        <p>Roster: <b>${roster.length} Players</b> | Street Cred: <b>${team.socialProfile?.streetCred || 50}</b></p>
                        ${titles > 0 ? `<p class="text-amber-600 font-bold">🏆 ${titles}x Premier Champion</p>` : ''}
                        ${t2Titles > 0 ? `<p class="text-blue-600 font-bold">🥇 ${t2Titles}x Sandlot Champion</p>` : ''}
                    </div>

                    <p class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Key Stars</p>
                    <div class="space-y-1 mb-4">
                        ${topPlayers.map(p => `
                            <div class="flex justify-between text-xs">
                                <span class="font-semibold text-slate-800 truncate">${p.name} (${estimateBestPosition(p)})</span>
                                <span class="font-black text-slate-900">${Game.calculateOverall(p, estimateBestPosition(p))} OVR</span>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <button class="select-franchise-btn w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-2 rounded-sm text-xs uppercase tracking-widest transition" data-team-id="${team.id}">
                    Take Over Franchise →
                </button>
            `;
            grid.appendChild(card);
        });

        grid.querySelectorAll('.select-franchise-btn').forEach(btn => {
            btn.onclick = () => promptCoachCreation(btn.dataset.teamId);
        });
    };

    document.getElementById('filter-tier-all').onclick = () => { selectedFilter = 'all'; renderCards(); };
    document.getElementById('filter-tier-1').onclick = () => { selectedFilter = '1'; renderCards(); };
    document.getElementById('filter-tier-2').onclick = () => { selectedFilter = '2'; renderCards(); };

    renderCards();
    UI.showScreen('team-select-screen');
}

function promptCoachCreation(teamId) {
    const team = gameState.teams.find(t => t.id === teamId);
    if (!team) return;

    let archetypeOptions = coachPersonalities.map(c => `<option value="${c.type}">${c.type}</option>`).join('');
    let offOptions = Object.keys(offenseFormations).filter(k => k !== 'Punt').map(k => `<option value="${k}">${offenseFormations[k].name}</option>`).join('');
    let defOptions = Object.keys(defenseFormations).filter(k => k !== 'Punt_Return').map(k => `<option value="${k}">${defenseFormations[k].name}</option>`).join('');

    const modalHtml = `
        <div class="space-y-4 text-left">
            <p class="text-sm text-slate-600">You are taking over <strong>${team.name}</strong>. Time to introduce yourself to the players.</p>
            
            <div>
                <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Coach Name</label>
                <input type="text" id="new-coach-name" class="w-full p-2 border border-slate-300 rounded outline-none focus:border-amber-500" placeholder="e.g. Coach Gordon" value="Coach">
            </div>

            <div>
                <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Coaching Style</label>
                <select id="new-coach-style" class="w-full p-2 border border-slate-300 rounded outline-none focus:border-amber-500">
                    ${archetypeOptions}
                </select>
                <p class="text-[10px] text-slate-500 mt-1">Affects which players want to join your team and how they develop.</p>
            </div>

            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Preferred Offense</label>
                    <select id="new-coach-offense" class="w-full p-2 border border-slate-300 rounded outline-none focus:border-amber-500">
                        ${offOptions}
                    </select>
                </div>

                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Preferred Defense</label>
                    <select id="new-coach-defense" class="w-full p-2 border border-slate-300 rounded outline-none focus:border-amber-500">
                        ${defOptions}
                    </select>
                </div>
            </div>
        </div>
    `;

    UI.showModal("Create Your Coach", modalHtml, () => {
        const name = document.getElementById('new-coach-name').value || 'Coach';
        const style = document.getElementById('new-coach-style').value;
        const off = document.getElementById('new-coach-offense').value;
        const def = document.getElementById('new-coach-defense').value;

        confirmFranchiseTakeover(teamId, { name, style, off, def });
    }, "Sign Contract");
}

function confirmFranchiseTakeover(teamId, coachDetails) {
    const team = gameState.teams.find(t => t.id === teamId);
    if (!team) return;

    team.isPlayerControlled = true;
    gameState.playerTeam = team;

    if (coachDetails) {
        let baseCoach = coachPersonalities.find(c => c.type === coachDetails.style) || coachPersonalities[0];
        const customCoach = JSON.parse(JSON.stringify(baseCoach));
        customCoach.name = coachDetails.name;
        customCoach.preferredOffense = coachDetails.off;
        customCoach.preferredDefense = coachDetails.def;
        team.coach = customCoach;
        team.formations.offense = coachDetails.off;
        team.formations.defense = coachDetails.def;
        Game.rebuildDepthChartFromOrder(team);
    }

    // Initialize Year 5 Draft for the human player
    Game.setupDraft();
    gameState.draftCompleted = false;

    generateDraftPreviewMessage();

    const advBtn = document.getElementById('advance-week-btn');
    if (advBtn) {
        advBtn.innerHTML = `<span>Start Draft</span>`;
        advBtn.classList.remove('bg-amber-500');
        advBtn.classList.add('bg-green-600');
    }

    UI.renderDashboard(gameState);
    UI.switchTab('messages', gameState);
    UI.showScreen('dashboard-screen');
}

function generateDraftPreviewMessage() {
    let historyBlurb = '';
    if (gameState && gameState.history && gameState.history.seasons.length > 0) {
        const lastSeason = gameState.history.seasons[gameState.history.seasons.length - 1];
        historyBlurb = `\n\n---\n**Recent Highlights (Year ${lastSeason.year})**\n🏆 Champion: ${lastSeason.champion}\n🥈 Runner-Up: ${lastSeason.runnerUp}\n📈 Promoted: ${lastSeason.promoted.join(', ')}\n📉 Relegated: ${lastSeason.relegated.join(', ')}`;
    }

    Game.addMessage("League Office", `Welcome to Backyard GM, Coach! After 4 years of building the franchise, you are now officially in control. Check your veteran roster, scout the incoming rookie class, and click "Start Draft" when you're ready to make your first pick.\n\n**Be sure to check the "History" tab on your dashboard to see the full record of past champions and draft picks before you arrived!**${historyBlurb}`, false, gameState);
}

function handlePlayerSelectInDraft(playerId) {
    if (!gameState) return;
    selectedPlayerId = playerId;
    const player = gameState.players.find(p => p.id === playerId);
    UI.updateSelectedPlayerRow(playerId);
    UI.renderSelectedPlayerCard(player, gameState);

    const draftBtn = document.getElementById('draft-player-btn');
    if (draftBtn && gameState.playerTeam) {
        const currentPickingTeam = gameState.draftOrder?.[gameState.currentPick];
        const isMyTurn = currentPickingTeam?.id === gameState.playerTeam.id;
        const hasRoom = (gameState.playerTeam.roster?.length || 0) < ROSTER_LIMIT;
        draftBtn.disabled = !(isMyTurn && hasRoom && player);
    }
}

function handleDraftPlayer() {
    if (!gameState || isDraftingLocked) return;
    if (selectedPlayerId) {
        const player = gameState.players.find(p => p.id === selectedPlayerId);
        const team = gameState.playerTeam;
        if (team.roster.length >= ROSTER_LIMIT) {
            UI.showModal("Roster Full", `<p>Your roster is full (${ROSTER_LIMIT} players).</p>`);
            return;
        }

        if (player && Game.addPlayerToTeam(player, team)) {
            player.lifecycle = 'active';
            const gs = Game.getGameState();
            if (gs.draftClass) {
                gs.draftClass = gs.draftClass.filter(p => p.id !== player.id);
            }
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
            gs.currentPick++;
            UI.renderSelectedPlayerCard(null, gs);
            UI.renderDraftScreen(gs, handlePlayerSelectInDraft, null, currentSortColumn, currentSortDirection);
            runAIDraftPicks();
        }
    }
}

async function runAIDraftPicks() {
    if (!gameState || isDraftingLocked) return;
    isDraftingLocked = true;

    try {
        while (true) {
            const pickLimitReached = gameState.currentPick >= gameState.draftOrder.length;
            const noPlayersLeft = gameState.players.filter(p => p && !p.teamId).length === 0;
            const allTeamsFull = gameState.teams.every(t => !t || !t.roster || t.roster.length >= ROSTER_LIMIT);

            if (pickLimitReached || noPlayersLeft || allTeamsFull) {
                await handleDraftEnd();
                break;
            }

            let currentPickingTeam = gameState.draftOrder[gameState.currentPick];

            if (currentPickingTeam && currentPickingTeam.id === gameState.playerTeam.id) {
                if (gameState.playerTeam.roster.length >= ROSTER_LIMIT) {
                    gameState.currentPick++;
                    UI.renderSelectedPlayerCard(null, gameState);
                    continue;
                } else {
                    UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId, currentSortColumn, currentSortDirection);
                    break;
                }
            }

            if (!currentPickingTeam || !currentPickingTeam.roster || currentPickingTeam.roster.length >= ROSTER_LIMIT) {
                gameState.currentPick++;
            } else {
                const picked = Game.simulateAIPick(currentPickingTeam);
                if (picked) {
                    if (!gameState.pickHistory) gameState.pickHistory = [];
                    gameState.pickHistory.push({
                        pick: gameState.currentPick + 1,
                        teamName: currentPickingTeam.name,
                        teamId: currentPickingTeam.id,
                        playerName: picked.name,
                        pos: estimateBestPosition(picked),
                        ovr: Game.calculateOverall(picked, estimateBestPosition(picked)),
                        potential: picked.potential
                    });
                }
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
    Game.completeDraft();
    Game.generateDraftSummary();
    Game.generateSchedule();
    Game.generateWeeklyFreeAgents();
    gameState = Game.getGameState();
    gameState.draftCompleted = true;

    for (const team of gameState.teams) {
        if (!team) continue;
        try { Game.aiSetDepthChart(team); } catch (error) { console.error(error); }
    }

    const advBtn = document.getElementById('advance-week-btn');
    if (advBtn) {
        advBtn.innerHTML = `<span>Play Week</span>`;
        advBtn.classList.add('bg-amber-500');
        advBtn.classList.remove('bg-green-600');
    }

    UI.renderDashboard(gameState);
    UI.switchTab('my-team', gameState);
    UI.showScreen('dashboard-screen');
}

async function handleLoadGame(saveKey) {
    try {
        const keyToLoad = typeof saveKey === 'string' ? saveKey : 'backyardFootballGameState';
        const loadedState = Game.loadGameState(keyToLoad);

        if (!loadedState || !loadedState.teams) {
            UI.showModal("Load Failed", "<p>No saved game data found.</p>");
            return;
        }

        gameState = loadedState;
        selectedPlayerId = null;
        activeSaveKey = keyToLoad;

        if (gameState.playerTeam) {
            Game.rebuildDepthChartFromOrder(gameState.playerTeam);
        }

        UI.renderDashboard(gameState);
        UI.switchTab('my-team', gameState);
        UI.showScreen('dashboard-screen');
    } catch (error) {
        console.error("Load Error:", error);
    }
}

function handleLoadTestRoster() {
    handleLoadGame('my_test_roster');
}

function handleSaveTestRoster() {
    if (!gameState) return;
    Game.saveGameState('my_test_roster');
    activeSaveKey = 'my_test_roster';
    UI.showModal("Saved", "<p>Game saved as 'Test Roster'.</p>");
}

function handleTabSwitch(e) {
    const button = e.target.closest('.tab-button');
    if (button) {
        const tabId = button.dataset.tab;
        gameState = Game.getGameState();
        if (gameState) {
            UI.switchTab(tabId, gameState);
            if (tabId === 'social') renderSocialNetworkTab(gameState); // Render our new tab!
        }
    }
}

function handleFormationChange(e) {
    if (!gameState) return;
    const side = e.target.id.includes('offense') ? 'offense' : 'defense';
    Game.changeFormation(side, e.target.value);
    Game.saveGameState(activeSaveKey);
    document.dispatchEvent(new CustomEvent('refresh-ui'));
}

async function handleAdvanceWeek() {
    if (!gameState) return;

    // 1. Initial Draft (Year 1/Year 4 pre-season)
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

    // 2. THIS WAS MISSING: Advance to Offseason when Week 9 ends!
    if (gameState.currentWeek >= WEEKS_IN_SEASON) {
        const report = Game.advanceToOffseason();
        gameState = Game.getGameState();
        Game.saveGameState(activeSaveKey);
        UI.renderOffseasonScreen(report, gameState.year);
        UI.showScreen('offseason-screen');
        return;
    }

    // 3. Regular Season game handling
    const playerTeamId = gameState.playerTeam.id;
    const gamesPerWeek = gameState.teams.length / 2;
    const weekGames = gameState.schedule.slice(gameState.currentWeek * gamesPerWeek, (gameState.currentWeek + 1) * gamesPerWeek);
    const playerGameMatch = weekGames.find(g => g.home.id === playerTeamId || g.away.id === playerTeamId);

    if (playerGameMatch) {
        const isHome = playerGameMatch.home.id === playerTeamId;
        const opponentName = isHome ? playerGameMatch.away.name : playerGameMatch.home.name;

        UI.showModal(
            `Game Day: Week ${gameState.currentWeek + 1}`,
            `<p class="mb-4">Your team is playing <strong>${opponentName}</strong>.</p><p>How do you want to play?</p>`,
            () => startLiveGame(playerGameMatch), "Watch Game",
            () => simulateRestOfWeek(), "Quick Sim"
        );
    } else {
        simulateRestOfWeek();
    }
}

function simulateRestOfWeek() {
    if (!gameState) return;
    if (gameState.currentWeek >= WEEKS_IN_SEASON) {
        handleAdvanceWeek();
        return;
    }
    const results = Game.simulateWeek({ fastSim: true });
    finishWeekSimulation(results || []);
}

function finishWeekSimulation(results) {
    Game.processEndOfWeek();
    gameState.currentWeek++;
    Game.saveGameState(activeSaveKey);

    if (results && results.length > 0) {
        UI.showModal(`Week ${gameState.currentWeek} Summary`, buildResultsModalHtml(results));
    }

    // Keep the player on the dashboard to review final standings
    if (gameState.currentWeek < WEEKS_IN_SEASON) {
        Game.generateWeeklyFreeAgents();
    }

    gameState = Game.getGameState();
    UI.renderDashboard(gameState);
    UI.showScreen('dashboard-screen');
}



async function startLiveGame(playerGameMatch) {
    if (!gameState) return;

    // Simulate CPU games for this week
    const gamesPerWeek = gameState.teams.length / 2;
    const allGames = gameState.schedule.slice(gameState.currentWeek * gamesPerWeek, (gameState.currentWeek + 1) * gamesPerWeek);
    const otherResults = [];

    for (const match of allGames) {
        if (match.home.id === playerGameMatch.home.id && match.away.id === playerGameMatch.away.id) continue;
        const result = Game.simulateMatchFast(match.home, match.away);
        if (result) otherResults.push(result);
    }

    Game.resetGameStats(playerGameMatch.home, playerGameMatch.away);

    const liveGameParams = {
        homeTeam: playerGameMatch.home,
        awayTeam: playerGameMatch.away,
        autoSubThreshold: gameState.playerTeam?.autoSubThreshold ?? 65,
        homeScore: 0, awayScore: 0,
        possession: Math.random() < 0.5 ? playerGameMatch.home : playerGameMatch.away,
        ballOn: 35, down: 1, yardsToGo: 10,
        gameLog: [`Coin Toss! ${playerGameMatch.home.name} vs ${playerGameMatch.away.name}`],
        isConversionAttempt: false, isGameOver: false, weather: 'Sunny', quarter: 1, clock: 420
    };

    UI.showScreen('game-sim-screen');
    UI.startLiveGameLoop(liveGameParams, (finalResult) => {
        Game.finalizeGameResults(finalResult.homeTeam, finalResult.awayTeam, finalResult.homeScore, finalResult.awayScore);
        const combined = [...otherResults, finalResult];
        finishWeekSimulation(combined);
    });
}

function buildResultsModalHtml(results) {
    if (!gameState?.playerTeam || !Array.isArray(results)) return "<p>Week completed.</p>";
    const playerGame = results.find(r => r && (r.homeTeam?.id === gameState.playerTeam.id || r.awayTeam?.id === gameState.playerTeam.id));
    let resultText = 'BYE';
    if (playerGame) {
        const myScore = playerGame.homeTeam.id === gameState.playerTeam.id ? playerGame.homeScore : playerGame.awayScore;
        const oppScore = playerGame.homeTeam.id === gameState.playerTeam.id ? playerGame.awayScore : playerGame.homeScore;
        if (myScore > oppScore) resultText = "VICTORY!";
        else if (myScore < oppScore) resultText = "DEFEAT";
        else resultText = "TIE";
    }

    let html = `<h4 class="text-base font-bold text-amber-600 mb-2">Outcome: ${resultText}</h4>`;
    if (playerGame) {
        html += `<p class="font-bold text-lg mb-3 p-2 bg-amber-50 rounded border border-amber-200">${playerGame.awayTeam.name} ${playerGame.awayScore} @ ${playerGame.homeTeam.name} ${playerGame.homeScore}</p>`;
    }
    html += '<h5 class="font-bold text-sm text-gray-700 border-t pt-2 mt-2">League Scores:</h5><div class="space-y-1 text-xs mt-1 max-h-48 overflow-y-auto">';
    results.forEach(r => {
        if (!r) return;
        const isPlayerGame = r.homeTeam.id === gameState.playerTeam.id || r.awayTeam.id === gameState.playerTeam.id;
        html += `<p class="${isPlayerGame ? 'font-bold text-amber-600' : 'text-gray-700'}">${r.awayTeam.name} ${r.awayScore} @ ${r.homeTeam.name} ${r.homeScore}</p>`;
    });
    html += '</div>';
    return html;
}

function openPlayerCard(playerId) {
    if (!gameState) return;
    const player = Game.getPlayer(playerId) || gameState.players.find(p => p.id === playerId);
    if (!player) return;

    const team = gameState.teams.find(t => t.id === player.teamId);
    const teamName = team ? team.name : 'Free Agent';
    const tierLabel = team ? (team.leagueType === 'youth' ? 'Pee-Wee' : `Tier ${team.tier}`) : 'FA';
    const isMyTeam = player.teamId === gameState.playerTeam?.id;

    const bestPos = estimateBestPosition(player);
    const ovr = calculateOverall(player, bestPos);

    const positions = Object.keys(positionOverallWeights);
    let overallsHtml = '<div class="grid grid-cols-4 gap-2 text-center mt-4">';
    positions.forEach(pos => {
        const isBest = pos === bestPos;
        overallsHtml += `<div class="${isBest ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-800'} p-2 rounded-sm border border-slate-300"><p class="text-[10px] font-bold uppercase tracking-widest opacity-80">${pos}</p><p class="font-black text-lg">${calculateOverall(player, pos)}</p></div>`;
    });
    overallsHtml += '</div>';

    const s = player.seasonStats || {};
    const c = player.careerStats || {};

    let progHtml = '<p class="text-xs text-slate-500 italic mt-2">No history available.</p>';
    if (player.progression && player.progression.length > 0) {
        progHtml = `
            <table class="w-full text-left text-[11px] mt-2">
                <thead class="bg-slate-100 text-slate-600 uppercase tracking-wider">
                    <tr>
                        <th class="p-1.5 border-b">Year</th>
                        <th class="p-1.5 border-b">Age</th>
                        <th class="p-1.5 border-b">Team</th>
                        <th class="p-1.5 border-b text-center">OVR</th>
                        <th class="p-1.5 border-b text-right">Stats</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                    ${player.progression.map(p => {
            const st = p.stats || {};
            let line = [];
            if (st.passYards > 0) line.push(`${st.passYards} Pass`);
            if (st.rushYards > 0) line.push(`${st.rushYards} Rush`);
            if (st.recYards > 0) line.push(`${st.recYards} Rec`);
            if (st.touchdowns > 0) line.push(`${st.touchdowns} TD`);
            if (st.tackles > 0) line.push(`${st.tackles} Tkl`);
            const statText = line.length > 0 ? line.slice(0, 2).join(', ') : '-';

            return `<tr>
                            <td class="p-1.5 font-mono">Y${p.year}</td>
                            <td class="p-1.5">${p.age}</td>
                            <td class="p-1.5 truncate max-w-[100px] font-medium">${p.teamName}</td>
                            <td class="p-1.5 text-center font-black text-slate-900">${p.ovr}</td>
                            <td class="p-1.5 text-right font-mono text-[10px] text-slate-600">${statText}</td>
                        </tr>`;
        }).join('')}
                </tbody>
            </table>`;
    }

    let modalHtml = `
        <div class="flex flex-col md:flex-row gap-6">
            <!-- Left Column -->
            <div class="md:w-1/2 flex flex-col">
                <div class="bg-slate-50 p-4 border border-slate-200 rounded-sm mb-4">
                    <div class="flex justify-between items-start mb-2">
                        <div>
                            <h3 class="text-xl font-black text-slate-900 uppercase tracking-wide">${player.name}</h3>
                            <p class="text-sm font-bold text-emerald-700">${teamName} <span class="text-slate-500 font-normal">(${tierLabel})</span></p>
                        </div>
                        <div class="text-right bg-slate-800 text-white px-3 py-1 rounded-sm">
                            <span class="text-[10px] uppercase tracking-widest block opacity-70">${bestPos} OVR</span>
                            <span class="text-2xl font-black">${ovr}</span>
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-slate-700 mt-4">
                        <p><span class="text-slate-500 uppercase font-bold text-[10px] tracking-wider block">Archetype</span> ${player.archetypeName || 'Unknown'}</p>
                        <p><span class="text-slate-500 uppercase font-bold text-[10px] tracking-wider block">Potential</span> <span class="font-bold text-slate-900">${player.potential}</span></p>
                        <p><span class="text-slate-500 uppercase font-bold text-[10px] tracking-wider block">Age</span> ${player.age} yrs</p>
                        <p><span class="text-slate-500 uppercase font-bold text-[10px] tracking-wider block">Vitals</span> ${formatHeight(player.attributes?.physical?.height)} / ${player.attributes?.physical?.weight} lbs</p>
                        <p><span class="text-slate-500 uppercase font-bold text-[10px] tracking-wider block">Work Ethic</span> ${player.personality?.workEthic || 50}</p>
                        <p><span class="text-slate-500 uppercase font-bold text-[10px] tracking-wider block">Dependability</span> ${player.personality?.dependability || 50}</p>
                    </div>

                    ${player.bio ? `
                    <div class="mt-3 p-2.5 bg-amber-50/70 border border-amber-200/80 rounded text-xs text-slate-800 leading-relaxed italic">
                        <span class="font-bold uppercase tracking-wider text-[9px] text-amber-800 not-italic block mb-0.5">Scouting Lore & Reputation</span>
                        "${player.bio}"
                    </div>` : ''}
                </div>
                
                <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Positional Ratings</h4>
                ${overallsHtml}
            </div>

            <!-- Right Column -->
            <div class="md:w-1/2 flex flex-col">
                <div class="bg-white border border-slate-200 rounded-sm p-4 mb-4 shadow-sm">
                    <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 border-b pb-1">Current Season Stats</h4>
                    <div class="grid grid-cols-2 gap-3 text-xs text-slate-800">
                        <p><span class="text-slate-500">Passing:</span> <br><b>${s.passYards || 0}</b> yds, <b>${s.passCompletions || 0}</b>/<b>${s.passAttempts || 0}</b></p>
                        <p><span class="text-slate-500">Rushing:</span> <br><b>${s.rushYards || 0}</b> yds, <b>${s.rushAttempts || 0}</b> att</p>
                        <p><span class="text-slate-500">Receiving:</span> <br><b>${s.recYards || 0}</b> yds, <b>${s.receptions || 0}</b> rec</p>
                        <p><span class="text-slate-500">Defense:</span> <br><b>${s.tackles || 0}</b> tkl, <b>${s.sacks || 0}</b> sck</p>
                        <p class="col-span-2 pt-2 border-t border-slate-100"><span class="text-slate-500">Touchdowns:</span> <span class="font-black text-slate-900">${s.touchdowns || 0}</span></p>
                    </div>
                </div>

                <div class="bg-white border border-slate-200 rounded-sm p-4 shadow-sm mb-4">
                    <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 border-b pb-1">Social Connections</h4>
                    <div class="text-xs text-slate-800 space-y-1">
                        <p><span class="font-bold text-slate-500">Clique:</span> <span class="font-bold text-indigo-600">${player.personality?.clique || 'None'}</span></p>
                        <p><span class="font-bold text-slate-500">Best Friend:</span> ${player.social?.bestFriendId ? (Game.getPlayer(player.social.bestFriendId)?.name || 'Unknown') : 'None'}</p>
                        <p><span class="font-bold text-slate-500">Good Friends:</span> ${player.social?.goodFriendIds?.length > 0 ? player.social.goodFriendIds.map(id => Game.getPlayer(id)?.name?.split(' ')[0] || 'Unknown').join(', ') : 'None'}</p>
                        <p><span class="font-bold text-slate-500">Rivals:</span> <span class="text-rose-600 font-semibold">${player.social?.rivalIds?.length > 0 ? player.social.rivalIds.map(id => Game.getPlayer(id)?.name?.split(' ')[0] || 'Unknown').join(', ') : 'None'}</span></p>
                    </div>
                </div>

                <div class="bg-white border border-slate-200 rounded-sm p-4 flex-grow overflow-y-auto shadow-sm">
                    <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Progression History</h4>
                    ${progHtml}
                    ${player.playerHistory?.teamsPlayedFor?.length > 0 ? `
                        <div class="mt-4 border-t pt-2 text-[10px] text-slate-500">
                            <span class="font-bold uppercase tracking-wider block mb-1">Past Teams</span>
                            ${player.playerHistory.teamsPlayedFor.map(t => `${t.teamName} (Yr ${t.year})`).join(' • ')}
                        </div>
                    ` : ''}
                </div>
            </div>
        </div>

        ${isMyTeam ? `
            <div class="mt-4 pt-4 border-t border-slate-200 flex justify-end">
                <button class="bg-rose-700 hover:bg-rose-800 text-white px-4 py-2 rounded-sm font-bold text-xs transition shadow-sm uppercase tracking-wider" onclick="app.cutPlayer('${player.id}')">Release Player</button>
            </div>
        ` : (!player.teamId ? `
            <div class="mt-4 pt-4 border-t border-slate-200 bg-slate-50 p-3 rounded">
                <h5 class="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">Offer Contract & Role Pitch</h5>
                <div class="grid grid-cols-3 gap-2 text-xs mb-3">
                    <div>
                        <label class="block text-[10px] text-slate-500 font-bold uppercase">Role Promised</label>
                        <select id="pitch-role" class="w-full p-1 border rounded bg-white font-bold text-slate-800">
                            <option value="STARTER">Starter</option>
                            <option value="ROTATION" selected>Rotation</option>
                            <option value="BENCH">Reserve</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-[10px] text-slate-500 font-bold uppercase">Touches Promised</label>
                        <select id="pitch-touches" class="w-full p-1 border rounded bg-white font-bold text-slate-800">
                            <option value="NORMAL">Standard</option>
                            <option value="FEATURED">Focal Option</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-[10px] text-slate-500 font-bold uppercase">Favor Tokens</label>
                        <select id="pitch-tokens" class="w-full p-1 border rounded bg-white font-bold text-slate-800">
                            <option value="0">0 Tokens</option>
                            <option value="1">1 Token</option>
                            <option value="2">2 Tokens</option>
                        </select>
                    </div>
                </div>
                <button class="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-bold py-2 rounded text-xs uppercase tracking-wider" onclick="app.negotiatePlayer('${player.id}')">
                    Submit Contract Pitch
                </button>
            </div>
        ` : '')}
    `;

    UI.showModal('Scouting Report', modalHtml);
}

function handleSetCaptain(playerId) {
    if (!gameState) return;
    if (Game.setTeamCaptain(gameState.playerTeam, playerId)) {
        UI.switchTab('my-team', gameState);
        Game.saveGameState(activeSaveKey);
    }
}

// Make sure going to the next draft resets draftCompleted:
function handleGoToNextDraft() {
    gameState = Game.getGameState();
    if (!gameState) return;
    gameState.draftCompleted = false;
    Game.setupDraft();
    selectedPlayerId = null;
    UI.renderSelectedPlayerCard(null, gameState);
    UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId, currentSortColumn, currentSortDirection);
    UI.showScreen('draft-screen');
    runAIDraftPicks();
}

function renderSocialNetworkTab(gameState) {
    const container = document.getElementById('social-network-container');
    if (!container || !gameState.playerTeam) return;

    const roster = Game.getUIRosterObjects(gameState.playerTeam);
    const cliquesMap = {};
    let totalChem = 0;
    
    roster.forEach(p => {
        const clique = p.personality?.clique || 'Unknown';
        if (!cliquesMap[clique]) cliquesMap[clique] = [];
        cliquesMap[clique].push(p);
        
        let localChem = (p.personality?.likeability || 50) + (p.expectations?.happiness || 100);
        
        // Boost for having best friend on team
        if (p.social?.bestFriendId && roster.some(r => r.id === p.social.bestFriendId)) localChem += 20;
        // Penalty for rival on team
        if (p.social?.rivalIds?.some(id => roster.some(r => r.id === id))) localChem -= 30;

        totalChem += localChem;
    });

    const avgChem = roster.length > 0 ? Math.min(100, Math.round(totalChem / (roster.length * 2))) : 50;
    const chemColor = avgChem >= 80 ? 'text-emerald-600' : (avgChem >= 50 ? 'text-amber-600' : 'text-rose-600');

    let html = `
        <div class="bg-white p-4 rounded-sm border border-slate-300 shadow-sm mb-6 flex justify-between items-center">
            <div>
                <h4 class="font-black text-lg uppercase tracking-wider text-slate-800">Overall Chemistry</h4>
                <p class="text-xs text-slate-500">Dictated by happiness, friends, and cliques.</p>
            </div>
            <div class="text-4xl font-black ${chemColor}">${avgChem}%</div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    `;

    Object.entries(cliquesMap).sort((a,b) => b[1].length - a[1].length).forEach(([clique, members]) => {
        html += `
            <div class="bg-white p-3 rounded-sm border border-slate-200 shadow-sm">
                <h5 class="font-bold text-slate-700 uppercase tracking-wider text-xs border-b pb-1 mb-2">${clique} (${members.length})</h5>
                <div class="space-y-2">
                    ${members.map(p => {
                        const egoColor = p.personality?.ego > 75 ? 'text-rose-600' : 'text-slate-500';
                        const bestFriend = roster.find(r => r.id === p.social?.bestFriendId);
                        const bfBadge = bestFriend ? `<span class="bg-amber-100 text-amber-800 px-1 py-0.5 text-[9px] rounded font-bold ml-1">🤝 BFF: ${bestFriend.name.split(' ')[0]}</span>` : '';
                        
                        return `
                        <div class="flex justify-between items-center text-xs bg-slate-50 p-1.5 rounded cursor-pointer hover:bg-slate-100" onclick="app.openPlayerCard('${p.id}')">
                            <span class="font-semibold text-slate-800">${p.name} ${bfBadge}</span>
                            <span class="font-mono text-[9px] ${egoColor}">EGO: ${p.personality?.ego || 50}</span>
                        </div>`;
                    }).join('')}
                </div>
            </div>
        `;
    });
    
    html += `</div>`;
    container.innerHTML = html;
}

window.app = {
    startNewGame,
    handleLoadGame,
    handleLoadTestRoster,
    negotiatePlayer: (id) => {
        const role = document.getElementById('pitch-role')?.value || 'ROTATION';
        const promiseTouches = document.getElementById('pitch-touches')?.value || 'NORMAL';
        const tokensOffered = parseInt(document.getElementById('pitch-tokens')?.value || '0', 10);

        const res = Game.playerSignFreeAgent(id, { role, promiseTouches, tokensOffered });
        UI.hideModal();
        alert(res.message);
        document.dispatchEvent(new CustomEvent('refresh-ui'));
    },
    handleSaveTestRoster,
    openPlayerCard,
    // handleConfirmTeam,
    handleDraftPlayer,
    onDraftSelect: handlePlayerSelectInDraft,
    setCaptain: handleSetCaptain,
    handleAdvanceWeek,
    handleGoToNextDraft,
    skipSim: () => UI.skipLiveGameSim(),
    setSpeed: (s) => UI.setSimSpeed(s),
    cutPlayer: (id) => {
        if (confirm("Cut this player?")) {
            Game.playerCut(id);
            UI.hideModal();
            gameState = Game.getGameState();
            UI.switchTab('my-team', gameState);
        }
    }
};

window.app_toggleWatchlist = (id) => UI.toggleWatchlistPlayer(id);

function main() {
    UI.setupElements();
    Game.loadGameState();
    gameState = Game.getGameState();

    // Dynamically inject the Social Network Tab
    const dashTabs = document.getElementById('dashboard-tabs');
    if (dashTabs && !document.querySelector('[data-tab="social"]')) {
        const socialBtn = document.createElement('button');
        socialBtn.className = 'tab-button whitespace-nowrap';
        socialBtn.dataset.tab = 'social';
        socialBtn.innerHTML = '<span class="text-base mr-1">💬</span> Social';
        dashTabs.appendChild(socialBtn);

        const dashContent = document.getElementById('dashboard-content');
        const socialPane = document.createElement('div');
        socialPane.id = 'tab-content-social';
        socialPane.className = 'tab-pane hidden flex flex-col h-full min-h-0 overflow-y-auto bg-slate-100';
        socialPane.innerHTML = `
            <div class="p-4 border-b bg-white shrink-0 sticky top-0 z-10 shadow-sm">
                <h3 class="text-xl font-bold text-slate-800 uppercase tracking-wider">Locker Room Network</h3>
                <p class="text-xs text-slate-500">Manage chemistry, cliques, and morale.</p>
            </div>
            <div id="social-network-container" class="p-4 flex-grow min-h-0 pb-12"></div>
        `;
        dashContent.appendChild(socialPane);
    }

    document.getElementById('start-game-btn')?.addEventListener('click', startNewGame);
    document.getElementById('load-game-btn')?.addEventListener('click', () => handleLoadGame());
    document.getElementById('load-test-roster-btn')?.addEventListener('click', handleLoadTestRoster);
    document.getElementById('save-test-roster-btn')?.addEventListener('click', handleSaveTestRoster);
    document.getElementById('draft-player-btn')?.addEventListener('click', handleDraftPlayer);
    document.getElementById('advance-week-btn')?.addEventListener('click', handleAdvanceWeek);
    document.getElementById('dashboard-tabs')?.addEventListener('click', handleTabSwitch);
    document.getElementById('go-to-next-draft-btn')?.addEventListener('click', handleGoToNextDraft);

    // Live Sim Speed Controls
    document.getElementById('sim-speed-pause')?.addEventListener('click', () => UI.togglePause());
    document.getElementById('sim-skip-btn')?.addEventListener('click', () => UI.skipLiveGameSim());
    document.getElementById('sim-debug-dump-btn')?.addEventListener('click', () => {
        const report = Game.generatePlayDebugReport();
        const modalHtml = `
            <div class="flex flex-col gap-3">
                <div class="flex justify-between items-center text-xs text-slate-500">
                    <span>Recent play decisions, progression reads, and physics rolls.</span>
                    <button id="copy-telemetry-btn" class="bg-slate-900 hover:bg-slate-800 text-amber-400 border border-slate-700 font-mono px-3 py-1.5 rounded transition shadow-sm font-bold text-xs">
                        📋 Copy to Clipboard
                    </button>
                </div>
                <pre class="bg-slate-950 text-emerald-400 p-4 rounded text-[11px] font-mono overflow-auto max-h-[60vh] select-all whitespace-pre-wrap leading-relaxed border border-slate-800 shadow-inner">${report}</pre>
            </div>
        `;
        UI.showModal("Play Telemetry & AI Debug", modalHtml);

        document.getElementById('copy-telemetry-btn')?.addEventListener('click', (e) => {
            navigator.clipboard.writeText(report).then(() => {
                e.target.textContent = '✅ Copied!';
                setTimeout(() => { e.target.textContent = '📋 Copy to Clipboard'; }, 2000);
            });
        });
    });
    document.getElementById('sim-speed-play')?.addEventListener('click', () => UI.setSimSpeed(80));
    document.getElementById('sim-speed-fast')?.addEventListener('click', () => UI.setSimSpeed(40));
    document.getElementById('sim-speed-faster')?.addEventListener('click', () => UI.setSimSpeed(10));

    // Formation Selectors in Depth Chart
    document.getElementById('offense-formation-select')?.addEventListener('change', handleFormationChange);
    document.getElementById('defense-formation-select')?.addEventListener('change', handleFormationChange);

    // Draft Screen Tabs
    document.querySelectorAll('.draft-tab-btn').forEach(btn => {
        btn.onclick = () => {
            const tab = btn.dataset.draftTab;
            document.querySelectorAll('.draft-tab-btn').forEach(b => {
                b.classList.remove('active', 'bg-amber-600', 'text-white');
                b.classList.add('text-gray-400');
            });
            btn.classList.add('active', 'bg-amber-600', 'text-white');
            btn.classList.remove('text-gray-400');

            document.querySelectorAll('.draft-tab-content').forEach(c => c.classList.add('hidden'));
            const targetTab = document.getElementById(`draft-tab-${tab}`);
            if (targetTab) targetTab.classList.remove('hidden');

            if (tab === 'history') UI.renderPickHistory(gameState);
            if (tab === 'teams') UI.renderDraftTeamView(gameState);
        };
    });

    // Draft Search and Filtering
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

    // Draft Sub-View Tabs (Overview, Physicals, Skills, Watchlist)
    document.querySelectorAll('.draft-view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            UI.setDraftView(btn.dataset.view);
            if (gameState) UI.renderDraftPool(gameState, handlePlayerSelectInDraft, currentSortColumn, currentSortDirection);
        });
    });

    // Delegate header clicks to the dynamic thead
    document.getElementById('draft-pool-thead')?.addEventListener('click', (e) => {
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

    // Stats Filters & Sorters
    document.getElementById('stats-filter-team')?.addEventListener('change', () => {
        if (gameState) UI.switchTab('player-stats', gameState);
    });
    document.getElementById('stats-filter-league')?.addEventListener('change', () => {
        if (gameState) UI.switchTab('player-stats', gameState);
    });
    document.getElementById('stats-sort')?.addEventListener('change', () => {
        if (gameState) UI.switchTab('player-stats', gameState);
    });

    // Inbox Messages
    document.getElementById('messages-list')?.addEventListener('click', (e) => {
        const messageItem = e.target.closest('.message-item');
        if (messageItem?.dataset.messageId && gameState?.messages) {
            const message = gameState.messages.find(m => m && m.id === messageItem.dataset.messageId);
            if (message) {
                UI.showModal(message.subject, `<p class="whitespace-pre-wrap">${message.body}</p>`);
                Game.markMessageAsRead(message.id);
                UI.renderMessagesTab(gameState);
                UI.updateMessagesNotification(gameState.messages);
            }
        }
    });

    // Player row click delegation in dashboard
    document.getElementById('dashboard-content')?.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
        const playerRow = e.target.closest('tr[data-player-id]');
        if (playerRow?.dataset.playerId) {
            openPlayerCard(playerRow.dataset.playerId);
        }
    });

    document.addEventListener('refresh-ui', () => {
        gameState = Game.getGameState();
        const activeTab = document.querySelector('.tab-button.active')?.dataset.tab || 'my-team';
        UI.switchTab(activeTab, gameState);
    });

    UI.showScreen('start-screen');
}

document.addEventListener('DOMContentLoaded', main);
