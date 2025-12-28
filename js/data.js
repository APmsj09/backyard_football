/* js/data.js */

import { getRandom, getRandomInt } from './utils.js';

// --- Relationship Levels ---
export const relationshipLevels = {
    STRANGER: { level: 0, name: 'Stranger', callChance: 0.10, scoutAccuracy: 0.2, color: 'text-gray-500' },
    ACQUAINTANCE: { level: 1, name: 'Acquaintance', callChance: 0.30, scoutAccuracy: 0.4, color: 'text-blue-500' },
    FRIEND: { level: 2, name: 'Friend', callChance: 0.60, scoutAccuracy: 0.7, color: 'text-green-600' },
    GOOD_FRIEND: { level: 3, name: 'Good Friend', callChance: 0.80, scoutAccuracy: 0.9, color: 'text-purple-600' },
    BEST_FRIEND: { level: 4, name: 'Best Friend', callChance: 0.95, scoutAccuracy: 1.0, color: 'text-amber-500 font-bold' }
};

// --- Name Data ---
export const firstNames = [
    "Alex", "Ben", "Casey", "Dakota", "Eli", "Frankie", "Gabby", "Hayden", "Izzy", "Jordan",
    "Kai", "Leo", "Morgan", "Nico", "Olive", "Pat", "Quinn", "Riley", "Sam", "Taylor", "Vic",
    "Wyn", "Andy", "Bobby", "Charlie", "Devon", "Eddie", "Fin", "Gus", "Hank", "Ivan",
    "Jack", "Kim", "Lou", "Max", "Nat", "Oscar", "Percy", "Ronnie", "Sid", "Tom", "Uri", "Val", "Wes",
    "Adrian", "Bailey", "Cameron", "Drew", "Emerson", "Flynn", "Gray", "Harper", "Jamie", "Jesse",
    "Kendall", "Logan", "Micah", "Noel", "Parker", "Peyton", "Reese", "Rowan", "Sage", "Skyler",
    "River", "Avery", "Sawyer", "Blake", "Dylan", "Ryan", "Shannon", "Terry", "Leslie", "Marion",
    "Sidney", "Aubrey", "Lynn", "Kris", "Robbie", "Jackie", "Kerry", "Alexis", "Dana", "Gale",
    "Ash", "Blair", "Corey", "Dale", "Erin", "Gael", "Harley", "Jody", "Lane", "Marlowe",
    "Orion", "Paxton", "Remy", "Rory", "Shae", "Tate", "August", "Billie", "Denver", "Ellis",
    "Indigo", "Jules", "Lennon", "Milan", "Phoenix", "Sterling", "Arden", "Caelan", "Finley", "Justice",
    "Chris", "Pat", "Shawn", "Jean", "Kelly", "Lindsay", "Joan", "Neil", "Glen", "Brett", "Kirk",
    "Leigh", "Merle", "Robin", "Stacy", "Tony", "Claude", "Daryl", "Jaden", "Jan", "Jimmie", "Johnny",
    "Ray", "Rene", "Stevie", "Willie", "Frankie", "Jessie"
];

export const lastNames = [
    "Smith", "Jones", "Williams", "Brown", "Davis", "Miller", "Wilson", "Moore", "Taylor",
    "Anderson", "Thomas", "Jackson", "White", "Harris", "Martin", "Thompson", "Garcia",
    "Martinez", "Robinson", "Clark", "Rodriguez", "Lewis", "Lee", "Walker", "Hall", "Allen",
    "Young", "Hernandez", "King", "Wright", "Lopez", "Hill", "Scott", "Green", "Adams", "Baker",
    "Gonzalez", "Nelson", "Carter", "Mitchell", "Perez", "Roberts", "Turner", "Phillips", "Campbell",
    "Parker", "Evans", "Edwards", "Collins", "Stewart", "Sanchez", "Morris", "Rogers", "Reed",
    "Cook", "Morgan", "Bell", "Murphy", "Bailey", "Rivera", "Cooper", "Richardson", "Cox", "Howard",
    "Ward", "Torres", "Peterson", "Gray", "Ramirez", "James", "Watson", "Brooks", "Kelly", "Sanders",
    "Price", "Bennett", "Wood", "Barnes", "Ross", "Henderson", "Coleman", "Jenkins", "Perry", "Powell",
    "Long", "Patterson", "Hughes", "Flores", "Washington", "Butler", "Simmons", "Foster", "Gonzales", "Bryant",
    "Alexander", "Russell", "Griffin", "Diaz", "Hayes", "Myers", "Ford", "Hamilton", "Graham", "Sullivan",
    "Wallace", "Woods", "Cole", "West", "Jordan", "Owens", "Reynolds", "Fisher", "Ellis", "Harrison", "Gibson",
    "Mcdonald", "Cruz", "Marshall", "Ortiz", "Gomez", "Murray", "Freeman", "Wells", "Webb", "Simpson", "Stevens",
    "Tucker", "Porter", "Hunter", "Hicks", "Crawford", "Henry", "Boyd", "Mason", "Morales", "Kennedy", "Warren",
    "Dixon", "Ramos", "Reyes", "Burns", "Gordon", "Shaw"
];

