// js/main.js
import * as Game from './game.js';
import * as UI from './ui.js';
import {
    recordTeamGamePlanningOutcome
} from './game/play_resolution.js';
import { isDebugMode, setDebugMode, debugCollector } from './game.js';
import { positionOverallWeights, estimateBestPosition, calculateOverall } from './game/player.js';
import { gmBackgrounds, gmArchetypes, footballExpertises, offenseFormations, defenseFormations } from './data.js';
import { formatHeight } from './utils.js';
import {
    getCurrentRosterLimit,
    TEMPORARY_HELP_THRESHOLD,
    processSeasonStartDues
} from './game/season.js';
import {
    initializeInheritedScoutingReports,
    recordScoutingReportOutcome
} from './game/scouting.js';

let gameState = null;
let selectedPlayerId = null;
let currentSortColumn = 'potential';
let currentSortDirection = 'desc';
let activeSaveKey = 'backyardFootballGameState';
let isDraftingLocked = false;

let isExitInterviewFlowActive = false;
let renderActiveExitInterview = null;

const getDraftRosterLimit = () => getCurrentRosterLimit(gameState);
const MIN_HEALTHY_PLAYERS = 8;
const WEEKS_IN_SEASON = 9;

const OFFENSIVE_POSITION_FITS = ['QB', 'RB', 'WR', 'TE', 'OL'];
const DEFENSIVE_POSITION_FITS = ['DL', 'LB', 'DB'];

function getBestPositionFit(player, positions) {
    if (!player) return { position: '—', ovr: 0 };

    const supportedPositions = positions.filter(position =>
        positionOverallWeights[position]
    );

    const viablePositions = supportedPositions.filter(position =>
        Game.isPlayerViableForPosition(player, position)
    );

    const positionsToEvaluate = viablePositions.length > 0
        ? viablePositions
        : supportedPositions;

    const ratings = positionsToEvaluate.map(position => ({
        position,
        ovr: Game.calculateOverall(player, position)
    }));

    ratings.sort((a, b) => b.ovr - a.ovr);

    return ratings[0] || { position: '—', ovr: 0 };
}

function getBestTwoWayFits(player) {
    return {
        offense: getBestPositionFit(player, OFFENSIVE_POSITION_FITS),
        defense: getBestPositionFit(player, DEFENSIVE_POSITION_FITS)
    };
}

function getTwoWayFitScore(player) {
    const fits = getBestTwoWayFits(player);
    return (fits.offense.ovr + fits.defense.ovr) / 2;
}

function renderTwoWayFitsHtml(fits, stacked = false) {
    const layoutClass = stacked
        ? 'flex flex-col items-end gap-0.5'
        : 'inline-flex flex-wrap items-center gap-2';
    return `
        <span class="${layoutClass}">
            <span class="text-emerald-700 font-bold whitespace-nowrap">
                OFF ${fits.offense.position} ${fits.offense.ovr}
            </span>
            <span class="text-blue-700 font-bold whitespace-nowrap">
                DEF ${fits.defense.position} ${fits.defense.ovr}
            </span>
        </span>`;
}

