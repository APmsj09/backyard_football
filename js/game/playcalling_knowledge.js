/**
 * Backyard Football GM — Playcalling Knowledge Catalog
 *
 * This file is deliberately separate from data.js. data.js defines what a play
 * does; this file describes the tactical situations where it is useful, what
 * it tends to beat or struggle against, and which player groups matter most.
 *
 * The catalog is descriptive data only. It does not alter play execution,
 * formations, assignments, or player movement.
 */

export const PLAYCALL_KNOWLEDGE_VERSION = 1;

// Keep situation buckets broad so tendency counts remain useful and compact.
export const PLAYCALL_SITUATION_GROUPS = Object.freeze([
    'earlyDown',
    'shortYardage',
    'passingDown',
    'goalLine',
    'redZone',
    'backedUp',
    'protectLead',
    'trailingLate'
]);

// Shared concept names are used to compare play knowledge and learned opponent
// tendencies. These are tendencies, not guaranteed outcomes.
const OFFENSE_PROFILES = {
    insideRun: {
        label: 'Inside run',
        situations: { earlyDown: 2, shortYardage: 3, goalLine: 3, backedUp: 2 },
        attacks: ['lightBox', 'spreadDefense'],
        vulnerableTo: ['heavyBox', 'disciplinedRunFit'],
        strengths: ['Gets downhill quickly', 'Useful for manageable yardage', 'Can punish light boxes'],
        weaknesses: ['Less effective into a crowded interior', 'Limited explosive potential without a crease'],
        keyPositions: ['RB', 'OL'],
        supportingPositions: ['TE', 'FB'],
        skillPriorities: { RB: ['vision', 'strength', 'acceleration'], OL: ['blocking', 'strength'] }
    },
    outsideRun: {
        label: 'Outside run',
        situations: { earlyDown: 2, shortYardage: 1, backedUp: 1 },
        attacks: ['interiorOverload', 'slowFront'],
        vulnerableTo: ['edgeContain', 'fastPursuit', 'disciplinedRunFit'],
        strengths: ['Stretches the defense horizontally', 'Can punish interior-heavy fronts'],
        weaknesses: ['Needs space and sound blocking angles', 'Can lose yards against fast edge contain'],
        keyPositions: ['RB', 'OL'],
        supportingPositions: ['TE', 'FB', 'WR'],
        skillPriorities: { RB: ['speed', 'agility', 'acceleration'], OL: ['blocking', 'agility'] }
    },
    powerRun: {
        label: 'Power run',
        situations: { shortYardage: 3, goalLine: 3, earlyDown: 2 },
        attacks: ['lightBox', 'softEdge'],
        vulnerableTo: ['heavyBox', 'runBlitz', 'disciplinedRunFit'],
        strengths: ['Creates a defined point of attack', 'Fits short-yardage football', 'Benefits from extra blockers'],
        weaknesses: ['Can run into a loaded front', 'Less flexible when the defense wins the point of attack'],
        keyPositions: ['RB', 'OL'],
        supportingPositions: ['FB', 'TE'],
        skillPriorities: { RB: ['strength', 'vision', 'truck'], OL: ['blocking', 'strength'], FB: ['blocking', 'strength'] }
    },
    counterRun: {
        label: 'Counter / misdirection run',
        situations: { earlyDown: 2, shortYardage: 1 },
        attacks: ['overpursuit', 'aggressiveBlitz', 'interiorOverload'],
        vulnerableTo: ['disciplinedRunFit', 'patientFront'],
        strengths: ['Punishes defenders who chase the first flow', 'Can exploit aggressive penetration'],
        weaknesses: ['Timing and blocking coordination matter', 'Less useful when defenders stay disciplined'],
        keyPositions: ['RB', 'OL'],
        supportingPositions: ['FB', 'TE'],
        skillPriorities: { RB: ['vision', 'agility'], OL: ['blocking', 'playbookIQ'] }
    },
    quickPass: {
        label: 'Quick pass',
        situations: { earlyDown: 2, shortYardage: 2, passingDown: 2, backedUp: 2 },
        attacks: ['aggressiveBlitz', 'softZone', 'heavyBox'],
        vulnerableTo: ['pressCoverage', 'tightUnderneath', 'disguisedCoverage'],
        strengths: ['Can get the ball out before pressure arrives', 'Useful for short conversions', 'Can punish aggressive rush plans'],
        weaknesses: ['Limited time for receivers to separate', 'Tight underneath coverage can compress windows'],
        keyPositions: ['QB', 'WR'],
        supportingPositions: ['TE', 'RB', 'OL'],
        skillPriorities: { QB: ['throwingAccuracy', 'decisionMaking'], WR: ['routeRunning', 'catchingHands'], TE: ['routeRunning', 'catchingHands'] }
    },
    verticalPass: {
        label: 'Vertical / deep pass',
        situations: { passingDown: 3, trailingLate: 3, earlyDown: 1 },
        attacks: ['singleHigh', 'aggressiveBlitz', 'lightDeepCoverage'],
        vulnerableTo: ['twoHigh', 'quartersCoverage', 'earlyPressure', 'deepZone'],
        strengths: ['Threatens explosive gains', 'Can punish single-high or overly aggressive defenses'],
        weaknesses: ['Needs time for routes to develop', 'Deep help and pressure reduce its margin for error'],
        keyPositions: ['QB', 'WR'],
        supportingPositions: ['TE', 'OL'],
        skillPriorities: { QB: ['throwingAccuracy', 'decisionMaking'], WR: ['speed', 'catchingHands'], TE: ['speed', 'catchingHands'], OL: ['blocking'] }
    },
    crossingPass: {
        label: 'Crossing / intermediate pass',
        situations: { earlyDown: 2, passingDown: 2, redZone: 1 },
        attacks: ['manCoverage', 'openMiddle', 'singleHigh'],
        vulnerableTo: ['matchZone', 'bracketCoverage', 'pressure'],
        strengths: ['Can create separation across the field', 'Can stress man coverage and open the middle'],
        weaknesses: ['Timing and spacing are important', 'Pattern-match defenders and pressure can disrupt routes'],
        keyPositions: ['QB', 'WR', 'TE'],
        supportingPositions: ['RB', 'OL'],
        skillPriorities: { QB: ['throwingAccuracy', 'decisionMaking'], WR: ['routeRunning', 'agility'], TE: ['routeRunning', 'catchingHands'] }
    },
    screenPass: {
        label: 'Screen pass',
        situations: { earlyDown: 1, passingDown: 2, backedUp: 1 },
        attacks: ['aggressiveBlitz', 'upfieldRush', 'overpursuit'],
        vulnerableTo: ['screenRecognition', 'patientRush', 'tightPerimeter'],
        strengths: ['Can use an aggressive rush against itself', 'Can create space for a runner with blockers'],
        weaknesses: ['Loses value when defenders recognize it early', 'Needs timing and perimeter blocking'],
        keyPositions: ['QB', 'RB'],
        supportingPositions: ['OL', 'WR'],
        skillPriorities: { QB: ['decisionMaking', 'throwingAccuracy'], RB: ['speed', 'agility', 'catchingHands'], OL: ['blocking', 'agility'] }
    },
    playAction: {
        label: 'Play action',
        situations: { earlyDown: 2, passingDown: 1, goalLine: 1 },
        attacks: ['runCommitment', 'aggressiveBlitz', 'shortZone'],
        vulnerableTo: ['disciplinedCoverage', 'pressure', 'poorRunCredibility'],
        strengths: ['Can exploit defenders who commit to the run', 'Can create opportunities behind the first level'],
        weaknesses: ['The fake must be credible', 'Can expose the QB when pressure arrives early'],
        keyPositions: ['QB', 'RB', 'OL'],
        supportingPositions: ['WR', 'TE', 'FB'],
        skillPriorities: { QB: ['playbookIQ', 'throwingAccuracy'], RB: ['ballHandling'], OL: ['blocking'] }
    },
    rolloutPass: {
        label: 'Rollout / bootleg pass',
        situations: { earlyDown: 2, shortYardage: 1, backedUp: 1 },
        attacks: ['staticCoverage', 'interiorRush', 'runCommitment'],
        vulnerableTo: ['edgeContain', 'qbSpy', 'pressure'],
        strengths: ['Changes the launch point', 'Can stress interior-focused rush plans'],
        weaknesses: ['Contain defenders can limit the escape lane', 'Can shrink the available field and passing angles'],
        keyPositions: ['QB', 'RB'],
        supportingPositions: ['TE', 'WR', 'OL'],
        skillPriorities: { QB: ['mobility', 'throwingAccuracy', 'decisionMaking'], OL: ['blocking'] }
    },
    floodPass: {
        label: 'Flood / layered pass',
        situations: { passingDown: 2, redZone: 2, trailingLate: 2 },
        attacks: ['flatZone', 'singleSideOverload', 'staticZone'],
        vulnerableTo: ['patternMatch', 'deepRotation', 'pressure'],
        strengths: ['Stresses multiple depths in one area', 'Can create a high-low read for the QB'],
        weaknesses: ['Pattern-match coverage can pass routes off', 'Requires time and route spacing'],
        keyPositions: ['QB', 'WR'],
        supportingPositions: ['TE', 'RB', 'OL'],
        skillPriorities: { QB: ['decisionMaking', 'throwingAccuracy'], WR: ['routeRunning', 'speed'] }
    },
    runPassOption: {
        label: 'Run-pass option',
        situations: { earlyDown: 2, shortYardage: 1 },
        attacks: ['slowConflictDefender', 'boxCommitment'],
        vulnerableTo: ['disciplinedConflictDefense', 'fastDiagnosis'],
        strengths: ['Can punish a defender who commits to the wrong threat', 'Keeps run and pass options connected'],
        weaknesses: ['Requires a correct, timely read', 'Disciplined defenders reduce the decision advantage'],
        keyPositions: ['QB', 'RB'],
        supportingPositions: ['WR', 'OL'],
        skillPriorities: { QB: ['decisionMaking', 'playbookIQ'], RB: ['vision', 'ballHandling'] }
    },
    trickPass: {
        label: 'Trick / deception pass',
        situations: { earlyDown: 1, passingDown: 1, trailingLate: 1 },
        attacks: ['overaggression', 'predictableDefense', 'surprise'],
        vulnerableTo: ['discipline', 'earlyRecognition', 'executionError'],
        strengths: ['Can punish predictable opponents', 'Creates a surprise opportunity'],
        weaknesses: ['High execution and turnover risk', 'Loses surprise value when overused'],
        keyPositions: ['QB', 'RB'],
        supportingPositions: ['WR', 'TE', 'OL'],
        skillPriorities: { QB: ['decisionMaking', 'throwingAccuracy'], RB: ['ballHandling', 'playbookIQ'] }
    },
    balancedPass: {
        label: 'Balanced pass',
        situations: { earlyDown: 2, shortYardage: 1, passingDown: 2, redZone: 1 },
        attacks: ['softZone', 'predictableCoverage'],
        vulnerableTo: ['tightCoverage', 'pressure'],
        strengths: ['Provides flexible answers at several depths', 'Can fit a broad range of situations'],
        weaknesses: ['May lack a single decisive advantage', 'Still depends on the QB reading the defense'],
        keyPositions: ['QB', 'WR'],
        supportingPositions: ['TE', 'RB', 'OL'],
        skillPriorities: { QB: ['decisionMaking', 'throwingAccuracy'], WR: ['routeRunning', 'catchingHands'] }
    }
};

