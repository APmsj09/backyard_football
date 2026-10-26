// js/game/telemetry.js

import { isDebugMode } from './debug_mode.js';

const MAX_BUFFERED_PLAYS = 3;
const MAX_DECISIONS_PER_PLAY = 4000;

let playHistoryBuffer = [];
let nextPlaySequence = 1;
let telemetryEnabled = false;

/**
 * Safely stringifies an object, handling circular references 
 * to prevent crashes during telemetry generation.
 */
function safeStringify(obj, space = undefined) {
    try {
        return JSON.stringify(obj, null, space);
    } catch (e) {
        try {
            const seen = new WeakSet();
            return JSON.stringify(obj, (key, value) => {
                if (typeof value === "object" && value !== null) {
                    if (seen.has(value)) return "[Circular/Shared Reference]";
                    seen.add(value);
                }
                return value;
            }, space);
        } catch (innerError) {
            return `[Unserializable: ${innerError.message}]`;
        }
    }
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
    if (!enabled || !isDebugMode()) {
        disableTelemetry();
        return;
    }

    telemetryEnabled = true;
    globalThis.__CURRENT_TICK__ = playState.tick ?? 0;

    const sequence = nextPlaySequence++;

    const playData = {
        id: `Q${context.quarter || 1}_${context.down || 1}and${context.yardsToGo || 10}_${Date.now()}_${sequence}`,
        sequence,

        meta: {
            quarter: context.quarter ?? 1,
            down: context.down ?? 1,
            yardsToGo: context.yardsToGo ?? 10,
            ballOn: context.ballOn ?? 35,
            hash: context.ballHash || 'M',
            offPlayKey,
            defPlayKey
        },

        startState: {
            type: playState.type ?? null,
            lineOfScrimmage: playState.lineOfScrimmage ?? null,
            maxTicks: playState.maxTicks ?? null,
            playIsLive: playState.playIsLive ?? null,
            ball: snapshotBallState(playState.ballState),
            players: snapshotPlayers(playState.activePlayers)
        },

        // NEW CODE
        decisions: [],
        snapshots: [],
        nextDecisionSequence: 1,
        droppedDecisions: 0,
        result: null,
        finalState: null
    };

    playHistoryBuffer.push(playData);

    if (playHistoryBuffer.length > MAX_BUFFERED_PLAYS) {
        playHistoryBuffer.shift();
    }

    globalThis.__ACTIVE_PLAY_TELEMETRY__ = playData;
}

export function logPlayEventSnapshot(eventName, players, ball = null, tick = null) {
    if (!telemetryEnabled || !isDebugMode()) return;
    
    const current = globalThis.__ACTIVE_PLAY_TELEMETRY__;
    if (!current) return;

    const recordedTick = Number.isFinite(tick)
        ? tick
        : (Number.isFinite(globalThis.__CURRENT_TICK__) ? globalThis.__CURRENT_TICK__ : 0);

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
    if (!current) return;

    // If an active debug ID is set, ignore events from concurrent background simulations
    if (globalThis.__DEBUG_PLAY_ID__ && playId && playId !== globalThis.__DEBUG_PLAY_ID__) {
        return;
    }

    const recordedTick = Number.isFinite(tick)
        ? tick
        : (Number.isFinite(globalThis.__CURRENT_TICK__) ? globalThis.__CURRENT_TICK__ : 0);

    if (current.decisions.length >= MAX_DECISIONS_PER_PLAY) {
        current.decisions.shift();
        current.droppedDecisions++;
    }

    current.decisions.push({
        sequence: current.nextDecisionSequence++,
        tick: recordedTick,
        category,
        message,
        details
    });
}

