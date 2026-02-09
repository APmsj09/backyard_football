import { initializeLeague, getGameState } from './js/game.js';
import { offensivePlaybook } from './js/data.js';

await initializeLeague(() => {});

// List all available plays
console.log('Available offensive plays:\n');
Object.keys(offensivePlaybook).forEach(key => {
    // Show running plays for fumble testing
    if (key.includes('Dive') || key.includes('Sweep') || key.includes('Counter')) {
        console.log(`  ${key}`);
    }
});
