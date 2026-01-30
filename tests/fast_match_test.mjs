import { initializeLeague, getGameState, simulateMatchFast } from '../js/game.js';

(async () => {
  await initializeLeague(()=>{});
  const gs = getGameState();
  const teams = gs.teams.filter(t => t && t.roster && t.roster.length > 0 && t.name);
  if (teams.length < 2) { console.error('Not enough teams to simulate a match.'); process.exit(1); }
  const home = teams[0];
  const away = teams[1];

  console.log('Simulating a quick match between:', home?.name || home?.id, 'vs', away?.name || away?.id);
  const res = simulateMatchFast(home, away);

  console.log('Simulation done. Sample logs (last 10):');
  console.log(res.gameLog.slice(-10).join('\n'));

  // Basic sanity checks: ensure stats were applied
  const anyInt = [...home.roster, ...away.roster].map(id => id).slice(0,5);
  console.log('Sample player IDs from rosters:', anyInt.slice(0,5));
})();