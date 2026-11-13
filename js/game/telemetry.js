// js/game/telemetry.js

import { isDebugMode } from './debug_mode.js';

const MAX_BUFFERED_PLAYS = 3;
const MAX_DECISIONS_PER_PLAY = 4000;
const MAX_SNAPSHOTS_PER_PLAY = 100;
const MAX_DETAIL_CLONE_DEPTH = 8;
const MAX_EXPORT_CLONE_DEPTH = 24;

let playHistoryBuffer = [];
let nextPlaySequence = 1;
let telemetryEnabled = false;

/**
 * Deep-clones telemetry payloads at log-time so later ticks or reused engine
 * objects cannot retroactively mutate earlier buffered plays.
 */
function safeClone(value, maxDepth = MAX_DETAIL_CLONE_DEPTH, depth = 0, seen = new WeakSet()) {
    if (value === null || value === undefined) return value;

    if (typeof value === 'number') {
        if (Number.isNaN(value)) return '[NaN]';
        if (!Number.isFinite(value)) return value > 0 ? '[Infinity]' : '[-Infinity]';
        return value;
    }

    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'function') return '[Function]';
    if (typeof value === 'symbol') return value.toString();
    if (typeof value !== 'object') return value;

    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: value.stack
        };
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? '[Invalid Date]' : value.toISOString();
    }

    if (seen.has(value)) return '[Circular Reference]';
    if (depth >= maxDepth) {
        return Array.isArray(value) ? `[Array(${value.length})]` : '[Max Depth Reached]';
    }

    seen.add(value);
    try {
        if (Array.isArray(value)) {
            return value.map(item => safeClone(item, maxDepth, depth + 1, seen));
        }

        if (value instanceof Map) {
            return {
                __type: 'Map',
                entries: Array.from(value.entries()).map(([k, v]) => [
                    safeClone(k, maxDepth, depth + 1, seen),
                    safeClone(v, maxDepth, depth + 1, seen)
                ])
            };
        }

        if (value instanceof Set) {
            return {
                __type: 'Set',
                values: Array.from(value.values()).map(v => safeClone(v, maxDepth, depth + 1, seen))
            };
        }

        if (ArrayBuffer.isView(value)) {
            return Array.from(value);
        }

        const out = {};
        for (const key of Object.keys(value)) {
            try {
                out[key] = safeClone(value[key], maxDepth, depth + 1, seen);
            } catch (err) {
                out[key] = `[Unreadable: ${err?.message || String(err)}]`;
            }
        }
        return out;
    } finally {
        seen.delete(value);
    }
}

/**
 * Safely stringifies an object, preserving Error details, NaN/Infinity,
 * BigInt, Map/Set, and breaking circular references.
 */
function safeStringify(obj, space = undefined) {
    try {
        return JSON.stringify(safeClone(obj, MAX_EXPORT_CLONE_DEPTH), null, space);
    } catch (innerError) {
        return `[Unserializable: ${innerError.message}]`;
    }
}

function closeActivePlay(abortedReason = null) {
    const active = globalThis.__ACTIVE_PLAY_TELEMETRY__;
    if (active && !active.isFinalized) {
        active.isFinalized = true;
        if (abortedReason) {
            active.aborted = true;
            active.abortedReason = abortedReason;
            active.warnings.push(abortedReason);
        }
        active.closedAtTick = Number.isFinite(globalThis.__CURRENT_TICK__)
            ? globalThis.__CURRENT_TICK__
            : active.lastTick;
    }

    globalThis.__ACTIVE_PLAY_TELEMETRY__ = null;
    delete globalThis.__CURRENT_TICK__;
}

function isForeignPlayEvent(current, playId = null) {
    if (!current || current.isFinalized) return true;
    if (!playId) return false;
    if (playId === current.id) return false;

    if (globalThis.__DEBUG_PLAY_ID__ && playId !== globalThis.__DEBUG_PLAY_ID__) {
        return true;
    }

    if (current.sourcePlayId && playId !== current.sourcePlayId) {
        return true;
    }

    return false;
}

