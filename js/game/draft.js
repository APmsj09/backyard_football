// js/game/draft.js - Draft Manager

import { game, getPlayer, getRosterObjects, addMessage } from './state.js';
import { calculateOverall, estimateBestPosition } from './player.js';
import { addPlayerToTeam, ROSTER_LIMIT } from './season.js';

export const DRAFT_ROUNDS_ROOKIE = 3;

/**
 * Calculates a prospect's value to a specific team based on ability,
 * ceiling (potential), positional need, and coach preference.
 */
export function calculateDraftValue(player, team) {
    if (!player || !team || !team.coach) return 0;

    const pos = estimateBestPosition(player);
    const ovr = calculateOverall(player, pos);
    const coach = team.coach;

    // 1. Current Ability (35%)
    const abilityScore = ovr * 0.35;

    // 2. Potential / Ceiling (30%)
    const potentialMap = { 'A': 95, 'B': 82, 'C': 68, 'D': 52, 'F': 35 };
    const potScore = (potentialMap[player.potential] || 65) * 0.30;

    // 3. Positional Need (25%)
    const roster = getRosterObjects(team);
    const countAtPos = roster.filter(p => estimateBestPosition(p) === pos).length;
    let needMultiplier = 1.0;
    if (pos === 'QB') {
        needMultiplier = countAtPos === 0 ? 1.8 : (countAtPos === 1 ? 1.1 : 0.4);
    } else if (['OL', 'DL'].includes(pos)) {
        needMultiplier = countAtPos < 3 ? 1.5 : (countAtPos < 5 ? 1.1 : 0.6);
    } else {
        needMultiplier = countAtPos < 4 ? 1.4 : (countAtPos < 7 ? 1.0 : 0.7);
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
export function setupDraft() {
    if (!game || !game.teams) return;
    game.draftOrder = [];
    game.currentPick = 0;
    game.pickHistory = [];

    // ONLY the 20 main-league teams participate (Tier 1 & Tier 2)
    const mainTeams = game.teams.filter(t => t.leagueType === 'main');

    let sortedTeams;
    if (game.year === 1) {
        // Lottery shuffle for inaugural draft
        sortedTeams = [...mainTeams].sort(() => 0.5 - Math.random());
        
        // Year 1: Populate draft class with inaugural tryouts (age >= 11)
        game.draftClass = game.players.filter(p => !p.teamId && p.age >= 11 && p.personality?.entersDraft !== false);

        // Snake draft to fill founding rosters
        mainTeams.forEach(t => t.draftNeeds = Math.max(0, ROSTER_LIMIT - (t.roster?.length || 0)));
        const maxNeeds = Math.max(0, ...mainTeams.map(t => t.draftNeeds || 0));

        for (let i = 0; i < maxNeeds; i++) {
            game.draftOrder.push(...(i % 2 === 0 ? sortedTeams : [...sortedTeams].reverse()));
        }
    } else {
        // Year 2+: Order based on reverse standings (worst record picks #1)
        sortedTeams = [...mainTeams].sort((a, b) => 
            (a.wins || 0) - (b.wins || 0) || (b.losses || 0) - (a.losses || 0)
        );

        // 3 Fixed Rounds = 60 total picks
        for (let r = 0; r < DRAFT_ROUNDS_ROOKIE; r++) {
            game.draftOrder.push(...(r % 2 === 0 ? sortedTeams : [...sortedTeams].reverse()));
        }
    }
}

/**
 * AI executes a pick using calculateDraftValue from the eligible draft pool.
 */
export function simulateAIPick(team) {
    if (!team || !game || team.roster.length >= ROSTER_LIMIT) return null;

    // Pull strictly from the draft class
    const availableProspects = (game.draftClass || []).filter(p => !p.teamId);
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
        
        // Remove from draft class
        game.draftClass = game.draftClass.filter(p => p.id !== bestProspect.id);
    }
    return bestProspect;
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