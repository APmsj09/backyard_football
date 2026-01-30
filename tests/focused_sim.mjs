import { initializeLeague, getGameState, resolvePlay } from '../js/game.js';

(async () => {
    console.log('Initializing deterministic sim...');
    await initializeLeague(() => {});
    const game = getGameState();
    const offense = game.teams[0];
    const defense = game.teams[1];

    const context = { gameLog: [], ballOn: 35, down: 1, yardsToGo: 10 };

    const originalRandom = Math.random;

    try {
        // 1) High randomness => force swats/drops
        Math.random = () => 0.99;
        console.log('\n=== High RNG run (simulate swats/drops) ===');
        let res1 = resolvePlay(offense, defense, 'Balanced_Slants', 'Cover_2', context, {}, true);
        console.log('Outcome:', res1.playResult.outcome, 'Yards:', res1.playResult.yards);
        console.log('Log:');
        res1.log.forEach((l, idx) => console.log(idx, l));

        // Show last few visualization frames (ball positions)
        const frames1 = res1.visualizationFrames || [];
        console.log('Visualization frames:', frames1.length);
        if (frames1.length > 0) {
            console.log('Last frame ball:', frames1[frames1.length - 1].ball);
        }

        // 2) Low randomness => force catches
        Math.random = () => 0.01;
        context.gameLog = []; // new log
        console.log('\n=== Low RNG run (force catches) ===');
        let res2 = resolvePlay(offense, defense, 'Balanced_Slants', 'Cover_2', context, {}, true);
        console.log('Outcome:', res2.playResult.outcome, 'Yards:', res2.playResult.yards);
        console.log('Log:');
        res2.log.forEach((l, idx) => console.log(idx, l));
        const frames2 = res2.visualizationFrames || [];
        console.log('Visualization frames:', frames2.length);
        if (frames2.length > 0) {
            // Find first frame where a catch is logged and show nearest frame
            const catchIndex = res2.log.findIndex(m => /CATCH|INTERCEPTION/i.test(m));
            const showIdx = Math.max(0, Math.min(frames2.length - 1, Math.floor(frames2.length * 0.5)));
            console.log('Sample frame near catch (index approx):', showIdx, frames2[showIdx].ball);
        }

        // 3) Mixed sequence: try to force drop then interception by toggling RNG mid-play
        // We do this by overriding Math.random with a generator that yields a sequence
        let seq = [0.99, 0.99, 0.01, 0.01, 0.01]; // early drops, then an interception
        let i = 0;
        Math.random = () => seq[Math.min(i++, seq.length - 1)];
        context.gameLog = [];
        console.log('\n=== Mixed RNG run (drop then interception attempt) ===');
        let res3 = resolvePlay(offense, defense, 'Balanced_Slants', 'Cover_2', context, {}, true);
        console.log('Outcome:', res3.playResult.outcome, 'Yards:', res3.playResult.yards);
        console.log('Log:');
        res3.log.forEach((l, idx) => console.log(idx, l));
        const frames3 = res3.visualizationFrames || [];
        console.log('Visualization frames:', frames3.length);
        if (frames3.length > 0) console.log('Last ball frame:', frames3[frames3.length - 1].ball);

    } finally {
        Math.random = originalRandom;
    }
})();