const DEFENSE_PROFILES = {
    zoneCover2: {
        label: 'Cover 2 zone',
        situations: { earlyDown: 2, passingDown: 1, protectLead: 2 },
        protectsAgainst: ['outsideDeepRoutes', 'balancedPass'],
        vulnerableTo: ['seamPass', 'fourVerts', 'intermediateCross', 'run'],
        strengths: ['Distributes deep responsibility', 'Can keep the play in front of defenders'],
        weaknesses: ['Seams and the space between zones require sound underneath distribution', 'May concede underneath completions'],
        keyPositions: ['DB', 'LB'],
        supportingPositions: ['DL'],
        skillPriorities: { DB: ['coverage', 'speed', 'playbookIQ'], LB: ['coverage', 'playbookIQ'] }
    },
    zoneCover3: {
        label: 'Cover 3 zone',
        situations: { earlyDown: 2, passingDown: 2, protectLead: 2 },
        protectsAgainst: ['verticalPass', 'outsideDeepRoutes'],
        vulnerableTo: ['seamPass', 'floodPass', 'intermediateCross', 'underneathPass'],
        strengths: ['Provides defined deep zones', 'Balances deep-field protection and underneath defenders'],
        weaknesses: ['Seams and layered routes can stress zone handoffs', 'Short completions may be available underneath'],
        keyPositions: ['DB', 'LB'],
        supportingPositions: ['DL'],
        skillPriorities: { DB: ['coverage', 'speed', 'playbookIQ'], LB: ['coverage', 'playbookIQ'] }
    },
    quartersCoverage: {
        label: 'Quarters / deep coverage',
        situations: { passingDown: 3, protectLead: 3, trailingLate: 1 },
        protectsAgainst: ['verticalPass', 'fourVerts', 'deepShot'],
        vulnerableTo: ['run', 'quickPass', 'underneathPass'],
        strengths: ['Strong emphasis on limiting deep completions', 'Useful against vertical route combinations'],
        weaknesses: ['Can concede underneath space', 'A pass-first alignment may be vulnerable to a committed run game'],
        keyPositions: ['DB'],
        supportingPositions: ['LB', 'DL'],
        skillPriorities: { DB: ['coverage', 'speed', 'playbookIQ'] }
    },
    splitFieldZone: {
        label: 'Split-field zone',
        situations: { earlyDown: 2, passingDown: 2, protectLead: 2 },
        protectsAgainst: ['balancedPass', 'verticalPass'],
        vulnerableTo: ['horizontalStretch', 'formationOverload', 'run'],
        strengths: ['Can tailor coverage to each side of the formation', 'Offers balanced answers to varied route threats'],
        weaknesses: ['Requires coordinated distribution', 'Can be stressed by overloads and horizontal movement'],
        keyPositions: ['DB', 'LB'],
        supportingPositions: ['DL'],
        skillPriorities: { DB: ['coverage', 'playbookIQ'], LB: ['coverage', 'playbookIQ'] }
    },
    manCoverage: {
        label: 'Man coverage',
        situations: { earlyDown: 2, passingDown: 2 },
        protectsAgainst: ['staticZone', 'slowDevelopingRoutes'],
        vulnerableTo: ['crossingPass', 'rubRoutes', 'mismatchTarget'],
        strengths: ['Can contest receivers directly', 'Can disrupt predictable route timing'],
        weaknesses: ['Crossing routes and natural traffic can create separation', 'Matchups can expose a weaker defender'],
        keyPositions: ['DB', 'LB'],
        supportingPositions: ['DL'],
        skillPriorities: { DB: ['coverage', 'speed', 'agility'], LB: ['coverage', 'agility'] }
    },
    manBlitz: {
        label: 'Man blitz',
        situations: { passingDown: 2, shortYardage: 1, trailingLate: 1 },
        protectsAgainst: ['slowDevelopingRoutes', 'limitedProtection'],
        vulnerableTo: ['quickPass', 'screenPass', 'verticalPass', 'hotRead'],
        strengths: ['Adds immediate pressure', 'Can disrupt a QB who needs time'],
        weaknesses: ['Fewer defenders remain available for coverage', 'Quick throws, screens and vertical releases can punish poor spacing'],
        keyPositions: ['DL', 'LB', 'DB'],
        supportingPositions: ['DB'],
        skillPriorities: { DL: ['speed', 'strength', 'passRush'], LB: ['speed', 'tackling'], DB: ['coverage', 'speed'] }
    },
    zoneBlitz: {
        label: 'Zone blitz',
        situations: { passingDown: 2, earlyDown: 1 },
        protectsAgainst: ['slowDevelopingRoutes', 'predictablePass'],
        vulnerableTo: ['screenPass', 'quickPass', 'hotRead', 'misdirection'],
        strengths: ['Combines pressure with zone coverage', 'Can complicate the QB\'s pre-snap picture'],
        weaknesses: ['Dropping and rushing players must execute their assignments', 'Screens and quick decisions can exploit pressure movement'],
        keyPositions: ['DL', 'LB', 'DB'],
        supportingPositions: ['LB', 'DB'],
        skillPriorities: { DL: ['passRush', 'playbookIQ'], LB: ['coverage', 'playbookIQ'], DB: ['coverage', 'playbookIQ'] }
    },
    runFit: {
        label: 'Run-focused front',
        situations: { shortYardage: 3, goalLine: 3, earlyDown: 2 },
        protectsAgainst: ['insideRun', 'powerRun', 'outsideRun'],
        vulnerableTo: ['playAction', 'verticalPass', 'floodPass'],
        strengths: ['Adds bodies and leverage against the run', 'Useful in short-yardage and goal-line situations'],
        weaknesses: ['Can sacrifice coverage depth', 'Play action and passing concepts can exploit run commitment'],
        keyPositions: ['DL', 'LB'],
        supportingPositions: ['DB'],
        skillPriorities: { DL: ['strength', 'tackling'], LB: ['tackling', 'playbookIQ'] }
    },
    bracketCoverage: {
        label: 'Bracket / double coverage',
        situations: { passingDown: 2, redZone: 2 },
        protectsAgainst: ['mismatchTarget', 'primaryReceiver'],
        vulnerableTo: ['secondaryTarget', 'run', 'formationOverload'],
        strengths: ['Can reduce the impact of a dangerous primary target', 'Forces the offense to use secondary options'],
        weaknesses: ['Allocates extra attention to one threat', 'Can leave another eligible receiver with more space'],
        keyPositions: ['DB', 'LB'],
        supportingPositions: ['DB'],
        skillPriorities: { DB: ['coverage', 'playbookIQ'], LB: ['coverage', 'playbookIQ'] }
    },
    prevent: {
        label: 'Prevent / deep protection',
        situations: { passingDown: 2, protectLead: 3, trailingLate: 1 },
        protectsAgainst: ['verticalPass', 'deepShot', 'fourVerts'],
        vulnerableTo: ['insideRun', 'quickPass', 'underneathPass'],
        strengths: ['Prioritizes limiting explosive plays', 'Useful when protecting a lead late'],
        weaknesses: ['Can give up short completions and running room', 'May be too passive when a stop is needed quickly'],
        keyPositions: ['DB'],
        supportingPositions: ['LB', 'DL'],
        skillPriorities: { DB: ['coverage', 'speed', 'playbookIQ'] }
    },
    balancedZone: {
        label: 'Balanced zone',
        situations: { earlyDown: 2, passingDown: 2, protectLead: 1 },
        protectsAgainst: ['balancedPass', 'quickPass'],
        vulnerableTo: ['zoneBeater', 'formationOverload', 'run'],
        strengths: ['Maintains area responsibility', 'Can limit easy reads when spacing is disciplined'],
        weaknesses: ['Well-designed route combinations can stress zone handoffs', 'Requires defenders to pass routes off correctly'],
        keyPositions: ['DB', 'LB'],
        supportingPositions: ['DL'],
        skillPriorities: { DB: ['coverage', 'playbookIQ'], LB: ['coverage', 'playbookIQ'] }
    }
};

