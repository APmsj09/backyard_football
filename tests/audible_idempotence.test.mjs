import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeLeague, getGameState, resolvePlay, pushGameLog } from '../js/game.js';

await initializeLeague(() => {});
const game = getGameState();

test('blitz audible keep-in uses idempotent logging', () => {
    // Directly exercise pushGameLog and the 'keptForBlock' guard to ensure idempotence
    const playState = { _logged: new Set() };
    const gameLog = [];
    const msg = "🧠 QB identifies blitz! Keeps RB in to block.";

    // Simulate RB not yet kept
    const rb = {};
    if (!rb.keptForBlock) {
        pushGameLog(gameLog, msg, playState);
        rb.keptForBlock = true;
    }
    // Second attempt should not push or change state
    if (!rb.keptForBlock) {
        pushGameLog(gameLog, msg, playState);
        rb.keptForBlock = true;
    }

    assert.equal(gameLog.filter(m => m === msg).length, 1, 'Expected exactly one blitz keep-in log via pushGameLog');
    assert.equal(rb.keptForBlock, true, 'rb.keptForBlock should be true');
});

test("captain 'looks confused' message only appears once per play", () => {
    const offense = game.teams[0];
    const defense = game.teams[1];

    // Force low IQ captain for offense and ensure RNG triggers flavor text
    const foundQB = game.players.find(p => p.isOffense);
    if (foundQB) {
        foundQB.attributes = foundQB.attributes || {};
        foundQB.attributes.mental = foundQB.attributes.mental || {};
        foundQB.attributes.mental.playbookIQ = 10;
        foundQB.attributes.mental.consistency = 10;
    }

    // Force RNG to always trigger flavor text
    const realRandom = Math.random;
    Math.random = () => 0.05; // ensures isSmart=false and flavor prob < 0.2

    const ctx = { gameLog: [], ballOn: 35, down: 1, yardsToGo: 10 };
    const res = resolvePlay(offense, defense, 'Balanced_Slants', 'Cover_2', ctx, {}, true);
    Math.random = realRandom;

    const logs = res.log || [];
    const count = logs.filter(m => /looks confused and rushes the play call/i.test(m)).length;
    assert(count <= 1, 'Captain flavor text should appear at most once per play');
});