function disableTelemetry() {
    telemetryEnabled = false;
    playHistoryBuffer = [];

    globalThis.__ACTIVE_PLAY_TELEMETRY__ = null;
    delete globalThis.__CURRENT_TICK__;
}
// Immediately clear diagnostic data when Debug Mode is switched off.
if (globalThis.addEventListener) {
    globalThis.addEventListener('backyard-debug-mode-changed', event => {
        if (event.detail?.enabled === false) {
            disableTelemetry();
        }
    });
}

function snapshotBallState(ball) {
    if (!ball) return null;

    const {
        x = null, y = null, z = null,
        vx = null, vy = null, vz = null,
        inAir = null, isLoose = null,
        throwerId = null, targetX = null, targetY = null
    } = ball;

    return { x, y, z, vx, vy, vz, inAir, isLoose, throwerId, targetX, targetY };
}

function snapshotPlayers(players) {
    if (!Array.isArray(players)) return [];

    return players.reduce((acc, p) => {
        if (!p) return acc;

        const {
            id = null, name = null, slot = null, role = null, isOffense = null,
            x = null, y = null, z = null, vx = null, vy = null,
            action = null, hasBall = false, isBallCarrier = false, isBlocked = false, stunnedTicks = null
        } = p;

        acc.push({
            id, name, slot, role, isOffense,
            x, y, z, vx, vy,
            action, hasBall, isBallCarrier, isBlocked, stunnedTicks
        });

        return acc;
    }, []);
}

export function clearPlayTelemetry() {
    disableTelemetry();
}

export function initPlayTelemetry(context = {}, playState = {}, offPlayKey = null, defPlayKey = null, enabled = true) {
    if (!isDebugMode()) {
        disableTelemetry();
        return null;
    }

    const safeContext = context || {};
    const safePlayState = playState || {};
    const incomingPlayId = safePlayState.playId ?? safeContext.playId ?? null;

    // Ignore concurrent background simulations when a primary __DEBUG_PLAY_ID__ is active.
    if (globalThis.__DEBUG_PLAY_ID__ && incomingPlayId && incomingPlayId !== globalThis.__DEBUG_PLAY_ID__) {
        return null;
    }

    if (!enabled) {
        // Close any lingering active play without erasing prior buffered plays.
        closeActivePlay('Telemetry disabled before previous play finalized');
        return null;
    }

    // Seal any unfinalized prior play so its late events cannot spill into the new play.
    const previous = globalThis.__ACTIVE_PLAY_TELEMETRY__;
    if (previous && !previous.isFinalized) {
        closeActivePlay('Superseded by new initPlayTelemetry() before finalizePlayTelemetry() was called');
    }

    telemetryEnabled = true;
    const startTick = Number.isFinite(safePlayState.tick) ? safePlayState.tick : 0;
    globalThis.__CURRENT_TICK__ = startTick;

    const sequence = nextPlaySequence++;

    const playData = {
        id: `Q${safeContext.quarter || 1}_${safeContext.down || 1}and${safeContext.yardsToGo || 10}_${Date.now()}_${sequence}`,
        sequence,
        sourcePlayId: incomingPlayId ?? globalThis.__DEBUG_PLAY_ID__ ?? null,
        createdAt: new Date().toISOString(),

        meta: {
            quarter: safeContext.quarter ?? 1,
            down: safeContext.down ?? 1,
            yardsToGo: safeContext.yardsToGo ?? 10,
            ballOn: safeContext.ballOn ?? 35,
            hash: safeContext.ballHash || 'M',
            offPlayKey,
            defPlayKey,
            offenseTeam: safeContext.offenseTeam ?? null,
            defenseTeam: safeContext.defenseTeam ?? null,
            mode: safeContext.isLive === true ? 'LIVE' : (safeContext.fastSim ? 'FAST' : 'STANDARD')
        },

        startState: {
            tick: startTick,
            type: safePlayState.type ?? null,
            lineOfScrimmage: safePlayState.lineOfScrimmage ?? null,
            maxTicks: safePlayState.maxTicks ?? null,
            playIsLive: safePlayState.playIsLive ?? null,
            ball: snapshotBallState(safePlayState.ballState),
            players: snapshotPlayers(safePlayState.activePlayers)
        },

        decisions: [],
        snapshots: [],
        nextDecisionSequence: 1,
        droppedDecisions: 0,
        droppedSnapshots: 0,
        ignoredForeignEvents: 0,
        warnings: [],
        categoryCounts: {},
        lastTick: startTick,
        isFinalized: false,
        aborted: false,
        abortedReason: null,
        closedAtTick: null,
        result: null,
        finalState: null
    };

    playHistoryBuffer.push(playData);

    if (playHistoryBuffer.length > MAX_BUFFERED_PLAYS) {
        playHistoryBuffer.shift();
    }

    globalThis.__ACTIVE_PLAY_TELEMETRY__ = playData;
    return playData.id;
}