// Explicit overrides are reserved for signature plays where a generic tag
// profile would miss an important tactical detail. Unlisted plays still get a
// useful profile from their existing playbook tags and assignments.
const OFFENSE_OVERRIDES = {
    Uni_QuickSlants: {
        archetype: 'quickPass',
        attacks: ['aggressiveBlitz', 'softZone', 'heavyBox'],
        vulnerableTo: ['pressCoverage', 'tightUnderneath'],
        strengths: ['Quick inside breaks can punish pressure', 'Multiple short reads give the QB options'],
        weaknesses: ['Can run into crowded underneath windows', 'Needs quick QB processing and receiver timing'],
        keyPositions: ['QB', 'WR'],
        supportingPositions: ['TE', 'RB', 'OL']
    },
    Uni_FourVerts: {
        archetype: 'verticalPass',
        attacks: ['singleHigh', 'aggressiveBlitz', 'lightDeepCoverage'],
        vulnerableTo: ['twoHigh', 'quartersCoverage', 'earlyPressure', 'deepZone'],
        strengths: ['Stresses the full width and depth of the secondary', 'Can punish single-high looks and coverage sacrificed for pressure'],
        weaknesses: ['All vertical routes need protection time', 'Seam receivers can be bracketed or passed between deep defenders'],
        keyPositions: ['QB', 'WR', 'TE'],
        supportingPositions: ['OL', 'RB']
    },
    Uni_Stick: { archetype: 'quickPass', keyPositions: ['QB', 'TE', 'WR'], supportingPositions: ['RB', 'OL'] },
    Uni_Drive: { archetype: 'crossingPass', keyPositions: ['QB', 'TE', 'WR'], supportingPositions: ['RB', 'OL'] },
    Uni_Mesh: {
        archetype: 'crossingPass',
        attacks: ['manCoverage', 'openMiddle'],
        vulnerableTo: ['matchZone', 'bracketCoverage', 'pressure'],
        keyPositions: ['QB', 'WR', 'TE', 'RB']
    },
    Uni_HB_Screen: { archetype: 'screenPass', keyPositions: ['QB', 'RB', 'OL'], supportingPositions: ['WR', 'TE'] },
    PA_Bootleg_Right: { archetype: 'rolloutPass', keyPositions: ['QB', 'RB', 'OL'], supportingPositions: ['TE', 'WR'] },
    Power_PA_FB_Wheel: { archetype: 'playAction', keyPositions: ['QB', 'FB', 'OL'], supportingPositions: ['WR', 'TE'] },
    Jumbo_PA_PopPass: { archetype: 'playAction', keyPositions: ['QB', 'TE', 'FB', 'OL'], supportingPositions: ['WR'] },
    Spread_FourVerts_Switch: { archetype: 'verticalPass', keyPositions: ['QB', 'WR'], supportingPositions: ['TE', 'OL', 'RB'] },
    Trips_FourVerts: { archetype: 'verticalPass', keyPositions: ['QB', 'WR', 'TE'], supportingPositions: ['OL', 'RB'] },
    Spread_Tunnel_Screen: { archetype: 'screenPass', keyPositions: ['QB', 'WR', 'OL'], supportingPositions: ['RB', 'TE'] },
    Trips_Bubble_Screen: { archetype: 'screenPass', keyPositions: ['QB', 'WR'], supportingPositions: ['OL', 'RB', 'TE'] },
    RPO_Slant_Dive: { archetype: 'runPassOption', keyPositions: ['QB', 'RB', 'WR'], supportingPositions: ['OL', 'TE'] },
    Trick_Flea_Flicker: {
        archetype: 'trickPass',
        strengths: ['Can punish overaggressive run pursuit when the deception is sold'],
        weaknesses: ['High execution risk', 'A disciplined defense can expose the slow-developing pass'],
        keyPositions: ['QB', 'RB', 'WR', 'OL']
    }
};

