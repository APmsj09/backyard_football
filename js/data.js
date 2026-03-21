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
    'Flat': { path: [{ x: 3, y: 1 }, { x: 8, y: 1.5 }] },
    'Slant': { path: [{ x: 0, y: 1.5 }, { x: -6, y: 6 }] }, // Stem up, hard cut in
    'QuickOut': { path: [{ x: 0, y: 3 }, { x: 5, y: 3.5 }] },
    'Hitch': { path: [{ x: 0, y: 6 }, { x: 1, y: 5 }] }, // Run 6, turn back to 5
    'Drag': { path: [{ x: 0, y: 1.5 }, { x: -10, y: 2.5 }, { x: -20, y: 3.5 }] },
    'Whip': { path: [{ x: 0, y: 4 }, { x: -2, y: 4 }, { x: 4, y: 4 }] },
    'Bubble': { path: [{ x: 4, y: -1 }, { x: 8, y: 0 }] },
    'Jet_Motion': { path: [{ x: 12, y: -1 }] }, // Fast motion across formation

    // --- Medium Routes (8-15 yards) ---
    'Out': { path: [{ x: 0, y: 10 }, { x: 8, y: 10 }] },
    'In': { path: [{ x: 0, y: 10 }, { x: -8, y: 10 }] },
    'Dig': { path: [{ x: 0, y: 12 }, { x: -10, y: 12 }] }, // Deeper square in
    'Curl': { path: [{ x: 0, y: 12 }, { x: 2, y: 12 }, { x: 2, y: 10 }] },
    'Comeback': { path: [{ x: 0, y: 15 }, { x: 2, y: 15.5 }, { x: 6, y: 12 }] },
    'Corner': { path: [{ x: 0, y: 10 }, { x: -1, y: 12 }, { x: 10, y: 22 }] }, // Stem, fake in, break out
    'Post': { path: [{ x: 0, y: 10 }, { x: 1, y: 12 }, { x: -10, y: 22 }] },   // Stem, fake out, break in

    // --- Deep Routes (20+ yards) ---
    'Fly': { path: [{ x: 0, y: 10 }, { x: 0.5, y: 20 }, { x: 0, y: 40 }] },   // Slight weave to shake press
    'Seam': { path: [{ x: 0, y: 40 }] },
    'Fade': { path: [{ x: 1, y: 10 }, { x: 3, y: 35 }] },
    'PostCorner': { path: [{ x: 0, y: 12 }, { x: -4, y: 16 }, { x: 8, y: 25 }] }, // Double move
    'Sluggo': { path: [{ x: -1, y: 2 }, { x: -3, y: 5 }, { x: -3, y: 25 }] },

    // --- Receiver Screen Specific ---
    'WR_Screen_Catch': { path: [{ x: -2, y: -1 }, { x: 2, y: 0 }] }, // Step back/lateral to catch
    'WR_Screen_Lead': { path: [{ x: 0, y: 1 }, { x: 3, y: 2 }] },   // Drive defender back then seal
    'Tunnel_Screen_Catch': { path: [{ x: 5, y: -1 }, { x: 2, y: 1 }] }, // Run inside toward the OL for a wall

    // --- Advanced Double Moves ---
    'Out_And_Up': { path: [{ x: 0, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 30 }] },
    'Hitch_And_Go': { path: [{ x: 0, y: 5 }, { x: 0, y: 3 }, { x: 0, y: 30 }] },
    

    // --- Passing Concept Routes ---
    'Scissors_Corner': { path: [{ x: 0, y: 8 }, { x: 10, y: 20 }] },
    'Scissors_Post': { path: [{ x: 0, y: 12 }, { x: -8, y: 30 }] },

    // --- Running Back Pass Routes ---
    'Wheel': { path: [{ x: 4, y: 1 }, { x: 6, y: 8 }, { x: 6, y: 25 }] },
    'Angle': { path: [{ x: 3, y: 2 }, { x: -2, y: 6 }] },
    'Screen': { path: [{ x: -2, y: -1 }, { x: -4, y: -0.5 }] },
    'Slip_Screen': { path: [{ x: 0, y: 2 }, { x: 4, y: 0 }] }, // Fake block, slip out
    'CheckRelease': { path: [{ x: 0, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 4 }] },
    'Texas': { path: [{ x: 3, y: 1 }, { x: 5, y: 4 }, { x: -3, y: 9 }] }, // RB angle route

    // --- RB Run Designs (Initial Paths) ---
    'run_dive': { path: [{ x: 0, y: 2 }, { x: 0, y: 5 }] },
    'run_iso_l': { path: [{ x: -1.5, y: 1 }, { x: -1.5, y: 5 }] },
    'run_iso_r': { path: [{ x: 1.5, y: 1 }, { x: 1.5, y: 5 }] },
    'run_stretch_r': { path: [{ x: 6, y: 0.5 }, { x: 10, y: 4 }] },
    'run_stretch_l': { path: [{ x: -6, y: 0.5 }, { x: -10, y: 4 }] },
    'run_counter_r': { path: [{ x: -2, y: -0.5 }, { x: 1, y: 1 }, { x: 5, y: 5 }] },
    'run_counter_l': { path: [{ x: 2, y: -0.5 }, { x: -1, y: 1 }, { x: -5, y: 5 }] },
    'run_toss_r': { path: [{ x: 10, y: -1 }, { x: 14, y: 4 }] },

    // --- ADVANCED BLOCKING ROUTES ---
    'run_block': { path: [{ x: 0, y: 0 }] }, // Stationary target seeking
    'pass_block': { path: [{ x: 0, y: -1.0 }] },
    'pull_right': { path: [{ x: -0.5, y: -1.0 }, { x: 4, y: -0.5 }, { x: 5, y: 3 }] }, // Step back, run right, turn up
    'pull_left': { path: [{ x: 0.5, y: -1.0 }, { x: -4, y: -0.5 }, { x: -5, y: 3 }] },
    'lead_right': { path: [{ x: 3, y: 1 }, { x: 4, y: 4 }] }, // FB leading off tackle
    'lead_left': { path: [{ x: -3, y: 1 }, { x: -4, y: 4 }] },
    'screen_block': { path: [{ x: 0, y: -1 }, { x: -5, y: -0.5 }, { x: -8, y: 5 }] }, // Let DL past, set up wall
    'Screen_Wait': { path: [{ x: 0, y: -1 }, { x: 4, y: -1 }, { x: 5, y: 1 }] }, // Step back, drift wide, wait
    'Wall_Alley_Left': { path: [{ x: -2, y: -1 }, { x: -8, y: 1 }, { x: -10, y: 5 }] }, // Leak, then set alley
    'Wall_Alley_Right': { path: [{ x: 2, y: -1 }, { x: 8, y: 1 }, { x: 10, y: 5 }] },
};

