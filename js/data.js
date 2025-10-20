// js/data.js - Contains all the raw data for the game.

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
    "Indigo", "Jules", "Lennon", "Milan", "Phoenix", "Sterling", "Arden", "Caelan", "Finley", "Justice"
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
    "Alexander", "Russell", "Griffin", "Diaz", "Hayes", "Myers"
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
    "'Aftershock'", "'Bruiser'", "'Cyclone'", "'Dragon'", "'Enigma'", "'Grizzly'"
];

export const teamNames = [
    "The Comets", "The Jets", "The Rockets", "The Sharks", "The Tigers", "The Lions", "The Bears", "The Eagles", 
    "The Hornets", "The Bulldogs", "The Panthers", "The Giants", "The Wolves", "The Vipers", "The Pythons", "The Cobras",
    "The Scorpions", "The Spartans", "The Cyclones", "The Gladiators", "The Raptors", "The Hawks", "The Falcons", "The Rebels"
];
export const positions = ["QB", "RB", "WR", "TE", "DL", "LB", "DB"];

export const divisionNames = ["North", "South"];

export const coachPersonalities = [
    { 
        type: 'West Coast Offense', 
        description: 'Prefers accurate passers and agile receivers.',
        attributePreferences: {
            physical: { speed: 1.4, strength: 0.7, agility: 1.5, stamina: 1.0, height: 1.2, weight: 0.8 },
            mental: { playbookIQ: 1.6, clutch: 1.2, consistency: 1.1 },
            technical: { throwingAccuracy: 1.8, catchingHands: 1.6, tackling: 0.4, blocking: 0.6 }
        } 
    },
    { 
        type: 'Ground and Pound', 
        description: 'Builds a tough team that runs the ball and plays strong defense.',
        attributePreferences: {
            physical: { speed: 1.1, strength: 1.8, agility: 1.2, stamina: 1.4, height: 1.0, weight: 1.6 },
            mental: { playbookIQ: 1.0, clutch: 1.0, consistency: 1.5 },
            technical: { throwingAccuracy: 0.7, catchingHands: 0.9, tackling: 1.6, blocking: 1.8 }
        } 
    },
    { 
        type: 'Blitz-Happy Defense', 
        description: 'Wants fast, aggressive defenders to wreak havoc.',
        attributePreferences: {
            physical: { speed: 1.6, strength: 1.3, agility: 1.7, stamina: 1.2, height: 1.1, weight: 1.3 },
            mental: { playbookIQ: 1.2, clutch: 1.4, consistency: 0.9 },
            technical: { throwingAccuracy: 0.5, catchingHands: 0.8, tackling: 1.8, blocking: 1.0 }
        } 
    },
    { 
        type: 'Balanced', 
        description: 'Prefers well-rounded players and a versatile team.',
        attributePreferences: {
            physical: { speed: 1.2, strength: 1.2, agility: 1.2, stamina: 1.2, height: 1.1, weight: 1.1 },
            mental: { playbookIQ: 1.2, clutch: 1.2, consistency: 1.2 },
            technical: { throwingAccuracy: 1.2, catchingHands: 1.2, tackling: 1.2, blocking: 1.2 }
        } 
    },
    { 
        type: 'The Moneyballer', 
        description: 'Focuses on undervalued mental and technical stats.',
        attributePreferences: {
            physical: { speed: 0.8, strength: 0.8, agility: 1.2, stamina: 1.4, height: 1.0, weight: 1.0 },
            mental: { playbookIQ: 1.8, clutch: 1.3, consistency: 1.9 },
            technical: { throwingAccuracy: 1.0, catchingHands: 1.5, tackling: 1.5, blocking: 1.3 }
        } 
    },
    { 
        type: 'Youth Scout', 
        description: 'Always drafts for the future, preferring younger players with high physical potential.',
        attributePreferences: {
            physical: { speed: 1.5, strength: 1.4, agility: 1.5, stamina: 1.3, height: 1.3, weight: 1.0 },
            mental: { playbookIQ: 0.9, clutch: 1.0, consistency: 0.8 },
            technical: { throwingAccuracy: 1.1, catchingHands: 1.1, tackling: 1.1, blocking: 1.1 }
        } 
    },
];

