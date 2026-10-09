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
export function evaluateStaffNegotiation(staff, team, roleKey, pitch = {}) {
    const tokensOffered = typeof pitch === 'number' ? pitch : (pitch.tokensOffered || 0);
    const schemePromise = typeof pitch === 'object' ? (pitch.schemePromise || 'GM_CHOICE') : 'GM_CHOICE';
    const practiceFocus = typeof pitch === 'object' ? (pitch.practiceFocus || 'BALANCED') : 'BALANCED';

    const cred = team.socialProfile?.streetCred || 50;
    let interest = Math.round(cred * 0.55);
    const reasons = [];

    if (team.tier === 1) {
        interest += 14;
        reasons.push("Premier Parks floodlights prestige (+14)");
    } else {
        interest += 4;
        reasons.push("Sandlot Circuit grassroots challenge (+4)");
    }

    // Former player loyalty bonus
    if (staff.formerPlayerBio && staff.formerPlayerBio.includes(team.name)) {
        interest += 30;
        reasons.push(`🎓 Alma mater loyalty to ${team.name} (+30)`);
    }

    // High reputation demands
    const ratingAvg = Math.round(
        ((staff.ratings?.offSchemeMastery || 50) + 
         (staff.ratings?.evalPhysicals || 50) + 
         (staff.ratings?.teaching || 50)) / 3
    );

    if (ratingAvg > 68) {
        const prestigeDemand = Math.round((ratingAvg - 68) * 0.85);
        interest -= prestigeDemand;
        reasons.push(`High reputation standard (-${prestigeDemand})`);
    }

    const roster = getRosterObjects(team);
    const personality = staff.biases?.personality?.name;
    const tactical = staff.biases?.tactical?.name;
    const teamOffense = team.formations?.offense || 'Balanced';

    // 1. Tactical Autonomy & Scheme Fit
    if (roleKey === 'coach') {
        if (schemePromise === 'COACH_CHOICE') {
            interest += 16;
            reasons.push("Granted Full Scheme Autonomy (+16)");
        } else {
            if (tactical === 'Air Raid Purist' || tactical === 'Smashmouth Zealot') {
                interest -= 12;
                reasons.push("Resents GM meddling with play calls (-12)");
            }
        }

        if (tactical === 'Air Raid Purist') {
            if (['Spread', 'Empty', 'Trips', 'TripsLeft'].includes(teamOffense)) {
                interest += 12;
                reasons.push("Excited by current Spread passing attack (+12)");
            } else if (['Power', 'Jumbo'].includes(teamOffense) && schemePromise !== 'COACH_CHOICE') {
                interest -= 22;
                reasons.push("Refuses to coach rigid Power run offense (-22)");
            }
        } else if (tactical === 'Smashmouth Zealot') {
            if (['Power', 'Jumbo', 'Pistol'].includes(teamOffense)) {
                interest += 12;
                reasons.push("Approves of physical downhill rushing lineup (+12)");
            } else if (['Spread', 'Empty'].includes(teamOffense) && schemePromise !== 'COACH_CHOICE') {
                interest -= 22;
                reasons.push("Dislikes finesse spread formations (-22)");
            }
        }
    }

    // 2. Practice Culture Alignment
    if (practiceFocus === 'CONDITIONING') {
        if (personality === 'Old-School Disciplinarian' || personality === "Peaked in '94") {
            interest += 14;
            reasons.push("Loves heavy conditioning & tree-run drills (+14)");
        } else if (personality === "Players' Coach") {
            interest -= 10;
            reasons.push("Worried conditioning will burn out the kids (-10)");
        }
    } else if (practiceFocus === 'CHALK_TALK') {
        if (personality === 'Analytical Savant' || roleKey === 'scout') {
            interest += 14;
            reasons.push("Enthusiastic about chalkboard napkin film study (+14)");
        }
    } else if (practiceFocus === 'FUN_SCRIMMAGE') {
        if (personality === "Players' Coach") {
            interest += 14;
            reasons.push("Loves relaxed sandlot scrimmage vibe (+14)");
        } else if (personality === 'Old-School Disciplinarian') {
            interest -= 18;
            reasons.push("Disgusted by lack of discipline and freeze-pop breaks (-18)");
        }
    }

    // 3. Roster Chemistry Fit
    if (personality === 'Old-School Disciplinarian') {
        const divasOnTeam = roster.filter(p => (p.personality?.ego || 50) > 75).length;
        if (divasOnTeam >= 2) {
            interest -= 18;
            reasons.push(`Hesitant to babysit ${divasOnTeam} high-ego divas (-18)`);
        } else {
            interest += 8;
            reasons.push("Respects your humble locker room (+8)");
        }
    } else if (personality === "Peaked in '94") {
        if (cred < 50) {
            interest -= 12;
            reasons.push("Demands a team with higher neighborhood street respect (-12)");
        }
    } else if (personality === "Players' Coach") {
        interest += 8;
        reasons.push("Eager to develop young neighborhood talent (+8)");
    }

    // 4. Token Sweeteners
    if (tokensOffered > 0) {
        const tokenBoost = tokensOffered === 1 ? 20 : 38;
        interest += tokenBoost;
        reasons.push(`🤝 Favor Tokens offered (+${tokenBoost})`);
    }

    const accepted = interest >= 45;

    // Lore Reaction Quote
    let quote = "";
    if (accepted) {
        if (personality === 'Old-School Disciplinarian') {
            quote = `"You've got a deal. Tell the kids to lace their cleats tight and be at the park by 7 AM sharp."`;
        } else if (personality === "Players' Coach") {
            quote = `"Sounds like a great group. I'll bring an extra cooler of freeze pops for Saturday's game."`;
        } else if (personality === 'Analytical Savant') {
            quote = `"The data checks out. I've already mapped out our red zone efficiency models."`;
        } else {
            quote = `"Deal. Let's show the rest of the neighborhood how football is played."`;
        }
    } else {
        if (interest < 30) {
            quote = `"Not a chance. I'm not wasting my Saturdays on a program that doesn't share my vision."`;
        } else {
            quote = `"I'm intrigued, but the terms just aren't there yet. Sweeten the pitch or give me more control."`;
        }
    }

    return {
        accepted,
        interestScore: Math.max(0, Math.min(100, interest)),
        reasons,
        quote,
        schemePromise,
        practiceFocus
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

/**
 * Evaluates a player position conversion pitch.
 */
export function discussPositionChange(player, targetPos, team, useToken = false) {
    if (!player || !targetPos) return { success: false, message: "Invalid discussion." };

    const currentPos = player.pos || estimateBestPosition(player);
    if (currentPos === targetPos) {
        return { success: false, message: `${player.name} already plays ${targetPos}.` };
    }

    const ethic = player.personality?.workEthic || 50;
    const ego = player.personality?.ego || 50;
    const loyalty = player.personality?.loyalty || 50;
    const wgt = player.attributes?.physical?.weight || 150;
    const spd = player.attributes?.physical?.speed || 50;

    let interest = 45;
    const reasons = [];

    // Position Cluster Proximity Analysis
    const getCluster = (pos) => {
        if (['WR', 'DB'].includes(pos)) return 'BOUNDARY_SPEED';
        if (['RB'].includes(pos)) return 'SKILL_BALLCARRIER';
        if (['TE', 'LB'].includes(pos)) return 'HYBRID_SPACE';
        if (['OL', 'DL'].includes(pos)) return 'TRENCHES';
        return 'SIGNAL_CALLER'; // QB
    };

    const currentCluster = getCluster(currentPos);
    const targetCluster = getCluster(targetPos);
    const ceilingWgt = player.talentAttributes?.physical?.weight || wgt + 20;

    let transitionDifficulty = 'LOW';
    if (currentCluster === targetCluster) {
        transitionDifficulty = 'NATURAL';
        interest += 22;
        reasons.push("Natural sibling position transition (+22)");
    } else if (
        (currentCluster === 'HYBRID_SPACE' && targetCluster === 'TRENCHES') ||
        (currentCluster === 'SKILL_BALLCARRIER' && targetCluster === 'BOUNDARY_SPEED') ||
        (currentCluster === 'SIGNAL_CALLER' && targetCluster === 'BOUNDARY_SPEED')
    ) {
        transitionDifficulty = 'MODERATE';
        interest += 8;
        reasons.push("Manageable athletic cross-training (+8)");
    } else {
        transitionDifficulty = 'EXTREME';
        interest -= 35;
        reasons.push("Radical cross-cluster shift: High risk of failure (-35)");
    }

    // Frame Ceiling Reality Check
    if (['OL', 'DL'].includes(targetPos)) {
        if (ceilingWgt < 170) {
            interest -= 30;
            reasons.push("Genetic frame ceiling too small for trench work (-30)");
        } else if (wgt < 150) {
            interest -= 15;
            reasons.push("Underweight for interior line; will need intense bulking (-15)");
        }
    } else if (['WR', 'DB'].includes(targetPos)) {
        if (wgt > 205) {
            interest -= 25;
            reasons.push("Frame is too heavy for boundary footwork and cuts (-25)");
        }
        if (spd < 45) {
            interest -= 20;
            reasons.push("Lacks foot speed for island coverage / deep routes (-20)");
        }
    }

    // 2. Personality
    if (ethic >= 70) {
        interest += 25;
        reasons.push("Selfless team-first grinder (+25)");
    }
    if (loyalty >= 75) {
        interest += 15;
        reasons.push("Trusts Coach completely (+15)");
    }

    // 3. Ego Penalties (Moving away from glory positions)
    const gloryPositions = ['QB', 'RB', 'WR'];
    const trenchPositions = ['OL', 'DL'];
    if (gloryPositions.includes(currentPos) && trenchPositions.includes(targetPos)) {
        if (ego > 65) {
            interest -= 35;
            reasons.push("High ego resists moving from the spotlight to the line (-35)");
        }
    }

    // 4. Token Persuasion (Borrowing a bike, candy bribe)
    if (useToken) {
        interest += 30;
        reasons.push("Persuaded with a Favor Token sweetener (+30)");
    }

    const accepted = interest >= 50;
    let quote = "";

    if (accepted) {
        const isOffensive = ['QB', 'RB', 'WR', 'TE', 'OL'].includes(targetPos);
        
        player.pos = targetPos;
        player.bestPosition = targetPos;
        player.primarySide = isOffensive ? 'offense' : 'defense';
        if (player.scouting) player.scouting.bestPosition = targetPos;

        if (isOffensive) {
            player.favoriteOffensivePosition = targetPos;
            // Clean up defensive counterpart so frame makes sense
            if (['OL', 'TE'].includes(targetPos) && ['DB'].includes(player.favoriteDefensivePosition)) {
                player.favoriteDefensivePosition = 'DL'; // Bulked up kids can't be DBs
            }
        } else {
            player.favoriteDefensivePosition = targetPos;
            // Clean up offensive counterpart
            if (['DL'].includes(targetPos) && ['WR', 'QB'].includes(player.favoriteOffensivePosition)) {
                player.favoriteOffensivePosition = 'OL';
            }
        }

        if (useToken && team?.socialProfile) {
            team.socialProfile.favorTokens = Math.max(0, (team.socialProfile.favorTokens || 1) - 1);
        }

        quote = ethic >= 65 
            ? `"Whatever helps the team win, Coach. I'll start practicing my new footwork today."`
            : `"Alright, fine. But you owe me big time for this."`;
    } else {
        quote = ego >= 70
            ? `"No chance, Coach! I'm a ${currentPos}, not a ${targetPos}. If you don't want me with the ball, trade me."`
            : `"I don't think I'm cut out for ${targetPos}, Coach. I'd rather stick where I'm comfortable."`;
    }

    return {
        accepted,
        interest,
        quote,
        reasons,
        canPersuade: !accepted && (interest >= 25 && interest < 50) && !useToken
    };
}