// --- OFFENSIVE FORMATIONS ---
export const offenseFormations = {
    'Balanced': {
        name: 'Balanced',
        slots: ['QB1', 'RB1', 'WR1', 'WR2', 'TE1', 'OL1', 'OL2', 'OL3'],
        personnel: { QB: 1, RB: 1, WR: 2, TE: 1, OL: 3 },
        mapping: { QB: 'QB1', RB: 'RB1', X: 'WR1', Z: 'WR2', Y: 'TE1', OL: ['OL1', 'OL2', 'OL3'] },
        coordinates: {
            QB1: [0, -6.0],     // 💡 FIX: Shotgun depth to allow plays to develop
            RB1: [-1.5, -6.0],
            WR1: [-15, 0.5],
            WR2: [15, 0.5],
            TE1: [2.8, -1.5],
            OL1: [-1.4, -1.5],
            OL2: [0, -1.5],
            OL3: [1.4, -1.5]
        },
        slotPriorities: {
            QB1: { throwingAccuracy: 3, playbookIQ: 2 },
            RB1: { speed: 2, agility: 2, catchingHands: 1 },
            WR1: { speed: 3, catchingHands: 3 },
            WR2: { speed: 3, catchingHands: 3 },
            TE1: { blocking: 2, catchingHands: 2, strength: 2 },
            OL1: { strength: 3, blocking: 3 },
            OL2: { strength: 3, blocking: 3, playbookIQ: 1 },
            OL3: { strength: 3, blocking: 3 }
        }
    },
    'Spread': {
        name: 'Spread',
        slots: ['QB1', 'WR1', 'WR2', 'WR3', 'WR4', 'OL1', 'OL2', 'OL3'],
        personnel: { QB: 1, RB: 0, WR: 4, OL: 3 },
        mapping: { QB: 'QB1', X: 'WR1', Z: 'WR2', H: 'WR3', Y: 'WR4', OL: ['OL1', 'OL2', 'OL3'] },
        coordinates: {
            QB1: [0, -6.0],      // 💡 FIX: Standard shotgun depth
            WR1: [-16, 0.5],
            WR2: [16, 0.5],
            WR3: [-6, 0.5],
            WR4: [6, 0.5],
            OL1: [-1.4, -1.5],
            OL2: [0, -1.5],
            OL3: [1.4, -1.5]
        },
        slotPriorities: {
            QB1: { throwingAccuracy: 3, playbookIQ: 2 },
            WR1: { speed: 3, catchingHands: 3 },
            WR2: { speed: 3, catchingHands: 3 },
            WR3: { agility: 3, catchingHands: 3, speed: 2 },
            WR4: { agility: 3, catchingHands: 3, speed: 2 },
            OL1: { strength: 3, blocking: 3 },
            OL2: { strength: 3, blocking: 3 },
            OL3: { strength: 3, blocking: 3 }
        }
    },
    'Power': {
        name: 'Power I',
        slots: ['QB1', 'RB1', 'RB2', 'WR1', 'TE1', 'OL1', 'OL2', 'OL3'],
        personnel: { QB: 1, RB: 2, WR: 1, TE: 1, OL: 3 },
        mapping: { QB: 'QB1', RB: 'RB1', RB2: 'RB2', X: 'WR1', Y: 'TE1', OL: ['OL1', 'OL2', 'OL3'] },
        coordinates: {
            QB1: [0, -3.0],     // 💡 FIX: Give under-center QB more clearance from OL
            RB1: [0, -7.5],    // Tailback deep
            RB2: [0, -5.0],    // Fullback leading
            WR1: [14, 0.5],
            TE1: [-2.8, -1.5],
            OL1: [-1.4, -1.5],
            OL2: [0, -1.5],
            OL3: [1.4, -1.5]
        },
        slotPriorities: {
            QB1: { strength: 2, playbookIQ: 2 },
            RB1: { strength: 3, speed: 2 },
            RB2: { blocking: 3, strength: 3 },
            WR1: { blocking: 2, catchingHands: 2 },
            TE1: { blocking: 3, strength: 3 },
            OL1: { strength: 3, blocking: 3 },
            OL2: { strength: 3, blocking: 3 },
            OL3: { strength: 3, blocking: 3 }
        }
    },
    'Trips': {
        name: 'Trips Right',
        slots: ['QB1', 'RB1', 'WR1', 'WR2', 'WR3', 'OL1', 'OL2', 'OL3'],
        personnel: { QB: 1, RB: 1, WR: 3, OL: 3 },
        mapping: { QB: 'QB1', RB: 'RB1', X: 'WR1', H: 'WR2', Y: 'WR3', OL: ['OL1', 'OL2', 'OL3'] },
        coordinates: {
            QB1: [0, -6.0],     // 💡 FIX: Standard shotgun depth
            RB1: [-2.0, -6.0],
            WR1: [16, 0.5],
            WR2: [10, 0.5],
            WR3: [5, 0.5],
            OL1: [-1.4, -1.5],
            OL2: [0, -1.5],
            OL3: [1.4, -1.5]
        },
        slotPriorities: {
            QB1: { throwingAccuracy: 3, playbookIQ: 2 },
            RB1: { blocking: 2, catchingHands: 2 },
            WR1: { speed: 3, catchingHands: 2 },
            WR2: { agility: 3, catchingHands: 2 },
            WR3: { agility: 3, catchingHands: 2 },
            OL1: { blocking: 3, strength: 3 },
            OL2: { blocking: 3, strength: 3 },
            OL3: { blocking: 3, strength: 3 }
        }
    },
    // --- TRIPS LEFT (3 Receivers to the Left) ---
    'TripsLeft': {
        name: 'Trips Left',
        slots: ['QB1', 'RB1', 'WR1', 'WR2', 'WR3', 'OL1', 'OL2', 'OL3'],
        personnel: { QB: 1, RB: 1, WR: 3, OL: 3 },
        mapping: { QB: 'QB1', RB: 'RB1', X: 'WR1', H: 'WR2', Y: 'WR3', OL: ['OL1', 'OL2', 'OL3'] },
        coordinates: {
            QB1: [0, -6.0],     // Shotgun
            RB1: [2.0, -6.0],   // Offset Right
            WR1: [-16, 0.5],    // X (Far Left)
            WR2: [-10, 0.5],    // H (Slot Left)
            WR3: [-5, 0.5],     // Y (Inner Slot Left)
            OL1: [-1.4, -1.5], OL2: [0, -1.5], OL3: [1.4, -1.5]
        }
    },

    // --- EMPTY SPREAD (No RB, 5 Wide Receivers/Slots) ---
    'Empty': {
        name: 'Empty Spread',
        slots: ['QB1', 'WR1', 'WR2', 'WR3', 'WR4', 'WR5', 'OL1', 'OL2', 'OL3'],
        personnel: { QB: 1, WR: 5, OL: 3 },
        // Note: RB role is mapped to WR5 in this formation
        mapping: { QB: 'QB1', X: 'WR1', Z: 'WR2', H: 'WR3', Y: 'WR4', RB: 'WR5', OL: ['OL1', 'OL2', 'OL3'] },
        coordinates: {
            QB1: [0, -7.0],      // Deep Shotgun
            WR1: [-18, 0.5],     // X (Far Left)
            WR2: [18, 0.5],      // Z (Far Right)
            WR3: [-8, 0.5],      // H (Slot Left)
            WR4: [8, 0.5],       // Y (Slot Right)
            WR5: [3, -2.0],      // RB role (Stand-up Slot)
            OL1: [-1.4, -1.5], OL2: [0, -1.5], OL3: [1.4, -1.5]
        }
    },

    // --- PISTOL (RB is directly behind QB) ---
    'Pistol': {
        name: 'Pistol Balanced',
        slots: ['QB1', 'RB1', 'WR1', 'WR2', 'TE1', 'OL1', 'OL2', 'OL3'],
        mapping: { QB: 'QB1', RB: 'RB1', X: 'WR1', Z: 'WR2', Y: 'TE1', OL: ['OL1', 'OL2', 'OL3'] },
        coordinates: {
            QB1: [0, -4.0],
            RB1: [0, -7.0],
            WR1: [-15, 0.5],
            WR2: [15, 0.5], // Changed from Z to WR2
            TE1: [2.8, -1.5],
            OL1: [-1.4, -1.5], OL2: [0, -1.5], OL3: [1.4, -1.5]
        }
    },

    // --- JUMBO (Heavy Goal Line) ---
    'Jumbo': {
        name: 'Jumbo',
        slots: ['QB1', 'RB1', 'RB2', 'TE1', 'TE2', 'OL1', 'OL2', 'OL3'],
        mapping: { QB: 'QB1', RB: 'RB1', RB2: 'RB2', X: 'TE1', Y: 'TE2', OL: ['OL1', 'OL2', 'OL3'] },
        coordinates: {
            QB1: [0, -1.0],
            RB1: [0, -4.5],
            RB2: [0, -2.5],
            TE1: [-2.8, -1.5], // Changed from X to TE1
            TE2: [2.8, -1.5],  // Changed from Y to TE2
            OL1: [-1.4, -1.5], OL2: [0, -1.5], OL3: [1.4, -1.5]
        }
    },

    // --- WILDCAT (RB takes the snap, QB is a receiver) ---
    'Wildcat': {
        name: 'Wildcat',
        slots: ['RB1', 'QB1', 'WR1', 'WR2', 'TE1', 'OL1', 'OL2', 'OL3'],
        personnel: { RB: 1, QB: 1, WR: 2, TE: 1, OL: 3 },
        // IMPORTANT: RB1 is mapped to the QB role (he takes the snap)
        mapping: { QB: 'RB1', RB: 'QB1', X: 'WR1', Z: 'WR2', Y: 'TE1', OL: ['OL1', 'OL2', 'OL3'] },
        coordinates: {
            RB1: [0, -5.0],      // RB takes snap
            QB1: [-10, 0.5],     // Real QB split wide as a decoy
            WR1: [-18, 0.5], WR2: [15, 0.5],
            TE1: [2.8, -1.5],
            OL1: [-1.4, -1.5], OL2: [0, -1.5], OL3: [1.4, -1.5]
        }
    },

    'Punt': {
        name: 'Punt',
        personnel: { OL: 3, WR: 2, QB: 1, RB: 1, TE: 1 },
        slots: ['OL1', 'OL2', 'OL3', 'WR1', 'WR2', 'RB1', 'TE1', 'QB1'],
        coordinates: {
            QB1: [0, -12.0],
            RB1: [2.0, -3.0],  // Personal protector/Upback
            TE1: [-2.8, -1.5], // Wing blocker
            WR1: [-16, 0.5],   // Gunners
            WR2: [16, 0.5],
            OL1: [-1.4, -1.5],
            OL2: [0, -1.5],
            OL3: [1.4, -1.5]
        },
        slotPriorities: {
            QB1: { strength: 3, throwingAccuracy: 2 },
            OL1: { blocking: 3, strength: 2 },
            OL2: { blocking: 3, strength: 1 },
            OL3: { blocking: 3, strength: 1 },
            RB1: { blocking: 3, playbookIQ: 2 },
            TE1: { blocking: 3, strength: 2 },
            WR1: { speed: 3, tackling: 2 },
            WR2: { speed: 3, tackling: 2 }
        }
    }
};

