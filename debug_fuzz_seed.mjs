import { initializeLeague, getGameState, resolvePlay } from './js/game.js';

function seededRng(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
    };
}

const FIELD_WIDTH = 53.3;
const FIELD_LENGTH = 120;

const PASS_PLAYS = [
    'Balanced_Slants', 'Balanced_Smash', 'Balanced_Sluggo_Shot', 'Balanced_Zig_Zag',
    'Spread_BubbleScreen', 'Spread_FourVerts', 'Spread_Mesh', 'Spread_DoubleMove',
    'Power_PA_Leak', 'Power_Texas'
];

await initializeLeague(() => {});
const game = getGameState();

// Replay seed 12459
const targetSeed = 12459;
const rng = seededRng(targetSeed);
const origRandom = Math.random;
Math.random = rng;

try {
    const teams = game.teams.filter(t => t);
    const off = teams[Math.floor(rng() * teams.length)];
    let def = teams[Math.floor(rng() * teams.length)];
    if (def.id === off.id) def = teams[(Math.floor(rng() * (teams.length - 1)) + 1) % teams.length];

    const offKey = PASS_PLAYS[Math.floor(rng() * PASS_PLAYS.length)];
    const defKey = 'Cover_2';

    console.log(`Replaying seed ${targetSeed} with offKey=${offKey}, defKey=${defKey}`);

    const ctx = { gameLog: [], ballOn: 35, down: 1, yardsToGo: 10 };
    const res = resolvePlay(off, def, offKey, defKey, ctx, {}, true);

    const logs = res.log || [];
    const vf = res.visualizationFrames || [];

    console.log(`\nResult outcome: ${res.playResult?.outcome}`);
    console.log(`Total logs: ${logs.length}`);
    console.log(`Total frames: ${vf.length}`);

    // Find OOB frames
    console.log('\n--- Checking for OOB frames ---');
    for (let i = 0; i < vf.length; i++) {
        const f = vf[i];
        const b = f.ball || {};
        if (typeof b.x === 'number' && (b.x < 0.5 || b.x > FIELD_WIDTH - 0.5)) {
            console.log(`Frame ${i}: ball.x = ${b.x} (OOB)`);
            // Print context
            if (i > 0) console.log(`  Previous frame x: ${vf[i-1].ball?.x}`);
            if (i < vf.length - 1) console.log(`  Next frame x: ${vf[i+1].ball?.x}`);
            console.log(`  Log index: ${f.logIndex}, log: "${logs[f.logIndex] || ''}"`);
        }
        if (typeof b.y === 'number' && (b.y < 0.0 || b.y > FIELD_LENGTH)) {
            console.log(`Frame ${i}: ball.y = ${b.y} (OOB)`);
        }
    }

    console.log('\n--- Last 10 logs ---');
    for (let i = Math.max(0, logs.length - 10); i < logs.length; i++) {
        console.log(`${i}: ${logs[i]}`);
    }

    console.log('\n--- Last 5 frames (detailed) ---');
    for (let i = Math.max(0, vf.length - 5); i < vf.length; i++) {
        const f = vf[i];
        const b = f.ball;
        const carrier = f.players?.find(p => p.isBallCarrier);
        console.log(`Frame ${i}:`);
        console.log(`  logIndex: ${f.logIndex}`);
        console.log(`  ball: (${b?.x?.toFixed(2)}, ${b?.y?.toFixed(2)}, ${b?.z?.toFixed(2)}) inAir=${b?.inAir} isLoose=${b?.isLoose}`);
        if (carrier) console.log(`  carrier: ${carrier.name} at (${carrier.x?.toFixed(2)}, ${carrier.y?.toFixed(2)})`);
    }
} finally {
    Math.random = origRandom;
}
