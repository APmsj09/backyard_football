import { computeStarterAssignments } from '../js/ui_helpers.js';

const bigJoe = {
    id:1,
    name:'Big Joe',
    attributes: {
        physical: { speed: 40, strength: 95, agility: 30, stamina: 60, weight: 280 },
        mental: { playbookIQ: 50, clutch: 50, consistency: 50, toughness: 50 },
        technical: { blocking: 90 }
    },
    status: { type: 'active', duration: 0 }
};

const assignments = computeStarterAssignments([bigJoe]);
console.log(assignments);