// --- OFFENSIVE PLAYBOOK (8-Man Optimized) ---
export const offensivePlaybook = {
    // ===================================
    // --- RUNNING CONCEPTS
    // ===================================
    'Uni_InsideZone': {
        type: 'run', tags: ['run', 'inside'],
        assignments: {
            'QB': 'qb_setup', 'RB': 'run_dive', 'OL': 'run_block',
            'X': 'run_block', 'Z': 'run_block', 'Y': 'run_block', 'H': 'run_block'
        }
    },
    'Uni_StretchRight': {
        type: 'run', tags: ['run', 'outside'],
        assignments: {
            'QB': 'qb_setup', 'RB': 'run_stretch_r', 'OL': 'run_block',
            'X': 'run_block', 'Z': 'run_block', 'Y': 'run_block', 'H': 'run_block'
        }
    },
    // 💡 NEW: Advanced Pulling Guard Concept
    'Uni_Counter_Trap': {
        type: 'run', tags: ['run', 'counter', 'misdirection'],
        assignments: {
            'QB': 'qb_setup', 'RB': 'run_counter_r',
            'OL1': 'pull_right', 'OL2': 'run_block', 'OL3': 'run_block', // Left Tackle pulls!
            'Y': 'run_block', 'X': 'run_block', 'Z': 'run_block', 'H': 'run_block'
        }
    },
    'Uni_PowerLead': {
        type: 'run', tags: ['run', 'inside', 'power'],
        assignments: {
            'QB': 'qb_setup', 'RB': 'run_iso_r', 'RB2': 'lead_right', // FB Leads the way
            'OL': 'run_block', 'Y': 'run_block', 'X': 'run_block', 'Z': 'run_block'
        }
    },
    'Uni_JetSweep': {
        type: 'run', tags: ['run', 'outside', 'speed'],
        assignments: {
            'QB': 'qb_setup', 'RB': 'run_block', 'H': 'run_stretch_l', // Slot WR takes the handoff
            'OL': 'run_block', 'X': 'run_block', 'Z': 'run_block', 'Y': 'pull_left'
        }
    },

    // ===================================
    // --- PASSING CONCEPTS (QUICK / SCREENS)
    // ===================================
    'Uni_QuickSlants': {
        type: 'pass', tags: ['pass', 'quick', 'short'],
        readProgression: ['X', 'Z', 'H', 'RB'],
        assignments: {
            'QB': 'qb_setup', 'X': 'Slant', 'Z': 'Slant', 'H': 'Slant',
            'Y': 'Hitch', 'RB': 'Flat', 'OL': 'pass_block'
        }
    },
    'Uni_Stick': {
        type: 'pass', tags: ['pass', 'short'],
        readProgression: ['Y', 'H', 'RB'],
        assignments: {
            'QB': 'qb_setup', 'Y': 'QuickOut', 'H': 'Hitch', 'X': 'Fade',
            'Z': 'Fade', 'RB': 'Flat', 'OL': 'pass_block'
        }
    },
    // 💡 NEW: Running Back Screen
    'Uni_HB_Screen': {
        type: 'pass', tags: ['pass', 'screen'],
        readProgression: ['RB', 'X'],
        assignments: {
            'QB': 'qb_setup', 'RB': 'Slip_Screen', 'X': 'Fly', 'Z': 'Fly',
            'Y': 'Fly', 'H': 'Fly',
            'OL1': 'screen_block', 'OL2': 'screen_block', 'OL3': 'pass_block'
        }
    },

    // ===================================
    // --- SCREEN CONCEPTS
    // ===================================
    'Uni_Trips_WR_Screen': {
        type: 'pass', tags: ['pass', 'screen', 'trips'],
        compatibleFormations: ['Trips', 'TripsLeft', 'Spread'],
        readProgression: ['H', 'X'],
        assignments: {
            'QB': 'qb_setup',
            'H': 'WR_Screen_Catch',  // The target (Slot)
            'X': 'WR_Screen_Lead',   // Outside blocker
            'Y': 'WR_Screen_Lead',   // Inside blocker
            'Z': 'Fly',              // Decoy back side
            'RB': 'pass_block',
            'OL': 'screen_block'
        }
    },
    'Uni_Tunnel_Screen': {
        type: 'pass', tags: ['pass', 'screen', 'quick'],
        readProgression: ['X', 'RB'],
        assignments: {
            'QB': 'qb_setup',
            'X': 'Tunnel_Screen_Catch',
            'H': 'WR_Screen_Lead',
            'OL1': 'screen_block', 'OL2': 'screen_block', 'OL3': 'run_block',
            'Z': 'Fly', 'RB': 'Flat'
        }
    },
    'Uni_HB_Screen_Left': {
        type: 'pass', tags: ['pass', 'screen', 'slow-mesh'],
        readProgression: ['RB'],
        assignments: {
            'QB': 'qb_screen_retreat', 
            'RB': 'Screen_Wait',
            'OL1': 'Wall_Alley_Left', 'OL2': 'Wall_Alley_Left', 'OL3': 'pass_block',
            'X': 'Fly', 'Z': 'Post', 'Y': 'Fly' // Clear out deep defenders
        }
    },
    'Uni_WR_Screen_Right': {
        type: 'pass', tags: ['pass', 'screen', 'quick'],
        readProgression: ['Z'],
        assignments: {
            'QB': 'qb_setup',
            'Z': 'Screen_Wait',
            'RB': 'pass_block',
            'OL1': 'pass_block', 'OL2': 'Wall_Alley_Right', 'OL3': 'Wall_Alley_Right',
            'X': 'Fly', 'Y': 'Seam'
        }
    },

    // ===================================
    // --- PASSING CONCEPTS (MEDIUM / DEEP)
    // ===================================
    'Uni_FourVerts': {
        type: 'pass', tags: ['pass', 'deep', 'vertical'],
        readProgression: ['X', 'Z', 'H', 'Y'],
        assignments: {
            'QB': 'qb_setup', 'X': 'Fly', 'Z': 'Fly', 'H': 'Seam',
            'Y': 'Seam', 'RB': 'CheckRelease', 'OL': 'pass_block'
        }
    },
    'Uni_Drive': {
        type: 'pass', tags: ['pass', 'medium', 'cross'],
        readProgression: ['H', 'Y', 'Z'],
        assignments: {
            'QB': 'qb_setup', 'H': 'Drag', 'Y': 'Dig', 'X': 'Fly',
            'Z': 'Comeback', 'RB': 'Flat', 'OL': 'pass_block'
        }
    },

    'Uni_Scissors': {
        type: 'pass', tags: ['pass', 'deep', 'cross'],
        readProgression: ['Z', 'X', 'Y'],
        assignments: {
            'QB': 'qb_setup',
            'Z': 'Scissors_Post',   // Deep post from outside
            'X': 'Scissors_Corner', // Corner route from inside
            'Y': 'In',
            'H': 'Drag',
            'RB': 'CheckRelease', 'OL': 'pass_block'
        }
    },
    'Uni_Levels': {
        type: 'pass', tags: ['pass', 'medium', 'zone-beater'],
        readProgression: ['H', 'Y', 'RB'],
        assignments: {
            'QB': 'qb_setup',
            'X': 'Fly',
            'Z': 'In',      // Level 3 (12yd)
            'Y': 'Dig',     // Level 2 (10yd)
            'H': 'Out',     // Level 1 (5yd)
            'RB': 'Flat',   // Level 0
            'OL': 'pass_block'
        }
    },
    'Uni_Dagger': {
        type: 'pass', tags: ['pass', 'deep', 'seam'],
        readProgression: ['X', 'H', 'Y'],
        assignments: {
            'QB': 'qb_setup',
            'H': 'Seam',     // The "Clear out" route
            'X': 'Dig',      // The "Dagger" underneath the seam
            'Z': 'Fly',
            'Y': 'Drag',
            'RB': 'CheckRelease', 'OL': 'pass_block'
        }
    },
    'Uni_Double_Moves': {
        type: 'pass', tags: ['pass', 'deep', 'trick'],
        readProgression: ['X', 'Z'],
        assignments: {
            'QB': 'qb_setup',
            'X': 'Sluggo',
            'Z': 'Out_And_Up',
            'Y': 'Seam',
            'H': 'Hitch_And_Go',
            'RB': 'pass_block', 'OL': 'pass_block'
        }
    },

    // --- SYMMETRICAL RUNS ---
    'Uni_PowerLead_Left': {
        type: 'run', tags:['run', 'inside', 'power'],
        assignments: {
            'QB': 'qb_setup', 'RB': 'run_iso_l', 'RB2': 'lead_left', 
            'OL': 'run_block', 'Y': 'run_block', 'X': 'run_block', 'Z': 'run_block'
        }
    },
    'Uni_Toss_Right': {
        type: 'run', tags:['run', 'outside', 'toss'],
        assignments: {
            'QB': 'qb_setup', 'RB': 'run_toss_r', 
            'OL1': 'pull_right_wide', 'OL2': 'run_block', 'OL3': 'run_block', // Left Guard pulls all the way right
            'Y': 'run_block', 'X': 'run_block', 'Z': 'run_block', 'H': 'run_block'
        }
    },
    'Uni_Toss_Left': {
        type: 'run', tags: ['run', 'outside', 'toss'],
        assignments: {
            'QB': 'qb_setup', 'RB': 'run_toss_l', 
            'OL1': 'run_block', 'OL2': 'run_block', 'OL3': 'pull_left_wide', // Right Guard pulls all the way left
            'Y': 'run_block', 'X': 'run_block', 'Z': 'run_block', 'H': 'run_block'
        }
    },

    // --- SYMMETRICAL / CONCEPT PASSES ---
    'Uni_Mesh': {
        type: 'pass', tags: ['pass', 'short', 'cross'],
        readProgression: ['X', 'Z', 'RB'],
        assignments: {
            'QB': 'qb_setup', 
            'X': 'Mesh_Right', 'Z': 'Mesh_Left', // The rubbing crossers
            'H': 'Corner', 'Y': 'Corner',        // Clear out the safeties
            'RB': 'Texas', 'OL': 'pass_block'
        }
    },
    'Uni_Flood_Right': {
        type: 'pass', tags:['pass', 'medium', 'flood'],
        readProgression: ['Z', 'H', 'Y'],
        assignments: {
            'QB': 'qb_setup', 
            'Z': 'Flood_Deep', // Pushes safety back
            'H': 'Flood_Out',  // Medium out (Primary read)
            'Y': 'Flat',       // Short out
            'X': 'Dig',        // Backside dig to keep MLB honest
            'RB': 'pass_block', 'OL': 'pass_block'
        }
    },

    // ===================================
    // --- PLAY ACTION CONCEPTS
    // ===================================
    // 💡 NEW: Play Action creates massive separation if it fools the Linebackers
    'PA_Crossers': {
        type: 'pass', tags: ['pass', 'pa', 'deep'],
        readProgression: ['Y', 'Z', 'X'],
        assignments: {
            'QB': 'qb_setup', 'RB': 'run_dive', // Fake dive
            'X': 'Post', 'Y': 'Drag', 'Z': 'Dig', 'H': 'Corner', 'OL': 'pass_block'
        }
    },
    'PA_Bootleg_Right': {
        type: 'pass', tags: ['pass', 'pa', 'rollout'],
        readProgression: ['Z', 'Y', 'H'],
        assignments: {
            'QB': 'qb_scramble', 'RB': 'run_stretch_l', // Fake left, QB rolls right
            'Z': 'Corner', 'Y': 'Drag', 'X': 'Dig', 'H': 'Flat', 'OL': 'pass_block'
        }
    },
    'PA_Deep_Shot': {
        type: 'pass', tags: ['pass', 'pa', 'deep'],
        readProgression: ['X', 'Z', 'Y'],
        assignments: {
            'QB': 'qb_setup',
            'RB': 'run_dive', // Heavy PA fake
            'X': 'PostCorner', 'Z': 'Fly', 'Y': 'Seam',
            'H': 'Drag', 'OL': 'pass_block'
        }
    },
    'RPO_Bubble_Slant': {
        type: 'pass', tags: ['rpo', 'quick'],
        readProgression: ['H', 'X', 'RB'],
        assignments: {
            'QB': 'qb_rpo_read',
            'RB': 'run_dive',
            'H': 'Bubble',
            'X': 'Slant',
            'Z': 'Fly',
            'OL': 'run_block'
        }
    },

    // ===================================
    // --- RPO CONCEPTS
    // ===================================
    'RPO_Slant_Dive': {
        type: 'pass', tags: ['rpo', 'quick'],
        assignments: {
            'QB': 'qb_rpo_read', 'RB': 'run_dive', 'X': 'Slant',
            'Z': 'Fly', 'H': 'Slant', 'Y': 'run_block', 'OL': 'run_block'
        }
    },

    // ===================================
    // --- TRICK PLAYS
    // ===================================
    'Trick_Flea_Flicker': {
        type: 'pass', tags: ['trick', 'deep'],
        assignments: {
            'QB': 'qb_flea_flicker', 'RB': 'run_dive', 'X': 'Fly',
            'Z': 'PostCorner', 'Y': 'Seam', 'H': 'Fly', 'OL': 'pass_block'
        }
    },

    // --- Special Teams ---
    'Punt_Punt': {
        type: 'punt', tags: ['specialTeams'],
        readProgression: [],
        assignments: {
            'QB1': 'punt', 'WR1': 'Fly', 'WR2': 'Fly',
            'OL1': 'pass_block', 'OL2': 'pass_block', 'OL3': 'pass_block',
            'RB1': 'pass_block', 'TE1': 'pass_block'
        }
    }
};

