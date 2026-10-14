// js/game/debug_collector.js
import { isDebugMode } from './debug_mode.js';
import { calculateOverall, estimateBestPosition } from './player.js';

class DebugCollector {
    constructor() {
        this.reset();
    }

    reset() {
        this.report1_initialLeague = null;
        this.report2_history = [];
        this.report3_draft = null;
        this.draftInitialProspectIds = [];
        this.report4_offseason = null;
        this.events = [];
        this.sequence = 1;
    }

    recordEvent(phase, eventType, details = {}, teamId = null, playerId = null) {
        if (!isDebugMode()) return;
        this.events.push({
            seq: this.sequence++,
            timestamp: new Date().toISOString(),
            phase,
            eventType,
            teamId,
            playerId,
            details
        });
    }

    // =========================================================================
    // REPORT 1: Generated League Baseline & Balance
    // =========================================================================
    captureInitialLeague(gameState) {
        if (!isDebugMode() || !gameState) return;

        const players = gameState.players || [];
        const teams = gameState.teams || [];

        // 1. Calculate Positional & OVR Balance Curves
        const positions = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'];
        const positionBalance = {};

        positions.forEach(pos => {
            const posPlayers = players.filter(p => (p.pos || estimateBestPosition(p)) === pos);
            const ovrs = posPlayers.map(p => calculateOverall(p, pos));
            ovrs.sort((a, b) => a - b);

            positionBalance[pos] = {
                count: posPlayers.length,
                minOVR: ovrs[0] || 0,
                medianOVR: ovrs[Math.floor(ovrs.length / 2)] || 0,
                avgOVR: ovrs.length ? +(ovrs.reduce((a, b) => a + b, 0) / ovrs.length).toFixed(1) : 0,
                maxOVR: ovrs[ovrs.length - 1] || 0
            };
        });

        // 2. Potential & Archetype Distributions
        const potentialCounts = { A: 0, B: 0, C: 0, D: 0, F: 0 };
        const archetypeCounts = {};
        players.forEach(p => {
            const pot = p.potential || 'C';
            potentialCounts[pot] = (potentialCounts[pot] || 0) + 1;
            const arch = p.archetypeName || 'Athlete';
            archetypeCounts[arch] = (archetypeCounts[arch] || 0) + 1;
        });

        // 3. Team Parity Balance
        const teamOVRs = teams.map(t => {
            const roster = players.filter(p => (t.roster || []).includes(p.id));
            const avgOvr = roster.length
                ? +(roster.reduce((sum, p) => sum + calculateOverall(p, p.pos || estimateBestPosition(p)), 0) / roster.length).toFixed(1)
                : 0;
            return { id: t.id, name: t.name, tier: t.tier, rosterSize: roster.length, avgOVR: avgOvr };
        }).sort((a, b) => b.avgOVR - a.avgOVR);

        this.report1_initialLeague = {
            generatedAt: new Date().toISOString(),
            balanceDiagnostics: {
                totalPlayers: players.length,
                totalTeams: teams.length,
                paritySpread: {
                    highestTeamOVR: teamOVRs[0]?.avgOVR || 0,
                    lowestTeamOVR: teamOVRs[teamOVRs.length - 1]?.avgOVR || 0,
                    ovrDelta: teamOVRs.length ? +(teamOVRs[0].avgOVR - teamOVRs[teamOVRs.length - 1].avgOVR).toFixed(1) : 0
                },
                potentialDistribution: potentialCounts,
                positionalOVRCurves: positionBalance,
                archetypeDistribution: archetypeCounts,
                teamRankings: teamOVRs
            },
            teams: teams.map(t => ({
                id: t.id,
                name: t.name,
                tier: t.tier,
                coach: t.coach ? { name: t.coach.name, type: t.coach.type } : null,
                formations: t.formations,
                roster: [...(t.roster || [])]
            })),
            players: players.map(p => ({
                id: p.id,
                name: p.name,
                age: p.age,
                pos: p.pos || estimateBestPosition(p),
                potential: p.potential,
                ovr: calculateOverall(p, p.pos || estimateBestPosition(p)),
                teamId: p.teamId,
                personality: { ethic: p.personality?.workEthic, ego: p.personality?.ego }
            }))
        };
    }

