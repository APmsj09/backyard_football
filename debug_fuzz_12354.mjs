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

// Replay seed 12354
const targetSeed = 12354;
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

    console.log(`\nReplaying seed ${targetSeed} with offKey=${offKey}, defKey=${defKey}`);

    const ctx = { gameLog: [], ballOn: 35, down: 1, yardsToGo: 10 };
    const res = resolvePlay(off, def, offKey, defKey, ctx, {}, true);

    const logs = res.log || [];
    const vf = res.visualizationFrames || [];

    console.log(`Result outcome: ${res.playResult?.outcome}`);
    console.log(`Total logs: ${logs.length}`);
    console.log(`Total frames: ${vf.length}`);

    console.log('\n--- All logs ---');
    for (let i = 0; i < logs.length; i++) {
        console.log(`${i}: ${logs[i]}`);
    }

    console.log('\n--- Find all CATCH frames ---');
    for (let i = 0; i < logs.length; i++) {
        if (/CATCH|INTERCEPTION/i.test(logs[i])) {
            console.log(`\nLog ${i}: "${logs[i]}"`);
            // Find frames with logIndex >= i and not in air
            const frameIdx = vf.findIndex(f => f.logIndex >= i && f.ball && !f.ball.inAir);
            if (frameIdx >= 0) {
                const f = vf[frameIdx];
                console.log(`  ✓ Found secure frame at vf[${frameIdx}]: logIndex=${f.logIndex}, inAir=${f.ball?.inAir}, isLoose=${f.ball?.isLoose}`);
            } else {
                console.log(`  ✗ No secure frame found`);
                // Show frames around logIndex i
                console.log(`  Frames near logIndex ${i}:`);
                let shown = 0;
                for (let j = 0; j < vf.length && shown < 5; j++) {
                    if (vf[j].logIndex >= i && vf[j].logIndex <= i+2) {
                        console.log(`    vf[${j}]: logIndex=${vf[j].logIndex}, inAir=${vf[j].ball?.inAir}, isLoose=${vf[j].ball?.isLoose}`);
                        shown++;
                    }
                }
            }
        }
    }
} finally {
    Math.random = origRandom;
}