const DEFENSE_OVERRIDES = {
    Cover_2_Zone_Base: { archetype: 'zoneCover2', protectsAgainst: ['outsideDeepRoutes', 'balancedPass'], vulnerableTo: ['seamPass', 'fourVerts', 'intermediateCross', 'run'] },
    Cover_3_Sky: { archetype: 'zoneCover3', protectsAgainst: ['verticalPass', 'outsideDeepRoutes'], vulnerableTo: ['seamPass', 'floodPass', 'underneathPass'] },
    Cover_1_Robber: {
        archetype: 'manCoverage',
        protectsAgainst: ['staticZone', 'slowDevelopingRoutes'],
        vulnerableTo: ['crossingPass', 'rubRoutes', 'mismatchTarget'],
        strengths: ['Man coverage with an underneath robber and deep help', 'Can contest receivers while protecting a central passing lane'],
        weaknesses: ['Crossing routes can create traffic', 'The underneath and deep helpers can be stressed by multiple inside releases']
    },
    Man_Blitz_Base: {
        archetype: 'manBlitz',
        protectsAgainst: ['slowDevelopingRoutes', 'limitedProtection'],
        vulnerableTo: ['quickPass', 'screenPass', 'verticalPass', 'hotRead'],
        weaknesses: ['Pressure reduces the number of defenders available to help in coverage', 'Must account for fast inside releases and the TE/RB outlets']
    },
    Base_Cover_0_AllOut: { archetype: 'manBlitz', vulnerableTo: ['quickPass', 'screenPass', 'verticalPass', 'hotRead'] },
    Zero_Max_Blitz: { archetype: 'manBlitz', vulnerableTo: ['quickPass', 'screenPass', 'verticalPass', 'hotRead'] },
    Nickel_Bracket_WR1: { archetype: 'bracketCoverage', keyPositions: ['DB', 'LB'], supportingPositions: ['DB'] },
    Dime_Lockdown: { archetype: 'manCoverage', keyPositions: ['DB'], supportingPositions: ['DL'] },
    Cover_4_Quarters: { archetype: 'quartersCoverage' },
    Cover_6_Split: { archetype: 'splitFieldZone' },
    GoalLine_RunStuff: { archetype: 'runFit' },
    Victory_Prevent: { archetype: 'prevent' },
    Overload_Blitz_Right: {
        archetype: 'manBlitz',
        attacks: ['limitedProtection', 'slowDevelopingRoutes'],
        vulnerableTo: ['quickPass', 'screenPass', 'verticalPass', 'seamPass', 'hotRead'],
        strengths: ['Concentrates pressure toward the right side of the protection'],
        weaknesses: ['Aggressive pressure can leave fewer defenders available for inside routes', 'The short-middle assignment may not be enough to carry a vertical TE release']
    },
    Overload_Blitz_Left: {
        archetype: 'manBlitz',
        attacks: ['limitedProtection', 'slowDevelopingRoutes'],
        vulnerableTo: ['quickPass', 'screenPass', 'verticalPass', 'seamPass', 'hotRead'],
        strengths: ['Concentrates pressure toward the left side of the protection'],
        weaknesses: ['Aggressive pressure can leave fewer defenders available for inside routes', 'The short-middle assignment may not be enough to carry a vertical TE release']
    }
};

