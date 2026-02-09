import { initializeLeague, getGameState, resolvePlay } from './js/game.js';

await initializeLeague(() => {});
const game = getGameState();

const teams = game.teams.filter(t => t);
const off = teams[0];
const def = teams[1];

console.log('\n=== TESTING INSTANT THROW BUG ===');

// Run a pass play and check the logs
const ctx = { gameLog: [], ballOn: 35, down: 1, yardsToGo: 10 };
const res = resolvePlay(off, def, 'Balanced_Slants', 'Cover_2', ctx, {}, true);

const logs = res.log || [];

// Check what happens in first 20 ticks
console.log('\n--- First 20 ticks of play log ---');
logs.slice(0, 20).forEach((msg, idx) => {
    console.log(`${idx}: ${msg}`);
});

// Look for throw or snaps
const throwLog = logs.filter(m => m.includes('passes to') || m.includes('throws'));
const snapLog = logs.filter(m => m.includes('snap'));
const routeLog = logs.filter(m => m.includes('route'));

console.log(`\n--- Summary ---`);
console.log(`Total logs: ${logs.length}`);
console.log(`Throws/passes: ${throwLog.length}`);
console.log(`Snap messages: ${snapLog.length}`);
console.log(`Route messages: ${routeLog.length}`);

if (throwLog.length > 0) {
    console.log('\nFirst few throws:');
    throwLog.slice(0, 3).forEach(m => console.log(`  ${m}`));
}

// Check frames to understand timing
const frames = res.visualizationFrames || [];
console.log(`\nTotal frames: ${frames.length}`);

// Find when ball becomes in air
let ballInAirFrame = null;
for (let i = 0; i < frames.length; i++) {
    if (frames[i].ballState && frames[i].ballState.inAir) {
        ballInAirFrame = i;
        break;
    }
}

if (ballInAirFrame !== null) {
    console.log(`\nBall thrown at frame: ${ballInAirFrame} (tick ${Math.floor(ballInAirFrame / 20)})`);
    
    // Check what routes were established
    const frame = frames[ballInAirFrame];
    console.log(`Players at throw time:`);
    if (frame.players) {
        frame.players.forEach(p => {
            console.log(`  ${p.name}: action=${p.action}, slot=${p.slot}`);
        });
    }
}

// Check for fumbles
const fumbleLog = logs.filter(m => m.includes('FUMBLE'));
console.log(`\n--- Fumbles ---`);
console.log(`Total fumbles: ${fumbleLog.length}`);
if (fumbleLog.length > 0) {
    fumbleLog.forEach(m => console.log(`  ${m}`));
}
