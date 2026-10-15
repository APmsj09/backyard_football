// js/game/negotiations.js - Player & Staff Contract Negotiations & Retention

import { game, getRelationshipLevel, getPlayer, getRosterObjects } from './state.js';
import { relationshipLevels } from '../data.js';
import { calculateOverall, estimateBestPosition } from './player.js';
import { isPlayerViableForPosition } from './depth_chart.js';

/**
 * Evaluates whether an AI team genuinely needs and desires a free agent
 * based on Coach Intelligence, Tactical/Scouting Biases, GM Directives, and Value-Over-Replacement (VOR).
 */
export function calculateAiTeamNeedAndDesire(
    aiTeam,
    player,
    gameState,
    currentTopBidScore = 0,
    rosterLimit = (gameState?.currentWeek === 0 ? 24 : 18)
) {
    if (
        !aiTeam ||
        !player ||
        aiTeam.isPlayerControlled ||
        (aiTeam.roster?.length || 0) >= rosterLimit
    ) {
        return { shouldBid: false, desireScore: 0, offer: null, reason: 'Ineligible' };
    }

    if (player.refusedTeamIds?.includes(aiTeam.id)) {
        return {
            shouldBid: false,
            desireScore: 0,
            offer: null,
            reason: 'Player refuses to return after a broken promise'
        };
    }

    const coach = aiTeam.staff?.coach || aiTeam.coach;
    const gm = aiTeam.staff?.gm;
    const roster = getRosterObjects(aiTeam);
    const tokensAvailable = aiTeam.socialProfile?.favorTokens || 0;

    const bestPos = player.pos || estimateBestPosition(player);
    const playerOvr = calculateOverall(player, bestPos);
    const ego = player.personality?.ego || 50;
    const ethic = player.personality?.workEthic || 50;
    const speed = player.attributes?.physical?.speed || 50;
    const age = player.age || 14;

    const tactical = coach?.biases?.tactical?.name || 'Balanced Tactician';
    const personality = coach?.biases?.personality?.name || "Players' Coach";
    const scoutingBias = aiTeam.staff?.scout?.biases?.scouting?.name || 'Objective Scout';
    const gmDirective = aiTeam.gameplan?.gmDirective || 'COACH_AUTONOMY';
    const coachInstinct = coach?.ratings?.gameplanInstinct || 50;
    const evalSkill = Math.round(((coach?.ratings?.evalTechnique || 50) + (coach?.ratings?.evalPhysicals || 50)) / 2);

    // 1. GM DIRECTIVE POLICY FILTER
    if (gmDirective === 'DEVELOP_YOUTH' && age >= 16) {
        return { shouldBid: false, desireScore: 0, offer: null, reason: 'Youth directive: Skipping older prospects' };
    }
    if (gmDirective === 'WIN_NOW' && playerOvr < 48 && age <= 13) {
        return { shouldBid: false, desireScore: 0, offer: null, reason: 'Win-Now directive: Passing on raw developmental talent' };
    }

    // 2. CHARACTER & LOCKER ROOM CULTURE COMPATIBILITY
    if ((personality === 'Old-School Disciplinarian' || scoutingBias === 'Character First') && ego > 72) {
        return { shouldBid: false, desireScore: 0, offer: null, reason: 'Coach refuses to recruit high-ego divas' };
    }

    // 3. VALUE OVER REPLACEMENT (VOR) & STARTER ROOM CAPACITY
    // 8v8 scheme starter counts: OL requires 3; WR, DB, DL require 2-3; QB, RB, TE require 1
    const requiredStarters = bestPos === 'OL' ? 3 : (['WR', 'DB', 'DL'].includes(bestPos) ? 2 : 1);
    const viablePlayers = roster.filter(p => isPlayerViableForPosition(p, bestPos));
    const sortedStarters = viablePlayers.map(p => calculateOverall(p, bestPos)).sort((a, b) => b - a);

    // True vacancy: The team does not have enough viable players to even field their starting unit
    const isDesperateVoid = viablePlayers.length < requiredStarters;

    // Coach Scouting Accuracy: Poor evaluators perceive player ratings with noise; high-skill evaluators see true VOR
    const evalNoise = evalSkill < 55 ? (Math.sin(playerOvr + age) * (60 - evalSkill) * 0.18) : 0;
    const perceivedPlayerOvr = Math.round(playerOvr + evalNoise);

    // Compare prospect against the WEAKEST starter in that room
    const benchmarkIndex = Math.min(sortedStarters.length - 1, requiredStarters - 1);
    const currentStarterOvr = sortedStarters.length > 0 ? (sortedStarters[benchmarkIndex] || 0) : 0;
    const upgradeDelta = isDesperateVoid ? (perceivedPlayerOvr - 30) : (perceivedPlayerOvr - currentStarterOvr);

    // Strict No-Spite Rule: If starting unit is full and prospect is not a real upgrade, pass completely
    if (!isDesperateVoid && upgradeDelta <= -2 && viablePlayers.length >= (requiredStarters + 1)) {
        return { shouldBid: false, desireScore: 0, offer: null, reason: `Adequately staffed at ${bestPos} (Weakest starter: ${currentStarterOvr} OVR)` };
    }

    let desireScore = 40;
    desireScore += Math.round(upgradeDelta * 2.5); // Major upgrade = huge desire

    if (isDesperateVoid) desireScore += 35; // Desperate vacancy

    // 4. SCHEME & TACTICAL BIAS ALIGNMENT
    if (tactical === 'Air Raid Purist') {
        if (['WR', 'TE'].includes(bestPos) || bestPos === 'QB') desireScore += 22;
        if (bestPos === 'RB' && player.archetypeName?.includes('Power')) desireScore -= 18;
    } else if (tactical === 'Smashmouth Zealot') {
        if (['OL', 'RB', 'TE'].includes(bestPos)) desireScore += 22;
        if (bestPos === 'WR') desireScore -= 14;
    } else if (tactical === 'Blitz Addict') {
        if (['DL', 'LB', 'DB'].includes(bestPos) && speed > 60) desireScore += 18;
    }

    // 5. SCOUTING BIAS TASTES
    if (scoutingBias === 'Speed Chaser') {
        if (speed >= 68) desireScore += 20;
        else if (speed < 46) desireScore -= 22;
    } else if (scoutingBias === 'Character First') {
        if (ethic >= 72) desireScore += 18;
    }

    // 6. SOCIAL NETWORK & SQUAD ANCHORS
    const hasBFF = player.social?.bestFriendId && roster.some(r => r.id === player.social.bestFriendId);
    if (hasBFF) desireScore += 24;
    const hasRival = roster.some(r => player.social?.rivalIds?.includes(r.id));
    if (hasRival) desireScore -= 45;

    if (desireScore < 45) {
        return { shouldBid: false, desireScore, offer: null, reason: 'Insufficient situational desire' };
    }

    // 7. ROLE & TOKEN BUDGETING (Intelligent Market Escalation & Counter-Bidding)
    const isAggressiveCoach =
        personality === "Peaked in '94" ||
        tactical === 'Blitz Addict' ||
        gmDirective === 'WIN_NOW';
    const isConservativeCoach = tactical === 'Conservative Turtler' || personality === 'Analytical Savant';

    // Base pitch determination
    let role = (upgradeDelta >= 2 || isDesperateVoid)
        ? 'STARTER'
        : (playerOvr >= 46 ? 'ROTATION' : 'BENCH');

    const retentionOptions = getRetentionPitchOptions(player);

    // AI teams only offer workload guarantees supported by the shared
    // position-specific promise definitions.
    let promiseTouches = (
        ego > 65 &&
        retentionOptions.focusPromise &&
        desireScore > 65
    ) ? 'FEATURED' : 'NORMAL';

    let tokensToSpend = 0;
    if (tokensAvailable > 0) {
        const isFranchiseCornerstone = playerOvr >= 60 && (upgradeDelta >= 6 || isDesperateVoid);
        const isMajorUpgrade = upgradeDelta >= 8 || (isDesperateVoid && playerOvr >= 48);

        // When trailing behind a rival's bid in multi-day negotiations
        if (currentTopBidScore > 0) {
            // Smart coaches bow out if the player isn't a game-changer and the price is too high
            const canJustifyWar = desireScore >= 68 || isDesperateVoid || isFranchiseCornerstone;

            if (canJustifyWar && !isConservativeCoach) {
                // Escalate role to STARTER if player is demanding it and we really need him
                if (role === 'ROTATION' && ego > 60) role = 'STARTER';

                // Escalate tokens: Spend 2 tokens if cornerstone, otherwise 1
                tokensToSpend = (isAggressiveCoach && tokensAvailable >= 2 && desireScore >= 78) ? 2 : 1;
            } else if (isConservativeCoach) {
                // Conservative GMs know when to walk away rather than overpaying in bidding wars
                return { shouldBid: false, desireScore: 0, offer: null, reason: 'Market price exceeded disciplined value threshold' };
            }
        } else if (isFranchiseCornerstone && (isAggressiveCoach || coachInstinct > 65)) {
            tokensToSpend = tokensAvailable >= 2 ? 2 : 1;
        } else if (isMajorUpgrade && (isAggressiveCoach || gmDirective === 'WIN_NOW')) {
            tokensToSpend = 1;
        }
    }

    const offer = {
        role,
        promiseTouches,
        tokensOffered: tokensToSpend
    };

    return {
        shouldBid: true,
        desireScore,
        offer,
        reason: isDesperateVoid 
            ? `Urgent vacancy at ${bestPos}` 
            : (upgradeDelta > 0 ? `+${upgradeDelta} OVR upgrade over current starter` : `Depth rotational fit`)
    };
}

