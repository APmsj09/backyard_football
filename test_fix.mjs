import { initializeLeague, getGameState, resolvePlay } from './js/game.js';

await initializeLeague(() => {});
const game = getGameState();

const teams = game.teams.filter(t => t);
const off = teams[0];
const def = teams[1];

// Run multiple pass plays to potentially trigger scrambling
for (let i = 0; i < 5; i++) {
    console.log(`\n=== PLAY ${i + 1} ===`);
    const ctx = { gameLog: [], ballOn: 35, down: 1, yardsToGo: 10 };
    const res = resolvePlay(off, def, 'Balanced_Slants', 'Balanced_Nickel', ctx, {}, false);
    
    const scrambleCount = ctx.gameLog.filter(m => m.includes('scrambles after crossing')).length;
    const sackCount = ctx.gameLog.filter(m => m.includes('sacked after crossing')).length;
    
    console.log(`Scramble messages: ${scrambleCount}`);
    console.log(`Sack messages: ${sackCount}`);
    
    if (scrambleCount > 0 || sackCount > 0) {
        console.log('Messages:');
        ctx.gameLog
            .filter(m => m.includes('scramble') || m.includes('crossing') || m.includes('sacked'))
            .forEach(m => console.log('  ' + m));
    }
}