export function finalizePlayTelemetry(playResult = {}, finalBallY = null, playState = null) {
    if (!telemetryEnabled || !isDebugMode()) {
        disableTelemetry();
        return;
    }

    const current = globalThis.__ACTIVE_PLAY_TELEMETRY__;
    if (!current) return;

    current.result = { ...playResult, finalBallY };

    if (playState) {
        const flaggedCarriers = (playState.activePlayers || [])
            .filter(p => p && (p.hasBall || p.isBallCarrier));

        current.finalState = {
            tick: playState.tick ?? null,
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
    globalThis.__ACTIVE_PLAY_TELEMETRY__ = null;
    delete globalThis.__CURRENT_TICK__;
}

export function generatePlayDebugReport() {
    if (!isDebugMode()) {
        disableTelemetry();
        return "Debug Mode is disabled.";
    }

    if (!telemetryEnabled || playHistoryBuffer.length === 0) {
        return "No telemetry buffered yet.";
    }

    const lines = [];

    lines.push("================================================================================");
    lines.push(`               PLAY TELEMETRY AUDIT REPORT (LAST ${playHistoryBuffer.length} PLAYS BUFFERED)`);
    lines.push("================================================================================\n");

    playHistoryBuffer.forEach((play, index) => {
        const m = play.meta || {};
        const r = play.result || {};

        lines.push("--------------------------------------------------------------------------------");
        lines.push(`[PLAY ${index + 1} OF ${playHistoryBuffer.length}] ${play.id}`);
        lines.push(`Situation:   Q${m.quarter} | ${m.down} & ${m.yardsToGo} on ${m.ballOn}yd line (Hash: ${m.hash})`);
        lines.push(`Play Calls:  Offense: "${m.offPlayKey}" | Defense: "${m.defPlayKey}"`);
        lines.push(
            `Outcome:     ${r.outcome || 'N/A'} | Result Yards: ${r.yards ?? 0}y | ` +
            `Final Ball: ${r.finalBallY ?? 'N/A'}y | ` +
            `Possession Change: ${r.possessionChange ?? 'N/A'} | ` +
            `Turnover Type: ${r.turnoverType ?? 'none'}`
        );

        if (play.startState) {
            const s = play.startState;

            lines.push(
                `Start State: Type=${s.type ?? 'N/A'} | ` +
                `LOS=${s.lineOfScrimmage ?? 'N/A'} | ` +
                `Max Ticks=${s.maxTicks ?? 'N/A'}`
            );

            lines.push(`Initial Ball: ${safeStringify(s.ball)}`);

            const initialCarriers = (s.players || []).filter(p => p.hasBall || p.isBallCarrier);
            lines.push(
                `Initial Flagged Carriers: ${
                    initialCarriers.map(p => `${p.name} (x=${p.x}, y=${p.y})`).join('; ') || 'None'
                }`
            );
        }

        if (play.finalState) {
            const f = play.finalState;

            lines.push(
                `Final State: Tick=${f.tick} | ` +
                `Live=${f.playIsLive} | ` +
                `TD=${f.touchdown} | Defensive TD=${f.defensiveTD} | ` +
                `Turnover Flag=${f.turnover} | ` +
                `Possession Changed=${f.possessionChanged} | ` +
                `Return Start Y=${f.returnStartY ?? 'N/A'}`
            );

            lines.push(`Final Ball: ${safeStringify(f.ball)}`);

            lines.push(
                `Final Flagged Carriers: ${
                    f.flaggedCarriers.map(p => `${p.name} (offense=${p.isOffense}, x=${p.x}, y=${p.y})`).join('; ') || 'None'
                }`
            );
        }

// NEW CODE
        if (play.snapshots && play.snapshots.length > 0) {
            lines.push("--------------------------------------------------------------------------------");
            lines.push("KEY EVENT SNAPSHOTS:");
            play.snapshots.forEach(snap => {
                lines.push(`  [Tick ${String(snap.tick).padStart(3, '0')}] EVENT: ${snap.eventName}`);
                if (snap.ball) {
                    lines.push(`    Ball: x=${snap.ball.x?.toFixed(1)}, y=${snap.ball.y?.toFixed(1)}`);
                }
                const pList = (snap.players || [])
                    .map(p => `${p.name || p.id} (x=${p.x?.toFixed(1)}, y=${p.y?.toFixed(1)})`)
                    .join('; ');
                lines.push(`    Players: ${pList || 'None'}`);
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

    if (!telemetryEnabled) return;

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

    URL.revokeObjectURL(url);
}