// js/game/negotiations.js - Player & Staff Contract Negotiations & Retention

import {
    game,
    getRelationshipLevel,
    getPlayer,
    getRosterObjects,
    getTeamScoutingReport
} from './state.js';
import { relationshipLevels } from '../data.js';
import { calculateOverall, estimateBestPosition } from './player.js';
import {
    isPlayerNaturalForPosition,
    isPlayerViableForPosition,
    populateNaturalDepthOrder,
    rebuildDepthChartFromOrder
} from './depth_chart.js';

const NEGOTIATION_MAX_ROUNDS = 3;

const clampNegotiationValue = (value, min = 0, max = 100) =>
    Math.max(min, Math.min(max, Math.round(value)));

function getCoachAutonomyPreference(staff) {
    const storedPreference = Number(staff?.autonomyPreference);

    if (
        staff?.autonomyPreference != null &&
        staff.autonomyPreference !== '' &&
        Number.isFinite(storedPreference)
    ) {
        return clampNegotiationValue(storedPreference);
    }

    // Stable fallback for coaches generated before this attribute existed.
    const tactical = staff?.biases?.tactical?.name || '';
    const personality = staff?.biases?.personality?.name || '';

    let preference = 50;

    if (personality === 'Old-School Disciplinarian') {
        preference += 8;
    } else if (personality === "Peaked in '94") {
        preference += 10;
    } else if (personality === "Players' Coach") {
        preference -= 8;
    } else if (personality === 'Analytical Savant') {
        preference -= 5;
    }

    if (
        tactical === 'Air Raid Purist' ||
        tactical === 'Smashmouth Zealot' ||
        tactical === 'Blitz Addict'
    ) {
        preference += 8;
    } else if (
        tactical === 'Balanced Tactician' ||
        tactical === 'Conservative Turtler'
    ) {
        preference -= 4;
    }

    const authority = Number(staff?.ratings?.authority);

    if (Number.isFinite(authority)) {
        preference += Math.round((authority - 60) * 0.20);
    }

    const stubbornness = Number(staff?.stubbornness);

    if (Number.isFinite(stubbornness)) {
        preference += Math.round((stubbornness - 0.75) * 20);
    }

    return clampNegotiationValue(preference);
}

function getPreferredCoachPracticeFocus(staff, roleKey) {
    if (roleKey === 'scout') {
        return 'CHALK_TALK';
    }

    if (roleKey === 'trainer') {
        return 'CONDITIONING';
    }

    const personality = staff?.biases?.personality?.name || '';

    if (
        personality === 'Old-School Disciplinarian' ||
        personality === "Peaked in '94"
    ) {
        return 'CONDITIONING';
    }

    if (personality === "Players' Coach") {
        return 'FUN_SCRIMMAGE';
    }

    if (personality === 'Analytical Savant') {
        return 'CHALK_TALK';
    }

    return null;
}

function copyNegotiationTerms(offer = {}) {
    const copied = {};

    Object.entries(offer || {}).forEach(([key, value]) => {
        if (
            value === null ||
            ['string', 'number', 'boolean'].includes(typeof value)
        ) {
            copied[key] = value;
        }
    });

    return copied;
}

function createNegotiationSession(
    type,
    participant,
    team,
    context = {}
) {
    if (
        !participant ||
        participant.id == null ||
        !team ||
        team.id == null
    ) {
        return null;
    }

    return {
        version: 1,
        type,
        participantId: String(participant.id),
        teamId: String(team.id),
        roleKey: context.roleKey || null,
        round: 0,
        maxRounds: NEGOTIATION_MAX_ROUNDS,
        status: 'open',
        history: [],
        context: { ...context }
    };
}

