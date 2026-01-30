import { handleBallArrival } from '../js/game.js';

// Minimal constants from game.js (must match values)
const TICK_DURATION_SECONDS = 0.04;
const FIELD_WIDTH = 53.3;

function makeP(id, name, x, y, isOffense, attrs = {}) {
    return {
        id, name, x, y, isOffense, attributes: attrs, hasBall: false, isBallCarrier: false, action: 'run_route', slot: isOffense ? 'WR1' : 'DB1', targetX: x, targetY: y
    };
}

(async () => {
    console.log('Running focused live sim (manual tick loop)...');

    // Setup players
    const qb = { id: 99, name: "Caelan 'Rocket'", x: 26.65, y: 20, isOffense: true, attributes: { technical: { throwingAccuracy: 80 }, physical: { strength: 60 } }, hasBall: true };

    const receiver = makeP(1, "Flynn 'Slinger'", 25, 40, true, { technical: { catchingHands: 80 }, physical: { agility: 70 } });
    const defender = makeP(2, "Kirk 'Ultimate'", 25, 35, false, { technical: { catchingHands: 20 }, physical: { agility: 60 } });

    // Play state
    const playState = {
        tick: 0,
        type: 'pass',
        activePlayers: [qb, receiver, defender],
        playIsLive: true,
        lineOfScrimmage: 20,
        statEvents: [],
        ballState: { x: qb.x, y: qb.y, z: 1.0, vx: 0, vy: 0, vz: 0, inAir: false, isLoose: false, prevX: null, prevY: null, targetPlayerId: null }
    };

    const gameLog = [];

    // Helper to push log without duplicates
    const pushLog = (m) => {
        if (gameLog[gameLog.length - 1] === m) return;
        gameLog.push(m);
    };

    // Helper to perform a throw toward receiver with given speed
    function doThrow(qbState, target, playState) {
        playState.ballState.inAir = true;
        playState.ballState.throwerId = qbState.id;
        playState.ballState.x = qbState.x;
        playState.ballState.y = qbState.y;
        playState.ballState.z = 1.0;
        const dx = (target.x - qbState.x);
        const dy = (target.y - qbState.y);
        // Normalize travel time so it arrives in ~1.5s
        playState.ballState.vx = dx / 1.5;
        playState.ballState.vy = dy / 1.5;
        playState.ballState.vz = 5;
        playState.ballState.prevX = qbState.x;
        playState.ballState.prevY = qbState.y;
        playState.ballState.lastInteraction = null;
        pushLog(`🏈 ${qbState.name} passes to ${target.name} (Manual Throw)`);
        qbState.hasBall = false;
    }

    // Sequence of RNG values to simulate: first swat (0.99), then catch by receiver (0.01)
    const seq = [0.99, 0.99, 0.01, 0.01, 0.01];
    let idx = 0;
    const realRandom = Math.random;
    Math.random = () => seq[Math.min(idx++, seq.length - 1)];

    // Do the throw
    doThrow(qb, receiver, playState);

    // Run ticks until play ends or max ticks
    const maxTicks = 200;
    for (let t = 0; t < maxTicks && playState.playIsLive !== false; t++) {
        playState.tick = t;

        const ball = playState.ballState;
        if (ball.inAir) {
            ball.prevX = ball.x;
            ball.prevY = ball.y;
            // Motion
            ball.x += ball.vx * TICK_DURATION_SECONDS;
            ball.y += ball.vy * TICK_DURATION_SECONDS;
            ball.z += ball.vz * TICK_DURATION_SECONDS;
            ball.vz -= 9.8 * TICK_DURATION_SECONDS;

            // Clamp
            ball.x = Math.max(0.5, Math.min(FIELD_WIDTH - 0.5, ball.x));

            // Call arrival handler
            handleBallArrival(playState, null, {}, gameLog);

            // Log per-tick ball and interactions
            console.log(`tick ${t}: ball (${ball.x.toFixed(2)}, ${ball.y.toFixed(2)}, z=${ball.z.toFixed(2)})`);
            if (gameLog.length) console.log('  last log:', gameLog[gameLog.length - 1]);

            // If ball becomes not in air and not loose, it's a successful catch or interception and play continues with runner
            if (!ball.inAir && !ball.isLoose) {
                console.log('Ball secured at tick', t);
                break;
            }
        } else {
            // If ball on ground or stuck, end
            break;
        }
    }

    Math.random = realRandom;

    console.log('\nFinal gameLog:');
    gameLog.forEach((l, i) => console.log(i, l));
    console.log('\nFinal ball state:', playState.ballState);
})();