export const nicknames = [
    "'The Jet'", "'Rocket'", "'Sticks'", "'Wheels'", "'Flash'", "'Smiley'", "'Scout'", "'Ace'",
    "'Blaze'", "'Champ'", "'Dash'", "'Giggles'", "'Sonic'", "'Tiny'", "'Biggie'", "'Ghost'",
    "'Shadow'", "'Spider'", "'Moose'", "'Vortex'", "'Cobra'", "'Wizard'", "'Comet'", "'Cannon'",
    "'Diesel'", "'Gadget'", "'Icebox'", "'Jukebox'", "'Nomad'", "'Rhino'", "'Switch'", "'Tank'",
    "'Viper'", "'Wrecker'", "'Zippy'", "'Bulldozer'", "'Clutch'", "'Deuce'", "'Flea'", "'Gizmo'",
    "'Hollywood'", "'Joker'", "'Kicker'", "'Laser'", "'Nitro'", "'Orbit'", "'Phoenix'", "'Quake'",
    "'Racer'", "'Stingray'", "'Thunder'", "'Unit'", "'Wildcard'", "'X-Factor'", "'Yard Dog'",
    "'Avalanche'", "'Bolt'", "'Captain'", "'Dynamo'", "'Edge'", "'Fury'", "'Goliath'", "'Hawk'",
    "'Ironhide'", "'Juggernaut'", "'Kingpin'", "'Legend'", "'Maverick'", "'Ninja'", "'Outlaw'", "'Prowler'",
    "'Rampage'", "'Slinger'", "'T-Bone'", "'Ultimate'", "'Vandal'", "'Warrior'", "'Yeti'", "'Zeus'",
    "'Aftershock'", "'Bruiser'", "'Cyclone'", "'Dragon'", "'Enigma'", "'Grizzly'", "'Hotshot'", "'Jolt'",
    "'Knuckles'", "'Maniac'", "'Nightmare'", "'Overdrive'", "'Phantom'", "'Raptor'", "'Spike'", "'Titan'",
    "'Volt'", "'Wolf'", "'Zapper'", "'Bandit'", "'Crusher'", "'Demon'", "'Fireball'", "'Grinder'",
    "'Hound'", "'Iceman'", "'Jackal'", "'Lightning'", "'Mad Dog'"
];

export const teamNames = [
    "Comets", "Jets", "Rockets", "Sharks", "Tigers", "Lions", "Bears", "Eagles",
    "Hornets", "Bulldogs", "Panthers", "Giants", "Wolves", "Vipers", "Pythons", "Cobras",
    "Scorpions", "Spartans", "Cyclones", "Gladiators", "Raptors", "Hawks", "Falcons", "Rebels"
];

export const positions = ["QB", "RB", "WR", "OL", "DL", "LB", "DB"];
export const divisionNames = ["North", "South"];

// --- ZONES (Conceptual) ---
export const ZONES = {
    DEEP_L: 'Deep Left', DEEP_C: 'Deep Center', DEEP_R: 'Deep Right',
    MED_L: 'Medium Left', MED_C: 'Medium Center', MED_R: 'Medium Right',
    SHORT_L: 'Short Left', SHORT_C: 'Short Center', SHORT_R: 'Short Right'
};

// --- ENHANCED ROUTE TREE ---
// Paths are relative to the player's starting [x, y].
export const routeTree = {
    // --- Short / Quick Routes (0-5 yards) ---
    'Flat': { path: [{ x: 3, y: 1 }, { x: 8, y: 1.5 }] }, // Quick out to the sideline
    'Slant': { path: [{ x: 1, y: 2 }, { x: -5, y: 6 }] }, // Sharp 45-degree cut inside
    'QuickOut': { path: [{ x: 0, y: 4 }, { x: 5, y: 4 }] }, // Speed out
    'Hitch': { path: [{ x: 0, y: 6 }, { x: 0, y: 4 }] }, // Run 6, stop and come back 2
    'Drag': { path: [{ x: 1, y: 2 }, { x: -8, y: 3 }, { x: -18, y: 3.5 }] }, // Shallow crossing route
    'Whip': { path: [{ x: 0, y: 4 }, { x: -2, y: 4 }, { x: 4, y: 4 }] }, // In, stop, pivot back out (Zig)
    'Bubble': { path: [{ x: 4, y: -1 }, { x: 8, y: 0 }] }, // Wide receiver screen, drift back & out

    // --- Medium Routes (8-15 yards) ---
    'Out': { path: [{ x: 0, y: 10 }, { x: 8, y: 10 }] }, // Square cut to sideline at 10y
    'In': { path: [{ x: 0, y: 10 }, { x: -8, y: 10 }] }, // Square cut inside (Dig) at 10y
    'Curl': { path: [{ x: 0, y: 12 }, { x: 0, y: 12.5 }, { x: -1, y: 10 }] }, // Deep hitch, turn inside
    'Comeback': { path: [{ x: 0, y: 15 }, { x: 2, y: 15.5 }, { x: 6, y: 12 }] }, // Deep out, come back to ball
    'Corner': { path: [{ x: 0, y: 10 }, { x: 8, y: 25 }] }, // Flag route (10y stem, break to back pylon)
    'Post': { path: [{ x: 0, y: 10 }, { x: -6, y: 25 }] }, // Attack goal post (10y stem, break to middle)

    // --- Deep Routes (20+ yards) ---
    'Fly': { path: [{ x: 0, y: 40 }] }, // Go / Streak / Vertical
    'Seam': { path: [{ x: 0, y: 40 }] }, // Inner vertical, usually against zone
    'Fade': { path: [{ x: 1, y: 10 }, { x: 3, y: 35 }] }, // Drift outside towards back shoulder
    'PostCorner': { path: [{ x: 0, y: 10 }, { x: -2, y: 14 }, { x: 6, y: 25 }] }, // Double move: Fake Post, break Corner
    'Sluggo': { path: [{ x: 1, y: 2 }, { x: -3, y: 5 }, { x: -3, y: 25 }] }, // Slant-and-Go: Fake Slant, burst vertical

    // --- Running Back Specific ---
    'Wheel': { path: [{ x: 4, y: 1 }, { x: 6, y: 8 }, { x: 6, y: 25 }] }, // Flat then turn up sideline
    'Angle': { path: [{ x: 3, y: 2 }, { x: -2, y: 6 }] }, // Texas route: fake flat, sharp cut to middle
    'Screen': { path: [{ x: -2, y: -1 }, { x: -4, y: -0.5 }] }, // Slow release behind line
    'CheckRelease': { path: [{ x: 0, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 4 }] }, // Block for a beat, then leak to flat

    // --- Blocking Assignments ---
    'run_block': { path: [{ x: 0, y: 1.5 }] }, // Step forward to engage
    'pass_block': { path: [{ x: 0, y: -1.0 }] }, // Step back to form pocket

    // --- Run Paths (Game Engine Handles Physics) ---
    'run_inside': { path: [{ x: 0, y: 5 }] },
    'run_outside': { path: [{ x: 6, y: 4 }] },
    'run_counter': { path: [{ x: -2, y: -0.5 }, { x: 4, y: 4 }] } // Step wrong way, then cut back
};

