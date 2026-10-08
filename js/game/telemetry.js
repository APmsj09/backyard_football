// js/game/telemetry.js

const MAX_BUFFERED_PLAYS = 5;
let playHistoryBuffer = [];

export function clearPlayTelemetry() {
    playHistoryBuffer = [];
    window.__ACTIVE_PLAY_TELEMETRY__ = null;
}

export function initPlayTelemetry(context, playState, offPlayKey, defPlayKey) {
    const playData = {
        id: `Q${context.quarter || 1}_${context.down || 1}and${context.yardsToGo || 10}_${Date.now()}`,
        meta: {
            quarter: context.quarter || 1,
            down: context.down || 1,
            yardsToGo: context.yardsToGo || 10,
            ballOn: context.ballOn || 35,
            hash: context.ballHash || 'M',
            offPlayKey,
            defPlayKey
        },
        decisions: [],
        result: null
    };

    playHistoryBuffer.push(playData);
    if (playHistoryBuffer.length > MAX_BUFFERED_PLAYS) {
        playHistoryBuffer.shift();
    }

    window.__ACTIVE_PLAY_TELEMETRY__ = playData;
}

export function logPlayDebug(category, message, details = null) {
    const current = window.__ACTIVE_PLAY_TELEMETRY__;
    if (!current) return;
    current.decisions.push({
        tick: window.__CURRENT_TICK__ || 0,
        category,
        message,
        details
    });
}

export function finalizePlayTelemetry(playResult, finalBallY) {
    const current = window.__ACTIVE_PLAY_TELEMETRY__;
    if (!current) return;
    current.result = { ...playResult, finalBallY };
}

export function generatePlayDebugReport() {
    if (playHistoryBuffer.length === 0) return "No telemetry buffered yet.";

    let lines = [];
    lines.push("================================================================================");
    lines.push(`               PLAY TELEMETRY AUDIT REPORT (LAST ${playHistoryBuffer.length} PLAYS BUFFERED)`);
    lines.push("================================================================================\n");

    playHistoryBuffer.forEach((play, index) => {
        const m = play.meta;
        const r = play.result || {};

        lines.push(`--------------------------------------------------------------------------------`);
        lines.push(`[PLAY ${index + 1} OF ${playHistoryBuffer.length}] ${play.id}`);
        lines.push(`Situation:   Q${m.quarter} | ${m.down} & ${m.yardsToGo} on ${m.ballOn}yd line (Hash: ${m.hash})`);
        lines.push(`Play Calls:  Offense: "${m.offPlayKey}" | Defense: "${m.defPlayKey}"`);
        lines.push(`Outcome:     Outcome: ${r.outcome || 'N/A'} | Gain: ${r.yards ?? 0}y | Final Ball: ${r.finalBallY ?? 'N/A'}y`);
        lines.push(`--------------------------------------------------------------------------------`);
        lines.push("AI DECISION TRACE & MICRO-CALCULATIONS:");

        if (play.decisions.length === 0) {
            lines.push("  (No micro-decisions recorded for this play)");
        } else {
            play.decisions.forEach(d => {
                lines.push(`  [Tick ${String(d.tick).padStart(3, '0')}] [${d.category}] ${d.message}`);
                if (d.details) {
                    lines.push(`         Details: ${typeof d.details === 'object' ? JSON.stringify(d.details) : d.details}`);
                }
            });
        }
        lines.push("\n");
    });

    lines.push("================================================================================");
    return lines.join("\n");
}

/*export function downloadPlayDebugFile() {
    const report = generatePlayDebugReport();
    const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `play_debug_buffer_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}*/