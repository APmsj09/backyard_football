import { getRandom, getRandomInt } from './utils.js';

// --- NEW Relationship Levels ---
export const relationshipLevels = {
    STRANGER: { level: 0, name: 'Stranger', callChance: 0.10, scoutAccuracy: 0.2, color: 'text-gray-500' },
    ACQUAINTANCE: { level: 1, name: 'Acquaintance', callChance: 0.30, scoutAccuracy: 0.4, color: 'text-blue-500' },
    FRIEND: { level: 2, name: 'Friend', callChance: 0.60, scoutAccuracy: 0.7, color: 'text-green-600' },
    GOOD_FRIEND: { level: 3, name: 'Good Friend', callChance: 0.80, scoutAccuracy: 0.9, color: 'text-purple-600' },
    BEST_FRIEND: { level: 4, name: 'Best Friend', callChance: 0.95, scoutAccuracy: 1.0, color: 'text-amber-500 font-bold' }
};

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

// --- Field Zones (Conceptual) ---
export const ZONES = {
    DEEP_L: 'Deep Left', DEEP_C: 'Deep Center', DEEP_R: 'Deep Right',
    MED_L: 'Medium Left', MED_C: 'Medium Center', MED_R: 'Medium Right',
    SHORT_L: 'Short Left', SHORT_C: 'Short Center', SHORT_R: 'Short Right',
    SCREEN_L: 'Screen Left', SCREEN_R: 'Screen Right',
    RUN_L: 'Outside Left', RUN_C: 'Inside', RUN_R: 'Outside Right',
    SNEAK: 'QB Sneak',
    BACKFIELD_L: 'Backfield Left', BACKFIELD_C: 'Backfield Center', BACKFIELD_R: 'Backfield Right',
    LOS_L: 'Line of Scrimmage Left', LOS_C: 'Line of Scrimmage Center', LOS_R: 'Line of Scrimmage Right'
};

// --- Playbook Data ---

// Defines the properties and coordinate paths of each route
// Paths are relative to the player's starting [x, y]
// Example: {x: 5, y: 10} means "move 5 yards right and 10 yards downfield from start"
export const routeTree = {
    // --- Short Routes ---
    'Flat': { path: [{ x: 3, y: 1 }, { x: 7, y: 2 }] },        // Quick out to sideline
    'Slant': { path: [{ x: -3, y: 3 }] },                       // Sharp cut inside (Assumes Pos X is right, Neg X is left/in)
    'Drag': { path: [{ x: 0, y: 3 }, { x: -10, y: 4 }] },      // Shallow crosser
    'Screen': { path: [{ x: -3, y: -1 }, { x: -5, y: -1 }] },    // Step back/sideways for screen catch

    // --- Medium Routes ---
    'Out': { path: [{ x: 0, y: 8 }, { x: 0, y: 10 }, { x: 7, y: 10 }] }, // Stem then sharp out
    'In': { path: [{ x: 0, y: 10 }, { x: 0, y: 12 }, { x: -8, y: 12 }] },// Stem then sharp in (Dig)
    'Curl': { path: [{ x: 0, y: 10 }, { x: 0, y: 12 }, { x: -1, y: 10 }] },// Stem, turn back slightly towards QB
    'Comeback': { path: [{ x: 0, y: 12 }, { x: 0, y: 15 }, { x: 5, y: 13 }] }, // Stem deep, turn back towards sideline

    // --- Deep Routes ---
    'Fly': { path: [{ x: 0, y: 40 }] },                    // Straight deep (Go/Streak)
    'Post': { path: [{ x: 0, y: 12 }, { x: 0, y: 15 }, { x: -6, y: 25 }] },// Stem, angle towards middle deep
    'Corner': { path: [{ x: 0, y: 12 }, { x: 0, y: 15 }, { x: 7, y: 25 }] }, // Stem, angle towards sideline deep (Flag)
    'Wheel': { path: [{ x: 3, y: 1 }, { x: 5, y: 8 }, { x: 5, y: 25 }] }, // RB starts flat then turns up sideline

    // --- Blocking Assignments ---
    // Paths are minimal, logic is handled in updatePlayerTargets
    'run_block': { path: [{ x: 0, y: 1 }] },
    'pass_block': { path: [{ x: 0, y: -0.5 }] },

    // --- Running Back "Routes" (Placeholders for AI) ---
    // Actual pathing handled by 'run_path' action in updatePlayerTargets based on assignment name
    'run_inside': { path: [{ x: 0, y: 5 }] }, // Target general inside area
    'run_outside': { path: [{ x: 7, y: 3 }] }, // Target general outside area (will be mirrored)
};

