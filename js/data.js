/**
 * Contains all the static data for the game, such as names, positions, and AI coach personalities.
 */

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

export const offenseFormations = {
    'Balanced': { name: 'Balanced', slots: ['QB', 'RB', 'WR1', 'WR2', 'OL1', 'OL2', 'OL3'] },
    'Spread': { name: 'Spread', slots: ['QB', 'RB', 'WR1', 'WR2', 'WR3', 'OL1', 'OL2'] },
    'Power I': { name: 'Power I', slots: ['QB', 'RB1', 'RB2', 'WR1', 'OL1', 'OL2', 'OL3'] }
};

export const defenseFormations = {
    '3-3-1': { name: '3-3-1', slots: ['DL1', 'DL2', 'DL3', 'LB1', 'LB2', 'LB3', 'DB1'] },
    '4-2-1': { name: '4-2-1', slots: ['DL1', 'DL2', 'DL3', 'DL4', 'LB1', 'LB2', 'DB1'] },
    'Nickel': { name: 'Nickel', slots: ['DL1', 'DL2', 'LB1', 'LB2', 'DB1', 'DB2', 'DB3'] }
};


export const coachPersonalities = [
    {
        type: 'West Coast Offense',
        description: 'Prefers accurate passers and agile receivers.',
        preferredOffense: 'Spread',
        preferredDefense: 'Nickel',
        attributePreferences: {
            physical: { speed: 1.4, strength: 0.7, agility: 1.5, stamina: 1.0, height: 1.2, weight: 0.8 },
            mental: { playbookIQ: 1.6, clutch: 1.2, consistency: 1.1 },
            technical: { throwingAccuracy: 1.8, catchingHands: 1.6, tackling: 0.4, blocking: 0.6, blockShedding: 0.5 }
        }
    },
    {
        type: 'Ground and Pound',
        description: 'Builds a tough team that runs the ball and plays strong defense.',
        preferredOffense: 'Power I',
        preferredDefense: '4-2-1',
        attributePreferences: {
            physical: { speed: 1.1, strength: 1.8, agility: 1.2, stamina: 1.4, height: 1.0, weight: 1.6 },
            mental: { playbookIQ: 1.0, clutch: 1.0, consistency: 1.5 },
            technical: { throwingAccuracy: 0.7, catchingHands: 0.9, tackling: 1.6, blocking: 1.8, blockShedding: 1.2 }
        }
    },
    {
        type: 'Blitz-Happy Defense',
        description: 'Wants fast, aggressive defenders to wreak havoc.',
        preferredOffense: 'Balanced',
        preferredDefense: 'Nickel',
        attributePreferences: {
            physical: { speed: 1.6, strength: 1.3, agility: 1.7, stamina: 1.2, height: 1.1, weight: 1.3 },
            mental: { playbookIQ: 1.2, clutch: 1.4, consistency: 0.9 },
            technical: { throwingAccuracy: 0.5, catchingHands: 0.8, tackling: 1.8, blocking: 1.0, blockShedding: 1.5 }
        }
    },
    {
        type: 'Balanced',
        description: 'Prefers well-rounded players and a versatile team.',
        preferredOffense: 'Balanced',
        preferredDefense: '3-3-1',
        attributePreferences: {
            physical: { speed: 1.2, strength: 1.2, agility: 1.2, stamina: 1.2, height: 1.1, weight: 1.1 },
            mental: { playbookIQ: 1.2, clutch: 1.2, consistency: 1.2 },
            technical: { throwingAccuracy: 1.2, catchingHands: 1.2, tackling: 1.2, blocking: 1.2, blockShedding: 1.2 }
        }
    },
    {
        type: 'The Moneyballer',
        description: 'Focuses on undervalued mental and technical stats.',
        preferredOffense: 'Spread',
        preferredDefense: '3-3-1',
        attributePreferences: {
            physical: { speed: 0.8, strength: 0.8, agility: 1.2, stamina: 1.4, height: 1.0, weight: 1.0 },
            mental: { playbookIQ: 1.8, clutch: 1.3, consistency: 1.9 },
            technical: { throwingAccuracy: 1.0, catchingHands: 1.5, tackling: 1.5, blocking: 1.3, blockShedding: 1.4 }
        }
    },
    {
        type: 'Youth Scout',
        description: 'Always drafts for the future, preferring younger players with high physical potential.',
        preferredOffense: 'Balanced',
        preferredDefense: '4-2-1',
        attributePreferences: {
            physical: { speed: 1.5, strength: 1.4, agility: 1.5, stamina: 1.3, height: 1.3, weight: 1.0 },
            mental: { playbookIQ: 0.9, clutch: 1.0, consistency: 0.8 },
            technical: { throwingAccuracy: 1.1, catchingHands: 1.1, tackling: 1.1, blocking: 1.1, blockShedding: 1.1 }
        }
    },
];