function getPickTimeScoutingSnapshot(player, team) {
    const report = Game.getTeamScoutingReport?.(team, player.id) || null;
    const evaluation = report?.evaluation || {};

    const getFit = fit => {
        if (
            !fit ||
            !Number.isFinite(fit.low) ||
            !Number.isFinite(fit.high)
        ) {
            return {
                position: null,
                low: null,
                high: null,
                ovr: null
            };
        }

        return {
            position: fit.position,
            low: fit.low,
            high: fit.high,
            ovr: Math.round((fit.low + fit.high) / 2)
        };
    };

    const offense = getFit(evaluation.offenseFit);
    const defense = getFit(evaluation.defenseFit);
    const fitRatings = [offense.ovr, defense.ovr]
        .filter(Number.isFinite);
    const overall = fitRatings.length > 0
        ? Math.round(
            fitRatings.reduce((sum, rating) => sum + rating, 0) /
            fitRatings.length
        )
        : null;

    const potentialRange = report?.potentialRange || null;
    const potential = potentialRange
        ? potentialRange.bestPossible === potentialRange.worstPossible
            ? potentialRange.bestPossible
            : `${potentialRange.bestPossible}–${potentialRange.worstPossible}`
        : null;

    return {
        // Keep the legacy fields for older history renderers and saves.
        pos: offense.position || player.pos || '—',
        ovr: overall,
        potential,

        // New fields preserve the evaluation available at draft time.
        listedPosition: player.pos || null,
        offFitPosition: offense.position,
        offFitLow: offense.low,
        offFitHigh: offense.high,
        offFitOvr: offense.ovr,
        defFitPosition: defense.position,
        defFitLow: defense.low,
        defFitHigh: defense.high,
        defFitOvr: defense.ovr,
        scoutingLevel: Number.isInteger(report?.level)
            ? report.level
            : 0,
        scoutingConfidence: Number.isFinite(report?.confidence)
            ? report.confidence
            : null
    };
}

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
                .sort((a, b) => getTwoWayFitScore(b) - getTwoWayFitScore(a))
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
                        ${topPlayers.map(p => {
                            const fits = getBestTwoWayFits(p);

                            return `
                                <div class="flex justify-between items-center gap-2 text-xs">
                                    <span class="font-semibold text-slate-800 truncate">
                                        ${p.name}
                                    </span>
                                    <span class="shrink-0">
                                        ${renderTwoWayFitsHtml(fits, true)}
                                    </span>
                                </div>
                            `;
                        }).join('')}
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

    const coachSkillBudget = 330;
    const coachSkillValues = [35, 40, 45, 50, 55, 60, 65, 70, 75, 80];

    const coachSkillDefinitions = [
        { id: 'offense', label: 'Offense Scheme', keys: ['offSchemeMastery'] },
        { id: 'defense', label: 'Defense Scheme', keys: ['defSchemeMastery'] },
        { id: 'evaluation', label: 'Player Evaluation', keys: ['evalPhysicals', 'evalTechnique', 'evalCharacter'] },
        { id: 'teaching', label: 'Teaching', keys: ['teaching'] },
        { id: 'planning', label: 'Game Planning', keys: ['gameplanInstinct', 'inGameAdjustments'] },
        { id: 'practice', label: 'Practice & Conditioning', keys: ['practiceDiscipline', 'conditioning'] }
    ];

    const coachSkillControlsHtml =
        '<div class="border-t border-slate-200 pt-4">' +
        '<label class="block text-xs font-bold text-slate-800 uppercase mb-1">' +
        '4. Coaching Skill Allocation</label>' +
        '<p class="text-xs text-slate-600 mb-3">' +
        'Build your strengths and weaknesses using a shared budget.' +
        '</p>' +
        '<div class="flex justify-between bg-slate-900 text-white rounded px-3 py-2 mb-3">' +
        '<span class="text-xs font-bold uppercase">Skill Budget</span>' +
        '<span id="new-coach-skill-total" class="text-sm font-black">330 / 330</span>' +
        '</div>' +
        '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
        coachSkillDefinitions.map(function (skill) {
            return '<label class="block rounded border border-slate-200 bg-slate-50 p-3">' +
                '<span class="flex items-center justify-between gap-2 text-xs font-bold text-slate-800 mb-3">' +
                '<span>' + skill.label + '</span>' +
                '<output id="new-coach-skill-value-' + skill.id + '"' +
                ' class="text-base font-black text-slate-900 tabular-nums">55</output>' +
                '</span>' +
                '<input type="range"' +
                ' id="new-coach-skill-' + skill.id + '"' +
                ' min="20" max="80" step="1" value="55"' +
                ' class="w-full accent-amber-500 cursor-pointer">' +
                '<span class="flex justify-between text-[10px] text-slate-500 mt-1">' +
                '<span>20 · Developing</span>' +
                '<span>80 · Elite</span>' +
                '</span></label>';
        }).join('') +
        '</div>' +
        '<p class="text-xs text-slate-500 mt-2">' +
        'Skills range from 20 to 80. Lower one to free points for another.' +
        '</p></div>';

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
             <!-- COACH_SKILL_ALLOCATION_BLOCK -->
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

    const modalHtmlWithSkills = modalHtml.replace(
        '<!-- COACH_SKILL_ALLOCATION_BLOCK -->',
        coachSkillControlsHtml
    );

    UI.showModal("Build Your Football Identity", modalHtmlWithSkills, () => {
        const name = document.getElementById('new-coach-name').value.trim() || 'GM';

        const backgroundId = document.getElementById('new-gm-background').value;
        const archetypeId = document.getElementById('new-gm-archetype').value;
        const expertiseId = document.getElementById('new-gm-expertise').value;
        const off = document.getElementById('new-coach-offense').value;
        const def = document.getElementById('new-coach-defense').value;

        const skillRatings = {};

        coachSkillDefinitions.forEach(skill => {
            const control = document.getElementById(
                'new-coach-skill-' + skill.id
            );

            const value = Number(control?.value ?? 55);

            skill.keys.forEach(key => {
                skillRatings[key] = value;
            });
        });

        confirmFranchiseTakeover(teamId, {
            name,
            backgroundId,
            archetypeId,
            expertiseId,
            off,
            def,
            skillRatings
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

    const coachSkillControls = coachSkillDefinitions
        .map(skill =>
            document.getElementById('new-coach-skill-' + skill.id)
        )
        .filter(Boolean);

    const updateCoachSkillBudget = () => {
        const total = coachSkillControls.reduce(
            (sum, control) => sum + Number(control.value || 0),
            0
        );

        const totalElement = document.getElementById(
            'new-coach-skill-total'
        );

        if (totalElement) {
            totalElement.textContent =
                total + ' / ' + coachSkillBudget;

            totalElement.classList.toggle(
                'text-rose-300',
                total > coachSkillBudget
            );
        }

        coachSkillControls.forEach(control => {
            const currentValue = Number(control.value || 20);

            const otherSkillsTotal = coachSkillControls.reduce(
                (sum, otherControl) =>
                    otherControl !== control
                        ? sum + Number(otherControl.value || 0)
                        : sum,
                0
            );

            // Prevent this slider from exceeding the remaining budget.
            control.max = String(
                Math.max(
                    20,
                    Math.min(80, coachSkillBudget - otherSkillsTotal)
                )
            );

            const skillId = control.id.replace(
                'new-coach-skill-',
                ''
            );

            const valueOutput = document.getElementById(
                'new-coach-skill-value-' + skillId
            );

            if (valueOutput) {
                valueOutput.textContent = String(currentValue);
            }
        });
    };

    coachSkillControls.forEach(control => {
        control.addEventListener('input', updateCoachSkillBudget);
    });

    updateChoiceSummaries();
    updateCoachSkillBudget();
}

function confirmFranchiseTakeover(teamId, coachDetails) {
    const team = gameState.teams.find(t => t.id === teamId);
    if (!team) return;

    const MIN_COACH_SKILL = 20;
    const MAX_COACH_SKILL = 80;

    const coachSkillGroups = [
        { source: 'offSchemeMastery', keys: ['offSchemeMastery'] },
        { source: 'defSchemeMastery', keys: ['defSchemeMastery'] },
        {
            source: 'evalPhysicals',
            keys: ['evalPhysicals', 'evalTechnique', 'evalCharacter']
        },
        { source: 'teaching', keys: ['teaching'] },
        {
            source: 'gameplanInstinct',
            keys: ['gameplanInstinct', 'inGameAdjustments']
        },
        {
            source: 'practiceDiscipline',
            keys: ['practiceDiscipline', 'conditioning']
        }
    ];

    const requestedSkills = coachDetails?.skillRatings || {};
    const validatedSkillRatings = {};
    let skillBudgetTotal = 0;

    for (const group of coachSkillGroups) {
        const value = Number(requestedSkills[group.source] ?? 55);

        if (
            !Number.isInteger(value) ||
            value < MIN_COACH_SKILL ||
            value > MAX_COACH_SKILL
        ) {
            UI.showModal(
                'Invalid Coach Build',
                'Every coaching skill must be between 20 and 80.'
            );
            return;
        }

        skillBudgetTotal += value;

        group.keys.forEach(key => {
            validatedSkillRatings[key] = value;
        });
    }

    if (skillBudgetTotal > 330) {
        UI.showModal(
            'Skill Budget Exceeded',
            `Your coach uses ${skillBudgetTotal} points. The maximum is 330. Lower one or more skills and try again.`
        );
        return;
    }

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

    // Initialize the flexible coaching group after the GM profile is saved.
    Game.ensureTeamCoachingStaff(team);

    const userCoach = team.coaches?.find(
        coach => coach?.isUserCoach
    );

    if (userCoach) {
        const background = gmBackgrounds.find(
            item => item.id === coachDetails?.backgroundId
        ) || gmBackgrounds[0];

        const archetype = gmArchetypes.find(
            item => item.id === coachDetails?.archetypeId
        ) || gmArchetypes[0];

        const expertise = footballExpertises.find(
            item => item.id === coachDetails?.expertiseId
        ) || footballExpertises[0];

        // Apply the identity selected during coach creation.
        userCoach.name = coachDetails?.name || 'Coach';
        userCoach.preferredOffense = coachDetails?.off;
        userCoach.preferredDefense = coachDetails?.def;
        userCoach.backgroundId = background.id;
        userCoach.archetypeId = archetype.id;
        userCoach.expertiseId = expertise.id;
        userCoach.isUserCoach = true;

        // Apply the validated skill allocation.
        userCoach.ratings = {
            ...(userCoach.ratings || {}),
            ...validatedSkillRatings
        };

        // Preserve the complete profile for future management systems.
        team.userCoachProfile = userCoach;
    } else {
        console.error(
            'Coach creation: no user coaching profile was initialized.',
            team.id
        );
    }

    Game.ensureTeamStaffWorkPlan(team);

    // Initialize Year 5 Draft and reset all tracked stats for the new season.
    gameState.players.forEach(p => {
        p.seasonStats = {
            passYards: 0,
            passAttempts: 0,
            passCompletions: 0,
            interceptionsThrown: 0,
            rushYards: 0,
            rushAttempts: 0,
            recYards: 0,
            receptions: 0,
            targets: 0,
            drops: 0,
            tackles: 0,
            sacks: 0,
            interceptions: 0,
            fumbles: 0,
            fumblesLost: 0,
            fumblesRecovered: 0,
            touchdowns: 0,
            returnYards: 0,
            safeties: 0
        };
    });
    Game.setupDraft();

    const draftYear = Number.isInteger(gameState.year) ? gameState.year : 5;
    const draftWeek = Number.isInteger(gameState.currentWeek) ? gameState.currentWeek : 0;
    const incomingDraftClass = gameState.draftClass || [];

    for (const draftTeam of gameState.teams) {
        if (draftTeam.leagueType !== 'main') continue;

        initializeInheritedScoutingReports(
            draftTeam,
            incomingDraftClass,
            draftYear,
            draftWeek
        );
    }

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
        const rosterLimit = getDraftRosterLimit();
        const hasRoom = (gameState.playerTeam.roster?.length || 0) < rosterLimit;
        draftBtn.disabled = !(isMyTurn && hasRoom && player);
    }
}

function handleDraftPlayer() {
    if (!gameState || isDraftingLocked) return;
    if (selectedPlayerId) {
        const player = gameState.players.find(p => p.id === selectedPlayerId);
        const team = gameState.playerTeam;
        const rosterLimit = getDraftRosterLimit();

        if (!player || !team || !Array.isArray(team.roster)) {
            UI.showModal(
                "Player Unavailable",
                "<p>The selected player or your team could not be found.</p>"
            );
            return;
        }

        // Recheck turn ownership instead of trusting the disabled UI button.
        const currentPickingTeam =
            gameState.draftOrder?.[gameState.currentPick];

        if (currentPickingTeam?.id !== team.id) {
            UI.showModal(
                "Not Your Pick",
                "<p>It's not your turn to draft.</p>"
            );
            return;
        }

        // Every selection must belong to the current draft pool and remain
        // unassigned. Year 1 uses its separate inaugural-draft eligibility.
        const isOnDraftBoard =
            Array.isArray(gameState.draftClass) &&
            gameState.draftClass.some(
                prospect => prospect?.id === player.id && !prospect.teamId
            );

        if (!isOnDraftBoard || player.teamId) {
            UI.showModal(
                "Player Unavailable",
                "<p>This player is no longer available on the draft board.</p>"
            );
            return;
        }

        // From Year 2 onward, verify actual Pee Wee eligibility again.
        if (gameState.year > 1) {
            const entryAge = Number(player.youthEntryAge);
            const seasonsPlayed = Number(player.youthSeasonsPlayed);

            const youthHistory = Array.isArray(player.youthSeasonHistory)
                ? player.youthSeasonHistory
                : [];

            const documentedSeasonYears = new Set(
                youthHistory
                    .filter(season =>
                        season?.year != null &&
                        Number.isInteger(Number(season.year))
                    )
                    .map(season => Number(season.year))
            ).size;

            const requiredSeasons = 12 - entryAge;

            const isEligible =
                player.lifecycle === 'draft_eligible' &&
                Number.isInteger(Number(player.age)) &&
                Number(player.age) >= 12 &&
                Number.isInteger(entryAge) &&
                entryAge >= 8 &&
                entryAge <= 11 &&
                Number.isInteger(seasonsPlayed) &&
                seasonsPlayed >= requiredSeasons &&
                documentedSeasonYears >= requiredSeasons &&
                player.personality?.entersDraft !== false &&
                !['retired', 'departed', 'temporary'].includes(
                    player.status?.type
                );

            if (!isEligible) {
                UI.showModal(
                    "Ineligible Prospect",
                    "<p>This player does not meet the rookie-draft eligibility requirements.</p>"
                );
                return;
            }
        }

        if (team.roster.length >= rosterLimit) {
            UI.showModal("Roster Full", `<p>Your roster is full (${rosterLimit} players).</p>`);
            return;
        }

        if (player && Game.addPlayerToTeam(player, team)) {
            player.lifecycle = 'active';
            const gs = Game.getGameState();

            recordScoutingReportOutcome(
                team,
                player,
                gs,
                gs.year,
                gs.currentWeek
            );

            if (gs.draftClass) {
                gs.draftClass = gs.draftClass.filter(p => p.id !== player.id);
            }
            if (!gs.pickHistory) gs.pickHistory = [];

            const userPos = estimateBestPosition(player);
            const userOvr = Game.calculateOverall(player, userPos);
            const pickSnapshot = getPickTimeScoutingSnapshot(player, team);

            gs.pickHistory.push({
                pick: gs.currentPick + 1,
                teamName: team.name,
                teamId: team.id,
                playerName: player.name,
                ...pickSnapshot
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

    const rosterLimit = getDraftRosterLimit();

    try {
                while (true) {
            const pickLimitReached =
                gameState.currentPick >= gameState.draftOrder.length;

            // Only the actual draft pool determines whether the draft can continue.
            // Unrelated free agents must not keep an exhausted rookie draft running.
            const noDraftProspectsLeft =
                !Array.isArray(gameState.draftClass) ||
                !gameState.draftClass.some(
                    prospect => prospect && !prospect.teamId
                );

            const allTeamsFull = gameState.teams.every(
                t => !t || !t.roster || t.roster.length >= rosterLimit
            );

            if (pickLimitReached || noDraftProspectsLeft || allTeamsFull) {
                await handleDraftEnd();
                break;
            }

            let currentPickingTeam = gameState.draftOrder[gameState.currentPick];

            if (currentPickingTeam && currentPickingTeam.id === gameState.playerTeam.id) {
                if (gameState.playerTeam.roster.length >= rosterLimit) {
                    debugCollector.recordDraftSkip({
                        pick: gameState.currentPick + 1,
                        teamName: currentPickingTeam.name,
                        reason: 'Player team roster limit reached',
                        rosterSize: gameState.playerTeam.roster.length,
                        rosterLimit
                    });

                    gameState.currentPick++;
                    UI.renderSelectedPlayerCard(null, gameState);
                    continue;
                } else {
                    UI.renderDraftScreen(gameState, handlePlayerSelectInDraft, selectedPlayerId, currentSortColumn, currentSortDirection);
                    break;
                }
            }

            if (!currentPickingTeam || !currentPickingTeam.roster || currentPickingTeam.roster.length >= rosterLimit) {
                debugCollector.recordDraftSkip({
                    pick: gameState.currentPick + 1,
                    teamName: currentPickingTeam?.name || 'Unknown team',
                    reason: !currentPickingTeam
                        ? 'Missing team in draft order'
                        : !currentPickingTeam.roster
                            ? 'Missing roster array'
                            : 'Roster limit reached',
                    rosterSize: currentPickingTeam?.roster?.length ?? null,
                    rosterLimit: rosterLimit
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
                    recordScoutingReportOutcome(
                        currentPickingTeam,
                        picked,
                        gameState,
                        gameState.year,
                        gameState.currentWeek
                    );

                    const pickedPos = estimateBestPosition(picked);
                    const pickedOvr = Game.calculateOverall(picked, pickedPos);

                    if (!gameState.pickHistory) gameState.pickHistory = [];
                    const pickSnapshot = getPickTimeScoutingSnapshot(
                        picked,
                        currentPickingTeam
                    );

                    gameState.pickHistory.push({
                        pick: gameState.currentPick + 1,
                        teamName: currentPickingTeam.name,
                        teamId: currentPickingTeam.id,
                        playerName: picked.name,
                        ...pickSnapshot
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
                        rosterLimit
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
    // Mark summer FA complete so the hard 18-player limit activates
    gameState.offseasonFACompleted = true;

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
    } else {
        advBtn.innerHTML = `<span>Play Week 1</span>`;
        advBtn.className = 'btn bg-amber-500 hover:bg-amber-600 text-white font-bold py-2 px-6 rounded-sm text-sm uppercase tracking-wider transition shadow-sm border border-amber-600';
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
        UI.showModal(
            "Load Failed",
            `<p>Could not load saved game: ${error?.message || String(error)}</p>`,
            null,
            '',
            null,
            'Close'
        );
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
        player.activePromise = null;

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

        const fits = getBestTwoWayFits(player);
        const pos = fits.offense.position;
        const ovr = fits.offense.ovr;
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
                tokensOffered,
                completedWins: item.teamWins,
                completedLosses: item.teamLosses
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

            player.activePromise = Game.createPlayerPromise(
                player,
                team,
                {
                    role: rolePromised,
                    promiseType
                },
                {
                    promiseSeason: gameState.year,
                    source: 'exitInterview'
                }
            );

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

function showEmergencyFriendCallup(onContinue) {
    gameState = Game.getGameState();

    if (!gameState?.playerTeam) return;

    const team = gameState.playerTeam;

    const getActiveCount = () => Game.getRosterObjects(team).filter(p =>
        p && (
            p.status?.type === 'temporary' ||
            !p.status ||
            p.status.duration === 0
        )
    ).length;

    const continueFlow = () => {
        gameState = Game.getGameState();
        onContinue?.();
    };

    const activeCount = getActiveCount();

    // Emergency help is unnecessary once the team reaches 12 active players.
    if (activeCount >= TEMPORARY_HELP_THRESHOLD) {
        continueFlow();
        return;
    }

    const freeAgents = Array.isArray(gameState.freeAgents)
        ? gameState.freeAgents
        : [];

    const tokensAvailable = Math.max(
        0,
        Number(team.socialProfile?.favorTokens) || 0
    );

    // No available friends or Favor Tokens.
    if (freeAgents.length === 0 || tokensAvailable <= 0) {
        if (activeCount < MIN_HEALTHY_PLAYERS) {
            const reason = freeAgents.length === 0
                ? 'No connected friends are available to call.'
                : 'Your team has no Favor Tokens left to ask for help.';

            UI.showModal(
                "Warning: Short Roster",
                `<p>Your team has only ${activeCount} active players. You need at least ${MIN_HEALTHY_PLAYERS} to avoid forfeiting.</p><p>${reason}</p>`,
                continueFlow,
                "Proceed Anyway"
            );
        } else {
            continueFlow();
        }

        return;
    }

    const escapeHtml = value =>
        String(value ?? '').replace(/[&<>"']/g, character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[character]);

    const friendsHtml = freeAgents.map(player => {
        if (!player) return '';

        const bestPos = player.pos || estimateBestPosition(player);
        const ovr = Game.calculateOverall(player, bestPos);
        const connection = player.connectedBuddyName
            ? `Introduced through ${escapeHtml(player.connectedBuddyName)}`
            : 'Connected to your team network';

        return `
            <div class="flex items-center justify-between gap-3 p-2.5 bg-slate-50 border border-slate-200 rounded">
                <div class="min-w-0">
                    <p class="font-bold text-slate-900">${escapeHtml(player.name)}</p>
                    <p class="text-[11px] text-slate-600">${connection}</p>
                    <p class="text-[10px] text-slate-500">
                        ${escapeHtml(bestPos)} • ${ovr} OVR
                    </p>
                </div>
                <button
                    type="button"
                    data-player-id="${escapeHtml(player.id)}"
                    class="emergency-friend-call-btn shrink-0 bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-3 py-1.5 rounded text-xs"
                >
                    CALL
                </button>
            </div>
        `;
    }).join('');

    const modalHtml = `
        <div class="space-y-3 text-left">
            <p class="text-sm text-slate-700">
                You have <b>${activeCount} active players</b>.
                Teams below ${TEMPORARY_HELP_THRESHOLD} can call connected friends for emergency help.
            </p>
            <p class="text-xs text-slate-600">
                Each call costs 1 Favor Token. Friends may decline and return to their normal status after the week.
                You have <b>${tokensAvailable} tokens</b>.
            </p>
            <div class="space-y-2 max-h-72 overflow-y-auto">
                ${friendsHtml}
            </div>
        </div>
    `;

    UI.showModal(
        "Emergency Call-Up",
        modalHtml,
        null,
        '',
        continueFlow,
        activeCount < MIN_HEALTHY_PLAYERS
            ? "Proceed Shorthanded"
            : "Continue Without Help"
    );

    const modalBody = document.getElementById('modal-body');
    if (!modalBody) return;

    const handleFriendCall = event => {
        const button = event.target.closest('.emergency-friend-call-btn');
        if (!button) return;

        modalBody.removeEventListener('click', handleFriendCall);

        const playerId = button.dataset.playerId;
        if (!playerId) return;

        const result = Game.callFriend(playerId);

        gameState = Game.getGameState();
        UI.hideModal();

        UI.showModal(
            result.success ? "Friend's On the Way!" : "Couldn't Make It",
            `<p>${escapeHtml(result.message)}</p>`,
            () => {
                // Let the user call another friend if the roster is still below 12.
                showEmergencyFriendCallup(continueFlow);
            },
            "Continue"
        );
    };

    modalBody.addEventListener('click', handleFriendCall);
}


async function handleAdvanceWeek() {
    if (!gameState) return;

    // Never allow the season to advance around an unresolved exit interview.
    if (isExitInterviewFlowActive) {
        renderActiveExitInterview?.();
        return;
    }

    // HARD GUARD: Block advancing if user roster exceeds the limit
    if (gameState.draftCompleted && gameState.playerTeam) {
        const rosterSize = gameState.playerTeam.roster.length;
        const limit = getCurrentRosterLimit(gameState);

        if (rosterSize > limit) {
            const excess = rosterSize - limit;
            UI.showModal(
                "Roster Limit Exceeded",
                `<div class="space-y-2 text-sm text-slate-700">
                    <p>Your team has <b>${rosterSize}</b> players, but the limit is <b>${limit}</b>.</p>
                    <p class="text-rose-600 font-bold">You must cut ${excess} player${excess > 1 ? 's' : ''} from the Roster tab before you can advance.</p>
                </div>`,
                () => { UI.switchTab('my-team', gameState); },
                "Go to Roster"
            );
            return;
        }
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

    // Collect seasonal player dues when the new season is ready to begin.
    // The roster-limit guard above ensures the user's roster cuts are complete.
    if (gameState.currentWeek === 0 && gameState.draftCompleted) {
        processSeasonStartDues(gameState);
        Game.saveGameState(activeSaveKey);
    }

    // 3. Regular Season game handling
    const proceedToGameDay = () => {
        gameState = Game.getGameState();

        if (!gameState?.playerTeam) return;

        const playerTeamId = gameState.playerTeam.id;
        const gamesPerWeek = gameState.teams.length / 2;
        const weekGames = gameState.schedule.slice(
            gameState.currentWeek * gamesPerWeek,
            (gameState.currentWeek + 1) * gamesPerWeek
        );

        const playerGameMatch = weekGames.find(
            g => g.home.id === playerTeamId || g.away.id === playerTeamId
        );

        if (playerGameMatch) {
            const isHome = playerGameMatch.home.id === playerTeamId;
            const opponentName = isHome
                ? playerGameMatch.away.name
                : playerGameMatch.home.name;

            UI.showModal(
                `Game Day: Week ${gameState.currentWeek + 1}`,
                `<p class="mb-4">Your team is playing <strong>${opponentName}</strong>.</p><p>How do you want to play?</p>`,
                () => startLiveGame(playerGameMatch),
                "Watch Game",
                () => simulateRestOfWeek(),
                "Quick Sim"
            );
        } else {
            simulateRestOfWeek();
        }
    };

    const activeCount = Game.getRosterObjects(gameState.playerTeam).filter(p =>
        p && (
            p.status?.type === 'temporary' ||
            !p.status ||
            p.status.duration === 0
        )
    ).length;

    if (activeCount < TEMPORARY_HELP_THRESHOLD) {
        showEmergencyFriendCallup(proceedToGameDay);
        return;
    }

    proceedToGameDay();
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

    // 1. Purge transient match telemetry from schedule matches to prevent storage bloat
    if (Array.isArray(gameState.schedule)) {
        gameState.schedule.forEach(m => {
            if (m) {
                delete m.gameLog;
                delete m.plays;
                delete m.playByPlay;
                delete m.events;
                delete m.statEvents;
                delete m.drives;
                delete m.driveChart;
                delete m.telemetry;
                delete m.visualizationFrames;
            }
        });
    }

    // 2. Clear accumulated in-game play call histories from teams
    if (Array.isArray(gameState.teams)) {
        gameState.teams.forEach(team => {
            if (team) {
                team.recentPlayHistory = [];
                team.playCallHistory = [];
                delete team._captainFlavorLogged;
            }
        });
    }

    // 3. Keep the player on the dashboard to review final standings
    if (gameState.currentWeek < WEEKS_IN_SEASON) {
        Game.generateWeeklyFreeAgents();
    }

    // 4. Refresh gameState reference and persist cleanly
    gameState = Game.getGameState();
    Game.saveGameState(activeSaveKey);

    if (results && results.length > 0) {
        UI.showModal(`Week ${gameState.currentWeek} Summary`, buildResultsModalHtml(results));
    }

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
        Game.finalizeGameResults(
            finalResult.homeTeam,
            finalResult.awayTeam,
            finalResult.homeScore,
            finalResult.awayScore
        );

        const homeScore = Number(finalResult.homeScore);
        const awayScore = Number(finalResult.awayScore);
        const currentYear = Number(gameState?.year);
        const currentWeek = Number(gameState?.currentWeek) + 1;

        if (
            finalResult.homeTeam &&
            finalResult.awayTeam &&
            Number.isFinite(homeScore) &&
            Number.isFinite(awayScore) &&
            Number.isInteger(currentYear) &&
            Number.isInteger(currentWeek)
        ) {
            recordTeamGamePlanningOutcome(
                finalResult.homeTeam,
                finalResult.awayTeam,
                homeScore,
                awayScore,
                'offensePrep',
                currentYear,
                currentWeek
            );

            recordTeamGamePlanningOutcome(
                finalResult.homeTeam,
                finalResult.awayTeam,
                homeScore,
                awayScore,
                'defensePrep',
                currentYear,
                currentWeek
            );

            recordTeamGamePlanningOutcome(
                finalResult.awayTeam,
                finalResult.homeTeam,
                awayScore,
                homeScore,
                'offensePrep',
                currentYear,
                currentWeek
            );

            recordTeamGamePlanningOutcome(
                finalResult.awayTeam,
                finalResult.homeTeam,
                awayScore,
                homeScore,
                'defensePrep',
                currentYear,
                currentWeek
            );
        }

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

    const fits = getBestTwoWayFits(player);

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
        const isBestOffense = pos === fits.offense.position;
        const isBestDefense = pos === fits.defense.position;

        const cardClass = isBestOffense
            ? 'bg-emerald-700 text-white border-emerald-700'
            : isBestDefense
                ? 'bg-blue-700 text-white border-blue-700'
                : 'bg-slate-100 text-slate-800 border-slate-200';

        const labelClass = isBestOffense
            ? 'text-emerald-100'
            : isBestDefense
                ? 'text-blue-100'
                : 'text-slate-400';

        overallsHtml += `
            <div class="${cardClass} p-1.5 rounded border">
                <span class="text-[9px] font-bold block ${labelClass}">
                    ${pos}
                </span>
                <span class="font-black text-sm">
                    ${calculateOverall(player, pos)}
                </span>
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

        // Tab 4: Career Totals + Season-by-Season Stats
    const careerStats = player.careerStats || {};

    const careerStatColumns = [
        { key: 'passYards', label: 'Pass Yds' },
        { key: 'passAttempts', label: 'Pass Att' },
        { key: 'passCompletions', label: 'Pass Comp' },
        { key: 'interceptionsThrown', label: 'INT Thrown' },
        { key: 'rushYards', label: 'Rush Yds' },
        { key: 'rushAttempts', label: 'Rush Att' },
        { key: 'recYards', label: 'Rec Yds' },
        { key: 'receptions', label: 'Receptions' },
        { key: 'targets', label: 'Targets' },
        { key: 'drops', label: 'Drops' },
        { key: 'touchdowns', label: 'TDs' },
        { key: 'tackles', label: 'Tackles' },
        { key: 'sacks', label: 'Sacks' },
        { key: 'interceptions', label: 'INTs' },
        { key: 'fumbles', label: 'Fumbles' },
        { key: 'fumblesLost', label: 'Fumbles Lost' },
        { key: 'fumblesRecovered', label: 'Fumbles Rec.' },
        { key: 'returnYards', label: 'Return Yds' },
        { key: 'safeties', label: 'Safeties' }
    ];

    const careerTotalsHtml = `
        <div class="border border-slate-200 rounded p-3">
            <h5 class="font-bold text-xs uppercase tracking-wider text-slate-600 mb-2">
                Career Totals
            </h5>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
                ${careerStatColumns.map(stat => `
                    <div class="bg-slate-50 border border-slate-100 rounded p-2">
                        <span class="block text-[9px] uppercase tracking-wide text-slate-500">
                            ${stat.label}
                        </span>
                        <span class="block text-sm font-black font-mono text-slate-900">
                            ${Number(careerStats[stat.key]) || 0}
                        </span>
                    </div>
                `).join('')}
                <div class="bg-slate-50 border border-slate-100 rounded p-2">
                    <span class="block text-[9px] uppercase tracking-wide text-slate-500">
                        Seasons
                    </span>
                    <span class="block text-sm font-black font-mono text-slate-900">
                        ${Number(careerStats.seasonsPlayed) || 0}
                    </span>
                </div>
            </div>
        </div>`;

    const progressionHistory = Array.isArray(player.progression)
        ? player.progression
        : [];

    const seasonStatsTableHtml = progressionHistory.length > 0
        ? `
            <div class="border border-slate-200 rounded p-3">
                <h5 class="font-bold text-xs uppercase tracking-wider text-slate-600 mb-2">
                    Season-by-Season
                </h5>
                <div class="overflow-x-auto">
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
                                <th class="p-1.5 text-center">Sacks</th>
                                <th class="p-1.5 text-center">INTs</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100 text-[11px]">
                            ${progressionHistory.map(pr => {
                                const st = pr.stats || {};
                                return `
                                    <tr>
                                        <td class="p-1.5 font-bold">Y${pr.year}</td>
                                        <td class="p-1.5 font-sans truncate max-w-[90px]">
                                            ${pr.teamName || '—'}
                                        </td>
                                        <td class="p-1.5 text-center">${Number(st.passYards) || 0}</td>
                                        <td class="p-1.5 text-center">${Number(st.rushYards) || 0}</td>
                                        <td class="p-1.5 text-center">${Number(st.recYards) || 0}</td>
                                        <td class="p-1.5 text-center font-bold text-amber-600">
                                            ${Number(st.touchdowns) || 0}
                                        </td>
                                        <td class="p-1.5 text-center">${Number(st.tackles) || 0}</td>
                                        <td class="p-1.5 text-center">${Number(st.sacks) || 0}</td>
                                        <td class="p-1.5 text-center">${Number(st.interceptions) || 0}</td>
                                    </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>`
        : '<p class="text-xs text-slate-400 italic py-2">No season-by-season history recorded yet.</p>';

    const statsTableHtml = `
        <div class="space-y-3">
            ${careerTotalsHtml}
            ${seasonStatsTableHtml}
        </div>`;

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
                <div class="flex flex-col items-end gap-1 shrink-0">
                    <div class="text-right bg-emerald-950/50 px-2 py-1 rounded border border-emerald-800">
                        <span class="text-[9px] uppercase tracking-widest text-emerald-300 block">
                            OFF FIT
                        </span>
                        <span class="text-base font-black text-emerald-200">
                            ${fits.offense.position} ${fits.offense.ovr}
                        </span>
                    </div>

                    <div class="text-right bg-blue-950/50 px-2 py-1 rounded border border-blue-800">
                        <span class="text-[9px] uppercase tracking-widest text-blue-300 block">
                            DEF FIT
                        </span>
                        <span class="text-base font-black text-blue-200">
                            ${fits.defense.position} ${fits.defense.ovr}
                        </span>
                    </div>
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
                    ${renderAttrBar('Explosiveness', phys.explosiveness ?? 50)}
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
                <div class="pt-3 border-t border-slate-200 flex justify-between items-center bg-slate-50 p-2.5 rounded">
                    <span class="text-xs text-slate-600 font-bold">Unsigned Neighborhood Free Agent</span>
                    <button class="bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-4 py-2 rounded text-xs uppercase tracking-wider shadow-sm transition" onclick="app.openBidModal('${player.id}')">
                        Negotiate Contract 🤝
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
        const p = Game.getPlayer(playerId) || gameState.players?.find(pl => pl.id === playerId);
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

        // Fetch position-specific promise options from the contract suite
        const pitchOptions = Game.getRetentionPitchOptions(p);
        const focusPromise = pitchOptions.focusPromise;

        const curRole = existingBid?.offer?.role || 'STARTER';
        const curTouches = existingBid?.offer?.promiseTouches || 'NORMAL';
        const curTokens = existingBid?.offer?.tokensOffered ?? 0;

        // Contextual intel from negotiations.js
        const teamRoster = Game.getRosterObjects(gameState.playerTeam);
        const hasBFF = p.social?.bestFriendId && teamRoster.some(r => r.id === p.social.bestFriendId);
        const hasRival = teamRoster.some(r => p.social?.rivalIds?.includes(r.id));
        const qb1 = teamRoster.find(r => Game.isPlayerViableForPosition(r, 'QB'));
        const teamOffense = gameState.playerTeam?.formations?.offense || 'Balanced';

        let heatLabel = '<span class="bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded text-[10px] font-bold">💤 Quiet Market</span>';
        if (intel.heat === 'HOT') {
            heatLabel = `<span class="bg-rose-100 text-rose-800 border border-rose-300 px-1.5 py-0.5 rounded text-[10px] font-bold">🔥 Hot Market (Suitors: ${intel.suitorNames.join(', ')})</span>`;
        } else if (intel.heat === 'WARM') {
            heatLabel = `<span class="bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.5 rounded text-[10px] font-bold">💬 Moderate Buzz (Suitors: ${intel.suitorNames.join(', ')})</span>`;
        }

        const modalHtml = `
            <div class="space-y-3.5 text-left text-xs">
                <!-- Prospect Profile Header -->
                <div class="p-3 bg-slate-900 text-white rounded flex justify-between items-center shadow-sm">
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="font-black text-sm text-white">${p.name}</span>
                            <span class="bg-slate-800 text-amber-400 font-bold px-1.5 py-0.2 rounded font-mono text-[10px]">${pos}</span>
                            ${hasBFF ? '<span class="bg-amber-400 text-slate-950 font-black px-1.5 py-0.2 rounded text-[9px]">🤝 BFF ON TEAM</span>' : ''}
                            ${hasRival ? '<span class="bg-rose-500 text-white font-black px-1.5 py-0.2 rounded text-[9px]">⚠️ RIVAL ON TEAM</span>' : ''}
                        </div>
                        <span class="text-slate-400 font-mono text-[11px]">${p.age}yo • ${p.archetypeName || 'Athlete'} • Potential: ${p.potential || 'C'}</span>
                    </div>
                    <div class="text-right">
                        <span class="text-xl font-black text-white">${ovr}</span>
                        <span class="text-[9px] text-slate-400 block uppercase font-bold -mt-1">OVR</span>
                    </div>
                </div>

                <!-- Blacktop Rumors & Scouting Context -->
                <div class="p-3 bg-amber-50/80 border border-amber-200 rounded text-slate-800 space-y-1">
                    <div class="flex justify-between items-center mb-1">
                        <span class="font-black text-[10px] text-amber-900 uppercase tracking-wider flex items-center gap-1">
                            <span>🚲</span> Blacktop Grapevine & Rumors
                        </span>
                        ${heatLabel}
                    </div>
                    <p class="text-[11px] text-slate-700 italic">"${intel.rumorText}"</p>
                    <div class="text-[10px] text-slate-500 font-mono pt-1.5 border-t border-amber-200/60 flex flex-wrap gap-2">
                        <span>Scheme: <b>${teamOffense}</b></span>
                        <span>•</span>
                        <span>Passer: <b>${qb1 ? `${qb1.name.split(' ')[0]} (${qb1.attributes?.technical?.throwingAccuracy || 50} THR)` : 'None'}</b></span>
                        <span>•</span>
                        <span>Clique: <b>${p.personality?.clique || 'Regular'}</b></span>
                        <span>•</span>
                        <span>Ego: <b class="${(p.personality?.ego || 50) > 70 ? 'text-rose-600' : 'text-slate-700'}">${p.personality?.ego || 50}</b></span>
                    </div>
                </div>

                <!-- Official Contract Terms Form -->
                <div class="space-y-3 bg-white p-3 border border-slate-200 rounded">
                    <h5 class="font-black text-xs uppercase tracking-wider text-slate-700">Contract Terms & Role Pitch</h5>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <label class="block text-[10px] text-slate-500 font-bold uppercase mb-1">Role Commitment</label>
                            <select id="bid-role" class="w-full p-2 border border-slate-300 rounded bg-white font-bold text-slate-800 outline-none text-xs">
                                <option value="STARTER" ${curRole === 'STARTER' ? 'selected' : ''}>${pitchOptions.starterRoleLabel} (Promised)</option>
                                <option value="ROTATION" ${curRole === 'ROTATION' ? 'selected' : ''}>${pitchOptions.rotationRoleLabel} (Core Sub)</option>
                                <option value="BENCH" ${curRole === 'BENCH' ? 'selected' : ''}>${pitchOptions.reserveRoleLabel} (Depth)</option>
                            </select>
                            <p class="text-[9px] text-slate-400 mt-0.5">Fake starter promises are penalized if a better starter already leads the room.</p>
                        </div>

                        <div>
                            <label class="block text-[10px] text-slate-500 font-bold uppercase mb-1">Position Workload Guarantee</label>
                            <select id="bid-touches" class="w-full p-2 border border-slate-300 rounded bg-white font-bold text-slate-800 outline-none text-xs">
                                <option value="NORMAL" ${curTouches === 'NORMAL' ? 'selected' : ''}>Team-First / Balanced Usage</option>
                                ${focusPromise ? `<option value="FEATURED" ${curTouches === 'FEATURED' ? 'selected' : ''}>${focusPromise.label} (${focusPromise.target}+ Target)</option>` : ''}
                            </select>
                            <p class="text-[9px] text-slate-400 mt-0.5">${focusPromise ? focusPromise.description : 'No offensive workload promise applies to this position.'}</p>
                        </div>
                    </div>

                    <div>
                        <div class="flex justify-between items-center mb-1">
                            <label class="text-[10px] text-slate-500 font-bold uppercase">Favor Token Sweetener</label>
                            <span class="text-[10px] font-mono text-slate-500">Available: <b>${maxTokensForThisBid}</b></span>
                        </div>
                        <select id="bid-tokens" class="w-full p-2 border border-slate-300 rounded bg-white font-bold text-slate-800 outline-none text-xs">
                            <option value="0" ${curTokens === 0 ? 'selected' : ''}>0 Tokens (Standard pitch)</option>
                            ${maxTokensForThisBid >= 1 ? `<option value="1" ${curTokens === 1 ? 'selected' : ''}>1 Token (Lend bike, concessions, personal favors)</option>` : ''}
                            ${maxTokensForThisBid >= 2 ? `<option value="2" ${curTokens === 2 ? 'selected' : ''}>2 Tokens (Substantial commitment & recruiting push)</option>` : ''}
                        </select>
                    </div>
                </div>
            </div>
        `;

        UI.showModal(`Recruit Prospect: ${p.name}`, modalHtml, () => {
            const role = document.getElementById('bid-role')?.value || 'STARTER';
            const promiseTouches = document.getElementById('bid-touches')?.value || 'NORMAL';
            const tokensOffered = parseInt(document.getElementById('bid-tokens')?.value || '0', 10);
            const offer = { role, promiseTouches, tokensOffered };

            if (isOffseason) {
                UI.addOffseasonFABid({ playerId: p.id, teamId: gameState.playerTeam.id, offer });
                UI.renderOffseasonFAScreen(gameState);
            } else {
                const evalResult = Game.evaluatePlayerNegotiation(p, gameState.playerTeam, offer);
                const isInstant = Game.checkInstantCommit(p, gameState.playerTeam, evalResult, offer);

                // Build rich feedback modal displaying the full negotiations suite
                const outcomeHtml = `
                    <div class="space-y-3 text-left text-xs">
                        <div class="p-3 rounded border ${evalResult.accepted ? 'bg-emerald-50 border-emerald-300 text-emerald-950' : 'bg-rose-50 border-rose-300 text-rose-950'}">
                            <div class="flex items-center gap-2 mb-1">
                                <span class="text-base">${evalResult.accepted ? '🤝' : '✋'}</span>
                                <h4 class="font-black text-sm uppercase">${isInstant ? 'Instant Commitment!' : (evalResult.accepted ? 'Offer Accepted!' : 'Offer Declined')}</h4>
                            </div>
                            <p class="text-[11px] font-mono border-t pt-1 ${evalResult.accepted ? 'border-emerald-200' : 'border-rose-200'}">
                                Interest Score: <b>${evalResult.interestScore} / 100</b> (Threshold: ${evalResult.threshold})
                            </p>
                        </div>

                        <div class="bg-slate-50 border border-slate-200 p-2.5 rounded">
                            <span class="font-black text-[10px] uppercase text-slate-500 block mb-1">Negotiation Factors & Player Reactions:</span>
                            <ul class="space-y-0.5 text-[11px] font-mono text-slate-700">
                                ${evalResult.reasons.map(r => `<li>• ${r}</li>`).join('')}
                            </ul>
                        </div>
                    </div>
                `;

                if (isInstant) {
                    const signResult = Game.playerSignFreeAgent(p.id, offer);

                    // Refresh from the authoritative game state after the transaction.
                    gameState = Game.getGameState();

                    if (signResult?.success) {
                        Game.saveGameState(activeSaveKey);

                        UI.showModal(
                            "Contract Signed! 🤝",
                            outcomeHtml,
                            null,
                            null,
                            null,
                            "Welcome to the Squad!"
                        );
                    } else {
                        UI.showModal(
                            "Signing Failed",
                            `<p class="text-sm text-rose-700">${signResult?.message || "The player was not added to your roster."}</p>`,
                            null,
                            null,
                            null,
                            "Close"
                        );
                    }
                } else if (evalResult.accepted) {
                    gameState.weeklyBids = gameState.weeklyBids || [];
                    gameState.weeklyBids.push({ playerId: p.id, team: gameState.playerTeam, teamId: gameState.playerTeam.id, offer });
                    UI.showModal("Offer Submitted 📋", outcomeHtml, null, null, null, "Understood");
                } else {
                    UI.showModal("Offer Declined ✋", outcomeHtml, null, null, null, "Close");
                }

                UI.switchTab('free-agents', gameState);
            }
        }, existingBid ? "Update Offer" : "Submit Contract Offer");
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
                Game.saveGameState(activeSaveKey);
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
            Game.saveGameState(activeSaveKey);
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

        if (!team.finances) {
            team.finances = {
                balance: 10.00,
                waivedDues: [],
                autoSnack: 'none'
            };
        }

        const trainingEquipmentLevel = Math.max(
            0,
            Math.min(
                3,
                Math.floor(
                    Number(team.storeUpgrades?.trainingEquipmentLevel) || 0
                )
            )
        );

        const trainingEquipmentPrices = [25.00, 45.00, 70.00];

        const scoutingToolkitLevel = Math.max(
            0,
            Math.min(
                3,
                Math.floor(
                    Number(team.storeUpgrades?.scoutingToolkitLevel) || 0
                )
            )
        );

        const scoutingToolkitPrices = [20.00, 40.00, 60.00];

        const catalog = {
            token: {
                price: 3.00,
                title: 'Recruiting Favor Token',
                message: 'Added 1 Favor Token to your recruiting budget.'
            },
            orange: {
                price: 2.00,
                title: 'Orange Slices',
                message: 'Every rostered player recovered up to 10 fatigue.'
            },
            caprisun: {
                price: 6.00,
                title: 'Capri Sun Crate',
                message: 'Every rostered player recovered up to 30 fatigue.'
            },
            pizza: {
                price: 25.00,
                title: 'Team Pizza Party',
                message: 'Team happiness was restored and locker-room rivalries were cleared.'
            },
            trainingEquipment: {
                price: trainingEquipmentPrices[trainingEquipmentLevel],
                title: 'Training Equipment Upgrade',
                message:
                    `Training Equipment is now Level ${trainingEquipmentLevel + 1}. ` +
                    `Staff-training progress is boosted by ${(trainingEquipmentLevel + 1) * 10}%.`
            },
            scoutingToolkit: {
                price: scoutingToolkitPrices[scoutingToolkitLevel],
                title: 'Scouting Toolkit Upgrade',
                message:
                    `Scouting Toolkit is now Level ${scoutingToolkitLevel + 1}. ` +
                    `Scouting-report progress is boosted by ${(scoutingToolkitLevel + 1) * 10}%.`
            }
        };

        const product = catalog[item];

        if (!product) {
            alert('That item is not available in the Corner Store.');
            return;
        }

        if (
            (item === 'trainingEquipment' && trainingEquipmentLevel >= 3) ||
            (item === 'scoutingToolkit' && scoutingToolkitLevel >= 3)
        ) {
            alert(
                item === 'trainingEquipment'
                    ? 'Training Equipment is already at its maximum level.'
                    : 'Scouting Toolkit is already at its maximum level.'
            );
            return;
        }

        const price = product.price;

        if (!Number.isFinite(price)) {
            alert('This item is currently unavailable.');
            return;
        }
        const balance = Number(team.finances.balance) || 0;

        if (balance < price) {
            alert(
                `Not enough money in the Team Fund. ` +
                `You need $${price.toFixed(2)} and have $${balance.toFixed(2)}.`
            );
            return;
        }

        const roster = Game.getUIRosterObjects(team) || [];

        if (
            ['orange', 'caprisun', 'pizza'].includes(item) &&
            roster.length === 0
        ) {
            alert('Your roster is empty, so this item would have no effect.');
            return;
        }

        // Apply the purchase's effect.
        if (item === 'token') {
            if (!team.socialProfile) {
                team.socialProfile = {
                    favorTokens: 0,
                    streetCred: 50
                };
            }

            team.socialProfile.favorTokens =
                (Number(team.socialProfile.favorTokens) || 0) + 1;

        } else if (item === 'orange') {
            roster.forEach(player => {
                player.fatigue = Math.max(0, (Number(player.fatigue) || 0) - 10);
            });

        } else if (item === 'caprisun') {
            roster.forEach(player => {
                player.fatigue = Math.max(0, (Number(player.fatigue) || 0) - 30);
            });

        } else if (item === 'pizza') {
            roster.forEach(player => {
                if (player.expectations) {
                    player.expectations.happiness = 100;
                }

                if (player.social) {
                    player.social.rivalIds = [];
                }
            });

        } else if (item === 'trainingEquipment') {
            if (!team.storeUpgrades || typeof team.storeUpgrades !== 'object') {
                team.storeUpgrades = {};
            }

            team.storeUpgrades.trainingEquipmentLevel =
                trainingEquipmentLevel + 1;

        } else if (item === 'scoutingToolkit') {
            if (!team.storeUpgrades || typeof team.storeUpgrades !== 'object') {
                team.storeUpgrades = {};
            }

            team.storeUpgrades.scoutingToolkitLevel =
                scoutingToolkitLevel + 1;
        }

        // Deduct the verified catalog price.
        team.finances.balance = Math.max(
            0,
            Math.round((balance - price) * 100) / 100
        );

        // Record each one-time purchase in the finance dashboard.
        // Use a unique category per purchase so buying multiple items
        // in the same week does not overwrite an earlier transaction.
        const transactionYear = Number(gs.year);
        const transactionWeek = Number(gs.currentWeek);

        if (
            Number.isInteger(transactionYear) &&
            transactionYear >= 5 &&
            Number.isInteger(transactionWeek)
        ) {
            if (!Array.isArray(team.finances.ledger)) {
                team.finances.ledger = [];
            }

            const transactionCategory =
                `store_${item}_${Date.now()}_${team.finances.ledger.length}`;

            team.finances.ledger.push({
                key: `${transactionYear}:${transactionWeek}:${transactionCategory}`,
                year: transactionYear,
                week: transactionWeek,
                category: transactionCategory,
                label: product.title,
                amount: -price,
                balanceAfter: team.finances.balance
            });

            // Keep the saved transaction history bounded.
            if (team.finances.ledger.length > 80) {
                team.finances.ledger.splice(
                    0,
                    team.finances.ledger.length - 80
                );
            }
        }

        // Display a purchase confirmation inside the store.
        team.finances.lastStoreNotice = {
            title: `${product.title} purchased`,
            message: product.message
        };

        // Keep a visible record in the game log.
        if (!Array.isArray(gs.gameLog)) {
            gs.gameLog = [];
        }

        gs.gameLog.push(
            `🛒 Corner Store: ${product.title} (-$${price.toFixed(2)}). ` +
            product.message
        );

        Game.saveGameState(activeSaveKey);
        window.app.renderStoreTab(gs);
    },

        waivePlayerDues: (playerId) => {
        const gs = Game.getGameState();
        const team = gs?.playerTeam;
        if (!team) return;

        if (!team.finances) {
            team.finances = {
                balance: 10.00,
                waivedDues: [],
                autoSnack: 'none'
            };
        }

        if (!Array.isArray(team.finances.waivedDues)) {
            team.finances.waivedDues = [];
        }

        const currentYear = Number(gs.year);

        // Waivers can only be changed before this season's collection.
        if (
            !Number.isInteger(currentYear) ||
            Number(team.finances.seasonDuesYear) === currentYear
        ) {
            window.app.renderStoreTab(gs);
            return;
        }

        // Only allow waivers for players currently on this roster.
        if (!(team.roster || []).some(
            id => String(id) === String(playerId)
        )) {
            return;
        }

        const existingIndex = team.finances.waivedDues.findIndex(
            id => String(id) === String(playerId)
        );

        if (existingIndex >= 0) {
            // Cancel a queued waiver and restore its Street Cred cost.
            team.finances.waivedDues.splice(existingIndex, 1);

            if (team.socialProfile) {
                team.socialProfile.streetCred = Math.min(
                    100,
                    (team.socialProfile.streetCred ?? 50) + 2
                );
            }
        } else {
            // Queue a waiver for the upcoming seasonal dues collection.
            team.finances.waivedDues.push(playerId);

            if (team.socialProfile) {
                team.socialProfile.streetCred = Math.max(
                    0,
                    (team.socialProfile.streetCred ?? 50) - 2
                );
            }
        }

        Game.saveGameState(activeSaveKey);
        window.app.renderStoreTab(gs);
    },

        renderFinancesTab: (gameState) => {
        const team = gameState?.playerTeam;
        if (!team) return;

        if (!team.finances) {
            team.finances = {
                balance: 10.00,
                waivedDues: [],
                autoSnack: 'none'
            };
        }

        const pane = document.getElementById('fo-pane-finances');
        if (!pane) return;

        const finances = team.finances;
        const money = value =>
            `$${(Number(value) || 0).toFixed(2)}`;

        const escapeHtml = value => String(value ?? '').replace(
            /[&<>"']/g,
            char => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            })[char]
        );

        const ledger = Array.isArray(finances.ledger)
            ? [...finances.ledger]
            : [];

        ledger.sort((a, b) =>
            (Number(b.year) || 0) - (Number(a.year) || 0) ||
            (Number(b.week) || 0) - (Number(a.week) || 0)
        );

        const normalizeLedgerCategory = value => {
            const category = String(value || 'other');
            const storeMatch = category.match(
                /^store_(token|orange|caprisun|pizza|trainingEquipment|scoutingToolkit)_/
            );

            return storeMatch
                ? `store_${storeMatch[1]}`
                : category;
        };

        const ledgerCategoryLabels = {
            allowance: 'Community Allowance',
            weeklyAllowance: 'Community Allowance (Legacy)',
            playerDues: 'Player Dues (Legacy)',
            seasonDues: 'Season-start Player Dues',
            staffPayroll: 'Staff Payroll',
            aiMorale: 'AI Morale Spending',
            aiToken: 'AI Favor Token Purchase',
            aiCapriSun: 'AI Capri Sun Recovery Snacks',
            aiOrangeSlices: 'AI Orange Slice Recovery Snacks',
            autoSnack: 'Weekly Snack Plan',
            hustle: 'Hustle Income',
            store_token: 'Favor Token',
            store_orange: 'Orange Slices',
            store_caprisun: 'Capri Sun',
            store_pizza: 'Pizza Party',
            store_trainingEquipment: 'Training Equipment Upgrade',
            store_scoutingToolkit: 'Scouting Toolkit Upgrade'
        };

        const getLedgerCategoryLabel = category =>
            ledgerCategoryLabels[category] ||
            String(category)
                .replace(/[_-]+/g, ' ')
                .replace(/\b[a-z]/g, letter => letter.toUpperCase());

        const ledgerCategoryOptions = [
            ...new Set(ledger.map(entry =>
                normalizeLedgerCategory(entry.category)
            ))
        ]
            .sort((a, b) =>
                getLedgerCategoryLabel(a).localeCompare(
                    getLedgerCategoryLabel(b)
                )
            )
            .map(category => `
                <option value="${category}">
                    ${escapeHtml(getLedgerCategoryLabel(category))}
                </option>
            `)
            .join('');

        const recordedIncome = ledger.reduce((sum, entry) => {
            const amount = Number(entry.amount) || 0;
            return sum + (amount > 0 ? amount : 0);
        }, 0);

        const recordedExpenses = ledger.reduce((sum, entry) => {
            const amount = Number(entry.amount) || 0;
            return sum + (amount < 0 ? Math.abs(amount) : 0);
        }, 0);

        const recordedNet = ledger.reduce(
            (sum, entry) => sum + (Number(entry.amount) || 0),
            0
        );

        // Prefer actual weekly balance snapshots for cash-flow trends.
        // The transaction ledger is capped at 80 entries, so rebuilding
        // every week's net change from it can omit older transactions.
        const storedWeeklyHistory = Array.isArray(finances.weeklyHistory)
            ? finances.weeklyHistory
            : [];

        let chartWeeks = storedWeeklyHistory
            .filter(entry => {
                const year = Number(entry?.year);
                const week = Number(entry?.week);
                const netChange = Number(entry?.netChange);

                return (
                    Number.isInteger(year) &&
                    Number.isInteger(week) &&
                    Number.isFinite(netChange)
                );
            })
            .map(entry => ({
                year: Number(entry.year),
                week: Number(entry.week),
                net: Number(entry.netChange)
            }))
            .sort((a, b) =>
                a.year - b.year || a.week - b.week
            )
            .slice(-8);

        // Backward-compatible fallback for saves without weekly snapshots.
        if (chartWeeks.length === 0) {
            const weeklyTotals = new Map();

            ledger.forEach(entry => {
                const year = Number(entry.year) || 0;
                const week = Number(entry.week) || 0;
                const key = `${year}:${week}`;

                if (!weeklyTotals.has(key)) {
                    weeklyTotals.set(key, {
                        year,
                        week,
                        net: 0
                    });
                }

                weeklyTotals.get(key).net += Number(entry.amount) || 0;
            });

            chartWeeks = [...weeklyTotals.values()]
                .sort((a, b) =>
                    a.year - b.year || a.week - b.week
                )
                .slice(-8);
        }

        const chartScale = Math.max(
            1,
            ...chartWeeks.map(entry => Math.abs(entry.net))
        );

        const chartHtml = chartWeeks.length
            ? chartWeeks.map(entry => {
                const width = Math.max(
                    entry.net === 0 ? 0 : 3,
                    Math.abs(entry.net) / chartScale * 100
                );

                const barColor = entry.net < 0
                    ? 'bg-rose-500'
                    : 'bg-emerald-500';

                return `
                    <div class="grid grid-cols-[76px_minmax(0,1fr)_90px] gap-3 items-center text-xs">
                        <span class="text-slate-500 font-semibold">
                            Y${entry.year} W${entry.week + 1}
                        </span>
                        <div class="h-5 bg-slate-100 rounded overflow-hidden">
                            <div
                                class="h-full ${barColor} rounded"
                                style="width:${width.toFixed(1)}%"
                            ></div>
                        </div>
                        <span class="text-right font-mono font-bold ${
                            entry.net < 0 ? 'text-rose-600' : 'text-emerald-700'
                        }">
                            ${entry.net > 0 ? '+' : ''}${money(entry.net)}
                        </span>
                    </div>
                `;
            }).join('')
            : `
                <p class="text-sm text-slate-500 py-5 text-center">
                    Weekly trends will appear as transactions are recorded.
                </p>
            `;

        const ledgerRows = ledger.length
            ? ledger.map(entry => {
                const amount = Number(entry.amount) || 0;
                const rawCategory = String(entry.category || 'other');
                const categoryKey = normalizeLedgerCategory(rawCategory);
                const category = escapeHtml(
                    getLedgerCategoryLabel(categoryKey)
                );

                const rawDescription = String(
                    entry.label || entry.description || entry.category || 'Transaction'
                );
                const description = escapeHtml(rawDescription);

                const searchText = [
                    entry.year,
                    entry.week,
                    rawCategory,
                    getLedgerCategoryLabel(categoryKey),
                    rawDescription,
                    amount
                ].join(' ').toLowerCase();

                const balanceAfter = Number.isFinite(
                    Number(entry.balanceAfter)
                ) && entry.balanceAfter !== null &&
                    entry.balanceAfter !== ''
                    ? money(entry.balanceAfter)
                    : '—';

                return `
                    <tr
                        data-finance-ledger-row
                        data-ledger-search="${escapeHtml(searchText)}"
                        data-ledger-category="${escapeHtml(categoryKey)}"
                        data-ledger-category-label="${escapeHtml(getLedgerCategoryLabel(categoryKey).toLowerCase())}"
                        data-ledger-description="${escapeHtml(rawDescription.toLowerCase())}"
                        data-ledger-date="${((Number(entry.year) || 0) * 100) + (Number(entry.week) || 0)}"
                        data-ledger-amount="${amount}"
                        data-ledger-balance="${
                            Number.isFinite(Number(entry.balanceAfter)) &&
                            entry.balanceAfter !== null &&
                            entry.balanceAfter !== ''
                                ? Number(entry.balanceAfter)
                                : ''
                        }"
                        class="border-b border-slate-100 hover:bg-slate-50"
                    >
                        <td class="px-4 py-3 whitespace-nowrap text-slate-600">
                            Y${Number(entry.year) || '—'} /
                            W${
                                Number.isInteger(Number(entry.week)) &&
                                entry.week !== null &&
                                entry.week !== ''
                                    ? Number(entry.week) + 1
                                    : '—'
                            }
                        </td>
                        <td class="px-4 py-3 whitespace-nowrap">
                            <span class="inline-block rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                                ${category}
                            </span>
                        </td>
                        <td class="px-4 py-3 min-w-56 text-slate-800">
                            ${description}
                        </td>
                        <td class="px-4 py-3 text-right whitespace-nowrap font-mono font-bold ${
                            amount < 0 ? 'text-rose-600' : 'text-emerald-700'
                        }">
                            ${amount > 0 ? '+' : ''}${money(amount)}
                        </td>
                        <td class="px-4 py-3 text-right whitespace-nowrap font-mono text-slate-700">
                            ${balanceAfter}
                        </td>
                    </tr>
                `;
            }).join('')
            : `
                <tr>
                    <td colspan="5" class="px-4 py-10 text-center text-slate-500">
                        No transactions have been recorded yet.
                    </td>
                </tr>
            `;

        pane.innerHTML = `
            <div class="min-h-full bg-slate-100 p-4 md:p-6 space-y-5">
                <div class="flex flex-wrap justify-between items-start gap-3">
                    <div>
                        <h3 class="text-2xl font-black uppercase tracking-wide text-slate-800">
                            Team Finances
                        </h3>
                        <p class="text-sm text-slate-500 mt-1">
                            Manage the fund and review where your money goes.
                        </p>
                    </div>
                    <span class="text-xs font-bold uppercase tracking-wider text-slate-500">
                        Financial Records
                    </span>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                    <div class="bg-slate-900 text-white rounded-lg p-4 shadow-sm">
                        <p class="text-xs uppercase tracking-wider text-slate-300 font-bold">
                            Current Balance
                        </p>
                        <p class="text-2xl font-black font-mono mt-2">
                            ${money(finances.balance)}
                        </p>
                    </div>

                    <div class="bg-white rounded-lg border border-slate-200 p-4">
                        <p class="text-xs uppercase tracking-wider text-slate-500 font-bold">
                            Retained Ledger Income
                        </p>
                        <p class="text-xl font-black font-mono text-emerald-700 mt-2">
                            +${money(recordedIncome)}
                        </p>
                    </div>

                    <div class="bg-white rounded-lg border border-slate-200 p-4">
                        <p class="text-xs uppercase tracking-wider text-slate-500 font-bold">
                            Retained Ledger Expenses
                        </p>
                        <p class="text-xl font-black font-mono text-rose-600 mt-2">
                            ${money(recordedExpenses)}
                        </p>
                    </div>

                    <div class="bg-white rounded-lg border border-slate-200 p-4">
                        <p class="text-xs uppercase tracking-wider text-slate-500 font-bold">
                            Retained Ledger Net Change
                        </p>
                        <p class="text-xl font-black font-mono mt-2 ${
                            recordedNet < 0 ? 'text-rose-600' : 'text-emerald-700'
                        }">
                            ${recordedNet > 0 ? '+' : ''}${money(recordedNet)}
                        </p>
                    </div>
                </div>

                <section class="bg-white rounded-lg border border-slate-200 shadow-sm p-4">
                    <div class="flex flex-wrap justify-between items-center gap-2 mb-4">
                        <div>
                            <h4 class="font-black text-slate-800">
                                Weekly Cash Flow
                            </h4>
                            <p class="text-xs text-slate-500 mt-1">
                                Uses saved weekly balance snapshots when available; older saves may fall back to ledger transactions.
                            </p>
                        </div>
                        <span class="text-xs text-slate-400">
                            Most recent 8 weeks
                        </span>
                    </div>
                    <div class="space-y-3">
                        ${chartHtml}
                    </div>
                </section>

                <section class="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                    <div class="p-4 border-b border-slate-200 flex flex-wrap justify-between items-center gap-2">
                        <div>
                            <h4 class="font-black text-slate-800">
                                Transaction Ledger
                            </h4>
                            <p class="text-xs text-slate-500 mt-1">
                                Individual transactions, newest weeks first.
                            </p>
                        </div>
                        <span
                            id="finance-ledger-count"
                            class="text-xs font-semibold text-slate-500"
                        >
                            ${ledger.length} recorded entries
                        </span>
                    </div>

                    <div class="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row gap-3">
                        <label class="flex-1">
                            <span class="block text-xs font-bold text-slate-600 mb-1">
                                Search transactions
                            </span>
                            <input
                                id="finance-ledger-search"
                                type="search"
                                placeholder="Description, category, week, amount..."
                                class="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
                            >
                        </label>

                        <label class="sm:w-64">
                            <span class="block text-xs font-bold text-slate-600 mb-1">
                                Category
                            </span>
                            <select
                                id="finance-ledger-category"
                                class="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
                            >
                                <option value="all">All categories</option>
                                ${ledgerCategoryOptions}
                            </select>
                        </label>
                    </div>

                    <div class="overflow-x-auto">
                        <table class="min-w-[760px] w-full text-sm">
                            <thead class="bg-slate-800 text-white">
                                <tr>
                                    <th class="px-4 py-3 text-left whitespace-nowrap">
                                        <button type="button" data-finance-sort="date" data-sort-label="Season / Week" class="inline-flex items-center gap-2 hover:text-amber-300">
                                            Season / Week <span data-sort-indicator>↓</span>
                                        </button>
                                    </th>
                                    <th class="px-4 py-3 text-left">
                                        <button type="button" data-finance-sort="category" data-sort-label="Category" class="inline-flex items-center gap-2 hover:text-amber-300">
                                            Category <span data-sort-indicator>↕</span>
                                        </button>
                                    </th>
                                    <th class="px-4 py-3 text-left">
                                        <button type="button" data-finance-sort="description" data-sort-label="Description" class="inline-flex items-center gap-2 hover:text-amber-300">
                                            Description <span data-sort-indicator>↕</span>
                                        </button>
                                    </th>
                                    <th class="px-4 py-3 text-right whitespace-nowrap">
                                        <button type="button" data-finance-sort="amount" data-sort-label="Amount" class="inline-flex items-center justify-end gap-2 hover:text-amber-300">
                                            Amount <span data-sort-indicator>↕</span>
                                        </button>
                                    </th>
                                    <th class="px-4 py-3 text-right whitespace-nowrap">
                                        <button type="button" data-finance-sort="balance" data-sort-label="Balance After" class="inline-flex items-center justify-end gap-2 hover:text-amber-300">
                                            Balance After <span data-sort-indicator>↕</span>
                                        </button>
                                    </th>
                                </tr>
                            </thead>
                            <tbody id="finance-ledger-body">
                                ${ledgerRows}
                                <tr id="finance-ledger-no-matches" class="hidden">
                                    <td colspan="5" class="px-4 py-8 text-center text-slate-500">
                                        No transactions match your search and category filters.
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        `;

        const searchInput = pane.querySelector('#finance-ledger-search');
        const categorySelect = pane.querySelector('#finance-ledger-category');
        const ledgerCount = pane.querySelector('#finance-ledger-count');
        const noMatchesRow = pane.querySelector('#finance-ledger-no-matches');

        const transactionRows = Array.from(
            pane.querySelectorAll('[data-finance-ledger-row]')
        );

        const ledgerBody = pane.querySelector('#finance-ledger-body');
        const sortButtons = Array.from(
            pane.querySelectorAll('[data-finance-sort]')
        );

        let sortField = 'date';
        let sortDirection = 'desc';

        const sortLedgerRows = () => {
            const getSortValue = row => {
                switch (sortField) {
                    case 'category':
                        return row.dataset.ledgerCategoryLabel || '';

                    case 'description':
                        return row.dataset.ledgerDescription || '';

                    case 'amount':
                        return Number(row.dataset.ledgerAmount) || 0;

                    case 'balance':
                        return row.dataset.ledgerBalance === ''
                            ? Number.NEGATIVE_INFINITY
                            : Number(row.dataset.ledgerBalance);

                    case 'date':
                    default:
                        return Number(row.dataset.ledgerDate) || 0;
                }
            };

            transactionRows.sort((a, b) => {
                const valueA = getSortValue(a);
                const valueB = getSortValue(b);

                const comparison =
                    typeof valueA === 'string' && typeof valueB === 'string'
                        ? valueA.localeCompare(valueB)
                        : valueA - valueB;

                return sortDirection === 'asc'
                    ? comparison
                    : -comparison;
            });

            // Reorder the existing rows without rebuilding them.
            transactionRows.forEach(row => {
                ledgerBody?.appendChild(row);
            });

            // Keep the no-results message at the bottom.
            if (ledgerBody && noMatchesRow) {
                ledgerBody.appendChild(noMatchesRow);
            }

            sortButtons.forEach(button => {
                const isActive = button.dataset.financeSort === sortField;
                const indicator = button.querySelector('[data-sort-indicator]');

                if (indicator) {
                    indicator.textContent = isActive
                        ? (sortDirection === 'asc' ? '↑' : '↓')
                        : '↕';
                }

                button.title = isActive
                    ? `Sorted ${sortDirection === 'asc' ? 'ascending' : 'descending'}`
                    : 'Click to sort';
            });
        };

        sortButtons.forEach(button => {
            button.addEventListener('click', () => {
                const nextField = button.dataset.financeSort;

                if (sortField === nextField) {
                    sortDirection = sortDirection === 'asc'
                        ? 'desc'
                        : 'asc';
                } else {
                    sortField = nextField;
                    sortDirection = [
                        'category',
                        'description'
                    ].includes(nextField)
                        ? 'asc'
                        : 'desc';
                }

                sortLedgerRows();
                applyLedgerFilters();
            });
        });

        const applyLedgerFilters = () => {
            const query = (searchInput?.value || '')
                .trim()
                .toLowerCase();

            const selectedCategory = categorySelect?.value || 'all';
            let visibleCount = 0;

            transactionRows.forEach(row => {
                const matchesSearch =
                    !query ||
                    (row.dataset.ledgerSearch || '').includes(query);

                const matchesCategory =
                    selectedCategory === 'all' ||
                    row.dataset.ledgerCategory === selectedCategory;

                const isVisible = matchesSearch && matchesCategory;

                row.classList.toggle('hidden', !isVisible);

                if (isVisible) visibleCount++;
            });

            if (ledgerCount) {
                ledgerCount.textContent = visibleCount === ledger.length
                    ? `${ledger.length} recorded entries`
                    : `${visibleCount} of ${ledger.length} entries`;
            }

            if (noMatchesRow) {
                noMatchesRow.classList.toggle(
                    'hidden',
                    ledger.length === 0 || visibleCount > 0
                );
            }
        };

        searchInput?.addEventListener('input', applyLedgerFilters);
        categorySelect?.addEventListener('change', applyLedgerFilters);

        sortLedgerRows();
        applyLedgerFilters();
    },

    renderStoreTab: (gameState) => {
        const team = gameState?.playerTeam;
        if (!team) return;
        if (!team.finances) team.finances = { balance: 10.00, waivedDues: [], autoSnack: 'none' };

        if (!Array.isArray(team.finances.waivedDues)) {
            team.finances.waivedDues = [];
        }

        const currentYear = Number(gameState.year);
        const seasonDuesSettled =
            Number.isInteger(currentYear) &&
            Number(team.finances.seasonDuesYear) === currentYear;

        const waivedDuesIds = new Set(
            team.finances.waivedDues.map(String)
        );

        const autoSnack = team.finances.autoSnack || 'none';

        const trainingEquipmentLevel = Math.max(
            0,
            Math.min(
                3,
                Math.floor(
                    Number(team.storeUpgrades?.trainingEquipmentLevel) || 0
                )
            )
        );

        const trainingEquipmentPrices = [25.00, 45.00, 70.00];
        const nextTrainingEquipmentPrice =
            trainingEquipmentPrices[trainingEquipmentLevel] ?? null;

        const scoutingToolkitLevel = Math.max(
            0,
            Math.min(
                3,
                Math.floor(
                    Number(team.storeUpgrades?.scoutingToolkitLevel) || 0
                )
            )
        );

        const scoutingToolkitPrices = [20.00, 40.00, 60.00];
        const nextScoutingToolkitPrice =
            scoutingToolkitPrices[scoutingToolkitLevel] ?? null;

        const pane = document.getElementById('fo-pane-store');
        if (!pane) return;

        const escapeFinanceText = value =>
            String(value ?? '').replace(/[&<>"']/g, char => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            })[char]);

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
            ${team.finances.lastStoreNotice ? `
                <div class="mx-4 mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-sm">
                    <div class="text-xs font-black uppercase tracking-wider text-emerald-800">
                        ${escapeFinanceText(team.finances.lastStoreNotice.title || 'Purchase complete')}
                    </div>
                    <p class="mt-1 text-sm text-emerald-900">
                        ${escapeFinanceText(team.finances.lastStoreNotice.message || '')}
                    </p>
                </div>
            ` : ''}
            <div class="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">

                <!-- PURCHASABLE UPGRADES & PLANS -->
                <div class="bg-white rounded-sm border border-slate-300 shadow-sm p-4 flex flex-col">
                                        <div class="mb-5">
                        <div class="flex flex-wrap justify-between items-end gap-2 mb-3 border-b border-slate-200 pb-2">
                            <div>
                                <h4 class="font-black text-sm uppercase tracking-wider text-slate-800">
                                    Quick Purchases
                                </h4>
                                <p class="text-[10px] text-slate-500 mt-1">
                                    One-time purchases. Effects apply immediately.
                                </p>
                            </div>
                            <span class="text-[9px] font-black uppercase tracking-wider text-slate-500">
                                Shop Inventory
                            </span>
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">

                            <!-- Recruiting -->
                            <div class="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-3 flex flex-col">
                                <div class="flex items-start justify-between gap-2">
                                    <span class="text-2xl">🎟️</span>
                                    <span class="text-[9px] font-black uppercase tracking-wider text-violet-700 bg-violet-100 rounded-full px-2 py-1">
                                        Recruiting
                                    </span>
                                </div>
                                <h5 class="font-black text-sm text-slate-900 mt-2">
                                    Favor Token
                                </h5>
                                <p class="text-[11px] text-slate-600 mt-1 flex-grow">
                                    Adds one token to your recruiting budget for free-agency negotiations.
                                </p>
                                <button
                                    class="mt-3 w-full rounded-lg bg-violet-700 hover:bg-violet-800 text-white font-black text-xs py-2 transition shadow-sm"
                                    onclick="app.buyStoreItem('token', 3.00)">
                                    Buy · $3.00
                                </button>
                            </div>

                            <!-- Light recovery -->
                            <div class="rounded-xl border border-orange-200 bg-gradient-to-br from-orange-50 to-white p-3 flex flex-col">
                                <div class="flex items-start justify-between gap-2">
                                    <span class="text-2xl">🍊</span>
                                    <span class="text-[9px] font-black uppercase tracking-wider text-orange-700 bg-orange-100 rounded-full px-2 py-1">
                                        Recovery
                                    </span>
                                </div>
                                <h5 class="font-black text-sm text-slate-900 mt-2">
                                    Orange Slices
                                </h5>
                                <p class="text-[11px] text-slate-600 mt-1 flex-grow">
                                    Reduce fatigue by 10 for every rostered player. A cheap top-up before a tough week.
                                </p>
                                <button
                                    class="mt-3 w-full rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-black text-xs py-2 transition shadow-sm"
                                    onclick="app.buyStoreItem('orange', 2.00)">
                                    Buy · $2.00
                                </button>
                            </div>

                            <!-- Strong recovery -->
                            <div class="rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-3 flex flex-col">
                                <div class="flex items-start justify-between gap-2">
                                    <span class="text-2xl">🧃</span>
                                    <span class="text-[9px] font-black uppercase tracking-wider text-sky-700 bg-sky-100 rounded-full px-2 py-1">
                                        Recovery
                                    </span>
                                </div>
                                <h5 class="font-black text-sm text-slate-900 mt-2">
                                    Capri Sun Crate
                                </h5>
                                <p class="text-[11px] text-slate-600 mt-1 flex-grow">
                                    Reduce fatigue by 30 for every rostered player when the team needs a bigger recovery boost.
                                </p>
                                <button
                                    class="mt-3 w-full rounded-lg bg-sky-700 hover:bg-sky-800 text-white font-black text-xs py-2 transition shadow-sm"
                                    onclick="app.buyStoreItem('caprisun', 6.00)">
                                    Buy · $6.00
                                </button>
                            </div>

                            <!-- Morale -->
                            <div class="rounded-xl border border-rose-200 bg-gradient-to-br from-rose-50 to-white p-3 flex flex-col">
                                <div class="flex items-start justify-between gap-2">
                                    <span class="text-2xl">🍕</span>
                                    <span class="text-[9px] font-black uppercase tracking-wider text-rose-700 bg-rose-100 rounded-full px-2 py-1">
                                        Team Morale
                                    </span>
                                </div>
                                <h5 class="font-black text-sm text-slate-900 mt-2">
                                    Pizza Party
                                </h5>
                                <p class="text-[11px] text-slate-600 mt-1 flex-grow">
                                    Restore team happiness and clear locker-room rivalries. Expensive, but useful when the team is falling apart.
                                </p>
                                <button
                                    class="mt-3 w-full rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-black text-xs py-2 transition shadow-sm"
                                    onclick="app.buyStoreItem('pizza', 25.00)">
                                    Buy · $25.00
                                </button>
                            </div>

                            <!-- Permanent Training Upgrade -->
                            <div class="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-3 flex flex-col">
                                <div class="flex items-start justify-between gap-2">
                                    <span class="text-2xl">🏋️</span>
                                    <span class="text-[9px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-100 rounded-full px-2 py-1">
                                        Permanent Upgrade
                                    </span>
                                </div>

                                <h5 class="font-black text-sm text-slate-900 mt-2">
                                    Training Equipment
                                </h5>

                                <div class="mt-1 flex items-center justify-between gap-2">
                                    <span class="text-xs font-bold text-emerald-800">
                                        Level ${trainingEquipmentLevel}/3
                                    </span>
                                    <span class="text-xs font-black text-emerald-700">
                                        +${trainingEquipmentLevel * 10}%
                                    </span>
                                </div>

                                <div class="w-full h-2 mt-2 rounded-full bg-emerald-100 overflow-hidden">
                                    <div
                                        class="h-full rounded-full bg-emerald-600 transition-all"
                                        style="width: ${(trainingEquipmentLevel / 3) * 100}%">
                                    </div>
                                </div>

                                <p class="text-[11px] text-slate-600 mt-2 flex-grow">
                                    Improve progress earned from staff-assigned player training.
                                    Each level adds 10%. This investment persists between weeks.
                                </p>

                                ${trainingEquipmentLevel >= 3 ? `
                                    <div class="mt-3 w-full rounded-lg bg-slate-100 text-slate-500 font-black text-xs py-2 text-center border border-slate-200">
                                        MAX LEVEL REACHED
                                    </div>
                                ` : `
                                    <button
                                        class="mt-3 w-full rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-black text-xs py-2 transition shadow-sm"
                                        onclick="app.buyStoreItem('trainingEquipment', ${nextTrainingEquipmentPrice.toFixed(2)})">
                                        Upgrade to Level ${trainingEquipmentLevel + 1} · $${nextTrainingEquipmentPrice.toFixed(2)}
                                    </button>
                                `}
                            </div>

                            <!-- Permanent Scouting Upgrade -->
                            <div class="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-3 flex flex-col">
                                <div class="flex items-start justify-between gap-2">
                                    <span class="text-2xl">🔭</span>
                                    <span class="text-[9px] font-black uppercase tracking-wider text-indigo-700 bg-indigo-100 rounded-full px-2 py-1">
                                        Permanent Upgrade
                                    </span>
                                </div>

                                <h5 class="font-black text-sm text-slate-900 mt-2">
                                    Scouting Toolkit
                                </h5>

                                <div class="mt-1 flex items-center justify-between gap-2">
                                    <span class="text-xs font-bold text-indigo-800">
                                        Level ${scoutingToolkitLevel}/3
                                    </span>
                                    <span class="text-xs font-black text-indigo-700">
                                        +${scoutingToolkitLevel * 10}%
                                    </span>
                                </div>

                                <div class="w-full h-2 mt-2 rounded-full bg-indigo-100 overflow-hidden">
                                    <div
                                        class="h-full rounded-full bg-indigo-600 transition-all"
                                        style="width: ${(scoutingToolkitLevel / 3) * 100}%">
                                    </div>
                                </div>

                                <p class="text-[11px] text-slate-600 mt-2 flex-grow">
                                    Improve progress toward scouting reports for external prospects.
                                    Better scouting productivity does not automatically reveal hidden ratings.
                                </p>

                                ${scoutingToolkitLevel >= 3 ? `
                                    <div class="mt-3 w-full rounded-lg bg-slate-100 text-slate-500 font-black text-xs py-2 text-center border border-slate-200">
                                        MAX LEVEL REACHED
                                    </div>
                                ` : `
                                    <button
                                        class="mt-3 w-full rounded-lg bg-indigo-700 hover:bg-indigo-800 text-white font-black text-xs py-2 transition shadow-sm"
                                        onclick="app.buyStoreItem('scoutingToolkit', ${nextScoutingToolkitPrice.toFixed(2)})">
                                        Upgrade to Level ${scoutingToolkitLevel + 1} · $${nextScoutingToolkitPrice.toFixed(2)}
                                    </button>
                                `}
                            </div>
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

                                <!-- SEASONAL DUES MANAGEMENT -->
                <div class="bg-white rounded-sm border border-slate-300 shadow-sm p-4 flex flex-col h-[450px]">
                    <div class="mb-3 border-b pb-3">
                        <h4 class="font-black text-sm uppercase text-slate-800">
                            Season Dues Management
                        </h4>

                        <p class="text-[10px] text-slate-500 mt-1">
                            Players contribute $9.00 once per season.
                            Waivers must be queued before collection.
                            Each queued waiver costs 2 Street Cred;
                            waived players gain +10 happiness when dues are collected.
                        </p>

                        <div class="mt-3 rounded border px-3 py-2 ${
                            seasonDuesSettled
                                ? 'bg-emerald-50 border-emerald-200'
                                : 'bg-amber-50 border-amber-200'
                        }">
                            <p class="text-xs font-bold ${
                                seasonDuesSettled
                                    ? 'text-emerald-800'
                                    : 'text-amber-800'
                            }">
                                ${
                                    seasonDuesSettled
                                        ? `Season ${currentYear} dues settled`
                                        : `Season ${currentYear} dues not yet collected`
                                }
                            </p>

                            <p class="text-[10px] mt-1 text-slate-600">
                                ${
                                    seasonDuesSettled
                                        ? 'Waivers are locked until next season.'
                                        : `${waivedDuesIds.size} waiver${waivedDuesIds.size === 1 ? '' : 's'} queued. You can change them before collection.`
                                }
                            </p>
                        </div>
                    </div>

                    <div class="overflow-y-auto flex-grow space-y-1">
                        ${Game.getUIRosterObjects(team).map(p => {
                            const isWaived = waivedDuesIds.has(String(p.id));

                            return `
                                <div class="flex justify-between items-center gap-2 bg-slate-50 p-2 rounded border border-slate-200">
                                    <span class="font-bold text-xs truncate">
                                        ${p.name}
                                    </span>

                                    ${
                                        seasonDuesSettled
                                            ? `<span class="text-[9px] bg-emerald-100 text-emerald-800 font-bold px-2 py-1 rounded whitespace-nowrap">Settled</span>`
                                            : isWaived
                                                ? `<button class="text-[9px] bg-amber-100 text-amber-900 font-bold px-2 py-1 rounded hover:bg-amber-200 transition whitespace-nowrap" onclick="app.waivePlayerDues('${p.id}')">Undo Waiver</button>`
                                                : `<button class="text-[9px] bg-slate-900 text-white font-bold px-2 py-1 rounded hover:bg-slate-700 transition whitespace-nowrap" onclick="app.waivePlayerDues('${p.id}')">Waive $9.00</button>`
                                    }
                                </div>
                            `;
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
            Game.saveGameState(activeSaveKey);
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
        const enabled = e.target.checked;
        setDebugMode(enabled);
        syncDebugUI(enabled);
        refreshDebugModeButton();
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
                if (btn.dataset.subTab === 'staff') {
                    UI.renderStaffTab(gameState);
                }

                if (btn.dataset.subTab === 'staff-market') {
                    UI.renderStaffMarketTab?.(gameState);
                }

                if (btn.dataset.subTab === 'finances') {
                    window.app.renderFinancesTab(gameState);
                }

                if (btn.dataset.subTab === 'store') {
                    window.app.renderStoreTab(gameState);
                }

                if (btn.dataset.subTab === 'social') {
                    renderSocialNetworkTab(gameState);
                }
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
        const enabled = !isDebugMode();
        setDebugMode(enabled);
        syncDebugUI(enabled);
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
    document.getElementById('sim-speed-play')
    ?.addEventListener('click', () => UI.setSimSpeed(1));

document.getElementById('sim-speed-fast')
    ?.addEventListener('click', () => UI.setSimSpeed(2));

document.getElementById('sim-speed-faster')
    ?.addEventListener('click', () => UI.setSimSpeed(5));

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

    // Draft Sub-View Tabs (Overview, Physicals, Skills, Watchlist, Pee Wee Stats)
    document.querySelectorAll('.draft-view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;

            const defaultSorts = {
                overview: 'potential',
                physicals: 'speed',
                skills: 'playbookIQ',
                watchlist: 'potential',
                youthStats: 'youthTouchdowns'
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

        if (!messageItem?.dataset.messageId) return;

        gameState = Game.getGameState();

        if (!gameState?.messages) return;

        const message = gameState.messages.find(
            m => m && String(m.id) === messageItem.dataset.messageId
        );

        if (!message) return;

        // Mark the message as read before refreshing the inbox.
        Game.markMessageAsRead(message.id);

        UI.renderMessagesTab(gameState);
        UI.updateMessagesNotification(gameState.messages);
        Game.saveGameState(activeSaveKey);

        const escapeHtml = (value) => String(value ?? '')
            .replace(/[&<>"']/g, char => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            })[char]);

        const categories = {
            staff: 'Staff',
            finances: 'Finances',
            scouting: 'Scouting',
            preparation: 'Preparation',
            roster: 'Roster',
            season: 'Season',
            community: 'Community',
            general: 'General'
        };

        const category = categories[message.category] || 'General';

        const priorityLabels = {
            urgent: 'Urgent',
            important: 'Important',
            normal: 'Normal'
        };

        const priority = priorityLabels[message.priority] || 'Normal';

        // Message bodies may contain intentional HTML formatting used
        // by existing system-generated messages.
        const bodyHtml = `
            <div class="space-y-4">
                <div class="flex flex-wrap items-center gap-2">
                    <span class="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                        ${escapeHtml(category)}
                    </span>
                    <span class="rounded ${
                        message.priority === 'urgent'
                            ? 'bg-rose-100 text-rose-700'
                            : message.priority === 'important' || message.actionRequired
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-600'
                    } px-2 py-1 text-xs font-semibold">
                        ${escapeHtml(message.actionRequired ? 'Action needed' : priority)}
                    </span>
                </div>

                <div class="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                    ${message.body ?? ''}
                </div>

                ${message.actionRequired ? `
                    <div class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        <strong>Follow-up needed</strong>
                        <p class="mt-1">
                            Review the relevant team area to decide what to do next.
                        </p>
                    </div>
                ` : ''}
            </div>
        `;

        // Only allow known navigation destinations. Never execute
        // functions or arbitrary commands stored in a saved message.
        const action = message.action;

        const allowedTabs = new Set([
            'my-team',
            'depth-chart',
            'free-agents',
            'messages',
            'front-office'
        ]);

        const allowedFrontOfficeTabs = new Set([
            'staff',
            'finances',
            'social'
        ]);

        const canNavigate =
            action?.type === 'open_tab' &&
            allowedTabs.has(action.tab) &&
            (
                action.tab !== 'front-office' ||
                !action.subTab ||
                allowedFrontOfficeTabs.has(action.subTab)
            );

        const actionLabels = {
            'my-team': 'Open Team',
            'depth-chart': 'Open Depth Chart',
            'free-agents': 'Open Free Agents',
            'messages': 'Return to Inbox',
            'front-office': 'Review Front Office'
        };

        const actionLabel = canNavigate
            ? (
                action.tab === 'front-office' && action.subTab === 'staff'
                    ? 'Review Staff'
                    : action.tab === 'front-office' && action.subTab === 'finances'
                        ? 'Review Finances'
                        : action.tab === 'front-office' && action.subTab === 'social'
                            ? 'Review Social Network'
                            : actionLabels[action.tab]
            )
            : 'Close';

        UI.showModal(
            message.subject || '(No Subject)',
            bodyHtml,
            canNavigate ? () => {
                const latestState = Game.getGameState();

                if (!latestState) return;

                UI.switchTab(action.tab, latestState);

                if (action.tab === 'front-office' && action.subTab) {
                    const subTabButton = Array.from(
                        document.querySelectorAll('.fo-tab')
                    ).find(btn => btn.dataset.subTab === action.subTab);

                    subTabButton?.click();
                }
            } : null,
            actionLabel,
            null,
            'Close'
        );
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
