import { initializeLeague, getGameState, resolvePlay } from './js/game.js';

// Use fixed seed for reproducibility
function seededRng(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
    };
}

const SEED = 12345;
const rng = seededRng(SEED);

// Override Math.random
const originalRandom = Math.random;
Math.random = rng;

try {
    await initializeLeague(() => {});
    const game = getGameState();

    const teams = game.teams.filter(t => t);
    const off = teams[0];
    const def = teams[1];

    console.log(`\n=== TESTING QB THROW TIMING (SEED=${SEED}) ===`);

    const ctx = { gameLog: [], ballOn: 40, down: 1, yardsToGo: 10 };
    const res = resolvePlay(off, def, 'Balanced_Slants', 'Cover_2', ctx, {}, true);

    const gameLog = ctx.gameLog;
    const frames = res.visualizationFrames || [];

    // Find when QB throws by checking logs
    let throwTick = -1;
    let throwLogIdx = -1;
    
    for (let i = 0; i < gameLog.length; i++) {
        if (gameLog[i].includes('passes to') || gameLog[i].includes('throws')) {
            throwLogIdx = i;
            
            // Find frame index that contains this log
            for (let f = 0; f < frames.length; f++) {
                if (frames[f].logIndex === i) {
                    const approxTick = Math.round(f / 20); // Rough conversion
                    throwTick = approxTick;
                    break;
                }
            }
            break;
        }
    }

    console.log(`Total frames: ${frames.length}`);
    console.log(`Throw log index: ${throwLogIdx}`);
    console.log(`Throw message: ${throwLogIdx >= 0 ? gameLog[throwLogIdx] : 'NO THROW'}`);
    console.log(`Approximate throw frame: ${throwLogIdx >= 0 ? frames.findIndex(f => f.logIndex === throwLogIdx) : 'N/A'}`);

    const MIN_DROPBACK_TICKS = 45;
    console.log(`\nMIN_DROPBACK_TICKS: ${MIN_DROPBACK_TICKS}`);

    // Show game log
    console.log(`\n=== GAME LOG (first 10 entries) ===`);
    gameLog.slice(0, 10).forEach((msg, idx) => {
        console.log(`${idx}: ${msg}`);
    });

    // Find frame 0 and check formations
    if (frames[0]) {
        console.log(`\n=== FRAME 0 (PRE-SNAP) ===`);
        if (frames[0].players) {
            frames[0].players.forEach(p => {
                if (p.slot.startsWith('QB') || p.slot.startsWith('WR') || p.slot.startsWith('TE') || p.slot.startsWith('RB')) {
                    console.log(`  ${p.slot}: ${p.name}, action=${p.action}, y=${p.y.toFixed(1)}, LOS=${frames[0].lineOfScrimmage.toFixed(1)}`);
                }
            });
        }
    }

    // Check frames where receiver routes start
    console.log(`\n=== RECEIVER ROUTE START ===`);
    for (let f = 0; f < Math.min(100, frames.length); f++) {
        if (!frames[f].players) continue;
        const firstRoute = frames[f].players.find(p => p.action === 'run_route');
        if (firstRoute) {
            console.log(`First receiver (${firstRoute.slot}) starts running route at frame ${f}`);
            break;
        }
    }

} finally {
    Math.random = originalRandom;
}
