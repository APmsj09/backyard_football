// js/game/draft.js - Draft Manager

import { game, getPlayer, getRosterObjects, addMessage, playerMap } from './state.js';
import { calculateOverall, estimateBestPosition } from './player.js';
import { offenseFormations, defenseFormations } from '../data.js';
import { addPlayerToTeam, ROSTER_LIMIT } from './season.js';

export const DRAFT_ROUNDS_ROOKIE = 3;

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

    // Add scouting noise/error based on scout rating (Elite scout = accurate; Bad scout = +/- 8 OVR error)
    const noise = Math.round((Math.random() - 0.5) * (1.0 - scoutAccuracy) * 16);
    const pos = estimateBestPosition(player);
    const ovr = Math.max(20, Math.min(99, calculateOverall(player, pos) + noise));

    // 1. Perceived Ability
    let abilityScore = ovr * 0.35;

    // SCOUT BIAS EFFECT: Scout's personal bias distorts player value
    const scoutBias = scout?.biases?.scouting?.name;
    if (scoutBias === 'Speed Chaser') {
        const spd = player.attributes?.physical?.speed || 50;
        if (spd > 70) abilityScore += (spd - 70) * 0.4; // AI overvalues speed
    } else if (scoutBias === 'Character First') {
        const ego = player.personality?.ego || 50;
        if (ego > 70) abilityScore -= (ego - 70) * 0.5; // AI avoids divas
    }

    // 2. Potential / Ceiling (30%)
    const potentialMap = { 'A': 95, 'B': 82, 'C': 68, 'D': 52, 'F': 35 };
    const potScore = (potentialMap[player.potential] || 65) * 0.30;

    // 3. Positional Need (25%)
    // Use the team's actual formations as a soft roster-building target.
    // This creates coherent AI teams without forcing the AI to draft by position.
    const roster = getRosterObjects(team);

    const positionCounts = {};
    roster.forEach(p => {
        const rosterPos = estimateBestPosition(p);
        positionCounts[rosterPos] = (positionCounts[rosterPos] || 0) + 1;
    });

    const offensePersonnel =
        offenseFormations[team.formations?.offense]?.personnel || {};

    const defensePersonnel =
        defenseFormations[team.formations?.defense]?.personnel || {};

    const formationTarget =
        (offensePersonnel[pos] || 0) +
        (defensePersonnel[pos] || 0);

    const countAtPos = positionCounts[pos] || 0;

    let needMultiplier = 1.0;

    if (formationTarget <= 0) {
        // Formation doesn't naturally use this position.
        // Still draftable if the player is excellent, just less urgent.
        needMultiplier = 0.75;
    } else {
        const positionGap = formationTarget - countAtPos;

        if (positionGap > 0) {
            // Bigger hole = stronger preference, but keep it soft.
            needMultiplier = 1.0 + Math.min(0.55, positionGap * 0.18);
        } else {
            // Once the formation position is adequately stocked,
            // the AI gradually looks elsewhere.
            needMultiplier = Math.max(
                0.70,
                1.0 - Math.min(0.30, Math.abs(positionGap) * 0.10)
            );
        }
    }

    const needScore = (ovr * 0.25) * needMultiplier;

    // 4. Coach Scheme & Attribute Bias (10%)
    let coachFit = 0;
    if (coach.attributePreferences) {
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

    if (game.year === 1) {
        const sortedTeams = [...mainTeams].sort(() => 0.5 - Math.random());
        game.draftClass = game.players.filter(p => !p.teamId && p.age >= 11 && p.personality?.entersDraft !== false);

        mainTeams.forEach(t => t.draftNeeds = Math.max(0, ROSTER_LIMIT - (t.roster?.length || 0)));
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
    if (!team || !game || team.roster.length >= ROSTER_LIMIT) return null;

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