// Defines the available plays for each formation
export const offensivePlaybook = {
    // --- Balanced Formation (QB1, RB1, WR1, WR2, OL1, OL2, OL3) ---
    'Balanced_InsideRun': {
        type: 'run', tags: ['run', 'inside'],
        assignments: { 'RB1': 'run_inside', 'WR1': 'run_block', 'WR2': 'run_block', 'OL1': 'run_block', 'OL2': 'run_block', 'OL3': 'run_block' }
    }, // Added OL blocks
    'Balanced_OutsideRun': {
        type: 'run', tags: ['run', 'outside'],
        assignments: { 'RB1': 'run_outside', 'WR1': 'run_block', 'WR2': 'run_block', 'OL1': 'run_block', 'OL2': 'run_block', 'OL3': 'run_block' }
    }, // Added OL blocks
    'Balanced_SlantFlat': {
        type: 'pass', playAction: false, tags: ['pass', 'short', 'quick'],
        readProgression: ['WR1', 'WR2', 'RB1'], // Read 1: Slant, Read 2: Slant, Checkdown: Flat
        assignments: { 'RB1': 'Flat', 'WR1': 'Slant', 'WR2': 'Slant', 'OL1': 'pass_block', 'OL2': 'pass_block', 'OL3': 'pass_block' }
    }, // Renamed, added OL
    'Balanced_CurlCombo': {
        type: 'pass', playAction: false, tags: ['pass', 'medium', 'timing'],
        readProgression: ['WR1', 'WR2', 'RB1'], // Read 1: Curl, Read 2: Out, Checkdown: Flat
        assignments: { 'RB1': 'Flat', 'WR1': 'Curl', 'WR2': 'Out', 'OL1': 'pass_block', 'OL2': 'pass_block', 'OL3': 'pass_block' }
    }, // New play, added OL
    'Balanced_PA_Post': {
        type: 'pass', tags: ['pass', 'deep', 'pa'],
        readProgression: ['WR2', 'WR1'], // Read 1: Post, Read 2: Fly (RB is blocking)
        assignments: { 'RB1': 'pass_block', 'WR1': 'Fly', 'WR2': 'Post', 'OL1': 'pass_block', 'OL2': 'pass_block', 'OL3': 'pass_block' }
    },
    'Balanced_PA_Cross': {
        type: 'pass', tags: ['pass', 'medium', 'pa'],
        readProgression: ['WR1', 'WR2'], // Read 1: In route, Read 2: Drag (RB is blocking)
        assignments: { 'RB1': 'pass_block', 'WR1': 'In', 'WR2': 'Drag', 'OL1': 'pass_block', 'OL2': 'pass_block', 'OL3': 'pass_block' }
    },

    // --- Spread Formation (QB1, WR1, WR2, WR3, OL1, OL2, OL3) ---
    'Spread_QB_Inside': {
        type: 'run', tags: ['run', 'inside', 'qb'], // Changed to QB run
        assignments: {
            'QB1': 'run_inside', // QB1 is now the runner
            'WR1': 'run_block', 'WR2': 'run_block', 'WR3': 'run_block',
            'OL1': 'run_block', 'OL2': 'run_block', 'OL3': 'run_block'
        }
    },
    'Spread_QuickSlants': {
        type: 'pass', tags: ['pass', 'short', 'quick'],
        readProgression: ['WR1', 'WR2', 'WR3'], // Read 1: Slant, Read 2: Slant, Checkdown: Flat
        assignments: {
            'WR1': 'Slant', 'WR2': 'Slant', 'WR3': 'Flat',
            'OL1': 'pass_block', 'OL2': 'pass_block', 'OL3': 'pass_block'
        }
    },
    'Spread_Three_Verts': { // Renamed from FourVerts
        type: 'pass', tags: ['pass', 'deep'],
        readProgression: ['WR3', 'WR1', 'WR2'], // Read 1: Post, Read 2: Fly, Read 3: Fly
        assignments: {
            'WR1': 'Fly', 'WR2': 'Fly', 'WR3': 'Post',
            'OL1': 'pass_block', 'OL2': 'pass_block', 'OL3': 'pass_block'
        }
    },
    'Spread_Mesh': {
        type: 'pass', tags: ['pass', 'short', 'timing'],
        readProgression: ['WR1', 'WR2', 'WR3'], // Read 1: Drag, Read 2: Drag, Read 3: In
        assignments: {
            'WR1': 'Drag', 'WR2': 'Drag', 'WR3': 'In',
            'OL1': 'pass_block', 'OL2': 'pass_block', 'OL3': 'pass_block'
        }
    },
    'Spread_Y-Cross': {
        type: 'pass', tags: ['pass', 'medium'],
        readProgression: ['WR2', 'WR3', 'WR1'], // Read 1: In (Cross), Read 2: Drag (Under), Read 3: Fly (Clearout)
        assignments: {
            'WR1': 'Fly', 'WR2': 'In', 'WR3': 'Drag',
            'OL1': 'pass_block', 'OL2': 'pass_block', 'OL3': 'pass_block'
        }
    },

    // --- Power Formation (QB1, RB1, RB2, WR1, OL1, OL2, OL3) ---
    'Power_Dive': {
        type: 'run', tags: ['run', 'inside', 'power'],
        assignments: { 'RB1': 'run_inside', 'RB2': 'run_block', 'WR1': 'run_block', 'OL1': 'run_block', 'OL2': 'run_block', 'OL3': 'run_block' }
    },
    'Power_Sweep': {
        type: 'run', tags: ['run', 'outside', 'power'],
        assignments: { 'RB1': 'run_outside', 'RB2': 'run_block', 'WR1': 'run_block', 'OL1': 'run_block', 'OL2': 'run_block', 'OL3': 'run_block' }
    },
    'Power_PA_Bootleg': {
        type: 'pass', tags: ['pass', 'medium', 'pa', 'rollout'],
        readProgression: ['WR1', 'RB2'], // Read 1: Corner, Read 2: Flat
        assignments: { 'RB1': 'pass_block', 'RB2': 'Flat', 'WR1': 'Corner', 'OL1': 'pass_block', 'OL2': 'pass_block', 'OL3': 'pass_block' }
    },
    'Power_RB_Screen': {
        type: 'pass', tags: ['pass', 'screen'],
        readProgression: ['RB1'], // One read: The screen
        assignments: { 'RB1': 'Screen', 'RB2': 'pass_block', 'WR1': 'run_block', 'OL1': 'run_block', 'OL2': 'run_block', 'OL3': 'pass_block' }
    },
    'Power_PA_FB_Flat': {
        type: 'pass', tags: ['pass', 'short', 'pa'],
        readProgression: ['WR1', 'RB2'], // Read 1: In route, Read 2: FB Flat
        assignments: { 'RB1': 'pass_block', 'RB2': 'Flat', 'WR1': 'In', 'OL1': 'pass_block', 'OL2': 'pass_block', 'OL3': 'pass_block' }
    },
    // --- Trips Left Formation (QB1, WR1, WR2, WR3, OL1, OL2, OL3) ---
    'Trips_Left_Screen': {
        type: 'pass', tags: ['pass', 'screen'],
        readProgression: ['WR3'], // One read: The screen
        assignments: {
            'WR3': 'Screen',     // The receiver (closest to center)
            'WR1': 'run_block',  // Lead blocker (farthest out)
            'WR2': 'run_block',  // Lead blocker (middle)
            'OL1': 'run_block',  // OL releases to block
            'OL2': 'pass_block', // Sells the pass
            'OL3': 'pass_block'  // Sells the pass
        }
    },
    'Trips_Left_Slants': {
        type: 'pass', tags: ['pass', 'short', 'quick'],
        readProgression: ['WR1', 'WR2', 'WR3'], // Read 1: Outside Slant, Read 2: Middle Slant, Read 3: Inside Flat
        assignments: {
            'WR1': 'Slant',
            'WR2': 'Slant',
            'WR3': 'Flat',
            'OL1': 'pass_block',
            'OL2': 'pass_block',
            'OL3': 'pass_block'
        }
    },
    'Trips_Left_Verts': {
        type: 'pass', tags: ['pass', 'deep'],
        readProgression: ['WR3', 'WR2', 'WR1'], // Read 1: Inside Post, Read 2: Middle Fly, Read 3: Outside Fly
        assignments: {
            'WR1': 'Fly',
            'WR2': 'Fly',
            'WR3': 'Post',
            'OL1': 'pass_block',
            'OL2': 'pass_block',
            'OL3': 'pass_block'
        }
    },
    'Trips_Left_Drive': {
        type: 'pass', tags: ['pass', 'medium', 'timing'],
        readProgression: ['WR2', 'WR3', 'WR1'], // Read 1: In (Dig), Read 2: Drag (Shallow), Read 3: Fly (Clear-out)
        assignments: {
            'WR1': 'Fly',    // Clears out the deep coverage
            'WR2': 'In',     // The primary read (10-12 yard In)
            'WR3': 'Drag',   // The shallow crosser underneath
            'OL1': 'pass_block',
            'OL2': 'pass_block',
            'OL3': 'pass_block'
        }
    },
};

