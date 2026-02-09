import { initializeLeague, getGameState, resolvePlay, getRosterObjects } from './js/game.js';

async function run() {
  await initializeLeague(()=>{});
  const gs = getGameState();
  let teams = gs.teams.filter(t => t && Array.isArray(t.roster) && t.roster.length > 0);
  if (teams.length < 2) {
    const players = gs.players.filter(p => p).slice(0, 24);
    const teamA = { id: `T-A-${Date.now()}`, name: 'TempA', roster: players.slice(0,12).map(p=>p.id), formations: { offense: 'Balanced', defense: '3-1-3' }, depthChart: { offense: {}, defense: {} } };
    const teamB = { id: `T-B-${Date.now()}`, name: 'TempB', roster: players.slice(12,24).map(p=>p.id), formations: { offense: 'Balanced', defense: '3-1-3' }, depthChart: { offense: {}, defense: {} } };
    gs.teams.push(teamA, teamB);
    teams = [teamA, teamB];
  }
  const offense = teams[0];
  const defense = teams[1];

  const rosterObjs = getRosterObjects(offense);
  const qb = rosterObjs.find(p => p.pos === 'QB') || rosterObjs[0];
  const wr = rosterObjs.find(p => p.pos === 'WR') || rosterObjs.find(p => p.pos === 'RB') || rosterObjs[1];
  qb.attributes.physical = qb.attributes.physical || {};
  qb.attributes.technical = qb.attributes.technical || {};
  qb.attributes.physical.strength = 99; // increases ball speed
  qb.attributes.technical.throwingAccuracy = 95;
  wr.attributes.technical = wr.attributes.technical || {};
  wr.attributes.physical = wr.attributes.physical || {};
  wr.attributes.technical.catchingHands = 99;
  wr.attributes.physical.agility = 99;

  const context = { gameLog: [], ballOn: 20, ballHash: 'M', down: 1, yardsToGo: 10 };

  // Deterministic RNG
  const origRand = Math.random;
  Math.random = () => 0.01;
  const result = resolvePlay(offense, defense, 'Balanced_Smash', 'Cover_2_Zone_3-1-3', context, {}, false);
  Math.random = origRand;

  console.log('\n--- playResult ---');
  console.log(result.playResult);
  console.log('\n--- last 20 logs ---');
  const logs = result.log || [];
  console.log(logs.slice(-20).join('\n'));
  console.log('\n--- visualizationFrames length:', result.visualizationFrames?.length || 0, '---');
  const frames = result.visualizationFrames || [];
  for (let i = Math.max(0, frames.length - 8); i < frames.length; i++) {
    console.log('frame', i, 'logIndex', frames[i].logIndex, 'ball', frames[i].ball);
  }
}

run().catch(e=>{ console.error(e); process.exit(1); });
