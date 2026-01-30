import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeLeague, createPlayerTeam, getGameState, resolvePlay, getRosterObjects } from '../js/game.js';

// Utility to force deterministic randomness during a block
function withFixedRandom(fn, value = 0.01) {
  const orig = Math.random;
  Math.random = () => value;
  try {
    return fn();
  } finally {
    Math.random = orig;
  }
}

// Test 1: Open WR should receive pass in Balanced_Slants
test('open WR should receive pass in Balanced_Slants', async () => {
  await initializeLeague(()=>{});
  const gs = getGameState();
  let teams = gs.teams.filter(t => t && Array.isArray(t.roster) && t.roster.length > 0);
  // If generator didn't create enough full teams, make two temporary teams using generated players
  if (teams.length < 2) {
    const players = gs.players.filter(p => p).slice(0, 24);
    const teamA = { id: `T-A-${Date.now()}`, name: 'TempA', roster: players.slice(0,12).map(p=>p.id), formations: { offense: 'Balanced', defense: '3-1-3' }, depthChart: { offense: {}, defense: {} } };
    const teamB = { id: `T-B-${Date.now()}`, name: 'TempB', roster: players.slice(12,24).map(p=>p.id), formations: { offense: 'Balanced', defense: '3-1-3' }, depthChart: { offense: {}, defense: {} } };
    gs.teams.push(teamA, teamB);
    teams = [teamA, teamB];
  }
  const offense = teams[0];
  const defense = teams[1];

  // Make sure our QB & target WR are very good to make outcomes deterministic
  const rosterObjs = getRosterObjects(offense);
  const qb = rosterObjs.find(p => p.pos === 'QB') || rosterObjs[0];
  const wr = rosterObjs.find(p => p.pos === 'WR') || rosterObjs.find(p => p.pos === 'RB') || rosterObjs[1];
  qb.attributes.technical = qb.attributes.technical || {};
  qb.attributes.physical = qb.attributes.physical || {};
  qb.attributes.technical.throwingAccuracy = 99;
  qb.attributes.physical.strength = 90; // increases speed somewhat
  if (!wr) throw new Error('No WR found in roster to test');
  wr.attributes.technical = wr.attributes.technical || {};
  wr.attributes.physical = wr.attributes.physical || {};
  wr.attributes.technical.catchingHands = 99;
  wr.attributes.physical.agility = 99;

  // Run the play deterministically
  const context = { gameLog: [], ballOn: 20, ballHash: 'M', down: 1, yardsToGo: 10 };

  const result = withFixedRandom(() => resolvePlay(offense, defense, 'Balanced_Slants', 'Cover_2_Zone_3-1-3', context, {}, false));

  assert.ok(result && result.playResult, 'No result returned');
  assert.notStrictEqual(result.playResult.outcome, 'error');
  // We expect either a complete or a turnover depending on defensive surprises, but it should NOT be 'incomplete' where the ball skips over receiver
  assert.notStrictEqual(result.playResult.outcome, 'incomplete', 'Pass unexpectedly incomplete');
});

// Test 2: Very fast throw should still be catchable (segment collision check)
test('fast throw should be catchable even if ball moves a large segment per tick', async () => {
  await initializeLeague(()=>{});
  const gs = getGameState();
  let teams = gs.teams.filter(t => t && Array.isArray(t.roster) && t.roster.length > 0);
  // If generator didn't create enough full teams, make two temporary teams using generated players
  if (teams.length < 2) {
    const players = gs.players.filter(p => p).slice(0, 24);
    const teamA = { id: `T-A-${Date.now()}`, name: 'TempA', roster: players.slice(0,12).map(p=>p.id), formations: { offense: 'Balanced', defense: '3-1-3' }, depthChart: { offense: {}, defense: {} } };
    const teamB = { id: `T-B-${Date.now()}`, name: 'TempB', roster: players.slice(12,24).map(p=>p.id), formations: { offense: 'Balanced', defense: '3-1-3' }, depthChart: { offense: {}, defense: {} } };
    gs.teams.push(teamA, teamB);
    teams = [teamA, teamB];
  }
  const offense = teams[0];
  const defense = teams[1];

  // Harden a specific WR and give QB high strength to create a fast throw
  const rosterObjs = getRosterObjects(offense);
  const qb = rosterObjs.find(p => p.pos === 'QB') || rosterObjs[0];
  const wr = rosterObjs.find(p => p.pos === 'WR') || rosterObjs.find(p => p.pos === 'RB') || rosterObjs[1];
  qb.attributes.physical = qb.attributes.physical || {};
  qb.attributes.technical = qb.attributes.technical || {};
  qb.attributes.physical.strength = 99; // increases ball speed
  qb.attributes.technical.throwingAccuracy = 95;
  if (!wr) throw new Error('No WR found in roster to test');
  wr.attributes.technical = wr.attributes.technical || {};
  wr.attributes.physical = wr.attributes.physical || {};
  wr.attributes.technical.catchingHands = 99;
  wr.attributes.physical.agility = 99;

  const context = { gameLog: [], ballOn: 20, ballHash: 'M', down: 1, yardsToGo: 10 };

  const result = withFixedRandom(() => resolvePlay(offense, defense, 'Balanced_Smash', 'Cover_2_Zone_3-1-3', context, {}, false));

  assert.ok(result && result.playResult, 'No result returned');
  // Should not be incomplete due to skipping over the receiver
  assert.notStrictEqual(result.playResult.outcome, 'incomplete', 'Fast throw skipped receiver and became incomplete');
});
