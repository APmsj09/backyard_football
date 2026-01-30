import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStarterAssignments } from '../js/ui_helpers.js';

// Minimal player factory
function makePlayer(id, name, attrs = {}) {
    return {
        id,
        name,
        attributes: {
            physical: { speed: 50, strength: 50, agility: 50, stamina: 50, height: 0, weight: 200 },
            mental: { playbookIQ: 50, clutch: 50, consistency: 50, toughness: 50 },
            technical: { throwingAccuracy: 50, catchingHands: 50, tackling: 50, blocking: 50, blockShedding: 50 },
            ...attrs
        },
        status: { type: 'active', duration: 0 }
    };
}

test('single OL player should be assigned to OL starter', () => {
    const bigJoe = makePlayer(1, 'Big Joe', {
        physical: { strength: 95, speed: 40, agility: 30, stamina: 60, weight: 280 },
        technical: { blocking: 90 }
    });

    const assignments = computeStarterAssignments([bigJoe]);

    // OL should be assigned and show the player
    assert.ok(assignments['OL'], 'OL position should have an assignment');
    assert.equal(assignments['OL'].player.id, 1);
});

test('single OL player should not be assigned to QB starter', () => {
    const bigJoe = makePlayer(1, 'Big Joe', {
        physical: { strength: 95, speed: 40, agility: 30, stamina: 60, weight: 280 },
        technical: { blocking: 90 }
    });

    const assignments = computeStarterAssignments([bigJoe]);

    // QB should be null or assigned to someone else (but with single player we expect QB not to be same)
    if (assignments['QB']) {
        assert.notEqual(assignments['QB'].player.id, 1, 'Big Joe should not be assigned as QB');
    }
});