export function logPlayEventSnapshot(eventName, players, ball = null, tick = null, playId = null) {
    if (!telemetryEnabled) return;

    if (!isDebugMode()) {
        disableTelemetry();
        return;
    }

    const current = globalThis.__ACTIVE_PLAY_TELEMETRY__;
    if (!current || current.isFinalized) return;

    if (isForeignPlayEvent(current, playId)) {
        current.ignoredForeignEvents++;
        return;
    }

    const recordedTick = Number.isFinite(tick)
        ? tick
        : (Number.isFinite(globalThis.__CURRENT_TICK__) ? globalThis.__CURRENT_TICK__ : current.lastTick);

    if (Number.isFinite(current.lastTick) && recordedTick < current.lastTick) {
        if (current.warnings.length < 20) {
            current.warnings.push(
                `Backwards tick at snapshot "${eventName}": tick ${recordedTick} < prior tick ${current.lastTick}`
            );
        }
    }
    current.lastTick = recordedTick;

    if (current.snapshots.length >= MAX_SNAPSHOTS_PER_PLAY) {
        current.snapshots.shift();
        current.droppedSnapshots++;
    }

    current.snapshots.push({
        eventName,
        tick: recordedTick,
        ball: snapshotBallState(ball),
        players: snapshotPlayers(players)
    });
}

export function logPlayDebug(category, message, details = {}, tick = null, playId = null) {
    if (!telemetryEnabled) return;

    if (!isDebugMode()) {
        disableTelemetry();
        return;
    }

    const current = globalThis.__ACTIVE_PLAY_TELEMETRY__;
    if (!current || current.isFinalized) return;

    if (isForeignPlayEvent(current, playId)) {
        current.ignoredForeignEvents++;
        return;
    }

    const recordedTick = Number.isFinite(tick)
        ? tick
        : (Number.isFinite(globalThis.__CURRENT_TICK__) ? globalThis.__CURRENT_TICK__ : current.lastTick);

    if (Number.isFinite(current.lastTick) && recordedTick < current.lastTick) {
        if (current.warnings.length < 20) {
            current.warnings.push(
                `Backwards tick at decision #${current.nextDecisionSequence} [${category}]: tick ${recordedTick} < prior tick ${current.lastTick}`
            );
        }
    }
    current.lastTick = recordedTick;

    if (current.decisions.length >= MAX_DECISIONS_PER_PLAY) {
        current.decisions.shift();
        current.droppedDecisions++;
    }

    const catKey = String(category ?? 'GENERAL');
    current.categoryCounts[catKey] = (current.categoryCounts[catKey] || 0) + 1;

    current.decisions.push({
        sequence: current.nextDecisionSequence++,
        tick: recordedTick,
        category: catKey,
        message,
        details: safeClone(details, MAX_DETAIL_CLONE_DEPTH)
    });
}

