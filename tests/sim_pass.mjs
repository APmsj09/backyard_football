import { initializeLeague, createPlayerTeam, getGameState, resolvePlay } from '../js/game.js';

(async () => {
  await initializeLeague(()=>{});
  createPlayerTeam('Testers');
  const gs = getGameState();
  const playerTeam = gs.playerTeam;
  const opponent = gs.teams.find(t => t.id !== playerTeam.id);

  const context = { gameLog: [], ballOn: 20, ballHash: 'M', down: 1, yardsToGo: 10 };
  const offKey = 'Balanced_Slants';
  const defKey = 'Cover_2_Zone_3-1-3';

  const result = resolvePlay(playerTeam, opponent, offKey, defKey, context, {}, false);

  console.log('Play Result:', result.playResult.outcome, 'Yards:', result.playResult.yards);
  console.log('Log excerpt:');
  console.log(result.log.slice(-12).join('\n'));
})();