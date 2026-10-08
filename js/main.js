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
            <p class="text-sm text-slate-600">You are taking over <strong>${team.name}</strong> as General Manager. Set your front-office identity.</p>
            
            <div>
                <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">General Manager Name (You)</label>
                <input type="text" id="new-coach-name" class="w-full p-2 border border-slate-300 rounded outline-none focus:border-amber-500" placeholder="e.g. GM Gordon" value="GM">
            </div>

            <div>
                <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Management Philosophy</label>
                <select id="new-coach-style" class="w-full p-2 border border-slate-300 rounded outline-none focus:border-amber-500">
                    ${archetypeOptions}
                </select>
                <p class="text-[10px] text-slate-500 mt-1">Sets your front-office philosophy and organizational reputation.</p>
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

    UI.showModal("General Manager Profile", modalHtml, () => {
        const name = document.getElementById('new-coach-name').value || 'GM';
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
        team.formations.offense = coachDetails.off;
        team.formations.defense = coachDetails.def;

        // SYNC USER TO GENERAL MANAGER (YOU)
        if (!team.staff) Game.initializeTeamStaff(team);
        if (team.staff.gm) {
            team.staff.gm.name = coachDetails.name;
            team.staff.gm.biases.personality = { name: coachDetails.style, desc: `Prefers ${coachDetails.style} management style.` };
            team.staff.gm.biases.tactical = { name: coachDetails.off, desc: `Favors ${coachDetails.off} concepts.` };
        }

        // Keep the team's existing head coach intact; do NOT overwrite with user's name
        if (team.staff.coach) {
            team.coach = team.staff.coach;
        }

        Game.rebuildDepthChartFromOrder(team);
    }

    // Initialize Year 5 Draft for the human player and wipe any historical stats for the new season
    gameState.players.forEach(p => {
        p.seasonStats = { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0, sacks: 0, interceptions: 0, passAttempts: 0, passCompletions: 0, interceptionsThrown: 0 };
    });
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

    // Launch the Post-Draft Free Agency Mini-Game!
    UI.startOffseasonFAMinigame(gameState);
}

