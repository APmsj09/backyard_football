// js/game/telemetry.js

import { isDebugMode } from './debug_mode.js';

const MAX_BUFFERED_PLAYS = 3;
const MAX_DECISIONS_PER_PLAY = 4000;

let playHistoryBuffer = [];
let nextPlaySequence = 1;
let telemetryEnabled = false;

function disableTelemetry() {
    telemetryEnabled = false;
    playHistoryBuffer = [];

    if (typeof window !== 'undefined') {
        window.__ACTIVE_PLAY_TELEMETRY__ = null;
        delete window.__CURRENT_TICK__;
    }
}

function snapshotBallState(ball) {
    if (!ball) return null;

    return {
        x: ball.x ?? null,
        y: ball.y ?? null,
        z: ball.z ?? null,
        vx: ball.vx ?? null,
        vy: ball.vy ?? null,
        vz: ball.vz ?? null,
        inAir: ball.inAir ?? null,
        isLoose: ball.isLoose ?? null,
        throwerId: ball.throwerId ?? null,
        targetX: ball.targetX ?? null,
        targetY: ball.targetY ?? null
    };
}

function snapshotPlayers(players) {
    if (!Array.isArray(players)) return [];

    return players.map(p => ({
        id: p.id ?? null,
        name: p.name ?? null,
        slot: p.slot ?? null,
        role: p.role ?? null,
        isOffense: p.isOffense ?? null,

        x: p.x ?? null,
        y: p.y ?? null,
        z: p.z ?? null,
        vx: p.vx ?? null,
        vy: p.vy ?? null,

        action: p.action ?? null,
        hasBall: p.hasBall ?? false,
        isBallCarrier: p.isBallCarrier ?? false,
        isBlocked: p.isBlocked ?? false,
        stunnedTicks: p.stunnedTicks ?? null
    }));
}

export function clearPlayTelemetry() {
    disableTelemetry();
}

export function initPlayTelemetry(context, playState, offPlayKey, defPlayKey, enabled = true) {
    if (!enabled || !isDebugMode() || typeof window === 'undefined') {
        disableTelemetry();
        return;
    }

    telemetryEnabled = true;
    window.__CURRENT_TICK__ = playState?.tick ?? 0;

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
            type: playState?.type ?? null,
            lineOfScrimmage: playState?.lineOfScrimmage ?? null,
            maxTicks: playState?.maxTicks ?? null,
            playIsLive: playState?.playIsLive ?? null,
            ball: snapshotBallState(playState?.ballState),
            players: snapshotPlayers(playState?.activePlayers)
        },

        decisions: [],
        nextDecisionSequence: 1,
        droppedDecisions: 0,
        result: null,
        finalState: null
    };

    playHistoryBuffer.push(playData);

    if (playHistoryBuffer.length > MAX_BUFFERED_PLAYS) {
        playHistoryBuffer.shift();
    }

    window.__ACTIVE_PLAY_TELEMETRY__ = playData;
}

export function logPlayDebug(category, message, details = null, tick = null) {
    if (!telemetryEnabled) return;

    if (!isDebugMode()) {
        disableTelemetry();
        return;
    }

    if (typeof window === 'undefined') return;

    const current = window.__ACTIVE_PLAY_TELEMETRY__;
    if (!current) return;

    const recordedTick = Number.isFinite(tick)
        ? tick
        : (
            Number.isFinite(window.__CURRENT_TICK__)
                ? window.__CURRENT_TICK__
                : 0
        );

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

export function finalizePlayTelemetry(playResult, finalBallY, playState = null) {
    if (!telemetryEnabled) return;

    if (!isDebugMode()) {
        disableTelemetry();
        return;
    }

    if (typeof window === 'undefined') return;

    const current = window.__ACTIVE_PLAY_TELEMETRY__;
    if (!current) return;

    current.result = { ...playResult, finalBallY };

    if (!playState) return;

    const flaggedCarriers = (playState.activePlayers || [])
        .filter(p => p.hasBall || p.isBallCarrier);

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
        const m = play.meta;
        const r = play.result || {};

        lines.push("--------------------------------------------------------------------------------");
        lines.push(`[PLAY ${index + 1} OF ${playHistoryBuffer.length}] ${play.id}`);
        lines.push(`Situation:   Q${m.quarter} | ${m.down} & ${m.yardsToGo} on ${m.ballOn}yd line (Hash: ${m.hash})`);
        lines.push(`Play Calls:  Offense: "${m.offPlayKey}" | Defense: "${m.defPlayKey}"`);
        lines.push(`Outcome:     ${r.outcome || 'N/A'} | Gain: ${r.yards ?? 0}y | Final Ball: ${r.finalBallY ?? 'N/A'}y`);

        if (play.startState) {
            const s = play.startState;

            lines.push(
                `Start State: Type=${s.type ?? 'N/A'} | ` +
                `LOS=${s.lineOfScrimmage ?? 'N/A'} | ` +
                `Max Ticks=${s.maxTicks ?? 'N/A'}`
            );

            lines.push(`Initial Ball: ${JSON.stringify(s.ball)}`);

            const initialCarriers = (s.players || [])
                .filter(p => p.hasBall || p.isBallCarrier);

            lines.push(
                `Initial Flagged Carriers: ${
                    initialCarriers.map(p =>
                        `${p.name} (x=${p.x}, y=${p.y})`
                    ).join('; ') || 'None'
                }`
            );
        }

        if (play.finalState) {
            const f = play.finalState;

            lines.push(
                `Final State: Tick=${f.tick} | ` +
                `Live=${f.playIsLive} | ` +
                `TD=${f.touchdown} | Defensive TD=${f.defensiveTD} | ` +
                `Turnover=${f.turnover} | Return Start Y=${f.returnStartY ?? 'N/A'}`
            );

            lines.push(`Final Ball: ${JSON.stringify(f.ball)}`);

            lines.push(
                `Final Flagged Carriers: ${
                    f.flaggedCarriers.map(p =>
                        `${p.name} (offense=${p.isOffense}, x=${p.x}, y=${p.y})`
                    ).join('; ') || 'None'
                }`
            );
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
                    lines.push(
                        `         Details: ${
                            typeof d.details === 'object'
                                ? JSON.stringify(d.details)
                                : d.details
                        }`
                    );
                }
            });
        }

        if (play.droppedDecisions > 0) {
            lines.push(
                `WARNING: ${play.droppedDecisions} older diagnostic events were discarded.`
            );
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

    const useJson = format.toLowerCase() === 'json';

    const content = useJson
        ? JSON.stringify(playHistoryBuffer, null, 2)
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

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
}
