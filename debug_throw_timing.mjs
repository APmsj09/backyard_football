import { initializeLeague, getGameState, resolvePlay } from './js/game.js';

await initializeLeague(() => {});
const game = getGameState();

const teams = game.teams.filter(t => t);
const off = teams[0];
const def = teams[1];

console.log('\n=== TESTING QB THROW TIMING ===');

const ctx = { gameLog: [], ballOn: 40, down: 1, yardsToGo: 10 };
const res = resolvePlay(off, def, 'Balanced_Slants', 'Cover_2', ctx, {}, true);

const gameLog = ctx.gameLog;
const frames = res.visualizationFrames || [];

// Find which frame the throw happens
let throwFrame = -1;
let throwTick = -1;

for (let f = 0; f < frames.length; f++) {
    // Check if throwInitiated appears in this frame's log
    if (gameLog[frames[f].logIndex] && gameLog[frames[f].logIndex].includes('passes to')) {
        throwFrame = f;
        throwTick = Math.round(f / 20); // Approximate tick (20 frames per tick at 0.05s tickduration)
        break;
    }
}

console.log(`Total frames: ${frames.length}`);
console.log(`Throw frame: ${throwFrame}`);
console.log(`Approximate throw tick: ${throwTick}`);

// Check MIN_DROPBACK_TICKS (should be 45 based on code)
const MIN_DROPBACK_TICKS = 45;
console.log(`\nMIN_DROPBACK_TICKS constant: ${MIN_DROPBACK_TICKS}`);
console.log(`Expected min safe throw tick: ${MIN_DROPBACK_TICKS}`);

if (throwTick >= 0 && throwTick < MIN_DROPBACK_TICKS) {
    console.log(`\n⚠️  QB THREW TOO EARLY!`);
    console.log(`Threw at tick ${throwTick}, but minimum is ${MIN_DROPBACK_TICKS}`);
} else if (throwTick >= 0) {
    console.log(`\n✓ QB throw timing is OK (tick ${throwTick} >= ${MIN_DROPBACK_TICKS})`);
} else {
    console.log(`\n? Could not determine throw timing`);
}

// Show game log
console.log(`\n=== GAME LOG ===`);
gameLog.forEach((msg, idx) => {
    console.log(`${idx}: ${msg}`);
});

// Show frame states around throw time
if (throwFrame >= 0) {
    console.log(`\n=== FRAME STATES AROUND THROW ===`);
    const start = Math.max(0, throwFrame - 2);
    const end = Math.min(frames.length - 1, throwFrame + 2);
    
    for (let f = start; f <= end; f++) {
        console.log(`\nFrame ${f}:`);
        console.log(`  Ball: inAir=${frames[f].ball?.inAir}, x=${frames[f].ball?.x.toFixed(1)}, y=${frames[f].ball?.y.toFixed(1)}`);
        
        const qb = frames[f].players?.find(p => p.slot === 'QB1');
        if (qb) {
            console.log(`  QB: action=${qb.action}, hasBall=${qb.hasBall}, y=${qb.y.toFixed(1)}`);
        }
        
        const receivers = frames[f].players?.filter(p => p.slot.startsWith('WR'));
        if (receivers) {
            receivers.forEach(r => {
                console.log(`  ${r.slot}: action=${r.action}, y=${r.y.toFixed(1)}`);
            });
        }
    }
}

// Look at MIN_DROPBACK_TICKS comment in code
console.log(`\n=== INVESTIGATION ===`);
console.log(`The bug appears to be that canThrowStandard logic is too permissive.`);
console.log(`Even with MIN_DROPBACK_TICKS = 45, the PRIMARY READ can throw earlier if isPressured.`);
console.log(`The condition: const validTiming = canThrowStandard || isPressured; allows early throws under pressure.`);
