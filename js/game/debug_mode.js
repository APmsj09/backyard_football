// js/game/debug_collector.js
import { isDebugMode } from './debug_mode.js';

class DebugCollector {
    constructor() {
        this.reset();
    }

    reset() {
        this.report1_initialLeague = null;
        this.report2_history = [];
        this.report3_draft = null;
        this.report4_offseason = null;
        this.events = [];
        this.sequence = 1;
    }

    recordEvent(phase, eventType, details = {}, teamId = null, playerId = null) {
        if (!isDebugMode()) return;
        const entry = {
            seq: this.sequence++,
            timestamp: new Date().toISOString(),
            phase,
            eventType,
            teamId,
            playerId,
            details
        };
        this.events.push(entry);
    }

    // Report 1: Baseline of every generated team and player
    captureInitialLeague(gameState) {
        if (!isDebugMode() || !gameState) return;

        this.report1_initialLeague = {
            generatedAt: new Date().toISOString(),
            totalTeams: gameState.teams?.length || 0,
            totalPlayers: gameState.players?.length || 0,
            teams: (gameState.teams || []).map(t => ({
                id: t.id,
                name: t.name,
                tier: t.tier,
                leagueType: t.leagueType,
                colors: { primary: t.primaryColor, secondary: t.secondaryColor },
                formations: t.formations,
                coach: t.coach,
                staff: t.staff,
                socialProfile: t.socialProfile,
                finances: t.finances,
                rosterPlayerIds: [...(t.roster || [])],
                depthChart: JSON.parse(JSON.stringify(t.depthChart || {}))
            })),
            players: (gameState.players || []).map(p => ({
                id: p.id,
                name: p.name,
                age: p.age,
                pos: p.pos,
                potential: p.potential,
                archetype: p.archetypeName,
                attributes: JSON.parse(JSON.stringify(p.attributes || {})),
                personality: JSON.parse(JSON.stringify(p.personality || {})),
                social: JSON.parse(JSON.stringify(p.social || {})),
                teamId: p.teamId,
                lifecycle: p.lifecycle,
                status: p.status
            }))
        };

        this.recordEvent('LEAGUE_GEN', 'INITIAL_LEAGUE_CAPTURED', {
            teamCount: this.report1_initialLeague.totalTeams,
            playerCount: this.report1_initialLeague.totalPlayers
        });
    }

    // Report 2: Chronological audit of the 4 historical seasons
    recordHistoricalSeason(year, data) {
        if (!isDebugMode()) return;

        const seasonEntry = {
            year,
            timestamp: new Date().toISOString(),
            champion: data.historyEntry?.champion || null,
            runnerUp: data.historyEntry?.runnerUp || null,
            tier2Champion: data.historyEntry?.tier2Champion || null,
            youthChampion: data.historyEntry?.youthChampion || null,
            promoted: data.historyEntry?.promoted || [],
            relegated: data.historyEntry?.relegated || [],
            leaders: data.historyEntry?.leaders || {},
            standings: data.standings || [],
            offseasonDevelopment: data.offseasonReport?.developmentResults || [],
            retirements: data.offseasonReport?.retiredPlayers || [],
            departures: data.offseasonReport?.leavingPlayers || [],
            hallOfFame: data.offseasonReport?.hofInductees || [],
            draftPicks: data.draftResults || []
        };

        this.report2_history.push(seasonEntry);
        this.recordEvent('HISTORY_SIM', `SEASON_${year}_RECORDED`, {
            champion: seasonEntry.champion,
            promoted: seasonEntry.promoted,
            relegated: seasonEntry.relegated,
            retirementsCount: seasonEntry.retirements.length
        });
    }

    // Report 3: First Player Draft (Year 5)
    initDraftReport(gameState) {
        if (!isDebugMode() || !gameState) return;

        this.report3_draft = {
            startedAt: new Date().toISOString(),
            draftYear: gameState.year,
            draftOrder: (gameState.draftOrder || []).map((t, idx) => ({
                pick: idx + 1,
                teamId: t.id,
                teamName: t.name
            })),
            initialProspectPool: (gameState.draftClass || []).map(p => ({
                id: p.id,
                name: p.name,
                age: p.age,
                pos: p.pos,
                potential: p.potential,
                attributes: p.attributes
            })),
            picks: []
        };
    }

    recordDraftPick(pickInfo) {
        if (!isDebugMode() || !this.report3_draft) return;
        this.report3_draft.picks.push({
            ...pickInfo,
            timestamp: new Date().toISOString()
        });
        this.recordEvent('DRAFT', 'PICK_EXECUTED', pickInfo, pickInfo.teamId, pickInfo.playerId);
    }

    finalizeDraftReport(gameState) {
        if (!isDebugMode() || !this.report3_draft) return;
        this.report3_draft.completedAt = new Date().toISOString();
        this.report3_draft.undraftedRemaining = (gameState.players || [])
            .filter(p => !p.teamId && p.age <= 13)
            .map(p => ({ id: p.id, name: p.name, pos: p.pos }));
    }

    // Report 4: First Post-Draft Offseason Free Agency Mini-Game
    initOffseasonReport(gameState) {
        if (!isDebugMode() || !gameState) return;

        this.report4_offseason = {
            startedAt: new Date().toISOString(),
            year: gameState.year,
            userTeamId: gameState.playerTeam?.id,
            userInitialTokens: gameState.playerTeam?.socialProfile?.favorTokens || 0,
            dailyActivity: []
        };
    }

    recordOffseasonDay(dayNum, result) {
        if (!isDebugMode() || !this.report4_offseason) return;
        this.report4_offseason.dailyActivity.push({
            day: dayNum,
            timestamp: new Date().toISOString(),
            userBidResults: result.userBidResults || [],
            daySignings: result.daySignings || [],
            rejectedBids: result.rejectedBids || []
        });
        this.recordEvent('OFFSEASON_FA', `DAY_${dayNum}_PROCESSED`, result);
    }

    finalizeOffseasonReport(gameState) {
        if (!isDebugMode() || !this.report4_offseason) return;
        this.report4_offseason.completedAt = new Date().toISOString();
        this.report4_offseason.finalRosterCount = gameState.playerTeam?.roster?.length || 0;
        this.report4_offseason.finalFavorTokens = gameState.playerTeam?.socialProfile?.favorTokens || 0;
    }

    // File Exporters
    downloadReport(reportNum) {
        let filename = '';
        let payload = null;

        switch (reportNum) {
            case 1:
                filename = `report1_initial_league_${Date.now()}.json`;
                payload = this.report1_initialLeague || { error: "Report 1 not captured yet. Start a new game with Debug Mode checked." };
                break;
            case 2:
                filename = `report2_historical_seasons_${Date.now()}.json`;
                payload = this.report2_history.length > 0 ? this.report2_history : { error: "Report 2 empty. Seasons 1-4 must run with Debug Mode checked." };
                break;
            case 3:
                filename = `report3_first_draft_${Date.now()}.json`;
                payload = this.report3_draft || { error: "Report 3 not captured yet. Run the draft with Debug Mode enabled." };
                break;
            case 4:
                filename = `report4_offseason_fa_${Date.now()}.json`;
                payload = this.report4_offseason || { error: "Report 4 not captured yet. Complete the post-draft FA mini-game with Debug Mode enabled." };
                break;
            default:
                filename = `all_debug_events_${Date.now()}.json`;
                payload = {
                    report1: this.report1_initialLeague,
                    report2: this.report2_history,
                    report3: this.report3_draft,
                    report4: this.report4_offseason,
                    eventLog: this.events
                };
        }

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

export const debugCollector = new DebugCollector();