export function finalizePlayTelemetry(playResult = {}, finalBallY = null, playState = null, playId = null) {
    if (!isDebugMode()) {
        disableTelemetry();
        return;
    }

    if (!telemetryEnabled) return;

    const current = globalThis.__ACTIVE_PLAY_TELEMETRY__;
    if (!current || current.isFinalized) return;

    const resolvedPlayId = playId ?? playState?.playId ?? null;
    if (isForeignPlayEvent(current, resolvedPlayId)) {
        current.ignoredForeignEvents++;
        return;
    }

    const clonedResult = (playResult && typeof playResult === 'object')
        ? safeClone(playResult, MAX_DETAIL_CLONE_DEPTH)
        : {};
    current.result = { ...clonedResult, finalBallY };

    if (playState) {
        const flaggedCarriers = (playState.activePlayers || [])
            .filter(p => p && (p.hasBall || p.isBallCarrier));

        if (flaggedCarriers.length > 1) {
            current.warnings.push(
                `Multiple flagged ball carriers at play end (${flaggedCarriers.length}): ${flaggedCarriers.map(p => p.name || p.id).join(', ')}`
            );
        }

        current.finalState = {
            tick: playState.tick ?? current.lastTick,
            playIsLive: playState.playIsLive ?? null,

            touchdown: playState.touchdown ?? false,
            defensiveTD: playState.defensiveTD ?? false,
            turnover: playState.turnover ?? false,
            safety: playState.safety ?? false,
            possessionChanged: playState.possessionChanged ?? false,

            returnStartY: playState.returnStartY ?? null,
            lineOfScrimmage: playState.lineOfScrimmage ?? null,

            ball: snapshotBallState(playState.ballState),
            flaggedCarriers: snapshotPlayers(flaggedCarriers)
        };
    }

    // Close collection for this play while preserving the buffered report.
    closeActivePlay(null);
}

function formatNum(val, decimals = 1) {
    if (typeof val !== 'number') return 'N/A';
    if (Number.isNaN(val)) return 'NaN';
    if (!Number.isFinite(val)) return String(val);
    return val.toFixed(decimals);
}

function formatBallLine(ball) {
    if (!ball) return 'None';

    const pos = `(${formatNum(ball.x)}, ${formatNum(ball.y)}, ${formatNum(ball.z)})`;
    const hasVel = [ball.vx, ball.vy, ball.vz].some(v => typeof v === 'number');
    const vel = hasVel
        ? ` vel=(${formatNum(ball.vx)}, ${formatNum(ball.vy)}, ${formatNum(ball.vz)})`
        : '';

    const flags = [
        ball.inAir ? 'IN_AIR' : null,
        ball.isLoose ? 'LOOSE' : null,
        ball.throwerId != null ? `thrower=${ball.throwerId}` : null,
        (ball.targetX != null || ball.targetY != null)
            ? `target=(${formatNum(ball.targetX)}, ${formatNum(ball.targetY)})`
            : null
    ].filter(Boolean);

    return `pos=${pos}${vel}${flags.length ? ` | ${flags.join(' ')}` : ''}`;
}

function formatPlayerTag(p) {
    const roleTag = p.slot || p.role ? `[${p.slot || p.role}] ` : '';
    const label = p.name || p.id || 'Unknown';
    const flags = [
        p.action ? `act=${p.action}` : null,
        p.hasBall ? 'hasBall' : null,
        p.isBallCarrier ? 'CARRIER' : null,
        p.isBlocked ? 'BLOCKED' : null,
        (typeof p.stunnedTicks === 'number' && p.stunnedTicks > 0) ? `stun=${p.stunnedTicks}` : null
    ].filter(Boolean);

    const flagStr = flags.length ? `, ${flags.join(', ')}` : '';
    return `${roleTag}${label} (x=${formatNum(p.x)}, y=${formatNum(p.y)}${flagStr})`;
}

function formatGroupedPlayers(players, indent = '    ') {
    if (!Array.isArray(players) || players.length === 0) {
        return [`${indent}Players: None`];
    }

    const offense = players.filter(p => p.isOffense === true);
    const defense = players.filter(p => p.isOffense === false);
    const unassigned = players.filter(p => p.isOffense !== true && p.isOffense !== false);

    const out = [];
    if (offense.length > 0) {
        out.push(`${indent}Offense (${offense.length}): ${offense.map(formatPlayerTag).join('; ')}`);
    }
    if (defense.length > 0) {
        out.push(`${indent}Defense (${defense.length}): ${defense.map(formatPlayerTag).join('; ')}`);
    }
    if (unassigned.length > 0) {
        out.push(`${indent}Other (${unassigned.length}): ${unassigned.map(formatPlayerTag).join('; ')}`);
    }
    return out;
}

