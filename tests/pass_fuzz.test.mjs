import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeLeague, getGameState, resolvePlay } from '../js/game.js';

// Simple reproducible LCG
function seededRng(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
    };
}

const PASS_PLAYS = [
    'Balanced_Slants', 'Balanced_Smash', 'Balanced_Sluggo_Shot', 'Balanced_Zig_Zag',
    'Spread_BubbleScreen', 'Spread_FourVerts', 'Spread_Mesh', 'Spread_DoubleMove',
    'Power_PA_Leak', 'Power_Texas'
];

// Approx constants (must match engine bounds)
const FIELD_WIDTH = 53.3;
const FIELD_LENGTH = 120;

await initializeLeague(() => {});
const game = getGameState();

test('fuzz test: random pass plays keep visual/log sync', () => {
    const anomalies = [];
    const ITER = 200;

    for (let i = 0; i < ITER; i++) {
        const seed = 12345 + i;
        const rng = seededRng(seed);
        const origRandom = Math.random;
        Math.random = rng;

        try {
            // pick teams
            const teams = game.teams.filter(t => t);
            if (teams.length < 2) break;
            const off = teams[Math.floor(rng() * teams.length)];
            let def = teams[Math.floor(rng() * teams.length)];
            if (def.id === off.id) def = teams[(Math.floor(rng() * (teams.length - 1)) + 1) % teams.length];

            const offKey = PASS_PLAYS[Math.floor(rng() * PASS_PLAYS.length)];
            const defKey = 'Cover_2';

            const ctx = { gameLog: [], ballOn: 35, down: 1, yardsToGo: 10 };
            const res = resolvePlay(off, def, offKey, defKey, ctx, {}, true);

            const logs = res.log || [];
            const vf = res.visualizationFrames || [];

            // Quick frame bounds check
            for (const f of vf) {
                const b = f.ball || {};
                if (typeof b.x === 'number' && (b.x < 0.5 || b.x > FIELD_WIDTH - 0.5)) {
                    anomalies.push({ type: 'ball_oob', i, seed, offKey, defKey, detail: `x=${b.x}` });
                    break;
                }
                if (typeof b.y === 'number' && (b.y < 0.0 || b.y > FIELD_LENGTH)) {
                    anomalies.push({ type: 'ball_oob', i, seed, offKey, defKey, detail: `y=${b.y}` });
                    break;
                }
            }
            if (anomalies.length) break;

            // For each interesting log message, assert matching frames exist
            for (let idx = 0; idx < logs.length; idx++) {
                const line = logs[idx];
                if (/CATCH|INTERCEPTION/i.test(line)) {
                    const frame = vf.find(f => f.logIndex >= idx && f.ball && !f.ball.inAir);
                    if (!frame) {
                        anomalies.push({ type: 'no_secure_frame', i, seed, offKey, defKey, idx, line, logLen: logs.length, vfLen: vf.length });
                        break;
                    }
                    // Check association
                    const b = frame.ball;
                    const associated = (b && (b.targetPlayerId || frame.players.some(p => p.isBallCarrier)));
                    if (!associated) {
                        anomalies.push({ type: 'no_association', i, seed, offKey, defKey, idx, line });
                        break;
                    }
                }

                if (/swats the pass away|drops the pass/i.test(line)) {
                    const frame = vf.find(f => f.logIndex >= idx && f.ball && f.ball.isLoose);
                    if (!frame) {
                        anomalies.push({ type: 'no_loose_frame', i, seed, offKey, defKey, idx, line });
                        break;
                    }
                }
            }

            if (anomalies.length) break;
        } finally {
            Math.random = origRandom;
        }
    }

    if (anomalies.length > 0) {
        const sample = anomalies.slice(0, 5).map(a => JSON.stringify(a)).join('\n');
        assert.fail(`Fuzz found anomalies:\n${sample}`);
    }
});