// Defensive Play Call Definitions
export const defensivePlaybook = {
    // ===================================
    // --- 3-1-3 Formation Plays (3DL, 1LB, 3DB)
    // ===================================
    'Cover_1_Man_3-1-3': {
        name: 'Cover 1 Man (3-1-3)',
        concept: 'Man',
        blitz: false,
        compatibleFormations: ['3-1-3'],
        tags: ['man', 'safeZone', 'cover1'],
        assignments: {
            'DL1': 'pass_rush',
            'DL2': 'pass_rush',
            'DL3': 'pass_rush',
            'LB1': 'man_cover_RB1',
            'DB1': 'man_cover_WR1',
            'DB2': 'man_cover_WR2',
            'DB3': 'zone_deep_middle'
        }
    },
    'Cover_2_Zone_3-1-3': {
        name: 'Cover 2 Zone (3-1-3)',
        concept: 'Zone',
        blitz: false,
        compatibleFormations: ['3-1-3'],
        tags: ['zone', 'safeZone', 'cover2'],
        assignments: {
            'DL1': 'pass_rush',
            'DL2': 'pass_rush',
            'DL3': 'pass_rush',
            'LB1': 'zone_hook_curl_middle',
            'DB1': 'zone_flat_left',
            'DB2': 'zone_deep_half_left',
            'DB3': 'zone_deep_half_right'
        }
    },
    'Cover_3_Zone_3-1-3': {
        name: 'Cover 3 Zone (3-1-3)',
        concept: 'Zone',
        blitz: false,
        compatibleFormations: ['3-1-3'],
        tags: ['zone', 'safeZone', 'cover3'],
        assignments: {
            'DL1': 'pass_rush',
            'DL2': 'pass_rush',
            'DL3': 'pass_rush',
            'LB1': 'zone_hook_curl_middle',
            'DB1': 'zone_flat_left',
            'DB2': 'zone_flat_right',
            'DB3': 'zone_deep_middle'
        }
    },
    'Cover_1_Robber_3-1-3': {
        name: 'Cover 1 Robber (3-1-3)',
        concept: 'Zone',
        blitz: false,
        compatibleFormations: ['3-1-3'],
        tags: ['zone', 'safeZone', 'cover1'],
        assignments: {
            'DL1': 'pass_rush',
            'DL2': 'pass_rush',
            'DL3': 'pass_rush',
            'LB1': 'zone_hook_curl_middle', // Robber
            'DB1': 'zone_flat_left',
            'DB2': 'zone_flat_right',
            'DB3': 'zone_deep_middle'
        }
    },
    'Man_Blitz_3-1-3': {
        name: 'Cover 0 Blitz (3-1-3)',
        concept: 'Man',
        blitz: true,
        compatibleFormations: ['3-1-3'],
        tags: ['blitz', 'man', 'cover0'],
        assignments: {
            'DL1': 'pass_rush',
            'DL2': 'pass_rush',
            'DL3': 'pass_rush',
            'LB1': 'blitz_gap_A',
            'DB1': 'man_cover_WR1',
            'DB2': 'man_cover_WR2',
            'DB3': 'man_cover_WR3'
        }
    },
    'LB_Spy_3-1-3': {
        name: 'LB Spy (3-1-3)',
        concept: 'Man',
        blitz: false,
        compatibleFormations: ['3-1-3'],
        tags: ['man', 'safeZone'],
        assignments: {
            'DL1': 'pass_rush',
            'DL2': 'pass_rush',
            'DL3': 'pass_rush',
            'LB1': 'spy_QB',
            'DB1': 'man_cover_WR1',
            'DB2': 'man_cover_WR2',
            'DB3': 'man_cover_WR3'
        }
    },
    'Zone_Blitz_3-1-3': {
        name: 'Zone Blitz (3-1-3)',
        concept: 'Zone',
        blitz: true,
        compatibleFormations: ['3-1-3'],
        tags: ['zone', 'blitz'],
        assignments: {
            'DL1': 'pass_rush',
            'DL2': 'pass_rush',
            'DL3': 'pass_rush',
            'LB1': 'blitz_gap',
            'DB1': 'zone_flat_left',
            'DB2': 'zone_flat_right',
            'DB3': 'zone_deep_middle'
        }
    },
    'Run_Stop_3-1-3': {
        name: 'Run Stop (3-1-3)',
        concept: 'Run',
        blitz: true,
        compatibleFormations: ['3-1-3'],
        tags: ['runStop', 'blitz', 'man'],
        assignments: {
            'DL1': 'run_gap_B_left',
            'DL2': 'run_gap_A',
            'DL3': 'run_gap_B_right',
            'LB1': 'fill_run',
            'DB1': 'man_cover_WR1',
            'DB2': 'man_cover_WR2',
            'DB3': 'run_support'
        }
    },

    // ===================================
    // --- 2-3-2 Formation Plays (2DL, 3LB, 2DB)
    // ===================================
    'Cover_1_Man_2-3-2': {
        name: 'Cover 1 Man Blitz (2-3-2)',
        concept: 'Man',
        blitz: true,
        compatibleFormations: ['2-3-2'],
        tags: ['man', 'blitz', 'cover1'],
        assignments: {
            'DL1': 'pass_rush',
            'DL2': 'pass_rush',
            'LB3': 'blitz_gap',
            'DB1': 'man_cover_WR1',
            'LB1': 'man_cover_WR2',
            'LB2': 'man_cover_RB1',
            'DB2': 'zone_deep_middle'
        }
    },
    'Cover_3_Zone_2-3-2': {
        name: 'Cover 3 Zone (2-3-2)',
        concept: 'Zone',
        blitz: false,
        compatibleFormations: ['2-3-2'],
        tags: ['zone', 'safeZone', 'cover3'],
        assignments: {
            'DL1': 'pass_rush',
            'DL2': 'pass_rush',
            'LB1': 'zone_flat_left',
            'LB2': 'zone_hook_curl_middle',
            'LB3': 'zone_flat_right',
            'DB1': 'zone_deep_half_left', // Note: Only 2 deep, but acts as Cover 3
            'DB2': 'zone_deep_half_right'
        }
    },
    'Man_Blitz_2-3-2': {
        name: 'Man Blitz (2-3-2)',
        concept: 'Man',
        blitz: true,
        compatibleFormations: ['2-3-2'],
        tags: ['man', 'blitz', 'cover0'],
        assignments: {
            'DL1': 'blitz_gap',
            'DL2': 'blitz_gap',
            'LB3': 'blitz_edge',
            'DB1': 'man_cover_WR1',
            'DB2': 'man_cover_WR2',
            'LB1': 'man_cover_WR3',
            'LB2': 'man_cover_RB1'
        }
    },
    'Zone_Blitz_2-3-2': {
        name: 'Zone Blitz (2-3-2)',
        concept: 'Zone',
        blitz: true,
        compatibleFormations: ['2-3-2'],
        tags: ['zone', 'blitz'],
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush',
            'LB1': 'blitz_edge', 'LB2': 'zone_deep_middle', 'LB3': 'blitz_gap',
            'DB1': 'zone_flat_left', 'DB2': 'zone_flat_right'
        }
    },
    'Prevent_Deep_2-3-2': {
        name: 'Prevent Deep (2-3-2)',
        concept: 'Zone',
        blitz: false,
        compatibleFormations: ['2-3-2'],
        tags: ['zone', 'prevent', 'safeZone'],
        assignments: {
            'DL1': 'pass_rush',
            'DL2': 'pass_rush',
            'LB1': 'zone_deep_middle',
            'LB2': 'zone_short_middle',
            'LB3': 'zone_short_middle',
            'DB1': 'zone_deep_half_left',
            'DB2': 'zone_deep_half_right'
        }
    },

    // ===================================
    // --- 4-2-1 Formation Plays (4DL, 2LB, 1DB)
    // ===================================
    'Run_Stop_4-2-1': {
        name: 'Run Stop (4-2-1)',
        concept: 'Run',
        blitz: true,
        compatibleFormations: ['4-2-1'],
        tags: ['runStop', 'blitz', 'cover0'],
        assignments: {
            'DL1': 'run_edge_left',
            'DL2': 'run_gap_B_left',
            'DL3': 'run_gap_B_right',
            'DL4': 'run_edge_right',
            'LB1': 'man_cover_WR1', // Mismatch!
            'LB2': 'man_cover_WR2', // Mismatch!
            'DB1': 'run_support'
        }
    },
    'Cover_1_Man_4-2-1': {
        name: 'Cover 1 Man (4-2-1)',
        concept: 'Man',
        blitz: false,
        compatibleFormations: ['4-2-1'],
        tags: ['man', 'safeZone', 'cover1'],
        assignments: {
            'DL1': 'pass_rush',
            'DL2': 'pass_rush',
            'DL3': 'pass_rush',
            'DL4': 'pass_rush',
            'LB1': 'man_cover_RB1',
            'LB2': 'man_cover_WR2',
            'DB1': 'zone_deep_middle'
        }
    },
    'Cover_1_Zone_4-2-1': {
        name: 'Cover 1 Zone (4-2-1)',
        concept: 'Zone',
        blitz: false,
        compatibleFormations: ['4-2-1'],
        tags: ['zone', 'safeZone', 'cover1'],
        assignments: {
            'DL1': 'pass_rush',
            'DL2': 'pass_rush',
            'DL3': 'pass_rush',
            'DL4': 'pass_rush',
            'LB1': 'zone_hook_curl_left',
            'LB2': 'zone_hook_curl_right',
            'DB1': 'zone_deep_middle'
        }
    },
    'Man_Blitz_4-2-1': {
        name: 'Man Blitz (4-2-1)',
        concept: 'Man',
        blitz: true,
        compatibleFormations: ['4-2-1'],
        tags: ['man', 'blitz', 'cover0'],
        assignments: {
            'DL1': 'blitz_edge',
            'DL2': 'blitz_gap',
            'DL3': 'blitz_gap',
            'DL4': 'blitz_edge',
            'DB1': 'man_cover_WR1',
            'LB1': 'man_cover_WR2',
            'LB2': 'man_cover_WR3'
        }
    },

    // ===================================
    // --- 4-1-2 Formation Plays (4DL, 1LB, 2DB)
    // ===================================
    'Cover_2_Zone_4-1-2': {
        name: 'Cover 2 Zone (4-1-2)',
        concept: 'Zone',
        blitz: false,
        compatibleFormations: ['4-1-2'],
        tags: ['zone', 'safeZone', 'cover2'],
        assignments: {
            'DL1': 'pass_rush',
            'DL2': 'pass_rush',
            'DL3': 'pass_rush',
            'DL4': 'pass_rush',
            'LB1': 'zone_short_middle',
            'DB1': 'zone_deep_half_left',
            'DB2': 'zone_deep_half_right'
        }
    },
    'Cover_2_Spy_4-1-2': { // Note: I merged your two C2 Zone plays
        name: 'Cover 2 Zone w/ Spy (4-1-2)',
        concept: 'Zone',
        blitz: false,
        compatibleFormations: ['4-1-2'],
        tags: ['zone', 'safeZone', 'cover2'],
        assignments: {
            'DL1': 'pass_rush',
            'DL2': 'pass_rush',
            'DL3': 'pass_rush',
            'DL4': 'pass_rush',
            'LB1': 'spy_QB',
            'DB1': 'zone_deep_half_left',
            'DB2': 'zone_deep_half_right'
        }
    },
    'Cover_3_Zone_4-1-2': {
        name: 'Cover 3 Zone (4-1-2)',
        concept: 'Zone',
        blitz: false,
        compatibleFormations: ['4-1-2'],
        tags: ['zone', 'safeZone', 'cover3'],
        assignments: {
            'DL1': 'pass_rush',
            'DL2': 'pass_rush',
            'DL3': 'pass_rush',
            'DL4': 'pass_rush',
            'LB1': 'spy_QB',
            'DB1': 'zone_deep_third_left',
            'DB2': 'zone_deep_middle'
            // Weakness: No deep right
        }
    },
    'LB_Blitz_4-1-2': {
        name: 'LB Man Blitz (4-1-2)',
        concept: 'Man',
        blitz: true,
        compatibleFormations: ['4-1-2'],
        tags: ['man', 'blitz', 'cover0'],
        assignments: {
            'DL1': 'pass_rush',
            'DL2': 'pass_rush',
            'DL3': 'pass_rush',
            'DL4': 'pass_rush',
            'LB1': 'blitz_gap',
            'DB1': 'man_cover_WR1',
            'DB2': 'man_cover_WR2'
        }
    },
    'Run_Stop_4-1-2': {
        name: 'Run Stop (4-1-2)',
        concept: 'Run',
        blitz: false, // Not a blitz, just a run fit
        compatibleFormations: ['4-1-2'],
        tags: ['runStop', 'safeZone'],
        assignments: {
            'DL1': 'run_edge_left',
            'DL2': 'run_gap_A_left',
            'DL3': 'run_gap_A_right',
            'DL4': 'run_edge_right',
            'LB1': 'fill_run',
            'DB1': 'run_support',
            'DB2': 'run_support'
        }
    },

    // ===================================
    // --- 4-0-3 Formation Plays (4DL, 0LB, 3DB)
    // ===================================
    'Cover_3_Zone_4-0-3': {
        name: 'Cover 3 Zone (4-0-3)',
        concept: 'Zone',
        blitz: false,
        compatibleFormations: ['4-0-3'],
        tags: ['zone', 'safeZone', 'cover3'],
        assignments: {
            'DL1': 'pass_rush',
            'DL2': 'pass_rush',
            'DL3': 'pass_rush',
            'DL4': 'pass_rush',
            'DB1': 'zone_flat_left',
            'DB2': 'zone_flat_right',
            'DB3': 'zone_deep_middle'
        }
    },
    'Cover_1_Man_4-0-3': {
        name: 'Cover 1 Man (4-0-3)',
        concept: 'Man',
        blitz: false,
        compatibleFormations: ['4-0-3'],
        tags: ['man', 'safeZone', 'cover1'],
        assignments: {
            'DL1': 'pass_rush',
            'DL2': 'pass_rush',
            'DL3': 'pass_rush',
            'DL4': 'pass_rush',
            'DB1': 'man_cover_WR1',
            'DB2': 'man_cover_WR2',
            'DB3': 'zone_deep_middle'
        }
    },
    'CB_Blitz_4-0-3': {
        name: 'CB Man Blitz (4-0-3)',
        concept: 'Man',
        blitz: true,
        compatibleFormations: ['4-0-3'],
        tags: ['man', 'blitz', 'cover0'],
        assignments: {
            'DL1': 'pass_rush',
            'DL2': 'pass_rush',
            'DL3': 'pass_rush',
            'DL4': 'pass_rush',
            'DB1': 'blitz_edge',
            'DB2': 'man_cover_WR1',
            'DB3': 'man_cover_WR2'
        }
    },
    'Prevent_Zone_4-0-3': {
        name: 'Prevent Zone (4-0-3)',
        concept: 'Zone',
        blitz: false,
        compatibleFormations: ['4-0-3'],
        tags: ['zone', 'prevent', 'safeZone'],
        assignments: {
            'DL1': 'pass_rush',
            'DL2': 'pass_rush',
            'DL3': 'pass_rush',
            'DL4': 'pass_rush',
            'DB1': 'zone_deep_third_left',
            'DB2': 'zone_deep_third_right',
            'DB3': 'zone_deep_middle'
        }
    }
};


