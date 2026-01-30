import assert from 'node:assert/strict';
import { formationMatchesCriteria, isPlayCompatibleWithDefense } from '../js/game.js';
import { defenseFormations, defensivePlaybook } from '../js/data.js';

console.log('Running defensive playbook compatibility tests...');

// Test: formationMatchesCriteria should match a 4-1-3 formation for its criteria
assert(formationMatchesCriteria(defenseFormations['4-1-3'], { minDL: 4, minLB: 1, minDB: 2 }) === true, '4-1-3 should meet {minDL:4,minLB:1,minDB:2}');

// Test: play with criteria is compatible
assert(isPlayCompatibleWithDefense(defensivePlaybook['Cover_2_Zone_4-1-2'], '4-1-3') === true, 'Cover_2_Zone_4-1-2 should be compatible with 4-1-3');

// Test: play that requires heavy front should NOT be compatible with a 3-1-4
assert(isPlayCompatibleWithDefense(defensivePlaybook['Cover_0_Blitz_4-2-1'], '3-1-4') === false, 'Cover_0_Blitz_4-2-1 should NOT be compatible with 3-1-4');

// Test: formation-key based compatibility updated to map to 8v8 equivalents
assert(isPlayCompatibleWithDefense(defensivePlaybook['Cover_1_Man_3-1-3'], '3-1-4') === true, 'Cover_1_Man_3-1-3 should be compatible with 3-1-4');

console.log('All defensive playbook tests passed ✅');