// --- DEFENSIVE FORMATIONS ---
export const defenseFormations = {
    '3-2-3': {
        name: '3-2-3 (Base)',
        slots: ['DL1', 'DL2', 'DL3', 'LB1', 'LB2', 'DB1', 'DB2', 'DB3'],
        personnel: { DL: 3, LB: 2, DB: 3 },
        coordinates: {
            DL1: [-2.8, 1.0], // 5-Tech (Outside edge of Tackle)
            DL2: [0, 1.0],    // 0-Tech (Nose Tackle)
            DL3: [2.8, 1.0],
            LB1: [-3.5, 4.5], // Moved down to fill gaps
            LB2: [3.5, 4.5],
            DB1: [-14, 7.0],
            DB2: [14, 7.0],
            DB3: [0, 12.0]
        },
        slotPriorities: {
            'DL1': { strength: 3, blockShedding: 3 },
            'DL2': { strength: 3, weight: 3 },
            'DL3': { strength: 3, blockShedding: 3 },
            'LB1': { tackling: 3, speed: 2, playbookIQ: 2 },
            'LB2': { tackling: 3, speed: 2, playbookIQ: 2 },
            'DB1': { speed: 3, catchingHands: 2, playbookIQ: 3 },
            'DB2': { speed: 3, catchingHands: 2, playbookIQ: 3 },
            'DB3': { agility: 3, playbookIQ: 3, tackling: 2 } // Safety
        }
    },

    '2-3-3': {
        name: '2-3-3 (Nickel)',
        slots: ['DL1', 'DL2', 'LB1', 'LB2', 'LB3', 'DB1', 'DB2', 'DB3'],
        personnel: { DL: 2, LB: 3, DB: 3 },
        coordinates: {
            DL1: [-1.5, 1.0], // 3-Tech (Over Guards)
            DL2: [1.5, 1.0],
            LB1: [-4.0, 4.5],
            LB2: [0, 4.5],    // Middle Linebacker
            LB3: [4.0, 4.5],
            DB1: [-15, 7.0],
            DB2: [15, 7.0],
            DB3: [0, 12.0]
        },
        slotPriorities: {
            'DL1': { strength: 3, blockShedding: 3, weight: 2 },
            'DL2': { strength: 3, weight: 3, blockShedding: 3 },
            'LB1': { tackling: 3, speed: 2, playbookIQ: 2 },
            'LB2': { tackling: 3, speed: 2, playbookIQ: 2 },
            'LB3': { tackling: 3, speed: 2, playbookIQ: 2 },
            'DB1': { speed: 3, catchingHands: 2, playbookIQ: 3 },
            'DB2': { speed: 3, catchingHands: 2, playbookIQ: 3 },
            'DB3': { agility: 3, playbookIQ: 3, tackling: 2 } // Safety
        }
    },
    '4-2-2': {
        name: '4-2-2 (Run Stop)',
        slots: ['DL1', 'DL2', 'DL3', 'DL4', 'LB1', 'LB2', 'DB1', 'DB2'],
        personnel: { DL: 4, LB: 2, DB: 2 },
        coordinates: {
            DL1: [-3.0, 1.0], // End
            DL2: [-1.0, 1.0], // Tackle (A/B Gap)
            DL3: [1.0, 1.0],  // Tackle (A/B Gap)
            DL4: [3.0, 1.0],  // End
            LB1: [-2.5, 4.0], // Aggressive downhill depth
            LB2: [2.5, 4.0],
            DB1: [-12, 8.0],
            DB2: [12, 8.0]
        },
        slotPriorities: {
            'DL1': { strength: 3, blockShedding: 3, weight: 2 },
            'DL2': { strength: 3, blockShedding: 2, weight: 3 },
            'DL3': { strength: 3, blockShedding: 2, weight: 3 },
            'DL4': { strength: 3, blockShedding: 3, weight: 2 },
            'LB1': { tackling: 3, speed: 2, playbookIQ: 2 },
            'LB2': { tackling: 3, speed: 2, playbookIQ: 2 },
            'DB1': { speed: 3, catchingHands: 2, playbookIQ: 3 },
            'DB2': { speed: 3, catchingHands: 2, playbookIQ: 3 }
        }
    },
    '4-1-3': {
        name: '4-1-3 (Dime/Prevent)',
        slots: ['DL1', 'DL2', 'DL3', 'DL4', 'LB1', 'DB1', 'DB2', 'DB3'],
        personnel: { DL: 4, LB: 1, DB: 3 },
        coordinates: {
            DL1: [-3.5, 1.0],
            DL2: [-1.5, 1.0],
            DL3: [1.5, 1.0],
            DL4: [3.5, 1.0],
            LB1: [0, 4.5],
            DB1: [-14, 7.0],
            DB2: [14, 7.0],
            DB3: [0, 12.0]
        },
        slotPriorities: {
            'DL1': { strength: 3, blockShedding: 3, weight: 2 },
            'DL2': { strength: 3, blockShedding: 2, weight: 3 },
            'DL3': { strength: 3, blockShedding: 2, weight: 3 },
            'DL4': { strength: 3, blockShedding: 3, weight: 2 },
            'LB1': { tackling: 3, speed: 2, playbookIQ: 2 },
            'DB1': { speed: 3, catchingHands: 2, playbookIQ: 2 },
            'DB2': { speed: 3, catchingHands: 2, playbookIQ: 2 },
            'DB3': { speed: 3, catchingHands: 2, playbookIQ: 3 } // Safety,
        }
    },
    'Punt_Return': {
        name: 'Punt Return',
        slots: ['DL1', 'DL2', 'LB1', 'LB2', 'DB1', 'DB2', 'DB3', 'DB4'],
        // ...
        coordinates: {
            DL1: [-1.5, 1.0],
            DL2: [1.5, 1.0],
            LB1: [-4.0, 4.0],
            LB2: [4.0, 4.0],
            DB1: [-12, 10.0],
            DB2: [12, 10.0],
            // 💡 FIX: Standard punts travel 45-55 yards. 
            // These offsets are relative to the LOS (Line of Scrimmage).
            DB3: [0, 48.0],  // Main Returner 
            DB4: [0, 38.0]   // Short/Safety Returner
        }
    },
    '3-1-4': {
        name: '3-1-4 (Nickel Hybrid)',
        slots: ['DL1', 'DL2', 'DL3', 'LB1', 'DB1', 'DB2', 'DB3', 'DB4'],
        personnel: { DL: 3, LB: 1, DB: 4 },
        coordinates: {
            DL1: [-2.8, 1.0],
            DL2: [0, 1.0],
            DL3: [2.8, 1.0],
            LB1: [0, 4.5],
            DB1: [-14, 7.0],
            DB2: [14, 7.0],
            DB3: [-5.0, 5.0], // Slot DB playing close
            DB4: [5.0, 5.0]
        },
        slotPriorities: {
            'DL1': { speed: 3, blockShedding: 2 },
            'DL2': { strength: 3, weight: 2 },
            'DL3': { speed: 3, blockShedding: 2 },
            'LB1': { tackling: 3, playbookIQ: 2, speed: 2 },
            'DB1': { speed: 2, tackling: 2, agility: 2 },
            'DB2': { speed: 2, tackling: 2, agility: 2 },
            'DB3': { speed: 3, catchingHands: 2, playbookIQ: 2 },
            'DB4': { speed: 3, catchingHands: 2, playbookIQ: 2 }
        }
    },
    '3-0-5': {
        name: '3-0-5 (Dime)',
        slots: ['DL1', 'DL2', 'DL3', 'DB1', 'DB2', 'DB3', 'DB4', 'DB5'],
        personnel: { DL: 3, LB: 0, DB: 5 },
        coordinates: {
            'DL1': [-2.8, 1.0],
            'DL2': [0, 1.0],
            'DL3': [2.8, 1.0],
            'DB1': [-15, 7.0],
            'DB2': [15, 7.0],
            'DB3': [-5.0, 5.0],
            'DB4': [5.0, 5.0],
            'DB5': [0, 12.0]
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

// --- DEFENSIVE PLAYBOOK (8-Man Optimized) ---
export const defensivePlaybook = {
    // ===================================
    // --- 3-2-3 Base Plays
    // ===================================
    'Cover_2_Zone_Base': {
        name: 'Base Cover 2', concept: 'Zone', blitz: false,
        compatibleFormations: ['3-2-3'],
        tags: ['zone', 'cover2', 'safeZone'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush',
            'LB1': 'zone_hook_curl_left', 'LB2': 'zone_hook_curl_right',
            'DB1': 'zone_deep_half_left', 'DB2': 'zone_deep_half_right', 'DB3': 'zone_short_middle'
        }
    },
    'Cover_3_Sky': {
        name: 'Cover 3 Sky', concept: 'Zone', blitz: false,
        compatibleFormations: ['3-2-3'],
        tags: ['zone', 'cover3'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush',
            'LB1': 'zone_flat_left', 'LB2': 'zone_hook_curl_right',
            'DB1': 'zone_deep_third_left', 'DB2': 'zone_deep_third_right', 'DB3': 'zone_deep_middle'
        }
    },
    'Cover_1_Robber': {
        name: 'Cover 1 Robber', concept: 'Man', blitz: false,
        compatibleFormations: ['3-2-3'],
        tags: ['man', 'cover1', 'underneath-help'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush',
            'LB1': 'man_cover_RB', // Changed RB1 -> RB
            'LB2': 'zone_short_middle',
            'DB1': 'man_cover_X',  // Changed WR1 -> X
            'DB2': 'man_cover_Z',  // Changed WR2 -> Z
            'DB3': 'zone_deep_middle'
        }
    },
    'Man_Blitz_Base': {
        name: 'Base Man Blitz', concept: 'Man', blitz: true,
        compatibleFormations: ['3-2-3'],
        tags: ['man', 'blitz'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush',
            'LB1': 'blitz_gap', 'LB2': 'man_cover_RB', // Changed RB1 -> RB
            'DB1': 'man_cover_X',  // Changed WR1 -> X
            'DB2': 'man_cover_Z',  // Changed WR2 -> Z
            'DB3': 'zone_deep_middle'
        }
    },

    // ===================================
    // --- 2-3-3 Nickel Plays
    // ===================================
    'Nickel_Tampa_2': {
        name: 'Nickel Tampa 2', concept: 'Zone', blitz: false,
        compatibleFormations: ['2-3-3'],
        tags: ['zone', 'cover2'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush',
            'LB1': 'zone_flat_left', 'LB2': 'zone_deep_middle', 'LB3': 'zone_flat_right',
            'DB1': 'zone_deep_half_left', 'DB2': 'zone_deep_half_right', 'DB3': 'zone_hook_curl_middle'
        }
    },
    'Nickel_Strong_Blitz': {
        name: 'Nickel Overload', concept: 'Man', blitz: true,
        compatibleFormations: ['2-3-3'],
        tags: ['man', 'blitz'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush',
            'LB1': 'blitz_edge', 'LB2': 'blitz_gap', 'LB3': 'man_cover_RB', // Changed RB1 -> RB
            'DB1': 'man_cover_X',  // Changed WR1 -> X
            'DB2': 'man_cover_Z',  // Changed WR2 -> Z
            'DB3': 'zone_deep_middle'
        }
    },
    'Nickel_Bracket_WR1': {
        name: 'Bracket WR1', concept: 'Man', blitz: false,
        compatibleFormations: ['2-3-3'],
        tags: ['man', 'double-team'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush',
            'LB1': 'man_cover_RB', // Changed RB1 -> RB
            'LB2': 'zone_short_middle', 'LB3': 'man_cover_Y', // Changed TE1 -> Y
            'DB1': 'man_cover_X',  // Changed WR1 -> X
            'DB3': 'zone_deep_third_left',
            'DB2': 'man_cover_Z'   // Changed WR2 -> Z
        }
    },

    // ===================================
    // --- 4-2-2 Run Stop Plays
    // ===================================
    'GoalLine_RunStuff': {
        name: 'Goal Line Stuff', concept: 'Run', blitz: true,
        compatibleFormations: ['4-2-2'],
        tags: ['runStop', 'blitz'],
        assignments: {
            'DL1': 'run_edge_left', 'DL2': 'run_gap_A_left', 'DL3': 'run_gap_A_right', 'DL4': 'run_edge_right',
            'LB1': 'blitz_gap', 'LB2': 'blitz_gap',
            'DB1': 'man_cover_X', // Changed WR1 -> X
            'DB2': 'man_cover_Z'  // Changed WR2 -> Z
        }
    },

    'Cover_2_Hard_Flat': {
        name: 'Cover 2 Hard Flat', concept: 'Zone', blitz: false,
        compatibleFormations: ['4-2-2'],
        tags: ['zone', 'cover2', 'safeZone'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush', 'DL4': 'pass_rush',
            'LB1': 'zone_hook_curl_left', 'LB2': 'zone_hook_curl_right',
            'DB1': 'zone_deep_half_left', 'DB2': 'zone_deep_half_right'
        }
    },
    'Heavy_Man_Under': {
        name: '4-Man Press', concept: 'Man', blitz: false,
        compatibleFormations: ['4-2-2'],
        tags: ['man', 'press'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush', 'DL4': 'pass_rush',
            'LB1': 'man_cover_RB', // Changed RB1 -> RB
            'LB2': 'man_cover_Y',  // Changed TE1 -> Y
            'DB1': 'man_cover_X',  // Changed WR1 -> X
            'DB2': 'man_cover_Z'   // Changed WR2 -> Z
        }
    },

    // ===================================
    // --- 4-1-3 Dime / Prevent Plays
    // ===================================
    'Cover_4_Quarters': {
        name: 'Cover 4 Quarters', concept: 'Zone', blitz: false,
        compatibleFormations: ['4-1-3'],
        tags: ['zone', 'cover4', 'safeZone'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush', 'DL4': 'pass_rush',
            'LB1': 'zone_short_middle',
            'DB1': 'zone_deep_third_left', 'DB2': 'zone_deep_third_right', 'DB3': 'zone_deep_middle'
        }
    },
    'Dime_A_Gap_Blitz': {
        name: 'Dime Mid Blitz', concept: 'Man', blitz: true,
        compatibleFormations: ['4-1-3'],
        tags: ['man', 'blitz'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush', 'DL4': 'pass_rush',
            'LB1': 'blitz_gap',
            'DB1': 'man_cover_X', // Changed WR1 -> X
            'DB2': 'man_cover_Z', // Changed WR2 -> Z
            'DB3': 'man_cover_H'  // Changed WR3 -> H
        }
    },
    'Zero_Max_Blitz': {
        name: 'Cover 0 All Out', concept: 'Man', blitz: true,
        compatibleFormations: ['4-1-3'],
        tags: ['man', 'blitz', 'aggro'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush', 'DL4': 'pass_rush',
            'LB1': 'blitz_gap',
            'DB1': 'man_cover_X', // Changed WR1 -> X
            'DB2': 'man_cover_Z', // Changed WR2 -> Z
            'DB3': 'blitz_edge'
        }
    },

    // ===================================
    // --- 3-1-4 Hybrid Plays
    // ===================================
    'Cover_3_Buzz': {
        name: 'Cover 3 Buzz', concept: 'Zone', blitz: false,
        compatibleFormations: ['3-1-4'],
        tags: ['zone', 'cover3'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush',
            'LB1': 'zone_hook_curl_left',
            'DB1': 'zone_deep_third_left', 'DB2': 'zone_deep_third_right', 'DB3': 'zone_hook_curl_right', 'DB4': 'zone_deep_middle'
        }
    },
    'Fire_Zone_3': {
        name: 'Fire Zone 3 (DL Drop)', concept: 'Zone', blitz: true,
        compatibleFormations: ['3-1-4'],
        tags: ['zone', 'blitz', 'firezone'],
        assignments: {
            'DL1': 'zone_short_middle', 'DL2': 'pass_rush', 'DL3': 'pass_rush', // DL1 drops into coverage to confuse QB
            'LB1': 'blitz_edge', // LB replaces the rushing DL
            'DB1': 'zone_deep_third_left', 'DB2': 'zone_deep_third_right', 'DB3': 'zone_flat_right', 'DB4': 'zone_deep_middle'
        }
    },
    'Cover_6_Split': {
        name: 'Cover 6 (Split Field)', concept: 'Zone', blitz: false,
        compatibleFormations: ['3-1-4'],
        tags: ['zone', 'cover6'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush',
            'LB1': 'zone_hook_curl_left',
            'DB1': 'zone_deep_half_left', 'DB2': 'zone_deep_third_right', 'DB3': 'zone_short_middle', 'DB4': 'zone_deep_middle'
        }
    },
    'Hybrid_Man_Free': {
        name: 'Man Free Safety', concept: 'Man', blitz: false,
        compatibleFormations: ['3-1-4'],
        tags: ['man', 'cover1'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush',
            'LB1': 'man_cover_RB', // Changed RB1 -> RB
            'DB1': 'man_cover_X',  // Changed WR1 -> X
            'DB2': 'man_cover_Z',  // Changed WR2 -> Z
            'DB3': 'man_cover_H',  // Changed WR3 -> H
            'DB4': 'zone_deep_middle'
        }
    },

    // ===================================
    // --- 3-0-5 Prevent Plays
    // ===================================
    'Victory_Prevent': {
        name: 'Victory Prevent', concept: 'Zone', blitz: false,
        compatibleFormations: ['3-0-5'],
        tags: ['prevent', 'zone'],
        assignments: {
            'DL1': 'spy_QB', 'DL2': 'pass_rush', 'DL3': 'spy_QB',
            'DB1': 'zone_deep_half_left', 'DB2': 'zone_deep_half_right',
            'DB3': 'zone_deep_middle', 'DB4': 'zone_deep_third_left', 'DB5': 'zone_deep_third_right'
        }
    },
    'Dime_Lockdown': {
        name: 'Dime Man Lock', concept: 'Man', blitz: false,
        compatibleFormations: ['3-0-5'],
        tags: ['man', 'cover1'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush',
            'DB1': 'man_cover_X', // Changed WR1 -> X
            'DB2': 'man_cover_Z', // Changed WR2 -> Z
            'DB3': 'man_cover_H', // Changed WR3 -> H
            'DB4': 'man_cover_Y', // Changed WR4 -> Y
            'DB5': 'zone_deep_middle'
        }
    },

    // --- DIRECTIONAL BLITZES ---
    'Overload_Blitz_Right': {
        name: 'Overload Blitz Right', concept: 'Man', blitz: true,
        compatibleFormations: ['3-2-3', '2-3-3', '3-1-4'],
        tags: ['man', 'blitz', 'overload'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush',
            'LB2': 'blitz_edge', // Right-side LB blitzes
            'LB1': 'zone_short_middle', // Left-side LB drops to cover the hot read
            'DB2': 'blitz_edge', // Right-side DB/Nickel also blitzes
            'DB1': 'man_cover_X', 'DB3': 'man_cover_Z'
        }
    },
    'Overload_Blitz_Left': {
        name: 'Overload Blitz Left', concept: 'Man', blitz: true,
        compatibleFormations:['3-2-3', '2-3-3', '3-1-4'],
        tags: ['man', 'blitz', 'overload'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush',
            'LB1': 'blitz_edge', // Left-side LB blitzes
            'LB2': 'zone_short_middle', 
            'DB1': 'blitz_edge', // Left-side DB blitzes
            'DB2': 'man_cover_Z', 'DB3': 'man_cover_X'
        }
    },

    // ===================================
    // --- Special Teams
    // ===================================
    'PuntReturn_Classic': {
        name: 'Punt Return', concept: 'Special', blitz: false,
        compatibleFormations: ['Punt_Return'],
        tags: ['specialTeams'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush',
            'LB1': 'run_block', 'LB2': 'run_block',
            'DB1': 'punt_return', 'DB2': 'punt_return', 'DB3': 'punt_return', 'DB4': 'punt_return'
        }
    }
};

// --- COACH PERSONALITIES ---
export const coachPersonalities = [
    { type: 'West Coast Offense', preferredOffense: 'Spread', preferredDefense: '3-2-3', attributePreferences: { physical: { speed: 1.4 }, mental: { playbookIQ: 1.6 }, technical: { throwingAccuracy: 1.8 } } },
    { type: 'Ground and Pound', preferredOffense: 'Power', preferredDefense: '4-2-2', attributePreferences: { physical: { strength: 1.8 }, mental: { toughness: 1.5 }, technical: { blocking: 1.8 } } },
    { type: 'Blitz-Happy Defense', preferredOffense: 'Balanced', preferredDefense: '4-2-2', attributePreferences: { physical: { speed: 1.6 }, mental: { clutch: 1.4 }, technical: { tackling: 1.8 } } },
    { type: 'Balanced', preferredOffense: 'Balanced', preferredDefense: '3-2-3', attributePreferences: { physical: { speed: 1.2 }, mental: { playbookIQ: 1.2 }, technical: { tackling: 1.2 } } },
    { type: 'The Moneyballer', preferredOffense: 'Spread', preferredDefense: '3-1-4', attributePreferences: { physical: { speed: 0.8 }, mental: { playbookIQ: 2.0 }, technical: { catchingHands: 1.5 } } },
    { type: 'Air Raid', preferredOffense: 'Empty', preferredDefense: '4-1-3', attributePreferences: { physical: { speed: 1.8 }, mental: { playbookIQ: 0.8 }, technical: { throwingAccuracy: 1.5 } } },
    { type: 'Trench Warfare', preferredOffense: 'Power', preferredDefense: '4-2-2', attributePreferences: { physical: { strength: 2.0 }, mental: { toughness: 1.5 }, technical: { blocking: 2.0 } } }
];