// In js/data.js

// --- Formations with Coordinates ---
export const offenseFormations = {
    'Balanced': {
        name: 'Balanced', // Good mix of run/pass options
        slots: ['QB1', 'RB1', 'WR1', 'WR2', 'OL1', 'OL2', 'OL3'],
        personnel: { QB: 1, RB: 1, WR: 2, OL: 3 }, // Removed defensive counts
        // routes: { /* Removed, routes are defined in offensivePlaybook */ },
        coordinates: { // [xOffset from Center (ball snap X), yOffset from Line of Scrimmage (LoS Y)]
            QB1: [0, -5],     // Shotgun center, 5 yards deep
            RB1: [-3, -5.5],  // Running back offset left, slightly deeper than QB
            WR1: [-18, 0.5],  // Wide Receiver Left (Split End), just off LoS
            WR2: [18, 0.5],   // Wide Receiver Right (Split End), just off LoS
            OL1: [-3, -0.5],  // Left Lineman (Guard/Tackle area)
            OL2: [0, -0.75],  // Center Lineman (slightly back)
            OL3: [3, -0.5]    // Right Lineman (Guard/Tackle area)
        },
        slotPriorities: { // Key attributes for AI slotting (higher weight = more important)
            QB1: { throwingAccuracy: 3, playbookIQ: 2, speed: 1, agility: 1 },
            RB1: { speed: 3, agility: 3, strength: 2, catchingHands: 1, blocking: 1 },
            WR1: { speed: 3, catchingHands: 3, agility: 2, height: 1 },
            WR2: { speed: 3, catchingHands: 3, agility: 2, height: 1 },
            OL1: { strength: 3, blocking: 3, weight: 1 },
            OL2: { strength: 3, blocking: 3, weight: 1, playbookIQ: 1 }, // Center needs some IQ
            OL3: { strength: 3, blocking: 3, weight: 1 }
        }
    },
    'Spread': {
        name: 'Spread', // Now a 3-OL, 0-RB, 3-WR "Empty" set
        slots: ['QB1', 'WR1', 'WR2', 'WR3', 'OL1', 'OL2', 'OL3'], // <-- REMOVED RB1, ADDED OL3
        personnel: { QB: 1, RB: 0, WR: 3, OL: 3 }, // <-- CHANGED RB to 0, OL to 3
        coordinates: {
            QB1: [0, -5],     // Shotgun center
            // RB1: [4, -5],  // <-- REMOVED
            WR1: [-22, 0.5],  // Far Wide Receiver Left (X)
            WR2: [22, 0.5],   // Far Wide Receiver Right (Z)
            WR3: [-9, 0.5],   // Slot Receiver Left (Y)
            OL1: [-3, -0.5],  // <-- Adjusted to a 3-man line
            OL2: [0, -0.75],  // <-- Adjusted (Center)
            OL3: [3, -0.5]    // <-- ADDED
        },
        slotPriorities: {
            QB1: { throwingAccuracy: 3, playbookIQ: 2, speed: 1, agility: 1 },
            // RB1: ... // <-- REMOVED
            WR1: { speed: 3, catchingHands: 3, agility: 2, height: 1 },
            WR2: { speed: 3, catchingHands: 3, agility: 2, height: 1 },
            WR3: { speed: 2, catchingHands: 3, agility: 3 }, // Slot WR
            OL1: { strength: 2, blocking: 3, agility: 1 },
            OL2: { strength: 2, blocking: 3, playbookIQ: 1, agility: 1 }, // <-- Center
            OL3: { strength: 2, blocking: 3, agility: 1 }  // <-- ADDED
        }
    },
    'Power': {
        name: 'Power', // Heavier set, emphasizes running
        slots: ['QB1', 'RB1', 'RB2', 'WR1', 'OL1', 'OL2', 'OL3'],
        personnel: { QB: 1, RB: 2, WR: 1, OL: 3 },
        coordinates: {
            QB1: [0, -4],     // Under center or short pistol
            RB1: [0, -6],     // Tailback / Halfback deep
            RB2: [-3, -4.5],  // Fullback / Blocking back offset left
            WR1: [15, 0.5],   // Single Wide Receiver Right
            OL1: [-3, -0.5],  // Left Lineman
            OL2: [0, -0.75],  // Center Lineman
            OL3: [3, -0.5]    // Right Lineman
        },
        slotPriorities: {
            QB1: { throwingAccuracy: 2, playbookIQ: 1, strength: 1 }, // Less emphasis on throwing initially
            RB1: { speed: 2, strength: 3, agility: 2 }, // Power runner
            RB2: { strength: 3, blocking: 3, speed: 1 }, // Blocking back
            WR1: { speed: 2, catchingHands: 2, blocking: 2, strength: 1 }, // Needs to block
            OL1: { strength: 3, blocking: 3, weight: 1 },
            OL2: { strength: 3, blocking: 3, weight: 1 },
            OL3: { strength: 3, blocking: 3, weight: 1 }
        }
    },
};

