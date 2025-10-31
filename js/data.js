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
    'Slant': { path: [{ x: 0, y: 3 }, { x: -3, y: 5 }] },       // Sharp cut inside (Assumes Pos X is right, Neg X is left/in)
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
    'BlockRun': { path: [{ x: 0, y: 1 }] },
    'BlockPass': { path: [{ x: 0, y: -0.5 }] },

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
        assignments: { 'RB1': 'run_inside', 'WR1': 'BlockRun', 'WR2': 'BlockRun', 'OL1': 'BlockRun', 'OL2': 'BlockRun', 'OL3': 'BlockRun' }
    }, // Added OL blocks
    'Balanced_OutsideRun': {
        type: 'run', tags: ['run', 'outside'],
        assignments: { 'RB1': 'run_outside', 'WR1': 'BlockRun', 'WR2': 'BlockRun', 'OL1': 'BlockRun', 'OL2': 'BlockRun', 'OL3': 'BlockRun' }
    }, // Added OL blocks
    'Balanced_SlantFlat': {
        type: 'pass', playAction: false, tags: ['pass', 'short', 'quick'],
        assignments: { 'RB1': 'Flat', 'WR1': 'Slant', 'WR2': 'Slant', 'OL1': 'BlockPass', 'OL2': 'BlockPass', 'OL3': 'BlockPass' }
    }, // Renamed, added OL
    'Balanced_CurlCombo': {
        type: 'pass', playAction: false, tags: ['pass', 'medium', 'timing'],
        assignments: { 'RB1': 'Flat', 'WR1': 'Curl', 'WR2': 'Out', 'OL1': 'BlockPass', 'OL2': 'BlockPass', 'OL3': 'BlockPass' }
    }, // New play, added OL
    'Balanced_PA_Post': {
        type: 'pass', tags: ['pass', 'deep', 'pa'],
        assignments: { 'RB1': 'BlockPass', 'WR1': 'Fly', 'WR2': 'Post', 'OL1': 'BlockPass', 'OL2': 'BlockPass', 'OL3': 'BlockPass' }
    },
    'Balanced_PA_Cross': {
        type: 'pass', tags: ['pass', 'medium', 'pa'],
        assignments: { 'RB1': 'BlockPass', 'WR1': 'In', 'WR2': 'Drag', 'OL1': 'BlockPass', 'OL2': 'BlockPass', 'OL3': 'BlockPass' }
    },

    // --- Spread Formation (QB1, RB1, WR1, WR2, WR3, OL1, OL2) ---
    'Spread_InsideZone': {
        type: 'run', tags: ['run', 'inside', 'zone'], // Added 'zone' tag
        assignments: { 'RB1': 'run_inside', 'WR1': 'BlockRun', 'WR2': 'BlockRun', 'WR3': 'BlockRun', 'OL1': 'BlockRun', 'OL2': 'BlockRun' }
    }, // Renamed, added OL
    'Spread_QuickSlants': {
        type: 'pass', playAction: false, tags: ['pass', 'short', 'quick'],
        assignments: { 'RB1': 'Flat', 'WR1': 'Slant', 'WR2': 'Slant', 'WR3': 'Slant', 'OL1': 'BlockPass', 'OL2': 'BlockPass' }
    }, // Added OL
    'Spread_FourVerts': {
        type: 'pass', playAction: false, tags: ['pass', 'deep'],
        assignments: { 'RB1': 'Flat', 'WR1': 'Fly', 'WR2': 'Fly', 'WR3': 'Post', 'OL1': 'BlockPass', 'OL2': 'BlockPass' }
    }, // Added OL
    'Spread_WR_Screen': {
        type: 'pass', tags: ['pass', 'screen'],
        assignments: { 'WR3': 'Screen', 'RB1': 'BlockPass', 'WR1': 'BlockRun', 'WR2': 'BlockRun', 'OL1': 'BlockRun', 'OL2': 'BlockPass' }
    }, // Added OL, OL2 pass blocks
    'Spread_Mesh': {
        type: 'pass', playAction: false, tags: ['pass', 'short', 'timing'],
        assignments: { 'RB1': 'Wheel', 'WR1': 'Drag', 'WR2': 'Drag', 'WR3': 'In', 'OL1': 'BlockPass', 'OL2': 'BlockPass' }
    }, // Added OL
    'Spread_Y-Cross': {
        type: 'pass', playAction: false, tags: ['pass', 'medium'],
        assignments: { 'RB1': 'Flat', 'WR1': 'Fly', 'WR2': 'In', 'WR3': 'Drag', 'OL1': 'BlockPass', 'OL2': 'BlockPass' }
    }, // New play

    // --- Power Formation (QB1, RB1, RB2, WR1, OL1, OL2, OL3) ---
    'Power_Dive': {
        type: 'run', tags: ['run', 'inside', 'power'],
        assignments: { 'RB1': 'run_inside', 'RB2': 'BlockRun', 'WR1': 'BlockRun', 'OL1': 'BlockRun', 'OL2': 'BlockRun', 'OL3': 'BlockRun' }
    }, // Added OL blocks
    'Power_Sweep': {
        type: 'run', tags: ['run', 'outside', 'power'],
        assignments: { 'RB1': 'run_outside', 'RB2': 'BlockRun', 'WR1': 'BlockRun', 'OL1': 'BlockRun', 'OL2': 'BlockRun', 'OL3': 'BlockRun' }
    }, // Added OL blocks
    'Power_PA_Bootleg': {
        type: 'pass', tags: ['pass', 'medium', 'pa', 'rollout'],
        assignments: { 'RB1': 'BlockPass', 'RB2': 'Flat', 'WR1': 'Corner', 'OL1': 'BlockPass', 'OL2': 'BlockPass', 'OL3': 'BlockPass' }
    },
    // Added OL
    'Power_RB_Screen': {
        type: 'pass', tags: ['pass', 'screen'],
        assignments: { 'RB1': 'Screen', 'RB2': 'BlockPass', 'WR1': 'BlockRun', 'OL1': 'BlockRun', 'OL2': 'BlockRun', 'OL3': 'BlockPass' }
    }, // Added OL
    'Power_PA_FB_Flat': {
        type: 'pass', tags: ['pass', 'short', 'pa'],
        assignments: { 'RB1': 'BlockPass', 'RB2': 'Flat', 'WR1': 'In', 'OL1': 'BlockPass', 'OL2': 'BlockPass', 'OL3': 'BlockPass' }
    },
};

