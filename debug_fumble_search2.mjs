import { initializeLeague, getGameState, resolvePlay } from './js/game.js';

function seededRng(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
    };
}

const originalRandom = Math.random;

let fumbleFound = false;
let searchSeed = 10000;

console.log('\nSearching for fumble scenarios with Power_Counter...\n');

while (!fumbleFound && searchSeed < 10100) {
    const rng = seededRng(searchSeed);
    Math.random = rng;
    
    try {
        if (searchSeed === 10000) {
            await initializeLeague(() => {});
        }
        
        const game = getGameState();
        const teams = game.teams.filter(t => t);
        
        if (teams.length < 2) {
            searchSeed++;
            continue;
        }
        
        const off = teams[0];
        const def = teams[1];
        
        // Run a running play to trigger fumbles if tackled
        const ctx = { gameLog: [], ballOn: 50, down: 1, yardsToGo: 10 };
        const res = resolvePlay(off, def, 'Power_Counter', 'Balanced_Front_Four', ctx, {}, false);
        
        const gameLog = ctx.gameLog;
        const hasFumble = gameLog.some(m => m.includes('FUMBLE'));
        
        if (hasFumble) {
            console.log(`\n✓ FOUND FUMBLE AT SEED ${searchSeed}`);
            console.log(`\nGame Log:`);
            gameLog.forEach((m, i) => console.log(`  ${i}: ${m}`));
            fumbleFound = true;
            break;
        }
        
        if (searchSeed % 10 === 0) {
            console.log(`Seed ${searchSeed}: No fumble`);
        }
        
        searchSeed++;
    } catch (e) {
        searchSeed++;
    }
}

Math.random = originalRandom;

if (!fumbleFound) {
    console.log('\nNo fumbles found in range 10000-10099');
} else {
    console.log('\nTesting complete!');
}
