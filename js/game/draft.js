// js/game/draft.js - Draft Manager

import { game, getPlayer, getRosterObjects, addMessage, playerMap } from './state.js';
import {
    calculateOverall,
    estimateBestPosition,
    positionOverallWeights
} from './player.js';

import { isPlayerViableForPosition } from './depth_chart.js';
import { offenseFormations, defenseFormations } from '../data.js';
import { addPlayerToTeam, getCurrentRosterLimit } from './season.js';

export const DRAFT_ROUNDS_ROOKIE = 3;

const OFFENSIVE_POSITION_FITS = ['QB', 'RB', 'WR', 'TE', 'OL'];
const DEFENSIVE_POSITION_FITS = ['DL', 'LB', 'DB'];

function getBestPositionFit(player, positions) {
    if (!player) return { position: '—', ovr: 0 };

    const supportedPositions = positions.filter(position =>
        positionOverallWeights[position]
    );

    const viablePositions = supportedPositions.filter(position =>
        isPlayerViableForPosition(player, position)
    );

    // Match the UI fallback: evaluate supported positions if none pass viability.
    const positionsToEvaluate = viablePositions.length > 0
        ? viablePositions
        : supportedPositions;

    const ratings = positionsToEvaluate.map(position => ({
        position,
        ovr: calculateOverall(player, position)
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

/**
 * Calculates a prospect's value to a specific team based on ability,
 * ceiling (potential), positional need, and coach preference.
 */
export function calculateDraftValue(player, team) {
    if (!player || !team) return 0;

    const scout = team.staff?.scout;
    const coach = team.staff?.coach || team.coach;

    // AI FOG OF WAR: The AI evaluates players through its Scout's imperfect eyes!
    const scoutAccuracy = scout ? ((scout.ratings?.evalTechnique + scout.ratings?.evalPhysicals) / 200) : 0.5;

     // Evaluate the prospect independently on offense and defense.
    const fits = getBestTwoWayFits(player);

    // Preserve the existing scouting uncertainty.
    const noise = Math.round((Math.random() - 0.5) * (1.0 - scoutAccuracy) * 16);

    const offOvr = Math.max(
        20,
        Math.min(99, calculateOverall(player, fits.offense.position) + noise)
    );

    const defOvr = Math.max(
        20,
        Math.min(99, calculateOverall(player, fits.defense.position) + noise)
    );

    // Both sides contribute to perceived player value.
    const ovr = Math.round((offOvr + defOvr) / 2);

    const gmDirective = team.gameplan?.gmDirective || 'COACH_AUTONOMY';
    const coachPersonality = coach?.biases?.personality?.name;
    const ego = player.personality?.ego || 50;
    const ethic = player.personality?.workEthic || 50;

    // Dynamic Weights by GM Directive:
    // WIN_NOW values day-one ability (45%) over raw ceiling (15%)
    // DEVELOP_YOUTH values ceiling/potential (45%) over current polish (20%)
    let abilityWeight = 0.35;
    let potentialWeight = 0.30;

    if (gmDirective === 'WIN_NOW') {
        abilityWeight = 0.45;
        potentialWeight = 0.15;
    } else if (gmDirective === 'DEVELOP_YOUTH') {
        abilityWeight = 0.20;
        potentialWeight = 0.45;
    }

    // 1. Perceived Ability
    let abilityScore = ovr * abilityWeight;

    // Scout & Coach Personality Bias
    const scoutBias = scout?.biases?.scouting?.name;
    if (scoutBias === 'Speed Chaser') {
        const spd = player.attributes?.physical?.speed || 50;
        if (spd > 68) abilityScore += (spd - 68) * 0.45;
    } else if (scoutBias === 'Character First' || coachPersonality === 'Old-School Disciplinarian') {
        if (ego > 70) abilityScore -= (ego - 70) * 0.60; // Strictly devalues divas
        if (ethic > 70) abilityScore += (ethic - 70) * 0.35; // Reaches for gym rats
    }

    // 2. Potential / Ceiling
    const potentialMap = { 'A': 95, 'B': 82, 'C': 68, 'D': 52, 'F': 35 };
    let potScore = (potentialMap[player.potential] || 65) * potentialWeight;

    if (gmDirective === 'DEVELOP_YOUTH' && player.age <= 12 && (player.potential === 'A' || player.potential === 'B')) {
        potScore += 12; // Massive premium on 12-year-old wonderkids
    }

    // 3. Positional Need (25%)
    // Evaluate offensive and defensive roster needs independently.
    const roster = getRosterObjects(team);

    // Count every roster player who is viable at each position.
    // A two-way player may contribute to both an offensive and
    // a defensive position group.
    const positionCounts = {};

    Object.keys(positionOverallWeights).forEach(position => {
        positionCounts[position] = roster.filter(p =>
            isPlayerViableForPosition(p, position)
        ).length;
    });

    const offensePersonnel =
        offenseFormations[team.formations?.offense]?.personnel || {};

    const defensePersonnel =
        defenseFormations[team.formations?.defense]?.personnel || {};

    function getPositionNeedMultiplier(position, personnel) {
        const formationTarget = Number(personnel[position]) || 0;
        const countAtPos = positionCounts[position] || 0;

        if (formationTarget <= 0) {
            // The active formation does not use this position.
            return 0.75;
        }

        const positionGap = formationTarget - countAtPos;

        if (positionGap > 0) {
            // A bigger shortage increases draft priority.
            return 1.0 + Math.min(0.55, positionGap * 0.18);
        }

        // Reduce urgency as the position becomes adequately staffed.
        return Math.max(
            0.70,
            1.0 - Math.min(0.30, Math.abs(positionGap) * 0.10)
        );
    }

    const offNeedMultiplier = getPositionNeedMultiplier(
        fits.offense.position,
        offensePersonnel
    );

    const defNeedMultiplier = getPositionNeedMultiplier(
        fits.defense.position,
        defensePersonnel
    );

    // Give each side half of the positional-need contribution.
    const needScore = 0.25 * (
        offOvr * offNeedMultiplier +
        defOvr * defNeedMultiplier
    ) / 2;

    // 4. Coach Scheme & Attribute Bias (10%)
    let coachFit = 0;
    if (coach?.attributePreferences) {
        for (const cat in player.attributes) {
            for (const attr in player.attributes[cat]) {
                const weight = coach.attributePreferences[cat]?.[attr] || 1.0;
                coachFit += (player.attributes[cat][attr] || 0) * (weight - 1.0);
            }
        }
    }
    const fitScore = Math.max(-10, Math.min(15, coachFit)) * 0.10;

    return abilityScore + potScore + needScore + fitScore;
}

/**
 * Sets up the draft order and pool.
 * Year 1: Inaugural draft (fill rosters).
 * Year 2+: 3-round fixed Rookie Draft (60 picks).
 */
import { generatePlayer, generateDraftClassModifiers } from './player.js';

export function setupDraft() {
    if (!game || !game.teams) return;
    game.draftOrder = [];
    game.currentPick = 0;
    game.pickHistory = [];

    const mainTeams = game.teams.filter(t => t.leagueType === 'main');
    const rosterLimit = getCurrentRosterLimit(game);

    if (game.year === 1) {
        const sortedTeams = [...mainTeams].sort(() => 0.5 - Math.random());
        game.draftClass = game.players.filter(p => !p.teamId && p.age >= 11 && p.personality?.entersDraft !== false);

        mainTeams.forEach(t => t.draftNeeds = Math.max(0, rosterLimit - (t.roster?.length || 0)));
        const maxNeeds = Math.max(0, ...mainTeams.map(t => t.draftNeeds || 0));

        for (let i = 0; i < maxNeeds; i++) {
            game.draftOrder.push(...(i % 2 === 0 ? sortedTeams : [...sortedTeams].reverse()));
        }
    } else {
        // 1. Order by reverse standings from the season that just finished
        let sortedTeams;
        if (game.nextDraftOrder && Array.isArray(game.nextDraftOrder)) {
            sortedTeams = game.nextDraftOrder.map(id => mainTeams.find(t => t.id === id)).filter(Boolean);
        }
        if (!sortedTeams || sortedTeams.length === 0) {
            sortedTeams = [...mainTeams].sort((a, b) =>
                (a.wins || 0) - (b.wins || 0) || (b.losses || 0) - (a.losses || 0)
            );
        }

        // 3 Fixed Rounds = 60 total picks
        for (let r = 0; r < DRAFT_ROUNDS_ROOKIE; r++) {
            game.draftOrder.push(...(r % 2 === 0 ? sortedTeams : [...sortedTeams].reverse()));
        }

        // 2. Ensure at least 65 draft-eligible prospects exist so picks don't run out
        if (!game.draftClass) game.draftClass = [];
        game.draftClass = game.draftClass.filter(p => !p.teamId);

        const needed = Math.max(0, 65 - game.draftClass.length);
        if (needed > 0) {
            const classMods = generateDraftClassModifiers();
            for (let i = 0; i < needed; i++) {
                const rookie = generatePlayer(12, 12, classMods); // STRICTLY AGE 12
                rookie.lifecycle = 'draft_eligible';
                if (!rookie.personality) rookie.personality = {};
                rookie.personality.entersDraft = true;
                game.players.push(rookie);
                playerMap.set(rookie.id, rookie);
                game.draftClass.push(rookie);
            }
        }
    }
}

/**
 * AI executes a pick using calculateDraftValue from the eligible draft pool.
 */
export function simulateAIPick(team) {
    if (!team || !game || (team.roster?.length || 0) >= getCurrentRosterLimit(game)) return null;

    let availableProspects = (game.draftClass || []).filter(p => !p.teamId);
    if (availableProspects.length === 0) {
        availableProspects = (game.players || []).filter(p => !p.teamId && p.age < 17 && p.personality?.entersDraft !== false);
    }
    if (availableProspects.length === 0) return null;

    let bestProspect = null;
    let highestValue = -Infinity;

    availableProspects.forEach(prospect => {
        const val = calculateDraftValue(prospect, team);
        if (val > highestValue) {
            highestValue = val;
            bestProspect = prospect;
        }
    });

    if (bestProspect) {
        addPlayerToTeam(bestProspect, team);
        bestProspect.lifecycle = 'active';
        game.draftClass = (game.draftClass || []).filter(p => p.id !== bestProspect.id);
    }
    return bestProspect;
}

export function simulateHistoricalDraft(yearNum) {
    if (!game) return;
    setupDraft();
    const draftResults = [];

    while (game.currentPick < game.draftOrder.length) {
        const team = game.draftOrder[game.currentPick];
        const pickedPlayer = simulateAIPick(team);
        if (pickedPlayer) {
            draftResults.push({
                pick: game.currentPick + 1,
                teamName: team.name,
                playerName: pickedPlayer.name,
                pos: estimateBestPosition(pickedPlayer)
            });
        }
        game.currentPick++;
    }
    completeDraft();

    if (game.history && game.history.seasons) {
        const season = game.history.seasons.find(s => s.year === yearNum);
        if (season) season.draftResults = draftResults;
    }

    return draftResults;
}
/**
 * Concludes the draft: undrafted rookies become active street Free Agents.
 */
export function completeDraft() {
    if (!game || !game.draftClass) return;

    // Remaining undrafted prospects hit neighborhood free agency
    game.draftClass.forEach(prospect => {
        if (!prospect.teamId) {
            prospect.lifecycle = 'active';
        }
    });
    game.draftClass = [];
}