// --- OFFENSIVE FORMATIONS ---
export const offenseFormations = {
    'Balanced': {
        name: 'Balanced',
        slots: ['QB1', 'RB1', 'WR1', 'WR2', 'OL1', 'OL2', 'OL3'],
        personnel: { QB: 1, RB: 1, WR: 2, OL: 3 },
        coordinates: {
            QB1: [0, -5],
            RB1: [-3, -5.5],
            WR1: [-18, 0.5],
            WR2: [18, 0.5],
            OL1: [-3, -0.5],
            OL2: [0, -0.75],
            OL3: [3, -0.5]
        },
        slotPriorities: {
            QB1: { throwingAccuracy: 3, playbookIQ: 2 },
            RB1: { speed: 2, agility: 2, catchingHands: 1 },
            WR1: { speed: 3, catchingHands: 3 },
            WR2: { speed: 3, catchingHands: 3 },
            OL1: { strength: 3, blocking: 3 },
            OL2: { strength: 3, blocking: 3, playbookIQ: 1 },
            OL3: { strength: 3, blocking: 3 }
        }
    },
    'Spread': {
        name: 'Spread',
        slots: ['QB1', 'WR1', 'WR2', 'WR3', 'OL1', 'OL2', 'OL3'],
        personnel: { QB: 1, RB: 0, WR: 3, OL: 3 },
        coordinates: {
            QB1: [0, -5],
            WR1: [-22, 0.5],
            WR2: [22, 0.5],
            WR3: [-8, 0.5], // Slot Left
            OL1: [-3, -0.5],
            OL2: [0, -0.75],
            OL3: [3, -0.5]
        },
        slotPriorities: {
            QB1: { throwingAccuracy: 3, playbookIQ: 2 },
            WR1: { speed: 3, catchingHands: 3 },
            WR2: { speed: 3, catchingHands: 3 },
            WR3: { agility: 3, catchingHands: 3, speed: 2 }, // Slot guy needs agility
            OL1: { strength: 3, blocking: 3 },
            OL2: { strength: 3, blocking: 3 },
            OL3: { strength: 3, blocking: 3 }
        }
    },
    'Power': {
        name: 'Power I',
        slots: ['QB1', 'RB1', 'RB2', 'WR1', 'OL1', 'OL2', 'OL3'],
        personnel: { QB: 1, RB: 2, WR: 1, OL: 3 },
        coordinates: {
            QB1: [0, -2], // Under center
            RB1: [0, -7], // Deep back
            RB2: [0, -4.5], // Fullback
            WR1: [18, 0.5],
            OL1: [-3, -0.5],
            OL2: [0, -0.75],
            OL3: [3, -0.5]
        },
        slotPriorities: {
            QB1: { strength: 2, playbookIQ: 2 },
            RB1: { strength: 3, speed: 2 }, // Power runner
            RB2: { blocking: 3, strength: 3 }, // Fullback
            WR1: { blocking: 2, catchingHands: 2 },
            OL1: { strength: 3, blocking: 3 },
            OL2: { strength: 3, blocking: 3 },
            OL3: { strength: 3, blocking: 3 }
        }
    },
    // --- NEW FORMATIONS ---
    'Trips': {
        name: 'Trips Right',
        slots: ['QB1', 'RB1', 'WR1', 'WR2', 'WR3', 'OL1', 'OL2'], // 7-Man: Drop 1 OL for speed
        personnel: { QB: 1, RB: 1, WR: 3, OL: 2 },
        coordinates: {
            QB1: [0, -5],
            RB1: [-4, -5], // Offset weak side
            WR1: [22, 0.5],  // Outside
            WR2: [16, 0.5],  // Middle
            WR3: [10, 0.5],  // Inside
            OL1: [-2, -0.5],
            OL2: [2, -0.5]
        },
        slotPriorities: {
            QB1: { throwingAccuracy: 3, playbookIQ: 2 },
            RB1: { blocking: 2, catchingHands: 2 },
            WR1: { speed: 3, catchingHands: 2 },
            WR2: { agility: 3, catchingHands: 2 },
            WR3: { agility: 3, catchingHands: 2 },
            OL1: { blocking: 3, strength: 3 },
            OL2: { blocking: 3, strength: 3 }
        }
    },
    'Empty': {
        name: 'Empty Five',
        slots: ['QB1', 'WR1', 'WR2', 'WR3', 'WR4', 'OL1', 'OL2'], // 7-Man: Drop RB & 1 OL
        personnel: { QB: 1, RB: 0, WR: 4, OL: 2 },
        coordinates: {
            QB1: [0, -5],
            WR1: [-22, 0.5], // Far Left
            WR2: [-10, 0.5], // Slot Left
            WR3: [10, 0.5],  // Slot Right
            WR4: [22, 0.5],  // Far Right
            OL1: [-2, -0.5],
            OL2: [2, -0.5]
        },
        slotPriorities: {
            QB1: { throwingAccuracy: 3, playbookIQ: 3 }, // Needs quick reads
            WR1: { speed: 3 },
            WR2: { agility: 3, catchingHands: 3 },
            WR3: { agility: 3, catchingHands: 3 },
            WR4: { speed: 3 },
            OL1: { blocking: 3, agility: 2 }, // Needs to hold blocks longer
            OL2: { blocking: 3, agility: 2 }
        }
    },
    'Punt': {
        name: 'Punt',
        personnel: { OL: 3, WR: 2, QB: 1, RB: 1 },
        slots: ['OL1', 'OL2', 'OL3', 'WR1', 'WR2', 'RB1', 'QB1'],
        coordinates: {
            QB1: [0, -12],
            OL1: [0, -0.5],
            OL2: [-3, -0.5],
            OL3: [3, -0.5],
            RB1: [0, -8],
            WR1: [-20, 0.5],
            WR2: [20, 0.5]
        },
        slotPriorities: {
            QB1: { strength: 3, throwingAccuracy: 2 }, // Punter
            OL1: { blocking: 3, strength: 2 },
            OL2: { blocking: 3, strength: 1 },
            OL3: { blocking: 3, strength: 1 },
            RB1: { blocking: 3, playbookIQ: 2 },
            WR1: { speed: 3, tackling: 2 },
            WR2: { speed: 3, tackling: 2 }
        }
    }
};

