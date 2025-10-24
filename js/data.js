import { getRandom, getRandomInt } from './utils.js';

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

// Defines the properties of each route
export const routeTree = {
    'Flat': { zones: [ZONES.SHORT_L, ZONES.SHORT_R], baseYards: [2, 6], time: 2 }, // Quick
    'Slant': { zones: [ZONES.SHORT_C], baseYards: [5, 9], time: 3 },
    'Curl': { zones: [ZONES.MED_C], baseYards: [8, 12], time: 5 },
    'Out': { zones: [ZONES.MED_L, ZONES.MED_R], baseYards: [10, 15], time: 6 },
    'Post': { zones: [ZONES.DEEP_C], baseYards: [15, 30], time: 8 },
    'Fly': { zones: [ZONES.DEEP_L, ZONES.DEEP_R], baseYards: [20, 40], time: 9 },
    'Screen': { zones: [ZONES.SCREEN_L, ZONES.SCREEN_R], baseYards: [-3, 5], time: 3 },
    'BlockRun': { zones: [], baseYards: [0, 0], time: 0 }, // WR blocking on run
    'BlockPass': { zones: [], baseYards: [0, 0], time: 0 }, // RB staying in to block
};

// Defines the available plays for each formation
export const offensivePlaybook = {
    // Balanced Plays
    'Balanced_InsideRun': { type: 'run', zone: ZONES.RUN_C, assignments: { 'RB1': 'run_inside', 'WR1': 'block_run', 'WR2': 'block_run' } },
    'Balanced_OutsideRun': { type: 'run', zone: ZONES.RUN_L, assignments: { 'RB1': 'run_outside', 'WR1': 'block_run', 'WR2': 'block_run' } },
    'Balanced_ShortPass': { type: 'pass', playAction: false, assignments: { 'RB1': 'Flat', 'WR1': 'Slant', 'WR2': 'Curl' } },
    'Balanced_DeepPass': { type: 'pass', playAction: true, assignments: { 'RB1': 'block_pass', 'WR1': 'Fly', 'WR2': 'Post' } },
    // Spread Plays
    'Spread_InsideRun': { type: 'run', zone: ZONES.RUN_C, assignments: { 'RB1': 'run_inside', 'WR1': 'block_run', 'WR2': 'block_run', 'WR3': 'block_run' } },
    'Spread_QuickSlants': { type: 'pass', playAction: false, assignments: { 'RB1': 'Flat', 'WR1': 'Slant', 'WR2': 'Slant', 'WR3': 'Slant' } },
    'Spread_FourVerts': { type: 'pass', playAction: false, assignments: { 'RB1': 'Flat', 'WR1': 'Fly', 'WR2': 'Fly', 'WR3': 'Post' } },
    'Spread_Screen': { type: 'pass', zone: ZONES.SCREEN_L, assignments: { 'RB1': 'Screen', 'WR1': 'block_pass', 'WR2': 'block_pass', 'WR3': 'block_pass' } },
    // Power Plays
    'Power_Dive': { type: 'run', zone: ZONES.RUN_C, assignments: { 'RB1': 'run_inside', 'RB2': 'block_run', 'WR1': 'block_run' } },
    'Power_Sweep': { type: 'run', zone: ZONES.RUN_R, assignments: { 'RB1': 'run_outside', 'RB2': 'block_run', 'WR1': 'block_run' } },
    'Power_PA_Bootleg': { type: 'pass', playAction: true, assignments: { 'RB1': 'block_pass', 'RB2': 'Flat', 'WR1': 'Post' } },
};

// Defines defensive play calls (concepts)
export const defensivePlaybook = {
    'Cover_1': { 
        name: 'Cover 1', 
        concept: 'Man', 
        blitz: false, 
        assignments: { // Maps slot to an assignment *type*
            'DL1': 'rush_pass', 'DL2': 'rush_pass', 'DL3': 'rush_pass_contain',
            'LB1': 'man_cover_RB', 'LB2': 'spy_QB', 'LB3': 'man_cover_WR2',
            'DB1': 'man_cover_WR1'
        } 
    },
    'Cover_2_Zone': { 
        name: 'Cover 2 Zone', 
        concept: 'Zone', 
        blitz: false, 
        assignments: {
            'DL1': 'rush_pass', 'DL2': 'rush_pass',
            'LB1': 'zone_short_left', 'LB2': 'zone_short_middle', 'LB3': 'zone_short_right',
            'DB1': 'zone_deep_half_left', 'DB2': 'zone_deep_half_right'
        } 
    },
    'Man_Blitz': { 
        name: 'Man Blitz', 
        concept: 'Man', 
        blitz: true, 
        assignments: {
            'DL1': 'blitz_gap', 'DL2': 'blitz_gap', 'DL3': 'blitz_edge',
            'LB1': 'blitz_gap', 'LB2': 'man_cover_RB',
            'DB1': 'man_press_WR1', 'DB2': 'man_press_WR2'
        } 
    },
    'Run_Stop': { 
        name: 'Run Stop', 
        concept: 'Man', 
        blitz: true, 
        assignments: {
            'DL1': 'run_stop_gap', 'DL2': 'run_stop_gap', 'DL3': 'run_stop_gap', 'DL4': 'run_stop_edge',
            'LB1': 'run_stop_fill', 'LB2': 'run_stop_fill',
            'DB1': 'run_support'
        } 
    },
};

