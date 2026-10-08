// js/game/negotiations.js - Player & Staff Contract Negotiations & Retention

import { getRelationshipLevel, getPlayer, getRosterObjects } from './state.js';
import { relationshipLevels } from '../data.js';
import { calculateOverall, estimateBestPosition } from './player.js';

/**
 * Evaluates a player free agency pitch/offer.
 */
export function evaluatePlayerNegotiation(player, team, offer = {}) {
    // offer = { role: 'STARTER' | 'ROTATION' | 'BENCH', tokensOffered: 0-2, promiseTouches: 'FEATURED' | 'NORMAL' }
    const roleOffered = offer.role || 'ROTATION';
    const tokens = offer.tokensOffered || 0;
    const roster = getRosterObjects(team);

    let interest = Math.round((team.socialProfile?.streetCred || 50) * 0.25);
    if (team.tier === 1) interest += 10;
    if (team.tier === 2) interest -= 5;

    const reasons = [];

    // 1. Social Anchors (BFF, Friends, Rivals)
    if (player.social?.bestFriendId && roster.some(r => r.id === player.social.bestFriendId)) {
        interest += 30;
        reasons.push("🤝 Best friend is on team (+30)");
    }
    const friendsCount = roster.filter(r => player.social?.goodFriendIds?.includes(r.id)).length;
    if (friendsCount > 0) {
        const bonus = Math.min(20, friendsCount * 8);
        interest += bonus;
        reasons.push(`👥 ${friendsCount} friend(s) on team (+${bonus})`);
    }
    const rival = roster.find(r => player.social?.rivalIds?.includes(r.id));
    if (rival) {
        interest -= 45;
        reasons.push(`⚠️ Sworn rival (${rival.name.split(' ')[0]}) is on squad (-45)`);
    }

    // 2. Role & Ego Evaluation
    const ego = player.personality?.ego || 50;
    const bestPos = player.pos || estimateBestPosition(player);
    const ovr = calculateOverall(player, bestPos);

    if (ego > 65 && roleOffered === 'BENCH') {
        interest -= 40;
        reasons.push("😤 Refuses bench role with high ego (-40)");
    } else if (roleOffered === 'STARTER') {
        interest += 15;
        reasons.push("⭐ Promised Starting Role (+15)");
    }

    if (offer.promiseTouches === 'FEATURED') {
        interest += 15;
        reasons.push("🏈 Promised focal touches (+15)");
    }

    // 3. Coach Personality Match
    const coachStyle = team.staff?.coach?.biases?.personality?.name;
    if (coachStyle === "Players' Coach") {
        interest += 10;
        reasons.push("😊 Loves Players' Coach (+10)");
    } else if (coachStyle === "Old-School Disciplinarian" && ego > 70) {
        interest -= 20;
        reasons.push("⚡ Clashes with Disciplinarian coach (-20)");
    }

    // 4. Favor Token Sweetener (Bribe / Favors owed)
    if (tokens > 0) {
        const tokenBoost = tokens * 18;
        interest += tokenBoost;
        reasons.push(`🤝 Favor Tokens offered (+${tokenBoost})`);
    }

    const accepted = interest >= 50;
    return {
        accepted,
        interestScore: Math.max(0, Math.min(100, interest)),
        reasons,
        roleOffered,
        promiseTouches: offer.promiseTouches
    };
}

/**
 * Evaluates whether an available staff member agrees to sign.
 */
export function evaluateStaffNegotiation(staff, team, roleKey, tokensOffered = 0) {
    let interest = Math.round((team.socialProfile?.streetCred || 50) * 0.3);
    const reasons = [];

    if (team.tier === 1) {
        interest += 15;
        reasons.push("Prestige of Tier 1 Premier league (+15)");
    }

    // Former player loyalty bonus
    if (staff.formerPlayerBio && staff.formerPlayerBio.includes(team.name)) {
        interest += 35;
        reasons.push(`🎓 Alma mater loyalty to ${team.name} (+35)`);
    }

    // Staff tactical match with team formation
    const offScheme = staff.ratings?.offSchemeMastery || 50;
    if (roleKey === 'coach' && offScheme > 70) {
        interest -= 10; // High-rated coaches want good teams
    }

    if (tokensOffered > 0) {
        interest += tokensOffered * 20;
        reasons.push(`Offered ${tokensOffered} Favor Tokens`);
    }

    return {
        accepted: interest >= 45,
        interestScore: interest,
        reasons
    };
}

/**
 * Evaluates offseason retention (whether an active player stays or walks).
 */
export function evaluatePlayerRetention(player, team, snapsThisSeason = 0) {
    if (player.age >= 19) return { willStay: false, reason: "Graduated High School" };

    const ego = player.personality?.ego || 50;
    const loyalty = player.personality?.loyalty || 50;
    const happiness = player.expectations?.happiness ?? 100;
    const isStarter = Object.values(team.depthChart?.offense || {}).includes(player.id) ||
                      Object.values(team.depthChart?.defense || {}).includes(player.id);

    let stayScore = loyalty * 0.4 + (happiness * 0.4);

    // Broken role promise penalty
    if (player.activePromise?.role === 'STARTER' && !isStarter) {
        stayScore -= 35;
    }
    // Lack of live snaps
    if (player.expectations?.desiredRole === 'STARTER' && snapsThisSeason < 30) {
        stayScore -= 25;
    }
    // High ego wants to win
    if (team.wins < 3 && ego > 70) {
        stayScore -= 20;
    }

    const willStay = stayScore >= 45;
    let reason = "Happy with current role and teammates.";
    if (!willStay) {
        if (ego > 70 && !isStarter) reason = "Refused to ride bench (Ego clash).";
        else if (loyalty < 40) reason = "Demanded transfer to a better situation.";
        else reason = "Frustrated with lack of playing time.";
    }

    return { willStay, reason, stayScore: Math.round(stayScore) };
}