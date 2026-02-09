import { initializeLeague, getGameState, resolvePlay } from './js/game.js';

// Patch resolvePlay to add debugging
const origConsoleLog = console.log;
const logs = [];

const originalResolvePlay = resolvePlay;

await initializeLeague(() => {});
const game = getGameState();

// Now let's trace through what happens during a play

const teams = game.teams.filter(t => t);
const off = teams[0];
const def = teams[1];

console.log('\n=== DETAILED PLAY TRACE ===');
console.log(`Offense: ${off.name}`);
console.log(`Defense: ${def.name}`);

// Create context with tracking
const ctx = { gameLog: [], ballOn: 40, down: 1, yardsToGo: 10 };

console.log('\nRunning Balanced_Slants pass play...\n');

const res = resolvePlay(off, def, 'Balanced_Slants', 'Cover_2', ctx, {}, true);

const gameLog = ctx.gameLog;
const frames = res.visualizationFrames || [];

console.log(`\n=== RESULTS ===`);
console.log(`Play outcome: ${res.playResult?.outcome}`);
console.log(`Total gameLog entries: ${gameLog.length}`);
console.log(`Total frames: ${frames.length}`);

console.log(`\n=== GAME LOG (all entries) ===`);
gameLog.forEach((msg, idx) => {
    console.log(`${idx}: ${msg}`);
});

// Check frame data to understand what happened
console.log(`\n=== FRAME ANALYSIS ===`);

// Frame 0 - snap
if (frames[0]) {
    console.log('\nFrame 0 (pre-snap):');
    if (frames[0].players) {
        frames[0].players.forEach(p => {
            console.log(`  ${p.slot}: ${p.name}, action=${p.action}, x=${p.x.toFixed(1)}, y=${p.y.toFixed(1)}`);
        });
    }
}

// Find first frame where QB throws
let throwFrame = -1;
for (let i = 0; i < frames.length; i++) {
    if (frames[i].ballState && frames[i].ballState.inAir) {
        throwFrame = i;
        break;
    }
}

if (throwFrame >= 0) {
    console.log(`\nBall becomes in-air at frame ${throwFrame}`);
    console.log(`Tick would be approximately: ${throwFrame / 20}`);
    
    // Show players at throw time
    if (frames[throwFrame].players) {
        console.log('Players at throw time:');
        frames[throwFrame].players.forEach(p => {
            console.log(`  ${p.slot}: action=${p.action}, y=${p.y.toFixed(1)}`);
        });
    }
} else {
    console.log('\nBall NEVER became in-air!');
    
    // Check where QB is
    const lastQBPos = frames[Math.max(0, frames.length - 1)];
    if (lastQBPos && lastQBPos.players) {
        const qb = lastQBPos.players.find(p => p.slot === 'QB1');
        if (qb) {
            console.log(`QB position at end: x=${qb.x.toFixed(1)}, y=${qb.y.toFixed(1)}`);
            console.log(`QB action: ${qb.action}`);
        }
    }
}

// Check for fumbles
const fumbleCount = gameLog.filter(m => m.includes('FUMBLE')).length;
console.log(`\n=== FUMBLES ===`);
console.log(`Total fumbles: ${fumbleCount}`);
if (fumbleCount > 0) {
    gameLog.filter(m => m.includes('FUMBLE')).forEach(m => console.log(`  ${m}`));
}
