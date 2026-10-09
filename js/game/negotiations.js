// js/game/negotiations.js - Player & Staff Contract Negotiations & Retention

import { getRelationshipLevel, getPlayer, getRosterObjects } from './state.js';
import { relationshipLevels } from '../data.js';
import { calculateOverall, estimateBestPosition } from './player.js';
import { isPlayerViableForPosition } from './depth_chart.js';

/**
 * Generates neighborhood grapevine rumors and competitor interest for a prospect.
 */
export function generatePlayerRumors(player, gameState) {
    if (!player || !gameState) {
        return { heat: 'QUIET', suitorTeams: [], suitorNames: [], rumorText: 'Quiet on the blacktop.', keyFactor: 'Available' };
    }

    const pos = player.pos || estimateBestPosition(player);
    const ovr = calculateOverall(player, pos);
    const ego = player.personality?.ego || 50;
    const workEthic = player.personality?.workEthic || 50;
    const mainTeams = (gameState.teams || []).filter(t => t.leagueType === 'main');

    const idealCounts = { QB: 1, RB: 2, WR: 3, TE: 1, OL: 3, DL: 3, LB: 2, DB: 3 };
    const ideal = idealCounts[pos] || 2;

    const interested = [];

    mainTeams.forEach(team => {
        if (team.isPlayerControlled) return;
        const roster = getRosterObjects(team);
        if (roster.length >= 17) return;

        const count = roster.filter(p => isPlayerViableForPosition(p, pos)).length;
        const deficit = ideal - count;

        let interestScore = deficit * 20;

        // Social bonds
        const hasBFF = player.social?.bestFriendId && roster.some(r => r.id === player.social.bestFriendId);
        if (hasBFF) interestScore += 30;

        const friendCount = roster.filter(r => player.social?.goodFriendIds?.includes(r.id)).length;
        if (friendCount > 0) interestScore += Math.min(18, friendCount * 7);

        const hasRival = roster.some(r => player.social?.rivalIds?.includes(r.id));
        if (hasRival) interestScore -= 50;

        // Player talent & prestige
        if (ovr >= 48) interestScore += 14;
        if (player.potential === 'A' || player.potential === 'B') interestScore += 10;
        if (team.tier === 1) interestScore += 8;

        if (interestScore >= 18) {
            interested.push({ team, score: interestScore, deficit, hasBFF, friendCount });
        }
    });

    interested.sort((a, b) => b.score - a.score);
    const suitorTeams = interested.slice(0, 2).map(i => i.team);

    let heat = 'QUIET';
    if (suitorTeams.length >= 2) heat = 'HOT';
    else if (suitorTeams.length === 1) heat = 'WARM';

    // Build lore-rich rumor text
    let rumorText = '';
    let keyFactor = '';

    if (suitorTeams.length > 0) {
        const topSuitor = suitorTeams[0];
        const topInterest = interested[0];

        if (topInterest.hasBFF) {
            rumorText = `Bleacher whisper: Heavily drawn to ${topSuitor.name} because his best friend plays on their squad.`;
            keyFactor = `Loves ${topSuitor.name} (BFF)`;
        } else if (ego >= 75) {
            rumorText = `Park chatter: High-ego playmaker demands a starting jersey and focal touches or he won't suit up.`;
            keyFactor = 'Demands Starter Role';
        } else if (suitorTeams.length >= 2) {
            rumorText = `Grapevine: Bidding battle heating up between ${suitorTeams[0].name} and ${suitorTeams[1].name}.`;
            keyFactor = `Targeted by ${suitorTeams[0].name} & ${suitorTeams[1].name}`;
        } else if (topInterest.deficit >= 2) {
            rumorText = `${topSuitor.name} have a glaring void at ${pos}; their coach was spotted talking to his family.`;
            keyFactor = `${topSuitor.name} need at ${pos}`;
        } else if (ovr >= 52) {
            rumorText = `Blacktop buzz: Multiple scouts circling his standout skills. Expecting Favor Token bids.`;
            keyFactor = 'High Market Value';
        } else {
            rumorText = `${topSuitor.name} have expressed strong interest in bringing him into their rotation.`;
            keyFactor = `${topSuitor.name} interested`;
        }
    } else {
        if (workEthic >= 75) {
            rumorText = `Quiet market right now. Hard-working gym rat ready to contribute anywhere with playing time.`;
            keyFactor = 'Bargain Target';
        } else if (ego >= 70) {
            rumorText = `Teams have hesitated due to his demanding attitude. Great chance for a team willing to promise starter reps.`;
            keyFactor = 'Ego Hesitation';
        } else {
            rumorText = `Flying under the radar on the playground. Uncontested target for a quick pickup.`;
            keyFactor = 'Open Field';
        }
    }

    return {
        heat,
        suitorTeams,
        suitorNames: suitorTeams.map(t => t.name),
        rumorText,
        keyFactor
    };
}