// --- OFFENSIVE PLAYBOOK ---
export const offensivePlaybook = {
    // ===================================
    // --- Balanced Formation (1 RB, 2 WR, 1 TE/Slot)
    // ===================================
    'Balanced_InsideZone': {
        type: 'run', tags: ['run', 'inside'],
        assignments: { 'RB1': 'run_inside', 'WR1': 'run_block', 'WR2': 'run_block', 'OL1': 'run_block', 'OL2': 'run_block', 'OL3': 'run_block' }
    },
    'Balanced_StretchRight': {
        type: 'run', tags: ['run', 'outside'],
        assignments: { 'RB1': 'run_outside', 'WR1': 'run_block', 'WR2': 'run_block', 'OL1': 'run_block', 'OL2': 'run_block', 'OL3': 'run_block' }
    },
    'Balanced_Slants': {
        type: 'pass', tags: ['pass', 'short', 'quick'],
        readProgression: ['WR1', 'WR2', 'RB1'],
        assignments: { 'WR1': 'Slant', 'WR2': 'Slant', 'RB1': 'Flat', 'OL1': 'pass_block', 'OL2': 'pass_block', 'OL3': 'pass_block' }
    },
    'Balanced_Smash': {
        type: 'pass', tags: ['pass', 'medium', 'corner'],
        readProgression: ['WR2', 'WR1'],
        assignments: { 'WR1': 'Hitch', 'WR2': 'Corner', 'RB1': 'pass_block', 'OL1': 'pass_block', 'OL2': 'pass_block', 'OL3': 'pass_block' }
    },
    // NEW: Sluggo (Slant-and-Go) to punish aggressive corners
    'Balanced_Sluggo_Shot': {
        type: 'pass', tags: ['pass', 'deep', 'doublemove'],
        readProgression: ['WR1', 'WR2'],
        assignments: { 'WR1': 'Sluggo', 'WR2': 'In', 'RB1': 'CheckRelease', 'OL1': 'pass_block', 'OL2': 'pass_block', 'OL3': 'pass_block' }
    },
    // NEW: Whip route for 3rd & Short
    'Balanced_Zig_Zag': {
        type: 'pass', tags: ['pass', 'short', 'redzone'],
        readProgression: ['WR2', 'RB1'],
        assignments: { 'WR1': 'Fly', 'WR2': 'Whip', 'RB1': 'Angle', 'OL1': 'pass_block', 'OL2': 'pass_block', 'OL3': 'pass_block' }
    },

    // ===================================
    // --- Spread Formation (0 RB, 3 WR, 3 OL)
    // ===================================
    'Spread_BubbleScreen': {
        type: 'pass', tags: ['pass', 'screen', 'short'],
        readProgression: ['WR3'],
        assignments: { 'WR3': 'Bubble', 'WR1': 'run_block', 'WR2': 'Fly', 'OL1': 'run_block', 'OL2': 'run_block', 'OL3': 'run_block' }
    },
    'Spread_FourVerts': {
        type: 'pass', tags: ['pass', 'deep'],
        readProgression: ['WR3', 'WR1', 'WR2'],
        assignments: { 'WR1': 'Fly', 'WR2': 'Fly', 'WR3': 'Seam', 'OL1': 'pass_block', 'OL2': 'pass_block', 'OL3': 'pass_block' }
    },
    'Spread_Mesh': {
        type: 'pass', tags: ['pass', 'short'],
        readProgression: ['WR1', 'WR2', 'WR3'],
        assignments: { 'WR1': 'Drag', 'WR2': 'Drag', 'WR3': 'In', 'OL1': 'pass_block', 'OL2': 'pass_block', 'OL3': 'pass_block' }
    },
    // NEW: Post-Corner Concept
    'Spread_DoubleMove': {
        type: 'pass', tags: ['pass', 'deep', 'doublemove'],
        readProgression: ['WR1', 'WR3'],
        assignments: { 'WR1': 'PostCorner', 'WR2': 'Comeback', 'WR3': 'Seam', 'OL1': 'pass_block', 'OL2': 'pass_block', 'OL3': 'pass_block' }
    },

    // ===================================
    // --- Power Formation (2 RB, 1 WR)
    // ===================================
    'Power_Iso': {
        type: 'run', tags: ['run', 'inside', 'power'],
        assignments: { 'RB1': 'run_inside', 'RB2': 'run_block', 'WR1': 'run_block', 'OL1': 'run_block', 'OL2': 'run_block', 'OL3': 'run_block' }
    },
    'Power_Counter': {
        type: 'run', tags: ['run', 'inside', 'counter'],
        assignments: { 'RB1': 'run_counter', 'RB2': 'run_block', 'WR1': 'run_block', 'OL1': 'run_block', 'OL2': 'run_block', 'OL3': 'run_block' }
    },
    'Power_PA_Leak': {
        type: 'pass', tags: ['pass', 'pa', 'deep'],
        readProgression: ['WR1', 'RB1'],
        assignments: { 'RB2': 'Flat', 'WR1': 'Post', 'RB1': 'Wheel', 'OL1': 'run_block', 'OL2': 'run_block', 'OL3': 'pass_block' }
    },
    // NEW: Texas Concept (Angle Route)
    'Power_Texas': {
        type: 'pass', tags: ['pass', 'medium', 'middle'],
        readProgression: ['RB1', 'WR1'],
        assignments: { 'RB1': 'Angle', 'RB2': 'Flat', 'WR1': 'Post', 'OL1': 'pass_block', 'OL2': 'pass_block', 'OL3': 'pass_block' }
    },

    // ===================================
    // --- Trips Formation (3 WR Bunch)
    // ===================================
    'Trips_Flood': {
        type: 'pass', tags: ['pass', 'medium', 'flood'],
        readProgression: ['WR2', 'WR3'],
        assignments: { 'WR1': 'Fly', 'WR2': 'Out', 'WR3': 'Flat', 'RB1': 'pass_block', 'OL1': 'pass_block', 'OL2': 'pass_block' }
    },
    // NEW: Stick Concept (Quick Out + Vertical)
    'Trips_Stick': {
        type: 'pass', tags: ['pass', 'short', 'quick'],
        readProgression: ['WR3', 'WR2'],
        assignments: { 'WR1': 'Fade', 'WR2': 'QuickOut', 'WR3': 'Hitch', 'RB1': 'CheckRelease', 'OL1': 'pass_block', 'OL2': 'pass_block' }
    },
    // NEW: Screen and Go
    'Trips_Bubble_Go': {
        type: 'pass', tags: ['pass', 'deep', 'trick'],
        readProgression: ['WR3'],
        assignments: { 'WR1': 'run_block', 'WR2': 'run_block', 'WR3': 'Sluggo', 'RB1': 'run_inside', 'OL1': 'pass_block', 'OL2': 'pass_block' }
    },

    // ===================================
    // --- Empty Formation (5 WR/Eligible)
    // ===================================
    'Empty_AllGo': {
        type: 'pass', tags: ['pass', 'deep', 'hailmary'],
        readProgression: ['WR1', 'WR4'],
        assignments: { 'WR1': 'Fly', 'WR2': 'Seam', 'WR3': 'Seam', 'WR4': 'Fly', 'OL1': 'pass_block', 'OL2': 'pass_block' }
    },
    'Empty_QuickGame': {
        type: 'pass', tags: ['pass', 'short'],
        readProgression: ['WR2', 'WR3'],
        assignments: { 'WR1': 'Hitch', 'WR2': 'Slant', 'WR3': 'Whip', 'WR4': 'Hitch', 'OL1': 'pass_block', 'OL2': 'pass_block' }
    },
    // NEW: Double Post
    'Empty_DoublePost': {
        type: 'pass', tags: ['pass', 'deep', 'middle'],
        readProgression: ['WR2', 'WR3'],
        assignments: { 'WR1': 'Drag', 'WR2': 'Post', 'WR3': 'Post', 'WR4': 'Drag', 'OL1': 'pass_block', 'OL2': 'pass_block' }
    },

    // --- Special Teams ---
    'Punt_Punt': {
        type: 'punt', tags: ['specialTeams'],
        readProgression: [],
        assignments: { 'QB1': 'punt', 'WR1': 'Fly', 'WR2': 'Fly', 'OL1': 'pass_block', 'OL2': 'pass_block', 'OL3': 'pass_block', 'RB1': 'pass_block' }
    }
};