function hasTag(tags, candidates) {
    return candidates.some(tag => tags.has(tag));
}

function inferOffensiveArchetype(play = {}) {
    const tags = new Set(Array.isArray(play.tags) ? play.tags : []);
    if (play.type === 'run') {
        if (hasTag(tags, ['counter', 'misdirection', 'trap', 'draw'])) return 'counterRun';
        if (hasTag(tags, ['outside', 'toss'])) return 'outsideRun';
        if (hasTag(tags, ['power', 'lead', 'fb', 'goalline'])) return 'powerRun';
        return 'insideRun';
    }
    if (hasTag(tags, ['specialTeams']) || play.type === 'punt') return 'balancedPass';
    if (hasTag(tags, ['trick'])) return 'trickPass';
    if (hasTag(tags, ['rpo'])) return 'runPassOption';
    if (hasTag(tags, ['screen'])) return 'screenPass';
    if (hasTag(tags, ['pa', 'rollout', 'leak', 'wheel'])) {
        return hasTag(tags, ['rollout']) ? 'rolloutPass' : 'playAction';
    }
    if (hasTag(tags, ['deep', 'vertical', 'shot', 'seam'])) return 'verticalPass';
    if (hasTag(tags, ['flood'])) return 'floodPass';
    if (hasTag(tags, ['cross', 'mesh', 'corner'])) return 'crossingPass';
    if (hasTag(tags, ['quick'])) return 'quickPass';
    if (hasTag(tags, ['short'])) return 'quickPass';
    return 'balancedPass';
}