export const defenseFormations = {
    '3-1-3': {
        name: '3-1-3', // Pass-focused, 3 DBs
        slots: ['DL1', 'DL2', 'DL3', 'LB1', 'DB1', 'DB2', 'DB3'],
        personnel: { DL: 3, LB: 1, DB: 3 },
        coordinates: { // [xOffset from Center, yOffset from LoS]
            'DL1': [-5, 1.0],   // Left End
            'DL2': [0, 1.0],    // Nose Tackle
            'DL3': [5, 1.0],    // Right End
            'LB1': [0, 5.0],    // Middle Linebacker
            'DB1': [-18, 1.0],  // Left Corner (Pressed)
            'DB2': [18, 1.0],   // Right Corner (Pressed)
            'DB3': [0, 12.0]   // Deep Safety
        },
        slotPriorities: {
            'DL1': { strength: 0.4, blockShedding: 0.3, speed: 0.2, tackling: 0.1 },
            'DL2': { strength: 0.5, blockShedding: 0.4, tackling: 0.1, weight: 0.1 },
            'DL3': { strength: 0.4, blockShedding: 0.3, speed: 0.2, tackling: 0.1 },
            'LB1': { tackling: 0.3, speed: 0.3, playbookIQ: 0.2, strength: 0.2 },
            'DB1': { speed: 0.5, agility: 0.3, catchingHands: 0.1, playbookIQ: 0.1 },
            'DB2': { speed: 0.5, agility: 0.3, catchingHands: 0.1, playbookIQ: 0.1 },
            'DB3': { speed: 0.4, playbookIQ: 0.3, agility: 0.2, tackling: 0.1 },
        }
    },
    '4-2-1': {
        name: '4-2-1', // Heavier front, strong against run
        slots: ['DL1', 'DL2', 'DL3', 'DL4', 'LB1', 'LB2', 'DB1'],
        personnel: { DL: 4, LB: 2, DB: 1 },
        coordinates: {
            DL1: [-7, 1.0],   // 🛠️ Moved to 1yd (Neutral Zone)
            DL2: [-2.5, 1.0],
            DL3: [2.5, 1.0],
            DL4: [7, 1.0],    // 🛠️ Moved to 1yd (Neutral Zone)
            LB1: [-15, 6],
            LB2: [15, 6],
            DB1: [0, 10]      // 🛠️ FIXED: Pulled safety up from 13 to 10 yds
        },
        slotPriorities: {
            DL1: { speed: 2, strength: 2, blockShedding: 2, tackling: 1 },
            DL2: { strength: 3, blockShedding: 3, weight: 1, tackling: 1 },
            DL3: { strength: 3, blockShedding: 3, weight: 1, tackling: 1 },
            DL4: { speed: 2, strength: 2, blockShedding: 2, tackling: 1 },
            LB1: { strength: 2, tackling: 3, playbookIQ: 2, blockShedding: 2 },
            LB2: { strength: 2, tackling: 3, playbookIQ: 2, blockShedding: 2 },
            DB1: { speed: 3, playbookIQ: 2, catchingHands: 1, agility: 1 }
        }
    },
    '2-3-2': {
        name: '2-3-2', // Pass-coverage shell
        slots: ['DL1', 'DL2', 'LB1', 'LB2', 'LB3', 'DB1', 'DB2'],
        personnel: { DL: 2, LB: 3, DB: 2 },
        coordinates: {
            DL1: [-4, 1.0],
            DL2: [4, 1.0],
            LB1: [-9, 5.0],   // 🛠️ Widened and standardized depth
            LB2: [0, 5.5],    // 🛠️ Moved MLB back slightly
            LB3: [9, 5.0],    // 🛠️ Widened and standardized depth
            DB1: [-22, 7.0],  // 🛠️ FIXED: Moved back to 7 yds and widened
            DB2: [22, 7.0]    // 🛠️ FIXED: Moved back to 7 yds and widened
        },
        slotPriorities: {
            DL1: { strength: 2, blockShedding: 2, speed: 2, tackling: 1 },
            DL2: { strength: 2, blockShedding: 2, speed: 2, tackling: 1 },
            LB1: { speed: 3, tackling: 2, playbookIQ: 2, agility: 2 },
            LB2: { speed: 2, tackling: 3, playbookIQ: 3 },
            LB3: { speed: 3, tackling: 2, playbookIQ: 2, agility: 2 },
            DB1: { speed: 3, agility: 3, catchingHands: 2, playbookIQ: 1 },
            DB2: { speed: 3, agility: 3, catchingHands: 2, playbookIQ: 1 }
        }
    },

    // --- 🛠️ NEW FORMATION 4-1-2 ---
    '4-1-2': {
        name: '4-1-2',
        personnel: { DL: 4, LB: 1, DB: 2 },
        slots: ['DL1', 'DL2', 'DL3', 'DL4', 'LB1', 'DB1', 'DB2'],
        coordinates: {
            // --- Defensive Line (Spread Out) ---
            'DL1': [-7, 0.5],  // Left Defensive End (Wide)
            'DL2': [-2, 0.5], // Left Defensive Tackle (B-Gap, over the Guard)
            'DL3': [2, 0.5],  // Right Defensive Tackle (B-Gap, over the Guard)
            'DL4': [7, 0.5],   // Right Defensive End (Wide)

            // --- Linebacker (Mike) ---
            'LB1': [0, 4.0],   // Middle Linebacker (Stacked 4 yards deep)

            // --- Defensive Backs (Safeties) ---
            'DB1': [-20, 12.0], // Left Safety (Deep Half)
            'DB2': [20, 12.0],  // Right Safety (Deep Half)
        },
        slotPriorities: {
            'DL1': { strength: 0.4, blockShedding: 0.3, speed: 0.2, tackling: 0.1 },
            'DL2': { strength: 0.5, blockShedding: 0.4, tackling: 0.1 },
            'DL3': { strength: 0.5, blockShedding: 0.4, tackling: 0.1 },
            'DL4': { strength: 0.4, blockShedding: 0.3, speed: 0.2, tackling: 0.1 },
            'LB1': { tackling: 0.3, speed: 0.3, playbookIQ: 0.2, strength: 0.2 },
            'DB1': { speed: 0.4, agility: 0.3, playbookIQ: 0.2, tackling: 0.1 },
            'DB2': { speed: 0.4, agility: 0.3, playbookIQ: 0.2, tackling: 0.1 },
        }
    },

    // --- 🛠️ NEW FORMATION 4-0-3 ---
    '4-0-3': {
        name: '4-0-3',
        personnel: { DL: 4, LB: 0, DB: 3 },
        slots: ['DL1', 'DL2', 'DL3', 'DL4', 'DB1', 'DB2', 'DB3'],
        coordinates: {
            // --- Defensive Line (Spread Out) ---
            'DL1': [-7, 0.5],  // Left Defensive End (Wide)
            'DL2': [-2, 0.5], // Left Defensive Tackle (B-Gap)
            'DL3': [2, 0.5],  // Right Defensive Tackle (B-Gap)
            'DL4': [7, 0.5],   // Right Defensive End (Wide)

            // --- Defensive Backs (2 Corners, 1 Safety) ---
            'DB1': [-18, 1.0],  // Left Cornerback (Pressed)
            'DB2': [18, 1.0],   // Right Cornerback (Pressed)
            'DB3': [0, 14.0],   // Deep Middle Safety
        },
        slotPriorities: {
            'DL1': { strength: 0.4, blockShedding: 0.3, speed: 0.2, tackling: 0.1 },
            'DL2': { strength: 0.5, blockShedding: 0.4, tackling: 0.1 },
            'DL3': { strength: 0.5, blockShedding: 0.4, tackling: 0.1 },
            'DL4': { strength: 0.4, blockShedding: 0.3, speed: 0.2, tackling: 0.1 },
            'DB1': { speed: 0.5, agility: 0.3, catchingHands: 0.1, playbookIQ: 0.1 },
            'DB2': { speed: 0.5, agility: 0.3, catchingHands: 0.1, playbookIQ: 0.1 },
            'DB3': { speed: 0.4, playbookIQ: 0.3, agility: 0.2, tackling: 0.1 },
        }
    },
};