// --- Formations with Zone Assignments and Slot Priorities ---
export const offenseFormations = {
    'Balanced': {
        name: 'Balanced',
        slots: ['QB1', 'RB1', 'WR1', 'WR2', 'OL1', 'OL2', 'OL3'],
        personnel: { QB: 1, RB: 1, WR: 2, OL: 3, DL: 0, LB: 0, DB: 0 },
        routes: {
            'QB1': ['pass', 'sneak'], 'RB1': ['run_inside', 'run_outside', 'Screen', 'Flat', 'block_pass'],
            'WR1': ['Fly', 'Post', 'Slant', 'block_run'], 'WR2': ['Fly', 'Post', 'Curl', 'block_run'],
            'OL1': ['block_pass', 'block_run'], 'OL2': ['block_pass', 'block_run'], 'OL3': ['block_pass', 'block_run']
        },
        zoneAssignments: {
            QB1: ZONES.BACKFIELD_C, RB1: ZONES.BACKFIELD_C,
            WR1: ZONES.SHORT_L, WR2: ZONES.SHORT_R,
            OL1: ZONES.LOS_L, OL2: ZONES.LOS_C, OL3: ZONES.LOS_R
        },
        slotPriorities: { 
            QB1: { throwingAccuracy: 1.5, playbookIQ: 1.2 }, RB1: { speed: 1.3, agility: 1.1 },
            WR1: { speed: 1.2, catchingHands: 1.2 }, WR2: { catchingHands: 1.3, agility: 1.1 },
            OL1: { strength: 1.5, blocking: 1.3 }, OL2: { blocking: 1.4, strength: 1.2 }, OL3: { strength: 1.4, blocking: 1.2 }
        }
    },
    'Spread': {
        name: 'Spread',
        slots: ['QB1', 'RB1', 'WR1', 'WR2', 'WR3', 'OL1', 'OL2'],
        personnel: { QB: 1, RB: 1, WR: 3, OL: 2, DL: 0, LB: 0, DB: 0 },
        routes: {
            'QB1': ['pass', 'sneak'], 'RB1': ['run_inside', 'Screen', 'Flat', 'block_pass'],
            'WR1': ['Fly', 'Post', 'Slant', 'block_run'], 'WR2': ['Fly', 'Out', 'Slant', 'block_run'], 'WR3': ['Curl', 'Slant', 'Out', 'block_run'],
            'OL1': ['block_pass'], 'OL2': ['block_pass']
        },
        zoneAssignments: {
            QB1: ZONES.BACKFIELD_C, RB1: ZONES.BACKFIELD_R,
            WR1: ZONES.MED_L, WR2: ZONES.MED_R, WR3: ZONES.SHORT_C,
            OL1: ZONES.LOS_L, OL2: ZONES.LOS_R
        },
        slotPriorities: {
            QB1: { throwingAccuracy: 1.6, playbookIQ: 1.1 }, RB1: { catchingHands: 1.3, speed: 1.1 },
            WR1: { speed: 1.5, catchingHands: 1.1 }, WR2: { speed: 1.5, catchingHands: 1.1 }, WR3: { agility: 1.4, catchingHands: 1.2 },
            OL1: { blocking: 1.5, agility: 1.1 }, OL2: { blocking: 1.5, agility: 1.1 } // Pass pro focus
        }
    },
    'Power': {
        name: 'Power',
        slots: ['QB1', 'RB1', 'RB2', 'WR1', 'OL1', 'OL2', 'OL3'],
        personnel: { QB: 1, RB: 2, WR: 1, OL: 3, DL: 0, LB: 0, DB: 0 },
        routes: {
            'QB1': ['pass', 'sneak'], 'RB1': ['run_inside', 'run_outside'], 'RB2': ['block_run', 'block_pass', 'Flat'],
            'WR1': ['Post', 'Slant', 'block_run'],
            'OL1': ['block_pass', 'block_run'], 'OL2': ['block_pass', 'block_run'], 'OL3': ['block_pass', 'block_run']
        },
        zoneAssignments: {
            QB1: ZONES.BACKFIELD_C, RB1: ZONES.BACKFIELD_R, RB2: ZONES.BACKFIELD_L, // RB2 often lead blocker
            WR1: ZONES.SHORT_R,
            OL1: ZONES.LOS_L, OL2: ZONES.LOS_C, OL3: ZONES.LOS_R
        },
        slotPriorities: {
            QB1: { playbookIQ: 1.3 }, RB1: { strength: 1.4, speed: 1.2 }, RB2: { blocking: 1.5, strength: 1.2 }, // RB2 as blocker
            WR1: { blocking: 1.3, catchingHands: 1.0 }, // WR needs to block
            OL1: { strength: 1.6, blocking: 1.4 }, OL2: { strength: 1.6, blocking: 1.4 }, OL3: { strength: 1.6, blocking: 1.4 } // Run block focus
        }
    },
};

