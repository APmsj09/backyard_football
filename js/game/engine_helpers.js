//engine_helper.js

import { getPlayer } from './state.js';
import { calculateSlotSuitability } from './player.js';
import { getPriority } from './depth_chart.js';
import { offenseFormations, defenseFormations, routeTree } from '../data.js';

const FIELD_WIDTH = 53.3;
const FIELD_LENGTH = 120;
const CENTER_X = FIELD_WIDTH / 2;
const HASH_LEFT_X = 18.0;
const HASH_RIGHT_X = 35.3;
const TICK_DURATION_SECONDS = 0.05;

export const zoneBoundaries = {
    'zone_flat_left': { minX: 0, maxX: HASH_LEFT_X, minY: -2, maxY: 8 },
    'zone_flat_right': { minX: HASH_RIGHT_X, maxX: FIELD_WIDTH, minY: -2, maxY: 8 },
    'zone_hook_curl_left': { minX: HASH_LEFT_X, maxX: CENTER_X, minY: 7, maxY: 15 },
    'zone_hook_curl_middle': { minX: HASH_LEFT_X, maxX: HASH_RIGHT_X, minY: 8, maxY: 16 },
    'zone_hook_curl_right': { minX: CENTER_X, maxX: HASH_RIGHT_X, minY: 7, maxY: 15 },
    'zone_short_middle': { minX: CENTER_X - 6, maxX: CENTER_X + 6, minY: 4, maxY: 10 },
    'zone_deep_half_left': { minX: 0, maxX: CENTER_X, minY: 12, maxY: 40 },
    'zone_deep_half_right': { minX: CENTER_X, maxX: FIELD_WIDTH, minY: 12, maxY: 40 },
    'zone_deep_middle': { minX: HASH_LEFT_X - 2, maxX: HASH_RIGHT_X + 2, minY: 12, maxY: 40 },
    'zone_deep_third_left': { minX: 0, maxX: HASH_LEFT_X, minY: 12, maxY: 40 },
    'zone_deep_third_right': { minX: HASH_RIGHT_X, maxX: FIELD_WIDTH, minY: 12, maxY: 40 },
    'run_gap_A': { xOffset: 0, yOffset: 0.5 },
    'run_gap_A_left': { xOffset: -2, yOffset: 0.5 },
    'run_gap_A_right': { xOffset: 2, yOffset: 0.5 },
    'run_gap_B_left': { xOffset: -5, yOffset: 0.5 },
    'run_gap_B_right': { xOffset: 5, yOffset: 0.5 },
    'run_edge_left': { xOffset: -10, yOffset: 1.0 },
    'run_edge_right': { xOffset: 10, yOffset: 1.0 },
    'blitz_gap': { xOffset: 0, yOffset: 1.0 },
    'blitz_edge': { xOffset: 9, yOffset: 0.5 }
};

export function getZoneCenter(zoneAssignment, lineOfScrimmage) {
    const zone = zoneBoundaries[zoneAssignment];
    const BACK_WALL_Y = FIELD_LENGTH - 0.5;

    if (!zone || zone.xOffset !== undefined || zone.minY === undefined) {
        return { x: CENTER_X, y: Math.min(BACK_WALL_Y, lineOfScrimmage + 7) };
    }

    const idealMinY_abs = lineOfScrimmage + (zone.minY || 0);
    const idealMaxY_abs = lineOfScrimmage + (zone.maxY || 20);
    const finalMaxY_abs = Math.min(idealMaxY_abs, BACK_WALL_Y);
    const finalMinY_abs = Math.min(idealMinY_abs, finalMaxY_abs - 1.0);
    const finalCenterY = (finalMinY_abs + finalMaxY_abs) / 2;
    const centerX = zone.minX !== undefined && zone.maxX !== undefined
        ? (zone.minX + zone.maxX) / 2
        : CENTER_X;

    return { x: centerX, y: finalCenterY };
}

export function isPlayerInZone(playerState, zoneAssignment, lineOfScrimmage) {
    const zone = zoneBoundaries[zoneAssignment];
    const BACK_WALL_Y = FIELD_LENGTH - 0.5;

    if (!playerState || playerState.x === undefined || playerState.y === undefined) return false;
    if (!zone || zone.minX === undefined || zone.minY === undefined) return false;

    const idealMinY_abs = lineOfScrimmage + (zone.minY || 0);
    const idealMaxY_abs = lineOfScrimmage + (zone.maxY || 20);
    const finalMaxY_abs = Math.min(idealMaxY_abs, BACK_WALL_Y);
    const finalMinY_abs = Math.min(idealMinY_abs, finalMaxY_abs - 1.0);

    const withinY = playerState.y >= finalMinY_abs && playerState.y <= finalMaxY_abs;
    const withinX = playerState.x >= zone.minX && playerState.x <= zone.maxX;
    return withinX && withinY;
}

