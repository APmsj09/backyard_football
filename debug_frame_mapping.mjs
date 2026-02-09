import { initializeLeague, getGameState, resolvePlay } from './js/game.js';

function seededRng(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
    };
}

const rng = seededRng(12345);
Math.random = rng;

await initializeLeague(() => {});
const game = getGameState();
const teams = game.teams.filter(t => t);

const ctx = { gameLog: [], ballOn: 40, down: 1, yardsToGo: 10 };
const res = resolvePlay(teams[0], teams[1], 'Balanced_Slants', 'Cover_2', ctx, {}, true);

const gameLog = ctx.gameLog;
const frames = res.visualizationFrames || [];

console.log('=== DETAILED FRAME &LOG MAPPING ===\n');

// Find frames with log updates
for (let f = 0; f < Math.min(100, frames.length); f++) {
    const frame = frames[f];
    const logIdx = frame.logIndex;
    const msg = gameLog[logIdx];
    
    if (msg) {
        console.log(`Frame ${f}: logIndex=${logIdx}, message='${msg}'`);
    }
}

console.log('\n=== CHECKING FOR MULTIPLE LOG INDICES ===');

// Check if there are frames with same logIndex
const logIndexMap = new Map();
frames.forEach((f, idx) => {
    const li = f.logIndex;
    if (!logIndexMap.has(li)) {
        logIndexMap.set(li, []);
    }
    logIndexMap.get(li).push(idx);
});

for (const [logIdx, frameList] of logIndexMap) {
    if (frameList.length > 1 && logIdx >= 0 && logIdx < gameLog.length) {
        console.log(`LogIndex ${logIdx} appears in frames: ${frameList.join(', ')}`);
        console.log(`  Message: ${gameLog[logIdx]}`);
    }
}