export const defenseFormations = {
    '3-3-1': { 
        name: '3-3-1', 
        slots: ['DL1', 'DL2', 'DL3', 'LB1', 'LB2', 'LB3', 'DB1'],
        personnel: { DL: 3, LB: 3, DB: 1 },
        zoneAssignments: { 
            DL1: ZONES.LOS_L, DL2: ZONES.LOS_C, DL3: ZONES.LOS_R,
            LB1: ZONES.SHORT_L, LB2: ZONES.SHORT_C, LB3: ZONES.SHORT_R,
            DB1: ZONES.DEEP_C 
        },
        routes: { // Defensive "playbook" / assignments
            'DL1': ['rush_pass', 'run_stop_left'], 'DL2': ['rush_pass', 'run_stop_center'], 'DL3': ['rush_pass', 'run_stop_right'],
            'LB1': ['cover_flat_left', 'blitz_outside', 'run_stop_left'], 'LB2': ['cover_short_middle', 'blitz_middle', 'run_stop_center'], 'LB3': ['cover_flat_right', 'blitz_outside', 'run_stop_right'],
            'DB1': ['cover_deep_middle', 'cover_deep_half_left', 'cover_deep_half_right']
        },
        slotPriorities: {
            DL1: { strength: 1.4, blockShedding: 1.2 }, DL2: { strength: 1.5, tackling: 1.1 }, DL3: { strength: 1.4, blockShedding: 1.2 },
            LB1: { speed: 1.3, tackling: 1.2 }, LB2: { playbookIQ: 1.4, tackling: 1.2 }, LB3: { speed: 1.3, tackling: 1.2 },
            DB1: { speed: 1.5, playbookIQ: 1.3, catchingHands: 1.1 } // Safety
        }
    },
    '4-2-1': { 
        name: '4-2-1', 
        slots: ['DL1', 'DL2', 'DL3', 'DL4', 'LB1', 'LB2', 'DB1'],
        personnel: { DL: 4, LB: 2, DB: 1 },
         zoneAssignments: {
            DL1: ZONES.LOS_L, DL2: ZONES.LOS_C, DL3: ZONES.LOS_C, DL4: ZONES.LOS_R,
            LB1: ZONES.SHORT_L, LB2: ZONES.SHORT_R, 
            DB1: ZONES.DEEP_C 
        },
         routes: {
            'DL1': ['run_stop_left', 'rush_pass'], 'DL2': ['run_stop_center', 'rush_pass'], 'DL3': ['run_stop_center', 'rush_pass'], 'DL4': ['run_stop_right', 'rush_pass'],
            'LB1': ['run_stop_center', 'blitz_middle', 'cover_short_middle'], 'LB2': ['run_stop_center', 'blitz_middle', 'cover_short_middle'],
            'DB1': ['cover_deep_middle', 'run_support']
        },
        slotPriorities: {
            DL1: { strength: 1.6, blockShedding: 1.3 }, DL2: { strength: 1.6, tackling: 1.2 }, DL3: { strength: 1.6, tackling: 1.2 }, DL4: { strength: 1.6, blockShedding: 1.3 }, // Run stuffing focus
            LB1: { tackling: 1.4, strength: 1.2 }, LB2: { tackling: 1.4, playbookIQ: 1.2 },
            DB1: { speed: 1.4, tackling: 1.2, playbookIQ: 1.1 } // Needs to help vs run too
        }
    },
    '2-3-2': { 
        name: '2-3-2', 
        slots: ['DL1', 'DL2', 'LB1', 'LB2', 'LB3', 'DB1', 'DB2'],
        personnel: { DL: 2, LB: 3, DB: 2 },
         zoneAssignments: {
            DL1: ZONES.LOS_L, DL2: ZONES.LOS_R, 
            LB1: ZONES.SHORT_L, LB2: ZONES.SHORT_C, LB3: ZONES.SHORT_R, 
            DB1: ZONES.DEEP_L, DB2: ZONES.DEEP_R 
        },
         routes: {
             'DL1': ['rush_pass', 'run_stop_center'], 'DL2': ['rush_pass', 'run_stop_center'],
             'LB1': ['cover_flat_left', 'blitz_outside'], 'LB2': ['cover_short_middle', 'blitz_middle'], 'LB3': ['cover_flat_right', 'blitz_outside'],
             'DB1': ['cover_deep_half_left', 'man_cover_wr1'], 'DB2': ['cover_deep_half_right', 'man_cover_wr2']
         },
        slotPriorities: {
            DL1: { speed: 1.3, blockShedding: 1.3 }, DL2: { speed: 1.3, blockShedding: 1.3 }, // Pass rush
            LB1: { speed: 1.4, playbookIQ: 1.2 }, LB2: { tackling: 1.3, playbookIQ: 1.3 }, LB3: { speed: 1.4, playbookIQ: 1.2 }, // Coverage LBs
            DB1: { speed: 1.6, agility: 1.4, catchingHands: 1.2 }, DB2: { speed: 1.6, agility: 1.4, catchingHands: 1.2 } // Coverage focus
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