    // =========================================================================
    // REPORT 2: Four Historical Seasons (Simulation Balance Audit)
    // =========================================================================
    recordHistoricalSeason(year, data) {
        if (!isDebugMode()) return;

        const devResults = data.offseasonReport?.developmentResults || [];

        // Development balance: Total gains vs regressions across age groups
        const ageDevAudit = {};
        devResults.forEach(r => {
            const age = r.player?.age || 'unknown';
            if (!ageDevAudit[age]) ageDevAudit[age] = { count: 0, netPoints: 0 };
            const changes = r.actualAttributeChanges || r.improvements || [];
            const totalGain = changes.reduce(
                (sum, change) => sum + (change.increase || 0),
                0
            );
            ageDevAudit[age].count++;
            ageDevAudit[age].netPoints += totalGain;
        });

        Object.keys(ageDevAudit).forEach(age => {
            const entry = ageDevAudit[age];
            entry.avgGainPerPlayer = entry.count ? +(entry.netPoints / entry.count).toFixed(2) : 0;
        });

        const seasonBalance = {
            year,
            standingsSummary: {
                champion: data.historyEntry?.champion || null,
                runnerUp: data.historyEntry?.runnerUp || null,
                tier2Champ: data.historyEntry?.tier2Champion || null,
                promoted: data.historyEntry?.promoted || [],
                relegated: data.historyEntry?.relegated || []
            },
            simulationBalance: {
                leagueLeaders: data.historyEntry?.leaders || {},
                developmentCurveByAge: ageDevAudit,
                retirementsCount: (data.offseasonReport?.retiredPlayers || []).length,
                departuresCount: (data.offseasonReport?.leavingPlayers || []).length
            },
            draftPicksCount: (data.draftResults || []).length
        };

        this.report2_history.push(seasonBalance);
    }

    // =========================================================================
    // REPORT 3: First Player Draft (AI Decisions & Rationale Audit)
    // =========================================================================
    initDraftReport(gameState) {
        if (!isDebugMode() || !gameState) return;

        this.draftInitialProspectIds = (gameState.draftClass || [])
            .filter(p => p && !p.teamId)
            .map(p => p.id);

        this.report3_draft = {
            startedAt: new Date().toISOString(),
            draftYear: gameState.year,
            totalPicksScheduled: gameState.draftOrder?.length || 0,
            initialPoolSize: this.draftInitialProspectIds.length,
            aiDecisionLog: [],
            skippedPicks: []
        };
    }

    recordDraftDecision(decision) {
        if (!isDebugMode() || !this.report3_draft) return;

        this.report3_draft.aiDecisionLog.push({
            pick: decision.pick,
            team: decision.teamName,
            isUser: Boolean(decision.isUser),
            selectedPlayer: {
                id: decision.player.id,
                name: decision.player.name,
                pos: decision.pos,
                ovr: decision.ovr,
                potential: decision.player.potential
            },
            aiRationale: {
                teamPrimaryNeed: decision.teamNeed || 'BPA',
                currentRosterDepthAtPos: decision.currentDepthAtPos ?? null,
                topAlternativesIgnored: decision.alternatives || [],
                selectionReasoning: decision.reasoning || (decision.isUser ? 'User Manual Selection' : 'Best Available Value')
            }
        });
    }

    recordDraftSkip({
        pick,
        teamName,
        reason,
        rosterSize = null,
        rosterLimit = null
    }) {
        if (!isDebugMode() || !this.report3_draft) return;

        this.report3_draft.skippedPicks.push({
            pick,
            team: teamName || 'Unknown team',
            reason,
            rosterSize,
            rosterLimit
        });
    }

    finalizeDraftReport(gameState) {
        if (!isDebugMode() || !this.report3_draft) return;

        const playersById = new Map(
            (gameState.players || []).map(p => [p.id, p])
        );

        const undraftedPlayers = this.draftInitialProspectIds
            .map(id => playersById.get(id))
            .filter(p => p && !p.teamId);

        const recordedPicks = new Set(
            this.report3_draft.aiDecisionLog.map(entry => entry.pick)
        );

        const skippedPicks = new Set(
            this.report3_draft.skippedPicks.map(entry => entry.pick)
        );

        const accountedPicks = new Set([
            ...recordedPicks,
            ...skippedPicks
        ]);

        this.report3_draft.completedAt = new Date().toISOString();
        this.report3_draft.selectionsRecorded =
            this.report3_draft.aiDecisionLog.length;
        this.report3_draft.skippedPickCount =
            this.report3_draft.skippedPicks.length;

        this.report3_draft.unaccountedPickNumbers = Array.from(
            { length: this.report3_draft.totalPicksScheduled },
            (_, index) => index + 1
        ).filter(pick => !accountedPicks.has(pick));

        this.report3_draft.undraftedCount = undraftedPlayers.length;
        this.report3_draft.undraftedPlayers = undraftedPlayers.map(p => ({
            id: p.id,
            name: p.name,
            pos: p.pos || estimateBestPosition(p),
            age: p.age,
            potential: p.potential
        }));
    }