export function getPlayerMarketIntel(player, gameState) {
    if (!gameState) return generatePlayerRumors(player, gameState);
    gameState._faMarketCache = gameState._faMarketCache || new Map();
    if (!gameState._faMarketCache.has(player.id)) {
        gameState._faMarketCache.set(player.id, generatePlayerRumors(player, gameState));
    }
    return gameState._faMarketCache.get(player.id);
}

export function clearPlayerMarketCache(gameState) {
    if (gameState) gameState._faMarketCache = new Map();
}

/**
 * Checks if a player instantly accepts an in-season offer.
 */
export function checkInstantCommit(player, team, evalResult, offer) {
    if (!evalResult.accepted) return false;
    const isBlowaway = (offer.tokensOffered >= 2) && (offer.role === 'STARTER') && (offer.promiseTouches === 'FEATURED');
    const isPerfectAlignment = evalResult.interestScore >= 80;
    return isBlowaway || isPerfectAlignment;
}

/**
 * Resolves bidding competition between teams for a free agent.
 */
export function resolvePlayerBiddingWar(player, bids = []) {
    if (!bids || bids.length === 0) return null;

    const scoredBids = bids.map(bid => {
        const evaluation = evaluatePlayerNegotiation(player, bid.team, bid.offer);
        return {
            ...bid,
            evaluation,
            score: evaluation.interestScore + (Math.random() * 4 - 2)
        };
    });

    scoredBids.sort((a, b) => b.score - a.score);
    const winningBid = scoredBids[0];

    // Acceptance threshold floor (45)
    if (winningBid.evaluation.interestScore < 45) {
        const reason = winningBid.evaluation.reasons.find(r => r.includes('-')) || "Offer did not satisfy player expectations.";
        return { winner: null, competingBids: scoredBids, rejectedReason: reason };
    }

    return { winner: winningBid, competingBids: scoredBids };
}

/**
 * Evaluates a player free agency pitch/offer.
 */
