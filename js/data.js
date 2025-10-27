import { getRandom, getRandomInt } from './utils.js';

// --- NEW Relationship Levels ---
export const relationshipLevels = {
    STRANGER:     { level: 0, name: 'Stranger',     callChance: 0.10, scoutAccuracy: 0.2, color: 'text-gray-500' },
    ACQUAINTANCE: { level: 1, name: 'Acquaintance', callChance: 0.30, scoutAccuracy: 0.4, color: 'text-blue-500' },
    FRIEND:       { level: 2, name: 'Friend',       callChance: 0.60, scoutAccuracy: 0.7, color: 'text-green-600' },
    GOOD_FRIEND:  { level: 3, name: 'Good Friend',  callChance: 0.80, scoutAccuracy: 0.9, color: 'text-purple-600' },
    BEST_FRIEND:  { level: 4, name: 'Best Friend',  callChance: 0.95, scoutAccuracy: 1.0, color: 'text-amber-500 font-bold' }
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
    // Basic Routes
    'Flat':     { zones: [ZONES.SHORT_L, ZONES.SHORT_R], baseYards: [2, 6], time: 2,
                    path: [ {x: 6, y: 2} ] }, // Path for a right flat, mirror X for left
    'Slant':    { zones: [ZONES.SHORT_C], baseYards: [5, 9], time: 3,
                    path: [ {x: 3, y: 4} ] }, // Path for a right slant, mirror X for left
    'Curl':     { zones: [ZONES.MED_C], baseYards: [8, 12], time: 5,
                    path: [ {x: 0, y: 10}, {x: 0, y: 8} ] }, // Go 10, come back 2
    'Out':      { zones: [ZONES.MED_L, ZONES.MED_R], baseYards: [10, 15], time: 6,
                    path: [ {x: 0, y: 10}, {x: 5, y: 10} ] }, // Go 10, break out 5
    'Post':     { zones: [ZONES.DEEP_C], baseYards: [15, 30], time: 8,
                    path: [ {x: 0, y: 15}, {x: -4, y: 20} ] }, // Go 15, break in (Post)
    'Fly':      { zones: [ZONES.DEEP_L, ZONES.DEEP_R], baseYards: [20, 40], time: 9,
                    path: [ {x: 0, y: 40} ] }, // Go deep
    'Screen':   { zones: [ZONES.SCREEN_L, ZONES.SCREEN_R], baseYards: [-3, 5], time: 3,
                    path: [ {x: -4, y: -1} ] }, // Step back and left for screen
    
    // New Routes
    'In':       { zones: [ZONES.MED_C], baseYards: [10, 15], time: 6,
                    path: [ {x: 0, y: 12}, {x: -6, y: 12} ] }, // Go 12, break in 6 (In/Dig)
    'Corner':   { zones: [ZONES.DEEP_L, ZONES.DEEP_R], baseYards: [15, 30], time: 8,
                    path: [ {x: 0, y: 15}, {x: 6, y: 20} ] }, // Go 15, break out (Corner/Flag)
    'Drag':     { zones: [ZONES.SHORT_C], baseYards: [4, 8], time: 4,
                    path: [ {x: 10, y: 4} ] }, // Shallow cross, mirror X for other side
    'Wheel':    { zones: [ZONES.DEEP_L, ZONES.DEEP_R], baseYards: [15, 35], time: 8,
                    path: [ {x: 3, y: 1}, {x: 5, y: 8}, {x: 5, y: 25} ] }, // RB wheel route
                    
    // Blocking Assignments (paths are irrelevant, but defined for consistency)
    'BlockRun': { zones: [], baseYards: [0, 0], time: 0, path: [{x: 0, y: 1}] }, // Engage block
    'BlockPass':{ zones: [], baseYards: [0, 0], time: 0, path: [{x: 0, y: -0.5}] }, // Step back to block
};