// --- DEFENSIVE FORMATIONS ---
export const defenseFormations = {
    '3-1-3': {
        name: '3-1-3 (Base)',
        slots: ['DL1', 'DL2', 'DL3', 'LB1', 'DB1', 'DB2', 'DB3'],
        personnel: { DL: 3, LB: 1, DB: 3 },
        coordinates: { DL1: [-5, 1], DL2: [0, 1], DL3: [5, 1], LB1: [0, 5], DB1: [-18, 2], DB2: [18, 2], DB3: [0, 12] }
    },
    
    '2-3-2': {
        name: '2-3-2 (Nickel)',
        slots: ['DL1', 'DL2', 'LB1', 'LB2', 'LB3', 'DB1', 'DB2'],
        personnel: { DL: 2, LB: 3, DB: 2 },
        coordinates: { DL1: [-3, 1], DL2: [3, 1], LB1: [-8, 5], LB2: [0, 5], LB3: [8, 5], DB1: [-20, 6], DB2: [20, 6] }
    },
    '4-2-1': {
        name: '4-2-1 (Run Stop)',
        slots: ['DL1', 'DL2', 'DL3', 'DL4', 'LB1', 'LB2', 'DB1'],
        personnel: { DL: 4, LB: 2, DB: 1 },
        coordinates: { 
            // 💡 FIX: Pull Ends from +/- 7 to +/- 5
            DL1: [-5.0, 1], // Left End
            DL2: [-1.5, 1], // Left Tackle (Pinch inside)
            DL3: [1.5, 1],  // Right Tackle (Pinch inside)
            DL4: [5.0, 1],  // Right End
            LB1: [-4, 5], 
            LB2: [4, 5], 
            DB1: [0, 12] 
        }
    },
    '4-0-3': {
        name: '4-0-3 (Dime/Prevent)',
        slots: ['DL1', 'DL2', 'DL3', 'DL4', 'DB1', 'DB2', 'DB3'],
        personnel: { DL: 4, LB: 0, DB: 3 },
        coordinates: { 
            // 💡 FIX: Pull Ends from +/- 8 to +/- 5.5
            DL1: [-5.5, 1], 
            DL2: [-2.0, 1], 
            DL3: [2.0, 1], 
            DL4: [5.5, 1], 
            DB1: [-20, 10], 
            DB2: [20, 10], 
            DB3: [0, 18] 
        }
    },    
    'Punt_Return': {
        name: 'Punt Return',
        slots: ['DL1', 'DL2', 'LB1', 'LB2', 'DB1', 'DB2', 'DB3'],
        coordinates: { DL1: [-3, 1], DL2: [3, 1], LB1: [-10, 8], LB2: [10, 8], DB1: [-15, 30], DB2: [15, 30], DB3: [0, 45] }
    },
    '4-1-2': {
        name: '4-1-2 (Nickel Hybrid)',
        slots: ['DL1', 'DL2', 'DL3', 'DL4', 'LB1', 'DB1', 'DB2'],
        personnel: { DL: 4, LB: 1, DB: 2 },
        coordinates: {
            DL1: [-5.5, 1.0], 
            DL2: [-2.0, 1.0], 
            DL3: [2.0, 1.0], 
            DL4: [5.5, 1.0],
            LB1: [0, 5.0],
            DB1: [-10, 8.0],
            DB2: [10, 8.0]
        },
        slotPriorities: {
            'DL1': { speed: 3, blockShedding: 2 }, // Pass rusher
            'DL2': { strength: 3, weight: 2 },     // Run stuffer
            'DL3': { strength: 3, weight: 2 },     // Run stuffer
            'DL4': { speed: 3, blockShedding: 2 }, // Pass rusher
            'LB1': { tackling: 3, playbookIQ: 2, speed: 2 }, // Field General
            'DB1': { speed: 2, tackling: 2, agility: 2 },    // Hybrid Safety (needs to tackle)
            'DB2': { speed: 3, catchingHands: 2, playbookIQ: 2 } // Deep Safety (Ballhawk)
        }
    },
    '3-0-4': {
        name: '3-0-4 (Dime)',
        slots: ['DL1', 'DL2', 'DL3', 'DB1', 'DB2', 'DB3', 'DB4'],
        personnel: { DL: 3, LB: 0, DB: 4 }, // 4 Defensive Backs!
        coordinates: {
            'DL1': [-5, 1.0],
            'DL2': [0, 1.0],
            'DL3': [5, 1.0],
            // Coverage Shell
            'DB1': [-18, 5.0],  // Left Corner
            'DB2': [18, 5.0],   // Right Corner
            'DB3': [-6, 9.0],   // Left Safety/Slot
            'DB4': [6, 9.0]     // Right Safety/Slot
        },
        slotPriorities: {
            'DL1': { speed: 2, strength: 2 },
            'DL2': { strength: 3, weight: 2 },
            'DL3': { speed: 2, strength: 2 },
            'DB1': { speed: 3, catchingHands: 2 },
            'DB2': { speed: 3, catchingHands: 2 },
            'DB3': { agility: 3, speed: 2, tackling: 1 }, // Slot cover guy
            'DB4': { agility: 3, speed: 2, tackling: 1 }  // Slot cover guy
        }
    }
};

