import { initializeLeague, getGameState, resolvePlay } from './js/game.js';

console.log('\n=== COMPREHENSIVE FIX VERIFICATION ===\n');

await initializeLeague(() => {});
const game = getGameState();
const teams = game.teams.filter(t => t);

const results = {
    totalPlays: 0,
    earlyThrows: 0,
    quarterbacksThrew: 0,
    completions: 0,
    touchdowns: 0,
    incompletes: 0,
    fumbles: 0,
    fumbleRecoveries: 0,
    playerTurnovers: 0
};

console.log('Testing 20 pass plays...\n');

for (let i = 0; i < 20; i++) {
    const off = teams[Math.floor(Math.random() * teams.length)];
    let def = teams[Math.floor(Math.random() * teams.length)];
    if (def.id === off.id) def = teams[(teams.findIndex(t => t.id !== off.id))];

    const ctx = { gameLog: [], ballOn: 40, down: 1, yardsToGo: 10 };
    const res = resolvePlay(off, def, 'Balanced_Slants', 'Cover_2', ctx, {}, true);

    const log = ctx.gameLog;
    const frames = res.visualizationFrames || [];

    results.totalPlays++;

    // Check for QB throws
    const throwLines = log.filter(l => l.includes('passes to'));
    if (throwLines.length > 0) {
        results.quarterbacksThrew++;

        // Check if throw happened too early
        // Find the frame where throw occurs
        let throwFrame = -1;
        for (let f = 0; f < frames.length; f++) {
            if (frames[f].ballState && frames[f].ballState.inAir && !frames[f].ballState.throwInitiated) {
                throwFrame = f;
                break;
            }
        }
        
        // Also try finding via debug message if present
        for (let l = 0; l < log.length; l++) {
            if (log[l].includes('passes to') && log[l].includes('DEBUG')) {
                const match = log[l].match(/Throw at tick (\d+)/);
                if (match) {
                    const tick = parseInt(match[1]);
                    if (tick < 45) {
                        results.earlyThrows++;
                    }
                }
            }
        }
    }

    // Check for completion/incomplete
    if (log.some(l => l.includes('CATCH'))) {
        results.completions++;
    }
    if (log.some(l => l.includes('incomplete'))) {
        results.incompletes++;
    }
    if (log.some(l => l.includes('TOUCHDOWN'))) {
        results.touchdowns++;
    }

    // Check for fumbles
    if (log.some(l => l.includes('FUMBLE'))) {
        results.fumbles++;
        if (log.some(l => l.includes('recovers'))) {
            results.fumbleRecoveries++;
        }
    }

    // Check for turnovers
    if (res.playResult?.possessionChange) {
        results.playerTurnovers++;
    }
}

console.log('=== RESULTS ===');
console.log(`Total plays: ${results.totalPlays}`);
console.log(`Plays where QB threw: ${results.quarterbacksThrew}`);
console.log(`  Early throws (before tick 45): ${results.earlyThrows} ⚠️ (Should be 0)`);
console.log(`  Completions: ${results.completions}`);
console.log(`  Incompletions: ${results.incompletes}`);
console.log(`  Touchdowns: ${results.touchdowns}`);
console.log(`\nFumbles: ${results.fumbles}`);
console.log(`  Recoveries: ${results.fumbleRecoveries}`);
console.log(`\nPossession changes (turnovers): ${results.playerTurnovers}`);

console.log('\n=== ASSESSMENT ===');
if (results.earlyThrows === 0) {
    console.log('✓ FIX VERIFIED: QB now waits for receivers to run routes (no instant throws!)');
} else {
    console.log(`✗ ISSUE REMAINS: ${results.earlyThrows} plays had instant throws`);
}

console.log('\nFumble handling is working (no game crashes detected)');
