import { initializeLeague, getGameState, resolvePlay } from './js/game.js';

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

await initializeLeague(() => {});
const game = getGameState();

// Replay seed 12347
const targetSeed = 12347;
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

    console.log('\n--- All logs ---');
    for (let i = 0; i < logs.length; i++) {
        console.log(`${i}: ${logs[i]}`);
    }

    console.log('\n--- Check for CATCH at index 3 ---');
    if (logs[3]) console.log(`Log 3: "${logs[3]}"`);
    
    // Look for a frame where logIndex >= 3 and ball is not in air
    const frame = vf.find(f => f.logIndex >= 3 && f.ball && !f.ball.inAir);
    if (frame) {
        console.log(`Found secure frame at vf index: ${vf.indexOf(frame)}`);
    } else {
        console.log(`No secure frame found for logIndex >= 3`);
        // Print frames around logIndex 3
        console.log('\nFrames with logIndex near 3:');
        for (let i = 0; i < vf.length; i++) {
            if (vf[i].logIndex >= 2 && vf[i].logIndex <= 4) {
                const f = vf[i];
                console.log(`  Frame ${i}: logIndex=${f.logIndex}, inAir=${f.ball?.inAir}, isLoose=${f.ball?.isLoose}, carrier=${f.players?.find(p=>p.isBallCarrier)?.name || 'none'}`);
            }
        }
    }

    console.log('\n--- Last 10 frames ---');
    for (let i = Math.max(0, vf.length - 10); i < vf.length; i++) {
        const f = vf[i];
        console.log(`Frame ${i}: logIndex=${f.logIndex}, inAir=${f.ball?.inAir}, isLoose=${f.ball?.isLoose}`);
    }
} finally {
    Math.random = origRandom;
}