export function evaluatePlayerNegotiation(player, team, offer = {}) {
    const roleOffered = offer.role || 'ROTATION';
    const tokens = offer.tokensOffered || 0;
    const roster = getRosterObjects(team);

    // Baseline willingness to play football: Every kid without a team wants to play!
    let interest = 36;

    const cred = team.socialProfile?.streetCred || 50;
    interest += Math.round((cred - 50) * 0.25);

    if (team.tier === 1) interest += 8; // Premier Parks floodlights appeal

    const reasons = [];

    // 1. Social Bonds (BFF, Friends, Rivals)
    if (player.social?.bestFriendId && roster.some(r => r.id === player.social.bestFriendId)) {
        interest += 25;
        reasons.push("🤝 Best friend is on team (+25)");
    }
    const friendsCount = roster.filter(r => player.social?.goodFriendIds?.includes(r.id)).length;
    if (friendsCount > 0) {
        const bonus = Math.min(18, friendsCount * 7);
        interest += bonus;
        reasons.push(`👥 ${friendsCount} friend(s) on team (+${bonus})`);
    }
    const rival = roster.find(r => player.social?.rivalIds?.includes(r.id));
    if (rival) {
        interest -= 40;
        reasons.push(`⚠️ Sworn rival (${rival.name.split(' ')[0]}) on roster (-40)`);
    }

    // Captain clique chemistry
    const captain = roster.find(r => r.id === team.captainId);
    if (captain && captain.personality?.clique === player.personality?.clique) {
        interest += 6;
        reasons.push(`🧢 Shares clique with captain (${player.personality.clique}) (+6)`);
    }

    // 2. Role & Ego Evaluation
    const ego = player.personality?.ego || 50;
    const desiredRole = player.expectations?.desiredRole || 'ROTATION';

    if (roleOffered === 'STARTER') {
        interest += 16;
        reasons.push("⭐ Promised Starting Role (+16)");
    } else if (roleOffered === 'ROTATION') {
        if (desiredRole === 'STARTER' && ego > 65) {
            interest -= 12;
            reasons.push("😤 Ego wanted starting spot (-12)");
        } else {
            interest += 8;
            reasons.push("👍 Content with rotation role (+8)");
        }
    } else if (roleOffered === 'BENCH') {
        if (ego > 60) {
            interest -= 35;
            reasons.push("😤 Refuses bench role with high ego (-35)");
        } else {
            interest -= 10;
            reasons.push("😟 Disappointed with reserve role (-10)");
        }
    }

    if (offer.promiseTouches === 'FEATURED') {
        interest += 12;
        reasons.push("🏈 Promised focal touches (+12)");
    }

    // 3. Positional Opportunity
    const bestPos = player.pos || estimateBestPosition(player);
    const currentAtPos = roster.filter(p => isPlayerViableForPosition(p, bestPos)).length;
    if (currentAtPos === 0) {
        interest += 10;
        reasons.push("🟢 Immediate playing time opportunity (+10)");
    } else if (currentAtPos >= 3) {
        interest -= 6;
        reasons.push("🟡 Crowded depth chart (-6)");
    }

    // 4. Coach Style Fit
    const coachStyle = team.staff?.coach?.biases?.personality?.name;
    if (coachStyle === "Players' Coach") {
        interest += 8;
        reasons.push("😊 Likes Players' Coach (+8)");
    } else if (coachStyle === "Old-School Disciplinarian" && ego > 70) {
        interest -= 15;
        reasons.push("⚡ Clashes with Disciplinarian coach (-15)");
    }

    // 5. Favor Token Sweeteners
    if (tokens > 0) {
        const tokenBoost = tokens === 1 ? 18 : 34;
        interest += tokenBoost;
        reasons.push(`🤝 Favor Tokens offered (+${tokenBoost})`);
    }

    const accepted = interest >= 45;
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
    let interest = Math.round(cred * 0.65);
    const reasons = [];

    if (team.tier === 1) {
        interest += 15;
        reasons.push("Premier Parks floodlights prestige (+15)");
    } else {
        reasons.push("Sandlot Circuit grassroots challenge");
    }

    if (staff.formerPlayerBio && staff.formerPlayerBio.includes(team.name)) {
        interest += 30;
        reasons.push(`🎓 Alma mater loyalty to ${team.name} (+30)`);
    }

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

    const roster = getRosterObjects(team);
    const personality = staff.biases?.personality?.name;
    const tactical = staff.biases?.tactical?.name;
    const teamOffense = team.formations?.offense || 'Balanced';

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

    if (player.activePromise?.role === 'STARTER' && !isStarter) {
        stayScore -= 35;
    }
    if (player.expectations?.desiredRole === 'STARTER' && snapsThisSeason < 30) {
        stayScore -= 25;
    }
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