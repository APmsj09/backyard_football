import test from 'node:test';
import assert from 'node:assert/strict';
import { handleBallArrival } from '../js/game.js';

function makePlayer(id, name, x, y, isOffense, attrs = {}) {
    return {
        id,
        name,
        x,
        y,
        isOffense,
        attributes: attrs
    };
}

test('defender swat should only be logged once', () => {
    const defender = makePlayer(2, 'Kirk', 25, 29.4, false, { technical: { catchingHands: 10 }, physical: { agility: 20 } });
    const receiver = makePlayer(1, 'Flynn', 25, 30, true, { technical: { catchingHands: 80 }, physical: { agility: 60 } });

    const playState = {
        tick: 100,
        type: 'pass',
        activePlayers: [receiver, defender],
        ballState: { inAir: true, isLoose: false, x: 25, y: 29.5, z: 1.0, prevX: 25, prevY: 29, vx: 0.1, vy: 0.1, vz: -0.5, throwerId: 99 },
        playIsLive: true,
        lineOfScrimmage: 20,
        statEvents: []
    };

    // Force a 'swat' outcome by making random high
    const realRandom = Math.random;
    Math.random = () => 0.99;

    const gameLog = [];

    handleBallArrival(playState, null, {}, gameLog);
    const afterFirst = gameLog.slice();
    assert(afterFirst.some(m => m.includes('swats the pass away')), 'Expected a swat on first call');
    const vxAfterFirst = playState.ballState.vx;
    assert(playState.ballState.lastInteraction && playState.ballState.lastInteraction.type === 'swat');

    // Second call (next tick) should NOT add duplicate swat or further bump velocity
    playState.tick += 1;
    handleBallArrival(playState, null, {}, gameLog);
    const swatCount = gameLog.filter(m => m.includes('swats the pass away')).length;
    assert.equal(swatCount, 1, 'Swat should only be logged once');
    assert.equal(playState.ballState.vx, vxAfterFirst, 'vx should not be bumped twice');

    Math.random = realRandom;
});

test('receiver drop should only be logged once', () => {
    const receiver = makePlayer(1, 'Sam', 26, 30, true, { technical: { catchingHands: 10 }, physical: { agility: 30 } });

    const playState = {
        tick: 200,
        type: 'pass',
        activePlayers: [receiver],
        ballState: { inAir: true, isLoose: false, x: 26, y: 30.5, z: 1.0, prevX: 26, prevY: 30, vx: 0.1, vy: 0.1, vz: -0.5, throwerId: 99 },
        playIsLive: true,
        lineOfScrimmage: 20,
        statEvents: []
    };

    const realRandom = Math.random;
    Math.random = () => 0.99; // force drop

    const gameLog = [];
    handleBallArrival(playState, null, {}, gameLog);
    assert(gameLog.some(m => m.includes('drops the pass')), 'Expected a drop on first call');

    playState.tick += 1;
    handleBallArrival(playState, null, {}, gameLog);
    const dropCount = gameLog.filter(m => m.includes('drops the pass')).length;
    assert.equal(dropCount, 1, 'Drop should only be logged once');

    Math.random = realRandom;
});

test('successful catch snaps ball to receiver and zeros velocities', () => {
    const receiver = makePlayer(1, 'Jamie', 27.5, 40, true, { technical: { catchingHands: 90 }, physical: { agility: 80 } });
    const playState = {
        tick: 300,
        type: 'pass',
        activePlayers: [receiver],
        ballState: { inAir: true, isLoose: false, x: 27.2, y: 39.8, z: 1.2, prevX: 27.0, prevY: 39.5, vx: 2.5, vy: 1.5, vz: -1.2, throwerId: 99 },
        playIsLive: true,
        lineOfScrimmage: 20,
        statEvents: []
    };

    const realRandom = Math.random;
    Math.random = () => 0.01; // force catch success

    const gameLog = [];
    handleBallArrival(playState, null, {}, gameLog);

    assert.equal(playState.ballState.x, receiver.x, 'Ball should snap to receiver x');
    assert.equal(playState.ballState.y, receiver.y, 'Ball should snap to receiver y');
    assert.equal(playState.ballState.z, 0.5, 'Ball z should be set to 0.5 on catch');
    assert.equal(playState.ballState.vx, 0, 'vx should be zero after catch');
    assert.equal(playState.ballState.vy, 0, 'vy should be zero after catch');
    assert.equal(playState.ballState.vz, 0, 'vz should be zero after catch');
    assert.equal(playState.ballState.targetPlayerId, receiver.id, 'targetPlayerId should be set to receiver');

    Math.random = realRandom;
});
