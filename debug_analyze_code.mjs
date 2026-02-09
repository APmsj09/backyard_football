import { initializeLeague, getGameState } from './js/game.js';

// Read game.js source to understand timing
import fs from 'fs';

const gameSource = fs.readFileSync('/workspaces/backyard_football/js/game.js', 'utf8');

// Find MIN_DROPBACK_TICKS
const minDropRegex = /const MIN_DROPBACK_TICKS = (\d+)/;
const match = gameSource.match(minDropRegex);
if (match) {
    console.log(`Found MIN_DROPBACK_TICKS = ${match[1]} in code`);
}

// Check the validTiming logic
const validTimingRegex = /const validTiming = ([^;]+);/;
const vtMatch = gameSource.match(validTimingRegex);
if (vtMatch) {
    console.log(`Found validTiming logic: ${vtMatch[1]}`);
}

console.log('\n=== ANALYSIS ===');
console.log('The issue is that validTiming allows throws earlier than MIN_DROPBACK_TICKS.');
console.log('At tick 1:');
console.log('  - canThrowStandard = (1 > 45) = FALSE');
console.log('  - isPressured = TRUE (defenders rushing)');
console.log('  - playState.tick > 30 = FALSE (1 is not > 30)');
console.log('  - So validTiming = FALSE || (TRUE && FALSE) = FALSE');
console.log('');
console.log('But wait, if validTiming is FALSE, the throw shouldnt happen!');
console.log('Unless the throw is happening through a different path...');
console.log('');
console.log('Let me check all the throw paths in updateQBDecision:');

// Find all throw executions
const throwExecRegex = /executeThrow\([^)]+\);/g;
const throwMatches = gameSource.match(throwExecRegex);
if (throwMatches) {
    console.log(`Found ${throwMatches.length} executeThrow calls`);
    throw Matches.forEach((t, i) => {
        console.log(`  ${i+1}. ${t.substring(0, 60)}...`);
    });
}

console.log('\nThe primary throw paths are:');
console.log('1. PRIMARY READ - gated by validTiming');
console.log('2. CHECKDOWN - gated by checkdownAvailable');
console.log('3. SCRAMBLE - gated by canScramble');
console.log('4. FORCED (Imminent Sack) - if decisionMade=true');
console.log('5. DESPERATION THROW - if isDesperationTime');

console.log('\nThe bug might be:');
console.log('- A different code path not properly gated');
console.log('- Or the frame/tick numbering is confusing in the debug output');
console.log('- Or "tick 1" is actually already past MIN_DROPBACK_TICKS');