function inferDefensiveArchetype(play = {}) {
    const tags = new Set(Array.isArray(play.tags) ? play.tags : []);
    if (hasTag(tags, ['prevent'])) return 'prevent';
    if (hasTag(tags, ['runStop']) || play.concept === 'Run') return 'runFit';
    if (hasTag(tags, ['double-team'])) return 'bracketCoverage';
    if (hasTag(tags, ['cover4', 'anti-deep'])) return 'quartersCoverage';
    if (hasTag(tags, ['cover6'])) return 'splitFieldZone';
    if (hasTag(tags, ['blitz', 'firezone']) && hasTag(tags, ['zone', 'firezone'])) return 'zoneBlitz';
    if (hasTag(tags, ['blitz', 'overload', 'aggro'])) return 'manBlitz';
    if (hasTag(tags, ['cover2'])) return 'zoneCover2';
    if (hasTag(tags, ['cover3'])) return 'zoneCover3';
    if (play.concept === 'Man' || hasTag(tags, ['man'])) return 'manCoverage';
    return 'balancedZone';
}

function mergeProfile(base, override) {
    const result = { ...base, ...override };
    result.situations = { ...(base.situations || {}), ...(override?.situations || {}) };
    result.strengths = [...(override?.strengths || base.strengths || [])];
    result.weaknesses = [...(override?.weaknesses || base.weaknesses || [])];
    result.attacks = [...(override?.attacks || base.attacks || [])];
    result.protectsAgainst = [...(override?.protectsAgainst || base.protectsAgainst || [])];
    result.vulnerableTo = [...(override?.vulnerableTo || base.vulnerableTo || [])];
    result.keyPositions = [...(override?.keyPositions || base.keyPositions || [])];
    result.supportingPositions = [...(override?.supportingPositions || base.supportingPositions || [])];
    result.skillPriorities = { ...(base.skillPriorities || {}), ...(override?.skillPriorities || {}) };
    return result;
}