// Defines the available plays for each formation
export const offensivePlaybook = {
    // --- Balanced Formation ---
    'Balanced_InsideRun':   { type: 'run',  zone: ZONES.RUN_C, tags: ['run', 'inside'],
                              assignments: { 'RB1': 'run_inside', 'WR1': 'BlockRun', 'WR2': 'BlockRun' } },
    'Balanced_OutsideRun':  { type: 'run',  zone: ZONES.RUN_L, tags: ['run', 'outside'],
                              assignments: { 'RB1': 'run_outside', 'WR1': 'BlockRun', 'WR2': 'BlockRun' } },
    'Balanced_ShortPass':   { type: 'pass', playAction: false, tags: ['pass', 'short'],
                              assignments: { 'RB1': 'Flat', 'WR1': 'Slant', 'WR2': 'Curl' } },
    'Balanced_DeepPass':    { type: 'pass', playAction: true, tags: ['pass', 'deep', 'pa'],
                              assignments: { 'RB1': 'BlockPass', 'WR1': 'Fly', 'WR2': 'Post' } },
    'Balanced_PA_Cross':    { type: 'pass', playAction: true, tags: ['pass', 'medium', 'pa'],
                              assignments: { 'RB1': 'BlockPass', 'WR1': 'In', 'WR2': 'Drag' } }, // NEW

    // --- Spread Formation ---
    'Spread_InsideRun':     { type: 'run',  zone: ZONES.RUN_C, tags: ['run', 'inside'],
                              assignments: { 'RB1': 'run_inside', 'WR1': 'BlockRun', 'WR2': 'BlockRun', 'WR3': 'BlockRun' } },
    'Spread_QuickSlants':   { type: 'pass', playAction: false, tags: ['pass', 'short', 'quick'],
                              assignments: { 'RB1': 'Flat', 'WR1': 'Slant', 'WR2': 'Slant', 'WR3': 'Slant' } },
    'Spread_FourVerts':     { type: 'pass', playAction: false, tags: ['pass', 'deep'],
                              assignments: { 'RB1': 'Flat', 'WR1': 'Fly', 'WR2': 'Fly', 'WR3': 'Post' } },
    'Spread_WR_Screen':     { type: 'pass', zone: ZONES.SCREEN_L, tags: ['pass', 'screen'],
                              assignments: { 'WR3': 'Screen', 'RB1': 'BlockPass', 'WR1': 'BlockRun', 'WR2': 'BlockRun' } }, // Changed to WR screen
    'Spread_Mesh':          { type: 'pass', playAction: false, tags: ['pass', 'short', 'timing'],
                              assignments: { 'RB1': 'Wheel', 'WR1': 'Drag', 'WR2': 'Drag', 'WR3': 'In' } }, // NEW

    // --- Power Formation ---
    'Power_Dive':           { type: 'run',  zone: ZONES.RUN_C, tags: ['run', 'inside', 'power'],
                              assignments: { 'RB1': 'run_inside', 'RB2': 'BlockRun', 'WR1': 'BlockRun' } },
    'Power_Sweep':          { type: 'run',  zone: ZONES.RUN_R, tags: ['run', 'outside', 'power'],
                              assignments: { 'RB1': 'run_outside', 'RB2': 'BlockRun', 'WR1': 'BlockRun' } },
    'Power_PA_Bootleg':     { type: 'pass', playAction: true, tags: ['pass', 'deep', 'pa'],
                              assignments: { 'RB1': 'BlockPass', 'RB2': 'Flat', 'WR1': 'Corner' } }, // Changed to Corner
    'Power_RB_Screen':      { type: 'pass', zone: ZONES.SCREEN_R, tags: ['pass', 'screen'],
                              assignments: { 'RB1': 'Screen', 'RB2': 'BlockPass', 'WR1': 'BlockRun' } }, // NEW
};