function finishOffseasonFAMinigame() {
    for (const team of gameState.teams) {
        if (!team) continue;
        if (!team.isPlayerControlled) {
            Game.autoFillTeamWalkOns(team, 14);
        }
        try { Game.aiSetDepthChart(team); } catch (error) { console.error(error); }
    }

    const advBtn = document.getElementById('advance-week-btn');
    if (advBtn) {
        advBtn.innerHTML = `<span>Play Week 1</span>`;
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
        UI.resetDraftWatchlist();
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

export function openPlayerCard(playerId) {
    const gs = Game.getGameState();
    if (!gs) return;
    const player = Game.getPlayer(playerId) || gs.players?.find(p => p.id === playerId);
    if (!player) return;

    const team = gs.teams.find(t => t.id === player.teamId);
    const teamName = team ? team.name : 'Free Agent';
    const isMyTeam = player.teamId === gs.playerTeam?.id;

    const bestPos = estimateBestPosition(player);
    const ovr = calculateOverall(player, bestPos);

    let activeCardTab = 'overview';
    window.app_switchPlayerCardTab = (tab) => {
        activeCardTab = tab;
        document.querySelectorAll('.pcard-tab-btn').forEach(btn => {
            const isActive = btn.dataset.ptab === tab;
            btn.className = `pcard-tab-btn px-3 py-1.5 rounded font-bold text-xs uppercase tracking-wider transition ${isActive ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800 bg-slate-100'}`;
        });
        document.querySelectorAll('.pcard-pane').forEach(p => p.classList.add('hidden'));
        document.getElementById(`pcard-pane-${tab}`)?.classList.remove('hidden');
    };

    // Tab 1: Positional Matrix
    const positions = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'];
    let overallsHtml = '<div class="grid grid-cols-4 gap-1.5 text-center">';
    positions.forEach(pos => {
        const isBest = pos === bestPos;
        overallsHtml += `
            <div class="${isBest ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-800'} p-1.5 rounded border border-slate-200">
                <span class="text-[9px] font-bold block ${isBest ? 'text-amber-400' : 'text-slate-400'}">${pos}</span>
                <span class="font-black text-sm">${calculateOverall(player, pos)}</span>
            </div>`;
    });
    overallsHtml += '</div>';

    // Tab 2: Detailed Attributes View
    const renderAttrBar = (label, val) => `
        <div class="flex items-center justify-between text-xs py-1 border-b border-slate-100">
            <span class="text-slate-600 font-medium">${label}</span>
            <div class="flex items-center gap-2">
                <div class="w-24 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                    <div class="h-full ${val >= 70 ? 'bg-emerald-500' : (val >= 50 ? 'bg-blue-500' : 'bg-amber-500')}" style="width: ${val}%"></div>
                </div>
                <span class="font-mono font-bold w-6 text-right">${val}</span>
            </div>
        </div>`;

    const phys = player.attributes?.physical || {};
    const ment = player.attributes?.mental || {};
    const tech = player.attributes?.technical || {};

    // Tab 3: Detailed Growth History
    let growthHtml = '<p class="text-xs text-slate-400 italic py-4">No progression recorded yet.</p>';
    if (player.progression && player.progression.length > 0) {
        growthHtml = `
            <div class="space-y-2">
                ${player.progression.slice().reverse().map(pr => {
            const gains = pr.improvements && pr.improvements.length > 0
                ? pr.improvements.map(g => `<span class="bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 py-0.5 rounded text-[10px] font-bold mr-1"><b>${g.attr}</b> +${g.increase}</span>`).join('')
                : '<span class="text-slate-400 text-[10px]">Natural physical development</span>';

            return `
                    <div class="bg-slate-50 border border-slate-200 p-2.5 rounded text-xs">
                        <div class="flex justify-between items-center mb-1 pb-1 border-b border-slate-200/60 font-mono">
                            <span class="font-bold text-slate-800">Season ${pr.year} (Age ${pr.age})</span>
                            <span class="text-slate-500">${pr.teamName} • <b class="text-slate-900">${pr.ovr} OVR</b></span>
                        </div>
                        <div class="pt-1">${gains}</div>
                    </div>`;
        }).join('')}
            </div>`;
    }

    // Tab 4: Career Stats Log
    let statsTableHtml = '<p class="text-xs text-slate-400 italic py-4">No stats recorded yet.</p>';
    if (player.progression && player.progression.length > 0) {
        statsTableHtml = `
            <table class="min-w-full text-xs font-mono">
                <thead class="bg-slate-100 text-slate-600 uppercase text-[10px]">
                    <tr>
                        <th class="p-1.5 text-left">Yr</th>
                        <th class="p-1.5 text-left">Team</th>
                        <th class="p-1.5 text-center">Pass Yds</th>
                        <th class="p-1.5 text-center">Rush Yds</th>
                        <th class="p-1.5 text-center">Rec Yds</th>
                        <th class="p-1.5 text-center">TDs</th>
                        <th class="p-1.5 text-center">Tkls</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100 text-[11px]">
                    ${player.progression.map(pr => {
            const st = pr.stats || {};
            return `
                        <tr>
                            <td class="p-1.5 font-bold">Y${pr.year}</td>
                            <td class="p-1.5 font-sans truncate max-w-[90px]">${pr.teamName}</td>
                            <td class="p-1.5 text-center">${st.passYards || 0}</td>
                            <td class="p-1.5 text-center">${st.rushYards || 0}</td>
                            <td class="p-1.5 text-center">${st.recYards || 0}</td>
                            <td class="p-1.5 text-center font-bold text-amber-600">${st.touchdowns || 0}</td>
                            <td class="p-1.5 text-center">${st.tackles || 0}</td>
                        </tr>`;
        }).join('')}
                </tbody>
            </table>`;
    }

    const modalHtml = `
        <div class="flex flex-col gap-3">
            <!-- Top Identity Banner -->
            <div class="bg-slate-900 text-white p-3.5 rounded flex justify-between items-start shadow-sm">
                <div>
                    <div class="flex items-center gap-2">
                        <h3 class="text-xl font-black uppercase tracking-wider">${player.name}</h3>
                        <span class="text-xs bg-slate-800 text-amber-400 font-mono px-2 py-0.5 rounded border border-slate-700">#${player.number || '--'}</span>
                    </div>
                    <p class="text-xs text-slate-400 mt-0.5 font-sans">
                        ${teamName} • ${player.age}yo • ${formatHeight(phys.height)} • ${phys.weight} lbs
                    </p>
                </div>
                <div class="text-right bg-slate-800 px-3 py-1.5 rounded border border-slate-700">
                    <span class="text-[9px] uppercase tracking-widest text-slate-400 block">${bestPos} OVR</span>
                    <span class="text-2xl font-black text-amber-400">${ovr}</span>
                </div>
            </div>

            <!-- Tab Buttons -->
            <div class="flex bg-slate-100 p-1 rounded border border-slate-200 gap-1 text-xs">
                <button class="pcard-tab-btn active px-3 py-1.5 rounded font-bold text-xs uppercase tracking-wider transition bg-slate-900 text-white shadow-sm" data-ptab="overview" onclick="app_switchPlayerCardTab('overview')">📋 Summary</button>
                <button class="pcard-tab-btn px-3 py-1.5 rounded font-bold text-xs uppercase tracking-wider transition text-slate-500 hover:text-slate-800 bg-slate-100" data-ptab="attributes" onclick="app_switchPlayerCardTab('attributes')">📊 All Attributes</button>
                <button class="pcard-tab-btn px-3 py-1.5 rounded font-bold text-xs uppercase tracking-wider transition text-slate-500 hover:text-slate-800 bg-slate-100" data-ptab="growth" onclick="app_switchPlayerCardTab('growth')">📈 Development History</button>
                <button class="pcard-tab-btn px-3 py-1.5 rounded font-bold text-xs uppercase tracking-wider transition text-slate-500 hover:text-slate-800 bg-slate-100" data-ptab="stats" onclick="app_switchPlayerCardTab('stats')">📜 Career Stats</button>
            </div>

            <!-- PANE 1: SUMMARY -->
            <div id="pcard-pane-overview" class="pcard-pane space-y-3">
                <div class="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-3 rounded border border-slate-200">
                    <p><span class="text-slate-400 font-bold uppercase text-[9px] block">Archetype</span> <b>${player.archetypeName || 'Athlete'}</b></p>
                    <p><span class="text-slate-400 font-bold uppercase text-[9px] block">Potential Ceiling</span> <b class="text-amber-700">${player.potential || 'C'}</b></p>
                    <p><span class="text-slate-400 font-bold uppercase text-[9px] block">Work Ethic</span> <b>${player.personality?.workEthic || 50}</b></p>
                    <p><span class="text-slate-400 font-bold uppercase text-[9px] block">Dependability</span> <b>${player.personality?.dependability || 50}</b></p>
                </div>

                ${player.bio ? `
                <div class="p-2.5 bg-amber-50/70 border border-amber-200 rounded text-xs text-slate-800 italic leading-relaxed">
                    <span class="font-bold uppercase tracking-wider text-[9px] text-amber-800 not-italic block mb-0.5">Scouting Lore & Blacktop Rep</span>
                    "${player.bio}"
                </div>` : ''}

                <div class="bg-white p-3 rounded border border-slate-200">
                    <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Positional Suitability Matrix</span>
                    ${overallsHtml}
                </div>

                <div class="bg-slate-50 p-2.5 rounded border border-slate-200 text-xs text-slate-700">
                    <span class="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Neighborhood Network</span>
                    Clique: <b class="text-indigo-600">${player.personality?.clique || 'Regular'}</b> | 
                    Best Friend: <b>${player.social?.bestFriendId ? (Game.getPlayer(player.social.bestFriendId)?.name || 'None') : 'None'}</b>
                </div>
            </div>

            <!-- PANE 2: ALL ATTRIBUTES -->
            <div id="pcard-pane-attributes" class="pcard-pane hidden grid grid-cols-1 md:grid-cols-3 gap-3">
                <div class="bg-white p-3 rounded border border-slate-200">
                    <h5 class="font-bold text-xs uppercase text-slate-400 tracking-wider mb-2 border-b pb-1">Physicals</h5>
                    ${renderAttrBar('Speed', phys.speed || 50)}
                    ${renderAttrBar('Strength', phys.strength || 50)}
                    ${renderAttrBar('Agility', phys.agility || 50)}
                    ${renderAttrBar('Stamina', phys.stamina || 50)}
                </div>
                <div class="bg-white p-3 rounded border border-slate-200">
                    <h5 class="font-bold text-xs uppercase text-slate-400 tracking-wider mb-2 border-b pb-1">Mental & IQ</h5>
                    ${renderAttrBar('Playbook IQ', ment.playbookIQ || 50)}
                    ${renderAttrBar('Toughness', ment.toughness || 50)}
                    ${renderAttrBar('Consistency', ment.consistency || 50)}
                    ${renderAttrBar('Clutch', ment.clutch || 50)}
                </div>
                <div class="bg-white p-3 rounded border border-slate-200">
                    <h5 class="font-bold text-xs uppercase text-slate-400 tracking-wider mb-2 border-b pb-1">Technicals</h5>
                    ${renderAttrBar('Throwing Acc', tech.throwingAccuracy || 30)}
                    ${renderAttrBar('Catching Hands', tech.catchingHands || 50)}
                    ${renderAttrBar('Blocking', tech.blocking || 50)}
                    ${renderAttrBar('Tackling', tech.tackling || 50)}
                    ${renderAttrBar('Pass Coverage', tech.coverage || tech.passCoverage || 50)}
                    ${renderAttrBar('Block Shed', tech.blockShedding || 50)}
                </div>
            </div>

            <!-- PANE 3: GROWTH HISTORY -->
            <div id="pcard-pane-growth" class="pcard-pane hidden max-h-72 overflow-y-auto">
                ${growthHtml}
            </div>

            <!-- PANE 4: STATS HISTORY -->
            <div id="pcard-pane-stats" class="pcard-pane hidden max-h-72 overflow-y-auto">
                ${statsTableHtml}
            </div>

            <!-- Bottom Actions -->
            ${isMyTeam ? `
                <div class="pt-2 border-t border-slate-200 flex justify-end">
                    <button class="bg-rose-700 hover:bg-rose-800 text-white px-4 py-1.5 rounded font-bold text-xs uppercase tracking-wider shadow-sm" onclick="app.cutPlayer('${player.id}')">Release Player</button>
                </div>
            ` : (!player.teamId ? `
                <div class="pt-3 border-t border-slate-200 bg-slate-50 p-3 rounded">
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
        </div>
    `;

    UI.showModal('Player Dossier', modalHtml);
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

    UI.resetDraftWatchlist();

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

    Object.entries(cliquesMap).sort((a, b) => b[1].length - a[1].length).forEach(([clique, members]) => {
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
    openBidModal: (playerId) => {
        const p = Game.getPlayer(playerId);
        if (!p) return;
        const availableTokens = gameState?.playerTeam?.socialProfile?.favorTokens || 0;

        const modalHtml = `
            <div class="space-y-3 text-left">
                <div class="p-2.5 bg-slate-50 border rounded flex justify-between items-center text-xs">
                    <div>
                        <span class="font-bold text-slate-900 text-sm block">${p.name}</span>
                        <span class="text-slate-500 font-mono">${p.age}yo • ${p.archetypeName || 'Athlete'}</span>
                    </div>
                    <span class="text-sm font-black text-slate-900 bg-white px-2 py-0.5 rounded border">${Game.calculateOverall(p, p.pos || Game.estimateBestPosition(p))} OVR</span>
                </div>
                <div class="grid grid-cols-3 gap-2 text-xs">
                    <div>
                        <label class="block text-[10px] text-slate-500 font-bold uppercase mb-1">Role Promised</label>
                        <select id="bid-role" class="w-full p-1 border rounded bg-white font-bold text-slate-800">
                            <option value="STARTER">Starter</option>
                            <option value="ROTATION" selected>Rotation</option>
                            <option value="BENCH">Reserve</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-[10px] text-slate-500 font-bold uppercase mb-1">Touches</label>
                        <select id="bid-touches" class="w-full p-1 border rounded bg-white font-bold text-slate-800">
                            <option value="NORMAL" selected>Normal</option>
                            <option value="FEATURED">Focal</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-[10px] text-slate-500 font-bold uppercase mb-1">Tokens (Have: ${availableTokens})</label>
                        <select id="bid-tokens" class="w-full p-1 border rounded bg-white font-bold text-slate-800">
                            <option value="0">0 Tokens</option>
                            ${availableTokens >= 1 ? '<option value="1">1 Token</option>' : ''}
                            ${availableTokens >= 2 ? '<option value="2">2 Tokens</option>' : ''}
                        </select>
                    </div>
                </div>
            </div>
        `;

        UI.showModal(`Submit Offer: ${p.name}`, modalHtml, () => {
            const role = document.getElementById('bid-role')?.value || 'ROTATION';
            const promiseTouches = document.getElementById('bid-touches')?.value || 'NORMAL';
            const tokensOffered = parseInt(document.getElementById('bid-tokens')?.value || '0', 10);

            // In Offseason Mini-Game: Queue bid for end-of-day resolution
            if (document.getElementById('offseason-fa-screen')?.classList.contains('hidden') === false) {
                UI.addOffseasonFABid({ playerId: p.id, offer: { role, promiseTouches, tokensOffered } });
                UI.renderOffseasonFAScreen(gameState);
            } else {
                // In-Season Bidding: Check for instant commit or queue for end-of-week
                const evalResult = Game.evaluatePlayerNegotiation(p, gameState.playerTeam, { role, promiseTouches, tokensOffered });
                const isInstant = Game.checkInstantCommit(p, gameState.playerTeam, evalResult, { role, promiseTouches, tokensOffered });

                if (isInstant) {
                    Game.playerSignFreeAgent(p.id, { role, promiseTouches, tokensOffered });
                    alert(`⚡ INSTANT COMMITMENT!\n\n${p.name} was blown away by your offer and immediately signed with ${gameState.playerTeam.name}!`);
                } else if (evalResult.accepted) {
                    gameState.weeklyBids = gameState.weeklyBids || [];
                    gameState.weeklyBids.push({ playerId: p.id, team: gameState.playerTeam, teamId: gameState.playerTeam.id, offer: { role, promiseTouches, tokensOffered } });
                    alert(`📋 Offer Submitted!\n\n${p.name} is considering your proposal alongside other interest. Bids will resolve at the end of the week.`);
                } else {
                    alert(`✋ Pitch Rejected: ${evalResult.reasons.join('\n• ')}`);
                }
                UI.switchTab('free-agents', gameState);
            }
        }, "Submit Offer");
    },
    cancelOffseasonBid: (idx) => {
        UI.removeOffseasonFABid(idx);
        UI.renderOffseasonFAScreen(gameState);
    },
    advanceOffseasonFADay: () => {
        const currentDay = UI.getOffseasonFADay();
        const userBids = UI.getOffseasonFABids();
        const signings = Game.processOffseasonFADay(gameState, userBids);

        // Update ticker and report
        const wireList = document.getElementById('fa-daily-wire-list');
        if (wireList) {
            const dayHtml = signings.map(s => `
                <div class="bg-slate-50 border p-1.5 rounded text-[11px]">
                    <span class="font-bold text-slate-900">${s.player.name}</span> signed with <b class="text-blue-700">${s.team.name}</b>
                    ${s.runnerUp ? `<span class="text-slate-400 block text-[9px]">(Chose over ${s.runnerUp.name})</span>` : ''}
                </div>
            `).join('') || '<p class="text-slate-400 italic text-[11px]">No signings reached consensus today.</p>';

            wireList.innerHTML = `<div class="font-bold text-[10px] text-amber-700 border-b pb-0.5 mb-1 uppercase">Day ${currentDay} Signings</div>` + dayHtml;
        }

        if (currentDay >= 3) {
            alert("🏆 Free Agency has officially concluded! Time to take the field for Season Kickoff.");
            finishOffseasonFAMinigame();
        } else {
            UI.incrementOffseasonFADay();
            UI.startOffseasonFAMinigame(gameState); // Clears bids for next day
        }
    },
    renderFAPool: () => {
        UI.renderOffseasonFAPool(gameState);
    },
    negotiatePlayer: (id) => {
        app.openBidModal(id);
        UI.hideModal();
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
    switchTab: (tabId) => {
        gameState = Game.getGameState();
        if (gameState) UI.switchTab(tabId, gameState);
    },
    autoFillRoster: () => {
        gameState = Game.getGameState();
        if (!gameState?.playerTeam) return;
        const count = Game.autoFillTeamWalkOns(gameState.playerTeam, 14);
        Game.saveGameState(activeSaveKey);
        UI.renderDashboard(gameState);
        alert(`Signed ${count} walk-on prospect(s) from the park! Roster now at ${gameState.playerTeam.roster.length} players.`);
    },
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
    /*document.getElementById('offense-formation-select')?.addEventListener('change', handleFormationChange);
    document.getElementById('defense-formation-select')?.addEventListener('change', handleFormationChange);
    */
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
    /*document.querySelector('#draft-screen thead tr')?.addEventListener('click', (e) => {
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
    });*/

    // Draft Sub-View Tabs (Overview, Physicals, Skills, Watchlist)
    document.querySelectorAll('.draft-view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;

            const defaultSorts = {
                overview: 'potential',
                physicals: 'speed',
                skills: 'playbookIQ',
                watchlist: 'potential'
            };

            UI.setDraftView(view);

            // Don't silently keep sorting by a column that isn't visible.
            currentSortColumn = defaultSorts[view] || 'potential';
            currentSortDirection = 'desc';

            if (gameState) {
                UI.renderDraftPool(
                    gameState,
                    handlePlayerSelectInDraft,
                    currentSortColumn,
                    currentSortDirection
                );

                UI.updateDraftSortIndicators(
                    currentSortColumn,
                    currentSortDirection
                );
            }
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
    document.getElementById('fa-filter-pos')?.addEventListener('change', () => {
        if (gameState) UI.switchTab('free-agents', gameState);
    });
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