/**
 * Generates accurate market intel and rumor buzz driven by true AI team desires.
 */
export function generatePlayerRumors(player, gameState) {
    if (!player || !gameState) {
        return { heat: 'QUIET', suitorTeams: [], suitorNames: [], rumorText: 'Quiet on the blacktop.', keyFactor: 'Available' };
    }

    const mainTeams = (gameState.teams || []).filter(t => t.leagueType === 'main');
    const interested = [];

    mainTeams.forEach(team => {
        const evalResult = calculateAiTeamNeedAndDesire(team, player, gameState, 0);
        if (evalResult.shouldBid) {
            interested.push({ team, desire: evalResult.desireScore, reason: evalResult.reason });
        }
    });

    interested.sort((a, b) => b.desire - a.desire);
    const suitorTeams = interested.slice(0, 2).map(i => i.team);

    let heat = 'QUIET';
    if (suitorTeams.length >= 2) heat = 'HOT';
    else if (suitorTeams.length === 1) heat = 'WARM';

    let rumorText = 'Flying under the radar on the playground. Uncontested target.';
    let keyFactor = 'Open Field';

    if (suitorTeams.length > 0) {
        const topSuitor = suitorTeams[0];
        const topReason = interested[0].reason;

        if (heat === 'HOT') {
            rumorText = `Active bidding battle developing between ${suitorTeams[0].name} and ${suitorTeams[1].name}.`;
            keyFactor = `Targeted by ${suitorTeams[0].name} & ${suitorTeams[1].name}`;
        } else {
            rumorText = `${topSuitor.name} have made him a priority target: ${topReason}.`;
            keyFactor = `${topSuitor.name} target`;
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

    const bestPos = player.pos || estimateBestPosition(player);
    const playerOvr = calculateOverall(player, bestPos);

    // High caliber prospects (OVR >= 55) never commit instantly unless blown away by tokens and BFF bonds
    if (playerOvr >= 55) {
        const hasBFF = player.social?.bestFriendId && team.roster?.includes(player.social.bestFriendId);
        return evalResult.interestScore >= 88 && (offer.tokensOffered >= 2 || hasBFF);
    }

    // Role players can commit early if they love the fit
    const isBlowaway = (offer.tokensOffered >= 2) && (offer.role === 'STARTER');
    return isBlowaway || evalResult.interestScore >= 82;
}

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

    // Dynamic threshold enforcement based on player caliber
    const threshold = winningBid.evaluation.threshold || 48;
    if (winningBid.evaluation.interestScore < threshold) {
        const negativeReasons = winningBid.evaluation.reasons.filter(r => r.includes('-'));
        const reason = negativeReasons.length > 0 
            ? negativeReasons.slice(0, 2).join('; ')
            : `Fell short of prospect's caliber expectations (${winningBid.evaluation.interestScore}/${threshold} interest).`;
        return { winner: null, competingBids: scoredBids, rejectedReason: reason };
    }

    return { winner: winningBid, competingBids: scoredBids };
}

/**
 * Evaluates a player free agency pitch/offer.
 */
export function evaluatePlayerNegotiation(player, team, offer = {}) {
    const roleOffered = offer.role || 'ROTATION';
    const reasons = [];

    if (!player || !team) {
        return {
            accepted: false,
            interestScore: 0,
            threshold: 100,
            reasons: ['Invalid player or team.'],
            roleOffered,
            promiseTouches: offer.promiseTouches || 'NORMAL'
        };
    }

    if (player.refusedTeamIds?.includes(team.id)) {
        return {
            accepted: false,
            interestScore: 0,
            threshold: 100,
            reasons: [
                'Player refuses to return after a broken promise.'
            ],
            roleOffered,
            promiseTouches: offer.promiseTouches || 'NORMAL'
        };
    }

    const rawTokens = Number(offer.tokensOffered ?? 0);
    const tokens = Number.isFinite(rawTokens) ? Math.floor(rawTokens) : -1;
    const tokensAvailable = Math.max(
        0,
        Math.floor(Number(team.socialProfile?.favorTokens) || 0)
    );

    if (
        !['STARTER', 'ROTATION', 'BENCH'].includes(roleOffered) ||
        !Number.isInteger(tokens) ||
        tokens < 0 ||
        tokens > 2 ||
        tokens > tokensAvailable
    ) {
        return {
            accepted: false,
            interestScore: 0,
            threshold: 100,
            reasons: ['Invalid role or insufficient Favor Tokens.'],
            roleOffered,
            promiseTouches: offer.promiseTouches || 'NORMAL'
        };
    }

    const roster = getRosterObjects(team);

    const bestPos = player.pos || estimateBestPosition(player);
    const playerOvr = calculateOverall(player, bestPos);
    const age = player.age || 14;
    const ego = player.personality?.ego || 50;
    const ethic = player.personality?.workEthic || 50;
    const cred = team.socialProfile?.streetCred || 50;
    const teamOffense = team.formations?.offense || 'Balanced';

    // 1. TALENT LEVERAGE & AGE BASELINE
    // Superstars have leverage and demand serious incentives. Raw developmental kids just want a jersey.
    let interest = 36;
    if (playerOvr >= 62) {
        interest = 18; // Star leverage: high skepticism of empty pitches
    } else if (playerOvr >= 52) {
        interest = 28;
    } else if (playerOvr < 40) {
        interest = 44; // Eager walk-on bench candidate
    }

    // Older teens (17-18) have cars, jobs, and varsity options; young kids (12-13) are eager
    if (age >= 17) {
        interest -= 8;
        reasons.push("🚗 Senior with outside options & high expectations (-8)");
    } else if (age <= 13) {
        interest += 6;
        reasons.push("🧃 Eager young prospect wanting playground reps (+6)");
    }

    // 2. TIER & STREET CRED REPUTATION
    interest += Math.round((cred - 50) * 0.35);
    if (team.tier === 1) {
        interest += 8;
        reasons.push("🏟️ Premier Parks lights prestige (+8)");
    } else if (team.tier === 2 && playerOvr >= 52) {
        // High caliber players look down on Tier 2
        interest -= 14;
        reasons.push("📉 Reluctant to play in Sandlot Circuit Tier 2 (-14)");
    }

    // 3. SOCIAL BONDS & CHEMISTRY
    if (player.social?.bestFriendId && roster.some(r => r.id === player.social.bestFriendId)) {
        interest += 28;
        reasons.push("🤝 Best friend is on team (+28)");
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
        reasons.push(`⚠️ Sworn rival (${rival.name.split(' ')[0]}) on roster (-45)`);
    }
    const captain = roster.find(r => r.id === team.captainId);
    if (captain && captain.personality?.clique === player.personality?.clique) {
        interest += 6;
        reasons.push(`🧢 Shares clique with captain (${player.personality.clique}) (+6)`);
    }

    // 4. DEPTH CHART REALITY CHECK (Detecting Fake "Starter" Promises)
    const viableCompetitors = roster.filter(p => isPlayerViableForPosition(p, bestPos));
    const topCompetitorOvr = viableCompetitors.map(p => calculateOverall(p, bestPos)).sort((a, b) => b - a)[0] || 0;

    if (roleOffered === 'STARTER') {
        if (topCompetitorOvr >= playerOvr + 4 && ego > 55) {
            // Player sees through the empty promise: "You already have a starter better than me!"
            interest -= 22;
            reasons.push(`🤨 Sees through fake starter pitch: Depth chart already led by ${topCompetitorOvr} OVR star (-22)`);
        } else {
            interest += 16;
            reasons.push("⭐ Promised Starting Role (+16)");
        }
    } else if (roleOffered === 'ROTATION') {
        if (ego > 65 && playerOvr >= 48) {
            interest -= 18;
            reasons.push("😤 Diva ego demands guaranteed starting spot (-18)");
        } else if (ethic >= 65) {
            interest += 8;
            reasons.push("💪 Grinder willing to earn snaps in rotation (+8)");
        }
    } else if (roleOffered === 'BENCH') {
        if (playerOvr >= 45 || ego > 55) {
            interest -= 36;
            reasons.push("🚫 Too talented to accept bench assignment (-36)");
        } else {
            interest -= 12;
            reasons.push("😟 Disappointed with reserve role (-12)");
        }
    }

    // 5. QUARTERBACK MAGNET (Pass-Catchers Inspect Who Is Throwing the Ball)
    const isPassCatcher = ['WR', 'TE'].includes(bestPos) || player.archetypeName?.includes('Receiving');
    if (isPassCatcher) {
        const qb1Id = team.depthChart?.offense?.QB1;
        const qb1 = qb1Id ? getPlayer(qb1Id) : roster.find(p => isPlayerViableForPosition(p, 'QB'));
        const qbThrow = qb1?.attributes?.technical?.throwingAccuracy ?? 40;

        if (qbThrow >= 65) {
            interest += 14;
            reasons.push(`🎯 Excited to catch passes from top QB ${qb1.name.split(' ')[0]} (+14)`);
        } else if (qbThrow < 42) {
            interest -= 16;
            reasons.push("🤦 Distrusts team's inaccurate quarterback play (-16)");
        }
    }

    // 6. SCHEME VOLUME & IDENTITY CONFLICT
    if (isPassCatcher) {
        if (['Power', 'Jumbo'].includes(teamOffense)) {
            interest -= 16;
            reasons.push(`🏃 Refuses to play in run-heavy ${teamOffense} system (-16)`);
        } else if (['Spread', 'Trips', 'Empty'].includes(teamOffense)) {
            interest += 10;
            reasons.push(`🚀 Loves high-volume ${teamOffense} passing scheme (+10)`);
        }
    } else if (['OL', 'DL'].includes(bestPos) || player.archetypeName?.includes('Power') || player.archetypeName?.includes('Bruiser')) {
        if (['Power', 'Jumbo', 'Pistol'].includes(teamOffense)) {
            interest += 12;
            reasons.push(`🔨 Enthusiastic about downhill ${teamOffense} trenches (+12)`);
        } else if (['Empty', 'Spread'].includes(teamOffense)) {
            interest -= 10;
            reasons.push(`💨 Dislikes finesse ${teamOffense} system (-10)`);
        }
    }

    // 7. POSITION-SPECIFIC WORKLOAD PROMISES
    const promiseOptions = getRetentionPitchOptions(player);
    const focusPromise = promiseOptions.focusPromise;

    if (offer.promiseTouches === 'FEATURED') {
        if (focusPromise) {
            const touchBonus = ego > 65 ? 18 : 10;
            interest += touchBonus;

            reasons.push(
                `🏈 Promised ${focusPromise.label.toLowerCase()} (+${touchBonus})`
            );
        } else {
            reasons.push(
                `ℹ️ No offensive workload promise applies to ${bestPos} (+0)`
            );
        }
    }

    // 8. COACHING CLASHES
    const coach = team.staff?.coach || team.coach;
    const coachStyle =
        coach?.biases?.personality?.name ||
        coach?.type;
    if (coachStyle === "Old-School Disciplinarian") {
        if (ego > 70 || ethic < 40) {
            interest -= 20;
            reasons.push("⚡ Divas & slackers fear strict conditioning (-20)");
        } else if (ethic >= 65) {
            interest += 8;
            reasons.push("🏋️ Hard worker respects disciplined coach (+8)");
        }
    } else if (coachStyle === "Players' Coach") {
        interest += 6;
        reasons.push("😊 Attracted to relaxed team culture (+6)");
    }

    // 9. FAVOR TOKEN SWEETENERS
    if (tokens > 0) {
        const tokenBoost = tokens === 1 ? 16 : 30;
        interest += tokenBoost;
        reasons.push(`🤝 Favor Tokens offered (+${tokenBoost})`);
    }

    // 9A. GENERAL MANAGER RECRUITING PHILOSOPHY
    const gmNegotiationBonus = team.gmProfile?.bonuses?.negotiationInterest || 0;

    if (gmNegotiationBonus !== 0) {
        interest += gmNegotiationBonus;
        reasons.push(
            `🧠 ${team.gmProfile.archetypeName} influence (` +
            `${gmNegotiationBonus > 0 ? '+' : ''}${gmNegotiationBonus})`
        );
    }

    // 10. DYNAMIC CALIBER THRESHOLD
    // Superstars demand deep courtship (62+ interest). Bench walk-ons accept at 45.
    let threshold = 42;
    if (playerOvr >= 62) threshold += 12;     // Threshold = 54
    else if (playerOvr >= 52) threshold += 6; // Threshold = 48
    if (ego > 75) threshold += 6;             // Divas are harder to satisfy
    if (age >= 17) threshold += 4;

    const accepted = interest >= threshold;

    return {
        accepted,
        interestScore: Math.max(0, Math.min(100, interest)),
        threshold,
        reasons,
        roleOffered,
        promiseTouches: offer.promiseTouches || 'NORMAL',
        promiseType: focusPromise && offer.promiseTouches === 'FEATURED'
            ? focusPromise.value
            : 'NONE'
    };
}

/**
 * Evaluates whether an available staff member agrees to sign.
 */
export function evaluateStaffNegotiation(staff, team, roleKey, pitch = {}) {
    const tokensOffered = typeof pitch === 'number' ? pitch : (pitch.tokensOffered || 0);
    const cashOffered = typeof pitch === 'object' ? (pitch.cashOffered || 0) : 0;
    const schemePromise = typeof pitch === 'object' ? (pitch.schemePromise || 'GM_CHOICE') : 'GM_CHOICE';
    const practiceFocus = typeof pitch === 'object' ? (pitch.practiceFocus || 'BALANCED') : 'BALANCED';

    const cred = team.socialProfile?.streetCred || 50;
    let interest = Math.round(cred * 0.42);
    const reasons = [];

    const ratingAvg = Math.round(
        ((staff.ratings?.offSchemeMastery || 50) + 
         (staff.ratings?.defSchemeMastery || 50) + 
         (staff.ratings?.teaching || 50)) / 3
    );

    // 1. FINANCIAL STIPEND & MARKET DESPERATION EVALUATION
    const weeksUnemployed = staff.weeksUnemployed || 0;
    const baseStipend = Math.max(0, Math.round((ratingAvg - 52) * 0.50));
    const marketDecay = Math.pow(staff.stubbornness || 0.75, weeksUnemployed);
    const requiredStipend = Math.max(0, Math.round(baseStipend * marketDecay));

    if (cashOffered < requiredStipend) {
        const stipendDeficit = requiredStipend - cashOffered;
        const penalty = Math.min(45, stipendDeficit * 7);
        interest -= penalty;
        reasons.push(`❌ Insulted by inadequate stipend: Demanded $${requiredStipend.toFixed(2)} for equipment/coffee (-${penalty})`);
    } else if (cashOffered > requiredStipend && requiredStipend > 0) {
        const bonus = Math.min(22, (cashOffered - requiredStipend) * 4);
        interest += bonus;
        reasons.push(`💰 Impressed by generous $${cashOffered.toFixed(2)} upfront equipment stipend (+${bonus})`);
    } else if (requiredStipend === 0) {
        reasons.push("🤝 Volunteer/humble coach: Asks $0.00 upfront stipend (+0)");
    }

    // Unemployment Desperation Bonus (Humble coaches get desperate; stubborn hold out)
    if (weeksUnemployed >= 2) {
        const desperationBonus = Math.round(weeksUnemployed * 6 * (1.0 - (staff.stubbornness || 0.75)));
        if (desperationBonus > 0) {
            interest += desperationBonus;
            reasons.push(`⏳ Eager to return to sideline after ${weeksUnemployed} weeks without team (+${desperationBonus})`);
        }
    }

    // 1. TIER STANDARDS & REPUTATION
    if (team.tier === 1) {
        interest += 14;
        reasons.push("🏟️ Premier Parks floodlights prestige (+14)");
    } else {
        if (ratingAvg >= 68) {
            interest -= 18;
            reasons.push("📉 High-tier coach reluctant to drop to Sandlot Circuit (-18)");
        } else {
            interest += 6;
            reasons.push("🧢 Comfortable developing grassroots Sandlot program (+6)");
        }
    }

    if (staff.formerPlayerBio && staff.formerPlayerBio.includes(team.name)) {
        interest += 28;
        reasons.push(`🎓 Alma mater loyalty to ${team.name} (+28)`);
    }

    // 2. PERSONNEL COMPATIBILITY CHECK
    const roster = getRosterObjects(team);
    const tactical = staff.biases?.tactical?.name;
    const personality = staff.biases?.personality?.name;
    const teamOffense = team.formations?.offense || 'Balanced';

    if (roleKey === 'coach') {
        // Air Raid Coach inspects QB and WR readiness
        if (tactical === 'Air Raid Purist') {
            const qb1 = roster.find(p => isPlayerViableForPosition(p, 'QB'));
            const qbThrow = qb1?.attributes?.technical?.throwingAccuracy || 35;
            if (qbThrow < 45) {
                interest -= 20;
                reasons.push("❌ Roster lacks accurate QB to execute Air Raid passing (-20)");
            }
            if (['Spread', 'Empty', 'Trips', 'TripsLeft'].includes(teamOffense)) {
                interest += 14;
                reasons.push("🚀 Roster already set in Spread formations (+14)");
            }
        } else if (tactical === 'Smashmouth Zealot') {
            const heavyCount = roster.filter(p => isPlayerViableForPosition(p, 'OL') || isPlayerViableForPosition(p, 'TE')).length;
            if (heavyCount < 4) {
                interest -= 18;
                reasons.push("❌ Lacks physical blockers needed for Smashmouth front (-18)");
            }
            if (['Power', 'Jumbo'].includes(teamOffense)) {
                interest += 14;
                reasons.push("🔨 Physical downhill offensive alignment (+14)");
            }
        }

        // Scheme autonomy expectations
        if (schemePromise === 'COACH_CHOICE') {
            interest += 18;
            reasons.push("📋 Full Play-Calling & Scheme Autonomy (+18)");
        } else if (ratingAvg >= 65) {
            interest -= 16;
            reasons.push("😠 Veteran coach refuses GM micromanagement (-16)");
        }
    }

    // 3. PRACTICE CULTURE
    if (practiceFocus === 'CONDITIONING') {
        if (personality === 'Old-School Disciplinarian' || personality === "Peaked in '94") {
            interest += 14;
            reasons.push("🏋️ Loves rigorous tree-run & conditioning culture (+14)");
        } else if (personality === "Players' Coach") {
            interest -= 10;
            reasons.push("Worried heavy conditioning burns out players (-10)");
        }
    } else if (practiceFocus === 'CHALK_TALK') {
        if (personality === 'Analytical Savant' || roleKey === 'scout') {
            interest += 14;
            reasons.push("📊 Enjoys chalkboard film study & scheme mastery (+14)");
        }
    } else if (practiceFocus === 'FUN_SCRIMMAGE') {
        if (personality === "Players' Coach") {
            interest += 14;
            reasons.push("🧃 Loves relaxed freeze-pop scrimmage culture (+14)");
        } else if (personality === 'Old-School Disciplinarian') {
            interest -= 18;
            reasons.push("Disgusted by lack of discipline and scrimmages (-18)");
        }
    }

    // 4. FAVOR TOKEN SWEETENERS
    if (tokensOffered > 0) {
        const tokenBoost = tokensOffered === 1 ? 16 : 32;
        interest += tokenBoost;
        reasons.push(`🤝 Favor Tokens offered (+${tokenBoost})`);
    }

    // Dynamic threshold: Elite coaches require 58+ score; average candidates accept at 45
    let threshold = 46;
    if (ratingAvg >= 72) threshold += 12;
    else if (ratingAvg >= 62) threshold += 6;

    const accepted = interest >= threshold;

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
 * Evaluates offseason retention and enforces any promise due for the
 * completed season. A broken commitment destroys trust permanently.
 */
/**
 * Evaluates offseason retention using the shared contract model.
 */
export function evaluatePlayerRetention(player, team, snapsThisSeason = 0) {
    if (player.age >= 19) {
        return { willStay: false, reason: 'Graduated High School' };
    }

    const completedSeason = (game?.year || 1) - 1;

    const promiseResult = evaluateActivePlayerPromise(
        player,
        team,
        snapsThisSeason,
        completedSeason
    );

    if (promiseResult.broken) {
        return {
            willStay: false,
            reason: promiseResult.reason,
            stayScore: 0,
            permanentDeparture: true
        };
    }

    const ego = player.personality?.ego ?? 50;
    const loyalty = player.personality?.loyalty ?? 50;
    const happiness = player.expectations?.happiness ?? 100;
    const bestPos = player.pos || estimateBestPosition(player);
    const ovr = calculateOverall(player, bestPos);

    const isStarter = isPlayerStarterAtPosition(player, team, bestPos);

    let stayScore = (loyalty * 0.45) + (happiness * 0.35);

    const gmRetentionBonus = team.gmProfile?.bonuses?.retention || 0;
    stayScore += gmRetentionBonus;

    // General playing-time frustration, separate from explicit promises.
    if (player.expectations?.desiredRole === 'STARTER' && snapsThisSeason < 40) {
        stayScore -= 28;
    }

    // Losing-program frustration.
    if (team.wins <= 2) {
        if (ego > 70) stayScore -= 14;
        else if (ego > 50) stayScore -= 6;
    }

    // High-caliber upperclassmen may want stronger competition.
    if (team.tier === 2 && ovr >= 60 && player.age >= 17 && ego > 65) {
        stayScore -= 14;
    }

    let threshold = 48;
    if (ego > 75) threshold += 10;
    if (player.age >= 17) threshold += 6;

    const willStay = stayScore >= threshold;
    let reason = 'Happy with current role and teammates.';

    if (!willStay) {
        if (player.expectations?.desiredRole === 'STARTER' && snapsThisSeason < 40) {
            reason = 'Frustrated by insufficient playing time.';
        } else if (!isStarter && ego > 70) {
            reason = 'High ego demanded a bigger role.';
        } else if (team.tier === 2 && ovr >= 54) {
            reason = 'Demanded transfer to Tier 1 Premier Parks competition.';
        } else if (team.wins <= 2) {
            reason = 'Frustrated with losing culture and poor play.';
        } else {
            reason = 'Wanted a fresh start with new playground opportunities.';
        }
    }

    return {
        willStay,
        reason,
        stayScore: Math.round(stayScore),
        promiseStatus: promiseResult.status
    };
}

const RETENTION_POSITION_CONFIG = {
    QB: {
        positionLabel: 'Quarterback',
        starterRoleLabel: 'Starting Quarterback',
        rotationRoleLabel: 'Backup / Rotation QB',
        reserveRoleLabel: 'Developmental QB',
        focusPromise: {
            value: 'PASSING_ROLE',
            label: 'Passing-Game Priority',
            target: 25,
            description: 'At least 25 pass attempts next season.'
        }
    },
    RB: {
        positionLabel: 'Running Back',
        starterRoleLabel: 'Starting Running Back',
        rotationRoleLabel: 'Rotation Back',
        reserveRoleLabel: 'Depth Back',
        focusPromise: {
            value: 'FEATURED_TOUCHES',
            label: 'Featured Ball Carrier',
            target: 25,
            description: 'At least 25 combined rushing attempts and receptions next season.'
        }
    },
    WR: {
        positionLabel: 'Wide Receiver',
        starterRoleLabel: 'Starting Receiver',
        rotationRoleLabel: 'Rotation Receiver',
        reserveRoleLabel: 'Depth Receiver',
        focusPromise: {
            value: 'FEATURED_CATCHES',
            label: 'Featured Receiving Role',
            target: 25,
            description: 'At least 25 receptions next season.'
        }
    },
    TE: {
        positionLabel: 'Tight End',
        starterRoleLabel: 'Starting Tight End',
        rotationRoleLabel: 'Rotation Tight End',
        reserveRoleLabel: 'Depth Tight End',
        focusPromise: {
            value: 'FEATURED_CATCHES',
            label: 'Featured Receiving Role',
            target: 25,
            description: 'At least 25 receptions next season.'
        }
    },
    OL: {
        positionLabel: 'Offensive Lineman',
        starterRoleLabel: 'Starting Offensive Line Role',
        rotationRoleLabel: 'Rotation Lineman',
        reserveRoleLabel: 'Developmental Lineman',
        focusPromise: null
    },
    DL: {
        positionLabel: 'Defensive Lineman',
        starterRoleLabel: 'Starting Defensive Line Role',
        rotationRoleLabel: 'Rotation Defensive Lineman',
        reserveRoleLabel: 'Depth Defensive Lineman',
        focusPromise: null
    },
    LB: {
        positionLabel: 'Linebacker',
        starterRoleLabel: 'Starting Linebacker',
        rotationRoleLabel: 'Rotation Linebacker',
        reserveRoleLabel: 'Depth Linebacker',
        focusPromise: null
    },
    DB: {
        positionLabel: 'Defensive Back',
        starterRoleLabel: 'Starting Defensive Back',
        rotationRoleLabel: 'Rotation Defensive Back',
        reserveRoleLabel: 'Depth Defensive Back',
        focusPromise: null
    }
};

/**
 * Single source of truth for valid player promise options.
 * Shared by recruiting and retention negotiations.
 */
export function getRetentionPitchOptions(player) {
    const position = player?.pos || estimateBestPosition(player);
    const config = RETENTION_POSITION_CONFIG[position] || {
        positionLabel: position || 'Player',
        starterRoleLabel: 'Starting Role',
        rotationRoleLabel: 'Rotation Role',
        reserveRoleLabel: 'Reserve Role',
        focusPromise: null
    };

    return {
        position,
        positionLabel: config.positionLabel,
        starterRoleLabel: config.starterRoleLabel,
        rotationRoleLabel: config.rotationRoleLabel,
        reserveRoleLabel: config.reserveRoleLabel,
        focusPromise: config.focusPromise
            ? { ...config.focusPromise }
            : null
    };
}


/**
 * Creates a normalized, season-specific commitment after a player accepts.
 * Does not spend tokens or modify the roster.
 */
export function createPlayerPromise(
    player,
    team,
    offer = {},
    metadata = {}
) {
    if (!player || !team) return null;

    const options = getRetentionPitchOptions(player);
    const validRoles = ['STARTER', 'ROTATION', 'BENCH'];

    const offeredRole = offer.role ?? offer.rolePromised ?? 'ROTATION';
    const role = validRoles.includes(offeredRole)
        ? offeredRole
        : 'ROTATION';

    let promiseType = offer.promiseType;

    // Normalize legacy recruiting offers that use promiseTouches.
    if (promiseType == null) {
        promiseType = offer.promiseTouches === 'FEATURED'
            ? (options.focusPromise?.value || 'NONE')
            : 'NONE';
    }

    // Do not record a workload guarantee that is invalid for the position.
    if (
        promiseType !== 'NONE' &&
        promiseType !== options.focusPromise?.value
    ) {
        promiseType = 'NONE';
    }

    const promiseSeason = Number(
        metadata.promiseSeason ?? game?.year ?? 1
    );

    const source = metadata.source || 'recruiting';

    return {
        version: 1,
        role,
        position: options.position,
        promiseType,
        promiseTarget: promiseType === options.focusPromise?.value
            ? options.focusPromise.target
            : null,

        // Legacy compatibility for older recruiting code and saves.
        promiseTouches: promiseType === 'NONE' ? 'NORMAL' : 'FEATURED',

        promiseSeason: Number.isFinite(promiseSeason)
            ? promiseSeason
            : (game?.year ?? 1),

        source,
        teamId: team.id,
        broken: false
    };
}

function normalizePromiseSlotPosition(slot) {
    let position = String(slot || '').replace(/\d+/g, '').toUpperCase();

    if (['OT', 'OG', 'C'].includes(position)) return 'OL';
    if (position === 'FB') return 'RB';
    if (['CB', 'S', 'FS', 'SS'].includes(position)) return 'DB';
    if (['DE', 'DT', 'NT'].includes(position)) return 'DL';

    return position;
}

function isPlayerStarterAtPosition(player, team, position) {
    if (!player || !team || !position) return false;

    const charts = [
        team.depthChart?.offense || {},
        team.depthChart?.defense || {}
    ];

    return charts.some(chart =>
        Object.entries(chart).some(([slot, playerId]) =>
            playerId === player.id &&
            normalizePromiseSlotPosition(slot) === position
        )
    );
}

/**
 * Resolves a player's contract promise for the completed season.
 * A broken commitment permanently damages trust with the promising team.
 */
function evaluateActivePlayerPromise(
    player,
    team,
    snapsThisSeason = 0,
    completedSeason = (game?.year || 1) - 1
) {
    const promise = player?.activePromise;

    if (!promise) {
        return { status: 'NONE', broken: false };
    }

    if (promise.teamId && promise.teamId !== team?.id) {
        player.activePromise = null;
        return { status: 'SUPERSEDED', broken: false };
    }

    const markPermanentDeparture = (reason) => {
        promise.broken = true;
        promise.brokenYear = completedSeason;
        promise.brokenReason = reason;

        if (player.personality) {
            player.personality.loyalty = 0;
        }

        player.refusedTeamIds = [
            ...new Set([
                ...(player.refusedTeamIds || []),
                team.id
            ])
        ];

        player.retentionHistory = player.retentionHistory || [];

        if (!player.retentionHistory.some(entry =>
            entry.year === completedSeason &&
            entry.outcome === 'BROKEN_PROMISE'
        )) {
            player.retentionHistory.push({
                year: completedSeason,
                outcome: 'BROKEN_PROMISE',
                reason
            });
        }

        return {
            status: 'BROKEN',
            broken: true,
            permanentDeparture: true,
            reason
        };
    };

    if (promise.broken) {
        return markPermanentDeparture(
            promise.brokenReason ||
            'Permanent departure: A previous promise was broken.'
        );
    }

    const promiseSeason = Number(promise.promiseSeason);

    // A promise must not be evaluated before its promised season finishes.
    if (
        promise.promiseSeason != null &&
        Number.isFinite(promiseSeason) &&
        promiseSeason > completedSeason
    ) {
        return { status: 'NOT_DUE', broken: false };
    }

    const position = promise.position ||
        player.pos ||
        estimateBestPosition(player);

    const snaps = Math.max(0, Number(snapsThisSeason) || 0);

    // STARTER and ROTATION have measurable minimum role expectations.
    if (promise.role === 'STARTER') {
        if (!isPlayerStarterAtPosition(player, team, position)) {
            return markPermanentDeparture(
                `Broken promise: Guaranteed ${position} starting role was not delivered.`
            );
        }

        if (snaps < 40) {
            return markPermanentDeparture(
                `Broken promise: The promised ${position} starting role did not provide meaningful playing time.`
            );
        }
    } else if (promise.role === 'ROTATION' && snaps < 15) {
        return markPermanentDeparture(
            'Broken promise: The promised rotation role did not provide meaningful playing time.'
        );
    }

    // Normalize promises from older saves.
    let promiseType = promise.promiseType;

    if (
        !promiseType &&
        promise.promiseTouches === 'FEATURED'
    ) {
        const oldPositionConfig = RETENTION_POSITION_CONFIG[position];
        promiseType = oldPositionConfig?.focusPromise?.value || 'NONE';
    }

    const stats = player.seasonStats || {};
    const target = Math.max(
        0,
        Number(promise.promiseTarget) ||
        RETENTION_POSITION_CONFIG[position]?.focusPromise?.target ||
        25
    );

    if (promiseType === 'PASSING_ROLE' && position === 'QB') {
        if ((stats.passAttempts || 0) < target) {
            return markPermanentDeparture(
                `Broken promise: The QB's ${target}-attempt passing commitment was not fulfilled.`
            );
        }
    } else if (
        promiseType === 'FEATURED_TOUCHES' &&
        position === 'RB'
    ) {
        const touches =
            (stats.rushAttempts || 0) +
            (stats.receptions || 0);

        if (touches < target) {
            return markPermanentDeparture(
                `Broken promise: The RB's ${target}-touch commitment was not fulfilled.`
            );
        }
    } else if (
        promiseType === 'FEATURED_CATCHES' &&
        ['WR', 'TE'].includes(position)
    ) {
        if ((stats.receptions || 0) < target) {
            return markPermanentDeparture(
                `Broken promise: The receiving commitment of ${target} catches was not fulfilled.`
            );
        }
    }

    player.retentionHistory = player.retentionHistory || [];
    player.retentionHistory.push({
        year: completedSeason,
        outcome: 'PROMISE_KEPT'
    });

    // A successfully completed contract promise is resolved exactly once.
    player.activePromise = null;

    return { status: 'KEPT', broken: false };
}

/**
 * Evaluates a GM's exit interview pitch to convince a flight-risk player to stay.
 * This function evaluates terms only; it does not mutate the roster or spend tokens.
 */
export function evaluateRetentionPitch(player, team, pitch = {}) {
    if (!player || !team) {
        return {
            accepted: false,
            score: 0,
            threshold: 52,
            reasons: ['Player or team is unavailable.'],
            quote: '"We need to talk when you have the details straight, Coach."'
        };
    }

    if (player.refusedTeamIds?.includes(team.id)) {
        return {
            accepted: false,
            score: 0,
            threshold: 100,
            reasons: [
                'Player permanently refuses to return after a broken promise.'
            ],
            quote: '"You already made your choice, Coach. I am not coming back."'
        };
    }

    const options = getRetentionPitchOptions(player);
    const position = options.position;

    const rolePromised = pitch.rolePromised || 'ROTATION';
    const reasons = [];

    const ego = player.personality?.ego ?? 50;
    const ethic = player.personality?.workEthic ?? 50;
    const loyalty = player.personality?.loyalty ?? 50;
    const cred = team.socialProfile?.streetCred ?? 50;
    const playerOvr = calculateOverall(player, position);

    const coach = team.staff?.coach || team.coach;
    const coachStyle =
        coach?.biases?.personality?.name ||
        coach?.type ||
        'Balanced Tactician';

    const rawTokens = Number(pitch.tokensOffered ?? 0);
    const tokens = Number.isFinite(rawTokens) ? Math.floor(rawTokens) : -1;
    const tokensAvailable = Math.max(
        0,
        Math.floor(Number(team.socialProfile?.favorTokens) || 0)
    );

    // Normalize the old modal's generic FEATURED value for compatibility.
    let promiseType = pitch.promiseType || 'NONE';

    if (!pitch.promiseType && pitch.promiseTouches === 'FEATURED') {
        promiseType = options.focusPromise?.value || 'NONE';

        if (promiseType === 'NONE') {
            reasons.push(
                `${position} has no applicable offensive workload promise; the offer will be evaluated on role and other terms.`
            );
        }
    }

    // Prevent impossible promises and invalid token spending.
    if (
        !['STARTER', 'ROTATION'].includes(rolePromised) ||
        !Number.isInteger(tokens) ||
        tokens < 0 ||
        tokens > 2 ||
        tokens > tokensAvailable ||
        (
            promiseType !== 'NONE' &&
            promiseType !== options.focusPromise?.value
        )
    ) {
        return {
            accepted: false,
            score: 0,
            threshold: 52,
            reasons: [
                'Invalid pitch terms, incompatible promise, or insufficient Favor Tokens.'
            ],
            quote: '"That offer does not add up, Coach. Try again."'
        };
    }

    // 1. Baseline trust and team reputation
    let score =
        Math.round(loyalty * 0.40) +
        Math.round((cred - 50) * 0.25);

    // A retention pitch must fit the team's established culture.
    if (coachStyle === 'Old-School Disciplinarian') {
        if (ego > 70 || ethic < 40) {
            score -= 12;
            reasons.push('Strict coaching culture clashes with the player (-12)');
        } else if (ethic >= 65) {
            score += 8;
            reasons.push('Hard-working player trusts the disciplined program (+8)');
        }
    } else if (coachStyle === "Players' Coach") {
        score += 8;
        reasons.push('Player-friendly coaching culture encourages him to stay (+8)');
    } else if (coachStyle === 'Analytical Savant') {
        if (playerOvr >= 55) {
            score += 6;
            reasons.push('Analytical coach has a clear role for a high-impact player (+6)');
        } else if (ethic < 40) {
            score -= 5;
            reasons.push("Coach doubts the player's commitment to the plan (-5)");
        }
    } else if (coachStyle === "Peaked in '94" && playerOvr >= 52) {
        score += 6;
        reasons.push('Competitive coach wants to keep a key contributor (+6)');
    }

    // 2. Role credibility and ego
    if (rolePromised === 'STARTER') {
        const boost = ego > 65 ? 26 : 18;
        score += boost;
        reasons.push(
            `${options.starterRoleLabel} promised (+${boost})`
        );
    } else if (ego > 70) {
        score -= 15;
        reasons.push('High ego rejects a rotation-level offer (-15)');
    } else {
        reasons.push('Offered a rotation role');
    }

    // 3. Position-specific workload commitments
    if (promiseType === 'PASSING_ROLE') {
        const boost = ego > 60 ? 22 : 12;
        score += boost;
        reasons.push(`Passing-game commitment (+${boost})`);
    } else if (promiseType === 'FEATURED_TOUCHES') {
        const boost = ego > 60 ? 22 : 12;
        score += boost;
        reasons.push(`Featured ball-carrier commitment (+${boost})`);
    } else if (promiseType === 'FEATURED_CATCHES') {
        const boost = ego > 60 ? 22 : 12;
        score += boost;
        reasons.push(`Featured receiving commitment (+${boost})`);
    }

    // 4. Favor Token sweeteners
    if (tokens === 1) {
        score += 24;
        reasons.push('Offered 1 Favor Token (+24)');
    } else if (tokens === 2) {
        score += 45;
        reasons.push('Offered 2 Favor Tokens (+45)');
    }

    // 5. Existing trust damage
    if (player.activePromise?.broken) {
        score -= 30;
        reasons.push('Remembers a broken promise (-30)');
    }

    // 6. Personality
    if (ethic >= 70) {
        score += 10;
        reasons.push('High work ethic appreciates direct communication (+10)');
    }

    // 7. Team outlook and acceptance threshold
    let threshold = 52;

    if (ego > 75) threshold += 12;

    const completedWins = Number.isFinite(Number(pitch.completedWins))
        ? Number(pitch.completedWins)
        : (team.wins ?? 0);

    if (completedWins >= 6) {
        score += 5;
        reasons.push('Coming off a winning season (+5)');
    } else if (completedWins <= 2) {
        threshold += 8;
    }

    const accepted = score >= threshold;

    // 8. Position-aware player response
    let quote;

    if (accepted) {
        if (tokens > 0) {
            quote = `"Alright, deal! I'll give the squad one more season, Coach."`;
        } else if (rolePromised === 'STARTER') {
            quote = `"That's what I needed to hear. Give me my shot, and we're good."`;
        } else {
            quote = `"Okay Coach, I'll give it one more year. Let's get to work."`;
        }
    } else if (score < 30) {
        quote = `"Save your breath. I'm packing my bag and playing somewhere else next year."`;
    } else {
        quote = `"I appreciate you coming by, but I need more than words to stay."`;
    }

    return {
        accepted,
        score,
        threshold,
        reasons,
        quote,
        rolePromised,
        promiseType,
        position
    };
}

/**
 * Builds and evaluates an AI coach's offseason retention offer.
 * AI and user offers use the same player-acceptance rules.
 */
export function evaluateAiRetentionPitch(player, team, context = {}) {
    if (!player || !team) {
        return {
            attempted: false,
            accepted: false,
            pitch: null,
            evaluation: null,
            reason: 'Player or team is unavailable.'
        };
    }

    if (player.refusedTeamIds?.includes(team.id)) {
        return {
            attempted: false,
            accepted: false,
            pitch: null,
            evaluation: null,
            reason: 'Player permanently refuses to return after a broken promise.'
        };
    }

    const options = getRetentionPitchOptions(player);
    const position = options.position;
    const coach = team.staff?.coach || team.coach;
    const coachStyle =
        coach?.biases?.personality?.name ||
        coach?.type ||
        'Balanced Tactician';
    const tactical = coach?.biases?.tactical?.name || 'Balanced Tactician';
    const gmDirective = team.gameplan?.gmDirective || 'COACH_AUTONOMY';

    const playerOvr = calculateOverall(player, position);
    const ego = player.personality?.ego ?? 50;
    const ethic = player.personality?.workEthic ?? 50;
    const loyalty = player.personality?.loyalty ?? 50;
    const happiness = player.expectations?.happiness ?? 100;

    const stats = player.seasonStats || {};
    const snaps = Math.max(
        0,
        Number(context.snapsThisSeason ?? player.careerStats?.snapsThisSeason) || 0
    );

    // Estimate contribution from position-relevant season production.
    // OL uses tracked snaps and starter status because its box-score stats
    // are limited compared with skill positions and defenders.
    let production = 0;

    if (position === 'QB') {
        production =
            (stats.passYards || 0) / 20 +
            (stats.passAttempts || 0) / 3 +
            (stats.touchdowns || 0) * 4 -
            (stats.interceptionsThrown || 0) * 3;
    } else if (position === 'RB') {
        production =
            (stats.rushYards || 0) / 12 +
            (stats.rushAttempts || 0) / 3 +
            (stats.receptions || 0) * 2 +
            (stats.touchdowns || 0) * 4;
    } else if (['WR', 'TE'].includes(position)) {
        production =
            (stats.recYards || 0) / 12 +
            (stats.receptions || 0) * 2 +
            (stats.targets || 0) * 0.4 +
            (stats.touchdowns || 0) * 4;
    } else if (position === 'OL') {
        production = snaps / 5;
    } else if (position === 'DL') {
        production =
            (stats.tackles || 0) * 1.5 +
            (stats.sacks || 0) * 6 +
            (stats.fumblesRecovered || 0) * 4 +
            (stats.interceptions || 0) * 5;
    } else {
        production =
            (stats.tackles || 0) * 1.2 +
            (stats.sacks || 0) * 3 +
            (stats.interceptions || 0) * 8 +
            (stats.fumblesRecovered || 0) * 4;
    }

    const productionScore = Math.min(
        100,
        Math.max(0, Math.round(production))
    );

    const currentStarter = isPlayerStarterAtPosition(
        player,
        team,
        position
    );

    const rosterCompetitors = getRosterObjects(team).filter(
        p => p && p.id !== player.id && isPlayerViableForPosition(p, position)
    );

    const requiredStarters = position === 'OL'
        ? 3
        : (['WR', 'DB', 'DL'].includes(position) ? 2 : 1);

    const competitorScores = rosterCompetitors
        .map(p => calculateOverall(p, position))
        .sort((a, b) => b - a);

    const weakestStarterOvr = competitorScores.length > 0
        ? competitorScores[
            Math.min(competitorScores.length - 1, requiredStarters - 1)
        ]
        : 0;

    // Avoid making a starting-role promise the roster plainly cannot support.
    const canCrediblyOfferStarter =
        currentStarter ||
        rosterCompetitors.length < requiredStarters ||
        playerOvr >= weakestStarterOvr - 2;

    const rolePromised = canCrediblyOfferStarter
        ? 'STARTER'
        : 'ROTATION';

    const isHighValue =
        playerOvr >= 52 ||
        productionScore >= 24 ||
        currentStarter;

    const isAggressive =
        coachStyle === "Peaked in '94" ||
        tactical === 'Blitz Addict' ||
        gmDirective === 'WIN_NOW';

    const isPlayerFriendly = coachStyle === "Players' Coach";
    const isConservative =
        tactical === 'Conservative Turtler' ||
        coachStyle === 'Analytical Savant';

    // Coaches don't all fight equally hard for every player.
    // High-value contributors matter most; player-friendly coaches are
    // more willing to repair a relationship with a lower-rated player.
    if (!isHighValue && !isPlayerFriendly) {
        return {
            attempted: false,
            accepted: false,
            pitch: null,
            evaluation: null,
            reason: 'AI coach prioritizes retaining more valuable contributors.'
        };
    }

    // Strict coaches are less likely to chase a low-value player whose
    // ego and work ethic conflict with their program.
    if (
        coachStyle === 'Old-School Disciplinarian' &&
        ego >= 82 &&
        ethic < 40 &&
        playerOvr < 60
    ) {
        return {
            attempted: false,
            accepted: false,
            pitch: null,
            evaluation: null,
            reason: 'Coach declines to pursue a poor culture fit.'
        };
    }

    const focusPromise = options.focusPromise;
    let currentWorkload = 0;

    if (position === 'QB') {
        currentWorkload = stats.passAttempts || 0;
    } else if (position === 'RB') {
        currentWorkload =
            (stats.rushAttempts || 0) +
            (stats.receptions || 0);
    } else if (['WR', 'TE'].includes(position)) {
        currentWorkload = stats.receptions || 0;
    }

    // AI coaches only promise a workload the player has already demonstrated
    // he can receive. Non-offensive positions have no workload promise.
    const shouldPromiseWorkload =
        focusPromise &&
        currentWorkload >= focusPromise.target &&
        (
            ego > 60 ||
            loyalty < 50 ||
            happiness < 65 ||
            isAggressive ||
            isPlayerFriendly
        );

    const promiseType = shouldPromiseWorkload
        ? focusPromise.value
        : 'NONE';

    const tokensAvailable = Math.max(
        0,
        Math.floor(Number(team.socialProfile?.favorTokens) || 0)
    );

    let tokensOffered = 0;

    const needsRelationshipRepair =
        loyalty < 45 || happiness < 50;

    const coachTeaching = coach?.ratings?.teaching ?? 50;
    const coachAuthority = coach?.ratings?.authority ?? 50;
    const coachQuality = (coachTeaching + coachAuthority) / 2;

    // Aggressive coaches may spend two tokens on a genuine cornerstone.
    // Conservative coaches reserve that spend for exceptional players.
    if (
        tokensAvailable >= 2 &&
        playerOvr >= 60 &&
        isHighValue &&
        (
            isAggressive ||
            loyalty < 35 ||
            happiness < 40
        ) &&
        (
            !isConservative ||
            (playerOvr >= 65 && productionScore >= 35)
        )
    ) {
        tokensOffered = 2;
    } else if (
        tokensAvailable >= 1 &&
        isHighValue &&
        (
            isAggressive ||
            (isPlayerFriendly && happiness < 65) ||
            loyalty < 45 ||
            happiness < 45 ||
            (playerOvr >= 58 && coachQuality >= 65)
        ) &&
        (
            !isConservative ||
            (
                playerOvr >= 58 &&
                productionScore >= 30 &&
                needsRelationshipRepair
            )
        )
    ) {
        tokensOffered = 1;
    }

    const pitch = {
        rolePromised,
        promiseType,
        tokensOffered,
        completedWins: Number(context.completedWins ?? team.wins ?? 0),
        completedLosses: Number(context.completedLosses ?? team.losses ?? 0)
    };

    const evaluation = evaluateRetentionPitch(player, team, pitch);

    return {
        attempted: true,
        accepted: evaluation.accepted,
        pitch,
        evaluation,
        reason: evaluation.accepted
            ? 'AI retention pitch accepted.'
            : 'Player rejected the AI retention pitch.'
    };
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