export function generatePlayDebugReport() {
    if (!isDebugMode()) {
        disableTelemetry();
        return "Debug Mode is disabled.";
    }

    if (playHistoryBuffer.length === 0) {
        return "No telemetry buffered yet.";
    }

    const lines = [];

    lines.push("================================================================================");
    lines.push(`               PLAY TELEMETRY AUDIT REPORT (LAST ${playHistoryBuffer.length} PLAYS BUFFERED)`);
    lines.push("================================================================================\n");

    playHistoryBuffer.forEach((play, index) => {
        const m = play.meta || {};
        const r = play.result;
        const status = play.aborted
            ? 'ABORTED / UNFINALIZED'
            : (play.isFinalized ? 'FINALIZED' : 'ACTIVE / IN PROGRESS');

        lines.push("--------------------------------------------------------------------------------");
        lines.push(
            `[PLAY ${index + 1} OF ${playHistoryBuffer.length}] ${play.id} ` +
            `[${status}]${play.sourcePlayId ? ` (SourceID: ${play.sourcePlayId})` : ''}`
        );
        if (m.offenseTeam || m.defenseTeam || m.mode) {
            lines.push(
                `Matchup:     ${m.offenseTeam ?? 'Offense'} vs ${m.defenseTeam ?? 'Defense'} | Mode: ${m.mode ?? 'N/A'}`
            );
        }
        lines.push(`Situation:   Q${m.quarter} | ${m.down} & ${m.yardsToGo} on ${m.ballOn}yd line (Hash: ${m.hash})`);
        lines.push(`Play Calls:  Offense: "${m.offPlayKey}" | Defense: "${m.defPlayKey}"`);

        if (r) {
            lines.push(
                `Outcome:     ${r.outcome || 'N/A'} | Result Yards: ${r.yards ?? 0}y | ` +
                `Final Ball: ${r.finalBallY ?? 'N/A'}y | ` +
                `Possession Change: ${r.possessionChange ?? 'N/A'} | ` +
                `Turnover Type: ${r.turnoverType ?? 'none'}`
            );
        } else {
            lines.push(
                `Outcome:     (${play.aborted ? `Aborted: ${play.abortedReason}` : 'Not finalized yet / No result recorded'})`
            );
        }

        lines.push(
            `Telemetry:   Decisions=${play.decisions.length} (Dropped=${play.droppedDecisions}) | ` +
            `Snapshots=${play.snapshots.length} (Dropped=${play.droppedSnapshots}) | ` +
            `Ignored Foreign Events=${play.ignoredForeignEvents} | ` +
            `Last Tick=${play.lastTick ?? 'N/A'}`
        );

        const catEntries = Object.entries(play.categoryCounts || {});
        if (catEntries.length > 0) {
            lines.push(`Categories:  ${catEntries.map(([k, v]) => `${k}=${v}`).join(' | ')}`);
        }

        if (play.warnings && play.warnings.length > 0) {
            lines.push("TELEMETRY WARNINGS:");
            play.warnings.forEach(w => lines.push(`  ! ${w}`));
        }

        if (play.startState) {
            const s = play.startState;

            lines.push(
                `Start State: Tick=${s.tick ?? 0} | Type=${s.type ?? 'N/A'} | ` +
                `LOS=${s.lineOfScrimmage ?? 'N/A'} | ` +
                `Max Ticks=${s.maxTicks ?? 'N/A'}`
            );

            lines.push(`Initial Ball: ${formatBallLine(s.ball)}`);

            const initialCarriers = (s.players || []).filter(p => p.hasBall || p.isBallCarrier);
            lines.push(
                `Initial Flagged Carriers: ${
                    initialCarriers.map(p => `${formatPlayerTag(p)} [offense=${p.isOffense}]`).join('; ') || 'None'
                }`
            );

            if (s.players && s.players.length > 0) {
                lines.push("Initial Alignment:");
                lines.push(...formatGroupedPlayers(s.players, '  '));
            }
        }

        if (play.finalState) {
            const f = play.finalState;

            lines.push(
                `Final State: Tick=${f.tick} | ` +
                `Live=${f.playIsLive} | ` +
                `TD=${f.touchdown} | Defensive TD=${f.defensiveTD} | ` +
                `Turnover Flag=${f.turnover} | Safety=${f.safety} | ` +
                `Possession Changed=${f.possessionChanged} | ` +
                `Return Start Y=${f.returnStartY ?? 'N/A'}`
            );

            lines.push(`Final Ball: ${formatBallLine(f.ball)}`);

            lines.push(
                `Final Flagged Carriers: ${
                    f.flaggedCarriers.map(p => `${formatPlayerTag(p)} [offense=${p.isOffense}]`).join('; ') || 'None'
                }`
            );
        }

        if (play.snapshots && play.snapshots.length > 0) {
            lines.push("--------------------------------------------------------------------------------");
            lines.push("KEY EVENT SNAPSHOTS:");
            play.snapshots.forEach(snap => {
                lines.push(`  [Tick ${String(snap.tick).padStart(3, '0')}] EVENT: ${snap.eventName}`);
                if (snap.ball) {
                    lines.push(`    Ball: ${formatBallLine(snap.ball)}`);
                }
                lines.push(...formatGroupedPlayers(snap.players, '    '));
            });
        }

        lines.push("--------------------------------------------------------------------------------");
        lines.push("AI DECISION TRACE & MICRO-CALCULATIONS:");

        if (play.decisions.length === 0) {
            lines.push("  (No micro-decisions recorded for this play)");
        } else {
            play.decisions.forEach(d => {
                lines.push(
                    `  [#${String(d.sequence).padStart(4, '0')}] ` +
                    `[Tick ${String(d.tick).padStart(3, '0')}] ` +
                    `[${d.category}] ${d.message}`
                );

                if (d.details !== null && d.details !== undefined) {
                    const isObject = typeof d.details === 'object';
                    const isEmptyObject = isObject && Object.keys(d.details).length === 0;

                    if (!isEmptyObject) {
                        let detailsStr;
                        if (d.details instanceof Error) {
                            detailsStr = d.details.stack || d.details.message;
                        } else if (isObject) {
                            detailsStr = safeStringify(d.details);
                        } else {
                            detailsStr = String(d.details);
                        }

                        lines.push(`         Details: ${detailsStr}`);
                    }
                }
            });
        }

        if (play.droppedDecisions > 0) {
            lines.push(`WARNING: ${play.droppedDecisions} older diagnostic events were discarded.`);
        }
        if (play.droppedSnapshots > 0) {
            lines.push(`WARNING: ${play.droppedSnapshots} older key-event snapshots were discarded.`);
        }

        lines.push("\n");
    });

    lines.push("================================================================================");
    return lines.join("\n");
}

export function downloadPlayDebugFile(format = 'json') {
    if (!isDebugMode()) {
        disableTelemetry();
        return;
    }

    if (!telemetryEnabled && playHistoryBuffer.length === 0) return;

    // Gracefully abort in non-DOM environments like Node.js
    if (typeof Blob === 'undefined' || typeof document === 'undefined') {
        console.warn("downloadPlayDebugFile: Environment does not support file downloading.");
        return;
    }

    const useJson = format.toLowerCase() === 'json';

    const content = useJson
        ? safeStringify(playHistoryBuffer, 2)
        : generatePlayDebugReport();

    const extension = useJson ? 'json' : 'txt';
    const mimeType = useJson
        ? 'application/json;charset=utf-8'
        : 'text/plain;charset=utf-8';

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `play_debug_buffer_${Date.now()}.${extension}`;
    a.style.display = 'none';

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(url), 1000);
}