// Defensive Play Call Definitions
export const defensivePlaybook = {
    // --- Cover 1 --- (Usually needs 1 Deep Safety + Man coverage)
    'Cover_1_Man_3-3-1': {
        name: 'Cover 1 Man (3-3-1)', concept: 'Man', blitz: false,
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush',
            'LB1': 'man_cover_RB1', 'LB2': 'spy_QB', 'LB3': 'man_cover_WR3', // <-- FIX
            'DB1': 'zone_deep_middle'
        }
    },
    'Cover_1_Man_2-3-2': { // Specific to 2-3-2 (2DL, 3LB, 2DB)
        name: 'Cover 1 Man (2-3-2)', concept: 'Man', blitz: true, // It's a 3-man blitz
        assignments: {
            // --- 3 Man Rush ---
            'DL1': 'pass_rush',
            'DL2': 'pass_rush',
            'LB3': 'blitz_gap',
            // --- 3 Man Coverage ---
            'DB1': 'man_cover_WR1', // Best DB on WR1
            'LB1': 'man_cover_WR2', // A LB has to cover WR2
            'LB2': 'man_cover_RB1', // Other LB on the RB
            // --- 1 Deep Safety ---
            'DB2': 'zone_deep_middle' // The "1" in Cover 1
            // Note: WR3 is left open. This is a weakness of this play/formation.
        }
    },

    // --- Cover 2 Zone --- (Usually needs 2 Deep Safeties)
    'Cover_1_Robber_3-3-1': {
        name: 'Cover 1 Robber (3-3-1)', concept: 'Zone', blitz: false,
        assignments: {
            // --- 3 Man Rush ---
            'DL1': 'pass_rush',
            'DL2': 'pass_rush',
            'DL3': 'pass_rush',
            // --- 3 Underneath Zones ---
            'LB1': 'zone_flat_left',        // Left flat
            'LB3': 'zone_flat_right',       // Right flat
            'LB2': 'zone_hook_curl_middle', // "Robber" sits in the middle
            // --- 1 Deep Zone ---
            'DB1': 'zone_deep_middle'      // Single high safety
        }
    },
    'Cover_2_Zone_2-3-2': {
        name: 'Cover 2 Sink (2-3-2)', concept: 'Zone', blitz: true, // It's now a 3-man blitz
        assignments: {
            // --- 3 Man Rush ---
            'DL1': 'pass_rush',
            'DL2': 'pass_rush',
            'LB2': 'blitz_gap',           // <-- FIX: MLB blitzes
            // --- 2 Underneath Zones ---
            'LB1': 'zone_flat_left',       // OLB drops to flat
            'LB3': 'zone_flat_right',      // OLB drops to flat
            // --- 2 Deep Zones ---
            'DB1': 'zone_deep_half_left',
            'DB2': 'zone_deep_half_right'
            // Note: This is a 3-rush, 4-zone. It's weak in the short-middle.
        }
    },

    // --- Man Blitz --- (Cover 0 - No Safety Help)
    'Man_Blitz_3-3-1': { 
        name: 'Man Blitz (3-3-1)', concept: 'Man', blitz: true,
        assignments: {
            // --- 3 Man Rush ---
            'DL1': 'blitz_edge', 
            'DL2': 'blitz_gap', 
            'DL3': 'blitz_edge',
            // --- 4 Man Coverage (Cover 0) ---
            'DB1': 'man_cover_WR1', // DB takes best WR
            'LB2': 'man_cover_WR2', // <-- FIX: MLB takes WR2
            'LB3': 'man_cover_WR3', // OLB takes slot/WR3
            'LB1': 'man_cover_RB1'  // OLB takes RB
        }
    },
    'Man_Blitz_2-3-2': { 
        name: 'Man Blitz (2-3-2)', concept: 'Man', blitz: true,
        assignments: {
            // --- 3 Man Rush ---
            'DL1': 'blitz_gap', 
            'DL2': 'blitz_gap',
            'LB3': 'blitz_edge', // Only one OLB blitzes now
            // --- 4 Man Coverage (Cover 0) ---
            'DB1': 'man_cover_WR1', // DB on WR1
            'DB2': 'man_cover_WR2', // DB on WR2
            'LB1': 'man_cover_WR3', // <-- FIX: OLB takes WR3
            'LB2': 'man_cover_RB1'  // MLB takes RB
        }
    },

    // --- Run Stop --- (Usually involves crashing gaps/edges)
    'Run_Stop_4-2-1': { // Specific to 4-2-1
        name: 'Run Stop (4-2-1)', concept: 'Run', blitz: true, // Assign 'Run' concept
        assignments: {
            'DL1': 'run_edge_left', 'DL2': 'run_gap_B_left', 'DL3': 'run_gap_B_right', 'DL4': 'run_edge_right',
            'LB1': 'run_gap_A_left', 'LB2': 'run_gap_A_right',
            'DB1': 'run_support' // Safety attacks downhill
        }
    },
    // --- NEW PLAY FOR 4-2-1 ---
    'Cover_1_Zone_4-2-1': {
        name: 'Cover 1 Zone (4-2-1)', concept: 'Zone', blitz: false,
        assignments: {
            // --- 4 Man Rush ---
            'DL1': 'pass_rush',
            'DL2': 'pass_rush',
            'DL3': 'pass_rush',
            'DL4': 'pass_rush',
            // --- 2 Underneath Zones ---
            'LB1': 'zone_hook_curl_left',
            'LB2': 'zone_hook_curl_right',
            // --- 1 Deep Zone ---
            'DB1': 'zone_deep_middle'
            // Note: This is a 4-man rush, 3-man zone. It's weak in the flats.
        }
    },
    'Run_Stop_3-3-1': { // Specific to 3-3-1
        name: 'Run Stop (3-3-1)', concept: 'Run', blitz: true,
        assignments: {
            'DL1': 'run_gap_B_left', 'DL2': 'run_gap_A', 'DL3': 'run_gap_B_right', // DL control inside gaps
            'LB1': 'run_edge_left', 'LB2': 'fill_run', 'LB3': 'run_edge_right', // LBs take edges + fill
            'DB1': 'run_support'
        }
    },


    // --- Cover 3 Zone --- (Usually 1 Deep Middle, 2 Deep Sides, 4 Underneath)
    'Cover_3_Zone_3-3-1': {
        name: 'Cover 1 Hook (3-3-1)', concept: 'Zone', blitz: false, // <-- RENAMED
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush',
            'LB1': 'zone_flat_left',  // Left flat
            'LB2': 'zone_hook_curl_middle', // <-- FIX: Middle hook/curl
            'LB3': 'zone_flat_right', // Right flat
            'DB1': 'zone_deep_middle' // 1 deep safety
        }
    },
    'Cover_3_Zone_2-3-2': {
        name: 'Cover 3 Zone (2-3-2)', concept: 'Zone', blitz: false,
        assignments: {
            // --- 2 Man Rush ---
            'DL1': 'pass_rush',
            'DL2': 'pass_rush',
            // --- 3 Deep Zones ---
            'DB1': 'zone_deep_third_left',  // DB takes deep left
            'DB2': 'zone_deep_third_right', // DB takes deep right
            'LB2': 'zone_deep_middle',      // <-- FIX: MLB drops to deep middle
            // --- 2 Underneath Zones ---
            'LB1': 'zone_flat_left',        // OLB takes left flat/curl
            'LB3': 'zone_flat_right'        // OLB takes right flat/curl
        }
    },

    // --- Zone Blitz ---
    'Zone_Blitz_3-3-1': { // Specific to 3-3-1
        name: 'Zone Blitz (3-3-1)', concept: 'Zone', blitz: true,
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'zone_short_middle', // Nose drops!
            'DL3': 'pass_rush',
            'LB1': 'blitz_edge', 'LB2': 'zone_hook_curl_left', 'LB3': 'blitz_gap', // 2 LBs blitz
            'DB1': 'zone_deep_middle' // Safety plays deep
        }
    },
    'Zone_Blitz_2-3-2': { // Specific to 2-3-2
        name: 'Zone Blitz (2-3-2)', concept: 'Zone', blitz: true,
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush',
            'LB1': 'blitz_edge', 'LB2': 'zone_short_middle', 'LB3': 'blitz_gap', // 2 LBs blitz
            'DB1': 'zone_deep_half_left', 'DB2': 'zone_deep_half_right' // 2 Deep zone defenders
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
            OL1: [-4, -0.5],  // Left Lineman (Guard/Tackle area)
            OL2: [0, -0.75],  // Center Lineman (slightly back)
            OL3: [4, -0.5]    // Right Lineman (Guard/Tackle area)
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
        name: 'Spread', // More receivers, emphasizes passing
        slots: ['QB1', 'RB1', 'WR1', 'WR2', 'WR3', 'OL1', 'OL2'],
        personnel: { QB: 1, RB: 1, WR: 3, OL: 2 },
        coordinates: {
            QB1: [0, -5],     // Shotgun center
            RB1: [4, -5],     // RB offset right, beside QB
            WR1: [-22, 0.5],  // Far Wide Receiver Left (X)
            WR2: [22, 0.5],   // Far Wide Receiver Right (Z)
            WR3: [-9, 0.5],   // Slot Receiver Left (Y)
            OL1: [-3, -0.5],  // Left Lineman
            OL2: [3, -0.5]    // Right Lineman
        },
        slotPriorities: {
            QB1: { throwingAccuracy: 3, playbookIQ: 2, speed: 1, agility: 1 },
            RB1: { speed: 2, agility: 2, catchingHands: 3, blocking: 1 }, // More emphasis on receiving
            WR1: { speed: 3, catchingHands: 3, agility: 2, height: 1 },
            WR2: { speed: 3, catchingHands: 3, agility: 2, height: 1 },
            WR3: { speed: 2, catchingHands: 3, agility: 3 }, // Slot WR needs agility
            OL1: { strength: 2, blocking: 3, agility: 1 }, // Need some agility vs edge
            OL2: { strength: 2, blocking: 3, agility: 1 }
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
            OL1: [-4, -0.5],  // Left Lineman
            OL2: [0, -0.75],  // Center Lineman
            OL3: [4, -0.5]    // Right Lineman
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
    '3-3-1': {
        name: '3-3-1', // Balanced front, single high safety
        slots: ['DL1', 'DL2', 'DL3', 'LB1', 'LB2', 'LB3', 'DB1'],
        personnel: { DL: 3, LB: 3, DB: 1 },
        // zoneAssignments, routes removed (defined in defensivePlaybook)
        coordinates: { // [xOffset from Center, yOffset from LoS]
            DL1: [-4, 0.75],  // Left DE (4i/5 tech area)
            DL2: [0, 1.0],    // Nose Tackle (Head up/1 tech)
            DL3: [4, 0.75],   // Right DE (4i/5 tech area)
            LB1: [-5, 4.5],   // Left OLB (Stack/Apex)
            LB2: [0, 5],      // Middle LB
            LB3: [5, 4.5],    // Right OLB (Stack/Apex)
            DB1: [0, 12]      // Deep Safety (Center field)
        },
        slotPriorities: { // Key attributes for AI slotting
            DL1: { strength: 3, blockShedding: 2, speed: 1, tackling: 1 },
            DL2: { strength: 3, blockShedding: 3, weight: 1, tackling: 1 }, // Nose needs strength/shed
            DL3: { strength: 3, blockShedding: 2, speed: 1, tackling: 1 },
            LB1: { speed: 2, tackling: 3, playbookIQ: 2, agility: 1 }, // OLBs need range
            LB2: { strength: 2, tackling: 3, playbookIQ: 3, blockShedding: 1 }, // MLB needs IQ/Tackling
            LB3: { speed: 2, tackling: 3, playbookIQ: 2, agility: 1 },
            DB1: { speed: 3, playbookIQ: 2, catchingHands: 1, agility: 2 } // Safety needs speed/IQ
        }
    },
    '4-2-1': {
        name: '4-2-1', // Heavier front, strong against run
        slots: ['DL1', 'DL2', 'DL3', 'DL4', 'LB1', 'LB2', 'DB1'],
        personnel: { DL: 4, LB: 2, DB: 1 },
        coordinates: {
            DL1: [-7, 0.75],  // Left End (Wide 5/7 tech)
            DL2: [-2.5, 1.0], // Left Tackle (1/2i tech)
            DL3: [2.5, 1.0],  // Right Tackle (1/2i tech)
            DL4: [7, 0.75],   // Right End (Wide 5/7 tech)
            LB1: [-3, 5],     // Left LB (Stack behind DT)
            LB2: [3, 5],      // Right LB (Stack behind DT)
            DB1: [0, 13]      // Deep Safety
        },
        slotPriorities: {
            DL1: { speed: 2, strength: 2, blockShedding: 2, tackling: 1 }, // Edge rush focus
            DL2: { strength: 3, blockShedding: 3, weight: 1, tackling: 1 }, // Run stopper
            DL3: { strength: 3, blockShedding: 3, weight: 1, tackling: 1 }, // Run stopper
            DL4: { speed: 2, strength: 2, blockShedding: 2, tackling: 1 }, // Edge rush focus
            LB1: { strength: 2, tackling: 3, playbookIQ: 2, blockShedding: 2 }, // Needs to shed blocks
            LB2: { strength: 2, tackling: 3, playbookIQ: 2, blockShedding: 2 },
            DB1: { speed: 3, playbookIQ: 2, catchingHands: 1, agility: 1 }
        }
    },
    '2-3-2': {
        name: '2-3-2', // Lighter front, more coverage (Nickel-like)
        slots: ['DL1', 'DL2', 'LB1', 'LB2', 'LB3', 'DB1', 'DB2'],
        personnel: { DL: 2, LB: 3, DB: 2 },
        coordinates: {
            DL1: [-3, 1.0],   // Left DT/End (3 tech area)
            DL2: [3, 1.0],    // Right DT/End (3 tech area)
            LB1: [-7, 4.5],   // Left OLB (Apex/Overhang)
            LB2: [0, 5],      // Middle LB
            LB3: [7, 4.5],    // Right OLB (Apex/Overhang)
            DB1: [-15, 7],    // Left CB/Safety (Off coverage) - Adjusted depth
            DB2: [15, 7]     // Right CB/Safety (Off coverage) - Adjusted depth
        },
        slotPriorities: {
            DL1: { strength: 2, blockShedding: 2, speed: 2, tackling: 1 }, // More balanced DL
            DL2: { strength: 2, blockShedding: 2, speed: 2, tackling: 1 },
            LB1: { speed: 3, tackling: 2, playbookIQ: 2, agility: 2 }, // Coverage/speed focus
            LB2: { speed: 2, tackling: 3, playbookIQ: 3 }, // Coverage/Tackling MLB
            LB3: { speed: 3, tackling: 2, playbookIQ: 2, agility: 2 }, // Coverage/speed focus
            DB1: { speed: 3, agility: 3, catchingHands: 2, playbookIQ: 1 }, // Coverage DB
            DB2: { speed: 3, agility: 3, catchingHands: 2, playbookIQ: 1 } // Coverage DB
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
        preferredDefense: '4-2-1',
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
        preferredDefense: '4-2-1',
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
        preferredDefense: '3-3-1',
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
        preferredDefense: '3-3-1',
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
    },
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

