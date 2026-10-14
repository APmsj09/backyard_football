// js/main.js
import * as Game from './game.js';
import * as UI from './ui.js';
import { isDebugMode, setDebugMode, debugCollector } from './game.js';
import { positionOverallWeights, estimateBestPosition, calculateOverall } from './game/player.js';
import { gmBackgrounds, gmArchetypes, footballExpertises, offenseFormations, defenseFormations } from './data.js';
import { formatHeight } from './utils.js';

let gameState = null;
let selectedPlayerId = null;
let currentSortColumn = 'potential';
let currentSortDirection = 'desc';
let activeSaveKey = 'backyardFootballGameState';
let isDraftingLocked = false;

let isExitInterviewFlowActive = false;
let renderActiveExitInterview = null;

const ROSTER_LIMIT = 18;
const MIN_HEALTHY_PLAYERS = 8;
const WEEKS_IN_SEASON = 9;

async function startNewGame() {
    activeSaveKey = 'backyardFootballGameState';
    try {
        UI.showScreen("loading-screen");
        UI.startLoadingMessages();
        await new Promise(resolve => setTimeout(resolve, 50));

        // Reset debug collector for new game session
        debugCollector.reset();

        // Generate the 20 main teams + 6 youth teams
        await Game.initializeLeague((progress) => {
            UI.updateLoadingProgress(Math.round(progress * 30));
        });

        gameState = Game.getGameState();

        // REPORT 1: Capture Generated League & Players Baseline
        debugCollector.captureInitialLeague(gameState);

        const loadingMsgEl = document.getElementById('loading-message');

        // Simulate 4 Seasons of pure history before player chooses a team (Complete 4-Year Youth Cycle)
        for (let y = 1; y <= 4; y++) {
            if (loadingMsgEl) loadingMsgEl.textContent = `Simulating Season ${y} Matches & Draft...`;
            UI.updateLoadingProgress(30 + (y * 17));
            await new Promise(resolve => setTimeout(resolve, 50));

            Game.simulateHistoricalSeason(y, gameState);
            const offseasonReport = Game.advanceToOffseason();
            const draftResults = Game.simulateHistoricalDraft(y);

            // REPORT 2: Record each historical season with age development curves
            debugCollector.recordHistoricalSeason(y, {
                historyEntry: (gameState.history?.seasons || []).find(s => s.year === y),
                standings: gameState.teams.map(t => ({
                    id: t.id,
                    name: t.name,
                    tier: t.tier,
                    wins: t.wins || 0,
                    losses: t.losses || 0
                })),
                offseasonReport,
                draftResults
            });

            // Replenish rosters after each historical draft so teams don't bleed out
            gameState.teams.forEach(team => {
                if (team && team.leagueType === 'main') {
                    Game.autoFillTeamWalkOns(team, 13);
                    Game.aiSetDepthChart(team);
                }
            });
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

    const buildOptions = (items) => items.map((item, index) =>
        `<option value="${item.id}" ${index === 0 ? 'selected' : ''}>${item.name}</option>`
    ).join('');

    const backgroundOptions = buildOptions(gmBackgrounds);
    const archetypeOptions = buildOptions(gmArchetypes);
    const expertiseOptions = buildOptions(footballExpertises);

    const currentOffense = team.coach?.preferredOffense || team.formations?.offense;
    const currentDefense = team.coach?.preferredDefense || team.formations?.defense;

    const offOptions = Object.keys(offenseFormations)
        .filter(k => k !== 'Punt')
        .map(k => `<option value="${k}" ${k === currentOffense ? 'selected' : ''}>${offenseFormations[k].name}</option>`)
        .join('');

    const defOptions = Object.keys(defenseFormations)
        .filter(k => k !== 'Punt_Return')
        .map(k => `<option value="${k}" ${k === currentDefense ? 'selected' : ''}>${defenseFormations[k].name}</option>`)
        .join('');

    const modalHtml = `
        <div class="space-y-5 text-left">
            <p class="text-sm text-slate-600">
                You are taking over <strong>${team.name}</strong>.
                Your history shapes your reputation, your philosophy shapes
                your decisions, and your football expertise shapes how you
                evaluate talent.
            </p>

            <div>
                <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Your Name
                </label>
                <input type="text" id="new-coach-name"
                    class="w-full p-2 border border-slate-300 rounded outline-none focus:border-amber-500"
                    placeholder="e.g. GM Gordon" value="GM">
            </div>

            <div class="border-t border-slate-200 pt-4">
                <label class="block text-xs font-bold text-slate-800 uppercase tracking-wider mb-1">
                    1. Your Roots
                </label>
                <select id="new-gm-background"
                    class="w-full p-2 border border-slate-300 rounded outline-none focus:border-amber-500">
                    ${backgroundOptions}
                </select>
                <div id="gm-background-summary"
                    class="text-xs text-slate-600 mt-2 leading-relaxed"></div>
            </div>

            <div class="border-t border-slate-200 pt-4">
                <label class="block text-xs font-bold text-slate-800 uppercase tracking-wider mb-1">
                    2. Management Archetype
                </label>
                <select id="new-gm-archetype"
                    class="w-full p-2 border border-slate-300 rounded outline-none focus:border-amber-500">
                    ${archetypeOptions}
                </select>
                <div id="gm-archetype-summary"
                    class="text-xs text-slate-600 mt-2 leading-relaxed"></div>
            </div>

            <div class="border-t border-slate-200 pt-4">
                <label class="block text-xs font-bold text-slate-800 uppercase tracking-wider mb-1">
                    3. Football Expertise
                </label>
                <select id="new-gm-expertise"
                    class="w-full p-2 border border-slate-300 rounded outline-none focus:border-amber-500">
                    ${expertiseOptions}
                </select>
                <div id="gm-expertise-summary"
                    class="text-xs text-slate-600 mt-2 leading-relaxed"></div>
            </div>

            <div class="border-t border-slate-200 pt-4">
                <label class="block text-xs font-bold text-slate-800 uppercase tracking-wider mb-1">
                    Offensive Identity
                </label>
                <select id="new-coach-offense"
                    class="w-full p-2 border border-slate-300 rounded outline-none focus:border-amber-500">
                    ${offOptions}
                </select>

                <label class="block text-xs font-bold text-slate-800 uppercase tracking-wider mt-3 mb-1">
                    Defensive Identity
                </label>
                <select id="new-coach-defense"
                    class="w-full p-2 border border-slate-300 rounded outline-none focus:border-amber-500">
                    ${defOptions}
                </select>

                <p class="text-xs text-slate-500 mt-2 leading-relaxed">
                    These choices set your team's preferred schemes and update
                    your existing head coach's scheme preferences. They do
                    not replace your coach.
                </p>
            </div>
        </div>
    `;

    UI.showModal("Build Your Football Identity", modalHtml, () => {
        const name = document.getElementById('new-coach-name').value.trim() || 'GM';

        const backgroundId = document.getElementById('new-gm-background').value;
        const archetypeId = document.getElementById('new-gm-archetype').value;
        const expertiseId = document.getElementById('new-gm-expertise').value;
        const off = document.getElementById('new-coach-offense').value;
        const def = document.getElementById('new-coach-defense').value;

        confirmFranchiseTakeover(teamId, {
            name,
            backgroundId,
            archetypeId,
            expertiseId,
            off,
            def
        });
    }, "Take the Job");

    const updateChoiceSummaries = () => {
        const updateSummary = (selectId, summaryId, options) => {
            const selectedId = document.getElementById(selectId)?.value;
            const choice = options.find(item => item.id === selectedId);
            const summary = document.getElementById(summaryId);

            if (!choice || !summary) return;

            summary.innerHTML = `
                <p class="italic">${choice.lore}</p>
                <p class="font-semibold text-emerald-700 mt-1">${choice.effect}</p>
                ${choice.tradeoff
                    ? `<p class="text-amber-700 mt-1">Trade-off: ${choice.tradeoff}</p>`
                    : ''}
            `;
        };

        updateSummary(
            'new-gm-background',
            'gm-background-summary',
            gmBackgrounds
        );
        updateSummary(
            'new-gm-archetype',
            'gm-archetype-summary',
            gmArchetypes
        );
        updateSummary(
            'new-gm-expertise',
            'gm-expertise-summary',
            footballExpertises
        );
    };

    [
        'new-gm-background',
        'new-gm-archetype',
        'new-gm-expertise'
    ].forEach(id => {
        document.getElementById(id)?.addEventListener('change', updateChoiceSummaries);
    });

    updateChoiceSummaries();
}

function confirmFranchiseTakeover(teamId, coachDetails) {
    const team = gameState.teams.find(t => t.id === teamId);
    if (!team) return;

    team.isPlayerControlled = true;
    gameState.playerTeam = team;

    if (coachDetails) {
        const background = gmBackgrounds.find(
            item => item.id === coachDetails.backgroundId
        ) || gmBackgrounds[0];

        const archetype = gmArchetypes.find(
            item => item.id === coachDetails.archetypeId
        ) || gmArchetypes[0];

        const expertise = footballExpertises.find(
            item => item.id === coachDetails.expertiseId
        ) || footballExpertises[0];

        const modifierKeys = [
            'scoutingAccuracy',
            'negotiationInterest',
            'retention',
            'relationshipGrowth'
        ];

        const bonuses = Object.fromEntries(
            modifierKeys.map(key => [
                key,
                (background.modifiers?.[key] || 0) +
                (archetype.modifiers?.[key] || 0)
            ])
        );

        // Persist GM identity and mechanics as part of the team save.
        team.gmProfile = {
            name: coachDetails.name,
            backgroundId: background.id,
            backgroundName: background.name,
            archetypeId: archetype.id,
            archetypeName: archetype.name,
            expertiseId: expertise.id,
            expertiseName: expertise.name,
            expertisePositions: [...expertise.positions],
            expertiseScoutingBonus: expertise.scoutingAccuracyBonus,
            offensiveIdentity: coachDetails.off,
            defensiveIdentity: coachDetails.def,
            bonuses
        };

        // Background affects the team's starting neighborhood resources.
        if (!team.socialProfile) {
            team.socialProfile = { streetCred: 50, favorTokens: 3 };
        }

        team.socialProfile.streetCred = Math.max(
            0,
            Math.min(
                100,
                (team.socialProfile.streetCred ?? 50) +
                background.startingStreetCredBonus
            )
        );

        team.socialProfile.favorTokens = Math.max(
            0,
            (team.socialProfile.favorTokens ?? 3) +
            background.startingFavorTokenBonus
        );

        team.formations.offense = coachDetails.off;
        team.formations.defense = coachDetails.def;

        if (!team.staff) Game.initializeTeamStaff(team);

        if (team.staff.gm) {
            team.staff.gm.name = coachDetails.name;

            if (!team.staff.gm.biases) {
                team.staff.gm.biases = {};
            }

            team.staff.gm.biases.personality = {
                name: archetype.name,
                desc: archetype.lore
            };

            team.staff.gm.biases.tactical = {
                name: coachDetails.off,
                desc: `The franchise's chosen offensive identity is ${coachDetails.off}.`
            };
        }

        // Keep the same head coach, but make the selected schemes their working preferences.
        const headCoach = team.staff?.coach || team.coach;

        if (headCoach) {
            headCoach.preferredOffense = coachDetails.off;
            headCoach.preferredDefense = coachDetails.def;

            // Improve the inherited coach without replacing their identity.
            const coachRatingBonuses = Object.entries(
                archetype.coachRatingBonuses || {}
            );

            if (coachRatingBonuses.length > 0) {
                if (!headCoach.ratings) headCoach.ratings = {};

                coachRatingBonuses.forEach(([rating, bonus]) => {
                    headCoach.ratings[rating] = Math.min(
                        99,
                        (headCoach.ratings[rating] ?? 50) + bonus
                    );
                });
            }

            team.coach = headCoach;
        }

        Game.rebuildDepthChartFromOrder(team);
    }

    // Initialize Year 5 Draft for the human player and wipe any historical stats for the new season
    gameState.players.forEach(p => {
        p.seasonStats = { receptions: 0, recYards: 0, passYards: 0, rushYards: 0, touchdowns: 0, tackles: 0, sacks: 0, interceptions: 0, passAttempts: 0, passCompletions: 0, interceptionsThrown: 0 };
    });
    Game.setupDraft();
    gameState.draftCompleted = false;

    // REPORT 3: Initialize First Player Draft report
    debugCollector.initDraftReport(gameState);
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

            const userPos = estimateBestPosition(player);
            const userOvr = Game.calculateOverall(player, userPos);

            gs.pickHistory.push({
                pick: gs.currentPick + 1,
                teamName: team.name,
                teamId: team.id,
                playerName: player.name,
                pos: userPos,
                ovr: userOvr,
                potential: player.potential
            });

            // Capture top alternatives on the board when the user picked
            const availableAlternatives = (gs.draftClass || [])
                .filter(p => p.id !== player.id)
                .slice(0, 3)
                .map(alt => ({
                    name: alt.name,
                    pos: estimateBestPosition(alt),
                    ovr: Game.calculateOverall(alt, estimateBestPosition(alt)),
                    potential: alt.potential
                }));

            debugCollector.recordDraftDecision({
                pick: gs.currentPick + 1,
                teamName: team.name,
                isUser: true,
                player,
                pos: userPos,
                ovr: userOvr,
                teamNeed: 'User Choice',
                alternatives: availableAlternatives,
                reasoning: 'Human GM selection'
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
                    debugCollector.recordDraftSkip({
                        pick: gameState.currentPick + 1,
                        teamName: currentPickingTeam.name,
                        reason: 'Player team roster limit reached',
                        rosterSize: gameState.playerTeam.roster.length,
                        rosterLimit: ROSTER_LIMIT
                    });

                    gameState.currentPick++;
                    UI.renderSelectedPlayerCard(null, gameState);
                    continue;
                } else {
                    UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId, currentSortColumn, currentSortDirection);
                    break;
                }
            }

            if (!currentPickingTeam || !currentPickingTeam.roster || currentPickingTeam.roster.length >= ROSTER_LIMIT) {
                debugCollector.recordDraftSkip({
                    pick: gameState.currentPick + 1,
                    teamName: currentPickingTeam?.name || 'Unknown team',
                    reason: !currentPickingTeam
                        ? 'Missing team in draft order'
                        : !currentPickingTeam.roster
                            ? 'Missing roster array'
                            : 'Roster limit reached',
                    rosterSize: currentPickingTeam?.roster?.length ?? null,
                    rosterLimit: ROSTER_LIMIT
                });

                gameState.currentPick++;
            } else {
                // Capture candidates available immediately before the AI selects
                const topAlternatives = (gameState.draftClass || [])
                    .slice(0, 4)
                    .map(alt => ({
                        name: alt.name,
                        pos: estimateBestPosition(alt),
                        ovr: Game.calculateOverall(alt, estimateBestPosition(alt)),
                        potential: alt.potential
                    }));

                const picked = Game.simulateAIPick(currentPickingTeam);
                if (picked) {
                    const pickedPos = estimateBestPosition(picked);
                    const pickedOvr = Game.calculateOverall(picked, pickedPos);

                    if (!gameState.pickHistory) gameState.pickHistory = [];
                    gameState.pickHistory.push({
                        pick: gameState.currentPick + 1,
                        teamName: currentPickingTeam.name,
                        teamId: currentPickingTeam.id,
                        playerName: picked.name,
                        pos: pickedPos,
                        ovr: pickedOvr,
                        potential: picked.potential
                    });

                    // Count team's existing players at this position to determine need
                    const teamRoster = Game.getRosterObjects(currentPickingTeam);
                    const depthAtPos = teamRoster.filter(p => (p.pos || estimateBestPosition(p)) === pickedPos).length;

                    debugCollector.recordDraftDecision({
                        pick: gameState.currentPick + 1,
                        teamName: currentPickingTeam.name,
                        isUser: false,
                        player: picked,
                        pos: pickedPos,
                        ovr: pickedOvr,
                        currentDepthAtPos: depthAtPos,
                        alternatives: topAlternatives.filter(a => a.name !== picked.name).slice(0, 3),
                        reasoning: depthAtPos === 0 ? `Critical Positional Need (${pickedPos})` : `Best Player Available (${pickedOvr} OVR, ${picked.potential} Pot)`
                    });
                } else {
                    debugCollector.recordDraftSkip({
                        pick: gameState.currentPick + 1,
                        teamName: currentPickingTeam.name,
                        reason: 'AI pick returned no player',
                        rosterSize: currentPickingTeam.roster?.length ?? null,
                        rosterLimit: ROSTER_LIMIT
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

    // REPORT 3: Finalize Draft Report
    debugCollector.finalizeDraftReport(gameState);

    // REPORT 4: Initialize Offseason FA Mini-Game Report
    debugCollector.initOffseasonReport(gameState);

    // Launch the Post-Draft Free Agency Mini-Game!
    UI.startOffseasonFAMinigame(gameState);
}

function finishOffseasonFAMinigame() {
    // 1. Let the AI trim their 24-man summer rosters down to the 18-man season limit
    Game.executeAICutDowns();

    for (const team of gameState.teams) {
        if (!team) continue;
        if (!team.isPlayerControlled) {
            Game.autoFillTeamWalkOns(team, 14);
        }
        try { Game.aiSetDepthChart(team); } catch (error) { console.error(error); }
    }

    // REPORT 4: Finalize Offseason Report (Roster health verification)
    if (typeof debugCollector !== 'undefined') debugCollector.finalizeOffseasonReport(gameState);

    UI.renderDashboard(gameState);
    UI.switchTab('my-team', gameState);
    UI.showScreen('dashboard-screen');

    checkUserRosterLimit(); // Trigger the cut-down check immediately
}

// Global helper to validate roster size before games
window.checkUserRosterLimit = function() {
    if (!gameState || !gameState.playerTeam) return;
    
    const rosterSize = gameState.playerTeam.roster.length;
    const limit = 18; // Hard limit for regular season
    const advBtn = document.getElementById('advance-week-btn');
    
    if (!advBtn) return;

    if (rosterSize > limit) {
        advBtn.innerHTML = `<span>⚠️ Cut ${rosterSize - limit} Players</span>`;
        advBtn.className = 'btn bg-rose-700 hover:bg-rose-800 text-white font-bold py-2 px-6 rounded-sm text-sm uppercase tracking-wider transition shadow-sm border border-rose-900 animate-pulse';
        advBtn.onclick = () => {
            alert(`Summer Tryouts are over! You must cut ${rosterSize - limit} player(s) from the 'My Team' tab before Week 1 can begin.`);
            UI.switchTab('my-team', gameState);
        };
    } else {
        advBtn.innerHTML = `<span>Play Week 1</span>`;
        advBtn.className = 'btn bg-amber-500 hover:bg-amber-600 text-white font-bold py-2 px-6 rounded-sm text-sm uppercase tracking-wider transition shadow-sm border border-amber-600';
        advBtn.onclick = handleAdvanceWeek;
    }
};

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
    Game.saveGameState(activeSaveKey);
    UI.showModal("Saved", `<p>Game saved successfully to slot '${activeSaveKey}'.</p>`);
}

function handleTabSwitch(e) {
    const button = e.target.closest('.tab-button');
    if (button) {
        const tabId = button.dataset.tab;
        gameState = Game.getGameState();
        if (gameState) {
            UI.switchTab(tabId, gameState); // Routes correctly to the UI module export
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


function startExitInterviewFlow(retentions, onComplete, report = null) {
    if (!Array.isArray(retentions) || retentions.length === 0) {
        onComplete?.();
        return;
    }

    if (isExitInterviewFlowActive) {
        renderActiveExitInterview?.();
        return;
    }

    isExitInterviewFlowActive = true;
    const totalInterviews = retentions.length;

    gameState = Game.getGameState();
    gameState.pendingRetentions = retentions;

    const escapeExitHtml = (value) =>
        String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[char]);

    const saveAndContinue = () => {
        // Remove the resolved player before saving, so the same interview
        // cannot be repeated from the remaining queue.
        retentions.shift();

        gameState = Game.getGameState();
        gameState.pendingRetentions = retentions;

        Game.saveGameState(activeSaveKey);
        renderCurrentInterview();
    };

    const releaseToFreeAgency = (player, item, team) => {
        if (!player || !team) return;

        team.roster = (team.roster || []).filter(id => id !== player.id);

        if (player.teamId === team.id) {
            if (!player.playerHistory) {
                player.playerHistory = { teamsPlayedFor: [] };
            }

            if (!Array.isArray(player.playerHistory.teamsPlayedFor)) {
                player.playerHistory.teamsPlayedFor = [];
            }

            const completedSeason = Math.max(1, (gameState.year || 1) - 1);
            const history = player.playerHistory.teamsPlayedFor;

            if (!history.some(entry =>
                entry.teamId === team.id && entry.year === completedSeason
            )) {
                history.push({
                    teamId: team.id,
                    teamName: team.name,
                    year: completedSeason
                });
            }
        }

        player.teamId = null;
        player.number = null;

        // Keep the player available in Free Agency instead of marking him
        // "departed", which excludes him from recruitment.
        player.status = {
            type: 'healthy',
            description: item.reason || 'Left the team after the season.',
            duration: 0
        };

        if (report && Array.isArray(report.leavingPlayers)) {
            report.leavingPlayers.push({
                player,
                reason: item.reason,
                teamName: team.name
            });
        }

        Game.aiSetDepthChart(team);
    };

    const finishFlow = () => {
        UI.hideModal();

        isExitInterviewFlowActive = false;
        renderActiveExitInterview = null;

        gameState = Game.getGameState();
        gameState.pendingRetentions = [];

        Game.saveGameState(activeSaveKey);
        onComplete?.();
    };

    const renderCurrentInterview = () => {
        gameState = Game.getGameState();

        if (!retentions.length) {
            finishFlow();
            return;
        }

        const item = retentions[0];
        const player = item?.player;
        const team = gameState?.playerTeam;

        // Skip stale queue entries safely if a player no longer belongs
        // to the user's roster.
        if (
            !player ||
            !team ||
            player.teamId !== team.id ||
            !team.roster?.includes(player.id)
        ) {
            saveAndContinue();
            return;
        }

        const pos = player.pos || Game.estimateBestPosition(player);
        const ovr = Game.calculateOverall(player, pos);
        const pitchOptions = Game.getRetentionPitchOptions(player);
        const tokensAvailable = Math.max(
            0,
            Math.floor(team.socialProfile?.favorTokens ?? 0)
        );

        const defaultRole =
            player.expectations?.desiredRole === 'STARTER' ||
            (player.personality?.ego ?? 50) >= 70
                ? 'STARTER'
                : 'ROTATION';

        const focusPromise = pitchOptions.focusPromise;
        const promiseOptionsHtml = focusPromise
            ? `<option value="${escapeExitHtml(focusPromise.value)}">${escapeExitHtml(focusPromise.label)}</option>`
            : '';

        const tokenOptionsHtml = [1, 2]
            .filter(amount => amount <= tokensAvailable)
            .map(amount =>
                `<option value="${amount}">${amount} Token${amount > 1 ? 's' : ''}</option>`
            )
            .join('');

        const modalHtml = `
            <div class="space-y-3.5 text-left text-xs font-sans">
                <div class="bg-slate-900 text-white p-3 rounded flex justify-between items-center">
                    <div>
                        <div class="flex items-center gap-2 flex-wrap">
                            <h4 class="font-black text-sm text-white">${escapeExitHtml(player.name)}</h4>
                            <span class="bg-slate-800 text-amber-400 font-bold px-1.5 py-0.5 rounded font-mono text-[10px]">
                                ${escapeExitHtml(pos)} • ${ovr} OVR
                            </span>
                        </div>
                        <span class="text-slate-400 font-mono text-[11px]">
                            Age ${player.age} • Exit Interview ${totalInterviews - retentions.length + 1} of ${totalInterviews}
                        </span>
                    </div>
                    <span class="text-[10px] bg-amber-500 text-slate-950 font-bold px-2 py-0.5 rounded uppercase">
                        Flight Risk
                    </span>
                </div>

                <div class="p-3 bg-rose-50 border border-rose-200 rounded text-rose-950 space-y-1">
                    <span class="font-black text-[10px] text-rose-800 uppercase tracking-wider block">
                        Why he's thinking about leaving
                    </span>
                    <p class="text-[11px] font-bold italic leading-relaxed">
                        "${escapeExitHtml(item.reason)}"
                    </p>
                    <div class="text-[10px] font-mono text-slate-600 pt-2 border-t border-rose-200/60 flex flex-wrap gap-3">
                        <span>Ego: <b>${player.personality?.ego ?? 50}</b></span>
                        <span>Loyalty: <b>${player.personality?.loyalty ?? 50}</b></span>
                        <span>Work Ethic: <b>${player.personality?.workEthic ?? 50}</b></span>
                        <span>Season Snaps: <b>${item.snapsThisSeason ?? 0}</b></span>
                    </div>
                </div>

                <div class="space-y-2.5">
                    <h5 class="font-black text-xs uppercase tracking-wider text-slate-700">
                        Your Pitch
                    </h5>

                    <div>
                        <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                            Role Commitment
                        </label>
                        <select id="retention-role"
                            class="w-full p-2 border border-slate-300 rounded font-bold text-slate-800 bg-white">
                            <option value="STARTER" ${defaultRole === 'STARTER' ? 'selected' : ''}>
                                ${escapeExitHtml(pitchOptions.starterRoleLabel)} — Guaranteed
                            </option>
                            <option value="ROTATION" ${defaultRole === 'ROTATION' ? 'selected' : ''}>
                                ${escapeExitHtml(pitchOptions.rotationRoleLabel)} — Earn Your Reps
                            </option>
                        </select>
                        <p class="text-[10px] text-slate-500 mt-1">
                            A starting-role promise is a real commitment that will be checked next offseason.
                        </p>
                    </div>

                    <div>
                        <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                            Position-Specific Commitment
                        </label>
                        <select id="retention-promise"
                            class="w-full p-2 border border-slate-300 rounded font-bold text-slate-800 bg-white">
                            <option value="NONE">No additional workload guarantee</option>
                            ${promiseOptionsHtml}
                        </select>
                        <p class="text-[10px] text-slate-500 mt-1">
                            ${escapeExitHtml(
                                focusPromise
                                    ? focusPromise.description
                                    : 'No offensive workload promise is available for this position. Focus on role, trust and team culture.'
                            )}
                        </p>
                    </div>

                    <div>
                        <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                            Favor Token Sweetener
                        </label>
                        <select id="retention-tokens"
                            class="w-full p-2 border border-slate-300 rounded font-bold text-slate-800 bg-white">
                            <option value="0">0 Tokens</option>
                            ${tokenOptionsHtml}
                        </select>
                        <p class="text-[10px] text-slate-500 mt-1">
                            ${tokensAvailable} token${tokensAvailable === 1 ? '' : 's'} available.
                            Tokens are spent only if the player accepts.
                        </p>
                    </div>
                </div>

                <div class="p-2 bg-amber-50 border border-amber-200 rounded text-[10px] text-amber-950">
                    <b>Coach's word matters.</b> If he accepts, your promises become part of his player record.
                    Breaking a recorded commitment can destroy his trust permanently.
                </div>

                <div class="flex justify-between items-center pt-2 border-t border-slate-200 gap-3">
                    <button id="retention-let-walk"
                        class="text-rose-700 hover:text-rose-900 font-bold uppercase text-[10px] tracking-wider px-2 py-2">
                        Let Him Walk →
                    </button>
                    <button id="retention-submit-pitch"
                        class="bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-4 py-2 rounded text-xs uppercase tracking-wider shadow-sm">
                        Make the Pitch 🤝
                    </button>
                </div>
            </div>
        `;

        UI.showModal(`Exit Interview: ${player.name}`, modalHtml);

        document.getElementById('retention-let-walk')?.addEventListener('click', () => {
            releaseToFreeAgency(player, item, team);

            Game.addMessage(
                'Player Departed',
                `🚲 <b>${escapeExitHtml(player.name)}</b> chose a fresh start in Free Agency: ${escapeExitHtml(item.reason)}`
            );

            saveAndContinue();
        });

        document.getElementById('retention-submit-pitch')?.addEventListener('click', () => {
            const rolePromised =
                document.getElementById('retention-role')?.value || 'ROTATION';

            const promiseType =
                document.getElementById('retention-promise')?.value || 'NONE';

            const tokensOffered = Number(
                document.getElementById('retention-tokens')?.value || 0
            );

            // Recheck available resources at the point of submission.
            const latestTokens = Math.max(
                0,
                Math.floor(team.socialProfile?.favorTokens ?? 0)
            );

            if (
                !Number.isInteger(tokensOffered) ||
                tokensOffered < 0 ||
                tokensOffered > 2 ||
                tokensOffered > latestTokens
            ) {
                alert('Your available Favor Tokens changed. Please update the offer.');
                renderCurrentInterview();
                return;
            }

            const pitchResult = Game.evaluateRetentionPitch(player, team, {
                rolePromised,
                promiseType,
                tokensOffered
            });

            if (!pitchResult.accepted) {
                releaseToFreeAgency(player, item, team);

                Game.addMessage(
                    'Player Departed',
                    `🚲 <b>${escapeExitHtml(player.name)}</b> rejected the retention pitch and entered Free Agency.`
                );

                alert(
                    `✋ PITCH DECLINED\n\n${pitchResult.quote}\n\n` +
                    `${player.name} has left for Free Agency.`
                );

                saveAndContinue();
                return;
            }

            // Commit tokens and promises only after acceptance.
            if (tokensOffered > 0) {
                team.socialProfile.favorTokens -= tokensOffered;
            }

            player.activePromise = {
                role: rolePromised,
                promiseType,
                promiseTouches: 'NORMAL',
                promiseSeason: gameState.year,
                broken: false
            };

            player.status = {
                type: 'healthy',
                description: '',
                duration: 0
            };

            if (player.personality) {
                player.personality.loyalty = Math.min(
                    100,
                    (player.personality.loyalty ?? 50) + 5
                );
            }

            if (player.expectations) {
                player.expectations.happiness = Math.min(
                    100,
                    (player.expectations.happiness ?? 50) + 8
                );
            }

            Game.aiSetDepthChart(team);

            Game.addMessage(
                'Player Retained',
                `🤝 <b>${escapeExitHtml(player.name)}</b> agreed to stay for Season ${gameState.year}.`
            );

            alert(
                `🤝 PLAYER RETAINED\n\n${pitchResult.quote}\n\n` +
                `${player.name} agreed to return for Season ${gameState.year}.\n\n` +
                `Promise recorded: ${rolePromised}` +
                (promiseType !== 'NONE' ? ` + ${promiseType}` : '') +
                (tokensOffered > 0 ? `\nFavor Tokens spent: ${tokensOffered}` : '')
            );

            saveAndContinue();
        });
    };

    renderActiveExitInterview = renderCurrentInterview;
    renderCurrentInterview();
}


async function handleAdvanceWeek() {
    if (!gameState) return;

    // Never allow the season to advance around an unresolved exit interview.
    if (isExitInterviewFlowActive) {
        renderActiveExitInterview?.();
        return;
    }

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

    // 2. Advance to Offseason, resolving user-team flight risks first.
    if (gameState.currentWeek >= WEEKS_IN_SEASON) {
        const report = Game.advanceToOffseason();

        gameState = Game.getGameState();
        Game.saveGameState(activeSaveKey);

        const retentions = Array.isArray(report.pendingRetentions)
            ? report.pendingRetentions
            : [];

        const proceedToOffseasonScreen = () => {
            gameState = Game.getGameState();
            gameState.pendingRetentions = [];

            Game.saveGameState(activeSaveKey);
            UI.renderOffseasonScreen(report, gameState.year);
            UI.showScreen('offseason-screen');
        };

        if (retentions.length > 0) {
            startExitInterviewFlow(
                retentions,
                proceedToOffseasonScreen,
                report
            );
        } else {
            proceedToOffseasonScreen();
        }

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
                    ${renderAttrBar('Decision Making', ment.decisionMaking || 50)}
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
                <div class="pt-2 border-t border-slate-200 flex justify-between items-center">
                    <button class="bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-600 px-3 py-1.5 rounded font-bold text-xs uppercase tracking-wider shadow-sm flex items-center gap-1.5 transition" onclick="app.openPositionDialog('${player.id}')">
                        <span>💬</span> Talk Position Change
                    </button>
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
    renderSocialNetworkTab: () => {
        if (gameState) {
            renderSocialNetworkTab(gameState);
        }
    },
    renderFAPool: () => {
        if (gameState) UI.renderOffseasonFAPool(gameState);
    },
    openBidModal: (playerId) => {
        const p = Game.getPlayer(playerId);
        if (!p) return;

        const isOffseason = document.getElementById('offseason-fa-screen')?.classList.contains('hidden') === false;
        const totalTokens = gameState?.playerTeam?.socialProfile?.favorTokens || 0;
        const pendingBids = isOffseason ? (UI.getOffseasonFABids() || []) : [];
        const existingBid = pendingBids.find(b => b.playerId === p.id);

        const committedOtherTokens = pendingBids
            .filter(b => b.playerId !== p.id)
            .reduce((sum, b) => sum + (b.offer.tokensOffered || 0), 0);

        const maxTokensForThisBid = Math.max(0, totalTokens - committedOtherTokens);
        const intel = Game.getPlayerMarketIntel(p, gameState);

        const pos = p.pos || Game.estimateBestPosition(p);
        const ovr = Game.calculateOverall(p, pos);

        const curRole = existingBid?.offer?.role || 'STARTER';
        const curTouches = existingBid?.offer?.promiseTouches || 'NORMAL';
        const curTokens = existingBid?.offer?.tokensOffered ?? (maxTokensForThisBid >= 1 ? 0 : 0);

        let heatLabel = '<span class="bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded text-[10px] font-bold">💤 Quiet Market</span>';
        if (intel.heat === 'HOT') {
            heatLabel = `<span class="bg-rose-100 text-rose-800 border border-rose-300 px-1.5 py-0.5 rounded text-[10px] font-bold">🔥 Hot Market (Suitors: ${intel.suitorNames.join(', ')})</span>`;
        } else if (intel.heat === 'WARM') {
            heatLabel = `<span class="bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.5 rounded text-[10px] font-bold">💬 Moderate Buzz (Suitors: ${intel.suitorNames.join(', ')})</span>`;
        }

        const modalHtml = `
            <div class="space-y-3.5 text-left text-xs">
                <!-- Prospect Profile Header -->
                <div class="p-3 bg-slate-900 text-white rounded flex justify-between items-center">
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="font-black text-sm text-white">${p.name}</span>
                            <span class="bg-slate-800 text-amber-400 font-bold px-1.5 py-0.2 rounded font-mono text-[10px]">${pos}</span>
                        </div>
                        <span class="text-slate-400 font-mono text-[11px]">${p.age}yo • ${p.archetypeName || 'Athlete'} • Potential: ${p.potential || 'C'}</span>
                    </div>
                    <div class="text-right">
                        <span class="text-xl font-black text-white">${ovr}</span>
                        <span class="text-[9px] text-slate-400 block uppercase font-bold -mt-1">OVR</span>
                    </div>
                </div>

                <!-- Blacktop Rumors & Grapevine Card -->
                <div class="p-3 bg-amber-50/80 border border-amber-200 rounded text-slate-800 space-y-1">
                    <div class="flex justify-between items-center mb-1">
                        <span class="font-black text-[10px] text-amber-900 uppercase tracking-wider flex items-center gap-1">
                            <span>🚲</span> Blacktop Grapevine & Market Rumors
                        </span>
                        ${heatLabel}
                    </div>
                    <p class="text-[11px] text-slate-700 italic">"${intel.rumorText}"</p>
                    <div class="text-[10px] text-slate-500 font-mono pt-1 border-t border-amber-200/60 flex flex-wrap gap-2">
                        <span>Work Ethic: <b>${p.personality?.workEthic || 50}</b></span>
                        <span>•</span>
                        <span>Ego: <b class="${(p.personality?.ego || 50) > 70 ? 'text-rose-600' : 'text-slate-700'}">${p.personality?.ego || 50}</b></span>
                        <span>•</span>
                        <span>Clique: <b>${p.personality?.clique || 'Regular'}</b></span>
                    </div>
                </div>

                <!-- Contract Terms Form -->
                <div>
                    <h5 class="font-black text-xs uppercase tracking-wider text-slate-700 mb-2">Offer Terms & Playing Promise</h5>
                    <div class="grid grid-cols-3 gap-2.5">
                        <div>
                            <label class="block text-[10px] text-slate-500 font-bold uppercase mb-1">Role Promised</label>
                            <select id="bid-role" class="w-full p-1.5 border border-slate-300 rounded bg-white font-bold text-slate-800 outline-none">
                                <option value="STARTER" ${curRole === 'STARTER' ? 'selected' : ''}>Starter (Promised)</option>
                                <option value="ROTATION" ${curRole === 'ROTATION' ? 'selected' : ''}>Rotation (Core Sub)</option>
                                <option value="BENCH" ${curRole === 'BENCH' ? 'selected' : ''}>Reserve (Depth)</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-[10px] text-slate-500 font-bold uppercase mb-1">Touches</label>
                            <select id="bid-touches" class="w-full p-1.5 border border-slate-300 rounded bg-white font-bold text-slate-800 outline-none">
                                <option value="NORMAL" ${curTouches === 'NORMAL' ? 'selected' : ''}>Standard</option>
                                <option value="FEATURED" ${curTouches === 'FEATURED' ? 'selected' : ''}>Focal Option</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-[10px] text-slate-500 font-bold uppercase mb-1">Favor Tokens</label>
                            <select id="bid-tokens" class="w-full p-1.5 border border-slate-300 rounded bg-white font-bold text-slate-800 outline-none">
                                <option value="0" ${curTokens === 0 ? 'selected' : ''}>0 Tokens</option>
                                ${maxTokensForThisBid >= 1 ? `<option value="1" ${curTokens === 1 ? 'selected' : ''}>1 Token</option>` : ''}
                                ${maxTokensForThisBid >= 2 ? `<option value="2" ${curTokens === 2 ? 'selected' : ''}>2 Tokens</option>` : ''}
                            </select>
                        </div>
                    </div>
                </div>

                <div class="text-[10px] text-slate-500 bg-slate-50 p-2 rounded border border-slate-200">
                    Favor Tokens: <b>${maxTokensForThisBid} Available for this bid</b> (Total: ${totalTokens}, Committed to other active offers: ${committedOtherTokens}).
                </div>
            </div>
        `;

        UI.showModal(`Recruit Prospect: ${p.name}`, modalHtml, () => {
            const role = document.getElementById('bid-role')?.value || 'STARTER';
            const promiseTouches = document.getElementById('bid-touches')?.value || 'NORMAL';
            const tokensOffered = parseInt(document.getElementById('bid-tokens')?.value || '0', 10);

            if (isOffseason) {
                UI.addOffseasonFABid({ playerId: p.id, offer: { role, promiseTouches, tokensOffered } });
                UI.renderOffseasonFAScreen(gameState);
            } else {
                const evalResult = Game.evaluatePlayerNegotiation(p, gameState.playerTeam, { role, promiseTouches, tokensOffered });
                const isInstant = Game.checkInstantCommit(p, gameState.playerTeam, evalResult, { role, promiseTouches, tokensOffered });

                if (isInstant) {
                    Game.playerSignFreeAgent(p.id, { role, promiseTouches, tokensOffered });
                    alert(`⚡ INSTANT COMMITMENT!\n\n${p.name} loved your offer and signed immediately with ${gameState.playerTeam.name}!`);
                } else if (evalResult.accepted) {
                    gameState.weeklyBids = gameState.weeklyBids || [];
                    gameState.weeklyBids.push({ playerId: p.id, team: gameState.playerTeam, teamId: gameState.playerTeam.id, offer: { role, promiseTouches, tokensOffered } });
                    alert(`📋 Offer Submitted!\n\n${p.name} is considering your offer alongside other interest. Bids resolve at the end of the week.`);
                } else {
                    alert(`✋ Offer Declined: ${evalResult.reasons.join('\n• ')}`);
                }
                UI.switchTab('free-agents', gameState);
            }
        }, existingBid ? "Update Offer" : "Submit Offer");
    },

    cancelOffseasonBid: (idx) => {
        UI.removeOffseasonFABid(idx);
        UI.renderOffseasonFAScreen(gameState);
    },

    openPositionDialog: (playerId) => {
        const p = Game.getPlayer(playerId);
        if (!p) return;

        const currentPos = p.pos || Game.estimateBestPosition(p);
        const positions = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'].filter(pos => pos !== currentPos);
        const tokens = gameState?.playerTeam?.socialProfile?.favorTokens || 0;

        const modalHtml = `
            <div class="space-y-3.5 text-left text-xs">
                <div class="bg-slate-900 text-white p-3 rounded flex justify-between items-center">
                    <div>
                        <h4 class="font-black text-sm text-white">${p.name}</h4>
                        <span class="text-slate-400 font-mono text-[11px]">Current: <b class="text-amber-400">${currentPos}</b> • Ethic: ${p.personality?.workEthic || 50} • Ego: ${p.personality?.ego || 50}</span>
                    </div>
                    <span class="text-[10px] bg-slate-800 text-slate-300 font-bold px-2 py-1 rounded border border-slate-700">Tokens: ${tokens}</span>
                </div>

                <div>
                    <label class="block text-[10px] font-black uppercase tracking-wider text-slate-600 mb-1">Proposed New Position</label>
                    <select id="target-pos-select" class="w-full p-2 border border-slate-300 rounded font-bold text-slate-800 bg-white text-xs outline-none">
                        ${positions.map(pos => `<option value="${pos}">${pos} (${Game.calculateOverall(p, pos)} OVR suitability)</option>`).join('')}
                    </select>
                </div>

                <div class="p-2.5 bg-amber-50 border border-amber-200 rounded text-slate-700 italic text-[11px]">
                    "Kids with high ego will resist moving from glamour positions (QB/WR) to the trenches. Grinders with high work ethic will play wherever the squad needs them."
                </div>
            </div>
        `;

        UI.showModal(`Sideline Conversation: ${p.name}`, modalHtml, () => {
            const targetPos = document.getElementById('target-pos-select')?.value;
            const res = Game.discussPositionChange(p, targetPos, gameState.playerTeam, false);

            const resultHtml = `
                <div class="space-y-3 text-left text-xs">
                    <div class="p-3 rounded border ${res.accepted ? 'bg-emerald-50 border-emerald-300 text-emerald-950' : 'bg-rose-50 border-rose-300 text-rose-950'}">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="text-base">${res.accepted ? '✅' : '❌'}</span>
                            <h4 class="font-black text-sm uppercase">${res.accepted ? 'Agreed to Switch!' : 'Refused Position Change'}</h4>
                        </div>
                        <p class="italic text-[11px] leading-relaxed mb-2">${res.quote}</p>
                    </div>

                    <div class="bg-slate-50 border border-slate-200 p-2 rounded">
                        <span class="font-bold text-[10px] uppercase text-slate-500 block mb-1">Conversation Factors:</span>
                        <ul class="text-[11px] font-mono space-y-0.5 text-slate-700">
                            ${res.reasons.map(r => `<li>• ${r}</li>`).join('')}
                        </ul>
                    </div>

                    ${res.canPersuade && tokens > 0 ? `
                    <div class="p-2 bg-blue-50 border border-blue-200 rounded text-blue-900 flex justify-between items-center">
                        <span>He's on the fence. Offer 1 Favor Token (candy/bike bribe) to convince him?</span>
                        <button class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1 rounded text-[10px] uppercase" onclick="app.persuadePosition('${p.id}', '${targetPos}')">Persuade (1🪙)</button>
                    </div>` : ''}
                </div>
            `;

            if (res.accepted) {
                Game.rebuildDepthChartFromOrder(gameState.playerTeam);
                Game.saveGameState();
                UI.renderDashboard(gameState);
            }

            UI.showModal("Conversation Outcome", resultHtml, null, null, null, "Close Chat");
        }, "Pitch Position Change");
    },

    persuadePosition: (playerId, targetPos) => {
        const p = Game.getPlayer(playerId);
        const res = Game.discussPositionChange(p, targetPos, gameState.playerTeam, true);
        if (res.accepted) {
            Game.rebuildDepthChartFromOrder(gameState.playerTeam);
            Game.saveGameState();
            UI.renderDashboard(gameState);
            alert(`🤝 Persuaded!\n\n${res.quote}\n\n${p.name} is now practicing at ${targetPos}!`);
            UI.hideModal();
        }
    },

    advanceOffseasonFADay: () => {
        const currentDay = UI.getOffseasonFADay();
        const userBids = UI.getOffseasonFABids();
        const result = Game.processOffseasonFADay(gameState, userBids);
        const { daySignings, userBidResults, rejectedBids } = result;

        // REPORT 4: Record Day Activity (Contested vs Uncontested signings, tokens spent)
        debugCollector.recordOffseasonDay(currentDay, result);
        const wireList = document.getElementById('fa-daily-wire-list');
        if (wireList) {
            let feedbackHtml = '';

            // 1. Highlight user bid outcomes prominently
            if (userBidResults && userBidResults.length > 0) {
                feedbackHtml += `
                    <div class="mb-2 p-2 rounded bg-amber-50 border border-amber-300 space-y-1">
                        <span class="text-[9px] font-black uppercase text-amber-900 block tracking-wider">Your Offer Results (Day ${currentDay}):</span>
                        ${userBidResults.map(r => `
                            <div class="text-[11px] font-bold ${r.won ? 'text-emerald-700' : 'text-rose-700'}">
                                ${r.message}
                            </div>
                        `).join('')}
                    </div>
                `;
            }

            // 2. League-wide signings for this day
            const signingsHtml = daySignings.map(s => `
                <div class="bg-slate-50 border p-1.5 rounded text-[11px] ${s.userWon ? 'border-emerald-300 bg-emerald-50/50 font-bold' : ''}">
                    <span class="font-bold text-slate-900">${s.player.name}</span> signed with <b class="text-blue-700">${s.team.name}</b>
                    ${s.tokens > 0 ? `<span class="text-[9px] text-amber-600 font-mono">(${s.tokens}🪙)</span>` : ''}
                    ${s.runnerUp ? `<span class="text-slate-400 block text-[9px] font-normal">(Chose over ${s.runnerUp.name})</span>` : ''}
                </div>
            `).join('') || '<p class="text-slate-400 italic text-[11px]">No signings reached consensus today.</p>';

            wireList.innerHTML = `<div class="font-bold text-[10px] text-slate-700 border-b pb-0.5 mb-1 uppercase tracking-wider">Day ${currentDay} Signings & Wire</div>` + feedbackHtml + signingsHtml;
        }

        if (currentDay >= 3) {
            // Day 3 concluded: Update button and display recap modal
            const advanceBtn = document.getElementById('fa-advance-day-btn');
            if (advanceBtn) {
                advanceBtn.textContent = "🏆 Proceed to Season Kickoff (Week 1) →";
                advanceBtn.className = "bg-blue-700 hover:bg-blue-800 text-white font-black px-4 py-2 rounded text-xs uppercase tracking-wider shadow-md animate-pulse";
                advanceBtn.onclick = () => window.app.finishOffseasonFAMinigame();
            }

            const mySignings = (daySignings || []).filter(s => s.userWon);
            const recapHtml = `
                <div class="space-y-3 text-left text-xs">
                    <p class="text-slate-700 leading-relaxed">
                        Free Agency has concluded! Your front office has finished recruitment before Week 1.
                    </p>
                    <div class="p-3 bg-slate-50 border border-slate-200 rounded space-y-1">
                        <span class="font-black text-slate-900 block text-xs uppercase">Your Final Roster Count</span>
                        <p class="font-bold text-emerald-700 text-sm">${gameState.playerTeam.roster.length} / 18 Players Under Contract</p>
                        <p class="text-[11px] text-slate-500 font-mono">Favor Tokens Remaining: ${gameState.playerTeam.socialProfile?.favorTokens || 0}</p>
                    </div>
                </div>
            `;
            UI.showModal("Free Agency Concluded", recapHtml, () => {
                window.app.finishOffseasonFAMinigame();
            }, "Proceed to Kickoff");
        } else {
            UI.incrementOffseasonFADay();
            UI.clearOffseasonFABids();
            UI.renderOffseasonFAScreen(gameState);
        }
    },

    setSnackPlan: (planKey) => {
        const gs = Game.getGameState();
        const team = gs?.playerTeam;
        if (!team) return;
        if (!team.finances) team.finances = { balance: 10.00, waivedDues: [], autoSnack: 'none' };
        
        team.finances.autoSnack = planKey;
        Game.saveGameState(activeSaveKey);
        window.app.renderStoreTab(gs);
    },

    buyStoreItem: (item, cost) => {
        const gs = Game.getGameState();
        const team = gs?.playerTeam;
        if (!team) return;
        if (!team.finances) team.finances = { balance: 10.00, waivedDues: [], autoSnack: 'none' };

        if (team.finances.balance < cost) {
            alert(`You don't have enough money in the Snack Fund! (Need $${cost.toFixed(2)})`);
            return;
        }

        if (item === 'token') {
            team.finances.balance -= cost;
            team.socialProfile.favorTokens = (team.socialProfile.favorTokens || 0) + 1;
            alert("🎟️ Bought 1 Favor Token for recruiting!");
        } 

        Game.saveGameState(activeSaveKey);
        window.app.renderStoreTab(gs);
    },

    waivePlayerDues: (playerId) => {
        const gs = Game.getGameState();
        const team = gs?.playerTeam;
        if (!team || !team.finances) return;
        
        if (!team.finances.waivedDues.includes(playerId)) {
            team.finances.waivedDues.push(playerId);
            // Waiving fees loses you street cred!
            if (team.socialProfile) {
                team.socialProfile.streetCred = Math.max(0, (team.socialProfile.streetCred || 50) - 2);
            }
            Game.saveGameState();
            window.app.renderStoreTab(gs);
        }
    },

    renderStoreTab: (gameState) => {
        const team = gameState?.playerTeam;
        if (!team) return;
        if (!team.finances) team.finances = { balance: 10.00, waivedDues: [], autoSnack: 'none' };
        
        const autoSnack = team.finances.autoSnack || 'none';
        const pane = document.getElementById('fo-pane-finances');
        if (!pane) return;

        pane.innerHTML = `
            <div class="p-4 border-b bg-white shrink-0 sticky top-0 z-10 shadow-sm flex justify-between items-center">
                <div>
                    <h3 class="text-xl font-bold text-slate-800 uppercase tracking-wider">The Corner Store</h3>
                    <p class="text-xs text-slate-500">Manage the Snack Fund, buy recruiting bribes, and set auto-snack plans.</p>
                </div>
                <div class="text-right bg-emerald-900 text-white px-4 py-2 rounded-sm shadow-inner">
                    <span class="text-[10px] uppercase font-bold text-emerald-300 block tracking-widest">Snack Fund Balance</span>
                    <span class="text-2xl font-black font-mono">$${team.finances.balance.toFixed(2)}</span>
                </div>
            </div>
            <div class="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                
                <!-- PURCHASABLE UPGRADES & PLANS -->
                <div class="bg-white rounded-sm border border-slate-300 shadow-sm p-4 flex flex-col">
                    <div class="mb-4">
                        <h4 class="font-black text-sm uppercase text-slate-800 mb-2 border-b pb-1">One-Time Purchases</h4>
                        <div class="flex justify-between items-center bg-slate-50 p-2 border border-slate-200 rounded">
                            <div>
                                <span class="font-bold text-sm">🎟️ Buy Favor Token</span>
                                <p class="text-[10px] text-slate-500">Add 1 Favor Token to your recruiting budget.</p>
                            </div>
                            <button class="bg-emerald-600 text-white font-bold px-3 py-1.5 rounded text-xs hover:bg-emerald-700 shadow" onclick="app.buyStoreItem('token', 3.00)">$3.00</button>
                        </div>
                    </div>

                    <div class="flex-grow">
                        <div class="flex justify-between items-end mb-2 border-b pb-1">
                            <h4 class="font-black text-sm uppercase text-slate-800">Weekly Snack Plan</h4>
                            <span class="text-[9px] font-bold text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded uppercase">Auto-Billed After Games</span>
                        </div>
                        <div class="space-y-2">
                            <!-- None -->
                            <div class="flex justify-between items-center p-2 border rounded cursor-pointer transition ${autoSnack === 'none' ? 'bg-slate-100 border-slate-400 shadow-sm' : 'bg-white border-slate-200 hover:border-slate-300'}" onclick="app.setSnackPlan('none')">
                                <div><span class="font-bold text-sm text-slate-700">🚫 Nothing</span><p class="text-[10px] text-slate-500">Save your money.</p></div>
                                <div class="w-4 h-4 rounded-full border border-slate-400 flex items-center justify-center">${autoSnack === 'none' ? '<div class="w-2 h-2 bg-slate-700 rounded-full"></div>' : ''}</div>
                            </div>
                            
                            <!-- Oranges -->
                            <div class="flex justify-between items-center p-2 border rounded cursor-pointer transition ${autoSnack === 'orange' ? 'bg-orange-50 border-orange-400 shadow-sm' : 'bg-white border-slate-200 hover:border-slate-300'}" onclick="app.setSnackPlan('orange')">
                                <div><span class="font-bold text-sm text-orange-900">🍊 Orange Slices ($2.00/wk)</span><p class="text-[10px] text-orange-700">Recovers 10% fatigue for roster.</p></div>
                                <div class="w-4 h-4 rounded-full border border-slate-400 flex items-center justify-center">${autoSnack === 'orange' ? '<div class="w-2 h-2 bg-orange-600 rounded-full"></div>' : ''}</div>
                            </div>

                            <!-- Capri Sun -->
                            <div class="flex justify-between items-center p-2 border rounded cursor-pointer transition ${autoSnack === 'caprisun' ? 'bg-blue-50 border-blue-400 shadow-sm' : 'bg-white border-slate-200 hover:border-slate-300'}" onclick="app.setSnackPlan('caprisun')">
                                <div><span class="font-bold text-sm text-blue-900">🧃 Capri Suns ($6.00/wk)</span><p class="text-[10px] text-blue-700">Recovers 30% fatigue for roster.</p></div>
                                <div class="w-4 h-4 rounded-full border border-slate-400 flex items-center justify-center">${autoSnack === 'caprisun' ? '<div class="w-2 h-2 bg-blue-600 rounded-full"></div>' : ''}</div>
                            </div>

                            <!-- Pizza Party -->
                            <div class="flex justify-between items-center p-2 border rounded cursor-pointer transition ${autoSnack === 'pizza' ? 'bg-rose-50 border-rose-400 shadow-sm' : 'bg-white border-slate-200 hover:border-slate-300'}" onclick="app.setSnackPlan('pizza')">
                                <div><span class="font-bold text-sm text-rose-900">🍕 Pizza Party ($25.00/wk)</span><p class="text-[10px] text-rose-700">Maxes happiness and clears rivalries.</p></div>
                                <div class="w-4 h-4 rounded-full border border-slate-400 flex items-center justify-center">${autoSnack === 'pizza' ? '<div class="w-2 h-2 bg-rose-600 rounded-full"></div>' : ''}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- WAIVE DUES MANAGEMENT -->
                <div class="bg-white rounded-sm border border-slate-300 shadow-sm p-4 flex flex-col h-[450px]">
                    <div class="mb-2 border-b pb-2">
                        <h4 class="font-black text-sm uppercase text-slate-800">Weekly Dues Management</h4>
                        <p class="text-[10px] text-slate-500 mt-1">Players pay $1.00/wk. Waiving fees boosts loyalty and happiness but costs you -2 Street Cred (looks soft).</p>
                    </div>
                    <div class="overflow-y-auto flex-grow space-y-1">
                        ${Game.getUIRosterObjects(team).map(p => {
                            const isWaived = (team.finances.waivedDues || []).includes(p.id);
                            return `
                            <div class="flex justify-between items-center bg-slate-50 p-1.5 rounded border border-slate-200">
                                <span class="font-bold text-xs truncate max-w-[120px]">${p.name}</span>
                                ${isWaived 
                                    ? `<span class="text-[9px] bg-emerald-100 text-emerald-800 font-bold px-2 py-1 rounded">Dues Waived</span>`
                                    : `<button class="text-[9px] bg-slate-900 text-white font-bold px-2 py-1 rounded hover:bg-slate-700 transition" onclick="app.waivePlayerDues('${p.id}')">Waive $1.00</button>`
                                }
                            </div>`;
                        }).join('')}
                    </div>
                </div>

            </div>
        `;
    },

    finishOffseasonFAMinigame: () => {
        finishOffseasonFAMinigame();
    },

    negotiatePlayer: (id) => {
        app.openBidModal(id);
    },
    handleSaveTestRoster,
    openPlayerCard,
    handleDraftPlayer,
    onDraftSelect: handlePlayerSelectInDraft,
    setCaptain: handleSetCaptain,
    handleAdvanceWeek,
    handleGoToNextDraft,
    skipSim: () => skipLiveGameSim(),
    setSpeed: (s) => setSimSpeed(s),
    switchTab: (tabId) => {
        gameState = Game.getGameState();
        if (gameState) UI.switchTab(tabId, gameState);
    },
    autoFillRoster: () => {
        gameState = Game.getGameState();
        if (!gameState?.playerTeam) return;
        const count = Game.autoFillTeamWalkOns(gameState.playerTeam, 14);
        Game.saveGameState(activeSaveKey);
        renderDashboard(gameState);
        alert(`Signed ${count} walk-on prospect(s) from the park! Roster now at ${gameState.playerTeam.roster.length} players.`);
    },
    cutPlayer: (id) => {
        if (confirm("Cut this player?")) {
            Game.playerCut(id);
            UI.hideModal();
            gameState = Game.getGameState();
            UI.switchTab('my-team', gameState);
            
            // Re-evaluate if we have met the cut-down limit
            if (gameState.currentWeek === 0 && window.checkUserRosterLimit) {
                window.checkUserRosterLimit();
            }
        }
    }
};

window.app_toggleWatchlist = (id) => UI.toggleWatchlistPlayer(id);

window.app_updateClipboard = (field, value) => {
    const gs = Game.getGameState();
    const team = gs?.playerTeam;
    if (!team || !team.gameplan || !team.gameplan.situational) return;
    
    team.gameplan.situational[field] = (value === 'GM' || value === 'COACH') ? value : parseInt(value, 10);
    
    // Auto-update Coach UI context if delegating
    if (field === 'playcaller' && value === 'COACH') {
        Game.aiSetSituationalGameplan(team);
    }
    
    // Call via the UI namespace since the function is defined in ui.js
    if (field === 'playcaller') {
        UI.renderPlaybookManager(gs);
    } else {
        // Update the textual clash warning dynamically
        const clash = Game.calculateSchemeClash(team);
        const warnEl = document.getElementById('clipboard-clash-warning');
        if (warnEl) {
            if (clash === 0) warnEl.innerHTML = `<span class="text-emerald-600 font-bold">Coach is aligned with your gameplan.</span>`;
            else if (clash < 6) warnEl.innerHTML = `<span class="text-amber-600 font-bold">Coach is annoyed by your scheme (-${clash} IQ Penalty).</span>`;
            else warnEl.innerHTML = `<span class="text-rose-600 font-bold">Coach is furious! Kids are confused (-${clash} IQ Penalty).</span>`;
        }
    }
};

function openDebugReportModal(initialReport = 1) {
    let activeReport = initialReport;

    const renderModalContent = () => {
        const text = debugCollector.getReportText(activeReport);
        return `
            <div class="flex flex-col gap-3 text-xs">
                <div class="flex flex-wrap justify-between items-center gap-2 border-b border-slate-200 pb-2">
                    <!-- Tab Switcher -->
                    <div class="flex bg-slate-200 rounded p-0.5 text-xs font-bold font-mono">
                        <button class="debug-modal-tab px-2.5 py-1 rounded transition ${activeReport === 1 ? 'bg-slate-900 text-white shadow' : 'text-slate-600 hover:text-slate-900'}" data-rep="1">1. League</button>
                        <button class="debug-modal-tab px-2.5 py-1 rounded transition ${activeReport === 2 ? 'bg-slate-900 text-white shadow' : 'text-slate-600 hover:text-slate-900'}" data-rep="2">2. History</button>
                        <button class="debug-modal-tab px-2.5 py-1 rounded transition ${activeReport === 3 ? 'bg-slate-900 text-white shadow' : 'text-slate-600 hover:text-slate-900'}" data-rep="3">3. Draft</button>
                        <button class="debug-modal-tab px-2.5 py-1 rounded transition ${activeReport === 4 ? 'bg-slate-900 text-white shadow' : 'text-slate-600 hover:text-slate-900'}" data-rep="4">4. Offseason</button>
                        <button class="debug-modal-tab px-2.5 py-1 rounded transition ${activeReport === 'all' ? 'bg-slate-900 text-white shadow' : 'text-slate-600 hover:text-slate-900'}" data-rep="all">All</button>
                    </div>
                    <!-- Copy Button -->
                    <button id="copy-debug-report-btn" class="bg-slate-900 hover:bg-slate-800 text-amber-400 border border-slate-700 font-mono px-3 py-1.5 rounded transition shadow-sm font-bold text-xs flex items-center gap-1.5">
                        <span>📋</span>
                        <span id="copy-debug-label">Copy to Clipboard</span>
                    </button>
                </div>
                <pre id="debug-report-pre" class="bg-slate-950 text-emerald-400 p-4 rounded text-[11px] font-mono overflow-auto max-h-[60vh] select-all whitespace-pre-wrap leading-relaxed border border-slate-800 shadow-inner">${text}</pre>
            </div>
        `;
    };

    const bindModalEvents = () => {
        document.querySelectorAll('.debug-modal-tab').forEach(btn => {
            btn.onclick = () => {
                const repVal = btn.dataset.rep;
                activeReport = repVal === 'all' ? 'all' : parseInt(repVal, 10);
                const body = document.getElementById('modal-body');
                if (body) {
                    body.innerHTML = renderModalContent();
                    bindModalEvents();
                }
            };
        });

        document.getElementById('copy-debug-report-btn')?.addEventListener('click', () => {
            const text = debugCollector.getReportText(activeReport);
            navigator.clipboard.writeText(text).then(() => {
                const label = document.getElementById('copy-debug-label');
                if (label) label.textContent = 'Copied!';
                setTimeout(() => { if (label) label.textContent = 'Copy to Clipboard'; }, 2000);
            });
        });
    };

    UI.showModal("Diagnostic Reports Viewer", renderModalContent());
    bindModalEvents();
}

function main() {
    UI.setupElements();
    Game.loadGameState();
    gameState = Game.getGameState();

    // Startup Debug Mode Checkbox & Diagnostics Bar Handling
    const startupCheckbox = document.getElementById('startup-debug-mode');
    const diagnosticsBar = document.getElementById('debug-diagnostics-bar');

    function syncDebugUI(enabled) {
        if (startupCheckbox) startupCheckbox.checked = enabled;
        if (diagnosticsBar) diagnosticsBar.classList.toggle('hidden', !enabled);
    }

    startupCheckbox?.addEventListener('change', (e) => {
        setDebugMode(e.target.checked);
        syncDebugUI(e.target.checked);
    });

    syncDebugUI(isDebugMode());

    // Report Viewer Button Handlers
    document.querySelectorAll('.open-debug-report-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const rep = btn.dataset.report;
            openDebugReportModal(rep === 'all' ? 'all' : parseInt(rep, 10));
        });
    });

    // Front Office Sub-Tab Listeners
    document.querySelectorAll('.fo-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.fo-tab').forEach(b => {
                b.classList.remove('active', 'bg-slate-900', 'text-white', 'shadow-sm');
                b.classList.add('text-slate-600');
            });
            
            btn.classList.add('active', 'bg-slate-900', 'text-white', 'shadow-sm');
            btn.classList.remove('text-slate-600');
            
            document.querySelectorAll('.fo-sub-pane').forEach(p => p.classList.add('hidden'));
            document.getElementById(`fo-pane-${btn.dataset.subTab}`)?.classList.remove('hidden');
            
            if (gameState) {
                if (btn.dataset.subTab === 'staff') UI.renderStaffTab(gameState);
                if (btn.dataset.subTab === 'finances') window.app.renderStoreTab(gameState);
                if (btn.dataset.subTab === 'social') renderSocialNetworkTab(gameState);
            }
        });
    });

    // League Hub Sub-Tab Listeners
    document.querySelectorAll('.league-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.league-tab').forEach(b => {
                b.classList.remove('active', 'bg-slate-900', 'text-white', 'shadow-sm');
                b.classList.add('text-slate-600');
            });
            
            btn.classList.add('active', 'bg-slate-900', 'text-white', 'shadow-sm');
            btn.classList.remove('text-slate-600');
            
            document.querySelectorAll('.league-sub-pane').forEach(p => p.classList.add('hidden'));
            document.getElementById(`league-pane-${btn.dataset.subTab}`)?.classList.remove('hidden');
            
            if (gameState) {
                if (btn.dataset.subTab === 'standings') UI.renderStandingsTab(gameState);
                if (btn.dataset.subTab === 'schedule') UI.renderScheduleTab(gameState);
                if (btn.dataset.subTab === 'player-stats') UI.renderPlayerStatsTab(gameState);
                if (btn.dataset.subTab === 'history') UI.renderHistoryTab(gameState);
                if (btn.dataset.subTab === 'hall-of-fame') UI.renderHallOfFameTab(gameState);
            }
        });
    });

    document.getElementById('start-game-btn')?.addEventListener('click', startNewGame);
    document.getElementById('load-game-btn')?.addEventListener('click', () => handleLoadGame());
    document.getElementById('load-test-roster-btn')?.addEventListener('click', handleLoadTestRoster);
    document.getElementById('save-test-roster-btn')?.addEventListener('click', handleSaveTestRoster);
    document.getElementById('draft-player-btn')?.addEventListener('click', handleDraftPlayer);
    document.getElementById('advance-week-btn')?.addEventListener('click', handleAdvanceWeek);
    document.getElementById('dashboard-tabs')?.addEventListener('click', handleTabSwitch);
    document.getElementById('go-to-next-draft-btn')?.addEventListener('click', handleGoToNextDraft);

    // Debug Mode Toggle
    const debugModeBtn = document.getElementById('sim-debug-mode-btn');
    const debugModeLabel = document.getElementById('sim-debug-mode-label');

    function refreshDebugModeButton() {
        if (!debugModeBtn || !debugModeLabel) return;

        const enabled = isDebugMode();

        debugModeLabel.textContent = enabled ? 'Debug ON' : 'Debug OFF';
        debugModeBtn.setAttribute('aria-pressed', String(enabled));
        debugModeBtn.title = enabled
            ? 'Developer diagnostics enabled'
            : 'Developer diagnostics disabled';

        debugModeBtn.classList.toggle('text-amber-300', enabled);
        debugModeBtn.classList.toggle('text-gray-400', !enabled);
        debugModeBtn.classList.toggle('border-amber-500', enabled);
        debugModeBtn.classList.toggle('border-gray-700', !enabled);
    }

    debugModeBtn?.addEventListener('click', () => {
        setDebugMode(!isDebugMode());
        refreshDebugModeButton();
    });

    // Initialize the button from the saved setting.
    refreshDebugModeButton();

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
        gameState = Game.getGameState();
        if (gameState) UI.renderPlayerStatsTab(gameState);
    });

    document.getElementById('stats-filter-league')?.addEventListener('change', () => {
        gameState = Game.getGameState();
        if (gameState) UI.renderPlayerStatsTab(gameState);
    });

    document.getElementById('stats-sort')?.addEventListener('change', () => {
        gameState = Game.getGameState();
        if (gameState) UI.renderPlayerStatsTab(gameState);
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
