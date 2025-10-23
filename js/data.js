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
// Used for targeting and player assignment logic
export const ZONES = {
    // Passing Zones
    DEEP_L: 'Deep Left', DEEP_C: 'Deep Center', DEEP_R: 'Deep Right',
    MED_L: 'Medium Left', MED_C: 'Medium Center', MED_R: 'Medium Right',
    SHORT_L: 'Short Left', SHORT_C: 'Short Center', SHORT_R: 'Short Right',
    SCREEN_L: 'Screen Left', SCREEN_R: 'Screen Right',
    // Running Zones (Point of Attack)
    RUN_L: 'Outside Left', RUN_C: 'Inside', RUN_R: 'Outside Right',
    SNEAK: 'QB Sneak', // Center
    // General Areas
    BACKFIELD: 'Backfield',
    LINE_OF_SCRIMMAGE: 'Line of Scrimmage'
};

// --- Formations with Zone Assignments and Slot Priorities ---
export const offenseFormations = {
    'Balanced': {
        name: 'Balanced',
        slots: ['QB1', 'RB1', 'WR1', 'WR2', 'OL1', 'OL2', 'OL3'],
        personnel: { QB: 1, RB: 1, WR: 2, OL: 3 },
        zoneAssignments: {
            QB1: ZONES.BACKFIELD, RB1: ZONES.BACKFIELD,
            WR1: ZONES.MED_L, WR2: ZONES.MED_R,
            OL1: ZONES.LINE_OF_SCRIMMAGE, OL2: ZONES.LINE_OF_SCRIMMAGE, OL3: ZONES.LINE_OF_SCRIMMAGE
        },
        slotPriorities: { // Higher weight = more important for this specific slot
            QB1: { throwingAccuracy: 1.5, playbookIQ: 1.2 }, RB1: { speed: 1.3, agility: 1.1 },
            WR1: { speed: 1.2, catchingHands: 1.2 }, WR2: { catchingHands: 1.3, agility: 1.1 },
            OL1: { strength: 1.5, blocking: 1.3 }, OL2: { blocking: 1.4, strength: 1.2 }, OL3: { strength: 1.4, blocking: 1.2 }
        }
    },
    'Spread': {
        name: 'Spread',
        slots: ['QB1', 'RB1', 'WR1', 'WR2', 'WR3', 'OL1', 'OL2'],
        personnel: { QB: 1, RB: 1, WR: 3, OL: 2 },
        zoneAssignments: {
            QB1: ZONES.BACKFIELD, RB1: ZONES.BACKFIELD,
            WR1: ZONES.DEEP_L, WR2: ZONES.DEEP_R, WR3: ZONES.SHORT_C,
            OL1: ZONES.LINE_OF_SCRIMMAGE, OL2: ZONES.LINE_OF_SCRIMMAGE
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
        personnel: { QB: 1, RB: 2, WR: 1, OL: 3 },
        zoneAssignments: {
            QB1: ZONES.BACKFIELD, RB1: ZONES.BACKFIELD, RB2: ZONES.BACKFIELD, // RB2 often lead blocker
            WR1: ZONES.SHORT_R,
            OL1: ZONES.LINE_OF_SCRIMMAGE, OL2: ZONES.LINE_OF_SCRIMMAGE, OL3: ZONES.LINE_OF_SCRIMMAGE
        },
        slotPriorities: {
            QB1: { playbookIQ: 1.3 }, RB1: { strength: 1.4, speed: 1.2 }, RB2: { blocking: 1.5, strength: 1.2 }, // RB2 as blocker
            WR1: { blocking: 1.3, catchingHands: 1.0 }, // WR needs to block
            OL1: { strength: 1.6, blocking: 1.4 }, OL2: { strength: 1.6, blocking: 1.4 }, OL3: { strength: 1.6, blocking: 1.4 } // Run block focus
        }
    },
};

export const defenseFormations = {
    '3-3-1': { // Balanced vs Run/Pass
        name: '3-3-1',
        slots: ['DL1', 'DL2', 'DL3', 'LB1', 'LB2', 'LB3', 'DB1'],
        personnel: { DL: 3, LB: 3, DB: 1 },
        zoneAssignments: { // Approximate zones covered
            DL1: ZONES.LINE_OF_SCRIMMAGE, DL2: ZONES.LINE_OF_SCRIMMAGE, DL3: ZONES.LINE_OF_SCRIMMAGE,
            LB1: ZONES.SHORT_L, LB2: ZONES.SHORT_C, LB3: ZONES.SHORT_R,
            DB1: ZONES.DEEP_C // Single high safety
        },
        slotPriorities: {
            DL1: { strength: 1.4, blockShedding: 1.2 }, DL2: { strength: 1.5, tackling: 1.1 }, DL3: { strength: 1.4, blockShedding: 1.2 },
            LB1: { speed: 1.3, tackling: 1.2 }, LB2: { playbookIQ: 1.4, tackling: 1.2 }, LB3: { speed: 1.3, tackling: 1.2 },
            DB1: { speed: 1.5, playbookIQ: 1.3, catchingHands: 1.1 } // Safety
        }
    },
    '4-2-1': { // Strong vs Run
        name: '4-2-1',
        slots: ['DL1', 'DL2', 'DL3', 'DL4', 'LB1', 'LB2', 'DB1'],
        personnel: { DL: 4, LB: 2, DB: 1 },
         zoneAssignments: {
            DL1: ZONES.LINE_OF_SCRIMMAGE, DL2: ZONES.LINE_OF_SCRIMMAGE, DL3: ZONES.LINE_OF_SCRIMMAGE, DL4: ZONES.LINE_OF_SCRIMMAGE,
            LB1: ZONES.SHORT_C, LB2: ZONES.SHORT_C, // Inside LBs
            DB1: ZONES.DEEP_C // Single high safety
        },
        slotPriorities: {
            DL1: { strength: 1.6, blockShedding: 1.3 }, DL2: { strength: 1.6, tackling: 1.2 }, DL3: { strength: 1.6, tackling: 1.2 }, DL4: { strength: 1.6, blockShedding: 1.3 }, // Run stuffing focus
            LB1: { tackling: 1.4, strength: 1.2 }, LB2: { tackling: 1.4, playbookIQ: 1.2 },
            DB1: { speed: 1.4, tackling: 1.2, playbookIQ: 1.1 } // Needs to help vs run too
        }
    },
    '2-3-2': { // Strong vs Pass (Dime-like)
        name: '2-3-2',
        slots: ['DL1', 'DL2', 'LB1', 'LB2', 'LB3', 'DB1', 'DB2'],
        personnel: { DL: 2, LB: 3, DB: 2 },
         zoneAssignments: {
            DL1: ZONES.LINE_OF_SCRIMMAGE, DL2: ZONES.LINE_OF_SCRIMMAGE, // Interior rush/stuff
            LB1: ZONES.SHORT_L, LB2: ZONES.SHORT_C, LB3: ZONES.SHORT_R, // Zone coverage / blitz
            DB1: ZONES.DEEP_L, DB2: ZONES.DEEP_R // Two deep safeties/corners
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
        attributePreferences: { /* ... same as before ... */ }
    },
    {
        type: 'Ground and Pound',
        description: 'Builds a tough team that runs the ball and plays strong defense.',
        preferredOffense: 'Power',
        preferredDefense: '4-2-1',
        attributePreferences: { /* ... same as before ... */ }
    },
    {
        type: 'Blitz-Happy Defense',
        description: 'Wants fast, aggressive defenders to wreak havoc.',
        preferredOffense: 'Balanced',
        preferredDefense: '4-2-1', // Often uses run-stopping formations to free up blitzers
        attributePreferences: { /* ... same as before ... */ }
    },
    {
        type: 'Balanced',
        description: 'Prefers well-rounded players and a versatile team.',
        preferredOffense: 'Balanced',
        preferredDefense: '3-3-1',
        attributePreferences: { /* ... same as before ... */ }
    },
    {
        type: 'The Moneyballer',
        description: 'Focuses on undervalued mental and technical stats.',
        preferredOffense: 'Balanced',
        preferredDefense: '3-3-1',
        attributePreferences: { /* ... same as before ... */ }
    },
    {
        type: 'Youth Scout',
        description: 'Always drafts for the future, preferring younger players with high physical potential.',
        preferredOffense: 'Spread',
        preferredDefense: '2-3-2',
        attributePreferences: { /* ... same as before ... */ }
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
        // Apply some default variation based on type for safety
        if (coach.type.includes('Offense')) coach.attributePreferences.technical.throwingAccuracy = 1.2;
        if (coach.type.includes('Defense')) coach.attributePreferences.technical.tackling = 1.2;
        if (coach.type.includes('Ground')) coach.attributePreferences.physical.strength = 1.2;
    }
});

