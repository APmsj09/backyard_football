import { initializeLeague, getGameState, resolvePlay } from './js/game.js';

// Use seeded RNG to find fumbles
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

console.log('\nSearching for fumble scenarios...\n');

while (!fumbleFound && searchSeed < 10050) {
    const rng = seededRng(searchSeed);
    Math.random = rng;
    
    try {
        // Quick init
        if (searchSeed === 10000) {
            await initializeLeague(() => {});
        }
        
        const game = getGameState();
        const teams = game.teams.filter(t => t);
        
        if (teams.length < 2) {
            console.log(`Seed ${searchSeed}: Not enough teams`);
            searchSeed++;
            continue;
        }
        
        const off = teams[0];
        const def = teams[1];
        
        // Run a running play to trigger fumbles if tackled
        const ctx = { gameLog: [], ballOn: 50, down: 1, yardsToGo: 10 };
        const res = resolvePlay(off, def, 'Power_Off_Tackle_Left', 'Balanced_Front_Four', ctx, {}, false);
        
        const gameLog = ctx.gameLog;
        const hasFumble = gameLog.some(m => m.includes('FUMBLE'));
        
        if (hasFumble) {
            console.log(`\n✓ FOUND FUMBLE AT SEED ${searchSeed}`);
            console.log(`\nGame Log:`);
            gameLog.forEach((m, i) => console.log(`  ${i}: ${m}`));
            fumbleFound = true;
        }
        
        searchSeed++;
    } catch (e) {
        console.log(`Seed ${searchSeed}: ERROR - ${e.message.substring(0, 50)}`);
        searchSeed++;
    }
}

Math.random = originalRandom;

if (!fumbleFound) {
    console.log('\nNo fumbles found in range 10000-10049');
} else {
    console.log('\nNow let\'s test if the fumble breaks subsequent plays...');
}
