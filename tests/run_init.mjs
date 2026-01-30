import { initializeLeague, createPlayerTeam, getGameState } from '../js/game.js';

(async () => {
  try {
    await initializeLeague(progress => {
      console.log('Progress:', Math.round(progress * 100) + '%');
    });
    console.log('Initialization succeeded.');

    // Now test creating a player team (simulates UI flow)
    try {
      createPlayerTeam('Sharks');
      const gs = getGameState();
      console.log('createPlayerTeam succeeded. Player team name:', gs.playerTeam?.name);
    } catch (e) {
      console.error('createPlayerTeam failed:', e);
    }

  } catch (e) {
    console.error('Initialization failed:', e);
  }
})();