export function calculateRoutePath(routeName, startX, startY) {
    const route = routeTree[routeName];
    if (!route || !route.path) return null;
    const xMirror = (route.mirror !== false && startX < CENTER_X) ? -1 : 1;
    return route.path.map(point => ({
        x: startX + ((point.x || 0) * xMirror),
        y: startY + (point.y || 0)
    }));
}

export function resolveDepthForPlay(offense, defense) {
    const resolved = { offense: {}, defense: {} };

    const resolveSide = (team, side) => {
        const formationName = team.formations[side];
        const formationData = side === 'offense' ? offenseFormations[formationName] : defenseFormations[formationName];
        if (!formationData) return;

        const rosterIds = team.roster || [];
        const usedThisPlay = new Set();
        const sortedSlots = [...formationData.slots].sort((a, b) => getPriority(b) - getPriority(a));

        sortedSlots.forEach(slot => {
            let pId = team.depthChart[side]?.[slot];
            if (!pId || usedThisPlay.has(pId)) {
                const candidates = rosterIds
                    .map(id => getPlayer(id))
                    .filter(p => p && !usedThisPlay.has(p.id) && (!p.status || p.status.duration === 0 || p.status.type === 'temporary'))
                    .sort((a, b) => calculateSlotSuitability(b, slot, side, team) - calculateSlotSuitability(a, slot, side, team));

                pId = candidates[0]?.id || null;
            }
            resolved[side][slot] = pId;
            if (pId) usedThisPlay.add(pId);
        });
    };

    if (offense) resolveSide(offense, 'offense');
    if (defense) resolveSide(defense, 'defense');
    return resolved;
}

export function getAssignment(slot, playbookAssignments, formationMapping, isOffense) {
    if (!playbookAssignments) return null;
    if (playbookAssignments[slot]) return playbookAssignments[slot];

    if (isOffense && formationMapping) {
        for (const [role, mappedSlot] of Object.entries(formationMapping)) {
            const isMatch = Array.isArray(mappedSlot) ? mappedSlot.includes(slot) : mappedSlot === slot;
            if (isMatch && playbookAssignments[role]) return playbookAssignments[role];
        }
    }
    return null;
}

export function captureFrame(playState, gameLog) {
    const los = playState.lineOfScrimmage;
    const ytg = playState.yardsToGo ?? 10;
    // Don't draw first down marker past the opponent's goal line (Goal-to-Go)
    const targetY = los + ytg;
    const firstDownY = targetY < 110 ? targetY : null;

    return {
        tick: playState.tick,
        ball: {
            x: playState.ballState.x,
            y: playState.ballState.y,
            z: playState.ballState.z,
            inAir: playState.ballState.inAir || false,
            targetX: playState.ballState.targetX,
            targetY: playState.ballState.targetY
        },
        players: playState.activePlayers.map(p => {
            let rawAngle;
            // If basically stopped, HOLD the previous angle instead of snapping to 0 or PI
            if (Math.abs(p.vx) < 0.2 && Math.abs(p.vy) < 0.2) {
                rawAngle = p._visualAngle !== undefined ? p._visualAngle : (p.isOffense ? 0 : Math.PI);
            } else {
                rawAngle = Math.atan2(p.vx, p.vy);
            }

            // Interpolate angle to prevent visual rapid flips
            if (p._visualAngle === undefined) p._visualAngle = rawAngle;

            let diff = rawAngle - p._visualAngle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            
            p._visualAngle += diff * 0.35; // Smooths the turn frame-over-frame

            return {
                id: p.id,
                teamId: p.teamId,
                fatigue: p.fatigue,
                slot: p.slot,
                x: p.x,
                y: p.y,
                action: p.action,
                isOffense: p.isOffense,
                hasBall: p.hasBall,
                isStunned: p.stunnedTicks > 0,
                primaryColor: p.primaryColor,
                secondaryColor: p.secondaryColor,
                number: p.number,
                wgt: p.wgt || 200,
                hgt: p.hgt || 70,
                angle: p._visualAngle
            };
        }),
        logIndex: gameLog ? gameLog.length : 0,
        lineOfScrimmage: los,
        firstDownY: firstDownY
    };
}