export function getOffensivePlayKnowledge(playKey, playDefinition = {}) {
    const override = OFFENSE_OVERRIDES[playKey] || {};
    const archetype = override.archetype || inferOffensiveArchetype(playDefinition);
    const profile = mergeProfile(OFFENSE_PROFILES[archetype] || OFFENSE_PROFILES.balancedPass, override);

    return {
        key: playKey,
        side: 'offense',
        archetype,
        label: profile.label || playDefinition.name || playKey,
        situations: profile.situations,
        attacks: profile.attacks,
        vulnerableTo: profile.vulnerableTo,
        strengths: profile.strengths,
        weaknesses: profile.weaknesses,
        keyPositions: profile.keyPositions,
        supportingPositions: profile.supportingPositions,
        skillPriorities: profile.skillPriorities,
        readProgression: Array.isArray(playDefinition.readProgression)
            ? [...playDefinition.readProgression]
            : [],
        surprisePotential: archetype === 'trickPass' ? 3 : (archetype === 'counterRun' ? 2 : 1)
    };
}

export function getDefensivePlayKnowledge(playKey, playDefinition = {}) {
    const override = DEFENSE_OVERRIDES[playKey] || {};
    const archetype = override.archetype || inferDefensiveArchetype(playDefinition);
    const profile = mergeProfile(DEFENSE_PROFILES[archetype] || DEFENSE_PROFILES.balancedZone, override);

    return {
        key: playKey,
        side: 'defense',
        archetype,
        label: profile.label || playDefinition.name || playKey,
        situations: profile.situations,
        protectsAgainst: profile.protectsAgainst,
        vulnerableTo: profile.vulnerableTo,
        strengths: profile.strengths,
        weaknesses: profile.weaknesses,
        keyPositions: profile.keyPositions,
        supportingPositions: profile.supportingPositions,
        skillPriorities: profile.skillPriorities,
        isBlitz: Boolean(playDefinition.blitz || playDefinition.tags?.includes('blitz')),
        surprisePotential: playDefinition.tags?.includes('overload') ? 2 : 1
    };
}

/**
 * Returns a bounded tendency adjustment. Keep this small when integrating it
 * into playcalling so scouting informs the coach without forcing a counter.
 * `confidence` and `coachStyleWeight` should both be normalized to 0..1.
 */
export function getTendencyAdjustment({
    observedRate = 0,
    expectedRate = 0,
    confidence = 0,
    coachStyleWeight = 0.5,
    maxAdjustment = 8
} = {}) {
    const rate = Math.max(0, Math.min(1, Number(observedRate) || 0));
    const baseline = Math.max(0, Math.min(1, Number(expectedRate) || 0));
    const certainty = Math.max(0, Math.min(1, Number(confidence) || 0));
    const style = Math.max(0, Math.min(1, Number(coachStyleWeight) || 0));
    const cap = Math.max(0, Number(maxAdjustment) || 0);

    // Only deviations from a neutral expectation matter. Even at maximum
    // confidence the adjustment remains bounded to avoid counter-calling loops.
    const evidence = (rate - baseline) * 2;
    return Math.max(-cap, Math.min(cap, evidence * certainty * style * cap));
}