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
    const cred = team.socialProfile?.streetCred || 50;
    // Base interest scaled realistically (50 Cred = 32 base points)
    let interest = Math.round(cred * 0.65);
    const reasons = [];

    if (team.tier === 1) {
        interest += 15;
        reasons.push("Premier Parks floodlights prestige (+15)");
    } else {
        reasons.push("Sandlot Circuit grassroots challenge");
    }

    // Former player loyalty bonus
    if (staff.formerPlayerBio && staff.formerPlayerBio.includes(team.name)) {
        interest += 30;
        reasons.push(`🎓 Alma mater loyalty to ${team.name} (+30)`);
    }

    // High-reputation coaches demand compensation or tokens
    const ratingAvg = Math.round(
        ((staff.ratings?.offSchemeMastery || 50) + 
         (staff.ratings?.evalPhysicals || 50) + 
         (staff.ratings?.teaching || 50)) / 3
    );

    if (ratingAvg > 68) {
        const prestigeDemand = Math.round((ratingAvg - 68) * 0.9);
        interest -= prestigeDemand;
        reasons.push(`High reputation expectations (-${prestigeDemand})`);
    }

    // =========================================================================
    // STAFF BIAS & PERSONALITY FIT WITH ROSTER
    // =========================================================================
    const roster = getRosterObjects(team);
    const personality = staff.biases?.personality?.name;
    const tactical = staff.biases?.tactical?.name;
    const teamOffense = team.formations?.offense || 'Balanced';

    // 1. Tactical Bias vs. Team Scheme Fit
    if (roleKey === 'coach' && tactical) {
        if (tactical === 'Air Raid Purist') {
            if (['Spread', 'Empty', 'Trips'].includes(teamOffense)) {
                interest += 15;
                reasons.push("Loves your Spread passing formation (+15)");
            } else if (['Power', 'Jumbo'].includes(teamOffense)) {
                interest -= 25;
                reasons.push("Refuses to coach heavy under-center Power offense (-25)");
            }
        } else if (tactical === 'Smashmouth Zealot') {
            if (['Power', 'Jumbo', 'Pistol'].includes(teamOffense)) {
                interest += 15;
                reasons.push("Loves your physical run-first offensive formation (+15)");
            } else if (['Spread', 'Empty'].includes(teamOffense)) {
                interest -= 25;
                reasons.push("Dislikes finesse spread formations (-25)");
            }
        }
    }

    // 2. Personality Trait vs. Locker Room Chemistry
    if (personality === 'Old-School Disciplinarian') {
        const divasOnTeam = roster.filter(p => (p.personality?.ego || 50) > 75).length;
        if (divasOnTeam >= 2) {
            interest -= 20;
            reasons.push(`Refuses to babysit ${divasOnTeam} high-ego divas on roster (-20)`);
        } else {
            interest += 10;
            reasons.push("Respects your humble, hard-working locker room (+10)");
        }
    } else if (personality === "Peaked in '94") {
        if (cred < 55) {
            interest -= 15;
            reasons.push("Demands a team with higher neighborhood street respect (-15)");
        }
    } else if (personality === "Players' Coach") {
        interest += 10;
        reasons.push("Excited to work with your young roster (+10)");
    }

    // Favor tokens offered as sweeteners/bribes
    if (tokensOffered > 0) {
        const tokenBoost = tokensOffered * 22;
        interest += tokenBoost;
        reasons.push(`Offered ${tokensOffered} Favor Token(s) (+${tokenBoost})`);
    }

    const threshold = 40;
    const accepted = interest >= threshold;

    return {
        accepted,
        interestScore: Math.max(0, Math.min(100, interest)),
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