function playerRefusesTeam(player, team) {
    if (team?.id == null || !Array.isArray(player?.refusedTeamIds)) {
        return false;
    }

    return player.refusedTeamIds.some(id =>
        id != null && String(id) === String(team.id)
    );
}

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

    const age =
        player.age == null || player.age === ''
            ? NaN
            : Number(player.age);

    const candidateStatus = String(
        player.status?.type || ''
    ).toLowerCase();

    if (
        player.teamId != null ||
        !Number.isInteger(age) ||
        age < 12 ||
        age > 18 ||
        ['retired', 'departed', 'temporary'].includes(candidateStatus)
    ) {
        return {
            shouldBid: false,
            desireScore: 0,
            offer: null,
            reason: 'Player is not eligible for free agency'
        };
    }

    const refusedTeamIds = Array.isArray(player.refusedTeamIds)
        ? player.refusedTeamIds.map(String)
        : [];

    if (refusedTeamIds.includes(String(aiTeam.id))) {
        return {
            shouldBid: false,
            desireScore: 0,
            offer: null,
            reason: 'Player refuses to return after a broken promise'
        };
    }

    const coach = aiTeam.staff?.coach || aiTeam.coach;
    const gm = aiTeam.aiGmProfile || aiTeam.staff?.gm || null;
    const roster = getRosterObjects(aiTeam);
    const tokensAvailable = aiTeam.socialProfile?.favorTokens || 0;

    // Evaluate external prospects using this team's scouting report.
    // Never calculate their true overall from hidden attributes.
    const scoutingReport = getTeamScoutingReport(aiTeam, player.id);

    const rawConfidence = Number(scoutingReport?.confidence);

    const reportConfidence = Number.isFinite(rawConfidence)
        ? Math.max(
            0,
            Math.min(
                1,
                rawConfidence > 1
                    ? rawConfidence / 100
                    : rawConfidence
            )
        )
        : 0;

    const validPositions = [
        'QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'
    ];

    const listedPosition = String(player.pos || '').toUpperCase();

    const reportFits = reportConfidence > 0
        ? [
            scoutingReport?.evaluation?.offenseFit,
            scoutingReport?.evaluation?.defenseFit
        ]
            .filter(fit =>
                validPositions.includes(
                    String(fit?.position || '').toUpperCase()
                ) &&
                fit.low != null &&
                fit.high != null &&
                Number.isFinite(Number(fit.low)) &&
                Number.isFinite(Number(fit.high))
            )
            .map(fit => {
                const low = Math.min(
                    Number(fit.low),
                    Number(fit.high)
                );

                const high = Math.max(
                    Number(fit.low),
                    Number(fit.high)
                );

                const estimatedOvr = (low + high) / 2;

                return {
                    ...fit,
                    position: String(fit.position).toUpperCase(),
                    estimatedOvr,

                    // Start at the lower end of the reported range.
                    // Higher scouting confidence moves the estimate
                    // toward the midpoint.
                    positionSelectionScore:
                        low +
                        (estimatedOvr - low) * reportConfidence
                };
            })
            .sort(
                (a, b) =>
                    b.positionSelectionScore -
                    a.positionSelectionScore
            )
        : [];

    // Prefer a team-specific scouting fit. If the player is unscouted,
    // fall back only to the publicly listed position.
    const bestReportedFit = reportFits[0] || null;

    const bestPos =
        bestReportedFit?.position ||
        (validPositions.includes(listedPosition)
            ? listedPosition
            : null);

    if (!bestPos) {
        return {
            shouldBid: false,
            desireScore: 0,
            offer: null,
            reason: 'Insufficient positional information'
        };
    }

    const selectedFit = reportFits.find(
        fit => fit.position === bestPos
    );

    // Unknown talent starts at a neutral prior, not the player's true OVR.
    // Lower-confidence reports pull estimates closer to neutral.
    const estimatedOvr = Number.isFinite(selectedFit?.estimatedOvr)
        ? selectedFit.estimatedOvr
        : 50;

    const playerOvr = Math.round(
        50 + (estimatedOvr - 50) * reportConfidence
    );

    // Only use physical estimates present in the team's own scouting report.
    // Shrink uncertain estimates toward a neutral prior rather than treating
    // every reported midpoint as equally reliable.
    const speedRange =
        scoutingReport?.attributeRanges?.physical?.speed;

    const hasSpeedEstimate =
        speedRange?.low != null &&
        speedRange?.high != null &&
        Number.isFinite(Number(speedRange.low)) &&
        Number.isFinite(Number(speedRange.high));

    const reportedSpeed = hasSpeedEstimate
        ? (
            Number(speedRange.low) +
            Number(speedRange.high)
        ) / 2
        : null;

    const speed = reportedSpeed == null
        ? null
        : 50 + (reportedSpeed - 50) * reportConfidence;

    // Personality traits are unknown unless this team has received
    // a character assessment in its scouting report.
    const characterSummary = String(
        scoutingReport?.evaluation?.characterSummary || ''
    ).toLowerCase();

    const ego = characterSummary.includes(
        'confident, assertive presence'
    )
        ? 76
        : characterSummary.includes('moderately assertive')
            ? 55
            : characterSummary.includes('quieter competitive presence')
                ? 35
                : null;

    const ethic = characterSummary.includes(
        'strong effort/reliability signals'
    )
        ? 78
        : characterSummary.includes('generally steady effort')
            ? 58
            : characterSummary.includes(
                'effort/reliability need closer review'
            )
                ? 38
                : null;

    // Age was validated at the beginning of the evaluator.

    // Resolve stable profile IDs while retaining support for legacy saves.
    const legacyProfileIds = {
        tactical: {
            'Smashmouth Zealot': 'power_run_specialist',
            'Air Raid Purist': 'spread_passing_specialist',
            'Blitz Addict': 'pressure_oriented_defender',
            'Conservative Turtler': 'conservative_game_manager',
            'Balanced Tactician': 'adaptive_strategist'
        },
        personality: {
            "Players' Coach": 'player_centered',
            'Old-School Disciplinarian': 'traditionalist',
            "Peaked in '94": 'hard_nosed_competitor',
            'Analytical Savant': 'analytical_planner'
        },
        scouting: {
            'Speed Chaser': 'athletic_bias_evaluator',
            'Technique Purist': 'technique_first_evaluator',
            'Character First': 'character_focused_evaluator',
            'Objective Scout': 'balanced_evaluator'
        }
    };

    const resolveProfileId = (
        staffMember,
        category,
        fallbackId
    ) => (
        staffMember?.profileIds?.[category] ||
        staffMember?.biases?.[category]?.id ||
        legacyProfileIds[category]?.[
            staffMember?.biases?.[category]?.name
        ] ||
        fallbackId
    );

    const tacticalId = resolveProfileId(
        coach,
        'tactical',
        'adaptive_strategist'
    );

    const personalityId = resolveProfileId(
        coach,
        'personality',
        'player_centered'
    );

    const scoutingCoach = aiTeam.staff?.scout || coach;

    const scoutingId = resolveProfileId(
        scoutingCoach,
        'scouting',
        'balanced_evaluator'
    );

    // Older saves without behavior profiles receive neutral tendencies.
    const getTendency = key => {
        const value = Number(
            coach?.behaviorProfile?.tendencies?.[key]
        );

        return Number.isFinite(value)
            ? Math.max(0, Math.min(100, value))
            : 50;
    };

    const riskTolerance = getTendency('riskTolerance');
    const discipline = getTendency('discipline');

    const gmDirective =
        gm?.strategicDirective ||
        aiTeam.gameplan?.gmDirective ||
        'COACH_AUTONOMY';

    const coachInstinct = Number(
        coach?.ratings?.gameplanInstinct
    ) || 50;

    const evalSkill = Math.round((
        (Number(scoutingCoach?.ratings?.evalTechnique) || 50) +
        (Number(scoutingCoach?.ratings?.evalPhysicals) || 50)
    ) / 2);

    // 1. GM DIRECTIVE POLICY FILTER
    if (gmDirective === 'DEVELOP_YOUTH' && age >= 16) {
        return { shouldBid: false, desireScore: 0, offer: null, reason: 'Youth directive: Skipping older prospects' };
    }
    if (gmDirective === 'WIN_NOW' && playerOvr < 48 && age <= 13) {
        return { shouldBid: false, desireScore: 0, offer: null, reason: 'Win-Now directive: Passing on raw developmental talent' };
    }

    // 2. CHARACTER & LOCKER ROOM CULTURE COMPATIBILITY
    if (
        (
            discipline >= 70 ||
            scoutingId === 'character_focused_evaluator'
        ) &&
        ego !== null &&
        ego > 72
    ) {
        return {
            shouldBid: false,
            desireScore: 0,
            offer: null,
            reason: 'Coach refuses to recruit high-ego prospects'
        };
    }
    // 3. VALUE OVER REPLACEMENT (VOR), STARTER GAPS & ROSTER DEPTH
    const allPositions = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'];

    const requiredForPosition = position =>
        position === 'OL'
            ? 3
            : ['WR', 'DB', 'DL'].includes(position)
                ? 2
                : 1;

    const backupTargetForPosition = position =>
        requiredForPosition(position) >= 2 ? 2 : 1;

    const requiredStarters = requiredForPosition(bestPos);

    // FIX: Filter strictly by natural position fit so entire rosters don't crowd out positions
    const naturalPlayers = roster.filter(
        p => isPlayerNaturalForPosition(p, bestPos)
    );

    const sortedStarters = naturalPlayers
        .map(p => calculateOverall(p, bestPos))
        .sort((a, b) => b - a);

    const expectedDepartures = naturalPlayers.filter(p => p.age >= 18).length;

    const missingStarters = Math.max(
        0,
        requiredStarters - (naturalPlayers.length - expectedDepartures)
    );

    const isDesperateVoid = missingStarters > 0;

    // Backups matter only after the team can field its starting unit.
    const backupCount = Math.max(
        0,
        (naturalPlayers.length - expectedDepartures) - requiredStarters
    );

    const missingBackups = isDesperateVoid
        ? 0
        : Math.max(
            0,
            backupTargetForPosition(bestPos) - backupCount
        );

    // Coach evaluation skill affects how accurately the prospect is judged.
    const evalNoise = evalSkill < 55
        ? Math.sin(playerOvr + age) * (60 - evalSkill) * 0.18
        : 0;

    const perceivedPlayerOvr = Math.round(playerOvr + evalNoise);

    // Compare against the weakest actual starter when the room is filled.
    // If the weakest starter is retiring, find the next guy on the depth chart.
    const returningStarters = naturalPlayers.filter(p => p.age < 18)
        .map(p => calculateOverall(p, bestPos))
        .sort((a, b) => b - a);

    const currentStarterOvr = returningStarters.length >= requiredStarters
        ? returningStarters[requiredStarters - 1]
        : (returningStarters[returningStarters.length - 1] || 0);

    const upgradeDelta = isDesperateVoid
        ? perceivedPlayerOvr - 30
        : perceivedPlayerOvr - currentStarterOvr;

    // A weak starting room creates recruitment demand even without a vacancy.
    const starterQualityNeed = isDesperateVoid
        ? 0
        : Math.max(
            0,
            Math.round((58 - currentStarterOvr) * 0.6)
        );

    // Reward genuine versatility when another position also lacks coverage.
    const reportedFitByPosition = new Map(
        reportFits.map(fit => [
            fit.position,
            50 + (fit.estimatedOvr - 50) * reportConfidence
        ])
    );

    const additionalFits = allPositions.filter(position => {
        if (position === bestPos) {
            return false;
        }

        // Versatility is recognized only when this team has scouting
        // evidence supporting another positional fit.
        const alternativeOvr = reportedFitByPosition.get(position);

        if (!Number.isFinite(alternativeOvr)) {
            return false;
        }

        if (alternativeOvr < playerOvr - 8) {
            return false;
        }

        const room = roster.filter(
            p => isPlayerNaturalForPosition(p, position)
        );

        const depthTarget =
            requiredForPosition(position) +
            backupTargetForPosition(position);

        return room.length < depthTarget;
    });

    const versatilityBonus = Math.min(
        12,
        additionalFits.reduce((total, position) => {
            const room = roster.filter(
                p => isPlayerNaturalForPosition(p, position)
            );

            return total + (
                room.length < requiredForPosition(position)
                    ? 7
                    : 4
            );
        }, 0)
    );

    // Combine positional need, backup depth, and starter quality.
    const roomNeedScore =
        missingStarters * 18 +
        missingBackups * 7 +
        starterQualityNeed;

    // Do not chase a downgrade when the room already has starters,
    // adequate backups, and no meaningful quality problem.
    if (
        !isDesperateVoid &&
        missingBackups === 0 &&
        starterQualityNeed === 0 &&
        upgradeDelta <= -2 &&
        naturalPlayers.length >= requiredStarters + 1
    ) {
        return {
            shouldBid: false,
            desireScore: 0,
            offer: null,
            reason: `Adequately staffed at ${bestPos} (Weakest starter: ${currentStarterOvr} OVR)`
        };
    }

    let desireScore =
        38 +
        Math.round(upgradeDelta * 2) +
        roomNeedScore +
        versatilityBonus;

    if (isDesperateVoid) {
        desireScore += 15;
    }

    // 4. PROGRAM DIRECTION & TACTICAL BIAS ALIGNMENT
    // The GM's program direction provides the primary organization structure.
    const programDirection = aiTeam.teamInstructions?.departments?.recruiting?.philosophy || gmDirective;
    let schemeBonus = 0;

    if (programDirection === 'WIN_NOW') {
        // Favor older, immediate starters
        if (perceivedPlayerOvr >= 58) schemeBonus += 12;
        if (age >= 16) schemeBonus += 8;
        if (age <= 13) schemeBonus -= 15;
    } else if (programDirection === 'DEVELOP_YOUTH') {
        // Favor young, high potential kids
        if (age <= 14) schemeBonus += 12;
        if (age >= 17) schemeBonus -= 10;
        
        // Peek at potential if we scouted enough to have an estimate
        const potRange = scoutingReport?.potentialRange;
        if (potRange && reportConfidence >= 0.6) {
            if (potRange.bestPossible === 'A' || potRange.worstPossible === 'B') schemeBonus += 15;
            if (potRange.worstPossible === 'F' || potRange.worstPossible === 'D') schemeBonus -= 10;
        }
    }

    // Coach Tactical Biases remain a soft secondary influence (+/- 8 instead of +/- 22)
    if (tacticalId === 'spread_passing_specialist') {
        if (['WR', 'TE', 'QB'].includes(bestPos)) schemeBonus += 8;
    } else if (tacticalId === 'power_run_specialist') {
        if (['OL', 'RB', 'TE'].includes(bestPos)) schemeBonus += 8;
        if (bestPos === 'WR') schemeBonus -= 5;
    } else if (tacticalId === 'pressure_oriented_defender') {
        if (['DL', 'LB', 'DB'].includes(bestPos) && speed !== null && speed > 60) {
            schemeBonus += 8;
        }
    }
    
    desireScore += schemeBonus;

    // 5. SCOUTING BIAS TASTES
    if (scoutingId === 'athletic_bias_evaluator') {
        if (speed !== null && speed >= 68) {
            desireScore += 20;
        } else if (speed !== null && speed < 46) {
            desireScore -= 22;
        }
    } else if (
        scoutingId === 'character_focused_evaluator' &&
        ethic !== null &&
        ethic >= 72
    ) {
        desireScore += 18;
    }
    // 6. SOCIAL NETWORK & SQUAD ANCHORS
    // Only use social information explicitly recorded in this team's
    // scouting report. Never inspect the prospect's private social graph.
    //
    // The current scouting-report schema does not yet persist verified
    // teammate friendship or rivalry observations, so these bonuses remain
    // inactive until that evidence is explicitly recorded.
    const networkEvidence = scoutingReport?.networkEvidence;

    const knownFriendIds = Array.isArray(
        networkEvidence?.knownTeammateFriendIds
    )
        ? networkEvidence.knownTeammateFriendIds.map(String)
        : [];

    const knownRivalIds = Array.isArray(
        networkEvidence?.knownTeammateRivalIds
    )
        ? networkEvidence.knownTeammateRivalIds.map(String)
        : [];

    const rosterIds = new Set(
        roster.map(member => String(member.id))
    );

    const hasKnownFriend = knownFriendIds.some(
        id => rosterIds.has(id)
    );

    const hasKnownRival = knownRivalIds.some(
        id => rosterIds.has(id)
    );

    if (hasKnownFriend) {
        desireScore += 24;
    }

    if (hasKnownRival) {
        desireScore -= 45;
    }

    if (desireScore < 45) {
        return { shouldBid: false, desireScore, offer: null, reason: 'Insufficient situational desire' };
    }

    // 7. ROLE & TOKEN BUDGETING (Intelligent Market Escalation & Counter-Bidding)
    const isAggressiveCoach =
        personalityId === 'hard_nosed_competitor' ||
        tacticalId === 'pressure_oriented_defender' ||
        riskTolerance >= 65 ||
        gmDirective === 'WIN_NOW';

    const isConservativeCoach =
        tacticalId === 'conservative_game_manager' ||
        personalityId === 'analytical_planner' ||
        riskTolerance <= 35;

    // Base pitch determination
    let role = (upgradeDelta >= 2 || isDesperateVoid)
        ? 'STARTER'
        : (playerOvr >= 46 ? 'ROTATION' : 'BENCH');

    // Use the position established from this team's scouting report
    // or the prospect's public listing. Do not let the helper infer
    // a hidden position from the prospect's true attributes.
    const retentionOptions = getRetentionPitchOptions({
        ...player,
        pos: bestPos
    });

    let promiseTouches = (
        ego > 65 &&
        retentionOptions.focusPromise &&
        desireScore > 65
    ) ? 'FEATURED' : 'NORMAL';

    let tokensToSpend = 0;
    if (tokensAvailable > 0) {
        const isFranchiseCornerstone = playerOvr >= 60 && (upgradeDelta >= 6 || isDesperateVoid);
        const isMajorUpgrade = upgradeDelta >= 8 || (isDesperateVoid && playerOvr >= 48);

        if (currentTopBidScore > 0) {
            const canJustifyWar = desireScore >= 68 || isDesperateVoid || isFranchiseCornerstone;

            if (canJustifyWar && !isConservativeCoach) {
                if (role === 'ROTATION' && ego > 60) role = 'STARTER';
                tokensToSpend = (isAggressiveCoach && tokensAvailable >= 2 && desireScore >= 78) ? 2 : 1;
            } else if (isConservativeCoach) {
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
        tokensOffered: tokensToSpend,
        position: bestPos
    };

    const recruitmentReason = isDesperateVoid
        ? `Urgent starter vacancy at ${bestPos}`
        : missingBackups > 0
            ? `Needs ${bestPos} backup depth`
            : starterQualityNeed > 0
                ? `Upgrade opportunity at ${bestPos}`
                : additionalFits.length > 0
                    ? `Versatile fit; also covers ${additionalFits.join(', ')}`
                    : upgradeDelta > 0
                        ? `+${upgradeDelta} OVR upgrade over current starter`
                        : 'Depth rotational fit';

    return {
        shouldBid: true,
        desireScore,
        offer,
        reason: recruitmentReason
    };
}

/**
 * Builds free-agency market intel from observable recruiting activity.
 *
 * Rival interest scores are intentionally not read. Estimated interest
 * ranges are inferred from recorded effort, action types, and known
 * diminishing returns.
 */
export function generatePlayerRumors(player, gameState) {
    const quietResult = {
        heat: 'QUIET',
        suitorTeams: [],
        suitorNames: [],
        suitorDetails: [],
        estimatedLeader: null,
        leadStatus: 'No recorded pursuit',
        rumorText: 'No schools have made recorded recruiting contact yet.',
        keyFactor: 'No recorded pursuit'
    };

    if (!player || player.id == null || !gameState) {
        return quietResult;
    }

    const mainTeams = (gameState.teams || []).filter(
        team => team?.leagueType === 'main' && team.id != null
    );

    const teamsById = new Map(
        mainTeams.map(team => [String(team.id), team])
    );

    const progress =
        gameState.offseasonState?.recruitingProgress;

    const currentYear = Number(gameState.year);

    const activities = (
        Array.isArray(progress?.dailyActivity)
            ? progress.dailyActivity
            : []
    )
        .filter(activity =>
            activity &&
            String(activity.playerId) === String(player.id) &&
            Number(activity.year) === currentYear &&
            teamsById.has(String(activity.teamId)) &&
            [
                'recruiting_action',
                'recruiting_sweetener'
            ].includes(activity.type)
        )
        .sort((a, b) =>
            (Number(a.day) || 0) - (Number(b.day) || 0)
        );

    if (activities.length === 0) {
        return quietResult;
    }

    const actionRates = {
        outreach: 2.2,
        teammateConnection: 1.9,
        roleDiscussion: 2.1,
        practiceInvitation: 2.3
    };

    const teamActivity = new Map();

    for (const activity of activities) {
        const teamKey = String(activity.teamId);
        const team = teamsById.get(teamKey);

        if (!team) continue;

        if (!teamActivity.has(teamKey)) {
            teamActivity.set(teamKey, {
                team,
                actionCount: 0,
                sweetenerCount: 0,
                totalHours: 0,
                lastActivityDay: 0,
                actionHistory: {},
                activityDays: new Set(),
                estimatedLow: 0,
                estimatedHigh: 0
            });
        }

        const entry = teamActivity.get(teamKey);
        const activityDay = Number(activity.day) || 0;

        entry.lastActivityDay = Math.max(
            entry.lastActivityDay,
            activityDay
        );

        if (activity.type === 'recruiting_action') {
            const actionType = String(activity.action || '');
            const pointsPerHour = actionRates[actionType];

            if (!Number.isFinite(pointsPerHour)) continue;

            const hours = Math.max(
                0,
                Number(activity.hours) || 0
            );

            if (hours <= 0) continue;

            entry.activityDays.add(activityDay);

            const repeatedActions =
                entry.actionHistory[actionType] || 0;

            const repetitionMultiplier =
                Math.pow(0.75, repeatedActions);

            const baseEstimate =
                hours *
                pointsPerHour *
                repetitionMultiplier;

            // Rival coach skill is unknown. Estimate using the engine's
            // possible skill multiplier range, not the rival's actual rating.
            entry.estimatedLow += baseEstimate * 0.65;
            entry.estimatedHigh += baseEstimate * 1.35;

            entry.actionHistory[actionType] =
                repeatedActions + 1;

            entry.actionCount += 1;
            entry.totalHours += hours;
        }

        if (activity.type === 'recruiting_sweetener') {
            // The fact that a sweetener was used is observable.
            // Its exact interest gain is deliberately not disclosed.
            const tokensSpent = Math.max(
                0,
                Number(activity.tokensSpent) || 0
            );

            const cashSpent = Math.max(
                0,
                Number(activity.cashSpent) || 0
            );

            if (tokensSpent > 0 || cashSpent > 0) {
                entry.activityDays.add(activityDay);
                entry.sweetenerCount += 1;

                // Sweeteners increase the estimated range, but their
                // actual internal interest gain remains hidden.
                entry.estimatedHigh += tokensSpent > 0 ? 8 : 0;
                entry.estimatedHigh += cashSpent > 0 ? 6 : 0;
            }
        }
    }

    const currentDay = Math.max(
        1,
        Number(gameState.offseasonState?.recruitingDay) || 1
    );

    const suitorDetails = [...teamActivity.values()]
        .filter(entry =>
            entry.actionCount > 0 ||
            entry.sweetenerCount > 0
        )
        .map(entry => {
            const estimatedLow = Math.max(
                0,
                Math.min(100, Math.floor(entry.estimatedLow))
            );

            const estimatedHigh = Math.max(
                estimatedLow,
                Math.min(100, Math.ceil(entry.estimatedHigh))
            );

            const estimatedMidpoint = Math.round(
                (estimatedLow + estimatedHigh) / 2
            );

            const daysSinceContact = Math.max(
                0,
                currentDay - entry.lastActivityDay
            );

            const activityDays = [...entry.activityDays];

            const recentActivityDays = activityDays.filter(day =>
                day >= currentDay - 1 &&
                day <= currentDay
            ).length;

            // Momentum rewards current contact and sustained pursuit.
            const recencyScore = Math.max(
                0,
                30 - daysSinceContact * 10
            );

            const consistencyScore = Math.min(
                30,
                activityDays.length * 6
            );

            const recentActivityScore = Math.min(
                40,
                recentActivityDays * 20
            );

            const momentumScore = Math.max(
                0,
                Math.min(
                    100,
                    Math.round(
                        recencyScore +
                        consistencyScore +
                        recentActivityScore
                    )
                )
            );

            const momentum =
                momentumScore >= 75
                    ? 'Surging'
                    : momentumScore >= 55
                        ? 'Building'
                        : momentumScore >= 35
                            ? 'Active'
                            : momentumScore >= 15
                                ? 'Cooling'
                                : 'Stalled';

            // Combine estimated interest and momentum for pursuit ranking.
            // Keep the underlying interest estimate separate.
            const pursuitRankScore = Math.round(
                estimatedMidpoint * 0.75 +
                momentumScore * 0.25
            );

            const confidence =
                entry.actionCount >= 5 && entry.totalHours >= 8
                    ? 'Moderate'
                    : entry.actionCount >= 2 || entry.sweetenerCount > 0
                        ? 'Low–Moderate'
                        : 'Low';

            const activityLevel =
                entry.totalHours >= 6 || entry.sweetenerCount >= 2
                    ? 'Heavy'
                    : entry.totalHours >= 3 || entry.sweetenerCount > 0
                        ? 'Moderate'
                        : 'Light';

            return {
                team: entry.team,
                teamId: entry.team.id,
                teamName: entry.team.name,

                momentum,
                momentumScore,
                pursuitRankScore,
                activeDaysCount: activityDays.length,
                recentActivityDays,
                actionCount: entry.actionCount,
                sweetenerCount: entry.sweetenerCount,
                totalHours: entry.totalHours,
                lastActivityDay: entry.lastActivityDay,
                daysSinceContact,
                estimatedInterestRange: {
                    low: estimatedLow,
                    high: estimatedHigh
                },
                estimatedMidpoint,
                confidence,
                activityLevel
            };
        })
        .sort((a, b) =>
            b.pursuitRankScore - a.pursuitRankScore ||
            b.estimatedMidpoint - a.estimatedMidpoint ||
            b.lastActivityDay - a.lastActivityDay
        );
    if (suitorDetails.length === 0) {
        return quietResult;
    }

    const suitorTeams = suitorDetails
        .slice(0, 3)
        .map(entry => entry.team);

    const suitorNames = suitorTeams.map(team => team.name);

    const pursuitLeader = suitorDetails[0];

    const interestRanked = [...suitorDetails].sort(
        (a, b) =>
            b.estimatedMidpoint - a.estimatedMidpoint ||
            b.totalHours - a.totalHours
    );

    const leader = interestRanked[0];
    const runnerUp = interestRanked[1] || null;

    let heat = 'WARM';

    if (suitorDetails.length >= 2) {
        heat = 'HOT';
    }

    let leadStatus = 'Only recorded suitor';

    if (runnerUp) {
        leadStatus =
            leader.estimatedInterestRange.low >
            runnerUp.estimatedInterestRange.high
                ? 'Estimated lead'
                : 'Close race';
    }

    const rumorText = runnerUp
        ? `${leader.teamName} and ${runnerUp.teamName} are among the most active schools pursuing this player.`
        : `${leader.teamName} has made recorded recruiting contact with this player.`;

    return {
        heat,
        suitorTeams,
        suitorNames,
        suitorDetails,
        estimatedLeader: leader.teamName,
        leadStatus,
        rumorText,
        keyFactor: `Most observed effort: ${leader.teamName}`,
        estimateBasis: 'Observed recruiting activity',
        estimateNote:
            'Estimated interest is a range, not the rival school’s actual internal score.'
    };
}

export function getPlayerMarketIntel(player, gameState) {
    if (
        !player ||
        player.id == null ||
        !gameState
    ) {
        return generatePlayerRumors(player, gameState);
    }

    if (!(gameState._faMarketCache instanceof Map)) {
        gameState._faMarketCache = new Map();
    }

    const progress =
        gameState.offseasonState?.recruitingProgress;

    const activities = Array.isArray(progress?.dailyActivity)
        ? progress.dailyActivity
        : [];

    // Any new recruiting action or sweetener changes the signature.
    // The next market-intel request will then rebuild the estimate.
    const cacheSignature = [
        Number(gameState.year) || 0,
        Number(progress?.seasonYear) || 0,
        Number(progress?.recruitingDay) || 0,
        activities.length
    ].join(':');

    const cached = gameState._faMarketCache.get(player.id);

    if (
        !cached ||
        cached.signature !== cacheSignature ||
        !cached.intel
    ) {
        const intel = generatePlayerRumors(player, gameState);

        gameState._faMarketCache.set(player.id, {
            signature: cacheSignature,
            intel
        });

        return intel;
    }

    return cached.intel;
}

export function clearPlayerMarketCache(gameState) {
    if (gameState) gameState._faMarketCache = new Map();
}

/**
 * Checks if a player instantly accepts an in-season offer.
 */
export function checkInstantCommit(player, team, evalResult, offer) {
    if (!evalResult.accepted) return false;

    const validPositions = [
        'QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'
    ];

    const offeredPosition = String(
        offer.position || ''
    ).toUpperCase();

    const bestPos = validPositions.includes(offeredPosition)
        ? offeredPosition
        : (player.pos || estimateBestPosition(player));

    const playerOvr = calculateOverall(player, bestPos);

    if (playerOvr >= 55) {
        const bestFriendId = player.social?.bestFriendId;

        const hasBFF = bestFriendId != null &&
            getRosterObjects(team).some(rosterPlayer =>
                String(rosterPlayer?.id) === String(bestFriendId)
            );

        return evalResult.interestScore >= 88 &&
            (offer.tokensOffered >= 2 || hasBFF);
    }

    const isBlowaway = (offer.tokensOffered >= 2) && (offer.role === 'STARTER');
    return isBlowaway || evalResult.interestScore >= 82;
}

export function resolvePlayerBiddingWar(player, bids = []) {
    if (!bids || bids.length === 0) return null;

    const scoredBids = bids.map(bid => {
        const evaluation = evaluatePlayerNegotiation(
            player,
            bid.team,
            bid.offer
        );

        return {
            ...bid,
            evaluation,
            score: evaluation.interestScore + (Math.random() * 4 - 2)
        };
    });

    scoredBids.sort((a, b) => b.score - a.score);

    // A team must actually meet the prospect's acceptance threshold
    // before it can win the bidding war.
    const acceptableBids = scoredBids.filter(
        bid => bid.evaluation.accepted
    );

    if (acceptableBids.length === 0) {
        const leadingBid = scoredBids[0];
        const threshold = leadingBid.evaluation.threshold || 48;

        const negativeReasons = (
            leadingBid.evaluation.reasons || []
        ).filter(reason => reason.includes('-'));

        const reason = negativeReasons.length > 0
            ? negativeReasons.slice(0, 2).join('; ')
            : `Fell short of prospect's caliber expectations (${leadingBid.evaluation.interestScore}/${threshold} interest).`;

        return {
            winner: null,
            competingBids: scoredBids,
            rejectedReason: reason
        };
    }

    return {
        winner: acceptableBids[0],
        competingBids: scoredBids
    };
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

    const candidateAge =
        player.age == null || player.age === ''
            ? NaN
            : Number(player.age);

    const candidateStatus = String(
        player.status?.type || ''
    ).toLowerCase();

    if (
        player.teamId != null ||
        !Number.isInteger(candidateAge) ||
        candidateAge < 12 ||
        candidateAge > 18 ||
        ['retired', 'departed', 'temporary'].includes(candidateStatus)
    ) {
        return {
            accepted: false,
            interestScore: 0,
            threshold: 100,
            reasons: ['Player is not eligible for free agency.'],
            roleOffered,
            promiseTouches: offer.promiseTouches || 'NORMAL'
        };
    }

    if (playerRefusesTeam(player, team)) {
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

    const validPositions = [
        'QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'
    ];

    const offeredPosition = String(
        offer?.position || ''
    ).toUpperCase();

    const bestPos = validPositions.includes(offeredPosition)
        ? offeredPosition
        : (player.pos || estimateBestPosition(player));

    const playerOvr = calculateOverall(player, bestPos);
    const age = player.age || 14;
    const ego = player.personality?.ego || 50;
    const ethic = player.personality?.workEthic || 50;
    const cred = team.socialProfile?.streetCred || 50;
    const teamOffense = team.formations?.offense || 'Balanced';

    // 1. TALENT LEVERAGE & AGE BASELINE
    let interest = 36;
    if (playerOvr >= 62) {
        interest = 18;
    } else if (playerOvr >= 52) {
        interest = 28;
    } else if (playerOvr < 40) {
        interest = 44;
    }

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
        interest -= 14;
        reasons.push("📉 Reluctant to play in Sandlot Circuit Tier 2 (-14)");
    }

    // 3. SOCIAL BONDS & CHEMISTRY
    // Normalize IDs so relationships work across numeric/string save formats.
    const normalizeRelationshipIds = ids => new Set(
        (Array.isArray(ids) ? ids : [])
            .filter(id => id != null)
            .map(String)
    );

    const bestFriendId = player.social?.bestFriendId;

    const goodFriendIds = normalizeRelationshipIds(
        player.social?.goodFriendIds
    );

    const rivalIds = normalizeRelationshipIds(
        player.social?.rivalIds
    );

    const hasBFF = bestFriendId != null &&
        roster.some(r =>
            String(r?.id) === String(bestFriendId)
        );

    if (hasBFF) {
        interest += 28;
        reasons.push("🤝 Best friend is on team (+28)");
    }

    const friendsCount = roster.filter(r =>
        r?.id != null && goodFriendIds.has(String(r.id))
    ).length;

    if (friendsCount > 0) {
        const bonus = Math.min(20, friendsCount * 8);
        interest += bonus;
        reasons.push(`👥 ${friendsCount} friend(s) on team (+${bonus})`);
    }

    const rival = roster.find(r =>
        r?.id != null && rivalIds.has(String(r.id))
    );

    if (rival) {
        interest -= 45;
        reasons.push(
            `⚠️ Sworn rival (${String(rival.name || 'Teammate').split(' ')[0]}) on roster (-45)`
        );
    }

    const captain = team.captainId == null
        ? null
        : roster.find(r =>
            String(r?.id) === String(team.captainId)
        );

    const playerClique = player.personality?.clique;
    const captainClique = captain?.personality?.clique;

    if (
        captain &&
        playerClique != null &&
        captainClique != null &&
        captainClique === playerClique
    ) {
        interest += 6;
        reasons.push(`🧢 Shares clique with captain (${playerClique}) (+6)`);
    }

    // 4. DEPTH CHART REALITY CHECK (Detecting Fake "Starter" Promises)
    // FIX: Only natural players for this position count as true competitors
    const naturalCompetitors = roster.filter(p => isPlayerNaturalForPosition(p, bestPos));
    const topCompetitorOvr = naturalCompetitors.map(p => calculateOverall(p, bestPos)).sort((a, b) => b - a)[0] || 0;

    if (roleOffered === 'STARTER') {
        if (topCompetitorOvr >= playerOvr + 4 && ego > 55) {
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

        const depthChartQb = qb1Id != null
            ? getPlayer(qb1Id)
            : null;

        const depthChartQbIsValid =
            depthChartQb &&
            roster.some(rosterPlayer =>
                rosterPlayer?.id != null &&
                String(rosterPlayer.id) === String(depthChartQb.id)
            ) &&
            isPlayerNaturalForPosition(depthChartQb, 'QB');

        // Only trust the depth-chart QB if they are still on this
        // team's roster and remain a natural quarterback.
        const qb1 = depthChartQbIsValid
            ? depthChartQb
            : roster.find(p => isPlayerNaturalForPosition(p, 'QB'));

        const qbThrow =
            qb1?.attributes?.technical?.throwingAccuracy ?? 40;

        if (qbThrow >= 65) {
            const qbName = String(qb1?.name || 'QB').split(' ')[0];

            interest += 14;
            reasons.push(
                `🎯 Excited to catch passes from top QB ${qbName} (+14)`
            );
        } else if (qbThrow < 42) {
            interest -= 16;
            reasons.push(
                "🤦 Distrusts team's inaccurate quarterback play (-16)"
            );
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
    const promiseOptions = getRetentionPitchOptions({
        ...player,
        pos: bestPos
    });

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
    const coachStyle = coach?.biases?.personality?.name || coach?.type;
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
    let threshold = 42;
    if (playerOvr >= 62) threshold += 12;
    else if (playerOvr >= 52) threshold += 6;
    if (ego > 75) threshold += 6;
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
            : 'NONE',
        position: bestPos
    };
}

/**
 * Evaluates whether an available staff member agrees to sign.
 */
export function evaluateStaffNegotiation(staff, team, roleKey, pitch = {}) {
    const pitchDetails = (
        pitch !== null &&
        typeof pitch === 'object'
    ) ? pitch : {};

    const rawTokensOffered = typeof pitch === 'number'
        ? pitch
        : (pitchDetails.tokensOffered ?? 0);

    const rawCashOffered = pitchDetails.cashOffered ?? 0;

    const parsedTokens = Number(rawTokensOffered);
    const parsedCash = Number(rawCashOffered);

    const tokensOffered = Number.isFinite(parsedTokens)
        ? parsedTokens
        : -1;

    const cashOffered = Number.isFinite(parsedCash)
        ? parsedCash
        : -1;

    const rawTokenBalance = Number(
        team?.socialProfile?.favorTokens
    );

    const tokensAvailable = Number.isFinite(rawTokenBalance)
        ? Math.max(0, Math.floor(rawTokenBalance))
        : 0;

    const rawCashBalance = Number(team?.finances?.balance);

    const cashAvailable = Number.isFinite(rawCashBalance)
        ? Math.max(0, rawCashBalance)
        : 0;

    const managementApproach = String(
        team?.gmProfile?.managementApproach ||
        team?.aiGmProfile?.managementApproach ||
        team?.userCoachProfile?.managementApproach ||
        'balanced'
    );

    const configuredControlStructure = String(
        team?.gmProfile?.managementControlStructure || ''
    );

    const controlStructureSchemePromise = {
        gm_directed: 'GM_CHOICE',
        shared: 'SHARED_CONTROL',
        coach_influenced: 'COACH_CHOICE'
    }[configuredControlStructure];

    // Preserve legacy behavior for older saves and AI teams
    // that do not have the separately stored control structure.
    const defaultSchemePromise =
        controlStructureSchemePromise || {
            system_first: 'GM_CHOICE',
            balanced: 'SHARED_CONTROL',
            personnel_first: 'COACH_CHOICE'
        }[managementApproach] || 'SHARED_CONTROL';

    const schemePromise = [
        'GM_CHOICE',
        'SHARED_CONTROL',
        'COACH_CHOICE'
    ].includes(pitchDetails.schemePromise)
        ? pitchDetails.schemePromise
        : defaultSchemePromise;

    const practiceFocus =
        pitchDetails.practiceFocus || 'BALANCED';

    const autonomyPreference =
        getCoachAutonomyPreference(staff);

    if (
        !Number.isInteger(tokensOffered) ||
        tokensOffered < 0 ||
        tokensOffered > 2 ||
        tokensOffered > tokensAvailable ||
        !Number.isFinite(cashOffered) ||
        cashOffered < 0 ||
        cashOffered > cashAvailable
    ) {
        return {
            accepted: false,
            interestScore: 0,
            threshold: 100,
            reasons: [
                'Invalid offer or insufficient team funds/Favor Tokens.'
            ],
            quote: '"Those terms are not available to your program."',
            schemePromise,
            practiceFocus
        };
    }

    const cred = team.socialProfile?.streetCred || 50;
    let interest = Math.round(cred * 0.42);
    const reasons = [];

    const ratingAvg = Math.round(
        ((staff.ratings?.offSchemeMastery || 50) + 
         (staff.ratings?.defSchemeMastery || 50) + 
         (staff.ratings?.teaching || 50)) / 3
    );

    // 1. FINANCIAL STIPEND & MARKET DESPERATION EVALUATION
    const weeksUnemployed = Math.max(
        0,
        Number(staff.weeksUnemployed) || 0
    );

    const rawStubbornness = Number(staff.stubbornness);

    const stubbornness = Number.isFinite(rawStubbornness)
        ? Math.max(0, Math.min(1, rawStubbornness))
        : 0.75;

    const baseStipend = Math.max(
        0,
        Math.round((ratingAvg - 52) * 0.50)
    );

    const marketDecay = Math.pow(
        stubbornness,
        weeksUnemployed
    );

    const requiredStipend = Math.max(
        0,
        Math.round(baseStipend * marketDecay)
    );

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

    if (weeksUnemployed >= 2) {
        const desperationBonus = Math.round(
            weeksUnemployed * 6 * (1.0 - stubbornness)
        );
        if (desperationBonus > 0) {
            interest += desperationBonus;
            reasons.push(`⏳ Eager to return to sideline after ${weeksUnemployed} weeks without team (+${desperationBonus})`);
        }
    }

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
        // FIX: Find natural QB for Air Raid audit
        if (tactical === 'Air Raid Purist') {
            const qb1 = roster.find(p => isPlayerNaturalForPosition(p, 'QB'));
            const qbThrow = qb1?.attributes?.technical?.throwingAccuracy || 35;
            if (qbThrow < 45) {
                interest -= 20;
                reasons.push("❌ Roster lacks accurate QB to execute Air Raid passing (-20)");
            }
            if (['Spread', 'Empty', 'Trips', 'TripsLeft'].includes(teamOffense)) {
                interest += 14;
                reasons.push("🚀 Roster already set in Spread formations (+14)");
            }
        // FIX: Count natural OL & TE blockers for Smashmouth front
        } else if (tactical === 'Smashmouth Zealot') {
            const heavyCount = roster.filter(p => isPlayerNaturalForPosition(p, 'OL') || isPlayerNaturalForPosition(p, 'TE')).length;
            if (heavyCount < 4) {
                interest -= 18;
                reasons.push("❌ Lacks physical blockers needed for Smashmouth front (-18)");
            }
            if (['Power', 'Jumbo'].includes(teamOffense)) {
                interest += 14;
                reasons.push("🔨 Physical downhill offensive alignment (+14)");
            }
        }

        const offeredControlLevel =
            schemePromise === 'COACH_CHOICE'
                ? 90
                : schemePromise === 'SHARED_CONTROL'
                    ? 55
                    : 20;

        const authorityFit = clampNegotiationValue(
            18 - Math.abs(
                autonomyPreference - offeredControlLevel
            ) * 0.42,
            -18,
            18
        );

        interest += authorityFit;

        const controlLabel =
            schemePromise === 'COACH_CHOICE'
                ? 'Full coach autonomy'
                : schemePromise === 'SHARED_CONTROL'
                    ? 'Shared scheme authority'
                    : 'GM-controlled schemes';

        reasons.push(
            `📋 ${controlLabel} matches coach preference ` +
            `(${authorityFit >= 0 ? '+' : ''}${authorityFit})`
        );
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

    // 3B. MANAGEMENT PHILOSOPHY COMPATIBILITY
    // The head coach should be comfortable with the program's
    // broader practice culture, not just the authority in their offer.
    if (roleKey === 'coach') {
        const normalizedManagementApproach = [
            'system_first',
            'balanced',
            'personnel_first'
        ].includes(managementApproach)
            ? managementApproach
            : 'balanced';

        const approachPracticeFocus = {
            system_first: 'CHALK_TALK',
            balanced: 'BALANCED',
            personnel_first: 'FUN_SCRIMMAGE'
        }[normalizedManagementApproach];

        if (practiceFocus === approachPracticeFocus) {
            interest += 6;

            reasons.push(
                `🎯 Practice commitment reinforces the program's ` +
                `${normalizedManagementApproach.replace('_', '-')} identity (+6)`
            );
        } else if (
            (
                normalizedManagementApproach === 'system_first' &&
                practiceFocus === 'FUN_SCRIMMAGE'
            ) ||
            (
                normalizedManagementApproach === 'personnel_first' &&
                practiceFocus === 'CHALK_TALK'
            )
        ) {
            interest -= 5;

            reasons.push(
                `⚠️ Practice commitment clashes with the program's ` +
                `${normalizedManagementApproach.replace('_', '-')} identity (-5)`
            );
        }
    }

    // 4. FAVOR TOKEN SWEETENERS
    if (tokensOffered > 0) {
        const tokenBoost = tokensOffered === 1 ? 16 : 32;
        interest += tokenBoost;
        reasons.push(`🤝 Favor Tokens offered (+${tokenBoost})`);
    }

    let threshold = 46;
    if (ratingAvg >= 72) threshold += 12;
    else if (ratingAvg >= 62) threshold += 6;

    const accepted = interest >= threshold;

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
        threshold,
        requiredStipend,
        autonomyPreference,
        reasons,
        quote,
        schemePromise,
        autonomyLabel: {
            GM_CHOICE: 'GM Control',
            SHARED_CONTROL: 'Shared Control',
            COACH_CHOICE: 'Coach Autonomy'
        }[schemePromise],
        practiceFocus
    };
}

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

    if (player.expectations?.desiredRole === 'STARTER' && snapsThisSeason < 40) {
        stayScore -= 28;
    }

    if (team.wins <= 2) {
        if (ego > 70) stayScore -= 14;
        else if (ego > 50) stayScore -= 6;
    }

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
 */
export function createPlayerPromise(
    player,
    team,
    offer = {},
    metadata = {}
) {
    if (!player || !team) return null;

    const validPositions = [
        'QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'
    ];

    const offeredPosition = String(
        offer.position || ''
    ).toUpperCase();

    const promisePosition = validPositions.includes(offeredPosition)
        ? offeredPosition
        : (player.pos || estimateBestPosition(player));

    const options = getRetentionPitchOptions({
        ...player,
        pos: promisePosition
    });
    const validRoles = ['STARTER', 'ROTATION', 'BENCH'];

    const offeredRole = offer.role ?? offer.rolePromised ?? 'ROTATION';
    const role = validRoles.includes(offeredRole)
        ? offeredRole
        : 'ROTATION';

    let promiseType = offer.promiseType;

    if (promiseType == null) {
        promiseType = offer.promiseTouches === 'FEATURED'
            ? (options.focusPromise?.value || 'NONE')
            : 'NONE';
    }

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

    const normalizedPosition =
        normalizePromiseSlotPosition(position);

    return charts.some(chart =>
        Object.entries(chart).some(([slot, playerId]) =>
            playerId != null &&
            String(playerId) === String(player.id) &&
            normalizePromiseSlotPosition(slot) === normalizedPosition
        )
    );
}

/**
 * Resolves a player's contract promise for the completed season.
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

    if (
        promise.teamId != null &&
        String(promise.teamId) !== String(team?.id ?? '')
    ) {
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

        const existingRefusals = Array.isArray(
            player.refusedTeamIds
        )
            ? player.refusedTeamIds
            : [];

        const alreadyRefusesTeam = existingRefusals.some(id =>
            id != null && String(id) === String(team.id)
        );

        player.refusedTeamIds = alreadyRefusesTeam
            ? existingRefusals
            : [...existingRefusals, team.id];

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

    if (promise.role === 'STARTER') {
        // An injured starter temporarily rotated off Week 9's depth chart shouldn't
        // trigger a broken promise if he actually started and logged regular snaps.
        const wasRegularStarter = snaps >= 120;
        if (!isPlayerStarterAtPosition(player, team, position) && !wasRegularStarter) {
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

    player.activePromise = null;

    return { status: 'KEPT', broken: false };
}

/**
 * Evaluates a GM's exit interview pitch to convince a flight-risk player to stay.
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

    if (playerRefusesTeam(player, team)) {
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

    let promiseType = pitch.promiseType || 'NONE';

    if (!pitch.promiseType && pitch.promiseTouches === 'FEATURED') {
        promiseType = options.focusPromise?.value || 'NONE';

        if (promiseType === 'NONE') {
            reasons.push(
                `${position} has no applicable offensive workload promise; the offer will be evaluated on role and other terms.`
            );
        }
    }

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

    if (playerRefusesTeam(player, team)) {
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
    const coachStyle = coach?.biases?.personality?.name || coach?.type || 'Balanced Tactician';
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

    // FIX: Filter roster competitors strictly by natural position fit
    const rosterCompetitors = getRosterObjects(team).filter(
        p =>
            p &&
            String(p.id) !== String(player.id) &&
            isPlayerNaturalForPosition(p, position)
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

    if (!isHighValue && !isPlayerFriendly) {
        return {
            attempted: false,
            accepted: false,
            pitch: null,
            evaluation: null,
            reason: 'AI coach prioritizes retaining more valuable contributors.'
        };
    }

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
    const needsRelationshipRepair = loyalty < 45 || happiness < 50;
    const coachTeaching = coach?.ratings?.teaching ?? 50;
    const coachAuthority = coach?.ratings?.authority ?? 50;
    const coachQuality = (coachTeaching + coachAuthority) / 2;

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
 * Opens a coach or staff hiring negotiation.
 * The session is temporary conversation state, not a contract.
 */
export function startStaffNegotiation(
    staff,
    team,
    roleKey = 'coach'
) {
    if (!staff || !team) return null;

    const autonomyPreference =
        getCoachAutonomyPreference(staff);

    const preferredPracticeFocus =
        getPreferredCoachPracticeFocus(staff, roleKey);

    let openingLine;

    if (
        roleKey === 'coach' &&
        autonomyPreference >= 68
    ) {
        openingLine =
            `"I'm interested, but I want to know how much control I'll have over the football side of things."`;
    } else if (
        roleKey === 'coach' &&
        autonomyPreference <= 35
    ) {
        openingLine =
            `"I'm open to joining the program. I want to understand your expectations and how you want the staff to work together."`;
    } else if (roleKey === 'scout') {
        openingLine =
            `"I'd like to hear how you want scouting and player evaluation handled."`;
    } else if (roleKey === 'trainer') {
        openingLine =
            `"Before I commit, I'd like to understand the team's practice and development priorities."`;
    } else {
        openingLine =
            `"I'm interested. Let's talk about the role and what you can offer."`;
    }

    return {
        ...createNegotiationSession(
            'staff',
            staff,
            team,
            { roleKey }
        ),
        openingLine,
        profile: {
            autonomyPreference,
            preferredPracticeFocus
        }
    };
}

/**
 * Opens a player retention negotiation.
 * Context should include the departure reason and completed-season details.
 */
export function startPlayerRetentionNegotiation(
    player,
    team,
    context = {}
) {
    if (!player || !team) return null;

    const options = getRetentionPitchOptions(player);
    const reason = String(context.reason || '');

    let openingLine;

    if (/playing time|role|starter|rotation/i.test(reason)) {
        openingLine =
            `"I don't feel like I got the opportunity I deserved. I need to know my role will be different next season."`;
    } else if (/losing|poor play|winning culture/i.test(reason)) {
        openingLine =
            `"I want to play somewhere that feels like it's going in the right direction. Why should I believe things will improve here?"`;
    } else if (/tier|relegat|promotion/i.test(reason)) {
        openingLine =
            `"I'm not sure I want to spend another season at this level. What makes staying here worth it?"`;
    } else {
        openingLine =
            `"I'm thinking about a fresh start. I want to hear what would actually be different if I stayed."`;
    }

    return {
        ...createNegotiationSession(
            'player_retention',
            player,
            team,
            {
                reason,
                completedWins: context.completedWins,
                completedLosses: context.completedLosses,
                snapsThisSeason: context.snapsThisSeason
            }
        ),
        openingLine,
        profile: {
            position: options.position,
            focusPromise: options.focusPromise?.value || null
        }
    };
}

/**
 * Builds a staff counteroffer based on the candidate's strongest preferences.
 * Only returned terms need to be changed; the UI can preserve the other terms.
 */
export function buildStaffCounteroffer(
    staff,
    team,
    roleKey,
    pitch,
    evaluation
) { 
    const terms = {};
    const priorities = [];
    const messages = [];

    if (roleKey === 'coach') {
        const autonomy = getCoachAutonomyPreference(staff);

        const desiredSchemePromise =
            autonomy >= 68
                ? 'COACH_CHOICE'
                : autonomy >= 38
                    ? 'SHARED_CONTROL'
                    : 'GM_CHOICE';

        const controlRank = {
            GM_CHOICE: 0,
            SHARED_CONTROL: 1,
            COACH_CHOICE: 2
        };

        const currentSchemePromise =
            pitch.schemePromise || 'GM_CHOICE';

        if (
            (controlRank[desiredSchemePromise] ?? 0) >
            (controlRank[currentSchemePromise] ?? 0)
        ) {
            terms.schemePromise = desiredSchemePromise;
            priorities.push('scheme_authority');

            messages.push(
                desiredSchemePromise === 'COACH_CHOICE'
                    ? 'I need greater control over the football philosophy and gameplan.'
                    : "I'd be more comfortable if scheme decisions were shared rather than entirely GM-controlled."
            );
        }
    }

    const preferredPracticeFocus =
        getPreferredCoachPracticeFocus(staff, roleKey);

    if (
        preferredPracticeFocus &&
        (pitch.practiceFocus || 'BALANCED') !== preferredPracticeFocus
    ) {
        terms.practiceFocus = preferredPracticeFocus;
        priorities.push('practice_culture');

        const focusDescriptions = {
            CONDITIONING: 'a more demanding conditioning-focused program',
            CHALK_TALK: 'more time for film study and tactical preparation',
            FUN_SCRIMMAGE: 'a stronger emphasis on chemistry and relaxed team sessions'
        };

        messages.push(
            `I'd also prefer ${focusDescriptions[preferredPracticeFocus] || 'a practice approach that fits my philosophy'}.`
        );
    }

    const requiredStipend = Math.max(
        0,
        Number(evaluation.requiredStipend) || 0
    );

    const currentCashOffered = Math.max(
        0,
        Number(pitch.cashOffered) || 0
    );

    if (currentCashOffered < requiredStipend) {
        terms.cashOffered = requiredStipend;
        priorities.push('upfront_resources');

        messages.push(
            `The equipment and preparation stipend would need to be closer to $${requiredStipend}.`
        );
    }

    const tokensAvailable = Math.max(
        0,
        Math.floor(Number(team.socialProfile?.favorTokens) || 0)
    );

    const currentTokensOffered = Math.max(
        0,
        Math.floor(Number(pitch.tokensOffered) || 0)
    );

    if (
        tokensAvailable > currentTokensOffered &&
        currentTokensOffered === 0 &&
        Number(evaluation.interestScore) <
            Number(evaluation.threshold)
    ) {
        terms.tokensOffered = 1;
        priorities.push('favor_token');

        messages.push(
            `I'd like to see one more meaningful sign of commitment from the program.`
        );
    }

    return {
        terms,
        priorities,
        message: messages.length
            ? messages.join(' ')
            : "We're getting closer, but I'd need you to improve the overall offer before I can commit."
    };
}

/**
 * Builds a player retention counteroffer from the player's role,
 * workload, personality, and relationship concerns.
 */
function buildPlayerRetentionCounteroffer(
    player,
    team,
    pitch,
    session
) {
    const terms = {};
    const priorities = [];

    const options = getRetentionPitchOptions(player);
    const reason = String(session.context?.reason || '').toLowerCase();

    const ego = Number(player.personality?.ego) || 50;
    const loyalty = Number(player.personality?.loyalty) || 50;
    const happiness = Number(player.expectations?.happiness) || 50;

    const currentRole =
        pitch.rolePromised || 'ROTATION';

    const currentPromise =
        pitch.promiseType || 'NONE';

    const currentTokens = Math.max(
        0,
        Math.floor(Number(pitch.tokensOffered) || 0)
    );

    const tokensAvailable = Math.max(
        0,
        Math.floor(Number(team.socialProfile?.favorTokens) || 0)
    );

    const isPlayingTimeConcern =
        reason.includes('playing time') ||
        reason.includes('role') ||
        reason.includes('starter') ||
        reason.includes('rotation');

    // A player with a role concern or strong ego may insist on a starting role.
    if (
        currentRole !== 'STARTER' &&
        (isPlayingTimeConcern || ego >= 62)
    ) {
        terms.rolePromised = 'STARTER';
        priorities.push('starting_role');
    }

    // Skill players may ask for a measurable workload commitment.
    if (
        options.focusPromise &&
        currentPromise !== options.focusPromise.value &&
        (
            ego >= 58 ||
            happiness < 68 ||
            isPlayingTimeConcern
        )
    ) {
        terms.promiseType = options.focusPromise.value;
        priorities.push('workload');
    }

    // A player with damaged trust may want a tangible sign of commitment.
    if (
        currentTokens === 0 &&
        tokensAvailable >= 1 &&
        (loyalty < 48 || happiness < 52)
    ) {
        terms.tokensOffered = 1;
        priorities.push('relationship_repair');
    }

    let message;

    if (priorities.includes('starting_role')) {
        message =
            `"I need a real opportunity to start. A rotation promise isn't enough for me."`;
    } else if (priorities.includes('workload')) {
        message =
            `"I want to know I'll have a meaningful role in the offense next season, not just be told to wait my turn."`;
    } else if (priorities.includes('relationship_repair')) {
        message =
            `"Words are a start, but I need to know the program genuinely values me."`;
    } else if (options.focusPromise) {
        message =
            `"I need a more concrete role and a clearer commitment to how you'll use me."`;
    } else {
        message =
            `"I hear what you're saying, but I need a more meaningful commitment before I agree to stay."`;
    }

    return {
        terms,
        priorities,
        message
    };
}

/**
 * Resolves one round of a shared negotiation.
 *
 * A counteroffer keeps the session open. Acceptance and rejection close it.
 * Three total offer rounds are allowed: the opening offer plus two revisions.
 */
function resolveNegotiationRound(
    session,
    offer,
    evaluation,
    tolerance,
    counteroffer
) {
    const round = Math.max(
        0,
        Number(session.round) || 0
    ) + 1;

    const maxRounds = Math.max(
        1,
        Number(session.maxRounds) || NEGOTIATION_MAX_ROUNDS
    );

    const rawScore =
        evaluation.interestScore ?? evaluation.score ?? 0;

    const score = Number.isFinite(Number(rawScore))
        ? Number(rawScore)
        : 0;

    const rawThreshold = Number(evaluation.threshold);

    const threshold = Number.isFinite(rawThreshold)
        ? rawThreshold
        : 52;

    const hardStop =
        threshold >= 100 ||
        evaluation.accepted === true && evaluation.accepted !== false;

    let outcome;

    if (evaluation.accepted) {
        outcome = 'accepted';
    } else if (
        !hardStop &&
        round < maxRounds &&
        score >= threshold - tolerance
    ) {
        outcome = 'countered';
    } else {
        outcome = 'rejected';
    }

    const historyEntry = {
        round,
        offer: copyNegotiationTerms(offer),
        score,
        threshold,
        outcome,
        quote: String(evaluation.quote || '')
    };

    const nextSession = {
        ...session,
        round,
        status: outcome === 'countered' ? 'open' : outcome,
        lastOutcome: outcome,
        history: [
            ...(Array.isArray(session.history) ? session.history : []),
            historyEntry
        ]
    };

    return {
        outcome,
        accepted: outcome === 'accepted',
        countered: outcome === 'countered',
        rejected: outcome === 'rejected',
        round,
        maxRounds,
        quote: outcome === 'countered'
            ? counteroffer.message
            : evaluation.quote,
        counteroffer: outcome === 'countered'
            ? counteroffer
            : null,
        evaluation,
        session: nextSession
    };
}

/**
 * Evaluates one coach/staff negotiation round.
 */
export function evaluateStaffNegotiationRound(
    session,
    staff,
    team,
    roleKey,
    pitch = {}
) {
    const resolvedRoleKey =
        roleKey || session?.roleKey || 'coach';

    if (
        !session ||
        session.type !== 'staff' ||
        session.status !== 'open' ||
        !staff ||
        !team ||
        String(staff.id) !== String(session.participantId) ||
        String(team.id) !== String(session.teamId)
    ) {
        return {
            outcome: 'invalid',
            accepted: false,
            countered: false,
            rejected: true,
            quote: 'This negotiation is no longer active.'
        };
    }

    const evaluation = evaluateStaffNegotiation(
        staff,
        team,
        resolvedRoleKey,
        pitch
    );

    const autonomy = getCoachAutonomyPreference(staff);
    const stubbornnessValue = Number(staff.stubbornness);

    const stubbornness = Number.isFinite(stubbornnessValue)
        ? Math.max(0, Math.min(1, stubbornnessValue))
        : 0.75;

    const weeksUnemployed = Math.max(
        0,
        Number(staff.weeksUnemployed) || 0
    );

    const tolerance = clampNegotiationValue(
        12 +
        (1 - stubbornness) * 16 +
        Math.min(6, weeksUnemployed),
        8,
        30
    );

    const counteroffer = buildStaffCounteroffer(
        staff,
        team,
        resolvedRoleKey,
        pitch,
        evaluation
    );

    const result = resolveNegotiationRound(
        session,
        pitch,
        evaluation,
        tolerance,
        counteroffer
    );

    result.autonomyPreference = autonomy;

    return result;
}

/**
 * Evaluates one player exit-interview negotiation round.
 */
export function evaluatePlayerRetentionNegotiationRound(
    session,
    player,
    team,
    pitch = {}
) {
    if (
        !session ||
        session.type !== 'player_retention' ||
        session.status !== 'open' ||
        !player ||
        !team ||
        String(player.id) !== String(session.participantId) ||
        String(team.id) !== String(session.teamId)
    ) {
        return {
            outcome: 'invalid',
            accepted: false,
            countered: false,
            rejected: true,
            quote: 'This exit interview is no longer active.'
        };
    }

    const evaluation = evaluateRetentionPitch(
        player,
        team,
        pitch
    );

    const ego = Number(player.personality?.ego) || 50;
    const loyalty = Number(player.personality?.loyalty) || 50;
    const happiness = Number(player.expectations?.happiness) || 50;

    const tolerance = clampNegotiationValue(
        16 +
        (loyalty - 50) * 0.14 +
        (happiness - 50) * 0.10 -
        (ego - 50) * 0.12,
        8,
        28
    );

    const counteroffer = buildPlayerRetentionCounteroffer(
        player,
        team,
        pitch,
        session
    );

    return resolveNegotiationRound(
        session,
        pitch,
        evaluation,
        tolerance,
        counteroffer
    );
}

/**
 * Resolves an AI team's player-retention negotiation automatically.
 *
 * The AI makes its normal opening offer, then responds to up to two
 * player counteroffers through the shared negotiation engine.
 */
export function resolveAiPlayerRetentionNegotiation(
    player,
    team,
    context = {}
) {
    const opening = evaluateAiRetentionPitch(
        player,
        team,
        context
    );

    if (!opening?.attempted || !opening.pitch) {
        return opening;
    }

    // Preserve the existing one-off behavior if the shared
    // negotiation engine is unavailable.
    if (
        typeof startPlayerRetentionNegotiation !== 'function' ||
        typeof evaluatePlayerRetentionNegotiationRound !== 'function'
    ) {
        return opening;
    }

    let session = startPlayerRetentionNegotiation(
        player,
        team,
        context
    );

    if (!session) {
        return opening;
    }

    const openingPitch = { ...opening.pitch };
    let currentPitch = { ...openingPitch };
    let lastEvaluation = opening.evaluation || null;

    const options = getRetentionPitchOptions(player);
    const position = options?.position;

    const availableTokens = Math.max(
        0,
        Math.floor(Number(team.socialProfile?.favorTokens) || 0)
    );

    const originalTokens = Math.max(
        0,
        Math.floor(Number(openingPitch.tokensOffered) || 0)
    );

    const canPromiseStarter =
        openingPitch.rolePromised === 'STARTER' ||
        isPlayerStarterAtPosition(player, team, position);

    // Three total offers: the opening offer and up to two revisions.
    for (let roundIndex = 0; roundIndex < 3; roundIndex++) {
        const roundResult = evaluatePlayerRetentionNegotiationRound(
            session,
            player,
            team,
            currentPitch
        );

        if (!roundResult) {
            break;
        }

        session = roundResult.session || session;
        lastEvaluation = roundResult.evaluation || roundResult;

        if (
            roundResult.accepted ||
            lastEvaluation.accepted
        ) {
            return {
                attempted: true,
                accepted: true,
                pitch: { ...currentPitch },
                evaluation: lastEvaluation,
                negotiationRounds: roundIndex + 1,
                reason: 'AI retention negotiation accepted.'
            };
        }

        // No counteroffer, or the final offer was rejected.
        if (
            !roundResult.countered ||
            roundIndex >= 2
        ) {
            break;
        }

        const requested = roundResult.counterTerms || {};

        const requestedRole =
            requested.rolePromised || currentPitch.rolePromised;

        const requestedPromise =
            requested.promiseType || currentPitch.promiseType || 'NONE';

        const requestedTokens = Math.max(
            0,
            Math.floor(Number(requested.tokensOffered) || 0)
        );

        // The AI will not promise a starting role unless it can
        // credibly offer one based on its roster and depth chart.
        const nextRole =
            requestedRole === 'STARTER' && canPromiseStarter
                ? 'STARTER'
                : currentPitch.rolePromised;

        // Workload promises must match a legitimate position-specific
        // promise option. The AI cannot invent a playing-time guarantee.
        const canOfferPromise =
            requestedPromise === 'NONE' ||
            requestedPromise === currentPitch.promiseType ||
            requestedPromise === options?.focusPromise?.value;

        const nextPromiseType = canOfferPromise
            ? requestedPromise
            : currentPitch.promiseType || 'NONE';

        // The AI may increase its token offer gradually, but never
        // beyond two tokens or the team's actual available balance.
        const maximumTokensThisRound = Math.min(
            2,
            availableTokens,
            originalTokens + roundIndex + 1
        );

        const nextTokens = Math.max(
            Number(currentPitch.tokensOffered) || 0,
            Math.min(maximumTokensThisRound, requestedTokens)
        );

        const nextPitch = {
            ...currentPitch,
            rolePromised: nextRole,
            promiseType: nextPromiseType,
            tokensOffered: nextTokens
        };

        const termsChanged =
            nextPitch.rolePromised !== currentPitch.rolePromised ||
            nextPitch.promiseType !== currentPitch.promiseType ||
            nextPitch.tokensOffered !== currentPitch.tokensOffered;

        // Do not waste another round repeating an offer the AI
        // is unwilling or unable to improve.
        if (!termsChanged) {
            break;
        }

        currentPitch = nextPitch;
    }

    return {
        attempted: true,
        accepted: false,
        pitch: null,
        evaluation: lastEvaluation,
        reason: 'AI team and player could not reach an agreement.'
    };
}

/**
 * Evaluates a player position conversion pitch.
 */
export function discussPositionChange(player, targetPos, team, useToken = false) {
    if (!player || !team || player.id == null || !targetPos) {
        return {
            success: false,
            message: "Invalid discussion. Player or team is unavailable."
        };
    }

    const playerIsOnRoster = getRosterObjects(team).some(
        rosterPlayer =>
            rosterPlayer?.id != null &&
            String(rosterPlayer.id) === String(player.id)
    );

    if (!playerIsOnRoster) {
        return {
            success: false,
            message: "This player is not on your team's roster."
        };
    }

    const validPositions = [
        'QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'
    ];

    targetPos = String(targetPos).trim().toUpperCase();

    if (!validPositions.includes(targetPos)) {
        return {
            success: false,
            message: `Invalid target position: ${targetPos}.`
        };
    }

    const currentPos = String(
        player.pos || estimateBestPosition(player) || ''
    ).trim().toUpperCase();

    const rawTokenBalance = Number(
        team?.socialProfile?.favorTokens
    );

    const availableTokens = Number.isFinite(rawTokenBalance)
        ? Math.max(0, Math.floor(rawTokenBalance))
        : 0;

    if (useToken && availableTokens < 1) {
        return {
            success: false,
            message: 'You do not have a Favor Token available.'
        };
    }

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

    // FIX: Check if the player already has targetPos in their natural profile (e.g. secondary side)
    const isNatural = isPlayerNaturalForPosition(player, targetPos);

    let transitionDifficulty = 'LOW';
    if (isNatural) {
        transitionDifficulty = 'NATURAL';
        interest += 25;
        reasons.push("Natural two-way position transition (+25)");
    } else if (currentCluster === targetCluster) {
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

    // 4. Token Persuasion
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

        const currentYear = Number(game?.year);

        if (Number.isFinite(currentYear)) {
            player.positionChangedYear = currentYear;
        }

        if (player.scouting) {
            player.scouting.bestPosition = targetPos;
        }

        if (isOffensive) {
                player.favoriteOffensivePosition = targetPos;
                if (['OL', 'TE'].includes(targetPos) && ['DB'].includes(player.favoriteDefensivePosition)) {
                    player.favoriteDefensivePosition = 'DL';
                }
            } else {
                player.favoriteDefensivePosition = targetPos;
                if (['DL'].includes(targetPos) && ['WR', 'QB'].includes(player.favoriteOffensivePosition)) {
                    player.favoriteOffensivePosition = 'OL';
                }
            }

            populateNaturalDepthOrder(team);
        rebuildDepthChartFromOrder(team);

        if (useToken) {
            team.socialProfile.favorTokens = availableTokens - 1;
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