// --- DEFENSIVE PLAYBOOK ---
export const defensivePlaybook = {
    // --- 3-1-3 ---
    'Cover_1_Man_3-1-3': { name: 'Cover 1 Man', compatibleFormations: ['3-1-3'], tags: ['man', 'cover1'], assignments: { 'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush', 'LB1': 'man_cover_RB1', 'DB1': 'man_cover_WR1', 'DB2': 'man_cover_WR2', 'DB3': 'zone_deep_middle' } },
    'Cover_3_Zone_3-1-3': { name: 'Cover 3 Zone', compatibleFormations: ['3-1-3'], tags: ['zone', 'cover3', 'safeZone'], assignments: { 'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush', 'LB1': 'zone_hook_curl_middle', 'DB1': 'zone_deep_third_left', 'DB2': 'zone_deep_third_right', 'DB3': 'zone_deep_middle' } },
    'Zone_Blitz_3-1-3': { name: 'Zone Blitz', compatibleFormations: ['3-1-3'], tags: ['zone', 'blitz'], assignments: { 'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush', 'LB1': 'blitz_gap', 'DB1': 'zone_flat_left', 'DB2': 'zone_flat_right', 'DB3': 'zone_deep_middle' } },

    // --- 4-2-1 (Run Stop) ---
    'GoalLine_RunStuff': { name: 'Goal Line Stuff', compatibleFormations: ['4-2-1'], tags: ['runStop', 'blitz'], assignments: { 'DL1': 'run_edge_left', 'DL2': 'run_gap_A_left', 'DL3': 'run_gap_A_right', 'DL4': 'run_edge_right', 'LB1': 'blitz_gap', 'LB2': 'blitz_gap', 'DB1': 'run_support' } },
    'Cover_0_Blitz_4-2-1': { name: 'Cover 0 All Out', compatibleFormations: ['4-2-1'], tags: ['man', 'blitz', 'cover0'], assignments: { 'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush', 'DL4': 'pass_rush', 'LB1': 'blitz_gap', 'LB2': 'blitz_edge', 'DB1': 'man_cover_WR1' } },

    // --- 2-3-2 (Nickel) ---
    'Cover_2_Zone_2-3-2': { name: 'Tampa 2', compatibleFormations: ['2-3-2'], tags: ['zone', 'cover2'], assignments: { 'DL1': 'pass_rush', 'DL2': 'pass_rush', 'LB1': 'zone_flat_left', 'LB2': 'zone_deep_middle', 'LB3': 'zone_flat_right', 'DB1': 'zone_deep_half_left', 'DB2': 'zone_deep_half_right' } },
    'Double_A_Gap_Blitz': { name: 'Double A Gap Blitz', compatibleFormations: ['2-3-2'], tags: ['blitz', 'man'], assignments: { 'DL1': 'pass_rush', 'DL2': 'pass_rush', 'LB1': 'man_cover_RB1', 'LB2': 'blitz_gap', 'LB3': 'blitz_gap', 'DB1': 'man_cover_WR1', 'DB2': 'man_cover_WR2' } },

    // --- 4-0-3 (Prevent) ---
    'Cover_4_Quarters': { name: 'Cover 4 Quarters', compatibleFormations: ['4-0-3'], tags: ['zone', 'cover4', 'safeZone'], assignments: { 'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush', 'DL4': 'pass_rush', 'DB1': 'zone_deep_third_left', 'DB2': 'zone_deep_third_right', 'DB3': 'zone_deep_middle' } },
    'Victory_Prevent': { name: 'Victory Prevent', compatibleFormations: ['4-0-3'], tags: ['prevent', 'zone'], assignments: { 'DL1': 'spy_QB', 'DL2': 'pass_rush', 'DL3': 'pass_rush', 'DL4': 'spy_QB', 'DB1': 'zone_deep_half_left', 'DB2': 'zone_deep_half_right', 'DB3': 'zone_deep_middle' } },

    // --- Special ---
    'Punt_Return_Return': { name: 'Punt Return', compatibleFormations: ['Punt_Return'], tags: ['specialTeams'], assignments: { 'DL1': 'pass_rush', 'DL2': 'pass_rush', 'LB1': 'run_block', 'LB2': 'run_block', 'DB1': 'punt_return', 'DB2': 'punt_return', 'DB3': 'punt_return' } },
    // --- 4-1-2 (Nickel Hybrid) Plays ---

    'Cover_2_Zone_4-1-2': {
        name: 'Cover 2 Invert (4-1-2)',
        concept: 'Zone',
        blitz: false,
        compatibleFormations: ['4-1-2'],
        tags: ['zone', 'cover2', 'safeZone'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush', 'DL4': 'pass_rush',
            'LB1': 'zone_hook_curl_middle', // Patrols the middle hole
            'DB1': 'zone_deep_half_left',   // Deep Half
            'DB2': 'zone_deep_half_right'   // Deep Half
        }
    },

    'Cover_3_Buzz_4-1-2': {
        name: 'Cover 3 Buzz (4-1-2)',
        concept: 'Zone',
        blitz: false,
        compatibleFormations: ['4-1-2'],
        tags: ['zone', 'cover3'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush', 'DL4': 'pass_rush',
            'LB1': 'zone_hook_curl_left',   // Drops to hook zone
            'DB1': 'zone_hook_curl_right',  // Safety "Buzzes" down to rob the curl
            'DB2': 'zone_deep_middle'       // Single High Safety
        }
    },

    'Man_Free_4-1-2': {
        name: 'Cover 1 Man Free (4-1-2)',
        concept: 'Man',
        blitz: false,
        compatibleFormations: ['4-1-2'],
        tags: ['man', 'cover1'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush', 'DL4': 'pass_rush',
            'LB1': 'man_cover_RB1', // LB takes RB
            'DB1': 'man_cover_WR2', // Strong Safety takes TE/Slot
            // Note: In 4-1-2, DLs don't cover WRs. 
            // We assume Base Corners (not in this formation slot list) exist in logic, 
            // OR if this is 7v7, we rely on the 4-man rush + 3 coverage.
            // Since this is 7-man football:
            'DB2': 'zone_deep_middle' // Free Safety roams deep
        }
    },

    'Double_A_Gap_Blitz_4-1-2': {
        name: 'Double A-Gap Blitz (4-1-2)',
        concept: 'Man',
        blitz: true,
        compatibleFormations: ['4-1-2'],
        tags: ['blitz', 'man', 'aggressive'],
        assignments: {
            'DL1': 'pass_rush', 'DL4': 'pass_rush', // Ends contain
            'DL2': 'run_gap_B_left',  // Tackles slant out
            'DL3': 'run_gap_B_right', // Tackles slant out
            'LB1': 'blitz_gap',       // LB shoots A-Gap
            'DB1': 'blitz_gap',       // Safety shoots the other A-Gap
            'DB2': 'man_cover_WR1'    // Hero coverage
        }
    },

    'LB_Spy_4-1-2': {
        name: 'LB Spy (4-1-2)',
        concept: 'Zone',
        blitz: false,
        compatibleFormations: ['4-1-2'],
        tags: ['zone', 'safeZone', 'spy'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush', 'DL4': 'pass_rush',
            'LB1': 'spy_QB',                // Mirrors the QB
            'DB1': 'zone_deep_half_left',   // Conservative shell
            'DB2': 'zone_deep_half_right'   // Conservative shell
        }
    },
    // --- ADD TO 4-1-2 (Nickel) SECTIONS ---

    'Cover_2_Hard_Flat_4-1-2': {
        name: 'Cover 2 Hard Flat',
        concept: 'Zone',
        blitz: false,
        compatibleFormations: ['4-1-2'],
        tags: ['zone', 'cover2', 'hardFlat', 'press'], // 'hardFlat' tells AI to jump short routes
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush', 'DL4': 'pass_rush',
            'LB1': 'zone_hook_curl_middle',
            'DB1': 'zone_flat_left_hard',   // NEW assignment type (see Step 3)
            'DB2': 'zone_flat_right_hard'   // NEW assignment type
        }
    },
    '2_Man_Press_4-1-2': {
        name: '2 Man Under (Press)',
        concept: 'Man',
        blitz: false,
        compatibleFormations: ['4-1-2'],
        tags: ['man', 'cover2', 'press'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush', 'DL4': 'pass_rush',
            'LB1': 'man_cover_RB1',
            'DB1': 'man_cover_WR1', // Will use press logic
            'DB2': 'man_cover_WR2'  // Will use press logic
        }
    },
    // --- 3-0-4 (Dime) Plays ---
    'Cover_4_Palms_3-0-4': {
        name: 'Cover 4 Palms (3-0-4)',
        concept: 'Zone',
        blitz: false,
        compatibleFormations: ['3-0-4'],
        tags: ['zone', 'cover4', 'safeZone'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush',
            'DB1': 'zone_deep_half_left',   // Deep Out
            'DB2': 'zone_deep_half_right',  // Deep Out
            'DB3': 'zone_short_middle',     // Guarding the seams
            'DB4': 'zone_short_middle'      // Guarding the seams
        }
    },
    'Man_Lock_3-0-4': {
        name: 'Man Lock (3-0-4)',
        concept: 'Man',
        blitz: false,
        compatibleFormations: ['3-0-4'],
        tags: ['man', 'cover1'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush',
            'DB1': 'man_cover_WR1',
            'DB2': 'man_cover_WR2',
            'DB3': 'man_cover_WR3', // Slot Corner
            'DB4': 'man_cover_WR4'  // Slot Corner
        }
    },
    'Slot_Blitz_3-0-4': {
        name: 'Slot Corner Blitz',
        concept: 'Man',
        blitz: true,
        compatibleFormations: ['3-0-4'],
        tags: ['blitz', 'man'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush',
            'DB1': 'man_cover_WR1',
            'DB2': 'man_cover_WR2',
            'DB3': 'blitz_edge',    // Surprise!
            'DB4': 'man_cover_WR3'
        }
    }
};