    // =========================================================================
    // REPORT 4: Offseason FA Mini-Game (AI Market Competition & Balance)
    // =========================================================================
    initOffseasonReport(gameState) {
        if (!isDebugMode() || !gameState) return;

        this.report4_offseason = {
            startedAt: new Date().toISOString(),
            userTokens: gameState.playerTeam?.socialProfile?.favorTokens || 0,
            marketCompetition: {
                day1Activity: null,
                day2Activity: null,
                day3Activity: null
            },
            finalRosterHealth: []
        };
    }

    recordOffseasonDay(dayNum, result) {
        if (!isDebugMode() || !this.report4_offseason) return;

        const userResults = result.userBidResults || [];
        const activeNegotiations = result.activeNegotiations || [];
        const rejectedBids = result.rejectedBids || [];

        this.report4_offseason.marketCompetition[`day${dayNum}Activity`] = {
            totalSignings: (result.daySignings || []).length,

            userBidsWon: userResults.filter(r => r.won).length,
            userBidsLost: userResults.filter(
                r => !r.won && !r.inProgress && !r.outbid
            ).length,
            userBidsStillActive: userResults.filter(
                r => r.inProgress || r.outbid
            ).length,

            rejectedOfferCount: rejectedBids.length,
            rejectedOffers: rejectedBids.map(r => ({
                player: r.player?.name || 'Unknown player',
                reason: r.reason || 'No rejection reason supplied'
            })),

            activeNegotiations: activeNegotiations.map(n => ({
                player: n.player?.name || 'Unknown player',
                leader: n.leaderTeam?.name || 'Unknown team',
                bidsCount: n.bidsCount || 0,
                isUserLeading: Boolean(n.isUserLeading)
            })),

            userBidResults: userResults.map(r => ({
                player: r.player?.name || 'Unknown player',
                status: r.won
                    ? 'won'
                    : r.rejected
                        ? 'rejected'
                        : r.inProgress
                            ? 'in_progress'
                            : r.outbid
                                ? 'outbid'
                                : 'lost_or_unknown',
                winnerTeam: r.winnerTeam || null,
                message: r.message || ''
            })),

            signingsBreakdown: (result.daySignings || []).map(s => ({
                player: s.player.name,
                pos: s.player.pos || estimateBestPosition(s.player),
                signedWith: s.team.name,
                tokensSpent: s.tokens || 0,
                beatenCompetitor: s.runnerUp?.name || 'Uncontested'
            }))
        };
    }

    finalizeOffseasonReport(gameState) {
        if (!isDebugMode() || !this.report4_offseason) return;

        this.report4_offseason.finalRosterHealth = (gameState.teams || []).map(t => ({
            team: t.name,
            tier: t.tier,
            finalRosterSize: t.roster?.length || 0,
            hasMinimumRosterSize: (t.roster?.length || 0) >= 14
        }));
    }

    // =========================================================================
    // Modal Text Viewer Exporter
    // =========================================================================
    getReport(reportNum) {
        switch (reportNum) {
            case 1: return this.report1_initialLeague;
            case 2: return this.report2_history.length > 0 ? this.report2_history : null;
            case 3: return this.report3_draft;
            case 4: return this.report4_offseason;
            case 'all': return {
                report1_initialLeague: this.report1_initialLeague,
                report2_historicalSeasons: this.report2_history,
                report3_draftDecisions: this.report3_draft,
                report4_offseasonMarket: this.report4_offseason
            };
            default: return null;
        }
    }

    getReportText(reportNum) {
        const data = this.getReport(reportNum);
        if (!data) {
            return `// Diagnostic Report ${reportNum} is not ready yet.\n// Ensure 'Debug Mode' was checked on the Start Screen before starting a new game.`;
        }
        return JSON.stringify(data, null, 2);
    }
}

export const debugCollector = new DebugCollector();
