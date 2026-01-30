import { defenseFormations, defensivePlaybook } from '../js/data.js';

const defs = Object.keys(defenseFormations);
const used = new Set();
Object.values(defensivePlaybook).forEach(play => {
    if (Array.isArray(play.compatibleFormations)) play.compatibleFormations.forEach(f => used.add(f));
});
const missing = [...used].filter(f => !defs.includes(f));
console.log('defs:', defs);
console.log('used:', [...used]);
console.log('missing:', missing);