export const coachPersonalities = [
    {
        type: 'West Coast Offense',
        description: 'Prefers accurate passers and agile receivers.',
        preferredOffense: 'Spread',
        preferredDefense: '2-3-2',
        attributePreferences: {
            physical: { speed: 1.4, strength: 0.7, agility: 1.5, stamina: 1.0, height: 1.2, weight: 0.8 },
            mental: { playbookIQ: 1.6, clutch: 1.2, consistency: 1.1, toughness: 0.9 },
            technical: { throwingAccuracy: 1.8, catchingHands: 1.6, tackling: 0.4, blocking: 0.6, blockShedding: 0.5 }
        }
    },
    {
        type: 'Ground and Pound',
        description: 'Builds a tough team that runs the ball and plays strong defense.',
        preferredOffense: 'Power',
        preferredDefense: '4-0-3',
        attributePreferences: {
            physical: { speed: 1.1, strength: 1.8, agility: 1.2, stamina: 1.4, height: 1.0, weight: 1.6 },
            mental: { playbookIQ: 1.0, clutch: 1.0, consistency: 1.5, toughness: 1.5 },
            technical: { throwingAccuracy: 0.7, catchingHands: 0.9, tackling: 1.6, blocking: 1.8, blockShedding: 1.3 }
        }
    },
    {
        type: 'Blitz-Happy Defense',
        description: 'Wants fast, aggressive defenders to wreak havoc.',
        preferredOffense: 'Balanced',
        preferredDefense: '4-1-2',
        attributePreferences: {
            physical: { speed: 1.6, strength: 1.3, agility: 1.7, stamina: 1.2, height: 1.1, weight: 1.3 },
            mental: { playbookIQ: 1.2, clutch: 1.4, consistency: 0.9, toughness: 1.2 },
            technical: { throwingAccuracy: 0.5, catchingHands: 0.8, tackling: 1.8, blocking: 1.0, blockShedding: 1.6 }
        }
    },
    {
        type: 'Balanced',
        description: 'Prefers well-rounded players and a versatile team.',
        preferredOffense: 'Balanced',
        preferredDefense: '3-1-3',
        attributePreferences: {
            physical: { speed: 1.2, strength: 1.2, agility: 1.2, stamina: 1.2, height: 1.1, weight: 1.1 },
            mental: { playbookIQ: 1.2, clutch: 1.2, consistency: 1.2, toughness: 1.1 },
            technical: { throwingAccuracy: 1.2, catchingHands: 1.2, tackling: 1.2, blocking: 1.2, blockShedding: 1.2 }
        }
    },
    {
        type: 'The Moneyballer',
        description: 'Focuses on undervalued mental and technical stats.',
        preferredOffense: 'Balanced',
        preferredDefense: '3-1-3',
        attributePreferences: {
            physical: { speed: 0.8, strength: 0.8, agility: 1.2, stamina: 1.4, height: 1.0, weight: 1.0 },
            mental: { playbookIQ: 1.8, clutch: 1.3, consistency: 1.9, toughness: 1.3 },
            technical: { throwingAccuracy: 1.0, catchingHands: 1.5, tackling: 1.5, blocking: 1.3, blockShedding: 1.4 }
        }
    },
    {
        type: 'Youth Scout',
        description: 'Always drafts for the future, preferring younger players with high physical potential.',
        preferredOffense: 'Spread',
        preferredDefense: '2-3-2',
        attributePreferences: {
            physical: { speed: 1.5, strength: 1.4, agility: 1.5, stamina: 1.3, height: 1.3, weight: 1.0 },
            mental: { playbookIQ: 0.9, clutch: 1.0, consistency: 0.8, toughness: 0.9 },
            technical: { throwingAccuracy: 1.1, catchingHands: 1.1, tackling: 1.1, blocking: 1.1, blockShedding: 1.0 }
        }
    }, {
        type: 'Air Raid',
        description: 'Loves to throw the deep ball. Wants tall, fast receivers and a QB with a strong arm.',
        preferredOffense: 'Spread',
        preferredDefense: '2-3-2',
        attributePreferences: {
            physical: { speed: 1.7, strength: 1.3, agility: 1.4, stamina: 0.9, height: 1.6, weight: 0.7 },
            mental: { playbookIQ: 0.8, clutch: 1.5, consistency: 0.7, toughness: 1.0 },
            technical: { throwingAccuracy: 1.2, catchingHands: 1.6, tackling: 0.5, blocking: 0.5, blockShedding: 0.5 }
        }
    },
    {
        type: 'Defensive Guru',
        description: 'Believes defense wins championships. Prefers smart, consistent defenders who don\'t miss tackles.',
        preferredOffense: 'Balanced',
        preferredDefense: '2-3-2',
        attributePreferences: {
            physical: { speed: 1.1, strength: 1.0, agility: 1.3, stamina: 1.3, height: 1.0, weight: 1.0 },
            mental: { playbookIQ: 1.8, clutch: 0.7, consistency: 1.6, toughness: 1.3 },
            technical: { throwingAccuracy: 0.7, catchingHands: 1.5, tackling: 1.8, blocking: 0.8, blockShedding: 1.3 }
        }
    },
    {
        type: 'Trench Warfare',
        description: 'Wins games at the line of scrimmage. Wants the best OL and DL in the league.',
        preferredOffense: 'Power',
        preferredDefense: '4-0-3',
        attributePreferences: {
            physical: { speed: 0.5, strength: 2.0, agility: 0.5, stamina: 1.2, height: 1.0, weight: 2.0 },
            mental: { playbookIQ: 0.8, clutch: 1.0, consistency: 1.0, toughness: 1.5 },
            technical: { throwingAccuracy: 0.4, catchingHands: 0.4, tackling: 1.4, blocking: 2.0, blockShedding: 1.8 }
        }
    },
    {
        type: 'Skills Coach',
        description: 'Ignores the lines. Just wants pure athletes: fast RBs, WRs, and DBs.',
        preferredOffense: 'Spread',
        preferredDefense: '2-3-2',
        attributePreferences: {
            physical: { speed: 1.8, strength: 0.6, agility: 1.8, stamina: 1.0, height: 1.1, weight: 0.6 },
            mental: { playbookIQ: 1.0, clutch: 1.4, consistency: 0.8, toughness: 0.8 },
            technical: { throwingAccuracy: 1.2, catchingHands: 1.7, tackling: 0.5, blocking: 0.2, blockShedding: 0.4 }
        }
    }
];

// Fill in the attributePreferences for coachPersonalities if they were empty before
coachPersonalities.forEach(coach => {
    if (!coach.attributePreferences) {
        coach.attributePreferences = {
            physical: { speed: 1, strength: 1, agility: 1, stamina: 1, height: 1, weight: 1 },
            mental: { playbookIQ: 1, clutch: 1, consistency: 1, toughness: 1 },
            technical: { throwingAccuracy: 1, catchingHands: 1, tackling: 1, blocking: 1, blockShedding: 1 }
        };
        if (coach.type.includes('Offense')) coach.attributePreferences.technical.throwingAccuracy = 1.2;
        if (coach.type.includes('Defense')) coach.attributePreferences.technical.tackling = 1.2;
        if (coach.type.includes('Ground')) coach.attributePreferences.physical.strength = 1.2;
    }
});