// Defines defensive play calls (concepts)
export const defensivePlaybook = {
    'Cover_1':          {
        name: 'Cover 1 Man',
        concept: 'Man',
        blitz: false,
        // Assignments map slot (e.g., 'DB1') to an assignment key (e.g., 'man_cover_WR1')
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush',
            'LB1': 'man_cover_RB1', 'LB2': 'spy_QB', // QB Spy
            'DB1': 'man_cover_WR1', 'DB2': 'man_cover_WR2' // Assuming DBs match WRs 1-on-1
        }
    },
    'Cover_2_Zone':     {
        name: 'Cover 2 Zone',
        concept: 'Zone',
        blitz: false,
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush',
            'LB1': 'zone_flat_left', 'LB2': 'zone_short_middle', 'LB3': 'zone_flat_right', // Underneath coverage
            'DB1': 'zone_deep_half_left', 'DB2': 'zone_deep_half_right' // Deep safeties
        }
    },
    'Man_Blitz':        {
        name: 'Man Blitz (Cover 0)',
        concept: 'Man',
        blitz: true,
        assignments: {
            'DL1': 'blitz_gap', 'DL2': 'blitz_gap', 'DL3': 'blitz_edge',
            'LB1': 'blitz_gap', 'LB2': 'man_cover_RB1', // One LB blitzes, one covers RB
            'DB1': 'man_cover_WR1', 'DB2': 'man_cover_WR2' // No safety help
        }
    },
    'Run_Stop_4-2-1':   { // Specific to 4-2-1 formation, but logic is generic
        name: 'Run Stop (4-2-1)',
        concept: 'Man', // Or 'Run'
        blitz: true,
        assignments: {
            'DL1': 'run_edge_left', 'DL2': 'run_gap_B_left', 'DL3': 'run_gap_B_right', 'DL4': 'run_edge_right',
            'LB1': 'run_gap_A_left', 'LB2': 'run_gap_A_right',
            'DB1': 'run_support' // Safety comes down hard
        }
    },
    'Cover_3_Zone':     { // NEW
        name: 'Cover 3 Zone',
        concept: 'Zone',
        blitz: false,
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'pass_rush', 'DL3': 'pass_rush',
            'LB1': 'zone_flat_left', 'LB2': 'zone_hook_left', // Or short_middle
            'LB3': 'zone_flat_right',
            'DB1': 'zone_deep_middle' // Centerfield safety
            // Note: This 3-3-1 doesn't have corners for deep 1/3s. DB1 takes middle 1/3.
            // This is a limitation of 7-on-7 simulation.
        }
    },
    'Zone_Blitz':       { // NEW
        name: 'Zone Blitz',
        concept: 'Zone',
        blitz: true,
        assignments: {
            'DL1': 'pass_rush', 'DL2': 'zone_short_middle', // DL drops into coverage!
            'LB1': 'blitz_edge', 'LB2': 'zone_hook_left', 'LB3': 'blitz_gap',
            'DB1': 'zone_deep_half_left', 'DB2': 'zone_deep_half_right'
        }
    }
};
// --- Formations with Coordinates ---
export const offenseFormations = {
    'Balanced': {
        name: 'Balanced',
        slots: ['QB1', 'RB1', 'WR1', 'WR2', 'OL1', 'OL2', 'OL3'],
        personnel: { QB: 1, RB: 1, WR: 2, OL: 3, DL: 0, LB: 0, DB: 0 },
        routes: { /* ... */ },
        coordinates: { // [xOffset from Center, yOffset from LoS]
            QB1: [0, -5],      // Center, 5 yards back
            RB1: [-3, -7],     // Offset left, 7 yards back
            WR1: [-18, 0.5],   // Wide left, slightly off LOS
            WR2: [18, 0.5],    // Wide right, slightly off LOS
            OL1: [-4, -0.5],   // Left Guard/Tackle area
            OL2: [0, -0.75],   // Center slightly back
            OL3: [4, -0.5]     // Right Guard/Tackle area
        },
        slotPriorities: { /* ... */ }
    },
    'Spread': {
        name: 'Spread',
        slots: ['QB1', 'RB1', 'WR1', 'WR2', 'WR3', 'OL1', 'OL2'],
        personnel: { QB: 1, RB: 1, WR: 3, OL: 2, DL: 0, LB: 0, DB: 0 },
        routes: { /* ... */ },
        coordinates: {
            QB1: [0, -5],      // Shotgun
            RB1: [4, -4.5],    // Offset right beside QB
            WR1: [-22, 0.5],   // Far Wide left
            WR2: [22, 0.5],    // Far Wide right
            WR3: [-9, 0.5],    // Slot left
            OL1: [-3, -0.5],   // Left Tackle/Guard
            OL2: [3, -0.5]     // Right Tackle/Guard
        },
        slotPriorities: { /* ... */ }
    },
    'Power': {
        name: 'Power',
        slots: ['QB1', 'RB1', 'RB2', 'WR1', 'OL1', 'OL2', 'OL3'],
        personnel: { QB: 1, RB: 2, WR: 1, OL: 3, DL: 0, LB: 0, DB: 0 },
        routes: { /* ... */ },
        coordinates: {
             QB1: [0, -4],      // Under center
             RB1: [0, -6],      // Tailback
             RB2: [-3, -5],     // Fullback offset left
             WR1: [12, 0.5],    // Split end right
             OL1: [-4, -0.5],   // Left Guard/Tackle
             OL2: [0, -0.75],   // Center
             OL3: [4, -0.5]     // Right Guard/Tackle
         },
        slotPriorities: { /* ... */ }
    },
};