// --- COACH PERSONALITIES ---
export const coachPersonalities = [
    { type: 'West Coast Offense', preferredOffense: 'Spread', preferredDefense: '2-3-2', attributePreferences: { physical: { speed: 1.4 }, mental: { playbookIQ: 1.6 }, technical: { throwingAccuracy: 1.8 } } },
    { type: 'Ground and Pound', preferredOffense: 'Power', preferredDefense: '4-2-1', attributePreferences: { physical: { strength: 1.8 }, mental: { toughness: 1.5 }, technical: { blocking: 1.8 } } },
    { type: 'Blitz-Happy Defense', preferredOffense: 'Balanced', preferredDefense: '4-2-1', attributePreferences: { physical: { speed: 1.6 }, mental: { clutch: 1.4 }, technical: { tackling: 1.8 } } },
    { type: 'Balanced', preferredOffense: 'Balanced', preferredDefense: '3-1-3', attributePreferences: { physical: { speed: 1.2 }, mental: { playbookIQ: 1.2 }, technical: { tackling: 1.2 } } },
    { type: 'The Moneyballer', preferredOffense: 'Spread', preferredDefense: '3-1-3', attributePreferences: { physical: { speed: 0.8 }, mental: { playbookIQ: 2.0 }, technical: { catchingHands: 1.5 } } },
    { type: 'Air Raid', preferredOffense: 'Empty', preferredDefense: '2-3-2', attributePreferences: { physical: { speed: 1.8 }, mental: { playbookIQ: 0.8 }, technical: { throwingAccuracy: 1.5 } } },
    { type: 'Trench Warfare', preferredOffense: 'Power', preferredDefense: '4-2-1', attributePreferences: { physical: { strength: 2.0 }, mental: { toughness: 1.5 }, technical: { blocking: 2.0 } } }
];