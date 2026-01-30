import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeLeague, getGameState, resolvePlay } from '../js/game.js';

await initializeLeague(() => {});
const game = getGameState();

function runPlayWithRNG(off, def, offKey, defKey, rngFunc) {
    const original = Math.random;
    Math.random = rngFunc;
    try {
        const ctx = { gameLog: [], ballOn: 35, down: 1, yardsToGo: 10 };
        const res = resolvePlay(off, def, offKey, defKey, ctx, {}, true);
        return res;
    } finally {
        Math.random = original;
    }
}

test('catch/interception logs have matching visualization frames', () => {
    const offense = game.teams[0];
    const defense = game.teams[1];

    // Force a catch by returning low random values
    const resCatch = runPlayWithRNG(offense, defense, 'Balanced_Slants', 'Cover_2', () => 0.01);
    const logs = resCatch.log || [];
    const vf = resCatch.visualizationFrames || [];

    // Find any catch/interception log index
    const idx = logs.findIndex(l => /CATCH|INTERCEPTION/i.test(l));
    if (idx >= 0) {
        // There should be a visualization frame whose logIndex >= idx where ball is secured
        const frame = vf.find(f => f.logIndex >= idx && f.ball && !f.ball.inAir);
        assert(frame, `Expected a frame with secured ball for log index ${idx}. Logs: ${logs.join(' | ')}`);

        // And the secured ball should be at a player's coords or targetPlayerId set
        const hasTarget = frame.ball.targetPlayerId || frame.players.some(p => p.isBallCarrier);
        assert(hasTarget, 'Expected secured ball to be associated with a player (targetPlayerId or isBallCarrier).');
    }
});

test('swat/drop logs have corresponding loose-ball frames', () => {
    const offense = game.teams[0];
    const defense = game.teams[1];

    // Force swats/drops with high RNG
    const res = runPlayWithRNG(offense, defense, 'Balanced_Slants', 'Cover_2', () => 0.99);
    const logs = res.log || [];
    const vf = res.visualizationFrames || [];

    const idx = logs.findIndex(l => /swats the pass away|drops the pass/i.test(l));
    if (idx >= 0) {
        const frame = vf.find(f => f.logIndex >= idx && f.ball && f.ball.isLoose);
        assert(frame, `Expected a frame with loose ball after swat/drop at log index ${idx}.`);
    }
});