export const defenseFormations = {
    '3-3-1': {
        name: '3-3-1',
        slots: ['DL1', 'DL2', 'DL3', 'LB1', 'LB2', 'LB3', 'DB1'],
        personnel: { DL: 3, LB: 3, DB: 1 },
        zoneAssignments: { /* ... */ },
        routes: { /* ... */ }, // Defensive assignments
        coordinates: { // [xOffset from Center, yOffset from LoS]
            DL1: [-5, 0.5],    // Left End (3-tech?)
            DL2: [0, 0.75],    // Nose Tackle (over center)
            DL3: [5, 0.5],     // Right End (3-tech?)
            LB1: [-6, 4],      // Outside LB Left (Stack over End/Tackle)
            LB2: [0, 4.5],     // Middle LB (Stack over Nose)
            LB3: [6, 4],       // Outside LB Right (Stack over End/Tackle)
            DB1: [0, 12]       // Deep Safety (Center field)
        },
        slotPriorities: { /* ... */ }
    },
    '4-2-1': {
         name: '4-2-1',
         slots: ['DL1', 'DL2', 'DL3', 'DL4', 'LB1', 'LB2', 'DB1'],
         personnel: { DL: 4, LB: 2, DB: 1 },
         zoneAssignments: { /* ... */ },
         routes: { /* ... */ },
         coordinates: {
             DL1: [-7, 0.5],    // Left End (Wide 5/7 tech)
             DL2: [-2.5, 0.75], // Left Tackle (1 or 2i tech)
             DL3: [2.5, 0.75],  // Right Tackle (1 or 2i tech)
             DL4: [7, 0.5],     // Right End (Wide 5/7 tech)
             LB1: [-3.5, 4.5],  // Left LB (Stack behind DT)
             LB2: [3.5, 4.5],   // Right LB (Stack behind DT)
             DB1: [0, 13]       // Deep Safety
         },
         slotPriorities: { /* ... */ }
     },
     '2-3-2': {
         name: '2-3-2', // Often like a Nickel look
         slots: ['DL1', 'DL2', 'LB1', 'LB2', 'LB3', 'DB1', 'DB2'],
         personnel: { DL: 2, LB: 3, DB: 2 },
         zoneAssignments: { /* ... */ },
         routes: { /* ... */ },
         coordinates: {
             DL1: [-3, 0.75],   // Left DT/End (3-tech?)
             DL2: [3, 0.75],    // Right DT/End (3-tech?)
             LB1: [-7, 4],      // Outside LB Left (Apex/Overhang)
             LB2: [0, 5],       // Middle LB
             LB3: [7, 4],       // Outside LB Right (Apex/Overhang)
             DB1: [-15, 8],     // Left Corner/Safety (Off coverage?)
             DB2: [15, 8]       // Right Corner/Safety (Off coverage?)
         },
         slotPriorities: { /* ... */ }
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

