import { initializeLeague } from '../js/game.js';

(async () => {
  try {
    await initializeLeague(progress => {
      console.log('Progress:', Math.round(progress * 100) + '%');
    });
    console.log('Initialization succeeded.');
  } catch (e) {
    console.error('Initialization failed:', e);
  }
})();
