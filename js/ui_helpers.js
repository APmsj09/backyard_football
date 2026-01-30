import { calculateOverall } from './game.js';
import { positionOverallWeights } from './game/player.js';

/**
 * Computes starter assignments for a given roster.
 * Returns an object mapping position -> { player, ovr } or null if no assignment.
 */
export function computeStarterAssignments(roster) {
    if (!Array.isArray(roster)) return {};

    // Filter out temporary/injured players as the UI expects
    let availablePlayers = roster.filter(p => p && p.attributes && p.status?.type !== 'temporary' && p.status?.duration === 0);

    const playersByBestPos = {};
    availablePlayers.forEach(p => {
        let bestPos = null;
        let bestOvr = -Infinity;
        Object.keys(positionOverallWeights).forEach(candidatePos => {
            const ovr = calculateOverall(p, candidatePos);
            if (ovr > bestOvr) {
                bestOvr = ovr;
                bestPos = candidatePos;
            }
        });
        if (!playersByBestPos[bestPos]) playersByBestPos[bestPos] = [];
        playersByBestPos[bestPos].push({ player: p, ovr: bestOvr });
    });

    Object.keys(playersByBestPos).forEach(k => playersByBestPos[k].sort((a, b) => b.ovr - a.ovr));

    const assignments = {};

    // Phase 1: Assign players to their preferred positions if available.
    Object.keys(positionOverallWeights).forEach(pos => {
        if (playersByBestPos[pos] && playersByBestPos[pos].length > 0) {
            const entry = playersByBestPos[pos].shift();
            const chosen = entry.player;
            const chosenOvr = entry.ovr;
            assignments[pos] = { player: chosen, ovr: chosenOvr };

            // Remove chosen from available pool and any buckets
            availablePlayers = availablePlayers.filter(p => p.id !== chosen.id);
            Object.keys(playersByBestPos).forEach(k => {
                playersByBestPos[k] = playersByBestPos[k].filter(e => e.player.id !== chosen.id);
            });
        } else {
            assignments[pos] = null; // fill in later if possible
        }
    });

    // Phase 2: Fill remaining positions from best of remaining players
    Object.keys(positionOverallWeights).forEach(pos => {
        if (assignments[pos] !== null) return; // already filled
        if (availablePlayers.length === 0) { assignments[pos] = null; return; }

        let chosen = null;
        let chosenOvr = -1;
        for (const player of availablePlayers) {
            const ovr = calculateOverall(player, pos);
            if (ovr > chosenOvr) {
                chosenOvr = ovr;
                chosen = player;
            }
        }
        if (chosen) {
            assignments[pos] = { player: chosen, ovr: chosenOvr };
            availablePlayers = availablePlayers.filter(p => p.id !== chosen.id);
            Object.keys(playersByBestPos).forEach(k => {
                playersByBestPos[k] = playersByBestPos[k].filter(e => e.player.id !== chosen.id);
            });
        } else {
            assignments[pos] = null;
        }
    });

    return assignments;
}
